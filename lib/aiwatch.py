#!/usr/bin/env python3
"""Observabilidad de `ai`: eventos, análisis en vivo y panel web.

Solo usa la librería estándar de Python 3 (la de macOS sirve). La invoca bin/ai:

  aiwatch.py event <log.jsonl> <tipo> [clave=valor ...]
      Añade un evento (una línea JSON) al registro de un plan.

  aiwatch.py plan-stream <log.jsonl> <plan.md>
      Lee `claude -p --output-format stream-json --verbose` por stdin, muestra en la
      terminal qué archivos lee Opus, registra cada herramienta y guarda el plan final.

  aiwatch.py serve <ai_home> <puerto>
      Panel web de solo lectura en 127.0.0.1:<puerto> (ver docs/ARCHITECTURE.md).

Formato de los registros: proyecto/.ai/logs/<plan>.jsonl, un objeto por línea con
"ts" (ISO 8601), "type" y campos libres. Tipos: plan_started, plan_tool, plan_note,
plan_done, plan_failed, plan_aborted, exec_started, step_started, step_done,
step_failed, exec_done, exec_failed, exec_aborted, review_started, review_done,
review_failed.
"""
import glob
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


# --- Eventos -----------------------------------------------------------------
def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def append_event(path, etype, **fields):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rec = {"ts": now_iso(), "type": etype}
    rec.update(fields)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def coerce(value):
    return int(value) if re.fullmatch(r"-?\d+", value) else value


def cmd_event(args):
    path, etype = args[0], args[1]
    fields = {}
    for kv in args[2:]:
        key, _, value = kv.partition("=")
        fields[key] = coerce(value)
    append_event(path, etype, **fields)
    return 0


# --- Análisis en vivo (plan-stream) ------------------------------------------
ICONS = {"Read": "📖", "Glob": "🗂 ", "Grep": "🔎"}
DIM, OFF, RED = "\033[2m", "\033[0m", "\033[31m"


def say(msg):
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def relpath(path, cwd):
    return path[len(cwd) + 1:] if path.startswith(cwd + "/") else path


def tool_target(name, inp, cwd):
    if name == "Read":
        return relpath(inp.get("file_path", ""), cwd)
    if name in ("Glob", "Grep"):
        target = inp.get("pattern", "")
        if inp.get("path"):
            target += "  en " + relpath(inp["path"], cwd)
        return target
    return json.dumps(inp, ensure_ascii=False)[:120]


def cmd_plan_stream(args):
    log, plan = args[0], args[1]
    cwd = os.getcwd()
    result, error, meta = None, None, {}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            say(line)  # mensajes de error de claude que no son JSON
            continue
        mtype = msg.get("type")
        if mtype == "assistant":
            for block in msg.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    name = block.get("name", "?")
                    target = tool_target(name, block.get("input") or {}, cwd)
                    say(f"  {ICONS.get(name, '🔧')} {name} {DIM}{target}{OFF}")
                    append_event(log, "plan_tool", tool=name, target=target)
                elif block.get("type") == "text":
                    text = (block.get("text") or "").strip()
                    if text and len(text) <= 400:  # el plan final es largo: no es una nota
                        say(f"  {DIM}💬 {text}{OFF}")
                        append_event(log, "plan_note", text=text)
        elif mtype == "result":
            meta = {"turns": msg.get("num_turns"), "duration_ms": msg.get("duration_ms")}
            if msg.get("is_error") or msg.get("subtype") != "success":
                error = msg.get("result") or msg.get("subtype")
            else:
                result = msg.get("result") or ""

    if result and result.strip():
        with open(plan, "w", encoding="utf-8") as f:
            f.write(result.rstrip() + "\n")
        append_event(log, "plan_done", file=relpath(plan, cwd), **meta)
        return 0
    error = str(error or "el planificador no devolvió nada")[:500]
    append_event(log, "plan_failed", error=error, **meta)
    say(f"{RED}✗{OFF} {error}")
    return 1


# --- Lectura de planes y registros -------------------------------------------
RUN_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
STEP_RE = re.compile(r"^### Paso (\d+)\s*[:.\-—]?\s*(.*)$")


def read_events(path):
    events = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return events


def parse_plan(path):
    """Mismo criterio que split_steps en bin/ai: secciones '### Paso N' hasta el siguiente '## '."""
    plan = {"title": "", "steps": [], "text": ""}
    try:
        with open(path, encoding="utf-8") as f:
            plan["text"] = f.read()
    except OSError:
        return plan
    current = None
    for line in plan["text"].splitlines():
        if not plan["title"] and line.startswith("# "):
            plan["title"] = re.sub(r"^#\s*(Plan:\s*)?", "", line).strip()
        m = STEP_RE.match(line)
        if m:
            current = {"n": int(m.group(1)), "title": m.group(2).strip(), "files": [], "status": "pending"}
            plan["steps"].append(current)
        elif line.startswith("## "):
            current = None
        elif current is not None and not current["files"] and "archivo" in line.lower():
            current["files"] = [x for x in re.findall(r"`([^`]+)`", line) if " " not in x]
    return plan


def run_state(pdir, name):
    plans = os.path.join(pdir, ".ai", "plans")
    logs = os.path.join(pdir, ".ai", "logs")
    plan_path = os.path.join(plans, name + ".md")
    plan = parse_plan(plan_path)
    events = read_events(os.path.join(logs, name + ".jsonl"))
    has_plan = os.path.isfile(plan_path)

    analysis = {"status": "done" if has_plan else "pending", "tools": [], "notes": []}
    execu = {"status": "pending", "steps": plan.pop("steps")}
    review = {"status": "pending"}
    steps = {s["n"]: s for s in execu["steps"]}

    def step(n):
        if n not in steps:
            steps[n] = {"n": n, "title": "", "files": [], "status": "pending"}
            execu["steps"].append(steps[n])
        return steps[n]

    for ev in events:
        t, ts = ev.get("type"), ev.get("ts")
        if t == "plan_started":
            analysis.update(status="running", started=ts, task=ev.get("task"), model=ev.get("model"))
        elif t == "plan_tool":
            analysis["tools"].append({"ts": ts, "tool": ev.get("tool"), "target": ev.get("target")})
        elif t == "plan_note":
            analysis["notes"].append({"ts": ts, "text": ev.get("text")})
        elif t == "plan_done":
            analysis.update(status="done", finished=ts, turns=ev.get("turns"), duration_ms=ev.get("duration_ms"))
        elif t in ("plan_failed", "plan_aborted"):
            analysis.update(status="failed", finished=ts, error=ev.get("error") or "interrumpido")
        elif t == "exec_started":
            execu.update(status="running", started=ts, finished=None, mode=ev.get("mode"),
                         model=ev.get("model"), branch=ev.get("branch"), total=ev.get("total"))
            first = ev.get("from") or 1
            for s in execu["steps"]:
                if s["n"] >= first:
                    for k in ("started", "secs", "commits"):
                        s.pop(k, None)
                    s["status"] = "pending"
        elif t == "step_started":
            s = step(ev.get("n"))
            s.update(status="running", started=ts)
            if ev.get("title") and not s["title"]:
                s["title"] = ev["title"]
        elif t == "step_done":
            s = step(ev.get("n"))
            commits = ev.get("commits") or ""
            s.update(status="done", secs=ev.get("secs"),
                     commits=[c for c in str(commits).splitlines() if c.strip()])
        elif t == "step_failed":
            step(ev.get("n")).update(status="failed", secs=ev.get("secs"))
        elif t == "exec_done":
            execu.update(status="done", finished=ts)
        elif t in ("exec_failed", "exec_aborted"):
            execu.update(status="failed" if t == "exec_failed" else "aborted", finished=ts)
            for s in execu["steps"]:
                if s["status"] == "running":
                    s["status"] = "aborted"
        elif t == "review_started":
            review.update(status="running", started=ts)
        elif t == "review_done":
            review.update(status="done", finished=ts)
        elif t == "review_failed":
            review.update(status="failed", finished=ts)

    execu["steps"].sort(key=lambda s: s["n"])
    execu["current"] = next((s["n"] for s in execu["steps"] if s["status"] == "running"), None)
    execu["logs"] = sorted(int(m.group(1)) for m in
                           (re.search(r"\.step-(\d+)\.log$", p) for p in glob.glob(os.path.join(logs, name + ".step-*.log")))
                           if m)
    try:
        with open(os.path.join(logs, name + ".review.md"), encoding="utf-8") as f:
            review["text"] = f.read()
    except OSError:
        pass
    return {"name": name, "plan": plan, "analysis": analysis, "exec": execu, "review": review,
            "events": len(events), "updated": run_mtime(pdir, name)}


def run_mtime(pdir, name):
    paths = glob.glob(os.path.join(pdir, ".ai", "logs", name + ".*"))
    paths.append(os.path.join(pdir, ".ai", "plans", name + ".md"))
    return max([os.path.getmtime(p) for p in paths if os.path.exists(p)] or [0])


def run_summary(pdir, name):
    st = run_state(pdir, name)
    stage, status = "analysis", st["analysis"]["status"]
    if st["exec"]["status"] != "pending":
        stage, status = "exec", st["exec"]["status"]
    if st["review"]["status"] != "pending":
        stage, status = "review", st["review"]["status"]
    return {"name": name, "title": st["plan"]["title"] or name, "stage": stage, "status": status,
            "updated": st["updated"]}


def list_runs(pdir):
    names = set()
    for p in glob.glob(os.path.join(pdir, ".ai", "plans", "*.md")):
        names.add(os.path.basename(p)[:-3])
    for p in glob.glob(os.path.join(pdir, ".ai", "logs", "*.jsonl")):
        names.add(os.path.basename(p)[:-6])
    runs = [run_summary(pdir, n) for n in names if RUN_NAME.match(n)]
    return sorted(runs, key=lambda r: r["updated"], reverse=True)


# --- Salida de terminal -> texto ---------------------------------------------
# Aider dibuja con rich (colores, spinners, redibujado con cursor arriba). Un mini
# emulador de terminal reconstruye lo que verías en pantalla en vez de mostrar basura.
TOKEN = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]|\r|\n|\x08|[^\x1b\r\n\x08]+")
CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
TAIL_BYTES = 256 * 1024
TAIL_LINES = 600
_render_cache = {}


def render_terminal(raw):
    lines, row, col = [[]], 0, 0
    for tok in TOKEN.findall(raw):
        if tok == "\n":
            row, col = row + 1, 0
            if row >= len(lines):
                lines.append([])
        elif tok == "\r":
            col = 0
        elif tok == "\x08":
            col = max(0, col - 1)
        elif tok.startswith("\x1b["):
            params, final = tok[2:-1], tok[-1]
            if params.startswith("?"):
                continue
            nums = [int(x) if x.isdigit() else 0 for x in params.split(";")] if params else []
            n = nums[0] if nums and nums[0] else 1
            mode = nums[0] if nums else 0
            if final == "A":
                row = max(0, row - n)
            elif final == "B":
                row += n
                while row >= len(lines):
                    lines.append([])
            elif final == "C":
                col += n
            elif final == "D":
                col = max(0, col - n)
            elif final == "G":
                col = max(0, n - 1)
            elif final == "K":
                if mode == 0:
                    del lines[row][col:]
                elif mode == 1:
                    lines[row][:col] = [" "] * min(col, len(lines[row]))
                else:
                    lines[row] = []
            elif final == "J" and mode == 0:
                del lines[row][col:]
                del lines[row + 1:]
        elif tok.startswith("\x1b"):
            continue
        else:
            tok = CTRL.sub("", tok)
            line = lines[row]
            if col > len(line):
                line.extend(" " * (col - len(line)))
            line[col:col + len(tok)] = list(tok)
            col += len(tok)
    return "\n".join("".join(l).rstrip() for l in lines).strip("\n")


def read_terminal_log(path):
    try:
        st = os.stat(path)
    except OSError:
        return ""
    key = (path, st.st_mtime, st.st_size)
    if _render_cache.get(path, (None,))[0] == key:
        return _render_cache[path][1]
    with open(path, "rb") as f:
        if st.st_size > TAIL_BYTES:
            f.seek(st.st_size - TAIL_BYTES)
            f.readline()  # empezar en una línea completa
        raw = f.read().decode("utf-8", errors="replace")
    text = "\n".join(render_terminal(raw).splitlines()[-TAIL_LINES:])
    _render_cache[path] = (key, text)
    return text


# --- Estado del sistema ------------------------------------------------------
_system_cache = {"t": 0, "data": None}
_system_lock = threading.Lock()


def sh(cmd, timeout=3):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return None


def system_state():
    with _system_lock:
        if time.time() - _system_cache["t"] < 3 and _system_cache["data"]:
            return _system_cache["data"]
        data = {"executor": os.environ.get("EXECUTOR_MODEL", ""), "planner": os.environ.get("PLANNER_MODEL", ""),
                "ollama": "down", "models": [], "docker": "down", "containers": [], "mem_free": None}
        try:
            with urllib.request.urlopen(os.environ.get("OLLAMA_URL", "") + "/api/ps", timeout=1.5) as r:
                ps = json.load(r)
            data["ollama"] = "up"
            for m in ps.get("models", []):
                size = m.get("size") or 0
                data["models"].append({"name": m.get("name"), "size": size,
                                       "gpu": round(100 * (m.get("size_vram") or 0) / size) if size else 0,
                                       "context": m.get("context_length"), "until": m.get("expires_at")})
        except (OSError, ValueError):
            pass
        out = sh(["docker", "ps", "--filter", "label=com.docker.compose.project=" + os.environ.get("COMPOSE_PROJECT", ""),
                  "--format", "{{.Names}}\t{{.Status}}"])
        if out is not None and (out or sh(["docker", "info", "--format", "{{.ServerVersion}}"])):
            data["docker"] = "up"
            data["containers"] = [dict(zip(("name", "status"), l.split("\t", 1))) for l in out.splitlines() if l]
        m = re.search(r"free percentage:\s*(\d+)%", sh(["memory_pressure"]) or "")
        data["mem_free"] = int(m.group(1)) if m else None
        _system_cache.update(t=time.time(), data=data)
        return data


# --- Servidor web ------------------------------------------------------------
CSP = ("default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")


def registered_projects(ai_home):
    try:
        with open(os.path.join(ai_home, "run", "projects"), encoding="utf-8") as f:
            dirs = [l.strip() for l in f if l.strip()]
    except OSError:
        dirs = []
    seen, out = set(), []
    for d in dirs:
        if d not in seen and os.path.isdir(d):
            seen.add(d)
            out.append(d)
    return out


def make_handler(ai_home, port):
    index = os.path.join(ai_home, "dashboard", "index.html")
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        server_version = "ai-dashboard"

        def log_message(self, fmt, *args):  # silencioso: solo errores van al log
            pass

        def send(self, code, body, ctype="application/json; charset=utf-8"):
            if isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", CSP)
            self.end_headers()
            self.wfile.write(body)

        def json(self, data, code=200):
            self.send(code, json.dumps(data, ensure_ascii=False))

        def do_GET(self):
            # Defensa contra DNS rebinding: solo se responde a quien pide 127.0.0.1/localhost.
            if self.headers.get("Host", "") not in allowed_hosts:
                return self.send(403, "Host no permitido", "text/plain; charset=utf-8")
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                if url.path == "/":
                    with open(index, "rb") as f:
                        return self.send(200, f.read(), "text/html; charset=utf-8")
                if url.path == "/api/system":
                    return self.json(system_state())
                if url.path == "/api/projects":
                    return self.json([{"dir": d, "name": os.path.basename(d), "runs": list_runs(d)[:40]}
                                      for d in registered_projects(ai_home)])
                if url.path in ("/api/run", "/api/log"):
                    pdir, name = q.get("project", ""), q.get("run", "")
                    # Solo proyectos registrados por `ai` y nombres de plan sin rutas.
                    if pdir not in registered_projects(ai_home) or not RUN_NAME.match(name):
                        return self.json({"error": "proyecto o plan no válido"}, 404)
                    if url.path == "/api/run":
                        return self.json(run_state(pdir, name))
                    step = q.get("step", "")
                    if not step.isdigit():
                        return self.json({"error": "paso no válido"}, 400)
                    log = os.path.join(pdir, ".ai", "logs", f"{name}.step-{int(step):03d}.log")
                    return self.json({"step": int(step), "text": read_terminal_log(log)})
                return self.send(404, "No encontrado", "text/plain; charset=utf-8")
            except Exception as exc:  # el panel nunca debe tumbar el servidor
                sys.stderr.write(f"{now_iso()} error en {url.path}: {exc!r}\n")
                return self.json({"error": "error interno"}, 500)

    return Handler


def cmd_serve(args):
    ai_home, port = args[0], int(args[1])
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(ai_home, port))
    server.daemon_threads = True
    sys.stderr.write(f"{now_iso()} panel en http://127.0.0.1:{port}/\n")
    server.serve_forever()


def main(argv):
    commands = {"event": (cmd_event, 2), "plan-stream": (cmd_plan_stream, 2), "serve": (cmd_serve, 2)}
    if len(argv) < 1 or argv[0] not in commands or len(argv) - 1 < commands[argv[0]][1]:
        sys.stderr.write(__doc__)
        return 2
    func, _ = commands[argv[0]]
    return func(argv[1:]) or 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

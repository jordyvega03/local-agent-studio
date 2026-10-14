#!/usr/bin/env python3
"""Observabilidad de `ai`: eventos, análisis en vivo y panel web.

Solo usa la librería estándar de Python 3 (la de macOS sirve). La invoca bin/ai:

  aiwatch.py event <log.jsonl> <tipo> [clave=valor ...]
      Añade un evento (una línea JSON) al registro de un plan.

  aiwatch.py plan-stream <log.jsonl> <salida.md> [prefijo]
      Lee `claude -p --output-format stream-json --verbose` por stdin, muestra en la
      terminal qué archivos lee Opus, registra cada herramienta y guarda el texto final.
      prefijo = plan (por defecto, `ai plan`) o agent (agentes con motor claude).

  aiwatch.py detect-verify <proyecto>
      Imprime el comando de comprobación del proyecto (tests, o si no typecheck), o nada.

  aiwatch.py review-out <log.jsonl> <salida.md>
      Lee `claude -p --output-format json` de `ai review`: imprime la revisión, la guarda
      y registra review_done con los tokens usados.

  aiwatch.py context <archivo.json> [clave=valor ...]
      Escribe (o borra, sin pares) el contexto actual del medidor: proyecto, plan, paso.

  aiwatch.py meter <ai_home> <puerto> <url_ollama>
      Medidor de tokens: proxy en 127.0.0.1:<puerto> hacia Ollama que registra cada
      respuesta en logs/tokens.jsonl (y en proyecto/.ai/logs/<plan>.tokens.jsonl).

  aiwatch.py serve <ai_home> <puerto>
      Panel web de solo lectura en 127.0.0.1:<puerto> (ver docs/ARCHITECTURE.md).

Formato de los registros: proyecto/.ai/logs/<plan>.jsonl, un objeto por línea con
"ts" (ISO 8601), "type" y campos libres. Tipos: plan_started, plan_tool, plan_note,
plan_done, plan_failed, plan_aborted, exec_started, step_started, step_done,
step_failed, exec_done, exec_failed, exec_aborted, review_started, review_done,
review_failed, agent_started, agent_tool, agent_note, agent_done, agent_failed.
Una ejecución de `ai agent` reutiliza exec_*/step_* para sus pasos (1 = el agente,
2 = la verificación) y añade agent_* con los datos del agente.
"""
import glob
import http.client
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
    if os.path.dirname(path):
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


def usage_fields(msg):
    """Tokens de un `result` de Claude Code (stream-json o json)."""
    u = msg.get("usage") or {}
    out = {"input_tokens": u.get("input_tokens"), "output_tokens": u.get("output_tokens"),
           "cache_read_tokens": u.get("cache_read_input_tokens"),
           "cache_creation_tokens": u.get("cache_creation_input_tokens")}
    if msg.get("total_cost_usd") is not None:
        out["cost_usd"] = round(msg["total_cost_usd"], 4)   # coste equivalente de API (informativo)
    return {k: v for k, v in out.items() if v is not None}


def cmd_review_out(args):
    log, out = args[0], args[1]
    raw = sys.stdin.read()
    try:
        msg = json.loads(raw)
    except ValueError:
        say(raw.strip() or "la revisión no devolvió nada")
        append_event(log, "review_failed", error=raw.strip()[:500])
        return 1
    text = (msg.get("result") or "").strip()
    if msg.get("is_error") or not text:
        append_event(log, "review_failed", error=str(msg.get("result") or msg.get("subtype"))[:500])
        say(f"{RED}✗{OFF} {msg.get('result') or 'la revisión falló'}")
        return 1
    print(text)
    with open(out, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    append_event(log, "review_done", duration_ms=msg.get("duration_ms"), **usage_fields(msg))
    return 0


def read_env_value(path, key):
    """Lee CLAVE='valor' de un archivo tipo config.env sin ejecutarlo."""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                m = re.match(rf"^{key}=['\"]?([^'\"]*)['\"]?\s*(#.*)?$", line.strip())
                if m:
                    return m.group(1).strip()
    except OSError:
        pass
    return None


def detect_verify(pdir):
    """Comando de comprobación: VERIFY_CMD de .ai/project.env, o el detectado (tests > typecheck)."""
    override = read_env_value(os.path.join(pdir, ".ai", "project.env"), "VERIFY_CMD")
    if override is not None:
        return override
    cmds = []

    def node(pkg_dir):
        try:
            with open(os.path.join(pkg_dir, "package.json"), encoding="utf-8") as f:
                scripts = json.load(f).get("scripts") or {}
        except (OSError, ValueError):
            return None
        rel = os.path.relpath(pkg_dir, pdir)
        npm = "npm" if rel == "." else f"npm --prefix {rel}"
        test = scripts.get("test", "")
        if test and "no test specified" not in test:
            return f"{npm} test"
        for name in ("typecheck", "type-check"):
            if name in scripts:
                return f"{npm} run {name}"
        return None

    root = node(pdir)
    if root:
        cmds.append(root)
    else:
        for sub in sorted(glob.glob(os.path.join(pdir, "apps", "*")) + glob.glob(os.path.join(pdir, "packages", "*"))):
            c = node(sub)
            if c:
                cmds.append(c)
    if any(os.path.exists(os.path.join(pdir, f)) for f in ("pytest.ini", "conftest.py")) or \
            (os.path.exists(os.path.join(pdir, "pyproject.toml")) and os.path.isdir(os.path.join(pdir, "tests"))):
        cmds.append("python3 -m pytest -q")
    return " && ".join(cmds)


def cmd_detect_verify(args):
    print(detect_verify(args[0]))
    return 0


def cmd_context(args):
    path = args[0]
    if len(args) == 1:
        try:
            os.remove(path)
        except OSError:
            pass
        return 0
    data = {}
    for kv in args[1:]:
        key, _, value = kv.partition("=")
        data[key] = coerce(value) if value else None
    write_json_atomic(path, data)
    return 0


def write_json_atomic(path, data):
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def cmd_plan_stream(args):
    log, plan = args[0], args[1]
    prefix = args[2] if len(args) > 2 and args[2] in ("plan", "agent") else "plan"
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
                    append_event(log, f"{prefix}_tool", tool=name, target=target)
                elif block.get("type") == "text":
                    text = (block.get("text") or "").strip()
                    if text and len(text) <= 400:  # el plan final es largo: no es una nota
                        say(f"  {DIM}💬 {text}{OFF}")
                        append_event(log, f"{prefix}_note", text=text)
        elif mtype == "result":
            meta = {"turns": msg.get("num_turns"), "duration_ms": msg.get("duration_ms"), **usage_fields(msg)}
            if msg.get("is_error") or msg.get("subtype") != "success":
                error = msg.get("result") or msg.get("subtype")
            else:
                result = msg.get("result") or ""

    if result and result.strip():
        with open(plan, "w", encoding="utf-8") as f:
            f.write(result.rstrip() + "\n")
        append_event(log, f"{prefix}_done", file=relpath(plan, cwd), **meta)
        return 0
    error = str(error or "el planificador no devolvió nada")[:500]
    append_event(log, f"{prefix}_failed", error=error, **meta)
    say(f"{RED}✗{OFF} {error}")
    return 1


# --- Medidor de tokens (proxy hacia Ollama) -----------------------------------
# Aider (en el contenedor) habla con este proxy en vez de con Ollama. Cada respuesta de
# /api/chat o /api/generate se reenvía tal cual, en streaming, y al terminar se registra:
# tokens de prompt y de salida, duraciones, tokens/s y tiempo hasta el primer token.
# A qué proyecto/plan/paso pertenece lo dice run/meter-context.json (lo escribe bin/ai).
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
               "trailers", "transfer-encoding", "upgrade", "host", "content-length"}
METERED = ("/api/chat", "/api/generate")
TOKENS_LOG_MAX = 10 * 1024 * 1024


class Meter:
    def __init__(self, ai_home, port, upstream):
        self.port = port
        self.upstream = urlparse(upstream)
        self.ctx_file = os.path.join(ai_home, "run", "meter-context.json")
        self.live_file = os.path.join(ai_home, "run", "meter-live.json")
        self.log = os.path.join(ai_home, "logs", "tokens.jsonl")
        self.lock = threading.Lock()
        # Ollama rechaza Host ajenos (DNS rebinding); como el proxy reescribe Host, lo comprueba él.
        self.hosts = {f"{h}:{port}" for h in ("127.0.0.1", "localhost", "host.docker.internal")}

    def context(self):
        try:
            with open(self.ctx_file, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def live(self, data):
        try:
            write_json_atomic(self.live_file, data)
        except OSError:
            pass

    def record(self, rec):
        line = json.dumps(rec, ensure_ascii=False) + "\n"
        with self.lock:
            try:
                if os.path.exists(self.log) and os.path.getsize(self.log) > TOKENS_LOG_MAX:
                    os.replace(self.log, self.log + ".1")
                with open(self.log, "a", encoding="utf-8") as f:
                    f.write(line)
            except OSError:
                pass
            proj, run = rec.get("project"), rec.get("run")
            if proj and run and RUN_NAME.match(str(run)) and os.path.isdir(os.path.join(proj, ".ai", "logs")):
                try:
                    with open(os.path.join(proj, ".ai", "logs", f"{run}.tokens.jsonl"), "a", encoding="utf-8") as f:
                        f.write(line)
                except OSError:
                    pass


class Tracker:
    """Cuenta los fragmentos de una respuesta en streaming y registra el resumen final."""

    def __init__(self, meter, model, endpoint, t0):
        self.meter, self.model, self.endpoint = meter, model, endpoint
        self.ctx = meter.context()
        self.t0 = t0            # cuando se envió la petición: el TTFT incluye la espera de Ollama
        self.first = None
        self.tokens = 0
        self.buf = b""
        self.final = None
        self.last_live = 0.0
        self.meter.live(self.live_state())

    def live_state(self, active=True):
        now = time.time()
        gen = now - self.first if self.first else 0
        return {"active": active, "model": self.model, "endpoint": self.endpoint, "context": self.ctx,
                "started": int(self.t0 * 1000), "tokens": self.tokens,
                "tok_s": round(self.tokens / gen, 1) if gen > 0.5 else None,
                "ttft_ms": int((self.first - self.t0) * 1000) if self.first else None,
                "updated": int(now * 1000)}

    def feed(self, chunk):
        self.buf += chunk
        *lines, self.buf = self.buf.split(b"\n")
        for line in lines:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if obj.get("done"):
                self.final = obj
                continue
            msg = obj.get("message") or {}
            if msg.get("content") or msg.get("thinking") or obj.get("response") or obj.get("thinking"):
                self.tokens += 1
                if self.first is None:
                    self.first = time.time()
        if time.time() - self.last_live > 0.3:
            self.last_live = time.time()
            self.meter.live(self.live_state())

    def finish(self, status="ok"):
        if self.buf.strip():
            self.feed(b"\n")
        f = self.final or {}
        ms = lambda k: round(f[k] / 1e6) if f.get(k) is not None else None
        out_tokens = f.get("eval_count", self.tokens)
        eval_ms = ms("eval_duration")
        prompt_ms = ms("prompt_eval_duration")
        rec = {
            "ts": now_iso(), "status": status if self.final or status != "ok" else "incomplete",
            "model": f.get("model", self.model), "endpoint": self.endpoint,
            "prompt_tokens": f.get("prompt_eval_count"), "cached_prompt_tokens": f.get("prompt_eval_cached_count"),
            "output_tokens": out_tokens, "load_ms": ms("load_duration"), "prompt_ms": prompt_ms,
            "eval_ms": eval_ms, "total_ms": ms("total_duration") or int((time.time() - self.t0) * 1000),
            "ttft_ms": int((self.first - self.t0) * 1000) if self.first else None,
            "tok_s": round(out_tokens / (eval_ms / 1000), 1) if eval_ms and out_tokens else None,
            "prompt_tok_s": round(f["prompt_eval_count"] / (prompt_ms / 1000), 1)
            if prompt_ms and f.get("prompt_eval_count") else None,
            "done_reason": f.get("done_reason"),
            "project": self.ctx.get("project"), "run": self.ctx.get("run"),
            "step": self.ctx.get("step"), "agent": self.ctx.get("agent"),
        }
        rec = {k: v for k, v in rec.items() if v is not None}
        self.meter.record(rec)
        live = self.live_state(active=False)
        live["last"] = rec
        self.meter.live(live)


def make_meter_handler(meter):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ai-meter"

        def log_message(self, fmt, *args):
            pass

        def do_GET(self): self.proxy()
        def do_POST(self): self.proxy()
        def do_DELETE(self): self.proxy()
        def do_HEAD(self): self.proxy()

        def proxy(self):
            if self.headers.get("Host", "") not in meter.hosts:
                self.send_error(403, "Host no permitido")
                return
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_HEADERS}
            up = meter.upstream
            headers["Host"] = up.netloc   # Origin se reenvía: Ollama sigue aplicando su control
            conn = http.client.HTTPConnection(up.hostname, up.port or 80, timeout=900)
            tracker = None
            t0 = time.time()
            try:
                conn.request(self.command, self.path, body, headers)
                resp = conn.getresponse()
                self.send_response(resp.status)
                for k, v in resp.getheaders():
                    if k.lower() not in HOP_HEADERS:
                        self.send_header(k, v)
                self.send_header("Connection", "close")   # HTTP/1.0: el cuerpo termina al cerrar
                self.end_headers()
                if self.command == "POST" and self.path in METERED and resp.status == 200:
                    model = ""
                    try:
                        model = json.loads(body or b"{}").get("model", "")
                    except ValueError:
                        pass
                    tracker = Tracker(meter, model, self.path, t0)
                while True:
                    chunk = resp.read1(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    if tracker:
                        tracker.feed(chunk)
                if tracker:
                    tracker.finish()
            except (BrokenPipeError, ConnectionResetError):
                if tracker:
                    tracker.finish("cancelled")   # el cliente cortó (Ctrl+C, timeout)
            except OSError as exc:
                if tracker:
                    tracker.finish("error")
                else:
                    try:
                        self.send_error(502, f"Ollama no responde: {exc}")
                    except OSError:
                        pass
            finally:
                conn.close()

    return Handler


def cmd_meter(args):
    ai_home, port, upstream = args[0], int(args[1]), args[2]
    meter = Meter(ai_home, port, upstream)
    meter.live({"active": False, "updated": int(time.time() * 1000)})
    server = ThreadingHTTPServer(("127.0.0.1", port), make_meter_handler(meter))
    server.daemon_threads = True
    sys.stderr.write(f"{now_iso()} medidor en 127.0.0.1:{port} -> {upstream}\n")
    server.serve_forever()


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


def token_stats(records):
    """Suma de peticiones del medidor: tokens de prompt/salida, tiempos y tokens/s medios."""
    st = {"requests": 0, "prompt": 0, "output": 0, "eval_ms": 0, "total_ms": 0}
    for r in records:
        st["requests"] += 1
        for key, field in (("prompt", "prompt_tokens"), ("output", "output_tokens"),
                           ("eval_ms", "eval_ms"), ("total_ms", "total_ms")):
            st[key] += r.get(field) or 0
    st["tok_s"] = round(st["output"] / (st["eval_ms"] / 1000), 1) if st["eval_ms"] else None
    return st


OPUS_FIELDS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "cost_usd")


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
    opus = {}
    agent = None
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
            for k in OPUS_FIELDS:
                if ev.get(k) is not None:
                    opus[k] = opus.get(k, 0) + ev[k]
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
        elif t == "agent_started":
            agent = {"status": "running", "started": ts, "tools": [], "notes": [],
                     **{k: ev.get(k) for k in ("agent", "label", "engine", "model", "task", "access") if ev.get(k) is not None}}
        elif t == "agent_tool" and agent is not None:
            agent["tools"].append({"ts": ts, "tool": ev.get("tool"), "target": ev.get("target")})
        elif t == "agent_note" and agent is not None:
            agent["notes"].append({"ts": ts, "text": ev.get("text")})
        elif t == "agent_done" and agent is not None:
            agent.update(status="done", finished=ts)
            for k in ("secs", "duration_ms", "turns"):
                if ev.get(k) is not None:
                    agent[k] = ev[k]
            for k in OPUS_FIELDS:
                if ev.get(k) is not None:
                    opus[k] = opus.get(k, 0) + ev[k]
        elif t == "agent_failed" and agent is not None:
            agent.update(status="failed", finished=ts, error=ev.get("error") or "falló")
        elif t == "review_started":
            review.update(status="running", started=ts)
        elif t == "review_done":
            review.update(status="done", finished=ts)
            for k in OPUS_FIELDS:
                if ev.get(k) is not None:
                    opus[k] = opus.get(k, 0) + ev[k]
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
    # Tokens del ejecutor (medidor) por paso y en total; los de Opus vienen de los eventos.
    tok = read_events(os.path.join(logs, name + ".tokens.jsonl"))
    for s in execu["steps"]:
        mine = [r for r in tok if r.get("step") == s["n"]]
        if mine:
            s["tokens"] = token_stats(mine)
    tokens = {"executor": token_stats(tok) if tok else None, "opus": opus or None}
    if agent is not None:
        try:
            with open(os.path.join(logs, name + ".result.md"), encoding="utf-8") as f:
                agent["result"] = f.read()
        except OSError:
            pass
        if not plan["title"]:
            plan["title"] = f"{agent.get('label') or agent.get('agent')}: {agent.get('task', '')}"[:120]
    return {"name": name, "plan": plan, "analysis": analysis, "exec": execu, "review": review,
            "tokens": tokens, "agent": agent, "events": len(events), "updated": run_mtime(pdir, name)}


def run_mtime(pdir, name):
    paths = glob.glob(os.path.join(pdir, ".ai", "logs", name + ".*"))
    paths.append(os.path.join(pdir, ".ai", "plans", name + ".md"))
    return max([os.path.getmtime(p) for p in paths if os.path.exists(p)] or [0])


def run_summary(pdir, name):
    st = run_state(pdir, name)
    if st.get("agent"):
        return {"name": name, "title": st["plan"]["title"] or name, "stage": "agent",
                "status": st["agent"]["status"], "updated": st["updated"]}
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
        if not p.endswith(".tokens.jsonl"):        # registro del medidor, no un plan
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
    commands = {"event": (cmd_event, 2), "plan-stream": (cmd_plan_stream, 2), "review-out": (cmd_review_out, 2),
                "context": (cmd_context, 1), "meter": (cmd_meter, 3), "serve": (cmd_serve, 2),
                "detect-verify": (cmd_detect_verify, 1)}
    if len(argv) < 1 or argv[0] not in commands or len(argv) - 1 < commands[argv[0]][1]:
        sys.stderr.write(__doc__)
        return 2
    func, _ = commands[argv[0]]
    return func(argv[1:]) or 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

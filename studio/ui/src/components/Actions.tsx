// Vista "Acciones" (Fase 3): lanzar plan/exec/review/chat desde la web, cola de trabajos y la
// terminal de cada trabajo (xterm.js interactivo: puedes responder preguntas y pulsar Ctrl+C).
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Ban, Brain, CircleCheck, CircleX, Clock, Cpu, Hammer, Loader2, MessagesSquare, Play, Power, ScanSearch,
  SquareTerminal } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import type { JobAction, JobRequest, JobStatus, JobSummary, Project } from "../../../shared/types.ts";
import { getModels } from "../api.ts";
import { duration } from "../format.ts";
import { Card, cx, Empty } from "./ui.tsx";

const ACTIONS: { key: JobAction; label: string; icon: ReactNode; help: string }[] = [
  { key: "plan", label: "Plan", icon: <Brain className="size-4" />, help: "Opus analiza el proyecto (solo lectura) y escribe un plan." },
  { key: "exec", label: "Ejecutar", icon: <Hammer className="size-4" />, help: "El modelo local implementa un plan paso a paso en una rama ai/…" },
  { key: "review", label: "Revisar", icon: <ScanSearch className="size-4" />, help: "Opus revisa el diff de la rama del agente." },
  { key: "chat", label: "Chat", icon: <MessagesSquare className="size-4" />, help: "Chat libre con el modelo local (Aider). Escribe /exit para salir." },
  { key: "use", label: "Modelo", icon: <Cpu className="size-4" />, help: "Cambia el modelo ejecutor (solo entre los ya descargados)." },
  { key: "up", label: "Encender", icon: <Power className="size-4" />, help: "ai up: Docker, Ollama, medidor y modelo en memoria." },
];

const STATUS: Record<JobStatus, { label: string; icon: ReactNode }> = {
  queued: { label: "en cola", icon: <Clock className="size-4 text-idle" /> },
  running: { label: "en curso", icon: <Loader2 className="size-4 animate-spin text-run motion-reduce:animate-none" /> },
  done: { label: "hecho", icon: <CircleCheck className="size-4 text-ok" /> },
  failed: { label: "falló", icon: <CircleX className="size-4 text-fail" /> },
  cancelled: { label: "cancelado", icon: <Ban className="size-4 text-fail" /> },
};

const inputCls = "w-full rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-accent";
const label = (text: string, child: ReactNode, hint?: string) => (
  <label className="flex flex-col gap-1 text-xs">
    <span className="font-medium text-muted">{text}</span>{child}{hint && <span className="text-[11px] text-muted">{hint}</span>}
  </label>
);

// --- Formulario ----------------------------------------------------------------
export function LaunchForm({ projects, project, run, onLaunch }: {
  projects: Project[]; project: string; run: string;
  onLaunch: (req: JobRequest) => Promise<void>;
}) {
  const [action, setAction] = useState<JobAction>("plan");
  const [proj, setProj] = useState(project);
  const [custom, setCustom] = useState("");
  const [task, setTask] = useState("");
  const [plan, setPlan] = useState(run);
  const [from, setFrom] = useState("");
  const [interactive, setInteractive] = useState(false);
  const [models, setModels] = useState<{ installed: string[]; executor: string } | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (project) setProj(project); }, [project]);
  useEffect(() => { setPlan(run); }, [run]);
  useEffect(() => {
    if (action === "use" && !models) getModels().then((m) => { setModels(m); setModel(m.executor); }).catch((e) => setError(String(e.message)));
  }, [action, models]);

  const target = proj === "__custom" ? custom.trim() : proj;
  const runs = projects.find((p) => p.dir === proj)?.runs ?? [];
  const needsProject = action !== "use" && action !== "up";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const req: JobRequest = { action };
    if (needsProject) req.project = target;
    if (action === "plan") req.task = task;
    if (action === "exec") {
      if (plan && proj !== "__custom") req.plan = plan;
      if (interactive) req.interactive = true;
      else if (from) req.from = Number(from);
    }
    if (action === "use") req.model = model;
    setBusy(true);
    try {
      await onLaunch(req);
      if (action === "plan") setTask("");
      setFrom("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Lanzar" icon={<Play className="size-4 text-muted" />}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-panel-2 p-1" role="radiogroup" aria-label="Acción">
          {ACTIONS.map((a) => (
            <button key={a.key} type="button" role="radio" aria-checked={action === a.key} onClick={() => setAction(a.key)}
              className={cx("flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs",
                action === a.key ? "bg-panel font-semibold text-fg shadow-sm" : "text-muted hover:text-fg")}>
              {a.icon}{a.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{ACTIONS.find((a) => a.key === action)?.help}</p>

        {needsProject && label("Proyecto", (
          <>
            <select className={inputCls} value={proj} onChange={(e) => setProj(e.target.value)}>
              {projects.map((p) => <option key={p.dir} value={p.dir}>{p.name}</option>)}
              <option value="__custom">Otra carpeta…</option>
            </select>
            {proj === "__custom" && (
              <input className={inputCls} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="personal/mi-app" autoFocus />
            )}
          </>
        ), proj === "__custom" ? "Ruta dentro de PROJECTS_ROOT (config.env), p. ej. personal/mi-app." : undefined)}

        {action === "plan" && label("Tarea", (
          <textarea className={cx(inputCls, "min-h-28 resize-y")} value={task} onChange={(e) => setTask(e.target.value)}
            placeholder='p. ej. "añadir endpoint GET /tasks con paginación"' maxLength={4000} required />
        ), "Cuanto más concreta, mejor plan.")}

        {action === "exec" && (
          <>
            {proj !== "__custom" && label("Plan", (
              <select className={inputCls} value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="">El más reciente</option>
                {runs.map((r) => <option key={r.name} value={r.name}>{r.title}</option>)}
              </select>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {label("Desde el paso", (
                <input className={inputCls} type="number" min={1} max={999} value={from} disabled={interactive}
                  onChange={(e) => setFrom(e.target.value)} placeholder="1" />
              ))}
              <label className="flex items-end gap-2 pb-2 text-xs">
                <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} />
                <span>Modo chat (-i)</span>
              </label>
            </div>
          </>
        )}

        {action === "use" && label("Modelo ejecutor", (
          <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} disabled={!models}>
            {models?.installed.map((m) => <option key={m} value={m}>{m}{m === models.executor ? " (actual)" : ""}</option>)}
          </select>
        ), "Para descargar otro modelo usa ai pull en la terminal.")}

        {error && <p className="rounded-md border border-fail bg-fail-bg px-2.5 py-1.5 text-xs text-fail">{error}</p>}
        <button type="submit" disabled={busy || (needsProject && !target)}
          className="flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Lanzar
        </button>
        <p className="text-[11px] text-muted">Los trabajos van de uno en uno. Lo mismo queda registrado que si lo lanzaras desde la terminal.</p>
      </form>
    </Card>
  );
}

// --- Cola ------------------------------------------------------------------------
export function JobsList({ jobs, selected, onSelect, onCancel }: {
  jobs: JobSummary[]; selected: string | null; onSelect: (id: string) => void; onCancel: (id: string) => void;
}) {
  const ordered = [...jobs].reverse();
  return (
    <Card title="Trabajos" icon={<Clock className="size-4 text-muted" />}>
      {ordered.length === 0 ? <Empty>Todavía no has lanzado nada desde aquí.</Empty> : (
        <ul className="flex flex-col gap-1">
          {ordered.map((j) => {
            const secs = j.started ? ((j.finished ?? Date.now()) - j.started) / 1000 : null;
            const live = j.status === "queued" || j.status === "running";
            return (
              <li key={j.id}>
                <div className={cx("grid grid-cols-[20px_1fr_auto] items-center gap-2 rounded-lg p-2",
                  j.id === selected ? "bg-panel-2 outline outline-1 outline-accent/70" : "hover:bg-panel-2")}>
                  <span title={STATUS[j.status].label}>{STATUS[j.status].icon}</span>
                  <button className="min-w-0 text-left" onClick={() => onSelect(j.id)}>
                    <div className="truncate text-[13px] font-medium">{j.label}</div>
                    <div className="text-[11px] text-muted tabular-nums">
                      {j.cancelling ? "cancelando…" : STATUS[j.status].label}{secs != null ? ` · ${duration(secs)}` : ""}
                      {j.exitCode != null && j.exitCode !== 0 ? ` · código ${j.exitCode}` : ""}
                    </div>
                  </button>
                  {live && !j.cancelling && (
                    <button onClick={() => onCancel(j.id)} className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:border-fail hover:text-fail">
                      {j.status === "queued" ? "Quitar" : "Cancelar"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// --- Terminal del trabajo ------------------------------------------------------------
export interface JobTerminalHandle { write: (reset: boolean, bytes: Uint8Array) => void }

export function JobTerminal({ ref, job, onInput, onResize }: {
  ref: Ref<JobTerminalHandle>; job: JobSummary | null;
  onInput: (data: string) => void; onResize: (cols: number, rows: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  inputRef.current = onInput;
  resizeRef.current = onResize;

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const t = new XTerm({
      cursorBlink: true, scrollback: 10000, fontSize: 12, convertEol: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: css.getPropertyValue("--term").trim() || "#05080c" },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(box.current!);
    f.fit();
    t.onData((d) => inputRef.current(d));
    t.onResize(({ cols, rows }) => resizeRef.current(cols, rows));
    const ro = new ResizeObserver(() => f.fit());
    ro.observe(box.current!);
    term.current = t;
    fit.current = f;
    return () => { ro.disconnect(); t.dispose(); };
  }, []);

  // Al cambiar de trabajo: limpia y avisa del tamaño (la repetición llega por job_output).
  useEffect(() => {
    term.current?.reset();
    if (job && term.current) {
      resizeRef.current(term.current.cols, term.current.rows);
      if (job.status === "running") term.current.focus();
    }
  }, [job?.id]);

  useImperativeHandle(ref, () => ({
    write(reset, bytes) {
      if (reset) term.current?.reset();
      if (bytes.length) term.current?.write(bytes);
    },
  }), []);

  const running = job?.status === "running";
  return (
    <Card title={job ? job.label : "Terminal"} icon={<SquareTerminal className="size-4 text-muted" />}
      actions={job && <span className="text-xs text-muted">{running ? (job.interactive ? "escribe aquí · Ctrl+C para cortar" : "en curso · puedes responder preguntas") : STATUS[job.status].label}</span>}
      bodyClassName="p-0">
      <div className="relative">
        <div ref={box} className="h-[66vh] min-h-[360px] overflow-hidden rounded-b-xl bg-term" onClick={() => term.current?.focus()} />
        {!job && <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted">Lanza una acción o elige un trabajo de la lista.</div>}
      </div>
    </Card>
  );
}

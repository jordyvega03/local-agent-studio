// Canal en vivo (/ws). El cliente se suscribe a un proyecto + plan (+ paso) y el servidor
// empuja solo lo que cambia: estado del plan (1 s), bytes nuevos de la terminal grabada
// (1 s), proyectos (5 s) y sistema (3 s). Las métricas (metrics.ts) llegan con su propio
// ritmo (STUDIO_METRICS_INTERVAL_MS) a todos los clientes.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { WebSocket } from "ws";
import type { Config } from "./config.ts";
import type { Jobs } from "./jobs.ts";
import type { Metrics } from "./metrics.ts";
import { listProjects, registeredProjects, RUN_NAME, runState, stepLogPath } from "./runs.ts";
import { systemState } from "./system.ts";
import { readTokens } from "./tokens.ts";
import type { ClientMessage, JobSummary, MetricsNow, RunState, ServerMessage } from "../shared/types.ts";

const TAIL_BYTES = 256 * 1024;     // al abrir un paso se manda como mucho esto
const CHUNK_BYTES = 512 * 1024;    // tope por envío

interface Sub { project: string; run: string; step: number | null }
interface LogCursor { path: string; step: number; offset: number }

/** Paso que se muestra si el usuario no fija uno: el actual, si no el último con salida. */
export function defaultStep(st: RunState): number | null {
  return st.exec.current ?? st.exec.logs.at(-1) ?? st.exec.steps[0]?.n ?? null;
}

function readFrom(path: string, offset: number, max: number): { buf: Buffer; size: number } | null {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    if (offset >= size) return { buf: Buffer.alloc(0), size };
    const len = Math.min(size - offset, max);
    const buf = Buffer.alloc(len);
    fd = openSync(path, "r");
    readSync(fd, buf, 0, len, offset);
    return { buf, size };
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Primer offset a mostrar: los últimos TAIL_BYTES, empezando en una línea completa. */
function startOffset(path: string): number {
  let size = 0;
  try { size = statSync(path).size; } catch { return 0; }
  if (size <= TAIL_BYTES) return 0;
  const head = readFrom(path, size - TAIL_BYTES, 4096);
  const nl = head ? head.buf.indexOf(0x0a) : -1;
  return size - TAIL_BYTES + (nl >= 0 ? nl + 1 : 0);
}

const MAX_INPUT = 4096;   // teclas por mensaje hacia la terminal de un trabajo

function parseMessage(raw: string): ClientMessage | null {
  try {
    const m = JSON.parse(raw);
    switch (m?.type) {
      case "subscribe": {
        if (typeof m.project !== "string" || typeof m.run !== "string") return null;
        const step = m.step == null ? null : Number(m.step);
        if (step !== null && !(Number.isInteger(step) && step > 0 && step < 1000)) return null;
        return { type: "subscribe", project: m.project, run: m.run, step };
      }
      case "job_attach":
        return m.id === null || typeof m.id === "string" ? { type: "job_attach", id: m.id } : null;
      case "job_input":
        return typeof m.id === "string" && typeof m.data === "string" && m.data.length <= MAX_INPUT
          ? { type: "job_input", id: m.id, data: m.data } : null;
      case "job_resize":
        return typeof m.id === "string" && Number.isInteger(m.cols) && Number.isInteger(m.rows)
          ? { type: "job_resize", id: m.id, cols: m.cols, rows: m.rows } : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function handleSocket(socket: WebSocket, cfg: Config, metrics: Metrics, jobs: Jobs) {
  let sub: Sub | null = null;
  let cursor: LogCursor | null = null;
  const last = { run: "", projects: "", system: "", tokens: "" };

  const send = (m: ServerMessage) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m)); };
  const sendIfChanged = (key: keyof typeof last, m: ServerMessage) => {
    const json = JSON.stringify(m);
    if (json !== last[key] && socket.readyState === socket.OPEN) { last[key] = json; socket.send(json); }
  };

  const tickRun = () => {
    if (!sub?.run) return;
    const st = runState(sub.project, sub.run);
    sendIfChanged("run", { type: "run", data: st });

    const step = sub.step ?? defaultStep(st);
    if (step == null) return;
    const path = stepLogPath(sub.project, sub.run, step);
    let reset = false;
    if (!cursor || cursor.path !== path) {
      cursor = { path, step, offset: startOffset(path) };
      reset = true;
    }
    const got = readFrom(path, cursor.offset, CHUNK_BYTES);
    if (got && got.size < cursor.offset) {           // el archivo se reescribió (paso relanzado)
      cursor.offset = startOffset(path);
      reset = true;
      return tickRun();
    }
    if (reset || (got && got.buf.length)) {
      send({ type: "log", step, reset, chunk: got ? got.buf.toString("base64") : "" });
      if (got) cursor.offset += got.buf.length;
    }
  };
  const tickProjects = () => sendIfChanged("projects", { type: "projects", data: listProjects(cfg.aiHome) });
  const tickSystem = async () => sendIfChanged("system", { type: "system", data: await systemState(cfg) });
  const tickTokens = () => sendIfChanged("tokens", { type: "tokens", data: readTokens(cfg) });

  // Trabajos: lista al cambiar y la terminal del trabajo que esté mirando este cliente.
  let attached: string | null = null;
  const onJobs = (data: JobSummary[]) => send({ type: "jobs", data });
  const onOutput = (id: string, chunk: Buffer) => {
    if (id === attached) send({ type: "job_output", id, reset: false, chunk: chunk.toString("base64") });
  };
  jobs.on("update", onJobs);
  jobs.on("output", onOutput);
  send({ type: "jobs", data: jobs.list() });

  socket.on("message", (raw) => {
    const m = parseMessage(String(raw));
    if (!m) return send({ type: "error", message: "mensaje no válido" });
    if (m.type === "job_attach") {
      attached = m.id;
      const replay = m.id ? jobs.replay(m.id) : null;
      if (m.id && replay) send({ type: "job_output", id: m.id, reset: true, chunk: replay.toString("base64") });
      return;
    }
    if (m.type === "job_input") return jobs.input(m.id, m.data);
    if (m.type === "job_resize") return jobs.resize(m.id, m.cols, m.rows);
    // Solo proyectos registrados por bin/ai y nombres de plan sin rutas.
    if (m.run && (!registeredProjects(cfg.aiHome).includes(m.project) || !RUN_NAME.test(m.run))) {
      return send({ type: "error", message: "proyecto o plan no válido" });
    }
    sub = { project: m.project, run: m.run, step: m.step };
    cursor = null;
    last.run = "";
    tickRun();
  });

  const timers = [
    setInterval(tickRun, 1000),
    setInterval(tickProjects, 5000),
    setInterval(() => void tickSystem(), 3000),
    setInterval(tickTokens, 1000),
  ];
  // Métricas: el histórico al conectar y luego cada muestra del recolector compartido.
  const onSample = (data: MetricsNow) => send({ type: "metrics", data });
  metrics.on("sample", onSample);
  send({ type: "metrics_history", data: metrics.snapshot() });

  socket.on("close", () => {
    timers.forEach(clearInterval);
    metrics.off("sample", onSample);
    jobs.off("update", onJobs);
    jobs.off("output", onOutput);
  });
  tickProjects();
  tickTokens();
  void tickSystem();
}

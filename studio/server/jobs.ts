// Cola de trabajos lanzados desde la web (Fase 3). Cada trabajo es `bin/ai <argumentos>`
// dentro de una terminal real (node-pty), igual que si lo escribieras tú: colores, preguntas
// [s/N] y Ctrl+C funcionan. Se ejecutan de uno en uno (un solo modelo en memoria).
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { spawn, type IPty } from "node-pty";
import type { BuiltAction } from "./actions.ts";
import type { Config } from "./config.ts";
import type { JobSummary } from "../shared/types.ts";

const CANCEL_TERM_MS = 8_000;    // tras Ctrl+C, SIGTERM si sigue vivo
const CANCEL_KILL_MS = 15_000;   // y SIGKILL si aun así no termina

interface Job extends JobSummary {
  pty?: IPty;
  out: Buffer[];
  outSize: number;
  cols: number;
  rows: number;
}

/** npm 11 no ejecuta los scripts de instalación de node-pty, que dejan spawn-helper sin +x. */
export function ensurePtyHelper() {
  const pkg = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
  const helper = join(pkg, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755);
}

export class Jobs extends EventEmitter {
  private jobs: Job[] = [];
  private readonly cfg: Config;
  private readonly bufferMax: number;

  constructor(cfg: Config) {
    super();
    this.cfg = cfg;
    this.bufferMax = cfg.jobBufferKb * 1024;
    this.setMaxListeners(100);
    ensurePtyHelper();
  }

  list(): JobSummary[] {
    return this.jobs.map(({ pty: _p, out: _o, outSize: _s, cols: _c, rows: _r, ...summary }) => summary);
  }

  get(id: string): Job | undefined { return this.jobs.find((j) => j.id === id); }

  /** Salida guardada de un trabajo (para quien se conecta a mitad). */
  replay(id: string): Buffer | null {
    const job = this.get(id);
    return job ? Buffer.concat(job.out) : null;
  }

  enqueue(a: BuiltAction): JobSummary {
    const job: Job = {
      id: randomUUID(), action: a.action, label: a.label, project: a.project, argv: a.argv,
      interactive: a.interactive, status: "queued", created: Date.now(), out: [], outSize: 0, cols: 120, rows: 32,
    };
    this.jobs.push(job);
    // Historial acotado: se descartan los terminados más antiguos.
    const finished = this.jobs.filter((j) => j.status !== "queued" && j.status !== "running");
    while (finished.length > this.cfg.jobHistory) this.jobs.splice(this.jobs.indexOf(finished.shift()!), 1);
    this.audit("job_queued", job);
    this.changed();
    this.next();
    return this.list().find((j) => j.id === job.id)!;
  }

  input(id: string, data: string) {
    const job = this.get(id);
    if (job?.status === "running" && job.pty) job.pty.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const job = this.get(id);
    if (!job || !Number.isInteger(cols) || !Number.isInteger(rows)) return;
    job.cols = Math.min(Math.max(cols, 20), 400);
    job.rows = Math.min(Math.max(rows, 5), 200);
    if (job.status === "running") job.pty?.resize(job.cols, job.rows);
  }

  cancel(id: string): boolean {
    const job = this.get(id);
    if (!job) return false;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finished = Date.now();
      this.audit("job_cancelled", job);
      this.changed();
      return true;
    }
    if (job.status !== "running" || !job.pty || job.cancelling) return false;
    job.cancelling = true;
    // Como pulsar Ctrl+C: bin/ai registra la interrupción (exec_aborted) y limpia.
    job.pty.write("\x03");
    const pty = job.pty;
    setTimeout(() => { if (job.status === "running") pty.kill("SIGTERM"); }, CANCEL_TERM_MS);
    setTimeout(() => { if (job.status === "running") pty.kill("SIGKILL"); }, CANCEL_KILL_MS);
    this.audit("job_cancel_requested", job);
    this.changed();
    return true;
  }

  /** Al parar el Studio: Ctrl+C al trabajo en curso para que bin/ai deje todo registrado. */
  async shutdown() {
    const running = this.jobs.find((j) => j.status === "running");
    if (!running) return;
    this.cancel(running.id);
    await new Promise<void>((r) => {
      const t = setTimeout(r, 5000);
      this.once("finished", () => { clearTimeout(t); r(); });
    });
  }

  private next() {
    if (this.jobs.some((j) => j.status === "running")) return;
    const job = this.jobs.find((j) => j.status === "queued");
    if (!job) return;
    job.status = "running";
    job.started = Date.now();
    try {
      job.pty = spawn(join(this.cfg.aiHome, "bin", "ai"), job.argv, {
        name: "xterm-256color", cols: job.cols, rows: job.rows, cwd: this.cfg.aiHome,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", AI_STUDIO_JOB: job.id } as Record<string, string>,
      });
    } catch (err) {
      this.write(job, Buffer.from(`\r\nNo se pudo lanzar bin/ai: ${String(err)}\r\n`));
      this.finish(job, 127);
      return;
    }
    job.pty.onData((d) => this.write(job, Buffer.from(d, "utf8")));
    job.pty.onExit(({ exitCode }) => this.finish(job, exitCode));
    this.audit("job_started", job);
    this.changed();
  }

  private write(job: Job, chunk: Buffer) {
    job.out.push(chunk);
    job.outSize += chunk.length;
    while (job.outSize > this.bufferMax && job.out.length > 1) job.outSize -= job.out.shift()!.length;
    this.emit("output", job.id, chunk);
  }

  private finish(job: Job, exitCode: number) {
    job.exitCode = exitCode;
    job.finished = Date.now();
    job.status = job.cancelling ? "cancelled" : exitCode === 0 ? "done" : "failed";
    job.cancelling = undefined;      // ya terminó: deja de mostrarse "cancelando…"
    job.pty = undefined;
    this.audit("job_finished", job);
    this.emit("finished", job.id);
    this.changed();
    this.next();
  }

  private changed() { this.emit("update", this.list()); }

  private audit(event: string, job: Job) {
    const rec = {
      ts: new Date().toISOString(), event, id: job.id, action: job.action, project: job.project,
      // El texto de la tarea se recorta: la auditoría es para saber qué se lanzó, no un histórico.
      argv: job.argv.map((a) => (a.length > 200 ? a.slice(0, 199) + "…" : a)),
      status: job.status, exitCode: job.exitCode,
    };
    try { appendFileSync(join(this.cfg.aiHome, "logs", "studio-audit.jsonl"), JSON.stringify(rec) + "\n"); } catch { /* sin auditoría no se para nada */ }
  }
}

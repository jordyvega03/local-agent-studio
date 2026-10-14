// Lectura de planes y registros de proyecto/.ai/. Misma semántica que run_state() de
// lib/aiwatch.py (el panel ligero): si cambias una, cambia la otra. Los tests de
// runs.test.ts fijan el comportamiento.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { PlanStep, Project, RunState, RunSummary, Status } from "../shared/types.ts";

export const RUN_NAME = /^[A-Za-z0-9._-]+$/;
const STEP_RE = /^### Paso (\d+)\s*[:.\-—]?\s*(.*)$/;

type Event = Record<string, unknown> & { type?: string; ts?: string };

const plansDir = (p: string) => join(p, ".ai", "plans");
const logsDir = (p: string) => join(p, ".ai", "logs");

function readText(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function listDir(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

export function readEvents(path: string): Event[] {
  const text = readText(path);
  if (!text) return [];
  const out: Event[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* línea corrupta: se ignora */ }
  }
  return out;
}

/** Mismo criterio que split_steps en bin/ai: secciones '### Paso N' hasta el siguiente '## '. */
export function parsePlan(text: string): { title: string; text: string; steps: PlanStep[] } {
  const plan = { title: "", text, steps: [] as PlanStep[] };
  let current: PlanStep | null = null;
  for (const line of text.split("\n")) {
    if (!plan.title && line.startsWith("# ")) plan.title = line.replace(/^#\s*(Plan:\s*)?/, "").trim();
    const m = STEP_RE.exec(line);
    if (m) {
      current = { n: Number(m[1]), title: m[2].trim(), files: [], status: "pending" };
      plan.steps.push(current);
    } else if (line.startsWith("## ")) {
      current = null;
    } else if (current && current.files.length === 0 && line.toLowerCase().includes("archivo")) {
      current.files = [...line.matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((x) => !x.includes(" "));
    }
  }
  return plan;
}

const str = (v: unknown) => (v == null ? undefined : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : v == null ? undefined : Number(v));

export function runState(pdir: string, name: string): RunState {
  const planPath = join(plansDir(pdir), name + ".md");
  const planText = readText(planPath);
  const { steps: planSteps, ...plan } = parsePlan(planText ?? "");
  const events = readEvents(join(logsDir(pdir), name + ".jsonl"));

  const analysis: RunState["analysis"] = { status: planText != null ? "done" : "pending", tools: [], notes: [] };
  const exec: RunState["exec"] = { status: "pending", steps: planSteps, current: null, logs: [] };
  const review: RunState["review"] = { status: "pending" };
  const steps = new Map(exec.steps.map((s) => [s.n, s]));
  const step = (n: number) => {
    let s = steps.get(n);
    if (!s) { s = { n, title: "", files: [], status: "pending" }; steps.set(n, s); exec.steps.push(s); }
    return s;
  };

  for (const ev of events) {
    const ts = str(ev.ts);
    switch (ev.type) {
      case "plan_started":
        Object.assign(analysis, { status: "running", started: ts, task: str(ev.task), model: str(ev.model) });
        break;
      case "plan_tool":
        analysis.tools.push({ ts: ts ?? "", tool: str(ev.tool) ?? "?", target: str(ev.target) ?? "" });
        break;
      case "plan_note":
        analysis.notes.push({ ts: ts ?? "", text: str(ev.text) ?? "" });
        break;
      case "plan_done":
        Object.assign(analysis, { status: "done", finished: ts, turns: num(ev.turns), duration_ms: num(ev.duration_ms) });
        break;
      case "plan_failed":
      case "plan_aborted":
        Object.assign(analysis, { status: "failed", finished: ts, error: str(ev.error) ?? "interrumpido" });
        break;
      case "exec_started": {
        Object.assign(exec, { status: "running", started: ts, finished: null, mode: str(ev.mode),
          model: str(ev.model), branch: str(ev.branch), total: num(ev.total) });
        const first = num(ev.from) || 1;
        for (const s of exec.steps) {
          if (s.n >= first) { delete s.started; delete s.secs; delete s.commits; s.status = "pending"; }
        }
        break;
      }
      case "step_started": {
        const s = step(num(ev.n) ?? 0);
        s.status = "running"; s.started = ts;
        if (ev.title && !s.title) s.title = String(ev.title);
        break;
      }
      case "step_done": {
        const s = step(num(ev.n) ?? 0);
        s.status = "done"; s.secs = num(ev.secs);
        s.commits = String(ev.commits ?? "").split("\n").filter((c) => c.trim());
        break;
      }
      case "step_failed": {
        const s = step(num(ev.n) ?? 0);
        s.status = "failed"; s.secs = num(ev.secs);
        break;
      }
      case "exec_done":
        Object.assign(exec, { status: "done", finished: ts });
        break;
      case "exec_failed":
      case "exec_aborted":
        Object.assign(exec, { status: ev.type === "exec_failed" ? "failed" : "aborted", finished: ts });
        for (const s of exec.steps) if (s.status === "running") s.status = "aborted";
        break;
      case "review_started": Object.assign(review, { status: "running", started: ts }); break;
      case "review_done": Object.assign(review, { status: "done", finished: ts }); break;
      case "review_failed": Object.assign(review, { status: "failed", finished: ts }); break;
    }
  }

  exec.steps.sort((a, b) => a.n - b.n);
  exec.current = exec.steps.find((s) => s.status === "running")?.n ?? null;
  const stepLog = new RegExp(`^${escapeRe(name)}\\.step-(\\d+)\\.log$`);
  exec.logs = listDir(logsDir(pdir)).map((f) => stepLog.exec(f)).filter((m) => m !== null)
    .map((m) => Number(m[1])).sort((a, b) => a - b);
  const reviewText = readText(join(logsDir(pdir), name + ".review.md"));
  if (reviewText != null) review.text = reviewText;

  return { name, plan, analysis, exec, review, events: events.length, updated: runMtime(pdir, name) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function runMtime(pdir: string, name: string): number {
  const paths = listDir(logsDir(pdir)).filter((f) => f.startsWith(name + ".")).map((f) => join(logsDir(pdir), f));
  paths.push(join(plansDir(pdir), name + ".md"));
  let max = 0;
  for (const p of paths) {
    try { max = Math.max(max, statSync(p).mtimeMs / 1000); } catch { /* no existe */ }
  }
  return max;
}

export function runSummary(pdir: string, name: string): RunSummary {
  const st = runState(pdir, name);
  let stage: RunSummary["stage"] = "analysis";
  let status: Status = st.analysis.status;
  if (st.exec.status !== "pending") { stage = "exec"; status = st.exec.status; }
  if (st.review.status !== "pending") { stage = "review"; status = st.review.status; }
  return { name, title: st.plan.title || name, stage, status, updated: st.updated };
}

export function listRuns(pdir: string): RunSummary[] {
  const names = new Set<string>();
  for (const f of listDir(plansDir(pdir))) if (f.endsWith(".md")) names.add(f.slice(0, -3));
  for (const f of listDir(logsDir(pdir))) if (f.endsWith(".jsonl")) names.add(f.slice(0, -6));
  return [...names].filter((n) => RUN_NAME.test(n)).map((n) => runSummary(pdir, n))
    .sort((a, b) => b.updated - a.updated);
}

/** Proyectos que registró bin/ai (run/projects). Solo estos se pueden consultar. */
export function registeredProjects(aiHome: string): string[] {
  const text = readText(join(aiHome, "run", "projects")) ?? "";
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const d = line.trim();
    if (d && !seen.has(d) && existsSync(d) && statSync(d).isDirectory()) seen.add(d);
  }
  return [...seen];
}

export function listProjects(aiHome: string): Project[] {
  return registeredProjects(aiHome).map((dir) => ({ dir, name: basename(dir), runs: listRuns(dir).slice(0, 40) }));
}

export function stepLogPath(pdir: string, name: string, step: number): string {
  return join(logsDir(pdir), `${name}.step-${String(step).padStart(3, "0")}.log`);
}

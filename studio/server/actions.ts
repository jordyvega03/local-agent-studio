// Acciones que la web puede lanzar (Fase 3). Lista CERRADA: cada acción se traduce a unos
// argumentos fijos de bin/ai, con cada valor validado. Nunca se ejecuta un comando libre ni
// se pasa nada por un shell (node-pty recibe el argv tal cual). Ver docs/SECURITY.md.
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { listAgents } from "./agents.ts";
import type { Config } from "./config.ts";
import { listFlows } from "./flows.ts";
import { RUN_NAME } from "./runs.ts";
import type { JobAction, JobRequest } from "../shared/types.ts";

export class ActionError extends Error {}

export interface BuiltAction {
  action: JobAction;
  argv: string[];          // argumentos de bin/ai
  label: string;           // texto para la cola
  project?: string;        // carpeta del proyecto (real)
  interactive: boolean;    // espera que escribas (chat, exec -i)
}

const MAX_TASK = 4000;
// Lo mismo que assert_safe_mount en bin/ai: nunca carpetas personales completas o sensibles.
const FORBIDDEN = [".ssh", ".aws", ".config", ".gnupg", "Library"].map((d) => join(homedir(), d));

/** Resuelve un proyecto: ruta absoluta o relativa a PROJECTS_ROOT; debe quedar DENTRO de ella. */
export function resolveProject(input: unknown, cfg: Config): string {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")) throw new ActionError("Falta el proyecto.");
  const root = realpathSync(cfg.projectsRoot);
  const candidate = isAbsolute(input) ? input : resolve(root, input);
  if (!existsSync(candidate)) throw new ActionError(`No existe la carpeta: ${input}`);
  const real = realpathSync(candidate);                 // sigue enlaces simbólicos
  if (!statSync(real).isDirectory()) throw new ActionError("El proyecto debe ser una carpeta.");
  if (real === root || !real.startsWith(root + sep)) {
    throw new ActionError(`El proyecto debe estar dentro de ${cfg.projectsRoot} (PROJECTS_ROOT) y no ser la raíz.`);
  }
  if (real === homedir() || FORBIDDEN.some((f) => real === f || real.startsWith(f + sep))) {
    throw new ActionError("Por seguridad no se usa esa carpeta.");
  }
  return real;
}

function planArg(project: string, plan: unknown): string | null {
  if (plan == null || plan === "") return null;
  if (typeof plan !== "string" || !RUN_NAME.test(plan)) throw new ActionError("Nombre de plan no válido.");
  const rel = `.ai/plans/${plan}.md`;
  if (!existsSync(join(project, rel))) throw new ActionError(`No existe el plan ${plan}.`);
  return rel;
}

function cleanTask(task: unknown): string {
  if (typeof task !== "string") throw new ActionError("Falta la tarea.");
  const t = task.trim();
  if (t.length < 3) throw new ActionError("La tarea es demasiado corta.");
  if (t.length > MAX_TASK) throw new ActionError(`La tarea pasa de ${MAX_TASK} caracteres.`);
  // Sin caracteres de control (salvo saltos de línea y tabuladores).
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(t)) throw new ActionError("La tarea tiene caracteres no válidos.");
  return t;
}

const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const base = (p: string) => p.split(sep).filter(Boolean).at(-1) ?? p;

/** Traduce una petición de la web a argumentos de bin/ai, o lanza ActionError. */
export function buildAction(req: JobRequest, cfg: Config, installedModels: string[]): BuiltAction {
  switch (req.action) {
    case "plan": {
      const project = resolveProject(req.project, cfg);
      const task = cleanTask(req.task);
      return { action: "plan", argv: ["plan", project, task], label: `Plan: ${short(task)}`, project, interactive: false };
    }
    case "exec": {
      const project = resolveProject(req.project, cfg);
      const argv = ["exec", project];
      const plan = planArg(project, req.plan);
      if (plan) argv.push(plan);
      if (req.interactive) argv.push("-i");
      else if (req.from != null) {
        if (!Number.isInteger(req.from) || req.from < 1 || req.from > 999) throw new ActionError("Paso inicial no válido.");
        argv.push("--from", String(req.from));
      }
      const what = req.interactive ? "Chat con el plan" : req.from && req.from > 1 ? `Reanudar desde el paso ${req.from}` : "Ejecutar plan";
      return { action: "exec", argv, label: `${what} · ${base(project)}`, project, interactive: !!req.interactive };
    }
    case "review": {
      const project = resolveProject(req.project, cfg);
      return { action: "review", argv: ["review", project], label: `Revisar · ${base(project)}`, project, interactive: false };
    }
    case "chat": {
      const project = resolveProject(req.project, cfg);
      return { action: "chat", argv: ["chat", project], label: `Chat · ${base(project)}`, project, interactive: true };
    }
    case "use": {
      // Solo modelos ya descargados: `ai use` descargaría uno nuevo (varios GB) sin preguntar.
      if (typeof req.model !== "string" || !installedModels.includes(req.model)) throw new ActionError("Ese modelo no está descargado.");
      return { action: "use", argv: ["use", req.model], label: `Cambiar ejecutor a ${req.model}`, interactive: false };
    }
    case "agent": {
      const agent = listAgents(cfg).find((a) => a.id === req.agent);
      if (!agent) throw new ActionError("Ese agente no existe.");
      const project = resolveProject(req.project, cfg);
      const task = cleanTask(req.task);
      return { action: "agent", argv: ["agent", agent.id, project, task], label: `${agent.name}: ${short(task, 50)}`, project, interactive: false };
    }
    case "flow": {
      const flow = listFlows(cfg).find((f) => f.id === req.flow);
      if (!flow) throw new ActionError("Ese flujo no existe.");
      const project = resolveProject(req.project, cfg);
      const task = cleanTask(req.task);
      const argv = ["flow", flow.id, project, task];
      if (req.autoApprove) argv.push("--yes");
      // Interactivo: el flujo puede pararse a pedir aprobación (también se aprueba con el botón).
      return { action: "flow", argv, label: `Flujo ${flow.name}: ${short(task, 45)}`, project, interactive: flow.approve.length > 0 && !req.autoApprove };
    }
    case "context": {
      const project = resolveProject(req.project, cfg);
      return { action: "context", argv: ["context", project, req.force ? "--force" : "--init"],
        label: `Contexto con Opus · ${base(project)}`, project, interactive: false };
    }
    case "up":
      return { action: "up", argv: ["up"], label: "Encender (ai up)", interactive: false };
    default:
      // down/stop no: apagarían también este Studio. Cualquier otra cosa, tampoco.
      throw new ActionError("Acción no permitida.");
  }
}

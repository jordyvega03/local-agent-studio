// Agentes (Fase 4): agents/<id>.env + prompts/agents/<id>.md. El Studio los lista, crea y
// edita. bin/ai lee estos archivos SIN ejecutarlos (agent_field), y aquí se escriben con un
// formato fijo CLAVE='valor' y valores sin comillas ni saltos de línea: así ningún texto
// de la web puede convertirse en código. Ver agents/README.md y docs/SECURITY.md.
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { AgentDef } from "../shared/types.ts";

export const AGENT_ID = /^[a-z][a-z0-9-]{1,30}$/;
const CLAUDE_MODEL = /^(opus|sonnet|haiku|claude-[a-z0-9.-]+)$/;
// Sin comillas, acento grave, $, \, # ni caracteres de control: el valor va entre comillas simples.
const SAFE_VALUE = /^[^'"`$\\#\u0000-\u001f\u007f]*$/;
const MAX_PROMPT = 20_000;

export class AgentError extends Error {}

const agentsDir = (cfg: Config) => join(cfg.aiHome, "agents");
const promptPath = (cfg: Config, id: string) => join(cfg.aiHome, "prompts", "agents", `${id}.md`);

/** Igual que agent_field en bin/ai: CLAVE='valor' o CLAVE="valor", con comentario opcional. */
export function envField(text: string, key: string): string {
  const re = new RegExp(`^${key}=['"]?([^'"]*)['"]?\\s*(#.*)?$`, "m");
  return re.exec(text)?.[1] ?? "";
}

function readAgent(cfg: Config, id: string): AgentDef | null {
  let env: string;
  try { env = readFileSync(join(agentsDir(cfg), `${id}.env`), "utf8"); } catch { return null; }
  let prompt = "";
  try { prompt = readFileSync(promptPath(cfg, id), "utf8"); } catch { /* sin prompt: bin/ai avisará */ }
  const engine = envField(env, "AGENT_ENGINE") === "claude" ? "claude" : "aider";
  return {
    id,
    name: envField(env, "AGENT_NAME") || id,
    description: envField(env, "AGENT_DESCRIPTION"),
    engine,
    model: envField(env, "AGENT_MODEL"),
    access: envField(env, "AGENT_ACCESS") === "read" ? "read" : "write",
    verify: envField(env, "AGENT_VERIFY"),
    input: envField(env, "AGENT_INPUT") === "diff" ? "diff" : "",
    prompt,
  };
}

export function listAgents(cfg: Config): AgentDef[] {
  let files: string[] = [];
  try { files = readdirSync(agentsDir(cfg)); } catch { /* sin carpeta */ }
  return files.filter((f) => f.endsWith(".env")).map((f) => f.slice(0, -4)).filter((id) => AGENT_ID.test(id))
    .map((id) => readAgent(cfg, id)).filter((a): a is AgentDef => a !== null).sort((a, b) => a.id.localeCompare(b.id));
}

function text(v: unknown, field: string, max: number, required = false): string {
  if (typeof v !== "string") throw new AgentError(`Falta ${field}.`);
  const t = v.trim();
  if (required && !t) throw new AgentError(`Falta ${field}.`);
  if (t.length > max) throw new AgentError(`${field}: máximo ${max} caracteres.`);
  if (!SAFE_VALUE.test(t)) throw new AgentError(`${field} no puede llevar comillas, $, \\, # ni saltos de línea.`);
  return t;
}

/** Valida una definición recibida de la web. Lanza AgentError con un mensaje claro. */
export function validateAgent(raw: Partial<AgentDef>, installedModels: string[]): AgentDef {
  if (typeof raw.id !== "string" || !AGENT_ID.test(raw.id)) {
    throw new AgentError("El id debe empezar por letra y tener solo minúsculas, números y guiones (2-31).");
  }
  const engine = raw.engine;
  if (engine !== "aider" && engine !== "claude") throw new AgentError("El motor debe ser aider o claude.");
  const access = raw.access;
  if (access !== "read" && access !== "write") throw new AgentError("El acceso debe ser read o write.");
  // Claude Code corre en el Mac, fuera del contenedor: nunca con permiso de escritura.
  if (engine === "claude" && access !== "read") throw new AgentError("Un agente con motor claude solo puede ser de lectura.");
  const model = text(raw.model ?? "", "El modelo", 80);
  if (model && engine === "aider" && !installedModels.includes(model)) throw new AgentError(`El modelo ${model} no está descargado en Ollama.`);
  if (model && engine === "claude" && !CLAUDE_MODEL.test(model)) throw new AgentError("Modelo de Claude no válido (opus, sonnet, haiku o claude-…).");
  const verify = text(raw.verify ?? "", "La verificación", 300);
  if (verify && engine === "claude") throw new AgentError("La verificación solo existe para agentes aider (corre en el contenedor).");
  const input = raw.input ?? "";
  if (input !== "" && input !== "diff") throw new AgentError("La entrada debe ser vacía o diff.");
  if (input === "diff" && engine !== "claude") throw new AgentError("La entrada diff solo existe para agentes claude.");
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length < 10) throw new AgentError("Las instrucciones son demasiado cortas.");
  if (raw.prompt.length > MAX_PROMPT || raw.prompt.includes("\0")) throw new AgentError(`Instrucciones: máximo ${MAX_PROMPT} caracteres.`);
  return {
    id: raw.id, engine, access, model, verify, input,
    name: text(raw.name, "El nombre", 40, true),
    description: text(raw.description ?? "", "La descripción", 200),
    prompt: raw.prompt.trim() + "\n",
  };
}

function writeAtomic(path: string, content: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function saveAgent(cfg: Config, def: AgentDef, mode: "create" | "update") {
  const envPath = join(agentsDir(cfg), `${def.id}.env`);
  const exists = existsSync(envPath);
  if (mode === "create" && exists) throw new AgentError(`Ya existe un agente con id ${def.id}.`);
  if (mode === "update" && !exists) throw new AgentError(`No existe el agente ${def.id}.`);
  const env = [
    `# Agente ${def.name} (escrito por AI Studio). Formato: agents/README.md`,
    `AGENT_NAME='${def.name}'`,
    `AGENT_DESCRIPTION='${def.description}'`,
    `AGENT_ENGINE='${def.engine}'`,
    `AGENT_MODEL='${def.model}'`,
    `AGENT_ACCESS='${def.access}'`,
    `AGENT_VERIFY='${def.verify}'`,
    `AGENT_INPUT='${def.input}'`,
    "",
  ].join("\n");
  writeAtomic(envPath, env);
  writeAtomic(promptPath(cfg, def.id), def.prompt);
}

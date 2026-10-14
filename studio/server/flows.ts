// Flujos (Fase 5): flows/<id>.env. El Studio los lista y los lanza; se editan como archivos
// (formato en flows/README.md). Se leen sin ejecutar, igual que los agentes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ID, envField } from "./agents.ts";
import type { Config } from "./config.ts";
import type { FlowDef } from "../shared/types.ts";

export function listFlows(cfg: Config): FlowDef[] {
  const dir = join(cfg.aiHome, "flows");
  let files: string[] = [];
  try { files = readdirSync(dir); } catch { /* sin flujos */ }
  return files.filter((f) => f.endsWith(".env")).map((f) => f.slice(0, -4)).filter((id) => AGENT_ID.test(id)).map((id) => {
    const env = readFileSync(join(dir, `${id}.env`), "utf8");
    const list = (k: string) => envField(env, k).split(/\s+/).filter(Boolean);
    return {
      id, name: envField(env, "FLOW_NAME") || id, description: envField(env, "FLOW_DESCRIPTION"),
      steps: list("FLOW_STEPS"), approve: list("FLOW_APPROVE_AFTER"),
      retries: Number(envField(env, "FLOW_MAX_RETRIES")) || 0, fix: envField(env, "FLOW_FIX_AGENT") || "coder",
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

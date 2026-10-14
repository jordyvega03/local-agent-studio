// Estado del sistema: modelo cargado en Ollama, contenedores del agente y memoria del Mac.
// Fase 1 (docs/PLAN-STUDIO.md) ampliará esto con CPU, GPU y series temporales.
import { execFile } from "node:child_process";
import type { Config } from "./config.ts";
import type { SystemState } from "../shared/types.ts";

function run(cmd: string, args: string[], timeout = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? null : stdout));
  });
}

async function ollamaModels(url: string): Promise<SystemState["models"] | null> {
  try {
    const r = await fetch(url + "/api/ps", { signal: AbortSignal.timeout(1500) });
    const ps = (await r.json()) as { models?: Record<string, unknown>[] };
    return (ps.models ?? []).map((m) => {
      const size = Number(m.size) || 0;
      return {
        name: String(m.name), size,
        gpu: size ? Math.round((100 * (Number(m.size_vram) || 0)) / size) : 0,
        context: m.context_length == null ? undefined : Number(m.context_length),
        until: m.expires_at == null ? undefined : String(m.expires_at),
      };
    });
  } catch {
    return null;
  }
}

let cache: { t: number; data: SystemState } | null = null;
let pending: Promise<SystemState> | null = null;

export function systemState(cfg: Config): Promise<SystemState> {
  if (cache && Date.now() - cache.t < 2500) return Promise.resolve(cache.data);
  pending ??= collect(cfg).finally(() => { pending = null; });
  return pending;
}

async function collect(cfg: Config): Promise<SystemState> {
  const [models, ps, mem] = await Promise.all([
    ollamaModels(cfg.ollamaUrl),
    run("docker", ["ps", "--filter", `label=com.docker.compose.project=${cfg.composeProject}`,
      "--format", "{{.Names}}\t{{.Status}}"]),
    run("memory_pressure", []),
  ]);
  const free = /free percentage:\s*(\d+)%/.exec(mem ?? "");
  const data: SystemState = {
    executor: cfg.executorModel,
    planner: cfg.plannerModel,
    ollama: models ? "up" : "down",
    models: models ?? [],
    docker: ps == null ? "down" : "up",
    containers: (ps ?? "").split("\n").filter(Boolean).map((l) => {
      const [name, status = ""] = l.split("\t");
      return { name, status };
    }),
    mem_free: free ? Number(free[1]) : null,
  };
  cache = { t: Date.now(), data };
  return data;
}

// Configuración del servidor. La pasa bin/ai (cmd_studio) desde config.env por el entorno;
// aquí no hay valores propios salvo los que bin/ai siempre define.
import { join } from "node:path";

export interface Config {
  aiHome: string;
  port: number;
  executorModel: string;
  plannerModel: string;
  ollamaUrl: string;
  composeProject: string;
  metricsIntervalMs: number;
  metricsWindowMin: number;
  alertMemFree: number;  // % de memoria libre que dispara el aviso en la UI
  projectsRoot: string;  // PROJECTS_ROOT: solo se lanzan acciones sobre carpetas dentro de ella
  jobHistory: number;
  jobBufferKb: number;
  tokenFile: string;     // donde se deja el token de esta ejecución (lo lee bin/ai)
  uiDist: string;        // build de la UI (vite build)
}

function positive(name: string): number {
  const n = Number(required(name));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} no válido: ${process.env[name]}`);
  return n;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable ${name}. Arranca el Studio con: ai studio`);
  return v;
}

export function loadConfig(): Config {
  const aiHome = required("AI_HOME");
  const port = Number(required("STUDIO_PORT"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`STUDIO_PORT no válido: ${port}`);
  return {
    aiHome,
    port,
    executorModel: required("EXECUTOR_MODEL"),
    plannerModel: required("PLANNER_MODEL"),
    ollamaUrl: required("OLLAMA_URL"),
    composeProject: required("COMPOSE_PROJECT"),
    metricsIntervalMs: Math.max(250, positive("STUDIO_METRICS_INTERVAL_MS")),
    metricsWindowMin: positive("STUDIO_METRICS_WINDOW_MIN"),
    alertMemFree: positive("STUDIO_ALERT_MEM_FREE"),
    projectsRoot: required("PROJECTS_ROOT"),
    jobHistory: positive("STUDIO_JOB_HISTORY"),
    jobBufferKb: positive("STUDIO_JOB_BUFFER_KB"),
    tokenFile: join(aiHome, "run", "studio.token"),
    uiDist: join(aiHome, "studio", "ui", "dist"),
  };
}

// Tipos compartidos entre el servidor y la UI del Studio.
// El origen de los datos es proyecto/.ai/ (lo escribe bin/ai); el formato de los eventos
// está documentado en la cabecera de lib/aiwatch.py.

export type Status = "pending" | "running" | "done" | "failed" | "aborted";

export interface PlanStep {
  n: number;
  title: string;
  files: string[];
  status: Status;
  started?: string;
  secs?: number;
  commits?: string[];
}

export interface ToolCall { ts: string; tool: string; target: string }
export interface Note { ts: string; text: string }

export interface Analysis {
  status: Status;
  tools: ToolCall[];
  notes: Note[];
  task?: string;
  model?: string;
  started?: string;
  finished?: string;
  turns?: number;
  duration_ms?: number;
  error?: string;
}

export interface Execution {
  status: Status;
  steps: PlanStep[];
  current: number | null;
  logs: number[];          // pasos que tienen salida grabada
  mode?: string;
  model?: string;
  branch?: string;
  total?: number;
  started?: string;
  finished?: string | null;
}

export interface Review { status: Status; text?: string; started?: string; finished?: string }

export interface RunState {
  name: string;
  plan: { title: string; text: string };
  analysis: Analysis;
  exec: Execution;
  review: Review;
  events: number;
  updated: number;         // epoch en segundos
}

export interface RunSummary {
  name: string;
  title: string;
  stage: "analysis" | "exec" | "review";
  status: Status;
  updated: number;
}

export interface Project { dir: string; name: string; runs: RunSummary[] }

export interface LoadedModel { name: string; size: number; gpu: number; context?: number; until?: string }

export interface SystemState {
  executor: string;
  planner: string;
  ollama: "up" | "down";
  models: LoadedModel[];
  docker: "up" | "down";
  containers: { name: string; status: string }[];
  mem_free: number | null;
}

// --- Protocolo WebSocket (/ws) -------------------------------------------------
export type ClientMessage =
  | { type: "subscribe"; project: string; run: string; step: number | null };

export type ServerMessage =
  | { type: "projects"; data: Project[] }
  | { type: "system"; data: SystemState }
  | { type: "run"; data: RunState | null }
  // Bytes crudos de la terminal grabada (base64). reset=true: empezar de cero.
  | { type: "log"; step: number; reset: boolean; chunk: string }
  | { type: "error"; message: string };

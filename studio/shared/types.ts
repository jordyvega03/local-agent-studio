// Tipos compartidos entre el servidor y la UI del Studio.
// El origen de los datos es proyecto/.ai/ (lo escribe bin/ai); el formato de los eventos
// está documentado en la cabecera de lib/aiwatch.py.

export type Status = "pending" | "running" | "done" | "failed" | "aborted";

/** Suma de peticiones del medidor (misma forma que token_stats() en lib/aiwatch.py). */
export interface TokenStats {
  requests: number;
  prompt: number;
  output: number;
  eval_ms: number;
  total_ms: number;
  tok_s: number | null;
}

/** Tokens de Opus (ai plan + ai review), del JSON de Claude Code. */
export interface OpusUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd?: number;            // coste equivalente de API, informativo
}

export interface PlanStep {
  n: number;
  title: string;
  files: string[];
  status: Status;
  started?: string;
  secs?: number;
  commits?: string[];
  tokens?: TokenStats;
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
  tokens: { executor: TokenStats | null; opus: OpusUsage | null };
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

// --- Métricas en tiempo real (Fase 1) ------------------------------------------
/** Una muestra por segundo; el servidor guarda los últimos METRICS_WINDOW_MIN minutos. */
export interface MetricSample {
  t: number;                 // epoch ms
  cpu: number;               // % de toda la CPU (0-100)
  gpu: number | null;        // % de uso de la GPU (ioreg), null si no se pudo leer
  memUsed: number;           // bytes en uso (activa + wired + comprimida), como Monitor de Actividad
  memFreePct: number | null; // "free percentage" de macOS (memory_pressure)
  swapUsed: number;          // bytes
}

export interface ProcGroup {
  name: string;              // Ollama, Docker (VM), Claude Code, AI Studio
  cpu: number;               // % de un núcleo, como Monitor de Actividad (puede pasar de 100)
  rss: number;               // bytes
  count: number;             // procesos agrupados
}

export interface ContainerStat { name: string; cpu: number; mem: number; limit: number }

/** Lo que no se guarda en el histórico: estado actual detallado. */
export interface MetricsNow {
  sample: MetricSample;
  cores: number[];           // % por núcleo
  memTotal: number;
  swapTotal: number;
  gpuMem: number | null;     // memoria del sistema en uso por la GPU (bytes)
  procs: ProcGroup[];
  containers: ContainerStat[];
  windowMin: number;
  alertMemFree: number;      // umbral de aviso (STUDIO_ALERT_MEM_FREE)
}

// --- Medidor de tokens (Fase 2) --------------------------------------------------
/** Una petición registrada por el medidor (logs/tokens.jsonl). */
export interface TokenRecord {
  ts: string;
  status: "ok" | "cancelled" | "error" | "incomplete";
  model: string;
  endpoint: string;
  prompt_tokens?: number;
  cached_prompt_tokens?: number;
  output_tokens?: number;
  load_ms?: number;
  prompt_ms?: number;
  eval_ms?: number;
  total_ms?: number;
  ttft_ms?: number;
  tok_s?: number;
  prompt_tok_s?: number;
  done_reason?: string;
  project?: string;
  run?: string;
  step?: number;
  agent?: string;
}

/** Estado en vivo del medidor (run/meter-live.json). */
export interface MeterLive {
  active: boolean;
  model?: string;
  context?: { project?: string; run?: string; step?: number; agent?: string };
  started?: number;
  tokens?: number;
  tok_s?: number | null;
  ttft_ms?: number | null;
  updated: number;
  last?: TokenRecord;
}

export interface TokensState {
  enabled: boolean;             // TOKEN_METER=1 y el medidor está en marcha
  live: MeterLive | null;
  recent: TokenRecord[];        // últimas peticiones (las más nuevas al final)
}

// --- Protocolo WebSocket (/ws) -------------------------------------------------
export type ClientMessage =
  | { type: "subscribe"; project: string; run: string; step: number | null };

export type ServerMessage =
  | { type: "projects"; data: Project[] }
  | { type: "system"; data: SystemState }
  | { type: "run"; data: RunState | null }
  | { type: "metrics_history"; data: MetricSample[] }   // al conectar
  | { type: "metrics"; data: MetricsNow }               // cada segundo
  | { type: "tokens"; data: TokensState }               // si cambia (1 s)
  // Bytes crudos de la terminal grabada (base64). reset=true: empezar de cero.
  | { type: "log"; step: number; reset: boolean; chunk: string }
  | { type: "error"; message: string };

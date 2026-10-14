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

/** Una ejecución de `ai agent` (Fase 4). Sus pasos van en exec (1 = agente, 2 = verificación). */
export interface AgentRun {
  agent?: string;          // id (agents/<id>.env)
  label?: string;
  engine?: "aider" | "claude";
  model?: string;
  task?: string;
  access?: "read" | "write";
  status: Status;
  started?: string;
  finished?: string;
  secs?: number;
  duration_ms?: number;
  turns?: number;
  error?: string;
  tools: ToolCall[];       // motor claude: lo que leyó
  notes: Note[];
  result?: string;         // motor claude: texto final (.ai/logs/<run>.result.md)
}

/** Una etapa de un flujo (Fase 5). run = la sesión que creó (plan, agente…). */
export interface FlowStage {
  i: number;
  stage: string;           // plan | exec | review | id de agente
  status: Status;
  started?: string;
  run?: string;
  secs?: number;
  attempts?: number;       // reintentos de arreglo usados
}

/** Una ejecución de `ai flow`. */
export interface FlowRun {
  flow?: string;
  label?: string;
  task?: string;
  status: Status;
  started?: string;
  finished?: string;
  waiting: number | null;  // etapa tras la que espera aprobación
  approve: string[];
  retries?: number;
  fix?: string;
  error?: string;
  stages: FlowStage[];
}

/** Definición de un flujo (flows/<id>.env). */
export interface FlowDef {
  id: string;
  name: string;
  description: string;
  steps: string[];
  approve: string[];
  retries: number;
  fix: string;
}

/** Definición de un agente (agents/<id>.env + prompts/agents/<id>.md). */
export interface AgentDef {
  id: string;
  name: string;
  description: string;
  engine: "aider" | "claude";
  model: string;           // vacío = el del motor por defecto
  access: "read" | "write";
  verify: string;          // vacío | auto | comando
  input: "" | "diff";
  prompt: string;
}

export interface RunState {
  name: string;
  plan: { title: string; text: string; mtime?: number };   // mtime: para editar sin pisar cambios
  analysis: Analysis;
  exec: Execution;
  review: Review;
  tokens: { executor: TokenStats | null; opus: OpusUsage | null };
  agent: AgentRun | null;  // solo en ejecuciones de `ai agent`
  flow: FlowRun | null;    // solo en ejecuciones de `ai flow`
  events: number;
  updated: number;         // epoch en segundos
}

export interface RunSummary {
  name: string;
  title: string;
  stage: "analysis" | "exec" | "review" | "agent" | "flow";
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

// --- Trabajos lanzados desde la web (Fase 3) ------------------------------------
export type JobAction = "plan" | "exec" | "review" | "chat" | "use" | "up" | "agent" | "flow";

/** Lo que envía la web para lanzar una acción (lo valida server/actions.ts). */
export interface JobRequest {
  action: JobAction;
  project?: string;        // ruta absoluta o relativa a PROJECTS_ROOT
  task?: string;           // plan
  plan?: string;           // exec: nombre del plan (sin .md)
  from?: number;           // exec: reanudar desde el paso N
  interactive?: boolean;   // exec -i
  model?: string;          // use
  agent?: string;          // agent: id del agente
  flow?: string;           // flow: id del flujo
  autoApprove?: boolean;   // flow: --yes (aprueba las pausas solo)
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobSummary {
  id: string;
  action: JobAction;
  label: string;
  project?: string;
  argv: string[];
  interactive: boolean;
  status: JobStatus;
  created: number;         // epoch ms
  started?: number;
  finished?: number;
  exitCode?: number;
  cancelling?: boolean;
}

// --- Protocolo WebSocket (/ws) -------------------------------------------------
export type ClientMessage =
  | { type: "subscribe"; project: string; run: string; step: number | null }
  | { type: "job_attach"; id: string | null }          // ver la terminal de un trabajo (null: ninguno)
  | { type: "job_input"; id: string; data: string }    // teclas hacia la terminal del trabajo
  | { type: "job_resize"; id: string; cols: number; rows: number };

export type ServerMessage =
  | { type: "projects"; data: Project[] }
  | { type: "system"; data: SystemState }
  | { type: "run"; data: RunState | null }
  | { type: "metrics_history"; data: MetricSample[] }   // al conectar
  | { type: "metrics"; data: MetricsNow }               // cada segundo
  | { type: "tokens"; data: TokensState }               // si cambia (1 s)
  | { type: "jobs"; data: JobSummary[] }                // cola de trabajos, al cambiar
  // Salida de la terminal de un trabajo (base64). reset=true: es la repetición inicial.
  | { type: "job_output"; id: string; reset: boolean; chunk: string }
  // Bytes crudos de la terminal grabada (base64). reset=true: empezar de cero.
  | { type: "log"; step: number; reset: boolean; chunk: string }
  | { type: "error"; message: string };

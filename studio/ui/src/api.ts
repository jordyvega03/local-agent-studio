// Peticiones que cambian algo (lanzar, cancelar, guardar plan). La cookie de sesión va sola
// y el navegador añade Origin, que el servidor exige en todo lo que no sea GET.
import type { JobRequest, JobSummary } from "../../shared/types.ts";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Error ${r.status}`);
  return data as T;
}

export const startJob = (req: JobRequest) => call<JobSummary>("POST", "/api/jobs", req);
export const cancelJob = (id: string) => call<{ ok: true }>("POST", `/api/jobs/${encodeURIComponent(id)}/cancel`);
export const savePlan = (project: string, run: string, text: string, mtime: number) =>
  call<{ mtime: number }>("PUT", "/api/plan", { project, run, text, mtime });
export const getModels = () => call<{ installed: string[]; executor: string }>("GET", "/api/models");

export const getAgents = () => call<import("../../shared/types.ts").AgentDef[]>("GET", "/api/agents");
export const createAgent = (def: import("../../shared/types.ts").AgentDef) => call("POST", "/api/agents", def);
export const updateAgent = (def: import("../../shared/types.ts").AgentDef) =>
  call("PUT", `/api/agents/${encodeURIComponent(def.id)}`, def);

export const getFlows = () => call<import("../../shared/types.ts").FlowDef[]>("GET", "/api/flows");
export const decideFlow = (project: string, run: string, decision: "approve" | "reject") =>
  call<{ ok: true }>("POST", "/api/flows/decision", { project, run, decision });

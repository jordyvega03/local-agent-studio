// Servidor del Studio. Lo arranca `ai studio` (bin/ai) con la configuración por entorno.
// Node lo ejecuta directamente (type stripping, Node >= 22.18): no hay paso de compilación.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { loadConfig } from "./config.ts";
import { ActionError, buildAction, resolveProject } from "./actions.ts";
import { AgentError, listAgents, saveAgent, validateAgent } from "./agents.ts";
import { listDocs, readDoc } from "./docs.ts";
import { listFlows } from "./flows.ts";
import { branchCommits, branchDiff, GitError, projectGit } from "./git.ts";
import { Jobs } from "./jobs.ts";
import { handleSocket } from "./live.ts";
import { Metrics } from "./metrics.ts";
import { listProjects, MAX_PLAN_BYTES, registeredProjects, RUN_NAME, runState, savePlan } from "./runs.ts";
import { createToken, installSecurity } from "./security.ts";
import { systemState } from "./system.ts";
import { readTokens } from "./tokens.ts";
import type { AgentDef, JobRequest } from "../shared/types.ts";

const cfg = loadConfig();
const token = createToken(cfg);
const app = Fastify({ logger: { level: "warn" } });
const metrics = new Metrics(cfg);
metrics.start();
const jobs = new Jobs(cfg);

async function installedModels(): Promise<string[]> {
  try {
    const r = await fetch(cfg.ollamaUrl + "/api/tags", { signal: AbortSignal.timeout(2000) });
    return ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? [];
  } catch { return []; }
}

await app.register(fastifyCookie);
await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
installSecurity(app, cfg, token);

// REST de solo lectura (útil para depurar con curl -b); la UI usa /ws.
app.get("/api/projects", async () => listProjects(cfg.aiHome));
app.get("/api/system", async () => systemState(cfg));
app.get("/api/run", async (req, reply) => {
  const { project = "", run = "" } = req.query as Record<string, string | undefined>;
  if (!registeredProjects(cfg.aiHome).includes(project) || !RUN_NAME.test(run)) {
    return reply.code(404).send({ error: "proyecto o plan no válido" });
  }
  return runState(project, run);
});

app.get("/api/metrics", async () => metrics.snapshot());
app.get("/api/tokens", async () => readTokens(cfg));

// --- Acciones (Fase 3). POST/PUT exigen Origin permitido + cookie (security.ts). ---------
app.get("/api/models", async () => ({ installed: await installedModels(), executor: cfg.executorModel }));
app.get("/api/jobs", async () => jobs.list());
app.post("/api/jobs", async (req, reply) => {
  try {
    const job = jobs.enqueue(buildAction(req.body as JobRequest, cfg, await installedModels()));
    return reply.code(201).send(job);
  } catch (err) {
    if (err instanceof ActionError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});
app.post("/api/jobs/:id/cancel", async (req, reply) => {
  const { id } = req.params as { id: string };
  return jobs.cancel(id) ? { ok: true } : reply.code(409).send({ error: "Ese trabajo ya no se puede cancelar." });
});
// Agentes: listar, crear y editar (agents/*.env + prompts/agents/*.md).
app.get("/api/agents", async () => listAgents(cfg));
const putAgent = (mode: "create" | "update") => async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
  try {
    const body = { ...(req.body as Partial<AgentDef>) };
    if (mode === "update") body.id = (req.params as { id: string }).id;
    const def = validateAgent(body, await installedModels());
    saveAgent(cfg, def, mode);
    appendFileSync(join(cfg.aiHome, "logs", "studio-audit.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), event: mode === "create" ? "agent_created" : "agent_saved", agent: def.id, engine: def.engine, access: def.access }) + "\n");
    return reply.code(mode === "create" ? 201 : 200).send(def);
  } catch (err) {
    if (err instanceof AgentError) return reply.code(400).send({ error: err.message });
    throw err;
  }
};
app.post("/api/agents", putAgent("create"));
app.put("/api/agents/:id", putAgent("update"));

// Flujos: listar y decidir en una pausa (Aprobar/Rechazar). La decisión es un archivo que
// el flujo vigila (bin/ai flow_wait_approval), así sirve también para flujos de la terminal.
app.get("/api/flows", async () => listFlows(cfg));
app.post("/api/flows/decision", async (req, reply) => {
  const { project, run, decision } = (req.body ?? {}) as { project?: string; run?: string; decision?: string };
  try {
    const dir = resolveProject(project, cfg);
    if (!run || !RUN_NAME.test(run)) return reply.code(400).send({ error: "Sesión no válida." });
    if (decision !== "approve" && decision !== "reject") return reply.code(400).send({ error: "Decisión no válida." });
    const st = runState(dir, run);
    if (!st.flow || st.flow.waiting == null) return reply.code(409).send({ error: "Ese flujo no está esperando aprobación." });
    writeFileSync(join(dir, ".ai", "logs", `${run}.decision`), decision === "approve" ? "s" : "n");
    appendFileSync(join(cfg.aiHome, "logs", "studio-audit.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), event: "flow_decision", project: dir, run, decision, stage: st.flow.waiting }) + "\n");
    return { ok: true };
  } catch (err) {
    if (err instanceof ActionError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.put("/api/plan", async (req, reply) => {
  const { project, run, text, mtime } = (req.body ?? {}) as { project?: string; run?: string; text?: unknown; mtime?: unknown };
  try {
    const dir = resolveProject(project, cfg);
    if (!run || !RUN_NAME.test(run)) return reply.code(400).send({ error: "Nombre de plan no válido." });
    if (typeof text !== "string" || typeof mtime !== "number") return reply.code(400).send({ error: "Petición incompleta." });
    if (Buffer.byteLength(text) > MAX_PLAN_BYTES) return reply.code(413).send({ error: "El plan es demasiado grande." });
    const res = savePlan(dir, run, text, mtime);
    appendFileSync(join(cfg.aiHome, "logs", "studio-audit.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), event: "plan_saved", project: dir, run, bytes: Buffer.byteLength(text) }) + "\n");
    return res;
  } catch (err) {
    if (err instanceof ActionError) return reply.code(400).send({ error: err.message });
    if ((err as { conflict?: boolean }).conflict) return reply.code(409).send({ error: (err as Error).message });
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return reply.code(404).send({ error: "No existe ese plan." });
    throw err;
  }
});
// Pestaña Proyecto (solo lectura): ramas ai/*, commits, diff y documentos del proyecto.
// Solo proyectos registrados por bin/ai, igual que el resto de lecturas.
const projectParam = (q: Record<string, string | undefined>) => {
  const dir = q.project ?? "";
  if (!registeredProjects(cfg.aiHome).includes(dir)) throw new GitError("Proyecto no válido.");
  return dir;
};
const gitRoute = (fn: (q: Record<string, string | undefined>) => Promise<unknown>) =>
  async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    try { return await fn(req.query as Record<string, string | undefined>); } catch (err) {
      if (err instanceof GitError || (err instanceof Error && /documento/.test(err.message))) return reply.code(400).send({ error: err.message });
      throw err;
    }
  };
app.get("/api/git", gitRoute(async (q) => projectGit(projectParam(q))));
app.get("/api/git/commits", gitRoute(async (q) => branchCommits(projectParam(q), q.branch ?? "")));
app.get("/api/git/diff", gitRoute(async (q) => branchDiff(projectParam(q), q.branch ?? "", q.commit || undefined)));
app.get("/api/docs", gitRoute(async (q) => listDocs(projectParam(q))));
app.get("/api/docs/file", gitRoute(async (q) => ({ path: q.path, text: readDoc(projectParam(q), q.path ?? "") })));

app.get("/ws", { websocket: true }, (socket) => handleSocket(socket, cfg, metrics, jobs));

if (existsSync(cfg.uiDist)) {
  await app.register(fastifyStatic, { root: cfg.uiDist, wildcard: false });
  // URLs de la UI (/calorie-tracker/20261014-1225, /calorie-tracker/sistema…): todas sirven la
  // misma página y la UI decide qué mostrar. Lo que empieza por /api o /assets sigue dando 404.
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    if (req.method === "GET" && !/^\/(api|assets|ws|auth)(\/|$)/.test(path) && !/\.[a-z0-9]+$/i.test(path)) {
      return reply.type("text/html; charset=utf-8").sendFile("index.html");
    }
    return reply.code(404).type("text/plain; charset=utf-8").send("No encontrado");
  });
} else {
  app.get("/", async (_req, reply) =>
    reply.type("text/plain; charset=utf-8").send("Falta compilar la UI: cd studio && npm run build (ai studio lo hace solo)"));
}

await app.listen({ host: "127.0.0.1", port: cfg.port });
console.error(`${new Date().toISOString()} Studio en http://127.0.0.1:${cfg.port}/`);

// ai studio stop / ai down: deja que el trabajo en curso registre su interrupción antes de salir.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => { void jobs.shutdown().finally(() => process.exit(0)); });
}

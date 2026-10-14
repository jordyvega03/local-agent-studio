// Servidor del Studio. Lo arranca `ai studio` (bin/ai) con la configuración por entorno.
// Node lo ejecuta directamente (type stripping, Node >= 22.18): no hay paso de compilación.
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { loadConfig } from "./config.ts";
import { ActionError, buildAction, resolveProject } from "./actions.ts";
import { Jobs } from "./jobs.ts";
import { handleSocket } from "./live.ts";
import { Metrics } from "./metrics.ts";
import { listProjects, MAX_PLAN_BYTES, registeredProjects, RUN_NAME, runState, savePlan } from "./runs.ts";
import { createToken, installSecurity } from "./security.ts";
import { systemState } from "./system.ts";
import { readTokens } from "./tokens.ts";
import type { JobRequest } from "../shared/types.ts";

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
app.get("/ws", { websocket: true }, (socket) => handleSocket(socket, cfg, metrics, jobs));

if (existsSync(cfg.uiDist)) {
  await app.register(fastifyStatic, { root: cfg.uiDist, wildcard: false });
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

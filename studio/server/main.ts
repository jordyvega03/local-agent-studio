// Servidor del Studio. Lo arranca `ai studio` (bin/ai) con la configuración por entorno.
// Node lo ejecuta directamente (type stripping, Node >= 22.18): no hay paso de compilación.
import { existsSync } from "node:fs";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { loadConfig } from "./config.ts";
import { handleSocket } from "./live.ts";
import { Metrics } from "./metrics.ts";
import { listProjects, registeredProjects, RUN_NAME, runState } from "./runs.ts";
import { createToken, installSecurity } from "./security.ts";
import { systemState } from "./system.ts";

const cfg = loadConfig();
const token = createToken(cfg);
const app = Fastify({ logger: { level: "warn" } });
const metrics = new Metrics(cfg);
metrics.start();

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
app.get("/ws", { websocket: true }, (socket) => handleSocket(socket, cfg, metrics));

if (existsSync(cfg.uiDist)) {
  await app.register(fastifyStatic, { root: cfg.uiDist, wildcard: false });
} else {
  app.get("/", async (_req, reply) =>
    reply.type("text/plain; charset=utf-8").send("Falta compilar la UI: cd studio && npm run build (ai studio lo hace solo)"));
}

await app.listen({ host: "127.0.0.1", port: cfg.port });
console.error(`${new Date().toISOString()} Studio en http://127.0.0.1:${cfg.port}/`);

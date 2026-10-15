// Seguridad del Studio (docs/SECURITY.md). El Studio podrá ejecutar comandos (Fase 3), así
// que desde la Fase 0 todo pasa por aquí:
//  - solo 127.0.0.1 (lo fija main.ts al escuchar);
//  - Host permitido: defensa contra DNS rebinding;
//  - token aleatorio por arranque -> cookie HttpOnly + SameSite=Strict;
//  - Origin permitido en WebSocket y métodos que no sean GET: otra web o app en localhost
//    no puede usar tu cookie (SameSite no distingue puertos de localhost).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.ts";
import { listProjects } from "./runs.ts";

export const COOKIE = "studio_session";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // xterm.js usa estilos en línea
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

export function createToken(cfg: Config): string {
  const token = randomBytes(32).toString("hex");
  writeFileSync(cfg.tokenFile, token + "\n", { mode: 0o600 });
  return token;
}

function sameToken(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function installSecurity(app: FastifyInstance, cfg: Config, token: string) {
  const hosts = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  // Modo desarrollo (npm run dev:ui): la UI de Vite vive en otro puerto y hace de proxy.
  const devPort = process.env.STUDIO_DEV_UI_PORT;
  if (devPort) for (const h of ["127.0.0.1", "localhost"]) origins.add(`http://${h}:${devPort}`);

  const isPublic = (url: string) => url.startsWith("/auth") || url.startsWith("/assets/") || url === "/favicon.svg";
  const authed = (req: FastifyRequest) => sameToken(req.cookies[COOKIE], token);

  app.addHook("onRequest", async (req, reply) => {
    reply.header("Content-Security-Policy", CSP);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");

    if (!hosts.has(req.headers.host ?? "")) return deny(reply, 403, "Host no permitido");
    const origin = req.headers.origin;
    const upgrading = req.headers.upgrade?.toLowerCase() === "websocket";
    if ((upgrading || req.method !== "GET") && (!origin || !origins.has(origin))) {
      return deny(reply, 403, "Origen no permitido");
    }
    if (!isPublic(req.url) && !authed(req)) {
      return deny(reply, 401, "Sesión no válida. Abre el Studio con: ai studio");
    }
  });

  // bin/ai abre /auth?token=...; se cambia por una cookie y se redirige sin el token en la URL.
  app.get("/auth", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (!sameToken(q.token, token)) return deny(reply, 401, "Token no válido. Abre el Studio con: ai studio");
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "strict", path: "/", secure: false });
    // URL corta: /<proyecto> (ver ui/src/route.ts). Un proyecto desconocido lleva al inicio.
    const slug = q.project ? listProjects(cfg.aiHome).find((p) => p.dir === q.project)?.slug : undefined;
    const next = slug ? `/${encodeURIComponent(slug)}` : "/";
    return reply.redirect(next);
  });
}

function deny(reply: FastifyReply, code: number, message: string) {
  return reply.code(code).type("text/plain; charset=utf-8").send(message);
}

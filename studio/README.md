# AI Studio

Interfaz web de los agentes de `ai`. Plan y fases: [`../docs/PLAN-STUDIO.md`](../docs/PLAN-STUDIO.md).
Arquitectura y seguridad: `../docs/ARCHITECTURE.md` y `../docs/SECURITY.md`.

Uso normal: `ai studio [proyecto]` (instala, compila y abre el navegador con sesión).

## Estructura

```
server/   Fastify + WebSocket (TypeScript que Node ejecuta sin compilar)
ui/       React + Vite + Tailwind; `npm run build` -> ui/dist (lo sirve el servidor)
shared/   tipos comunes (datos y protocolo /ws)
```

## Desarrollo

```bash
npm ci                 # dependencias (versiones fijadas)
npm run typecheck      # tsc sobre server, ui y shared
npm test               # vitest (server/*.test.ts)
npm run build          # compila la UI
```

UI con recarga en caliente:

```bash
ai studio stop
# servidor aceptando el origen de Vite (mismas variables que pasa bin/ai):
STUDIO_DEV_UI_PORT=5173 AI_HOME=$PWD/.. STUDIO_PORT=8766 EXECUTOR_MODEL=gpt-oss:20b \
  PLANNER_MODEL=opus OLLAMA_URL=http://127.0.0.1:11434 COMPOSE_PROJECT=ai-agent npm run dev:server
npm run dev:ui         # en otra terminal; abre http://127.0.0.1:5173/auth?token=$(cat ../run/studio.token)
```

## Reglas

- La lectura de `.ai/` (`server/runs.ts`) tiene la misma semántica que `run_state()` en
  `../lib/aiwatch.py`. Si cambias una, cambia la otra y los tests.
- Solo sintaxis TypeScript "borrable" (sin `enum` ni `namespace`): Node la ejecuta tal cual.
- Nada de CDNs: todo va en el bundle (la CSP solo permite `'self'`).
- Dependencias nuevas: `npm install --save-exact --before=<fecha de hace 2 semanas>`.

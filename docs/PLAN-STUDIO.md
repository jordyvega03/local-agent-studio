# Plan: AI Studio (interfaz web para los agentes)

Estado: **Fases 0 a 3 hechas** (2026-10-14). Seguimiento en `ROADMAP.md`.

Objetivo: una interfaz web más completa que `ai dashboard` para ver sesiones y tokens del
ejecutor, mandar comandos desde el navegador, ver CPU/RAM/GPU en tiempo real y crear
agentes con roles (coder, tester, reviewer…), **sin cambiar el flujo actual**.

## Principio

**`bin/ai` sigue siendo el motor.** El Studio no reimplementa nada: lanza los mismos
comandos (`ai plan`, `ai exec`…) y lee los mismos registros de `proyecto/.ai/logs/`.
Terminal y web siempre hacen exactamente lo mismo. `ai dashboard` (sin dependencias) se
queda como panel ligero de respaldo.

```
┌──────────────── Navegador (React) ─────────────────┐
│ Sesiones · Agentes · Terminal web · Métricas · Tokens│
└───────────────▲─────────────── WebSocket ──────────┘
                │ 127.0.0.1 + token de sesión
┌───────────────┴──── Servidor Studio (Node/TS) ─────┐
│ jobs: lanza bin/ai en un PTY (terminal real)       │
│ métricas: CPU, RAM, GPU, contenedores, Ollama      │
│ lee .ai/logs/*.jsonl (lo que ya escribe bin/ai)    │
└───────┬───────────────┬─────────────────┬──────────┘
        │               │                 │
     bin/ai     medidor de tokens ◄── Aider (contenedor)
                      │
                      ▼
                   Ollama
```

## Stack

| Parte | Elección | Por qué |
|---|---|---|
| Frontend | React + Vite + TypeScript, Tailwind + shadcn/ui | Rápido, componentes listos |
| Gráficas | Recharts | CPU, RAM, tokens/s en tiempo real |
| Terminal web | xterm.js | La terminal de Aider en el navegador, con colores |
| Backend | Node + TypeScript (Fastify) + WebSocket | Un solo lenguaje con el frontend; Node ya está instalado |
| PTY | `node-pty` | `ai exec` se comporta igual que en una terminal |
| Métricas | `systeminformation`, `docker stats`, `ioreg` (GPU sin sudo), `ollama /api/ps` | Sin privilegios |

Decidido (2026-10-14): backend Node/TS. Componentes propios con Tailwind en estilo shadcn
(sin shadcn/ui: los formularios de la Fase 3 no lo necesitaron y así hay menos dependencias).

## Fases

### Fase 0 — Base del Studio (1–2 días) ✅ 2026-10-14
- `studio/server` (Fastify) y `studio/ui` (React).
- `ai studio [proyecto]`: arranca en `127.0.0.1:STUDIO_PORT` y abre el navegador.
- Seguridad desde el día 1 (ver abajo).
- Portar a React lo que hace `ai dashboard`: etapas, pasos, salida, revisión.
- **Validación:** muestra lo mismo que `ai dashboard` con un plan real.

### Fase 1 — Métricas en tiempo real (1–2 días) ✅ 2026-10-14
- Mac: CPU total y por núcleo, RAM usada/libre/presión, swap, GPU %.
- Procesos: CPU/RAM de Ollama y de la VM de Docker.
- Contenedores: CPU/RAM de cada Aider frente a `EXECUTOR_MEM_LIMIT`.
- Modelo: cuál está cargado, % GPU, tamaño, cuándo se descarga.
- Gráficas de 15 min por WebSocket (1 s). Aviso si la RAM libre baja del 15 %.

### Fase 2 — Tokens y sesiones (2–3 días) ✅ 2026-10-14
- **Medidor de tokens** (hecho en Python, `lib/aiwatch.py meter`, para que `bin/ai` no dependa
  de Node; `docker/compose.yml` no cambió: `bin/ai` le pasa el puerto del medidor): proxy mínimo Aider → `127.0.0.1:11435` → Ollama. Registra
  `prompt_eval_count`, `eval_count` y duraciones de cada respuesta: tokens enviados,
  recibidos y tokens/s por petición, y la respuesta token a token en vivo.
  Solo cambia `OLLAMA_API_BASE` en `docker/compose.yml` (documentar en `SECURITY.md`).
- **Opus:** tokens y duración de `ai plan` / `ai review` desde el `stream-json`.
- **Vista Sesión:** un plan completo con tokens por paso, tiempos, tok/s y commits.
- **Historial:** comparar sesiones y modelos en la misma tarea.

### Fase 3 — Comandos desde la web (3–4 días) ✅ 2026-10-14
- Formularios: nuevo plan, ejecutar, reanudar desde N, revisar, cambiar modelo.
- Cada acción lanza `bin/ai` en un PTY mostrado con xterm.js (responder prompts, Ctrl+C).
- Chat con el ejecutor (`ai exec -i` / `ai chat`) embebido.
- Cola de trabajos: uno a la vez (`OLLAMA_NUM_PARALLEL=1`), con cancelar.
- Editor de planes para revisar antes de ejecutar. Hecho con **CodeMirror 6** en vez de
  Monaco: ~10 veces más ligero, sin workers ni CDN (encaja con la CSP).
- Lo lanzado desde la web también queda en `.ai/logs/`.

### Fase 4 — Agentes con roles (4–5 días)
Un archivo por agente, estilo `config.env` (compatible con bash 3.2):

```bash
# agents/tester.env
AGENT_NAME="Tester"
AGENT_ENGINE="aider"            # aider (modelo local) | claude (Opus)
AGENT_MODEL="gpt-oss:20b"
AGENT_PROMPT="prompts/tester.md"
AGENT_ACCESS="write"            # read | write
AGENT_VERIFY="npm test"         # comando que debe pasar
```

| Agente | Motor | Qué hace |
|---|---|---|
| Planner | Opus (existe) | Analiza y escribe el plan |
| Coder | local (existe) | Implementa los pasos |
| Tester | local | Escribe y **ejecuta** tests; si fallan, devuelve el error al Coder |
| Reviewer | Opus (existe) | Revisa el diff |
| Docs | local | Actualiza README y documentación |

- `ai agent <nombre> <proyecto> "tarea"`; crear/editar agentes desde la web.
- El Tester necesita la **imagen propia del executor** con las toolchains (ROADMAP),
  con el mismo endurecimiento. Pendiente: qué stacks (Node, Python, Java…).

### Fase 5 — Flujos multiagente (3–4 días)
```bash
# flows/feature.env
FLOW_STEPS="planner coder tester reviewer"
FLOW_APPROVE_AFTER="planner"      # pausa para revisar el plan
FLOW_MAX_RETRIES=1                # Tester falla -> Coder reintenta una vez
```
- `ai flow feature mi-app "tarea"`; en la web, diagrama de nodos con botón **Aprobar**.

### Fase 6 — Extras
Notificaciones de macOS, autocompletado zsh, tema claro/oscuro.

## Seguridad

`ai dashboard` solo lee; el Studio **ejecuta comandos**. Requisitos:

1. Solo `127.0.0.1`; token aleatorio por arranque, cookie `HttpOnly` + `SameSite=Strict`;
   comprobación de `Host` y `Origin` (DNS rebinding y CSRF).
2. Lista cerrada de acciones (`plan`, `exec`, `review`, `agent`, `flow`, `use`, `chat`)
   con argumentos validados. Nunca un shell libre.
3. Proyectos solo dentro de `PROJECTS_ROOT`, misma regla que `assert_safe_mount`.
4. Registro de auditoría de cada acción lanzada desde la web.
5. No se toca el endurecimiento de `docker/compose.yml`; el medidor solo cambia la URL de
   Ollama.

## Estructura prevista

```
agents/
├── bin/ai                  # motor (+ ai studio / agent / flow)
├── agents/*.env            # definición de agentes
├── flows/*.env             # flujos multiagente
├── prompts/*.md            # prompts por agente
├── studio/server/          # Fastify + WebSocket + PTY + métricas + medidor
├── studio/ui/              # React + Vite
├── lib/aiwatch.py          # eventos y análisis en vivo
└── dashboard/              # panel ligero de respaldo
```

## Orden

0 → 1 → 2 → 3 (~2 semanas): tokens, memoria, CPU, sesión y comandos desde la web.
4 → 5 después, encima de lo anterior.

# Arquitectura

## Visión general

```
┌──────────────────────────── macOS (host) ─────────────────────────────┐
│                                                                        │
│  ai plan ──► Claude Code (Opus) ── solo lectura ──► proyecto/.ai/plans │
│                                                                        │
│  Ollama (nativo, GPU Metal)  ◄── 127.0.0.1:11434                       │
│        ▲                                                               │
│        │ host.docker.internal:11434                                    │
│  ┌─────┴──────────── Docker Desktop VM ────────────────────────────┐   │
│  │  ai exec ──► contenedor efímero "executor" (Aider)               │   │
│  │              /app  = carpeta del proyecto (única montada)        │   │
│  │              /config = docker/aider (solo lectura)               │   │
│  │              usuario 1000, rootfs read-only, sin capabilities    │   │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## Decisiones clave

### ¿Por qué Ollama corre fuera de Docker?

En macOS, Docker corre dentro de una VM Linux **sin acceso a la GPU (Metal)**. Un modelo
dentro de un contenedor iría solo por CPU, entre 5 y 10 veces más lento. Por eso:

- **El modelo** (que no ejecuta código ni toca archivos) corre nativo, con Metal.
- **El agente** (que edita archivos y puede correr comandos) corre aislado en Docker.

El riesgo está en el agente, así que el aislamiento va ahí.

Alternativa evaluada: **Docker Model Runner** (`docker model …`). También usa Metal en el
host. Se descartó como default por ser menos maduro que Ollama. Está en el roadmap.

### ¿Por qué Aider como ejecutor?

- Tiene un formato de edición por diffs probado con modelos locales.
- Hace auto-commits: cada cambio queda en git y se revierte fácil.
- Tiene modo `--message` (no interactivo), ideal para ejecutar paso a paso.
- Trae modo `--architect` nativo (planner + editor) como alternativa.
- Imagen Docker oficial que corre como usuario no-root.

### ¿Por qué ejecutar paso a paso?

Un modelo de unos 20B se pierde con planes largos. `ai exec` parte el plan por los
encabezados `### Paso N` y lanza **una invocación de Aider por paso**. En cada una:

- el plan completo se pasa con `--read` (contexto, no editable),
- solo ese paso va como instrucción,
- los archivos de la línea `**Archivo(s):**` se añaden al chat para que pueda editarlos.

Así el contexto se mantiene pequeño y el modelo enfocado.

### ¿Por qué Opus vía Claude Code y no vía API?

`ai plan` usa `claude -p`, que funciona con tu login de Claude, sin API key. Para el
modo `ai architect` (Aider llamando a Opus directamente) sí hace falta `ANTHROPIC_API_KEY`.

## Flujo de datos de `ai exec`

1. `bin/ai` carga `config.env`.
2. `cmd_up --no-warm` asegura Docker, la imagen, Ollama y el modelo.
3. `prepare_git` crea o cambia a la rama `ai/<plan>`.
4. `split_steps` (awk) escribe cada `### Paso N` en `proyecto/.ai/.steps.XXXX/NNN.md`
   (se borra al terminar).
5. Por cada paso, `run_container executor` ejecuta
   `docker compose run --rm executor --model ollama_chat/<modelo> --yes-always --read <plan> <archivos> --message <paso>`.
6. Aider, dentro del contenedor, llama a `http://host.docker.internal:11434`. Docker Desktop
   lo enruta al `127.0.0.1` del Mac.

## Observabilidad y panel (`ai dashboard`)

```
ai plan ── claude -p --output-format stream-json ──► lib/aiwatch.py plan-stream ─┐
ai exec ── script(1) graba la terminal de Aider ──► .ai/logs/<plan>.step-NNN.log ┤
ai exec / review ── ai_event ──────────────────────► .ai/logs/<plan>.jsonl ───────┤
                                                                                  ▼
navegador ◄── http://127.0.0.1:DASHBOARD_PORT ◄── lib/aiwatch.py serve (solo lectura)
```

- **Un registro por plan.** Todo lo de un plan (análisis, ejecución, revisión) va a
  `proyecto/.ai/logs/<nombre-del-plan>.*`, con el mismo nombre que el `.md` del plan.
- **Eventos** (`<plan>.jsonl`): una línea JSON por evento con `ts` y `type`
  (`plan_started`, `plan_tool`, `plan_done`, `exec_started`, `step_started`, `step_done`
  con sus commits, `exec_aborted` si cortas con Ctrl+C, `review_done`…). La lista
  completa está en la cabecera de `lib/aiwatch.py`. `ai_event` en `bin/ai` nunca hace
  fallar un comando: si no hay `python3`, simplemente no registra.
- **Análisis en vivo:** `ai plan` pide a Claude Code `stream-json`. `aiwatch.py
  plan-stream` imprime cada herramienta en la terminal, la registra y escribe el texto
  final (`result`) en el archivo del plan.
- **Salida de Aider:** `run_logged` ejecuta el contenedor dentro de `script -q -t 1`, que
  conserva el TTY (colores, prompts) y vuelca a disco cada segundo. Para eso existe el
  subcomando interno `ai _container`, porque `script` no puede ejecutar funciones de bash.
  Sin terminal (CI, tuberías) se usa `tee`.
- **Servidor:** `aiwatch.py serve` (librería estándar, `ThreadingHTTPServer`). Solo
  sirve proyectos de `run/projects` (los registra `ai plan/exec/review/dashboard`).
  Reconstruye la salida de Aider con un mini emulador de terminal (cursor arriba, borrar
  línea, `\r`), así los redibujados de `rich` no salen duplicados.
- **Página:** `dashboard/index.html`, JavaScript sin dependencias. Consulta `/api/run` y
  `/api/log` cada 1,5 s y `/api/projects` y `/api/system` cada 5 s.

## AI Studio (`ai studio`)

```
navegador (React) ◄──WebSocket /ws──► studio/server (Fastify, Node) ──lee──► proyecto/.ai/
      ▲                                    │                                 run/projects
      └── /auth?token= (lo abre bin/ai)    └──► ollama /api/ps, docker ps, memory_pressure
```

- **`studio/server/`** (TypeScript que Node ejecuta sin compilar, Node >= 22.18):
  `main.ts` arranca Fastify en `127.0.0.1:STUDIO_PORT`; `security.ts` token, cookie,
  Host y Origin; `runs.ts` lee planes y eventos (**misma semántica que `run_state()` de
  `lib/aiwatch.py`**, fijada por `runs.test.ts`); `live.ts` el canal `/ws`;
  `system.ts` el estado del sistema; `config.ts` lo que pasa `bin/ai` por entorno.
- **`studio/shared/types.ts`**: tipos de los datos y del protocolo WebSocket, comunes a
  servidor y UI.
- **`studio/ui/`** (React + Vite + Tailwind): `npm run build` deja `ui/dist`, que sirve el
  servidor. `bin/ai` recompila si hay fuentes más nuevas que el build.
- **Protocolo `/ws`:** el cliente manda `{type:"subscribe", project, run, step}`; el
  servidor empuja `run` (si cambió, cada 1 s), `log` (bytes nuevos de la terminal grabada
  en base64, cada 1 s), `projects` (5 s) y `system` (3 s). La terminal se pinta con
  xterm.js, que interpreta los colores y redibujados de Aider tal cual.
- **Métricas (`server/metrics.ts`, Fase 1):** un único recolector para todos los clientes,
  cada `STUDIO_METRICS_INTERVAL_MS`. CPU con `os.cpus()`; memoria con `vm_stat` (activa +
  wired + comprimida, como el Monitor de Actividad); presión con `sysctl
  kern.memorystatus_level` (el mismo "free percentage" de `memory_pressure`); swap con
  `sysctl vm.swapusage`; GPU con `ioreg` (`IOAccelerator`); procesos con `ps` cada 2
  lecturas; contenedores con `docker stats` cada 3. Nada necesita sudo. Guarda
  `STUDIO_METRICS_WINDOW_MIN` minutos en memoria; el cliente recibe el histórico al
  conectar (`metrics_history`) y luego cada muestra (`metrics`). Coste medido: ~3 % de un
  núcleo y ~130 MB para todo el servidor.
- **Gráficas:** Recharts. Colores de series en `ui/src/index.css` (`--series-1/2`),
  validados con el validador de la guía dataviz contra el fondo de los paneles en claro y
  oscuro. Una sola escala por gráfica; tabla alternativa en cada una.
- `ai dashboard` sigue existiendo como panel ligero sin dependencias.

## Medidor de tokens (Fase 2)

```
Aider (contenedor) ──host.docker.internal:11435──► aiwatch.py meter ──► Ollama 127.0.0.1:11434
                                                        │
                       run/meter-context.json ─────────►├──► logs/tokens.jsonl (todo)
                       (bin/ai: proyecto, plan, paso)   ├──► proyecto/.ai/logs/<plan>.tokens.jsonl
                                                        └──► run/meter-live.json (en vivo, cada 0,3 s)
```

- `bin/ai` pasa a `docker/compose.yml` el puerto del medidor como `OLLAMA_PORT` cuando
  está activo (`executor_ollama_port`), así que el compose no cambia.
- El proxy reenvía cualquier petición en streaming (HTTP/1.0, el cuerpo termina al cerrar).
  En `POST /api/chat` y `/api/generate` cuenta los fragmentos (≈ tokens) para el estado en
  vivo y, con el último (`done: true`), registra `prompt_eval_count`, `eval_count` y las
  duraciones de Ollama. `eval_count` incluye los tokens de razonamiento de gpt-oss.
- Antes de cada paso `ai exec` escribe el contexto (`meter_context`); `ai chat`,
  `ai exec -i` y `ai architect` también, con su `agent`. Al salir se borra.
- Tokens de Opus: `plan_done` y `review_done` llevan `usage` del JSON de Claude Code
  (`input_tokens`, `output_tokens`, caché y coste equivalente de API).
- `run_state()` (Python) y `runState()` (TypeScript) suman los tokens por paso y por
  sesión; un test de `studio/server/runs.test.ts` compara ambas salidas.

## Archivos que se generan en cada proyecto

| Ruta | Qué es | ¿Commitear? |
|---|---|---|
| `.ai/plans/*.md` | Planes de Opus | Opcional (útil como historial) |
| `.ai/logs/<plan>.jsonl` | Eventos del plan para el panel | No (`.ai/logs/.gitignore` lo ignora todo) |
| `.ai/logs/<plan>.step-NNN.log` | Terminal grabada de cada paso de Aider | No |
| `.ai/logs/<plan>.review.md` | Salida de `ai review` | No |
| `.ai/logs/<plan>.tokens.jsonl` | Peticiones del medidor de ese plan | No |
| `.aider.chat.history.md`, `.aider.input.history`, `.aider.tags.cache.*` | Estado de Aider | No (Aider los añade a `.gitignore`) |

## Puntos de extensión

| Quieres… | Toca… |
|---|---|
| Cambiar el modelo, contexto o límites | `config.env` |
| Cambiar cómo planifica Opus | `prompts/planner.md` (mantén el formato `### Paso N`) |
| Ajustar Aider | `docker/aider/aider.conf.yml` |
| Añadir un modelo nuevo | `ai use <modelo>` + un bloque en `docker/aider/model-settings.yml` |
| Más endurecimiento del contenedor | `docker/compose.yml` (ancla `x-hardened`) |
| Un comando nuevo | `bin/ai`: función `cmd_<nombre>` + entrada en el `case` final + `cmd_help` |
| Registrar algo nuevo en el panel | `ai_event <tipo> clave=valor` en `bin/ai` + `run_state()` en `lib/aiwatch.py` + `dashboard/index.html` |

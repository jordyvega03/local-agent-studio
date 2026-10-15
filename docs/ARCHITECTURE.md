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

## Acciones desde la web (Fase 3)

```
navegador ──POST /api/jobs {action, project, …}──► actions.ts (lista cerrada + validación)
    ▲                                                   │ argv fijo de bin/ai
    │ WebSocket: jobs, job_output ◄──┐                  ▼
    └── job_input / job_resize ──────┴──► jobs.ts: cola (de uno en uno) → node-pty → bin/ai …
                                                        └──► logs/studio-audit.jsonl
```

- **`actions.ts`** traduce cada acción (`plan`, `exec`, `review`, `chat`, `use`, `up`) a
  argumentos fijos de `bin/ai`. Proyectos: dentro de `PROJECTS_ROOT` (con `realpath`, así
  un enlace simbólico no escapa), nunca la raíz ni carpetas sensibles. Plan: solo nombres
  sin ruta que existan. Tarea: hasta 4000 caracteres, sin caracteres de control. Modelo:
  solo los ya descargados. `down` no existe a propósito (apagaría el Studio).
- **`jobs.ts`** ejecuta `bin/ai` con node-pty (terminal real: colores, `read -p`, Ctrl+C)
  sin shell: el argv llega tal cual. Guarda `STUDIO_JOB_BUFFER_KB` de salida por trabajo
  para quien se conecta a mitad y recuerda `STUDIO_JOB_HISTORY` trabajos. Cancelar = Ctrl+C
  (bin/ai registra `exec_aborted`), luego SIGTERM a los 8 s y SIGKILL a los 15 s.
- npm 11 no ejecuta los scripts de instalación de node-pty, que dejan `spawn-helper` sin
  permiso de ejecución; el servidor se lo da al arrancar (`ensurePtyHelper`), sin ejecutar
  código de instalación de terceros.
- **Editor de planes:** CodeMirror 6 (cargado bajo demanda). `PUT /api/plan` escribe de forma
  atómica y responde 409 si el archivo cambió desde que lo abriste (`mtime`).

## Agentes (Fase 4)

```
agents/<id>.env ─┐  bin/ai cmd_agent (lee CLAVE='valor' con sed, sin ejecutar el archivo)
prompts/agents/  ┘        │
                          ├─ motor aider ─► contenedor: paso 1 = agente (Aider --message prompt+tarea)
                          │                             paso 2 = verificación (sh -c "$VERIFY")
                          └─ motor claude ► Claude Code en el Mac, solo Read/Glob/Grep
                                            (con AGENT_INPUT='diff' recibe el diff por stdin)
```

- Una ejecución de agente es una "sesión" más: `.ai/logs/<fecha>-<agente>-<tarea>.*`, con
  `agent_started/agent_done/agent_failed` + los `exec_*/step_*` de sus pasos. `run_state()`
  y `runState()` devuelven `agent`, y el título de la sesión es `Agente: tarea`.
- Verificación: `aiwatch.py detect-verify` (o `VERIFY_CMD` de `.ai/project.env`), ejecutada
  con `run_verify`: el mismo servicio endurecido con `--entrypoint /bin/sh`, sin dejar
  `__pycache__` ni `.pytest_cache` en el proyecto (`PYTHONDONTWRITEBYTECODE`, `PYTEST_ADDOPTS`).
- En una rama `ai/<plan>` el agente aider recibe el plan con `--read` (solo lectura): en el
  flujo `feature` el Tester completa los tests del plan en vez de crear otros duplicados
  (lo detectó la revisión de Opus en la primera prueba real del flujo).
- Imagen: `docker/executor/Dockerfile` copia el binario de Node de la imagen oficial
  (`EXECUTOR_NODE_IMAGE`) sobre `AIDER_IMAGE` e instala pytest; etiqueta `EXECUTOR_IMAGE`.
- El Studio lista/crea/edita agentes (`server/agents.ts`): valida cada campo y escribe el
  `.env` con comillas simples y valores sin comillas, `$`, `\`, `#` ni saltos de línea.

## Flujos (Fase 5)

```
ai flow feature mi-app "tarea"
  └─ etapa 1 plan ─► subshell: cmd_plan    ─► sesión .ai/logs/<plan>.*
     (pausa: espera "s/n" en la terminal o .ai/logs/<flujo>.decision del Studio)
  └─ etapa 2 exec ─► subshell: cmd_exec <plan de la etapa 1>
  └─ etapa 3 tester ► subshell: cmd_agent tester … ─► si falla su verificación:
                      cmd_agent coder "haz que pasen las comprobaciones" + salida del fallo
  └─ etapa 4 review ► subshell: cmd_review
```

- `cmd_flow` ejecuta cada etapa con `run_stage`: un subshell con `set -e` **activo** (en un
  `||` o un `if` bash lo desactivaría y un fallo no pararía la etapa) y el código en
  `STAGE_RC`. El `die`/`exit`/`trap` de la etapa no corta el flujo.
- Cada comando escribe el nombre de su sesión en `$STAGE_OUT` (desde `init_run_log`); el
  flujo lo registra en `stage_done/stage_failed` (`run`) y el Studio enlaza las sesiones.
- Aprobación: `flow_wait_approval` alterna `read -t 2` (terminal) y comprobar el archivo
  de decisión. `POST /api/flows/decision` solo lo escribe si el flujo está esperando.
- `prepare_git` no cuenta como cambio tuyo lo que deja Aider (archivos `.aider*` y la línea
  `.aider*` que añade a `.gitignore`); si no, cada etapa volvería a preguntar "¿Continuar?".
- Eventos: `flow_started`, `stage_started/done/failed`, `flow_retry`, `flow_waiting`,
  `flow_approved/rejected`, `flow_done/failed/aborted` (paridad Python/TS con tests).

## Extras (Fase 6)

- **Notificaciones** (`notify` en `bin/ai`): `osascript` recibe título y texto como
  argumentos (`on run argv`), nunca interpolados en el AppleScript. Se omiten dentro de un
  flujo (`STAGE_OUT` definido) para que solo avise el flujo.
- **Autocompletado** (`completions/_ai`): localiza el repo por el enlace de `ai`, lee
  `config.env` con el mismo `sed` que `agent_field` (sin ejecutarlo) y lista proyectos
  (registrados + repos git a 1-2 niveles de `PROJECTS_ROOT`), planes, agentes, flujos y
  modelos (`ollama list`).
- **Tema del Studio** (`ui/src/theme.ts`): `data-theme` en `<html>`; sin atributo = automático
  (`prefers-color-scheme`). Se guarda en `localStorage` (preferencia de quien mira). Las
  terminales xterm cambian de fondo con el evento `studio-theme-change`.

## URLs del Studio

- `ui/src/route.ts`: `/<proyecto>[/<sesión>|/proyecto|/acciones|/agentes|/tokens|/sistema]`.
  El proyecto es su `slug` (carpeta; con la carpeta padre si se repite: `projectSlugs` en
  `server/runs.ts`) y la sesión su fecha-hora (`20261014-1225`) o el nombre completo si dos
  coinciden. La sesión más reciente no lleva id. Navegar usa `pushState` (atrás/adelante);
  las correcciones automáticas, `replaceState`. `?project=&run=&view=` se sigue aceptando.
- El servidor sirve `index.html` para cualquier GET que no sea `/api`, `/assets`, `/ws`,
  `/auth` ni un archivo (con sesión: el control de cookie de `security.ts` se aplica igual).
  `/auth` redirige a `/<slug>`.
- `bin/ai` (`resolve_project`) acepta también el nombre corto de un proyecto registrado en
  `run/projects` (solo si es único).

## Pestaña Proyecto (diff visual y documentos)

- **`server/git.ts`** (solo lectura): `git` con `execFile` (sin shell). Ramas `ai/*` con
  commits por delante/detrás de la base (main, master o la primera que no sea `ai/*`), diff
  `base...rama` o de un commit (`git show`), parseado a archivos/bloques/líneas con su
  numeración. Solo acepta ramas que existen (no la base) y commits de 40 hex que pertenecen
  a `base..rama`: nada que llegue de la web se pasa a git sin comprobarlo. Recorta archivos
  enormes (3000 líneas por archivo, 20000 en total).
- **`server/docs.ts`**: lista Markdown de la raíz, `docs/`, `apps/*`, `packages/*` y
  `.ai/plans` (sin `node_modules`, `.git`…) y solo sirve rutas de esa lista que sigan dentro
  del proyecto con `realpath` (un enlace simbólico que sale, no).
- **UI**: `marked` → HTML → **DOMPurify** (perfil solo HTML, sin `style`, `form` ni
  imágenes; casillas siempre desactivadas). Enlaces a otro `.md` del proyecto se abren en el
  visor; `http(s)` en otra pestaña; el resto (p. ej. `javascript:`), nada.
- Mermaid queda pendiente: la versión sin avisos de seguridad (12.2.0) es demasiado reciente
  (ver ROADMAP); los bloques `mermaid` se muestran como código.

## CI (GitHub Actions)

`.github/workflows/ci.yml`, en cada push a `main` y en cada PR:

| Job | Runner | Qué comprueba |
|---|---|---|
| `studio` | macOS (bash 3.2 del sistema, node-pty con binarios de macOS) | `npm ci`, typecheck, los tests de `studio/` (incluyen `bash -n` de `bin/ai` con `/bin/bash` 3.2, la guarda de `$var…` y la paridad Python/TS), build de la UI, `zsh -n completions/_ai`, `npm audit --audit-level=high` |
| `shell` | Ubuntu (Docker) | shellcheck 0.10.0 (`-S warning`) de `bin/ai`, `docker compose config`, `py_compile` de `lib/aiwatch.py` y que la imagen del ejecutor se construya |

Acciones fijadas por hash de commit (no por etiqueta), permisos de solo lectura y
`concurrency` para cancelar ejecuciones viejas de la misma rama.

## Archivos que se generan en cada proyecto

| Ruta | Qué es | ¿Commitear? |
|---|---|---|
| `.ai/plans/*.md` | Planes de Opus | Opcional (útil como historial) |
| `.ai/logs/<plan>.jsonl` | Eventos del plan para el panel | No (`.ai/logs/.gitignore` lo ignora todo) |
| `.ai/logs/<plan>.step-NNN.log` | Terminal grabada de cada paso de Aider | No |
| `.ai/logs/<plan>.review.md` | Salida de `ai review` | No |
| `.ai/logs/<plan>.tokens.jsonl` | Peticiones del medidor de ese plan | No |
| `.ai/logs/<run>.result.md` | Respuesta de un agente con motor claude | No |
| `.ai/logs/<flujo>.decision` | Decisión del Studio en una pausa (se borra al leerla) | No |
| `.ai/project.env` | `VERIFY_CMD` del proyecto (opcional, lo escribes tú) | Sí, si quieres compartirlo |
| `.aider.chat.history.md`, `.aider.input.history`, `.aider.tags.cache.*` | Estado de Aider | No (Aider los añade a `.gitignore`) |

## Puntos de extensión

| Quieres… | Toca… |
|---|---|
| Cambiar el modelo, contexto o límites | `config.env` |
| Cambiar cómo planifica Opus | `prompts/planner.md` (mantén el formato `### Paso N`) |
| Ajustar Aider | `docker/aider/aider.conf.yml` |
| Añadir un modelo nuevo | `ai use <modelo>` + un bloque en `docker/aider/model-settings.yml` |
| Más endurecimiento del contenedor | `docker/compose.yml` (ancla `x-hardened`) |
| Un flujo nuevo | `flows/<id>.env` (formato en `flows/README.md`) |
| Un agente nuevo | Studio → Agentes, o `agents/<id>.env` + `prompts/agents/<id>.md` |
| Otra toolchain en el contenedor (Java, Go…) | `docker/executor/Dockerfile` + subir la etiqueta de `EXECUTOR_IMAGE` |
| Un comando nuevo | `bin/ai`: función `cmd_<nombre>` + entrada en el `case` final + `cmd_help` |
| Registrar algo nuevo en el panel | `ai_event <tipo> clave=valor` en `bin/ai` + `run_state()` en `lib/aiwatch.py` + `dashboard/index.html` |

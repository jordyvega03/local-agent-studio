# Agente local de desarrollo

[![CI](https://github.com/jordyvega03/local-agent-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/jordyvega03/local-agent-studio/actions/workflows/ci.yml)

Sistema de dos agentes para desarrollar aplicaciones personales en un MacBook M4 / 24 GB:

- **Opus (Claude Code)** analiza el proyecto y escribe un plan detallado. Solo puede leer.
- **Un modelo local** (Ollama, por defecto `gpt-oss:20b`) ejecuta el plan paso a paso
  con [Aider](https://aider.chat) **dentro de un contenedor Docker endurecido**.
- Todo se controla con un único comando: **`ai`**.

```
ai up                                   # enciende (Docker + Ollama + modelo en RAM)
ai plan mi-app "agregar login con email"  # Opus escribe mi-app/.ai/plans/…md
ai exec mi-app                          # el modelo local lo implementa en la rama ai/…
ai review mi-app                        # Opus revisa el diff
ai agent tester mi-app "tests para X"   # agentes con roles: coder, tester, reviewer, docs
ai flow feature mi-app "login con email" # flujo: plan → (apruebas) → exec → tester → review
ai dashboard mi-app                     # panel web en vivo de los agentes
ai studio mi-app                        # AI Studio: la interfaz React (en construcción)
ai down                                 # apaga y libera ~14 GB de RAM
```

---

## Requisitos (ya instalados)

| Componente | Para qué | Instalación |
|---|---|---|
| Docker Desktop | Aislar al ejecutor | ya estaba |
| Ollama (brew) | Correr el modelo con GPU Metal | `brew install ollama` |
| Claude Code | Planificador Opus (usa tu login) | ya estaba |
| Imagen `paulgauthier/aider` | Ejecutor dentro del contenedor | `ai up` la descarga |
| `python3` (el de macOS) | Vista en vivo de `ai plan` y `ai dashboard` | viene con las Command Line Tools |
| Node.js >= 22.18 | AI Studio (`ai studio`) | `brew install node` |
| Modelo `gpt-oss:20b` | Cerebro del ejecutor (~14 GB) | `ai up` lo descarga |

El comando `ai` está enlazado en `~/.local/bin/ai` → `bin/ai`. Para reinstalarlo:

```bash
ln -sf ~/Documents/agents/bin/ai ~/.local/bin/ai
```

## Flujo de trabajo

### 1. Encender

```bash
ai up
```

Abre Docker Desktop si está cerrado, arranca Ollama **solo en 127.0.0.1**, descarga lo que
falte y precarga el modelo en memoria.

### 2. Planificar con Opus

```bash
ai plan mi-app "agregar endpoint GET /tasks con paginación"
```

- `mi-app` es una carpeta dentro de `~/Documents` (configurable con `PROJECTS_ROOT`),
  o una ruta cualquiera.
- Claude Code corre en modo **solo lectura** (`Read`, `Glob`, `Grep`).
- Mientras trabaja ves en la terminal cada archivo que lee y cada búsqueda
  (`📖 Read src/app.ts`, `🔎 Grep "router"`).
- El plan queda en `mi-app/.ai/plans/AAAAMMDD-HHMM-<tarea>.md`.
- **Revísalo y edítalo antes de ejecutar.** Es lo más barato de corregir.

El formato del plan lo define `prompts/planner.md`: secciones `### Paso N` con archivo,
cambio y verificación. `ai exec` depende de ese formato.

### 3. Ejecutar con el modelo local

```bash
ai exec mi-app                 # último plan, paso a paso, automático
ai exec mi-app .ai/plans/X.md  # un plan concreto
ai exec mi-app --from 3        # reanudar desde el paso 3
ai exec mi-app -i              # modo chat: tú guías, el plan está cargado como contexto
```

Lo que hace `ai exec`:

1. Comprueba que Ollama y Docker estén arriba.
2. Si el proyecto no es repo git, ofrece inicializarlo.
3. Crea la rama **`ai/<nombre-del-plan>`**. Tu rama original queda intacta.
4. Divide el plan en pasos y, por cada paso, lanza un contenedor efímero de Aider que:
   - ve **solo** la carpeta del proyecto,
   - recibe el plan completo como contexto de solo lectura y únicamente ese paso como orden,
   - hace un commit por cambio.
5. Si un paso falla, te dice cómo reanudar.

### 4. Revisar

```bash
ai review mi-app        # Opus revisa el diff de la rama ai/… contra tu rama
git diff main...HEAD    # o revisa tú
git switch main && git merge ai/<plan>   # si te gusta
git branch -D ai/<plan>                  # si no
```

### Agentes con roles

```bash
ai agent list                                   # los que hay en agents/*.env
ai agent tester mi-app "tests de saludar(): normal y nombre vacío"
ai agent coder mi-app "valida que el email no esté vacío en el registro"
ai agent reviewer mi-app "céntrate en seguridad"
ai agent docs mi-app "documenta el endpoint /tasks en el README"
```

| Agente | Motor | Qué hace |
|---|---|---|
| **coder** | modelo local, contenedor | Implementa una tarea pequeña sin plan previo y verifica |
| **tester** | modelo local, contenedor | Escribe tests y ejecuta las comprobaciones del proyecto |
| **reviewer** | Opus, solo lectura | Revisa el diff de la rama del agente con el foco que le digas |
| **docs** | modelo local, contenedor | Actualiza README y documentación |

- Los que escriben trabajan en el contenedor endurecido, en una rama `ai/…` (o en la rama
  `ai/*` en la que estés, así el Tester prueba lo que hizo `ai exec`).
- **Verificación** (`AGENT_VERIFY='auto'`): tras el agente se ejecuta en el contenedor el
  comando de comprobación del proyecto: `npm test` si hay script `test`, si no
  `npm run typecheck` (también en `apps/*` y `packages/*`), y `pytest` si hay
  `pytest.ini`/`conftest.py`. Para fijarlo: `mi-app/.ai/project.env` con
  `VERIFY_CMD='npm run lint && npm test'`. Usa los `node_modules` del proyecto tal cual
  (no instala nada: instalar en Linux rompería los de tu Mac).
- Un agente con motor **claude** (Opus) corre en tu Mac, fuera del contenedor: por eso
  **solo puede ser de lectura**.
- Crea los tuyos en el Studio (pestaña **Agentes**) o a mano: formato en `agents/README.md`.

La imagen del contenedor es la de Aider + Node 22 + pytest (`docker/executor/Dockerfile`).
`ai up` la construye si falta; `ai build` la reconstruye.

### Flujos multiagente

```bash
ai flow list
ai flow feature mi-app "añadir login con email"     # plan → pausa → exec → tester → review
ai flow quickfix mi-app "validar email vacío"       # coder → tester
ai flow feature mi-app "…" --yes                    # sin pausas (aprueba solo)
```

- **feature**: Opus planifica y el flujo **se para** para que revises (o edites en el
  Studio) el plan. Apruebas con `s` en su terminal o con **Aprobar** en el Studio; luego
  el modelo local lo ejecuta, el Tester lo prueba y Opus revisa.
- **Reintentos**: si falla la verificación de una etapa (tests/typecheck), el agente de
  arreglo (Coder) recibe la salida del fallo y lo intenta otra vez (`FLOW_MAX_RETRIES`).
- Cada etapa crea su propia sesión (visible en el Studio); la del flujo las enlaza.
- Formato y cómo crear los tuyos: `flows/README.md`.

### Extras: notificaciones, autocompletado y tema

- **Notificaciones de macOS** al terminar o fallar `plan`, `exec`, `review`, agentes y
  flujos, y cuando un flujo **espera tu aprobación** (dentro de un flujo solo avisa el
  flujo). `NOTIFY=0` en `config.env` las apaga; `NOTIFY_SOUND` elige el sonido. La primera
  vez macOS puede pedir permiso para "Editor de Scripts" (Ajustes → Notificaciones).
- **Autocompletado zsh**: `ai completion` imprime las líneas para tu `~/.zshrc`. Completa
  comandos, proyectos (de `PROJECTS_ROOT`), planes, agentes, flujos y modelos.
- **Tema del Studio**: selector automático (como macOS) / claro / oscuro en la cabecera.

### Ver a los agentes trabajar (panel web)

```bash
ai dashboard mi-app     # abre http://127.0.0.1:8765 en el navegador
ai dashboard stop       # lo detiene (ai down también)
```

Una página que se actualiza sola y muestra, por cada plan:

- **Pipeline** Análisis → Ejecución → Revisión, con el estado de cada etapa.
- **Análisis (Opus):** cada archivo que leyó y cada búsqueda, con la hora, la duración
  y el plan completo (botón "ver plan").
- **Ejecución (modelo local):** barra de progreso, pasos con estado, duración, archivos y
  commits de cada uno.
- **Salida del paso:** lo mismo que ves en la terminal de Aider, en vivo. Haz clic en
  cualquier paso para ver su salida.
- **Revisión (Opus):** el texto de `ai review`.
- **Sistema:** modelo cargado y % en GPU, RAM libre del Mac y contenedores activos.

Puedes tener el panel abierto mientras lanzas `ai plan` / `ai exec` en otra terminal.
Solo escucha en `127.0.0.1` y es de solo lectura (ver `docs/SECURITY.md`). El puerto
se cambia con `DASHBOARD_PORT` en `config.env`.

Los datos salen de `mi-app/.ai/logs/` (ver `docs/ARCHITECTURE.md`). `ai exec -i` y
`ai chat` no se graban: ahí ya estás tú en la terminal.

### AI Studio (interfaz React, en construcción)

```bash
ai studio mi-app        # instala/compila si hace falta y abre http://127.0.0.1:8766
ai studio stop          # lo detiene (ai down también)
ai studio --rebuild     # recompila la UI y reinicia el servidor
```

La nueva interfaz del plan [`docs/PLAN-STUDIO.md`](docs/PLAN-STUDIO.md). Cuatro pestañas:

- **Sesión** (Fase 0): lo mismo que `ai dashboard` (sesiones en la barra lateral, etapas,
  lecturas de Opus, pasos, revisión) con datos por WebSocket y la salida de Aider en una
  terminal real (xterm.js, con colores).
- **Sistema** (Fase 1): CPU, GPU, memoria y swap del Mac en tiempo real (1 muestra/s, 15 min
  de histórico, rangos 1/5/15 min), uso por núcleo, procesos del agente (Ollama, Docker,
  Claude Code), contenedores de Aider frente a su límite y el modelo cargado. Avisa si la
  memoria libre baja de `STUDIO_ALERT_MEM_FREE`, si el swap pasa del 80 %, si un contenedor
  roza su límite o si el modelo no cabe entero en GPU. Cada gráfica tiene "ver tabla".

- **Tokens** (Fase 2): medidor en vivo (tokens generados, tok/s y tiempo hasta el primer
  token mientras el modelo responde), velocidad y tamaño de cada petición, y tablas por
  modelo, por sesión y de las últimas peticiones. En **Sesión** cada paso muestra sus
  tokens y hay un resumen con los del ejecutor y los de Opus (plan + revisión).

- **Acciones** (Fase 3): lanza `plan`, `exec` (desde el paso N o en modo chat), `review`,
  `chat`, cambiar de modelo o `ai up` desde la web. Cada trabajo es `bin/ai` en una
  terminal real que ves en el navegador: puedes responder a "¿Continuar? [s/N]", escribir
  en el chat de Aider o pulsar Ctrl+C. Van en cola de uno en uno y se pueden cancelar. En
  **Sesión** hay atajos (Ejecutar plan, Reanudar desde el paso que falló, Chat con el plan,
  Revisar) y el plan se puede **editar** antes de ejecutarlo.

Lo lanzado desde la web queda registrado igual que desde la terminal. Si paras el Studio
(`ai studio stop`, `--rebuild` o `ai down`) con un trabajo en marcha, recibe Ctrl+C.

- **Agentes** (Fase 4): ver, crear y editar agentes y lanzarlos ("Usar"). Una ejecución de
  agente aparece en Sesión con su tarjeta (motor, tarea, lo que leyó o respondió), sus
  pasos (agente + verificación), su salida y sus tokens.

- **Proyecto**: las ramas `ai/…` que crearon los agentes con su **diff visual** frente a la
  rama base (unificado o lado a lado, por rama o por commit), sus commits, enlace a la
  sesión que las creó y los comandos para fusionar o descartar (para copiar: la web no toca
  tu `main`). Y la **documentación** del proyecto (README, `docs/`, planes) renderizada.
- **Flujos** (Fase 5): en Agentes, la lista de flujos con sus etapas, pausas y reintentos
  ("Usar"); en Sesión, el flujo como diagrama de etapas con enlace a la sesión de cada una y
  los botones **Aprobar / Rechazar** cuando espera (sirven también para flujos lanzados
  desde la terminal).

### Medidor de tokens

`ai up` arranca un proxy mínimo (`lib/aiwatch.py meter`, `127.0.0.1:11435`) entre Aider y
Ollama. Reenvía todo tal cual y, al terminar cada respuesta, registra tokens de prompt y de
salida, tiempos, tokens/s y tiempo hasta el primer token en `logs/tokens.jsonl` y en
`mi-app/.ai/logs/<plan>.tokens.jsonl` (con el paso al que pertenece). Se desactiva con
`TOKEN_METER=0` en `config.env`; entonces Aider habla directamente con Ollama.

- Necesita **Node >= 22.18** (`STUDIO_MIN_NODE`). La primera vez hace `npm ci` (versiones
  fijadas en `studio/package-lock.json`) y compila la UI.
- Cada arranque genera un **token nuevo**; `ai studio` abre el navegador ya autenticado.
  Si abres `http://127.0.0.1:8766` a mano verás "Sesión no válida": usa `ai studio`.
- Desarrollo de la UI con recarga en caliente: ver `studio/README.md`.
- **URLs cortas**: `/calorie-tracker` (su sesión más reciente), `/calorie-tracker/20261014-1225`
  (una sesión, por su fecha-hora), `/calorie-tracker/proyecto` (y `acciones`, `agentes`,
  `tokens`, `sistema`). Los botones atrás/adelante del navegador funcionan. Los enlaces
  antiguos (`?project=…&run=…`) se convierten solos.

En todos los comandos, el proyecto puede ser la ruta, la carpeta dentro de `PROJECTS_ROOT`
(`personal/calorie-tracker`) o **el nombre de un proyecto que ai ya conoce**
(`ai studio calorie-tracker`, `ai exec calorie-tracker`).

### 5. Apagar y liberar memoria

```bash
ai down          # descarga el modelo + detiene Ollama + borra contenedores
ai down --all    # además cierra Docker Desktop (libera también su VM)
```

## Comandos

| Comando | Descripción |
|---|---|
| `ai up [--no-warm]` | Arranca todo. `--no-warm` no precarga el modelo |
| `ai down [--all]` | Libera memoria. `--all` cierra Docker Desktop |
| `ai status` | Estado de Ollama/Docker/medidor, modelos en RAM, % de memoria libre |
| `ai plan <proy> "tarea"` | Opus genera el plan |
| `ai exec <proy> [plan] [-i] [--from N]` | El modelo local ejecuta |
| `ai review <proy>` | Opus revisa el diff |
| `ai chat <proy> [args aider]` | Chat libre con Aider + modelo local |
| `ai dashboard [proy]` / `ai dashboard stop` | Panel web en vivo (127.0.0.1) / detenerlo |
| `ai studio [proy]` / `ai studio stop` / `--rebuild` | AI Studio (React, con token) / detener / recompilar |
| `ai architect <proy>` | Aider architect: Opus + local en un solo chat (requiere `ANTHROPIC_API_KEY`) |
| `ai agent list` / `ai agent <id> <proy> "tarea"` | Agentes con roles (`agents/*.env`) |
| `ai flow list` / `ai flow <id> <proy> "tarea" [--yes]` | Flujos multiagente (`flows/*.env`) |
| `ai completion` | Cómo activar el autocompletado de zsh (`completions/_ai`) |
| `ai build` | (Re)construye la imagen del ejecutor (Aider + Node + pytest) |
| `ai models` / `ai pull X` / `ai rm X` | Gestión de modelos |
| `ai use <modelo>` | Cambia el ejecutor en `config.env` |
| `ai logs` | Log de Ollama en vivo |
| `ai config` | Abre `config.env` |

## Estructura del repo

```
agents/
├── bin/ai                       # CLI principal (bash 3.2 compatible)
├── config.env                   # TODA la configuración: modelos, contexto, límites
├── docker/
│   ├── compose.yml              # contenedores endurecidos (executor, architect)
│   └── aider/
│       ├── aider.conf.yml       # config de Aider (montada solo lectura)
│       └── model-settings.yml   # ajustes por modelo (num_ctx, edit_format)
├── agents/*.env                 # agentes con roles (formato en agents/README.md)
├── flows/*.env                  # flujos multiagente (formato en flows/README.md)
├── completions/_ai              # autocompletado de zsh (ai completion)
├── prompts/planner.md           # instrucciones que recibe Opus para planificar
├── prompts/agents/*.md          # instrucciones de cada agente
├── docker/executor/Dockerfile   # imagen del ejecutor: Aider + Node + pytest
├── lib/aiwatch.py               # eventos, análisis en vivo y servidor del panel
├── .github/workflows/ci.yml     # CI: tests, typecheck, shellcheck, compose, imagen
├── dashboard/index.html         # panel web (sin dependencias externas)
├── studio/                      # AI Studio: server/ (Fastify), ui/ (React), shared/ (tipos)
├── docs/
│   ├── ARCHITECTURE.md          # cómo funciona por dentro
│   ├── SECURITY.md              # modelo de amenazas y medidas
│   ├── MODELS.md                # elección de modelos y memoria
│   ├── TROUBLESHOOTING.md       # problemas comunes
│   └── ROADMAP.md               # mejoras futuras
├── logs/                        # (generado) ollama.log, dashboard.log
└── run/                         # (generado) pids y lista de proyectos del panel
```

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Seguridad](docs/SECURITY.md)
- [Modelos y memoria](docs/MODELS.md)
- [Solución de problemas](docs/TROUBLESHOOTING.md)
- [Roadmap / mejoras futuras](docs/ROADMAP.md)
- [Plan: AI Studio (interfaz web)](docs/PLAN-STUDIO.md)

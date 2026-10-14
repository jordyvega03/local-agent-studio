# Roadmap / mejoras futuras

Ideas ordenadas por valor y esfuerzo. Al implementar una, muévela a "Hecho" con la fecha.

## Próximas

- [ ] **AI Studio** (interfaz web con React): sesiones y tokens del ejecutor, comandos
      desde la web, CPU/RAM/GPU en tiempo real y agentes con roles (coder, tester,
      reviewer) y flujos. Plan completo por fases en [`PLAN-STUDIO.md`](PLAN-STUDIO.md).
      Incluye y sustituye a "Interfaz gráfica" (abajo).

- [ ] **Red restringida para el executor.** Una red Docker `internal: true` más un proxy
      (por ejemplo, un contenedor con `socat`) que solo reenvíe a Ollama. Así el
      contenedor no podría salir a internet. Añadir un flag `ai exec --online` para
      cuando haga falta instalar dependencias.
- [ ] **Verificación automática por paso.** Ejecutar el comando de `**Verificación:**`
      de cada paso (en el mismo contenedor) y, si falla, reintentar el paso una vez
      pasando el error al modelo.
- [ ] **Dependencias Linux para la verificación**: volumen propio por proyecto para
      `node_modules` (y `.venv`) dentro del contenedor, para proyectos con dependencias
      nativas de macOS. Hoy la verificación usa los `node_modules` del Mac.
- [ ] **Interfaz gráfica.** Opción A: VS Code + Roo Code/Cline en un Dev Container, con el
      mismo Ollama y modos Plan (Opus) / Act (local). Opción B: Open WebUI en Docker,
      solo para chat.

## Ideas

- [ ] Probar **Docker Model Runner** (`docker model run`) como backend alternativo a
      Ollama (también usa Metal). Comparar velocidad y memoria.
- [ ] Probar **MLX** (LM Studio o `mlx_lm.server`) como backend: suele ser algo más rápido
      en Apple Silicon.
- [ ] Probar **OpenCode** como ejecutor alternativo (agentes plan/build con modelos
      distintos).
- [ ] `ai plan --interactive`: abrir Claude Code en modo plan para discutir antes de
      escribir el plan.

## Hecho

- [x] 2026-10-14 — **AI Studio, Fase 6 (extras)**: notificaciones de macOS (fin/fallo de
      plan, exec, review, agentes y flujos; flujo esperando aprobación), autocompletado zsh
      (`ai completion`) y selector de tema automático/claro/oscuro en el Studio.

- [x] 2026-10-14 — **AI Studio, Fase 5**: flujos multiagente (`ai flow`, `flows/*.env`):
      feature (plan → aprobación → exec → tester → review) y quickfix (coder → tester),
      reintentos con el agente de arreglo, aprobación desde la terminal o el Studio y
      diagrama del flujo en Sesión.

- [x] 2026-10-14 — **AI Studio, Fase 4**: agentes con roles (`ai agent`, `agents/*.env`):
      coder, tester, reviewer, docs; verificación automática en el contenedor; imagen propia
      del ejecutor (Aider + Node + pytest, `ai build`); pestaña Agentes para crearlos y
      editarlos. Cubre "Imagen propia del executor".

- [x] 2026-10-14 — **AI Studio, Fase 3**: acciones desde la web (plan, exec, review, chat,
      modelo, up) con cola, terminal interactiva (node-pty + xterm.js), cancelación,
      atajos en Sesión, editor de planes (CodeMirror) y auditoría.

- [x] 2026-10-14 — **AI Studio, Fase 2**: medidor de tokens entre Aider y Ollama (por
      petición, paso y sesión), tokens de Opus en plan y revisión, pestaña Tokens con
      medidor en vivo y comparación por modelo y sesión. Completa "Métricas" (tokens/s).

- [x] 2026-10-14 — **AI Studio, Fase 1**: pestaña Sistema con CPU, GPU, memoria y swap en
      tiempo real, núcleos, procesos del agente, contenedores, modelo y avisos.
- [x] 2026-10-14 — **Arreglo:** Aider ya no escribe "Your Name" en el `.git/config` del
      proyecto (identidad de git efímera en el contenedor).

- [x] 2026-10-14 — **AI Studio, Fase 0** (`ai studio`): servidor Fastify + UI React con
      token por sesión, Host/Origin, WebSocket en vivo y terminal xterm.js; misma
      información que `ai dashboard`. Ver `PLAN-STUDIO.md` para las fases siguientes.

- [x] 2026-10-14 — **Panel web `ai dashboard`** (127.0.0.1, solo lectura): pipeline
      Análisis → Ejecución → Revisión, lecturas de Opus en vivo, pasos con estado, duración
      y commits, salida de Aider en vivo, revisión y estado del sistema. `ai plan` muestra
      en la terminal lo que lee Opus. Registro por plan en `proyecto/.ai/logs/`.
      Cubre parte de "Métricas" (tiempo por paso); quedan los tokens/s.

- [x] 2026-10-12 — Versión inicial: `ai up/down/status/plan/exec/review/chat/architect`,
      Ollama nativo solo en localhost, executor Aider en contenedor endurecido,
      ejecución paso a paso en una rama `ai/*`.

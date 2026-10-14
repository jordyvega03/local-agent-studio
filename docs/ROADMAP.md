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
- [ ] **Imagen propia del executor** con las toolchains de tus proyectos (Node, Python,
      Java…), para que el agente pueda correr tests. Basada en `paulgauthier/aider`.
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
- [ ] Notificación de macOS al terminar `ai exec` (`osascript -e 'display notification …'`).
- [ ] Métricas: tokens/s por paso (el tiempo por paso ya está en el panel).
- [ ] Autocompletado zsh para `ai` (comandos y proyectos de `PROJECTS_ROOT`).

## Hecho

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

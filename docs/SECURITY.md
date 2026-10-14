# Seguridad

## Modelo de amenazas

| Riesgo | Ejemplo | Mitigación |
|---|---|---|
| El modelo local hace algo destructivo | `rm -rf`, borrar archivos fuera del proyecto | Contenedor que **solo ve la carpeta del proyecto**. Rama git propia y auto-commits para revertir. |
| Robo de credenciales | Leer `~/.ssh`, `~/.aws`, tokens, keychain | Nada de tu `$HOME` se monta. No se pasan API keys al `executor`. `bin/ai` se niega a montar `$HOME`, `~/Documents`, `~/.ssh`, etc. |
| Escalada dentro del contenedor | Instalar paquetes del sistema, `sudo` | Usuario 1000 sin privilegios, rootfs **read-only**, `cap_drop: ALL`, `no-new-privileges` |
| Agotar recursos del Mac | Bucle infinito, fork bomb | `mem_limit 2g`, `cpus 4`, `pids_limit 512` |
| Exponer el modelo a la red | Que alguien en el WiFi use tu Ollama | Ollama escucha solo en `127.0.0.1` |
| Prompt injection desde el repo | Un README malicioso que da órdenes al agente | El planificador es de solo lectura. El ejecutor está aislado. Revisas el plan y el diff antes de mergear. |
| Otra web o alguien de la red lee el panel | Una página maliciosa que consulta `127.0.0.1:8765` | El panel escucha solo en `127.0.0.1`, rechaza cualquier `Host` que no sea `127.0.0.1`/`localhost` (DNS rebinding), es de solo lectura (solo `GET`), solo sirve proyectos registrados en `run/projects` y nombres de plan sin rutas. Cabeceras CSP estrictas y sin CDNs. |
| Otra web o app local usa el Studio | Una página en `localhost:3000` abre `ws://127.0.0.1:8766/ws` con tu cookie | Solo `127.0.0.1`; token aleatorio por arranque (`run/studio.token`, permisos 600) cambiado por cookie `HttpOnly` + `SameSite=Strict`; **Origin** obligatorio y permitido en WebSocket y en todo lo que no sea `GET` (SameSite no distingue puertos de localhost); **Host** permitido; CSP sin scripts en línea. |
| La web lanza algo que no debe | Una petición a `/api/jobs` con `rm -rf` o un proyecto fuera de `~/Documents` | Lista cerrada de acciones con argumentos validados (`server/actions.ts`, con tests); sin shell (argv directo a node-pty); proyectos con `realpath` dentro de `PROJECTS_ROOT`; `down` no está permitido; POST/PUT exigen cookie + `Origin` permitido; auditoría en `logs/studio-audit.jsonl`. El contenedor del agente sigue con el mismo endurecimiento. |
| Un agente edita tu Mac fuera del contenedor | Un agente con motor claude y permiso de escritura | Prohibido en `bin/ai` y en el Studio: `AGENT_ENGINE='claude'` exige `AGENT_ACCESS='read'` (solo Read/Glob/Grep). Los agentes que escriben usan siempre el contenedor. |
| Un archivo de agente ejecuta código | Un `AGENT_NAME` con `'; rm -rf ~` escrito desde la web | `bin/ai` lee los `.env` de agentes con `sed`, **sin ejecutarlos**; el Studio valida y escribe valores sin comillas, `$`, `\`, `#` ni saltos de línea (tests en `server/agents.test.ts`). |
| La verificación hace algo malo | Un `VERIFY_CMD` hostil en `.ai/project.env` de un repo ajeno | Se ejecuta solo dentro del contenedor endurecido (mismo aislamiento que Aider). Revisa ese archivo en repos de terceros. |
| Un flujo avanza sin tu visto bueno | Aprobar una pausa desde otra web | La decisión es `POST /api/flows/decision` (cookie + `Origin`), solo si ese flujo está esperando, y queda auditada. Los flujos se leen sin ejecutar (`agent_field`). `--yes` hay que pedirlo explícitamente. |
| Un documento del proyecto ejecuta código en el Studio | Un README con `<script>`, `onerror` o enlaces `javascript:` | `marked` + **DOMPurify** (solo HTML, sin `style`/`form`/imágenes) y CSP sin scripts en línea; enlaces `javascript:` no se siguen. Probado con un README hostil: nada se ejecuta. |
| La pestaña Proyecto ejecuta git con datos de la web | `branch=--output=/tmp/x` | Solo ramas que existen y commits de esa rama (40 hex); `execFile` sin shell; solo lectura. Tests en `server/git.test.ts`. |
| Dependencias npm comprometidas | Un paquete del Studio con código malicioso | Versiones exactas + `package-lock.json` y `npm ci`; instaladas con `--before` (sin versiones recién publicadas); npm 11 bloquea los scripts de instalación por defecto. Solo afecta al Studio, no a `bin/ai` ni al contenedor. |
| Usar el medidor como puerta a Ollama | Una web que apunta a `127.0.0.1:11435` | El medidor escucha solo en `127.0.0.1`; como reescribe `Host` hacia Ollama, comprueba él mismo que `Host` sea `127.0.0.1`, `localhost` o `host.docker.internal` (DNS rebinding) y reenvía `Origin` para que Ollama siga aplicando su control. No guarda prompts ni respuestas: solo recuentos y tiempos. |
| Telemetría y fugas | Envío de datos a terceros | `analytics-disable`, `check-update: false`, `LITELLM_LOCAL_MODEL_COST_MAP`. El modelo es 100% local. |

## Qué ve cada componente

| Componente | Archivos | Red | Credenciales |
|---|---|---|---|
| Claude Code (planner) | Proyecto, **solo lectura** (`Read`, `Glob`, `Grep`) | API de Anthropic | Tu login de Claude |
| Ollama | Sus modelos en `~/.ollama` | Solo localhost | Ninguna |
| Contenedor `executor` | `/app` = proyecto (lectura y escritura), `/config` (solo lectura) | Salida a internet + host | **Ninguna** |
| Contenedor `architect` | Igual que `executor` | Igual | Solo `ANTHROPIC_API_KEY` |
| Medidor de tokens | Escribe `logs/tokens.jsonl`, `run/meter-*.json` y `.ai/logs/<plan>.tokens.jsonl`; lee el contexto de `run/` | Solo `127.0.0.1` → Ollama | Ninguna |
| AI Studio (`ai studio`) | Lee `.ai/` de proyectos registrados; lanza `bin/ai` (lista cerrada) sobre carpetas de `PROJECTS_ROOT`; edita planes existentes | Solo escucha en `127.0.0.1` | Ninguna (token propio de sesión) |
| Panel (`ai dashboard`) | Lee `.ai/` de los proyectos registrados, `ollama ps`, `docker ps`, `memory_pressure` | Solo escucha en `127.0.0.1` | Ninguna |

## Limitaciones conocidas (honestas)

1. **El contenedor tiene salida a internet.** Lo necesita para llegar a Ollama en el host
   y para instalar dependencias si el plan lo pide. Un código malicioso podría exfiltrar
   **el contenido del proyecto montado**, pero nada más de tu Mac. Para cerrarlo, ver
   `ROADMAP.md` → *Red restringida*.
2. **`--yes-always`** en `ai exec` hace que Aider acepte sus propias propuestas, como añadir
   archivos. Los comandos de shell sugeridos están desactivados
   (`--no-suggest-shell-commands`). Si quieres aprobar cada acción, usa `ai exec -i`.
3. **El agente puede modificar `.git` del proyecto.** Lo necesita para hacer commits. En el
   peor caso podría reescribir el historial local de ese repo. Tener un remoto (GitHub)
   actualizado es tu backup.
4. **Secretos dentro del proyecto** (`.env`) son visibles para el agente. Mantén los
   secretos reales fuera de la carpeta o usa valores de desarrollo.
5. **Los registros de `.ai/logs/` contienen lo que imprimió Aider**, incluidos fragmentos
   de tu código. Se quedan en la carpeta del proyecto (ignorados por git) y el panel solo
   los sirve a `127.0.0.1`. El contenedor también puede leerlos: están dentro del proyecto.
   El panel no cambia nada de `docker/compose.yml`.
6. **Las imágenes de terceros son un riesgo de cadena de suministro.** La imagen de Aider
   está fijada a una versión (`AIDER_IMAGE`) para que no cambie sola. Actualízala a mano.
   La imagen del ejecutor (`EXECUTOR_IMAGE`) se construye en local sobre ella y sobre la de
   Node (`EXECUTOR_NODE_IMAGE`, versión fijada) con pytest de versión fijada.

## Identidad de git dentro del contenedor

Aider lee la identidad de git de los archivos de configuración y, si no la encuentra,
**escribe `user.name = Your Name` y `user.email = you@example.com` en el `.git/config`
del proyecto** (no en el contenedor). Tus commits manuales en ese repo saldrían con esa
identidad. Desde 2026-10-14 el `entrypoint` de `docker/compose.yml` crea un
`~/.gitconfig` efímero (en el tmpfs `/tmp`) con `GIT_AUTHOR_NAME/EMAIL` antes de arrancar
Aider. No añade montajes, capacidades ni privilegios: el endurecimiento no cambia. Para
revisar un proyecto antiguo, ver `TROUBLESHOOTING.md`.

## Buenas prácticas

- Haz push de tu rama principal antes de `ai exec`.
- Revisa siempre el plan antes de ejecutar y el diff antes de mergear (`ai review`).
- No ejecutes el agente sobre proyectos con credenciales de producción en archivos.
- Haz `ai down` cuando no lo uses: menos procesos escuchando (también detiene el panel).

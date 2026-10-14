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
| Telemetría y fugas | Envío de datos a terceros | `analytics-disable`, `check-update: false`, `LITELLM_LOCAL_MODEL_COST_MAP`. El modelo es 100% local. |

## Qué ve cada componente

| Componente | Archivos | Red | Credenciales |
|---|---|---|---|
| Claude Code (planner) | Proyecto, **solo lectura** (`Read`, `Glob`, `Grep`) | API de Anthropic | Tu login de Claude |
| Ollama | Sus modelos en `~/.ollama` | Solo localhost | Ninguna |
| Contenedor `executor` | `/app` = proyecto (lectura y escritura), `/config` (solo lectura) | Salida a internet + host | **Ninguna** |
| Contenedor `architect` | Igual que `executor` | Igual | Solo `ANTHROPIC_API_KEY` |
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

## Buenas prácticas

- Haz push de tu rama principal antes de `ai exec`.
- Revisa siempre el plan antes de ejecutar y el diff antes de mergear (`ai review`).
- No ejecutes el agente sobre proyectos con credenciales de producción en archivos.
- Haz `ai down` cuando no lo uses: menos procesos escuchando (también detiene el panel).

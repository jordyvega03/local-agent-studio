# Solución de problemas

### `ai: command not found`
```bash
ln -sf ~/Documents/agents/bin/ai ~/.local/bin/ai
```
`~/.local/bin` debe estar en tu `PATH`.

### "Hay un Ollama corriendo que no lanzó este script"
Tienes la app Ollama abierta o `brew services start ollama`. Ciérralos para que `ai`
controle Ollama con su configuración (solo localhost, contexto, keep-alive):
```bash
brew services stop ollama
```

### El contenedor no conecta con Ollama (`Connection refused` a host.docker.internal)
- Comprueba `ai status`: Ollama debe estar corriendo.
- Prueba la conexión desde un contenedor:
  ```bash
  docker run --rm curlimages/curl -s http://host.docker.internal:11434/api/version
  ```
- Si falla, Docker Desktop no está reenviando al localhost del host. Como último recurso,
  pon `OLLAMA_HOST="0.0.0.0:11434"` en `config.env` **y** activa el firewall de macOS
  (bloquea conexiones entrantes desde otras máquinas). Ver `SECURITY.md`.

### Va muy lento
- `ai status`: si `ollama ps` muestra `CPU/GPU` en vez de `100% GPU`, el modelo no cabe.
  Baja `OLLAMA_CONTEXT_LENGTH`, cierra apps o usa un modelo más pequeño.
- Baja la RAM de la VM de Docker (ver `MODELS.md`).

### Aider dice que el modelo no siguió el formato de edición
Cambia `edit_format: whole` para ese modelo en `docker/aider/model-settings.yml`.

### Un paso del plan falló
```bash
ai exec mi-app .ai/plans/<plan>.md --from <N>
```
O entra en modo chat para arreglarlo a mano con el agente: `ai exec mi-app -i`.

### Quiero deshacer todo lo que hizo el agente
```bash
git switch main
git branch -D ai/<plan>
```

### `ai plan` no devuelve nada
- Comprueba `claude --version` y que tengas sesión (`claude` → `/login`).
- Prueba a mano: `cd mi-app && claude -p "hola" --model opus`.

### `ai dashboard`: "El panel no arrancó"
El puerto está ocupado. Cambia `DASHBOARD_PORT` en `config.env` o mira qué lo usa:
```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN
cat ~/Documents/agents/logs/dashboard.log
```

### El panel no muestra mi proyecto o el análisis sale sin lecturas
- El panel solo lista proyectos en los que usaste `ai plan/exec/review` desde que existe,
  o que abriste con `ai dashboard mi-app`.
- Los planes creados antes no tienen registro: se ven, pero sin detalle del análisis.

### El panel dice "en curso" pero no pasa nada
Si el proceso murió sin poder registrarlo (p. ej. cerraste la terminal), el último
evento queda abierto. Relanza o reanuda: `ai exec mi-app --from <N>`.

### AI Studio: "Sesión no válida"
El token cambia en cada arranque. Ábrelo siempre con `ai studio` (no con un marcador).

### AI Studio no arranca o la UI no cambia
```bash
cat ~/Documents/agents/logs/studio.log
node -v                      # >= 22.18
ai studio --rebuild          # recompila la UI y reinicia el servidor
```
Si el puerto está ocupado, cambia `STUDIO_PORT` en `config.env`.

### Mis commits salen como "Your Name <you@example.com>"
Una versión anterior del agente dejó que Aider escribiera esa identidad en el `.git/config`
del proyecto (corregido el 2026-10-14, ver `SECURITY.md`). Compruébalo y límpialo:
```bash
git -C ~/Documents/mi-app config --local --get-regexp '^user\.'   # ¿aparece "Your Name"?
git -C ~/Documents/mi-app config --local --unset user.name        # solo si es "Your Name"
git -C ~/Documents/mi-app config --local --unset user.email       # solo si es you@example.com
git -C ~/Documents/mi-app log --all --oneline --author='Your Name'  # commits afectados
```

### La pestaña Sistema no muestra GPU o memoria
Se leen con `ioreg`, `vm_stat` y `sysctl` (sin sudo). Si sale "—", prueba a mano:
`ioreg -r -c IOAccelerator -d 1 | grep "Device Utilization"` y `sysctl kern.memorystatus_level`.

### Aider no conecta con el modelo después de activar el medidor
```bash
ai status                                  # ¿"medidor: 127.0.0.1:11435"?
curl -s http://127.0.0.1:11435/api/version # debe responder como Ollama
cat ~/Documents/agents/logs/meter.log
```
Si el medidor no arranca, `bin/ai` hace que Aider vaya directo a Ollama. Para desactivarlo
del todo: `TOKEN_METER=0` en `config.env`.

### La pestaña Tokens está vacía
Solo aparecen peticiones hechas con el medidor activo (`ai up` lo arranca). Las ejecuciones
anteriores no tienen datos de tokens.

### AI Studio: "posix_spawnp failed" al lanzar una acción
node-pty necesita que `spawn-helper` sea ejecutable; el servidor lo arregla al arrancar.
Si persiste: `chmod +x ~/Documents/agents/studio/node_modules/node-pty/prebuilds/*/spawn-helper`
y `ai studio --rebuild`.

### AI Studio: "El proyecto debe estar dentro de …"
Las acciones solo se lanzan sobre carpetas dentro de `PROJECTS_ROOT` (`config.env`).

### Un agente dice "No se detectó cómo comprobar el proyecto"
Crea `mi-app/.ai/project.env` con el comando, p. ej. `VERIFY_CMD='npm --prefix apps/web run typecheck'`.

### La verificación falla en el contenedor pero en mi Mac pasa
Se usan los `node_modules` de tu Mac. Si el proyecto tiene dependencias nativas (esbuild,
sharp, bcrypt…), sus binarios son de macOS y fallan en Linux. Usa un `VERIFY_CMD` que no
las necesite (p. ej. `tsc --noEmit`) o deja la verificación vacía para ese agente.

### `ai up` construye una imagen la primera vez
Es la imagen del ejecutor (Aider + Node + pytest), unos 30-60 s. `ai build` la reconstruye.

### Un flujo se queda parado
Está esperando tu aprobación (en el Studio verás Aprobar/Rechazar) o una pregunta de una
etapa, p. ej. "Hay cambios sin commitear… ¿Continuar?". Respóndela en su terminal
(Acciones en el Studio) o haz commit antes de lanzar el flujo.

### Ver logs
```bash
ai logs            # Ollama
ai dashboard mi-app                 # todo en el navegador
cat mi-app/.ai/logs/<plan>.jsonl    # eventos del plan
tail ~/Documents/agents/logs/tokens.jsonl   # peticiones medidas (tokens, tok/s)
tail ~/Documents/agents/logs/studio-audit.jsonl   # acciones lanzadas desde el Studio
cat mi-app/.aider.chat.history.md   # conversación de Aider
```

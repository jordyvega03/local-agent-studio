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

### Ver logs
```bash
ai logs            # Ollama
ai dashboard mi-app                 # todo en el navegador
cat mi-app/.ai/logs/<plan>.jsonl    # eventos del plan
cat mi-app/.aider.chat.history.md   # conversación de Aider
```

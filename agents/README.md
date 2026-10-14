# Agentes

Cada agente es un `agents/<nombre>.env` + sus instrucciones en `prompts/agents/<nombre>.md`.
Se lanzan con `ai agent <nombre> <proyecto> "tarea"` o desde el Studio (pestaña Agentes).
El Studio también los crea y edita (escribe estos mismos archivos).

Si el agente trabaja en la rama de un plan (`ai/<plan>`, p. ej. dentro de un flujo tras
`exec`), recibe ese plan como contexto de solo lectura para respetar su alcance.

Formato: una línea `CLAVE='valor'` por campo, **sin comillas dentro del valor**. `bin/ai`
lee los valores sin ejecutar el archivo.

| Clave | Valores | Qué hace |
|---|---|---|
| `AGENT_NAME` | texto | Nombre visible |
| `AGENT_DESCRIPTION` | texto | Para qué sirve (se muestra en `ai agent list` y el Studio) |
| `AGENT_ENGINE` | `aider` \| `claude` | `aider`: modelo local en el contenedor endurecido. `claude`: Claude Code en tu Mac |
| `AGENT_MODEL` | vacío o modelo | Vacío = `EXECUTOR_MODEL` (aider) o `PLANNER_MODEL` (claude) |
| `AGENT_ACCESS` | `write` \| `read` | `read` en aider = `--dry-run`. **Un agente `claude` solo puede ser `read`** (corre fuera del contenedor) |
| `AGENT_VERIFY` | vacío \| `auto` \| comando | Tras el agente, ejecuta una comprobación en el contenedor. `auto` = tests del proyecto, o si no typecheck (o `VERIFY_CMD` de `proyecto/.ai/project.env`) |
| `AGENT_INPUT` | vacío \| `diff` | `diff`: el agente recibe el diff de la rama del agente (solo motor claude) |

# Flujos multiagente

Un flujo encadena etapas. Se lanza con `ai flow <nombre> <proyecto> "tarea" [--yes]` o desde
el Studio. Formato: `CLAVE='valor'` sin comillas dentro (como `agents/`); `bin/ai` lo lee
sin ejecutarlo.

| Clave | Qué es |
|---|---|
| `FLOW_NAME`, `FLOW_DESCRIPTION` | Nombre y descripción |
| `FLOW_STEPS` | Etapas separadas por espacios: `plan` (Opus planifica), `exec` (el modelo local ejecuta el plan de la etapa `plan`, o el más reciente), `review` (Opus revisa el diff) o el id de cualquier agente de `agents/` |
| `FLOW_APPROVE_AFTER` | Etapas tras las que el flujo **espera tu aprobación** (en su terminal con `s/n`, o con Aprobar/Rechazar en el Studio). `--yes` las aprueba solo |
| `FLOW_MAX_RETRIES` | Si falla la verificación de una etapa (tests/typecheck), cuántas veces reintentar con el agente de arreglo |
| `FLOW_FIX_AGENT` | Agente que recibe la salida del fallo para arreglarlo (por defecto `coder`) |

Todas las etapas comparten tarea y rama: `exec` crea `ai/<plan>` y los agentes siguientes
trabajan sobre esa misma rama.

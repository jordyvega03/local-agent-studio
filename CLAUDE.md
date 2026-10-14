# CLAUDE.md

Repo del agente local de desarrollo de Jordy. Lee `README.md` y `docs/ARCHITECTURE.md` antes de cambiar nada.

## Reglas para modificar este repo

- `bin/ai` debe seguir siendo compatible con **bash 3.2** (el de macOS): sin arrays asociativos, sin `${var,,}`, sin `mapfile`.
- Toda configuración nueva va en `config.env`, con un comentario. No escribas valores fijos en el script.
- No relajes el endurecimiento de `docker/compose.yml` (read_only, cap_drop, no-new-privileges, usuario 1000, un único mount del proyecto) sin documentarlo en `docs/SECURITY.md`.
- Nunca pongas secretos en archivos del repo. `ANTHROPIC_API_KEY` solo llega por el entorno.
- `ai exec` depende del formato `### Paso N` y `**Archivo(s):**` de `prompts/planner.md`. Si cambias uno, cambia el otro.
- Cada mejora: actualiza la doc correspondiente y mueve el ítem en `docs/ROADMAP.md` a "Hecho" con la fecha.
- Valida con `bash -n bin/ai` y `docker compose -f docker/compose.yml config` (con las variables de `bin/ai`).

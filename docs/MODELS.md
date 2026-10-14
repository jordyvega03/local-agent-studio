# Modelos y memoria (M4 / 24 GB)

## Presupuesto de memoria

| Consumidor | RAM aprox. |
|---|---|
| macOS + apps (IDE, navegador) | 6–8 GB |
| VM de Docker Desktop | lo que configures (Settings → Resources); el contenedor está limitado a 2 GB |
| Modelo ejecutor + cache de contexto | 12–20 GB |

macOS deja a la GPU unos **16 GB** de la memoria unificada por defecto. Si un modelo no
cabe, Ollama pasa capas a la CPU y va bastante más lento.

**Recomendación:** baja la memoria de la VM de Docker a **4 GB** en Docker Desktop →
Settings → Resources. El agente no necesita más, porque el modelo vive fuera de la VM.

## Modelos probados como ejecutor

| Modelo | Disco/RAM | Velocidad M4 | Notas |
|---|---|---|---|
| `gpt-oss:20b` **(default)** | ~14 GB | Rápido (MoE) | Cabe entero en GPU. Buen razonamiento y uso de herramientas. |
| `qwen3-coder:30b` | ~19 GB | Rápido (MoE, 3B activos) | Mejor en código, pero justo: cierra apps pesadas o baja el contexto. |
| `devstral:24b` | ~14 GB | Medio (denso) | Entrenado para agentes de código. |

Cambiar de modelo:

```bash
ai use qwen3-coder:30b     # actualiza config.env, descarga si falta
```

Si el modelo es nuevo, añade su bloque en `docker/aider/model-settings.yml`:

```yaml
- name: ollama_chat/<modelo>
  edit_format: diff        # o "whole" si el modelo rompe los diffs
  use_repo_map: true
  extra_params:
    num_ctx: 32768
```

## Ajustes de eficiencia (config.env)

| Variable | Efecto |
|---|---|
| `OLLAMA_CONTEXT_LENGTH=32768` | Más contexto = más RAM. Bájalo a 16384 si vas justo. |
| `OLLAMA_KV_CACHE_TYPE=q8_0` | Cache de contexto cuantizada (~50% menos RAM, pérdida mínima) |
| `OLLAMA_FLASH_ATTENTION=1` | Necesario para la cache cuantizada. Más rápido. |
| `OLLAMA_KEEP_ALIVE=30m` | Descarga el modelo solo tras 30 min sin uso |
| `OLLAMA_MAX_LOADED_MODELS=1` | Evita tener dos modelos en RAM |
| `OLLAMA_NUM_PARALLEL=1` | Una petición a la vez (cada slot extra multiplica la cache) |

## Liberar memoria

| Acción | Libera |
|---|---|
| Esperar `OLLAMA_KEEP_ALIVE` | El modelo (automático) |
| `ai down` | Modelo + proceso Ollama + contenedores |
| `ai down --all` | Lo anterior + VM de Docker Desktop |

Comprueba con `ai status` (línea "free percentage").

## Si el modelo edita mal

1. Planes más pequeños y concretos: edita `prompts/planner.md` para pedir pasos más cortos.
2. Cambia `edit_format` a `whole` para ese modelo (reescribe archivos completos; más
   tokens, menos errores).
3. Prueba otro modelo (`ai use …`).
4. Para algo delicado, usa `ai architect` (Opus razona en cada paso).

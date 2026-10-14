# check=skip=InvalidDefaultArgInFrom
# (las imágenes base llegan siempre por --build-arg desde bin/ai: no hay valores por defecto)
# Imagen del ejecutor: la de Aider (versión fijada) + Node LTS + pytest, para que los
# agentes (Tester) puedan ejecutar las comprobaciones del proyecto dentro del contenedor.
# La construye `ai build` (o `ai up` si falta). Versiones: config.env (AIDER_IMAGE,
# EXECUTOR_NODE_IMAGE, EXECUTOR_PYTEST_VERSION). El endurecimiento sigue en docker/compose.yml.
ARG AIDER_IMAGE
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS node

FROM ${AIDER_IMAGE}
ARG PYTEST_VERSION
USER root
# Solo el binario de Node y npm de la imagen oficial (misma base Debian 12 que Aider).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version \
 && /venv/bin/pip install --no-cache-dir "pytest==${PYTEST_VERSION}" \
 && /venv/bin/python -m pytest --version
# Vuelve al usuario sin privilegios de la imagen de Aider (compose fija además 1000:1000).
USER 1000:1000

FROM node:24-slim@sha256:242549cd46785b480c832479a730f4f2a20865d61ea2e404fdb2a5c3d3b73ecf AS builder

WORKDIR /app

RUN npm install -g @endevco/aube@1.16.0
RUN aube config set enableGlobalVirtualStore false --location project

COPY package.json aube-workspace.yaml aube-lock.yaml ./
COPY apps/web ./apps/web
COPY apps/runtime ./apps/runtime
COPY packages ./packages

RUN install_succeeded=0; \
    for attempt in 1 2 3; do \
      if aube install --frozen-lockfile; then \
        install_succeeded=1; \
        break; \
      fi; \
      sleep_seconds=$((attempt * 20)); \
      echo "Dependency install failed on attempt ${attempt}; retrying in ${sleep_seconds}s..."; \
      sleep "${sleep_seconds}"; \
    done; \
    if [ "${install_succeeded}" != "1" ]; then \
      aube install --frozen-lockfile; \
    fi \
    && aube -F @author/web run build

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime-deps

WORKDIR /app

RUN npm install -g @endevco/aube@1.16.0
RUN aube config set enableGlobalVirtualStore false --location project

COPY package.json aube-workspace.yaml aube-lock.yaml ./
COPY apps/runtime/package.json ./apps/runtime/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages
COPY scripts/prune-aube-runtime.mjs ./scripts/prune-aube-runtime.mjs

# Adapter-node keeps a small set of runtime imports external; install them from
# the checked-in Aube lockfile instead of resolving ad hoc npm versions here.
RUN aube --filter-prod @author/runtime install --prod --frozen-lockfile \
    && mkdir -p /app/apps/web \
    && ln -s ../runtime/node_modules /app/apps/web/node_modules \
    && node /app/scripts/prune-aube-runtime.mjs /app \
    && rm -rf /app/scripts \
    && rm -rf \
      /root/.cache/aube \
      /root/.npm \
      /usr/local/bin/aube \
      /usr/local/bin/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/lib/node_modules/@endevco \
      /usr/local/lib/node_modules/corepack \
      /usr/local/lib/node_modules/npm \
      /opt/yarn*

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

LABEL org.opencontainers.image.title="author" \
  org.opencontainers.image.source="https://github.com/ivanarena/author" \
  org.opencontainers.image.licenses="MIT"

WORKDIR /app

RUN apk upgrade --no-cache libcrypto3 libssl3 \
    && rm -rf \
      /usr/local/bin/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/lib/node_modules/corepack \
      /usr/local/lib/node_modules/npm \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
      /opt/yarn*

COPY --from=runtime-deps /app /app
COPY --from=builder /app/apps/web/build ./apps/web/build
COPY LICENSE THIRD_PARTY_NOTICES.md ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NOTES_DB_PATH=/data/notes.sqlite
ENV NOTES_METRICS_PUBLIC=false
ENV NOTES_CLEANUP_ENABLED=true
ENV NOTES_CLEANUP_RUN_ON_START=true
ENV NOTES_CLEANUP_INTERVAL_MINUTES=1440
ENV NOTES_BACKUP_ENABLED=true
ENV NOTES_BACKUP_RUN_ON_START=true
ENV NOTES_BACKUP_INTERVAL_MINUTES=1440
ENV NOTES_BACKUP_RETENTION_COUNT=14

RUN mkdir -p /data && chown -R node:node /data

VOLUME ["/data"]
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/build"]

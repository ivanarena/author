FROM node:24-slim@sha256:242549cd46785b480c832479a730f4f2a20865d61ea2e404fdb2a5c3d3b73ecf AS builder

WORKDIR /app

RUN npm install -g @endevco/aube@1.16.0
RUN aube config set enableGlobalVirtualStore false --location project

COPY package.json aube-workspace.yaml aube-lock.yaml ./
COPY apps/web ./apps/web
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

FROM node:24-alpine@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14

WORKDIR /app

RUN apk upgrade --no-cache libcrypto3 libssl3
RUN npm install -g @endevco/aube@1.16.0
RUN aube config set enableGlobalVirtualStore false --location project

COPY package.json aube-workspace.yaml aube-lock.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages

# Adapter-node keeps a small set of runtime imports external; install them from
# the checked-in Aube lockfile instead of resolving ad hoc npm versions here.
RUN aube --filter-prod @author/web... install --prod --frozen-lockfile \
    && rm -rf \
      /root/.npm \
      /usr/local/bin/aube \
      /usr/local/bin/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/lib/node_modules/@endevco \
      /usr/local/lib/node_modules/corepack \
      /usr/local/lib/node_modules/npm \
      /opt/yarn*

COPY --from=builder /app/apps/web/build ./apps/web/build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NOTES_DB_PATH=/data/notes.sqlite
ENV NOTES_CLEANUP_ENABLED=true
ENV NOTES_CLEANUP_RUN_ON_START=true
ENV NOTES_CLEANUP_INTERVAL_MINUTES=1440

RUN mkdir -p /data && chown -R node:node /data

VOLUME ["/data"]
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/build"]

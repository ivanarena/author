FROM node:24-slim

WORKDIR /app

RUN npm install -g @endevco/aube@1.8.0

COPY package.json aube-workspace.yaml aube-lock.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY docs ./docs

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

FROM node:24-slim

WORKDIR /app

RUN npm install -g @endevco/aube@1.4.0

COPY package.json aube-workspace.yaml aube-lock.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY docs ./docs
COPY tests ./tests

RUN aube install && aube -F @author/web run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NOTES_DB_PATH=/data/notes.sqlite
ENV NOTES_CLEANUP_ENABLED=true
ENV NOTES_CLEANUP_RUN_ON_START=true
ENV NOTES_CLEANUP_INTERVAL_MINUTES=1440

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "apps/web/build"]

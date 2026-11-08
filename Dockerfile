# Captive Portal as a container image: the built app (API, admin panel and guest portal) on port 8080.
# PostgreSQL runs in its own container; see docker-compose.yml.

# ── Build: install everything, compile the web interface and the server ──
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
  && npm prune --omit=dev --no-audit --no-fund \
  && rm -rf web/src server/src server/test

# ── Run: Node plus the PostgreSQL client tools the backups use (pg_dump) ──
FROM node:24-trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN install -d -o node -g node /data

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Database migrations run on start
CMD ["node", "server/dist/index.js"]

ARG REGISTRY=
FROM ${REGISTRY}node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY services/gateway/package.json services/gateway/
COPY web/package.json web/
RUN npm ci --omit=dev -w services/gateway -w shared --include-workspace-root=false

FROM ${REGISTRY}node:22-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data DEMO_DIR=/app/demo MIGRATIONS_DIR=/app/db/postgres
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY services/gateway/package.json ./services/gateway/
COPY services/gateway/tsconfig.json ./services/gateway/
COPY services/gateway/src ./services/gateway/src
COPY db/postgres ./db/postgres
COPY data/demo ./demo
RUN mkdir -p /data && chown -R node:node /data /app
USER node
WORKDIR /app/services/gateway
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=8 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["../../node_modules/.bin/tsx", "src/server.ts"]

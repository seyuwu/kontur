# syntax=docker/dockerfile:1
FROM node:22.22.3-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
# Synthetic build-only settings. Runtime secrets never enter build arguments/layers.
RUN mkdir -p public && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build BETTER_AUTH_SECRET=synthetic-build-only-secret-not-valid-at-runtime-000000 npm run build

FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM base AS worker
ENV NODE_ENV=production
# Worker and migration tooling use the locked TypeScript runtime; web stays standalone.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json /app/prisma.config.ts ./
USER node
CMD ["node", "--import", "tsx", "src/worker/index.ts"]

FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY prisma ./prisma
COPY prisma.config.ts nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
# Generation reads the config but never connects to this non-secret build URL.
RUN DATABASE_URL=postgresql://build:unused@127.0.0.1:5432/build npm run db:generate
RUN npm run build

FROM dependencies AS migration
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY docker/start.cjs ./docker/start.cjs
USER node
CMD ["node", "docker/start.cjs", "migrate"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY docker/start.cjs ./docker/start.cjs
USER node
EXPOSE 3000
CMD ["node", "docker/start.cjs", "serve"]

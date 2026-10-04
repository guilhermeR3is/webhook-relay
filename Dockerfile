# o Render não escolhe o alvo do Dockerfile: ele repassa as variáveis do serviço como ARG e o último estágio vira a imagem
ARG RELAY_TARGET=server

FROM node:24-alpine AS base
RUN npm install --global pnpm@11.15.1
ENV npm_config_store_dir=/pnpm/store
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY load/package.json load/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# prisma generate exige a variável mesmo sem conectar; o valor real só existe em execução
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @relay/db build \
  && pnpm --filter @relay/api build \
  && pnpm --filter @relay/worker build \
  && pnpm --filter @relay/server build

# separado para a imagem do servidor não esperar o build do Next
FROM build AS build-web
RUN pnpm --filter @relay/web build

# o deploy muda o estado do node_modules para só produção; por isso parte do build, e não o contrário
FROM build AS deploy
RUN pnpm --filter @relay/api deploy --legacy --prod /out/api \
  && pnpm --filter @relay/worker deploy --legacy --prod /out/worker \
  && pnpm --filter @relay/server deploy --legacy --prod /out/server

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app

FROM runtime AS api
COPY --from=deploy --chown=node:node /out/api ./
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=deploy --chown=node:node /out/worker ./
CMD ["node", "dist/main.js"]

FROM runtime AS server
COPY --from=deploy --chown=node:node /out/server ./
CMD ["node", "dist/main.js"]

FROM runtime AS web
ENV HOSTNAME=0.0.0.0 PORT=3100
COPY --from=build-web --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build-web --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
CMD ["node", "apps/web/server.js"]

FROM ${RELAY_TARGET}

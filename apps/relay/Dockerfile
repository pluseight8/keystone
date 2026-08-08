FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/relay/package.json apps/relay/package.json
RUN pnpm install --filter @keystone/relay... --no-frozen-lockfile
COPY apps/relay apps/relay
RUN pnpm --filter @keystone/relay build && pnpm deploy --filter @keystone/relay --prod /out
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --system --uid 10001 --create-home relay
COPY --from=build --chown=relay:relay /out ./
USER relay
ENTRYPOINT ["node","dist/index.js"]

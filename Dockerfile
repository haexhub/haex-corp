# syntax=docker/dockerfile:1.7

# ------------------------------------------------------------------------------
# base: node 22 + pnpm (via corepack) + git/ripgrep for the speckit project
# bootstrap and code-search endpoints. `specify` CLI for project init.
# ------------------------------------------------------------------------------
FROM node:22-alpine AS base
RUN apk add --no-cache bash git tini ripgrep python3 py3-pip
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable
# spec-kit CLI: used by project-creation to bootstrap `.specify/` in new
# projects (`specify init <slug>`). Pinned; bump via --build-arg.
ARG SPEC_KIT_VERSION=0.3.0
RUN pip3 install --break-system-packages "specify-cli==${SPEC_KIT_VERSION}" || \
    pip3 install --break-system-packages "specify-cli"
WORKDIR /app

# ------------------------------------------------------------------------------
# deps: install node_modules once; cached between dev and builder stages
# ------------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm approve-builds && \
    pnpm rebuild

# ------------------------------------------------------------------------------
# prod-deps: production-only node_modules for the prod runtime image.
# ------------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts && \
    pnpm approve-builds && \
    pnpm rebuild

# ------------------------------------------------------------------------------
# dev: Nuxt dev server with HMR. Source is expected as a bind mount at /app.
# ------------------------------------------------------------------------------
FROM base AS dev
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p /app/.nuxt /app/.output && chown node:node /app/.nuxt /app/.output
ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=development
EXPOSE 3000
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "dev"]

# ------------------------------------------------------------------------------
# builder: produce .output/ via nuxt build
# ------------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ------------------------------------------------------------------------------
# prod: minimal runtime image.
# ------------------------------------------------------------------------------
FROM base AS prod
COPY --chown=node:node --from=builder /app/.output ./.output
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
# Drizzle's runtime migrator (server/plugins/db.ts) reads SQL files from
# disk at boot. Nitro doesn't bundle them, so we copy them explicitly.
COPY --chown=node:node --from=builder /app/server/shared/database/migrations ./server/shared/database/migrations
# Mountpoints für Bind-Volumes vorab als node anlegen.
RUN mkdir -p /app/projects /app/.specifyr && chown -R node:node /app/projects /app/.specifyr
ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production
EXPOSE 3000
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]

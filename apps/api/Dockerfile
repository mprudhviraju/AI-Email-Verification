# ── AI Email Verification — API Dockerfile ────────────────────────────────────
#
# Single image used for BOTH the API server and the worker container.
# The CMD (or docker-compose `command`) selects which role to run:
#
#   API:    node apps/api/dist/index.js     (default)
#   Worker: node apps/api/dist/worker.js
#
# Multi-stage build:
#   base    — Node + pnpm tooling
#   deps    — install all workspace deps (monorepo-aware)
#   builder — compile TypeScript → dist/
#   runner  — lean production image

# ── base ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@9 --quiet

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
# Copy only the manifests needed for pnpm to resolve the workspace.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
# packages/shared may be imported transitively; copy its manifest too.
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── builder ────────────────────────────────────────────────────────────────────
FROM deps AS builder
# Copy full source (prisma schema, src/, tsconfig)
COPY apps/api/prisma    ./apps/api/prisma
COPY apps/api/src       ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY tsconfig.base.json ./
# Copy schema.graphql — it must land next to index.js at runtime.
# The tsconfig `rootDir: src` means it won't be copied by `tsc`.
COPY apps/api/src/schema.graphql ./apps/api/dist/schema.graphql

RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm@9 --quiet

# Only copy what's needed to run
COPY --from=deps    /app/node_modules            ./node_modules
COPY --from=deps    /app/apps/api/node_modules   ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist           ./apps/api/dist
COPY --from=builder /app/apps/api/prisma         ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json

# Default: run the API server. Override in docker-compose for worker role.
CMD ["node", "apps/api/dist/index.js"]

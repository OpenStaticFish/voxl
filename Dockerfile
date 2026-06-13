# VOXL game (root package) — a single-page WebGL voxel sandbox built with Vite.
#
#   dev  : `bun run game:dev`  → Vite HMR server on :5173 (used by compose w/ bind mount)
#   prod : static build served by nginx on :80
#
# Build a specific target with:  docker build --target <dev|prod> -t voxl-game .

# ───────────────────────── Base ─────────────────────────
FROM oven/bun:1 AS base
WORKDIR /app
ENV CI=1

# ─────────────────────── Dependencies ───────────────────
# Cache layer: only rebuilds when the game's manifest/lockfile change.
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ─────────────────── Development (HMR) ──────────────────
# Source is bind-mounted at runtime by docker-compose, so we don't COPY it here —
# only the installed deps need to live in the image (kept intact via an anonymous
# volume in compose).
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 5173
CMD ["bun", "run", "game:dev"]

# ─────────────────── Production build ───────────────────
FROM base AS prod-build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ─────────────────── Production (nginx) ─────────────────
FROM nginx:1.27-alpine AS prod
COPY nginx/voxl.conf /etc/nginx/conf.d/default.conf
COPY --from=prod-build /app/dist /usr/share/nginx/html
EXPOSE 80

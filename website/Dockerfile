# VOXL marketing site (Astro). Note: the build context is the REPO ROOT, not
# `website/`, because the site embeds the game: `bun run sync:game` builds the
# root game package and copies it into `website/public/game/`.
#
#   dev  : `astro dev` on :4321 (runs sync:game once, then live-reload)
#   prod : static build served by nginx on :80
#
# Build a specific target with:  docker build --target <dev|prod> -t voxl-site .

# ───────────────────────── Base ─────────────────────────
FROM oven/bun:1 AS base
WORKDIR /app
ENV CI=1

# ─────────────────────── Dependencies ───────────────────
# The site needs BOTH manifests: its own (Astro) AND the game's, because
# `sync:game` shells out to `bun run build` at the repo root.
FROM base AS deps
# Game deps (built in-place by sync:game).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
# Site deps.
WORKDIR /app/website
COPY website/package.json website/bun.lock ./
RUN bun install --frozen-lockfile

# ─────────────────── Development (live reload) ──────────
# Source comes from the compose bind mount; the image only carries deps.
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/website/node_modules ./website/node_modules
WORKDIR /app/website
EXPOSE 4321
CMD ["bun", "run", "dev"]

# ─────────────────── Production build ───────────────────
# sync:game builds the game, Astro builds the site (game ends up under /game/).
FROM base AS prod-build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/website/node_modules ./website/node_modules
COPY . .
WORKDIR /app/website
RUN bun run build

# ─────────────────── Production (nginx) ─────────────────
FROM nginx:1.27-alpine AS prod
COPY nginx/voxl.conf /etc/nginx/conf.d/default.conf
COPY --from=prod-build /app/website/dist /usr/share/nginx/html
EXPOSE 80

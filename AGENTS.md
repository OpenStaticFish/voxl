# AGENTS.md

Guidance for OpenCode sessions in this repo.

## Layout

Two **independent** packages — not a workspace (no root `workspaces` field). Each has its own `package.json`, `tsconfig.json`, and `bun.lock`, and must be installed separately.

- `/` — **VOXL game**: browser WebGL voxel sandbox. Three.js + Vite + TypeScript. Entrypoint `src/main.ts` → `src/game/Game.ts`; `index.html` is the game shell.
- `/website` — **Astro marketing site** that builds the game and serves it embedded at `/play`.

## Install (run in both)

```bash
bun install                         # game (root)
cd website && bun install           # site
```

## Dev

`bun run dev` (from root) runs an **orchestrator** (`scripts/dev.ts`) that starts both servers at once — this is non-obvious:
- game Vite HMR → http://localhost:5173
- site Astro → http://localhost:4321 (Play → `/play` runs the game)

Granular: `bun run game:dev` (game only), `bun run site:dev` (site only). One Ctrl-C stops both when using the orchestrator.

## Build / typecheck

- Root (game): `bun run build` → `dist/` · `bun run typecheck` (`tsc --noEmit`)
- Website: `bun run build` → `website/dist/` · `bun run typecheck` (`astro check`) · `bun run preview`

## Critical: `/play` embeds a *synced copy* of the game

The site does not proxy the game dev server. `website`'s `dev`/`build` run `bun run sync:game` first, which builds the root game and copies it into `website/public/game/` (gitignored, generated). So:
- After editing **game** code, rebuild the site (or run `bun run sync:game` in `website/`) before `/play` reflects it. For a fast game loop, iterate on the game dev server (5173) directly.
- The orchestrator only syncs once at startup; it does **not** re-sync on game-code edits.

## Generated / do-not-commit

- `dist/` (root), `website/dist/`, `website/public/game/` (synced game build), `website/.astro/`
- `mineclone.md`, `website.md`, `screenshots/` — benchmark prompts/artifacts, intentionally excluded from this public repo. Don't commit them.

## Repo-specific gotchas

- **Website `base` must stay `/` (default).** Astro preview 404s on a relative `./` base. Only set `base` for subpath deploys.
- **`website/tsconfig.json` excludes `public/`.** Intentional — `public/game/` holds the minified synced bundle, which would break `astro check`. Don't re-include it.
- **Texture atlas uses `flipY = false`** (`src/engine/Textures.ts`); tile UV math depends on it.
- **Block ids must stay stable** (chunk data stores raw ids). Add a block by appending to `BLOCKS` in `src/game/Blocks.ts` **and** adding a tile painter in `src/engine/Textures.ts` (atlas is 8×8 = 64 tiles).
- **Mesher has 3 passes** (`src/game/ChunkMesher.ts` + `World.ts` materials): opaque, cutout (plantlike, alphaTest), transparent (water). Plant-like blocks need `shape: "plantlike"` in their `BlockDef`.
- **Terrain & clouds are deterministic from the seed** (`src/engine/Noise.ts`). Biome noise is single-octave, low-frequency (`~0.0008`) deliberately for large biomes — raising octaves/frequency re-fragments them into small patches.
- **Noise thresholds are tuned to the real Perlin range (~[-0.9, 0.93]).** Before adding noise-driven features (ores/caves/strata), measure percentiles or thresholds will never fire (or fire everywhere).
- **Chunk size 16×16×96**, streaming budget 2 gen + 2 mesh per frame (`src/constants.ts`).

## Conventions

- **Bun only** (runtime + lockfile). No npm/pnpm/yarn.
- TypeScript strict everywhere. The game `tsconfig.json` intentionally disables `noUncheckedIndexedAccess` (voxel array indexing is pervasive and bounds-safe) — don't re-enable without widespread `!` assertions.

## Screenshots

- In-game `P` captures the **WebGL canvas only** (not DOM overlays like the menu/HUD).
- `bun run screenshot` (root or `website/`) uses Playwright — an **optional** dep (`bun add -D playwright && bunx playwright install chromium`) and needs Chromium's system libs, often missing in headless/CI sandboxes.

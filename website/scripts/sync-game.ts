/**
 * Sync the playable VOXL game into the website so it can be served in-browser.
 *
 * The game lives at the repo ROOT (single source of truth). This script builds
 * it there, then copies its self-contained static output into
 * `website/public/game/`. Astro then serves those files at `/game/`, and the
 * `/play` route embeds them in a full-screen iframe.
 *
 * Wired into the website via:
 *   bun run sync:game            # build game + copy
 *   bun run dev / build          # both run sync:game first
 *
 * Re-running is safe: the destination is wiped before each copy.
 */
import { execSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const websiteDir = resolve(here, "..");
const repoRoot = resolve(websiteDir, "..");
const gameDist = resolve(repoRoot, "dist");
const dest = resolve(websiteDir, "public", "game");

function run(cmd: string, cwd: string): void {
  console.log(`[sync-game] $ ${cmd}  (in ${cwd})`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

async function exists(p: string): Promise<boolean> {
  try {
    await readdir(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // 1. Build the game at the repo root (produces repo-root /dist).
  run("bun run build", repoRoot);

  if (!(await exists(gameDist))) {
    throw new Error(`[sync-game] Game build did not produce ${gameDist}`);
  }

  // 2. Wipe + recreate the destination, then copy the build in.
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(gameDist, dest, { recursive: true });

  const files = await readdir(dest);
  console.log(`[sync-game] Copied ${files.length} entr${files.length === 1 ? "y" : "ies"} → public/game/`);
  console.log("[sync-game] Done. The game is now served at /game/ and embedded on /play.");
}

main().catch((err) => {
  console.error("[sync-game] Failed:", err);
  process.exit(1);
});

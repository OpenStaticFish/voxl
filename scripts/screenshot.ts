/**
 * Optional automated screenshot capture for VOXL.
 *
 * Captures `screenshots/main-menu.png` and `screenshots/in-game.png` from a
 * running dev/preview server using Playwright's full-viewport screenshot (so
 * DOM overlays like the menu and HUD are included alongside the canvas).
 *
 * Usage:
 *   bun add -D playwright
 *   bunx playwright install chromium
 *   bun run dev          # in one terminal
 *   bun run screenshot   # in another
 *
 * Override the target URL with: VOXL_URL=http://localhost:5173 bun run screenshot
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const URL = process.env.VOXL_URL ?? "http://localhost:5173";
const OUT_DIR = resolve(process.cwd(), "screenshots");

async function main(): Promise<void> {
  // Optional dependency; resolved at runtime so typecheck never depends on it.
  let chromium: { launch: (opts: object) => Promise<any> };
  try {
    const pw: any = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error(
      "[screenshot] Playwright is not installed.\n" +
        "Run: bun add -D playwright && bunx playwright install chromium",
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const browser: any = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
  page.on("pageerror", (err) => console.error("[browser:error]", err.message));

  console.log(`[screenshot] Navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  // Wait for the VOXL automation surface + main menu to be visible.
  await page.waitForFunction(() => !!(window as any).__voxl, { timeout: 15000 });
  await page.waitForSelector("#main-menu:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(800); // let the intro animation settle

  await page.screenshot({ path: resolve(OUT_DIR, "main-menu.png") });
  console.log("[screenshot] Wrote screenshots/main-menu.png");

  // Start the game and wait for chunks to stream in.
  await page.evaluate(() => (window as any).__voxl.beginPlay());
  await page.waitForFunction(
    () => (window as any).__voxl.getGameState() === "playing",
    { timeout: 15000 },
  );

  // Poll chunk count until it stabilizes (or timeout).
  let last = -1;
  let stable = 0;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(400);
    const count: number = await page.evaluate(() => (window as any).__voxl.getChunkCount());
    if (count === last) {
      stable += 1;
      if (stable >= 3 && count > 8) break;
    } else {
      stable = 0;
    }
    last = count;
  }
  console.log(`[screenshot] Chunks loaded: ${last}`);

  await page.screenshot({ path: resolve(OUT_DIR, "in-game.png") });
  console.log("[screenshot] Wrote screenshots/in-game.png");

  await browser.close();
  console.log("[screenshot] Done.");
}

main().catch((err) => {
  console.error("[screenshot] Failed:", err);
  process.exit(1);
});

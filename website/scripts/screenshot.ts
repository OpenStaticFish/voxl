/**
 * Optional visual-review capture for the VOXL marketing site.
 *
 * Captures a full-page PNG of the landing page from a running dev/preview
 * server, so you can eyeball the design without opening a browser. Playwright
 * is an OPTIONAL dependency — nothing else in the site depends on it.
 *
 *   bun install
 *   bun run preview        # in one terminal (serves http://localhost:4321)
 *   VOXL_SITE_URL=http://localhost:4321 bun run screenshot
 *
 * Output: website/preview.png
 */

import { resolve } from "node:path";

const URL = process.env.VOXL_SITE_URL ?? "http://localhost:4321";
const OUT = resolve(process.cwd(), "preview.png");

async function main(): Promise<void> {
  let chromium: { launch: (opts: object) => Promise<any> };
  try {
    const pw: any = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error(
      "[screenshot] Playwright is not installed (it's optional).\n" +
        "Run: bun add -D playwright && bunx playwright install chromium",
    );
    process.exit(1);
  }

  const browser: any = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err: Error) => console.error("[browser:error]", err.message));

  console.log(`[screenshot] Navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  await page.screenshot({ path: OUT, fullPage: true });
  console.log(`[screenshot] Wrote ${OUT}`);

  await browser.close();
}

main().catch((err) => {
  console.error("[screenshot] Failed:", err);
  process.exit(1);
});

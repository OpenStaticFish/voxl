// Build-time screenshot discovery. This runs on the server during the Astro
// build (frontmatter), so we can *honestly* render real <img> tags only when the
// PNG files actually exist, and clearly-labelled placeholders otherwise.
//
// Real screenshots belong in:  website/public/screenshots/
//   - screenshots/main-menu.png
//   - screenshots/in-game.png
// These map to the site root (/screenshots/...) because Astro serves public/ at /.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Shot {
  /** Public URL once the file exists. */
  src: string;
  /** Filesystem path under public/, checked at build time. */
  file: string;
  title: string;
  caption: string;
  alt: string;
  /** Resolved at build time — does the real PNG actually exist? */
  present: boolean;
  /** Human-readable byte size when present, else empty. */
  sizeLabel: string;
}

const SHOTS: Array<Omit<Shot, "present" | "sizeLabel">> = [
  {
    src: "/screenshots/main-menu.png",
    file: "public/screenshots/main-menu.png",
    title: "Main menu",
    caption:
      "The title screen: the VOXL wordmark, Play / Settings / Controls, and a seeded-world hint.",
    alt: "VOXL main menu showing the title, play and settings buttons over a starlit navy backdrop.",
  },
  {
    src: "/screenshots/in-game.png",
    title: "In the world",
    file: "public/screenshots/in-game.png",
    caption:
      "Generated terrain in view: grassy hills, trees, a water shoreline, the crosshair, hotbar and HUD badges.",
    alt: "VOXL in-game view of generated voxel terrain with trees, water, the HUD and hotbar.",
  },
];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getShots(root: string = process.cwd()): Shot[] {
  return SHOTS.map((s) => {
    const full = join(root, s.file);
    const present = existsSync(full);
    const sizeLabel = present ? humanSize(statSync(full).size) : "";
    return { ...s, present, sizeLabel };
  });
}

/** True only when every expected screenshot is genuinely present on disk. */
export function allShotsPresent(root: string = process.cwd()): boolean {
  return getShots(root).every((s) => s.present);
}

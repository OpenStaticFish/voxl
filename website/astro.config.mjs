// @ts-check
import { defineConfig } from "astro/config";

// VOXL marketing site — a single static landing page. Astro compiles to plain
// HTML/CSS and ships no client JS by default, which is exactly what a fast,
// accessible content page needs. No integrations required.
export default defineConfig({
  // Used for canonical URLs / sitemap generation if added later.
  site: "https://voxl.example",
  // Default base ("/") keeps dev, build and preview all serving from the root.
  // If deploying under a subpath, set `base: "/your-subpath/"`.
  compressHTML: true,
  build: {
    inlineStylesheets: "auto",
  },
  devToolbar: { enabled: false },
});

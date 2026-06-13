import { defineConfig } from "vite";

// VOXL is a single-page WebGL game. Vite gives us instant HMR in dev,
// an optimized static build, and a preview server — no framework needed.
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
    port: 5173,
  },
});

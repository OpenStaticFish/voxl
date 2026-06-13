import { Game } from "./game/Game";

// Boot the game once the DOM is ready.
function boot(): void {
  const host = document.getElementById("game-root");
  if (!host) {
    console.error("Missing #game-root element");
    return;
  }
  const game = new Game(host);
  game.start();

  // Expose a tiny automation surface for the optional Playwright screenshot
  // script (see scripts/screenshot.ts). Not part of the gameplay API.
  interface VoxlAutomation {
    beginPlay: () => void;
    screenshotDataURL: (filename?: string) => string;
    getChunkCount: () => number;
    getGameState: () => string;
    takeScreenshot: () => Promise<void>;
    // Debug hooks (not part of the gameplay API).
    debugFlat?: () => void;
    loadedChunks?: () => unknown;
  }
  (window as unknown as { __voxl?: VoxlAutomation }).__voxl = {
    beginPlay: () => game.beginPlay(),
    screenshotDataURL: (filename) => game.screenshotDataURL(filename),
    getChunkCount: () => game.getChunkCount(),
    getGameState: () => game.getGameState(),
    takeScreenshot: () => game.takeScreenshot(),
    debugFlat: () => game._enableDebugFlat(),
    loadedChunks: () => game._loadedChunks(),
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

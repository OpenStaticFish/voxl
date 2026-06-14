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
    // Lighting debug surface (see LightingSystem).
    lighting?: () => unknown;
    debugInfo?: () => Record<string, unknown>;
    // Render-debug toggles.
    wireframe?: (on?: boolean) => void;
    perf?: (on?: boolean) => void;
    waterStats?: () => unknown;
    chunkBorders?: (on?: boolean) => void;
    terrainCulling?: (on?: boolean) => void;
    renderAllChunks?: (on?: boolean) => void;
    safeMode?: (on?: boolean) => void;
    water?: (on?: boolean) => void;
    waterOpaque?: (on?: boolean) => void;
    fog?: (on?: boolean) => void;
    post?: (on?: boolean) => void;
    shadows?: (on?: boolean) => void;
    dumpMaterials?: () => void;
    // Liquid system debug surface (see LiquidSimulator).
    liquid?: () => unknown;
    placeWater?: (x?: number, y?: number, z?: number) => void;
    removeWater?: (x?: number, y?: number, z?: number) => void;
    liquidBudget?: (n: number) => void;
    // Water rendering / targeting debug toggles.
    waterSides?: (on?: boolean) => void;
    waterAnim?: (on?: boolean) => void;
    waterDepth?: (on?: boolean) => void;
    waterSimple?: (on?: boolean) => void;
    targetLiquids?: (on?: boolean) => boolean;
  }
  (window as unknown as { __voxl?: VoxlAutomation }).__voxl = {
    beginPlay: () => game.beginPlay(),
    screenshotDataURL: (filename) => game.screenshotDataURL(filename),
    getChunkCount: () => game.getChunkCount(),
    getGameState: () => game.getGameState(),
    takeScreenshot: () => game.takeScreenshot(),
    debugFlat: () => game._enableDebugFlat(),
    loadedChunks: () => game._loadedChunks(),
    lighting: () => game._lightingDebug(),
    debugInfo: () => game._debugInfo(),
    wireframe: (on) => game._setWireframe(on ?? true),
    perf: (on) => game._togglePerf(on),
    waterStats: () => game._waterStats(),
    chunkBorders: (on) => game._toggleChunkBorders(on),
    terrainCulling: (on) => game._setTerrainCulling(on ?? true),
    renderAllChunks: (on) => game._setRenderAllChunks(on ?? true),
    safeMode: (on) => game._safeMode(on ?? true),
    water: (on) => game._setWater(on ?? true),
    waterOpaque: (on) => game._setWaterOpaque(on ?? true),
    fog: (on) => game._setFog(on ?? true),
    post: (on) => game._setPost(on ?? true),
    shadows: (on) => game._setShadows(on ?? true),
    dumpMaterials: () => game._dumpMaterials(),
    liquid: () => game._liquidDebug(),
    placeWater: (x, y, z) => game._placeWater(x, y, z),
    removeWater: (x, y, z) => game._removeWater(x, y, z),
    liquidBudget: (n) => game._liquidBudget(n),
    waterSides: (on) => game._setWaterSides(on ?? true),
    waterAnim: (on) => game._setWaterAnim(on ?? true),
    waterDepth: (on) => game._setWaterDepth(on ?? true),
    waterSimple: (on) => game._setWaterSimple(on ?? true),
    targetLiquids: (on) => game._setTargetLiquids(on),
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

// Centralised, typed content for the VOXL marketing site.
// Facts here mirror the actual game implementation in this repo
// (src/constants.ts, src/game/Blocks.ts, src/game/TerrainGenerator.ts, etc.).

export const site = {
  name: "VOXL",
  version: "1.0.0",
  tagline: "An original browser-based voxel sandbox prototype.",
  description:
    "VOXL is a browser-based WebGL voxel sandbox: drop into procedurally generated terrain of plains, forests, deserts and mountains, sculpt the world block by block, fly over the canopy, and capture the view. No download, no account — open it and build.",
  stack: "Three.js · Vite · TypeScript · Bun",
  bundleGzip: "~135 kB",
  chunk: "16×16×96",
} as const;

export interface NavItem {
  label: string;
  href: string;
}

export const nav: readonly NavItem[] = [
  { label: "Features", href: "#features" },
  { label: "Showcase", href: "#showcase" },
  { label: "Controls", href: "#controls" },
  { label: "Tech", href: "#tech" },
  { label: "Status", href: "#status" },
];

export interface Feature {
  icon: string;
  title: string;
  body: string;
}

export const features: readonly Feature[] = [
  {
    icon: "⛰",
    title: "Procedural voxel terrain",
    body: "Worlds are generated from a seed using layered Perlin/fBm noise — continents, rolling hills and ridged mountain masks combine into terrain that reads clearly the moment you spawn.",
  },
  {
    icon: "▦",
    title: "Chunk streaming",
    body: "The world is organised in 16×16 columns up to 64 blocks tall. Chunks stream in around you based on view distance and unload when you leave, on a fixed per-frame budget so spawning never hitches.",
  },
  {
    icon: "❀",
    title: "Four biomes",
    body: "Grassland, forest, desert and tundra, each with its own surface blocks, flora and elevation — stitched together by heat & moisture noise, with snow capping the highest peaks.",
  },
  {
    icon: "✦",
    title: "Creative flight",
    body: "Double-tap Space to toggle between walking with real gravity and free flight. Sprint in both modes and cover huge distances to scout the landscape.",
  },
  {
    icon: "⛏",
    title: "Block breaking & placing",
    body: "Left-click breaks, right-click places. A precise voxel raycast picks the exact block you're looking at within a 6-block reach — bedrock stays unbreakable and you can't trap yourself inside a placement.",
  },
  {
    icon: "▤",
    title: "Bigger creative palette",
    body: "A nine-slot hotbar of grass, dirt, stone, sand, wood, leaves, water, snow and cactus — plus coal, iron and copper ore, sandstone, flowers and mushrooms to find across the world. Pick with 1–9, scroll, or F.",
  },
  {
    icon: "☁",
    title: "Procedural clouds & sky",
    body: "A gradient sky dome with a moving sun and drifting blocky clouds, layered with distance fog that gracefully hides the view-distance edge of the world.",
  },
  {
    icon: "✺",
    title: "Deterministic seeds",
    body: "Type any seed, hit Regenerate, and the entire world rebuilds from scratch. Every setting — view distance, FOV, clouds — persists to your browser between sessions.",
  },
];

export interface Control {
  keys: string[];
  action: string;
}

export const controls: readonly Control[] = [
  { keys: ["W", "A", "S", "D"], action: "Move around" },
  { keys: ["Mouse"], action: "Look (pointer lock)" },
  { keys: ["Space"], action: "Jump / swim up / fly up" },
  { keys: ["Space", "×2"], action: "Toggle flying" },
  { keys: ["Shift"], action: "Fly down / descend" },
  { keys: ["Ctrl"], action: "Sprint" },
  { keys: ["L-Click"], action: "Break block" },
  { keys: ["R-Click"], action: "Place block" },
  { keys: ["1", "–", "9"], action: "Select hotbar slot" },
  { keys: ["Scroll"], action: "Cycle hotbar" },
  { keys: ["F"], action: "Cycle selected block" },
  { keys: ["P"], action: "Capture screenshot" },
  { keys: ["Esc"], action: "Pause / release mouse" },
];

export interface TechItem {
  title: string;
  body: string;
}

export const techHighlights: readonly TechItem[] = [
  {
    title: "Face-culled chunk meshing",
    body: "One indexed geometry per chunk with a separate transparent pass for water. Only visible faces are emitted — neighbors cull each other — and directional brightness is baked into vertex colour so the world stays lit with no per-frame light cost.",
  },
  {
    title: "Swept-AABB voxel collision",
    body: "Movement is resolved per-axis against voxel solidity, cleanly handling walking, flying and swimming without catching on seams or tunneling through thin walls.",
  },
  {
    title: "Amanatides–Woo voxel raycast",
    body: "Block picking uses the classic DDA grid traversal for exact, stable voxel selection inside the 6-block reach — no flickering, no mis-targeted edges.",
  },
  {
    title: "Budgeted streaming + disposal",
    body: "Chunks generate (2/frame) and mesh (2/frame) closest-first in a spiral; far chunks unload and dispose their GPU geometry, so memory and framerate stay bounded on long journeys.",
  },
  {
    title: "Seeded Perlin + fBm",
    body: "All terrain derives from the seed string via a deterministic noise layer, so a given seed always reproduces the same world — rivers, ridges and caves included.",
  },
  {
    title: "Zero external art assets",
    body: "Every texture is drawn procedurally to a 16px canvas atlas at runtime. No image files to ship, no copyrighted assets — the whole look is generated in code.",
  },
];

export interface StatusItem {
  done: boolean;
  label: string;
}

export const status: readonly StatusItem[] = [
  { done: true, label: "Procedural terrain, biomes, trees, water, caves" },
  { done: true, label: "Chunk streaming with a view-distance setting" },
  { done: true, label: "Block breaking & placement with instant remeshing" },
  { done: true, label: "Walking, swimming, and creative flight" },
  { done: true, label: "Pause menu + live settings (FOV, sensitivity, clouds, seed)" },
  { done: true, label: "In-browser screenshot capture (P)" },
  { done: false, label: "Ambient occlusion for deeper block shading" },
  { done: false, label: "Day/night cycle, mobs, crafting, and sound" },
  { done: false, label: "Waves / flowing water (currently a flat transparent surface)" },
  { done: false, label: "Touch controls for mobile play" },
];

export interface BlockDef {
  name: string;
  color: string;
}

// Matches the block registry & hotbar order in src/game/Blocks.ts.
export const blockPalette: readonly BlockDef[] = [
  { name: "Grass", color: "var(--blk-grass)" },
  { name: "Dirt", color: "var(--blk-dirt)" },
  { name: "Stone", color: "var(--blk-stone)" },
  { name: "Sand", color: "var(--blk-sand)" },
  { name: "Wood", color: "var(--blk-wood)" },
  { name: "Leaves", color: "var(--blk-leaves)" },
  { name: "Water", color: "var(--blk-water)" },
  { name: "Snow", color: "var(--blk-snow)" },
  { name: "Cactus", color: "var(--blk-cactus)" },
];

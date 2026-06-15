// Centralised, typed content for the VOXL marketing site.
// Facts here mirror the actual game implementation in this repo
// (src/constants.ts, src/game/Blocks.ts, src/game/gen/*, src/game/lighting/*).

export const site = {
  name: "VOXL",
  version: "1.0.0",
  tagline: "A browser-based voxel sandbox engine, built from scratch.",
  description:
    "VOXL is a browser-based WebGL voxel sandbox: drop into procedurally generated terrain across 11 biomes — forests, deserts, taiga, rainforests and snow-capped mountains — mine and build block by block, survive a full hunger and health loop, swim through flowing water, and watch a dynamic day/night cycle roll overhead. No download, no account — open it and play.",
  stack: "Babylon.js · Vite · TypeScript · Bun",
  bundleGzip: "~1.1 MB",
  chunk: "16×16×96",
  biomes: 11,
  blocks: "37+",
  treeSpecies: 6,
  dayLength: "10 min",
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
  { label: "Roadmap", href: "/roadmap" },
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
    body: "Worlds are grown from a text seed using layered Perlin/fBm noise — continents, ridged mountains with overhangs and spires, and 3D detail noise combine into terrain that reads clearly the moment you spawn.",
  },
  {
    icon: "❀",
    title: "11 climate & elevation biomes",
    body: "Grassland, forest, dense forest, savanna, rainforest, taiga, tundra and desert compete in climate space, with ocean, bare mountain and snow-capped peaks layered on by elevation — each with its own surface, flora and trees, stitched together by heat & humidity noise with altitude-driven snow lines.",
  },
  {
    icon: "✺",
    title: "Dynamic day/night cycle",
    body: "A full 10-minute day rolls overhead with an orbital sun and moon, a multi-stop sky gradient and warm golden-hour colours. Outdoor areas keep a gentle moonlight floor so nights are atmospheric, never pitch black.",
  },
  {
    icon: "☼",
    title: "Two-channel voxel lighting",
    body: "Sun light and block light are propagated separately across 16 levels each and baked into vertex colour. Torches and glowstone keep glowing after dark, sunlight streams straight down through glass — Minetest/Luanti-style, at zero per-frame cost.",
  },
  {
    icon: "☁",
    title: "Drifting voxel clouds",
    body: "Blocky, Minetest-style cloud slabs drift across the sky on a 2D noise field and re-centre on the camera, with per-face baked shading and three quality tiers from simple to fancy.",
  },
  {
    icon: "≋",
    title: "Flowing water simulation",
    body: "A full liquid flow simulator: sources spread seven blocks, pour down openings, and renew into infinite springs. It ticks at 20 Hz on a priority queue, seeded at shores and waterfalls as chunks stream in.",
  },
  {
    icon: "❂",
    title: "Caves, ores & strata",
    body: "Worm-tunnel caves wind underground with varied widths and surface entrances on the hills. Depth-gated coal, iron and copper ore veins thread through sedimentary sandstone and gravel layers down to bedrock.",
  },
  {
    icon: "⛏",
    title: "Survival & creative modes",
    body: "Mine with timed hardness tiers and block drops, manage health, hunger and breath, take fall and cactus damage — or switch to creative for instant mining, infinite blocks and free flight. Toggle the mode any time from your inventory.",
  },
  {
    icon: "▤",
    title: "37+ blocks, 6 tree species",
    body: "Oak, birch, spruce, pine, jungle and acacia trees, plus flowers, ferns, mushrooms, papyrus and cactus. Snow, ice, sandstone, mossy stone and glowing blocks round out a palette painted entirely in code.",
  },
  {
    icon: "✈",
    title: "Real movement physics",
    body: "Per-axis swept-AABB collision against voxels, with swimming buoyancy and drag, a 3-block safe fall, sprint exhaustion and terminal velocity. Movement stays smooth without catching on seams or tunnelling through walls.",
  },
  {
    icon: "⊝",
    title: "Per-seed persistent worlds",
    body: "Type any seed and the whole world rebuilds deterministically — terrain, caves, ores and clouds. Your inventory, stats and game mode auto-save to localStorage every few seconds and reload on return.",
  },
  {
    icon: "⚙",
    title: "Scalable graphics & dev tools",
    body: "Low/Medium/High presets with render scale, FXAA and optional shadow maps, plus adaptive streaming budgets that ease off when your frame dips. Worldgen, lighting, perf and chunk-border overlays are all one keystroke away.",
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
  { keys: ["Space", "×2"], action: "Toggle flying (creative)" },
  { keys: ["Shift"], action: "Fly down / descend" },
  { keys: ["Ctrl"], action: "Sprint" },
  { keys: ["L-Click"], action: "Mine block (hold — timed in survival)" },
  { keys: ["R-Click"], action: "Place block / eat selected food" },
  { keys: ["E"], action: "Open inventory & switch mode" },
  { keys: ["1", "–", "9"], action: "Select hotbar slot" },
  { keys: ["Scroll"], action: "Cycle hotbar" },
  { keys: ["F"], action: "Cycle selected block" },
  { keys: ["F4"], action: "Toggle liquid targeting" },
  { keys: ["P"], action: "Capture screenshot" },
  { keys: ["F3"], action: "Performance overlay" },
  { keys: ["Esc"], action: "Pause / release mouse" },
];

export interface TechItem {
  title: string;
  body: string;
}

export const techHighlights: readonly TechItem[] = [
  {
    title: "Two-channel voxel light engine",
    body: "Separate sun-light and block-light propagators push brightness across 16 levels per channel, baked into vertex colour at mesh time. Day/night dimming runs entirely through shader uniforms — no remeshing when the sun moves.",
  },
  {
    title: "Luanti-style liquid simulator",
    body: "Sources and flowing cells (levels 1–7) spread horizontally and pour down openings, with renewable infinite springs and a 20 Hz priority queue. Player edits trigger an immediate burst so water reacts within a single frame.",
  },
  {
    title: "Three-pass chunk meshing",
    body: "One indexed geometry per chunk across three passes — opaque, cutout (plantlike alpha-test) and transparent (water). Only visible faces are emitted, neighbours cull each other, and directional brightness is baked in.",
  },
  {
    title: "Swept-AABB voxel collision",
    body: "Movement is resolved per-axis against voxel solidity, cleanly handling walking, flying and swimming with buoyancy and drag — no catching on seams, no tunnelling through thin walls.",
  },
  {
    title: "Amanatides–Woo voxel raycast",
    body: "Block picking uses the classic DDA grid traversal for exact, stable voxel selection inside the 8-block reach, with a Luanti-style liquid-targeting toggle so you can pick water surfaces or mine through them.",
  },
  {
    title: "Zero external art assets",
    body: "Every texture is drawn procedurally to a 16px canvas atlas (8×8 tiles) at runtime — speckled ores, hand-drawn flowers, concentric log rings. No image files to ship, nothing copyrighted.",
  },
];

export interface StatusItem {
  done: boolean;
  label: string;
}

export const status: readonly StatusItem[] = [
  { done: true, label: "Procedural terrain, 11 biomes, 6 tree species, caves & ores" },
  { done: true, label: "Dynamic day/night cycle with sun, moon & sky gradient" },
  { done: true, label: "Two-channel voxel lighting (sun + block light)" },
  { done: true, label: "Flowing water & full liquid simulation" },
  { done: true, label: "Survival mode: hunger, health, breath, fall damage, mining tiers" },
  { done: true, label: "Creative mode: flight, infinite palette, instant mining" },
  { done: true, label: "Chunk streaming with view distance 2–12" },
  { done: true, label: "Per-seed persistent saves (localStorage)" },
  { done: true, label: "Scalable graphics presets (Low / Medium / High)" },
  { done: true, label: "In-browser screenshot capture (P)" },
  { done: false, label: "Crafting & smelting (inventory grid is scaffolded)" },
  { done: false, label: "Mobs, creatures and ambient life" },
  { done: false, label: "Sound & music" },
  { done: false, label: "Touch controls for mobile play" },
];

// ---------------------------------------------------------------------------
// Roadmap — phased plan for VOXL's evolution into a full voxel sandbox.
// ---------------------------------------------------------------------------

export type PhaseStatus = "shipped" | "active" | "planned";

export interface RoadmapItem {
  title: string;
  body: string;
}

export interface RoadmapPhase {
  id: string;
  phase: string;
  status: PhaseStatus;
  title: string;
  blurb: string;
  items: RoadmapItem[];
}

export const phaseStatusLabel: Record<PhaseStatus, string> = {
  shipped: "Live now",
  active: "In progress",
  planned: "Planned",
};

export const roadmap: readonly RoadmapPhase[] = [
  {
    id: "phase-1",
    phase: "Phase 1",
    status: "shipped",
    title: "The foundation",
    blurb:
      "A complete, playable voxel engine running entirely in the browser. Every system below is live in v1.0 today — terrain, lighting, water, survival and creative play.",
    items: [
      {
        title: "Procedural terrain & 11 biomes",
        body: "Continents, ridged mountains and overhangs grown from seeded noise, dressed into 11 climate and elevation biomes from rainforest to snowy peaks.",
      },
      {
        title: "Two-channel voxel lighting",
        body: "Sun light and block light propagated separately across 16 levels, baked into vertex colour with a gamma curve so caves stay moody and torches glow at night.",
      },
      {
        title: "Flowing water simulation",
        body: "A Luanti-style liquid simulator with spreading sources, downward flow, renewable springs and a 20 Hz tick — waterfalls react the instant you place a block.",
      },
      {
        title: "Day/night cycle & atmosphere",
        body: "A 10-minute day with an orbital sun and moon, a multi-stop sky gradient, drifting voxel clouds and distance fog that hides the streaming edge.",
      },
      {
        title: "Caves, ores & strata",
        body: "Worm-tunnel caves with surface entrances, depth-gated coal/iron/copper veins and sedimentary sandstone and gravel layers down to unbreakable bedrock.",
      },
      {
        title: "Survival & creative modes",
        body: "Timed mining with hardness tiers, block drops, hunger/health/breath, fall and cactus damage — plus creative flight, an infinite palette and instant mining.",
      },
    ],
  },
  {
    id: "phase-2",
    phase: "Phase 2",
    status: "active",
    title: "Crafting & survival depth",
    blurb:
      "The survival loop grows teeth. The inventory already ships with a crafting grid scaffolded in — the next milestone is making it actually make things.",
    items: [
      {
        title: "Crafting system",
        body: "A 2×2 and 3×3 crafting grid with recipe matching, so logs become planks, planks become tools, and the blocks you mine turn into the gear you need.",
      },
      {
        title: "Smelting & furnaces",
        body: "A working furnace block: cook food for more hunger, smelt ore into ingots, fire clay and charcoal. Fuel burns on a timer with a flickering block-light glow.",
      },
      {
        title: "Tools, weapons & armour",
        body: "A tiered tool system — wood, stone, copper, iron — that changes mining speed and durability, plus weapons for the combat to come and armour that soaks damage.",
      },
      {
        title: "More ores & materials",
        body: "Gold, diamond and redstone-equivalent veins deeper in the strata, each gating new recipes and tool tiers that reward the trip underground.",
      },
      {
        title: "Farming & food chain",
        body: "Till soil, plant crops that grow over time, breed livestock for a renewable food supply — turning survival from scavenging into stewardship.",
      },
    ],
  },
  {
    id: "phase-3",
    phase: "Phase 3",
    status: "planned",
    title: "Life, danger & the wider world",
    blurb:
      "A living world needs things in it. Phase 3 populates VOXL with creatures to flee and befriend, structures to raid, and biomes that demand new strategies.",
    items: [
      {
        title: "Mobs & creatures",
        body: "Passive animals that roam and breed, and hostile mobs that spawn in the dark and underground — pathfinding, spawning rules and a full day/night threat cycle.",
      },
      {
        title: "Health, combat & death",
        body: "Melee and ranged combat with knockback and i-frames, a proper death and respawn flow, and item drops so a bad night underground actually costs something.",
      },
      {
        title: "Generated structures",
        body: "Villages, dungeons, temples and ruined outposts placed deterministically by the world seed — hand-crafted rooms worth seeking out for loot and lore.",
      },
      {
        title: "Advanced biomes",
        body: "Mangrove swamps, cherry groves, mushroom fields and more — each with unique flora, surface rules and generation, expanding the climate map beyond the launch eleven.",
      },
      {
        title: "Cave biomes & deepslate",
        body: "Lush caves dripping with foliage, dripstone caverns, and a deepslate layer beneath stone — distinct underground ecosystems that make caving worth the risk.",
      },
      {
        title: "World generation modes",
        body: "Alternate world types beyond the default mapgen — Superflat for clean builds and redstone, Amplified for extreme terrain, Large Biomes for sprawling climates, plus floating sky islands and a cavernous cave-world preset, chosen at seed time.",
      },
      {
        title: "Weather & ambient audio",
        body: "Rain and snow that fall across biomes, thunderstorms that darken the sky, and a full sound bed — footsteps, water, wind, mobs and music — to bring it alive.",
      },
    ],
  },
  {
    id: "phase-4",
    phase: "Phase 4",
    status: "planned",
    title: "Multiplayer & beyond",
    blurb:
      "The long-term vision: share VOXL with other players, mod it into something uniquely yours, and take it beyond the desktop browser.",
    items: [
      {
        title: "Multiplayer & shared worlds",
        body: "Authoritative servers with chunk-based networking, player sync, shared block edits and conflict resolution — build, survive and explore together in real time.",
      },
      {
        title: "Multiple dimensions",
        body: "Travel between parallel worlds through portal frames: a hostile Underworld of fire and lava beneath the bedrock, a silent Void of floating islands guarding an end-boss, and an Aether sky-realm above the clouds — each with its own terrain, mobs, materials and hazards.",
      },
      {
        title: "Modding API & plugins",
        body: "A stable API for registering custom blocks, items, recipes, biomes and behaviours, so the community can extend VOXL without forking the engine.",
      },
      {
        title: "Touch & mobile play",
        body: "An on-screen control scheme tuned for phones and tablets — virtual joystick, look pad, context-aware mine/place buttons — so VOXL plays anywhere a browser opens.",
      },
      {
        title: "Map sharing & seeds",
        body: "Browse and share interesting seeds, export snapshots of your builds, and jump straight into a friend's world from a link.",
      },
    ],
  },
];

export interface BlockDef {
  name: string;
  color: string;
}

// Mirrors the full creative inventory (CREATIVE_PALETTE in src/game/Items.ts),
// in the game's curated order, with the real representative UI colours from
// src/game/Blocks.ts and the food items from src/game/Items.ts.
export const blockPalette: readonly BlockDef[] = [
  { name: "Grass", color: "#5fa84a" },
  { name: "Dirt", color: "#866040" },
  { name: "Stone", color: "#808084" },
  { name: "Sand", color: "#e0d096" },
  { name: "Wood", color: "#785634" },
  { name: "Birch Wood", color: "#d8d0bc" },
  { name: "Leaves", color: "#366e2c" },
  { name: "Birch Leaves", color: "#7fae4e" },
  { name: "Spruce Leaves", color: "#2a4a2a" },
  { name: "Snowy Leaves", color: "#cdd8e6" },
  { name: "Snow", color: "#eef2fa" },
  { name: "Cactus", color: "#4e8840" },
  { name: "Snowy Grass", color: "#dfe6f2" },
  { name: "Ice", color: "#9ec4ee" },
  { name: "Desert Sand", color: "#e2c67a" },
  { name: "Desert Stone", color: "#a87856" },
  { name: "Sandstone", color: "#dec896" },
  { name: "Gravel", color: "#7a767a" },
  { name: "Mossy Stone", color: "#5e7a44" },
  { name: "Coal Ore", color: "#4a4a4e" },
  { name: "Iron Ore", color: "#b89a72" },
  { name: "Copper Ore", color: "#6aaa8c" },
  { name: "Tall Grass", color: "#6a9e4a" },
  { name: "Flower", color: "#d24440" },
  { name: "Dandelion", color: "#ecc846" },
  { name: "Mushroom", color: "#c46060" },
  { name: "Dead Bush", color: "#8a6a3a" },
  { name: "Fern", color: "#4e7e36" },
  { name: "Papyrus", color: "#9aac5a" },
  { name: "Cornflower", color: "#4a6cd6" },
  { name: "Dry Grass", color: "#9e964e" },
  { name: "Jungle Grass", color: "#2e6a28" },
  { name: "Jungle Leaves", color: "#225222" },
  { name: "Water", color: "#366ec4" },
  { name: "Apple", color: "#d24440" },
  { name: "Bread", color: "#c89a5a" },
  { name: "Cooked Beef", color: "#8a4a3a" },
  { name: "Cookie", color: "#b07a3a" },
  { name: "Golden Apple", color: "#f2c94c" },
];

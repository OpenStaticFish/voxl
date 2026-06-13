import type { BlockId } from "../types";

// Block registry. Each block maps its six faces to texture-atlas tile indices
// and carries physical/rendering flags used by the mesher and physics.

/** Face indices used across the codebase. */
export const FACE = {
  PX: 0, // +x (east)
  NX: 1, // -x (west)
  PY: 2, // +y (top)
  NY: 3, // -y (bottom)
  PZ: 4, // +z (south)
  NZ: 5, // -z (north)
} as const;

export type FaceIndex = (typeof FACE)[keyof typeof FACE];

// Texture-atlas tile indices (see Textures.ts).
const T = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD_TOP: 5,
  WOOD_SIDE: 6,
  LEAVES: 7,
  WATER: 8,
  BEDROCK: 9,
  SNOW: 10,
  SNOWY_SIDE: 11,
  ICE: 12,
  DESERT_SAND: 13,
  DESERT_STONE: 14,
  SANDSTONE_TOP: 15,
  SANDSTONE_SIDE: 16,
  GRAVEL: 17,
  COAL_ORE: 18,
  IRON_ORE: 19,
  COPPER_ORE: 20,
  CACTUS_TOP: 21,
  CACTUS_SIDE: 22,
  TALL_GRASS: 23,
  FLOWER_RED: 24,
  FLOWER_YELLOW: 25,
  MUSHROOM: 26,
  DRY_GRASS_TOP: 27,
  DRY_GRASS_SIDE: 28,
  JUNGLE_GRASS_TOP: 29,
  JUNGLE_GRASS_SIDE: 30,
  JUNGLE_LEAVES: 31,
  MOSSY_STONE: 32,
  GLOWSTONE: 33,
} as const;

/**
 * Lighting behaviour for a block (Minetest/Luanti-style). These fields drive
 * the voxel light engine (see src/game/lighting/) — they do NOT affect Babylon
 * real-time lights directly.
 *
 * Light is stored in two channels per voxel: sunlight (sky light) and block
 * light (emitted light). Both range 0..MAX_LIGHT (15).
 */
export interface BlockLightDefinition {
  /**
   * Whether sunlight may pass straight down through this block without being
   * broken (Minetest `sunlight_propagates`). Air/glass/water = true; leaves can
   * be true so canopies stay bright on top while still attenuating sideways.
   * Default: true for air and non-opaque blocks, false for opaque blocks.
   */
  sunlightPassesThrough?: boolean;
  /**
   * Whether ANY light (sun or block) spreads INTO this block (i.e. the block is
   * part of the light-conducting space). Opaque blocks are false. Air/water/
   * leaves/plants = true. Default: !opaque.
   */
  lightPassesThrough?: boolean;
  /** Light this block emits into the block-light channel (0..15). Default 0. */
  lightEmission?: number;
  /**
   * Extra light attenuation applied when light spreads through this block, on
   * top of the default -1/step decay (Minetest has no direct equivalent; this
   * is an extension point for "dense" media like deep water). Default 0.
   */
  lightAbsorption?: number;
  /** Whether this block should be added to the shadow render list. Default true. */
  castsShadows?: boolean;
  /** Whether this block's faces receive Babylon shadow mapping. Default true. */
  receivesShadows?: boolean;
}

export interface BlockDef {
  id: BlockId;
  name: string;
  /** Tile per face [PX, NX, PY, NY, PZ, NZ]. */
  tiles: readonly [number, number, number, number, number, number];
  /** Representative UI color (hex). */
  color: string;
  /** Collides with the player. */
  solid: boolean;
  /** Fully hides neighbor faces (culls them). */
  opaque: boolean;
  /** See-through (water, leaves). Faces render but don't cull opaque neighbors. */
  transparent: boolean;
  /** Acts like a fluid (no collision, lowered surface, animated material). */
  liquid: boolean;
  /** Render shape: cube (default) or plantlike (X-cross of two quads). */
  shape?: "plantlike";
  /** Voxel lighting behaviour. Omitted fields resolve to documented defaults. */
  light?: BlockLightDefinition;
}

function uniform(tile: number): readonly [number, number, number, number, number, number] {
  return [tile, tile, tile, tile, tile, tile];
}

const AIR: BlockDef = {
  id: 0,
  name: "Air",
  tiles: uniform(0),
  color: "#000000",
  solid: false,
  opaque: false,
  transparent: false,
  liquid: false,
};

export const BLOCKS: readonly BlockDef[] = [
  AIR,
  {
    id: 1,
    name: "Grass",
    tiles: [T.GRASS_SIDE, T.GRASS_SIDE, T.GRASS_TOP, T.DIRT, T.GRASS_SIDE, T.GRASS_SIDE],
    color: "#5fa84a",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 2,
    name: "Dirt",
    tiles: uniform(T.DIRT),
    color: "#866040",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 3,
    name: "Stone",
    tiles: uniform(T.STONE),
    color: "#808084",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 4,
    name: "Sand",
    tiles: uniform(T.SAND),
    color: "#e0d096",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 5,
    name: "Wood",
    tiles: [T.WOOD_SIDE, T.WOOD_SIDE, T.WOOD_TOP, T.WOOD_TOP, T.WOOD_SIDE, T.WOOD_SIDE],
    color: "#785634",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 6,
    name: "Leaves",
    tiles: uniform(T.LEAVES),
    color: "#366e2c",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
    // Leaves stay opaque for face culling, but let light spread THROUGH them
    // (Minetest: light_propagates). Sunlight does NOT pass straight down
    // (sunlightPassesThrough defaults to !opaque = false), so a thick canopy
    // dims the ground below while still letting scattered light bleed in.
    light: { lightPassesThrough: true },
  },
  {
    id: 7,
    name: "Water",
    tiles: uniform(T.WATER),
    color: "#366ec4",
    solid: false,
    opaque: false,
    transparent: true,
    liquid: true,
    // Light spreads through water but sunlight does not pass unattenuated, so
    // light decays with depth (deep water is dark).
    light: { lightPassesThrough: true, sunlightPassesThrough: false },
  },
  {
    id: 8,
    name: "Bedrock",
    tiles: uniform(T.BEDROCK),
    color: "#46464a",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 9,
    name: "Snow",
    tiles: uniform(T.SNOW),
    color: "#eef2fa",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 10,
    name: "Snowy Grass",
    tiles: [T.SNOWY_SIDE, T.SNOWY_SIDE, T.SNOW, T.DIRT, T.SNOWY_SIDE, T.SNOWY_SIDE],
    color: "#dfe6f2",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 11,
    name: "Ice",
    tiles: uniform(T.ICE),
    color: "#9ec4ee",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 12,
    name: "Desert Sand",
    tiles: uniform(T.DESERT_SAND),
    color: "#e2c67a",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 13,
    name: "Desert Stone",
    tiles: uniform(T.DESERT_STONE),
    color: "#a87856",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 14,
    name: "Sandstone",
    tiles: [T.SANDSTONE_SIDE, T.SANDSTONE_SIDE, T.SANDSTONE_TOP, T.SANDSTONE_TOP, T.SANDSTONE_SIDE, T.SANDSTONE_SIDE],
    color: "#dec896",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 15,
    name: "Gravel",
    tiles: uniform(T.GRAVEL),
    color: "#7a767a",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 16,
    name: "Coal Ore",
    tiles: uniform(T.COAL_ORE),
    color: "#4a4a4e",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 17,
    name: "Iron Ore",
    tiles: uniform(T.IRON_ORE),
    color: "#b89a72",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 18,
    name: "Copper Ore",
    tiles: uniform(T.COPPER_ORE),
    color: "#6aaa8c",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 19,
    name: "Cactus",
    tiles: [T.CACTUS_SIDE, T.CACTUS_SIDE, T.CACTUS_TOP, T.CACTUS_TOP, T.CACTUS_SIDE, T.CACTUS_SIDE],
    color: "#4e8840",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 20,
    name: "Tall Grass",
    tiles: uniform(T.TALL_GRASS),
    color: "#6a9e4a",
    solid: false,
    opaque: false,
    transparent: true,
    liquid: false,
    shape: "plantlike",
  },
  {
    id: 21,
    name: "Flower",
    tiles: uniform(T.FLOWER_RED),
    color: "#d24440",
    solid: false,
    opaque: false,
    transparent: true,
    liquid: false,
    shape: "plantlike",
  },
  {
    id: 22,
    name: "Dandelion",
    tiles: uniform(T.FLOWER_YELLOW),
    color: "#ecc846",
    solid: false,
    opaque: false,
    transparent: true,
    liquid: false,
    shape: "plantlike",
  },
  {
    id: 23,
    name: "Mushroom",
    tiles: uniform(T.MUSHROOM),
    color: "#c46060",
    solid: false,
    opaque: false,
    transparent: true,
    liquid: false,
    shape: "plantlike",
  },
  {
    id: 24,
    name: "Dry Grass",
    tiles: [T.DRY_GRASS_SIDE, T.DRY_GRASS_SIDE, T.DRY_GRASS_TOP, T.DIRT, T.DRY_GRASS_SIDE, T.DRY_GRASS_SIDE],
    color: "#9e964e",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 25,
    name: "Jungle Grass",
    tiles: [T.JUNGLE_GRASS_SIDE, T.JUNGLE_GRASS_SIDE, T.JUNGLE_GRASS_TOP, T.DIRT, T.JUNGLE_GRASS_SIDE, T.JUNGLE_GRASS_SIDE],
    color: "#2e6a28",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 26,
    name: "Jungle Leaves",
    tiles: uniform(T.JUNGLE_LEAVES),
    color: "#225222",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
    light: { lightPassesThrough: true },
  },
  {
    id: 27,
    name: "Mossy Stone",
    tiles: uniform(T.MOSSY_STONE),
    color: "#5e7a44",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
  },
  {
    id: 28,
    name: "Glowstone",
    tiles: uniform(T.GLOWSTONE),
    color: "#f4d97a",
    solid: true,
    opaque: true,
    transparent: false,
    liquid: false,
    // Debug/test emissive block. Emits maximum block light so the block-light
    // propagator can be observed (e.g. a lit radius inside a dark cave).
    light: { lightEmission: 15 },
  },
];

export const AIR_BLOCK = 0;

export function isAir(id: BlockId): boolean {
  return id === AIR_BLOCK;
}

export function getBlock(id: BlockId): BlockDef {
  return BLOCKS[id] ?? AIR;
}

/** Blocks available in the hotbar (creative palette). */
export const HOTBAR_BLOCKS: readonly BlockId[] = [1, 2, 3, 4, 5, 6, 7, 9, 19, 28];

// ---------------------------------------------------------------------------
// Lighting accessors (defaults resolved here so the engine never hardcodes
// behaviour per block id). See BlockLightDefinition for the semantics.
// ---------------------------------------------------------------------------

const MAX_LIGHT = 15;

/** Resolved (no-undefined) light definition for a block. */
export interface ResolvedLight {
  /** Sunlight may travel straight down through this block unbroken. */
  sunlightPassesThrough: boolean;
  /** Any light may spread into/through this block. */
  lightPassesThrough: boolean;
  /** Emitted block-light level (0..MAX_LIGHT). */
  lightEmission: number;
  /** Extra decay added per spread step through this block. */
  lightAbsorption: number;
  castsShadows: boolean;
  receivesShadows: boolean;
}

const cache = new Map<BlockId, ResolvedLight>();

/** Resolve a block's lighting definition with defaults applied. */
export function resolveLight(def: BlockDef): ResolvedLight {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const l: BlockLightDefinition = def.light ?? {};
  const resolved: ResolvedLight = {
    sunlightPassesThrough: l.sunlightPassesThrough ?? !def.opaque,
    lightPassesThrough: l.lightPassesThrough ?? !def.opaque,
    lightEmission: clampLight(l.lightEmission ?? 0),
    lightAbsorption: Math.max(0, l.lightAbsorption ?? 0),
    castsShadows: l.castsShadows ?? true,
    receivesShadows: l.receivesShadows ?? true,
  };
  cache.set(def.id, resolved);
  return resolved;
}

export function clampLight(v: number): number {
  return v < 0 ? 0 : v > MAX_LIGHT ? MAX_LIGHT : v;
}

export { MAX_LIGHT };

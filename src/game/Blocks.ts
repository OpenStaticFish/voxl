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
} as const;

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
];

export const AIR_BLOCK = 0;

export function isAir(id: BlockId): boolean {
  return id === AIR_BLOCK;
}

export function getBlock(id: BlockId): BlockDef {
  return BLOCKS[id] ?? AIR;
}

/** Blocks available in the hotbar (creative palette). */
export const HOTBAR_BLOCKS: readonly BlockId[] = [1, 2, 3, 4, 5, 6, 7, 9, 19];

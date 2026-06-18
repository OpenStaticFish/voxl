// Numeric block-id constants used by world generation. These mirror the ids
// assigned in Blocks.ts (BLOCKS[] is positional). Centralising them here keeps
// the gen modules free of magic numbers and makes the terrain palette easy to
// audit at a glance. IDs MUST stay stable (chunk data stores raw ids).

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const WOOD = 5;
export const LEAVES = 6;
export const WATER = 7;
export const BEDROCK = 8;
export const SNOW = 9;
export const SNOWY_GRASS = 10;
export const ICE = 11;
export const DESERT_SAND = 12;
export const DESERT_STONE = 13;
export const SANDSTONE = 14;
export const GRAVEL = 15;
export const COAL_ORE = 16;
export const IRON_ORE = 17;
export const COPPER_ORE = 18;
export const CACTUS = 19;
export const TALL_GRASS = 20;
export const FLOWER_RED = 21;
export const FLOWER_YELLOW = 22;
export const MUSHROOM = 23;
export const DRY_GRASS = 24;
export const JUNGLE_GRASS = 25;
export const JUNGLE_LEAVES = 26;
export const MOSSY_STONE = 27;
// (28 Glowstone, 29 Flowing Water — not placed by terrain gen.)
export const DEAD_BUSH = 30;
export const FERN = 31;
export const PAPYRUS = 32;
export const CORNFLOWER = 33;
export const BIRCH_WOOD = 34;
export const BIRCH_LEAVES = 35;
export const SPRUCE_LEAVES = 36;
export const SNOWY_LEAVES = 37;
// (38 Crafting Table — player-crafted via the Recipes registry, not placed by
// terrain gen. ID must stay stable: chunk data stores raw block ids.)

export type BlockId = number;

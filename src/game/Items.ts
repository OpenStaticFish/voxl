import type { BlockId } from "../types";
import { BLOCKS, WATER_BLOCK, WATER_FLOWING_BLOCK, MUSHROOM_BLOCK } from "./Blocks";

/**
 * Items generalize blocks: every non-air block becomes a placeable block item
 * ("b<id>"), and a handful of standalone food items exist for survival. Item
 * ids are strings so the registry can grow to tools/materials later without
 * disturbing the numeric block ids stored in chunk data.
 */

export type ItemId = string;

export interface FoodDef {
  /** Hunger points restored (0–20 scale, 20 = full). */
  hunger: number;
  /** Hidden saturation buffer restored. */
  saturation: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Representative UI color (hex). */
  color: string;
  maxStack: number;
  /** UI rendering hint. */
  icon: "block" | "food";
  /** If set, using this item places the given block. */
  block?: BlockId;
  /** If set, this item can be eaten. */
  food?: FoodDef;
}

/** Build the block item id for a numeric block id. */
export function blockItemId(id: BlockId): ItemId {
  return `b${id}`;
}

const FOOD_ITEMS: ItemDef[] = [
  { id: "apple", name: "Apple", color: "#d24440", maxStack: 64, icon: "food", food: { hunger: 4, saturation: 2.4 } },
  { id: "bread", name: "Bread", color: "#c89a5a", maxStack: 64, icon: "food", food: { hunger: 5, saturation: 6 } },
  { id: "cooked_beef", name: "Cooked Beef", color: "#8a4a3a", maxStack: 64, icon: "food", food: { hunger: 8, saturation: 12.8 } },
  { id: "cookie", name: "Cookie", color: "#b07a3a", maxStack: 64, icon: "food", food: { hunger: 2, saturation: 0.4 } },
  { id: "golden_apple", name: "Golden Apple", color: "#f2c94c", maxStack: 64, icon: "food", food: { hunger: 8, saturation: 9.6 } },
];

/** Blocks whose placement form is edible. */
const EDIBLE_BLOCKS = new Set<BlockId>([MUSHROOM_BLOCK]);

function buildBlockItems(): ItemDef[] {
  const items: ItemDef[] = [];
  for (const def of BLOCKS) {
    if (def.id === 0) continue; // skip air
    const item: ItemDef = {
      id: blockItemId(def.id),
      name: def.name,
      color: def.color,
      maxStack: 64,
      icon: "block",
      block: def.id,
    };
    if (EDIBLE_BLOCKS.has(def.id)) {
      item.food = { hunger: 1, saturation: 0.6 };
    }
    items.push(item);
  }
  return items;
}

export const ITEMS: readonly ItemDef[] = [...buildBlockItems(), ...FOOD_ITEMS];

const ITEM_INDEX = new Map<ItemId, ItemDef>(ITEMS.map((it) => [it.id, it]));

export function getItem(id: ItemId): ItemDef | undefined {
  return ITEM_INDEX.get(id);
}

export function isFood(id: ItemId): boolean {
  const it = ITEM_INDEX.get(id);
  return !!it && !!it.food;
}

/** Order of items shown in the creative palette. */
export const CREATIVE_PALETTE: readonly ItemId[] = [
  "b1", "b2", "b3", "b4", "b5", "b6", "b9", "b19",
  "b10", "b11", "b12", "b13", "b14", "b15", "b27",
  "b16", "b17", "b18",
  "b20", "b21", "b22", "b23",
  "b24", "b25", "b26",
  "b7",
  "apple", "bread", "cooked_beef", "cookie", "golden_apple",
];

/**
 * Default survival hotbar/quick items for a freshly spawned creative world
 * (mirrors the classic palette so creative feels like the old hotbar).
 */
export const STARTER_CREATIVE_HOTBAR: readonly ItemId[] = [
  "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b9", "b19",
];

/**
 * A small welcome kit for survival spawns so the player isn't helpless.
 */
export const STARTER_SURVIVAL_KIT: ReadonlyArray<{ id: ItemId; count: number }> = [
  { id: "bread", count: 5 },
  { id: "apple", count: 3 },
];

/**
 * Block drops in survival. Returns the item id dropped (or null for nothing),
 * or undefined to mean "drops itself".
 */
const DROP_TABLE: Record<number, ItemId | null> = {
  1: "b2", // grass block -> dirt
  6: null, // leaves -> nothing
  10: "b2", // snowy grass -> dirt
  11: null, // ice -> melts to nothing
  26: null, // jungle leaves -> nothing
};

export function dropForBlock(blockId: BlockId): ItemId | null {
  if (blockId in DROP_TABLE) return DROP_TABLE[blockId];
  return blockItemId(blockId);
}

type Hardness = "instant" | "soft" | "medium" | "unbreakable";

const HARDNESS: Record<number, Hardness> = {
  8: "unbreakable", // bedrock
  [WATER_BLOCK]: "unbreakable", // fluids can't be punched away
  [WATER_FLOWING_BLOCK]: "unbreakable", // flowing water likewise
  20: "instant", 21: "instant", 22: "instant", [MUSHROOM_BLOCK]: "instant", // plantlike
};

function hardnessOf(blockId: BlockId): Hardness {
  if (blockId in HARDNESS) return HARDNESS[blockId];
  switch (blockId) {
    case 1: case 2: case 4: case 9: case 10: case 12: case 15: case 24: case 25:
      return "soft";
    default:
      return "medium";
  }
}

const DIG_TIME: Record<Hardness, number> = {
  instant: 0,
  soft: 0.35,
  medium: 0.9,
  unbreakable: Infinity,
};

export type GameMode = "survival" | "creative";

/** Seconds to break a block with bare hands in the given mode. */
export function digTime(blockId: BlockId, mode: GameMode): number {
  if (mode === "creative") return 0;
  return DIG_TIME[hardnessOf(blockId)];
}

export function isBreakable(blockId: BlockId): boolean {
  return hardnessOf(blockId) !== "unbreakable";
}

import { getItem } from "./Items";
import type { ItemId } from "./Items";

export interface ItemStack {
  id: ItemId;
  count: number;
}

function stackMax(id: ItemId): number {
  return getItem(id)?.maxStack ?? 64;
}

/**
 * Fixed-size slot inventory. Slots 0..hotbarSize-1 are the hotbar (shared with
 * the main grid in the inventory screen). Supports add-with-merge, cursor-based
 * pickup/place/swap, and JSON serialization.
 */
/** Number of cells in the logical crafting grid (3x3). The inventory screen
 *  exposes only the top-left 2x2 (indices 0,1,3,4); a crafting table exposes
 *  the full 3x3. match() handles either via bounding-box normalization. */
export const CRAFT_GRID_SIZE = 9;

export class Inventory {
  readonly slots: (ItemStack | null)[];
  /** Crafting grid (always 9 cells, 3x3 logical). Separate from `slots`. */
  readonly craftingGrid: (ItemStack | null)[];
  readonly hotbarSize: number;

  constructor(size: number, hotbarSize = 9) {
    this.slots = new Array(size).fill(null);
    this.craftingGrid = new Array(CRAFT_GRID_SIZE).fill(null);
    this.hotbarSize = hotbarSize;
  }

  get size(): number {
    return this.slots.length;
  }

  getSlot(i: number): ItemStack | null {
    return this.slots[i] ?? null;
  }

  setSlot(i: number, stack: ItemStack | null): void {
    if (i < 0 || i >= this.slots.length) return;
    if (stack && stack.count <= 0) stack = null;
    this.slots[i] = stack;
  }

  getCraft(i: number): ItemStack | null {
    return this.craftingGrid[i] ?? null;
  }

  setCraft(i: number, stack: ItemStack | null): void {
    if (i < 0 || i >= this.craftingGrid.length) return;
    if (stack && stack.count <= 0) stack = null;
    this.craftingGrid[i] = stack;
  }

  hotbarSlot(i: number): ItemStack | null {
    return this.slots[i] ?? null;
  }

  /** Add items, merging into existing stacks first. Returns leftover count. */
  add(id: ItemId, count: number): number {
    const max = stackMax(id);
    // Pass 1: merge into existing stacks of the same id.
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const room = max - s.count;
        const take = Math.min(room, count);
        s.count += take;
        count -= take;
      }
    }
    // Pass 2: fill empty slots.
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(max, count);
        this.slots[i] = { id, count: take };
        count -= take;
      }
    }
    return count;
  }

  /** Remove one item from a slot; returns true if something was consumed. */
  consumeOne(i: number): boolean {
    const s = this.slots[i];
    if (!s) return false;
    s.count -= 1;
    if (s.count <= 0) this.slots[i] = null;
    return true;
  }

  /** Remove up to count of an item id from anywhere. Returns removed count. */
  remove(id: ItemId, count: number): number {
    let removed = 0;
    for (let i = 0; i < this.slots.length && removed < count; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, count - removed);
        s.count -= take;
        removed += take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return removed;
  }

  countOf(id: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  clear(): void {
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = null;
    this.clearCrafting();
  }

  clearCrafting(): void {
    for (let i = 0; i < this.craftingGrid.length; i++) this.craftingGrid[i] = null;
  }

  isEmpty(): boolean {
    return this.slots.every((s) => !s) && this.craftingGrid.every((s) => !s);
  }

  serialize(): SerializedSlot[] {
    const out: SerializedSlot[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s) out.push({ i, id: s.id, count: s.count });
    }
    return out;
  }

  load(data: SerializedSlot[] | undefined): void {
    this.clear();
    if (!data) return;
    for (const e of data) {
      if (e.i >= 0 && e.i < this.slots.length && e.count > 0 && getItem(e.id)) {
        const max = stackMax(e.id);
        this.slots[e.i] = { id: e.id, count: Math.min(e.count, max) };
      }
    }
  }

  serializeCrafting(): SerializedSlot[] {
    const out: SerializedSlot[] = [];
    for (let i = 0; i < this.craftingGrid.length; i++) {
      const s = this.craftingGrid[i];
      if (s) out.push({ i, id: s.id, count: s.count });
    }
    return out;
  }

  loadCrafting(data: SerializedSlot[] | undefined): void {
    this.clearCrafting();
    if (!Array.isArray(data)) return;
    for (const e of data) {
      if (e.i >= 0 && e.i < this.craftingGrid.length && e.count > 0 && getItem(e.id)) {
        const max = stackMax(e.id);
        this.craftingGrid[e.i] = { id: e.id, count: Math.min(e.count, max) };
      }
    }
  }
}

export interface SerializedSlot {
  i: number;
  id: ItemId;
  count: number;
}

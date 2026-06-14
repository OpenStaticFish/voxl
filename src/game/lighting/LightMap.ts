import { CHUNK_VOLUME } from "../../constants";
import { blockIndex } from "../Chunk";
import { LIGHT_MAX } from "./LightingConfig";
import type { BlockId } from "../../types";

/**
 * Read-only view the light propagators use to query neighbour state across
 * chunk boundaries. Implemented by {@link VoxelLightEngine}; this indirection
 * keeps the propagators decoupled from the world/chunk storage.
 */
export interface LightAccess {
  /** Block id at world coordinates (0 = air for unloaded/above-world). */
  getBlockId(wx: number, wy: number, wz: number): BlockId;
  /**
   * Already-computed SUN light at world coords (boundary condition).
   * Above-world → LIGHT_MAX (open sky); below-world → 0; unloaded chunk →
   * LIGHT_MAX (safe open-sky assumption, corrected when the neighbour loads).
   */
  readSun(wx: number, wy: number, wz: number): number;
  /** Already-computed BLOCK light at world coords (0 default). */
  readBlockLight(wx: number, wy: number, wz: number): number;
}

/**
 * Per-chunk voxel light storage. Two channels (sun and block light), each a
 * Uint8Array of length CHUNK_VOLUME indexed by `blockIndex(x,y,z)`. This
 * mirrors Minetest/Luanti's `param1` (which packs "light with sun" and
 * "light without sun" into the upper/lower nibble of one byte) — we keep them
 * as separate arrays for simplicity and speed.
 *
 * `valid` tracks whether propagation has been run for the current block data.
 * `dirty` means the light changed since the last mesh bake and the chunk's
 * mesh should be rebuilt to pick up new vertex colours.
 */
export class LightMap {
  readonly sun: Uint8Array;
  readonly block: Uint8Array;
  /** Lighting has been computed for the current terrain (not stale). */
  valid = false;

  constructor() {
    this.sun = new Uint8Array(CHUNK_VOLUME);
    this.block = new Uint8Array(CHUNK_VOLUME);
  }

  getSun(x: number, y: number, z: number): number {
    return this.sun[blockIndex(x, y, z)];
  }

  getBlock(x: number, y: number, z: number): number {
    return this.block[blockIndex(x, y, z)];
  }

  setSun(x: number, y: number, z: number, v: number): void {
    this.sun[blockIndex(x, y, z)] = v;
  }

  setBlock(x: number, y: number, z: number, v: number): void {
    this.block[blockIndex(x, y, z)] = v;
  }

  /** Reset both channels (used before a fresh relight). */
  clear(): void {
    this.sun.fill(0);
    this.block.fill(0);
  }
}

/** Clamp a light level to the engine's [0, LIGHT_MAX] range. */
export function clampLightLevel(v: number): number {
  return v < 0 ? 0 : v > LIGHT_MAX ? LIGHT_MAX : v;
}

import { CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_VOLUME } from "../constants";
import type { BlockId, ChunkCoord } from "../types";
import { WATER_FLOWING_BLOCK as FLOWING_WATER_ID } from "./Blocks";

/** Convert local block coords to a flat array index. */
export function blockIndex(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

/**
 * A single chunk: a flat Uint8Array of block ids plus metadata used for
 * streaming and remeshing. Chunk meshes live on the World/scene side.
 *
 * In addition to block ids, a chunk carries an optional per-voxel **liquid
 * level** array (mirrors the lighting `LightMap` design). Only flowing-liquid
 * cells use it (1..MAX_LIQUID_LEVEL); sources are implicitly full and
 * non-liquids read 0. Kept as a separate array so the id-driven mesher and
 * collision code stay untouched.
 */
export class Chunk implements ChunkCoord {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  /**
   * Per-voxel liquid level (0..MAX_LIQUID_LEVEL). Only meaningful for cells
   * whose block id is a flowing liquid; sources ignore it.
   */
  readonly levels: Uint8Array;
  /** World-space x origin of this chunk (block coords). */
  readonly originX: number;
  /** World-space z origin of this chunk (block coords). */
  readonly originZ: number;

  /** True if terrain has been generated for this chunk. */
  generated = false;
  /** True if the chunk needs its mesh rebuilt. */
  dirty = true;
  /** Monotonic counter; bumped whenever block data changes. */
  version = 0;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOLUME);
    this.levels = new Uint8Array(CHUNK_VOLUME);
    this.originX = cx * CHUNK_SIZE;
    this.originZ = cz * CHUNK_SIZE;
  }

  getLocal(x: number, y: number, z: number): BlockId {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
      return 0;
    }
    return this.blocks[blockIndex(x, y, z)];
  }

  setLocal(x: number, y: number, z: number, id: BlockId): boolean {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
      return false;
    }
    const idx = blockIndex(x, y, z);
    if (this.blocks[idx] === id) return false;
    this.blocks[idx] = id;
    // Clear stale liquid metadata whenever the cell is no longer a flowing
    // liquid (placing terrain into water, drying a cell, etc.). Sources carry
    // no level, so only flowing ids retain it.
    if (id !== FLOWING_WATER_ID) this.levels[idx] = 0;
    this.version++;
    this.dirty = true;
    return true;
  }

  /** Liquid level at local coords (0 for non-flowing / out of range). */
  getLocalLevel(x: number, y: number, z: number): number {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
      return 0;
    }
    return this.levels[blockIndex(x, y, z)];
  }

  /**
   * Set both the block id and the liquid level atomically. Use this for any
   * liquid edit so the level array never goes stale relative to the id array.
   * Returns true if anything changed.
   */
  setLocalWithLevel(x: number, y: number, z: number, id: BlockId, level: number): boolean {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) {
      return false;
    }
    const idx = blockIndex(x, y, z);
    const lv = level < 0 ? 0 : level;
    if (this.blocks[idx] === id && this.levels[idx] === lv) return false;
    this.blocks[idx] = id;
    this.levels[idx] = id === 0 ? 0 : lv;
    this.version++;
    this.dirty = true;
    return true;
  }
}

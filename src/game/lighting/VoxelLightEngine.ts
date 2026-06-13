import { CHUNK_SIZE, CHUNK_HEIGHT } from "../../constants";
import type { BlockId } from "../../types";
import type { Chunk } from "../Chunk";
import { LightMap } from "./LightMap";
import type { LightAccess } from "./LightMap";
import { SunLightPropagator } from "./SunLightPropagator";
import { BlockLightPropagator } from "./BlockLightPropagator";
import { LIGHT_MAX, combineLight } from "./LightingConfig";

export function lightKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export interface RelightResult {
  /** Any sun/block value in the chunk changed (→ mesh should be rebuilt). */
  changed: boolean;
  /** A value on the chunk's border ring changed (→ neighbours must re-light). */
  borderChanged: boolean;
}

/**
 * Owns every chunk's {@link LightMap} and runs voxel light propagation.
 *
 * The engine is purely computational: it never touches Babylon. It implements
 * {@link LightAccess} so the per-channel propagators can read neighbour chunks
 * as boundary conditions, and it exposes world-coordinate queries the mesher
 * and debug overlay consume.
 *
 * Relighting is driven externally (by {@link World}) which knows chunk load /
 * edit events and feeds the engine chunks via {@link relightChunk}. The engine
 * reports whether a relight changed anything (and whether the chunk's *border*
 * changed) so the world can mark neighbours and meshes dirty — this is what
 * keeps lighting consistent across chunk seams without ever relighting the
 * whole world.
 */
export class VoxelLightEngine implements LightAccess {
  private readonly maps = new Map<string, LightMap>();
  private readonly sun = new SunLightPropagator();
  private readonly block = new BlockLightPropagator();
  private readonly getBlockIdAt: (wx: number, wy: number, wz: number) => BlockId;
  /** Scratch buffers so relight allocates nothing per call. */
  private readonly scratchSun: Uint8Array;
  private readonly scratchBlock: Uint8Array;

  constructor(getBlockIdAt: (wx: number, wy: number, wz: number) => BlockId) {
    this.getBlockIdAt = getBlockIdAt;
    this.scratchSun = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    this.scratchBlock = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  }

  // ---- LightAccess (read-only boundary queries) ----

  getBlockId(wx: number, wy: number, wz: number): BlockId {
    return this.getBlockIdAt(wx, wy, wz);
  }

  readSun(wx: number, wy: number, wz: number): number {
    if (wy < 0) return 0;
    if (wy >= CHUNK_HEIGHT) return LIGHT_MAX; // above world = open sky
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const map = this.maps.get(lightKey(cx, cz));
    // Unloaded/unlit chunk → assume open sky (safe default, corrected on load).
    if (!map || !map.valid) return LIGHT_MAX;
    return map.getSun(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE);
  }

  readBlockLight(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const map = this.maps.get(lightKey(cx, cz));
    if (!map || !map.valid) return 0;
    return map.getBlock(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE);
  }

  // ---- world-coordinate queries (mesher / debug) ----

  getSun(wx: number, wy: number, wz: number): number {
    return this.readSun(wx, wy, wz);
  }

  getBlockLight(wx: number, wy: number, wz: number): number {
    return this.readBlockLight(wx, wy, wz);
  }

  /** Combined render light level for a voxel given a sun (day/night) factor. */
  getCombined(wx: number, wy: number, wz: number, sunFactor = 1): number {
    return combineLight(this.readSun(wx, wy, wz), this.readBlockLight(wx, wy, wz), sunFactor);
  }

  hasLight(cx: number, cz: number): boolean {
    const m = this.maps.get(lightKey(cx, cz));
    return !!m && m.valid;
  }

  /** Remove light data for an unloading chunk. */
  removeLight(cx: number, cz: number): void {
    this.maps.delete(lightKey(cx, cz));
  }

  /** Drop all light maps (call when the world is disposed). */
  dispose(): void {
    this.maps.clear();
  }

  /**
   * Recompute sun + block light for `chunk` from scratch, using neighbour
   * chunks (where loaded) as boundary conditions. Returns whether anything
   * changed and whether the border ring changed.
   */
  relightChunk(chunk: Chunk): RelightResult {
    const k = lightKey(chunk.cx, chunk.cz);
    let map = this.maps.get(k);
    if (!map) {
      map = new LightMap();
      this.maps.set(k, map);
    }

    this.sun.propagate(this, chunk, this.scratchSun);
    this.block.propagate(this, chunk, this.scratchBlock);

    // Diff against the previous values.
    let changed = false;
    let borderChanged = false;
    const oldSun = map.sun;
    const oldBlock = map.block;
    const newSun = this.scratchSun;
    const newBlock = this.scratchBlock;
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const onBorder = z === 0 || z === CHUNK_SIZE - 1;
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
          const s = newSun[idx];
          const b = newBlock[idx];
          if (s !== oldSun[idx] || b !== oldBlock[idx]) {
            changed = true;
            if (onBorder || x === 0 || x === CHUNK_SIZE - 1) borderChanged = true;
          }
        }
      }
      // Both flags already set: no more information to gather — stop the scan.
      if (changed && borderChanged) break;
    }

    // Commit scratch → stored map.
    oldSun.set(newSun);
    oldBlock.set(newBlock);
    map.valid = true;

    return { changed, borderChanged };
  }
}

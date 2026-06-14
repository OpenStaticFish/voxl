import { CHUNK_SIZE, CHUNK_HEIGHT } from "../../constants";
import { getBlock, resolveLight } from "../Blocks";
import type { Chunk } from "../Chunk";
import type { LightAccess } from "./LightMap";
import { LIGHT_MAX } from "./LightingConfig";

/**
 * Sunlight (sky-light) propagation for a single chunk, modelled on
 * Minetest/Luanti and Minecraft.
 *
 * Three phases:
 *
 *  **A — Vertical sky exposure (chunk-local, neighbour-independent).**
 *  For each column we walk top→down. While the column is still "open to the
 *  sky" every AIR or `sunlightPassesThrough` cell is seeded at LIGHT_MAX (15).
 *  The first cell that does not let sunlight pass straight down (opaque block,
 *  but also leaves/water, which only allow *spread* light) closes the sky
 *  column — nothing below it is seeded here; it will be lit by BFS instead.
 *
 *  **A2 — Boundary inflow (horizontal sky bleed between chunks).**
 *  Every in-chunk border cell pulls light from its out-of-chunk neighbour
 *  (read-only boundary condition). This is what lets a cave in this chunk be
 *  lit by an opening in the adjacent chunk, and vice-versa. Corrected/refreshed
 *  automatically when the neighbour re-lights and marks this chunk dirty.
 *
 *  **B — BFS flood fill (outward spread).**
 *  Light spreads from brighter to darker in-chunk cells with the classic rules:
 *    • horizontally / upward:  level − 1 (− absorption)
 *    • straight DOWN through a `sunlightPassesThrough` cell from a level-15
 *      source: no decay (sunlight streams down open shafts and through glass)
 *    • straight DOWN through any other light-passing cell (water/leaves):
 *      level − 1, so depth and canopy bleed attenuate naturally.
 *
 *  Light never enters a cell whose block does not `lightPassesThrough`
 *  (stone, dirt, …). Opaque cells stay at 0 and act as walls.
 *
 * Because a sun value of 15 can only ever arise from an unbroken sky column
 * (BFS decay can't reach 15 from below), "level === 15" doubles as the marker
 * for the straight-down no-decay rule — no separate flag array is needed.
 */
export class SunLightPropagator {
  private queue: Int32Array;
  private qTail = 0;

  constructor() {
    this.queue = new Int32Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  }

  propagate(access: LightAccess, chunk: Chunk, sun: Uint8Array): void {
    sun.fill(0);
    this.qTail = 0;

    // ---- Phase A: vertical sky exposure ----
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let skyExposed = true; // above the chunk is always open sky
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
          const id = chunk.blocks[idx];
          if (id === 0) {
            if (skyExposed) {
              sun[idx] = LIGHT_MAX;
              this.enqueue(idx);
            }
            continue;
          }
          const light = resolveLight(getBlock(id));
          if (skyExposed && light.sunlightPassesThrough) {
            sun[idx] = LIGHT_MAX;
            this.enqueue(idx);
            continue; // column stays open (sun passes straight through, e.g. glass)
          }
          // First cell that breaks straight sunlight. If it still conducts light
          // (water, leaves), seed its surface with one step of decay so a
          // water/leaf column at the world top isn't pitch-black and so sky-lit
          // colour bleeds into it; then close the column. Opaque blocks stay dark.
          if (skyExposed && light.lightPassesThrough) {
            const seed = LIGHT_MAX - 1 - light.lightAbsorption;
            if (seed > 0 && seed > sun[idx]) {
              sun[idx] = seed;
              this.enqueue(idx);
            }
          }
          skyExposed = false;
        }
      }
    }

    const ox = chunk.originX;
    const oz = chunk.originZ;

    // ---- Phase A2: boundary inflow from neighbour chunks ----
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        this.pullInflow(access, sun, chunk, 0, y, z, ox, oz, -1, 0);
        this.pullInflow(access, sun, chunk, CHUNK_SIZE - 1, y, z, ox, oz, +1, 0);
      }
      for (let x = 0; x < CHUNK_SIZE; x++) {
        this.pullInflow(access, sun, chunk, x, y, 0, ox, oz, 0, -1);
        this.pullInflow(access, sun, chunk, x, y, CHUNK_SIZE - 1, ox, oz, 0, +1);
      }
    }

    // ---- Phase B: BFS outward spread ----
    let head = 0;
    while (head < this.qTail) {
      const idx = this.queue[head++];
      const level = sun[idx];
      if (level <= 1) continue;
      // blockIndex = (y*CHUNK_SIZE + z)*CHUNK_SIZE + x  → y-stride = CHUNK_SIZE²
      const lx = idx % CHUNK_SIZE;
      const lz = (((idx - lx) / CHUNK_SIZE) % CHUNK_SIZE) | 0;
      const ly = ((idx - lx - lz * CHUNK_SIZE) / (CHUNK_SIZE * CHUNK_SIZE)) | 0;
      // 6 in-chunk neighbours only; out-of-chunk handled by A2 inflow.
      if (lx > 0) this.spread(sun, chunk, level, lx, ly, lz, -1, 0, 0);
      if (lx < CHUNK_SIZE - 1) this.spread(sun, chunk, level, lx, ly, lz, +1, 0, 0);
      if (lz > 0) this.spread(sun, chunk, level, lx, ly, lz, 0, 0, -1);
      if (lz < CHUNK_SIZE - 1) this.spread(sun, chunk, level, lx, ly, lz, 0, 0, +1);
      if (ly > 0) this.spread(sun, chunk, level, lx, ly, lz, 0, -1, 0);
      if (ly < CHUNK_HEIGHT - 1) this.spread(sun, chunk, level, lx, ly, lz, 0, +1, 0);
    }
  }

  private enqueue(idx: number): void {
    if (this.qTail < this.queue.length) this.queue[this.qTail++] = idx;
  }

  /** Outward spread from `(lx,ly,lz)` into in-chunk neighbour `(lx+dx,…)`. */
  private spread(
    sun: Uint8Array,
    chunk: Chunk,
    level: number,
    lx: number,
    ly: number,
    lz: number,
    dx: number,
    dy: number,
    dz: number,
  ): void {
    const nx = lx + dx;
    const ny = ly + dy;
    const nz = lz + dz;
    const nbId = chunk.blocks[(ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx];
    if (nbId !== 0 && !resolveLight(getBlock(nbId)).lightPassesThrough) return;
    const absorption = nbId === 0 ? 0 : resolveLight(getBlock(nbId)).lightAbsorption;

    let candidate: number;
    if (dy === -1 && level === LIGHT_MAX) {
      const sunPass = nbId === 0 ? true : resolveLight(getBlock(nbId)).sunlightPassesThrough;
      candidate = sunPass ? level : level - 1 - absorption;
    } else {
      candidate = level - 1 - absorption;
    }
    if (candidate <= 0) return;

    const nidx = (ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx;
    if (candidate > sun[nidx]) {
      sun[nidx] = candidate;
      this.enqueue(nidx);
    }
  }

  /**
   * Pull light INTO the in-chunk border cell `(lx,ly,lz)` from its horizontal
   * out-of-chunk neighbour at world offset `(bx,bz)`. This is what lets a cave
   * in this chunk be lit by an opening in the adjacent chunk. Normal -1 decay.
   * (Vertical/top-edge inflow is unnecessary: Phase A already seeds every
   * sky-exposed column from the open world top.)
   */
  private pullInflow(
    access: LightAccess,
    sun: Uint8Array,
    chunk: Chunk,
    lx: number,
    ly: number,
    lz: number,
    ox: number,
    oz: number,
    bx: number,
    bz: number,
  ): void {
    const idx = (ly * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    const nbId = chunk.blocks[idx]; // the receiving cell itself
    if (nbId !== 0 && !resolveLight(getBlock(nbId)).lightPassesThrough) return;

    const wx = ox + lx + bx;
    const wz = oz + lz + bz;
    const nbLevel = access.readSun(wx, ly, wz);
    if (nbLevel <= 1) return;

    const absorption = nbId === 0 ? 0 : resolveLight(getBlock(nbId)).lightAbsorption;
    const candidate = nbLevel - 1 - absorption;
    if (candidate > sun[idx]) {
      sun[idx] = candidate;
      this.enqueue(idx);
    }
  }
}

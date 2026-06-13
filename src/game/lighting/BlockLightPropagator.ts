import { CHUNK_SIZE, CHUNK_HEIGHT } from "../../constants";
import { getBlock, resolveLight } from "../Blocks";
import type { Chunk } from "../Chunk";
import type { LightAccess } from "./LightMap";

/**
 * Block-light (emissive) propagation for a single chunk. Emitters seed their
 * own cell at their `lightEmission` level, then light floods outward through
 * `lightPassesThrough` cells, decaying by 1 (plus absorption) per step in every
 * direction. Opaque blocks are walls (level 0).
 *
 * Chunk boundaries use the same inflow/outflow scheme as sunlight: border cells
 * pull emissive light from neighbour chunks (boundary condition) and the BFS
 * pushes light outward within the chunk. A glowstone block placed in a dark
 * cave will thus paint a warm, decaying sphere of light across chunk seams.
 */
export class BlockLightPropagator {
  private queue: Int32Array;
  private qTail = 0;

  constructor() {
    this.queue = new Int32Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  }

  propagate(access: LightAccess, chunk: Chunk, block: Uint8Array): void {
    block.fill(0);
    this.qTail = 0;

    // ---- Seed: emitters ----
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
          const id = chunk.blocks[idx];
          if (id === 0) continue;
          const emission = resolveLight(getBlock(id)).lightEmission;
          if (emission > 0) {
            block[idx] = emission;
            this.enqueue(idx);
          }
        }
      }
    }

    const ox = chunk.originX;
    const oz = chunk.originZ;

    // ---- Boundary inflow from neighbour chunks ----
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        this.pullInflow(access, block, chunk, 0, y, z, ox, oz, -1, 0);
        this.pullInflow(access, block, chunk, CHUNK_SIZE - 1, y, z, ox, oz, +1, 0);
      }
      for (let x = 0; x < CHUNK_SIZE; x++) {
        this.pullInflow(access, block, chunk, x, y, 0, ox, oz, 0, -1);
        this.pullInflow(access, block, chunk, x, y, CHUNK_SIZE - 1, ox, oz, 0, +1);
      }
    }

    // ---- BFS outward spread (in-chunk only) ----
    let head = 0;
    while (head < this.qTail) {
      const idx = this.queue[head++];
      const level = block[idx];
      if (level <= 1) continue;
      // blockIndex = (y*CHUNK_SIZE + z)*CHUNK_SIZE + x  → y-stride = CHUNK_SIZE²
      const lx = idx % CHUNK_SIZE;
      const lz = (((idx - lx) / CHUNK_SIZE) % CHUNK_SIZE) | 0;
      const ly = ((idx - lx - lz * CHUNK_SIZE) / (CHUNK_SIZE * CHUNK_SIZE)) | 0;
      if (lx > 0) this.spread(block, chunk, level, -1, 0, 0, lx, ly, lz);
      if (lx < CHUNK_SIZE - 1) this.spread(block, chunk, level, +1, 0, 0, lx, ly, lz);
      if (lz > 0) this.spread(block, chunk, level, 0, 0, -1, lx, ly, lz);
      if (lz < CHUNK_SIZE - 1) this.spread(block, chunk, level, 0, 0, +1, lx, ly, lz);
      if (ly > 0) this.spread(block, chunk, level, 0, -1, 0, lx, ly, lz);
      if (ly < CHUNK_HEIGHT - 1) this.spread(block, chunk, level, 0, +1, 0, lx, ly, lz);
    }
  }

  private enqueue(idx: number): void {
    if (this.qTail < this.queue.length) this.queue[this.qTail++] = idx;
  }

  private spread(
    block: Uint8Array,
    chunk: Chunk,
    level: number,
    dx: number,
    dy: number,
    dz: number,
    lx: number,
    ly: number,
    lz: number,
  ): void {
    const nx = lx + dx;
    const ny = ly + dy;
    const nz = lz + dz;
    const nbId = chunk.blocks[(ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx];
    if (nbId !== 0 && !resolveLight(getBlock(nbId)).lightPassesThrough) return;
    const absorption = nbId === 0 ? 0 : resolveLight(getBlock(nbId)).lightAbsorption;
    const candidate = level - 1 - absorption;
    if (candidate <= 0) return;
    const nidx = (ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx;
    if (candidate > block[nidx]) {
      block[nidx] = candidate;
      this.enqueue(nidx);
    }
  }

  private pullInflow(
    access: LightAccess,
    block: Uint8Array,
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
    const nbId = chunk.blocks[idx];
    if (nbId !== 0 && !resolveLight(getBlock(nbId)).lightPassesThrough) return;
    const wx = ox + lx + bx;
    const wz = oz + lz + bz;
    const nbLevel = access.readBlockLight(wx, ly, wz);
    if (nbLevel <= 1) return;
    const absorption = nbId === 0 ? 0 : resolveLight(getBlock(nbId)).lightAbsorption;
    const candidate = nbLevel - 1 - absorption;
    if (candidate > block[idx]) {
      block[idx] = candidate;
      this.enqueue(idx);
    }
  }
}

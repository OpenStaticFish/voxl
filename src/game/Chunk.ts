import { CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_VOLUME } from "../constants";
import type { BlockId, ChunkCoord } from "../types";

/** Convert local block coords to a flat array index. */
export function blockIndex(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

/**
 * A single chunk: a flat Uint8Array of block ids plus metadata used for
 * streaming and remeshing. Chunk meshes live on the World/scene side.
 */
export class Chunk implements ChunkCoord {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
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
    this.version++;
    this.dirty = true;
    return true;
  }
}

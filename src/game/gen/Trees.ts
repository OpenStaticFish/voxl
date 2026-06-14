import * as B from "./BlockIds";

// Tree structures, drawn directly into a chunk's block array via a `set`
// callback supplied by the orchestrator (bounds-checked, air-only placement so
// trees never overwrite terrain). Each species comes in a few randomized
// variants (trunk height, canopy radius, occasional asymmetry) so forests read
// as varied groves rather than a grid of identical trees.
//
// All variation derives from a deterministic hash of (worldX, worldZ, seed), so
// a tree at a given column is reproducible regardless of generation order.

/** Bounds-checked air-only setter (local chunk coords). */
export type SetBlock = (lx: number, ly: number, lz: number, id: number) => void;

function hash01(x: number, z: number, seed: string, salt: number): number {
  let h = 374761393 ^ salt;
  const s = `${x},${z},${seed}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 0x100000000;
}

export class TreeGenerator {
  constructor(private readonly seed: string) {}

  private r(wx: number, wz: number, salt: number): number {
    return hash01(wx, wz, this.seed, salt);
  }

  /** Rounded oak: occasional larger specimen. */
  placeOak(set: SetBlock, lx: number, baseY: number, lz: number, wx: number, wz: number): void {
    const big = this.r(wx, wz, 21) < 0.18;
    const trunk = (big ? 5 : 4) + Math.floor(this.r(wx, wz, 22) * 3);
    const topY = baseY + trunk;
    const radius = big ? 3 : 2;
    for (let y = topY - 2; y <= topY + 1; y++) {
      const layerR = y <= topY - 1 ? radius : Math.max(1, radius - 1);
      for (let dz = -layerR; dz <= layerR; dz++) {
        for (let dx = -layerR; dx <= layerR; dx++) {
          if (dx === 0 && dz === 0 && y < topY) continue;
          // Trim corners on the widest layers for a rounder canopy, with a
          // little noise-driven irregularity.
          const corner = Math.abs(dx) === layerR && Math.abs(dz) === layerR;
          if (corner && (layerR === 2 || this.r(wx + dx, wz + dz, 23) < 0.4)) continue;
          set(lx + dx, y, lz + dz, B.LEAVES);
        }
      }
    }
    for (let y = baseY; y < topY; y++) set(lx, y, lz, B.WOOD);
  }

  /** Birch: slim, tall, pale bark + bright leaves. */
  placeBirch(set: SetBlock, lx: number, baseY: number, lz: number, wx: number, wz: number): void {
    const trunk = 5 + Math.floor(this.r(wx, wz, 24) * 4);
    const topY = baseY + trunk;
    for (let y = topY - 3; y <= topY + 1; y++) {
      const t = (y - (topY - 3)) / 4;
      const layerR = t > 0.75 ? 0 : 2;
      for (let dz = -layerR; dz <= layerR; dz++) {
        for (let dx = -layerR; dx <= layerR; dx++) {
          if (dx === 0 && dz === 0 && y < topY) continue;
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && this.r(wx + dx, wz + dz, 25) < 0.6) continue;
          set(lx + dx, y, lz + dz, B.BIRCH_LEAVES);
        }
      }
    }
    for (let y = baseY; y < topY; y++) set(lx, y, lz, B.BIRCH_WOOD);
  }

  /** Conical spruce/pine. `snowy` dusts the canopy with snowy leaves. */
  placeConifer(
    set: SetBlock,
    lx: number,
    baseY: number,
    lz: number,
    wx: number,
    wz: number,
    leaf: number,
  ): void {
    const trunk = 6 + Math.floor(this.r(wx, wz, 26) * 5);
    const topY = baseY + trunk;
    // Layered cones: wide at the base, tapering to a point, with a small skirt
    // drooping below the first layer for a classic spruce silhouette.
    for (let y = baseY + 3; y <= topY; y++) {
      const t = (y - baseY) / trunk;
      const radius = t > 0.78 ? 0 : t > 0.5 ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          // Top layers and upward-facing cells get the snowy variant.
          const useSnow = leaf === B.SPRUCE_LEAVES && t > 0.45 && this.r(wx + dx, wz + dz, 27) < 0.5;
          set(lx + dx, y, lz + dz, useSnow ? B.SNOWY_LEAVES : leaf);
        }
      }
    }
    set(lx, topY + 1, lz, leaf);
    for (let y = baseY; y < topY; y++) set(lx, y, lz, B.WOOD);
  }

  placeSpruce(set: SetBlock, lx: number, baseY: number, lz: number, wx: number, wz: number): void {
    this.placeConifer(set, lx, baseY, lz, wx, wz, B.SPRUCE_LEAVES);
  }

  placePine(set: SetBlock, lx: number, baseY: number, lz: number, wx: number, wz: number): void {
    this.placeConifer(set, lx, baseY, lz, wx, wz, B.LEAVES);
  }

  /** Tall jungle tree with a wide, blobby dark canopy. */
  placeJungle(set: SetBlock, lx: number, baseY: number, lz: number, wx: number, wz: number): void {
    const trunk = 7 + Math.floor(this.r(wx, wz, 28) * 5);
    const topY = baseY + trunk;
    for (let y = topY - 4; y <= topY + 1; y++) {
      const radius = y <= topY - 1 ? 3 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dz === 0 && y < topY) continue;
          // Round (diamond-ish) canopy: drop far corners.
          if (radius === 3 && Math.abs(dx) + Math.abs(dz) > 4) continue;
          set(lx + dx, y, lz + dz, B.JUNGLE_LEAVES);
        }
      }
    }
    for (let y = baseY; y < topY; y++) set(lx, y, lz, B.WOOD);
  }

  /** Short acacia with a flat umbrella canopy. */
  placeAcacia(set: SetBlock, lx: number, baseY: number, lz: number, wx: number, wz: number): void {
    const trunk = 3 + Math.floor(this.r(wx, wz, 29) * 3);
    const topY = baseY + trunk;
    const radius = 2 + Math.floor(this.r(wx, wz, 30) * 2);
    for (let y = topY; y <= topY + 1; y++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          // Round the umbrella and poke a few holes for an organic edge.
          if (Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
          if (this.r(wx + dx, wz + dz, 31) < 0.12) continue;
          set(lx + dx, y, lz + dz, B.LEAVES);
        }
      }
    }
    for (let y = baseY; y < topY; y++) set(lx, y, lz, B.WOOD);
  }
}

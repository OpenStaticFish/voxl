import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from "../constants";
import type { BlockId } from "../types";
import { Noise } from "../engine/Noise";
import { getBlock } from "./Blocks";
import type { Chunk } from "./Chunk";

// Deterministic procedural terrain, modelled on Minetest/Luanti's modern mapgen.
//
// Two-phase generation gives the world real depth instead of a flat heightmap:
//   Phase 1 — a 3D density field carves the solid world. In mountain regions a
//     3D noise wobbles the surface, producing overhangs, cliffs, spires and
//     floating chunks (a pure 2D heightmap can't do this). Caves (winding 3D
//     tunnels + deep low-frequency caverns) are carved, and stone carries
//     sedimentary strata + blob ores.
//   Phase 2 — per column, the topmost solid block is found and dressed with a
//     biome/altitude/slope-appropriate surface (grass, sand, snow, rock on
//     steep cliffs…), a subsoil layer, and water/ice up to sea level.
//   Phase 3 — decorations cluster by noise (forest groves, clearings), with
//     biome-specific trees (oak, pine, jungle, acacia), cacti, grass and flora.
//
// All randomness derives from the seed string, so a seed reproduces the world.

// Block ids (see Blocks.ts).
const AIR = 0;
const GRASS = 1;
const DIRT = 2;
const STONE = 3;
const SAND = 4;
const WOOD = 5;
const LEAVES = 6;
const WATER = 7;
const BEDROCK = 8;
const SNOW = 9;
const SNOWY_GRASS = 10;
const ICE = 11;
const DESERT_SAND = 12;
const DESERT_STONE = 13;
const SANDSTONE = 14;
const GRAVEL = 15;
const COAL_ORE = 16;
const IRON_ORE = 17;
const COPPER_ORE = 18;
const CACTUS = 19;
const TALL_GRASS = 20;
const FLOWER_RED = 21;
const FLOWER_YELLOW = 22;
const MUSHROOM = 23;
const DRY_GRASS = 24;
const JUNGLE_GRASS = 25;
const JUNGLE_LEAVES = 26;
const MOSSY_STONE = 27;

export type Biome =
  | "grassland"
  | "forest"
  | "savanna"
  | "rainforest"
  | "taiga"
  | "tundra"
  | "desert";

const SEA = SEA_LEVEL;
const SNOW_LINE = SEA + 30;
const MAX_HEIGHT = CHUNK_HEIGHT - 12;
/** Slope (in blocks to a neighbour) above which a surface becomes rock. */
const CLIFF_SLOPE = 2.3;

function hash2(x: number, z: number, seed: string): number {
  let h = 374761393;
  const s = `${x},${z},${seed}`;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 668265263);
  }
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 0x100000000;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Stone-family ids that subsoil/surface dressing may overwrite. */
function isStoneFamily(id: BlockId): boolean {
  return (
    id === STONE ||
    id === DESERT_STONE ||
    id === SANDSTONE ||
    id === GRAVEL ||
    id === MOSSY_STONE
  );
}

export class TerrainGenerator {
  readonly seed: string;
  private readonly noise: Noise;

  constructor(seed: string) {
    this.seed = seed || "voxl";
    this.noise = new Noise(this.seed);
  }

  columnHeight(wx: number, wz: number): number {
    return Math.floor(this.rawHeight2D(wx, wz));
  }

  biomeAt(wx: number, wz: number, height: number): Biome {
    const n = this.noise;
    // Large-scale heat/moist: a single smooth low-frequency octave (Minetest
    // uses a biome-noise spread of several hundred nodes). One octave + no
    // stretching keeps biomes big and coherent instead of fragmented.
    const heat = clamp01(0.5 + n.fbm2(wx * 0.0008 + 500, wz * 0.0008 + 500, 1));
    const moist = clamp01(0.5 + n.fbm2(wx * 0.0008, wz * 0.0008 + 900, 1));
    const cold = height > SNOW_LINE ? (height - SNOW_LINE) / 16 : 0;
    const effHeat = heat - cold;
    if (effHeat < 0.38) return moist > 0.5 ? "taiga" : "tundra";
    if (heat > 0.62) {
      if (moist < 0.4) return "desert";
      if (moist > 0.62) return "rainforest";
      return "savanna";
    }
    if (moist > 0.55) return "forest";
    return "grassland";
  }

  /** 2D base surface height (continents + ridged mountains). */
  private rawHeight2D(wx: number, wz: number): number {
    const n = this.noise;
    const continental = n.fbm2(wx * 0.004, wz * 0.004, 4);
    const hills = n.fbm2(wx * 0.016 + 200, wz * 0.016 + 200, 3);
    let h = SEA + 2 + continental * 18 + hills * 6; // lows dip under sea → lakes/oceans
    const mregion = this.mountainRegion(wx, wz);
    const ridge = 1 - Math.abs(n.noise2(wx * 0.012 + 50, wz * 0.012 + 50));
    h += mregion * mregion * ridge * 62;
    return Math.max(3, Math.min(MAX_HEIGHT, h));
  }

  /** 0..1 mask of where 3D mountain terrain (overhangs) is allowed. */
  private mountainRegion(wx: number, wz: number): number {
    const v = this.noise.fbm2(wx * 0.005 + 1000, wz * 0.005 + 1000, 3) + 0.1;
    return Math.min(1, Math.max(0, v * 1.8));
  }

  /** Winding 3D tunnels + deep low-frequency caverns. */
  private isCave(wx: number, y: number, wz: number, h2: number): boolean {
    if (y < 2 || y > h2 + 2) return false;
    // Keep a solid surface shell. The previous thresholds could carve caves up
    // into the dressed terrain layer, exposing huge open cross-sections and
    // leaving surface details visually floating above underground voids.
    if (y > h2 - 10) return false;
    if (h2 <= SEA + 1) return false; // no caves beneath water (no flow sim)
    const n = this.noise;
    const a = n.noise3(wx * 0.045, y * 0.08, wz * 0.045);
    const b = n.noise3(wx * 0.045 + 100, y * 0.05 + 100, wz * 0.045 + 100);
    if (Math.abs(a) < 0.055 && Math.abs(b) < 0.28) return true;
    if (y < SEA - 10) {
      const c = n.fbm3(wx * 0.02 + 50, y * 0.03 + 50, wz * 0.02 + 50, 2);
      if (c > 0.58) return true;
    }
    return false;
  }

  /** Stone with sedimentary strata (sandstone / gravel bands) and biome tint. */
  private stratumBlock(wx: number, y: number, wz: number, biome: Biome): BlockId {
    const n = this.noise;
    const s = n.fbm3(wx * 0.03 + 500, y * 0.06 + 500, wz * 0.03 + 500, 2);
    if (s > 0.34) return SANDSTONE;
    if (s < -0.4) return GRAVEL;
    if (biome === "rainforest" && n.fbm3(wx * 0.09, y * 0.09, wz * 0.09, 2) > 0.35) return MOSSY_STONE;
    return biome === "desert" ? DESERT_STONE : STONE;
  }

  /** Blob-style ore by depth + 3D noise (coal shallow → copper deep). */
  private oreAt(wx: number, y: number, wz: number): BlockId {
    const n = this.noise;
    if (y > 8 && y < MAX_HEIGHT - 3 && n.fbm3(wx * 0.07, y * 0.07, wz * 0.07, 2) > 0.42) return COAL_ORE;
    if (y > 4 && y < SEA + 4 && n.fbm3(wx * 0.085 + 30, y * 0.085 + 30, wz * 0.085 + 30, 2) > 0.5) return IRON_ORE;
    if (y > 2 && y < SEA - 6 && n.fbm3(wx * 0.1 + 60, y * 0.1 + 60, wz * 0.1 + 60, 2) > 0.56) return COPPER_ORE;
    return 0;
  }

  /** Fill a chunk's block data. Does not touch meshes. */
  generate(chunk: Chunk): void {
    if (chunk.generated) return;
    const blocks = chunk.blocks;
    const ox = chunk.originX;
    const oz = chunk.originZ;
    const n = this.noise;
    const size = CHUNK_SIZE;

    // Per-column scratch (shared across phases).
    const h2col = new Float32Array(size * size);
    const surfY = new Int16Array(size * size);
    const biomeCol: Biome[] = new Array(size * size);

    // ---------- Phase 1: 3D solid field + caves + strata + ores ----------
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const h2 = this.rawHeight2D(wx, wz);
        h2col[lz * size + lx] = h2;
        const biome = this.biomeAt(wx, wz, Math.floor(h2));
        biomeCol[lz * size + lx] = biome;
        const mregion = this.mountainRegion(wx, wz);
        const yMax = Math.min(CHUNK_HEIGHT - 1, Math.floor(h2) + (mregion > 0.15 ? 20 : 3));

        for (let y = 0; y <= yMax; y++) {
          if (y === 0) {
            blocks[(0 * size + lz) * size + lx] = BEDROCK;
            continue;
          }
          // Decide solidity: deep cells are solid; the surface band uses 3D
          // detail so mountains get overhangs/cliffs.
          let solid: boolean;
          if (y <= h2 - 4) {
            solid = true;
          } else {
            const detail = n.fbm3(wx * 0.018, y * 0.045, wz * 0.018, 3);
            const rough = n.fbm3(wx * 0.06, y * 0.06, wz * 0.06, 2);
            const top = h2 + detail * 22 * mregion + rough * 2;
            solid = y <= top;
          }
          if (!solid) continue;
          if (this.isCave(wx, y, wz, h2)) continue; // carve

          let block = this.stratumBlock(wx, y, wz, biome);
          const ore = this.oreAt(wx, y, wz);
          if (ore) block = ore;
          blocks[(y * size + lz) * size + lx] = block;
        }
      }
    }

    // ---------- Phase 2: surfaces, cliffs, water, ice, snow ----------
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const ci = lz * size + lx;
        const h2 = h2col[ci];
        const biome = biomeCol[ci];

        // Topmost solid (non-air) in the column.
        let topY = -1;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          if (blocks[(y * size + lz) * size + lx] !== AIR) {
            topY = y;
            break;
          }
        }
        surfY[ci] = topY;
        if (topY < 1) continue;

        // Slope from neighbour base heights (continuous across chunks).
        const hL = lx > 0 ? h2col[(lz) * size + (lx - 1)] : this.rawHeight2D(wx - 1, wz);
        const hR = lx < size - 1 ? h2col[(lz) * size + (lx + 1)] : this.rawHeight2D(wx + 1, wz);
        const hD = lz > 0 ? h2col[(lz - 1) * size + (lx)] : this.rawHeight2D(wx, wz - 1);
        const hU = lz < size - 1 ? h2col[(lz + 1) * size + (lx)] : this.rawHeight2D(wx, wz + 1);
        const slope = Math.max(Math.max(Math.abs(hL - h2), Math.abs(hR - h2)), Math.max(Math.abs(hD - h2), Math.abs(hU - h2)));
        const steep = slope > CLIFF_SLOPE;
        const cold = biome === "tundra" || biome === "taiga";
        const beach = topY <= SEA + 1;

        // Surface block.
        let surf: BlockId;
        if (beach) {
          surf = topY >= SEA - 3 ? (biome === "desert" ? DESERT_SAND : SAND) : DIRT;
        } else if (topY >= SNOW_LINE) {
          surf = SNOW;
        } else if (biome === "tundra" || biome === "taiga") {
          surf = SNOWY_GRASS;
        } else if (biome === "desert") {
          surf = DESERT_SAND;
        } else if (biome === "savanna") {
          surf = DRY_GRASS;
        } else if (biome === "rainforest") {
          surf = JUNGLE_GRASS;
        } else {
          surf = GRASS;
        }
        if (steep && !beach) surf = biome === "desert" ? DESERT_STONE : STONE; // rocky cliff top
        blocks[(topY * size + lz) * size + lx] = surf;

        // Subsoil (only overwrites stone-family, never ores/caves).
        let sub: BlockId;
        if (steep && !beach) sub = biome === "desert" ? DESERT_STONE : STONE;
        else if (beach) sub = biome === "desert" ? DESERT_SAND : SAND;
        else sub = DIRT;
        for (let y = topY - 1; y >= topY - 3 && y >= 1; y--) {
          const idx = (y * size + lz) * size + lx;
          if (isStoneFamily(blocks[idx])) blocks[idx] = sub;
        }

        // Water / ice fill above the surface up to sea level.
        if (topY < SEA) {
          for (let y = topY + 1; y <= SEA; y++) {
            const idx = (y * size + lz) * size + lx;
            if (blocks[idx] === AIR) blocks[idx] = cold && y === SEA ? ICE : WATER;
          }
        }
      }
    }

    // ---------- Phase 3: clustered decorations & trees ----------
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const ci = lz * size + lx;
        const topY = surfY[ci];
        const biome = biomeCol[ci];
        if (topY < 1) continue;
        const surface = blocks[(topY * size + lz) * size + lx];
        this.decorate(blocks, lx, lz, topY, surface, biome, wx, wz);
      }
    }

    chunk.generated = true;
    chunk.dirty = true;
  }

  /** Clustered decorations: groves/clearings via noise, biome-specific trees. */
  private decorate(
    blocks: Uint8Array,
    lx: number,
    lz: number,
    topY: number,
    surface: BlockId,
    biome: Biome,
    wx: number,
    wz: number,
  ): void {
    const above = topY + 1;
    if (above >= CHUNK_HEIGHT - 1) return;
    if (blocks[(above * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] !== AIR) return;
    const seed = this.seed;
    const r01 = (a: number, b: number): number => hash2(wx + a, wz + b, seed);
    // Cluster noises: high → grove/dense, low → clearing.
    const grove = this.noise.fbm2(wx * 0.03 + 700, wz * 0.03 + 700, 2) * 0.5 + 0.5;
    const flora = this.noise.fbm2(wx * 0.05 + 300, wz * 0.05 + 300, 2) * 0.5 + 0.5;

    const setIfAir = (x: number, y: number, z: number, id: BlockId): void => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) return;
      const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
      if (blocks[idx] === AIR) blocks[idx] = id;
    };

    const canTree = lx >= 2 && lx <= CHUNK_SIZE - 3 && lz >= 2 && lz <= CHUNK_SIZE - 3 && topY < CHUNK_HEIGHT - 12;

    if (biome === "desert") {
      if (surface === DESERT_SAND && r01(3, 5) < 0.02 * (0.3 + grove)) {
        const h = 2 + Math.floor(r01(9, 2) * 3);
        for (let i = 0; i < h; i++) setIfAir(lx, above + i, lz, CACTUS);
      }
      return;
    }

    // Cold biomes: sparse pines (denser in taiga).
    if (biome === "taiga" || biome === "tundra") {
      if ((surface === SNOWY_GRASS || surface === SNOW) && topY > SEA) {
        const chance = biome === "taiga" ? 0.09 : 0.02;
        if (canTree && r01(4, 8) < chance * (0.25 + grove * 1.3)) {
          this.placePine(blocks, lx, above, lz, r01(11, 7));
        }
      }
      return;
    }

    // Rainforest: dense jungle canopy + undergrowth.
    if (biome === "rainforest") {
      if (surface === JUNGLE_GRASS && topY > SEA) {
        if (canTree && r01(2, 4) < 0.12 * (0.3 + grove * 1.5)) {
          this.placeJungle(blocks, lx, above, lz, r01(13, 9));
          return;
        }
        if (flora > 0.55 && r01(1, 1) < 0.3) setIfAir(lx, above, lz, TALL_GRASS);
        else if (r01(8, 3) < 0.04) setIfAir(lx, above, lz, MUSHROOM);
      }
      return;
    }

    // Savanna: flat-topped acacia + dry grass patches.
    if (biome === "savanna") {
      if (surface === DRY_GRASS && topY > SEA) {
        if (canTree && r01(6, 2) < 0.018 * (0.3 + grove)) {
          this.placeAcacia(blocks, lx, above, lz, r01(13, 9));
          return;
        }
        if (flora > 0.5 && r01(1, 1) < 0.18) setIfAir(lx, above, lz, TALL_GRASS);
      }
      return;
    }

    // Grassland & forest: oaks, grass tufts, flowers, mushrooms (forest).
    if (surface !== GRASS || topY <= SEA) return;
    const treeChance = (biome === "forest" ? 0.07 : 0.014) * (0.25 + grove * 1.4);
    if (canTree && r01(7, 4) < treeChance) {
      this.placeOak(blocks, lx, above, lz, r01(13, 9));
      return;
    }
    const roll = r01(1, 1);
    if (roll < 0.16 * flora) {
      setIfAir(lx, above, lz, TALL_GRASS);
    } else if (roll < 0.19 * flora) {
      setIfAir(lx, above, lz, r01(5, 5) < 0.5 ? FLOWER_RED : FLOWER_YELLOW);
    } else if (biome === "forest" && roll < 0.21 * flora) {
      setIfAir(lx, above, lz, MUSHROOM);
    }
  }

  /** A rounded oak-style tree (trunk + leafy canopy). */
  private placeOak(blocks: Uint8Array, lx: number, baseY: number, lz: number, r: number): void {
    const trunk = 4 + Math.floor(r * 3);
    const topY = baseY + trunk;
    const set = (x: number, y: number, z: number, id: BlockId): void => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) return;
      const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
      if (blocks[idx] === AIR) blocks[idx] = id;
    };
    for (let y = topY - 2; y <= topY + 1; y++) {
      const radius = y <= topY - 1 ? 2 : 1;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dz === 0 && y < topY) continue;
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius === 2) continue;
          set(lx + dx, y, lz + dz, LEAVES);
        }
      }
    }
    for (let y = baseY; y < topY; y++) set(lx, y, lz, WOOD);
  }

  /** A conical pine tree (tall trunk + tapering leaf spire). */
  private placePine(blocks: Uint8Array, lx: number, baseY: number, lz: number, r: number): void {
    const trunk = 6 + Math.floor(r * 4);
    const topY = baseY + trunk;
    const set = (x: number, y: number, z: number, id: BlockId): void => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) return;
      const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
      if (blocks[idx] === AIR) blocks[idx] = id;
    };
    for (let y = baseY + 3; y <= topY; y++) {
      const t = (y - baseY) / trunk;
      const radius = t > 0.7 ? 0 : t > 0.45 ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          set(lx + dx, y, lz + dz, LEAVES);
        }
      }
    }
    set(lx, topY + 1, lz, LEAVES);
    for (let y = baseY; y < topY; y++) set(lx, y, lz, WOOD);
  }

  /** A tall jungle tree with a wide, blobby dark canopy. */
  private placeJungle(blocks: Uint8Array, lx: number, baseY: number, lz: number, r: number): void {
    const trunk = 7 + Math.floor(r * 4);
    const topY = baseY + trunk;
    const set = (x: number, y: number, z: number, id: BlockId): void => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) return;
      const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
      if (blocks[idx] === AIR) blocks[idx] = id;
    };
    for (let y = topY - 3; y <= topY + 1; y++) {
      const radius = y <= topY - 1 ? 3 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dz === 0 && y < topY) continue;
          if (radius === 3 && (Math.abs(dx) + Math.abs(dz)) > 4) continue; // round
          set(lx + dx, y, lz + dz, JUNGLE_LEAVES);
        }
      }
    }
    for (let y = baseY; y < topY; y++) set(lx, y, lz, WOOD);
  }

  /** A short acacia with a flat umbrella canopy. */
  private placeAcacia(blocks: Uint8Array, lx: number, baseY: number, lz: number, r: number): void {
    const trunk = 3 + Math.floor(r * 3);
    const topY = baseY + trunk;
    const set = (x: number, y: number, z: number, id: BlockId): void => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) return;
      const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
      if (blocks[idx] === AIR) blocks[idx] = id;
    };
    const radius = 2 + Math.floor(r * 2);
    for (let y = topY; y <= topY + 1; y++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius) continue; // round
          set(lx + dx, y, lz + dz, LEAVES);
        }
      }
    }
    for (let y = baseY; y < topY; y++) set(lx, y, lz, WOOD);
  }
}

/** Resolve the world-space y of the topmost "ground" block (skips fluids and
 *  plantlike decorations so spawns/mesher queries land on real terrain). */
export function findGroundY(chunk: Chunk, lx: number, lz: number): number {
  for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
    const id = chunk.blocks[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
    if (id === 0) continue;
    const def = getBlock(id);
    if (!def.liquid && def.shape !== "plantlike") return y;
  }
  return 0;
}

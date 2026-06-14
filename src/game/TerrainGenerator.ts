import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from "../constants";
import { Noise } from "../engine/Noise";
import { getBlock } from "./Blocks";
import type { Chunk } from "./Chunk";
import * as B from "./gen/BlockIds";
import { ClimateMaps } from "./gen/Climate";
import { BIOME_DEFS, landBlend, selectBiome, type BiomeId, type BiomeSelection, type TreeType } from "./gen/Biomes";
import { HeightMap } from "./gen/TerrainNoise";
import { CaveGenerator } from "./gen/Caves";
import { OreGenerator } from "./gen/Ores";
import { SurfacePainter, decideSurface, shoreBeach, snowFactor, applySnowAndBlend, type SurfaceCtx } from "./gen/Surface";
import { TreeGenerator, type SetBlock } from "./gen/Trees";
import { DecorationGenerator } from "./gen/Decorations";
import { WorldgenStats, type WorldgenStatsSnapshot } from "./gen/WorldgenStats";

// Deterministic modular world generator. Orchestrates the gen/ pipeline:
//
//   Phase 1 — 3D solid field (continents + ridged mountains with overhangs),
//              cave carving, sedimentary strata, ore veins.
//   Phase 2 — per-column surface dressing (slope-graded soil/rock/snow/sand),
//              sub-surface filler, water + ice fill to sea level.
//   Phase 3 — clustered trees (oak/birch/spruce/pine/jungle/acacia) and ground
//              cover (grass/flowers/ferns/mushrooms/dead bush/papyrus).
//
// Every random value derives from the seed + world coordinates, so a seed
// reproduces the world exactly and generation is seamless across chunk borders.

const SEA = SEA_LEVEL;
const SNOW_LINE = SEA + 30;
const ROCK_LINE = SEA + 22;
const MAX_HEIGHT = CHUNK_HEIGHT - 12;
const CLIFF_SLOPE = 2.6;

export class TerrainGenerator {
  readonly seed: string;
  private readonly noise: Noise;
  private readonly climate: ClimateMaps;
  private readonly heightMap: HeightMap;
  private readonly caves: CaveGenerator;
  private readonly ores: OreGenerator;
  private readonly surface: SurfacePainter;
  private readonly trees: TreeGenerator;
  private readonly decorations: DecorationGenerator;
  readonly stats = new WorldgenStats();

  constructor(seed: string) {
    this.seed = seed || "voxl";
    this.noise = new Noise(this.seed);
    this.climate = new ClimateMaps(this.noise);
    this.heightMap = new HeightMap(this.noise, { seaLevel: SEA, maxHeight: MAX_HEIGHT });
    this.caves = new CaveGenerator(this.noise);
    this.ores = new OreGenerator(this.noise);
    this.surface = new SurfacePainter(this.noise, SEA);
    this.trees = new TreeGenerator(this.seed);
    this.decorations = new DecorationGenerator(this.noise, this.seed);
  }

  /** 2D surface height (floored) — the world's base terrain shape. */
  columnHeight(wx: number, wz: number): number {
    return Math.floor(this.heightMap.height(wx, wz));
  }

  /** Elevation + climate-aware biome at a column (for the debug overlay). */
  biomeAt(wx: number, wz: number, height: number): BiomeId {
    const c = this.climate.base(wx, wz);
    const effHeat = ClimateMaps.effectiveHeat(c.heat, height, SEA, SNOW_LINE);
    return selectBiome(effHeat, c.humidity, height, SEA, ROCK_LINE, SNOW_LINE).id;
  }

  /**
   * Rich climate/debug info at a column (for the world-gen overlay). Pass
   * `fast=true` for the per-pixel minimap render: it skips the expensive
   * radius-8 water-extent scan and the radius-6 shore distance (using a cheap
   * height-based near-water approximation instead), cutting ~600 noise evals
   * per call. The single target-column readout uses the full (slow) path.
   */
  debugAt(wx: number, wz: number, fast = false): {
    biome: BiomeId;
    landBiome: BiomeId;
    heat: number;
    humidity: number;
    effHeat: number;
    height: number;
    slope: number;
    treeDensity: number;
    coastal: boolean;
    rocky: boolean;
    nearWater: boolean;
    shoreDist: number;
    beachStrength: number;
    hasBeach: boolean;
    beachWidth: number;
    waterExtent: number;
    snow: number;
    blendEdge: number;
    blendBiome: BiomeId;
    shelf: string;
    surfaceBlock: string;
  } {
    const c = this.climate.base(wx, wz);
    const height = Math.floor(this.heightMap.height(wx, wz));
    const effHeat = ClimateMaps.effectiveHeat(c.heat, height, SEA, SNOW_LINE);
    const sel = selectBiome(effHeat, c.humidity, height, SEA, ROCK_LINE, SNOW_LINE);
    // Waterline cells use the adjacent land biome (matches the surface painter).
    const biome = sel.id === "ocean" ? BIOME_DEFS[sel.landId] : BIOME_DEFS[sel.id];
    const slope = this.heightMap.slope(wx, wz);
    let shoreDist: number;
    let nearWater: boolean;
    let waterExtent: number;
    if (fast) {
      // Cheap approximation for the minimap: treat low columns as "near water".
      nearWater = height <= SEA + 1;
      shoreDist = nearWater ? 1 : 7;
      waterExtent = -1;
    } else {
      shoreDist = this.shoreDistance(wx, wz, 6);
      nearWater = shoreDist <= 2;
      // Local water-extent estimate (fraction of radius-8 neighbourhood below
      // sea) — distinguishes open ocean (~1) from small ponds/rivers (~0).
      let waterCells = 0;
      let totalCells = 0;
      for (let dz = -8; dz <= 8; dz += 2) {
        for (let dx = -8; dx <= 8; dx += 2) {
          totalCells++;
          if (Math.floor(this.heightMap.height(wx + dx, wz + dz)) < SEA) waterCells++;
        }
      }
      waterExtent = waterCells / totalCells;
    }
    // Match the painter's noises + overlays so the overlay explains the block.
    const bs = 0.5 + 0.5 * this.noise.fbm2(wx * 0.03, wz * 0.03, 2);
    const beachStrength = bs < 0 ? 0 : bs > 1 ? 1 : bs;
    const snowNoise = this.noise.fbm2(wx * 0.045 + 1200, wz * 0.045 + 1200, 2);
    const blendNoise = this.noise.fbm2(wx * 0.07 + 900, wz * 0.07 + 900, 2);
    const beach = shoreBeach(biome, slope, beachStrength);
    const d = decideSurface(SEA, height, slope, biome, height, nearWater, beach.hasBeach, beach.width);
    const snow = snowFactor(effHeat, snowNoise);
    const blend = landBlend(c.heat, c.humidity);
    const blendSurface = BIOME_DEFS[blend.second].surface;
    const final = applySnowAndBlend(d, snow, blend.edge, blendSurface, blendNoise);
    return {
      biome: sel.id,
      landBiome: sel.landId,
      heat: c.heat,
      humidity: c.humidity,
      effHeat,
      height,
      slope,
      treeDensity: biome.treeDensity,
      coastal: d.coastal,
      rocky: d.rocky,
      nearWater,
      shoreDist,
      beachStrength,
      hasBeach: beach.hasBeach,
      beachWidth: beach.width,
      waterExtent,
      snow,
      blendEdge: blend.edge,
      blendBiome: blend.second,
      shelf: d.shelf,
      surfaceBlock: getBlock(final).name,
    };
  }

  statsSnapshot(): WorldgenStatsSnapshot {
    return this.stats.snapshot();
  }

  /** Fill a chunk's block data. Does not touch meshes. */
  generate(chunk: Chunk): void {
    if (chunk.generated) return;
    const t0 = performance.now();
    const blocks = chunk.blocks;
    const ox = chunk.originX;
    const oz = chunk.originZ;
    const n = this.noise;
    const size = CHUNK_SIZE;

    const heightCol = new Float32Array(size * size);
    const surfY = new Int16Array(size * size);
    const biomeCol: BiomeSelection[] = new Array(size * size);
    const effHeatCol = new Float32Array(size * size);

    let caveCells = 0;
    let oreCells = 0;

    // ---------- Phase 1: 3D solid field + caves + strata + ores ----------
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const h2 = this.heightMap.height(wx, wz);
        const ci = lz * size + lx;
        heightCol[ci] = h2;
        const c = this.climate.base(wx, wz);
        const effHeat = ClimateMaps.effectiveHeat(c.heat, Math.floor(h2), SEA, SNOW_LINE);
        effHeatCol[ci] = effHeat;
        const sel = selectBiome(effHeat, c.humidity, Math.floor(h2), SEA, ROCK_LINE, SNOW_LINE);
        biomeCol[ci] = sel;
        const biome = BIOME_DEFS[sel.id];
        const mregion = this.heightMap.mountainMask(wx, wz);
        const yMax = Math.min(CHUNK_HEIGHT - 1, Math.floor(h2) + (mregion > 0.15 ? 20 : 3));

        for (let y = 0; y <= yMax; y++) {
          if (y === 0) {
            blocks[(0 * size + lz) * size + lx] = B.BEDROCK;
            continue;
          }
          // Solidity: deep cells solid; the surface band uses 3D detail so
          // mountains get overhangs, cliffs and spires in their regions. The
          // wobble is damped near sea level so the dressed surface tracks the
          // (already-smoothed) 2D heightmap around coastlines — otherwise the
          // dressed floor could dip below sea where the heightmap says "land",
          // creating invisible water the shore detector can't see (and beaches
          // wouldn't form).
          let solid: boolean;
          if (y <= h2 - 4) {
            solid = true;
          } else {
            const detail = n.fbm3(wx * 0.018, y * 0.045, wz * 0.018, 3);
            const rough = n.fbm3(wx * 0.06, y * 0.06, wz * 0.06, 2);
            const distFromSea = Math.abs(h2 - SEA);
            const wobbleScale = distFromSea < 10 ? 0.3 + 0.7 * (distFromSea / 10) : 1;
            const top = h2 + (detail * 22 * mregion + rough * 2) * wobbleScale;
            solid = y <= top;
          }
          if (!solid) continue;
          if (this.caves.isCarved(wx, y, wz, h2, SEA)) {
            caveCells++;
            continue;
          }

          // Base stone: biome-tinted + sedimentary strata.
          let block = biome.stone;
          const strata = this.ores.stratumBlock(wx, y, wz);
          if (strata) block = strata;
          if (sel.id === "rainforest" && n.fbm3(wx * 0.09, y * 0.09, wz * 0.09, 2) > 0.35) {
            block = B.MOSSY_STONE;
          }
          const ore = this.ores.oreAt(wx, y, wz);
          if (ore) {
            block = ore;
            oreCells++;
          }
          blocks[(y * size + lz) * size + lx] = block;
        }
      }
    }

    // ---------- Phase 2: surface dressing + water/ice ----------
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        // Topmost solid (non-air) in the column.
        let topY = -1;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          if (blocks[(y * size + lz) * size + lx] !== B.AIR) {
            topY = y;
            break;
          }
        }
        const ci = lz * size + lx;
        surfY[ci] = topY;
      }
    }
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const ci = lz * size + lx;
        const topY = surfY[ci];
        if (topY < 1) continue;
        const wx = ox + lx;
        const wz = oz + lz;
        const sel = biomeCol[ci];
        // An "ocean"-biome column (2D height ≤ sea) whose dressed surface is at
        // or above sea is a waterline cell — use the adjacent LAND biome so it
        // gets a proper sandy shore instead of the ocean-floor material. For
        // truly underwater columns decideSurface ignores .surface anyway.
        const biome = sel.id === "ocean" ? BIOME_DEFS[sel.landId] : BIOME_DEFS[sel.id];
        const h2 = heightCol[ci];
        const slope = this.columnSlope(heightCol, lx, lz, wx, wz, size);
        const nearWater = this.nearWaterRadius(surfY, lx, lz, wx, wz, size, 2);
        // Biome-edge blend: near a climate boundary, mottle the surface toward
        // the neighbour biome so the border is a band, not a line.
        const blend = landBlend(sel.heat, sel.humidity);
        const blendSurface = BIOME_DEFS[blend.second].surface;
        const sctx: SurfaceCtx = {
          blocks,
          size,
          lx,
          lz,
          wx,
          wz,
          topY,
          slope,
          biome,
          effHeat: effHeatCol[ci],
          height: h2,
          nearWater,
          blendEdge: blend.edge,
          blendSurface,
        };
        this.surface.paint(sctx);
        this.surface.fillWater(sctx);
      }
    }

    // ---------- Phase 3: trees + ground decoration ----------
    let treesPlaced = 0;
    let decoPlaced = 0;
    const setIfAir: SetBlock = (lx, ly, lz, id) => {
      if (lx < 0 || lx >= size || lz < 0 || lz >= size || ly < 0 || ly >= CHUNK_HEIGHT) return;
      const idx = (ly * size + lz) * size + lx;
      if (blocks[idx] === B.AIR) blocks[idx] = id;
    };
    for (let lz = 0; lz < size; lz++) {
      for (let lx = 0; lx < size; lx++) {
        const ci = lz * size + lx;
        const topY = surfY[ci];
        if (topY < 1) continue;
        const wx = ox + lx;
        const wz = oz + lz;
        const sel = biomeCol[ci];
        const biome = BIOME_DEFS[sel.id];
        const above = topY + 1;
        if (above >= CHUNK_HEIGHT) continue;
        if (blocks[(above * size + lz) * size + lx] !== B.AIR) continue;
        const surface = blocks[(topY * size + lz) * size + lx];
        const slope = this.columnSlope(heightCol, lx, lz, wx, wz, size);
        const nearWater = this.nearWaterRadius(surfY, lx, lz, wx, wz, size, 1);

        // Trees: clustered via grove noise, gated by soil, sea level & slope.
        if (
          biome.treeDensity > 0 &&
          topY > SEA &&
          topY < CHUNK_HEIGHT - 14 &&
          slope < CLIFF_SLOPE &&
          this.isTreeSoil(surface, biome.id) &&
          lx >= 2 &&
          lx <= size - 3 &&
          lz >= 2 &&
          lz <= size - 3
        ) {
          const grove = n.fbm2(wx * 0.03 + 700, wz * 0.03 + 700, 2) * 0.5 + 0.5;
          const r01 = this.hash01(wx + 7, wz + 4);
          if (r01 < biome.treeDensity * (0.3 + grove * 1.4)) {
            const type = this.pickTree(biome.treeTypes, wx, wz);
            this.placeTree(type, setIfAir, lx, above, lz, wx, wz, sel);
            treesPlaced++;
            continue; // a tree precludes ground cover in this column
          }
        }

        // Ground cover.
        const placed = this.decorations.place(
          {
            lx,
            lz,
            topY,
            surface,
            biome,
            landId: sel.landId,
            wx,
            wz,
            nearWater,
          },
          setIfAir,
        );
        if (placed) decoPlaced++;
      }
    }

    chunk.generated = true;
    chunk.dirty = true;

    const ms = performance.now() - t0;
    this.stats.record({ ms, decorations: decoPlaced, trees: treesPlaced, caves: caveCells, ores: oreCells });
  }

  /** Slope of a column from its neighbours (cached height array + border fallback). */
  private columnSlope(
    heightCol: Float32Array,
    lx: number,
    lz: number,
    wx: number,
    wz: number,
    size: number,
  ): number {
    const h2 = heightCol[lz * size + lx];
    const hL = lx > 0 ? heightCol[lz * size + (lx - 1)] : this.heightMap.height(wx - 1, wz);
    const hR = lx < size - 1 ? heightCol[lz * size + (lx + 1)] : this.heightMap.height(wx + 1, wz);
    const hD = lz > 0 ? heightCol[(lz - 1) * size + lx] : this.heightMap.height(wx, wz - 1);
    const hU = lz < size - 1 ? heightCol[(lz + 1) * size + lx] : this.heightMap.height(wx, wz + 1);
    return Math.max(
      Math.abs(hL - h2),
      Math.abs(hR - h2),
      Math.abs(hD - h2),
      Math.abs(hU - h2),
    );
  }

  /** True if a water column (dressed surface below sea) exists within Chebyshev
   *  `radius`. Uses the dressed `surfY` for in-chunk neighbours (accurate — it
   *  is what actually determines where water fills) and the 2D heightmap for
   *  out-of-chunk neighbours. Radius 2 gates beach width; radius 1 gates reeds. */
  private nearWaterRadius(
    surfY: Int16Array,
    lx: number,
    lz: number,
    wx: number,
    wz: number,
    size: number,
    radius: number,
  ): boolean {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nlx = lx + dx;
        const nlz = lz + dz;
        const isWater =
          nlx >= 0 && nlx < size && nlz >= 0 && nlz < size
            ? surfY[nlz * size + nlx] >= 0 && surfY[nlz * size + nlx] < SEA
            : Math.floor(this.heightMap.height(wx + dx, wz + dz)) < SEA;
        if (isWater) return true;
      }
    }
    return false;
  }

  /** Approximate Chebyshev distance to the nearest water column (for the debug
   *  overlay). Uses the 2D heightmap; caps at `maxR`, returns maxR+1 if none. */
  shoreDistance(wx: number, wz: number, maxR = 6): number {
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // ring only
          if (Math.floor(this.heightMap.height(wx + dx, wz + dz)) < SEA) return r;
        }
      }
    }
    return maxR + 1;
  }

  private isTreeSoil(surface: number, biomeId: BiomeId): boolean {
    switch (biomeId) {
      case "grassland":
      case "forest":
      case "denseForest":
        return surface === B.GRASS;
      case "savanna":
        return surface === B.DRY_GRASS;
      case "rainforest":
        return surface === B.JUNGLE_GRASS;
      case "taiga":
        return surface === B.SNOWY_GRASS || surface === B.SNOW;
      case "tundra":
        return surface === B.SNOWY_GRASS;
      case "mountain":
        return surface === B.SNOWY_GRASS || surface === B.GRASS;
      default:
        return false;
    }
  }

  private pickTree(types: TreeType[], wx: number, wz: number): TreeType {
    if (types.length === 1) return types[0];
    return types[Math.floor(this.hash01(wx + 1, wz + 1) * types.length) % types.length];
  }

  private placeTree(
    type: TreeType,
    set: SetBlock,
    lx: number,
    above: number,
    lz: number,
    wx: number,
    wz: number,
    sel: BiomeSelection,
  ): void {
    switch (type) {
      case "oak":
        this.trees.placeOak(set, lx, above, lz, wx, wz);
        break;
      case "birch":
        this.trees.placeBirch(set, lx, above, lz, wx, wz);
        break;
      case "pine":
        this.trees.placePine(set, lx, above, lz, wx, wz);
        break;
      case "spruce":
        this.trees.placeSpruce(set, lx, above, lz, wx, wz);
        break;
      case "jungle":
        this.trees.placeJungle(set, lx, above, lz, wx, wz);
        break;
      case "acacia":
        this.trees.placeAcacia(set, lx, above, lz, wx, wz);
        break;
      default:
        void sel;
        break;
    }
  }

  private hash01(x: number, z: number): number {
    let h = 374761393;
    const s = `${x},${z},${this.seed}`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 668265263);
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 0x100000000;
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

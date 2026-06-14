import type { Noise } from "../../engine/Noise";
import { tendencyFor, type BiomeDef } from "./Biomes";
import * as B from "./BlockIds";

// Coastal + surface dressing, modelled on Luanti mapgen shoreline behaviour and
// biome blending:
//
//   • Beaches are a *proximity* effect (water within the shore radius) whose
//     WIDTH is noise-modulated and slope-reduced, so the shoreline is an
//     irregular, varying band — never a uniform painted ring around every
//     lake/river/ocean.
//   • Stone exposure is elevation-aware (near sea a slope must be a genuine
//     cliff to bare rock), and filler depth shrinks on steep slopes so cliff
//     faces expose stone naturally (Luanti `depth_filler`).
//   • Underwater shelves grade sand → gravel → dirt with depth.
//   • Snow is a CONTINUOUS temperature mask (altitude chill + low-frequency
//     meander), independent of the discrete biome id, so it tapers across
//     climate gradients instead of snapping at a biome boundary line.
//   • Near climate boundaries the surface is mottled toward the neighbour
//     biome (Luanti "biomeblend") so biome borders read as blend bands.

/** Underwater sand depth (blocks below sea that stay sandy). */
const SHALLOW_SAND = 4;
/** Extra gravel band below the sand shelf before the deep seabed. */
const SHELF_GRAVEL = 3;
/** Rocky-cliff threshold at sea level (very steep — real cliffs only). */
const ROCKY_AT_SEA = 5.5;
/** Rocky-cliff threshold high up (normal mountain cliff sensitivity). */
const ROCKY_AT_HIGH = 2.6;
/** Elevation (blocks above sea) at which the high rocky threshold fully applies. */
const ROCKY_HIGH_BAND = 36;

export interface SurfaceCtx {
  blocks: Uint8Array;
  size: number;
  lx: number;
  lz: number;
  /** World coords — required so noise is continuous across chunk borders. */
  wx: number;
  wz: number;
  topY: number;
  /** Max |neighbour topY - topY| — true dressed-surface slope. */
  slope: number;
  biome: BiomeDef;
  effHeat: number;
  height: number;
  /** A water column exists within the shore radius (bank/shore awareness). */
  nearWater: boolean;
  /** 0..1 — how close the column is to a climate-biome boundary. */
  blendEdge: number;
  /** Surface block of the neighbour biome (for edge mottling). */
  blendSurface: number;
}

/** Classification shared with the debug overlay (pure — no chunk mutation). */
export interface SurfaceDecision {
  surface: number;
  filler: number;
  /** Filler depth in blocks (shrinks on steep slopes so cliffs expose stone). */
  fillDepth: number;
  coastal: boolean;
  rocky: boolean;
  underwater: boolean;
  /** Shelf label for the debug minimap. */
  shelf: "beach" | "shallow" | "deep" | "rock" | "land";
}

/** Elevation-aware slope above which bare stone shows. */
function rockyThreshold(above: number): number {
  const t = above <= 0 ? 0 : above >= ROCKY_HIGH_BAND ? 1 : above / ROCKY_HIGH_BAND;
  return ROCKY_AT_SEA + (ROCKY_AT_HIGH - ROCKY_AT_SEA) * t;
}

/** Stone-family ids that soil dressing may overwrite (never ores/air/water). */
function isStoneFamily(id: number): boolean {
  return (
    id === B.STONE ||
    id === B.DESERT_STONE ||
    id === B.SANDSTONE ||
    id === B.GRAVEL ||
    id === B.MOSSY_STONE
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Patch-based beach decision. `beachStrength` is a low-frequency noise in
 * [0,1] (large patches). A shore segment gets sand ONLY where the strength
 * exceeds `1 − tendency`: desert (tendency 1) is always sandy, while
 * forest/snow/mountain shores (tendency ≈0.2) get small sand pockets separated
 * by earthen/snowy banks. This breaks the uniform sand ring — beach *presence*
 * is patchy, not just the width. Steep shores are never sandy.
 *
 * Returns `{ hasBeach, width }`; width also scales with strength so present
 * beaches vary from narrow (low strength) to wider (high strength).
 */
export function shoreBeach(
  biome: BiomeDef,
  slope: number,
  beachStrength: number,
): { hasBeach: boolean; width: number } {
  if (slope > 2.5) return { hasBeach: false, width: 0 };
  const tendency = tendencyFor(biome.id);
  const hasBeach = beachStrength > 1 - tendency;
  if (!hasBeach) return { hasBeach: false, width: 0 };
  const width = Math.max(1, biome.beachWidth * (0.4 + beachStrength * 1.1));
  return { hasBeach, width };
}

/**
 * Continuous snow mask in [0,1], derived from temperature (altitude-chilled
 * heat) + a low-frequency meander. Independent of the discrete biome id, so
 * snow tapers smoothly across climate boundaries instead of snapping at a line.
 */
export function snowFactor(effHeat: number, snowNoise: number): number {
  const base = (0.4 - effHeat) / 0.28; // 0 at effHeat 0.40 → 1 at effHeat 0.12
  return clamp01(base + snowNoise * 0.22);
}

/**
 * Pure coastal + surface decision. Shared by the live painter (dressed `topY`)
 * and the debug overlay (2D heightmap height), so the map and world agree on
 * *why* a block was chosen.
 *
 * `effBeachWidth` is the already-noise/slope-adjusted beach width (see
 * {@link effectiveBeachWidth}); the caller computes it so this function stays
 * pure. `nearWater` must mean "water within the shore radius".
 */
export function decideSurface(
  sea: number,
  topY: number,
  slope: number,
  biome: BiomeDef,
  height: number,
  nearWater: boolean,
  hasBeach: boolean,
  beachWidth: number,
): SurfaceDecision {
  void height;
  const above = topY - sea;
  const depth = sea - topY;
  const underwater = topY < sea;
  const rockyT = rockyThreshold(Math.max(0, above));
  const rocky = slope > rockyT;
  // Beach only where the patch mask allows (hasBeach) AND water is within the
  // shore radius AND the column is within the (variable) beach width. Low-
  // tendency biomes produce pockets of sand separated by earthen/snowy banks.
  const coastal = !underwater && nearWater && hasBeach && above <= beachWidth;
  const desert = biome.id === "desert";
  const rock = desert ? B.DESERT_STONE : B.STONE;

  if (underwater) {
    let surface: number;
    let shelf: SurfaceDecision["shelf"];
    if (depth <= SHALLOW_SAND) {
      surface = desert ? B.DESERT_SAND : B.SAND;
      shelf = "shallow";
    } else if (depth <= SHALLOW_SAND + SHELF_GRAVEL) {
      surface = B.GRAVEL;
      shelf = "shallow";
    } else {
      surface = B.DIRT;
      shelf = "deep";
    }
    return { surface, filler: surface, fillDepth: 4, coastal: false, rocky, underwater: true, shelf };
  }

  // Land.
  if (coastal && !rocky) {
    const shore = biome.beachBlock;
    return { surface: shore, filler: shore, fillDepth: 3, coastal: true, rocky: false, underwater: false, shelf: "beach" };
  }
  if (rocky) {
    return { surface: rock, filler: rock, fillDepth: 2, coastal, rocky: true, underwater: false, shelf: coastal ? "rock" : "land" };
  }
  return { surface: biome.surface, filler: biome.filler, fillDepth: 4, coastal, rocky: false, underwater: false, shelf: "land" };
}

/**
 * Apply the continuous snow overlay and biome-edge mottling to a base surface
 * decision. Pure — shared by the painter and the debug overlay so they agree.
 */
export function applySnowAndBlend(
  d: SurfaceDecision,
  snow: number,
  blendEdge: number,
  blendSurface: number,
  blendNoise: number,
): number {
  if (d.underwater) return d.surface;
  if (d.rocky) return snow > 0.55 ? B.SNOW : d.surface;
  if (d.coastal) return d.surface; // beach keeps its shore material
  if (snow > 0.62) return B.SNOW;
  if (snow > 0.34) return B.SNOWY_GRASS;
  if (blendEdge > 0.18 && blendNoise > 1 - blendEdge * 0.75) return blendSurface;
  return d.surface;
}

export class SurfacePainter {
  constructor(
    private readonly noise: Noise,
    private readonly sea: number,
  ) {}

  paint(ctx: SurfaceCtx): void {
    const { blocks, size, lx, lz, topY, slope, biome, effHeat, height, nearWater, wx, wz, blendEdge, blendSurface } = ctx;
    if (topY < 1) return;
    const idx = (y: number): number => (y * size + lz) * size + lx;

    // Low-frequency spatial noises (world-space → seamless across chunks).
    // beachStrength uses a very low frequency so beach *presence* forms broad
    // patches (long sandy stretches vs. long earthen banks), not per-block
    // speckle.
    const beachStrength = clamp01(0.5 + 0.5 * this.noise.fbm2(wx * 0.03, wz * 0.03, 2));
    const snowNoise = this.noise.fbm2(wx * 0.045 + 1200, wz * 0.045 + 1200, 2);
    const blendNoise = this.noise.fbm2(wx * 0.07 + 900, wz * 0.07 + 900, 2);
    const beach = shoreBeach(biome, slope, beachStrength);

    const d = decideSurface(this.sea, topY, slope, biome, height, nearWater, beach.hasBeach, beach.width);
    const snow = snowFactor(effHeat, snowNoise);
    const surf = applySnowAndBlend(d, snow, blendEdge, blendSurface, blendNoise);
    blocks[idx(topY)] = surf;

    // Sub-surface filler (shrinks on steep slopes so cliff faces bare stone).
    for (let y = topY - 1, n = 0; y >= 1 && n < d.fillDepth; y--, n++) {
      const i = idx(y);
      if (isStoneFamily(blocks[i])) blocks[i] = d.filler;
    }
  }

  /**
   * Fill air above the surface up to sea level with water (ice cap in frozen
   * climates). Called after painting so the floor block is already set.
   */
  fillWater(ctx: SurfaceCtx): void {
    const { blocks, size, lx, lz, topY, biome } = ctx;
    if (topY >= this.sea) return;
    const cap = biome.waterTop; // ice id, or 0
    for (let y = topY + 1; y <= this.sea; y++) {
      const i = (y * size + lz) * size + lx;
      if (blocks[i] !== B.AIR) continue;
      blocks[i] = cap && y === this.sea ? cap : B.WATER;
    }
  }
}

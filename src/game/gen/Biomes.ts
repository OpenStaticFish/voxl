import * as B from "./BlockIds";

// Biome system, modelled on Minetest/Luanti mapgen v7: biomes are selected from
// heat/humidity climate coordinates (nearest-point / Voronoi in climate space)
// with altitude chill and elevation overrides (ocean → beach → land → mountain).
//
// Each biome is a data record carrying its full surface palette and decoration
// hints, so the terrain, surface-painter, tree and decoration passes all read
// from one declarative source (easy to extend with new biomes).

export type BiomeId =
  | "ocean"
  | "beach"
  | "grassland"
  | "forest"
  | "denseForest"
  | "savanna"
  | "rainforest"
  | "taiga"
  | "tundra"
  | "desert"
  | "mountain"
  | "snowyMountain";

/** Tree archetypes the tree generator knows how to build. */
export type TreeType = "oak" | "birch" | "pine" | "spruce" | "jungle" | "acacia";

export interface BiomeDef {
  id: BiomeId;
  /** Climate coordinate in [0,1] (only meaningful for land biomes). */
  heatPoint: number;
  humidityPoint: number;
  /** Top surface block on gentle ground. */
  surface: number;
  /** Subsurface (a few blocks below the surface). */
  filler: number;
  /** Deep stone. */
  stone: number;
  /** Block beaches/shores use in this climate. */
  beachBlock: number;
  /** Blocks above sea level still treated as shore. */
  beachWidth: number;
  /** 0..1 — how likely this biome's shore is sandy at all (beach "presence"
   *  tendency). Desert ~1 (always sand), forest/snow ~0.2 (grassy/snowy banks
   *  with only small sand pockets). Breaks the uniform sand ring. Optional;
   *  resolved via {@link tendencyFor} when omitted. */
  beachTendency?: number;
  /** Base tree probability multiplier (0 = none). */
  treeDensity: number;
  treeTypes: TreeType[];
  /** Ground-cover densities (0..1+). */
  grassDensity: number;
  flowerDensity: number;
  shrubDensity: number;
  /** Whether the surface receives a snow cover. */
  snowy: boolean;
  /** Top water layer in cold climates (ice) — 0 = none. */
  waterTop: number;
  /** Debug/minimap colour (hex). */
  color: string;
}

const OCEAN: BiomeDef = {
  id: "ocean",
  heatPoint: 0.5,
  humidityPoint: 0.5,
  surface: B.GRAVEL,
  filler: B.DIRT,
  stone: B.STONE,
  beachBlock: B.SAND,
  beachWidth: 0,
  treeDensity: 0,
  treeTypes: [],
  grassDensity: 0,
  flowerDensity: 0,
  shrubDensity: 0,
  snowy: false,
  waterTop: 0,
  color: "#2a4d7a",
};

export const BIOME_DEFS: Record<BiomeId, BiomeDef> = {
  ocean: OCEAN,
  // NOTE: "beach" is a RESERVED palette entry — selectBiome() never returns it
  // (sand around water is a proximity effect decided by the surface painter, not
  // an elevation biome). It exists so BiomeId/"beach" stays a valid lookup target
  // and the minimap can colour-code it if ever selected.
  beach: {
    id: "beach",
    heatPoint: 0.5,
    humidityPoint: 0.4,
    surface: B.SAND,
    filler: B.SAND,
    stone: B.STONE,
    beachBlock: B.SAND,
    beachWidth: 3,
    treeDensity: 0,
    treeTypes: [],
    grassDensity: 0.04,
    flowerDensity: 0,
    shrubDensity: 0,
    snowy: false,
    waterTop: 0,
    color: "#e0d096",
  },
  grassland: {
    id: "grassland",
    heatPoint: 0.45,
    humidityPoint: 0.35,
    surface: B.GRASS,
    filler: B.DIRT,
    stone: B.STONE,
    beachBlock: B.SAND,
    beachWidth: 2,
    treeDensity: 0.012,
    treeTypes: ["oak", "birch"],
    grassDensity: 0.6,
    flowerDensity: 0.18,
    shrubDensity: 0.06,
    snowy: false,
    waterTop: 0,
    color: "#5fa84a",
  },
  forest: {
    id: "forest",
    heatPoint: 0.5,
    humidityPoint: 0.6,
    surface: B.GRASS,
    filler: B.DIRT,
    stone: B.STONE,
    beachBlock: B.SAND,
    beachWidth: 1,
    treeDensity: 0.06,
    treeTypes: ["oak", "birch"],
    grassDensity: 0.5,
    flowerDensity: 0.12,
    shrubDensity: 0.1,
    snowy: false,
    waterTop: 0,
    color: "#2f7a34",
  },
  denseForest: {
    id: "denseForest",
    heatPoint: 0.58,
    humidityPoint: 0.82,
    surface: B.GRASS,
    filler: B.DIRT,
    stone: B.MOSSY_STONE,
    beachBlock: B.SAND,
    beachWidth: 1,
    treeDensity: 0.11,
    treeTypes: ["oak", "birch", "oak"],
    grassDensity: 0.45,
    flowerDensity: 0.1,
    shrubDensity: 0.16,
    snowy: false,
    waterTop: 0,
    color: "#235e2a",
  },
  savanna: {
    id: "savanna",
    heatPoint: 0.72,
    humidityPoint: 0.28,
    surface: B.DRY_GRASS,
    filler: B.DIRT,
    stone: B.STONE,
    beachBlock: B.SAND,
    beachWidth: 2,
    treeDensity: 0.02,
    treeTypes: ["acacia"],
    grassDensity: 0.35,
    flowerDensity: 0.03,
    shrubDensity: 0.04,
    snowy: false,
    waterTop: 0,
    color: "#b6a04e",
  },
  rainforest: {
    id: "rainforest",
    heatPoint: 0.82,
    humidityPoint: 0.85,
    surface: B.JUNGLE_GRASS,
    filler: B.DIRT,
    stone: B.MOSSY_STONE,
    beachBlock: B.SAND,
    beachWidth: 1,
    treeDensity: 0.13,
    treeTypes: ["jungle"],
    grassDensity: 0.6,
    flowerDensity: 0.06,
    shrubDensity: 0.12,
    snowy: false,
    waterTop: 0,
    color: "#1c4a20",
  },
  taiga: {
    id: "taiga",
    heatPoint: 0.22,
    humidityPoint: 0.55,
    surface: B.SNOWY_GRASS,
    filler: B.DIRT,
    stone: B.STONE,
    beachBlock: B.SAND,
    beachWidth: 1,
    treeDensity: 0.08,
    treeTypes: ["spruce", "pine"],
    grassDensity: 0.2,
    flowerDensity: 0.02,
    shrubDensity: 0.04,
    snowy: true,
    waterTop: B.ICE,
    color: "#5b7a8a",
  },
  tundra: {
    id: "tundra",
    heatPoint: 0.15,
    humidityPoint: 0.3,
    surface: B.SNOW,
    filler: B.DIRT,
    stone: B.STONE,
    beachBlock: B.GRAVEL,
    beachWidth: 1,
    treeDensity: 0.015,
    treeTypes: ["spruce"],
    grassDensity: 0.08,
    flowerDensity: 0.01,
    shrubDensity: 0.02,
    snowy: true,
    waterTop: B.ICE,
    color: "#dfe6f2",
  },
  desert: {
    id: "desert",
    heatPoint: 0.85,
    humidityPoint: 0.12,
    surface: B.DESERT_SAND,
    filler: B.DESERT_SAND,
    stone: B.DESERT_STONE,
    beachBlock: B.DESERT_SAND,
    beachWidth: 4,
    treeDensity: 0,
    treeTypes: [],
    grassDensity: 0,
    flowerDensity: 0,
    shrubDensity: 0.04,
    snowy: false,
    waterTop: 0,
    color: "#e2c67a",
  },
  mountain: {
    id: "mountain",
    heatPoint: 0.4,
    humidityPoint: 0.4,
    surface: B.STONE,
    filler: B.STONE,
    stone: B.STONE,
    beachBlock: B.GRAVEL,
    beachWidth: 1,
    treeDensity: 0.01,
    treeTypes: ["spruce"],
    grassDensity: 0.05,
    flowerDensity: 0.01,
    shrubDensity: 0.02,
    snowy: false,
    waterTop: 0,
    color: "#8a8a8e",
  },
  snowyMountain: {
    id: "snowyMountain",
    heatPoint: 0.1,
    humidityPoint: 0.4,
    surface: B.SNOW,
    filler: B.STONE,
    stone: B.STONE,
    beachBlock: B.GRAVEL,
    beachWidth: 1,
    treeDensity: 0,
    treeTypes: [],
    grassDensity: 0,
    flowerDensity: 0,
    shrubDensity: 0,
    snowy: true,
    waterTop: B.ICE,
    color: "#c0cfdc",
  },
};

/** Land biomes that compete in climate-space selection. */
const LAND_BIOMES: readonly BiomeId[] = [
  "tundra",
  "taiga",
  "grassland",
  "forest",
  "denseForest",
  "savanna",
  "rainforest",
  "desert",
];

/** Squared distance in climate space (humidity weighted a touch less than heat). */
function climateDistance(heat: number, humidity: number, def: BiomeDef): number {
  const dh = heat - def.heatPoint;
  const dm = humidity - def.humidityPoint;
  return dh * dh + dm * dm * 0.85;
}

/** Nearest climate-selectable land biome (ignoring elevation). */
export function landBiome(heat: number, humidity: number): BiomeId {
  let best = LAND_BIOMES[0];
  let bestD = Infinity;
  for (let i = 0; i < LAND_BIOMES.length; i++) {
    const id = LAND_BIOMES[i];
    const d = climateDistance(heat, humidity, BIOME_DEFS[id]);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** Second-nearest land biome + how close it was (0 = far, 1 = tied). Used for
 *  edge-blend jitter so biome borders aren't hard straight lines. */
export function landBlend(heat: number, humidity: number): { second: BiomeId; edge: number } {
  let best = LAND_BIOMES[0];
  let second = LAND_BIOMES[1 % LAND_BIOMES.length];
  let bestD = Infinity;
  let secondD = Infinity;
  for (let i = 0; i < LAND_BIOMES.length; i++) {
    const id = LAND_BIOMES[i];
    const d = climateDistance(heat, humidity, BIOME_DEFS[id]);
    if (d < bestD) {
      secondD = bestD;
      second = best;
      bestD = d;
      best = id;
    } else if (d < secondD) {
      secondD = d;
      second = id;
    }
  }
  // edge ≈ 1 when the two nearest biomes are nearly equidistant.
  const edge = bestD < 1e-6 ? 1 : Math.max(0, 1 - Math.sqrt(secondD) / (Math.sqrt(bestD) + 0.001));
  return { second, edge: edge < 0 ? 0 : edge > 1 ? 1 : edge };
}

export function def(id: BiomeId): BiomeDef {
  return BIOME_DEFS[id];
}

/**
 * Resolve a biome's beach "presence" tendency in [0,1] — the probability that a
 * shore segment in this biome gets sand at all (vs. grassy/dirt/snowy banks).
 * Desert shores are almost always sandy; forest/snow/mountain shores are mostly
 * earthen with only small sand pockets. This is what breaks the uniform sand
 * ring around lakes/coasts: low-frequency noise gates beach *presence*, not just
 * width.
 */
export function tendencyFor(id: BiomeId): number {
  const explicit = BIOME_DEFS[id].beachTendency;
  if (explicit !== undefined) return explicit;
  switch (id) {
    case "desert":
      return 1.0;
    case "savanna":
      return 0.7;
    case "grassland":
      return 0.6;
    case "rainforest":
      return 0.3;
    case "forest":
    case "denseForest":
      return 0.24;
    case "taiga":
      return 0.2;
    case "tundra":
    case "mountain":
      return 0.14;
    case "snowyMountain":
      return 0.1;
    default:
      return 0.3;
  }
}

export interface BiomeSelection {
  id: BiomeId;
  /** Underlying land biome chosen by climate (before elevation overrides). */
  landId: BiomeId;
  heat: number;
  humidity: number;
}

/**
 * Full elevation-aware biome selection, mirroring Luanti's layering:
 * ocean → (climate land biome) → mountain → snowyMountain, with the land biome
 * chosen by nearest climate point and altitude chill sliding it toward cold.
 *
 * There is intentionally NO broad "beach" biome band: sand around water is a
 * shoreline *effect* decided by the surface painter from real water proximity
 * (see Surface.decideSurface), so low inland plains stay grassy/snowy instead
 * of turning into giant sand flats.
 */
export function selectBiome(
  heat: number,
  humidity: number,
  height: number,
  seaLevel: number,
  rockLine: number,
  snowLine: number,
): BiomeSelection {
  const land = landBiome(heat, humidity);
  if (height <= seaLevel) {
    return { id: "ocean", landId: land, heat, humidity };
  }
  if (height >= snowLine) {
    return { id: "snowyMountain", landId: land, heat, humidity };
  }
  // High rocky zone: above the rock line the climate biome gives way to bare
  // mountain, unless it is already cold/snowy (taiga/tundra) in which case the
  // snowy identity reads more naturally.
  if (height >= rockLine) {
    const cold = heat < 0.3;
    return { id: cold ? "snowyMountain" : "mountain", landId: land, heat, humidity };
  }
  return { id: land, landId: land, heat, humidity };
}

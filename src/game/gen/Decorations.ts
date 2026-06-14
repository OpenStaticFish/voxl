import type { Noise } from "../../engine/Noise";
import type { BiomeDef, BiomeId } from "./Biomes";
import * as B from "./BlockIds";

// Ground-cover decoration pass: tall grass, flowers, ferns, mushrooms, dead
// bushes, papyrus. Coverage is clustered via two fbm "grove"/"flora" noises so
// the surface forms natural patches and clearings instead of an even speckle
// (Minetest decorations use noise `fill_ratio`/`noise_params` the same way).
//
// Everything is plantlike (cutout pass) and bounds-checked via `set`, so it adds
// no draw calls beyond the chunk's existing cutout mesh — distance culling
// (World foliage setting) keeps far decoration cheap.

export type SetBlock = (lx: number, ly: number, lz: number, id: number) => void;

export interface DecoColumn {
  lx: number;
  lz: number;
  topY: number;
  surface: number;
  biome: BiomeDef;
  landId: BiomeId;
  wx: number;
  wz: number;
  /** True if an adjacent column is water (for reeds/papyrus). */
  nearWater: boolean;
}

function hash01(x: number, z: number, seed: string, salt: number): number {
  let h = 374761393 ^ salt;
  const s = `${x},${z},${seed}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 0x100000000;
}

export class DecorationGenerator {
  constructor(
    private readonly noise: Noise,
    private readonly seed: string,
  ) {}

  private r(x: number, z: number, salt: number): number {
    return hash01(x, z, this.seed, salt);
  }

  /** Try to place ground cover at a dressed column. Returns true if it placed something. */
  place(col: DecoColumn, set: SetBlock): boolean {
    const { lx, lz, topY, surface, biome, wx, wz } = col;
    const above = topY + 1;
    if (above <= 0) return false;
    const n = this.noise;

    // Cluster signals: grove = tree-friendly, flora = herb-friendly.
    const grove = n.fbm2(wx * 0.03 + 700, wz * 0.03 + 700, 2) * 0.5 + 0.5;
    const flora = n.fbm2(wx * 0.05 + 300, wz * 0.05 + 300, 2) * 0.5 + 0.5;
    const f = flora * (0.5 + grove * 0.7);

    // Desert: dead bushes + (rare) cactus only.
    if (biome.id === "desert" || surface === B.DESERT_SAND) {
      if (this.r(wx, wz, 41) < 0.03 * (0.3 + grove)) {
        set(lx, above, lz, B.DEAD_BUSH);
        return true;
      }
      if (this.r(wx, wz, 42) < 0.012 * (0.3 + grove)) {
        const h = 2 + Math.floor(this.r(wx, wz, 43) * 3);
        for (let i = 0; i < h; i++) set(lx, above + i, lz, B.CACTUS);
        return true;
      }
      return false;
    }

    // Papyrus / reeds at the water's edge.
    if (col.nearWater && this.r(wx, wz, 44) < 0.18) {
      const h = 2 + Math.floor(this.r(wx, wz, 45) * 2);
      for (let i = 0; i < h; i++) set(lx, above + i, lz, B.PAPYRUS);
      return true;
    }

    // Snowy/cold surfaces: very sparse cover (snow already coats the ground).
    if (biome.id === "tundra" || biome.id === "snowyMountain") {
      if (surface === B.SNOWY_GRASS && this.r(wx, wz, 46) < 0.04 * f) {
        set(lx, above, lz, B.DEAD_BUSH);
        return true;
      }
      return false;
    }

    // Grass-eligible surfaces (grass / dry grass / jungle grass / snowy grass).
    const grassy =
      surface === B.GRASS ||
      surface === B.DRY_GRASS ||
      surface === B.JUNGLE_GRASS ||
      surface === B.SNOWY_GRASS;
    if (!grassy) return false;

    const roll = this.r(wx, wz, 47);
    const grassP = biome.grassDensity * f * 0.8;
    if (roll < grassP) {
      // Forest/denseForest get ferns mixed into the grass.
      if ((biome.id === "forest" || biome.id === "denseForest") && this.r(wx, wz, 48) < 0.25) {
        set(lx, above, lz, B.FERN);
      } else {
        set(lx, above, lz, B.TALL_GRASS);
      }
      return true;
    }
    const flowerP = biome.flowerDensity * f;
    if (roll < grassP + flowerP) {
      const fr = this.r(wx, wz, 49);
      set(lx, above, lz, fr < 0.4 ? B.FLOWER_RED : fr < 0.7 ? B.FLOWER_YELLOW : B.CORNFLOWER);
      return true;
    }
    const shrubP = biome.shrubDensity * f * 0.6;
    if (roll < grassP + flowerP + shrubP) {
      // Forests favour ferns; savanna/rainforest favour mushrooms.
      if (biome.id === "rainforest" && this.r(wx, wz, 50) < 0.4) {
        set(lx, above, lz, B.MUSHROOM);
      } else if (biome.id === "forest" || biome.id === "denseForest") {
        set(lx, above, lz, B.FERN);
      } else {
        set(lx, above, lz, B.TALL_GRASS);
      }
      return true;
    }
    return false;
  }
}

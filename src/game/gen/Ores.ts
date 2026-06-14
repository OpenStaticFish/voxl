import type { Noise } from "../../engine/Noise";
import * as B from "./BlockIds";

// Ore + stone-variation generation. Ores form blob/vein clusters (Luanti
// "scatter" ore type) selected by depth: coal near the surface, iron mid, copper
// deep. Each is a 3D fbm threshold so veins are connected blobs, not speckle.
// Gravel pockets and sandstone strata add underground texture. Returns 0 (no
// override) when nothing fires, leaving the host stone in place.

export class OreGenerator {
  constructor(private readonly noise: Noise) {}

  /** Sedimentary strata: occasional sandstone/gravel bands in stone. */
  stratumBlock(wx: number, y: number, wz: number): number {
    const n = this.noise;
    const s = n.fbm3(wx * 0.03 + 500, y * 0.06 + 500, wz * 0.03 + 500, 2);
    if (s > 0.34) return B.SANDSTONE;
    if (s < -0.4) return B.GRAVEL;
    return 0;
  }

  /**
   * Ore vein id for a voxel, or 0. Depth gating (y) keeps the progression
   * coal → iron → copper with depth; thresholds sit in the fbm upper tail so
   * veins are modest clusters.
   */
  oreAt(wx: number, y: number, wz: number): number {
    const n = this.noise;
    // Coal: shallow-to-mid, the most common.
    if (y > 6 && n.fbm3(wx * 0.07, y * 0.07, wz * 0.07, 2) > 0.42) return B.COAL_ORE;
    // Iron: mid-depth.
    if (y > 4 && y < 64 && n.fbm3(wx * 0.085 + 30, y * 0.085 + 30, wz * 0.085 + 30, 2) > 0.5) return B.IRON_ORE;
    // Copper: deeper, rarer.
    if (y > 2 && y < 40 && n.fbm3(wx * 0.1 + 60, y * 0.1 + 60, wz * 0.1 + 60, 2) > 0.56) return B.COPPER_ORE;
    // Scattered gravel pockets (small) for underground texture.
    if (y > 2 && n.fbm3(wx * 0.12 + 90, y * 0.12 + 90, wz * 0.12 + 90, 2) > 0.62) return B.GRAVEL;
    return 0;
  }
}

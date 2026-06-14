import type { Noise } from "../../engine/Noise";

// Climate maps: heat (temperature) and humidity. These are the two signals
// Minetest/Luanti mapgen uses to select biomes — each registered biome declares
// a (heat_point, humidity_point) and the column is assigned to the biome whose
// point is nearest in climate space (see Biomes.ts).
//
// Deliberately single-octave, very-low-frequency (~0.0008) so biomes stay large
// and coherent. Raising octaves/frequency re-fragments them into tiny patches
// (a well-known Luanti pitfall). See AGENTS.md.

export interface Climate {
  /** Temperature in [0,1]. 0 = freezing, 1 = scorching. */
  heat: number;
  /** Moisture in [0,1]. 0 = arid, 1 = drenched. */
  humidity: number;
}

// The Noise impl's fbm2(1 octave) has standard deviation ≈ 0.27 (measured over
// many seeds; it is a property of the gradient set, not the seed). A naive
// 0.5 + 0.5*v mapping only covers ~[0.15, 0.76], so hot biomes (desert) could
// never be selected. Dividing by ~2·sd spreads the empirical range across the
// full [0,1] so every climate point is reachable.
const FBM_SD = 0.27;
function climate01(v: number): number {
  const x = 0.5 + v / (2 * FBM_SD);
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export class ClimateMaps {
  constructor(private readonly noise: Noise) {}

  /** Raw heat/humidity for a world column (before altitude chill). */
  base(wx: number, wz: number): Climate {
    const n = this.noise;
    // Distinct offsets keep heat and humidity independent. The very low
    // frequency yields biomes hundreds of blocks across.
    const heat = climate01(n.fbm2(wx * 0.00075 + 500, wz * 0.00075 + 500, 1));
    const humidity = climate01(n.fbm2(wx * 0.00075, wz * 0.00075 + 900, 1));
    return { heat, humidity };
  }

  /**
   * Altitude chill (Minetest "valleys" mapgen concept): temperature falls with
   * elevation so cold biomes climb the mountains rather than appearing as random
   * flat patches. Chill is gentle and only kicks in well above sea level, so
   * rolling lowlands keep their climate biome and only genuine highlands trend
   * cold. Returns the effective heat in [0,1].
   */
  static effectiveHeat(heat: number, height: number, seaLevel: number, snowLine: number): number {
    const chillStart = seaLevel + 8;
    if (height <= chillStart) return heat;
    const span = Math.max(8, snowLine - chillStart);
    const t = Math.min(1, (height - chillStart) / span);
    return heat - t * 0.45;
  }
}

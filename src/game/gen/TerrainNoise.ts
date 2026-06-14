import type { Noise } from "../../engine/Noise";

// Layered terrain heightmap, inspired by Luanti mapgen v7 + carpathian:
//
//   height = continent(base) + hills + ridged-mountains + rivers + detail
//
// Each layer is an independent noise sampled at world coordinates, so the result
// is fully deterministic per seed and seamless across chunk borders (the
// generator only ever queries height(wx, wz) at absolute coordinates).
//
// Layers:
//   • continent  — very-low-freq fbm; broad landmasses vs ocean basins.
//   • hills      — medium-freq fbm; rolling countryside relief.
//   • mountain mask + ridged noise — sharp peaks & ridges, but only inside
//                  mountain regions (the mask) so most of the world stays mild.
//   • rivers     — thin ridged bands carved toward sea level (Luanti "ridges"),
//                  producing valleys/canyons and varied coastlines.
//   • detail     — high-freq micro-relief so close-range ground isn't sterile.
//
// The whole field is biased a little above sea level so land dominates ocean
// (keeps spawn sane without special-casing the seed).

export interface HeightNoiseConfig {
  seaLevel: number;
  maxHeight: number;
}

export class HeightMap {
  private readonly sea: number;
  private readonly max: number;

  constructor(
    private readonly noise: Noise,
    cfg: HeightNoiseConfig,
  ) {
    this.sea = cfg.seaLevel;
    this.max = cfg.maxHeight;
  }

  /** Final 2D base surface height (float). */
  height(wx: number, wz: number): number {
    const n = this.noise;
    // Continent: broad ocean/landmass. Slight positive bias → more land.
    const continent = n.fbm2(wx * 0.0033, wz * 0.0033, 4);
    let h = this.sea + 6 + continent * 20;

    // Rolling hills.
    const hills = n.fbm2(wx * 0.013 + 200, wz * 0.013 + 200, 3);
    h += hills * 9;

    // Mountains: only where the regional mask allows, then a ridged noise
    // (1 - |n|) raised to a power gives sharp peaks rather than smooth bumps.
    const mask = this.mountainMask(wx, wz);
    if (mask > 0.02) {
      const ridge = 1 - Math.abs(n.noise2(wx * 0.011 + 50, wz * 0.011 + 50));
      const ridge2 = 1 - Math.abs(n.noise2(wx * 0.023 + 320, wz * 0.023 + 320));
      const peak = Math.pow(ridge, 1.4) * 0.7 + Math.pow(ridge2, 2.2) * 0.3;
      h += mask * mask * peak * 56;
      // Carpathian-style subtle terracing inside the strongest cores.
      if (mask > 0.55) {
        const terrace = n.fbm2(wx * 0.008 + 700, wz * 0.008 + 700, 2);
        const steps = Math.round((terrace + 1) * 3) / 3;
        h += (steps - 0.5) * 6 * (mask - 0.55);
      }
    }

    // Rivers: thin ridged bands carved down toward (and slightly below) sea.
    h += this.riverOffset(wx, wz);

    // High-freq detail — damped near sea level so coastlines read as broad,
    // smooth bands instead of noisy 1-block wiggles. The damping uses the
    // pre-detail height so there's no feedback loop.
    const detail = n.fbm2(wx * 0.05 + 400, wz * 0.05 + 400, 2);
    const distFromSea = Math.abs(h - this.sea);
    const detailScale = distFromSea < 12 ? 0.25 + 0.75 * (distFromSea / 12) : 1;
    h += detail * 2.5 * detailScale;

    return h < 3 ? 3 : h > this.max ? this.max : h;
  }

  /** 0..1 mask of where 3D mountain terrain (overhangs/cliffs) is allowed. */
  mountainMask(wx: number, wz: number): number {
    const v = this.noise.fbm2(wx * 0.0042 + 1000, wz * 0.0042 + 1000, 3) + 0.1;
    const m = Math.min(1, Math.max(0, v * 1.7));
    return m;
  }

  /**
   * River carving offset (negative or ~0). A ridged noise produces thin bands
   * where the value is high; we scoop terrain there toward sea level, leaving
   * most columns untouched. Returns the delta to add to height.
   */
  private riverOffset(wx: number, wz: number): number {
    const n = this.noise;
    const river = 1 - Math.abs(n.noise2(wx * 0.0029 + 800, wz * 0.0029 + 800));
    if (river < 0.82) return 0;
    // Strength of the carve (0..1) inside the band.
    const s = (river - 0.82) / 0.18;
    // Carve proportionally to how far above sea we are, floor at ~sea-4.
    // Pre-compute the rough current height by reusing the cheaper terms; the
    // river contribution is excluded so there's no feedback loop.
    const approx =
      this.sea + 6 + n.fbm2(wx * 0.0033, wz * 0.0033, 4) * 20 + n.fbm2(wx * 0.013 + 200, wz * 0.013 + 200, 3) * 9;
    const target = this.sea - 3;
    const delta = (target - approx) * s * 0.9;
    return delta < -52 ? -52 : delta;
  }

  /**
   * Approximate surface slope at a column via finite differences of the height
   * field. Useful as a hint; the surface painter recomputes the *true* slope
   * from dressed neighbour column tops when it has them (more accurate around
   * 3D-carved cliffs).
   */
  slope(wx: number, wz: number): number {
    const h = this.height(wx, wz);
    const hx = this.height(wx + 1, wz);
    const hz = this.height(wx, wz + 1);
    return Math.max(Math.abs(hx - h), Math.abs(hz - h));
  }
}

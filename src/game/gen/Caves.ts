import type { Noise } from "../../engine/Noise";

// Cave generation, modelled on Luanti's mapgen v7 cave system:
//
//   • Worm tunnels — two 3D noises intersected: a column is air where both lie
//     within narrow bands, producing winding tubes (the classic "two noises"
//     technique). A slow noise varies the tube width so tunnels breathe.
//   • Caverns — a low-frequency 3D fbm above a high threshold, only deep down,
//     yielding rare large chambers.
//
// Carving respects a surface crust so caves don't gut the dressed terrain, and
// avoids caves beneath shallow/ocean columns (the liquid sim has no pressure
// model — see AGENTS.md). Cave *entrances* are allowed on hills via a noise
// gate so the underground occasionally breaches the surface.

export class CaveGenerator {
  constructor(private readonly noise: Noise) {}

  /**
   * @param height  dressed 2D surface height for the column
   * @param sea     sea level
   * @returns true if the voxel should be carved to air
   */
  isCarved(wx: number, y: number, wz: number, height: number, sea: number): boolean {
    if (y < 2) return false;
    if (y > height + 3) return false;
    // Keep caves out of shallow / ocean columns (no pressure-based flow sim).
    if (height <= sea + 1 && y < sea) return false;

    const n = this.noise;

    // --- Worm tunnels (intersecting bands) ---
    const a = n.noise3(wx * 0.04, y * 0.075, wz * 0.04);
    const b = n.noise3(wx * 0.04 + 100, y * 0.05 + 100, wz * 0.04 + 100);
    // Slow width modulation: deeper → slightly wider tunnels.
    const depthFrac = y < sea ? 1 : Math.max(0, 1 - (height - y) / 40);
    const half = 0.062 + depthFrac * 0.02;
    const tube = 0.3;
    if (Math.abs(a) < half && Math.abs(b) < tube) {
      // Surface crust: don't carve the top few blocks unless this is a hill with
      // an "entrance" gate (so caves sometimes open onto the surface).
      if (y > height - 5) {
        const entrance = n.noise2(wx * 0.13 + 5, wz * 0.13 + 5);
        if (height < sea + 14 || entrance < 0.5) return false;
      }
      return true;
    }

    // --- Caverns (rare, deep) ---
    if (y < sea - 14 && y > 2) {
      const c = n.fbm3(wx * 0.018 + 50, y * 0.025 + 50, wz * 0.018 + 50, 2);
      if (c > 0.6) {
        // Preserve the crust even for caverns near the surface.
        if (y > height - 6) return false;
        return true;
      }
    }
    return false;
  }
}

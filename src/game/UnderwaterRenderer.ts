import { Color3, Scene } from "@babylonjs/core";
import type { LiquidDef } from "./Blocks";

/**
 * Underwater presentation: when the player's eye is submerged, this (a) pulls
 * the scene fog in close and tints it the liquid's colour, and (b) fades in a
 * full-screen DOM tint so the world reads as "underwater" without a costly
 * full-screen post-process. Above the surface everything is left untouched.
 *
 * Stability: a 0..1 `submerge` factor is lerped each frame, so crossing the
 * surface is a smooth fade rather than a flicker even though "eye in water" is
 * a discrete per-frame boolean. The surface fog baseline is supplied by the
 * game (`setSurfaceFog`); this class only overrides `scene.fog*` while the
 * factor is non-zero, and writes the baseline back when fully surfaced.
 */
export class UnderwaterRenderer {
  private readonly scene: Scene;
  private readonly overlay: HTMLElement;
  /** Current 0..1 submerge blend (lerped; 0 = fully above, 1 = fully under). */
  private factor = 0;
  /** Liquid the eye is currently in (null = air). */
  private liquid: LiquidDef | null = null;
  /** Cached surface (above-water) fog, supplied by the game each change. */
  private surfaceStart = 60;
  private surfaceEnd = 220;
  private surfaceColor = new Color3(0.75, 0.89, 1);

  constructor(scene: Scene) {
    this.scene = scene;
    this.overlay = this.createOverlay();
  }

  private createOverlay(): HTMLElement {
    let el = document.getElementById("underwater-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "underwater-overlay";
      el.style.position = "fixed";
      el.style.inset = "0";
      el.style.pointerEvents = "none";
      el.style.zIndex = "5";
      el.style.mixBlendMode = "normal";
      el.style.opacity = "0";
      el.style.transition = "background-color 0.2s linear";
      document.getElementById("app")?.appendChild(el) ?? document.body.appendChild(el);
    }
    el.style.background = "rgba(31,111,176,0.0)";
    return el;
  }

  /** Record the above-water fog baseline (called whenever the game changes it). */
  setSurfaceFog(start: number, end: number, color: Color3): void {
    this.surfaceStart = start;
    this.surfaceEnd = end;
    this.surfaceColor.copyFrom(color);
  }

  get isUnderwater(): boolean {
    return this.factor > 0.5;
  }

  get submergeFactor(): number {
    return this.factor;
  }

  /**
   * Advance the submerge blend and apply fog + tint.
   *
   * @param dt            frame delta (seconds)
   * @param submerged     true when the player's eye is inside a liquid this frame
   * @param liquid        the liquid at the eye (null if air)
   * @param dayFactor     0..1 daylight factor (underwater is darker at night)
   */
  update(dt: number, submerged: boolean, liquid: LiquidDef | null, dayFactor: number): void {
    // Lerp toward the target (1 underwater, 0 above). Fast enough to feel
    // responsive, slow enough to avoid single-frame flicker at the surface.
    const target = submerged ? 1 : 0;
    const speed = submerged ? 9 : 6; // 1/s
    const f = this.factor + (target - this.factor) * Math.min(1, speed * dt);
    this.factor = f > 0.999 ? 1 : f < 0.001 ? 0 : f;

    if (f <= 0.001) {
      // Fully above: restore the surface fog baseline exactly.
      this.scene.fogStart = this.surfaceStart;
      this.scene.fogEnd = this.surfaceEnd;
      this.scene.fogColor.copyFrom(this.surfaceColor);
      this.overlay.style.opacity = "0";
      return;
    }

    const ldef = liquid ?? this.liquid ?? null;
    this.liquid = ldef;
    // Default water-ish tint if we somehow have no def.
    const tintHex = ldef?.fogColor ?? "#1f6fb0";
    const density = ldef?.fogDensity ?? 0.45;
    const tint = Color3.FromHexString(tintHex);

    // Pull the fog in: underwater end = surface end × density (murkier).
    const underEnd = this.surfaceEnd * density;
    const underStart = 0;
    this.scene.fogStart = lerp(this.surfaceStart, underStart, f);
    this.scene.fogEnd = lerp(this.surfaceEnd, underEnd, f);
    // Blend the fog colour toward the liquid tint.
    this.scene.fogColor.r = lerp(this.surfaceColor.r, tint.r, f);
    this.scene.fogColor.g = lerp(this.surfaceColor.g, tint.g, f);
    this.scene.fogColor.b = lerp(this.surfaceColor.b, tint.b, f);

    // DOM tint overlay. Stronger in daylight (so you can still see at night we
    // don't over-darken); opacity scales with submerge factor.
    const alpha = 0.42 * f * (0.55 + 0.45 * dayFactor);
    const r = Math.round(tint.r * 255);
    const g = Math.round(tint.g * 255);
    const b = Math.round(tint.b * 255);
    this.overlay.style.background = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    this.overlay.style.opacity = "1";
  }

  dispose(): void {
    this.overlay.remove();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

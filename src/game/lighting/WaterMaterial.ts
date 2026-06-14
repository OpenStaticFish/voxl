import { Color3, Material, Scene, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import type { WaterQuality } from "../graphics/GraphicsSettings";

/**
 * Water surface material.
 *
 * IMPORTANT HISTORY: this was previously a custom GLSL `ShaderMaterial`. Despite
 * setting `transparencyMode = MATERIAL_ALPHABLEND` and pushing alpha all the way
 * to 0.92, the water stayed nearly invisible — a `ShaderMaterial` transparency
 * edge case (alpha combining against an unbound texture alpha) defeated every
 * tuning attempt. To make water RELIABLY visible, we render it with a plain
 * `StandardMaterial`, which is what made water visible originally and which
 * Babylon handles transparently (pun intended) with zero ambiguity.
 *
 * Properties:
 *   - solid blue diffuse + a small emissive floor (readable even in shadow/night)
 *   - subtle specular → a sun glint that reads as "water"
 *   - lit by the scene's Babylon lights (so it dims at night) and fogged by the
 *     scene fog (so it blends with terrain at distance — no more vanishing lakes)
 *   - alpha-blended, double-sided, no depth write
 *   - no atlas texture → no tiling repetition
 *
 * Quality tiers only change alpha (lower tiers slightly more opaque = clearer).
 * The mesh's baked vertex colours are disabled (see World.applyMesh) so they
 * can't darken the surface — the StandardMaterial supplies a uniform tint.
 */
export interface WaterMaterialOptions {
  /** Unused (kept for API compatibility). Water is a solid colour, not textured. */
  texture?: Texture;
}

export class WaterMaterial {
  readonly material: StandardMaterial;
  private quality: WaterQuality = "medium";
  private alpha = 0.78;

  constructor(scene: Scene, _options?: WaterMaterialOptions) {
    void _options;
    const mat = new StandardMaterial("voxel-water", scene);
    mat.diffuseColor = Color3.FromHexString("#1f86d8"); // clear blue
    mat.emissiveColor = Color3.FromHexString("#0b3a6b"); // subtle blue glow floor
    mat.specularColor = new Color3(0.35, 0.4, 0.5); // sun glint
    mat.specularPower = 96;
    mat.backFaceCulling = false; // see the surface from below
    mat.disableDepthWrite = true; // don't occlude submerged terrain
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.fogEnabled = true; // blend into the scene fog at distance (matches terrain)
    this.material = mat;
    this.setQuality(this.quality);
  }

  setQuality(quality: WaterQuality): void {
    this.quality = quality;
    // All tiers stay clearly readable as water. Higher tiers are slightly more
    // transparent (livelier) but never so much that the surface disappears.
    this.alpha = quality === "low" ? 0.85 : quality === "high" ? 0.72 : 0.78;
    this.material.alpha = this.alpha;
  }

  get currentQuality(): WaterQuality {
    return this.quality;
  }

  get currentAlpha(): number {
    return this.alpha;
  }

  /**
   * Debug: force the water fully opaque + flat bright blue, bypassing lighting
   * and transparency. Use `__voxl.waterOpaque()` to confirm whether a suspect
   * patch is the water layer (it turns into a solid blue slab) vs terrain.
   */
  setDebugOpaque(on: boolean): void {
    if (on) {
      this.material.alpha = 1.0;
      this.material.emissiveColor = Color3.FromHexString("#1f9fe0");
      this.material.diffuseColor = Color3.FromHexString("#1f9fe0");
    } else {
      this.material.diffuseColor = Color3.FromHexString("#1f86d8");
      this.material.emissiveColor = Color3.FromHexString("#0b3a6b");
      this.setQuality(this.quality);
    }
  }

  // Day/night + fog + animation are handled by the StandardMaterial (scene
  // lights + scene fog), so these are kept as no-ops for API compatibility.
  setDayNight(_dayFactor: number, _moonFloor: number): void {
    void _dayFactor;
    void _moonFloor;
  }
  setFog(_cameraPosition: Vector3, _color: Color3, _start: number, _end: number): void {
    void _cameraPosition;
    void _color;
    void _start;
    void _end;
  }
  setTime(_time: number): void {
    void _time;
  }

  dispose(): void {
    this.material.dispose();
  }
}

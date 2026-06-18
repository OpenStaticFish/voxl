import { Color3, DynamicTexture, Material, Scene, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import type { WaterQuality } from "../graphics/GraphicsSettings";

/**
 * Water surface material — a stylized, Minetest/Luanti-inspired voxel water.
 *
 * VISUAL DESIGN (clean terrain-behind-water + no grid):
 *   • **Depth write is OFF** (transparent best-practice). The opaque terrain is
 *     drawn first and writes depth, so it ALWAYS shows through the water's alpha
 *     cleanly — no "black gaps" or missing patches behind the surface. (An
 *     earlier attempt turned depth-write ON to kill a grid; that instead caused
 *     transparent water to occlude itself under Babylon's per-mesh transparent
 *     sort and fight depth precision at the water/terrain interface.)
 *   • The "stacked-glass grid" is prevented at the MESH level instead: the
 *     mesher no longer emits water bottom faces (the only overlapping-transparent
 *     source for a flat body), so a lake renders just its tiling top surface —
 *     nothing stacks, no grid, even with depth-write off.
 *   • A subtle procedural surface texture (soft caustic noise) is scrolled over
 *     time for gentle movement. The mesher emits WORLD-SPACE UVs for water so
 *     the texture is continuous across the whole body (no per-block tiling grid).
 *   • Tint is a clear blue with a small emissive floor (readable at night) and
 *     a soft specular sun glint. Quality tiers scale alpha/animation/specular.
 *
 * This stays a plain `StandardMaterial` on purpose: an earlier custom
 * `ShaderMaterial` made water invisible (alpha-combining against an unbound
 * texture alpha). StandardMaterial transparency is unambiguous and reliable.
 */
export interface WaterMaterialOptions {
  /** Unused (kept for API compatibility). The water texture is generated. */
  texture?: Texture;
}

/** World-space UV repeat (texels per block) — keeps the surface pattern coarse. */
const WATER_UV_SCALE = 0.18;
/** Pixel size of the procedural water surface texture. */
const WATER_TEX_PX = 64;

export class WaterMaterial {
  readonly material: StandardMaterial;
  /** Animated surface texture (scrolled via uOffset/vOffset — cheap uniform). */
  private readonly waterTexture: DynamicTexture;
  private quality: WaterQuality = "medium";
  private alpha = 0.82;
  /** Base diffuse/emissive colours (the subtle animation oscillates around these). */
  private readonly baseDiffuse = Color3.FromHexString("#1f86d8");
  private readonly baseEmissive = Color3.Black();
  private readonly shimmerColor = Color3.FromHexString("#2aa0e8");
  private animTime = 0;
  private animationEnabled = true;

  constructor(scene: Scene, _options?: WaterMaterialOptions) {
    void _options;
    const mat = new StandardMaterial("voxel-water", scene);
    this.waterTexture = this.createSurfaceTexture(scene);
    // Texture modulates diffuse colour only — its alpha stays solid so the
    // material's `alpha` controls transparency (avoids the invisible-water bug).
    this.waterTexture.hasAlpha = false;
    this.waterTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    this.waterTexture.wrapV = Texture.WRAP_ADDRESSMODE;
    this.waterTexture.uScale = WATER_UV_SCALE;
    this.waterTexture.vScale = WATER_UV_SCALE;
    this.waterTexture.coordinatesMode = Texture.EXPLICIT_MODE;
    mat.diffuseTexture = this.waterTexture;
    mat.diffuseColor = this.baseDiffuse.clone();
    mat.emissiveColor = this.baseEmissive.clone();
    mat.specularColor = new Color3(0.35, 0.4, 0.5); // sun glint
    mat.specularPower = 96;
    mat.backFaceCulling = false; // see the surface from below when underwater
    // Transparent best-practice: do NOT write depth. The opaque terrain is
    // rendered first (and writes depth), so it always shows through the water's
    // alpha cleanly. Writing depth here caused "black gaps" behind the water:
    // under Babylon's per-MESH (not per-triangle) transparent sort, a
    // depth-writing water surface occluded other water surfaces / fought depth
    // precision at the water-terrain interface. The earlier "stacked-glass grid"
    // is now prevented a different way — the mesher no longer emits water bottom
    // faces (the only overlapping-transparent source for a flat lake), so a lake
    // renders just its tiling top surface with nothing to stack.
    mat.disableDepthWrite = true;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.fogEnabled = true; // blend into the scene fog at distance (matches terrain)
    this.material = mat;
    this.setQuality(this.quality);
  }

  /**
   * Procedural water surface texture: a soft, low-contrast caustic-ish noise on
   * blue, roughly tileable. Drawn once to a 64×64 canvas; animation comes from
   * scrolling the texture (uOffset/vOffset), not redrawing — so it costs ~0
   * per frame. Bilinear+trilinear filtering keeps it smooth at distance (no
   * NEAREST shimmer); mipmaps are safe here because this is a standalone
   * texture, not the shared 8×8 atlas.
   */
  private createSurfaceTexture(scene: Scene): DynamicTexture {
    const tex = new DynamicTexture(
      "voxel-water-surface",
      { width: WATER_TEX_PX, height: WATER_TEX_PX },
      scene,
      true, // generateMipMaps → trilinear, smooth at distance
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    // Base translucent blue (alpha is ignored — material.alpha drives it).
    ctx.fillStyle = "rgb(40,108,184)";
    ctx.fillRect(0, 0, WATER_TEX_PX, WATER_TEX_PX);
    // Soft lighter "ripple" blobs (low contrast → subtle, no harsh pattern).
    const rand = mulberry32(20240614);
    for (let i = 0; i < 26; i++) {
      const x = rand() * WATER_TEX_PX;
      const y = rand() * WATER_TEX_PX;
      const r = 4 + rand() * 9;
      const lift = 28 + rand() * 26;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${96 + lift | 0},${158 + lift | 0},${214 + lift | 0},0.55)`);
      grad.addColorStop(1, "rgba(40,108,184,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // A few darker streaks for depth variation.
    for (let i = 0; i < 10; i++) {
      const x = rand() * WATER_TEX_PX;
      const y = rand() * WATER_TEX_PX;
      const w = 6 + rand() * 10;
      ctx.fillStyle = "rgba(20,72,128,0.35)";
      ctx.fillRect(x, y, w, 1);
    }
    tex.update(false);
    return tex;
  }

  setQuality(quality: WaterQuality): void {
    this.quality = quality;
    // All tiers stay clearly readable as water. Slightly higher alpha than
    // before for a cleaner, less "glassy" surface read.
    this.alpha = quality === "low" ? 0.88 : quality === "high" ? 0.76 : 0.82;
    this.material.alpha = this.alpha;
    this.material.specularPower = quality === "high" ? 128 : quality === "low" ? 64 : 96;
    this.material.diffuseColor = this.baseDiffuse.clone();
    this.material.emissiveColor = this.baseEmissive.clone();
  }

  /**
   * Per-frame animation: scroll the surface texture for gentle movement, plus a
   * tiny two-sine tint shimmer. Both are cheap uniform writes on a shared
   * material — no per-vertex CPU work, no geometry rebuild. Disabled on Low or
   * when the debug "disable animation" toggle is off.
   */
  animate(dt: number): void {
    if (this.quality === "low" || !this.animationEnabled) return;
    this.animTime += dt;
    const tex = this.waterTexture;
    // Slow diagonal scroll + a subtle sideways sway for an organic drift.
    tex.uOffset = this.animTime * 0.018;
    tex.vOffset = this.animTime * 0.012 + Math.sin(this.animTime * 0.3) * 0.01;
    // Faint global tint shimmer (amplitude tiny so the hue is stable).
    const amp = this.quality === "high" ? 0.05 : 0.03;
    const w = Math.sin(this.animTime * 0.9) * 0.5 + Math.sin(this.animTime * 0.37 + 1.3) * 0.5;
    const m = this.material;
    m.diffuseColor.r = this.baseDiffuse.r + (this.shimmerColor.r - this.baseDiffuse.r) * amp * w;
    m.diffuseColor.g = this.baseDiffuse.g + (this.shimmerColor.g - this.baseDiffuse.g) * amp * w;
    m.diffuseColor.b = this.baseDiffuse.b + (this.shimmerColor.b - this.baseDiffuse.b) * amp * w;
    m.emissiveColor.copyFrom(this.baseEmissive);
  }

  /** Debug: enable/disable the surface scroll + shimmer (texture stays put). */
  setAnimationEnabled(on: boolean): void {
    this.animationEnabled = on;
    if (!on) {
      this.waterTexture.uOffset = 0;
      this.waterTexture.vOffset = 0;
    }
  }
  get animationOn(): boolean {
    return this.animationEnabled;
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
   * patch is the water layer (it turns into a solid blue slab) vs terrain. If
   * the "holes behind water" disappear with this on, the cause is transparency
   * / depth sorting (the current default), NOT terrain generation.
   */
  setDebugOpaque(on: boolean): void {
    if (on) {
      this.material.alpha = 1.0;
      this.material.diffuseTexture = null; // flat colour, no scrolling
      this.material.emissiveColor = Color3.FromHexString("#1f9fe0");
      this.material.diffuseColor = Color3.FromHexString("#1f9fe0");
    } else {
      this.material.diffuseTexture = this.waterTexture;
      this.material.diffuseColor = this.baseDiffuse.clone();
      this.material.emissiveColor = this.baseEmissive.clone();
      this.setQuality(this.quality);
    }
  }

  /**
   * Debug: toggle water depth-write on/off to isolate transparency/depth
   * artifacts. Default is OFF (correct for transparent water — terrain behind
   * shows through cleanly). Turning it ON may reintroduce occlusion-style
   * artifacts but can help confirm the cause of a rendering bug.
   */
  setDepthWrite(on: boolean): void {
    this.material.disableDepthWrite = !on;
  }
  get depthWriteOn(): boolean {
    return !this.material.disableDepthWrite;
  }

  /**
   * Debug: swap to a plain untextured blue StandardMaterial (no procedural
   * surface texture, no shimmer). If an artifact disappears with this on, the
   * procedural texture/animation was the cause, not depth/sorting.
   */
  setSimpleMaterial(on: boolean): void {
    if (on) {
      this.material.diffuseTexture = null;
      this.material.specularColor = new Color3(0.2, 0.25, 0.3);
      this.setAnimationEnabled(false);
    } else {
      this.material.diffuseTexture = this.waterTexture;
      this.material.specularColor = new Color3(0.35, 0.4, 0.5);
      this.setQuality(this.quality);
    }
  }

  // Day/night + fog are handled by the StandardMaterial (scene lights + scene
  // fog), so these are kept as no-ops for API compatibility.
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

  dispose(): void {
    this.material.dispose();
    this.waterTexture.dispose();
  }
}

/** Small deterministic PRNG so the surface texture is identical every run. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

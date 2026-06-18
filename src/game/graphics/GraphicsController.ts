// Applies {@link GraphicsSettings} to the live Babylon engine/scene so changes
// take effect at runtime without a reload. The controller owns the post-process
// pipeline and render-scale; per-world objects (materials, shadows, clouds) are
// bound via {@link attachWorld} when a world is created.
//
// Everything here is idempotent and short-circuits when nothing changed, so it
// is safe to call {@link apply} every time settings change.

import {
  DefaultRenderingPipeline,
  type Engine,
  type Scene,
} from "@babylonjs/core";
import type { Sky } from "../../engine/Sky";
import type { World } from "../World";
import type { LightingSystem } from "../lighting/LightingSystem";
import type { UniversalCamera } from "@babylonjs/core";
import {
  GRAPHICS_PRESETS,
  type GraphicsSettings,
  type ShadowQuality,
} from "./GraphicsSettings";
import type { ShadowConfig } from "../lighting/LightingConfig";

/** Resolve a shadow-quality tier to a concrete shadow-map configuration. */
export function shadowConfigForQuality(quality: ShadowQuality): {
  enabled: boolean;
  config: Partial<ShadowConfig>;
} {
  switch (quality) {
    case "low":
      return { enabled: true, config: { mapSize: 1024, casterRadius: 40, frustum: 72, blur: false } };
    case "medium":
      return { enabled: true, config: { mapSize: 2048, casterRadius: 48, frustum: 80, blur: true } };
    case "high":
      return { enabled: true, config: { mapSize: 4096, casterRadius: 64, frustum: 96, blur: true } };
    case "off":
    default:
      return { enabled: false, config: {} };
  }
}

/** Maximum supported render distance (chunk radius), capped for browser safety. */
export const MAX_RENDER_DISTANCE = 20;
/** Minimum render distance — below this the world feels empty. */
export const MIN_RENDER_DISTANCE = 2;

export class GraphicsController {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly sky: Sky;
  private readonly camera: UniversalCamera;
  private world: World | null = null;
  private lighting: LightingSystem | null = null;

  private pipeline: DefaultRenderingPipeline | null = null;
  private last: GraphicsSettings | null = null;

  constructor(engine: Engine, scene: Scene, sky: Sky, camera: UniversalCamera) {
    this.engine = engine;
    this.scene = scene;
    this.sky = sky;
    this.camera = camera;
  }

  /** Bind the per-world objects (re-called whenever a new world is created). */
  attachWorld(world: World, lighting: LightingSystem): void {
    this.world = world;
    this.lighting = lighting;
    // Reapply the full config so a freshly created world inherits current settings.
    if (this.last) {
      const g = this.last;
      this.last = null;
      this.apply(g);
    }
  }

  detachWorld(): void {
    this.world = null;
    this.lighting = null;
  }

  /** Apply (or reapply) a graphics config. Idempotent + short-circuiting. */
  apply(g: GraphicsSettings): void {
    if (this.last && shallowEqual(this.last, g) && this.world) return;
    this.last = { ...g };
    this.applyRenderScale(g);
    this.applyAntiAliasing(g);
    this.applyFog(g);
    this.applyShadows(g);
    this.applyClouds(g);
    this.applyWater(g);
    this.applyFoliage(g);
  }

  get current(): GraphicsSettings | null {
    return this.last;
  }

  /** Re-apply render scale only (called on resize — DPR can change between displays). */
  refreshRenderScale(): void {
    if (this.last) this.applyRenderScale(this.last);
  }

  // ----------------------------------------------------------- passes ---

  private applyRenderScale(g: GraphicsSettings): void {
    const dpr = window.devicePixelRatio || 1;
    const cappedDpr = Math.min(dpr, g.dprCap);
    // setHardwareScalingLevel(s) renders at (canvas size / s). To render at
    // (cappedDpr × renderScale) device pixels per CSS pixel, s = 1 / that factor.
    const factor = Math.max(0.05, cappedDpr * g.renderScale);
    this.engine.setHardwareScalingLevel(1 / factor);
  }

  private applyAntiAliasing(g: GraphicsSettings): void {
    if (g.antiAliasing) {
      if (!this.pipeline) {
        // Create the post-process pipeline once and reuse it. A disabled
        // pipeline still costs a fullscreen RTT pass, so we dispose it entirely
        // when AA is off (below) rather than just disabling FXAA.
        this.pipeline = new DefaultRenderingPipeline("fxaa", true, this.scene, [this.camera]);
        this.pipeline.fxaaEnabled = true;
        this.pipeline.bloomEnabled = false;
        this.pipeline.sharpenEnabled = false;
        // IMPORTANT: keep the pipeline a PURE FXAA pass. The custom terrain/water
        // shaders already author final sRGB colours, so enabling imageProcessing
        // here re-applies tone mapping / gamma and washes the whole scene out
        // (this was the High-preset washout bug). FXAA is a separate post-process
        // and runs fine without it.
        this.pipeline.imageProcessingEnabled = false;
        this.pipeline.samples = 1; // rely on FXAA, not MSAA-in-pipeline
      }
      this.pipeline.fxaaEnabled = true;
    } else if (this.pipeline) {
      // AA off: tear down the pipeline so the scene renders straight to the
      // default framebuffer. Engine-level antialiasing is also disabled at
      // context creation, so low/custom presets render with no AA.
      this.pipeline.dispose();
      this.pipeline = null;
    }
  }

  private applyFog(g: GraphicsSettings): void {
    // Scene-level fog is always available; the custom terrain shader replicates
    // it manually (fogEnabled=false on the material), driven by LightingSystem.
    // Toggling fog here just clamps the fog range to the camera so distant
    // terrain isn't artificially hidden when the player disables it.
    this.scene.fogEnabled = g.fog;
  }

  private applyShadows(g: GraphicsSettings): void {
    if (!this.lighting) return;
    const { enabled, config } = shadowConfigForQuality(g.shadows);
    this.lighting.shadows.configure({ enabled, ...config });
  }

  private applyClouds(g: GraphicsSettings): void {
    if (g.clouds === "off") this.sky.setClouds(false, false);
    else this.sky.setClouds(true, g.clouds === "simple");
  }

  private applyWater(g: GraphicsSettings): void {
    this.world?.setWaterQuality(g.water);
  }

  private applyFoliage(g: GraphicsSettings): void {
    this.world?.setFoliageDensity(g.foliage);
  }

  dispose(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.last = null;
  }
}

/** Render-distance (chunk radius) recommended for a preset. */
export function presetRenderDistance(preset: GraphicsSettings["preset"]): number {
  switch (preset) {
    case "low": return 4;
    case "high": return 16;
    case "medium":
    default: return 10;
  }
}

export { GRAPHICS_PRESETS };

function shallowEqual(a: GraphicsSettings, b: GraphicsSettings): boolean {
  return (
    a.preset === b.preset &&
    a.renderScale === b.renderScale &&
    a.dprCap === b.dprCap &&
    a.antiAliasing === b.antiAliasing &&
    a.shadows === b.shadows &&
    a.water === b.water &&
    a.foliage === b.foliage &&
    a.clouds === b.clouds &&
    a.fog === b.fog
  );
}

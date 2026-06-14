import type { Color3, Scene, Vector3 } from "@babylonjs/core";
import type { World } from "../World";
import type { Sky } from "../../engine/Sky";
import { DayNightCycle } from "./DayNightCycle";
import { CelestialSystem } from "./CelestialSystem";
import { ShadowManager } from "./ShadowManager";
import { LightingDebugOverlay, buildTargetInfo, type LightDebugInfo } from "./LightingDebugOverlay";
import { DEFAULT_SHADOW_CONFIG, LIGHT_MAX, type LightDebugMode, type ShadowConfig } from "./LightingConfig";

/**
 * Top-level facade that wires together every lighting subsystem so the rest of
 * the game (Game.ts) only talks to one object.
 *
 *   DayNightCycle       — the clock; source of truth for all time-derived state
 *   CelestialSystem     — visual sun disc + halo + moon (camera-anchored)
 *   VoxelTerrainMaterial — two-channel terrain shader (owned by World)
 *   ShadowManager       — opt-in Babylon shadow maps (disabled by default)
 *   LightingDebugOverlay — live light-value inspection panel
 *
 * Each frame this advances the clock and pushes a handful of uniforms
 * (dayFactor, moonFloor, fog, dome colours, sun/moon positions). No chunk is
 * ever remeshed because of the time of day.
 */
export class LightingSystem {
  readonly dayNight: DayNightCycle;
  readonly celestial: CelestialSystem;
  readonly shadows: ShadowManager;
  readonly overlay: LightingDebugOverlay;
  readonly config: { shadows: ShadowConfig };

  private readonly world: World;
  private readonly sky: Sky;
  private readonly scene: Scene;
  /** Accumulated wall-clock seconds, used to drive the water animation. */
  private elapsed = 0;

  constructor(world: World, sky: Sky, scene: Scene) {
    this.world = world;
    this.sky = sky;
    this.scene = scene;
    this.dayNight = new DayNightCycle(sky.sun, sky.ambient, sky.hemi, scene);
    this.celestial = new CelestialSystem(scene, sky.root);
    this.shadows = new ShadowManager(sky.sun, world, { ...DEFAULT_SHADOW_CONFIG });
    this.overlay = new LightingDebugOverlay();
    this.config = { shadows: this.shadows.config };
  }

  /**
   * Per-frame: advance the clock, position the sun/moon, and push the live
   * day/night uniforms into the terrain shader + sky dome + fog. No remeshing.
   */
  update(dt: number, cameraPosition: Vector3, playerX: number, playerY: number, playerZ: number): void {
    const dn = this.dayNight;
    dn.update(dt);

    // Visuals: sun/moon discs + sky dome gradient.
    this.celestial.update(cameraPosition, dn);
    this.sky.setDomeColours(dn.skyZenith, dn.skyHorizon);
    // Clouds are unlit, so push the day/night factor so they dim at night.
    this.sky.setCloudDayFactor(dn.dayFactor);

    // Terrain shader uniforms: sun channel × dayFactor (+ moonlight floor),
    // block channel untouched. Fog tracks the horizon colour. Pushed to BOTH the
    // opaque and cutout terrain materials so the two passes stay in lock-step.
    const fogColor: Color3 = dn.skyHorizon;
    this.world.setTerrainDayNight(dn.dayFactor, dn.moonFactor);
    this.world.setTerrainFog(
      cameraPosition,
      fogColor,
      this.scene.fogStart,
      this.scene.fogEnd,
    );

    // Water uses a plain StandardMaterial, so day/night + fog are handled by
    // the scene lights/fog (not custom uniforms). These calls are retained as
    // no-ops for API compatibility (WaterMaterial ignores them).
    this.elapsed += dt;
    this.world.waterShader.setDayNight(dn.dayFactor, dn.moonFactor);
    this.world.waterShader.setFog(cameraPosition, fogColor, this.scene.fogStart, this.scene.fogEnd);
    this.world.waterShader.setTime(this.elapsed);

    // Shadows are dormant unless explicitly enabled (terrain uses voxel sunlight).
    this.shadows.update(playerX, playerY, playerZ);
  }

  // ---- clock / time controls ----

  setTimeOfDay(t: number): void { this.dayNight.setTimeOfDay(t); }
  setSunrise(): void { this.dayNight.setSunrise(); }
  setNoon(): void { this.dayNight.setNoon(); }
  setSunset(): void { this.dayNight.setSunset(); }
  setMidnight(): void { this.dayNight.setMidnight(); }
  /** Cycle the time presets: sunrise → noon → sunset → midnight → sunrise. */
  cyclePreset(forward: boolean): string {
    const presets = ["sunrise", "noon", "sunset", "midnight"] as const;
    const times = [0.25, 0.5, 0.75, 0.0];
    const cur = this.dayNight.timeOfDay;
    // nearest preset index
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.min(Math.abs(cur - times[i]), 1 - Math.abs(cur - times[i]));
      if (d < best) { best = d; idx = i; }
    }
    idx = (idx + (forward ? 1 : presets.length - 1)) % presets.length;
    this.setTimeOfDay(times[idx]);
    return presets[idx];
  }
  pauseTime(): void { this.dayNight.pauseTime(); }
  resumeTime(): void { this.dayNight.resumeTime(); }
  togglePause(): boolean { return this.dayNight.togglePaused(); }
  faster(): void { this.dayNight.scaleTime(1.5); }
  slower(): void { this.dayNight.scaleTime(1 / 1.5); }

  // ---- shadow controls (Babylon real-time shadow; voxel light is independent) ----

  toggleShadows(): boolean { return this.shadows.toggle(); }
  get shadowsEnabled(): boolean { return this.shadows.enabled; }
  dumpShadowDiagnostics(): unknown { return this.shadows.dumpDiagnostics(); }

  // ---- debug overlay ----

  setDebugMode(mode: LightDebugMode): void { this.world.setLightDebugMode(mode); }
  cycleDebugMode(): LightDebugMode {
    const order: LightDebugMode[] = ["off", "sun", "block", "combined"];
    const cur = this.world.getLightDebugMode();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.setDebugMode(next);
    return next;
  }
  getDebugMode(): LightDebugMode { return this.world.getLightDebugMode(); }

  /** Build the throttled overlay payload for the block the player aims at. */
  buildDebugInfo(target: { x: number; y: number; z: number; block: number } | null): LightDebugInfo {
    let t: LightDebugInfo["target"] = null;
    if (target) {
      const { x, y, z, block } = target;
      const sun = this.world.lighting.getSun(x, y, z);
      const bl = this.world.lighting.getBlockLight(x, y, z);
      const combined = this.world.lighting.getCombined(x, y, z, this.dayNight.dayFactor);
      t = buildTargetInfo(block, x, y, z, sun, bl, combined);
    }
    let loaded = 0;
    let lit = 0;
    this.world.forEachOpaqueMesh((cx, cz) => {
      loaded++;
      if (this.world.lighting.hasLight(cx, cz)) lit++;
    });
    return {
      enabled: this.overlay.visible,
      timeOfDay: this.dayNight.timeOfDay,
      timeScale: this.dayNight.timeScale,
      dayFactor: this.dayNight.dayFactor,
      moonFactor: this.dayNight.moonFactor,
      sunIntensity: this.dayNight.sunIntensity,
      ambientIntensity: this.dayNight.ambientIntensity,
      sunDirection: {
        x: this.dayNight.sunDirection.x,
        y: this.dayNight.sunDirection.y,
        z: this.dayNight.sunDirection.z,
      },
      sunVisible: this.dayNight.sunVisibility,
      moonVisible: this.dayNight.moonVisibility,
      debugMode: this.getDebugMode(),
      shadowsEnabled: this.shadows.enabled,
      paused: this.dayNight.paused,
      target: t,
      dirtyCount: this.world.lightDirtyCount,
      litCount: lit,
      loadedCount: loaded,
    };
  }

  dispose(): void {
    this.celestial.dispose();
    this.shadows.dispose();
    this.overlay.dispose();
  }

  static readonly MAX_LIGHT = LIGHT_MAX;
}

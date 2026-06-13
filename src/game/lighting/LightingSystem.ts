import type { DirectionalLight, HemisphericLight, Scene } from "@babylonjs/core";
import type { World } from "../World";
import { DayNightCycle } from "./DayNightCycle";
import { ShadowManager } from "./ShadowManager";
import { LightingDebugOverlay, buildTargetInfo, type LightDebugInfo } from "./LightingDebugOverlay";
import { DEFAULT_SHADOW_CONFIG, LIGHT_MAX, type LightDebugMode, type ShadowConfig } from "./LightingConfig";

/**
 * Top-level facade that wires together every lighting subsystem so the rest of
 * the game (Game.ts) only talks to one object.
 *
 *   VoxelLightEngine  — per-voxel sun + block light (owned by World)
 *   DayNightCycle     — drives Babylon sun/ambient/hemi + sky/fog colours
 *   ShadowManager     — nearby-chunk directional shadow mapping
 *   LightingDebugOverlay — live light-value inspection panel
 *
 * The voxel light field is owned by {@link World} (it needs block access);
 * this class holds a typed reference for queries/debug. Lighting never runs in
 * the render loop unless something changed — the World queues dirty chunks and
 * relights them on a budget.
 */
export class LightingSystem {
  readonly dayNight: DayNightCycle;
  readonly shadows: ShadowManager;
  readonly overlay: LightingDebugOverlay;
  readonly config: { shadows: ShadowConfig };

  private readonly world: World;

  constructor(
    world: World,
    sun: DirectionalLight,
    ambient: HemisphericLight,
    hemi: HemisphericLight,
    scene: Scene,
  ) {
    this.world = world;
    this.dayNight = new DayNightCycle(sun, ambient, hemi, scene);
    this.shadows = new ShadowManager(sun, world, { ...DEFAULT_SHADOW_CONFIG });
    this.overlay = new LightingDebugOverlay();
    this.config = { shadows: this.shadows.config };
  }

  /** Per-frame: advance time, follow player with shadows. */
  update(dt: number, playerX: number, playerY: number, playerZ: number): void {
    this.dayNight.update(dt);
    this.shadows.update(playerX, playerY, playerZ);
  }

  // ---- shadow controls (Babylon real-time shadow; voxel light is independent) ----

  toggleShadows(): boolean {
    return this.shadows.toggle();
  }

  get shadowsEnabled(): boolean {
    return this.shadows.enabled;
  }

  dumpShadowDiagnostics(): unknown {
    return this.shadows.dumpDiagnostics();
  }

  // ---- debug controls ----

  setDebugMode(mode: LightDebugMode): void {
    this.world.setLightDebugMode(mode);
  }

  cycleDebugMode(): LightDebugMode {
    const order: LightDebugMode[] = ["off", "sun", "block", "combined"];
    const cur = this.world.getLightDebugMode();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.setDebugMode(next);
    return next;
  }

  getDebugMode(): LightDebugMode {
    return this.world.getLightDebugMode();
  }

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
    // Count dirty/light state by scanning loaded chunks via the world.
    let loaded = 0;
    let lit = 0;
    this.world.forEachOpaqueMesh((cx, cz) => {
      loaded++;
      if (this.world.lighting.hasLight(cx, cz)) lit++;
      void cx;
      void cz;
    });
    // forEachOpaqueMesh only covers meshed chunks; approximate counts are fine.
    return {
      enabled: this.overlay.visible,
      timeOfDay: this.dayNight.timeOfDay,
      dayFactor: this.dayNight.dayFactor,
      sunIntensity: this.dayNight["sun"].intensity,
      ambientIntensity: this.dayNight["ambient"].intensity,
      debugMode: this.getDebugMode(),
      shadowsEnabled: this.shadows.enabled,
      paused: this.dayNight.paused,
      target: t,
      dirtyCount: this.lightDirtyCount(),
      litCount: lit,
      loadedCount: loaded,
    };
  }

  /** Best-effort access to the World's pending light-update count. */
  private lightDirtyCount(): number {
    const w = this.world as unknown as { lightDirty?: { size: number } };
    return w.lightDirty?.size ?? 0;
  }

  dispose(): void {
    this.shadows.dispose();
    this.overlay.dispose();
  }

  static readonly MAX_LIGHT = LIGHT_MAX;
}

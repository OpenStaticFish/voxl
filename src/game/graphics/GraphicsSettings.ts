// Graphics settings: scalable, preset-driven rendering configuration for a
// browser voxel game. Three presets (Low/Medium/High) cover the common cases;
// individual toggles let advanced players tune without drowning in options.
//
// Everything here is plain data. {@link GraphicsController} turns it into real
// engine/scene/material changes; {@link Settings} persists it in localStorage.

export type GraphicsPreset = "low" | "medium" | "high" | "custom";

/** Shadow map quality. "off" disables Babylon shadows entirely (voxel light stays). */
export type ShadowQuality = "off" | "low" | "medium" | "high";

/** Water rendering tier. */
export type WaterQuality = "low" | "medium" | "high";

/** Foliage (plant-cross) density / render distance tier. */
export type FoliageDensity = "low" | "medium" | "high";

/** Cloud rendering tier. */
export type CloudsQuality = "off" | "simple" | "fancy";

export interface GraphicsSettings {
  /** Active preset. Becomes "custom" once any individual value is changed. */
  preset: GraphicsPreset;
  /**
   * Render scale as a fraction of device-pixel resolution (0.5..1).
   * 1.0 = native device pixels; 0.75 = 75% (cheaper, slightly softer).
   */
  renderScale: number;
  /** Device-pixel-ratio ceiling (1.5..2). Lower = cheaper on retina screens. */
  dprCap: number;
  /** Browser-friendly anti-aliasing (FXAA post-process when on). */
  antiAliasing: boolean;
  /** Real-time shadow quality (off by default; voxel lighting is the baseline). */
  shadows: ShadowQuality;
  /** Water visual tier. */
  water: WaterQuality;
  /** Foliage density / render distance tier. */
  foliage: FoliageDensity;
  /** Cloud tier. */
  clouds: CloudsQuality;
  /** Distance fog (hides chunk pop-in; almost always on). */
  fog: boolean;
}

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, "custom">, GraphicsSettings> = {
  low: {
    preset: "low",
    renderScale: 0.75,
    dprCap: 1.5,
    antiAliasing: false,
    shadows: "off",
    water: "low",
    foliage: "low",
    clouds: "simple",
    fog: true,
  },
  medium: {
    preset: "medium",
    renderScale: 1.0,
    dprCap: 2,
    antiAliasing: false,
    shadows: "off",
    water: "medium",
    foliage: "medium",
    clouds: "fancy",
    fog: true,
  },
  high: {
    preset: "high",
    renderScale: 1.0,
    dprCap: 2,
    antiAliasing: true,
    shadows: "off",
    water: "high",
    foliage: "high",
    clouds: "fancy",
    fog: true,
  },
};

/** Default graphics settings — conservative Medium, tuned down for browser safety. */
export function defaultGraphicsSettings(): GraphicsSettings {
  return detectLowEndDevice()
    ? { ...GRAPHICS_PRESETS.low }
    : { ...GRAPHICS_PRESETS.medium };
}

/** A sensible default render distance (chunks) matching the device class. */
export function defaultRenderDistance(): number {
  return detectLowEndDevice() ? 4 : 10;
}

/**
 * Best-effort low-end device detection. Uses the hints browsers actually expose
 * (CPU cores, device memory, mobile UA, DPR) and errs on the side of "low" so
 * the game starts smoothly on weak hardware; players can raise it in settings.
 */
export function detectLowEndDevice(): boolean {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 8;
    const mem = nav.deviceMemory ?? 8;
    const ua = nav.userAgent || "";
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    // Mobile, ≤4 cores, or ≤4 GB reported memory → treat as low end.
    if (mobile) return true;
    if (cores <= 4 && mem <= 4) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Recursively fill any missing fields of a (possibly stale, loaded) graphics
 * object against the current defaults, so old saved settings never break on a
 * schema change.
 */
export function migrateGraphics(parsed: Partial<GraphicsSettings> | undefined): GraphicsSettings {
  const base = defaultGraphicsSettings();
  if (!parsed) return base;
  // Migrate the legacy boolean `clouds` (pre-graphics-settings) into the 3-state
  // clouds tier. Only accept a string for the new field — a stale save could
  // carry graphics: { clouds: true }, which must not leak through as a boolean.
  const legacy = parsed as Partial<GraphicsSettings> & { clouds?: boolean };
  let clouds: CloudsQuality | undefined =
    typeof parsed.clouds === "string" ? parsed.clouds : undefined;
  if (clouds === undefined && typeof legacy.clouds === "boolean") {
    clouds = legacy.clouds ? "fancy" : "off";
  }
  const preset = parsed.preset ?? base.preset;
  const oldPresetShadow =
    (preset === "medium" && parsed.shadows === "low") ||
    (preset === "high" && parsed.shadows === "medium");
  return {
    preset,
    renderScale: clamp(parsed.renderScale ?? base.renderScale, 0.5, 1),
    dprCap: clamp(parsed.dprCap ?? base.dprCap, 1.5, 2),
    antiAliasing: parsed.antiAliasing ?? base.antiAliasing,
    shadows: oldPresetShadow ? "off" : parsed.shadows ?? base.shadows,
    water: parsed.water ?? base.water,
    foliage: parsed.foliage ?? base.foliage,
    clouds: clouds ?? base.clouds,
    fog: parsed.fog ?? base.fog,
  };
}

/** Resolve a preset name to a full graphics config. */
export function graphicsFromPreset(preset: GraphicsPreset): GraphicsSettings {
  if (preset === "custom") {
    // "custom" is sticky; callers should not request it from here.
    return { ...GRAPHICS_PRESETS.medium, preset: "custom" };
  }
  return { ...GRAPHICS_PRESETS[preset] };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

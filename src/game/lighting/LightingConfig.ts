// Central tunables for the voxel lighting system. Keeping every magic number
// here makes day/night, brightness curves and shadow quality adjustable
// without touching propagation logic or the mesher.

import { MAX_LIGHT } from "../Blocks";

/** Maximum light level for both the sun and block-light channels. */
export const LIGHT_MAX = MAX_LIGHT;

/**
 * Per-face directional shading baked into vertex colours (separate from the
 * voxel light value). Top faces are brightest, bottoms darkest, sides in
 * between. Matches the Minetest/Minecraft "ambient occlusion by face normal"
 * convention and gives cube edges readable definition.
 *
 * Index order matches FACE in Blocks.ts: [PX, NX, PY, NY, PZ, NZ].
 */
export const FACE_SHADE = [0.8, 0.8, 1.0, 0.5, 0.86, 0.86] as const;

/** Brightness multiplier for plantlike (X-cross) decorations. */
export const PLANT_SHADE = 0.95;

/**
 * Map a raw light level (0..LIGHT_MAX) to a rendered brightness multiplier in
 * roughly [MIN_BRIGHTNESS, 1]. Uses a gamma curve so mid values stay legible
 * instead of collapsing to near-black (Minetest/Minecraft use the same idea —
 * a `light_curve`/gamma so a torch-lit cave isn't pitch dark at level 8).
 *
 * The floor (MIN_BRIGHTNESS) keeps fully-dark blocks barely visible rather than
 * pure black; the Babylon ambient light then lifts them a touch more.
 */
export const MIN_BRIGHTNESS = 0.04;
export const LIGHT_GAMMA = 1.3;

export function lightToBrightness(level: number): number {
  if (level <= 0) return MIN_BRIGHTNESS;
  const t = (level > LIGHT_MAX ? LIGHT_MAX : level) / LIGHT_MAX;
  return MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * Math.pow(t, LIGHT_GAMMA);
}

/**
 * Combine the sun (day) and block (emissive) channels into a single light
 * level for rendering. We take the max: a torch (block light) is as bright as
 * its own value regardless of sun, and full sun dominates. The day/night
 * factor is applied to the SUN channel only here so torches keep glowing at
 * night; the remaining global day/night dimming is applied via Babylon light
 * intensities (see DayNightCycle).
 */
export function combineLight(
  sun: number,
  block: number,
  sunFactor = 1,
): number {
  const s = sun * sunFactor;
  return s >= block ? s : block;
}

// --- Day / night ---

/** Length of a full day in real-world seconds (midday→midday). */
export const DAY_LENGTH_SECONDS = 600;
/** timeOfDay in [0,1): 0 = midnight, 0.25 = sunrise, 0.5 = midday, 0.75 = sunset. */
export const TIME_MIDDAY = 0.5;
export const TIME_MIDNIGHT = 0;

/**
 * Convert a time-of-day fraction to the brightness multiplier applied to the
 * SUN light channel. Roughly a smooth daylight curve: 1 at midday, ~0.04 at
 * midnight, with dawn/dusk ramps. Computed from the sun's elevation so it
 * matches the visual sun position.
 */
export function sunBrightnessAt(timeOfDay: number): number {
  // Sun elevation angle: highest at midday (cos = 1), lowest at midnight (cos = -1).
  const angle = (timeOfDay - TIME_MIDDAY) * Math.PI * 2;
  const elev = Math.cos(angle); // -1..1
  if (elev <= 0) return 0.04; // below horizon → night floor
  // Smooth ramp so twilight isn't a hard cut.
  const day = Math.pow(elev, 0.6);
  return 0.04 + (1 - 0.04) * day;
}

// --- Chunk lighting budgets ---

/** Max chunks relit per frame (lighting propagation pass). */
export const MAX_CHUNK_LIGHT_PER_FRAME = 3;
/** Max chunks relit by a single block edit before falling back to neighbour recompute. */
export const EDIT_RELIGHT_RADIUS = 1;

// --- Debug visualisation ---

/**
 * Light debug overlay modes. When non-"off", chunk meshes are rebuilt with a
 * brightness sampler that visualises a raw light channel (grayscale) instead
 * of the normal shaded result. Useful for spotting propagation bugs.
 */
export type LightDebugMode = "off" | "sun" | "block" | "combined";

// --- Shadows ---

export interface ShadowConfig {
  enabled: boolean;
  /** Shadow map size (texels). Higher = crisper, more GPU memory. */
  mapSize: number;
  /**
   * Half-extent (blocks) of the orthographic shadow frustum centred on the
   * player. `shadowFrustumSize` (the Babylon ortho width) = frustum * 2.
   * MUST be larger than `casterRadius` so the frustum edge sits in a no-caster
   * margin (otherwise caster shadows clip into a hard rectangle).
   */
  frustum: number;
  /** Only chunk meshes within this radius (blocks) of the player cast shadows.
   *  Keep < `frustum` − a couple of chunks. */
  casterRadius: number;
  /** Use blurred exponential shadow maps (soft) vs hard ESM. */
  blur: boolean;
  /** Bias to reduce shadow acne. */
  bias: number;
  /** How far shadows fade out before the frustum edge (0 = hard edge = the
   *  giant-rectangle artifact; ~0.5+ recommended). */
  frustumEdgeFalloff: number;
  /** Explicit shadow-camera depth bounds (fixed-frustum path). Tight values
   *  keep ESM depth precision sane. */
  shadowMinZ: number;
  shadowMaxZ: number;
}

export const DEFAULT_SHADOW_CONFIG: ShadowConfig = {
  enabled: true,
  mapSize: 2048,
  // Frustum half-extent 80 (ortho 160). Caster radius 48 → ~32-block (2-chunk)
  // fade margin so caster shadows never touch the frustum edge.
  frustum: 80,
  casterRadius: 48,
  blur: true,
  bias: 0.0008,
  frustumEdgeFalloff: 0.6,
  shadowMinZ: 1,
  shadowMaxZ: 300,
};

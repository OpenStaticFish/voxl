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
 * The spread is deliberately wide (top 1.0 → bottom 0.45, sides ~0.78/0.82) so
 * terrain reads with clear depth and overhangs/caves stay visibly darker,
 * instead of the uniformly-lit "flat" look a tighter spread produces.
 *
 * Index order matches FACE in Blocks.ts: [PX, NX, PY, NY, PZ, NZ].
 */
export const FACE_SHADE = [0.76, 0.76, 1.0, 0.45, 0.82, 0.82] as const;

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

/** Length of a full day in real-world seconds (midday→midday). ~10 min. */
export const DAY_LENGTH_SECONDS = 600;
/** timeOfDay in [0,1): 0 = midnight, 0.25 = sunrise, 0.5 = midday, 0.75 = sunset. */
export const TIME_MIDNIGHT = 0;
export const TIME_SUNRISE = 0.25;
export const TIME_MIDDAY = 0.5;
export const TIME_SUNSET = 0.75;

/**
 * Maximum moonlight contribution to the SUN channel at night (as a fraction of
 * full sun brightness). Outdoor areas get at least `sun·moonFloor` so they are
 * never pitch black; caves stay dark because their sun channel is ~0.
 */
export const MOON_FLOOR = 0.16;

/** GLSL-style smoothstep clamped to [0,1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Sun elevation (-1..1) for a time-of-day, where 1 = noon (overhead),
 * 0 = sunrise/sunset (horizon), -1 = midnight (nadir). Derived from the sun's
 * orbital angle so it matches the visual sun/moon positions exactly.
 */
export function sunElevationAt(timeOfDay: number): number {
  const angle = (timeOfDay - TIME_SUNRISE) * Math.PI * 2;
  return Math.sin(angle);
}

/**
 * Daylight factor for the SUN channel (0 at night → 1 midday) with a smooth
 * twilight band around sunrise/sunset. Used as a shader uniform so day/night
 * can dim outdoor terrain WITHOUT rebuilding any chunk meshes.
 */
export function dayFactorAt(timeOfDay: number): number {
  return smoothstep(-0.12, 0.18, sunElevationAt(timeOfDay));
}

/**
 * Moonlight factor for the SUN channel (peaks at midnight, 0 by day). Provides
 * a subtle outdoor floor at night.
 */
export function moonFactorAt(timeOfDay: number): number {
  return smoothstep(-0.12, 0.18, -sunElevationAt(timeOfDay));
}

/**
 * Convert a time-of-day fraction to the brightness multiplier applied to the
 * SUN light channel. Roughly a smooth daylight curve: 1 at midday, ~0.04 at
 * midnight, with dawn/dusk ramps. Computed from the sun's elevation so it
 * matches the visual sun position.
 */
export function sunBrightnessAt(timeOfDay: number): number {
  const elev = sunElevationAt(timeOfDay);
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
  // Disabled by default: the terrain renders through the custom two-channel
  // VoxelTerrainMaterial which does its own (voxel-sunlight) shadowing. The
  // ShadowManager is retained for opt-in Babylon shadow maps (e.g. a future
  // player mesh) but is off to keep day/night simple and free of the prior
  // shadow-frustum rectangle artifact.
  enabled: false,
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

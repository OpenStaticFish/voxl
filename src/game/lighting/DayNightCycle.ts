import { Color3, Color4, DirectionalLight, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import {
  DAY_LENGTH_SECONDS,
  MOON_FLOOR,
  TIME_MIDDAY,
  TIME_MIDNIGHT,
  TIME_SUNRISE,
  TIME_SUNSET,
  dayFactorAt,
  moonFactorAt,
  smoothstep,
  sunElevationAt,
} from "./LightingConfig";

// Sky colour stops (zenith / horizon). Tweaked for a warm golden hour and a
// deep, slightly-purple night — modelled on Luanti/Minecraft day/night palettes.
const SKY = {
  nightZenith: Color3.FromHexString("#070b1e"),
  nightHorizon: Color3.FromHexString("#121a3a"),
  dayZenith: Color3.FromHexString("#2f6fdb"),
  dayHorizon: Color3.FromHexString("#bfe3ff"),
  duskZenith: Color3.FromHexString("#3a2a5a"),
  duskHorizon: Color3.FromHexString("#ff8a4a"),
};
const SUN_COLOR_HIGH = Color3.FromHexString("#fff4e0"); // midday warm-white
const SUN_COLOR_LOW = Color3.FromHexString("#ff7a33"); // sunrise/sunset orange
const MOON_COLOR = Color3.FromHexString("#cfe0ff"); // pale cool moonlight

/**
 * The game's clock and the single source of truth for everything time-derived.
 *
 *   timeOfDay ∈ [0,1):  0.00 midnight · 0.25 sunrise · 0.50 noon · 0.75 sunset
 *
 * The sun orbits the world in the X–Y plane (rises in +X/east, sets in −X/west)
 * with a slight −Z tilt so shadows/visuals aren't axis-aligned. The moon is the
 * sun's exact antipode — it rises at sunset and rides opposite the sun.
 *
 * Each {@link update} advances the clock and recomputes (and publishes) the
 * derived state: sun/moon directions, day/moon factors, multi-stop sky colours
 * and the Babylon light intensities (used by the water pass + entities). The
 * voxel terrain reads `dayFactor`/`moonFactor` as shader uniforms, so the clock
 * never forces a chunk remesh.
 */
export class DayNightCycle {
  /** Current time of day in [0,1). */
  timeOfDay = TIME_MIDDAY;
  /** Real-time seconds for one full day (midday→midday). */
  dayLengthSeconds = DAY_LENGTH_SECONDS;
  /** Multiplier on the clock speed (1 = real-time day length, 10 = fast debug). */
  timeScale = 1;
  /** When true, time does not advance (debugging). */
  paused = false;

  // ---- Derived state (recomputed every update; read by consumers) ----
  /** Sun elevation, -1 (nadir) .. 1 (zenith). */
  sunElevation = 1;
  /** Direction light travels from the sun toward the scene (unit). */
  sunDirection = new Vector3(0, -1, 0);
  /** Direction light travels from the moon toward the scene (unit). */
  moonDirection = new Vector3(0, 1, 0);
  /** Unit direction from the camera toward the sun disc (for placement). */
  sunSkyDirection = new Vector3(0, 1, 0);
  /** Unit direction from the camera toward the moon disc (for placement). */
  moonSkyDirection = new Vector3(0, -1, 0);
  /** 0 (night) .. 1 (full day) — multiplies the terrain SUN channel. */
  dayFactor = 1;
  /** Moonlight contribution to the terrain sun channel at night. */
  moonFactor = 0;
  /** 0 (sun well below horizon) .. 1 (sun at horizon) — golden-hour warmth. */
  goldenHour = 0;
  /** Current sun colour (warm at horizon, white at noon). */
  sunColor = SUN_COLOR_HIGH.clone();
  /** Current moon colour. */
  moonColor = MOON_COLOR.clone();
  /** Current sky zenith colour. */
  skyZenith = SKY.dayZenith.clone();
  /** Current sky horizon colour. */
  skyHorizon = SKY.dayHorizon.clone();

  // Tunable Babylon-light intensities (drive the non-terrain StandardMaterial
  // passes, e.g. water; terrain uses the custom shader instead).
  sunIntensityDay = 0.55;
  ambientIntensityDay = 0.35;
  hemiIntensityDay = 0.25;
  ambientIntensityNight = 0.1;

  private readonly sun: DirectionalLight;
  private readonly ambient: HemisphericLight;
  private readonly hemi: HemisphericLight;
  private readonly scene: Scene;
  // Scratch instances mutated every frame (avoids per-frame Color3/Color4
  // allocations in the hot path).
  private readonly _c1 = new Color3();
  private readonly _c2 = new Color3();
  private readonly _cFog = new Color3();
  private readonly _clearColor = new Color4(0, 0, 0, 1);

  constructor(
    sun: DirectionalLight,
    ambient: HemisphericLight,
    hemi: HemisphericLight,
    scene: Scene,
  ) {
    this.sun = sun;
    this.ambient = ambient;
    this.hemi = hemi;
    this.scene = scene;
    this.apply();
  }

  // ---- clock ----

  /** Advance the clock and refresh all derived state. */
  update(dt: number): void {
    if (!this.paused && this.timeScale !== 0) {
      this.timeOfDay =
        (this.timeOfDay + (dt * this.timeScale) / this.dayLengthSeconds) % 1;
      if (this.timeOfDay < 0) this.timeOfDay += 1;
    }
    this.apply();
  }

  setTimeOfDay(t: number): void {
    this.timeOfDay = t - Math.floor(t);
    this.apply();
  }

  setSunrise(): void { this.setTimeOfDay(TIME_SUNRISE); }
  setNoon(): void { this.setTimeOfDay(TIME_MIDDAY); }
  setSunset(): void { this.setTimeOfDay(TIME_SUNSET); }
  setMidnight(): void { this.setTimeOfDay(TIME_MIDNIGHT); }
  /** Alias: "day" = bright noon. */
  setDay(): void { this.setNoon(); }

  pauseTime(): void { this.paused = true; }
  resumeTime(): void { this.paused = false; }
  setPaused(p: boolean): void { this.paused = p; }
  togglePaused(): boolean { this.paused = !this.paused; return this.paused; }

  /** Current Babylon sun-light intensity (debug overlay). */
  get sunIntensity(): number { return this.sun.intensity; }
  /** Current Babylon ambient-light intensity (debug overlay). */
  get ambientIntensity(): number { return this.ambient.intensity; }

  /** Multiply the clock speed (clamped to keep it sane). */
  scaleTime(factor: number): void {
    this.timeScale = Math.max(0, Math.min(64, this.timeScale * factor));
  }

  /** Advance/rewind by a number of preset steps (used by [ / ] debug keys). */
  stepTime(steps: number): void {
    this.setTimeOfDay(this.timeOfDay + steps * 0.02);
  }

  // ---- derived state ----

  private apply(): void {
    const t = this.timeOfDay;
    this.sunElevation = sunElevationAt(t);
    this.dayFactor = dayFactorAt(t);
    this.moonFactor = moonFactorAt(t) * MOON_FLOOR;

    // --- Sun & moon orbital directions ---
    // sunAngle: 0 at sunrise, π/2 noon, π sunset, 3π/2 midnight.
    const sunAngle = (t - TIME_SUNRISE) * Math.PI * 2;
    const cosA = Math.cos(sunAngle);
    const sinA = Math.sin(sunAngle);
    // Light travels from sun toward scene. Sun sits in +X at sunrise. Mutate the
    // stable direction vectors in place (no per-frame allocation).
    const dir = this.sunDirection.set(-cosA, -sinA, -0.35);
    dir.normalize();
    dir.scaleToRef(-1, this.moonDirection); // moon is the antipode
    dir.scaleToRef(-1, this.sunSkyDirection); // where the disc appears in the sky
    this.moonSkyDirection.copyFrom(dir); // moon disc opposite the sun disc

    // --- Golden-hour warmth: peaks when the sun is near the horizon. ---
    this.goldenHour = 1 - Math.min(1, Math.abs(this.sunElevation) / 0.3);

    // --- Sky colours: day↔night base, then bleed dusk warmth at the horizon. ---
    const d = this.dayFactor;
    const g = this.goldenHour;
    Color3.LerpToRef(SKY.nightZenith, SKY.dayZenith, d, this._c1);
    Color3.LerpToRef(SKY.nightHorizon, SKY.dayHorizon, d, this._c2);
    Color3.LerpToRef(this._c1, SKY.duskZenith, g * 0.4, this.skyZenith);
    Color3.LerpToRef(this._c2, SKY.duskHorizon, g * 0.75, this.skyHorizon);

    // --- Sun/moon colours ---
    Color3.LerpToRef(SUN_COLOR_HIGH, SUN_COLOR_LOW, g, this.sunColor);

    // --- Push into Babylon lights (used by the water pass + entities) ---
    this.sun.direction.copyFrom(this.sunDirection);
    this.sun.intensity = this.sunIntensityDay * d;
    this.sun.diffuse.copyFrom(this.sunColor);

    // Ambient: small night floor + a touch of moonlight; never bright enough to
    // light caves (caves have no sun channel and the custom shader ignores this).
    this.ambient.intensity =
      this.ambientIntensityNight +
      (this.ambientIntensityDay - this.ambientIntensityNight) * d +
      this.moonFactor * 0.4;

    this.hemi.intensity = 0.04 + this.hemiIntensityDay * d;
    Color3.LerpToRef(SKY.nightHorizon, SKY.dayHorizon, d, this._c1);
    this.hemi.diffuse.copyFrom(this._c1);

    // --- Sky clear + fog colour track the horizon (mutate stable instances) ---
    this._clearColor.r = this.skyHorizon.r;
    this._clearColor.g = this.skyHorizon.g;
    this._clearColor.b = this.skyHorizon.b;
    this._clearColor.a = 1;
    this.scene.clearColor = this._clearColor;
    this.scene.fogColor = this._cFog.copyFrom(this.skyHorizon);
  }

  /** Sun disc opacity (0 when below the horizon, fades in as it rises). */
  get sunVisibility(): number {
    return smoothstep(-0.06, 0.06, this.sunElevation);
  }

  /** Moon disc opacity (0 when below the horizon). */
  get moonVisibility(): number {
    return smoothstep(-0.06, 0.06, -this.sunElevation);
  }
}

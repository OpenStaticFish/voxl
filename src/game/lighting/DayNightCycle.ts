import { Color3, Color4, DirectionalLight, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import { DAY_LENGTH_SECONDS, TIME_MIDDAY, sunBrightnessAt } from "./LightingConfig";

const SKY_DAY = Color3.FromHexString("#bfe3ff");
const SKY_NIGHT = Color3.FromHexString("#0b1026");
const SUN_DAY = Color3.FromHexString("#fff4e0");
const SUN_DUSK = Color3.FromHexString("#ff9a4a");
const HEMI_DAY = Color3.FromHexString("#bfe3ff");
const HEMI_GROUND = Color3.FromHexString("#4a6b3a");

/**
 * Drives the global Babylon lights (sun + ambient + hemisphere) and the sky /
 * fog colours from a `timeOfDay` value. This is the *global* day/night layer;
 * voxel (cave/overhang) darkness comes from the baked vertex colours and is
 * independent of this.
 *
 *   timeOfDay ∈ [0,1): 0.0 midnight · 0.25 sunrise · 0.5 midday · 0.75 sunset
 *
 * The sun direction is derived from the time so shadows point the right way.
 * Time can be paused/frozen for debugging and snapped to day/night.
 */
export class DayNightCycle {
  /** Current time of day in [0,1). */
  timeOfDay = TIME_MIDDAY;
  /** When true, time does not advance (debugging). */
  paused = false;
  /** Multiplier on real-time day length (1 = DAY_LENGTH_SECONDS per full day). */
  timeScale = 1;

  private readonly sun: DirectionalLight;
  private readonly ambient: HemisphericLight;
  private readonly hemi: HemisphericLight;
  private readonly scene: Scene;
  /** Cached initial sky/fog colour to restore on dispose. */
  private readonly baseFog: Color3;

  /** Tunable intensities (midday values); night floors are derived from these.
   *  Kept just above ~1.0 combined so baked vertex colours (the dominant
   *  brightness control) aren't washed out at midday. */
  sunIntensityDay = 0.5;
  ambientIntensityDay = 0.35;
  hemiIntensityDay = 0.25;
  ambientIntensityNight = 0.1;

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
    this.baseFog = (scene.fogColor ?? SKY_DAY).clone();
    this.apply();
  }

  /** Advance time and refresh light/sky state. */
  update(dt: number): void {
    if (!this.paused) {
      this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / DAY_LENGTH_SECONDS) % 1;
      if (this.timeOfDay < 0) this.timeOfDay += 1;
    }
    this.apply();
  }

  /** 0 (full night) .. 1 (full day) brightness factor for the sun channel. */
  get dayFactor(): number {
    return sunBrightnessAt(this.timeOfDay);
  }

  setTime(t: number): void {
    this.timeOfDay = t - Math.floor(t);
    this.apply();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setTimeMidday(): void {
    this.setTime(TIME_MIDDAY);
  }

  setTimeMidnight(): void {
    this.setTime(0);
  }

  /** Derived sun direction (pointing from the sun toward the scene). */
  get sunDirection(): Vector3 {
    // Midday → steep from above; midnight → low/below horizon. A fixed azimuth
    // keeps shadow directions stable and readable.
    const a = (this.timeOfDay - TIME_MIDDAY) * Math.PI * 2;
    const elev = Math.cos(a); // 1 at midday, -1 at midnight
    const dir = new Vector3(-0.5, -Math.max(elev, -0.12), -0.42);
    return dir.normalize();
  }

  /** Push the current time into the Babylon lights + sky/fog colours. */
  private apply(): void {
    const d = this.dayFactor; // 0..1

    // Sun: intensity ramps with the day factor; warm/reddish near the horizon.
    this.sun.direction = this.sunDirection;
    this.sun.intensity = this.sunIntensityDay * d;
    const horizonness = 1 - Math.min(1, d * 3); // 1 near horizon, 0 midday
    this.sun.diffuse = Color3.Lerp(SUN_DAY, SUN_DUSK, horizonness);

    // Ambient fill: a small night floor so unlit areas aren't pure black.
    this.ambient.intensity = this.ambientIntensityNight + (this.ambientIntensityDay - this.ambientIntensityNight) * d;
    this.ambient.diffuse = Color3.White();
    this.ambient.groundColor = Color3.White();

    // Hemisphere sky/ground bounce: fades toward a dim night value.
    this.hemi.intensity = 0.04 + this.hemiIntensityDay * d;
    this.hemi.diffuse = Color3.Lerp(SKY_NIGHT, HEMI_DAY, d);
    this.hemi.groundColor = HEMI_GROUND;

    // Sky clear + fog colour: blue by day, deep navy at night.
    const sky = Color3.Lerp(SKY_NIGHT, SKY_DAY, d);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = sky.clone();
    void this.baseFog;
  }
}

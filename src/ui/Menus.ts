import type { Settings } from "../types";
import type {
  CloudsQuality,
  FoliageDensity,
  GraphicsPreset,
  ShadowQuality,
  WaterQuality,
} from "../game/graphics/GraphicsSettings";
import { ScreenManager } from "./ScreenManager";

function $(id: string): HTMLInputElement | HTMLSelectElement | HTMLElement {
  return document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLElement;
}

/**
 * Wires up all menu/overlay buttons and the settings controls. UI structure
 * lives in index.html; this class only attaches behaviour and forwards intents
 * to the Game via callbacks.
 */
export class Menus {
  onPlay?: () => void;
  onResume?: () => void;
  onQuit?: () => void;
  onSettingsChange?: (patch: Partial<Settings>) => void;
  /** Apply a built-in graphics preset (low/medium/high). */
  onGraphicsPreset?: (preset: GraphicsPreset) => void;
  onRegenerate?: (seed: string) => void;

  private current: Settings;
  private readonly screens: ScreenManager;

  constructor(screens: ScreenManager, initial: Settings) {
    this.screens = screens;
    this.current = { ...initial, graphics: { ...initial.graphics } };
    this.bind();
    this.syncInputs();
  }

  updateCurrent(settings: Settings): void {
    this.current = { ...settings, graphics: { ...settings.graphics } };
    this.syncInputs();
  }

  private openSettings(): void {
    this.syncInputs();
    this.screens.pushOverlay("settings-screen");
  }

  private openControls(): void {
    this.screens.pushOverlay("controls-screen");
  }

  private back(): void {
    this.screens.popOverlay();
  }

  private bind(): void {
    $("btn-play").addEventListener("click", () => this.onPlay?.());
    $("btn-settings").addEventListener("click", () => this.openSettings());
    $("btn-controls").addEventListener("click", () => this.openControls());

    $("btn-resume").addEventListener("click", () => this.onResume?.());
    $("btn-pause-settings").addEventListener("click", () => this.openSettings());
    $("btn-quit").addEventListener("click", () => this.onQuit?.());

    document.querySelectorAll("[data-back]").forEach((el) => {
      el.addEventListener("click", () => this.back());
    });

    // --- General settings ---
    const vd = $("set-viewdistance") as HTMLInputElement;
    const vdOut = $("out-viewdistance");
    vd.addEventListener("input", () => {
      vdOut.textContent = vd.value;
      this.emit({ viewDistance: Number(vd.value) });
    });

    const sens = $("set-sensitivity") as HTMLInputElement;
    const sensOut = $("out-sensitivity");
    sens.addEventListener("input", () => {
      sensOut.textContent = Number(sens.value).toFixed(1);
      this.emit({ mouseSensitivity: Number(sens.value) });
    });

    const fov = $("set-fov") as HTMLInputElement;
    const fovOut = $("out-fov");
    fov.addEventListener("input", () => {
      fovOut.textContent = fov.value;
      this.emit({ fov: Number(fov.value) });
    });

    const fps = $("set-fps") as HTMLInputElement;
    fps.addEventListener("change", () => this.emit({ showFps: fps.checked }));

    // --- Graphics presets ---
    document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.preset as GraphicsPreset;
        this.onGraphicsPreset?.(preset);
      });
    });

    // --- Graphics individual controls ---
    const rs = $("set-renderscale") as HTMLSelectElement;
    rs.addEventListener("change", () => this.patchGraphics({ renderScale: Number(rs.value) }));

    const shadows = $("set-shadows") as HTMLSelectElement;
    shadows.addEventListener("change", () => this.patchGraphics({ shadows: shadows.value as ShadowQuality }));

    const water = $("set-water") as HTMLSelectElement;
    water.addEventListener("change", () => this.patchGraphics({ water: water.value as WaterQuality }));

    const foliage = $("set-foliage") as HTMLSelectElement;
    foliage.addEventListener("change", () => this.patchGraphics({ foliage: foliage.value as FoliageDensity }));

    const clouds = $("set-clouds2") as HTMLSelectElement;
    clouds.addEventListener("change", () => this.patchGraphics({ clouds: clouds.value as CloudsQuality }));

    const aa = $("set-aa") as HTMLInputElement;
    aa.addEventListener("change", () => this.patchGraphics({ antiAliasing: aa.checked }));

    // --- Seed / regenerate ---
    const seed = $("set-seed") as HTMLInputElement;
    $("btn-regen").addEventListener("click", () => {
      const value = seed.value.trim() || "voxl";
      this.onRegenerate?.(value);
    });
  }

  /**
   * Apply a single graphics field change. Any individual tweak switches the
   * preset to "custom" (so the preset buttons no longer highlight a built-in).
   */
  private patchGraphics(
    partial: Partial<Settings["graphics"]>,
  ): void {
    const graphics = { ...this.current.graphics, ...partial, preset: "custom" as const };
    this.emit({ graphics });
  }

  private emit(patch: Partial<Settings>): void {
    this.current = {
      ...this.current,
      ...patch,
      graphics: patch.graphics ? { ...patch.graphics } : this.current.graphics,
    };
    this.onSettingsChange?.(patch);
  }

  private syncInputs(): void {
    const s = this.current;
    const vd = $("set-viewdistance") as HTMLInputElement;
    vd.value = String(s.viewDistance);
    ($("out-viewdistance")).textContent = String(s.viewDistance);
    const sens = $("set-sensitivity") as HTMLInputElement;
    sens.value = String(s.mouseSensitivity);
    ($("out-sensitivity")).textContent = s.mouseSensitivity.toFixed(1);
    const fov = $("set-fov") as HTMLInputElement;
    fov.value = String(s.fov);
    ($("out-fov")).textContent = String(s.fov);
    ($("set-fps") as HTMLInputElement).checked = s.showFps;
    ($("set-seed") as HTMLInputElement).value = s.seed;

    // Graphics
    const g = s.graphics;
    ($("set-renderscale") as HTMLSelectElement).value = String(g.renderScale);
    ($("set-shadows") as HTMLSelectElement).value = g.shadows;
    ($("set-water") as HTMLSelectElement).value = g.water;
    ($("set-foliage") as HTMLSelectElement).value = g.foliage;
    ($("set-clouds2") as HTMLSelectElement).value = g.clouds;
    ($("set-aa") as HTMLInputElement).checked = g.antiAliasing;

    // Highlight the active preset button (or none for "custom").
    document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
      const active = btn.dataset.preset === g.preset;
      btn.classList.toggle("btn-preset-active", active);
    });
  }
}

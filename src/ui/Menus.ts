import type { Settings } from "../types";
import { ScreenManager } from "./ScreenManager";

function $(id: string): HTMLInputElement | HTMLElement {
  return document.getElementById(id) as HTMLInputElement | HTMLElement;
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
  onRegenerate?: (seed: string) => void;

  private current: Settings;
  private readonly screens: ScreenManager;

  constructor(screens: ScreenManager, initial: Settings) {
    this.screens = screens;
    this.current = { ...initial };
    this.bind();
    this.syncInputs();
  }

  updateCurrent(settings: Settings): void {
    this.current = { ...settings };
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

    // --- Settings controls ---
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

    const clouds = $("set-clouds") as HTMLInputElement;
    clouds.addEventListener("change", () => this.emit({ clouds: clouds.checked }));

    const seed = $("set-seed") as HTMLInputElement;
    $("btn-regen").addEventListener("click", () => {
      const value = seed.value.trim() || "voxl";
      this.onRegenerate?.(value);
    });
  }

  private emit(patch: Partial<Settings>): void {
    this.current = { ...this.current, ...patch };
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
    ($("set-clouds") as HTMLInputElement).checked = s.clouds;
    ($("set-seed") as HTMLInputElement).value = s.seed;
  }
}

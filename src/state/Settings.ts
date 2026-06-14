import type { Settings } from "../types";
import { DEFAULT_SEED } from "../constants";
import {
  defaultGraphicsSettings,
  defaultRenderDistance,
  migrateGraphics,
  type GraphicsSettings,
} from "../game/graphics/GraphicsSettings";

const STORAGE_KEY = "voxl.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  viewDistance: defaultRenderDistance(),
  mouseSensitivity: 1,
  fov: 75,
  showFps: false,
  seed: DEFAULT_SEED,
  mode: "creative",
  graphics: defaultGraphicsSettings(),
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    // `clouds` was a boolean before graphics settings existed; pull it out of the
    // parsed blob so it never lands on the Settings object, then fold it into the
    // new 3-state clouds tier during graphics migration.
    const { clouds: legacyClouds, graphics: savedGraphics, ...rest } =
      JSON.parse(raw) as Partial<Settings> & { clouds?: boolean };
    const mode =
      rest.mode === "survival" || rest.mode === "creative"
        ? rest.mode
        : DEFAULT_SETTINGS.mode;
    const graphics = migrateGraphics(savedGraphics);
    if (legacyClouds !== undefined && savedGraphics?.clouds === undefined) {
      graphics.clouds = legacyClouds ? "fancy" : "off";
    }
    return { ...DEFAULT_SETTINGS, ...rest, mode, graphics };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

export type { GraphicsSettings };

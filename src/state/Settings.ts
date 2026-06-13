import type { Settings } from "../types";
import { DEFAULT_SEED } from "../constants";

const STORAGE_KEY = "voxl.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  viewDistance: 6,
  mouseSensitivity: 1,
  fov: 75,
  showFps: false,
  clouds: true,
  seed: DEFAULT_SEED,
  mode: "creative",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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

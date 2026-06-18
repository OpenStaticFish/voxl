import type { SerializedSlot } from "../game/Inventory";
import type { SerializedStats } from "../game/PlayerState";
import type { GameMode } from "../game/Items";

/**
 * Per-seed survival save (inventory + vitals). Stored under a versioned
 * localStorage key so a fresh world or a re-seed starts clean.
 */

// Bumped to v2: creative-mode inventory is no longer persisted (palette pulls
// are ephemeral), so older v1 saves — which could contain a full creative
// backpack — are intentionally ignored. Survival progress from v1 is reset too;
// re-playing in survival rebuilds a clean save under the new semantics.
const VERSION = "v2";

export interface SaveData {
  inventory: SerializedSlot[];
  /** Optional crafting-grid state (returned-to-backpack on close, but
   *  persisted so a full backpack doesn't strand items mid-session). */
  crafting?: SerializedSlot[];
  stats: SerializedStats;
  /** Optional — omitted/invalid values are ignored on load. */
  mode?: GameMode;
}

function key(seed: string): string {
  return `voxl.save.${VERSION}.${seed}`;
}

export function loadSave(seed: string): SaveData | null {
  try {
    const raw = localStorage.getItem(key(seed));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData;
    if (!parsed || !Array.isArray(parsed.inventory) || !parsed.stats) return null;
    // Validate mode; an invalid/corrupt value is dropped so the caller falls
    // back to the current global setting.
    if (parsed.mode !== "survival" && parsed.mode !== "creative") {
      parsed.mode = undefined;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSave(seed: string, data: SaveData): void {
  try {
    localStorage.setItem(key(seed), JSON.stringify(data));
  } catch {
    // Storage full / disabled — survival persistence is best-effort.
  }
}

export function clearSave(seed: string): void {
  try {
    localStorage.removeItem(key(seed));
  } catch {
    // ignore
  }
}

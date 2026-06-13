import { getBlock, resolveLight } from "../Blocks";

/** Information the overlay shows each (throttled) update. */
export interface LightDebugInfo {
  enabled: boolean;
  timeOfDay: number;
  dayFactor: number;
  sunIntensity: number;
  ambientIntensity: number;
  debugMode: string;
  shadowsEnabled: boolean;
  paused: boolean;
  // Targeted block (may be null when nothing is aimed at).
  target: {
    x: number;
    y: number;
    z: number;
    id: number;
    name: string;
    sun: number;
    block: number;
    combined: number;
    lightPassesThrough: boolean;
    sunlightPassesThrough: boolean;
    emission: number;
  } | null;
  dirtyCount: number;
  litCount: number;
  loadedCount: number;
}

/**
 * A collapsible DOM panel that surfaces the lighting system's live state for
 * debugging: time of day, light intensities, the targeted block's sun/block
 * light levels and opacity flags, and how many chunks still need (re)lighting.
 *
 * Toggled with a hotkey; cheap to update (throttled by the caller). This exists
 * because lighting bugs are otherwise invisible — you can't tell a wrong
 * skylight value from a texture/colour problem by eye.
 */
export class LightingDebugOverlay {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  visible = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "voxl-light-debug";
    this.root.style.cssText = [
      "position:fixed",
      "top:8px",
      "left:8px",
      "z-index:50",
      "max-width:320px",
      "padding:8px 10px",
      "font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
      "color:#dff",
      "background:rgba(8,14,28,0.78)",
      "border:1px solid rgba(120,180,255,0.35)",
      "border-radius:6px",
      "pointer-events:none",
      "white-space:pre",
      "display:none",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "LIGHTING (L to toggle)";
    title.style.cssText = "font-weight:700;color:#9cf;margin-bottom:4px;";
    this.root.appendChild(title);

    this.body = document.createElement("div");
    this.root.appendChild(this.body);

    document.body.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? "block" : "none";
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  update(info: LightDebugInfo): void {
    if (!this.visible) return;
    const t = info.target;
    const fmt = (n: number) => (n >= 0 ? n.toFixed(2) : "—");
    const lines: string[] = [
      `time:   ${formatTime(info.timeOfDay)}${info.paused ? " (frozen)" : ""}  day=${fmt(info.dayFactor)}`,
      `sun:    ${fmt(info.sunIntensity)}   ambient: ${fmt(info.ambientIntensity)}`,
      `shadows:${info.shadowsEnabled ? " on" : " off"}   mode: ${info.debugMode}`,
      `chunks: lit=${info.litCount}/${info.loadedCount}  relightQueue=${info.dirtyCount}`,
    ];
    if (t) {
      lines.push(
        `target: ${t.name} (${t.x},${t.y},${t.z})`,
        `  sun=${t.sun}/15  block=${t.block}/15  combined=${t.combined}/15`,
        `  pass=${t.lightPassesThrough} sunPass=${t.sunlightPassesThrough} emit=${t.emission}`,
      );
    } else {
      lines.push("target: (none)");
    }
    this.body.textContent = lines.join("\n");
  }

  dispose(): void {
    this.root.remove();
  }
}

function formatTime(t: number): string {
  // Map [0,1) to a 24h HH:MM clock where 0 = midnight, 0.5 = noon.
  const totalMin = Math.floor(t * 24 * 60);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Build debug info for a targeted block (id at given coords). */
export function buildTargetInfo(
  id: number,
  x: number,
  y: number,
  z: number,
  sun: number,
  block: number,
  combined: number,
): LightDebugInfo["target"] {
  const def = getBlock(id);
  const light = resolveLight(def);
  return {
    x,
    y,
    z,
    id,
    name: def.name,
    sun,
    block,
    combined,
    lightPassesThrough: light.lightPassesThrough,
    sunlightPassesThrough: light.sunlightPassesThrough,
    emission: light.lightEmission,
  };
}

import type { TerrainGenerator } from "../game/TerrainGenerator";
import { BIOME_DEFS, type BiomeId } from "../game/gen/Biomes";
import type { WorldgenStatsSnapshot } from "../game/gen/WorldgenStats";

// World-generation debug overlay: a compact read-out of the climate/biome at the
// targeted column plus a live top-down minimap. The minimap re-renders by
// sampling the generator's deterministic height/climate functions over a grid
// around the player, so it works anywhere — even where chunks haven't streamed.
//
// Toggle with the worldgen-debug key (wired in Game). Map mode cycles with the
// same key while open. Off by default (it does real work each refresh).

export type WorldgenMapMode = "biome" | "heat" | "humidity" | "height" | "slope" | "shore" | "snow";

const MODES: WorldgenMapMode[] = ["biome", "heat", "humidity", "height", "slope", "shore", "snow"];
const MAP_PX = 112; // canvas size
const STEP = 2; // world blocks per pixel
const RERENDER_MOVE = 8; // re-render only after moving this many blocks

export interface WorldgenSnapshot {
  generator: TerrainGenerator | null;
  stats: WorldgenStatsSnapshot | null;
  playerX: number;
  playerZ: number;
  /** Targeted column (falls back to the player column). */
  targetWX: number;
  targetWZ: number;
  seaLevel: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function heatColor(v: number): [number, number, number] {
  // 0 cold-blue → 0.5 green → 1 hot-red
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  if (t < 0.5) {
    const k = t / 0.5;
    return [Math.round(40 + k * 80), Math.round(120 + k * 110), Math.round(220 - k * 140)];
  }
  const k = (t - 0.5) / 0.5;
  return [Math.round(220 - k * 40), Math.round(150 - k * 90), Math.round(60 + k * 20)];
}

function slopeColor(v: number): [number, number, number] {
  const t = v < 0 ? 0 : v > 6 ? 1 : v / 6;
  return [Math.round(70 + t * 180), Math.round(180 - t * 140), Math.round(90 - t * 60)];
}

export class WorldgenOverlay {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly modeEl: HTMLElement;
  private readonly targetEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private visible = false;
  private mode: WorldgenMapMode = "biome";
  private lastRenderX = Number.NaN;
  private lastRenderZ = Number.NaN;
  private lastRenderMode: WorldgenMapMode | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "worldgen-overlay";
    this.root.hidden = true;

    const header = document.createElement("div");
    header.className = "worldgen-header";
    const title = document.createElement("span");
    title.textContent = "worldgen";
    this.modeEl = document.createElement("span");
    this.modeEl.className = "worldgen-mode";
    this.hintEl = document.createElement("span");
    this.hintEl.className = "perf-hint";
    this.hintEl.textContent = "G: mode";
    header.appendChild(title);
    header.appendChild(this.modeEl);
    header.appendChild(this.hintEl);
    this.root.appendChild(header);

    this.canvas = document.createElement("canvas");
    this.canvas.width = MAP_PX;
    this.canvas.height = MAP_PX;
    this.canvas.className = "worldgen-map";
    this.root.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable for worldgen overlay");
    this.ctx = ctx;

    this.targetEl = document.createElement("div");
    this.targetEl.className = "worldgen-line";
    this.statsEl = document.createElement("div");
    this.statsEl.className = "worldgen-line";
    this.root.appendChild(this.targetEl);
    this.root.appendChild(this.statsEl);

    document.getElementById("hud")?.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.hidden = !v;
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  /** Cycle the minimap colour mode (called on the toggle key while open). */
  cycleMode(): void {
    const i = MODES.indexOf(this.mode);
    this.mode = MODES[(i + 1) % MODES.length];
    this.lastRenderMode = null; // force a re-render
  }

  /** Set a specific map mode (console API). */
  setMode(mode: WorldgenMapMode): void {
    if (MODES.indexOf(mode) >= 0) {
      this.mode = mode;
      this.lastRenderMode = null;
    }
  }

  get isOpen(): boolean {
    return this.visible;
  }

  update(s: WorldgenSnapshot): void {
    if (!this.visible) return;
    const gen = s.generator;
    this.modeEl.textContent = this.mode;

    if (gen) {
      const d = gen.debugAt(s.targetWX, s.targetWZ);
      this.targetEl.textContent =
        `${d.biome} · ${d.surfaceBlock} · snow ${d.snow.toFixed(2)}` +
        (d.blendEdge > 0.3 ? ` · blend→${d.blendBiome}` : "") +
        (d.coastal ? " · BEACH" : "") + (d.rocky ? " · ROCK" : "") +
        ` · beachStr ${d.beachStrength.toFixed(2)}${d.hasBeach ? "" : "(no)"}` +
        ` · water ${d.waterExtent.toFixed(2)}` +
        ` · shore ${d.shoreDist > 6 ? "—" : d.shoreDist}` +
        ` · h ${d.height - s.seaLevel >= 0 ? "+" : ""}${d.height - s.seaLevel} · slope ${d.slope.toFixed(1)}`;

      // Re-render the minimap only when the player has moved enough or mode
      // changed (keeps it cheap).
      const moved =
        Math.abs(s.playerX - this.lastRenderX) > RERENDER_MOVE ||
        Math.abs(s.playerZ - this.lastRenderZ) > RERENDER_MOVE;
      if (moved || this.lastRenderMode !== this.mode) {
        this.renderMap(gen, s.playerX, s.playerZ, s.seaLevel);
        this.lastRenderX = s.playerX;
        this.lastRenderZ = s.playerZ;
        this.lastRenderMode = this.mode;
      }
    } else {
      this.targetEl.textContent = "no world";
    }

    if (s.stats) {
      const st = s.stats;
      this.statsEl.textContent =
        `gen ${st.avgMs.toFixed(1)}ms avg · ${st.lastMs.toFixed(1)} last · ${st.chunks} chunks` +
        ` · ${st.avgTrees.toFixed(1)} trees · ${st.avgDecorations.toFixed(0)} deco · ${st.avgCaves.toFixed(0)} caves · ${st.avgOres.toFixed(0)} ores`;
    }
  }

  private renderMap(gen: TerrainGenerator, cx: number, cz: number, sea: number): void {
    const ctx = this.ctx;
    const half = (MAP_PX * STEP) / 2;
    const img = ctx.createImageData(MAP_PX, MAP_PX);
    const data = img.data;
    for (let py = 0; py < MAP_PX; py++) {
      for (let px = 0; px < MAP_PX; px++) {
        const wx = Math.floor(cx - half + px * STEP);
        const wz = Math.floor(cz - half + py * STEP);
        const d = gen.debugAt(wx, wz);
        let rgb: [number, number, number];
        switch (this.mode) {
          case "biome":
            rgb = hexToRgb(BIOME_DEFS[d.biome as BiomeId].color);
            break;
          case "heat":
            rgb = heatColor(d.effHeat);
            break;
          case "humidity":
            // dry(brown) → wet(blue)
            rgb = heatColor(1 - d.humidity);
            break;
          case "height": {
            const h = d.height;
            if (h < sea) {
              const k = h / sea;
              rgb = [Math.round(30 + k * 30), Math.round(60 + k * 80), Math.round(120 + k * 90)];
            } else {
              const k = Math.min(1, (h - sea) / 50);
              rgb = [
                Math.round(90 + k * 140),
                Math.round(150 - k * 30),
                Math.round(80 - k * 40),
              ];
              if (k > 0.7) {
                const w = (k - 0.7) / 0.3;
                rgb = [
                  Math.round(rgb[0] + (240 - rgb[0]) * w),
                  Math.round(rgb[1] + (244 - rgb[1]) * w),
                  Math.round(rgb[2] + (250 - rgb[2]) * w),
                ];
              }
            }
            break;
          }
          case "slope":
            rgb = slopeColor(d.slope);
            break;
          case "snow": {
            // Snow mask: green (none) → pale (patchy snowy-grass) → white (full).
            const t = d.snow;
            rgb = [
              Math.round(60 + (240 - 60) * t),
              Math.round(120 + (244 - 120) * t),
              Math.round(70 + (250 - 70) * t),
            ];
            break;
          }
          case "shore": {
            // Shoreline classification: deep=navy, shallow=cyan, beach=sand,
            // rock=grey, near-shore transition=pale, inland=muted biome.
            switch (d.shelf) {
              case "deep":
                rgb = [24, 44, 78];
                break;
              case "shallow":
                rgb = [86, 168, 196];
                break;
              case "beach":
                rgb = [224, 208, 150];
                break;
              case "rock":
                rgb = [120, 120, 124];
                break;
              default: {
                const bc = hexToRgb(BIOME_DEFS[d.biome as BiomeId].color);
                if (d.shoreDist <= 4) {
                  // near-shore transition band — lighten to reveal the shoreline
                  rgb = [
                    Math.round(bc[0] * 0.7 + 60),
                    Math.round(bc[1] * 0.7 + 66),
                    Math.round(bc[2] * 0.7 + 50),
                  ];
                } else {
                  rgb = [
                    Math.round(bc[0] * 0.6 + 24),
                    Math.round(bc[1] * 0.6 + 30),
                    Math.round(bc[2] * 0.6 + 24),
                  ];
                }
              }
            }
            break;
          }
          default:
            rgb = [0, 0, 0];
        }
        const o = (py * MAP_PX + px) * 4;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Player marker at the centre.
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(MAP_PX / 2 - 1, MAP_PX / 2 - 1, 3, 3);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeRect(0.5, 0.5, MAP_PX - 1, MAP_PX - 1);
  }
}

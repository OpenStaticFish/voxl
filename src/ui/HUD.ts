import { HOTBAR_BLOCKS, getBlock } from "../game/Blocks";

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

/** In-game HUD: crosshair, hotbar, status badges (fps/mode/coords), toast. */
export class HUD {
  private readonly slots: HTMLElement[] = [];
  private readonly fpsEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly coordsEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly crosshair: HTMLElement;
  private toastTimer: number | null = null;

  constructor() {
    this.fpsEl = $("fps");
    this.modeEl = $("mode-indicator");
    this.coordsEl = $("coords");
    this.toastEl = $("toast");
    this.crosshair = $("crosshair");
    this.buildHotbar();
  }

  private buildHotbar(): void {
    const root = $("hotbar");
    root.innerHTML = "";
    HOTBAR_BLOCKS.forEach((id, i) => {
      const def = getBlock(id);
      const slot = document.createElement("div");
      slot.className = "hotbar-slot";
      slot.title = def.name;
      slot.dataset.index = String(i);
      const swatch = document.createElement("div");
      swatch.className = "swatch";
      swatch.style.background = def.color;
      const num = document.createElement("span");
      num.className = "slot-num";
      num.textContent = String(i + 1);
      slot.appendChild(swatch);
      slot.appendChild(num);
      root.appendChild(slot);
      this.slots.push(slot);
    });
    this.setSelected(0);
  }

  setSelected(index: number): void {
    this.slots.forEach((el, i) => {
      el.classList.toggle("selected", i === index);
    });
  }

  setFpsVisible(visible: boolean): void {
    if (visible) this.fpsEl.removeAttribute("hidden");
    else this.fpsEl.setAttribute("hidden", "");
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${fps} fps`;
  }

  setMode(text: string): void {
    this.modeEl.textContent = text;
  }

  setCoords(x: number, y: number, z: number): void {
    this.coordsEl.textContent = `x ${Math.floor(x)}  y ${Math.floor(y)}  z ${Math.floor(z)}`;
  }

  setCrosshairVisible(visible: boolean): void {
    this.crosshair.style.opacity = visible ? "1" : "0";
  }

  showToast(message: string, ms = 1800): void {
    this.toastEl.textContent = message;
    this.toastEl.removeAttribute("hidden");
    this.toastEl.classList.add("show");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove("show");
      this.toastEl.setAttribute("hidden", "");
    }, ms);
  }
}

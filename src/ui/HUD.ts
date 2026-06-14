import { getItem } from "../game/Items";
import type { GameMode } from "../game/Items";
import type { Inventory } from "../game/Inventory";
import { MAX_BREATH } from "../game/PlayerState";

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

/** In-game HUD: crosshair, stat bars (health/hunger/air), inventory hotbar,
 *  status badges (fps/mode/coords), and toast. */
export class HUD {
  private readonly slots: HTMLElement[] = [];
  private readonly fpsEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly coordsEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly heartFills: HTMLElement[] = [];
  private readonly hungerFills: HTMLElement[] = [];
  private readonly airFills: HTMLElement[] = [];
  private readonly airRow: HTMLElement;
  private readonly lockHint: HTMLElement;
  private toastTimer: number | null = null;

  constructor() {
    this.fpsEl = $("fps");
    this.modeEl = $("mode-indicator");
    this.coordsEl = $("coords");
    this.toastEl = $("toast");
    this.crosshair = $("crosshair");
    this.airRow = $("air");
    this.lockHint = $("lock-hint");
    this.buildHotbar();
    this.buildStatBar("hearts", this.heartFills);
    this.buildStatBar("hunger", this.hungerFills);
    this.buildStatBar("air", this.airFills);
    this.setSelected(0);
  }

  private buildHotbar(): void {
    const root = $("hotbar");
    root.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement("div");
      slot.className = "hotbar-slot";
      slot.dataset.index = String(i);
      const num = document.createElement("span");
      num.className = "slot-num";
      num.textContent = String(i + 1);
      slot.appendChild(num);
      root.appendChild(slot);
      this.slots.push(slot);
    }
  }

  private buildStatBar(id: string, fills: HTMLElement[]): void {
    const root = $(id);
    root.innerHTML = "";
    for (let i = 0; i < 10; i++) {
      const cell = document.createElement("div");
      cell.className = "stat-cell";
      const fill = document.createElement("div");
      fill.className = "stat-fill";
      cell.appendChild(fill);
      root.appendChild(cell);
      fills.push(fill);
    }
  }

  /** Repaint the hotbar from the inventory (slots 0..8). */
  refreshHotbar(inv: Inventory, selected: number, mode: GameMode): void {
    for (let i = 0; i < 9; i++) {
      const node = this.slots[i];
      const stack = inv.getSlot(i);
      node.classList.toggle("filled", !!stack);
      // keep the slot number label; clear the rest
      const num = node.querySelector(".slot-num");
      node.innerHTML = "";
      if (num) node.appendChild(num);
      if (stack) {
        const def = getItem(stack.id);
        const sw = document.createElement("div");
        sw.className = "swatch";
        if (def?.icon === "food") sw.classList.add("swatch-food");
        sw.style.background = def?.color ?? "#888";
        node.appendChild(sw);
        if (mode === "survival" && stack.count > 1) {
          const c = document.createElement("span");
          c.className = "count";
          c.textContent = String(stack.count);
          node.appendChild(c);
        }
      }
    }
    this.setSelected(selected);
  }

  setSelected(index: number): void {
    this.slots.forEach((node, i) => node.classList.toggle("selected", i === index));
  }

  /** hp/hunger are 0–20 (10 hearts/drumsticks), breath is 0–10 (10 bubbles). */
  setStats(hp: number, hunger: number, breath: number): void {
    this.paintHalfCells(this.heartFills, hp);
    this.paintHalfCells(this.hungerFills, hunger);
    // air: 1 bubble per breath point
    for (let i = 0; i < this.airFills.length; i++) {
      const v = Math.max(0, Math.min(1, breath - i));
      this.airFills[i].style.width = `${v * 100}%`;
    }
    if (breath < MAX_BREATH) this.airRow.removeAttribute("hidden");
    else this.airRow.setAttribute("hidden", "");
  }

  private paintHalfCells(fills: HTMLElement[], value: number): void {
    for (let i = 0; i < fills.length; i++) {
      const v = Math.max(0, Math.min(2, value - i * 2));
      fills[i].style.width = `${(v / 2) * 100}%`;
    }
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

  /** Show the "capture mouse" hint whenever pointer lock is not held. */
  setLockHint(locked: boolean): void {
    if (locked) this.lockHint.setAttribute("hidden", "");
    else this.lockHint.removeAttribute("hidden");
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

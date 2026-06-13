import type { GameState } from "../types";

type ScreenId = "main-menu" | "controls-screen" | "settings-screen" | "pause-menu";

const OVERLAYS: ScreenId[] = [
  "main-menu",
  "controls-screen",
  "settings-screen",
  "pause-menu",
];

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

/**
 * Manages DOM screen visibility. Keeps the logic-free HTML in index.html as
 * the single source of UI structure; this class only toggles visibility and
 * dispatches transition requests back to the Game via callbacks.
 */
export class ScreenManager {
  onEnterPlaying?: () => void;
  onEnterMenu?: () => void;
  onLoadingProgress?: (msg: string) => void;

  private overlayStack: ScreenId[] = [];

  constructor() {
    // Hide every overlay initially except the main menu.
    OVERLAYS.forEach((id) => $(id).setAttribute("hidden", ""));
    $("main-menu").removeAttribute("hidden");
    $("hud").setAttribute("hidden", "");
    $("loading").setAttribute("hidden", "");
  }

  private show(id: ScreenId): void {
    $(id).removeAttribute("hidden");
  }

  private hide(id: ScreenId): void {
    $(id).setAttribute("hidden", "");
  }

  hideAllOverlays(): void {
    OVERLAYS.forEach((id) => this.hide(id));
    this.overlayStack = [];
  }

  pushOverlay(id: ScreenId): void {
    // Only the top overlay should be visible. Hide the current top first so a
    // lower-DOM-order overlay (e.g. pause-menu) can't paint over the newly
    // pushed one (e.g. settings-screen) — they share the same z-index.
    const prev = this.overlayStack[this.overlayStack.length - 1];
    if (prev && prev !== id) this.hide(prev);
    this.overlayStack.push(id);
    this.show(id);
  }

  popOverlay(): void {
    const top = this.overlayStack.pop();
    if (top) this.hide(top);
    // Reveal the overlay that's now back on top of the stack.
    const prev = this.overlayStack[this.overlayStack.length - 1];
    if (prev) this.show(prev);
  }

  get activeOverlayCount(): number {
    return this.overlayStack.length;
  }

  setHudVisible(visible: boolean): void {
    if (visible) $("hud").removeAttribute("hidden");
    else $("hud").setAttribute("hidden", "");
  }

  setLoading(visible: boolean, msg = "Generating world…"): void {
    if (visible) {
      $("loading-text").textContent = msg;
      $("loading").removeAttribute("hidden");
    } else {
      $("loading").setAttribute("hidden", "");
    }
  }

  setMenuSeed(seed: string): void {
    $("menu-seed").textContent = seed;
  }

  /** Apply a top-level game state. */
  applyState(state: GameState): void {
    switch (state) {
      case "menu":
        this.hideAllOverlays();
        this.show("main-menu");
        this.setHudVisible(false);
        this.setLoading(false);
        this.onEnterMenu?.();
        break;
      case "loading":
        this.hideAllOverlays();
        this.setHudVisible(false);
        this.setLoading(true);
        break;
      case "playing":
        this.hideAllOverlays();
        this.setHudVisible(true);
        this.setLoading(false);
        this.onEnterPlaying?.();
        break;
      case "paused":
        this.hideAllOverlays();
        this.show("pause-menu");
        this.overlayStack = ["pause-menu"];
        this.setHudVisible(true);
        this.setLoading(false);
        break;
    }
  }
}

// Input manager: keyboard state, mouse-look deltas, mouse-button edges, and
// pointer-lock handling. Also detects double-tap-Space for flight toggling.

import { dbg, dbgErr, dbgWarn } from "../state/Debug";

export interface ClickEdges {
  break: boolean; // left mouse pressed this frame
  place: boolean; // right mouse pressed this frame
}

export class Input {
  private readonly keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private breakQueued = false;
  private placeQueued = false;
  private _leftHeld = false;
  private _rightHeld = false;
  private lastSpaceTap = 0;
  private doubleTapSpace = false;
  private _locked = false;

  readonly canvas: HTMLCanvasElement;
  onPointerLockChange?: (locked: boolean) => void;
  onPointerLockError?: () => void;
  onDoubleTapSpace?: () => void;
  onNumberKey?: (n: number) => void;
  onScroll?: (dir: number) => void;
  onKey?: (code: string, down: boolean) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bind();
  }

  private bind(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    // mousedown is bound to window (capture phase) — NOT the canvas — so clicks
    // are caught even if an overlay element happens to sit above the canvas.
    window.addEventListener("mousedown", this.handleMouseDown, true);
    window.addEventListener("mouseup", this.handleMouseUp);
    // Firefox fallback: `click` (left) and `contextmenu`/`auxclick` (right)
    // fire reliably even when `mousedown` is flaky during focus/pointer-lock
    // transitions, so we also set the break/place edges from these events.
    window.addEventListener("click", this.handleClick, true);
    window.addEventListener("auxclick", this.handleAuxClick, true);
    window.addEventListener("contextmenu", this.handleContext, true);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("pointerlockerror", this.handlePointerLockError);
    // Focus diagnostics — if these fire, the window lost focus (which kills
    // pointer lock and swallows clicks until the user clicks to re-focus).
    window.addEventListener("blur", () => dbgWarn("⚠ window BLUR — game lost focus (clicks will be ignored until you click the game again)"));
    window.addEventListener("focus", () => dbg("window focus — game regained focus"));
    document.addEventListener("visibilitychange", () => dbgWarn("visibilitychange — hidden=" + document.hidden));
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mousedown", this.handleMouseDown, true);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("click", this.handleClick, true);
    window.removeEventListener("auxclick", this.handleAuxClick, true);
    window.removeEventListener("contextmenu", this.handleContext, true);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("pointerlockerror", this.handlePointerLockError);
  }

  private handleContext = (e: Event): void => {
    const t = (e as MouseEvent).target as Element | null;
    // Let visible UI (inventory/menus) handle its own context menu.
    if (t && t.closest && t.closest(".screen:not([hidden])")) return;
    e.preventDefault();
    dbg("contextmenu (robust right-click) -> placeQueued");
    this.placeQueued = true;
  };

  private handleClick = (e: MouseEvent): void => {
    // `click` fires reliably in Firefox even when mousedown is flaky, so this
    // is the primary break trigger. (click only fires for the left button.)
    const t = e.target as Element | null;
    if (t && t.closest && t.closest(".screen:not([hidden])")) return;
    dbg("click (robust left-click) -> breakQueued");
    this.breakQueued = true;
  };

  private handleAuxClick = (e: MouseEvent): void => {
    // `auxclick` is the right-button analog of `click` and fires reliably in
    // Firefox; `contextmenu` can be suppressed during pointer lock, so this is
    // the primary place trigger.
    const t = e.target as Element | null;
    if (t && t.closest && t.closest(".screen:not([hidden])")) return;
    if (e.button === 2) {
      dbg("auxclick (robust right-click) -> placeQueued");
      this.placeQueued = true;
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Don't capture game keys while the user is typing in a form field.
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) {
      return;
    }
    if (e.code === "Space") e.preventDefault();
    if (!e.repeat) {
      this.onKey?.(e.code, true);
      if (e.code === "Space") {
        const now = performance.now();
        if (now - this.lastSpaceTap < 280) {
          this.doubleTapSpace = true;
          this.onDoubleTapSpace?.();
        }
        this.lastSpaceTap = now;
      }
      if (e.code.startsWith("Digit")) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) this.onNumberKey?.(n);
      }
    }
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    this.onKey?.(e.code, false);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this._locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    const t = e.target as Element | null;
    const describe = (el: Element | null): string => {
      if (!el) return "null";
      const tag = el.tagName.toLowerCase();
      const id = el.id ? "#" + el.id : "";
      const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : "";
      return tag + id + cls;
    };
    // Ignore clicks that land on a visible UI overlay (main menu, pause,
    // settings, inventory) — those have their own handlers.
    if (t && t.closest && t.closest(".screen:not([hidden])")) {
      dbg(`mousedown on UI (${describe(t)}) — ignored`);
      return;
    }
    dbg(`mousedown button=${e.button} locked=${this._locked} target=${describe(t)} pointerLockElement=${document.pointerLockElement ? "yes" : "no"}`);
    // Register the interaction FIRST, unconditionally, so clicks always mine/
    // place whether or not pointer lock is engaged.
    if (e.button === 0) {
      this.breakQueued = true;
      this._leftHeld = true;
    } else if (e.button === 2) {
      this.placeQueued = true;
      this._rightHeld = true;
    }
    dbg(`  queued break=${this.breakQueued} place=${this.placeQueued} leftHeld=${this._leftHeld}`);
    // Best-effort: try to engage pointer lock for mouse-look on a left click.
    if (!this._locked && e.button === 0) this.requestLock();
  };

  private handleMouseUp = (e: MouseEvent): void => {
    dbg("mouseup button=" + e.button);
    if (e.button === 0) this._leftHeld = false;
    else if (e.button === 2) this._rightHeld = false;
  };

  private handleWheel = (e: WheelEvent): void => {
    // Cycle the hotbar whether or not pointer lock is held (cursor-aiming mode
    // included). Let visible UI overlays (e.g. the inventory) scroll normally.
    const t = e.target as Element | null;
    if (t && t.closest && t.closest(".screen:not([hidden])")) return;
    e.preventDefault();
    this.onScroll?.(e.deltaY > 0 ? 1 : -1);
  };

  private handlePointerLockChange = (): void => {
    this._locked = document.pointerLockElement === this.canvas;
    dbg("pointerlockchange -> locked=" + this._locked);
    if (!this._locked) {
      this._leftHeld = false;
      this._rightHeld = false;
    }
    this.onPointerLockChange?.(this._locked);
  };

  private handlePointerLockError = (): void => {
    this._locked = false;
    dbgErr("pointerlockerror — the browser REFUSED pointer lock (cursor-aiming fallback is active)");
    this.onPointerLockError?.();
  };

  requestLock(): void {
    if (this._locked) return;
    try {
      dbg("requestLock: calling canvas.requestPointerLock()…");
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.then === "function") {
        result.then(
          () => dbg("requestPointerLock promise RESOLVED"),
          (err) => dbgWarn("requestPointerLock promise REJECTED:", err),
        );
      }
    } catch (err) {
      dbgWarn("requestPointerLock THREW synchronously (caught):", err);
    }
  }

  exitLock(): void {
    if (this._locked) document.exitPointerLock();
  }

  get locked(): boolean {
    return this._locked;
  }

  get leftHeld(): boolean {
    return this._leftHeld;
  }

  get rightHeld(): boolean {
    return this._rightHeld;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Accumulated mouse delta since last consume; resets after read. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  consumeClicks(): ClickEdges {
    const c: ClickEdges = { break: this.breakQueued, place: this.placeQueued };
    this.breakQueued = false;
    this.placeQueued = false;
    return c;
  }

  consumeDoubleTapSpace(): boolean {
    const v = this.doubleTapSpace;
    this.doubleTapSpace = false;
    return v;
  }

  clearTransient(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.breakQueued = false;
    this.placeQueued = false;
    this._leftHeld = false;
    this._rightHeld = false;
    this.doubleTapSpace = false;
    this.keys.clear();
  }
}

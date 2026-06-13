// Input manager: keyboard state, mouse-look deltas, mouse-button edges, and
// pointer-lock handling. Also detects double-tap-Space for flight toggling.

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
  private lastSpaceTap = 0;
  private doubleTapSpace = false;
  private _locked = false;

  readonly canvas: HTMLCanvasElement;
  onPointerLockChange?: (locked: boolean) => void;
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
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("contextmenu", this.handleContext);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("contextmenu", this.handleContext);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
  }

  private handleContext = (e: Event): void => {
    e.preventDefault();
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
    if (!this._locked) return;
    if (e.button === 0) this.breakQueued = true;
    else if (e.button === 2) this.placeQueued = true;
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this._locked) return;
    e.preventDefault();
    this.onScroll?.(e.deltaY > 0 ? 1 : -1);
  };

  private handlePointerLockChange = (): void => {
    this._locked = document.pointerLockElement === this.canvas;
    this.onPointerLockChange?.(this._locked);
  };

  requestLock(): void {
    if (!this._locked) {
      // requestPointerLock may return a Promise (newer browsers); swallow any
      // rejection (e.g. not triggered by a user gesture) instead of crashing.
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.then === "function") {
        result.catch(() => {});
      }
    }
  }

  exitLock(): void {
    if (this._locked) document.exitPointerLock();
  }

  get locked(): boolean {
    return this._locked;
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
    this.doubleTapSpace = false;
    this.keys.clear();
  }
}

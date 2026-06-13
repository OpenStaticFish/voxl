import { Engine, Scene } from "@babylonjs/core";

/**
 * Thin wrapper around the Babylon.js Engine that owns the canvas and handles
 * DPI/resize. The canvas is created and appended to a provided host element.
 * The Scene is owned by Game; Renderer only draws it.
 */
export class Renderer {
  readonly engine: Engine;
  readonly canvas: HTMLCanvasElement;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "game-canvas";
    host.appendChild(this.canvas);

    this.engine = new Engine(
      this.canvas,
      true, // antialias
      {
        preserveDrawingBuffer: true, // needed for canvas.toDataURL screenshots
        powerPreference: "high-performance",
        stencil: true,
      },
      false, // adaptToDeviceRatio — we cap manually below
    );
    this.engine.setSize(window.innerWidth, window.innerHeight);
    // Cap DPR at 2 (matches the previous three.js setPixelRatio behaviour).
    // setHardwareScalingLevel(1/n) renders at n× resolution.
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
  }

  setSize(w: number, h: number): void {
    this.engine.setSize(w, h);
  }

  draw(scene: Scene): void {
    scene.render();
  }

  dispose(): void {
    this.engine.dispose();
    this.canvas.remove();
  }
}

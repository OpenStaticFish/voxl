import * as THREE from "three";

/**
 * Thin wrapper around THREE.WebGLRenderer that owns the canvas, handles DPI,
 * resize, and tone mapping. The canvas is appended to a provided host element.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true, // needed for canvas.toDataURL screenshots
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.canvas = this.renderer.domElement;
    this.canvas.id = "game-canvas";
    host.appendChild(this.canvas);
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h);
  }

  draw(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.canvas.remove();
  }
}

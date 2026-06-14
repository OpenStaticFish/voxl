import { Color3, LinesMesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";

/**
 * Debug overlay that draws the XZ footprint of every loaded chunk as a thin
 * grid of squares at the player's feet height. Pure diagnostic — toggled from
 * the console (`__voxl.chunkBorders()`) or a key, and rebuilt only when the
 * player crosses a chunk boundary so it costs nothing per frame.
 *
 * Use it to see at a glance which chunks are loaded and where culling/streaming
 * boundaries fall.
 */
export class ChunkBorderOverlay {
  private lines: LinesMesh;
  private readonly scene: Scene;
  private visible = false;
  private lastPcx = Number.NaN;
  private lastPcz = Number.NaN;

  constructor(scene: Scene) {
    this.scene = scene;
    this.lines = MeshBuilder.CreateLineSystem(
      "chunk-borders",
      { lines: [[new Vector3(0, 0, 0), new Vector3(0, 0, 0)]], updatable: true },
      scene,
    );
    this.lines.color = new Color3(0.2, 0.3, 0.5);
    this.lines.alpha = 0.5;
    this.lines.isPickable = false;
    this.lines.applyFog = false;
    this.lines.receiveShadows = false;
    this.lines.alwaysSelectAsActiveMesh = true; // never frustum-cull the overlay
    this.lines.isVisible = false;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.lines.isVisible = visible;
    // Force a rebuild on re-enable so stale geometry never shows.
    if (visible) {
      this.lastPcx = Number.NaN;
      this.lastPcz = Number.NaN;
    }
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /**
   * Rebuild the grid if the player has crossed into a new chunk since last call.
   * `forEachChunkCoord` is World.forEachChunkCoord. Cheap to call every frame:
   * it bails out immediately unless the player's chunk changed.
   */
  update(
    playerX: number,
    playerZ: number,
    playerY: number,
    forEachChunkCoord: (cb: (cx: number, cz: number) => void) => void,
  ): void {
    if (!this.visible) return;
    const pcx = Math.floor(playerX / 16);
    const pcz = Math.floor(playerZ / 16);
    if (pcx === this.lastPcx && pcz === this.lastPcz) return;
    this.lastPcx = pcx;
    this.lastPcz = pcz;

    const y = playerY;
    const loops: Vector3[][] = [];
    forEachChunkCoord((cx, cz) => {
      const x0 = cx * 16;
      const z0 = cz * 16;
      const x1 = x0 + 16;
      const z1 = z0 + 16;
      // A closed 5-point square outline per chunk footprint.
      loops.push([
        new Vector3(x0, y, z0),
        new Vector3(x1, y, z0),
        new Vector3(x1, y, z1),
        new Vector3(x0, y, z1),
        new Vector3(x0, y, z0),
      ]);
    });

    // Rebuild the line system in place (dispose + recreate — infrequent).
    this.lines.dispose();
    if (loops.length === 0) {
      this.lines = MeshBuilder.CreateLineSystem(
        "chunk-borders",
        { lines: [[new Vector3(0, 0, 0), new Vector3(0, 0, 0)]], updatable: true },
        this.scene,
      );
    } else {
      this.lines = MeshBuilder.CreateLineSystem("chunk-borders", { lines: loops }, this.scene);
    }
    this.lines.color = new Color3(0.2, 0.3, 0.5);
    this.lines.alpha = 0.5;
    this.lines.isPickable = false;
    this.lines.applyFog = false;
    this.lines.receiveShadows = false;
    this.lines.alwaysSelectAsActiveMesh = true;
    this.lines.isVisible = true;
  }

  dispose(): void {
    this.lines.dispose();
  }
}

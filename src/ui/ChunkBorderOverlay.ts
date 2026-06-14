import { Color3, LinesMesh, Scene, SubMesh, VertexData } from "@babylonjs/core";
import { MAX_RENDER_DISTANCE } from "../game/graphics/GraphicsController";

/**
 * Debug overlay that draws the XZ footprint of every loaded chunk as a thin
 * grid of squares at the player's feet height. Pure diagnostic — toggled from
 * the console (`__voxl.chunkBorders()`) or a key, and rebuilt only when the
 * player crosses a chunk boundary so it costs nothing per frame.
 *
 * Implementation: one updatable `LinesMesh` is created once with a worst-case
 * position pool + a static line-list index. Each rebuild just overwrites the
 * active region of the pool and refreshes the SubMesh range — no per-rebuild
 * allocations and no dispose/recreate (which would GC-spike while flying).
 */
// Worst case: (2*maxViewDistance+1)^2 chunks, each rendered as 4 line segments
// (8 vertices). Rounded up for a little headroom.
const MAX_CHUNKS = (2 * MAX_RENDER_DISTANCE + 1) * (2 * MAX_RENDER_DISTANCE + 1) + 32;
const SEGMENTS_PER_CHUNK = 4;
const VERTS_PER_SEGMENT = 2;
const MAX_VERTS = MAX_CHUNKS * SEGMENTS_PER_CHUNK * VERTS_PER_SEGMENT;

export class ChunkBorderOverlay {
  private readonly lines: LinesMesh;
  /** Reused position pool (3 floats/vertex). Writes only the active region. */
  private readonly positions: Float32Array;
  private visible = false;
  private lastPcx = Number.NaN;
  private lastPcz = Number.NaN;

  constructor(scene: Scene) {
    this.positions = new Float32Array(MAX_VERTS * 3);
    // Static line-list index: segment k uses vertices (2k, 2k+1) → indices are
    // just [0,1,2,3,…]. Built once; the SubMesh range limits what is drawn.
    const indices = new Uint32Array(MAX_VERTS);
    for (let i = 0; i < MAX_VERTS; i++) indices[i] = i;

    this.lines = new LinesMesh("chunk-borders", scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.indices = indices;
    vd.applyToMesh(this.lines, true); // updatable → updateVerticesData later

    this.lines.color = new Color3(0.2, 0.3, 0.5);
    this.lines.alpha = 0.5;
    this.lines.isPickable = false;
    this.lines.applyFog = false;
    this.lines.receiveShadows = false;
    this.lines.alwaysSelectAsActiveMesh = true; // never frustum-cull the overlay
    this.lines.isVisible = false;
    // Start with an empty draw range.
    this.setDrawRange(0);
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
    const pos = this.positions;
    let v = 0; // vertex cursor
    forEachChunkCoord((cx, cz) => {
      if (v + SEGMENTS_PER_CHUNK * VERTS_PER_SEGMENT > MAX_VERTS) return; // pool guard
      const x0 = cx * 16;
      const z0 = cz * 16;
      const x1 = x0 + 16;
      const z1 = z0 + 16;
      // Four independent segments forming the chunk's XZ outline, at feet height.
      seg(pos, v, x0, y, z0, x1, y, z0); v += 2;
      seg(pos, v, x1, y, z0, x1, y, z1); v += 2;
      seg(pos, v, x1, y, z1, x0, y, z1); v += 2;
      seg(pos, v, x0, y, z1, x0, y, z0); v += 2;
    });

    // Push the active region to the GPU (one upload, no realloc) and trim the
    // SubMesh to exactly the active vertices.
    this.lines.updateVerticesData("position", this.positions, false);
    this.setDrawRange(v);
  }

  /** Set the SubMesh to draw `vertexCount` vertices starting at 0. */
  private setDrawRange(vertexCount: number): void {
    const drawVerts = Math.min(MAX_VERTS, vertexCount);
    this.lines.subMeshes.length = 0;
    new SubMesh(0, 0, drawVerts, 0, drawVerts, this.lines, undefined, false);
  }

  dispose(): void {
    this.lines.dispose();
  }
}

/** Write a single 2-vertex line segment into the position pool at vertex `vi`. */
function seg(pos: Float32Array, vi: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const o = vi * 3;
  pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
  pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
}

import {
  Color3,
  Mesh,
  Scene,
  ShaderMaterial,
  SubMesh,
  VertexData,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import { Noise } from "./Noise";
import {
  CLOUD_CELL,
  CLOUD_RADIUS,
  CLOUD_HEIGHT,
  CLOUD_THICKNESS,
  CLOUD_DENSITY,
  CLOUD_SPEED,
} from "../constants";

// Minetest/Luanti-style voxel clouds.
//
// A cloud layer is a 2D grid of cells around the camera; each cell is either
// "cloud" or not, decided by thresholded fractal noise. Filled cells are drawn
// as blocky slabs (a top face, a bottom face, and side walls only where the
// neighbour cell is empty), with per-face shading baked into vertex colours so
// the layer reads as a solid, flat-bottomed, blocky mass. The whole field
// drifts over time and re-grids on the camera — the same approach as Luanti's
// src/client/clouds.cpp, scaled to VOXL's world.

/** Cool blue-grey tint used to shade cloud sides and bottoms. */
const SHADOW = Color3.FromHexString("#6f8fb5");

/** Noise sample frequency per cell (lower = larger, chunkier cloud patches). */
const CLOUD_FREQ = 0.22;
/** Rebuild when the drift slide exceeds this fraction of a cell. */
const REBUILD_SLIDE = 0.5;

export class Clouds {
  readonly mesh: Mesh;

  private noise: Noise;
  private readonly scene: Scene;
  private readonly material: ShaderMaterial;

  // The drift "origin" grows over time; clouds scroll as it moves.
  private originX = 0;
  private originZ = 0;
  // Origin captured at the last rebuild (geometry is baked in world space at
  // this point; between rebuilds the mesh slides by the delta).
  private meshOriginX = 0;
  private meshOriginZ = 0;

  private lastCenterX = Infinity;
  private lastCenterZ = Infinity;

  private enabled = true;
  /**
   * "Simple" tier skips the cloud TOP faces — the player is almost always below
   * the cloud layer (CLOUD_HEIGHT=130 vs player ~y=40) so tops are rarely seen,
   * and culling them roughly halves the cloud triangle count. Toggled by the
   * graphics settings (simple vs fancy clouds).
   */
  private simple = false;

  // Preallocated geometry buffers, reused across rebuilds (no per-build GC).
  // RGBA colors (4 floats/vertex) — required by Babylon's vertex-color path.
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly indices: Uint32Array;
  private maxVerts: number;
  private maxFaces: number;

  // Baked per-face shading colours (stored as [r,g,b,a] tuples for fast copy).
  private readonly cTop: Color3;
  private readonly cSide1: Color3;
  private readonly cSide2: Color3;
  private readonly cBottom: Color3;

  constructor(seed: string, scene: Scene) {
    this.scene = scene;
    this.noise = new Noise(seed || "voxl");

    this.cTop = Color3.FromHexString("#e2eaf2"); // soft cool white, not pure #ffffff
    // side1 (N/S walls) and side2 (E/W walls) get progressively more shadow,
    // bottom gets full shadow — gives the slabs simple directional depth.
    this.cSide1 = SHADOW.scale(0.25).add(new Color3(0.75, 0.75, 0.75));
    this.cSide2 = SHADOW.scale(0.5).add(new Color3(0.5, 0.5, 0.5));
    this.cBottom = SHADOW.scale(0.28).add(new Color3(0.72, 0.72, 0.72));

    const cellsPerSide = CLOUD_RADIUS * 2;
    this.maxFaces = cellsPerSide * cellsPerSide * 6;
    this.maxVerts = this.maxFaces * 4;
    this.positions = new Float32Array(this.maxVerts * 3);
    this.colors = new Float32Array(this.maxVerts * 4);
    // Index pattern for any number of quads: [4k,4k+1,4k+2, 4k+2,4k+3,4k].
    // Only the SubMesh indexCount changes per rebuild, so this is built once.
    this.indices = new Uint32Array(this.maxFaces * 6);
    for (let k = 0; k < this.maxFaces; k++) {
      const o = k * 6;
      const v = k * 4;
      this.indices[o] = v;
      this.indices[o + 1] = v + 1;
      this.indices[o + 2] = v + 2;
      this.indices[o + 3] = v + 2;
      this.indices[o + 4] = v + 3;
      this.indices[o + 5] = v;
    }

    // Build the mesh with full-size updatable buffers; we trim the drawn range
    // via SubMesh each rebuild.
    this.mesh = new Mesh("clouds", scene);
    this.mesh.alwaysSelectAsActiveMesh = true; // never frustum-cull (follows camera)
    this.mesh.applyFog = false;
    this.mesh.isPickable = false;

    const vd = new VertexData();
    vd.positions = this.positions;
    vd.colors = this.colors;
    vd.indices = this.indices;
    vd.applyToMesh(this.mesh, true); // true = updatable

    this.material = makeCloudMaterial(scene);
    this.mesh.material = this.material;

    // Start with an empty draw range.
    this.setDrawRange(0, 0);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.mesh.setEnabled(enabled);
  }

  /**
   * Toggle the simple tier (skips cloud top faces for ~half the triangles).
   * Forces a rebuild so the change is immediate rather than waiting for drift.
   */
  setSimple(simple: boolean): void {
    if (this.simple === simple) return;
    this.simple = simple;
    this.lastCenterX = Infinity;
    this.lastCenterZ = Infinity;
  }

  setSeed(seed: string): void {
    this.noise = new Noise(seed || "voxl");
    this.lastCenterX = Infinity;
    this.lastCenterZ = Infinity;
  }

  /** Advance the cloud drift. */
  step(dt: number): void {
    if (!this.enabled) return;
    // Clouds drift toward -Z (and gently -X).
    this.originZ += dt * CLOUD_SPEED;
    this.originX += dt * CLOUD_SPEED * 0.35;
  }

  /** Re-center on the camera, rebuilding the mesh only when needed, and apply a
   *  smooth slide between rebuilds so motion never stutters. */
  update(camX: number, camZ: number): void {
    if (!this.enabled) return;

    const slideX = this.originX - this.meshOriginX;
    const slideZ = this.originZ - this.meshOriginZ;
    this.mesh.position.set(slideX, 0, slideZ);

    const cx = Math.floor((camX - this.originX) / CLOUD_CELL);
    const cz = Math.floor((camZ - this.originZ) / CLOUD_CELL);
    const driftedEnough = Math.hypot(slideX, slideZ) >= CLOUD_CELL * REBUILD_SLIDE;

    if (cx === this.lastCenterX && cz === this.lastCenterZ && !driftedEnough) return;

    this.lastCenterX = cx;
    this.lastCenterZ = cz;
    this.meshOriginX = this.originX;
    this.meshOriginZ = this.originZ;
    this.mesh.position.set(0, 0, 0);
    this.rebuild(cx, cz);
  }

  /** True if the noise field marks cell (nxi, nzi) as cloud. */
  private gridFilled(nxi: number, nzi: number): boolean {
    const n = this.noise.fbm2(nxi * CLOUD_FREQ, nzi * CLOUD_FREQ, 3, 2, 0.5); // ~[-1,1]
    const density = n * 0.5 + 0.5; // [0,1]
    return density < CLOUD_DENSITY;
  }

  private rebuild(cx: number, cz: number): void {
    const R = CLOUD_RADIUS;
    const cs = CLOUD_CELL;
    const top = CLOUD_HEIGHT;
    const bot = CLOUD_HEIGHT - CLOUD_THICKNESS;
    const ox = this.meshOriginX;
    const oz = this.meshOriginZ;
    const span = R * 2;

    // Snapshot of which cells are filled this rebuild.
    const grid = new Uint8Array(span * span);
    for (let zi = -R; zi < R; zi++) {
      for (let xi = -R; xi < R; xi++) {
        if (this.gridFilled(xi + cx, zi + cz)) {
          grid[(zi + R) * span + (xi + R)] = 1;
        }
      }
    }

    const gi = (gx: number, gz: number): number => (gz + R) * span + (gx + R);
    const inArea = (gx: number, gz: number): boolean => gx >= -R && gx < R && gz >= -R && gz < R;

    const pos = this.positions;
    const col = this.colors;
    let v = 0; // vertex cursor

    const addQuad = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      c: number, cy: number, cz: number,
      dx: number, dy: number, dz: number,
      color: Color3,
    ): void => {
      const o = v * 3;
      pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
      pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
      pos[o + 6] = c; pos[o + 7] = cy; pos[o + 8] = cz;
      pos[o + 9] = dx; pos[o + 10] = dy; pos[o + 11] = dz;
      const co = v * 4;
      for (let i = 0; i < 4; i++) {
        col[co + i * 4] = color.r;
        col[co + i * 4 + 1] = color.g;
        col[co + i * 4 + 2] = color.b;
        col[co + i * 4 + 3] = 1;
      }
      v += 4;
    };

    for (let zi = -R; zi < R; zi++) {
      for (let xi = -R; xi < R; xi++) {
        if (grid[gi(xi, zi)] !== 1) continue;
        const wx = (xi + cx) * cs + ox;
        const wz = (zi + cz) * cs + oz;
        const x0 = wx - cs / 2;
        const x1 = wx + cs / 2;
        const z0 = wz - cs / 2;
        const z1 = wz + cs / 2;

        const filledN = inArea(xi, zi - 1) && grid[gi(xi, zi - 1)] === 1;
        const filledS = inArea(xi, zi + 1) && grid[gi(xi, zi + 1)] === 1;
        const filledE = inArea(xi + 1, zi) && grid[gi(xi + 1, zi)] === 1;
        const filledW = inArea(xi - 1, zi) && grid[gi(xi - 1, zi)] === 1;

        // Top and bottom faces (DoubleSide + flat shading via vertex colours,
        // so winding is irrelevant here). Simple tier skips tops — the player is
        // below the layer and the tops are almost never visible.
        if (!this.simple) addQuad(x0, top, z1, x1, top, z1, x1, top, z0, x0, top, z0, this.cTop);
        addQuad(x0, bot, z0, x1, bot, z0, x1, bot, z1, x0, bot, z1, this.cBottom);

        // Side walls only where the neighbour is open (Minetest-style culling).
        if (!filledN) addQuad(x0, top, z0, x1, top, z0, x1, bot, z0, x0, bot, z0, this.cSide1);
        if (!filledS) addQuad(x1, top, z1, x0, top, z1, x0, bot, z1, x1, bot, z1, this.cSide1);
        if (!filledE) addQuad(x1, top, z0, x1, top, z1, x1, bot, z1, x1, bot, z0, this.cSide2);
        if (!filledW) addQuad(x0, top, z1, x0, top, z0, x0, bot, z0, x0, bot, z1, this.cSide2);
      }
    }

    // Push updated vertices to the GPU and trim the drawn range to the active
    // vertices. (We only update position+color; the index buffer is static.)
    this.mesh.updateVerticesData("position", this.positions, false);
    this.mesh.updateVerticesData("color", this.colors, false);
    this.setDrawRange(v, (v / 4) * 6);
  }

  /** Set the SubMesh to draw `indexCount` indices (starting at 0). */
  private setDrawRange(vertexCount: number, indexCount: number): void {
    this.mesh.subMeshes.length = 0;
    const drawVerts = Math.min(this.maxVerts, vertexCount);
    // createBoundingBox=false avoids recomputing from garbage data past the range.
    new SubMesh(0, 0, drawVerts, 0, indexCount, this.mesh, undefined, false);
  }

  /** Per-frame fog binding (called from Sky.update). */
  bindFog(color: Color3, start: number, end: number, cameraPos: Vector3): void {
    this.material.setColor3("fogColor", color);
    this.material.setVector2("fogRange", new Vector2(start, end));
    this.material.setVector3("cameraPos", cameraPos);
  }

  /**
   * Apply a day/night brightness factor to the cloud layer (0..1). Clouds are
   * otherwise unlit vertex colours, so without this they'd glow white at night.
   * Pushed each frame by the lighting system via Sky.
   */
  setDayFactor(dayFactor: number): void {
    // Bright at midday (1.0), dim but not black at midnight (~0.32) so clouds
    // read as grey shapes against the night sky.
    const light = 0.32 + 0.68 * dayFactor;
    this.material.setFloat("uCloudLight", light);
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.dispose();
  }
}

/**
 * Unlit + vertex-coloured + fogged ShaderMaterial. Equivalent to three.js's
 * MeshBasicMaterial({ vertexColors: true, fog: true, side: DoubleSide }).
 * StandardMaterial can't reproduce this because disableLighting drops vertex
 * colors, so we hand-roll a tiny shader.
 */
function makeCloudMaterial(scene: Scene): ShaderMaterial {
  const material = new ShaderMaterial(
    "clouds-mat",
    scene,
    {
      vertexSource: /* glsl */ `
        precision highp float;
        attribute vec3 position;
        attribute vec4 color;
        uniform mat4 worldViewProjection;
        uniform mat4 world;
        varying vec4 vColor;
        varying vec3 vPositionW;
        void main() {
          vec4 wp = world * vec4(position, 1.0);
          vPositionW = wp.xyz;
          gl_Position = worldViewProjection * vec4(position, 1.0);
          vColor = color;
        }
      `,
      fragmentSource: /* glsl */ `
        precision highp float;
        varying vec4 vColor;
        varying vec3 vPositionW;
        uniform vec3 fogColor;
        uniform vec2 fogRange;
        uniform vec3 cameraPos;
        uniform float uCloudLight;
        void main() {
          float dist = length(vPositionW - cameraPos);
          float fog = clamp((fogRange.y - dist) / (fogRange.y - fogRange.x), 0.0, 1.0);
          // Clouds are unlit by the voxel system, so apply a day/night brightness
          // factor here so they dim to grey at night instead of glowing white.
          vec3 lit = vColor.rgb * uCloudLight;
          vec3 col = mix(fogColor, lit, fog);
          gl_FragColor = vec4(col, vColor.a);
        }
      `,
    },
    {
      attributes: ["position", "color"],
      uniforms: ["world", "worldViewProjection", "fogColor", "fogRange", "cameraPos", "uCloudLight"],
    },
  );
  material.backFaceCulling = false;
  material.setFloat("uCloudLight", 1.0);
  return material;
}

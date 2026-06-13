import * as THREE from "three";
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
const SHADOW = new THREE.Color("#6f8fb5");

/** Noise sample frequency per cell (lower = larger, chunkier cloud patches). */
const CLOUD_FREQ = 0.22;
/** Rebuild when the drift slide exceeds this fraction of a cell. */
const REBUILD_SLIDE = 0.5;

export class Clouds {
  readonly mesh: THREE.Mesh;

  private noise: Noise;

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

  // Preallocated geometry buffers, reused across rebuilds (no per-build GC).
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geo: THREE.BufferGeometry;

  // Baked per-face shading colours.
  private readonly cTop: THREE.Color;
  private readonly cSide1: THREE.Color;
  private readonly cSide2: THREE.Color;
  private readonly cBottom: THREE.Color;

  constructor(seed: string) {
    this.noise = new Noise(seed || "voxl");

    this.cTop = new THREE.Color("#ffffff");
    // side1 (N/S walls) and side2 (E/W walls) get progressively more shadow,
    // bottom gets full shadow — gives the slabs simple directional depth.
    this.cSide1 = SHADOW.clone().multiplyScalar(0.25).addScalar(0.75);
    this.cSide2 = SHADOW.clone().multiplyScalar(0.5).addScalar(0.5);
    this.cBottom = SHADOW.clone();

    const cellsPerSide = CLOUD_RADIUS * 2;
    const maxFaces = cellsPerSide * cellsPerSide * 6;
    const maxVerts = maxFaces * 4;
    this.positions = new Float32Array(maxVerts * 3);
    this.colors = new Float32Array(maxVerts * 3);

    this.geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", posAttr);
    this.geo.setAttribute("color", colAttr);

    // Index pattern for any number of quads: [4k,4k+1,4k+2, 4k+2,4k+3,4k].
    // Only drawRange changes per rebuild, so this is built once.
    const indices = new Uint32Array(maxFaces * 6);
    for (let k = 0; k < maxFaces; k++) {
      const o = k * 6;
      const v = k * 4;
      indices[o] = v;
      indices[o + 1] = v + 1;
      indices[o + 2] = v + 2;
      indices[o + 3] = v + 2;
      indices[o + 4] = v + 3;
      indices[o + 5] = v;
    }
    this.geo.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geo.setDrawRange(0, 0);
    // Big enough to always be visible; the grid follows the camera.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, CLOUD_HEIGHT, 0), 1e9);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.mesh.visible = enabled;
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
      color: THREE.Color,
    ): void => {
      const o = v * 3;
      pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
      pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
      pos[o + 6] = c; pos[o + 7] = cy; pos[o + 8] = cz;
      pos[o + 9] = dx; pos[o + 10] = dy; pos[o + 11] = dz;
      for (let i = 0; i < 4; i++) {
        col[o + i * 3] = color.r;
        col[o + i * 3 + 1] = color.g;
        col[o + i * 3 + 2] = color.b;
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
        // so winding is irrelevant here).
        addQuad(x0, top, z1, x1, top, z1, x1, top, z0, x0, top, z0, this.cTop);
        addQuad(x0, bot, z0, x1, bot, z0, x1, bot, z1, x0, bot, z1, this.cBottom);

        // Side walls only where the neighbour is open (Minetest-style culling).
        if (!filledN) addQuad(x0, top, z0, x1, top, z0, x1, bot, z0, x0, bot, z0, this.cSide1);
        if (!filledS) addQuad(x1, top, z1, x0, top, z1, x0, bot, z1, x1, bot, z1, this.cSide1);
        if (!filledE) addQuad(x1, top, z0, x1, top, z1, x1, bot, z1, x1, bot, z0, this.cSide2);
        if (!filledW) addQuad(x0, top, z1, x0, top, z0, x0, bot, z0, x0, bot, z1, this.cSide2);
      }
    }

    this.geo.setDrawRange(0, (v / 4) * 6);
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

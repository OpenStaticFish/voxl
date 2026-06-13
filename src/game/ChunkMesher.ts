import * as THREE from "three";
import { CHUNK_SIZE, CHUNK_HEIGHT } from "../constants";
import type { BlockId, FaceDef } from "../types";
import { getBlock } from "./Blocks";
import { tileUV } from "../engine/Textures";
import type { Chunk } from "./Chunk";

// The six cube faces. Corner order + UVs are tuned so that triangles
// (0,1,2, 2,1,3) produce correctly-wound front faces. Order matches the
// FACE index in Blocks.ts: [PX, NX, PY, NY, PZ, NZ].
const FACES: readonly FaceDef[] = [
  {
    // +X (right)
    normal: [1, 0, 0],
    neighbor: [1, 0, 0],
    corners: [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
  {
    // -X (left)
    normal: [-1, 0, 0],
    neighbor: [-1, 0, 0],
    corners: [
      [0, 1, 0],
      [0, 0, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  {
    // +Y (top)
    normal: [0, 1, 0],
    neighbor: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    // -Y (bottom)
    normal: [0, -1, 0],
    neighbor: [0, -1, 0],
    corners: [
      [1, 0, 1],
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
  },
  {
    // +Z (front)
    normal: [0, 0, 1],
    neighbor: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ],
  },
  {
    // -Z (back)
    normal: [0, 0, -1],
    neighbor: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
];

// Per-corner UV (in local 0..1 tile space). Corner index matches FACES order.
const CORNER_UV: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 0],
  [1, 1],
  [1, 0],
];

// Baked directional brightness per face to fake directional lighting. This is
// robust (no mapping risk) and makes the world read clearly in screenshots.
const FACE_BRIGHTNESS = [0.72, 0.72, 1.0, 0.5, 0.86, 0.86];

/** Returns true if a face between `self` and `neighbor` should be rendered. */
function shouldRenderFace(self: BlockId, neighbor: BlockId): boolean {
  if (neighbor === 0) return true; // air always shows the face
  const nb = getBlock(neighbor);
  if (nb.opaque) return false; // hidden by opaque neighbor
  // Transparent neighbor: render unless it's the same type (water-water, etc.)
  return getBlock(self).id !== nb.id;
}

export interface MeshResult {
  opaque: THREE.BufferGeometry | null;
  cutout: THREE.BufferGeometry | null;
  transparent: THREE.BufferGeometry | null;
}

interface BufferBuilder {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
  vertexCount: number;
}

function newBuilder(): BufferBuilder {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [], vertexCount: 0 };
}

function pushFace(
  b: BufferBuilder,
  faceIndex: number,
  x: number,
  y: number,
  z: number,
  tile: number,
  brightness: number,
  waterTop: boolean,
): void {
  const face = FACES[faceIndex];
  const uv = tileUV(tile);
  const du = uv.u1 - uv.u0;
  const dv = uv.v1 - uv.v0;
  const base = b.vertexCount;
  for (let c = 0; c < 4; c++) {
    const corner = face.corners[c];
    // Lower the entire water surface slightly so it reads as a fluid.
    const py = waterTop ? y + corner[1] - 0.1 : y + corner[1];
    b.positions.push(x + corner[0], py, z + corner[2]);
    b.normals.push(face.normal[0], face.normal[1], face.normal[2]);
    const cu = CORNER_UV[c];
    b.uvs.push(uv.u0 + cu[0] * du, uv.v0 + cu[1] * dv);
    b.colors.push(brightness, brightness, brightness);
  }
  b.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  b.vertexCount += 4;
}

// Two diagonal quads forming an "X" — the classic plantlike cross used for
// grass tufts, flowers and mushrooms. Rendered in the cutout pass.
const CROSS_BRIGHTNESS = 0.92;
function pushCross(b: BufferBuilder, x: number, y: number, z: number, tile: number): void {
  const uv = tileUV(tile);
  const du = uv.u1 - uv.u0;
  const dv = uv.v1 - uv.v0;
  const base = b.vertexCount;
  const br = CROSS_BRIGHTNESS;
  // Quad A: diagonal plane through (0,0,0)-(1,1,1).
  const a: Array<[number, number, number, number, number, number, number]> = [
    [0, 0, 0, uv.u0, uv.v0, -0.7071, 0.7071],
    [1, 0, 1, uv.u1, uv.v0, -0.7071, 0.7071],
    [1, 1, 1, uv.u1, uv.v1, -0.7071, 0.7071],
    [0, 1, 0, uv.u0, uv.v1, -0.7071, 0.7071],
  ];
  // Quad B: diagonal plane through (1,0,0)-(0,1,1).
  const c: Array<[number, number, number, number, number, number, number]> = [
    [1, 0, 0, uv.u0, uv.v0, 0.7071, 0.7071],
    [0, 0, 1, uv.u1, uv.v0, 0.7071, 0.7071],
    [0, 1, 1, uv.u1, uv.v1, 0.7071, 0.7071],
    [1, 1, 0, uv.u0, uv.v1, 0.7071, 0.7071],
  ];
  for (const quad of [a, c]) {
    const qbase = b.vertexCount;
    for (const p of quad) {
      b.positions.push(x + p[0], y + p[1], z + p[2]);
      b.normals.push(p[5], 0, p[6]);
      b.uvs.push(p[3], p[4]);
      b.colors.push(br, br, br);
    }
    b.indices.push(qbase, qbase + 1, qbase + 2, qbase + 2, qbase + 3, qbase);
    b.vertexCount += 4;
  }
  void base;
}

function toGeometry(b: BufferBuilder): THREE.BufferGeometry | null {
  if (b.indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(b.normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uvs, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(b.colors, 3));
  geo.setIndex(b.indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Build opaque + transparent geometry for a chunk. `getBlockWorld` returns the
 * block id at world coordinates (0 = air for unloaded/out-of-range-above,
 * opaque for below the world floor).
 */
export function buildChunkGeometry(
  chunk: Chunk,
  getBlockWorld: (x: number, y: number, z: number) => BlockId,
): MeshResult {
  const opaque = newBuilder();
  const cutout = newBuilder();
  const transparent = newBuilder();
  const ox = chunk.originX;
  const oz = chunk.originZ;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = chunk.blocks[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x];
        if (id === 0) continue;
        const def = getBlock(id);
        const wx = ox + x;
        const wy = y;
        const wz = oz + z;
        // Plantlike decorations render as an X-cross in the cutout pass.
        if (def.shape === "plantlike") {
          pushCross(cutout, wx, wy, wz, def.tiles[2]);
          continue;
        }
        // Only water (liquids) uses the transparent pass/material. Leaves are
        // opaque-textured and render in the opaque pass for correct depth.
        const builder = def.liquid ? transparent : opaque;
        for (let f = 0; f < 6; f++) {
          const n = FACES[f].neighbor;
          const neighborId = getBlockWorld(wx + n[0], wy + n[1], wz + n[2]);
          if (!shouldRenderFace(id, neighborId)) continue;
          const isWaterTop = def.liquid && n[1] === 1;
          pushFace(builder, f, wx, wy, wz, def.tiles[f], FACE_BRIGHTNESS[f], isWaterTop);
        }
      }
    }
  }

  return {
    opaque: toGeometry(opaque),
    cutout: toGeometry(cutout),
    transparent: toGeometry(transparent),
  };
}

import { VertexData } from "@babylonjs/core";
import { CHUNK_SIZE, CHUNK_HEIGHT } from "../constants";
import type { BlockId, FaceDef } from "../types";
import { getBlock, MAX_LIQUID_LEVEL, FACE, type BlockDef } from "./Blocks";
import { tileUV } from "../engine/Textures";
import type { Chunk } from "./Chunk";
import { FACE_SHADE, PLANT_SHADE } from "./lighting/LightingConfig";

/**
 * Per-vertex light sample for the cell a face looks into. The world/lighting
 * system builds this; the mesher never hardcodes light behaviour — it only
 * supplies the directional face shade.
 *
 * Two shaded channels are baked into vertex-colour .r/.g (sun, block) and two
 * raw 0..1 levels into .b/.a for the debug overlay. The VoxelTerrainMaterial
 * combines them with live day/night uniforms, so torch (block) light survives
 * the night while outdoor (sun) light dims.
 */
export interface BrightnessSample {
  /** face shade × brightness-curve of the sun light level */
  sunBright: number;
  /** face shade × brightness-curve of the block (emissive) light level */
  blockBright: number;
  /** raw sun level / LIGHT_MAX (0..1) — debug overlay */
  sunLevel: number;
  /** raw block level / LIGHT_MAX (0..1) — debug overlay */
  blockLevel: number;
}

export type BrightnessSampler = (wx: number, wy: number, wz: number, shade: number) => BrightnessSample;

/** Per-voxel liquid level accessor (world coords; 0 for non-flowing). */
export type LevelSampler = (wx: number, wy: number, wz: number) => number;

// The six cube faces. Corner order + UVs are tuned so that triangles
// (0,1,2, 2,1,3) produce correctly-wound front faces. Order matches the
// FACE index in Blocks.ts: [PX, NX, PY, NY, PZ, NZ].
// The six cube faces. **Corner ordering convention**: for every face,
// corners 0 and 2 sit at the **top** (high Y, or the face's "up" axis for
// horizontal faces) and corners 1 and 3 sit at the **bottom**. This is what
// lets a single CORNER_UV table put the tile's canvas-top row at the top of
// every face. Triangles (0,1,2, 2,1,3) wound CCW from outside in the right-
// handed system. Order matches the FACE index in Blocks.ts:
// [PX, NX, PY, NY, PZ, NZ].
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
    // +Y (top) — both face axes horizontal; corner order still follows the
    // (top-left, bottom-left, top-right, bottom-right) convention so the
    // single CORNER_UV table works without special-casing.
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
    // +Z (front) — corners reordered so 0,2 are at high Y (top) and 1,3 are
    // at low Y (bottom). This is critical: without it, U and V end up mapped
    // to the wrong world axes (U to Y, V to X) and tile textures render
    // rotated 90° on these faces.
    normal: [0, 0, 1],
    neighbor: [0, 0, 1],
    corners: [
      [0, 1, 1],
      [0, 0, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    // -Z (back) — same corner-ordering convention as +Z.
    normal: [0, 0, -1],
    neighbor: [0, 0, -1],
    corners: [
      [1, 1, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
];

// Per-corner UV (in local 0..1 tile space). Corner index matches FACES order.
// V is intentionally inverted vs. the "obvious" mapping: with invertY=false
// on the atlas (which preserves the three.js flipY=false convention that the
// tileUV math depends on), UV.y=0 samples the canvas TOP row of the tile. So
// to put the canvas-top half of a tile (e.g. the grass strip on grass_side,
// the petals on a flower) at the TOP of each cube face / plant cross, the
// world-top corner must take V=0 and the world-bottom corner takes V=1.
const CORNER_UV: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
];

// Baked directional brightness per face index (matches FACE order
// [PX, NX, PY, NY, PZ, NZ]). Re-exported from LightingConfig so all light
// tunables live in one place.
const FACE_BRIGHTNESS = FACE_SHADE;

/** Returns true if a face between `self` and `neighbor` should be rendered. */
function shouldRenderFace(self: BlockId, neighbor: BlockId): boolean {
  if (neighbor === 0) return true; // air always shows the face
  const nb = getBlock(neighbor);
  if (nb.opaque) return false; // hidden by opaque neighbor
  // Transparent neighbor: render unless it's the same liquid family
  // (water-source / water-flowing share a face → cull). Other transparent
  // blocks (e.g. a plant next to water) still show the face.
  if (nb.liquid) return !isSameLiquid(self, neighbor);
  return getBlock(self).id !== nb.id;
}

/**
 * True if two blocks belong to the same liquid family (e.g. water source +
 * flowing water). Used to cull faces between adjacent water cells and to draw
 * "steps" between differing flowing levels instead of leaving gaps.
 */
function isSameLiquid(a: BlockId, b: BlockId): boolean {
  if (a === b) return true;
  const da = getBlock(a);
  const db = getBlock(b);
  if (!da.liquid || !db.liquid) return false;
  return da.liquidDef?.id === db.liquidDef?.id && da.liquidDef?.id !== undefined;
}

/** Render height (fraction of a block) for a liquid cell. */
function liquidTopFrac(def: BlockDef, level: number): number {
  if (def.liquidType === "source") return 0.9; // matches the pre-overfall surface dip
  const f = (level <= 0 ? 0 : level > MAX_LIQUID_LEVEL ? MAX_LIQUID_LEVEL : level) / (MAX_LIQUID_LEVEL + 1);
  // Keep a visible minimum so level-1 trickles still render.
  return f < 0.12 ? 0.12 : f;
}

export interface MeshResult {
  opaque: VertexData | null;
  cutout: VertexData | null;
  transparent: VertexData | null;
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
  sample: BrightnessSample,
  twoChannel: boolean,
  waterTop: boolean,
): void {
  const face = FACES[faceIndex];
  const uv = tileUV(tile);
  const du = uv.u1 - uv.u0;
  const dv = uv.v1 - uv.v0;
  const base = b.vertexCount;
  // All faces currently bake the same four-channel colour data
  // (r=shadedSun, g=shadedBlock, b=sunLevel, a=blockLevel) consumed by the
  // VoxelTerrainMaterial shader. The water (transparent) pass's colours are
  // discarded later (World strips them) since water uses a plain StandardMaterial.
  let cr: number, cg: number, cb: number, ca: number;
  if (twoChannel) {
    cr = sample.sunBright;
    cg = sample.blockBright;
    cb = sample.sunLevel;
    ca = sample.blockLevel;
  } else {
    const m = sample.sunBright >= sample.blockBright ? sample.sunBright : sample.blockBright;
    cr = cg = cb = m;
    ca = 1;
  }
  for (let c = 0; c < 4; c++) {
    const corner = face.corners[c];
    // Lower the entire water surface slightly so it reads as a fluid.
    const py = waterTop ? y + corner[1] - 0.1 : y + corner[1];
    b.positions.push(x + corner[0], py, z + corner[2]);
    b.normals.push(face.normal[0], face.normal[1], face.normal[2]);
    const cu = CORNER_UV[c];
    b.uvs.push(uv.u0 + cu[0] * du, uv.v0 + cu[1] * dv);
    b.colors.push(cr, cg, cb, ca);
  }
  b.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  b.vertexCount += 4;
}

/**
 * Push a liquid face whose vertical extent is mapped to a custom [bottom,top]
 * block fraction (0..1) rather than the full cube. This is what lets flowing
 * water render at partial height and lets "steps" between differing flowing
 * levels draw as exposed vertical strips.
 *
 * UVs are WORLD-SPACE (derived from each corner's world position + the face
 * normal), NOT atlas-tile UVs. This is critical for water: the shared surface
 * texture then maps continuously across the whole body (no per-block tiling
 * grid), and scrolling uOffset/vOffset on the material animates the entire
 * surface as one. The texture's uScale/vScale (+ WRAP) handle the repeat rate.
 */
function pushScaledFace(
  b: BufferBuilder,
  faceIndex: number,
  x: number,
  y: number,
  z: number,
  sample: BrightnessSample,
  bottomFrac: number,
  topFrac: number,
): void {
  const face = FACES[faceIndex];
  const nx = face.normal[0];
  const ny = face.normal[1];
  const base = b.vertexCount;
  // Water colours are stripped by World before upload (StandardMaterial
  // supplies a uniform tint + texture), but keep baking them so the buffer
  // shape is consistent with the terrain pass.
  const cr = sample.sunBright;
  const cg = sample.blockBright;
  const cb = sample.sunLevel;
  const ca = sample.blockLevel;
  for (let c = 0; c < 4; c++) {
    const corner = face.corners[c];
    // corner[1] is 0 (bottom) or 1 (top); map to the requested Y band.
    const fy = corner[1] === 1 ? topFrac : bottomFrac;
    const wx = x + corner[0];
    const wy = y + fy;
    const wz = z + corner[2];
    b.positions.push(wx, wy, wz);
    b.normals.push(nx, ny, face.normal[2]);
    // Pick the two in-plane world axes from the face normal so the surface
    // texture is continuous: Y-faces → (X,Z); X-faces → (Z,Y); Z-faces → (X,Y).
    let u: number;
    let v: number;
    if (ny !== 0) { u = wx; v = wz; }
    else if (nx !== 0) { u = wz; v = wy; }
    else { u = wx; v = wy; }
    b.uvs.push(u, v);
    b.colors.push(cr, cg, cb, ca);
  }
  b.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  b.vertexCount += 4;
}

/**
 * Build the water geometry for a single liquid cell (source or flowing).
 *
 *   • Top (+Y): drawn at the cell's surface height when the cell above is not
 *     the same liquid (air/solid lid → exposed surface). This is the primary
 *     visible surface.
 *   • Sides: drawn against non-water neighbours; between two water cells of
 *     differing level, only the exposed vertical strip (neighbourTop..top) is
 *     drawn so shorelines and waterfalls show clean steps with no gaps.
 *
 * Internal faces (between two cells of the SAME liquid + same level) are NOT
 * drawn — that is what makes a lake read as one continuous body instead of a
 * grid of glass cubes. Bottom faces are never drawn: they're always coplanar
 * with the terrain below (invisible + a z-fight source).
 *
 * Source cells render at a near-full height (0.9); flowing cells at level/(MAX+1).
 */
function pushLiquidCell(
  b: BufferBuilder,
  getBlockWorld: (x: number, y: number, z: number) => BlockId,
  getLevelWorld: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  def: BlockDef,
  level: number,
  sampleBrightness: BrightnessSampler,
  renderSides: boolean,
): void {
  const top = liquidTopFrac(def, level);
  const above = getBlockWorld(x, y + 1, z);

  // +Y top surface (only when not submerged under the same liquid). This is the
  // only face rendered for an interior source cell of a flat lake.
  if (!isSameLiquid(def.id, above)) {
    pushScaledFace(b, FACE.PY, x, y, z, sampleBrightness(x, y + 1, z, FACE_BRIGHTNESS[FACE.PY]), top, top);
  }

  if (!renderSides) return;

  // Horizontal faces: step against lower-level water, full against non-water.
  // Between equal-level same-liquid neighbours NOTHING is drawn (culled), which
  // is what removes the internal grid. Only shore/exposed/step faces render.
  const horiz: Array<[number, number, number, number]> = [
    [FACE.PX, x + 1, y, z],
    [FACE.NX, x - 1, y, z],
    [FACE.PZ, x, y, z + 1],
    [FACE.NZ, x, y, z - 1],
  ];
  for (const [fi, nx, ny, nz] of horiz) {
    const nid = getBlockWorld(nx, ny, nz);
    if (isSameLiquid(def.id, nid)) {
      const ndef = getBlock(nid);
      const nTop = liquidTopFrac(ndef, ndef.liquidType === "flowing" ? getLevelWorld(nx, ny, nz) : 0);
      if (nTop < top - 1e-3) {
        // Exposed step: strip from the neighbour's surface up to ours.
        pushScaledFace(b, fi, x, y, z, sampleBrightness(nx, ny, nz, FACE_BRIGHTNESS[fi]), nTop, top);
      }
    } else if (nid !== 0 && getBlock(nid).opaque) {
      // Hidden by opaque terrain — cull.
    } else {
      // Air / plant / different transparent — full side.
      pushScaledFace(b, fi, x, y, z, sampleBrightness(nx, ny, nz, FACE_BRIGHTNESS[fi]), 0, top);
    }
  }
}

// Two diagonal quads forming an "X" — the classic plantlike cross used for
// grass tufts, flowers and mushrooms. Rendered in the cutout pass.
function pushCross(b: BufferBuilder, x: number, y: number, z: number, tile: number, sample: BrightnessSample): void {
  const uv = tileUV(tile);
  const du = uv.u1 - uv.u0;
  const dv = uv.v1 - uv.v0;
  const base = b.vertexCount;
  const cr = sample.sunBright;
  const cg = sample.blockBright;
  const cb = sample.sunLevel;
  const ca = sample.blockLevel;
  // Quad A: diagonal plane through (0,0,0)-(1,1,1). V is swapped vs. the
  // positions so that Y=0 (bottom) samples V=v1 (canvas-bottom of the tile
  // = the stem) and Y=1 (top) samples V=v0 (canvas-top = petals/leaves).
  const a: Array<[number, number, number, number, number, number, number]> = [
    [0, 0, 0, uv.u0, uv.v1, -0.7071, 0.7071],
    [1, 0, 1, uv.u1, uv.v1, -0.7071, 0.7071],
    [1, 1, 1, uv.u1, uv.v0, -0.7071, 0.7071],
    [0, 1, 0, uv.u0, uv.v0, -0.7071, 0.7071],
  ];
  // Quad B: diagonal plane through (1,0,0)-(0,1,1). Same V swap.
  const c: Array<[number, number, number, number, number, number, number]> = [
    [1, 0, 0, uv.u0, uv.v1, 0.7071, 0.7071],
    [0, 0, 1, uv.u1, uv.v1, 0.7071, 0.7071],
    [0, 1, 1, uv.u1, uv.v0, 0.7071, 0.7071],
    [1, 1, 0, uv.u0, uv.v0, 0.7071, 0.7071],
  ];
  for (const quad of [a, c]) {
    const qbase = b.vertexCount;
    for (const p of quad) {
      b.positions.push(x + p[0], y + p[1], z + p[2]);
      b.normals.push(p[5], 0, p[6]);
      b.uvs.push(p[3], p[4]);
      b.colors.push(cr, cg, cb, ca);
    }
    b.indices.push(qbase, qbase + 1, qbase + 2, qbase + 2, qbase + 3, qbase);
    b.vertexCount += 4;
  }
  void base;
}

function toVertexData(b: BufferBuilder): VertexData | null {
  if (b.indices.length === 0) return null;
  const vd = new VertexData();
  vd.positions = new Float32Array(b.positions);
  vd.normals = new Float32Array(b.normals);
  vd.uvs = new Float32Array(b.uvs);
  vd.colors = new Float32Array(b.colors);
  vd.indices = new Uint32Array(b.indices);
  return vd;
}

/** Options for {@link buildChunkGeometry} (debug toggles threaded from World). */
export interface MeshOptions {
  /** When false, skip water side faces (top surface only) — debug isolation. */
  waterSides?: boolean;
}

/**
 * Build opaque + transparent geometry for a chunk. `getBlockWorld` returns the
 * block id at world coordinates (0 = air for unloaded/out-of-range-above,
 * opaque for below the world floor). `getLevelWorld` returns the per-voxel
 * liquid level (used for partial-height flowing water). `sampleBrightness`
 * returns the final vertex brightness (0..1) for the cell a face looks into,
 * given the face's directional shade — it encodes voxel light + day/night +
 * debug mode.
 */
export function buildChunkGeometry(
  chunk: Chunk,
  getBlockWorld: (x: number, y: number, z: number) => BlockId,
  getLevelWorld: (x: number, y: number, z: number) => number,
  sampleBrightness: BrightnessSampler,
  opts?: MeshOptions,
): MeshResult {
  const waterSides = opts?.waterSides ?? true;
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
        // They read the light of their own cell.
        if (def.shape === "plantlike") {
          const br = sampleBrightness(wx, wy, wz, PLANT_SHADE);
          pushCross(cutout, wx, wy, wz, def.tiles[2], br);
          continue;
        }
        // Liquids (water source + flowing) use the transparent pass with
        // partial-height geometry and stepped shorelines.
        if (def.liquid) {
          const level = chunk.getLocalLevel(x, y, z);
          pushLiquidCell(transparent, getBlockWorld, getLevelWorld, wx, wy, wz, def, level, sampleBrightness, waterSides);
          continue;
        }
        // Opaque cubes (terrain, leaves, ores, …).
        for (let f = 0; f < 6; f++) {
          const n = FACES[f].neighbor;
          const nwx = wx + n[0];
          const nwy = wy + n[1];
          const nwz = wz + n[2];
          const neighborId = getBlockWorld(nwx, nwy, nwz);
          if (!shouldRenderFace(id, neighborId)) continue;
          // Face brightness comes from the light of the cell the face is
          // exposed to (the neighbour air/space), combined with face shade.
          const sample = sampleBrightness(nwx, nwy, nwz, FACE_BRIGHTNESS[f]);
          pushFace(opaque, f, wx, wy, wz, def.tiles[f], sample, true, false);
        }
      }
    }
  }

  return {
    opaque: toVertexData(opaque),
    cutout: toVertexData(cutout),
    transparent: toVertexData(transparent),
  };
}

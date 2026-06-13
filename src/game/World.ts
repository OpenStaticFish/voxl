import {
  Color3,
  Material,
  Mesh,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  VertexData,
} from "@babylonjs/core";
import { CHUNK_SIZE, CHUNK_HEIGHT, MAX_CHUNK_GEN_PER_FRAME, MAX_CHUNK_MESH_PER_FRAME } from "../constants";
import type { BlockId } from "../types";
import { Chunk } from "./Chunk";
import { buildChunkGeometry } from "./ChunkMesher";
import { TerrainGenerator, findGroundY } from "./TerrainGenerator";

function key(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

interface ChunkMeshes {
  opaque?: Mesh;
  cutout?: Mesh;
  transparent?: Mesh;
}

/**
 * Owns all chunks, their data, their meshes, and the streaming/meshing
 * pipeline. Materials are shared across chunks; per-chunk meshes are created
 * from the mesher's VertexData and disposed on unload/remesh.
 */
export class World {
  readonly root: TransformNode;
  readonly opaqueMaterial: StandardMaterial;
  readonly cutoutMaterial: StandardMaterial;
  readonly waterMaterial: StandardMaterial;
  readonly generator: TerrainGenerator;
  /** Atlas must have hasAlpha=true for the cutout pass to alpha-test. */
  readonly atlasHasAlpha: boolean;

  private readonly scene: Scene;
  private readonly chunks = new Map<string, Chunk>();
  private readonly meshes = new Map<string, ChunkMeshes>();
  private spiralCache = new Map<number, Array<{ dx: number; dz: number; d: number }>>();

  constructor(seed: string, atlas: Texture, scene: Scene) {
    this.scene = scene;
    this.root = new TransformNode("world-root", scene);
    this.generator = new TerrainGenerator(seed);

    // The atlas uses clearRect for plantlike tiles; we need alpha for cutout.
    // Mark hasAlpha once so the cutout material can alpha-test against it.
    atlas.hasAlpha = true;
    this.atlasHasAlpha = true;

    // Opaque pass: textured + vertex-coloured, no specular (Lambert-like).
    // (Babylon applies vertex colors automatically when the mesh has a color
    // vertex buffer, so no useVertexColor flag is needed.)
    // Explicit MATERIAL_OPAQUE ensures the texture's alpha channel is ignored
    // even though we set hasAlpha=true above (shared atlas).
    this.opaqueMaterial = new StandardMaterial("voxel-opaque", scene);
    this.opaqueMaterial.diffuseTexture = atlas;
    this.opaqueMaterial.specularColor = new Color3(0, 0, 0);
    this.opaqueMaterial.useAlphaFromDiffuseTexture = false;
    this.opaqueMaterial.backFaceCulling = false;
    this.opaqueMaterial.transparencyMode = Material.MATERIAL_OPAQUE;

    // Cutout pass: plantlike decorations (alpha-tested, double-sided).
    // MATERIAL_ALPHATEST hard-cuts fragments below alphaCutOff without
    // blending — exactly the prior three.js alphaTest behaviour.
    this.cutoutMaterial = new StandardMaterial("voxel-cutout", scene);
    this.cutoutMaterial.diffuseTexture = atlas;
    this.cutoutMaterial.specularColor = new Color3(0, 0, 0);
    this.cutoutMaterial.useAlphaFromDiffuseTexture = true;
    this.cutoutMaterial.alphaCutOff = 0.5;
    this.cutoutMaterial.backFaceCulling = false;
    this.cutoutMaterial.transparencyMode = Material.MATERIAL_ALPHATEST;

    // Transparent pass: water (alpha-blended, no depth write, double-sided).
    // MATERIAL_ALPHABLEND uses material.alpha as a uniform opacity.
    this.waterMaterial = new StandardMaterial("voxel-water", scene);
    this.waterMaterial.diffuseTexture = atlas;
    this.waterMaterial.specularColor = new Color3(0, 0, 0);
    this.waterMaterial.alpha = 0.72;
    this.waterMaterial.backFaceCulling = false;
    this.waterMaterial.disableDepthWrite = true;
    this.waterMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  }

  private spiral(radius: number): Array<{ dx: number; dz: number; d: number }> {
    const cached = this.spiralCache.get(radius);
    if (cached) return cached;
    const list: Array<{ dx: number; dz: number; d: number }> = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        list.push({ dx, dz, d: dx * dx + dz * dz });
      }
    }
    list.sort((a, b) => a.d - b.d);
    this.spiralCache.set(radius, list);
    return list;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(key(cx, cz));
  }

  /** Read a block at world coords. Unloaded chunks read as air. */
  getBlock(wx: number, wy: number, wz: number): BlockId {
    if (wy < 0) return 3; // treat below world as opaque (cull bottom faces)
    if (wy >= CHUNK_HEIGHT) return 0; // above world is air
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(key(cx, cz));
    if (!chunk) return 0;
    return chunk.getLocal(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE);
  }

  /** Edit a block. Returns true if the world changed. */
  setBlock(wx: number, wy: number, wz: number, id: BlockId): boolean {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(key(cx, cz));
    if (!chunk) return false;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const changed = chunk.setLocal(lx, wy, lz, id);
    if (!changed) return false;
    // Remesh this chunk, plus neighbors if the edit was on a border (their
    // border faces may need to appear/disappear).
    chunk.dirty = true;
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    this.rebuildMesh(chunk);
    return true;
  }

  private markDirty(cx: number, cz: number): void {
    const chunk = this.chunks.get(key(cx, cz));
    if (chunk && chunk.generated) chunk.dirty = true;
  }

  /** Highest non-air, non-water block at a column (for spawn placement). */
  groundHeight(wx: number, wz: number): number {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.ensureGenerated(cx, cz);
    return findGroundY(chunk, wx - cx * CHUNK_SIZE, wz - cz * CHUNK_SIZE);
  }

  /** Ensure a chunk exists and is generated (used for spawn lookups). */
  ensureGenerated(cx: number, cz: number): Chunk {
    let chunk = this.chunks.get(key(cx, cz));
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(key(cx, cz), chunk);
    }
    if (!chunk.generated) {
      this.generator.generate(chunk);
      // Mark already-meshed neighbors dirty so shared borders remesh correctly.
      this.markDirty(cx - 1, cz);
      this.markDirty(cx + 1, cz);
      this.markDirty(cx, cz - 1);
      this.markDirty(cx, cz + 1);
    }
    return chunk;
  }

  /** Per-frame streaming: generate + mesh chunks around the player. */
  update(playerX: number, playerZ: number, viewDistance: number): void {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);
    const order = this.spiral(viewDistance);

    let genBudget = MAX_CHUNK_GEN_PER_FRAME;
    let meshBudget = MAX_CHUNK_MESH_PER_FRAME;

    // Generate missing chunks (closest first), respecting the budget.
    for (const off of order) {
      if (genBudget <= 0) break;
      const cx = pcx + off.dx;
      const cz = pcz + off.dz;
      const k = key(cx, cz);
      let chunk = this.chunks.get(k);
      if (!chunk) {
        chunk = new Chunk(cx, cz);
        this.chunks.set(k, chunk);
      }
      if (!chunk.generated) {
        this.generator.generate(chunk);
        this.markDirty(cx - 1, cz);
        this.markDirty(cx + 1, cz);
        this.markDirty(cx, cz - 1);
        this.markDirty(cx, cz + 1);
        genBudget--;
      }
    }

    // Mesh dirty chunks (closest first), respecting the budget.
    for (const off of order) {
      if (meshBudget <= 0) break;
      const cx = pcx + off.dx;
      const cz = pcz + off.dz;
      const chunk = this.chunks.get(key(cx, cz));
      if (chunk && chunk.generated && chunk.dirty) {
        this.rebuildMesh(chunk);
        meshBudget--;
      }
    }

    // Unload chunks far outside the view distance.
    const unload = viewDistance + 2;
    const unloadSq = unload * unload;
    for (const [k, chunk] of this.chunks) {
      const ddx = chunk.cx - pcx;
      const ddz = chunk.cz - pcz;
      if (ddx * ddx + ddz * ddz > unloadSq) {
        this.disposeMeshes(k);
        this.chunks.delete(k);
      }
    }
  }

  private rebuildMesh(chunk: Chunk): void {
    const result = buildChunkGeometry(chunk, (x, y, z) => this.getBlock(x, y, z));
    const k = key(chunk.cx, chunk.cz);
    const existing = this.meshes.get(k);

    // Opaque
    this.applyMesh(k, "opaque", result.opaque, this.opaqueMaterial, existing);
    // Cutout (plantlike decorations)
    this.applyMesh(k, "cutout", result.cutout, this.cutoutMaterial, existing);
    // Transparent (water)
    this.applyMesh(k, "transparent", result.transparent, this.waterMaterial, existing);

    chunk.dirty = false;
  }

  private applyMesh(
    k: string,
    slot: "opaque" | "cutout" | "transparent",
    vd: VertexData | null,
    material: Material,
    _existing: ChunkMeshes | undefined,
  ): void {
    let entry = this.meshes.get(k);
    if (!entry) {
      entry = {};
      this.meshes.set(k, entry);
    }
    const prev = entry[slot];
    if (prev) {
      prev.dispose();
      entry[slot] = undefined;
    }
    if (vd) {
      const mesh = new Mesh(`voxel-${slot}-${k}`, this.scene);
      mesh.material = material;
      mesh.parent = this.root;
      mesh.isPickable = false;
      vd.applyToMesh(mesh, false);
      entry[slot] = mesh;
    }
  }

  private disposeMeshes(k: string): void {
    const entry = this.meshes.get(k);
    if (!entry) return;
    for (const slot of ["opaque", "cutout", "transparent"] as const) {
      const m = entry[slot];
      if (m) m.dispose();
    }
    this.meshes.delete(k);
  }

  /** Total loaded chunk count (for HUD/diagnostics). */
  get chunkCount(): number {
    return this.chunks.size;
  }

  dispose(): void {
    for (const k of [...this.meshes.keys()]) this.disposeMeshes(k);
    this.chunks.clear();
    this.opaqueMaterial.dispose();
    this.cutoutMaterial.dispose();
    this.waterMaterial.dispose();
    this.root.dispose();
  }
}

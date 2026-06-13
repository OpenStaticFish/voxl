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
import { buildChunkGeometry, type BrightnessSampler } from "./ChunkMesher";
import { TerrainGenerator, findGroundY } from "./TerrainGenerator";
import { VoxelLightEngine, lightKey } from "./lighting/VoxelLightEngine";
import {
  LIGHT_MAX,
  MAX_CHUNK_LIGHT_PER_FRAME,
  combineLight,
  lightToBrightness,
  type LightDebugMode,
} from "./lighting/LightingConfig";

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

  /** Voxel light field (sun + block light per chunk). Drives mesh brightness. */
  readonly lighting = new VoxelLightEngine((x, y, z) => this.getBlock(x, y, z));
  /** Chunks whose lighting must be recomputed before they (re)mesh. */
  private readonly lightDirty = new Set<string>();
  /** Active light debug overlay (changes the mesh brightness sampler). */
  private lightDebugMode: LightDebugMode = "off";

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
    // Re-light the edited chunk (and queue neighbours — a changed cell can
    // alter light several blocks away). Relighting marks the chunk dirty if any
    // light value changed, which triggers a remesh below.
    this.relightChunkNow(chunk, true);
    // Remesh this chunk, plus neighbours if the edit was on a border (their
    // border faces / lighting may need to update).
    chunk.dirty = true;
    if (lx === 0) this.queueNeighbourLight(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.queueNeighbourLight(cx + 1, cz);
    if (lz === 0) this.queueNeighbourLight(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.queueNeighbourLight(cx, cz + 1);
    this.rebuildMesh(chunk);
    return true;
  }

  private markDirty(cx: number, cz: number): void {
    const chunk = this.chunks.get(key(cx, cz));
    if (chunk && chunk.generated) chunk.dirty = true;
  }

  // --------------------------------------------------------- lighting ---

  /**
   * Per-vertex brightness sampler handed to the mesher. Combines the sun + block
   * light of the sampled cell with the face's directional shade. In a debug
   * overlay mode it returns a raw channel value (grayscale) instead.
   *
   * Sun light is baked at full day strength (sunFactor = 1); the day/night
   * dimming is applied globally via Babylon light intensities so we never have
   * to rebuild every mesh as the sun moves.
   */
  private readonly sampleBrightness: BrightnessSampler = (wx, wy, wz, shade) => {
    const sun = this.lighting.getSun(wx, wy, wz);
    const block = this.lighting.getBlockLight(wx, wy, wz);
    switch (this.lightDebugMode) {
      case "sun":
        return sun / LIGHT_MAX;
      case "block":
        return block / LIGHT_MAX;
      case "combined":
        return combineLight(sun, block, 1) / LIGHT_MAX;
      default:
        return shade * lightToBrightness(combineLight(sun, block, 1));
    }
  };

  /**
   * Synchronously re-light `chunk` now. When `markNeighboursAlways` is set
   * (chunk just generated) the 4 neighbours are queued for re-light so they
   * pick up the new boundary light; otherwise neighbours are only queued when a
   * border value actually changed.
   */
  private relightChunkNow(chunk: Chunk, markNeighboursAlways: boolean): void {
    const result = this.lighting.relightChunk(chunk);
    if (result.changed) chunk.dirty = true;
    if (markNeighboursAlways || result.borderChanged) {
      this.queueNeighbourLight(chunk.cx - 1, chunk.cz);
      this.queueNeighbourLight(chunk.cx + 1, chunk.cz);
      this.queueNeighbourLight(chunk.cx, chunk.cz - 1);
      this.queueNeighbourLight(chunk.cx, chunk.cz + 1);
    }
  }

  /** Queue a chunk (and mark it remesh-dirty) for re-lighting if generated. */
  private queueNeighbourLight(cx: number, cz: number): void {
    const chunk = this.chunks.get(key(cx, cz));
    if (chunk && chunk.generated) this.lightDirty.add(key(cx, cz));
  }

  /**
   * Drain the light-dirty queue with a per-frame budget. Each re-lit chunk may
   * queue its neighbours (only when a border value changed), so light updates
   * ripple outward and converge in a few frames rather than in one big stall.
   */
  private processLightDirty(budget: number): void {
    if (this.lightDirty.size === 0) return;
    let remaining = budget;
    // Snapshot so we can safely add to the set while iterating.
    const batch = [...this.lightDirty];
    this.lightDirty.clear();
    for (const k of batch) {
      if (remaining <= 0) {
        // Re-queue for next frame (keep closest-first ordering loosely).
        this.lightDirty.add(k);
        continue;
      }
      const chunk = this.chunks.get(k);
      if (!chunk || !chunk.generated) continue;
      this.relightChunkNow(chunk, false);
      remaining--;
    }
  }

  /** Switch the light debug overlay; rebuilds meshes so the change is visible. */
  setLightDebugMode(mode: LightDebugMode): void {
    if (this.lightDebugMode === mode) return;
    this.lightDebugMode = mode;
    for (const chunk of this.chunks.values()) {
      if (chunk.generated) chunk.dirty = true;
    }
  }

  getLightDebugMode(): LightDebugMode {
    return this.lightDebugMode;
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
      // Light the new chunk immediately so spawn-area meshes are correct.
      this.relightChunkNow(chunk, true);
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
        // Light the freshly generated chunk before it can be meshed, and queue
        // neighbours so seams stay correct as chunks stream in.
        this.relightChunkNow(chunk, true);
        this.markDirty(cx - 1, cz);
        this.markDirty(cx + 1, cz);
        this.markDirty(cx, cz - 1);
        this.markDirty(cx, cz + 1);
        genBudget--;
      }
    }

    // Propagate queued light updates (closest-first budget) BEFORE meshing so
    // meshes always read fresh light values.
    this.processLightDirty(MAX_CHUNK_LIGHT_PER_FRAME);

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
        this.lighting.removeLight(chunk.cx, chunk.cz);
        this.lightDirty.delete(k);
      }
    }
  }

  private rebuildMesh(chunk: Chunk): void {
    const result = buildChunkGeometry(
      chunk,
      (x, y, z) => this.getBlock(x, y, z),
      this.sampleBrightness,
    );
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
      // Opaque/cutout terrain receives Babylon shadow mapping; water does not
      // (it's alpha-blended + depth-write-disabled, shadows would look wrong).
      mesh.receiveShadows = slot !== "transparent";
      vd.applyToMesh(mesh, false);
      entry[slot] = mesh;
    }
  }

  /**
   * Iterate every loaded chunk's opaque mesh + chunk coords. Used by the shadow
   * manager to keep the shadow render list limited to nearby casters.
   */
  forEachOpaqueMesh(cb: (cx: number, cz: number, mesh: Mesh) => void): void {
    for (const [k, entry] of this.meshes) {
      const m = entry.opaque;
      if (!m) continue;
      const comma = k.indexOf(",");
      const cx = parseInt(k.slice(0, comma), 10);
      const cz = parseInt(k.slice(comma + 1), 10);
      cb(cx, cz, m);
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

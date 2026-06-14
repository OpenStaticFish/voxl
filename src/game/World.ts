import {
  AbstractMesh,
  Color3,
  Material,
  Mesh,
  Scene,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { CHUNK_SIZE, CHUNK_HEIGHT, MAX_CHUNK_GEN_PER_FRAME, MAX_CHUNK_MESH_PER_FRAME } from "../constants";
import type { BlockId } from "../types";
import { Chunk } from "./Chunk";
import { buildChunkGeometry } from "./ChunkMesher";
import { TerrainGenerator, findGroundY } from "./TerrainGenerator";
import { VoxelLightEngine, lightKey } from "./lighting/VoxelLightEngine";
import { VoxelTerrainMaterial } from "./lighting/VoxelTerrainMaterial";
import { WaterMaterial } from "./lighting/WaterMaterial";
import {
  LIGHT_MAX,
  MAX_CHUNK_LIGHT_PER_FRAME,
  lightToBrightness,
  type LightDebugMode,
} from "./lighting/LightingConfig";
import type { FoliageDensity, WaterQuality } from "./graphics/GraphicsSettings";
import { dbg } from "../state/Debug";
import { WATER_BLOCK } from "./Blocks";

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
  /**
   * Two terrain material instances sharing one shader. Both are currently
   * DOUBLE-SIDED (back-face culling OFF): an earlier attempt enabled culling on
   * the opaque pass, but this mesher's face winding does not match Babylon's
   * front-face convention, so culling removed visible faces and punched holes
   * through the terrain. Culling stays off until the winding is fixed; a debug
   * toggle (`__voxl.terrainCulling(on)`) re-enables it for testing.
   *   - {@link terrainOpaque} — terrain cube faces.
   *   - {@link terrainCutout} — plant crosses (must be double-sided anyway).
   * Day/night + fog + debug uniforms are forwarded to BOTH each frame.
   */
  readonly terrainOpaque: VoxelTerrainMaterial;
  readonly terrainCutout: VoxelTerrainMaterial;
  /** Animated water shader (shared). {@link waterMaterial} exposes the raw material. */
  readonly waterShader: WaterMaterial;
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
  /** Active light debug overlay (applied as a material uniform — no remesh). */
  private lightDebugMode: LightDebugMode = "off";

  /**
   * Debug: when false, all water (transparent) meshes are hidden. Use to
   * confirm whether a suspect patch is the water layer. Read at mesh creation;
   * toggling also updates existing meshes via {@link setWaterEnabled}.
   */
  private waterEnabled = true;

  /**
   * Debug: when true, all chunk meshes get `alwaysSelectAsActiveMesh = true` so
   * Babylon never frustum-culls them — useful to confirm whether missing terrain
   * is a culling issue. Read at mesh creation; toggling also updates existing
   * meshes via {@link setRenderAllChunks}.
   */
  private forceRenderAll = false;

  // --- Graphics-quality state (driven by GraphicsController, render-time only;
  //     never changes world generation, so worlds stay deterministic). ---
  /** Current water quality tier. */
  private waterQuality: WaterQuality = "medium";
  /**
   * Max distance (blocks) at which plantlike (cutout) meshes are drawn. Beyond
   * this, chunk cutout meshes are hidden to save fill/cutout-fragment cost.
   * Foliage density is controlled purely at draw time (no generation change).
   */
  private foliageCutoutDistance = Infinity;

  constructor(seed: string, atlas: Texture, scene: Scene) {
    this.scene = scene;
    this.root = new TransformNode("world-root", scene);
    this.generator = new TerrainGenerator(seed);

    // The atlas uses clearRect for plantlike tiles; we need alpha for cutout.
    atlas.hasAlpha = true;
    this.atlasHasAlpha = true;

    // Custom terrain shader for opaque + cutout passes. Both share one material
    // instance: opaque tiles have alpha=1 (never discarded), plant tiles have
    // alpha=0 backgrounds (discarded by the alpha test), so a single 0.5 cutoff
    // handles both cube faces and the plantlike X-cross.
    // Two terrain material instances sharing one shader. NOTE: both are
    // DOUBLE-SIDED (back-face culling OFF). A previous change enabled culling on
    // the opaque pass for fragment savings, but this scene's face winding does
    // NOT match Babylon's front-face convention, so culling removed visible
    // faces and produced massive sky-coloured holes through the terrain.
    // Culling is therefore OFF until the winding is explicitly verified; a debug
    // toggle (`__voxl.terrainCulling(on)`) lets you experiment safely.
    this.terrainOpaque = new VoxelTerrainMaterial(scene, { texture: atlas, alphaCutOff: 0.5, doubleSided: true });
    this.terrainCutout = new VoxelTerrainMaterial(scene, { texture: atlas, alphaCutOff: 0.5, doubleSided: true });

    // Transparent pass: animated water shader (alpha-blended, no depth write,
    // double-sided). Day/night + fog are pushed each frame by LightingSystem.
    this.waterShader = new WaterMaterial(scene, { texture: atlas });
  }

  /** The opaque ShaderMaterial (shared, back-face culled). */
  get opaqueMaterial(): Material { return this.terrainOpaque.material; }
  /** The cutout ShaderMaterial (shared, double-sided for plant crosses). */
  get cutoutMaterial(): Material { return this.terrainCutout.material; }
  /** The raw water Babylon material (shared). */
  get waterMaterial(): Material { return this.waterShader.material; }

  // -- Terrain lighting/debug forwarding: push uniforms to BOTH terrain
  //    materials so the opaque + cutout passes stay in lock-step. --

  /** Live day/night state for both terrain passes (call every frame). */
  setTerrainDayNight(dayFactor: number, moonFloor: number): void {
    this.terrainOpaque.setDayNight(dayFactor, moonFloor);
    this.terrainCutout.setDayNight(dayFactor, moonFloor);
  }

  /** Fog + camera for both terrain passes (call every frame). */
  setTerrainFog(cameraPosition: Vector3, color: Color3, start: number, end: number): void {
    this.terrainOpaque.setFog(cameraPosition, color, start, end);
    this.terrainCutout.setFog(cameraPosition, color, start, end);
  }

  /** Debug overlay mode for both terrain passes (no remesh). */
  private setTerrainDebugMode(code: number, tint: Color3): void {
    this.terrainOpaque.setDebugMode(code, tint);
    this.terrainCutout.setDebugMode(code, tint);
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
   * Per-vertex light sample handed to the mesher. Bakes the sun + block light
   * of the sampled cell (times the face shade and brightness curve) into two
   * channels, plus the raw 0..1 levels for the debug overlay.
   *
   * Sun light is baked at FULL day strength here; the actual day/night dimming
   * is applied later in the VoxelTerrainMaterial shader via the `uDayFactor`
   * uniform — so the clock can sweep a whole day without rebuilding any mesh.
   */
  private readonly sampleBrightness = (wx: number, wy: number, wz: number, shade: number) => {
    const sun = this.lighting.getSun(wx, wy, wz);
    const block = this.lighting.getBlockLight(wx, wy, wz);
    return {
      sunBright: shade * lightToBrightness(sun),
      blockBright: shade * lightToBrightness(block),
      sunLevel: sun / LIGHT_MAX,
      blockLevel: block / LIGHT_MAX,
    };
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

  /**
   * Switch the light debug overlay. This is a shader uniform on the terrain
   * material (the raw levels are already baked into vertex-colour .ba), so it
   * toggles instantly with NO chunk remesh.
   */
  setLightDebugMode(mode: LightDebugMode): void {
    this.lightDebugMode = mode;
    const code = mode === "sun" ? 1 : mode === "block" ? 2 : mode === "combined" ? 3 : 0;
    const tint =
      mode === "sun" ? new Color3(1.0, 0.85, 0.4) :
      mode === "block" ? new Color3(1.0, 0.7, 0.35) :
      new Color3(1, 1, 1);
    this.setTerrainDebugMode(code, tint);
  }

  getLightDebugMode(): LightDebugMode {
    return this.lightDebugMode;
  }

  /** Number of chunks queued for re-lighting (debug overlay). */
  get lightDirtyCount(): number {
    return this.lightDirty.size;
  }

  /** Set the water quality tier (applied to the shared water material). */
  setWaterQuality(quality: WaterQuality): void {
    this.waterQuality = quality;
    this.applyWaterQuality();
  }

  get currentWaterQuality(): WaterQuality {
    return this.waterQuality;
  }

  /**
   * Apply the water tier to the shared water material. Centralised so the water
   * upgrade and a world recreate both call it. The full animated shader is
   * layered on top in the water-rendering pass; here we keep a sensible baseline
   * on the existing material so all tiers render correctly from the start.
   */
  private applyWaterQuality(): void {
    this.waterShader.setQuality(this.waterQuality);
  }

  /** Set the foliage (cutout) render-distance tier. Draw-time only. */
  setFoliageDensity(density: FoliageDensity): void {
    this.foliageCutoutDistance = density === "low" ? 48 : density === "medium" ? 96 : Infinity;
  }

  /**
   * Snapshot of chunk streaming state for the performance overlay. `active` is
   * the set of meshes Babylon considers visible this frame (from
   * scene.getActiveMeshes()); we count a chunk as visible if any of its meshes
   * is in that set.
   */
  chunkStats(active: Set<AbstractMesh>): { loaded: number; meshed: number; dirty: number; visible: number } {
    let meshed = 0;
    let visible = 0;
    let dirty = 0;
    for (const entry of this.meshes.values()) {
      if (entry.opaque || entry.cutout || entry.transparent) meshed++;
      if (
        (entry.opaque !== undefined && active.has(entry.opaque)) ||
        (entry.cutout !== undefined && active.has(entry.cutout)) ||
        (entry.transparent !== undefined && active.has(entry.transparent))
      ) {
        visible++;
      }
    }
    for (const chunk of this.chunks.values()) if (chunk.dirty) dirty++;
    return { loaded: this.chunks.size, meshed, dirty, visible };
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

  /**
   * Per-frame streaming: generate + mesh chunks around the player.
   *
   * `frameMs` (last frame time) drives adaptive budgets: when the frame is
   * healthy we allow extra catch-up work, when it stutters we throttle to the
   * minimum so chunk gen/remesh never compounds a frame spike. This keeps frame
   * pacing stable while flying across chunk boundaries.
   */
  update(playerX: number, playerZ: number, viewDistance: number, frameMs = 16): void {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);
    const order = this.spiral(viewDistance);

    // Adaptive budget factor from the last frame time:
    //   ≤16ms (60fps): 1.5× — catch up faster when there's headroom
    //   ≤22ms (~45fps): 1.0× — baseline
    //   ≤35ms (~28fps): 0.5× — ease off
    //   >35ms:          0.25× — barely trickle, don't add to the stall
    const f = frameMs <= 16 ? 1.5 : frameMs <= 22 ? 1 : frameMs <= 35 ? 0.5 : 0.25;
    let genBudget = Math.max(1, Math.round(MAX_CHUNK_GEN_PER_FRAME * f));
    let meshBudget = Math.max(1, Math.round(MAX_CHUNK_MESH_PER_FRAME * f));
    const lightBudget = Math.max(1, Math.round(MAX_CHUNK_LIGHT_PER_FRAME * f));

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
    this.processLightDirty(lightBudget);

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

    // Foliage (cutout) render-distance cull: hide plantlike meshes beyond the
    // configured distance so grass/flowers don't cost fill rate at range. This
    // is a draw-time decision only — chunks stay fully generated/deterministic.
    const cutDist = this.foliageCutoutDistance;
    if (cutDist !== Infinity) {
      const cutSq = cutDist * cutDist;
      for (const [mk, entry] of this.meshes) {
        const m = entry.cutout;
        if (!m) continue;
        const comma = mk.indexOf(",");
        const cx = parseInt(mk.slice(0, comma), 10);
        const cz = parseInt(mk.slice(comma + 1), 10);
        const dx = cx * 16 + 8 - playerX;
        const dz = cz * 16 + 8 - playerZ;
        m.setEnabled(dx * dx + dz * dz <= cutSq);
      }
    } else {
      // Ensure all cutout meshes are enabled when set back to full distance.
      for (const entry of this.meshes.values()) {
        if (entry.cutout && !entry.cutout.isEnabled()) entry.cutout.setEnabled(true);
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
    dbg(
      "rebuildMesh",
      k,
      "opaque=" + (result.opaque ? "y" : "n"),
      "cutout=" + (result.cutout ? "y" : "n"),
      "water=" + (result.transparent ? "y" : "n"),
    );

    // The water (transparent) pass uses a StandardMaterial with a UNIFORM blue
    // tint + scene lights/fog. Strip its baked vertex colours so per-chunk
    // voxel-light values can't modulate the surface — otherwise relight
    // differences between neighbouring chunks show up as a grid of seams across
    // a lake. With no colour kind, the material supplies one continuous tint.
    if (result.transparent) result.transparent.colors = null;

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
      dbg("disposeMesh", slot, k);
      prev.dispose();
      entry[slot] = undefined;
    }
    if (vd) {
      const mesh = new Mesh(`voxel-${slot}-${k}`, this.scene);
      mesh.material = material;
      mesh.parent = this.root;
      mesh.isPickable = false;
      // Terrain uses a custom shader (no Babylon shadow receiving); water is
      // alpha-blended. Either way, nothing here receives Babylon shadow maps.
      mesh.receiveShadows = false;
      vd.applyToMesh(mesh, false);
      // Debug: optionally bypass frustum culling for every chunk mesh.
      mesh.alwaysSelectAsActiveMesh = this.forceRenderAll;
      // The water (transparent) pass uses a StandardMaterial with a uniform blue
      // tint; disable the mesh's baked vertex colours so they can't darken it.
      if (slot === "transparent") {
        mesh.useVertexColors = false;
        mesh.setEnabled(this.waterEnabled);
      }
      // Chunk geometry lives in world space (vertices include the chunk origin)
      // and the world root never moves, so the world matrix is constant. Freeze
      // it once: Babylon skips the per-frame parent×local matrix multiply for
      // every static chunk mesh — a large saving with hundreds of chunks.
      mesh.freezeWorldMatrix();
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

  /**
   * Iterate every loaded chunk's grid coordinates (regardless of mesh state).
   * Used by the chunk-border debug overlay to show the loaded-chunk footprint.
   */
  forEachChunkCoord(cb: (cx: number, cz: number) => void): void {
    for (const chunk of this.chunks.values()) cb(chunk.cx, chunk.cz);
  }

  /**
   * Debug: toggle forced rendering of every chunk mesh (bypass frustum culling).
   * Updates existing meshes and the flag read at mesh creation.
   */
  setRenderAllChunks(on: boolean): void {
    this.forceRenderAll = on;
    for (const entry of this.meshes.values()) {
      for (const slot of ["opaque", "cutout", "transparent"] as const) {
        const m = entry[slot];
        if (m) m.alwaysSelectAsActiveMesh = on;
      }
    }
  }

  /**
   * Debug: show/hide the entire water layer (all transparent meshes). Use to
   * isolate whether a patch is the water surface vs the terrain beneath.
   */
  setWaterEnabled(on: boolean): void {
    this.waterEnabled = on;
    for (const entry of this.meshes.values()) {
      const m = entry.transparent;
      if (m) m.setEnabled(on);
    }
  }

  /**
   * Debug: dump every chunk mesh's name, material name, and triangle count to
   * the console — for correlating a visible patch with the mesh/material that
   * produces it.
   */
  dumpChunkMaterials(): void {
    for (const [k, entry] of this.meshes) {
      for (const slot of ["opaque", "cutout", "transparent"] as const) {
        const m = entry[slot];
        if (!m) continue;
        const vd = m.getVerticesData?.("position");
        dbg(slot, k, "mat=" + (m.material?.name ?? "null"), "verts=" + (vd ? vd.length / 3 : 0));
      }
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

  /** Number of chunk entries with a transparent (water) mesh — cheap diagnostic. */
  get waterMeshCount(): number {
    let n = 0;
    for (const entry of this.meshes.values()) if (entry.transparent) n++;
    return n;
  }

  /**
   * Full water audit (for the console `__voxl.waterStats()` only — iterates
   * every loaded block, so do not call per-frame). Reports how many loaded
   * chunks contain water and the total water block count, to confirm the world
   * actually generated oceans/lakes near the player.
   */
  waterStats(): { chunksWithWater: number; waterBlocks: number; loaded: number } {
    let chunksWithWater = 0;
    let waterBlocks = 0;
    for (const chunk of this.chunks.values()) {
      let local = 0;
      const b = chunk.blocks;
      for (let i = 0; i < b.length; i++) if (b[i] === WATER_BLOCK) local++;
      if (local > 0) { chunksWithWater++; waterBlocks += local; }
    }
    return { chunksWithWater, waterBlocks, loaded: this.chunks.size };
  }

  dispose(): void {
    for (const k of [...this.meshes.keys()]) this.disposeMeshes(k);
    this.chunks.clear();
    this.lightDirty.clear();
    this.lighting.dispose();
    this.terrainOpaque.dispose();
    this.terrainCutout.dispose();
    this.waterShader.dispose();
    this.root.dispose();
  }
}

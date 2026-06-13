import { DirectionalLight, Mesh, ShadowGenerator } from "@babylonjs/core";
import type { World } from "../World";
import { type ShadowConfig } from "./LightingConfig";

/**
 * Manages Babylon directional-light shadow mapping for the voxel terrain.
 *
 * Voxel sunlight (baked into vertex colours) already produces correct
 * cave/overhang darkness and most "shadow" cues. This manager adds *dynamic*
 * cast shadows (trees, terrain silhouettes, later the player) on top, limited
 * to nearby chunks so it stays affordable.
 *
 *  ┌─ shadow frustum (shadowFrustumSize) ─┐   The frustum is centred on the
 *  │                                      │   player and larger than the
 *  │   ┌─ caster area ─┐                  │   caster area, so the hard
 *  │   │  trees/terrain │  ← fade margin →│   frustum edge never coincides
 *  │   └────────────────┘                 │   with a shadow. Shadows also
 *  │                                      │   fade via frustumEdgeFalloff.
 *  └──────────────────────────────────────┘   (No giant hard rectangle.)
 *
 * All tunables live in {@link ShadowConfig}. `setEnabled(false)` tears the
 * generator down so the world falls back to baked voxel light only — useful to
 * confirm whether an artifact is the shadow system or the voxel light.
 */
export class ShadowManager {
  readonly config: ShadowConfig;
  private readonly sun: DirectionalLight;
  private readonly world: World;
  private generator: ShadowGenerator | null = null;
  /** Current caster list, rebuilt each frame from nearby chunk meshes. */
  private casters: Mesh[] = [];
  private playerX = 0;
  private playerY = 0;
  private playerZ = 0;

  constructor(sun: DirectionalLight, world: World, config: ShadowConfig) {
    this.sun = sun;
    this.world = world;
    this.config = config;
    if (config.enabled) this.setup();
  }

  private setup(): void {
    const sg = new ShadowGenerator(this.config.mapSize, this.sun);
    if (this.config.blur) {
      sg.useBlurExponentialShadowMap = true;
      sg.blurKernel = 32;
      sg.blurScale = 2;
    } else {
      sg.useExponentialShadowMap = true;
    }
    sg.bias = this.config.bias;
    sg.normalBias = 0.02; // suppress terrain self-shadow (acne)
    sg.darkness = 0.5; // shadowed pixels retain 50% light (subtle voxel look)
    // Fade shadows out toward the frustum edge so the box boundary is never a
    // hard line (Babylon's computeFallOff uses this; default 0 = razor edge,
    // which is what produced the giant rectangular shadow artifact).
    sg.frustumEdgeFalloff = this.config.frustumEdgeFalloff;

    // Fixed orthographic frustum (stable texel density). The fixed-frustum path
    // otherwise borrows the *camera's* minZ/maxZ (0.1/1000) for the shadow
    // depth range, which wrecks ESM depth precision — set tight explicit bounds.
    this.sun.shadowFrustumSize = this.config.frustum * 2;
    this.sun.shadowMinZ = this.config.shadowMinZ;
    this.sun.shadowMaxZ = this.config.shadowMaxZ;

    const rt = sg.getShadowMap();
    if (rt) {
      rt.renderList = this.casters;
      // Only render actual casters (never an empty/whole-scene fallback).
      rt.renderParticles = false;
    }
    this.generator = sg;
  }

  /**
   * Re-centre the shadow frustum on the player and refresh the nearby-caster
   * list. The light is placed up-sun so the frustum box (centred on the light's
   * view axis) is centred on the player, not offset from it.
   */
  update(playerX: number, playerY: number, playerZ: number): void {
    this.playerX = playerX;
    this.playerY = playerY;
    this.playerZ = playerZ;
    if (!this.generator) return;

    const dir = this.sun.direction;
    // Centre the depth-symmetric frustum box on the player. The ortho centre in
    // world space = light.position + dir * (shadowMaxZ/2), so solving for the
    // light position that puts the player at that centre:
    const centerDepth = this.config.shadowMaxZ * 0.5;
    this.sun.position.x = playerX - dir.x * centerDepth;
    this.sun.position.y = playerY - dir.y * centerDepth;
    this.sun.position.z = playerZ - dir.z * centerDepth;

    // Casters: nearby opaque chunk meshes only, kept INSIDE the frustum so
    // shadow clipping happens in the fade-margin ring (never a hard edge).
    const radius = this.config.casterRadius;
    const radiusSq = radius * radius;
    const next: Mesh[] = [];
    this.world.forEachOpaqueMesh((cx, cz, mesh) => {
      if (!mesh.isEnabled() || !mesh.isVisible) return;
      const ccx = cx * 16 + 8;
      const ccz = cz * 16 + 8;
      const dx = ccx - playerX;
      const dz = ccz - playerZ;
      if (dx * dx + dz * dz <= radiusSq) next.push(mesh);
    });

    if (!sameSet(next, this.casters)) {
      this.casters = next;
      const rt = this.generator.getShadowMap();
      if (rt) rt.renderList = this.casters;
    }
  }

  setEnabled(enabled: boolean): void {
    if (enabled && !this.generator) {
      this.config.enabled = true;
      this.setup();
    } else if (!enabled && this.generator) {
      this.dispose();
      this.config.enabled = false;
    }
  }

  /** Toggle and return the new enabled state. */
  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  get enabled(): boolean {
    return this.generator !== null;
  }

  /**
   * Dump every mesh in the shadow render list (name, position, bounds,
   * visibility) plus the light/frustum state. For diagnosing shadow artifacts.
   */
  dumpDiagnostics(): unknown {
    const dir = this.sun.direction;
    const info = {
      enabled: this.enabled,
      light: {
        name: this.sun.name,
        direction: { x: dir.x, y: dir.y, z: dir.z },
        position: { x: this.sun.position.x, y: this.sun.position.y, z: this.sun.position.z },
        intensity: this.sun.intensity,
        shadowFrustumSize: this.sun.shadowFrustumSize,
        shadowMinZ: this.sun.shadowMinZ,
        shadowMaxZ: this.sun.shadowMaxZ,
      },
      config: { ...this.config },
      player: { x: this.playerX, y: this.playerY, z: this.playerZ },
      casterCount: this.casters.length,
      casters: this.casters.map((m) => {
        const bi = m.getBoundingInfo();
        const bb = bi ? bi.boundingBox : null;
        return {
          name: m.name,
          isVisible: m.isVisible,
          isEnabled: m.isEnabled(),
          receiveShadows: m.receiveShadows,
          position: { x: m.position.x, y: m.position.y, z: m.position.z },
          boundsMin: bb ? { x: bb.minimumWorld.x, y: bb.minimumWorld.y, z: bb.minimumWorld.z } : null,
          boundsMax: bb ? { x: bb.maximumWorld.x, y: bb.maximumWorld.y, z: bb.maximumWorld.z } : null,
        };
      }),
    };
    // eslint-disable-next-line no-console
    console.log("[shadows]", info);
    return info;
  }

  dispose(): void {
    this.generator?.dispose();
    this.generator = null;
    this.casters = [];
  }
}

function sameSet(a: Mesh[], b: Mesh[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  for (const m of a) if (!bs.has(m)) return false;
  return true;
}

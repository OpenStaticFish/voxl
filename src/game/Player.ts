import { Matrix, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import {
  PLAYER_HALF_WIDTH,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  GRAVITY,
  JUMP_SPEED,
  WALK_SPEED,
  SPRINT_SPEED,
  FLY_SPEED,
  FLY_SPRINT_SPEED,
  TERMINAL_VELOCITY,
  REACH,
} from "../constants";
import type { Settings } from "../types";
import { getBlock, isLiquid, CACTUS_BLOCK } from "./Blocks";
import type { World } from "./World";
import type { Input } from "../engine/Input";
import { raycastVoxel } from "./BlockRaycaster";
import type { RaycastHit } from "../types";

const HW = PLAYER_HALF_WIDTH;
const PH = PLAYER_HEIGHT;
const EPS = 1e-4;

/**
 * Player entity: owns the camera, handles mouse-look, walking/flying, gravity,
 * and swept AABB voxel collision. Also drives the block-selection raycast.
 *
 * The camera uses Babylon's right-handed system (scene.useRightHandedSystem =
 * true), so the math is identical to the prior three.js implementation:
 * camera looks down its local -Z, rotation order is YXZ.
 */
export class Player {
  readonly camera: UniversalCamera;
  position = new Vector3(0.5, 40, 0.5);
  velocity = new Vector3();
  yaw = 0;
  pitch = 0;
  flying = false;
  onGround = false;
  inWater = false;
  /**
   * Liquid-targeting mode (Luanti-style). When false (default) the ray passes
   * THROUGH water to target the solid terrain behind/under it — the normal
   * mining/building behaviour. When true the ray stops at the first liquid
   * (bucket-style), so the player can select/remove water sources themselves.
   */
  targetLiquids = false;
  /** Whether double-tap-Space may toggle flight (creative only). */
  canFly = true;

  /** Latest block targeted by the camera (for highlight + break/place). */
  target: RaycastHit | null = null;

  /** Fall-damage tracking (peak Y reached while airborne, in blocks). */
  private fallPeakY: number | null = null;
  private wasOnGround = true;
  private pendingFall = 0;

  constructor(aspect: number, scene: Scene) {
    void aspect; // Babylon derives aspect from the engine/canvas automatically.
    // We don't attachControl — input is handled by our own Input class. The
    // camera is just a transform + projection for rendering.
    this.camera = new UniversalCamera("player", new Vector3(0.5, 40, 0.5), scene);
    this.camera.fov = (75 * Math.PI) / 180; // radians in Babylon
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1000;
    // YXZ Euler order is the default for UniversalCamera; matches three.js.
    // Don't let Babylon auto-handle keyboard/mouse — Input owns it.
    this.camera.inputs.clear();
  }

  setAspect(_aspect: number): void {
    // Babylon derives aspect from the engine's canvas size on resize, so this
    // is a no-op (kept for API compatibility with Game.handleResize).
  }

  setFov(fov: number): void {
    this.camera.fov = (fov * Math.PI) / 180;
  }

  /** Place the player at a safe spawn above solid ground at (x,z). */
  spawn(world: World, x: number, z: number): void {
    const ground = world.groundHeight(Math.floor(x), Math.floor(z));
    this.position.set(x + 0.5, ground + 2.2, z + 0.5);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.PI * 0.25;
    // Look down steeply at spawn so the ground is immediately within reach and
    // the first click targets a block (otherwise the near-horizontal ray sails
    // over the terrain and targeting is null).
    this.pitch = -0.42;
    this.flying = false;
    this.fallPeakY = null;
    this.wasOnGround = true;
    this.pendingFall = 0;
  }

  private collides(world: World, px: number, py: number, pz: number): boolean {
    const minX = Math.floor(px - HW);
    const maxX = Math.floor(px + HW);
    const minY = Math.floor(py);
    const maxY = Math.floor(py + PH - 1e-3);
    const minZ = Math.floor(pz - HW);
    const maxZ = Math.floor(pz + HW);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (getBlock(world.getBlock(x, y, z)).solid) return true;
        }
      }
    }
    return false;
  }

  private blockAtFeetIsWater(world: World): boolean {
    // Any liquid at feet counts as "in water" — flowing water swims the same
    // as a source. This is the player's swim/drag/buoyancy trigger.
    return isLiquid(
      world.getBlock(
        Math.floor(this.position.x),
        Math.floor(this.position.y + 0.5),
        Math.floor(this.position.z),
      ),
    );
  }

  update(dt: number, world: World, input: Input, settings: Settings): void {
    // --- Mouse look ---
    const { dx, dy } = input.consumeMouseDelta();
    const sens = settings.mouseSensitivity * 0.005;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));

    // --- Wish direction (horizontal) ---
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fwd = new Vector3(-sinY, 0, -cosY);
    const right = new Vector3(cosY, 0, -sinY);
    let f = 0;
    let s = 0;
    if (input.isDown("KeyW")) f += 1;
    if (input.isDown("KeyS")) f -= 1;
    if (input.isDown("KeyD")) s += 1;
    if (input.isDown("KeyA")) s -= 1;
    const wish = new Vector3(0, 0, 0);
    wish.addInPlace(fwd.scale(f)).addInPlace(right.scale(s));
    if (wish.lengthSquared() > 0) wish.normalize();

    const sprinting = input.isDown("ControlLeft") || input.isDown("ControlRight");

    // Toggle flight on double-tap space (creative only).
    if (input.consumeDoubleTapSpace() && this.canFly) {
      this.flying = !this.flying;
    }

    this.inWater = this.blockAtFeetIsWater(world);

    if (this.flying) {
      const speed = sprinting ? FLY_SPRINT_SPEED : FLY_SPEED;
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      let vy = 0;
      if (input.isDown("Space")) vy += 1;
      if (input.isDown("ShiftLeft") || input.isDown("ShiftRight")) vy -= 1;
      this.velocity.y = vy * speed;
    } else {
      // Horizontal speed is reduced in water (swim drag). Sprinting is ignored
      // underwater — you can't sprint-swim.
      const baseSpeed = sprinting ? SPRINT_SPEED : WALK_SPEED;
      const speed = this.inWater ? baseSpeed * 0.55 : baseSpeed;
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      // Buoyancy: much weaker gravity underwater so the player floats/sinks
      // gently instead of plummeting.
      const g = this.inWater ? GRAVITY * 0.22 : GRAVITY;
      this.velocity.y -= g * dt;
      if (this.inWater) {
        // Clamp sink speed so the player drifts down slowly; space gives a
        // steady upward swim impulse (held = sustained climb).
        this.velocity.y = Math.max(this.velocity.y, -2.6);
        if (input.isDown("Space")) this.velocity.y = 5.2;
        // Gentle horizontal drag so the player coasts to a stop in water.
        // dt-aware exponential decay so the feel is identical at 30 / 60 / 144
        // FPS (0.86 is the per-60Hz-frame factor; pow scales it to the actual
        // frame delta).
        const drag = Math.pow(0.86, dt * 60);
        this.velocity.x *= drag;
        this.velocity.z *= drag;
      } else if (input.isDown("Space") && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
      if (this.velocity.y < -TERMINAL_VELOCITY) this.velocity.y = -TERMINAL_VELOCITY;
    }

    // --- Integrate with per-axis AABB collision ---
    const pos = this.position;
    let vx = this.velocity.x;
    let vy = this.velocity.y;
    let vz = this.velocity.z;

    // X
    pos.x += vx * dt;
    if (this.collides(world, pos.x, pos.y, pos.z)) {
      if (vx > 0) pos.x = Math.floor(pos.x + HW) - HW - EPS;
      else if (vx < 0) pos.x = Math.floor(pos.x - HW) + 1 + HW + EPS;
      vx = 0;
    }
    // Z
    pos.z += vz * dt;
    if (this.collides(world, pos.x, pos.y, pos.z)) {
      if (vz > 0) pos.z = Math.floor(pos.z + HW) - HW - EPS;
      else if (vz < 0) pos.z = Math.floor(pos.z - HW) + 1 + HW + EPS;
      vz = 0;
    }
    // Y
    this.onGround = false;
    pos.y += vy * dt;
    if (this.collides(world, pos.x, pos.y, pos.z)) {
      if (vy > 0) {
        pos.y = Math.floor(pos.y + PH) - PH - EPS;
      } else {
        pos.y = Math.floor(pos.y) + 1 + EPS;
        this.onGround = true;
      }
      vy = 0;
    }
    this.velocity.set(vx, vy, vz);

    this.trackFall(pos.y);

    // Safety: never fall below the world.
    if (pos.y < -10) {
      pos.y = 40;
      this.velocity.set(0, 0, 0);
    }

    // Sync camera to eye position + orientation.
    this.camera.position.set(pos.x, pos.y + PLAYER_EYE_HEIGHT, pos.z);
    // Babylon's UniversalCamera uses (0,0,1) as its local forward, while the
    // game's physics/raycast math assumes a three.js-style right-handed forward
    // of (0,0,-1). With scene.useRightHandedSystem=true the projection is
    // correct, but the camera reference isn't auto-flipped, so we compensate:
    //   yaw_babylon  = yaw + π   → forward.yaw matches
    //   pitch_babylon = -pitch   → looking up at +pitch matches
    this.camera.rotation.y = this.yaw + Math.PI;
    this.camera.rotation.x = -this.pitch;

    // --- Targeting raycast ---
    // Forward = Ry(yaw) * Rx(pitch) * (0, 0, -1) — same as three.js YXZ.
    // Targeting mode (Luanti-style): default passes through liquids so the
    // player can mine/build underwater; liquid mode stops at the water surface.
    const eye = this.camera.position;
    const aimRay = input.locked
      ? (() => {
          const cp = Math.cos(this.pitch);
          return {
            x: eye.x, y: eye.y, z: eye.z,
            dx: -Math.sin(this.yaw) * cp,
            dy: Math.sin(this.pitch),
            dz: -Math.cos(this.yaw) * cp,
          };
        })()
      : (() => {
          // Pointer lock unavailable: aim via the cursor so the game stays
          // playable (build/mine) without mouse-look.
          const sc = this.camera.getScene() as Scene;
          const ray = sc.createPickingRay(sc.pointerX, sc.pointerY, Matrix.Identity(), this.camera);
          return { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z, dx: ray.direction.x, dy: ray.direction.y, dz: ray.direction.z };
        })();
    this.target = this.computeTarget(world, aimRay.x, aimRay.y, aimRay.z, aimRay.dx, aimRay.dy, aimRay.dz);
  }

  /**
   * Resolve the active targeted block from the current aim ray + targeting
   * mode. In solid mode the ray ignores liquids (stops at the first solid),
   * falling back to the first liquid if no solid is reached (so open water is
   * still selectable). In liquid mode the ray stops at the first non-air cell,
   * letting the player point at the water surface itself.
   */
  private computeTarget(
    world: World,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
  ): RaycastHit | null {
    if (this.targetLiquids) {
      // Stop at the first non-air cell (water surface or solid).
      return raycastVoxel(world, ox, oy, oz, dx, dy, dz, REACH, { ignoreLiquid: false });
    }
    // Solid mode: pass through liquids to reach terrain.
    const hit = raycastVoxel(world, ox, oy, oz, dx, dy, dz, REACH, { ignoreLiquid: true });
    if (hit) return hit;
    return null;
  }

  /** Toggle liquid-targeting mode (Luanti `liquids` pointability flip). */
  toggleTargetLiquids(): boolean {
    this.targetLiquids = !this.targetLiquids;
    return this.targetLiquids;
  }

  /** The block the camera is currently looking at (for break/place). */
  getTarget(): RaycastHit | null {
    return this.target;
  }

  /** Blocks fallen (peak → landing). Consumed once on landing; 0 otherwise. */
  consumeFallDistance(): number {
    const f = this.pendingFall;
    this.pendingFall = 0;
    return f;
  }

  private trackFall(y: number): void {
    if (this.flying || this.inWater) {
      // Flight and water both cushion falls — don't track a fall distance.
      this.fallPeakY = null;
      this.wasOnGround = this.onGround;
      return;
    }
    if (!this.onGround) {
      if (this.fallPeakY === null) this.fallPeakY = y;
      else if (y > this.fallPeakY) this.fallPeakY = y;
    } else if (!this.wasOnGround) {
      if (this.fallPeakY !== null) {
        this.pendingFall = Math.max(0, this.fallPeakY - y);
      }
      this.fallPeakY = null;
    }
    this.wasOnGround = this.onGround;
  }

  /** Head (eye) submerged in a liquid — used for the drowning breath meter
   *  and the underwater screen tint/fog. Any liquid counts (source or flowing). */
  headSubmerged(world: World): boolean {
    const eyeY = this.position.y + PLAYER_EYE_HEIGHT;
    return isLiquid(
      world.getBlock(
        Math.floor(this.position.x),
        Math.floor(eyeY),
        Math.floor(this.position.z),
      ),
    );
  }

  /** The liquid block id at the player's eye, or 0 if eyes are in air. Used by
   *  the underwater renderer to pick the right fog colour/density per liquid. */
  liquidAtEye(world: World): number {
    const eyeY = this.position.y + PLAYER_EYE_HEIGHT;
    const id = world.getBlock(
      Math.floor(this.position.x),
      Math.floor(eyeY),
      Math.floor(this.position.z),
    );
    return isLiquid(id) ? id : 0;
  }

  /** Touching a cactus block anywhere in the player's AABB. */
  touchingCactus(world: World): boolean {
    const px = this.position.x;
    const py = this.position.y;
    const pz = this.position.z;
    const minX = Math.floor(px - HW);
    const maxX = Math.floor(px + HW);
    const minY = Math.floor(py);
    const maxY = Math.floor(py + PH - 1e-3);
    const minZ = Math.floor(pz - HW);
    const maxZ = Math.floor(pz + HW);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (world.getBlock(x, y, z) === CACTUS_BLOCK) return true;
        }
      }
    }
    return false;
  }
}

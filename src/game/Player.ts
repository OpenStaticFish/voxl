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
import { getBlock, WATER_BLOCK, CACTUS_BLOCK } from "./Blocks";
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
    return world.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y + 0.5),
      Math.floor(this.position.z),
    ) === WATER_BLOCK;
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
      const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      const g = this.inWater ? GRAVITY * 0.35 : GRAVITY;
      this.velocity.y -= g * dt;
      if (this.inWater) {
        this.velocity.y = Math.max(this.velocity.y, -4); // slow sink
        if (input.isDown("Space")) this.velocity.y = 4; // swim up
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
    const eye = this.camera.position;
    if (input.locked) {
      const cp = Math.cos(this.pitch);
      const fx = -Math.sin(this.yaw) * cp;
      const fy = Math.sin(this.pitch);
      const fz = -Math.cos(this.yaw) * cp;
      this.target = raycastVoxel(world, eye.x, eye.y, eye.z, fx, fy, fz, REACH);
    } else {
      // Pointer lock unavailable: aim via the cursor position instead so the
      // game stays fully playable (build/mine) without mouse-look.
      const sc = this.camera.getScene() as Scene;
      const ray = sc.createPickingRay(sc.pointerX, sc.pointerY, Matrix.Identity(), this.camera);
      this.target = raycastVoxel(
        world,
        ray.origin.x,
        ray.origin.y,
        ray.origin.z,
        ray.direction.x,
        ray.direction.y,
        ray.direction.z,
        REACH,
      );
    }
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

  /** Head (eye) submerged in water — used for the drowning breath meter. */
  headSubmerged(world: World): boolean {
    const eyeY = this.position.y + PLAYER_EYE_HEIGHT;
    return world.getBlock(
      Math.floor(this.position.x),
      Math.floor(eyeY),
      Math.floor(this.position.z),
    ) === WATER_BLOCK;
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

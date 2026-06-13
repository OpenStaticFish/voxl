import * as THREE from "three";
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
import { getBlock } from "./Blocks";
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
 */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  position = new THREE.Vector3(0.5, 40, 0.5);
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  flying = false;
  onGround = false;
  inWater = false;

  /** Latest block targeted by the camera (for highlight + break/place). */
  target: RaycastHit | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    this.camera.rotation.order = "YXZ";
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Place the player at a safe spawn above solid ground at (x,z). */
  spawn(world: World, x: number, z: number): void {
    const ground = world.groundHeight(Math.floor(x), Math.floor(z));
    this.position.set(x + 0.5, ground + 2.2, z + 0.5);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.PI * 0.25;
    this.pitch = -0.18;
    this.flying = false;
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
    ) === 7;
  }

  update(dt: number, world: World, input: Input, settings: Settings): void {
    // --- Mouse look ---
    const { dx, dy } = input.consumeMouseDelta();
    const sens = settings.mouseSensitivity * 0.0022;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));

    // --- Wish direction (horizontal) ---
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fwd = new THREE.Vector3(-sinY, 0, -cosY);
    const right = new THREE.Vector3(cosY, 0, -sinY);
    let f = 0;
    let s = 0;
    if (input.isDown("KeyW")) f += 1;
    if (input.isDown("KeyS")) f -= 1;
    if (input.isDown("KeyD")) s += 1;
    if (input.isDown("KeyA")) s -= 1;
    const wish = new THREE.Vector3();
    wish.addScaledVector(fwd, f).addScaledVector(right, s);
    if (wish.lengthSq() > 0) wish.normalize();

    const sprinting = input.isDown("ControlLeft") || input.isDown("ControlRight");

    // Toggle flight on double-tap space.
    if (input.consumeDoubleTapSpace()) {
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

    // Safety: never fall below the world.
    if (pos.y < -10) {
      pos.y = 40;
      this.velocity.set(0, 0, 0);
    }

    // Sync camera to eye position + orientation.
    this.camera.position.set(pos.x, pos.y + PLAYER_EYE_HEIGHT, pos.z);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // --- Targeting raycast ---
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.target = raycastVoxel(world, this.camera.position.x, this.camera.position.y, this.camera.position.z, dir.x, dir.y, dir.z, REACH);
  }

  /** The block the camera is currently looking at (for break/place). */
  getTarget(): RaycastHit | null {
    return this.target;
  }
}

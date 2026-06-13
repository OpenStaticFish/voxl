// Shared type definitions for VOXL.

/** Numeric block id. 0 = air. See Blocks.ts for the registry. */
export type BlockId = number;

/** A chunk's world-space grid coordinates. */
export interface ChunkCoord {
  cx: number;
  cz: number;
}

/** Cardinal face directions for meshing. */
export interface FaceDef {
  /** Unit normal. */
  readonly normal: readonly [number, number, number];
  /** The four corner offsets (counter-clockwise when viewed from outside). */
  readonly corners: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  /** Offset to the neighboring voxel this face touches. */
  readonly neighbor: readonly [number, number, number];
}

/** Application/game state machine. */
export type GameState = "menu" | "loading" | "playing" | "paused";

/** Serializable user settings. */
export interface Settings {
  viewDistance: number; // chunk radius
  mouseSensitivity: number; // multiplier
  fov: number; // degrees
  showFps: boolean;
  clouds: boolean;
  seed: string;
}

/** Result of a voxel DDA raycast. */
export interface RaycastHit {
  /** Integer coords of the hit block. */
  x: number;
  y: number;
  z: number;
  /** Integer coords of the empty cell adjacent to the hit face (for placement). */
  px: number;
  py: number;
  pz: number;
  /** The block id that was hit. */
  block: BlockId;
  /** Distance from ray origin. */
  distance: number;
}

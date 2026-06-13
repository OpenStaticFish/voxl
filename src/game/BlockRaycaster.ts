import type { RaycastHit } from "../types";
import type { World } from "../game/World";

const EPS = 1e-9;

/**
 * Amanatides & Woo voxel raycast. Steps through the integer grid from `origin`
 * along normalized `dir`, returning the first solid (non-air) block hit within
 * `maxDist`. The adjacent empty cell (for placement) is also returned.
 */
export function raycastVoxel(
  world: World,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): RaycastHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // Distance to cross one voxel along each axis.
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  // Initial distance to the first voxel boundary.
  const fracX = stepX > 0 ? 1 - (ox - x) : ox - x;
  const fracY = stepY > 0 ? 1 - (oy - y) : oy - y;
  const fracZ = stepZ > 0 ? 1 - (oz - z) : oz - z;
  let tMaxX = stepX !== 0 ? tDeltaX * (fracX === 0 ? 1 : fracX) : Infinity;
  let tMaxY = stepY !== 0 ? tDeltaY * (fracY === 0 ? 1 : fracY) : Infinity;
  let tMaxZ = stepZ !== 0 ? tDeltaZ * (fracZ === 0 ? 1 : fracZ) : Infinity;

  let px = x;
  let py = y;
  let pz = z;
  let t = 0;

  while (t <= maxDist) {
    const block = world.getBlock(x, y, z);
    if (block !== 0) {
      return { x, y, z, px, py, pz, block, distance: t };
    }
    px = x;
    py = y;
    pz = z;
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    }
    if (t > maxDist + EPS) break;
  }
  return null;
}

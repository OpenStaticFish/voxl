import type { RaycastHit, LiquidPassHit } from "../types";
import type { World } from "../game/World";
import { isLiquid } from "./Blocks";

const EPS = 1e-9;

/** Raycast targeting options (Luanti-style `liquids` / `pointabilities`). */
export interface RaycastOptions {
  /**
   * When true, liquid cells are treated as passable: the ray continues through
   * them to the first SOLID block, recording the first liquid it crossed in
   * `firstLiquid` / `passedThroughLiquid`. This is the default mining/building
   * behaviour (Luanti `core.raycast(..., liquids = false)` — liquids are not
   * pointable by default). When false, the ray stops at the first non-air cell,
   * including liquids (bucket-style liquid selection).
   */
  ignoreLiquid?: boolean;
}

/**
 * Amanatides & Woo voxel raycast. Steps through the integer grid from `origin`
 * along normalized `dir`, returning the first hit block within `maxDist` (solid
 * always; liquid only unless `ignoreLiquid`). The adjacent empty cell (for
 * placement) is also returned, along with whether the ray crossed any liquid
 * and the first such liquid cell (for the liquid-targeting mode + debug).
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
  opts?: RaycastOptions,
): RaycastHit | null {
  const ignoreLiquid = opts?.ignoreLiquid ?? false;

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

  // (px,py,pz) tracks the last passable cell the ray was in before the current
  // one — the placement cell adjacent to whichever face we eventually hit. We
  // update it whenever we step INTO a new cell, using the cell we just left.
  let px = x;
  let py = y;
  let pz = z;
  let t = 0;

  let passedThroughLiquid = false;
  let firstLiquid: LiquidPassHit | undefined;
  // (lpx,lpy,lpz): the passable cell immediately before the first liquid, used
  // as that liquid's placement coordinate if it becomes the active target.
  let lpx = x;
  let lpy = y;
  let lpz = z;

  while (t <= maxDist) {
    const block = world.getBlock(x, y, z);
    if (block !== 0) {
      if (ignoreLiquid && isLiquid(block)) {
        // Pass through the liquid; remember the first one for targeting/debug.
        if (!firstLiquid) {
          firstLiquid = { x, y, z, px: lpx, py: lpy, pz: lpz, block, distance: t };
        }
        passedThroughLiquid = true;
      } else {
        return { x, y, z, px, py, pz, block, distance: t, passedThroughLiquid, firstLiquid };
      }
    }
    // Remember the cell we're leaving as the placement origin for the NEXT cell.
    px = x;
    py = y;
    pz = z;
    if (!firstLiquid) {
      lpx = x;
      lpy = y;
      lpz = z;
    }
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
  // No solid hit. If we passed a liquid and are ignoring liquids, expose it so
  // the caller can fall back to selecting the water surface (Luanti-style).
  if (firstLiquid) {
    const f = firstLiquid;
    return { x: f.x, y: f.y, z: f.z, px: f.px, py: f.py, pz: f.pz, block: f.block, distance: f.distance, passedThroughLiquid: true, firstLiquid };
  }
  return null;
}

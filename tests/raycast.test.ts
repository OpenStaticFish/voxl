// Raycast-through-water tests (Babylon-free logic). Run: bun tests/raycast.test.ts
// Verifies the Luanti-style pointability: default ray passes THROUGH water to
// hit solid terrain; liquid mode stops at the water surface; fallback + seabed.

import { WATER_BLOCK, WATER_FLOWING_BLOCK } from "../src/game/Blocks";
import { raycastVoxel } from "../src/game/BlockRaycaster";

// Minimal world stub: the raycaster only calls world.getBlock(x,y,z).
function makeWorld(map: Record<string, number>) {
  return { getBlock: (x: number, y: number, z: number) => map[`${x}|${y}|${z}`] ?? 0 } as never;
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("  FAIL:", msg); failures++; }
  else console.log("  ok:", msg);
}

// Layout (looking +X from origin): air at x=0,1; WATER source at x=2,3; STONE at x=4.
const world = makeWorld({ "2|0|0": WATER_BLOCK, "3|0|0": WATER_BLOCK, "4|0|0": 3 });

console.log("\n[Test 1] Solid mode (ignoreLiquid=true): ray passes through water, hits stone.");
{
  const hit = raycastVoxel(world, 0.5, 0.5, 0.5, 1, 0, 0, 12, { ignoreLiquid: true });
  assert(hit !== null, "hit is not null");
  assert(hit!.block === 3, `hit stone (block 3), got ${hit?.block}`);
  assert(hit!.x === 4, `hit at x=4, got x=${hit?.x}`);
  assert(hit!.passedThroughLiquid === true, "ray passed through liquid");
  assert(hit!.firstLiquid !== undefined, "firstLiquid recorded");
  assert(hit!.firstLiquid!.x === 2 && hit!.firstLiquid!.block === WATER_BLOCK, `first liquid is the source at x=2, got x=${hit?.firstLiquid?.x}`);
  assert(hit!.px === 3, `placement cell x=3 (adjacent water), got px=${hit?.px}`);
}

console.log("\n[Test 2] Liquid mode (ignoreLiquid=false): ray stops at the water surface.");
{
  const hit = raycastVoxel(world, 0.5, 0.5, 0.5, 1, 0, 0, 12, { ignoreLiquid: false });
  assert(hit !== null, "hit is not null");
  assert(hit!.block === WATER_BLOCK, `hit water, got ${hit?.block}`);
  assert(hit!.x === 2, `hit at x=2 (first water), got x=${hit?.x}`);
  assert(hit!.passedThroughLiquid === false, "did not pass through (stopped at liquid)");
}

console.log("\n[Test 3] Solid mode, no solid behind water within reach → fallback to first liquid.");
{
  const world2 = makeWorld({ "2|0|0": WATER_FLOWING_BLOCK, "3|0|0": WATER_FLOWING_BLOCK });
  const hit = raycastVoxel(world2, 0.5, 0.5, 0.5, 1, 0, 0, 4, { ignoreLiquid: true });
  assert(hit !== null, "fallback hit is not null");
  assert(hit!.block === WATER_FLOWING_BLOCK, `fell back to flowing water, got ${hit?.block}`);
  assert(hit!.passedThroughLiquid === true, "marked as passed-through");
}

console.log("\n[Test 4] No water at all: solid mode behaves like the classic raycast.");
{
  const world3 = makeWorld({ "2|0|0": 3 });
  const hit = raycastVoxel(world3, 0.5, 0.5, 0.5, 1, 0, 0, 8, { ignoreLiquid: true });
  assert(hit !== null && hit!.block === 3, "hits stone");
  assert(hit!.passedThroughLiquid === false, "no liquid crossed");
  assert(hit!.firstLiquid === undefined, "no firstLiquid");
}

console.log("\n[Test 5] Water UNDER the ray (mining the seabed from above).");
{
  const world4 = makeWorld({ "0|0|0": 4 /*sand*/, "0|1|0": WATER_BLOCK });
  const hit = raycastVoxel(world4, 0.5, 4.5, 0.5, 0, -1, 0, 8, { ignoreLiquid: true });
  assert(hit !== null && hit!.block === 4, `hits sand through water, got ${hit?.block}`);
  assert(hit!.y === 0, `sand at y=0, got y=${hit?.y}`);
  assert(hit!.py === 1, `placement cell y=1 (where water was), got py=${hit?.py}`);
  assert(hit!.passedThroughLiquid === true, "passed through the water column");
}

if (failures === 0) console.log("\nALL RAYCAST TESTS PASSED\n");
else { console.error(`\n${failures} RAYCAST TEST(S) FAILED\n`); process.exit(1); }

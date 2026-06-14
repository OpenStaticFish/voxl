// Liquid flow simulator tests (Babylon-free logic). Run: bun tests/liquid.test.ts
// Verifies the Minetest-inspired flow rules converge and behave correctly:
// waterfalls, horizontal decay, drying, stable oceans (no endless loop),
// void-edge safety, renewable sources, solid walls, waterfall landings.

import {
  AIR_BLOCK,
  WATER_BLOCK,
  WATER_FLOWING_BLOCK,
  MAX_LIQUID_LEVEL,
} from "../src/game/Blocks";
import { LiquidSimulator } from "../src/game/liquid/LiquidSimulator";
import type { LiquidAccess } from "../src/game/liquid/LiquidTypes";
import type { BlockId } from "../src/types";

// In-memory world mirroring the real World's semantics:
//  • getBlock below y=0 → stone (the world floor; stops infinite waterfalls)
//  • setLiquid to an UNLOADED chunk → rejected (no write), like World.setLiquid
class FakeWorld implements LiquidAccess {
  cells = new Map<string, { id: BlockId; level: number }>();
  loaded: (x: number, z: number) => boolean = () => true;
  isChunkLoaded(x: number, z: number): boolean { return this.loaded(x, z); }
  private k(x: number, y: number, z: number): string { return x + "|" + y + "|" + z; }
  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return 3; // world floor = stone (matches real World.getBlock)
    return this.cells.get(this.k(x, y, z))?.id ?? AIR_BLOCK;
  }
  getLevel(x: number, y: number, z: number): number { return this.cells.get(this.k(x, y, z))?.level ?? 0; }
  setLiquid(x: number, y: number, z: number, id: BlockId, level: number): boolean {
    if (!this.loaded(x, z)) return false; // unloaded chunk → reject (mirrors World)
    const key = this.k(x, y, z);
    const cur = this.cells.get(key);
    if (cur && cur.id === id && cur.level === level) return false;
    if (id === AIR_BLOCK) this.cells.delete(key);
    else this.cells.set(key, { id, level });
    return true;
  }
  set(x: number, y: number, z: number, id: BlockId, level = 0): void { this.setLiquid(x, y, z, id, level); }
  floor(xMin: number, xMax: number, zMin: number, zMax: number, y: number): void {
    for (let x = xMin; x <= xMax; x++) for (let z = zMin; z <= zMax; z++) this.set(x, y, z, 3);
  }
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("  FAIL:", msg); failures++; }
  else console.log("  ok:", msg);
}
function settle(sim: LiquidSimulator, world: FakeWorld, maxTicks = 400): void {
  for (let i = 0; i < maxTicks; i++) {
    sim.tick(world);
    if (sim.queueSize === 0) return;
  }
  console.error("  DID NOT SETTLE within", maxTicks, "ticks (queue=", sim.queueSize, ")");
}

console.log("\n[Test 1] Source above air pours straight down (waterfall), stops on floor.");
{
  const w = new FakeWorld();
  w.floor(-14, 14, -14, 14, 0);
  w.set(0, 5, 0, WATER_BLOCK);
  const sim = new LiquidSimulator();
  sim.enqueue(0, 5, 0);
  settle(sim, w);
  assert(w.getBlock(0, 5, 0) === WATER_BLOCK, "source stays at y=5");
  assert(w.getBlock(0, 4, 0) === WATER_FLOWING_BLOCK, "flowing at y=4");
  assert(w.getBlock(0, 3, 0) === WATER_FLOWING_BLOCK, "flowing at y=3");
  assert(w.getLevel(0, 4, 0) === 7 && w.getLevel(0, 1, 0) === 7, "falling column is full level (7)");
  assert(w.getBlock(0, 0, 0) === 3, "floor intact");
  assert(sim.queueSize === 0, "queue drained (no endless loop)");
}

console.log("\n[Test 2] Source on a solid floor spreads horizontally and stops at range.");
{
  const w = new FakeWorld();
  w.floor(-14, 14, -14, 14, 0);
  w.set(0, 1, 0, WATER_BLOCK);
  const sim = new LiquidSimulator();
  sim.enqueue(0, 1, 0);
  settle(sim, w);
  let ok = true, maxDist = 0;
  for (let d = 1; d <= 9; d++) {
    const id = w.getBlock(d, 1, 0);
    if (id === WATER_FLOWING_BLOCK) {
      maxDist = d;
      const expected = MAX_LIQUID_LEVEL - d + 1;
      if (w.getLevel(d, 1, 0) !== expected) { ok = false; console.error(`    d=${d} level=${w.getLevel(d, 1, 0)} expected=${expected}`); }
    }
  }
  assert(ok, "horizontal levels decay by 1 per step from the source");
  assert(maxDist === 7, `spread reached exactly range (7) blocks, got ${maxDist}`);
  assert(w.getBlock(8, 1, 0) === AIR_BLOCK, "no water beyond range (air at d=8)");
  assert(sim.queueSize === 0, "queue drained");
}

console.log("\n[Test 3] Removing a source dries up its flowing tail.");
{
  const w = new FakeWorld();
  w.floor(-14, 14, -14, 14, 0);
  w.set(0, 1, 0, WATER_BLOCK);
  const sim = new LiquidSimulator();
  sim.enqueue(0, 1, 0);
  settle(sim, w);
  assert(w.getBlock(3, 1, 0) === WATER_FLOWING_BLOCK, "flowing exists at d=3 before removal");
  w.set(0, 1, 0, AIR_BLOCK);
  sim.enqueueAround(0, 1, 0);
  settle(sim, w);
  assert(w.getBlock(0, 1, 0) === AIR_BLOCK, "source cell is air");
  assert(w.getBlock(1, 1, 0) === AIR_BLOCK, "neighbour dried");
  assert(w.getBlock(3, 1, 0) === AIR_BLOCK, "far flowing dried too");
  assert(sim.queueSize === 0, "queue drained after drying");
}

console.log("\n[Test 4] Stable ocean (walled basin) does NOT churn forever.");
{
  const w = new FakeWorld();
  w.floor(0, 20, 0, 20, 5);
  for (let x = 0; x <= 20; x++) { w.set(x, 5, -1, 3); w.set(x, 5, 21, 3); w.set(x, 6, -1, 3); w.set(x, 6, 21, 3); }
  for (let z = 0; z <= 20; z++) { w.set(-1, 5, z, 3); w.set(21, 5, z, 3); w.set(-1, 6, z, 3); w.set(21, 6, z, 3); }
  for (let x = 0; x <= 20; x++) for (let z = 0; z <= 20; z++) w.set(x, 6, z, WATER_BLOCK);
  const sim = new LiquidSimulator();
  for (let x = 0; x <= 20; x++) for (let z = 0; z <= 20; z++) sim.enqueue(x, 6, z);
  settle(sim, w, 80);
  assert(sim.queueSize === 0, "ocean queue fully drains (no endless update loop)");
  let allSources = true;
  for (let x = 0; x <= 20; x++) for (let z = 0; z <= 20; z++) if (w.getBlock(x, 6, z) !== WATER_BLOCK) allSources = false;
  assert(allSources, "flat ocean surface unchanged (still all sources)");
}

console.log("\n[Test 5] Water does not flow into the void (unloaded chunk).");
{
  const w = new FakeWorld();
  w.floor(0, 14, -14, 14, 0);
  w.set(0, 1, 0, WATER_BLOCK);
  w.loaded = (x) => x >= 0;
  const sim = new LiquidSimulator();
  sim.enqueue(0, 1, 0);
  settle(sim, w);
  assert(w.getBlock(-1, 1, 0) === AIR_BLOCK, "no water drained into the void (x=-1 stays air)");
  assert(w.getBlock(2, 1, 0) === WATER_FLOWING_BLOCK, "spreads into loaded land (+x)");
  assert(sim.queueSize === 0, "queue drained");
}

console.log("\n[Test 6] Renewable: 2 sources + solid floor → air between becomes a source.");
{
  const w = new FakeWorld();
  w.floor(-14, 14, -14, 14, 0);
  w.set(1, 1, 1, WATER_BLOCK);
  w.set(3, 1, 1, WATER_BLOCK);
  const sim = new LiquidSimulator();
  sim.enqueue(2, 1, 1);
  settle(sim, w);
  assert(w.getBlock(2, 1, 1) === WATER_BLOCK, "air between 2 sources became a source (renewal)");
  assert(sim.queueSize === 0, "queue drained");
}

console.log("\n[Test 7] Water stops at a solid wall.");
{
  const w = new FakeWorld();
  w.floor(-14, 14, -14, 14, 0);
  for (let y = 0; y <= 5; y++) w.set(4, y, 0, 3);
  w.set(0, 1, 0, WATER_BLOCK);
  const sim = new LiquidSimulator();
  sim.enqueue(0, 1, 0);
  settle(sim, w);
  assert(w.getBlock(4, 1, 0) === 3, "wall intact (water did not replace solid)");
  assert(w.getBlock(3, 1, 0) === WATER_FLOWING_BLOCK, "water spreads up to the wall");
  assert(sim.queueSize === 0, "queue drained");
}

console.log("\n[Test 8] Waterfall spreads outward when it lands on a floor.");
{
  const w = new FakeWorld();
  w.floor(-14, 14, -14, 14, 0);
  w.set(0, 6, 0, WATER_BLOCK);
  const sim = new LiquidSimulator();
  sim.enqueue(0, 6, 0);
  settle(sim, w);
  assert(w.getBlock(0, 1, 0) === WATER_FLOWING_BLOCK, "waterfall reached the floor");
  assert(w.getLevel(0, 1, 0) === 7, "landing cell is full level");
  assert(w.getBlock(2, 1, 0) === WATER_FLOWING_BLOCK, "spread outward from the landing");
  assert(sim.queueSize === 0, "queue drained");
}

if (failures === 0) console.log("\nALL LIQUID TESTS PASSED\n");
else { console.error(`\n${failures} LIQUID TEST(S) FAILED\n`); process.exit(1); }

// Responsiveness test: a player edit (priority burst) must fill a gap
// IMMEDIATELY even when the normal queue carries a huge ocean-seeding backlog.
// Run: bun tests/responsiveness.test.ts

import { AIR_BLOCK, WATER_BLOCK, WATER_FLOWING_BLOCK } from "../src/game/Blocks";
import { LiquidSimulator, LIQUID_IMMEDIATE_BURST } from "../src/game/liquid/LiquidSimulator";
import type { LiquidAccess } from "../src/game/liquid/LiquidTypes";
import type { BlockId } from "../src/types";

class W implements LiquidAccess {
  cells = new Map<string, { id: BlockId; level: number }>();
  isChunkLoaded() { return true; }
  k(x: number, y: number, z: number) { return x + "|" + y + "|" + z; }
  getBlock(x: number, y: number, z: number) { if (y < 0) return 3; return this.cells.get(this.k(x, y, z))?.id ?? AIR_BLOCK; }
  getLevel(x: number, y: number, z: number) { return this.cells.get(this.k(x, y, z))?.level ?? 0; }
  setLiquid(x: number, y: number, z: number, id: BlockId, level: number) {
    const key = this.k(x, y, z); const c = this.cells.get(key);
    if (c && c.id === id && c.level === level) return false;
    if (id === AIR_BLOCK) this.cells.delete(key); else this.cells.set(key, { id, level });
    return true;
  }
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("  FAIL:", msg); failures++; }
  else console.log("  ok:", msg);
}

console.log("\n[Test] Edit beside water reacts IMMEDIATELY despite a large normal backlog.");
{
  const w = new W();
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) w.setLiquid(x, 0, z, 3, 0);
  w.setLiquid(0, 1, 0, WATER_BLOCK, 0);
  w.setLiquid(1, 1, 0, 3, 0);
  w.setLiquid(2, 1, 0, 3, 0);

  const sim = new LiquidSimulator();
  // Huge ocean-seeding backlog in the NORMAL lane (thousands of unrelated cells).
  for (let i = 0; i < 4000; i++) sim.enqueue(100 + i, 50, 100);
  sim.enqueue(0, 1, 0);
  sim.tick(w);

  // Player edit: remove sand at (1,1,0); World does enqueueAround [PRIORITY] + tickPriority.
  w.setLiquid(1, 1, 0, AIR_BLOCK, 0);
  sim.enqueueAround(1, 1, 0);
  const processed = sim.tickPriority(w, LIQUID_IMMEDIATE_BURST);

  const gap = w.getBlock(1, 1, 0);
  assert(processed > 0, `immediate burst processed cells (${processed})`);
  assert(gap === WATER_FLOWING_BLOCK || gap === WATER_BLOCK, `gap filled with water immediately (got id=${gap}), NOT waiting behind the backlog`);
  assert(sim.priorityQueueSize < 200, `priority lane holds only the live flow front, not the backlog (${sim.priorityQueueSize} << ${sim.queueSize})`);
  assert(sim.queueSize > 3000, `normal backlog still largely intact (${sim.queueSize}) — only priority was drained`);
}

console.log("\n[Test] Without the burst (old behaviour), the gap would NOT fill until the backlog drains.");
{
  const w = new W();
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) w.setLiquid(x, 0, z, 3, 0);
  w.setLiquid(0, 1, 0, WATER_BLOCK, 0);
  w.setLiquid(1, 1, 0, 3, 0);
  const sim = new LiquidSimulator();
  for (let i = 0; i < 4000; i++) sim.enqueue(100 + i, 50, 100);
  sim.enqueue(0, 1, 0);
  sim.tick(w);
  w.setLiquid(1, 1, 0, AIR_BLOCK, 0);
  // OLD path: enqueue to normal (back of the line).
  sim.enqueue(1, 1, 0); sim.enqueue(0, 1, 0); sim.enqueue(2, 1, 0);
  sim.enqueue(1, 2, 0); sim.enqueue(1, 0, 0); sim.enqueue(1, 1, 1); sim.enqueue(1, 1, -1);
  sim.setBudget(128);
  sim.tick(w);
  const gap = w.getBlock(1, 1, 0);
  assert(gap === AIR_BLOCK, `old behaviour: gap still empty after one tick (got id=${gap}) — confirms the backlog was the cause`);
}

if (failures === 0) console.log("\nALL RESPONSIVENESS TESTS PASSED\n");
else { console.error(`\n${failures} RESPONSIVENESS TEST(S) FAILED\n`); process.exit(1); }

// Crafting recipe matcher tests. Run: bun tests/recipes.test.ts
// Exercises the pure match() in src/game/Recipes.ts: the three starter recipes
// across 2x2 and 3x3 grids, orientation invariance, and negative cases.

import { match, RECIPES } from "../src/game/Recipes";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error("  FAIL:", msg); failures++; }
  else console.log("  ok:", msg);
}

// Grids are flat arrays; index = row * width + col. 2x2 = length 4, 3x3 = 9.
// null = empty cell.
function g2(a: string | null, b: string | null, c: string | null, d: string | null) {
  return [a, b, c, d];
}

const LOG = "b5";
const PLANKS = "planks";
const STICK = "stick";
const TABLE = "b38";

console.log("\n[Setup] Registry ships the three starter recipes.");
assert(RECIPES.length >= 3, `recipe registry has >=3 entries (got ${RECIPES.length})`);

// --- 1 log -> 4 planks (shapeless) ----------------------------------------

console.log("\n[Test 1] Shapeless: 1 log anywhere in a 2x2 grid -> 4 planks.");
{
  // log in each of the four 2x2 positions must resolve (shapeless = position-free).
  const positions = [g2(LOG, null, null, null), g2(null, LOG, null, null), g2(null, null, LOG, null), g2(null, null, null, LOG)];
  for (let i = 0; i < positions.length; i++) {
    const m = match(positions[i]);
    assert(m !== null && m.result === PLANKS && m.count === 4, `log at 2x2 position ${i} -> 4 planks`);
  }
}

console.log("\n[Test 2] Shapeless works on a 3x3 grid too, position-free.");
{
  const grid = new Array(9).fill(null);
  grid[7] = LOG;
  const m = match(grid);
  assert(m !== null && m.result === PLANKS && m.count === 4, "log in 3x3 corner -> 4 planks");
}

// --- 2 planks -> 4 sticks (shaped, orientation-invariant) -----------------

console.log("\n[Test 3] Shaped: 2 planks stacked vertically -> 4 sticks.");
{
  const m = match(g2(PLANKS, null, PLANKS, null));
  assert(m !== null && m.result === STICK && m.count === 4, "vertical planks -> 4 sticks");
}

console.log("\n[Test 4] Shaped is orientation-invariant: horizontal planks also match.");
{
  const m = match(g2(PLANKS, PLANKS, null, null));
  assert(m !== null && m.result === STICK && m.count === 4, "horizontal planks -> 4 sticks");
}

console.log("\n[Test 5] Diagonal planks do NOT match the stick recipe.");
{
  const m = match(g2(PLANKS, null, null, PLANKS));
  assert(m === null, "diagonal planks -> no match");
}

// --- 4 planks -> crafting table (shaped 2x2) ------------------------------

console.log("\n[Test 6] Shaped 2x2: 4 planks fill the grid -> 1 crafting table.");
{
  const m = match(g2(PLANKS, PLANKS, PLANKS, PLANKS));
  assert(m !== null && m.result === TABLE && m.count === 1, "2x2 planks -> 1 crafting table");
}

console.log("\n[Test 7] 3 planks in a 2x2 -> no match (partial table recipe).");
{
  const m = match(g2(PLANKS, PLANKS, PLANKS, null));
  assert(m === null, "3 planks -> no match");
}

// --- Negative / edge cases -------------------------------------------------

console.log("\n[Test 8] Empty grid -> no match.");
{
  assert(match(g2(null, null, null, null)) === null, "all-empty 2x2 -> null");
  assert(match(new Array(9).fill(null)) === null, "all-empty 3x3 -> null");
}

console.log("\n[Test 9] Unrecognised input -> no match.");
{
  const m = match(g2("apple", null, null, null));
  assert(m === null, "an apple alone -> no recipe");
}

console.log("\n[Test 10] Wrong count for shapeless -> no match.");
{
  // stick recipe is shaped 2 planks; a single plank matches nothing.
  const m = match(g2(PLANKS, null, null, null));
  assert(m === null, "1 plank alone -> no match");
}

console.log("\n[Test 11] Non-square grid length -> null (defensive).");
{
  assert(match([LOG, PLANKS, STICK]) === null, "length-3 grid -> null");
}

if (failures === 0) {
  console.log("\nAll recipe tests passed.\n");
} else {
  console.error(`\n${failures} recipe test(s) FAILED.\n`);
  process.exit(1);
}

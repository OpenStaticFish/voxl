// Standalone tests for the voxel light engine (sun + block propagation).
// Run with:  bun run test:light
//
// These exercise the engine directly (no Babylon/DOM) so they run under bun in
// milliseconds. They cover the scenarios the lighting PR depends on:
//   - open-air skylight, open vertical shaft (no decay straight down)
//   - enclosed pocket stays dark
//   - glowstone block-light decay
//   - water depth attenuation
//   - canopy attenuation under leaves
//   - cross-chunk boundary bleed (cave lit from a neighbour's opening)
//   - world-top water/leaves boundary (the cell that breaks the sky column)
//
// Failures print and exit non-zero so this works in CI.

import { CHUNK_SIZE, CHUNK_HEIGHT } from "../src/constants";
import { Chunk, blockIndex } from "../src/game/Chunk";
import { VoxelLightEngine, lightKey } from "../src/game/lighting/VoxelLightEngine";
import { LIGHT_MAX } from "../src/game/lighting/LightingConfig";

// A tiny in-memory world of (2*radius+1)² chunks for cross-chunk tests.
class MiniWorld {
  readonly chunks = new Map<string, Chunk>();
  constructor(public radius: number) {
    for (let cx = -radius; cx <= radius; cx++)
      for (let cz = -radius; cz <= radius; cz++)
        this.chunks.set(lightKey(cx, cz), new Chunk(cx, cz));
  }
  get(cx: number, cz: number): Chunk {
    return this.chunks.get(lightKey(cx, cz))!;
  }
  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0) return 3;
    if (wy >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.chunks.get(lightKey(cx, cz));
    if (!c) return 0;
    return c.getLocal(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE);
  }
  setBlock(wx: number, wy: number, wz: number, id: number): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.chunks.get(lightKey(cx, cz));
    if (!c) return;
    c.blocks[blockIndex(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE)] = id;
    c.generated = true;
  }
}

function engineFor(w: MiniWorld): VoxelLightEngine {
  return new VoxelLightEngine((x, y, z) => w.getBlock(x, y, z));
}

let failures = 0;
function check(name: string, cond: boolean, extra = ""): void {
  if (!cond) {
    failures++;
    console.error(`  FAIL: ${name} ${extra}`);
  } else {
    console.log(`  ok: ${name} ${extra}`);
  }
}

// 1. Open air is fully sky-lit and an open shaft does not decay downward.
{
  const w = new MiniWorld(0);
  const c = w.get(0, 0);
  c.generated = true;
  const eng = engineFor(w);
  eng.relightChunk(c);
  check("open air top sun=15", eng.getSun(0, CHUNK_HEIGHT - 1, 0) === LIGHT_MAX);
  check("open air bottom sun=15", eng.getSun(0, 0, 0) === LIGHT_MAX, `(got ${eng.getSun(0, 0, 0)})`);
  check("deep open shaft sun=15", eng.getSun(5, 5, 5) === LIGHT_MAX);
}

// 2. A fully-enclosed air pocket deep in stone is dark.
{
  const w = new MiniWorld(1);
  for (const c of w.chunks.values()) {
    c.blocks.fill(3);
    c.generated = true;
  }
  const c = w.get(0, 0);
  for (let y = 40; y <= 42; y++)
    for (let x = 7; x <= 9; x++)
      for (let z = 7; z <= 9; z++) c.blocks[blockIndex(x, y, z)] = 0;
  const eng = engineFor(w);
  eng.relightChunk(w.get(0, 0));
  eng.relightChunk(w.get(-1, 0));
  eng.relightChunk(w.get(1, 0));
  eng.relightChunk(w.get(0, -1));
  eng.relightChunk(w.get(0, 1));
  eng.relightChunk(w.get(0, 0));
  const pocket = eng.getSun(8, 41, 8);
  check("enclosed pocket is dark (sun<3)", pocket < 3, `(got sun=${pocket})`);
}

// 3. Glowstone emits block light that decays by 1 per block.
{
  const w = new MiniWorld(1);
  for (const c of w.chunks.values()) {
    c.blocks.fill(3);
    c.generated = true;
  }
  // Carve an air pocket around the emitter so block light can spread.
  for (let y = 38; y <= 42; y++)
    for (let x = 6; x <= 14; x++)
      for (let z = 6; z <= 10; z++) w.setBlock(x, y, z, 0);
  w.setBlock(8, 40, 8, 28); // glowstone
  const eng = engineFor(w);
  eng.relightChunk(w.get(0, 0));
  check("glowstone cell block=15", eng.getBlockLight(8, 40, 8) === LIGHT_MAX);
  check("1 block away block=14", eng.getBlockLight(9, 40, 8) === 14, `(got ${eng.getBlockLight(9, 40, 8)})`);
  check("16 blocks away block<=0", eng.getBlockLight(8 + 16, 40, 8) <= 0, `(got ${eng.getBlockLight(8 + 16, 40, 8)})`);
}

// 4. Water attenuates with depth.
{
  const w = new MiniWorld(0);
  const c = w.get(0, 0);
  c.blocks.fill(0);
  for (let y = 60; y <= 75; y++)
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let z = 0; z < CHUNK_SIZE; z++) c.blocks[blockIndex(x, y, z)] = 7;
  for (let x = 0; x < CHUNK_SIZE; x++)
    for (let z = 0; z < CHUNK_SIZE; z++) c.blocks[blockIndex(x, 60, z)] = 3;
  c.generated = true;
  const eng = engineFor(w);
  eng.relightChunk(c);
  const surface = eng.getSun(8, 75, 8);
  const deep = eng.getSun(8, 62, 8);
  check("water surface sun high", surface >= 13, `(got ${surface})`);
  check("deep water sun < surface", deep < surface, `(surface=${surface}, deep=${deep})`);
}

// 5. Leaves attenuate light under a canopy.
{
  const w = new MiniWorld(0);
  const c = w.get(0, 0);
  c.blocks.fill(0);
  c.generated = true;
  for (let y = 70; y <= 80; y++)
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let z = 0; z < CHUNK_SIZE; z++) c.blocks[blockIndex(x, y, z)] = 6;
  for (let x = 0; x < CHUNK_SIZE; x++)
    for (let z = 0; z < CHUNK_SIZE; z++) c.blocks[blockIndex(x, 60, z)] = 3;
  const eng = engineFor(w);
  eng.relightChunk(c);
  const top = eng.getSun(8, 80, 8);
  const ground = eng.getSun(8, 61, 8);
  check("canopy top is bright", top >= 5, `(got ${top})`);
  check("ground under canopy dimmer than top", ground < top, `(top=${top}, ground=${ground})`);
}

// 6. Cross-chunk: light bleeds across a boundary through a tunnel.
{
  const w = new MiniWorld(1);
  for (const c of w.chunks.values()) {
    c.blocks.fill(3);
    c.generated = true;
  }
  for (let x = -8; x <= 24; x++) w.setBlock(x, 40, 8, 0); // horizontal tunnel
  for (let y = 40; y < CHUNK_HEIGHT; y++) w.setBlock(20, y, 8, 0); // skylight in chunk (1,0)
  const eng = engineFor(w);
  eng.relightChunk(w.get(0, 0));
  eng.relightChunk(w.get(1, 0));
  eng.relightChunk(w.get(0, 0));
  const near = eng.getSun(20, 40, 8);
  const edge = eng.getSun(16, 40, 8); // chunk boundary
  const inside = eng.getSun(2, 40, 8); // deep in chunk (0,0) tunnel
  check("shaft cell is sky-lit", near === LIGHT_MAX, `(got ${near})`);
  check("light crosses boundary", edge > 0, `(got sun=${edge})`);
  check("light attenuates along tunnel", inside < edge, `(edge=${edge}, inside=${inside})`);
}

// 7. World-top water boundary: a water cell at the top of the world is lit on
//    its surface (not pitch-black), since it breaks but still conducts light.
{
  const w = new MiniWorld(0);
  const c = w.get(0, 0);
  c.blocks.fill(0);
  c.generated = true;
  // Water slab at the very top of the world, air below.
  for (let y = CHUNK_HEIGHT - 4; y < CHUNK_HEIGHT; y++)
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let z = 0; z < CHUNK_SIZE; z++) c.blocks[blockIndex(x, y, z)] = 7;
  const eng = engineFor(w);
  eng.relightChunk(c);
  const topWater = eng.getSun(8, CHUNK_HEIGHT - 1, 8); // topmost cell, breaks column
  check("world-top water surface is lit (sun>=12)", topWater >= 12, `(got sun=${topWater})`);
}

console.log(failures === 0 ? "\nALL LIGHT TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

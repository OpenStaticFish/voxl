// Voxel liquid flow simulator, modelled on Luanti/Minetest's
// `transforming_liquid` system but adapted to this engine's id-driven storage.
//
// Design (see PLAN in the PR description):
//   • Source cells are infinite emitters. They pour DOWN into floodable cells
//     (creating full-level flowing waterfalls) and wake their horizontal
//     neighbours so flow spawns beside them.
//   • Air / flowing cells RECOMPUTE their desired state from their feeders
//     (the cell above + the four horizontal neighbours). Each horizontal step
//     decays one level; a cell with a floodable cell below is treated as
//     "falling" and clamps to full level. With no feeder and no fall, a
//     flowing cell dries to air.
//   • Renewable sources: a flowing/air cell with ≥2 source neighbours AND a
//     solid/source support below becomes a source (the classic infinite-water
//     rule). Bounded and conservative — it only fires inside genuine pools.
//
// Convergence: a cell only changes when its computed target differs from its
// current state; equal writes are no-ops and never re-enqueue. Flowing water
// at level L can only create neighbours at level ≤ L−1, so levels strictly
// decay outward and the system always settles.

import {
  AIR_BLOCK,
  WATER_BLOCK,
  WATER_FLOWING_BLOCK,
  MAX_LIQUID_LEVEL,
  getBlock,
  isFloodable,
  liquidDefOf,
  liquidHeight,
  type LiquidDef,
} from "../Blocks";
import type { BlockId } from "../../types";
import { LiquidUpdateQueue, type QueuedCell } from "./LiquidUpdateQueue";
import type { LiquidAccess, LiquidDebugSnapshot } from "./LiquidTypes";

/** Default cells processed per scheduled tick. Tuned for ~40fps baseline hardware. */
export const DEFAULT_LIQUID_BUDGET = 128;
/**
 * The simulator ticks at most this many times per second (decoupled from fps).
 * ~18 Hz gives a ~55ms cadence so ongoing flow propagation feels responsive
 * while staying cheap. The FIRST response to a player edit doesn't wait for
 * this — `World.setBlock` fires an immediate priority burst on the same frame.
 */
export const LIQUID_TICK_RATE_HZ = 18;
/**
 * Maximum cells processed in the immediate post-edit priority burst. Small so a
 * big edit can't stall the frame, but enough to flow water into the opened gap
 * on the very first frame (7 enqueued neighbours + a few propagation wakes).
 */
export const LIQUID_IMMEDIATE_BURST = 48;

// Horizontal neighbour offsets (E, W, N, S).
const HORIZ = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

export class LiquidSimulator {
  private readonly queue = new LiquidUpdateQueue();
  private budget = DEFAULT_LIQUID_BUDGET;
  private processedLastTick = 0;
  private totalWrites = 0;
  /** Performance.now() of the last scheduled tick (for the "time since tick" debug). */
  private lastTickMs = performance.now();
  /** Total cells processed via the immediate priority burst since world start. */
  private priorityProcessed = 0;

  /** Add a position for the next tick (deduplicated). */
  enqueue(x: number, y: number, z: number): void {
    this.queue.enqueue(x, y, z);
  }

  /**
   * Wake a cell and its 6 neighbours on the PRIORITY lane — used after player
   * terrain edits. Priority cells are drained before the normal (seeding +
   * propagation) backlog, so removing a block beside water reacts within a
   * frame instead of waiting behind thousands of ocean-seeded cells.
   */
  enqueueAround(x: number, y: number, z: number): void {
    this.queue.enqueuePriority(x, y, z);
    this.queue.enqueuePriority(x + 1, y, z);
    this.queue.enqueuePriority(x - 1, y, z);
    this.queue.enqueuePriority(x, y + 1, z);
    this.queue.enqueuePriority(x, y - 1, z);
    this.queue.enqueuePriority(x, y, z + 1);
    this.queue.enqueuePriority(x, y, z - 1);
  }

  /**
   * Immediately process up to `budget` PRIORITY cells right now (called by
   * World right after a player edit). This makes the first flow step happen on
   * the SAME frame as the edit — water visibly starts moving before the next
   * scheduled liquid tick. Bounded so a big edit can't stall the frame.
   */
  tickPriority(access: LiquidAccess, budget: number): number {
    let processed = 0;
    while (processed < budget) {
      const cell = this.queue.pullPriority();
      if (!cell) break;
      this.flowCell(access, cell.x, cell.y, cell.z);
      processed++;
    }
    this.priorityProcessed += processed;
    return processed;
  }

  /** Per-tick cell budget (debug-configurable). */
  setBudget(budget: number): void {
    this.budget = budget > 0 ? Math.floor(budget) : DEFAULT_LIQUID_BUDGET;
  }
  get currentBudget(): number {
    return this.budget;
  }

  get queueSize(): number {
    return this.queue.size;
  }
  get priorityQueueSize(): number {
    return this.queue.prioritySize;
  }
  get peakQueueSize(): number {
    return this.queue.peakSize;
  }

  /** Drain the queue (on world unload). */
  reset(): void {
    this.queue.clear();
    this.processedLastTick = 0;
    this.lastTickMs = performance.now();
  }

  /** Debug: snapshot of currently-queued positions (do not mutate). */
  peekQueue(): readonly QueuedCell[] {
    return this.queue.snapshot();
  }

  /** Milliseconds since the last scheduled tick (debug overlay). */
  get msSinceLastTick(): number {
    return performance.now() - this.lastTickMs;
  }
  /** Total cells processed via the immediate priority burst (debug). */
  get priorityProcessedTotal(): number {
    return this.priorityProcessed;
  }

  /**
   * Process up to `budget` queued cells against `access` (PRIORITY lane first,
   * then the normal backlog). Each cell is recomputed and, if it changes, its
   * neighbours are woken so the flow ripples outward over successive ticks.
   * Safe to call every frame.
   */
  tick(access: LiquidAccess): LiquidDebugSnapshot {
    this.lastTickMs = performance.now();
    let processed = 0;
    let remaining = this.budget;
    while (remaining > 0) {
      const cell = this.queue.dequeue();
      if (!cell) break;
      this.flowCell(access, cell.x, cell.y, cell.z);
      remaining--;
      processed++;
    }
    this.processedLastTick = processed;
    return {
      queueSize: this.queue.size,
      priorityQueueSize: this.queue.prioritySize,
      processedLastTick: processed,
      budget: this.budget,
      totalWrites: this.totalWrites,
      priorityProcessed: this.priorityProcessed,
      msSinceLastTick: 0,
      dirtyChunks: 0, // filled in by the World wrapper
    };
  }

  get debug(): LiquidDebugSnapshot {
    return {
      queueSize: this.queue.size,
      priorityQueueSize: this.queue.prioritySize,
      processedLastTick: this.processedLastTick,
      budget: this.budget,
      totalWrites: this.totalWrites,
      priorityProcessed: this.priorityProcessed,
      msSinceLastTick: this.msSinceLastTick,
      dirtyChunks: 0,
    };
  }

  // --------------------------------------------------------------- flow ---

  private flowCell(access: LiquidAccess, x: number, y: number, z: number): void {
    const id = access.getBlock(x, y, z);
    if (id === AIR_BLOCK) {
      this.trySpawnIntoAir(access, x, y, z);
      return;
    }
    const def = getBlock(id);
    if (def.liquidType === "source") {
      this.flowSource(access, x, y, z, def.liquidDef ?? null);
      return;
    }
    if (def.liquidType === "flowing") {
      this.flowFlowing(access, x, y, z, def.liquidDef ?? null, access.getLevel(x, y, z));
      return;
    }
    // A solid / plant neighbour was enqueued (e.g. terrain placed next to
    // water): wake its liquid neighbours so they recompute.
    this.wakeLiquidNeighbours(access, x, y, z);
  }

  /** A source emits downward + sideways indefinitely. */
  private flowSource(access: LiquidAccess, x: number, y: number, z: number, ldef: LiquidDef | null): void {
    // Pour down: create a full-level flowing waterfall below.
    const below = access.getBlock(x, y - 1, z);
    if (isFloodable(below)) {
      const level = ldef ? ldef.range : MAX_LIQUID_LEVEL;
      if (this.write(access, x, y - 1, z, WATER_FLOWING_BLOCK, level)) {
        this.queue.enqueue(x, y - 1, z);
      }
    }
    // Wake only neighbours that could actually receive flow — floodable cells
    // (air) beside the source, or existing flowing cells (which may need to
    // rise to full). We deliberately do NOT wake other sources: a stable ocean
    // of sources would otherwise re-enqueue itself forever (the endless-update
    // trap). Solids never receive flow either.
    for (const o of HORIZ) {
      const nx = x + o[0];
      const nz = z + o[2];
      const nid = access.getBlock(nx, y, nz);
      if (nid === AIR_BLOCK || getBlock(nid).liquidType === "flowing") {
        this.queue.enqueue(nx, y, nz);
      }
    }
  }

  /**
   * Recompute a flowing cell: it may rise (new feeder), dry (feeder gone), or
   * hold its level and spread. Falling cells clamp to full level.
   *
   * Feeding is ACYCLIC to guarantee convergence: a horizontal neighbour only
   * feeds this cell if its head is STRICTLY GREATER (so equal-level cells on a
   * broad front can never pull each other up/down — the oscillation trap). The
   * cell directly ABOVE may feed at equal head to sustain a waterfall column.
   */
  private flowFlowing(
    access: LiquidAccess,
    x: number,
    y: number,
    z: number,
    ldef: LiquidDef | null,
    level: number,
  ): void {
    const ownHead = level; // flowing head == level (1..MAX)
    const f = this.bestFeeder(access, x, y, z, ownHead, true);
    const below = access.getBlock(x, y - 1, z);
    const belowFloodable = isFloodable(below);
    const columnFed = f.above > 0; // liquid above at head ≥ ours sustains us
    const horizFed = f.horiz > ownHead;

    // No feeder at all → dry (a drying waterfall tail drains too).
    if (!columnFed && !horizFed) {
      if (this.write(access, x, y, z, AIR_BLOCK, 0)) this.wakeAround(x, y, z);
      return;
    }

    const range = ldef ? ldef.range : MAX_LIQUID_LEVEL;
    let target: number;
    if (belowFloodable) {
      // Falling + fed → full-level waterfall.
      target = range;
    } else {
      // Landed: water transfers DOWN from above without decay, and spreads
      // SIDEWAYS with a one-level decay. Take whichever is higher.
      let t = 0;
      if (columnFed) t = f.above > range ? range : f.above; // down-transfer (clamp to range)
      if (horizFed && f.horiz - 1 > t) t = f.horiz - 1;
      target = t;
    }
    if (target < 1) {
      if (this.write(access, x, y, z, AIR_BLOCK, 0)) this.wakeAround(x, y, z);
      return;
    }

    // Renewable source creation: ≥2 source neighbours + solid/source support.
    if (ldef?.renewable) {
      const sources = this.countSourceNeighbours(access, x, y, z);
      const supported = getBlock(below).solid || below === WATER_BLOCK;
      if (sources >= 2 && supported) {
        if (this.write(access, x, y, z, WATER_BLOCK, 0)) this.wakeAround(x, y, z);
        return;
      }
    }

    if (target !== level) {
      if (this.write(access, x, y, z, WATER_FLOWING_BLOCK, target)) this.wakeAround(x, y, z);
      return;
    }

    // Level unchanged: propagate. Falling water ONLY pours down (no sideways
    // spread — a falling stream that spawned a full ring at every level would
    // grow into a diverging 3D plume). Landed water spreads sideways.
    if (belowFloodable) {
      if (this.write(access, x, y - 1, z, WATER_FLOWING_BLOCK, range)) {
        this.queue.enqueue(x, y - 1, z);
      }
    } else {
      for (const o of HORIZ) {
        const nx = x + o[0];
        const nz = z + o[2];
        const nid = access.getBlock(nx, y, nz);
        if (nid === AIR_BLOCK) {
          this.queue.enqueue(nx, y, nz);
        } else if (getBlock(nid).liquidType === "flowing") {
          const nl = access.getLevel(nx, y, nz);
          if (nl < level) this.queue.enqueue(nx, y, nz);
        }
      }
    }
  }

  /** Air cell: spawn flowing water here if a feeder reaches it (horizontal or
   *  falling-from-above; water never flows UP, so the cell above is ignored). */
  private trySpawnIntoAir(access: LiquidAccess, x: number, y: number, z: number): void {
    const f = this.bestFeeder(access, x, y, z, 0, false);
    if (f.horiz === 0) return; // no horizontal feeder can reach; stay air
    const ldef = f.ldef ?? liquidDefOf(WATER_BLOCK);
    if (!ldef) return;

    const below = access.getBlock(x, y - 1, z);
    const belowFloodable = isFloodable(below);
    const range = ldef.range;
    let target: number;
    if (belowFloodable) {
      target = range; // pouring into an open shaft → full
    } else if (f.horiz >= range + 1) {
      target = range; // fed directly by a source → full
    } else {
      target = f.horiz - 1;
    }
    if (target < 1) return;

    // Renewable into air (classic 2-source pool fill).
    if (ldef.renewable) {
      const sources = this.countSourceNeighbours(access, x, y, z);
      const supported = getBlock(below).solid || below === WATER_BLOCK;
      if (sources >= 2 && supported) {
        if (this.write(access, x, y, z, WATER_BLOCK, 0)) this.wakeAround(x, y, z);
        return;
      }
    }

    if (this.write(access, x, y, z, WATER_FLOWING_BLOCK, target)) this.wakeAround(x, y, z);
  }

  /**
   * Wake the 6 neighbours of a CHANGED cell on the PRIORITY lane so active flow
   * ripples outward responsively. This is safe re: the endless-loop trap
   * because only cells that ACTUALLY changed reach here — the stable ocean
   * backlog (no-change no-op cells) never wakes anything, so the priority lane
   * stays small (just the live flow front) and drains each tick. Convergence is
   * unchanged (priority/normal only differ in ordering, not in flow logic).
   */
  private wakeAround(x: number, y: number, z: number): void {
    this.queue.enqueuePriority(x + 1, y, z);
    this.queue.enqueuePriority(x - 1, y, z);
    this.queue.enqueuePriority(x, y + 1, z);
    this.queue.enqueuePriority(x, y - 1, z);
    this.queue.enqueuePriority(x, y, z + 1);
    this.queue.enqueuePriority(x, y, z - 1);
  }

  /** Wake only the liquid-valued neighbours of a solid/plant cell. */
  private wakeLiquidNeighbours(access: LiquidAccess, x: number, y: number, z: number): void {
    const neigh = [
      [x + 1, y, z],
      [x - 1, y, z],
      [x, y + 1, z],
      [x, y - 1, z],
      [x, y, z + 1],
      [x, y, z - 1],
    ];
    for (const n of neigh) {
      const id = access.getBlock(n[0], n[1], n[2]);
      if (getBlock(id).liquidType && getBlock(id).liquidType !== "none") {
        this.queue.enqueue(n[0], n[1], n[2]);
      }
    }
  }

  // ----------------------------------------------------------- helpers ---

  /**
   * Feeder analysis for cell (x,y,z), split into the cell directly ABOVE and
   * the four HORIZONTAL neighbours. They feed under different rules:
   *
   *   • ABOVE: a liquid cell above transfers its level DOWNWARD WITHOUT DECAY
   *     (a waterfall column stays full). Only counts when its head is ≥
   *     `ownHead` (so a draining column doesn't falsely sustain the cell below).
   *     Ignored entirely for air cells (`allowAboveColumn=false`) — water never
   *     flows up into air.
   *   • HORIZONTAL: a strictly-higher, SUPPORTED (landed/source) neighbour
   *     feeds this cell with a one-level decay. The strict-greater + supported
   *     rules make feeding acyclic and keep waterfalls as narrow columns.
   *
   * Downward neighbours never feed (down is a drain).
   */
  private bestFeeder(
    access: LiquidAccess,
    x: number,
    y: number,
    z: number,
    ownHead: number,
    allowAboveColumn: boolean,
  ): { above: number; horiz: number; ldef: LiquidDef | null } {
    let above = 0;
    let horiz = 0;
    let ldef: LiquidDef | null = null;

    if (allowAboveColumn) {
      const id = access.getBlock(x, y + 1, z);
      const ld = liquidDefOf(id);
      if (ld) {
        const lv = id === WATER_FLOWING_BLOCK ? access.getLevel(x, y + 1, z) : 0;
        const h = liquidHeight(id, lv);
        if (h >= ownHead && h > 0) above = h;
        if (ld) ldef = ld;
      }
    }

    const considerHoriz = (nx: number, nz: number): void => {
      if (!access.isChunkLoaded(nx, nz)) return;
      const id = access.getBlock(nx, y, nz);
      const ld = liquidDefOf(id);
      if (!ld) return;
      if (!this.isSupported(access, nx, y, nz)) return; // falling cells don't spread sideways
      const lv = id === WATER_FLOWING_BLOCK ? access.getLevel(nx, y, nz) : 0;
      const h = liquidHeight(id, lv);
      if (h > ownHead && h > horiz) {
        horiz = h;
        ldef = ld;
      }
    };
    considerHoriz(x + 1, z);
    considerHoriz(x - 1, z);
    considerHoriz(x, z + 1);
    considerHoriz(x, z - 1);
    return { above, horiz, ldef };
  }

  /**
   * True if the liquid cell at (x,y,z) may spread SIDEWARDS — i.e. it is a
   * source, or a flowing cell resting on SOLID terrain. This mirrors Luanti's
   * `LIQUID_FLOW_DOWN_MASK` behavior: source nodes still feed same-level
   * neighbours, but same-level falling flowing nodes cannot feed sideways.
   */
  private isSupported(access: LiquidAccess, x: number, y: number, z: number): boolean {
    const id = access.getBlock(x, y, z);
    const def = getBlock(id);
    if (def.liquidType === "source") return true;
    if (def.liquidType !== "flowing") return false;
    return getBlock(access.getBlock(x, y - 1, z)).solid;
  }

  /** Count source-liquid neighbours in all 6 directions. */
  private countSourceNeighbours(access: LiquidAccess, x: number, y: number, z: number): number {
    let n = 0;
    const check = (nx: number, ny: number, nz: number): void => {
      if (!access.isChunkLoaded(nx, nz)) return;
      if (getBlock(access.getBlock(nx, ny, nz)).liquidType === "source") n++;
    };
    check(x + 1, y, z);
    check(x - 1, y, z);
    check(x, y, z + 1);
    check(x, y, z - 1);
    check(x, y + 1, z);
    return n;
  }

  /**
   * Write a cell via the access. Counts writes for the debug overlay. Returns
   * the access result (true if the cell changed).
   */
  private write(access: LiquidAccess, x: number, y: number, z: number, id: BlockId, level: number): boolean {
    const changed = access.setLiquid(x, y, z, id, level);
    if (changed) this.totalWrites++;
    return changed;
  }
}

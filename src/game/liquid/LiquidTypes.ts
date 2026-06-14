// Liquid system shared types. The flow simulator talks to the world through a
// narrow {@link LiquidAccess} interface (mirroring the lighting system's
// `LightAccess`), keeping it decoupled from chunk storage and Babylon.

import type { BlockId } from "../../types";

/**
 * Read/write surface the {@link LiquidSimulator} uses. Implemented by the
 * {@link World}; the indirection keeps the simulator free of storage/Babylon
 * details and makes it unit-testable in isolation.
 */
export interface LiquidAccess {
  /** Block id at world coordinates (0 = air for unloaded/above-world). */
  getBlock(wx: number, wy: number, wz: number): BlockId;
  /** Per-voxel liquid level at world coordinates (0 for non-flowing). */
  getLevel(wx: number, wy: number, wz: number): number;
  /**
   * Write a block id + liquid level atomically. Handles chunk dirty-marking,
   * neighbour-mesh invalidation and lighting recompute. Returns true if the
   * cell actually changed (so the simulator can decide whether to wake
   * neighbours). MUST NOT re-enqueue liquid updates itself (the simulator owns
   * the queue) — it only performs the storage + render-side bookkeeping.
   */
  setLiquid(wx: number, wy: number, wz: number, id: BlockId, level: number): boolean;
  /** Whether the (cx,cz) chunk for these world coords is generated/loaded. */
  isChunkLoaded(wx: number, wz: number): boolean;
}

/** Debug snapshot consumed by the perf/liquid overlay. */
export interface LiquidDebugSnapshot {
  /** Positions currently waiting in the update queue (both lanes). */
  queueSize: number;
  /** Positions in the priority lane (player edits) — should stay small. */
  priorityQueueSize: number;
  /** Cells processed during the most recent scheduled tick. */
  processedLastTick: number;
  /** Configured per-tick cell budget. */
  budget: number;
  /** Total liquid cells written since the world started (monotonic). */
  totalWrites: number;
  /** Total cells processed via immediate post-edit bursts (monotonic). */
  priorityProcessed: number;
  /** Milliseconds since the last scheduled liquid tick (responsiveness signal). */
  msSinceLastTick: number;
  /** Number of chunks marked dirty for a remesh (live). */
  dirtyChunks: number;
}

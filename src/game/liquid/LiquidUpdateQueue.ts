// Bounded, deduplicating queue of voxel positions awaiting a liquid-flow
// recompute. Mirrors Luanti/Minetest's `transforming_liquid` queue: positions
// are added when a liquid cell (or a neighbour of one) changes, and a limited
// number are drained per tick so the whole world is never re-simulated.
//
// Two lanes:
//   • NORMAL   — simulator self-wakes (flow propagation) + chunk-gen seeding.
//     This is the bulk lane and can carry a backlog (a freshly streamed ocean
//     seeds thousands of shore cells).
//   • PRIORITY — player block edits. These MUST jump ahead of any backlog so
//     removing a block beside water reacts within a frame, not seconds.
//
// `dequeue` always serves PRIORITY first. The two lanes have independent dedup
// sets, so a cell present in both is processed once per lane — the second visit
// is a cheap no-op (state unchanged → no re-enqueue), which is harmless and
// avoids the O(n) cost of upgrading a normal entry to priority.

export interface QueuedCell {
  x: number;
  y: number;
  z: number;
}

export class LiquidUpdateQueue {
  /** Normal lane (flow propagation + seeding). */
  private readonly pending = new Set<string>();
  private fifo: QueuedCell[] = [];
  private fifoHead = 0;
  /** Priority lane (player edits) — drained before the normal lane. */
  private readonly priorityPending = new Set<string>();
  private priorityFifo: QueuedCell[] = [];
  private priorityFifoHead = 0;
  /** High-water mark (both lanes) since creation, for the debug overlay. */
  peakSize = 0;

  get size(): number {
    return this.pending.size + this.priorityPending.size;
  }

  /** Count in the priority lane only (debug). */
  get prioritySize(): number {
    return this.priorityPending.size;
  }

  /** Pack integer coords into a dedup key. */
  private key(x: number, y: number, z: number): string {
    return x + "|" + y + "|" + z;
  }

  private bumpPeak(): void {
    const s = this.pending.size + this.priorityPending.size;
    if (s > this.peakSize) this.peakSize = s;
  }

  /** Add a cell to the NORMAL lane (no-op if already pending there). */
  enqueue(x: number, y: number, z: number): void {
    const k = this.key(x, y, z);
    if (this.pending.has(k)) return;
    this.pending.add(k);
    this.fifo.push({ x, y, z });
    this.bumpPeak();
  }

  /**
   * Add a cell to the PRIORITY lane (player edits). Drained before the normal
   * lane so terrain changes react immediately even when a large background
   * backlog exists. No-op if already pending in the priority lane.
   */
  enqueuePriority(x: number, y: number, z: number): void {
    const k = this.key(x, y, z);
    if (this.priorityPending.has(k)) return;
    this.priorityPending.add(k);
    this.priorityFifo.push({ x, y, z });
    this.bumpPeak();
  }

  /** True if the cell is pending in either lane. */
  has(x: number, y: number, z: number): boolean {
    const k = this.key(x, y, z);
    return this.pending.has(k) || this.priorityPending.has(k);
  }

  /**
   * Pop the oldest PENDING cell, preferring the priority lane. Skips stale
   * entries (the Set is the source of truth; the FIFO is only for ordering).
   */
  dequeue(): QueuedCell | null {
    // Priority first.
    while (this.priorityFifoHead < this.priorityFifo.length) {
      const cell = this.priorityFifo[this.priorityFifoHead++]!;
      const k = this.key(cell.x, cell.y, cell.z);
      if (this.priorityPending.delete(k)) {
        this.compactPriority();
        return cell;
      }
    }
    this.compactPriority(true);
    // Then the normal backlog.
    while (this.fifoHead < this.fifo.length) {
      const cell = this.fifo[this.fifoHead++]!;
      const k = this.key(cell.x, cell.y, cell.z);
      if (this.pending.delete(k)) {
        this.compactNormal();
        return cell;
      }
    }
    this.compactNormal(true);
    return null;
  }

  /**
   * Pull one PRIORITY cell (used by the immediate post-edit burst so the first
   * flow step happens on the same frame as a player edit, before the next
   * scheduled tick). Returns null when the priority lane is empty.
   */
  pullPriority(): QueuedCell | null {
    while (this.priorityFifoHead < this.priorityFifo.length) {
      const cell = this.priorityFifo[this.priorityFifoHead++]!;
      const k = this.key(cell.x, cell.y, cell.z);
      if (this.priorityPending.delete(k)) {
        this.compactPriority();
        return cell;
      }
    }
    this.compactPriority(true);
    return null;
  }

  /** Empty both lanes (on world unload / sim reset). */
  clear(): void {
    this.pending.clear();
    this.fifo.length = 0;
    this.fifoHead = 0;
    this.priorityPending.clear();
    this.priorityFifo.length = 0;
    this.priorityFifoHead = 0;
  }

  /** Debug snapshot of queued positions (read-only; does not mutate). */
  snapshot(): readonly QueuedCell[] {
    return this.fifo.slice(this.fifoHead);
  }

  private compactNormal(force = false): void {
    if (this.fifoHead === 0) return;
    if (!force && this.fifoHead < 1024 && this.fifoHead * 2 < this.fifo.length) return;
    this.fifo = this.fifo.slice(this.fifoHead);
    this.fifoHead = 0;
  }

  private compactPriority(force = false): void {
    if (this.priorityFifoHead === 0) return;
    if (!force && this.priorityFifoHead < 1024 && this.priorityFifoHead * 2 < this.priorityFifo.length) return;
    this.priorityFifo = this.priorityFifo.slice(this.priorityFifoHead);
    this.priorityFifoHead = 0;
  }
}

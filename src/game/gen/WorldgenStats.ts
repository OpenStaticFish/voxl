// Rolling per-chunk generation statistics for the world-gen debug overlay.
// The orchestrator records one sample per generated chunk; this keeps an
// exponential moving average so a single slow chunk doesn't dominate and the
// overlay reads smoothly while streaming.

export interface ChunkGenSample {
  /** Wall-clock time to generate the chunk, in milliseconds. */
  ms: number;
  decorations: number;
  trees: number;
  caves: number;
  ores: number;
}

export interface WorldgenStatsSnapshot {
  /** EMA of per-chunk generation time. */
  avgMs: number;
  /** Last chunk's generation time. */
  lastMs: number;
  avgDecorations: number;
  avgTrees: number;
  avgCaves: number;
  avgOres: number;
  /** Total chunks generated this session. */
  chunks: number;
}

export class WorldgenStats {
  private avgMs = 0;
  private lastMs = 0;
  private avgDeco = 0;
  private avgTrees = 0;
  private avgCaves = 0;
  private avgOres = 0;
  private count = 0;
  private initialised = false;

  record(s: ChunkGenSample): void {
    this.lastMs = s.ms;
    this.count++;
    if (!this.initialised) {
      this.avgMs = s.ms;
      this.avgDeco = s.decorations;
      this.avgTrees = s.trees;
      this.avgCaves = s.caves;
      this.avgOres = s.ores;
      this.initialised = true;
      return;
    }
    const a = 0.92;
    this.avgMs = this.avgMs * a + s.ms * (1 - a);
    this.avgDeco = this.avgDeco * a + s.decorations * (1 - a);
    this.avgTrees = this.avgTrees * a + s.trees * (1 - a);
    this.avgCaves = this.avgCaves * a + s.caves * (1 - a);
    this.avgOres = this.avgOres * a + s.ores * (1 - a);
  }

  reset(): void {
    this.avgMs = this.lastMs = this.avgDeco = this.avgTrees = this.avgCaves = this.avgOres = 0;
    this.count = 0;
    this.initialised = false;
  }

  snapshot(): WorldgenStatsSnapshot {
    return {
      avgMs: this.avgMs,
      lastMs: this.lastMs,
      avgDecorations: this.avgDeco,
      avgTrees: this.avgTrees,
      avgCaves: this.avgCaves,
      avgOres: this.avgOres,
      chunks: this.count,
    };
  }
}

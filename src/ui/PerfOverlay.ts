// Developer performance overlay. Renders a compact read-out of frame rate,
// GPU/draw load, chunk streaming state, and the active graphics configuration.
// Toggle with F3. Pure read-only diagnostics — never part of gameplay UI.

export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  activeMeshes: number;
  totalMeshes: number;
  triangles: number;
  drawEstimate: number;
  loadedChunks: number;
  meshedChunks: number;
  visibleChunks: number;
  culledChunks: number;
  meshQueue: number;
  lightQueue: number;
  shadowCasters: number;
  shadowsEnabled: boolean;
  waterMeshes: number;
  /** Total vertices across all water (transparent) meshes — fill/overdraw signal. */
  waterVertices: number;
  preset: string;
  viewDistance: number;
  renderScale: number;
  dpr: number;
  renderWidth: number;
  renderHeight: number;
  heapUsedMB: number | null;
  gpuRenderer: string | null;
  timeOfDay: number;
  // Lighting / fog / water state for diagnosing the High-preset look.
  fogStart: number;
  fogEnd: number;
  ambientIntensity: number;
  sunIntensity: number;
  dayFactor: number;
  waterAlpha: number;
  waterQuality: string;
  antiAliasing: boolean;
  // Liquid / swimming state.
  inWater: boolean;
  underwater: boolean;
  liquidQueue: number;
  liquidPriorityQueue: number;
  liquidProcessed: number;
  liquidBudget: number;
  liquidWrites: number;
  liquidMsSinceTick: number;
  targetLiquidType: string;
  targetLiquidLevel: number;
  // Block targeting through water (Luanti-style pointability).
  targetMode: "solids" | "liquids";
  rayThroughLiquid: boolean;
  firstLiquid: { x: number; y: number; z: number } | null;
  waterSidesOn: boolean;
  waterAnimOn: boolean;
}

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

/**
 * Builds and owns the `#perf` DOM panel. {@link update} rewrites the text only
 * when called, so the caller controls the update cadence (throttled in Game's
 * tick to ~10 Hz to avoid layout thrash while still feeling live).
 */
export class PerfOverlay {
  private readonly root: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly frameEl: HTMLElement;
  private readonly drawsEl: HTMLElement;
  private readonly trisEl: HTMLElement;
  private readonly meshesEl: HTMLElement;
  private readonly chunksEl: HTMLElement;
  private readonly queuesEl: HTMLElement;
  private readonly shadowsEl: HTMLElement;
  private readonly configEl: HTMLElement;
  private readonly lightEl: HTMLElement;
  private readonly fogEl: HTMLElement;
  private readonly waterEl: HTMLElement;
  private readonly liquidEl: HTMLElement;
  private readonly targetEl: HTMLElement;
  private readonly memEl: HTMLElement;
  private visible = false;

  constructor() {
    // The container element lives in index.html (`<div id="perf" hidden>`); if
    // it is missing (older build), create it lazily so the overlay still works.
    let root = document.getElementById("perf");
    if (!root) {
      root = document.createElement("div");
      root.id = "perf";
      document.getElementById("app")?.appendChild(root);
    }
    root.hidden = true;
    root.innerHTML = "";
    const header = el("div", "perf-header");
    header.textContent = "VOXL · perf";
    const hint = el("span", "perf-hint");
    hint.textContent = "F3";
    header.appendChild(hint);
    root.appendChild(header);

    const grid = el("div", "perf-grid");
    this.fpsEl = mkline(grid, "fps");
    this.frameEl = mkline(grid, "frame");
    this.drawsEl = mkline(grid, "draws");
    this.trisEl = mkline(grid, "tris");
    this.meshesEl = mkline(grid, "meshes");
    this.chunksEl = mkline(grid, "chunks");
    this.queuesEl = mkline(grid, "queues");
    this.shadowsEl = mkline(grid, "shadows");
    this.configEl = mkline(grid, "config");
    this.lightEl = mkline(grid, "light");
    this.fogEl = mkline(grid, "fog");
    this.waterEl = mkline(grid, "water");
    this.liquidEl = mkline(grid, "liquid");
    this.targetEl = mkline(grid, "target");
    this.memEl = mkline(grid, "mem");
    root.appendChild(grid);

    this.root = root;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.hidden = !visible;
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  get isOpen(): boolean {
    return this.visible;
  }

  update(s: PerfSnapshot): void {
    if (!this.visible) return;
    setLine(this.fpsEl, `${Math.round(s.fps)}`, fpsColor(s.fps));
    setLine(this.frameEl, `${s.frameMs.toFixed(1)} ms`, frameColor(s.frameMs));
    setLine(this.drawsEl, `~${s.drawEstimate}`);
    setLine(this.trisEl, `${formatK(s.triangles)} tris`);
    setLine(this.meshesEl, `${s.activeMeshes}/${s.totalMeshes} active`);
    setLine(this.chunksEl, `${s.loadedChunks} loaded · ${s.meshedChunks} meshed · ${s.visibleChunks} vis · ${s.culledChunks} culled`);
    setLine(this.queuesEl, `mesh ${s.meshQueue} · light ${s.lightQueue}`);
    setLine(
      this.shadowsEl,
      s.shadowsEnabled ? `on · ${s.shadowCasters} casters` : "off",
      s.shadowsEnabled ? "var(--accent)" : "var(--ink-dim)",
    );
    setLine(
      this.configEl,
      `${s.preset} · dist ${s.viewDistance} · scale ${s.renderScale.toFixed(2)} · dpr ${s.dpr} · ${s.renderWidth}×${s.renderHeight}${s.antiAliasing ? " · fxaa" : ""}`,
    );
    setLine(
      this.lightEl,
      `amb ${s.ambientIntensity.toFixed(2)} · sun ${s.sunIntensity.toFixed(2)} · day ${s.dayFactor.toFixed(2)}`,
    );
    setLine(this.fogEl, `start ${Math.round(s.fogStart)} · end ${Math.round(s.fogEnd)}`);
    setLine(this.waterEl, `${s.waterQuality} · alpha ${s.waterAlpha.toFixed(2)} · ${s.waterMeshes} meshes · ${formatK(s.waterVertices)} verts`);
    const liquidState =
      (s.underwater ? "under" : s.inWater ? "in-water" : "dry") +
      ` · tgt ${s.targetLiquidType}${s.targetLiquidType === "flowing" ? ` L${s.targetLiquidLevel}` : ""}`;
    setLine(
      this.liquidEl,
      `q ${s.liquidQueue} (pri ${s.liquidPriorityQueue}) · ${s.liquidProcessed}/${s.liquidBudget}/tick · ${s.liquidMsSinceTick.toFixed(0)}ms · ${formatK(s.liquidWrites)} writes · ${liquidState}`,
      s.liquidMsSinceTick > 300 ? "var(--danger)" : s.liquidMsSinceTick > 150 ? "var(--warm)" : "",
    );
    const fl = s.firstLiquid;
    setLine(
      this.targetEl,
      `${s.targetMode} · ${s.rayThroughLiquid ? "through water" : "no water in ray"}${fl ? ` · 1st liq ${fl.x},${fl.y},${fl.z}` : ""} · sides ${s.waterSidesOn ? "on" : "off"} · anim ${s.waterAnimOn ? "on" : "off"}`,
    );
    const tod = `t ${Math.floor(s.timeOfDay * 24).toString().padStart(2, "0")}:${Math.floor(((s.timeOfDay * 24) % 1) * 60).toString().padStart(2, "0")}`;
    if (s.heapUsedMB !== null) {
      setLine(this.memEl, `${s.heapUsedMB.toFixed(0)} MB JS · ${tod}${s.gpuRenderer ? " · " + s.gpuRenderer : ""}`);
    } else {
      setLine(this.memEl, `${tod}${s.gpuRenderer ? " · " + s.gpuRenderer : ""}`);
    }
  }
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function mkline(parent: HTMLElement, label: string): HTMLElement {
  const row = el("div", "perf-line");
  const lbl = el("span", "perf-label");
  lbl.textContent = label;
  const val = el("span", "perf-value");
  row.appendChild(lbl);
  row.appendChild(val);
  parent.appendChild(row);
  return val;
}

function setLine(node: HTMLElement, text: string, color?: string): void {
  node.textContent = text;
  node.style.color = color ?? "";
}

function fpsColor(fps: number): string {
  if (fps >= 55) return "var(--accent)";
  if (fps >= 40) return "var(--warm)";
  return "var(--danger)";
}

function frameColor(ms: number): string {
  if (ms <= 18) return "var(--accent)";
  if (ms <= 28) return "var(--warm)";
  return "var(--danger)";
}

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

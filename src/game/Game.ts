import {
  Color3,
  Color4,
  DynamicTexture,
  LinesMesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import {
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
} from "../constants";
import type { GameState, Settings } from "../types";
import { Renderer } from "../engine/Renderer";
import { createTextureAtlas } from "../engine/Textures";
import { Sky } from "../engine/Sky";
import { Input } from "../engine/Input";
import { captureScreenshot } from "../engine/Screenshot";
import { World } from "./World";
import { Player } from "./Player";
import { HOTBAR_BLOCKS, getBlock } from "./Blocks";
import { ScreenManager } from "../ui/ScreenManager";
import { HUD } from "../ui/HUD";
import { Menus } from "../ui/Menus";
import { loadSettings, saveSettings } from "../state/Settings";

const SPAWN_PREGEN_RADIUS = 2;

const SKY_COLOR_HEX = "#bfe3ff";

/**
 * Top-level orchestrator. Owns the renderer (Babylon Engine), the scene, the
 * world, player, input, and UI; runs the fixed-pace game loop; and drives the
 * menu/play/pause state machine plus block editing, hotbar, settings, and
 * screenshots.
 */
export class Game {
  private state: GameState = "menu";
  private readonly renderer: Renderer;
  private readonly scene: Scene;
  private readonly sky: Sky;
  private readonly atlas: DynamicTexture;
  private world: World | null = null;
  private readonly player: Player;
  private readonly input: Input;
  private readonly screens: ScreenManager;
  private readonly hud: HUD;
  private readonly menus: Menus;
  private settings: Settings;

  private readonly highlight: LinesMesh;

  private selectedIndex = 0;
  private last = performance.now();
  private fpsEma = 60;
  private hudTimer = 0;
  private running = false;

  constructor(host: HTMLElement) {
    this.settings = loadSettings();

    this.renderer = new Renderer(host);
    const scene = new Scene(this.renderer.engine);
    // Right-handed coordinates — keeps the world-gen, physics, and raycast math
    // identical to the prior three.js implementation (camera looks down -Z,
    // +X right, +Y up).
    scene.useRightHandedSystem = true;

    const sky = Color3.FromHexString(SKY_COLOR_HEX);
    scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    scene.ambientColor = new Color3(1, 1, 1);
    // Fog is read live by the cloud ShaderMaterial via Sky.update().
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = sky.clone();
    scene.fogStart = 60;
    scene.fogEnd = 220;

    this.scene = scene;

    this.atlas = createTextureAtlas(scene).texture;
    this.sky = new Sky(this.settings.seed, scene);

    this.player = new Player(window.innerWidth / window.innerHeight, scene);
    this.player.setFov(this.settings.fov);
    scene.activeCamera = this.player.camera;

    this.input = new Input(this.renderer.canvas);
    this.screens = new ScreenManager();
    this.hud = new HUD();
    this.menus = new Menus(this.screens, this.settings);

    this.highlight = makeHighlight(scene);

    this.sky.setCloudsEnabled(this.settings.clouds);
    this.hud.setFpsVisible(this.settings.showFps);
    this.hud.setSelected(this.selectedIndex);
    this.screens.setMenuSeed(this.settings.seed);

    this.bindCallbacks();
    this.bindGlobalEvents();
  }

  // ---------------------------------------------------------------- setup ---

  private bindCallbacks(): void {
    this.screens.onEnterPlaying = () => {
      // pointer lock requested on user gesture elsewhere
    };
    this.screens.onEnterMenu = () => {
      this.input.exitLock();
    };

    this.menus.onPlay = () => this.startGame();
    this.menus.onResume = () => this.resume();
    this.menus.onQuit = () => this.quitToMenu();
    this.menus.onSettingsChange = (patch) => this.applySettings(patch);
    this.menus.onRegenerate = (seed) => this.regenerate(seed);

    this.input.onPointerLockChange = (locked) => {
      // Don't auto-pause when the pointer leaves — only auto-resume if the
      // user re-locks while already paused.
      if (locked && this.state === "paused") this.setPlaying();
    };
    this.input.onNumberKey = (n) => this.selectSlot(n - 1);
    this.input.onScroll = (dir) => this.selectSlot(this.selectedIndex + dir);
    this.input.onKey = (code, down) => {
      if (!down) return;
      if (code === "KeyP") void this.takeScreenshot();
      if (code === "KeyF") this.selectSlot(this.selectedIndex + 1);
      if (code === "Escape" && this.state === "playing") this.pause();
    };
  }

  private bindGlobalEvents(): void {
    window.addEventListener("resize", this.handleResize);
    // Clicking the canvas while playing re-acquires pointer lock if lost.
    this.renderer.canvas.addEventListener("click", () => {
      if (this.state === "playing" && !this.input.locked) this.input.requestLock();
    });
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.player.setAspect(w / h);
  };

  // ----------------------------------------------------------- settings ---

  private applySettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.screens.setMenuSeed(this.settings.seed);
    if (patch.fov !== undefined) this.player.setFov(patch.fov);
    if (patch.clouds !== undefined) this.sky.setCloudsEnabled(patch.clouds);
    if (patch.showFps !== undefined) this.hud.setFpsVisible(patch.showFps);
    // viewDistance + mouseSensitivity are read live during the loop.
    if (patch.viewDistance !== undefined) {
      this.updateFog();
    }
    this.menus.updateCurrent(this.settings);
  }

  // -------------------------------------------------------- game states ---

  private startGame(): void {
    this.setState("loading");
    this.createWorld(this.settings.seed);
    // Synchronous pre-generation around spawn so the player has ground.
    this.player.spawn(this.world!, 0, 0);
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const pcx = Math.floor(px / 16);
    const pcz = Math.floor(pz / 16);
    for (let dx = -SPAWN_PREGEN_RADIUS; dx <= SPAWN_PREGEN_RADIUS; dx++) {
      for (let dz = -SPAWN_PREGEN_RADIUS; dz <= SPAWN_PREGEN_RADIUS; dz++) {
        this.world!.ensureGenerated(pcx + dx, pcz + dz);
      }
    }
    // Pre-mesh the close area so the first frame already looks good.
    for (let i = 0; i < 10; i++) this.world!.update(px, pz, this.settings.viewDistance);
    this.updateFog();
    this.setPlaying();
    // Request pointer lock within the user gesture (Play click).
    this.input.requestLock();
  }

  private regenerate(seed: string): void {
    this.applySettings({ seed });
    if (this.state === "playing" || this.state === "paused") {
      this.setState("loading");
      this.createWorld(seed);
      this.player.spawn(this.world!, 0, 0);
      for (let i = 0; i < 10; i++) this.world!.update(this.player.position.x, this.player.position.z, this.settings.viewDistance);
      this.updateFog();
      this.setPlaying();
      this.input.requestLock();
    }
  }

  private createWorld(seed: string): void {
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
    this.world = new World(seed, this.atlas, this.scene);
    // Re-seed the cloud field so it matches the new world.
    this.sky.setCloudSeed(seed);
  }

  private setPlaying(): void {
    this.state = "playing";
    this.screens.applyState("playing");
    this.hud.setCrosshairVisible(true);
    this.input.clearTransient();
    this.last = performance.now();
  }

  private pause(): void {
    this.state = "paused";
    this.screens.applyState("paused");
    this.hud.setCrosshairVisible(false);
    this.input.clearTransient();
  }

  private resume(): void {
    this.input.requestLock();
    // setPlaying happens once the lock is acquired (pointerlockchange).
    // Fallback in case the lock is granted without firing:
    setTimeout(() => {
      if (this.state === "paused") this.setPlaying();
    }, 200);
  }

  private quitToMenu(): void {
    this.input.exitLock();
    this.input.clearTransient();
    this.setState("menu");
  }

  private setState(state: GameState): void {
    this.state = state;
    this.screens.applyState(state);
    if (state === "menu") this.hud.setCrosshairVisible(false);
  }

  // ------------------------------------------------------------- loop ---

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.renderer.engine.runRenderLoop(this.tick);
  }

  private tick = (): void => {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05; // clamp to avoid huge steps after tab switches

    if (this.state === "playing") {
      this.update(dt);
    } else if (this.state === "paused") {
      // Keep the world rendering but freeze simulation; still stream meshes so
      // resuming is instant.
      this.world?.update(this.player.position.x, this.player.position.z, this.settings.viewDistance);
    }

    this.sky.update(dt, this.player.camera.position);
    this.scene.render();

    this.updateFps(dt);
  };

  private update(dt: number): void {
    this.player.update(dt, this.world!, this.input, this.settings);
    this.world!.update(this.player.position.x, this.player.position.z, this.settings.viewDistance);

    // Block highlight
    const target = this.player.getTarget();
    if (target) {
      this.highlight.isVisible = true;
      this.highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    } else {
      this.highlight.isVisible = false;
    }

    // Break / place
    const clicks = this.input.consumeClicks();
    if (clicks.break && target) this.breakBlock(target);
    if (clicks.place && target) this.placeBlock(target);

    // HUD status (throttled)
    this.hudTimer += dt;
    if (this.hudTimer >= 0.15) {
      this.hudTimer = 0;
      const p = this.player.position;
      this.hud.setCoords(p.x, p.y, p.z);
      this.hud.setMode(this.player.flying ? "Flying" : this.player.inWater ? "Swimming" : "Walking");
    }
  }

  private breakBlock(t: { x: number; y: number; z: number }): void {
    const id = this.world!.getBlock(t.x, t.y, t.z);
    if (id === 8) {
      this.hud.showToast("Bedrock is unbreakable");
      return;
    }
    this.world!.setBlock(t.x, t.y, t.z, 0);
  }

  private placeBlock(t: { px: number; py: number; pz: number }): void {
    const id = HOTBAR_BLOCKS[this.selectedIndex];
    if (!getBlock(id).solid) {
      // Allow water placement too; skip the inside-player check for fluids.
      this.world!.setBlock(t.px, t.py, t.pz, id);
      return;
    }
    if (this.intersectsPlayer(t.px, t.py, t.pz)) {
      this.hud.showToast("Can't place a block inside yourself");
      return;
    }
    this.world!.setBlock(t.px, t.py, t.pz, id);
  }

  private intersectsPlayer(bx: number, by: number, bz: number): boolean {
    const p = this.player.position;
    const minX = p.x - PLAYER_HALF_WIDTH;
    const maxX = p.x + PLAYER_HALF_WIDTH;
    const minY = p.y;
    const maxY = p.y + PLAYER_HEIGHT;
    const minZ = p.z - PLAYER_HALF_WIDTH;
    const maxZ = p.z + PLAYER_HALF_WIDTH;
    return (
      maxX > bx &&
      minX < bx + 1 &&
      maxY > by &&
      minY < by + 1 &&
      maxZ > bz &&
      minZ < bz + 1
    );
  }

  private selectSlot(index: number): void {
    const len = HOTBAR_BLOCKS.length;
    this.selectedIndex = ((index % len) + len) % len;
    this.hud.setSelected(this.selectedIndex);
  }

  // --------------------------------------------------------- screens ---

  private updateFog(): void {
    const far = this.settings.viewDistance * 16 * 1.7;
    this.scene.fogEnd = far;
    this.scene.fogStart = far * 0.4;
  }

  private updateFps(dt: number): void {
    if (dt <= 0) return;
    const instant = 1 / dt;
    this.fpsEma += (instant - this.fpsEma) * 0.1;
    if (this.settings.showFps) this.hud.setFps(Math.round(this.fpsEma));
  }

  // ------------------------------------------------------ screenshot ---

  async takeScreenshot(): Promise<void> {
    // Ensure the canvas holds a freshly rendered frame.
    this.scene.render();
    const name = this.state === "menu" || this.state === "loading" ? "main-menu.png" : "in-game.png";
    try {
      const saved = await captureScreenshot(this.renderer.canvas, name);
      this.hud.showToast(`Saved ${saved} (check Downloads)`);
    } catch {
      this.hud.showToast("Screenshot failed");
    }
  }

  // --------------------------------------------------------- dispose ---

  dispose(): void {
    this.renderer.engine.stopRenderLoop();
    this.running = false;
    window.removeEventListener("resize", this.handleResize);
    this.input.dispose();
    this.world?.dispose();
    this.sky.dispose();
    this.atlas.dispose();
    this.highlight.dispose();
    this.scene.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------ public API ---
  // Used by the optional Playwright screenshot script (see scripts/screenshot.ts).

  beginPlay(): void {
    if (this.state === "menu" || this.state === "paused") this.startGame();
  }

  screenshotDataURL(filename = "in-game.png"): string {
    this.scene.render();
    return this.renderer.canvas.toDataURL("image/png");
  }

  getChunkCount(): number {
    return this.world?.chunkCount ?? 0;
  }

  getGameState(): GameState {
    return this.state;
  }

  /** TEMP debug: dump all chunk coords that are loaded. */
  _loadedChunks(): unknown {
    if (!this.world) return [];
    const chunks = (this.world as any).chunks as Map<string, unknown>;
    return [...chunks.keys()];
  }

  /** TEMP debug: replace all chunk materials with a flat unlit colour so the
   *  world can be inspected without atlas/texture noise. Toggle via
   *  `__voxl.debugFlat()` from the devtools console. */
  _enableDebugFlat(): void {
    if (!this.world) return;
    const mat = new StandardMaterial("debug-flat", this.scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.emissiveColor = new Color3(0.6, 0.6, 0.6);
    mat.specularColor = new Color3(0, 0, 0);
    for (const m of (this.world as any).root.getChildMeshes() as any[]) {
      m.material = mat;
    }
  }
}

/** Builds the wireframe block-selection outline as a LinesMesh with the 12
 *  edges of a unit cube (matches the prior three.js BoxGeometry+EdgesGeometry). */
function makeHighlight(scene: Scene): LinesMesh {
  const s = 1.002 / 2; // half-extent
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const edges: Vector3[][] = [
    // bottom face
    [v(-s, -s, -s), v(s, -s, -s)],
    [v(s, -s, -s), v(s, -s, s)],
    [v(s, -s, s), v(-s, -s, s)],
    [v(-s, -s, s), v(-s, -s, -s)],
    // top face
    [v(-s, s, -s), v(s, s, -s)],
    [v(s, s, -s), v(s, s, s)],
    [v(s, s, s), v(-s, s, s)],
    [v(-s, s, s), v(-s, s, -s)],
    // verticals
    [v(-s, -s, -s), v(-s, s, -s)],
    [v(s, -s, -s), v(s, s, -s)],
    [v(s, -s, s), v(s, s, s)],
    [v(-s, -s, s), v(-s, s, s)],
  ];
  const lines = MeshBuilder.CreateLineSystem("highlight", { lines: edges, updatable: false }, scene);
  lines.color = new Color3(0, 0, 0);
  lines.alpha = 0.4;
  lines.isVisible = false;
  lines.isPickable = false;
  lines.alwaysSelectAsActiveMesh = true;
  lines.applyFog = false;
  return lines;
}

import {
  Color3,
  Color4,
  DynamicTexture,
  LinesMesh,
  Mesh,
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
import { getBlock } from "./Blocks";
import {
  STARTER_CREATIVE_HOTBAR,
  STARTER_SURVIVAL_KIT,
  digTime,
  dropForBlock,
  getItem,
  isBreakable,
  isFood,
  type GameMode,
} from "./Items";
import { Inventory } from "./Inventory";
import { PlayerState } from "./PlayerState";
import { clearSave, loadSave, writeSave } from "../state/SaveData";
import { ScreenManager } from "../ui/ScreenManager";
import { HUD } from "../ui/HUD";
import { Menus } from "../ui/Menus";
import { InventoryUI } from "../ui/InventoryUI";
import { loadSettings, saveSettings } from "../state/Settings";
import { dbg, dbgWarn } from "../state/Debug";

const SPAWN_PREGEN_RADIUS = 2;
const SKY_COLOR_HEX = "#bfe3ff";
const EAT_TIME = 1.6;
const INVENTORY_SIZE = 36;
const HOTBAR_SIZE = 9;

/**
 * Top-level orchestrator. Owns the renderer (Babylon Engine), the scene, the
 * world, player, input, UI, the inventory + survival systems, and the game loop.
 * Drives the menu/play/pause state machine plus block editing, mining progress,
 * eating, health/hunger/breath, death/respawn, and per-seed saving.
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
  private readonly breakOverlay: Mesh;
  private readonly breakMaterial: StandardMaterial;

  private readonly inventory = new Inventory(INVENTORY_SIZE, HOTBAR_SIZE);
  private readonly stats = new PlayerState();
  private readonly invUI: InventoryUI;

  private selectedIndex = 0;
  private last = performance.now();
  private fpsEma = 60;
  private hudTimer = 0;
  private running = false;

  private inventoryOpen = false;
  private spawnPoint = new Vector3(0.5, 40, 0.5);

  // Mining / interaction transient state
  private mining: { x: number; y: number; z: number; progress: number } | null = null;
  private breakCooldown = 0;
  private eatProgress = 0;
  private sprintExhaustT = 0;
  private cactusT = 0;
  private saveTimer = 0;
  private lastTargetKey = "";

  constructor(host: HTMLElement) {
    this.settings = loadSettings();

    this.renderer = new Renderer(host);
    const scene = new Scene(this.renderer.engine);
    scene.useRightHandedSystem = true;

    const sky = Color3.FromHexString(SKY_COLOR_HEX);
    scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    scene.ambientColor = new Color3(1, 1, 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = sky.clone();
    scene.fogStart = 60;
    scene.fogEnd = 220;

    this.scene = scene;

    this.atlas = createTextureAtlas(scene).texture;
    this.sky = new Sky(this.settings.seed, scene);

    this.player = new Player(window.innerWidth / window.innerHeight, scene);
    this.player.setFov(this.settings.fov);
    this.player.canFly = this.settings.mode === "creative";
    scene.activeCamera = this.player.camera;

    this.input = new Input(this.renderer.canvas);
    this.screens = new ScreenManager();
    this.hud = new HUD();
    this.menus = new Menus(this.screens, this.settings);
    this.invUI = new InventoryUI(
      document.getElementById("inventory-screen") as HTMLElement,
      this.inventory,
      () => this.settings.mode,
    );

    this.highlight = makeHighlight(scene);
    const { mesh, material } = makeBreakOverlay(scene);
    this.breakOverlay = mesh;
    this.breakMaterial = material;

    this.sky.setCloudsEnabled(this.settings.clouds);
    this.hud.setFpsVisible(this.settings.showFps);
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

    this.invUI.onModeChange = (mode) => this.setMode(mode);
    this.invUI.onClose = () => this.closeInventory();
    this.invUI.onRefresh = () => this.refreshHud();

    this.input.onPointerLockChange = (locked) => {
      if (locked && this.state === "paused") this.setPlaying();
    };
    this.input.onPointerLockError = () => {
      this.hud.showToast("Click the game to capture the mouse");
    };
    this.input.onNumberKey = (n) => this.selectSlot(n - 1);
    this.input.onScroll = (dir) => this.selectSlot(this.selectedIndex + dir);
    this.input.onKey = (code, down) => {
      if (!down) return;
      if (code === "KeyP") void this.takeScreenshot();
      if (code === "KeyF") this.selectSlot(this.selectedIndex + 1);
      if (code === "KeyE" && (this.state === "playing" || this.inventoryOpen)) this.toggleInventory();
      if (code === "Escape") {
        if (this.inventoryOpen) this.closeInventory();
        else if (this.state === "playing") this.pause();
      }
    };
  }

  private bindGlobalEvents(): void {
    window.addEventListener("resize", this.handleResize);
    this.renderer.canvas.addEventListener("click", () => {
      if (this.state === "playing" && !this.input.locked && !this.inventoryOpen) this.input.requestLock();
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
    if (patch.viewDistance !== undefined) this.updateFog();
    if (patch.mode !== undefined) {
      this.player.canFly = patch.mode === "creative";
      if (patch.mode === "survival") this.player.flying = false;
      this.invUI.refresh();
      this.refreshHud();
    }
    this.menus.updateCurrent(this.settings);
  }

  // ------------------------------------------------------ game states ---

  private startGame(): void {
    this.setState("loading");
    this.createWorld(this.settings.seed);
    this.player.spawn(this.world!, 0, 0);
    this.spawnPoint = this.player.position.clone();
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const pcx = Math.floor(px / 16);
    const pcz = Math.floor(pz / 16);
    for (let dx = -SPAWN_PREGEN_RADIUS; dx <= SPAWN_PREGEN_RADIUS; dx++) {
      for (let dz = -SPAWN_PREGEN_RADIUS; dz <= SPAWN_PREGEN_RADIUS; dz++) {
        this.world!.ensureGenerated(pcx + dx, pcz + dz);
      }
    }
    for (let i = 0; i < 10; i++) this.world!.update(px, pz, this.settings.viewDistance);
    this.updateFog();
    this.loadOrCreateProgress();
    this.player.canFly = this.settings.mode === "creative";
    this.refreshHud();
    this.setPlaying();
    this.input.requestLock();
  }

  private regenerate(seed: string): void {
    this.saveState();
    this.applySettings({ seed });
    if (this.state === "playing" || this.state === "paused") {
      this.setState("loading");
      this.createWorld(seed);
      this.player.spawn(this.world!, 0, 0);
      this.spawnPoint = this.player.position.clone();
      for (let i = 0; i < 10; i++) this.world!.update(this.player.position.x, this.player.position.z, this.settings.viewDistance);
      this.updateFog();
      this.loadOrCreateProgress();
      this.refreshHud();
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
    this.sky.setCloudSeed(seed);
  }

  /** Load inventory+vitals for this seed, or seed a fresh starter kit. */
  private loadOrCreateProgress(): void {
    const save = loadSave(this.settings.seed);
    if (save) {
      this.inventory.load(save.inventory);
      this.stats.load(save.stats);
      if (save.mode && save.mode !== this.settings.mode) {
        this.applySettings({ mode: save.mode });
      }
      return;
    }
    this.inventory.clear();
    this.stats.reset();
    if (this.settings.mode === "creative") {
      for (let i = 0; i < STARTER_CREATIVE_HOTBAR.length && i < HOTBAR_SIZE; i++) {
        this.inventory.setSlot(i, { id: STARTER_CREATIVE_HOTBAR[i], count: 64 });
      }
    } else {
      for (const kit of STARTER_SURVIVAL_KIT) this.inventory.add(kit.id, kit.count);
    }
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
    setTimeout(() => {
      if (this.state === "paused") this.setPlaying();
    }, 200);
  }

  private quitToMenu(): void {
    this.saveState();
    this.closeInventorySilent();
    this.input.exitLock();
    this.input.clearTransient();
    this.setState("menu");
  }

  private setState(state: GameState): void {
    this.state = state;
    this.screens.applyState(state);
    if (state === "menu") this.hud.setCrosshairVisible(false);
  }

  // ----------------------------------------------------------- inventory ---

  private toggleInventory(): void {
    if (this.inventoryOpen) this.closeInventory();
    else this.openInventory();
  }

  private openInventory(): void {
    this.inventoryOpen = true;
    this.mining = null;
    this.breakOverlay.isVisible = false;
    this.highlight.isVisible = false;
    this.hud.setCrosshairVisible(false);
    this.input.exitLock();
    this.invUI.open();
  }

  private closeInventory(): void {
    this.invUI.close();
    this.inventoryOpen = false;
    this.hud.setCrosshairVisible(true);
    this.refreshHud();
    this.saveState();
    if (this.state === "playing") this.input.requestLock();
  }

  /** Close without re-locking pointer (used on quit). */
  private closeInventorySilent(): void {
    if (!this.inventoryOpen) return;
    this.invUI.close();
    this.inventoryOpen = false;
  }

  private setMode(mode: GameMode): void {
    this.applySettings({ mode });
    this.hud.showToast(mode === "creative" ? "Creative mode" : "Survival mode");
    this.saveState();
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
    if (dt > 0.05) dt = 0.05;

    if (this.state === "playing") {
      if (this.inventoryOpen) {
        // Freeze the action but keep the world streaming + rendering.
        this.world?.update(this.player.position.x, this.player.position.z, this.settings.viewDistance);
      } else {
        this.update(dt);
      }
    } else if (this.state === "paused") {
      this.world?.update(this.player.position.x, this.player.position.z, this.settings.viewDistance);
    }

    this.sky.update(dt, this.player.camera.position);
    this.scene.render();
    this.updateFps(dt);
  };

  private update(dt: number): void {
    const world = this.world!;
    const mode = this.settings.mode;
    this.player.update(dt, world, this.input, this.settings);
    world.update(this.player.position.x, this.player.position.z, this.settings.viewDistance);

    if (this.breakCooldown > 0) this.breakCooldown -= dt;

    // --- Survival vitals ---
    if (mode === "survival") {
      const fall = this.player.consumeFallDistance();
      const fallDmg = PlayerState.fallDamage(fall);
      if (fallDmg > 0) this.stats.damage(fallDmg, mode);

      if (this.player.touchingCactus(world)) {
        this.cactusT += dt;
        if (this.cactusT >= 1) {
          this.cactusT -= 1;
          this.stats.damage(1, mode);
        }
      } else {
        this.cactusT = 0;
      }

      const sprinting = this.input.isDown("ControlLeft") || this.input.isDown("ControlRight");
      const moving = this.input.isDown("KeyW") || this.input.isDown("KeyA") || this.input.isDown("KeyS") || this.input.isDown("KeyD");
      if (sprinting && moving && this.player.onGround && !this.player.flying) {
        this.sprintExhaustT += dt;
        if (this.sprintExhaustT >= 1) {
          this.sprintExhaustT -= 1;
          this.stats.addExhaustion(100);
        }
      }

      this.stats.tick(dt, mode, this.player.headSubmerged(world));
      if (this.stats.dead) {
        this.respawn();
        return;
      }
    } else {
      this.stats.breath = 10;
    }

    // --- Block highlight ---
    const target = this.player.getTarget();
    {
      const key = target ? `${target.x},${target.y},${target.z}=#${target.block}` : "none";
      if (key !== this.lastTargetKey) {
        this.lastTargetKey = key;
        dbg("target ->", target ? JSON.stringify({ x: target.x, y: target.y, z: target.z, block: target.block, px: target.px, py: target.py, pz: target.pz }) : "null (no block in reach / not aimed at one)");
      }
    }
    if (target) {
      this.highlight.isVisible = true;
      this.highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    } else {
      this.highlight.isVisible = false;
    }

    // --- Break / place / eat ---
    const clicks = this.input.consumeClicks();
    if (clicks.break || clicks.place) dbg("consumeClicks ->", JSON.stringify(clicks));

    // Break: creative = instant on click edge; survival = hold-to-mine.
    if (mode === "creative") {
      if (clicks.break && target) {
        dbg("creative: instant break on click");
        this.breakBlock(target.x, target.y, target.z);
      }
    } else {
      this.updateMining(dt, target, mode);
    }

    // Place / eat (right mouse)
    const selected = this.inventory.getSlot(this.selectedIndex);
    const foodSelected = !!selected && isFood(selected.id);
    if (clicks.place && target && !foodSelected) this.placeBlock(target);
    this.updateEating(dt, foodSelected, mode);

    // --- HUD status (throttled) ---
    this.hudTimer += dt;
    if (this.hudTimer >= 0.15) {
      this.hudTimer = 0;
      const p = this.player.position;
      this.hud.setCoords(p.x, p.y, p.z);
      this.hud.setMode(mode === "creative" ? "Creative" : this.player.flying ? "Flying" : this.player.inWater ? "Swimming" : "Survival");
      this.hud.setLockHint(this.input.locked);
      this.refreshHud();
    }

    // --- Periodic save ---
    this.saveTimer += dt;
    if (this.saveTimer >= 5) {
      this.saveTimer = 0;
      this.saveState();
    }
  }

  private updateMining(dt: number, target: ReturnType<Player["getTarget"]>, mode: GameMode): void {
    if (this.breakCooldown > 0) {
      if (this.input.leftHeld && target) dbgWarn("mining blocked by cooldown=" + this.breakCooldown.toFixed(3));
      this.breakOverlay.isVisible = false;
      return;
    }
    if (this.input.leftHeld && target) {
      const id = this.world!.getBlock(target.x, target.y, target.z);
      if (!isBreakable(id)) {
        dbgWarn("target block " + id + " is not breakable");
        this.mining = null;
        this.breakOverlay.isVisible = false;
        this.hud.showToast("Can't break this block");
        this.breakCooldown = 0.3;
        return;
      }
      if (!this.mining || this.mining.x !== target.x || this.mining.y !== target.y || this.mining.z !== target.z) {
        dbg("start mining", JSON.stringify({ x: target.x, y: target.y, z: target.z, id, digTime: digTime(id, mode) }));
        this.mining = { x: target.x, y: target.y, z: target.z, progress: 0 };
      }
      const t = digTime(id, mode);
      if (t === 0) {
        dbg("instant break (creative) id=" + id);
        this.breakBlock(this.mining.x, this.mining.y, this.mining.z);
        this.mining = null;
        this.breakCooldown = 0.12;
        this.breakOverlay.isVisible = false;
        return;
      }
      this.mining.progress += dt;
      // Show break overlay tint growing with progress.
      this.breakOverlay.isVisible = true;
      this.breakOverlay.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
      this.breakMaterial.alpha = Math.min(0.7, 0.12 + (this.mining.progress / t) * 0.6);
      if (this.mining.progress >= t) {
        dbg("mining complete (progress " + this.mining.progress.toFixed(2) + " >= " + t + ")");
        this.breakBlock(this.mining.x, this.mining.y, this.mining.z);
        this.mining = null;
        this.breakCooldown = 0.12;
        this.breakOverlay.isVisible = false;
      }
    } else {
      if (this.mining) dbg("mining cancelled (leftHeld=" + this.input.leftHeld + " target=" + (target ? "yes" : "no") + ")");
      this.mining = null;
      this.breakOverlay.isVisible = false;
    }
  }

  private updateEating(dt: number, foodSelected: boolean, mode: GameMode): void {
    if (this.input.rightHeld && foodSelected) {
      this.eatProgress += dt;
      if (this.eatProgress >= EAT_TIME) {
        const sel = this.inventory.getSlot(this.selectedIndex);
        if (sel && isFood(sel.id)) {
          const def = getItem(sel.id);
          if (def?.food) {
            this.stats.eat(def.food);
            if (mode === "survival") this.inventory.consumeOne(this.selectedIndex);
            this.refreshHud();
            this.hud.showToast(`Ate ${def.name}`);
          }
        }
        this.eatProgress = 0;
      }
    } else {
      this.eatProgress = 0;
    }
  }

  private breakBlock(x: number, y: number, z: number): void {
    const world = this.world!;
    const id = world.getBlock(x, y, z);
    dbg("breakBlock", JSON.stringify({ x, y, z, id, breakable: isBreakable(id) }));
    if (!isBreakable(id)) return;
    const changed = world.setBlock(x, y, z, 0);
    dbg("  setBlock -> changed=" + changed);
    if (this.settings.mode === "survival") {
      const drop = dropForBlock(id);
      if (drop !== null) {
        const leftover = this.inventory.add(drop, 1);
        if (leftover > 0) this.hud.showToast("Inventory full");
      }
      this.stats.addExhaustion(5);
      this.refreshHud();
    }
  }

  private placeBlock(t: { px: number; py: number; pz: number }): void {
    const sel = this.inventory.getSlot(this.selectedIndex);
    dbg("placeBlock", JSON.stringify({ sel: sel ? sel.id : null, px: t.px, py: t.py, pz: t.pz }));
    if (!sel) {
      dbgWarn("  no item in selected slot " + this.selectedIndex + " — nothing to place");
      return;
    }
    const def = getItem(sel.id);
    if (!def || def.block === undefined) {
      dbgWarn("  selected item " + sel.id + " is not placeable (food/non-block)");
      return;
    }
    const block = def.block;
    if (getBlock(block).solid && this.intersectsPlayer(t.px, t.py, t.pz)) {
      this.hud.showToast("Can't place a block inside yourself");
      return;
    }
    const changed = this.world!.setBlock(t.px, t.py, t.pz, block);
    dbg("  setBlock block=" + block + " -> changed=" + changed);
    if (changed && this.settings.mode === "survival") {
      this.inventory.consumeOne(this.selectedIndex);
      this.refreshHud();
    }
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
    this.selectedIndex = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.hud.setSelected(this.selectedIndex);
  }

  private respawn(): void {
    this.stats.reset();
    this.closeInventorySilent();
    this.mining = null;
    this.breakOverlay.isVisible = false;
    this.player.spawn(this.world!, this.spawnPoint.x, this.spawnPoint.z);
    this.hud.showToast("You died — respawning at spawn");
    this.refreshHud();
    this.setPlaying();
    this.input.requestLock();
    this.saveState();
  }

  private refreshHud(): void {
    this.hud.refreshHotbar(this.inventory, this.selectedIndex, this.settings.mode);
    this.hud.setStats(this.stats.hp, this.stats.hunger, this.stats.breath);
  }

  private saveState(): void {
    if (!this.world) return;
    writeSave(this.settings.seed, {
      inventory: this.inventory.serialize(),
      stats: this.stats.serialize(),
      mode: this.settings.mode,
    });
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
    this.saveState();
    this.renderer.engine.stopRenderLoop();
    this.running = false;
    window.removeEventListener("resize", this.handleResize);
    this.input.dispose();
    this.world?.dispose();
    this.sky.dispose();
    this.atlas.dispose();
    this.breakMaterial.dispose();
    this.breakOverlay.dispose();
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

  /** Clear the saved survival progress for the current seed (debug helper). */
  _resetProgress(): void {
    clearSave(this.settings.seed);
    this.inventory.clear();
    this.stats.reset();
    this.refreshHud();
  }

  /** TEMP debug: dump all chunk coords that are loaded. */
  _loadedChunks(): unknown {
    if (!this.world) return [];
    const chunks = (this.world as unknown as { chunks: Map<string, unknown> }).chunks;
    return [...chunks.keys()];
  }

  /** TEMP debug: replace all chunk materials with a flat unlit colour. */
  _enableDebugFlat(): void {
    if (!this.world) return;
    const mat = new StandardMaterial("debug-flat", this.scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.emissiveColor = new Color3(0.6, 0.6, 0.6);
    mat.specularColor = new Color3(0, 0, 0);
    for (const m of (this.world as unknown as { root: { getChildMeshes: () => Mesh[] } }).root.getChildMeshes()) {
      m.material = mat;
    }
  }

  /** TEMP debug: inspect interaction state. */
  _debugInfo(): Record<string, unknown> {
    const t = this.player.getTarget();
    const sel = this.inventory.getSlot(this.selectedIndex);
    return {
      state: this.state,
      mode: this.settings.mode,
      inventoryOpen: this.inventoryOpen,
      locked: this.input.locked,
      leftHeld: this.input.leftHeld,
      rightHeld: this.input.rightHeld,
      selectedIndex: this.selectedIndex,
      selected: sel ? `${sel.id} x${sel.count}` : null,
      target: t ? { x: t.x, y: t.y, z: t.z, block: t.block, px: t.px, py: t.py, pz: t.pz } : null,
      pos: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
    };
  }
}

/** Wireframe block-selection outline (12 edges of a unit cube). */
function makeHighlight(scene: Scene): LinesMesh {
  const s = 1.002 / 2;
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const edges: Vector3[][] = [
    [v(-s, -s, -s), v(s, -s, -s)],
    [v(s, -s, -s), v(s, -s, s)],
    [v(s, -s, s), v(-s, -s, s)],
    [v(-s, -s, s), v(-s, -s, -s)],
    [v(-s, s, -s), v(s, s, -s)],
    [v(s, s, -s), v(s, s, s)],
    [v(s, s, s), v(-s, s, s)],
    [v(-s, s, s), v(-s, s, -s)],
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

/** Translucent cube overlaid on the block being mined; its alpha tracks dig
 *  progress to give a "cracking" darkening cue. */
function makeBreakOverlay(scene: Scene): { mesh: Mesh; material: StandardMaterial } {
  const material = new StandardMaterial("break-overlay", scene);
  material.diffuseColor = new Color3(0.05, 0.02, 0.02);
  material.emissiveColor = new Color3(0.12, 0.04, 0.04);
  material.specularColor = new Color3(0, 0, 0);
  material.alpha = 0;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.transparencyMode = 2; // MATERIAL_ALPHABLEND

  const mesh = MeshBuilder.CreateBox("break-overlay", { size: 1.004 }, scene);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.applyFog = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isVisible = false;
  return { mesh, material };
}

import {
  Color3,
  Color4,
  DynamicTexture,
  LinesMesh,
  AbstractMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import {
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  SEA_LEVEL,
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
  type ItemId,
} from "./Items";
import { Inventory } from "./Inventory";
import { PlayerState } from "./PlayerState";
import { clearSave, loadSave, writeSave } from "../state/SaveData";
import { ScreenManager } from "../ui/ScreenManager";
import { HUD } from "../ui/HUD";
import { Menus } from "../ui/Menus";
import { InventoryUI } from "../ui/InventoryUI";
import { loadSettings, saveSettings } from "../state/Settings";
import { LightingSystem } from "./lighting/LightingSystem";
import { GraphicsController, MAX_RENDER_DISTANCE, MIN_RENDER_DISTANCE, presetRenderDistance } from "./graphics/GraphicsController";
import { graphicsFromPreset, type GraphicsPreset, type GraphicsSettings } from "./graphics/GraphicsSettings";
import { PerfOverlay, type PerfSnapshot } from "../ui/PerfOverlay";
import { ChunkBorderOverlay } from "../ui/ChunkBorderOverlay";
import { WorldgenOverlay, type WorldgenSnapshot, type WorldgenMapMode } from "../ui/WorldgenOverlay";
import { UnderwaterRenderer } from "./UnderwaterRenderer";
import { isLiquid, liquidDefOf, WATER_BLOCK, WATER_FLOWING_BLOCK } from "./Blocks";
import { dbg, dbgWarn } from "../state/Debug";

const SPAWN_PREGEN_RADIUS = 2;
const SKY_COLOR_HEX = "#bfe3ff";
const EAT_TIME = 1.6;
const INVENTORY_SIZE = 36;
const HOTBAR_SIZE = 9;
const DROP_PICKUP_RADIUS = 0.85;
const DROP_FLOAT_AMPLITUDE = 0.08;
const DROP_GRAVITY = 14;
const DROP_TERMINAL_VELOCITY = -8;
const DROP_HALF_SIZE = 0.16;

interface DroppedItem {
  id: ItemId;
  count: number;
  mesh: Mesh;
  baseY: number;
  vy: number;
  grounded: boolean;
  age: number;
}

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
  private lighting: LightingSystem | null = null;
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
  private readonly drops: DroppedItem[] = [];
  private readonly dropMaterials = new Map<ItemId, StandardMaterial>();
  private readonly graphics: GraphicsController;
  private readonly perf: PerfOverlay;
  private readonly chunkBorders: ChunkBorderOverlay;
  private readonly worldgenOverlay: WorldgenOverlay;
  private readonly underwater: UnderwaterRenderer;

  private selectedIndex = 0;
  private last = performance.now();
  private fpsEma = 60;
  private frameMsEma = 16.7;
  private hudTimer = 0;
  private perfTimer = 0;
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
  /** Render-debug wireframe overlay (terrain + water). Dev only. */
  private wireframe = false;

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

    // Graphics pipeline: owns render scale + post-processing, and binds per-world
    // material/shadow/cloud settings when a world is created. Apply once now so
    // render scale / AA / clouds are correct on the main menu too.
    this.graphics = new GraphicsController(this.renderer.engine, scene, this.sky, this.player.camera);
    this.perf = new PerfOverlay();
    this.chunkBorders = new ChunkBorderOverlay(scene);
    this.worldgenOverlay = new WorldgenOverlay();
    this.underwater = new UnderwaterRenderer(scene);
    this.graphics.apply(this.settings.graphics);

    this.highlight = makeHighlight(scene);
    const { mesh, material } = makeBreakOverlay(scene);
    this.breakOverlay = mesh;
    this.breakMaterial = material;

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
    this.menus.onGraphicsPreset = (preset) => this.applyGraphicsPreset(preset);
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
      if (code === "F3") {
        const on = this.perf.toggle();
        this.hud.showToast(on ? "Perf overlay: on" : "Perf overlay: off");
      }
      if (code === "KeyN") this.toggleWireframe();
      if (code === "KeyB") {
        const on = this.chunkBorders.toggle();
        this.hud.showToast(on ? "Chunk borders: on" : "Chunk borders: off");
      }
      if (code === "KeyG") {
        const on = this.worldgenOverlay.toggle();
        this.hud.showToast(on ? "Worldgen overlay: on" : "Worldgen overlay: off");
      }
      if (code === "KeyH" && this.worldgenOverlay.isOpen) {
        this.worldgenOverlay.cycleMode();
        return; // don't fall through to the lighting-debug key handler
      }
      if (code === "F4") {
        // Toggle liquid targeting (Luanti `liquids` pointability). Default
        // (off) = mine/build through water; on = point at the water surface to
        // remove/place water sources.
        const on = this.player.toggleTargetLiquids();
        this.hud.showToast(on ? "Targeting: liquids (water)" : "Targeting: solids through water");
      }
      if (code === "KeyE" && (this.state === "playing" || this.inventoryOpen)) this.toggleInventory();
      if (code === "Escape") {
        if (this.inventoryOpen) this.closeInventory();
        else if (this.state === "playing") this.pause();
      }
      this.handleLightingDebugKey(code);
    };
  }

  private bindGlobalEvents(): void {
    window.addEventListener("resize", this.handleResize);
    this.renderer.canvas.addEventListener("click", () => {
      if (this.state === "playing" && !this.input.locked && !this.inventoryOpen) this.input.requestLock();
    });
    // WebGL context loss/recovery: Babylon auto-restores GL state, but surface a
    // toast so the player knows a hiccup happened (common when switching tabs on
    // integrated GPUs). No data is lost — chunk meshes are re-uploaded by Babylon.
    this.renderer.engine.onContextLostObservable.add(() => {
      dbgWarn("WebGL context lost — Babylon will attempt to restore");
      this.hud.showToast("WebGL context lost — restoring…");
    });
    this.renderer.engine.onContextRestoredObservable.add(() => {
      dbg("WebGL context restored");
      this.hud.showToast("WebGL context restored");
    });
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.player.setAspect(w / h);
    // DPR can change when the window moves between displays; keep render scale correct.
    this.graphics.refreshRenderScale();
  };

  // ----------------------------------------------------------- settings ---

  private applySettings(patch: Partial<Settings>): void {
    // Clamp render distance into a browser-safe range. Copy the patch first so
    // we never mutate the caller's object (it may be reused, e.g. by Menus).
    if (patch.viewDistance !== undefined) {
      patch = {
        ...patch,
        viewDistance: Math.max(MIN_RENDER_DISTANCE, Math.min(MAX_RENDER_DISTANCE, Math.round(patch.viewDistance))),
      };
    }
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.screens.setMenuSeed(this.settings.seed);
    if (patch.fov !== undefined) this.player.setFov(patch.fov);
    if (patch.showFps !== undefined) this.hud.setFpsVisible(patch.showFps);
    if (patch.viewDistance !== undefined) this.updateFog();
    // Graphics settings are applied reactively (render scale, AA, shadows,
    // clouds, water, foliage) — no page reload needed.
    if (patch.graphics !== undefined) {
      this.graphics.apply(this.settings.graphics);
      this.updateFog(); // fog toggle / view-distance interplay
    }
    if (patch.mode !== undefined) {
      this.player.canFly = patch.mode === "creative";
      if (patch.mode === "survival") this.player.flying = false;
      this.invUI.refresh();
      this.refreshHud();
    }
    this.menus.updateCurrent(this.settings);
  }

  /**
   * Switch to a built-in preset (low/medium/high): applies the full graphics
   * config AND nudges the render distance to the preset's recommended value,
   * so a "Low" preset is actually faster (shorter view) and "High" reaches
   * further. Used by the settings UI.
   */
  applyGraphicsPreset(preset: GraphicsPreset): void {
    const graphics: GraphicsSettings = graphicsFromPreset(preset);
    this.applySettings({ graphics, viewDistance: presetRenderDistance(preset) });
  }

  // ------------------------------------------------------ game states ---

  private startGame(): void {
    this.setState("loading");
    this.createWorld(this.settings.seed);
    const spawn = this.findSpawnColumn();
    this.player.spawn(this.world!, spawn.x, spawn.z);
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
      const spawn = this.findSpawnColumn();
      this.player.spawn(this.world!, spawn.x, spawn.z);
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
    this.clearDrops();
    if (this.lighting) {
      this.lighting.dispose();
      this.lighting = null;
    }
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
    this.world = new World(seed, this.atlas, this.scene);
    this.sky.setCloudSeed(seed);
    // Wire the lighting system into the new world + the sky's Babylon lights.
    this.lighting = new LightingSystem(this.world, this.sky, this.scene);
    // Re-bind the graphics controller to the new world so material/shadow/cloud
    // settings apply to it (the controller re-applies the full config).
    this.graphics.attachWorld(this.world, this.lighting);
  }

  /**
   * Find a dry-land column near the origin to spawn the player on, searching an
   * expanding square spiral. Avoids spawning on the ocean floor when the seed
   * places deep water at (0,0). Falls back to the origin if none is found.
   */
  private findSpawnColumn(): { x: number; z: number } {
    const gen = this.world!.generator;
    // Dry land is purely height-based (selectBiome returns "ocean" iff height ≤
    // sea), so a single columnHeight() check suffices — no climate/biome eval.
    const check = (x: number, z: number): boolean => gen.columnHeight(x, z) > SEA_LEVEL;
    if (check(0, 0)) return { x: 0, z: 0 };
    // Step 8 keeps the worst-case (ocean-start) spiral cheap while still landing
    // on land within a few blocks of the ideal spot.
    for (let r = 8; r <= 384; r += 8) {
      for (let x = -r; x <= r; x += 8) {
        if (check(x, -r)) return { x, z: -r };
        if (check(x, r)) return { x, z: r };
      }
      for (let z = -r + 8; z <= r - 8; z += 8) {
        if (check(-r, z)) return { x: -r, z };
        if (check(r, z)) return { x: r, z };
      }
    }
    return { x: 0, z: 0 };
  }

  /** Load inventory+vitals for this seed, or seed a fresh starter kit. */
  private loadOrCreateProgress(): void {
    const save = loadSave(this.settings.seed);
    // Resume in the mode the player last left (if the save recorded one).
    if (save?.mode && save.mode !== this.settings.mode) {
      this.applySettings({ mode: save.mode });
    }
    const mode = this.settings.mode;
    this.stats.reset();
    if (mode === "creative") {
      // Creative NEVER restores a saved backpack — creative palette pulls are
      // ephemeral, so a creative world always opens with the clean starter
      // hotbar (see saveState, which also skips persisting creative items).
      this.seedInventoryForMode("creative");
      return;
    }
    // Survival: restore saved progress, else seed the starter survival kit.
    if (save) {
      this.inventory.clear(); // clears backpack + crafting grid
      this.inventory.load(save.inventory);
      this.inventory.loadCrafting(save.crafting);
      this.stats.load(save.stats);
    } else {
      this.seedInventoryForMode("survival");
    }
  }

  private seedInventoryForMode(mode: GameMode): void {
    this.inventory.clear(); // clears backpack + crafting grid
    if (mode === "creative") {
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
    // Close the inventory (returns held + craft-grid items to the backpack)
    // BEFORE saving, otherwise those items would be persisted both in the craft
    // grid and — next session — re-added to the backpack on close.
    this.closeInventorySilent();
    this.saveState();
    this.clearDrops();
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
    const prev = this.settings.mode;
    this.applySettings({ mode });
    if (prev !== mode) {
      // Mode inventories are intentionally isolated. Creative palette pulls
      // must never leak into survival, and entering creative should always show
      // the clean starter hotbar.
      this.seedInventoryForMode(mode);
      this.stats.reset();
      this.invUI.refresh();
      this.refreshHud();
    }
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
        this.world?.update(this.player.position.x, this.player.position.z, this.settings.viewDistance, dt * 1000);
      } else {
        this.update(dt);
      }
    } else if (this.state === "paused") {
      this.world?.update(this.player.position.x, this.player.position.z, this.settings.viewDistance, dt * 1000);
    }

    // Advance day/night + position sun/moon + push terrain uniforms even while
    // paused (cheap; lets you inspect frozen time). Skip when no world.
    if (this.lighting && this.world) {
      this.lighting.update(
        dt,
        this.player.camera.position,
        this.player.position.x,
        this.player.position.y,
        this.player.position.z,
      );
      // Animate the water surface (subtle shimmer; no-op on Low).
      this.world.waterShader.animate(dt);
    }
    // Underwater tint + fog override. Runs every frame (even with no world) so
    // the overlay reliably fades out on quit-to-menu; when submerged it pulls
    // the fog in for the camera and restores it automatically when surfaced.
    {
      const eyeLiquidId = this.world ? this.player.liquidAtEye(this.world) : 0;
      const eyeLiquid = eyeLiquidId ? liquidDefOf(eyeLiquidId) : null;
      const submerged = this.world ? this.player.headSubmerged(this.world) : false;
      const dayFactor = this.lighting?.dayNight.dayFactor ?? 1;
      this.underwater.update(dt, submerged, eyeLiquid, dayFactor);
    }

    this.sky.update(dt, this.player.camera.position);
    this.scene.render();
    this.updateFps(dt);
    this.updatePerf(dt);
    // Chunk-border debug overlay: rebuilt only when the player crosses a chunk
    // boundary, so the per-frame cost is negligible when open.
    this.chunkBorders.update(
      this.player.position.x,
      this.player.position.z,
      this.player.position.y,
      (cb) => this.world?.forEachChunkCoord(cb),
    );
  };

  private update(dt: number): void {
    const world = this.world!;
    const mode = this.settings.mode;
    this.player.update(dt, world, this.input, this.settings);
    world.update(this.player.position.x, this.player.position.z, this.settings.viewDistance, dt * 1000);
    this.updateDrops(dt);

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
      // Lighting debug overlay (throttled). Uses the current block target so
      // you can read the exact sun/block light of the block you're aiming at.
      if (this.lighting) {
        const info = this.lighting.buildDebugInfo(
          target ? { x: target.x, y: target.y, z: target.z, block: target.block } : null,
        );
        this.lighting.overlay.update(info);
      }
      // World-gen debug overlay (throttled). The minimap re-renders on player
      // movement, so this is cheap between moves.
      if (this.worldgenOverlay.isOpen) {
        this.worldgenOverlay.update(this.buildWorldgenSnapshot(target));
      }
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
    dbg("breakBlock", JSON.stringify({ x, y, z, id, breakable: isBreakable(id), liquid: isLiquid(id) }));
    // Liquid-mode removal: the raycast only returns a liquid as the target
    // when liquid targeting is on, OR as the fallback when no solid is in
    // reach. Only honour removal in liquid mode; otherwise hint the player.
    if (isLiquid(id)) {
      if (!this.player.targetLiquids) {
        this.hud.showToast("Switch to liquid targeting (F4) to remove water");
        return;
      }
      if (world.setLiquid(x, y, z, 0, 0)) {
        world.queueLiquidUpdate(x, y, z);
        this.hud.showToast(`Removed ${getBlock(id).name}`);
      }
      return;
    }
    if (!isBreakable(id)) return;
    const changed = world.setBlock(x, y, z, 0);
    dbg("  setBlock -> changed=" + changed);
    if (!changed) return;
    // setBlock already wakes the liquid simulator around the edit, so water
    // flows into the newly opened space / recedes correctly.
    if (this.settings.mode === "survival") {
      const drop = dropForBlock(id);
      if (drop !== null) this.spawnDrop(drop, x + 0.5, y + 0.55, z + 0.5);
      this.stats.addExhaustion(5);
      this.refreshHud();
    }
  }

  private dropMaterial(id: ItemId): StandardMaterial {
    const existing = this.dropMaterials.get(id);
    if (existing) return existing;
    const mat = new StandardMaterial(`drop-${id}`, this.scene);
    const color = getItem(id)?.color ?? "#888888";
    mat.diffuseColor = Color3.FromHexString(color);
    mat.emissiveColor = Color3.FromHexString(color).scale(0.18);
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    this.dropMaterials.set(id, mat);
    return mat;
  }

  private spawnDrop(id: ItemId, x: number, y: number, z: number, count = 1): void {
    const mesh = MeshBuilder.CreateBox(`drop-${id}`, { size: 0.32 }, this.scene);
    mesh.material = this.dropMaterial(id);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0.25, 0.4, 0.15);
    this.drops.push({ id, count, mesh, baseY: y, vy: 0, grounded: false, age: 0 });
  }

  private updateDrops(dt: number): void {
    if (this.drops.length === 0) return;
    const p = this.player.position;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (!d.grounded) {
        d.vy = Math.max(DROP_TERMINAL_VELOCITY, d.vy - DROP_GRAVITY * dt);
        d.mesh.position.y += d.vy * dt;
        const footY = d.mesh.position.y - DROP_HALF_SIZE;
        const belowY = Math.floor(footY);
        const bx = Math.floor(d.mesh.position.x);
        const bz = Math.floor(d.mesh.position.z);
        if (belowY >= 0 && getBlock(this.world!.getBlock(bx, belowY, bz)).solid && footY <= belowY + 1) {
          d.baseY = belowY + 1 + DROP_HALF_SIZE;
          d.mesh.position.y = d.baseY;
          d.vy = 0;
          d.grounded = true;
        } else if (d.mesh.position.y < -8) {
          d.mesh.dispose();
          this.drops.splice(i, 1);
          continue;
        }
      } else {
        d.mesh.position.y = d.baseY + Math.sin(d.age * 4) * DROP_FLOAT_AMPLITUDE;
      }
      d.mesh.rotation.y += dt * 1.8;
      const dx = d.mesh.position.x - p.x;
      const dy = d.mesh.position.y - (p.y + PLAYER_HEIGHT * 0.45);
      const dz = d.mesh.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz > DROP_PICKUP_RADIUS * DROP_PICKUP_RADIUS) continue;
      const leftover = this.inventory.add(d.id, d.count);
      if (leftover <= 0) {
        d.mesh.dispose();
        this.drops.splice(i, 1);
        this.refreshHud();
      } else {
        d.count = leftover;
        this.hud.showToast("Inventory full");
      }
    }
  }

  private clearDrops(): void {
    for (const d of this.drops) d.mesh.dispose();
    this.drops.length = 0;
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

  // ------------------------------------------------------- lighting ---

  /**
   * Debug hotkeys for the lighting system. Active only while a world is loaded.
   *   L            toggle the lighting debug overlay
   *   K            cycle light visual mode (off → sun → block → combined)
   *   T            freeze / unfreeze the day-night clock
   *   H            toggle Babylon real-time shadows (voxel light stays on)
   *   [  and  ]    previous / next time preset (sunrise→noon→sunset→midnight)
   *   O  and  I    speed up / slow down the day-night clock
   *   ;  and  '    snap to midnight / midday
   */
  private handleLightingDebugKey(code: string): void {
    if (!this.lighting) return;
    const dn = this.lighting.dayNight;
    switch (code) {
      case "KeyL":
        this.lighting.overlay.toggle();
        break;
      case "KeyK": {
        const mode = this.lighting.cycleDebugMode();
        this.hud.showToast(`Light view: ${mode}`);
        break;
      }
      case "KeyT": {
        dn.setPaused(!dn.paused);
        this.hud.showToast(dn.paused ? "Time frozen" : "Time running");
        break;
      }
      case "KeyH": {
        const on = this.lighting.toggleShadows();
        this.hud.showToast(on ? "Shadows: on" : "Shadows: off (voxel light only)");
        break;
      }
      case "BracketLeft": {
        const p = this.lighting.cyclePreset(false);
        this.hud.showToast(`Time: ${p}`);
        break;
      }
      case "BracketRight": {
        const p = this.lighting.cyclePreset(true);
        this.hud.showToast(`Time: ${p}`);
        break;
      }
      case "KeyO":
        this.lighting.faster();
        this.hud.showToast(`Time speed ×${dn.timeScale.toFixed(1)}`);
        break;
      case "KeyI":
        this.lighting.slower();
        this.hud.showToast(`Time speed ×${dn.timeScale.toFixed(1)}`);
        break;
      case "Semicolon":
        dn.setMidnight();
        this.hud.showToast("Time: midnight");
        break;
      case "Quote":
        dn.setNoon();
        this.hud.showToast("Time: midday");
        break;
      default:
        break;
    }
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
    if (this.settings.mode === "survival") {
      writeSave(this.settings.seed, {
        inventory: this.inventory.serialize(),
        crafting: this.inventory.serializeCrafting(),
        stats: this.stats.serialize(),
        mode: this.settings.mode,
      });
      return;
    }
    // Creative: never persist inventory/craft-grid changes (palette pulls are
    // ephemeral). Preserve the last survival backpack so returning to survival
    // still restores progress; only the resumed mode + vitals are updated.
    const prev = loadSave(this.settings.seed);
    writeSave(this.settings.seed, {
      inventory: prev?.inventory ?? [],
      crafting: prev?.crafting ?? [],
      stats: this.stats.serialize(),
      mode: this.settings.mode,
    });
  }

  // --------------------------------------------------------- screens ---

  private updateFog(): void {
    // Fog is the primary tool for hiding chunk pop-in. The terrain shader
    // replicates Babylon's linear fog manually (driven by uFogStart/uFogEnd
    // pushed each frame from these scene values), and the water/StandardMaterial
    // pass uses scene fog directly. End the fog a bit beyond the render distance
    // so the freshest chunks fade in under cover instead of popping.
    if (!this.settings.graphics.fog) {
      // Disabling fog: push the range out so the fog mix ≈ 1 (no tint) while
      // keeping the uniforms consistent for both shader paths.
      this.scene.fogStart = 0;
      this.scene.fogEnd = 1e6;
      return;
    }
    const far = this.settings.viewDistance * 16 * 2.0;
    // Higher presets get a later fog start → clearer mid-distance terrain and
    // less of the washed-out haze. Low keeps an earlier start to hide the
    // pop-in that comes with its shorter render distance.
    const startFrac =
      this.settings.graphics.preset === "high" ? 0.6 :
      this.settings.graphics.preset === "low" ? 0.42 : 0.5;
    this.scene.fogEnd = far;
    this.scene.fogStart = far * startFrac;
    // Tell the underwater renderer the new above-water baseline so its blend
    // target stays correct when the view distance / preset changes.
    this.underwater.setSurfaceFog(this.scene.fogStart, this.scene.fogEnd, this.scene.fogColor);
  }

  private updateFps(dt: number): void {
    if (dt <= 0) return;
    const instant = 1 / dt;
    this.fpsEma += (instant - this.fpsEma) * 0.1;
    this.frameMsEma += (dt * 1000 - this.frameMsEma) * 0.1;
    if (this.settings.showFps) this.hud.setFps(Math.round(this.fpsEma));
  }

  /** Throttled (~10 Hz) perf-overlay refresh. Cheap on its own; the per-frame
   *  scene counters come from Babylon's active-mesh tracking. */
  private updatePerf(dt: number): void {
    this.perfTimer += dt;
    if (this.perfTimer < 0.1) return;
    this.perfTimer = 0;
    if (!this.perf.isOpen) return;
    this.perf.update(this.buildPerfSnapshot());
  }

  /** Snapshot for the world-gen overlay: targeted column + rolling gen stats. */
  private buildWorldgenSnapshot(
    target: ReturnType<Player["getTarget"]>,
  ): WorldgenSnapshot {
    const p = this.player.position;
    const tx = target ? Math.floor(target.x) : Math.floor(p.x);
    const tz = target ? Math.floor(target.z) : Math.floor(p.z);
    return {
      generator: this.world?.generator ?? null,
      stats: this.world?.generator.statsSnapshot() ?? null,
      playerX: p.x,
      playerZ: p.z,
      targetWX: tx,
      targetWZ: tz,
      seaLevel: SEA_LEVEL,
    };
  }

  private buildPerfSnapshot(): PerfSnapshot {
    const scene = this.scene;
    const active = scene.getActiveMeshes();
    const activeSet = new Set<AbstractMesh>();
    for (let i = 0; i < active.length; i++) activeSet.add(active.data[i]);
    const stats = this.world
      ? this.world.chunkStats(activeSet)
      : { loaded: 0, meshed: 0, dirty: 0, visible: 0 };
    const shadowsEnabled = !!this.lighting?.shadowsEnabled;
    const casters = shadowsEnabled ? this.lighting!.shadows.casterCount : 0;
    const g = this.settings.graphics;
    const eng = this.renderer.engine;
    const gl = eng.getGlInfo();
    const dn = this.lighting?.dayNight;
    // JS heap is Chrome-only; report null elsewhere rather than misleading 0.
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    // Liquid diagnostics.
    const liquid = this.world?.liquidDebug();
    const target = this.player.getTarget();
    let targetLiquidType = "none";
    let targetLiquidLevel = 0;
    if (target) {
      const tdef = getBlock(target.block);
      if (tdef.liquidType && tdef.liquidType !== "none") {
        targetLiquidType = tdef.liquidType;
        if (tdef.liquidType === "flowing" && this.world) {
          targetLiquidLevel = this.world.getLevel(target.x, target.y, target.z);
        }
      }
    }
    const genStats = this.world?.generator.statsSnapshot() ?? null;
    const ppos = this.player.position;
    const biomeAtPlayer = this.world?.generator
      ? this.world.generator.biomeAt(Math.floor(ppos.x), Math.floor(ppos.z), Math.floor(ppos.y))
      : "—";
    return {
      fps: this.fpsEma,
      frameMs: this.frameMsEma,
      activeMeshes: active.length,
      totalMeshes: scene.meshes.length,
      triangles: Math.round(scene.getActiveIndices() / 3),
      drawEstimate: active.length + casters,
      loadedChunks: stats.loaded,
      meshedChunks: stats.meshed,
      visibleChunks: stats.visible,
      culledChunks: Math.max(0, stats.meshed - stats.visible),
      meshQueue: stats.dirty,
      lightQueue: this.world?.lightDirtyCount ?? 0,
      shadowCasters: casters,
      shadowsEnabled,
      waterMeshes: this.world?.waterMeshCount ?? 0,
      waterVertices: this.world?.waterVertexCount ?? 0,
      preset: g.preset,
      viewDistance: this.settings.viewDistance,
      renderScale: g.renderScale,
      dpr: Math.min(window.devicePixelRatio || 1, g.dprCap),
      renderWidth: eng.getRenderWidth(),
      renderHeight: eng.getRenderHeight(),
      heapUsedMB: mem ? mem.usedJSHeapSize / 1_048_576 : null,
      gpuRenderer: gl?.renderer || null,
      timeOfDay: dn?.timeOfDay ?? 0.5,
      fogStart: scene.fogStart,
      fogEnd: scene.fogEnd,
      ambientIntensity: dn?.ambientIntensity ?? 0,
      sunIntensity: dn?.sunIntensity ?? 0,
      dayFactor: dn?.dayFactor ?? 1,
      waterAlpha: this.world?.waterShader.currentAlpha ?? 1,
      waterQuality: this.world?.waterShader.currentQuality ?? "—",
      antiAliasing: g.antiAliasing,
      inWater: this.player.inWater,
      underwater: this.underwater.isUnderwater,
      liquidQueue: liquid?.queueSize ?? 0,
      liquidPriorityQueue: liquid?.priorityQueueSize ?? 0,
      liquidProcessed: liquid?.processedLastTick ?? 0,
      liquidBudget: liquid?.budget ?? 0,
      liquidWrites: liquid?.totalWrites ?? 0,
      liquidMsSinceTick: liquid?.msSinceLastTick ?? 0,
      targetLiquidType,
      targetLiquidLevel,
      targetMode: this.player.targetLiquids ? "liquids" : "solids",
      rayThroughLiquid: !!target?.passedThroughLiquid,
      firstLiquid: target?.firstLiquid
        ? { x: target.firstLiquid.x, y: target.firstLiquid.y, z: target.firstLiquid.z }
        : null,
      waterSidesOn: this.world?.waterSidesOn ?? true,
      waterAnimOn: this.world?.waterShader.animationOn ?? true,
      genAvgMs: genStats?.avgMs ?? 0,
      genLastMs: genStats?.lastMs ?? 0,
      genChunks: genStats?.chunks ?? 0,
      biome: biomeAtPlayer,
    };
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
    this.clearDrops();
    for (const mat of this.dropMaterials.values()) mat.dispose();
    this.dropMaterials.clear();
    this.renderer.engine.stopRenderLoop();
    this.running = false;
    window.removeEventListener("resize", this.handleResize);
    this.input.dispose();
    this.graphics.dispose();
    this.underwater.dispose();
    this.lighting?.dispose();
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
    this.inventory.clear(); // also clears the crafting grid
    this.stats.reset();
    this.refreshHud();
  }

  /** TEMP debug: dump all chunk coords that are loaded. */
  _loadedChunks(): unknown {
    if (!this.world) return [];
    const chunks = (this.world as unknown as { chunks: Map<string, unknown> }).chunks;
    return [...chunks.keys()];
  }

  /**
   * Lighting debug surface for the devtools console (`__voxl.lighting()`).
   * Prints and returns a snapshot of the lighting system's state plus the block
   * currently under the crosshair, and dumps the full shadow render list +
   * frustum bounds (every caster mesh: name, position, bounds, visibility).
   */
  _lightingDebug(): unknown {
    if (!this.lighting) return { error: "no world" };
    const target = this.player.getTarget();
    const info = this.lighting.buildDebugInfo(
      target ? { x: target.x, y: target.y, z: target.z, block: target.block } : null,
    );
    // eslint-disable-next-line no-console
    console.log("[lighting]", info);
    // Dump the shadow render list + frustum for diagnosing shadow artifacts.
    this.lighting.dumpShadowDiagnostics();
    return info;
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
    for (const m of (this.world as unknown as { root: { getChildMeshes: () => Mesh[] } }).root.getChildMeshes()) {
      m.material = mat;
    }
  }

  /**
   * Render-debug wireframe overlay: switches the shared terrain + water
   * materials to wireframe rendering. Useful for spotting hidden faces,
   * overdraw and mesh efficiency. Toggle from the keyboard (N) or the console
   * (`__voxl.wireframe()`).
   */
  _setWireframe(on: boolean): void {
    this.wireframe = on;
    if (!this.world) return;
    this.world.terrainOpaque.material.wireframe = on;
    this.world.terrainCutout.material.wireframe = on;
    this.world.waterShader.material.wireframe = on;
  }

  toggleWireframe(): void {
    this._setWireframe(!this.wireframe);
    this.hud.showToast(this.wireframe ? "Wireframe: on" : "Wireframe: off");
  }

  /**
   * Debug: toggle back-face culling on the OPAQUE terrain material. OFF by
   * default (the known-correct setting for this scene's face winding). Provided
   * so culling can be re-tested safely; if it reintroduces holes, leave it off.
   */
  _setTerrainCulling(on: boolean): void {
    if (!this.world) return;
    this.world.terrainOpaque.material.backFaceCulling = on;
  }

  /**
   * Debug: force every loaded chunk mesh to render regardless of frustum
   * culling (sets `alwaysSelectAsActiveMesh`). Use to confirm whether missing
   * terrain is a frustum-culling problem vs a mesh/material problem. Affects
   * existing + future chunk meshes.
   */
  _setRenderAllChunks(on: boolean): void {
    this.world?.setRenderAllChunks(on);
    this.hud.showToast(on ? "Frustum cull: BYPASS (render all)" : "Frustum cull: normal");
  }

  /**
   * Debug: conservative "safe mode" to isolate terrain — disables shadows,
   * simplifies clouds, disables foliage distance-cull, and bypasses frustum
   * culling. Lets you confirm the terrain mesh alone renders correctly. Call
   * again with `false` to restore the player's settings.
   */
  _safeMode(on: boolean): void {
    if (on) {
      this._safeModePrev = {
        graphics: { ...this.settings.graphics },
      };
      this.applySettings({
        graphics: {
          ...this.settings.graphics,
          shadows: "off",
          clouds: "off",
          foliage: "high",
          antiAliasing: false,
        },
      });
      this.world?.setRenderAllChunks(true);
      this.perf.setVisible(true);
    } else if (this._safeModePrev) {
      this.applySettings({ graphics: this._safeModePrev.graphics });
      this.world?.setRenderAllChunks(false);
      this._safeModePrev = null;
    }
    this.hud.showToast(on ? "Safe mode ON (terrain isolation)" : "Safe mode OFF");
  }
  private _safeModePrev: { graphics: GraphicsSettings } | null = null;

  /** Toggle the performance overlay from the console (`__voxl.perf()`). */
  _togglePerf(on?: boolean): void {
    this.perf.setVisible(on ?? !this.perf.isOpen);
  }

  /** Toggle the chunk-border debug overlay from the console. */
  _toggleChunkBorders(on?: boolean): void {
    this.chunkBorders.setVisible(on ?? !this.chunkBorders.isOpen);
  }

  /** Toggle the world-gen debug overlay from the console (`__voxl.worldgen()`). */
  _toggleWorldgen(on?: boolean): void {
    this.worldgenOverlay.setVisible(on ?? !this.worldgenOverlay.isOpen);
  }

  /** Set the world-gen minimap mode from the console (`__voxl.worldgenMode()`). */
  _worldgenMode(mode: WorldgenMapMode): void {
    this.worldgenOverlay.setVisible(true);
    this.worldgenOverlay.setMode(mode);
  }

  /** Dump world-gen stats + the biome at the player to the console. */
  _worldgenInfo(): void {
    const gen = this.world?.generator;
    if (!gen) {
      console.log("[voxl] no world");
      return;
    }
    const p = this.player.position;
    const d = gen.debugAt(Math.floor(p.x), Math.floor(p.z));
    console.log("[voxl] worldgen @", Math.floor(p.x), Math.floor(p.z), d);
    console.log("[voxl] stats", gen.statsSnapshot());
  }

  // ---- Per-layer isolation toggles (for diagnosing patches/artifacts) ----

  /** Debug: show/hide the entire water layer. */
  _setWater(on: boolean): void {
    this.world?.setWaterEnabled(on);
    this.hud.showToast(on ? "Water: on" : "Water: off");
  }

  /** Debug: force water fully opaque + flat (isolate the water color). */
  _setWaterOpaque(on: boolean): void {
    this.world?.waterShader.setDebugOpaque(on);
    this.hud.showToast(on ? "Water: opaque debug" : "Water: normal");
  }

  /** Debug: enable/disable water side faces (top surface only when off). */
  _setWaterSides(on: boolean): void {
    this.world?.setWaterSides(on);
    this.hud.showToast(on ? "Water sides: on" : "Water sides: off (surface only)");
  }

  /** Debug: enable/disable water surface scroll + shimmer animation. */
  _setWaterAnim(on: boolean): void {
    this.world?.waterShader.setAnimationEnabled(on);
    this.hud.showToast(on ? "Water animation: on" : "Water animation: off");
  }

  /** Debug: toggle water depth-write (isolate transparency/depth artifacts). */
  _setWaterDepth(on: boolean): void {
    this.world?.waterShader.setDepthWrite(on);
    this.hud.showToast(on ? "Water depth-write: ON (may show artifacts)" : "Water depth-write: off (default)");
  }

  /** Debug: swap water to a plain untextured material (isolate texture issues). */
  _setWaterSimple(on: boolean): void {
    this.world?.waterShader.setSimpleMaterial(on);
    this.hud.showToast(on ? "Water: simple untextured" : "Water: normal textured");
  }

  /** Debug: toggle liquid targeting (ray stops at water vs passes through). */
  _setTargetLiquids(on?: boolean): boolean {
    if (on === undefined) this.player.targetLiquids = !this.player.targetLiquids;
    else this.player.targetLiquids = on;
    this.hud.showToast(this.player.targetLiquids ? "Targeting: liquids" : "Targeting: solids through water");
    return this.player.targetLiquids;
  }

  /** Debug: toggle distance fog. */
  _setFog(on: boolean): void {
    this.applySettings({ graphics: { ...this.settings.graphics, fog: on } });
    this.hud.showToast(on ? "Fog: on" : "Fog: off");
  }

  /** Debug: toggle FXAA post-processing. */
  _setPost(on: boolean): void {
    this.applySettings({ graphics: { ...this.settings.graphics, antiAliasing: on } });
    this.hud.showToast(on ? "Post (FXAA): on" : "Post (FXAA): off");
  }

  /** Debug: toggle real-time shadows. Routes through applySettings so the
   *  shadow tier, the settings UI, and localStorage all stay in sync (terrain
   *  can't receive shadows yet, so this currently only changes GPU cost, not the
   *  look — useful to confirm that). */
  _setShadows(on: boolean): void {
    const current = this.settings.graphics.shadows;
    const shadows = on ? (current !== "off" ? current : "medium") : "off";
    this.applySettings({ graphics: { ...this.settings.graphics, shadows } });
    this.hud.showToast(on ? "Shadows: on" : "Shadows: off");
  }

  /** Debug: log every chunk mesh's name + material + vertex count. */
  _dumpMaterials(): void {
    this.world?.dumpChunkMaterials();
    this.hud.showToast("Dumped chunk materials (see console)");
  }

  /**
   * Water audit for the console (`__voxl.waterStats()`): counts loaded chunks
   * containing water and the total water block count, confirming whether the
   * world actually generated oceans/lakes near the player. On-demand only (it
   * scans every loaded block).
   */
  _waterStats(): unknown {
    if (!this.world) return { error: "no world" };
    const s = this.world.waterStats();
    // eslint-disable-next-line no-console
    console.log("[water]", s);
    return s;
  }

  /**
   * Liquid simulator audit for the console (`__voxl.liquid()`): queue size,
   * budget, total writes, and the targeted block's liquid state. On-demand.
   */
  _liquidDebug(): unknown {
    if (!this.world) return { error: "no world" };
    const d = this.world.liquidDebug();
    const target = this.player.getTarget();
    let t: Record<string, unknown> | null = null;
    if (target) {
      const def = getBlock(target.block);
      t = {
        x: target.x, y: target.y, z: target.z,
        block: target.block,
        name: def.name,
        liquidType: def.liquidType ?? "none",
        level: def.liquidType === "flowing" ? this.world.getLevel(target.x, target.y, target.z) : 0,
      };
    }
    const info = { ...d, inWater: this.player.inWater, underwater: this.underwater.isUnderwater, target: t };
    // eslint-disable-next-line no-console
    console.log("[liquid]", info);
    return info;
  }

  /**
   * Debug: place a water SOURCE at the targeted block's adjacent cell (or a
   * given xyz) and wake the liquid simulator. Lets you test flow from the
   * console without a bucket item. Usage: `__voxl.placeWater()` or
   * `__voxl.placeWater(x,y,z)`.
   */
  _placeWater(x?: number, y?: number, z?: number): void {
    if (!this.world) return;
    let wx: number, wy: number, wz: number;
    if (x !== undefined && y !== undefined && z !== undefined) {
      wx = x; wy = y; wz = z;
    } else {
      const t = this.player.getTarget();
      if (!t) { this.hud.showToast("Aim at a block first"); return; }
      wx = t.px; wy = t.py; wz = t.pz;
    }
    this.world.setLiquid(wx, wy, wz, WATER_BLOCK, 0);
    this.world.queueLiquidUpdate(wx, wy, wz);
    this.hud.showToast(`Water source at ${wx},${wy},${wz}`);
  }

  /**
   * Debug: remove liquid at the targeted block (or xyz). Equivalent to placing
   * air; wakes the simulator so neighbours recompute.
   */
  _removeWater(x?: number, y?: number, z?: number): void {
    if (!this.world) return;
    let wx: number, wy: number, wz: number;
    if (x !== undefined && y !== undefined && z !== undefined) {
      wx = x; wy = y; wz = z;
    } else {
      const t = this.player.getTarget();
      if (!t) { this.hud.showToast("Aim at a block first"); return; }
      wx = t.x; wy = t.y; wz = t.z;
    }
    this.world.setLiquid(wx, wy, wz, 0, 0);
    this.world.queueLiquidUpdate(wx, wy, wz);
    this.hud.showToast(`Removed liquid at ${wx},${wy},${wz}`);
  }

  /** Debug: set the liquid simulator per-tick cell budget. */
  _liquidBudget(n: number): void {
    if (!this.world) return;
    this.world.liquid.setBudget(n);
    this.hud.showToast(`Liquid budget: ${n}/tick`);
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
  lines.receiveShadows = false; // selection outline never receives/casts shadows
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

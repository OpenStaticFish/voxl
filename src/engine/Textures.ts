import { DynamicTexture, Scene, Texture } from "@babylonjs/core";

// Procedurally generated texture atlas. All voxel textures are drawn to an
// offscreen canvas at runtime — no copyrighted assets are imported. Tiles are
// 16x16 pixels arranged in a grid, sampled with nearest filtering for a crisp
// pixel-art look.

export const TILE_PX = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 8;
export const ATLAS_TILE_COUNT = ATLAS_COLS * ATLAS_ROWS;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type RGB = [number, number, number];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Fill a tile with a base color then scatter darker/lighter speckles. */
function paintSpeckled(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  base: RGB,
  variation: number,
  count: number,
  rand: () => number,
): void {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(ox, oy, TILE_PX, TILE_PX);
  for (let i = 0; i < count; i++) {
    const x = ox + Math.floor(rand() * TILE_PX);
    const y = oy + Math.floor(rand() * TILE_PX);
    const d = (rand() - 0.5) * 2 * variation;
    const r = clamp255(base[0] + d);
    const g = clamp255(base[1] + d);
    const b = clamp255(base[2] + d);
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

/** Stone base used by ores and as the raw stone tile. */
function paintStone(ctx: CanvasRenderingContext2D, ox: number, oy: number, rand: () => number): void {
  paintSpeckled(ctx, ox, oy, [128, 128, 132], 20, 120, rand);
  ctx.fillStyle = "rgb(96,96,100)";
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 2, 1);
  }
}

/** Scatter ore blobs of `ore` color over a stone base. */
function paintOre(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  ore: RGB,
  rand: () => number,
  blobs = 6,
): void {
  paintStone(ctx, ox, oy, rand);
  for (let i = 0; i < blobs; i++) {
    const x = ox + 1 + Math.floor(rand() * (TILE_PX - 3));
    const y = oy + 1 + Math.floor(rand() * (TILE_PX - 3));
    const d = (rand() - 0.5) * 30;
    ctx.fillStyle = `rgb(${clamp255(ore[0] + d) | 0},${clamp255(ore[1] + d) | 0},${clamp255(ore[2] + d) | 0})`;
    ctx.fillRect(x, y, 2, 2);
    if (rand() < 0.5) ctx.fillRect(x + 1, y - 1, 1, 1);
  }
}

/** A dirt side with a coloured grassy lip on top (used by grass variants). */
function paintGrassSide(ctx: CanvasRenderingContext2D, ox: number, oy: number, lip: RGB, rand: () => number): void {
  paintSpeckled(ctx, ox, oy, [134, 96, 64], 22, 80, rand);
  for (let x = 0; x < TILE_PX; x++) {
    const h = 3 + Math.floor(rand() * 3);
    for (let y = 0; y < h; y++) {
      const d = (rand() - 0.5) * 24;
      ctx.fillStyle = `rgb(${clamp255(lip[0] + d) | 0},${clamp255(lip[1] + d) | 0},${clamp255(lip[2] + d) | 0})`;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

export interface AtlasResult {
  texture: DynamicTexture;
}

/**
 * Build the texture atlas as a Babylon DynamicTexture. The texture's canvas is
 * filled in-place. We use **no mipmaps** with pure NEAREST sampling: with a
 * tiny 128×128 / 8×8-tile atlas, auto-generated mip levels blend adjacent
 * tiles together (atlas bleeding) and blur the pixel-art look. NEAREST-only
 * stays crisp at every distance at the cost of some shimmering — the standard
 * trade-off for voxel engines.
 */
export function createTextureAtlas(scene: Scene): AtlasResult {
  const width = TILE_PX * ATLAS_COLS;
  const height = TILE_PX * ATLAS_ROWS;
  const texture = new DynamicTexture(
    "atlas",
    { width, height },
    scene,
    false, // generateMipMaps=false — see jsdoc above
    Texture.NEAREST_NEAREST, // mag=NEAREST, min=NEAREST, no mip filter
    undefined, // texture format (default RGBA)
    false, // invertY=false → canvas top row maps to v=0 (matches the prior three.js flipY=false and the tileUV math)
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 1; // no mipmaps → anisotropy is a no-op
  // The atlas carries alpha (plantlike tiles clearRect their backgrounds); the
  // cutout material uses this via useAlphaFromDiffuseTexture + alphaCutOff.
  texture.hasAlpha = true;
  // The DynamicTexture's getContext() returns the 2D context for the canvas
  // it owns; flipY is configured so canvas row 0 (top) maps to v=0, matching
  // the existing tileUV math (which is what the rest of the code expects).
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;

  const rand = rng(1337);
  // Helper: tile index -> top-left pixel offset.
  const off = (tile: number): [number, number] => {
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    return [col * TILE_PX, row * TILE_PX];
  };

  // 0: grass top
  {
    const [ox, oy] = off(0);
    paintSpeckled(ctx, ox, oy, [96, 168, 74], 26, 90, rand);
  }
  // 1: grass side (dirt with grassy top strip)
  {
    const [ox, oy] = off(1);
    paintSpeckled(ctx, ox, oy, [134, 96, 64], 22, 80, rand);
    ctx.fillStyle = "rgb(86,158,66)";
    ctx.fillRect(ox, oy, TILE_PX, 4);
    for (let x = 0; x < TILE_PX; x++) {
      const h = 3 + Math.floor(rand() * 3);
      for (let y = 0; y < h; y++) {
        const d = (rand() - 0.5) * 40;
        const g = clamp255(150 + d);
        ctx.fillStyle = `rgb(${clamp255(86 + d) | 0},${g | 0},${clamp255(66 + d) | 0})`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
  // 2: dirt
  {
    const [ox, oy] = off(2);
    paintSpeckled(ctx, ox, oy, [134, 96, 64], 26, 110, rand);
  }
  // 3: stone
  {
    const [ox, oy] = off(3);
    paintStone(ctx, ox, oy, rand);
  }
  // 4: sand
  {
    const [ox, oy] = off(4);
    paintSpeckled(ctx, ox, oy, [224, 208, 150], 16, 100, rand);
  }
  // 5: wood top (concentric rings)
  {
    const [ox, oy] = off(5);
    ctx.fillStyle = "rgb(176,134,84)";
    ctx.fillRect(ox, oy, TILE_PX, TILE_PX);
    const cx = ox + TILE_PX / 2;
    const cy = oy + TILE_PX / 2;
    for (let r = 1; r < TILE_PX / 2; r += 2) {
      ctx.strokeStyle = `rgb(${120 + ((r * 7) % 30)},${90 + ((r * 5) % 20)},56)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgb(110,80,48)";
    ctx.fillRect(cx - 1 | 0, cy - 1 | 0, 2, 2);
  }
  // 6: wood side (vertical bark)
  {
    const [ox, oy] = off(6);
    paintSpeckled(ctx, ox, oy, [120, 86, 52], 18, 60, rand);
    for (let x = 0; x < TILE_PX; x += 1) {
      if (rand() < 0.4) {
        ctx.fillStyle = `rgb(${90 + Math.floor(rand() * 20)},64,38)`;
        ctx.fillRect(ox + x, oy, 1, TILE_PX);
      }
    }
  }
  // 7: leaves (dense green noise)
  {
    const [ox, oy] = off(7);
    paintSpeckled(ctx, ox, oy, [54, 110, 44], 40, 150, rand);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = "rgb(30,70,28)";
      ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 1, 1);
    }
  }
  // 8: water
  {
    const [ox, oy] = off(8);
    paintSpeckled(ctx, ox, oy, [54, 110, 196], 18, 80, rand);
  }
  // 9: bedrock
  {
    const [ox, oy] = off(9);
    paintSpeckled(ctx, ox, oy, [70, 70, 74], 34, 140, rand);
  }

  // --- New tiles (world-gen upgrade) ---

  // 10: snow
  {
    const [ox, oy] = off(10);
    paintSpeckled(ctx, ox, oy, [238, 242, 250], 8, 70, rand);
  }
  // 11: snowy grass side (dirt with a thick snow cap)
  {
    const [ox, oy] = off(11);
    paintSpeckled(ctx, ox, oy, [134, 96, 64], 22, 80, rand);
    for (let x = 0; x < TILE_PX; x++) {
      const h = 4 + Math.floor(rand() * 3);
      for (let y = 0; y < h; y++) {
        const d = (rand() - 0.5) * 14;
        ctx.fillStyle = `rgb(${clamp255(238 + d) | 0},${clamp255(242 + d) | 0},${clamp255(250 + d) | 0})`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
  // 12: ice
  {
    const [ox, oy] = off(12);
    paintSpeckled(ctx, ox, oy, [150, 192, 236], 16, 70, rand);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 3, 1);
    }
    ctx.strokeStyle = "rgba(120,170,220,0.6)";
    ctx.beginPath();
    ctx.moveTo(ox + 2, oy + 3);
    ctx.lineTo(ox + 10, oy + 12);
    ctx.stroke();
  }
  // 13: desert sand
  {
    const [ox, oy] = off(13);
    paintSpeckled(ctx, ox, oy, [226, 198, 122], 22, 110, rand);
  }
  // 14: desert stone (sandstone-reddish rock)
  {
    const [ox, oy] = off(14);
    paintSpeckled(ctx, ox, oy, [168, 120, 86], 24, 120, rand);
    ctx.fillStyle = "rgb(120,82,58)";
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 2, 1);
    }
  }
  // 15: sandstone top (smooth, faint layers)
  {
    const [ox, oy] = off(15);
    paintSpeckled(ctx, ox, oy, [222, 200, 150], 8, 40, rand);
  }
  // 16: sandstone side (layered)
  {
    const [ox, oy] = off(16);
    paintSpeckled(ctx, ox, oy, [222, 200, 150], 8, 50, rand);
    ctx.fillStyle = "rgb(196,174,128)";
    for (const y of [3, 7, 11]) ctx.fillRect(ox, oy + y, TILE_PX, 1);
  }
  // 17: gravel
  {
    const [ox, oy] = off(17);
    paintSpeckled(ctx, ox, oy, [122, 118, 122], 34, 200, rand);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = "rgb(90,88,92)";
      ctx.fillRect(ox + Math.floor(rand() * (TILE_PX - 2)), oy + Math.floor(rand() * (TILE_PX - 2)), 2, 2);
    }
  }
  // 18: coal ore
  {
    const [ox, oy] = off(18);
    paintOre(ctx, ox, oy, [40, 40, 44], rand, 7);
  }
  // 19: iron ore
  {
    const [ox, oy] = off(19);
    paintOre(ctx, ox, oy, [196, 152, 96], rand, 6);
  }
  // 20: copper ore
  {
    const [ox, oy] = off(20);
    paintOre(ctx, ox, oy, [104, 176, 138], rand, 6);
  }
  // 21: cactus top
  {
    const [ox, oy] = off(21);
    paintSpeckled(ctx, ox, oy, [74, 134, 64], 16, 60, rand);
    ctx.fillStyle = "rgb(110,170,86)";
    ctx.fillRect(ox + 5, oy + 5, 6, 6);
    ctx.fillStyle = "rgb(54,100,48)";
    ctx.fillRect(ox + 7, oy + 7, 2, 2);
  }
  // 22: cactus side (vertical ribs)
  {
    const [ox, oy] = off(22);
    paintSpeckled(ctx, ox, oy, [74, 134, 64], 14, 60, rand);
    ctx.fillStyle = "rgb(104,164,84)";
    ctx.fillRect(ox + 3, oy, 1, TILE_PX);
    ctx.fillRect(ox + 12, oy, 1, TILE_PX);
    ctx.fillStyle = "rgb(50,92,46)";
    ctx.fillRect(ox, oy, 1, TILE_PX);
    ctx.fillRect(ox + 15, oy, 1, TILE_PX);
  }
  // 23: tall grass (plantlike — transparent background, blades point up)
  {
    const [ox, oy] = off(23);
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (let i = 0; i < 9; i++) {
      const bx = ox + 3 + Math.floor(rand() * 10);
      const h = 5 + Math.floor(rand() * 9);
      const shade = 96 + Math.floor(rand() * 60);
      ctx.fillStyle = `rgb(${shade - 30},${shade + 30},${shade - 40})`;
      for (let y = 0; y < h; y++) ctx.fillRect(bx, oy + (TILE_PX - h) + y, 1, 1);
    }
  }
  // 24: flower (red)
  {
    const [ox, oy] = off(24);
    drawFlower(ctx, ox, oy, rand, [210, 64, 64]);
  }
  // 25: flower (yellow)
  {
    const [ox, oy] = off(25);
    drawFlower(ctx, ox, oy, rand, [236, 200, 70]);
  }
  // 26: mushroom
  {
    const [ox, oy] = off(26);
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    // stem
    ctx.fillStyle = "rgb(228,222,206)";
    ctx.fillRect(ox + 6, oy + 8, 4, 5);
    // cap
    ctx.fillStyle = "rgb(188,56,56)";
    ctx.fillRect(ox + 4, oy + 5, 8, 4);
    ctx.fillRect(ox + 5, oy + 4, 6, 1);
    // spots
    ctx.fillStyle = "rgb(240,238,230)";
    ctx.fillRect(ox + 6, oy + 6, 1, 1);
    ctx.fillRect(ox + 9, oy + 7, 1, 1);
    ctx.fillRect(ox + 7, oy + 9, 1, 1);
  }

  // --- Additional biome tiles (richer world gen) ---

  // 27: dry grass top (savanna — pale yellow-green)
  {
    const [ox, oy] = off(27);
    paintSpeckled(ctx, ox, oy, [158, 150, 78], 22, 90, rand);
  }
  // 28: dry grass side (dirt with a dry-grass lip)
  paintGrassSide(ctx, off(28)[0], off(28)[1], [150, 144, 74], rand);
  // 29: jungle grass top (dark lush green)
  {
    const [ox, oy] = off(29);
    paintSpeckled(ctx, ox, oy, [54, 104, 40], 30, 110, rand);
  }
  // 30: jungle grass side (dirt with a dark-green lip)
  paintGrassSide(ctx, off(30)[0], off(30)[1], [46, 92, 36], rand);
  // 31: jungle leaves (dark, dense)
  {
    const [ox, oy] = off(31);
    paintSpeckled(ctx, ox, oy, [34, 82, 34], 34, 150, rand);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = "rgb(20,52,22)";
      ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 1, 1);
    }
  }
  // 32: mossy stone (stone with green moss patches)
  {
    const [ox, oy] = off(32);
    paintStone(ctx, ox, oy, rand);
    ctx.fillStyle = "rgb(70,108,56)";
    for (let i = 0; i < 14; i++) {
      ctx.fillRect(ox + Math.floor(rand() * (TILE_PX - 2)), oy + Math.floor(rand() * (TILE_PX - 2)), 2, 2);
    }
  }
  // 33: glowstone (warm, glowing emissive block for testing block light)
  {
    const [ox, oy] = off(33);
    paintSpeckled(ctx, ox, oy, [244, 217, 122], 30, 120, rand);
    ctx.fillStyle = "rgb(255,244,190)";
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 1, 1);
    }
    ctx.fillStyle = "rgb(180,150,60)";
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 1, 1);
    }
  }

  // --- Richer-world tiles (world-gen upgrade): 34..42 ---

  // 34: dead bush (desert — dry brown twigs, plantlike transparent bg)
  {
    const [ox, oy] = off(34);
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = "rgb(120,92,52)";
    // central stalk
    ctx.fillRect(ox + 8, oy + 4, 1, 10);
    // branching twigs
    ctx.fillRect(ox + 8, oy + 6, 3, 1);
    ctx.fillRect(ox + 11, oy + 6, 1, 3);
    ctx.fillRect(ox + 5, oy + 8, 3, 1);
    ctx.fillRect(ox + 4, oy + 6, 1, 3);
    ctx.fillStyle = "rgb(150,116,70)";
    ctx.fillRect(ox + 8, oy + 11, 4, 1);
    ctx.fillRect(ox + 12, oy + 11, 1, 3);
    ctx.fillRect(ox + 6, oy + 12, 2, 1);
  }
  // 35: fern (forest ground cover, plantlike)
  {
    const [ox, oy] = off(35);
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    const shades = ["#3e7e36", "#4e8e40", "#5ea048"];
    for (let i = 0; i < 5; i++) {
      const bx = ox + 3 + i * 2;
      const h = 6 + (i % 3) * 2;
      ctx.fillStyle = shades[i % shades.length];
      for (let y = 0; y < h; y++) {
        const w = y < h - 2 ? 1 : 2;
        ctx.fillRect(bx - (y > h - 3 ? 1 : 0), oy + (TILE_PX - h) + y, w, 1);
        ctx.fillRect(bx + (y > h - 3 ? 0 : 0), oy + (TILE_PX - h) + y, 1, 1);
      }
    }
  }
  // 36: papyrus (tall reed near water, plantlike)
  {
    const [ox, oy] = off(36);
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (const cx of [6, 8, 10]) {
      const h = 12 + (cx % 3);
      for (let y = 0; y < h; y++) {
        const d = (rand() - 0.5) * 16;
        const g = clamp255(150 + d) | 0;
        ctx.fillStyle = `rgb(${clamp255(130 + d) | 0},${g},${clamp255(80 + d) | 0})`;
        ctx.fillRect(ox + cx, oy + (TILE_PX - h) + y, 1, 1);
      }
      // leafy top
      ctx.fillStyle = "rgb(110,150,64)";
      ctx.fillRect(ox + cx - 1, oy + (TILE_PX - h), 1, 1);
      ctx.fillRect(ox + cx + 1, oy + (TILE_PX - h) + 1, 1, 1);
    }
  }
  // 37: cornflower (blue flower, plantlike)
  {
    const [ox, oy] = off(37);
    drawFlower(ctx, ox, oy, rand, [74, 108, 214]);
  }
  // 38: birch wood top (pale with faint rings)
  {
    const [ox, oy] = off(38);
    paintSpeckled(ctx, ox, oy, [216, 208, 188], 8, 50, rand);
    ctx.strokeStyle = "rgba(150,140,120,0.6)";
    ctx.beginPath();
    ctx.arc(ox + 8, oy + 8, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 39: birch wood side (white bark with black dashes)
  {
    const [ox, oy] = off(39);
    paintSpeckled(ctx, ox, oy, [222, 214, 196], 8, 70, rand);
    ctx.fillStyle = "rgb(54,50,46)";
    for (let i = 0; i < 7; i++) {
      const x = ox + Math.floor(rand() * (TILE_PX - 3));
      const y = oy + 1 + Math.floor(rand() * (TILE_PX - 2));
      const w = 2 + Math.floor(rand() * 2);
      ctx.fillRect(x, y, w, 1);
    }
  }
  // 40: birch leaves (bright yellow-green, lighter than oak)
  {
    const [ox, oy] = off(40);
    paintSpeckled(ctx, ox, oy, [120, 170, 70], 36, 150, rand);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = "rgb(90,140,46)";
      ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 1, 1);
    }
  }
  // 41: spruce leaves (dark, cold green for taiga/snowy pines)
  {
    const [ox, oy] = off(41);
    paintSpeckled(ctx, ox, oy, [38, 74, 42], 28, 150, rand);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = "rgb(22,48,26)";
      ctx.fillRect(ox + Math.floor(rand() * TILE_PX), oy + Math.floor(rand() * TILE_PX), 1, 1);
    }
  }
  // 42: snowy leaves (spruce green dusted with white snow)
  {
    const [ox, oy] = off(42);
    paintSpeckled(ctx, ox, oy, [40, 78, 46], 26, 120, rand);
    // snow caps along the top third
    ctx.fillStyle = "rgb(238,242,250)";
    for (let x = 0; x < TILE_PX; x++) {
      const h = 3 + Math.floor(rand() * 4);
      for (let y = 0; y < h; y++) {
        const d = (rand() - 0.5) * 12;
        ctx.fillStyle = `rgb(${clamp255(238 + d) | 0},${clamp255(242 + d) | 0},${clamp255(250 + d) | 0})`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
  // 43: crafting table top — dark wood with a 3x3 grid of lighter cells
  {
    const [ox, oy] = off(43);
    paintSpeckled(ctx, ox, oy, [104, 70, 40], 14, 70, rand);
    // grid lines dividing the tile into a 3x3 of ~5px cells
    ctx.fillStyle = "rgb(54,36,20)";
    for (const p of [5, 10]) {
      ctx.fillRect(ox, oy + p, TILE_PX, 1);
      ctx.fillRect(ox + p, oy, 1, TILE_PX);
    }
    // faint lighter inset on each cell to read as a work surface
    ctx.fillStyle = "rgba(196,150,92,0.35)";
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillRect(ox + c * 5 + 1, oy + r * 5 + 1, 3, 3);
      }
    }
  }
  // 44: crafting table side — plank bands with a darker tool strip
  {
    const [ox, oy] = off(44);
    paintSpeckled(ctx, ox, oy, [150, 104, 60], 12, 70, rand);
    // horizontal plank seams
    ctx.fillStyle = "rgb(96,64,34)";
    for (const y of [4, 8, 12]) ctx.fillRect(ox, oy + y, TILE_PX, 1);
    // a dark recessed strip (the "tool drawer" band) across the middle
    ctx.fillStyle = "rgb(70,46,24)";
    ctx.fillRect(ox, oy + 6, TILE_PX, 2);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(ox + 2, oy + 6, 3, 1);
    ctx.fillRect(ox + 9, oy + 6, 4, 1);
  }

  // Upload the painted canvas to the GPU.
  texture.update(false);

  return { texture };
}

/** A simple flower: green stem + leaf + colored petals near the top. */
function drawFlower(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  rand: () => number,
  petal: RGB,
): void {
  ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
  // stem
  ctx.fillStyle = "rgb(74,128,52)";
  ctx.fillRect(ox + 7, oy + 6, 1, 9);
  // leaf
  ctx.fillRect(ox + 5, oy + 11, 2, 1);
  // petals (a 3x3 cluster near the top)
  ctx.fillStyle = `rgb(${petal[0]},${petal[1]},${petal[2]})`;
  ctx.fillRect(ox + 6, oy + 4, 3, 3);
  ctx.fillRect(ox + 5, oy + 5, 5, 1);
  ctx.fillRect(ox + 5, oy + 6, 1, 1);
  ctx.fillRect(ox + 9, oy + 6, 1, 1);
  // center
  ctx.fillStyle = `rgb(${clamp255(petal[0] + 30)},${clamp255(petal[1] + 30)},${clamp255(petal[2] - 10)})`;
  ctx.fillRect(ox + 7, oy + 5, 1, 1);
  void rand;
}

/**
 * UV rectangle (in atlas [0,1] space) for a tile index, with a half-texel
 * inset to avoid bleeding between adjacent tiles under nearest filtering.
 */
export function tileUV(tile: number): { u0: number; v0: number; u1: number; v1: number } {
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  const inset = 0.5 / (TILE_PX * ATLAS_COLS);
  const u0 = col / ATLAS_COLS + inset;
  const u1 = (col + 1) / ATLAS_COLS - inset;
  const v0 = row / ATLAS_ROWS + inset;
  const v1 = (row + 1) / ATLAS_ROWS - inset;
  return { u0, v0, u1, v1 };
}

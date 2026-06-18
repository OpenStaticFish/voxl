import type { ItemId } from "./Items";

// Crafting recipe registry + a pure grid matcher. Recipes come in two flavours:
//
//   * shaped   — a 2D pattern of single-char keys. Position matters, but the
//                matcher is symmetry-tolerant: a recipe matches the grid's
//                bounding box under ANY of the 8 dihedral transforms (rotations
//                + reflections), so a vertical "stick" also matches when the
//                player lays the ingredients out horizontally.
//   * shapeless — a multiset of ingredients; order and position are irrelevant.
//
// `match()` takes a flat grid of item ids (length 4 for the 2x2 inventory grid,
// length 9 for a 3x3 crafting table) and returns the matched recipe plus the
// output stack, or null. It is intentionally pure (no Inventory / DOM access)
// so it can be unit-tested in isolation.

/** A shaped recipe: a 2D pattern of single-char keys mapped to item ids. */
export interface ShapedRecipe {
  type: "shaped";
  /**
   * Pattern rows. Each string is one row; each char is one cell. A space or "."
   * denotes an empty cell. All rows must be the same length.
   */
  pattern: string[];
  /** Maps each non-empty pattern char to the ingredient item id it represents. */
  key: Record<string, ItemId>;
  /** Output item id. */
  result: ItemId;
  /** Output stack size (default 1). */
  count?: number;
}

/** A shapeless recipe: a multiset of ingredients, position/order irrelevant. */
export interface ShapelessRecipe {
  type: "shapeless";
  /** Ingredient item ids — one entry per item consumed. */
  ingredients: ItemId[];
  result: ItemId;
  count?: number;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

/** The outcome of a successful match. */
export interface MatchResult {
  /** The recipe that matched (carries result + count + inputs). */
  recipe: Recipe;
  /** Output item id. */
  result: ItemId;
  /** Output stack size. */
  count: number;
}

// Item ids referenced by the starter recipes. The "log" is the Wood block item
// (block id 5 → item "b5"); planks/stick are pure material items registered in
// Items.ts; the crafting table is block id 38 → item "b38".
const LOG = "b5";
const PLANKS = "planks";
const STICK = "stick";
const CRAFTING_TABLE = "b38";

/**
 * The recipe registry. Append-only: existing entries keep their position so
 * saves that might one day reference recipe ids stay stable.
 */
export const RECIPES: readonly Recipe[] = [
  // 1 log -> 4 planks (shapeless — position irrelevant).
  {
    type: "shapeless",
    ingredients: [LOG],
    result: PLANKS,
    count: 4,
  },
  // 2 planks (stacked) -> 4 sticks. Matches vertical OR horizontal placement
  // thanks to the dihedral-symmetry matcher.
  {
    type: "shaped",
    pattern: ["P", "P"],
    key: { P: PLANKS },
    result: STICK,
    count: 4,
  },
  // 4 planks (2x2) -> 1 crafting table.
  {
    type: "shaped",
    pattern: ["PP", "PP"],
    key: { P: PLANKS },
    result: CRAFTING_TABLE,
    count: 1,
  },
];

// ---------------------------------------------------------------------------
// Matcher internals
// ---------------------------------------------------------------------------

type Cell = ItemId | null;
type Matrix = Cell[][];

function isFilled(v: ItemId | null | undefined): v is ItemId {
  return v !== null && v !== undefined;
}

function patternToMatrix(recipe: ShapedRecipe): Matrix {
  const rows = recipe.pattern.length;
  const cols = rows > 0 ? recipe.pattern[0].length : 0;
  const m: Matrix = [];
  for (let r = 0; r < rows; r++) {
    const prow = recipe.pattern[r] ?? "";
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      const ch = prow[c];
      row.push(ch === undefined || ch === " " || ch === "." ? null : (recipe.key[ch] ?? null));
    }
    m.push(row);
  }
  return m;
}

function colEmpty(m: Matrix, c: number): boolean {
  for (let r = 0; r < m.length; r++) if (m[r][c] !== null) return false;
  return true;
}

/** Trim fully-empty border rows/columns, returning the smallest filled sub-matrix. */
function trim(m: Matrix): Matrix {
  let top = 0;
  let bottom = m.length - 1;
  while (top <= bottom && m[top].every((v) => v === null)) top++;
  while (bottom >= top && m[bottom].every((v) => v === null)) bottom--;
  if (top > bottom) return [];
  const width = m[0].length;
  let left = 0;
  let right = width - 1;
  while (left <= right && colEmpty(m, left)) left++;
  while (right >= left && colEmpty(m, right)) right--;
  if (left > right) return [];
  const out: Matrix = [];
  for (let r = top; r <= bottom; r++) out.push(m[r].slice(left, right + 1));
  return out;
}

function matricesEqual(a: Matrix, b: Matrix): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    const ar = a[r];
    const br = b[r];
    if (ar.length !== br.length) return false;
    for (let c = 0; c < ar.length; c++) if (ar[c] !== br[c]) return false;
  }
  return true;
}

/** Reflect a matrix left-to-right. */
function reflect(m: Matrix): Matrix {
  return m.map((row) => [...row].reverse());
}

/** Rotate a matrix 90° clockwise. */
function rotate90(m: Matrix): Matrix {
  const rows = m.length;
  const cols = rows > 0 ? m[0].length : 0;
  const out: Matrix = [];
  for (let c = 0; c < cols; c++) {
    const row: Cell[] = [];
    for (let r = rows - 1; r >= 0; r--) row.push(m[r][c]);
    out.push(row);
  }
  return out;
}

/**
 * Yield the unique matrices in the dihedral group D4 of `m` (the 8 rotations +
 * reflections of a square). Used so a shaped recipe matches regardless of how
 * the player oriented it on the grid.
 */
function symmetries(m: Matrix): Matrix[] {
  const seen: Matrix[] = [];
  const push = (x: Matrix): void => {
    if (!seen.some((s) => matricesEqual(s, x))) seen.push(x);
  };
  let cur = m;
  for (let i = 0; i < 4; i++) {
    push(cur);
    cur = rotate90(cur);
  }
  cur = reflect(m);
  for (let i = 0; i < 4; i++) {
    push(cur);
    cur = rotate90(cur);
  }
  return seen;
}

function matchShaped(recipe: ShapedRecipe, gridTrimmed: Matrix): boolean {
  const pat = trim(patternToMatrix(recipe));
  if (pat.length === 0) return false;
  for (const variant of symmetries(pat)) {
    if (matricesEqual(variant, gridTrimmed)) return true;
  }
  return false;
}

function matchShapeless(recipe: ShapelessRecipe, items: ItemId[]): boolean {
  if (items.length !== recipe.ingredients.length) return false;
  const want = [...recipe.ingredients].sort();
  const have = [...items].sort();
  return want.every((x, i) => x === have[i]);
}

// ---------------------------------------------------------------------------
// Public matcher
// ---------------------------------------------------------------------------

/**
 * Match a crafting grid against the recipe registry.
 *
 * @param grid flat array of slots. Length 4 → 2x2 (inventory grid); length 9 →
 *   3x3 (crafting table). `null` denotes an empty cell. Any other length, or a
 *   non-square length, yields null.
 * @returns the match (recipe + result + count), or null if nothing matches.
 */
export function match(grid: (ItemId | null)[]): MatchResult | null {
  const w = Math.round(Math.sqrt(grid.length));
  if (w < 1 || w * w !== grid.length) return null;

  // Build the w×w matrix and its trimmed bounding box.
  const matrix: Matrix = [];
  for (let r = 0; r < w; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < w; c++) row.push(grid[r * w + c] ?? null);
    matrix.push(row);
  }
  const trimmed = trim(matrix);
  if (trimmed.length === 0) return null;

  // Flatten non-null items for shapeless comparison.
  const items = grid.filter(isFilled);

  for (const recipe of RECIPES) {
    if (recipe.type === "shapeless") {
      if (matchShapeless(recipe, items)) {
        return { recipe, result: recipe.result, count: recipe.count ?? 1 };
      }
    } else if (matchShaped(recipe, trimmed)) {
      return { recipe, result: recipe.result, count: recipe.count ?? 1 };
    }
  }
  return null;
}

import { Inventory, type ItemStack } from "../game/Inventory";
import {
  CREATIVE_PALETTE,
  getItem,
  isFood,
  type GameMode,
  type ItemId,
} from "../game/Items";

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/**
 * Full-screen inventory (Minetest/Luanti-style). Renders the player's backpack
 * grid + hotbar (shared slots), a crafting placeholder, and — in creative — a
 * searchable palette of every item. Supports cursor-based pickup/place/swap and
 * a Survival/Creative mode toggle. Mutates the Inventory directly and notifies
 * the Game via callbacks for mode changes, refresh and close.
 */
export class InventoryUI {
  private readonly root: HTMLElement;
  private readonly inventory: Inventory;
  private getMode: () => GameMode;

  onModeChange?: (mode: GameMode) => void;
  onClose?: () => void;
  onRefresh?: () => void;

  private held: ItemStack | null = null;
  private heldEl: HTMLElement;
  private titleEl!: HTMLElement;
  private toggleBtn!: HTMLButtonElement;
  private paletteWrap!: HTMLElement;
  private paletteGrid!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private readonly slotEls: HTMLElement[] = [];

  private searchTerm = "";

  constructor(root: HTMLElement, inventory: Inventory, getMode: () => GameMode) {
    this.root = root;
    this.inventory = inventory;
    this.getMode = getMode;
    this.heldEl = el("div", "held-stack");
    this.heldEl.style.display = "none";
    this.build();
  }

  private build(): void {
    this.root.innerHTML = "";
    this.root.classList.add("inv-screen", "screen", "overlay");
    this.root.setAttribute("hidden", "");

    const panel = el("div", "inv-panel");
    this.titleEl = el("div", "inv-title");
    this.toggleBtn = document.createElement("button");
    this.toggleBtn.className = "btn btn-small inv-toggle";
    this.toggleBtn.addEventListener("click", () => {
      this.onModeChange?.(this.getMode() === "creative" ? "survival" : "creative");
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "btn btn-small inv-close";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => this.onClose?.());

    const head = el("div", "inv-head");
    head.append(this.titleEl, this.toggleBtn, closeBtn);

    const body = el("div", "inv-body");

    // --- Left: player inventory + crafting placeholder ---
    const main = el("div", "inv-main");

    const craft = el("div", "inv-craft");
    const craftLabel = el("div", "inv-section-label");
    craftLabel.textContent = "Crafting — Tier 3";
    const craftGrid = el("div", "inv-craft-grid");
    for (let i = 0; i < 4; i++) {
      const s = el("div", "slot slot-disabled");
      craftGrid.append(s);
    }
    const craftArrow = el("div", "inv-arrow");
    craftArrow.textContent = "→";
    const craftOut = el("div", "slot slot-disabled");
    craft.append(craftLabel, craftGrid, craftArrow, craftOut, this.makeTrash());

    const backpack = el("div", "inv-grid");
    for (let i = this.inventory.hotbarSize; i < this.inventory.size; i++) {
      backpack.append(this.makeSlot(i));
    }

    const hotbar = el("div", "inv-hotbar");
    for (let i = 0; i < this.inventory.hotbarSize; i++) {
      hotbar.append(this.makeSlot(i));
    }

    main.append(craft, backpack, hotbar);

    // --- Right: creative palette ---
    const palette = el("div", "inv-palette");
    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.placeholder = "Search items…";
    this.searchInput.className = "text-input inv-search";
    this.searchInput.addEventListener("input", () => {
      this.searchTerm = this.searchInput.value.toLowerCase().trim();
      this.renderPalette();
    });
    // Escape closes the inventory even while the search field has focus (the
    // global Input handler bails on keydowns originating from <input>s).
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.onClose?.();
      }
    });
    this.paletteGrid = el("div", "inv-palette-grid");
    this.paletteWrap = palette;
    palette.append(this.searchInput, this.paletteGrid);

    body.append(main, palette);
    panel.append(head, body);
    this.root.append(panel, this.heldEl);

    this.root.addEventListener("mousemove", (e) => {
      this.heldEl.style.left = `${e.clientX + 4}px`;
      this.heldEl.style.top = `${e.clientY + 4}px`;
    });
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());

    this.refresh();
  }

  private makeTrash(): HTMLElement {
    const trash = el("div", "slot slot-trash");
    trash.title = "Trash — click with a held stack to destroy it";
    trash.textContent = "🗑";
    trash.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (this.held) {
        this.held = null;
        this.renderHeld();
        this.onRefresh?.();
      }
    });
    return trash;
  }

  private makeSlot(index: number): HTMLElement {
    const s = el("div", "slot inv-slot");
    s.dataset.index = String(index);
    s.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (e.button === 0) this.leftClickSlot(index);
      else if (e.button === 2) this.rightClickSlot(index);
    });
    s.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this.slotEls[index] = s;
    return s;
  }

  private leftClickSlot(index: number): void {
    const stack = this.inventory.getSlot(index);
    if (!this.held) {
      if (stack) {
        this.held = stack;
        this.inventory.setSlot(index, null);
      }
    } else if (!stack) {
      this.inventory.setSlot(index, this.held);
      this.held = null;
    } else if (stack.id === this.held.id) {
      const max = getItem(stack.id)?.maxStack ?? 64;
      const room = max - stack.count;
      const take = Math.min(room, this.held.count);
      stack.count += take;
      this.held.count -= take;
      if (this.held.count <= 0) this.held = null;
    } else {
      this.inventory.setSlot(index, this.held);
      this.held = stack;
    }
    this.afterChange();
  }

  private rightClickSlot(index: number): void {
    const stack = this.inventory.getSlot(index);
    if (!this.held) {
      if (stack && stack.count > 0) {
        const half = Math.ceil(stack.count / 2);
        this.held = { id: stack.id, count: half };
        stack.count -= half;
        if (stack.count <= 0) this.inventory.setSlot(index, null);
      }
    } else {
      if (!stack) {
        this.inventory.setSlot(index, { id: this.held.id, count: 1 });
        this.held.count -= 1;
      } else if (stack.id === this.held.id) {
        const max = getItem(stack.id)?.maxStack ?? 64;
        if (stack.count < max) {
          stack.count += 1;
          this.held.count -= 1;
        }
      }
      if (this.held.count <= 0) this.held = null;
    }
    this.afterChange();
  }

  private giveFromPalette(id: ItemId, full: boolean): void {
    const max = getItem(id)?.maxStack ?? 64;
    this.held = { id, count: full ? max : 1 };
    this.afterChange();
  }

  private afterChange(): void {
    this.renderSlots();
    this.renderHeld();
    this.onRefresh?.();
  }

  private renderSlots(): void {
    for (let i = 0; i < this.slotEls.length; i++) {
      this.paintSlot(this.slotEls[i], this.inventory.getSlot(i));
    }
  }

  private paintSlot(node: HTMLElement, stack: ItemStack | null): void {
    node.classList.toggle("filled", !!stack);
    node.innerHTML = "";
    if (!stack) return;
    const def = getItem(stack.id);
    const sw = el("div", "swatch");
    if (def?.icon === "food") sw.classList.add("swatch-food");
    sw.style.background = def?.color ?? "#888";
    node.append(sw);
    if (stack.count > 1) {
      const c = el("span", "count");
      c.textContent = String(stack.count);
      node.append(c);
    }
  }

  private renderHeld(): void {
    if (!this.held) {
      this.heldEl.style.display = "none";
      this.heldEl.innerHTML = "";
      return;
    }
    this.heldEl.innerHTML = "";
    const def = getItem(this.held.id);
    const sw = el("div", "swatch");
    if (def?.icon === "food") sw.classList.add("swatch-food");
    sw.style.background = def?.color ?? "#888";
    this.heldEl.append(sw);
    if (this.held.count > 1) {
      const c = el("span", "count");
      c.textContent = String(this.held.count);
      this.heldEl.append(c);
    }
    this.heldEl.style.display = "flex";
  }

  private renderPalette(): void {
    this.paletteGrid.innerHTML = "";
    const term = this.searchTerm;
    for (const id of CREATIVE_PALETTE) {
      const def = getItem(id);
      if (!def) continue;
      if (term && !def.name.toLowerCase().includes(term)) continue;
      const node = el("div", "slot palette-slot");
      node.title = def.name;
      const sw = el("div", "swatch");
      if (def.icon === "food") sw.classList.add("swatch-food");
      sw.style.background = def.color;
      node.append(sw);
      node.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (e.button === 0) this.giveFromPalette(id, true);
        else if (e.button === 2) this.giveFromPalette(id, false);
      });
      node.addEventListener("contextmenu", (ev) => ev.preventDefault());
      this.paletteGrid.append(node);
    }
  }

  refresh(): void {
    const mode = this.getMode();
    this.titleEl.textContent = mode === "creative" ? "Creative Inventory" : "Survival Inventory";
    this.toggleBtn.textContent = mode === "creative" ? "Switch to Survival" : "Switch to Creative";
    this.paletteWrap.style.display = mode === "creative" ? "flex" : "none";
    this.renderSlots();
    this.renderPalette();
    this.renderHeld();
  }

  open(): void {
    this.held = null;
    this.searchTerm = "";
    this.searchInput.value = "";
    this.refresh();
    this.root.removeAttribute("hidden");
  }

  close(): void {
    // Return anything on the cursor to the inventory.
    if (this.held) {
      const leftover = this.inventory.add(this.held.id, this.held.count);
      this.held = null;
      if (leftover > 0) this.onRefresh?.();
    }
    this.root.setAttribute("hidden", "");
  }

  get isOpen(): boolean {
    return !this.root.hasAttribute("hidden");
  }
}

import type { FoodDef, GameMode } from "./Items";

/**
 * Survival vitals: health, hunger, saturation, exhaustion and breath. Tuned to
 * Luanti/VoxeLibre conventions (20 HP shown as 10 hearts, 20 hunger shown as 10
 * drumsticks, breath 10 bubbles, exhaustion overflow at 4000). All damage and
 * regen flows through here so death is detected in one place.
 */

export const MAX_HP = 20;
export const MAX_HUNGER = 20;
export const MAX_SATURATION = 20;
export const EXHAUST_LEVEL = 4000;
export const MAX_BREATH = 10;

const BREATH_LOSS_INTERVAL = 2;
const BREATH_REGEN_INTERVAL = 0.5;
const FOOD_TICK_INTERVAL = 4;
const DROWN_DAMAGE = 1;
const STARVE_MIN_HP = 1;
const SAFE_FALL_BLOCKS = 3;

export interface SerializedStats {
  hp: number;
  hunger: number;
  saturation: number;
  exhaustion: number;
  breath: number;
}

export class PlayerState {
  hp = MAX_HP;
  hunger = MAX_HUNGER;
  saturation = 5;
  exhaustion = 0;
  breath = MAX_BREATH;
  dead = false;

  private breathLossT = 0;
  private breathRegenT = 0;
  private foodT = 0;

  get alive(): boolean {
    return !this.dead;
  }

  reset(): void {
    this.hp = MAX_HP;
    this.hunger = MAX_HUNGER;
    this.saturation = 5;
    this.exhaustion = 0;
    this.breath = MAX_BREATH;
    this.dead = false;
    this.breathLossT = 0;
    this.breathRegenT = 0;
    this.foodT = 0;
  }

  invulnerable(mode: GameMode): boolean {
    return mode === "creative";
  }

  /** Deal damage. Returns true if this blow killed the player. */
  damage(amount: number, mode: GameMode): boolean {
    if (this.invulnerable(mode) || this.dead || amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.exhaustion += 100;
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    this.cascadeExhaustion();
    return false;
  }

  heal(amount: number): void {
    if (this.dead) return;
    this.hp = Math.min(MAX_HP, this.hp + amount);
  }

  eat(food: FoodDef): void {
    this.hunger = Math.min(MAX_HUNGER, this.hunger + food.hunger);
    this.saturation = Math.min(MAX_SATURATION, this.saturation + food.saturation);
  }

  addExhaustion(amount: number): void {
    this.exhaustion += amount;
    this.cascadeExhaustion();
  }

  private cascadeExhaustion(): void {
    while (this.exhaustion >= EXHAUST_LEVEL) {
      this.exhaustion -= EXHAUST_LEVEL;
      if (this.saturation > 0) {
        this.saturation = Math.max(0, this.saturation - 1);
      } else if (this.hunger > 0) {
        this.hunger = Math.max(0, this.hunger - 1);
      } else {
        this.exhaustion = 0;
        break;
      }
    }
  }

  /** Per-frame survival ticking (breath, regen, starvation). */
  tick(dt: number, mode: GameMode, submerged: boolean): void {
    if (this.invulnerable(mode)) {
      this.breath = MAX_BREATH;
      return;
    }
    if (this.dead) return;

    // --- Breath / drowning ---
    if (submerged) {
      this.breathRegenT = 0;
      this.breathLossT += dt;
      if (this.breathLossT >= BREATH_LOSS_INTERVAL) {
        this.breathLossT -= BREATH_LOSS_INTERVAL;
        if (this.breath > 0) {
          this.breath -= 1;
        } else {
          this.damage(DROWN_DAMAGE, mode);
        }
      }
    } else {
      this.breathLossT = 0;
      this.breathRegenT += dt;
      if (this.breathRegenT >= BREATH_REGEN_INTERVAL) {
        this.breathRegenT -= BREATH_REGEN_INTERVAL;
        this.breath = Math.min(MAX_BREATH, this.breath + 1);
      }
    }

    // --- Food cycle (regen + starvation) ---
    this.foodT += dt;
    if (this.foodT >= FOOD_TICK_INTERVAL) {
      this.foodT -= FOOD_TICK_INTERVAL;
      if (this.hunger >= 18 && this.hp < MAX_HP) {
        this.heal(1);
        this.addExhaustion(6000);
      } else if (this.hunger <= 0) {
        // Starvation drains HP but cannot kill on normal difficulty.
        if (this.hp > STARVE_MIN_HP) this.hp = Math.max(STARVE_MIN_HP, this.hp - 1);
      }
    }
  }

  /** Convert a fall distance (in blocks) into damage, or 0 if safe. */
  static fallDamage(blocksFallen: number): number {
    if (blocksFallen <= SAFE_FALL_BLOCKS) return 0;
    return Math.floor(blocksFallen - SAFE_FALL_BLOCKS);
  }

  serialize(): SerializedStats {
    return {
      hp: this.hp,
      hunger: this.hunger,
      saturation: this.saturation,
      exhaustion: this.exhaustion,
      breath: this.breath,
    };
  }

  load(data: SerializedStats | undefined): void {
    if (!data) return;
    this.hp = data.hp ?? MAX_HP;
    this.hunger = data.hunger ?? MAX_HUNGER;
    this.saturation = data.saturation ?? 5;
    this.exhaustion = data.exhaustion ?? 0;
    this.breath = data.breath ?? MAX_BREATH;
    this.dead = this.hp <= 0;
  }
}

/**
 * Seeded, serialisable RNG (mulberry32). The state is a single uint32 kept
 * in GameState.rng, so a saved game resumes the exact same random sequence.
 *
 * Functions here are pure: they take a state and return [value, nextState].
 * Inside the reducer, use the `Rng` wrapper, which reads and writes the
 * state on a draft GameState.
 */

/** Hash a string seed to a uint32 (FNV-1a). */
export function seedToState(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Returns a float in [0, 1) and the next state. */
export function nextFloat(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Mutable wrapper over a holder object with an `rng` field (a draft GameState). */
export class Rng {
  constructor(private holder: { rng: number }) {}

  float(): number {
    const [v, s] = nextFloat(this.holder.rng);
    this.holder.rng = s;
    return v;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[Math.floor(this.float() * items.length)];
  }

  weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    const total = items.reduce((sum, it) => sum + Math.max(0, weight(it)), 0);
    if (total <= 0) return this.pick(items);
    let roll = this.float() * total;
    for (const it of items) {
      roll -= Math.max(0, weight(it));
      if (roll < 0) return it;
    }
    return items[items.length - 1];
  }

  /** Fisher-Yates shuffle, in place. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** Pick n distinct items (or all of them if there are fewer). */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle([...items]).slice(0, n);
  }
}

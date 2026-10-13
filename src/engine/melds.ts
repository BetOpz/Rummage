/**
 * Meld validation. Pure functions over "meld tokens", independent of game state.
 *
 * A card becomes a token via its meld role (see effects.ts `meldRole`):
 *  - natural: a real part with a category and gauge (1 slot)
 *  - wild:    counts as any part (1 slot)                       e.g. Duct Tape
 *  - bulk:    counts as `slots` copies of the set's part (sets only) e.g. Bulk Pack
 *  - adaptor: takes no slot; lets one natural in the meld shift its gauge
 *             by +/-1 OR change its category                     e.g. Adaptor
 */

import type { MeldRequirement, MeldRole, MeldType, RoundRules } from './types';

export type MeldToken =
  | { role: 'natural'; id: string; category: string; gauge: number }
  | { role: 'wild'; id: string }
  | { role: 'bulk'; id: string; slots: number }
  | { role: 'adaptor'; id: string };

/** The subset of round rules that meld validation needs. */
export type MeldRules = Pick<
  RoundRules,
  'gaugeMin' | 'gaugeMax' | 'disabledMeldRoles' | 'bannedCategories' | 'requireNaturalInMeld'
>;

export type MeldResult =
  | {
      ok: true;
      slots: number;
      /** For sets: the gauge used. For runs: category and starting gauge. */
      gauge?: number;
      category?: string;
      start?: number;
      adaptorsUsed: number;
    }
  | { ok: false; reason: string };

const fail = (reason: string): MeldResult => ({ ok: false, reason });

export function tokenSlots(t: MeldToken): number {
  switch (t.role) {
    case 'natural':
    case 'wild':
      return 1;
    case 'bulk':
      return t.slots;
    case 'adaptor':
      return 0;
  }
}

/** Validate tokens against a single meld requirement. */
export function validateMeld(tokens: MeldToken[], req: MeldRequirement, rules: MeldRules): MeldResult {
  if (tokens.length === 0) return fail('No cards in meld');

  for (const t of tokens) {
    if (rules.disabledMeldRoles.includes(t.role as MeldRole)) {
      return fail(`${t.role} cards are disabled this round`);
    }
    if (t.role === 'natural' && rules.bannedCategories.includes(t.category)) {
      return fail(`${t.category} parts are banned this round`);
    }
  }

  const naturals = tokens.filter((t): t is Extract<MeldToken, { role: 'natural' }> => t.role === 'natural');
  const adaptors = tokens.filter((t) => t.role === 'adaptor').length;
  const slots = tokens.reduce((sum, t) => sum + tokenSlots(t), 0);

  if (rules.requireNaturalInMeld && naturals.length === 0) return fail('A meld needs at least one real part');
  if (slots < req.size) return fail(`Needs ${req.size} cards, has ${slots}`);

  const lo = Math.max(rules.gaugeMin, req.minGauge ?? rules.gaugeMin);
  const hi = Math.min(rules.gaugeMax, req.maxGauge ?? rules.gaugeMax);
  if (lo > hi) return fail('No gauge satisfies the constraints');

  return req.type === 'set'
    ? validateSet(naturals, adaptors, slots, req, lo, hi)
    : validateRun(tokens, naturals, adaptors, slots, req, lo, hi);
}

type Natural = Extract<MeldToken, { role: 'natural' }>;

function validateSet(
  naturals: Natural[],
  adaptors: number,
  slots: number,
  req: MeldRequirement,
  lo: number,
  hi: number,
): MeldResult {
  let best: MeldResult = fail('Cards do not share a gauge');
  for (let g = lo; g <= hi; g++) {
    let needed = 0;
    let possible = true;
    for (const n of naturals) {
      const gaugeOk = n.gauge === g;
      const catOk = !req.category || n.category === req.category;
      if (gaugeOk && catOk) continue;
      // One adaptor fixes one thing: either the gauge (+/-1) or the category.
      if (!gaugeOk && !catOk) {
        possible = false;
        break;
      }
      if (!gaugeOk && Math.abs(n.gauge - g) !== 1) {
        possible = false;
        break;
      }
      needed++;
    }
    if (!possible) continue;
    if (needed > adaptors) {
      if (!best.ok) best = fail(`Needs ${needed} adaptor(s) to match gauge ${g}`);
      continue;
    }
    // Prefer the gauge needing the fewest adaptors.
    if (!best.ok || needed < best.adaptorsUsed) {
      best = { ok: true, slots, gauge: g, adaptorsUsed: needed };
      if (needed === 0) break;
    }
  }
  if (!best.ok && req.category && best.reason === 'Cards do not share a gauge') {
    return fail(`Set must be one gauge, all ${req.category}`);
  }
  return best;
}

function validateRun(
  tokens: MeldToken[],
  naturals: Natural[],
  adaptors: number,
  slots: number,
  req: MeldRequirement,
  lo: number,
  hi: number,
): MeldResult {
  if (tokens.some((t) => t.role === 'bulk')) return fail('Bulk cards only work in sets');

  const length = slots;
  if (hi - lo + 1 < length) return fail(`A run of ${length} does not fit gauges ${lo}-${hi}`);

  const categories = req.category
    ? [req.category]
    : naturals.length > 0
      ? [...new Set(naturals.map((n) => n.category))]
      : ['*'];

  let best: { category: string; start: number; cost: number } | null = null;
  for (const category of categories) {
    for (let start = lo; start + length - 1 <= hi; start++) {
      const cost = minAssignmentCost(naturals, category, start, length, adaptors);
      if (cost !== null && (best === null || cost < best.cost)) {
        best = { category, start, cost };
        if (cost === 0) break;
      }
    }
    if (best?.cost === 0) break;
  }

  if (!best) {
    return fail(
      req.category ? `Run must be consecutive gauges, all ${req.category}` : 'Run must be one category, consecutive gauges',
    );
  }
  return { ok: true, slots, category: best.category, start: best.start, adaptorsUsed: best.cost };
}

/**
 * Assign each natural to a distinct run position [start, start+length).
 * Cost per natural: 0 exact, 1 if it needs an adaptor, impossible otherwise.
 * Returns the minimum total cost if <= budget, else null. Wilds fill the gaps.
 */
function minAssignmentCost(
  naturals: Natural[],
  category: string,
  start: number,
  length: number,
  budget: number,
): number | null {
  const costOf = (n: Natural, pos: number): number => {
    const catOk = category === '*' || n.category === category;
    const diff = Math.abs(n.gauge - pos);
    if (catOk && diff === 0) return 0;
    if (catOk && diff === 1) return 1;
    if (!catOk && diff === 0) return 1;
    return Infinity;
  };

  let best = Infinity;
  const used = new Array<boolean>(length).fill(false);
  const search = (i: number, cost: number) => {
    if (cost >= best || cost > budget) return;
    if (i === naturals.length) {
      best = cost;
      return;
    }
    for (let p = 0; p < length; p++) {
      if (used[p]) continue;
      const c = costOf(naturals[i], start + p);
      if (c === Infinity) continue;
      used[p] = true;
      search(i + 1, cost + c);
      used[p] = false;
    }
  };
  search(0, 0);
  return best === Infinity ? null : best;
}

// ---------------------------------------------------------------------------
// Blueprints: several requirements, each satisfied by a disjoint group.
// ---------------------------------------------------------------------------

/** A unit of cards that must stay together (a single card or a locked meld). */
export interface MeldUnit {
  tokens: MeldToken[];
  /** Set for locked sub-assemblies: may only be used for this meld type. */
  lockedType?: MeldType;
}

export interface BuildCheck {
  ok: boolean;
  results: MeldResult[];
  reason?: string;
}

/** Validate an explicit assignment of token groups to requirements (same order). */
export function checkBuild(groups: MeldToken[][], requirements: MeldRequirement[], rules: MeldRules): BuildCheck {
  if (groups.length !== requirements.length) {
    return {
      ok: false,
      results: [],
      reason: `Blueprint needs ${requirements.length} melds, got ${groups.length}`,
    };
  }
  const seen = new Set<string>();
  for (const g of groups) {
    for (const t of g) {
      if (seen.has(t.id)) return { ok: false, results: [], reason: 'A card is used in two melds' };
      seen.add(t.id);
    }
  }
  const results = groups.map((g, i) => validateMeld(g, requirements[i], rules));
  const firstFail = results.find((r) => !r.ok);
  return {
    ok: !firstFail,
    results,
    reason: firstFail && !firstFail.ok ? firstFail.reason : undefined,
  };
}

/**
 * Search for a way to satisfy every requirement from the given units.
 * Returns token-id groups (one per requirement) or null. Prefers using
 * fewer cards, then fewer special cards.
 */
export function findBuild(
  units: MeldUnit[],
  requirements: MeldRequirement[],
  rules: MeldRules,
): string[][] | null {
  const failed = new Set<string>();
  const solve = (reqIndex: number, available: number[]): number[][] | null => {
    if (reqIndex === requirements.length) return [];
    const key = `${reqIndex}:${available.join(',')}`;
    if (failed.has(key)) return null;
    const req = requirements[reqIndex];
    const candidates = candidateGroups(units, available, req, rules);
    for (const cand of candidates) {
      const rest = available.filter((u) => !cand.includes(u));
      const tail = solve(reqIndex + 1, rest);
      if (tail) return [cand, ...tail];
    }
    failed.add(key);
    return null;
  };

  const all = units.map((_, i) => i);
  const solution = solve(0, all);
  if (!solution) return null;
  return solution.map((unitIdxs) => unitIdxs.flatMap((u) => units[u].tokens.map((t) => t.id)));
}

/**
 * Cheap necessary condition for a partial group to grow into a valid meld,
 * used to prune the search. Never rejects a group that could become valid.
 */
function plausible(tokens: MeldToken[], req: MeldRequirement, maxAdaptors: number): boolean {
  let min = Infinity;
  let max = -Infinity;
  const cats = new Set<string>();
  for (const t of tokens) {
    if (t.role !== 'natural') continue;
    min = Math.min(min, t.gauge);
    max = Math.max(max, t.gauge);
    cats.add(t.category);
  }
  if (min === Infinity) return true;
  if (req.type === 'set') return max - min <= 2;
  return max - min <= req.size + 1 && cats.size - 1 <= maxAdaptors;
}

/** All unit combinations (sorted by cost) that satisfy one requirement. */
function candidateGroups(units: MeldUnit[], available: number[], req: MeldRequirement, rules: MeldRules): number[][] {
  const usable = available.filter((u) => !units[u].lockedType || units[u].lockedType === req.type);
  const maxAdaptors = usable.reduce(
    (n, u) => n + units[u].tokens.filter((t) => t.role === 'adaptor').length,
    0,
  );
  // Any valid meld bigger than needed contains a valid meld of exactly the
  // needed size (drop an end of a run, or a spare card of a set), so once a
  // group has enough slots we only try adding zero-slot cards (adaptors).
  // A bulk card can overshoot by one, hence +1.
  const maxSlots = req.size + 1;
  const maxUnits = Math.min(usable.length, req.size + maxAdaptors);

  const found: { idxs: number[]; cost: number }[] = [];
  const current: number[] = [];

  const recurse = (from: number, slots: number) => {
    if (slots >= req.size) {
      const tokens = current.flatMap((u) => units[u].tokens);
      if (validateMeld(tokens, req, rules).ok) {
        const specials = tokens.filter((t) => t.role !== 'natural').length;
        found.push({ idxs: [...current], cost: tokens.length * 100 + specials });
        return; // supersets of a valid group are never better
      }
    }
    if (current.length >= maxUnits) return;
    for (let i = from; i < usable.length; i++) {
      const u = usable[i];
      const unitSlots = units[u].tokens.reduce((s, t) => s + tokenSlots(t), 0);
      if (slots + unitSlots > maxSlots) continue;
      if (slots >= req.size && unitSlots > 0) continue;
      current.push(u);
      if (!plausible(current.flatMap((c) => units[c].tokens), req, maxAdaptors)) {
        current.pop();
        continue;
      }
      recurse(i + 1, slots + unitSlots);
      current.pop();
    }
  };
  recurse(0, 0);

  found.sort((a, b) => a.cost - b.cost);
  return found.map((f) => f.idxs);
}

/**
 * For an invalid meld of plain parts, the cards that stop it from being
 * valid (so the UI can say "remove these"). Keeps the largest group that
 * does fit: the most common gauge for a set, the longest same-category
 * chain for a run. Returns [] when it can't say (wilds or adaptors present).
 */
export function meldMisfits(tokens: MeldToken[], req: MeldRequirement, rules: MeldRules): string[] {
  if (tokens.some((t) => t.role !== 'natural')) return [];
  const naturals = tokens as Natural[];
  const lo = Math.max(rules.gaugeMin, req.minGauge ?? rules.gaugeMin);
  const hi = Math.min(rules.gaugeMax, req.maxGauge ?? rules.gaugeMax);
  const fitsConstraints = (n: Natural) =>
    n.gauge >= lo && n.gauge <= hi && (!req.category || n.category === req.category) && !rules.bannedCategories.includes(n.category);

  let keep: Natural[] = [];
  if (req.type === 'set') {
    for (let g = lo; g <= hi; g++) {
      const group = naturals.filter((n) => n.gauge === g && fitsConstraints(n));
      if (group.length > keep.length) keep = group;
    }
  } else {
    const categories = [...new Set(naturals.filter(fitsConstraints).map((n) => n.category))];
    for (const c of categories) {
      const byGauge = new Map<number, Natural>();
      for (const n of naturals) if (n.category === c && fitsConstraints(n) && !byGauge.has(n.gauge)) byGauge.set(n.gauge, n);
      // Longest chain of consecutive gauges.
      for (const start of byGauge.keys()) {
        if (byGauge.has(start - 1)) continue;
        const chain: Natural[] = [];
        for (let g = start; byGauge.has(g); g++) chain.push(byGauge.get(g)!);
        if (chain.length > keep.length) keep = chain;
      }
    }
  }
  const kept = new Set(keep.map((n) => n.id));
  return naturals.filter((n) => !kept.has(n.id)).map((n) => n.id);
}

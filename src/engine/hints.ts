/**
 * Player-facing hints: how close a hand is to the target blueprint.
 *
 * Greedy and approximate (it fills the biggest meld first and ignores
 * Adaptors), which is fine for guidance; the real check is BUILD itself.
 */

import { getBlueprint } from './blueprints';
import type { Engine } from './game';
import type { MeldToken } from './melds';
import type { CardId, GameState, MeldRequirement, PlayerId, RoundRules } from './types';

type Natural = Extract<MeldToken, { role: 'natural' }>;

export interface MeldHint {
  requirement: MeldRequirement;
  /** Cards (naturals and specials) that count toward this meld. */
  cardIds: CardId[];
  /** Slots filled so far, out of requirement.size. */
  filled: number;
  /** For sets: the gauge being collected. */
  gauge?: number;
  /** For runs: the category and the gauges still missing. */
  category?: string;
  missingGauges?: number[];
  /** For sets: how many matching cards you hold in total (can exceed the size). */
  have?: number;
}

export interface BuildHints {
  /** True when a complete build is available right now. */
  ready: boolean;
  melds: MeldHint[];
}

/**
 * With `cardIds`, only those cards are considered (e.g. the cards the player
 * has selected); otherwise the whole hand and any locked sub-assemblies.
 */
export function buildHints(engine: Engine, state: GameState, playerId: PlayerId, cardIds?: CardId[]): BuildHints | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.target) return null;
  const bp = getBlueprint(engine.content, player.target);
  const pool = cardIds ?? [...player.hand, ...player.lockedMelds.flatMap((m) => m.cardIds)];
  const melds = meldHints(engine, state, bp.requirements, player.rules, pool);
  return { ready: engine.suggestBuild(state, playerId, cardIds) !== null, melds };
}

/** Progress of a pool of cards toward a list of meld requirements. */
export function meldHints(
  engine: Engine,
  state: GameState,
  requirements: MeldRequirement[],
  rules: RoundRules,
  pool: CardId[],
): MeldHint[] {
  const tokens = pool.map((id) => engine.token(state, id)).filter((t): t is MeldToken => !!t);
  const naturals = tokens.filter((t): t is Natural => t.role === 'natural' && !rules.bannedCategories.includes(t.category));
  const enabled = (role: MeldToken['role']) => !rules.disabledMeldRoles.includes(role);
  const wilds = enabled('wild') ? tokens.filter((t) => t.role === 'wild') : [];
  const bulks = enabled('bulk') ? tokens.filter((t): t is Extract<MeldToken, { role: 'bulk' }> => t.role === 'bulk') : [];

  // Every way each meld could be aimed: a set at a gauge, a run at a category
  // and starting gauge. We try all combinations (and every order of claiming
  // cards) and keep the one that places the most cards, so one meld never
  // greedily takes a card another meld needed more.
  const options = requirements.map((req) => meldOptions(req, rules, naturals));
  const orders = permutations(requirements.map((_, i) => i));

  let best: { score: number; hints: MeldHint[] } | null = null;
  const choice: (Aim | null)[] = new Array(requirements.length).fill(null);
  const recurse = (i: number) => {
    if (i === requirements.length) {
      for (const order of orders) {
        const hints = evaluate(requirements, choice, order, naturals, wilds, bulks);
        const score = scoreOf(hints);
        if (!best || score > best.score) best = { score, hints };
      }
      return;
    }
    for (const opt of options[i]) {
      choice[i] = opt;
      recurse(i + 1);
    }
  };
  recurse(0);
  return best!.hints;
}

type Aim = { type: 'set'; gauge: number } | { type: 'run'; category: string; start: number };

function meldOptions(req: MeldRequirement, rules: RoundRules, naturals: Natural[]): (Aim | null)[] {
  const lo = Math.max(rules.gaugeMin, req.minGauge ?? rules.gaugeMin);
  const hi = Math.min(rules.gaugeMax, req.maxGauge ?? rules.gaugeMax);
  const fits = (n: Natural) => !req.category || n.category === req.category;
  const out: (Aim | null)[] = [null];
  if (req.type === 'set') {
    for (let g = lo; g <= hi; g++) if (naturals.some((n) => n.gauge === g && fits(n))) out.push({ type: 'set', gauge: g });
  } else {
    const cats = req.category ? [req.category] : [...new Set(naturals.map((n) => n.category))];
    for (const c of cats) {
      for (let start = lo; start + req.size - 1 <= hi; start++) {
        if (naturals.some((n) => n.category === c && n.gauge >= start && n.gauge < start + req.size)) {
          out.push({ type: 'run', category: c, start });
        }
      }
    }
  }
  return out;
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** Claim cards for each meld in the given order, then spread wilds over the gaps. */
function evaluate(
  requirements: MeldRequirement[],
  choice: (Aim | null)[],
  order: number[],
  naturals: Natural[],
  wilds: MeldToken[],
  bulks: Extract<MeldToken, { role: 'bulk' }>[],
): MeldHint[] {
  let free = naturals;
  const hints: MeldHint[] = requirements.map((req) => ({ requirement: req, cardIds: [], filled: 0 }));
  const runGaps: number[][] = requirements.map(() => []);

  for (const i of order) {
    const req = requirements[i];
    const aim = choice[i];
    const hint = hints[i];
    if (!aim) continue;
    if (aim.type === 'set') {
      const cards = free.filter((n) => n.gauge === aim.gauge && (!req.category || n.category === req.category));
      hint.cardIds = cards.map((n) => n.id);
      hint.filled = cards.length;
      hint.gauge = aim.gauge;
      hint.have = cards.length;
      free = free.filter((n) => !cards.includes(n));
    } else {
      const byGauge = new Map<number, Natural>();
      for (const n of free) if (n.category === aim.category && !byGauge.has(n.gauge)) byGauge.set(n.gauge, n);
      const cards: Natural[] = [];
      const gaps: number[] = [];
      for (let g = aim.start; g < aim.start + req.size; g++) {
        const n = byGauge.get(g);
        if (n) cards.push(n);
        else gaps.push(g);
      }
      // A complete run can be extended at either end.
      if (gaps.length === 0) {
        for (let g = aim.start - 1; byGauge.has(g); g--) cards.push(byGauge.get(g)!);
        for (let g = aim.start + req.size; byGauge.has(g); g++) cards.push(byGauge.get(g)!);
      }
      hint.cardIds = cards.map((n) => n.id);
      hint.filled = cards.length;
      hint.category = aim.category;
      runGaps[i] = gaps;
      free = free.filter((n) => !cards.includes(n));
    }
  }

  // Wild and bulk cards fill what is still missing.
  let w = [...wilds];
  let b = [...bulks];
  for (let i = 0; i < requirements.length; i++) {
    const req = requirements[i];
    const hint = hints[i];
    if (hint.filled === 0) continue;
    if (req.type === 'set') {
      while (hint.filled < req.size && b.length > 0) {
        hint.cardIds.push(b[0].id);
        hint.filled += b[0].slots;
        b = b.slice(1);
      }
    }
    while (hint.filled < req.size && w.length > 0) {
      hint.cardIds.push(w[0].id);
      hint.filled += 1;
      w = w.slice(1);
      if (req.type === 'run') runGaps[i] = runGaps[i].slice(1);
    }
    if (req.type === 'run') hint.missingGauges = runGaps[i];
    if (req.type === 'set') hint.have = hint.filled;
  }
  for (const hint of hints) hint.filled = Math.min(hint.filled, hint.requirement.size);
  return hints;
}

/** Most melds complete, then most required slots filled, then most cards used. */
function scoreOf(hints: MeldHint[]): number {
  let complete = 0;
  let filled = 0;
  let cards = 0;
  for (const h of hints) {
    if (h.filled >= h.requirement.size) complete += 1;
    filled += h.filled;
    cards += h.cardIds.length;
  }
  return complete * 1_000_000 + filled * 1_000 + cards;
}

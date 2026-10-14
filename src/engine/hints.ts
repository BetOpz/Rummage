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
  const bp = { requirements };
  const tokens = pool.map((id) => engine.token(state, id)).filter((t): t is MeldToken => !!t);
  let naturals = tokens.filter(
    (t): t is Natural => t.role === 'natural' && !rules.bannedCategories.includes(t.category),
  );
  const enabled = (role: MeldToken['role']) => !rules.disabledMeldRoles.includes(role);
  let wilds = enabled('wild') ? tokens.filter((t) => t.role === 'wild') : [];
  let bulks = enabled('bulk') ? tokens.filter((t): t is Extract<MeldToken, { role: 'bulk' }> => t.role === 'bulk') : [];

  // Fill the largest melds first, as they are the hardest to complete.
  const order = bp.requirements.map((r, i) => ({ r, i })).sort((a, b) => b.r.size - a.r.size);
  const melds: MeldHint[] = new Array(bp.requirements.length);

  for (const { r: req, i } of order) {
    const lo = Math.max(rules.gaugeMin, req.minGauge ?? rules.gaugeMin);
    const hi = Math.min(rules.gaugeMax, req.maxGauge ?? rules.gaugeMax);
    let hint: MeldHint;

    if (req.type === 'set') {
      let best: Natural[] = [];
      let bestGauge = lo;
      let bestHave = 0;
      // Ties go to the higher gauge: building with it sheds more deadwood.
      for (let g = lo; g <= hi; g++) {
        const matching = naturals.filter((n) => n.gauge === g && (!req.category || n.category === req.category));
        if (matching.length >= best.length && matching.length > 0) {
          best = matching.slice(0, req.size);
          bestGauge = g;
          bestHave = matching.length;
        }
      }
      const ids = best.map((n) => n.id);
      let filled = best.length;
      if (filled > 0) {
        for (const b of [...bulks]) {
          if (filled >= req.size) break;
          ids.push(b.id);
          filled += b.slots;
          bulks = bulks.filter((x) => x !== b);
        }
        for (const w of [...wilds]) {
          if (filled >= req.size) break;
          ids.push(w.id);
          filled += 1;
          wilds = wilds.filter((x) => x !== w);
        }
      }
      naturals = naturals.filter((n) => !ids.includes(n.id));
      hint = { requirement: req, cardIds: ids, filled: Math.min(filled, req.size), gauge: best.length ? bestGauge : undefined, have: bestHave };
    } else {
      const categories = req.category ? [req.category] : [...new Set(naturals.map((n) => n.category))];
      let best: { cards: Natural[]; category: string; start: number } | null = null;
      for (const category of categories) {
        for (let start = lo; start + req.size - 1 <= hi; start++) {
          const cards: Natural[] = [];
          for (let g = start; g < start + req.size; g++) {
            const n = naturals.find((x) => x.category === category && x.gauge === g);
            if (n) cards.push(n);
          }
          if (!best || cards.length > best.cards.length) best = { cards, category, start };
        }
      }
      const ids = best ? best.cards.map((n) => n.id) : [];
      let missing: number[] = [];
      if (best && best.cards.length > 0) {
        for (let g = best.start; g < best.start + req.size; g++) {
          if (!best.cards.some((n) => n.gauge === g)) missing.push(g);
        }
        while (missing.length > 0 && wilds.length > 0) {
          ids.push(wilds[0].id);
          wilds = wilds.slice(1);
          missing = missing.slice(1);
        }
      }
      naturals = naturals.filter((n) => !ids.includes(n.id));
      hint = {
        requirement: req,
        cardIds: ids,
        filled: Math.min(ids.length, req.size),
        category: best && best.cards.length > 0 ? best.category : req.category,
        missingGauges: best && best.cards.length > 0 ? missing : undefined,
      };
    }
    melds[i] = hint;
  }

  return melds;
}

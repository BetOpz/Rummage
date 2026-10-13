/**
 * A simple heuristic bot. Used for automated tests, balance simulation
 * (scripts/simulate.ts) and as a placeholder opponent for multiplayer.
 * It only ever chooses actions; the engine decides whether they are legal.
 */

import { blueprintSize, getBlueprint } from './blueprints';
import type { Engine } from './game';
import type { MeldToken } from './melds';
import type { CardId, GameAction, GameState, MeldRequirement, PlayerId } from './types';

const SHOP_PREFERENCE = ['duct_tape', 'bulk_pack', 'adaptor', 'toolbox', 'parts_catalogue'];

export function botAction(engine: Engine, state: GameState, playerId: PlayerId): GameAction | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  switch (state.phase) {
    case 'blueprintSelect': {
      if (player.target || !state.roundState) return null;
      const offers = [...state.roundState.offers].sort(
        (a, b) => blueprintSize(getBlueprint(engine.content, a)) - blueprintSize(getBlueprint(engine.content, b)),
      );
      return { type: 'SELECT_BLUEPRINT', playerId, blueprintId: offers[0] };
    }

    case 'playing': {
      const round = state.roundState!;
      if (round.pendingChoice) {
        const choice = round.pendingChoice;
        if (choice.playerId !== playerId) return null;
        if (choice.kind === 'reorderTop') return { type: 'RESOLVE_CHOICE', playerId, cardIds: choice.cardIds };
        const ranked = [...choice.cardIds].sort(
          (a, b) => utility(engine, state, player.hand, b) - utility(engine, state, player.hand, a),
        );
        return { type: 'RESOLVE_CHOICE', playerId, cardIds: ranked.slice(0, choice.keep) };
      }
      if (state.players[state.activePlayer].id !== playerId) return null;

      const buildGroups = engine.suggestBuild(state, playerId);
      if (buildGroups) return { type: 'BUILD', playerId, groups: buildGroups };

      const bp = player.target ? getBlueprint(engine.content, player.target) : null;
      const prog = (hand: CardId[]) => (bp ? progress(engine, state, hand, bp.requirements) : 0);

      if (round.turnPhase === 'draw') {
        const top = round.discard[round.discard.length - 1];
        if (top && player.rules.allowDiscardDraw) {
          const withTop = bestAfterDiscard(player.hand.concat(top), prog, top);
          if (withTop > prog(player.hand)) return { type: 'DRAW', playerId, source: 'discard' };
        }
        return { type: 'DRAW', playerId, source: 'deck' };
      }

      // Main phase: play simple helper specials, then discard the least useful card.
      for (const id of player.hand) {
        const c = state.cards[id];
        if (c.kind === 'special' && (c.specialId === 'toolbox' || c.specialId === 'parts_catalogue')) {
          if (player.drawPile.length > 0) return { type: 'PLAY_SPECIAL', playerId, cardId: id };
        }
      }
      const naturals = player.hand.filter((id) => engine.token(state, id)?.role === 'natural');
      const unusable = player.hand.filter((id) => !engine.token(state, id));
      if (unusable.length > 0) return { type: 'DISCARD', playerId, cardId: unusable[0] };
      const pool = naturals.length > 0 ? naturals : player.hand;
      let best = pool[0];
      let bestScore = -Infinity;
      for (const id of pool) {
        const rest = player.hand.filter((h) => h !== id);
        // Higher progress first; break ties by shedding high-gauge deadwood, then by utility.
        const card = state.cards[id];
        const score =
          prog(rest) * 1000 - utility(engine, state, player.hand, id) * 10 + (card.kind === 'part' ? card.gauge : 0);
        if (score > bestScore) {
          bestScore = score;
          best = id;
        }
      }
      return { type: 'DISCARD', playerId, cardId: best };
    }

    case 'roundOver':
      return { type: 'CONTINUE', playerId };

    case 'shop': {
      const slots = state.shop?.slots ?? [];
      for (const pref of SHOP_PREFERENCE) {
        const i = slots.findIndex((s) => !s.sold && s.kind === 'special' && s.specialId === pref);
        if (i >= 0 && slots[i].price <= player.currency) return { type: 'SHOP_BUY', playerId, slot: i };
      }
      const crate = slots.findIndex((s) => !s.sold && s.serviceId === 'crate');
      if (crate >= 0 && slots[crate].price <= player.currency) return { type: 'SHOP_BUY', playerId, slot: crate };
      return { type: 'LEAVE_SHOP', playerId };
    }

    default:
      return null;
  }
}

/** How well a card fits with the rest of a hand (higher = keep). */
export function utility(engine: Engine, state: GameState, hand: CardId[], id: CardId): number {
  const t = engine.token(state, id);
  if (!t) return 0;
  if (t.role !== 'natural') return 10;
  let score = 0;
  for (const other of hand) {
    if (other === id) continue;
    const o: MeldToken | null = engine.token(state, other);
    if (!o || o.role !== 'natural') continue;
    if (o.gauge === t.gauge) score += 2;
    if (o.category === t.category) {
      const d = Math.abs(o.gauge - t.gauge);
      if (d === 1) score += 2;
      else if (d === 2) score += 1;
    }
  }
  return score;
}

/** Play a whole solo run with the bot. Returns the final state and number of actions. */
export function autoplay(engine: Engine, state: GameState, maxActions = 20000): { state: GameState; actions: GameAction[] } {
  const actions: GameAction[] = [];
  let s = state;
  while (actions.length < maxActions && s.phase !== 'runWon' && s.phase !== 'runLost') {
    let acted = false;
    for (const p of s.players) {
      const a = botAction(engine, s, p.id);
      if (!a) continue;
      s = engine.reduce(s, a);
      actions.push(a);
      acted = true;
      break;
    }
    if (!acted) throw new Error(`Bot is stuck in phase ${s.phase}`);
  }
  return { state: s, actions };
}

/** Best progress after discarding one card from `hand` (never the card just taken). */
function bestAfterDiscard(hand: CardId[], prog: (h: CardId[]) => number, keep: CardId): number {
  let best = -Infinity;
  for (const id of hand) {
    if (id === keep) continue;
    best = Math.max(best, prog(hand.filter((h) => h !== id)));
  }
  return best;
}

/**
 * Rough measure of how close a hand is to a blueprint: greedily fill each
 * requirement (largest first) with the best partial meld, counting cards placed.
 */
export function progress(engine: Engine, state: GameState, hand: CardId[], reqs: MeldRequirement[]): number {
  const tokens = hand.map((id) => engine.token(state, id)).filter((t): t is MeldToken => !!t);
  let naturals = tokens.filter((t): t is Extract<MeldToken, { role: 'natural' }> => t.role === 'natural');
  let wilds = tokens.filter((t) => t.role === 'wild').length;
  let total = 0;
  const { gaugeMin, gaugeMax } = state.config;
  for (const req of [...reqs].sort((a, b) => b.size - a.size)) {
    const lo = Math.max(gaugeMin, req.minGauge ?? gaugeMin);
    const hi = Math.min(gaugeMax, req.maxGauge ?? gaugeMax);
    let bestIds: string[] = [];
    if (req.type === 'set') {
      for (let g = lo; g <= hi; g++) {
        const ids = naturals.filter((n) => n.gauge === g && (!req.category || n.category === req.category)).map((n) => n.id);
        if (ids.length > bestIds.length) bestIds = ids.slice(0, req.size);
      }
    } else {
      const cats = req.category ? [req.category] : [...new Set(naturals.map((n) => n.category))];
      for (const c of cats) {
        for (let start = lo; start + req.size - 1 <= hi; start++) {
          const ids: string[] = [];
          for (let g = start; g < start + req.size; g++) {
            const n = naturals.find((x) => x.category === c && x.gauge === g);
            if (n) ids.push(n.id);
          }
          if (ids.length > bestIds.length) bestIds = ids;
        }
      }
    }
    const useWilds = Math.min(wilds, req.size - bestIds.length);
    wilds -= useWilds;
    total += bestIds.length + useWilds;
    naturals = naturals.filter((n) => !bestIds.includes(n.id));
  }
  return total;
}

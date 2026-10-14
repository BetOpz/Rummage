/**
 * A simple heuristic bot. Used for automated tests, balance simulation
 * (scripts/simulate.ts) and as a placeholder opponent for multiplayer.
 * It only ever chooses actions; the engine decides whether they are legal.
 */

import { battleCardDef, incomingDamage } from './battle';
import { blueprintSize, getBlueprint } from './blueprints';
import { reachableNodes } from './map';
import { itemMaxCharges } from './quality';
import { appraisalCost, eligibleStakeCards, lotsAhead, suggestDestinations } from './scrapbook';
import type { Engine } from './game';
import { type MeldToken, handProgress } from './melds';
import type { CardId, GameAction, GameState, MeldRequirement, NodeType, PlayerId, PlayerState } from './types';

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

    case 'map': {
      // Pay to recharge gadgets when there is money to spare.
      for (const item of player.items) {
        const g = engine.content.items.find((d) => d.id === item.itemId)?.gadget;
        if (g && (item.charges ?? 0) < (itemMaxCharges(engine.content, state.config, item) ?? 0) && player.currency >= g.rechargeCost + 4) {
          return { type: 'RECHARGE', playerId, itemUid: item.uid };
        }
      }
      const options = reachableNodes(state.map!);
      const best = [...options].sort((a, b) => nodeScore(player, b.type) - nodeScore(player, a.type))[0];
      return best ? { type: 'CHOOSE_NODE', playerId, nodeId: best.id } : null;
    }

    case 'battle':
      return battleAction(engine, state, player);

    case 'battleReward':
      return { type: 'TAKE_REWARD', playerId, index: state.reward && state.reward.options.length > 0 ? 0 : null };

    case 'duelAnte': {
      const duel = state.duel!;
      const parts = player.deck.filter((id) => state.cards[id]?.kind === 'part');
      const rule = duel.stakeRule;
      if (!rule) {
        // Stake the lowest part we own.
        const pick = [...(parts.length ? parts : player.deck)].sort((a, b) => gaugeOf(state, a) - gaugeOf(state, b))[0];
        return { type: 'DUEL_STAKE', playerId, cardIds: [pick] };
      }
      // Matched stakes: the cheapest parts that qualify (lowest material, then lowest number).
      const eligible = eligibleStakeCards(state, engine.content, player, rule);
      const pool = eligible.length >= rule.count ? eligible : duel.kind === 'boss' ? parts : null;
      if (!pool || pool.length < rule.count) return { type: 'DUEL_WALK_AWAY', playerId };
      const cheap = [...pool].sort((a, b) => gradeOfCard(engine, state, a) - gradeOfCard(engine, state, b) || gaugeOf(state, a) - gaugeOf(state, b));
      return { type: 'DUEL_STAKE', playerId, cardIds: cheap.slice(0, rule.count) };
    }

    case 'appraiser': {
      // Itemise the best-hidden lot we can afford, keeping a few credits spare.
      const ahead = lotsAhead(state)
        .map((n) => ({ n, cost: appraisalCost(state, engine.content, player, n.encounter!.lot!) }))
        .filter((x) => x.cost > 0 && x.cost <= player.currency - 3)
        .sort((a, b) => b.cost - a.cost);
      return ahead[0] ? { type: 'APPRAISE', playerId, nodeId: ahead[0].n.id } : { type: 'LEAVE_APPRAISER', playerId };
    }

    case 'rummage':
      return { type: 'RUMMAGE_DONE', playerId, destinations: suggestDestinations(state, engine.content, player, state.rummage!.pieces) };

    case 'duel':
      return duelAction(engine, state, playerId);

    case 'duelResult':
      return { type: 'CONTINUE', playerId };

    case 'rest': {
      if (state.config.battleStyle === 'rummy') {
        const flat = player.items.find((i) => {
          const g = engine.content.items.find((d) => d.id === i.itemId)?.gadget;
          return g && (i.charges ?? 0) < (itemMaxCharges(engine.content, state.config, i) ?? 0);
        });
        return flat ? { type: 'REST', playerId, choice: 'recharge', itemUid: flat.uid } : { type: 'REST', playerId, choice: 'leave' };
      }
      const worn = player.items
        .filter((i) => i.usesLeft !== null)
        .sort((a, b) => (a.usesLeft ?? 0) - (b.usesLeft ?? 0))[0];
      if (worn && player.hp > player.maxHp * 0.7) return { type: 'REST', playerId, choice: 'repair', itemUid: worn.uid };
      return { type: 'REST', playerId, choice: 'heal' };
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
  return handProgress(tokens, reqs, state.config.gaugeMin, state.config.gaugeMax);
}

/** How much the bot wants to visit a map stop. */
function nodeScore(player: PlayerState, type: NodeType): number {
  const hurt = player.hp < player.maxHp * 0.5;
  switch (type) {
    case 'workshop':
      return player.items.length < 3 ? 6 : 3;
    case 'masterWorkshop':
      return 5;
    case 'rest':
      return hurt ? 8 : 1;
    case 'shop':
      return player.currency >= 8 ? 4 : 1;
    case 'battle':
      return hurt ? 2 : 4;
    case 'elite':
      return hurt || player.items.length < 3 ? 0 : 3;
    case 'boss':
      return 10;
    case 'appraiser':
      return player.currency >= 8 ? 3 : 0;
  }
}

/** Battle: block if the incoming hit would hurt, otherwise attack; end the turn when out of plays. */
function battleAction(engine: Engine, state: GameState, player: PlayerState): GameAction {
  const battle = state.battle!;
  const end: GameAction = { type: 'END_TURN', playerId: player.id };
  const playable = battle.hand
    .map((card) => ({ card, info: battleCardDef(engine.content, player, card) }))
    .filter((x) => x.info && x.info.def.cost <= battle.energy);
  if (playable.length === 0) return end;

  const has = (x: (typeof playable)[number], type: string) => x.info!.def.effects.some((e) => e.type === type);
  const target = battle.enemies
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.hp > 0)
    .sort((a, b) => a.e.hp - b.e.hp)[0]?.i;
  const play = (x: (typeof playable)[number]): GameAction => ({
    type: 'PLAY_CARD',
    playerId: player.id,
    cardUid: x.card.uid,
    target: x.info!.def.targeted ? target : undefined,
  });

  const free = playable.find((x) => has(x, 'draw') || has(x, 'energy'));
  if (free) return play(free);
  const needBlock = incomingDamage(engine.content, battle) > battle.block;
  const blocker = playable.find((x) => has(x, 'block'));
  if (needBlock && blocker) return play(blocker);
  const attacker = playable.find((x) => has(x, 'damage') || has(x, 'damageAll'));
  if (attacker) return play(attacker);
  return play(playable[0]);
}

function gradeOfCard(engine: Engine, state: GameState, id: CardId): number {
  const c = state.cards[id];
  return c?.kind === 'part' ? (engine.content.categories.find((x) => x.id === c.category)?.grade ?? 1) : 99;
}

function gaugeOf(state: GameState, id: CardId): number {
  const c = state.cards[id];
  return c?.kind === 'part' ? c.gauge : 99;
}

/** Duel: go out if possible, use a gadget on bosses, otherwise draw and discard like the workshop bot. */
function duelAction(engine: Engine, state: GameState, playerId: PlayerId): GameAction {
  const duel = state.duel!;
  const out = engine.suggestDuelOut(state);
  if (out) return { type: 'DUEL_GO_OUT', playerId, groups: out };

  const player = state.players.find((p) => p.id === playerId)!;
  if (duel.kind !== 'battle' && duel.turnPhase === 'draw') {
    for (const item of player.items) {
      const g = engine.content.items.find((d) => d.id === item.itemId)?.gadget;
      if (!g || (item.charges ?? 0) <= 0) continue;
      if (item.itemId === 'pocket_watch' && duel.opponents[0].skip === 0) {
        return { type: 'USE_GADGET', playerId, itemUid: item.uid, target: 0 };
      }
      if (item.itemId === 'glue_pot' || item.itemId === 'sorting_tray') {
        return { type: 'USE_GADGET', playerId, itemUid: item.uid };
      }
    }
  }

  const prog = (hand: CardId[]) => progress(engine, state, hand, duel.requirements);
  if (duel.turnPhase === 'draw') {
    const top = duel.discard.at(-1);
    if (top && duel.rules.allowDiscardDraw) {
      const withTop = bestAfterDiscard(duel.hand.concat(top), prog, top);
      if (withTop > prog(duel.hand)) return { type: 'DUEL_DRAW', playerId, source: 'discard' };
    }
    return { type: 'DUEL_DRAW', playerId, source: 'deck' };
  }
  let worst = duel.hand[0];
  let bestScore = -Infinity;
  for (const id of duel.hand) {
    const t = engine.token(state, id);
    if (t && t.role !== 'natural') continue;
    const score = prog(duel.hand.filter((h) => h !== id)) * 100 + gaugeOf(state, id);
    if (score > bestScore) {
      bestScore = score;
      worst = id;
    }
  }
  return { type: 'DUEL_DISCARD', playerId, cardId: worst };
}

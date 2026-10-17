/**
 * The bot's use of items: when to spend gadget charges (in duels, after
 * them, on lots, the map, shops and the scrapbook), how to answer duel
 * choices, and which pages are worth having.
 *
 * In a duel the bot reads the race (how many cards it and each opponent
 * still need, and how many draws are left) and spends charges where they
 * change it: gadgets that improve its hand are tried on a copy of the state
 * and kept only if they bring it closer to going out; disruption waits for
 * an opponent that's close; extra draws wait until draws run short;
 * insurance and calling a duel off wait until it's about to lose.
 */

import { cardsStillNeeded } from './duel';
import type { Engine } from './game';
import { type ActiveEffect, gadgetAt, itemDef, maxCharges } from './items';
import { reachableNodes } from './map';
import { finishedGrade, gradeOfCategory, pageOf, piecesNeeded, scrapbookPages, STAGES, viewParcel } from './scrapbook';
import type { CardId, DuelChoice, GadgetArgs, GameAction, GameState, ItemInstance, NodeType, PlayerId, PlayerState } from './types';

type Kind = 'progress' | 'disrupt' | 'draws' | 'insure' | 'callOff' | 'stakes' | 'twist' | 'choose' | 'other';

/** What a gadget is for, from its effects (the first that decides wins). */
function kindOf(effects: ActiveEffect[]): Kind {
  const types = new Set(effects.map((e) => e.type));
  if (types.has('endDuelDraw')) return 'callOff';
  if (types.has('insureStake') || types.has('insureDuel') || types.has('spareLife')) return 'insure';
  if (types.has('disableTwist')) return 'twist';
  if (types.has('chooseOne')) return 'choose';
  if (types.has('raiseStakes')) return 'stakes';
  const progress = ['drawExtra', 'grantTempCard', 'takeFromDiscard', 'swapWithDiscard', 'shiftGauge', 'recastPart', 'cycleCards', 'mulligan', 'reorderTop', 'handSizeNow', 'destroyCard', 'stealCard', 'discardToDrawPile'];
  if (progress.some((t) => types.has(t))) return 'progress';
  const disrupt = ['skipTurn', 'blockGoOut', 'forceDiscard', 'lockDiscard', 'swapHands', 'discardTrap', 'clearDiscard'];
  if (disrupt.some((t) => types.has(t))) return 'disrupt';
  if (types.has('extraDraws') || types.has('doubleDraw')) return 'draws';
  return 'other';
}

/** The race: what the bot and its opponents still need, and the draws left. */
interface Race {
  myNeed: number;
  /** Turns before the closest opponent could go out (cards it needs, plus turns it will miss or can't go out). */
  threat: number;
  threatIdx: number;
  drawsLeft: number;
}

function race(engine: Engine, s: GameState): Race {
  const duel = s.duel!;
  const need = (ids: CardId[]) => cardsStillNeeded(s, engine.content, engine.effects, ids);
  // Before drawing, count the card about to be drawn too: that's how stacking the draw pile (Periscope) helps.
  const next = duel.turnPhase === 'draw' && duel.fx.drawsThisTurn === 0 ? duel.drawPile.slice(-1) : [];
  const myNeed = Math.min(need([...duel.hand, ...duel.fx.setAside]), need([...duel.hand, ...duel.fx.setAside, ...next]));
  let threat = Infinity;
  let threatIdx = 0;
  duel.opponents.forEach((o, i) => {
    const t = need(o.hand) + o.skip + o.noOut;
    if (t < threat) {
      threat = t;
      threatIdx = i;
    }
  });
  return { myNeed, threat, threatIdx, drawsLeft: duel.rules.drawLimit - duel.drawsTaken };
}

/** Apply an action on a copy; answer any choices it opens the bot's way. Null if illegal. */
function tryAction(engine: Engine, s: GameState, a: GameAction, playerId: PlayerId): GameState | null {
  const r = engine.applyAction(s, a);
  if (!r.ok) return null;
  let t = r.state;
  for (let i = 0; i < 4 && t.duel?.choice; i++) {
    const answer = engine.applyAction(t, smartChoice(engine, t, playerId, t.duel.choice));
    if (!answer.ok) return null;
    t = answer.state;
  }
  return t;
}

/** Cards the bot would least like to keep, worst first. */
function worstCards(engine: Engine, s: GameState, hand: CardId[]): CardId[] {
  const need = (ids: CardId[]) => cardsStillNeeded(s, engine.content, engine.effects, ids);
  const gauge = (id: CardId) => (s.cards[id]?.kind === 'part' ? (s.cards[id] as { gauge: number }).gauge : 0);
  return [...hand].sort((a, b) => need(hand.filter((h) => h !== a)) - need(hand.filter((h) => h !== b)) || gauge(b) - gauge(a));
}

/** Candidate picks for a gadget that improves the hand. */
function progressArgs(engine: Engine, s: GameState, effects: ActiveEffect[], target: number): GadgetArgs[] {
  const duel = s.duel!;
  const base: GadgetArgs = { target };
  const out: GadgetArgs[] = [base];
  const parts = duel.hand.filter((id) => s.cards[id]?.kind === 'part');
  const worst = worstCards(engine, s, duel.hand);
  for (const e of effects) {
    const p = e.params;
    const n = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);
    switch (e.type) {
      case 'shiftGauge':
        for (const id of parts) for (const v of [-2, -1, 1, 2].filter((x) => Math.abs(x) <= n(p.maxShift, 1))) out.push({ ...base, cards: [id], values: [v] });
        break;
      case 'recastPart': {
        const cats = [...new Set(parts.map((id) => (s.cards[id] as { category: string }).category))];
        for (const id of parts) for (const c of cats) for (const v of [0, ...(n(p.gaugeShift) > 0 ? [-1, 1] : [])]) out.push({ ...base, cards: [id], materials: [c], values: [v] });
        break;
      }
      case 'takeFromDiscard':
        if (p.top === undefined) for (const id of duel.discard.slice(-Math.min(n(p.depth, 99), 6))) out.push({ ...base, cards: [id] });
        break;
      case 'swapWithDiscard':
        if (worst[0]) out.push({ ...base, cards: [worst[0]] });
        break;
      case 'cycleCards':
      case 'destroyCard':
        for (let k = 1; k <= Math.min(n(p.max, n(p.count, 1)), worst.length - 1); k++) out.push({ ...base, cards: worst.slice(0, k) });
        break;
      case 'mulligan':
        out.push({ ...base, cards: worst.slice(-Math.min(n(p.keep), worst.length)).filter(Boolean) });
        break;
    }
  }
  return out.slice(0, 40);
}

/**
 * A gadget worth using right now, or null. Only items with charges (or a
 * free use) are considered, and each is checked on a copy of the state.
 */
export function gadgetAction(engine: Engine, s: GameState, player: PlayerState): GameAction | null {
  switch (s.phase) {
    case 'duel':
      return duelGadget(engine, s, player);
    case 'duelResult':
      return resultGadget(engine, s, player);
    case 'rummage':
      return s.rummage?.stage === 'pick' ? lotGadget(engine, s, player) : scrapbookGadget(engine, s, player);
    case 'map':
      return mapGadget(engine, s, player) ?? scrapbookGadget(engine, s, player);
    case 'rest':
      return scrapbookGadget(engine, s, player);
    default:
      return null;
  }
}

const charged = (engine: Engine, s: GameState, player: PlayerState) =>
  player.items.filter((it) => {
    if (!engine.content.items.find((d) => d.id === it.itemId)?.gadget) return false;
    const free = s.duel?.fx.freeUses;
    return (it.charges ?? 0) > 0 || (!!free && free.count > 0 && free.sourceUid !== it.uid);
  });

const use = (playerId: PlayerId, it: ItemInstance, args: GadgetArgs = {}): GameAction => ({ type: 'USE_GADGET', playerId, itemUid: it.uid, ...args });

function duelGadget(engine: Engine, s: GameState, player: PlayerState): GameAction | null {
  const duel = s.duel!;
  if (duel.choice) return null;
  const r = race(engine, s);
  const important = duel.kind !== 'battle';
  const danger = r.threat <= 1;
  const losing = r.threat <= r.myNeed;
  const short = r.drawsLeft <= r.myNeed + 1;
  const firstDraw = duel.turnPhase === 'draw' && duel.fx.drawsThisTurn === 0;

  for (const it of charged(engine, s, player)) {
    const g = gadgetAt(engine.content, player, it);
    if (!g.places.includes('duel')) continue;
    const kind = kindOf(g.effects.filter((e) => (engine.effects[e.type]?.places ?? ['duel']).includes('duel')));
    const a = (args: GadgetArgs = {}) => use(player.id, it, { target: r.threatIdx, ...args });
    const ok = (action: GameAction) => tryAction(engine, s, action, player.id) !== null;
    switch (kind) {
      case 'progress': {
        // Keep it only if the hand gets closer to going out (or can go out).
        let best: { action: GameAction; need: number } | null = null;
        for (const args of progressArgs(engine, s, g.effects, r.threatIdx)) {
          const action = a(args);
          const t = tryAction(engine, s, action, player.id);
          if (!t?.duel || t.phase !== 'duel') continue;
          const after = race(engine, t);
          const canOut = !!engine.suggestDuelOut(t);
          const need = canOut ? -1 : after.myNeed;
          if (need < r.myNeed && (!best || need < best.need)) best = { action, need };
        }
        if (best) return best.action;
        break;
      }
      case 'disrupt':
        if ((danger || (losing && important && r.threat <= 2)) && ok(a())) return a();
        break;
      case 'draws':
        if (g.effects.some((e) => e.type === 'doubleDraw')) {
          if (firstDraw && duel.turn <= 3 && r.myNeed >= 3 && ok(a())) return a();
        } else if (short && ok(a())) return a();
        break;
      case 'choose':
        if (danger && ok(a({ option: 1 }))) return a({ option: 1 });
        if (short && ok(a({ option: 0 }))) return a({ option: 0 });
        break;
      case 'insure':
        if (losing && (danger || r.drawsLeft <= 2) && (important || duel.playerStake.length > 1) && ok(a())) return a();
        break;
      case 'callOff':
        if (danger && r.myNeed >= 2 && ok(a())) return a();
        break;
      case 'stakes':
        if (!losing && r.myNeed <= 1 && r.threat >= 3 && ok(a())) return a();
        break;
      case 'twist':
        if (duel.turn <= 1 && ok(a({ option: 0 }))) return a({ option: 0 });
        break;
    }
  }
  return null;
}

/** After a duel: replay a loss, save a stake or a life, collect credits. */
function resultGadget(engine: Engine, s: GameState, player: PlayerState): GameAction | null {
  const res = s.duel?.result;
  if (!res || s.duel?.choice) return null;
  for (const it of charged(engine, s, player)) {
    const g = gadgetAt(engine.content, player, it);
    if (!g.places.includes('duelResult')) continue;
    const types = new Set(g.effects.map((e) => e.type));
    // Dustpan's Sweep Up (thinning the deck) is left to people.
    if (types.has('destroyCard')) continue;
    if (types.has('replayDuel') && !(s.duel!.kind === 'boss' || res.lostStake.length > 0)) continue;
    const action = use(player.id, it);
    if (tryAction(engine, s, action, player.id)) return action;
  }
  return null;
}

/** On the pick screen: pick more parcels, unwrap or check wrapped ones. */
function lotGadget(engine: Engine, s: GameState, player: PlayerState): GameAction | null {
  const lot = s.rummage!.lot;
  if (lot.parcels.length <= lot.picks) return null;
  const wrapped = lot.parcels.map((p, i) => ({ p, i })).filter(({ p }) => viewParcel(engine.content, p).kind !== 'known').map(({ i }) => i);
  for (const it of charged(engine, s, player)) {
    const g = gadgetAt(engine.content, player, it);
    if (!g.places.includes('lot')) continue;
    const types = new Set(g.effects.map((e) => e.type));
    const tries: GadgetArgs[] = types.has('extraPick') ? [{}] : wrapped.length > 0 ? [{ parcels: wrapped.slice(0, 2) }, { parcels: wrapped.slice(0, 1) }] : [];
    // Keep a Magnifier charge for duels unless it has more than one.
    if (types.has('checkParcel') && (it.charges ?? 0) < 2) continue;
    for (const args of tries) {
      const action = use(player.id, it, args);
      if (tryAction(engine, s, action, player.id)) return action;
    }
  }
  return null;
}

/** On the map: restore other charges (Orrery); reroute when it opens a better stop. */
function mapGadget(engine: Engine, s: GameState, player: PlayerState): GameAction | null {
  for (const it of charged(engine, s, player)) {
    const g = gadgetAt(engine.content, player, it);
    if (!g.places.includes('map')) continue;
    const types = new Set(g.effects.map((e) => e.type));
    const action = use(player.id, it);
    if (types.has('restoreCharges')) {
      const missing = player.items.filter((o) => o.uid !== it.uid && (o.charges ?? 0) < (maxCharges(engine.content, s.config, o, player) ?? 0)).length;
      if (missing >= 2 && tryAction(engine, s, action, player.id)) return action;
    }
    if (types.has('reroute') && s.map) {
      const best = (st: GameState) => Math.max(0, ...reachableNodes(st.map!).map((n) => mapStopScore(player, n.type)));
      const t = tryAction(engine, s, action, player.id);
      if (t && best(t) > best(s) + 1) return action;
    }
  }
  return null;
}

/** In the scrapbook: put deck parts on a page (Darn) or move pieces (Stitch) when it finishes a stage. */
function scrapbookGadget(engine: Engine, s: GameState, player: PlayerState): GameAction | null {
  const items = (st: GameState) => st.players.find((p) => p.id === player.id)!.items.reduce((n, i) => n + i.grade + 10, 0);
  const pages = scrapbookPages(engine.content, player);
  for (const it of charged(engine, s, player)) {
    const g = gadgetAt(engine.content, player, it);
    if (!g.places.includes('scrapbook')) continue;
    const types = new Set(g.effects.map((e) => e.type));
    const tries: GadgetArgs[] = [];
    if (types.has('deckToPage')) {
      const count = Number(g.effects.find((e) => e.type === 'deckToPage')!.params.count ?? 1);
      for (const page of pages) {
        const done = finishedGrade(s.config, player, page);
        const g1 = done + 1;
        if (g1 > STAGES) continue;
        const left = piecesNeeded(s.config, g1) - pageOf(player, page)[g1 - 1];
        if (left > count) continue;
        const fit = player.deck
          .filter((id) => s.cards[id]?.kind === 'part' && gradeOfCategory(engine.content, (s.cards[id] as { category: string }).category) === g1)
          .slice(0, left);
        if (fit.length === left) tries.push({ cards: fit, pages: [page] });
      }
    }
    if (types.has('movePieces')) {
      const count = Number(g.effects.find((e) => e.type === 'movePieces')!.params.count ?? 1);
      for (const to of pages) {
        for (let st = 1; st <= STAGES; st++) {
          const left = piecesNeeded(s.config, st) - pageOf(player, to)[st - 1];
          if (left <= 0 || left > count) continue;
          for (const from of pages) {
            if (from === to) continue;
            const have = pageOf(player, from)[st - 1];
            if (have >= left && have < piecesNeeded(s.config, st)) tries.push({ pages: [from, to], stage: st });
          }
        }
      }
    }
    for (const args of tries.slice(0, 12)) {
      const action = use(player.id, it, args);
      const t = tryAction(engine, s, action, player.id);
      if (t && items(t) > items(s)) return action;
    }
  }
  return null;
}

/** How much the bot wants a map stop (also used to judge a reroute). */
export function mapStopScore(player: PlayerState, type: NodeType): number {
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

/**
 * Answer a duel choice: keep the cards that bring the hand closest to going
 * out, drop the worst ones, take an opponent's most useful card, put the
 * best cards on top of the draw pile.
 */
export function smartChoice(engine: Engine, s: GameState, playerId: PlayerId, choice: DuelChoice): GameAction {
  const duel = s.duel!;
  const need = (ids: CardId[]) => cardsStillNeeded(s, engine.content, engine.effects, ids);
  const mine = [...duel.hand, ...duel.fx.setAside];
  const gain = (id: CardId) => need(mine) - need([...mine, id]);
  const grade = (id: CardId) => (s.cards[id]?.kind === 'part' ? gradeOfCategory(engine.content, (s.cards[id] as { category: string }).category) : 0);
  if (choice.kind === 'confirm') {
    const i = Number(choice.resume.data?.opponent ?? 0);
    return { type: 'DUEL_CHOOSE', playerId, confirm: need(duel.opponents[i]?.hand ?? []) < need(mine) };
  }
  if (choice.kind === 'order') {
    const ranked = [...choice.cardIds].sort((a, b) => gain(b) - gain(a));
    const useless = ranked.filter((id) => gain(id) <= 0);
    if (choice.allowBottom) return { type: 'DUEL_CHOOSE', playerId, cardIds: ranked.filter((id) => !useless.includes(id)), bottom: useless };
    if (choice.allowDiscard) return { type: 'DUEL_CHOOSE', playerId, cardIds: ranked.filter((id) => !useless.includes(id)), discard: useless };
    return { type: 'DUEL_CHOOSE', playerId, cardIds: ranked };
  }
  const n = choice.min;
  let ranked: CardId[];
  switch (choice.resume.effect) {
    case 'takeFromDiscard':
      // Discarding extra cards: drop the worst.
      ranked = worstCards(engine, s, choice.cardIds);
      break;
    case 'forceDiscard': {
      const opp = duel.opponents[Number(choice.resume.data?.opponent ?? 0)];
      const hurt = (id: CardId) => need(opp.hand.filter((h) => h !== id)) - need(opp.hand);
      ranked = [...choice.cardIds].sort((a, b) => hurt(b) - hurt(a));
      break;
    }
    case 'keepStake':
    case 'keepFromDiscard':
      ranked = [...choice.cardIds].sort((a, b) => grade(b) - grade(a));
      break;
    default:
      // Keeping or taking cards: the most useful first.
      ranked = [...choice.cardIds].sort((a, b) => gain(b) - gain(a) || grade(b) - grade(a));
  }
  return { type: 'DUEL_CHOOSE', playerId, cardIds: ranked.slice(0, n) };
}

/**
 * How much the bot wants a page: what its passive does at Prototype (draws
 * and hand size count most), whether it has a gadget the bot uses in
 * duels, its rarity, and pages of the same collection it already has.
 */
export function pageValue(engine: Engine, player: PlayerState, itemId: string): number {
  const def = itemDef(engine.content, itemId);
  let v = { common: 0, uncommon: 0.5, rare: 1, heirloom: 1 }[def.rarity];
  for (const e of def.passive.effects) {
    const p = e.params ?? {};
    const first = (x: unknown) => (Array.isArray(x) ? Number(x[0]) : Number(x ?? 0));
    const weight = e.when ? 0.4 : 1;
    if (e.type === 'modifyRules') v += weight * (first(p.drawLimit) + 2 * first(p.handSize));
    if (e.type === 'grantTempCard') v += weight * 1.5;
  }
  if (def.gadget?.usedIn.includes('duel')) v += 1;
  const mine = (player.pages ?? []).filter((id) => id !== itemId && itemDef(engine.content, id).collection === def.collection).length;
  return v + 0.6 * mine;
}

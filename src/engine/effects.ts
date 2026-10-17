/**
 * Effect/hook system.
 *
 * Content (specials, items, boss modifiers, shop services) refers to effects
 * by name: `{ "type": "modifyRules", "params": { "handSize": 1 } }`.
 * Each effect type is a handler object implementing any of the hooks below.
 * To add a new kind of effect, add a handler here and reference it from JSON.
 *
 * Item params arrive already resolved to the item's tier (see items.ts), so
 * handlers read plain values. Hooks that receive a context may mutate
 * ctx.state (it is a draft the reducer cloned). Throw RuleError to reject an
 * illegal play.
 */

import type { MeldToken } from './melds';
import type { Rng } from './rng';
import { damageEnemy, drawBattleCards, livingEnemies } from './battleZones';
import { addDraws, drawToHand, isBossOpponent, minionOf, opponentDrops, takeFrom } from './duelZones';
import { type ActiveEffect, itemDef, maxCharges } from './items';
import { commonCategories, randomCategory } from './quality';
import {
  addParcels,
  checkParcel,
  gradeOfCategory,
  hasPage,
  isKnown,
  pageOf,
  piecesNeeded,
  placePieces,
  sharpened,
  STAGES,
  stakeGraceOf,
  targetParcel,
} from './scrapbook';
import type {
  BattleState,
  CardId,
  ContentPack,
  DuelChoice,
  DuelState,
  EffectRef,
  GadgetArgs,
  GameState,
  ItemInstance,
  MeldRole,
  Place,
  PlayerState,
  RewardOption,
  RoundRules,
  Tier,
} from './types';
import {
  addToDeck,
  assertRule,
  cardLabel,
  createPart,
  createSpecial,
  destroyCard,
  getCard,
  log,
  takeTopOfDrawPile,
} from './zones';

export type Params = Record<string, unknown>;

/** What happened, for duel events. */
export interface EventInfo {
  /** Opponent index. */
  opponent?: number;
  cardId?: CardId;
  /** The card was one you discarded. */
  yours?: boolean;
  /** Your winning melds (onBuild in a duel). */
  melds?: CardId[][];
  /** The card just drawn (onDuelDraw). */
  drawn?: CardId;
  /** Extra pieces won with the lot, filled in by onBuild effects (Smoke Jack). */
  bonus?: RewardOption[];
}

export interface EffectContext {
  state: GameState;
  content: ContentPack;
  rng: Rng;
  player: PlayerState;
  /** Card that owns the effect (specials). */
  sourceCardId?: CardId;
  /** Target chosen by the player (PLAY_SPECIAL / SHOP_BUY). */
  targetId?: CardId;
  /** The item whose effect this is (item effects). */
  itemUid?: string;
  /** The duel in play, if any. */
  duel?: DuelState | null;
  info?: EventInfo;
  /** For effects that run other effects (Set the Time). */
  registry?: EffectRegistry;
}

export interface BattleEffectContext extends EffectContext {
  battle: BattleState;
  /** Index into battle.enemies chosen by the player, if any. */
  target?: number;
  /** Item level (1 for starter cards); scales `perLevel` params. */
  level: number;
}

export interface GadgetContext extends EffectContext {
  /** The duel (in a duel or on its result screen), else null. */
  duel: DuelState | null;
  place: Place;
  item: ItemInstance;
  tier: Tier;
  args: GadgetArgs;
  /** Opponent index chosen by the player (args.target). */
  target?: number;
  /** Set by an effect: give the charge back (the player put it back). */
  refund?: boolean;
  /** Set by effects: what the engine does after the gadget. */
  after: ('replay' | 'callOff' | 'rules')[];
  /** Values passed between one gadget's effects (cards burned, for draws per card). */
  vars: Record<string, number>;
}

/** The answer to a duel choice. */
export interface ChoiceAnswer {
  cardIds: CardId[];
  bottom: CardId[];
  discard: CardId[];
  confirm: boolean;
}

export interface EffectHandler {
  /** Static meld role for a card carrying this effect. */
  meldRole?(params: Params): Omit<MeldToken, 'id'> | null;
  /** Resolve random/placeholder params once (e.g. when a boss is chosen). */
  resolveParams?(params: Params, rng: Rng, content: ContentPack): Params;
  /** Adjust the rules for a round. Called on a fresh copy of the base rules. */
  modifyRules?(rules: RoundRules, params: Params): void;
  onRoundStart?(ctx: EffectContext, params: Params): void;
  /** The source card was just drawn from the draw pile. */
  onDraw?(ctx: EffectContext, params: Params): void;
  /** The source card was played from hand. */
  onPlay?(ctx: EffectContext, params: Params): void;
  /** The player completed a build (or went out in a duel: ctx.info.melds). */
  onBuild?(ctx: EffectContext, params: Params): void;
  onRoundEnd?(ctx: EffectContext, params: Params): void;
  /** Bought from the shop (services). */
  onPurchase?(ctx: EffectContext, params: Params): void;
  /** The card was played in battle. */
  onBattlePlay?(ctx: BattleEffectContext, params: Params): void;
  // --- Duel events (passives; ctx.duel is set) ---
  /** Your turn begins (ctx.duel.turn is its number). */
  onTurnStart?(ctx: EffectContext, params: Params): void;
  /** You drew from your own pile (ctx.info.drawn). */
  onDuelDraw?(ctx: EffectContext, params: Params): void;
  /** An opponent took from the discard pile. */
  onOpponentTake?(ctx: EffectContext, params: Params): void;
  /** An opponent missed a turn. */
  onOpponentSkipped?(ctx: EffectContext, params: Params): void;
  /** An opponent is 1 card from going out (first time each). */
  onOpponentNearOut?(ctx: EffectContext, params: Params): void;
  /** An opponent is about to go out; return true to stop it. */
  onOpponentWouldGoOut?(ctx: EffectContext, params: Params): boolean;
  // --- Gadgets ---
  /** Where this effect works when a gadget is used (default: duels). */
  places?: Place[];
  /** A gadget was used. */
  onGadget?(ctx: GadgetContext, params: Params): void;
  /** The player answered a choice this effect opened. */
  onChoice?(ctx: GadgetContext, params: Params, answer: ChoiceAnswer, data: Record<string, unknown>): void;
}

export type EffectRegistry = Record<string, EffectHandler>;

export type ContextHook =
  | 'onRoundStart'
  | 'onDraw'
  | 'onPlay'
  | 'onBuild'
  | 'onRoundEnd'
  | 'onPurchase'
  | 'onTurnStart'
  | 'onDuelDraw'
  | 'onOpponentTake'
  | 'onOpponentSkipped'
  | 'onOpponentNearOut';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function needDuel(ctx: EffectContext): DuelState {
  assertRule(ctx.duel, 'No duel in progress');
  return ctx.duel;
}

/** A passive's hook param: `hook` must name this hook (or be absent, when it's the default). */
function hookIs(params: Params, hook: string, isDefault = false): boolean {
  return params.hook === hook || (isDefault && params.hook === undefined);
}

/** Count how often a capped effect has fired this duel; returns false once `max` is reached. */
function fireCapped(ctx: EffectContext, key: string, max: number): boolean {
  const duel = needDuel(ctx);
  const k = `${ctx.itemUid ?? 'set'}:${key}`;
  const n = duel.fx.fired[k] ?? 0;
  if (n >= max) return false;
  duel.fx.fired[k] = n + 1;
  return true;
}

function gain(ctx: EffectContext, amount: number, why = '') {
  if (amount <= 0) return;
  ctx.player.currency += amount;
  log(ctx.state, `+${plural(amount, 'credit')}${why ? ` ${why}` : ''}.`);
}

/** Opponents an effect hits: every one, the boss, a random one, or the chosen one. */
function opponentsHit(ctx: GadgetContext, params: Params): number[] {
  const duel = needDuel(ctx);
  const all = duel.opponents.map((_, i) => i);
  if (params.boss === true || params.target === 'boss') return all.filter((i) => isBossOpponent(ctx.content, duel.opponents[i]));
  if (params.all === true || params.target === 'all') return all;
  if (params.target === 'random') {
    const withCards = all.filter((i) => duel.opponents[i].hand.length > 0);
    return withCards.length > 0 ? [ctx.rng.pick(withCards)] : [];
  }
  assertRule(ctx.target !== undefined && duel.opponents[ctx.target], 'Choose an opponent');
  return [ctx.target];
}

/** Cards chosen for a gadget from a zone: between min and max, all different, all in the zone. */
function chosenCards(ctx: GadgetContext, zone: CardId[], min: number, max: number, what: string): CardId[] {
  const ids = ctx.args.cards ?? [];
  assertRule(new Set(ids).size === ids.length, 'Choose different cards');
  assertRule(ids.length >= min && ids.length <= max, min === max ? `Choose ${plural(min, what)}` : `Choose ${min} to ${max} ${what}s`);
  for (const id of ids) assertRule(zone.includes(id), `Choose ${what}s from the right place`);
  return ids;
}

function openChoice(ctx: GadgetContext | EffectContext, choice: Omit<DuelChoice, 'resume'>, effect: string, params: Params, data: Record<string, unknown> = {}) {
  const duel = needDuel(ctx);
  assertRule(!duel.choice, 'Finish the choice in front of you first');
  duel.choice = { ...choice, resume: { effect, params, itemUid: ctx.itemUid, data } };
}

/** Take a card out of the discard pile into your hand (tracked for the Smoke Jack). */
function takeDiscardCard(duel: DuelState, id: CardId) {
  const at = duel.discard.indexOf(id);
  if (at < 0) return;
  duel.discard.splice(at, 1);
  duel.hand.push(id);
  duel.fx.fromDiscard.push(id);
}

/** Move cards from your hand to the discard pile (they count as yours, for the Mousetrap). */
function discardFromHand(duel: DuelState, ids: CardId[]) {
  for (const id of ids) {
    const at = duel.hand.indexOf(id);
    if (at < 0) continue;
    duel.hand.splice(at, 1);
    duel.discard.push(id);
    duel.fx.yourDiscards.push(id);
  }
}

function partGauge(state: GameState, id: CardId): number {
  const c = state.cards[id];
  return c?.kind === 'part' ? c.gauge : 0;
}

// ---------------------------------------------------------------------------
// Specials (workshop rounds) and shop services
// ---------------------------------------------------------------------------

const drawChoice: EffectHandler = {
  onDraw(ctx, params) {
    startDrawChoice(ctx, params);
  },
  onPlay(ctx, params) {
    startDrawChoice(ctx, params);
  },
  /** Kaleidoscope: your first draws each duel show you 2 cards; keep 1, the other goes to the bottom. */
  onDuelDraw(ctx, params) {
    const duel = needDuel(ctx);
    const drawn = ctx.info?.drawn;
    if (!hookIs(params, 'onDuelDraw') || !drawn || duel.fx.deckDraws > num(params.firstDraws, 1)) return;
    const extra: CardId[] = [];
    for (let i = 1; i < num(params.draw, 2); i++) {
      const id = takeFrom(duel.drawPile, duel.discard, ctx.rng);
      if (id) extra.push(id);
    }
    if (extra.length === 0) return;
    duel.hand.splice(duel.hand.indexOf(drawn), 1);
    const shown = [drawn, ...extra];
    const keep = Math.min(num(params.keep, 1), shown.length);
    openChoice(ctx, { kind: 'pick', prompt: `Keep ${keep} of these; the rest go to the bottom of your draw pile.`, cardIds: shown, min: keep, max: keep }, 'drawChoice', params);
  },
  onChoice(ctx, params, answer) {
    const duel = needDuel(ctx);
    const shown = duel.choice!.cardIds;
    duel.hand.push(...answer.cardIds);
    const rest = shown.filter((id) => !answer.cardIds.includes(id));
    if (params.rest === 'bottom') duel.drawPile.unshift(...rest);
    else duel.discard.push(...rest);
  },
};

function startDrawChoice(ctx: EffectContext, params: Params) {
  const { state, player, rng } = ctx;
  // The source card leaves the hand for the round.
  if (ctx.sourceCardId && player.hand.includes(ctx.sourceCardId)) {
    player.hand.splice(player.hand.indexOf(ctx.sourceCardId), 1);
    player.played.push(ctx.sourceCardId);
  }
  const drawn: CardId[] = [];
  for (let i = 0; i < num(params.draw, 2); i++) {
    const id = takeTopOfDrawPile(state, player, rng);
    if (id) drawn.push(id);
  }
  if (drawn.length === 0) return;
  const keep = Math.min(num(params.keep, 1), drawn.length);
  if (keep >= drawn.length) {
    player.hand.push(...drawn);
    return;
  }
  state.roundState!.pendingChoice = {
    kind: 'keepOne',
    playerId: player.id,
    cardIds: drawn,
    keep,
    rest: params.rest === 'bottom' ? 'bottom' : 'discard',
  };
}

const reorderTop: EffectHandler = {
  onPlay(ctx, params) {
    const { state, player } = ctx;
    const count = Math.min(num(params.count, 3), player.drawPile.length);
    assertRule(count > 0, 'Your draw pile is empty');
    // Listed top-first.
    const top = player.drawPile.slice(-count).reverse();
    state.roundState!.pendingChoice = { kind: 'reorderTop', playerId: player.id, cardIds: top };
  },
  /** Periscope, Chimney Pot: look at the top cards of your draw pile and put them back in any order. */
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    const count = Math.min(num(params.count, 3), duel.drawPile.length);
    assertRule(count > 0, 'Your draw pile is empty');
    const top = duel.drawPile.slice(-count).reverse();
    const where = params.allowBottom ? ' Any can go to the bottom.' : params.mayDiscard ? ' Any can go on the discard pile.' : '';
    openChoice(
      ctx,
      { kind: 'order', prompt: `Put these back in the order you'll draw them.${where}`, cardIds: top, min: 0, max: count, allowBottom: !!params.allowBottom, allowDiscard: !!params.mayDiscard },
      'reorderTop',
      params,
    );
  },
  onChoice(ctx, _params, answer) {
    const duel = needDuel(ctx);
    const shown = duel.choice!.cardIds;
    const choice = duel.choice!;
    const placed = [...answer.cardIds, ...answer.bottom, ...answer.discard];
    assertRule(placed.length === shown.length && shown.every((id) => placed.includes(id)), 'Place every card you looked at');
    assertRule(answer.bottom.length === 0 || choice.allowBottom, "You can't put cards on the bottom");
    assertRule(answer.discard.length === 0 || choice.allowDiscard, "You can't discard these");
    duel.drawPile.splice(duel.drawPile.length - shown.length, shown.length, ...[...answer.cardIds].reverse());
    duel.drawPile.unshift(...answer.bottom);
    for (const id of answer.discard) {
      duel.discard.push(id);
      duel.fx.yourDiscards.push(id);
    }
  },
};

const takeFromDiscard: EffectHandler = {
  onPlay(ctx) {
    const { state, player, targetId, content } = ctx;
    const round = state.roundState!;
    assertRule(player.rules.allowDiscardDraw, 'Discard pile draws are not allowed this round');
    assertRule(targetId && round.discard.includes(targetId), 'Choose a card in the discard pile');
    round.discard.splice(round.discard.indexOf(targetId), 1);
    player.hand.push(targetId);
    log(state, `${player.name} scavenges ${cardLabel(state, content, targetId)}.`);
  },
  /**
   * Gadget versions. `top`: take the top N (Coal Scuttle, Smoke Jack), then
   * maybe discard some. Otherwise take chosen cards: any (Horseshoe Magnet)
   * or from the top `depth` (Fire Poker). `asDraw`: it is your draw.
   */
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    assertRule(duel.discard.length > 0, 'The discard pile is empty');
    // The Locked Skip twist blocks taking from the pile, except for a poker's reach (`depth`).
    if (params.depth === undefined) assertRule(duel.rules.allowDiscardDraw, 'Discard pile draws are not allowed in this fight');
    let taken: CardId[];
    if (params.top !== undefined) {
      taken = duel.discard.slice(-num(params.top, 1)).reverse();
    } else {
      const depth = num(params.depth, 99);
      taken = chosenCards(ctx, duel.discard.slice(-depth), 1, num(params.count, 1), 'card');
    }
    if (params.asDraw) {
      assertRule(duel.turnPhase === 'draw', 'Use it in place of your draw');
      assertRule(duel.drawsTaken < duel.rules.drawLimit, 'No draws left');
      duel.drawsTaken += 1;
      duel.fx.drawsThisTurn += 1;
      duel.turnPhase = 'main';
    }
    for (const id of taken) takeDiscardCard(duel, id);
    log(ctx.state, `You take ${taken.map((id) => cardLabel(ctx.state, ctx.content, id)).join(', ')} from the discard pile.`);
    const thenDiscard = Math.min(num(params.thenDiscard) + num(params.discardAfter), duel.hand.length);
    if (thenDiscard > 0) {
      openChoice(ctx, { kind: 'pick', prompt: `Discard ${plural(thenDiscard, 'card')}.`, cardIds: [...duel.hand], min: thenDiscard, max: thenDiscard }, 'takeFromDiscard', params);
    }
  },
  onChoice(ctx, _params, answer) {
    discardFromHand(needDuel(ctx), answer.cardIds);
  },
};

const destroyCardEffect: EffectHandler = {
  places: ['duel', 'duelResult'],
  onPlay(ctx) {
    const { state, player, targetId, sourceCardId, content } = ctx;
    assertRule(targetId && targetId !== sourceCardId && player.hand.includes(targetId), 'Choose another card in your hand');
    log(state, `${player.name} scraps ${cardLabel(state, content, targetId)} for good.`);
    destroyCard(state, targetId);
  },
  onPurchase(ctx) {
    const { state, player, targetId, content } = ctx;
    assertRule(targetId && player.deck.includes(targetId), 'Choose a card in your deck');
    log(state, `${player.name} scraps ${cardLabel(state, content, targetId)} for good.`);
    destroyCard(state, targetId);
  },
  /** Burn (Pot-Bellied Stove): cards from your hand. Sweep Up (Dustpan): cards from your deck, after a duel. */
  onGadget(ctx, params) {
    const { state, content } = ctx;
    const count = num(params.count, 1);
    if (ctx.place === 'duel') {
      const duel = needDuel(ctx);
      const ids = chosenCards(ctx, duel.hand, 1, count, 'card');
      log(state, `You burn ${ids.map((id) => cardLabel(state, content, id)).join(', ')} for good.`);
      for (const id of ids) {
        duel.hand.splice(duel.hand.indexOf(id), 1);
        destroyCard(state, id);
      }
      ctx.vars.burned = ids.length;
      return;
    }
    const ids = chosenCards(ctx, ctx.player.deck, 1, count, 'card');
    assertRule(ctx.player.deck.length - ids.length >= 20, "You can't take your deck below 20 cards");
    log(state, `You sweep ${ids.map((id) => cardLabel(state, content, id)).join(', ')} out of your deck for good.`);
    for (const id of ids) destroyCard(state, id);
    gain(ctx, num(params.creditEach) * ids.length);
  },
};

const addRandomParts: EffectHandler = {
  onPurchase(ctx, params) {
    const { state, player, rng, content } = ctx;
    for (let i = 0; i < num(params.count, 3); i++) {
      const category = randomCategory(content, rng).id;
      const gauge = rng.int(state.config.gaugeMin, state.config.gaugeMax);
      const card = createPart(state, content, player.id, category, gauge);
      addToDeck(state, card);
      log(state, `${player.name} gets ${card.name} (${gauge}).`);
    }
  },
};

const meldRole: EffectHandler = {
  meldRole(params) {
    const role = params.role as MeldRole;
    if (role === 'bulk') return { role: 'bulk', slots: num(params.slots, 2) };
    if (role === 'wild' || role === 'adaptor') return { role };
    return null;
  },
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const MAX_RULES = ['seeOwnTop', 'seeDiscard', 'protectDiscardTurns', 'stakeGrace'] as const;
const ADD_RULES = ['freeDiscardDraws', 'takeAnyDiscard', 'extraDiscards', 'opponentHandSize'] as const;

const modifyRules: EffectHandler = {
  modifyRules(rules, params) {
    rules.handSize += num(params.handSize);
    rules.drawLimit += num(params.drawLimit);
    if (typeof params.allowDiscardDraw === 'boolean') rules.allowDiscardDraw = params.allowDiscardDraw;
    if (typeof params.revealHidden === 'boolean') rules.revealHidden = params.revealHidden;
    if (params.wrapRuns === true) rules.wrapRuns = true;
    if (params.seeOpponentProgress === true) rules.seeOpponentProgress = true;
    if (params.opponentDiscardDraw === false) rules.opponentDiscardDraw = false;
    for (const k of MAX_RULES) rules[k] = Math.max(rules[k], num(params[k]));
    for (const k of ADD_RULES) rules[k] += num(params[k]);
    if (Array.isArray(params.disableMeldRoles)) {
      for (const r of params.disableMeldRoles as MeldRole[]) {
        if (!rules.disabledMeldRoles.includes(r)) rules.disabledMeldRoles.push(r);
      }
    }
    if (Array.isArray(params.banCategories)) {
      for (const c of params.banCategories as string[]) {
        if (!rules.bannedCategories.includes(c)) rules.bannedCategories.push(c);
      }
    }
  },
};

/** Soldering Iron: adaptors fix a part's gauge and material at once, and move gauges further. */
const adaptorBoost: EffectHandler = {
  modifyRules(rules, params) {
    if (params.both === true) rules.adaptorBoth = true;
    rules.adaptorShift = Math.max(rules.adaptorShift, num(params.gaugeShift, 1));
  },
};

const banCategory: EffectHandler = {
  resolveParams(params, rng, content) {
    if (params.category === 'random' || params.category === undefined) {
      return { ...params, category: rng.pick(commonCategories(content)).id };
    }
    return params;
  },
  modifyRules(rules, params) {
    const c = params.category;
    if (typeof c === 'string' && c !== 'random' && !rules.bannedCategories.includes(c)) rules.bannedCategories.push(c);
  },
};

// ---------------------------------------------------------------------------
// Cards, credits and the pot
// ---------------------------------------------------------------------------

const grantTempCard: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    for (let i = 0; i < num(params.count, 1); i++) {
      const card = createSpecial(ctx.state, ctx.player.id, String(params.specialId), true);
      if (params.natural === true) card.natural = true;
      duel.hand.push(card.id);
    }
  },
  onRoundStart(ctx, params) {
    const { state, player } = ctx;
    // In a duel the card goes to the duel hand; in a workshop round, to the player's hand.
    const hand = state.duel && state.phase === 'duel' ? state.duel.hand : player.hand;
    for (let i = 0; i < num(params.count, 1); i++) {
      const card = createSpecial(state, player.id, String(params.specialId), true);
      hand.push(card.id);
    }
  },
};

const gainCurrency: EffectHandler = {
  places: ['duelResult'],
  onBuild(ctx, params) {
    if (hookIs(params, 'onBuild')) gain(ctx, num(params.amount, 1));
  },
  onBattlePlay(ctx, params) {
    if (hookIs(params, 'onBattlePlay')) gain(ctx, num(params.amount, 1));
  },
  onRoundEnd(ctx, params) {
    if (!hookIs(params, 'onRoundEnd', true)) return;
    const duel = ctx.duel;
    if (params.maxTurns !== undefined && (!duel || duel.turn > num(params.maxTurns))) return;
    let amount = num(params.amount, params.perDiscard !== undefined ? 0 : 1);
    if (duel) {
      amount += num(params.perOpponent) * duel.opponents.length;
      if (params.perDiscard !== undefined) amount += Math.min(num(params.max, 99), Math.floor(duel.discard.length / Math.max(1, num(params.perDiscard))));
      if (typeof params.perGadgetUsed === 'string') amount *= duel.fx.gadgetUses[params.perGadgetUsed] ?? 0;
    } else if (typeof params.perGadgetUsed === 'string' || params.perDiscard !== undefined) {
      amount = 0;
    }
    gain(ctx, amount);
  },
  /** Mousetrap: a minion took one of your discards. */
  onOpponentTake(ctx, params) {
    if (!hookIs(params, 'onOpponentTake')) return;
    const duel = needDuel(ctx);
    const opp = duel.opponents[ctx.info?.opponent ?? -1];
    if (!opp || isBossOpponent(ctx.content, opp)) return;
    if (params.onlyYourDiscards && !ctx.info?.yours) return;
    gain(ctx, num(params.amount, 1), 'from the Mousetrap');
  },
  /** Count the Swings (Pendulum): credits for each draw you didn't use. */
  onGadget(ctx, params) {
    const result = needDuel(ctx).result;
    assertRule(result, 'Use it after a duel');
    const amount = Math.min(num(params.max, 99), num(params.perUnusedDraw) * result.unusedDraws);
    assertRule(amount > 0, 'You used all your draws');
    gain(ctx, amount);
  },
};

/** Coin Press: you and every opponent add parts of the stake material to the pot. */
const raiseStakes: EffectHandler = {
  onGadget(ctx, params) {
    const { state, content, rng, player } = ctx;
    const duel = needDuel(ctx);
    const rule = duel.stakeRule;
    if (rule && num(params.own) > 0) {
      const need = gradeOfCategory(content, rule.category) - stakeGraceOf(state, content, player);
      const spare = duel.drawPile
        .filter((id) => {
          const c = state.cards[id];
          return c?.kind === 'part' && !c.temporary && gradeOfCategory(content, c.category) >= need;
        })
        .sort((a, b) => gradeOfCategory(content, (state.cards[a] as { category: string }).category) - gradeOfCategory(content, (state.cards[b] as { category: string }).category) || partGauge(state, a) - partGauge(state, b));
      assertRule(spare.length >= num(params.own), 'You need a spare part that meets the stake in your draw pile');
      for (const id of spare.slice(0, num(params.own))) {
        duel.drawPile.splice(duel.drawPile.indexOf(id), 1);
        duel.pot.push(id);
        duel.playerStake.push(id);
      }
    }
    const step = num(params.materialStep);
    const ladder = [...content.categories].sort((a, b) => a.grade - b.grade);
    for (const opp of duel.opponents) {
      const def = minionOf(content, opp);
      for (let i = 0; i < num(params.count, 1); i++) {
        let category: string;
        if (rule) {
          const g = Math.min(ladder.at(-1)!.grade, gradeOfCategory(content, rule.category) + step);
          category = (ladder.find((c) => c.grade === g) ?? ladder[0]).id;
        } else {
          category = def?.deck.categories ? rng.pick(def.deck.categories) : randomCategory(content, rng).id;
        }
        const [lo, hi] = def?.deck.gauges ?? [state.config.gaugeMin, state.config.gaugeMax];
        duel.pot.push(createPart(state, content, player.id, category, rng.int(lo, Math.min(hi, state.config.gaugeMax)), true).id);
      }
    }
    log(state, 'The stakes go up!');
  },
};

/** Pot-Bellied Stove: when you go out, each opponent adds its highest-gauge cards to the pot. */
const growPot: EffectHandler = {
  onBuild(ctx, params) {
    const duel = ctx.duel;
    if (!duel || !hookIs(params, 'onBuild')) return;
    let added = 0;
    for (const opp of duel.opponents) {
      const best = [...opp.hand].sort((a, b) => partGauge(ctx.state, b) - partGauge(ctx.state, a)).slice(0, num(params.perOpponent, 1));
      for (const id of best) {
        opp.hand.splice(opp.hand.indexOf(id), 1);
        duel.pot.push(id);
        added++;
      }
    }
    if (added > 0) log(ctx.state, `The stove draws ${plural(added, 'more card')} into the pot.`);
    gain(ctx, num(params.creditEach) * added);
  },
};

// ---------------------------------------------------------------------------
// Lots, pages and the scrapbook
// ---------------------------------------------------------------------------

/** Lots are catalogued this many levels better (see sharpened in scrapbook.ts). No hooks. */
const lotInsight: EffectHandler = {};

/** Wind-Up Key, the Scrapyard bonus: the lot you won holds more parcels. */
const lotBonus: EffectHandler = {
  onRoundEnd(ctx, params) {
    const duel = ctx.duel;
    if (!duel?.lot || !hookIs(params, 'onRoundEnd', true)) return;
    if (params.maxTurns !== undefined && duel.turn > num(params.maxTurns)) return;
    addParcels(ctx.content, duel.lot, num(params.parcels, 1), ctx.rng);
    log(ctx.state, `The ${duel.lot.name} turns out to hold ${plural(num(params.parcels, 1), 'more parcel')}.`);
  },
};

/** Smoke Jack: pieces of the stake material for cards in your melds you took from the discard pile. */
const extraPieces: EffectHandler = {
  onBuild(ctx, params) {
    const duel = ctx.duel;
    const melds = ctx.info?.melds;
    if (!duel || !melds || !hookIs(params, 'onBuild')) return;
    const taken = melds.flat().filter((id) => duel.fx.fromDiscard.includes(id)).length;
    const n = Math.min(num(params.max, 99), Math.floor(taken * num(params.perDiscardTaken, 1)));
    if (n <= 0) return;
    if (duel.stakeRule && duel.lot) {
      const bonus: RewardOption[] = Array.from({ length: n }, () => ({ kind: 'part', category: duel.stakeRule!.category, gauge: ctx.rng.int(ctx.state.config.gaugeMin, ctx.state.config.gaugeMax) }));
      ctx.info?.bonus?.push(...bonus);
      log(ctx.state, `The Smoke Jack turns up ${plural(n, 'extra piece')}.`);
    }
    gain(ctx, num(params.creditEach) * n);
  },
};

/** Clear the Air (Bellows): blow the discard pile out of the duel. */
const clearDiscard: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    assertRule(duel.discard.length > 0, 'The discard pile is already empty');
    if (params.keepTop === true) takeDiscardCard(duel, duel.discard.at(-1)!);
    const blown = duel.discard.splice(0);
    log(ctx.state, `You blow ${plural(blown.length, 'card')} out of the duel.`);
    gain(ctx, Math.min(num(params.creditMax, 99), num(params.creditEach) * blown.length));
  },
};

const checkParcelEffect: EffectHandler = {
  places: ['lot'],
  /** Spyglass (Magnifier) on a parcel: learn its metal, leaving `options` numbers (1 = unwrap). */
  onGadget(ctx, params) {
    const parcel = targetParcel(ctx.state, ctx.args.nodeId, ctx.args.parcels?.[0] ?? -1);
    const options = sharpened(ctx.content, ctx.state.config, ctx.player, num(params.options, 3));
    checkParcel(parcel, options <= 1 ? 'both' : ((params.reveals as 'metal' | 'gauge') ?? 'metal'), options);
  },
};

const unwrapParcels: EffectHandler = {
  places: ['lot'],
  /** Wind Up (Wind-Up Key): unwrap parcels of a lot. */
  onGadget(ctx, params) {
    const picks = ctx.args.parcels ?? [];
    assertRule(picks.length >= 1 && picks.length <= num(params.count, 1) && new Set(picks).size === picks.length, `Choose up to ${plural(num(params.count, 1), 'parcel')}`);
    for (const i of picks) checkParcel(targetParcel(ctx.state, ctx.args.nodeId, i), 'both', 1);
  },
};

const extraPick: EffectHandler = {
  places: ['lot'],
  /** Prise Open (Crowbar): pick more parcels from the lot you've won, maybe after seeing every metal. */
  onGadget(ctx, params) {
    const r = ctx.state.rummage;
    assertRule(ctx.state.phase === 'rummage' && r?.stage === 'pick', "Use it on the pick screen of a lot you've won");
    const n = num(params.count, num(params.amount, 1));
    if (n <= 0) return;
    assertRule(r.lot.picks < r.lot.parcels.length, 'You already take every parcel');
    r.lot.picks = Math.min(r.lot.parcels.length, r.lot.picks + n);
    if (params.revealMetals === true) {
      for (const p of r.lot.parcels) {
        if (p.piece.kind === 'part' && !isKnown(p)) p.metalOptions = 1;
        else if (p.piece.kind !== 'part') checkParcel(p, 'both', 1);
      }
    }
    log(ctx.state, `You can pick ${plural(r.lot.picks, 'parcel')} now.`);
  },
};

/** Pieces count double (Sewing Kit, Thimble, the Haberdashery bonus): read when sorting a lot. No hooks. */
const doublePieces: EffectHandler = {};

const movePieces: EffectHandler = {
  places: ['scrapbook'],
  /**
   * Stitch (Sewing Kit), Leaf Through (Perpetual Calendar): move pieces off
   * an unfinished stage of one page onto another. They land on the best
   * stage their material can fill.
   */
  onGadget(ctx, params) {
    const { state, content, player } = ctx;
    const [from, to] = ctx.args.pages ?? [];
    assertRule(from && to && from !== to, 'Choose a page to move pieces from, and another to move them to');
    assertRule(hasPage(player, from) && hasPage(player, to), 'Both pages must be in your scrapbook');
    if (typeof params.toCollection === 'string') {
      assertRule(itemDef(content, to).collection === params.toCollection, `Move pieces onto a ${content.collections.find((c) => c.id === params.toCollection)?.name ?? ''} page`);
    }
    const page = pageOf(player, from);
    const open = (g: number) => page[g - 1] > 0 && page[g - 1] < piecesNeeded(state.config, g);
    let stages: number[];
    if (ctx.args.stage !== undefined) {
      assertRule(open(ctx.args.stage), 'Pieces can only come off an unfinished stage that has some');
      stages = [ctx.args.stage];
    } else {
      assertRule(params.anyMaterial === true, 'Choose a stage to move pieces from');
      stages = Array.from({ length: STAGES }, (_, i) => STAGES - i).filter(open);
    }
    let left = num(params.count, 1);
    let moved = 0;
    for (const g of stages) {
      while (left > 0 && page[g - 1] > 0 && page[g - 1] < piecesNeeded(state.config, g)) {
        placePieces(state, content, player, to, g);
        player.scrapbook[from][g - 1] -= 1;
        left--;
        moved++;
      }
      if (params.anyMaterial !== true) break;
    }
    assertRule(moved > 0, 'Nothing to move');
    log(state, `You move ${plural(moved, 'piece')} to the ${itemDef(content, to).name} page.`);
  },
};

const deckToPage: EffectHandler = {
  places: ['scrapbook'],
  /** Darn (Thimble): put parts from your deck onto a page. */
  onGadget(ctx, params) {
    const { state, content, player } = ctx;
    const ids = chosenCards(ctx, player.deck, 1, num(params.count, 1), 'part');
    const page = ctx.args.pages?.[0];
    assertRule(page && hasPage(player, page), 'Choose a page in your scrapbook');
    const parts = player.deck.filter((id) => state.cards[id]?.kind === 'part').length;
    assertRule(parts - ids.length >= 30, "You can't take your deck below 30 parts this way");
    for (const id of ids) {
      const card = getCard(state, id);
      assertRule(card.kind === 'part', 'Choose parts');
      placePieces(state, content, player, page, gradeOfCategory(content, card.category));
      destroyCard(state, id);
    }
    log(state, `You darn ${plural(ids.length, 'part')} into the ${itemDef(content, page).name} page.`);
  },
};

// ---------------------------------------------------------------------------
// Static bonuses, read where they apply. No hooks.
// ---------------------------------------------------------------------------

const appraiseDiscount: EffectHandler = {};
const shopExtraTools: EffectHandler = {};
const sellBonus: EffectHandler = {};
const chargeBonus: EffectHandler = {};
const rechargeDiscount: EffectHandler = {};
const restRecharges: EffectHandler = {};
const revealBossTwists: EffectHandler = {};
/** Tinderbox: twists that cut your draws or hand size cut less (read in duelRules). */
const twistResist: EffectHandler = {};
/** Stopped Clock: keep parts of a lost stake (read when a duel is lost). */
const keepStake: EffectHandler = {
  onChoice(ctx, _params, answer) {
    const result = needDuel(ctx).result!;
    result.lostStake = result.lostStake.filter((id) => !answer.cardIds.includes(id));
  },
};

const spareLife: EffectHandler = {
  places: ['duel', 'duelResult'],
  /** Dutch Courage (Hip Flask): a lost boss duel costs no life. */
  onGadget(ctx) {
    const duel = needDuel(ctx);
    if (ctx.place === 'duelResult') {
      assertRule(duel.result?.lifeLost, 'Use it after losing a life to a boss');
      duel.result.lifeLost = false;
      ctx.player.lives += 1;
      log(ctx.state, 'Dutch courage: you keep your life.');
      return;
    }
    assertRule(!duel.fx.insured.life, 'This duel is already covered');
    duel.fx.insured.life = true;
  },
};

/** Weigh In (Brass Scales): losing this duel costs no stake; winning pays extra. */
const insureStake: EffectHandler = {
  places: ['duel', 'duelResult'],
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    if (ctx.place === 'duelResult') {
      assertRule(duel.result && !duel.result.won && duel.result.lostStake.length > 0, 'Use it after losing a stake');
      duel.result.lostStake = [];
      log(ctx.state, 'Your stake comes back to your deck.');
      return;
    }
    assertRule(!duel.fx.insured.stake, 'Your stake is already covered');
    duel.fx.insured.stake = true;
    duel.fx.insured.winCredits += num(params.winCredits);
  },
};

/** Twice a Day (Stopped Clock): losing costs no stake (and at Masterwork, no life). */
const insureDuel: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    assertRule(!(duel.fx.insured.stake && (duel.fx.insured.life || params.life !== true)), 'This duel is already covered');
    duel.fx.insured.stake = true;
    if (params.life === true) duel.fx.insured.life = true;
  },
};

/** Dustpan and Brush: after a win, take a card from the discard pile into your deck. */
const keepFromDiscard: EffectHandler = {
  onRoundEnd(ctx, params) {
    const duel = ctx.duel;
    if (!duel || !hookIs(params, 'onRoundEnd', true)) return;
    // Only parts that aren't already yours (an opponent's), never temporary item cards.
    const candidates = duel.discard.slice(-num(params.depth, 99)).filter((id) => {
      const c = ctx.state.cards[id];
      return c?.kind === 'part' && c.temporary;
    });
    if (candidates.length === 0) return;
    const count = Math.min(num(params.count, 1), candidates.length);
    if (params.choose === true && !duel.choice) {
      openChoice(ctx, { kind: 'pick', prompt: `Take ${plural(count, 'card')} into your deck.`, cardIds: candidates.reverse(), min: count, max: count }, 'keepFromDiscard', params);
      return;
    }
    for (const id of ctx.rng.sample(candidates, count)) keepCard(ctx, duel, id);
  },
  onChoice(ctx, _params, answer) {
    const duel = needDuel(ctx);
    for (const id of answer.cardIds) keepCard(ctx, duel, id);
  },
};

function keepCard(ctx: EffectContext, duel: DuelState, id: CardId) {
  const card = ctx.state.cards[id];
  if (!card) return;
  duel.discard.splice(duel.discard.indexOf(id), 1);
  delete card.temporary;
  addToDeck(ctx.state, card);
  log(ctx.state, `You sweep up ${cardLabel(ctx.state, ctx.content, id)} for your deck.`);
}

// ---------------------------------------------------------------------------
// Turns and draws
// ---------------------------------------------------------------------------

const skipTurn: EffectHandler = {
  onGadget(ctx, params) {
    const turns = num(params.turns, 1);
    if (turns <= 0) return;
    const hit = opponentsHit(ctx, params);
    const duel = needDuel(ctx);
    for (const i of hit) duel.opponents[i].skip += turns;
    log(ctx.state, `${hit.map((i) => duel.opponents[i].name).join(' and ') || 'Nobody'} will miss ${plural(turns, 'turn')}.`);
  },
  /** Tourbillon: on every Nth turn of yours, every opponent misses its turn. */
  onTurnStart(ctx, params) {
    const duel = needDuel(ctx);
    if (!hookIs(params, 'onTurnStart') || duel.turn % Math.max(1, num(params.everyTurns, 1)) !== 0) return;
    for (const opp of duel.opponents) opp.skip += num(params.turns, 1);
    log(ctx.state, 'Tick: every opponent will miss its turn.');
  },
};

const revealHands: EffectHandler = {
  onGadget(ctx) {
    const duel = needDuel(ctx);
    assertRule(duel.opponents.some((o) => !o.revealed), 'You can already see every hand');
    for (const o of duel.opponents) o.revealed = true;
  },
};

const extraDraws: EffectHandler = {
  onGadget(ctx, params) {
    const n = num(params.amount, 1);
    if (n > 0) addDraws(needDuel(ctx), n);
  },
  /** Escapement: draws when opponents take from the discard pile (capped per duel). */
  onOpponentTake(ctx, params) {
    if (!hookIs(params, 'onOpponentTake') || num(params.amount, 1) <= 0) return;
    if (!fireCapped(ctx, 'take', num(params.maxPerDuel, 99))) return;
    addDraws(needDuel(ctx), num(params.amount, 1));
  },
  /** Chronometer: a draw the first time an opponent is 1 card away. */
  onOpponentNearOut(ctx, params) {
    if (!hookIs(params, 'onOpponentNearOut') || num(params.amount, 1) <= 0) return;
    if (params.oncePerDuel === true && !fireCapped(ctx, 'near', 1)) return;
    addDraws(needDuel(ctx), num(params.amount, 1));
  },
  onOpponentSkipped(ctx, params) {
    if (!hookIs(params, 'onOpponentSkipped') || num(params.amount, 1) <= 0) return;
    addDraws(needDuel(ctx), num(params.amount, 1));
  },
};

const drawExtra: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    let n = num(params.amount, params.perOpponent !== undefined || params.perCard !== undefined ? 0 : 1);
    n += num(params.perOpponent) * duel.opponents.length + num(params.plus);
    n += num(params.perCard) * (ctx.vars.burned ?? 0);
    if (n > 0) drawToHand(duel, n, ctx.rng);
  },
  /** Metronome: on every Nth turn, draw an extra card. */
  onTurnStart(ctx, params) {
    const duel = needDuel(ctx);
    if (!hookIs(params, 'onTurnStart') || duel.turn % Math.max(1, num(params.everyTurns, 1)) !== 0) return;
    drawToHand(duel, num(params.amount, 1), ctx.rng);
  },
  /** Astronomical Clock: draw whenever an opponent misses a turn. */
  onOpponentSkipped(ctx, params) {
    if (!hookIs(params, 'onOpponentSkipped')) return;
    drawToHand(needDuel(ctx), num(params.amount, 1), ctx.rng);
  },
};

/** Mainspring: you don't draw on your next turns. */
const skipOwnDraw: EffectHandler = {
  onGadget(ctx, params) {
    needDuel(ctx).fx.skipOwnDraw += num(params.turns);
  },
};

/** Tourbillon: draw 2 and discard 2 each turn. */
const doubleDraw: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    duel.fx.doubleDraw = Math.max(duel.fx.doubleDraw, num(params.turns, 1));
  },
};

/** Warming Pan: more hand size this duel (with the draws it comes with). */
const handSizeNow: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    duel.rules.handSize += num(params.amount, 1);
    duel.fx.bonusHandSize += num(params.amount, 1);
  },
};

/** Turn the Tube (Kaleidoscope): keep some cards, shuffle the rest of your hand away and draw back up. */
const mulligan: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    const keep = chosenCards(ctx, duel.hand, 0, num(params.keep), 'card');
    const rest = duel.hand.filter((id) => !keep.includes(id));
    assertRule(rest.length > 0, 'Nothing to shuffle back');
    duel.hand = [...keep];
    duel.drawPile = ctx.rng.shuffle([...duel.drawPile, ...rest]);
    drawToHand(duel, rest.length, ctx.rng);
  },
};

/** Simmer (Stockpot): put cards on the bottom of your draw pile and draw that many. */
const cycleCards: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    const ids = chosenCards(ctx, duel.hand, 1, num(params.max, 1), 'card');
    duel.hand = duel.hand.filter((id) => !ids.includes(id));
    duel.drawPile.unshift(...ids);
    drawToHand(duel, ids.length, ctx.rng);
  },
};

/** Fire Up (Kitchen Range): shuffle the top of the discard pile into your draw pile. */
const discardToDrawPile: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    assertRule(duel.discard.length > 0, 'The discard pile is empty');
    const moved = duel.discard.splice(-Math.min(num(params.count, 5), duel.discard.length));
    duel.drawPile = ctx.rng.shuffle([...duel.drawPile, ...moved]);
    log(ctx.state, `You shuffle ${plural(moved.length, 'card')} from the discard pile into your draw pile.`);
  },
};

/** Bank the Fire (Firedogs): set cards aside; they don't count towards your hand and still go out with you. */
const setAside: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    const ids = chosenCards(ctx, duel.hand, 1, num(params.max, 2), 'card');
    duel.hand = duel.hand.filter((id) => !ids.includes(id));
    duel.fx.setAside.push(...ids);
    if (params.drawEach === true) drawToHand(duel, ids.length, ctx.rng);
  },
};

// ---------------------------------------------------------------------------
// Opponents
// ---------------------------------------------------------------------------

const stealCard: EffectHandler = {
  /** Snatch (Salvage Rig): take a random card, or look at some and take one. */
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    const [i] = opponentsHit(ctx, {});
    const opp = duel.opponents[i];
    assertRule(opp.hand.length > 0, `${opp.name} has no cards`);
    const look = num(params.look, 1);
    if (look <= 1) {
      const id = ctx.rng.pick(opp.hand);
      opp.hand.splice(opp.hand.indexOf(id), 1);
      duel.hand.push(id);
      log(ctx.state, `You snatch ${cardLabel(ctx.state, ctx.content, id)} from ${opp.name}.`);
      return;
    }
    const shown = look >= opp.hand.length ? [...opp.hand] : ctx.rng.sample(opp.hand, look);
    const take = Math.min(num(params.take, 1), shown.length);
    openChoice(ctx, { kind: 'pick', prompt: `Take ${plural(take, 'card')} from ${opp.name}.`, cardIds: shown, min: take, max: take }, 'stealCard', params, { opponent: i });
  },
  onChoice(ctx, _params, answer, data) {
    const duel = needDuel(ctx);
    const opp = duel.opponents[data.opponent as number];
    for (const id of answer.cardIds) {
      opp.hand.splice(opp.hand.indexOf(id), 1);
      opp.peeked = opp.peeked.filter((p) => p !== id);
      duel.hand.push(id);
    }
  },
};

/** Opponents drop cards onto the discard pile (Cuckoo, Scamper, Run Dry, Douse). */
const forceDiscard: EffectHandler = {
  onGadget(ctx, params) {
    const count = num(params.count, 1);
    if (count <= 0) return;
    const duel = needDuel(ctx);
    const hit = opponentsHit(ctx, { target: params.target ?? 'chosen' });
    if (params.choose === true) {
      const i = hit[0];
      const opp = duel.opponents[i];
      assertRule(opp.hand.length > 0, `${opp.name} has no cards`);
      const n = Math.min(count, opp.hand.length);
      openChoice(ctx, { kind: 'pick', prompt: `Choose ${plural(n, 'card')} for ${opp.name} to drop.`, cardIds: [...opp.hand], min: n, max: n }, 'forceDiscard', params, { opponent: i });
      return;
    }
    for (const i of hit) {
      const opp = duel.opponents[i];
      for (const id of ctx.rng.sample(opp.hand, Math.min(count, opp.hand.length))) opponentDrops(duel, i, id);
    }
    log(ctx.state, `${hit.map((i) => duel.opponents[i].name).join(' and ')} drop${hit.length === 1 ? 's' : ''} ${plural(count, 'card')}.`);
  },
  onChoice(ctx, _params, answer, data) {
    const duel = needDuel(ctx);
    for (const id of answer.cardIds) opponentDrops(duel, data.opponent as number, id);
  },
};

/** Clockwork Mouse, the Optics bonus: see random cards in each opponent's hand at the start of a duel. */
const peekHands: EffectHandler = {
  onRoundStart(ctx, params) {
    const duel = ctx.state.duel;
    if (!duel || ctx.state.phase !== 'duel') return;
    for (const opp of duel.opponents) {
      const unseen = opp.hand.filter((id) => !opp.peeked.includes(id));
      opp.peeked.push(...ctx.rng.sample(unseen, Math.min(num(params.cards, 1), unseen.length)));
    }
  },
};

const blockGoOut: EffectHandler = {
  /** Ring (Alarm Clock): an opponent can't go out on its next turns. */
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    const hit = opponentsHit(ctx, params);
    for (const i of hit) duel.opponents[i].noOut += num(params.turns, 1);
  },
  /** Chess Automaton: the first times an opponent would go out, it discards a random card instead. */
  onOpponentWouldGoOut(ctx, params) {
    if (!fireCapped(ctx, 'block', num(params.times, 1))) return false;
    const duel = needDuel(ctx);
    const i = ctx.info!.opponent!;
    const opp = duel.opponents[i];
    if (opp.hand.length > 0) opponentDrops(duel, i, ctx.rng.pick(opp.hand));
    log(ctx.state, `Check! ${opp.name} can't go out yet.`);
    return true;
  },
};

/** Swap Boards (Chess Automaton): swap hands with an opponent, maybe after a look. */
const swapHands: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    const [i] = opponentsHit(ctx, {});
    assertRule(duel.opponents[i].hand.length > 0, `${duel.opponents[i].name} has no cards to swap`);
    if (params.preview === true) {
      openChoice(ctx, { kind: 'confirm', prompt: `Swap hands with ${duel.opponents[i].name}? (The charge is only used if you swap.)`, cardIds: [...duel.opponents[i].hand], min: 0, max: 0 }, 'swapHands', params, { opponent: i });
      return;
    }
    swap(duel, i, num(params.skipAfter));
  },
  onChoice(ctx, params, answer, data) {
    const duel = needDuel(ctx);
    if (answer.confirm) swap(duel, data.opponent as number, num(params.skipAfter));
    else ctx.refund = true;
  },
};

function swap(duel: DuelState, i: number, skip: number) {
  const opp = duel.opponents[i];
  [duel.hand, opp.hand] = [opp.hand, duel.hand];
  opp.peeked = [];
  opp.skip += skip;
}

/** Spring the Trap (Mousetrap). */
const discardTrap: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    assertRule(!duel.fx.trap, 'A trap is already set');
    duel.fx.trap = { catches: num(params.catches, 1), victimDraws: params.victimDraws === true };
  },
};

/** Lock (Escapement), Screen (Fireguard): keep hands off the discard pile. */
const lockDiscard: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    if (num(params.turns) > 0) {
      duel.fx.lockDiscard = Math.max(duel.fx.lockDiscard, num(params.turns));
      duel.fx.lockExceptYou = params.exceptYou === true;
    }
    if (num(params.opponentTurns) > 0) {
      for (const i of opponentsHit(ctx, params)) duel.opponents[i].discardLock += num(params.opponentTurns);
    }
  },
};

/** Free It Up (Oil Can): switch off boss twists. */
const disableTwist: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    assertRule(duel.modifiers.length > 0, 'There are no twists to switch off');
    const count = Math.min(num(params.count, 1), duel.modifiers.length);
    if (count >= duel.modifiers.length) duel.modifiers = [];
    else if (params.choose === true) {
      const i = ctx.args.option ?? -1;
      assertRule(duel.modifiers[i], 'Choose a twist');
      duel.modifiers.splice(i, 1);
    } else {
      for (let k = 0; k < count; k++) duel.modifiers.splice(ctx.rng.int(0, duel.modifiers.length - 1), 1);
    }
    ctx.after.push('rules');
    log(ctx.state, 'A twist is switched off.');
  },
};

/** Smother (Fire Blanket): call the duel off. */
const endDuelDraw: EffectHandler = {
  onGadget(ctx) {
    ctx.after.push('callOff');
  },
};

/** Turn Back the Clock (Grandfather Clock): replay a lost duel. */
const replayDuel: EffectHandler = {
  places: ['duelResult'],
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    assertRule(duel.result && !duel.result.won && !duel.result.drawn, 'Use it after losing a duel');
    assertRule(!duel.fx.replayed, 'This duel has already been replayed');
    ctx.vars.replayDraws = num(params.extraDraws);
    ctx.vars.replayHand = num(params.opponentHandSize);
    ctx.after.push('replay');
  },
};

/** Set the Time (Chronometer): one of several effects, or all of them. */
const chooseOne: EffectHandler = {
  onGadget(ctx, params) {
    const options = (params.options ?? []) as EffectRef[];
    const run = (ref: EffectRef) => getHandler(ctx.registry ?? defaultEffects, ref).onGadget?.(ctx, ref.params ?? {});
    if (params.both === true) {
      for (const ref of options) run(ref);
      return;
    }
    const ref = options[ctx.args.option ?? -1];
    assertRule(ref, 'Choose an option');
    run(ref);
  },
};

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/** Solder (Soldering Iron): parts become another material, and maybe move a gauge, for this duel. */
const recastPart: EffectHandler = {
  onGadget(ctx, params) {
    const { state, content } = ctx;
    const duel = needDuel(ctx);
    const ids = chosenCards(ctx, duel.hand, 1, num(params.cards, 1), 'part');
    ids.forEach((id, k) => {
      const card = getCard(state, id);
      assertRule(card.kind === 'part', 'Choose parts');
      const material = ctx.args.materials?.[k];
      assertRule(material && content.categories.some((c) => c.id === material), 'Choose a material for each part');
      const shift = ctx.args.values?.[k] ?? 0;
      assertRule(Math.abs(shift) <= num(params.gaugeShift), shift === 0 ? '' : `Move a number by at most ${num(params.gaugeShift)}`);
      const gauge = (duel.fx.shifted[id]?.gauge ?? card.gauge) + shift;
      assertRule(gauge >= state.config.gaugeMin && gauge <= state.config.gaugeMax, `Numbers stay within ${state.config.gaugeMin} to ${state.config.gaugeMax}`);
      duel.fx.shifted[id] = { ...duel.fx.shifted[id], category: material, gauge };
    });
  },
};

/** Shift Gear (Gearbox): parts count as a different gauge for this duel. */
const shiftGauge: EffectHandler = {
  onGadget(ctx, params) {
    const { state } = ctx;
    const duel = needDuel(ctx);
    const ids = chosenCards(ctx, duel.hand, 1, num(params.parts, 1), 'part');
    ids.forEach((id, k) => {
      const card = getCard(state, id);
      assertRule(card.kind === 'part', 'Choose parts');
      const shift = ctx.args.values?.[k] ?? 0;
      assertRule(shift !== 0 && Math.abs(shift) <= num(params.maxShift, 1), `Move each number by 1${num(params.maxShift, 1) > 1 ? ` to ${num(params.maxShift, 1)}` : ''}`);
      const gauge = (duel.fx.shifted[id]?.gauge ?? card.gauge) + shift;
      assertRule(gauge >= state.config.gaugeMin && gauge <= state.config.gaugeMax, `Numbers stay within ${state.config.gaugeMin} to ${state.config.gaugeMax}`);
      duel.fx.shifted[id] = { ...duel.fx.shifted[id], gauge };
    });
  },
};

/** Swap a card in your hand with one near the top of the discard pile (Toasting Fork). */
const swapWithDiscard: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    assertRule(duel.discard.length > 0, 'The discard pile is empty');
    const mine = chosenCards(ctx, duel.hand, 1, num(params.swaps, 1), 'card');
    const depth = Math.min(num(params.depth, 1), duel.discard.length);
    const reach = duel.discard.slice(-depth).reverse();
    if (depth === 1) {
      swapOne(duel, mine[0], reach[0]);
      return;
    }
    const n = Math.min(mine.length, reach.length);
    openChoice(ctx, { kind: 'pick', prompt: `Choose ${plural(n, 'card')} to take in exchange.`, cardIds: reach, min: n, max: n }, 'swapWithDiscard', params, { mine });
  },
  onChoice(ctx, _params, answer, data) {
    const duel = needDuel(ctx);
    const mine = data.mine as CardId[];
    answer.cardIds.forEach((theirs, k) => swapOne(duel, mine[k], theirs));
  },
};

function swapOne(duel: DuelState, mine: CardId, theirs: CardId) {
  const at = duel.discard.indexOf(theirs);
  duel.hand.splice(duel.hand.indexOf(mine), 1, theirs);
  duel.discard.splice(at, 1, mine);
  duel.fx.fromDiscard.push(theirs);
  duel.fx.yourDiscards.push(mine);
}

// ---------------------------------------------------------------------------
// Gadgets and charges, the map and shops
// ---------------------------------------------------------------------------

/** Align the Planets (Orrery): restore charges to your other gadgets. */
const restoreCharges: EffectHandler = {
  places: ['duel', 'map'],
  onGadget(ctx, params) {
    const { content, player, state } = ctx;
    const mine = itemDef(content, ctx.item.itemId).collection;
    let restored = 0;
    for (const it of player.items) {
      if (it.uid === ctx.item.uid) continue;
      const max = maxCharges(content, state.config, it, player);
      if (max === null) continue;
      const add = content.items.find((d) => d.id === it.itemId)?.collection === mine ? num(params.collection) : num(params.other);
      const before = it.charges ?? 0;
      it.charges = Math.min(max, before + add);
      restored += it.charges - before;
    }
    assertRule(restored > 0, 'Your other gadgets are already charged');
    log(state, `${plural(restored, 'charge')} restored.`);
  },
};

/** Hold the Heat (Brass Fender): gadget uses that don't spend a charge. */
const freeGadgetUses: EffectHandler = {
  onGadget(ctx, params) {
    const duel = needDuel(ctx);
    duel.fx.freeUses = { count: num(params.count, 1), collection: String(params.collection ?? 'any'), sourceUid: ctx.item.uid };
  },
};

/** Reroute (Pocket Compass): the next move can go to any stop in the next rows. */
const reroute: EffectHandler = {
  places: ['map'],
  onGadget(ctx, params) {
    assertRule(ctx.state.map, 'Use it on the map');
    ctx.state.map.reroute = Math.max(ctx.state.map.reroute, num(params.rows, 1));
  },
};

/** Haggle (Abacus): money off in this shop. */
const shopDiscount: EffectHandler = {
  places: ['shop'],
  onGadget(ctx, params) {
    assertRule(ctx.state.shop, 'Use it in a shop');
    ctx.state.shop.discount = { amount: num(params.amount, 1), wholeVisit: params.wholeVisit === true };
  },
};

// --- Battle effects --------------------------------------------------------

/** `amount` plus `perLevel` for each item level above 1. */
function scaled(params: Params, level: number): number {
  return num(params.amount) + num(params.perLevel) * Math.max(0, level - 1);
}

function targetEnemy(ctx: BattleEffectContext) {
  const chosen = ctx.target !== undefined ? ctx.battle.enemies[ctx.target] : undefined;
  if (chosen && chosen.hp > 0) return chosen;
  return livingEnemies(ctx.battle)[0];
}

const damage: EffectHandler = {
  onBattlePlay(ctx, params) {
    for (let i = 0; i < num(params.hits, 1); i++) {
      const enemy = targetEnemy(ctx);
      if (!enemy) return;
      damageEnemy(enemy, scaled(params, ctx.level));
    }
  },
};

const damageAll: EffectHandler = {
  onBattlePlay(ctx, params) {
    for (const enemy of livingEnemies(ctx.battle)) damageEnemy(enemy, scaled(params, ctx.level));
  },
};

const block: EffectHandler = {
  onBattlePlay(ctx, params) {
    ctx.battle.block += scaled(params, ctx.level);
  },
};

const drawCards: EffectHandler = {
  onBattlePlay(ctx, params) {
    drawBattleCards(ctx.battle, scaled(params, ctx.level), ctx.rng);
  },
};

const energy: EffectHandler = {
  onBattlePlay(ctx, params) {
    ctx.battle.energy += scaled(params, ctx.level);
  },
};

const heal: EffectHandler = {
  onBattlePlay(ctx, params) {
    ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + scaled(params, ctx.level));
  },
};

export const defaultEffects: EffectRegistry = {
  // Duels: turns, draws, opponents
  skipTurn,
  revealHands,
  extraDraws,
  drawExtra,
  skipOwnDraw,
  doubleDraw,
  handSizeNow,
  mulligan,
  cycleCards,
  discardToDrawPile,
  setAside,
  stealCard,
  forceDiscard,
  peekHands,
  blockGoOut,
  swapHands,
  discardTrap,
  lockDiscard,
  disableTwist,
  endDuelDraw,
  replayDuel,
  chooseOne,
  recastPart,
  shiftGauge,
  swapWithDiscard,
  clearDiscard,
  // Stakes, credits and the pot
  raiseStakes,
  growPot,
  gainCurrency,
  insureStake,
  insureDuel,
  spareLife,
  keepStake,
  keepFromDiscard,
  // Lots and the scrapbook
  lotInsight,
  lotBonus,
  extraPieces,
  checkParcel: checkParcelEffect,
  unwrapParcels,
  extraPick,
  doublePieces,
  movePieces,
  deckToPage,
  // Charges, the map and shops
  restoreCharges,
  freeGadgetUses,
  reroute,
  shopDiscount,
  // Static bonuses
  appraiseDiscount,
  shopExtraTools,
  sellBonus,
  chargeBonus,
  rechargeDiscount,
  restRecharges,
  revealBossTwists,
  twistResist,
  // Card battles
  damage,
  damageAll,
  block,
  draw: drawCards,
  energy,
  heal,
  // Specials, services and rules
  drawChoice,
  reorderTop,
  takeFromDiscard,
  destroyCard: destroyCardEffect,
  addRandomParts,
  meldRole,
  modifyRules,
  adaptorBoost,
  banCategory,
  grantTempCard,
};

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

export function getHandler(registry: EffectRegistry, ref: EffectRef): EffectHandler {
  const h = registry[ref.type];
  if (!h) throw new Error(`Unknown effect type "${ref.type}"`);
  return h;
}

/** Run a context hook for each effect ref, in order (item effects run as their item). */
export function runHook(
  registry: EffectRegistry,
  hook: ContextHook,
  refs: EffectRef[],
  ctx: EffectContext,
  paramOverrides?: Params,
): void {
  for (const ref of refs) {
    const fn = getHandler(registry, ref)[hook];
    if (fn) fn({ ...ctx, itemUid: (ref as ActiveEffect).itemUid, registry }, { ...(ref.params ?? {}), ...(paramOverrides ?? {}) });
  }
}

/** Ask every effect whether an opponent's going out is stopped (Chess Automaton). */
export function blocksGoingOut(registry: EffectRegistry, refs: EffectRef[], ctx: EffectContext): boolean {
  for (const ref of refs) {
    const fn = getHandler(registry, ref).onOpponentWouldGoOut;
    if (fn && fn({ ...ctx, itemUid: (ref as ActiveEffect).itemUid, registry }, ref.params ?? {})) return true;
  }
  return false;
}

export function applyRuleModifiers(
  registry: EffectRegistry,
  rules: RoundRules,
  refs: EffectRef[],
  paramOverrides?: Params,
): void {
  for (const ref of refs) {
    getHandler(registry, ref).modifyRules?.(rules, { ...(ref.params ?? {}), ...(paramOverrides ?? {}) });
  }
}

/** Turn a card into a meld token, or null if it can't be used in melds. Parts changed for the duel use their new values. */
export function cardToken(state: GameState, content: ContentPack, registry: EffectRegistry, id: CardId): MeldToken | null {
  const card = getCard(state, id);
  if (card.kind === 'part') {
    const shifted = state.duel?.fx?.shifted[id];
    return { role: 'natural', id, category: shifted?.category ?? card.category, gauge: shifted?.gauge ?? card.gauge };
  }
  const def = content.specials.find((s) => s.id === card.specialId);
  for (const ref of def?.effects ?? []) {
    const role = getHandler(registry, ref).meldRole?.(ref.params ?? {});
    if (role) return (role.role === 'wild' && card.natural ? { ...role, natural: true, id } : { ...role, id }) as MeldToken;
  }
  return null;
}

/**
 * Rummy duels: the battle layer in the 'rummy' battle style.
 *
 * You and one or more opponents (minions, an elite or a boss) each stake
 * parts into a pot, then race to complete the same small blueprint. You draw
 * from your own parts deck, they draw from theirs, and everyone shares one
 * discard pile. The first to go out takes the whole pot. If your draws run
 * out first, the closest hand wins. Losing costs your stake (and a life,
 * against a boss).
 *
 * A turn: you draw (from your pile or the discard pile), may use gadgets,
 * then discard; then every opponent takes a turn. Your draw limit is how
 * many turns you get. Items help in two ways: their passives adjust the
 * duel's rules and react to what happens (see the duel events in
 * effects.ts), and gadgets are used for a charge. Charges do not refill
 * between fights. Some gadgets show you cards first and wait for a choice.
 */

import { perTier } from '../config';
import {
  type ChoiceAnswer,
  type EffectContext,
  type EffectRegistry,
  type GadgetContext,
  applyRuleModifiers,
  blocksGoingOut,
  cardToken,
  getHandler,
  runHook,
} from './effects';
import { addDraws, freshFx, minionOf, takeFrom } from './duelZones';
import { type ActiveEffect, conditionHolds, gadgetAt, itemEffects, maxCharges, situationOf } from './items';
import { type MeldRules, type MeldToken, checkBuild, findBuild, handProgress } from './melds';
import { commonCategories, randomCategory } from './quality';
import { makeLot, makeStakeRule, stakeProblem } from './scrapbook';
import { Rng } from './rng';
import type {
  BossState,
  CardId,
  Condition,
  ContentPack,
  DuelKind,
  DuelOpponent,
  DuelState,
  DuelTargetDef,
  Encounter,
  GadgetArgs,
  GameState,
  MapNode,
  MinionDef,
  Place,
  PlayerState,
  RewardOption,
  RoundRules,
} from './types';
import { addToDeck, assertRule, cardLabel, createPart, createSpecial, destroyCard, log } from './zones';

const actFits = (act: number, d: { minAct?: number; maxAct?: number }) =>
  (d.minAct ?? 1) <= act && (d.maxAct ?? Infinity) >= act;

function minionKind(kind: DuelKind): MinionDef['kind'] {
  return kind === 'battle' ? 'normal' : kind;
}

function randomFromDeck(def: MinionDef | undefined, content: ContentPack, state: GameState, rng: Rng): RewardOption {
  const category = def?.deck.categories ? rng.pick(def.deck.categories) : randomCategory(content, rng).id;
  const [lo, hi] = def?.deck.gauges ?? [state.config.gaugeMin, state.config.gaugeMax];
  return { kind: 'part', category, gauge: rng.int(lo, hi) };
}

/**
 * Pick who you'll face at a map stop and what they stake. Shown on the map.
 * With the effect registry, a boss's twists are rolled now too, so items
 * can show them on the map (Oil Can).
 */
export function makeEncounter(state: GameState, content: ContentPack, kind: DuelKind, rng: Rng, effects?: EffectRegistry): Encounter {
  const act = state.tier + 1;
  const want = minionKind(kind);
  let pool = content.minions.filter((m) => m.kind === want && actFits(act, m));
  if (pool.length === 0) pool = content.minions.filter((m) => m.kind === want);
  assertRule(pool.length > 0, `No ${want} minions in the content`);
  const [lo, hi] = state.config.duel.minionsPerBattle;
  const count = kind === 'battle' ? rng.int(lo, hi) : 1;
  const minions = Array.from({ length: count }, () => rng.pick(pool));
  const twists = kind === 'boss' && effects ? rollTwists(state, content, effects, rng) : undefined;
  if (state.config.itemSource === 'scrapbook') {
    // Matched stakes: every minion puts in the same number of parts of the same material.
    const stakeRule = makeStakeRule(state, content, kind, Math.max(...minions.map((m) => m.stakes)), rng);
    const stakes: RewardOption[] = [];
    for (const m of minions) {
      const [lo, hi] = m.deck.gauges;
      for (let i = 0; i < stakeRule.count; i++) stakes.push({ kind: 'part', category: stakeRule.category, gauge: rng.int(lo, Math.min(hi, 10)) });
    }
    return { minions: minions.map((m) => m.id), stakes, stakeRule, lot: makeLot(state, content, kind, rng), ...(twists ? { twists } : {}) };
  }
  const stakes: RewardOption[] = [];
  for (const m of minions) {
    for (let i = 0; i < m.stakes; i++) stakes.push(randomFromDeck(m, content, state, rng));
  }
  // Bosses always put a special card in the pot.
  if (kind === 'boss' && content.specials.length > 0) {
    stakes[stakes.length - 1] = { kind: 'special', specialId: rng.weightedPick(content.specials, (s) => s.weight).id };
  }
  return { minions: minions.map((m) => m.id), stakes, ...(twists ? { twists } : {}) };
}

function rollTwists(state: GameState, content: ContentPack, effects: EffectRegistry, rng: Rng): BossState[] {
  const twists = content.bossModifiers.filter((m) => (m.minTier ?? 1) <= state.tier + 1);
  return rng.sample(twists, state.config.duel.bossTwists).map((m) => resolveModifier(content, effects, m.id, rng));
}

function pickTarget(content: ContentPack, kind: DuelKind, act: number, rng: Rng): DuelTargetDef {
  const want = minionKind(kind);
  let pool = content.duelTargets.filter((t) => t.kind === want && actFits(act, t));
  if (pool.length === 0) pool = content.duelTargets.filter((t) => t.kind === want);
  assertRule(pool.length > 0, `No ${want} duel targets in the content`);
  return rng.pick(pool);
}

/** Rule defaults for the item-driven parts of RoundRules. */
export function itemRuleDefaults(): Pick<
  RoundRules,
  | 'wrapRuns'
  | 'adaptorBoth'
  | 'adaptorShift'
  | 'seeOwnTop'
  | 'seeDiscard'
  | 'protectDiscardTurns'
  | 'stakeGrace'
  | 'seeOpponentProgress'
  | 'freeDiscardDraws'
  | 'takeAnyDiscard'
  | 'extraDiscards'
  | 'opponentDiscardDraw'
  | 'opponentHandSize'
> {
  return {
    wrapRuns: false,
    adaptorBoth: false,
    adaptorShift: 1,
    seeOwnTop: 0,
    seeDiscard: 0,
    protectDiscardTurns: 0,
    stakeGrace: 0,
    seeOpponentProgress: false,
    freeDiscardDraws: 0,
    takeAnyDiscard: 0,
    extraDiscards: 0,
    opponentDiscardDraw: true,
    opponentHandSize: 0,
  };
}

/**
 * The duel's rules: the act's hand size and the draw limit, then the
 * twists (softened by items like the Tinderbox), then your items'
 * passives that fit this duel.
 */
export function duelRules(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  modifiers: BossState[],
  duel: Pick<DuelState, 'kind' | 'opponents'>,
): RoundRules {
  const cfg = state.config;
  const rules: RoundRules = {
    handSize: perTier(cfg.duel.handSizeByAct, state.tier),
    drawLimit: cfg.duel.drawLimit,
    allowDiscardDraw: true,
    disabledMeldRoles: [],
    bannedCategories: [],
    revealHidden: true,
    gaugeMin: cfg.gaugeMin,
    gaugeMax: cfg.gaugeMax,
    requireNaturalInMeld: cfg.requireNaturalInMeld,
    ...itemRuleDefaults(),
  };
  const passives = itemEffects(state, content, player, { duel });
  const resist = { drawLimit: 0, handSize: 0 };
  for (const e of passives.filter((x) => x.type === 'twistResist')) {
    resist.drawLimit += Number(e.params.drawLimit ?? 0);
    resist.handSize += Number(e.params.handSize ?? 0);
  }
  for (const m of modifiers) {
    const def = content.bossModifiers.find((b) => b.id === m.modifierId);
    if (!def) continue;
    const before = { drawLimit: rules.drawLimit, handSize: rules.handSize };
    applyRuleModifiers(effects, rules, def.effects, m.params);
    for (const k of ['drawLimit', 'handSize'] as const) {
      const cut = before[k] - rules[k];
      if (cut <= 0) continue;
      const back = Math.min(cut, resist[k]);
      rules[k] += back;
      resist[k] -= back;
    }
  }
  applyRuleModifiers(effects, rules, passives);
  rules.handSize = Math.max(1, rules.handSize);
  rules.drawLimit = Math.max(1, rules.drawLimit);
  return rules;
}

export function meldRulesOf(r: RoundRules): MeldRules {
  return {
    gaugeMin: r.gaugeMin,
    gaugeMax: r.gaugeMax,
    disabledMeldRoles: r.disabledMeldRoles,
    bannedCategories: r.bannedCategories,
    requireNaturalInMeld: r.requireNaturalInMeld,
    wrapRuns: r.wrapRuns,
    adaptorBoth: r.adaptorBoth,
    adaptorShift: r.adaptorShift,
  };
}

function resolveModifier(content: ContentPack, effects: EffectRegistry, id: string, rng: Rng): BossState {
  const def = content.bossModifiers.find((m) => m.id === id);
  let params: Record<string, unknown> = {};
  for (const ref of def?.effects ?? []) {
    const h = getHandler(effects, ref);
    if (h.resolveParams) params = { ...params, ...h.resolveParams(ref.params ?? {}, rng, content) };
  }
  return { modifierId: id, params };
}

function makeOpponents(state: GameState, content: ContentPack, player: PlayerState, minionIds: string[], rng: Rng): DuelOpponent[] {
  return minionIds.map((id) => {
    const def = content.minions.find((m) => m.id === id)!;
    const cats = def.deck.categories ?? commonCategories(content).map((c) => c.id);
    const deck: CardId[] = [];
    for (const c of cats) {
      for (let g = def.deck.gauges[0]; g <= def.deck.gauges[1]; g++) {
        for (let k = 0; k < def.deck.copies; k++) deck.push(createPart(state, content, player.id, c, g, true).id);
      }
    }
    return { defId: def.id, name: def.name, hand: [], drawPile: rng.shuffle(deck), skip: 0, noOut: 0, discardLock: 0, revealed: false, peeked: [], lastAction: '' };
  });
}

/** Enter a duel stop: set up opponents and the pot, then wait for the player's stake. */
export function startDuel(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  node: MapNode,
  rng: Rng,
): void {
  const kind = node.type as DuelKind;
  const encounter = node.encounter ?? makeEncounter(state, content, kind, rng, effects);
  const target = pickTarget(content, kind, state.tier + 1, rng);
  const modifiers: BossState[] = kind === 'boss' ? structuredClone(encounter.twists ?? rollTwists(state, content, effects, rng)) : [];

  const pot = encounter.stakes.map((o) =>
    o.kind === 'part'
      ? createPart(state, content, player.id, o.category!, o.gauge!, true).id
      : createSpecial(state, player.id, o.specialId!, true).id,
  );
  const opponents = makeOpponents(state, content, player, encounter.minions, rng);

  state.duel = {
    kind,
    nodeId: node.id,
    targetId: target.id,
    requirements: target.requirements,
    modifiers,
    rules: duelRules(state, content, effects, player, modifiers, { kind, opponents }),
    pot,
    playerStake: [],
    stakeRule: encounter.stakeRule ?? null,
    lot: encounter.lot ? structuredClone(encounter.lot) : null,
    opponents,
    hand: [],
    drawPile: [],
    discard: [],
    turnPhase: 'draw',
    drawsTaken: 0,
    turn: 0,
    choice: null,
    fx: freshFx(),
    winner: null,
    endReason: null,
    winningMelds: null,
    result: null,
  };
  state.phase = 'duelAnte';
  log(state, `${kind === 'boss' ? 'Boss duel' : kind === 'elite' ? 'Elite duel' : 'Duel'} against ${opponents.map((o) => o.name).join(' and ')}: ${target.name}.`);
}

/**
 * The player stakes from their parts deck (matched stakes: the same number
 * of parts of the same material or better; otherwise any one card). Hands
 * are dealt and play starts.
 */
export function placeStake(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  cardIds: CardId[],
  rng: Rng,
): void {
  const duel = state.duel!;
  assertRule(state.phase === 'duelAnte', 'The stakes are already down');
  if (duel.stakeRule) {
    const problem = stakeProblem(state, content, player, duel.stakeRule, cardIds, duel.kind === 'boss');
    assertRule(!problem, problem ?? '');
  } else {
    assertRule(cardIds.length === 1, 'Stake one card');
    assertRule(player.deck.includes(cardIds[0]), 'Stake a card from your parts deck');
  }
  duel.playerStake = [...cardIds];
  duel.pot.push(...cardIds);
  deal(state, content, effects, player, 0, rng);
  log(state, `You stake ${cardIds.map((id) => cardLabel(state, content, id)).join(', ')}. The pot holds ${duel.pot.length} cards.`);
}

/** Shuffle, deal every hand, flip the first discard and start your first turn. */
function deal(state: GameState, content: ContentPack, effects: EffectRegistry, player: PlayerState, opponentHandMod: number, rng: Rng): void {
  const duel = state.duel!;
  duel.drawPile = rng.shuffle(player.deck.filter((id) => !duel.playerStake.includes(id)));
  const n = duel.rules.handSize;
  for (let i = 0; i < n; i++) {
    const id = duel.drawPile.pop();
    if (id) duel.hand.push(id);
  }
  const theirs = Math.max(1, perTier(state.config.duel.handSizeByAct, state.tier) + duel.rules.opponentHandSize + opponentHandMod);
  for (const opp of duel.opponents) {
    for (let i = 0; i < theirs; i++) {
      const id = opp.drawPile.pop();
      if (id) opp.hand.push(id);
    }
  }
  const first = duel.opponents[0]?.drawPile.pop();
  if (first) duel.discard.push(first);
  state.phase = 'duel';
  // Item passives that hand you a card at the start of a round do so in duels too.
  runHook(effects, 'onRoundStart', itemEffects(state, content, player), { state, content, rng, player, duel });
  beginTurn(state, content, effects, player, rng);
}

/** Leave a duel stop without staking anything (not possible at the boss). */
export function walkAway(state: GameState): void {
  const duel = state.duel;
  assertRule(state.phase === 'duelAnte' && duel, 'You can only walk away before staking');
  assertRule(duel.kind !== 'boss', "You can't walk away from the boss");
  for (const id of Object.keys(state.cards)) {
    if (state.cards[id].temporary) delete state.cards[id];
  }
  state.duel = null;
  state.phase = 'map';
  log(state, 'You walk away from the lot.');
}

function activeDuel(state: GameState): DuelState {
  assertRule(state.phase === 'duel' && state.duel && state.duel.winner === null, 'No duel in progress');
  assertRule(!state.duel.choice, 'Make your choice first');
  return state.duel;
}

function duelCtx(state: GameState, content: ContentPack, player: PlayerState, rng: Rng, extra: Partial<EffectContext> = {}): EffectContext {
  return { state, content, rng, player, duel: state.duel, ...extra };
}

/** Your turn begins: count it, let passives react, and work out whether you draw. */
function beginTurn(state: GameState, content: ContentPack, effects: EffectRegistry, player: PlayerState, rng: Rng): void {
  const duel = state.duel!;
  duel.turn += 1;
  const double = duel.fx.doubleDraw > 0;
  if (double) duel.fx.doubleDraw -= 1;
  duel.fx.drawsDue = double ? 2 : 1;
  duel.fx.discardsDue = double ? 2 : 1;
  duel.fx.drawsThisTurn = 0;
  duel.turnPhase = 'draw';
  runHook(effects, 'onTurnStart', itemEffects(state, content, player), duelCtx(state, content, player, rng));
  if (duel.fx.skipOwnDraw > 0) {
    // Mainspring: no draw this turn, but it still uses one.
    duel.fx.skipOwnDraw -= 1;
    duel.drawsTaken += 1;
    duel.turnPhase = 'main';
    log(state, "You don't draw this turn.");
  }
}

export function duelDraw(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  source: 'deck' | 'discard',
  cardId: CardId | undefined,
  rng: Rng,
): void {
  const duel = activeDuel(state);
  assertRule(duel.turnPhase === 'draw', 'You have already drawn this turn');
  const first = duel.fx.drawsThisTurn === 0;
  assertRule(!first || duel.drawsTaken < duel.rules.drawLimit, 'No draws left');
  let free = false;
  if (source === 'discard') {
    assertRule(duel.rules.allowDiscardDraw, 'Discard pile draws are not allowed in this fight');
    assertRule(!(duel.fx.lockDiscard > 0 && !duel.fx.lockExceptYou), 'The discard pile is locked');
    const top = duel.discard.at(-1);
    assertRule(top, 'The discard pile is empty');
    const id = cardId ?? top;
    assertRule(duel.discard.includes(id), 'That card is not in the discard pile');
    if (id !== top) {
      assertRule(duel.fx.takeAnyUsed < duel.rules.takeAnyDiscard, 'You can only take the top card of the discard pile');
      duel.fx.takeAnyUsed += 1;
    }
    duel.discard.splice(duel.discard.indexOf(id), 1);
    duel.hand.push(id);
    duel.fx.fromDiscard.push(id);
    if (duel.fx.freeDiscardUsed < duel.rules.freeDiscardDraws) {
      duel.fx.freeDiscardUsed += 1;
      free = true;
    }
    log(state, `You take ${cardLabel(state, content, id)} from the discard pile${free ? ' (a free draw)' : ''}.`);
  } else {
    const id = takeFrom(duel.drawPile, duel.discard, rng);
    if (id) {
      duel.hand.push(id);
      duel.fx.deckDraws += 1;
      runHook(effects, 'onDuelDraw', itemEffects(state, content, player), duelCtx(state, content, player, rng, { info: { drawn: id } }));
    }
  }
  // A Tourbillon turn's second draw doesn't use another one.
  if (first && !free) duel.drawsTaken += 1;
  duel.fx.drawsThisTurn += 1;
  if (duel.fx.drawsThisTurn >= duel.fx.drawsDue) duel.turnPhase = 'main';
}

/** Firedogs: discard an extra card and draw a replacement (it doesn't use a draw). */
export function duelCycle(state: GameState, content: ContentPack, cardId: CardId, rng: Rng): void {
  const duel = activeDuel(state);
  assertRule(duel.turnPhase === 'main', 'Draw a card first');
  assertRule(duel.fx.extraDiscardsUsed < duel.rules.extraDiscards, 'You have no extra discards left this duel');
  assertRule(duel.hand.includes(cardId), 'That card is not in your hand');
  duel.hand.splice(duel.hand.indexOf(cardId), 1);
  duel.discard.push(cardId);
  duel.fx.yourDiscards.push(cardId);
  duel.fx.extraDiscardsUsed += 1;
  const id = takeFrom(duel.drawPile, duel.discard, rng);
  if (id) duel.hand.push(id);
  log(state, `You swap ${cardLabel(state, content, cardId)} for a fresh card.`);
}

function tokensOf(state: GameState, content: ContentPack, effects: EffectRegistry, ids: CardId[]): MeldToken[] {
  return ids.map((id) => cardToken(state, content, effects, id)).filter((t): t is MeldToken => !!t);
}

function progressOf(state: GameState, content: ContentPack, effects: EffectRegistry, duel: DuelState, ids: CardId[]): number {
  return handProgress(
    tokensOf(state, content, effects, ids),
    duel.requirements,
    duel.rules.gaugeMin,
    duel.rules.gaugeMax,
    duel.rules.bannedCategories,
  );
}

/** Cards an opponent still needs to go out (for the Chronometer). */
export function cardsStillNeeded(state: GameState, content: ContentPack, effects: EffectRegistry, ids: CardId[]): number {
  const duel = state.duel;
  if (!duel) return 0;
  const total = duel.requirements.reduce((n, r) => n + r.size, 0);
  return Math.max(0, total - progressOf(state, content, effects, duel, ids));
}

/** A way for some cards to complete the duel's target, or null. */
export function findDuelOut(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  cardIds: CardId[],
  useAll = false,
): CardId[][] | null {
  const duel = state.duel;
  if (!duel) return null;
  const units = cardIds
    .map((id) => cardToken(state, content, effects, id))
    .filter((t): t is MeldToken => !!t)
    .map((t) => ({ tokens: [t] }));
  return findBuild(units, duel.requirements, meldRulesOf(duel.rules), useAll);
}

/** Your way out, if any: set-aside cards (Firedogs) must all be used. */
export function suggestPlayerOut(state: GameState, content: ContentPack, effects: EffectRegistry, cardIds?: CardId[]): CardId[][] | null {
  const duel = state.duel;
  if (!duel) return null;
  const aside = duel.fx.setAside;
  const out = findDuelOut(state, content, effects, [...(cardIds ?? duel.hand), ...aside], cardIds !== undefined || aside.length > 0);
  if (!out) return null;
  return aside.every((id) => out.flat().includes(id)) ? out : null;
}

export function duelGoOut(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  groups: CardId[][],
): void {
  const duel = activeDuel(state);
  const used = groups.flat();
  for (const id of used) assertRule(duel.hand.includes(id) || duel.fx.setAside.includes(id), `${cardLabel(state, content, id)} is not in your hand`);
  assertRule(duel.fx.setAside.every((id) => used.includes(id)), 'Your set-aside cards must go out with you');
  const tokens = groups.map((g) =>
    g.map((id) => {
      const t = cardToken(state, content, effects, id);
      assertRule(t, `${cardLabel(state, content, id)} cannot be used in a meld`);
      return t;
    }),
  );
  const check = checkBuild(tokens, duel.requirements, meldRulesOf(duel.rules));
  assertRule(check.ok, check.reason ?? 'Those melds do not complete the target');
  endDuel(state, content, effects, player, 'player', 'You went out first!', groups);
}

/** The player discards; once every discard due is made, every opponent takes a turn. */
export function duelDiscard(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  cardId: CardId,
  rng: Rng,
): void {
  const duel = activeDuel(state);
  assertRule(duel.turnPhase === 'main', 'Draw a card first');
  assertRule(duel.hand.includes(cardId), 'That card is not in your hand');
  duel.hand.splice(duel.hand.indexOf(cardId), 1);
  duel.discard.push(cardId);
  duel.fx.yourDiscards.push(cardId);
  duel.fx.protectedCard = duel.turn <= duel.rules.protectDiscardTurns ? cardId : null;
  duel.fx.discardsDue -= 1;
  if (duel.fx.discardsDue > 0 && duel.hand.length > 0) return;

  for (let i = 0; i < duel.opponents.length; i++) {
    opponentTurn(state, content, effects, player, i, rng);
    if (duel.winner !== null) return;
  }
  if (duel.fx.lockDiscard > 0) duel.fx.lockDiscard -= 1;
  duel.fx.protectedCard = null;

  if (duel.drawsTaken >= duel.rules.drawLimit) {
    showdown(state, content, effects, player);
    return;
  }
  beginTurn(state, content, effects, player, rng);
}

function opponentTurn(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  index: number,
  rng: Rng,
): void {
  const duel = state.duel!;
  const opp = duel.opponents[index];
  const def = minionOf(content, opp);
  const passives = () => itemEffects(state, content, player);
  const ctx = (extra: Partial<EffectContext> = {}) => duelCtx(state, content, player, rng, { info: { opponent: index }, ...extra });
  if (opp.skip > 0) {
    opp.skip -= 1;
    opp.lastAction = 'Frozen: missed a turn.';
    runHook(effects, 'onOpponentSkipped', passives(), ctx());
    return;
  }
  const prog = (ids: CardId[]) => progressOf(state, content, effects, duel, ids);

  // Draw: take the discard if it improves the hand (greedy minions take it if it doesn't hurt).
  const top = duel.discard.at(-1);
  const isBoss = def?.kind === 'boss';
  const canTake =
    !!top &&
    duel.rules.allowDiscardDraw &&
    duel.rules.opponentDiscardDraw &&
    duel.fx.lockDiscard === 0 &&
    opp.discardLock === 0 &&
    !(duel.fx.protectedCard === top && !isBoss);
  let tookDiscard = false;
  if (canTake && opp.hand.length > 0) {
    const now = prog(opp.hand);
    const withTop = Math.max(...opp.hand.map((d) => prog([...opp.hand.filter((h) => h !== d), top!])));
    tookDiscard = def?.greedy ? withTop >= now && withTop > 0 : withTop > now;
  }
  let drawn: CardId | null = null;
  let action: string;
  if (tookDiscard && duel.fx.trap) {
    // Mousetrap: the card comes to you instead.
    const caught = duel.discard.pop()!;
    duel.hand.push(caught);
    duel.fx.fromDiscard.push(caught);
    const trap = duel.fx.trap;
    trap.catches -= 1;
    if (trap.catches <= 0) duel.fx.trap = null;
    log(state, `Snap! ${opp.name} reaches for ${cardLabel(state, content, caught)} and you catch it.`);
    if (trap.victimDraws) drawn = takeFrom(opp.drawPile, duel.discard, rng);
    action = 'Caught in your trap';
    tookDiscard = false;
  } else if (tookDiscard) {
    drawn = duel.discard.pop()!;
    action = `Took ${cardLabel(state, content, drawn)} from the discard pile`;
    runHook(effects, 'onOpponentTake', passives(), ctx({ info: { opponent: index, cardId: drawn, yours: duel.fx.yourDiscards.includes(drawn) } }));
  } else {
    drawn = takeFrom(opp.drawPile, duel.discard, rng);
    action = 'Drew a card';
  }
  if (drawn) opp.hand.push(drawn);
  else if (action === 'Drew a card') action = 'Had nothing to draw';

  const out = opp.noOut > 0 ? null : findDuelOut(state, content, effects, opp.hand);
  let blocked = false;
  if (out) {
    if (blocksGoingOut(effects, passives(), ctx())) {
      blocked = true;
    } else {
      endDuel(state, content, effects, player, index, `${opp.name} went out.`, out);
      return;
    }
  }

  // Discard the card whose loss hurts least (prefer shedding high numbers). A blocked opponent already dropped one.
  let discarded = '';
  if (!blocked && opp.hand.length > 0) {
    let worst = opp.hand[0];
    let bestScore = -Infinity;
    for (const id of opp.hand) {
      if (tookDiscard && id === drawn) continue;
      const card = state.cards[id];
      const score = prog(opp.hand.filter((h) => h !== id)) * 100 + (card?.kind === 'part' ? card.gauge : 0);
      if (score > bestScore) {
        bestScore = score;
        worst = id;
      }
    }
    opp.hand.splice(opp.hand.indexOf(worst), 1);
    opp.peeked = opp.peeked.filter((p) => p !== worst);
    duel.discard.push(worst);
    discarded = `, discarded ${cardLabel(state, content, worst)}`;
  }
  opp.lastAction = `${action}${blocked ? ', but was stopped from going out' : discarded}.`;
  if (opp.noOut > 0) opp.noOut -= 1;
  if (opp.discardLock > 0) opp.discardLock -= 1;

  // First time an opponent is 1 card away (Chronometer).
  const nearKey = `near:${index}`;
  if (!duel.fx.fired[nearKey] && cardsStillNeeded(state, content, effects, opp.hand) <= 1) {
    duel.fx.fired[nearKey] = 1;
    runHook(effects, 'onOpponentNearOut', passives(), ctx());
  }
}

function showdown(state: GameState, content: ContentPack, effects: EffectRegistry, player: PlayerState): void {
  const duel = state.duel!;
  const mine = progressOf(state, content, effects, duel, [...duel.hand, ...duel.fx.setAside]);
  const best = duel.opponents
    .map((o, i) => ({ i, p: progressOf(state, content, effects, duel, o.hand) }))
    .sort((a, b) => b.p - a.p)[0];
  if (!best || mine > best.p) {
    endDuel(state, content, effects, player, 'player', `Out of draws. Your hand was closest (${mine} cards placed).`, null);
  } else {
    endDuel(state, content, effects, player, best.i, `Out of draws. ${duel.opponents[best.i].name}'s hand was as close or closer (${best.p} vs ${mine}).`, null);
  }
}

/** A spare life from your items (Fire Blanket): once per run, or once per act. Returns whether one was used. */
function useSpareLife(state: GameState, player: PlayerState, passives: ActiveEffect[]): { used: boolean; keepStake: boolean } {
  const act = state.tier + 1;
  for (const e of passives.filter((x) => x.type === 'spareLife')) {
    const per = e.params.per === 'act' ? 'act' : 'run';
    if (per === 'run' ? player.spareLives.run : player.spareLives.acts.includes(act)) continue;
    if (per === 'run') player.spareLives.run = true;
    else player.spareLives.acts.push(act);
    return { used: true, keepStake: e.params.keepStake === true };
  }
  return { used: false, keepStake: false };
}

function endDuel(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  winner: 'player' | number | 'none',
  reason: string,
  melds: CardId[][] | null,
): void {
  const duel = state.duel!;
  duel.winner = winner;
  duel.endReason = reason;
  duel.winningMelds = melds;
  const won = winner === 'player';
  const drawn = winner === 'none';
  const result: NonNullable<DuelState['result']> = {
    won,
    drawn,
    unusedDraws: Math.max(0, duel.rules.drawLimit - duel.drawsTaken),
    currency: 0,
    wonCards: [],
    lostStake: [],
    lifeLost: false,
    lotWon: null,
    bonus: [],
  };
  const rng = new Rng(state);
  // A called-off duel is neither won nor lost, so "after a win" and "after a loss" effects both stay quiet.
  const situation = drawn ? {} : { won };
  const ctx = duelCtx(state, content, player, rng);

  // Going out counts as completing a build. It runs before the payout, so pot changes (Pot-Bellied Stove) are won.
  if (won && melds) runHook(effects, 'onBuild', itemEffects(state, content, player, situation), { ...ctx, info: { melds, bonus: result.bonus } });

  if (won) {
    result.currency = state.config.duel.currencyReward[duel.kind] * (state.tier + 1) + duel.fx.insured.winCredits;
    player.currency += result.currency;
    player.score += result.currency;
    for (const id of duel.pot) {
      const card = state.cards[id];
      if (!card) continue;
      if (card.temporary) {
        delete card.temporary;
        addToDeck(state, card);
        result.wonCards.push(id);
      }
    }
    log(state, `You win the pot: ${result.wonCards.map((id) => cardLabel(state, content, id)).join(', ')} and ${result.currency} credits.`);
    if (duel.lot) {
      result.lotWon = { name: duel.lot.name, picks: duel.lot.picks, parcels: duel.lot.parcels.length };
      log(state, `You win the ${duel.lot.name}: pick ${duel.lot.picks} of its ${duel.lot.parcels.length} parcels.`);
    }
  } else if (drawn) {
    log(state, 'The duel is called off. Every stake goes back.');
  } else {
    const passives = itemEffects(state, content, player, situation);
    result.lostStake = duel.fx.insured.stake ? [] : [...duel.playerStake];
    if (duel.kind === 'boss') {
      if (duel.fx.insured.life) {
        log(state, 'You keep your life.');
      } else {
        const spare = useSpareLife(state, player, passives);
        if (spare.used) {
          log(state, 'The fire blanket saves you: you keep your life.');
          if (spare.keepStake) result.lostStake = [];
        } else {
          player.lives -= 1;
          result.lifeLost = true;
        }
      }
    }
    // Stopped Clock: keep some of a lost stake.
    const keep = Math.max(0, ...passives.filter((e) => e.type === 'keepStake').map((e) => Number(e.params.keep ?? 0)));
    if (keep > 0 && result.lostStake.length > 0) {
      const n = Math.min(keep, result.lostStake.length);
      const choose = passives.some((e) => e.type === 'keepStake' && e.params.choose === true);
      if (choose) {
        const source = passives.find((e) => e.type === 'keepStake' && e.params.choose === true)!;
        duel.choice = {
          kind: 'pick',
          prompt: `Keep ${n} part${n === 1 ? '' : 's'} of your stake.`,
          cardIds: [...result.lostStake],
          min: n,
          max: n,
          resume: { effect: 'keepStake', params: source.params, itemUid: source.itemUid },
        };
      } else {
        for (const id of rng.sample(result.lostStake, n)) result.lostStake.splice(result.lostStake.indexOf(id), 1);
      }
    }
    log(state, `You lose the pot${result.lifeLost ? ' and a life' : ''}.`);
  }
  duel.result = result;
  state.phase = 'duelResult';
  runHook(effects, 'onRoundEnd', itemEffects(state, content, player, situation), ctx);
}

/** Clear up after the result screen: destroy the lost stake and all temporary cards. */
export function finishDuel(state: GameState): DuelState {
  const duel = state.duel!;
  assertRule(!duel.choice, 'Make your choice first');
  for (const id of duel.result?.lostStake ?? []) destroyCard(state, id);
  for (const id of Object.keys(state.cards)) {
    if (state.cards[id].temporary) delete state.cards[id];
  }
  state.duel = null;
  return duel;
}

/** Turn Back the Clock: undo a lost duel and play it again from the start. */
function replay(state: GameState, content: ContentPack, effects: EffectRegistry, player: PlayerState, extraDraws: number, opponentHandMod: number, rng: Rng): void {
  const duel = state.duel!;
  if (duel.result?.lifeLost) player.lives += 1;
  const keep = new Set(duel.pot);
  for (const id of Object.keys(state.cards)) {
    if (state.cards[id].temporary && !keep.has(id)) delete state.cards[id];
  }
  duel.opponents = makeOpponents(state, content, player, duel.opponents.map((o) => o.defId), rng);
  duel.hand = [];
  duel.discard = [];
  duel.drawsTaken = 0;
  duel.turn = 0;
  duel.choice = null;
  duel.winner = null;
  duel.endReason = null;
  duel.winningMelds = null;
  duel.result = null;
  duel.fx = { ...freshFx(), replayed: true };
  duel.rules = duelRules(state, content, effects, player, duel.modifiers, duel);
  addDraws(duel, extraDraws);
  log(state, 'You turn back the clock. The duel starts again.');
  deal(state, content, effects, player, opponentHandMod, rng);
}

/** Work the duel's rules out again (a twist switched off), keeping what gadgets added. */
function recomputeRules(state: GameState, content: ContentPack, effects: EffectRegistry, player: PlayerState): void {
  const duel = state.duel!;
  duel.rules = duelRules(state, content, effects, player, duel.modifiers, duel);
  duel.rules.drawLimit += duel.fx.bonusDraws;
  duel.rules.handSize += duel.fx.bonusHandSize;
}

/** Places you can use a gadget right now, best first. */
export function placesNow(state: GameState, args: GadgetArgs = {}): Place[] {
  switch (state.phase) {
    case 'duel':
      return ['duel'];
    case 'duelResult':
      return ['duelResult'];
    case 'map':
      return args.nodeId ? ['lot'] : ['map', 'scrapbook'];
    case 'shop':
      return ['shop', 'scrapbook'];
    case 'rest':
      return ['scrapbook'];
    case 'appraiser':
      return args.nodeId ? ['lot'] : ['scrapbook'];
    case 'rummage':
      return state.rummage?.stage === 'pick' ? ['lot', 'scrapbook'] : ['scrapbook'];
    default:
      return [];
  }
}

const PLACE_NAMES: Record<Place, string> = {
  duel: 'in a duel',
  duelResult: 'after a duel',
  lot: 'on a lot',
  map: 'on the map',
  shop: 'in a shop',
  scrapbook: 'in your scrapbook',
};

/** Use a gadget for a charge, wherever it works: duels, results, lots, the map, shops or the scrapbook. */
export function useGadget(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  itemUid: string,
  args: GadgetArgs,
  rng: Rng,
): void {
  const item = player.items.find((i) => i.uid === itemUid);
  assertRule(item, 'You do not have that item');
  const g = gadgetAt(content, player, item);
  const place = placesNow(state, args).find((p) => g.places.includes(p));
  assertRule(place, `${g.gadget.name} is used ${g.places.map((p) => PLACE_NAMES[p]).join(' or ')}`);
  const duel = place === 'duel' || place === 'duelResult' ? state.duel : null;
  if (place === 'duel') activeDuel(state);
  if (place === 'duelResult') assertRule(duel?.result && !duel.choice, 'Make your choice first');
  assertRule(conditionHolds(g.when, situationOf(state, content)), `${g.gadget.name} can't be used here: ${describeWhen(g.when)}`);

  const free = place === 'duel' && duel!.fx.freeUses && duel!.fx.freeUses.count > 0 && duel!.fx.freeUses.sourceUid !== item.uid && (duel!.fx.freeUses.collection === 'any' || duel!.fx.freeUses.collection === g.def.collection);
  assertRule(free || (item.charges ?? 0) > 0, `${g.gadget.name} is out of charges. Recharge it between fights.`);

  const ctx: GadgetContext = { state, content, rng, player, duel, place, item, tier: g.tier, args, target: args.target, after: [], vars: {}, registry: effects, itemUid: item.uid };
  let ran = 0;
  for (const e of g.effects) {
    const h = getHandler(effects, e);
    if (!h.onGadget || !(h.places ?? ['duel']).includes(place)) continue;
    h.onGadget(ctx, e.params);
    ran++;
  }
  assertRule(ran > 0, `${g.gadget.name} does nothing ${PLACE_NAMES[place]}`);
  if (free) duel!.fx.freeUses!.count -= 1;
  else item.charges = (item.charges ?? 1) - 1;
  if (duel && place === 'duel') duel.fx.gadgetUses[g.def.collection] = (duel.fx.gadgetUses[g.def.collection] ?? 0) + 1;
  log(state, `You use ${g.gadget.name}.${free ? ' It costs no charge.' : ` ${item.charges} charge${item.charges === 1 ? '' : 's'} left.`}`);

  if (ctx.after.includes('rules')) recomputeRules(state, content, effects, player);
  if (ctx.after.includes('callOff')) endDuel(state, content, effects, player, 'none', 'Called off.', null);
  if (ctx.after.includes('replay')) replay(state, content, effects, player, ctx.vars.replayDraws ?? 0, ctx.vars.replayHand ?? 0, rng);
}

function describeWhen(when: Condition | undefined): string {
  if (!when) return '';
  const bits: string[] = [];
  if (when.kind) bits.push(`${when.kind.map((k) => (k === 'battle' ? 'minion' : k)).join(' or ')} duels only`);
  if (when.won === true) bits.push('after a win');
  if (when.won === false) bits.push('after a loss');
  if (when.greedyOpponent) bits.push('against a greedy opponent');
  if (when.minOpponents) bits.push(`against ${when.minOpponents} or more opponents`);
  return bits.join(', ');
}

/** Answer the duel's pending choice. */
export function chooseInDuel(state: GameState, content: ContentPack, effects: EffectRegistry, player: PlayerState, answer: Partial<ChoiceAnswer>, rng: Rng): void {
  const duel = state.duel;
  const choice = duel?.choice;
  assertRule(duel && choice && (state.phase === 'duel' || state.phase === 'duelResult'), 'Nothing to choose');
  const full: ChoiceAnswer = { cardIds: answer.cardIds ?? [], bottom: answer.bottom ?? [], discard: answer.discard ?? [], confirm: answer.confirm ?? false };
  if (choice.kind === 'pick') {
    assertRule(new Set(full.cardIds).size === full.cardIds.length && full.cardIds.every((id) => choice.cardIds.includes(id)), 'Choose from the cards shown');
    assertRule(full.cardIds.length >= choice.min && full.cardIds.length <= choice.max, choice.min === choice.max ? `Choose ${choice.min}` : `Choose ${choice.min} to ${choice.max}`);
  }
  const item = choice.resume.itemUid ? player.items.find((i) => i.uid === choice.resume.itemUid) : undefined;
  const ctx: GadgetContext = {
    state,
    content,
    rng,
    player,
    duel,
    place: state.phase === 'duelResult' ? 'duelResult' : 'duel',
    item: item ?? player.items[0],
    tier: 0,
    args: {},
    after: [],
    vars: {},
    registry: effects,
    itemUid: choice.resume.itemUid,
  };
  getHandler(effects, { type: choice.resume.effect }).onChoice?.(ctx, choice.resume.params, full, choice.resume.data ?? {});
  duel.choice = null;
  if (ctx.refund && item) {
    item.charges = Math.min(maxCharges(content, state.config, item, player) ?? 0, (item.charges ?? 0) + 1);
    log(state, 'You put it back. The charge is not used.');
  }
}

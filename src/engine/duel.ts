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
 * Items help here in two ways: their passive effects adjust the duel rules
 * (hand size, draws), and gadgets are used for a charge. Charges do not
 * refill between fights.
 */

import { perTier } from '../config';
import { type EffectRegistry, applyRuleModifiers, cardToken, getHandler, itemEffects, runHook } from './effects';
import { type MeldRules, type MeldToken, checkBuild, findBuild, handProgress } from './melds';
import { commonCategories, randomCategory } from './quality';
import { digDepth, makeLot, makeStakeRule, stakeProblem } from './scrapbook';
import { Rng } from './rng';
import type {
  BossState,
  CardId,
  ContentPack,
  DuelOpponent,
  DuelState,
  DuelTargetDef,
  Encounter,
  GameState,
  MapNode,
  MinionDef,
  PlayerState,
  RewardOption,
  RoundRules,
} from './types';
import { addToDeck, assertRule, cardLabel, createPart, createSpecial, destroyCard, log } from './zones';

type DuelKind = DuelState['kind'];

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

/** Pick who you'll face at a map stop and what they stake. Shown on the map. */
export function makeEncounter(state: GameState, content: ContentPack, kind: DuelKind, rng: Rng): Encounter {
  const act = state.tier + 1;
  const want = minionKind(kind);
  let pool = content.minions.filter((m) => m.kind === want && actFits(act, m));
  if (pool.length === 0) pool = content.minions.filter((m) => m.kind === want);
  assertRule(pool.length > 0, `No ${want} minions in the content`);
  const [lo, hi] = state.config.duel.minionsPerBattle;
  const count = kind === 'battle' ? rng.int(lo, hi) : 1;
  const minions = Array.from({ length: count }, () => rng.pick(pool));
  if (state.config.itemSource === 'scrapbook') {
    // Matched stakes: every minion puts in the same number of parts of the same material.
    const stakeRule = makeStakeRule(state, content, kind, Math.max(...minions.map((m) => m.stakes)), rng);
    const stakes: RewardOption[] = [];
    for (const m of minions) {
      const [lo, hi] = m.deck.gauges;
      for (let i = 0; i < stakeRule.count; i++) stakes.push({ kind: 'part', category: stakeRule.category, gauge: rng.int(lo, Math.min(hi, 10)) });
    }
    return { minions: minions.map((m) => m.id), stakes, stakeRule, lot: makeLot(state, content, kind, rng) };
  }
  const stakes: RewardOption[] = [];
  for (const m of minions) {
    for (let i = 0; i < m.stakes; i++) stakes.push(randomFromDeck(m, content, state, rng));
  }
  // Bosses always put a special card in the pot.
  if (kind === 'boss' && content.specials.length > 0) {
    stakes[stakes.length - 1] = { kind: 'special', specialId: rng.weightedPick(content.specials, (s) => s.weight).id };
  }
  return { minions: minions.map((m) => m.id), stakes };
}

function pickTarget(content: ContentPack, kind: DuelKind, act: number, rng: Rng): DuelTargetDef {
  const want = minionKind(kind);
  let pool = content.duelTargets.filter((t) => t.kind === want && actFits(act, t));
  if (pool.length === 0) pool = content.duelTargets.filter((t) => t.kind === want);
  assertRule(pool.length > 0, `No ${want} duel targets in the content`);
  return rng.pick(pool);
}

export function duelRules(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  modifiers: BossState[],
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
  };
  for (const m of modifiers) {
    const def = content.bossModifiers.find((b) => b.id === m.modifierId);
    if (def) applyRuleModifiers(effects, rules, def.effects, m.params);
  }
  applyRuleModifiers(effects, rules, itemEffects(content, player));
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
  const encounter = node.encounter ?? makeEncounter(state, content, kind, rng);
  const target = pickTarget(content, kind, state.tier + 1, rng);

  const modifiers: BossState[] = [];
  if (kind === 'boss') {
    const twists = content.bossModifiers.filter((m) => (m.minTier ?? 1) <= state.tier + 1);
    for (const m of rng.sample(twists, state.config.duel.bossTwists)) modifiers.push(resolveModifier(content, effects, m.id, rng));
  }

  const pot = encounter.stakes.map((o) =>
    o.kind === 'part'
      ? createPart(state, content, player.id, o.category!, o.gauge!, true).id
      : createSpecial(state, player.id, o.specialId!, true).id,
  );

  const opponents: DuelOpponent[] = encounter.minions.map((id) => {
    const def = content.minions.find((m) => m.id === id)!;
    const cats = def.deck.categories ?? commonCategories(content).map((c) => c.id);
    const deck: CardId[] = [];
    for (const c of cats) {
      for (let g = def.deck.gauges[0]; g <= def.deck.gauges[1]; g++) {
        for (let k = 0; k < def.deck.copies; k++) deck.push(createPart(state, content, player.id, c, g, true).id);
      }
    }
    return { defId: def.id, name: def.name, hand: [], drawPile: rng.shuffle(deck), skip: 0, revealed: false, lastAction: '' };
  });

  state.duel = {
    kind,
    nodeId: node.id,
    targetId: target.id,
    requirements: target.requirements,
    modifiers,
    rules: duelRules(state, content, effects, player, modifiers),
    pot,
    playerStake: [],
    stakeRule: encounter.stakeRule ?? null,
    lot: encounter.lot ?? null,
    opponents,
    hand: [],
    drawPile: [],
    discard: [],
    turnPhase: 'draw',
    drawsTaken: 0,
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
  duel.drawPile = rng.shuffle(player.deck.filter((id) => !cardIds.includes(id)));
  const n = duel.rules.handSize;
  for (let i = 0; i < n; i++) {
    const id = duel.drawPile.pop();
    if (id) duel.hand.push(id);
  }
  for (const opp of duel.opponents) {
    for (let i = 0; i < n; i++) {
      const id = opp.drawPile.pop();
      if (id) opp.hand.push(id);
    }
  }
  const first = duel.opponents[0]?.drawPile.pop();
  if (first) duel.discard.push(first);
  duel.turnPhase = 'draw';
  state.phase = 'duel';
  // Item passives that hand you a card at the start of a round do so in duels too.
  runHook(effects, 'onRoundStart', itemEffects(content, player), { state, content, rng, player });
  log(state, `You stake ${cardIds.map((id) => cardLabel(state, content, id)).join(', ')}. The pot holds ${duel.pot.length} cards.`);
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

function takeFrom(pile: CardId[], discard: CardId[], rng: Rng): CardId | null {
  if (pile.length === 0 && discard.length > 1) {
    const top = discard.pop()!;
    pile.push(...rng.shuffle(discard.splice(0)));
    discard.push(top);
  }
  return pile.pop() ?? null;
}

export function duelDraw(state: GameState, content: ContentPack, source: 'deck' | 'discard', rng: Rng): void {
  const duel = activeDuel(state);
  assertRule(duel.turnPhase === 'draw', 'You have already drawn this turn');
  assertRule(duel.drawsTaken < duel.rules.drawLimit, 'No draws left');
  if (source === 'discard') {
    assertRule(duel.rules.allowDiscardDraw, 'Discard pile draws are not allowed in this fight');
    const id = duel.discard.pop();
    assertRule(id, 'The discard pile is empty');
    duel.hand.push(id);
    log(state, `You take ${cardLabel(state, content, id)} from the discard pile.`);
  } else {
    const id = takeFrom(duel.drawPile, duel.discard, rng);
    if (id) duel.hand.push(id);
  }
  duel.drawsTaken += 1;
  duel.turnPhase = 'main';
}

function activeDuel(state: GameState): DuelState {
  assertRule(state.phase === 'duel' && state.duel && state.duel.winner === null, 'No duel in progress');
  return state.duel;
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

export function duelGoOut(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  groups: CardId[][],
): void {
  const duel = activeDuel(state);
  for (const id of groups.flat()) assertRule(duel.hand.includes(id), `${cardLabel(state, content, id)} is not in your hand`);
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

/** The player discards; then every opponent takes a turn. */
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

  for (let i = 0; i < duel.opponents.length; i++) {
    opponentTurn(state, content, effects, player, i, rng);
    if (duel.winner !== null) return;
  }

  if (duel.drawsTaken >= duel.rules.drawLimit) {
    showdown(state, content, effects, player);
    return;
  }
  duel.turnPhase = 'draw';
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
  const def = content.minions.find((m) => m.id === opp.defId);
  if (opp.skip > 0) {
    opp.skip -= 1;
    opp.lastAction = 'Frozen: missed a turn.';
    return;
  }
  const prog = (ids: CardId[]) => progressOf(state, content, effects, duel, ids);

  // Draw: take the discard if it improves the hand (greedy minions take it if it doesn't hurt).
  const top = duel.discard.at(-1);
  let tookDiscard = false;
  if (top && duel.rules.allowDiscardDraw) {
    const now = prog(opp.hand);
    const withTop = Math.max(...opp.hand.map((d) => prog([...opp.hand.filter((h) => h !== d), top])));
    tookDiscard = def?.greedy ? withTop >= now && withTop > 0 : withTop > now;
  }
  const drawn = tookDiscard ? duel.discard.pop()! : takeFrom(opp.drawPile, duel.discard, rng);
  if (!drawn) {
    opp.lastAction = 'Had nothing to draw.';
    return;
  }
  opp.hand.push(drawn);

  const out = findDuelOut(state, content, effects, opp.hand);
  if (out) {
    endDuel(state, content, effects, player, index, `${opp.name} went out.`, out);
    return;
  }

  // Discard the card whose loss hurts least (prefer shedding high numbers).
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
  duel.discard.push(worst);
  opp.lastAction = `${tookDiscard ? `Took ${cardLabel(state, content, drawn)} from the discard pile` : 'Drew a card'}, discarded ${cardLabel(state, content, worst)}.`;
}

function showdown(state: GameState, content: ContentPack, effects: EffectRegistry, player: PlayerState): void {
  const duel = state.duel!;
  const mine = progressOf(state, content, effects, duel, duel.hand);
  const best = duel.opponents
    .map((o, i) => ({ i, p: progressOf(state, content, effects, duel, o.hand) }))
    .sort((a, b) => b.p - a.p)[0];
  if (!best || mine > best.p) {
    endDuel(state, content, effects, player, 'player', `Out of draws. Your hand was closest (${mine} cards placed).`, null);
  } else {
    endDuel(state, content, effects, player, best.i, `Out of draws. ${duel.opponents[best.i].name}'s hand was as close or closer (${best.p} vs ${mine}).`, null);
  }
}

function endDuel(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  winner: 'player' | number,
  reason: string,
  melds: CardId[][] | null,
): void {
  const duel = state.duel!;
  duel.winner = winner;
  duel.endReason = reason;
  duel.winningMelds = melds;
  const won = winner === 'player';
  const result: DuelState['result'] = { won, currency: 0, wonCards: [] as CardId[], lostStake: [], lifeLost: false, dig: null };

  if (won) {
    result.currency = state.config.duel.currencyReward[duel.kind] * (state.tier + 1);
    player.currency += result.currency;
    player.score += result.currency;
    for (const id of duel.pot) {
      const card = state.cards[id];
      if (!card || !card.temporary) continue;
      delete card.temporary;
      addToDeck(state, card);
      result.wonCards.push(id);
    }
    log(state, `You win the pot: ${result.wonCards.map((id) => cardLabel(state, content, id)).join(', ')} and ${result.currency} credits.`);
    if (duel.lot) {
      result.dig = digDepth(state.config, duel);
      log(state, `You dig ${result.dig.taken} of ${result.dig.total} pieces out of the ${duel.lot.name}.`);
    }
  } else {
    result.lostStake = [...duel.playerStake];
    if (duel.kind === 'boss') {
      player.lives -= 1;
      result.lifeLost = true;
    }
    log(state, `You lose the pot${result.lifeLost ? ' and a life' : ''}.`);
  }
  // Item passives: going out counts as completing a build; every duel ends a "round".
  const ctx = { state, content, rng: new Rng(state), player };
  if (won && melds) runHook(effects, 'onBuild', itemEffects(content, player), ctx);
  runHook(effects, 'onRoundEnd', itemEffects(content, player), ctx);
  duel.result = result;
  state.phase = 'duelResult';
}

/** Clear up after the result screen: destroy the lost stake and all temporary cards. */
export function finishDuel(state: GameState): DuelState {
  const duel = state.duel!;
  for (const id of duel.result?.lostStake ?? []) destroyCard(state, id);
  for (const id of Object.keys(state.cards)) {
    if (state.cards[id].temporary) delete state.cards[id];
  }
  state.duel = null;
  return duel;
}

export function useGadget(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  itemUid: string,
  target: number | undefined,
  rng: Rng,
): void {
  const duel = activeDuel(state);
  const item = player.items.find((i) => i.uid === itemUid);
  assertRule(item, 'You do not have that item');
  const def = content.items.find((d) => d.id === item.itemId);
  assertRule(def?.gadget, `${def?.name ?? 'That item'} has no gadget`);
  assertRule((item.charges ?? 0) > 0, `${def.gadget.name} is out of charges. Recharge it between fights.`);
  if (def.gadget.target === 'opponent') {
    assertRule(target !== undefined && duel.opponents[target], 'Choose an opponent');
  }
  const ctx = { state, content, rng, player, duel, target, grade: item.grade };
  for (const ref of def.gadget.effects) getHandler(effects, ref).onGadget?.(ctx, ref.params ?? {});
  item.charges = (item.charges ?? 1) - 1;
  log(state, `You use ${def.gadget.name}. ${item.charges} charge${item.charges === 1 ? '' : 's'} left.`);
}

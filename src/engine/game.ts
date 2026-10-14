/**
 * The rules engine: `(state, action) => newState`.
 *
 * - Pure: the input state is never mutated (it is cloned first) and all
 *   randomness comes from the seeded RNG stored in the state.
 * - Illegal actions throw RuleError (`reduce`) or return an error (`applyAction`).
 * - Content and effect handlers are injected via createEngine, so tests and
 *   mods can supply their own.
 */

import { defaultContent } from '../content';
import { type GameConfig, makeConfig, perTier } from '../config';
import { endBattleTurn, makeReward, playBattleCard, startBattle } from './battle';
import { blueprintsForTier, getBlueprint } from './blueprints';
import {
  duelDiscard,
  duelDraw,
  duelGoOut,
  findDuelOut,
  finishDuel,
  makeEncounter,
  placeStake,
  startDuel,
  useGadget,
} from './duel';
import {
  type EffectContext,
  type EffectRegistry,
  applyRuleModifiers,
  cardToken,
  defaultEffects,
  getHandler,
  itemEffects,
  runHook,
} from './effects';
import { findNode, generateMap, reachableNodes } from './map';
import { type MeldRules, type MeldToken, type MeldUnit, checkBuild, findBuild, validateMeld } from './melds';
import { Rng, seedToState } from './rng';
import type {
  BossState,
  CardId,
  ContentPack,
  EffectRef,
  GameAction,
  GameState,
  MeldRequirement,
  PlayerId,
  PlayerState,
  RoundResult,
  RoundRules,
  ShopSlot,
} from './types';
import {
  RuleError,
  addToDeck,
  assertRule,
  cardLabel,
  createPart,
  createSpecial,
  destroyCard,
  getCard,
  getPlayer,
  log,
  takeTopOfDrawPile,
} from './zones';

export interface NewGameOptions {
  seed: string;
  config?: Partial<GameConfig>;
  players?: { id?: PlayerId; name: string }[];
}

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string; state: GameState };

export interface Engine {
  content: ContentPack;
  effects: EffectRegistry;
  newGame(options: NewGameOptions): GameState;
  /** Apply an action; throws RuleError if it is illegal. */
  reduce(state: GameState, action: GameAction): GameState;
  /** Apply an action; returns an error instead of throwing. */
  applyAction(state: GameState, action: GameAction): ApplyResult;
  /**
   * Helper for UIs and bots: find a valid BUILD assignment for the player's
   * current target. With `cardIds`, only those cards may be used (locked
   * sub-assemblies count only if all their cards are listed).
   */
  suggestBuild(state: GameState, playerId: PlayerId, cardIds?: CardId[]): CardId[][] | null;
  /** Meld rules in force for a player this round. */
  meldRules(player: PlayerState): MeldRules;
  /** Duel helper: a way to go out with the given cards (default: the whole duel hand). */
  suggestDuelOut(state: GameState, cardIds?: CardId[]): CardId[][] | null;
  token(state: GameState, cardId: CardId): MeldToken | null;
}

export function createEngine(content: ContentPack = defaultContent, effects: EffectRegistry = defaultEffects): Engine {
  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  function newGame({ seed, config: overrides, players }: NewGameOptions): GameState {
    const config = makeConfig(overrides);
    const playerSpecs = players && players.length > 0 ? players : [{ name: 'Player' }];
    const state: GameState = {
      schemaVersion: 1,
      config,
      seed,
      rng: seedToState(seed),
      phase: 'blueprintSelect',
      tier: 0,
      round: 0,
      players: playerSpecs.map((p, i) => ({
        id: p.id ?? `p${i + 1}`,
        name: p.name,
        deck: [],
        drawPile: [],
        hand: [],
        played: [],
        lockedMelds: [],
        items: [],
        currency: config.startingCurrency,
        score: 0,
        lives: config.lives,
        hp: config.battle.startingHp,
        maxHp: config.battle.startingHp,
        target: null,
        drawsTaken: 0,
        exhausted: false,
        rules: baseRules(config, 0),
      })),
      activePlayer: 0,
      cards: {},
      nextCardSeq: 1,
      roundState: null,
      shop: null,
      lastResult: null,
      map: null,
      battle: null,
      reward: null,
      duel: null,
      nextUid: 1,
      messages: [],
    };
    if (config.runStructure === 'map' && state.players.length > 1) {
      throw new Error('Map runs are single-player for now; use runStructure "workshopOnly" for multiplayer.');
    }

    const deckCfg = config.startingDeck;
    const categories = deckCfg.categories === 'all' ? content.categories.map((c) => c.id) : deckCfg.categories;
    for (const player of state.players) {
      for (const category of categories) {
        for (let g = deckCfg.gauges[0]; g <= deckCfg.gauges[1]; g++) {
          for (let k = 0; k < deckCfg.copies; k++) addToDeck(state, createPart(state, content, player.id, category, g));
        }
      }
      for (const specialId of deckCfg.specials) addToDeck(state, createSpecial(state, player.id, specialId));
    }

    log(state, `New run (seed "${seed}").`);
    if (config.runStructure === 'map') enterAct(state, 0);
    else prepareRound(state, isBossRound(state));
    return state;
  }

  function baseRules(config: GameConfig, tier: number): RoundRules {
    return {
      handSize: perTier(config.handSizeByTier, tier),
      drawLimit: perTier(config.drawLimitByTier, tier),
      allowDiscardDraw: true,
      disabledMeldRoles: [],
      bannedCategories: [],
      revealHidden: false,
      gaugeMin: config.gaugeMin,
      gaugeMax: config.gaugeMax,
      requireNaturalInMeld: config.requireNaturalInMeld,
    };
  }

  /** Rule modifiers active this round (challenge modifiers from config + the boss). */
  function roundModifierRefs(state: GameState): { refs: EffectRef[]; params?: Record<string, unknown> }[] {
    return (state.roundState?.modifiers ?? []).flatMap((m) => {
      const def = content.bossModifiers.find((b) => b.id === m.modifierId);
      return def ? [{ refs: def.effects, params: m.params }] : [];
    });
  }

  /** Pick concrete values for a modifier's random params (e.g. which category is banned). */
  function resolveModifier(id: string, rng: Rng): BossState {
    const def = content.bossModifiers.find((m) => m.id === id);
    let params: Record<string, unknown> = {};
    for (const ref of def?.effects ?? []) {
      const h = getHandler(effects, ref);
      if (h.resolveParams) params = { ...params, ...h.resolveParams(ref.params ?? {}, rng, content) };
    }
    return { modifierId: id, params };
  }

  function computeRules(state: GameState, player: PlayerState): RoundRules {
    const rules = baseRules(state.config, state.tier);
    for (const { refs, params } of roundModifierRefs(state)) applyRuleModifiers(effects, rules, refs, params);
    applyRuleModifiers(effects, rules, itemEffects(content, player));
    rules.handSize = Math.max(1, rules.handSize);
    rules.drawLimit = Math.max(1, rules.drawLimit);
    return rules;
  }

  function isBossRound(state: GameState): boolean {
    return state.round >= state.config.normalRoundsPerTier;
  }

  /**
   * Set up blueprint offers for the coming workshop round. A boss round
   * (the end of a tier, or a master workshop on the map) offers one big
   * blueprint with a random hazard modifier.
   */
  function prepareRound(state: GameState, boss: boolean): void {
    const rng = new Rng(state);
    const tier = state.tier + 1;
    let offers: string[];
    let bossState: BossState | null = null;

    if (boss) {
      const pool = blueprintsForTier(content, tier, true);
      const fallback = blueprintsForTier(content, tier, false);
      offers = [rng.pick(pool.length > 0 ? pool : fallback).id];
      const mods = content.bossModifiers.filter((m) => (m.minTier ?? 1) <= tier);
      if (mods.length > 0) bossState = resolveModifier(rng.pick(mods).id, rng);
    } else {
      const pool = blueprintsForTier(content, tier, false);
      offers = rng.sample(pool, state.config.offersPerRound).map((b) => b.id);
    }

    state.roundState = {
      offers,
      isBoss: boss,
      boss: bossState,
      modifiers: [
        ...state.config.challengeModifiers.map((id) => resolveModifier(id, rng)),
        ...(bossState ? [bossState] : []),
      ],
      discard: [],
      turnPhase: 'draw',
      pendingChoice: null,
      turn: 0,
    };
    for (const p of state.players) {
      p.target = null;
      p.rules = computeRules(state, p);
    }
    state.phase = 'blueprintSelect';
    if (bossState) {
      const def = content.bossModifiers.find((m) => m.id === bossState!.modifierId);
      const extra = typeof bossState.params.category === 'string' ? ` (${bossState.params.category})` : '';
      log(state, `${state.map ? 'Master workshop' : 'Boss round'}! Hazard: ${def?.name}${extra}.`);
    }
  }

  function startRound(state: GameState): void {
    const rng = new Rng(state);
    const round = state.roundState!;
    for (const p of state.players) {
      p.rules = computeRules(state, p);
      p.drawPile = rng.shuffle([...p.deck]);
      p.hand = [];
      p.played = [];
      p.lockedMelds = [];
      p.drawsTaken = 0;
      p.exhausted = false;
      for (let i = 0; i < p.rules.handSize; i++) {
        const id = p.drawPile.pop();
        if (id) p.hand.push(id);
      }
    }
    if (state.config.flipStartingDiscard) {
      const first = state.players[0];
      const id = first.drawPile.pop();
      if (id) round.discard.push(id);
    }
    for (const p of state.players) {
      const ctx = context(state, p);
      for (const { refs, params } of roundModifierRefs(state)) runHook(effects, 'onRoundStart', refs, ctx, params);
      runHook(effects, 'onRoundStart', itemEffects(content, p), ctx);
    }
    state.activePlayer = 0;
    round.turnPhase = 'draw';
    state.phase = 'playing';
    log(state, `Tier ${state.tier + 1}, round ${state.round + 1} begins.`);
  }

  function context(state: GameState, player: PlayerState, extra: Partial<EffectContext> = {}): EffectContext {
    return { state, content, rng: new Rng(state), player, ...extra };
  }

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  function activePlayerFor(state: GameState, playerId: PlayerId): PlayerState {
    assertRule(state.phase === 'playing' && state.roundState, 'No round in progress');
    const player = getPlayer(state, playerId);
    assertRule(state.players[state.activePlayer].id === playerId, `It is not ${player.name}'s turn`);
    return player;
  }

  function assertNoPending(state: GameState) {
    assertRule(!state.roundState?.pendingChoice, 'Resolve the pending choice first');
  }

  function selectBlueprint(state: GameState, playerId: PlayerId, blueprintId: string) {
    assertRule(state.phase === 'blueprintSelect' && state.roundState, 'Not choosing a blueprint now');
    assertRule(state.roundState.offers.includes(blueprintId), 'That blueprint is not on offer');
    const player = getPlayer(state, playerId);
    player.target = blueprintId;
    log(state, `${player.name} commits to ${getBlueprint(content, blueprintId).name}.`);
    if (state.players.every((p) => p.target)) startRound(state);
  }

  function draw(state: GameState, playerId: PlayerId, source: 'deck' | 'discard') {
    const player = activePlayerFor(state, playerId);
    const round = state.roundState!;
    assertNoPending(state);
    assertRule(round.turnPhase === 'draw', 'You have already drawn this turn');
    assertRule(player.drawsTaken < player.rules.drawLimit, 'No draws left this round');

    if (source === 'discard') {
      assertRule(player.rules.allowDiscardDraw, 'Discard pile draws are not allowed this round');
      const id = round.discard.pop();
      assertRule(id, 'The discard pile is empty');
      player.hand.push(id);
      player.drawsTaken++;
      round.turnPhase = 'main';
      log(state, `${player.name} takes ${cardLabel(state, content, id)} from the discard pile.`);
      return;
    }

    const rng = new Rng(state);
    const id = takeTopOfDrawPile(state, player, rng);
    player.drawsTaken++;
    round.turnPhase = 'main';
    if (!id) {
      log(state, `${player.name} has no cards left to draw.`);
      return;
    }
    player.hand.push(id);
    const card = getCard(state, id);
    if (card.kind === 'special') {
      const def = content.specials.find((s) => s.id === card.specialId);
      const hasOnDraw = def?.effects.some((ref) => getHandler(effects, ref).onDraw);
      if (def && hasOnDraw) {
        log(state, `${player.name} draws ${def.name}!`);
        runHook(effects, 'onDraw', def.effects, context(state, player, { sourceCardId: id }));
      }
    }
  }

  function playSpecial(state: GameState, playerId: PlayerId, cardId: CardId, targetId?: CardId) {
    const player = activePlayerFor(state, playerId);
    assertNoPending(state);
    assertRule(state.roundState!.turnPhase === 'main', 'Draw a card first');
    assertRule(player.hand.includes(cardId), 'That card is not in your hand');
    const card = getCard(state, cardId);
    assertRule(card.kind === 'special', 'Only special cards can be played');
    const def = content.specials.find((s) => s.id === card.specialId);
    assertRule(def?.playable, `${def?.name ?? 'That card'} cannot be played on its own`);

    player.hand.splice(player.hand.indexOf(cardId), 1);
    player.played.push(cardId);
    log(state, `${player.name} plays ${def.name}.`);
    runHook(effects, 'onPlay', def.effects, context(state, player, { sourceCardId: cardId, targetId }));
    if (def.consumeOnPlay) destroyCard(state, cardId);
  }

  function resolveChoice(state: GameState, playerId: PlayerId, cardIds: CardId[]) {
    const round = state.roundState;
    const choice = round?.pendingChoice;
    assertRule(round && choice, 'Nothing to choose');
    assertRule(choice.playerId === playerId, 'Not your choice');
    const player = getPlayer(state, playerId);
    const uniq = new Set(cardIds);
    assertRule(uniq.size === cardIds.length && cardIds.every((id) => choice.cardIds.includes(id)), 'Invalid choice');

    if (choice.kind === 'keepOne') {
      assertRule(cardIds.length === choice.keep, `Choose exactly ${choice.keep} card(s)`);
      player.hand.push(...cardIds);
      const rest = choice.cardIds.filter((id) => !uniq.has(id));
      if (choice.rest === 'discard') round.discard.push(...rest);
      else player.drawPile.unshift(...rest);
      log(state, `${player.name} keeps ${cardIds.map((id) => cardLabel(state, content, id)).join(', ')}.`);
    } else {
      assertRule(cardIds.length === choice.cardIds.length, 'Order every card');
      // cardIds is top-first; the draw pile's top is its last element.
      player.drawPile.splice(player.drawPile.length - cardIds.length, cardIds.length, ...[...cardIds].reverse());
      log(state, `${player.name} reorders the top of their deck.`);
    }
    round.pendingChoice = null;
  }

  function lockMeld(state: GameState, playerId: PlayerId, meldType: 'set' | 'run', cardIds: CardId[]) {
    assertRule(state.config.subAssemblies, 'Sub-assemblies are disabled');
    const player = activePlayerFor(state, playerId);
    assertNoPending(state);
    assertRule(new Set(cardIds).size === cardIds.length, 'Duplicate cards');
    assertRule(cardIds.every((id) => player.hand.includes(id)), 'Lock cards from your hand');
    const tokens = tokensFor(state, cardIds);
    const size = Math.max(state.config.minLockedMeldSize, 1);
    const result = validateMeld(tokens, { type: meldType, size }, meldRules(player));
    assertRule(result.ok, result.ok ? '' : result.reason);
    player.hand = player.hand.filter((id) => !cardIds.includes(id));
    player.lockedMelds.push({ type: meldType, cardIds: [...cardIds] });
    log(state, `${player.name} locks in a ${meldType} of ${cardIds.length}.`);
  }

  function pivot(state: GameState, playerId: PlayerId, blueprintId: string) {
    const player = activePlayerFor(state, playerId);
    assertNoPending(state);
    const round = state.roundState!;
    assertRule(round.turnPhase === 'main', 'Draw a card first');
    assertRule(round.offers.includes(blueprintId), 'That blueprint is not on offer');
    assertRule(player.target !== blueprintId, 'Already building that');
    const cost = state.config.pivotCost;
    assertRule(player.drawsTaken + cost.draws <= player.rules.drawLimit, 'Not enough draws left to pivot');
    assertRule(player.currency >= cost.currency, 'Not enough currency to pivot');
    player.drawsTaken += cost.draws;
    player.currency -= cost.currency;
    player.target = blueprintId;
    log(state, `${player.name} pivots to ${getBlueprint(content, blueprintId).name}.`);
  }

  function tokensFor(state: GameState, cardIds: CardId[]): MeldToken[] {
    return cardIds.map((id) => {
      const t = cardToken(state, content, effects, id);
      assertRule(t, `${cardLabel(state, content, id)} cannot be used in a meld`);
      return t;
    });
  }

  function meldRules(player: PlayerState): MeldRules {
    const r = player.rules;
    return {
      gaugeMin: r.gaugeMin,
      gaugeMax: r.gaugeMax,
      disabledMeldRoles: r.disabledMeldRoles,
      bannedCategories: r.bannedCategories,
      requireNaturalInMeld: r.requireNaturalInMeld,
    };
  }

  function build(state: GameState, playerId: PlayerId, groups: CardId[][]) {
    const player = activePlayerFor(state, playerId);
    assertNoPending(state);
    assertRule(player.target, 'No blueprint chosen');
    const bp = getBlueprint(content, player.target);

    const lockedIds = new Set(player.lockedMelds.flatMap((m) => m.cardIds));
    for (const id of groups.flat()) {
      assertRule(player.hand.includes(id) || lockedIds.has(id), `${cardLabel(state, content, id)} is not yours to use`);
    }
    // Locked sub-assemblies must be used whole, in a meld of their own type.
    for (const meld of player.lockedMelds) {
      const idx = groups.findIndex((g) => g.some((id) => meld.cardIds.includes(id)));
      if (idx < 0) continue;
      assertRule(
        meld.cardIds.every((id) => groups[idx].includes(id)),
        'A locked sub-assembly must be used whole',
      );
      assertRule(bp.requirements[idx].type === meld.type, `A locked ${meld.type} can only fill a ${meld.type}`);
    }

    const check = checkBuild(
      groups.map((g) => tokensFor(state, g)),
      bp.requirements,
      meldRules(player),
    );
    assertRule(check.ok, check.reason ?? 'Build does not match the blueprint');

    const used = groups.flat();
    for (const id of used) destroyCard(state, id);
    const ctx = context(state, player);
    runHook(effects, 'onBuild', itemEffects(content, player), ctx);
    const itemDef = content.items.find((i) => i.id === bp.itemId);
    player.items.push({
      uid: `it${state.nextUid++}`,
      itemId: bp.itemId,
      fromBlueprint: bp.id,
      builtFrom: used.length,
      level: bp.tier + (bp.boss ? 1 : 0),
      usesLeft: itemDef?.battle?.uses ?? null,
      charges: itemDef?.gadget?.charges ?? null,
    });
    const item = content.items.find((i) => i.id === bp.itemId);
    log(state, `${player.name} builds ${bp.name}! ${used.length} parts become ${item?.name ?? bp.itemId}.`);
    endRound(state, player.id);
  }

  function discard(state: GameState, playerId: PlayerId, cardId: CardId) {
    const player = activePlayerFor(state, playerId);
    const round = state.roundState!;
    assertNoPending(state);
    assertRule(round.turnPhase === 'main', 'Draw a card first');
    assertRule(player.hand.includes(cardId), 'That card is not in your hand');
    player.hand.splice(player.hand.indexOf(cardId), 1);
    round.discard.push(cardId);
    log(state, `${player.name} discards ${cardLabel(state, content, cardId)}.`);

    if (player.drawsTaken >= player.rules.drawLimit) {
      player.exhausted = true;
      log(state, `${player.name} is out of draws.`);
    }
    round.turn++;
    round.turnPhase = 'draw';

    // Next player who still has draws; if nobody, the round ends unbuilt.
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (state.activePlayer + step) % n;
      if (!state.players[idx].exhausted) {
        state.activePlayer = idx;
        return;
      }
    }
    endRound(state, null);
  }

  // -------------------------------------------------------------------------
  // Round end, progression, shop
  // -------------------------------------------------------------------------

  function deadwoodOf(state: GameState, player: PlayerState): number {
    const dw = state.config.deadwood;
    return player.hand.reduce((sum, id) => {
      const c = state.cards[id];
      if (!c || c.temporary) return sum;
      if (c.kind === 'special') return sum + dw.specialValue;
      return sum + (dw.mode === 'gauge' ? c.gauge : dw.flatValue);
    }, 0);
  }

  function endRound(state: GameState, winner: PlayerId | null) {
    const cfg = state.config;
    const result: RoundResult = {
      tier: state.tier,
      round: state.round,
      blueprintId: winner ? getPlayer(state, winner).target : null,
      winner,
      perPlayer: {},
    };

    for (const p of state.players) {
      const deadwood = deadwoodOf(state, p);
      const penalty = Math.floor(deadwood * cfg.deadwood.currencyPerPoint);
      const built = p.id === winner;
      let reward = 0;
      let lifeLost = false;
      let hpLost = 0;
      if (built) {
        const unused = Math.max(0, p.rules.drawLimit - p.drawsTaken);
        reward = Math.max(0, perTier(cfg.roundRewardByTier, state.tier) + unused * cfg.rewardPerUnusedDraw - penalty);
        p.currency += reward;
        p.score += reward + (state.tier + 1) * 10;
      } else {
        p.currency = Math.max(0, p.currency - penalty);
        p.score = Math.max(0, p.score - deadwood);
        if (cfg.mode === 'solo' && cfg.runStructure === 'workshopOnly') {
          p.lives -= 1;
          lifeLost = true;
          log(state, `${p.name} failed the round and loses a life (${p.lives} left).`);
        } else if (cfg.mode === 'solo' && cfg.battleStyle === 'cards') {
          hpLost = Math.min(p.hp, cfg.battle.workshopFailDamage);
          p.hp -= hpLost;
          if (hpLost > 0) log(state, `${p.name} failed the build and takes ${hpLost} damage.`);
        }
      }
      result.perPlayer[p.id] = {
        built,
        deadwood,
        reward,
        itemId: built ? (p.items[p.items.length - 1]?.itemId ?? null) : null,
        lifeLost,
        hpLost,
      };
      runHook(effects, 'onRoundEnd', itemEffects(content, p), context(state, p));
    }

    // Everything not destroyed returns to its owner's deck (the master list
    // already holds it); temporary cards vanish.
    for (const id of Object.keys(state.cards)) {
      if (state.cards[id].temporary) destroyCard(state, id);
    }
    for (const p of state.players) {
      p.drawPile = [];
      p.hand = [];
      p.played = [];
      p.lockedMelds = [];
    }
    state.roundState = null;
    state.lastResult = result;
    state.phase = 'roundOver';
  }

  function continueAfterRound(state: GameState) {
    if (state.phase === 'duelResult') {
      continueAfterDuel(state, state.players[0]);
      return;
    }
    assertRule(state.phase === 'roundOver', 'Nothing to continue');
    const cfg = state.config;
    if (cfg.runStructure === 'map') {
      if (state.players.every((p) => p.hp <= 0)) {
        state.phase = 'runLost';
        log(state, 'The run is over.');
      } else {
        state.phase = 'map';
      }
      return;
    }
    if (cfg.mode === 'solo' && state.players.every((p) => p.lives <= 0)) {
      state.phase = 'runLost';
      log(state, 'The run is over.');
      return;
    }
    const wasBoss = state.round >= cfg.normalRoundsPerTier;
    // A failed boss must be retried: you only leave a tier by beating its boss.
    if (wasBoss && !state.lastResult?.winner) {
      log(state, 'The boss stands. Regroup in the shop and try again.');
      openShop(state);
      return;
    }
    if (wasBoss && state.tier + 1 >= cfg.tiers) {
      state.phase = 'runWon';
      log(state, 'Run complete!');
      return;
    }
    if (wasBoss) {
      state.tier += 1;
      state.round = 0;
    } else {
      state.round += 1;
    }
    openShop(state);
  }

  function shopPool(state: GameState) {
    const tier = state.tier + 1;
    const pools = [...content.shopPools].sort((a, b) => a.tier - b.tier);
    return pools.filter((p) => p.tier <= tier).pop() ?? pools[0];
  }

  function generateShopSlots(state: GameState): ShopSlot[] {
    const rng = new Rng(state);
    const pool = shopPool(state);
    if (!pool) return [];
    const tier = state.tier + 1;
    const slots: ShopSlot[] = [];
    const [gLo, gHi] = pool.gaugeRange ?? [state.config.gaugeMin, state.config.gaugeMax];
    for (let i = 0; i < pool.partSlots; i++) {
      const cat = rng.weightedPick(content.categories, (c) => pool.categoryWeights?.[c.id] ?? 1);
      slots.push({ kind: 'part', category: cat.id, gauge: rng.int(gLo, gHi), price: pool.partPrice, sold: false });
    }
    const specials = content.specials.filter((s) => (s.minTier ?? 1) <= tier);
    for (let i = 0; i < pool.specialSlots && specials.length > 0; i++) {
      const sp = rng.weightedPick(specials, (s) => s.weight);
      slots.push({
        kind: 'special',
        specialId: sp.id,
        price: Math.ceil(sp.price * pool.specialPriceMultiplier),
        sold: false,
      });
    }
    for (const svc of pool.services) {
      slots.push({ kind: 'service', serviceId: svc.id, price: svc.price, sold: false });
    }
    return slots;
  }

  function openShop(state: GameState) {
    state.shop = { slots: generateShopSlots(state), rerolls: 0 };
    state.phase = 'shop';
  }

  function shopBuy(state: GameState, playerId: PlayerId, slotIndex: number, targetId?: CardId) {
    assertRule(state.phase === 'shop' && state.shop, 'The shop is closed');
    const player = getPlayer(state, playerId);
    const slot = state.shop.slots[slotIndex];
    assertRule(slot && !slot.sold, 'Nothing to buy there');
    assertRule(player.currency >= slot.price, 'Not enough currency');

    if (slot.kind === 'part') {
      const card = createPart(state, content, player.id, slot.category!, slot.gauge!);
      addToDeck(state, card);
      log(state, `${player.name} buys ${card.name} (${card.gauge}).`);
    } else if (slot.kind === 'special') {
      const card = createSpecial(state, player.id, slot.specialId!);
      addToDeck(state, card);
      log(state, `${player.name} buys ${cardLabel(state, content, card.id)}.`);
    } else {
      const svc = shopPool(state)?.services.find((s) => s.id === slot.serviceId);
      assertRule(svc, 'Unknown service');
      runHook(effects, 'onPurchase', [svc.effect], context(state, player, { targetId }));
    }
    player.currency -= slot.price;
    slot.sold = true;
  }

  function shopReroll(state: GameState, playerId: PlayerId) {
    assertRule(state.phase === 'shop' && state.shop, 'The shop is closed');
    const player = getPlayer(state, playerId);
    const cost = state.config.shopRerollCost;
    assertRule(player.currency >= cost, 'Not enough currency');
    player.currency -= cost;
    const rerolls = state.shop.rerolls + 1;
    state.shop = { slots: generateShopSlots(state), rerolls };
  }

  function leaveShop(state: GameState) {
    assertRule(state.phase === 'shop', 'The shop is closed');
    state.shop = null;
    if (state.config.runStructure === 'map') state.phase = 'map';
    else prepareRound(state, isBossRound(state));
  }

  // -------------------------------------------------------------------------
  // Map, battles, rewards, rest (map run structure)
  // -------------------------------------------------------------------------

  function enterAct(state: GameState, act: number) {
    state.tier = act;
    state.round = 0;
    const rng = new Rng(state);
    state.map = generateMap(act, state.config.map, rng);
    if (state.config.battleStyle === 'rummy') {
      for (const node of state.map.rows.flat()) {
        if (node.type === 'battle' || node.type === 'elite' || node.type === 'boss') {
          node.encounter = makeEncounter(state, content, node.type, rng);
        }
      }
    }
    state.phase = 'map';
    log(state, `Act ${act + 1} begins.`);
  }

  function soloPlayer(state: GameState, playerId: PlayerId): PlayerState {
    assertRule(state.map, 'Not on a map run');
    return getPlayer(state, playerId);
  }

  function chooseNode(state: GameState, playerId: PlayerId, nodeId: string) {
    const player = soloPlayer(state, playerId);
    assertRule(state.phase === 'map', 'Finish what you are doing first');
    const map = state.map!;
    assertRule(reachableNodes(map).some((n) => n.id === nodeId), 'You cannot reach that stop from here');
    const node = findNode(map, nodeId)!;
    map.current = node.id;
    map.visited.push(node.id);
    state.round += 1;
    const rng = new Rng(state);

    switch (node.type) {
      case 'workshop':
      case 'masterWorkshop':
        prepareRound(state, node.type === 'masterWorkshop');
        break;
      case 'battle':
      case 'elite':
      case 'boss':
        if (state.config.battleStyle === 'rummy') startDuel(state, content, effects, player, node, rng);
        else startBattle(state, content, player, node.type, rng);
        break;
      case 'shop':
        openShop(state);
        break;
      case 'rest':
        state.phase = 'rest';
        break;
    }
  }

  function battleFor(state: GameState, playerId: PlayerId): PlayerState {
    assertRule(state.phase === 'battle' && state.battle, 'No battle in progress');
    assertRule(state.battle.playerId === playerId, 'Not your battle');
    return getPlayer(state, playerId);
  }

  function playCard(state: GameState, playerId: PlayerId, cardUid: string, target?: number) {
    const player = battleFor(state, playerId);
    const won = playBattleCard(state, content, effects, player, cardUid, target, new Rng(state));
    if (won) winBattle(state);
  }

  function endTurn(state: GameState, playerId: PlayerId) {
    const player = battleFor(state, playerId);
    const result = endBattleTurn(state, content, player, new Rng(state));
    if (result === 'lost') {
      log(state, `${player.name} is defeated.`);
      state.battle = null;
      state.phase = 'runLost';
    }
  }

  function winBattle(state: GameState) {
    const battle = state.battle!;
    const player = getPlayer(state, battle.playerId);
    state.reward = makeReward(state, content, battle.kind, new Rng(state));
    player.currency += state.reward.currency;
    player.score += state.reward.currency;
    log(state, `Victory! +${state.reward.currency} currency.`);
    state.battle = null;
    state.phase = 'battleReward';
  }

  function takeReward(state: GameState, playerId: PlayerId, index: number | null) {
    assertRule(state.phase === 'battleReward' && state.reward, 'No reward to take');
    const player = getPlayer(state, playerId);
    const reward = state.reward;
    if (index !== null) {
      const option = reward.options[index];
      assertRule(option, 'No such reward');
      const card =
        option.kind === 'part'
          ? createPart(state, content, player.id, option.category!, option.gauge!)
          : createSpecial(state, player.id, option.specialId!);
      addToDeck(state, card);
      log(state, `${player.name} adds ${cardLabel(state, content, card.id)} to their parts deck.`);
    }
    state.reward = null;

    if (reward.kind !== 'boss') {
      state.phase = 'map';
      return;
    }
    if (state.tier + 1 >= state.config.tiers) {
      state.phase = 'runWon';
      log(state, 'Run complete!');
      return;
    }
    const heal = Math.round(player.maxHp * state.config.battle.actHealFraction);
    player.hp = Math.min(player.maxHp, player.hp + heal);
    enterAct(state, state.tier + 1);
  }

  function rest(state: GameState, playerId: PlayerId, choice: 'heal' | 'repair' | 'recharge' | 'leave', itemUid?: string) {
    assertRule(state.phase === 'rest', 'There is nowhere to rest here');
    const player = getPlayer(state, playerId);
    if (choice === 'leave') {
      log(state, `${player.name} moves on.`);
    } else if (choice === 'heal') {
      assertRule(state.config.battleStyle === 'cards', 'There is no HP to heal in rummy duels');
      const amount = Math.round(player.maxHp * state.config.battle.restHealFraction);
      player.hp = Math.min(player.maxHp, player.hp + amount);
      log(state, `${player.name} rests and recovers ${amount} HP.`);
    } else if (choice === 'recharge') {
      // Resting recharges one gadget for free.
      rechargeItem(state, player, itemUid, true);
    } else {
      const item = player.items.find((i) => i.uid === itemUid);
      assertRule(item, 'Choose an item to repair');
      const max = content.items.find((d) => d.id === item.itemId)?.battle?.uses;
      assertRule(max !== undefined, 'That item never wears out');
      item.usesLeft = max;
      log(state, `${player.name} repairs ${content.items.find((d) => d.id === item.itemId)?.name}.`);
    }
    state.phase = 'map';
  }

  /** Refill a gadget's charges, for its recharge cost unless free. */
  function rechargeItem(state: GameState, player: PlayerState, itemUid: string | undefined, free: boolean) {
    const item = player.items.find((i) => i.uid === itemUid);
    assertRule(item, 'Choose a gadget to recharge');
    const gadget = content.items.find((d) => d.id === item.itemId)?.gadget;
    assertRule(gadget, 'That item has no gadget');
    assertRule((item.charges ?? 0) < gadget.charges, `${gadget.name} is already fully charged`);
    if (!free) {
      assertRule(player.currency >= gadget.rechargeCost, `${gadget.rechargeName} costs ${gadget.rechargeCost} credits`);
      player.currency -= gadget.rechargeCost;
    }
    item.charges = gadget.charges;
    log(state, `${gadget.rechargeName}: ${gadget.name} is fully charged${free ? ' (free at the rest stop)' : ` for ${gadget.rechargeCost} credits`}.`);
  }

  function recharge(state: GameState, playerId: PlayerId, itemUid: string) {
    assertRule(state.phase === 'map' || state.phase === 'shop', 'Recharge between fights, on the map or in a shop');
    rechargeItem(state, getPlayer(state, playerId), itemUid, false);
  }

  // --- Rummy duels --------------------------------------------------------

  function duelPlayer(state: GameState, playerId: PlayerId): PlayerState {
    assertRule(state.duel, 'No duel in progress');
    return getPlayer(state, playerId);
  }

  function continueAfterDuel(state: GameState, player: PlayerState) {
    const duel = finishDuel(state);
    const won = duel.result?.won ?? false;
    if (duel.kind !== 'boss') {
      state.phase = 'map';
      return;
    }
    if (won) {
      if (state.tier + 1 >= state.config.tiers) {
        state.phase = 'runWon';
        log(state, 'Run complete!');
      } else {
        enterAct(state, state.tier + 1);
      }
      return;
    }
    if (player.lives <= 0) {
      state.phase = 'runLost';
      log(state, 'The run is over.');
      return;
    }
    // Step back off the boss node so it can be tried again.
    const map = state.map!;
    map.visited.pop();
    map.current = map.visited.at(-1) ?? null;
    state.phase = 'map';
    log(state, `Regroup and try the boss again (${player.lives} ${player.lives === 1 ? 'life' : 'lives'} left).`);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function reduce(input: GameState, action: GameAction): GameState {
    const state = structuredClone(input);
    switch (action.type) {
      case 'SELECT_BLUEPRINT':
        selectBlueprint(state, action.playerId, action.blueprintId);
        break;
      case 'DRAW':
        draw(state, action.playerId, action.source);
        break;
      case 'PLAY_SPECIAL':
        playSpecial(state, action.playerId, action.cardId, action.targetId);
        break;
      case 'RESOLVE_CHOICE':
        resolveChoice(state, action.playerId, action.cardIds);
        break;
      case 'LOCK_MELD':
        lockMeld(state, action.playerId, action.meldType, action.cardIds);
        break;
      case 'PIVOT':
        pivot(state, action.playerId, action.blueprintId);
        break;
      case 'BUILD':
        build(state, action.playerId, action.groups);
        break;
      case 'DISCARD':
        discard(state, action.playerId, action.cardId);
        break;
      case 'CONTINUE':
        getPlayer(state, action.playerId);
        continueAfterRound(state);
        break;
      case 'SHOP_BUY':
        shopBuy(state, action.playerId, action.slot, action.targetId);
        break;
      case 'SHOP_REROLL':
        shopReroll(state, action.playerId);
        break;
      case 'LEAVE_SHOP':
        getPlayer(state, action.playerId);
        leaveShop(state);
        break;
      case 'CHOOSE_NODE':
        chooseNode(state, action.playerId, action.nodeId);
        break;
      case 'PLAY_CARD':
        playCard(state, action.playerId, action.cardUid, action.target);
        break;
      case 'END_TURN':
        endTurn(state, action.playerId);
        break;
      case 'TAKE_REWARD':
        takeReward(state, action.playerId, action.index);
        break;
      case 'REST':
        rest(state, action.playerId, action.choice, action.itemUid);
        break;
      case 'RECHARGE':
        recharge(state, action.playerId, action.itemUid);
        break;
      case 'DUEL_STAKE':
        placeStake(state, content, duelPlayer(state, action.playerId), action.cardId, new Rng(state));
        break;
      case 'DUEL_DRAW':
        duelPlayer(state, action.playerId);
        duelDraw(state, content, action.source, new Rng(state));
        break;
      case 'DUEL_DISCARD':
        duelDiscard(state, content, effects, duelPlayer(state, action.playerId), action.cardId, new Rng(state));
        break;
      case 'DUEL_GO_OUT':
        duelGoOut(state, content, effects, duelPlayer(state, action.playerId), action.groups);
        break;
      case 'USE_GADGET':
        useGadget(state, content, effects, duelPlayer(state, action.playerId), action.itemUid, action.target, new Rng(state));
        break;
      default: {
        const never: never = action;
        throw new RuleError(`Unknown action ${(never as GameAction).type}`);
      }
    }
    return state;
  }

  function applyAction(state: GameState, action: GameAction): ApplyResult {
    try {
      return { ok: true, state: reduce(state, action) };
    } catch (e) {
      if (e instanceof RuleError) return { ok: false, error: e.message, state };
      throw e;
    }
  }

  function suggestBuild(state: GameState, playerId: PlayerId, cardIds?: CardId[]): CardId[][] | null {
    const player = getPlayer(state, playerId);
    if (!player.target) return null;
    const bp = getBlueprint(content, player.target);
    const allowed = cardIds ? new Set(cardIds) : null;
    const units: MeldUnit[] = [];
    for (const id of player.hand) {
      if (allowed && !allowed.has(id)) continue;
      const t = cardToken(state, content, effects, id);
      if (t) units.push({ tokens: [t] });
    }
    for (const m of player.lockedMelds) {
      if (allowed && !m.cardIds.every((id) => allowed.has(id))) continue;
      const tokens = m.cardIds.map((id) => cardToken(state, content, effects, id)).filter((t): t is MeldToken => !!t);
      units.push({ tokens, lockedType: m.type });
    }
    return findBuild(units, bp.requirements as MeldRequirement[], meldRules(player));
  }

  return {
    content,
    effects,
    newGame,
    reduce,
    applyAction,
    suggestBuild,
    meldRules,
    suggestDuelOut: (state, cardIds) => (state.duel ? findDuelOut(state, content, effects, cardIds ?? state.duel.hand) : null),
    token: (state, id) => cardToken(state, content, effects, id),
  };
}

/** Engine bound to the default content and effects. */
export const engine = createEngine();

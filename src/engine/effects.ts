/**
 * Effect/hook system.
 *
 * Content (specials, items, boss modifiers, shop services) refers to effects
 * by name: `{ "type": "modifyRules", "params": { "handSize": 1 } }`.
 * Each effect type is a handler object implementing any of the hooks below.
 * To add a new kind of effect, add a handler here and reference it from JSON.
 *
 * Hooks that receive an EffectContext may mutate ctx.state (it is a draft
 * the reducer cloned). Throw RuleError to reject an illegal play.
 */

import type { MeldToken } from './melds';
import type { Rng } from './rng';
import type { CardId, ContentPack, EffectRef, GameState, MeldRole, PlayerState, RoundRules } from './types';
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

export interface EffectContext {
  state: GameState;
  content: ContentPack;
  rng: Rng;
  player: PlayerState;
  /** Card that owns the effect (specials). */
  sourceCardId?: CardId;
  /** Target chosen by the player (PLAY_SPECIAL / SHOP_BUY). */
  targetId?: CardId;
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
  /** The player completed a build. */
  onBuild?(ctx: EffectContext, params: Params): void;
  onRoundEnd?(ctx: EffectContext, params: Params): void;
  /** Bought from the shop (services). */
  onPurchase?(ctx: EffectContext, params: Params): void;
}

export type EffectRegistry = Record<string, EffectHandler>;

export type ContextHook = 'onRoundStart' | 'onDraw' | 'onPlay' | 'onBuild' | 'onRoundEnd' | 'onPurchase';

// ---------------------------------------------------------------------------
// Built-in effect handlers
// ---------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);

const drawChoice: EffectHandler = {
  onDraw(ctx, params) {
    startDrawChoice(ctx, params);
  },
  onPlay(ctx, params) {
    startDrawChoice(ctx, params);
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
};

const destroyCardEffect: EffectHandler = {
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
};

const addRandomParts: EffectHandler = {
  onPurchase(ctx, params) {
    const { state, player, rng, content } = ctx;
    for (let i = 0; i < num(params.count, 3); i++) {
      const category = rng.pick(content.categories).id;
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

const modifyRules: EffectHandler = {
  modifyRules(rules, params) {
    rules.handSize += num(params.handSize);
    rules.drawLimit += num(params.drawLimit);
    if (typeof params.allowDiscardDraw === 'boolean') rules.allowDiscardDraw = params.allowDiscardDraw;
    if (typeof params.revealHidden === 'boolean') rules.revealHidden = params.revealHidden;
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

const banCategory: EffectHandler = {
  resolveParams(params, rng, content) {
    if (params.category === 'random' || params.category === undefined) {
      return { ...params, category: rng.pick(content.categories).id };
    }
    return params;
  },
  modifyRules(rules, params) {
    const c = params.category;
    if (typeof c === 'string' && c !== 'random' && !rules.bannedCategories.includes(c)) rules.bannedCategories.push(c);
  },
};

const grantTempCard: EffectHandler = {
  onRoundStart(ctx, params) {
    const { state, player } = ctx;
    for (let i = 0; i < num(params.count, 1); i++) {
      const card = createSpecial(state, player.id, String(params.specialId), true);
      player.hand.push(card.id);
    }
  },
};

const gainCurrency: EffectHandler = {
  onBuild(ctx, params) {
    if (params.hook === 'onBuild') gain(ctx, params);
  },
  onRoundEnd(ctx, params) {
    if (params.hook === undefined || params.hook === 'onRoundEnd') gain(ctx, params);
  },
};

function gain(ctx: EffectContext, params: Params) {
  const amount = num(params.amount, 1);
  ctx.player.currency += amount;
  log(ctx.state, `${ctx.player.name} gains ${amount} currency.`);
}

export const defaultEffects: EffectRegistry = {
  drawChoice,
  reorderTop,
  takeFromDiscard,
  destroyCard: destroyCardEffect,
  addRandomParts,
  meldRole,
  modifyRules,
  banCategory,
  grantTempCard,
  gainCurrency,
};

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

export function getHandler(registry: EffectRegistry, ref: EffectRef): EffectHandler {
  const h = registry[ref.type];
  if (!h) throw new Error(`Unknown effect type "${ref.type}"`);
  return h;
}

/** Run a context hook for each effect ref, in order. */
export function runHook(
  registry: EffectRegistry,
  hook: ContextHook,
  refs: EffectRef[],
  ctx: EffectContext,
  paramOverrides?: Params,
): void {
  for (const ref of refs) {
    const fn = getHandler(registry, ref)[hook];
    if (fn) fn(ctx, { ...(ref.params ?? {}), ...(paramOverrides ?? {}) });
  }
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

/** Effects that apply to every round for a player: their items. */
export function itemEffects(content: ContentPack, player: PlayerState): EffectRef[] {
  return player.items.flatMap((it) => content.items.find((d) => d.id === it.itemId)?.effects ?? []);
}

/** Turn a card into a meld token, or null if it can't be used in melds. */
export function cardToken(state: GameState, content: ContentPack, registry: EffectRegistry, id: CardId): MeldToken | null {
  const card = getCard(state, id);
  if (card.kind === 'part') return { role: 'natural', id, category: card.category, gauge: card.gauge };
  const def = content.specials.find((s) => s.id === card.specialId);
  for (const ref of def?.effects ?? []) {
    const role = getHandler(registry, ref).meldRole?.(ref.params ?? {});
    if (role) return { ...role, id } as MeldToken;
  }
  return null;
}

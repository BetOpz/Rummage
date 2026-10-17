/**
 * Items as cards (docs/CARD_SET.md): drawing tiers, tier params, conditions,
 * collection set bonuses, and charges.
 *
 * An item's grade (Tin 1 ... Platinum 8) sets its drawing tier: Prototype
 * (Tin-Copper), Fine (Brass, Silver) or Masterwork (Gold, Platinum). Any
 * number or flag in an item's effect params can be a tier param, a list of
 * 3 values, one per tier; everything here resolves them before handlers
 * see the params, so handlers only ever read plain values.
 */

import type { GameConfig } from '../config';
import type {
  Condition,
  ContentPack,
  DuelKind,
  DuelState,
  EffectRef,
  GadgetDef,
  GameState,
  ItemDef,
  ItemInstance,
  MinionDef,
  Place,
  PlayerState,
  Tier,
} from './types';
import { assertRule } from './zones';

/** The drawing tier for a grade. */
export function tierOf(grade: number): Tier {
  return grade >= 7 ? 2 : grade >= 5 ? 1 : 0;
}

export const TIER_NAMES = ['Prototype', 'Fine', 'Masterwork'] as const;

/**
 * Keys whose value is a plain list (duel kinds, materials, meld roles): a
 * list of 3 is only a tier param here when its entries are lists too.
 */
const LIST_KEYS = new Set(['kind', 'act', 'disableMeldRoles', 'banCategories', 'categories', 'materials']);

/** Resolve every tier param in a value (params, conditions) to its value at a tier. */
export function atTier(value: unknown, tier: Tier, key?: string): unknown {
  if (Array.isArray(value)) {
    const tiered =
      value.length === 3 &&
      (key && LIST_KEYS.has(key)
        ? value.every(Array.isArray)
        : value.every((x) => x === null || typeof x !== 'object' || Array.isArray(x)));
    if (tiered) return value[tier];
    return value.map((v) => atTier(v, tier));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, atTier(v, tier, k)]));
  }
  return value;
}

/**
 * Numbers that count your items: `{ "perOwned": "clockwork", "per": 2, "max": 3 }`
 * is 1 for every 2 living Clockwork items you own (this one included), up to 3.
 */
function resolveCounts(value: unknown, counts: Record<string, number>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveCounts(v, counts));
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.perOwned === 'string') {
      const n = Math.floor((counts[o.perOwned] ?? 0) / (typeof o.per === 'number' && o.per > 0 ? o.per : 1));
      return typeof o.max === 'number' ? Math.min(o.max, n) : n;
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolveCounts(v, counts)]));
  }
  return value;
}

export function itemDef(content: ContentPack, itemId: string): ItemDef {
  const def = content.items.find((d) => d.id === itemId);
  assertRule(def, `Unknown item "${itemId}"`);
  return def;
}

export function itemTier(item: ItemInstance): Tier {
  return tierOf(item.grade);
}

/** Living items you own in each collection. */
export function collectionCounts(content: ContentPack, player: PlayerState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const it of player.items) {
    const c = content.items.find((d) => d.id === it.itemId)?.collection;
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }
  return counts;
}

/** Collections whose set bonus is on. */
export function activeBonuses(content: ContentPack, config: GameConfig, player: PlayerState): string[] {
  const counts = collectionCounts(content, player);
  return content.collections.filter((c) => (counts[c.id] ?? 0) >= config.collections.bonusAt).map((c) => c.id);
}

/** An effect in play: resolved to its item's tier, with where it came from. */
export interface ActiveEffect extends EffectRef {
  params: Record<string, unknown>;
  /** The item it belongs to (absent for set bonuses). */
  itemUid?: string;
  collection?: string;
  tier: Tier;
}

/** What `when` conditions are checked against. */
export interface Situation {
  kind?: DuelKind;
  opponents?: MinionDef[];
  won?: boolean;
  act: number;
}

export function situationOf(state: GameState, content: ContentPack, extra: { won?: boolean; duel?: Pick<DuelState, 'kind' | 'opponents'> } = {}): Situation {
  const duel = extra.duel ?? (state.duel && ['duelAnte', 'duel', 'duelResult'].includes(state.phase) ? state.duel : null);
  return {
    act: state.tier + 1,
    kind: duel?.kind,
    opponents: duel ? duel.opponents.map((o) => content.minions.find((m) => m.id === o.defId)).filter((m): m is MinionDef => !!m) : undefined,
    // A called-off duel was neither won nor lost.
    won: extra.won ?? (state.duel?.result && !state.duel.result.drawn ? state.duel.result.won : undefined),
  };
}

/** Does a (tier-resolved) condition hold? */
export function conditionHolds(cond: Condition | undefined, s: Situation | undefined): boolean {
  if (!cond) return true;
  if (cond.kind != null && !(s?.kind && cond.kind.includes(s.kind))) return false;
  if (cond.greedyOpponent != null && !!s?.opponents?.some((m) => m.greedy) !== cond.greedyOpponent) return false;
  if (cond.minOpponents != null && (s?.opponents?.length ?? 0) < cond.minOpponents) return false;
  if (cond.won != null && s?.won !== cond.won) return false;
  if (cond.act != null && !(s && cond.act.includes(s.act))) return false;
  return true;
}

function resolveRef(ref: EffectRef, tier: Tier, counts: Record<string, number>): { params: Record<string, unknown>; when?: Condition } {
  return {
    params: resolveCounts(atTier(ref.params ?? {}, tier), counts) as Record<string, unknown>,
    when: ref.when ? (atTier(ref.when, tier) as Condition) : undefined,
  };
}

/**
 * Every passive effect a player has: each living item's passive at its
 * tier, plus set bonuses. With a situation, conditional effects are kept
 * only when their condition holds; without one, they're left out.
 */
export function passiveEffects(content: ContentPack, config: GameConfig, player: PlayerState, situation?: Situation): ActiveEffect[] {
  const counts = collectionCounts(content, player);
  const out: ActiveEffect[] = [];
  const add = (ref: EffectRef, tier: Tier, itemUid: string | undefined, collection: string) => {
    const { params, when } = resolveRef(ref, tier, counts);
    if (when && !(situation && conditionHolds(when, situation))) return;
    out.push({ type: ref.type, params, when, itemUid, collection, tier });
  };
  for (const it of player.items) {
    const def = content.items.find((d) => d.id === it.itemId);
    if (!def) continue;
    for (const ref of def.passive.effects) add(ref, itemTier(it), it.uid, def.collection);
  }
  for (const c of content.collections) {
    if ((counts[c.id] ?? 0) < config.collections.bonusAt) continue;
    for (const ref of c.bonus.effects) add(ref, 0, undefined, c.id);
  }
  return out;
}

/** Engine-side shorthand: passives in the current situation (the duel in progress, if any). */
export function itemEffects(state: GameState, content: ContentPack, player: PlayerState, extra: { won?: boolean; duel?: Pick<DuelState, 'kind' | 'opponents'> } = {}): ActiveEffect[] {
  return passiveEffects(content, state.config, player, situationOf(state, content, extra));
}

/** Sum a numeric param over a player's passives of one type (static bonuses like Appraisers charge 1 less). */
export function passiveSum(content: ContentPack, config: GameConfig, player: PlayerState, type: string, key = 'amount', filter?: (e: ActiveEffect) => boolean): number {
  return passiveEffects(content, config, player)
    .filter((e) => e.type === type && (!filter || filter(e)))
    .reduce((n, e) => n + (typeof e.params[key] === 'number' ? (e.params[key] as number) : 0), 0);
}

/** A gadget's params and condition at an item's tier. */
export function gadgetAt(content: ContentPack, player: PlayerState, item: ItemInstance): { def: ItemDef; gadget: GadgetDef; tier: Tier; effects: ActiveEffect[]; when?: Condition; places: Place[] } {
  const def = itemDef(content, item.itemId);
  assertRule(def.gadget, `${def.name} has no gadget`);
  const tier = itemTier(item);
  const counts = collectionCounts(content, player);
  const effects = def.gadget.effects.map((ref) => {
    const { params, when } = resolveRef(ref, tier, counts);
    return { type: ref.type, params, when, itemUid: item.uid, collection: def.collection, tier };
  });
  return {
    def,
    gadget: def.gadget,
    tier,
    effects,
    when: def.gadget.when ? (atTier(def.gadget.when, tier) as Condition) : undefined,
    places: def.gadget.usedInByTier?.[tier] ?? def.gadget.usedIn,
  };
}

/** Base charges at a grade: base + 1 every `chargeEvery` grades. */
export function gadgetCharges(gadget: GadgetDef, grade: number, config: GameConfig): number {
  return gadget.charges + Math.floor((grade - 1) / Math.max(1, config.quality.chargeEvery));
}

/**
 * Full charges for an item's gadget: the base curve, +1 with
 * `collections.chargeAt` living items of its collection, and charge
 * bonuses from your other items (Orrery, Perpetual Calendar).
 */
export function maxCharges(content: ContentPack, config: GameConfig, item: ItemInstance, player?: PlayerState): number | null {
  const def = content.items.find((d) => d.id === item.itemId);
  if (!def?.gadget) return null;
  let n = gadgetCharges(def.gadget, item.grade, config);
  if (!player) return n;
  if ((collectionCounts(content, player)[def.collection] ?? 0) >= config.collections.chargeAt) n += 1;
  n += passiveSum(content, config, player, 'chargeBonus', 'amount', (e) => e.params.collection === def.collection && e.itemUid !== item.uid);
  return n;
}

/** Credits to recharge an item's gadget (never below 1). */
export function rechargeCost(content: ContentPack, config: GameConfig, item: ItemInstance, player?: PlayerState): number {
  const def = itemDef(content, item.itemId);
  assertRule(def.gadget, `${def.name} has no gadget`);
  const off = player ? passiveSum(content, config, player, 'rechargeDiscount', 'amount', (e) => e.params.collection === def.collection) : 0;
  return Math.max(1, def.gadget.rechargeCost - off);
}

/** Card text at an item's tier. */
export function passiveText(def: ItemDef, tier: Tier): string {
  return def.passive.text[tier];
}

export function gadgetText(def: ItemDef, tier: Tier): string {
  return def.gadget?.text[tier] ?? '';
}

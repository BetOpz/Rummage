/**
 * Sanity-check a content pack: every id reference resolves and every effect
 * type has a handler. Returns a list of problems (empty = OK).
 */

import type { GameConfig } from '../config';
import type { EffectRegistry } from './effects';
import type { ContentPack, EffectRef } from './types';

export function validateContent(content: ContentPack, effects: EffectRegistry, config?: GameConfig): string[] {
  const problems: string[] = [];
  const catIds = new Set(content.categories.map((c) => c.id));
  const itemIds = new Set(content.items.map((i) => i.id));
  const specialIds = new Set(content.specials.map((s) => s.id));

  const dupes = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`Duplicate ${label} id "${id}"`);
      seen.add(id);
    }
  };
  dupes('category', content.categories.map((c) => c.id));
  dupes('item', content.items.map((i) => i.id));
  dupes('special', content.specials.map((s) => s.id));
  dupes('blueprint', content.blueprints.map((b) => b.id));
  dupes('boss modifier', content.bossModifiers.map((b) => b.id));

  const checkEffects = (owner: string, refs: EffectRef[]) => {
    for (const ref of refs) {
      if (!effects[ref.type]) problems.push(`${owner}: unknown effect type "${ref.type}"`);
      const sp = ref.params?.specialId;
      if (typeof sp === 'string' && !specialIds.has(sp)) problems.push(`${owner}: unknown special "${sp}"`);
    }
  };

  for (const s of content.specials) checkEffects(`special ${s.id}`, s.effects);
  for (const i of content.items) checkEffects(`item ${i.id}`, i.passive.effects);
  for (const b of content.bossModifiers) checkEffects(`boss modifier ${b.id}`, b.effects);
  for (const i of content.items) if (i.battle) checkEffects(`item ${i.id} battle card`, i.battle.effects);
  for (const c of content.starterCards) checkEffects(`starter card ${c.id}`, c.effects);
  dupes('starter card', content.starterCards.map((c) => c.id));
  dupes('enemy', content.enemies.map((e) => e.id));
  for (const e of content.enemies) {
    if (e.intents.length === 0) problems.push(`enemy ${e.id}: no intents`);
    if (e.hp <= 0) problems.push(`enemy ${e.id}: hp must be positive`);
  }
  for (const kind of ['normal', 'elite', 'boss'] as const) {
    if (!content.enemies.some((e) => e.kind === kind)) problems.push(`No ${kind} enemies`);
    if (!content.minions.some((m) => m.kind === kind)) problems.push(`No ${kind} minions`);
    if (!content.duelTargets.some((t) => t.kind === kind)) problems.push(`No ${kind} duel targets`);
  }
  dupes('minion', content.minions.map((m) => m.id));
  dupes('duel target', content.duelTargets.map((t) => t.id));
  for (const m of content.minions) {
    for (const c of m.deck.categories ?? []) if (!catIds.has(c)) problems.push(`minion ${m.id}: unknown category "${c}"`);
    if (m.deck.gauges[0] > m.deck.gauges[1]) problems.push(`minion ${m.id}: bad gauge range`);
  }
  for (const i of content.items) if (i.gadget) checkEffects(`item ${i.id} gadget`, i.gadget.effects);
  for (const pool of content.shopPools) {
    for (const svc of pool.services) checkEffects(`shop service ${svc.id}`, [svc.effect]);
    for (const c of Object.keys(pool.categoryWeights ?? {})) {
      if (!catIds.has(c)) problems.push(`shop pool tier ${pool.tier}: unknown category "${c}"`);
    }
  }

  for (const bp of content.blueprints) {
    if (!itemIds.has(bp.itemId)) problems.push(`blueprint ${bp.id}: unknown item "${bp.itemId}"`);
    if (bp.requirements.length === 0) problems.push(`blueprint ${bp.id}: no requirements`);
    for (const r of bp.requirements) {
      if (r.category && !catIds.has(r.category)) problems.push(`blueprint ${bp.id}: unknown category "${r.category}"`);
      if (r.size < 1) problems.push(`blueprint ${bp.id}: meld size must be >= 1`);
    }
  }

  if (content.shopPools.length === 0) problems.push('No shop pools');
  if (config) {
    for (let t = 1; t <= config.tiers; t++) {
      if (!content.blueprints.some((b) => !b.boss && b.tier <= t)) problems.push(`No blueprints for tier ${t}`);
    }
    for (const id of config.startingDeck.specials) {
      if (!specialIds.has(id)) problems.push(`config.startingDeck: unknown special "${id}"`);
    }
    if (config.startingDeck.categories !== 'all') {
      for (const c of config.startingDeck.categories) {
        if (!catIds.has(c)) problems.push(`config.startingDeck: unknown category "${c}"`);
      }
    }
    for (const id of config.battle.starterDeck) {
      if (!content.starterCards.some((c) => c.id === id)) problems.push(`config.battle.starterDeck: unknown card "${id}"`);
    }
    for (const id of config.challengeModifiers) {
      if (!content.bossModifiers.some((b) => b.id === id)) problems.push(`config.challengeModifiers: unknown "${id}"`);
    }
  }
  return problems;
}

/**
 * Materials and item grades. Every part category is a material with a
 * grade, one material per grade: Tin 1, Wood 2, Iron 3, Copper 4, Brass 5,
 * Silver 6, Gold 7, Platinum 8. An item's grade is the average grade of the
 * parts it was built from, plus any gem bonuses (Ruby Bearing, Diamond
 * Movement), up to the top material. Higher grades give gadgets more
 * charges and stronger effects.
 */

import type { GameConfig } from '../config';
import type { Rng } from './rng';
import type { CardId, CategoryDef, ContentPack, GadgetDef, GameState, ItemInstance } from './types';

/** Categories used for starting decks and minion decks (no rare materials). */
export function commonCategories(content: ContentPack): CategoryDef[] {
  return content.categories.filter((c) => !c.rare);
}

/** A random material for shops, rewards and pots, weighted so rare ones are rare. */
export function randomCategory(content: ContentPack, rng: Rng, weights?: Record<string, number>): CategoryDef {
  return rng.weightedPick(content.categories, (c) => weights?.[c.id] ?? c.weight ?? 1);
}

/** Highest grade an item can reach: the top material, plus any extra grade names. */
export function maxGrade(content: ContentPack, config: GameConfig): number {
  return Math.max(...content.categories.map((c) => c.grade)) + config.quality.extraGradeNames.length;
}

/** Grade an item built from these cards would have. */
export function gradeOf(state: GameState, content: ContentPack, cardIds: CardId[], config: GameConfig): number {
  let total = 0;
  let parts = 0;
  let bonus = 0;
  for (const id of cardIds) {
    const card = state.cards[id];
    if (!card) continue;
    if (card.kind === 'part') {
      total += content.categories.find((c) => c.id === card.category)?.grade ?? 1;
      parts += 1;
    } else {
      bonus += content.specials.find((s) => s.id === card.specialId)?.gradeBonus ?? 0;
    }
  }
  const base = parts > 0 ? Math.round(total / parts) : 1;
  const top = maxGrade(content, config);
  return Math.min(top, Math.max(1, base + bonus));
}

export function materialName(content: ContentPack, config: GameConfig, grade: number): string {
  const exact = content.categories.find((c) => c.grade === grade);
  if (exact) return exact.name;
  const top = Math.max(...content.categories.map((c) => c.grade));
  if (grade > top) {
    const extra = config.quality.extraGradeNames;
    return extra[Math.min(grade - top - 1, extra.length - 1)] ?? `Grade ${grade}`;
  }
  return `Grade ${grade}`;
}

/** Full charges for a gadget at a grade. */
export function gadgetCharges(gadget: GadgetDef, grade: number, config: GameConfig): number {
  return gadget.charges + Math.floor((grade - 1) * config.quality.chargesPerGrade);
}

export function itemMaxCharges(content: ContentPack, config: GameConfig, item: ItemInstance): number | null {
  const gadget = content.items.find((d) => d.id === item.itemId)?.gadget;
  return gadget ? gadgetCharges(gadget, item.grade, config) : null;
}

/** `base + floor(perGrade * (grade - 1))`: how gadget effects get stronger with grade. */
export function byGrade(base: number, perGrade: unknown, grade: number): number {
  return base + Math.floor((typeof perGrade === 'number' ? perGrade : 0) * (grade - 1));
}

export interface UpgradeCheck {
  ok: boolean;
  reason?: string;
  newGrade: number;
  credits: number;
}

/**
 * Can these cards upgrade the item? Either `upgradeParts` parts whose
 * material grade is at least the new grade, or a single gem card (which
 * adds its grade bonus).
 */
export function checkUpgrade(
  state: GameState,
  content: ContentPack,
  config: GameConfig,
  item: ItemInstance,
  cardIds: CardId[],
): UpgradeCheck {
  const fail = (reason: string): UpgradeCheck => ({ ok: false, reason, newGrade: item.grade, credits: 0 });
  const cards = cardIds.map((id) => state.cards[id]).filter(Boolean);
  if (cards.length !== cardIds.length || new Set(cardIds).size !== cardIds.length) return fail('Choose cards from your parts deck');

  const top = maxGrade(content, config);
  if (item.grade >= top) return fail(`Already ${materialName(content, config, top)}, the top grade`);
  let newGrade = item.grade + 1;
  if (cards.length === 1 && cards[0].kind === 'special') {
    const bonus = content.specials.find((s) => cards[0].kind === 'special' && s.id === cards[0].specialId)?.gradeBonus ?? 0;
    if (bonus <= 0) return fail('Only gems can upgrade an item on their own');
    newGrade = Math.min(top, item.grade + bonus);
  } else {
    const need = config.quality.upgradeParts;
    if (cards.length !== need) return fail(`Choose ${need} parts`);
    for (const c of cards) {
      if (c.kind !== 'part') return fail('Use parts, or a single gem');
      const g = content.categories.find((x) => x.id === c.category)?.grade ?? 0;
      if (g < newGrade) {
        return fail(`Upgrading to ${materialName(content, config, newGrade)} needs ${materialName(content, config, newGrade)} parts or better`);
      }
    }
  }
  return { ok: true, newGrade, credits: config.quality.upgradeCreditsPerGrade * newGrade };
}

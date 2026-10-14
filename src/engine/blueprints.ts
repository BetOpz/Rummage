/** Blueprint lookup and display helpers. */

import type { BlueprintDef, ContentPack, MeldRequirement } from './types';

export function getBlueprint(content: ContentPack, id: string): BlueprintDef {
  const bp = content.blueprints.find((b) => b.id === id);
  if (!bp) throw new Error(`Unknown blueprint ${id}`);
  return bp;
}

/**
 * Blueprints available for a 1-based tier. If the content has none for that
 * tier, falls back to the highest tier below it that has some.
 */
export function blueprintsForTier(content: ContentPack, tier: number, boss: boolean): BlueprintDef[] {
  const pool = content.blueprints.filter((b) => Boolean(b.boss) === boss);
  for (let t = tier; t >= 1; t--) {
    const found = pool.filter((b) => b.tier === t);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * Plain-English requirement, explicit about the shape so it can't be
 * mistaken for the other kind of meld:
 *   "Set of 3 (same number, any category)"
 *   "Run of 4 (Copper, numbers in a row)"
 */
export function describeRequirement(req: MeldRequirement, categoryName: (id: string) => string = (id) => id): string {
  const gauge =
    req.minGauge !== undefined && req.maxGauge !== undefined
      ? `numbers ${req.minGauge}-${req.maxGauge}`
      : req.minGauge !== undefined
        ? `numbers ${req.minGauge}+`
        : req.maxGauge !== undefined
          ? `numbers ${req.maxGauge} or less`
          : null;
  const details =
    req.type === 'set'
      ? ['same number', req.category ? `all ${categoryName(req.category)}` : 'any category']
      : [req.category ? categoryName(req.category) : 'one category', 'numbers in a row'];
  if (gauge) details.push(gauge);
  return `${req.type === 'set' ? 'Set' : 'Run'} of ${req.size} (${details.join(', ')})`;
}

/** Requirements as the player may see them; hidden ones become null. */
export function visibleRequirements(bp: BlueprintDef, revealed: boolean): (MeldRequirement | null)[] {
  return bp.requirements.map((r) => (r.hidden && !revealed ? null : r));
}

/** Total slots a blueprint needs (a rough difficulty measure). */
export function blueprintSize(bp: BlueprintDef): number {
  return bp.requirements.reduce((n, r) => n + r.size, 0);
}

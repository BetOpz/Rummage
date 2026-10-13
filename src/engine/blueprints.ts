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

export function describeRequirement(req: MeldRequirement, categoryName: (id: string) => string = (id) => id): string {
  const parts = [`${req.type === 'set' ? 'Set' : 'Run'} of ${req.size}`];
  if (req.category) parts.push(categoryName(req.category));
  if (req.minGauge !== undefined && req.maxGauge !== undefined) parts.push(`gauge ${req.minGauge}-${req.maxGauge}`);
  else if (req.minGauge !== undefined) parts.push(`gauge ${req.minGauge}+`);
  else if (req.maxGauge !== undefined) parts.push(`gauge ≤${req.maxGauge}`);
  return parts.join(', ');
}

/** Requirements as the player may see them; hidden ones become null. */
export function visibleRequirements(bp: BlueprintDef, revealed: boolean): (MeldRequirement | null)[] {
  return bp.requirements.map((r) => (r.hidden && !revealed ? null : r));
}

/** Total slots a blueprint needs (a rough difficulty measure). */
export function blueprintSize(bp: BlueprintDef): number {
  return bp.requirements.reduce((n, r) => n + r.size, 0);
}

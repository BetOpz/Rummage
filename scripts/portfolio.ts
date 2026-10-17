/**
 * Card set check: validates src/content/items.json against the set rules in
 * docs/CARD_SET.md and reports how far the set is from its targets.
 * Usage: npm run portfolio            (summary)
 *        npm run portfolio -- --list  (also list every card)
 * Exits 1 if any card breaks a rule.
 */
import { defaultContent } from '../src/content';
import { defaultEffects } from '../src/engine/effects';
import type { ItemDef, Place } from '../src/engine/types';

const COLLECTIONS = defaultContent.collections.map((c) => c.id);
const RARITIES = ['common', 'uncommon', 'rare', 'heirloom'] as const;
const ROLES = ['tempo', 'flexibility', 'disruption', 'discard', 'information', 'stakes', 'credits', 'lots', 'scrapbook', 'bosses', 'route', 'synergy'] as const;
const PLACES: Place[] = ['duel', 'lot', 'map', 'shop', 'scrapbook', 'duelResult'];
const TARGETS = ['none', 'opponent', 'handCard', 'discardCard'] as const;

/** Cards per collection, by rarity (docs/CARD_SET.md section 2). */
const PER_COLLECTION: Record<(typeof RARITIES)[number], number> = { common: 8, uncommon: 6, rare: 4, heirloom: 2 };
/** Allowed base charges and recharge costs, by rarity. */
const LIMITS: Record<(typeof RARITIES)[number], { charges: [number, number]; recharge: [number, number] }> = {
  common: { charges: [1, 2], recharge: [2, 4] },
  uncommon: { charges: [1, 2], recharge: [3, 6] },
  rare: { charges: [1, 2], recharge: [4, 7] },
  heirloom: { charges: [1, 1], recharge: [6, 9] },
};
/** Fixtures (items with no gadget) allowed per collection, Commons only. */
const FIXTURES_PER_COLLECTION = 2;

const cards: ItemDef[] = defaultContent.items;
const errors: string[] = [];
const err = (c: ItemDef | undefined, msg: string) => errors.push(`${c ? `${c.id}: ` : ''}${msg}`);
const oneOf = <T extends readonly string[]>(list: T, v: string): boolean => (list as readonly string[]).includes(v);
const tiered = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((s) => typeof s === 'string' && s.trim().length > 0);

const ids = new Set<string>();
const names = new Set<string>();
const gadgetNames = new Map<string, string>();
const places = (c: ItemDef) => new Set([...(c.gadget?.usedIn ?? []), ...(c.gadget?.usedInByTier?.flat() ?? [])]);

for (const c of cards) {
  if (!/^[a-z][a-z0-9_]*$/.test(c.id ?? '')) err(c, 'id must be snake_case');
  if (ids.has(c.id)) err(c, 'duplicate id');
  ids.add(c.id);
  if (names.has(c.name)) err(c, `duplicate name "${c.name}"`);
  names.add(c.name);
  if (!COLLECTIONS.includes(c.collection)) err(c, `unknown collection "${c.collection}"`);
  if (!oneOf(RARITIES, c.rarity)) err(c, `unknown rarity "${c.rarity}"`);
  if (!oneOf(ROLES, c.role)) err(c, `unknown role "${c.role}"`);
  if (!c.object) err(c, 'needs an object description');
  if (!tiered(c.passive?.text)) err(c, 'passive.text needs 3 entries (Prototype, Fine, Masterwork)');
  if (!Array.isArray(c.passive?.effects) || c.passive.effects.length === 0) err(c, 'passive needs effects');
  if (!tiered(c.art)) err(c, 'art needs 3 entries (Prototype, Fine, Masterwork)');
  for (const ref of c.passive?.effects ?? []) if (!defaultEffects[ref.type]) err(c, `passive effect "${ref.type}" has no handler`);

  const g = c.gadget;
  if (!g) {
    if (c.rarity !== 'common') err(c, 'only Commons can be fixtures (no gadget)');
  } else {
    if (!g.name) err(c, 'gadget needs a name');
    const other = gadgetNames.get(g.name);
    if (other) err(c, `gadget name "${g.name}" is also used by ${other}`);
    gadgetNames.set(g.name, c.id);
    if (!Array.isArray(g.usedIn) || g.usedIn.length === 0 || !g.usedIn.every((p) => PLACES.includes(p))) err(c, `gadget.usedIn must list places from ${PLACES.join(', ')}`);
    if (g.usedInByTier && (g.usedInByTier.length !== 3 || !g.usedInByTier.flat().every((p) => PLACES.includes(p)))) err(c, 'gadget.usedInByTier needs 3 lists of places');
    if (!oneOf(TARGETS, g.target)) err(c, `gadget.target must be one of ${TARGETS.join(', ')}`);
    if (!tiered(g.text)) err(c, 'gadget.text needs 3 entries (Prototype, Fine, Masterwork)');
    if (!Array.isArray(g.effects) || g.effects.length === 0) err(c, 'gadget needs effects');
    if (!g.rechargeName) err(c, 'gadget needs a recharge name');
    const lim = LIMITS[c.rarity];
    if (lim) {
      if (!(g.charges >= lim.charges[0] && g.charges <= lim.charges[1])) err(c, `${c.rarity} base charges must be ${lim.charges.join('-')} (got ${g.charges})`);
      if (!(g.rechargeCost >= lim.recharge[0] && g.rechargeCost <= lim.recharge[1])) err(c, `${c.rarity} recharge cost must be ${lim.recharge.join('-')} (got ${g.rechargeCost})`);
    }
    // Every gadget effect must work in at least one place the gadget is used.
    for (const ref of g.effects) {
      const h = defaultEffects[ref.type];
      if (!h?.onGadget) err(c, `gadget effect "${ref.type}" has no gadget handler`);
      else if (![...places(c)].some((p) => (h.places ?? ['duel']).includes(p))) err(c, `gadget effect "${ref.type}" works in none of ${[...places(c)].join(', ')}`);
    }
  }
  // Tier params: any array param of numbers or booleans must have exactly 3 entries.
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      if (v.length > 0 && v.every((x) => typeof x !== 'object' || Array.isArray(x)) && v.length !== 3 && !path.endsWith('disableMeldRoles')) {
        err(c, `${path} looks like a tier param but has ${v.length} entries, not 3`);
      }
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  c.passive?.effects.forEach((e, i) => walk(e.params, `passive.effects[${i}].params`));
  c.gadget?.effects.forEach((e, i) => walk(e.params, `gadget.effects[${i}].params`));
}

for (const col of COLLECTIONS) {
  const fixtures = cards.filter((c) => c.collection === col && !c.gadget).length;
  if (fixtures > FIXTURES_PER_COLLECTION) err(undefined, `${col} has ${fixtures} fixtures (max ${FIXTURES_PER_COLLECTION})`);
  for (const r of RARITIES) {
    const n = cards.filter((c) => c.collection === col && c.rarity === r).length;
    if (n > PER_COLLECTION[r]) err(undefined, `${col} has ${n} ${r} cards (target ${PER_COLLECTION[r]})`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const total = COLLECTIONS.length * Object.values(PER_COLLECTION).reduce((a, b) => a + b, 0);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
const count = (f: (c: ItemDef) => boolean) => cards.filter(f).length;

console.log(`Cards: ${cards.length} / ${total}\n`);
console.log(`${pad('Collection', 16)}${RARITIES.map((r) => padL(r.slice(0, 4), 8)).join('')}${padL('total', 8)}`);
for (const col of COLLECTIONS) {
  const cells = RARITIES.map((r) => padL(`${count((c) => c.collection === col && c.rarity === r)}/${PER_COLLECTION[r]}`, 8));
  console.log(`${pad(col, 16)}${cells.join('')}${padL(`${count((c) => c.collection === col)}/20`, 8)}`);
}
console.log('\nRoles:');
console.log(ROLES.map((r) => `  ${pad(r, 13)}${count((c) => c.role === r)}`).join('\n'));
console.log('\nGadgets used in:');
for (const p of PLACES) console.log(`  ${pad(p, 13)}${count((c) => places(c).has(p))}`);
console.log(`  ${pad('(fixtures)', 13)}${count((c) => !c.gadget)}`);

if (process.argv.includes('--list')) {
  console.log('\nCards:');
  for (const c of cards) {
    console.log(`  ${pad(c.name, 20)}${pad(c.collection, 16)}${pad(c.rarity, 10)}${pad(c.role, 13)}${c.gadget ? `${c.gadget.name} (${c.gadget.usedIn.join('/')})` : 'fixture'}`);
  }
}

if (errors.length) {
  console.log(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('\nNo problems found.');

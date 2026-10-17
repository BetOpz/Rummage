/**
 * Card portfolio check: validates design/card-portfolio.json against the set
 * rules in docs/CARD_SET.md and reports how far the set is from its targets.
 * Usage: npm run portfolio            (summary)
 *        npm run portfolio -- --list  (also list every card)
 * Exits 1 if any card breaks a rule.
 */
import { readFileSync } from 'node:fs';
import items from '../src/content/items.json';

const COLLECTIONS = ['clockwork', 'optics', 'workshop', 'haberdashery', 'counting_house', 'scrapyard', 'hearth', 'playroom', 'expedition', 'apothecary'] as const;
const RARITIES = ['common', 'uncommon', 'rare', 'heirloom'] as const;
const ROLES = ['tempo', 'flexibility', 'disruption', 'discard', 'information', 'stakes', 'credits', 'lots', 'scrapbook', 'bosses', 'route', 'synergy'] as const;
const PLACES = ['duel', 'lot', 'map', 'shop', 'scrapbook', 'duelResult'] as const;
const TARGETS = ['none', 'opponent', 'handCard', 'discardCard'] as const;
const STATUSES = ['live', 'draft', 'cut'] as const;
const BUILDS = ['json', 'small', 'new'] as const;

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

type Card = {
  id: string;
  name: string;
  status: string;
  batch: number;
  collection: string;
  rarity: (typeof RARITIES)[number];
  role: string;
  object: string;
  passive: { text: string[]; effects: unknown[] };
  gadget: null | {
    name: string;
    usedIn: string[];
    target: string;
    charges: number;
    rechargeName: string;
    rechargeCost: number;
    text: string[];
    effects: unknown[];
    /** Places by tier, when a later tier adds one (e.g. use after losing). */
    usedInByTier?: string[][];
  };
  engine: { build: string; needs: string[] };
  rules: string[];
  art: string[];
};

const file = JSON.parse(readFileSync(new URL('../design/card-portfolio.json', import.meta.url), 'utf8')) as { cards: Card[] };
const cards = file.cards;
const errors: string[] = [];
const err = (c: Card | undefined, msg: string) => errors.push(`${c ? `${c.id}: ` : ''}${msg}`);
const oneOf = <T extends readonly string[]>(list: T, v: string): v is T[number] => (list as readonly string[]).includes(v);
const tiered = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((s) => typeof s === 'string' && s.trim().length > 0);

const ids = new Set<string>();
const names = new Set<string>();
const gadgetNames = new Map<string, string>();
const liveIds = new Set(items.map((i) => i.id));

for (const c of cards) {
  if (!/^[a-z][a-z0-9_]*$/.test(c.id ?? '')) err(c, 'id must be snake_case');
  if (ids.has(c.id)) err(c, 'duplicate id');
  ids.add(c.id);
  if (names.has(c.name)) err(c, `duplicate name "${c.name}"`);
  names.add(c.name);
  if (!oneOf(STATUSES, c.status)) err(c, `status must be one of ${STATUSES.join(', ')}`);
  if (c.status === 'live' && !liveIds.has(c.id)) err(c, 'marked live but not in src/content/items.json');
  if (c.status !== 'live' && liveIds.has(c.id)) err(c, 'in src/content/items.json but not marked live');
  if (!oneOf(COLLECTIONS, c.collection)) err(c, `unknown collection "${c.collection}"`);
  if (!oneOf(RARITIES, c.rarity)) err(c, `unknown rarity "${c.rarity}"`);
  if (!oneOf(ROLES, c.role)) err(c, `unknown role "${c.role}"`);
  if (!c.object) err(c, 'needs an object description');
  if (!tiered(c.passive?.text)) err(c, 'passive.text needs 3 entries (Prototype, Fine, Masterwork)');
  if (!Array.isArray(c.passive?.effects) || c.passive.effects.length === 0) err(c, 'passive needs effects');
  if (!tiered(c.art)) err(c, 'art needs 3 entries (Prototype, Fine, Masterwork)');
  if (!oneOf(BUILDS, c.engine?.build)) err(c, `engine.build must be one of ${BUILDS.join(', ')}`);
  if (!Array.isArray(c.engine?.needs)) err(c, 'engine.needs must be a list');
  if (c.engine?.build === 'json' && c.engine.needs.length > 0) err(c, 'engine.build is json but it lists engine needs');
  if (c.engine?.build !== 'json' && c.engine?.needs.length === 0) err(c, 'engine.build needs work but no needs are listed');

  const g = c.gadget;
  if (!g) {
    if (c.rarity !== 'common') err(c, 'only Commons can be fixtures (no gadget)');
  } else {
    if (!g.name) err(c, 'gadget needs a name');
    const other = gadgetNames.get(g.name);
    if (other) err(c, `gadget name "${g.name}" is also used by ${other}`);
    gadgetNames.set(g.name, c.id);
    if (!Array.isArray(g.usedIn) || g.usedIn.length === 0 || !g.usedIn.every((p) => oneOf(PLACES, p))) err(c, `gadget.usedIn must list places from ${PLACES.join(', ')}`);
    if (g.usedInByTier && (g.usedInByTier.length !== 3 || !g.usedInByTier.flat().every((p) => oneOf(PLACES, p)))) err(c, 'gadget.usedInByTier needs 3 lists of places');
    if (!oneOf(TARGETS, g.target)) err(c, `gadget.target must be one of ${TARGETS.join(', ')}`);
    if (!tiered(g.text)) err(c, 'gadget.text needs 3 entries (Prototype, Fine, Masterwork)');
    if (!Array.isArray(g.effects) || g.effects.length === 0) err(c, 'gadget needs effects');
    if (!g.rechargeName) err(c, 'gadget needs a recharge name');
    const lim = LIMITS[c.rarity];
    if (lim) {
      if (!(g.charges >= lim.charges[0] && g.charges <= lim.charges[1])) err(c, `${c.rarity} base charges must be ${lim.charges.join('-')} (got ${g.charges})`);
      if (!(g.rechargeCost >= lim.recharge[0] && g.rechargeCost <= lim.recharge[1])) err(c, `${c.rarity} recharge cost must be ${lim.recharge.join('-')} (got ${g.rechargeCost})`);
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
  c.passive?.effects.forEach((e, i) => walk((e as { params?: unknown }).params, `passive.effects[${i}].params`));
  c.gadget?.effects.forEach((e, i) => walk((e as { params?: unknown }).params, `gadget.effects[${i}].params`));
}

for (const live of liveIds) if (!ids.has(live)) err(undefined, `live item ${live} is missing from the portfolio`);

const active = cards.filter((c) => c.status !== 'cut');
for (const col of COLLECTIONS) {
  const fixtures = active.filter((c) => c.collection === col && !c.gadget).length;
  if (fixtures > FIXTURES_PER_COLLECTION) err(undefined, `${col} has ${fixtures} fixtures (max ${FIXTURES_PER_COLLECTION})`);
  for (const r of RARITIES) {
    const n = active.filter((c) => c.collection === col && c.rarity === r).length;
    if (n > PER_COLLECTION[r]) err(undefined, `${col} has ${n} ${r} cards (target ${PER_COLLECTION[r]})`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const total = COLLECTIONS.length * Object.values(PER_COLLECTION).reduce((a, b) => a + b, 0);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
const count = (f: (c: Card) => boolean) => active.filter(f).length;
const places = (c: Card) => new Set([...(c.gadget?.usedIn ?? []), ...(c.gadget?.usedInByTier?.flat() ?? [])]);

console.log(`Cards: ${active.length} / ${total}  (live ${count((c) => c.status === 'live')}, draft ${count((c) => c.status === 'draft')}, cut ${cards.length - active.length})\n`);

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

console.log('\nEngine work:');
for (const b of BUILDS) console.log(`  ${pad(b, 13)}${count((c) => c.engine?.build === b)}`);
const needs = new Map<string, string[]>();
for (const c of active) for (const n of c.engine?.needs ?? []) needs.set(n, [...(needs.get(n) ?? []), c.id]);
console.log('\nEngine needs, by number of cards waiting on them:');
for (const [n, list] of [...needs].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
  console.log(`  ${padL(list.length, 3)}  ${pad(n, 28)}${list.length <= 4 ? list.join(', ') : ''}`);
}

if (process.argv.includes('--list')) {
  console.log('\nCards:');
  for (const c of active) {
    console.log(`  ${pad(c.name, 20)}${pad(c.collection, 16)}${pad(c.rarity, 10)}${pad(c.role, 13)}${c.gadget ? `${c.gadget.name} (${c.gadget.usedIn.join('/')})` : 'fixture'}`);
  }
}

if (errors.length) {
  console.log(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('\nNo problems found.');

/**
 * Scrapbook runs: duels are fought over lots (boxes of wrapped parcels),
 * and the parts you win fill pages in your scrapbook. Each item has a page
 * with one stage per material, Tin to Platinum; finishing a stage brings
 * that item to life at that grade (or raises it, if you already have it).
 *
 * A lot shows how many parcels it holds and how many the winner picks.
 * Every parcel starts wrapped. Tools find out more before you choose:
 * Calipers pin down the number and narrow the metal to a short list,
 * Scratch Tests pin down the metal and narrow the number, and Unwrap shows
 * everything. The real piece is always in the list, and each parcel's
 * look-alikes are fixed when the lot is made, so repeated checks never
 * contradict each other.
 */

import type { GameConfig } from '../config';
import { itemDef, maxCharges, passiveEffects, passiveSum } from './items';
import { materialName } from './quality';
import type { Rng } from './rng';
import type {
  CardId,
  ContentPack,
  DuelKind,
  GameState,
  Lot,
  LotDef,
  MapNode,
  Parcel,
  PieceDestination,
  PlayerState,
  Rarity,
  RewardOption,
  ToolDef,
} from './types';
import { addToDeck, assertRule, createPart, createSpecial, log, partName } from './zones';

const actFits = (act: number, d: { minAct?: number; maxAct?: number }) =>
  (d.minAct ?? 1) <= act && (d.maxAct ?? Infinity) >= act;

export const gradeOfCategory = (content: ContentPack, id: string | undefined) =>
  content.categories.find((c) => c.id === id)?.grade ?? 1;

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'heirloom'];

/** How many look-alikes each parcel keeps (the widest check shows 1 of this many + 1). */
const ALTERNATIVES = 3;

// ---------------------------------------------------------------------------
// Lots and parcels
// ---------------------------------------------------------------------------

/** Roll a lot for a duel stop: its parcels, and each parcel's look-alikes. */
export function makeLot(state: GameState, content: ContentPack, kind: DuelKind, rng: Rng): Lot {
  const act = state.tier + 1;
  let pool = content.lots.filter((l) => l.kinds.includes(kind) && actFits(act, l));
  if (pool.length === 0) pool = content.lots.filter((l) => l.kinds.includes(kind));
  assertRule(pool.length > 0, `No lots for ${kind} duels in the content`);
  const def = rng.weightedPick(pool, (l) => l.weight);
  const count = rng.int(def.size[0], def.size[1]);

  const pieces: RewardOption[] = [];
  for (let i = 0; i < count; i++) pieces.push(rollPiece(content, def, rng));
  const gems = content.specials.filter((s) => (s.gradeBonus ?? 0) > 0);
  if (gems.length > 0 && rng.float() < def.gemChance) {
    pieces[rng.int(0, pieces.length - 1)] = { kind: 'special', specialId: rng.weightedPick(gems, (g) => g.weight).id };
  }
  // Loose pages: a chance of one, and the boss lot always holds a good one.
  if (state.config.scrapbook.pages) {
    const page = def.pageAtLeast ? rollPage(state, content, rng, def.pageAtLeast) : rng.float() < (def.pageChance ?? 0) ? rollPage(state, content, rng) : null;
    if (page) pieces[rng.int(0, pieces.length - 1)] = { kind: 'page', itemId: page };
  }
  const parcels = pieces.map((piece) => makeParcel(content, def, piece, rng));
  return { lotId: def.id, name: def.name, picks: Math.min(def.picks, parcels.length), parcels };
}

/** Add parcels to a lot from its own table (Wind-Up Key, the Scrapyard bonus). */
export function addParcels(content: ContentPack, lot: Lot, count: number, rng: Rng): void {
  const def = content.lots.find((l) => l.id === lot.lotId);
  if (!def) return;
  for (let i = 0; i < count; i++) lot.parcels.push(makeParcel(content, def, rollPiece(content, def, rng), rng));
}

/**
 * A page not yet in the scrapbook, its rarity rolled from the act's odds
 * (at least `atLeast`). Null if there's none left to find.
 */
export function rollPage(state: GameState, content: ContentPack, rng: Rng, atLeast?: Rarity): string | null {
  const cfg = state.config.scrapbook.pages;
  if (!cfg) return null;
  const owned = new Set(state.players[0]?.pages ?? []);
  const odds = cfg.rarityByAct[Math.min(state.tier, cfg.rarityByAct.length - 1)];
  const min = atLeast ? RARITIES.indexOf(atLeast) : 0;
  const open = (r: Rarity) => content.items.filter((d) => d.rarity === r && !owned.has(d.id));
  const rarities = RARITIES.filter((r, i) => i >= min && open(r).length > 0);
  if (rarities.length === 0) return null;
  // Rarities with no odds this act still turn up when a minimum forces them.
  const rarity = rng.weightedPick(rarities, (r) => odds[RARITIES.indexOf(r)] || (atLeast ? 1 : 0));
  return rng.pick(open(rarity)).id;
}

function rollPiece(content: ContentPack, def: LotDef, rng: Rng): RewardOption {
  const gauge = rng.int(def.gauges[0], def.gauges[1]);
  const rares = content.categories.filter((c) => c.rare);
  if (rares.length > 0 && rng.float() < def.rareChance) {
    return { kind: 'part', category: rng.weightedPick(rares, (c) => c.weight ?? 1).id, gauge };
  }
  const mats = Object.keys(def.materials).filter((id) => content.categories.some((c) => c.id === id));
  return { kind: 'part', category: rng.weightedPick(mats, (id) => def.materials[id]), gauge };
}

function makeParcel(content: ContentPack, def: LotDef, piece: RewardOption, rng: Rng): Parcel {
  const otherMetals = content.categories.map((c) => c.id).filter((id) => id !== piece.category);
  const gauges: number[] = [];
  for (let g = def.gauges[0]; g <= def.gauges[1]; g++) if (g !== piece.gauge) gauges.push(g);
  return {
    piece,
    altMetals: rng.shuffle(otherMetals).slice(0, ALTERNATIVES),
    altGauges: rng.shuffle(gauges).slice(0, ALTERNATIVES),
    metalOptions: 0,
    gaugeOptions: 0,
  };
}

/** True once you know exactly what's in the parcel. */
export function isKnown(parcel: Parcel): boolean {
  return parcel.metalOptions === 1 && parcel.gaugeOptions === 1;
}

/** What you know about a parcel, for display. */
export type ParcelView =
  | { kind: 'wrapped' }
  | { kind: 'known'; piece: RewardOption }
  | { kind: 'gauge'; gauge: number; metals: string[] }
  | { kind: 'metal'; metal: string; gauges: number[] };

export function viewParcel(content: ContentPack, parcel: Parcel): ParcelView {
  const { piece } = parcel;
  if (isKnown(parcel)) return { kind: 'known', piece };
  if (parcel.gaugeOptions === 1) {
    const metals = [piece.category!, ...parcel.altMetals.slice(0, parcel.metalOptions - 1)];
    return { kind: 'gauge', gauge: piece.gauge!, metals: metals.sort((a, b) => gradeOfCategory(content, a) - gradeOfCategory(content, b)) };
  }
  if (parcel.metalOptions === 1) {
    const gauges = [piece.gauge!, ...parcel.altGauges.slice(0, parcel.gaugeOptions - 1)];
    return { kind: 'metal', metal: piece.category!, gauges: gauges.sort((a, b) => a - b) };
  }
  return { kind: 'wrapped' };
}

/**
 * Check a parcel. `reveals` is what the check is certain about; `options`
 * is how many possibilities it leaves for the other (1 = exact). A gem has
 * no metal or number, so any check shows it.
 */
export function checkParcel(parcel: Parcel, reveals: ToolDef['reveals'], options: number): void {
  assertRule(!isKnown(parcel), 'You already know exactly what is in that parcel');
  const narrow = (current: number) => (current === 0 ? options : Math.min(current, options));
  if (parcel.piece.kind !== 'part' || reveals === 'both' || options <= 1) {
    parcel.metalOptions = 1;
    parcel.gaugeOptions = 1;
    return;
  }
  const before = `${parcel.metalOptions}/${parcel.gaugeOptions}`;
  if (reveals === 'gauge') {
    parcel.gaugeOptions = 1;
    parcel.metalOptions = narrow(parcel.metalOptions);
  } else {
    parcel.metalOptions = 1;
    parcel.gaugeOptions = narrow(parcel.gaugeOptions);
  }
  assertRule(`${parcel.metalOptions}/${parcel.gaugeOptions}` !== before, "That check wouldn't tell you anything new");
}

/**
 * Options a check leaves, after items like the Magnifier sharpen it: 1
 * fewer per level, never below 2 unless an item lets it go down to exact.
 */
export function sharpened(content: ContentPack, config: GameConfig, player: PlayerState, options: number): number {
  if (options <= 1) return options;
  const insight = passiveEffects(content, config, player).filter((e) => e.type === 'lotInsight');
  const better = insight.reduce((n, e) => n + Number(e.params.levels ?? 1), 0);
  const floor = Math.min(2, ...insight.map((e) => Number(e.params.floor ?? 2)));
  return Math.max(floor, options - better);
}

/** A piece's name: "Copper Spring 7". */
export function pieceLabel(content: ContentPack, piece: RewardOption): string {
  if (piece.kind === 'special') return content.specials.find((s) => s.id === piece.specialId)?.name ?? 'Special';
  if (piece.kind === 'page') return `${content.items.find((d) => d.id === piece.itemId)?.name ?? 'Loose'} page`;
  return `${partName(content, piece.category!, piece.gauge!)} ${piece.gauge}`;
}

// ---------------------------------------------------------------------------
// Checking parcels: tools, gadgets and the appraiser
// ---------------------------------------------------------------------------

/** Duel stops later in this act whose lot you could still fight for. */
export function lotsAhead(state: GameState): MapNode[] {
  const map = state.map;
  if (!map) return [];
  const here = map.current ? map.rows.flat().find((n) => n.id === map.current) : undefined;
  const fromRow = here ? here.row + 1 : 0;
  return map.rows
    .slice(fromRow)
    .flat()
    .filter((n) => n.encounter?.lot && !map.visited.includes(n.id));
}

/**
 * The parcel a check is aimed at: a lot ahead on the map (by node id), or,
 * with no node, the lot you've just won and are picking from.
 */
export function targetParcel(state: GameState, nodeId: string | undefined, index: number): Parcel {
  let lot: Lot | undefined;
  if (nodeId) {
    assertRule(state.phase === 'map' || state.phase === 'appraiser', 'Check lots ahead from the map');
    lot = lotsAhead(state).find((n) => n.id === nodeId)?.encounter?.lot;
    assertRule(lot, 'Choose a lot further along this act');
  } else {
    assertRule(state.phase === 'rummage' && state.rummage?.stage === 'pick', 'There is no lot to pick from');
    lot = state.rummage.lot;
  }
  const parcel = lot.parcels[index];
  assertRule(parcel, 'Choose a parcel');
  return parcel;
}

/** Use one of your tools (Calipers, Scratch Test, Unwrap...) on a parcel. */
export function useTool(state: GameState, content: ContentPack, player: PlayerState, toolId: string, nodeId: string | undefined, index: number): void {
  const tool = content.tools.find((t) => t.id === toolId);
  assertRule(tool, 'Unknown tool');
  assertRule((player.tools[toolId] ?? 0) > 0, `You have no ${tool.name} left`);
  const parcel = targetParcel(state, nodeId, index);
  checkParcel(parcel, tool.reveals, sharpened(content, state.config, player, tool.options));
  player.tools[toolId] -= 1;
  log(state, `You use ${tool.name} on a parcel.`);
}

/** What an appraiser charges you to unwrap a parcel (items can make it cheaper, never below 1). */
export function appraiseCost(state: GameState, content: ContentPack, player: PlayerState): number {
  return Math.max(1, state.config.scrapbook.appraiseCost - passiveSum(content, state.config, player, 'appraiseDiscount'));
}

/** Appraiser stop: pay to have one parcel of a lot ahead unwrapped. */
export function appraise(state: GameState, content: ContentPack, player: PlayerState, nodeId: string, index: number): void {
  assertRule(state.phase === 'appraiser', 'Find an appraiser on the map first');
  const cost = appraiseCost(state, content, player);
  assertRule(player.currency >= cost, `The appraiser charges ${cost} credits a parcel`);
  const parcel = targetParcel(state, nodeId, index);
  checkParcel(parcel, 'both', 1);
  player.currency -= cost;
  log(state, `The appraiser unwraps a parcel for ${cost} credits: ${pieceLabel(content, parcel.piece)}.`);
}

/** Choose which parcels to take from a won lot; the rest go back to the seller. */
export function pickParcels(state: GameState, content: ContentPack, player: PlayerState, indices: number[]): void {
  const r = state.rummage;
  assertRule(state.phase === 'rummage' && r && r.stage === 'pick', 'There is no lot to pick from');
  const unique = [...new Set(indices)];
  assertRule(unique.length === indices.length && unique.every((i) => r.lot.parcels[i]), 'Choose different parcels from the lot');
  assertRule(unique.length === r.lot.picks, `Pick ${r.lot.picks} parcel${r.lot.picks === 1 ? '' : 's'}`);
  r.pieces = [...unique.map((i) => r.lot.parcels[i].piece), ...r.bonus];
  r.missed = r.lot.parcels.filter((_, i) => !unique.includes(i)).map((p) => p.piece);
  r.stage = 'sort';
  log(state, `You open your parcels from the ${r.lotName}.`);
  // Crowbar: credits for every parcel left behind.
  const perLeftover = passiveSum(content, state.config, player, 'gainCurrency', 'perLeftover', (e) => e.params.hook === 'onPick');
  if (perLeftover > 0 && r.missed.length > 0) {
    player.currency += perLeftover * r.missed.length;
    log(state, `+${perLeftover * r.missed.length} credits for the parcels you left behind.`);
  }
}

// ---------------------------------------------------------------------------
// Matched stakes
// ---------------------------------------------------------------------------

/**
 * Everyone stakes the same: `count` parts of one material. The material
 * climbs with the act (and for elites and bosses), capped at Copper so a
 * starting deck can always pay.
 */
export function makeStakeRule(state: GameState, content: ContentPack, kind: DuelKind, count: number, rng: Rng): { category: string; count: number } {
  const act = state.tier + 1;
  let grade = kind === 'battle' ? act + rng.int(0, 1) : act + 1;
  const commons = content.categories.filter((c) => !c.rare).sort((a, b) => a.grade - b.grade);
  const top = commons.at(-1)!.grade;
  grade = Math.max(commons[0].grade, Math.min(top, grade));
  const cat = commons.find((c) => c.grade === grade) ?? commons[0];
  return { category: cat.id, count };
}

/**
 * Parts in the deck that meet the stake rule: its material or better, or
 * up to `grace` materials below (Brass Scales).
 */
export function eligibleStakeCards(state: GameState, content: ContentPack, player: PlayerState, rule: { category: string; count: number }, grace = stakeGraceOf(state, content, player)): CardId[] {
  const need = gradeOfCategory(content, rule.category) - grace;
  return player.deck.filter((id) => {
    const c = state.cards[id];
    return c?.kind === 'part' && gradeOfCategory(content, c.category) >= need;
  });
}

/** Materials below the asked one a player may stake (Brass Scales). */
export function stakeGraceOf(state: GameState, content: ContentPack, player: PlayerState): number {
  return Math.max(0, ...passiveEffects(content, state.config, player).filter((e) => e.type === 'modifyRules').map((e) => Number(e.params.stakeGrace ?? 0)));
}

/** Can the player meet the stake? (A boss can always be challenged with any parts.) */
export function canMeetStake(state: GameState, content: ContentPack, player: PlayerState, rule: { category: string; count: number }): boolean {
  return eligibleStakeCards(state, content, player, rule).length >= rule.count;
}

/** Check a proposed stake; returns an error message or null. */
export function stakeProblem(
  state: GameState,
  content: ContentPack,
  player: PlayerState,
  rule: { category: string; count: number },
  cardIds: CardId[],
  isBoss: boolean,
): string | null {
  const mat = content.categories.find((c) => c.id === rule.category)?.name ?? rule.category;
  if (new Set(cardIds).size !== cardIds.length) return 'Each card can only be staked once';
  if (!cardIds.every((id) => player.deck.includes(id))) return 'Stake cards from your parts deck';
  if (cardIds.length !== rule.count) return `Stake ${rule.count} part${rule.count === 1 ? '' : 's'}`;
  const eligible = new Set(eligibleStakeCards(state, content, player, rule));
  if (cardIds.every((id) => eligible.has(id))) return null;
  // Boss fallback: if you can't match the stake, any parts will do.
  const parts = cardIds.every((id) => state.cards[id]?.kind === 'part');
  if (isBoss && eligible.size < rule.count && parts) return null;
  const grace = stakeGraceOf(state, content, player);
  const below = grace > 0 ? ` (your items let you go ${grace} material${grace === 1 ? '' : 's'} lower)` : '';
  return `Everyone stakes ${mat} or better: stake ${rule.count} ${mat} (or better) part${rule.count === 1 ? '' : 's'}${below}`;
}

// ---------------------------------------------------------------------------
// Scrapbook pages
// ---------------------------------------------------------------------------


export const STAGES = 8;

export function piecesNeeded(config: GameConfig, grade: number): number {
  const list = config.scrapbook.piecesByGrade;
  return list[Math.min(grade, list.length) - 1];
}

export function pageOf(player: PlayerState, itemId: string): number[] {
  return player.scrapbook[itemId] ?? new Array(STAGES).fill(0);
}

/** Is this item's page in the scrapbook? (No page limit: every page is.) */
export function hasPage(player: PlayerState, itemId: string): boolean {
  return player.pages === null || player.pages.includes(itemId);
}

/** Pages in the scrapbook (with no page limit, every item's). */
export function scrapbookPages(content: ContentPack, player: PlayerState): string[] {
  return player.pages ?? content.items.map((d) => d.id);
}

/** Room for another page? */
export function pageRoom(state: GameState, player: PlayerState): boolean {
  const cfg = state.config.scrapbook.pages;
  return !cfg || player.pages === null || player.pages.length < cfg.max;
}

/**
 * Put a page in the scrapbook. A full scrapbook needs a page torn out
 * first: its pieces are lost, and a living item from it dies.
 */
export function addPage(state: GameState, content: ContentPack, player: PlayerState, itemId: string, tearOut?: string): void {
  const def = itemDef(content, itemId);
  assertRule(player.pages, 'Every page is already in your scrapbook');
  assertRule(!player.pages.includes(itemId), `The ${def.name} page is already in your scrapbook`);
  if (tearOut) tearOutPage(state, content, player, tearOut);
  assertRule(pageRoom(state, player), 'Your scrapbook is full: tear a page out to make room');
  player.pages.push(itemId);
  log(state, `The ${def.name} page goes into your scrapbook.`);
}

export function tearOutPage(state: GameState, content: ContentPack, player: PlayerState, itemId: string): void {
  const pages = player.pages;
  assertRule(pages && pages.includes(itemId), 'That page is not in your scrapbook');
  const name = itemDef(content, itemId).name;
  player.pages = pages.filter((id) => id !== itemId);
  delete player.scrapbook[itemId];
  const living = player.items.some((i) => i.itemId === itemId);
  player.items = player.items.filter((i) => i.itemId !== itemId);
  log(state, `You tear out the ${name} page${living ? `, and your ${name} falls apart` : ''}.`);
}

/** What selling a loose page fetches: half its shop price. */
export function pageSellPrice(state: GameState, content: ContentPack, itemId: string): number {
  const prices = state.config.scrapbook.pages?.prices;
  return prices ? Math.floor(prices[itemDef(content, itemId).rarity] / 2) : 0;
}

/**
 * The stage a part would fill on a page: its own material if that stage
 * still needs pieces, otherwise the best lower stage that does. Null if
 * none can use it (or the page isn't in your scrapbook).
 */
export function stageFor(config: GameConfig, content: ContentPack, player: PlayerState, itemId: string, piece: RewardOption): number | null {
  if (piece.kind !== 'part' || !hasPage(player, itemId)) return null;
  return stageForGrade(config, player, itemId, gradeOfCategory(content, piece.category));
}

/** The best stage at or below a material grade that still needs pieces. */
export function stageForGrade(config: GameConfig, player: PlayerState, itemId: string, grade: number): number | null {
  const page = pageOf(player, itemId);
  for (let g = Math.min(grade, STAGES); g >= 1; g--) {
    if (page[g - 1] < piecesNeeded(config, g)) return g;
  }
  return null;
}

/** Highest finished stage on a page (0 = none). */
export function finishedGrade(config: GameConfig, player: PlayerState, itemId: string): number {
  const page = pageOf(player, itemId);
  let best = 0;
  for (let g = 1; g <= STAGES; g++) if (page[g - 1] >= piecesNeeded(config, g)) best = g;
  return best;
}

/**
 * Place pieces of a material grade on a page, on the best stage they can
 * fill. `count` pieces' worth (a doubled piece is 2); a stage never
 * overfills, and a finished stage brings the item to life or raises it.
 * Returns the stage used.
 */
export function placePieces(state: GameState, content: ContentPack, player: PlayerState, itemId: string, materialGrade: number, count = 1): number {
  const def = itemDef(content, itemId);
  assertRule(hasPage(player, itemId), `The ${def.name} page is not in your scrapbook`);
  const g = stageForGrade(state.config, player, itemId, materialGrade);
  assertRule(g !== null, `The ${def.name} page has no stage that piece can fill`);
  const page = (player.scrapbook[itemId] ??= new Array(STAGES).fill(0));
  const need = piecesNeeded(state.config, g);
  page[g - 1] = Math.min(need, page[g - 1] + count);
  if (page[g - 1] === need) completeStage(state, content, player, itemId, g);
  return g;
}

/** A sensible default for each piece: the page closest to finishing a stage it fits, else the deck. */
export function suggestDestinations(state: GameState, content: ContentPack, player: PlayerState, pieces: RewardOption[]): PieceDestination[] {
  const sim = structuredClone(player);
  const doubled = doubling(content, state.config, player);
  return pieces.map((piece) => {
    if (piece.kind === 'page') {
      if (!sim.pages || sim.pages.includes(piece.itemId!) || !pageRoom(state, sim)) return { to: 'sell' };
      sim.pages.push(piece.itemId!);
      return { to: 'scrapbook' };
    }
    let best: { itemId: string; left: number } | null = null;
    for (const itemId of scrapbookPages(content, sim)) {
      const g = stageFor(state.config, content, sim, itemId, piece);
      if (g === null) continue;
      const left = piecesNeeded(state.config, g) - pageOf(sim, itemId)[g - 1];
      // Prefer pages already started, then the stage closest to done.
      const started = pageOf(sim, itemId).some((n) => n > 0) ? 0 : 1000;
      if (!best || started + left < best.left) best = { itemId, left: started + left };
    }
    if (!best) return { to: 'deck' };
    // Count it the way sorting will: doubled pieces fill 2, and a stage never overfills.
    const g = stageFor(state.config, content, sim, best.itemId, piece)!;
    const page = (sim.scrapbook[best.itemId] ??= new Array(STAGES).fill(0));
    const n = doubled(piece.category!, g === gradeOfCategory(content, piece.category)) ? 2 : 1;
    page[g - 1] = Math.min(piecesNeeded(state.config, g), page[g - 1] + n);
    return { to: 'page', itemId: best.itemId };
  });
}

/**
 * Pieces that count double this sorting: the first `count` placed (Sewing
 * Kit, the Haberdashery bonus), and listed materials on their own stage
 * (Thimble).
 */
function doubling(content: ContentPack, config: GameConfig, player: PlayerState) {
  const fx = passiveEffects(content, config, player).filter((e) => e.type === 'doublePieces');
  let first = fx.reduce((n, e) => n + Number(e.params.count ?? 0), 0);
  const materials = new Set(fx.flatMap((e) => (Array.isArray(e.params.materials) ? (e.params.materials as string[]) : [])));
  return (category: string, ownStage: boolean): boolean => {
    if (first > 0) {
      first -= 1;
      return true;
    }
    return ownStage && materials.has(category);
  };
}

/** Sort the opened pieces: onto pages, into the deck, or sold. A loose page goes into the scrapbook or is sold. */
export function applyRummage(state: GameState, content: ContentPack, player: PlayerState, destinations: PieceDestination[]): void {
  const rummage = state.rummage;
  assertRule(state.phase === 'rummage' && rummage && rummage.stage === 'sort', 'Pick your parcels first');
  assertRule(destinations.length === rummage.pieces.length, `Choose where each of the ${rummage.pieces.length} pieces goes`);
  const cfg = state.config.scrapbook;
  const sellBonus = passiveSum(content, state.config, player, 'sellBonus');
  const doubled = doubling(content, state.config, player);
  rummage.pieces.forEach((piece, i) => {
    const dest = destinations[i];
    if (piece.kind === 'page') {
      assertRule(dest.to === 'scrapbook' || dest.to === 'sell', `${pieceLabel(content, piece)} goes into your scrapbook or is sold`);
      if (dest.to === 'scrapbook') addPage(state, content, player, piece.itemId!, dest.tearOut);
      else player.currency += pageSellPrice(state, content, piece.itemId!);
      return;
    }
    assertRule(dest.to !== 'scrapbook', `${pieceLabel(content, piece)} isn't a page`);
    if (dest.to === 'deck') {
      const card = piece.kind === 'part' ? createPart(state, content, player.id, piece.category!, piece.gauge!) : createSpecial(state, player.id, piece.specialId!);
      addToDeck(state, card);
    } else if (dest.to === 'sell') {
      const credits = piece.kind === 'part' ? cfg.sellPerGrade * gradeOfCategory(content, piece.category) + sellBonus : cfg.sellSpecial;
      player.currency += credits;
    } else {
      const item = content.items.find((d) => d.id === dest.itemId);
      assertRule(item, 'Unknown scrapbook page');
      assertRule(piece.kind === 'part', `${pieceLabel(content, piece)} can't go on a page; keep it or sell it`);
      const grade = gradeOfCategory(content, piece.category);
      const g = stageFor(state.config, content, player, item.id, piece);
      assertRule(g !== null, `The ${item.name} page has no stage that ${pieceLabel(content, piece)} can fill`);
      placePieces(state, content, player, item.id, grade, doubled(piece.category!, g === grade) ? 2 : 1);
    }
  });
  log(state, `You sort the ${rummage.lotName}.`);
}

/** A page stage is finished: the item comes to life at that grade, or is raised to it. */
export function completeStage(state: GameState, content: ContentPack, player: PlayerState, itemId: string, grade: number): void {
  const def = content.items.find((d) => d.id === itemId)!;
  const material = materialName(content, state.config, grade);
  const existing = player.items.find((i) => i.itemId === itemId);
  if (!existing) {
    const item = {
      uid: `it${state.nextUid++}`,
      itemId,
      fromBlueprint: 'scrapbook',
      builtFrom: piecesNeeded(state.config, grade),
      level: 1,
      usesLeft: null,
      charges: null as number | null,
      grade,
      material,
    };
    player.items.push(item);
    item.charges = maxCharges(content, state.config, item, player);
    log(state, `Page complete! Your ${material} ${def.name} comes to life.`);
  } else if (grade > existing.grade) {
    existing.grade = grade;
    existing.material = material;
    existing.charges = maxCharges(content, state.config, existing, player);
    log(state, `Page complete! Your ${def.name} is now ${material}, fully charged.`);
  } else {
    log(state, `${material} stage of the ${def.name} page complete.`);
  }
}

/** Every Common page, for the start-of-run offer. */
export function startingPageOptions(state: GameState, content: ContentPack, rng: Rng): string[] {
  const cfg = state.config.scrapbook.pages;
  if (!cfg) return [];
  const commons = content.items.filter((d) => d.rarity === 'common').map((d) => d.id);
  return rng.sample(commons, Math.min(cfg.offered, commons.length));
}

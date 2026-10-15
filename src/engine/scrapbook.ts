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
import { gadgetCharges, materialName } from './quality';
import type { Rng } from './rng';
import type {
  CardId,
  ContentPack,
  DuelState,
  GameState,
  Lot,
  LotDef,
  MapNode,
  Parcel,
  PieceDestination,
  PlayerState,
  RewardOption,
  ToolDef,
} from './types';
import { addToDeck, assertRule, createPart, createSpecial, log, partName } from './zones';

type DuelKind = DuelState['kind'];

const actFits = (act: number, d: { minAct?: number; maxAct?: number }) =>
  (d.minAct ?? 1) <= act && (d.maxAct ?? Infinity) >= act;

const gradeOfCategory = (content: ContentPack, id: string | undefined) =>
  content.categories.find((c) => c.id === id)?.grade ?? 1;

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
  const parcels = pieces.map((piece) => makeParcel(content, def, piece, rng));
  return { lotId: def.id, name: def.name, picks: Math.min(def.picks, parcels.length), parcels };
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
  if (parcel.piece.kind === 'special' || reveals === 'both') {
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

/** Options a check leaves, after items like the Magnifier sharpen it (never below 2 unless exact). */
export function sharpened(content: ContentPack, player: PlayerState, options: number): number {
  if (options <= 1) return options;
  let better = 0;
  for (const item of player.items) {
    const def = content.items.find((d) => d.id === item.itemId);
    for (const ref of def?.effects ?? []) if (ref.type === 'lotInsight') better += Number(ref.params?.levels ?? 1);
  }
  return Math.max(2, options - better);
}

/** A piece's name: "Copper Spring 7". */
export function pieceLabel(content: ContentPack, piece: RewardOption): string {
  if (piece.kind === 'special') return content.specials.find((s) => s.id === piece.specialId)?.name ?? 'Special';
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
function targetParcel(state: GameState, nodeId: string | undefined, index: number): Parcel {
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
  checkParcel(parcel, tool.reveals, sharpened(content, player, tool.options));
  player.tools[toolId] -= 1;
  log(state, `You use ${tool.name} on a parcel.`);
}

/** Use a gadget that works on parcels (the Magnifier) for one charge. */
export function examineParcel(state: GameState, content: ContentPack, player: PlayerState, itemUid: string, nodeId: string | undefined, index: number): void {
  const item = player.items.find((i) => i.uid === itemUid);
  assertRule(item, 'You do not have that item');
  const gadget = content.items.find((d) => d.id === item.itemId)?.gadget;
  assertRule(gadget?.onLot, `${gadget?.name ?? 'That item'} can't be used on a parcel`);
  assertRule((item.charges ?? 0) > 0, `${gadget.name} is out of charges`);
  const parcel = targetParcel(state, nodeId, index);
  checkParcel(parcel, gadget.onLot.reveals, gadgetOptions(content, player, gadget.onLot, item.grade));
  item.charges = (item.charges ?? 1) - 1;
  log(state, `You use ${gadget.name} on a parcel.`);
}

/** Options a gadget's check leaves at an item grade. */
export function gadgetOptions(content: ContentPack, player: PlayerState, onLot: NonNullable<import('./types').GadgetDef['onLot']>, grade: number): number {
  const list = onLot.optionsByGrade;
  return sharpened(content, player, list[Math.min(grade, list.length) - 1]);
}

/** Appraiser stop: pay to have one parcel of a lot ahead unwrapped. */
export function appraise(state: GameState, content: ContentPack, player: PlayerState, nodeId: string, index: number): void {
  assertRule(state.phase === 'appraiser', 'Find an appraiser on the map first');
  const cost = state.config.scrapbook.appraiseCost;
  assertRule(player.currency >= cost, `The appraiser charges ${cost} credits a parcel`);
  const parcel = targetParcel(state, nodeId, index);
  checkParcel(parcel, 'both', 1);
  player.currency -= cost;
  log(state, `The appraiser unwraps a parcel for ${cost} credits: ${pieceLabel(content, parcel.piece)}.`);
}

/** Choose which parcels to take from a won lot; the rest go back to the seller. */
export function pickParcels(state: GameState, indices: number[]): void {
  const r = state.rummage;
  assertRule(state.phase === 'rummage' && r && r.stage === 'pick', 'There is no lot to pick from');
  const unique = [...new Set(indices)];
  assertRule(unique.length === indices.length && unique.every((i) => r.lot.parcels[i]), 'Choose different parcels from the lot');
  assertRule(unique.length === r.lot.picks, `Pick ${r.lot.picks} parcel${r.lot.picks === 1 ? '' : 's'}`);
  r.pieces = unique.map((i) => r.lot.parcels[i].piece);
  r.missed = r.lot.parcels.filter((_, i) => !unique.includes(i)).map((p) => p.piece);
  r.stage = 'sort';
  log(state, `You open your parcels from the ${r.lotName}.`);
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

/** Parts in the deck that meet the stake rule (its material or better). */
export function eligibleStakeCards(state: GameState, content: ContentPack, player: PlayerState, rule: { category: string; count: number }): CardId[] {
  const need = gradeOfCategory(content, rule.category);
  return player.deck.filter((id) => {
    const c = state.cards[id];
    return c?.kind === 'part' && gradeOfCategory(content, c.category) >= need;
  });
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
  return `Everyone stakes ${mat} or better: stake ${rule.count} ${mat} (or better) part${rule.count === 1 ? '' : 's'}`;
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

/**
 * The stage a part would fill on a page: its own material if that stage
 * still needs pieces, otherwise the best lower stage that does. Null if
 * none can use it.
 */
export function stageFor(config: GameConfig, content: ContentPack, player: PlayerState, itemId: string, piece: RewardOption): number | null {
  if (piece.kind !== 'part') return null;
  const page = pageOf(player, itemId);
  for (let g = gradeOfCategory(content, piece.category); g >= 1; g--) {
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

/** A sensible default for each piece: the page closest to finishing a stage it fits, else the deck. */
export function suggestDestinations(state: GameState, content: ContentPack, player: PlayerState, pieces: RewardOption[]): PieceDestination[] {
  const sim = structuredClone(player);
  return pieces.map((piece) => {
    let best: { itemId: string; left: number } | null = null;
    for (const item of content.items) {
      const g = stageFor(state.config, content, sim, item.id, piece);
      if (g === null) continue;
      const left = piecesNeeded(state.config, g) - pageOf(sim, item.id)[g - 1];
      // Prefer pages already started, then the stage closest to done.
      const started = pageOf(sim, item.id).some((n) => n > 0) ? 0 : 1000;
      if (!best || started + left < best.left) best = { itemId: item.id, left: started + left };
    }
    if (!best) return { to: 'deck' };
    const page = (sim.scrapbook[best.itemId] ??= new Array(STAGES).fill(0));
    page[stageFor(state.config, content, sim, best.itemId, piece)! - 1] += 1;
    return { to: 'page', itemId: best.itemId };
  });
}

/** Sort the opened pieces: onto pages, into the deck, or sold. */
export function applyRummage(state: GameState, content: ContentPack, player: PlayerState, destinations: PieceDestination[]): void {
  const rummage = state.rummage;
  assertRule(state.phase === 'rummage' && rummage && rummage.stage === 'sort', 'Pick your parcels first');
  assertRule(destinations.length === rummage.pieces.length, `Choose where each of the ${rummage.pieces.length} pieces goes`);
  const cfg = state.config.scrapbook;
  rummage.pieces.forEach((piece, i) => {
    const dest = destinations[i];
    if (dest.to === 'deck') {
      const card = piece.kind === 'part' ? createPart(state, content, player.id, piece.category!, piece.gauge!) : createSpecial(state, player.id, piece.specialId!);
      addToDeck(state, card);
    } else if (dest.to === 'sell') {
      const credits = piece.kind === 'part' ? cfg.sellPerGrade * gradeOfCategory(content, piece.category) : cfg.sellSpecial;
      player.currency += credits;
    } else {
      const item = content.items.find((d) => d.id === dest.itemId);
      assertRule(item, 'Unknown scrapbook page');
      assertRule(piece.kind === 'part', `${pieceLabel(content, piece)} can't go on a page; keep it or sell it`);
      const g = stageFor(state.config, content, player, item.id, piece);
      assertRule(g !== null, `The ${item.name} page has no stage that ${pieceLabel(content, piece)} can fill`);
      const page = (player.scrapbook[item.id] ??= new Array(STAGES).fill(0));
      page[g - 1] += 1;
      if (page[g - 1] === piecesNeeded(state.config, g)) completeStage(state, content, player, item.id, g);
    }
  });
  log(state, `You sort the ${rummage.lotName}.`);
}

/** A page stage is finished: the item comes to life at that grade, or is raised to it. */
function completeStage(state: GameState, content: ContentPack, player: PlayerState, itemId: string, grade: number): void {
  const def = content.items.find((d) => d.id === itemId)!;
  const material = materialName(content, state.config, grade);
  const existing = player.items.find((i) => i.itemId === itemId);
  if (!existing) {
    player.items.push({
      uid: `it${state.nextUid++}`,
      itemId,
      fromBlueprint: 'scrapbook',
      builtFrom: piecesNeeded(state.config, grade),
      level: 1,
      usesLeft: null,
      charges: def.gadget ? gadgetCharges(def.gadget, grade, state.config) : null,
      grade,
      material,
    });
    log(state, `Page complete! Your ${material} ${def.name} comes to life.`);
  } else if (grade > existing.grade) {
    existing.grade = grade;
    existing.material = material;
    if (def.gadget) existing.charges = gadgetCharges(def.gadget, grade, state.config);
    log(state, `Page complete! Your ${def.name} is now ${material}, fully charged.`);
  } else {
    log(state, `${material} stage of the ${def.name} page complete.`);
  }
}

/**
 * Scrapbook runs: duels are fought over lots (boxes of parts), and the
 * parts you dig out fill pages in your scrapbook. Each item has a page with
 * one stage per material, Tin to Platinum; finishing a stage brings that
 * item to life at that grade (or raises it, if you already have it).
 *
 * Lots come with a catalogue level saying how much you can see before the
 * fight. The less you can see, the bigger the lot and the better its odds.
 * How deep you dig into a won lot depends on how well you went out.
 */

import type { GameConfig } from '../config';
import { byGrade, gadgetCharges, materialName } from './quality';
import type { Rng } from './rng';
import type {
  CardId,
  CatalogueLevel,
  ContentPack,
  DuelState,
  GameState,
  Lot,
  LotDef,
  MapNode,
  PieceDestination,
  PlayerState,
  RewardOption,
} from './types';
import { addToDeck, assertRule, createPart, createSpecial, log, partName } from './zones';

type DuelKind = DuelState['kind'];

const actFits = (act: number, d: { minAct?: number; maxAct?: number }) =>
  (d.minAct ?? 1) <= act && (d.maxAct ?? Infinity) >= act;

const gradeOfCategory = (content: ContentPack, id: string | undefined) =>
  content.categories.find((c) => c.id === id)?.grade ?? 1;

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

/** Roll a lot for a duel stop. Rare pieces and gems end up at the bottom of the box. */
export function makeLot(state: GameState, content: ContentPack, kind: DuelKind, rng: Rng): Lot {
  const act = state.tier + 1;
  let pool = content.lots.filter((l) => l.kinds.includes(kind) && actFits(act, l));
  if (pool.length === 0) pool = content.lots.filter((l) => l.kinds.includes(kind));
  assertRule(pool.length > 0, `No lots for ${kind} duels in the content`);
  const def = rng.weightedPick(pool, (l) => l.weight);
  const cfg = state.config.scrapbook;
  const catalogue = (rng.weightedPick([1, 2, 3, 4], (l) => cfg.catalogueWeights[l - 1]) as CatalogueLevel);

  const extra = Math.floor((catalogue - 1) * cfg.sealedBonus.pieces);
  const rareChance = Math.min(0.9, def.rareChance * (1 + (catalogue - 1) * cfg.sealedBonus.rareMultiplier));
  const sizeRange: [number, number] = [def.size[0] + extra, def.size[1] + extra];
  const count = rng.int(sizeRange[0], sizeRange[1]);

  const common: RewardOption[] = [];
  const rare: RewardOption[] = [];
  for (let i = 0; i < count; i++) {
    const piece = rollPiece(content, def, rareChance, rng);
    (gradeOfCategory(content, piece.category) >= 5 ? rare : common).push(piece);
  }
  const gems = content.specials.filter((s) => (s.gradeBonus ?? 0) > 0);
  if (gems.length > 0 && rng.float() < def.gemChance) {
    rare.push({ kind: 'special', specialId: rng.weightedPick(gems, (g) => g.weight).id });
  }
  common.sort((a, b) => gradeOfCategory(content, a.category) - gradeOfCategory(content, b.category));
  rare.sort((a, b) => (a.kind === 'special' ? 1 : 0) - (b.kind === 'special' ? 1 : 0));
  return { lotId: def.id, name: def.name, catalogue, pieces: [...common, ...rare], sizeRange, rareChance, gemChance: def.gemChance };
}

function rollPiece(content: ContentPack, def: LotDef, rareChance: number, rng: Rng): RewardOption {
  const gauge = rng.int(def.gauges[0], def.gauges[1]);
  const rares = content.categories.filter((c) => c.rare);
  if (rares.length > 0 && rng.float() < rareChance) {
    return { kind: 'part', category: rng.weightedPick(rares, (c) => c.weight ?? 1).id, gauge };
  }
  const mats = Object.keys(def.materials).filter((id) => content.categories.some((c) => c.id === id));
  return { kind: 'part', category: rng.weightedPick(mats, (id) => def.materials[id]), gauge };
}

/** What the catalogue shows of a piece: everything, its metal only, what it is only, or nothing. */
export type PieceVisibility = 'full' | 'metal' | 'part' | 'hidden';

/** The catalogue level this player sees: items like the Magnifier improve it. */
export function catalogueFor(content: ContentPack, player: PlayerState, lot: Lot): CatalogueLevel {
  let better = 0;
  for (const item of player.items) {
    const def = content.items.find((d) => d.id === item.itemId);
    for (const ref of def?.effects ?? []) if (ref.type === 'lotInsight') better += Number(ref.params?.levels ?? 1);
  }
  return Math.max(1, lot.catalogue - better) as CatalogueLevel;
}

/** What a catalogue level shows of a piece (defaults to the lot's own level). */
export function pieceVisibility(lot: Lot, index: number, level: CatalogueLevel = lot.catalogue): PieceVisibility {
  switch (level) {
    case 1:
      return 'full';
    case 2:
      return index < Math.ceil(lot.pieces.length / 2) ? 'full' : 'metal';
    case 3:
      return 'part';
    default:
      return 'hidden';
  }
}

export const CATALOGUE_NAMES: Record<CatalogueLevel, string> = {
  1: 'Itemised',
  2: 'Partly itemised',
  3: 'Contents only',
  4: 'Sealed',
};

/** A piece's name: "Copper Spring (7)", or "Brass Gear 5" style label. */
export function pieceLabel(content: ContentPack, piece: RewardOption): string {
  if (piece.kind === 'special') return content.specials.find((s) => s.id === piece.specialId)?.name ?? 'Special';
  return `${partName(content, piece.category!, piece.gauge!)} ${piece.gauge}`;
}

/** The noun alone, e.g. "Spring" (for "contents only" catalogues). */
export function pieceNoun(content: ContentPack, piece: RewardOption): string {
  if (piece.kind === 'special') return 'something small, wrapped in newspaper';
  return partName(content, piece.category!, piece.gauge!).split(' ').slice(1).join(' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Seeing more of a lot: the appraiser and gadgets like the Magnifier
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

/** Credits to have a lot fully itemised (0 when you can already see everything). */
export function appraisalCost(state: GameState, content: ContentPack, player: PlayerState, lot: Lot): number {
  return (catalogueFor(content, player, lot) - 1) * state.config.scrapbook.appraisePerLevel;
}

function lotAhead(state: GameState, nodeId: string): Lot {
  const node = lotsAhead(state).find((n) => n.id === nodeId);
  assertRule(node, 'Choose a lot further along this act');
  return node.encounter!.lot!;
}

/** Appraiser stop: pay to have a lot ahead fully itemised. */
export function appraise(state: GameState, content: ContentPack, player: PlayerState, nodeId: string): void {
  assertRule(state.phase === 'appraiser', 'Find an appraiser on the map first');
  const lot = lotAhead(state, nodeId);
  const cost = appraisalCost(state, content, player, lot);
  assertRule(cost > 0, `The ${lot.name} is already fully itemised`);
  assertRule(player.currency >= cost, `Appraising the ${lot.name} costs ${cost} credits`);
  player.currency -= cost;
  lot.catalogue = 1;
  log(state, `The appraiser itemises the ${lot.name} for ${cost} credits.`);
}

/** Spend a gadget charge on the map to see more of a lot ahead. */
export function examineLot(state: GameState, content: ContentPack, player: PlayerState, itemUid: string, nodeId: string): void {
  assertRule(state.phase === 'map', 'Examine lots from the map');
  const item = player.items.find((i) => i.uid === itemUid);
  assertRule(item, 'You do not have that item');
  const gadget = content.items.find((d) => d.id === item.itemId)?.gadget;
  assertRule(gadget?.onLot, `${gadget?.name ?? 'That item'} can't be used on a lot`);
  assertRule((item.charges ?? 0) > 0, `${gadget.name} is out of charges`);
  const lot = lotAhead(state, nodeId);
  const seen = catalogueFor(content, player, lot);
  assertRule(seen > 1, `You can already see everything in the ${lot.name}`);
  const levels = byGrade(gadget.onLot.levels, gadget.onLot.perGrade, item.grade);
  lot.catalogue = Math.max(1, lot.catalogue - levels) as CatalogueLevel;
  item.charges = (item.charges ?? 1) - 1;
  log(state, `You use ${gadget.name} on the ${lot.name}: it's now ${CATALOGUE_NAMES[catalogueFor(content, player, lot)].toLowerCase()}.`);
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
// Digging into a won lot
// ---------------------------------------------------------------------------

/**
 * How many pieces you take from a won lot. Always the top half; more for
 * going out quickly, with a clean hand, or with a bigger meld than needed.
 * Winning on a showdown (draws ran out) only gets the top half.
 */
export function digDepth(config: GameConfig, duel: DuelState): { taken: number; total: number; parts: { label: string; amount: number }[] } {
  const lot = duel.lot!;
  const total = lot.pieces.length;
  const dig = config.scrapbook.dig;
  const parts: { label: string; amount: number }[] = [{ label: 'You won the lot', amount: Math.ceil(total * dig.baseFraction) }];
  if (duel.winningMelds) {
    if (duel.drawsTaken <= duel.rules.drawLimit / 2) parts.push({ label: 'Quick: out within half your draws', amount: dig.quickBonus });
    const used = new Set(duel.winningMelds.flat());
    const left = duel.hand.filter((id) => !used.has(id)).length;
    if (left <= dig.cleanHandMax) parts.push({ label: `Clean hand: ${left} card${left === 1 ? '' : 's'} left over`, amount: dig.cleanBonus });
    if (duel.winningMelds.some((m, i) => m.length > (duel.requirements[i]?.size ?? Infinity))) {
      parts.push({ label: 'Bigger meld than needed', amount: dig.bigMeldBonus });
    }
  }
  const taken = Math.min(total, parts.reduce((n, p) => n + p.amount, 0));
  return { taken, total, parts };
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

/** Sort the dug-out pieces: onto pages, into the deck, or sold. */
export function applyRummage(state: GameState, content: ContentPack, player: PlayerState, destinations: PieceDestination[]): void {
  const rummage = state.rummage;
  assertRule(state.phase === 'rummage' && rummage, 'Nothing to sort');
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

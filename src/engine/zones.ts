/**
 * Low-level helpers that mutate a *draft* GameState (the reducer clones the
 * state before calling these). Shared by the reducer and effect handlers.
 */

import type { Card, CardId, ContentPack, GameState, PartCard, PlayerId, PlayerState, SpecialCard } from './types';
import type { Rng } from './rng';

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

export function assertRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RuleError(message);
}

const MAX_MESSAGES = 60;

export function log(state: GameState, message: string): void {
  state.messages.push(message);
  if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new RuleError(`Unknown player ${id}`);
  return p;
}

export function getCard(state: GameState, id: CardId): Card {
  const c = state.cards[id];
  if (!c) throw new RuleError(`Unknown card ${id}`);
  return c;
}

export function partName(content: ContentPack, category: string, gauge: number): string {
  const cat = content.categories.find((c) => c.id === category);
  if (!cat) return `${category} ${gauge}`;
  const noun = cat.nouns.length > 0 ? cat.nouns[(gauge - 1 + cat.nouns.length) % cat.nouns.length] : 'Part';
  return `${cat.name} ${noun}`;
}

export function cardLabel(state: GameState, content: ContentPack, id: CardId): string {
  const c = state.cards[id];
  if (!c) return id;
  if (c.kind === 'part') return `${c.name} (${c.gauge})`;
  return content.specials.find((s) => s.id === c.specialId)?.name ?? c.specialId;
}

function newCardId(state: GameState): CardId {
  return `c${state.nextCardSeq++}`;
}

export function createPart(
  state: GameState,
  content: ContentPack,
  owner: PlayerId,
  category: string,
  gauge: number,
  temporary = false,
): PartCard {
  const card: PartCard = {
    id: newCardId(state),
    kind: 'part',
    owner,
    category,
    gauge,
    name: partName(content, category, gauge),
  };
  if (temporary) card.temporary = true;
  state.cards[card.id] = card;
  return card;
}

export function createSpecial(state: GameState, owner: PlayerId, specialId: string, temporary = false): SpecialCard {
  const card: SpecialCard = { id: newCardId(state), kind: 'special', owner, specialId };
  if (temporary) card.temporary = true;
  state.cards[card.id] = card;
  return card;
}

/** Add a newly created card to its owner's permanent deck. */
export function addToDeck(state: GameState, card: Card): void {
  getPlayer(state, card.owner).deck.push(card.id);
}

function removeFrom(list: CardId[], id: CardId): boolean {
  const i = list.indexOf(id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** Remove a card from whichever round zone holds it (hand, piles, played, locked melds). */
export function removeFromZones(state: GameState, id: CardId): void {
  for (const p of state.players) {
    removeFrom(p.hand, id);
    removeFrom(p.drawPile, id);
    removeFrom(p.played, id);
    for (const m of p.lockedMelds) removeFrom(m.cardIds, id);
    p.lockedMelds = p.lockedMelds.filter((m) => m.cardIds.length > 0);
  }
  if (state.roundState) removeFrom(state.roundState.discard, id);
}

/** Permanently destroy a card: out of every zone, the owner's deck and the registry. */
export function destroyCard(state: GameState, id: CardId): void {
  const card = state.cards[id];
  if (!card) return;
  removeFromZones(state, id);
  for (const p of state.players) removeFrom(p.deck, id);
  delete state.cards[id];
}

/**
 * Take the top card of the player's draw pile (top = last element).
 * If the pile is empty, the discard pile (minus its top card) is shuffled
 * in to form a new draw pile. Returns null if no card is available.
 */
export function takeTopOfDrawPile(state: GameState, player: PlayerState, rng: Rng): CardId | null {
  if (player.drawPile.length === 0 && state.roundState) {
    const discard = state.roundState.discard;
    if (discard.length > 1) {
      const top = discard.pop()!;
      player.drawPile = rng.shuffle(discard.splice(0));
      discard.push(top);
      log(state, `${player.name} reshuffles the discard pile into a new draw pile.`);
    }
  }
  return player.drawPile.pop() ?? null;
}

export function discardTop(state: GameState): CardId | null {
  const d = state.roundState?.discard;
  return d && d.length > 0 ? d[d.length - 1] : null;
}

/**
 * Small duel helpers shared by the duel engine and item effects: drawing
 * with a reshuffle, and moving cards between hands and the discard pile.
 */

import type { Rng } from './rng';
import type { CardId, ContentPack, DuelFx, DuelOpponent, DuelState, MinionDef } from './types';

/** Take the top of a pile; if it's empty, shuffle the discard pile (all but its top card) in first. */
export function takeFrom(pile: CardId[], discard: CardId[], rng: Rng): CardId | null {
  if (pile.length === 0 && discard.length > 1) {
    const top = discard.pop()!;
    pile.push(...rng.shuffle(discard.splice(0)));
    discard.push(top);
  }
  return pile.pop() ?? null;
}

/** Draw cards from your pile into your hand without using draws. Returns what was drawn. */
export function drawToHand(duel: DuelState, count: number, rng: Rng): CardId[] {
  const drawn: CardId[] = [];
  for (let i = 0; i < count; i++) {
    const id = takeFrom(duel.drawPile, duel.discard, rng);
    if (!id) break;
    duel.hand.push(id);
    drawn.push(id);
  }
  return drawn;
}

/** More draws this duel (kept if the duel's rules are worked out again). */
export function addDraws(duel: DuelState, amount: number): void {
  duel.rules.drawLimit += amount;
  duel.fx.bonusDraws += amount;
}

export function minionOf(content: ContentPack, opp: DuelOpponent): MinionDef | undefined {
  return content.minions.find((m) => m.id === opp.defId);
}

export function isBossOpponent(content: ContentPack, opp: DuelOpponent): boolean {
  return minionOf(content, opp)?.kind === 'boss';
}

/** An opponent drops a card from its hand onto the discard pile. */
export function opponentDrops(duel: DuelState, index: number, id: CardId): void {
  const opp = duel.opponents[index];
  const at = opp.hand.indexOf(id);
  if (at < 0) return;
  opp.hand.splice(at, 1);
  opp.peeked = opp.peeked.filter((p) => p !== id);
  duel.discard.push(id);
}

export function freshFx(): DuelFx {
  return {
    lockDiscard: 0,
    lockExceptYou: false,
    trap: null,
    doubleDraw: 0,
    skipOwnDraw: 0,
    drawsDue: 1,
    discardsDue: 1,
    drawsThisTurn: 0,
    protectedCard: null,
    setAside: [],
    freeDiscardUsed: 0,
    takeAnyUsed: 0,
    extraDiscardsUsed: 0,
    deckDraws: 0,
    insured: { stake: false, life: false, winCredits: 0 },
    freeUses: null,
    gadgetUses: {},
    fromDiscard: [],
    yourDiscards: [],
    fired: {},
    shifted: {},
    replayed: false,
    bonusDraws: 0,
    bonusHandSize: 0,
  };
}

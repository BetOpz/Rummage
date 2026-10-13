import { createEngine, type Engine } from '../src/engine/game';
import type { Card, CardId, GameState, PlayerId } from '../src/engine/types';
import { createPart, createSpecial } from '../src/engine/zones';

export const engine: Engine = createEngine();

/** Start a game and pick the first offered blueprint (or a given one). */
export function startedGame(
  seed = 'test',
  config: Parameters<Engine['newGame']>[0]['config'] = {},
  blueprintId?: string,
): GameState {
  const s = engine.newGame({ seed, config });
  return engine.reduce(s, {
    type: 'SELECT_BLUEPRINT',
    playerId: 'p1',
    blueprintId: blueprintId ?? s.roundState!.offers[0],
  });
}

/**
 * Test helper: replace a player's hand with specific cards. Accepts
 * "iron:5" style part specs or special ids. Cards are added to the deck too,
 * so they behave like normal owned cards. Returns the new state and the card ids.
 */
export function withHand(state: GameState, specs: string[], playerId: PlayerId = 'p1'): { state: GameState; ids: CardId[] } {
  const s = structuredClone(state);
  const player = s.players.find((p) => p.id === playerId)!;
  // The old hand goes to the bottom of the draw pile so the top stays put.
  player.drawPile.unshift(...player.hand);
  player.hand = [];
  const ids = specs.map((spec) => {
    let card: Card;
    if (spec.includes(':')) {
      const [cat, g] = spec.split(':');
      card = createPart(s, engine.content, playerId, cat, Number(g));
    } else {
      card = createSpecial(s, playerId, spec);
    }
    player.deck.push(card.id);
    player.hand.push(card.id);
    return card.id;
  });
  return { state: s, ids };
}

/** Put specific cards on top of the draw pile (first spec ends up on top). */
export function stackDrawPile(state: GameState, specs: string[], playerId: PlayerId = 'p1'): { state: GameState; ids: CardId[] } {
  const s = structuredClone(state);
  const player = s.players.find((p) => p.id === playerId)!;
  const ids = specs.map((spec) => {
    const card: Card = spec.includes(':')
      ? createPart(s, engine.content, playerId, spec.split(':')[0], Number(spec.split(':')[1]))
      : createSpecial(s, playerId, spec);
    player.deck.push(card.id);
    return card.id;
  });
  player.drawPile.push(...[...ids].reverse());
  return { state: s, ids };
}

export function setTarget(state: GameState, blueprintId: string, playerId: PlayerId = 'p1'): GameState {
  const s = structuredClone(state);
  s.players.find((p) => p.id === playerId)!.target = blueprintId;
  return s;
}

export const p1 = (s: GameState) => s.players[0];

import { defaultConfig } from '../src/config';
import { createEngine, type Engine } from '../src/engine/game';
import type { Card, CardId, GameState, PlayerId } from '../src/engine/types';
import { eligibleStakeCards, suggestDestinations } from '../src/engine/scrapbook';
import { createPart, createSpecial } from '../src/engine/zones';

const realEngine: Engine = createEngine();

/**
 * Every page in the scrapbook from the start, unless a test turns page
 * limits on (`scrapbook: { pages: defaultConfig.scrapbook.pages }`), so
 * tests can use any item's page without picking it first.
 */
const allPages = (config: Parameters<Engine['newGame']>[0]['config'] = {}) => ({
  ...config,
  scrapbook: {
    ...defaultConfig.scrapbook,
    ...config.scrapbook,
    pages: config.scrapbook && 'pages' in config.scrapbook ? config.scrapbook.pages : null,
  },
});

/**
 * Most tests exercise the workshop (rummy) layer on its own, so the test
 * engine defaults to the linear 'workshopOnly' run structure. Pass
 * `runStructure: 'map'` to test the map and battles.
 */
export const engine: Engine = {
  ...realEngine,
  newGame: (opts) => realEngine.newGame({ ...opts, config: allPages({ runStructure: 'workshopOnly', ...opts.config }) }),
};
export const mapEngine: Engine = {
  ...realEngine,
  newGame: (opts) => realEngine.newGame({ ...opts, config: allPages(opts.config) }),
};

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

/** A legal stake for the duel in its ante: the cheapest parts that meet the matched-stake rule. */
export function stakeFor(state: GameState, playerId: PlayerId = 'p1'): CardId[] {
  const player = state.players.find((p) => p.id === playerId)!;
  const rule = state.duel!.stakeRule;
  if (!rule) return [player.deck[0]];
  return eligibleStakeCards(state, realEngine.content, player, rule).slice(0, rule.count);
}

/** Pick the first parcels of a won lot and sort them with the default destinations (no-op outside the rummage phase). */
export function sortLot(state: GameState, playerId: PlayerId = 'p1'): GameState {
  if (state.phase !== 'rummage') return state;
  if (state.rummage!.stage === 'pick') {
    const picks = Array.from({ length: state.rummage!.lot.picks }, (_, i) => i);
    state = realEngine.reduce(state, { type: 'PICK_PARCELS', playerId, parcels: picks });
  }
  const player = state.players.find((p) => p.id === playerId)!;
  const destinations = suggestDestinations(state, realEngine.content, player, state.rummage!.pieces);
  return realEngine.reduce(state, { type: 'RUMMAGE_DONE', playerId, destinations });
}

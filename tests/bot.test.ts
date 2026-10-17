/** The bot's item play: when it spends gadget charges, how it answers choices, which pages it picks. */
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { botAction } from '../src/engine/bot';
import { pageValue } from '../src/engine/botGadgets';
import { maxCharges } from '../src/engine/items';
import type { CardId, GameState, ItemInstance } from '../src/engine/types';
import { createPart } from '../src/engine/zones';
import { mapEngine as engine, stakeFor } from './helpers';

const P = 'p1';
const me = (s: GameState) => s.players[0];
const SIMPLE = [
  { type: 'set' as const, size: 3 },
  { type: 'run' as const, size: 3 },
];

function give(s: GameState, itemId: string, grade = 1) {
  const item: ItemInstance = { uid: `u-${itemId}`, itemId, fromBlueprint: 'scrapbook', builtFrom: 3, level: 1, usesLeft: null, charges: null, grade, material: 'x' };
  me(s).items.push(item);
  item.charges = maxCharges(defaultContent, s.config, item, me(s));
}

function duel(items: string[], kind: 'battle' | 'elite' = 'elite'): GameState {
  let s = structuredClone(engine.newGame({ seed: 'botg' }));
  for (const id of items) give(s, id);
  const node = s.map!.rows[0][0];
  node.type = kind;
  node.encounter = { minions: [kind === 'elite' ? 'junk_golem' : 'rust_rat'], stakes: [{ kind: 'part', category: 'tin', gauge: 3 }], stakeRule: { category: 'tin', count: 1 } };
  s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: node.id });
  s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
  s = structuredClone(s);
  s.duel!.requirements = SIMPLE;
  return s;
}

const parts = (s: GameState, specs: string[]): CardId[] =>
  specs.map((spec) => createPart(s, defaultContent, P, spec.split(':')[0], Number(spec.split(':')[1]), true).id);

describe('the bot spends charges where they change the race', () => {
  it('stops an opponent that is about to go out, and not one that is far away', () => {
    const far = duel(['alarm_clock']);
    far.duel!.opponents[0].hand = parts(far, ['tin:1', 'wood:4', 'iron:7', 'brass:10', 'copper:2', 'tin:6', 'wood:9']);
    expect(botAction(engine, far, P)?.type).not.toBe('USE_GADGET');
    const near = duel(['alarm_clock']);
    near.duel!.opponents[0].hand = parts(near, ['iron:5', 'wood:5', 'brass:5', 'copper:1', 'copper:2', 'tin:9', 'iron:9']);
    expect(botAction(engine, near, P)).toMatchObject({ type: 'USE_GADGET', itemUid: 'u-alarm_clock', target: 0 });
  });

  it('uses a hand gadget only when it brings the hand closer to going out', () => {
    const s = duel(['fire_poker']);
    s.duel!.hand = parts(s, ['iron:5', 'wood:5', 'copper:1', 'copper:2', 'tin:9', 'iron:9', 'wood:10']);
    // A card on top of the draw pile that helps nothing.
    s.duel!.drawPile.push(...parts(s, ['brass:8']));
    const useless = parts(s, ['iron:2']);
    s.duel!.discard = [...useless];
    expect(botAction(engine, s, P)?.type).not.toBe('USE_GADGET');
    const [wanted] = parts(s, ['brass:5']);
    s.duel!.discard.unshift(wanted);
    expect(botAction(engine, s, P)).toMatchObject({ type: 'USE_GADGET', cards: [wanted] });
  });

  it('keeps the card that helps when a choice shows it two', () => {
    let s = duel(['salvage_rig']);
    s.duel!.hand = parts(s, ['iron:5', 'wood:5', 'copper:1', 'copper:2', 'tin:9', 'iron:9']);
    // Salvage Rig at Fine: look at 2 cards of the opponent's hand and take 1.
    me(s).items[0].grade = 5;
    s.duel!.opponents[0].hand = parts(s, ['tin:8', 'brass:5']);
    s = engine.reduce(s, { type: 'USE_GADGET', playerId: P, itemUid: 'u-salvage_rig', target: 0 });
    const a = botAction(engine, s, P);
    expect(a?.type).toBe('DUEL_CHOOSE');
    const pick = (a as { cardIds: CardId[] }).cardIds[0];
    const c = s.cards[pick] as { category: string; gauge: number };
    expect([c.category, c.gauge]).toEqual(['brass', 5]);
  });
});

describe('pages', () => {
  it('starts with the pages it values most', () => {
    const s = engine.newGame({ seed: 'botpages', config: { scrapbook: { ...defaultConfig.scrapbook } } });
    const a = botAction(engine, s, P) as { type: string; itemIds: string[] };
    expect(a.type).toBe('PICK_PAGES');
    const values = s.pageOffer!.options.map((id) => pageValue(engine, me(s), id)).sort((x, y) => y - x);
    const chosen = a.itemIds.map((id) => pageValue(engine, me(s), id));
    expect(Math.min(...chosen)).toBeGreaterThanOrEqual(values[s.pageOffer!.picks] - 0.6 * 2);
  });
});

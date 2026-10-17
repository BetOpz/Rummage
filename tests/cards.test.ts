/**
 * The item card set (docs/CARD_SET.md): tiers, charges, set bonuses,
 * conditions, pages in a run, and the effects of the cards themselves.
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { defaultEffects } from '../src/engine/effects';
import { atTier, collectionCounts, gadgetCharges, maxCharges, rechargeCost, tierOf } from '../src/engine/items';
import { reachableNodes } from '../src/engine/map';
import { checkBuild } from '../src/engine/melds';
import { piecesNeeded, stageFor } from '../src/engine/scrapbook';
import type { CardId, DuelKind, GameAction, GameState, ItemInstance } from '../src/engine/types';
import { validateContent } from '../src/engine/validateContent';
import { createPart } from '../src/engine/zones';
import { mapEngine as engine, stakeFor } from './helpers';

const P = 'p1';
const me = (s: GameState) => s.players[0];
const SIMPLE = [
  { type: 'set' as const, size: 3 },
  { type: 'run' as const, size: 3 },
];
const content = defaultContent;

/** Give the player a living item at a grade, fully charged. */
function give(s: GameState, itemId: string, grade = 1): string {
  const uid = `u-${itemId}`;
  const item: ItemInstance = { uid, itemId, fromBlueprint: 'scrapbook', builtFrom: 3, level: 1, usesLeft: null, charges: null, grade, material: 'x' };
  me(s).items.push(item);
  item.charges = maxCharges(content, s.config, item, me(s));
  return uid;
}

interface DuelOpts {
  kind?: DuelKind;
  minions?: string[];
  items?: [string, number?][];
  seed?: string;
  twists?: string[];
}

/** A duel in play against chosen minions, with your items alive, and a simple target. */
function duel({ kind = 'battle', minions = ['rust_rat'], items = [], seed = 'cards', twists = [] }: DuelOpts = {}): GameState {
  let s = structuredClone(engine.newGame({ seed }));
  for (const [id, grade] of items) give(s, id, grade ?? 1);
  const node = s.map!.rows[0][0];
  node.type = kind;
  node.encounter = {
    minions,
    stakes: minions.map(() => ({ kind: 'part', category: 'tin', gauge: 3 })),
    stakeRule: { category: 'tin', count: 1 },
    twists: twists.map((modifierId) => ({ modifierId, params: {} })),
  };
  s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: node.id });
  s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
  s = structuredClone(s);
  s.duel!.requirements = SIMPLE;
  return s;
}

const act = (s: GameState, a: GameAction) => engine.reduce(s, a);
const use = (s: GameState, itemId: string, args: Partial<Extract<GameAction, { type: 'USE_GADGET' }>> = {}) =>
  act(s, { type: 'USE_GADGET', playerId: P, itemUid: `u-${itemId}`, ...args });
const tryUse = (s: GameState, itemId: string, args: Partial<Extract<GameAction, { type: 'USE_GADGET' }>> = {}) =>
  engine.applyAction(s, { type: 'USE_GADGET', playerId: P, itemUid: `u-${itemId}`, ...args });

/** Temporary parts from specs like "iron:5". */
function parts(s: GameState, specs: string[]): CardId[] {
  return specs.map((spec) => {
    const [cat, g] = spec.split(':');
    return createPart(s, content, P, cat, Number(g), true).id;
  });
}

/** Opponents sit out (for tests that play several turns). */
function freeze(s: GameState, turns = 99): GameState {
  const out = structuredClone(s);
  for (const o of out.duel!.opponents) o.skip = turns;
  return out;
}

/** Play a plain turn: draw from your pile, discard your first card. */
function turn(s: GameState): GameState {
  if (s.duel!.turnPhase === 'draw') s = act(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
  return act(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand[0] });
}

/** A winning hand for SIMPLE: a set of 5s and a run of copper 1-3, plus a spare. */
const WINNING = ['iron:5', 'wood:5', 'brass:5', 'copper:1', 'copper:2', 'copper:3', 'iron:9'];

describe('the set loads', () => {
  it('every item validates, and every gadget effect works somewhere it can be used', () => {
    expect(validateContent(content, defaultEffects, defaultConfig)).toEqual([]);
    expect(content.items.length).toBe(60);
    for (const item of content.items) {
      for (const ref of item.gadget?.effects ?? []) {
        const h = defaultEffects[ref.type];
        const places = [...new Set([...(item.gadget!.usedIn ?? []), ...(item.gadget!.usedInByTier?.flat() ?? [])])];
        expect(h.onGadget, `${item.id}: ${ref.type} has no gadget handler`).toBeTypeOf('function');
        expect(places.some((p) => (h.places ?? ['duel']).includes(p)), `${item.id}: ${ref.type} works in none of ${places}`).toBe(true);
      }
    }
  });
});

describe('tiers and charges', () => {
  it('Brass and Gold reach the next drawing tier', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(tierOf)).toEqual([0, 0, 0, 0, 1, 1, 2, 2]);
  });

  it('tier params resolve inside params and conditions; plain lists stay lists', () => {
    expect(atTier({ a: [1, 2, 3], b: { c: [true, false, true] }, d: 5 }, 1)).toEqual({ a: 2, b: { c: false }, d: 5 });
    expect(atTier({ kind: ['battle', 'elite', 'boss'] }, 2)).toEqual({ kind: ['battle', 'elite', 'boss'] });
    expect(atTier({ kind: [['boss'], ['elite', 'boss'], ['elite', 'boss']] }, 1)).toEqual({ kind: ['elite', 'boss'] });
  });

  it('charges grow every two grades', () => {
    const watch = content.items.find((d) => d.id === 'pocket_watch')!.gadget!;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((g) => gadgetCharges(watch, g, defaultConfig))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('five living items of a collection give its gadgets +1 charge; the Orrery adds to the others', () => {
    const s = structuredClone(engine.newGame({ seed: 'ch' }));
    give(s, 'egg_timer');
    const egg = me(s).items[0];
    expect(maxCharges(content, s.config, egg, me(s))).toBe(1);
    give(s, 'orrery', 7);
    // Masterwork Orrery: your other Clockwork gadgets have +1 charge (not itself).
    expect(maxCharges(content, s.config, egg, me(s))).toBe(2);
    expect(maxCharges(content, s.config, me(s).items[1], me(s))).toBe(4);
    for (const id of ['alarm_clock', 'cuckoo_clock', 'mainspring']) give(s, id);
    expect(collectionCounts(content, me(s)).clockwork).toBe(5);
    expect(maxCharges(content, s.config, egg, me(s))).toBe(3);
  });

  it('the Perpetual Calendar makes Clockwork recharges cheaper', () => {
    const s = structuredClone(engine.newGame({ seed: 'rc' }));
    give(s, 'pocket_watch');
    const watch = me(s).items[0];
    expect(rechargeCost(content, s.config, watch, me(s))).toBe(5);
    give(s, 'perpetual_calendar', 7);
    expect(rechargeCost(content, s.config, watch, me(s))).toBe(3);
  });
});

describe('set bonuses and conditions', () => {
  it('three Clockwork items give +1 draw in every duel', () => {
    const two = duel({ items: [['egg_timer'], ['alarm_clock']] });
    const three = duel({ items: [['egg_timer'], ['alarm_clock'], ['mainspring']] });
    // Each of these gives +1 draw at Prototype except the Mainspring (boss duels only).
    expect(three.duel!.rules.drawLimit).toBe(two.duel!.rules.drawLimit + 1);
  });

  it('Bellows only helps against greedy minions', () => {
    const plain = duel({ items: [['bellows']], minions: ['rust_rat'] });
    const greedy = duel({ items: [['bellows']], minions: ['magpie'] });
    expect(greedy.duel!.rules.drawLimit).toBe(plain.duel!.rules.drawLimit + 1);
  });

  it('boss-only gadgets refuse minion duels', () => {
    const r = tryUse(duel({ items: [['water_clock']] }), 'water_clock');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/boss duels only/);
  });

  it('the Mainspring passive widens to elites at Fine', () => {
    const base = duel({ kind: 'elite', minions: ['junk_golem'] }).duel!.rules.handSize;
    expect(duel({ kind: 'elite', minions: ['junk_golem'], items: [['mainspring', 1]] }).duel!.rules.handSize).toBe(base);
    expect(duel({ kind: 'elite', minions: ['junk_golem'], items: [['mainspring', 5]] }).duel!.rules.handSize).toBe(base + 1);
  });
});

describe('turns and draws (Clockwork)', () => {
  it('Egg Timer: +2 draws this duel', () => {
    const s = duel({ items: [['egg_timer']] });
    expect(use(s, 'egg_timer').duel!.rules.drawLimit).toBe(s.duel!.rules.drawLimit + 2);
  });

  it('Metronome draws an extra card on every 4th turn', () => {
    let s = freeze(duel({ items: [['metronome']] }));
    for (let i = 0; i < 3; i++) s = turn(s);
    expect(s.duel!.turn).toBe(4);
    // Turn 4 began with an extra card: hand size + 1 before drawing.
    expect(s.duel!.hand.length).toBe(s.duel!.rules.handSize + 1);
  });

  it('Tourbillon: every 5th turn the opponents miss theirs; Spin the Cage draws 2 and discards 2', () => {
    let s = freeze(duel({ items: [['tourbillon']] }), 10);
    for (let i = 0; i < 4; i++) s = turn(s);
    expect(s.duel!.turn).toBe(5);
    expect(s.duel!.opponents[0].skip).toBe(10 - 4 + 1);
    s = use(s, 'tourbillon');
    s = turn(s); // finishes turn 5
    const draws = s.duel!.drawsTaken;
    s = act(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    expect(s.duel!.turnPhase).toBe('draw');
    s = act(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    expect(s.duel!.drawsTaken).toBe(draws + 1);
    s = act(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand[0] });
    expect(s.duel!.turn).toBe(6);
    s = act(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand[0] });
    expect(s.duel!.turn).toBe(7);
  });

  it("Mainspring: draw 2 now, then you don't draw next turn", () => {
    let s = freeze(duel({ items: [['mainspring']] }));
    const hand = s.duel!.hand.length;
    s = use(s, 'mainspring');
    expect(s.duel!.hand.length).toBe(hand + 2);
    s = turn(s);
    expect(s.duel!.turnPhase).toBe('main');
    expect(s.duel!.drawsTaken).toBe(2);
  });

  it("Alarm Clock: an opponent with a winning hand can't go out on its next turn", () => {
    let s = duel({ items: [['alarm_clock']] });
    setOpponentHand(s, WINNING);
    s = use(s, 'alarm_clock', { target: 0 });
    s = turn(s);
    expect(s.phase).toBe('duel');
    expect(s.duel!.opponents[0].noOut).toBe(0);
  });

  it('Chess Automaton: the first time an opponent would go out, it drops a card instead', () => {
    let s = duel({ items: [['chess_automaton']] });
    setOpponentHand(s, WINNING);
    s = turn(s);
    expect(s.phase).toBe('duel');
    expect(s.duel!.opponents[0].lastAction).toMatch(/stopped from going out/);
  });

  it('Chronometer: choose extra draws or a missed turn', () => {
    const s = duel({ items: [['chronometer']] });
    expect(use(s, 'chronometer', { option: 0 }).duel!.rules.drawLimit).toBe(s.duel!.rules.drawLimit + 2);
    expect(use(s, 'chronometer', { option: 1, target: 0 }).duel!.opponents[0].skip).toBe(1);
  });

  it('Astronomical Clock draws a card whenever an opponent misses a turn', () => {
    let s = duel({ items: [['astronomical_clock'], ['pocket_watch']] });
    s = use(s, 'pocket_watch', { target: 0 });
    const hand = s.duel!.hand.length;
    s = act(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    s = act(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand[0] });
    expect(s.duel!.hand.length).toBe(hand + 1);
  });

  it('Gearbox: runs wrap from 10 to 1, and Shift Gear moves a number', () => {
    const s = duel({ items: [['gearbox']] });
    const r = s.duel!.rules;
    const tok = (c: string, g: number) => ({ role: 'natural' as const, id: `${c}${g}`, category: c, gauge: g });
    const wrapped = [[tok('iron', 5), tok('wood', 5), tok('tin', 5)], [tok('copper', 9), tok('copper', 10), tok('copper', 1)]];
    expect(checkBuild(wrapped, SIMPLE, { ...r }).ok).toBe(true);
    expect(checkBuild(wrapped, SIMPLE, { ...r, wrapRuns: false }).ok).toBe(false);
    const t = structuredClone(s);
    const [id] = parts(t, ['iron:4']);
    t.duel!.hand.push(id);
    const shifted = use(t, 'gearbox', { cards: [id], values: [1] });
    expect(engine.token(shifted, id)).toMatchObject({ gauge: 5 });
  });
});

describe('the discard pile (Hearth)', () => {
  it('Kettle: your first draw from the discard pile is free', () => {
    let s = duel({ items: [['kettle']] });
    s = act(s, { type: 'DUEL_DRAW', playerId: P, source: 'discard' });
    expect(s.duel!.drawsTaken).toBe(0);
  });

  it('Kitchen Range: take any card from the discard pile, once', () => {
    let s = duel({ items: [['kitchen_range']] });
    const pile = parts(s, ['iron:1', 'iron:2', 'iron:3']);
    s.duel!.discard = [...pile];
    s = act(s, { type: 'DUEL_DRAW', playerId: P, source: 'discard', cardId: pile[0] });
    expect(s.duel!.hand).toContain(pile[0]);
    expect(s.duel!.fx.takeAnyUsed).toBe(1);
  });

  it('Fire Poker: take a card from the top 3 of the discard pile without using a draw', () => {
    let s = duel({ items: [['fire_poker']] });
    const pile = parts(s, ['iron:1', 'iron:2', 'iron:3', 'iron:4']);
    s.duel!.discard = [...pile];
    expect(tryUse(s, 'fire_poker', { cards: [pile[0]] }).ok).toBe(false);
    s = use(s, 'fire_poker', { cards: [pile[1]] });
    expect(s.duel!.hand).toContain(pile[1]);
    expect(s.duel!.drawsTaken).toBe(0);
  });

  it('Coal Scuttle: take the top 2, then choose a card to discard', () => {
    let s = duel({ items: [['coal_scuttle']] });
    const pile = parts(s, ['iron:1', 'iron:2']);
    s.duel!.discard = [...pile];
    s = use(s, 'coal_scuttle');
    expect(s.duel!.choice?.kind).toBe('pick');
    const drop = s.duel!.hand[0];
    s = act(s, { type: 'DUEL_CHOOSE', playerId: P, cardIds: [drop] });
    expect(s.duel!.discard.at(-1)).toBe(drop);
    expect(s.duel!.choice).toBeNull();
  });

  it('Toasting Fork: swap a card in your hand with the top of the discard pile', () => {
    let s = duel({ items: [['toasting_fork']] });
    const [top] = parts(s, ['brass:7']);
    s.duel!.discard.push(top);
    const mine = s.duel!.hand[0];
    s = use(s, 'toasting_fork', { cards: [mine] });
    expect(s.duel!.hand).toContain(top);
    expect(s.duel!.discard.at(-1)).toBe(mine);
  });

  it('Mousetrap: the card an opponent takes from the discard pile comes to you', () => {
    let s = duel({ items: [['mousetrap']], minions: ['magpie'] });
    setOpponentHand(s, ['iron:5', 'wood:5', 'copper:1', 'tin:9', 'iron:9', 'wood:9', 'brass:2']);
    s = use(s, 'mousetrap');
    const [bait] = parts(s, ['brass:5']);
    s = act(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    s = structuredClone(s);
    s.duel!.hand.push(bait);
    s = act(s, { type: 'DUEL_DISCARD', playerId: P, cardId: bait });
    expect(s.duel!.hand).toContain(bait);
    expect(s.duel!.fx.trap).toBeNull();
  });

  it('Escapement: nobody can take from the discard pile while it is locked', () => {
    let s = duel({ items: [['escapement']] });
    s = use(s, 'escapement');
    expect(engine.applyAction(s, { type: 'DUEL_DRAW', playerId: P, source: 'discard' }).ok).toBe(false);
  });

  it('Bellows: blow the discard pile out of the duel', () => {
    let s = duel({ items: [['bellows']] });
    s.duel!.discard.push(...parts(s, ['iron:1', 'iron:2']));
    s = use(s, 'bellows');
    expect(s.duel!.discard).toEqual([]);
  });

  it('Firedogs: cycle a card; set cards aside, and they must go out with you', () => {
    let s = duel({ items: [['firedogs']] });
    s = act(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    const old = s.duel!.hand[0];
    s = act(s, { type: 'DUEL_CYCLE', playerId: P, cardId: old });
    expect(s.duel!.hand).not.toContain(old);
    expect(engine.applyAction(s, { type: 'DUEL_CYCLE', playerId: P, cardId: s.duel!.hand[0] }).ok).toBe(false);
    s = structuredClone(s);
    const ids = parts(s, WINNING);
    s.duel!.hand = [...ids];
    s = use(s, 'firedogs', { cards: [ids[6]] });
    expect(s.duel!.fx.setAside).toEqual([ids[6]]);
    const without = engine.applyAction(s, { type: 'DUEL_GO_OUT', playerId: P, groups: [ids.slice(0, 3), ids.slice(3, 6)] });
    expect(without.ok).toBe(false);
  });
});

describe('opponents', () => {
  it('Salvage Rig (Fine): look at 2 cards and take 1', () => {
    let s = duel({ items: [['salvage_rig', 5]] });
    s = use(s, 'salvage_rig', { target: 0 });
    expect(s.duel!.choice?.cardIds).toHaveLength(2);
    const pick = s.duel!.choice!.cardIds[1];
    s = act(s, { type: 'DUEL_CHOOSE', playerId: P, cardIds: [pick] });
    expect(s.duel!.hand).toContain(pick);
  });

  it('Swap Boards (Fine): putting it back keeps the charge', () => {
    let s = duel({ items: [['chess_automaton', 5]] });
    const charges = me(s).items[0].charges!;
    s = use(s, 'chess_automaton', { target: 0 });
    expect(s.duel!.choice?.kind).toBe('confirm');
    s = act(s, { type: 'DUEL_CHOOSE', playerId: P, confirm: false });
    expect(me(s).items[0].charges).toBe(charges);
  });

  it('Clockwork Mouse (Fine): choose the card an opponent drops', () => {
    let s = duel({ items: [['clockwork_mouse', 5]] });
    s = use(s, 'clockwork_mouse', { target: 0 });
    const card = s.duel!.choice!.cardIds[2];
    s = act(s, { type: 'DUEL_CHOOSE', playerId: P, cardIds: [card] });
    expect(s.duel!.discard.at(-1)).toBe(card);
    expect(s.duel!.opponents[0].hand).not.toContain(card);
  });
});

describe('stakes, lives and results', () => {
  it('Brass Scales: stake one material below what is asked', () => {
    let s = structuredClone(engine.newGame({ seed: 'scales' }));
    give(s, 'brass_scales');
    const node = s.map!.rows[0][0];
    node.type = 'battle';
    node.encounter = { minions: ['rust_rat'], stakes: [{ kind: 'part', category: 'wood', gauge: 3 }], stakeRule: { category: 'wood', count: 1 } };
    s = act(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: node.id });
    const tin = me(s).deck.find((id) => s.cards[id].kind === 'part' && (s.cards[id] as { category: string }).category === 'tin')!;
    expect(engine.applyAction(s, { type: 'DUEL_STAKE', playerId: P, cardIds: [tin] }).ok).toBe(true);
  });

  it('Stopped Clock: insured, a lost duel costs no stake', () => {
    let s = duel({ items: [['stopped_clock']] });
    s = use(s, 'stopped_clock');
    s = loseDuel(s);
    expect(s.duel!.result!.lostStake).toEqual([]);
  });

  it('Fire Blanket: the first lost life in a run is saved; Smother calls a duel off', () => {
    let s = duel({ kind: 'boss', minions: ['the_foreman'], items: [['fire_blanket']] });
    const lives = me(s).lives;
    s = loseDuel(s);
    expect(me(s).lives).toBe(lives);
    expect(me(s).spareLives.run).toBe(true);

    let m = duel({ items: [['fire_blanket']] });
    m = use(m, 'fire_blanket');
    expect(m.phase).toBe('duelResult');
    expect(m.duel!.result).toMatchObject({ won: false, drawn: true, lostStake: [] });
  });

  it('Grandfather Clock: after a loss, the duel starts again and the life comes back', () => {
    let s = duel({ kind: 'boss', minions: ['the_foreman'], items: [['grandfather_clock']] });
    const lives = me(s).lives;
    s = loseDuel(s);
    expect(me(s).lives).toBe(lives - 1);
    s = use(s, 'grandfather_clock');
    expect(s.phase).toBe('duel');
    expect(me(s).lives).toBe(lives);
    expect(s.duel!.turn).toBe(1);
    expect(s.duel!.fx.replayed).toBe(true);
  });

  it('Pendulum: after a win, credits for each draw you did not use', () => {
    let s = duel({ items: [['pendulum']] });
    s = goOut(s);
    const before = me(s).currency;
    s = use(s, 'pendulum');
    expect(me(s).currency).toBe(before + 4);
  });

  it('Pot-Bellied Stove: going out pulls each opponent’s best card into the pot', () => {
    let s = duel({ items: [['pot_bellied_stove']] });
    const pot = s.duel!.pot.length;
    s = goOut(s);
    expect(s.duel!.pot.length).toBe(pot + 1);
  });

  it('Coin Press: you and the opponent each add a part of the stake material', () => {
    let s = duel({ items: [['coin_press']] });
    const pot = s.duel!.pot.length;
    s = use(s, 'coin_press');
    expect(s.duel!.pot.length).toBe(pot + 2);
    expect(s.duel!.playerStake).toHaveLength(2);
  });

  it('Oil Can: switching off Short Fuse gives the draws back; the Tinderbox softens it', () => {
    let s = duel({ kind: 'boss', minions: ['the_foreman'], items: [['oil_can']], twists: ['short_fuse'] });
    const cut = s.duel!.rules.drawLimit;
    s = use(s, 'oil_can');
    expect(s.duel!.rules.drawLimit).toBe(cut + 3);
    const t = duel({ kind: 'boss', minions: ['the_foreman'], items: [['tinderbox']], twists: ['short_fuse'] });
    expect(t.duel!.rules.drawLimit).toBe(cut + 1);
  });

  it('Glue Pot (Fine): its tapes count as real parts', () => {
    let s = duel({ items: [['glue_pot', 5]] });
    s = use(s, 'glue_pot');
    const tape = s.duel!.hand.at(-1)!;
    expect(engine.token(s, tape)).toMatchObject({ role: 'wild', natural: true });
  });
});

describe('outside duels', () => {
  it('Orrery on the map: restore charges to your other gadgets', () => {
    let s = structuredClone(engine.newGame({ seed: 'orr' }));
    give(s, 'orrery');
    give(s, 'egg_timer');
    me(s).items[1].charges = 0;
    s = use(s, 'orrery');
    expect(me(s).items[1].charges).toBe(1);
  });

  it('Pocket Compass: reroute to any stop in the next row', () => {
    let s = structuredClone(engine.newGame({ seed: 'compass' }));
    give(s, 'pocket_compass');
    s = act(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    s = structuredClone(s);
    s.phase = 'map';
    s.duel = null;
    s = use(s, 'pocket_compass');
    expect(reachableNodes(s.map!).filter((n) => n.row === 1)).toHaveLength(s.map!.rows[1].length);
  });

  it('Abacus: the next purchase in this shop costs 2 less', () => {
    let s = structuredClone(engine.newGame({ seed: 'abacus' }));
    give(s, 'abacus');
    s.map!.rows[0][0].type = 'shop';
    s = act(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    s = use(s, 'abacus');
    const slot = s.shop!.slots.findIndex((x) => x.kind === 'tool');
    s = structuredClone(s);
    me(s).currency = 50;
    s = act(s, { type: 'SHOP_BUY', playerId: P, slot });
    expect(me(s).currency).toBe(50 - Math.max(1, s.shop!.slots[slot].price - 2));
    expect(s.shop!.discount).toBeNull();
  });

  it('Crowbar: pick another parcel; credits for each one left behind', () => {
    let s = goOut(duelWithLot([['crowbar']]));
    s = act(s, { type: 'CONTINUE', playerId: P });
    const picks = s.rummage!.lot.picks;
    s = use(s, 'crowbar');
    expect(s.rummage!.lot.picks).toBe(picks + 1);
    const before = me(s).currency;
    const n = s.rummage!.lot.picks;
    s = act(s, { type: 'PICK_PARCELS', playerId: P, parcels: Array.from({ length: n }, (_, i) => i) });
    expect(me(s).currency).toBe(before + (s.rummage!.lot.parcels.length - n));
  });

  it('Wind-Up Key: unwrap a parcel on the pick screen', () => {
    let s = goOut(duelWithLot([['wind_up_key']]));
    s = act(s, { type: 'CONTINUE', playerId: P });
    s = use(s, 'wind_up_key', { parcels: [0] });
    expect(s.rummage!.lot.parcels[0]).toMatchObject({ metalOptions: 1, gaugeOptions: 1 });
  });

  it('Sewing Kit: move pieces from one page to another', () => {
    let s = structuredClone(engine.newGame({ seed: 'sew' }));
    give(s, 'sewing_kit');
    me(s).scrapbook.egg_timer = [2, 0, 0, 0, 0, 0, 0, 0];
    s = use(s, 'sewing_kit', { pages: ['egg_timer', 'kettle'], stage: 1 });
    expect(me(s).scrapbook.egg_timer[0]).toBe(0);
    expect(me(s).scrapbook.kettle[0]).toBe(2);
  });

  it('Thimble: put a part from your deck onto a page', () => {
    let s = structuredClone(engine.newGame({ seed: 'darn' }));
    give(s, 'thimble');
    const tin = me(s).deck.find((id) => (s.cards[id] as { category?: string }).category === 'tin')!;
    s = use(s, 'thimble', { cards: [tin], pages: ['kettle'] });
    expect(me(s).deck).not.toContain(tin);
    expect(me(s).scrapbook.kettle[0]).toBe(1);
  });

  it('Thimble passive: Tin pieces count double on Tin stages', () => {
    let s = goOut(duelWithLot([['thimble']]));
    s = act(s, { type: 'CONTINUE', playerId: P });
    s = structuredClone(s);
    s.rummage!.lot.parcels[0].piece = { kind: 'part', category: 'tin', gauge: 2 };
    s.rummage!.lot.picks = 1;
    s = act(s, { type: 'PICK_PARCELS', playerId: P, parcels: [0] });
    s = act(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'page', itemId: 'kettle' }] });
    expect(me(s).scrapbook.kettle[0]).toBe(2);
  });

  it('a rest can recharge more than one gadget (the Apothecary bonus adds one)', () => {
    let s = structuredClone(engine.newGame({ seed: 'rest2', config: { restRecharges: 2 } }));
    for (const id of ['egg_timer', 'alarm_clock']) give(s, id);
    s.map!.rows[0][0].type = 'rest';
    for (const it of me(s).items) it.charges = 0;
    s = act(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    s = act(s, { type: 'REST', playerId: P, choice: 'recharge', itemUid: 'u-egg_timer' });
    expect(s.phase).toBe('rest');
    s = act(s, { type: 'REST', playerId: P, choice: 'recharge', itemUid: 'u-alarm_clock' });
    expect(s.phase).toBe('map');
  });
});

describe('pages in a run', () => {
  const paged = (seed: string) => structuredClone(engine.newGame({ seed, config: { scrapbook: { ...defaultConfig.scrapbook } } }));

  it('a run starts by choosing 3 of 5 Common pages', () => {
    let s = paged('pages');
    expect(s.phase).toBe('pageOffer');
    expect(s.pageOffer!.options).toHaveLength(5);
    expect(s.pageOffer!.options.every((id) => content.items.find((d) => d.id === id)!.rarity === 'common')).toBe(true);
    s = act(s, { type: 'PICK_PAGES', playerId: P, itemIds: s.pageOffer!.options.slice(0, 3) });
    expect(s.phase).toBe('map');
    expect(me(s).pages).toHaveLength(3);
  });

  it('only pages in your scrapbook take pieces', () => {
    let s = paged('only');
    const [a] = s.pageOffer!.options;
    s = act(s, { type: 'PICK_PAGES', playerId: P, itemIds: s.pageOffer!.options.slice(0, 3) });
    const missing = content.items.find((d) => !me(s).pages!.includes(d.id))!.id;
    expect(stageFor(s.config, content, me(s), a, { kind: 'part', category: 'tin', gauge: 1 })).toBe(1);
    expect(stageFor(s.config, content, me(s), missing, { kind: 'part', category: 'tin', gauge: 1 })).toBeNull();
  });

  it('a loose page goes into the scrapbook; a full one needs a page torn out, and its item dies', () => {
    let s = paged('loose');
    s = act(s, { type: 'PICK_PAGES', playerId: P, itemIds: s.pageOffer!.options.slice(0, 3) });
    s = structuredClone(s);
    const first = me(s).pages![0];
    me(s).scrapbook[first] = [piecesNeeded(s.config, 1), 0, 0, 0, 0, 0, 0, 0];
    give(s, first);
    const fill = content.items.filter((d) => !me(s).pages!.includes(d.id)).map((d) => d.id);
    me(s).pages!.push(...fill.slice(0, 9));
    const newPage = fill[9];
    s.phase = 'rummage';
    s.rummage = { lotName: 'Test', stage: 'sort', lot: { lotId: 'shoebox', name: 'Test', picks: 1, parcels: [] }, pieces: [{ kind: 'page', itemId: newPage }], missed: [], afterBoss: false, bonus: [] };
    expect(engine.applyAction(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'scrapbook' }] }).ok).toBe(false);
    s = act(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'scrapbook', tearOut: first }] });
    expect(me(s).pages).toContain(newPage);
    expect(me(s).pages).not.toContain(first);
    expect(me(s).items.some((i) => i.itemId === first)).toBe(false);
  });

  it('shops sell a page', () => {
    let s = paged('shop');
    s = act(s, { type: 'PICK_PAGES', playerId: P, itemIds: s.pageOffer!.options.slice(0, 3) });
    s = structuredClone(s);
    s.map!.rows[0][0].type = 'shop';
    s = act(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    const slot = s.shop!.slots.findIndex((x) => x.kind === 'page');
    expect(slot).toBeGreaterThanOrEqual(0);
    s = structuredClone(s);
    me(s).currency = 50;
    s = act(s, { type: 'SHOP_BUY', playerId: P, slot });
    expect(me(s).pages).toContain(s.shop!.slots[slot].itemId);
  });

  it('the boss lot always holds a Rare or Heirloom page', () => {
    const s = paged('bosslot');
    const boss = s.map!.rows.at(-1)![0];
    const page = boss.encounter!.lot!.parcels.find((p) => p.piece.kind === 'page');
    expect(page).toBeDefined();
    expect(['rare', 'heirloom']).toContain(content.items.find((d) => d.id === page!.piece.itemId)!.rarity);
  });
});

// ---------------------------------------------------------------------------

function setOpponentHand(s: GameState, specs: string[]) {
  s.duel!.opponents[0].hand = parts(s, specs);
  s.duel!.opponents[0].drawPile.push(...parts(s, ['tin:9', 'tin:9', 'tin:9']));
}

/** Go out with a winning hand. */
function goOut(s: GameState): GameState {
  const t = structuredClone(s);
  const ids = parts(t, WINNING);
  t.duel!.hand = ids;
  return act(t, { type: 'DUEL_GO_OUT', playerId: P, groups: [ids.slice(0, 3), ids.slice(3, 6)] });
}

/** Lose: the opponent goes out on its turn. */
function loseDuel(s: GameState): GameState {
  const t = structuredClone(s);
  t.duel!.hand = parts(t, ['tin:1', 'wood:3', 'iron:7', 'brass:9', 'copper:5', 'tin:8', 'wood:10']);
  t.duel!.opponents[0].hand = parts(t, WINNING);
  return turn(t);
}

/** A duel over a real lot, with a gadget item alive. */
function duelWithLot(items: [string, number?][]): GameState {
  let s = structuredClone(engine.newGame({ seed: 'lot' }));
  for (const [id, grade] of items) give(s, id, grade ?? 1);
  const node = s.map!.rows[0].find((n) => n.encounter?.lot) ?? s.map!.rows.flat().find((n) => n.encounter?.lot)!;
  const target = s.map!.rows[0][0];
  target.type = node.type;
  target.encounter = structuredClone(node.encounter);
  s = act(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: target.id });
  s = act(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
  s = structuredClone(s);
  s.duel!.requirements = SIMPLE;
  return s;
}



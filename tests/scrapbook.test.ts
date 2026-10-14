import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { digDepth, piecesNeeded, pieceVisibility, stageFor } from '../src/engine/scrapbook';
import type { CardId, GameState, Lot, NodeType, RewardOption } from '../src/engine/types';
import { createPart } from '../src/engine/zones';
import { mapEngine as engine, sortLot, stakeFor } from './helpers';

const P = 'p1';
const me = (s: GameState) => s.players[0];
const grade = (cat: string) => defaultContent.categories.find((c) => c.id === cat)!.grade;
const part = (spec: string): RewardOption => ({ kind: 'part', category: spec.split(':')[0], gauge: Number(spec.split(':')[1]) });

function enterDuel(kind: NodeType = 'battle', seed = 'lots'): GameState {
  const s = structuredClone(engine.newGame({ seed }));
  const node = s.map!.rows[0][0];
  node.type = kind;
  delete node.encounter;
  return engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: node.id });
}

/** Put the player straight into sorting these pieces. */
function rummaging(pieces: RewardOption[], seed = 'sort'): GameState {
  const s = structuredClone(engine.newGame({ seed }));
  s.phase = 'rummage';
  s.rummage = { lotName: 'Test Box', pieces, leftBehind: 0, afterBoss: false };
  return s;
}

describe('the scrapbook map', () => {
  it('has no workshops; every fight is over a lot with a matched stake', () => {
    const s = engine.newGame({ seed: 'sb-map' });
    const nodes = s.map!.rows.flat();
    expect(nodes.some((n) => n.type === 'workshop' || n.type === 'masterWorkshop')).toBe(false);
    for (const n of nodes.filter((x) => ['battle', 'elite', 'boss'].includes(x.type))) {
      const enc = n.encounter!;
      expect(enc.lot!.pieces.length).toBeGreaterThan(0);
      const rule = enc.stakeRule!;
      // Every minion stakes the same number of parts of the same material.
      expect(enc.stakes).toHaveLength(rule.count * enc.minions.length);
      expect(enc.stakes.every((o) => o.kind === 'part' && o.category === rule.category)).toBe(true);
    }
  });

  it('lots are the same for the same seed', () => {
    const a = engine.newGame({ seed: 'same' }).map!.rows.flat().map((n) => n.encounter?.lot);
    const b = engine.newGame({ seed: 'same' }).map!.rows.flat().map((n) => n.encounter?.lot);
    expect(a).toEqual(b);
  });

  it('rare pieces sit at the bottom of the box', () => {
    for (const seed of ['r1', 'r2', 'r3', 'r4']) {
      for (const n of engine.newGame({ seed }).map!.rows.flat()) {
        const pieces = n.encounter?.lot?.pieces ?? [];
        const firstRare = pieces.findIndex((p) => p.kind === 'special' || grade(p.category!) >= 5);
        if (firstRare < 0) continue;
        expect(pieces.slice(firstRare).every((p) => p.kind === 'special' || grade(p.category!) >= 5)).toBe(true);
      }
    }
  });
});

describe('catalogue levels', () => {
  const lot = (catalogue: Lot['catalogue']): Lot => ({
    lotId: 'x', name: 'X', catalogue, pieces: [part('tin:1'), part('wood:2'), part('iron:3'), part('gold:4')],
    sizeRange: [4, 4], rareChance: 0.1, gemChance: 0,
  });
  it('itemised shows everything; partly itemised hides the metal of the lower half', () => {
    expect([0, 1, 2, 3].map((i) => pieceVisibility(lot(1), i))).toEqual(['full', 'full', 'full', 'full']);
    expect([0, 1, 2, 3].map((i) => pieceVisibility(lot(2), i))).toEqual(['full', 'full', 'metal', 'metal']);
  });
  it('contents-only shows what pieces are; sealed shows nothing', () => {
    expect(pieceVisibility(lot(3), 0)).toBe('part');
    expect(pieceVisibility(lot(4), 0)).toBe('hidden');
  });
});

describe('matched stakes', () => {
  it('you must stake the same number of parts, of the same material or better', () => {
    const s = enterDuel('battle', 'stake');
    const rule = s.duel!.stakeRule!;
    const need = grade(rule.category);
    const worse = me(s).deck.filter((id) => {
      const c = s.cards[id];
      return c.kind === 'part' && grade(c.category) < need;
    });
    const better = me(s).deck.filter((id) => {
      const c = s.cards[id];
      return c.kind === 'part' && grade(c.category) > need;
    });
    if (worse.length >= rule.count) {
      const r = engine.applyAction(s, { type: 'DUEL_STAKE', playerId: P, cardIds: worse.slice(0, rule.count) });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/or better/);
    }
    expect(engine.applyAction(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s).slice(0, rule.count - 1) }).ok).toBe(false);
    expect(engine.applyAction(s, { type: 'DUEL_STAKE', playerId: P, cardIds: better.slice(0, rule.count) }).ok).toBe(true);
    const ok = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
    expect(ok.duel!.pot).toHaveLength(s.duel!.pot.length + rule.count);
  });

  it('you can walk away before staking, but not from the boss', () => {
    const s = enterDuel('battle', 'walk');
    const out = engine.reduce(s, { type: 'DUEL_WALK_AWAY', playerId: P });
    expect(out.phase).toBe('map');
    expect(out.duel).toBeNull();
    expect(Object.values(out.cards).some((c) => c.temporary)).toBe(false);
    expect(engine.applyAction(enterDuel('boss', 'walk'), { type: 'DUEL_WALK_AWAY', playerId: P }).ok).toBe(false);
  });

  it('if you cannot match the boss stake, any parts will do', () => {
    let s = structuredClone(enterDuel('boss', 'poor'));
    s.duel!.stakeRule = { category: 'copper', count: 2 };
    // Keep only tin parts.
    me(s).deck = me(s).deck.filter((id) => s.cards[id].kind === 'part' && (s.cards[id] as { category: string }).category === 'tin');
    s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: me(s).deck.slice(0, 2) });
    expect(s.phase).toBe('duel');
  });
});

describe('digging into a won lot', () => {
  function won(opts: { drawsTaken: number; leftOver: number; bigMeld: boolean }) {
    const s = enterDuel('battle', 'dig');
    const duel = structuredClone(s.duel!);
    duel.lot!.pieces = Array.from({ length: 10 }, (_, i) => part(`tin:${(i % 8) + 1}`));
    duel.requirements = [{ type: 'set', size: 3 }];
    duel.drawsTaken = opts.drawsTaken;
    const meld = Array.from({ length: opts.bigMeld ? 4 : 3 }, (_, i) => `m${i}`);
    duel.winningMelds = [meld];
    duel.hand = [...meld, ...Array.from({ length: opts.leftOver }, (_, i) => `x${i}`)];
    return digDepth(defaultConfig, duel);
  }

  it('always takes the top half', () => {
    expect(won({ drawsTaken: 10, leftOver: 5, bigMeld: false }).taken).toBe(5);
  });

  it('going out quickly, cleanly and with a big meld digs deeper', () => {
    const d = won({ drawsTaken: 2, leftOver: 1, bigMeld: true });
    const dig = defaultConfig.scrapbook.dig;
    expect(d.taken).toBe(5 + dig.quickBonus + dig.cleanBonus + dig.bigMeldBonus);
    expect(d.parts).toHaveLength(4);
  });

  it('winning a showdown only gets the top half', () => {
    const s = enterDuel('battle', 'dig2');
    const duel = structuredClone(s.duel!);
    duel.lot!.pieces = Array.from({ length: 7 }, () => part('tin:1'));
    duel.winningMelds = null;
    expect(digDepth(defaultConfig, duel).taken).toBe(4);
  });

  it('a won duel goes to the rummage screen with the dug-out pieces', () => {
    let s = structuredClone(enterDuel('battle', 'win'));
    s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
    s = structuredClone(s);
    s.duel!.requirements = [{ type: 'set', size: 3 }, { type: 'run', size: 3 }];
    const ids: CardId[] = ['iron:5', 'wood:5', 'tin:5', 'copper:1', 'copper:2', 'copper:3', 'iron:9'].map(
      (spec) => createPart(s, defaultContent, P, spec.split(':')[0], Number(spec.split(':')[1]), true).id,
    );
    s.duel!.hand = ids;
    const lot = s.duel!.lot!;
    s = engine.reduce(s, { type: 'DUEL_GO_OUT', playerId: P, groups: [ids.slice(0, 3), ids.slice(3, 6)] });
    const dig = s.duel!.result!.dig!;
    expect(dig.total).toBe(lot.pieces.length);
    s = engine.reduce(s, { type: 'CONTINUE', playerId: P });
    expect(s.phase).toBe('rummage');
    expect(s.rummage!.pieces).toEqual(lot.pieces.slice(0, dig.taken));
    expect(s.rummage!.leftBehind).toBe(lot.pieces.length - dig.taken);
    expect(sortLot(s).phase).toBe('map');
  });
});

describe('sorting pieces into the scrapbook', () => {
  it('a finished Tin stage brings the item to life', () => {
    const n = piecesNeeded(defaultConfig, 1);
    let s = rummaging(Array.from({ length: n }, (_, i) => part(`tin:${i + 1}`)));
    s = engine.reduce(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: s.rummage!.pieces.map(() => ({ to: 'page', itemId: 'pocket_watch' })) });
    expect(s.phase).toBe('map');
    expect(me(s).scrapbook.pocket_watch[0]).toBe(n);
    const watch = me(s).items.find((i) => i.itemId === 'pocket_watch')!;
    expect(watch).toMatchObject({ grade: 1, material: 'Tin' });
    expect(watch.charges).toBeGreaterThan(0);
  });

  it('a higher stage raises the item and recharges it', () => {
    let s = rummaging([part('tin:1')], 'raise');
    me(s).scrapbook.pocket_watch = [piecesNeeded(defaultConfig, 1) - 1, 0, piecesNeeded(defaultConfig, 3) - 1, 0, 0, 0, 0, 0];
    s = engine.reduce(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'page', itemId: 'pocket_watch' }] });
    me(s).items[0].charges = 0;
    s.phase = 'rummage';
    s.rummage = { lotName: 'Box', pieces: [part('iron:4')], leftBehind: 0, afterBoss: false };
    s = engine.reduce(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'page', itemId: 'pocket_watch' }] });
    const watch = me(s).items.find((i) => i.itemId === 'pocket_watch')!;
    expect(watch).toMatchObject({ grade: 3, material: 'Iron' });
    expect(watch.charges).toBeGreaterThan(0);
    expect(me(s).items.filter((i) => i.itemId === 'pocket_watch')).toHaveLength(1);
  });

  it('a better piece can fill a lower stage once its own is full', () => {
    const s = rummaging([]);
    expect(stageFor(defaultConfig, defaultContent, me(s), 'magnifier', part('copper:2'))).toBe(4);
    me(s).scrapbook.magnifier = [0, 0, 0, piecesNeeded(defaultConfig, 4), 0, 0, 0, 0];
    expect(stageFor(defaultConfig, defaultContent, me(s), 'magnifier', part('copper:2'))).toBe(3);
  });

  it('pieces can go to the parts deck or be sold', () => {
    let s = rummaging([part('copper:7'), part('gold:2')], 'sell');
    const deck = me(s).deck.length;
    const credits = me(s).currency;
    s = engine.reduce(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'deck' }, { to: 'sell' }] });
    expect(me(s).deck).toHaveLength(deck + 1);
    expect(me(s).currency).toBe(credits + defaultConfig.scrapbook.sellPerGrade * grade('gold'));
  });

  it('every piece needs a destination, and specials cannot go on pages', () => {
    const s = rummaging([part('tin:1'), { kind: 'special', specialId: 'ruby_bearing' }], 'bad');
    expect(engine.applyAction(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'deck' }] }).ok).toBe(false);
    expect(
      engine.applyAction(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'deck' }, { to: 'page', itemId: 'pocket_watch' }] }).ok,
    ).toBe(false);
  });

  it('after a boss lot, sorting moves on to the next act', () => {
    let s = rummaging([part('tin:1')], 'bosslot');
    s.rummage!.afterBoss = true;
    s = engine.reduce(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [{ to: 'deck' }] });
    expect(s.tier).toBe(1);
    expect(s.phase).toBe('map');
  });
});

describe('items work in duels', () => {
  it('the Magnifier catalogues lots one level better', async () => {
    const { catalogueFor } = await import('../src/engine/scrapbook');
    const s = structuredClone(engine.newGame({ seed: 'mag' }));
    const lot = { lotId: 'x', name: 'X', catalogue: 4 as const, pieces: [], sizeRange: [1, 1] as [number, number], rareChance: 0, gemChance: 0 };
    expect(catalogueFor(defaultContent, me(s), lot)).toBe(4);
    me(s).items.push({ uid: 'm', itemId: 'magnifier', fromBlueprint: 'x', builtFrom: 1, level: 1, usesLeft: null, charges: 1, grade: 1, material: 'Tin' });
    expect(catalogueFor(defaultContent, me(s), lot)).toBe(3);
    expect(catalogueFor(defaultContent, me(s), { ...lot, catalogue: 1 })).toBe(1);
  });

  it('Glue Pot gives a Duct Tape in duels; Coin Press pays after a duel', () => {
    let s = structuredClone(enterDuel('battle', 'glue'));
    for (const itemId of ['glue_pot', 'coin_press']) {
      me(s).items.push({ uid: itemId, itemId, fromBlueprint: 'x', builtFrom: 1, level: 1, usesLeft: null, charges: 1, grade: 1, material: 'Tin' });
    }
    s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
    const tape = s.duel!.hand.filter((id) => s.cards[id].kind === 'special' && (s.cards[id] as { specialId: string }).specialId === 'duct_tape');
    expect(tape.length).toBeGreaterThan(0);
    expect(s.cards[tape[0]].temporary).toBe(true);
    s = structuredClone(s);
    s.duel!.rules.drawLimit = 1;
    const before = me(s).currency;
    s = engine.reduce(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    s = engine.reduce(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand.at(-1)! });
    expect(s.phase).toBe('duelResult');
    expect(me(s).currency - before - (s.duel!.result!.currency ?? 0)).toBe(2);
  });
});

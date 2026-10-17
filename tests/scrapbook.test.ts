import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { checkParcel, piecesNeeded, sharpened, stageFor, viewParcel } from '../src/engine/scrapbook';
import type { CardId, GameState, NodeType, Parcel, RewardOption } from '../src/engine/types';
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
  s.rummage = { lotName: 'Test Box', stage: 'sort', lot: { lotId: 'x', name: 'Test Box', picks: pieces.length, parcels: [] }, pieces, missed: [], afterBoss: false, bonus: [] };
  return s;
}

/** A parcel holding `spec` with fixed look-alikes, nothing known yet. */
function parcel(spec: string): Parcel {
  return { piece: part(spec), altMetals: ['tin', 'gold', 'iron'], altGauges: [2, 9, 4], metalOptions: 0, gaugeOptions: 0 };
}

describe('the scrapbook map', () => {
  it('has no workshops; every fight is over a lot with a matched stake', () => {
    const s = engine.newGame({ seed: 'sb-map' });
    const nodes = s.map!.rows.flat();
    expect(nodes.some((n) => n.type === 'workshop' || n.type === 'masterWorkshop')).toBe(false);
    for (const n of nodes.filter((x) => ['battle', 'elite', 'boss'].includes(x.type))) {
      const enc = n.encounter!;
      expect(enc.lot!.parcels.length).toBeGreaterThan(0);
      expect(enc.lot!.picks).toBeLessThanOrEqual(enc.lot!.parcels.length);
      expect(enc.lot!.parcels.every((p) => p.metalOptions === 0 && p.gaugeOptions === 0)).toBe(true);
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

  it('each lot type has its own number of picks', () => {
    for (const n of engine.newGame({ seed: 'picks' }).map!.rows.flat()) {
      const lot = n.encounter?.lot;
      if (!lot) continue;
      const def = defaultContent.lots.find((l) => l.id === lot.lotId)!;
      expect(lot.picks).toBe(Math.min(def.picks, lot.parcels.length));
    }
  });
});

describe('checking parcels', () => {
  it('a number check is certain of the number and narrows the metal to a list that includes the truth', () => {
    const p = parcel('copper:6');
    checkParcel(p, 'gauge', 4);
    const v = viewParcel(defaultContent, p);
    expect(v).toMatchObject({ kind: 'gauge', gauge: 6 });
    if (v.kind === 'gauge') {
      expect(v.metals).toHaveLength(4);
      expect(v.metals).toContain('copper');
    }
  });

  it('a metal check is certain of the metal and narrows the number', () => {
    const p = parcel('copper:6');
    checkParcel(p, 'metal', 2);
    const v = viewParcel(defaultContent, p);
    expect(v).toMatchObject({ kind: 'metal', metal: 'copper' });
    if (v.kind === 'metal') expect(v.gauges.sort((a, b) => a - b)).toEqual([2, 6]);
  });

  it('sharper checks narrow the same list, so checks never contradict each other', () => {
    const p = parcel('copper:6');
    checkParcel(p, 'gauge', 4);
    const wide = viewParcel(defaultContent, p);
    checkParcel(p, 'gauge', 2);
    const narrow = viewParcel(defaultContent, p);
    if (wide.kind === 'gauge' && narrow.kind === 'gauge') {
      expect(narrow.metals).toHaveLength(2);
      for (const m of narrow.metals) expect(wide.metals).toContain(m);
    } else throw new Error('expected number checks');
    // A wider check after a sharper one tells you nothing new.
    expect(() => checkParcel(p, 'gauge', 3)).toThrow(/anything new/);
  });

  it('a number check and a metal check together, or an Unwrap, show it exactly', () => {
    const p = parcel('copper:6');
    checkParcel(p, 'gauge', 4);
    checkParcel(p, 'metal', 4);
    expect(viewParcel(defaultContent, p)).toEqual({ kind: 'known', piece: part('copper:6') });
    const q = parcel('tin:3');
    checkParcel(q, 'both', 1);
    expect(viewParcel(defaultContent, q).kind).toBe('known');
    expect(() => checkParcel(q, 'metal', 2)).toThrow(/already know/);
  });

  it('in real lots the truth is always in the list, and the list has no repeats', () => {
    for (const seed of ['c1', 'c2', 'c3']) {
      for (const n of engine.newGame({ seed }).map!.rows.flat()) {
        for (const original of n.encounter?.lot?.parcels ?? []) {
          if (original.piece.kind !== 'part') continue;
          const p = structuredClone(original);
          checkParcel(p, 'gauge', 4);
          const v = viewParcel(defaultContent, p);
          if (v.kind !== 'gauge') throw new Error('expected a number check');
          expect(v.metals).toContain(p.piece.category);
          expect(new Set(v.metals).size).toBe(v.metals.length);
          const q = structuredClone(original);
          checkParcel(q, 'metal', 4);
          const w = viewParcel(defaultContent, q);
          if (w.kind !== 'metal') throw new Error('expected a metal check');
          expect(w.gauges).toContain(q.piece.gauge);
          expect(new Set(w.gauges).size).toBe(w.gauges.length);
        }
      }
    }
  });

  it('any check shows a gem for what it is', () => {
    const p: Parcel = { piece: { kind: 'special', specialId: 'ruby_bearing' }, altMetals: [], altGauges: [], metalOptions: 0, gaugeOptions: 0 };
    checkParcel(p, 'gauge', 4);
    expect(viewParcel(defaultContent, p).kind).toBe('known');
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

describe('winning a lot', () => {
  function wonLot(seed = 'win'): GameState {
    let s = structuredClone(enterDuel('battle', seed));
    s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
    s = structuredClone(s);
    s.duel!.requirements = [{ type: 'set', size: 3 }, { type: 'run', size: 3 }];
    const ids: CardId[] = ['iron:5', 'wood:5', 'tin:5', 'copper:1', 'copper:2', 'copper:3', 'iron:9'].map(
      (spec) => createPart(s, defaultContent, P, spec.split(':')[0], Number(spec.split(':')[1]), true).id,
    );
    s.duel!.hand = ids;
    s = engine.reduce(s, { type: 'DUEL_GO_OUT', playerId: P, groups: [ids.slice(0, 3), ids.slice(3, 6)] });
    return s;
  }

  it('the winner picks the advertised number of parcels, then sorts what was inside', () => {
    let s = wonLot();
    const lot = s.duel!.lot!;
    expect(s.duel!.result!.lotWon).toEqual({ name: lot.name, picks: lot.picks, parcels: lot.parcels.length });
    s = engine.reduce(s, { type: 'CONTINUE', playerId: P });
    expect(s.phase).toBe('rummage');
    expect(s.rummage!.stage).toBe('pick');
    const too = Array.from({ length: lot.picks + 1 }, (_, i) => i).filter((i) => i < lot.parcels.length);
    if (too.length > lot.picks) expect(engine.applyAction(s, { type: 'PICK_PARCELS', playerId: P, parcels: too }).ok).toBe(false);
    expect(engine.applyAction(s, { type: 'RUMMAGE_DONE', playerId: P, destinations: [] }).ok).toBe(false);
    const chosen = Array.from({ length: lot.picks }, (_, i) => lot.parcels.length - 1 - i);
    s = engine.reduce(s, { type: 'PICK_PARCELS', playerId: P, parcels: chosen });
    expect(s.rummage!.stage).toBe('sort');
    expect(s.rummage!.pieces).toEqual(chosen.map((i) => lot.parcels[i].piece));
    expect(s.rummage!.missed).toHaveLength(lot.parcels.length - lot.picks);
    expect(sortLot(s).phase).toBe('map');
  });

  it('tools you hold can check parcels before you pick, and are used up', () => {
    let s = engine.reduce(wonLot('tools'), { type: 'CONTINUE', playerId: P });
    const held = me(s).tools.calipers;
    expect(held).toBe(defaultConfig.scrapbook.startingTools.calipers);
    s = engine.reduce(s, { type: 'USE_TOOL', playerId: P, toolId: 'calipers', parcel: 0 });
    expect(me(s).tools.calipers).toBe(held - 1);
    expect(viewParcel(defaultContent, s.rummage!.lot.parcels[0]).kind).not.toBe('wrapped');
    s = structuredClone(s);
    me(s).tools.calipers = 0;
    expect(engine.applyAction(s, { type: 'USE_TOOL', playerId: P, toolId: 'calipers', parcel: 1 }).ok).toBe(false);
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
    s.rummage = { ...s.rummage!, stage: 'sort', pieces: [part('iron:4')], missed: [] };
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
  it('the Magnifier sharpens your checks by one (never below 2)', () => {
    const s = structuredClone(engine.newGame({ seed: 'mag' }));
    expect(sharpened(defaultContent, s.config, me(s), 4)).toBe(4);
    me(s).items.push({ uid: 'm', itemId: 'magnifier', fromBlueprint: 'x', builtFrom: 1, level: 1, usesLeft: null, charges: 1, grade: 1, material: 'Tin' });
    expect(sharpened(defaultContent, s.config, me(s), 4)).toBe(3);
    expect(sharpened(defaultContent, s.config, me(s), 2)).toBe(2);
    expect(sharpened(defaultContent, s.config, me(s), 1)).toBe(1);
    // A Masterwork Magnifier goes down to exact.
    me(s).items[0].grade = 7;
    expect(sharpened(defaultContent, s.config, me(s), 2)).toBe(1);
  });

  it('Glue Pot gives a Duct Tape in duels; Coin Press pays after a duel', () => {
    let s = structuredClone(enterDuel('battle', 'glue'));
    for (const itemId of ['glue_pot', 'coin_press']) {
      me(s).items.push({ uid: itemId, itemId, fromBlueprint: 'x', builtFrom: 1, level: 1, usesLeft: null, charges: 1, grade: 1, material: 'Tin' });
    }
    s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
    const tape = s.duel!.hand.filter((id) => s.cards[id].kind === 'special' && (s.cards[id] as { specialId: string }).specialId === 'duct_tape' && s.cards[id].temporary);
    expect(tape.length).toBe(1);
    s = structuredClone(s);
    s.duel!.rules.drawLimit = 1;
    const before = me(s).currency;
    s = engine.reduce(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    s = engine.reduce(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand.at(-1)! });
    expect(s.phase).toBe('duelResult');
    expect(me(s).currency - before - (s.duel!.result!.currency ?? 0)).toBe(2);
  });
});

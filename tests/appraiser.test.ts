import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { lotsAhead } from '../src/engine/scrapbook';
import type { GameState, ItemInstance } from '../src/engine/types';
import { mapEngine as engine } from './helpers';

const P = 'p1';
const me = (s: GameState) => s.players[0];

/** A fresh run, standing on an appraiser in row 1, with every lot ahead sealed. */
function atAppraiser(seed = 'appr', credits = 20): GameState {
  let s = structuredClone(engine.newGame({ seed }));
  const node = s.map!.rows[0][0];
  node.type = 'appraiser';
  delete node.encounter;
  for (const n of s.map!.rows.flat()) if (n.encounter?.lot) n.encounter.lot.catalogue = 4;
  me(s).currency = credits;
  s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: node.id });
  return s;
}

function withMagnifier(s: GameState, grade: number, charges = 3): GameState {
  const out = structuredClone(s);
  const item: ItemInstance = { uid: 'mag', itemId: 'magnifier', fromBlueprint: 'scrapbook', builtFrom: 4, level: 1, usesLeft: null, charges, grade, material: 'x' };
  me(out).items.push(item);
  return out;
}

describe('appraiser stops', () => {
  it('appear on scrapbook maps, never on workshop maps', () => {
    const count = (itemSource: 'scrapbook' | 'workshop') =>
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].reduce(
        (n, seed) => n + engine.newGame({ seed, config: { itemSource } }).map!.rows.flat().filter((x) => x.type === 'appraiser').length,
        0,
      );
    expect(count('scrapbook')).toBeGreaterThan(0);
    expect(count('workshop')).toBe(0);
  });

  it('itemises a lot ahead for credits per hidden level', () => {
    let s = atAppraiser();
    expect(s.phase).toBe('appraiser');
    const target = lotsAhead(s)[0];
    s = engine.reduce(s, { type: 'APPRAISE', playerId: P, nodeId: target.id });
    const lot = s.map!.rows.flat().find((n) => n.id === target.id)!.encounter!.lot!;
    expect(lot.catalogue).toBe(1);
    expect(me(s).currency).toBe(20 - 3 * defaultConfig.scrapbook.appraisePerLevel);
    // Already itemised: nothing more to pay for.
    expect(engine.applyAction(s, { type: 'APPRAISE', playerId: P, nodeId: target.id }).ok).toBe(false);
    s = engine.reduce(s, { type: 'LEAVE_APPRAISER', playerId: P });
    expect(s.phase).toBe('map');
  });

  it('needs enough credits, and only values lots still ahead', () => {
    const poor = atAppraiser('poor', 1);
    expect(engine.applyAction(poor, { type: 'APPRAISE', playerId: P, nodeId: lotsAhead(poor)[0].id }).ok).toBe(false);
    const s = atAppraiser('behind');
    const behind = s.map!.rows[0][1];
    expect(engine.applyAction(s, { type: 'APPRAISE', playerId: P, nodeId: behind.id }).ok).toBe(false);
  });
});

describe('the Magnifier on lots', () => {
  function onMap(grade: number, charges = 3) {
    let s = atAppraiser('mag');
    s = engine.reduce(s, { type: 'LEAVE_APPRAISER', playerId: P });
    s = withMagnifier(s, grade, charges);
    // The passive already shows one level more; examining improves the lot itself.
    return s;
  }
  const lotOf = (s: GameState, id: string) => s.map!.rows.flat().find((n) => n.id === id)!.encounter!.lot!;

  it('spends a charge to see one level more of a lot ahead', () => {
    let s = onMap(1);
    const target = lotsAhead(s)[0];
    s = engine.reduce(s, { type: 'EXAMINE_LOT', playerId: P, itemUid: 'mag', nodeId: target.id });
    expect(lotOf(s, target.id).catalogue).toBe(3);
    expect(me(s).items[0].charges).toBe(2);
  });

  it('sees two levels more at Copper grade or better', () => {
    let s = onMap(4);
    const target = lotsAhead(s)[0];
    s = engine.reduce(s, { type: 'EXAMINE_LOT', playerId: P, itemUid: 'mag', nodeId: target.id });
    expect(lotOf(s, target.id).catalogue).toBe(2);
  });

  it('needs a charge, a gadget that works on lots, and something left to see', () => {
    const empty = onMap(1, 0);
    const id = lotsAhead(empty)[0].id;
    expect(engine.applyAction(empty, { type: 'EXAMINE_LOT', playerId: P, itemUid: 'mag', nodeId: id }).ok).toBe(false);

    const watch = structuredClone(onMap(1));
    me(watch).items.push({ uid: 'w', itemId: 'pocket_watch', fromBlueprint: 'x', builtFrom: 4, level: 1, usesLeft: null, charges: 2, grade: 1, material: 'Tin' });
    expect(engine.applyAction(watch, { type: 'EXAMINE_LOT', playerId: P, itemUid: 'w', nodeId: id }).ok).toBe(false);

    const seen = structuredClone(onMap(1));
    lotOf(seen, id).catalogue = 2; // the Magnifier's passive shows the rest
    expect(engine.applyAction(seen, { type: 'EXAMINE_LOT', playerId: P, itemUid: 'mag', nodeId: id }).ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { lotsAhead, viewParcel } from '../src/engine/scrapbook';
import type { GameState, ItemInstance } from '../src/engine/types';
import { mapEngine as engine } from './helpers';

const P = 'p1';
const me = (s: GameState) => s.players[0];

/** A fresh run, standing on an appraiser in row 1. */
function atAppraiser(seed = 'appr', credits = 20): GameState {
  let s = structuredClone(engine.newGame({ seed }));
  const node = s.map!.rows[0][0];
  node.type = 'appraiser';
  delete node.encounter;
  me(s).currency = credits;
  s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: node.id });
  return s;
}

const lotOf = (s: GameState, id: string) => s.map!.rows.flat().find((n) => n.id === id)!.encounter!.lot!;

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

  it('unwraps one parcel of a lot ahead for credits', () => {
    let s = atAppraiser();
    expect(s.phase).toBe('appraiser');
    const target = lotsAhead(s)[0];
    s = engine.reduce(s, { type: 'APPRAISE', playerId: P, nodeId: target.id, parcel: 0 });
    expect(viewParcel(defaultContent, lotOf(s, target.id).parcels[0]).kind).toBe('known');
    expect(me(s).currency).toBe(20 - defaultConfig.scrapbook.appraiseCost);
    expect(engine.applyAction(s, { type: 'APPRAISE', playerId: P, nodeId: target.id, parcel: 0 }).ok).toBe(false);
    s = engine.reduce(s, { type: 'LEAVE_APPRAISER', playerId: P });
    expect(s.phase).toBe('map');
  });

  it('needs enough credits, and only looks at lots still ahead', () => {
    const poor = atAppraiser('poor', 1);
    expect(engine.applyAction(poor, { type: 'APPRAISE', playerId: P, nodeId: lotsAhead(poor)[0].id, parcel: 0 }).ok).toBe(false);
    const s = atAppraiser('behind');
    expect(engine.applyAction(s, { type: 'APPRAISE', playerId: P, nodeId: s.map!.rows[0][1].id, parcel: 0 }).ok).toBe(false);
  });
});

describe('the Magnifier on parcels', () => {
  function onMap(grade: number, charges = 3): GameState {
    let s = atAppraiser('mag');
    s = structuredClone(engine.reduce(s, { type: 'LEAVE_APPRAISER', playerId: P }));
    const item: ItemInstance = { uid: 'mag', itemId: 'magnifier', fromBlueprint: 'scrapbook', builtFrom: 4, level: 1, usesLeft: null, charges, grade, material: 'x' };
    me(s).items.push(item);
    return s;
  }
  /** Numbers left after a Magnifier check at this grade. */
  function optionsAt(grade: number): number {
    let s = onMap(grade);
    const id = lotsAhead(s)[0].id;
    const i = lotOf(s, id).parcels.findIndex((p) => p.piece.kind === 'part');
    s = engine.reduce(s, { type: 'EXAMINE_LOT', playerId: P, itemUid: 'mag', nodeId: id, parcel: i });
    expect(me(s).items[0].charges).toBe(2);
    const v = viewParcel(defaultContent, lotOf(s, id).parcels[i]);
    return v.kind === 'known' ? 1 : v.kind === 'metal' ? v.gauges.length : -1;
  }

  it('checks the metal for a charge, sharper as the Magnifier is upgraded', () => {
    // Its own passive sharpens it by one too (never below 2).
    expect(optionsAt(1)).toBe(3);
    expect(optionsAt(3)).toBe(2);
    expect(optionsAt(5)).toBe(2);
    expect(optionsAt(7)).toBe(1);
  });

  it('needs a charge and a gadget that works on parcels', () => {
    const empty = onMap(1, 0);
    const id = lotsAhead(empty)[0].id;
    expect(engine.applyAction(empty, { type: 'EXAMINE_LOT', playerId: P, itemUid: 'mag', nodeId: id, parcel: 0 }).ok).toBe(false);
    const watch = structuredClone(onMap(1));
    me(watch).items.push({ uid: 'w', itemId: 'pocket_watch', fromBlueprint: 'x', builtFrom: 4, level: 1, usesLeft: null, charges: 2, grade: 1, material: 'Tin' });
    expect(engine.applyAction(watch, { type: 'EXAMINE_LOT', playerId: P, itemUid: 'w', nodeId: id, parcel: 0 }).ok).toBe(false);
  });

  it('tools work on lots ahead from the map too', () => {
    let s = onMap(1);
    const id = lotsAhead(s)[0].id;
    s = engine.reduce(s, { type: 'USE_TOOL', playerId: P, toolId: 'unwrap', nodeId: id, parcel: 0 });
    expect(viewParcel(defaultContent, lotOf(s, id).parcels[0]).kind).toBe('known');
    expect(me(s).tools.unwrap).toBe(defaultConfig.scrapbook.startingTools.unwrap - 1);
  });
});

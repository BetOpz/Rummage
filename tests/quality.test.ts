import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { gadgetCharges, gradeOf, materialName } from '../src/engine/quality';
import type { GameState } from '../src/engine/types';
import { createPart, createSpecial } from '../src/engine/zones';
import { mapEngine as engine } from './helpers';

const P = 'p1';
const me = (s: GameState) => s.players[0];
const watch = defaultContent.items.find((i) => i.id === 'pocket_watch')!.gadget!;

function cards(s: GameState, specs: string[]) {
  return specs.map((spec) =>
    spec.includes(':') ? createPart(s, defaultContent, P, spec.split(':')[0], Number(spec.split(':')[1])).id : createSpecial(s, P, spec).id,
  );
}

describe('materials and grades', () => {
  it('an item is graded by the average material of its parts', () => {
    const s = structuredClone(engine.newGame({ seed: 'q' }));
    const grade = (specs: string[]) => gradeOf(s, defaultContent, cards(s, specs), defaultConfig);
    expect(grade(['tin:1', 'tin:2', 'tin:3'])).toBe(1);
    expect(grade(['wood:1', 'wood:2', 'wood:3'])).toBe(2);
    expect(grade(['gold:1', 'gold:2', 'gold:3'])).toBe(7);
    expect(grade(['brass:1', 'brass:2', 'iron:3', 'iron:4'])).toBe(4);
  });

  it('gems add grades', () => {
    const s = structuredClone(engine.newGame({ seed: 'gems' }));
    const grade = (specs: string[]) => gradeOf(s, defaultContent, cards(s, specs), defaultConfig);
    expect(grade(['brass:1', 'brass:2', 'diamond_movement'])).toBe(7);
    // Platinum is the top grade: gems can't push past it.
    expect(grade(['gold:1', 'gold:2', 'diamond_movement'])).toBe(8);
    expect(grade(['platinum:1', 'platinum:2', 'diamond_movement'])).toBe(8);
  });

  it('one material per grade, Tin to Platinum', () => {
    const names = [1, 2, 3, 4, 5, 6, 7, 8].map((g) => materialName(defaultContent, defaultConfig, g));
    expect(names).toEqual(['Tin', 'Wood', 'Iron', 'Copper', 'Brass', 'Silver', 'Gold', 'Platinum']);
  });

  it('higher grades mean more gadget charges', () => {
    expect(gadgetCharges(watch, 1, defaultConfig)).toBe(watch.charges);
    expect(gadgetCharges(watch, 6, defaultConfig)).toBeGreaterThan(watch.charges);
  });

  it('rare materials stay out of starting decks', () => {
    const s = engine.newGame({ seed: 'rare' });
    const rare = new Set(defaultContent.categories.filter((c) => c.rare).map((c) => c.id));
    for (const id of me(s).deck) {
      const c = s.cards[id];
      if (c.kind === 'part') expect(rare.has(c.category)).toBe(false);
    }
  });
});

describe('graded items in play', () => {
  function duelWithWatch(grade: number): GameState {
    let s = structuredClone(engine.newGame({ seed: 'gw' }));
    me(s).items.push({
      uid: 'w', itemId: 'pocket_watch', fromBlueprint: 'x', builtFrom: 7, level: 1, usesLeft: null,
      charges: gadgetCharges(watch, grade, defaultConfig), grade, material: materialName(defaultContent, defaultConfig, grade),
    });
    s.map!.rows[0][0].type = 'battle';
    s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    return engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardId: me(s).deck[0] });
  }

  it('a gold pocket watch makes the opponent miss 2 turns; a wooden one, 1', () => {
    const gold = engine.reduce(duelWithWatch(7), { type: 'USE_GADGET', playerId: P, itemUid: 'w', target: 0 });
    expect(gold.duel!.opponents[0].skip).toBe(2);
    const wood = engine.reduce(duelWithWatch(2), { type: 'USE_GADGET', playerId: P, itemUid: 'w', target: 0 });
    expect(wood.duel!.opponents[0].skip).toBe(1);
  });

  it('recharging fills to the graded maximum', () => {
    let s = duelWithWatch(6);
    s = structuredClone(s);
    s.phase = 'map';
    s.duel = null;
    me(s).items[0].charges = 0;
    me(s).currency = 50;
    s = engine.reduce(s, { type: 'RECHARGE', playerId: P, itemUid: 'w' });
    expect(me(s).items[0].charges).toBe(gadgetCharges(watch, 6, defaultConfig));
  });

  it('building records the grade and material', () => {
    let s = structuredClone(engine.newGame({ seed: 'gb' }));
    s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: P, blueprintId: s.roundState!.offers[0] });
    s = structuredClone(s);
    me(s).target = 'clockwork_toy';
    const ids = cards(s, ['gold:3', 'gold:4', 'gold:5', 'gold:6', 'silver:7', 'gold:7', 'gold:7']);
    me(s).deck.push(...ids);
    me(s).hand.push(...ids);
    s = engine.reduce(s, { type: 'BUILD', playerId: P, groups: [ids.slice(0, 4), ids.slice(4)] });
    expect(me(s).items.at(-1)).toMatchObject({ itemId: 'pocket_watch', grade: 7, material: 'Gold' });
    expect(me(s).items.at(-1)!.charges).toBe(gadgetCharges(watch, 7, defaultConfig));
  });
});

describe('upgrading items', () => {
  function inShopWith(grade: number): GameState {
    const s = structuredClone(engine.newGame({ seed: 'up' }));
    me(s).items.push({
      uid: 'w', itemId: 'pocket_watch', fromBlueprint: 'x', builtFrom: 7, level: 1, usesLeft: null,
      charges: gadgetCharges(watch, grade, defaultConfig), grade, material: materialName(defaultContent, defaultConfig, grade),
    });
    me(s).currency = 50;
    s.phase = 'shop';
    s.shop = { slots: [], rerolls: 0 };
    return s;
  }

  it('three parts of the next material raise the grade', () => {
    const s = inShopWith(2);
    const ids = cards(s, ['copper:1', 'brass:2', 'gold:9']);
    me(s).deck.push(...ids);
    const out = engine.reduce(s, { type: 'UPGRADE_ITEM', playerId: P, itemUid: 'w', cardIds: ids });
    expect(me(out).items[0]).toMatchObject({ grade: 3, material: 'Iron' });
    expect(me(out).currency).toBe(50 - 3 * defaultConfig.quality.upgradeCreditsPerGrade);
    for (const id of ids) expect(me(out).deck).not.toContain(id);
  });

  it('rejects parts that are not good enough', () => {
    const s = inShopWith(3);
    const ids = cards(s, ['wood:1', 'brass:2', 'brass:3']);
    me(s).deck.push(...ids);
    const r = engine.applyAction(s, { type: 'UPGRADE_ITEM', playerId: P, itemUid: 'w', cardIds: ids });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Copper parts or better/);
  });

  it('a single gem upgrades by its bonus', () => {
    const s = inShopWith(4);
    const ids = cards(s, ['diamond_movement']);
    me(s).deck.push(...ids);
    const out = engine.reduce(s, { type: 'UPGRADE_ITEM', playerId: P, itemUid: 'w', cardIds: ids });
    expect(me(out).items[0]).toMatchObject({ grade: 6, material: 'Silver' });
    expect(me(out).items[0].charges).toBe(gadgetCharges(watch, 6, defaultConfig));
  });

  it('gems stop at Platinum, and Platinum items cannot be upgraded', () => {
    const s = inShopWith(7);
    const gem = cards(s, ['diamond_movement']);
    me(s).deck.push(...gem);
    const out = engine.reduce(s, { type: 'UPGRADE_ITEM', playerId: P, itemUid: 'w', cardIds: gem });
    expect(me(out).items[0]).toMatchObject({ grade: 8, material: 'Platinum' });

    const top = inShopWith(8);
    const ids = cards(top, ['platinum:1', 'platinum:2', 'platinum:3']);
    me(top).deck.push(...ids);
    const r = engine.applyAction(top, { type: 'UPGRADE_ITEM', playerId: P, itemUid: 'w', cardIds: ids });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/top grade/);
  });

  it('only at shops and rest stops', () => {
    const s = inShopWith(1);
    s.phase = 'map';
    const ids = cards(s, ['iron:1', 'iron:2', 'iron:3']);
    me(s).deck.push(...ids);
    expect(engine.applyAction(s, { type: 'UPGRADE_ITEM', playerId: P, itemUid: 'w', cardIds: ids }).ok).toBe(false);
  });
});

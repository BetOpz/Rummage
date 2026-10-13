import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { incomingDamage } from '../src/engine/battle';
import { autoplay } from '../src/engine/bot';
import { generateMap, reachableNodes } from '../src/engine/map';
import { Rng } from '../src/engine/rng';
import type { GameState, NodeType } from '../src/engine/types';
import { mapEngine as engine, withHand } from './helpers';

const P = 'p1';
const me = (s: GameState) => s.players[0];

/** New map run with the first row's node of a given type forced, then entered. */
function enterNode(type: NodeType, seed = 'map', config = {}): GameState {
  const s = structuredClone(engine.newGame({ seed, config }));
  s.map!.rows[0][0].type = type;
  return engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
}

function withItem(s: GameState, itemId: string, level = 1): GameState {
  const out = structuredClone(s);
  const def = defaultContent.items.find((i) => i.id === itemId)!;
  me(out).items.push({ uid: `test-${itemId}`, itemId, fromBlueprint: 'go_kart', builtFrom: 7, level, usesLeft: def.battle?.uses ?? null });
  return out;
}

describe('map generation', () => {
  it('builds rows with a single boss at the end and links every row', () => {
    const map = generateMap(0, defaultConfig.map, new Rng({ rng: 42 }));
    expect(map.rows).toHaveLength(defaultConfig.map.rows);
    expect(map.rows.at(-1)!.map((n) => n.type)).toEqual(['boss']);
    expect(map.rows[0].every((n) => n.type === 'workshop')).toBe(true);
    for (let r = 0; r < map.rows.length - 1; r++) {
      const nextIds = new Set(map.rows[r + 1].map((n) => n.id));
      for (const node of map.rows[r]) {
        expect(node.next.length).toBeGreaterThan(0);
        expect(node.next.every((id) => nextIds.has(id))).toBe(true);
      }
      // Every node in the next row has a way in.
      const incoming = new Set(map.rows[r].flatMap((n) => n.next));
      expect([...nextIds].every((id) => incoming.has(id))).toBe(true);
    }
  });

  it('is deterministic for a seed', () => {
    expect(generateMap(1, defaultConfig.map, new Rng({ rng: 7 }))).toEqual(generateMap(1, defaultConfig.map, new Rng({ rng: 7 })));
  });
});

describe('map movement', () => {
  it('starts on the map and only allows reachable stops', () => {
    const s = engine.newGame({ seed: 'move' });
    expect(s.phase).toBe('map');
    expect(reachableNodes(s.map!)).toEqual(s.map!.rows[0]);
    const far = s.map!.rows[3][0].id;
    expect(engine.applyAction(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: far }).ok).toBe(false);
  });

  it('a workshop runs a rummy round and returns to the map', () => {
    let s = enterNode('workshop');
    expect(s.phase).toBe('blueprintSelect');
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: P, blueprintId: 'go_kart' === s.roundState!.offers[0] ? 'go_kart' : s.roundState!.offers[0] });
    s = structuredClone(s);
    me(s).target = 'go_kart';
    const { state, ids } = withHand(s, ['iron:5', 'wood:5', 'brass:5', 'copper:5', 'copper:1', 'copper:2', 'copper:3']);
    s = engine.reduce(state, { type: 'BUILD', playerId: P, groups: [ids.slice(0, 4), ids.slice(4, 7)] });
    const item = me(s).items[0];
    expect(item).toMatchObject({ itemId: 'workbench', level: 1, usesLeft: null });
    s = engine.reduce(s, { type: 'CONTINUE', playerId: P });
    expect(s.phase).toBe('map');
  });

  it('a failed workshop costs HP instead of a life', () => {
    let s = enterNode('workshop', 'fail', { drawLimitByTier: [1] });
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: P, blueprintId: s.roundState!.offers[0] });
    s = engine.reduce(s, { type: 'DRAW', playerId: P, source: 'deck' });
    s = engine.reduce(s, { type: 'DISCARD', playerId: P, cardId: me(s).hand[0] });
    expect(me(s).hp).toBe(defaultConfig.battle.startingHp - defaultConfig.battle.workshopFailDamage);
    expect(s.lastResult!.perPlayer.p1).toMatchObject({ lifeLost: false, hpLost: defaultConfig.battle.workshopFailDamage });
  });

  it('rest heals or repairs', () => {
    let s = enterNode('rest');
    s = structuredClone(s);
    me(s).hp = 10;
    const healed = engine.reduce(s, { type: 'REST', playerId: P, choice: 'heal' });
    expect(me(healed).hp).toBe(10 + Math.round(defaultConfig.battle.startingHp * defaultConfig.battle.restHealFraction));
    expect(healed.phase).toBe('map');

    s = withItem(s, 'coin_press');
    me(s).items[0].usesLeft = 1;
    const repaired = engine.reduce(s, { type: 'REST', playerId: P, choice: 'repair', itemUid: me(s).items[0].uid });
    expect(me(repaired).items[0].usesLeft).toBe(3);
  });

  it('a shop returns to the map', () => {
    let s = enterNode('shop');
    expect(s.phase).toBe('shop');
    s = engine.reduce(s, { type: 'LEAVE_SHOP', playerId: P });
    expect(s.phase).toBe('map');
  });
});

describe('battles', () => {
  it('builds a battle deck from starter cards plus items with battle cards', () => {
    const base = withItem(engine.newGame({ seed: 'deck' }), 'workbench');
    base.map!.rows[0][0].type = 'battle';
    const s = engine.reduce(base, { type: 'CHOOSE_NODE', playerId: P, nodeId: base.map!.rows[0][0].id });
    const b = s.battle!;
    const all = [...b.hand, ...b.drawPile];
    expect(all).toHaveLength(defaultConfig.battle.starterDeck.length + 1);
    expect(all.filter((c) => c.source === 'item')).toHaveLength(1);
    expect(b.hand).toHaveLength(defaultConfig.battle.handSize);
    expect(b.energy).toBe(defaultConfig.battle.energy);
  });

  it('cards cost energy and deal damage through block', () => {
    let s = enterNode('battle', 'dmg');
    const hammer = s.battle!.hand.find((c) => c.ref === 'hammer')!;
    s = structuredClone(s);
    s.battle!.enemies[0].block = 2;
    const hp = s.battle!.enemies[0].hp;
    s = engine.reduce(s, { type: 'PLAY_CARD', playerId: P, cardUid: hammer.uid, target: 0 });
    expect(s.battle!.enemies[0].hp).toBe(hp - 3);
    expect(s.battle!.enemies[0].block).toBe(0);
    expect(s.battle!.energy).toBe(defaultConfig.battle.energy - 1);
  });

  it('cannot play without enough energy', () => {
    let s = enterNode('battle', 'energy');
    s = structuredClone(s);
    s.battle!.energy = 0;
    expect(engine.applyAction(s, { type: 'PLAY_CARD', playerId: P, cardUid: s.battle!.hand[0].uid }).ok).toBe(false);
  });

  it('ending the turn lets enemies act, then draws a new hand', () => {
    let s = enterNode('battle', 'turn');
    const incoming = incomingDamage(defaultContent, s.battle!);
    const hp = me(s).hp;
    s = engine.reduce(s, { type: 'END_TURN', playerId: P });
    expect(me(s).hp).toBe(hp - incoming);
    expect(s.battle!.turn).toBe(2);
    expect(s.battle!.hand).toHaveLength(defaultConfig.battle.handSize);
    expect(s.battle!.enemies.every((e) => e.intentIndex === 1)).toBe(true);
  });

  it('item cards scale with level and wear out', () => {
    let s = withItem(enterNode('battle', 'wear'), 'coin_press', 2);
    // Put the item's card straight into hand.
    s.battle!.hand.push({ uid: 'x1', source: 'item', ref: me(s).items[0].uid });
    me(s).items[0].usesLeft = 1;
    s.battle!.enemies[0].hp = 100;
    s.battle!.enemies[0].block = 0;
    const currency = me(s).currency;
    s = engine.reduce(s, { type: 'PLAY_CARD', playerId: P, cardUid: 'x1', target: 0 });
    expect(s.battle!.enemies[0].hp).toBe(100 - (7 + 3)); // level 2 = +3
    expect(me(s).currency).toBe(currency + 2);
    expect(me(s).items).toHaveLength(0); // broke
    expect(s.battle!.exhausted.map((c) => c.uid)).toContain('x1');
  });

  it('winning offers rewards; taking one adds it to the parts deck', () => {
    let s = structuredClone(enterNode('battle', 'win'));
    for (const e of s.battle!.enemies) e.hp = 1;
    const deck = me(s).deck.length;
    while (s.phase === 'battle') {
      const card = s.battle!.hand.find((c) => c.ref === 'hammer');
      if (!card) {
        s = engine.reduce(s, { type: 'END_TURN', playerId: P });
        continue;
      }
      const target = s.battle!.enemies.findIndex((e) => e.hp > 0);
      s = engine.reduce(s, { type: 'PLAY_CARD', playerId: P, cardUid: card.uid, target });
    }
    expect(s.phase).toBe('battleReward');
    expect(s.reward!.options).toHaveLength(defaultConfig.battle.rewardOptions);
    s = engine.reduce(s, { type: 'TAKE_REWARD', playerId: P, index: 0 });
    expect(me(s).deck).toHaveLength(deck + 1);
    expect(s.phase).toBe('map');
  });

  it('dying ends the run', () => {
    let s = structuredClone(enterNode('battle', 'die'));
    me(s).hp = 1;
    // End turns until an enemy attacks.
    while (s.phase === 'battle') s = engine.reduce(s, { type: 'END_TURN', playerId: P });
    expect(s.phase).toBe('runLost');
  });

  it('beating the act boss moves to the next act', () => {
    let s = structuredClone(enterNode('boss', 'boss'));
    s.battle!.enemies[0].hp = 1;
    s.battle!.enemies[0].block = 0;
    const hammer = s.battle!.hand.find((c) => c.ref === 'hammer') ?? s.battle!.hand[0];
    s.battle!.hand = [{ ...hammer, ref: 'hammer', source: 'starter' }];
    s = engine.reduce(s, { type: 'PLAY_CARD', playerId: P, cardUid: hammer.uid, target: 0 });
    s = engine.reduce(s, { type: 'TAKE_REWARD', playerId: P, index: null });
    expect(s.tier).toBe(1);
    expect(s.phase).toBe('map');
    expect(s.map!.act).toBe(1);
  });
});

describe('map runs end to end', () => {
  it('the bot plays whole runs deterministically', () => {
    for (const seed of ['m1', 'm2']) {
      const a = autoplay(engine, engine.newGame({ seed }));
      const b = autoplay(engine, engine.newGame({ seed }));
      expect(['runWon', 'runLost']).toContain(a.state.phase);
      expect(a.state).toEqual(b.state);
    }
  });

  it('rejects multiple players on a map run', () => {
    expect(() => engine.newGame({ seed: 'x', players: [{ name: 'A' }, { name: 'B' }] })).toThrow(/single-player/);
  });
});

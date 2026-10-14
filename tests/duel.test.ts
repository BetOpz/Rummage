import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { autoplay } from '../src/engine/bot';
import type { CardId, GameState, NodeType } from '../src/engine/types';
import { createPart } from '../src/engine/zones';
import { mapEngine as engine, sortLot, stakeFor } from './helpers';

const P = 'p1';
const me = (s: GameState) => s.players[0];
const SIMPLE = [
  { type: 'set' as const, size: 3 },
  { type: 'run' as const, size: 3 },
];

/** Enter a duel stop of the given kind from a fresh map run. */
function enterDuel(kind: NodeType = 'battle', seed = 'duel'): GameState {
  const s = structuredClone(engine.newGame({ seed }));
  const node = s.map!.rows[0][0];
  node.type = kind;
  delete node.encounter;
  return engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: node.id });
}

/** Stake the first deck card and start playing, with a fixed simple target. */
function playing(kind: NodeType = 'battle', seed = 'duel'): GameState {
  let s = enterDuel(kind, seed);
  s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
  s = structuredClone(s);
  s.duel!.requirements = SIMPLE;
  return s;
}

/** Replace a hand (player's or an opponent's) with specific temporary cards. */
function setHand(s: GameState, specs: string[], who: 'player' | number = 'player'): CardId[] {
  const ids = specs.map((spec) => {
    const [cat, g] = spec.split(':');
    return createPart(s, defaultContent, P, cat, Number(g), true).id;
  });
  if (who === 'player') s.duel!.hand = ids;
  else s.duel!.opponents[who].hand = ids;
  return ids;
}

function withGadget(s: GameState, itemId: string): GameState {
  const out = structuredClone(s);
  const def = defaultContent.items.find((i) => i.id === itemId)!;
  me(out).items.push({ uid: `g-${itemId}`, itemId, fromBlueprint: 'x', builtFrom: 7, level: 1, usesLeft: null, charges: def.gadget!.charges, grade: 1, material: 'Wood' });
  return out;
}

describe('encounters on the map', () => {
  it('battle, elite and boss stops show who you face and what they stake', () => {
    const s = engine.newGame({ seed: 'enc' });
    const fights = s.map!.rows.flat().filter((n) => ['battle', 'elite', 'boss'].includes(n.type));
    expect(fights.length).toBeGreaterThan(0);
    for (const n of fights) {
      expect(n.encounter!.minions.length).toBeGreaterThan(0);
      expect(n.encounter!.stakes.length).toBeGreaterThan(0);
    }
    const boss = s.map!.rows.at(-1)![0];
    expect(boss.encounter!.lot!.lotId).toBe('estate_sale');
  });
});

describe('duel setup', () => {
  it('starts with the ante, then deals hands once you stake', () => {
    let s = enterDuel();
    expect(s.phase).toBe('duelAnte');
    const potBefore = s.duel!.pot.length;
    expect(potBefore).toBeGreaterThan(0);
    expect(engine.applyAction(s, { type: 'DUEL_STAKE', playerId: P, cardIds: ['nope'] }).ok).toBe(false);
    const stake = stakeFor(s);
    s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stake });
    const d = s.duel!;
    expect(s.phase).toBe('duel');
    expect(d.pot).toHaveLength(potBefore + stake.length);
    expect(d.hand).toHaveLength(defaultConfig.duel.handSizeByAct[0]);
    expect(d.opponents.every((o) => o.hand.length === defaultConfig.duel.handSizeByAct[0])).toBe(true);
    expect(d.discard).toHaveLength(1);
    for (const id of stake) expect(d.drawPile).not.toContain(id);
  });

  it('item passives apply to duels (Workbench: +1 hand)', () => {
    let s = structuredClone(engine.newGame({ seed: 'wb' }));
    me(s).items.push({ uid: 'w', itemId: 'workbench', fromBlueprint: 'x', builtFrom: 7, level: 1, usesLeft: null, charges: null, grade: 1, material: 'Wood' });
    s.map!.rows[0][0].type = 'battle';
    s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    s = engine.reduce(s, { type: 'DUEL_STAKE', playerId: P, cardIds: stakeFor(s) });
    expect(s.duel!.hand).toHaveLength(defaultConfig.duel.handSizeByAct[0] + 1);
  });
});

describe('playing a duel', () => {
  it('going out first wins the pot, which joins your parts deck', () => {
    let s = playing();
    const deckBefore = me(s).deck.length;
    const currency = me(s).currency;
    const pot = [...s.duel!.pot];
    const ids = setHand(s, ['iron:5', 'wood:5', 'brass:5', 'copper:1', 'copper:2', 'copper:3', 'iron:9']);
    s = engine.reduce(s, { type: 'DUEL_GO_OUT', playerId: P, groups: [ids.slice(0, 3), ids.slice(3, 6)] });
    expect(s.phase).toBe('duelResult');
    expect(s.duel!.result).toMatchObject({ won: true, lostStake: [] });
    expect(me(s).deck).toHaveLength(deckBefore + pot.length - s.duel!.playerStake.length); // the stake was already yours
    expect(me(s).currency).toBe(currency + defaultConfig.duel.currencyReward.battle);
    s = engine.reduce(s, { type: 'CONTINUE', playerId: P });
    expect(s.phase).toBe('rummage');
    expect(s.duel).toBeNull();
    s = sortLot(s);
    expect(s.phase).toBe('map');
    // Won cards survive the clean-up; temporary duel cards don't.
    for (const id of me(s).deck) expect(s.cards[id]).toBeDefined();
    expect(Object.values(s.cards).some((c) => c.temporary)).toBe(false);
  });

  it('rejects going out with an incomplete hand', () => {
    const s = playing();
    const ids = setHand(s, ['iron:5', 'wood:5', 'brass:6', 'copper:1', 'copper:2', 'copper:3', 'iron:9']);
    expect(engine.applyAction(s, { type: 'DUEL_GO_OUT', playerId: P, groups: [ids.slice(0, 3), ids.slice(3, 6)] }).ok).toBe(false);
  });

  it('opponents take their turns after you discard', () => {
    let s = playing('battle', 'turns');
    s = engine.reduce(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    s = engine.reduce(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand[0] });
    if (s.phase === 'duel') {
      expect(s.duel!.turnPhase).toBe('draw');
      expect(s.duel!.opponents.every((o) => o.lastAction.length > 0)).toBe(true);
    }
  });

  it('if an opponent goes out you lose your stake for good', () => {
    let s = playing('battle', 'lose');
    const stake = s.duel!.playerStake;
    // Opponent 0 is one card from going out; the discard top completes it.
    setHand(s, ['iron:7', 'wood:7', 'brass:1', 'brass:2', 'brass:3', 'iron:1', 'iron:2'], 0);
    s = engine.reduce(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    const gift = createPart(s, defaultContent, P, 'copper', 7, true);
    s.duel!.hand.push(gift.id);
    s = engine.reduce(s, { type: 'DUEL_DISCARD', playerId: P, cardId: gift.id });
    expect(s.phase).toBe('duelResult');
    expect(s.duel!.winner).toBe(0);
    expect(s.duel!.result!.lostStake).toEqual(stake);
    s = engine.reduce(s, { type: 'CONTINUE', playerId: P });
    for (const id of stake) {
      expect(me(s).deck).not.toContain(id);
      expect(s.cards[id]).toBeUndefined();
    }
  });

  it('when your draws run out, the closest hand wins', () => {
    let s = playing('battle', 'showdown');
    s.duel!.rules.drawLimit = 1;
    setHand(s, ['iron:5', 'wood:5', 'brass:5', 'copper:1', 'copper:2', 'iron:9', 'wood:9']);
    for (const o of s.duel!.opponents) o.drawPile = [];
    s.duel!.opponents.forEach((_, i) => setHand(s, ['iron:1', 'wood:3', 'brass:6', 'copper:8', 'iron:10', 'wood:2', 'brass:9'], i));
    s = engine.reduce(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    s = engine.reduce(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand.at(-1)! });
    expect(s.phase).toBe('duelResult');
    expect(s.duel!.result!.won).toBe(true);
    expect(s.duel!.endReason).toMatch(/Out of draws/);
  });
});

describe('gadgets', () => {
  it('Stop Time makes an opponent miss a turn and uses a charge', () => {
    let s = withGadget(playing('battle', 'watch'), 'pocket_watch');
    s = engine.reduce(s, { type: 'USE_GADGET', playerId: P, itemUid: 'g-pocket_watch', target: 0 });
    expect(s.duel!.opponents[0].skip).toBe(1);
    expect(me(s).items[0].charges).toBe(1);
    const handBefore = [...s.duel!.opponents[0].hand];
    s = engine.reduce(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    s = engine.reduce(s, { type: 'DUEL_DISCARD', playerId: P, cardId: s.duel!.hand[0] });
    if (s.phase === 'duel') {
      expect(s.duel!.opponents[0].hand).toEqual(handBefore);
      expect(s.duel!.opponents[0].lastAction).toMatch(/missed a turn/);
    }
  });

  it('needs a target, and stops when out of charges', () => {
    let s = withGadget(playing('battle', 'charges'), 'pocket_watch');
    expect(engine.applyAction(s, { type: 'USE_GADGET', playerId: P, itemUid: 'g-pocket_watch' }).ok).toBe(false);
    me(s).items[0].charges = 0;
    const r = engine.applyAction(s, { type: 'USE_GADGET', playerId: P, itemUid: 'g-pocket_watch', target: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/out of charges/);
  });

  it('charges carry over between fights; recharging costs credits', () => {
    let s = withGadget(playing('battle', 'carry'), 'pocket_watch');
    s = engine.reduce(s, { type: 'USE_GADGET', playerId: P, itemUid: 'g-pocket_watch', target: 0 });
    const ids = setHand(s, ['iron:5', 'wood:5', 'brass:5', 'copper:1', 'copper:2', 'copper:3', 'iron:9']);
    s = engine.reduce(s, { type: 'DUEL_GO_OUT', playerId: P, groups: [ids.slice(0, 3), ids.slice(3, 6)] });
    s = sortLot(engine.reduce(s, { type: 'CONTINUE', playerId: P }));
    expect(me(s).items[0].charges).toBe(1);

    s = structuredClone(s);
    me(s).currency = 4;
    expect(engine.applyAction(s, { type: 'RECHARGE', playerId: P, itemUid: 'g-pocket_watch' }).ok).toBe(false);
    me(s).currency = 10;
    s = engine.reduce(s, { type: 'RECHARGE', playerId: P, itemUid: 'g-pocket_watch' });
    expect(me(s).items[0].charges).toBe(2);
    expect(me(s).currency).toBe(10 - 5);
  });

  it('a rest stop recharges one gadget for free', () => {
    let s = withGadget(structuredClone(engine.newGame({ seed: 'rest' })), 'pocket_watch');
    me(s).items[0].charges = 0;
    s.map!.rows[0][0].type = 'rest';
    s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    const currency = me(s).currency;
    s = engine.reduce(s, { type: 'REST', playerId: P, choice: 'recharge', itemUid: 'g-pocket_watch' });
    expect(me(s).items[0].charges).toBe(2);
    expect(me(s).currency).toBe(currency);
    expect(s.phase).toBe('map');
  });

  it('Spyglass reveals hands and Snatch steals a card', () => {
    let s = withGadget(withGadget(playing('battle', 'spy'), 'magnifier'), 'salvage_rig');
    s = engine.reduce(s, { type: 'USE_GADGET', playerId: P, itemUid: 'g-magnifier' });
    expect(s.duel!.opponents.every((o) => o.revealed)).toBe(true);
    const before = s.duel!.hand.length;
    s = engine.reduce(s, { type: 'USE_GADGET', playerId: P, itemUid: 'g-salvage_rig', target: 0 });
    expect(s.duel!.hand).toHaveLength(before + 1);
  });

  it('built items get their gadget charges', () => {
    let s = structuredClone(engine.newGame({ seed: 'build', config: { itemSource: 'workshop' } }));
    s = engine.reduce(s, { type: 'CHOOSE_NODE', playerId: P, nodeId: s.map!.rows[0][0].id });
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: P, blueprintId: s.roundState!.offers[0] });
    s = structuredClone(s);
    me(s).target = 'clockwork_toy'; // builds the Pocket Watch
    const ids = ['brass:3', 'brass:4', 'brass:5', 'brass:6', 'iron:7', 'wood:7', 'copper:7'].map((spec) => {
      const [c, g] = spec.split(':');
      const card = createPart(s, defaultContent, P, c, Number(g));
      me(s).deck.push(card.id);
      me(s).hand.push(card.id);
      return card.id;
    });
    s = engine.reduce(s, { type: 'BUILD', playerId: P, groups: [ids.slice(0, 4), ids.slice(4)] });
    expect(me(s).items.at(-1)).toMatchObject({ itemId: 'pocket_watch', grade: 4, charges: 3 });
  });
});

describe('boss duels', () => {
  it('a boss has a rule twist; losing costs a life and lets you try again', () => {
    let s = playing('boss', 'bosslose');
    expect(s.duel!.modifiers.length).toBe(defaultConfig.duel.bossTwists);
    const lives = me(s).lives;
    setHand(s, ['iron:7', 'wood:7', 'brass:1', 'brass:2', 'brass:3', 'iron:1', 'iron:2'], 0);
    s.duel!.rules.allowDiscardDraw = true;
    s.duel!.rules.bannedCategories = [];
    s.duel!.rules.disabledMeldRoles = [];
    s = engine.reduce(s, { type: 'DUEL_DRAW', playerId: P, source: 'deck' });
    const gift = createPart(s, defaultContent, P, 'copper', 7, true);
    s.duel!.hand.push(gift.id);
    s = engine.reduce(s, { type: 'DUEL_DISCARD', playerId: P, cardId: gift.id });
    expect(s.duel!.result!.lifeLost).toBe(true);
    s = engine.reduce(s, { type: 'CONTINUE', playerId: P });
    expect(me(s).lives).toBe(lives - 1);
    expect(s.phase).toBe('map');
  });

  it('beating the act boss starts the next act', () => {
    let s = playing('boss', 'bosswin');
    s.duel!.rules.bannedCategories = [];
    s.duel!.rules.disabledMeldRoles = [];
    const ids = setHand(s, ['iron:5', 'wood:5', 'brass:5', 'copper:1', 'copper:2', 'copper:3', 'iron:9']);
    s = engine.reduce(s, { type: 'DUEL_GO_OUT', playerId: P, groups: [ids.slice(0, 3), ids.slice(3, 6)] });
    s = engine.reduce(s, { type: 'CONTINUE', playerId: P });
    expect(s.phase).toBe('rummage');
    s = sortLot(s);
    expect(s.tier).toBe(1);
    expect(s.phase).toBe('map');
  });
});

describe('rummy-duel runs end to end', () => {
  it('the bot plays whole runs deterministically', () => {
    for (const seed of ['r1', 'r2']) {
      const a = autoplay(engine, engine.newGame({ seed }));
      const b = autoplay(engine, engine.newGame({ seed }));
      expect(['runWon', 'runLost']).toContain(a.state.phase);
      expect(a.state).toEqual(b.state);
    }
  });
});

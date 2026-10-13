import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { defaultContent } from '../src/content';
import { autoplay } from '../src/engine/bot';
import { defaultEffects } from '../src/engine/effects';
import { Rng, seedToState } from '../src/engine/rng';
import { validateContent } from '../src/engine/validateContent';
import type { GameState } from '../src/engine/types';
import { engine, p1, setTarget, stackDrawPile, startedGame, withHand } from './helpers';

const GO_KART_HAND = ['iron:5', 'wood:5', 'brass:5', 'copper:5', 'copper:1', 'copper:2', 'copper:3', 'wood:9'];

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = { rng: seedToState('abc') };
    const b = { rng: seedToState('abc') };
    const ra = new Rng(a);
    const rb = new Rng(b);
    const seqA = Array.from({ length: 10 }, () => ra.float());
    const seqB = Array.from({ length: 10 }, () => rb.float());
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBe(10);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('different seeds give different sequences', () => {
    expect(new Rng({ rng: seedToState('a') }).float()).not.toBe(new Rng({ rng: seedToState('b') }).float());
  });

  it('shuffle keeps every element', () => {
    const r = new Rng({ rng: 1 });
    expect(r.shuffle([1, 2, 3, 4, 5, 6]).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('content', () => {
  it('default content pack is valid', () => {
    expect(validateContent(defaultContent, defaultEffects, defaultConfig)).toEqual([]);
  });

  it('reports broken references', () => {
    const broken = {
      ...defaultContent,
      blueprints: [{ id: 'x', name: 'X', tier: 1, itemId: 'nope', requirements: [{ type: 'set' as const, size: 3, category: 'gold' }] }],
    };
    const problems = validateContent(broken, defaultEffects);
    expect(problems.some((p) => p.includes('unknown item'))).toBe(true);
    expect(problems.some((p) => p.includes('unknown category'))).toBe(true);
  });
});

describe('new game', () => {
  it('builds the starting deck and offers blueprints', () => {
    const s = engine.newGame({ seed: 's1' });
    const { gauges, copies, specials } = defaultConfig.startingDeck;
    const parts = defaultContent.categories.length * (gauges[1] - gauges[0] + 1) * copies;
    expect(p1(s).deck).toHaveLength(parts + specials.length);
    expect(s.phase).toBe('blueprintSelect');
    expect(s.roundState!.offers).toHaveLength(defaultConfig.offersPerRound);
    expect(s.roundState!.offers.every((id) => defaultContent.blueprints.find((b) => b.id === id)!.tier === 1)).toBe(true);
  });

  it('is reproducible from a seed', () => {
    expect(engine.newGame({ seed: 'same' })).toEqual(engine.newGame({ seed: 'same' }));
    const a = startedGame('same');
    const b = startedGame('same');
    expect(p1(a).hand).toEqual(p1(b).hand);
  });

  it('state is plain JSON', () => {
    const s = startedGame();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('deals a hand and flips a discard when the round starts', () => {
    const s = startedGame();
    expect(s.phase).toBe('playing');
    expect(p1(s).hand).toHaveLength(p1(s).rules.handSize);
    expect(s.roundState!.discard).toHaveLength(1);
    expect(p1(s).hand.length + p1(s).drawPile.length + 1).toBe(p1(s).deck.length);
  });

  it('rejects a blueprint that is not on offer', () => {
    const s = engine.newGame({ seed: 's1' });
    expect(() => engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p1', blueprintId: 'automaton' })).toThrow(/not on offer/);
  });
});

describe('turn loop', () => {
  it('draw then discard', () => {
    const s0 = startedGame();
    const s1 = engine.reduce(s0, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    expect(p1(s1).hand).toHaveLength(p1(s0).hand.length + 1);
    expect(p1(s1).drawsTaken).toBe(1);
    expect(s1.roundState!.turnPhase).toBe('main');

    const card = p1(s1).hand[0];
    const s2 = engine.reduce(s1, { type: 'DISCARD', playerId: 'p1', cardId: card });
    expect(s2.roundState!.discard.at(-1)).toBe(card);
    expect(s2.roundState!.turnPhase).toBe('draw');
  });

  it('does not mutate the input state', () => {
    const s0 = startedGame();
    const snapshot = JSON.stringify(s0);
    engine.reduce(s0, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it('draws from the discard pile', () => {
    const s0 = startedGame();
    const top = s0.roundState!.discard.at(-1)!;
    const s1 = engine.reduce(s0, { type: 'DRAW', playerId: 'p1', source: 'discard' });
    expect(p1(s1).hand).toContain(top);
    expect(s1.roundState!.discard).toHaveLength(0);
  });

  it('enforces phase order', () => {
    const s0 = startedGame();
    const r = engine.applyAction(s0, { type: 'DISCARD', playerId: 'p1', cardId: p1(s0).hand[0] });
    expect(r.ok).toBe(false);
    const s1 = engine.reduce(s0, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    expect(engine.applyAction(s1, { type: 'DRAW', playerId: 'p1', source: 'deck' }).ok).toBe(false);
  });

  it('reshuffles the discard pile when the draw pile runs out', () => {
    let s = startedGame('reshuffle', { drawLimitByTier: [99] });
    const s2 = structuredClone(s);
    const pl = p1(s2);
    s2.roundState!.discard.push(...pl.drawPile.splice(0));
    s = engine.reduce(s2, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    expect(s.roundState!.discard).toHaveLength(1);
    expect(p1(s).drawPile.length).toBeGreaterThan(0);
  });

  it('losing a round when draws run out costs a life and can end the run', () => {
    let s = startedGame('lose', { drawLimitByTier: [2], lives: 1 });
    for (let i = 0; i < 2; i++) {
      s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
      s = engine.reduce(s, { type: 'DISCARD', playerId: 'p1', cardId: p1(s).hand[0] });
    }
    expect(s.phase).toBe('roundOver');
    expect(s.lastResult!.perPlayer.p1.lifeLost).toBe(true);
    expect(p1(s).lives).toBe(0);
    s = engine.reduce(s, { type: 'CONTINUE', playerId: 'p1' });
    expect(s.phase).toBe('runLost');
  });

  it('with lives left, a failed round moves on to the shop', () => {
    let s = startedGame('lives', { drawLimitByTier: [1], lives: 2 });
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    s = engine.reduce(s, { type: 'DISCARD', playerId: 'p1', cardId: p1(s).hand[0] });
    s = engine.reduce(s, { type: 'CONTINUE', playerId: 'p1' });
    expect(s.phase).toBe('shop');
    expect(p1(s).lives).toBe(1);
  });
});

describe('building', () => {
  function readyToBuild(extra: string[] = []) {
    const s = startedGame('build', {}, undefined);
    const targeted = setTarget(s, 'go_kart');
    return withHand(targeted, [...GO_KART_HAND, ...extra]);
  }

  it('suggestBuild finds the build', () => {
    const { state } = readyToBuild();
    expect(engine.suggestBuild(state, 'p1')).not.toBeNull();
  });

  it('completing a blueprint removes the parts for good and grants the item', () => {
    const { state, ids } = readyToBuild();
    const groups = [ids.slice(0, 4), ids.slice(4, 7)];
    const deckBefore = p1(state).deck.length;
    const s = engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups });
    expect(s.phase).toBe('roundOver');
    expect(p1(s).deck).toHaveLength(deckBefore - 7);
    for (const id of groups.flat()) {
      expect(s.cards[id]).toBeUndefined();
      expect(p1(s).deck).not.toContain(id);
    }
    expect(p1(s).items.map((i) => i.itemId)).toEqual(['workbench']);
    expect(s.lastResult!.winner).toBe('p1');
    expect(s.lastResult!.perPlayer.p1.deadwood).toBe(9); // wood:9 left in hand
    expect(p1(s).currency).toBeGreaterThan(state.players[0].currency);
  });

  it('rejects an invalid build without changing state', () => {
    const { state, ids } = readyToBuild();
    const r = engine.applyAction(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(4, 7), ids.slice(0, 4)] });
    expect(r.ok).toBe(false);
    expect(r.state).toBe(state);
  });

  it('rejects cards not in hand', () => {
    const { state, ids } = readyToBuild();
    const foreign = p1(state).drawPile[0];
    const r = engine.applyAction(state, { type: 'BUILD', playerId: 'p1', groups: [[...ids.slice(0, 3), foreign], ids.slice(4, 7)] });
    expect(r.ok).toBe(false);
  });

  it('duct tape works as a wild and is consumed', () => {
    const s0 = setTarget(startedGame('tape'), 'go_kart');
    const { state, ids } = withHand(s0, ['iron:5', 'wood:5', 'brass:5', 'duct_tape', 'copper:1', 'copper:2', 'copper:3']);
    const s = engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 4), ids.slice(4, 7)] });
    expect(s.cards[ids[3]]).toBeUndefined();
    expect(p1(s).deck).not.toContain(ids[3]);
  });

  it('bulk pack and adaptor work in builds', () => {
    const s0 = setTarget(startedGame('bulk'), 'go_kart');
    const { state, ids } = withHand(s0, ['iron:5', 'wood:5', 'bulk_pack', 'copper:1', 'copper:2', 'iron:3', 'adaptor']);
    const s = engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 3), ids.slice(3, 7)] });
    expect(s.phase).toBe('roundOver');
  });

  it('cannot build with wilds under the Purist boss', () => {
    const s0 = startedGame('boss', { challengeModifiers: ['no_wilds'] });
    const { state, ids } = withHand(setTarget(s0, 'go_kart'), ['iron:5', 'wood:5', 'brass:5', 'duct_tape', 'copper:1', 'copper:2', 'copper:3']);
    const r = engine.applyAction(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 4), ids.slice(4, 7)] });
    expect(r.ok).toBe(false);
    expect(engine.suggestBuild(state, 'p1')).toBeNull();
  });
});

describe('items', () => {
  function afterBuilding(blueprintId: string, hand: string[], groups: number[][]) {
    const s0 = setTarget(startedGame('items'), blueprintId);
    const { state, ids } = withHand(s0, hand);
    return engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups: groups.map((g) => g.map((i) => ids[i])) });
  }

  function nextRound(s: GameState): GameState {
    s = engine.reduce(s, { type: 'CONTINUE', playerId: 'p1' });
    s = engine.reduce(s, { type: 'LEAVE_SHOP', playerId: 'p1' });
    return engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p1', blueprintId: s.roundState!.offers[0] });
  }

  it('Workbench gives +1 hand size next round', () => {
    const s = nextRound(afterBuilding('go_kart', GO_KART_HAND, [[0, 1, 2, 3], [4, 5, 6]]));
    expect(p1(s).rules.handSize).toBe(defaultConfig.handSizeByTier[0] + 1);
    expect(p1(s).hand).toHaveLength(defaultConfig.handSizeByTier[0] + 1);
  });

  it('Glue Pot grants a temporary duct tape each round', () => {
    const hand = ['iron:4', 'wood:4', 'brass:4', 'copper:4', 'copper:1', 'copper:2', 'copper:3'];
    let s = nextRound(afterBuilding('birdhouse', hand, [[0, 1, 2, 3], [4, 5, 6]]));
    const temp = p1(s).hand.filter((id) => s.cards[id].temporary);
    expect(temp).toHaveLength(1);
    expect(p1(s).deck).not.toContain(temp[0]);
    // It vanishes at round end.
    s = structuredClone(s);
    p1(s).rules.drawLimit = 1;
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    s = engine.reduce(s, { type: 'DISCARD', playerId: 'p1', cardId: p1(s).hand.find((id) => !s.cards[id].temporary)! });
    expect(s.phase).toBe('roundOver');
    expect(s.cards[temp[0]]).toBeUndefined();
  });

  it('Coin Press pays out at round end', () => {
    const hand = ['iron:5', 'wood:5', 'brass:5', 'copper:5', 'brass:1', 'brass:2', 'brass:3'];
    const s0 = setTarget(startedGame('coin'), 'music_box');
    const { state, ids } = withHand(s0, hand);
    const before = p1(state).currency;
    const s = engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 4), ids.slice(4, 7)] });
    const reward = s.lastResult!.perPlayer.p1.reward;
    expect(p1(s).currency).toBe(before + reward + 2);
  });
});

describe('specials', () => {
  it('Toolbox: when drawn, draw 2 keep 1', () => {
    const base = startedGame('toolbox');
    const { state, ids } = stackDrawPile(base, ['toolbox', 'iron:1', 'iron:2']);
    let s = engine.reduce(state, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    const choice = s.roundState!.pendingChoice!;
    expect(choice.kind).toBe('keepOne');
    expect(choice.cardIds.sort()).toEqual([ids[1], ids[2]].sort());
    expect(p1(s).played).toContain(ids[0]);
    expect(engine.applyAction(s, { type: 'DISCARD', playerId: 'p1', cardId: p1(s).hand[0] }).ok).toBe(false);

    s = engine.reduce(s, { type: 'RESOLVE_CHOICE', playerId: 'p1', cardIds: [ids[2]] });
    expect(p1(s).hand).toContain(ids[2]);
    expect(s.roundState!.discard.at(-1)).toBe(ids[1]);
    expect(s.roundState!.pendingChoice).toBeNull();
  });

  it('Parts Catalogue reorders the top of the deck', () => {
    const base = startedGame('cat');
    const { state: s1, ids: tops } = stackDrawPile(base, ['iron:1', 'iron:2', 'iron:3']);
    const { state: s2, ids } = withHand(s1, ['parts_catalogue', 'wood:7']);
    let s = engine.reduce(s2, { type: 'DRAW', playerId: 'p1', source: 'discard' });
    s = engine.reduce(s, { type: 'PLAY_SPECIAL', playerId: 'p1', cardId: ids[0] });
    expect(s.roundState!.pendingChoice).toMatchObject({ kind: 'reorderTop', cardIds: tops });
    s = engine.reduce(s, { type: 'RESOLVE_CHOICE', playerId: 'p1', cardIds: [tops[2], tops[0], tops[1]] });
    expect(p1(s).drawPile.slice(-3)).toEqual([tops[1], tops[0], tops[2]]);
  });

  it('Scavenger takes any card from the discard pile', () => {
    const base = startedGame('scav');
    const { state, ids } = withHand(base, ['scavenger', 'iron:1', 'iron:2']);
    let s = engine.reduce(state, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    s = engine.reduce(s, { type: 'DISCARD', playerId: 'p1', cardId: ids[1] });
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    s = engine.reduce(s, { type: 'DISCARD', playerId: 'p1', cardId: ids[2] });
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    // ids[1] is buried under ids[2].
    s = engine.reduce(s, { type: 'PLAY_SPECIAL', playerId: 'p1', cardId: ids[0], targetId: ids[1] });
    expect(p1(s).hand).toContain(ids[1]);
    expect(s.roundState!.discard).not.toContain(ids[1]);
  });

  it('Scavenger is blocked when discard draws are banned', () => {
    const base = startedGame('scav2', { challengeModifiers: ['no_scavenging'] });
    const { state, ids } = withHand(base, ['scavenger']);
    let s = engine.reduce(state, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    const target = s.roundState!.discard[0];
    expect(engine.applyAction(s, { type: 'PLAY_SPECIAL', playerId: 'p1', cardId: ids[0], targetId: target }).ok).toBe(false);
    expect(engine.applyAction(base, { type: 'DRAW', playerId: 'p1', source: 'discard' }).ok).toBe(false);
  });

  it('Scrapyard destroys a card and itself', () => {
    const base = startedGame('scrap');
    const { state, ids } = withHand(base, ['scrapyard', 'iron:1']);
    let s = engine.reduce(state, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    s = engine.reduce(s, { type: 'PLAY_SPECIAL', playerId: 'p1', cardId: ids[0], targetId: ids[1] });
    expect(s.cards[ids[0]]).toBeUndefined();
    expect(s.cards[ids[1]]).toBeUndefined();
    expect(p1(s).deck).not.toContain(ids[1]);
  });

  it('non-playable specials cannot be played', () => {
    const base = startedGame('np');
    const { state, ids } = withHand(base, ['duct_tape']);
    const s = engine.reduce(state, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    expect(engine.applyAction(s, { type: 'PLAY_SPECIAL', playerId: 'p1', cardId: ids[0] }).ok).toBe(false);
  });
});

describe('sub-assemblies and pivots', () => {
  it('locking is disabled by default', () => {
    const { state, ids } = withHand(startedGame('lock'), ['iron:1', 'iron:2', 'iron:3']);
    expect(engine.applyAction(state, { type: 'LOCK_MELD', playerId: 'p1', meldType: 'run', cardIds: ids }).ok).toBe(false);
  });

  it('locked melds count toward builds of the same shape', () => {
    const base = setTarget(startedGame('lock', { subAssemblies: true }), 'go_kart');
    const { state, ids } = withHand(base, GO_KART_HAND);
    let s = engine.reduce(state, { type: 'LOCK_MELD', playerId: 'p1', meldType: 'run', cardIds: ids.slice(4, 7) });
    expect(p1(s).lockedMelds).toHaveLength(1);
    expect(p1(s).hand).toHaveLength(5);
    expect(engine.suggestBuild(s, 'p1')).not.toBeNull();
    // A locked run cannot fill the set.
    expect(
      engine.applyAction(s, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(4, 7).concat(ids[0]), ids.slice(1, 4)] }).ok,
    ).toBe(false);
    s = engine.reduce(s, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 4), ids.slice(4, 7)] });
    expect(s.phase).toBe('roundOver');
  });

  it('pivoting costs draws', () => {
    let s = startedGame('pivot');
    const other = s.roundState!.offers.find((o) => o !== p1(s).target)!;
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    s = engine.reduce(s, { type: 'PIVOT', playerId: 'p1', blueprintId: other });
    expect(p1(s).target).toBe(other);
    expect(p1(s).drawsTaken).toBe(1 + defaultConfig.pivotCost.draws);
  });
});

describe('bosses and progression', () => {
  it('the last round of a tier is a boss with a modifier', () => {
    const s = engine.newGame({ seed: 'boss', config: { normalRoundsPerTier: 0 } });
    expect(s.roundState!.isBoss).toBe(true);
    expect(s.roundState!.offers).toHaveLength(1);
    expect(defaultContent.blueprints.find((b) => b.id === s.roundState!.offers[0])!.boss).toBe(true);
    expect(s.roundState!.boss).not.toBeNull();
  });

  it('embargo bans a concrete category from builds', () => {
    const base = startedGame('emb', { challengeModifiers: ['embargo'] });
    const banned = p1(base).rules.bannedCategories;
    expect(banned).toHaveLength(1);
    const cat = banned[0];
    const [a, b, c] = defaultContent.categories.filter((x) => x.id !== cat).map((x) => x.id);
    const { state, ids } = withHand(setTarget(base, 'go_kart'), [
      `${cat}:5`, `${a}:5`, `${b}:5`, `${c}:5`, `${a}:5`, `${b}:1`, `${b}:2`, `${b}:3`,
    ]);
    const groups = engine.suggestBuild(state, 'p1')!;
    expect(groups).not.toBeNull();
    expect(groups.flat()).not.toContain(ids[0]);
    const r = engine.applyAction(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 4), ids.slice(5, 8)] });
    expect(r.ok).toBe(false);
  });

  it('beating the final boss wins the run', () => {
    let s = engine.newGame({ seed: 'win', config: { tiers: 1, normalRoundsPerTier: 0, challengeModifiers: [] } });
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p1', blueprintId: s.roundState!.offers[0] });
    // Boss Handcart: set of 4 + run of 4. Force a hand, ignoring the random boss modifier.
    s = structuredClone(s);
    s.roundState!.boss = null;
    p1(s).rules = { ...p1(s).rules, disabledMeldRoles: [], bannedCategories: [] };
    const { state, ids } = withHand(s, ['iron:5', 'wood:5', 'brass:5', 'copper:5', 'copper:1', 'copper:2', 'copper:3', 'copper:4']);
    s = engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 4), ids.slice(4, 8)] });
    s = engine.reduce(s, { type: 'CONTINUE', playerId: 'p1' });
    expect(s.phase).toBe('runWon');
  });

  it('a failed boss is retried rather than skipped', () => {
    let s = engine.newGame({ seed: 'retry', config: { tiers: 1, normalRoundsPerTier: 0, lives: 3, drawLimitByTier: [1] } });
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p1', blueprintId: s.roundState!.offers[0] });
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    s = engine.reduce(s, { type: 'DISCARD', playerId: 'p1', cardId: p1(s).hand[0] });
    s = engine.reduce(s, { type: 'CONTINUE', playerId: 'p1' });
    expect(s.phase).toBe('shop');
    expect(s.tier).toBe(0);
    s = engine.reduce(s, { type: 'LEAVE_SHOP', playerId: 'p1' });
    expect(s.roundState!.isBoss).toBe(true);
  });

  it('tiers advance after the boss', () => {
    let s = engine.newGame({ seed: 'adv', config: { normalRoundsPerTier: 0 } });
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p1', blueprintId: s.roundState!.offers[0] });
    s = structuredClone(s);
    p1(s).rules = { ...p1(s).rules, disabledMeldRoles: [], bannedCategories: [] };
    const { state, ids } = withHand(s, ['iron:5', 'wood:5', 'brass:5', 'copper:5', 'copper:1', 'copper:2', 'copper:3', 'copper:4']);
    s = engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 4), ids.slice(4, 8)] });
    s = engine.reduce(s, { type: 'CONTINUE', playerId: 'p1' });
    expect(s.tier).toBe(1);
    s = engine.reduce(s, { type: 'LEAVE_SHOP', playerId: 'p1' });
    expect(defaultContent.blueprints.find((b) => b.id === s.roundState!.offers[0])!.tier).toBe(2);
    const cramped = s.roundState!.boss?.modifierId === 'cramped' ? 1 : 0;
    expect(p1(s).rules.handSize).toBe(defaultConfig.handSizeByTier[1] - cramped);
  });
});

describe('shop', () => {
  function inShop(currency = 50): GameState {
    let s = startedGame('shop', { drawLimitByTier: [1], lives: 2 });
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    s = engine.reduce(s, { type: 'DISCARD', playerId: 'p1', cardId: p1(s).hand[0] });
    s = engine.reduce(s, { type: 'CONTINUE', playerId: 'p1' });
    s = structuredClone(s);
    p1(s).currency = currency;
    return s;
  }

  it('offers parts, specials and services', () => {
    const s = inShop();
    const kinds = new Set(s.shop!.slots.map((x) => x.kind));
    expect(kinds).toEqual(new Set(['part', 'special', 'service']));
  });

  it('buying a part adds it to the deck and costs currency', () => {
    const s0 = inShop();
    const i = s0.shop!.slots.findIndex((x) => x.kind === 'part');
    const s = engine.reduce(s0, { type: 'SHOP_BUY', playerId: 'p1', slot: i });
    expect(p1(s).deck).toHaveLength(p1(s0).deck.length + 1);
    expect(p1(s).currency).toBe(50 - s0.shop!.slots[i].price);
    expect(engine.applyAction(s, { type: 'SHOP_BUY', playerId: 'p1', slot: i }).ok).toBe(false);
  });

  it('cannot buy without enough currency', () => {
    const s0 = inShop(0);
    expect(engine.applyAction(s0, { type: 'SHOP_BUY', playerId: 'p1', slot: 0 }).ok).toBe(false);
  });

  it('the scrap service thins the deck', () => {
    const s0 = inShop();
    const i = s0.shop!.slots.findIndex((x) => x.serviceId === 'scrap');
    const victim = p1(s0).deck[0];
    expect(engine.applyAction(s0, { type: 'SHOP_BUY', playerId: 'p1', slot: i }).ok).toBe(false);
    const s = engine.reduce(s0, { type: 'SHOP_BUY', playerId: 'p1', slot: i, targetId: victim });
    expect(p1(s).deck).not.toContain(victim);
  });

  it('reroll replaces stock and costs currency', () => {
    const s0 = inShop();
    const s = engine.reduce(s0, { type: 'SHOP_REROLL', playerId: 'p1' });
    expect(p1(s).currency).toBe(50 - defaultConfig.shopRerollCost);
    expect(s.shop!.rerolls).toBe(1);
  });

  it('leaving opens the next blueprint choice', () => {
    const s = engine.reduce(inShop(), { type: 'LEAVE_SHOP', playerId: 'p1' });
    expect(s.phase).toBe('blueprintSelect');
    expect(s.round).toBe(1);
  });
});

describe('multiplayer foundations', () => {
  it('supports N players with turn order and a shared discard', () => {
    let s = engine.newGame({ seed: 'mp', config: { mode: 'versus' }, players: [{ name: 'A' }, { name: 'B' }] });
    expect(s.players).toHaveLength(2);
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p1', blueprintId: s.roundState!.offers[0] });
    expect(s.phase).toBe('blueprintSelect');
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p2', blueprintId: s.roundState!.offers[1] });
    expect(s.phase).toBe('playing');

    expect(engine.applyAction(s, { type: 'DRAW', playerId: 'p2', source: 'deck' }).ok).toBe(false);
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    const discarded = s.players[0].hand[0];
    s = engine.reduce(s, { type: 'DISCARD', playerId: 'p1', cardId: discarded });
    expect(s.players[s.activePlayer].id).toBe('p2');
    s = engine.reduce(s, { type: 'DRAW', playerId: 'p2', source: 'discard' });
    expect(s.players[1].hand).toContain(discarded);
  });

  it('the first player to build ends the round; others score deadwood', () => {
    let s = engine.newGame({ seed: 'mp2', config: { mode: 'versus' }, players: [{ name: 'A' }, { name: 'B' }] });
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p1', blueprintId: 'go_kart' === s.roundState!.offers[0] ? 'go_kart' : s.roundState!.offers[0] });
    s = engine.reduce(s, { type: 'SELECT_BLUEPRINT', playerId: 'p2', blueprintId: s.roundState!.offers[0] });
    s = setTarget(s, 'go_kart');
    const { state, ids } = withHand(s, GO_KART_HAND);
    s = engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups: [ids.slice(0, 4), ids.slice(4, 7)] });
    expect(s.lastResult!.winner).toBe('p1');
    expect(s.lastResult!.perPlayer.p2.built).toBe(false);
    expect(s.lastResult!.perPlayer.p2.deadwood).toBeGreaterThan(0);
    expect(s.lastResult!.perPlayer.p2.lifeLost).toBe(false);
  });
});

describe('bot', () => {
  it('plays complete runs deterministically', () => {
    for (const seed of ['b1', 'b2', 'b3']) {
      const a = autoplay(engine, engine.newGame({ seed }));
      const b = autoplay(engine, engine.newGame({ seed }));
      expect(['runWon', 'runLost']).toContain(a.state.phase);
      expect(a.state).toEqual(b.state);
    }
  });
});

describe('sorting chosen cards into melds', () => {
  // The same part can appear in a run and (as its second copy) in a set.
  const hand = ['brass:3', 'brass:4', 'brass:5', 'brass:6', 'brass:4', 'wood:4', 'copper:4', 'iron:9'];

  it('splits a run and a set that share a number', () => {
    // Clockwork Toy: run of 4 + set of 3.
    const { state, ids } = withHand(setTarget(startedGame('sort'), 'clockwork_toy'), hand);
    const chosen = ids.slice(0, 7);
    const groups = engine.suggestBuild(state, 'p1', chosen)!;
    expect(groups).not.toBeNull();
    expect(groups.flat().sort()).toEqual([...chosen].sort());
    const s = engine.reduce(state, { type: 'BUILD', playerId: 'p1', groups });
    expect(s.phase).toBe('roundOver');
  });

  it('a 2-3-4-5 run plus three 4s works', () => {
    const { state, ids } = withHand(setTarget(startedGame('sort2'), 'clockwork_toy'), [
      'brass:2', 'brass:3', 'brass:4', 'brass:5', 'brass:4', 'wood:4', 'copper:4',
    ]);
    expect(engine.suggestBuild(state, 'p1', ids)).not.toBeNull();
  });

  it('only uses the cards given', () => {
    const { state, ids } = withHand(setTarget(startedGame('sort3'), 'clockwork_toy'), hand);
    expect(engine.suggestBuild(state, 'p1', ids.slice(0, 4))).toBeNull();
  });
});

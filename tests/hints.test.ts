import { describe, expect, it } from 'vitest';
import { buildHints } from '../src/engine/hints';
import { engine, setTarget, startedGame, withHand } from './helpers';

function hintsFor(blueprintId: string, hand: string[]) {
  const { state, ids } = withHand(setTarget(startedGame('hints'), blueprintId), hand);
  return { hints: buildHints(engine, state, 'p1')!, ids };
}

describe('build hints', () => {
  it('reports what a set and a category run still need', () => {
    // Music Box: set of 4 + run of 3 brass.
    const { hints, ids } = hintsFor('music_box', ['iron:5', 'wood:5', 'copper:5', 'brass:6', 'brass:8', 'wood:1']);
    expect(hints.ready).toBe(false);
    const [set, run] = hints.melds;
    expect(set).toMatchObject({ filled: 3, gauge: 5 });
    expect(set.cardIds.sort()).toEqual(ids.slice(0, 3).sort());
    expect(run).toMatchObject({ filled: 2, category: 'brass', missingGauges: [7] });
    expect(run.cardIds).not.toContain(ids[5]);
  });

  it('counts wilds toward missing slots', () => {
    const { hints } = hintsFor('music_box', ['iron:5', 'wood:5', 'copper:5', 'duct_tape', 'brass:6', 'brass:7']);
    expect(hints.melds[0].filled).toBe(4);
  });

  it('flags a complete hand as ready', () => {
    const { hints } = hintsFor('music_box', ['iron:5', 'wood:5', 'copper:5', 'brass:5', 'brass:6', 'brass:7', 'brass:8']);
    expect(hints.ready).toBe(true);
    expect(hints.melds.every((m) => m.filled >= m.requirement.size)).toBe(true);
  });

  it('respects gauge limits on sets', () => {
    // Birdhouse: set of 4 with gauge <= 5.
    const { hints } = hintsFor('birdhouse', ['iron:9', 'wood:9', 'copper:9', 'iron:2']);
    expect(hints.melds[0]).toMatchObject({ gauge: 2, filled: 1 });
  });
});

describe('build hints for selected cards', () => {
  it('only counts the cards given', () => {
    const { state, ids } = withHand(setTarget(startedGame('hints-sel'), 'music_box'), [
      'iron:5', 'wood:5', 'copper:5', 'brass:5', 'brass:6', 'brass:7', 'brass:8',
    ]);
    expect(buildHints(engine, state, 'p1')!.ready).toBe(true);
    const partial = buildHints(engine, state, 'p1', ids.slice(0, 3))!;
    expect(partial.ready).toBe(false);
    expect(partial.melds[0]).toMatchObject({ filled: 3, gauge: 5 });
    expect(partial.melds[1].filled).toBe(0);
  });
});

describe('melds bigger than needed', () => {
  it('a set counts every matching card (four 2s for a set of 3)', () => {
    // Clockwork Toy: run of 4 + set of 3. Four 2s in hand.
    const { hints } = hintsFor('clockwork_toy', ['brass:2', 'wood:2', 'iron:2', 'copper:2', 'copper:5', 'copper:7', 'copper:8']);
    const set = hints.melds[1];
    expect(set).toMatchObject({ gauge: 2, filled: 3, have: 4 });
    expect(set.cardIds).toHaveLength(4);
    expect(hints.melds[0]).toMatchObject({ filled: 3, missingGauges: [6] });
  });

  it('extra cards do not steal from another meld', () => {
    // Run of 4 needs Copper 2; the set of 3 must use the other 2s.
    const { hints } = hintsFor('clockwork_toy', ['copper:2', 'copper:3', 'copper:4', 'copper:5', 'brass:2', 'wood:2', 'iron:2']);
    expect(hints.ready).toBe(true);
    expect(hints.melds[0].cardIds).toHaveLength(4);
    expect(hints.melds[1].cardIds).toHaveLength(3);
  });

  it('a run extends at either end', () => {
    const { hints } = hintsFor('music_box', ['brass:3', 'brass:4', 'brass:5', 'brass:6', 'iron:9']);
    expect(hints.melds[1].cardIds).toHaveLength(4);
  });
});

describe('hints pick the best split across melds', () => {
  it('uses all four 2s for the set and builds the run elsewhere (screenshot hand)', () => {
    const { hints } = hintsFor('clockwork_toy', [
      'brass:2', 'wood:2', 'iron:2', 'copper:2', 'copper:4', 'copper:5', 'wood:6',
      'copper:7', 'iron:7', 'copper:7', 'copper:8', 'brass:8',
    ]);
    const [run, set] = hints.melds;
    expect(set).toMatchObject({ gauge: 2, have: 4, filled: 3 });
    expect(set.cardIds).toHaveLength(4);
    expect(run).toMatchObject({ category: 'copper', filled: 3, missingGauges: [6] });
  });

  it('first screenshot hand: four 2s and a Copper 5-7-8 run needing 6', () => {
    const { hints } = hintsFor('clockwork_toy', [
      'brass:2', 'wood:2', 'iron:2', 'copper:2', 'iron:3', 'wood:3', 'copper:5', 'iron:6', 'wood:6', 'copper:7', 'copper:8',
    ]);
    const [run, set] = hints.melds;
    expect(set).toMatchObject({ gauge: 2, have: 4 });
    expect(run).toMatchObject({ category: 'copper', missingGauges: [6] });
  });
});

describe('number limits', () => {
  it('Birdhouse set ignores 8s (must be 5 or less) and prefers the higher pair', () => {
    const { hints } = hintsFor('birdhouse', [
      'copper:2', 'brass:3', 'wood:3', 'wood:4', 'wood:5', 'wood:5', 'brass:6', 'wood:7', 'iron:8', 'iron:8', 'brass:8', 'duct_tape',
    ]);
    const [set, run] = hints.melds;
    expect(set.gauge).toBeLessThanOrEqual(5);
    expect(set.gauge).toBe(5);
    expect(run).toMatchObject({ category: 'wood', filled: 3 });
  });
});

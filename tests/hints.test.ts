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

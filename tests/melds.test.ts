import { describe, expect, it } from 'vitest';
import { checkBuild, findBuild, type MeldRules, type MeldToken, validateMeld } from '../src/engine/melds';

const rules: MeldRules = {
  gaugeMin: 1,
  gaugeMax: 10,
  disabledMeldRoles: [],
  bannedCategories: [],
  requireNaturalInMeld: true,
};

let seq = 0;
const p = (category: string, gauge: number): MeldToken => ({ role: 'natural', id: `n${seq++}`, category, gauge });
const wild = (): MeldToken => ({ role: 'wild', id: `w${seq++}` });
const bulk = (slots = 2): MeldToken => ({ role: 'bulk', id: `b${seq++}`, slots });
const adaptor = (): MeldToken => ({ role: 'adaptor', id: `a${seq++}` });

describe('sets', () => {
  it('accepts N cards of the same gauge in any categories', () => {
    const r = validateMeld([p('iron', 5), p('wood', 5), p('brass', 5), p('iron', 5)], { type: 'set', size: 4 }, rules);
    expect(r).toMatchObject({ ok: true, gauge: 5, slots: 4 });
  });

  it('rejects mixed gauges', () => {
    expect(validateMeld([p('iron', 5), p('wood', 5), p('brass', 6)], { type: 'set', size: 3 }, rules).ok).toBe(false);
  });

  it('rejects too few cards', () => {
    const r = validateMeld([p('iron', 5), p('wood', 5)], { type: 'set', size: 3 }, rules);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Needs 3/);
  });

  it('accepts more cards than required', () => {
    expect(validateMeld([p('iron', 2), p('wood', 2), p('brass', 2), p('copper', 2)], { type: 'set', size: 3 }, rules).ok).toBe(true);
  });

  it('enforces gauge constraints', () => {
    const cards = [p('iron', 5), p('wood', 5), p('brass', 5)];
    expect(validateMeld(cards, { type: 'set', size: 3, minGauge: 7 }, rules).ok).toBe(false);
    expect(validateMeld(cards, { type: 'set', size: 3, maxGauge: 5 }, rules).ok).toBe(true);
  });

  it('enforces a category constraint', () => {
    expect(validateMeld([p('iron', 5), p('iron', 5), p('wood', 5)], { type: 'set', size: 3, category: 'iron' }, rules).ok).toBe(false);
    expect(validateMeld([p('iron', 5), p('iron', 5), p('iron', 5)], { type: 'set', size: 3, category: 'iron' }, rules).ok).toBe(true);
  });
});

describe('runs', () => {
  it('accepts consecutive gauges in one category, in any order', () => {
    const r = validateMeld([p('iron', 6), p('iron', 4), p('iron', 5)], { type: 'run', size: 3 }, rules);
    expect(r).toMatchObject({ ok: true, category: 'iron', start: 4 });
  });

  it('rejects mixed categories', () => {
    expect(validateMeld([p('iron', 4), p('wood', 5), p('iron', 6)], { type: 'run', size: 3 }, rules).ok).toBe(false);
  });

  it('rejects gaps and duplicates', () => {
    expect(validateMeld([p('iron', 4), p('iron', 5), p('iron', 7)], { type: 'run', size: 3 }, rules).ok).toBe(false);
    expect(validateMeld([p('iron', 4), p('iron', 5), p('iron', 5)], { type: 'run', size: 3 }, rules).ok).toBe(false);
  });

  it('respects the gauge range at the edges', () => {
    expect(validateMeld([p('iron', 9), p('iron', 10), wild()], { type: 'run', size: 3 }, rules)).toMatchObject({
      ok: true,
      start: 8,
    });
    const narrow = { ...rules, gaugeMax: 10 };
    expect(validateMeld([p('iron', 10), wild(), wild()], { type: 'run', size: 3 }, narrow)).toMatchObject({
      ok: true,
      start: 8,
    });
  });

  it('enforces the run category constraint', () => {
    const cards = [p('wood', 1), p('wood', 2), p('wood', 3)];
    expect(validateMeld(cards, { type: 'run', size: 3, category: 'iron' }, rules).ok).toBe(false);
    expect(validateMeld(cards, { type: 'run', size: 3, category: 'wood' }, rules).ok).toBe(true);
  });
});

describe('wilds (Duct Tape)', () => {
  it('fills a set slot', () => {
    expect(validateMeld([p('iron', 3), p('wood', 3), wild()], { type: 'set', size: 3 }, rules).ok).toBe(true);
  });

  it('fills a gap in a run', () => {
    expect(validateMeld([p('iron', 3), wild(), p('iron', 5)], { type: 'run', size: 3 }, rules)).toMatchObject({
      ok: true,
      start: 3,
    });
  });

  it('extends a run at either end', () => {
    expect(validateMeld([p('iron', 1), p('iron', 2), wild(), wild()], { type: 'run', size: 4 }, rules).ok).toBe(true);
  });

  it('cannot make a meld on its own when a natural part is required', () => {
    expect(validateMeld([wild(), wild(), wild()], { type: 'set', size: 3 }, rules).ok).toBe(false);
    expect(validateMeld([wild(), wild(), wild()], { type: 'set', size: 3 }, { ...rules, requireNaturalInMeld: false }).ok).toBe(true);
    expect(validateMeld([wild(), wild(), wild()], { type: 'run', size: 3 }, { ...rules, requireNaturalInMeld: false }).ok).toBe(true);
  });

  it('is rejected when wilds are disabled', () => {
    const r = validateMeld([p('iron', 3), p('wood', 3), wild()], { type: 'set', size: 3 }, { ...rules, disabledMeldRoles: ['wild'] });
    expect(r.ok).toBe(false);
  });
});

describe('Bulk Pack', () => {
  it('counts as two copies in a set', () => {
    const r = validateMeld([p('iron', 7), p('wood', 7), bulk()], { type: 'set', size: 4 }, rules);
    expect(r).toMatchObject({ ok: true, slots: 4, gauge: 7 });
  });

  it('is not allowed in runs', () => {
    const r = validateMeld([p('iron', 3), p('iron', 4), bulk()], { type: 'run', size: 4 }, rules);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sets/);
  });

  it('needs a real part alongside it', () => {
    expect(validateMeld([bulk(), bulk()], { type: 'set', size: 4 }, rules).ok).toBe(false);
  });

  it('respects set constraints via the natural cards', () => {
    expect(validateMeld([p('iron', 3), bulk()], { type: 'set', size: 3, minGauge: 5 }, rules).ok).toBe(false);
  });
});

describe('Adaptor', () => {
  it('lets a part count as an adjacent gauge in a set', () => {
    const r = validateMeld([p('iron', 5), p('wood', 5), p('brass', 6), adaptor()], { type: 'set', size: 3 }, rules);
    expect(r).toMatchObject({ ok: true, gauge: 5, adaptorsUsed: 1, slots: 3 });
  });

  it('does not take a slot', () => {
    expect(validateMeld([p('iron', 5), p('wood', 5), adaptor()], { type: 'set', size: 3 }, rules).ok).toBe(false);
  });

  it('only shifts by one gauge', () => {
    expect(validateMeld([p('iron', 5), p('wood', 5), p('brass', 7), adaptor()], { type: 'set', size: 3 }, rules).ok).toBe(false);
  });

  it('lets a part change category in a run', () => {
    const r = validateMeld([p('iron', 4), p('wood', 5), p('iron', 6), adaptor()], { type: 'run', size: 3 }, rules);
    expect(r).toMatchObject({ ok: true, category: 'iron', adaptorsUsed: 1 });
  });

  it('lets a part shift gauge in a run', () => {
    // 4, 5, 5 -> second 5 becomes 6
    expect(validateMeld([p('iron', 4), p('iron', 5), p('iron', 5), adaptor()], { type: 'run', size: 3 }, rules).ok).toBe(true);
  });

  it('fixes only one thing per adaptor', () => {
    // Wood 7 would need both a category change and a gauge shift.
    expect(validateMeld([p('iron', 4), p('iron', 5), p('wood', 7), adaptor()], { type: 'run', size: 3 }, rules).ok).toBe(false);
    expect(
      validateMeld([p('iron', 4), p('iron', 5), p('wood', 7), adaptor(), adaptor()], { type: 'run', size: 3 }, rules).ok,
    ).toBe(false);
  });

  it('one adaptor per mismatched card', () => {
    const cards = [p('iron', 5), p('wood', 4), p('brass', 6)];
    expect(validateMeld([...cards, adaptor()], { type: 'set', size: 3 }, rules).ok).toBe(false);
    expect(validateMeld([...cards, adaptor(), adaptor()], { type: 'set', size: 3 }, rules).ok).toBe(true);
  });

  it('can satisfy a category-constrained set', () => {
    const req = { type: 'set' as const, size: 3, category: 'iron' };
    expect(validateMeld([p('iron', 5), p('iron', 5), p('wood', 5), adaptor()], req, rules).ok).toBe(true);
  });

  it('combines with wilds', () => {
    expect(validateMeld([p('iron', 2), wild(), p('wood', 4), adaptor()], { type: 'run', size: 3 }, rules).ok).toBe(true);
  });
});

describe('banned categories', () => {
  it('rejects melds using a banned category', () => {
    const r = validateMeld([p('iron', 5), p('wood', 5), p('brass', 5)], { type: 'set', size: 3 }, { ...rules, bannedCategories: ['wood'] });
    expect(r.ok).toBe(false);
  });
});

describe('checkBuild', () => {
  const reqs = [
    { type: 'set' as const, size: 4 },
    { type: 'run' as const, size: 3 },
  ];

  it('validates each group against its requirement', () => {
    const set = [p('iron', 5), p('wood', 5), p('brass', 5), p('copper', 5)];
    const run = [p('iron', 1), p('iron', 2), p('iron', 3)];
    expect(checkBuild([set, run], reqs, rules).ok).toBe(true);
    expect(checkBuild([run, set], reqs, rules).ok).toBe(false);
  });

  it('rejects the wrong number of groups', () => {
    expect(checkBuild([[p('iron', 1)]], reqs, rules).ok).toBe(false);
  });

  it('rejects a card used twice', () => {
    const shared = p('iron', 3);
    const set = [shared, p('wood', 3), p('brass', 3), p('copper', 3)];
    const run = [p('iron', 1), p('iron', 2), shared];
    const r = checkBuild([set, run], reqs, rules);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/two melds/);
  });
});

describe('findBuild', () => {
  const reqs = [
    { type: 'set' as const, size: 4 },
    { type: 'run' as const, size: 3 },
  ];

  it('finds an assignment in a hand with junk', () => {
    const hand = [
      p('iron', 5), p('wood', 9), p('wood', 5), p('copper', 2), p('brass', 5),
      p('copper', 3), p('copper', 5), p('copper', 4), p('iron', 10),
    ];
    const groups = findBuild(hand.map((t) => ({ tokens: [t] })), reqs, rules);
    expect(groups).not.toBeNull();
    const byId = new Map(hand.map((t) => [t.id, t]));
    expect(checkBuild(groups!.map((g) => g.map((id) => byId.get(id)!)), reqs, rules).ok).toBe(true);
  });

  it('handles overlapping needs (a card that fits both melds)', () => {
    // Copper 5 is needed in the run, so the set must use the other 5s.
    const hand = [p('iron', 5), p('wood', 5), p('brass', 5), p('copper', 5), p('copper', 6), p('copper', 7), p('iron', 5)];
    expect(findBuild(hand.map((t) => ({ tokens: [t] })), reqs, rules)).not.toBeNull();
  });

  it('returns null when impossible', () => {
    const hand = [p('iron', 5), p('wood', 5), p('brass', 5), p('copper', 2), p('copper', 3), p('copper', 9)];
    expect(findBuild(hand.map((t) => ({ tokens: [t] })), reqs, rules)).toBeNull();
  });

  it('prefers natural cards over specials', () => {
    const w = wild();
    const hand = [p('iron', 5), p('wood', 5), p('brass', 5), p('copper', 5), w, p('iron', 1), p('iron', 2), p('iron', 3)];
    const groups = findBuild(hand.map((t) => ({ tokens: [t] })), reqs, rules)!;
    expect(groups.flat()).not.toContain(w.id);
  });

  it('keeps locked sub-assemblies whole and in a meld of their type', () => {
    const locked = [p('iron', 1), p('iron', 2), p('iron', 3)];
    const units = [
      { tokens: locked, lockedType: 'run' as const },
      ...[p('iron', 5), p('wood', 5), p('brass', 5), p('copper', 5)].map((t) => ({ tokens: [t] })),
    ];
    const groups = findBuild(units, reqs, rules)!;
    expect(groups[1].sort()).toEqual(locked.map((t) => t.id).sort());

    const wrongType = [{ tokens: locked, lockedType: 'set' as const }, ...units.slice(1)];
    expect(findBuild(wrongType, reqs, rules)).toBeNull();
  });
});

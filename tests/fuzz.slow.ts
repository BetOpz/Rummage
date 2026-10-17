/**
 * Every item's gadget, at every tier, tried everywhere with generic picks
 * during whole bot runs. Illegal uses are fine (they're refused); anything
 * that throws something other than a rule error is a bug. Slow: run with
 * `npm run test:fuzz` (not part of `npm test`).
 */
import { describe, expect, it } from 'vitest';
import { defaultContent } from '../src/content';
import { botAction } from '../src/engine/bot';
import { maxCharges } from '../src/engine/items';
import type { GameAction, GameState } from '../src/engine/types';
import { mapEngine as engine } from './helpers';

const P = 'p1';
const GRADES = [1, 5, 7];

/** Generic picks for a gadget: an opponent, the first cards it could want, the first option, parcel and pages. */
function attempts(s: GameState, itemUid: string): GameAction[] {
  const duel = s.duel;
  const me = s.players[0];
  const hand = duel?.hand ?? [];
  const discard = duel?.discard ?? [];
  const pages = me.pages ?? defaultContent.items.map((d) => d.id);
  const node = s.map?.rows.flat().find((n) => n.encounter?.lot && !s.map!.visited.includes(n.id))?.id;
  const base = { type: 'USE_GADGET' as const, playerId: P, itemUid };
  return [
    { ...base },
    { ...base, target: 0, option: 0 },
    { ...base, target: 0, option: 1 },
    { ...base, cards: hand.slice(0, 1), values: [1], materials: ['brass'] },
    { ...base, cards: hand.slice(0, 2), values: [1, -1], materials: ['brass', 'iron'] },
    { ...base, cards: discard.slice(-1) },
    { ...base, cards: me.deck.slice(0, 1), pages: pages.slice(0, 1) },
    { ...base, parcels: [0] },
    { ...base, nodeId: node, parcels: [0] },
    { ...base, pages: pages.slice(0, 2), stage: 1 },
  ];
}

function fuzzRun(seed: string, itemIds: string[], grade: number): GameState {
  let s = structuredClone(engine.newGame({ seed }));
  for (const itemId of itemIds) {
    const item = { uid: `f-${itemId}`, itemId, fromBlueprint: 'scrapbook', builtFrom: 3, level: 1, usesLeft: null, charges: null as number | null, grade, material: 'x' };
    s.players[0].items.push(item);
    item.charges = maxCharges(defaultContent, s.config, item, s.players[0]);
  }
  for (let step = 0; step < 2500 && s.phase !== 'runWon' && s.phase !== 'runLost'; step++) {
    // Now and then, try every gadget with every set of picks; keep the first that works.
    let used = false;
    if (!s.duel?.choice && step % 4 === 0) {
      for (const it of s.players[0].items) {
        if ((it.charges ?? 0) <= 0) continue;
        for (const a of attempts(s, it.uid)) {
          const r = engine.applyAction(s, a);
          if (r.ok) {
            s = r.state;
            used = true;
            break;
          }
        }
        if (used) break;
      }
    }
    if (used) continue;
    const a = botAction(engine, s, P);
    if (!a) throw new Error(`stuck in ${s.phase}`);
    s = engine.reduce(s, a);
  }
  return s;
}

describe('gadget fuzz', () => {
  const ids = defaultContent.items.filter((d) => d.gadget).map((d) => d.id);
  // Six items a run, so every gadget turns up across the runs.
  const groups: string[][] = [];
  for (let i = 0; i < ids.length; i += 6) groups.push(ids.slice(i, i + 6));

  for (const grade of GRADES) {
    groups.forEach((group, i) => {
      it(`no gadget crashes at grade ${grade}: ${group.join(', ')}`, () => {
        const s = fuzzRun(`fuzz-${grade}-${i}`, group, grade);
        expect(s.players[0]).toBeDefined();
      }, 60_000);
    });
  }
});

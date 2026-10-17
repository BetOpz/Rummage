/**
 * Balance simulation: the heuristic bot plays N seeded runs and we report
 * how far it gets, and how it used its items. Usage:
 *   npm run sim -- [runs=200] [config overrides as JSON]
 *   npm run sim -- 300 '{"lives":3}'
 *   npm run sim -- 200 '{}' --items     (also list gadget use per item)
 */
import { autoplay, engine } from '../src/engine';

const runs = Number(process.argv[2] ?? 200);
const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const showItems = process.argv.includes('--items');

let wins = 0;
const reached: Record<string, number> = {};
let totalActions = 0;
let items = 0;
let grades = 0;
let walked = 0;
let gadgetUses = 0;
const usesByItem: Record<string, number> = {};
const aliveByItem: Record<string, number> = {};
const winsByItem: Record<string, number> = {};
for (let i = 0; i < runs; i++) {
  const start = engine.newGame({ seed: `sim-${i}`, config: overrides });
  const { state, actions } = autoplay(engine, start);
  totalActions += actions.length;
  const won = state.phase === 'runWon';
  if (won) wins++;
  const key =
    state.config.runStructure === 'map'
      ? `act ${state.tier + 1} stop ${String(state.round).padStart(2)}${won ? ' (won)' : ''}`
      : `tier ${state.tier + 1} round ${state.round + 1}`;
  const me = state.players[0];
  items += me.items.length;
  for (const it of me.items) {
    grades += it.grade;
    aliveByItem[it.itemId] = (aliveByItem[it.itemId] ?? 0) + 1;
    if (won) winsByItem[it.itemId] = (winsByItem[it.itemId] ?? 0) + 1;
  }
  // Gadget uses, by item (uids of items torn out since are counted as "gone").
  const byUid = new Map(me.items.map((it) => [it.uid, it.itemId]));
  for (const a of actions) {
    if (a.type !== 'USE_GADGET') continue;
    gadgetUses++;
    const id = byUid.get(a.itemUid) ?? '(gone)';
    usesByItem[id] = (usesByItem[id] ?? 0) + 1;
  }
  walked += actions.filter((a) => a.type === 'DUEL_WALK_AWAY').length;
  reached[key] = (reached[key] ?? 0) + 1;
}
console.log(`Runs: ${runs}  wins: ${wins} (${((wins / runs) * 100).toFixed(1)}%)  avg actions: ${(totalActions / runs).toFixed(0)}`);
console.log(`Avg items held at the end: ${(items / runs).toFixed(1)} (avg grade ${(grades / Math.max(1, items)).toFixed(1)})`);
console.log(`Gadget uses per run: ${(gadgetUses / runs).toFixed(1)}`);
console.log(`Duels walked away from (couldn't match the stake): ${(walked / runs).toFixed(2)} per run`);
console.log('Where runs ended:');
for (const [k, v] of Object.entries(reached).sort()) console.log(`  ${k}: ${v}`);
if (showItems) {
  console.log('\nItems alive at the end of a run (runs), their gadget uses per run held, and the win rate when held:');
  const ids = [...new Set([...Object.keys(aliveByItem), ...Object.keys(usesByItem)])].sort((a, b) => (aliveByItem[b] ?? 0) - (aliveByItem[a] ?? 0));
  for (const id of ids) {
    const alive = aliveByItem[id] ?? 0;
    const uses = usesByItem[id] ?? 0;
    const winRate = alive ? `${(((winsByItem[id] ?? 0) / alive) * 100).toFixed(0)}%` : '-';
    console.log(`  ${id.padEnd(20)} ${String(alive).padStart(4)}  uses/run ${(alive ? uses / alive : 0).toFixed(1).padStart(5)}  win ${winRate.padStart(4)}`);
  }
}

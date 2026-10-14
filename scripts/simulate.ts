/**
 * Balance simulation: the heuristic bot plays N seeded runs and we report
 * how far it gets. Usage: npm run sim -- [runs=200] [key=value config overrides as JSON]
 *   npm run sim -- 300 '{"lives":3}'
 */
import { autoplay, engine } from '../src/engine';

const runs = Number(process.argv[2] ?? 200);
const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {};

let wins = 0;
const reached: Record<string, number> = {};
let totalActions = 0;
let items = 0;
let grades = 0;
let walked = 0;
for (let i = 0; i < runs; i++) {
  const start = engine.newGame({ seed: `sim-${i}`, config: overrides });
  const { state, actions } = autoplay(engine, start);
  totalActions += actions.length;
  if (state.phase === 'runWon') wins++;
  const key =
    state.config.runStructure === 'map'
      ? `act ${state.tier + 1} stop ${String(state.round).padStart(2)}${state.phase === 'runWon' ? ' (won)' : ''}`
      : `tier ${state.tier + 1} round ${state.round + 1}`;
  items += state.players[0].items.length;
  for (const it of state.players[0].items) grades += it.grade;
  walked += actions.filter((a) => a.type === 'DUEL_WALK_AWAY').length;
  reached[key] = (reached[key] ?? 0) + 1;
}
console.log(`Runs: ${runs}  wins: ${wins} (${((wins / runs) * 100).toFixed(1)}%)  avg actions: ${(totalActions / runs).toFixed(0)}`);
console.log(`Avg items held at the end: ${(items / runs).toFixed(1)} (avg grade ${(grades / Math.max(1, items)).toFixed(1)})`);
console.log(`Duels walked away from (couldn't match the stake): ${(walked / runs).toFixed(2)} per run`);
console.log('Where runs ended:');
for (const [k, v] of Object.entries(reached).sort()) console.log(`  ${k}: ${v}`);

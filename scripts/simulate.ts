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
for (let i = 0; i < runs; i++) {
  const start = engine.newGame({ seed: `sim-${i}`, config: overrides });
  const { state, actions } = autoplay(engine, start);
  totalActions += actions.length;
  if (state.phase === 'runWon') wins++;
  const key = `tier ${state.tier + 1} round ${state.round + 1}`;
  reached[key] = (reached[key] ?? 0) + 1;
}
console.log(`Runs: ${runs}  wins: ${wins} (${((wins / runs) * 100).toFixed(1)}%)  avg actions: ${(totalActions / runs).toFixed(0)}`);
console.log('Where runs ended:');
for (const [k, v] of Object.entries(reached).sort()) console.log(`  ${k}: ${v}`);

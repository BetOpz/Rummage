/**
 * Act map generation. A map is a grid of rows (one choice per row) and
 * lanes. Each node always links to the node in its own lane in the next
 * row, so every node is reachable; some nodes also link diagonally.
 *
 *   row 0            workshops (start by building something)
 *   rows 1..n-3      random mix by config weights (no elites, shops, rests
 *                    or appraisers in row 1)
 *   row n-2          rest or master workshop (big blueprint + hazard)
 *   row n-1          the boss (a single node)
 *
 * With `noWorkshops` (scrapbook runs, where items come from found parts)
 * row 0 is duels and row n-2 is rest or elite.
 */

import type { MapConfig } from '../config';
import type { Rng } from './rng';
import type { MapNode, MapState, NodeType } from './types';

export function generateMap(act: number, cfg: MapConfig, rng: Rng, noWorkshops = false): MapState {
  const rowCount = Math.max(3, cfg.rows);
  const width = Math.max(1, cfg.width);
  const rows: MapNode[][] = [];

  for (let r = 0; r < rowCount; r++) {
    const isBoss = r === rowCount - 1;
    const cols = isBoss ? 1 : width;
    const row: MapNode[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ id: `a${act}r${r}c${c}`, row: r, col: c, type: nodeType(r, rowCount, c, cfg, rng, noWorkshops), next: [] });
    }
    rows.push(row);
  }

  for (let r = 0; r < rowCount - 1; r++) {
    const next = rows[r + 1];
    for (const node of rows[r]) {
      if (next.length === 1) {
        node.next = [next[0].id];
        continue;
      }
      node.next = [next[node.col].id];
      // Sometimes add a diagonal link to a neighbouring lane.
      const neighbours = [node.col - 1, node.col + 1].filter((c) => c >= 0 && c < next.length);
      if (neighbours.length > 0 && rng.float() < 0.5) node.next.push(next[rng.pick(neighbours)].id);
    }
  }

  return { act, rows, current: null, visited: [] };
}

function nodeType(row: number, rowCount: number, col: number, cfg: MapConfig, rng: Rng, noWorkshops: boolean): NodeType {
  if (row === rowCount - 1) return 'boss';
  if (row === 0) return noWorkshops ? 'battle' : 'workshop';
  if (row === rowCount - 2) return col % 2 === 0 ? 'rest' : noWorkshops ? 'elite' : 'masterWorkshop';
  // Saves from before appraisers existed have no weight for them.
  const w = { ...cfg.weights, appraiser: cfg.weights.appraiser ?? 0 };
  if (noWorkshops) w.workshop = 0;
  // Appraisers value lots, which only scrapbook runs have.
  else w.appraiser = 0;
  if (row === 1) {
    w.elite = 0;
    w.shop = 0;
    w.rest = 0;
    w.appraiser = 0;
  }
  const types = Object.keys(w) as (keyof typeof w)[];
  return rng.weightedPick(types, (t) => w[t]);
}

export function findNode(map: MapState, id: string): MapNode | undefined {
  for (const row of map.rows) {
    const n = row.find((x) => x.id === id);
    if (n) return n;
  }
  return undefined;
}

/** Nodes the player may move to next. */
export function reachableNodes(map: MapState): MapNode[] {
  if (map.current === null) return map.rows[0];
  const here = findNode(map, map.current);
  if (!here) return [];
  return here.next.map((id) => findNode(map, id)!).filter(Boolean);
}

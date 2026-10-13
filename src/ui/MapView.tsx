import { type MapNode, type NodeType, reachableNodes } from '../engine';
import { useGame } from './context';

export const NODE_INFO: Record<NodeType, { label: string; glyph: string; text: string }> = {
  workshop: { label: 'Workshop', glyph: 'W', text: 'Rummy round: build a blueprint into an item.' },
  masterWorkshop: { label: 'Master Workshop', glyph: 'M', text: 'One big blueprint with a hazard. Builds a stronger item.' },
  battle: { label: 'Battle', glyph: 'B', text: 'Fight with your item cards. Win currency and parts.' },
  elite: { label: 'Elite', glyph: 'E', text: 'A tough fight with bigger rewards.' },
  shop: { label: 'Shop', glyph: '$', text: 'Buy parts, specials and deck thinning.' },
  rest: { label: 'Rest', glyph: 'R', text: 'Heal, or repair a worn item.' },
  boss: { label: 'Boss', glyph: '!', text: 'Beat it to finish the act.' },
};

const CELL_W = 120;
const CELL_H = 74;

export function MapView() {
  const { state, act, playerId } = useGame();
  const map = state.map!;
  const reachable = new Set(reachableNodes(map).map((n) => n.id));
  const width = Math.max(...map.rows.map((r) => r.length));
  const viewW = width * CELL_W;
  const viewH = map.rows.length * CELL_H;

  const pos = (n: MapNode) => {
    const rowLen = map.rows[n.row].length;
    const x = rowLen === 1 ? viewW / 2 : (n.col + 0.5) * CELL_W;
    return { x, y: (n.row + 0.5) * CELL_H };
  };
  const all = map.rows.flat();
  const byId = new Map(all.map((n) => [n.id, n]));

  return (
    <div className="panel map-panel">
      <div className="map-head">
        <h2>Act {map.act + 1}</h2>
        <span className="muted">Pick your next stop. Lit stops are reachable from where you are.</span>
      </div>
      <div className="map-scroll">
        <div className="map" style={{ width: viewW, height: viewH }}>
          <svg className="map-lines" viewBox={`0 0 ${viewW} ${viewH}`} width={viewW} height={viewH} aria-hidden="true">
            {all.flatMap((n) =>
              n.next.map((id) => {
                const a = pos(n);
                const b = pos(byId.get(id)!);
                const walked = map.visited.includes(n.id) && map.visited.includes(id);
                return <line key={`${n.id}-${id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={walked ? 'walked' : ''} />;
              }),
            )}
          </svg>
          {all.map((n) => {
            const { x, y } = pos(n);
            const info = NODE_INFO[n.type];
            const classes = ['map-node', n.type];
            if (reachable.has(n.id)) classes.push('reachable');
            if (map.visited.includes(n.id)) classes.push('visited');
            if (map.current === n.id) classes.push('current');
            return (
              <button
                key={n.id}
                className={classes.join(' ')}
                style={{ left: x, top: y }}
                disabled={!reachable.has(n.id)}
                title={`${info.label}: ${info.text}`}
                onClick={() => act({ type: 'CHOOSE_NODE', playerId, nodeId: n.id })}
              >
                <span className="glyph">{info.glyph}</span>
                <span className="node-label">{info.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <ul className="map-legend">
        {(Object.keys(NODE_INFO) as NodeType[]).map((t) => (
          <li key={t}>
            <span className={`glyph-chip ${t}`}>{NODE_INFO[t].glyph}</span> <b>{NODE_INFO[t].label}</b>{' '}
            <span className="muted">{NODE_INFO[t].text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

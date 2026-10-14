import { appraisalCost, lotsAhead } from '../engine';
import { useGame } from './context';
import { LotCard } from './LotView';
import { NODE_INFO } from './MapView';

/** Appraiser stop: pay to have any lot further along this act fully itemised. */
export function AppraiserView() {
  const { state, me, engine, act, playerId } = useGame();
  // The next few rows and the boss: further lots are a long way off.
  const here = state.map!.rows.flat().find((n) => n.id === state.map!.current);
  const near = (here?.row ?? -1) + 3;
  const ahead = lotsAhead(state).filter((n) => n.row <= near || n.type === 'boss');
  const per = state.config.scrapbook.appraisePerLevel;
  const minionNames = (ids: string[]) => ids.map((id) => engine.content.minions.find((m) => m.id === id)?.name ?? id).join(' & ');
  return (
    <div className="panel appraiser">
      <div className="map-head">
        <h2>The Appraiser</h2>
        <span className="muted">
          “Let me take a look.” Pay {per} credits per catalogue level to have a lot fully itemised. You have{' '}
          <b>{me.currency}</b> credits.
        </span>
      </div>
      {ahead.length === 0 && <p className="muted">There are no lots left ahead in this act.</p>}
      <div className="lot-grid">
        {ahead.map((n) => {
          const lot = n.encounter!.lot!;
          const cost = appraisalCost(state, engine.content, me, lot);
          return (
            <div key={n.id} className="lot-stop">
              <div className="lot-stop-head">
                <span className={`glyph-chip ${n.type}`}>{NODE_INFO[n.type].glyph}</span>
                <span>
                  {NODE_INFO[n.type].label} vs <b>{minionNames(n.encounter!.minions)}</b>{' '}
                  <span className="muted">(row {n.row + 1})</span>
                </span>
              </div>
              <LotCard lot={lot} />
              <button
                className="primary"
                disabled={cost === 0 || cost > me.currency}
                onClick={() => act({ type: 'APPRAISE', playerId, nodeId: n.id })}
              >
                {cost === 0 ? 'Fully itemised' : `Itemise it for ${cost} credits`}
              </button>
            </div>
          );
        })}
      </div>
      <div className="actions">
        <button onClick={() => act({ type: 'LEAVE_APPRAISER', playerId })}>Back to the map</button>
      </div>
    </div>
  );
}

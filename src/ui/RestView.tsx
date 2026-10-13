import { useGame } from './context';
import { ItemChip } from './ItemChip';

export function RestView() {
  const { state, me, engine, act, playerId } = useGame();
  const heal = Math.round(me.maxHp * state.config.battle.restHealFraction);
  const repairable = me.items.filter((it) => {
    const max = engine.content.items.find((d) => d.id === it.itemId)?.battle?.uses;
    return max !== undefined && it.usesLeft !== null && it.usesLeft < max;
  });
  return (
    <div className="panel summary">
      <h2>Rest</h2>
      <p className="muted">Do one thing, then head back to the map.</p>
      <div className="actions">
        <button className="primary" onClick={() => act({ type: 'REST', playerId, choice: 'heal' })}>
          Heal {heal} HP ({me.hp}/{me.maxHp})
        </button>
      </div>
      <h3>Or repair an item</h3>
      {repairable.length === 0 ? (
        <p className="muted">Nothing needs repairing.</p>
      ) : (
        <ul className="repair-list">
          {repairable.map((it) => (
            <li key={it.uid}>
              <ItemChip item={it} />{' '}
              <button onClick={() => act({ type: 'REST', playerId, choice: 'repair', itemUid: it.uid })}>Repair to full</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

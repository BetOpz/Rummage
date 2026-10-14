import { useGame } from './context';
import { ItemChip } from './ItemChip';

export function RestView() {
  const { state, me, engine, act, playerId } = useGame();

  if (state.config.battleStyle === 'rummy') {
    const flat = me.items.filter((it) => {
      const g = engine.content.items.find((d) => d.id === it.itemId)?.gadget;
      return g && (it.charges ?? 0) < g.charges;
    });
    return (
      <div className="panel summary">
        <h2>Rest</h2>
        <p className="muted">Recharge one gadget for free, then head back to the map.</p>
        {flat.length === 0 ? (
          <p className="muted">All your gadgets are fully charged.</p>
        ) : (
          <ul className="repair-list">
            {flat.map((it) => {
              const g = engine.content.items.find((d) => d.id === it.itemId)!.gadget!;
              return (
                <li key={it.uid}>
                  <ItemChip item={it} />{' '}
                  <button className="primary" onClick={() => act({ type: 'REST', playerId, choice: 'recharge', itemUid: it.uid })}>
                    {g.rechargeName} for free
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button onClick={() => act({ type: 'REST', playerId, choice: 'leave' })}>Move on</button>
      </div>
    );
  }

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

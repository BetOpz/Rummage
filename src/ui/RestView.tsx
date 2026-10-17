import { maxCharges } from '../engine';
import { useGame } from './context';
import { UpgradePanel } from './UpgradePanel';
import { ItemChip } from './ItemChip';
import { GadgetList } from './Gadgets';

export function RestView() {
  const { state, me, engine, act, playerId } = useGame();

  if (state.config.battleStyle === 'rummy') {
    const flat = me.items.filter((it) => (it.charges ?? 0) < (maxCharges(engine.content, state.config, it, me) ?? 0));
    const free = state.restRecharges;
    return (
      <div className="panel summary">
        <h2>Rest</h2>
        <p className="muted">
          Recharge {free === 1 ? 'one gadget' : `${free} gadgets`} for free (the last one ends your rest), or upgrade items at the bench
          below first.
        </p>
        {flat.length === 0 ? (
          <p className="muted">All your gadgets are fully charged.</p>
        ) : (
          <ul className="repair-list">
            {flat.map((it) => {
              const g = engine.content.items.find((d) => d.id === it.itemId)!.gadget!;
              return (
                <li key={it.uid}>
                  <ItemChip item={it} />{' '}
                  <button className="primary" disabled={free <= 0} onClick={() => act({ type: 'REST', playerId, choice: 'recharge', itemUid: it.uid })}>
                    {g.rechargeName} for free
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <GadgetList title="Scrapbook gadgets" compact />
        <UpgradePanel />
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

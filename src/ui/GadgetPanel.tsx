import { itemMaxCharges } from '../engine';
import { useGame } from './context';

export function Charges({ have, max }: { have: number; max: number }) {
  return (
    <span className="charges" title={`${have} of ${max} charges`}>
      {'●'.repeat(have)}
      {'○'.repeat(Math.max(0, max - have))}
    </span>
  );
}

/** Gadgets and their charges, with paid recharging (map and shop). */
export function GadgetPanel() {
  const { state, me, engine, act, playerId } = useGame();
  const gadgets = me.items
    .map((it) => ({ it, g: engine.content.items.find((d) => d.id === it.itemId)?.gadget, name: engine.content.items.find((d) => d.id === it.itemId)?.name }))
    .filter((x) => x.g);
  if (gadgets.length === 0) return null;
  return (
    <div className="panel gadgets">
      <b>Your gadgets</b>{' '}
      <span className="muted">Charges don't refill after a fight. Recharge here for credits, or for free at a rest stop.</span>
      <ul className="gadget-rows">
        {gadgets.map(({ it, g, name }) => {
          const max = itemMaxCharges(engine.content, state.config, it) ?? 0;
          const full = (it.charges ?? 0) >= max;
          return (
            <li key={it.uid}>
              <b>
                {it.material} {name}
              </b>{' '}
              <span className="muted">({g!.name})</span> <Charges have={it.charges ?? 0} max={max} />{' '}
              <span className="muted small-text">{g!.text}</span>
              <span className="spacer" />
              <button disabled={full || me.currency < g!.rechargeCost} onClick={() => act({ type: 'RECHARGE', playerId, itemUid: it.uid })}>
                {full ? 'Full' : `${g!.rechargeName} (${g!.rechargeCost} credits)`}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

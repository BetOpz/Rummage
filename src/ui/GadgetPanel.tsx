import { useGame } from './context';

/** Gadgets and their charges, with paid recharging (map and shop). */
export function GadgetPanel() {
  const { me, engine, act, playerId } = useGame();
  const gadgets = me.items
    .map((it) => ({ it, g: engine.content.items.find((d) => d.id === it.itemId)?.gadget }))
    .filter((x) => x.g);
  if (gadgets.length === 0) return null;
  return (
    <div className="panel gadgets">
      <b>Your gadgets</b>{' '}
      <span className="muted">Charges don't refill after a fight. Recharge here for credits, or for free at a rest stop.</span>
      <ul className="gadget-rows">
        {gadgets.map(({ it, g }) => {
          const full = (it.charges ?? 0) >= g!.charges;
          return (
            <li key={it.uid}>
              <b>{g!.name}</b> <span className="charges">{'●'.repeat(it.charges ?? 0)}{'○'.repeat(Math.max(0, g!.charges - (it.charges ?? 0)))}</span>{' '}
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

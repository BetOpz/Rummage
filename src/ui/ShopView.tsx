import { useState } from 'react';
import { type ShopSlot, partName } from '../engine';
import { CardView } from './CardView';
import { useGame } from './context';
import { GadgetPanel } from './GadgetPanel';
import { UpgradePanel } from './UpgradePanel';

export function ShopView() {
  const { state, me, engine, act, playerId } = useGame();
  const shop = state.shop!;
  const [targetFor, setTargetFor] = useState<number | null>(null);
  const pools = [...engine.content.shopPools].sort((a, b) => a.tier - b.tier);
  const pool = pools.filter((p) => p.tier <= state.tier + 1).pop() ?? pools[0];

  const label = (slot: ShopSlot) => {
    if (slot.kind === 'part') {
      const cat = engine.content.categories.find((c) => c.id === slot.category);
      return (
        <>
          <span className="swatch" style={{ background: cat?.color }} /> {partName(engine.content, slot.category!, slot.gauge!)}{' '}
          <b>({slot.gauge})</b>
        </>
      );
    }
    if (slot.kind === 'special') {
      const def = engine.content.specials.find((s) => s.id === slot.specialId);
      return (
        <>
          <b>{def?.name}</b> <span className="muted">{def?.text}</span>
        </>
      );
    }
    if (slot.kind === 'tool') {
      const tool = engine.content.tools.find((t) => t.id === slot.toolId);
      return (
        <>
          <b>{tool?.name}</b> <span className="muted">{tool?.text} You hold {me.tools[slot.toolId!] ?? 0}.</span>
        </>
      );
    }
    const svc = pool?.services.find((s) => s.id === slot.serviceId);
    return (
      <>
        <b>{svc?.name}</b> <span className="muted">{svc?.text}</span>
      </>
    );
  };

  const buy = (i: number) => {
    const slot = shop.slots[i];
    const svc = slot.kind === 'service' ? pool?.services.find((s) => s.id === slot.serviceId) : null;
    if (svc?.target === 'deckCard') {
      setTargetFor(i);
      return;
    }
    act({ type: 'SHOP_BUY', playerId, slot: i });
  };

  return (
    <div className="panel shop">
      <h2>Shop</h2>
      <p className="muted">
        You have <b>{me.currency}</b> credits. Bought cards go into your deck.
      </p>
      <ul className="shop-slots">
        {shop.slots.map((slot, i) => (
          <li key={i} className={slot.sold ? 'sold' : ''}>
            <span className="price">{slot.price}</span>
            <span className="slot-label">{label(slot)}</span>
            <button disabled={slot.sold || slot.price > me.currency} onClick={() => buy(i)}>
              {slot.sold ? 'Sold' : 'Buy'}
            </button>
          </li>
        ))}
      </ul>
      {targetFor !== null && (
        <div className="panel">
          <b>Choose a card to remove from your deck permanently:</b> <button onClick={() => setTargetFor(null)}>Cancel</button>
          <div className="cards small">
            {sortedDeck(state, me.deck).map((id) => (
              <CardView
                key={id}
                id={id}
                onClick={() => {
                  if (act({ type: 'SHOP_BUY', playerId, slot: targetFor, targetId: id })) setTargetFor(null);
                }}
              />
            ))}
          </div>
        </div>
      )}
      <div className="actions">
        <button disabled={me.currency < state.config.shopRerollCost} onClick={() => act({ type: 'SHOP_REROLL', playerId })}>
          Reroll ({state.config.shopRerollCost})
        </button>
        <button className="primary" onClick={() => act({ type: 'LEAVE_SHOP', playerId })}>
          Next round
        </button>
      </div>
      {state.config.battleStyle === 'rummy' && <GadgetPanel />}
      <UpgradePanel />
      <DeckList />
    </div>
  );
}

function sortedDeck(state: ReturnType<typeof useGame>['state'], ids: string[]) {
  return [...ids].sort((a, b) => {
    const ca = state.cards[a];
    const cb = state.cards[b];
    if (ca.kind !== cb.kind) return ca.kind === 'part' ? -1 : 1;
    if (ca.kind === 'part' && cb.kind === 'part') return ca.category.localeCompare(cb.category) || ca.gauge - cb.gauge;
    return 0;
  });
}

function DeckList() {
  const { state, me } = useGame();
  return (
    <details>
      <summary>Your deck ({me.deck.length} cards)</summary>
      <div className="cards small">
        {sortedDeck(state, me.deck).map((id) => (
          <CardView key={id} id={id} />
        ))}
      </div>
    </details>
  );
}

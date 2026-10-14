import { useState } from 'react';
import { type CardId, checkUpgrade, materialName } from '../engine';
import { CardView } from './CardView';
import { useGame } from './context';
import { ItemChip } from './ItemChip';

/** Upgrade bench: spend better-material parts (or a gem) and credits to raise an item one grade. */
export function UpgradePanel() {
  const { state, me, engine, act, playerId } = useGame();
  const [itemUid, setItemUid] = useState<string | null>(null);
  const [picked, setPicked] = useState<CardId[]>([]);
  if (me.items.length === 0) return null;

  const item = me.items.find((i) => i.uid === itemUid) ?? null;
  const nextGrade = item ? item.grade + 1 : 0;
  const gradeOfCard = (id: CardId) => {
    const c = state.cards[id];
    if (!c) return 0;
    if (c.kind === 'part') return engine.content.categories.find((x) => x.id === c.category)?.grade ?? 0;
    return engine.content.specials.find((s) => s.id === c.specialId)?.gradeBonus ? 99 : 0;
  };
  const eligible = item ? me.deck.filter((id) => gradeOfCard(id) >= nextGrade) : [];
  const check = item && picked.length > 0 ? checkUpgrade(state, engine.content, state.config, item, picked) : null;
  const need = state.config.quality.upgradeParts;

  return (
    <div className="panel upgrade">
      <b>Upgrade bench</b>{' '}
      <span className="muted">
        Raise an item one grade with {need} parts of the next material or better, or with a single gem. Higher grades give
        gadgets more charges and stronger effects.
      </span>
      <div className="upgrade-items">
        {me.items.map((it) => (
          <button
            key={it.uid}
            className={it.uid === itemUid ? 'active' : ''}
            onClick={() => {
              setItemUid(it.uid === itemUid ? null : it.uid);
              setPicked([]);
            }}
          >
            <ItemChip item={it} />
          </button>
        ))}
      </div>
      {item && (
        <>
          <div className="muted small-text">
            To make it {materialName(engine.content, state.config, nextGrade)}: pick {need} {materialName(engine.content, state.config, nextGrade)} parts
            or better, or one gem.
          </div>
          {eligible.length === 0 ? (
            <div className="sort-message">You have no parts good enough yet.</div>
          ) : (
            <div className="cards small">
              {eligible.map((id) => (
                <CardView
                  key={id}
                  id={id}
                  selected={picked.includes(id)}
                  onClick={() => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
                />
              ))}
            </div>
          )}
          <button
            className="primary"
            disabled={!check?.ok || me.currency < (check?.credits ?? 0)}
            onClick={() => {
              if (act({ type: 'UPGRADE_ITEM', playerId, itemUid: item.uid, cardIds: picked })) setPicked([]);
            }}
          >
            {check?.ok
              ? `Upgrade to ${materialName(engine.content, state.config, check.newGrade)} (${check.credits} credits, uses ${picked.length} card${picked.length === 1 ? '' : 's'})`
              : check?.reason ?? 'Pick cards to upgrade with'}
          </button>
        </>
      )}
    </div>
  );
}

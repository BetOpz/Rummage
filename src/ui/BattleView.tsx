import { useState } from 'react';
import { type BattleCard, type EnemyIntent, battleCardDef, currentIntent, incomingDamage } from '../engine';
import { useGame } from './context';

function intentText(i: EnemyIntent | null): string {
  if (!i) return '…';
  if (i.type === 'attack') return (i.hits ?? 1) > 1 ? `Attack ${i.damage} × ${i.hits}` : `Attack ${i.damage}`;
  if (i.type === 'block') return `Block ${i.amount}`;
  return `Attack ${i.damage}, block ${i.block}`;
}

function HpBar({ hp, max }: { hp: number; max: number }) {
  return (
    <span className="hpbar">
      <span style={{ width: `${Math.max(0, (hp / max) * 100)}%` }} />
    </span>
  );
}

export function BattleView() {
  const { state, me, engine, act, playerId } = useGame();
  const battle = state.battle!;
  const [aiming, setAiming] = useState<string | null>(null);
  const living = battle.enemies.map((e, i) => ({ e, i })).filter(({ e }) => e.hp > 0);
  const incoming = incomingDamage(engine.content, battle);

  const play = (card: BattleCard) => {
    const info = battleCardDef(engine.content, me, card);
    if (!info) return;
    if (info.def.targeted && living.length > 1) {
      setAiming(aiming === card.uid ? null : card.uid);
      return;
    }
    act({ type: 'PLAY_CARD', playerId, cardUid: card.uid, target: info.def.targeted ? living[0]?.i : undefined });
  };

  const title = battle.kind === 'boss' ? 'Boss fight' : battle.kind === 'elite' ? 'Elite fight' : 'Battle';

  return (
    <div className="battle">
      <div className="panel">
        <div className="map-head">
          <h2>{title}</h2>
          <span className="muted">Turn {battle.turn}</span>
        </div>
        <div className="enemies">
          {battle.enemies.map((e, i) => {
            const dead = e.hp <= 0;
            const intent = currentIntent(engine.content, e);
            const clickable = !!aiming && !dead;
            return (
              <div
                key={i}
                className={`enemy ${dead ? 'dead' : ''} ${clickable ? 'aimable' : ''}`}
                onClick={
                  clickable
                    ? () => {
                        act({ type: 'PLAY_CARD', playerId, cardUid: aiming!, target: i });
                        setAiming(null);
                      }
                    : undefined
                }
              >
                <b>{e.name}</b>
                <div className="stat-line">
                  <HpBar hp={e.hp} max={e.maxHp} /> {e.hp}/{e.maxHp}
                </div>
                {e.block > 0 && <div className="block-badge">Block {e.block}</div>}
                {!dead && <div className={`intent ${intent?.type ?? ''}`}>Next: {intentText(intent)}</div>}
                {dead && <div className="muted">Defeated</div>}
              </div>
            );
          })}
        </div>
        {aiming && <div className="targeting">Choose an enemy to target. <button onClick={() => setAiming(null)}>Cancel</button></div>}
      </div>

      <div className="panel">
        <div className="player-line">
          <span>
            <b>You</b> <HpBar hp={me.hp} max={me.maxHp} /> {me.hp}/{me.maxHp}
          </span>
          <span className="block-badge">Block {battle.block}</span>
          <span className={incoming > battle.block ? 'warn' : 'muted'}>Incoming {incoming}</span>
          <span className="energy">
            Energy <b>{battle.energy}</b>/{state.config.battle.energy}
          </span>
          <span className="spacer" />
          <span className="muted">
            Draw {battle.drawPile.length} · Discard {battle.discard.length}
          </span>
        </div>
        <div className="cards">
          {battle.hand.map((card) => {
            const info = battleCardDef(engine.content, me, card);
            if (!info) return null;
            const item = card.source === 'item' ? me.items.find((i) => i.uid === card.ref) : undefined;
            const affordable = info.def.cost <= battle.energy;
            return (
              <button
                key={card.uid}
                className={`bcard ${card.source} ${aiming === card.uid ? 'selected' : ''}`}
                disabled={!affordable}
                onClick={() => play(card)}
                title={info.def.text}
              >
                <span className="cost">{info.def.cost}</span>
                <span className="bname">{info.def.name}</span>
                <span className="btext">{info.def.text}</span>
                <span className="bfoot">
                  {item ? `Item${item.level > 1 ? ` L${item.level}` : ''}` : 'Starter'}
                  {item?.usesLeft != null && ` · ${item.usesLeft} uses`}
                </span>
              </button>
            );
          })}
          {battle.hand.length === 0 && <div className="muted">No cards in hand.</div>}
        </div>
        <div className="actions">
          <button className="primary" onClick={() => act({ type: 'END_TURN', playerId })}>
            End turn
          </button>
          <span className="muted">Item levels add the “per level” bonus. Items with uses break when they reach 0.</span>
        </div>
      </div>
    </div>
  );
}

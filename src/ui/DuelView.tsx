import { useState } from 'react';
import { type CardId, type Engine, type GameState, eligibleStakeCards, itemMaxCharges, meldHints, partName } from '../engine';
import { hintText } from './BlueprintPanel';
import { Charges } from './GadgetPanel';
import { CardView } from './CardView';
import { LotPanel } from './LotView';
import { useGame } from './context';
import { ReqLabel } from './ReqLabel';

const KIND_TITLE = { battle: 'Duel', elite: 'Elite duel', boss: 'Boss duel' } as const;

function sortedIds(state: GameState, ids: CardId[]): CardId[] {
  return [...ids].sort((a, b) => {
    const ca = state.cards[a];
    const cb = state.cards[b];
    if (!ca || !cb) return 0;
    if (ca.kind !== cb.kind) return ca.kind === 'part' ? -1 : 1;
    if (ca.kind === 'part' && cb.kind === 'part') return ca.category.localeCompare(cb.category) || ca.gauge - cb.gauge;
    return 0;
  });
}

/** Cheapest material first (what you'd normally stake), then by number. */
function byGrade(state: GameState, content: Engine['content'], ids: CardId[]): CardId[] {
  const g = (id: CardId) => {
    const c = state.cards[id];
    return c?.kind === 'part' ? (content.categories.find((x) => x.id === c.category)?.grade ?? 0) * 100 + c.gauge : 10_000;
  };
  return [...ids].sort((a, b) => g(a) - g(b));
}

/** Target, twists and pot: shown on every duel screen. */
function DuelHeader() {
  const { state, engine } = useGame();
  const duel = state.duel!;
  const target = engine.content.duelTargets.find((t) => t.id === duel.targetId);
  const catName = (id: string) => engine.content.categories.find((c) => c.id === id)?.name ?? id;
  return (
    <div className="panel duel-head">
      <div className="map-head">
        <h2>
          {KIND_TITLE[duel.kind]} vs {duel.opponents.map((o) => o.name).join(' & ')}
        </h2>
      </div>
      <div className="duel-target">
        <span className="eyebrow">First to go out wins</span>{' '}
        <b>{target?.name}</b>: you need all of these
        <ul className="reqs">
          {duel.requirements.map((r, i) => (
            <li key={i}>
              <ReqLabel req={r} />
            </li>
          ))}
        </ul>
      </div>
      {duel.modifiers.map((m, i) => {
        const def = engine.content.bossModifiers.find((b) => b.id === m.modifierId);
        const cat = typeof m.params.category === 'string' ? ` (${catName(m.params.category)})` : '';
        return (
          <div key={i} className="boss-mod">
            Twist: <b>{def?.name}</b>
            {cat} — {def?.text}
          </div>
        );
      })}
      {duel.lot && <LotPanel lot={duel.lot} mode="view" />}
      <div className="pot">
        <span className="muted">Stakes in the pot ({duel.pot.length}):</span>
        <div className="cards small">
          {duel.pot.map((id) => (
            <CardView key={id} id={id} badge={duel.playerStake.includes(id) ? 'yours' : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function DuelView() {
  const { state } = useGame();
  if (state.phase === 'duelAnte') return <DuelAnte />;
  if (state.phase === 'duelResult') return <DuelResult />;
  return <DuelTable />;
}

function DuelAnte() {
  const { state, me, engine, act, playerId } = useGame();
  const duel = state.duel!;
  const rule = duel.stakeRule;
  const [picked, setPicked] = useState<CardId[]>([]);
  if (!rule) {
    return (
      <div className="duel">
        <DuelHeader />
        <div className="panel">
          <h3>Your stake</h3>
          <p className="muted">
            Choose a card from your parts deck to put in the pot. Win and you keep it plus everything else in the pot. Lose and
            it's gone for good.
          </p>
          <div className="cards small">
            {sortedIds(state, me.deck).map((id) => (
              <CardView key={id} id={id} onClick={() => act({ type: 'DUEL_STAKE', playerId, cardIds: [id] })} title="Stake this card" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  const mat = engine.content.categories.find((c) => c.id === rule.category)?.name ?? rule.category;
  const eligible = eligibleStakeCards(state, engine.content, me, rule);
  const isBoss = duel.kind === 'boss';
  const short = eligible.length < rule.count;
  const allowed = new Set(short && isBoss ? me.deck.filter((id) => state.cards[id]?.kind === 'part') : eligible);
  const toggle = (id: CardId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < rule.count ? [...p, id] : p));
  return (
    <div className="duel">
      <DuelHeader />
      <div className="panel">
        <h3>Your stake</h3>
        <p>
          Everyone at the table stakes{' '}
          <b>
            {rule.count} × {mat}
          </b>{' '}
          parts. You must match it with {mat} or better. Win and you take the lot plus every stake. Lose and your stake is gone
          for good.
        </p>
        {short && !isBoss && (
          <p className="shape-warning">
            You only have {eligible.length} {mat}-or-better part{eligible.length === 1 ? '' : 's'}, so you can't match the stake.
            Walk past this lot.
          </p>
        )}
        {short && isBoss && <p className="shape-warning">You can't match the boss's stake, so any {rule.count} parts will do.</p>}
        <div className="actions">
          <button className="primary" disabled={picked.length !== rule.count} onClick={() => act({ type: 'DUEL_STAKE', playerId, cardIds: picked })}>
            Stake {picked.length}/{rule.count}
          </button>
          {!isBoss && <button onClick={() => act({ type: 'DUEL_WALK_AWAY', playerId })}>Walk past</button>}
        </div>
        <div className="cards small">
          {byGrade(state, engine.content, me.deck).map((id) => {
            const ok = allowed.has(id);
            return (
              <CardView
                key={id}
                id={id}
                dim={!ok}
                selected={picked.includes(id)}
                onClick={ok ? () => toggle(id) : undefined}
                title={ok ? 'Stake this card' : `Not ${mat} or better`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DuelTable() {
  const { state, me, engine, act, playerId } = useGame();
  const duel = state.duel!;
  const [selected, setSelected] = useState<CardId[]>([]);
  const [aiming, setAiming] = useState<string | null>(null);
  const [noOut, setNoOut] = useState(false);
  const catName = (id: string) => engine.content.categories.find((c) => c.id === id)?.name ?? id;

  const sel = selected.filter((id) => duel.hand.includes(id));
  const toggle = (id: CardId) => {
    setNoOut(false);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const out = sel.length > 0 ? engine.suggestDuelOut(state, sel) : null;
  const hints = sel.length > 0 && !out ? meldHints(engine, state, duel.requirements, duel.rules, sel) : null;
  const meldCards = duel.requirements.map((_, i) => out?.[i] ?? hints?.[i]?.cardIds ?? []);
  const inMeld = (id: CardId) => meldCards.findIndex((m) => m.includes(id));
  const drawsLeft = duel.rules.drawLimit - duel.drawsTaken;
  const top = duel.discard.at(-1);
  const phase = duel.turnPhase;

  const gadgets = me.items
    .map((it) => ({ it, g: engine.content.items.find((d) => d.id === it.itemId)?.gadget }))
    .filter((x) => x.g);

  const useGadget = (uid: string, needsTarget: boolean) => {
    if (needsTarget) {
      setAiming(aiming === uid ? null : uid);
      return;
    }
    act({ type: 'USE_GADGET', playerId, itemUid: uid });
  };

  return (
    <div className="duel">
      <DuelHeader />

      <div className="panel">
        <div className="opponents">
          {duel.opponents.map((o, i) => (
            <div
              key={i}
              className={`opponent ${aiming ? 'aimable' : ''}`}
              onClick={
                aiming
                  ? () => {
                      act({ type: 'USE_GADGET', playerId, itemUid: aiming, target: i });
                      setAiming(null);
                    }
                  : undefined
              }
            >
              <div className="opp-head">
                <b>{o.name}</b>
                <span className="muted">{o.hand.length} cards</span>
                {o.skip > 0 && <span className="block-badge">Frozen</span>}
              </div>
              {o.revealed ? (
                <div className="cards small">
                  {sortedIds(state, o.hand).map((id) => (
                    <CardView key={id} id={id} />
                  ))}
                </div>
              ) : (
                <div className="card-backs">
                  {o.hand.map((id) => (
                    <span key={id} className="card-back-mini" />
                  ))}
                </div>
              )}
              <div className="muted small-text">{o.lastAction || 'Waiting…'}</div>
            </div>
          ))}
        </div>
        {aiming && (
          <div className="targeting">
            Choose an opponent. <button onClick={() => setAiming(null)}>Cancel</button>
          </div>
        )}
      </div>

      <div className="panel piles">
        <div className="pile">
          <div className="pile-label">Your deck ({duel.drawPile.length})</div>
          <button className="card back clickable" disabled={phase !== 'draw' || drawsLeft <= 0} onClick={() => act({ type: 'DUEL_DRAW', playerId, source: 'deck' })}>
            Draw
          </button>
        </div>
        <div className="pile">
          <div className="pile-label">Discard ({duel.discard.length})</div>
          {top ? (
            <CardView
              id={top}
              onClick={phase === 'draw' && duel.rules.allowDiscardDraw ? () => act({ type: 'DUEL_DRAW', playerId, source: 'discard' }) : undefined}
              title={duel.rules.allowDiscardDraw ? 'Take from the discard pile' : 'Discard draws are banned in this fight'}
            />
          ) : (
            <div className="card empty">empty</div>
          )}
        </div>
        <div className="turn-info">
          <div>
            Draws left: <b className={drawsLeft <= 2 ? 'warn' : ''}>{drawsLeft}</b>/{duel.rules.drawLimit}
          </div>
          <div className="muted">
            {phase === 'draw'
              ? 'Draw from your deck or take the discard.'
              : 'Go out if you can, otherwise discard a card. Then the opponents play.'}
          </div>
          <div className="muted small-text">If your draws run out, the closest hand wins the pot.</div>
        </div>
      </div>

      {gadgets.length > 0 && (
        <div className="panel gadgets">
          <b>Gadgets</b> <span className="muted">Charges don't refill after a fight. Recharge costs credits.</span>
          <div className="gadget-list">
            {gadgets.map(({ it, g }) => (
              <button
                key={it.uid}
                className={`gadget ${aiming === it.uid ? 'selected' : ''}`}
                disabled={(it.charges ?? 0) <= 0}
                onClick={() => useGadget(it.uid, g!.target === 'opponent')}
                title={g!.text}
              >
                <b>{g!.name}</b> <Charges have={it.charges ?? 0} max={itemMaxCharges(engine.content, state.config, it) ?? 0} />
                <span className="small-text muted">{it.material} {engine.content.items.find((d) => d.id === it.itemId)?.name}</span>
                <span className="small-text muted">{g!.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel hand">
        <div className="hand-head">
          <b>Your hand</b> <span className="muted">({duel.hand.length} cards) Tap cards to go out with.</span>
        </div>
        <div className="cards">
          {sortedIds(state, duel.hand).map((id) => {
            const m = inMeld(id);
            return <CardView key={id} id={id} selected={sel.includes(id)} badge={m >= 0 ? `M${m + 1}` : undefined} onClick={() => toggle(id)} />;
          })}
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={phase !== 'main' || sel.length !== 1}
            onClick={() => {
              if (act({ type: 'DUEL_DISCARD', playerId, cardId: sel[0] })) setSelected([]);
            }}
          >
            Discard selected
          </button>
          <button
            onClick={() => {
              const found = engine.suggestDuelOut(state);
              setNoOut(!found);
              if (found) setSelected(found.flat());
            }}
          >
            Find a way out
          </button>
          {sel.length > 0 && <button onClick={() => setSelected([])}>Clear selection</button>}
        </div>
        {noOut && <div className="sort-message">You can't go out yet.</div>}
      </div>

      <div className={`panel build ${out ? 'ready' : ''}`}>
        <div className="hand-head">
          <b>Go out</b>
          <span className="muted small-text">{sel.length === 0 ? 'Select cards in your hand.' : `${sel.length} cards selected.`}</span>
        </div>
        <div className="melds">
          {duel.requirements.map((req, i) => {
            const h = hints?.[i];
            const done = !!out || (h ? h.filled >= req.size : false);
            return (
              <div key={i} className={`meld ${sel.length === 0 ? '' : done ? 'ok' : 'bad'}`}>
                <div className="meld-head">
                  <b>M{i + 1}</b> <ReqLabel req={req} compact />
                </div>
                <div className="cards small">
                  {meldCards[i].map((id) => (
                    <CardView key={id} id={id} onClick={() => toggle(id)} />
                  ))}
                </div>
                <div className="meld-status">{sel.length === 0 ? '' : done ? '✓ complete' : h ? hintText(h, catName) : ''}</div>
              </div>
            );
          })}
        </div>
        <button
          className="primary big"
          disabled={!out}
          onClick={() => {
            if (out && act({ type: 'DUEL_GO_OUT', playerId, groups: out })) setSelected([]);
          }}
        >
          Go out and take the pot!
        </button>
      </div>
    </div>
  );
}

function DuelResult() {
  const { state, me, engine, act, playerId } = useGame();
  const duel = state.duel!;
  const r = duel.result!;
  const winnerName = duel.winner === 'player' ? 'You' : duel.opponents[duel.winner as number]?.name;
  return (
    <div className="duel">
      <div className={`panel summary ${r.won ? 'won' : 'lost'}`}>
        <h2>{r.won ? `You win the ${duel.lot?.name ?? 'pot'}!` : `${winnerName} wins the ${duel.lot?.name ?? 'pot'}`}</h2>
        <p>{duel.endReason}</p>
        {duel.winningMelds && (
          <div className="cards small">
            {duel.winningMelds.flat().map((id) => (
              <CardView key={id} id={id} />
            ))}
          </div>
        )}
        {r.lotWon && (
          <div className="dig">
            <h3>
              You won the {r.lotWon.name}: pick {r.lotWon.picks} of its {r.lotWon.parcels} parcels
            </h3>
            <p className="muted">Next you choose your parcels. You can still use your checks on them before you choose.</p>
          </div>
        )}
        {r.won ? (
          <p>
            +<b>{r.currency}</b> credits. {duel.lot ? 'Stakes won (now in your deck)' : 'New parts in your deck'}:{' '}
            {r.wonCards.map((id) => {
              const c = state.cards[id];
              return c?.kind === 'part' ? partName(engine.content, c.category, c.gauge) + ` (${c.gauge})` : engine.content.specials.find((s) => c?.kind === 'special' && s.id === c.specialId)?.name;
            }).join(', ') || 'none'}
            .
          </p>
        ) : (
          <p>
            Your stake is lost.
            {r.lifeLost && (
              <>
                {' '}
                You lose a life (<b>{me.lives}</b> left).
              </>
            )}
          </p>
        )}
        {!r.won && r.lostStake.length > 0 && (
          <div className="cards small">
            {r.lostStake.map((id) => (
              <CardView key={id} id={id} dim />
            ))}
          </div>
        )}
        <button className="primary" onClick={() => act({ type: 'CONTINUE', playerId })}>
          {r.lotWon
            ? `Open the ${r.lotWon.name}`
            : duel.kind === 'boss' && r.won
              ? state.tier + 1 >= state.config.tiers
                ? 'Finish the run'
                : 'On to the next act'
              : 'Back to the map'}
        </button>
      </div>
    </div>
  );
}

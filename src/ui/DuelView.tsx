import { useState } from 'react';
import { type CardId, type Engine, type GameState, cardsStillNeeded, eligibleStakeCards, meldHints, partName } from '../engine';
import { hintText } from './BlueprintPanel';
import { DuelChoicePanel, GadgetList } from './Gadgets';
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

/** One-line notes on what items are doing in this duel (locks, traps, cover). */
function DuelEffects() {
  const { state } = useGame();
  const duel = state.duel!;
  const fx = duel.fx;
  const notes: string[] = [];
  if (fx.lockDiscard > 0) notes.push(`Discard pile locked for ${fx.lockDiscard} more turn${fx.lockDiscard === 1 ? '' : 's'}${fx.lockExceptYou ? ' (not for you)' : ''}`);
  if (fx.trap) notes.push(`Trap set (${fx.trap.catches} catch${fx.trap.catches === 1 ? '' : 'es'})`);
  if (fx.insured.stake) notes.push('Your stake is covered');
  if (fx.insured.life) notes.push('Your life is covered');
  if (fx.doubleDraw > 0) notes.push(`${fx.doubleDraw} more turn${fx.doubleDraw === 1 ? '' : 's'} of draw 2, discard 2`);
  if (fx.skipOwnDraw > 0) notes.push("You won't draw next turn");
  if (fx.freeUses && fx.freeUses.count > 0) notes.push(`${fx.freeUses.count} free gadget use${fx.freeUses.count === 1 ? '' : 's'}`);
  if (duel.rules.freeDiscardDraws > fx.freeDiscardUsed) notes.push(`${duel.rules.freeDiscardDraws - fx.freeDiscardUsed} free discard-pile draw${duel.rules.freeDiscardDraws - fx.freeDiscardUsed === 1 ? '' : 's'}`);
  if (notes.length === 0) return null;
  return <div className="duel-effects small-text">{notes.join(' · ')}</div>;
}

function DuelTable() {
  const { state, engine, act, playerId } = useGame();
  const duel = state.duel!;
  const [selected, setSelected] = useState<CardId[]>([]);
  const [noOut, setNoOut] = useState(false);
  const [showPile, setShowPile] = useState(false);
  const catName = (id: string) => engine.content.categories.find((c) => c.id === id)?.name ?? id;

  const sel = selected.filter((id) => duel.hand.includes(id));
  const toggle = (id: CardId) => {
    setNoOut(false);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const aside = duel.fx.setAside;
  const out = sel.length > 0 || aside.length > 0 ? engine.suggestDuelOut(state, sel) : null;
  const hints = sel.length > 0 && !out ? meldHints(engine, state, duel.requirements, duel.rules, [...sel, ...aside]) : null;
  const meldCards = duel.requirements.map((_, i) => out?.[i] ?? hints?.[i]?.cardIds ?? []);
  const inMeld = (id: CardId) => meldCards.findIndex((m) => m.includes(id));
  const drawsLeft = duel.rules.drawLimit - duel.drawsTaken;
  const phase = duel.turnPhase;
  const blocked = !!duel.choice;
  const locked = duel.fx.lockDiscard > 0 && !duel.fx.lockExceptYou;
  const canTakeDiscard = !blocked && phase === 'draw' && duel.rules.allowDiscardDraw && !locked;
  const takeAny = duel.rules.takeAnyDiscard > duel.fx.takeAnyUsed;
  const seeDiscard = Math.max(1, duel.rules.seeDiscard);
  const shownDiscard = [...duel.discard].reverse().slice(0, showPile ? undefined : seeDiscard);
  const ownTop = duel.rules.seeOwnTop > 0 ? duel.drawPile.slice(-duel.rules.seeOwnTop).reverse() : [];
  const cyclesLeft = duel.rules.extraDiscards - duel.fx.extraDiscardsUsed;
  const secondDraw = phase === 'draw' && duel.fx.drawsDue > 1 && duel.fx.drawsThisTurn > 0;

  return (
    <div className="duel">
      <DuelHeader />
      <DuelChoicePanel />

      <div className="panel">
        <div className="opponents">
          {duel.opponents.map((o, i) => (
            <div key={i} className="opponent">
              <div className="opp-head">
                <b>{o.name}</b>
                <span className="muted">{o.hand.length} cards</span>
                {o.skip > 0 && <span className="block-badge">Frozen{o.skip > 1 ? ` ×${o.skip}` : ''}</span>}
                {o.noOut > 0 && <span className="block-badge">Can't go out</span>}
                {o.discardLock > 0 && <span className="block-badge">Off the discard pile</span>}
                {duel.rules.seeOpponentProgress && (
                  <span className={`block-badge ${cardsStillNeeded(state, engine.content, engine.effects, o.hand) <= 1 ? 'warn' : ''}`}>
                    needs {cardsStillNeeded(state, engine.content, engine.effects, o.hand)}
                  </span>
                )}
              </div>
              {o.revealed ? (
                <div className="cards small">
                  {sortedIds(state, o.hand).map((id) => (
                    <CardView key={id} id={id} />
                  ))}
                </div>
              ) : (
                <div className="card-backs">
                  {o.peeked.filter((id) => o.hand.includes(id)).map((id) => (
                    <CardView key={id} id={id} />
                  ))}
                  {o.hand.filter((id) => !o.peeked.includes(id)).map((id) => (
                    <span key={id} className="card-back-mini" />
                  ))}
                </div>
              )}
              <div className="muted small-text">{o.lastAction || 'Waiting…'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel piles">
        <div className="pile">
          <div className="pile-label">Your deck ({duel.drawPile.length})</div>
          <button
            className="card back clickable"
            disabled={blocked || phase !== 'draw' || (drawsLeft <= 0 && !secondDraw)}
            onClick={() => act({ type: 'DUEL_DRAW', playerId, source: 'deck' })}
          >
            {secondDraw ? 'Draw again' : 'Draw'}
          </button>
          {ownTop.length > 0 && (
            <div className="peek">
              <span className="muted small-text">On top:</span>
              <div className="cards small">
                {ownTop.map((id) => (
                  <CardView key={id} id={id} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="pile">
          <div className="pile-label">
            Discard ({duel.discard.length}){locked && <span className="block-badge">locked</span>}
          </div>
          {shownDiscard.length > 0 ? (
            <div className="cards small discard-fan">
              {shownDiscard.map((id, i) => {
                const clickable = canTakeDiscard && (i === 0 || takeAny);
                return (
                  <CardView
                    key={id}
                    id={id}
                    dim={i > 0 && !clickable}
                    onClick={clickable ? () => act({ type: 'DUEL_DRAW', playerId, source: 'discard', cardId: i === 0 ? undefined : id }) : undefined}
                    title={clickable ? 'Take this card' : duel.rules.allowDiscardDraw ? 'The discard pile' : 'Discard draws are banned in this fight'}
                  />
                );
              })}
            </div>
          ) : (
            <div className="card empty">empty</div>
          )}
          {takeAny && duel.discard.length > seeDiscard && (
            <button className="small-text" onClick={() => setShowPile((v) => !v)}>
              {showPile ? 'Show the top only' : `See the whole pile (you can take any card ${duel.rules.takeAnyDiscard - duel.fx.takeAnyUsed}×)`}
            </button>
          )}
        </div>
        <div className="turn-info">
          <div>
            Draws left: <b className={drawsLeft <= 2 ? 'warn' : ''}>{drawsLeft}</b>/{duel.rules.drawLimit} · turn {duel.turn}
          </div>
          <div className="muted">
            {blocked
              ? 'Make your choice first.'
              : phase === 'draw'
                ? duel.fx.drawsDue > 1
                  ? `Draw ${duel.fx.drawsDue - duel.fx.drawsThisTurn} more this turn.`
                  : 'Draw from your deck or take the discard.'
                : duel.fx.discardsDue > 1
                  ? `Discard ${duel.fx.discardsDue} cards this turn.`
                  : 'Go out if you can, otherwise discard a card. Then the opponents play.'}
          </div>
          <div className="muted small-text">If your draws run out, the closest hand wins the pot.</div>
          <DuelEffects />
        </div>
      </div>

      <GadgetList />

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
        {aside.length > 0 && (
          <div className="aside">
            <span className="muted small-text">Set aside (they go out with you):</span>
            <div className="cards small">
              {aside.map((id) => (
                <CardView key={id} id={id} badge={inMeld(id) >= 0 ? `M${inMeld(id) + 1}` : undefined} />
              ))}
            </div>
          </div>
        )}
        <div className="actions">
          <button
            className="primary"
            disabled={blocked || phase !== 'main' || sel.length !== 1}
            onClick={() => {
              if (act({ type: 'DUEL_DISCARD', playerId, cardId: sel[0] })) setSelected([]);
            }}
          >
            Discard selected
          </button>
          {cyclesLeft > 0 && (
            <button
              disabled={blocked || phase !== 'main' || sel.length !== 1}
              title="Discard it and draw a replacement, without using a draw"
              onClick={() => {
                if (act({ type: 'DUEL_CYCLE', playerId, cardId: sel[0] })) setSelected([]);
              }}
            >
              Swap for a fresh card ({cyclesLeft} left)
            </button>
          )}
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
          disabled={!out || blocked}
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
  if (r.drawn) {
    return (
      <div className="duel">
        <div className="panel summary">
          <h2>The duel is called off</h2>
          <p>Nobody wins. Every stake goes back, and you keep yours.</p>
          <button className="primary" onClick={() => act({ type: 'CONTINUE', playerId })}>
            Back to the map
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="duel">
      <DuelChoicePanel />
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
            {r.lostStake.length > 0 ? 'Your stake is lost.' : 'You keep your stake.'}
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
        <GadgetList title="After the duel" compact />
        <button className="primary" disabled={!!duel.choice} onClick={() => act({ type: 'CONTINUE', playerId })}>
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

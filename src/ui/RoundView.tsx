import { useState } from 'react';
import { type CardId, type GameState, buildHints, describeRequirement, gadgetCharges, getBlueprint, gradeOf, materialName } from '../engine';
import { BlueprintPanel, hintText } from './BlueprintPanel';
import { CardView } from './CardView';
import { useGame } from './context';
import { ReqLabel } from './ReqLabel';

type SortMode = 'drawn' | 'gauge' | 'category';

interface Targeting {
  cardId: CardId;
  target: 'handCard' | 'discardCard';
}

function sortCards(state: GameState, ids: CardId[], mode: SortMode): CardId[] {
  if (mode === 'drawn') return ids;
  const key = (id: CardId) => {
    const c = state.cards[id];
    if (!c) return [9, '', 0] as const;
    if (c.kind === 'special') return [1, c.specialId, 0] as const;
    return mode === 'gauge' ? ([0, String(c.gauge).padStart(3, '0'), 0] as const) : ([0, c.category, c.gauge] as const);
  };
  return [...ids].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1].localeCompare(kb[1]) || ka[2] - kb[2];
  });
}

export function RoundView() {
  const { state, me, engine, act, playerId } = useGame();
  const round = state.roundState!;
  const bp = getBlueprint(engine.content, me.target!);
  const myTurn = state.players[state.activePlayer].id === playerId;
  const pending = round.pendingChoice?.playerId === playerId ? round.pendingChoice : null;

  const [selected, setSelected] = useState<CardId[]>([]);
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('category');
  const [showDiscard, setShowDiscard] = useState(false);
  const [noBuildFound, setNoBuildFound] = useState(false);

  const lockedIds = me.lockedMelds.flatMap((m) => m.cardIds);
  const usable = new Set([...me.hand, ...lockedIds]);
  const sel = selected.filter((id) => usable.has(id));

  // The selected cards are the build: the game sorts them into the melds.
  const selBuild = sel.length > 0 ? engine.suggestBuild(state, playerId, sel) : null;
  const selHints = sel.length > 0 && !selBuild ? buildHints(engine, state, playerId, sel) : null;
  const meldCards: CardId[][] = bp.requirements.map((_, i) => selBuild?.[i] ?? selHints?.melds[i]?.cardIds ?? []);
  const groupOf = (id: CardId) => meldCards.findIndex((g) => g.includes(id));
  const unused = sel.filter((id) => groupOf(id) < 0);

  /** Cards the round's hazard stops you using (disabled wilds, banned categories). */
  const unusable = (id: CardId) => {
    const c = state.cards[id];
    if (!c) return false;
    if (c.kind === 'part') return me.rules.bannedCategories.includes(c.category);
    const t = engine.token(state, id);
    return !!t && t.role !== 'natural' && me.rules.disabledMeldRoles.includes(t.role);
  };

  const toggle = (id: CardId) => {
    setNoBuildFound(false);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const onHandClick = (id: CardId) => {
    if (targeting?.target === 'handCard') {
      if (act({ type: 'PLAY_SPECIAL', playerId, cardId: targeting.cardId, targetId: id })) setSelected([]);
      setTargeting(null);
      return;
    }
    toggle(id);
  };

  const onLockedClick = (ids: CardId[]) => {
    const allIn = ids.every((id) => sel.includes(id));
    setSelected(allIn ? sel.filter((id) => !ids.includes(id)) : [...new Set([...sel, ...ids])]);
  };

  const pickBuildForMe = () => {
    const suggestion = engine.suggestBuild(state, playerId);
    setNoBuildFound(!suggestion);
    if (suggestion) setSelected(suggestion.flat());
  };

  const selectedSpecial = sel.length === 1 ? state.cards[sel[0]] : null;
  const specialDef =
    selectedSpecial?.kind === 'special' ? engine.content.specials.find((s) => s.id === selectedSpecial.specialId) : null;

  const playSelected = () => {
    if (!specialDef || !selectedSpecial) return;
    if (specialDef.target === 'handCard' || specialDef.target === 'discardCard') {
      setTargeting({ cardId: selectedSpecial.id, target: specialDef.target });
      if (specialDef.target === 'discardCard') setShowDiscard(true);
      return;
    }
    if (act({ type: 'PLAY_SPECIAL', playerId, cardId: selectedSpecial.id })) setSelected([]);
  };

  const top = round.discard.at(-1);
  const drawsLeft = me.rules.drawLimit - me.drawsTaken;
  const hints = buildHints(engine, state, playerId);
  const wanted = new Set(hints?.melds.flatMap((m) => m.cardIds) ?? []);
  const phase = round.turnPhase;
  const otherOffers = round.offers.filter((o) => o !== me.target);
  const catName = (id: string) => engine.content.categories.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="round">
      <div className="round-top two">

        <div className="panel piles">
          <div className="pile">
            <div className="pile-label">Deck ({me.drawPile.length})</div>
            <button
              className="card back clickable"
              disabled={!myTurn || phase !== 'draw' || !!pending}
              onClick={() => act({ type: 'DRAW', playerId, source: 'deck' })}
            >
              Draw
            </button>
          </div>
          <div className="pile">
            <div className="pile-label">
              Discard ({round.discard.length}){' '}
              {round.discard.length > 1 && (
                <a href="#" onClick={(e) => (e.preventDefault(), setShowDiscard(!showDiscard))}>
                  {showDiscard ? 'hide' : 'show all'}
                </a>
              )}
            </div>
            {top ? (
              <CardView
                id={top}
                onClick={
                  myTurn && phase === 'draw' && !pending && me.rules.allowDiscardDraw
                    ? () => act({ type: 'DRAW', playerId, source: 'discard' })
                    : undefined
                }
                title={me.rules.allowDiscardDraw ? 'Take from discard pile' : 'Discard draws are banned this round'}
              />
            ) : (
              <div className="card empty">empty</div>
            )}
          </div>
          <div className="turn-info">
            {pending
              ? 'Resolve your choice.'
              : phase === 'draw'
                ? 'Draw a card from the deck or the discard pile.'
                : 'Play specials or build, then discard a card to end your turn.'}
            {targeting && (
              <div className="targeting">
                Choose a {targeting.target === 'handCard' ? 'card in your hand' : 'card in the discard pile'}.{' '}
                <button onClick={() => setTargeting(null)}>Cancel</button>
              </div>
            )}
          </div>
        </div>

        {otherOffers.length > 0 && (
          <div className="panel pivots">
            <div className="muted">
              Pivot (costs {state.config.pivotCost.draws} draws
              {state.config.pivotCost.currency ? ` + ${state.config.pivotCost.currency} currency` : ''}):
            </div>
            {otherOffers.map((id) => {
              const o = getBlueprint(engine.content, id);
              return (
                <div key={id} className="pivot">
                  <b>{o.name}</b>{' '}
                  <span className="muted">
                    {o.requirements.map((r) => (r.hidden && !me.rules.revealHidden ? '???' : describeRequirement(r, catName))).join(' + ')}
                  </span>{' '}
                  <button disabled={!myTurn || phase !== 'main'} onClick={() => act({ type: 'PIVOT', playerId, blueprintId: id })}>
                    Pivot
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showDiscard && round.discard.length > 0 && (
        <div className="panel">
          <div className="muted">Discard pile (top is last)</div>
          <div className="cards small">
            {round.discard.map((id) => (
              <CardView
                key={id}
                id={id}
                onClick={
                  targeting?.target === 'discardCard'
                    ? () => {
                        act({ type: 'PLAY_SPECIAL', playerId, cardId: targeting.cardId, targetId: id });
                        setTargeting(null);
                        setSelected([]);
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {pending && <PendingChoice key={pending.cardIds.join()} />}

      <BlueprintPanel drawsLeft={drawsLeft} hints={hints} />

      <div className="panel hand">
        <div className="hand-head">
          <b>Your hand</b> <span className="muted">({me.hand.length} cards · <span className="dot-legend" /> = counts toward your blueprint)</span>
          <span className="spacer" />
          sort:{' '}
          {(['category', 'gauge', 'drawn'] as SortMode[]).map((m) => (
            <button key={m} className={sortMode === m ? 'active' : ''} onClick={() => setSortMode(m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="cards">
          {sortCards(state, me.hand, sortMode).map((id) => {
            const g = groupOf(id);
            return (
              <CardView
                key={id}
                id={id}
                selected={sel.includes(id)}
                wanted={wanted.has(id)}
                dim={unusable(id)}
                title={unusable(id) ? "Can't be used this round (hazard)" : undefined}
                badge={g >= 0 ? `M${g + 1}` : undefined}
                onClick={() => onHandClick(id)}
              />
            );
          })}
        </div>
        {me.lockedMelds.length > 0 && (
          <div className="locked">
            <div className="muted">Locked sub-assemblies (click to select):</div>
            {me.lockedMelds.map((m, i) => (
              <div key={i} className="locked-meld clickable" onClick={() => onLockedClick(m.cardIds)}>
                <span className="muted">{m.type}</span>
                <div className="cards small">
                  {m.cardIds.map((id) => (
                    <CardView key={id} id={id} selected={sel.includes(id)} badge={groupOf(id) >= 0 ? `M${groupOf(id) + 1}` : undefined} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="actions">
          <button
            className="primary"
            disabled={!myTurn || phase !== 'main' || sel.length !== 1 || !me.hand.includes(sel[0]) || !!pending}
            onClick={() => {
              if (act({ type: 'DISCARD', playerId, cardId: sel[0] })) setSelected([]);
            }}
          >
            Discard selected
          </button>
          {specialDef?.playable && (
            <button disabled={!myTurn || phase !== 'main' || !!pending} onClick={playSelected}>
              Play {specialDef.name}
            </button>
          )}
          {state.config.subAssemblies && sel.length >= state.config.minLockedMeldSize && (
            <>
              <button onClick={() => act({ type: 'LOCK_MELD', playerId, meldType: 'set', cardIds: sel }) && setSelected([])}>
                Lock as set
              </button>
              <button onClick={() => act({ type: 'LOCK_MELD', playerId, meldType: 'run', cardIds: sel }) && setSelected([])}>
                Lock as run
              </button>
            </>
          )}
          {sel.length > 0 && <button onClick={() => setSelected([])}>Clear selection</button>}
        </div>
      </div>

      <div className={`panel build ${selBuild ? 'ready' : ''}`}>
        <div className="hand-head">
          <b>Build {bp.name}</b>
          <span className="spacer" />
          <button onClick={pickBuildForMe} title="Select a set of cards from your hand that completes the blueprint">
            Find a build for me
          </button>
          {sel.length > 0 && <button onClick={() => setSelected([])}>Clear selection</button>}
        </div>
        {sel.length === 0 ? (
          <div className="muted small-text">
            Tap the cards in your hand you want to build with. The game sorts them into the melds as you go.
          </div>
        ) : (
          <div className="muted small-text">{sel.length} cards selected.</div>
        )}
        {noBuildFound && <div className="sort-message">No complete build in your hand yet. Keep drawing.</div>}
        {selBuild && <BuildPreview cardIds={selBuild.flat()} itemId={bp.itemId} />}
        <div className="melds">
          {bp.requirements.map((req, i) => {
            const cards = meldCards[i];
            const hint = selHints?.melds[i];
            const done = !!selBuild || (hint ? hint.filled >= req.size : false);
            return (
              <div key={i} className={`meld ${sel.length === 0 ? '' : done ? 'ok' : 'bad'}`}>
                <div className="meld-head">
                  <b>M{i + 1}</b> <ReqLabel req={req} compact />
                </div>
                <div className="cards small">
                  {cards.map((id) => (
                    <CardView key={id} id={id} onClick={() => toggle(id)} title="Tap to take it out of the build" />
                  ))}
                </div>
                <div className="meld-status">
                  {sel.length === 0 ? '' : done ? '✓ complete' : hint ? hintText(hint, catName) : ''}
                </div>
              </div>
            );
          })}
        </div>
        {unused.length > 0 && (
          <div className="unused">
            <span className="muted">
              {selBuild ? 'Not needed (they stay in your hand):' : "Doesn't fit any meld yet:"}
            </span>
            <div className="cards small">
              {unused.map((id) => (
                <CardView key={id} id={id} onClick={() => toggle(id)} title="Tap to take it out of the build" />
              ))}
            </div>
          </div>
        )}
        <button
          className="primary big"
          disabled={!selBuild || !myTurn || !!pending}
          onClick={() => {
            if (selBuild && act({ type: 'BUILD', playerId, groups: selBuild })) setSelected([]);
          }}
        >
          Build it! (parts are used up)
        </button>
      </div>
    </div>
  );
}

/** What the selected cards would make: material, grade and gadget charges. */
function BuildPreview({ cardIds, itemId }: { cardIds: CardId[]; itemId: string }) {
  const { state, engine } = useGame();
  const grade = gradeOf(state, engine.content, cardIds);
  const item = engine.content.items.find((i) => i.id === itemId);
  const gadget = state.config.battleStyle === 'rummy' ? item?.gadget : undefined;
  return (
    <div className="build-preview">
      This makes a <b className={`grade-text grade-${Math.min(grade, 7)}`}>{materialName(engine.content, state.config, grade)} {item?.name}</b>{' '}
      <span className="muted">(grade {grade})</span>
      {gadget && (
        <>
          {' '}
          with <b>{gadgetCharges(gadget, grade, state.config)}</b> {gadget.name} charges
        </>
      )}
      . <span className="muted">Better materials and gems make better items.</span>
    </div>
  );
}

function PendingChoice() {
  const { state, act, playerId } = useGame();
  const choice = state.roundState!.pendingChoice!;
  const [picked, setPicked] = useState<CardId[]>([]);
  const toggle = (id: CardId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  if (choice.kind === 'keepOne') {
    return (
      <div className="panel choice">
        <b>
          Keep {choice.keep} of these (the rest go to the {choice.rest === 'discard' ? 'discard pile' : 'bottom of your deck'}):
        </b>
        <div className="cards">
          {choice.cardIds.map((id) => (
            <CardView key={id} id={id} selected={picked.includes(id)} onClick={() => toggle(id)} />
          ))}
        </div>
        <button className="primary" disabled={picked.length !== choice.keep} onClick={() => act({ type: 'RESOLVE_CHOICE', playerId, cardIds: picked })}>
          Keep
        </button>
      </div>
    );
  }
  return (
    <div className="panel choice">
      <b>Reorder the top of your deck: click cards in the order you want to draw them (first = top).</b>
      <div className="cards">
        {choice.cardIds.map((id) => (
          <CardView
            key={id}
            id={id}
            selected={picked.includes(id)}
            badge={picked.includes(id) ? `#${picked.indexOf(id) + 1}` : undefined}
            onClick={() => toggle(id)}
          />
        ))}
      </div>
      <button
        className="primary"
        disabled={picked.length !== choice.cardIds.length}
        onClick={() => act({ type: 'RESOLVE_CHOICE', playerId, cardIds: picked })}
      >
        Confirm order
      </button>
      <button onClick={() => act({ type: 'RESOLVE_CHOICE', playerId, cardIds: choice.cardIds })}>Keep as is</button>
    </div>
  );
}

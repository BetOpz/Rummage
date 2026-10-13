import { useState } from 'react';
import { type CardId, type GameState, buildHints, describeRequirement, getBlueprint, meldMisfits, validateMeld } from '../engine';
import { BlueprintPanel } from './BlueprintPanel';
import { CardView } from './CardView';
import { useGame } from './context';

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
  const rules = engine.meldRules(me);
  const myTurn = state.players[state.activePlayer].id === playerId;
  const pending = round.pendingChoice?.playerId === playerId ? round.pendingChoice : null;

  const [selected, setSelected] = useState<CardId[]>([]);
  const [groupsRaw, setGroups] = useState<CardId[][]>(() => bp.requirements.map(() => []));
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('category');
  const [showDiscard, setShowDiscard] = useState(false);
  const [sortMessage, setSortMessage] = useState<string | null>(null);

  const lockedIds = me.lockedMelds.flatMap((m) => m.cardIds);
  const usable = new Set([...me.hand, ...lockedIds]);
  // Drop cards that have left the hand, and resize if the target changed (pivot).
  const groups = bp.requirements.map((_, i) => (groupsRaw[i] ?? []).filter((id) => usable.has(id)));
  const sel = selected.filter((id) => usable.has(id));
  const groupOf = (id: CardId) => groups.findIndex((g) => g.includes(id));

  const groupResults = groups.map((g, i) => {
    if (g.length === 0) return null;
    const tokens = g.map((id) => engine.token(state, id));
    if (tokens.some((t) => !t)) return { ok: false as const, reason: 'Contains a card that cannot meld' };
    const result = validateMeld(tokens.map((t) => t!), bp.requirements[i], rules);
    if (result.ok) return result;
    const misfits = meldMisfits(tokens.map((t) => t!), bp.requirements[i], rules);
    return { ...result, misfits };
  });
  const allValid = groupResults.every((r) => r?.ok);

  const toggle = (id: CardId) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

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

  const assign = (i: number) => {
    setGroups(groups.map((g, j) => (j === i ? [...new Set([...g, ...sel])] : g.filter((id) => !sel.includes(id)))));
    setSelected([]);
  };

  const autoFill = () => {
    const suggestion = engine.suggestBuild(state, playerId);
    setSortMessage(suggestion ? null : 'No complete build yet with the cards in your hand.');
    if (suggestion) setGroups(suggestion);
  };

  /** Split the cards already in the melds, plus any selected, into the blueprint's melds. */
  const sortIntoMelds = () => {
    const pool = [...new Set([...groups.flat(), ...sel])];
    const suggestion = engine.suggestBuild(state, playerId, pool);
    if (suggestion) {
      setGroups(suggestion);
      setSelected([]);
      setSortMessage(null);
    } else {
      setSortMessage(
        `Those ${pool.length} cards can't complete every meld yet. Check the blueprint panel above for what's missing.`,
      );
    }
  };
  const sortable = groups.flat().length + sel.length > 0;

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

  /** Status line under a meld; names the cards that don't fit when it can. */
  const meldStatus = (res: (typeof groupResults)[number], type: 'set' | 'run'): string => {
    if (!res) return 'Empty.';
    if (res.ok) return '✓ valid';
    const misfits = 'misfits' in res ? (res.misfits ?? []) : [];
    if (misfits.length === 0) return `✗ ${res.reason}`;
    const names = misfits.map((id) => cardName(state, catName, id)).join(', ');
    const rule = type === 'run' ? 'A run is one category, each number once, in a row.' : 'A set is cards with the same number.';
    return `✗ ${names} ${misfits.length === 1 ? "doesn't" : "don't"} fit this ${type}. ${rule} Press “Sort into melds” to split them up, or click a card to remove it.`;
  };

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

      <div className="panel build">
        <div className="hand-head">
          <b>Build {bp.name}</b>
          <span className="spacer" />
          <button className="primary" disabled={!sortable} onClick={sortIntoMelds} title="Select cards (or put them in any meld), and the game splits them into the melds">
            Sort into melds
          </button>
          <button onClick={autoFill} title="Find a build using any cards in your hand">
            Auto-fill from hand
          </button>
          <button onClick={() => setGroups(bp.requirements.map(() => []))}>Clear</button>
        </div>
        <div className="muted small-text">
          Select the cards you want to build with and press <b>Sort into melds</b>. The game works out which cards form each
          meld. You can also add cards to a meld yourself.
        </div>
        {sortMessage && <div className="sort-message">{sortMessage}</div>}
        <div className="melds">
          {bp.requirements.map((req, i) => {
            const res = groupResults[i];
            return (
              <div key={i} className={`meld ${res ? (res.ok ? 'ok' : 'bad') : ''}`}>
                <div className="meld-head">
                  <b>M{i + 1}</b> {describeRequirement(req, catName)}
                  <span className="spacer" />
                  <button disabled={sel.length === 0} onClick={() => assign(i)}>
                    Add selected
                  </button>
                </div>
                <div className="cards small">
                  {groups[i].map((id) => (
                    <CardView
                      key={id}
                      id={id}
                      misfit={!!res && !res.ok && 'misfits' in res && !!res.misfits?.includes(id)}
                      onClick={() => setGroups(groups.map((g, j) => (j === i ? g.filter((x) => x !== id) : g)))}
                      title="Click to remove from this meld"
                    />
                  ))}
                </div>
                <div className="meld-status">{meldStatus(res, req.type)}</div>
              </div>
            );
          })}
        </div>
        <button
          className="primary big"
          disabled={!allValid || !myTurn || !!pending}
          onClick={() => act({ type: 'BUILD', playerId, groups })}
        >
          Build it! (parts are used up)
        </button>
      </div>
    </div>
  );
}

function cardName(state: GameState, catName: (id: string) => string, id: CardId): string {
  const c = state.cards[id];
  return c?.kind === 'part' ? `${catName(c.category)} ${c.gauge}` : id;
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

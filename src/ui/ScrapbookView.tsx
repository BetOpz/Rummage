import { useState } from 'react';
import {
  type PieceDestination,
  STAGES,
  TIER_NAMES,
  activeBonuses,
  collectionCounts,
  finishedGrade,
  itemTier,
  materialName,
  maxCharges,
  pageOf,
  pageRoom,
  pageSellPrice,
  pieceLabel,
  piecesNeeded,
  scrapbookPages,
  stageFor,
  suggestDestinations,
} from '../engine';
import { Charges, GadgetList } from './Gadgets';
import { useGame } from './context';
import { LotPanel, PieceView } from './LotView';

/** An item's card text: at its tier if it's alive, else as a Prototype. */
function PageText({ itemId }: { itemId: string }) {
  const { me, engine } = useGame();
  const def = engine.content.items.find((d) => d.id === itemId)!;
  const owned = me.items.find((i) => i.itemId === itemId);
  const tier = owned ? itemTier(owned) : 0;
  return (
    <div className="page-text">
      <span className="page-meta">
        {def.rarity} · {engine.content.collections.find((c) => c.id === def.collection)?.name ?? def.collection} · {TIER_NAMES[tier]}
      </span>{' '}
      {def.passive.text[tier]}
      {def.gadget ? (
        <>
          {' '}
          <b>{def.gadget.name}:</b> {def.gadget.text[tier]}
        </>
      ) : (
        <span className="muted"> No gadget.</span>
      )}
    </div>
  );
}

/** One scrapbook page: the item, and a stage per material from Tin to Platinum. */
function Page({ itemId, highlight }: { itemId: string; highlight?: number[] }) {
  const { state, me, engine } = useGame();
  const def = engine.content.items.find((d) => d.id === itemId)!;
  const page = pageOf(me, itemId);
  const owned = me.items.find((i) => i.itemId === itemId);
  const blank = page.every((n) => n === 0);
  const done = finishedGrade(state.config, me, itemId);
  return (
    <div className={`page ${blank ? 'blank' : ''} ${owned ? 'alive' : ''} rarity-${def.rarity}`}>
      <div className="page-head">
        <b className="page-title">{owned ? `${owned.material} ${def.name}` : def.name}</b>
        {owned?.charges !== null && owned?.charges !== undefined && <Charges have={owned.charges} max={maxCharges(engine.content, state.config, owned, me) ?? 0} />}
      </div>
      <PageText itemId={itemId} />
      {blank && <div className="page-blank">Blank page. Find pieces to start it.</div>}
      <ol className="stages">
        {Array.from({ length: STAGES }, (_, i) => {
          const g = i + 1;
          const need = piecesNeeded(state.config, g);
          const have = page[i];
          const cat = engine.content.categories.find((c) => c.grade === g);
          const complete = have >= need;
          const adding = highlight?.[i] ?? 0;
          return (
            <li key={g} className={`stage ${complete ? 'complete' : ''} ${g === done ? 'best' : ''}`} style={{ ['--cat' as string]: cat?.color ?? '#888' }}>
              <span className="stage-name">{materialName(engine.content, state.config, g)}</span>
              <span className="stage-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (have / need) * 100)}%` }} />
                {adding > 0 && <span className="adding" style={{ left: `${(have / need) * 100}%`, width: `${Math.min(100 - (have / need) * 100, (adding / need) * 100)}%` }} />}
              </span>
              <span className="stage-count">{complete ? '✓' : `${have}${adding ? `+${adding}` : ''}/${need}`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Set bonuses: collections with enough living items. */
export function SetBonuses() {
  const { state, me, engine } = useGame();
  const counts = collectionCounts(engine.content, me);
  const on = new Set(activeBonuses(engine.content, state.config, me));
  const shown = engine.content.collections.filter((c) => (counts[c.id] ?? 0) > 0);
  if (shown.length === 0) return null;
  const { bonusAt, chargeAt } = state.config.collections;
  return (
    <ul className="set-bonuses">
      {shown.map((c) => (
        <li key={c.id} className={on.has(c.id) ? 'on' : ''} title={`${bonusAt} living ${c.name} items: ${c.bonus.text} ${chargeAt}: +1 charge on every ${c.name} gadget.`}>
          <b>{c.name}</b> {counts[c.id]}/{bonusAt}
          {on.has(c.id) ? ` — ${c.bonus.text}` : ''}
          {(counts[c.id] ?? 0) >= chargeAt ? ' +1 charge' : ''}
        </li>
      ))}
    </ul>
  );
}

/** The scrapbook: your pages, set bonuses and scrapbook gadgets. */
export function ScrapbookView({ onClose }: { onClose?: () => void }) {
  const { state, engine, me } = useGame();
  const pages = scrapbookPages(engine.content, me);
  const limit = state.config.scrapbook.pages && me.pages !== null ? state.config.scrapbook.pages.max : null;
  return (
    <div className="panel scrapbook">
      <div className="map-head">
        <h2>Scrapbook</h2>
        <span className="muted">
          Fill a stage with pieces of its material (or better) and the item comes to life at that grade.{' '}
          {limit ? `${pages.length} of ${limit} pages.` : `${pages.length} pages.`}
        </span>
        <span className="spacer" />
        {onClose && <button onClick={onClose}>Close</button>}
      </div>
      <SetBonuses />
      <GadgetList title="Scrapbook gadgets" compact only={(it) => engine.content.items.find((d) => d.id === it.itemId)?.gadget?.usedIn.includes('scrapbook') ?? false} />
      <div className="pages">
        {pages.map((id) => (
          <Page key={id} itemId={id} />
        ))}
      </div>
    </div>
  );
}

/** The start of a run: choose your first pages. */
export function PageOfferView() {
  const { state, act, playerId } = useGame();
  const offer = state.pageOffer!;
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < offer.picks ? [...p, id] : p));
  return (
    <div className="panel scrapbook">
      <h2>Start your scrapbook</h2>
      <p className="muted">
        Choose <b>{offer.picks}</b> pages to start with. Each is an item you can bring to life by filling its stages with parts you
        win. More pages turn up in lots and shops; your scrapbook holds {state.config.scrapbook.pages?.max ?? 'any number of'} pages.
      </p>
      <div className="pages">
        {offer.options.map((id) => (
          <button key={id} type="button" className={`page-pick ${picked.includes(id) ? 'selected' : ''}`} onClick={() => toggle(id)} aria-pressed={picked.includes(id)}>
            <Page itemId={id} />
          </button>
        ))}
      </div>
      <button className="primary big" disabled={picked.length !== offer.picks} onClick={() => act({ type: 'PICK_PAGES', playerId, itemIds: picked })}>
        {picked.length === offer.picks ? 'Start the run' : `Choose ${offer.picks - picked.length} more`}
      </button>
    </div>
  );
}

/** A won lot: first pick your parcels, then sort what was inside. */
export function RummageView() {
  const { state } = useGame();
  return state.rummage!.stage === 'pick' ? <PickView /> : <SortView />;
}

/** Choose which parcels to take. Checks can still be used here. */
function PickView() {
  const { state, engine, act, playerId } = useGame();
  const r = state.rummage!;
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < r.lot.picks ? [...p, i] : p));
  const isCheck = (itemId: string) => engine.content.items.find((d) => d.id === itemId)?.gadget?.effects.some((e) => e.type === 'checkParcel') ?? false;
  return (
    <div className="rummage">
      <div className="panel">
        <h2>Pick from the {r.lotName}</h2>
        <p className="muted">
          You won the lot: take any <b>{r.lot.picks}</b> of its {r.lot.parcels.length} parcels. The rest go back to the seller. Tap a
          parcel to check it or take it.
          {r.bonus.length > 0 && ` You also win ${r.bonus.length} extra piece${r.bonus.length === 1 ? '' : 's'}.`}
        </p>
        <LotPanel lot={r.lot} mode="pick" picked={picked} onTogglePick={toggle} />
        <GadgetList title="Lot gadgets" compact only={(it) => !isCheck(it.itemId)} />
        <button className="primary big" disabled={picked.length !== r.lot.picks} onClick={() => act({ type: 'PICK_PARCELS', playerId, parcels: picked })}>
          {picked.length === r.lot.picks ? 'Open my parcels' : `Choose ${r.lot.picks - picked.length} more`}
        </button>
      </div>
    </div>
  );
}

/** Sorting the opened pieces: each goes onto a page, into the parts deck, or is sold. Loose pages go into the scrapbook. */
function SortView() {
  const { state, me, engine, act, playerId } = useGame();
  const rummage = state.rummage!;
  const [dests, setDests] = useState<PieceDestination[]>(() => suggestDestinations(state, engine.content, me, rummage.pieces));
  const cfg = state.config.scrapbook;
  const pages = scrapbookPages(engine.content, me);
  const pageName = (id: string) => engine.content.items.find((d) => d.id === id)?.name ?? id;

  // Where each piece would land, given the pieces before it.
  const sim = structuredClone(me);
  const adding: Record<string, number[]> = {};
  const problems: string[] = [];
  rummage.pieces.forEach((p, i) => {
    const d = dests[i];
    if (d.to !== 'page') return;
    const g = stageFor(state.config, engine.content, sim, d.itemId, p);
    if (g === null) {
      problems.push(`${pieceLabel(engine.content, p)} doesn't fit the ${pageName(d.itemId)} page`);
      return;
    }
    const page = (sim.scrapbook[d.itemId] ??= new Array(STAGES).fill(0));
    page[g - 1] += 1;
    (adding[d.itemId] ??= new Array(STAGES).fill(0))[g - 1] += 1;
  });

  const value = (i: number) => {
    const d = dests[i];
    if (d.to === 'page') return `page:${d.itemId}`;
    if (d.to === 'scrapbook') return d.tearOut ? `tear:${d.tearOut}` : 'scrapbook';
    return d.to;
  };
  const setValue = (i: number, v: string) =>
    setDests((ds) =>
      ds.map((d, j) => {
        if (j !== i) return d;
        if (v.startsWith('page:')) return { to: 'page', itemId: v.slice(5) };
        if (v.startsWith('tear:')) return { to: 'scrapbook', tearOut: v.slice(5) };
        return { to: v as 'deck' | 'sell' | 'scrapbook' };
      }),
    );
  const sellValue = (i: number) => {
    const p = rummage.pieces[i];
    if (p.kind === 'page') return pageSellPrice(state, engine.content, p.itemId!);
    return p.kind === 'part' ? cfg.sellPerGrade * (engine.content.categories.find((c) => c.id === p.category)?.grade ?? 1) : cfg.sellSpecial;
  };
  const touched = Object.keys(adding);
  const room = pageRoom(state, me);

  return (
    <div className="rummage">
      <div className="panel">
        <h2>Rummaging through the {rummage.lotName}</h2>
        <p className="muted">
          Choose where each piece goes: onto a scrapbook page, into your parts deck (to play with in duels), or sold for credits.
        </p>
        <ul className="finds">
          {rummage.pieces.map((p, i) => (
            <li key={i} className={p.kind === 'page' ? 'find-page' : undefined}>
              <PieceView piece={p} />
              <div className="find-dest-wrap">
              <label className="find-dest">
                <span className="muted small-text">{pieceLabel(engine.content, p)}</span>
                <select id={`dest-${i}`} value={value(i)} onChange={(e) => setValue(i, e.target.value)}>
                  {p.kind === 'page' ? (
                    <>
                      {me.pages?.includes(p.itemId!) ? null : room ? (
                        <option value="scrapbook">Put it in my scrapbook</option>
                      ) : (
                        pages.map((id) => (
                          <option key={id} value={`tear:${id}`}>
                            Tear out the {pageName(id)} page for it
                          </option>
                        ))
                      )}
                      <option value="sell">Sell it for {sellValue(i)} credits</option>
                    </>
                  ) : (
                    <>
                      {p.kind === 'part' &&
                        pages.map((id) => {
                          const g = stageFor(state.config, engine.content, me, id, p);
                          if (g === null) return null;
                          return (
                            <option key={id} value={`page:${id}`}>
                              {pageName(id)} page ({materialName(engine.content, state.config, g)} stage)
                            </option>
                          );
                        })}
                      <option value="deck">Keep in my parts deck</option>
                      <option value="sell">Sell for {sellValue(i)} credits</option>
                    </>
                  )}
                </select>
              </label>
              {p.kind === 'page' && <PageText itemId={p.itemId!} />}
              </div>
            </li>
          ))}
        </ul>
        {rummage.missed.length > 0 && (
          <div className="missed">
            <span className="muted small-text">The parcels you left behind held:</span>
            <div className="cards small">
              {rummage.missed.map((p, i) => (
                <PieceView key={i} piece={p} />
              ))}
            </div>
          </div>
        )}
        {problems.map((m) => (
          <div key={m} className="shape-warning">
            {m}
          </div>
        ))}
        <GadgetList title="Scrapbook gadgets" compact />
        <button className="primary big" disabled={problems.length > 0} onClick={() => act({ type: 'RUMMAGE_DONE', playerId, destinations: dests })}>
          Done sorting
        </button>
      </div>
      {touched.length > 0 && (
        <div className="panel scrapbook">
          <h3>Pages you're adding to</h3>
          <div className="pages">
            {touched.map((id) => (
              <Page key={id} itemId={id} highlight={adding[id]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

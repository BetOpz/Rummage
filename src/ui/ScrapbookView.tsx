import { useState } from 'react';
import { type PieceDestination, STAGES, finishedGrade, itemMaxCharges, materialName, pageOf, piecesNeeded, pieceLabel, stageFor, suggestDestinations } from '../engine';
import { Charges } from './GadgetPanel';
import { useGame } from './context';
import { PieceView } from './LotView';

/** One scrapbook page: the item, and a stage per material from Tin to Platinum. */
function Page({ itemId, highlight }: { itemId: string; highlight?: number[] }) {
  const { state, me, engine } = useGame();
  const def = engine.content.items.find((d) => d.id === itemId)!;
  const page = pageOf(me, itemId);
  const owned = me.items.find((i) => i.itemId === itemId);
  const blank = page.every((n) => n === 0);
  const done = finishedGrade(state.config, me, itemId);
  return (
    <div className={`page ${blank ? 'blank' : ''} ${owned ? 'alive' : ''}`}>
      <div className="page-head">
        <b className="page-title">{owned ? `${owned.material} ${def.name}` : def.name}</b>
        {owned?.charges !== null && owned?.charges !== undefined && (
          <Charges have={owned.charges} max={itemMaxCharges(engine.content, state.config, owned) ?? 0} />
        )}
      </div>
      <div className="page-text">
        {def.text}
        {def.gadget && (
          <>
            {' '}
            <b>{def.gadget.name}:</b> {def.gadget.text}{def.gadget.onLot && ` ${def.gadget.onLot.text}`}
          </>
        )}
      </div>
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
              <span className="stage-count">
                {complete ? '✓' : `${have}${adding ? `+${adding}` : ''}/${need}`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The whole scrapbook: every item's page. */
export function ScrapbookView({ onClose }: { onClose?: () => void }) {
  const { engine, me } = useGame();
  const started = engine.content.items.filter((d) => pageOf(me, d.id).some((n) => n > 0) || me.items.some((i) => i.itemId === d.id));
  return (
    <div className="panel scrapbook">
      <div className="map-head">
        <h2>Scrapbook</h2>
        <span className="muted">
          Fill a stage with pieces of its material (or better) and the item comes to life at that grade. {started.length} of{' '}
          {engine.content.items.length} pages started.
        </span>
        <span className="spacer" />
        {onClose && <button onClick={onClose}>Close</button>}
      </div>
      <div className="pages">
        {engine.content.items.map((d) => (
          <Page key={d.id} itemId={d.id} />
        ))}
      </div>
    </div>
  );
}

/** Sorting a won lot: each piece goes onto a page, into the parts deck, or is sold. */
export function RummageView() {
  const { state, me, engine, act, playerId } = useGame();
  const rummage = state.rummage!;
  const [dests, setDests] = useState<PieceDestination[]>(() => suggestDestinations(state, engine.content, me, rummage.pieces));
  const cfg = state.config.scrapbook;

  // Where each piece would land, given the pieces before it.
  const sim = structuredClone(me);
  const adding: Record<string, number[]> = {};
  const problems: string[] = [];
  rummage.pieces.forEach((p, i) => {
    const d = dests[i];
    if (d.to !== 'page') return;
    const g = stageFor(state.config, engine.content, sim, d.itemId, p);
    if (g === null) {
      problems.push(`${pieceLabel(engine.content, p)} doesn't fit the ${engine.content.items.find((x) => x.id === d.itemId)?.name} page`);
      return;
    }
    const page = (sim.scrapbook[d.itemId] ??= new Array(STAGES).fill(0));
    page[g - 1] += 1;
    (adding[d.itemId] ??= new Array(STAGES).fill(0))[g - 1] += 1;
  });

  const value = (i: number) => {
    const d = dests[i];
    return d.to === 'page' ? `page:${d.itemId}` : d.to;
  };
  const setValue = (i: number, v: string) =>
    setDests((ds) => ds.map((d, j) => (j !== i ? d : v.startsWith('page:') ? { to: 'page', itemId: v.slice(5) } : { to: v as 'deck' | 'sell' })));
  const sellValue = (i: number) => {
    const p = rummage.pieces[i];
    return p.kind === 'part' ? cfg.sellPerGrade * (engine.content.categories.find((c) => c.id === p.category)?.grade ?? 1) : cfg.sellSpecial;
  };
  const touched = Object.keys(adding);

  return (
    <div className="rummage">
      <div className="panel">
        <h2>Rummaging through the {rummage.lotName}</h2>
        <p className="muted">
          Choose where each piece goes: onto a scrapbook page, into your parts deck (to play with in duels), or sold for credits.
          {rummage.leftBehind > 0 && ` ${rummage.leftBehind} piece${rummage.leftBehind === 1 ? '' : 's'} stayed at the bottom of the box.`}
        </p>
        <ul className="finds">
          {rummage.pieces.map((p, i) => (
            <li key={i}>
              <PieceView piece={p} />
              <label className="find-dest">
                <span className="muted small-text">{pieceLabel(engine.content, p)}</span>
                <select id={`dest-${i}`} value={value(i)} onChange={(e) => setValue(i, e.target.value)}>
                  {p.kind === 'part' &&
                    engine.content.items.map((d) => {
                      const g = stageFor(state.config, engine.content, me, d.id, p);
                      if (g === null) return null;
                      return (
                        <option key={d.id} value={`page:${d.id}`}>
                          {d.name} page ({materialName(engine.content, state.config, g)} stage)
                        </option>
                      );
                    })}
                  <option value="deck">Keep in my parts deck</option>
                  <option value="sell">Sell for {sellValue(i)} credits</option>
                </select>
              </label>
            </li>
          ))}
        </ul>
        {problems.map((m) => (
          <div key={m} className="shape-warning">
            {m}
          </div>
        ))}
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

import { useState } from 'react';
import {
  type Encounter,
  type GameAction,
  type Lot,
  type Parcel,
  type RewardOption,
  appraiseCost,
  eligibleStakeCards,
  partName,
  sharpened,
  viewParcel,
} from '../engine';
import { GadgetList } from './Gadgets';
import { useGame } from './context';

/** A piece (not yet a card), shown as a small tag. */
export function PieceView({ piece }: { piece: RewardOption }) {
  const { engine } = useGame();
  if (piece.kind === 'page') {
    const def = engine.content.items.find((d) => d.id === piece.itemId);
    return (
      <div className={`card page-piece rarity-${def?.rarity}`} title={def ? `${def.name} page (${def.rarity}): ${def.passive.text[0]}` : 'A loose page'}>
        <div className="special-name">{def?.name} page</div>
        <div className="special-text">{def?.rarity}</div>
      </div>
    );
  }
  if (piece.kind === 'special') {
    const def = engine.content.specials.find((s) => s.id === piece.specialId);
    return (
      <div className="card special piece" title={def?.text}>
        <div className="special-name">{def?.name}</div>
      </div>
    );
  }
  const cat = engine.content.categories.find((c) => c.id === piece.category);
  const noun = partName(engine.content, piece.category!, piece.gauge!).split(' ').slice(1).join(' ');
  return (
    <div className="card part piece" data-cat={piece.category} style={{ ['--cat' as string]: cat?.color ?? '#888' }} title={`${cat?.name} ${noun} ${piece.gauge}`}>
      <div className="gauge">{piece.gauge}</div>
      <div className="cat">{cat?.name}</div>
      <div className="name">{noun}</div>
    </div>
  );
}

/** A parcel as far as you know it: wrapped, half-known (number or metal), or opened. */
export function ParcelTile({
  parcel,
  index,
  selected,
  picked,
  onClick,
}: {
  parcel: Parcel;
  index: number;
  selected?: boolean;
  picked?: boolean;
  onClick?: () => void;
}) {
  const { engine } = useGame();
  const v = viewParcel(engine.content, parcel);
  const cat = (id: string) => engine.content.categories.find((c) => c.id === id);
  const classes = ['parcel', v.kind];
  if (selected) classes.push('selected');
  if (picked) classes.push('picked');
  if (onClick) classes.push('clickable');
  let body;
  let title: string;
  if (v.kind === 'known') {
    return (
      <button type="button" className={classes.join(' ')} onClick={onClick} disabled={!onClick} aria-pressed={picked}>
        <PieceView piece={v.piece} />
        {picked && <span className="parcel-badge">Taking</span>}
      </button>
    );
  } else if (v.kind === 'gauge') {
    const odds = `1 in ${v.metals.length}`;
    title = `Definitely a ${v.gauge}: ${v.metals.map((m) => cat(m)?.name).join(', ')} (${odds} each)`;
    body = (
      <>
        <span className="parcel-big">{v.gauge}</span>
        <span className="parcel-opts">
          {v.metals.map((m) => (
            <span key={m} className="opt-metal" style={{ ['--cat' as string]: cat(m)?.color }}>
              {cat(m)?.name}
            </span>
          ))}
        </span>
        <span className="parcel-odds">{odds}</span>
      </>
    );
  } else if (v.kind === 'metal') {
    const odds = `1 in ${v.gauges.length}`;
    title = `Definitely ${cat(v.metal)?.name}: a ${v.gauges.join(', ')} (${odds} each)`;
    body = (
      <>
        <span className="parcel-metal" style={{ ['--cat' as string]: cat(v.metal)?.color }}>
          {cat(v.metal)?.name}
        </span>
        <span className="parcel-opts nums">{v.gauges.join(' · ')}</span>
        <span className="parcel-odds">{odds}</span>
      </>
    );
  } else {
    title = 'Wrapped: no idea yet';
    body = <span className="parcel-big">?</span>;
  }
  return (
    <button type="button" className={classes.join(' ')} title={title} onClick={onClick} disabled={!onClick} aria-pressed={picked}>
      <span className="parcel-no">#{index + 1}</span>
      {body}
      {picked && <span className="parcel-badge">Taking</span>}
    </button>
  );
}

/**
 * A lot and its parcels. Tap a parcel to choose it, then use a check on it.
 * `mode` decides what's allowed: just looking, checking from the map,
 * buying unwraps at the appraiser, or picking your prize after a win.
 */
export function LotPanel({
  lot,
  nodeId,
  mode,
  picked = [],
  onTogglePick,
}: {
  lot: Lot;
  nodeId?: string;
  mode: 'view' | 'map' | 'appraiser' | 'pick';
  picked?: number[];
  onTogglePick?: (i: number) => void;
}) {
  const { engine } = useGame();
  const def = engine.content.lots.find((l) => l.id === lot.lotId);
  const [sel, setSel] = useState<number | null>(null);
  const canCheck = mode !== 'view';
  const click = (i: number) => setSel(i);
  const selParcel = sel !== null ? lot.parcels[sel] : null;
  return (
    <div className="lot">
      <div className="lot-head">
        <b className="lot-name">{lot.name}</b>
        <span className="lot-count">
          {lot.parcels.length} parcels · winner picks <b>{lot.picks}</b>
        </span>
      </div>
      {def && <div className="muted small-text">{def.text}</div>}
      <div className="parcels">
        {lot.parcels.map((p, i) => (
          <ParcelTile key={i} parcel={p} index={i} selected={canCheck && sel === i} picked={picked.includes(i)} onClick={canCheck ? () => click(i) : undefined} />
        ))}
      </div>
      {canCheck && selParcel && (
        <CheckBar
          parcel={selParcel}
          index={sel!}
          nodeId={nodeId}
          appraiser={mode === 'appraiser'}
          take={
            mode === 'pick' && onTogglePick
              ? { taking: picked.includes(sel!), full: picked.length >= lot.picks, toggle: () => onTogglePick(sel!) }
              : undefined
          }
        />
      )}
      {canCheck && !selParcel && <div className="muted small-text">Tap a parcel to check it{mode === 'pick' ? ' or take it' : ''}.</div>}
    </div>
  );
}

/** Ways to check the chosen parcel: your tools, gadgets that work on parcels, or the appraiser. */
function CheckBar({
  parcel,
  index,
  nodeId,
  appraiser,
  take,
}: {
  parcel: Parcel;
  index: number;
  nodeId?: string;
  appraiser: boolean;
  take?: { taking: boolean; full: boolean; toggle: () => void };
}) {
  const { state, me, engine, act, playerId } = useGame();
  const known = viewParcel(engine.content, parcel).kind === 'known';
  const takeButton = take && (
    <button className="primary" disabled={!take.taking && take.full} onClick={take.toggle}>
      {take.taking ? `Put parcel #${index + 1} back` : take.full ? 'Put one back first' : `Take parcel #${index + 1}`}
    </button>
  );
  if (known) {
    return (
      <div className="check-bar">
        <span className="muted small-text">You know exactly what's in parcel #{index + 1}.</span>
        {takeButton && <div className="actions">{takeButton}</div>}
      </div>
    );
  }
  const cost = appraiseCost(state, engine.content, me);
  const run = (a: GameAction) => act(a);
  const describe = (reveals: string, options: number) =>
    reveals === 'both' || options <= 1 ? 'exact' : reveals === 'gauge' ? `number, 1 of ${options} metals` : `metal, 1 of ${options} numbers`;
  const held = engine.content.tools.filter((t) => (me.tools[t.id] ?? 0) > 0);
  const checks = me.items.filter((it) => engine.content.items.find((d) => d.id === it.itemId)?.gadget?.effects.some((e) => e.type === 'checkParcel'));
  return (
    <div className="check-bar">
      <span className="eyebrow">Check parcel #{index + 1}</span>
      <div className="actions">
        {takeButton}
        {appraiser && (
          <button className="primary" disabled={me.currency < cost} onClick={() => run({ type: 'APPRAISE', playerId, nodeId: nodeId!, parcel: index })}>
            Appraiser unwraps it ({cost} credits)
          </button>
        )}
        {held.map((t) => (
          <button key={t.id} title={t.text} onClick={() => run({ type: 'USE_TOOL', playerId, toolId: t.id, nodeId, parcel: index })}>
            {t.name} ×{me.tools[t.id]} <span className="muted">({describe(t.reveals, sharpened(engine.content, state.config, me, t.options))})</span>
          </button>
        ))}
        {!appraiser && held.length === 0 && checks.length === 0 && <span className="muted small-text">You have no checks left. Shops sell them.</span>}
      </div>
      <GadgetList title="Check with a gadget" parcel={index} nodeId={nodeId} compact only={(it) => checks.includes(it)} />
    </div>
  );
}

/** Your check cards, as a one-line summary. */
export function ToolsLine() {
  const { me, engine } = useGame();
  const held = engine.content.tools.filter((t) => (me.tools[t.id] ?? 0) > 0);
  if (held.length === 0) return null;
  return (
    <span className="tools-line" title="Checks for wrapped parcels">
      Checks:{' '}
      {held.map((t) => (
        <span key={t.id} className="tool-chip" title={t.text}>
          {t.name} ×{me.tools[t.id]}
        </span>
      ))}
    </span>
  );
}

/** "Stake 2 × Copper or better (you have 9)". */
export function StakeLine({ encounter, isBoss }: { encounter: Encounter; isBoss: boolean }) {
  const { state, me, engine } = useGame();
  const rule = encounter.stakeRule;
  if (!rule) return null;
  const mat = engine.content.categories.find((c) => c.id === rule.category)?.name ?? rule.category;
  const have = eligibleStakeCards(state, engine.content, me, rule).length;
  const ok = have >= rule.count;
  return (
    <div className={`stake-line ${ok ? '' : 'short'}`}>
      Everyone stakes{' '}
      <b>
        {rule.count} × {mat}
      </b>{' '}
      or better. You have {have}.
      {!ok && (isBoss ? ' Not enough: the boss will take any parts instead.' : ' Not enough to play: you can walk past.')}
    </div>
  );
}

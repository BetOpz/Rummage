import { useState } from 'react';
import {
  type ActiveEffect,
  type CardId,
  type Engine,
  type GadgetArgs,
  type GameState,
  type ItemInstance,
  type Place,
  type PlayerState,
  STAGES,
  TIER_NAMES,
  gadgetAt,
  itemTier,
  materialName,
  maxCharges,
  pageOf,
  piecesNeeded,
  placesNow,
  rechargeCost,
  scrapbookPages,
} from '../engine';
import { CardView } from './CardView';
import { useGame } from './context';

/** An item's card text at its tier. */
export function itemText(engine: Engine, item: ItemInstance) {
  const def = engine.content.items.find((d) => d.id === item.itemId)!;
  const tier = itemTier(item);
  return { def, tier, tierName: TIER_NAMES[tier], passive: def.passive.text[tier], gadget: def.gadget?.text[tier] ?? '' };
}

export function Charges({ have, max }: { have: number; max: number }) {
  return (
    <span className="charges" title={`${have} of ${max} charges`}>
      {Array.from({ length: Math.max(have, max) }, (_, i) => (
        <span key={i} className={i < have ? 'lamp lit' : 'lamp'} />
      ))}
    </span>
  );
}

/** What a gadget asks the player to pick before it's used. */
interface Aim {
  opponent: boolean;
  cards?: { from: 'hand' | 'discard' | 'deck'; min: number; max: number; depth?: number; shift?: number; shiftZero?: boolean; materials?: boolean };
  options?: string[];
  parcels?: number;
  pages?: { count: 1 | 2; stage: boolean; stageOptional?: boolean };
}

const n = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);

function optionLabel(ref: { type: string; params?: Record<string, unknown> }): string {
  const p = ref.params ?? {};
  if (ref.type === 'extraDraws') return `+${n(p.amount, 1)} draws this duel`;
  if (ref.type === 'skipTurn') return 'An opponent misses its next turn';
  return ref.type;
}

/** Work out the picks a gadget needs, from its effects at the item's tier. */
function aimFor(engine: Engine, state: GameState, me: PlayerState, item: ItemInstance, place: Place): Aim {
  const g = gadgetAt(engine.content, me, item);
  const effects = g.effects.filter((e) => (engine.effects[e.type]?.places ?? ['duel']).includes(place));
  const everyone = (e: ActiveEffect) => e.params.all === true || ['all', 'random', 'boss'].includes(String(e.params.target)) || e.params.boss === true;
  const aim: Aim = { opponent: g.gadget.target === 'opponent' && !effects.every(everyone) };
  for (const e of effects) {
    const p = e.params;
    switch (e.type) {
      case 'shiftGauge':
        aim.cards = { from: 'hand', min: 1, max: n(p.parts, 1), shift: n(p.maxShift, 1) };
        break;
      case 'recastPart':
        aim.cards = { from: 'hand', min: 1, max: n(p.cards, 1), shift: n(p.gaugeShift), shiftZero: true, materials: true };
        break;
      case 'swapWithDiscard':
      case 'cycleCards':
      case 'setAside':
        aim.cards = { from: 'hand', min: 1, max: n(p.swaps, n(p.max, 1)) };
        break;
      case 'mulligan':
        aim.cards = { from: 'hand', min: 0, max: n(p.keep) };
        break;
      case 'takeFromDiscard':
        if (p.top === undefined) aim.cards = { from: 'discard', min: 1, max: n(p.count, 1), depth: n(p.depth, 99) };
        break;
      case 'destroyCard':
        aim.cards = { from: place === 'duel' ? 'hand' : 'deck', min: 1, max: n(p.count, 1) };
        break;
      case 'deckToPage':
        aim.cards = { from: 'deck', min: 1, max: n(p.count, 1) };
        aim.pages = { count: 1, stage: false };
        break;
      case 'movePieces':
        aim.pages = { count: 2, stage: true, stageOptional: p.anyMaterial === true };
        break;
      case 'chooseOne':
        if (p.both !== true) aim.options = ((p.options ?? []) as { type: string; params?: Record<string, unknown> }[]).map(optionLabel);
        break;
      case 'disableTwist': {
        const twists = state.duel?.modifiers ?? [];
        if (p.choose === true && n(p.count, 1) < twists.length) {
          aim.options = twists.map((m) => engine.content.bossModifiers.find((b) => b.id === m.modifierId)?.name ?? m.modifierId);
        }
        break;
      }
      case 'checkParcel':
        aim.parcels = 1;
        break;
      case 'unwrapParcels':
        aim.parcels = n(p.count, 1);
        break;
    }
  }
  return aim;
}

/**
 * Your gadgets that work here, each with a Use button. Gadgets that need
 * picks open a small form. On a lot, `parcel`/`nodeId` are the parcel you
 * have chosen and the stop it's at.
 */
export function GadgetList({
  title = 'Gadgets',
  parcel,
  nodeId,
  compact,
  only,
}: {
  title?: string;
  parcel?: number;
  nodeId?: string;
  compact?: boolean;
  /** Show only these items' gadgets. */
  only?: (item: ItemInstance) => boolean;
}) {
  const { state, me, engine } = useGame();
  const [aiming, setAiming] = useState<string | null>(null);
  const here = placesNow(state, nodeId ? { nodeId } : {});
  const usable = me.items.filter((it) => {
    const def = engine.content.items.find((d) => d.id === it.itemId);
    if (!def?.gadget || (only && !only(it))) return false;
    const g = gadgetAt(engine.content, me, it);
    return here.some((p) => g.places.includes(p));
  });
  if (usable.length === 0) return null;
  return (
    <div className={`panel gadgets ${compact ? 'compact' : ''}`}>
      <b>{title}</b> <span className="muted small-text">Charges don't refill after a fight.</span>
      <div className="gadget-list">
        {usable.map((it) => (
          <GadgetButton key={it.uid} item={it} aiming={aiming === it.uid} setAiming={(on) => setAiming(on ? it.uid : null)} parcel={parcel} nodeId={nodeId} />
        ))}
      </div>
    </div>
  );
}

function GadgetButton({ item, aiming, setAiming, parcel, nodeId }: { item: ItemInstance; aiming: boolean; setAiming: (on: boolean) => void; parcel?: number; nodeId?: string }) {
  const { state, me, engine, act, playerId } = useGame();
  const g = gadgetAt(engine.content, me, item);
  const place = placesNow(state, nodeId ? { nodeId } : {}).find((p) => g.places.includes(p))!;
  const aim = aimFor(engine, state, me, item, place);
  const text = itemText(engine, item);
  const max = maxCharges(engine.content, state.config, item, me) ?? 0;
  const free = state.duel?.fx.freeUses;
  const covered = place === 'duel' && !!free && free.count > 0 && free.sourceUid !== item.uid && (free.collection === 'any' || free.collection === text.def.collection);
  const noCharge = (item.charges ?? 0) <= 0 && !covered;
  const needsForm = aim.opponent || !!aim.cards || !!aim.options || !!aim.pages || (!!aim.parcels && (aim.parcels > 1 || parcel === undefined));
  const fire = (args: GadgetArgs) => {
    if (act({ type: 'USE_GADGET', playerId, itemUid: item.uid, ...args })) setAiming(false);
  };
  return (
    <div className={`gadget ${aiming ? 'selected' : ''}`}>
      <button
        className="gadget-use"
        disabled={noCharge}
        title={`${text.def.name} (${text.tierName}): ${text.gadget}`}
        onClick={() => (needsForm ? setAiming(!aiming) : fire({ nodeId, parcels: parcel !== undefined ? [parcel] : undefined }))}
      >
        <b>{g.gadget.name}</b> <Charges have={item.charges ?? 0} max={max} />
        {covered && <span className="block-badge">free</span>}
        <span className="small-text muted">
          {item.material} {text.def.name}
        </span>
        <span className="small-text">{text.gadget}</span>
      </button>
      {aiming && <AimForm item={item} aim={aim} parcel={parcel} nodeId={nodeId} onFire={fire} onCancel={() => setAiming(false)} />}
    </div>
  );
}

function AimForm({ item, aim, parcel, nodeId, onFire, onCancel }: { item: ItemInstance; aim: Aim; parcel?: number; nodeId?: string; onFire: (a: GadgetArgs) => void; onCancel: () => void }) {
  const { state, me, engine } = useGame();
  const duel = state.duel;
  const [target, setTarget] = useState<number | undefined>(aim.opponent && duel?.opponents.length === 1 ? 0 : undefined);
  const [cards, setCards] = useState<CardId[]>([]);
  const [values, setValues] = useState<number[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [option, setOption] = useState<number | undefined>(aim.options ? 0 : undefined);
  const [parcels, setParcels] = useState<number[]>(parcel !== undefined ? [parcel] : []);
  const [pages, setPages] = useState<string[]>([]);
  const [stage, setStage] = useState<number | undefined>(undefined);

  const zone: CardId[] =
    aim.cards?.from === 'hand' ? (duel?.hand ?? []) : aim.cards?.from === 'discard' ? [...(duel?.discard ?? [])].slice(-(aim.cards.depth ?? 99)).reverse() : aim.cards?.from === 'deck' ? me.deck : [];
  const toggleCard = (id: CardId) =>
    setCards((c) => {
      if (c.includes(id)) {
        const i = c.indexOf(id);
        setValues((v) => v.filter((_, j) => j !== i));
        setMaterials((m) => m.filter((_, j) => j !== i));
        return c.filter((x) => x !== id);
      }
      if (c.length >= (aim.cards?.max ?? 0)) return c;
      setValues((v) => [...v, aim.cards?.shiftZero ? 0 : 1]);
      setMaterials((m) => [...m, engine.content.categories[0].id]);
      return [...c, id];
    });
  const lot = nodeId ? state.map?.rows.flat().find((x) => x.id === nodeId)?.encounter?.lot : state.rummage?.lot;
  const myPages = scrapbookPages(engine.content, me);
  const pageName = (id: string) => engine.content.items.find((d) => d.id === id)?.name ?? id;
  const ready =
    (!aim.opponent || target !== undefined) &&
    (!aim.cards || (cards.length >= aim.cards.min && cards.length <= aim.cards.max)) &&
    (!aim.parcels || parcels.length > 0) &&
    (!aim.pages || (pages.length === aim.pages.count && (!aim.pages.stage || aim.pages.stageOptional || stage !== undefined)));

  return (
    <div className="aim">
      {aim.opponent && duel && (
        <div className="aim-row">
          <span className="eyebrow">Opponent</span>
          {duel.opponents.map((o, i) => (
            <button key={i} className={target === i ? 'active' : ''} onClick={() => setTarget(i)}>
              {o.name}
            </button>
          ))}
        </div>
      )}
      {aim.options && (
        <div className="aim-row">
          <span className="eyebrow">Choose</span>
          {aim.options.map((label, i) => (
            <button key={i} className={option === i ? 'active' : ''} onClick={() => setOption(i)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {aim.cards && (
        <div className="aim-row column">
          <span className="eyebrow">
            {aim.cards.min === aim.cards.max ? `Choose ${aim.cards.max}` : `Choose up to ${aim.cards.max}`} from your {aim.cards.from === 'discard' ? 'discard pile (top first)' : aim.cards.from}
          </span>
          <div className="cards small">
            {zone.map((id) => (
              <CardView key={id} id={id} selected={cards.includes(id)} onClick={() => toggleCard(id)} />
            ))}
          </div>
          {(aim.cards.shift || aim.cards.materials) &&
            cards.map((id, i) => (
              <div key={id} className="aim-row">
                <CardView id={id} />
                {aim.cards!.materials && (
                  <select value={materials[i]} onChange={(e) => setMaterials((m) => m.map((x, j) => (j === i ? e.target.value : x)))}>
                    {engine.content.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                {!!aim.cards!.shift && (
                  <select value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? Number(e.target.value) : x)))}>
                    {Array.from({ length: aim.cards!.shift * 2 + 1 }, (_, k) => k - aim.cards!.shift!)
                      .filter((v) => aim.cards!.shiftZero || v !== 0)
                      .map((v) => (
                        <option key={v} value={v}>
                          {v > 0 ? `+${v}` : v === 0 ? 'same number' : v}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            ))}
        </div>
      )}
      {aim.parcels && lot && (
        <div className="aim-row">
          <span className="eyebrow">Parcels (up to {aim.parcels})</span>
          {lot.parcels.map((_, i) => (
            <button
              key={i}
              className={parcels.includes(i) ? 'active' : ''}
              onClick={() => setParcels((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < aim.parcels! ? [...p, i] : p))}
            >
              #{i + 1}
            </button>
          ))}
        </div>
      )}
      {aim.pages && (
        <div className="aim-row">
          <span className="eyebrow">{aim.pages.count === 2 ? 'From page, to page' : 'Onto page'}</span>
          <select value={pages[0] ?? ''} onChange={(e) => setPages((p) => [e.target.value, ...p.slice(1)].filter(Boolean))}>
            <option value="">choose…</option>
            {myPages.map((id) => (
              <option key={id} value={id}>
                {pageName(id)}
              </option>
            ))}
          </select>
          {aim.pages.count === 2 && (
            <select value={pages[1] ?? ''} onChange={(e) => setPages((p) => [p[0] ?? '', e.target.value].filter(Boolean))}>
              <option value="">choose…</option>
              {myPages
                .filter((id) => id !== pages[0])
                .map((id) => (
                  <option key={id} value={id}>
                    {pageName(id)}
                  </option>
                ))}
            </select>
          )}
          {aim.pages.stage && pages[0] && (
            <select value={stage ?? ''} onChange={(e) => setStage(e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">{aim.pages.stageOptional ? 'any unfinished stage' : 'stage…'}</option>
              {Array.from({ length: STAGES }, (_, i) => i + 1)
                .filter((s) => {
                  const have = pageOf(me, pages[0])[s - 1];
                  return have > 0 && have < piecesNeeded(state.config, s);
                })
                .map((s) => (
                  <option key={s} value={s}>
                    {materialName(engine.content, state.config, s)} ({pageOf(me, pages[0])[s - 1]} pieces)
                  </option>
                ))}
            </select>
          )}
        </div>
      )}
      <div className="aim-row">
        <button
          className="primary"
          disabled={!ready}
          onClick={() =>
            onFire({
              target,
              option,
              cards: aim.cards ? cards : undefined,
              values: aim.cards?.shift ? values : undefined,
              materials: aim.cards?.materials ? materials : undefined,
              parcels: aim.parcels ? parcels : undefined,
              nodeId,
              pages: aim.pages ? pages : undefined,
              stage,
            })
          }
        >
          Use it
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      <span className="muted small-text">{itemText(engine, item).gadget}</span>
    </div>
  );
}

/** A choice a gadget or passive opened in a duel: pick cards, put cards in order, or say yes or no. */
export function DuelChoicePanel() {
  const { state, act, playerId } = useGame();
  const choice = state.duel?.choice;
  const [picked, setPicked] = useState<CardId[]>([]);
  const [order, setOrder] = useState<CardId[] | null>(null);
  const [bottom, setBottom] = useState<CardId[]>([]);
  const [discard, setDiscard] = useState<CardId[]>([]);
  if (!choice) return null;
  const answer = (a: { cardIds?: CardId[]; bottom?: CardId[]; discard?: CardId[]; confirm?: boolean }) => {
    if (act({ type: 'DUEL_CHOOSE', playerId, ...a })) {
      setPicked([]);
      setOrder(null);
      setBottom([]);
      setDiscard([]);
    }
  };

  if (choice.kind === 'confirm') {
    return (
      <div className="panel choice">
        <b>{choice.prompt}</b>
        <div className="cards small">
          {choice.cardIds.map((id) => (
            <CardView key={id} id={id} />
          ))}
        </div>
        <div className="actions">
          <button className="primary" onClick={() => answer({ confirm: true })}>
            Yes
          </button>
          <button onClick={() => answer({ confirm: false })}>No, put it back</button>
        </div>
      </div>
    );
  }

  if (choice.kind === 'pick') {
    const toggle = (id: CardId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < choice.max ? [...p, id] : p));
    return (
      <div className="panel choice">
        <b>{choice.prompt}</b>
        <div className="cards">
          {choice.cardIds.map((id) => (
            <CardView key={id} id={id} selected={picked.includes(id)} onClick={() => toggle(id)} />
          ))}
        </div>
        <button className="primary" disabled={picked.length < choice.min || picked.length > choice.max} onClick={() => answer({ cardIds: picked })}>
          Choose {picked.length}/{choice.max}
        </button>
      </div>
    );
  }

  // Order: top card first. Cards can be moved, or sent to the bottom / discard pile if allowed.
  const top = (order ?? choice.cardIds).filter((id) => !bottom.includes(id) && !discard.includes(id));
  const move = (id: CardId, d: -1 | 1) => {
    const list = [...top];
    const i = list.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder([...list, ...bottom, ...discard]);
  };
  const flip = (id: CardId, list: CardId[], set: (v: CardId[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="panel choice">
      <b>{choice.prompt}</b> <span className="muted small-text">Left is the top of your draw pile.</span>
      <div className="order-list">
        {(order ?? choice.cardIds).map((id) => {
          const where = bottom.includes(id) ? 'bottom' : discard.includes(id) ? 'discard' : 'top';
          return (
            <div key={id} className={`order-item ${where}`}>
              <CardView id={id} dim={where !== 'top'} />
              {where === 'top' && (
                <div className="actions small">
                  <button onClick={() => move(id, -1)}>←</button>
                  <button onClick={() => move(id, 1)}>→</button>
                </div>
              )}
              {choice.allowBottom && <button onClick={() => flip(id, bottom, setBottom)}>{where === 'bottom' ? 'Keep on top' : 'To the bottom'}</button>}
              {choice.allowDiscard && <button onClick={() => flip(id, discard, setDiscard)}>{where === 'discard' ? 'Keep' : 'Discard'}</button>}
            </div>
          );
        })}
      </div>
      <button className="primary" onClick={() => answer({ cardIds: top, bottom, discard })}>
        Done
      </button>
    </div>
  );
}

/** Gadgets and their charges, with paid recharging (map and shop). */
export function RechargePanel() {
  const { state, me, engine, act, playerId } = useGame();
  const gadgets = me.items.filter((it) => engine.content.items.find((d) => d.id === it.itemId)?.gadget);
  if (gadgets.length === 0) return null;
  return (
    <div className="panel gadgets">
      <b>Recharge</b> <span className="muted">Charges don't refill after a fight. Recharge here for credits, or for free at a rest stop.</span>
      <ul className="gadget-rows">
        {gadgets.map((it) => {
          const t = itemText(engine, it);
          const max = maxCharges(engine.content, state.config, it, me) ?? 0;
          const cost = rechargeCost(engine.content, state.config, it, me);
          const full = (it.charges ?? 0) >= max;
          return (
            <li key={it.uid}>
              <b>
                {it.material} {t.def.name}
              </b>{' '}
              <span className="muted">({t.def.gadget!.name})</span> <Charges have={it.charges ?? 0} max={max} />{' '}
              <span className="muted small-text">{t.gadget}</span>
              <span className="spacer" />
              <button disabled={full || me.currency < cost} onClick={() => act({ type: 'RECHARGE', playerId, itemUid: it.uid })}>
                {full ? 'Full' : `${t.def.gadget!.rechargeName} (${cost} credits)`}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

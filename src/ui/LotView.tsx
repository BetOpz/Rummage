import {
  CATALOGUE_NAMES,
  type Encounter,
  type Lot,
  type RewardOption,
  catalogueFor,
  eligibleStakeCards,
  partName,
  pieceNoun,
  pieceVisibility,
} from '../engine';
import { useGame } from './context';

/** A found piece (not yet a card), shown as a small tag. `show` hides what the catalogue doesn't reveal. */
export function PieceView({ piece, show = 'full' }: { piece: RewardOption; show?: ReturnType<typeof pieceVisibility> }) {
  const { engine } = useGame();
  if (show === 'hidden') {
    return (
      <div className="card piece hidden-piece" title="Sealed: you won't know until you open it">
        <div className="gauge">?</div>
      </div>
    );
  }
  if (piece.kind === 'special') {
    const def = engine.content.specials.find((s) => s.id === piece.specialId);
    if (show !== 'full') {
      return (
        <div className="card piece hidden-piece" title="Something small, wrapped in newspaper">
          <div className="gauge">?</div>
          <div className="name">wrapped</div>
        </div>
      );
    }
    return (
      <div className="card special piece" title={def?.text}>
        <div className="special-name">{def?.name}</div>
      </div>
    );
  }
  const cat = engine.content.categories.find((c) => c.id === piece.category);
  if (show === 'part') {
    return (
      <div className="card piece hidden-piece" title="Contents only: the metal isn't listed">
        <div className="gauge">?</div>
        <div className="name">{pieceNoun(engine.content, piece)}</div>
      </div>
    );
  }
  const metalOnly = show === 'metal';
  const noun = partName(engine.content, piece.category!, piece.gauge!).split(' ').slice(1).join(' ');
  return (
    <div
      className="card part piece"
      data-cat={piece.category}
      style={{ ['--cat' as string]: cat?.color ?? '#888' }}
      title={metalOnly ? `A ${cat?.name} piece` : `${cat?.name} ${noun} ${piece.gauge}`}
    >
      <div className="gauge">{metalOnly ? '?' : piece.gauge}</div>
      <div className="cat">{cat?.name}</div>
      <div className="name">{metalOnly ? 'something' : noun}</div>
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A lot as the catalogue describes it. */
export function LotCard({ lot }: { lot: Lot }) {
  const { engine, me } = useGame();
  const def = engine.content.lots.find((l) => l.id === lot.lotId);
  const level = catalogueFor(engine.content, me, lot);
  return (
    <div className="lot">
      <div className="lot-head">
        <b className="lot-name">{lot.name}</b>
        <span className={`catalogue c${level}`}>{CATALOGUE_NAMES[level]}</span>
        {level < lot.catalogue && <span className="muted small-text">(Magnifier: was {CATALOGUE_NAMES[lot.catalogue].toLowerCase()})</span>}
      </div>
      {def && <div className="muted small-text">{def.text}</div>}
      {level === 4 ? (
        <div className="sealed">
          {lot.sizeRange[0]}–{lot.sizeRange[1]} pieces. Each has a <b>{pct(lot.rareChance)}</b> chance of being Brass or better
          {lot.gemChance > 0 && (
            <>
              , and there's a <b>{pct(lot.gemChance)}</b> chance of a gem
            </>
          )}
          .
        </div>
      ) : (
        <div className="cards small lot-pieces">
          {lot.pieces.map((p, i) => (
            <PieceView key={i} piece={p} show={pieceVisibility(lot, i, level)} />
          ))}
        </div>
      )}
      <div className="muted small-text">Rare pieces sit at the bottom of the box: go out well to dig deep.</div>
    </div>
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

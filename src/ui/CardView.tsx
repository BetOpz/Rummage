import type { CardId } from '../engine';
import { useGame } from './context';

interface Props {
  id: CardId;
  selected?: boolean;
  dim?: boolean;
  /** Counts toward the current blueprint (shown as a dot). */
  wanted?: boolean;
  /** Doesn't fit the meld it's in (shown with a warning outline). */
  misfit?: boolean;
  badge?: string;
  onClick?: () => void;
  title?: string;
}

export function CardView({ id, selected, dim, wanted, misfit, badge, onClick, title }: Props) {
  const { state, engine } = useGame();
  const card = state.cards[id];
  if (!card) return null;

  const classes = ['card', card.kind];
  if (selected) classes.push('selected');
  if (dim) classes.push('dim');
  if (wanted) classes.push('wanted');
  if (misfit) classes.push('misfit');
  if (card.temporary) classes.push('temporary');
  if (onClick) classes.push('clickable');

  if (card.kind === 'part') {
    const cat = engine.content.categories.find((c) => c.id === card.category);
    return (
      <div className={classes.join(' ')} data-cat={card.category} style={{ ['--cat' as string]: cat?.color ?? '#888' }} onClick={onClick} title={title ?? card.name}>
        <div className="gauge">{card.gauge}</div>
        <div className="cat">{cat?.name ?? card.category}</div>
        <div className="name">{card.name.split(' ').slice(1).join(' ')}</div>
        {badge && <div className="badge">{badge}</div>}
      </div>
    );
  }

  const def = engine.content.specials.find((s) => s.id === card.specialId);
  return (
    <div className={classes.join(' ')} onClick={onClick} title={title ?? def?.text}>
      <div className="special-name">{def?.name ?? card.specialId}</div>
      <div className="special-text">{def?.text}</div>
      {card.temporary && <div className="badge">temp</div>}
      {badge && <div className="badge">{badge}</div>}
    </div>
  );
}

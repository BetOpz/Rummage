import { type ItemInstance, maxCharges, rechargeCost } from '../engine';
import { itemText } from './Gadgets';
import { useGame } from './context';

/** Compact item label: material, name, level and charges/uses, with the card text at its tier on hover. */
export function ItemChip({ item }: { item: ItemInstance }) {
  const { engine, state, me } = useGame();
  const t = itemText(engine, item);
  const def = t.def;
  const rummy = state.config.battleStyle === 'rummy';
  const battle = def?.battle;
  const gadget = def?.gadget;
  const max = maxCharges(engine.content, state.config, item, me);
  const lines = [`${item.material} ${def?.name} (${t.tierName}, grade ${item.grade}${item.level > 1 ? `, level ${item.level}` : ''})`, `Passive: ${t.passive}`];
  if (rummy) {
    lines.push(
      gadget
        ? `Gadget: ${gadget.name} — ${t.gadget} (${item.charges ?? 0}/${max} charges; ${gadget.rechargeName} costs ${rechargeCost(engine.content, state.config, item, me)})`
        : 'No gadget (a fixture)',
    );
  } else {
    lines.push(battle ? `Battle card: ${battle.name} (${battle.cost} energy) — ${battle.text}` : 'No battle card');
    lines.push(item.usesLeft !== null ? `${item.usesLeft} uses left before it breaks` : 'Never breaks');
  }
  const low = rummy ? gadget && (item.charges ?? 0) === 0 : item.usesLeft === 1;
  return (
    <span className={`item-chip grade-${Math.min(item.grade, 8)} ${low ? 'fragile' : ''}`} title={lines.join('\n')}>
      {item.material} {def?.name ?? item.itemId}
      {item.level > 1 && <sup> L{item.level}</sup>}
      {rummy && gadget && (
        <span className="uses">
          {' '}
          · {item.charges ?? 0}/{max}
        </span>
      )}
      {!rummy && item.usesLeft !== null && <span className="uses"> · {item.usesLeft}×</span>}
    </span>
  );
}

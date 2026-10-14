import type { ItemInstance } from '../engine';
import { useGame } from './context';

/** Compact item label: name, level and uses/charges left, with full details on hover. */
export function ItemChip({ item }: { item: ItemInstance }) {
  const { engine, state } = useGame();
  const def = engine.content.items.find((d) => d.id === item.itemId);
  const rummy = state.config.battleStyle === 'rummy';
  const battle = def?.battle;
  const gadget = def?.gadget;
  const lines = [`${def?.name} (level ${item.level})`, `Passive: ${def?.text}`];
  if (rummy) {
    lines.push(gadget ? `Gadget: ${gadget.name} — ${gadget.text} (${item.charges ?? 0}/${gadget.charges} charges; ${gadget.rechargeName} costs ${gadget.rechargeCost})` : 'No gadget');
  } else {
    lines.push(battle ? `Battle card: ${battle.name} (${battle.cost} energy) — ${battle.text}` : 'No battle card');
    lines.push(item.usesLeft !== null ? `${item.usesLeft} uses left before it breaks` : 'Never breaks');
  }
  const low = rummy ? gadget && (item.charges ?? 0) === 0 : item.usesLeft === 1;
  return (
    <span className={`item-chip ${low ? 'fragile' : ''}`} title={lines.join('\n')}>
      {def?.name ?? item.itemId}
      {item.level > 1 && <sup> L{item.level}</sup>}
      {rummy && gadget && <span className="uses"> · {item.charges ?? 0}/{gadget.charges}</span>}
      {!rummy && item.usesLeft !== null && <span className="uses"> · {item.usesLeft}×</span>}
    </span>
  );
}

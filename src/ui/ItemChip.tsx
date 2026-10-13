import type { ItemInstance } from '../engine';
import { useGame } from './context';

/** Compact item label: name, level and uses left, with full details on hover. */
export function ItemChip({ item }: { item: ItemInstance }) {
  const { engine } = useGame();
  const def = engine.content.items.find((d) => d.id === item.itemId);
  const battle = def?.battle;
  const title = [
    `${def?.name} (level ${item.level})`,
    `Passive: ${def?.text}`,
    battle ? `Battle card: ${battle.name} (${battle.cost} energy) — ${battle.text}` : 'No battle card',
    item.usesLeft !== null ? `${item.usesLeft} uses left before it breaks` : 'Never breaks',
  ].join('\n');
  return (
    <span className={`item-chip ${item.usesLeft === 1 ? 'fragile' : ''}`} title={title}>
      {def?.name ?? item.itemId}
      {item.level > 1 && <sup> L{item.level}</sup>}
      {item.usesLeft !== null && <span className="uses"> · {item.usesLeft}×</span>}
    </span>
  );
}

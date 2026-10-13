import { type BlueprintDef, describeRequirement, visibleRequirements } from '../engine';
import { useGame } from './context';

export function BlueprintCard({ bp, revealed, children }: { bp: BlueprintDef; revealed: boolean; children?: React.ReactNode }) {
  const { engine } = useGame();
  const item = engine.content.items.find((i) => i.id === bp.itemId);
  const catName = (id: string) => engine.content.categories.find((c) => c.id === id)?.name ?? id;
  return (
    <div className={`blueprint ${bp.boss ? 'boss' : ''}`}>
      <div className="bp-head">
        <b>{bp.name}</b>
        <span className="muted">tier {bp.tier}{bp.boss ? ' · boss' : ''}</span>
      </div>
      <ul className="reqs">
        {visibleRequirements(bp, revealed).map((r, i) => (
          <li key={i}>{r ? describeRequirement(r, catName) : <span className="muted">??? (hidden)</span>}</li>
        ))}
      </ul>
      <div className="item-reward">
        Builds <b>{item?.name}</b>: <span className="muted">{item?.text}</span>
      </div>
      {children}
    </div>
  );
}

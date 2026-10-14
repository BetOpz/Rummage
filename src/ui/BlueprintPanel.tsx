import { type BuildHints, type MeldHint, describeRequirement, getBlueprint } from '../engine';
import { useGame } from './context';

/** The current target: what it needs, what you have, and what is missing. */
export function BlueprintPanel({ drawsLeft, hints }: { drawsLeft: number; hints: BuildHints | null }) {
  const { me, engine } = useGame();
  const bp = getBlueprint(engine.content, me.target!);
  const item = engine.content.items.find((i) => i.id === bp.itemId);
  const catName = (id: string) => engine.content.categories.find((c) => c.id === id)?.name ?? id;

  return (
    <div className={`panel blueprint-panel ${hints?.ready ? 'ready' : ''}`}>
      <div className="bp-panel-head">
        <span className="eyebrow">Your blueprint</span>
        <b className="bp-name">{bp.name}</b>
        <span className="spacer" />
        <span>
          Draws left <b className={drawsLeft <= 2 ? 'warn' : ''}>{drawsLeft}</b>/{me.rules.drawLimit}
        </span>
      </div>
      <div className="muted small-text">
        Builds <b>{item?.name}</b>: {item?.text}
      </div>
      <ul className="needs">
        {bp.requirements.map((req, i) => {
          const h = hints?.melds[i];
          const done = h ? h.filled >= req.size : false;
          return (
            <li key={i} className={done ? 'done' : ''}>
              <span className="need-chip">{done ? '✓' : `${h?.filled ?? 0}/${req.size}`}</span>
              <span>
                <b>{describeRequirement(req, catName)}</b>
                <span className="muted"> — {req.type === 'set' ? `${req.size} cards with the same number` : `${req.size} cards of one category in a row`}</span>
                <br />
                {h && hintText(h, catName)}
              </span>
            </li>
          );
        })}
      </ul>
      {hints?.ready && <div className="ready-note">You can build it now. Press Auto-fill, then Build it.</div>}
    </div>
  );
}

export function hintText(h: MeldHint, catName: (id: string) => string): string {
  const req = h.requirement;
  const need = req.size - h.filled;
  if (req.type === 'set') {
    if (h.gauge === undefined) return 'Collect cards that share a number.';
    if (need <= 0) return `Complete: ${h.have ?? req.size} × ${h.gauge}.`;
    const what = req.category ? `${catName(req.category)} ${h.gauge}` : `${h.gauge} (any category)`;
    return `You have ${h.filled} × ${h.gauge}. Need ${need} more ${what}.`;
  }
  if (!h.category || !h.missingGauges) {
    return req.category ? `Collect ${catName(req.category)} cards with numbers in a row.` : 'Collect cards of one category with numbers in a row.';
  }
  if (need <= 0) return `Complete: ${catName(h.category)} run of ${h.cardIds.length}.`;
  return `Need ${h.missingGauges.map((g) => `${catName(h.category!)} ${g}`).join(', ')}.`;
}

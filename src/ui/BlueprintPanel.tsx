import { type BuildHints, type GameState, type MeldHint, type MeldRequirement, getBlueprint } from '../engine';
import { useGame } from './context';
import { ReqLabel } from './ReqLabel';

/** The current target: what it needs, what you have, and what is missing. */
export function BlueprintPanel({ drawsLeft, hints }: { drawsLeft: number; hints: BuildHints | null }) {
  const { state, me, engine } = useGame();
  const bp = getBlueprint(engine.content, me.target!);
  const item = engine.content.items.find((i) => i.id === bp.itemId);
  const catName = (id: string) => engine.content.categories.find((c) => c.id === id)?.name ?? id;
  const warnings = hints ? shapeWarnings(state, me.hand, bp.requirements, hints, catName) : [];

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
        Builds <b>{item?.name}</b>: {item?.text} You need <b>every</b> meld below, each in its own shape.
      </div>
      <ul className="needs">
        {bp.requirements.map((req, i) => {
          const h = hints?.melds[i];
          const done = h ? h.filled >= req.size : false;
          return (
            <li key={i} className={done ? 'done' : ''}>
              <span className="need-chip">{done ? '✓' : `${h?.filled ?? 0}/${req.size}`}</span>
              <span>
                <ReqLabel req={req} />
                <br />
                {h && hintText(h, catName)}
              </span>
            </li>
          );
        })}
      </ul>
      {warnings.map((w, i) => (
        <div key={i} className="shape-warning">
          {w}
        </div>
      ))}
      {hints?.ready && (
        <div className="ready-note">You can build it now. Press “Find a build for me”, or tap the cards yourself, then Build it.</div>
      )}
    </div>
  );
}

/**
 * Catch the classic rummy mix-up: melds of the wrong shape. E.g. holding
 * 3 × 7 (a set) when the blueprint still needs a run.
 */
function shapeWarnings(
  state: GameState,
  hand: string[],
  reqs: MeldRequirement[],
  hints: BuildHints,
  catName: (id: string) => string,
): string[] {
  const parts = hand.map((id) => state.cards[id]).filter((c) => c?.kind === 'part') as { id: string; category: string; gauge: number }[];
  // Cards already filling a set, and cards already filling a run.
  const inSets = new Set(hints.melds.filter((m) => m.requirement.type === 'set').flatMap((m) => m.cardIds));
  const inRuns = new Set(hints.melds.filter((m) => m.requirement.type === 'run').flatMap((m) => m.cardIds));
  const out: string[] = [];

  const runShort = reqs.some((r, i) => r.type === 'run' && hints.melds[i].filled < r.size);
  const setShort = reqs.some((r, i) => r.type === 'set' && hints.melds[i].filled < r.size);

  if (runShort) {
    // Same-number groups of 3+ that aren't already doing a set's job.
    const counts = new Map<number, number>();
    for (const p of parts) if (!inSets.has(p.id)) counts.set(p.gauge, (counts.get(p.gauge) ?? 0) + 1);
    const groups = [...counts].filter(([, n]) => n >= 3).map(([g, n]) => `${n} × ${g}`);
    if (groups.length > 0) {
      const run = reqs.find((r) => r.type === 'run')!;
      out.push(
        `Your ${groups.join(' and ')} ${groups.length === 1 ? 'is a set' : 'are sets'} (same number). This blueprint also needs a run: ${run.size} cards of ${run.category ? catName(run.category) : 'one category'} with numbers in a row.`,
      );
    }
  }
  if (setShort) {
    // Runs of 3+ in one category that aren't already doing a run's job.
    const byCat = new Map<string, Set<number>>();
    for (const p of parts) {
      if (inRuns.has(p.id)) continue;
      if (!byCat.has(p.category)) byCat.set(p.category, new Set());
      byCat.get(p.category)!.add(p.gauge);
    }
    for (const [cat, gauges] of byCat) {
      const sorted = [...gauges].sort((a, b) => a - b);
      let start = 0;
      for (let i = 1; i <= sorted.length; i++) {
        if (i === sorted.length || sorted[i] !== sorted[i - 1] + 1) {
          if (i - start >= 3) {
            const set = reqs.find((r) => r.type === 'set')!;
            out.push(
              `Your ${catName(cat)} ${sorted.slice(start, i).join('·')} is a run (numbers in a row). This blueprint also needs a set: ${set.size} cards with the same number.`,
            );
          }
          start = i;
        }
      }
    }
  }
  return out;
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
  return `Need ${h.missingGauges.map((g) => `${catName(h.category!)} ${g}`).join(', ')} to join up the run.`;
}

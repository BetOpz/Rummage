import type { MeldRequirement } from '../engine';
import { useGame } from './context';

/**
 * A meld requirement shown so its shape is unmistakable: a SET/RUN tag,
 * the rule in words, and a mini example of matching cards.
 */
export function ReqLabel({ req, compact = false }: { req: MeldRequirement; compact?: boolean }) {
  const { engine } = useGame();
  const cats = engine.content.categories.filter((c) => !c.rare);
  const catOf = (id: string) => engine.content.categories.find((c) => c.id === id);
  const fixed = req.category ? catOf(req.category) : undefined;
  const isSet = req.type === 'set';

  // Example cards: a set is one number across categories; a run is one category counting up.
  const lo = req.minGauge ?? (isSet ? 7 : 4);
  const exampleGauge = Math.min(Math.max(lo, req.minGauge ?? lo), req.maxGauge ?? 10);
  const startRun = Math.min(Math.max(req.minGauge ?? 4, 1), (req.maxGauge ?? 10) - req.size + 1);
  const example = Array.from({ length: req.size }, (_, i) =>
    isSet
      ? { gauge: exampleGauge, color: (fixed ?? cats[i % cats.length])?.color }
      : { gauge: startRun + i, color: (fixed ?? cats.find((c) => c.id === 'copper') ?? cats[0])?.color },
  );

  const rule = isSet
    ? `${req.size} cards with the same number${fixed ? `, all ${fixed.name}` : ', any category'}`
    : `${req.size} ${fixed ? fixed.name : 'cards of one category'} with numbers in a row`;
  const gaugeNote =
    req.minGauge !== undefined && req.maxGauge !== undefined
      ? ` (numbers ${req.minGauge}-${req.maxGauge})`
      : req.minGauge !== undefined
        ? ` (numbers ${req.minGauge}+)`
        : req.maxGauge !== undefined
          ? ` (numbers ${req.maxGauge} or less)`
          : '';

  return (
    <span className={`req ${compact ? 'compact' : ''}`}>
      <span className={`req-kind ${req.type}`}>{isSet ? 'SET' : 'RUN'}</span>
      <span className="req-rule">
        {rule}
        {gaugeNote}
      </span>
      {!compact && (
        <span className="req-eg" aria-label="example">
          e.g.
          {example.map((e, i) => (
            <span key={i} className="mini-card" style={{ ['--cat' as string]: e.color }}>
              {e.gauge}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

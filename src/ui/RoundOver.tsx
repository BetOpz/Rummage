import { getBlueprint } from '../engine';
import { useGame } from './context';

export function RoundOver() {
  const { state, me, engine, act, playerId } = useGame();
  const result = state.lastResult!;
  const mine = result.perPlayer[playerId];
  const bp = result.blueprintId ? getBlueprint(engine.content, result.blueprintId) : null;
  const item = mine.itemId ? engine.content.items.find((i) => i.id === mine.itemId) : null;
  return (
    <div className="panel summary">
      <h2>{mine.built ? `Built: ${bp?.name}` : 'Round failed'}</h2>
      {mine.built ? (
        <p>
          New item: <b>{item?.name}</b> — {item?.text}
          <br />
          Reward: <b>{mine.reward}</b> currency (deadwood {mine.deadwood}).
        </p>
      ) : (
        <p>
          You ran out of draws. Deadwood {mine.deadwood}.{' '}
          {mine.lifeLost && (
            <>
              Lost a life — <b>{me.lives}</b> left.
            </>
          )}
        </p>
      )}
      <button className="primary" onClick={() => act({ type: 'CONTINUE', playerId })}>
        Continue
      </button>
    </div>
  );
}

export function RunOver({ onNewRun }: { onNewRun: () => void }) {
  const { state, me, engine } = useGame();
  const won = state.phase === 'runWon';
  return (
    <div className="panel summary">
      <h2>{won ? 'Run complete!' : 'Run over'}</h2>
      <p>
        Reached tier {state.tier + 1}, round {state.round + 1}. Score {me.score}. Items built: {me.items.length}.
      </p>
      <ul>
        {me.items.map((it, i) => (
          <li key={i}>
            {engine.content.items.find((d) => d.id === it.itemId)?.name} (from{' '}
            {engine.content.blueprints.find((b) => b.id === it.fromBlueprint)?.name}, {it.builtFrom} parts)
          </li>
        ))}
      </ul>
      <button className="primary" onClick={onNewRun}>
        New run
      </button>
    </div>
  );
}

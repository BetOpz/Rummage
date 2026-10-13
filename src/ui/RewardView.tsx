import { partName } from '../engine';
import { useGame } from './context';

export function RewardView() {
  const { state, engine, act, playerId } = useGame();
  const reward = state.reward!;
  return (
    <div className="panel summary">
      <h2>{reward.kind === 'boss' ? 'Boss defeated!' : 'Victory!'}</h2>
      <p>
        +<b>{reward.currency}</b> currency. Choose one card for your parts deck, or skip.
      </p>
      <div className="reward-options">
        {reward.options.map((o, i) => {
          const cat = o.category ? engine.content.categories.find((c) => c.id === o.category) : null;
          const sp = o.specialId ? engine.content.specials.find((s) => s.id === o.specialId) : null;
          return (
            <button key={i} className="reward-option" onClick={() => act({ type: 'TAKE_REWARD', playerId, index: i })}>
              {o.kind === 'part' ? (
                <>
                  <span className="swatch" style={{ background: cat?.color }} /> {partName(engine.content, o.category!, o.gauge!)}{' '}
                  <b>({o.gauge})</b>
                </>
              ) : (
                <>
                  <b>{sp?.name}</b> <span className="muted">{sp?.text}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <button onClick={() => act({ type: 'TAKE_REWARD', playerId, index: null })}>Skip</button>
    </div>
  );
}

import { getBlueprint } from '../engine';
import { BlueprintCard } from './BlueprintCard';
import { useGame } from './context';

export function BlueprintSelect() {
  const { state, me, engine, act, playerId } = useGame();
  const offers = state.roundState!.offers.map((id) => getBlueprint(engine.content, id));
  return (
    <div className="panel">
      <h2>{state.roundState!.isBoss ? 'Boss blueprint' : 'Choose a blueprint'}</h2>
      <p className="muted">
        Hand size {me.rules.handSize}, {me.rules.drawLimit} draws this round.
        {offers.length > 1 && ' You can pivot to another offered blueprint mid-round, at a cost.'}
      </p>
      <div className="blueprints">
        {offers.map((bp) => (
          <BlueprintCard key={bp.id} bp={bp} revealed={me.rules.revealHidden}>
            <button className="primary" onClick={() => act({ type: 'SELECT_BLUEPRINT', playerId, blueprintId: bp.id })}>
              Build this
            </button>
          </BlueprintCard>
        ))}
      </div>
    </div>
  );
}

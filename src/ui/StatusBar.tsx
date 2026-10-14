import { useGame } from './context';
import { ItemChip } from './ItemChip';

export function StatusBar() {
  const { state, me, engine } = useGame();
  const cfg = state.config;
  const isMap = cfg.runStructure === 'map';
  const boss = state.roundState?.boss;
  const bossDef = boss ? engine.content.bossModifiers.find((b) => b.id === boss.modifierId) : null;
  const catName = (id: unknown) => engine.content.categories.find((c) => c.id === id)?.name ?? String(id);
  const hpPct = Math.max(0, Math.round((me.hp / me.maxHp) * 100));
  return (
    <div className="panel status">
      {isMap ? (
        <>
          <span>
            Act <b>{state.tier + 1}</b>/{cfg.tiers}
          </span>
          {cfg.battleStyle === 'rummy' ? (
            <span title="Losing a boss duel costs a life">
              Lives <b>{me.lives}</b>
            </span>
          ) : (
            <span className="hp-stat" title={`${me.hp} of ${me.maxHp} HP`}>
              HP <b>{me.hp}</b>/{me.maxHp}
              <span className="hpbar small">
                <span style={{ width: `${hpPct}%` }} />
              </span>
            </span>
          )}
        </>
      ) : (
        <>
          <span>
            Tier <b>{state.tier + 1}</b>/{cfg.tiers}
          </span>
          <span>
            Round <b>{state.round + 1}</b>/{cfg.normalRoundsPerTier + 1}
            {state.round >= cfg.normalRoundsPerTier ? ' (boss)' : ''}
          </span>
          <span>
            Lives <b>{me.lives}</b>
          </span>
        </>
      )}
      <span>
        Credits <b>{me.currency}</b>
      </span>
      {cfg.scoring === 'points' && (
        <span>
          Score <b>{me.score}</b>
        </span>
      )}
      <span title="Cards in your parts deck (used in workshops)">
        Parts <b>{me.deck.length}</b>
      </span>
      {bossDef && (
        <span className="boss-mod" title={bossDef.text}>
          Hazard: <b>{bossDef.name}</b>
          {typeof boss!.params.category === 'string' ? ` (${catName(boss!.params.category)})` : ''} — {bossDef.text}
        </span>
      )}
      {me.items.length > 0 && (
        <span className="items">
          Items: {me.items.map((it) => <ItemChip key={it.uid} item={it} />)}
        </span>
      )}
    </div>
  );
}

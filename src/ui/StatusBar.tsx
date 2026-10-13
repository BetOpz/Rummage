import { useGame } from './context';

export function StatusBar() {
  const { state, me, engine } = useGame();
  const cfg = state.config;
  const boss = state.roundState?.boss;
  const bossDef = boss ? engine.content.bossModifiers.find((b) => b.id === boss.modifierId) : null;
  const catName = (id: unknown) => engine.content.categories.find((c) => c.id === id)?.name ?? String(id);
  return (
    <div className="panel status">
      <span>
        Tier <b>{state.tier + 1}</b>/{cfg.tiers}
      </span>
      <span>
        Round <b>{state.round + 1}</b>/{cfg.normalRoundsPerTier + 1}
        {state.round >= cfg.normalRoundsPerTier ? ' (boss)' : ''}
      </span>
      <span>
        Currency <b>{me.currency}</b>
      </span>
      <span>
        Lives <b>{me.lives}</b>
      </span>
      {cfg.scoring === 'points' && (
        <span>
          Score <b>{me.score}</b>
        </span>
      )}
      <span>
        Deck <b>{me.deck.length}</b>
      </span>
      {bossDef && (
        <span className="boss-mod" title={bossDef.text}>
          Boss: <b>{bossDef.name}</b>
          {typeof boss!.params.category === 'string' ? ` (${catName(boss!.params.category)})` : ''} — {bossDef.text}
        </span>
      )}
      {me.items.length > 0 && (
        <span className="items">
          Items:{' '}
          {me.items.map((it, i) => {
            const def = engine.content.items.find((d) => d.id === it.itemId);
            return (
              <span key={i} className="item-chip" title={def?.text}>
                {def?.name ?? it.itemId}
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
}

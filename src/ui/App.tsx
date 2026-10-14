import { useCallback, useEffect, useState } from 'react';
import { type GameAction, type Session, dispatch, engine, newSession } from '../engine';
import { BattleView } from './BattleView';
import { BlueprintSelect } from './BlueprintSelect';
import { DuelView } from './DuelView';
import { GameContext } from './context';
import { MapView } from './MapView';
import { RestView } from './RestView';
import { RewardView } from './RewardView';
import { RoundOver, RunOver } from './RoundOver';
import { RoundView } from './RoundView';
import { ShopView } from './ShopView';
import { StatusBar } from './StatusBar';
import { clearLocal, discardedOldSave, downloadSave, loadFromLocal, readSaveFile, saveToLocal } from './storage';

const PLAYER_ID = 'p1';

/** Shown on screen so it's easy to tell which version is running. Bump on each release. */
export const BUILD_LABEL = 'build 17';

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadFromLocal());
  const [error, setError] = useState<string | null>(null);
  const [seedInput, setSeedInput] = useState('');
  const [confirmQuit, setConfirmQuit] = useState(false);

  useEffect(() => {
    if (session) saveToLocal(session);
  }, [session]);

  const act = useCallback(
    (action: GameAction): boolean => {
      if (!session) return false;
      const result = dispatch(session, action);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setError(null);
      setSession(result.session);
      return true;
    },
    [session],
  );

  const start = (seed: string) => {
    setSession(newSession({ seed: seed || randomSeed(), players: [{ id: PLAYER_ID, name: 'You' }] }));
    setError(null);
  };

  const onLoadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setSession(await readSaveFile(file));
      setError(null);
    } catch (e) {
      setError(`Could not load save: ${(e as Error).message}`);
    }
  };

  if (!session) {
    return (
      <div className="app">
        <header className="title">
          <h1>Rummage</h1>
          <p className="muted">Collect parts. Meld them into blueprints. Build items that change the rules. ({BUILD_LABEL})</p>
        </header>
        <div className="panel start">
          <label>
            Seed (optional){' '}
            <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} placeholder="random" />
          </label>
          <button className="primary" onClick={() => start(seedInput.trim())}>
            New run
          </button>
          <label className="file-button">
            Load save file
            <input type="file" accept="application/json" onChange={(e) => onLoadFile(e.target.files?.[0])} />
          </label>
          {error && <div className="error">{error}</div>}
        </div>
        {discardedOldSave && (
          <div className="panel notice">
            The game has been updated, and your saved run was from an older version, so it can't continue. Start a new run to
            play the new version.
          </div>
        )}
        <HowToPlay />
      </div>
    );
  }

  const state = session.state;
  return (
    <GameContext.Provider value={{ engine, state, playerId: PLAYER_ID, act }}>
      <div className="app">
        <header className="topbar">
          <h1>Rummage</h1>
          <span className="muted">seed “{state.seed}” · {BUILD_LABEL}</span>
          <span className="spacer" />
          <button onClick={() => downloadSave(session)}>Export save</button>
          <label className="file-button">
            Import save
            <input type="file" accept="application/json" onChange={(e) => onLoadFile(e.target.files?.[0])} />
          </label>
          {confirmQuit ? (
            <>
              <span>Abandon this run?</span>
              <button
                onClick={() => {
                  clearLocal();
                  setConfirmQuit(false);
                  setSession(null);
                }}
              >
                Yes, quit
              </button>
              <button onClick={() => setConfirmQuit(false)}>Keep playing</button>
            </>
          ) : (
            <button onClick={() => setConfirmQuit(true)}>Quit run</button>
          )}
        </header>
        <StatusBar />
        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {state.phase === 'map' && <MapView />}
        {state.phase === 'battle' && <BattleView />}
        {(state.phase === 'duelAnte' || state.phase === 'duel' || state.phase === 'duelResult') && <DuelView />}
        {state.phase === 'battleReward' && <RewardView />}
        {state.phase === 'rest' && <RestView />}
        {state.phase === 'blueprintSelect' && <BlueprintSelect />}
        {state.phase === 'playing' && <RoundView />}
        {state.phase === 'roundOver' && <RoundOver />}
        {state.phase === 'shop' && <ShopView />}
        {(state.phase === 'runWon' || state.phase === 'runLost') && (
          <RunOver
            onNewRun={() => {
              clearLocal();
              setSession(null);
            }}
          />
        )}
        <MessageLog messages={state.messages} />
      </div>
    </GameContext.Provider>
  );
}

function MessageLog({ messages }: { messages: string[] }) {
  return (
    <details className="panel log">
      <summary>Log</summary>
      <ol reversed>
        {[...messages].reverse().map((m, i) => (
          <li key={messages.length - i}>{m}</li>
        ))}
      </ol>
    </details>
  );
}

function HowToPlay() {
  return (
    <div className="panel howto">
      <h2>How to play</h2>
      <ul>
        <li>
          Each act is a <b>map</b>. Pick a route through duels, workshops, shops and rests to the boss.
        </li>
        <li>
          <b>Duels</b> are races of rummy. You and the minions each stake a part into the pot. Draw and discard until you
          can complete the target (for example a set of 3 and a run of 3). First to go out takes the whole pot.
        </li>
        <li>
          <b>Set</b>: cards with the same number, any category. <b>Run</b>: one category, numbers in a row.
        </li>
        <li>
          <b>Workshops</b> turn parts into <b>items</b> by completing a blueprint. The parts are used up. Items give a passive
          bonus and a <b>gadget</b>, like the Pocket Watch that makes an opponent miss a turn.
        </li>
        <li>
          Gadget charges don't refill after a fight. Spend them on minions, or save them for the boss. Recharging costs
          credits (a rest stop does one for free).
        </li>
        <li>Lose a boss duel and you lose a life. Run out of lives and the run is over.</li>
      </ul>
    </div>
  );
}

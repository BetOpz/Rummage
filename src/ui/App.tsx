import { useCallback, useEffect, useState } from 'react';
import { type GameAction, type Session, dispatch, engine, newSession } from '../engine';
import { BlueprintSelect } from './BlueprintSelect';
import { GameContext } from './context';
import { RoundOver, RunOver } from './RoundOver';
import { RoundView } from './RoundView';
import { ShopView } from './ShopView';
import { StatusBar } from './StatusBar';
import { clearLocal, downloadSave, loadFromLocal, readSaveFile, saveToLocal } from './storage';

const PLAYER_ID = 'p1';

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadFromLocal());
  const [error, setError] = useState<string | null>(null);
  const [seedInput, setSeedInput] = useState('');

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
          <p className="muted">Collect parts. Meld them into blueprints. Build items that change the rules.</p>
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
          <span className="muted">seed “{state.seed}”</span>
          <span className="spacer" />
          <button onClick={() => downloadSave(session)}>Export save</button>
          <label className="file-button">
            Import save
            <input type="file" accept="application/json" onChange={(e) => onLoadFile(e.target.files?.[0])} />
          </label>
          <button
            onClick={() => {
              if (confirm('Abandon this run?')) {
                clearLocal();
                setSession(null);
              }
            }}
          >
            Quit run
          </button>
        </header>
        <StatusBar />
        {error && (
          <div className="error" onClick={() => setError(null)}>
            {error}
          </div>
        )}
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
          Each round, pick a <b>blueprint</b>: a list of melds such as “Set of 4 + Run of 3”.
        </li>
        <li>
          <b>Set</b>: cards of the same gauge (any categories). <b>Run</b>: one category, consecutive gauges.
        </li>
        <li>Each turn: draw (deck or discard pile), optionally play specials or build, then discard one card.</li>
        <li>Complete the blueprint before your draws run out. The parts are used up and become an item with a passive bonus.</li>
        <li>Spend currency in the shop between rounds. Each tier ends with a boss blueprint that bends the rules.</li>
      </ul>
    </div>
  );
}

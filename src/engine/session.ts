/**
 * A session = initial state + action log. The current state is always
 * reproducible by replaying the log, which is what save files, replays and
 * (later) network sync build on.
 */

import { type Engine, type NewGameOptions, engine as defaultEngine } from './game';
import type { GameAction, GameState } from './types';

export interface Session {
  initial: GameState;
  actions: GameAction[];
  state: GameState;
}

export interface SaveFile {
  format: 'rummage-save';
  schemaVersion: 1;
  savedAt: string;
  initial: GameState;
  actions: GameAction[];
  /** Snapshot of the current state, so loading doesn't require a replay. */
  state: GameState;
}

export function newSession(options: NewGameOptions, engine: Engine = defaultEngine): Session {
  const initial = engine.newGame(options);
  return { initial, actions: [], state: initial };
}

/** Apply an action; on success returns the new session, otherwise the error. */
export function dispatch(
  session: Session,
  action: GameAction,
  engine: Engine = defaultEngine,
): { ok: true; session: Session } | { ok: false; error: string; session: Session } {
  const result = engine.applyAction(session.state, action);
  if (!result.ok) return { ok: false, error: result.error, session };
  return { ok: true, session: { ...session, actions: [...session.actions, action], state: result.state } };
}

export function replay(initial: GameState, actions: GameAction[], engine: Engine = defaultEngine): GameState {
  return actions.reduce((s, a) => engine.reduce(s, a), initial);
}

export function serializeSession(session: Session, now: Date = new Date()): string {
  const save: SaveFile = {
    format: 'rummage-save',
    schemaVersion: 1,
    savedAt: now.toISOString(),
    initial: session.initial,
    actions: session.actions,
    state: session.state,
  };
  return JSON.stringify(save);
}

/**
 * Load a save. By default the action log is replayed and checked against
 * the stored snapshot, which catches corrupted or tampered saves and
 * engine changes that break old saves.
 */
export function deserializeSession(
  json: string,
  { verify = true, engine = defaultEngine }: { verify?: boolean; engine?: Engine } = {},
): Session {
  const data = JSON.parse(json) as Partial<SaveFile>;
  if (data.format !== 'rummage-save') throw new Error('Not a Rummage save file');
  if (data.schemaVersion !== 1) throw new Error(`Unsupported save version ${data.schemaVersion}`);
  if (!data.initial || !data.actions || !data.state) throw new Error('Save file is incomplete');
  // Saves from before rummy duels and item grades can't be continued.
  const cfg = data.state.config as Partial<typeof data.state.config> | undefined;
  if (!cfg?.runStructure || !cfg.battleStyle || !cfg.quality || !cfg.duel || !cfg.itemSource || !cfg.scrapbook) {
    throw new Error('This save is from an older version of the game');
  }
  if (verify) {
    const replayed = replay(data.initial, data.actions, engine);
    if (JSON.stringify(replayed) !== JSON.stringify(data.state)) {
      throw new Error('Save file does not match its action log');
    }
  }
  return { initial: data.initial, actions: data.actions, state: data.state };
}

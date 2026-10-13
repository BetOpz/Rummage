import { describe, expect, it } from 'vitest';
import { botAction } from '../src/engine/bot';
import { deserializeSession, dispatch, newSession, replay, serializeSession, type Session } from '../src/engine/session';
import { engine } from './helpers';

function playSome(n: number): Session {
  let session = newSession({ seed: 'save-test' });
  for (let i = 0; i < n; i++) {
    const action = botAction(engine, session.state, 'p1');
    if (!action) break;
    const r = dispatch(session, action);
    expect(r.ok).toBe(true);
    session = r.session;
  }
  return session;
}

describe('session, save and load', () => {
  it('records every successful action and skips illegal ones', () => {
    const s0 = newSession({ seed: 'log' });
    const bad = dispatch(s0, { type: 'DRAW', playerId: 'p1', source: 'deck' });
    expect(bad.ok).toBe(false);
    expect(bad.session.actions).toHaveLength(0);
    const good = dispatch(s0, { type: 'SELECT_BLUEPRINT', playerId: 'p1', blueprintId: s0.state.roundState!.offers[0] });
    expect(good.ok).toBe(true);
    expect(good.session.actions).toHaveLength(1);
  });

  it('replaying the action log reproduces the state exactly', () => {
    const session = playSome(120);
    expect(replay(session.initial, session.actions)).toEqual(session.state);
  });

  it('round-trips through JSON', () => {
    const session = playSome(25);
    expect(['runWon', 'runLost']).not.toContain(session.state.phase);
    const loaded = deserializeSession(serializeSession(session));
    expect(loaded.state).toEqual(session.state);
    expect(loaded.actions).toEqual(session.actions);
    // The loaded game continues identically.
    const next = botAction(engine, loaded.state, 'p1')!;
    expect(engine.reduce(loaded.state, next)).toEqual(engine.reduce(session.state, next));
  });

  it('rejects a tampered save', () => {
    const session = playSome(40);
    const data = JSON.parse(serializeSession(session));
    data.state.players[0].currency = 999;
    expect(() => deserializeSession(JSON.stringify(data))).toThrow(/does not match/);
    expect(deserializeSession(JSON.stringify(data), { verify: false }).state.players[0].currency).toBe(999);
  });

  it('rejects non-save JSON', () => {
    expect(() => deserializeSession('{"hello":1}')).toThrow(/Not a Rummage save/);
  });
});

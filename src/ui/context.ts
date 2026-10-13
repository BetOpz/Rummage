import { createContext, useContext } from 'react';
import type { Engine, GameAction, GameState, PlayerState } from '../engine';

export interface GameContextValue {
  engine: Engine;
  state: GameState;
  playerId: string;
  /** Dispatch an action; returns false (and shows the error) if illegal. */
  act: (action: GameAction) => boolean;
}

export const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue & { me: PlayerState } {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame outside GameContext');
  const me = ctx.state.players.find((p) => p.id === ctx.playerId)!;
  return { ...ctx, me };
}

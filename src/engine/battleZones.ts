/**
 * Low-level battle helpers that mutate a draft state. Shared by the battle
 * module and the battle effect handlers.
 */

import type { Rng } from './rng';
import type { BattleState, EnemyState, PlayerState } from './types';

/** Draw up to n battle cards, reshuffling the discard pile when the draw pile runs out. */
export function drawBattleCards(battle: BattleState, n: number, rng: Rng): void {
  for (let i = 0; i < n; i++) {
    if (battle.drawPile.length === 0) {
      if (battle.discard.length === 0) return;
      battle.drawPile = rng.shuffle(battle.discard.splice(0));
    }
    battle.hand.push(battle.drawPile.pop()!);
  }
}

/** Damage after block. Returns the HP actually lost. */
function absorb(target: { block: number; hp: number }, amount: number): number {
  const blocked = Math.min(target.block, amount);
  target.block -= blocked;
  const lost = Math.min(target.hp, amount - blocked);
  target.hp -= lost;
  return lost;
}

export function damageEnemy(enemy: EnemyState, amount: number): number {
  if (enemy.hp <= 0) return 0;
  return absorb(enemy, Math.max(0, Math.round(amount)));
}

export function damagePlayer(player: PlayerState, battle: BattleState, amount: number): number {
  const target = { block: battle.block, hp: player.hp };
  const lost = absorb(target, Math.max(0, Math.round(amount)));
  battle.block = target.block;
  player.hp = target.hp;
  return lost;
}

export function livingEnemies(battle: BattleState): EnemyState[] {
  return battle.enemies.filter((e) => e.hp > 0);
}

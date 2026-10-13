/**
 * The battle layer (placeholder design: energy, a hand of cards, enemies
 * with visible intents). Kept behind this module so the battle style can be
 * replaced without touching the workshop (rummy) layer.
 *
 * Battle decks are built fresh for each fight from the config's starter
 * cards plus the battle side of every item the player owns. Playing an
 * item card with limited uses wears it down; at 0 the item breaks and is
 * gone for good (its passive effects too).
 */

import { perTier } from '../config';
import { damagePlayer, drawBattleCards, livingEnemies } from './battleZones';
import { type EffectRegistry, getHandler } from './effects';
import type { Rng } from './rng';
import type {
  BattleCard,
  BattleCardDef,
  BattleReward,
  BattleState,
  ContentPack,
  EnemyDef,
  EnemyIntent,
  EnemyState,
  GameState,
  PlayerState,
  RewardOption,
} from './types';
import { assertRule, log } from './zones';

export type BattleKind = BattleState['kind'];

/** The card definition behind a battle card, plus its level. */
export function battleCardDef(
  content: ContentPack,
  player: PlayerState,
  card: BattleCard,
): { def: BattleCardDef; level: number; itemUid?: string } | null {
  if (card.source === 'starter') {
    const def = content.starterCards.find((c) => c.id === card.ref);
    return def ? { def, level: 1 } : null;
  }
  const item = player.items.find((i) => i.uid === card.ref);
  const def = item ? content.items.find((d) => d.id === item.itemId)?.battle : undefined;
  return item && def ? { def, level: item.level, itemUid: item.uid } : null;
}

/** The enemy's next move, with act scaling applied. */
export function currentIntent(content: ContentPack, enemy: EnemyState): EnemyIntent | null {
  const def = content.enemies.find((e) => e.id === enemy.defId);
  if (!def || def.intents.length === 0) return null;
  const raw = def.intents[enemy.intentIndex % def.intents.length];
  const s = (n: number) => Math.round(n * enemy.scale);
  switch (raw.type) {
    case 'attack':
      return { type: 'attack', damage: s(raw.damage), hits: raw.hits ?? 1 };
    case 'block':
      return { type: 'block', amount: s(raw.amount) };
    case 'attackBlock':
      return { type: 'attackBlock', damage: s(raw.damage), block: s(raw.block) };
  }
}

/** Total damage the enemies will deal this turn (before the player's block). */
export function incomingDamage(content: ContentPack, battle: BattleState): number {
  let total = 0;
  for (const e of livingEnemies(battle)) {
    const i = currentIntent(content, e);
    if (i?.type === 'attack') total += i.damage * (i.hits ?? 1);
    if (i?.type === 'attackBlock') total += i.damage;
  }
  return total;
}

function enemiesFor(content: ContentPack, kind: BattleKind, act: number, rng: Rng): EnemyDef[] {
  const actNo = act + 1;
  const fits = (e: EnemyDef) => (e.minAct ?? 1) <= actNo && (e.maxAct ?? Infinity) >= actNo;
  const want = kind === 'battle' ? 'normal' : kind;
  let pool = content.enemies.filter((e) => e.kind === want && fits(e));
  if (pool.length === 0) pool = content.enemies.filter((e) => e.kind === want);
  if (pool.length === 0) throw new Error(`No enemies of kind ${want}`);
  if (kind !== 'battle') return [rng.pick(pool)];
  // Normal fights: one or two enemies.
  const count = rng.float() < 0.5 ? 1 : 2;
  return Array.from({ length: count }, () => rng.pick(pool));
}

export function startBattle(
  state: GameState,
  content: ContentPack,
  player: PlayerState,
  kind: BattleKind,
  rng: Rng,
): void {
  const cfg = state.config.battle;
  const scale = perTier(cfg.enemyScalingByAct, state.tier);
  const enemies: EnemyState[] = enemiesFor(content, kind, state.tier, rng).map((def) => ({
    defId: def.id,
    name: def.name,
    hp: Math.round(def.hp * scale),
    maxHp: Math.round(def.hp * scale),
    block: 0,
    intentIndex: 0,
    scale,
  }));

  const cards: BattleCard[] = [];
  for (const id of cfg.starterDeck) cards.push({ uid: `bc${state.nextUid++}`, source: 'starter', ref: id });
  for (const item of player.items) {
    const def = content.items.find((d) => d.id === item.itemId);
    if (def?.battle) cards.push({ uid: `bc${state.nextUid++}`, source: 'item', ref: item.uid });
  }

  const battle: BattleState = {
    kind,
    playerId: player.id,
    enemies,
    drawPile: rng.shuffle(cards),
    hand: [],
    discard: [],
    exhausted: [],
    energy: cfg.energy,
    block: 0,
    turn: 1,
  };
  drawBattleCards(battle, cfg.handSize, rng);
  state.battle = battle;
  state.phase = 'battle';
  log(state, `${kind === 'boss' ? 'Boss fight' : kind === 'elite' ? 'Elite fight' : 'Battle'}: ${enemies.map((e) => e.name).join(', ')}.`);
}

/** Returns true if the battle has been won. */
export function playBattleCard(
  state: GameState,
  content: ContentPack,
  effects: EffectRegistry,
  player: PlayerState,
  cardUid: string,
  target: number | undefined,
  rng: Rng,
): boolean {
  const battle = state.battle!;
  const idx = battle.hand.findIndex((c) => c.uid === cardUid);
  assertRule(idx >= 0, 'That card is not in your hand');
  const card = battle.hand[idx];
  const info = battleCardDef(content, player, card);
  assertRule(info, 'That card no longer exists');
  const { def, level, itemUid } = info;
  assertRule(battle.energy >= def.cost, `Not enough energy (needs ${def.cost})`);
  if (target !== undefined) {
    assertRule(battle.enemies[target] && battle.enemies[target].hp > 0, 'Choose a living enemy');
  }

  battle.energy -= def.cost;
  battle.hand.splice(idx, 1);
  log(state, `${player.name} plays ${def.name}.`);

  const ctx = { state, content, rng, player, battle, target, level };
  for (const ref of def.effects) getHandler(effects, ref).onBattlePlay?.(ctx, ref.params ?? {});

  const item = itemUid ? player.items.find((i) => i.uid === itemUid) : undefined;
  if (item && item.usesLeft !== null) {
    item.usesLeft -= 1;
    if (item.usesLeft <= 0) {
      player.items = player.items.filter((i) => i.uid !== item.uid);
      battle.exhausted.push(card);
      const name = content.items.find((d) => d.id === item.itemId)?.name ?? item.itemId;
      log(state, `${name} breaks!`);
    } else {
      battle.discard.push(card);
    }
  } else {
    battle.discard.push(card);
  }

  return livingEnemies(battle).length === 0;
}

/** Enemies act, then a new player turn starts. Returns 'lost' if the player died. */
export function endBattleTurn(state: GameState, content: ContentPack, player: PlayerState, rng: Rng): 'lost' | 'ongoing' {
  const battle = state.battle!;
  battle.discard.push(...battle.hand.splice(0));

  for (const enemy of livingEnemies(battle)) {
    enemy.block = 0;
    const intent = currentIntent(content, enemy);
    if (intent?.type === 'attack') {
      for (let h = 0; h < (intent.hits ?? 1); h++) damagePlayer(player, battle, intent.damage);
    } else if (intent?.type === 'block') {
      enemy.block += intent.amount;
    } else if (intent?.type === 'attackBlock') {
      damagePlayer(player, battle, intent.damage);
      enemy.block += intent.block;
    }
    enemy.intentIndex += 1;
    if (player.hp <= 0) return 'lost';
  }

  battle.turn += 1;
  battle.block = 0;
  battle.energy = state.config.battle.energy;
  drawBattleCards(battle, state.config.battle.handSize, rng);
  return 'ongoing';
}

export function makeReward(state: GameState, content: ContentPack, kind: BattleKind, rng: Rng): BattleReward {
  const cfg = state.config.battle;
  const currency = cfg.currencyReward[kind] * (state.tier + 1);
  const options: RewardOption[] = [];
  for (let i = 0; i < cfg.rewardOptions; i++) {
    if (rng.float() < 0.3 && content.specials.length > 0) {
      options.push({ kind: 'special', specialId: rng.weightedPick(content.specials, (s) => s.weight).id });
    } else {
      options.push({
        kind: 'part',
        category: rng.pick(content.categories).id,
        gauge: rng.int(state.config.gaugeMin, state.config.gaugeMax),
      });
    }
  }
  return { kind, currency, options };
}

/**
 * Core types for the rules engine.
 *
 * Everything in GameState is plain JSON (no classes, Maps, functions or Dates)
 * so it can be saved, replayed and sent over a network unchanged.
 */

import type { GameConfig } from '../config';

export type CardId = string;
export type PlayerId = string;

// ---------------------------------------------------------------------------
// Content definitions (loaded from src/content/*.json)
// ---------------------------------------------------------------------------

/** Reference from content to an effect handler in the effect registry. */
export interface EffectRef {
  /** Key into the effect registry, e.g. "drawChoice", "modifyRules". */
  type: string;
  params?: Record<string, unknown>;
}

export interface CategoryDef {
  id: string;
  name: string;
  /** Display colour for the UI; the engine ignores it. */
  color: string;
  /** Flavour nouns, indexed by gauge (wraps if shorter than the gauge range). */
  nouns: string[];
  /** Material grade: items built mostly from this material get this grade. */
  grade: number;
  /** Rare materials never appear in starting decks or minion decks. */
  rare?: boolean;
  /** Relative odds when a random part is made (shops, rewards, pots). Default 1. */
  weight?: number;
}

export interface SpecialDef {
  id: string;
  name: string;
  text: string;
  /** Gems: grades added to an item built with this card. */
  gradeBonus?: number;
  price: number;
  /** Relative weight in shop pools. */
  weight: number;
  /** Lowest tier (1-based) at which the shop may offer this special. */
  minTier?: number;
  /** Can the card be played from hand during the main phase? */
  playable?: boolean;
  /** Is the card removed from the deck for good when played? */
  consumeOnPlay?: boolean;
  /** What the PLAY_SPECIAL action must target, if anything. */
  target?: 'none' | 'handCard' | 'discardCard';
  effects: EffectRef[];
}

/** A card that can be played in battle (starter cards and the battle side of items). */
export interface BattleCardDef {
  name: string;
  text: string;
  /** Energy cost. */
  cost: number;
  /** Battle effects (handlers implement `onBattlePlay`). */
  effects: EffectRef[];
  /**
   * Durability for item cards: the item breaks after this many plays.
   * Omit for an item that never breaks.
   */
  uses?: number;
  /** Does the card need an enemy target? */
  targeted?: boolean;
}

export interface StarterCardDef extends BattleCardDef {
  id: string;
}

export interface ItemDef {
  id: string;
  name: string;
  text: string;
  /** Passive effects (workshop rules, currency, ...). */
  effects: EffectRef[];
  /** The item's battle card, if it has one (card-battle style). */
  battle?: BattleCardDef;
  /**
   * Gadget used during rummy duels: an effect you trigger, with charges
   * that do NOT refill between fights (rest stops recharge them).
   */
  gadget?: GadgetDef;
}

export interface GadgetDef {
  name: string;
  text: string;
  charges: number;
  /** Credits to refill all charges between fights. */
  rechargeCost: number;
  /** What refilling is called, e.g. "Rewind". */
  rechargeName: string;
  /** Which opponent it needs, if any. */
  target?: 'none' | 'opponent';
  /** Effects implementing the `onGadget` hook. */
  effects: EffectRef[];
  /**
   * Can also check a parcel (in a lot ahead, or one you've won) for one
   * charge, like a tool card that gets sharper with the item's grade.
   */
  onLot?: {
    reveals: 'gauge' | 'metal' | 'both';
    /** Options it leaves, by item grade (index 0 = Tin). */
    optionsByGrade: number[];
    text: string;
  };
}

/** An opponent in a rummy duel (minion, elite or boss). */
export interface MinionDef {
  id: string;
  name: string;
  kind: 'normal' | 'elite' | 'boss';
  minAct?: number;
  maxAct?: number;
  text: string;
  /** The minion's own deck, built fresh for each duel. */
  deck: {
    /** Category ids it uses; omit for all. */
    categories?: string[];
    gauges: [number, number];
    copies: number;
  };
  /** How many cards it stakes into the pot. */
  stakes: number;
  /** Takes the top of the discard pile whenever it helps at all. */
  greedy?: boolean;
}

/**
 * A lot: a box of parts fought over in a duel (shoebox, tea chest, loft
 * box, barn find, estate sale). Contents are rolled when the map is made.
 */
export interface LotDef {
  id: string;
  name: string;
  /** Flavour shown with the lot. */
  text: string;
  /** Duel kinds this lot can be the prize for. */
  kinds: ('battle' | 'elite' | 'boss')[];
  minAct?: number;
  maxAct?: number;
  /** Relative odds among the lots that fit. */
  weight: number;
  /** Pieces in the lot: [min, max]. */
  size: [number, number];
  /** Everyday materials and their relative odds. */
  materials: Record<string, number>;
  /** Parcels the winner picks. */
  picks: number;
  /** Chance each piece is a rare material instead (Brass or better, by rarity). */
  rareChance: number;
  /** Chance one parcel is a gem instead. */
  gemChance: number;
  gauges: [number, number];
}

/**
 * A check you hold and spend on a parcel. It is certain about `reveals`
 * and leaves `options` possibilities for the other attribute (1 = exact).
 */
export interface ToolDef {
  id: string;
  name: string;
  text: string;
  /** 'gauge': certain of the number; 'metal': certain of the metal; 'both': unwraps it. */
  reveals: 'gauge' | 'metal' | 'both';
  options: number;
  price: number;
  /** Relative odds in shops. */
  weight: number;
}

/** The race target for a duel. */
export interface DuelTargetDef {
  id: string;
  name: string;
  kind: 'normal' | 'elite' | 'boss';
  minAct?: number;
  maxAct?: number;
  requirements: MeldRequirement[];
}

export type EnemyIntent =
  | { type: 'attack'; damage: number; hits?: number }
  | { type: 'block'; amount: number }
  | { type: 'attackBlock'; damage: number; block: number };

export interface EnemyDef {
  id: string;
  name: string;
  kind: 'normal' | 'elite' | 'boss';
  /** First act (1-based) this enemy can appear in. */
  minAct?: number;
  /** Last act it can appear in. */
  maxAct?: number;
  hp: number;
  /** Cycled in order, one per enemy turn. */
  intents: EnemyIntent[];
}

export type MeldType = 'set' | 'run';

export interface MeldRequirement {
  type: MeldType;
  /** Minimum number of slots the meld must fill. */
  size: number;
  /** Every card in the meld must be (or be adapted to) this category. */
  category?: string;
  /** Every card in the meld must have (or be adapted to) a gauge >= this. */
  minGauge?: number;
  /** Every card in the meld must have (or be adapted to) a gauge <= this. */
  maxGauge?: number;
  /** Hidden until the blueprint is chosen or revealed by an effect. */
  hidden?: boolean;
}

export interface BlueprintDef {
  id: string;
  name: string;
  /** 1-based tier. */
  tier: number;
  /** Boss blueprints only appear as the last round of a tier. */
  boss?: boolean;
  requirements: MeldRequirement[];
  /** The item (relic) granted when the blueprint is built. */
  itemId: string;
}

export interface BossModifierDef {
  id: string;
  name: string;
  text: string;
  minTier?: number;
  effects: EffectRef[];
}

export interface ShopTierPool {
  /** 1-based tier this pool applies to (the highest pool <= current tier is used). */
  tier: number;
  partSlots: number;
  specialSlots: number;
  partPrice: number;
  /** Multiplier on SpecialDef.price. */
  specialPriceMultiplier: number;
  /** Category weights for random parts; omitted categories get weight 1. */
  categoryWeights?: Record<string, number>;
  /** Gauge range for random parts; defaults to the config gauge range. */
  gaugeRange?: [number, number];
  services: ShopServiceDef[];
}

export interface ShopServiceDef {
  id: string;
  name: string;
  text: string;
  price: number;
  /** Effect run on purchase (with the target card, if any). */
  effect: EffectRef;
  target?: 'none' | 'deckCard';
}

export interface ContentPack {
  categories: CategoryDef[];
  specials: SpecialDef[];
  items: ItemDef[];
  blueprints: BlueprintDef[];
  bossModifiers: BossModifierDef[];
  shopPools: ShopTierPool[];
  starterCards: StarterCardDef[];
  enemies: EnemyDef[];
  minions: MinionDef[];
  duelTargets: DuelTargetDef[];
  lots: LotDef[];
  tools: ToolDef[];
}

// ---------------------------------------------------------------------------
// Card instances
// ---------------------------------------------------------------------------

export interface PartCard {
  id: CardId;
  kind: 'part';
  owner: PlayerId;
  category: string;
  gauge: number;
  name: string;
  /** Temporary cards vanish at the end of the round. */
  temporary?: boolean;
}

export interface SpecialCard {
  id: CardId;
  kind: 'special';
  owner: PlayerId;
  specialId: string;
  temporary?: boolean;
}

export type Card = PartCard | SpecialCard;

// ---------------------------------------------------------------------------
// Rules for the current round (base config + items + boss, recomputed per round)
// ---------------------------------------------------------------------------

export type MeldRole = 'natural' | 'wild' | 'bulk' | 'adaptor';

export interface RoundRules {
  handSize: number;
  drawLimit: number;
  allowDiscardDraw: boolean;
  /** Special meld roles that are switched off this round (e.g. by a boss). */
  disabledMeldRoles: MeldRole[];
  /** Parts of these categories cannot be used in builds. */
  bannedCategories: string[];
  /** Show hidden blueprint requirements. */
  revealHidden: boolean;
  gaugeMin: number;
  gaugeMax: number;
  /** Every meld must contain at least one natural part. */
  requireNaturalInMeld: boolean;
}

// ---------------------------------------------------------------------------
// Player, round, shop and game state
// ---------------------------------------------------------------------------

export interface ItemInstance {
  /** Unique per run, so two copies of the same item can be told apart. */
  uid: string;
  itemId: string;
  /** Blueprint it was built from (for display/history). */
  fromBlueprint: string;
  /** Number of parts consumed to build it (they no longer exist). */
  builtFrom: number;
  /** Power level (the blueprint's tier, +1 for master workshops). Scales battle effects. */
  level: number;
  /** Plays left before it breaks; null = never breaks (card-battle style). */
  usesLeft: number | null;
  /** Gadget charges left; persist between duels (rummy-duel style). null = no gadget. */
  charges: number | null;
  /** Material grade from the parts it was built with (1 = Wood ... 6 = Gold, gems add more). */
  grade: number;
  /** Material name shown before the item name, e.g. "Gold". */
  material: string;
}

export interface LockedMeld {
  type: MeldType;
  cardIds: CardId[];
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Master list of cards the player owns. Source of truth between rounds. */
  deck: CardId[];
  drawPile: CardId[];
  hand: CardId[];
  /** Specials played this round; return to the deck at round end. */
  played: CardId[];
  lockedMelds: LockedMeld[];
  items: ItemInstance[];
  currency: number;
  score: number;
  /** Used by the workshop-only run structure. */
  lives: number;
  /** Used by the map run structure. */
  hp: number;
  maxHp: number;
  /** Blueprint this player is building this round. */
  target: string | null;
  /** Draws taken this round. */
  drawsTaken: number;
  /** Player has run out of draws this round and is out (multiplayer). */
  exhausted: boolean;
  /** Effective rules for this player this round. */
  rules: RoundRules;
  /** Scrapbook: per item id, pieces placed on each stage (index 0 = Tin ... 7 = Platinum). */
  scrapbook: Record<string, number[]>;
  /** Checks held, by tool id. */
  tools: Record<string, number>;
}

export type PendingChoice =
  | {
      kind: 'keepOne';
      playerId: PlayerId;
      cardIds: CardId[];
      keep: number;
      /** Where the rest go. */
      rest: 'discard' | 'bottom';
    }
  | {
      kind: 'reorderTop';
      playerId: PlayerId;
      cardIds: CardId[];
    };

export interface BossState {
  modifierId: string;
  /** Resolved parameters, e.g. which category is banned. */
  params: Record<string, unknown>;
}

export interface RoundState {
  /** Blueprints face-up this round. */
  offers: string[];
  isBoss: boolean;
  boss: BossState | null;
  /** Every rule modifier active this round (challenge modifiers + boss), params resolved. */
  modifiers: BossState[];
  /** Shared discard pile; last element is the top. */
  discard: CardId[];
  turnPhase: 'draw' | 'main';
  pendingChoice: PendingChoice | null;
  /** Number of completed turns (for display). */
  turn: number;
}

export interface ShopSlot {
  kind: 'part' | 'special' | 'service' | 'tool';
  toolId?: string;
  /** For parts: category/gauge; for specials: specialId; for services: serviceId. */
  category?: string;
  gauge?: number;
  specialId?: string;
  serviceId?: string;
  price: number;
  sold: boolean;
}

export interface ShopState {
  slots: ShopSlot[];
  rerolls: number;
}

export interface RoundResult {
  tier: number;
  round: number;
  blueprintId: string | null;
  winner: PlayerId | null;
  perPlayer: Record<
    PlayerId,
    { built: boolean; deadwood: number; reward: number; itemId: string | null; lifeLost: boolean; hpLost: number }
  >;
}

// ---------------------------------------------------------------------------
// Map and battles (the outer layer)
// ---------------------------------------------------------------------------

export type NodeType = 'workshop' | 'masterWorkshop' | 'battle' | 'elite' | 'shop' | 'rest' | 'boss' | 'appraiser';

export interface MapNode {
  id: string;
  row: number;
  col: number;
  type: NodeType;
  /** Ids of nodes in the next row this node leads to. */
  next: string[];
  /** Duel stops: who you'll face and what they stake (shown on the map). */
  encounter?: Encounter;
}

export interface Encounter {
  minions: string[];
  /** Cards the opponents put into the pot. */
  stakes: RewardOption[];
  /**
   * Matched stakes: everyone (you included) stakes `count` parts of this
   * material, or better. Absent = any one card (workshop item source).
   */
  stakeRule?: { category: string; count: number };
  /** The lot fought over (scrapbook item source). */
  lot?: Lot;
}

/**
 * A parcel in a lot. Everything starts wrapped; checks narrow it down.
 * Its look-alikes are fixed when the lot is made and checks show a prefix
 * of them, so repeated checks never contradict each other.
 */
export interface Parcel {
  piece: RewardOption;
  /** Other metals it could be taken for, in the order checks reveal them. */
  altMetals: string[];
  /** Other numbers it could be taken for, in the same way. */
  altGauges: number[];
  /** Metals still possible (0 = nothing known yet, 1 = known exactly). */
  metalOptions: number;
  /** Numbers still possible (0 = nothing known yet, 1 = known exactly). */
  gaugeOptions: number;
}

export interface Lot {
  lotId: string;
  name: string;
  /** Parcels the winner picks. */
  picks: number;
  parcels: Parcel[];
}

/** Where a found piece goes. */
export type PieceDestination = { to: 'page'; itemId: string } | { to: 'deck' } | { to: 'sell' };

/** Sorting the pieces dug out of a won lot. */
export interface RummageState {
  lotName: string;
  /** 'pick': choose your parcels (checks still allowed); 'sort': send each opened piece somewhere. */
  stage: 'pick' | 'sort';
  lot: Lot;
  /** The pieces you picked (filled in when you pick). */
  pieces: RewardOption[];
  /** The parcels you didn't pick, shown once you open yours. */
  missed: RewardOption[];
  /** The lot was a boss prize: the act ends after sorting. */
  afterBoss: boolean;
}

export interface MapState {
  /** 0-based act (same as GameState.tier). */
  act: number;
  rows: MapNode[][];
  /** Node the player is on; null before the first choice. */
  current: string | null;
  visited: string[];
}

export interface BattleCard {
  uid: string;
  source: 'starter' | 'item';
  /** Starter card id, or the ItemInstance uid. */
  ref: string;
}

export interface EnemyState {
  defId: string;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  intentIndex: number;
  /** Damage/block multiplier for the act. */
  scale: number;
}

export interface BattleState {
  kind: 'battle' | 'elite' | 'boss';
  playerId: PlayerId;
  enemies: EnemyState[];
  drawPile: BattleCard[];
  hand: BattleCard[];
  discard: BattleCard[];
  /** Cards removed for this battle (broken items). */
  exhausted: BattleCard[];
  energy: number;
  block: number;
  turn: number;
}

export interface RewardOption {
  kind: 'part' | 'special';
  category?: string;
  gauge?: number;
  specialId?: string;
}

export interface BattleReward {
  kind: BattleState['kind'];
  currency: number;
  options: RewardOption[];
}

// ---------------------------------------------------------------------------
// Rummy duels (the battle layer in 'rummy' battle style)
// ---------------------------------------------------------------------------

export interface DuelOpponent {
  defId: string;
  name: string;
  hand: CardId[];
  drawPile: CardId[];
  /** Turns to skip (Pocket Watch). */
  skip: number;
  /** Player can see this hand. */
  revealed: boolean;
  lastAction: string;
}

export interface DuelState {
  kind: 'battle' | 'elite' | 'boss';
  nodeId: string;
  targetId: string;
  requirements: MeldRequirement[];
  /** Rule twists (boss modifiers), params resolved. */
  modifiers: BossState[];
  rules: RoundRules;
  /** Cards in the pot (including the player's stake once placed). */
  pot: CardId[];
  /** The player's staked cards (empty during the ante). */
  playerStake: CardId[];
  /** Matched-stake rule, if any (see Encounter.stakeRule). */
  stakeRule: { category: string; count: number } | null;
  /** The lot fought over, if any. */
  lot: Lot | null;
  opponents: DuelOpponent[];
  hand: CardId[];
  drawPile: CardId[];
  /** Shared discard pile; last element is the top. */
  discard: CardId[];
  turnPhase: 'draw' | 'main';
  drawsTaken: number;
  /** Ended: who won (null = still playing). 'player' or opponent index. */
  winner: 'player' | number | null;
  /** How it ended. */
  endReason: string | null;
  /** Winning melds, for display. */
  winningMelds: CardId[][] | null;
  /** Filled in when the duel ends. */
  result: DuelResult | null;
}

export interface DuelResult {
  won: boolean;
  currency: number;
  /** Pot cards that joined the player's parts deck. */
  wonCards: CardId[];
  /** The player's lost stake (destroyed when the result is dismissed). */
  lostStake: CardId[];
  lifeLost: boolean;
  /** Lot won: you pick `picks` of its parcels next. */
  lotWon: { name: string; picks: number; parcels: number } | null;
}

export type GamePhase =
  | 'map'
  | 'duelAnte'
  | 'duel'
  | 'duelResult'
  | 'rummage'
  | 'appraiser'
  | 'blueprintSelect'
  | 'playing'
  | 'roundOver'
  | 'shop'
  | 'battle'
  | 'battleReward'
  | 'rest'
  | 'runWon'
  | 'runLost';

export interface GameState {
  schemaVersion: 1;
  config: GameConfig;
  seed: string;
  /** Seeded RNG state; the only source of randomness. */
  rng: number;
  phase: GamePhase;
  /** 0-based tier index. */
  tier: number;
  /** 0-based round index within the tier. */
  round: number;
  players: PlayerState[];
  /** Index into players whose turn it is. */
  activePlayer: number;
  cards: Record<CardId, Card>;
  nextCardSeq: number;
  roundState: RoundState | null;
  /** Shared market (one market for all players, per the multiplayer design). */
  shop: ShopState | null;
  lastResult: RoundResult | null;
  /** Map run structure only. */
  map: MapState | null;
  battle: BattleState | null;
  reward: BattleReward | null;
  duel: DuelState | null;
  /** Sorting a won lot's pieces (scrapbook item source). */
  rummage: RummageState | null;
  /** Counter for ItemInstance / battle card uids. */
  nextUid: number;
  /** Human-readable event log (capped), for UI feedback. */
  messages: string[];
}

// ---------------------------------------------------------------------------
// Actions: every state change goes through one of these.
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'SELECT_BLUEPRINT'; playerId: PlayerId; blueprintId: string }
  | { type: 'DRAW'; playerId: PlayerId; source: 'deck' | 'discard' }
  | { type: 'PLAY_SPECIAL'; playerId: PlayerId; cardId: CardId; targetId?: CardId }
  | { type: 'RESOLVE_CHOICE'; playerId: PlayerId; cardIds: CardId[] }
  | { type: 'LOCK_MELD'; playerId: PlayerId; meldType: MeldType; cardIds: CardId[] }
  | { type: 'PIVOT'; playerId: PlayerId; blueprintId: string }
  | { type: 'BUILD'; playerId: PlayerId; groups: CardId[][] }
  | { type: 'DISCARD'; playerId: PlayerId; cardId: CardId }
  | { type: 'CONTINUE'; playerId: PlayerId }
  | { type: 'SHOP_BUY'; playerId: PlayerId; slot: number; targetId?: CardId }
  | { type: 'SHOP_REROLL'; playerId: PlayerId }
  | { type: 'LEAVE_SHOP'; playerId: PlayerId }
  | { type: 'CHOOSE_NODE'; playerId: PlayerId; nodeId: string }
  | { type: 'PLAY_CARD'; playerId: PlayerId; cardUid: string; target?: number }
  | { type: 'END_TURN'; playerId: PlayerId }
  | { type: 'TAKE_REWARD'; playerId: PlayerId; index: number | null }
  | { type: 'REST'; playerId: PlayerId; choice: 'heal' | 'repair' | 'recharge' | 'leave'; itemUid?: string }
  | { type: 'DUEL_STAKE'; playerId: PlayerId; cardIds: CardId[] }
  /** Leave a duel stop before staking (not the boss). */
  | { type: 'DUEL_WALK_AWAY'; playerId: PlayerId }
  /** Send each opened piece to a scrapbook page, the parts deck, or sell it. */
  | { type: 'RUMMAGE_DONE'; playerId: PlayerId; destinations: PieceDestination[] }
  /** At an appraiser stop: pay to have one parcel of a lot ahead unwrapped. */
  | { type: 'APPRAISE'; playerId: PlayerId; nodeId: string; parcel: number }
  | { type: 'LEAVE_APPRAISER'; playerId: PlayerId }
  /** Check a parcel with a tool you hold. No nodeId = the lot you've won. */
  | { type: 'USE_TOOL'; playerId: PlayerId; toolId: string; nodeId?: string; parcel: number }
  /** Check a parcel with a gadget charge (e.g. the Magnifier). No nodeId = the lot you've won. */
  | { type: 'EXAMINE_LOT'; playerId: PlayerId; itemUid: string; nodeId?: string; parcel: number }
  /** Choose which parcels to take from a won lot. */
  | { type: 'PICK_PARCELS'; playerId: PlayerId; parcels: number[] }
  | { type: 'DUEL_DRAW'; playerId: PlayerId; source: 'deck' | 'discard' }
  | { type: 'DUEL_DISCARD'; playerId: PlayerId; cardId: CardId }
  | { type: 'DUEL_GO_OUT'; playerId: PlayerId; groups: CardId[][] }
  | { type: 'USE_GADGET'; playerId: PlayerId; itemUid: string; target?: number }
  | { type: 'RECHARGE'; playerId: PlayerId; itemUid: string }
  /** Spend better-material parts (or a gem) and credits to raise an item one grade. */
  | { type: 'UPGRADE_ITEM'; playerId: PlayerId; itemUid: string; cardIds: CardId[] };

export type ActionType = GameAction['type'];

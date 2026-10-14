/**
 * Tunables. A copy of the config is stored in GameState when a game starts,
 * so saved games keep the rules they were started with.
 *
 * Per-tier arrays are indexed by 0-based tier; if a tier is past the end of
 * the array, the last value is used.
 */

export interface StartingDeckConfig {
  /** Category ids to include; "all" uses every category in the content pack. */
  categories: string[] | 'all';
  /** Inclusive gauge range of starting parts. */
  gauges: [number, number];
  /** Copies of each category/gauge combination. */
  copies: number;
  /** Special card ids added to the starting deck. */
  specials: string[];
}

export interface MapConfig {
  /** Rows per act, including the final boss row. */
  rows: number;
  /** Lanes across the map. */
  width: number;
  /** Relative odds of each node type in the middle rows. */
  weights: { battle: number; workshop: number; elite: number; shop: number; rest: number };
}

export interface BattleConfig {
  startingHp: number;
  energy: number;
  handSize: number;
  /** Starter card ids that every battle deck includes. */
  starterDeck: string[];
  /** Enemy HP and damage multiplier, by act. */
  enemyScalingByAct: number[];
  /** Currency for winning each kind of battle (multiplied by act number). */
  currencyReward: { battle: number; elite: number; boss: number };
  /** Number of part/special cards offered after a battle. */
  rewardOptions: number;
  /** Fraction of max HP restored by resting. */
  restHealFraction: number;
  /** Fraction of max HP restored when starting a new act. */
  actHealFraction: number;
  /** HP lost when a workshop round fails. */
  workshopFailDamage: number;
}

export interface DuelConfig {
  /** Cards in each hand at the start of a duel, by act. */
  handSizeByAct: number[];
  /** Your draws per duel; when they run out, the best hand wins the pot. */
  drawLimit: number;
  /** Minions in a normal battle: [min, max]. */
  minionsPerBattle: [number, number];
  /** Currency for winning, by kind (multiplied by act number). */
  currencyReward: { battle: number; elite: number; boss: number };
  /** Rule twists a boss duel gets (boss modifier ids drawn at random). */
  bossTwists: number;
}

export interface QualityConfig {
  /** Extra gadget charges per grade above 1 (rounded down). */
  chargesPerGrade: number;
  /** Names for grades above the best material (reached with gems). */
  extraGradeNames: string[];
  /** Parts of the next grade (or better) needed to upgrade an item one grade. */
  upgradeParts: number;
  /** Credits per upgrade, multiplied by the new grade. */
  upgradeCreditsPerGrade: number;
}

export interface GameConfig {
  /** 'solo' is the MVP; 'versus' is reserved for multiplayer. */
  mode: 'solo' | 'versus';
  /**
   * 'map': acts with a branching map of workshops (rummy builds), battles,
   * shops and rests; items become battle cards. 'workshopOnly': the original
   * linear run of rummy rounds with a boss blueprint per tier.
   */
  runStructure: 'map' | 'workshopOnly';
  /**
   * Map runs only. 'rummy': fights are rummy duels against minions for a pot
   * of staked parts; items give passive bonuses and gadgets. 'cards': the
   * energy-and-block card battles.
   */
  battleStyle: 'rummy' | 'cards';
  duel: DuelConfig;
  quality: QualityConfig;
  map: MapConfig;
  battle: BattleConfig;
  tiers: number;
  /** Normal rounds per tier; a boss round follows them. */
  normalRoundsPerTier: number;
  /** Blueprints offered at the start of a normal round. */
  offersPerRound: number;
  gaugeMin: number;
  gaugeMax: number;
  handSizeByTier: number[];
  drawLimitByTier: number[];
  startingDeck: StartingDeckConfig;
  startingCurrency: number;
  /** 1 = the run ends on the first failed round. */
  lives: number;
  /** Currency for completing a round, by tier. */
  roundRewardByTier: number[];
  /** Extra currency per unused draw when a round is won. */
  rewardPerUnusedDraw: number;
  /** Deadwood: how each card left in hand is valued. */
  deadwood: {
    /** 'gauge' = the part's gauge; 'flat' = flatValue per card. */
    mode: 'gauge' | 'flat';
    flatValue: number;
    /** Value of a special card left in hand. */
    specialValue: number;
    /** Currency lost per deadwood point (fractional; rounded down). */
    currencyPerPoint: number;
  };
  /** 'survival' = clear all tiers; 'points' = also chase a high score. */
  scoring: 'survival' | 'points';
  /** Allow locking completed melds early (sub-assemblies). */
  subAssemblies: boolean;
  /** Minimum size of a locked meld. */
  minLockedMeldSize: number;
  /** Cost of switching to another offered blueprint mid-round. */
  pivotCost: { draws: number; currency: number };
  /** Every meld must include at least one real part. */
  requireNaturalInMeld: boolean;
  /** Turn the first card of the draw pile face up at round start. */
  flipStartingDiscard: boolean;
  shopRerollCost: number;
  /** Hook for future difficulty ladders / challenge modifiers (boss modifier ids applied every round). */
  challengeModifiers: string[];
}

export const defaultConfig: GameConfig = {
  mode: 'solo',
  runStructure: 'map',
  battleStyle: 'rummy',
  duel: {
    handSizeByAct: [7, 8, 9, 10],
    drawLimit: 12,
    minionsPerBattle: [1, 2],
    currencyReward: { battle: 3, elite: 6, boss: 12 },
    bossTwists: 1,
  },
  quality: {
    chargesPerGrade: 0.34,
    extraGradeNames: ['Jewelled', 'Masterwork'],
    upgradeParts: 3,
    upgradeCreditsPerGrade: 1,
  },
  map: {
    rows: 8,
    width: 3,
    weights: { battle: 45, workshop: 30, elite: 8, shop: 9, rest: 8 },
  },
  battle: {
    startingHp: 60,
    energy: 3,
    handSize: 5,
    starterDeck: ['hammer', 'hammer', 'hammer', 'hammer', 'plank_shield', 'plank_shield', 'plank_shield', 'plank_shield'],
    enemyScalingByAct: [1, 1.25, 1.5, 1.8],
    currencyReward: { battle: 4, elite: 8, boss: 15 },
    rewardOptions: 3,
    restHealFraction: 0.3,
    actHealFraction: 0.5,
    workshopFailDamage: 6,
  },
  /** Acts (map) or tiers (workshop-only). */
  tiers: 3,
  /** Workshop-only structure: normal rounds before each tier's boss round. */
  normalRoundsPerTier: 2,
  offersPerRound: 3,
  gaugeMin: 1,
  gaugeMax: 10,
  handSizeByTier: [10, 12, 14, 16],
  drawLimitByTier: [16, 18, 20, 22],
  startingDeck: {
    categories: 'all',
    gauges: [1, 8],
    copies: 2,
    specials: ['duct_tape'],
  },
  startingCurrency: 4,
  lives: 2,
  roundRewardByTier: [6, 8, 10, 12],
  rewardPerUnusedDraw: 1,
  deadwood: {
    mode: 'gauge',
    flatValue: 1,
    specialValue: 0,
    currencyPerPoint: 0.1,
  },
  scoring: 'survival',
  subAssemblies: false,
  minLockedMeldSize: 3,
  pivotCost: { draws: 2, currency: 0 },
  requireNaturalInMeld: true,
  flipStartingDiscard: true,
  shopRerollCost: 1,
  challengeModifiers: [],
};

/** Read a per-tier value, clamping to the last entry. */
export function perTier(values: number[], tier: number): number {
  if (values.length === 0) throw new Error('perTier: empty array');
  return values[Math.min(tier, values.length - 1)];
}

/** Shallow-merge overrides into the default config (nested objects merged one level). */
export function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    ...defaultConfig,
    ...overrides,
    startingDeck: { ...defaultConfig.startingDeck, ...overrides.startingDeck },
    deadwood: { ...defaultConfig.deadwood, ...overrides.deadwood },
    pivotCost: { ...defaultConfig.pivotCost, ...overrides.pivotCost },
    quality: { ...defaultConfig.quality, ...overrides.quality },
    duel: {
      ...defaultConfig.duel,
      ...overrides.duel,
      currencyReward: { ...defaultConfig.duel.currencyReward, ...overrides.duel?.currencyReward },
    },
    map: {
      ...defaultConfig.map,
      ...overrides.map,
      weights: { ...defaultConfig.map.weights, ...overrides.map?.weights },
    },
    battle: {
      ...defaultConfig.battle,
      ...overrides.battle,
      currencyReward: { ...defaultConfig.battle.currencyReward, ...overrides.battle?.currencyReward },
    },
  };
}

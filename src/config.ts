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

export interface GameConfig {
  /** 'solo' is the MVP; 'versus' is reserved for multiplayer. */
  mode: 'solo' | 'versus';
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
  tiers: 3,
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
  };
}

/** Public API of the rules engine. The UI should import from here only. */
export * from './types';
export { createEngine, engine, type Engine, type ApplyResult, type NewGameOptions } from './game';
export { defaultEffects, type EffectHandler, type EffectRegistry, type EffectContext } from './effects';
export { validateMeld, checkBuild, findBuild, meldMisfits, type MeldToken, type MeldResult, type MeldRules } from './melds';
export { getBlueprint, describeRequirement, visibleRequirements, blueprintSize } from './blueprints';
export { newSession, dispatch, replay, serializeSession, deserializeSession, type Session, type SaveFile } from './session';
export { botAction, autoplay } from './bot';
export { validateContent } from './validateContent';
export { RuleError, cardLabel, partName } from './zones';
export { Rng, seedToState } from './rng';
export { buildHints, meldHints, type BuildHints, type MeldHint } from './hints';
export { generateMap, reachableNodes, findNode } from './map';
export { battleCardDef, currentIntent, incomingDamage } from './battle';
export { makeEncounter, findDuelOut } from './duel';
export {
  STAGES,
  RARITIES,
  appraiseCost,
  canMeetStake,
  eligibleStakeCards,
  finishedGrade,
  hasPage,
  isKnown,
  lotsAhead,
  pageOf,
  pageRoom,
  pageSellPrice,
  pieceLabel,
  piecesNeeded,
  scrapbookPages,
  sharpened,
  stageFor,
  stakeProblem,
  suggestDestinations,
  viewParcel,
  type ParcelView,
} from './scrapbook';
export { checkUpgrade, gadgetCharges, gradeOf, itemMaxCharges, materialName } from './quality';
export {
  TIER_NAMES,
  activeBonuses,
  collectionCounts,
  gadgetAt,
  gadgetText,
  itemDef,
  itemTier,
  maxCharges,
  passiveText,
  rechargeCost,
  tierOf,
  type ActiveEffect,
} from './items';
export { cardsStillNeeded, placesNow } from './duel';

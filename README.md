# Rummage

A rummy-style building deckbuilder (working title). Draw and discard like gin rummy, meld **part cards** into **blueprints**, and turn finished blueprints into **items**: relics with passive effects. The parts you build with are gone for good, so each build trades deck quality for power.

This repo is a **playable framework**, not a finished game: a pure, tested rules engine, data-driven content, a minimal React UI for a single-player run, and an architecture that leaves room for multiplayer.

## Quick start

```bash
npm install
npm run dev        # play in the browser (http://localhost:5173)
npm test           # unit tests (Vitest)
npm run typecheck
npm run build      # typecheck + production build
npm run sim        # bot plays 200 seeded runs and reports win rate
npm run sim -- 300 '{"lives":1,"handSizeByTier":[9,11,13]}'   # with config overrides
```

## Layout

```
src/
  config.ts            tunables (hand sizes, draw limits, tiers, deck, currency, flags)
  content/             data: categories, specials, items, blueprints, bosses, shop pools (JSON)
  engine/              pure rules engine, no DOM
    types.ts           state, actions and content types (all plain JSON)
    game.ts            createEngine(): newGame, reduce, applyAction, suggestBuild
    melds.ts           set/run validation, wilds/bulk/adaptor, build solver
    effects.ts         effect/hook registry used by specials, items, bosses, shop services
    zones.ts           low-level card movement helpers + RuleError
    rng.ts             seeded RNG (state lives in GameState.rng)
    session.ts         action log, replay, save/load
    bot.ts             heuristic bot (tests, balance sim, future AI opponents)
    validateContent.ts content integrity checks
  ui/                  minimal React front end
tests/                 Vitest suites
scripts/simulate.ts    balance simulation
```

## Engine concepts

**Pure reducer.** `engine.reduce(state, action) => newState`. The input is never mutated (it is cloned, then handlers work on the draft). Illegal actions throw `RuleError`; `engine.applyAction` returns `{ ok: false, error }` instead. No timers, DOM or `Math.random`: all randomness comes from the seeded RNG stored in `state.rng`, so a seed reproduces a whole run.

**Serialisable everything.** `GameState` and `GameAction` are plain JSON. A `Session` is `{ initial, actions, state }`; `replay(initial, actions)` rebuilds the current state, and `deserializeSession` checks a save against its log. The same action stream is what a server or peer would exchange later.

**Actions.** `SELECT_BLUEPRINT`, `DRAW`, `PLAY_SPECIAL`, `RESOLVE_CHOICE`, `LOCK_MELD`, `PIVOT`, `BUILD`, `DISCARD`, `CONTINUE`, `SHOP_BUY`, `SHOP_REROLL`, `LEAVE_SHOP`. Every action carries a `playerId`.

**Phases.** `blueprintSelect` → `playing` → `roundOver` → `shop` → `blueprintSelect` … → `runWon` / `runLost`. Within `playing`, each turn is `draw` → `main` (play specials, lock sub-assemblies, pivot, build) → discard. Some specials open a `pendingChoice` (Toolbox, Parts Catalogue), which must be resolved with `RESOLVE_CHOICE` first.

**Cards and zones.** All cards live in `state.cards` keyed by id, with an `owner`. A player's `deck` is the permanent master list; `drawPile`, `hand`, `played` and `lockedMelds` are per-round zones, rebuilt from `deck` at round start. Building destroys the used cards (removed from `deck` and `cards`). Temporary cards (e.g. Glue Pot's free Duct Tape) vanish at round end.

**Rules per round.** `player.rules` (`RoundRules`) is computed at round start: base values from config for the tier, then rule modifiers from challenge modifiers, the boss, and the player's items. Meld validation reads these rules (disabled wild roles, banned categories, gauge range…).

### Melds

- **Set**: N cards of the same gauge, any categories.
- **Run**: N cards of one category with consecutive gauges.
- Requirements may add `category`, `minGauge`, `maxGauge`; a meld may have more cards than required.
- Special cards act through a *meld role*:
  - `wild` (Duct Tape): any part, 1 slot.
  - `bulk` (Bulk Pack): `slots` copies of the set's part. Sets only.
  - `adaptor` (Adaptor): takes no slot; one natural part in the meld may shift gauge ±1 *or* change category.
- By default every meld needs at least one real part (`requireNaturalInMeld`).
- `findBuild` (exposed as `engine.suggestBuild`) searches for a valid assignment; the UI's "Auto-fill" and the bot use it.

### Effect hooks

Content references effects by name: `{ "type": "modifyRules", "params": { "handSize": 1 } }`. Handlers in `src/engine/effects.ts` implement any of these hooks:

| Hook | When |
|---|---|
| `meldRole(params)` | Turns a special card into a meld token (wild / bulk / adaptor). |
| `resolveParams(params, rng)` | Resolve random params once (e.g. Embargo's banned category). |
| `modifyRules(rules, params)` | Adjust the round's rules (items, bosses, challenges). |
| `onRoundStart(ctx)` | After the hand is dealt. |
| `onDraw(ctx)` | The card was just drawn from the draw pile. |
| `onPlay(ctx)` | The card was played from hand (`ctx.targetId` is the chosen target). |
| `onBuild(ctx)` | The player completed a build. |
| `onRoundEnd(ctx)` | Round ended (before cleanup). |
| `onPurchase(ctx)` | A shop service was bought. |

Built-in effect types: `meldRole`, `drawChoice`, `reorderTop`, `takeFromDiscard`, `destroyCard`, `addRandomParts`, `modifyRules`, `banCategory`, `grantTempCard`, `gainCurrency`.

## Adding content

All of these are JSON edits only; `npm test` runs `validateContent` to catch broken references.

- **Blueprint**: add to `src/content/blueprints.json` with a `tier`, `requirements` (`hidden: true` hides one until chosen) and the `itemId` it builds. Set `"boss": true` for end-of-tier bosses.
- **Item**: add to `items.json` with effects, e.g. `{ "type": "modifyRules", "params": { "drawLimit": 1 } }`.
- **Special card**: add to `specials.json`. Use `meldRole` for meld behaviour; set `playable`, `target` (`none` / `handCard` / `discardCard`) and `consumeOnPlay` for played specials. It appears in shops according to `weight` and `minTier`.
- **Boss modifier**: add to `bosses.json`. It is picked at random for boss rounds (respecting `minTier`). Modifiers listed in `config.challengeModifiers` apply to every round, which is the hook for future difficulty ladders.
- **Shop**: `shop.json` has one pool per tier (the highest pool ≤ current tier is used): slot counts, prices, category weights and services.
- **New effect type**: add a handler to `defaultEffects` in `effects.ts` (or pass your own registry to `createEngine(content, effects)`), then reference it from JSON.

## Config

`src/config.ts` holds all tunables. `makeConfig(overrides)` merges overrides; the config is copied into the game state so saves keep their rules. The open design questions are config switches rather than decisions:

| Question | Config |
|---|---|
| Lose on first failed round, or lives | `lives` |
| Sub-assemblies in the core game | `subAssemblies`, `minLockedMeldSize` |
| Survival vs points scoring | `scoring` (score is always tracked) |
| Blueprints offered per round | `offersPerRound` (overlap comes from content) |
| Draw limit vs hand size per tier | `handSizeByTier`, `drawLimitByTier` |
| Pivot cost | `pivotCost` |
| Theme | `content/categories.json` (names, colours, flavour nouns) |

The current defaults are a first pass: the simple bot wins about a quarter of runs, and people should do better. Use `npm run sim` to compare settings.

## Multiplayer readiness

Not implemented in the UI, but the engine already supports it:

- `newGame({ players: [...] })` creates N players with their own deck, hand, items and currency.
- Turn order uses `activePlayer`; actions from the wrong player are rejected.
- The discard pile and shop are shared (one market, everyone fights over the discard).
- Each player picks a target from the face-up offers; the first to `BUILD` ends the round and the others score deadwood (`mode: 'versus'` skips the life loss).
- A player out of draws is `exhausted` and skipped; the round ends unbuilt if all are exhausted.

Still to do for real multiplayer: per-player shop turns, hidden-information views (filter other players' hands before sending state), and a server that validates actions with the same `reduce`.

## Known gaps / next steps

- Placeholder art and flavour text only; the bot is a basic heuristic.
- Hidden requirements are revealed when chosen (or by the Magnifier item); there is no "reveal" special card yet.
- Balance (rewards, prices, draw limits) is a first pass.

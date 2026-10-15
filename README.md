# Rummage

A rummy-style collecting deckbuilder (working title). Rummy is the whole game:

1. **The map:** each act is a branching route of duels, elites, shops, rests and appraisers to a boss. Every duel stop is fought over a **lot**: a box of wrapped parcels (shoebox, tea chest, loft box, workshop clearance, barn find, and an estate sale at the boss). The map shows how many parcels each lot holds and how many the winner picks.
2. **Duels:** every fight is a race of rummy. Everyone at the table stakes the same thing (for example 2 Copper parts), and you must match it with that material or better. You share a discard pile and race to complete a small target (e.g. a set of 3 and a run of 3). The first to go out takes the lot and every stake. Losing costs your stake, and against a boss, a life.
3. **Picking:** win and you pick your parcels from the lot; the rest go back to the seller. You choose blind unless you've checked them.
4. **The scrapbook:** each item has a page with a stage per material, Tin to Platinum. Found parts go onto pages (or into your deck, or get sold). Fill a stage and the item comes to life at that grade, or rises to it. Items give a passive bonus (like Balatro jokers) and a **gadget** you trigger in duels, such as the Pocket Watch, which makes an opponent miss a turn.

**Checks.** Every parcel starts wrapped. You hold check cards (`tools.json`, `player.tools`) and spend them on parcels in lots ahead or on the pick screen (`USE_TOOL`). Calipers, Vernier Calipers and a Micrometer are certain of the number and leave 4, 3 or 2 possible metals; a Scratch Test, Acid Test and Assay are certain of the metal and leave 4, 3 or 2 possible numbers; Unwrap shows everything. The real piece is always in the list, and each parcel's look-alikes are fixed when the lot is made (`Parcel.altMetals` / `altGauges`), so sharper checks narrow the same list and checks never contradict each other. Shops sell checks, an **Appraiser** stop unwraps parcels for credits (`APPRAISE`), and the Magnifier's passive sharpens every check by one while its Spyglass gadget is a reusable metal check (`EXAMINE_LOT`, set by `onLot` in `items.json`) that gets sharper with grade.

**Materials and grades.** Each part category is a material, one per grade: Tin 1, Wood 2, Iron 3, Copper 4, then the rarer Brass 5, Silver 6, Gold 7 and Platinum 8 (starting decks are Tin to Copper). An item's grade is the highest scrapbook stage you've filled. Higher grades give gadgets more charges and stronger effects; a Gold Pocket Watch stops time for 2 turns.

Gadget charges do not refill between fights, so every use is a choice: spend it to win a lot now, or save it for the boss. Recharging costs credits (each gadget has its own price, e.g. 5 to rewind the Pocket Watch), and a rest stop recharges one for free.

The older **workshop** mode (`config.itemSource: 'workshop'`) is still available: workshop stops where a longer rummy round builds a blueprint into an item, graded by the average material of its parts, with upgrades at shops and rests.

New here? Start with **[docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)**: how to run it, what's built, the direction and next steps.

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
    map.ts             act map generation and reachability
    duel.ts            rummy duels: stakes, pot, minion AI, going out, showdown
    quality.ts         materials, item grades, gadget charges, upgrades
    battle.ts          card-battle layer (alternative style, config battleStyle: 'cards')
    battleZones.ts     low-level battle helpers (draw, damage)
    hints.ts           "what does my blueprint still need" hints
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

**Actions.** Workshop: `SELECT_BLUEPRINT`, `DRAW`, `PLAY_SPECIAL`, `RESOLVE_CHOICE`, `LOCK_MELD`, `PIVOT`, `BUILD`, `DISCARD`, `CONTINUE`. Shop: `SHOP_BUY`, `SHOP_REROLL`, `LEAVE_SHOP`. Map: `CHOOSE_NODE`, `PLAY_CARD`, `END_TURN`, `TAKE_REWARD`, `REST`. Every action carries a `playerId`.

**Run structures** (`config.runStructure`):
- `map` (default): `map` → a stop (`blueprintSelect`/`playing`/`roundOver` for workshops, `battle` → `battleReward`, `shop`, `rest`) → back to `map` … boss → next act → `runWon` / `runLost`. A failed workshop costs HP; reaching 0 HP ends the run.
- `workshopOnly`: the original linear run of rummy rounds: `blueprintSelect` → `playing` → `roundOver` → `shop` → … with a boss blueprint each tier and lives. Most rummy-layer tests use this mode. Within `playing`, each turn is `draw` → `main` (play specials, lock sub-assemblies, pivot, build) → discard. Some specials open a `pendingChoice` (Toolbox, Parts Catalogue), which must be resolved with `RESOLVE_CHOICE` first.

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

### Duels (default battle style)

- **Encounters** are rolled when an act's map is made, so the map shows who you'll face, what everyone stakes and the lot (see "Up for grabs next" under the map).
- **Ante** (`DUEL_STAKE` with `cardIds`): with matched stakes (`Encounter.stakeRule`), you stake `count` parts of the stake material or better; the material climbs with the act. If you can't match it you can `DUEL_WALK_AWAY` (not from the boss, which takes any parts instead). Hands are dealt from each side's own deck; the discard pile is shared.
- **Turns**: `DUEL_DRAW` (your deck or the discard), then `DUEL_GO_OUT` if your cards complete the target, else `DUEL_DISCARD`, after which every opponent takes a turn (seeded AI; `greedy` minions grab discards).
- **End**: first to go out wins. If your draws (`config.duel.drawLimit`) run out, the closest hand wins and ties go to the opponents. Winning adds the stakes to your parts deck plus credits, and wins the lot.
- **Rummage**: `PICK_PARCELS` chooses `lot.picks` parcels, then `RUMMAGE_DONE` sends each opened piece goes to a scrapbook page (`{ to: 'page', itemId }`), the deck, or is sold. A part fills the stage of its own material, or the best lower stage still open. Stage sizes are `config.scrapbook.piecesByGrade`.
- **Items in duels**: passive `modifyRules` effects apply (e.g. Workbench gives +1 hand size); `onRoundStart` effects fire when hands are dealt, `onRoundEnd` when a duel ends, and `onBuild` when you go out. Gadgets (`ItemDef.gadget`) run `onGadget` effects: `skipTurn`, `revealHands`, `stealCard`, `raiseStakes`, `extraDraws`, `drawExtra`, `grantTempCard`. Charges live on `ItemInstance.charges`. `RECHARGE` costs `rechargeCost` on the map or in a shop; `REST` with `recharge` is free.
- **Bosses** get `config.duel.bossTwists` random rule twists (the boss modifiers).
- **Content**: `minions.json` (deck, stakes, greedy), `duelTargets.json` (race blueprints by kind and act), `lots.json` (size, material odds, rare and gem chances, which duel kinds and acts).

### Map and card battles (alternative style)

- **Map** (`map.ts`): rows × lanes. Row 0 is workshops, the middle rows are drawn from `config.map.weights`, the second-to-last row is rest or **master workshop** (a boss blueprint plus a random hazard, which builds a stronger item), and the last row is the boss. Each node always links to its own lane in the next row, and sometimes diagonally.
- **Items in battle**: `ItemDef.battle` is a `BattleCardDef` (`cost`, `effects`, optional `uses`, `targeted`). An `ItemInstance` has a `level` (blueprint tier, +1 from a master workshop) that adds each effect's `perLevel` bonus, and `usesLeft` (`null` = never breaks). When an item breaks, it is removed along with its passive effect. Rest stops can repair it.
- **Battles** (`battle.ts`, placeholder design): energy per turn, a hand of cards, block that resets each turn, and enemies that cycle through visible intents (`attack`, `block`, `attackBlock`) scaled by `config.battle.enemyScalingByAct`. The whole battle layer sits behind `startBattle` / `playBattleCard` / `endBattleTurn`, so a different combat design can replace it without touching the workshop layer.
- **Battle effects** are ordinary effect handlers with an `onBattlePlay` hook: `damage` (`amount`, `perLevel`, `hits`), `damageAll`, `block`, `draw`, `energy`, `heal`, and `gainCurrency` with `"hook": "onBattlePlay"`.
- **Rewards**: currency (by fight kind × act) plus a choice of part or special cards for the parts deck, which feeds the next workshop.

## Adding content

All of these are JSON edits only; `npm test` runs `validateContent` to catch broken references.

- **Blueprint**: add to `src/content/blueprints.json` with a `tier`, `requirements` (`hidden: true` hides one until chosen) and the `itemId` it builds. Set `"boss": true` for end-of-tier bosses.
- **Item**: add to `items.json` with effects, e.g. `{ "type": "modifyRules", "params": { "drawLimit": 1 } }`.
- **Special card**: add to `specials.json`. Use `meldRole` for meld behaviour; set `playable`, `target` (`none` / `handCard` / `discardCard`) and `consumeOnPlay` for played specials. It appears in shops according to `weight` and `minTier`.
- **Boss modifier**: add to `bosses.json`. It is picked at random for boss rounds (respecting `minTier`). Modifiers listed in `config.challengeModifiers` apply to every round, which is the hook for future difficulty ladders.
- **Minion**: add to `minions.json` with `kind`, a `deck` spec, `stakes`, optional `greedy` and `minAct`/`maxAct`.
- **Duel target**: add to `duelTargets.json`.
- **Lot**: add to `lots.json` with `kinds`, `size`, `picks`, `materials` (everyday material odds), `rareChance`, `gemChance`, `gauges` and optional `minAct`/`maxAct`. Every item automatically gets a scrapbook page.
- **Check card**: add to `tools.json` with `reveals` (`gauge`, `metal` or `both`), `options` (possibilities left for the other attribute), `price` and shop `weight`.
- **Gadget**: add a `gadget` block to an item in `items.json` (`charges`, `rechargeCost`, `rechargeName`, `target`, `effects`). Effect params can include `perGrade`, which adds `floor(perGrade × (grade − 1))`.
- **Material**: add to `categories.json` with a `grade`; mark `rare: true` (and a low `weight`) to keep it out of starting and minion decks. Gems are specials with `gradeBonus`.
- **Enemy** (card battles): add to `enemies.json` with `kind` (`normal` / `elite` / `boss`), `hp`, optional `minAct`/`maxAct`, and an `intents` cycle.
- **Starter battle card**: add to `starterCards.json` and list it in `config.battle.starterDeck`.
- **Item battle card**: add a `battle` block to the item in `items.json`.
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

The current defaults are a first pass. On map runs the simple bot wins about 40% of runs, and in workshop-only runs about a quarter. People should do better. Use `npm run sim` to compare settings.

## Multiplayer readiness

Not implemented in the UI, and map runs are single-player for now (multiplayer uses `runStructure: 'workshopOnly'`). The workshop engine already supports:

- `newGame({ players: [...] })` creates N players with their own deck, hand, items and currency.
- Turn order uses `activePlayer`; actions from the wrong player are rejected.
- The discard pile and shop are shared (one market, everyone fights over the discard).
- Each player picks a target from the face-up offers; the first to `BUILD` ends the round and the others score deadwood (`mode: 'versus'` skips the life loss).
- A player out of draws is `exhausted` and skipped; the round ends unbuilt if all are exhausted.

Still to do for real multiplayer: per-player shop turns, hidden-information views (filter other players' hands before sending state), and a server that validates actions with the same `reduce`.

## Known gaps / next steps

- Placeholder art and flavour text only; the bot is a basic heuristic.
- Duel balance and minion AI are a first pass. The card-battle style is kept as an alternative (`battleStyle: 'cards'`).
- Ideas not built yet: luck/event stops, a scrapbook that carries over between runs, item art per stage.
- Hidden requirements are revealed when chosen (or by the Magnifier item); there is no "reveal" special card yet.
- Balance (rewards, prices, draw limits) is a first pass.

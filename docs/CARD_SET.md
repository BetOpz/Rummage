# Rummage: the item card set

The rules for building the set of about 200 item cards. Every item is one scrapbook page and one card. The cards themselves live in **`design/card-portfolio.json`**, and `npm run portfolio` checks them against these rules and shows what's still missing. How the cards will look is in [CARD_DESIGN.md](CARD_DESIGN.md).

Some rules here change the live game (marked **Changes the game**). They're proposals until they're built.

**Everything here is provisional.** None of it has been played yet: the numbers, rarities, charge curve, set bonuses and pages-per-run rules are first guesses, and they'll change once the cards are in the real game and we see how they play.

---

## 1. Plan

1. **Framework** (this document): structure, rarities, scaling, wording and the engine vocabulary.
2. **Batch 1** (26 cards, done in draft): the 8 live items reworked to these rules, plus 18 new ones spread across every collection and rarity to test the template.
3. **Batch 2** (34 cards, done in draft): completes Clockwork and Hearth, so two collections can be judged whole.
4. **Batches 3–8** (about 25 each): fill one or two collections per batch until each has its 20.
5. **Engine work** runs alongside, in the order `npm run portfolio` shows: the needs most cards are waiting on come first.

## 2. Shape of the set

**200 items: 10 collections of 20.** Each collection has the same rarity spread:

| Rarity | Per collection | In the set | What it's for |
|---|---|---|---|
| Common | 8 | 80 | One simple job. Up to 2 per collection can be **fixtures**: no gadget, a stronger passive. |
| Uncommon | 6 | 60 | A job with a decision in it, or two small effects that pull the same way. |
| Rare | 4 | 40 | Bends a rule of the game (stakes, lives, the map, going out). |
| Heirloom | 2 | 20 | A build-around: weak on its own, strong with the right other items. |

Each item also has one **role**, the job it does. Roles cut across collections, so the same job can turn up in different themes:

| Role | Changes | Role | Changes |
|---|---|---|---|
| tempo | draws, hand size | credits | money |
| flexibility | what counts in a meld | lots | parcels, picks, checks |
| disruption | opponents' turns and hands | scrapbook | pieces, stages, pages |
| discard | the shared discard pile | bosses | lives, twists, boss duels |
| information | what you can see | route | the map |
| stakes | the stake and the pot | synergy | other items you own |

## 3. Collections

A collection is a family of objects with a theme and a mechanical lean. About half of each collection's items do its lean, and the rest do other jobs in its style. Collections are what make the set collectable, and what make items work together.

| Collection | Objects | Lean | 3-item bonus |
|---|---|---|---|
| Clockwork | watches, automata, music boxes | turns and timing | +1 draw in every duel |
| Optics | lenses, periscopes, cameras | information | At the start of each duel, see 1 random card in each opponent's hand |
| Workshop | benches, glue, solder, files | meld flexibility | Start each duel with a temporary Adaptor |
| Haberdashery | needles, thread, buttons, thimbles | the scrapbook | The first piece you place after each win counts as 2 |
| Counting House | scales, abacus, ledgers, presses | credits and stakes | +2 credits after each duel you win |
| Scrapyard | crowbars, magnets, claws, sieves | lots and the discard pile | Every lot you win holds 1 more parcel |
| Hearth | bellows, kettles, traps, oil cans | the discard pile and hazards | You can see the top 3 cards of the discard pile |
| Playroom | toys, parlour games, tricks | disruption | Opponents start each duel with 1 card fewer |
| Expedition | compasses, reels, lanterns, maps | the route | Shops stock 1 more check card and appraisers charge 1 less |
| Apothecary | flasks, tonics, salts, bandages | bosses and recovery | Rests recharge 2 gadgets instead of 1 |

- **Set bonus.** Owning 3 living items from a collection gives its bonus. Owning 5 also gives every gadget in that collection +1 charge.
- **Synergy cards** (mostly Heirlooms) can count items in their own collection ("+1 draw for each Clockwork item you own").
- **Changes the game:** set bonuses are new (engine need `collectionBonus`).

## 4. Pages in a run

With 200 items, a run can't offer every page. **Working assumption** (batch 2 is written against it; still open to change, and if it changes, card strength is adjusted rather than the designs):

- **The scrapbook holds up to 12 pages in a run.** You start with 3, chosen from 5 Common pages offered at the start.
- **Loose pages** are a new kind of parcel in lots: a page instead of a part. Lots have a page chance (shoebox 5%, up to estate sale 40%, where the boss lot always holds one Rare or Heirloom page).
- **Shops sell pages:** 1 slot, priced by rarity (Common 4, Uncommon 6, Rare 9, Heirloom 12).
- **A full scrapbook:** taking a new page means tearing one out, and its pieces are lost. A living item from a torn-out page dies.
- **Rarity odds** for loose pages and shop pages, by act:

| Act | Common | Uncommon | Rare | Heirloom |
|---|---|---|---|---|
| 1 | 70% | 25% | 5% | 0% |
| 2 | 50% | 32% | 15% | 3% |
| 3 | 35% | 35% | 22% | 8% |

- **Later:** which of the 200 pages can turn up at all is your collection across runs. A new player starts with about 40 unlocked, and completing pages unlocks more (the carry-over scrapbook in the project guide).

## 5. Anatomy of an item

Every card in `design/card-portfolio.json` has these fields. Every text and art field has 3 entries: **Prototype** (Tin–Copper), **Fine** (Brass, Silver) and **Masterwork** (Gold, Platinum).

| Field | What it holds |
|---|---|
| `id`, `name` | snake_case id; the card name. Both unique. |
| `status` | `live` (in `src/content/items.json`), `draft` or `cut`. |
| `batch` | Which batch it was designed in. |
| `collection`, `rarity`, `role` | From sections 2 and 3. |
| `object` | What the object is, in one line. Feeds the art. |
| `passive` | `text` per tier, and `effects`. Always on once the item is alive. |
| `gadget` | `name`, `usedIn` (places, section 7), `target`, base `charges`, `rechargeName`, `rechargeCost`, `text` per tier, `effects`. Optional `when` (conditions, section 9) and `usedInByTier` (when a later tier can use it somewhere new). `null` for a fixture. |
| `engine` | `build`: `json` (works with what exists), `small` (an existing effect needs extending) or `new`. `needs`: the named engine pieces from section 9. |
| `rules` | Edge cases and rulings, one per line. |
| `art` | One line per drawing tier, from scrappy to masterwork. |

## 6. Growth: how items get better

**Changes the game.** Today, gadget numbers grow by grade in fractional steps (`perGrade`), which made the Pocket Watch's Stop Time reach 2 turns at Silver while its text said Gold. Passives don't grow at all. The new rule ties growth to things players can see:

- **Charges grow every two grades:** `base + floor((grade − 1) / 2)`.

| Base | Tin | Wood | Iron | Copper | Brass | Silver | Gold | Platinum |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 1 | 2 | 2 | 3 | 3 | 4 | 4 |
| 2 | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 5 |

- **Abilities and numbers change only at the drawing tiers:** Brass (Fine) and Gold (Masterwork). Each tier must change **something** on the card (the passive, the gadget, or both), and the text says exactly what the card does at that tier.
- **Tier params:** any number or true/false in an effect can be a list of 3, one per tier: `"drawLimit": [2, 2, 3]`. A single value means the same at every tier.
- **Base charges** are 1 or 2 (Heirlooms 1). **Recharge costs** by rarity: Common 2–4, Uncommon 3–6, Rare 4–7, Heirloom 6–9.

**Power guide** (a starting point for the sim to correct):

- **A draw is a turn.** In a duel your draw limit is the number of turns you get; when it runs out the duel goes to a showdown. Opponents have no limit and take a turn after each of yours. So +1 draw is one more turn, and cards never cut an opponent's draws: they make it miss turns, stop it going out, or keep it off the discard pile.

- A Common's passive is worth about **1 draw** (Prototype) to **2 draws** (Masterwork). A fixture's is worth about half as much again.
- One gadget charge is worth about **one turn of tempo**: an opponent missing a turn, 2 extra cards, or a sure pick of one card.
- +1 hand size is worth about 2 draws. 1 credit is worth about a third of a draw.
- A Rare can break a rule at Prototype (stake insurance, a spare life, any stop on the map) and should cost a lot to recharge.

## 7. Where gadgets are used

**Changes the game.** Gadgets work only in duels today (`USE_GADGET` checks for an active duel). The set uses six places:

| Place | When | Example |
|---|---|---|
| `duel` | Any time on your turn in a duel | Stop Time |
| `duelResult` | On the result screen after a duel, before it's cleared | Weigh In (Masterwork), after you've lost |
| `lot` | On a lot ahead on the map, or on the pick screen of a lot you've won | Spyglass, Prise Open |
| `map` | On the map, between stops | Reroute, Align the Planets |
| `shop` | During a shop visit | Haggle |
| `scrapbook` | When the scrapbook is open outside a duel, including while sorting pieces | Stitch, Darn |

Engine need `gadgetAnywhere`: `USE_GADGET` gains a place and the right target (an opponent, a card, a parcel, a page or a map stop), and each place checks it's allowed there.

## 8. Wording

Cards say exactly what happens, in the game's own words, and nothing else.

- **Passive:** a plain statement. "+2 draws." / "Start each duel with a temporary Adaptor."
- **Gadget:** starts with a verb, or with its condition first: "Boss duels only: …". Named abilities at a tier go first with a colon: "Repeater: every opponent misses its next turn."
- **Numbers** are digits. "+1 draw", "1 more credit", "up to 2 parts".
- **Scope** is always stated: "this duel", "for the rest of the duel", "this visit", "after each win".
- **Opponents:** "an opponent" (you choose), "a random opponent", "every opponent". "Minion" only when bosses are excluded.
- **Temporary** cards vanish when the duel ends. Say "temporary" every time.
- **Rulings** live in the card's `rules` list, not on the card. The card text is what a player needs at the table.

**Terms** (use exactly these): draw, draws (the limit), hand size, go out, discard, discard pile, top card, draw pile, set, run, meld, wild, Adaptor, Duct Tape, real part, stake, pot, lot, parcel, pick, check, unwrap, page, stage, piece, grade, material, charge, recharge, opponent, minion, elite, boss, twist, greedy, temporary, turn, duel, credit, shop, rest, appraiser.

## 9. Engine vocabulary

Effects the cards can use. **Exists** means it's in `src/engine/effects.ts` today. Everything else is a named need that cards list in `engine.needs`, so the work can be planned by how many cards each one unlocks.

**Existing effects**

| Effect | Use | Notes |
|---|---|---|
| `modifyRules` | passive | `handSize`, `drawLimit`, `allowDiscardDraw`, `disableMeldRoles`, `bannedCategories`, `gaugeMin`, `gaugeMax`, `requireNaturalInMeld` |
| `grantTempCard` | passive (`onRoundStart`) or gadget | gives a temporary special card |
| `gainCurrency` | passive (`onRoundEnd`, `onBuild`) | credits |
| `lotInsight` | passive | sharpens checks (the Magnifier) |
| `skipTurn`, `revealHands`, `extraDraws`, `drawExtra`, `stealCard`, `raiseStakes` | gadget | duel gadgets |
| `drawChoice`, `reorderTop`, `takeFromDiscard` | special cards | exist for workshop specials; need a gadget version (`.gadget`) |

**Hooks** (when passives fire). Existing: `onRoundStart` (hands dealt), `onBuild` (you go out), `onRoundEnd` (duel ends). Needed: `hook.onTurnStart` (your turn begins), `hook.onOpponentSkipped` (an opponent misses a turn), `hook.onOpponentNearOut` (an opponent is 1 card from going out), `hook.onDuelDraw`, `hook.onDiscard`, `hook.onOpponentTake` (an opponent takes from the discard pile), `hook.onOpponentWouldGoOut`, `hook.onStake`, `hook.onPick`, `hook.onPlacePiece`, `hook.onStageComplete`, `hook.onEnterStop`, `hook.onShopEnter`.

**Conditions** (`when`), on any effect or gadget: `kind` (battle, elite, boss), `greedyOpponent`, `minOpponents`, `act`, `won`. Engine need `when`.

**Shared needs**

| Need | What it is |
|---|---|
| `tierParams` | Resolve 3-item params by the item's drawing tier. Every card needs it. |
| `gadgetAnywhere` | Gadgets outside duels (section 7). |
| `duelChoice` | A choice inside a duel (pick a card, reorder, look and decide). Duels have no pending choice today. |
| `gadgetTargetCard` | A gadget that targets a card in your hand or the discard pile. |
| `perOwned` | A number that counts items you own in a collection. |
| `collectionBonus` | Set bonuses (section 3). |
| `rule.*` | New round rules: `seeOwnTop`, `seeDiscard`, `protectDiscardTurns`, `stakeGrace`, `wrapRuns`, `seeOpponentProgress`, `freeDiscardDraws`, `takeAnyDiscard`, `extraDiscards`, `opponentDiscardDraw`. |

New single-card effects are named after what they do (`discardTrap`, `swapHands`, `movePieces` and so on). The current list, with which cards need each, is printed by `npm run portfolio`.

## 10. Adding a card

1. Add it to `design/card-portfolio.json`, following section 5. Reuse an existing effect where one fits; otherwise name a new need.
2. Run `npm run portfolio`. It fails on broken rules (missing tiers, wrong charge or recharge range, duplicate names, too many cards of a rarity in a collection, a live item missing) and shows the gaps.
3. When its engine needs exist, copy it into `src/content/items.json` and mark it `live`.

## 11. Batch 1

26 cards: the 8 live items and 18 new ones. Every collection and rarity is represented, and gadgets are used in all six places.

| Collection | Cards |
|---|---|
| Clockwork | Pocket Watch (U), Music Box (R), Orrery (H) |
| Optics | Periscope (C), Magnifier (U) |
| Workshop | Workbench (C, fixture), Glue Pot (C), Sorting Tray (C), Soldering Iron (U) |
| Haberdashery | Thimble (C), Sewing Kit (U) |
| Counting House | Abacus (C), Coin Press (U), Brass Scales (R) |
| Scrapyard | Horseshoe Magnet (C), Salvage Rig (U), Crowbar (U) |
| Hearth | Bellows (C), Mousetrap (U), Oil Can (U) |
| Playroom | Clockwork Mouse (C), Kaleidoscope (U), Chess Automaton (H) |
| Expedition | Spare Reel (C), Pocket Compass (R) |
| Apothecary | Hip Flask (U) |

**Changes to live items in batch 1**

- All 8 move to tier params and the new charge curve. The items that had base 2 drop to base 1, so a Platinum item still has 4 charges, but a Tin one has 1 instead of 2. The Magnifier keeps base 2 (it had 3).
- **Pocket Watch:** fixes the Silver/Gold mismatch. Fine adds +1 draw; Masterwork stops every opponent.
- **Coin Press:** Raise the Stakes now costs you a part too, and opponents add parts of the stake material. At the moment it's free money.
- **Glue Pot:** Fine tapes count as real parts.
- **Magnifier:** Spyglass parcel checks go 1 of 3, 1 of 2, exact by tier.
- **Workbench** is a fixture (it already has no gadget), so its passive grows at Fine and Masterwork.

## 12. Batch 2

34 cards that complete two collections. Clockwork leans on turns: extra turns, missed turns, blocking going out, and seeing how close opponents are. Hearth leans on the discard pile and hazards: free and deeper takes, swaps, locks, twists and boss duels.

| Collection | Common | Uncommon | Rare | Heirloom |
|---|---|---|---|---|
| Clockwork | Egg Timer, Metronome (fixture), Wind-Up Key, Cuckoo Clock, Alarm Clock, Mainspring, Gearbox, Pendulum | Carriage Clock, Chronometer, Water Clock, Escapement, Perpetual Calendar | Grandfather Clock, Tourbillon, Stopped Clock | Astronomical Clock |
| Hearth | Kettle (fixture), Coal Scuttle, Fire Poker, Fireguard, Toasting Fork, Tinderbox, Dustpan and Brush | Warming Pan, Fire Bucket, Stockpot, Chimney Pot | Kitchen Range, Fire Blanket, Pot-Bellied Stove, Firedogs | Brass Fender, Smoke Jack |

Batch 1 cards in these collections are unchanged. Rulings marked "to confirm" in the data (gadgets under the Locked Skip twist; smothering a boss duel) need a decision before those cards are built.

## 13. Open questions

- **Pages in a run** (section 4): the working assumption above. Confirm or change it; batch 3 onwards are written against whatever stands.
- **Set bonuses:** 3 and 5 items are guesses. With 12 pages they're reachable but take commitment.
- **Fixtures:** are 2 per collection (20 in all) the right number?
- **Balance:** the bot doesn't use gadgets well, so the sim will undervalue gadget-heavy items. A better bot is needed before tuning.

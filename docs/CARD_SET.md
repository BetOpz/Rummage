# Rummage: the item card set

The rules for building the set of about 200 item cards. Every item is one scrapbook page and one card. The cards are the game's item content, **`src/content/items.json`**, and `npm run portfolio` checks them against these rules and shows what's still missing. How the cards will look is in [CARD_DESIGN.md](CARD_DESIGN.md).

**Built.** Everything in this document is in the game: tiers and tier params, the charge curve, conditions, set bonuses, gadgets in all six places, duel choices, pages in a run, and every effect the 60 cards use (`src/engine/items.ts`, `effects.ts`, `duel.ts`, `scrapbook.ts`).

**Everything here is provisional.** The numbers, rarities, charge curve, set bonuses and pages-per-run rules are first guesses. Cards are adjusted case by case now that they can be played.

---

## 1. Plan

1. **Framework** (this document): structure, rarities, scaling, wording and the engine vocabulary. Built.
2. **Batch 1** (26 cards): the 8 original items reworked to these rules, plus 18 new ones spread across every collection and rarity. In the game.
3. **Batch 2** (34 cards): completes Clockwork and Hearth, so two collections can be judged whole. In the game.
4. **Batches 3–8** (about 25 each): fill one or two collections per batch until each has its 20. A card that needs a new kind of effect gets its handler with it.

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

With 200 items, a run can't offer every page. **Built as below** (`config.scrapbook.pages`; still open to change, and if it changes, card strength is adjusted rather than the designs):

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

Every card in `src/content/items.json` has these fields. Every text and art field has 3 entries: **Prototype** (Tin–Copper), **Fine** (Brass, Silver) and **Masterwork** (Gold, Platinum).

| Field | What it holds |
|---|---|
| `id`, `name` | snake_case id; the card name. Both unique. |
| `batch` | Which batch it was designed in. |
| `collection`, `rarity`, `role` | From sections 2 and 3. |
| `object` | What the object is, in one line. Feeds the art. |
| `passive` | `text` per tier, and `effects`. Always on once the item is alive. |
| `gadget` | `name`, `usedIn` (places, section 7), `target`, base `charges`, `rechargeName`, `rechargeCost`, `text` per tier, `effects`. Optional `when` (conditions, section 9) and `usedInByTier` (when a later tier can use it somewhere new). `null` for a fixture. |
| `rules` | Edge cases and rulings, one per line. |
| `art` | One line per drawing tier, from scrappy to masterwork. |
| `battle` | The 8 original items only: their card for the older card-battle style. |

## 6. Growth: how items get better

Growth is tied to things players can see (this replaced fractional `perGrade` steps, which made Stop Time reach 2 turns at Silver while its text said Gold):

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

Gadgets work in six places. `USE_GADGET` takes what the gadget is aimed at (an opponent, cards, an option, parcels, pages and a stage), and the engine works out the place from where you are:

| Place | When | Example |
|---|---|---|
| `duel` | Any time on your turn in a duel | Stop Time |
| `duelResult` | On the result screen after a duel, before it's cleared | Weigh In (Masterwork), after you've lost |
| `lot` | On a lot ahead on the map, or on the pick screen of a lot you've won | Spyglass, Prise Open |
| `map` | On the map, between stops | Reroute, Align the Planets |
| `shop` | During a shop visit | Haggle |
| `scrapbook` | When the scrapbook is open outside a duel, including while sorting pieces | Stitch, Darn |

Each effect handler lists the places it works in (`places`, default duels); a gadget used somewhere runs only the effects that work there, so the Magnifier's Spyglass reveals hands in a duel and checks a parcel on a lot.

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

Every effect the cards use has a handler in `src/engine/effects.ts` (`defaultEffects`, grouped by what it touches). Handlers only see plain values: `src/engine/items.ts` resolves tier params, counts (`{ "perOwned": "clockwork" }`) and conditions first.

**Hooks** (when passives fire), named by the effect's `hook` param where a handler has more than one: `onRoundStart` (hands dealt), `onTurnStart` (your turn begins; `duel.turn` is its number), `onDuelDraw` (you drew from your pile), `onOpponentTake` (an opponent took from the discard pile), `onOpponentSkipped`, `onOpponentNearOut` (first time each opponent is 1 card away), `onOpponentWouldGoOut` (return true to stop it), `onBuild` (you went out; runs before the payout), `onRoundEnd` (the duel ended). Some passives are static bonuses read where they apply (`appraiseDiscount`, `shopExtraTools`, `sellBonus`, `chargeBonus`, `rechargeDiscount`, `restRecharges`, `doublePieces`, `twistResist`, `spareLife`, `keepStake`, `lotInsight`, `revealBossTwists`).

**Conditions** (`when`), on any effect or gadget, each a tier param if needed (`null` = no condition): `kind` (battle, elite, boss), `greedyOpponent`, `minOpponents`, `act`, `won`. A called-off duel is neither won nor lost.

**Duel choices.** A gadget or passive that shows you cards first opens `duel.choice` (`pick`, `order` or `confirm`); nothing else happens until `DUEL_CHOOSE` answers it, and the effect's `onChoice` carries on. A choice can give the charge back (Swap Boards, put back).

**Round rules** items add (`RoundRules`): `wrapRuns`, `adaptorBoth`, `adaptorShift`, `seeOwnTop`, `seeDiscard`, `protectDiscardTurns`, `stakeGrace`, `seeOpponentProgress`, `freeDiscardDraws`, `takeAnyDiscard`, `extraDiscards`, `opponentDiscardDraw`, `opponentHandSize`. Duel-long state from gadgets (locks, traps, insurance, set-aside cards, changed parts) is in `duel.fx`.

New single-card effects are named after what they do (`discardTrap`, `swapHands`, `movePieces` and so on).

## 10. Adding a card

1. Add it to `src/content/items.json`, following section 5. Reuse an existing effect where one fits; otherwise add a handler to `effects.ts` (with `places` if its gadget works outside duels).
2. Run `npm run portfolio`. It fails on broken rules (missing tiers, wrong charge or recharge range, duplicate names, too many cards of a rarity in a collection, an effect with no handler or one that works in none of the gadget's places) and shows the gaps.
3. Add a test to `tests/cards.test.ts`, and run `npm run test:fuzz`, which tries every gadget at every tier with generic picks through whole runs.

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

Batch 1 cards in these collections are unchanged. The two rulings marked "to confirm" were built as the cards suggested: under the Locked Skip twist, the Fire Poker still reaches into the pile but the Horseshoe Magnet's Pull doesn't; and a smothered boss duel is called off, you step back and try the boss again, with no life lost.

## 13. Open questions

- **Cards to look at first,** found while building them:
  - **Warming Pan:** hand size only matters when hands are dealt, so "+1 hand size for the rest of the duel" does nothing beyond the cards it draws.
  - **Smoke Jack:** its extra pieces are now pieces of the stake material added to what you open from the lot (the text was changed to say so).
  - **Stockpot:** now says "minions", like the Music Box rule it shares.
  - **Perpetual Calendar:** moves pieces from one page to one other (the same as Stitch), and like Stitch only off an unfinished stage, so no item loses a grade. Its ruling said otherwise.
  - **Crowbar (Fine):** shows every parcel's metal when you use it, on the pick screen, rather than after opening your picks.
- **Pages in a run** (section 4): built as above. Confirm or change it; batch 3 onwards are written against whatever stands.
- **Set bonuses:** 3 and 5 items are guesses. With 12 pages they're reachable but take commitment.
- **Fixtures:** are 2 per collection (20 in all) the right number?
- **Balance:** the bot doesn't use gadgets well, so the sim will undervalue gadget-heavy items. A better bot is needed before tuning.

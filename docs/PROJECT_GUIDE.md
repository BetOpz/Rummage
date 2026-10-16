# Rummage: project guide

A handover document: how to run the project, what the game is, what has been built so far, where it is heading, and what to do next.

- **Repository:** https://github.com/BetOpz/Rummage
- **Branch with all the work:** `claude/rummy-deckbuilder-framework-09wvbu` (not merged into `main` yet)
- **Playable online build:** https://claude.ai/artifact/1tBUx4WtsxAzTCeFCq6shY (private to the owner; build 22 at the time of writing)

---

## 1. Getting it running (Cursor or any editor)

You need **Node 20 or newer** (developed on Node 22) and Git.

**First time, in a new folder:**

```bash
git clone https://github.com/BetOpz/Rummage.git
cd Rummage
git checkout claude/rummy-deckbuilder-framework-09wvbu
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

**If you already have the repo cloned:**

```bash
git fetch origin
git checkout claude/rummy-deckbuilder-framework-09wvbu
git pull
npm install
```

In Cursor you can also click the branch name in the bottom-left corner and pick `origin/claude/rummy-deckbuilder-framework-09wvbu`.

### Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Play the game in the browser; it reloads as you edit. |
| `npm test` | Run the test suite (188 tests). |
| `npm run typecheck` | Check the TypeScript types. |
| `npm run sim` | The bot plays 200 seeded runs and reports the win rate and items finished. Use it after changing numbers. `npm run sim -- 100 '{"lives":3}'` runs 100 with a config override. |
| `npm run build` | Production build into `dist/`. |

**Saves** live in each browser's local storage, so a run started in the online build won't appear locally. "Export save" / "Import save" work when running locally (the online viewer blocks downloads). Saves from older builds are rejected with a notice, because the rules changed.

### Where things live

```
src/
  config.ts            All tunable numbers (stage sizes, prices, hand sizes, map shape...)
  content/*.json       All game data: materials, lots, check cards, items, minions, targets...
  engine/              The rules. Pure TypeScript, no UI.
    game.ts            The reducer: every action goes through here
    duel.ts            Rummy duels against minions
    scrapbook.ts       Lots, parcels, checks, matched stakes, scrapbook pages
    melds.ts           Set/run validation and build finding
    hints.ts           "What do I still need" hints
    quality.ts         Materials, grades, gadget charges
    map.ts             Act map generation
    effects.ts         Effect handlers that content JSON refers to
    bot.ts             Heuristic bot (tests + balance sim)
    session.ts         Save/load and replay
  ui/                  React screens (MapView, DuelView, LotView, ScrapbookView...)
  ui/styles.css        The whole visual style (tokens for light and dark)
tests/                 Vitest tests
scripts/simulate.ts    Balance simulation
README.md              Technical reference: engine concepts and how to add content
docs/PROJECT_GUIDE.md  This file
```

---

## 2. The game in one paragraph

**Rummage** is a rummy-meets-roguelike collecting game with a scrappy steampunk look. You travel a branching map of stops. At each fight stop you play a quick race of rummy against minions for a **lot**: a box of wrapped parcels such as a shoebox, a tea chest or a barn find. Everyone stakes the same parts to play. Win, and you pick parcels from the lot. You can spend **check cards** (Calipers, Scratch Tests, Unwrap) to learn what's in a parcel before you choose. The parts you find go into a Victorian **scrapbook**: every item (Pocket Watch, Music Box, Magnifier...) has a page with a stage per material, from scrappy Tin up to Platinum. Fill a stage and the item comes to life at that grade, giving you a passive bonus and a **gadget** you can use in duels, like stopping time so an opponent misses a turn. Beat the boss of each act to move on. Three acts win the run.

---

## 3. What has been built

### 3.1 The run

- **3 acts.** Each act is a map of 8 rows × 3 lanes ending in a boss.
- **Stops:** Battle (duel), Elite (tougher duel), Boss, Shop, Rest, Appraiser. Each node links to its own lane in the next row and sometimes diagonally.
- **2 lives.** Losing a boss duel costs a life and you can try the boss again. Losing every life ends the run.
- **Credits** come from winning duels and selling parts. They're spent in shops, on recharging gadgets and at the Appraiser.

### 3.2 Duels (the rummy)

- You and 1–2 minions (or an elite or boss) race to complete a small target, for example **a set of 3 and a run of 3**.
- **Set:** same number, any material. **Run:** one material, numbers in a row. The UI labels every requirement SET or RUN, with example cards, because rummy players otherwise assume any mix counts.
- Melds may be bigger than asked; four 2s complete a set of 3.
- Hand size 7–10 by act, 12 draws. You draw from your own parts deck; the discard pile is shared. The first to go out wins. If draws run out, the closest hand wins and ties go to the minions.
- **You build by tapping cards.** The game sorts them into melds and shows what's missing ("Find a way out" can do it for you).
- **Minions** (9): Rust Rat, Iron Golem, Magpie, Tin Beetle, Junk Golem, Steam Hound, and the bosses The Foreman, Boiler Titan and Clockwork King. Each has its own deck, and some are greedy and grab discards.
- **Boss twists** (5 hazards such as Purist Inspector, which bans wild cards) change a boss duel's rules. The hazard and the cards it blocks are explained on screen.

### 3.3 Matched stakes

- Everyone at the table stakes the **same thing**, for example 2 Copper parts, and you must match it with that material **or better**.
- The stake material rises with the act and is capped at Copper, so a starting deck can always pay.
- If you can't match it you can **walk past** the lot. The boss can't be walked past; if you're short, it takes any parts.
- Win and you keep every stake on the table. Lose and your stake is gone for good.

### 3.4 Lots and parcels

- Each fight stop shows its lot: **how many parcels it holds and how many the winner picks.**

| Lot | Parcels | Winner picks | Where |
|---|---|---|---|
| Shoebox | 3–4 | 2 | Early battles |
| Tea Chest | 4–6 | 3 | Battles |
| Loft Box | 5–7 | 3 | Act 2+, battles and elites |
| Workshop Clearance | 5–7 | 4 | Elites |
| Barn Find | 7–10 | 5 | Rare, battles and elites |
| Estate Sale | 8–10 | 5 | Bosses |

- Every parcel starts **wrapped**. After a win you choose your parcels and the rest go back to the seller. Once you open yours, the game shows what you left behind.
- Contents are rolled when the map is made (fixed by the seed), so revealing information never rerolls anything.

### 3.5 Check cards (finding out what's in a parcel)

You hold check cards and spend them on a parcel, either in a lot ahead on the map or on the pick screen after a win.

| Card | Certain about | Leaves for the other | Shop price |
|---|---|---|---|
| Calipers | the number | 1 of 4 metals | 2 |
| Vernier Calipers | the number | 1 of 3 metals | 3 |
| Micrometer | the number | 1 of 2 metals | 4 |
| Scratch Test | the metal | 1 of 4 numbers | 2 |
| Acid Test | the metal | 1 of 3 numbers | 3 |
| Assay | the metal | 1 of 2 numbers | 4 |
| Unwrap | everything | exact | 5 |

- **The real piece is always in the list**, and each option is an equal share.
- Each parcel's look-alikes are fixed when the lot is made, so a sharper check narrows the same list and checks never contradict each other. A number check plus a metal check pins a parcel down exactly.
- You start with 2 Calipers, 2 Scratch Tests and 1 Unwrap. Shops sell more.
- **Appraiser** stops unwrap any parcel in a lot ahead for 3 credits.
- The **Magnifier** item sharpens every check by one (never below 2), and its Spyglass gadget is a reusable metal check that gets sharper with grade (exact at Gold).

### 3.6 Materials and grades

One material per grade, from scrap to treasure:

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|
| Tin | Wood | Iron | Copper | Brass | Silver | Gold | Platinum |

- Starting decks are Tin to Copper (2 copies of numbers 1–8 in each, plus a Duct Tape: 65 cards).
- Brass and above are rarer finds, coming from lots and shops.
- Gems (Ruby Bearing, Diamond Movement) are wild special cards.

### 3.7 The scrapbook

- Every item has a page with **8 stages, one per material**. Stage sizes are Tin 3, Wood 4, Iron 5, Copper 6, Brass 7, Silver 8, Gold 10, Platinum 12 pieces.
- A part fills the stage of its own material, or the best lower stage still open.
- **Fill a stage and the item comes to life at that grade.** If you already have it, it rises to that grade and is fully recharged.
- After a win you sort each opened piece: onto a page, into your deck (to play with in duels), or sell it. Sensible destinations are suggested.
- Open the book any time with the **Scrapbook** button.

### 3.8 Items and gadgets

Items give a passive bonus (like Balatro jokers) and a gadget you trigger in duels. **Gadget charges don't refill between fights.** Recharging costs credits on the map or in a shop; a rest stop recharges one for free. Higher grades give more charges and stronger effects.

| Item | Passive | Gadget |
|---|---|---|
| Workbench | +1 hand size | none |
| Pocket Watch | +2 draws | **Stop Time:** an opponent misses a turn (2 at Gold+) |
| Glue Pot | Free temporary Duct Tape each duel | **Quick Patch:** add a temporary Duct Tape |
| Coin Press | +2 credits after each duel | **Raise the Stakes:** every opponent adds another card to the pot |
| Magnifier | Checks leave one fewer option | **Spyglass:** see opponents' hands, or check a parcel's metal |
| Sorting Tray | +1 hand size, +1 draw | **Rummage:** +3 draws this fight |
| Salvage Rig | +1 credit when you go out | **Snatch:** take a random card from an opponent |
| Spare Reel | Free temporary Adaptor each duel | **Cast Line:** draw 2 extra cards |

### 3.9 Look and feel

"Scrapyard tinkerer" steampunk, not polished Victorian brass:

- riveted zinc panels and a stencil display font
- parts as stamped metal or wood tags, with a wood grain and metal sheen
- special cards as scraps with masking tape and marker writing
- parcels as brown-paper packages tied with string
- scrapbook pages on aged paper
- hazards in yellow-and-black tape
- gadget charges as indicator lamps

Light and dark themes, and it works at phone width.

### 3.10 Engineering foundations

- **Pure rules engine:** `reduce(state, action) → newState`. All randomness comes from a seeded RNG stored in the state, so a seed reproduces a whole run.
- **Everything is plain JSON:** game state and actions. Saves are an action log that is replayed and verified on load. This is also what makes multiplayer possible later.
- **Data-driven content:** new lots, check cards, items, minions, targets and materials are JSON edits. New behaviour is an effect handler in `effects.ts` referenced from JSON.
- **Bot and balance sim** (`npm run sim`) for quick balance checks.
- **188 tests** covering melds, duels, stakes, parcels, checks, the scrapbook, the appraiser, saves and full bot runs.

### 3.11 Older modes still in the code

These earlier designs are still selectable in `config.ts`, but they are not the direction:

- `itemSource: 'workshop'`: workshop stops where a longer rummy round builds a **blueprint** into an item, with grade from the average material used and an upgrade bench.
- `battleStyle: 'cards'`: energy-and-block card battles instead of rummy duels.
- `runStructure: 'workshopOnly'`: the original linear run of rummy rounds.

---

## 4. How the design got here (and why)

1. **Started** as a rummy "building" game: complete blueprints with sets and runs to make items.
2. **Added a second layer**: a map with fights, where built items act like Balatro jokers.
3. **Fights became rummy duels** against minions for a pot of staked parts. That kept rummy as the heart of the game rather than bolting on a separate combat system.
4. **Gadgets with charges** that persist between fights create the "use it now or save it for the boss" tension. Recharging costs credits.
5. **Materials and grades** were added: a gold pocket watch is better than a tin one. They were then locked to one material per grade, from Tin to Platinum.
6. **The scrapbook replaced workshops.** You collect pieces for pages rather than building blueprints, giving a visible scrap-to-masterpiece arc.
7. **Lots replaced pots.** At first, how deep you dug into a won box depended on how well you went out. Playtesting showed that was mostly luck, so it became **fixed picks from wrapped parcels plus check cards**, which moves the skill into choosing.
8. **Matched stakes** ensure everyone risks the same thing.

Recurring principles from playtesting:

- **Be explicit.** Spell out set vs run, limits ("numbers 5 or less only"), hazards, and why a card doesn't count.
- **Reward decisions, not luck.**
- **Information must be honest.** Odds shown are true odds, and the truth is always in the list.

---

## 5. Direction

- **Identity:** a rummy collecting game in a scrappy steampunk world. You rummage through boxes of junk and turn it into beautiful Victorian craftsmanship.
- **The arc:** every item evolves from a taped-together Tin prototype to an intricate Platinum masterwork. The scrapbook is the trophy cabinet that shows that journey.
- **The skill:** reading duels (when to go out, when to use a gadget), choosing routes and lots, spending checks wisely, and deciding where each piece goes (pages, deck or credits).
- **Art direction:**
  - Item cards are the showpiece: engraved, patent-drawing-style illustrations.
  - Three drawings per item (prototype, fine, masterwork), with material tints for the stages in between.
  - Parts stay graphic so their numbers stay readable.
  - The frame is the grade, from taped tin to gilt filigree. The full plan is in **[CARD_DESIGN.md](CARD_DESIGN.md)**.

---

## 6. Logical next steps

Roughly in priority order.

### 6.1 Play and tune (now)

- **Playtest a few full runs** and note what feels slow, unclear or too easy.
- **Balance numbers**, all in `config.ts` / `content/*.json`: picks per lot, scrapbook stage sizes, check-card prices and starting checks, appraiser price, stake sizes, credit rewards. The current sim gives about a 42% win rate and roughly 1.5 items finished per run.
- **Make the bot pick for its pages.** It currently picks the highest-grade parcels, which spreads pieces across many stages. A smarter bot would make the sim numbers reflect real play better.

### 6.2 Tidy up decisions already implied

- **Upgrade bench:** shops and rests still show the old "upgrade with 3 parts" bench, which overlaps with the scrapbook. Remove it in scrapbook runs, or repurpose it, for example spending credits to move pieces between pages.
- **Item wording:** some passives still say "each round or duel" because they also serve the old workshop mode. Once the old modes are dropped, simplify the text.
- **Decide whether to delete the old modes** (workshop blueprints, card battles, workshop-only). It would remove a lot of code and UI (`BlueprintPanel`, `RoundView`, `BattleView`, and others), but they're harmless for now.
- **Merge into `main`** with a pull request once you're happy.

### 6.3 Gameplay features that fit the direction

- **Complications:** each item gains a new ability at higher stages, not just more charges. For example, the Pocket Watch adds a stopwatch at Fine and a repeater at Masterwork. This makes upgrading a real choice.
- **Parcels can contain check cards** or other small treasures, not just parts.
- **Event / luck stops** on the map: a car-boot sale, a house clearance, a pawnbroker, a rival collector.
- **More content:** more items (each needs a page and a gadget), minions with personalities that affect which lots they guard, and more duel targets.
- **Smarter minions:** for example, the Magpie always heads for the shiniest lot, which is a hint.

### 6.4 Longer term

- **A scrapbook that carries over between runs:** pages persist, and finished items join your starting kit or unlock for future runs. This is where the original "Tin needs 20 pieces, Gold needs 100" scale fits.
- **Item art pipeline:** three engraved drawings per item, with tinting and gem overlays by grade, shown on cards and scrapbook pages.
- **Sound and juice:** parcel unwrapping, the scrapbook stamping a finished stage, gadget sound effects.
- **Multiplayer:** the engine already uses a serialisable action stream, so head-to-head duels or a shared map are possible later.
- **Mobile polish / app packaging.**

---

## 7. Tuning cheat sheet

| What | Where |
|---|---|
| Pieces per scrapbook stage | `config.ts` → `scrapbook.piecesByGrade` |
| Starting check cards | `config.ts` → `scrapbook.startingTools` |
| Appraiser price | `config.ts` → `scrapbook.appraiseCost` |
| Check cards in shops | `config.ts` → `scrapbook.shopToolSlots`; prices in `content/tools.json` |
| Lot sizes, picks, material odds, rare/gem chance | `content/lots.json` |
| Hand size, draws, minions per duel, credit rewards | `config.ts` → `duel` |
| Map size and stop mix | `config.ts` → `map` |
| Lives, starting credits, starting deck | `config.ts` top level |
| Gadget charges and recharge costs | `content/items.json` → `gadget` |
| Material rarity | `content/categories.json` → `rare`, `weight` |

After changing numbers, run `npm test` and `npm run sim`.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Set** | Cards with the same number, any material. |
| **Run** | Cards of one material with numbers in a row. |
| **Duel** | A rummy race against minions for a lot. |
| **Stake** | The parts everyone puts in to play a duel. Matched: same material and count. |
| **Lot** | The box of parcels a duel is fought over. |
| **Parcel** | One wrapped piece in a lot. |
| **Check card** | Calipers, Scratch Test, Unwrap and the like: reveals what's in a parcel. |
| **Scrapbook** | Pages, one per item, with a stage per material. |
| **Stage** | One material's section of a page. Filling it brings the item to life at that grade. |
| **Grade** | Material level from 1 (Tin) to 8 (Platinum). |
| **Gadget** | An item's ability used in duels, with charges that don't refill between fights. |
| **Twist / hazard** | A boss rule change, such as no wild cards. |

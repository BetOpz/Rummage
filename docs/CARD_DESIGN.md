# Rummage: item card design

How item cards will be designed. This is a plan, not a spec: the next step is to build a portfolio of cards (items, passives and gadgets) and design them once that set exists.

---

## 1. The idea: the frame is the grade

An item card shows the item at its current grade, Tin to Platinum. The frame is made of that material, so you can read the grade at a glance from across the table, and the ornate frames are something you earn rather than the default.

| Grade | Frame | Name plate |
|---|---|---|
| 1 Tin | Dented tin, soldered seams, masking-tape repairs | Marker on masking tape |
| 2 Wood | Offcut planks, nailed at the corners | Marker on masking tape |
| 3 Iron | Riveted plate with rust bloom | Stamped plate |
| 4 Copper | Riveted copper going green at the edges | Stamped plate |
| 5 Brass | Brushed brass, corner brackets | Stamped plate |
| 6 Silver | Polished silver, engraved double rule | Engraved |
| 7 Gold | Gilt, with filigree corners | Engraved |
| 8 Platinum | Platinum filigree with a set gem | Engraved |

The progression should run from scrapyard (taped, nailed, riveted) to Victorian craftsmanship (engraved, gilt), matching the game's arc from Tin prototype to Platinum masterwork. Low grades should look scrappy on purpose, not cheap.

## 2. The drawing

- **Three drawings per item**, in an engraved, patent-drawing style (line work, hatching, dimension marks, lettered callouts, "Fig. 1."):
  - **Prototype** (Tin to Copper): taped together, bent parts, missing pieces.
  - **Fine** (Brass, Silver): complete and working, with an extra feature (for the Pocket Watch, a seconds dial).
  - **Masterwork** (Gold, Platinum): engraved case, exposed mechanism, a jewel.
- **The material tints the ink**, and a colour wash grows stronger with grade ("faded to full colour"). One drawing covers several grades this way.
- The drawing tiers could line up with the "complications" idea in the project guide (new abilities at higher stages), so the drawing shows what the item gained.

## 3. What the card shows

Only things that exist in the rules:

- item name and current grade
- the passive (e.g. +2 draws each duel)
- the gadget: name, effect at this grade, charges as indicator lamps, recharge name and cost (e.g. Rewind: 5 credits)
- scrapbook progress: the 8 stages, filled up to the current grade

No trading-card extras (costs, power/toughness stats, collector numbers, set names) unless the rules grow them.

A **compact size** (art, name and stage strip, no rules text) is needed for the item tray in duels. The frame has to carry the grade at that size.

## 4. How it will be built

Split the work between images and code:

- **Images for what has to look made.**
  - **8 frame images**, one per material, shared by every item. Made in one batch from one prompt so they read as a set, and cut as 9-slice frames (CSS `border-image`) so they scale to any card size.
  - **3 drawings per item**, on transparent backgrounds, tinted per material in CSS (blend modes / filters).
- **Code for what has to stay correct.** Name, grade, passive, gadget text, charges and stages are rendered live from `items.json` and the engine, so a card can never disagree with the rules.

**Tried and rejected:** drawing the frames with CSS gradients and the art as hand-coded SVG. It worked as a test of the idea but looked flat and templated next to an illustrated card; the materials read as coloured rectangles and the eight grades looked alike.

## 5. Reference: the first prototype card

An illustrated prototype ("The Chronos-Fragment", a pocket watch) set the bar for quality.

- **Keep:** the aged-paper art panel with blueprint dimension lines, the riveted iron in the frame, the clear layout (art, name plate, rules box, footer), and "faded to full colour" as the way an item comes to life.
- **Change:** its gilt Victorian frame becomes the Gold/Platinum frame only; the painted art becomes engraved line work; its rules text (Scrap Cost, Active/Power, Components, collector number) is replaced with the real card contents above.

## 6. Open questions

- Readability at phone width and at compact size: how much rules text fits.
- Whether gems (Ruby Bearing, Diamond Movement) show on the frame once set into an item.
- The Pocket Watch gadget text says Stop Time lasts 2 turns "at Gold grade or better", but the engine (`1 + floor(0.2 × (grade − 1))`) gives 2 turns from Silver. Fix the text or the `perGrade` value before cards show the numbers.

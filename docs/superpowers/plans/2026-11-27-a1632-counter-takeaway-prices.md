# A1632 · Show the Counter takeaway price before taking cash

While you add takeaway dishes, a new dish from a set-menu folder shows the holding menu’s
published à la carte price. Paid extras keep their own rows and count towards Total. Open Pay to see
the box’s exact charge after it groups the dishes. Take cash against that amount.

The watcher cleared the plan at 22:03 CET and corrected the draft price at 22:53 CET on
27 November in Lane E’s questions.md. Reuse the published price from A1515-4 slice 1 (#4528).

## One pull request

- In `apps/till/src/screens/till-counter-screen.ts`, use the same published price as the table for
  a new folder dish through the shared helper in `state/draft-layout.ts`. Pass the number to the
  existing basket and total widgets. Once saved, take the dish’s recorded price and group from the box.
- Keep the existing Pay window available to a takeaway containing folder dishes. In
  `apps/till/src/till-app.ts`, keep the grouping with the order read after a parked basket changes.
  Pay uses the existing saved balance. Reuse the same server pricing and settlement as before.
- Update the Counter paragraph in the English and Spanish **Set menus** guides. Check the backlog
  for an entry about this mismatch.

## Test first

1. In `apps/till/src/till-app-set-menus.test.ts`, the Chromium Counter draws a €24 dish and its €2
   extra, with €26 in Total. Pay shows €21 after grouping, with €5 on the saved dish. Enter that
   €21 in cash through Pay. Cover a fresh basket and an edit
   of a parked basket whose existing ungrouped dish shows its saved price.
2. In `apps/server/src/till-api.set-menus.test.ts`, the real pay route groups those prices under a
   €14 set menu, with the €5 supplement and €2 extra, and takes exactly €21 with zero change.
3. Run both files and the guide checks. Open the Counter at phone and till widths in both themes
   and languages. Run the normal push gate and branch review.

Estimate about 90 changed production lines, 110 test lines and one guide sentence per language.

# A1632 · Show the Counter takeaway price at checkout

The Counter tells staff when a takeaway dish and total still need pricing. Opening Pay shows the
box's actual dish charge and total before staff take money. The €5 supplement sits on the dish,
the €2 extra keeps its own row, and the total includes the €14 menu base when that menu is used.

## One pull request

- In `apps/till/src/screens/till-counter-screen.ts`, flag the prices the box has to work out for a
  fresh or edited takeaway with a folder dish or a stored set-menu grouping. Show **Price at
  checkout** on those dish rows and in Total through `widgets/basket.ts` and `widgets/total.ts`.
  Use **Precio al pagar** in Spanish. Extras still show their own prices.
- Keep the existing Counter Pay window available for these baskets, including when the local
  estimate is zero. `till-app.ts` already parks and reloads a fresh basket before opening that
  window. After saving a changed parked basket, reuse its saved-order reload to pick up the new
  grouping before showing the row prices. Take a saved ungrouped dish's price from its stored
  line. Pay reads the stored balance before asking for cash.
- Update the Counter paragraph under **Set menus** in the English and Spanish `table-service.md`
  guides to say where you see the price. A1632 is tracked in the lane queue. Check the backlog
  for a stale entry when the branch is ready.
- The basket shows a pending price before Pay. A numeric preview before Pay needs the watcher's
  decision. This patch needs no new endpoint and uses the current payment and invoice rules.

## Test first

1. Add a Chromium case to `apps/till/src/till-app-set-menus.test.ts` using the existing Counter app
   and billing fixtures. Add a marked €5 folder dish with a €2 extra to a new takeaway. Expect
   pending markers on the dish and Total before Pay. Open Pay, check the saved dish and extra
   show €5 and €2, then type the displayed €21 in cash. Check that the payment records €21 with
   zero change. Keep the existing reopened and placed takeaway coverage. Cover a saved loose
   folder dish at its stored à la carte charge and a changed parked order that needs a new price.
2. In `apps/server/src/till-api.set-menus.test.ts`, use the same amounts against the real pay
   route, with a €24 à la carte price so the €14 menu plus €5 supplement is the cheaper grouping.
   Assert that €21 pays the whole order, with €5 on the dish, €2 for the extra and zero change.
   The browser fixture checks what the cashier sees and sends. The route case checks the charge
   and recorded cash. Watch both new cases fail for their intended reasons before the fix, or
   record the server case as a passing control if the box already charges €21.
3. Run those two files and the guide checks. Open the Counter in English and Spanish, in light
   and dark themes, at phone and till widths. Run the normal push gate and branch reviews.

Estimate about 90 changed production lines, 110 test lines and one guide sentence per language.

# A1632 · Show the Counter takeaway price before Pay

A staff member can add a dish from a set-menu folder, see the box's dish charge and takeaway
bill total, then enter that exact total as cash. The dish shows its supplement when grouped or
its à la carte charge when ungrouped. Paid extras keep their own rows and count once. The total
also includes the set menu's base price.

## One pull request

- In `apps/server/src/bill-payments-api.ts` and a focused Counter quote module, accept the basket
  that Pay would save. Use the existing session, `take-orders`, Counter-zone and bill-edit checks.
  Use `createOpenOrder` for a fresh basket and `saveHeldOrderIn` for an edited parked one, with
  the same offer selection, portions and grouping used when Pay saves. Read the resulting dish
  prices and order total in a savepoint and always roll it back before replying. Skip attendance
  capture, sending and settlement. Check that quoting leaves the order number, order contents
  and revision unchanged. Reuse stored prices for a clean parked or placed bill.
- In `apps/till/src/api/payments-api.ts`, `apps/till/src/till-app.ts` and a small Counter quote
  helper, request a quote only for a fresh or changed Counter takeaway basket with a folder dish
  or a recorded set menu. Use the same wire lines and parked edit revision as Pay. Key the quote
  to the basket and its current visit so an older response cannot replace a newer price.
- In `apps/till/src/screens/till-counter-screen.ts`, `apps/till/src/widgets/basket.ts` and
  `apps/till/src/widgets/tender-pay.ts`, use the same quote for the displayed dish charges, total
  and availability of Pay. While it is missing, show the existing pending-price wording and let
  staff retry a failed quote. Use the existing Counter Pay window, which saves the order and
  reads its balance before asking for cash. Ordinary Counter baskets keep their existing flow.
- Update the English and Spanish **Set menus** guide sections in `apps/server/src/guide/`. A1632
  is currently tracked in Lane E's queue. Check `docs/backlog.md` and its menu detail for a stale
  entry before opening the PR. The table's Courses and Bill views, discounts and invoice pricing
  rules are outside this slice. A1515-4's later box preview can reuse the Counter quote work.

## Test first

1. Add a case to `apps/till/src/till-app-set-menus.test.ts` that adds a folder dish with a €5
   supplement and €2 extra to a takeaway from the menu. Give the only eligible set menu a €14
   base. Expect a €5 dish, €2 extra and €21 total. Open Pay, enter the displayed €21 as cash and
   assert the payment request and receipt show €21 paid with zero change. Watch the price
   assertions fail on the old till. Use the existing Counter app and Pay fixtures.
2. In `apps/server/src/till-api.set-menus.test.ts`, quote the same basket before and after parking
   and adding an extra. Compare each result to a real Pay with that exact cash, assert zero change
   and check that the quote did not leave any order or edit behind. Run the route test first and
   observe it fail before wiring the quote. In the browser case, hold one quote reply until a
   later edit has been priced and assert that the old total never comes back.
3. Run `pnpm --filter @waitron/till exec vitest run src/till-app-set-menus.test.ts` and
   `pnpm --filter @waitron/server exec vitest run src/till-api.set-menus.test.ts` plus the route
   access and guide guards. Check the corrected row and total in both languages and themes at
   phone and till widths. Run the normal push gate and the payment contract's two Claude reviews.

Estimate about 240 changed production lines, 125 test lines and a short guide edit in each language.

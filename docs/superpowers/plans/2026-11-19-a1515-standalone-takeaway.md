# Order set menus at the Counter for takeaway

PR 13 of [A1515 ordering](2026-11-18-a1515-set-menu-ordering.md). The
[set-menu design §5](../specs/2026-11-17-set-menus-design.md) says takeaway orders can hold a
set menu even when they start at the counter. Lane F's watcher moved this work from PR 12 on
19 November 2026 at 21:48 in questions.md. Claude reviewed the draft, and the watcher cleared
the plan with five changes at 22:24. PR 12's table controls are the prerequisite.

Staff can start a takeaway using only a set menu, add its dishes, and reopen it from Parked
orders. After a republish, they still order on that bill from the copy it first used. An eat-in
Counter order has no set-menu controls. Set-menu payment, comps, discounts and fiscal output
stay with piece 4. No new table, endpoint or feature switch.

## First count and reread

- The first **+** or **Add a set menu** saves on the tap so the existing count routes and Hold
  flow act on an existing order. In `till-app.ts` and `api/client.ts`, send the Counter park
  request with `firstSetMenuId` and the shown `zoneId`. Adopt its saved identity, revision and
  menu state without clearing the basket or saving any unsent dishes. Those go to the server
  at Hold or Save. Later count and move replies also update the basket's saved revision.
  Hold in `widgets/tender-pay.ts` works on a set-menu-only bill and still clears the basket.
  Reducing its final count to zero or clearing before adding a dish leaves the saved order
  available in Parked orders. Staff can delete it there using the usual Discard action.
- In `apps/server/src/till-api.ts` and `working-order.ts`, require the zone for this first count.
  Reuse zone, trading and takeaway admission. In the order's write transaction call
  `createOpenOrder`, then `setSetMenuCount` for one. Replaying the same order returns its number
  and adds no second menu. Ordinary requests still refuse an empty basket.
- In the shared open and placed order read, skip set-menu charges when building dish lines.
  Serve the placement state and full copies with the held-order reply via `readBillsSetMenus`.
  Use the recorded offer to restore dish identity, answers and placement. The till adds the
  returned menu prices to its basket display. Parked lists keep their current dish count and
  stored total.
- **Tests first** — In `apps/server/src/till-api.set-menus.test.ts`, show a first count on an
  empty takeaway, then replay it. Assert one menu and one order. Assert the exact refusal and
  no new order for a missing zone and a refusal for eat-in. Republish the menu from €14 to €15,
  reopen with the recorded €14 dishes and check the held bill still totals €14.

## Dishes and the Counter screen

- In `working-order.ts` and `till-api.ts`, the existing Counter update accepts a fresh dish's
  set-menu id, required version and optional reservation on this bill. Validate the shape at
  the boundary. Use the existing recorded pricing and pass fresh placements to
  `placeSetMenuRows` in the current transaction. The existing edit path keeps menu charges.
  Allow a Save with zero dishes while the bill still has a set menu. Ignore menu charges when
  deciding whether a previous dish was sent, so Hold keeps fresh dishes at the counter and
  Place reaches the kitchen as usual. Trying Eat in on a takeaway with a set menu keeps
  Takeaway selected and uses the existing set-menu refusal wording.
- In `screens/till-counter-screen.ts` and `till-app.ts`, reuse PR 12's folders, counts and
  no-place choices on Takeaway and show the copy the bill holds. Keep dirty edits on a refusal
  specific to a dish with no place. Extend both table-service guides with one Counter paragraph.
- **Tests first** — Show a republished takeaway ordering from its original copy, check the
  saved place and surcharge, then Hold and Place. A dish with no place or no version is refused
  and earlier lines keep their places. Saving a set-menu-only bill keeps the charge. In
  `apps/till/src/till-app-set-menus.test.ts`, choose Takeaway, tap + on a clean basket, reopen
  from Hold, and save a dish using the new revision. Check Eat in has no folder and a refused
  Save keeps the draft. Order a dish first, tap +, then Hold and prove the first count leaves
  the dish unsaved until Hold.
- Run the focused server, till and guide-link checks. Rehearse on Lane F's preproduction demo
  with a republish between saves. Estimate 460 production and 480 test lines.

# Till and kitchen backlog repairs

Staff can keep or dismiss Make now through a device recheck, answer a required choice on a recalled
dish off the live menu, and tell two same-numbered kitchen groups apart after a join.
Lane F queue, TILL-KITCHEN-SMALL, 25 November 2026 at 04:47.
Claude reviewed the plan. The watcher cleared two pull requests at 05:55, with kitchen first.

1. **Make now.** Keep the last confirmed device and its visible list in
   `apps/till/src/state/make-now-controller.ts` through a recheck. Persist arrivals and Done on
   that device's existing key. In `apps/till/src/till-app.ts`, hide its list on an explicit switch
   or when the check opens enrolment. Select the new device's own list on confirmation. Chromium
   also reproduced a late reply written into the new device's saved list using the real Till API
   client. In `apps/till/src/api/client.ts`, capture the device when a request starts and route
   the reply to that device. Merge a reply for a hidden device into its own saved list when
   storage is available. In `till-app-boot-and-counter.test.ts`, verify both old and new
   instructions through the check, Done, and a reply from the previous device. Keep the existing
   switch and blocked-storage checks. Test request-start capture in `api/client.test.ts`.
   A reply with no confirmed device has no device list to update.
2. **Recalled dish.** In `apps/server/src/working-order-held-read.ts`, batch the unsent ordinary
   parent products through the Menu package's `readOfferedModifiers` with no offer id. Include
   just options in `product.offeredModifiers` when there are choices. The till already uses the
   live offer when it exists and this product otherwise. In `apps/till/src/till-app.ts`, give the
   reread failure precedence. Put the missing-choice prompt before the extra notice for a withdrawn
   dish. In `apps/till/src/state/working-order.ts`, keep recorded extras in both modifier saves
   when staff first answer a missing fallback choice. Later edits can remove the extras. The probes
   showed both the hidden prompt and the missing extra in the save. The Server test in
   `working-order-held-write.test.ts` verifies the list on recall, that a same-quantity save
   records the answer, and that raising the quantity still fails. Keep the picker test in
   `till-app.test.ts`. Update `docs/developers/modifiers.md`, the products guide and both modifiers
   guides. Capture the recalled picker with a saved extra in both languages, both themes and
   phone and desktop widths. The owner sees the pictures before this pull request lands.
3. **Joined groups.** In `apps/server/src/order-group-records.ts`, read each duplicate number's
   origin names and the saved names of parties merged directly into that origin. Remove the
   joined names from the qualifier. Use the full list when that leaves it empty. Test both bill
   merge directions and a second table join in `order-group-transfer.test.ts`. Keep the existing
   table rename control. A rename after the join can leave a joined table's new name in the
   qualifier because the closed party records its old name. Keep the bill's current table heading.

Two pull requests using this plan. Expect about 100 added production lines and 140 added test
lines for the till work, and 55 production and 85 test lines for kitchen. Update the corresponding
entries in `docs/backlog.md`, `docs/backlog/till.md` and `docs/backlog/kitchen.md`.
Keep Task 6's printer-routing decision.

**Watcher, 06:12 on 25 November.** Keep the kitchen labels and slips as built. The till pull
request covers points 1 and 2 and records that kitchen decision in the backlog.

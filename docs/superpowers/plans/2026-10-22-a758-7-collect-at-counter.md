# A758-7 — "They'll collect it at the counter": implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL.** This slice moves a paid bill out of its party, which the database refuses
today, so it adds a migration that loosens the settled-order freeze trigger by one narrow exception.
It also changes what Finish table does at the end of a party's life, adds a zone check to a till
route, and changes a contract between the server and the till. Each code task gets a per-task
reviewer; the docs task and the LOOK task do not. The plan is reviewed once, against the design, by
a fresh-context reviewer before any implementer starts. `/finish-branch` runs its full wave, with the
Codex run-it seat as two reviews side by side.

Implementers are dispatched as `subagent_type: "implementer"`. An implementer that passes about 150
tool calls with its task unfinished stops at a passing or cleanly failing point, commits, and hands
over: what is done, what is left, the files, and each check's state.

**No task changes `computeHuella`, the chain, invoice numbering, `registros_facturacion`, the alta
builders, or anything `recordSale` reads.** The sale was recorded when the bill was paid; moving the
paid bill afterwards writes `working_orders.party_id` and kitchen-side rows, and no filed record,
`sales`, `sale_lines` or `tenders` row. Task 5 pins that with a before/after comparison of every
one of those tables. **If any test finds a filed record, a `sales`, `sale_lines`, `tenders` or
`sale_receipt_guests` row changed by the move, that is a stop and a report, not a fix.** The trigger
this slice loosens (`working_orders_enforce_transition`) guards bills, not filed records; Decision 2
says why it is not fiscal, and owner point 1 puts it in front of the owner anyway.

**Goal.** In Finish table on a paid table with dishes not served, a third choice, **They'll collect
it at the counter** («Lo recogerán en el mostrador»), fires any held dish, moves every paid bill that
still has food to come to the counter, and finishes the table, in one request. Each moved bill is a
paid counter order with dishes still coming: Find a bill's Bills tab and the counter's Waiting
orders list it as "Paid, not handed over", its dishes stay on the pass and the stations, and they
leave when the order is handed over.

**Spec:** `docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md` — D17 (§1), §3.8
(all of it, item 4 especially, the "Who may" paragraph, and §3.8.1's "Out of scope"), §3.9 (the row
"They'll collect it at the counter"), §9 (the bullet "They'll collect it at the counter is a slice of
its own"), §10 items 5 and 6, §11. Picture 06 in `docs/backlog/mockups/a758-adjustment-reasons/`
(`06-finish-table-asks.png`, also `-dark`). Backlog: `docs/backlog.md` "A758", whose "Left:" is this
slice. The previous slice's plan, `docs/superpowers/plans/2026-10-22-a758-6-unserved-on-paid-table.md`,
built the dialog this slice adds to.

Every `file:line` below was read on 2026-10-22 in this worktree, on `main` `9f4632719` (A758-6,
#1993, is in that history), with `sed -n`/`grep -n`, unless it is marked **(run)**. Each **(run)**
names what was run and what it printed. Runs used Node v26.11.1.

---

## What was measured before writing this plan

**(run) The probe.** A throwaway test, kept at `/tmp/a758-7-probe/a758-7-probe.test.ts` (outside the
repository; copied into `apps/server/src` to run with
`env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/a758-7-probe.test.ts`
and deleted after; `git status --short` then printed nothing). It used `setupPartyVenue` and
`placeGroups` as `apps/server/src/pass-lifetime.test.ts` does: a table of 4 guests, one Burger
fired and made ready, the bill paid €12.00 (a simplified sale).

1. **The database refuses a paid bill leaving its party.** `leaveParty(tx, billId)` then
   `update working_orders set party_id = null` on the settled bill failed with "working order cannot
   make that transition" (the stack named the `update`). The refusal is
   `working_orders_enforce_transition`, last re-created by
   `packages/db/drizzle/0143_working_order_receipt_locale_transition.sql`: a settled order may change
   only by the handover stamp, `collected_at` null → set, with `party_id` and every other listed
   column unchanged (`0143…sql`, the `old.status = 'settled'` branch).
2. **With that trigger dropped inside the probe's own database, a paid bill with no party behaves as
   the design says.** Before: the pass screen listed `[1, "Probe table"]`, the monitor 1 order.
   After `party_id = null` and `finishTable` on the party: the pass screen still listed
   `[1, "Probe table"]` and the monitor 1 order. `listCounterWaiting` listed it `status: "settled"`,
   `label: "Probe table"`, `canHandOver: true`. `readFindBills` listed it `state:
   "paid-not-handed-over"`, `label: "Probe table"`, `tables: []`, `zone: "Test tables"` (the table's
   zone). After `handOverOrder`: the pass screen `[]`, the monitor 0. **The control in the other
   direction** is the existing case `pass-lifetime.test.ts:206-220` "removes unserved ready food
   when the paid party finishes": the same paid dish, the party finished without moving the bill,
   and the boards are empty. `pnpm --filter @waitron/server exec vitest run src/pass-lifetime.test.ts
   -t "removes unserved ready food"` printed `Tests 1 passed | 12 skipped (13)`.
3. **The receipt.** `readReceiptOrder` answered `{ orderLabel: "Probe table", orderNumber: 1 }` before
   and after, and `readPrintedGuests` 4 before and after (a simplified sale's stored count).
   `readReceiptGuests` — what a full invoice prints from (`apps/server/src/invoice-document.ts:120`;
   `readPrintedGuests` falls back to it for a full invoice, `apps/server/src/receipt-guests.ts:57-75`)
   — answered 4 before and nothing after. Decision 10.
4. **Held work refuses to leave its party.** A second case: one Burger placed `release: "hold"`, the
   bill paid (its status read `settled`), then `leaveParty` refused `group.held_leaves_party`
   (`refuseHeldLeavingParty`, `apps/server/src/working-order.ts:4566-4583`). Decision 4.

The probe's two cases ended red after printing, because `useVenueDb`'s reset could not drop the
trigger the probe had already dropped (`no such trigger: working_orders_enforce_transition`); every
line above was printed before that.

**(run) Baselines on `9f4632719`:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
src/write-path.e2e.test.ts src/inmutabilidad.test.ts` printed `Tests 20 passed (20)`;
`pnpm --filter @waitron/db exec vitest run src/schema/orders.transition.test.ts` printed
`Tests 32 passed (32)`; `pnpm exec vitest run scripts/behavioural-triggers.test.ts` printed
`Tests 363 passed (363)`.

---

## Decisions this plan makes that the design does not

The build goes straight on with each default. The owner may override any of them later; each is in
the owner points at the end.

1. **The path: a collect choice inside Finish table, not Move this bill.** Design §3.8 item 4 leaves
   this to the plan and names Move this bill's counter branch as the nearer path. **Default:**
   `POST /api/parties/:id/finish` (`apps/server/src/till-api.ts:2855-2929`) takes a new body field
   `collect`, and `finishPartyService` (`apps/server/src/finish-party-service.ts:58-92`) moves the
   bills and finishes the table in the one transaction the route already opens, as A758-6's
   cancel-and-finish does (CLAUDE.md §3, one `withTransaction` per request). The move is a new
   function beside `moveBill` in `apps/server/src/move-bill.ts` that reuses the counter branch's
   parts — `inheritKitchenNote` (`:251`), `leaveParty` (`:545-581`), `relocateBillEditor` (`:261`),
   `withdrawPendingDepartmentTransfers` (`:319`) and `enqueueMovedSlips` (`:323`) — and leaves out
   the parts a paid bill must not get: a new label (`:257`), zone adoption and the sending it can
   trigger (`:260`, `adoptZone` `:590-615`), and the revision bump (`:256`, Decision 2). **Move this
   bill → The counter keeps refusing a paid bill** `bill.paid` (`moveBillOnce`, `:184`); Task 3 pins
   that it still does. *The other way:* let `moveBill`'s counter branch take a settled bill — two
   requests (move, then finish), so a failure between them leaves a paid bill at the counter and the
   table open.
2. **The database's settled-order freeze gains one exception** (measured, above). **Default:** a new
   core migration re-creates `working_orders_enforce_transition` with every branch of
   `0143_working_order_receipt_locale_transition.sql` unchanged plus one more: `old.status =
   'settled' AND new.status = 'settled' AND old.collected_at IS NULL AND new.collected_at IS NULL
   AND old.party_id IS NOT NULL AND new.party_id IS NULL`, with every other column of the row
   unchanged — **`revision` and `label` included**. So a paid bill can leave its party for the
   counter once, before it is handed over, and nothing else about it can change. A settled bill
   cannot join a party, change party, or leave one after handover. Why this is not a fiscal change:
   the trigger is on `working_orders`, the bill; the sale `recordSale` wrote at payment is in `sales`
   and the filed record in `registros_facturacion`, neither of which the move writes (Task 5
   compares them). The receipt reads an issued sale's label from the bill's frozen `label`
   (`apps/server/src/receipt-order.ts:42-45`), which the exception keeps fixed. **Venue reset:**
   none expected, because the migration drops and re-creates a trigger and rebuilds no table; Task 1
   measures it with `scripts/migration-upgrade.test.ts` and, if that fails, records the failure and
   stops. *The other way:* keep the bill in its closed party and mark it "at the counter" in a new
   table, then teach every counter reader (the pass's `liveKitchenDish`, Waiting orders, Find a
   bill, the MOVED slip's places) to read the mark — no change to the freeze, but a new table and
   several readers to keep in step.
3. **Which bills move.** **Default:** every settled bill of the party's family (`readFamilyBills`
   over `partyFamily`, as `finish` already reads them, `finish-party-service.ts:104-145`) that holds
   at least one dish `finish` lists as not served moves, whole — its served dishes too — each as its
   own counter order under its own number. A bill whose dishes were all served stays with the closed
   party, as today. The bills come from the server's own list, not the till's: the request names
   them only so a change since the dialog opened is refused (Decision 7).
4. **A held dish is fired on the way** (the design's likely answer). Held work cannot leave its party
   (measured, above), and the guests are waiting for it. **Default:** before any bill moves, while the
   party is still open, every held group holding a line of a moving bill is released through the
   same release the table's Fire uses (`releaseGroup`, `apps/server/src/order-groups.ts:692-765`,
   behind `fireGroup` `:414-463`), so the station gets the FIRE slip it gets today and the dishes'
   allergy copies are taken while the bill is still the party's. A group shared by two moving bills
   fires once. A held group with no active line left — every line cancelled with its charge kept —
   cannot be released (`releaseGroup` refuses one, `:722-723`); its lines' group is cleared and the
   group marked removed (`removeEmptiedHeldGroups`, `:1262-1304`), so `leaveParty` does not refuse
   it. A release refused for its own reason (an unanswered allergy question, `allergy.unanswered`,
   `apps/server/src/party-allergy.ts:520-523`; no station, `station.no_default`) refuses the whole
   request and the till shows the refusal in the dialog; nothing is moved or closed.
5. **What the moved order keeps.** Its number, its `label` — the party's name and tables frozen onto
   it at payment (`apps/server/src/bill-payments.ts:768-771`, `apps/server/src/till-sale.ts:1030-1036`)
   — so Waiting orders, Find a bill and the pass name it "#12 Mesa 4" (measured, above); its zone
   (no `retargetOrderContext`), so the sale's zone is the one it was sold in and Find a bill shows the
   table's zone (measured); and its revision (Decision 2). It takes a copy of the finishing party's
   kitchen note (`inheritKitchenNote(…, { partyId }, { workingOrderId }, "copy")`, as the counter
   branch does at `move-bill.ts:251`), from the party being finished, because merging parties
   combines their notes into the survivor (`apps/server/src/table-actions.ts:294`).
6. **What the kitchen is told.** FIRE slips for the held work (Decision 4), then, per station with
   work on a moved bill, the MOVED slip that Move this bill → The counter prints today ("To:
   (counter)", «A: (mostrador)», `apps/server/src/kitchen-ticket.ts:526-537`) and the station notice
   "Moved to the counter" («Pasado al mostrador», `apps/till/src/widgets/station-queue.ts:805-810`),
   both from `enqueueMovedSlips` (`apps/server/src/kitchen-print.ts:1229-1243`; the counter place is
   `apps/server/src/order-places.ts:116-117`). Nothing is reprinted otherwise. `before` is read after
   the fire and before the party changes, so the slip lists the just-fired work.
7. **The request.** `collect: { bills: [{ billId, expectedBillRevision }] }` — the distinct bills of
   the dialog's dishes with the revision each was read at (`UnservedDish.billRevision`) — with a
   `submissionId` (required, as for cancellations), never with `cancellations` or `approver`
   (`management.request_invalid` naming `collect` or `approver`). The server compares it, by value
   and in any order, with the bills its own list gives (Decision 3); a difference, or no unserved
   dish at all, refuses `party.unserved_dishes` with today's dish list, exactly as the cancel path
   refuses a changed dish set (`finish-party-service.ts:146-162`), so the till's existing re-read
   handles it. **No new error code.** No reason, no PIN and no `adjustments` row: nothing is
   cancelled. The answer stays `{ state: "closed" }`.
8. **Who may.** The route's checks stay: a session, `take-orders` on the device's profile, the
   person admitted to the profile, and the party's zone (`till-api.ts:2857`, `:2888-2897`). The route
   also checks **the zone of each bill the collection names** (`{ orderId }` subjects to
   `checkZones`, `apps/server/src/zone-access.ts:84-91`), because a bill of a party merged in from
   another zone keeps that zone once paid (`takeIntoParty` adopts a zone only for an open or
   presented bill, `move-bill.ts:533-535`) and the party's zone is its table's only
   (`partySubjectZones`, `zone-access.ts:40-62`). No person permission is added: nothing is refunded.
   Handing the order over later needs `hand-over-orders` (`till-api.ts:2279-2281`), as for any counter
   order.
9. **The till.** The third button, `data-collect`, goes in `wt-form-actions`' `secondary` slot
   (design-system.md → Forms: "A secondary action that belongs beside the primary action goes in the
   `secondary` slot"), variant `secondary`, label `finish_table.collect` — "They'll collect it at the
   counter" / «Lo recogerán en el mostrador» (§3.9). It needs no reason and no answers, so it is
   enabled whenever the dialog is not busy; it emits `finish-table-collect` (`bubbles`,
   `composed`). Picture 06 draws it full width on a row of its own; where it lands at 1280 and 390
   px is the LOOK's (Task 9). **After it succeeds** the table leaves the screen as Finish leaves it
   (`#onTableClosed`, `apps/till/src/till-app.ts:15421-15433`), the toast says "Moved to the counter"
   («Pasado al mostrador») — the existing `station.notice.moved_to_counter`
   (`apps/till/src/i18n/strings.ts:693`, `:2422`), shown through the submitted toast as
   `counter.moved_to_table` is (`till-app.ts:14433-14434`) — and the Waiting orders list re-reads
   (`#refreshAfterWrite("waiting", "refresh.waiting_after_move")`, the existing words "The dishes
   were moved, but the list of waiting orders could not refresh", `strings.ts:1416-1417`). The one
   new string is `finish_table.collect`.
10. **A full invoice's later copies lose the guests line.** A full invoice prints the guests read
    from the bill's party each time (measured, above); once the bill has no party, a later copy
    prints none, and no amount per person. A simplified receipt keeps its stored count. **Default:**
    accept, pinned by a test in Task 5 so the change is seen, and backlog **A1025**. *The other way:*
    store a full invoice's guests too, which changes `recordReceiptGuests`
    (`receipt-guests.ts:41-49`, which skips a full invoice) and its two readers.
11. **The pass and Waiting orders do not say "counter".** A moved order is named by its number and
    the table it was paid at, with no group (measured: `[1, "Probe table"]`), as Move this bill → The
    counter names an order today; the MOVED slip and the station notice are what say "counter".
    **Default:** no change; backlog **A1024**.
12. **A till or pass limited to the counter's zone does not see the moved order**, because the order
    keeps its table's zone (Decision 5): Waiting orders filters by zone (`visibleOrders`,
    `till-api.ts:2274`) and so do pass screens (the zone-scoped reads in
    `pass-lifetime.test.ts:256-276`). A till with that table's zone, or with no zone limit, sees it.
    **Default:** accept; owner point, in A1023.
13. **An unconfirmed send.** A lost answer resends the same command, as Finish does today
    (`#resend`, `till-app.ts:15098-15108`). While an unconfirmed collect waits, the main button is
    disabled and the collect button resends it; while an unconfirmed cancel waits, the collect button
    is disabled. The dialog gets one new property, `collectPending`, for the first half;
    `confirmationLocked` (`finish-table-dialog.ts:83`) already marks the second.
14. **The new exception's cases live in the package's trigger suite**,
    `packages/db/src/schema/orders.transition.test.ts`, which migrates through `useVenueDb` with
    `CORE_MIGRATIONS` (`:38`). `scripts/behavioural-triggers.test.ts` is not edited: the owner's
    2026-10-05 rule counts any change to a guard under `scripts/` as controversial, and its existing
    settled-order cases stay true and green — its "party changes with the stamp" case
    (`:627-638`) changes a settled order with **no** party to one, which the exception does not allow.
    Owner point: the guard does not hold the exception's cases.
15. **A758 is finished.** The docs task deletes the A758 entry from `docs/backlog.md` and its detail
    from `docs/backlog/till.md`, adds the decision in Decision 2 to `docs/backlog/till.md`'s
    "Decisions and deliberate limits", and adds **A1023** (the owner looks at A758-7's choices),
    **A1024** (Decision 11) and **A1025** (Decision 10). The three numbers were taken from
    `~/waitron-campaign-shared/next-item-number` (it read `A1023`; `A1026` was written back).

---

## Where the design drifted (re-read on `9f4632719`)

| The design says | Today |
|---|---|
| §3.8 item 4: `moveBill` at `move-bill.ts:78`, refusing `bill.paid` at `:90` | `moveBill` is at `:135-168`; `bill.paid` at `:184` (and `:106` in the allergy preview) |
| §3.8 item 4: "No path today moves a paid bill there" | True, and more: **the database refuses it** (measured, above). Decision 2 adds the exception, with a migration the design did not expect (§3.8.1 "Order" expects one only for the flags A758-6 added) |
| §3.8 item 4: the dishes leave the pass when collected (`liveKitchenDish`, `working-order.ts:7323-7329`) | `liveKitchenDish` is at `:7781-7798`; since A773-2 (#1944) it keeps a dish only while its order has no party or its party's family is open (`:7787-7797`), which is exactly why the counter keeps it (measured) |
| §3.8 item 4: Find bill's Bills tab keeps a paid counter order until collected (`find-bill-bills.ts:72-73`) | Holds (`:72-73`; measured) |
| §3.8 item 4: Move this bill → The counter at `till-table-order-screen.ts:5128-5137` | The counter target is at `:5160-5169` |
| §3.8 item 4: department transfer refusals at `department-transfers.ts:183-197`, `:394-395`, `:422-423`; `strings.ts:228` | `:185`, `:197-198`, `:396`, `:424`; `department_transfer.no_table` at `strings.ts:287` |
| §3.9: «El mostrador», `table.to_counter`, `strings.ts:2885` | `strings.ts:1446` (English) and `:3153` (Spanish) |
| §3.8 "Who may": a finished party's zone reads as none | A758-6 changed it: a closed party is checked against its family's bills' zones (`partySubjectZones`, `zone-access.ts:40-62`). The collect runs while the party is open, so Decision 8 checks the moving bills' own zones |
| §3.8 item 5 (Table finished on the pass card) | Not built (A758-6's Decision 1); nothing here changes that |
| Picture 06: the third button full width on its own row | Built in the `secondary` slot (Decision 9); the LOOK says where it lands |

## Global constraints

- **Test first.** Each code task starts with failing tests, run with the command given; the
  expected failure is read before any code is written. Read the `Tests` count of every run; a run
  that prints none proved nothing (CLAUDE.md §4). Use `env -u AI_AGENT -u CLAUDECODE` when a
  passing test's console output matters.
- **The fiscal gates run unedited at the end of every code task:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  (20 passed on `9f4632719`, **(run)**) and
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-sales.golden.test.ts`.
- **A database test uses `useVenueDb`** (CLAUDE.md §4). The models are
  `apps/server/src/finish-party-service.test.ts` (the adjustment venue, a paid table bill with held or
  fired dishes, `fixture()` at `:56-85`, `post()` at `:87-94`, `snapshot()` at `:96-121`) and
  `apps/server/src/pass-lifetime.test.ts` (the boards, `boards()` at `:116`, and a ready dish,
  `tableWork()` at `:127`). A rejected write asserts the domain error code, never
  `toBeInstanceOf(Error)`.
- **A test's check changes only where this design changes what it checks** (owner, 2026-10-05).
  Every such change is listed under "Changed test checks" with its line, old and new value and
  design point; a helper or fixture that gains something is under "Fixtures grown". Any other check
  that turns red is a stop and a report.
- **General code is English only** (CLAUDE.md §3). Spanish lives in `apps/till/src/i18n/strings.ts`
  (`es` block) and the Spanish guides.
- **Concise product text.** The one new string is `finish_table.collect`.
- **Forms follow `docs/developers/design-system.md` → Forms.** The dialog keeps its
  `*.unsaved.test.ts` and `*.a11y.test.ts` (both themes).
- **The migration** (CLAUDE.md §3): made with `pnpm --filter @waitron/db db:generate:custom --name
  settled_order_to_counter`, which numbers it and writes its journal entry and snapshot; only the
  SQL file's body is written by hand, as it was for `0143…sql`, this trigger's latest re-creation. **No shipped migration file is edited.** On a rebase that collides with
  another lane's number, regenerate (CLAUDE.md §3), never renumber by hand.
- **Who may is a risk trigger.** Every new check of who may gets a refusing case and a served case.
- **Browser suites** (`apps/till`) run in real headless Chromium. Check `memory_pressure | grep free`
  first; never beside a whole-workspace coverage run.
- **Coverage 98/98/98/95** holds in every package touched. Local runs are focused; CI runs the
  package suites and coverage.
- **Stop only processes you started**, by recorded id. Every commit `git commit -s`, staging named
  paths, never `git add -A`.

### Guard suites, by kind of change (run in the task that makes the change)

- **Migration:** `pnpm exec vitest run scripts/behavioural-triggers.test.ts
  scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts
  scripts/journal-monotonic.test.ts scripts/append-only-triggers.test.ts` (each must pass
  **unedited**), then `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run
  scripts/migration-upgrade.test.ts` (read its printed summary), then
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- **A till route's checks:** `pnpm --filter @waitron/server exec vitest run
  src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts
  src/zone-access.finished-party.test.ts`.
- **A new till string:** `pnpm exec vitest run scripts/native-form-fields.test.ts
  scripts/style-token-names.test.ts scripts/english-only.test.ts` and
  `pnpm --filter @waitron/till exec vitest run src/i18n/strings.test.ts`.
- **A guide:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- **No new error code**, so `scripts/errors-reachable.test.ts`, `scripts/alert-codes.test.ts` and
  `scripts/staff-notice-codes.test.ts` need no new entry; run them once in Task 4 to confirm.

## Review focus

The inputs most likely to break what the design promises, each pinned by a test in the task named:

1. **The freeze stays a freeze.** A settled bill leaving its party with any other column changed
   (`label`, `revision`, `settled_at`, `collected_at`, `status`), a collected bill leaving its party,
   a settled bill joining a party or moving to another, and the handover stamp together with leaving
   are all refused; leaving alone is accepted (Task 1). The handover stamp alone is still accepted
   (the existing case, `orders.transition.test.ts:612`).
2. **Nothing filed changes.** Every `registros_facturacion`, `sales`, `sale_lines`, `tenders` and
   `sale_receipt_guests` row, and the receipt answer for the sale, are deep-equal before and after
   (Task 5). The control: a full invoice's live guests read changes (Decision 10), so the comparison
   can see a change when there is one.
3. **Held work.** A held dish fires before its bill leaves (a FIRE slip where a HOLD ticket was
   printed, `fired_at` set), then the MOVED slip names the counter; a group shared by two moving
   bills fires once; a bill holding a held dish already cancelled with its charge kept, beside a
   fired unserved dish, still moves, its emptied group removed (Tasks 2 and 3).
4. **Which bills.** Two paid bills, one with a dish to come and one all served: only the first moves;
   the second stays with the closed party and is not in Waiting orders (Task 4). A merged-in party's
   paid bill with a dish to come moves too (Task 4).
5. **A race.** A dish served after the dialog read, leaving its bill with nothing to come: the
   request still names that bill, and is refused `party.unserved_dishes` with the new list, nothing
   moved or closed (Task 4).
6. **Replay.** The same request again answers `{ state: "closed" }` and writes nothing more; the same
   `submissionId` with other bills is `submission.id_reused` (Task 4).
7. **The whole way round, over HTTP.** After the collect: the dish is on the pass screen, the pass
   monitor and its station's queue; Waiting orders lists the order `canHandOver`; Find a bill's Bills
   tab lists it "paid-not-handed-over" with the table's zone; `POST /api/orders/:id/collect` hands it
   over and every one of those reads drops it (Task 5).
8. **Zones.** A device limited to the party's zone collecting a merged-in bill from another zone is
   refused 403 `service_zone.not_allowed`, with nothing changed; the same from a device allowed both
   zones, and from one with no zone limit, is served (Task 5).
9. **The till never sends the wrong command.** While an unconfirmed collect waits, the main button
   cannot send a cancel; while an unconfirmed cancel waits, the collect button cannot send (Tasks 6
   and 7).

---

## The files

| File | Tasks |
|---|---|
| `packages/db/drizzle/0185_settled_order_to_counter.sql` (number as generated), `packages/db/drizzle/meta/_journal.json`, `meta/<n>_snapshot.json` (generated); `packages/db/src/schema/orders.transition.test.ts` | 1 |
| `apps/server/src/order-groups.ts` (a new exported helper beside `releaseGroup`); new `apps/server/src/collect-at-counter.test.ts` | 2 |
| `apps/server/src/move-bill.ts` (a new exported function); `collect-at-counter.test.ts` | 3 |
| `apps/server/src/finish-party-service.ts`, `finish-party-input.ts`; new `apps/server/src/finish-party-collect.test.ts` | 4 |
| `apps/server/src/till-api.ts` (finish route `:2855-2929`), `till-api.profile-zones.test.ts` (map row `:157`); `finish-party-collect.test.ts` | 5 |
| `apps/till/src/api/finish-table-types.ts`, `widgets/finish-table-dialog.ts`, `i18n/strings.ts`; `finish-table-dialog.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts` | 6 |
| `apps/till/src/till-app.ts` (`FinishingTable` `:1020-1036`, `#confirmFinishTable` `:15039-15077`, `#sendFinishTable` `:15079-15210`, `#renderFinishTable` `:15335-15418`); `till-app-parties.test.ts` | 7 |
| `apps/server/src/guide/en/table-service.md`, `es/table-service.md`, `en/kitchen-service.md`, `es/kitchen-service.md`; `docs/backlog.md`; `docs/backlog/till.md`; the design (a dated note) | 8 |
| none committed (pictures outside the repository) | 9 |

Each task is sized for one implementer well under about 100 tool calls. Tasks 1–5 run in order;
Task 6 may run before Task 5 but not beside another task in the same worktree (CLAUDE.md §6: agents
take turns).

---

## Task 1: a paid bill may leave its party for the counter, once (database)

**Files:** the generated migration in `packages/db/drizzle/`; tests in
`packages/db/src/schema/orders.transition.test.ts`.

The trigger's latest body is `packages/db/drizzle/0143_working_order_receipt_locale_transition.sql`
(found as the highest-numbered of `git grep -ln "working order cannot make that transition" --
packages/db/drizzle`; re-check that nothing newer re-creates it before copying). The refusal's words
are `TRANSITION_REFUSAL` from `packages/db/src/trigger-refusals.ts`, already imported by the suite.

- [ ] **Failing tests** in `orders.transition.test.ts`, beside "still permits the handover stamp on a
  settled order" (`:612`), each on a fresh settled order made as the suite makes one (`open()` then
  `status: "settled"`, as `:252-262` does) with a party set (insert a `parties` row as the suite's
  other party cases do, or as `scripts/behavioural-triggers.test.ts:223-226` writes `party_id`):
  (a) "lets a settled order not yet handed over leave its party, nothing else changing": `set({
  partyId: null })` succeeds and the row read back differs from the one before only in `partyId`;
  (b) "refuses a settled order leaving its party with any other change" — `it.each` over `{ label:
  "x" }`, `{ revision: <old + 1> }`, `{ settledAt: now() }`, `{ status: "abandoned" }`, each together
  with `partyId: null` → `TRANSITION_REFUSAL`; (c) "refuses a handed-over order leaving its party":
  stamp `collectedAt`, then `partyId: null` → refused; (d) "refuses the handover stamp together with
  leaving the party" → refused; (e) "refuses a settled order joining a party or changing party":
  from no party to one, and from party A to party B → refused; (f) "the exception names every
  column": read `pragma table_info(working_orders)` and the trigger's SQL from `sqlite_master`, and
  check every column name other than `party_id` appears in the new branch's text (the branch found
  between its first condition and the next `OR (`) — weaker than its name: it reads text, which is
  why (b) exists beside it. Rename "rejects any OTHER change to a settled order…" (`:252`) and its
  first comment line (`:253`) to say the handover stamp and leaving a party are the two changes
  allowed (row 2 of "Changed test checks"); its checks do not change. Run
  `pnpm --filter @waitron/db exec vitest run src/schema/orders.transition.test.ts`. Expected: (a)
  and (f) fail (the refusal; no such branch); (b)–(e) pass already.
- [ ] **Generate** with `pnpm --filter @waitron/db db:generate:custom --name settled_order_to_counter`.
  Write the body: `DROP TRIGGER working_orders_enforce_transition;`, `--> statement-breakpoint`, then
  `CREATE TRIGGER` with **every branch of `0143…sql` copied unchanged** and one new `OR (…)` branch:
  `old.status = 'settled' AND new.status = 'settled' AND old.collected_at IS NULL AND
  new.collected_at IS NULL AND old.party_id IS NOT NULL AND new.party_id IS NULL`, then `new.<c> IS
  old.<c>` for every other column `pragma table_info(working_orders)` lists (`revision` and `label`
  included). One SQL comment line above the branch: "A paid bill a finished table sends to the
  counter leaves its party once, before handover (A758-7)." Read the generated snapshot: it must equal
  the previous one apart from its id and `prevId` (a custom migration changes no schema).
- [ ] **Run** the suite (every case green, the count up by the new cases), then the migration guard
  suites, reading `migration-upgrade.test.ts`'s summary: passed → the PR needs no venue reset;
  failed → record the failure and stop. `scripts/behavioural-triggers.test.ts` must stay at 363
  passed with no edit (Decision 14). Typecheck `@waitron/db`; the fiscal gates.
- [ ] Commit — "A paid bill may leave its party for the counter once, before it is handed over".

## Task 2: held work is fired before its bill leaves (server)

**Files:** `apps/server/src/order-groups.ts` (a new export beside `releaseGroup` `:692-765`); new
`apps/server/src/collect-at-counter.test.ts`.

**Interfaces:** `releaseHeldWorkOf(tx, cfg, partyId, billIds: readonly string[], operatorId: string,
attendance?: OrderAttendance): Promise<void>` — every `held` group (`orderGroups.state`) holding a
top-level line of one of `billIds`, in the party's group order: one with an active line (quantity
above its cancelled quantity, read as `releaseGroup` reads it, `:718-722`) is released through
`releaseGroup` with firer `{ personId: operatorId }` and `detail: {}`, as `fireGroup` calls it
(`:447-457`); one with none has its lines' group cleared (`clearGroups`,
`apps/server/src/working-order.ts:4585-4597`) and is marked removed
(`removeEmptiedHeldGroups(tx, partyId, [groupId], operatorId)`). It does not check or bump the
party's revision (the caller has).

- [ ] **Failing tests** (`collect-at-counter.test.ts`, `useVenueDb` with
  `migrationOptionsFor(manifestSets(), null)` and the adjustment venue, as
  `finish-party-service.test.ts:48-55` does; a paid bill with held dishes from `billWith(…, {
  release: "hold" })` then `payWorkingOrder`, as its `fixture()` does): (a) "fires a paid bill's held
  group": every `ticket_items` row of the bill has `fired_at` set, the group's state is `fired`, and
  `print_jobs` gains the fired work's kitchen ticket, marked FIRE when the group's HOLD ticket had
  been printed (`order_groups.hold_printed_at`; `releaseGroup` decides at `:734`) — read `print_jobs`
  as `finish-party-service.test.ts:116` does; (b) "fires a group shared by two bills once": a held group
  holding a line on each of two paid bills of one party (split a held bill before paying it, keeping its
  group, as `splitBill` allows, `apps/server/src/bill-actions.ts:162-167`, then pay both) →
  one `fired` event (`recordGroupEvent`), both bills' items fired; (c) "removes a held group whose every
  line was cancelled with its charge kept": cancel the held dish with `cancelItem` `keep_charge` as
  `finish-party-service.test.ts` does, then call → the line's `group_id` is null and the group's
  state `removed`; (d) the control: a fired group is left alone; (e) "refuses with the release's own
  refusal": a held group whose party's allergy question is unanswered, if one can be made (seat
  without `seatWithNoAllergies`); if a held group cannot exist with the question unanswered, write
  that in the task's report and drop (e). Run
  `pnpm --filter @waitron/server exec vitest run src/collect-at-counter.test.ts`. Expected: the
  import is missing.
- [ ] **Code.** If firing a settled bill's held group is refused by the freeze trigger, stop and
  report: the table's Fire works on a paid bill today (A773-1 kept "held-group Fire available"), so
  that would mean the release writes `working_orders`.
- [ ] **Run** the file, `src/order-groups.test.ts` and `src/pass-lifetime.test.ts`. Typecheck
  `@waitron/server`; the fiscal gates.
- [ ] Commit — "Held work on a paid bill can be fired before the bill leaves its party".

## Task 3: a paid bill moves to the counter (server)

**Files:** `apps/server/src/move-bill.ts` (a new export beside `moveBill`);
`collect-at-counter.test.ts`.

**Interfaces:** `moveSettledBillToCounter(tx, cfg: OriginConfig, billId: string, from: { partyId:
string }, expectedEdit: BillEditExpected): Promise<void>` — in this order: refuse unless the bill is
`settled`, not collected and in a party (`management.request_invalid` `{ field: "billId" }`; the
caller has checked, so this is a guard); `const before = await readSentWork(tx, billId)`;
`inheritKitchenNote(tx, cfg, from, { workingOrderId: billId }, "copy")`; `leaveParty(tx, billId)`;
`update working_orders set party_id = null` and nothing else; `relocateBillEditor(tx, billId,
expectedEdit)`; `VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [billId])`;
`enqueueMovedSlips(tx, cfg, before, billId)`. `from` is the party being finished, not necessarily the
bill's own (Decision 5).

- [ ] **Failing tests** (`collect-at-counter.test.ts`): (a) "moves a paid bill to the counter,
  changing only its party": the `working_orders` row differs only in `partyId` (null); `label`,
  `revision`, `status`, `collectedAt` and the order's zone (`VENUE_SERVICE.findOrderZones`) unchanged;
  (b) "tells each station it went to the counter": a MOVED print job per station with work, and a
  `moved` kitchen notice whose `movedTo` is null (read the notices as
  `apps/server/src/kitchen-print.ts:1361` writes them); (c) "copies the party's kitchen note" onto the
  order; (d) "refuses held work" — called without Task 2 first → `group.held_leaves_party`, nothing
  changed (the order matters, Decision 4); (e) refusals: an open bill, a collected bill → the guard's
  code; (f) **"Move this bill → The counter still refuses a paid bill"**: `moveBill(…, { counter: {
  zoneId: null } }, …)` on a settled bill → `bill.paid`, nothing changed (Decision 1; the existing
  cases pin it for a table target only, `apps/server/src/till-api.move-bill.test.ts:876-887` and
  `apps/server/src/party-move-bill.test.ts:426-433`). Run the file. Expected:
  (a)–(e) fail on the missing export; (f) passes.
- [ ] **Code.** Do not call `refuseMainBillLeaving` (`move-bill.ts:457-476`): a paid bill is not a
  main bill (the release trigger clears one when it leaves `open`,
  `packages/db/drizzle/0038_main_bill_release.sql:5-11`), and the party closes in the same request.
- [ ] **Run** the file, `src/party-move-bill.test.ts src/till-api.move-bill.test.ts
  src/kitchen-print.test.ts`. Typecheck; the fiscal gates.
- [ ] Commit — "A paid bill can move to the counter, telling the kitchen".

## Task 4: Finish table's counter collection (server service)

**Files:** `apps/server/src/finish-party-service.ts` (`FinishPartyArgs` `:49-54`,
`finishPartyService` `:58-92`, `finish` `:94-203`), `apps/server/src/finish-party-input.ts:8-39`; new
`apps/server/src/finish-party-collect.test.ts`.

**Interfaces:**
- `export interface CounterCollection { bills: { billId: string; expectedBillRevision: number }[] }`;
  `FinishPartyArgs` gains `collect?: CounterCollection`.
- `parseFinishCancellations(body)` also answers `collect`: an object whose `bills` is a non-empty
  array of `{ billId` (UUID, lower-cased) `, expectedBillRevision` (`requireRevision`) `}` with no
  repeated `billId`; refused `management.request_invalid` naming `collect` when malformed or sent
  with `cancellations`, naming `approver` when sent with `approver`, naming `submissionId` when sent
  without one (`submissionIdOf`, `apps/server/src/bill-payments-api.ts:103-111`).
- `finishPartyService` fingerprints `collect` with its bills sorted by `billId`.
- In `finish`, after the dish list (`:129-145`), when `collect` is present: the bills of `dishes`
  with their `billRevision`, distinct and sorted, must equal the request's, else `refused()`
  (`:146`); then `releaseHeldWorkOf` (Task 2) over those bills, then `moveSettledBillToCounter`
  (Task 3) for each, in `billId` order, with `{ partyId: args.partyId }` and that bill's
  `expectedEdit`; then `finishTable` (`:195-201`) with `expectedEdits` **less the moved bills'**,
  because `closeParty` checks the edits of exactly the family's bills
  (`readExpectedBillEdits`, `apps/server/src/bill-editing.ts:223-235`) and the moved bills have left
  it. The answer is `{ state: "closed" }`.
- The route needs no change for this task: it spreads the parsed body into `finishPartyService`
  (`...resolution`, `apps/server/src/till-api.ts:2913`), so the tests below reach the service over
  HTTP. Task 5 adds the route's zone check.

- [ ] **Failing tests** (`finish-party-collect.test.ts`, the adjustment venue; a `collect()` helper
  beside `finish-party-service.test.ts`'s `confirm()` building the body from the refusal's dishes;
  call through `venue.app` as its `post()` does): (a) "moves the paid bill with food to come to the
  counter and finishes the table": `{ status: 200, body: { state: "closed" } }`; the party `closed`,
  its tables left; the bill's `partyId` null; no `adjustments` and no `line_service_cancellations`
  row written; (b) "fires a held dish on the way" (Review Focus 3); (c) "moves only the bills with
  food to come" (Review Focus 4): a second paid bill of the party, every dish served (`markServed`) →
  it keeps the party; (d) "moves a merged-in party's paid bill" (`combineParties`, as
  `finish-party-service.test.ts:389-421` does); (e) "refuses a changed set without moving anything"
  (Review Focus 5): serve the dish after reading, send the old bills → 409 `party.unserved_dishes`,
  `snapshot()` unchanged; the same for a wrong `expectedBillRevision`, an extra bill and a missing
  bill; (f) "replays the same collection" and "refuses the same submission with other bills" →
  `submission.id_reused` (Review Focus 6); (g) refusals of the body: `collect` with `cancellations`,
  with `approver`, without `submissionId`, with an empty or repeated `bills` → 400
  `management.request_invalid` naming the field, nothing changed; (h) "keeps the outstanding bill
  refusal first": a bill still owing → `party.bill_outstanding`, as the cancel path does (`:221-229`).
  Run `pnpm --filter @waitron/server exec vitest run src/finish-party-collect.test.ts`. Expected:
  (a)–(f) fail (the body is ignored and the table is refused `party.unserved_dishes`, or the
  collection not made); (g) fails where the field is accepted; (h) passes.
- [ ] **Code.**
- [ ] **Run** the file, `src/finish-party-service.test.ts src/till-api.parties.test.ts
  src/pass-lifetime.test.ts` (A758-6's cancel path and its answers unchanged), and
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts
  scripts/staff-notice-codes.test.ts` (no new code). Typecheck; the fiscal gates.
- [ ] Commit — "Finish table can send the food still to come to the counter".

## Task 5: who may collect, and the whole way round (server route)

**Files:** `apps/server/src/till-api.ts` (the finish route `:2855-2929`: the body type `:2860-2866`,
`checkZones` `:2897`); `apps/server/src/till-api.profile-zones.test.ts` (map row `:157`);
`finish-party-collect.test.ts`.

- [ ] **Failing tests** (`finish-party-collect.test.ts`):
  (a) **Zones** (Review Focus 8; zones made as `zone-access.finished-party.test.ts:30-41` makes
  `elsewhere`, a profile limited with `setProfileServiceAccess` as that file does): a party in zone Z1
  that took in, by `combineParties`, a party whose paid bill was sold in zone Z2 → collecting from a
  device limited to Z1 is 403 `service_zone.not_allowed` and nothing changed; from a device allowed
  Z1 and Z2, and from one with no zone limit → 200. (b) **The whole way round** (Review Focus 7),
  over HTTP after a successful collect of a fired, ready dish: `GET` the pass screen and monitor as
  `pass-lifetime.test.ts` reads them (`listPassScreen`, `listPassMonitor`), the station queue
  (`listStationQueue`), `GET /api/orders/counter-waiting` (the order, `status: "settled"`,
  `canHandOver: true`, `label` the bill's label before the move) and `GET /api/bills` (the row,
  `state: "paid-not-handed-over"`, `partyId: null`, `zoneId` the table's zone) each hold it; then
  `POST /api/orders/:id/collect` (a cookie whose profile has `hand-over-orders`) → 200, and every one
  of those reads drops it. (c) **Nothing filed changes** (Review Focus 2): before and after the
  collect, every `registros_facturacion` row (import as
  `apps/server/src/cancel-invoiced-order.test.ts` does), and the `sales`, `sale_lines`, `tenders` and
  `sale_receipt_guests` rows, are deep-equal, and so is `GET /api/transactions/:saleId/receipt`'s
  JSON. (d) **The control** (Decision 10): for a sale issued as a full invoice (the venue's full
  invoice path, as the receipt guest tests do — find one with
  `git grep -ln "readReceiptGuests\|guests" -- apps/server/src/*receipt*.test.ts`),
  `readReceiptGuests` answers the party's count before and `undefined` after: the case is named
  "a full invoice's later copies print no guests once its bill moves to the counter (A1025)". Run
  the file. Expected: (a)'s refusing case answers 200 (the route checks the party's zone only); (b)–(d)
  pass already, Task 4 having landed — they pin the promise end to end, and one that fails is a
  defect in Tasks 1–4 to report, not a check to change.
- [ ] **Code.** Read `collect` in the body type; `checkZones(tx, deps.cfg, current, [{ partyId },
  ...collect.bills.map((bill) => ({ orderId: bill.billId }))])`; pass `collect` to
  `finishPartyService`; no refund authorization when `collect` is present (`refundHandoff` is false
  by construction). Update the zone map's row (`till-api.profile-zones.test.ts:157`) to
  `| POST /api/parties/:id/finish | party; each bill a counter collection names | refuses POST
  /api/parties/:id/finish; finish-party-collect.test.ts: "refuses a collection naming a bill outside
  the profile's zones" |`, with the case named that. The actions map row (`till-api.profile-actions.test.ts:112`)
  does not change: the route's `take-orders` check comes before the body is read
  (`till-api.ts:2857`).
- [ ] **Run** the file and the till route guard suites. Typecheck; the fiscal gates.
- [ ] Commit — "A counter collection is checked against each bill's zone, and its order waits at the
  counter until handed over".

## Task 6: the third button (till widget)

**Files:** `apps/till/src/api/finish-table-types.ts` (`FinishTableResolution`, the client's request
type); `apps/till/src/widgets/finish-table-dialog.ts` (properties `:76-85`, the footer `:410-439`);
`apps/till/src/i18n/strings.ts` (beside `finish_table.unserved`, `:48-49` and `:1793-1794`);
`finish-table-dialog.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`.

**Interfaces:**
- `export interface CounterCollection { bills: { billId: string; expectedBillRevision: number }[] }`;
  `FinishTableResolution` becomes `{ submissionId: string; cancellations: FinishCancellation[];
  approver?: … } | { submissionId: string; collect: CounterCollection }`. `api.finishTable`
  (`apps/till/src/api/client.ts:3629-3646`) needs no change beyond the type.
- New string `finish_table.collect`: "They'll collect it at the counter" / «Lo recogerán en el
  mostrador».
- New property `collectPending: boolean` (default false). New event `finish-table-collect`
  (`bubbles`, `composed`, `detail: {}`).
- The footer, in template order: Back (`slot="cancel"`), `wt-button[data-collect]`
  (`slot="secondary"`, `variant="secondary"`), the main button (default slot). The collect button is
  disabled while busy, or while `confirmationLocked && !collectPending` (an unconfirmed cancel); the
  main button is also disabled while `collectPending`. A collect click ignores a stale observation as
  `#confirm` does (`:237-241`), sets `sending`, and emits; it needs no reason and no answers.

- [ ] **Change the pinned check first** (row 1): "offers no counter collection…" (`:129-140`)
  becomes "offers the counter collection beside Back and the main action" with
  `["back", "collect", "main"]` for both `refundAtTill` values. Then the new cases
  (`finish-table-dialog.test.ts`): (a) "emits a collection with no reason chosen and no answer
  given": a dish asking Yes / No left unanswered, no reason → the collect click emits
  `finish-table-collect` once and no `finish-table-choice`; (b) "words the collection in Spanish"
  (`es["finish_table.collect"]`); (c) "keeps the collection single while sending, and blocks it from
  a closed or detached dialog" (as `:410-427` and `:439-454` do for the main button); (d) "while an
  unconfirmed collection waits, only the collection can resend": `collectPending` and
  `confirmationLocked` → main disabled, collect enabled; (e) "while an unconfirmed cancel waits, the
  collection cannot send": `confirmationLocked` alone → collect disabled. `.unsaved.test.ts`: a changed
  draft then a collect click opens no leave prompt (the dialog emits; the app closes it).
  `.a11y.test.ts`: the dialog with the collect button, both themes, and with `collectPending`. Run
  (free memory checked) `pnpm --filter @waitron/till exec vitest run
  src/widgets/finish-table-dialog.test.ts src/widgets/finish-table-dialog.a11y.test.ts
  src/widgets/finish-table-dialog.unsaved.test.ts`. Expected: row 1 and (a)–(e) fail; the a11y
  cases fail to find the button.
- [ ] **Code.**
- [ ] **Run** the three files, `src/i18n/strings.test.ts`, the string guards; typecheck `@waitron/till`.
- [ ] Commit — "Finish table offers They'll collect it at the counter".

## Task 7: the till sends the collection and leaves the table (till app)

**Files:** `apps/till/src/till-app.ts` — `FinishingTable` (`:1020-1036`: `command` becomes
`FinishTableResolution` without `approver`), a new `#collectFinishTable` beside `#confirmFinishTable`
(`:15039-15077`), `#sendFinishTable` (`:15079-15210`), the dialog's mount in `#renderFinishTable`
(`:15335-15364`); tests in `apps/till/src/till-app-parties.test.ts`, in `describe("till-app: Finish
table confirms paid unserved dishes")` (`:10745`), using its `mountFinish` and `openFinish`
(`:10802-10830`).

- [ ] **Failing tests:** (a) "sends the counter collection with each bill once and the revision it
  read, and leaves the table": two dishes on `wo-4` and one on `wo-check` → `finishTable` called with
  `{ submissionId, collect: { bills: [{ billId: "wo-4", expectedBillRevision: 0 }, { billId:
  "wo-check", … }] } }` (sorted by `billId`), no `cancellations`; then the floor is shown as after
  Finish (as "finishes the table at the revision it read and goes back to the floor", `:763`, checks);
  (b) "says the order moved to the counter": the submitted toast (`wt-toast[data-submitted-toast]`,
  read as `:6716` reads it) has the message `t("station.notice.moved_to_counter")`; (c) "re-reads the
  waiting orders": `listCounterWaiting` is called after the answer; when it fails, the message is
  `refresh.waiting_after_move`; (d) "opens no refund and asks no PIN": no `listRefundAuthorizers`,
  no refund dialog, even with a dish ticked for refund in the dialog; (e) "re-reads the dishes when
  the set changed": `finishTable` rejects with `party.unserved_dishes` and a new list → the dialog
  shows the new list, as `:11144` "re-prompts a raced kitchen set…" checks for a cancel; (f) "shows a
  refusal in the dialog": `station.no_default` → the dialog's `refusal` is its `codeMessage`, the
  table stays open; (g) "resends the same collection after a lost answer, and only the collection":
  every resend fails as in `:11545-11568` → the dialog has `collectPending` and `confirmationLocked`;
  a main-button `finish-table-choice` then sends nothing; a second collect sends the same body;
  (h) "a cancel left unconfirmed cannot be turned into a collection": the reverse → a collect sends
  nothing. Run (free memory checked)
  `pnpm --filter @waitron/till exec vitest run src/till-app-parties.test.ts -t "counter"`. Expected:
  every case fails (no handler for `finish-table-collect`).
- [ ] **Code.** `#collectFinishTable(event)` follows `#confirmFinishTable`'s guards (`:15041-15048`,
  the draft check `:15049-15052`); its command is `open.command` when that is an unconfirmed
  collection, else `{ submissionId: crypto.randomUUID(), collect: { bills } }` from `open.dishes`;
  it calls `#sendFinishTable`. In `#sendFinishTable`, a collection's answer closes the dialog, calls
  `#onTableClosed(asked.partyId, asked.visit, asked.sent)`, then — while the session is still the
  one that asked — sets `submittedNotice` and shows the toast, and calls
  `void this.#refreshAfterWrite("waiting", "refresh.waiting_after_move")`; it builds no refund
  receipts. Every read of `open.command!.cancellations` (`:15112`, `:15183`, `:15201`) first checks
  the command has `cancellations`. `#confirmFinishTable` ignores a click while an unconfirmed
  collection waits. The mount passes `.collectPending=${open.unconfirmed === true && open.command !==
  undefined && "collect" in open.command}` and listens for `finish-table-collect`.
- [ ] **Run** the file whole (A758-6's Finish cases unchanged), `src/widgets/finish-table-dialog*.test.ts`;
  typecheck `@waitron/till`.
- [ ] Commit — "The till sends the food to the counter and leaves the table".

## Task 8: guides, backlog and the design's dated note

**Files:** `apps/server/src/guide/en/table-service.md` and `es/table-service.md` (the section
`{#finish-paid-table}`, `:50-67` in both); `apps/server/src/guide/en/kitchen-service.md` and
`es/kitchen-service.md` (`{#service-lifetime}`, the counter-order paragraph, `:86-87` in English,
`:99` in Spanish); `docs/backlog.md` (A758, `:2189-2236`); `docs/backlog/till.md` (`## A758`,
`:1417-1527`, and `## Decisions and deliberate limits`, `:1562`); the design (a dated note under
its header, beside the A758-6 one at `:3-5`).

- [ ] **Guides**, after the paragraph that ends "…refund it at a till from the receipt." (English
  `:64`, Spanish `:64`):
  English — "If the guests will wait and take their food from the counter, choose **They'll collect
  it at the counter** instead. Nothing is cancelled or refunded. Dishes held back go to the kitchen
  now, each bill with food still to come becomes a paid order waiting at the counter, and the table
  finishes. The order shows as **Paid, not handed over** under **Waiting orders** on the **Counter**
  screen and in **Find a bill**; choose **Hand over** when the guests collect it."
  Spanish — "Si los clientes van a esperar y recoger la comida en el mostrador, elige **Lo recogerán
  en el mostrador**. No se cancela ni se devuelve nada. Los platos en espera pasan ahora a cocina,
  cada cuenta con platos por llegar pasa a ser un pedido pagado que espera en el mostrador, y la
  mesa se cierra. El pedido aparece como **Pagado, sin entregar** en **Pedidos pendientes**, en la
  pantalla **Mostrador**, y en **Buscar cuenta**; elige **Entregar** cuando lo recojan."
  In `{#service-lifetime}`, after "A counter order stays visible after payment until you collect or
  close it.": English — "When a paid table finishes with **They'll collect it at the counter**, its
  food still to come becomes such an order: each station gets a MOVED slip to the counter, and the
  food stays on the pass until the order is handed over." Spanish, after «Un pedido de mostrador
  sigue visible después del cobro hasta que lo entregues o cierres.» — "Cuando una mesa pagada se
  cierra con **Lo recogerán en el mostrador**, sus platos por llegar pasan a ser un pedido así: cada
  estación recibe un ticket MOVIDO al mostrador, y los platos siguen en el pase hasta que se entrega
  el pedido." Each bold word is checked against the till's strings in both languages before
  committing (`tab.counter`, `waiting.title`, `waiting.paid_not_handed_over`, `waiting.hand_over`,
  `find_bill.title`, `finish_table.collect`). No new heading, so no new `{#id}`. Run the guide
  suites.
- [ ] **`docs/backlog.md`:** delete the A758 entry (CLAUDE.md §6: a change that finishes an entry
  deletes it). Add, in the same area, beside A1020 and A1021:
  - "**A1023. The owner looks at A758-7's choices (left open by A758-7).** Each works as built; the
    owner may want it different: held dishes fired on the way to the counter; each bill with food
    still to come moved as its own counter order; the order keeping its table's zone, so a till or
    pass limited to the counter's zone does not show it; the toast reusing "Moved to the counter";
    the button beside the main one rather than on a row of its own as picture 06 draws; and the
    settled-order freeze now letting a paid bill leave its party for the counter once, an exception
    `scripts/behavioural-triggers.test.ts` does not yet hold. [Plan](superpowers/plans/2026-10-22-a758-7-collect-at-counter.md#owner-points-each-with-the-default-this-pr-builds)"
  - "**A1024. Nothing on the pass says an order waits at the counter (left open by A758-7).** A paid
    order a finished table sent to the counter is named on the pass and in Waiting orders by its
    number and the table it was paid at ("#12 Mesa 4"), as Move this bill → The counter names one
    today; only the MOVED slip and the station notice say "counter"."
  - "**A1025. A full invoice's later copies lose the guests line once its bill moves to the counter
    (left open by A758-7).** A full invoice reads its guests from the bill's party each time it
    prints (`readReceiptGuests`, `apps/server/src/receipt-guests.ts`); a simplified receipt keeps
    the count stored at payment."
- [ ] **`docs/backlog/till.md`:** delete `## A758. Adjustment reasons: review the rules, then a page
  of their own` (to the next `## `, `:1528`). First check nothing cites it besides the design and
  `docs/backlog.md` (`git grep -n "a758-adjustment-reasons-review" -- .` listed only those two on
  `9f4632719`), and that no code comment cites the backlog detail (`git grep -n "backlog/till.md" --
  apps packages`). Add under `## Decisions and deliberate limits`: "### A paid bill may leave its
  party for the counter once (A758-7, 2026-10-22)" — the trigger exception in Decision 2, the
  migration's name, that nothing else about a paid bill may change, and the
  [plan](../superpowers/plans/2026-10-22-a758-7-collect-at-counter.md).
- [ ] **The design:** a dated note under its header: "> **2026-10-22 A758-7 update:** §3.8 item 4 is
  built as Finish table's counter collection ([plan](../plans/2026-10-22-a758-7-collect-at-counter.md));
  the database's settled-order freeze gained the one exception it needed. A758 is finished: its
  backlog entry and its detail in `docs/backlog/till.md` are deleted, so the link above to that
  detail no longer resolves; what it left open is A1020, A1021 and A1023–A1025."
- [ ] `pnpm exec prettier --file-info docs/backlog.md` prints `"ignored": true`. Commit —
  "Guides and backlog: A758-7, and A758 is finished".

## Task 9: LOOK

Tests read text; nobody has seen these screens.

- [ ] Write a throwaway look harness (not staged), as A758-6's Task 13 did: mount
  `till-finish-table-dialog` with picture 06's Table 4 (2 × Croquetas being prepared, 1 × Flan held,
  reason Not served), and with `collectPending`; and `till-counter-waiting` with the moved order
  (`status: "settled"`, `label: "Mesa 4"`, `canHandOver: true`). Each in English and Spanish, light
  and dark, at 1280 and 390 wide (`page.viewport`, never `commands.setViewportSize`; report
  `window.innerWidth`).
- [ ] Save the pictures **outside the repository**, in `~/waitron-campaign-c/a758-7-shots/`, named
  `<screen>-<lang>-<theme>-<width>.png`; delete the harness; `git status --short` shows nothing.
  Compare the dialog with picture 06 (`06-finish-table-asks.png` and `-dark`): where the collect
  button lands at each width, and whether the footer wraps cleanly at 390. Fix a defect test-first;
  list a judgement call as an owner point. Nothing to commit unless a fix was made.

**PR description** (plain English): first line — the review path, "No venue reset needed" if Task
1's upgrade walk passed (else the reset line it wrote), and that the settled-order freeze gains one
exception. Then what Finish table now offers and what happens after, with the pictures; the
decisions above as owner points; "Changed test checks" and "Fixtures grown"; the fiscal gates'
counts and that no filed record changes.

---

## Changed test checks

Each changes only because the design changes what it checks. Lines are on `9f4632719`; an
implementer who finds one moved records the new line.

| # | Task | Where | Old → new | Design |
|---|---|---|---|---|
| 1 | 6 | `apps/till/src/widgets/finish-table-dialog.test.ts:129-140` "offers no counter collection: Back and the main action are its only buttons" (`toEqual(["back", "main"])`) | "offers the counter collection beside Back and the main action", `toEqual(["back", "collect", "main"])` for both `refundAtTill` values | D17, §3.8 item 4 |
| 2 | 1 | `packages/db/src/schema/orders.transition.test.ts:252` (name) and `:253` (comment "The relaxation permits the collected_at stamp and NOTHING ELSE.") | renamed to name the two allowed changes, the handover stamp and leaving a party for the counter; every check in the case unchanged | §3.8 item 4, Decision 2 |
| 3 | 5 | `apps/server/src/till-api.profile-zones.test.ts:157`, a row of the route-to-zone map (a comment, not a check) | "party" → "party; each bill a counter collection names", with the new case | §3.8 "Who may", Decision 8 |

**Unchanged, checked:** `scripts/behavioural-triggers.test.ts` (363 passed on `9f4632719`,
**(run)**; its settled-order cases, `:625-648` among them, stay true: Decision 14).
`pass-lifetime.test.ts:206-220` (a finished party's food still leaves the pass when nothing is
collected). A758-6's answers `{ state: "closed" }` and `refundLinks` (`finish-party-service.test.ts`,
`till-api.parties.test.ts`). The fiscal gates.

If a suite turns red on a check not in this table, it is a stop and a report, then a new row here.

## Fixtures grown

- `apps/server/src/collect-at-counter.test.ts` and `finish-party-collect.test.ts` are new; any helper
  they share (a paid table bill with a held and a fired dish; a second paid bill all served) stays in
  them unless both need it, in which case it goes in `apps/server/src/testing/adjustment-venue.ts`,
  listed here with its signature.
- `till-app-parties.test.ts`'s Finish block may need `listCounterWaiting` in `mountFinish`'s stubs
  (Task 7 (c)); listed with its line if added.
- The look harness of Task 9 is not committed.

## Owner points (each with the default this PR builds)

1. **The settled-order freeze gains one exception** (Decision 2): a paid bill may leave its party for
   the counter once, before it is handed over, changing nothing else. It touches no filed record,
   sale or payment (Task 5 compares them), so it is not a fiscal change; it is the one database rule
   this slice loosens. `scripts/behavioural-triggers.test.ts` does not hold its cases yet; they are in
   `packages/db`'s own trigger suite (Decision 14).
2. **Held dishes are fired on the way** (Decision 4).
3. **Each bill with food still to come moves as its own counter order**; a bill whose food was all
   served stays with the finished table (Decision 3).
4. **The order keeps its table's zone** (Decisions 5 and 12): a till or pass limited to the counter's
   zone does not show it; one with the table's zone, or no zone limit, does.
5. **The words after:** the toast reuses "Moved to the counter" («Pasado al mostrador») (Decision 9).
6. **The button sits beside the main one**, in the form's secondary place, where picture 06 draws a
   row of its own (Decision 9; Task 9's pictures show it).
7. **Nothing on the pass says "counter"** (Decision 11, A1024).
8. **A full invoice's later copies lose the guests line** (Decision 10, A1025).

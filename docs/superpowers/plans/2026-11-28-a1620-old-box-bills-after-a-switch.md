# A1620 — after a switch, the old box's bills can be closed as paid later and are tidied at end of day

Status: PLAN FOR APPROVAL (lane B, 2026-11-28). Fiscal: the owner lands it. Read against main
f462a47c6e. One pull request, `feat/a1620-old-box-bills`, about two hours of building.

## What staff can do when it lands

- **Close as paid later** works on a bill another box opened or already issued, as **Pay** does
  today. Today the till refuses with "This bill can't be closed as a deferred payment: … it belongs
  to another box …".
- After a **planned handover**, the new main box's end-of-day close issues the old box's bills still
  open from an earlier trading day, as it does its own. Today it skips them, and they stay open until
  staff deal with each one.
- After an **emergency switch**, the old box's open bills are left for staff, as after a restore
  (the end-of-day close skips them): the spare's copy may be behind the old box, so the copy's bill
  may not be the whole meal.
- Unchanged, as the owner chose: owed receipts are still retried only by the box that tried to print
  them (`apps/server/src/owed-receipts.ts:111`).

The owner's words, 27 Nov ~09:52, on the watcher's audit
(`~/waitron-campaign-shared/desk/done/20261127-0000-L-other-box-refusals.md`): "Fix 2 and 3, leave 4".

## Today (read, with receipts; nothing below was run)

- `apps/server/src/deferred-close.ts:105` refuses `other_node` when the bill's `nodeId` is another
  box's; `:131` refuses it when the bill's sale was issued by another box.
- `apps/server/src/close-of-day.ts:182` (`readCloseableBill`) and `:257` (`dueBills`) consider only
  bills whose `nodeId` is this box's. `readCloseableBill` also feeds `closeOfDayEnd` (`:217`), which
  `sale-day.ts:62` uses to date any invoice of a due bill issued after its day ended to that day's
  end.
- `before_restore` is written only by the restore (`apps/server/src/restore.ts:835-838`, every open
  and placed bill, the owner's D6 from #3847, 19 Nov) and read only by `close-of-day.ts:178` and
  `:259`. Receipt: `rg -n 'beforeRestore|before_restore' apps packages -g '*.ts' -g '*.sql'`
  (outside tests and generated migrations, the only other hits are `core.sql`'s update triggers,
  which already let the flag go from 0 to 1 on open and placed bills, as the restore does).
- A bill's `nodeId` is read, outside tests, only at the five sites above plus `close-of-day.ts:280`
  (`UNTRUSTED`, the bills whose opening time this box stamps when its own time hold ends). Receipt:
  `rg -n 'workingOrders\.nodeId|order\.nodeId|bill\.nodeId|working_orders.*node_id' apps packages -g '*.ts' -g '!*.test.ts'`.
- The only writer of a takeover record is the activation transaction,
  `apps/server/src/handover-activation.ts:151-165` (`insertHandoverActivationTx`), which knows the
  operation's `scenario`, `"emergency"` or `"controlled"`. It runs once: on a repeat the
  promotion returns before its venue transaction, whether it finishes the role or finds this box
  already primary (`promote.ts:178-189`).

## The change

1. **Close as paid later.** Delete both `other_node` checks in `deferred-close.ts`. An unissued bill
   is then issued on this box's chain through the same `priceForIssuance` and `issueUnpaidInvoice`
   as today; an issued one is settled as deferred and files nothing new. Retire the reason from
   `deferred_close.ineligible` in `apps/server/src/errors.ts:833`, and drop "it belongs to another
   box" / "pertenece a otro servidor" from the code's general sentence in
   `apps/till/src/i18n/codes.ts:353-354` and `apps/dashboard/src/i18n/codes.ts:1093-1094`, plus
   the till comment at `:1077` that names the reason.
2. **The emergency switch leaves the old box's bills for staff.** Move restore's update into one
   small function (`leaveOpenBillsForStaffTx`, new file `apps/server/src/bills-left-for-staff.ts`),
   called by the restore as today and by the activation transaction right after
   `insertHandoverActivationTx` when `operation.scenario === "emergency"`.
3. **End of day takes every box's bills.** Drop the node condition at `close-of-day.ts:182` and
   `:257`; `readCloseableBill` loses its `nodeId` argument, and `closeOfDayEnd`'s `scope` parameter
   goes if nothing else uses it (callers in `sale-day.ts` only).

## Decisions for the watcher

- **D1 — drop the checks rather than accept the takeover history** (the audit offered either). Pay
  takes the same bills with no node check, so a history check would refuse nothing Pay allows.
- **D2 — an emergency switch marks every open and placed bill, as a restore does**, in the
  activation's own transaction; a planned handover marks none (the old box handed over its current
  state before it stepped down).
- **D3 — the time-hold stamping stays this box's** (`close-of-day.ts:280`). A bill the old box opened
  while its own time was unconfirmed, still unstamped at a planned handover, is never issued by the
  close; staff close it. A box's time hold says nothing about another box's clock, and the case
  needs both an unconfirmed start and a handover the same day; no code for it.
- **D4 — invoice dating follows.** After a planned handover, an old box's bill paid on the new box
  after its trading day ended is dated by that day's end (`closeOfDayEnd`), as the new box's own
  bills are. After an emergency switch it is dated when issued, as after a restore. This is why the
  owner lands it.

## Tests (failing first)

- `deferred-close.test.ts`: a bill another box opened closes as paid later and its invoice is on this
  box's series; a bill another box issued closes, its sale's `fiscal_state` and the record count are
  unchanged, and its settlement is `deferred`. Deletion control: restore either check, the case
  fails with `other_node`.
- `handover-activation.test.ts`: an emergency activation marks the copy's open and placed bills
  `before_restore` and leaves a settled bill alone; a controlled one marks none.
- `close-of-day.test.ts`: a due bill another box opened is issued; one marked `before_restore`
  after an emergency switch is still left (`not_due`).
- `close-of-day.later-sale-date.test.ts`: a due bill another box opened, paid after its day ended,
  is dated by that day's end.
- `close-of-day-restore.test.ts` and the restore suites pass unchanged (the move in step 2 keeps the
  restore's behaviour).

**Changed test checks (the owner's decision changes them):**
`deferred-close-refusal.test.ts:189-202` ("a bill another node holds") becomes the first acceptance
case above; `close-of-day.test.ts:697-705` ("a bill opened by another node", `not_due`) now expects
the bill issued; `apps/till/src/i18n/codes.test.ts:1048-1052` loses its `other_node` row, and the general
sentence pinned at `apps/till/src/i18n/codes.test.ts:1005` and
`apps/dashboard/src/i18n/codes.test.ts:1148` becomes the shorter one.

**Checks to run:** the files above, `deferred-close-api.test.ts`, `deferred-close.replay.test.ts`,
`report-api.deferred-close.test.ts`, `close-of-day-job.test.ts`,
`close-of-day.every-path.later-sale-date.test.ts`, `restore.test.ts`, the till and dashboard
`codes.test.ts`, `scripts/errors-reachable.test.ts`, `scripts/alert-codes.test.ts`, golden huella
and `inmutabilidad` (unedited).

## Size

Production about +30 −20 lines; tests about +250. No schema change, no venue reset.

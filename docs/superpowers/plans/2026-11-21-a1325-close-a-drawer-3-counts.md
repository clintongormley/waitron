# 3. Save a count before showing the difference

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 2. Estimate 390 production and 380 test
lines. The server can save, resume and finish one pending close per drawer.

Add `packages/db/src/drawer-closes.ts` and extend `apps/server/src/drawer-api.ts`. Use PR 1's writer
and PR 2's active device, assigned drawer and person checks for all reads and writes, including by
id. A newly opened form gets the previous amount left. Saving the first count appends it with the
expected cash and movement sequence in one transaction. Only its committed response reveals the
difference. Reopening from another assigned till resumes the pending count. Allow one recount when
there is a difference and keep both counts and their authors. The recount covers the whole drawer at
its own sequence.

**Proposed handling of trading during a count.** Expected and counted cash are captured at the same
saved count. Before confirmation, the server shows the counted cash plus net cash posted since that
count as available for withdrawal. The difference stays the one found by counting. If cash posts after
the confirmation screen loaded, refresh the withdrawal figures before asking staff to confirm
again. In the final transaction save the actual amount left, bank withdrawal, and last movement
included. Movements ordered after this transaction go in the next close, even with an earlier
timestamp. Sales continue throughout. Confirm this flow with the watcher before building it.

Fail first in db `drawer-closes.test.ts`. Test a second till resuming the same count, first response
loss, one recount, a save racing with a sale, replay and immutable finish. Pin a concrete amount:
starting with 100 counted against 90 expected, a later +30 payment and −5 refund leave 125 available.
Leaving 20 saves a 105 withdrawal, a +10 difference and a next opening balance of 20. The server
`drawer-close-api.test.ts` owns hidden expected cash before count, field refusals, guessed ids and
authority. Run both suites, the till route inventories and the clock-stop check. No schema changes.

# 2. Save a count before showing the difference

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 1. Estimate 420 production and 395 test
lines. The server can save, resume and finish one pending close per drawer.

Add `packages/db/src/drawer-closes.ts` and mount `apps/server/src/drawer-api.ts` through `till-api.ts`.
Use PR 1's writer. Require the active device, tab person, `cash.drawer`, profile permission and the
device's actual assigned drawer for all reads and writes, including by id. A newly opened form gets the previous amount left. Saving the first count appends it with the
expected cash and movement sequence in one transaction. Only its committed response reveals the
difference. Reopening from another assigned till resumes the pending count. Return the hidden
form's start sequence and save whether cash moved between opening the count and saving it, so
printed and on-screen history can explain the possible discrepancy. Allow one recount when
there is a difference and keep both counts and their authors. Check that the recount links to the
first count for that close and drawer. The recount covers the whole drawer at its own sequence.

**Trading during a count.** Expected and counted cash are captured at the same
saved count. Before confirmation, the server shows the counted cash plus net cash posted since that
count as available for withdrawal. The difference stays the one found by counting. Finish carries
the sequence shown when confirming. Refresh the figures if it changed. Refuse a negative bank
withdrawal and require cash left between zero and what is available. In the final transaction save the actual amount left, bank withdrawal, and last movement
included. Movements ordered after this transaction go in the next close, even with an earlier
timestamp. Sales continue throughout.

Fail first in db `drawer-closes.test.ts`. Test a second till resuming the same count, first response
loss, one recount, a recount against the wrong drawer or a non-count entry, a save racing with a
sale, replay and immutable finish. Pin a concrete amount:
starting with 100 counted against 90 expected, a later +30 payment and −5 refund leave 125 available.
Leaving 20 saves a 105 withdrawal, a +10 difference and a next opening balance of 20. The server
`drawer-close-api.test.ts` owns hidden expected cash before count, field refusals, guessed ids and
authority. The db test checks the count-time flag, the stale confirm and a later refund leaving
too little cash. Run both suites, the till route inventories and the clock-stop check. No schema changes.

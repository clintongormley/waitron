# 1. Record each drawer's movements

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After os13. Estimate 440 production and 420 test
lines, plus the core baseline. A system can determine which drawer received or returned cash. Staff
will see the balance in a later slice.

Add one append-only `drawer_entries` table in `packages/db/src/schema/drawer-entries.ts` and a writer in
`packages/db/src/drawer-entries.ts`. Each entry has a printer, sequence allocated in the write
transaction, time, actor, device if present, kind and its facts. Link payment/refund rows by id and
count/recount/finish rows by first count id. Store signed cents and allow each source payment or
refund only once. Use the core classification, migration descriptor and manifest, the generic
immutable backup comparison and existing privacy and change-feed rules. Declare the needed keys and
references in the schema. Rebuild core. Expect only the new table, keys and triggers in the protection
list.

Share one drawer assignment resolver in `apps/server/src/receipt-print.ts`. It requires an undeleted
receipt printer with an attached drawer and the device profile's `open-cash-drawer` capability. It
includes a switched-off assigned printer. Kick eligibility and `refunds.drawer_opened_at` keep their
existing checks. In `bill-payments.ts`, the shared os13 refund
completion, and `invoice-correction-cash.ts`, write the movement with payment/refund completion,
including tips and every cash leg of a correction. Capture card totals for the slip using the same
assignment at completion. Only cash affects the balance. Trace direct tenders, any landed cash-return
route and mirrored tenders before choosing hooks. Record each real movement once. When no drawer
resolves the payment still succeeds. This slice leaves fiscal annulment and card sending alone.

Fail first in db `drawer-entries.test.ts` and `schema/drawer-entries.test.ts` for immutable writes,
signed cents and shared balances. Server `drawer-movements.test.ts` owns assignment changes, switched-off
hardware, no assignment, an assigned device barred from opening and rollback with the money write. Extend `bill-payments.cash-up.test.ts`,
the landed os13 cash refund tests and `invoice-corrections.test.ts` for both refund parents, mirrored
tender exclusion, replay, completed card totals and correction legs that had no kick. Run those files
and the db backup evidence, schema and unchanged fiscal write-path checks.

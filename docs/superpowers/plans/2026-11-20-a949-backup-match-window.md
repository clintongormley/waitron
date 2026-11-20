# A949 standalone SumUp matching window

The owner chose “30 minutes (Recommended)” on 20 November 2026 at 14:28, relayed by the
watcher in Lane F's questions. SumUp comparison should pair the saved €1.50 standalone
charge and its Waitron entry, recorded 10 minutes and 4 seconds apart, while listing
the unmatched €1.40 entry. A charge and entry qualify only when each has exactly one
same-amount candidate from the connected account within 30 minutes either way.

1. In `packages/payments-sumup/src/reconciler.test.ts`, test an unambiguous pair ten minutes
   apart and same-amount alternatives newly inside the tolerance. Include a case where
   a candidate just across midnight has a competitor more than 30 minutes outside the
   audit day. Keep the existing outside-window and payment-row assertions, using a gap
   beyond 30 minutes for the outside case. Put the inclusive boundary in the same table.
   Run `pnpm --filter @waitron/payments-sumup exec vitest run src/reconciler.test.ts`.
2. Give the existing matcher one 30-minute constant in `packages/payments/src/reconcile.ts`
   and export it through `packages/payments/src/index.ts`. Use it in
   `packages/payments-sumup/src/reconciler.ts` for the amount-and-time comparison.
   Read candidates 60 minutes either side of the daily period so a pair straddling midnight
   still sees its competitors. Keep the current report-day and uniqueness rules.
3. Saved backup links also support the refund comparison. Before changing either reader,
   extend the midnight fixtures in `reconciler.test.ts` and
   `apps/server/src/payments-api.test.ts` so the local entry is over five minutes from
   midnight and the saved matching charge belongs to the next audit day. The first checks
   that a later sweep reads the linked charge, and the second checks that a manager's
   passive read still sees the agreement. Use the same 30-minute constant for manual
   backup links in `reconciler.ts` and `apps/server/src/payments-api.ts`. Run both focused
   files, including `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts`.
4. Replay the 19 November audit with the real reconciler in an isolated database using
   the saved rows and SumUp evidence. Require the €1.50 match and the €1.40 unmatched entry.
   Compare the old and new results and save the receipt in Lane F. Preserve the live test
   venue and key. Update `docs/backlog.md` and `docs/backlog/payments.md` with what the replay
   establishes and leave signature qualification open.

Expected change is about 25 added and 15 removed production lines, 40 added and 10 removed
test lines, plus the backlog note and a disposable replay. This uses the existing audit,
storage and dashboard. Payment collection, refund action, and audit scheduling are outside
the slice.

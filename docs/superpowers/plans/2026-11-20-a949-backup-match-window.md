# A949 standalone SumUp matching window

The owner chose “30 minutes (Recommended)” on 20 November 2026 at 14:28, relayed by the
watcher in Lane F's questions. SumUp comparison should pair the saved €1.50 standalone
charge and its Waitron entry, recorded 10 minutes and 4 seconds apart, while listing
the unmatched €1.40 entry. A charge and entry qualify only when each has exactly one
same-amount candidate from the connected account within 30 minutes either way.

1. Test first in `packages/payments-sumup/src/reconciler.test.ts`. Cover a match ten minutes
   apart, exactly 30 minutes, and just outside. Assert `ambiguous` on both sides of a match
   with a new rival inside 30 minutes. Cover both midnight directions: charge 23:50, entry
   00:15, rival charge 00:44; entry 23:55, charge 00:20, rival entry 00:45. Preserve the
   payment-row assertions. Update the query-range assertion from ±10 to ±60 minutes.
2. Export the 30-minute tolerance from `packages/payments/src/reconcile.ts` and
   `packages/payments/src/index.ts`. Apply it in `packages/payments-sumup/src/reconciler.ts`.
   Read known failed attempts, manual entries and SumUp history 60 minutes either side
   of the daily period so candidates across midnight still see their rivals. Keep reporting
   pairs on the charge's day.
3. Extend the existing later-refund fixtures in `reconciler.test.ts` and
   `apps/server/src/payments-api.test.ts`: a 23:40 entry links to a 00:05 charge on the next
   UTC day. Assert that the later sweep reads the linked charge and the manager's passive
   read shows the refund agreement. Use the same tolerance for those day lookups in
   `reconciler.ts` and `payments-api.ts`. Run both changed test files with
   `pnpm --filter @waitron/payments-sumup exec vitest run src/reconciler.test.ts` and
   `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts`.
4. Update the English and Spanish comparison copy in `apps/dashboard/src/i18n/strings.ts`
   and both `apps/server/src/guide/{en,es}/table-service.md` pages. Run the focused
   `src/widgets/backup-audit.test.ts` dashboard file and the server guide checks.
5. Replay the saved 19 November payment rows through the real reconciler in an isolated
   database with the saved SumUp charge evidence. Require the old unmatched list first,
   then the €1.50 match and the separate €1.40 unmatched entry. Save the receipt with
   the input coverage, including whether it is a full history or a projection. Update
   `docs/backlog.md` and `docs/backlog/payments.md` with that result. Preserve the live
   test venue and key. Signature qualification remains open.

The midnight run can finish before a matching entry exists. The watcher needs to settle
whether to include a follow-up sweep through the existing scheduler before this plan is
cleared. The planned window, readers and copy are about 30 added and 20 removed
production lines, 50 added and 15 removed test lines, plus guide and backlog updates
and a disposable replay. The slice uses the existing audit, storage and dashboard.

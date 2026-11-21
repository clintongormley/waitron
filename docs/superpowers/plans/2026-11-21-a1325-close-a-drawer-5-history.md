# 5. Show close history and offer a close before printer deletion

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 4. Estimate 420 production and 340 test
lines. A Sales viewer can find counts and reprint a close. A manager deleting a printer can choose
to empty its drawer first.

Add `apps/server/src/drawer-close-report.ts` and mount its date/drawer list and close reprint in
`report-api.ts`. Use `report.view` and Sales history-node scope. Include pending counts, both counts
and actors, difference and the finished amounts. Resolve names from recorded ids. Reuse PR 4's
document builder for a reprint and check the selected receipt printer, including when the drawer
being reported has since been deleted.

Add `apps/dashboard/src/widgets/drawer-close-history.ts` to `screens/dashboard-sales-screen.ts`.
Reuse the existing passive Sales query controller, client and live-query subscriptions. Keep date
and drawer selection through updates. In `apps/server/src/{printer-delete,print-api}.ts` and
dashboard `widgets/printer-delete-copy.ts`, show the outstanding balance or count and offer Close
first, Delete anyway and Stop. Close first takes the person to the existing assigned till flow.
Delete preserves entries and silences missing-close warnings. A later Add that recognises the same
printer still restores the same id. The proposed result is that its balance resumes with that id.
Clear that choice with the watcher before building. A different id starts at zero.

Fail first in `drawer-close-report.test.ts` for pending/history results, filters, authority and
document reprint. Extend `printer-delete.db.test.ts` and `printer-delete-history.test.ts` for retained
cash and permitted deletion, and run the printer return tests. Dashboard history and accessibility
tests own filters, passive refresh and reprint feedback. Run the delete-copy, Sales and subscription
tests. Update both guides. The database protection list should be equal.

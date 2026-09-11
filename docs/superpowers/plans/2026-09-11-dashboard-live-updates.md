# Dashboard live updates implementation plan

The [design](../specs/2026-09-11-dashboard-live-updates-design.md) makes subscriptions follow displayed
resources. Implement from the shared data boundary outward, with a failing behavioral test before
each feature change.

1. Specify object and collection identities, dependencies and module extension contracts. Inventory
   each dashboard data source, including derived fields and process-local sources.
2. Build the browser event bus and observed resource cache. Test shared consumers, matching,
   collection changes, burst handling, in-flight invalidation, errors and lifecycle cleanup.
3. Prove database change capture against real PostgreSQL: commit, rollback, deployment-role writes,
   replicated changes, reconnects, and absence of business row contents in notifications. Add the
   production adapter only after those experiments determine its behavior.
4. Add authenticated event transport and subscription authorization. Separate automatic refreshes
   from human session activity on both server and browser, with expiry and revocation tests.
5. Connect printers, queues and discovery end to end. Test an agent completion and a separate
   client's enqueue while the dashboard remains open, including preservation of an editing draft.
6. Bind the remaining dashboard views and module screens to observed resources. Preserve their
   existing behavioral assertions. Handle time-based changes separately from database mutations.
7. Run package coverage checks and the repository gate, inspect the complete change for stale
   descriptions of refresh behavior, and update the backlog. Announce readiness for `finish-branch`.

Implementation and the manual repository gate completed on 2026-09-11. The independent run-it
review and its fixes are recorded in the [review decisions](../specs/2026-09-11-dashboard-live-updates-review.md).
The push hook supplies the final affected-package coverage check before PR CI and landing.

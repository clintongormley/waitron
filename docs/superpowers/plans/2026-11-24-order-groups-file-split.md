# Split the Server order-group file

Developers can find group operations by job and use the move on an open branch. This is the
`order-groups.ts` slice of Lane H's 24 November queue. Land it in one PR. Use Server's existing
`node scripts/move-ts-declarations.mjs scripts/order-groups-split.json` workflow. Move functions
whole, keeping their names, signatures, bodies and comments. Point callers at the definitions and
delete the old product file. Keep route, storage and fiscal behaviour as it is.

| Move order under `apps/server/src/` | What goes there |
| --- | --- |
| `order-group-records.ts` | `GroupRelease`, `PartyCommandArgs`, `PartyFireArgs`, `Firer`, group creation and guards, number and revision lookups, emptied groups and group events. |
| `order-group-reads.ts` | `OrderGroup`, group list, current orders and their types, `onShownBill`, counts and reminder reads and calculations. |
| `order-group-reminders.ts` | Snooze and unsnooze, their maximum, and `requireWaitingGroup`. |
| `order-group-hold-paper.ts` | `printHoldTickets` through `correctJoin`, including their inputs and reads. |
| `order-group-submission.ts` | `GroupLine`, submit and place inputs and results, `submitGroups` and `placeGroups`. |
| `order-group-release.ts` | Firing groups and lines, held set-menu checks and releasing held work. |
| `order-group-readiness.ts` | `bumpGroupReady`, `passStep`, `groupLinesOf`. |
| `order-group-edits.ts` | `reorderHeldGroups`, `moveLinesToGroup`, `splitHeldLineIntoUnits`, `isWholeLine`. |
| `order-group-transfer.ts` | Moving and copying groups between parties, the waiting-dish paper lookup and grouping arriving dishes. |

1. Before running the map, remove the star re-export in `testing/group-composition-fixture.ts`.
   Import unwrapped operations and types directly in its five suites. Keep the fixture wrappers for
   submit, place, grouped rounds, move and split so their editor observations and operator setup stay.
   Remove the explicit Vitest import from `order-groups.test.ts`. The Server project provides globals.
2. Move its 258 cases as whole titled blocks into the matching `order-group-*.test.ts` files under
   `src/`. Submission gets destinations and starter courses. Release gets firing, the two orders of
   events and kitchen tickets. Edits gets held edits, stale and retried commands, payment holds, line
   quantities, extras and A884. Transfer gets permanent numbers, bill and party moves, the first
   event's bill and credit. Reads gets summaries and kitchen and pass views. Readiness gets the ready
   and pass commands. Hold paper gets advance HOLD printing. Put every helper used by more than one
   suite in `testing/order-groups.test-support.ts`, including the venue setup and live database binding.
   No suite imports another suite. Retain Vitest file isolation and the two existing smaller suites.
3. Use the tool's byte comparison for bodies and test blocks and its signature and comment check.
   Repoint the namespace spies in `order-drafts.db.test.ts` and `waiting-course-copy.test.ts` at the
   moved functions. Keep `./errors.js` at direct refusal sites in records, reads, reminders,
   submission, release and edits. Check that all nine files fit the size rule, have no import cycle
   among themselves including types, and leave no old Server module import. Remove the retired cap
   and repoint live backlog, guide and source references. Change file-name guards only where they
   already cover a moved operation.
4. Compare case names and repeat counts with `pnpm --filter @waitron/server exec vitest list src/order-group --json=<file>`.
   Run those suites and `till-api.groups`, `till-api.sell-published`, `move-merge`, `pass-release`,
   `bill-editing.station-move`, `current-orders`, `served`, `print-problems`, `split-off-extras.groups`,
   `order-drafts.db` and `waiting-course-copy`. Run Till's `till-app-menu-refresh` and the unchanged fiscal
   `write-path.e2e` and `inmutabilidad` suites, Server typecheck and affected root guards. Replace the
   old entry in `apps/server/test-durations.json` with measured times. Require all Server test shards
   on the current PR head.
5. The same tool kept edited declarations byte for byte on real PR #4238 in the working-order trial.
   Recheck open branches before opening and landing the split PR. If a branch edits a moved
   declaration by then, rehearse the map on a disposable copy of that branch. Lane F's kitchen-print
   split also rewrites imports in the group code. Whichever lands second runs its map on the new main.
6. On landing, send lanes B, C, F and L the map command and the recipe in
   [Carry an open branch across the split](2026-11-24-working-order-file-split.md#carry-an-open-branch-across-the-split).
   Substitute `order-groups.ts`, `order-groups.test.ts` and `scripts/order-groups-split.json` for
   the corresponding working-order paths. The `jq '.moves |= .[:1]'` command moves product code
   only. Move edits to test cases by hand using the map.

Expect about 2,900 product and 6,300 test or fixture lines to move, plus 700–1,000 changed import
lines and around 150 map and duration lines. The existing tests retain their assertions. The till
mount and bill-payments split each have their own plan.

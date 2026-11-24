# Split the Server order-group file

Developers can find group operations by job and carry an open branch across the move. This is the
`order-groups.ts` slice of Lane H's 24 November file split. Land the split in one PR using
`node scripts/move-ts-declarations.mjs scripts/order-groups-split.json`. Keep the work in Server.
Move functions whole, with their names, signatures, bodies and comments intact. Point callers at
the definitions and delete the old product file. Keep route, storage and fiscal behaviour as it is.

| Move order under `apps/server/src/` | What goes there |
| --- | --- |
| `order-group-types.ts` | `GroupRelease`, `GroupLine`, `SubmitGroupsInput`, `PartyCommandArgs`, `PartyFireArgs`, `Firer`, `OrderGroup`, `SubmittedGroups`. |
| `order-group-records.ts` | `startGroup`, `startGroupAfter`, `nextFireKind`, `removeEmptiedHeldGroups`, `requireOperator`, `requireHeldGroup`, `requireGroup`, `lastPosition`, `nextGroupNumber`, `readGroupNumberLabels`, `groupNumberIdentity`, `currentRevision`, `recordGroupEvent`. |
| `order-group-reads.ts` | Group list, current orders and their types, `onShownBill`, counts, and reminder reads and calculations. |
| `order-group-reminders.ts` | Snooze and unsnooze, their maximum, and `requireWaitingGroup`. |
| `order-group-hold-paper.ts` | `printHoldTickets` through `correctJoin`, including their inputs and reads. |
| `order-group-submission.ts` | `submitGroups`, `PlaceGroupsInput`, `placeGroups`. |
| `order-group-release.ts` | `fireGroup`, `fireHeldLine`, `judgeHeldSetMenuDishes`, `activeGroupLines`, `releaseHeldWorkOf`, `releaseGroup`. |
| `order-group-readiness.ts` | `bumpGroupReady`, `passStep`, `groupLinesOf`. |
| `order-group-edits.ts` | `reorderHeldGroups`, `moveLinesToGroup`, `splitHeldLineIntoUnits`, `isWholeLine`. |
| `order-group-transfer.ts` | Moving and copying groups between parties, the waiting-dish paper lookup, and grouping arriving dishes. |

- Use the script's byte comparison for bodies and test blocks and its signature and comment check.
  Correct generated imports if needed, and keep `./errors.js` where an entry point needs the
  registered refusals. Check that no old Server module import survives and that the ten pieces
  have no import cycle among themselves, including type imports. Remove the old entry from
  `scripts/product-file-size-limits.json` and repoint live guide and backlog references. Update
  file-name guards only for the operations they already track.
- Move the 258 cases in `order-groups.test.ts` as whole titled blocks. Keep shared venue setup,
  database bindings and common helpers in `testing/order-groups.test-support.ts` with Vitest
  file isolation and one `useVenueDb` per suite instance. Group the cases under
  `order-groups.submission.test.ts` (destinations and courses),
  `order-groups.release.test.ts` (firing, kitchen tickets and device release),
  `order-groups.edits.test.ts` (holds, stale and retried edits, payment holds, quantities and modifiers),
  `order-groups.transfer.test.ts` (party and bill moves, split and merge),
  `order-groups.reads.test.ts` (summaries, kitchen and pass views),
  `order-groups.readiness.test.ts` (ready and pass commands), and
  `order-groups.hold-paper.test.ts` (advance HOLD printing). Keep the helper groups with their use
  where possible, and preserve both the existing fire-now-course and request-kind suites.
- Compare the discovered case names and repeat counts before and after with
  `pnpm --filter @waitron/server exec vitest list src/order-groups --json=<file>`. Run those suites,
  Server `till-api.groups.test.ts`, `till-api.sell-published.test.ts`, `move-merge.test.ts`,
  `pass-release.test.ts`, `bill-editing.station-move.test.ts`, and Till `till-app-menu-refresh.test.ts`.
  Run the unchanged fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts`, Server typecheck,
  and the applicable root guards. Remove the retired duration entry and record measured durations
  for the replacement suites in `apps/server/test-durations.json`. Require the current PR head's
  selected CI suites before landing.
- Rehearse the same map in a disposable copy of the open give-back branch, PR #4257 at
  `2ce0ee32c2330ce7292d5cb5fafbbe4bbd0309c1`, which edits the importing `till-api.ts`.
  Use the working-order plan's pair of disposable base and branch trees with this map. Confirm the
  two give-back route changes survive the move and Server typecheck passes. If the PR lands first,
  use an open branch that still changes an importer. List the current overlaps in the split PR.

Expect about 2,900 product and 6,300 test or fixture lines to move, plus up to 350 import lines and
150 map and duration lines. No new behaviour tests are needed for a move with the original
assertions intact. The till mount and bill-payments split each have their own plan.

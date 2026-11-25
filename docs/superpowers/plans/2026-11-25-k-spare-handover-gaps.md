# Recover a placed handover copy and reduce preparation growth

A spare killed after swapping in the accepted copy can retry its normal start when `accepted.db`
is gone if the live file proves it is that copy. New preparation writes save one entry at a time,
so many more setup attempts fit and the spare can still choose a fresh minute and take over.
The two requests are in the [replication backlog](../../backlog/replication-cloud.md), under the
spare wait loop and series and module-preparation bundles.

## Recognize the placed copy

- In `apps/server/src/handover-place-copy.ts`, reuse the held folder lock, stored signed size and
  SHA-256, and existing `copy_placed` path and folder flush. Only with `accepted.db` absent
  (ENOENT), try header recognition before the moved-on chart check. Require SQLite write-ahead
  versions 2/2 and equal counters of at least 2. In memory, put back versions 1/1 and subtract one
  from each counter, then hash that header and stream the rest of the file. Require the exact
  signed size and hash. A nonempty WAL or rollback journal bars this fallback. Entry's earlier
  schema check may recover a WAL before placement, so the hash must cover the resulting file.
  Header fields: [SQLite database format](https://www.sqlite.org/fileformat.html#the_database_header).
- `boot.place-copy.test.ts` and `testing/place-copy-boot-kill.ts` kill the production entry after
  swapping and after opening the copy, then remove `accepted.db` and retry. Both currently refuse.
  Assert one placement event and the accepted database in use, including a copy whose own chart
  names a successor. A committed same-size change in the WAL must still refuse and retain the data.
  Remove probe logging. In `handover-place-copy.test.ts`, split the opened-copy and wrong-file
  assertions. Test a WAL with committed frames and a nonempty journal directly at placement, with
  unchanged main bytes, and prove each protection once by removing it in a disposable checkout.
- If the full hash cannot be verified, including across SQLite versions that rewrite the writer
  version field, the box stays stopped. Test that version mismatch. The recovery page offers
  “Retry a normal boot” after someone restores the exact `accepted.db`. Its source is the old box's
  `handover/<operation>/venue.db`, if it is still available there.

## Save each new preparation entry once

- In `packages/fiscal-verifactu/src/hour-selection.ts`, write only the new wait or intent, or the
  refreshed intent when the boot reading changes. In `hour-dormant-standby.ts`, write only the new
  dormant entry. The existing readers already combine revisions and check for contradictions.
  Keep the references saved with each intent, the existing read order, formats and size limits.
- `apps/server/src/handover-minute-history.test.ts` makes 45 real setup attempts, checks the merge
  fits, transfers the revisions and promotes after waiting past the last selected minute. The old
  writes fail with `setup.attempt_invalid`. Run the existing selection, preparation, resumption and
  dormant suites. In `hour-selection.test.ts`, check the wait and intent assertions across writes.
  Give fixtures that span events the same history the real host gives them. Replace stale size
  claims there and in `packages/provisioning/src/module-preparation-state.ts`.
- Update `docs/backlog.md` and `docs/backlog/replication-cloud.md`. Remove the placed-copy issue and
  record its version limit. Narrow the preparation issue to the remaining growth from intent
  references, existing cumulative files and the estimated reserve. The cap can still be reached.

No new table, record type or wire field. Chart answers, series allocation and raising the cap stay
outside this change. Estimate about 75 added production lines and 185 test and test support lines.
Run the two server files, placement controls and touched fiscal suites, plus the unedited fiscal
`write-path.e2e.test.ts` and `inmutabilidad.test.ts` before finish-branch.

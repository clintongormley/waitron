# Recover a placed handover copy and bound preparation growth

A spare that was killed after putting the accepted copy in place can retry its normal start even if
`accepted.db` is gone, provided the live file proves it is that copy. Successive setup attempts save
only their own preparation entries, so the spare can still choose a fresh minute and take over.
The two requests are in the [replication backlog](../../backlog/replication-cloud.md), under the
spare wait loop and series and module-preparation bundles.

## Recognize the placed copy

- In `apps/server/src/handover-place-copy.ts`, reuse the held folder lock, stored signed size and
  SHA-256, and existing `copy_placed` path. If the kept copy is missing, also try the one change the
  real failed starts reproduced: SQLite switching the file to write-ahead mode. Hash an in-memory
  copy of the header with the read/write versions restored from 2 to 1 and the two equal counters
  restored from 2 to 1, then stream every remaining byte into the same digest. Require the signed
  size and hash to match exactly. Refuse this recognition while a nonempty WAL or rollback journal
  is present. The production entry's earlier schema check may already have recovered a WAL, in
  which case the full hash must cover the resulting file. No file is rewritten to test a match.
  Header fields: [SQLite database format](https://www.sqlite.org/fileformat.html#the_database_header).
- `boot.place-copy.test.ts` and `testing/place-copy-boot-kill.ts` use the real production entry and
  kill it after the swap and after opening the swapped file, then remove `accepted.db` and retry.
  Both currently fail with `handover.accepted_copy_missing`. Assert one placement event and the
  accepted database in use. A killed start with committed WAL frames must still refuse and retain
  the changed data. Keep the same-size wrong-file control in `handover-place-copy.test.ts`.
  If the file cannot be proved, the box stays stopped. The recovery page offers a normal retry
  after the original `accepted.db` is put back.

## Save each preparation entry once

- In `packages/fiscal-verifactu/src/hour-selection.ts`, write the new wait or intent alone, and on
  clock-reading refresh write only the refreshed intent. Read the saved revisions in order so the
  latest refresh wins and resumptions still follow their original intent. In `hour-dormant-standby.ts`,
  append only the new dormant entry. Reuse the readers that already combine saved revisions and
  check for contradictions. Keep the file format, merge limits and signed handover payload shape.
- `apps/server/src/handover-minute-history.test.ts` makes 45 real setup attempts, transfers their
  revisions and promotes after waiting past the last selected minute. The writes currently fail
  with `setup.attempt_invalid`. Run the existing selection, preparation, resumption and dormant
  suites for replay, refreshed clock readings, contradiction checks and earlier reservations.
  Where a fixture kept only the latest revision, make it append history like the real host.
  Update the merge-room explanation in `packages/provisioning/src/module-preparation-state.ts`
  and remove the fixed backlog points from `docs/backlog.md` and `docs/backlog/replication-cloud.md`.

No new table, record type or wire field. Chart answers, series allocation and raising the cap
stay outside this change. Estimate about 75 added production lines and 135 test and test support
lines. Run the two server files, placement controls and touched fiscal suites, plus the unedited
fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts` before finish-branch.

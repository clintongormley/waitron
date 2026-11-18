# Check larger backups within the verifier’s memory budget

**Goal**

Cloud’s backup verifier can finish checking an encrypted backup of about 370 MB within its current 1 GiB memory, 16 GiB scratch and time limits. It still refuses any changed captured row and checks every installed owner. A verifier pass carries no recovery or trading authority.

## What we measured

Cloud [PR #1289](https://github.com/waitron-io/waitron-cloud/pull/1289) reports one container out-of-memory event on a 269,004,474-byte encrypted capture. On `node:26-slim` (Node 26.13.1, SQLite 3.54.1, STAT4 off), the current Waitron comparator on two 372,989,952-byte SQLite files with synthetic print payloads did a full temporary sort. It finished in 36.95 seconds, reached the container’s 1 GiB ceiling and reported 380,292 KiB peak process memory. An independent SQL control moved the indexed `id` to the front and kept all sort terms. It used the existing primary-key index and streamed both files in 0.37 seconds with 156,820 KiB peak process memory. This isolates the sort cost. Cloud’s reported refusal was on an encrypted archive through the full verifier.

## Build and verify

1. In `packages/db/src/backup-evidence.test.ts`, add a real SQLite case with the shape of `print_jobs`: primary-key `id`, an earlier alphabetic column shared across rows, and different BLOB payloads. Use the SQL executed by `compareBackupTables` and SQLite’s `EXPLAIN QUERY PLAN` to check that the comparison can read in index order without a full temporary sort. Run the case first and see the full-sort assertion fail. Check equal copies in a different insertion order and refuse a same-length BLOB change. Keep the existing duplicate, collation, type, cleanup and additive-default tests.
2. In `packages/db/src/backup-evidence.ts`, put the existing `id` column first in the comparison order when present. Keep every original ordering term and both row streams, value checks, added-column checks, and iterator cleanup. The `print_jobs` primary-key index can supply that order. Tables without a suitable index still compare complete ordered rows. No new indexes, migration, verifier authority or Cloud limit changes.
3. Run the DB comparison suite, `apps/server/src/backup-verification.installed.test.ts`, and the unchanged fiscal golden and immutability suites. Use Lane G’s disposable guest or an isolated bench to run the same genuine ~370 MB encrypted capture through the installed verifier before and after the change with Cloud’s limits. Record the baseline verdict, container exit/OOM, peak memory and scratch, elapsed time, candidate verdict and scratch cleanup. Expect the unmodified verifier to refuse or hit the resource ceiling and the candidate to pass. If the full baseline and comparator probe identify different bottlenecks, report that evidence before expanding the change. Update the existing year-sized qualification entry in `docs/backlog.md` and `docs/backlog/setup.md` with the work that remains. Send Lane G the landed revision and measured result.

Expected size is under 10 production lines, about 35–55 regression-test lines, and a short backlog update. Run the large qualification outside routine CI.

# Check larger backups within the verifier’s memory budget

**Goal**

Cloud’s backup verifier can finish checking an encrypted backup of about 370 MB within its current 1 GiB memory, 16 GiB scratch and time limits. It still refuses any changed captured row and checks every installed owner. A verifier pass carries no recovery or trading authority.

## What we measured

Cloud [PR #1289](https://github.com/waitron-io/waitron-cloud/pull/1289) reports `backup.verifier_resource` and one container out-of-memory event on a 269,004,474-byte encrypted capture. On `node:26-slim` (Node 26.13.1, SQLite 3.54.1, STAT4 off), the current Waitron comparator on two 372,989,952-byte SQLite files with synthetic print payloads did a full temporary sort. It finished in 36.95 seconds, reached the container’s 1 GiB ceiling and reported 380,292 KiB peak process memory. An independent SQL control moved the indexed `id` to the front and kept all sort terms. It used the existing primary-key index and streamed both files in 0.37 seconds with 156,820 KiB peak process memory. This measures the sort cost on the synthetic table. It does not locate Cloud’s failure in the full verifier.

## Build and verify

1. First run the unmodified installed verifier on a disposable, genuine ~370 MB encrypted capture with Cloud’s disk-backed scratch, `TMPDIR` and resource limits. Expect `backup.verifier_resource` / `resource_limit` if it runs out of memory. Record the exact result, last stage and owner entered, container exit/OOM, peak memory and scratch, and phase times. Use `dbstat` and the plan for the failing owner’s largest table to check where it sorts. Proceed with the steps below when the baseline points to the table comparison. Bring a different bottleneck back to the watcher with the measurement.
2. In `packages/db/src/backup-evidence.test.ts`, add a real SQLite case with `print_jobs`’ shape: primary-key `id`, an earlier alphabetic column shared across rows, and different BLOB payloads. Wrap the read-only queries to run `EXPLAIN QUERY PLAN` on the SQL actually used by `compareBackupTables`. Check that it reads in index order without a full temporary sort. Run the case first and see the full-sort assertion fail. Check equal copies in a different insertion order and refuse a same-length BLOB change. Keep the existing duplicate, collation, type, cleanup and additive-default tests.
3. In `packages/db/src/backup-evidence.ts`, move `id COLLATE BINARY` and then `hex(id) COLLATE BINARY` before the other original ordering terms when `id` is present. Keep both row streams, all value and added-column checks, and iterator cleanup. Tables without a suitable index still compare complete ordered rows. This uses the `print_jobs` primary-key index with no schema, verifier authority or Cloud limit changes.
4. Run the DB comparison suite, `apps/server/src/backup-verification.installed.test.ts`, and the unchanged fiscal golden and immutability suites. Run the same encrypted capture through the candidate installed verifier and record the same resource measures and a passing verdict with empty scratch after cleanup. Update the existing year-sized qualification entry in `docs/backlog.md` and `docs/backlog/setup.md` with the work that remains. Send Lane G the landed revision and measured result.

Expected size is under 10 production lines, about 35–55 regression-test lines, and a short backlog update. Run the large qualification outside routine CI.

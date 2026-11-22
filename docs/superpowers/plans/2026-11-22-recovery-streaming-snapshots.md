# Stream first-setup repair snapshots

A box can check its database and write-ahead log (WAL) during first-setup repair without holding either file in memory. Keep the 128 MiB limit per file, the exact-byte SHA-256 digests and the inspection ID used to reject a stale repair request.

Lane K Codex wrote this plan for the watcher's 2026-11-22 18:20 assignment in Lane K's queue under RECOVERY-STREAMING-SNAPSHOTS: “check and copy the database and WAL without holding whole files in memory, keeping A1334's size limit and exact-content check.”

## Check the database files in chunks

- Extract the open-handle hashing loop from `packages/provisioning/src/first-setup-start-again-deletion.ts` into a private sibling helper. The deletion marker keeps its existing unlimited read and error handling. For an inspection, cap the stream at 128 MiB plus one byte and count bytes to catch growth after the initial size check. In `first-setup-resolution-inspection.ts`, hash from the same no-follow, nonblocking handle that passed the regular-file check. Close it explicitly. Take fingerprints after SQLite closes.
- Skip the database and WAL in the buffered `originals` list. Capture still verifies both files using its opening and closing inspections. Make the closing pass fail on a database or WAL read error, including `setup.not_ready` with `too-large` above the cap. This keeps an unreadable file from matching itself. Missing files still compare through the inspection ID. Keep both per-file and closing comparisons for setup records and delivery evidence, whose bytes are used.
- In `apps/server/src/first-setup-unused-assignment.ts`, remove the two paths from the allowlist of buffered evidence. The existing `venue-private-copy.ts` already streams the files to scratch when SQLite cannot read in place. Keep that copy, the venue lock, the full-disk handling and deletion and set-aside rules.

## Prove it through the existing callers

- Add the failing case in `packages/provisioning/src/first-setup-resolution-snapshot.test.ts`. For both files, forbid whole-file reads, compare digests against the original bytes and check that the snapshot retains neither file's bytes. Refuse a same-size change between the inspections with `setup.attempt_conflict`. Keep the existing over-limit case and add growth after the initial size check.
- In `apps/server/src/first-setup-start-again-hour.test.ts`, compare whole snapshots in refusal cases to keep checking unchanged database and WAL digests as well as the buffered evidence. Run Provisioning's inspection, snapshot and deletion suites, plus Server's inspection, recovery-delivery, hour, held-database and held-journal suites. Run Fiscal VeriFactu's `write-path.e2e.test.ts` and `inmutabilidad.test.ts` unedited.
- Close the first-setup snapshot entry in `docs/backlog.md` and `docs/backlog/setup.md`. Keep the separate archive and configuration buffer work under a title that names those transfers. Update both recovery-snapshot references in `docs/developers/conventions-data.md`. A1159 remains separate.

Expected size is about 60–90 production lines and 85–140 test lines, plus plan and backlog edits.

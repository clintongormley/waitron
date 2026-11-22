# Stream first-setup repair snapshots

A box can inspect and verify its database and write-ahead log (WAL) during first-setup repair using bounded memory. Keep the 128 MiB limit for each file and the SHA-256 comparison of its exact bytes, including the final inspection check before a snapshot is accepted.

## Check the database files in chunks

- In `packages/provisioning/src/first-setup-resolution-inspection.ts`, use one bounded reader for the database and WAL during both inspection and capture. Read from the same no-follow, nonblocking file handle that passed the regular-file check. Keep the size check at open and bound the stream to at most 128 MiB plus one byte so a file that grows during the read is also refused. Keep the existing digest, missing-file handling and refusal codes. Take the initial fingerprints after SQLite closes.
- Keep capturing bytes for setup records and delivery evidence. The two production consumers read those bytes and never read the database or WAL buffers. Verify those two files again at capture and keep their digests in the inspection returned with the snapshot. Leave the SQLite holdings copy in `apps/server/src/venue-private-copy.ts`: it already streams the database and side files to scratch when a read in place is unavailable. No extra copy is needed for the fingerprint check.
- In `apps/server/src/first-setup-unused-assignment.ts`, remove database and WAL paths from the list of allowed buffered evidence. Keep the repair decisions, venue lock and coordinator, disk-full path and deletion and set-aside rules as they are.

## Prove it through the existing callers

- In `packages/provisioning/src/first-setup-resolution-inspection.test.ts`, first add a case that forbids whole-file reads of both the database and WAL and checks the SHA-256 fingerprints against their original bytes. Run it before implementing and expect a failure on a whole-file read. Add a same-size change between inspection and capture that is refused with `setup.attempt_conflict`, and cover reading past the size limit when the file grows after the initial file check. Keep the existing over-limit and missing-file tests.
- In `apps/server/src/first-setup-start-again-hour.test.ts`, compare the whole verified snapshot in the refusal cases so unchanged evidence still means the same buffered bytes and the same database and WAL digests. Run the focused Provisioning inspection suite and the Server hour and held-journal repair suites. Run the existing fiscal checks unedited because these repair paths can inspect setups with fiscal records.
- Remove the completed part of the entry in `docs/backlog.md` and `docs/backlog/setup.md` and update the pointer in `docs/developers/conventions-data.md`. The unused archive-preparation upload, emergency handover, configuration imports and A1159 remain separate.

Expected size is about 60–100 production lines and 100–155 test lines, plus the plan and backlog edits.

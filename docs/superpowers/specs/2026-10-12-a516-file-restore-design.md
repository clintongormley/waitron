# A516: restore large copies from files

Restore bucket copies over 2 GiB without one database-sized buffer; scheduled local archives must
also be created and restored without that limit. Choices below are **driver defaults** for inline execution.

## Scope and receipts

- Lane E `queue.md` A516 names `restore.ts`, `restore-stream.ts` and `backup-sweep.ts`; the exact
  backlog title is “A copy over 2 GiB cannot be restored” (`docs/backlog.md:4117`,
  `docs/backlog/box.md:327`). Include the scheduled archive pipeline in this branch.
- Read-only findings on base `46c7befe9`, not runtime verification: bucket CLI reads the downloaded file whole at
  `apps/server/src/restore-stream.ts:377`; setup validation does so at `restore-request.ts:113`;
  staged boot does so at `restore-request.ts:196`. Placement takes bytes at `restore.ts:337`.
- Archive liveness writes a second database copy at `restore-stream.ts:169`. Scheduled capture
  reads the dump, concatenates WBA1 and encrypts into buffers at `backup-sweep.ts:112`,
  `backup-archive.ts:16`, `artifact-cipher.ts:44`. Local storage/get and CLI artifact input also
  buffer the whole artifact (`local-fs-backend.ts:18`, `:22`; `restore-command.ts:78`).
- Managed Cloud is separate: `cloud-snapshot-archive.ts:34`, `cloud-backup-upload.ts:31` and
  `cloud-recovery.ts:16` impose 512 MiB; `/setup-api/restore` has a 256 MiB upload limit
  (`setup-api.ts:177`, `:1025`). Raising these limits or streaming their HTTP workflows needs a
  separate follow-up. A516 changes neither limit and makes no large-Cloud/upload claim.

## File placement contract

- `restoreDatabase` takes `databasePath: string`, `venueDir`, `log` and its filesystem seam; it consumes an owned, closed staging file and never accepts bytes.
- Before removing stale incoming content, reject missing/nonregular/symlink sources and aliases
  to target, incoming, sidecars, `node.db`, venue/migration locks, metadata or set-aside folders.
  Compare canonical parent paths and existing device/inode identities; reject multiply linked sources.
  Use `restore.unsafe_entry_path` with `name: "db.dump"`. Owned staging parents are private;
  this does not promise protection against a privileged process replacing paths concurrently.
- Capture source size for logging and set mode 0600 before transfer. Rename to `venue.db.incoming`.
  Only `EXDEV` permits `copyFile` fallback into a fresh incoming file; complete copy and mode 0600
  before touching the old set. On EXDEV the original stays caller-owned until cleanup.
- Then retain the existing Litestream metadata removal, sidecar move, reverse rollback, error
  classification and aside cleanup. The old main file returns last. `node.db` and locks stay put.
  Every preparation failure leaves the old database/sidecars intact and removes partial incoming.
- `writeValidated` keeps the venue lock through placement, migration, hooks and secrets. Scratch
  validation may write private files; it must not replace database, identity or secrets destinations.

## Validation and ownership

- Keep non-DB `ArchiveEntry = { name, bytes }`; new archive I/O uses an explicit bytes/file union, never optional bytes plus path.
- `ValidatedArtifact` holds `manifest`, `databasePath`, `secretEntries`, `discard(): Promise<void>`.
  Byte archive validation writes `db.dump` once as private scratch `venue.db`; file archive
  validation extracts it once there. Source-live checks open that same directory and close it
  before placement; they neither copy nor discard it.
- Keep `validateEntries` for byte callers. Add `validateDatabaseEntries(entries, databasePath,
  deps)` for prepared/staged bucket copies, sharing the same manifest, name and identity checks.
  Borrowed-file validation never deletes its input; prepared download or staged request owns it.
- Preserve missing manifest/dump, compatibility, unexpected-entry, traversal/duplicate and identity
  refusal precedence. Sealed entries containing another `db.dump` still fail as duplicate input.
- Archive validation owns its fresh 0700 directory, 0600 payloads and intermediate plaintext spool.
  It cleans failures internally; successful callers use `discard` in `finally`, including setup
  preflight, CLI, fixture scripts and direct `writeValidated` consumers. Disposal is idempotent and
  cannot remove the placed destination after its source was moved. Borrowed disposal is a no-op.
  Crash-leftover sweeping remains the adjacent backlog item, not a claim of this cleanup contract.
- `restoreFromStream`, `stageStreamRestore` and `runStagedRestore` pass paths throughout. Preserve
  marker-last staging, confirmation/source checks, refusal cleanup and lock-busy retry retention.

## Bounded archive pipeline

- Stream WBA1 entry framing into WBK1 encryption, once per sweep, to a protected artifact file.
  Preserve entry order, u32/u64 little-endian lengths and WBK1's version, KDF, salt, IV and AAD.
  WBK1 stores its GCM tag before ciphertext: reserve the tag field, write ciphertext with bounded
  chunks, finalize and patch the tag before releasing the completed file to any backend.
- Driver defaults: 64 KiB bulk chunks; file-format limits of 4096 entries, 4096 UTF-8 name bytes,
  16 MiB aggregate non-DB payload. Check lengths/counts before allocation. Bound collection of
  scheduled state files before reading them, including growth during reads, so these limits also
  bound creation. Oversize WBA input uses `backup.archive_invalid`; inspect registry siblings for
  reason wording. These explicit metadata limits do not cap `db.dump`.
- Storage takes a completed file, copies to a protected destination-local temporary, then renames
  atomically. Each destination opens its own input; all receive identical ciphertext. Keep current
  outcome, pruning and scheduling behavior. File reads copy/stream to caller-owned scratch.
- CLI/staged archive restore decrypts in chunks into a private WBA spool. Complete GCM verification
  before parsing/validation; remove unauthenticated plaintext on failure. Unpack with checked
  offsets into the one database staging file plus bounded byte metadata; delete the spool promptly.
  Retain existing WBA trailing-byte behavior and decrypt/refusal mapping. No placement on tampering.
- Retain synchronous byte codecs for sealed state/configuration/limited Cloud paths. Small old/new
  codec cross-opening tests must establish the same WBA1/WBK1 format, not just self-roundtrips.

## Invariants and acceptance

- Do not change `runRestoreHooks`, fiscal hooks, hash/number allocation or `restoreFiscal`.
  The chain is composition's `FISCAL_RESTORE` → `packages/fiscal-verifactu/src/restore.ts:55`;
  orchestration remains `restore.ts:606`. Preserve migration-before-hook and transaction assertions.
- Preserve all behavioral assertions. Allowed interface changes: database bytes → source files,
  `dumpEntry.bytes` → reading/inspecting the owned path, file-backed backend calls and explicit
  disposal. Fiscal suites change only fixture/input shape and cleanup, never expected fiscal facts.
- A sparse file of `2 ** 31 + 4096` bytes exercises placement and size/edge-content assertions
  without whole-file reads. Real migrated SQLite snapshots exercise stream/setup/request/liveness
  chains; sparse placeholders must never masquerade as valid SQLite databases.
- Test beside restore/stream/sweep/request/codecs/backend. Do not edit `boot*.test.ts` or Lane A's
  A528 harness. Read source only where boot wiring must acquire disposal.
- Cover EXDEV copy/mode failure, rollback, aliases, cleanup, authentication, malformed lengths,
  no partial backend publication, bucket confirmations and lock-busy staged retention.
  No implementation or tests were run by this planning turn. No unresolved owner decisions.

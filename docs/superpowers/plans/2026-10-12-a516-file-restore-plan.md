# A516 file restore implementation plan

Implementation pointer, 2026-10-17: `artifact-cipher.test.ts` and `backup-archive.test.ts` now
live in `packages/provisioning/src/`, alongside the shared services. Run those two suites with
`pnpm --filter @waitron/provisioning exec vitest run src/artifact-cipher.test.ts src/backup-archive.test.ts`.
The completed steps below retain their original paths as historical receipts.

> **For agentic workers:** use `superpowers:executing-plans` for owner-authorized inline execution.
> Parent handles the fresh-context design check; this planner writes documentation only.

**Goal:** restore bucket databases over 2 GiB and create/store/restore scheduled local archives without database-sized buffers.
**Architecture:** transfer owned files through protected incoming placement with shared validation/cleanup; add file codecs beside byte codecs and integrate end to end.
**Tech stack:** existing Node fs/streams/crypto, SQLite/Drizzle, Vitest; no new dependency.
**Spec:** `docs/superpowers/specs/2026-10-12-a516-file-restore-design.md`.

## Global constraints

- Work only in this registered worktree. Whole numbered tasks in order; each ends
  with its focused checks and a signed-off commit. No PR/publication until all four tasks pass.
- Before any test or implementation code, read `superpowers:test-driven-development/SKILL.md`.
  For each behavioral change, write the test, observe the intended failure, implement, rerun.
- Read CLAUDE.md and the data/testing/writing/workflow topics. No fiscal implementation edits,
  migrations, campaign-file commits, test exclusions or reduced thresholds. Boot test changes wait
  for A528 to land; its setup split now permits the post-review cleanup qualification below.
- Keep all assertions except the spec's explicit interface adaptations. Keep lock/recovery rules;
  any recovery-state change uses `updateRecoveryState`. Do not unlink lock files.
- Driver defaults: 64 KiB bulk chunks, 4096 entries, 4096 name bytes, 16 MiB aggregate non-DB
  payload. Preserve WBA1/WBK1 framing/authentication; keep Cloud 512 MiB/setup-upload 256 MiB limits.
- Package verification commands below run under `pnpm --filter @waitron/server`; expect a nonzero
  Tests count with every selected case passing, not an exit code alone. Use bounded runs/logs.

## Review focus

- Source alias or nonregular file must fail before incoming cleanup (Task 1).
- Cross-filesystem transfer or chmod failure must preserve the previous main/sidecars (Task 1).
- Lock-busy staged restore must retain its file for retry (Task 2).
- Tampered/truncated/unbounded archive must publish/place nothing and clean scratch (Tasks 3–4).
- One failed fan-out destination must not invalidate another's stored copy (Task 4).

## Task 1: owned database validation and file placement

**Files:** modify `apps/server/src/{restore.ts,restore-stream.ts,restore-request.ts,boot.ts}`; update tests
`restore.test.ts`, `restore-stream.test.ts`, `restore-request.test.ts`, `restore-command.test.ts`, `restore-fiscal-e2e.test.ts`, `restore-fiscal-receipt.test.ts`; adapt `apps/server/scripts/{cloud-backup-fixture.ts,cloud-recovery-client-fixture.ts}`.
**Interfaces:** `restoreDatabase({databasePath:string,venueDir:string,log:Logger,fs?:PlacementFs}):Promise<string>`;
`ValidatedArtifact={manifest,databasePath,secretEntries,discard():Promise<void>}`;
`validateDatabaseEntries(entries:readonly ArchiveEntry[],databasePath:string,deps:EntryValidationDeps):Promise<ValidatedArtifact>`.
Retain byte `validateEntries`/`validateArtifact`; shared validation materializes only byte DB input.

- [x] Add source fixtures and failing placement cases: sparse `2 ** 31 + 4096` file, size/edge
  content/mode/source-consumption checks; symlink/directory/missing input; target/incoming/sidecar/
  node/lock aliases and multiply linked sources, including unrelated second names. Seed stale incoming to prove alias refusal precedes
  its removal. Sparse tests never allocate/read the entire file.
- [x] Add injected EXDEV then real `copyFile` cases, source retention, copy/chmod failures and
  existing rollback cases. Assert old main/WAL/SHM contents, incoming cleanup and log size.
  Run `test -- src/restore.test.ts`; observe failures before production edits.
- [x] Implement regular-file and alias preflight before cleanup; size/mode capture; rename to
  incoming, EXDEV-only copy fallback; extend `PlacementFs` with copy/chmod failure injection.
  Keep old-set movement, reverse rollback and error/log classifications.
- [x] Add failing validation/liveness tests: one private DB materialization, liveness reads the
  same file, no `archive-source-check-*` copy, cleanup after validation/source refusal and after
  successful placement, idempotent disposal. Use the real `useVenueDb` fixture; run these cases red.
- [x] Implement shared checks and borrowed-path validation, and replace `dumpEntry` with owned
  path/disposal. In `restoreFromArtifact` dispose in `finally`; source-live opens/closes its owned
  directory. Boot's archive preflight and every fixture/direct validation caller also dispose.
  Dispose byte validation in stream writing and staged preflight too; update “write-free” prose.
- [x] Adapt existing byte fixtures to private source files and inspect their contents when needed.
  Change only interface assertions/cleanup in fiscal tests; preserve every hook/ledger expectation.
  Run `test -- src/restore.test.ts src/restore-stream.test.ts src/restore-command.test.ts src/restore-fiscal-e2e.test.ts src/restore-fiscal-receipt.test.ts`, then `typecheck`.
- [x] Inspect the diff for fiscal/boot-test changes and sign off the complete Task 1 commit.

### Task 1 qualification, 2026-10-12

Signed implementation `785dca03c246145a30505b7085c5c41e958df092` passed the eleven selected server
suites (302 tests), four root guards (61 tests), server types, changed-file lint/format and the
unedited fiscal golden/immutability pair (20 tests). In an independent installed clone, deleting
source protection failed 11 cases, deleting rollback failed one, deleting validation disposal failed
one, and deleting duplicate-entry protection failed one. Restoring each passed; the source control
also passed the unrelated-hard-link case. These results cover Task 1, not the remaining bucket
whole-file reads or archive pipeline. The branch stays unpublished until Tasks 2–4 pass.

## Task 2: bucket CLI, setup stage and staged entry remain file-based

**Files:** modify `apps/server/src/{restore-stream.ts,restore-request.ts}`; tests `restore-stream.test.ts`, `restore-request.test.ts`, `restore-command.test.ts`.
**Interfaces:** `WriteStreamArgs.databasePath:string` replaces `databaseBytes`; `writeStreamRestore(args:WriteStreamArgs):Promise<void>` uses Task 1's borrowed validation.
`PreparedStream.discard` and staged-request cleanup remain the original file owners.

- [x] Add failing cases for all three whole-file reads: real SQLite fixture with targeted DB
  `readFile` interception that throws, allowing small marker/entries/secrets reads. Drive the
  actual CLI restore, `stageStreamRestore`, and default `runStagedRestore`/placement, not only fakes.
  Assert rows/secrets/marker source, confirmation refusals and input/scratch cleanup.
- [x] Run `test -- src/restore-stream.test.ts src/restore-request.test.ts src/restore-command.test.ts`;
  confirm failure at the existing DB reads, not an invalid SQLite fixture or missing binary.
- [x] Pass paths in `restoreFromStream`, setup validation and staged entry. Unpack only the small
  stream entries; leave the staged DB untouched until `writeValidated` has acquired the venue lock.
  Preserve marker-last behavior and existing staged lock-busy/non-lock failure assertions.
- [x] Add sparse >2 GiB staged-file forwarding test alongside the real SQLite call-chain tests.
  Check forwarding/size without migrating a sparse dummy. Adapt shape assertions, retaining refusals.
- [x] Rerun the same three suites and `typecheck`; verify no DB whole reads remain in these paths.
  Correct the scratch “same filesystem” comment, since state/venue separation now uses EXDEV.
- [x] Sign off the complete Task 2 commit. Keep this branch unpublished.

### Task 2 qualification, 2026-10-12

The three database-wide read interception cases failed at the CLI, setup and staged-boot reads
before implementation, then passed with path forwarding. The three selected restore suites passed
159 tests, including a real CLI wrapper, default staged placement/migrations/hooks, a real busy-lock
refusal followed by retry, and sparse 2147487744-byte forwarding with bounded edge reads. In an
independent installed clone, reintroducing those reads failed two CLI cases, one setup case and one
staged case; restoring the candidate passed all 159. Server types, changed-file lint/format and
unedited fiscal golden/immutability tests (20 tests) passed. These results do not establish archive
streaming, real S3/Litestream throughput or integrity/crypto over a valid 2 GiB SQLite database.
Tasks 3–4 remain; the branch stays unpublished.

## Task 3: compatible file archive codecs with bounded memory

**Files:** create `apps/server/src/{backup-archive-file.ts,artifact-cipher-file.ts}` and sibling `.test.ts` suites; share bounded I/O through `artifact-file-io.ts` and its tests; export shared framing constants/limits from existing codec files as needed.
**Interfaces:** `ArchiveInputEntry={kind:"bytes",entry:ArchiveEntry}|{kind:"file",name:string,path:string}`;
`packArchiveStream(entries:readonly ArchiveInputEntry[]):AsyncIterable<Uint8Array>`;
`unpackArchiveFile(path:string,scratchDir:string):Promise<ArchiveInputEntry[]>`;
`encryptArtifactFile(plaintext:AsyncIterable<Uint8Array>,outPath:string,key:string):Promise<void>`;
`decryptArtifactFile(artifactPath:string,outPath:string,key:string):Promise<void>`.
File writers own only their newly created output, remove partial output on failure and never delete input.

- [x] Write failing small cross-codec tests: streaming WBA equals `packArchive` bytes; each cipher
  opens the other's output, checking version/AAD/KDF/tag layout and binary/non-ASCII/empty entries.
  Add header/tag/ciphertext tamper, wrong key, truncated fields/data, excessive u64/count/name/
  non-DB aggregate, reader/writer failure and cleanup. Assert exact current domain refusals.
- [x] Run `test -- src/backup-archive-file.test.ts src/artifact-cipher-file.test.ts`; first require
  expected missing-interface failures, then behavioral failures as each interface is introduced.
- [x] Implement bounded entry framing/file reads, checked BigInt lengths against file size, limits
  before allocation and the existing trailing-byte behavior. Extract DB once into private
  `scratchDir/venue.db`; retain duplicate entry names for the existing validation guard, without
  overwriting the first DB. Close every handle; unexpected file entries cannot reach placement.
- [x] Implement async KDF and GCM file writing with tag reservation/patch after finalization;
  decrypt to a private spool and return only after authentication. Map auth errors exactly as the
  byte cipher does; preserve ordinary I/O errors. Never concatenate bulk chunks.
- [x] Test large lengths using a real sparse WBA/file segment and bounded reads at offsets past
  2 GiB. Use smaller files with several chunks for actual crypto and full hash comparisons;
  record maximum chunks read/written rather than making a noisy RSS threshold the assertion.
- [x] Run both new suites plus `src/backup-archive.test.ts src/artifact-cipher.test.ts` and `typecheck`.
  Sign off Task 3; no users are switched until Task 4 is complete.

### Task 3 qualification, 2026-10-12

Missing-interface failures were followed by 27 failing behavioral cases against empty implementations.
The five selected old/new codec and file-I/O suites pass 54 tests. Existing byte codecs open the new
WBK1 output, the new reader opens byte-codec output, and streaming WBA1 equals the existing encoder.
Tests cover authenticated header/tag/ciphertext changes, wrong keys, framing truncation, u64 bounds,
metadata limits, duplicate database names, partial I/O, cleanup and protected output modes.
A sparse duplicate segment of 2147487744 bytes is skipped without replacing the first database;
bounded framing reads then reach metadata beyond that offset. This is not a full extraction,
cryptographic pass or integrity check over a valid 2 GiB SQLite database.

In an independent installed clone, removing or weakening metadata/name/length bounds,
authentication, plaintext/database cleanup and chunk bounds failed 1/1/1/5/7/2/2 cases respectively;
restoring the candidate passed 54, with the six source/test files equal to the feature checkout.
Server types, changed-file lint/format and the unedited fiscal pair (20 tests) pass. No existing
assertion changed in Task 3. Task 4 must integrate the codecs, storage and callers before publication;
this checkpoint does not change the running archive pipeline.

## Task 4: scheduled local archive creation through artifact restore

**Files:** create `apps/server/src/archive-read-budget.ts` with sibling tests; modify `apps/server/src/{archive-entries.ts,backup-sources.ts,state-secrets.ts,backup-optional-state.ts,backup-sweep.ts,storage-backend.ts,local-fs-backend.ts,restore.ts,restore-command.ts,restore-request.ts}`;
tests `backup-sweep.test.ts`, `local-fs-backend.test.ts`, `backup-status.test.ts`, `restore.test.ts`, `restore-command.test.ts`, `restore-request.test.ts`, plus collection suites.
Update fixture backend shapes and disposal; audit `boot.ts` wiring without editing boot tests.
**Interfaces:** add `StorageBackend.putFile(key:string,path:string):Promise<void>` and
`getFile(key:string,outPath:string):Promise<void>`; retain byte put/get for bounded existing callers.
Add `validateArtifactFile(deps:Omit<ValidationDeps,"artifact">&{artifactPath:string}):Promise<ValidatedArtifact>`
and `restoreFromArtifactFile(deps:Omit<RestoreDeps,"artifact">&{artifactPath:string}):Promise<void>`.
Byte and file entrypoints share Task 1's lifecycle; inputs are never combined. `collectStateParts(deps,budget?:ArchiveReadBudget):Promise<StateParts>` propagates a shared budget to collectors; `readArchiveStateFile(path:string,budget:ArchiveReadBudget):Promise<Buffer>` enforces remaining bytes while reading. The budget holds the spec's count/name/aggregate limits.

- [x] Add failing sweep/local-backend tests: no bulk `readFile`, identical ciphertext from one
  encryption to two file backends, original entry order/content, existing scheduling/pruning/outcomes,
  0600 plaintext/artifact/backend temp, partial-copy/crypto failure publishes no completed key,
  destination isolation and cleanup after abort/failure. Add bounded metadata collection cases,
  including growth during reads; a real SQLite sweep → `putFile` → `getFile` → file restore roundtrip
  checks restored rows and secrets through default implementations.
- [x] Run `test -- src/backup-sweep.test.ts src/local-fs-backend.test.ts` and relevant collection
  suites; confirm the failures distinguish the whole-file pipeline from the proposed file pipeline.
- [x] Add a bounded collection option used by scheduled capture: check aggregate bytes/names/count
  before reading, cap reads even if files grow, retain byte entries. Sweep packs the archived DB
  path and metadata into Task 3's encryption once; fan out via `putFile`, clean after all settle.
  Local file storage copies to destination-local 0600 temp then renames; `getFile` publishes only
  a completed private copy. Never consume shared ciphertext or mask stored success on prune.
- [x] Add failing CLI/default staged archive tests that reject bulk reads, open authenticated real
  SQLite archives, reuse the extracted DB for liveness and preserve source artifact/retry behavior.
  Switch CLI/default staged artifact execution and its injected restore type to file APIs; byte
  setup/Cloud inputs retain existing limits. Adapt staged interface assertions to paths.
- [x] Validate file artifacts in one owned scratch directory: decrypt/authenticate spool, unpack,
  shared checks, remove spool, return owned DB; cleanup every refusal and placement outcome.
  Preserve CLI “wrong recovery key or corrupt artifact” wording and its unreadable-file handling.
- [x] Run focused sweep/backend/collection/restore/stream/request/command/codec/fiscal suites and
  `typecheck`. Use actual passed Tests counts. Audit consumers with `rg` for `dumpEntry`,
  `dumpBytes`, `databaseBytes`, codecs, backend methods and every validation disposal owner.
- [x] Add the streaming receipt to `docs/developers/conventions-data.md`,
  correcting its archive-source scratch row. Delete only the completed A516 entries from
  `docs/backlog.md` and `docs/backlog/box.md`; leave adjacent recovery residuals in place.
  Audit README/runbook claims across the whole branch and name the retained Cloud/upload limits.
- [x] Sign off the complete Task 4 commit. Report ready for `finish-branch`; the normal push hook
  and current-head CI supply coverage; no extra whole-workspace run or partially integrated PR.


### Task 4 qualification, 2026-10-12

The backend's empty interface failed two cases; bounded metadata collection failed four;
the old sweep pipeline failed three; empty file validation and the CLI/staged byte reads failed
seven. Correcting the test fixture added the required full invoice series and held a real SQLite
lock, since the venue opener shares holds within one process. The selected 22 server suites pass
422 tests, root guards pass 2459, server types and changed-file lint/format pass, and the fiscal
golden/immutability pair passes 20 unedited tests.

In an independent installed clone, deleting metadata/count/name/growth bounds, collector budget
propagation, file-only sweep input, shared source retention, temporary-copy cleanup, file-validation
cleanup and CLI/staged file forwarding failed 4/1/1/1/1/1/2/3/5/1/1 cases respectively. Restoring
the snapshot passed 159 tests across seven suites, and all 40 changed paths matched the feature
checkout. The real SQLite roundtrip checks restored rows and secrets; it does not measure a valid
2 GiB database's full integrity or encryption throughput. Cloud and upload limits remain intact.
The remaining branch gates are the Claude review, normal push hook and required current-head CI.


### Post-review qualification, 2026-10-12

The completed Claude review took 691 seconds. It found a contradiction between the spec's
multiply-linked-source refusal and Task 1's new positive test. The spec controls: the source now
requires one link, and missing sources return `restore.unsafe_entry_path`. Both corrected expectations
failed before implementation. They retain both source names and the old database, sidecars and incoming
on refusal. The earlier hard-link-positive receipts describe their original candidate only.

The setup validation boundary now has a successful staging case and a cleanup assertion on an
actual liveness refusal. A528 already landed as #1570 (`baf3d338`), so the queue's explicit
permission to add necessary boot tests after that split applies. Deleting setup disposal fails two
cases; deleting the link-count or missing-source mapping fails one each; restored placement,
file-artifact and boot-setup suites pass 48. This adds no boot production behavior. SQLite may change
journal metadata when it opens a private validation file; no byte-identical-placement claim is made.


### Rebase and alias control, 2026-10-12

Lane B's reload change also edits `boot.ts`; rebasing onto main `df3048a4` merged cleanly.
The affected setup/placement/file-restore/build-header suites pass 55 tests. Review approval is
retained across this rebase. The link-count refusal could mask the protected-path assertion while
its fixture still held a second link. The fixture now removes that extra source name before the
symlink-parent case and checks the protected file has one link. All prior refusal assertions remain.
Deleting the protected-path predicate in an independent installed shallow clone fails seven cases;
restoring it passes all 20 placement cases. The owned clone was removed and absence checked.

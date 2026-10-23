## 2026-10-23 build approval and first-cut execution contract

The owner authorised building every published A799 plan cut on 23 October 2026
with “Go ahead and build.” This dated record supersedes the planning-only authority
in the unchanged historical plan below. Runtime, capture, A760 reset,
migration, upload, provider and trusted CI activation keep their separate gates.

The [first-cut contract](../../../bench/real-upgrade/README.md) records the actual
interfaces: explicit set-qualified epoch inputs, preservation of previously
committed index entries, actual candidate ancestry, strongest optional-off
coverage and refusal of first-time module enablement as upgrade evidence.
`parseFacts` belongs with cut 2's complete typed facts/schema/coverage model.
No capture, issued full invoice, real upgrade or access qualification is established.

---

# A799 Real Database Upgrade Testing Implementation Plan

> **For agentic workers:** After separate owner approval, use `superpowers:executing-plans` and implement routine tasks inline. Read `superpowers:test-driven-development` before writing implementation or tests. No subagent-driven execution is required. All checkboxes below describe future work, not authority to start it.

**Goal:** Check that a candidate's normal packaged boot preserves independently recorded history written by a qualified frozen older product, then separately check a new sale.

**Architecture:** Keep selection, admission, comparison and phase decisions in root JavaScript modules, with root Vitest tests. Put every container, network, process and filesystem adapter under `bench/real-upgrade/`, without a workspace manifest. Keep sealed originals outside the candidate's writable copy; use the real image entry and migrations without modifying product writers.

**Tech stack:** Repository-pinned Node, ESM JavaScript with checked runtime contracts and JSDoc types, root Vitest/V8 coverage, read-only SQLite extraction, isolated Linux container network namespace, existing Waitron image build and GitHub repository access.

**Spec:** [Approved design](../specs/2026-10-19-a799-real-database-upgrade-testing-design.md), specifically its current planning-approval record and F-answered precedence addendum, followed by unchanged historical detail only where consistent.

## Authority and global constraints

- The commissioning owner instruction records complete-design approval for PLAN ONLY at approximately 17:25 on 22 October 2026, “Yes to both”. The spec's older “not yet approved” wording is historical relative to that instruction; the parent owns its dated approval addendum.
- This draft is unapproved. Landing documentation approves no implementation, tests, builds, runtime probes, capture, migration/reset, provider operations, artifact upload/publication or fiscal enablement. No baseline capture is currently qualified; no availability or runtime result is claimed.
- A: invented venue, immutable frozen old product, normal supported setup/authentication/permissions/business paths. No private venue, domain seed SQL, current writers, fabricated sessions, patched old source or replacement fiscal backend.
- B/F: every candidate requires the oldest supported and previous retained source releases, deduplicating equal endpoints. Retirement requires the owner's retired source, named replacement and effective candidate. There is no rolling window. Keep all originals and expectations, including intermediate and retired sources.
- C: each release's bundle and facts live in that source release's own Waitron GitHub Release; checksums live in Git. Verify private downloads later using existing access only. No new token, permission expansion, provider or publication credentials in candidate execution.
- D/E: issued F1 must preserve its original customer name/address on the same invoice. Keep exact assigned IDs, numbers, dates and timestamps. A fresh capture is a new reviewed version; neither regeneration nor candidate output can refresh expectations.
- Admit only the actual history after A760's SEPARATELY authorised reset. A distinct candidate must apply actual pending migrations through normal packaged entry/boot. Same-image or no-pending runs supply restart/preservation evidence only.
- Never change `computeHuella`, hash-chain/invoice allocation, `registros_facturacion` writers/schema/history, alta builders, `registerSif`, `restoreFiscal`, golden huella or `inmutabilidad` assertions. No repair migration, compatibility layer, reset, restore, reprovisioning, marker deletion or new identity during upgrade.
- No real AEAT/payment/Cloud/hardware/backup/LAN service, host trust change, operator volume or real installer access. Both images keep a preproduction preparation/no-submission posture with only supported external test interfaces.
- Preserve existing synthetic/schema checks. Root and package coverage remain `98/98/98/95`; do not add exclusions, weaken assertions or run the whole workspace locally merely to finish a branch.

## Source-read baseline, not execution evidence

All observations in this table are **UNVERIFIED at runtime**, read at checkout `b69d473a1466c1cceee66bb3c9ae2ad9e01659e9`. Re-trace the selected historical SHA and final candidate before execution; these are not claims about an available image.

| Existing seam                                                                                                                                                                     | Source read and consequence for this plan                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/Dockerfile:206`, `:286`; `apps/server/scripts/copy-migrations.mjs:17`                                                                                                     | Dockerfile names bundled server/entry and `node /app/node-entry.js`; the copy script stages per-set SQL/meta under `dist/drizzle`. Inspect packaged bytes and platform digests later.                                                                                  |
| `apps/server/src/node-entry.ts:288`, `:312`, `:486`, `:502`, `:509`, `:515`, `:521`                                                                                               | Entry includes first-setup resolution, staged restore/reset, the venue hold, ahead check and server start. Admission must reject pending destructive operations before launch without replacing these calls.                                                           |
| `apps/server/src/first-setup-entry.ts:25`; `reset-request.ts:14`; `restore-request.ts:57` in the same directory                                                                   | First-setup resolution distinguishes completed publication from unresolved state; reset/restore have staged files. A blanket “reject every first-setup file” could reject normal completed state; use the version's reviewed state predicates.                         |
| `apps/server/src/boot.ts:910`, `:925`, `:934`, `:936`, `:941`, `:1567`                                                                                                            | Stamp read precedes migration; trading selects enabled modules, then missing-trigger read, migration, long-lived store and feed installation. Direct `applyMigrations` cannot exercise this sequence.                                                                  |
| `packages/migrations/src/apply.ts:47`, `:69`, `:126`; `src/manifest.ts:73` in that package; `packages/provisioning/src/schema-ahead.ts:17`, `:53`                                 | Migrator holds its lock, removes feed, applies sets and installs protection, then checks completeness; ahead check compares hashes. Counts alone cannot establish pending work or history membership.                                                                  |
| `packages/store/src/venue-lock.ts:53`, `:76`; `apps/server/src/recovery-lock.ts`; `recovery-state.ts` in that directory                                                           | Venue hold uses SQLite `begin immediate`; recovery state has another lock. Capture must coordinate every writer and retain persistent lock files, without treating captured PIDs as live owners.                                                                       |
| `apps/server/src/box-env.ts:7`, `:22`; `trading-config.ts:29`; `module-config.ts:12`; `box-secrets.ts:139`; `node-identity.ts:24` in that directory                               | File/process environment merges, trading identity, modules, TLS/vault material and sealed node key all matter. Missing module config selects all modules in this read; missing identity material can enter creation paths. Bare `venue.db` is insufficient.            |
| `apps/server/src/setup-api.ts:777`; `provision.ts:42`, `:133`; `packages/provisioning/src/throwaway-allocation.ts:18`; `packages/fiscal-verifactu/src/throwaway-allocation.ts:28` | Supported provisioning and preproduction allocation paths exist in source; generated values are not deterministic inputs. Verify the chosen old interface, accepted test inputs and safe identity supply later.                                                        |
| `apps/server/src/management-api.ts:1120`; `catalogue-api.ts:1094`; `till-clock-api.ts:25`; `till-sale.ts:695`, `:1177` in that directory                                          | Invitations, publication, clock and sale orchestration are route trace points. Historical adapters must follow actual old routes, enrolment and permissions, not copy current request bodies.                                                                          |
| `apps/server/src/till-setup.ts:118`; `till-sale.ts:526`, `:530`; `working-order.ts:4116` in that directory                                                                        | Source advertises full invoices disabled, refuses F1 sale requests, and separately parses an unpaid order's recipient choice. This identifies a qualification risk, not a verified historical capability or a numbered prerequisite that fixes it.                     |
| `packages/fiscal-verifactu/src/schema/registros.ts:26`, `:75`, `:85`, `:93`, `:99`; `schema/envios.ts:19`; `packages/workforce/src/schema/time-entries.ts:47`                     | Raw recipient/payload/amount/time/hash fields, submission links and workforce history require typed and byte comparisons. Decoding alone can conceal changed storage.                                                                                                  |
| `apps/server/src/run-server.ts:72`; `boot.ts:776`; `onboarding-policy.ts:12` in that directory                                                                                    | Shutdown deadline can exit zero; ordinary close logs `server.stopped`. Preparation policy is a source seam, not established containment. Require complete close and independent resource evidence.                                                                     |
| `scripts/migration-upgrade.test.ts`; `scripts/changed-packages.mjs:129`; `scripts/changed-scope.mjs:150`; `vitest.config.ts`                                                      | Synthetic walk remains complementary. Root scripts have root scope; unknown bench paths need deliberate classification. Root tests include `scripts/**/*.test.mjs`; root coverage includes `scripts/**/*.mjs`, but does not presently name the proposed bench modules. |
| `.github/workflows/ci.yml:62`, `:2534`, `:2691`; `.husky/pre-push`                                                                                                                | Workflow declares `contents: read`, aggregate `ci` names upstream jobs, and publication follows it. Private access and safe trusted-to-candidate transfer remain unverified. Normal hook and current-head CI stay required.                                            |

Read before implementation: `CLAUDE.md`, `docs/developers/writing-claims.md`, `testing-guide.md` (resource ownership, root guards, deletion controls), `ci-and-gates.md` (selection, coverage, image jobs, migration walk), `conventions-data.md` (locks, journals, identity), and `workflow-guide.md`, all under `docs/developers/` except `CLAUDE.md`.

## Review focus

1. Completed first-setup files versus pending destructive state: reject the latter without rejecting a legitimate completed fixture (Tasks 1/4).
2. Absent optional-module schema versus retained disabled rows: report separate coverage and never silently enable the module (Tasks 2/5/6).
3. A trusted fetch that runs candidate-controlled code, follows authenticated redirects or leaves credentials in Docker configuration: fail before candidate execution (Tasks 3/7).
4. Equal counts with swapped children, same-name changed triggers, or changed stored text that decodes identically: compare identities/bytes/definitions (Tasks 2/6).
5. Exit zero after a shutdown deadline, blocked event loop, or a cleanup failure after passing comparison: fail with owned-resource diagnostics (Tasks 4/6).

## File responsibility map and review cuts

All paths below are proposed unless named “modify”. No product-source edit is planned. Shared files use `.mjs` with runtime validation; the root has no TypeScript checking, so documentation-only interfaces are insufficient validation.

| PR / task    | Paths and responsibility                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / 1        | `scripts/a799/contracts.mjs`, `selection.mjs`, `selection.test.mjs`: strict versioned contracts, epoch/support/cell selection. `bench/real-upgrade/index.json`: initially empty qualification index. `bench/real-upgrade/README.md`: gates and command contract.                                                                                                                                              |
| 2 / 2        | `scripts/a799/facts.mjs`, `schema.mjs`, `compare.mjs`, `compare.test.mjs`, `schema.test.mjs`: pure typed facts, complete schema/protection comparison and exact mappings.                                                                                                                                                                                                                                     |
| 3 / 3        | `scripts/a799/archive.mjs`, `archive.test.mjs`, `fetch.mjs`, `fetch.test.mjs`: restricted archive admission, bounded trusted retrieval and checksum validation.                                                                                                                                                                                                                                               |
| 4 / 4        | `scripts/a799/phases.mjs`, `phases.test.mjs`; `bench/real-upgrade/resources.mjs`, `isolation.mjs`, `archive-io.mjs`, `capture.mjs`, `inspect.mjs`, `cli.mjs`; `scripts/a799/rig.test.mjs`: ownership, isolated image execution, stopped inspection and capture. Modify `vitest.config.ts` coverage to include the bench runtime modules.                                                                      |
| 5 / 5        | `bench/real-upgrade/interfaces/<source-sha>/scenario.mjs`, `reads.mjs`, `state-policy.json`, `capture-request.json`, `capture-draft.json`, `qualified-fixture.json`; `scripts/a799/scenario.test.mjs`; append published qualified versions to `bench/real-upgrade/index.json`. SHA directory is the literal verified 40-character source SHA, not an arbitrary version alias. No such source is selected now. |
| 6 / 6        | `scripts/a799/run.mjs`, `run.test.mjs`; `bench/real-upgrade/candidate.mjs`, `controls.mjs`; `scripts/a799/controls.test.mjs`; `bench/real-upgrade/mappings/<mapping-id>.json`: preservation/restart/new-sale orchestration, damaged-copy controls, reviewed mappings.                                                                                                                                         |
| 7 / 7        | Modify `scripts/changed-scope.mjs`, `changed-packages.mjs` and their existing tests; `.github/workflows/ci.yml`, `scripts/ci-workflow.test.mjs`; create `.github/workflows/real-upgrade.yml`, `scripts/a799/gate.test.mjs`: safe trusted input workflow, candidate matrix and publication gate.                                                                                                               |
| Each code PR | Update `bench/real-upgrade/README.md` and the relevant developer convention receipt when it changes a procedure; update `docs/backlog.md` and its existing A799 detail when evidence changes status. Parent alone handles today's documentation landing/backlog updates.                                                                                                                                      |

Cuts depend in order, except Task 2 can be reviewed independently after contracts. A landed harness PR is not a qualified capture or a passing upgrade. Stop between cuts at any unmet execution gate; do not merge dormant wiring that reports a required cell successful without inputs.

## Shared contracts

Define these in `scripts/a799/contracts.mjs` as JSDoc typedefs plus strict parsers. Reject unknown versions/keys, duplicate keys/IDs, invalid hashes, nonpositive limits and missing required coverage. Consumers receive validated objects, never arbitrary JSON.

```text
Sha256 = lowercase 64-hex string; SourceSha = lowercase 40-hex string.
Image = {sourceSha, manifestDigest, platformDigest, platform, buildIdentity,
         nodeVersion, sqliteVersion, entry: string[]}.
entry is the inspected packaged entry, never a test override; this checkout names
["node", "/app/node-entry.js"], without establishing the historical image's entry.
Epoch = {id, a760ResetReceipt, baselineSourceSha, baselineMigrationHashes}.
Asset = {releaseId, assetId, name, sha256, bytes, inventory: InventoryEntry[]};
no arbitrary download URL. Both archive inventories are external trusted-index data,
not discovered by extracting an archive; validate each before reading its headers.
Limits = {compressedBytes, unpackedBytes, entries, perFileBytes, logBytes,
          memoryBytes, scratchBytes, processCount}; finite positive integers.
Fixture = {id, version, epochId, image, driverSha, scenarioVersion, retainedOrdinal,
           moduleVariant, bundle: Asset, evidence: Asset, limits, reviewReceipt, controlReceipt}.
moduleVariant = "required-verifactu" | "disabled-retained" | "never-enabled".
Retirement = {retired, replacement, effectiveCandidateSha, ownerReceipt}.
Index = {version: 1, epoch: Epoch|null, fixtures: Fixture[], oldestSource: SourceSha|null,
         retirements: Retirement[]}; empty index is allowed storage, never a passing gate.
Candidate = {image: Image, epochId, orderedSourceShas: SourceSha[]}.
Cell = {id, sourceSha, candidate, fixture: Fixture}; source selection expands declared variants.
Each source declares its required VeriFactu fixture and optional-off fixture; safe historical
disabling selects disabled-retained, otherwise never-enabled plus an explicit coverage gap.
Journal = {set, table, rows: {id: Typed, hash: string, createdAt: Typed}[]}.
PackagedSet = {set, table, sql: {hash, when, fileSha256}[], metaSha256, enabled: boolean}.
Typed = {kind: "null"} | {kind: "integer", decimal: string}
      | {kind: "real", ieee754Hex: string} | {kind: "text"|"blob", base64: string}.
Row = {table, key: Typed[], fields: Record<string, Typed>}.
SchemaObject = {kind, name, table, rawSql, tokens, columns, keys, indexes,
                checks, foreignKeys, target, body}; fields depend on strict kind schema.
Facts = {version: 1, fixtureId, rows: Row[], schema: SchemaObject[], journals,
         files, relationships, coverage, identity, operationalRules, newSale}.
coverage records issuedF1 IDs/original recipient bytes and nonzero scenario entity IDs;
identity records node/key/SIF/installation/series/next-number and fiscal/workforce heads.
relationships enumerates complete keyed tuples in both directions, including nullable links.
Mapping = {id, sourceEpoch, sourceSha, candidateSha, migrationHash, module,
           object, field, before, after, exactTransform, reason, approvalReceipt}.
Diff = {subject, key, field, expected: Typed|object, actual: Typed|object, cause}.
Comparison = {ok: boolean, diffs: Diff[], comparedByKind: Record<string, number>}.
Phase = "fetch"|"admit"|"copy"|"boot"|"read"|"stop"|"compare"|"restart"
      | "sale"|"cleanup"; Result carries phase, classified failure and owned resource IDs.
```

Complete the effect boundaries in the same contracts file, with these public shapes.
There are no implicit environment/default-clock/default-credential dependencies:

```text
InventoryEntry = {path, kind: "file"|"directory", mode, bytes, sha256: Sha256|null}.
VerifiedArchive = {root, inventory: InventoryEntry[], archiveSha256, ownerId}.
VerifiedInputs = {cells: {cellId, state: VerifiedArchive, evidence: VerifiedArchive}[],
                  trustedRevision: SourceSha, indexSha256, credentialScopeClosed: true}.
FetchDeps = {transport: (Asset, AbortSignal) => AsyncIterable<Uint8Array>,
             scratch: () => Promise<{root, dispose}>, now: () => number,
             signal: AbortSignal, deadlines, retrySchedule, credentialScope}.
ArchiveIO = {root, ownerId, createDirectory, openExclusiveNoFollow, writeChunk,
             finishVerifiedFile, inspectEntry, removeOwnedPartial, signal}.
VerifiedArchive is produced only after those operations establish independent inodes,
matching inventory/hashes/modes and no unresolved partial file.
StatePolicy = {sourceSha, roots, companionVolumes, inventoryRules, markerPredicates,
               completedSetupPredicates, lockProtocol, environmentAllowlist,
               testInputProvenance, externalEndpoints, stoppedEvidenceRules}.
ReadSpec = {sourceSha, schemaSha256, explicitTablesAndColumns, primaryKeys,
            relationshipTuples, rawByteFields, coverageRules, productReadRoutes}.
Owned = {id, kind, startIdentity, root, ownerId, phase}.
RigSpec = {image: Image, policy: StatePolicy, limits: Limits, deadlines,
           stateRoot, environment, internalPorts, namespace, mounts, ownerId}.
Rig = {spec: RigSpec, owned: Owned[], start, request, stopCleanly, snapshot, dispose}.
CaptureRequest = {version: 1, id, fixtureVersion, retainedOrdinal, epoch: Epoch, image: Image, driverSha,
                  scenarioVersion, moduleVariant, policy: StatePolicy, limits: Limits,
                  deadlines, runtimeAuthority, captureAuthority}.
SealedArchive = {path, ownerId, sha256, bytes, inventory: InventoryEntry[]}.
CaptureDraft = {version: 1, request: CaptureRequest, state: SealedArchive,
                evidence: SealedArchive, facts: Facts, cleanStopEvidence,
                originalHashes, qualification: "unreviewed"}.
QualifiedFixture = {request: CaptureRequest, draftSha256, state: SealedArchive, evidence: SealedArchive,
                    reviewReceipt, controlReceipt, coverage}.
parseCaptureRequest(unknown): CaptureRequest requires planned inputs/authority,
not future generated entity IDs, stop results or independent review.
qualifyDraft(draft: CaptureDraft, reviewReceipt, controlReceipt): QualifiedFixture
requires exact issued-F1/stop facts and receipts bound to both pinned archive hashes.
publishedFixture(qualified: QualifiedFixture, uploaded: {bundle: Asset, evidence: Asset}): Fixture
requires the same bytes/hashes/inventories and source-release identity; it performs no upload.
Its Fixture metadata comes from the retained CaptureRequest, including fixtureVersion/retainedOrdinal,
never inferred from candidate output or an archive path.
The published index accepts only Fixture, never requests or unreviewed drafts.
Result = {ok, phase: Phase, failure: {code, detail}|null, owned: Owned[], durations}.
CellDeps = {inputs: VerifiedInputs, mappings: Mapping[], readSpec: ReadSpec,
            rig: (RigSpec, body) => Promise<Result>, inspect: inspectStopped,
            compare: compareFacts, copyVerified, productInterface, now, signal}.
CellResult = {cellId, sourceSha, candidateSha, inputHashes, workKind,
              pendingEvidence, preservation: Comparison|null,
              restart: Comparison|null, sale: {ok, assertions, diffs}|null,
              cleanup: Result, coverageGaps: string[], result: Result}.
ControlSpec = {indexPath, candidate, controlIds, ownedScratchRoot}.
ControlResult = {controlId, cleanResult, damagedResult, expectedPhase,
                 expectedCode, expectedDiff, originalHashesUnchanged}.
ProductInterface = {sourceSha, setup, authenticate, enroll, createHistory,
                    readHistory, newSale, stopClients}; every operation accepts
                    {request, transcript, returnedIds, signal, requestDeadline}.
```

`Facts` additionally freezes exact product request/response transcripts, raw fiscal storage bytes and document hashes, historical schema/protection/journal definitions, inventories/exclusions, external test input provenance, clock/time zone, effective configuration, shutdown evidence and the original inputs to independent review. Review/control receipts stay outside the archives whose hashes they bind; the qualified descriptor carries them. Store large byte streams beside its JSON with individually indexed hashes; do not serialize integers through floating point. The evidence asset is an archive of this complete set, not candidate output. Version-specific readers define every raw field and primary/composite key explicitly from that frozen schema; unknown fields/tables fail inspection until reviewed.

`SchemaObject.tokens` removes only whitespace outside quoted SQL content; keep quote/string content and raw SQL. Operational rules name exact row keys, fields, causes and permitted transitions; no table-wide exemption. No rule may permit fiscal history, identity, original invoice numbers or assigned times to change. `newSale` pins request inputs, independent exact arithmetic and generated-ID/time predicates before candidate access.

## Task 1 / PR 1: admit the history and select the required cells

**Files:** contracts/selection/index/README from the map. **Consumes:** strict `Index`, `Candidate`. **Produces:** `parseIndex(unknown): Index`, `parseFacts(unknown): Facts`, `selectCells(Index, Candidate): Cell[]`, `classifyWork(source: Image, candidate: Image, oldJournals: Journal[], packaged: PackagedSet[], enabledSets: string[]): {pending, expectedAfter, kind}`; `kind` is `pending-upgrade` or `restart-only`.

- [ ] Write `selection.test.mjs` first with independently constructed R1–R4 records: for R5 expect source IDs exactly `[R1,R4]`; one source expands its variants once. Preserve R2/R3/R1 originals after retirement.
- [ ] Assert retirement R1→R2 effective at R5 yields `[R2,R4]` only at/after that candidate's recorded source ancestry; absent owner receipt, absent replacement, wrong epoch, duplicate ordinals, ambiguous ancestry and missing variant each throw a named admission failure. Candidate order is pinned Git ancestry, never tag lexical order or wall clock.
- [ ] Assert an empty index, missing actual reset receipt/baseline, pre-reset journal hash and inaccessible required source cannot yield `[]` as success. Equal endpoints run once; a never-enabled fixture is not labelled disabled-retained.
- [ ] Assert same image and later image with no pending applicable SQL are `restart-only`; a distinct image with an enabled set's extra hash/date is pending. Same counts with a changed old hash fail history admission. Disabled retained sets keep old journals; never-enabled sets have explicit absent journals.
- [ ] Run `pnpm exec vitest run scripts/a799/selection.test.mjs`. Record a red test failure at the missing exported function/assertion, not a loader/config failure. Implement only the named contracts/selection, then rerun to a nonzero passing Tests count.
- [ ] Deletion control in an owned temporary checkout: remove oldest-source inclusion, then rerun that command; `[R4]` must fail the `[R1,R4]` assertion. Accepting control is the unchanged selector on the same input. Repeat after selector restructuring.
- [ ] Commit this cut with `git commit -s -m "test: define real-upgrade history admission and selection"` after staging only its paths and checking the staged diff.

## Task 2 / PR 2: compare independent typed facts, schema and protections

**Files:** facts/schema/compare and tests from the map. **Consumes:** parsed `Facts`, `Mapping[]`. **Produces:** `encodeTyped(storageType, rawBytes): Typed` and `validateCoverage(Facts): void` in facts; `compareFacts(expected: Facts, actual: Facts, mappings: Mapping[]): Comparison`, `compareSchema(expected: SchemaObject[], actual: SchemaObject[], mappings: Mapping[]): Diff[]`, `validateMappings(mappings, cell): Mapping[]`. No capture/update-snapshot mode.

- [ ] Write `compare.test.mjs`: equal small explicit fixtures pass with nonzero sales, fiscal records, people, menus and event counts. Reordering keyed rows passes; duplicate original keys, missing child and unexpected child fail with exact key/field paths, even when counts match.
- [ ] Pin quantity `350` thousandths, cheese `770` cents, old decimal text `"7.70"`, 10% base/tax `900/90`, 21% `300/63`, total `1353`, tender and change separately. A quantity `35`, money-scale interpretation, wrong VAT group, changed name/actor/FK tuple or `"7.7"` replacing stored `"7.70"` fails. These are authored test values, not captured observations.
- [ ] Pin three different product names; F1 original invoice ID/number/customer/name/address versus changed live customer; issue timestamp bytes and offset separately. Changing a stored time spelling with the same instant fails. Removing issued F1 while retaining unpaid recipient/F2 rows fails coverage.
- [ ] Compare every original fiscal field's raw typed bytes, recipient/payload bytes, predecessor/sequence/huella, environment and SIF/software data. Check original workforce/event bytes and pending outbox IDs/state/attempts/due time; no-submission expects no advancement. Synthetic comparator inputs may model bytes; never alter real protected rows to demonstrate failure.
- [ ] Write `schema.test.mjs`: same-name altered non-fiscal trigger body/target, FK action, CHECK, index predicate/expression, column type/default/nullability and view each fail. Whitespace outside quotes passes; whitespace inside string literals fails. Unknown object/field and extra/missing object fail.
- [ ] Test exact reviewed added-null-field mapping and renamed-object key mapping pass; missing receipt, wrong source/candidate/migration/module, wildcard, numeric/time tolerance or any fiscal-byte transform fails. Disabled schema remains at its frozen version. Explicit operational field transition passes; a neighbouring field change fails.
- [ ] Run `pnpm exec vitest run scripts/a799/compare.test.mjs scripts/a799/schema.test.mjs`; observe each new test red before implementation, implement the three named exports and strict raw/schema models, then rerun with nonzero passing counts.
- [ ] Remove child-set comparison and protection-body comparison separately in disposable harness checkouts; their damage tests must fail because a difference is no longer reported. The unchanged comparator must accept the clean control. Record command, input hashes and exact failing assertion.
- [ ] Commit with `git commit -s -m "test: compare original upgrade facts and full protection definitions"`.

## Task 3 / PR 3: retrieve and admit sealed archives before candidate access

**Files:** archive/fetch modules and tests. **Consumes:** `Asset`, `Limits`, trusted parsed index. **Produces:** `validateEntry(entry, inventory, limits): void`, `admitArchive(stream, inventory, limits, io: ArchiveIO): Promise<VerifiedArchive>`, `fetchInputs(cells: Cell[], deps: FetchDeps): Promise<VerifiedInputs>`; dependency interfaces expose bounded read/transport/hash/scratch operations and never launch candidate code. Task 4's `archive-io.mjs` implements placement; Task 3 tests use injected I/O. Verified handles carry hashes and owned paths, not tokens. Both archive inventories come from the strict trusted index, sealed by Task 5 before index admission.

- [ ] Implement a deliberately restricted `a799-state-v1` stream: gzip wraps the magic `a799-state-v1\n`, then each entry's four-byte unsigned big-endian header length, strict UTF-8 JSON header and exact file bytes. Header keys are exactly `path`, `kind`, `mode`, `bytes`, `sha256`; directories have zero bytes/null hash. Only directories and regular files are representable. Inventory fixes every relative path/type/mode/length/hash and therefore each maximum header length before reading it. Require exact inventory completion and EOF. Reject unsupported format/version rather than invoking general tar/unzip extraction; frame/length/hash checks precede final file placement.
- [ ] Write `archive.test.mjs`: valid directory/file inventory passes; absolute/drive/UNC paths, `..`, empty/dot aliases, backslashes, NUL, duplicate/case-colliding paths, escaping names, symlink/hardlink/special types, setuid modes, truncated/trailing frames, duplicate JSON keys and undeclared entries fail before launch. Source inventory uses `lstat`, rejects links and multiply linked files, and includes empty directories.
- [ ] Assert compressed/decompressed/per-file bytes and entry totals are enforced while streaming, including gzip bombs and forged lengths. One byte/entry over each limit fails, exactly at limit passes. Missing inventoried entry, wrong mode/hash, secret file other than 0600, and a source/copy shared inode fail. Fresh owned root is 0700; extraction creates parents without following links and opens files exclusively/no-follow. A concurrent path replacement fails closed.
- [ ] Begin `fetch.test.mjs` with only a trusted index containing both external inventories and the two remote archive streams. Both must admit without first extracting either to find its inventory. Missing/altered inventory fails before placement. Then test pinned repository release/asset identifiers and committed hash pass; 401/403/404, deadline, short/extra body, missing facts, corrupt byte, wrong size/epoch and retry exhaustion produce distinct failures. No seed substitution or skip. Check redirects against an explicit GitHub asset-host policy and strip authorization on cross-origin requests; unknown destination fails.
- [ ] Test a sentinel existing read credential reaches only trusted transport; it is absent from returned handles, logs, subprocess arguments, history, environment allowlist, scratch files and Docker configuration. Candidate startup is not callable until all required assets are verified and the credential scope is closed. Check credential-bearing checkout config, helper files and registry logins too; an unset token alone is insufficient.
- [ ] Run `pnpm exec vitest run scripts/a799/archive.test.mjs scripts/a799/fetch.test.mjs` red, implement parsers/fetch with cancellation and bounded retries, then run green. A malformed archive test must assert its exact admission code and zero placed files outside the owned root.
- [ ] Deletion controls remove checksum and path validation separately in a disposable harness checkout; corruption/escape detection assertions must fail, while the valid archive passes unchanged. Never damage the retained original.
- [ ] Commit with `git commit -s -m "test: admit sealed upgrade inputs through a trusted fetch boundary"`. Real private access is still a later gate, not established by transport stubs.

## Task 4 / PR 4: own an isolated rig and capture stopped whole state

**Files:** phase/bench adapter/rig files and coverage configuration from the map. **Consumes:** `VerifiedInputs`, `Image`, source-version state policy or a validated `CaptureRequest` for capture. **Produces:** `withRig(spec: RigSpec, body): Promise<Result>`, `captureStopped(rig, request: CaptureRequest): Promise<CaptureDraft>`, `inspectStopped(root, readSpec): Promise<Facts>`. `RigSpec` fixes image/entry, approved limits, environment allowlist, namespace, mounts and owner ID. `CaptureDraft` is unqualified until Task 5 review.

- [ ] Write `phases.test.mjs`/`rig.test.mjs` using fake process/container adapters, not Docker: a clean close marker plus all owned exits passes; exit zero with `server.shutdown_timeout`, missing close evidence, live writer/sidecar, forced kill or uncertain ownership fails sealing. A contended venue refuses specifically and preserves file bytes.
- [ ] Assert phase cancellation still works when application progress stops; cleanup runs on success/error/signal, is idempotent, stops only recorded IDs with matching start identity/root/labels, and reports unresolved owned IDs as failure. Test an unrelated container/process survives each cleanup path. Use an outer supervisor independent of the app event loop; do not assume `run-with-deadline.mjs` alone accounts for Docker resources.
- [ ] Implement resources/isolation adapters: an owned `--network none` namespace anchor shared by the app/driver/supported fakes, loopback product bind and internal fixed ports. Verify no DNS forwarding/default route/LAN/multicast and monitor unexpected outbound attempts. No host port publication, `/dev`, DBus, Docker socket, host home, operator state or host trust store. Run as the inspected image's non-root user with read-only image filesystem, no privilege escalation, dropped capabilities and explicit scratch/RAM/process limits; qualify any required exception separately. Controller alone uses Docker. App receives only its disposable state and declared test inputs; no automatic restart.
- [ ] Inspect effective image ENV plus captured files plus explicit process environment. Keep module/node/environment identity; override only reviewed containment settings. Deny unexpected outbound attempts even when blocked. Freeze old per-version settings; never assume current `StartServerSeams` applies to old binaries.
- [ ] Implement capture: drain requests/clients, stop all writers cleanly, account for children, take that release's real venue hold while copying all matching roots/volumes, and coordinate state/recovery writers. Use a recorder that takes that historical lock and reads the domain state without modifying it; if no supported compatible route exists, block rather than patch old source or pass `exclusive:false`.
- [ ] Retain database/node files, persistent lock files, configuration, TLS/vault/node/account identity, test sessions/queues and matching side files. Record every recursive entry or exact reasoned exclusion. Never unlink a WAL/journal/lock to clean it. Recorder-created transient holder/journal exclusions name their exact path and cause. Verify source hashes while held; release/close in `finally`.
- [ ] `inspectStopped` opens only stopped private copies read-only, with foreign-key/integrity queries and explicit schema/type/raw-byte reads, no migrations/provisioning/trigger regeneration. Require integrity `ok`, zero FK violations, nonempty journeys and exact historical journals/protection. Matching side files need independently demonstrated consistent reading; SQLite immutable mode must not silently ignore a WAL. Detect any inspection-induced writes.
- [ ] Tests cover correct matching WAL set, missing/mismatched side file, absent vault/TLS identity, pending reset/restore/rejoin state, unresolved first setup and a legitimate completed first setup. Inventory the selected release's actual marker/state predicates; never delete markers or assume today's filename list is complete.
- [ ] Run `pnpm exec vitest run scripts/a799/phases.test.mjs scripts/a799/rig.test.mjs` red then green. Add `bench/real-upgrade/**/*.mjs` to root coverage, preserving thresholds. Use injected adapters for root coverage; every container-starting test/control remains an explicit bench CLI action.
- [ ] After separate runtime approval, `node bench/real-upgrade/cli.mjs isolate --request <capture-request.json>` must accept the allowed fake endpoint, reject a forbidden outbound attempt, show no host publication/mount/credentials, and stop only its own resources. Failure or inability to observe attempted egress blocks capture.
- [ ] Commit with `git commit -s -m "test: own isolated image rigs and stopped upgrade captures"`.

## Task 5 / PR 5: qualify each historical source and freeze independent evidence

**Files:** version-specific interface files/index/qualification from the map. **Consumes:** Task 4 rig/capture; source's normal supported interfaces. **Produces:** `CaptureRequest` → sealed unreviewed `CaptureDraft` → local `QualifiedFixture` → published `Fixture`, or an explicit blocked qualification. No image/digest/source values are invented to populate an executable index.

- [ ] Before runtime, obtain separate A760 reset receipt and actual merged baseline/hash identity; inspect source Git history and available immutable platform image/build/migration bytes. Record exact source/digest/runtime/platform, driver SHA, route version, identity inputs, test-only provenance and clocks in `capture-request.json`; validate only these planned inputs and scoped authority at this stage. No image availability is inferred from a tag or this checkout.
- [ ] Identify normal historical setup/allocation/authentication/enrolment/invitation/module paths and test-only vault/TLS/external identity interfaces. Fixed public test inputs may enter only there. Record generated keys/salts/IDs/times exactly; do not patch the image, import test allocation fixtures as a writer, or allocate a replacement identity during upgrade. An absent safe interface is a blocker.
- [ ] Verify whether that release can issue an F1 through its normal product route. If refused, retain the request/response and source path, identify the actual separately approved prerequisite later, and report A799 OPEN. No numbered backlog item is presumed to fix it. Partial fixtures may be retained as evidence but cannot be admitted as complete required F1 coverage.
- [ ] Write root contract cases in `selection.test.mjs` for all four lifecycle stages. A first `CaptureRequest` lacking future generated IDs/stop/review facts is valid; a sealed draft with exact outputs stays unreviewed. Independent review plus an unchanged-old-image control promotes it to `QualifiedFixture`. Missing issued-F1 identity/recipient, stopped evidence, old-image control, checked arithmetic or independent review prevents promotion; current-writer origin fails. Publication binds unchanged bytes and external inventories to release asset IDs before `Fixture` index admission. An unreviewed draft never reaches selection. Observe red, implement the named parsers/promotions, then run green.
- [ ] Version `scenario.mjs` and `reads.mjs` by the exact source SHA. Drive invented staff Ana/Luis, permissions/device profiles, invitations/PIN/login and distinct staff/customer/kitchen names through actual historical requests/UI. Freeze request/response/returned-ID maps; any HTTP refusal is failure, not a call to a lower-level writer.
- [ ] In `scenario.test.mjs`, use a scripted historical HTTP peer with independently enumerated accepted routes/bodies from that source trace. Assert login/enrolment/permission refusals abort without any domain fallback, F1 refusal cannot become unpaid-order coverage, returned IDs feed later requests exactly, and stop failure prevents sealing. Run `pnpm exec vitest run scripts/a799/scenario.test.mjs` red then green as each historical adapter is added; cover its reads and stop paths too. Fake-peer results qualify the driver only, never the actual capture.
- [ ] Create/publish catalogue with variant/modifier and exact weighted cheese/coffee/wine sale, cash/manual tender/change and actor. Independently calculate `7.70 + 2.20 + 3.63 = 13.53`, VAT groups `9.00+0.90` and `3.00+0.63`; compare old response and raw stopped rows. Unexplained arithmetic mismatch rejects capture, never changes the expectation.
- [ ] Change live cheese price to `24.00` and names, publish again; old `0.350` line remains `7.70`. Issue required F1 to invented Mara Soler, 18 Market Street; later change live customer details through a supported path where available. Pin the issued invoice's original recipient, original assigned number/time/IDs and bytes independently of the live customer.
- [ ] Also retain unpaid recipient order, parked order, pending fiscal outbox with no attempts/advancement, workforce in/break/out events and supported kitchen send/recall history without hardware. Explicitly name unsupported journey prerequisites; none can be silently omitted from complete qualification.
- [ ] Use a supported optional-module disable path after writing a booking and retain its rows/configuration. If no safe disable exists, capture a separate never-enabled fixture with absent-data/schema assertions and report disabled-retained coverage MISSING. Never enable every module at candidate boot; the missing case remains visible in admission/reporting.
- [ ] After separate capture authority, run `node bench/real-upgrade/cli.mjs capture --request <capture-request.json>`. Produce `capture-draft.json` naming the pinned whole-state and transcript/facts/raw-byte/schema/protection archives, each with its external inventory, marked unreviewed. Seal these BEFORE candidate access. An independent reviewer checks original product outputs against raw typed facts/arithmetic and the inventory; no candidate result participates.
- [ ] Freeze new-sale input/arithmetic at this point too: one `0.350` cheese line at `24.00` totals `8.40`; pin its tax/rate and exact independently calculated split according to the scenario. Define generated new ID uniqueness and issue-time bounds as predicates, while every old assigned fact remains byte-exact.
- [ ] Run `node bench/real-upgrade/cli.mjs qualify --draft <capture-draft.json> --review <review-receipt.json>` only after runtime approval and independent review: use the pinned local originals, require the unchanged-old-image control, containment/capture checks, clean stopped inspection and nonzero comparisons, and produce `qualified-fixture.json` with hash-bound review/control receipts. This needs no published index. Same-image is explicitly restart-only. Repeat from identical pinned originals for the same judgement, not regenerated IDs/time.
- [ ] Only after qualification and separate publication authority, retain each bundle/evidence version in its source release's own Waitron GitHub Release. Bind the uploaded asset IDs to the qualified hashes, sizes and both external inventories, then append the published `Fixture` descriptor/limits/review/control receipts to the trusted index. Never index a draft or overwrite originals. Verify private retrieval through existing access. A corrected fact set needs evidence against unchanged old bytes/transcript, independent review, new version and retained original defect notice.
- [ ] Commit reviewed interface/index evidence with `git commit -s -m "test: qualify a frozen historical product upgrade source"`. Release upload is a separate recorded operation, never implicit in that commit.

## Task 6 / PR 6: preserve, restart, then sell on another disposable copy

**Files:** run/candidate/controls/mappings and tests from the map. **Consumes:** selected `Cell[]`, verified inputs, strict mappings, independent `Facts.newSale`. **Produces:** `runCell(cell: Cell, deps: CellDeps): Promise<CellResult>` and `runControls(spec: ControlSpec): Promise<ControlResult[]>`. `CellDeps` supplies Task 4 rig/inspection and Task 2 comparison; `CellResult` reports pending-migration evidence, preservation, restart, new-sale and cleanup separately, never one compensating boolean.

- [ ] Write `run.test.mjs`: no candidate callback before fetch/admission/sealing review; each cell gets independent non-hardlinked state. Candidate mounts no expected facts/transcript and cannot write the source. A pristine-input hash mismatch after execution fails even if comparisons pass.
- [ ] Launch unchanged candidate `node /app/node-entry.js` with packaged SQL/meta and normal ahead/stamp/first-setup/boot checks. Before launch compute pending applicable hashes from sealed journals and separately reviewed packaged inventory. After clean stop require old journal rows exact, expected new hashes/dates present once, full expected enabled-set completion and observed schema delta. Logs and row counts alone cannot prove migration.
- [ ] Build protection/schema expectations from frozen old definitions plus exact reviewed migration mappings and the candidate's declarations, pinned to source/SQL hashes before launch. Include full columns/types/defaults/nullability, PK/unique/index expressions and predicates, CHECKs, FK columns/actions, views and trigger targets/bodies. Keep engine metadata separately accounted. A freshly built database or candidate inspection output never becomes its own authoritative expected schema.
- [ ] Wait for trading mode and a fresh normal authenticated historical read; setup/recovery 200, health alone, expired captured session or failed fresh login fails. Stop before raw inspection. Enumerate activity/session/recovery/log effects by exact field and cause; no blanket local-table exemption or writable handle beside the running server.
- [ ] Compare preservation first, including issued F1 original recipient, all relationship tuples, scaled/typed facts, raw fiscal/event bytes, schema/protection, module-off state, next-number/node/SIF/head. Apply only reviewed exact mappings keyed to source/candidate SQL hash. No matching mapping means unexplained delta fails, not “update snapshot”.
- [ ] Restart the preserved copy normally, stop and compare again. Preserve separate restart result and operational transitions. Then hash and copy the stopped preserved state to a second disposable folder for the new sale; no restore or identity allocation. Keep the first preserved result untouched.
- [ ] Through candidate normal login/device/sale routes, issue the independently specified `8.40` sale. Assert same node/SIF/installation/series, exactly the captured next invoice number, next number advances once, one new linked fiscal record extends the captured predecessor/sequence/head, expected line/tax/tender/change and actor, and every old fiscal byte remains exact. Validate generated new ID/time predicates, not old time tolerances. Do not compute expected totals from returned totals or replace bytes with recomputed hashes.
- [ ] Run `pnpm exec vitest run scripts/a799/run.test.mjs scripts/a799/controls.test.mjs` red, implement exports/phase reporting, run green with assertion counts. Positive orchestration control must execute each phase; failing preservation must prevent the new-sale phase and still clean up.
- [ ] After runtime approval, run `node bench/real-upgrade/cli.mjs check --index bench/real-upgrade/index.json --candidate <candidate.json>`; expect nonzero named entities plus separate preservation/restart/sale outcomes. No pending migrations yields restart-only and leaves the real-upgrade requirement OPEN. A distinct later applicable migration run is mandatory before closure.
- [ ] Implement dedicated controls under `bench/`, never qualifying originals: change a non-fiscal catalogue value; delete/swap a non-fiscal child while retaining equal aggregate counts; change a same-name non-fiscal protection definition in a comparison copy; corrupt an archive copy; wrong epoch/image; lock contention; blocked request/worker; resource exhaustion; cleanup refusal. Assert exact failure phase/ID/field beside unchanged accepting controls. Never mutate protected fiscal rows/source/history/goldens.
- [ ] Run `node bench/real-upgrade/cli.mjs controls --index bench/real-upgrade/index.json --candidate <candidate.json>`. Then separately remove relevant comparison/admission clauses in disposable harness checkouts and rerun their controls; detection assertions must now fail. Do not edit a product migration to manufacture pending work; wait for a genuine applicable candidate.
- [ ] Run protected tests unedited where the rig approaches fiscal seams: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts`. Check the current package for additional golden/huella suites and run those too, preserving assertions. This is extra evidence, never a byte-preservation substitute.
- [ ] Commit with `git commit -s -m "test: check packaged upgrades and separate continued sales"`.

## Task 7 / PR 7: wire trusted inputs, required matrix and publication failure

**Files:** workflow/classifiers/gate tests from the map. **Consumes:** index selector, candidate image digest, per-cell results. **Produces:** trusted `VerifiedInputs` handoff, `a799-required` result included in `ci`, publication refusal unless every required cell reports complete results at the current candidate SHA.

- [ ] First resolve the execution trust boundary in review. Proposed `.github/workflows/real-upgrade.yml` runs only from a pinned protected default-branch workflow revision, with an explicitly pinned candidate SHA as data. Its read-only fetch job executes only trusted pinned scripts/index, never PR-supplied workflow/script/action hooks, before any candidate build or code. No privileged `pull_request_target` candidate checkout or candidate execution in the fetch job.
- [ ] A separate fresh candidate runner/job receives only hashed test-only inputs through existing artifact transfer, with job permissions removed and `persist-credentials:false`, a fresh empty Docker config and no registry login. Token/helper/config files never transfer. Build candidate once by `deploy/Dockerfile`, record exact image/platform digest and packaged SQL/meta inventory, then launch only inside Task 4 containment. Recheck handoff hashes and input origin against the trusted run/revision.
- [ ] Verify this exact private-download/transfer arrangement with existing CI access and approvals. Workflow triggering, fork restrictions or inability to report a trusted current-head result may block the gate; report that explicitly. Do not create a token, expand permissions, enable a provider or quietly use a PR-controlled fetch. A candidate lacking trusted input evidence cannot pass or publish. This unresolved integration is an execution gate, not an access guarantee.
- [ ] Write `gate.test.mjs` and extend classifier/workflow tests first. Docs-only selects no image cells; affected module plus dependents selects its fixtures; entry/store/migrations/composition/image/shared config/index/harness/unknown path selects the full required endpoint matrix. Release/main/tag publication always requires all selected endpoints and required variants. Fiscal-none gets cells only with declared support and cannot replace VeriFactu.
- [ ] Add an `a799` classification output without changing existing `code` meaning; root-script/bench-only changes must still build/test the rig when required despite package scope being empty. Trace every consumer in hook, changes outputs, image/bundle decisions, `ci` aggregate and publish dependency. Validate paths with `git diff` plus workspace membership; do not use pnpm changed-since in a worktree.
- [ ] Assert missing/corrupt/inaccessible/unsafe inputs, empty required matrix, selected-but-skipped job, absent issued F1, failed preservation/new sale/restart/cleanup and stale SHA each fail the aggregate. A `pending-upgrade` cell missing actual migration evidence fails. A legitimately no-pending cell can pass its separately labelled restart/preservation checks but never satisfies A799's required real-upgrade case. Passing R1/R4 creates no R2/R3 result. An intermediate original remains retrievable even though unselected.
- [ ] Add phase/job deadlines, cancellation and bounded diagnostics; build/fetch failures have separate classifications and no source-mode fallback. Keep all existing schema/synthetic/package coverage jobs. Pin every new workflow job in `ci` dependencies or in its verified trusted-result requirement; publish remains downstream of `ci`.
- [ ] Run `pnpm exec vitest run scripts/a799/gate.test.mjs scripts/changed-scope.test.mjs scripts/changed-packages.test.mjs scripts/ci-workflow.test.mjs scripts/root-scope-consumers.test.mjs` red then green. Deleting the aggregate dependency or making a missing cell “skipped” must fail its negative control; a complete current-head matrix passes.
- [ ] Exercise selection in a disposable clone or actual authorised PR and inspect actual current-head jobs/Tests/coverage reports. Read `changes` outputs and each result; green skipped selection is not execution. Trusted gate itself must fail on an intentionally missing required input and accept the unchanged valid control before being used for publication.
- [ ] Commit with `git commit -s -m "ci: require real historical upgrade evidence before publication"`.

## Numerical qualification and diagnostic contract

These historical spec bounds are PROVISIONAL planning gates, not owner-approved measured limits:

| Phase                         | Proposed bound |
| ----------------------------- | -------------: |
| Fetch                         |           30 s |
| Admission/copy                |           20 s |
| First boot                    |           90 s |
| Reads/stop/preservation       |           40 s |
| Second-copy boot/sale         |           40 s |
| Cleanup reserve               |           20 s |
| Cell outer deadline           |          240 s |
| Individual request            |            5 s |
| Old-fixture authoring journey |     10 minutes |

The listed phase maxima sum to 240 s and leave no additional restart allowance. Measure the full sequence, including both clean stops, restart, extraction and diagnostics. Qualification must either fit every operation inside the measured allocation or split preservation/restart and new-sale cells with a hashed stopped intermediate plus independent originals. A slow result triggers investigation/review of a measured split, never shorter coverage or a silent timeout increase. Bound candidate build and image retrieval separately from cells; derive and record their numeric deadlines/retry schedules from authorised qualification measurements before enabling CI.

Compressed/unpacked/per-file/entry, log, RAM, scratch and process caps remain unset execution prerequisites until measured on eligible sources/platforms and reviewed. Index admission requires finite recorded caps before any archive/candidate use. Use bounded preflight qualification in an owned environment; do not infer capacity from `/dev/shm` availability or copy synthetic walk timings. Establish runner headroom before parallel cells; no automatic parallelism assumption.

Record phase/start/end/duration, candidate SHA/digest/platform, original bundle/evidence hashes, source/epoch/module variant, mapping IDs, actual comparison/assertion counts and exact typed differences. Capture bounded process/container/state snapshots on stalls before cleanup. Failure reports include phase, classification, original entity key/field and remaining owned IDs. Keep redaction explicit: no environment dump, authorization header, vault/TLS/private-key bytes, credentials or whole archive in logs/artifacts. Test sentinel secrets through success/failure/timeout/cleanup output; test-only passwords remain sealed evidence, not ordinary CI output.

## Review, validation and signed branch handoff for future code cuts

- [ ] For each code cut, retain red/green/deletion-control receipts and nonzero Tests counts. Inspect the per-file coverage table for every new root/bench module at `98/98/98/95`; use `pnpm exec vitest run --coverage` through the normal hook, not a duplicate automatic whole-workspace local run.
- [ ] Run focused unchanged schema guards when touching their seams: `pnpm exec vitest run scripts/migration-upgrade.test.ts scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts`. Do not widen synthetic reset allowances to excuse this rig.
- [ ] Inspect full base-to-tip source/prose claims and all sentinel/selection consumers; leave protected product paths/tests byte-unchanged. Unknown intentional schema deltas require a separately reviewed exact mapping, not a migration repair in A799.
- [ ] Check staged paths, use `git commit -s` for every commit, and announce readiness for `finish-branch`. For future meaningful code cuts, run the normal finish-branch review, including one Claude whole-branch run-it review in its own temporary installed checkout after initial rebase, triage findings inline and retain its completed report. Do not force per-task subagents or repeat reviews for a rebase alone.
- [ ] Push only when separately authorised, through the normal pre-push hook, never `--no-verify`. Wait for required coverage/merge and upgrade jobs on the exact current head. Do not merge without owner `land-branch` approval. No plan checkbox grants upload or release publication authority.

## Traceability and closure

| Requirement in the current spec                         | Implementing tasks / closure evidence                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A old-product provenance; exact E facts                 | 4/5: supported historical transcript, clean whole-state capture, exact assigned bytes and independent review before candidate access   |
| B endpoint selection; F retirement/all originals        | 1/7: `[oldest,previous]`, equality deduplication, owner effective-candidate retirement, retained intermediate/retired checksums        |
| C own GitHub Release/private existing access            | 3/5/7: committed hashes, per-source assets, verified trusted private fetch and credential-free handoff; separate publication authority |
| D issued F1 original name/address                       | 2/5/6: same issued invoice raw recipient snapshot preserved; absence keeps A799 open                                                   |
| Actual A760 epoch and pending migration                 | 1/5/6: actual reset/baseline receipt, distinct packaged candidate, exact before/after journal/schema evidence                          |
| Optional-off distinction and complete protection        | 2/4/5/6: never-enabled versus disabled-retained explicitly reported, full schema/trigger definitions and reviewed mappings             |
| Preservation plus separate new sale                     | 2/6: exact original facts first, restart check, second disposable copy extends same number/chain with independent arithmetic           |
| Safe archives, containment, ownership, failure controls | 3/4/6/7: positive/negative/deletion controls, bounded phases, exact diagnostics, no missing-input skips                                |
| Original gates and protected fiscal core unchanged      | 6/7 and branch handoff: unedited protected tests, normal hook, current-head CI and completed review                                    |

A799 cannot close on a harness commit, restart, F2, unpaid recipient order, new sale, absent required fixture or an unrun matrix endpoint. Close only with qualified post-reset endpoints, mandatory issued-F1 preservation, a real pending-migration upgrade, separate continued-sale results, reproducible judgement on pinned originals and passing containment/failure/CI evidence. Name every missing coverage item and prerequisite with its receipt; do not infer a product fix from a backlog number.

## Owner-plan-approval handoff

Read this complete plan and its independent documentation review before deciding whether to approve the plan. The design approval covers preparation of this document only.

Known execution gates remain: actual A760 reset/baseline, qualifying immutable source/platform/image, normal-route issued F1 and its verified prerequisite if absent, safe historical identity/lock/interfaces, optional-module capability, measured archive/resource/timing caps, observed containment, private-download/credential isolation and trusted current-head CI integration. None is recorded as available or passing.

Use the following approval packet for later requests. These are separate scoped decisions, not permissions granted by this plan:

| Later decision               | Concrete inputs to put before the owner                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete implementation plan | This exact plan revision, independent review findings, inline execution method and seven PR cuts                                                               |
| Build/runtime qualification  | Named worktree/SHAs/platforms, image digests or exact build inputs, owned scratch/network/process scope, proposed measured limits and cleanup contract         |
| Historical capture           | Named eligible post-reset source, supported routes/identity inputs, invented scenario, F1 capability evidence, custody and independent evidence-review process |
| A760 execution/reset         | A760's own separately approved roster, targets and baseline/reset receipts; nothing in this plan extends them                                                  |
| Candidate migration run      | Named disposable copies, original hashes, exact candidate digest and applicable packaged pending work; no operator venue                                       |
| Bundle publication/upload    | Exact source release, new asset/version names, hashes, test-only content inventory and retained-original policy                                                |
| Trusted CI activation        | Reviewed default-branch workflow revision, credential-free handoff evidence, existing access verification and current-head result linkage                      |

After the documentation review, ask the owner to approve this complete plan for
the stated inline execution method. Keep build/probes/capture, A760 reset,
migrations and uploads/publication as separately scoped decisions with exact
targets and custody. Owner approval of the plan itself and landing these docs
do not silently open those gates. Until those approvals and prerequisites exist,
stop at the documentation handoff.

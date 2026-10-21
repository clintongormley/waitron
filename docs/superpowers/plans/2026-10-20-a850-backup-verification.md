# A850 backup verification Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` and execute inline, task by task. No required per-task agents. Steps use checkboxes. Land this document separately as documentation before implementation begins.

**Goal:** Verify that an exact encrypted backup restores all required data and secrets for an exact Waitron target, without acquiring or exercising fiscal authority.

**Architecture:** Each shipped module declares its verification obligations. The server validates and places a private copy, runs real migrations, then checks original and migrated data through enforced query-only handles. Negotiated recovery v2 carries the same target descriptor to the replacement binary, which compares it again before placement.

**Tech stack:** TypeScript, Node `node:sqlite`, existing WBA1/WBK1 file codecs, SQLite migrations, existing pure cryptographic readers and Vitest. No new service or Waitron database schema is expected.

**Spec:** [Cloud #211 approved revision](https://github.com/waitron-io/waitron-cloud/blob/f8e243f4b6fa232756a64c7113f05e3bf835158b/docs/superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md). Cross-repository executors also read `/Users/clintongormley/workspace/repos/waitron-cloud/docs/superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md` in full. On 2026-10-20, `gh api 'repos/waitron-io/waitron-cloud/commits?path=docs/superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md&per_page=1'` returned `f8e243f4b6fa232756a64c7113f05e3bf835158b` as the latest file revision. `gh pr view 211 --repo waitron-io/waitron-cloud --json mergeCommit,state` returned that merged commit. Cloud files are read-only for A850.

## Global constraints

- Plan source base: `2ce28a8929989270f3f2bea70607dce6ccf8508d`, including A679 `4e318802f6e62a050aa754c5a343a527cd45ae3c`. Re-read changed seams after rebase. The design's `e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee` source observations are historical, not runtime evidence.
- A850 is Waitron-only lane E work. Cloud worker/controller, persistence, catalogue admission, API/portal/alerts, retention and deployment implementation belong to lane D. A plan landing does not mean an interface landed.
- RUNNER H2 prohibits edits to `computeHuella`, number allocation, `registros_facturacion`, alta builders, `registerSif` and `restoreFiscal`. Leave `allocated-lifecycle.ts`, allocation/preparation and all ordinary restore authority checks unchanged. Add independent readers. If a protected edit actually becomes unavoidable, present the exact path/change/reason as an owner gate **before editing**; this plan grants no exception.
- No `skipFiscal`, verification use of `skipSecrets`, skipped hooks presented as verification, rolled-back activation or fake authority. A required data effect without an independent check returns `needs_authority`. Activation-only effects are explicitly outside the result.
- Private protocol: `backup-data-restore/v1`; activation always `not_attempted`. Archive manifest v1 and signed capture publication gain no invented source-revision assertion.
- Preserve one child, **1,024 MiB memory/256 MiB scratch**, and **30-second watchdog**. Cloud owns pinned read-only image, unprivileged identity, dropped capabilities, bounded CPU/processes, no network/Docker socket/host mounts and private quota-limited scratch. Exhaustion is unavailable. A limit increase needs separate measured justification.
- Current v1 embeds the vault key. External custody still requires the separately versioned `external-vault-archive-v2` dependency. Missing external material is unavailable; never fetch it or supply Cloud sealing/storage/provider/activation authority to the child.
- No Waitron migrations expected. Report an actual unmet migration requirement rather than adding unrelated migration/compatibility work. Never edit shipped SQL, relax guards/excludes/coverage `98/98/98/95`/mutation floors, or alter protected fixtures/goldens.
- Preserve existing v1 and continuous behavior under the approved contract. The new qualified snapshot path requires v2 and never downgrades. Keep snapshots unavailable and deployment enforcement off until joint real pinned-runtime acceptance/release.
- Implementation uses failing behavioral tests first, counted focused local passes, normal pre-push hook and current-head CI package coverage. A850 is FULL but **not W41s**: one normal Claude run-it whole-branch review during `finish-branch`, not W41s' two-review requirement. No automatic merge.

## Review focus

1. Schema zero and disabled modules can retain evidence: Tasks 3/19 reject unexplained state and require explicit owner not-applicable checks.
2. Re-registration leaves historical segments and an empty current pointer: Tasks 8–10 verify all history without rejecting that legitimate state.
3. A well-shaped key can still be wrong: Tasks 11–14/22 distinguish parsing from actual decryption and keep uncertain key failures unavailable.
4. The replacement binary can change after approval or staging: Task 26 compares the running target again before placement.
5. Passed callbacks followed by uncertain cleanup cannot certify a point: Task 23 withholds results until owned plaintext/handles/scratch are removed.

## Current source receipts

These anchors refer to the plan base. No test, restore, migration, isolation probe or deletion experiment was run during authorship.

| Current source                                                                                                                                                                  | Seam and changes since the design pin                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/module/src/module.ts:1423`; `packages/module/src/restore.ts:18`                                                                                                       | Backup has no verification contribution. Restore hooks concern taking identity and trading; extend the contribution without reinterpreting hooks.                                                                       |
| `packages/composition/src/modules.ts:108,255`; `packages/media/src/module.ts:37`                                                                                                | Generate inventory from `ALL_MODULES`, including media. Fiscal backup now includes retained hour history and committed-resume checking.                                                                                 |
| `apps/server/src/restore.ts:212,283,337,445,641,681,712,823`                                                                                                                    | Metadata/path/identity validation, file placement and migrations can be shared. `writeValidated` additionally admits operations, writes rebuild marker, runs hooks and changes series. Never invoke it in verification. |
| `apps/server/src/restore.ts:228,345,353,735`; `apps/server/src/state-secrets.ts:87`                                                                                             | A679 adds first-setup host-path refusal, first-setup admission, pre-placement operation checks and committed resume. Preserve these ordinary behaviors.                                                                 |
| `apps/server/src/recovery-backup-preview.ts:38,70,82`; `apps/server/src/backup-sources.ts:12,47,60`                                                                             | Preview now selects fiscal evidence and retained preparation history; it remains a private identity preview, not verification. Capture omits preparation history when both current and retained histories are empty.    |
| `packages/fiscal-verifactu/src/hour-backup-state.ts:13,47`; `src/hour-history-reader.ts:45`; `src/hour-history.ts:38`                                                           | A679 adds `secrets/module-evidence/fiscal-verifactu/hour-history.json` and history across series, registrations, allocations and reservations.                                                                          |
| `packages/fiscal-verifactu/src/verify.ts:41,50`; `src/schema/cadenas.ts:25`; `src/registro-sif.ts:53`                                                                           | Operational verification reads only two records. Node sequence continues across SIFs; registration resets pointers without resetting sequence. Add a separate full reader.                                              |
| `packages/fiscal-verifactu/src/classification.ts:5`; `src/schema/certificate-installs.ts:12`; `src/certificate-file.ts:46`                                                      | Current evidence includes certificate-install history absent at the design pin. Offline PFX opening is separate from `certificate-check.ts:45`'s AEAT request.                                                          |
| `packages/fiscal-verifactu/src/cloud-evidence.ts:300`; `src/register-history.ts:266`; `src/paper-register-history.ts:311`                                                       | Public signature/history readers are separate from authorised allocation validation; use those distinctions for captured evidence.                                                                                      |
| `packages/db/src/classification.ts:17`; `src/schema/series.ts:23`; `src/order-amendment-hash.ts`; `packages/reporting/src/verify-daily-close-chain.ts:45`                       | Core owns issued evidence/counters/amendments. Reporting walks full closes and stored head but takes a writable transaction type. Add an independent query adapter.                                                     |
| `packages/credentials/src/keyring.ts:28`; `src/store.ts:43`; `src/purposes.ts:11`; `packages/identity/src/mfa.ts:33`; `apps/server/src/boot.ts:1347`; `src/account-key.ts:9,24` | Vault shape is not usability. TOTP uses an account-purpose key derived from the archived account/vault inputs, not the vault key directly; pending enrolments also need authentication.                                 |
| `apps/server/src/state-secrets.ts:16`; `src/backup-optional-state.ts:10`; `src/artifact-cipher-file.ts:44`                                                                      | Six required files, optional backup/module config, and authenticated file decryption remain inputs.                                                                                                                     |
| `packages/store/src/index.ts:185`; `packages/migrations/src/apply.ts:45`; `src/schema-version.ts:29`                                                                            | A real read-only connection exists; normal store opening also creates writers. Use a separate query handle and actual journal histories, not only counts.                                                               |
| `apps/server/src/cloud-recovery.ts:51,252,384`; `src/restore-request.ts:130,158,299,455`; `src/boot.ts:1034`                                                                    | Client remains v1; current archive request uses `recoveryKey`. Carry version binding through restart, not only preview/download.                                                                                        |
| `scripts/bundle-node.mjs:36`; `scripts/generate-hour-release.mjs:17`; `packages/fiscal-verifactu/src/hour-release.ts:29`                                                        | A679 supplies embedded hour provenance. Add separate verification build identity without changing hour policy.                                                                                                          |

`git diff e52c997c02d2fcd66d0e7239cbfd79ced4ddd0ee..HEAD -- <these paths>` and the A679 commit were read. These are source changes, not measured behavior. The installed Cloud `node_modules/@types/node/sqlite.d.ts:346` describes `setAuthorizer` since v24.10.0; Task 2 still must run its restriction tests on the actual target engine.

## Interfaces and file responsibilities

This section specifies the final interfaces. The task checklists and execution checkpoint below distinguish implemented exports from planned ones. `Environment` is the structural literal union `"preproduction" | "production"`, matching existing `DeploymentEnvironment` without a package-to-app import; `BackupValue`, `BackupRow`, and `BackupQuery` come from the new store file below. All digests are lowercase full SHA-256; revisions are full 40-hex. Copy/freeze admitted inputs so later mutation cannot change a bound request.

### Query and owner semantics

Create/export `packages/store/src/backup-query.ts`:

```ts
type BackupValue = null | string | number | bigint | Uint8Array;
type BackupRow = Readonly<Record<string, BackupValue>>;
interface BackupQuery {
  rows(sql: string, values?: readonly BackupValue[]): AsyncIterable<BackupRow>;
}
function openBackupQuery(
  databasePath: string,
): Promise<{ query: BackupQuery; close(): Promise<void> }>;
```

The host alone owns path/open/close. Use `DatabaseSync({readOnly:true,allowExtension:false})`, set query-only before callbacks, then a default-deny authorizer allowing SELECT/READ/RECURSIVE and only required pure functions (`count`, `max`, `min`, `length`, `hex`, `coalesce`, `json_valid`). Deny PRAGMA changes, attachments, transaction control, writes, DDL, extensions and other functions. Host integrity/FK checks use a separate private handle. The host wraps entries.read so callbacks can read only their declared recovery entries/secret inputs; an undeclared read refuses and its behavioral test must detect removal of this scope check. Expose no engine/Drizzle handle or authorizer setter. Stream rows; bind values and quote validated identifiers. Do not call an inserting head reader.

Create/export `packages/module/src/backup-verification.ts`; extend `ModuleBackupContribution` with `verification?:BackupVerificationContribution`:

```ts
type BackupModuleStatus = "passed" | "invalid" | "needs_authority" | "unsupported";
type BackupCheckCode =
  | "data"
  | "immutable"
  | "chain"
  | "head"
  | "history"
  | "source"
  | "secret"
  | "entries"
  | "effects"
  | "not_applicable";
interface BackupModuleCheck {
  code: BackupCheckCode;
  status: BackupModuleStatus;
}
interface BackupModuleResult {
  status: BackupModuleStatus;
  checks: readonly BackupModuleCheck[];
}
interface BackupEntries {
  read(name: string): Promise<Uint8Array | null>;
}
interface BackupVerificationContext {
  before: BackupQuery;
  after: BackupQuery;
  entries: BackupEntries;
  source: { nodeId: string; locationId: string; environment: Environment; createdAt: string };
  sourceSchema: number | null;
  targetSchema: number;
  signal: AbortSignal;
}
interface BackupVerificationContribution {
  version: 1;
  publicEvidenceDigest: string | null;
  data: {
    kind: "database_only" | "custom";
    tables: readonly string[];
    immutableTables: readonly string[];
    checks: readonly BackupCheckCode[];
  };
  secrets: readonly string[];
  entries: readonly { name: string; presence: "required" | "optional" }[];
  effects: readonly { id: string; kind: "data" | "activation"; check: BackupCheckCode | null }[];
  zeroSchema: "absent_tables_and_entries" | "empty_schema";
  targetOnly: "empty_after_migration" | "unsupported";
  verifyRestoredData(context: BackupVerificationContext): Promise<BackupModuleResult>;
}
class BackupVerificationUnsupported extends Error {
  readonly reason: "module_missing" | "semantics_missing" | "target_incompatible";
  constructor(reason: "module_missing" | "semantics_missing" | "target_incompatible");
}
class BackupCheckUnavailable extends Error {
  readonly reason: "secret_unavailable" | "decryption_unavailable" | "resource_limit";
  constructor(reason: "secret_unavailable" | "decryption_unavailable" | "resource_limit");
}
function validateBackupVerificationContribution(value: unknown): BackupVerificationContribution;
function validateBackupModuleResult(
  value: unknown,
  contribution: BackupVerificationContribution,
  notApplicable: boolean,
): BackupModuleResult;
```

`sourceSchema:null` means target-only, distinct from zero. Require a non-null check for every data effect; activation effects have null. Empty secret/entry/effect lists are explicit. The callback must return exactly its declared unique checks and fixed statuses, no reports. Legitimate schema-zero/target-only cases use the sole `not_applicable` result after owner rules succeed. Missing checks are unsupported. Inventory/declaration admission throws BackupVerificationUnsupported with its fixed reason, which the host maps to unsupported; never classify by arbitrary error text. `BackupCheckUnavailable` is a fixed private signal for inconclusive inputs; unexpected exceptions also make the attempt unavailable. Never export its stack/message.

Create/export `packages/credentials/src/backup-key-inputs.ts` with `resolveBackupKeyInputs(input:{secretsEnv:Uint8Array;tradingEnv:Uint8Array;backupEnv:Uint8Array|null}):Readonly<Record<string,string>>`. This is a pure, archive-only copy of the existing first-equals env parsing and later-file precedence in `apps/server/src/env-file.ts` and `box-env.ts`, with no ambient environment. All vault and account/TOTP readers consume this one resolved map. Their contributions explicitly declare `secrets.env`, `trading.env` and optional `backup.env` as private inputs; an owner never reads an undeclared entry. Do not put an app import in a package.

The managed layout continues to omit `backup.env` as `restoreOwned` currently does. Qualification must compare captured effective cryptographic inputs with **actual placed-layout** inputs from `loadBoxEnv({}, placedStateDir)`, `loadKeyRing` and `resolveAccountKey`, including current/previous key bytes, versions and derived account/TOTP keys. Differences that change secret usability return `unsupported/target_incompatible`, never corruption or pass. Do not move keys, reseal data, copy the old destination, or change ordinary restore. Equal effective keys despite redundant file assignments are accepted. A key available only from the excluded file is an explicit unsupported layout, even if the original archive can decrypt it. Keep all comparison values private.

Create/export `packages/db/src/backup-evidence.ts`. Use structural types and store imports, **no db-to-module dependency**:

```ts
interface BackupTablePolicy {
  table: string;
  immutable: boolean;
  addedColumns: Readonly<Record<string, BackupValue>>;
}
function compareBackupTables(input: {
  before: BackupQuery;
  after: BackupQuery;
  policies: readonly BackupTablePolicy[];
}): Promise<boolean>;
function verifyCoreBackupData(input: {
  before: BackupQuery;
  after: BackupQuery;
  nodeId: string;
  locationId: string;
  environment: Environment;
}): Promise<boolean>;
```

Compare complete typed rows as deterministic multisets, preserving null/text/integer/blob distinctions, every source column, exact fiscal/money strings and all original rows. Stream/spool privately within quota; no row hash leaves scratch. `addedColumns` names the only allowed default additions, not permission to ignore dropped/changed source columns. Unknown transformations return unsupported at the compatibility boundary. Owner policies cover **every** classification table, including local state; append-only tables plus stored heads/counters/history get explicit immutable preservation policies. A schema migration may add only explicitly empty tables or the declared additive column defaults. No blanket seed-row exemption exists.

### Strict private request/result and target

Create `apps/server/src/backup-verification-protocol.ts` with these exact types:

```ts
interface BackupTargetModule {
  name: string;
  packageVersion: string;
  requires: Readonly<Record<string, string>>;
  schema: number;
  migrationTable: string;
  migrationDigest: string;
  semanticsVersion: number;
  policyDigest: string;
}
interface BackupVerificationTarget {
  version: 1;
  runtime: { release: string; revision: string; fingerprint: string };
  modules: readonly BackupTargetModule[];
  compositionDigest: string;
  migrationDigest: string;
  policyDigest: string;
  digest: string;
}
interface BackupVerificationRequest {
  protocol: "backup-data-restore/v1";
  captureId: string;
  pointId: string;
  venueId: string;
  sourceInstallationId: string;
  sourceNodeId: string;
  capturedAt: string;
  archive: {
    sha256: string;
    bytes: number;
    manifestVersion: number;
    environment: Environment;
    modules: Readonly<Record<string, number>>;
  };
  backupKey: { version: number; reference: string };
  target: BackupVerificationTarget;
  verifierImage: string;
  attempt: {
    jobId: string;
    number: number;
    claimId: string;
    controllerScope: string;
    childToken: string;
    deadline: string;
  };
}
type BackupVerificationReason =
  | "none"
  | "request_invalid"
  | "archive_digest_mismatch"
  | "archive_size_mismatch"
  | "archive_invalid"
  | "archive_format_unsupported"
  | "binding_mismatch"
  | "sqlite_integrity"
  | "module_integrity"
  | "module_missing"
  | "target_incompatible"
  | "semantics_missing"
  | "module_data_check_requires_authority"
  | "secret_unavailable"
  | "secret_invalid"
  | "secret_format_unsupported"
  | "decryption_unavailable"
  | "cancelled"
  | "deadline"
  | "resource_limit"
  | "cleanup_uncertain"
  | "unexpected";
interface BackupVerificationResult {
  protocol: "backup-data-restore/v1";
  requestDigest: string;
  attemptToken: string;
  measuredArchive: { sha256: string; bytes: number } | null;
  targetDigest: string;
  policyDigest: string;
  modules: readonly {
    name: string;
    semanticsVersion: number;
    status: BackupModuleStatus;
    checks: readonly BackupModuleCheck[];
  }[];
  status: "passed" | "invalid" | "needs_authority" | "unsupported" | "unavailable";
  reason: BackupVerificationReason;
  activation: "not_attempted";
}
function readBackupVerificationRequest(raw: string): BackupVerificationRequest;
function backupVerificationRequestDigest(request: BackupVerificationRequest): string;
function readBackupVerificationResult(
  raw: string,
  request: BackupVerificationRequest,
): BackupVerificationResult;
```

Reject duplicate JSON keys before parsing loses them, unknown keys recursively, duplicate modules/checks and noncanonical values. Bounds: request 64 KiB, result 32 KiB, 64 modules, 16 checks/module; module IDs `[a-z][a-z0-9-]{0,63}`; opaque IDs 1–128 printable non-whitespace ASCII bytes; other references max 256 bytes; canonical UTC millisecond timestamps; positive safe integer sizes/attempts/key versions, nonnegative schemas. `captureId===pointId`. Image must be a content digest reference, not mutable tag. Cloud archive input bound is 1–536870912 bytes, not a change to local archive limits. Manifest/semantics versions are positive integers on the wire so a well-formed unsupported version can return unsupported, rather than be mistaken for malformed data; this implementation supports manifest 1 and owner semantics 1 only. Bad wire input throws a fixed parser error with no supplied text; the controller records unavailable, not archive failure. Early failure may return empty modules or null measurement; passed requires exact complete coverage and measured bytes.

Digest SHA-256 over UTF-8 JSON of this **fixed-position** array:

`[protocol,captureId,pointId,venueId,sourceInstallationId,sourceNodeId,capturedAt,archive.sha256,archive.bytes,archive.manifestVersion,archive.environment,sortedModulePairs,backupKey.version,backupKey.reference,target.digest,target.runtime.release,target.runtime.revision,target.runtime.fingerprint,target.compositionDigest,target.migrationDigest,target.policyDigest,verifierImage,attempt.jobId,attempt.number,attempt.claimId,attempt.controllerScope,attempt.childToken,attempt.deadline]`.

Sort maps by code-unit key ordering into key/value arrays. Target digest commits to the complete sorted module descriptors and runtime. Composition digest covers names, actual package versions and dependencies; migration digest covers journal bytes and every shipped SQL file's bytes/name/order; policy digest covers every declaration and semantics version, including publicEvidenceDigest. Canonicalise an owner policy as `[version,publicEvidenceDigest,data.kind,sortedTables,sortedImmutableTables,sortedChecks,sortedSecrets,sortedEntryPairs,sortedEffectTriples,zeroSchema,targetOnly]`; callbacks themselves are identified by pinned runtime revision and their declared semantics version. Non-signature owners explicitly declare publicEvidenceDigest:null. Do not derive package versions from schema counts.

Create `apps/server/src/backup-verification-target.ts` exporting `buildBackupVerificationTarget(input:{modules:readonly WaitronModule[];migrationsRoot:string|null;runtime:{release:string;revision:string;fingerprint:string}}):BackupVerificationTarget` and `currentBackupVerificationTarget():BackupVerificationTarget`. The latter reads immutable embedded build provenance and actual shipped assets, never request/env-provided target claims. Missing provenance refuses qualification. Create `scripts/backup-verification-runtime.mjs` exporting `backupVerificationRuntime({source,release,lockfileDigest,descriptorBytes}):{release,revision,fingerprint}`; `source`, `release` and `lockfileDigest` are required strings, and `descriptorBytes` is a Uint8Array. Fingerprint hashes the fixed JSON array `[1,source,release,lockfileDigest,sha256(descriptorBytes)]`. Add a `backupVerificationRuntime` build option to existing `bundle()` without changing hour provenance. This is version binding, not remote attestation; a native target uses its release fingerprint, not a fictitious Docker image.

### Host and placement

Create `apps/server/src/backup-verification.ts`:

```ts
interface BackupVerificationDeps {
  artifactPath: string;
  recoveryKey: { version: number; reference: string; secret: string };
  scratchRoot: string;
  modules: readonly WaitronModule[];
  migrationsRoot: string | null;
  runtime: { release: string; revision: string; fingerprint: string };
  signal: AbortSignal;
  now(): Date;
}
function verifyBackupArtifact(
  request: BackupVerificationRequest,
  deps: BackupVerificationDeps,
): Promise<BackupVerificationResult>;
```

No fake migrator/placement/openDb/verifier or activation/boot/worker seats. Narrow cleanup failure injection is internal-test-only. The closed ciphertext is caller-owned; separately transported recovery-key secret is never serialised. Compare its delivered version/reference with request.backupKey before work; mismatch is unavailable/secret_unavailable, not an archive-integrity verdict. In fresh private 0700/0600 scratch, stream hash/count into an exclusive sealed-input copy, then decrypt **that copy**, preventing replacement of the input path between measurement and decryption. Compare bytes/hash before decrypting. Preserve an unmigrated private original DB plus separately placed/migrated copy. Comparisons are logical evidence comparisons; SQLite inspection can create journal side files, so sample physical fingerprints only after inspection handles close, as testing-guide.md:2265 requires. Nothing reusable leaves scratch.

Create `apps/server/src/backup-data-placement.ts` exporting `placeBackupDatabase(databasePath:string,input:{venueDir:string;modules:readonly WaitronModule[];migrationsRoot:string|null;log:Logger}):Promise<void>` and `placeBackupData(validated:ValidatedArtifact,input:{venueDir:string;stateDir:string;modules:readonly WaitronModule[];migrationsRoot:string|null;log:Logger}):Promise<void>`. Use existing `restoreDatabase`, real `applyMigrations(migrationOptionsFor(orderedMigrationSets(...)))` and `restoreSecrets`; no identity set-aside, hooks, operations, series settlement or markers. Keep ordinary `placeValidated` unchanged: the new host shares its existing exported placement primitives and the real migration engine. This avoids adding a circular import just to share two orchestration calls.

Create `apps/server/src/backup-verification-compatibility.ts` exporting `checkBackupVerificationCompatibility(input:{manifest:BackupManifest;target:BackupVerificationTarget;modules:readonly WaitronModule[];before:BackupQuery;entries:readonly ArchiveEntry[];migrationsRoot?:string|null}):Promise<"passed"|"unsupported"|"invalid">`. Resolve shipped history with the same explicit migration root used to construct the target (`null` by default for source execution). Reconcile all manifest names/counts, actual applied journal histories/hashes, source tables, modules.json, dependencies, identity and environment before migration. Existing `checkRestoreCompatibility` stays permissive for ordinary callers. Refuse unclaimed tables/entries; only exact named journal tables and known SQLite/Litestream internals (`_litestream_seq`, `_litestream_lock`) get explicit schema-checked exceptions.

Create `apps/server/src/backup-verification-secrets.ts` exporting `verifyBackupStateSecrets(entries:readonly ArchiveEntry[],source:{nodeId:string;locationId:string},now:Date,sealedState?:{sealed:Uint8Array;recoveryKey:string}):Promise<{status:"passed"|"invalid"|"unsupported"|"unavailable";reason:BackupVerificationReason}>`. Also export `verifyBackupKeyPlacement(captured:readonly ArchiveEntry[],placedStateDir:string):Promise<"passed"|"unsupported"|"unavailable">` from the secrets file for the captured/actual-layout comparison above; it returns no key material. Create boot-free `apps/server/src/backup-verification-entry.ts` exporting verifier, target builders and strict readers; build to `apps/server/dist/backup-verification.js`. Cloud owns private transport, real child identity, termination and child cleanup in addition to Waitron's scratch cleanup.

## Owner inventory

Generate required coverage from `ALL_MODULES`, not this prose list. `tables` means **all** owning classification tables, including local ones; derive append-only sets with existing `appendOnlyTablesIn`, then explicitly include stored heads/history/counters. Each owner writes declarations and tests in its named new file. No data-bearing owner below is assumed `database_only` merely because it has no hook.

| Owner / task                            | Source receipt and obligations                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| core / 6–7                              | Entire `packages/db/src/classification.ts:17` onward; `schema/series.ts:23`; `schema/node-sealed-state.ts:9`. Custom: all issued/core state rows, counters, identities, amendments and membership evidence. Preserve sealed state; host validates the selected node's decryptable row. Host series replacement/first-start are activation-only. Reporting is a core subcheck, not another module.                                    |
| fiscal-verifactu / 8–10,12              | Entire `packages/fiscal-verifactu/src/classification.ts:5`; schemas for registros/cadenas/SIF/allocations/reservations/filing cases/certificates. Custom: full chains/heads/sequence and all registration, public receipt, allocation, filing and hour-history evidence. Secret `vault:fiscal.aeat`; optional declared hour-history entry. New SIF/series/allocation/promotion and external certificate renewal are activation-only. |
| credentials / 11                        | `packages/credentials/src/classification.ts:13`, `schema/tenant-credentials.ts:13`, `purposes.ts:11–49`. Custom: every row/purpose/key version including deprecated purpose, with actual authenticated decrypt; required `secrets.env` and `trading.env`, optional `backup.env`, resolved through the shared key-input contract. No rotation/reseal/provisioning.                                                                    |
| identity / 13                           | Entire `packages/identity/src/classification.ts:13–65`; `mfa.ts:33`; `schema/totp-enrollments.ts:6`. Custom: all identities/authenticators/session hashes, encrypted TOTP for persons and pending enrolments; required `secrets.env` and `trading.env`, with optional `backup.env` under the shared captured/placed key-input contract. No login/issuance/consumption.                                                               |
| payments / 14                           | Entire `packages/payments/src/classification.ts:11–22`. Custom: payments/refunds, immutable resolutions/holds/outcomes, readers and sale relationships. Present `vault:payments.stripe`/`vault:payments.sumup` need offline checks. No provider effects. Provider adapters are not extra composition descriptors.                                                                                                                    |
| catalogue + media / 15                  | `packages/catalogue/src/classification.ts:8–38`; `packages/media/src/module.ts:8–17,37–49`. Custom: every row, immutable menu versions/images and real image bytes/blobs/edits. Media is DB state, not an invented directory. Explicit no secrets/entries/effects.                                                                                                                                                                   |
| venue-service + adjustments / 16        | Entire `packages/venue-service/src/classification.ts:7–52`; `packages/adjustments/src/classification.ts:4–20`. Custom: every row, immutable receipt headers/adjustments and logical order/sale/config references. No secrets/entries/effects.                                                                                                                                                                                        |
| workforce / 17                          | `packages/workforce/src/classification.ts:11–44`, `chain.ts:45`, `chain-hash.ts:104`, `pay-period-chain.ts`, `schema/pay-period-closures.ts:8`. Custom: full time-entry/head and pay-closure/snapshot/correction evidence plus all state. No secrets/entries/effects.                                                                                                                                                                |
| workforce-es + staffing / 18            | `packages/workforce-es/src/classification.ts:6`; `packages/staffing/src/classification.ts:4–10`. Custom: agreement configuration, roles/days/blocks/assignments and logical references. No secrets/entries/effects.                                                                                                                                                                                                                  |
| scheduler + bookings + fiscal-none / 21 | `packages/scheduler/src/classification.ts:3`, `packages/bookings/src/classification.ts:9`, `packages/fiscal-none/src/migrations.ts:3–13`. Scheduler/bookings custom: preserve every row without duties/actions. Fiscal-none alone declares `database_only`: zero tables, empty migration journal, explicit no secrets/entries/effects and not-applicable. It never substitutes for missing fiscal-verifactu.                         |

For data modules choose `zeroSchema:"absent_tables_and_entries"`; zero is valid only when their owned source tables/material and dependent requirements agree with absence. Shared host files such as secrets.env do not themselves count as module-owned evidence; check for that owner's encrypted records or declared non-DB material, so a shared vault key cannot falsely disqualify an absent module. Fiscal-none uses `empty_schema`. Inactive positive-schema owners run **all** checks. Target-only core/credentials/identity/fiscal-verifactu use `unsupported`; other owners use `empty_after_migration`, meaning every owner table must be empty after real migration. Nonempty migration-derived state is unsupported under version 1 rather than an unspecified seed exemption. Target-only material outside that policy refuses success. Missing owner/dependency/version always refuses. The generated inventory includes all 15 current descriptors even when disabled or at schema zero; it must automatically expose a newly added descriptor without semantics.

## How to execute each task

Task numbers group related owners. Execute in this dependency order: **1–4, 6–9, 11, 11a, 12, 10, 13–19, 19a, 20–21, 5, 22–27**. This puts the fiscal secret reader before its aggregate, and complete real composition before the built current-target test. Every task below is one inline cycle intended to finish well under roughly 100 tool calls. If reality exceeds that bound, split the deliverable before continuing. Read TDD skill before any implementation/test code. Use `useVenueDb`, real SQLite, guarded scratch cleanup, explicit clocks and synthetic release stamps. No package/app suite starts a container.

Each task's checklist means: write the named red assertions; run its exact command and observe the specified failure; implement the minimal listed signature/behavior; repeat the **same command** for green with a nonzero passing Tests count; stage exactly its Files using `git add --`, then run its `git commit -s -m ...`. A missing new export is an initial red only; subsequent red must fail the named behavioral assertion, not parsing/fixture setup. Existing assertions remain. These commits are future implementation steps; authoring this plan does not authorise committing this checkout.

### Task 1: Declare verification semantics

**Files:** create `packages/module/src/backup-verification.ts`, `packages/module/src/backup-verification.test.ts`; modify `packages/module/src/module.ts`, `packages/module/src/index.ts`, `packages/module/package.json`; create the **type declarations only** from the query contract in `packages/store/src/backup-query.ts` and export them from `packages/store/src/index.ts` (Task 2 adds implementation).
**Consumes:** existing module/backup interfaces. **Produces:** exact owner interfaces, `BackupVerificationUnsupported`, `BackupCheckUnavailable` and declaration/result validators above; store value/query types. Module gets a direct store type dependency, never db-to-module.

- [x] RED `requires explicit verification declarations`, `data effects name independent checks`, `activation effects cannot claim executed checks`, `rejects duplicate effects unknown versions and free-form results`. Assert missing semantics refuses; fiscal-none's explicit empty contract is accepted.
- [x] Run `pnpm --filter @waitron/module exec vitest run src/backup-verification.test.ts`; expect missing validator, then incorrect acceptance assertions red.
- [x] Implement strict declarations/results (aggregate status must agree with check statuses) and optional seat; preserve ordinary descriptors/restore hook semantics. GREEN the same command, then `pnpm --filter @waitron/module typecheck`.
- [x] Commit `git commit -s -m "feat(module): declare backup verification semantics"`.

### Task 2: Enforce read-only access beneath types

**Files:** modify `packages/store/src/backup-query.ts`, `packages/store/src/index.ts`; create `packages/store/src/backup-query.test.ts`.
**Consumes:** Task 1 query types and a closed SQLite path. **Produces:** `openBackupQuery(databasePath)` above.

- [x] RED `serves bound SELECT and recursive reads`, `refuses UPDATE DELETE INSERT from a cast callback`, `refuses PRAGMA query_only OFF attachments DDL RETURNING writes and extensions`, `closes on iteration failure`. Assert engine refusal, unchanged whole rows and no new attached file, while legitimate reads pass.
- [x] Run `pnpm --filter @waitron/store exec vitest run src/backup-query.test.ts`; expect missing implementation then writable-fixture assertions red.
- [x] Implement readOnly/query-only/default-deny authorizer and private close; no ordinary store change. Unsupported authorizer is unavailable, not fallback. GREEN same command.
- [x] Commit `git commit -s -m "feat(store): enforce query-only backup reads"`.

### Task 3: Generate inventory without enabled-module filtering

**Files:** create `packages/composition/src/backup-verification.ts`, `packages/composition/src/backup-verification.test.ts`; modify `packages/composition/src/index.ts`.
**Consumes:** Task 1 declarations and `ALL_MODULES`. **Produces:** `backupVerificationInventory(modules:readonly WaitronModule[]):readonly {module:WaitronModule;verification:BackupVerificationContribution}[]`.

- [x] RED `refuses each missing owner independently`, `includes inactive and schema-zero descriptors`, `refuses duplicate names dependency gaps and unknown semantics`, `never substitutes fiscal-none`. Remove each contribution from a complete synthetic descriptor set and require unsupported; inactive fiscal remains required.
- [x] Run `pnpm --filter @waitron/composition exec vitest run src/backup-verification.test.ts`; expect missing export then omitted-owner assertion red.
- [x] Implement complete dependency/semantics validation. Do not pretend real composition has contributions yet; Task 21 adds its passing real-inventory assertion. GREEN same command.
- [x] Commit `git commit -s -m "feat(composition): require complete verification inventory"`.

### Task 4: Bind strict wire input, result and target descriptors

**Files:** create `apps/server/src/backup-verification-protocol.ts`, `apps/server/src/backup-verification-protocol.test.ts`, `apps/server/src/backup-verification-target.ts`, `apps/server/src/backup-verification-target.test.ts`.
**Consumes:** Tasks 1–3 and actual migration assets. **Produces:** all private protocol types/readers/digest functions and `buildBackupVerificationTarget` above. Task 5 connects current build provenance.

- [x] RED `binds every request field independently`, `module ordering leaves digest stable`, `rejects duplicate JSON keys unknown nested keys noncanonical integers and oversized input`, `rejects incomplete or forged passed output`, `target changes with SQL package version or policy bytes`. Assert null measurement and missing module cannot pass; no secret/free-form/path result fields accepted.
- [x] Run `pnpm --filter @waitron/server exec vitest run src/backup-verification-protocol.test.ts src/backup-verification-target.test.ts`; expect missing exports then binding/shape assertions red.
- [x] Implement bounded readers and fixed canonical arrays. Publish deterministic literal vectors for lane D; no request-provided source revision. GREEN same command, mutating each field separately.
- [x] Commit `git commit -s -m "feat(server): bind private backup verification protocol"`.

### Task 5: Embed build identity and expose a boot-free distribution

**Files:** create `scripts/backup-verification-runtime.mjs`, `scripts/backup-verification-runtime.test.mjs`, `apps/server/src/backup-verification-entry.ts`; modify `scripts/bundle-node.mjs`, `scripts/bundle-node.test.mjs`, `apps/server/package.json`, `apps/server/src/backup-verification-target.ts`.
**Consumes:** Task 4 descriptors and existing bundler. **Produces:** runtime generator/current target accessor above; dist entry initially exports protocol/target helpers, adding verifier in Task 23.

- [ ] RED `native target uses embedded release fingerprint`, `missing stamp refuses`, `source lockfile or descriptor change moves fingerprint`, `importing verification bundle starts no listener worker or boot`, `explicit hour stamp stays unchanged`. Actual build/import child uses explicit synthetic metadata, not machine clock.
- [ ] Run `pnpm exec vitest run scripts/backup-verification-runtime.test.mjs scripts/bundle-node.test.mjs` and `pnpm --filter @waitron/server exec vitest run src/backup-verification-target.test.ts`; expect missing provenance/new export failure.
- [ ] Implement build integration, real package versions/migrations and boot-free export. The fingerprint input is a canonical **pre-runtime** descriptor containing composition/migration/policy data, avoiding a digest cycle; compute runtime fingerprint before final target.digest. Embed it in every qualifying target binary, not just the verifier wrapper. GREEN same commands, then `pnpm --filter @waitron/server build`; require built-entry import test to pass.
- [ ] Commit `git commit -s -m "feat(build): embed backup verification runtime identity"`.

### Task 6: Preserve complete core data and existing counters

**Files:** create `packages/db/src/backup-evidence.ts`, `packages/db/src/backup-evidence.test.ts`, `packages/composition/src/core-backup-verification.ts`; modify `packages/db/src/index.ts`, `packages/composition/src/modules.ts`.
**Consumes:** Task 2 queries, complete core classification and existing pure amendment verifier. **Produces:** table policy/comparison/core functions above; `CORE_BACKUP_VERIFICATION:BackupVerificationContribution` in composition, using a structural db API to avoid cycles.

- [x] RED `detects same-count immutable replacement and non-hash field changes`, `preserves every historical and live series counter`, `source identity location or environment disagreement refuses`, `walks every order amendment chain`, `never creates a missing head`. Assert every generated core append-only row/field, sales relationships and stored heads are retained, not merely row counts/newest hashes.
- [x] Run `pnpm --filter @waitron/db exec vitest run src/backup-evidence.test.ts`; expect missing export then count-only comparison denial red.
- [x] Implement complete typed row comparisons, identity/series/reference checks and query-only amendment walks. Preserve membership documents, public-key relationships and removal/clearance evidence without adoption/signing; use existing `verifyMembershipDocument` (`packages/membership/src/verify.ts:100`) with the captured trust set as an internal consistency check, without claiming independent external membership attestation. Compare closes/head now; Task 7 adds semantic walk. Declare host series replacement/first-start as activation-only. GREEN same command plus `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/module-seams.test.ts`.
- [x] Commit `git commit -s -m "feat(db): verify preserved core backup evidence"`.

### Task 7: Verify daily-close history through the core contribution

**Files:** create `packages/reporting/src/backup-verification.ts`, `packages/reporting/src/backup-verification.test.ts`; modify `packages/reporting/src/index.ts`, `packages/reporting/package.json` (store dependency), `packages/composition/package.json` (reporting dependency), `packages/composition/src/core-backup-verification.ts`.
**Consumes:** Task 2 queries, Task 6 comparison and existing `computeCloseEntryHash`. **Produces:** `verifyBackupCloseHistory(before:BackupQuery,after:BackupQuery):Promise<boolean>`; called by composition's core adapter, not db.

- [x] RED `checks all nodes`, `rejects middle damage deleted tail and missing head`, `accepts honestly empty history`. Assert contiguous sequence, genesis, every snapshot/hash and captured `daily_close_chain` tip before/after.
- [x] Run `pnpm --filter @waitron/reporting exec vitest run src/backup-verification.test.ts src/daily-close-hash.test.ts src/verify-daily-close-chain.test.ts src/verify-daily-close-chain.tampered.test.ts`; expect new export/full-walk assertion red; keep existing tests intact.
- [x] Implement independent query mapping with existing pure hash. Do not cast a writable transaction or change the operational verifier. Core cannot pass if reporting refuses. GREEN same command.
- [x] Commit `git commit -s -m "feat(reporting): verify complete captured close history"`.

### Task 8: Walk every fiscal chain segment and stored head

**Files:** create `packages/fiscal-verifactu/src/backup-verification-chain.ts`, `packages/fiscal-verifactu/src/backup-verification-chain.test.ts`; modify `packages/fiscal-verifactu/package.json` (direct store dependency).
**Consumes:** Task 2 queries, existing row decoder/fromRegistroRow and pure verifyHuella, all captured SIF/head rows. **Produces:** `verifyBackupFiscalChains(before:BackupQuery,after:BackupQuery):Promise<boolean>`.

- [x] RED `detects corruption older than the newest two records`, `checks all four predecessor fields`, `rejects gaps duplicate genesis and missing head`, `accepts re-registration with reset current pointer`, `detects tail loss from captured head`, `checks inactive and non-source nodes`. Use genuine alta/anulación/rectification/substitution history, multiple SIFs, and current SIF with no sales; a non-huella field edit must fail preservation.
- [x] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-chain.test.ts`; expect missing export then last-two-only/missing-head denial red.
- [x] Implement full node sequence iteration, checking rebuilt records with existing `@waitron/verifactu` validate at their recorded generation instant (the policy used at `chain.ts:189`), and SIF boundaries derived from stored identities, genesis per legitimate segment and no invented cross-registration link. Match head sequence and pointer to current SIF's tip or legitimate reset-empty state; preserve every historical segment/tip before/after. Never call operational verifyChain/head readers or edit protected writers. GREEN same command.
- [x] Commit `git commit -s -m "feat(fiscal): verify complete captured fiscal chains"`.

### Task 9: Check registrations, allocations and captured public signatures

**Files:** create `packages/fiscal-verifactu/src/backup-verification-history.ts`, `packages/fiscal-verifactu/src/backup-verification-history.test.ts`, `packages/fiscal-verifactu/src/backup-verification-trust.ts`, `packages/fiscal-verifactu/src/backup-verification-trust.test.ts`.
**Consumes:** Tasks 2/6; existing public receipt/signature readers with pinned public trust from target policy, never trust chosen by archive. **Produces:** `verifyBackupFiscalHistory(context:BackupVerificationContext):Promise<BackupModuleResult>` and release-pinned `FISCAL_BACKUP_PUBLIC_TRUST:{cloud:ReceiptTrust|null;paper:readonly PaperCustodianTrust[]}` in the new trust file. The trust file also exports `fiscalBackupPublicEvidenceDigest(trust = FISCAL_BACKUP_PUBLIC_TRUST):string`; the fiscal owner uses the release default. These are existing public trust types from cloud-evidence.ts/paper-evidence.ts; they contain no private key or operation authority. Hash its public data as `[cloud === null ? null : [cloud.issuer,sortedCloudKeyPairs],sortedPaperTriples]`, where paper triples are `[custodianId,publicKey,fingerprint]`, into the owner publicEvidenceDigest; no raw Map JSON serialisation. Null/empty means no applicable trusted key, never success for a signature requiring it.

- [x] RED `checks every revoked registration and allocation`, `rejects historical signature or source relationship changes`, `retains filing cases events sends flows and acknowledgements`, `requires no new allocation to read receipts`. Check allocation result/series/bases/approval/source binding and reservation source/target nodes, with older rows corrupted independently.
- [x] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-history.test.ts src/cloud-evidence.test.ts src/paper-evidence.test.ts`; expect missing export then historical relationship/signature denial red.
- [x] Implement query-only checks for stored hour/cloud/signed-paper/declared-paper/emergency formats without new confirmations. Preserve all columns in SIF/allocations/reservations, filing cases/events, envios/flujo/acks and certificate history. Invalid signature with known trust is invalid; absent required trust is unsupported, never permission to accept self-asserted roots. Keep declared/emergency limitations explicit. Existing `initial-cloud-setup.ts:182` reads a host trust file; do not invoke it or follow its archived pathname in the child. Release ownership must supply reviewed public roots before that signed format can pass. Until then return unsupported for that format, with no fetch or self-trust fallback. GREEN same command; zero signing/preparation calls.
- [x] Commit `git commit -s -m "feat(fiscal): verify captured registration and receipt history"`.

**Implementation qualification:** the stored Cloud envelope contains a reservation reference, while `cloud-preparation.ts:143–153` writes its signed receipt into a host file. The query-only reader returns `unsupported` for that reference and reads no archived pathname. Signed paper uses the existing public parsers and signature bytes without calling a reader that requires current confirmations. No public roots are configured in this release. Declared paper checks retained structure and digests; emergency checks retained checksum evidence. Neither supplies outside attestation or fresh activation authority. A malformed configured root also remains `unsupported`; it cannot establish archive corruption.

### Task 10: Validate A679 retained hour evidence and declare fiscal effects

**Files:** create `packages/fiscal-verifactu/src/backup-verification.ts`, `packages/fiscal-verifactu/src/backup-verification.test.ts`; modify `packages/fiscal-verifactu/src/index.ts`, `packages/composition/src/modules.ts`.
**Consumes:** Tasks 8/9/12 and pure history projection; execute this task after Task 12, before Task 13. **Produces:** `FISCAL_BACKUP_VERIFICATION:BackupVerificationContribution`.

- [x] RED `validates retained history before scope filtering`, `covers retired and foreign-node histories`, `absence follows the genuine capture rule`, `unresolved required data effect needs authority`, `activation-only effects stay unattempted`. Assert contradictions/extra private fields/schema-zero evidence refuse; genuine empty history is accepted only under its owner rule.
- [x] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification.test.ts src/hour-backup-state.test.ts src/hour-history-reader.test.ts`; expect new declaration then omitted-history/effect denial red.
- [x] Implement independent query-only mapping across every stored hour-history source plus optional `secrets/module-evidence/fiscal-verifactu/hour-history.json`. Classify fresh identity/series/registration/promotion as activation-only; all data effects have independent checks. Aggregate completed Tasks 8/9/12 without swallowing refusals; incomplete secret checking cannot pass. GREEN same command including a real complete fiscal owner pass.
- [x] Commit `git commit -s -m "feat(fiscal): declare backup history and effect obligations"`.

### Task 11: Authenticate every application-vault row without a dependency cycle

**Files:** create `packages/credentials/src/backup-verification.ts`, `packages/credentials/src/backup-verification.test.ts`, `packages/credentials/src/backup-key-inputs.ts`, `packages/credentials/src/backup-key-inputs.test.ts`, `packages/composition/src/credentials-backup-verification.ts`; modify `packages/credentials/src/index.ts`, `packages/credentials/package.json` (store dependency), `packages/composition/src/modules.ts`.
**Consumes:** Task 2 query, all three archived env inputs through `resolveBackupKeyInputs`, existing keyring/cipher/payload readers. **Produces:** owner-owned `CREDENTIALS_BACKUP_POLICY` with the contribution's declarations but no callback; `verifyBackupCredentials(query:BackupQuery,keyInputs:Readonly<Record<string,string>>):Promise<"passed"|"invalid"|"unsupported"|"unavailable">`; `readBackupCredential(query:BackupQuery,keyInputs:Readonly<Record<string,string>>,purpose:string):Promise<Readonly<Record<string,string>>|null>`; composition's `CREDENTIALS_BACKUP_VERIFICATION:BackupVerificationContribution` wraps those exports and converts inconclusive status to `BackupCheckUnavailable`.

- [x] RED `authenticates all rows including previous key versions`, `key shape alone cannot pass`, `wrong AAD tag or payload refuses`, `unknown purpose is unsupported`, `deprecated purposes remain covered`, `missing external key is unavailable`, `all readers use later-file vault-key precedence`. Missing row is null; an undecryptable row must never masquerade as absent. Assert no reseal/rotation/writes.
- [x] Run `pnpm --filter @waitron/credentials exec vitest run src/backup-verification.test.ts src/backup-key-inputs.test.ts`; expect missing export then wrong-key acceptance assertion red.
- [x] Implement shared captured-key resolution and authenticated decrypt using each row's own key version and purpose AAD, then exact payload checks. Missing/wrong key without independent confirmation is unavailable, not corruption. Never return secrets in a module result. **Do not import module into credentials:** `packages/module/package.json` depends on fiscal, whose `packages/fiscal/package.json` depends on credentials; that would close a loop, and credentials' fiscal-import restriction remains intact. GREEN same command plus `pnpm exec vitest run scripts/workspace-cycles.test.ts`.
- [x] Commit `git commit -s -m "feat(credentials): verify every captured vault row"`.

### Task 11a: Check the source membership private/public key pair

**Files:** modify `packages/db/src/backup-evidence.ts`, `packages/db/src/backup-evidence.test.ts`, `packages/db/src/index.ts`, `packages/composition/src/core-backup-verification.ts`; create `packages/composition/src/core-backup-verification.test.ts`.
**Consumes:** Tasks 6/11 queries, shared key inputs and authenticated credential reader. **Produces:** `verifyBackupMembershipIdentity(input:{before:BackupQuery;after:BackupQuery;nodeId:string;privateKey:string|null}):Promise<boolean>` in db, wired into core's secret obligation.

- [x] RED `malformed membership PKCS8 refuses`, `valid unrelated Ed25519 key refuses`, `matching source identity passes without signing`, `one missing key half refuses`, `explicit keyless source follows its absence rule`. Compare source public halves before and after migration; require zero generation/signing/writes and no secret output.
- [x] Run `pnpm --filter @waitron/db exec vitest run src/backup-evidence.test.ts` and `pnpm --filter @waitron/composition exec vitest run src/core-backup-verification.test.ts`; expect missing key-check export then false acceptance red.
- [x] Extend the core declaration with `vault:membership.node_key` and the declared env inputs. Add db-owned `verifyBackupMembershipIdentity(input:{before:BackupQuery;after:BackupQuery;nodeId:string;privateKey:string|null}):Promise<boolean>`: parse canonical base64 PKCS8 DER, require Ed25519, derive SPKI with `createPublicKey` without signing, and compare with the source node's captured public key before and after migration. Composition's core adapter obtains the private string through the credentials reader and passes it privately to that db function; db imports no credentials/module/membership package. Missing private key with a recorded public key, private key without its public half, malformed or valid-but-unrelated key refuses. Both absent is accepted only for an explicitly keyless source with no captured membership obligation requiring that identity; test the absence rule and a normal matching identity. Core cannot pass before this obligation is wired. Never generate, establish, endorse, rotate or sign an identity. GREEN the same commands plus `pnpm exec vitest run scripts/workspace-cycles.test.ts`.
- [x] Commit `git commit -s -m "feat(db): verify captured membership key usability"`.

### Task 12: Check fiscal certificate data without signing or AEAT

**Files:** create `packages/fiscal-verifactu/src/backup-verification-secrets.ts`, `packages/fiscal-verifactu/src/backup-verification-secrets.test.ts`; Task 10 subsequently wires its result into the fiscal aggregate.
**Consumes:** Task 11 private credential reader and existing offline PFX opener. **Produces:** `verifyBackupFiscalSecrets(context:BackupVerificationContext):Promise<BackupModuleResult>` for Task 10's complete fiscal contribution.

- [x] RED `opens captured PFX without signing or network`, `preserves all certificate-install and reminder evidence`, `source-node credential matches latest applicable install`, `valid expired material requires future renewal not corruption`, `damaged material blocks success`. Other nodes' local history is preserved without pretending their keys are available; absent required source key stays unavailable.
- [x] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-secrets.test.ts src/certificate-file.test.ts`; expect missing export then ignored-PFX denial red.
- [x] Implement offline private-key/certificate parsing and source relationship checks. Never call `checkWithAuthority`, install/renew, transport or signing. Preserve every historical install field. Distinguish malformed known material, unsupported encryption and inconclusive key inputs. Task 10 wires this already-tested reader into the real fiscal contribution; GREEN same command, with literal secret/fiscal identity sentinels absent from results.
- [x] Commit `git commit -s -m "feat(fiscal): verify captured certificate material offline"`.

### Task 13: Check identity secrets and authenticator state

**Files:** create `packages/identity/src/backup-verification.ts`, `packages/identity/src/backup-verification.test.ts`; modify `packages/identity/src/index.ts`, `packages/identity/package.json` (module/store/credentials dependencies), `packages/composition/src/modules.ts`.
**Consumes:** Task 6 comparison, archived keyring values and existing `decryptTotpSecret`. **Produces:** `IDENTITY_BACKUP_VERIFICATION:BackupVerificationContribution`.

- [ ] RED `authenticates every person and pending-enrolment TOTP value`, `checks authenticator password PIN recovery and session representations`, `issues no login`, `accepts explicitly absent optional authenticators`. Corrupt an older encrypted row independently; include prior vault-key rows in Task 11; identity uses the actual version-1 account-derived ring, with unknown stored TOTP versions unsupported. Preserve all identity and ceremony rows, not just persons.
- [ ] Run `pnpm --filter @waitron/identity exec vitest run src/backup-verification.test.ts`; expect new export then omitted-enrolment denial red.
- [ ] Implement offline owner-format and logical reference checks. Use Task 11's `resolveBackupKeyInputs` instead of a second env resolver; reproduce only the exact account/TOTP derivation over that map. Resolve explicit canonical 32-byte base64 WAITRON_ACCOUNT_KEY; when absent, HMAC-SHA256 vault-current-key with `waitron.account-key.v1`. Derive TOTP key by HMAC-SHA256 account-key with `waitron.totp.v1`, version 1, matching `boot.ts:1347–1351` and `account-key.ts:9–25`. Do not substitute vault versions for TOTP versions; declare these state entries explicitly. Add a real server-generated encrypted-TOTP fixture to the host integration test so a drift from operational derivation fails. No live env input. No password/PIN derivation against supplied credentials, login, session issuance or recovery-code consumption. Unavailable decryption raises the fixed private signal; no secret/raw errors in results. GREEN same command.
- [ ] Commit `git commit -s -m "feat(identity): verify captured authenticator state"`.

### Task 14: Cover payments and declared offline provider secrets

**Files:** create `packages/payments/src/backup-verification.ts`, `packages/payments/src/backup-verification.test.ts`; modify `packages/payments/src/index.ts`, `packages/payments/package.json` (module/store dependencies), `packages/payments/src/card-provider.ts`, `packages/composition/src/modules.ts`; add offline-check implementations and sibling `backup-verification.test.ts` suites in `payments-stripe` and `payments-sumup`.
**Consumes:** Tasks 6/11 and complete payments classification. **Produces:** `paymentsBackupVerification(providers):BackupVerificationContribution`, composed with the existing `CARD_PROVIDERS` registry. Each adapter supplies a pure optional `verifyBackupCredential(payload, environment):boolean` on `CardProviderContribution`; a present credential without those semantics is unsupported. Provider names and payload parsing stay in the adapter packages; the existing no-provider-vocabulary guard remains unchanged.

- [x] RED `preserves refund hold resolution and outcome evidence`, `checks readers and sale relationships`, `checks present provider payloads without provider calls`, `permits absent credentials only for unconfigured providers`. Same-count immutable edits fail; in-flight work remains data, never executed.
- [x] Run `pnpm --filter @waitron/payments exec vitest run src/backup-verification.test.ts`; expect new export then omitted-evidence assertion red.
- [x] Implement complete row comparison, configured-provider requirements and offline payload/URL parsing. No provider connectivity claim, capture/refund/poller/terminal or webhook action. Instrument those functions to throw and require zero calls. GREEN same command.
- [x] Commit `git commit -s -m "feat(payments): verify backup data without payment effects"`.

### Task 15: Cover catalogue and actual media database state

**Files:** create `packages/catalogue/src/backup-verification.ts`, `packages/catalogue/src/backup-verification.test.ts`, `packages/media/src/backup-verification.ts`, `packages/media/src/backup-verification.test.ts`; modify `packages/catalogue/src/index.ts`, `packages/media/src/index.ts`, `packages/catalogue/package.json`, `packages/media/package.json` (direct store imports), `packages/media/src/module.ts`, `packages/composition/src/modules.ts`.
**Consumes:** Task 6 comparison and complete owning classifications. **Produces:** `CATALOGUE_BACKUP_VERIFICATION` and `MEDIA_BACKUP_VERIFICATION`, both `BackupVerificationContribution`.

- [ ] RED `preserves every immutable menu version and image reference`, `checks image bytes blobs edits and stored digests`, `inactive media remains checked`, `schema zero cannot hide blobs`. Missing or altered source blob, including one referenced only by historical menu versions, refuses; legitimate empty data passes.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/backup-verification.test.ts` and `pnpm --filter @waitron/media exec vitest run src/backup-verification.test.ts`; expect missing exports then missing-blob denial red.
- [ ] Implement custom declarations with explicit empty secrets/entries/effects. Follow existing stored image format/digest definitions, no invented filesystem source or worker. Explicit historical policy permits only shipped catalogue `0034_content_suggestion_collect_cursor.sql` additions: `collect_cursor:null`, `collected_refs:'[]'`; retain all original fields. GREEN both commands; preserve composition's existing DB-image assertion.
- [ ] Commit `git commit -s -m "feat(catalogue): verify catalogue and media backup state"`.

### Task 16: Cover service and adjustment data owners

**Files:** create `packages/venue-service/src/backup-verification.ts`, `packages/venue-service/src/backup-verification.test.ts`, `packages/adjustments/src/backup-verification.ts`, `packages/adjustments/src/backup-verification.test.ts`; modify `packages/venue-service/src/index.ts`, `packages/adjustments/src/index.ts`, `packages/venue-service/package.json`, `packages/adjustments/package.json` (direct store imports), `packages/composition/src/modules.ts`.
**Consumes:** Task 6 comparison and every owning classification table. **Produces:** `VENUE_SERVICE_BACKUP_VERIFICATION`, `ADJUSTMENTS_BACKUP_VERIFICATION`.

- [ ] RED `retains issued headers and adjustments`, `checks live and staged service references`, `never replaces historical context with current config`, `zero schema cannot hide issued evidence`. Assert every source row, including immutable non-hash text, survives.
- [ ] Run `pnpm --filter @waitron/venue-service exec vitest run src/backup-verification.test.ts` and `pnpm --filter @waitron/adjustments exec vitest run src/backup-verification.test.ts`; expect new exports then historic replacement denial red.
- [ ] Implement custom declarations/reference checks with no secret/entry/effect obligations. No order routing, kitchen fire, historical repricing or configuration writes. GREEN both commands with accepting empty/inactive controls.
- [ ] Commit `git commit -s -m "feat(service): verify service and adjustment backup evidence"`.

### Task 17: Check complete workforce chains, heads and closures

**Files:** create `packages/workforce/src/backup-verification.ts`, `packages/workforce/src/backup-verification.test.ts`; modify `packages/workforce/src/index.ts`, `packages/workforce/package.json` (module/store dependencies), `packages/composition/src/modules.ts`.
**Consumes:** Task 6 comparison; pure workforce `chain-hash.ts` verifyChain and `pay-period-chain.ts` verifyPayPeriodClosures, never inserting head readers. **Produces:** `WORKFORCE_BACKUP_VERIFICATION`.

- [x] RED `walks every node-location time chain and stored head`, `detects old middle or tail loss`, `preserves corrections automatic entries pay closures and snapshots`, `never creates heads for empty data`. Include every extension/self-approval/response/correction field. Pay closures have no separate head at this pin: compare original full rows/tip across migration; do not invent external completeness evidence.
- [x] Run `pnpm --filter @waitron/workforce exec vitest run src/backup-verification.test.ts src/restore-continuation.test.ts src/pay-period-chain.test.ts`; expect new export then truncated-history denial red.
- [x] Implement read-only mapping/full walks/head equality and all owned state comparison. No closure/projection/automatic shift writes, mail or cross-node merge. GREEN same command with unedited restore-continuation and honest empty/retired-node controls.
- [x] Commit `git commit -s -m "feat(workforce): verify complete captured time history"`.

### Task 18: Cover workforce-es and staffing configuration

**Files:** create `packages/workforce-es/src/backup-verification.ts`, `packages/workforce-es/src/backup-verification.test.ts`, `packages/staffing/src/backup-verification.ts`, `packages/staffing/src/backup-verification.test.ts`; modify `packages/workforce-es/src/index.ts`, `packages/staffing/src/index.ts`, `packages/workforce-es/package.json` (module/store), `packages/staffing/package.json` (store), `packages/composition/src/modules.ts`.
**Consumes:** Task 6 comparison and owning classifications. **Produces:** `WORKFORCE_ES_BACKUP_VERIFICATION`, `STAFFING_BACKUP_VERIFICATION`.

- [ ] RED `checks agreement config without recomputing work`, `checks assignment role area and person references`, `covers inactive populated state and honest zero`. Missing logical references refuse; empty/unassigned legitimate state passes. All secret/entry/effect declarations are explicitly empty.
- [ ] Run `pnpm --filter @waitron/workforce-es exec vitest run src/backup-verification.test.ts` and `pnpm --filter @waitron/staffing exec vitest run src/backup-verification.test.ts`; expect new exports then missing-reference denial red.
- [ ] Implement custom read-only shape/reference checks. No roster rebuild, live defaults, pay evidence or scheduled work. GREEN both commands.
- [ ] Commit `git commit -s -m "feat(workforce): cover staffing backup obligations"`.

### Task 19: Refuse incomplete or incompatible verification inventories

**Files:** create `apps/server/src/backup-verification-compatibility.ts`, `apps/server/src/backup-verification-compatibility.test.ts`.
**Consumes:** Tasks 2–4, owner policy declarations, existing manifest/entry/identity readers. **Produces:** strict compatibility signature above.

- [x] RED `refuses missing source module newer schema unknown hash and dependency gap`, `checks positive-schema inactive owners`, `refuses unexplained zero and unsupported target-only material`, `cross-checks modules.json manifest and actual migration records`. Assert unknown tables, extra secret entries, missing identity and environment disagreement refuse without calling migration. Valid compatible target-only empty state still passes.
- [x] Run `pnpm --filter @waitron/server exec vitest run src/backup-verification-compatibility.test.ts src/restore-gate.test.ts`; expect missing export then missing-module acceptance denial red.
- [x] Implement source inventory/journal/hash/timestamp/dependency reconciliation, not counts alone. Entry allowlist is generated from required host files and module declarations; compare exact normalised destinations, no silent discard. Preserve permissive ordinary gate. GREEN same command; no migration added to paper over unsupported evidence.
- [x] Commit `git commit -s -m "feat(server): enforce complete backup verification compatibility"`.

### Task 19a: Validate authenticated archive files without losing raw manifest checks

**Files:** create `apps/server/src/backup-verification-archive.ts`, `apps/server/src/backup-verification-archive.test.ts`; modify `apps/server/src/backup-archive-file.ts`, `apps/server/src/backup-archive-file.test.ts` only to add an exact-end option, preserving ordinary defaults.
**Consumes:** existing decryptArtifactFile/unpackArchiveFile and exported validateDatabaseEntries/path/identity guards. **Produces:** `validateBackupArtifactFile(input:Omit<ValidationFileDeps,"skipSecrets"> & {expected:Pick<BackupVerificationRequest,"archive"|"capturedAt"|"sourceNodeId">}):Promise<ValidatedArtifact>` in the new archive file; `unpackArchiveFile(path:string,scratchDir:string,options?:{requireExactEnd?:true}):Promise<ArchiveInputEntry[]>` extends the existing codec.

- [x] RED `rejects duplicate or unknown raw manifest keys`, `refuses trailing framing bytes and duplicate db.dump`, `authenticates before unpack or placement`, `keeps ordinary archive caller behavior`. Assert required manifest version/time/environment/full module map exactly match the private binding; wrong GCM key remains unavailable at the host boundary; unsupported archive/cipher/manifest versions produce unsupported/archive_format_unsupported, not corruption.
- [x] Run `pnpm --filter @waitron/server exec vitest run src/backup-verification-archive.test.ts src/backup-archive-file.test.ts src/restore-artifact-file.test.ts`; expect missing wrapper then duplicate/trailing-data denial red.
- [x] Implement authenticated file decode into owned scratch, with existing metadata limits (4096 entries, 4096 name bytes, 16 MiB metadata, 64 KiB chunks). Require exact end only on this verification path. Validate the raw manifest with duplicate-aware strict JSON before shared validation loses that information. Pass non-file entries, including any duplicate db.dump placeholder, to validateDatabaseEntries with the single extracted DB path so its shared destination/identity guards still run. Return an owned discard that closes/removes every partial file. Use archive measured identity at the host, not the stream source ID returned by shared database validation. GREEN same command with original file/ordinary-restore tests intact.
- [x] Commit `git commit -s -m "feat(server): strictly validate verification archive files"`.

### Task 20: Share real private placement and migrations

**Files:** create `apps/server/src/backup-data-placement.ts`, `apps/server/src/backup-data-placement.test.ts`; ordinary `apps/server/src/restore.ts` is read-only in this task.
**Consumes:** Task 19 admission, Task 19a strict file validation, and existing restoreDatabase/restoreSecrets/migration functions. **Produces:** exact placement functions above.

- [x] RED `places genuine data and declared material`, `migrates populated supported catalogue predecessor preserving old columns`, `refuses traversal duplicate normalised destinations unknown entries and first-setup host paths`, `ordinary resume and hook-before-secrets ordering stay intact`. Predecessor stops before shipped catalogue 0034 and is seeded using its own columns; require new defaults and every original value after real migration.
- [x] Run `pnpm --filter @waitron/server exec vitest run src/backup-data-placement.test.ts src/restore-file-placement.test.ts src/restore.test.ts src/restore-operation-placement.test.ts`; expect missing placement export then absent-data assertion red.
- [x] Compose existing exported placement primitives without changing A679 admission/resume/identity behavior. Verification uses fresh scratch and real migrationOptionsFor including append-only declarations; no hooks/series/marker. Validate archived backup.env then exclude it from the managed layout. GREEN same command; original encrypted input unchanged and logical preserved evidence equal.
- [x] Commit `git commit -s -m "refactor(server): share data placement without activation"`.

### Task 21: Complete small owners and real composition registration

**Files:** create `packages/scheduler/src/backup-verification.ts`, `packages/scheduler/src/backup-verification.test.ts`, `packages/bookings/src/backup-verification.ts`, `packages/bookings/src/backup-verification.test.ts`, `packages/fiscal-none/src/backup-verification.ts`, `packages/fiscal-none/src/backup-verification.test.ts`; modify `packages/scheduler/src/index.ts`, `packages/bookings/src/index.ts`, `packages/fiscal-none/src/index.ts`, `packages/scheduler/package.json` (module/store), `packages/bookings/package.json` (store), `packages/fiscal-none/package.json` (module/store), `packages/composition/src/modules.ts`, `packages/composition/src/backup-verification.test.ts`.
**Consumes:** Tasks 1–3/6 and all owner contributions. **Produces:** `SCHEDULER_BACKUP_VERIFICATION`, `BOOKINGS_BACKUP_VERIFICATION`, `FISCAL_NONE_BACKUP_VERIFICATION`, each `BackupVerificationContribution`, and complete generated real inventory.

- [x] RED `scheduler preserves runs without scheduling`, `bookings preserves all values without action`, `fiscal-none explicitly checks no-owned-state`, `every descriptor table nonDb source and restore effect has exactly one owner`. Set equality must use generated classifications/descriptors, including media. Delete every real contribution independently; each must refuse.
- [x] Run `pnpm --filter @waitron/scheduler exec vitest run src/backup-verification.test.ts`, `pnpm --filter @waitron/bookings exec vitest run src/backup-verification.test.ts`, `pnpm --filter @waitron/fiscal-none exec vitest run src/backup-verification.test.ts`, and `pnpm --filter @waitron/composition exec vitest run src/backup-verification.test.ts src/composition.test.ts`; expect missing declarations/real inventory assertions red.
- [x] Implement small explicit declarations; only fiscal-none claims database-only with its empty-journal source receipt. Require named independent checks for all data effects, and tests for empty secrets/entries/effects. Every package newly importing query types or module helpers declares that direct dependency; preserve credentials' structural adapter. GREEN all commands plus `pnpm exec vitest run scripts/workspace-cycles.test.ts`.
- [x] Commit `git commit -s -m "feat(composition): complete verification owner coverage"`.

### Task 22: Verify host state secrets and declared entry placement

**Files:** create `apps/server/src/backup-verification-secrets.ts`, `apps/server/src/backup-verification-secrets.test.ts`.
**Consumes:** required RECOVERY_FILES, optional state rules, owner declarations and Task 11 vault checks. **Produces:** `verifyBackupStateSecrets` and `verifyBackupKeyPlacement` signatures above; Task 23 calls the latter after actual private placement.

- [x] RED `requires all six recovery files`, `matches both CA and server private keys to certificates`, `checks server chain under captured CA`, `validates optional backup.env and modules.json without installing old destination`, `refuses cloud-connection and cloud-staff material`, `unseals selected-node state without publishing it`, `actual placed-layout keys equal captured effective keys`, `account key only in backup.env is unsupported`, `conflicting vault overrides cannot falsely pass`. Malformed keypair must fail even if PEM parsing passes; missing application key blocks success. Other nodes' opaque sealed rows retain an explicit node-local preservation rule.
- [x] Run `pnpm --filter @waitron/server exec vitest run src/backup-verification-secrets.test.ts`; expect missing export then omitted-secret/key-mismatch denial red.
- [x] Implement offline key parsing/matching and CA signature checks without signing, issuing or networking. Validate archived configuration with pure parsers and no access to the old backup destination. Implement `verifyBackupKeyPlacement` using shared captured key resolution and actual `loadBoxEnv({}, placedStateDir)`, with the real host key derivation; Task 23 calls it after private placement. Include a passing redundant/equal override, a later-file override whose omission changes key bytes, an account key present only in backup.env, and a matching secrets/trading configuration. Refuse changed usability as unsupported/target_incompatible; the tests must inspect actual placed-layout resolution, not compare two calls to the same synthetic resolver. Authenticate selected `node_sealed_state` when present using the supplied matching archive recovery key through a separate private host call using the defined `sealedState` argument before accepting its check. Missing row is allowed only under its declared absence rule; no live env fallback. GREEN same command, scanning returned objects and captured stdout/stderr for secret/path sentinels.
- [x] Commit `git commit -s -m "feat(server): verify private recovery state material"`.

### Task 23: Orchestrate measured verification with cleanup-gated output

**Files:** create `apps/server/src/backup-verification.ts`, `apps/server/src/backup-verification.test.ts`; modify `apps/server/src/backup-verification-entry.ts`.
**Consumes:** strict protocol/target, Task 19a file validation, all generated owners, compatibility, host secrets and real private placement. **Produces:** `BackupVerificationDeps`, `verifyBackupArtifact` and built export above.

- [x] RED `independently measures consumed encrypted bytes`, `input path replacement cannot swap decrypted bytes`, `wrong or missing key is unavailable not corrupt`, `all required owner checks complete without activation`, `close rm deadline quota cancellation and unexpected errors never yield success`. Assert exact bounded output, request/attempt/target/policy/measurement agreement, all modules exactly once, no secret/fiscal identifier/path/raw diagnostics, and no scratch/plaintext survives any completed attempt.
- [x] Run `pnpm --filter @waitron/server exec vitest run src/backup-verification.test.ts`; expect missing export then cleanup/coverage/binding denial red. Use real placement and migrations; inject only owned filesystem cleanup failures, not fake checkers.
- [x] Implement pipeline: strict request/local target/deadline and delivered key version/reference admission; measured sealed-input copy; compare digest/length; authenticate decryption; shared validation/identity and bound manifest/node/time/environment checks; original SQLite integrity/FKs and journal reconciliation; real placement/migration; migrated integrity/FKs; actual captured-versus-placed cryptographic input comparison and all host/module data/secret checks; close handles, dispose original/placed state/plaintext and remove scratch before serialising verdict. Source Cloud installation provenance comes from trusted signed capture binding, never trading.env inference. Retain no reusable target directory or marker.
- [x] GREEN same command. Map completed deterministic corruption to invalid; missing module/semantics/format to unsupported; uncheckable data effect to needs_authority; missing/wrong key, resource/timeout/cancel/unexpected/cleanup uncertainty to unavailable. An unfinished required check cannot become a completed integrity verdict; cleanup uncertainty overrides any provisional verdict. Early failures have no invented measurement or module pass. Confirm child termination and controller cleanup remain separate Cloud admission requirements.
- [x] Commit `git commit -s -m "feat(server): verify backup artifacts without activation"`.

### Task 24: Run genuine authority-boundary and installed deletion controls

**Files:** create `apps/server/src/backup-verification.authority.test.ts`, `apps/server/src/backup-verification.installed.test.ts`, `apps/server/src/testing/backup-verification-fixture.ts`; retain existing restore/fiscal tests listed below unchanged.
**Consumes:** Task 23 built genuine interface, existing authorised fixture helpers producing actual disposable sales/history/public evidence. **Produces:** counted boundary and installed omission receipts; no new production interface.

- [ ] RED `genuine complete archive passes without operational authority`, `ordinary restore still refuses absent authority`, `ordinary authorised restore still needs genuine binding`, `verification never prepares activates promotes signs numbers or trades`. Instrument prohibited preparation/allocation, series/registry/number writers, signing, first-start and workers/listeners so any call fails; require zero calls and full captured logical evidence equality on success and every refusal, and an undeclared entry-read probe that refuses rather than exposing another owner's secret. Include genuine production-hour history without pretending new authority.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/backup-verification.authority.test.ts src/backup-verification.installed.test.ts src/restore-fiscal-e2e.test.ts src/restore-operation.test.ts src/restore-operation-placement.test.ts src/restore-operation-preparation.test.ts src/restore-fiscal-receipt.test.ts src/hour-backup-state.test.ts`; expect genuine-pass/boundary assertion red, never repaired issued fixtures. Implement only missing integration/fixture wiring; H2 unchanged. GREEN same command.
- [ ] In installed **disposable copies** with dependencies, omit separately: complete coverage, strict compatibility, traversal/duplicate/unclaimed-entry checks, each required secret check, full fiscal walk, captured-head comparison and immutable equality. Run each owning named denial case, require its intended assertion to fail, then a legitimate accepting control and restored candidate green. Retain commands/output. Keep genuine archive/protected fixtures untouched; corruption lives only in extracted disposable DB copies.
- [ ] Control read-only enforcement in separate installed copies: remove authorizer only and expect ATTACH/PRAGMA denial assertion failure; remove the complete authorizer/readOnly/query-only barrier and attempt UPDATE inside the callback, expecting the unchanged-evidence/refusal assertion to fail. State exactly which layer was measured; removing one of redundant guards alone does not prove the others absent. Task 26 adds independent local target-comparison omissions. Cloud container network/socket/host/quota/cleanup controls belong to lane D.
- [ ] Commit `git commit -s -m "test(server): exercise genuine verification authority boundaries"` after restored green and running the unedited protected commands printed in Task 27 (no need to wait for that task). Use exact recorded own PIDs/scratch IDs only.

### Task 25: Negotiate snapshot recovery v2 with the current target

**Files:** create `apps/server/src/cloud-recovery-v2.ts`, `apps/server/src/cloud-recovery-v2.test.ts`; modify `apps/server/src/cloud-recovery.ts`, `apps/server/src/boot.ts` at recovery-client construction only; retain `apps/server/src/cloud-recovery.test.ts`, `apps/server/src/setup-api.cloud-recovery.test.ts` behavior assertions.
**Consumes:** Task 4/5 current target and lane D's coordinated v2 API. **Produces:** the following types/signatures plus v2 behavior; A850 never edits Cloud code.

`SnapshotRecoveryVerification = {protocol:"backup-data-restore/v1";target:BackupVerificationTarget;policyDigest:string;requestDigest:string;archiveSha256:string;archiveBytes:number;pointId:string}` lives in `cloud-recovery-v2.ts`. Export `assertSnapshotRecoveryTarget(verification:SnapshotRecoveryVerification,current:BackupVerificationTarget):void` (fixed existing Cloud-unavailable error on mismatch) and `readSavedSnapshotRecoveryTarget(stateDir:string):Promise<{requestId:string;pointId:string|undefined;target:BackupVerificationTarget}|null>` (strict version-2 saved-state reader, null for v1/absent state). Extend `CloudRecoveryOptions` with `snapshotProtocol?:2`, `target?:()=>BackupVerificationTarget`; the qualified caller supplies both. Existing default v1 callers remain their explicit old contract.

- [ ] RED `v2 binds fresh request key request ID and target`, `qualified snapshots refuse absent or v1 descriptor`, `info read and post-download rechecks reject changed target`, `negotiation failure never downgrades`, `v1 and continuous behavior remains intact`. Saved state is a strict discriminated version 1/2 union; version 2 freezes its target/protocol, and old state cannot qualify.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/cloud-recovery-v2.test.ts src/cloud-recovery.test.ts src/setup-api.cloud-recovery.test.ts`; expect missing v2 export then absent-descriptor acceptance denial red.
- [ ] Implement start/status proof bytes exactly `['waitron-cloud-recovery-request-v2',origin,requestId,action,publicKey,code,target.digest,nowMs]`; info/read/restored exactly `['waitron-cloud-recovery-v2',origin,requestId,action,archiveDigest,target.digest,nowMs]`. Start/status body is `{version:2,target,payload,signature}`; later body `{version:2,id:requestId,target,payload,signature}`. Signature commits to the complete target by recomputed digest. Require `version:2` response negotiation and strict `verification` on selected info/read; compare point/hash/size, complete target and policy on every recheck. Response target never replaces saved/local target. Keep old v1 arrays unedited.
- [ ] GREEN same command. Exchange exact proof/result vectors and bounds with lane D **before enabling the qualified caller**. If Cloud lacks v2, new snapshot policy stays unavailable; this is a coordinated release dependency, not a fallback layer. No deployment enforcement or fiscal authority change.
- [ ] Commit `git commit -s -m "feat(recovery): negotiate target-bound snapshot recovery v2"`.

### Task 26: Recheck target at staging, restart and actual placement

**Files:** create `apps/server/src/restore-request.verification.test.ts`; modify `apps/server/src/restore-request.ts`, `apps/server/src/restore.ts` (RestoreDeps/restoreOwned only), `apps/server/src/cloud-recovery.ts`, `apps/server/src/cloud-recovery-v2.ts`; preserve existing staged/stream/boot tests.
**Consumes:** Task 25 binding/read/assert functions and ordinary recovery authority input. **Produces:** optional `snapshotVerification?:SnapshotRecoveryVerification` on `ArchiveRestoreRequest` and `RestoreDeps`; strict staged **version 2** archive marker for qualified snapshots. Stream request remains unchanged.

- [ ] RED `binary change after approval prevents staging`, `binary change after staging prevents placement`, `stripped binding or v1 marker cannot downgrade a saved v2 operation`, `refusal changes no destination files or placementStarted marker`, `matching v2 still requires ordinary fiscal authority`. Assert old DB/identity/secrets unchanged and zero restoreDatabase calls on mismatch; legitimate matching control reaches ordinary authority refusal or authorised restore.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/restore-request.verification.test.ts src/restore-request.test.ts src/restore-request.node-key.test.ts src/boot.restore.test.ts src/restore-stream.test.ts`; expect changed-binary/stripped-binding acceptance denial red.
- [ ] Carry full verification descriptor with requestId/pointId/fresh key and archive hash/size into the version-2 marker. Stage compares fresh current target. On restart, read saved v2 binding as well as marker, reject stripped/downgraded marker, and compare current binary **before placementStarted, payload or destination mutation**. After validation, restoreOwned compares again immediately before writeValidated; measured artifact binding must still match. Preserve all operation/key/old-machine/resume/first-setup gates. Nonqualified v1 and continuous paths retain original behavior, never acquire current qualification from old evidence.
- [ ] GREEN same command; in installed disposable copies omit the staging, restart and immediate pre-placement comparisons separately, run each corresponding changed-binary case with accepting control, restore and require green. Never weaken ordinary restore authority to reach placement.
- [ ] Commit `git commit -s -m "feat(recovery): compare qualified snapshot target before placement"`.

### Task 27: Finish evidence, branch review and release handoff

**Files:** update current implementation claims only where made stale in `docs/backlog.md`, `docs/backlog/box.md`, `docs/developers/conventions-data.md`, `docs/developers/testing-guide.md`, and execution receipts in this plan. No Cloud file or campaign-state edits. Historical docs get dated pointers, not rewritten history.
**Consumes:** preceding counted checks and installed controls. **Produces:** reviewable Waitron branch, exact implementing-release/interface handoff and explicit release gates. No runtime interface added.

- [ ] Run these protected commands **unedited**, preserving original assertions and golden bytes:

  ```bash
  pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
  pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts
  pnpm --filter @waitron/fiscal-verifactu exec vitest run src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts src/sale-amount.huella.test.ts
  ```

  Require counted passing Tests, no update/snapshot flags or skipped cases. Failure is a blocker, not permission to change issued data or H2 paths.

- [ ] Run focused changed-owner/server suites, `pnpm --filter @waitron/store --filter @waitron/module --filter @waitron/db --filter @waitron/reporting --filter @waitron/composition --filter @waitron/server --filter @waitron/catalogue --filter @waitron/media --filter @waitron/identity --filter @waitron/credentials --filter @waitron/payments --filter @waitron/fiscal-verifactu --filter @waitron/fiscal-none --filter @waitron/venue-service --filter @waitron/adjustments --filter @waitron/workforce --filter @waitron/workforce-es --filter @waitron/staffing --filter @waitron/scheduler --filter @waitron/bookings typecheck`, `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts src/backup-verification.test.ts`, and `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/module-seams.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/apply-migrations-callers.test.ts`. Inspect base-to-tip names: no protected edits or migrations expected. No whole-workspace run solely to finish; CI owns package coverage.
- [ ] Re-read whole changed paths and prose call chains. Audit all generated owners, data-effect declarations, private outputs, complete preservation policies and genuine acceptance. Fix valid findings with red/green. Keep A850 open when only this plan lands; remove its backlog entry only when implementation actually lands, leaving independently gated Cloud release work explicit.
- [ ] Stage exact changed docs and `git commit -s -m "docs: record backup verification contract and limits"`. Announce readiness for `finish-branch`. When owner/controller requests it, perform initial reorientation/rebase as required, **one normal Claude run-it whole-branch review** in an installed throwaway checkout with complete candidate tree, normal hook and current-head CI coverage. Read completed findings, not wrapper exit. A850's FULL classification does not import W41s' two-review rule. No automatic merge.
- [ ] Give lane D exact implementing Waitron revision/release, boot-free dist export, canonical wire vectors, full target/composition/migration/policy digests, complete owner coverage and measured acceptance receipts. Cloud must implement strict child/image/claim admission, lease/deadline/deletion fences, transactions, unavailable-vs-invalid, historical retention versus current qualification, every traced API/UI/alert consumer and real resource cleanup. These are external dependencies, not A850 tasks.
- [ ] Keep snapshots unavailable until a joint pinned genuine runtime proof captures, publishes, verifies, cleans up and admits an exact archive, **with continuous source absent**, then exercises target-bound snapshot recovery. Require all five spec outcomes plus wrong/missing key, missing external key, malformed/truncated/duplicate/forged output, wrong image, timeout/OOM/quota/cancel/death/uncertain cleanup and independent Cloud guard omissions. Data verification grants no route movement or trading; separate authorised activation proof remains required. Do not enable the dormant backup deployment/enforcement profile here.

## Exact remaining owner and release gates

1. **Owner semantics:** Every generated owner must supply reviewed declarations and independent data/secret checks. Historical signed-Cloud/paper formats need reviewed public trust in FISCAL_BACKUP_PUBLIC_TRUST; the current host-file configuration does not supply it to this private runtime. Unknown historical public trust or uncheckable required hook data effects must yield unsupported/unavailable/needs_authority as appropriate. Never invent archive trust or outside completeness. Full local history consistency does not establish completeness against an external registry or lost source.
2. **H2:** No exception is assumed necessary. If a real check requires a protected writer edit, record exact path/proposed change/reason for owner review before dependent implementation. Adding readers is not authority to alter allocation/restore behavior.
3. **Joint v2 API:** Lane D must agree and implement Task 4/25 vectors, descriptors, bounds, responses and recovery-operation/replacement binding before the qualified client is enabled. No client-only change makes that API exist. Existing APIs cannot qualify the new snapshot path.
4. **Real limits and runtime:** Full-history success inside 30 seconds/256 MiB scratch/1,024 MiB memory is unmeasured. Exceeding limits stays unavailable; increases require separately justified owner approval. Installed controls and genuine pinned-runtime container cleanup/admission remain unexecuted.
5. **Release:** Design approval exists in Cloud #211. Waitron implementation, complete owner coverage, branch review/current-head CI, coordinated reviewed pinned releases, joint genuine end-to-end acceptance and separate activation proof remain implementation/release dependencies. This plan cannot open those gates.

## Plan review resolution

A fresh-context read of the complete draft found two gaps: differing captured/placed key resolution and an unassigned membership private-key usability check. Tasks 11/13/22/23 now share captured key inputs, compare them with actual managed-layout resolution, and refuse qualification when excluding backup.env changes usability. Task 11a assigns PKCS8/Ed25519 parsing and public-half matching to core with explicit absence/refusal/acceptance cases. These are planned checks, not executed proofs. The author's final nine-line delta also makes unsupported wire versions and separately delivered key version/reference admission explicit; it adds no activation or Cloud implementation.

## Author self-review

Coverage: owner/query/inventory Tasks 1–3; strict binding/build identity 4–5; core/reporting/fiscal data 6–10; vault/membership/fiscal/identity/payment secrets 11–14 including 11a; remaining owners 15–18/21; compatibility/strict archive/real placement 19–20 (including 19a); host secrets/cleanup 22–23; authority and installed omissions 24; negotiated v2/restart/pre-placement 25–26; branch/release evidence 27. All acceptance outcomes above are future assertions. No implementation or test was written or run to author this plan.

## Execution checkpoint, 20 October 2026

Tasks 1–3 are implemented. `@waitron/module` exports strict contribution/result validators and
private bounded error signals. `@waitron/store` supplies the independently restricted query handle.
`@waitron/composition` requires every supplied descriptor's semantics without selecting an enabled
subset. The real descriptors gain their checks in the later owner tasks; this foundation does not
verify an artifact or qualify a backup for recovery.

| Command                                                                                                        | Observed result                                                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm --filter @waitron/module exec vitest run src/backup-verification.test.ts`                                | 77 passed after missing-export and behavioral failures.                   |
| `pnpm --filter @waitron/store exec vitest run src/backup-query.test.ts`                                        | 23 passed after missing-export and missing-authorizer failures.           |
| `pnpm --filter @waitron/composition exec vitest run src/backup-verification.test.ts`                           | 29 passed after missing-export, missing-owner and invalid-name failures.  |
| `pnpm --filter @waitron/module test:coverage`                                                                  | 172 passed; statements 99.60%, branches 99.46%, functions and lines 100%. |
| `pnpm --filter @waitron/store test:coverage`                                                                   | 256 passed; all four measures 100%.                                       |
| `pnpm --filter @waitron/composition test:coverage`                                                             | 62 passed; all four measures 100%.                                        |
| `pnpm --filter @waitron/module typecheck`, and the same for store and composition                              | Each passed. Scoped ESLint also passed.                                   |
| `pnpm exec vitest run scripts/workspace-cycles.test.ts`                                                        | 15 passed after adding the module-to-store dependency.                    |
| `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` | 20 passed with both test files unchanged.                                 |

Mixed check outcomes use `unsupported`, then `needs_authority`, then `invalid`, then `passed` as
precedence. An unfinished required check cannot certify an integrity verdict. `not_applicable` is
accepted only as the sole passed check after the host admits that state; it cannot be declared as
an ordinary data check.

The store tests use minimal real SQLite files because importing the venue helper from db into
store would close the existing db-to-store dependency loop. They close their handles and remove
their temporary directories. On Node v26.11.1, a function denied by the authorizer returns code 1
with `not authorized to use function: <name>`; the other tested authorization denials return 23.
The function cases assert the exact authorization message as well as the code.

Task 4 is next. Artifact placement, module-owned checks, installed independent guard-removal
controls, qualified v2 recovery, branch review, current-head CI and joint release acceptance remain
open. No source-level unit result in this checkpoint establishes a successful archive verification.

### Task 4 execution and private protocol vector, 20 October 2026

Task 4 adds bounded request/result readers, duplicate-key and integer-spelling admission,
request binding, complete target-module coverage for passed output, and a target builder over
resolved migration assets and declared package versions. Build provenance and the actual package
version embedding remain Task 5. Owner checks, artifact verification and recovery integration
remain open; these readers do not qualify a backup.

The complete literal request is `VECTOR` in
[`backup-verification-protocol.test.ts`](../../../apps/server/src/backup-verification-protocol.test.ts).
Its independently calculated SHA-256 values are:

| Value       | Literal digest                                                     |
| ----------- | ------------------------------------------------------------------ |
| Composition | `b4856410cd1eb08bbbbdca82780768cb4ede5c00c7a8bb3a1c17589ad0c4a7a5` |
| Migrations  | `185384d2b168dcc542e78692a3649d220c8841ae26bab6cf93c7f1f997ac06c0` |
| Policy      | `bd085f106c2acf118ed5d22b2b32b6104ab5d0546f6146a750c3e210025c15d5` |
| Target      | `e7a8e1dc880ec7f846a6f22750dc610ea8159d02393b08d5c4bb08ed181a9e76` |
| Request     | `ecac239bf44b948246432671c1f896219d079c9a3a11b1e3a96d7bd6240e786a` |

For code-unit-sorted modules `m`, the composition subdigest hashes
`m.map(x => [x.name, x.packageVersion, sortedRequiresPairs])`; the migration subdigest hashes
`m.map(x => [x.name, x.schema, x.migrationTable, x.migrationDigest])`; the policy subdigest hashes
`m.map(x => [x.name, x.semanticsVersion, x.policyDigest])`. Each module migration digest hashes
`[1, sha256(rawJournalBytes), sortedRelativeSqlNameAndSha256Pairs]`, including SQL files outside the
journal. The raw journal bytes bind its migration order. The target digest hashes
`[1, [release, revision, fingerprint], completeSortedModuleArrays, compositionDigest,
migrationDigest, policyDigest]`; each complete module array is
`[name, packageVersion, sortedRequiresPairs, schema, migrationTable, migrationDigest,
semanticsVersion, policyDigest]`. Array digests hash UTF-8 JSON; file digests hash their original bytes. Both use lowercase hexadecimal SHA-256.
Dependency ranges preserve their literal printable spaces; opaque IDs reject whitespace.

The result reader checks unique fixed check codes, aggregate status and complete module coverage.
The host's contribution validator must additionally match each owner's declared check set; the
wire target carries its policy digest, not the declaration itself. Cloud must still validate the
actual child/image/claim and confirmed cleanup. A parsed result alone supplies none of those facts.

Independent installed controls removed duplicate-key admission, request-digest comparison, passed
module coverage, target-digest comparison, SQL-byte hashing and public-evidence policy binding one
at a time. Each selected denial test failed an assertion beside a passing legitimate control;
restoring the candidate returned both complete files to passing. The later semver correction
changes only dependency-range text admission; those six guarded statements retain their tested
shape. No existing test check or protected fiscal file changed.

### Task 6 execution, 20 October 2026

Core preservation now compares every classified table as a typed row multiset, including original
columns, duplicate multiplicities, local state, append-only evidence and existing counters. SQL
sorting uses explicit binary collation and a hexadecimal tie-break for equal INTEGER/REAL values;
comparison streams rows instead of retaining a whole history in JavaScript. Only declared additive
defaults and new empty tables are accepted. Source identity/environment, schema-declared foreign
keys, sale/series counters, captured membership signatures and every amendment chain are checked.
Membership verification uses the archive's own public keys; it is internal consistency only.

The registered core owner returns one aggregate `data` check, rather than inventing separate
per-check findings from a boolean result. Series replacement and first start are declared
activation-only. Daily-close rows and heads are preserved here; their semantic walk remains Task 7.
The host still needs to enforce scratch/temp-file quotas and qualify actual artifact placement.

Observed commands on this task's tree:

- `pnpm --filter @waitron/db exec vitest run src/backup-evidence.test.ts`: 60 passed after
  behavioral failures, including cursor cleanup failure and four absent-source-table cases.
- The same suite with `--coverage --coverage.include=src/backup-evidence.ts`: statements 99.27%,
  branches 98.18%, functions and lines 100%. This is a focused file report, not package coverage.
- `pnpm --filter @waitron/composition test:coverage`: 64 passed, all four measures 100%; the
  JSON summary includes `core-backup-verification.ts`.
- Both package typechecks and scoped ESLint passed. The root cycle/module-seam suites passed
  3,357 cases; the unedited fiscal write-path/inmutability pair passed 20.
- Six independent installed omissions failed the intended assertions beside accepting controls:
  full-value preservation, complete amendment walk, source binding, foreign references, membership
  signature and second-cursor release. Restoring the candidate passed all 60 cases.

No original test file changed. The full verifier, remaining owners, qualified recovery, whole-branch
review, current-head CI and joint release remain open; this task does not qualify a backup.

### Task 8 execution checkpoint — 2026-10-20

The independent query-only fiscal reader now walks every captured node and SIF
segment, reconstructs and validates every record at its recorded generation
instant, compares all four predecessor fields and the stored head, and preserves
complete record, identity and head rows before and after migration. Re-registration
keeps the node sequence and accepts a reset pointer only when the current identity
has no recorded work. Reusing an earlier segment and linking across registrations
refuse. No operational verifier or head creator is called.

Focused tests cover genuine alta, void, correction and substitution records,
retired segments, an empty current identity, older corruption, consistent but
replaced histories, missing/shortened heads and malformed stored values. Thirteen
independent guard omissions in an installed disposable candidate failed their
intended assertions beside accepting controls; the restored suite passed. The
existing writer/golden/immutability files remain unchanged. The exact command logs,
counts and coverage are in Lane E's local Task 8 receipt ledger. This reader alone
is not artifact qualification: registration/allocation/signature evidence, secrets,
full module aggregation, placement/cleanup and v2 recovery remain later tasks.

### Task 11 execution checkpoint — 20 October 2026

Captured secrets/trading/optional backup env inputs now share archive-only resolution. The credentials
owner compares all captured rows and authenticates every stored purpose/key version, including
deprecated purposes; its private reader returns null only for a missing row. Failed authentication
and unavailable keys remain unavailable, while authenticated malformed payloads refuse. No rotation,
reseal, provisioning or application-vault write is part of this reader.

Observed full credentials184PASS, coverage98.42/96.24/100/100; composition75PASS and all four100.
The latter's JSON summary includes credentials-backup-verification.ts. Root cycle/seam3364PASS.
These are module foundations, not artifact qualification, placed-key parity or a release handoff.
The original public-export whole-shape assertion gains five API names; existing entries remain.
Installed omission controls and final checkpoint receipts are recorded in the campaign ledger.

### Task 11a execution checkpoint — 20 October 2026

The core owner now authenticates the captured membership private key and checks its canonical
Ed25519 PKCS8 representation against the source public half before and after migration. A private
key without a public half, an unrelated pair or malformed material refuses. Explicitly keyless
sources need no retained membership obligation requiring that identity; unrelated membership is
accepted. Missing or inconclusive vault inputs remain unavailable.

Observed db98PASS with scoped reader coverage99.44/98.75/100/100; full composition86PASS with
100/98.36/100/100. Root3364 and protocol/target176PASS. Twelve installed omission/effect probes
failed at their intended assertions with accepting controls; restored focused suites122PASS.
The original56 db expectations remain exact. Four core result-shape assertions gain the required
secret check while preserving all previous status/data values and behavioral assertions.
Certificate/identity/provider secrets, real artifact orchestration and target-bound recovery remain
open. These checks neither activate fiscal identity nor qualify an artifact by themselves.

### Task 12 implementation checkpoint

The query-only certificate reader opens captured PFX material, checks the source node and latest
installation fields before and after migration, and compares complete installation/reminder rows.
It accepts intact expired or future-valid material without renewal. Missing vault keys or an
unconfirmed PFX passphrase remain unavailable; unsupported encryption remains unsupported.
The fiscal contribution still needs Task 10 wiring; this is not artifact qualification.

### Task 10 implementation checkpoint

The registered fiscal owner combines the full-chain, registration, certificate and retained-hour
readers. Query-only hour projection includes retired series, all registrations, allocations and
reservations before and after migration. Retained evidence is validated before scope filtering;
conflicts are checked in each captured taxpayer/environment scope. Schema-zero claims cannot
hide database or retained hour evidence. Non-hour stored formats remain unsupported by this
hour policy. Fresh installation, series, registration and promotion stay activation effects.
The artifact verifier and the remaining owners remain open.

### Task 13 implementation checkpoint

The identity contribution compares every classified identity table and checks password/PIN,
proof/session, passkey and ceremony representations on both copies. It authenticates all person
and pending-enrolment TOTP ciphertexts using archived account-key inputs. Unknown formats stay
unsupported; inconclusive decryption stays unavailable. It does not verify supplied passwords
or issue a login. `apps/server/src/backup-verification-identity.test.ts` exercises the operational
account-key helpers and enrolment writer, outside the later artifact/placement harness.
That genuine archive integration remains in Tasks20–24. The existing composition pin for an
absent identity backup contribution is replaced by its explicit owner; a separate case keeps
migration composition working with an omitted backup contribution.

### Task 15 implementation checkpoint

Catalogue and media now register explicit custom verification contributions. They compare every
classified table before and after migration, including immutable menu versions and image bytes.
Catalogue checks declared foreign keys, document hashes and the document's complete image-reference
set. Only the shipped suggestion-job additions `collect_cursor: null` and `collected_refs: '[]'`
are permitted as new columns. Unknown menu document formats stay unsupported, including when a
separate reference is broken.

Media reads its database tables, without a file directory or image worker. It checks stored picture
signatures and SHA-256 filenames, replacement blobs, edit bounds and references. Current references
need a photo identity; historical version references can resolve retained WebP bytes from the blob
table. Neither enabled-module filtering nor a schema-zero parameter skips these checks. Host
schema-zero admission and genuine encrypted-archive qualification remain later plan work.

The classification literal moved unchanged to `packages/media/src/classification.ts`; its original
`module.ts` export remains. No existing assertion changed. The earlier identity test's cleanup
callback now has an explicit block: the root teardown text scanner had interpreted the following
query helper as that callback. The guard and all identity assertions remain unchanged.

The artifact host, remaining owners, placement, recovery v2, whole-branch review and release
qualification are still open. This checkpoint does not release Cloud integration or snapshots.

### Task 17 implementation checkpoint

The workforce contribution compares every classified table and walks full source and restored time-entry and pay-period-closure chains by node and location. It reads stored time heads directly and checks their sequence, id, hash and recorded time. Every correction and extension field is mapped to the existing pure hash reader; full stored rows and snapshots are preserved. No workforce restore hook or activation effect is added. A captured self-consistent closure prefix is not evidence of external completeness; migration loss is checked against the captured rows. Artifact placement and qualification remain later tasks.

### Task 20 execution, 20 October 2026

Private placement now uses `restoreDatabase`, descriptor-derived `migrationOptionsFor` and
`applyMigrations`, then `restoreSecrets`. It writes declared recovery material, excludes the old
`backup.env` from the managed layout and validates its captured settings without opening the old
destination. It requires the captured vault env input. This adapter does not set aside identity,
run restore hooks, settle series or create a rebuild marker. Ordinary `restore.ts` is unchanged.
Full secret usability, orchestration, cleanup admission and recovery binding remain later tasks.

The real catalogue predecessor stops before `0034_content_suggestion_collect_cursor`. The fixture
uses that schema's columns and retains every original table value, adding the expected null cursor
and empty collected-reference list. The migration engine also restores absent append-only triggers;
both update and delete attempts are refused afterwards. File placement checks retained source
ciphertext and logical source rows, private file/directory modes and declared material.

The four required suites passed 133 tests. Five focused root suites passed 1,925 tests and the two
protected fiscal suites passed 20 without edits. Server types, scoped lint and explicit source
formatting passed. Focused coverage of the actual new source measured 23/23 statements, 8/8 branches,
9/9 functions and 21/21 lines; this is not package-wide coverage. Eight independently omitted steps
failed their intended assertions beside accepting controls in an installed disposable copy, and
restoring the code passed all 16 new cases. The copy matched 8,553 tracked/candidate paths and was
removed. An initial omission exposed a weak new excluded-file assertion; checking each filename
separately caught the omission. No existing test assertion, migration or protected writer changed.

### Task 21 small-owner checkpoint, 20 October 2026

Scheduler and bookings now supply query-only checks that preserve every captured table value and
refuse an owned-table presence inconsistent with an absent or applied source schema. Their real
classifications supply their table lists. Fiscal-none explicitly declares database-only obligations
with no owned tables, private inputs or effects; its empty journal and a real migrated table
inventory are checked. All three are registered in composition without restore hooks.

This is **partial Task 21**. The complete generated real inventory and independent removal of every
real owner remain pending the payment contribution in Task 14. That task still follows the owner's
Lane B-first ordering. No enabled-module filter or fallback supplies complete verification.

Full scheduler coverage passed 120 tests, fiscal-none passed 20 and composition passed 100; all
three package coverage bars passed. Four focused bookings Node suites passed 106 tests, and its
new source's focused coverage passed all four measures with 23 cases. Five root suites passed
5,295 tests; the four package type checks and scoped lint passed. Seven installed omissions caught
row-preservation, source-schema and registration failures beside accepting controls; restored
suites passed 26, 23, 4 and 34 cases respectively. The disposable installed copy matched 8,559
candidate paths before removal. These checks do not establish full artifact or release acceptance.

Two existing checks deliberately change under Task 21: scheduler's public-export list gains
`SCHEDULER_BACKUP_VERIFICATION`; composition's fiscal-none check replaces absent `backup` with the
exact `{ verification: FISCAL_NONE_BACKUP_VERIFICATION }` object. Other original expectations and
protected fiscal assertions stay unchanged. The complete inventory acceptance remains open.

The final four server consumer suites passed 228 tests and the protected fiscal pair passed 20
unchanged. The first final formatting command flagged two new test fixtures and the ignored
lockfile. The fixtures were formatted and the applicable source and explicit plan checks then
passed. Their TypeScript parse trees and nontrivia token sequences matched before and after;
a deliberately changed value differed in both comparisons. The installed control tree preceded
that fixture formatting. The complete Task 21 inventory remains pending Task 14.

### Task 22 host-secret checkpoint, 20 October 2026

The host reader now checks all required recovery files, both TLS key/certificate pairs, the CA's
self-signature and the server's issuer/signature. Expired or not-yet-valid material requires renewal
and returns unavailable. Parseable unrelated keys return invalid; unexpected reader faults propagate
for the orchestration layer to classify as unavailable. Optional backup settings and module
configuration are parsed without opening a backup destination; archived Cloud authority files are
refused.

Selected-node sealed state is authenticated with its supplied recovery key and its host material
and identity are checked privately. The caller must establish the selected row's absence before
omitting that argument. Other nodes' sealed bytes remain under the core owner's complete row
comparison, without claiming their keys are available. Task 23 must wire the selected-row read and
these checks into the complete artifact flow.

The placement check uses the real scratch files through `loadBoxEnv({}, placedStateDir)` and the
host's vault/account derivation. It compares current/previous key bytes and versions and account
keys with the shared captured-input resolution. Equal redundant overrides pass; an excluded
`backup.env` override that changes usable keys refuses qualification. No key is moved or resealed.

The new suite passed 85 tests and measured all 97 statements, 78 branches, 9 functions and 80 lines
in its source. Eight focused server suites passed 274 tests. Nineteen independent omissions in an
installed disposable copy failed their intended expectations beside an accepting control; the
restored copy passed all 85 cases. These are host-reader checks, not complete artifact, authority,
runtime or joint release acceptance. No existing test assertion or ordinary restore code changed.

### Task 14 provider boundary correction — 21 October 2026

The first full payments suite rejected provider names in the initial verifier draft through
`no-provider-vocabulary.test.ts`. The guard is unchanged. The generic factory now takes the existing
composition registry and authenticates its declared credential purposes. Each provider adapter
parses its own stored fields offline; no provider adapter becomes a module descriptor.

Disconnect refuses an active reader before deleting its credential (`apps/server/src/payments-api.ts`,
the provider disconnect route). A disabled or deleted reader and historic payments may therefore
remain without that credential. The verifier accepts that retained history, requires credentials for
active undeleted readers, checks every present provider payload, and refuses credential presence
lost between source and restored copies. It cannot identify a credential independently lost before
capture where no separate connection marker remains. Missing keys remain inconclusive.

The original Task 21 small-owner checkpoint above records its 20 October state. Its pending complete
inventory is qualified separately after Task 14; neither checkpoint establishes complete artifact,
Cloud, pinned-runtime or joint release acceptance. Tasks 5 and 23–27 remain required.

### Tasks 14 and 21 qualification — 21 October 2026

The payment owner compares all classified payment tables and the three append-only evidence
sets. It checks declared relationships in both private copies and decrypts every present provider
credential through the shared captured key resolver. Provider adapters supply their own offline
payload checks through the existing registry. In-flight payments remain data.

The complete real inventory now matches the database produced by the shipped migration descriptors,
including media tables and inactive owners. Each real owner was removed independently and refused.
Module-owned non-database entries match declared sources; declared data effects name independent
checks, while activation effects remain outside verification.

Local qualification: the full payments suite passed 763 cases and its coverage bars; composition
passed 122 and its coverage bars. The two provider-focused runs passed 43 and 39; root boundary
checks passed 5,344 and the unchanged protected fiscal pair passed 20. Eleven omissions in an
installed independent candidate each failed the intended assertions; the restored payment and
inventory suites passed 56 and 22. All 8,682 candidate paths matched before and after the experiments,
and the owned temporary candidate was removed. No existing test assertion, guard or shipped SQL
changed in this step. These are local module and inventory receipts, not CI or complete artifact
qualification. Tasks 5 and 23–27 remain open before branch finishing and release handoff.

### Task 5 build identity qualification — 21 October 2026

The shared bundler embeds separate backup verification provenance beside the existing hour stamp.
Its fingerprint binds the source revision, release, lockfile bytes and canonical module,
migration and policy descriptor before the runtime fields are added. The current-target reader
uses that embedded provenance and the shipped migration assets; absent provenance refuses
qualification. This is version binding, not remote attestation.

`pnpm --filter @waitron/server build` produced `dist/backup-verification.js` alongside the ordinary
entries. The new entry exports the strict readers and target helpers; the artifact verifier is
still Task 23. The real import test blocked listeners, socket connections, fetch, timers, workers
and child processes, then read the complete target from copied migration assets. Its module
versions were compared with the package manifests. Changing copied SQL changed the migration digest.

The three build suites passed 57 cases, including the existing hour-stamp checks, and were run
with `GIT_DIR` set. A focused coverage run measured both changed build helpers at 100% in each
category. The protocol and target suites passed 179 cases; the affected composition suites
passed 61, root boundary checks 3,710 and the unchanged fiscal golden/immutability pair 20.
Server typechecking and focused lint passed. One new acceptance assertion initially omitted the
migration helper's arguments; the corrected call passed without a product change.

Eight independent installed-copy faults each failed the intended assertion beside a passing
control: omit source, lockfile or descriptor binding; omit bundle provenance; omit absent-stamp
refusal; substitute the running stamp; start a timer during import; omit SQL-byte binding.
The restored copy passed the same 57 build and 179 protocol/target cases. The existing hour test's
fixture gained the newly imported build helper; no existing assertion changed. These receipts
cover local builds and target binding, not full artifact verification or the joint Cloud release.
Tasks 23–27 remain before whole-branch finishing and release handoff.

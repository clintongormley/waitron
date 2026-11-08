# A1308 environment, PR 6 of 8: the `backup` settings document — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Backups screen's archive settings and the bucket copy's settings are stored in one
`backup` settings document; only the two bucket keys stay sealed in the credentials store.

**Architecture:** Today the archive settings are one JSON string sealed under `backup.archive`
(`apps/server/src/archive-settings.ts:33,343-350`) and the bucket copy's settings are seven fields
sealed under `backup.stream` (`apps/server/src/stream-host.ts:31,45-56`), keys included. After this,
`settings.backup` holds `{ archive, stream }` without keys, and each purpose seals only
`{ accessKeyId, secretAccessKey }`. The readers `readArchiveSettings*` and `readStreamSettings*` keep
their answers by joining the two, so the supervisor, the bucket copy, the recovery pack, the HTTP
answers, the dashboard and Waitron Cloud are unchanged. The archive part keeps its own revision
(a fresh random id on every archive write) and written-at time, so a bucket-copy save never makes an
open archive form out of date.

**Tech Stack:** TypeScript, drizzle-orm on `node:sqlite`, Hono, Vitest.

**Spec:** [`environment.md`](../specs/2026-11-02-rationalisation/environment.md) §1 ("The backup
settings the dashboard already keeps become the `backup` document … the non-secret fields move to
`settings`, and the bucket's secret stays a sealed credential"), §2 "Settings documents";
[README](../specs/2026-11-02-rationalisation/README.md) §5 U7; [`tables-venuebox.md`](../specs/2026-11-02-rationalisation/tables-venuebox.md)
§1.16 ("`backup.stream`'s `venueId` goes altogether"), §2.4 "Backup verification". Rules:
[the slice rules](2026-11-08-a1308-slice-rules.md). Part overview: [env1](2026-11-08-a1308-env1-tuning-constants.md).

**Needs:** env5 (one source for backup settings); env4 (`SERVER_SETTINGS_KEYS`); 1b-i;
[5f](2026-11-08-a1308-5f-backups-without-venue-id.md), which replaces the sealed bucket copy's
`venueId` with `streamId` ("a random id made when the owner first saves the stream settings, and kept
on later saves", 5f's list of what it builds, item 2) and takes `venueId` off the archive's bucket destination
(item 3). Land before the backup-service part starts (env5, "Coordination").

**Also coordinate with A1404** (encrypting the bucket copy with a key the box derives; backlog
`docs/backlog.md:2458`). Its slice 1 (#2599) changes `stream-api.ts` and the stream package; its
second pull request derives the bucket-copy key with the stream's id as the salt (a `venueId` before
5f). That salt is not secret: if A1404's second pull request lands first and stores anything new in
the sealed `backup.stream` payload, this plan moves every non-secret part of it into the document's
`stream` part beside `streamId`, and only `accessKeyId` and `secretAccessKey` stay sealed; if this plan
lands first, A1404 reads the salt from the document. Whichever lands second rebases; if both are in
flight on `stream-api.ts`, stop and ask the watcher (rules §5.5).

**Owner lands:** no. Read, not run: no sale, invoice number, fiscal record, fiscal identity, AEAT
sending or hashed value is touched.

**No venue reset:** no starting migration changes. A box that saved backup or bucket-copy settings
before this lands holds sealed payloads in the old shape, which the narrowed purposes refuse
(`credentials.invalid_payload`); the Backups screen then shows its existing "settings cannot be read"
state until the owner saves again. No conversion code (CLAUDE.md §3). The pull request description
says so.

## A consequence the design did not spell out

`venue_credentials` is classified `local` (one box's own rows, never copied to another box,
`packages/db/src/classification.ts:443`), but `settings` is `state` (copied to a standby,
[1b-i](2026-11-08-a1308-1b-settings-table.md) Task 1). So after this, a standby's copy of `venue.db`
carries the primary's backup choices without the bucket keys. After a promotion the new primary reads
those choices; a bucket destination then fails as "settings cannot be read" until the keys are
entered again, and a local folder destination names a folder on the new box's disk. This plan builds
the design as written and adds two sentences saying what to do about it to the servers guide,
`apps/server/src/guide/en/servers.md` and its Spanish twin `es/servers.md`, at the end of the section
"Carry on as the main box" (`{#carry-on}`): after a box becomes the main box, open Backups and enter
the bucket keys again, and check each folder is on this box. It is listed as an open question for the
owner.

## Global Constraints

- One transaction for the sealed keys and the document; both writes happen inside the existing
  `deps.turns` (the staging turn, CLAUDE.md §3) where the routes already write.
- The answers of `GET /api/backup/status`, `GET /api/backup/settings-evidence`,
  `GET /api/backup/stream` and the bodies of `PUT /api/backup/stream` and `POST /api/backup/apply`
  keep their shapes (Waitron Cloud calls the stream routes: `deploy/test-cloud/test-fixtures/integration-stream.mjs:59,65`
  in its repository).
- Error codes a reader answers today stay the same codes (`backup.archive_settings_invalid` with its
  reasons, `UNREADABLE_CREDENTIAL`): the document's own `parse` checks only the outer shape, and the
  full checks stay in `parseArchiveSettings`.
- `transfers: false`: backup settings name this box's folders and buckets.
- The document's shape is upgraded on read, never in a migration (README §5 U2, "Backups").

## Review Focus

1. Saving the bucket copy must not drop the archive part, and saving the archive must not drop the
   stream part (each route replaces only its own part of the row it read).
2. A secret-only change (new bucket keys, same bucket) must still move the archive's revision and the
   stream's credential revision, because the settings evidence and the recovery pack decide "made
   under the current settings" from them (`backup-settings-evidence.ts:257`,
   `backup-recovery-pack-api.ts:241`, `backup-recovery-pack-parts.ts:149`).
3. Deleting the bucket copy (`DELETE /api/backup/stream`) must remove both its keys and its part.
4. An archive with a local folder only seals nothing; one with a bucket seals its keys. A sealed key
   pair with no bucket in the archive part, or a bucket with no keys, is unreadable
   (`backup.archive_settings_invalid`, reason `keys`), never half-used.
5. The settings evidence's record digest must change on every archive write, including a secret-only
   one, and must not change on a bucket-copy save.

---

## What it builds

1. `BACKUP_SETTINGS` (module `backup`, version 1, transfers `false`) and `"backup"` added to
   `SERVER_SETTINGS_KEYS`.
2. `backup.archive` and `backup.stream` purposes = `["accessKeyId", "secretAccessKey"]`.
3. `writeArchiveSettings`, `readArchiveSettings`, `readArchiveSettingsIn`,
   `readArchiveSettingsWithMeta`, `readHeldArchiveSettings*` and `archiveRecord` keep their
   signatures and answers, reading and writing the two stores.
4. `streamSettingsPayload` is replaced by `writeStreamSettings(tx, ring, bucket)`;
   `readStreamSettings*` join the two stores. `streamId` (5f) lives in the document's `stream` part:
   made with `randomUUID()` when the part is first written and kept by every later save, as 5f rules.
5. `ArchiveRecordMeta.keyVersion` becomes `number | null` (null when the archive seals no keys).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Backends, Cloud as a target, how backups run | the backup-service part |
| Recording backup-settings saves in `activity_log` | not in A1308 (README §5 U11) |
| A per-module `verifyRestoredData` check of the document | not needed: core's row comparison covers `settings` (tables-venuebox §2.4) |

## Interfaces

```ts
// apps/server/src/backup-settings-document.ts (new, beside archive-settings.ts)
export interface StoredArchive {
  revision: string;            // random UUID, fresh on every archive write (as today)
  writtenAt: string;           // ISO time of that write
  enabled: boolean;
  destinations: unknown[];     // today's stored destinations, a bucket's accessKeyId/secretAccessKey removed
  schedule: unknown;
  retention: { count: number; days: number };
  destinationTimeoutMs: number;
}
export interface StoredStream {
  streamId: string;            // 5f's random id; kept across saves, new only when stream was null
  endpoint: string | null; region: string; bucket: string; prefix: string;
}
export interface BackupDocument { archive: StoredArchive | null; stream: StoredStream | null }
/** module "backup", version 1, transfers false; defaults { archive: null, stream: null }.
 * parse: answers { ok: false, field: "archive" | "stream" } only when a part is neither null nor an
 * object, or field "<key>" for an unknown top-level key. */
export const BACKUP_SETTINGS: SettingsDocument<BackupDocument>;

// apps/server/src/archive-settings.ts
export function parseArchiveSettings(
  stored: unknown,
  keys: { accessKeyId: string; secretAccessKey: string } | null,
): ArchiveSettings; // today's checks; new reason "keys" for a bucket without keys or keys without a bucket

// apps/server/src/backup-settings-evidence.ts
export interface ArchiveRecordMeta {
  keyVersion: number | null;
  writtenAt: string;   // StoredArchive.writtenAt
  digest: string;      // sha256 hex of JSON.stringify(StoredArchive)
}

// apps/server/src/stream-host.ts
export function writeStreamSettings(tx: Transaction, ring: KeyRing, bucket: BucketConfig): Promise<void>;
export function deleteStreamSettings(tx: Transaction): Promise<void>;
export function readStreamSettingsIn(tx: Transaction, ring: KeyRing): Promise<StreamSettings | null>;
// writeStreamSettings always re-seals the two keys, even when only bucket, region, endpoint or prefix
// changed, so credentialRevision(STREAM_PURPOSE) moves on every save (the recovery pack reads only it)
// null when stream is null; throws the credential's own unreadable codes when the part exists without keys
```

## Files

- Create: `apps/server/src/backup-settings-document.ts`, `backup-settings-document.test.ts`.
- Modify: `packages/credentials/src/purposes.ts:35-52`, `purposes.test.ts`;
  `apps/server/src/archive-settings.ts:33-60,205-360`; `apps/server/src/backup-settings-evidence.ts:50-54,222-257`;
  `apps/server/src/stream-host.ts:31-90,160-170`; `apps/server/src/stream-api.ts:175-265`;
  `apps/server/src/backup-api.ts` (the apply and disable writers, `:396-505`);
  `apps/server/src/backup-recovery-pack-parts.ts:34,149`, `backup-recovery-pack-api.ts:67,241`
  (they keep `credentialRevision(STREAM_PURPOSE)`; only `readStreamSettingsIn`'s new argument);
  `apps/server/src/mail-settings.ts` (`SERVER_SETTINGS_KEYS` gains `"backup"`); `apps/dashboard/src/api/live-queries.ts`
  (backup queries also depend on `settings.backup`).
- Tests whose set-up seals the old payloads: `git grep -l -E "purpose: \"backup\.(stream|archive)\"|STREAM_PURPOSE|ARCHIVE_PURPOSE|streamSettingsPayload|writeArchiveSettings" -- '*.test.ts' 'apps/server/src/testing/*.ts'`
  (includes `testing/old-stream-credential.ts`, `testing/stream-loop-scenario.ts:333`,
  `testing/stream-pause-scenario.ts:347`).
- Docs: `apps/server/src/guide/en/servers.md` and `es/servers.md` (the two sentences above); `docs/developers/conventions-data.md` where it lists the sealed purposes.

## Size

Counted, hand-written: about 260 lines of code (document 70, archive read/write 80, stream read/write
50, routes 35, meta and live type 25) and about 450 lines of tests (document 60, archive 130, stream
120, the standby case 40, evidence and pack 50, re-pointed fixtures 50), plus 20 lines of guide.
About 3 hours.

## Finish line

1. `pnpm --filter @waitron/credentials exec vitest run src/purposes.test.ts` and
   `pnpm --filter @waitron/server exec vitest run src/backup-settings-document.test.ts src/archive-settings.test.ts src/stream-host.test.ts src/stream-api.route.test.ts src/backup-api.route.test.ts src/backup-api.settings-evidence.test.ts src/backup-api.settings-evidence.proof.test.ts src/backup-recovery-pack-parts.test.ts src/backup-recovery-pack-api.make.test.ts src/backup-supervisor.test.ts`
   print a `Tests` count with no failure (use the base's names where a suite was split).
2. The stream suites that need binaries: `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`,
   then `pnpm --filter @waitron/server exec vitest run src/stream-loop.e2e.test.ts src/stream-pause.e2e.test.ts`
   (CLAUDE.md §4); CI runs them regardless.
3. `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/write-path-tables.test.ts scripts/guide-links.test.ts`
   and `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` pass.

## Expected protection-list difference

EQUAL. Any line is a stop.

## Stop points (beyond rules §5)

1. At the base the sealed `backup.stream` payload does not hold `streamId` as 5f describes (5f not
   landed, or landed with another shape): stop and ask; do not reintroduce `venueId`.
2. A recovery-pack or evidence suite fails because it compared an archive revision or digest that
   this plan computes differently: if its assertion has to change, stop (rules §5.3).

---

### Task 1: the document and the narrowed purposes

**Files:** `backup-settings-document.ts` and test, `purposes.ts` and test, `mail-settings.ts`.

- [ ] **Step 0:** record the base protection list (rules §3).
- [ ] **Step 1: Failing cases.** Defaults `{ archive: null, stream: null }` at revision 0;
  `parse({ archive: 3, stream: null })` → `field: "archive"`; `parse({ archive: null, stream: null, x: 1 })`
  → `field: "x"`; `transfers === false`; `PURPOSES["backup.stream"]` and `PURPOSES["backup.archive"]`
  equal `["accessKeyId", "secretAccessKey"]`.
- [ ] **Step 2: Run; fail. Step 3: Implement.** **Step 4: Run; pass. Step 5: Commit.**

### Task 2: archive settings read and write both stores

**Files:** `archive-settings.ts`, `backup-settings-evidence.ts`, `backup-api.ts`, tests.

- [ ] **Step 1: Failing cases** in `archive-settings.test.ts` (on `useVenueDb`):
  - `"a local folder archive seals nothing"`: `writeArchiveSettings` with one `local-fs` destination
    → no `backup.archive` credential row; `readArchiveSettings` answers what was written.
  - `"a bucket archive seals only its keys"`: with an `s3` destination → the credential holds exactly
    `accessKeyId` and `secretAccessKey`; the document's destination has neither; the read joins them.
  - `"keeps the bucket copy's part"`: save a `stream` part first; write the archive; `stream` is
    unchanged.
  - `"every write is a new revision and digest"`: two writes with identical settings → different
    `revision` and different `meta.digest`; a bucket-copy save in between leaves the archive's
    `revision`, `writtenAt` and `digest` unchanged.
  - `"keys without a bucket, or a bucket without keys, cannot be read"`: seal keys with a local-only
    archive part (and the reverse) → `backup.archive_settings_invalid` with `reason: "keys"`; the
    held reader answers `{ unreadable: "backup.archive_settings_invalid" }`.
  - The existing `parseArchiveSettings` cases keep their assertions, called with the stored object
    and the keys instead of a JSON string.
- [ ] **Step 2: Run; fail. Step 3: Implement.** `writeArchiveSettings`: mint `revision` and
  `writtenAt`, split the bucket keys out, `putCredential` them or `deleteCredential` when there is no
  bucket, and save the document with `archive` replaced (read and save in the same transaction).
  `readArchiveSettingsWithMeta` builds the meta per **Interfaces**. `backup-api.ts`'s apply and
  disable paths already call these writers; change only what the compiler asks.
- [ ] **Step 4: Run** the archive, evidence, apply-route and supervisor suites; pass.
- [ ] **Step 5: Commit:** `git commit -s -m "Archive settings move to the backup document (A1308 env6)"`

### Task 3: the bucket copy reads and writes both stores

**Files:** `stream-host.ts`, `stream-api.ts`, the recovery-pack files, the stream test helpers.

- [ ] **Step 1: Failing cases** in `stream-host.test.ts` / `stream-api.route.test.ts`:
  - `"PUT seals the keys and keeps the rest in the document"` — same body as today; the credential
    holds the two keys; the document's `stream` is `{ streamId, endpoint, region, bucket, prefix }` (absent
    endpoint → null, empty prefix → `""`); GET answers exactly what it answered before (the suite's
    existing expected body, unchanged).
  - `"a key change moves the credential revision"` — PUT twice with only the secret changed →
    `credentialRevision(tx, { purpose: STREAM_PURPOSE })` differs (the recovery pack's staleness
    still sees it).
  - `"DELETE removes both"` — no credential, `stream: null`, `archive` unchanged.
  - `"the stream id is made once and kept"` — first PUT → the document's `streamId` is a UUID and
    `readStreamSettingsIn` answers it; a second PUT with another bucket keeps the same `streamId`;
    DELETE then PUT makes a new one (5f's rule, unchanged).
  - `"a save changing only the bucket or the prefix re-seals the keys"` — PUT, then PUT with the
    same keys and only `bucket` changed, then only `prefix` changed → `credentialRevision(tx, { purpose: STREAM_PURPOSE })`
    differs after each, so the recovery pack, which reads only that revision
    (`backup-recovery-pack-api.ts:241`), still sees the pack as out of date. Same for the archive:
    `writeArchiveSettings` with only the bucket destination's `bucket` changed re-seals
    `backup.archive` and mints a new archive `revision`.
  - `"a standby holding the copied document without keys"` — on a box whose singleton role is not
    primary, with the document present and neither credential sealed: `GET /api/backup/status` and
    `GET /api/backup/stream` answer the screens' existing "settings cannot be read" state
    (`backup.archive_settings_invalid` reason `keys`; the stream's unreadable-credential code), and
    neither the backup supervisor nor the stream host raises an alert, because neither runs off the
    primary (pin what the base does for an unreadable record off the primary; if the base raises an
    alert there, the case asserts that alert unchanged). Then make the same box primary (the suite's
    role holder): the existing unusable-settings alerts are raised — the supervisor's load failure
    (`backup-config.ts:349-401`'s `BackupConfigUnusable`) and the stream host's refused-settings alert
    (`StreamHost.start`) — and nothing is sent to the bucket. If the base behaves otherwise in either
    role, stop (rules §5.3).
  Re-point `testing/stream-loop-scenario.ts:333` and `stream-pause-scenario.ts:347` to
  `writeStreamSettings`; `testing/old-stream-credential.ts` (which builds an old-format payload on
  purpose) keeps its job if a case still needs an unreadable credential, else it is deleted with its
  only caller named in the pull request.
- [ ] **Step 2: Run; fail. Step 3: Implement** per **Interfaces**; the PUT route
  (`stream-api.ts:227-252`) calls `writeStreamSettings` where it called `putCredential`, the DELETE
  route `deleteStreamSettings`; the recovery-pack parts call `readStreamSettingsIn(tx, ring)` as before.
- [ ] **Step 4: Run** finish lines 1–2; pass.
- [ ] **Step 5: Guide and docs** per **Files**; finish line 3.
- [ ] **Step 6: Protection list:** nothing. **Step 7: Commit**, then `/finish-branch`.

## Waitron Cloud

Nothing to change: Cloud calls `PUT` and `GET /api/backup/stream` with today's body and reads today's
answer (`integration-stream.mjs:59,65` in its repository, at `d4451d227`), both unchanged here.

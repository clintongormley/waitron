# A1308 jr10 — Waitron Cloud as a destination of the one backup service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** Cloud snapshots stop being a job of their own. Waitron Cloud becomes a destination of the
one backup service: each scheduled backup makes one staged copy and stores it on every destination,
encrypting it once per key; Cloud follows the venue's schedule, which must then be at least daily;
and Cloud stays refused on real venues until Cloud's service is ready.

**Architecture:** Cloud differs from the other destinations in three ways (jobs.md §1 table): its key
comes with each upload grant, it needs temporary upload permission (reserve, upload, publish), and it
deletes its own old copies. So Cloud is **not** a `StorageBackend` (`apps/server/src/storage-backend.ts:38-56`
requires `list`, `get`, `getFile`, `delete`, `deleteMany`, which the grant gives none of); it is a
separate `CloudArchiveTarget` the sweep calls after the box-key destinations, reusing the staged
plaintext copy, and its status comes by its own read of the Cloud connection (the design's second
option, "or Cloud's status comes by its own read"). The capture state file and the finishing of a
capture cut off between upload and publish move from `cloud-snapshot-worker.ts:159-293` into the
target. `cloud-snapshot-loop.ts`, `cloud-snapshot-worker.ts` and `cloud-snapshot-archive.ts` go.

**Spec:** [jobs.md §1 "One backup service with several backends" (its table, the schedule paragraph, "Two limits stay"); §2 R12; §3 row "Daily encrypted snapshot to Waitron Cloud"; §5 measure 13](../specs/2026-11-02-rationalisation/jobs.md);
README §10 ("Waitron Cloud backups: follow the venue's schedule, which must be at least daily when
Cloud is a destination"); owner 2026-10-23 (Waitron works entirely on-premises with no Cloud).
Slice rules apply.

## What it builds

1. The backup settings record gains `cloud: boolean` (default `false`): in `ArchiveSettings`
   (`apps/server/src/archive-settings.ts:34-44`), or in env6's backup document if it has landed —
   the same field either way. With `cloud: true`, `destinations` may be empty.
2. Saving `cloud: true` with a schedule less often than daily, or a less-often schedule with
   `cloud: true`, is refused `backup.cloud_needs_daily` (field `schedule`, 400). "At least daily":
   a `wall-clock` schedule whose `days` is `"daily"` or all seven days, or an `interval` of at most
   86,400,000 ms (`BackupSchedule`, `backup-config.ts:19-21`).
3. `CloudArchiveTarget` in `apps/server/src/cloud-archive-target.ts`.
4. The sweep (`runOnce`, `backup-sweep.ts:190-356`): after the box-key destinations, when a Cloud
   target is configured, it reserves a capture, encrypts the same staged copy with the grant's key
   (`encryptArtifactFile`, as `:272-278` does with the box key) into its own file in the staging
   folder, uploads, publishes. Cloud's result goes to `onDestinationResult` with id `cloud`.
   Cloud is never pruned by the box.
5. The dashboard's Backups screen offers Cloud only when this box has a Cloud connection whose
   retained-snapshot service is set up, shows the refusal under the schedule field, with one action,
   "Back up every day", that sets the schedule to daily.
6. Measure 13.

## What it leaves out

Google Drive and other backends (later); A1323's master key; Cloud's own continuous copy (not traced,
jobs.md §6).

## Files

- Create: `apps/server/src/cloud-archive-target.ts`, `cloud-archive-target.test.ts`
- Modify: `archive-settings.ts` (or env6's document module), `archive-settings.test.ts`,
  `backup-api.ts` (`readApplyBody`, `:203-224`; status code table `:95-99`), `backup-api.route.test.ts`,
  `backup-sweep.ts`, `backup-sweep.test.ts`, `backup-supervisor.ts` (builds the target when
  `cloud` is set and a connection exists), `backup-supervisor.test.ts`, `errors.ts` (the new code),
  `boot.ts` (`:2611-2621` `backupDeadlines.cloud`; `:3827-3862` the snapshot loop; `:3798`
  `cloudController`), `background-duties.ts` (`cloudController`, `cloudSnapshots`),
  `background-duties.test.ts`, `handover-stepdown.test.ts`,
  `apps/dashboard/src/screens/backup-screen.ts`, its test, `apps/dashboard/src/i18n/strings.ts`,
  `apps/dashboard/src/i18n/codes.ts`, the Backups guide in English and Spanish (CLAUDE.md §3)
- Delete: `cloud-snapshot-loop.ts`, `cloud-snapshot-worker.ts`, `cloud-snapshot-archive.ts` and their tests

## Size

| Hand-written | Lines |
| --- | --- |
| Code: target 190 (moved logic, about 130 lines leave the worker), sweep 50, settings and refusal 45, supervisor 25, `boot.ts` 20, duties 10, dashboard 70, wording and guide 30 | **~440** |
| Tests: target 260 (cases re-pointed from `cloud-snapshot-worker.test.ts`), sweep 60, settings and route 60, dashboard 60 | **~440** |
| Total | **~880** |

If the dashboard half pushes past 1,000, split it into its own pull request after the server half
(the server refuses the combination either way).

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/cloud-archive-target.test.ts src/backup-sweep.test.ts src/backup-supervisor.test.ts src/archive-settings.test.ts src/backup-api.route.test.ts src/cloud-backup.test.ts src/cloud-backup-upload.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts` — passes.
2. `pnpm --filter @waitron/dashboard exec vitest run src/screens/backup-screen.test.ts` (and its
   `.a11y` and `.unsaved` siblings if they exist) — passes; open the screen in both themes and at
   phone width (CLAUDE.md §4).
3. `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts` — pass. Typecheck,
   format; protection list EQUAL; measure 13's result in the PR description.

## Expected protection-list difference

**EQUAL.** The setting lives in a sealed record or a settings document, not in a column. Any line is a stop.

## Stop points (beyond rules §5)

1. Measure 13 fails (Task 1). 2. A re-pointed `cloud-snapshot-worker.test.ts` case needs a changed
assertion other than the one schedule change this plan makes (Cloud's fixed daily time,
`cloud-snapshot-worker.ts:262-268`, gives way to the venue's schedule). 3. The target would need any
of `list`, `get`, `delete` from Cloud.

## Needs

jr8. If env6 has landed, its backup document.

## Global Constraints

- Real venues stay refused: the target refuses anything but a test connection
  (`status.environment !== "test"`, `cloud-snapshot-worker.ts:179`; `cloud-client.ts:357-360`) with
  `cloud.unavailable`, recorded as Cloud's destination outcome, never thrown out of the sweep.
- Cloud refuses an upload over 512 MB (`MAX_BYTES`, `cloud-snapshot-worker.ts:10`); the target
  checks the ciphertext's size before reserving and records `cloud.unavailable`.
- Encrypt once per key: the box-key destinations share one ciphertext; Cloud gets one of its own,
  from the same staged copy, inside the same staging turn.
- Waitron works with no Cloud at all: with `cloud: false`, or no connection, nothing Cloud-related
  runs and nothing fails.
- A missed day is not refused; it shows in the backup status (jobs.md §1, "a missed run is the
  health check's business").

## Review Focus

1. **A capture uploaded but not published when the box stopped.** The next run publishes it first
   (unless older than a day, `pendingExpired`), then makes the new one. Task 2.
2. **The schedule saved weekly while Cloud is on.** Refused with the reason and the daily action;
   the saved settings are unchanged. Task 3.
3. **Cloud chosen with no local folder or bucket.** Allowed; the backup runs to Cloud alone.
4. **Each capture's label.** The first capture in a calendar month (venue time zone) is `monthly`,
   later ones `daily` (`cloud-snapshot-worker.ts:254-258`).
5. **A Cloud failure on a box with a local folder too.** The local copy is still stored; Cloud's
   failure is its own destination outcome.

---

### Task 1: Measure 13 — a year's archive against Cloud's 512 MB

- [ ] **Step 1:** Build an encrypted archive of the bench's year-of-trading copy with `runOnce`
  (slice 0's year; a local folder destination in a scratch directory). Record the plaintext and the
  encrypted sizes.
- [ ] **Step 2: Failing result, written in advance:** the encrypted archive is over 512 MB. Then "a
  real venue cannot use Cloud as its main target until that limit moves" (jobs.md §5.13): stop and
  ask; the watcher records it against Cloud's backlog. Under 512 MB: record the margin and carry on.

### Task 2: `CloudArchiveTarget`

**Interfaces:**

```ts
export interface CloudArchiveTarget {
  readonly id: "cloud";
  /** Finishes a capture cut off before publish, then stores `stagedEntries` encrypted with the
   *  grant's key. Never throws; returns the outcome for onDestinationResult. */
  store(input: {
    entries: () => AsyncIterable<Uint8Array>;   // packArchiveStream over the staged copy
    modules: Record<string, number>;            // manifest.modules
    stagingDir: string;                         // inside the staging turn
    at: Date;
    clock: ScheduleClock;
    signal: AbortSignal;
  }): Promise<{ stored: boolean; errorCode: string | null }>;
}
export function createCloudArchiveTarget(deps: {
  stateDir: string;                // capture state in <state>/cloud-snapshots/state.json, as today
  connection: Pick<CloudConnection, "status" | "reserveCapture" | "publishCapture">;
  upload: (grant: CloudCaptureGrant, file: string, metadata: CloudCaptureMetadata, signal: AbortSignal) => Promise<void>;
  sourceNodeId: string;
  isPrimary: () => boolean;
  now?: () => Date;
}): CloudArchiveTarget;
```

The state file, its validation (`readState`), `durableWrite`, `monthAt`, `pendingExpired`, the
installation and venue checks, the key version check and the publish retry move from the worker
unchanged; the daily `nextAt` goes (the venue's schedule decides when).

- [ ] **Step 1:** Re-point `cloud-snapshot-worker.test.ts`'s cases to `cloud-archive-target.test.ts`;
  assertions unchanged except the fixed daily time (stop point 2). Add
  `"refuses a connection that is not a test connection, as an outcome"`;
  `"refuses an archive over 512 MB before reserving"`;
  `"publishes a capture cut off after upload before making a new one"`.
- [ ] **Step 2–4:** FAIL; implement; PASS. Commit: "Move Cloud captures into a destination of the backup service".

### Task 3: Settings, the refusal, the sweep

- [ ] **Step 1: Failing tests:** `archive-settings.test.ts` — `"keeps cloud false by default"`,
  `"allows no folder or bucket when cloud is on"`. `backup-api.route.test.ts` —
  `"refuses cloud with a weekly schedule, naming the schedule"` (400, `backup.cloud_needs_daily`,
  `field: "schedule"`); `"refuses a weekly schedule while cloud is on"`;
  `"accepts cloud with a daily schedule, and with all seven days"`. `backup-sweep.test.ts` —
  `"encrypts once for the box-key destinations and once for Cloud, from one staged copy"`;
  `"a Cloud failure leaves the local copy stored"`; `"Cloud is never pruned by the box"`.
- [ ] **Step 2–4:** FAIL; implement (register `backup.cloud_needs_daily` in `apps/server/src/errors.ts`
  and its status in `backup-api.ts`'s table); PASS.
- [ ] **Step 5:** Boot: remove the snapshot loop (`:3827-3862`), `cloudController` and
  `cloudSnapshots` from `background-duties.ts` (and `ABORTS` in `handover-stepdown.test.ts`), and
  pass the target's dependencies to the supervisor. `backupDeadlines.cloud` becomes the archive's
  fire time when `cloud` is set, else `null` (`venue-clock-preview.ts` reads it unchanged).
  Commit: "Store backups on Waitron Cloud through the one backup service".

### Task 4: The Backups screen and the guide

- [ ] **Step 1:** In `backup-screen.ts`: a "Waitron Cloud" choice beside the folder and bucket,
  shown only when the box status says Cloud is connected with retained snapshots; the request's
  `cloud` field; `backup.cloud_needs_daily` shown under the schedule field (CLAUDE.md §3 forms: a
  field refusal appears under that field) with a button "Back up every day" / "Hacer copia cada día"
  that sets the schedule to every day and clears the refusal. Wording, exact:
  - `codes.ts` `backup.cloud_needs_daily`: en "Waitron Cloud keeps one copy a day, so it needs a backup every day." /
    es "Waitron Cloud guarda una copia al día, así que necesita una copia de seguridad cada día."
  - `strings.ts` `backup.destination.cloud`: "Waitron Cloud" (both languages).
  Tests: the choice hidden without a Cloud connection; the refusal and its action; an a11y case for
  the new state in both themes (the screen's sibling `*.a11y.test.ts`).
- [ ] **Step 2:** The Backups guide (English and Spanish, shared `{#id}` headings) gains two
  sentences: Cloud follows the venue's schedule, which must be every day while Cloud is chosen; the
  box does not delete Cloud's old copies, Cloud keeps them. Run the Finish line. Commit: "Offer Waitron Cloud on the Backups screen".

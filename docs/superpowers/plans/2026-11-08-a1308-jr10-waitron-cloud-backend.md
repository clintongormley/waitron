# A1308 jr10 — Waitron Cloud as a destination of the one backup service (server) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6).

**Goal:** Cloud snapshots stop being a job of their own. Waitron Cloud becomes a destination of the
one backup service: each scheduled backup makes one staged copy and stores it on every destination,
encrypting it once per key; Cloud follows the venue's schedule, which must then be at least daily;
Cloud stays refused on real venues until Cloud's service is ready; and whenever Cloud is chosen but
cannot run, the backup status says so. The Backups screen's half is
[jr10b](2026-11-08-a1308-jr10b-cloud-backups-screen.md).

**Architecture:** Cloud is **not** a `StorageBackend` (`apps/server/src/storage-backend.ts:38-56`),
for one reason that decides it: Cloud's encryption key arrives only with the upload grant, at
reserve time (`grant.recoveryKey`, `cloud-snapshot-worker.ts:251-262`). A `StorageBackend` receives a
finished ciphertext in `putFile`, encrypted before any destination is called (`backup-sweep.ts:272-278`),
so Cloud's ciphertext cannot exist yet when `putFile` would be called. (The grant also gives none of
`list`, `get`, `getFile`, `delete`, `deleteMany`.) So Cloud is a separate `CloudArchiveTarget` the
sweep calls after the box-key destinations, reusing the staged plaintext copy, and its status comes
from its own read of the Cloud connection (the design's second option, jobs.md §1 table). The capture
state file and the finishing of a capture cut off between upload and publish move from
`cloud-snapshot-worker.ts:159-293` into the target. `cloud-snapshot-loop.ts`,
`cloud-snapshot-worker.ts` and `cloud-snapshot-archive.ts` go.

**Spec:** [jobs.md §1 "One backup service with several backends" (its table, the schedule paragraph, "Two limits stay"); §2 R12; §3 row "Daily encrypted snapshot to Waitron Cloud"; §5 measure 13](../specs/2026-11-02-rationalisation/jobs.md);
README §10 ("Waitron Cloud backups: follow the venue's schedule, which must be at least daily when
Cloud is a destination"); owner 2026-10-23 (Waitron works entirely on-premises with no Cloud).
Slice rules apply.

## What it builds

1. The backup settings record gains `cloud: boolean` (default `false`): in `ArchiveSettings`
   (`apps/server/src/archive-settings.ts:34-44`), or in env6's backup document if it has landed.
   With `cloud: true`, `destinations` may be empty.
2. Saving `cloud: true` with a schedule less often than daily, or a less-often schedule with
   `cloud: true`, is refused `backup.cloud_needs_daily` (field `schedule`, 400). "At least daily":
   a `wall-clock` schedule whose `days` is `"daily"` or all seven days, or an `interval` of at most
   86,400,000 ms (`BackupSchedule`, `backup-config.ts:19-21`). Saving `cloud: true` on a box whose
   Cloud connection is not a test connection is refused `backup.cloud_unavailable` (field `cloud`):
   Cloud is offered only where it can run, so a production box never collects a daily failure.
3. `CloudArchiveTarget` in `apps/server/src/cloud-archive-target.ts`.
4. The sweep (`runOnce`, `backup-sweep.ts:190-356`): after the box-key destinations, when `cloud` is
   set, it calls the target with the staged copy. Cloud's result goes to `onDestinationResult` with
   id `cloud`. Cloud is never pruned by the box.
5. **An outcome whenever Cloud is chosen but cannot run:** no Cloud connection, a connection that is
   not a test one, a revoked installation, the retained-snapshot service not set up, or an archive
   too large. Each records Cloud's destination outcome (`stored: false`, the reason's code) at the
   run it would have gone in, so the backup status and its alert show it. Nothing about Cloud is
   silent once `cloud` is set; with `cloud: false` nothing Cloud-related runs.
6. Measure 13.

## What it leaves out

The Backups screen (jr10b); Google Drive and other backends; A1323's master key; Cloud's own
continuous copy (not traced, jobs.md §6).

## Files

- Create: `apps/server/src/cloud-archive-target.ts`, `cloud-archive-target.test.ts`
- Modify: `archive-settings.ts` (or env6's document module), `archive-settings.test.ts`,
  `backup-api.ts` (`readApplyBody`, `:203-224`; status table `:95-99`), `backup-api.route.test.ts`,
  `backup-sweep.ts` (the room check, `:228-247`; the destinations, `:281-319`), `backup-sweep.test.ts`,
  `backup-supervisor.ts`, `backup-supervisor.test.ts`, `errors.ts` (the two codes),
  `apps/dashboard/src/i18n/codes.ts` (the two codes' words, so the refusal reads), `boot.ts`
  (`:2611-2621` `backupDeadlines.cloud`; `:3827-3862` the snapshot loop), `background-duties.ts`,
  `background-duties.test.ts`, `handover-stepdown.test.ts`
- Delete: `cloud-snapshot-loop.ts`, `cloud-snapshot-worker.ts`, `cloud-snapshot-archive.ts` and their tests

## Size

| Hand-written | Lines |
| --- | --- |
| Code: target 200 (moved logic, about 130 lines leave the worker), sweep and room check 60, settings and two refusals 50, supervisor 25, outcomes 20, `boot.ts` 20, duties 10, codes 10 | **~395** |
| Tests: target 270 (cases re-pointed from `cloud-snapshot-worker.test.ts`), sweep 70, settings and route 70 | **~410** |
| Total | **~805** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/cloud-archive-target.test.ts src/backup-sweep.test.ts src/backup-supervisor.test.ts src/archive-settings.test.ts src/backup-api.route.test.ts src/cloud-backup.test.ts src/cloud-backup-upload.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts` — passes.
2. Typecheck, format; protection list EQUAL; measure 13's result in the PR description.

## Expected protection-list difference

**EQUAL.** The setting lives in a sealed record or a settings document, not in a column. Any line is a stop.

## Stop points (beyond rules §5)

1. Measure 13 fails (Task 1). 2. A re-pointed `cloud-snapshot-worker.test.ts` case needs a changed
assertion other than the one schedule change this plan makes (Cloud's fixed daily time,
`cloud-snapshot-worker.ts:212`, gives way to the venue's schedule). 3. The target would need any of
`list`, `get`, `delete` from Cloud.

## Needs

jr8 (and so jr3, which moved `runCloudWorker` onto the runner). If env6 has landed, its backup document.

## Global Constraints

- Real venues stay refused: the target refuses anything but a test connection (`status.environment !== "test"`,
  `cloud-snapshot-worker.ts:179`; `cloud-client.ts:362`) with `cloud.unavailable` as Cloud's outcome,
  never thrown out of the sweep.
- Cloud refuses an upload over 512 MB (`MAX_BYTES`, `cloud-snapshot-worker.ts:10`). The key arrives
  only with the reserve, so the size is checked **before reserving** on the plaintext archive plus
  the encryption's fixed overhead (the artifact cipher's header and tag; take the number from
  `artifact-cipher.ts`), and again on the ciphertext before upload.
- Encrypt once per key: the box-key destinations share one ciphertext; Cloud gets one of its own,
  from the same staged copy, inside the same staging turn.
- **Where Cloud's ciphertext lives:** between runs it stays where it does today,
  `<state>/cloud-snapshots/archive.enc` (`cloud-snapshot-worker.ts:142`, written `:275`), beside its
  `state.json`, because a capture cut off after upload is published from it at the next run. It is
  not in the per-run staging folder. The room check before the copy (`backup-sweep.ts:228-247`)
  counts one more ciphertext's worth of space when `cloud` is set, plus the size of an `archive.enc`
  already waiting.
- Waitron works with no Cloud at all: with `cloud: false` nothing Cloud-related runs and nothing fails.

## Review Focus

1. **A capture uploaded but not published when the box stopped.** The next run publishes it first
   (unless older than a day, `pendingExpired`), then makes the new one. Task 2.
2. **The schedule saved weekly while Cloud is on.** Refused with the reason; the saved settings are
   unchanged. Task 3.
3. **Cloud chosen with no local folder or bucket.** Allowed; the backup runs to Cloud alone.
4. **Each capture's label.** The first capture in a calendar month (venue time zone) is `monthly`,
   later ones `daily` (`cloud-snapshot-worker.ts:271`).
5. **Cloud chosen, then the connection revoked.** Each run records Cloud's outcome with the reason;
   the local copy is still stored. Task 3.

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
  /** The room it needs this run: one ciphertext's worth, plus an archive.enc already waiting. */
  roomNeeded(plaintextBytes: number): Promise<number>;
  /** Finishes a capture cut off before publish, then stores the staged archive encrypted with the
   *  grant's key. Never throws; returns the outcome for onDestinationResult. */
  store(input: {
    entries: () => AsyncIterable<Uint8Array>;   // packArchiveStream over the staged copy
    plaintextBytes: number;
    modules: Record<string, number>;            // manifest.modules
    at: Date;
    clock: ScheduleClock;
    signal: AbortSignal;
  }): Promise<{ stored: boolean; errorCode: string | null }>;
}
export function createCloudArchiveTarget(deps: {
  stateDir: string;                // <state>/cloud-snapshots/{state.json,archive.enc}, as today
  connection: Pick<CloudConnection, "status" | "reserveCapture" | "publishCapture"> | undefined;
  upload: (grant: CloudCaptureGrant, file: string, metadata: CloudCaptureMetadata, signal: AbortSignal) => Promise<void>;
  sourceNodeId: string;
  isPrimary: () => boolean;
  now?: () => Date;
}): CloudArchiveTarget;
```

The state file, its validation (`readState`), `durableWrite`, `monthAt`, `pendingExpired`, the
installation and venue checks, the key version check and the publish retry move from the worker
unchanged; the daily `nextAt` goes (the venue's schedule decides when). With no connection, `store`
returns `{ stored: false, errorCode: "cloud.unavailable" }`.

- [ ] **Step 1:** Re-point `cloud-snapshot-worker.test.ts`'s cases to `cloud-archive-target.test.ts`;
  assertions unchanged except the fixed daily time (stop point 2). Add
  `"refuses a connection that is not a test connection, as an outcome"`;
  `"refuses an archive whose plaintext plus overhead is over 512 MB before reserving"`;
  `"publishes a capture cut off after upload before making a new one"`;
  `"with no connection it records cloud.unavailable"`.
- [ ] **Step 2–4:** FAIL; implement; PASS. Commit: "Move Cloud captures into a destination of the backup service".

### Task 3: Settings, the refusals, the sweep

- [ ] **Step 1: Failing tests:** `archive-settings.test.ts` — `"keeps cloud false by default"`,
  `"allows no folder or bucket when cloud is on"`. `backup-api.route.test.ts` —
  `"refuses cloud with a weekly schedule, naming the schedule"` (400, `backup.cloud_needs_daily`,
  `field: "schedule"`); `"refuses a weekly schedule while cloud is on"`;
  `"accepts cloud with a daily schedule, and with all seven days"`;
  `"refuses cloud on a box whose Cloud connection is not a test one"` (`backup.cloud_unavailable`,
  `field: "cloud"`). `backup-sweep.test.ts` —
  `"encrypts once for the box-key destinations and once for Cloud, from one staged copy"`;
  `"the room check counts Cloud's ciphertext and a waiting archive.enc"`;
  `"a Cloud failure leaves the local copy stored and records Cloud's outcome"`;
  `"Cloud chosen with the connection revoked records an outcome every run"`;
  `"Cloud is never pruned by the box"`.
- [ ] **Step 2–4:** FAIL; implement (register both codes in `apps/server/src/errors.ts`, their
  statuses in `backup-api.ts`'s table, and their English and Spanish words in `codes.ts`:
  `backup.cloud_needs_daily` — en "Waitron Cloud keeps one copy a day, so it needs a backup every day." /
  es "Waitron Cloud guarda una copia al día, así que necesita una copia de seguridad cada día.";
  `backup.cloud_unavailable` — en "Waitron Cloud backups are not available on this box yet." /
  es "Las copias en Waitron Cloud aún no están disponibles en este equipo."); PASS.
- [ ] **Step 5:** Boot: remove the snapshot loop (`:3827-3862`) and `cloudSnapshots` from
  `background-duties.ts`. Remove `cloudController` too **only if nothing else reads it** — after jr3,
  `runCloudWorker` is the `cloud.connection` job and `onStaffCertificate` reads the job's signal; if
  any reader of `cloudController.signal` remains at the base (`rg -n cloudController apps/server/src`),
  keep it and remove only `cloudSnapshots`. Pass the target's dependencies to the supervisor.
  `backupDeadlines.cloud` becomes the archive's fire time when `cloud` is set, else `null`
  (`venue-clock-preview.ts` reads it unchanged). Commit: "Store backups on Waitron Cloud through the one backup service".

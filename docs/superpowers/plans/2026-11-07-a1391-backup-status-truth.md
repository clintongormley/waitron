# A1391 — Backup status tells the truth and leaks nothing

Status: plan, 2026-11-07. Lane B. Branch `fix/a1391-backup-status-truth`. One PR.
Source: the bundle `docs/backlog/box.md#bundle-a1391-backup-status-tells-the-truth-and-leaks-nothing`
(three entries). No table, column, index or trigger changes (the A1308 hold allows it).

Risk triggers: concurrency (Task 3 shares a storage client between the running backup and status
reads). So: a review after every task, and `/finish-branch` FULL with two Codex angles.

## What is wrong today (read on main 59be31e3b7)

1. **A bucket address can carry a password, and status sends it.** `readBucketConfig`
   (`packages/stream/src/bucket-config.ts:26-35`) checks only that the endpoint parses as a URL with
   `http:`/`https:`, so `https://user:secret@host` is accepted. `destinationView`
   (`apps/server/src/backup-supervisor.ts:62-75`) copies it into `GET /api/backup/status`
   unchanged; the stream settings answer does the same (`apps/server/src/stream-api.ts:194`). The
   settings-evidence answer masks it (`backup-settings-evidence.ts:206`).
   Masking in the status reply alone would break the Backups form: `openingDestinations`
   (`apps/dashboard/src/screens/backup-destination-model.ts:104-127`) fills the custom bucket form
   from the held endpoint, and `keepsHeldSecret` compares it to the typed one, so a masked address
   would be saved back masked, with the held secret kept, and the bucket would stop working.
2. **A destination that fails to build leaves archives reported as on.** In
   `BackupSupervisor.reload()` (`backup-supervisor.ts:288-292`) `#db` is assigned before
   `cfg.destinations.map(this.#buildBackend)`; a throw there (`archiveNamespace` refusing, or the S3
   store refusing its settings) escapes `reload()` with `#db` set, so `current().enabled` is true and
   no sweep runs. The opened venue handle is not closed until the next teardown.
3. **Every status read builds a new client per destination** (`#readDestination`,
   `backup-supervisor.ts:453-467`), a new S3 client for a bucket, and closes it once its listing
   settles, even while the running sweep holds live clients for the same destinations.

## Decisions (stated here so the reviews can check them)

- **D1 — refuse, do not mask.** An S3 endpoint is reached with the access key and secret; a user
  name or password in the URL is not how the S3 client signs requests. `readBucketConfig` refuses an
  endpoint whose URL has a non-empty `username` or `password`, as `endpoint`. Every S3 destination
  and the stream bucket pass through `readBucketConfig` (callers: `archive-settings.ts:175` stored
  archive bucket, `:436` dashboard save; `stream-api.ts:111` stream save; `backup-config.ts:161`
  environment settings; `archive-recovery-pack.ts:101`; `packages/stream/src/kit.ts:60`), so the
  address can no longer be saved, loaded or restored with a password, and status cannot send one.
  A record already stored with one now fails to load (archives off with the stored-settings code,
  the existing path). Before go-live no compatibility code is owed (CLAUDE.md §3 last rule).
  `destinationView` is left as it is: masking there would be a second rule for a value that can no
  longer arrive, and it would reopen the form round trip above.
- **D2 — the refusal's words.** The endpoint refusal already says
  `stream.form.endpoint_invalid` ("Enter the full address, starting with https:// or http://"). It
  gains "with no user name or password in it" (English and Spanish, `apps/dashboard/src/i18n/strings.ts`),
  so the person reading the field's refusal knows what to change. Grep for any other screen that
  words an `endpoint` refusal (setup's restore and first-setup forms) and change it the same way.
- **D3 — a destination that fails to build leaves archives off, honestly.** `reload()` builds every
  destination's backend before it adopts the venue handle. If one throws: close the backends already
  built, close the venue handle, log `backup.disabled_backend_failed` with the destination id and the
  error's code, and return normally (as the venue-open failure does). Keep `#config`, so the screen
  still lists the destinations and each status read reports that destination's build code through
  `unreadDestination` (`#readDestination` already does this when building throws). `enabled` reads
  false because `#db` stays undefined; the Backups screen then shows "off" and its configure form
  (`backup-screen.ts:1330`, `:1360-1363`), which is the truth and offers the fix.
- **D4 — status reads borrow the running sweep's backends; nothing waits for them.** When the
  status read's settings are the running sweep's settings (taken together, synchronously, as
  `#sweep` is now) and the sweep holds a backend for that destination id, the read uses it instead of
  building one. Each backend the supervisor hands out carries a count of status reads in flight. The
  teardown releases its backends without waiting: one with no read in flight is closed at once; one
  with a read in flight is closed when that read's listing settles (`DestinationRead.settled`). So
  `close()` still runs only once no call is in flight (`storage-backend.ts:54`), and a reload or
  `stop()` never waits on a listing that may never settle (`backup-status.ts:37-38`: a folder
  listing's `readdir` takes no abort signal). A read whose settings are not the sweep's (no sweep,
  not primary, a reload between, a build failure) builds its own backend and closes it on settle,
  as now.

## Tasks

Each task is test-first: write the failing test, run it and see it fail for the stated reason,
then the smallest change. Focused commands are given; the pre-push hook and CI do the rest.

### Task 1 — refuse a user name or password in a bucket address (D1, D2)

Files: `packages/stream/src/bucket-config.ts` and its test; `apps/server/src/archive-settings.test.ts`
(or the status route's suite) for the stored-record case; `apps/dashboard/src/i18n/strings.ts`;
any other screen wording found by the D2 grep.

1. Failing tests in `packages/stream/src/bucket-config.test.ts`: `https://user:secret@host`,
   `https://user@host` and `https://:secret@host` are refused as `endpoint`; `https://host:9000/path`
   is still accepted (a port is not a password). Run
   `pnpm --filter @waitron/stream exec vitest run src/bucket-config.test.ts`.
2. Failing test at the server: a stored archive record whose bucket endpoint carries a password
   loads as unusable (the existing stored-settings code), and `GET /api/backup/status` answers with no
   occurrence of the password anywhere in its body (assert on the serialised body, not one field).
   Also: a dashboard save of `custom-s3` with such an endpoint is refused with `field: "endpoint"`,
   and the stream save likewise. Find the existing suites for these routes and add cases there.
3. Implement in `readBucketConfig` with `new URL(endpoint)`'s `username`/`password`.
4. Words: amend `stream.form.endpoint_invalid` in English and Spanish; update any test that reads
   the English words from the strings file (do not edit an assertion that spells them; if one does,
   STOP and report). Grep `apps/setup/src` for endpoint refusal words and treat them the same.
5. Prove by deletion: remove the new check, see steps 1-2's tests fail, restore.

### Task 2 — a destination that fails to build leaves archives off (D3)

Files: `apps/server/src/backup-supervisor.ts`, `apps/server/src/backup-supervisor.test.ts`.

1. Failing test: with `buildBackend` throwing an `AppError` for the second of two destinations,
   `reload()` resolves; `current().enabled` is false; the first destination's backend was closed;
   the venue handle `openVenue` returned was closed; no sweep tick ran (no upload, no `onScheduled`);
   the log carries `backup.disabled_backend_failed` with that destination's id and code; `status()`
   lists both destinations and the failing one's `readErrorCode` is the build code.
2. Failing test: the same with `buildBackend` throwing on the FIRST destination (nothing built yet).
3. Failing test: a later `reload()` with a buildable config starts the sweep normally (nothing left
   latched).
4. Implement: build the backends in a `try` after the venue opens and the `#stopped` check, before
   `this.#db = venue`; on failure close what was built and the venue, log, return. If the
   `#stopped` check after opening applies, keep its current order.
5. Add `backup.disabled_backend_failed` wherever log codes must be registered (grep how
   `backup.disabled_open_failed` is registered; run `scripts/alert-codes.test.ts` and
   `scripts/errors-reachable.test.ts` if either names it).
6. Prove by deletion.

### Task 3 — status reads use the running sweep's backends; close waits for them (D4)

Files: `apps/server/src/backup-supervisor.ts`, its test.

1. Failing tests (use the existing `buildBackend` stub that records builds and closes):
   a. While the sweep runs, `status()` builds NO new backend for a destination the sweep holds, and
      the listing is served by the sweep's backend.
   b. A `reload()` (or `stop()`) while a status read's listing is pending does not close that
      backend until the listing settles, and does not wait for it: `reload()`/`stop()` resolves while
      the listing is still pending. After the listing settles, the backend is closed exactly once.
   c. A backend with no read in flight is closed by the teardown at once, exactly once.
   d. Two overlapping status reads on one backend: closed only after BOTH settle.
   e. A listing that never settles: `stop()` still resolves, and that backend is never closed.
   f. With no sweep running (settings off, not primary, or Task 2's build failure), `status()`
      builds its own backend and closes it on settle, as before.
   g. A status read that captured the settings before a reload replaced them does not borrow the new
      sweep's backends (it builds its own), and a read started after the reload borrows the new ones.
2. Implement per D4. Keep the backends the sweep runs with and the bookkeeping in one place; the
   sweep (`runBackupSweep`) is given the same backend objects it gets today.
3. Run `pnpm --filter @waitron/server exec vitest run src/backup-supervisor.test.ts
   src/backup-supervisor.network.test.ts src/backup-api.test.ts` (and any `backup-*.test.ts` that
   drives `status()`; grep for `.status()` callers).
4. Prove by deletion: make the teardown close every backend at once; see b and d fail. Make status
   always build; see a fail.

### Task 4 — backlog and words that describe the old behaviour

1. Delete the bundle `## Bundle A1391` in `docs/backlog/box.md`, the two detail sections it links
   ("Backup status sends a saved bucket address as stored, password included." and "A backup
   destination that fails to build leaves archives reported as on."), and A1391's two lines in
   `docs/backlog.md` (index ~116 and the list ~1781). Grep `docs/` for any other link to the
   removed anchors and fix it.
2. Grep comments and docs (`docs/developers`, the guides under `apps/server/src/guide/`) for
   sentences describing the old behaviour: the status read building per destination, or an endpoint
   that may hold a password. `redact-secrets.ts`'s "WHERE IT IS APPLIED" list stays true (the
   evidence answer still masks); leave it.

## Out of scope

- The settings-evidence answer keeps its masking (records written before this change may still be
  shown there as evidence of what was stored).
- No change to `runBackupSweep`.
- No alert for a destination that fails to build; the log line and the "off" status are the change.

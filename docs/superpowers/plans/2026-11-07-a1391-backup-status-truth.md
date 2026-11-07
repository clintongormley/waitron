# A1391 — Backup status tells the truth and leaks nothing

Status: plan, 2026-11-07. Lane B. Branch `fix/a1391-backup-status-truth`. One PR.
Source: the bundle `docs/backlog/box.md#bundle-a1391-backup-status-tells-the-truth-and-leaks-nothing`
(three entries). No table, column, index or trigger changes (the A1308 hold allows it).

Revision 2 (2026-11-07): the fresh plan review's findings folded (I1–I5, M1–M6). Task 3 is not
built: the watcher decided 2026-11-07 08:58 (questions.md); the review said it should not exist.

Risk triggers: none, with Task 3 not built (a secret's exposure is close to one, so the review stays
FULL). A review after every task, and `/finish-branch`
FULL with two Codex angles.
_2026-11-07, 11:36: a smaller form of Task 3 was built instead; see D4's last note._

## What is wrong today (read on main 59be31e3b7)

1. **A bucket address can carry a password, and status sends it.** `readBucketConfig`
   (`packages/stream/src/bucket-config.ts:26-35`) checks only that the endpoint parses as a URL with
   `http:`/`https:`, so `https://user:secret@host` is accepted. `destinationView`
   (`apps/server/src/backup-supervisor.ts:62-75`) copies it into `GET /api/backup/status`
   unchanged; the stream settings answer does the same (`apps/server/src/stream-api.ts:194`). The
   settings-evidence answer masks it (`backup-settings-evidence.ts:206`).
   Masking in the status reply alone would break the Backups form: `openingDestinations`
   (`apps/dashboard/src/screens/backup-destination-model.ts:104-127`) fills the custom bucket form
   from the held endpoint, so the person would see the masked address, and a save without retyping
   the secret is refused as `secretAccessKey` (the server's `customBucket` compares the full address,
   `archive-settings.ts:445-453`).
2. **A destination that fails to build leaves archives reported as on.** In
   `BackupSupervisor.reload()` (`backup-supervisor.ts:288-292`) `#db` is assigned before
   `cfg.destinations.map(this.#buildBackend)`; a throw there escapes `reload()` with `#db` set, so
   `current().enabled` is true and no sweep runs. The opened venue handle is not closed until the next
   teardown. NOT reachable from settings that load today (plan review I4: `archiveNamespace` already
   runs at load, `archive-settings.ts:197`, `backup-config.ts:164`, and the review constructed
   `S3Client` with bad region and endpoint values without a throw), so the fix is defensive against an
   injected or future builder.
3. **Every status read builds a new client per destination** (`#readDestination`,
   `backup-supervisor.ts:453-467`), a new S3 client for a bucket, and closes it once its listing
   settles, even while the running sweep holds live clients for the same destinations.

## Decisions (stated here so the reviews can check them)

- **D1 — refuse, do not mask.** An S3 endpoint is reached with the access key and secret. The plan
  review pointed `@aws-sdk/client-s3` at a local server with `http://user:secret@127.0.0.1:<port>`:
  the request was signed the same (`AWS4-HMAC-SHA256`, no Basic auth) as without user info, so no
  configuration that works with the Node client depends on it (Litestream, Go, not tried).
  `readBucketConfig` refuses, as `endpoint`, an endpoint whose URL has a user name or password, or
  a query string or fragment (the second is `redactSecrets`'s other password position,
  `?password=`). This is the house convention already: Cloud-provided bucket addresses are refused
  for the same parts (`apps/server/src/cloud-backup.ts:142-150`).
  **What it covers.** Every WRITE of a bucket address goes through `readBucketConfig` or the Cloud
  check: archive save (`archive-settings.ts:436`), stream save (`stream-api.ts:111`), environment
  settings (`backup-config.ts:161`), a kit (`packages/stream/src/kit.ts:60`), a recovery pack
  (`archive-recovery-pack.ts:101`); a stored archive record is re-read through it
  (`archive-settings.ts:175`). A stored STREAM record is not re-read through it
  (`readStreamSettingsIn`, `stream-host.ts:66-89`), so a stream record written before this change
  could still hold one and be sent by `GET /api/backup/stream` (`stream-api.ts:194`). Before go-live
  no compatibility code is owed for records written earlier (CLAUDE.md §3, last rule). Task 1's
  writer check found one more writer that checks nothing: `waitron-credentials set`
  (`packages/credentials/src/cli.ts:131`) stores whatever JSON object it is given, for any purpose,
  with no shape check at all, and the stored stream record is not re-checked when read. Checking it
  there would change how every reader of a malformed stream record behaves, which is a design of its
  own, so it is left as it is. The claim is therefore: no bucket address saved from the dashboard,
  the environment, a kit, a recovery pack or Cloud can hold a user name, password, query or
  fragment.
  `destinationView` is left as it is.
- **D2 — the refusal's words reach both forms.** `stream.form.endpoint_invalid` now reads "Enter the
  full address, starting with https:// or http://, with no user name, password, ? or # in it"
  (English and Spanish, commit c58809701e, `apps/dashboard/src/i18n/strings.ts`). The Backups
  form already shows it for a server `endpoint` refusal (`backup-screen.ts:1584-1585`). The stream panel does not: its own check
  (`stream-settings-panel.ts:329`, `/^https?:\/\/\S+$/`) passes `https://u:p@h`, and its `#fail`
  (`:303-309`) shows "Check this value." for a server `backup.request_invalid` on `endpoint`. So the
  panel's own check refuses the same parts inline (Forms rule: inline error, action disabled until
  fixed), and a server `endpoint` refusal maps to `stream.form.endpoint_invalid`. Setup has no
  endpoint field (review grepped `apps/setup/src`).
- **D3 — a destination that fails to build leaves nothing half-started, and still reports.**
  `reload()` builds every destination's backend before it adopts the venue handle (`this.#db =
  venue`). If one throws: close the backends already built, close the venue handle, and RETHROW, as
  today. Rethrowing keeps what callers already do with a failed reload: a save answers
  `reloadErrorCode` and the screen says the box could not load the new settings
  (`backup-api.ts:314-323`, `backup-screen.ts:1317-1320`); a throw at boot (`boot.ts:2890`) still
  fails the start, unchanged. `#config` stays as `reload()` already sets it; `enabled` reads false
  because `#db` stays undefined; `status()` stays `configured: true`, so the alert source raises
  `backup.destination_overdue` (`alert-sources.ts:207-216`), which is true: nothing is being copied.
  No new log code. Building is synchronous, so there is no `await` between the `#stopped` check at
  `:284` and adopting the handle.
- **D4 — Not built: the watcher decided 2026-11-07 08:58 (questions.md).** The third entry (a
  status read builds its own client per destination) would be met by letting status reads borrow the running sweep's backends, closing a
  borrowed backend only once its last read settles and never making a teardown wait. The plan review
  read in the code how often status is read (not a measurement): the alert source caches it for 60 s (`boot.ts:2945-2949`), Box
  status reads once on opening (`boot.ts:3101`), the Backups screen on its own actions; building an
  S3 client does no network work. So the saving is at most one connection set-up per destination
  per minute, against reference counting in the supervisor, seven tests, and the branch's only
  concurrency risk. The watcher's decision: do not build it; record "a status
  read keeps its own client" under the box area's `## Decisions and deliberate limits` with these
  figures, and delete the entry.
  _2026-11-07, finish-branch: the read rates above are wrong. Each open Backups screen reads status
  every 10 seconds; the Box status page does not read it. The corrected figures are in the decision
  entry in `docs/backlog/box.md`._
  _2026-11-07, 11:36: the watcher then chose a smaller way, built on this branch: status reads keep
  their own client per destination between reads, sharing nothing with the sweep. What was built
  and measured is in that decision entry._

_As built 2026-11-07: the Backups form refuses the same parts with its own check, sharing
`isPlainWebAddress`, now in `apps/dashboard/src/screens/backup-destination-model.ts`._
_2026-11-07, finish-branch review: `isPlainWebAddress` moved to `packages/shared/src/web-address.ts`, where the server's `readBucketConfig` uses it too, and it now refuses a bare `?` or `#`._

## Tasks

Each task is test-first: write the failing test, run it and see it fail for the stated reason,
then the smallest change. Focused commands are given; the pre-push hook and CI do the rest.

### Task 1 — refuse a user name, password, query or fragment in a bucket address (D1, D2)

Files: `packages/stream/src/bucket-config.ts` and its test; the server suites named below;
`apps/dashboard/src/i18n/strings.ts`; `apps/dashboard/src/screens/stream-settings-panel.ts` and its
test.

1. Failing tests in `packages/stream/src/bucket-config.test.ts`: refused as `endpoint` —
   `https://user:secret@host`, `https://user@host`, `https://:secret@host`,
   `https://host/?password=x`, `https://host/#x`; still accepted — `https://host:9000/path` (a port
   is not a password) and `https://host`. Also `https://@host` (empty user info; `new URL` reports
   both parts empty): state in the test which way it goes and why. Run
   `pnpm --filter @waitron/stream exec vitest run src/bucket-config.test.ts`.
2. Failing server tests, in the existing suites for these routes: a dashboard archive save of
   `custom-s3` with such an endpoint is refused with `field: "endpoint"`; the stream save likewise;
   an archive record carrying one, written directly as the sealed credential (it can no longer be
   written through `writeArchiveSettings`), loads as unusable with the existing stored-settings
   code, and `GET /api/backup/status` answers with no occurrence of the password anywhere in its
   serialised body.
3. `apps/server/src/backup-api.settings-evidence.proof.test.ts:599-629` saves such a record and
   expects it readable with the password masked; it fails under D1 (plan review ran it). Change that
   case to the new truth, keeping its point (the evidence answer leaks no password): the record,
   written directly, reads as unreadable and the answer's serialised body holds no password. List
   it in the PR as a changed assertion.
4. Implement in `readBucketConfig` with `new URL(endpoint)`'s `username`, `password`, `search`
   and `hash`.
5. Dashboard: amend `stream.form.endpoint_invalid` in English and Spanish. The stream panel's
   `#validate` refuses the same parts (parse with `URL`, not a wider regex); its `#fail` maps a
   server `backup.request_invalid` on `endpoint` to `stream.form.endpoint_invalid`. Failing tests in
   the panel's suite first, for both; read the expected words from the strings file.
6. Check D1's writer list is complete: grep for every place that stores stream or archive bucket
   settings or builds a `BucketConfig` from outside input, and confirm each goes through
   `readBucketConfig` or `cloud-backup.ts`'s check. Report the list; a writer that does not is a
   STOP-and-report, not a silent fix.
7. Prove by deletion: remove the server check, see steps 1–2 fail; remove the panel check, see
   its test fail; restore.

### Task 2 — a destination that fails to build leaves nothing half-started (D3)

Files: `apps/server/src/backup-supervisor.ts`, `apps/server/src/backup-supervisor.test.ts`.

1. Failing test: with `buildBackend` throwing an `AppError` for the second of two destinations,
   `reload()` rejects with that error; afterwards `current().enabled` is false; the first
   destination's backend was closed; the venue handle `openVenue` returned was closed; no sweep tick
   ran (no upload, no `onScheduled`).
2. Failing test: the same with the FIRST destination throwing (nothing built yet).
3. Test: a later `reload()` with a buildable config starts the sweep normally (nothing latched).
4. Implement: build the backends right after the `#stopped` check that follows opening the venue,
   in a `try`, before `this.#db = venue`; on failure close what was built and the venue, rethrow.
5. Prove by deletion (put the build back after `this.#db = venue`; see 1 fail).

### Task 3 — not built (D4)

Not built: the watcher decided 2026-11-07 08:58 (questions.md). Task 4 records the decision.
_2026-11-07, 11:36: a smaller form was built instead; see D4's last note._

### Task 4 — backlog and words that describe the old behaviour

1. Delete the bundle `## Bundle A1391` in `docs/backlog/box.md`, the two detail sections it links
   (`box.md:409` and `:1327`), and A1391's two lines in `docs/backlog.md` (~116 and ~1781). No other
   doc links to the removed anchors (plan review grepped).
2. If Task 3 is not built: add under the box area's `## Decisions and deliberate limits` one short
   entry, "A backup status read builds its own storage client", with the figures in D4.
3. Grep comments and docs for sentences describing the old behaviour (an endpoint that may hold a
   password). `redact-secrets.ts`'s "WHERE IT IS APPLIED" list names the evidence answer's endpoint;
   decide whether that line is still true (records written before this change; the evidence
   answer's own masking stays) and keep or cut it accordingly. No guide text mentions the address
   field (plan review grepped `apps/server/src/guide/{en,es}`).
   _As built: the evidence answer's masking was cut too, because a stored archive record is re-read
   through `readBucketConfig` (`archive-settings.ts:175`), so the line was cut._

## Out of scope

- No change to `runBackupSweep`, to how a stored stream record is read (D1), or to boot's handling
  of a failed first reload (D3).

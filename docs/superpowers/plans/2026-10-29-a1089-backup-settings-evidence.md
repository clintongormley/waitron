# A1089 backup settings: what the box recorded — implementation plan

**Status: proposed, 2026-10-29. Not approved for building.** The owner approves the build
separately. Design: [2026-10-29-a1089-backup-settings-evidence-design.md](../specs/2026-10-29-a1089-backup-settings-evidence-design.md).

_2026-10-29: build approved by the owner's rule of 2026-10-29 ~08:07, and built on that day._

**Goal:** when the saved scheduled-backup settings cannot be used, Backups shows what the box
recorded about each failure and what the saved record looks like now, with **Read again** and
**Stop**, and changes nothing.

**Review weight:** FULL. The branch adds an authenticated route over the credentials vault
(auth and a by-id read are risk triggers). Not fiscal: nothing here touches invoices, the chain,
series or AEAT filing.

## Decisions this plan makes that the design does not

1. **One new module, `apps/server/src/backup-settings-evidence.ts`,** holds the allowlist
   (`safeLoadDetail`), the failure list type and the route's read (`readSettingsEvidence`), so the
   supervisor and the API import one place.
2. **The record's metadata comes from one query on `tenant_credentials` by purpose**, through a new
   `readCredentialMeta(tx, ref)` in `@waitron/credentials` beside `listCredentials`, answering
   `{ keyVersion, updatedAt, digest }` (the digest is `credentialRevision`'s value). The name keeps
   it apart from the existing `CredentialMeta` interface (`packages/credentials/src/store.ts:17`).
3. **The route takes no backup turn**, like `GET /api/backup/status`
   (`apps/server/src/backup-api.ts:366`), so it never queues behind or ahead of a Save. Its record
   facts (metadata and the parse) come from ONE `withTransaction`, so they describe one record.
4. **Times are ISO strings from the supervisor's existing `now` dep**
   (`apps/server/src/backup-supervisor.ts:148`, optional today; Task 1 defaults it to the wall clock where absent), so tests pin them.
5. **The dialog is a new dashboard widget, `apps/dashboard/src/widgets/backup-settings-evidence.ts`,**
   using `wt-dialog`; Backups opens it. It holds no draft, so it takes no draft scope.

## Global constraints

- Test first in every task: write the case, run it, watch it fail for the stated reason, then build.
- No existing assertion changes. Fixtures may gain what they lack (owner, 2026-09-27); name each in
  the PR.
- The route writes no credential, settings file or key file, and reloads nothing. It authorises
  exactly as `GET /api/backup/status` does (`authorize`, `apps/server/src/backup-api.ts:287`), so the
  session's last-seen time is stamped as for any action a person takes: the dashboard's own expiry
  countdown restarts on every ordinary request (`packages/dashboard-kit/src/request.ts:149`), and a
  server that did not stamp would disagree with it. Its reads drain the change log as every
  `withTransaction` does (`packages/db/src/tenancy.ts:35`); that is not a row of its own.
- Nothing secret leaves the server: no key, recovery key, access key, secret, error message or
  stack. Task 2's leak case is the guard.
- English and Spanish strings in `apps/dashboard/src/i18n/strings.ts`; general code English only.
- Golden huella (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` pass
  unedited.

## Task 1 — keep each load failure's safe facts (server)

**Files:** `apps/server/src/backup-settings-evidence.ts` (new), `apps/server/src/archive-settings.ts`,
`apps/server/src/backup-config.ts`, `apps/server/src/backup-supervisor.ts`, `apps/server/src/boot.ts`,
`packages/credentials/src/store.ts` and its index, tests beside each.

1. `readCredentialMeta(tx, { purpose })` → `{ keyVersion, updatedAt, digest } | null`. Test: null
   before a write; after two writes the digest differs and `updatedAt` moves.
2. `readArchiveSettingsWithMeta(db, ring)` in `archive-settings.ts`: ONE `withTransaction` reads
   the metadata, then the record, and answers `{ meta, settings }`, or throws the read's error with
   the metadata attached as a non-enumerable property the evidence module reads (it must not reach
   `params`, the log or any answer). `readArchiveSettings` stays as it is. Test: a key-number
   mismatch throws the same code as today, and carries the digest of the row that failed.
3. `safeLoadDetail(error)` → `{ reason }` only for `backup.archive_settings_invalid` with a reason
   in the fixed list `parseArchiveSettings` and its helpers throw (list it as a constant and test
   every member); `{ keyVersion }` only for `credentials.key_version_unknown` with an integer;
   `{ min }` only for `backup.recovery_key_too_short`; `{ variable }` only for
   `server.config_invalid` with a variable from a fixed list (today `WAITRON_BACKUP_STALE_AFTER_MS`);
   otherwise `null`. Test with a non-listed reason, a string key number and a plain `Error`
   carrying a secret: all `null`.
4. `loadBackupSettings` answers `{ loadErrorCode }` plus `loadErrorDetail` and `record` ONLY when
   each is present: the existing `toEqual({ loadErrorCode })` cases
   (`apps/server/src/backup-config.test.ts:597`, `:608`, `:619`) must pass unedited, and a `null`
   key would fail them. Add cases for the detail and the record.
5. The supervisor keeps `loadFailures` (newest first, at most five) of `{ at, code, detail,
   recordDigest, recordWrittenAt }`, and `lastCleanLoadAt`, timed by its `now` dep. The log line
   gains `detail` (never the digest). `current()` is unchanged; a new `loadHistory()` returns a
   copy. Tests with a fake `buildConfig`: six failures keep five; a clean load keeps the list and
   stamps `lastCleanLoadAt`; a `stop()` during the read records nothing (existing stop cases
   unchanged).
6. Boot's `readSealed` uses `readArchiveSettingsWithMeta` (`apps/server/src/boot.ts`, beside the
   supervisor's construction; its `readSealed` is at `:2241`).

**Checks:** `pnpm --filter @waitron/credentials exec vitest run src/store.test.ts`;
`pnpm --filter @waitron/server exec vitest run src/backup-settings-evidence.test.ts src/backup-config.test.ts src/backup-supervisor.test.ts`.

## Task 2 — the read route (server)

**Files:** `apps/server/src/backup-settings-evidence.ts`, `apps/server/src/backup-api.ts`,
`apps/server/src/backup-api.settings-evidence.test.ts` (new), `apps/server/src/errors.ts` only if a
new code is needed (none expected).

1. Pull the recovery-key lines of `statusBody` (`apps/server/src/backup-api.ts`, the box-env read,
   `readHeldKey`, fingerprint, too-short) into a helper both use, so the evidence route does not
   call `supervisor.status()` or `readStream()`. The status route's answers stay byte-identical
   (its existing cases pass unedited).
2. `readSettingsEvidence(deps)` answers:
   `{ readAt, managedByEnvironment, failures, lastCleanLoadAt, latestLoadFailed, record: null | { keyVersion,
   writtenAt, digest }, rewrittenSinceLastFailure, boxKeyNumbers: { current, previous? }, now:
   { state: "absent" } | { state: "unreadable", code, detail } | { state: "readable",
   destinations: EvidenceDestination[] }, recoveryKey: { held, tooShort, fingerprint? } }`.
   `rewrittenSinceLastFailure` compares `record.digest` with the newest failure's `recordDigest`.
   With `managedByEnvironment`, `destinations` is empty: the saved record is not in effect.
   `EvidenceDestination` is `{ kind: "folder", dir, look: "folder" | "missing" | "not_a_folder" |
   "unknown" }` or `{ kind: "bucket", endpoint, region, bucket, accessKeyId, archiveFolder }`. The
   folder `stat` runs after the transaction, under the supervisor's status-read time limit
   (`statusReadTimeoutMs`, `apps/server/src/backup-supervisor.ts:147`); a timeout or a permission
   error is `unknown`.
   _2026-10-29, as built: a password in the endpoint's URL is masked as `user:***@host` by
   `redactSecrets`._
3. Mount `GET /api/backup/settings-evidence` with the existing `authorize` (`system.manage`), and
   no backup turn.
4. Tests on a real venue database (`useVenueDb`) with real key rings, one per design row: key
   number changed, other key same number, bad retention, recovery key missing, too short, a bad
   `WAITRON_BACKUP_STALE_AFTER_MS`, clean. Each answers the row's facts; destinations appear only
   for `readable`; a record rewritten after the failure sets `rewrittenSinceLastFailure`.
5. **Changes nothing:** before and after each call, compare the `tenant_credentials` rows byte for
   byte, the backup settings and key files, the supervisor's `current()` and `loadHistory()`, and a
   folder destination's directory listing. A folder `stat` held past the time limit answers
   `unknown` and a concurrent Save still completes.
6. **The "reads correctly now" sentence:** from an enabled record with no recovery key, the bucket
   copy's key write leaves `current().enabled` false; `POST /api/backup/rotate`, an apply, and a
   fresh supervisor `reload()` (the start) each turn it on. The design's sentence names exactly
   these.
7. **Leaks nothing:** seed a bucket secret, an access key and a load failure whose error message
   holds a secret; assert none appears in the JSON answer or the captured log lines.
8. Refusals: no session → the existing refusal; a session without `system.manage` →
   `authorization.not_permitted`; no settings, key or credential write either way.

**Checks:** `pnpm --filter @waitron/server exec vitest run src/backup-api.settings-evidence.test.ts src/backup-api.route.test.ts src/backup-api.archive-pack.test.ts`;
`pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

## Task 3 — the client call and the dialog (dashboard)

**Files:** `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/widgets/backup-settings-evidence.ts`
(new) with `.test.ts` and `.a11y.test.ts`, `apps/dashboard/src/i18n/strings.ts`.

1. `getBackupSettingsEvidence()` in the client, typed from Task 2's answer.
2. The dialog reads on open and on **Read again**, each read under a new generation; a late answer
   for an old generation, or after **Stop**, is dropped. While a read runs, **Read again** shows
   it is reading; **Stop** stays available.
3. Parts as in the design: what happened (newest first, "again after the settings were rewritten
   at {recordWrittenAt}" when two failures' `recordDigest` differ), "rewritten since the last
   failure" ahead of the record's facts when `rewrittenSinceLastFailure`, the saved record now, the
   recovery key, and one sentence on the form's **Turn on backups**. The "reads correctly now"
   sentence shows only for `readable` with a usable key and not `managedByEnvironment`.
   _2026-10-29, as built: the sentence also needs `latestLoadFailed` and a newest failure other
   than `server.config_invalid`; with no saved record, the **Turn on backups** sentence says it
   saves new settings (`backup_evidence.turn_on_new`)._
4. `authorization.not_permitted` shows its reason, **Sign in as an administrator** (dispatches
   `admin-sign-in`, `bubbles`/`composed`, as `apps/dashboard/src/screens/staff-screen.ts:169` does)
   and **Stop**, and shows no facts. An expired, missing or suspended session is left to the
   dashboard's existing return to sign-in (`apps/dashboard/src/dashboard-app.ts:1014`). Any other
   failure (server error, lost connection) says the facts could not be read and keeps **Read
   again** and **Stop**.
5. The read is an ordinary request, not `passive`: a person opened the panel.
6. Tests: each cause's words in EN and ES (read from the strings file, not spelled in the test);
   a late answer after Stop does not redraw; Read again replaces the facts; the sign-in event
   fires; a failed read keeps both buttons. Axe in both themes for loaded, reading, refused,
   failed and `readable` states. These browser cases also save the LOOK screenshots (Task 5): each
   design row, reading, refused, failed and Stop, EN and ES, light and dark, 1280 and 390 wide,
   written outside the repository.

**Checks:** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/backup-settings-evidence`.

## Task 4 — open it from Backups, point the alert at it

**Files:** `apps/dashboard/src/screens/backup-screen.ts` and its test,
`apps/dashboard/src/dashboard-app.ts` (route the event), `apps/dashboard/src/i18n/alert-messages.ts`.

1. Beside the `load-failed` line, a **What the box recorded** button opens the dialog. Not shown
   when there is no load failure.
2. `dashboard-app.ts` handles `admin-sign-in` from Backups the way it does for Staff and Orders.
   First check what Backups shows a signed-in person without `system.manage` today, and record it
   in the PR; change nothing there unless it sends the person to somebody else.
3. The alert's words for `backup.archive_settings_unusable` (EN and ES) name the button, and keep
   what `apps/dashboard/src/screens/backup-screen.test.ts:2131` pins: the apply button's own text,
   "leave without applying", and no "contact support". That test passes unedited.

**Checks:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/backup-screen.test.ts src/dashboard-app.test.ts`;
`pnpm exec vitest run scripts/alert-codes.test.ts`.

## Task 5 — the guide, the look, the backlog (split if it nears ~100 tool calls: guide and backlog, then the look)

1. `apps/server/src/guide/en/backup-recovery.md` and its Spanish twin: replace "This page cannot
   diagnose every persistent host or key failure" with what the panel shows and what it does not
   do; same heading ids. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`
   and `pnpm exec vitest run scripts/guide-links.test.ts`.
2. LOOK: open the screenshots Task 3's browser cases saved and check each by eye; then one look on
   the dev stack (`wa-wt demo <worktree>`) at Backups with the button, after making the record
   unreadable the way Task 2's tests do. Screenshots in the PR.
3. `docs/backlog.md` and `docs/backlog/self-service-refusals.md` § backup-settings: the diagnosis
   half is done; a short entry keeps repair open (key numbers, restoring an old credentials key,
   rewriting the record), and one names failures from before a restart if decision 1 stands.

## Review focus

- The route writes nothing and leaks nothing (Task 2 steps 4 and 5): try to break both.
- A destination is shown only from a record that reads now; nothing else stands in for it.
- The "reads correctly now … until saved again, the recovery key is replaced, or the box restarts"
  sentence: Task 2 step 6 runs each; try another path that reloads the supervisor.
- The failure's record digest and the record's facts each come from one transaction.
- Late answers after Stop or a second Read again.

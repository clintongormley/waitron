# A1089: show what the box recorded when its saved backup settings cannot be used

_2026-10-29: build approved by the owner's rule of 2026-10-29 ~08:07, and built on that day._

**Proposed, 2026-10-29. Not approved for building.** The owner's rule of 2026-10-29 ~01:58 makes
evidence first the default for A1089 areas of this shape: a read-only inspection of what the box
recorded, current facts only where they verifiably describe the same thing, sign-in at the action,
**Read again** and **Stop**, nothing changed. This design applies that rule to the Backups area.
Persistent repair stays OPEN and comes back to the owner as its own decision. The plan is
[2026-10-29-a1089-backup-settings-evidence.md](../plans/2026-10-29-a1089-backup-settings-evidence.md).

## The problem in plain words

The box keeps its scheduled-backup settings (which folder or bucket, the schedule, how many to
keep) in one locked record in the venue database. It locks the record with the box's own
credentials key, and every backup it makes is encrypted with a separate recovery key held in the
box's backup settings file. When the box starts, or after a Save, it reads the record back. If that
read fails, scheduled backups stay off and the alerts bell says so. A later Save, a recovery-key
replacement (rotate) or a restart reads it again. Backups shows one line, "Backups
are off because the saved settings can't be used", followed by the error's message.

The backlog entry (A1089, `docs/backlog/self-service-refusals.md` § backup-settings) asks what to do
when that keeps happening after the settings are chosen again. Today nobody can tell from the
screen **why** the record could not be used, **when** it started, or whether a new Save changed
anything, because the box does not keep those facts.

## What the box keeps today

Source references describe `cf5da16e2`.

| Point | What happens, with its receipt |
| --- | --- |
| The read | Only the supervisor sets the load-failure code (`apps/server/src/backup-supervisor.ts:210`); rotate's key-only path also returns the record's read code in its own reply (`apps/server/src/backup-api.ts:580`). `readArchiveSettings` decrypts the record and checks every field; it throws `backup.archive_settings_invalid` with a `reason` naming the part that failed (`apps/server/src/archive-settings.ts`, `settingsInvalid` and `parseArchiveSettings`). The credentials store throws `credentials.key_version_unknown` with the record's `keyVersion` when the box holds no key of that number, and `credentials.decrypt_failed` when the key of that number does not open it (`packages/credentials/src/store.ts:57`, `:71`). |
| What is kept | `loadBackupSettings` turns any failure into `{ loadErrorCode: codeOf(error) }`, the code alone (`apps/server/src/backup-config.ts:368`). The supervisor keeps that one code in memory and logs it with no other detail (`apps/server/src/backup-supervisor.ts:207`, `:210`). |
| When | Nothing records a time. The alert is raised with `since: null` (`apps/server/src/alert-sources.ts:178`). |
| The screen | Backups shows the code's message beside the status (`apps/dashboard/src/screens/backup-screen.ts:1443`). |
| Readable without decrypting | The record's key number and last-written time (`listCredentials`, `packages/credentials/src/store.ts`), and a short digest of the stored bytes that changes on every write (`credentialRevision`, same file). Both are exported from `@waitron/credentials`. |
| Why the decrypt failure is one code | Wrong key, altered bytes and a record moved between purposes answer the same code on purpose, so the answer cannot be used to tell them apart (`packages/credentials/src/store.ts:69`). The design keeps that: it never claims which of the three happened. |

**Experiment run 2026-10-29** in the registered documentation worktree. A throwaway Vitest file
(kept outside the repository at `~/waitron-campaign-b/a1089bs-probe/`, deleted from the tree after
the run) stored one record under key 7/number 1, then read it five ways:

```sh
env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/a1089bs-probe.test.ts
# 1 test passed
```

| Case | The thrown error | What `loadBackupSettings` kept |
| --- | --- | --- |
| Control: same key, recovery key held | none | the settings, destinations readable |
| The box's key number changed to 2 | `credentials.key_version_unknown`, `keyVersion: 1` | `credentials.key_version_unknown` only |
| A different key under the same number 1 | `credentials.decrypt_failed` | `credentials.decrypt_failed` only |
| Record readable, recovery key missing | none (the record reads) | `backup.recovery_key_missing` only |
| Record readable, recovery key too short | none | `backup.recovery_key_too_short` only |
| Record stored with a retention count of 0 | `backup.archive_settings_invalid`, `reason: "retention"` | `backup.archive_settings_invalid` only |

A second experiment, run the same day by the design's reviewer from a copy of
`apps/server/src/backup-api.route.test.ts` (`pnpm --filter @waitron/server exec vitest run
src/a1089rev-probe.test.ts -t PROBE`, 2 passed, file removed after): an enabled record with no
recovery key loads as `backup.recovery_key_missing` with backups off; writing a key file the way the
bucket copy's Save does leaves backups off (the control); `POST /api/backup/rotate` then answers
with backups on and no load code.

In every failing case the key number, the reason and the time were available where the error was
thrown and are gone by the time anything reaches the screen. In the two recovery-key cases the
record itself still reads, so the box knows exactly which folder or bucket it names. The record's
key number and written time were readable in every case.

Read, not run: a malformed `WAITRON_BACKUP_STALE_AFTER_MS` makes `resolveBackupConfig` throw
`server.config_invalid` with a `variable` even though the record reads (`apps/server/src/config.ts:307`,
reached from `apps/server/src/backup-config.ts:323`). Any other failure arrives as whatever
`codeOf` gives it (`packages/server-kit/src/error-code.ts`).

The probes do not cover: an unreadable credential payload (`credentials.malformed_payload`), a
record missing its field (`server.credential_unusable`), a failure of the database read itself, a
real host's key files, or any browser behaviour.

## Proposed experience

Beside the existing "Backups are off because the saved settings can't be used" line, Backups shows
**What the box recorded / Lo que ha registrado el equipo**. It opens a panel. Opening it reads; it
writes nothing, reloads nothing and starts nothing.

The panel has three parts:

1. **What happened.** Each failed read since the box last started, newest first, at most five:
   the time, the plain-language cause, and whether the saved record was rewritten between two
   failures ("This happened again after the settings were rewritten at 14:02"). A Save and a
   recovery-key replacement both rewrite the record (`apps/server/src/backup-api.ts:586`).
2. **The saved record now.** Read fresh when the panel opens and on **Read again**:
   - Always: whether a record exists, when it was last written, and which key number locked it,
     beside the key numbers this box holds now. When the record has been rewritten since the
     newest failure, the panel says so first: the facts below then describe the new record, not
     the one that failed.
   - Only when the record reads cleanly now: the folder path and/or the bucket's address (a
     password in its URL masked as `user:***@host`, by `redactSecrets`), region,
     bucket name, access key id and archive folder (the status reply already shows the access key
     id, `apps/server/src/backup-supervisor.ts:66`, and the form needs it to keep a saved secret).
     For a folder, whether it exists and is a folder, or "could not be checked" when the look
     fails or takes too long (a look, never a write). Never the bucket's secret, and never a
     network call to the bucket.
   - When the record does not read: "Waitron cannot tell which folder or bucket these settings
     named." No other destination's facts are shown in its place: the bucket copy's settings are
     not the archive's.
   - The recovery key: held or not, too short or not, and its 8-character fingerprint when usable
     (the fingerprint Backups already shows).
3. **What each choice does.**
   - **Read again / Leer de nuevo** reads the record and the key facts again and redraws parts 1
     and 2. It changes nothing; it does not turn backups on, even if the record now reads.
   - **Stop / Parar** closes the panel. Nothing is sent.
   - The existing form below stays as it is: choosing the destinations again and **Turn on
     backups** replaces the saved record. The panel says so in one sentence; it does not offer
     that button itself. With no saved record, the sentence says **Turn on backups** saves new
     settings.

### What each cause says

| Code | Plain explanation (EN) | What the panel adds |
| --- | --- | --- |
| `credentials.key_version_unknown` | The saved settings were locked with key number {n}. This box holds key number {m}{ and {p}}, so it cannot open them. | Both numbers. |
| `credentials.decrypt_failed` | The saved settings carry this box's key number {n}, but this box's key of that number does not open them. Either that key was replaced, or the saved record was changed or came from another box; Waitron cannot tell which. | Key number, written time. The key number only while the failed record is still the saved one; otherwise the sentence names no number. |
| `credentials.malformed_payload`, `server.credential_unusable` | The saved record opened but its contents are not backup settings. | Written time. |
| `backup.archive_settings_invalid` | The saved settings opened, but their {part} could not be used. | The part, from a fixed list (schedule, retention, destinations…). |
| `backup.recovery_key_missing` | The saved settings read correctly, but this box holds no backup recovery key, and backups are never made without one. | The destinations. |
| `backup.recovery_key_too_short` | The saved settings read correctly, but the backup recovery key on this box is shorter than {min} characters. | The destinations. |
| `server.config_invalid` | The saved settings read correctly, but this box's own setting {variable} is not a whole number above zero. | The destinations. |
| `unknown`, or anything else | The box could not use its backup settings ({code}). Waitron cannot say more about this failure. | Written time if readable. |

Spanish wording is written with the build, in the same shape. Words follow the refusal rule: they
explain what happened and what each choice does, and never send the person to somebody else.

When **Read again** finds a record that reads and a usable key, backups are not set by the box's
environment, and the latest load the supervisor recorded failed, the panel says: "The saved settings
read correctly now. Backups stay off until the settings are saved again, the recovery key is
replaced, or the box restarts. Nothing was changed." The build proves each of the three, and that
the bucket copy's key write alone leaves backups off. The sentence is not shown when the newest
failure is `server.config_invalid`: that variable is read from the box's environment on every load,
so none of the three turns backups on while that variable stays as it is.

If the read itself fails (a server error or a lost connection), the panel says it could not read
the facts and keeps **Read again** and **Stop**. If backups are set by the box's environment
rather than by saved settings, the panel says so and shows no saved destinations: none of them is
in effect.

## Sign-in at the action

Every Backups request already needs the `system.manage` permission
(`apps/server/src/backup-api.ts:287`), so only someone who can manage the box reaches the panel.
If that permission has been taken away when the panel reads (`authorization.not_permitted`), the
panel shows why and offers **Sign in as an administrator / Iniciar sesión como administrador**,
which raises the same `admin-sign-in` event the Staff screen uses for the same refusal
(`apps/dashboard/src/screens/staff-screen.ts:169`), and **Stop**. Nothing is shown after sign-in
until the person opens the panel again. An expired, missing or suspended session never reaches the
panel: the dashboard already returns to its sign-in screen for those
(`apps/dashboard/src/dashboard-app.ts:1014`).

## Server contract

- **Kept facts.** The supervisor keeps up to five load failures in memory, each `{ at, code,
  detail, recordDigest, recordWrittenAt }`. `detail` holds only allowlisted values: the `reason`
  from the fixed list `parseArchiveSettings` throws, the integer `keyVersion`, the integer minimum
  length, or the `variable` name from a fixed list. Any other parameter, message or stack is
  dropped. `recordDigest` (`credentialRevision`'s value) and `recordWrittenAt` are read in the SAME
  transaction as the failing read, so they describe the record that failed, or are `null` when there
  was none. A clean load does not clear the list; it adds the time of the last clean load.
  `latestLoadFailed` says whether the latest load the supervisor recorded failed, by the order
  of the loads: the box clock can move backwards, so the times are never compared to decide it.
- **The log line** `backup.archive_settings_unusable` gains the same `detail`.
- **New read route** `GET /api/backup/settings-evidence`, `system.manage`, authorised exactly as
  `GET /api/backup/status` is (the session's last-seen time is stamped, as for any action a person
  takes). It answers the kept failures, the record's metadata now, the box's key numbers (never the
  keys), the recovery-key facts the status already answers, and the destinations only when the
  record reads now. It reloads no supervisor, starts no backup, writes no settings or key file and
  sends no network request. Its reads go through `withTransaction`, which takes the write lock and
  drains the change log for live updates as every such read does
  (`packages/db/src/tenancy.ts:35`); the route adds no row of its own.
- **What it never carries:** keys, the recovery key, the bucket's secret, decrypted contents of
  a record that did not parse, error messages or stacks, personal data.

## Decisions this design makes, with the default it builds

1. **Failures are kept in memory, five at most, and are lost at restart.** Each start reads the
   record again, so a lasting failure is recorded again at once. Alternative: a small file in the
   state folder, which would show failures from before a restart but adds a write on every failed
   load and must give way on a full disk.
2. **Read again only reads.** It never reloads the supervisor, so it cannot turn backups on.
   It does not wait behind a Save either: like the status read, it takes no backup turn, and the
   record's facts come from one transaction.
3. **No network check of a bucket.** The form's existing **Test** checks a bucket being chosen; the
   panel does not probe a saved one.
4. **A folder is looked at, never written,** outside any backup turn and under the status read's
   time limit, so a stuck mount cannot hold up a Save. "Exists and is a folder" is the most the
   panel says; whether the box can write there is learnt only from a backup.
5. **The panel is a dialog on Backups,** reached from the load-failure line, and the alert's words
   point to it while keeping the words its existing test pins ("Turn on backups", "leave without
   applying", no "contact support"; `apps/dashboard/src/screens/backup-screen.test.ts:2131`).
6. **The access key id is shown; the secret never is.** The status reply already shows the id, and
   the form matches a saved secret by it.

## Out of scope, still OPEN for the owner

- Any repair: changing key numbers, restoring an old credentials key, rewriting or deleting the
  saved record, replacing the recovery key, deleting backups.
- The bucket copy's own settings failures (`backup.stream_settings_unusable`), which have their own
  A1089 entry.
- Failures from before the box last started (decision 1).

A1089's backup-settings entry stays open for the repair half; the build replaces its "diagnosis"
half with a short entry naming what is still missing.

## Acceptance checks for the build

1. Real venue database, real key rings: each code in the table produces its panel facts, and the
   control (a clean record) produces none. Each check is run with the old code first and fails.
2. Before and after the route answers: the credentials table's bytes, the supervisor's state, the
   backup settings and key files, and the backup files on disk are unchanged.
3. The answer and the log line, seeded with a secret-bearing error message and a bucket secret,
   contain neither.
4. A failure after a Save shows "again after the settings were rewritten at …"; one without a
   write between does not. A record rewritten after the newest failure is announced before its
   facts.
5. Browser: open, Read again with a changed answer, Stop with a read in flight (no late redraw),
   permission taken away (sign-in offered, nothing shown), a failed read, EN and ES, both themes,
   1280 and 390 wide, axe in both themes.
6. The guide paragraph on unreadable backup settings in `apps/server/src/guide/{en,es}/backup-recovery.md`
   describes the panel, with working links.

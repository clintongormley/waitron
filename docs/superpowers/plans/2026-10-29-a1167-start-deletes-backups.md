# A1167 start slice: the start deletes old backups by itself before it releases the spare

Design: [2026-10-28-a1167-backups-make-room-design.md](../specs/2026-10-28-a1167-backups-make-room-design.md)
§1 and §6's last bullet, and the owner's Q4 A (2026-10-28 ~14:10): in place of the full-disk page's
no-sign-in button, the start deletes old backups under §1's rules before it releases the spare file,
"only if the installation's start can be read without opening the venue database".

Measurement (2026-10-29, `~/waitron-campaign/a1167-start-measure/REPORT.md`, probes beside it, macOS
HFS+ small disk only): the store's open failed at the venue lock (code 14) at 0 B and 4 KiB free; a
read-only open of a cleanly stopped database failed at 0 B and 4 KiB and worked at 64 KiB. So the
start cannot open the database on a full disk. Only `activate()`
(`packages/fiscal-verifactu/src/allocation.ts:432-442`) writes a new live installation; setup,
restore and promotion reach it. A restore places a NEW file (`restoreDatabase`,
`apps/server/src/restore.ts`: the new file is made while the old one still exists, so its inode
differs); promotion writes into the same file but runs on a standby, where backups do not run.

Plan review (fresh context, 2026-10-29): 0 Critical, 9 Important, 10 Minor, all folded below; a
round-3 claim check of the folds found three partly wrong claims, corrected here.

**Fiscal boundary (H2).** Nothing here changes `registerSif`, `restoreFiscal`, `activate`, the chain,
invoice numbering, `registros_facturacion` or the alta builders; no task edits a file under
`packages/fiscal-verifactu`. The installation start is read through the existing seat member
`installationStartedAt`, as slice 1's backup run reads it. Task 3a's edits in `restore.ts` sit above
`runRestoreHooks` and do not touch it. The golden huella test and the `inmutabilidad` suite must pass
unedited.

**Lane B's slice 2 has landed** (#2221, `9a71a3030`): `makeRoom` takes `dir`, `reason:
"backup_room" | "space_low"` and `outOfReach: "floor" | "aim"`, and `apps/server/src/low-space-backups.ts`
is its watch-side caller. This branch is rebased on it.

## The design this plan builds

1. **The note.** `<state>/backup-room-note.json` (name `BACKUP_ROOM_NOTE_FILE`, exported from
   `@waitron/provisioning` beside `SPARE_SPACE_FILE`), JSON:
   `{ version: 1, nodeId, installationStartedAt (ISO), venueDb: { dev, ino, birthtimeNs } (from
   lstat of <venue>/venue.db with `bigint: true`, stored as strings), managedByEnvironment, folders:
   [{ destination, dir }] (the real paths `foldersOnDisk(backends, venueDir)` answers), writtenAt
   (ISO) }`. No secret goes in it: folder paths are already shown in plain text on the status read
   (`backup-supervisor.ts:44,58`); bucket destinations are never listed.
2. **Written by the running server**, `BackupSupervisor.reload`. The FIRST step of every `reload()`,
   before the teardown, deletes the note; the note is written again only on the success path (gate
   passed: enabled, recovery key, primary; venue opened; backends built; not stopped), from
   `readInstallationStart()` and a fresh lstat of `venue.db`. Written to a temporary name in the state
   folder, then renamed. When the installation start reads null or throws, or the write fails, no note
   is left (fail closed). So a reload that throws, is stopped part-way, or leaves backups off, leaves
   no note; a settings write whose reload throws (`backup-api.ts` `reloadAfterWrite`) leaves none too.
3. **Deleted before any path replaces or removes the live `venue.db`.**
   - `wipeVenueDatabases` (`apps/server/src/db-wipe.ts`) and `restoreDatabase`
     (`apps/server/src/restore.ts`) take a required `stateDir` and delete the note FIRST, before any
     file moves; a failure other than `ENOENT` throws.
   - `placeValidated` (`restore.ts:292`) deletes it at its top, BEFORE `setAsideExistingIdentity`
     (`:302`), so a deletion failure refuses the restore with the identity files where they were.
   - `placeBackupDatabase` (`backup-data-placement.ts`) gets `stateDir` on `PlacementInput`; the
     backup verification (`backup-verification.ts`, scratch `join(scratch, "state")`) passes its
     SCRATCH state folder, never the live one.
   - Start again: `deleteMarkedAttempt` (`packages/provisioning/src/first-setup-start-again-deletion.ts:522`),
     inside its body, so both callers are covered (`first-setup-resolution.ts:713`, and
     `finishStartAgainDeletion` at `deletion.ts:625`, which the start's resume `first-setup-entry.ts:211`
     and the repair page `first-setup-start-again-choose.ts:156` reach); `moveStartAgainUnits`
     (`first-setup-start-again-set-aside.ts:351`, from `choose.ts:155`); and `resumeStartAgainSetAside`
     (`set-aside.ts:432`, from `first-setup-entry.ts:178`, which moves pieces without calling
     `moveStartAgainUnits`). Each deletes it first. Defence in depth: Start again already
     refuses while `trading.env` exists (`first-setup-start-again-deletion.ts:35-37`), and the note's
     node id comes from `trading.env`.
   - Promotion: boot's `promoteMirrorRun` (`boot.ts:~2733`) deletes it before promoting AND again
     right before the restart signal (`boot.ts:2754-2757`), because a backup reload after a settings
     write (`backup-api.ts:314-316`) that runs once a role-holder refresh (`promote.ts:90/119/176/232`)
     has made the role primary could write a note with the old installation start.
   - `waitron.sh reset` keeps only `tls` and the Start-again files (`deploy/waitron.sh:744-747`), so
     it deletes the note; it also removes the `backups` volume (`:735-737`).
   - Why every path, not only the identity check: a wipe then re-create (rejoin, staged reset, Start
     again delete) frees the old file's inode number, which ext4 may reuse for the new file (not
     measured).
4. **Kept out of** backup archives (`archive-entries.ts` collects fixed lists), the sealed state row,
   `secrets/`, and the first-setup recovery's originals digest walk
   (`packages/provisioning/src/first-setup-backup-workspace.ts:300-330`, where the spare is left out
   at `:316`).
5. **The start step** (`apps/server/src/start-backup-room.ts`), called in `runEntry`
   (`apps/server/src/node-entry.ts`) after `freeSpaceAtStart` and before `releaseSpareToStart`, only
   when `backupEntry.kind` is neither `repair` nor `selected` and the lowest free space of the state
   and venue folders is under `FULL_DISK_BYTES` (the only region where `releaseSpareToStart` can
   release). (2026-10-29, review: the step reads the venue folder's free space alone, because `makeRoom`
   frees only that disk; a full state folder on another disk deleted backups to no effect.) `runEntry` has not loaded the box env at that point, so the step loads it itself:
   `merged = await deps.loadBoxEnv(deps.baseEnv, deps.stateDir)` (`EntryDeps.loadBoxEnv` is required,
   `node-entry.ts:102`), loaded after step 1, so a start with no note never reads the env files. Order:
   1. If no note file exists, return (cheap first check, so a box without a note never takes the
      lock and existing call-count tests stay as they are).
   2. Take the venue lock, or apply `freeSpaceAtStart`'s rule (`start-space.ts:105-126`): refused as
      in use → skip; any other failure → skip if the holder file is fresh, otherwise go on without the
      lock. Everything below runs while holding it; release after `makeRoom`.
   3. Delete nothing unless ALL hold, each refusal logged once `backup.start_room_skipped` with a
      `reason`:
      - the note parses, its version is 1, and its `nodeId` equals `merged.WAITRON_TILL_NODE_ID`;
      - `lstat(<venue>/venue.db)`'s dev, ino and birthtimeNs equal the note's;
      - no staged restore or reset request is waiting (read the real file names from
        `restore-request.ts`/`reset-request.ts`): it will replace `venue.db`, which makes the current
        installation's archives into ones from before the next installation;
      - `loadRecoveryKey(merged)` answers a key (a throw → skip): backups still run (design §1);
      - who manages backups is judged on the RAW env, `isBackupManagedByEnvironment(deps.baseEnv)`
        (`backup-config.ts:120`; boot imports it as `backupKeysInEnv`, `boot.ts:319`, and calls it on
        the raw `base` at `:2232`), never on `merged` (a dashboard box keeps its
        recovery key in `backup.env`, which `merged` includes). Env-managed now: the folders are the
        env's local destinations, `archiveDestinations({ managedByEnvironment: true, env: merged,
        sealed: null, venueId: merged.WAITRON_TILL_LOCATION_ID })` keeping `local-fs` only (a parse
        error → skip), and the note must say `managedByEnvironment: true`. Not env-managed: the
        note's folders, and the note must say `false`. A mismatch → skip.
      - every candidate folder is passed through `foldersOnDisk(…, venueDir)` at start (map each to
        `{ id, localDir: dir }`), so a folder on another disk is never used.
   4. `makeRoom({ neededBytes: 0, floorBytes: spareBytes + FULL_DISK_BYTES (24 MiB by default, the
      line `topUpSpare` writes the spare back at), aimBytes: the entry's floor
      (`deps.freeSpaceFloor ?? START_FREE_SPACE_FLOOR`, 256 MiB), dir: venueDir, reason:
      "start_room", outOfReach: "floor", installationStartedAt: the note's, signal: a never-aborted
      signal, onDeleted: writes the start-deleted record })`, modelled on `low-space-backups.ts`. A
      `backup.staging_space_low` refusal comes either before any deletion, when free space plus every
      deletable backup falls short of the floor (`backup-room.ts:233-234`; log
      `backup.start_room_skipped` reason `out_of_reach`), or after the deletion loop, when the fresh
      reading is still under the floor (`:268-269`; log `backup.start_room_short` with the free bytes,
      not `out_of_reach`, whether or not a deletion succeeded — `onDeleted` wrote the start-deleted
      record only if one did). The error's `afterDeleting` param tells the two apart. Both fall through.
   `releaseSpareToStart` then runs unchanged and re-reads free space, so a step that made room
   releases nothing.
6. **The alert.** When the step deleted anything, `onDeleted` writes
   `<state>/backup-room-start-deleted.json` (`BACKUP_ROOM_START_DELETED_FILE`) holding each deleted
   archive's `destination`, `dir`, `key`, `bytes`, `takenAt` (so it reads back as
   `DeletableArchive[]`) and the time; a write failure is logged and the deletions stand. Boot, once
   `createBackupRoomHooks` exists (`boot.ts:2234`, before `backupSupervisor.reload()` at `:2265`,
   and before the listener starts), reads it, calls `recordArchivesDeleted` (slice 1's words as #2220
   set them, `apps/dashboard/src/i18n/alert-messages.ts:91-104`, `box-alert-email.ts:71`; they fit a
   deletion made at start, no new words), and deletes the file after a successful record; a malformed
   file is logged and deleted.

**Deliberate limits** (go in conventions-data.md): the step deletes without the venue lock on a disk
too full to take it, as the staging clean-up does; a future path that writes a new installation into
the same `venue.db` on a primary would escape the identity check (the guard reads text); a peer's
fence that demotes the box at boot (`boot.ts`, `fenced && axes.singletonRole === "primary"`) is not
visible to the step; a `selected` box (a first-setup recovery from backup) never gets the start's
deletion; `venue.db`'s device number and birth time are not measured on Linux or in Docker (a
mismatch skips, which is safe; Task 1's in-place-write control, run on CI's Linux, is the only
receipt); a `waitron-restore` run reading a folder archive while the app restarts; a backup stamped by
a clock that ran ahead and a folder shared by two boxes are the design's own limits; a restore that
crashes between placing the file and writing its new installation leaves the restored file holding the
old installation, which slice 1's backup run reads the same way.

## Tasks

Each task: failing test first, watch it fail for the stated reason, then the code. Focused runs:
`pnpm --filter @waitron/server exec vitest run <file>` (or the package named). Every commit `-s`.
Run `pnpm format:check` before each commit. **Campaign rule:** a test that must be EDITED to pass is
a STOP, except adding what a call lacks: when `stateDir` becomes required, existing calls gain the
argument and no assertion changes (Task 3a lists them); name each in the commit message. Implementers:
if you pass about 150 tool calls with the task unfinished, stop at a passing or cleanly red point,
commit, and hand over (done, left, files, each check's state).

### Task 1. The note: write, read-and-check, delete

Files: new `apps/server/src/backup-room-note.ts` + `.test.ts`; `packages/provisioning/src/spare-space-name.ts`
(or a sibling name file) + `index.ts` export of `BACKUP_ROOM_NOTE_FILE` and
`BACKUP_ROOM_START_DELETED_FILE`.

- `writeBackupRoomNote({ stateDir, venueDir, nodeId, installationStartedAt, managedByEnvironment,
  folders, now, log })`: lstat `venue.db` (missing → delete the note, write nothing), temp file +
  rename; on any failure delete the note and log `backup.room_note_write_failed` with errno. Never
  throws.
- `deleteBackupRoomNote(stateDir)`: plain `unlink`; `ENOENT` is success; anything else throws.
- `readBackupRoomNote({ stateDir, venueDir, nodeId })`: answers `{ note }` or `{ skipped: reason }`
  for: missing, unreadable, malformed / wrong version, node mismatch, venue.db missing, identity
  mismatch.
- Red tests (real files in a temp dir): a note is refused after `venue.db` is replaced by rename-over
  (the restore's shape) and after delete-then-create; accepted after in-place writes to `venue.db`
  (control); refused for another node id; a failed write (inject the rename) leaves no note even when
  an older note was there.

### Task 2. The supervisor keeps the note in step

Files: `apps/server/src/backup-supervisor.ts` + `backup-supervisor.test.ts`; `boot.ts` passes `nodeId`
(`managedByEnvironment` is known through `isManagedByEnvironment`).

- First step of `reload()`: delete the note (a failure is logged, not thrown out of reload). On the
  success path only: `writeBackupRoomNote` with `readInstallationStart()`'s answer (null or throw → no
  note) and `foldersOnDisk(this.#backends, venueDir)`'s folders.
- Red tests: a primary reload writes a note naming only the local folders on the venue's disk (a
  bucket destination is not named); a reload as a standby deletes an existing note; backups switched
  off deletes it; an installation start that throws leaves none; a reload whose `buildConfig` throws
  leaves none; a `stop()` during `buildConfig` leaves none.

### Task 3a. Server paths that replace or remove venue.db delete the note first

Files: `apps/server/src/db-wipe.ts`, `apps/server/src/restore.ts` (`restoreDatabase`,
`placeValidated`), `apps/server/src/backup-data-placement.ts` (`PlacementInput.stateDir`),
`backup-verification.ts` (passes its scratch state folder), every caller (TypeScript finds them once
`stateDir` is required), boot's `promoteMirrorRun`; their tests.

- Existing calls that gain the argument (call-site additions, no assertion change):
  `restore-file-placement.test.ts`, `first-setup-set-aside-lifetime.test.ts`,
  `printer-delete-history.test.ts`, `restore-fiscal-receipt.test.ts`,
  `business-day-persistence.test.ts`, `db-wipe.test.ts`, `restore.test.ts`'s shared helper — check
  with `git grep` for any others. The note is deleted with plain `unlink`, never through
  `restoreDatabase`'s injected `fs`, so its failure-injection tests are unchanged.
- Red tests: `wipeVenueDatabases` and `restoreDatabase` leave no note; a note-deletion failure (a
  folder at the note's path) stops each before `venue.db` is touched; `placeValidated` refused that
  way leaves the identity files where they were; the backup verification never deletes the live note;
  promotion deletes the note before it promotes and before the restart signal.

### Task 3b. Start again deletes the note first, and a guard keeps the list closed

Files: `packages/provisioning/src/first-setup-start-again-deletion.ts` (`deleteMarkedAttempt`),
`packages/provisioning/src/first-setup-start-again-set-aside.ts` (`moveStartAgainUnits`,
`resumeStartAgainSetAside`), their tests; new root guard `scripts/backup-room-note.test.ts`.

- Red tests (small): each leaves no note, a resumed Move included.
- Guard, two literal lists: (a) files that replace or remove the live `venue.db` — `db-wipe.ts`,
  `restore.ts`, `first-setup-start-again-deletion.ts`, `first-setup-start-again-set-aside.ts` — each must name
  `deleteBackupRoomNote` or `BACKUP_ROOM_NOTE_FILE`; (b) files that only co-name `venue.db`/`VENUE_FILE`
  with `rm`/`rename`/`unlink` (staging copies, scratch, pointer files: `backup-archive-file.ts`,
  `backup-verification.ts`, `first-setup-backup-source.ts`, `first-setup-database-holdings.ts`,
  `cloud-snapshot-archive.ts`, `recovery-preparation.ts`, `restore-stream.ts`, `restore-request.ts`,
  `packages/stream/src/restore.ts`, `packages/stream/src/supervisor.ts`,
  `first-setup-backup-workspace.ts` — find the real set by grep), each with a one-line reason. A file
  that matches the pattern and is on neither list fails. Prove it by deletion (remove one deletion
  call; the guard fails; and add an unlisted matching file; it fails). The header says it reads text
  and does not see a whole-folder `rm`, the `fs.`/`io.` aliases, `removeAndSync`, or shell.

### Task 4. The note stays out of archives, the sealed state and the recovery's originals digest

Files: archive-entries tests, the sealed-state refresher's tests,
`packages/provisioning/src/first-setup-backup-workspace.ts` (leave both new names out where the spare
is, `:316`) and its test.

- Red tests: an archive built with a note and a start-deleted record present holds neither; writing
  or deleting either file does not change the first-setup recovery's originals digest (fails before
  the change if the walk counts them; if it already ignores them, the test is a pin — say so).

### Task 5a. The start step, alone

Files: new `apps/server/src/start-backup-room.ts` + `.test.ts`; `apps/server/src/backup-room.ts`
(`reason` gains `"start_room"`). No change to `node-entry.ts`.

- Unit red tests (real temp folders, injected `statfs`, injected `loadBoxEnv`): with a valid note, two
  old archives and the newest in a folder, under 16 MiB free → deletes the oldest only (until the
  floor), logs `backup.archive_deleted` reason `start_room`, writes the start-deleted record; each
  skip condition in "The design" §5 deletes nothing and logs its reason; no note file → returns
  without taking the lock; an archive taken before the note's installation start is never deleted;
  the newest never; a bucket is never touched; free space at or above `FULL_DISK_BYTES` → nothing;
  every deletable archive short of the floor → nothing deleted, reason `out_of_reach`; a
  dashboard-managed note with the recovery key only in `backup.env` deletes (the raw-env rule).

### Task 5b. Wire the step into the start

Files: `apps/server/src/node-entry.ts`; `node-entry.full-disk-order.test.ts` (mirror its existing
`watch.seen` mock of `first-setup-entry.js`).

- Red order cases: the step runs after `freeSpaceAtStart` and before the spare release; not at all
  for `repair`/`selected` entries.
- Run unedited: `node-entry.full-disk.test.ts`, `node-entry.test.ts`, `start-from-spare.e2e.test.ts`,
  `start-full-disk.e2e.test.ts`.

### Task 6. On the small real disk

File: `apps/server/src/start-from-spare.e2e.test.ts` (it owns `WAITRON_FULL_DISK_DIR_FROM_SPARE`; no
new CI variable). The disk is 32 MiB (`testing/full-disk.ts:111-121`; CI's tmpfs at most 64 MiB), so:

- pass a small `spareBytes` (1 MiB → floor 17 MiB) and fill under it; size two deletable archives so
  the expected deletion count follows from the sizes (state it in the test);
- use a dashboard-managed note with the key in `backup.env` and no sealed record, so the booted
  server's backup supervisor stays off;
- red: the start logs `backup.archive_deleted` with `reason: "start_room"` (read from `events()`),
  the spare file is still whole, no release marker; control (other case): `venue.db` replaced after
  the note was written → no `start_room` deletion, the spare released as today. Do not assert archive
  counts after boot (the free-space watch also deletes on a disk this small).

### Task 7. Boot records the alert from the start's record

Files: `apps/server/src/boot.ts` (or a small `start-backup-room-record.ts` it calls) + test beside
slice 1's `backup-deletion-alert.test.ts`.

- Red: a start-deleted record at boot raises one `backup.archives_deleted` incident with the taken
  days of the oldest and newest deleted archive and deletes the record; a malformed record is logged
  and deleted, no incident; no record, no incident.

### Task 8. Words and docs

- `docs/developers/conventions-data.md`: the spare-file section gains the start's deletion; a short
  section on the note (who writes it, who deletes it, the deliberate limits above), linked from the
  backup-room section.
- Root `CLAUDE.md` §3: one rule line: every path that replaces or removes the live `venue.db` deletes
  `<state>/backup-room-note.json` first; guard `scripts/backup-room-note.test.ts`, weaker than its
  name: reads text, two hand-kept lists.
- Guides (English and Spanish, same `{#id}`s): `apps/server/src/guide/{en,es}/box-status.md` and
  `data-protection.md` — the box also deletes old backups as it starts on a full disk, under the same
  rules. Run `apps/server/src/guide-content.test.ts`.
- `docs/backlog/box.md` § A1167 "Still open": delete the start bullet; `docs/backlog.md`: delete the
  "A1167: the start deletes old backups by itself" line; the design's status line says the start
  slice is built by this plan.

### Task 9. Checks before finish-branch

- Fiscal gates, unedited: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`
  and `… vitest run inmutabilidad`.
- Root guards touched: `scripts/backup-room-note.test.ts`, `scripts/spare-space.test.ts`,
  `scripts/backup-staging-touchers.test.ts`, `scripts/claude-md-pointers.test.ts`,
  `scripts/personal-log-params.test.ts`, `scripts/errors-reachable.test.ts` (if a code was added).
- The server's real-disk files: `start-from-spare.e2e.test.ts`, `start-full-disk.e2e.test.ts`,
  `backup-room.e2e.test.ts`.
- `git diff origin/main... | /usr/bin/grep -E '^[+-].*(registerSif|restoreFiscal|activate\(|computeHuella|registros_facturacion|recordSale)'`
  prints nothing.

## Deviations from the design

- The design's example ("a small file in the state folder, written in the same step that starts a new
  chain") is replaced by a note the backup supervisor writes and every database-replacing path
  deletes, bound to the database file's identity, because writing it inside the chain start would
  change the fiscal core (H2).

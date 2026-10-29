# A1167 slice 2: the free-space watch deletes old backups when the disk runs short

Design: [2026-10-28-a1167-backups-make-room-design.md](../specs/2026-10-28-a1167-backups-make-room-design.md)
§1, §2 and "Slices → Slice 2", with the owner's answers (Q1 B, Q2 A, Q3 A, Q4 A; the one-line words;
2026-10-29 ~02:02: Q2 B and Q3 B for the words) in `~/waitron-campaign/questions.md`. Slice 1 is
built ([its plan](2026-10-28-a1167-1-room-before-backup.md), #2215); this slice reuses its code:
`listDeletableArchives`, `foldersOnDisk` and `makeRoom` (`apps/server/src/backup-room.ts`), and the
hooks `createBackupRoomHooks` builds (`apps/server/src/backup-deletion-alert.ts`).

**What it does.** Every reading of the free-space watch (`startFreeSpaceWatch`,
`apps/server/src/free-space-watch.ts`, every 60 seconds) first asks a new step to delete old backups.
When the disk holding the venue folder has less than `SPACE_LOW_BYTES` (2 GiB) free and backups are
running, the step takes the staging turn's `ifNoBackup` and deletes the oldest deletable archives in
the local backup folders on that disk, re-reading free space after each, until `SPACE_OK_BYTES`
(2.5 GiB) is free. Then the watch writes the spare file back, reads free space and records the
reading, as today. So where old backups can cover it, the low-space warning never comes on; the
deletion alert (`backup.archives_deleted`, slice 1's) says what was deleted.

**Review path: FULL.** Risk triggers: deleting data (backup archives); concurrency with the backup
run (the staging turn). No migration, no fiscal code: the only fiscal touch is slice 1's existing
read of the installation start. `/finish-branch` runs the Codex run-it seat twice (the second told
to set the checklist aside).

## Rulings (each goes in the PR description)

1. **When old backups cannot reach 2.5 GiB, the watch deletes every one §1 allows.** Design §2 says
   so for the watch ("When they cannot, it deletes every one §1 allows and the warning comes on as
   today"); §1's "never deletes toward a goal it cannot reach" is about a goal whose failure means
   the deletions bought nothing (§3's refused run, "Decisions": "would lose restore points for
   nothing"). The watch's deletions are never for nothing: each one is room the tills sell into
   (CLAUDE.md §5's full-disk stop; the house rule "losing a little data is accepted, being unable to
   trade is not"). §1's parenthesis says the same: "§2's watch still works toward its own, smaller
   goal". `makeRoom` gains an `outOfReach` option: `"floor"` (the run, today's behaviour) or
   `"aim"` (keep deleting toward the aim, which then deletes every deletable archive). The watch
   passes `neededBytes: 0, floorBytes: 0`, so it is never refused.
2. **"The box's disk" for the watch is the disk holding the venue folder**, the folder the watch
   reads (`boot.ts`, `startFreeSpaceWatch({ dir: config.venueDir, … })`), as design §1 says. A backup
   folder counts as on it by `foldersOnDisk(backends, venueDir)` (slice 1's device comparison). On a
   box the venue, state and backups volumes share one disk (design, "What happens today").
3. **"Where backups still run" is `BackupSupervisor.current().enabled`** (settings loaded and
   switched on, a recovery key, the primary, the venue opened: `backup-supervisor.ts`, `reload()` sets
   `#db` only then). A disabled, keyless, standby or mirror box deletes nothing (design §1, last
   paragraph). The destinations come from the same `current()` reading, local folders only.
4. **The deletion runs before the spare file is written back**, in the same reading, so a box that
   started on its spare (A1127 slice 2, #2206) deletes, writes the spare back and lifts the stop in
   one reading with nobody signed in (design "Slices → Slice 2"). The 2.5 GiB goal is read before the
   spare's own size is taken back; the spare is small (`spare-space.ts`), so this is noted, not
   compensated.
5. **The alert and email are slice 1's, unchanged by this slice**: the watch calls the same
   `recordArchivesDeleted(deleted, at)` hook. Lane A's open words follow-up (the taken dates and the
   venue name in subjects, owner 2026-10-29 ~02:02) changes what that hook records; whichever lands
   second rebases, and this slice needs no words of its own. One alert stays open at a time
   (`recordIncidentOnce`), so a watch deletion while slice 1's alert is open raises nothing new.
6. **Each deletion logs `backup.archive_deleted` with `reason: "space_low"`** (design §1); `makeRoom`
   takes the reason from its caller (the run passes `"backup_room"`).
7. **No real-disk case.** The watch's lines are fixed at 2 GiB and 2.5 GiB; the full-disk harness's
   image is 32 MiB (`apps/server/src/testing/full-disk.ts`), so a real-disk case would need the lines
   to become options only a test sets. The cases use a fake `statfs` at GiB scale over real files in
   a temporary folder, as `backup-room.test.ts` does.
8. **While a backup run holds or waits for the staging turn, the watch deletes nothing and logs
   nothing**; the next reading tries again (design §2; `ifNoBackup` answers `{ ran: false }`).
9. **`makeRoom`'s `stagingDir` option is renamed `dir`** (the folder whose disk is read), because the
   watch passes the venue folder. `foldersOnDisk`'s second parameter is renamed the same way. No
   behaviour changes for the run.

## Rules for every task

- Worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a1167-2-watch-deletes-backups`,
  branch `feat/a1167-2-watch-deletes-backups`. Commit each task with `git commit -s`, explicit paths.
- Test first: the named failing test, run, failing for the stated reason, before product code.
- Never rewrite an existing assertion. Setup lines that change (an option renamed, an option a
  helper must now pass) are listed in the task and in the PR.
- Read every Vitest run's `Tests` count. Run focused files:
  `pnpm --filter @waitron/server exec vitest run src/<file>`.
- `pnpm --filter @waitron/server typecheck` and `pnpm format:check` before each commit.

## Task 1: `makeRoom` takes its reason and what to do when the aim is out of reach

**Files:** `apps/server/src/backup-room.ts` (`MakeRoomOptions`, `makeRoom`, `foldersOnDisk`'s
parameter name); `apps/server/src/backup-room.test.ts` (`base()`'s args); `apps/server/src/backup-sweep.ts`
(the `makeRoom` call).

- **Step 1 (red):** in `backup-room.test.ts`'s `makeRoom` block: (a) "logs the reason it is given":
  `reason: "space_low"` → each `backup.archive_deleted` line carries `reason: "space_low"`; (b)
  "with the aim out of reach and outOfReach 'aim', deletes every deletable archive and refuses
  nothing": `neededBytes: 0, floorBytes: 0`, free far under the aim, three deletable archives → all
  three deleted, the newest kept, one report with three, no throw; (c) "with outOfReach 'aim',
  still stops at the aim when it can be reached" (two of three deleted). `base()` gains
  `reason: "backup_room"` and `outOfReach: "floor"` and its `stagingDir` becomes `dir` (setup only;
  list in the PR). Run: (a) and (b) fail (the reason is fixed; (b) deletes nothing, goal is the
  floor 0).
- **Step 2:** `MakeRoomOptions` gains `reason: "backup_room" | "space_low"` and
  `outOfReach: "floor" | "aim"`; `stagingDir` → `dir`. `goal = free + offered >= aim || outOfReach === "aim" ? aim : floor`.
  The doc comment says both. `backup-sweep.ts` passes `dir: deps.stagingDir`, `reason: "backup_room"`,
  `outOfReach: "floor"`.
- **Step 3:** green: `src/backup-room.test.ts`, `src/backup-sweep-staging.test.ts`,
  `src/backup-sweep.test.ts`, `src/backup-sweep-stopped.test.ts` (every existing case unedited).
  Commit.

## Task 2: the low-space deletion step

**Files:** `apps/server/src/backup-room.ts` (two helpers moved out of `backup-sweep.ts`);
`apps/server/src/backup-sweep.ts`; new `apps/server/src/low-space-backups.ts` and
`low-space-backups.test.ts`.

- **Step 1:** move `readInstallationStart` (the wrapper logging `backup.installation_start_unreadable`)
  and the body of `runOnce`'s `reportDeleted` (logging `backup.archives_deleted_alert_failed`) from
  `backup-sweep.ts` into `backup-room.ts` as exported helpers; `runOnce` uses them. The sweep suites
  stay green unedited (refactor; no test first).
- **Step 2 (red):** `low-space-backups.test.ts`, real archives in a temporary folder and a fake
  `statfs` whose free space rises by a fixed virtual size per deleted file (as `backup-room.test.ts`'s
  `disk()`), sizes in GiB:
  1. under 2 GiB with deletable archives: deletes oldest first until 2.5 GiB, logs
     `reason: "space_low"`, reports once with the deleted list and `now()`;
  2. at exactly 2 GiB: deletes nothing and never reads the installation start;
  3. backups not running (`backends()` answers no destination): deletes nothing;
  4. a bucket-only box (no local folder): deletes nothing;
  5. a backup run holding the staging turn: `work` never runs, nothing deleted; once the run has
     finished, the next call deletes;
  6. old backups cannot reach 2.5 GiB: every deletable one is deleted, the newest kept, no throw;
  7. only the newest backup in the folder: nothing deleted (the design's control);
  8. an installation start that throws: logs `backup.installation_start_unreadable`, deletes nothing;
     one that answers null: deletes nothing;
  9. a folder on another disk (`deviceOf`): nothing deleted;
  10. a report that throws: logs `backup.archives_deleted_alert_failed` and the step resolves;
  11. free space unreadable: nothing;
  12. an aborted signal between deletions: stops and rejects with the abort.
  Run: fails, the module does not exist.
- **Step 3:** `lowSpaceBackupDeletion(deps)` returns `(signal: AbortSignal) => Promise<void>`. Deps:
  `dir`, `staging: Pick<StagingTurn, "ifNoBackup">`, `backends: () => readonly Pick<StorageBackend, "id" | "localDir">[]`,
  `installationStartedAt?`, `onArchivesDeleted?`, `now`, `log`, and test-only `statfs?`, `deviceOf?`.
  It reads free space; returns unless under `SPACE_LOW_BYTES`; reads `backends()`, returns with no
  local one; then inside `ifNoBackup`: `foldersOnDisk(backends, dir, deviceOf)`, and `makeRoom` with
  `neededBytes: 0`, `floorBytes: 0`, `aimBytes: SPACE_OK_BYTES`, `outOfReach: "aim"`,
  `reason: "space_low"`, the helpers from Step 1. Also `runningLocalBackends(status)`: from a
  `BackupRuntimeStatus`, the local-fs destinations as `{ id, localDir }` when `enabled`, else none
  (cases: enabled with a folder and a bucket → the folder only; not enabled → none).
- **Step 4:** green: the new file, the sweep suites, `src/backup-room.test.ts`. Commit.

## Task 3: each watch reading runs the step first

**Files:** `apps/server/src/free-space-watch.ts` (`startFreeSpaceWatch`); `free-space-watch.test.ts`.

- **Step 1 (red):** in `free-space-watch.test.ts`: (a) "deletes old backups before writing the spare
  back and reading": a `freeOldBackups` fake that raises the fake disk from 1.9 GiB to 4 GiB; calls
  are in the order freeOldBackups, restoreSpare, statfs; the recorded reading is 4 GiB and
  `storage.space_low` is never logged (control: the same disk with no hook logs it); (b) "a failed
  deletion step is logged and the reading still recorded, the spare still written back":
  `backup.low_space_delete_failed` with `errorCode`; (c) "stop aborts the step's signal and waits for
  it"; (d) with a noted full-disk stop, the step's room lets `disk.full()` lift it in that reading.
  Run: fails (no such dependency).
- **Step 2:** `startFreeSpaceWatch` gains optional `freeOldBackups?: (signal: AbortSignal) => Promise<void>`,
  called first in each reading, in its own try/catch (logs `backup.low_space_delete_failed` with
  `errorCode`), with an `AbortController` the watch's `stop()` aborts. The doc comment names it.
- **Step 3:** green: `src/free-space-watch.test.ts` (existing cases unedited). Commit.

## Task 4: boot wires the step

**Files:** `apps/server/src/boot.ts` (the watch, after the supervisor and `backupRoom`);
`apps/server/src/boot.clock-wiring.test.ts` (it already spies `createBackupRoomHooks` and the
supervisor's deps).

- **Step 1 (red):** in `boot.clock-wiring.test.ts`, spy `lowSpaceBackupDeletion` (a `vi.mock` of
  `./low-space-backups.js` keeping the actual) and capture the watch's deps (a `vi.mock` of
  `./free-space-watch.js` keeping the actual, as `boot.free-space.test.ts` does): the factory is
  called once with `dir` = the venue folder, `staging` the supervisor's `stagingTurn`,
  `installationStartedAt`/`onArchivesDeleted` the hooks' `readInstallationStart`/`recordArchivesDeleted`,
  no `statfs`; the watch's `freeOldBackups` is the factory's result; `backends()` answers none (this
  boot has no backups switched on). Run: fails.
- **Step 2:** boot builds it with `backends: () => runningLocalBackends(backupSupervisor.current())`
  and passes it to `startFreeSpaceWatch`.
- **Step 3:** green: `src/boot.clock-wiring.test.ts`, `src/boot.free-space.test.ts`; typecheck.
  Commit.

## Task 5: guides and docs

- `apps/server/src/guide/en/box-status.md` and `es/box-status.md` (`#free-space`, "Before each
  backup…" paragraph): the box also deletes its oldest backups whenever its disk runs short (under
  about 2 GB), while backups are on, until about 2.5 GB is free. `data-protection.md` en/es ("How
  long"): the same in one clause. Run `src/guide-content.test.ts`.
- `docs/developers/conventions-data.md`, "A backup run makes room for itself…": one paragraph for the
  watch (rulings 1–4, 8), and the `dir` rename.
- `docs/backlog.md`: delete the "A1167 slice 2" entry; `docs/backlog/box.md` § A1167: slice 2 moves
  from "Still open" to built, with a pointer to this plan.
- The design's header gets a dated line: slice 2 built by this plan.
- Commit.

## Task 6: checks before finish-branch

- `pnpm --filter @waitron/server exec vitest run src/backup-room.test.ts src/low-space-backups.test.ts src/free-space-watch.test.ts src/backup-sweep-staging.test.ts src/backup-sweep.test.ts src/backup-sweep-stopped.test.ts src/backup-supervisor.test.ts src/boot.clock-wiring.test.ts src/boot.free-space.test.ts src/guide-content.test.ts`
- `pnpm exec vitest run scripts/personal-log-params.test.ts scripts/backup-staging-touchers.test.ts`
  (the new file touches backup folders, not `<state>/backup-staging`; confirm the guard's view).
- Golden huella and immutability unedited and green:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- `/finish-branch` FULL.

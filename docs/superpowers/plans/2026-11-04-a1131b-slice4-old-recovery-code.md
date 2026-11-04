# A1131b/c slice 4: delete the repair page's old recovery from backup

Status: draft

**Goal.** Delete every piece of the repair page's own recovery from backup — the recovery folder
`<state>/first-setup-resolutions/backup-recovery/`, its journal, its fingerprint of the box's files,
its routes, its setup-page screens, the start's switch into its `target/` folders, its discard by
Start again and the spare-file and full-disk code that served that discard. A box that still holds
such a folder then shows the existing "reinstall Waitron" page (`setup.workspace_unsupported`), with
no conversion code (pre-live rule, root `CLAUDE.md` §3, last data bullet). Closes A1131 place 2: a
box never sells from inside a recovery folder again.

**Architecture.** Since slice 3 (#2335) Recover from backup is Start again's wipe followed by the
fresh-box restore, which writes into the usual folders and makes no recovery folder. Slice 4 is
almost all deletion. One line of new behaviour: `assertNoLegacyFirstSetupWorkspace`
(`packages/provisioning/src/first-setup-workspace.ts:8-13,19-41`) also treats
`first-setup-resolutions/backup-recovery` in either folder as an earlier Waitron's layout. That one
check is already called by the start (`apps/server/src/first-setup-entry.ts:172`, refused through
`START_REFUSALS` at `:134-140`), by the boot (`apps/server/src/boot.ts:1076`) and by Start again
(`apps/server/src/first-setup-resolution.ts:312`), so all three refuse such a box.

**Design:** [`docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md`](../specs/2026-10-28-a1131bc-restore-replaces-setup-design.md),
"## Slices" item 4, §7, §8, §9e, §10 and "Decision recorded, not asked". Approved by the owner
2026-10-29.

**Base:** main `03a1198150`. Worktree
`/Users/clintongormley/workspace/worktrees/waitron-refactor-a1131b-4-old-recovery-code`, branch
`refactor/a1131b-4-old-recovery-code`.

**Review weight: FULL.** Risk triggers: fiscal-adjacent (it removes a restore path that writes a new
installation name; design, slice 4) and a cross-package contract (`StartAgainSummary.recovery` and
`confirmRecoveryDiscard` leave the wire between `apps/server`, `packages/provisioning` and
`apps/setup`). Codex run-it seat twice, as for slices 2 and 3.

**No migration.** No task touches a schema, a `drizzle` folder or `packages/migrations`; the old
recovery keeps its state in files only. Task B7 checks it with
`git diff --stat origin/main -- '**/drizzle/**' 'packages/migrations/**' '**/schema/**'` (must print
nothing).

**No file in `packages/fiscal-verifactu` changes.** Searched:
`git grep -n -E 'first-setup-backup|setup-first-backup|BackupRepair|backup-repair|resolution/backup|discardedCopy' -- packages/fiscal-verifactu packages/module packages/composition packages/dashboard-modules`
printed nothing. Any module seat that only the old path called stays (design, slice 4: "deleting one
is a later, separate decision"). `apps/server/test/held-setup-database.ts` imports two files from
`packages/fiscal-verifactu/test/`; it is edited, they are not.

---

## How this was measured

Everything below was run on this tree (`03a1198150`) on 2026-11-04 unless it says "read".

- **Size.** `wc -l` over the files this plan deletes:
  - server source to delete, 8 files, 2,539 lines; server tests and fixtures to delete, 31 files,
    13,066 lines;
  - provisioning source to delete, 2 files, 994 lines; provisioning tests to delete, 6 files,
    2,411 lines;
  - setup page files to delete, 9 files, 3,360 lines.
  That is 56 whole files and about 22,370 lines, before the edits to about 70 other files. Too big
  for one pull request; two, as the design suggests (D1).
- **Who reads the folder.** `git grep -l -E 'first-setup-backup|backupRecovery|BackupRecovery|FirstSetupBackup|firstSetupBackup|discarded-copy|discardedCopy|boxFolders|backup-repair|recovery-target|target/venue|assertFirstSetupBackupBootTarget|resolveFirstSetupBackup'`
  listed 109 files outside `docs/superpowers`; the dashboard hits are a different feature (the
  backup recovery PACK: `BackupRecoveryPackApi`, `apps/server/src/backup-recovery-pack-api.ts`) and
  are untouched.
- **Importers of each server module to delete** (`git grep -l` on `from "./<module>.js"`):
  `first-setup-backup-recovery` ← entry, resolution, `setup-first-backup-api`,
  `setup-first-fiscal-api` (type only), 3 fixtures, `test/held-setup-database.ts`, 6 tests;
  `first-setup-backup-entry` ← `boot.ts`, `first-setup-entry.ts`, `node-entry.ts`, 8 tests;
  `setup-first-backup-api` ← `boot.ts`, `first-setup-entry.ts`, 6 tests;
  `first-setup-backup-source` ← the recovery, 3 fixtures, 13 tests;
  `first-setup-backup-history` ← the recovery and its test; `first-setup-backup-setups` ← history
  and its test; `first-setup-backup-publication` ← the recovery; `discarded-copy` ←
  `node-entry.ts`, `node-entry.test.ts`, its test.
- **Helpers the deleted files call, checked for other callers** (each `git grep -l -w`, excluding
  the deleted files): only two become production-dead — `reconcileRestored` in
  `apps/server/src/cloud-recovery.ts:607` (its one caller is `first-setup-backup-recovery.ts:1423`)
  and `readFirstFiscalEvidenceSnapshot` in `apps/server/src/first-fiscal-evidence.ts:88` (its one
  caller is `first-setup-backup-setups.ts`). `restoreFromArtifact` (`apps/server/src/restore.ts:529`)
  has no production caller left either, but 13 test files call it (D6). Everything else the deleted
  files import has other callers.
- **The two recovery error codes.** `git grep -n -E 'recovery_in_progress|recovery_discarded'`:
  `setup.recovery_discarded` is thrown only at `first-setup-backup-recovery.ts:280`;
  `setup.recovery_in_progress` only at `first-setup-resolution.ts:222` (Start again's discard) and
  `setup-first-fiscal-api.ts:676` (the fence). Both become unthrown.
- **`scripts/errors-reachable.test.ts` does not demand their removal**: it checks only that each
  package's `errors.ts` is reachable from its `index.ts` (`:7-17`). They are removed by choice
  (pre-live rule; D11).
- **Guards with hand-kept lists naming deleted files** (`git grep` over `scripts/`):
  `scripts/spare-space.test.ts:27-28,36-37,44-45,134-136,146,150`,
  `scripts/backup-room-note.test.ts:42-45,65-66`, `scripts/start-again-records-writers.test.ts:23`.
  Checked and not naming any affected file: `alert-codes`, `staff-notice-codes`,
  `ongoing-alert-codes`, `module-seams`, `personal-log-params`, `write-path-tables.json`,
  `backup-staging-touchers`. `scripts/start-again-note-writers.test.ts` and
  `packages/provisioning/src/box-folders.ts` (both in the design) no longer exist: `ls` says so,
  and `git log --diff-filter=D` names 90f41f4907 (A1206, #2245).
- **`apps/server/test-durations.json`** has 30 rows for files this plan deletes (lines 370,
  428-448, 467-470, 964-965). `scripts/vitest-duration-sequencer.test.mjs:223-240` checks only that
  every existing test file is packed, so a stale row does not fail; the rows go anyway (design §7).
- **Order of the two pull requests.** Read, not run: the setup page reads
  `/setup-api/first-setup/resolution/backup/activity` every time it opens a repair-page session
  (`apps/setup/src/setup-app.ts:1150-1166`, through `:1180`), and `SetupApi.#request` throws on any
  answer that is not 2xx (`apps/setup/src/api/client.ts:869`). Deleting the server's routes first
  would make the repair page fail on every box until the page changed (D1).

---

## Decisions

- **D1. Two pull requests, the setup page first.** PR A (setup page, its tests, the docs that
  describe the page) stops the page calling the old routes and reading the old summary fields. PR B
  (server, provisioning, guards, server docs, backlog) deletes the routes and everything behind
  them. The reverse order, which the design suggested, would break the repair page on main between
  the two merges (receipt above). Each pull request ships the box's setup page and server together
  in one image (`deploy/Dockerfile` builds both), so only main sees the in-between state.
- **D2. The refusal is one more name in `LEGACY_NAMES`** (`packages/provisioning/src/first-setup-workspace.ts:8-13`):
  `first-setup-resolutions/backup-recovery`, looked for with `lstat` in both folders like the
  others (`:28-36`). Only the `backup-recovery` child: `first-setup-resolutions/<uuid>/` is still
  A731's own resolution record (`packages/provisioning/src/first-setup-resolution.ts:369`), which
  Start again deletes (`first-setup-start-again-deletion.ts:330-347`). The comment at `:7` grows to
  say "or its repair-page recovery from backup".
- **D3. The start's ordinary clean-up runs before the refusal**, as it does today for every
  `setup.workspace_unsupported` box: `freeSpaceAtStart`, `deleteOldBackupsAtStart` and the spare
  release run in `runEntry` (`apps/server/src/node-entry.ts:360-393`) before `resolveFirstSetupEntry`
  (`:395`), which refuses. No new ordering.
- **D4. Between the two merges, a box that still has an old recovery cannot discard it from the
  page.** After PR A the page refuses a summary carrying `recovery` as unreadable (it draws "The saved
  setup cannot be read. Contact support.", the existing `setup.attempt_invalid` words), and a
  running old recovery's fence refusal is drawn with the general error. After PR B such a box shows
  the reinstall page. Only a box that started an old recovery before slice 3 landed (2026-10-31) can
  be in this state; pre-live, it is reinstalled (design, "Decision recorded, not asked").
- **D5. `WAITRON_SPARE_SPACE_DIR` goes.** `runEntry` set it only so a server booted from a selected
  recovery's `target/state` kept the spare in the configured state folder
  (`node-entry.ts:438`; `docs/developers/conventions-data.md:3453-3456`). Without the folder switch
  the started folders differ from the configured ones only as `canonicalFirstSetupDirectory`'s
  `realpath` of the same folder (`packages/provisioning/src/first-setup-resolution.ts:105-121`;
  `node-entry.test.ts:2348-2349` notes `tmpdir()` is such a link on macOS), so the spare is the same
  file. `boot.ts:1182-1184` then always uses `config.stateDir`.
- **D6. `restoreFromArtifact` stays.** It has no production caller after the deletion, but 13 test
  files use it to place an archive (`git grep -l -w restoreFromArtifact -- '*.test.ts'`). Deleting
  it is a separate change; PR B adds a backlog entry.
- **D7. `reconcileRestored` and `readFirstFiscalEvidenceSnapshot` go** with their own test cases:
  each is dead once its only caller is deleted (measurement above).
- **D8. `isBackupRoomFileName` stays.** Its only production reader is the deleted fingerprint
  (`first-setup-backup-workspace.ts:17`), but `apps/server/src/backup-room-note.test.ts:144` checks
  the names the note writer produces with it.
- **D9. `first-setup-launch.ts`'s comparison of the admitted folders with the configured ones stays**
  (`:119-130`), and so does `runEntry`'s `moved` (`node-entry.ts:441-447`): both now only follow
  the canonical form of the same folders (D5).
- **D10. The Start again contract loses the recovery.** `StartAgainSummary.recovery`,
  `StartAgainRecoveryShown`, the request's `confirmRecoveryDiscard`, the confirmation record's
  `database: "present"` (written only when Start again discarded a recovery:
  `packages/provisioning/src/first-setup-start-again-confirmation.ts:115-116`) and the deletion
  marker's `discarding` option all go. Pre-live: no reader of an older record is kept.
- **D11. Both recovery error codes are deleted** from `packages/provisioning/src/errors.ts:36-38`,
  from the route status maps (`setup-first-fiscal-api.ts:44`, `setup-first-backup-api.ts:25` with
  its file) and from the page (`apps/setup/src/setup-app.ts:237-238`,
  `apps/setup/src/i18n/strings/shell.ts:12-15,178-181`).
- **D12. Four log events stop being written**: `setup.recovery_cleanup_refused`
  (`first-setup-entry.ts:270`), `storage.spare_release_skipped` (`spare-space.ts:242`),
  `recovery.discarded_copy_unreadable` (`recovery-surface.ts:197`) and `cloud.recovery_report_pending`
  (`first-setup-backup-recovery.ts:1484`). None is in an alert-code or personal-data list (searched).
- **D13. No CI shard count changes in this slice.** About 1,700 file-seconds of server tests go
  (the deleted rows' values). If a server shard then runs well under its peers, or one drifts past
  4 minutes, refresh the table with `scripts/test-durations.mjs` in a follow-up (root `CLAUDE.md`
  §2).
- **D14. No new guide words.** The refused start's page already says, in both languages, "This box
  holds a setup from an older version of Waitron that this version cannot use. Reinstall Waitron on
  this box to start fresh." (`apps/server/src/i18n/recovery-page.ts:369`, pinned by
  `first-setup-resolution.boot.test.ts:488-491`). The operator runbook gets one English sentence
  (Task B6); the user guide only loses the old paragraphs (Task A6).

---

## Readers the design's table (§7) does not list

Found on this tree; each is handled by the task named.

| Reader | What it does with the old recovery | Task |
| --- | --- | --- |
| `apps/server/src/boot.ts:1138-1142` (`backupRepairOnly` log sink), `:1261-1294` (owner-write fence and the `/setup-api/*` gate that waits for ordinary requests), `:1382-1398` (`firstSetupBackupRecoveryFor`, `mountFirstSetupBackupApi` with the `enter` hand-off), `:1670` (`stopWork`) | the ORDINARY setup server (not only the repair page) mounts the old routes and hands the process over to a recovery | B3 |
| `apps/server/src/setup-first-fiscal-api.ts:84-138` (`recoveryDiscardConfirmation`, `shownRecovery`, `recovery` in `shownSummary`), `:649-722` (`FencedRecovery`, `fenceWrite`, `mountFirstSetupResolutionFence`, `firstSetupOwnerWriteFence`), `:1012,1037-1051` (the route's `confirmRecoveryDiscard`) | parses the discard and fences writes while a recovery runs | B2 |
| `apps/server/src/first-setup-resolution.ts:186-260,289-325,383-393,412-498` | the summary names a stopped recovery; Start again seals, abandons and empties it | B2 |
| `packages/provisioning/src/first-setup-start-again-confirmation.ts:17-28,75-91,115-116,135` | the record keeps `shown.recovery`; `database: "present"` exists only for a discard | B5 |
| `apps/server/src/spare-space.ts:217-257` (`releaseSpareBeforeStartAgain`, `discardable`), mounted at `first-setup-entry.ts:359-369` | releases the spare before Start again beside a discardable recovery | B4 |
| `apps/server/src/first-setup-entry.ts:115-132` (`restartDeletesLogs`), `:244-283` (`emptyDiscardedRecovery`) | answers the repair page's "restart deletes logs" by the recovery's stage; empties a discarded copy | B3 |
| `apps/server/src/node-entry.ts:348-393,441-449,463,545,589,616`; `apps/server/src/start-space.ts:22-30` (`insideAny`), `:56,106` (`stagingLeftovers`) | the start's repair and selected stages; `insideAny` and `stagingLeftovers: false` have no other caller | B3, B4 |
| `WAITRON_SPARE_SPACE_DIR` (`node-entry.ts:438`, `boot.ts:1182-1184`) | keeps the spare in the configured folder while booted from `target/state` | B3 |
| `apps/server/src/cloud-recovery.ts:607-630` (`reconcileRestored`) | Cloud client step only the old recovery calls | B4 |
| `apps/server/src/first-fiscal-evidence.ts:83-102` (`readFirstFiscalEvidenceSnapshot`) | read only by `first-setup-backup-setups.ts` | B4 |
| `packages/provisioning/src/first-setup-state.ts:152-153` | a comment whose reason ("imports this one through the backup workspace") goes with the workspace | B5 |
| `apps/setup/src/setup-app.ts` (activity read and 30-second watch `:1150-1209`, backup status read `:1337-1356`, render `:2355-2645`), `initial-owner-strings.ts:18-31,89-104`, `shell.ts:12-15,178-181`, `start-again-wipe.ts` (`recovery`, `confirmRecoveryDiscard`) | the live page still draws running, stopped and unreadable recoveries and sends the discard | A1 |
| `apps/server/test/held-setup-database.ts:45-46,101-111,282-300` | the held-database fixture builds a stopped recovery beside the database BY DEFAULT | B1 |
| `apps/server/test/start-again-deleted.ts:28,113` and `test/start-again-held-fixture.ts:96-100,175-183,340-375` | allow the recovery's leftovers and send the discard by default | B1, B5 |
| `apps/setup/test/held-database-browser.ts`, `wipe-browser.ts`, `missing-database-browser.ts`, `first-setup-browser.ts:104` | page fixtures stub `/backup/activity` and `/backup/status` and default to a stopped recovery | A2-A4 |
| docs: `apps/server/README.md:47-56`, `docs/developers/conventions-ui.md:48-49,1176-1193,1300-1301`, `docs/developers/testing-guide.md:1462-1477`, `docs/developers/ci-and-gates.md:1838-1848`, `docs/backlog/self-service-refusals.md:539,543-558`, `docs/backlog/replication-cloud.md:820-821`, `docs/backlog/ci.md:1186`, `docs/backlog/architecture.md:1101-1102`, `docs/backlog.md:742-745,6066-6069` | sentences about the old recovery | A6, B6 |

---

## Files to delete

**PR A (setup page), 9 files:**
`apps/setup/src/first-setup-backup-session.ts`, `apps/setup/src/first-setup-backup-session.test.ts`,
`apps/setup/src/screens/first-setup-backup-screen.ts`,
`apps/setup/src/screens/first-setup-backup-screen.test.ts`,
`apps/setup/src/screens/first-setup-backup-screen.a11y.test.ts`,
`apps/setup/src/screens/first-setup-backup-screen.unsaved.test.ts`,
`apps/setup/src/api/first-setup-backup.test.ts`, `apps/setup/src/i18n/backup-repair.ts`,
`apps/setup/test/first-setup-backup-browser.ts`.
The screen `setup-first-backup` is no longer mounted by the page (searched: only its own file
defines it; `setup-app.ts` imports only `shownAt` from it, `:14`).

**PR B (server and provisioning), 47 files:**

- server source (8): `apps/server/src/first-setup-backup-recovery.ts`, `first-setup-backup-source.ts`,
  `first-setup-backup-history.ts`, `first-setup-backup-setups.ts`, `first-setup-backup-publication.ts`,
  `first-setup-backup-entry.ts`, `setup-first-backup-api.ts`, `discarded-copy.ts`;
- server tests (28), each testing only the old recovery, its routes, its Start-again discard or the
  discarded copy: `apps/server/src/discarded-copy.test.ts`, `first-setup-backup-cloud-lease.test.ts`,
  `first-setup-backup-cloud-placement.test.ts`, `first-setup-backup-cloud-renewal.test.ts`,
  `first-setup-backup-cloud.test.ts`, `first-setup-backup-discard-lease.test.ts`,
  `first-setup-backup-entry.test.ts`, `first-setup-backup-entry.v1.test.ts`,
  `first-setup-backup-handoff.test.ts`, `first-setup-backup-history.test.ts`,
  `first-setup-backup-lease.test.ts`, `first-setup-backup-recovery-opening.test.ts`,
  `first-setup-backup-recovery-preparation.test.ts`, `first-setup-backup-recovery.test.ts`,
  `first-setup-backup-reopen.test.ts`, `first-setup-backup-resume-authority.test.ts`,
  `first-setup-backup-resume-publication.test.ts`, `first-setup-backup-resume.test.ts`,
  `first-setup-backup-shutdown.test.ts`, `first-setup-backup-source.test.ts`,
  `first-setup-backup.boot.test.ts`, `first-setup-backup.lifetime.test.ts`,
  `first-setup-start-again-backup.test.ts` (13 cases), `first-setup-start-again-backup-discard.test.ts`
  (16), `first-setup-start-again-backup-restart.test.ts` (13),
  `first-setup-start-again-damaged-recovery.test.ts` (2, both "beside a stopped recovery"),
  `setup-first-backup-api.test.ts`, `setup-first-backup-api-adapters.test.ts`;
- server fixtures (3): `apps/server/test/first-setup-backup-cloud-fixture.ts`,
  `first-setup-backup-recovery-fixture.ts`, `first-setup-backup-resume-fixture.ts`;
- provisioning source (2): `packages/provisioning/src/first-setup-backup-workspace.ts`,
  `first-setup-backup-discard.ts`;
- provisioning tests (6): `first-setup-backup-discard.test.ts`, `first-setup-backup-workspace.test.ts`,
  `first-setup-backup-workspace.durability.test.ts`, `first-setup-backup-workspace.entry.test.ts`,
  `first-setup-backup-workspace.pointer-order.test.ts`, `first-setup-backup-workspace.spare-race.test.ts`.

Two behaviours in the three `first-setup-start-again-backup*.test.ts` files survive without a
recovery and are kept elsewhere, ported in Task B2: a confirmation record that cannot be written
deletes nothing (`…-backup-discard.test.ts:784`), and a request carrying `confirmRecoveryDiscard` is
refused (`…-backup-discard.test.ts:588,603`).

---

## Global constraints for every task

- Work only in the worktree above; commit with `git commit -s`, a plain-English message naming what
  was deleted and every changed check (old → new) by title. No plan shorthand (task numbers, D-ids)
  in commit messages.
- Red first where the task changes behaviour; for a pure deletion, the deletion's proof is that the
  package's typecheck finds no remaining caller and the named suites stay green.
- A test of surviving behaviour that also exercised the old path changes only by deleting the
  old-path part. Keep every refusal's assertion where the new path still refuses.
- Never weaken an assertion to make a converted case pass: if a case's subject only exists with a
  recovery, delete the case and list it; if its subject survives, keep its assertion and drop only
  the recovery from its setup.
- Browser suites (`apps/setup`) run real Chromium: check `memory_pressure | grep free` first and run
  beside another browser run only well above 15% free (root `CLAUDE.md` §2).
- Under an AI agent Vitest hides passing output; read the `Tests` count, and run with
  `env -u AI_AGENT -u CLAUDECODE` when the count is needed.
- Do not edit any file under `packages/fiscal-verifactu`, any migration, or any shipped migration
  comment.
- An implementer that passes about 150 tool calls with the task unfinished stops at a passing (or
  cleanly red) point, commits, and returns a handover — done, left, files, each check's state — and
  a fresh implementer continues from it.
- Typecheck commands: `pnpm --filter @waitron/setup typecheck`, `pnpm --filter @waitron/server typecheck`,
  `pnpm --filter @waitron/provisioning typecheck` (each runs `tsc --noEmit`); lint with
  `pnpm --filter <pkg> lint`; `pnpm format:check` before each commit.

---

## PR A — the setup page stops using the old recovery

Branch: this one. Tasks A1–A7, in order. After A1 the suites A2–A4 rewrite are red by design until
their task; A1's commit lists them.

### Task A1 — the page reads, draws and sends nothing of the old recovery

**Files:** `apps/setup/src/setup-app.ts`, `apps/setup/src/start-again-wipe.ts`,
`apps/setup/src/api/first-setup-types.ts` (only `StartAgainSummary.recovery` and
`StartAgainRecoveryShown`, `:126-136`; the `BackupRepair*` types stay until A5 because `client.ts`
still names them), `apps/setup/src/screens/initial-owner-strings.ts`,
`apps/setup/src/i18n/strings/shell.ts`, tests `apps/setup/src/setup-app-wipe.test.ts`,
`apps/setup/src/start-again-wipe.test.ts`, the words test in `apps/setup/src/setup-app-resolution.test.ts`
(the case near `:120` that lists removed keys).

**Red first (write, run, see fail):**
1. `setup-app-wipe.test.ts`: "the repair page sends nothing under /resolution/backup/: on load, on
   Start again, on Recover from backup, with the setup database present and missing". Use
   `wipe-browser.ts`'s request log and its `OLD_RECOVERY_ROUTE` pattern widened to
   `/\/resolution\/backup\//`. Fails today: the page reads `/backup/activity` on load
   (`setup-app.ts:1150-1166`) and `/backup/status` with the database missing (`:1341`).
2. `start-again-wipe.test.ts`: replace "a stopped recovery and a damaged recovery-key record send
   confirmRecoveryDiscard and recoveryRecordDamagedShown together" (`:206`) by "a summary carrying
   recovery is refused as unreadable", the twin of "a summary carrying held is refused as
   unreadable" (`:99`). Fails today: `recovery` is an accepted key (`start-again-wipe.ts:11`).
3. The words test: add `recoveryRunning`, `recoveryLastActive`, `recoveryLastSaved`,
   `recoveryRunningNext`, `recoveryStopped`, `recoveryStoppedRefused`, `recoveryStoppedRecover`,
   `recoveryStoppedCloud`, `recoveryUnreadable`, `checkAgain`, `recoveryDetailsUnread` to its
   removed-keys list (EN and ES), and `shell.first_setup.recovery_in_progress`,
   `shell.first_setup.recovery_discarded` to the shell's.

**Change:**
- `setup-app.ts`: delete the imports `BackupRepairActivity`, `BackupRepairStatus` (`:6-7`) and
  `shownAt` (`:14`); `ACTIVITY_REREAD_MS` and `STOPPED_BACKUP_PHASES` (`:240-241`); the two error
  mappings (`:237-238`); the states `firstWipeUnread`, `firstBackupPhase`, `firstActivity`,
  `firstActivityUnreadable`, `firstRecoveryUnsettled` and `#activityTimer` (`:1113-1124`) and every
  read of them (disconnect `:682-685`, `:1520-1550`); the activity reads in `#openFirstSession`
  (`:1150-1166`, keeping the inspection read); `#readActivity`, `#readActivityAnswer`,
  `#watchActivity`, `#stopActivityWatch` (`:1169-1209`); in `#readMissingAsk` the backup-status read
  and the unsettled check (`:1341-1355`) — it reads only the summary; in `#closeWipe` the three
  states; in `#openWipeConfirmation` the unread/unsettled carry-over (`:1392-1396`), the
  backup-phase return (`:1406-1407`), the activity read and running return (`:1409-1416`) and the
  catch's stopped-recovery branch (`:1431-1437`); in the render (`:2355-2645`) `recoveryStarted`,
  `running`, `offersNothing`, `stopped`, `stoppedHere`, `offersStartAgain`, `unsettled`,
  `lastActive`, `stoppedBlock`, `stoppedShown`, `stoppedWords`, the running view, the unread view
  with its Check again, the `recovery-unreadable` lines, and the `firstActivityUnreadable` and
  `offersNothing` conditions on Continue, Replace and Abandon. Start again and Recover from backup
  are then enabled by `!this.firstOwnerBusy && offered` alone.
- `start-again-wipe.ts`: drop `"recovery"` from `SUMMARY_KEYS`, `RECOVERY_KEYS`,
  `readableRecovery`, the `recovery` part of `summaryOf` and `sameSummary`, and the
  `confirmRecoveryDiscard` branch of `sendWipe` (`:70-72`): present-database sends carry only
  `confirmUnreadableDatabase` and `recoveryRecordDamagedShown`.
- `initial-owner-strings.ts`: delete EN `:18-31` and ES `:89-104` (`recoveryRunning` through
  `recoveryDetailsUnread`, `checkAgain` included; design §9e). `recoveryRecordDamaged` (`:40`,
  `:115`) stays: it is the setup's own recovery-key record.
- `shell.ts`: delete `shell.first_setup.recovery_in_progress` and `…recovery_discarded` in both
  languages.

**Checks:** the three red cases green; `pnpm --filter @waitron/setup exec vitest run
src/setup-app-wipe.test.ts src/start-again-wipe.test.ts` green, count read;
`pnpm --filter @waitron/setup typecheck` errors only in the suites A2–A4 rewrite (list them in the
commit); `pnpm --filter @waitron/setup lint`.
**Deletion proof:** put back the activity read in `#openFirstSession` → case 1 red; restore.
**Commit:** "Setup page: stop reading, drawing and sending the repair page's old recovery from backup".

### Task A2 — the resolution suites without a recovery

**Files:** `apps/setup/src/setup-app-resolution.test.ts`, `setup-app-resolution.a11y.test.ts`,
`setup-app-resolution.unsaved.test.ts`.

Delete (subject exists only with a running, stopped or unreadable recovery, or with the activity
read): in `setup-app-resolution.test.ts` the cases at `:969` (a tab that signed in before reads the
activity while another device runs a recovery), `:1104`, `:1167`, `:1174` (Recover beside a stopped
recovery), `:1216`, `:1241`, `:1308`, `:1326`, `:1352`, `:1384`, `:1397`, `:1420`, `:1629`,
`:1660` (an activity read on pressing Start again that fails), `:1694`, `:1706` (both Check again),
`:1734`, `:1757` (tab closed while reading the activity), and the `recovery_in_progress` rows at
`:1274-1275`, `:1603-1604`, `:1638`; in `setup-app-resolution.a11y.test.ts` the "stopped recovery"
states (`:201`).

Convert (subject survives; drop only the stopped recovery from the setup, keep the assertion):
`:1141` (a damaged record: the line is drawn and the request carries `recoveryRecordDamagedShown`;
drop the stopped line and the discard key), `:1181` (Recover offered with no recovery: unchanged),
`:1511` (an empty setup database says what Start again deletes and that no invoice was sent),
`:1564` (saved trading settings beside a database holding records: Start again offered, pressing it
draws the refusal, nothing sent), `:1867`, `:1876`, `:1884` (a summary read refused
`storage.disk_full` says the disk is full / keeps the server's word on restarting / says nothing
without the field — now drawn under Start again, as `setup-app-wipe.test.ts:205` draws a failed
summary with no recovery). Retitle each converted case to drop "beside a stopped recovery".
`setup-app-resolution.unsaved.test.ts:75` and `setup-app-recover.test.ts:49` look for a
`setup-first-backup` element: keep the case, replace that check by "no request matched
`/resolution/backup/`" (the element no longer exists after A5, so the old check would pass
vacuously).

Any other case that turns red: apply the same rule and list it in the commit with its reason.
**Checks:** the three files green (count read); `pnpm --filter @waitron/setup typecheck` errors
only in A3–A4's files. **Commit:** "Setup page tests: the resolution suites without the old recovery".

### Task A3 — the missing-database suites without a recovery

**Files:** `apps/setup/src/setup-app-missing-database.test.ts`,
`setup-app-missing-database.a11y.test.ts`, `apps/setup/test/missing-database-browser.ts`.

Fixture: `missingDatabaseFixture` loses its `backupPhase` and `activity` options and its
`/backup/status` and `/backup/activity` answers (`missing-database-browser.ts:56-100`);
`stoppedActivity`, `stoppedRecovery`, `stoppedSummary`, `recoveryStartedAt`, `recoveryLastActiveAt`
(`:25-53`) are deleted once A4 no longer imports them (move them out with A4 if A4 runs first); the
mount waits for `start-again` only (`:127`).

Delete in `setup-app-missing-database.test.ts`: `:326` (neither button while a journal reports
`selected`/`uncertain`), `:340` (running), `:356` (once stopped), `:505` (another device runs a
recovery), `:524`, `:549` (activity re-reads), `:564` (a recovery that failed), `:578` (pressing
names the stopped recovery), `:607` (Cloud approval closes within an hour), `:626` (last step
saved), `:647`, `:665`, `:672` (journal unreadable), `:686` (discarded elsewhere), `:715`, `:757`,
`:772`, `:791` (activity reads), `:814` (summary names a recovery the status does not report),
`:863` (Check again's words equal the backup screen's), `:891`, `:926`, `:958` (Check again),
`:974`, and the `/backup/status` row of the `it.each` at `:387` (keep its `/start-again/summary`
row). Change `:697-711` and `:897-947` only if they survive as cases about another code: they
assert `recovery_discarded` and `recovery_in_progress` words, which are deleted — delete those rows.
In the a11y file delete the "backup-recovery lines" states (`:110`).

**Checks:** both files green (count read); `pnpm --filter @waitron/setup typecheck` errors only in
A4's files. **Commit:** "Setup page tests: the missing-database suites without the old recovery".

### Task A4 — the held, wipe and recover suites without a recovery

**Files:** `apps/setup/test/held-database-browser.ts`, `apps/setup/test/wipe-browser.ts`,
`apps/setup/test/first-setup-browser.ts`, `apps/setup/src/setup-app-held-refusals.test.ts`,
`setup-app-held-database.a11y.test.ts`, `setup-app-wipe.test.ts`, `setup-app-recover.test.ts`,
`setup-app-recover.a11y.test.ts`.

- `held-database-browser.ts`: no activity answer (`:35`), summary `namedSummary` by default
  (`:37`), wait for `start-again` instead of `recovery-stopped` (`:61`); the file's doc line `:20`
  loses "beside a stopped recovery".
- `wipe-browser.ts`: delete the `activity` and `backupPhase` options and their answers (`:65-96`),
  the case row "a setup database holding records beside a stopped recovery" (`:157-161`) and every
  row's `activity: null`; keep the old-route pattern for A1's case.
- `first-setup-browser.ts:104`: delete the `/resolution/backup/activity` answer.
- `setup-app-wipe.test.ts`: delete `:132` (running when pressed), `:181` (beside a stopped recovery,
  disk_full and Check again), `:377` (a journal the summary does not name); keep `:205`, `:305`.
- `setup-app-recover.test.ts`: delete `:204` (journal `selected`/`uncertain`), `:282`, `:302`
  (Check again from Recover), `:344` (Cancel beside a stopped recovery), `:465`; keep `:218`,
  `:243` (drop the stopped row if it has one), `:601`. Every other case keeps its assertion; its
  helper drops the stopped recovery.
- `setup-app-held-refusals.test.ts:90,106,128` and the a11y file `:35,77`: retitle without "beside
  a stopped recovery"; the assertions stay (the held refusals do not depend on a recovery since
  slice 2).
- `setup-app-recover.a11y.test.ts`: delete the stopped states.

**Checks:** `pnpm --filter @waitron/setup exec vitest run src/setup-app-held-refusals.test.ts
src/setup-app-held-database.a11y.test.ts src/setup-app-wipe.test.ts src/setup-app-recover.test.ts
src/setup-app-recover.a11y.test.ts` green (count read); `pnpm --filter @waitron/setup typecheck`
clean except A5's dead files if any. **Commit:** "Setup page tests: held, wipe and recover suites
without the old recovery".

### Task A5 — delete the setup page's dead recovery code

**Delete:** the 9 PR A files above. **Edit:** `apps/setup/src/api/client.ts` — delete
`firstSetupBackupStatus`, `openFirstSetupBackup`, `resumeFirstSetupBackup`,
`prepareFirstSetupBackup`, `commitFirstSetupBackup`, `closeFirstSetupBackup`,
`renewFirstSetupBackup`, `firstSetupBackupActivity`, `startFirstSetupBackupCloud`,
`firstSetupBackupCloudStatus`, `startFirstSetupBackupCloudAgain`, `renewFirstSetupBackupCloud`,
`releaseFirstSetupBackupCloud` (`:289-375`) and the `BackupRepair*` imports (`:3-7`).
`CloudRecoveryView` (`:205`) stays: the fresh-box Cloud screens use it (`:413-421`).
`apps/setup/src/api/first-setup-types.ts`: delete `BackupRepairObservation`, `BackupRepairProof`,
`BackupRepairOpenRequest`, `BackupRepairResumeRequest`, `BackupRepairSession`,
`BackupRepairStatus`, `BackupRepairActivity` (`:101-164`).
Callers, by `git grep` before deleting: the 13 client methods are called only by
`first-setup-backup-session.ts`, `first-setup-backup-screen.ts`, `api/first-setup-backup.test.ts`
and, after A1, nothing in `setup-app.ts`; re-run
`git grep -n -E 'FirstSetupBackup|BackupRepair|backup-repair|first-setup-backup' -- apps/setup` and
it must print nothing.
**Checks:** `pnpm --filter @waitron/setup typecheck`, `lint`; the whole setup suite once
(`pnpm --filter @waitron/setup exec vitest run`, memory checked first), count read, no red file.
**Commit:** "Setup page: delete the old recovery's screens, session, strings and client calls".

### Task A6 — PR A's docs

Each sentence quoted, then its replacement.

- `apps/server/src/guide/en/backup-recovery.md:70-91` — delete from "The next paragraphs describe a
  recovery from backup begun on the repair page before this version of Waitron, which no longer
  starts one there." through "Where the page can tell, it says whether restarting the box can free
  space." (the running, stopped, Cloud-approval and full-disk-discard paragraphs). Nothing replaces
  them (D14).
- `apps/server/src/guide/es/backup-recovery.md:77-98` — the twin: from «Los párrafos siguientes
  describen una recuperación desde una copia iniciada en la página de reparación antes de esta
  versión de Waitron, que ya no la inicia ahí.» through «Cuando la página puede saberlo, dice si
  reiniciar el equipo puede liberar espacio.»
- `docs/operations/first-live-fiscal-setup.md:106-108` — "see what it shows — what the setup
  reached, a stopped recovery's times, and whether the setup database could be read." → "see what
  it shows — what the setup reached and whether the setup database could be read."
- `docs/operations/first-live-fiscal-setup.md:137-150` — delete "The page no longer starts a
  recovery from backup itself; …", the "While a backup recovery is running on another device…"
  paragraph and the "Once a backup recovery has stopped…" paragraph up to and including "…once you
  tick "Delete the old attempt and start again."". Keep the following sentence ("Before it deletes
  anything, the box writes a confirmation record …") as a paragraph of its own, unchanged: it
  describes the server, which PR B changes.
- `docs/operations/first-live-fiscal-setup.md:156-162` — delete "For a Waitron Cloud copy the page
  adds that the approval in Waitron Cloud closes by itself within an hour of when it was given, and
  that until then Cloud cannot approve a new recovery for this box's venue.", "Start again keeps the
  discarded recovery's journal records and its lock files, and deletes the rest." and "With the
  venue database missing, a recovery whose records cannot be read is reported as such, and neither
  Start again nor Recover from backup is offered beside it."; keep "If a file cannot be deleted, or
  the disk fills part-way through, the page says "Deletion interrupted. Reload the page to
  continue.", the box restarts, and the next start tries the deletion again."
- Backlog (closed by PR A, deleted with the reason in the commit):
  - `docs/backlog/setup.md:392-402` "Close a discarded recovery's Cloud approval from the box" and
    its line `docs/backlog.md:553-556`: the stopped line it wanted to extend is gone, and after PR B
    no box can hold a discarded recovery.
  - `docs/backlog/self-service-refusals.md:543-558` "### Recovery from a backup": its words
    (`apps/setup/src/i18n/backup-repair.ts`) are deleted. Check first that no other entry links to
    its anchor (`git grep -n 'recovery-from-a-backup' -- docs`).
**Checks:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
src/guide-backup-recovery.test.ts`; `pnpm exec vitest run scripts/guide-links.test.ts
scripts/english-only.test.ts scripts/claude-md-pointers.test.ts`; `pnpm format:check`.
**Commit:** "Docs: the setup page no longer shows the old recovery from backup".

### Task A7 — PR A's final checks

Fiscal gates, unedited: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
src/write-path.e2e.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run
inmutabilidad`. `git diff --stat origin/main -- packages/fiscal-verifactu` prints nothing.
`pnpm --filter @waitron/setup typecheck` and `lint` exit 0; `pnpm format:check` clean. Look check:
the repair page with the database present, missing, held, unreadable and refused, EN light and ES
dark at 390 px (screenshots stay out of the repo); nothing from the old recovery drawn, no overflow.
Then `/finish-branch` FULL with a note naming this plan and D4 (the in-between state). Coverage is
CI's: read `test-setup`'s coverage job on the PR head (98/98/98/95).

---

## PR B — the server and provisioning delete the old recovery

New branch off main after PR A lands (`python3 ~/workspace/tools/worktree.py new waitron
refactor/a1131b-4b-old-recovery-server --headless`), with this plan copied in. Tasks B1–B7 in order.

### Task B1 — the held-database fixtures stop building a stopped recovery (tests only)

**Files:** `apps/server/test/held-setup-database.ts`, `apps/server/test/start-again-held-fixture.ts`,
`apps/server/src/held-setup-database.test.ts`, `first-setup-start-again-held.test.ts`,
`first-setup-start-again-held-recovery.test.ts`, `first-setup-start-again-held-damaged.test.ts`,
`first-setup-start-again-held-journals.test.ts`, `first-setup-start-again-held-wipe.test.ts`,
`first-setup-database-holdings*.test.ts` (3 files), `start-again-full-disk.e2e.test.ts` (its held
cases only).

No production code changes, so every kept case must pass on unchanged code.
- `heldSetup` loses its `recovery` option, `service` and `workspace` (`held-setup-database.ts:45-54,
  101-111, 282-300`) and its imports of `createFirstSetupBackupRecovery` and
  `createFirstSetupBackupWorkspace`. Drop `recovery: false` from every call (about 80 calls,
  `git grep -n 'recovery: false' -- apps/server`).
- `start-again-held-fixture.ts`: every `...(f.service === undefined ? {} : { backupRecovery: f.service })`
  goes; `askStartAgain`'s default send (`:175`) becomes `{}`; `abandonUnemptied` (`:367-376`) and
  `heldActions`' lock option (`:343-355`) go if nothing else uses them.
- Delete (subject only exists with a recovery):
  `held-setup-database.test.ts:82` ("recovery: false leaves the held database with no recovery
  beside it"); the `liveness()` assertions at `:42,61,70,79` (keep the rest of each case; retitle
  `:38` without "beside a stopped recovery");
  `first-setup-start-again-held.test.ts:19` (the summary naming the stopped recovery);
  `first-setup-start-again-held-recovery.test.ts:32` (the record of a discard, `database: "present"`);
  `first-setup-start-again-held-damaged.test.ts:80,109` (a damaged database beside a stopped
  recovery);
  `first-setup-start-again-held-wipe.test.ts:154` (wiped, discarding the recovery);
  `start-again-full-disk.e2e.test.ts:252` (held with the spare released for a discard).
- Convert (drop the discard key; the assertion stays):
  `first-setup-start-again-held-recovery.test.ts:50` (damaged recovery-key record: send only
  `recoveryRecordDamagedShown`; its record assertion becomes "no confirmation record", because a
  present database writes none, `first-setup-resolution.ts:470`), `:70`, `:92`, `:118`, `:203`,
  `:217`, `:231` (drop `confirmRecoveryDiscard` from each send).
- `start-again-full-disk.e2e.test.ts:287`: drop `recovery: false` and the `mockReset` of the old
  entry (`:291`) only if that mock is no longer installed by the file (B4 handles the rest).
**Checks:** `pnpm --filter @waitron/server exec vitest run src/held-setup-database.test.ts
src/first-setup-start-again-held src/first-setup-database-holdings` green, count read;
`pnpm --filter @waitron/server typecheck`. **Commit:** "Server tests: the held setup database no
longer comes with a stopped recovery beside it".

### Task B2 — Start again no longer finds, fences or discards a recovery

**Files:** `apps/server/src/first-setup-resolution.ts`, `apps/server/src/setup-first-fiscal-api.ts`,
`apps/server/src/first-setup-entry.ts` (the fence mount and `backupRecovery` only),
`apps/server/src/boot.ts` (the owner-write fence only, `:1260-1262,1384`), tests
`apps/server/src/first-setup-start-again.test.ts`; delete
`first-setup-start-again-backup.test.ts`, `first-setup-start-again-backup-discard.test.ts`,
`first-setup-start-again-backup-restart.test.ts`, `first-setup-start-again-damaged-recovery.test.ts`.

**Red first:**
1. `first-setup-start-again.test.ts`: change "the Start again route takes confirmRecoveryDiscard
   only in its exact shape, with a shown recovery" (`:756`) to "the Start again route refuses a
   body carrying confirmRecoveryDiscard as setup.request_invalid 400, and nothing changes". Fails
   today: the key is accepted (`setup-first-fiscal-api.ts:1037-1038`).
2. Change "the Start again route takes a shown backup recovery only in its exact shape" (`:712`) to
   "the Start again route refuses a shown summary carrying recovery as setup.request_invalid 400".
   Fails today (`shownSummary`, `:94-114`, accepts it).
3. Port, red-proof by deletion rather than red-first (it passes today): "with the database missing,
   a confirmation record that cannot be written deletes nothing and writes no marker" — the
   no-recovery twin of `first-setup-start-again-backup-discard.test.ts:784`. Proof: move
   `writeStartAgainMarker` above the record write in `startAgainFirstSetup` → the case fails;
   restore.

**Change:**
- `first-setup-resolution.ts`: delete `BackupRecovery`, `STOPPED_PHASES`, `FoundRecovery`, the
  `lock` and `backupRecovery` options, `inProgress`, `stoppedRecovery` (`:186-260`); in
  `assessStartAgain` `found`, `recovery`, `discarding`, `discardsStopped` and the
  `confirmRecoveryDiscard` conflict (`:313-325`), and `...discarding` (`:360`); in the summary's
  `summaryOf` call no `recovery`; in `startAgainFirstSetup` the `confirmRecoveryDiscard` key
  (`:416`), `confirmsUnreadable` becomes `databaseUnreadable`, `finishing`, the `discardsStopped`
  conflicts, `refuseRunning`, the running checks, the record's `"present"` branch (the record is
  written for `missing || databaseUnreadable`), and the whole `if (found !== undefined)` block
  (`:483-511`). `StartAgainFirstSetupRequest.confirmRecoveryDiscard` (`:47`) goes. `summaryOf`
  (`:173-184`) loses its `recovery` parameter.
- `setup-first-fiscal-api.ts`: delete `recoveryDiscardConfirmation`, `shownRecovery` and `recovery`
  in `shownSummary` (`:84-138`); `FencedRecovery`, `fenceWrite`, `RESOLUTION_ROOT`,
  `resolutionWrite`, `mountFirstSetupResolutionFence`, `FIRST_SETUP_OWNER_WRITES`,
  `firstSetupOwnerWriteFence` (`:649-722`); the route's `confirmRecoveryDiscard` (`:1012,1037-1051`);
  the status row `"setup.recovery_in_progress": 409` (`:44`). Reword `START_AGAIN_ROUTES`' comment
  (`:726`) to "The repair page's routes: inspection, Continue's password step, and Start again's
  summary and request." (closes the backlog entry "A developer note still counts four requests",
  with B6's conventions-data change and B4's deletion of `releaseSpareBeforeStartAgain`'s comment).
- Callers of the deleted fence functions (`git grep -n -E 'mountFirstSetupResolutionFence|firstSetupOwnerWriteFence'`):
  `first-setup-entry.ts:370` (delete the call), `boot.ts:1261-1262` and `:1384` (delete
  `ownerWriteFence` and its `app.use`). `createFirstSetupResolutionActions` callers pass no
  `backupRecovery` (`first-setup-entry.ts:405`; tests).
- `first-setup-start-again.test.ts`: delete the rows "A731's repair open" and "A731's resume" of
  the `it.each` at `:1728-1851`, the case "A731's repair open while a deletion is pending answers
  409" (`:1853`), and the helpers `backupRepair`, `repairProof`, `BACKUP` (`:1667-1687`) with their
  imports.
**Checks:** red cases green; `pnpm --filter @waitron/server exec vitest run
src/first-setup-start-again src/first-setup-resolution src/recovery-start-again` green, count read
(names every Start-again suite); `pnpm --filter @waitron/server typecheck` — errors only where B3–B4
delete files that still import the removed types (list them); `pnpm exec vitest run
scripts/errors-reachable.test.ts scripts/start-again-records-writers.test.ts`.
**Commit:** "Start again no longer finds, fences or discards a recovery from backup".

### Task B3 — the start and the boot never look for the old recovery folder; a box that has one is refused

**Files:** `packages/provisioning/src/first-setup-workspace.ts`,
`packages/provisioning/src/first-setup-workspace.test.ts`,
`apps/server/src/first-setup-resolution.boot.test.ts`, `apps/server/src/node-entry.ts`,
`apps/server/src/first-setup-entry.ts`, `apps/server/src/first-setup-launch.ts` (only if the
`onClose: admission.dispose` line goes), `apps/server/src/boot.ts`, `apps/server/src/start-space.ts`,
tests `apps/server/src/node-entry.test.ts`, `node-entry.full-disk-order.test.ts`,
`first-setup-entry.test.ts`, `first-setup-entry.spare.test.ts`, `start-space.test.ts`,
`boot.disk-full-wiring.test.ts`, `first-setup-set-aside-lifetime.test.ts`.

**Red first:**
1. `packages/provisioning/src/first-setup-workspace.test.ts`: add rows
   `["venueDir", "first-setup-resolutions/backup-recovery", "folder"]` and
   `["stateDir", "first-setup-resolutions/backup-recovery", "folder"]` to the `it.each` at `:27-47`
   (make the parent folder first), and a case "a state folder holding first-setup-resolutions/<id>/
   alone passes" (A731's own record, D2). The two rows fail today; the third passes before and
   after (it is the refusal's negative control).
2. `apps/server/src/first-setup-resolution.boot.test.ts`: add `"old-recovery"` to `Box` (`:366`)
   — `startingBox` writes `<state>/first-setup-resolutions/backup-recovery/current.json` (`{}`)
   beside a claimed setup — and "a box holding the repair page's old recovery folder serves the
   reinstall page, in every entry mode (%s)" with `expectRefusedPage(port,
   "setup.workspace_unsupported")`, `startServer` not called and no `recovery.json` (copy of `:523-532`).
   Fails today: the start reads the folder (`first-setup-backup-entry.ts:77-93`) and serves the
   repair app instead.
3. `node-entry.test.ts`: change "a start that did not move hands the boot no spare folder"
   (`:2348`) to "a start reached through a link hands the boot no spare folder" (do NOT `realpath`
   the folder). Fails today: a moved start sets `WAITRON_SPARE_SPACE_DIR` (`node-entry.ts:438`).

**Change:**
- `first-setup-workspace.ts`: the `LEGACY_NAMES` entry and comment (D2).
- `node-entry.ts`: delete the import and call of `resolveFirstSetupBackupEntry` (`:70,348-349`), the
  repair-stage clean-up (`:350-362`), the repair/selected branches of `space`, of
  `deleteOldBackupsAtStart` and of `releaseSpareToStart` (`:363-393`: one `freeSpaceAtStart` on
  `deps`' folders with `logDir: deps.logDir ?? join(deps.stateDir, "logs")`, `deleteOldBackupsAtStart`
  always, `releaseSpareToStart(deps, deps)`), `WAITRON_SPARE_SPACE_DIR` (`:437-438`), the
  `backupEntry.kind !== "repair"` condition on the moved recheck (`:443`), and
  `onClose: admission.dispose` (`:420,538`). `discardedCopy` stays for B4.
- `first-setup-entry.ts`: `resolveFirstSetupEntry` calls `refusedAtStart` then
  `resolveLegacyFirstSetupEntry` (`:65-97`); delete `emptyDiscardedRecovery` (`:244-283`) and its
  call (`:165`) and `refusedAtStart`'s `spare` parameter; `restartDeletesLogs` (`:107-132`) answers
  only from free space ("true below the floor, otherwise undefined"); `resolutionApp` loses
  `firstSetupBackupRecoveryFor`, `mountFirstSetupBackupApi` (`:358,371`) and `dispose` (`:421`).
  The spare middleware (`:359-369`) goes in B4 — keep it compiling here by passing it an object
  whose `runningInMemory` answers `false`, or move B4's spare deletion into this task if simpler
  (say which in the commit).
- `boot.ts`: delete `assertFirstSetupBackupBootTarget` (`:11,1075`); `backupRepairOnly` and the
  log-sink switch (`:1138-1142`: `log` uses `normalLogSink`); the `/setup-api/*` gate
  (`:1263-1294`), which only served the hand-off; `firstSetupBackupRecoveryFor`,
  `mountFirstSetupBackupApi` and the hand-off (`:40,42,1382-1398`); `stopWork: () =>
  backupRepair.dispose()` (`:1670`) becomes `() => Promise.resolve()` as at `:1805`; `spareDir`
  (`:1182-1184`) becomes `config.stateDir`.
- `start-space.ts`: delete `insideAny` (`:21-30`) and the `stagingLeftovers` option (`:56,106`),
  both without callers after this task (`git grep -n -w -E 'insideAny|stagingLeftovers'`).
- `first-setup-launch.ts`: unchanged except `onClose: admission.dispose` (`:112`) if `dispose` goes (D9).
- Tests: `first-setup-entry.test.ts` — delete the `vi.mock` of the old entry (`:41,48-51`) and the
  four `expect(resolveFirstSetupBackupEntry).not.toHaveBeenCalled()` checks with their `mockClear`
  (`:444,447,462,470,588,595,650,665`); the cases stay. `first-setup-entry.spare.test.ts` — delete
  `:103`, `:117`, `:130`, `:141`, `:150` (the discarded copy's emptying), `:189` (now the same as
  `:217`), `:196`, `:203` (the repair stage), `:224` (a selected recovery), `:250` (reading the
  stage throws); retitle `:217` "…says it does below the floor, whatever the log folder"; keep `:234`,
  `:241`; `:258`, `:274`, `:288`, `:301` go in B4 with the middleware. `node-entry.full-disk-order.test.ts`
  — delete the `vi.mock` (`:19-29`) and the `it.each(["repair", "selected"])` case (`:258`).
  `start-space.test.ts` — delete "with staging leftovers off, a start below the floor deletes rotated
  logs and old crash reports and leaves backup and restore staging alone" (`:180`) and "with staging
  leftovers off and room, deletes nothing" (`:195`). `boot.disk-full-wiring.test.ts` — delete "the
  spare's folder is WAITRON_SPARE_SPACE_DIR when it is set" (`:291`), "with WAITRON_SPARE_SPACE_DIR
  set, a marker in the state folder notes nothing" (`:310`), "with WAITRON_SPARE_SPACE_DIR set, the
  watch writes the spare back in that folder and deletes the marker there" (`:362`) and the
  describe's `spareDir` option. `first-setup-set-aside-lifetime.test.ts` — delete "recover from a
  backup after a Move" (`:48`) and its fixture import and mock (`:6,30`); the fresh-box placement
  after a Move stays covered by "lifetime: a restore placement leaves the moved files, and a backup
  naming one is refused" (`:229`).
**Checks:** the three red cases green; `pnpm --filter @waitron/provisioning exec vitest run
src/first-setup-workspace.test.ts`; `pnpm --filter @waitron/server exec vitest run
src/first-setup-resolution.boot.test.ts src/node-entry src/first-setup-entry src/start-space.test.ts
src/boot.disk-full-wiring.test.ts src/first-setup-set-aside-lifetime.test.ts src/connection-bootstrap.entry.test.ts
src/first-setup-workspace.test.ts`, counts read; both typechecks (errors only in files B4/B5 delete).
**Commit:** "A box holding the repair page's old recovery folder now shows the reinstall page; the
start and the boot no longer look for it".

### Task B4 — delete the old recovery's server code, its routes and the spare and full-disk code that served its discard

**Delete:** the 8 server source files, the 22 `first-setup-backup*`/`setup-first-backup*`/
`discarded-copy` test files and the 3 fixtures listed above (the four Start-again files went in B2).
**Edit:**
- `apps/server/src/spare-space.ts`: delete `START_AGAIN_STEPS`, `releaseSpareBeforeStartAgain`,
  `discardable` (`:218-257`) and the imports `ABANDONABLE_BACKUP_PHASES`,
  `createFirstSetupBackupWorkspace`, `isEmptiedTombstone`, `START_AGAIN_ROUTES`; its caller
  `first-setup-entry.ts:359-369` goes (`git grep -n releaseSpareBeforeStartAgain`).
  `apps/server/src/spare-space.test.ts`: delete `describe("releaseSpareBeforeStartAgain")` (`:500` to
  the end, 15 cases). `first-setup-entry.spare.test.ts`: delete `:258`, `:274`, `:288`, `:301`.
- `apps/server/src/recovery-surface.ts`: delete `discardedCopyBytes` (`:47-48`), `readDiscardedCopy`,
  `discardedCopyLine` (`:192-208`) and their use (`:251,293`); `apps/server/src/i18n/recovery-page.ts`:
  `discardedCopy` (`:55,79-80,103-104`). `node-entry.ts`: `discardedCopyBytes` import and every
  `discardedCopy` use (`:32,448-449,463,545,582-590,615-617`). Tests:
  `recovery-surface.test.ts` delete `:1111`, `:1122`, `:1129`, `:1140`, `:1156` (the discarded-copy
  line); `node-entry.test.ts` delete the `vi.mock` (`:38-40`) and `describe("a discarded recovery's
  copy on the recovery-level page")` (`:2437-2469`, 2 cases).
- `apps/server/src/start-full-disk.e2e.test.ts`: delete `:810`, `:871`, `:950` (a discarded
  recovery on a full disk) and their helper (`:730-760`, `DISCARDED_ID`) with the import (`:53`);
  keep `:971` (the fresh-box restore's own staged copies). `start-again-full-disk.e2e.test.ts`:
  delete `:139`, `:174` (a stopped recovery on a full disk); convert `:211` to "on a full disk,
  Continue's password step answers 507 storage.disk_full" with a held database and no recovery;
  delete the old-entry and source mocks and imports (`:19-31`).
- `apps/server/src/cloud-recovery.ts`: delete `reconcileRestored` (`:607-630`). Tests: delete
  `describe("checked committed-target reconciliation")` (`cloud-recovery.test.ts:607`) and
  `describe("checked v2 committed-target reconciliation")` (`cloud-recovery-v2.test.ts:712`); drop
  `reconcileRestored` from the client fakes in `setup-api.cloud-recovery.test.ts:41` and
  `setup-api.recovery-input.test.ts:40`.
- `apps/server/src/first-fiscal-evidence.ts`: delete `readFirstFiscalEvidenceSnapshot`,
  `PUBLIC_RECORD_LIMIT`, `publicRecordBytes` (`:83-102`); `first-fiscal-evidence.test.ts`: delete
  "the strict read of a well-formed public record answers this module's entries, and of no record
  nothing" (`:392`) and "the strict read of a public record holding %s is refused
  setup.attempt_invalid" (`:400`, 5 rows), and the `snapshot` helper if unused.
- `apps/server/test-durations.json`: delete the 30 rows (lines 370, 428-448, 467-470, 964-965).
- `scripts/backup-room-note.test.ts`: delete the two CO_NAMERS rows for
  `first-setup-backup-recovery.ts` and `first-setup-backup-source.ts` (`:42-45`).
- `scripts/spare-space.test.ts`: `releaseSpare`'s allowed list drops `first-setup-entry.ts` (`:36`);
  the file comment (`:2-9`) drops "the start's emptying and the repair host (`first-setup-entry.ts`)
  release it" and "`releaseSpareBeforeStartAgain`"; the pattern drops `releaseSpareBeforeStartAgain`
  (`:34`); the synthetic cases `:128-151` use `node-entry.ts` for the allowed `releaseSpare` text and
  keep `first-setup-entry.ts` as a refused place.
**Checks:** `git grep -n -E 'first-setup-backup|setup-first-backup|discarded-copy|discardedCopy|releaseSpareBeforeStartAgain|reconcileRestored|readFirstFiscalEvidenceSnapshot' -- apps scripts`
prints nothing outside `docs`; `pnpm --filter @waitron/server typecheck`, `lint`;
`pnpm --filter @waitron/server exec vitest run src/spare-space.test.ts src/recovery-surface.test.ts
src/node-entry src/first-setup-entry src/start-full-disk.e2e.test.ts src/start-again-full-disk.e2e.test.ts
src/cloud-recovery src/setup-api.cloud-recovery.test.ts src/setup-api.recovery-input.test.ts
src/first-fiscal-evidence.test.ts src/boot.test.ts` (the full-disk files need `WAITRON_FULL_DISK_DIR`
on Linux; on macOS they make their own image: say which ran and which skipped);
`pnpm exec vitest run scripts/spare-space.test.ts scripts/backup-room-note.test.ts
scripts/vitest-duration-sequencer.test.mjs`. Prove the spare guard still bites: add a
`releaseSpare` import to `first-setup-entry.ts` → the guard fails; restore.
**Commit:** "Delete the repair page's old recovery from backup: its code, routes, tests, and the
spare-file and full-disk code that served its discard".

### Task B5 — provisioning deletes the recovery folder's workspace and discard

**Delete:** the 2 provisioning source files and 6 test files listed above.
**Edit:**
- `packages/provisioning/src/index.ts:244-260`: the two export blocks and the `BackupRepair*` types.
  Callers before deleting (`git grep -n -w -E 'createFirstSetupBackupWorkspace|resolveFirstSetupBackupWorkspace|assertFirstSetupBackupBootTarget|ABANDONABLE_BACKUP_PHASES|abandonedRecoveryBytes|emptyAbandonedBackupRecovery|isEmptiedTombstone|BackupRepairTarget|BackupRepairRecord|BackupRepairObservation|BackupRepairPhase|insideBackupRepairTarget' -- apps packages`)
  must print only the files this task edits or deletes.
- `first-setup-start-again-deletion.ts`: delete the imports (`:25-28`), `BACKUP` and `POINTER`
  (`:40-41`), the `discarding` option (`:86-91`), `backupRecoveryKept` (`:255-279`),
  `venuePointerOnly` (`:281-298`), their uses in `itemsOnDisk` (`:331-339,346`: every
  `first-setup-resolutions/<name>` must be a uuid record, and the folder is always deleted) and in
  `assertStartAgainAllowedOnDisk` (`:543-544` the target check; `:550` the venue-pointer exception).
- `first-setup-start-again-confirmation.ts`: delete `StartAgainSummary.recovery`,
  `StartAgainRecoveryShown`, `recoveryShown` (`:17-28,75-91`); `database` is `"missing" |
  "unreadable"`; the `present` rule (`:115-116`) and `recovery` copy (`:135`) go.
- `errors.ts:36-38`: delete `setup.recovery_discarded` and `setup.recovery_in_progress`.
- `first-setup-state.ts:152-153`: delete the comment's second line's reason; keep the literal
  `"first-setup-deleting.json"`.
- Tests: `first-setup-start-again-deletion.test.ts` delete `:128`, `:147`, `:160`, `:170`, `:184`,
  `:205`, `:218`, `:228`, `:241`, `:251`, `:310`, `:322`, `:337`, `:352`, `:367` (tombstones,
  pointers and `discarding`) and `:411` if it reads a recovery folder only; `first-setup-start-again-marker.test.ts`
  delete "folders inside a backup recovery's target are refused" (`:805`);
  `first-setup-start-again-confirmation.test.ts` delete "a confirmation that showed a stopped backup
  recovery keeps it, and only its keys" (`:255`) and "a record with the database present is written
  when it showed a stopped backup recovery" (`:296`), and change "a record with the database present
  that showed no backup recovery is refused setup.attempt_invalid and writes nothing" (`:305`) to "a
  record with the database present is refused setup.attempt_invalid and writes nothing" (the
  refusal stays; its reason narrows).
- Server: `apps/server/test/start-again-deleted.ts` — `LEFT_STATE` (`:113`) loses the
  `first-setup-resolutions/backup-recovery/…` alternatives, and `DELETED.state`'s
  `first-setup-resolutions` (`:28`) stays (A731's record folder); `start-again-held-fixture.ts`'s
  `LEFT_VENUE` comment (`:181-182`) drops "the discarded recovery's journal pointer, records and its
  target's lock files".
- Guards: `scripts/spare-space.test.ts` drops `first-setup-backup-workspace.ts` from the two allowed
  lists (`:28,45`) and its synthetic row (`:136`); `scripts/start-again-records-writers.test.ts`
  drops it from `ALLOWED` (`:23`); `scripts/backup-room-note.test.ts` drops its CO_NAMERS row
  (`:65-66`).
**Checks:** `pnpm --filter @waitron/provisioning typecheck`, `lint`; `pnpm --filter
@waitron/provisioning exec vitest run src/first-setup-start-again src/first-setup-workspace.test.ts
src/first-setup-state.test.ts`; `pnpm --filter @waitron/server typecheck`;
`pnpm --filter @waitron/server exec vitest run src/first-setup-start-again src/held-setup-database.test.ts`;
`pnpm exec vitest run scripts/spare-space.test.ts scripts/start-again-records-writers.test.ts
scripts/backup-room-note.test.ts scripts/errors-reachable.test.ts`; then
`pnpm --filter @waitron/provisioning test:coverage` once (with `env -u AI_AGENT -u CLAUDECODE -u
CLAUDE_CODE_CHILD_SESSION`, as slice 2's ledger found the Stripe hint line breaks 7 built-command
tests under them) and read its per-file table. Prove the records guard still bites: name
`START_AGAIN_CONFIRMATIONS_DIR` in a new provisioning file → it fails; delete the file.
**Commit:** "Provisioning: delete the old recovery's folder, fingerprint and discard; Start again's
contract loses the recovery".

### Task B6 — PR B's docs and backlog

Root `CLAUDE.md` is format-checked and goes through this pull request.

- **`CLAUDE.md:486-491`** — "Within the server, only the start (on a nearly full disk, before
  first-setup resolution), its emptying of a discarded recovery and the repair page's Start-again
  flow delete `<state>/spare-space` (`waitron.sh reset` deletes it too); a release writes
  `spare-space.released` (exceptions in the topic file), which holds the till stop, across restarts,
  until the spare is written back whole. It is never venue data, and a recovery's originals walk
  leaves both out." → "Within the server, only the start (on a nearly full disk, before first-setup
  resolution) deletes `<state>/spare-space` (`waitron.sh reset` deletes it too); a release writes
  `spare-space.released` (exceptions in the topic file), which holds the till stop, across
  restarts, until the spare is written back whole. It is never venue data." Guard line unchanged.
- **`docs/developers/conventions-data.md`**:
  - `:3122-3130`, the paragraph "A discarded backup recovery keeps its lock files. …" — delete.
  - `:3387-3389` "so that, on a nearly full disk, it still has the room to start and to take the
    venue locks that freeing a backup recovery's copy needs. Within the server, three paths delete
    it, all through `releaseSpare`:" → "so that, on a nearly full disk, it still has the room to
    start and take the venue locks. Within the server, one path deletes it, through `releaseSpare`:".
  - `:3394-3395` delete "Never at a backup recovery's repair stage."; delete the two bullets
    `:3396-3399` (the emptying, and the repair host before the four requests).
  - `:3401-3403` "(`apps/server/src/start-backup-room.ts`, called at `apps/server/src/node-entry.ts:375`,
    the release at `:389`), except at a backup recovery's repair or selected stage." → "(`apps/server/src/start-backup-room.ts`,
    called by `runEntry` just before the release)."
  - `:3408-3410` "and the backup recovery's originals walk (`packages/provisioning/src/first-setup-backup-workspace.ts`)
    leaves it and its marker out, so writing or deleting either cannot refuse a resume." → delete;
    the sentence ends at "never backed up, exported or streamed."
  - `:3414` "so every one of the three paths leaves it" → "so the start's release leaves it".
  - `:3453-3456`, "The spare's folder after a start from a selected backup recovery. …" — delete (D5).
  - Under `### Spare file release and recovery` (`:5667`) and `### Spare file deletion and release`
    (`:5784`), dated historical copies of the root rule: add one line each, "_2026-11-04, A1131bc
    slice 4: the discarded recovery's emptying, the repair page's release and the originals walk are
    deleted; the root rule now names the start alone._" — not a rewrite (`CLAUDE.md` §6, historical
    docs).
  - The spare guard's limits paragraph after `:3466`: check every file it names still exists.
- **`docs/developers/conventions-ui.md`**:
  - `:48-49` (an example from an audit at a fixed commit): add after it "_2026-11-04, A1131bc slice
    4: `first-setup-backup-source.ts` is deleted; that cause of `setup.not_ready` is gone._"
  - `:1177-1179` delete "— in the folders a backup recovery from the setup repair page selected
    instead, when there is one"; `:1181-1182` delete "(a start at a backup recovery's repair stage
    only when the logs folder, followed through links, is inside neither the state folder nor the
    venue folder; …)" keeping the `start-space.ts` pointer, and ", and never at the repair stage,";
    `:1183` delete "or the folders the start goes on to run from are (a selected backup recovery's),".
  - `:1190-1193` delete "; while a discarded recovery's copy is still there, one more line names its
    size (`discardedCopyBytes`, `apps/server/src/discarded-copy.ts`); the ordinary recovery page shows
    the same line when the failure it recorded is `storage.disk_full`".
  - `:1300-1301` delete "A backup recovery's check of the box's files skips `first-setup-set-aside`
    in each root (`originals`, `packages/provisioning/src/first-setup-backup-workspace.ts`)."
- **`docs/developers/testing-guide.md:1462-1477`** — "runs the repair page's Start-again flow beside
  a stopped backup recovery on a full disk: with the box's spare file the flow works and the spare
  is gone; without it Continue's password step (`/recover`) answers `507 storage.disk_full`. Beside
  a held setup database with no recovery the spare is not released, so the summary and Start again
  answer `507 storage.disk_full` and delete nothing. It builds its stopped recovery from the A731
  fixture, whose module-level hooks must not run in `start-full-disk.e2e.test.ts`, so it is a file of
  its own, and two files filling one filesystem at once could fail each other:" → "runs the repair
  page's flows on a full disk beside a held setup database: Continue's password step (`/recover`)
  answers `507 storage.disk_full`, and the summary and Start again answer `507 storage.disk_full`
  and delete nothing, since nothing releases the spare there. Its held-database fixture's hooks must
  not run in `start-full-disk.e2e.test.ts`, so it is a file of its own, and two files filling one
  filesystem at once could fail each other:" (re-read the fixture first: if its hooks no longer
  conflict, say only the second reason). `:1477` "as the discarded-recovery case without a spare
  does" → delete the clause.
- **`docs/developers/ci-and-gates.md:1838-1848`** (a measurement history): add "_2026-11-04, A1131bc
  slice 4: `first-setup-start-again-backup.test.ts`, `first-setup-backup-lease.test.ts` and
  `setup-first-backup-api.test.ts` are deleted with the old recovery._"
- **`deploy/README.md`**:
  - `:335-337` delete "While a recovery that Start again discarded still holds its copy, it also
    names that copy's size; the ordinary recovery page shows the same line when the failure it
    recorded is `storage.disk_full`."
  - `:353-354` delete "It never does this at a backup recovery's repair or selected stage."
  - `:356-361` "It is not venue data, and a backup recovery's check of the box's files leaves it out.
    Within the server, three steps delete it: a start, after the clean-up above and before it reads
    the setup state, when the state folder or the database's folder has under 8 MiB free, or under
    16 MiB after a start that failed on a full disk (never at a recovery's repair stage); a start that
    finds a backup recovery Start again discarded, under 16 MiB free, just before it deletes that
    recovery's copy; and the setup repair page, under 16 MiB free, before the steps of Start again
    beside a stopped or discarded recovery." → "It is not venue data. Within the server, only a start
    deletes it: after the clean-up above and before it reads the setup state, when the state folder
    or the database's folder has under 8 MiB free, or under 16 MiB after a start that failed on a
    full disk."
  - `:425-428` "one small record for each Start again confirmed while the venue database was missing
    or partly unreadable, or that discarded a stopped backup recovery:" → "one small record for each
    Start again confirmed while the venue database was missing or partly unreadable:".
  - Search the rest of the file for "recovery Start again discarded", "repair stage", "selected stage".
- **`apps/server/README.md:47-56`** — "ownership recovery with the setup password, recovery from a
  backup (under `/setup-api/first-setup/resolution/backup/`), which the setup page no longer starts,
  Start again and publication-only Finish (`apps/server/src/setup-first-fiscal-api.ts`,
  `setup-first-backup-api.ts`)." → "ownership recovery with the setup password, Start again and
  publication-only Finish (`apps/server/src/setup-first-fiscal-api.ts`)."; "with it partly
  unreadable, or when it discards a stopped backup recovery, it needs the summary the page showed
  sent back unchanged" → "with it partly unreadable, it needs the summary the page showed sent back
  unchanged".
- **`docs/operations/first-live-fiscal-setup.md`** (the paragraph A6 kept) — "when the venue database
  is missing, when part of it cannot be read, or when a stopped recovery is discarded. … with
  `database` set to `missing`, `present` or `unreadable`." → "when the venue database is missing or
  part of it cannot be read. … with `database` set to `missing` or `unreadable`."
- **`docs/operations/hour-recovery.md`**, at the end of "Recover while first setup is blocked"
  (after `:91`), add: "A box that still holds a recovery from backup begun on the repair page by a
  Waitron from before November 2026 does not start: its page says the box holds a setup from an
  older version of Waitron and asks for Waitron to be reinstalled (`setup.workspace_unsupported`).
  Reinstalling deletes the backups kept on the box, so keep the backup you will restore from
  somewhere else first." Receipt for the last sentence: run `pnpm exec vitest run
  scripts/waitron-sh.test.mjs -t "removes the transient volumes"` and quote its count in the commit.
  `docs/operations/backups-and-support.md`: searched (`/usr/bin/grep -n -i -E 'repair|discard|stopped|journal'`),
  no sentence becomes false; unchanged.
- **Backlog deleted (finished or moot), each with its line in `docs/backlog.md`:**
  - `setup.md:425-435` "A start from a selected backup recovery cleans the recovery's own logs, not
    the box's" (`backlog.md:562-565`): no selected stage.
  - `setup.md:437-445` "A resume can use the room the spare file gave" (`backlog.md:567-569`): no
    release beside a recovery, no `open`.
  - `setup.md:478-498` "A discarded recovery whose files cannot be deleted brings the repair page
    back after each Start again" (`backlog.md:591-593`): no discard.
  - `setup.md:619-642` "A1131: Start again beside a recovery record that cannot be read, with the
    setup database missing" (`backlog.md:655-657`): the case cannot arise; the entry itself says
    slice 4 closes it.
  - `setup.md:660-667` "A stale signed-in setup tab's activation request is not refused while a
    Waitron Cloud recovery waits" (`backlog.md:635-638`): no recovery waits.
  - `setup.md:669-679` "A recovery that Start again recorded as discarded can still be resumed after
    a power cut" (`backlog.md:640-643`): no `open` or `resume`.
  - `setup.md:753-760` "A developer note still counts four requests in the Start-again flow"
    (`backlog.md:668-669`): the spare release and its comment are deleted, the conventions-data
    sentence is deleted above, and `START_AGAIN_ROUTES`' comment was reworded in B2.
  - `setup.md:763-780` "A1131c: Recover from backup first wipes the failed setup…"
    (`backlog.md:650-653`): slice 4 finishes it. Its decision lines under `## Decisions and deliberate
    limits` (`setup.md:872-891`) stay, each gaining "(2026-11-04, A1131bc slice 4: the old recovery
    code is deleted.)".
  - `backlog.md:6066-6069` "The resume-authority test's ciphertext damage can leave the value
    unchanged": its file is deleted.
  - `replication-cloud.md:820-821` "The staged node copy is hashed twice in the staging digest
    (`first-setup-backup-recovery.ts`, `fingerprint()`)": the file is deleted.
- **Backlog rewritten (stale):**
  - `setup.md:681-692` (and `backlog.md:645-648`) "A Waitron Cloud recovery whose download takes
    more than 30 seconds…": its measurement held the OLD recovery's commit step, which is deleted.
    Rewrite to say that, and that the fresh-box Cloud restore has not been measured the same way;
    next step: hold the fresh-box Cloud restore's download past 30 seconds in
    `apps/server/test/hour-recovery-host.ts` and see whether the series name is refused.
  - `setup.md:694-702` "A1223": delete the sentence "The setup-from-backup restore reuses its stored
    attempt when reopened (`apps/server/src/first-setup-backup-recovery.ts:893-899`), so a reload
    does not start one; …" through "(#1990, `3ba85c7a6`)."
  - `setup.md:644-658` (and `backlog.md:659-661`) "On a full disk, Start again's summary may need
    room…": "the box gives the spare up before a Start-again step only when a stopped recovery is to
    be discarded (`releaseSpareBeforeStartAgain`, `apps/server/src/spare-space.ts`)" → "no step of
    the repair page gives the spare up"; `backlog.md:660` "Beside a held setup database with no
    recovery the box keeps its spare" → "The box keeps its spare beside a held setup database".
  - `setup.md:447-454` "The spare file's size is measured on HFS+ and Linux tmpfs only": delete
    ", which the repair-stage log clean-up assumes when it deletes logs to make room"; its A1127
    measurement sentence is history and stays.
  - `backlog.md:742-745` "The setup route `GET /setup-api/venue-defaults` has no production reader":
    "Retiring it means moving `apps/server/src/first-setup-backup-handoff.test.ts`'s paused-API probe
    to another setup GET and removing the route's two direct cases" → "Retiring it means removing the
    route's two direct cases".
  - `self-service-refusals.md:539` delete "a Cloud recovery dependency is absent
    (first-setup-backup-source.ts:40),".
  - `ci.md:1186` delete "and the re-seal at `setup-first-backup-api.test.ts:84`" (adjust "still
    draw").
  - `architecture.md:1101-1102` delete `first-setup-backup-recovery`, `first-setup-backup-source`
    from the list of suites (the suites are gone).
- **Backlog added:** in `setup.md` and `backlog.md`, "`restoreFromArtifact` has no production
  caller" — since A1131bc slice 4 only tests call it (13 files); decide whether they should place
  archives through `runStagedRestore` instead, then delete it (D6).
- Historical records left as they are (they record a run or a dated state): `docs/backlog/ci.md`
  tables `:1222-1245`, `docs/backlog/box.md:1257`, `docs/backlog/fiscal.md:1070`,
  `docs/operations/a679-changed-checks.md`, `a682-changed-checks.md`.
- Spec: add one dated line at the top of the design: "2026-11-04, slice 4 plan: built in two pull
  requests, the setup page first (the page read the old routes on every open)."
**Checks:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/guide-links.test.ts
scripts/spare-space.test.ts`; `pnpm exec prettier --check CLAUDE.md`; `pnpm format:check`;
`git grep -n -E 'first-setup-backup|setup-first-backup|discarded-copy|backup-recovery/|releaseSpareBeforeStartAgain|WAITRON_SPARE_SPACE_DIR' -- . ':!docs/superpowers' ':!docs/backlog/ci.md' ':!docs/operations/a6*'`
prints only the dated lines added above. **Commit:** "Docs and backlog: the repair page's old
recovery from backup is gone".

### Task B7 — PR B's final checks

- Fiscal gates, unedited: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/write-path.e2e.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  inmutabilidad`; `git diff --stat origin/main -- packages/fiscal-verifactu` prints nothing.
- No migration: the `git diff --stat` in the header prints nothing.
- Typecheck and lint, exit status read for each: server, provisioning, setup.
- Root guards: `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/spare-space.test.ts
  scripts/backup-room-note.test.ts scripts/start-again-records-writers.test.ts
  scripts/backup-staging-touchers.test.ts scripts/personal-log-params.test.ts
  scripts/alert-codes.test.ts scripts/module-seams.test.ts scripts/claude-md-pointers.test.ts
  scripts/vitest-duration-sequencer.test.mjs scripts/ci-workflow.test.mjs`.
- `pnpm --filter @waitron/server exec vitest run src/first-setup src/start-again src/recovery-start-again
  src/node-entry src/boot.test.ts src/first-fiscal-hour` (the slice 2 checkpoint's set), count read.
- `/finish-branch` FULL (two Codex angles) with a note naming this plan; the PR description carries
  D3, D4 (now over), D5, D6, the readers table and the changed-checks table. Coverage is CI's: read
  `test-server`'s merge job and `test-provisioning` on the head (98/98/98/95).

---

## Changed checks

Whole files deleted are listed under "Files to delete" with their reason; this table lists every
case deleted from or changed in a file that stays. "Old path" means the case's subject exists only
with the repair page's old recovery.

| File | Case (line) | Change | Why |
| --- | --- | --- | --- |
| `apps/setup/src/start-again-wipe.test.ts` | "a stopped recovery and a damaged recovery-key record send confirmRecoveryDiscard and recoveryRecordDamagedShown together" (206) | replaced by "a summary carrying recovery is refused as unreadable" | `recovery` leaves the summary (D10) |
| `apps/setup/src/setup-app-resolution.test.ts` | the words test (~120) | gains the removed keys | §9e strings deleted |
| same | 969, 1104, 1167, 1174, 1216, 1241, 1308, 1326, 1352, 1384, 1397, 1420, 1629, 1660, 1694, 1706, 1734, 1757; `recovery_in_progress` rows at 1274, 1603, 1638 | deleted | old path: running/stopped recovery, activity read, Check again |
| same | 1141, 1511, 1564, 1867, 1876, 1884 | setup loses the stopped recovery; assertion kept; retitled | the damaged-record line, the confirmation words, the trading-settings refusal and the disk-full words survive |
| `apps/setup/src/setup-app-resolution.a11y.test.ts` | "stopped recovery" states (201) | deleted | old path |
| `apps/setup/src/setup-app-resolution.unsaved.test.ts` | 52 (its `setup-first-backup` check, 75) | check replaced by "no request under /resolution/backup/" | the element no longer exists, so the old check would pass vacuously |
| `apps/setup/src/setup-app-missing-database.test.ts` | 326, 340, 356, 505, 524, 549, 564, 578, 607, 626, 647, 665, 672, 686, 715, 757, 772, 791, 814, 863, 891, 926, 958, 974; the `/backup/status` row of 387; the `recovery_discarded` and `recovery_in_progress` rows (697-711, 897-947) | deleted | old path; the two codes are deleted (D11) |
| `apps/setup/src/setup-app-missing-database.a11y.test.ts` | "backup-recovery lines" states (110) | deleted | old path |
| `apps/setup/src/setup-app-wipe.test.ts` | 132, 181, 377 | deleted | running, stopped, unnamed journal |
| same | new: "the repair page sends nothing under /resolution/backup/…" | added, red first | the removal's proof |
| `apps/setup/src/setup-app-recover.test.ts` | 204, 282, 302, 344, 465 | deleted | old path |
| same | 55 (its `setup-first-backup` check, 49) | check replaced as above | vacuous after A5 |
| `apps/setup/src/setup-app-recover.a11y.test.ts` | stopped states | deleted | old path |
| `apps/setup/src/setup-app-held-refusals.test.ts`, `setup-app-held-database.a11y.test.ts` | 90, 106, 128; 35, 77 | retitled; fixture has no recovery | held refusals do not depend on a recovery since slice 2 |
| `apps/server/src/held-setup-database.test.ts` | 82 | deleted | the option is gone |
| same | 38, 58, 64, 73 | `liveness()` assertion deleted; 38 retitled | old path |
| `apps/server/src/first-setup-start-again-held.test.ts` | 19 | deleted | the summary naming the recovery |
| `apps/server/src/first-setup-start-again-held-recovery.test.ts` | 32 | deleted | a discard's `present` record |
| same | 50 | discard key dropped; "one record, database present" → "no record" | a present database writes no record without a discard (`first-setup-resolution.ts:470`) |
| same | 70, 92, 118, 203, 217, 231 | discard key dropped from the send | refusals unchanged |
| `apps/server/src/first-setup-start-again-held-damaged.test.ts` | 80, 109 | deleted | old path |
| `apps/server/src/first-setup-start-again-held-wipe.test.ts` | 154 | deleted | old path |
| `apps/server/src/start-again-full-disk.e2e.test.ts` | 139, 174, 252 | deleted | old path / the release it tested is deleted |
| same | 211 | held database, no recovery; retitled "on a full disk, Continue's password step answers 507 storage.disk_full" | Continue's refusal survives |
| `apps/server/src/first-setup-start-again.test.ts` | 712, 756 | "takes … only in its exact shape" → "refuses … as setup.request_invalid 400" | the keys leave the contract (D10); refusal kept |
| same | rows "A731's repair open", "A731's resume" (1728-1851); 1853 | deleted | old routes |
| same | new: "with the database missing, a confirmation record that cannot be written deletes nothing and writes no marker" | added (port of `…-backup-discard.test.ts:784`) | surviving behaviour kept |
| `packages/provisioning/src/first-setup-workspace.test.ts` | it.each (27-47) | two rows added; new pass case for `first-setup-resolutions/<id>/` | the refusal (D2) and its negative control |
| `apps/server/src/first-setup-resolution.boot.test.ts` | new "a box holding the repair page's old recovery folder serves the reinstall page…" | added, red first | design decision |
| `apps/server/src/node-entry.test.ts` | 2348 | "did not move" → "reached through a link" | D5, red first |
| same | describe 2437 (2 cases) | deleted | the discarded-copy line |
| `apps/server/src/node-entry.full-disk-order.test.ts` | it.each repair/selected (258) | deleted | no stages |
| `apps/server/src/first-setup-entry.test.ts` | the `resolveFirstSetupBackupEntry` not-called checks (444-447, 462-470, 588-595, 650-665) | deleted; cases kept | their subject is deleted |
| `apps/server/src/first-setup-entry.spare.test.ts` | 103, 117, 130, 141, 150, 189, 196, 203, 224, 250, 258, 274, 288, 301 | deleted | emptying, stages, the repair host's release |
| same | 217 | retitled "…says it does below the floor, whatever the log folder" | only free space decides now |
| `apps/server/src/start-space.test.ts` | 180, 195 | deleted | `stagingLeftovers` has no caller |
| `apps/server/src/boot.disk-full-wiring.test.ts` | 291, 310, 362 | deleted | D5 |
| `apps/server/src/first-setup-set-aside-lifetime.test.ts` | 48 | deleted | old path; 229 covers the fresh-box placement |
| `apps/server/src/spare-space.test.ts` | describe 500 (15 cases) | deleted | release beside a recovery |
| `apps/server/src/recovery-surface.test.ts` | 1111, 1122, 1129, 1140, 1156 | deleted | the discarded-copy line |
| `apps/server/src/start-full-disk.e2e.test.ts` | 810, 871, 950 | deleted | the discarded copy at start |
| `apps/server/src/cloud-recovery.test.ts` / `cloud-recovery-v2.test.ts` | describes 607 / 712 | deleted | `reconcileRestored` (D7) |
| `apps/server/src/setup-api.cloud-recovery.test.ts`, `setup-api.recovery-input.test.ts` | client fakes (41, 40) | `reconcileRestored` dropped | D7 |
| `apps/server/src/first-fiscal-evidence.test.ts` | 392, 400 (5 rows) | deleted | D7 |
| `packages/provisioning/src/first-setup-start-again-deletion.test.ts` | 128, 147, 160, 170, 184, 205, 218, 228, 241, 251, 310, 322, 337, 352, 367 (and 411 if it reads a recovery folder only) | deleted | tombstones, pointers, `discarding` |
| `packages/provisioning/src/first-setup-start-again-marker.test.ts` | 805 | deleted | `insideBackupRepairTarget` |
| `packages/provisioning/src/first-setup-start-again-confirmation.test.ts` | 255, 296 | deleted | `recovery` and `present` |
| same | 305 | retitled; refusal kept | `present` is refused outright now |
| `scripts/spare-space.test.ts` | allowed lists and synthetic rows | narrowed (B4, B5) | allowed files deleted or no longer releasing |
| `scripts/backup-room-note.test.ts`, `scripts/start-again-records-writers.test.ts` | rows for deleted files | deleted | files deleted |

An implementer who finds another red case applies the global rule (delete if old path, convert if
its subject survives), adds a row here in the same commit, and names it in the commit message.

---

## Open questions for the owner

None. The design settles the reinstall page and the absence of conversion code. D4's in-between
state lasts only between the two merges and touches only a box that began an old recovery before
2026-10-31; it is stated in both pull requests rather than asked.

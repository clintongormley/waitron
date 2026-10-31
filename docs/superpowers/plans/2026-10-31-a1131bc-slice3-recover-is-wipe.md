# A1131b/c slice 3: Recover from backup becomes the wipe — Implementation Plan

> **For agentic workers:** the lead codes this plan INLINE, task by task, test first
> (superpowers:executing-plans). Built on the FULL review path: it is fiscal-adjacent, because it
> changes which restore the repair page leads to. A fresh per-task reviewer runs after Task 2a and
> after Task 3, then `/finish-branch`, which on a risk-trigger branch runs two Codex run-it reviews
> from different angles. Every task is sized well under 100 tool calls; past about 150 calls, stop
> at a passing or cleanly red point, commit, and hand over. Steps use checkbox (`- [ ]`) syntax.
> Update the ledger at the end of every task.

**Goal:** on the repair page, **Recover from backup** runs the same wipe as Start again, behind
§9b's confirmation (picture 2) and the same refusals (picture 3). After the box restarts,
Reconnect opens the setup page's "Join or recover an existing restaurant" screen, where the
ordinary fresh-box restore takes over. The repair page no longer opens the old repair-page
recovery for a new recovery.

**Architecture:** this is almost entirely a setup-page change. `#openWipeConfirmation` and the
send take a `kind` (`"start-again"` or `"recover"`). The confirmation draws that kind's words. A
successful send records the kind in memory, and `#reconnectFirstSetup` reads it when the box
answers that no setup is left. The page's route to the old recovery screen is deleted. The server
gets no source change: it receives the same request from either button. Task 0 adds one server
test that pins the restore after a missing-database wipe. No file in `packages/` changes, and
nothing adds a migration.

**Tech Stack:** TypeScript, Lit, Vitest 4 (real headless Chromium for `apps/setup`; node for
`apps/server`).

**Spec:** `docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md`. This plan
covers "Slices" item 3, §1 step 3, §9b, §9c as seen from Recover, the §1a sentence "Recover from
backup is no longer offered beside … any other row marked refused", and "Open, not measured":
"Carrying 'go to Join or recover' across the restart". The dated note at the spec's top retires
§9b's help line. Slice 2's plan
(`docs/superpowers/plans/2026-10-29-a1131bc-slice2-one-wipe-no-password.md`) is the template and
built the wipe this plan calls.

**Worktree / branch:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a1131bc-3-recover-is-wipe`,
`feat/a1131bc-3-recover-is-wipe`, on main 4c5ba38db (slice 2, #2323). Ledger:
`docs/handoffs/2026-10-31-a1131bc-slice3.md` (gitignored). The ledger records each task's commit,
the `Tests` count read, and every test edited by design (old → new).

**Resume:** nothing built. Next: Task 0.

Every file:line below was read on 4c5ba38db unless marked "run".

## Open questions for the owner (the default is planned)

- **OQ1 — Recover from backup beside a recovery begun before this version that stopped.** Today
  the page hides Recover from backup there (`apps/setup/src/setup-app.ts:2574`, `:2586`).
  - **Default (planned):** offer it. It runs the same wipe as Start again, so the stopped recovery
    is deleted with the setup, as Start again deletes it today. Inside Recover's confirmation the
    stopped-recovery line needs words that do not say "Start again": new key
    `recoveryStoppedRecover`. EN: "A recovery from backup started on {started} and did not finish.
    Recover from backup deletes it first." ES: «Una recuperación desde una copia, iniciada el
    {started}, no terminó. Recuperar desde una copia la borra primero.» Both are proposed here and
    land only once the owner approves them; the PR asks for that approval in its first lines.
  - Worked example: Marta's box shows "A recovery from backup started on 25 Oct 2026, 14:35 and did
    not finish. Start again deletes it." Under the default she presses **Recover from backup**. The
    page says the line above, then "Recover from backup first deletes what was entered in the setup
    that stopped part way. No invoice was sent to AEAT. Then you choose the backup." She ticks and
    confirms, the box restarts, and Reconnect opens "Join or recover". Under the alternative she
    sees only **Start again**. Pressing it lands her on the first setup screen, where she has to
    find "Join or recover" herself.
  - **Alternative:** keep Recover hidden there, as today. This needs no new words, and the five
    changed checks marked OQ1 below stay unedited.
- **OQ2 — Reloading the page between the wipe and Reconnect.**
  - **Default (planned):** the choice lives in the page's memory only. It survives Reconnect,
    including Reconnects pressed while the box is still restarting (experiment E1, case B). A
    reload or a closed tab forgets it, and the page then opens its first screen, where the person
    picks "Join or recover". That is what the spec's §6 already accepts after a power cut ("the
    ordinary setup page's first screen; the person picks 'Join or recover'"). It also keeps the
    page's rule that screens come "from in-memory state, never a URL route"
    (`setup-app.ts:80`).
  - **Alternative:** keep the choice in the tab's own storage, as the page already keeps its claim
    nonce (`apps/setup/src/first-setup-session.ts:146`). That would need its own expiry, and code to
    clear it on every other path.

## Notes for the PR (decided, not asked)

- **N1 — The old recovery's server routes stay until slice 4.** They are mounted at
  `apps/server/src/first-setup-entry.ts:371` and `boot.ts:1200`. Their `open` still begins a new
  recovery when no journal exists (`apps/server/src/first-setup-backup-recovery.ts:821-841`:
  `records.length !== 0` refuses only a second one, and a new id comes from `randomUUID()`). After
  this slice the page never calls `open`. Something could still call it until slice 4: a tab whose
  page was loaded from an earlier version, or a direct request that already has the backup's
  secrets. A server refusal of a new `open` is a small change the lead may add, but this plan does
  not, because the spec scopes slice 3 to the page ("the repair page stops opening the old
  recovery").
- **N2 — When the setup password cannot be checked, Recover from backup is no longer usable.**
  The setup record is unreadable, so the inspection has no `revision`
  (`packages/provisioning/src/first-setup-resolution-inspection.ts:362-364`). The wipe is then not
  offered (`wipeOffered`, `setup-app.ts:236-239`), and Recover is drawn disabled like Start again,
  beside `uncheckable` and `wipeUnavailable`. Today Recover opens the old recovery there (the test
  "opens independent backup repair with an %s setup password…", `uncheckable` row). The way out is a
  reinstall. The spec's own "For your information" covers this ("or a setup the box cannot show is
  safe to delete"), and the guide's sentence "You can use this route even if the old setup password
  cannot be checked." goes.
- **N3 — Start again's landing is corrected (D6).** Today Reconnect after a successful Start again
  opens the venue screen with no mode chosen (experiment E1, case A). The spec's §1 step 3 says "the
  page's first screen, as today". After this slice it opens the mode screen ("Set up this Waitron
  server").
- **N4 — What a box already inside an old recovery can still do.** See "Readers that keep working".
  In short: nothing reachable changes for those boxes, except that Recover from backup also
  discards a stopped recovery (OQ1).

## Global Constraints

- **Fiscal-adjacent.** Nothing changes in `packages/` (including `packages/fiscal-verifactu` and
  `packages/provisioning`), there is no migration, and `CLAUDE.md` is not edited. In `apps/server/`
  only `src/guide/{en,es}/backup-recovery.md`, `README.md` (one sentence, Task 6) and the new test
  in `src/first-setup-start-again-held.test.ts` (Task 0) change. Task 7 checks this with
  `git diff --stat`. These must pass UNEDITED in Task 7:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`,
  `… exec vitest run inmutabilidad` and `… exec vitest run huella`.
- **One wipe.** Recover sends exactly the request Start again sends for the same summary
  (`sendWipe`, `apps/setup/src/start-again-wipe.ts`): the same route, the same body and the same
  `confirm*` field. It never sends a field that says which button was pressed, and the server
  cannot tell the two apart.
- **The old recovery is not opened for a new recovery.** No page path mounts `setup-first-backup`,
  and no page request goes to `/setup-api/first-setup/resolution/backup/{open,resume,prepare,commit,close,renew,cloud/…}`.
  The page keeps its reads of `…/backup/status` and `…/backup/activity`, which show a recovery
  begun before this version.
- **Exact words** (keys in `apps/setup/src/screens/initial-owner-strings.ts`; spec §9b, split into
  three keys under D2):
  - `recoverDeletes` EN `Recover from backup first deletes what was entered in the setup that stopped part way.`
    ES `Recuperar desde una copia primero borra lo que se introdujo en la configuración que se detuvo a medias.`
  - `recoverThen` EN `Then you choose the backup.` ES `Después eliges la copia.`
  - `retireRecover` EN `Delete the old attempt and recover from a backup.` ES `Borrar el intento anterior y recuperar desde una copia.`
  - `recoveryStoppedRecover` (OQ1; proposed) EN `A recovery from backup started on {started} and did not finish. Recover from backup deletes it first.`
    ES `Una recuperación desde una copia, iniciada el {started}, no terminó. Recuperar desde una copia la borra primero.`
  - The paragraph is `${recoverDeletes} ${noInvoiceSent} ${recoverThen}` when the box read the
    database and found no invoice. Otherwise (database missing, or `databaseUnreadable`) it is
    `${recoverDeletes} ${recoverThen}`. That is §9b's rule ("The middle sentence follows (a)'s
    rule").
  - Reused without change: `recoverBackup` (the button, and Confirm's label in picture 2),
    `noInvoiceSent`, `missingConfirm` (the tick with the database missing), `setupDatabaseUnreadable`,
    `recoveryRecordDamaged`, `restarting`, `cancel`, every §9c refusal, `heldChanged`, and
    `role.heading` (`apps/setup/src/i18n/strings/start.ts:13`, `:136`).
  - **Not drawn:** §9b's help line ("This box will not use this setup's invoice series names
    again."). It is already absent from the code: A1206 removed it (90f41f490), and
    `rg "series names again" apps` finds nothing (run).
  - Refusal rule (CLAUDE.md §3, first bullet): Recover adds no refusal words of its own. It draws
    §9c's words, which already say what happened and what Reconnect or Continue does.
- Spanish appears only in `initial-owner-strings.ts` and `apps/server/src/guide/es/`.
- **TDD:** every behaviour test is written first and seen failing. The ledger records the failing
  title and the assertion it failed at. A test that passes before the change is proved by deletion:
  the plan names what to remove, the ledger records the failure, then the code is restored and
  `git diff --exit-code` is run on that file. Tests whose checks change by design are listed in
  "Changed test checks". Any other failing test is a STOP. Between tasks, only suites a task names
  as "red until Task N" may be red.
- **Commands.** Setup page (real Chromium): check `memory_pressure | /usr/bin/grep free` first, run
  beside another browser run only well above 15% free, and run
  `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/setup exec vitest run <files>`. Server:
  `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run <files>`.
  Root guards run from the worktree root: `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/<file>`.
  Read the `Tests` count every time, never an exit status alone.
- Commits use `git commit -s` with plain-English messages naming each test check changed by
  design. Do not push.

## Current behaviour (read, unless marked run)

- **Recover from backup goes to the old recovery screen.** Its button dispatches `setup-goto
  "first-backup"` (`setup-app.ts:2436-2444`), and the app renders `setup-first-backup` for that
  screen (`:2650-2655`). This is the only `"first-backup"` goto in the page: `rg '"first-backup"'
  apps/setup/src --glob '!*.test.ts'` finds `setup-app.ts:83` (the `Screen` type), `:992`, `:996`
  (leave-guard scopes in `#onGoto`), `:2442` and `:2650` (run).
- **Where it is drawn.** Before the summary is read it sits beside Start again, unless a stopped
  recovery is shown with the database present (`:2586`). In the missing-database ask it is drawn
  unless the summary names a stopped recovery (`:2574`), and is disabled for an `uncertain` journal.
  It is hidden while a recovery runs (`offersNothing`, `:2354`). It stays drawn beside a refusal and
  beside Start again's open confirmation (`:2586`).
- **The wipe flow** is `#openWipeConfirmation` (`:1389-1453`), `#readMissingAsk` (`:1343-1362`),
  `#startAgainFirstSetup` (`:1465-1502`, which calls `sendWipe` and then sets `firstRestarting`),
  `#cancelWipe` and `#closeWipe` (`:1377-1384`, `:1503-1507`), and the drawing in
  `#renderFirstOwner` (`:2343-2640`).
- **After a successful wipe** the page says `restarting` ("The old attempt is deleted. Reconnect to
  continue.") and draws Reconnect. `#reconnectFirstSetup` (`:1508-1559`) clears `firstRestarting`,
  opens a new session and refreshes. When the box has no claim it disposes the session and sets
  `this.screen = "venue"` (`:1548-1552`). That branch also serves a failed offering read that created
  no claim (`apps/setup/src/setup-app-first-fiscal.test.ts:571`). No test pins what Reconnect does
  after a successful wipe: `rg "reconnect-first"` across the setup tests finds no such case (run;
  the closest, `setup-app-wipe.test.ts:296`, reconnects before any send).
- **A finished-and-stopped old recovery cannot be finished from a fresh page today.** Beside a
  stopped recovery the repair page hides Recover. Once activity reads `stopped`, the old screen says
  "This recovery stopped before it finished. Go back and choose Start again."
  (`apps/setup/src/screens/first-setup-backup-screen.ts:299-312`,
  `apps/setup/src/i18n/backup-repair.ts`, key `stopped`). Activity is `running` only while this
  process holds it in memory (`first-setup-backup-recovery.ts:1557-1567`), and any restart (this
  slice's deploy included) makes it `stopped` (`:1568-1596`).
- **The fresh-box restore after a wipe** is pinned on the server for a held database
  (`apps/server/src/first-setup-start-again-held.test.ts:754`, "a held setup database, wiped, then
  the fresh-box restore writes into the usual folders", with its control at `:773`). It is not yet
  pinned for a missing database. Slice 2's check run saw that restore fail `sif.allocation_invalid`
  (slice 2 plan, Task 4b), and experiment E2 shows why: it works when the backup's hour is chosen
  after the wipe.
- **"Join or recover"** is `setup-role-screen` (`apps/setup/src/screens/role-screen.ts:50-90`). It
  offers a mirror (`choose-mirror`), Restore from backup (`choose-restore`) and Restore from my
  bucket (`choose-restore-bucket`). Waitron Cloud is reached from the backup-file screen
  (`apps/setup/src/screens/restore-screen.ts:266-268`), not from this one.

## Experiments run while planning

- **E1 — Where Reconnect lands after a successful wipe** (run 2026-10-31). The probe file is
  `~/waitron-campaign/a1131bc-3-plan-probes/zz-a1131bc3-probe.test.ts.txt`. It was put at
  `apps/setup/src/` for the run and then deleted. Before running I wrote down the failing case for
  my reading of `setup-app.ts:1548-1552`: any screen other than `screen-venue`. The first run,
  `reconnect-output.txt`, read "Tests 2 failed (2)". The only failure was the shared `settled`
  helper (`apps/setup/test/held-database-browser.ts:70-71`), which polls `reconnect-first`; the page
  no longer drew it because it had left the repair page. The second run, `reconnect-output-2.txt`,
  read "Tests 2 passed (2)". It printed:
  - A: before the wipe `["screen-first-owner"]` with `draft.mode: undefined`; while restarting the
    tab's stored session read `{"version":1,…,"claimPending":true}`; after Reconnect
    `["screen-venue"]` with `draft.mode: undefined`.
  - B: with `/first-setup/status` throwing a network error, Reconnect left `["screen-first-owner"]`
    with the `restarting` line gone and Reconnect still drawn. With the status answering again, a
    second Reconnect gave `["screen-venue"]`. So the page's memory survives a failed Reconnect,
    and the choice must not be stored in `firstRestarting`, which Reconnect clears
    (`setup-app.ts:1517`).
- **E2 — The fresh-box restore after a missing-database wipe** (run 2026-10-31). A temporary case
  was appended to `apps/server/src/first-setup-start-again-held.test.ts` and reverted with
  `git checkout` afterwards. It used `missingHeldDatabase()` and `startAgainMissing()` (`:701-719`),
  then the hour chosen after the wipe and `stageFreshRestore` (`:733-747`), the same steps as
  `:754`. Written down first, the failing case was a rejection, as slice 2's case E printed. The run
  (`-t ZZPROBE`, output `~/waitron-campaign/a1131bc-3-plan-probes/missing-wipe-restore-output.txt`)
  read "Tests 1 passed | 70 skipped (71)" and printed: `result true`, `venue.db true trading.env
  true`, no `first-setup-resolutions` in either folder, workspace `absent`. Task 0 pins it.
- **Read for this plan:** the spec in full; slice 2's plan in full; `git show --stat 4c5ba38db`;
  `setup-app.ts:75-110`, `:600-1110`, `:1130-1600`, `:2343-2680`; `first-setup-session.ts:100-420`;
  `start-again-wipe.ts`; `setup-app-wipe.test.ts:1-330`; `role-screen.ts`;
  `first-setup-backup-screen.ts:1-140`, `:285-320`; `first-setup-backup-recovery.ts:798-870`,
  `:1020-1050`, `:1550-1600`; `setup-first-backup-api.ts:180-300`; `first-setup-entry.ts:60-130`;
  `node-entry.ts:344-420`; both guide files in full; `docs/operations/first-live-fiscal-setup.md:95-170`;
  `hour-recovery.md:1-70`; `backups-and-support.md:15-40`; `docs/backlog.md:618-642`;
  `docs/backlog/setup.md:448-462`, `:538-546`, `:596-632`, `:745-830`; the mock-ups README and
  pictures 1-3. `gh pr list` (run): the open PRs #2331 and #2326 touch none of this plan's files
  except `docs/backlog.md` (#2326, its CI entry). A different entry, so whichever lands second
  rebases.

## Decisions where the spec leaves a choice

- **D1 — One confirmation, two kinds.** A new `@state() private firstWipeKind: "start-again" |
  "recover" = "start-again"` is set by `#openWipeConfirmation(kind)` before its reads and is left
  alone by `#closeWipe`. The same reads, the same refusals and the same `sendWipe` serve both kinds.
  Only the drawing differs: the paragraph, the tick's words and Confirm's label and `data-test`.
- **D2 — The §9b paragraph is three keys** (`recoverDeletes`, `noInvoiceSent`, `recoverThen`), so
  the middle sentence can be left out under §9a's rule. A test pins the joined text to §9b's exact
  sentence in both languages.
- **D3 — Where Recover is drawn and enabled.** It is drawn wherever Start again's button is drawn,
  and is disabled exactly when Start again's is (`firstOwnerBusy || !offered || unsettled`,
  `:2397`). It is also drawn beside Start again's own open confirmation, as today, and pressing it
  there re-reads and opens Recover's confirmation. It is not drawn beside its own open
  confirmation, beside a drawn refusal (picture 3: "neither is offered"), or in the missing ask
  when the wipe is not offered (`selected` or `uncertain` phase). Under OQ1's default it is drawn
  beside a stopped recovery too. `recover-backup` keeps its `data-test`.
- **D4 — The missing ask's "If you have a backup, recover from it."** (`missingBackup`) is drawn
  only when the Recover button is drawn beside it (Start again's confirmation with no stopped
  recovery). It is not drawn inside Recover's own confirmation, nor where Recover is not offered.
- **D5 — Carrying the choice across the restart** (spec "Open, not measured"; E1). A private field
  `#afterWipe?: "start-again" | "recover"` is set only when `sendWipe` resolves. It is not set on
  `setup.start_again_incomplete`, whose words already say to reload. `#reconnectFirstSetup` reads it
  in the no-claim branch (`:1548-1552`): `"recover"` opens `"role"`, `"start-again"` opens `"mode"`
  (D6), and unset keeps `"venue"` (the offering-failure path). It is cleared when used, when a
  Reconnect finds a claimed setup, and in `disconnectedCallback`. It survives a failed Reconnect.
  A reload forgets it (OQ2).
- **D6 — Start again lands on the mode screen.** The spec's §1 step 3 says "the page's first
  screen", but today the page opens the venue screen with no mode chosen (E1). The mode screen is
  the first choice screen. The connection screen is skipped because Start again only runs over
  HTTPS (`assertHttps`, `apps/server/src/setup-first-fiscal-api.ts`). The lead may drop D6; Task
  3's Start-again test then pins `screen-venue` instead, and N3 is removed.
- **D7 — The page's route to the old screen goes now; the screen itself stays for slice 4.**
  Removed: the `"first-backup"` member of `Screen` (`:83`), its render case (`:2650-2655`) and the
  two `#onGoto` scope branches (`:992`, `:996`). After this slice nothing reaches them (Current
  behaviour), and leaving them would leave untested code in a package held at 98/98/98/95. Kept for
  slice 4: `apps/setup/src/screens/first-setup-backup-screen.ts` and its four test files (they
  mount the element directly), `apps/setup/src/i18n/backup-repair.ts`,
  `apps/setup/src/first-setup-backup-session.ts`, the `shownAt` import (`setup-app.ts:14`), every
  server file, and the page's `backup/status` and `backup/activity` reads.
- **D8 — `data-test` names.** Recover's paragraph is `recover-deletes` and its Confirm is
  `confirm-recover` (variant `danger` once ticked, label `recoverBackup`). The tick keeps
  `retire-confirmed`, with name `retire-setup`, or `missing-database-confirmed` with the database
  missing. Cancel keeps `cancel-start-again`.
- **D9 — Focus.** Recover's confirmation focuses `retire-confirmed`, as Start again's does. A send
  refused `kept-records` or `setup.attempt_conflict` from Recover's confirmation draws
  `heldChanged` and focuses `recover-backup`. A refusal focuses `start-again-refused`.
- **D10 — Restarting words.** After either wipe the page says the existing `restarting` ("The old
  attempt is deleted. Reconnect to continue."), which is true for both.

## Readers that keep working (boxes already inside an old recovery)

This slice changes no server source, so every reader below behaves exactly as on 4c5ba38db. Task 7
checks this with `git diff --stat 4c5ba38db -- apps/server/src ':!apps/server/src/guide' ':!apps/server/src/first-setup-start-again-held.test.ts' packages`,
which must print nothing.

| Reader | Where (4c5ba38db) | What it keeps doing |
| --- | --- | --- |
| the start's stage decision | `resolveFirstSetupBackupEntry`, `apps/server/src/first-setup-backup-entry.ts:77-94`; `node-entry.ts:344-389`; `first-setup-entry.ts:74-95` | answers `absent` at once when neither folder has `first-setup-resolutions/backup-recovery`, which is every box set up after slice 2; otherwise repair page or "selected" |
| running from the recovery's folders | `first-setup-entry.ts:81-95` (`backup.run`); `apps/server/src/first-setup-launch.ts` | a "selected" recovery still runs from `target/` |
| the selling path's refusal | `assertFirstSetupBackupBootTarget`, `packages/provisioning/src/first-setup-backup-workspace.ts:792`, called at `boot.ts:909` | unchanged |
| discarded copy, spare file, full-disk page | `first-setup-entry.ts:260`; `spare-space.ts:239`, `:252`; `discarded-copy.ts:14`; `node-entry.ts:445`; `recovery-surface.ts:619` | unchanged |
| the old recovery's routes | `setup-first-backup-api.ts:207-300`, mounted at `first-setup-entry.ts:371` and `boot.ts:1200` | still served (N1); the page now reads only `status` and `activity` |
| the repair page beside an old recovery | `setup-app.ts` running view (`offersNothing`), stopped block, `recoveryUnreadable` | unchanged, except that Recover is drawn beside a stopped recovery and discards it like Start again (OQ1) |
| Start again's discard of a stopped recovery | slice 2's `confirmRecoveryDiscard` path; server tests in `first-setup-start-again-backup-discard.test.ts` | unchanged; Recover sends the same field |

Not a reader any more: `packages/provisioning/src/box-folders.ts` (spec §7, row 4) was deleted by
A1206 (`git log --diff-filter=D -- packages/provisioning/src/box-folders.ts` → 90f41f490, run).

## Fiscal-adjacent risks and the test that holds each

| Risk | Held by |
| --- | --- |
| Recover deletes where Start again would refuse | Task 2a "Recover from backup refuses exactly where Start again refuses: %s" (each §9c cause, compared with Start again's words from a second mount; nothing sent); server: slice 2's §1a refusal rows (`first-setup-start-again-held.test.ts`, "refuses …, and deletes nothing"), which apply because the request is identical (Task 1 "Recover sends exactly what Start again sends: %s") |
| a refusal deletes something | the same server rows (disk snapshot equal, no confirmations folder); the page sends nothing after a summary refusal (Task 2a) |
| after the wipe the restore is not the ordinary fresh-box restore | server: `:754` and its control `:773` (held), plus Task 0's missing-database case and control; page: Task 3 "from Join or recover, Restore from backup opens the fresh-box restore screen, and nothing went to the old recovery's routes" |
| the old recovery is opened for a new recovery | Task 1 (no `setup-first-backup` mounted, no request to the old routes, in every case); D7 deletes the route; `pnpm --filter @waitron/setup typecheck` fails on any leftover `"first-backup"` goto |
| Recover deletes a stopped recovery without saying so | Task 2a "beside a stopped recovery, Recover's confirmation names it with recoveryStoppedRecover and sends confirmRecoveryDiscard" (OQ1) |
| the fiscal core moved | Task 7: the three fiscal suites unedited and green; the `git diff --stat` above prints nothing |

## Changed test checks (the PR description names each)

Rows are by title at 4c5ba38db. "OQ1" rows change only under OQ1's default; if the owner picks the
alternative, they stay unedited.

| Test | Old | New | Why |
| --- | --- | --- | --- |
| `setup-app-resolution.test.ts` "opens independent backup repair with an %s setup password and no normal restore preview" (`:610`) | Recover mounts `setup-first-backup` with the inspection | deleted; replaced by Task 1's per-case "Recover sends exactly what Start again sends" (checkable) and Task 2a's uncheckable row (Recover drawn disabled, nothing sent) | slice 3; N2 |
| `setup-app-resolution.test.ts` "with the database present, Recover from backup is not offered beside a stopped recovery" (`:1172`) | `recover-backup` absent | drawn and enabled as Start again is; retitle "…is offered beside a stopped recovery" | OQ1 |
| `setup-app-resolution.test.ts` "with the database present, Cancel after a failed summary read returns to the stopped recovery, signed out" (`:1324`) | `recover-backup` in the list of absent controls | removed from that list; `recover-backup` drawn and enabled | OQ1 |
| `setup-app-missing-database.test.ts` "offers no Start again in the ask while a backup recovery's journal reports %s" (`:326`) | `recover-backup` drawn, disabled when `uncertain` | `recover-backup` absent for both; `missingBackup` absent; retitle "offers neither Start again nor Recover from backup…" | §1a, D3, D4 |
| `setup-app-missing-database.test.ts` "once a backup recovery reported %s has stopped, the ask offers Start again and no Recover from backup" (`:356`) | `recover-backup` absent | drawn beside Start again's confirmation; retitle "…offers Start again, with Recover from backup beside its confirmation" | OQ1 |
| `setup-app-missing-database.test.ts` "offers Start again at once for a recovery that failed, and its confirmation on pressing it" (`:565`) | `recover-backup` absent | drawn | OQ1 |
| `setup-app-missing-database.test.ts` "pressing Start again names the stopped recovery and when it was last active ($locale)" (`:579`) | `missing-actions` buttons `[]` | `["recover-backup"]`; `missingBackup` still absent | OQ1, D4 |
| `setup-app-missing-database.test.ts` "says the recovery's records cannot be read when its journal is unreadable ($locale)" (`:673`) | `recover-backup` drawn, disabled, after `recovery-unreadable` | absent; the `recovery-unreadable` line and the absent `missingBackup` unchanged | §1a, D3 |
| `setup-app-resolution.unsaved.test.ts` "asks before leaving an entered setup password for backup recovery" (`:52`) | Recover navigates, the leave warning opens, and Discard mounts `setup-first-backup` | retitle "Recover from backup opens its confirmation in place, keeping an entered setup password, with no leave warning": the warning stays closed, `setup-first-backup` is never mounted, `recover-deletes` is drawn and the field keeps its value | D7 |

Unchanged on purpose (must stay green unedited): "draws Recover from backup beside Start again,
with no recovery note ($locale)" (`missing :310`); "shows none of the ask's lines before Start
again is pressed" (`:373`); every running-recovery case (`missing :340`, `:506`; resolution `:927`,
`:967`, `:1165`); resolution "Cancel at the warning lands on the page as it was…" (`:823`) and
"with the database present and no recovery, Recover from backup is still offered" (`:1179`); the
two unsettled-recovery cases (`missing :821`, `:933`, which accept an absent button via `?? true`);
`setup-app-first-fiscal.test.ts:571` (the offering-failure Reconnect still opens `venue`, D5);
every `setup-app-wipe.test.ts`, `setup-app-held-refusals.test.ts` and
`first-setup-retirement.test.ts` case; and every `screens/first-setup-backup-screen*.test.ts` case
(D7). If any of these turns red, STOP.

## Review Focus

1. **Reconnect while the box is still restarting**, then again once it answers: Join or recover,
   not the venue screen (E1 case B). Task 3.
2. **A Reconnect that finds a setup claimed again** (another device claimed after the wipe): the
   repair page for that setup, never Join or recover, and the choice forgotten. Task 3.
3. **Switching from Start again's open confirmation to Recover:** the summary is read again, only
   Recover's words are drawn, and Confirm sends once. Task 2a.
4. **The language changed while Recover's confirmation is open:** every line redrawn in the new
   language, the tick state kept, nothing re-read. Task 1.
5. **A Recover send refused `kept-records` after the confirmation was drawn:** `heldChanged`, focus
   on `recover-backup`, and Recover offered again (its next summary then draws `keptFault`).
   Task 2a.

---

### Task 0: Server — pin the fresh-box restore after a missing-database wipe

**Files:** `apps/server/src/first-setup-start-again-held.test.ts` only (two cases after `:782`). No
source change.

- [ ] **Step 1:** add "a missing setup database, wiped, then the fresh-box restore writes into the
  usual folders". Use `missingHeldDatabase()`, then `startAgainMissing(f)`, then the hour chosen
  after the wipe (`recoverySelectPastWaits(clock, createSelectedRecoveryPreparation(f.archive.options), { onBox: false })`),
  then `stageFreshRestore(f, { ...f.archive, outcome })`. Assert: `runStagedRestore(f.archive.restore)`
  resolves `true`; `venue.db` exists in the venue folder and `trading.env` in the state folder; there
  is no `first-setup-resolutions` in either; `resolveFirstSetupBackupWorkspace(f.roots)` has `kind`
  `"absent"`. Timeout 180 s, as at `:772`.
- [ ] **Step 2:** add "control: the same fresh-box restore beside a missing setup database that was
  not wiped is refused, and places nothing". `missingHeldDatabase()` with no wipe, then
  `stageFreshRestore(f)`. Assert that `runStagedRestore` rejects with a code matching
  `/^setup\.attempt_(conflict|uncertain)$/` (as `:777` does), that `trading.env` is absent, and
  that the venue folder snapshot (`diskSnapshot`) is unchanged. Written down before running: if it
  resolves instead, the restore ignores a failed setup with its database missing. STOP for the
  lead.
- [ ] **Step 3:** run the held file with `-t "missing setup database"`. Both cases pass (E2 predicts
  the first). Prove the first by deletion: comment out its `startAgainMissing(f)` line, see it
  fail with the control's refusal, and restore the line. `git diff` on the file must then show
  only the two added cases. Ledger: the counts.
- [ ] **Step 4:** commit.

### Task 1: Recover opens the wipe confirmation with §9b's words

**Files:** `apps/setup/src/screens/initial-owner-strings.ts` (the four keys in Global Constraints),
`apps/setup/src/setup-app.ts` (`firstWipeKind`, `#openWipeConfirmation(kind)`, the Recover
button's handler, the confirmation drawing, `#startAgainFirstSetup` → `#sendWipeFirstSetup`), and
new `apps/setup/test/wipe-browser.ts`. Move `wipeFixture`, `cases`, `Sent`, `summaryReads`,
`sends`, `OWNER_HEADER` and `text` out of `setup-app-wipe.test.ts` (`:36-174`) into it, unchanged,
and import them back. Create `apps/setup/src/setup-app-recover.test.ts`. Add to
`setup-app-resolution.test.ts`'s words test (`:127`).

**Interfaces — Produces:**
- `#openWipeConfirmation(kind: "start-again" | "recover"): Promise<void>`. The Start again button,
  Check again and every existing caller pass `"start-again"`.
- `@state() private firstWipeKind: "start-again" | "recover"`.
- `apps/setup/test/wipe-browser.ts` exports `wipeFixture(options)` (as today, plus an optional
  `status?: (path: string, headers: Headers) => Response | undefined` checked before `wizardApi`'s
  own `/first-setup/status` answer, for Task 3), `cases`, `summaryReads`, `sends`, `OWNER_HEADER`
  and `text`.
- `OLD_RECOVERY_ROUTE = /\/resolution\/backup\/(open|resume|prepare|commit|close|renew|cloud\/)/` in
  `wipe-browser.ts`.

- [ ] **Step 1: Failing tests** in `setup-app-recover.test.ts`:
  - `for (const c of cases)`, "${c.name}: Recover sends exactly what Start again sends, with no
    password and no owner header, and never opens the old recovery": press `recover-backup`; poll
    for `retire-confirmed`; no password field inside the confirmation; tick it; press
    `confirm-recover`; exactly one send to `/resolution/start-again` with body
    `{ inspectionId, revision: 1, ownerGeneration: 1, ...c.sent }`; no `X-Waitron-Setup-Owner` on any
    request; `requests.some(r => OLD_RECOVERY_ROUTE.test(r.path))` false;
    `app.shadowRoot!.querySelector("setup-first-backup")` null throughout (checked after each
    step); then the text contains `t.restarting`. Fails today: Recover mounts `setup-first-backup`.
    The stopped-recovery row of `cases` is OQ1's. If OQ1's alternative is chosen, drop it here and
    add it to Task 2a as "not offered".
  - `it.each(locales)` "Recover's confirmation says §9b's words ($locale)", with `namedSummary`
    and the database `occupied`: `recover-deletes` trimmed text equals EN "Recover from backup first
    deletes what was entered in the setup that stopped part way. No invoice was sent to AEAT. Then
    you choose the backup." (the ES literal for `es`); the tick's label equals `retireRecover`; the
    tick's `name` is `retire-setup`; `confirm-recover` shows `recoverBackup` and is disabled until
    ticked, `danger` after; `start-again-deletes` and `confirm-start-again` are absent; the page text
    contains neither "This box will not use" nor "Este equipo no volverá" (the help line is not
    drawn).
  - "with the setup database missing, Recover's confirmation leaves out the no-invoice sentence
    and uses the missing-database tick": the paragraph equals `${recoverDeletes} ${recoverThen}`;
    the tick's label is `missingConfirm` and its name `missing-database-confirmed`; `missing-reached`
    is drawn; `missingBackup` is not in the text (D4).
  - "a setup database the box cannot read all of: Recover's confirmation draws
    setupDatabaseUnreadable and leaves out the no-invoice sentence".
  - Review Focus 4: "switching the language while Recover's confirmation is open redraws it in
    Spanish and keeps the tick": open it in EN, tick, `setLocale("es-ES")`, `await
    app.updateComplete`; the paragraph equals the ES literal, the tick is still checked, and the
    summary was read once.
  - In `setup-app-resolution.test.ts`'s words test: `expect(en.recoverDeletes).toBe(…)` and the
    same for `recoverThen`, `retireRecover` and `recoveryStoppedRecover`, in EN and ES, with the
    Global Constraints literals.
- [ ] **Step 2:** run `src/setup-app-recover.test.ts`, `src/setup-app-wipe.test.ts` (still green
  after the fixture moved) and `src/setup-app-resolution.test.ts -t "confirmation words"`. The new
  cases fail as stated.
- [ ] **Step 3: Implement.** The Recover button calls `#openWipeConfirmation("recover")`. The
  confirmation block picks its paragraph, tick words and Confirm (`confirm-recover` or
  `confirm-start-again`) by `firstWipeKind`, and both Confirms call the one send method.
  `noInvoiceFound` is unchanged (`setup-app.ts:2417`). Drawing rules beyond this are Task 2a's: in
  this task Recover stays drawn where it is today.
- [ ] **Step 4:** the Step 2 files green; `pnpm --filter @waitron/setup typecheck` and `lint`.
  **Red until Task 2b, by design:** `setup-app-resolution.test.ts` "opens independent backup
  repair…" and `setup-app-resolution.unsaved.test.ts` "asks before leaving an entered setup
  password for backup recovery". Record both. Any other red title is a STOP.
- [ ] **Step 5:** commit.

### Task 2a: Where Recover is offered; refusals hide both; the route to the old screen goes

**Files:** `apps/setup/src/setup-app.ts` (D3, D4, D7, D9, and the stopped block in Recover's
confirmation drawn with `recoveryStoppedRecover`), `apps/setup/src/setup-app-recover.test.ts`.

- [ ] **Step 1: Failing tests** (in `setup-app-recover.test.ts`):
  - `it.each` over §9c's causes (`setup-finished`, `trading-settings`, `kept-records`, plus
    `setup.not_ready` and `setup.owner_required` as plain errors): "Recover from backup refuses
    exactly where Start again refuses: %s". Mount A presses `start-again` and mount B presses
    `recover-backup`, each with `summary: () => refusedCause(cause)` (or the plain error). Both
    `start-again-refused` texts are equal and non-empty. In B, `recover-backup`, `start-again`,
    `retire-confirmed` and the two Confirms are absent, `reconnect-first` is drawn, and nothing goes
    to `/resolution/start-again`. Fails today: B still draws `recover-backup` beside the refusal
    (`setup-app.ts:2586`).
  - "with the setup password uncheckable, Recover from backup is drawn disabled like Start again,
    and nothing is read". Inspection `password: "uncheckable", revision: null, ownerGeneration:
    null`; both buttons disabled; `uncheckable` and `wipeUnavailable` drawn; no summary read; no
    `setup-first-backup`. Fails today: Recover is enabled.
  - "in the missing ask, a backup phase %s offers neither button and no 'If you have a backup'
    line" (`selected`, `uncertain`; via `missingDatabaseFixture` from
    `apps/setup/test/missing-database-browser.ts`; press `start-again` to reach the ask). For
    `uncertain`, `recovery-unreadable` is drawn. Fails today: Recover is drawn.
  - Review Focus 3: "pressing Recover beside Start again's open confirmation reads the box again
    and opens Recover's confirmation instead". Open Start again's confirmation; Recover is drawn
    beside it; press it; `summaryReads` equals 2; `recover-deletes` is drawn and
    `start-again-deletes` absent; `recover-backup` and `start-again` absent; tick and Confirm send
    once. Fails today: Recover navigates away.
  - OQ1: "beside a stopped recovery, Recover is offered, its confirmation names the recovery with
    recoveryStoppedRecover, and Confirm sends confirmRecoveryDiscard" (`activity: stoppedActivity`,
    `summary: stoppedSummary`). `recovery-stopped`'s first line inside the confirmation equals
    `recoveryStoppedRecover` with `{started}` filled by `shownAt` (the second line is the existing
    last-active line). The body is `{ …ids, confirmRecoveryDiscard: { shown: stoppedSummary } }`.
    Fails today: no Recover beside a stopped recovery.
  - Review Focus 5: "a Recover send refused kept-records closes the confirmation, says the setup
    changed, and offers Recover again" (`startAgain: () => refusedCause("kept-records")`).
    `heldChanged` is among `formErrors`; `recover-backup` is enabled and holds focus
    (`app.shadowRoot!.activeElement` is the `recover-backup` host). Fails today.
- [ ] **Step 2:** run `src/setup-app-recover.test.ts`. The new cases fail as stated.
- [ ] **Step 3: Implement** D3, D4, D7 and D9. For D7: delete the `Screen` member, the render case
  and the two `#onGoto` branches, then run `rg '"first-backup"' apps/setup/src --glob '!*.test.ts'`,
  which must print nothing.
- [ ] **Step 4:** `setup-app-recover.test.ts` green; typecheck and lint. **Red until Task 2b, by
  design:** the "Changed test checks" rows. Record each failing title against its row. A red title
  that is not in that table is a STOP.
- [ ] **Step 5:** commit. **Per-task reviewer** (Tasks 1 and 2a: what Recover sends, where it is
  offered, and that nothing reaches the old recovery).

### Task 2b: The existing page suites follow

**Files:** `setup-app-resolution.test.ts`, `setup-app-missing-database.test.ts`,
`setup-app-resolution.unsaved.test.ts`.

- [ ] **Step 1:** apply every "Changed test checks" row, file by file, running each file after
  editing it.
- [ ] **Step 2:** check memory, then run in one go every `apps/setup` suite naming `resolution`,
  `missing`, `held`, `wipe`, `retirement`, `recover` or `first-fiscal`
  (`… vitest run src/setup-app-resolution src/setup-app-missing src/setup-app-held src/setup-app-wipe src/first-setup-retirement src/setup-app-recover src/setup-app-first-fiscal`),
  plus `src/screens/first-setup-backup-screen` (unedited, D7). All green; read the counts. Commit,
  naming each edited title.

### Task 3: After the restart — Join or recover

**Files:** `apps/setup/src/setup-app.ts` (`#afterWipe`, set in the send method, read and cleared in
`#reconnectFirstSetup`, cleared in `disconnectedCallback`), `apps/setup/src/setup-app-recover.test.ts`.

**Interfaces — Consumes:** `wipeFixture`'s `status` hook (Task 1). The fixture flips
`/first-setup/status` to `{ claimed: false }` once the start-again route has answered, as E1's
probe did.

- [ ] **Step 1: Failing tests:**
  - `it.each(locales)` "after Recover from backup's wipe, Reconnect opens Join or recover
    ($locale)": confirm, poll for `restarting`, press `reconnect-first`, then poll for
    `screen-role`. `setup-role-screen`'s `h1` equals `role.heading` in that language. No
    `screen-first-owner`, `screen-venue` or `screen-mode`. Fails today: `screen-venue` (E1 A).
  - Review Focus 1: "Reconnect while the box is still restarting keeps the choice, and the next
    Reconnect opens Join or recover". The status hook throws `new TypeError("Failed to fetch")`
    until a flag is set. After the first Reconnect the page is still on `screen-first-owner` with
    `reconnect-first` drawn. After the flag is set and a second Reconnect, `screen-role` is drawn.
    Fails today: `screen-venue` (E1 B).
  - Review Focus 2: "a Reconnect that finds a setup claimed again draws the repair page, not Join
    or recover". After the wipe the status answers `{ claimed: true }`, and the inspection answers
    as the fixture's default. Assert `screen-first-owner` and no `screen-role`. Then, with the
    status answering `{ claimed: false }` and Reconnect pressed again, `screen-role` is absent (the
    choice was forgotten). Under D5 that second landing is `screen-venue`; assert only that it is
    not `screen-role`. Passes today trivially (no `screen-role` ever). Prove it by deletion after
    the change: remove the "cleared when a Reconnect finds a claimed setup" line, see the second
    assertion fail, restore, and run `git diff --exit-code` on `setup-app.ts` against the task's
    own change.
  - D6: "after Start again's wipe, Reconnect opens the first choice screen": `screen-mode` is
    drawn. Fails today: `screen-venue`. If the lead drops D6, write this test as "…opens the venue
    screen, as before" and expect `screen-venue`.
  - "from Join or recover, Restore from backup opens the fresh-box restore screen, and nothing went
    to the old recovery's routes": from `screen-role`, click `choose-restore` (inside the role
    screen's shadow root) and poll for `screen-restore`.
    `requests.some(r => OLD_RECOVERY_ROUTE.test(r.path))` is false, and no `setup-first-backup` was
    ever mounted. Fails today: `screen-role` is never reached.
  - Unchanged and run: `setup-app-first-fiscal.test.ts` "returns to editable details only after
    reconnect confirms an offering failure created no claim" (`:571`). It still lands on
    `screen-venue`.
- [ ] **Step 2:** run `src/setup-app-recover.test.ts` and `src/setup-app-first-fiscal.test.ts`. The
  new cases fail as stated.
- [ ] **Step 3: Implement** D5 and D6.
- [ ] **Step 4:** both files green, plus `src/setup-app-wipe.test.ts` and `src/setup-app.test.ts`.
  Typecheck and lint.
- [ ] **Step 5:** commit. **Per-task reviewer** (where each wipe lands; the choice's lifetime; that
  the fresh-box restore is what follows).

### Task 4: Accessibility states for pictures 2 and 3, and the screen after the restart

**Files:** create `apps/setup/src/setup-app-recover.a11y.test.ts`.

- [ ] **Step 1:** the loops run over `en-GB`/`es-ES` × `light`/`dark` × 390/1280 px × states
  `recover-confirmation` (database `occupied`, `namedSummary`, ticked: picture 2),
  `recover-missing` (database missing, ticked), `recover-stopped` (OQ1; `stoppedSummary`),
  `refused-fault` reached by pressing `recover-backup` (picture 3), and `join-or-recover` (after
  the wipe and Reconnect, `screen-role`). Each runs `expectNoA11yViolations(host)`, checks that
  `document.documentElement.scrollWidth` is at most the width and that the section's right edge is
  inside it, and focuses the state's control (`confirm-recover`, `confirm-recover`,
  `confirm-recover`, `reconnect-first`, `choose-restore`), asserting that it takes focus and has a
  width. When `import.meta.env.VITE_A1131BC_RECOVER_LOOK === "1"` it saves
  `__screenshots__/a1131bc-recover/${locale}-${theme}-${width}-${state}.png`, as
  `setup-app-held-database.a11y.test.ts:91-94` does.
- [ ] **Step 2:** check memory, run the file, and read the count (expect 40). A violation is fixed
  in the page, never in the test. Commit.

### Task 5: Look check (pictures 2 and 3, and Join or recover)

- [ ] Check memory, then run
  `env -u AI_AGENT -u CLAUDECODE VITE_A1131BC_RECOVER_LOOK=1 pnpm --filter @waitron/setup exec vitest run src/setup-app-recover.a11y.test.ts`.
  Copy the PNGs from `apps/setup/src/__screenshots__/a1131bc-recover/` to
  `~/waitron-campaign/a1131bc-3-shots/`, then delete them from the worktree. Never commit a shot.
- [ ] Open, for each state: EN and ES × light and dark at 390 px, and EN light at 1280 px. The
  shots pass when:
  - `recover-confirmation` matches `docs/backlog/mockups/a1131bc-restore/2-recover-confirm.png`
    (and its `-dark`/`-es` twins) in order and words: heading "First setup was interrupted", the
    three-sentence paragraph, the tick, Cancel, a red **Recover from backup** once ticked,
    Reconnect, and "Set up secure connection". The mock-up's help line ("This box will not use…")
    must NOT appear (dropped, Global Constraints). No password field.
  - `refused-fault` matches `3-refused-fault.png`: the `keptFault` words, Reconnect and the link,
    and neither Start again nor Recover from backup.
  - `recover-missing`: the missing-database lines, the two-sentence paragraph and the "Nothing was
    filed…" tick, with no "If you have a backup" line.
  - `recover-stopped`: the stopped recovery's two lines inside the confirmation with OQ1's words.
  - `join-or-recover`: the role screen as on a new box.
  - At 390 px nothing overflows the card and every line wraps; dark-theme text is legible.
  Write what was opened and seen into the ledger.

### Task 6: Docs that would otherwise be false

**Files:** `apps/server/src/guide/en/backup-recovery.md`, `apps/server/src/guide/es/backup-recovery.md`,
`docs/operations/first-live-fiscal-setup.md`, `docs/operations/hour-recovery.md`,
`docs/operations/backups-and-support.md`, `apps/server/README.md`, `docs/backlog.md`,
`docs/backlog/setup.md`, `docs/backlog/mockups/a1131bc-restore/README.md`, and the spec (one dated
line).

Find every sentence again with
`rg -n -i "recover from backup|recuperar desde una copia|open backup|abrir copia|finish saved recovery|finalizar la recuperación guardada|repair recovery|even if the old setup password|aunque no se pueda comprobar la contraseña|does not offer \*\*recover|no ofrece \*\*recuperar" apps/server/src/guide docs/operations docs/backlog apps/server/README.md`.
Hits read on 4c5ba38db: EN guide `:5-8`, `:31`, `:72-96`, `:127-152`; ES guide `:5-8`, `:33` and the
same sections; runbook `first-live-fiscal-setup.md:128-129`, `:142-143`, `:163-164`;
`hour-recovery.md:30-54`; `backups-and-support.md:22-28`; `docs/backlog/setup.md:456`, `:826`,
`:747-758`; `docs/backlog.md:622-624`.

After the edit each must say:
- **Guide, `#interrupted-setup`** (EN and ES alike):
  - **Start again** and **Recover from backup** delete the failed setup the same way, with no
    password, and both are refused in the same cases, in the page's words.
  - Pressing Recover from backup shows §9b's words (quoted) and its tick (or, with the database
    missing, the missing-database lines and the "Nothing was filed…" tick).
  - After confirming, the box restarts; **Reconnect** opens "Join or recover an existing
    restaurant", where you choose Restore from backup or Restore from my bucket, or, from the
    backup screen, Restore from Waitron Cloud.
  - If the page is reloaded before Reconnect, it opens its first screen; choose **Join or
    recover** there (OQ2).
  - After **Start again**, Reconnect opens the first setup screen (D6).
  - Restoring needs the backup's own key and its node recovery key, as on a new box.
  - Delete: "You can use this route even if the old setup password cannot be checked" (N2), the
    "old attempt and its files stay in their own folders" sentence, and "does not offer **Recover
    from backup** beside it" (OQ1 default).
  - The running/stopped/Cloud-approval paragraphs stay. One sentence before them says they
    describe a recovery from backup begun on the repair page before this version of Waitron, which
    no longer starts one.
  - The full-disk and "files found" paragraphs are unchanged.
- **Guide, `#source`, `#proof`, `#series`, `#resume`:** rewritten for the fresh-box restore
  screens. Before writing, read `apps/setup/src/screens/restore-screen.ts`,
  `restore-bucket-screen.ts`, `cloud-restore-screen.ts`, `recovery-copy.ts` and
  `recovery-allocation.ts`, and their strings in `apps/setup/src/i18n/strings/restore.ts` and
  `packages/fiscal-verifactu/src/setup/recovery-hour.ts`. Name only controls those files draw,
  checking each bold label by `rg` in those string files. What happens if the restore stops part
  way follows the spec's §2 bullets (before Restore is pressed, after the request is saved, while
  it is written). The Backups-settings paragraphs (EN `:98-125`, ES the same) stay, unchanged. The
  five headings and `{#id}`s stay, so `apps/server/src/guide-backup-recovery.test.ts` stays
  unedited.
- **Runbooks:** `first-live-fiscal-setup.md` says Recover from backup is offered wherever Start
  again is, runs the same wipe, and leads to Join or recover and the [ordinary restore](hour-recovery.md).
  `:128` loses "unless a backup recovery has stopped (below)", `:142-143` loses "offers no
  **Recover from backup** beside it", and `:163-164` is rewritten.
  `hour-recovery.md` "Recover while first setup is blocked" (keep the heading: other files link
  its anchor) becomes: press Recover from backup, confirm, Reconnect, choose the copy on Join or
  recover, then follow "Check the selected copy" and "Make the new series" above; the old
  paragraphs about Open backup, Finish saved recovery and the five-minute lease go.
  `backups-and-support.md:22-28` says the same in two sentences.
- `apps/server/README.md:49-52`: after "recovery from a backup (under
  `/setup-api/first-setup/resolution/backup/`)" add ", which the setup page no longer starts (it
  goes in A1131bc slice 4)".
- **Backlog:**
  - `docs/backlog.md` A1131c: "Slices 2 and 3 landed; slice 4 (deleting the old recovery-folder
    code, and the old routes' `open`, N1) is still to come."
  - `docs/backlog/setup.md` A1131c detail (`:747-758`): slice 3 as landed, with this plan's path;
    slice 4 still to come.
  - Decision line `:823-826` gains "(2026-10-31, A1131bc slice 3: Recover from backup's half is
    built; slice 4 deletes the old recovery code.)".
  - `:456` ("A resume can use the room the spare file gave"): "the page does not offer **Recover
    from backup** beside a stopped recovery" becomes "since A1131bc slice 3 the page's Recover from
    backup discards a stopped recovery rather than resuming it", with the rest kept.
  - New short entries, each "Left open by A1131bc slice 3": N2 (no Recover from backup when the
    setup password cannot be checked; reinstall only); OQ2's default, as a deliberate limit, under
    "Decisions and deliberate limits" (a reload between the wipe and Reconnect forgets the choice).
- **Mock-ups README:** one dated line under the table: "2026-10-31, A1131bc slice 3: the help line
  in pictures 1 and 2 is not drawn (A1206 removed what it described)."
- **Spec:** one dated line under its header: "2026-10-31, slice 3 plan: §1 step 3's 'as today' for
  Start again was false — Reconnect opened the venue screen with no mode (plan E1); slice 3 lands
  Start again on the mode screen and Recover from backup on 'Join or recover'; the choice is held
  in the page's memory (plan D5, OQ2); §7's `box-folders.ts` was deleted by A1206; Recover from
  backup is offered beside a stopped old recovery (plan OQ1)."

- [ ] **Step 1:** edit, then run `pnpm exec prettier --write` on the two guide files and
  `apps/server/README.md`. `docs/` is Prettier-ignored, so READ each edited runbook section and
  backlog entry whole afterwards (CLAUDE.md §1: a behaviour change retires every receipt about the
  old behaviour).
- [ ] **Step 2:** re-run the search. Expect only: the guide's sentences about a recovery begun
  before this version, the spec, slice 2's plan, this plan, `docs/operations/a679-changed-checks.md`
  (a dated record), and `first-live-fiscal-setup-2026-10-15.md` (dated). Investigate any other hit.
- [ ] **Step 3:** `… pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-backup-recovery.test.ts`,
  then root `scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts`, then
  `pnpm format:check`. Commit.

### Task 7: Final checks

- [ ] `git diff --stat 4c5ba38db -- packages CLAUDE.md docs/developers/conventions-data.md` prints
  nothing, and `git diff --stat 4c5ba38db -- apps/server/src ':!apps/server/src/guide' ':!apps/server/src/first-setup-start-again-held.test.ts'`
  prints nothing.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`,
  `… exec vitest run inmutabilidad` and `… exec vitest run huella`, all unedited and green; read the
  counts.
- [ ] Server, unedited apart from Task 0: `… @waitron/server exec vitest run src/first-setup-start-again-held.test.ts src/first-setup-resolution.boot.test.ts src/first-setup-start-again-backup-discard.test.ts`.
- [ ] Root guards: `scripts/native-form-fields.test.ts`, `scripts/help-tooltip-mode.test.ts`,
  `scripts/english-only.test.ts`, `scripts/guide-links.test.ts`, `scripts/style-token-names.test.ts`,
  `scripts/primary-coloured-text.test.ts` (the last two only if Task 2a touched the page's CSS; run
  them anyway, they are cheap), `scripts/errors-reachable.test.ts` (no code is added or retired; run
  to confirm), `scripts/claude-md-pointers.test.ts`.
- [ ] `pnpm --filter @waitron/setup typecheck` and `lint`; `pnpm format:check`.
- [ ] Coverage is CI's (`apps/setup` holds 98/98/98/95). Read the setup package's coverage job on
  the PR's head. Locally run `pnpm --filter @waitron/setup test:coverage` only if that job fails,
  and check memory first.
- [ ] Ledger `Status: done` for the build. Tell the lead it is ready for `/finish-branch` with this
  plan. The PR description opens with OQ1's request for the owner's approval of
  `recoveryStoppedRecover` (EN and ES) and OQ2's default. It carries N1–N4, D5, D6, D7, the
  "Readers that keep working" table, the fiscal-adjacent risk table, the changed-checks table, and
  the look-check list.

## Self-review notes

- **Spec coverage.** Slice 3's confirmation of §9b → Task 1. "After the restart … 'Join or
  recover'" → Task 3 (D5), settled from E1. "Stops opening the old recovery for new recoveries" →
  Tasks 1, 2a and 3 (no `setup-first-backup`, no old-route request), D7 and N1. Pictures 2 and 3 →
  Tasks 4 and 5. The user guide → Task 6. Fiscal-adjacent → the risk table, full review and Task 7.
  §9b's help line dropped → Global Constraints, Tasks 1 and 5. §1a "no longer offered where
  refused" → Task 2a. The spec's "boxes already inside one keep the old code" → "Readers that keep
  working", and Task 7's diff check.
- **Not in this slice:** deleting the old recovery code, its routes, its strings, its screen
  component and its guide-free docs (`deploy/README.md:283`, `:325`, `:334`;
  `docs/developers/conventions-ui.md:1130`; `docs/developers/conventions-data.md`), which is slice
  4's work.

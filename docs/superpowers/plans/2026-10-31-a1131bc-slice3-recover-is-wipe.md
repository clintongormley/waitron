# A1131b/c slice 3: Recover from backup becomes the wipe — Implementation Plan

**Revision 3 (2026-10-31).** This revision folds the round-3 claim check of revision 2
(`~/waitron-campaign/item-a1131bc-3-round3.md`: 0 critical, 1 important, 8 minor).
- **I-1:** revision 2's fold of M1 said Continue gets a person out of a "repairable" setup record.
  That is false whenever the setup database holds records or is missing. Continue repairs the
  marker only when `repairEligible` (`packages/provisioning/src/first-setup-owner.ts:254-256`) is
  true, and that needs a pair of `repairable`, a present database with no rows (`emptyDatabase`,
  which is false for a missing database, `first-setup-resolution-inspection.ts:82`, `:94-96`), and
  no other file left behind (`:365`; read). Run: `pnpm --filter @waitron/provisioning exec vitest
  run src/first-setup-resolution-inspection.test.ts -t "marker repair|repair a supposedly|repairs|repair"`
  gave "Tests 10 passed | 50 skipped (60)". That includes "refuses marker repair when the existing
  database carries a taxpayer" (refused `setup.not_ready`), and "audits legacy password recovery's
  marker repair before rebinding ownership", where the repair goes ahead.
  - The replacement sentence was traced the same way. Where Continue cannot repair, nothing else is
    offered. Continue is not drawn at all with the database missing or the record unreadable
    (`setup-app.ts:2514-2521`). Start again and Recover need `pair === "valid"` (`:236-239`).
    Abandon needs a signed-in session (`:2627`). So a reinstall is the only way out "unless the setup had
    saved nothing yet". N2, the guide sentence and the backlog line now say that.
- **M-1:** the stopped-recovery line is also drawn after a failed summary read (`setup-app.ts:2538`)
  and on load (`:2578-2580`). The first now follows the kind too, and Task 2a tests it. The on-load
  line keeps "Start again deletes it.", which stays true; OQ1 now says so.
- **M-2:** this header names what I rechecked instead of giving a count.
- **M-3:** Task 6a's re-run searches only the phrases that must be gone.
- **M-4:** Task 6b's search gets "repair recovery" back and includes `docs/backlog.md`.
- **M-5:** citations corrected: `LEFT_STATE` is at `:328-330`; the 409 comes from
  `setup-first-fiscal-api.ts:41`, and the restart request is at `:1072-1073`; the ordinary setup
  server's discovery route (`apps/server/src/discovery-api.ts:120-126`, `:75-81`) is cited beside
  the repair page's.
- **M-6:** `confirmation` no longer starts from `recovery-stopped`, and the help-line check names
  real elements.
- **M-7:** Check again's kind-keeping moves from Task 1 to Task 2a, beside its test. Task 2a now
  also tests the missing-database Check again (`:2588-2594`).
- **M-8:** Task 3 reads the incomplete-wipe words through `formErrors`.
- Also new: a Task 6b backlog entry for the setup page's "Contact support." message
  (`apps/setup/src/i18n/strings/shell.ts:8`), which breaks the refusal rule (CLAUDE.md §3). This is
  an entry only; it is not fixed here.

**Revision 2 (2026-10-31).** This revision folds the fresh plan review
(`~/waitron-campaign/item-a1131bc-3-plan-review.md`: 0 critical, 7 important, 12 minor; its probes
are in `~/waitron-campaign/a1131bc-3-plan-review-probes/`). I checked each finding against the code
before folding it. I re-read the code for I2, I5, M1, M8 and the citations I changed, and re-read
the review's P1 output for I6. For the rest I followed the review's reading or runs (P3 for I4).
Every finding is folded; M3 is folded by naming the departure, not by changing the page.
- **I1:** Task 1 loops over `cases` without the stopped-recovery row, because Recover is not drawn
  there until Task 2a (`setup-app.ts:2586`). That row moves into Task 2a.
- **I2:** with the database missing, the stopped-recovery line is drawn by the ask
  (`setup-app.ts:2566-2571`), not by the confirmation (read). For Recover it now uses
  `recoveryStoppedRecover` too. Task 2a tests both database shapes, and Task 4 has a state for each.
- **I3:** Check again keeps the kind the person chose (`#openWipeConfirmation(this.firstWipeKind)`).
  Task 2a tests the words that follow and Task 3 tests where Reconnect lands.
- **I4:** two setup pages cannot both open in one tab (the review's run P3: the second page's
  session cannot take the tab's lock). Task 2a now checks each refusal's expected words on one page
  at a time.
- **I5:** D6 is restated. Whether a page load starts on the "Is this page secure?" screen depends
  on the box's own certificate file (`setup-app.ts:822`; `first-setup-entry.ts:390-397` and
  `discovery-api.ts:120-126`, read), not
  on HTTPS. OQ2, N3, the guide bullets and the spec line now say what is true on a box with that
  file and on one without it.
- **I6:** Task 0 gains a third case: a wipe that discards a stopped recovery, then the ordinary
  restore. The record folder Start again keeps for the discarded recovery stays in the state folder
  (the review's run P1: `resolutions state true`, re-read here), so the case asserts that folder is
  absent from the venue folder only.
- **I7:** Task 6 is split into 6a (the guide pair) and 6b (the runbooks, README, backlog, mock-ups
  README and spec).
- **M1:** N2 now also names a "repairable" setup record (`first-setup-resolution-inspection.ts:340-349`,
  read): `wipeOffered` needs `pair === "valid"`, so Recover is lost there too. Added to the guide
  and backlog wording.
- **M2:** D3 now separates a refusal the box answered (both buttons hidden) from the wipe not being
  offered on load (both drawn disabled).
- **M3:** the approved picture 1 draws no Recover button beside Start again's confirmation, but
  today's page does (`setup-app.ts:2586`), and slices 1 and 2 shipped it that way. The behaviour is
  kept, and the departure from the picture is named in Task 5 and in the PR.
- **M4:** Task 5 checks for "no password field inside the confirmation". Continue's own password
  field stays drawn above it, as beside Start again.
- **M5:** D5 now also records the choice when the send answers `setup.start_again_incomplete`
  (the box restarts and finishes the deletion). Tested in Task 3.
- **M6:** the Spanish rule now allows Spanish literals in the one words test. Browser tests read
  `initialOwnerStrings`.
- **M7:** the fixture move adds `formErrors`, plus a `confirmation`/`fieldsIn` keyed by the Confirm's
  `data-test`.
- **M8:** Task 6b adds a dated pointer to the A731 decision (`docs/backlog/fiscal.md:783-787`, read)
  and checks `docs/backlog/setup.md:542`.
- **M9:** the unsaved-test row says its fixture must also answer `/start-again/summary`.
- **M10:** N1 gives the real reason for leaving the old `open` route served.
- **M11:** the bucket and Waitron Cloud restores after a wipe are still unmeasured. This is listed
  in N5 and gets a backlog line.
- **M12:** Task 4 finds `choose-restore` through the role screen's shadow root.

No new question for the owner.

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
  - Under the default, the stopped-recovery line drawn on load, before either button is pressed,
    keeps today's words ("…Start again deletes it."; `setup-app.ts:2578-2580`). That is true, but
    it names only Start again while both buttons are drawn. Recover's confirmation then says
    Recover deletes it first. If the owner wants on-load words naming both, that is a small
    follow-up (round 3, M-1).
  - **Alternative:** keep Recover hidden there, as today. This needs no new words, and the five
    changed checks marked OQ1 below stay unedited.
- **OQ2 — Reloading the page between the wipe and Reconnect.**
  - **Default (planned):** the choice lives in the page's memory only. It survives Reconnect,
    including Reconnects pressed while the box is still restarting (experiment E1, case B). A
    reload or a closed tab forgets it. The page then opens its first screen: "Is this page
    secure?" on a box that holds its own certificate file, the setup choice screen otherwise
    (`setup-app.ts:631`, `:822`). After the restart, the ordinary setup server answers that from
    `readBoxPublicCa` (`apps/server/src/discovery-api.ts:120-126`, `:75-81`, which also answers
    "no file" when the box is set not to serve it); the repair page answers it the same way
    (`first-setup-entry.ts:390-397`). The person presses **Continue to
    setup** if asked, then picks "Join or recover". That is what the spec's §6 already accepts after
    a power cut ("the ordinary setup page's first screen; the person picks 'Join or recover'"). It
    also keeps the page's rule that screens come "from in-memory state, never a URL route"
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
  secrets. Such a caller gets exactly today's old recovery, which then runs as it does on
  4c5ba38db until slice 4's reinstall page (the pre-live rule, CLAUDE.md §3). A server refusal of
  a new `open` (`first-setup-backup-recovery.ts:832-834`) would break the old recovery's server
  test suites, which slice 4 deletes anyway, so deferring it is cheaper. The lead may still add it.
- **N2 — Recover from backup is no longer usable when the setup record is unreadable or carries a
  repair marker.** Recover is drawn disabled like Start again in both cases. Today Recover opens
  the old recovery in both.
  - **Unreadable record** (the password cannot be checked): the inspection has no `revision`
    (`packages/provisioning/src/first-setup-resolution-inspection.ts:362-364`), the page draws
    `uncheckable` and `wipeUnavailable`, and the wipe is not offered (`wipeOffered`,
    `setup-app.ts:236-239`). Today's test for this is "opens independent backup repair with an %s
    setup password…", its `uncheckable` row.
  - **Repair marker** (pair `repairable`): the password is checkable and there is a revision, but
    `wipeOffered` also needs `pair === "valid"`, and a `repairable` pair is one whose claim marker
    needs repair (`:340-349`).
  - **The way out is a reinstall, unless the setup had saved nothing yet** (round 3, I-1).
    - For a `repairable` record, Continue with the setup password repairs the marker only when
      `repairEligible` is true (`packages/provisioning/src/first-setup-owner.ts:254-256`). That
      needs a present setup database with no rows, and no other file left behind
      (`first-setup-resolution-inspection.ts:365`). With the database present but holding rows,
      Continue answers `setup.not_ready` (run: "refuses marker repair when the existing database
      carries a taxpayer"). With the database missing, Continue is not drawn at all
      (`setup-app.ts:2514-2521` needs `!missing`), and `emptyDatabase` would be false anyway
      (`first-setup-resolution-inspection.ts:82`).
    - For an unreadable record, Continue is not drawn either (`setup-app.ts:2514-2521` needs
      `password === "checkable"` when no session is signed in).
    - Nothing else is offered in either case: Start again and Recover need `pair === "valid"`, and
      Abandon needs a signed-in session (`setup-app.ts:2627`).
  - The spec's own "For your information" covers both cases ("or a setup the box cannot show is
    safe to delete"). The guide's sentence "You can use this route even if the old setup password
    cannot be checked." goes.
- **N3 — Start again's landing is corrected (D6).** Today Reconnect after a successful Start again
  opens the venue screen with no mode chosen (experiment E1, case A). The spec's §1 step 3 says "the
  page's first screen, as today". After this slice it opens the setup choice screen ("Set up this
  Waitron server"). That is one step past the page's first screen on a box that holds its own
  certificate file, because the page is already on the box's secure connection.
- **N5 — Not measured: the bucket and Waitron Cloud restores after a wipe.** Only the backup-file
  restore was run after a wipe (spec "Open, not measured"; Task 0 and `:754`). The guide sends
  people to all three. A backlog line records the gap (Task 6b).
- **N6 — Departure from picture 1.** The approved picture 1 draws no Recover button beside Start
  again's confirmation, but the page has drawn it there since before slice 1 (`setup-app.ts:2586`),
  and slices 1 and 2 shipped it that way. This slice keeps it, and the PR's look-check notes name
  the departure (review M3).
- **N4 — What a box already inside an old recovery can still do.** See "Readers that keep working".
  In short: nothing reachable changes for those boxes, except that Recover from backup also
  discards a stopped recovery (OQ1).

## Global Constraints

- **Fiscal-adjacent.** Nothing changes in `packages/` (including `packages/fiscal-verifactu` and
  `packages/provisioning`), there is no migration, and `CLAUDE.md` is not edited. In `apps/server/`
  only `src/guide/{en,es}/backup-recovery.md`, `README.md` (one sentence, Task 6b) and the new test
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
- Spanish appears only in `initial-owner-strings.ts` and `apps/server/src/guide/es/`, and as
  literals in the one words test that pins them (`setup-app-resolution.test.ts`, "Start again's
  confirmation words…", as it already does at `:132-134`). Browser tests read
  `initialOwnerStrings`, never a Spanish literal. Task 1 checks that the help line is not drawn by
  asserting the confirmation's elements are exactly the expected ones, not by searching for its
  words (review M6).
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
  Only the drawing differs: the paragraph, the tick's words, Confirm's label and `data-test`, and
  the stopped-recovery line. That line is drawn by the confirmation with the database present
  (`setup-app.ts:2453`, `:2468`) and by the missing ask with it missing (`:2566-2571`); in both
  places it uses `recoveryStoppedRecover` when the kind is `"recover"` (review I2). The same goes
  for the line drawn after a failed summary read, beside Check again (`firstWipeUnread`,
  `setup-app.ts:2538`; round 3, M-1). The line drawn on load, before either button is pressed
  (`:2578-2580`), keeps `recoveryStopped` ("…Start again deletes it."). That is still true, though
  it names only one of the two buttons (OQ1). **Check again** (`:2544-2550`, `:2588-2594`) calls
  `#openWipeConfirmation(this.firstWipeKind)`, so it keeps the kind the person chose (review I3;
  built in Task 2a, round 3 M-7). The Start again and Recover buttons pass their own kind.
- **D2 — The §9b paragraph is three keys** (`recoverDeletes`, `noInvoiceSent`, `recoverThen`), so
  the middle sentence can be left out under §9a's rule. A test pins the joined text to §9b's exact
  sentence in both languages.
- **D3 — Where Recover is drawn and enabled.**
  - It is drawn wherever Start again's button is drawn, and is disabled exactly when Start again's
    is (`firstOwnerBusy || !offered || unsettled`, `:2397`).
  - So where the wipe is not offered on load (the inspection says so: uncheckable or `repairable`,
    N2), both are drawn disabled beside the page's `wipeUnavailable` line (`:2495-2498`).
  - Where the box answered a refusal (`firstStartAgainRefused` set), both are hidden (picture 3:
    "neither is offered").
  - It is also drawn beside Start again's own open confirmation, as today (N6), and pressing it
    there re-reads and opens Recover's confirmation.
  - It is not drawn beside its own open confirmation, nor in the missing ask when the wipe is not
    offered (`selected` or `uncertain` phase).
  - Under OQ1's default it is drawn beside a stopped recovery too.
  - `recover-backup` keeps its `data-test`.
- **D4 — The missing ask's "If you have a backup, recover from it."** (`missingBackup`) is drawn
  only when the Recover button is drawn beside it (Start again's confirmation with no stopped
  recovery). It is not drawn inside Recover's own confirmation, nor where Recover is not offered.
- **D5 — Carrying the choice across the restart** (spec "Open, not measured"; E1). A private field
  `#afterWipe?: "start-again" | "recover"` is set when `sendWipe` resolves, and also when the send
  is refused `setup.start_again_incomplete`. That refusal means the box asked for its own restart,
  and the start finishes the deletion (`apps/server/src/setup-first-fiscal-api.ts:1072-1073` asks for the restart; the answer is
  409, `:41`; spec
  §6). Its words ("Start again has not finished. Reload this page…", `shell.ts:9-10`) say to
  reload, which forgets the choice, but a person who presses Reconnect instead now lands where the
  kind says, not on the venue screen (review M5). `#reconnectFirstSetup` reads it
  in the no-claim branch (`:1548-1552`): `"recover"` opens `"role"`, `"start-again"` opens `"mode"`
  (D6), and unset keeps `"venue"` (the offering-failure path). It is cleared when used, when a
  Reconnect finds a claimed setup, and in `disconnectedCallback`. It survives a failed Reconnect.
  A reload forgets it (OQ2).
- **D6 — Start again lands on the setup choice screen (`"mode"`, "Set up this Waitron server").**
  The spec's §1 step 3 says "the page's first screen", but today the page opens the venue screen
  with no mode chosen (E1).
  - On a page load, the first screen is "Is this page secure?" (`"connection"`, `setup-app.ts:631`).
    The page moves past it by itself only when the box has no certificate file of its own to
    offer (`!discovery.caDownloadAvailable`, `:822`; the repair-page server answers that from
    `readBoxPublicCa(roots.stateDir)`, `first-setup-entry.ts:390-397`; after the restart the
    ordinary setup server answers from the same file, `discovery-api.ts:120-126`, `:75-81`).
  - After a wipe the person is already on the box's secure connection, because both wipe routes
    refuse plain HTTP. So Reconnect skips that screen and opens the choice screen directly. That is
    the first screen on a box without its own certificate file, and one step past it on a box with
    one (review I5).
  - The choice screen then shows its certificate note, because `connectionAnswered` is false
    (`:2748`); Task 5 checks that the note's words are true there.
  - The lead may drop D6. Task 3's Start-again test then pins `screen-venue` instead, and N3 is
    removed.
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
| Recover deletes where Start again would refuse | Task 2a "Recover from backup refuses where Start again refuses, in the same words: %s" (each §9c cause, against the expected words Start again's own tests pin; one page at a time, review I4; nothing sent); server: slice 2's §1a refusal rows (`first-setup-start-again-held.test.ts`, "refuses …, and deletes nothing"), which apply because the request is identical (Task 1 "Recover sends exactly what Start again sends: %s") |
| a refusal deletes something | the same server rows (disk snapshot equal, no confirmations folder); the page sends nothing after a summary refusal (Task 2a) |
| after the wipe the restore is not the ordinary fresh-box restore | server: `:754` and its control `:773` (held, no recovery); Task 0's missing-database case and control; Task 0's case beside a stopped recovery that the wipe discards (OQ1's path), with the boot-target check; page: Task 3 "from Join or recover, Restore from backup opens the fresh-box restore screen, and nothing went to the old recovery's routes" |
| the discarded recovery's record folder makes the restored box refuse to sell or run from it | Task 0's third case: `resolveFirstSetupBackupWorkspace` answers `absent` and `assertFirstSetupBackupBootTarget` resolves with the kept record folder present in the state folder (the review's run P1) |
| the old recovery is opened for a new recovery | Task 1 (no `setup-first-backup` mounted, no request to the old routes, in every case); D7 deletes the route; `pnpm --filter @waitron/setup typecheck` fails on any leftover `"first-backup"` goto |
| Recover deletes a stopped recovery without saying so | Task 2a "beside a stopped recovery (%s database), Recover is offered, names the recovery with recoveryStoppedRecover…", both database shapes (OQ1, review I2) |
| Check again turns a Recover into a Start again (wrong words, wrong landing) | Task 2a's Check-again case and Task 3's follow-through to Join or recover (review I3) |
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
| `setup-app-resolution.unsaved.test.ts` "asks before leaving an entered setup password for backup recovery" (`:52`) | Recover navigates, the leave warning opens, and Discard mounts `setup-first-backup` | retitle "Recover from backup opens its confirmation in place, keeping an entered setup password, with no leave warning": the warning stays closed, `setup-first-backup` is never mounted, `recover-deletes` is drawn and the field keeps its value. The fixture's `intercept` (`:53-59`) answers only `/backup/status`, so it must also answer `/start-again/summary` with `{ reached: "claimed" }` (`wizardApi` already answers `/backup/activity` with `null`, `apps/setup/test/first-setup-browser.ts`) (review M9) | D7 |

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

### Task 0: Server — pin the fresh-box restore after a missing-database wipe and after a wipe that discards a stopped recovery

**Files:** `apps/server/src/first-setup-start-again-held.test.ts` only (three cases after `:782`). No
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
- [ ] **Step 3 (review I6; OQ1's path):** add "a held setup database beside a stopped recovery,
  wiped (discarding the recovery), then the fresh-box restore writes into the usual folders".
  - Steps: `heldSetup()` (it has a stopped recovery), then `await (await askStartAgain(f)).run()`
    (`:281`; it signs the owner in with the file's helper first, which the wipe no longer needs, and
    sends `confirmRecoveryDiscard`). Then the same hour and staging steps as Step 1. This is the
    review's run P1 (`~/waitron-campaign/a1131bc-3-plan-review-probes/held-probe.diff`).
  - Assert: `runStagedRestore` resolves `true`; `venue.db` and `trading.env` exist;
    `first-setup-resolutions` is absent from the **venue** folder; `resolveFirstSetupBackupWorkspace(f.roots)`
    is `absent`; `assertFirstSetupBackupBootTarget(f.roots)` resolves.
  - The state folder's `first-setup-resolutions` is NOT asserted absent. Start again keeps the
    discarded recovery's record folder there (`backupRecoveryKept`,
    `packages/provisioning/src/first-setup-start-again-deletion.ts:237-260`; the held file's
    `LEFT_STATE`, `:328-330`), and the review's run P1 printed `resolutions state true`. Assert it
    is present, so a later change that removes it is seen.
  - The review's run P1 printed exactly these results ("Tests 2 passed", control
    `setup.attempt_uncertain`), so this is expected to pass. If it fails, STOP for the lead.
- [ ] **Step 4:** run the held file with `-t "fresh-box restore"`. Every case passes: the three new
  ones plus `:754` and `:773`. Prove the two wipe cases by deletion: comment out the wipe line
  (`startAgainMissing(f)`, or the `askStartAgain` run), see the case fail with the control's
  refusal (the review's run P2 printed `setup.attempt_uncertain` for the first), and restore the
  line. `git diff` on the file must then show only the three added cases. Ledger: the counts.
- [ ] **Step 5:** commit.

### Task 1: Recover opens the wipe confirmation with §9b's words

**Files:**
- `apps/setup/src/screens/initial-owner-strings.ts`: the four keys in Global Constraints.
- `apps/setup/src/setup-app.ts`: `firstWipeKind`; `#openWipeConfirmation(kind)`; the Recover
  button's handler; the confirmation drawing; and
  `#startAgainFirstSetup` renamed `#sendWipeFirstSetup`.
- New `apps/setup/test/wipe-browser.ts`. Move `t`, `text`, `formErrors`, `OWNER_HEADER`,
  `wipeFixture`, `Sent`, `summaryReads`, `sends` and `cases` out of `setup-app-wipe.test.ts`
  (`:35-174`) into it, and import them back. Generalise `confirmation` and `fieldsIn` (`:38-63`):
  `confirmation(app, confirm = "confirm-start-again")` walks from the first, in document order, of
  `recovery-record-damaged`, `setup-database-unreadable`, `start-again-deletes` or
  `recover-deletes`, to the actions holding `confirm` (review M7). It does not start from
  `recovery-stopped`: with the database present that block follows the paragraph
  (`setup-app.ts:2464-2468`), and with it missing the block is drawn by the ask, outside the
  confirmation (round 3, M-6).
- New `apps/setup/src/setup-app-recover.test.ts`.
- Add to `setup-app-resolution.test.ts`'s words test (`:127`).

**Interfaces — Produces:**
- `#openWipeConfirmation(kind: "start-again" | "recover"): Promise<void>`. The Start again button
  passes `"start-again"` and the Recover button `"recover"`. Check again keeps passing
  `"start-again"` until Task 2a.
- `@state() private firstWipeKind: "start-again" | "recover"`.
- `apps/setup/test/wipe-browser.ts` exports:
  - `wipeFixture(options)`, as today, plus an optional
    `status?: (path: string, headers: Headers) => Response | undefined`, checked before
    `wizardApi`'s own `/first-setup/status` answer (used in Task 3);
  - `cases`, `summaryReads`, `sends`, `OWNER_HEADER`, `text`, `formErrors`, `confirmation` and
    `fieldsIn`;
  - `OLD_RECOVERY_ROUTE = /\/resolution\/backup\/(open|resume|prepare|commit|close|renew|cloud\/)/`.

- [ ] **Step 1: Failing tests** in `setup-app-recover.test.ts`:
  - `for (const c of cases.filter((c) => c.activity === null))` (review I1: Recover is not drawn
    beside a stopped recovery until Task 2a, so that row is Task 2a's), "${c.name}: Recover sends
    exactly what Start again sends, with no password and no owner header, and never opens the old
    recovery":
    - press `recover-backup`; poll for `retire-confirmed`; `fieldsIn(confirmation(app,
      "confirm-recover"))` is `[]`;
    - tick it; press `confirm-recover`; exactly one send to `/resolution/start-again`, with body
      `{ inspectionId, revision: 1, ownerGeneration: 1, ...c.sent }`;
    - no `X-Waitron-Setup-Owner` on any request; `requests.some(r => OLD_RECOVERY_ROUTE.test(r.path))`
      is false; `app.shadowRoot!.querySelector("setup-first-backup")` is null after each step;
    - the text then contains `t.restarting`.
    - Fails today: Recover mounts `setup-first-backup`.
  - `it.each(locales)` "Recover's confirmation says §9b's words ($locale)", with `namedSummary` and
    the database `occupied`. Let `s = initialOwnerStrings[locale]`.
    - `recover-deletes`'s trimmed text equals `` `${s.recoverDeletes} ${s.noInvoiceSent} ${s.recoverThen}` ``
      (the words test pins each key's literal).
    - The tick's label equals `s.retireRecover` and its `name` is `retire-setup`.
    - `confirm-recover` shows `s.recoverBackup`, is disabled until ticked, and is `danger` after.
    - `start-again-deletes` and `confirm-start-again` are absent.
    - The help line is not drawn: `confirmation(app, "confirm-recover")` is exactly three
      elements, which match in turn `p[data-test=recover-deletes]`, `label` (holding
      `retire-confirmed`) and `wt-form-actions`. No `<p>` lies between them (review M6; round 3,
      M-6).
  - "with the setup database missing, Recover's confirmation leaves out the no-invoice sentence
    and uses the missing-database tick": the paragraph equals `${recoverDeletes} ${recoverThen}`;
    the tick's label is `missingConfirm` and its name `missing-database-confirmed`;
    `missing-reached` is drawn; `missingBackup` is not in the text (D4).
  - "a setup database the box cannot read all of: Recover's confirmation draws
    setupDatabaseUnreadable and leaves out the no-invoice sentence".
  - Review Focus 4: "switching the language while Recover's confirmation is open redraws it in
    Spanish and keeps the tick": open it in EN, tick, `setLocale("es-ES")`, `await
    app.updateComplete`. The paragraph equals the joined `initialOwnerStrings.es` keys, the tick is
    still checked, and the summary was read once.
  - In `setup-app-resolution.test.ts`'s words test: `expect(en.recoverDeletes).toBe(…)`, and the
    same for `recoverThen`, `retireRecover` and `recoveryStoppedRecover`, in EN and ES, with the
    Global Constraints literals. Also the joined EN paragraph equals §9b's exact sentence ("Recover
    from backup first deletes what was entered in the setup that stopped part way. No invoice was
    sent to AEAT. Then you choose the backup."), and the joined ES one equals §9b's ES sentence.
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

**Files:**
- `apps/setup/src/setup-app.ts`: D3, D4, D7, D9, and D1's stopped-recovery line (in the
  confirmation with the database present, in the missing ask with it missing, and after a failed
  summary read). Also D1's Check again, which passes `this.firstWipeKind` at both of its buttons
  (`:2544-2550`, `:2588-2594`; moved here from Task 1 so it lands beside its tests, round 3 M-7).
- `apps/setup/src/setup-app-recover.test.ts`.

- [ ] **Step 1: Failing tests** (in `setup-app-recover.test.ts`):
  - **Refusals (review I4: one page per tab; the review's run P3 shows a second page in the same
    tab cannot take the session's lock).** `it.each` over `[cause, expected]`:
    - `setup-finished` → `s.setupFinished`
    - `trading-settings` → `` `${s.tradingSaved} ${s.tradingSavedPassword}` ``
    - `kept-records` → `s.keptFault`
    - a plain `setup.not_ready` error → `s.wipeUnavailable`
    - a plain `setup.owner_required` error → `s.wipeUnavailable`

    Title: "Recover from backup refuses where Start again refuses, in the same words: %s". Press
    `recover-backup` with `summary: () => refusedCause(cause)` (or the plain error).
    `start-again-refused`'s trimmed text equals `expected`, which is the same table Start again's
    own refusal tests use (`setup-app-wipe.test.ts`, `setup-app-held-refusals.test.ts`).
    `recover-backup`, `start-again`, `retire-confirmed` and both Confirms are absent;
    `reconnect-first` is drawn; nothing goes to `/resolution/start-again`. Fails today: Recover
    navigates to the old screen. After Step 3, it would fail if Recover stayed drawn beside the
    refusal (`setup-app.ts:2586`).
  - **Not offered on load (N2, D3).** `it.each` over the uncheckable pairing (`password:
    "uncheckable", revision: null, ownerGeneration: null`) and `pair: "repairable"` (password
    checkable, revision 1). Title: "where the wipe is not offered (%s), Recover from backup is
    drawn disabled like Start again, and nothing is read". Both buttons are disabled,
    `wipeUnavailable` is drawn (plus `uncheckable` in the first row), no summary is read, and no
    `setup-first-backup` is mounted. Fails today: Recover is enabled.
  - "in the missing ask, a backup phase %s offers neither button and no 'If you have a backup'
    line" (`selected` and `uncertain`, using `missingDatabaseFixture` from
    `apps/setup/test/missing-database-browser.ts`; press `start-again` to reach the ask). For
    `uncertain`, `recovery-unreadable` is drawn. Fails today: Recover is drawn.
  - Review Focus 3: "pressing Recover beside Start again's open confirmation reads the box again
    and opens Recover's confirmation instead". Open Start again's confirmation; Recover is drawn
    beside it (N6); press it. `summaryReads` equals 2; `recover-deletes` is drawn and
    `start-again-deletes` absent; `recover-backup` and `start-again` are absent; tick and Confirm
    send once. Fails today: Recover navigates away.
  - **OQ1, both database shapes (review I1, I2).** `it.each` over:
    - `present`: `wipeFixture` with `activity: stoppedActivity`, `summary: stoppedSummary`, body
      `{ …ids, confirmRecoveryDiscard: { shown: stoppedSummary } }`;
    - `missing`: `missingDatabaseFixture` with `backupPhase: "prepared"`, `activity:
      stoppedActivity`, `summary: stoppedSummary`, body
      `{ …ids, confirmMissingDatabase: { nothingFiledOrSold: true, shown: stoppedSummary } }`.

    Title: "beside a stopped recovery (%s database), Recover is offered, names the recovery with
    recoveryStoppedRecover, and sends what Start again sends". Press `recover-backup`. The first
    line of the one drawn `recovery-stopped` block equals `recoveryStoppedRecover` with `{started}`
    filled by `shownAt`, and no text contains `recoveryStopped`'s "Start again deletes it". The
    second line is the existing last-active line. Tick, Confirm; the body is as listed. Fails
    today: Recover is not drawn there.
  - **Check again keeps the choice (review I3).** "after a failed summary read beside a stopped
    recovery, Check again from Recover reopens Recover's confirmation". Use `wipeFixture` with
    `activity: stoppedActivity` and a summary that answers 500 `server.internal` on read 0 and
    `stoppedSummary` after. Press `recover-backup` and poll for `check-again`. Before pressing it,
    the first line of `recovery-stopped` equals `recoveryStoppedRecover` with `{started}` filled,
    and the text has no "Start again deletes it" (round 3, M-1: the line drawn at
    `setup-app.ts:2538`). Press it. Then `recover-deletes` and `confirm-recover` are drawn, and
    `start-again-deletes` is absent. Fails today (Recover navigates away), and fails without D1's
    Check-again change. Prove that by deletion once built: pass `"start-again"` from that Check
    again, see it fail, restore. Task 3 follows the same path through to Reconnect.
  - **The missing-database Check again (round 3, M-7).** "with the database missing and a recovery
    not yet settled, Check again from Recover reopens Recover's confirmation". Use
    `missingDatabaseFixture` with `summary: stoppedSummary` and a `/backup/status` answer of phase
    `selected` on its first read and `prepared` after. With a recovery in the summary and a phase
    outside the stopped ones, the page treats the recovery as not yet settled (`#readMissingAsk`,
    `setup-app.ts:1355-1357`). Press `recover-backup` (drawn on load with the database missing),
    then poll for `check-again` and `recovery-unreadable` (the button at `:2588-2594`). Press it.
    Then `recover-deletes` and `confirm-recover` are drawn, the ask's stopped line equals
    `recoveryStoppedRecover`, and Confirm sends `confirmMissingDatabase` with `stoppedSummary`.
    Prove by deletion as above, at the second Check again.
  - Review Focus 5: "a Recover send refused kept-records closes the confirmation, says the setup
    changed, and offers Recover again" (`startAgain: () => refusedCause("kept-records")`).
    `heldChanged` is among `formErrors(app)`; `recover-backup` is enabled and holds focus
    (`app.shadowRoot!.activeElement` is the `recover-backup` host). Fails today.
- [ ] **Step 2:** run `src/setup-app-recover.test.ts`. The new cases fail as stated.
- [ ] **Step 3: Implement** D3, D4, D7, D9, D1's stopped-recovery line and D1's Check again. For
  D7: delete the
  `Screen` member, the render case and the two `#onGoto` branches, then run
  `rg '"first-backup"' apps/setup/src --glob '!*.test.ts'`, which must print nothing.
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
  - D6: "after Start again's wipe, Reconnect opens the setup choice screen": `screen-mode` is
    drawn. Fails today: `screen-venue`. If the lead drops D6, write this test as "…opens the venue
    screen, as before" and expect `screen-venue`.
  - Review I3: "after Recover, a failed summary read and Check again, the wipe's Reconnect still
    opens Join or recover". This is Task 2a's Check-again path, carried on: tick, confirm,
    `restarting`, Reconnect, then `screen-role`. It fails if Check again dropped the kind.
  - Review M5: "a Recover send answered setup.start_again_incomplete keeps the choice: Reconnect,
    once the box answers no setup, opens Join or recover". The `startAgain` answer is 409 `{ error:
    { code: "setup.start_again_incomplete", params: {} } }`; the status then answers
    `{ claimed: false }`. `formErrors(app)` contains
    `shellEn["shell.first_setup.start_again_incomplete"]`; those words are drawn inside
    `wt-form-actions`' own shadow root, where `text(app)` cannot see them (round 3, M-8). Then
    Reconnect leads to `screen-role`. Fails without D5's extra case (`screen-venue`).
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

- [ ] **Step 1:** the loops run over `en-GB`/`es-ES` × `light`/`dark` × 390/1280 px × six states:
  - `recover-confirmation`: database `occupied`, `namedSummary`, ticked (picture 2);
  - `recover-missing`: database missing, ticked;
  - `recover-stopped-present`: OQ1, database `occupied`, `stoppedActivity`, `stoppedSummary`;
  - `recover-stopped-missing`: OQ1, database missing, `backupPhase: "prepared"`, `stoppedSummary`
    (review I2);
  - `refused-fault`: reached by pressing `recover-backup` (picture 3);
  - `join-or-recover`: after the wipe and Reconnect, `screen-role`.

  Each state:
  - runs `expectNoA11yViolations(host)`;
  - checks that `document.documentElement.scrollWidth` is at most the width and that the section's
    right edge is inside it;
  - focuses its control, asserting that the control takes focus and has a width. The controls are
    `confirm-recover` for the four confirmation states and `reconnect-first` for `refused-fault`.
    For `join-or-recover` it is `choose-restore`, which lives inside the role screen's shadow root:
    `q(app, "screen-role")!.shadowRoot!.querySelector("[data-test=choose-restore]")`, then the
    `wt-button`'s own `shadowRoot` `button` (review M12);
  - when `import.meta.env.VITE_A1131BC_RECOVER_LOOK === "1"`, saves
    `__screenshots__/a1131bc-recover/${locale}-${theme}-${width}-${state}.png`, as
    `setup-app-held-database.a11y.test.ts:91-94` does.
- [ ] **Step 2:** check memory, run the file, and read the count (expect 48). A violation is fixed
  in the page, never in the test. Commit.

### Task 5: Look check (pictures 2 and 3, and Join or recover)

- [ ] Check memory, then run
  `env -u AI_AGENT -u CLAUDECODE VITE_A1131BC_RECOVER_LOOK=1 pnpm --filter @waitron/setup exec vitest run src/setup-app-recover.a11y.test.ts`.
  Copy the PNGs from `apps/setup/src/__screenshots__/a1131bc-recover/` to
  `~/waitron-campaign/a1131bc-3-shots/`, then delete them from the worktree. Never commit a shot.
- [ ] Open, for each state: EN and ES × light and dark at 390 px, and EN light at 1280 px. The
  shots pass when:
  - **`recover-confirmation`** matches `docs/backlog/mockups/a1131bc-restore/2-recover-confirm.png`
    (and its `-dark`/`-es` twins) in order and words: heading "First setup was interrupted", the
    three-sentence paragraph, the tick, Cancel, a red **Recover from backup** once ticked,
    Reconnect, and "Set up secure connection".
    - The mock-up's help line ("This box will not use…") must NOT appear (dropped, Global
      Constraints).
    - No password field **inside the confirmation**. Continue's own password field and button stay
      drawn above it, as they do beside Start again's confirmation (`setup-app.ts:2514-2533`).
      The mock-up leaves them out, so name that difference in the ledger (review M4).
  - **`refused-fault`** matches `3-refused-fault.png`: the `keptFault` words, Reconnect and the
    link, and neither Start again nor Recover from backup.
  - **`recover-missing`**: the missing-database lines, the two-sentence paragraph and the "Nothing
    was filed…" tick, with no "If you have a backup" line.
  - **`recover-stopped-present`** and **`recover-stopped-missing`**: the stopped recovery's two lines
    with OQ1's words, and no "Start again deletes it".
  - **`join-or-recover`**: the role screen as on a new box.
  - **Start again's confirmation** (from the existing held a11y shots, or opened by hand): Recover
    from backup drawn beside it, which picture 1 does not show. Name this in the ledger and the PR
    as N6, not as a fault.
  - **The setup choice screen after Start again's Reconnect** (D6): open it once. Its certificate
    note (`mode.cert_note`; drawn because `connectionAnswered` is false, `setup-app.ts:2748`) must
    read true for a person already on the box's secure connection. If it does not, record it and
    tell the lead; do not change the words here.
  - At 390 px nothing overflows the card and every line wraps; dark-theme text is legible.

  Write what was opened and seen into the ledger.

### Task 6a: The user guide pair

**Files:** `apps/server/src/guide/en/backup-recovery.md`, `apps/server/src/guide/es/backup-recovery.md`.

Find every sentence again with
`rg -n -i "recover from backup|recuperar desde una copia|open backup|abrir copia|finish saved recovery|finalizar la recuperación guardada|even if the old setup password|aunque no se pueda comprobar la contraseña|does not offer \*\*recover|no ofrece \*\*recuperar" apps/server/src/guide`.
Hits read on 4c5ba38db: EN `:5-8`, `:31`, `:72-96`, `:127-152`; ES `:5-8`, `:33` and the same
sections.

After the edit, EN and ES must say the same, and each must say:
- **`#interrupted-setup`:**
  - **Start again** and **Recover from backup** delete the failed setup the same way, with no
    password, and both are refused in the same cases, in the page's words.
  - Neither can be used when the setup's own record cannot be read, or carries a mark that needs
    repair. Then the only way out is to reinstall Waitron, unless the setup had saved nothing yet,
    in which case **Continue** with the setup password repairs the record and carries on (N2;
    review M1; round 3, I-1).
  - Pressing Recover from backup shows §9b's words (quoted) and its tick. With the database
    missing, it shows the missing-database lines and the "Nothing was filed…" tick.
  - After confirming, the box restarts. **Reconnect** opens "Join or recover an existing
    restaurant", where you choose Restore from backup or Restore from my bucket. Restore from
    Waitron Cloud is reached from the backup screen.
  - If the page is reloaded before Reconnect, it opens its first screen. If that screen asks "Is
    this page secure?", press **Continue to setup**, then choose **Join or recover** (OQ2, review
    I5). This sentence is true with and without the box's own certificate file.
  - After **Start again**, Reconnect opens the screen where you choose how to set up this box
    ("Set up this Waitron server"), not the details form (D6, review I5).
  - Restoring needs the backup's own key and its node recovery key, as on a new box.
  - Delete:
    - "You can use this route even if the old setup password cannot be checked" (N2);
    - the "old attempt and its files stay in their own folders" sentence;
    - "does not offer **Recover from backup** beside it" (OQ1 default).
  - The running, stopped and Cloud-approval paragraphs stay. One sentence before them says they
    describe a recovery from backup begun on the repair page before this version of Waitron, which
    no longer starts one. Their "Start again deletes it" becomes "Start again or Recover from
    backup deletes it".
  - The full-disk and "files found" paragraphs are unchanged.
- **`#source`, `#proof`, `#series`, `#resume`:** rewritten for the fresh-box restore screens.
  - Before writing, read `apps/setup/src/screens/restore-screen.ts`, `restore-bucket-screen.ts`,
    `cloud-restore-screen.ts`, `recovery-copy.ts` and `recovery-allocation.ts`, and their strings in
    `apps/setup/src/i18n/strings/restore.ts` and
    `packages/fiscal-verifactu/src/setup/recovery-hour.ts`.
  - Name only controls those files draw, checking each bold label by `rg` in those string files.
  - What happens if the restore stops part way follows the spec's §2 bullets: before Restore is
    pressed, after the request is saved, and while it is written.
  - Do not mention N5 (only the backup-file restore has been run after a wipe): the guide
    describes what the page does, not what was tested. N5 goes in the backlog and the PR.
  - The Backups-settings paragraphs (EN `:98-125`, ES the same) stay, unchanged.
  - The five headings and `{#id}`s stay, so `apps/server/src/guide-backup-recovery.test.ts` stays
    unedited. `docs/backlog/setup.md:542` links "Choose your copy" (`#source`), and its sentence
    stays true (review M8).

- [ ] **Step 1:** edit, then run `pnpm exec prettier --write` on both files. Read each file whole
  afterwards.
- [ ] **Step 2:** check that the retired phrases are gone (round 3, M-3):
  `rg -n -i "open backup|abrir copia|finish saved recovery|finalizar la recuperación guardada|even if the old setup password|aunque no se pueda comprobar la contraseña|does not offer \*\*recover|no ofrece \*\*recuperar|stay in their own folders|se conservan en sus propias" apps/server/src/guide`
  prints nothing. The broader search also hits the page title and the new **Recover from backup**
  sentences, which is expected; read those hits for truth instead.
- [ ] **Step 3:** `… pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-backup-recovery.test.ts`,
  then root `scripts/guide-links.test.ts`. Commit.

### Task 6b: Runbooks, README, backlog, mock-ups README, spec

**Files:** `docs/operations/first-live-fiscal-setup.md`, `docs/operations/hour-recovery.md`,
`docs/operations/backups-and-support.md`, `apps/server/README.md`, `docs/backlog.md`,
`docs/backlog/setup.md`, `docs/backlog/fiscal.md`, `docs/backlog/mockups/a1131bc-restore/README.md`,
and the spec (one dated line).

Find every sentence again with Task 6a's search plus `repair recovery` (round 3, M-4), run over
`docs/operations docs/backlog docs/backlog.md apps/server/README.md`. Hits read on 4c5ba38db:
`first-live-fiscal-setup.md:128-129`, `:142-143`, `:163-164`; `hour-recovery.md:30-54`;
`backups-and-support.md:22-28`; `docs/backlog/setup.md:456`, `:542`, `:747-758`, `:823-826`;
`docs/backlog.md:622-624`; `docs/backlog/fiscal.md:783-787` (found by review M8).

After the edit each must say:
- **Runbooks:**
  - `first-live-fiscal-setup.md` says Recover from backup is offered wherever Start again is, runs
    the same wipe, and leads to Join or recover and the [ordinary restore](hour-recovery.md).
    `:128` loses "unless a backup recovery has stopped (below)", `:142-143` loses "offers no
    **Recover from backup** beside it", and `:163-164` is rewritten. The reload and Start-again
    landing sentences use Task 6a's wording (review I5).
  - `hour-recovery.md` "Recover while first setup is blocked" keeps its heading, because other
    files link its anchor. Its body becomes: press Recover from backup, confirm, Reconnect, choose
    the copy on Join or recover, then follow "Check the selected copy" and "Make the new series"
    above. The old paragraphs about Open backup, Finish saved recovery and the five-minute lease
    go.
  - `backups-and-support.md:22-28` says the same in two sentences.
- **`apps/server/README.md:49-52`:** after "recovery from a backup (under
  `/setup-api/first-setup/resolution/backup/`)" add ", which the setup page no longer starts (it
  goes in A1131bc slice 4)".
- **Backlog:**
  - `docs/backlog.md` A1131c: "Slices 2 and 3 landed; slice 4 (deleting the old recovery-folder
    code, and the old routes' `open`, N1) is still to come."
  - `docs/backlog/setup.md` A1131c detail (`:747-758`): slice 3 as landed, with this plan's path;
    slice 4 still to come.
  - The decision line at `:823-826` gains "(2026-10-31, A1131bc slice 3: Recover from backup's half
    is built; slice 4 deletes the old recovery code.)".
  - `:456` ("A resume can use the room the spare file gave"): "the page does not offer **Recover
    from backup** beside a stopped recovery" becomes "since A1131bc slice 3 the page's Recover from
    backup discards a stopped recovery rather than resuming it". The rest is kept.
  - `:542` (A1143): check that it is still true against Task 6a's `#source`. It should be: the
    restore still takes only a backup file, a bucket copy or a Waitron Cloud copy.
  - `docs/backlog/fiscal.md:783-787`, the A731 decision ("Keep unrelated local records opaque and
    retain their files … Follow repair recovery"): never deleted. It gains "(2026-10-31, A1131bc
    slice 3: a new recovery no longer keeps the failed setup's files; Recover from backup deletes
    the setup first, then uses the ordinary restore. The anchor now describes that.)" (review M8).
  - New short entries in `docs/backlog/setup.md`, each "Left open by A1131bc slice 3", with
    one-line pointers in `docs/backlog.md`:
    - N2: no Recover from backup when the setup record is unreadable or carries a repair mark.
      The only way out is a reinstall, unless the setup had saved nothing yet (then Continue
      repairs the record). Review M1; round 3, I-1;
    - N5: the bucket and Waitron Cloud restores have not been run after a wipe (review M11);
    - the setup page's message for an unreadable saved setup ends "Contact support."
      (`shell.first_setup.attempt_invalid`, `apps/setup/src/i18n/strings/shell.ts:8`). That sends
      the person to somebody else, against CLAUDE.md §3's refusal rule. Wanted: say what happened
      and what each choice does. Noticed while planning A1131bc slice 3 and not fixed there
      (pre-existing; `git log -S "Contact support" -- apps/setup/src/i18n/strings/shell.ts` gives
      its origin when the entry is written).
  - Under "Decisions and deliberate limits": OQ2's default (a reload between the wipe and Reconnect
    forgets the choice).
- **Mock-ups README:** one dated line under the table: "2026-10-31, A1131bc slice 3: the help line
  in pictures 1 and 2 is not drawn (A1206 removed what it described); the page also draws Recover
  from backup beside Start again's confirmation, which picture 1 leaves out."
- **Spec:** one dated line under its header: "2026-10-31, slice 3 plan: §1 step 3's 'as today' for
  Start again was false — Reconnect opened the details form with no mode chosen (plan E1); slice 3
  lands Start again on the 'Set up this Waitron server' choice screen and Recover from backup on
  'Join or recover'; the choice is held in the page's memory, so a reload opens the page's first
  screen, which on a box with its own certificate file asks 'Is this page secure?' first (plan D5,
  D6, OQ2); §7's `box-folders.ts` was deleted by A1206; Recover from backup is offered beside a
  stopped old recovery (plan OQ1)."

- [ ] **Step 1:** edit, then run `pnpm exec prettier --write apps/server/README.md`. `docs/` is
  Prettier-ignored, so READ each edited runbook section and backlog entry whole afterwards
  (CLAUDE.md §1: a behaviour change retires every receipt about the old behaviour).
- [ ] **Step 2:** re-run the search. Expect only: the spec, slice 2's plan, this plan,
  `docs/operations/a679-changed-checks.md` (a dated record),
  `first-live-fiscal-setup-2026-10-15.md` (dated), and the dated pointers just added. Investigate
  any other hit.
- [ ] **Step 3:** root `scripts/claude-md-pointers.test.ts`, then `pnpm format:check`. Commit.

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
  Tasks 4 and 5. The user guide → Task 6a; the other docs → Task 6b. Fiscal-adjacent → the risk table, full review and Task 7.
  §9b's help line dropped → Global Constraints, Tasks 1 and 5. §1a "no longer offered where
  refused" → Task 2a. The spec's "boxes already inside one keep the old code" → "Readers that keep
  working", and Task 7's diff check.
- **Not in this slice:** deleting the old recovery code, its routes, its strings, its screen
  component and its guide-free docs (`deploy/README.md:283`, `:325`, `:334`;
  `docs/developers/conventions-ui.md:1130`; `docs/developers/conventions-data.md`), which is slice
  4's work.

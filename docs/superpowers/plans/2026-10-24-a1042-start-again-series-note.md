> **Later A950 authority, 29 October 2026:** the owner approved its [implementation plan](2026-10-29-a950-automatic-upgrades.md), option A. The earlier pending-plan note below is superseded. The newer/unknown/damaged-floor and fiscal boundaries remain.

# A1042: "Start again" keeps one small note, not an archive — implementation plan

> **A950 pointer, 29 October 2026:** use the [approved A950 design](../specs/2026-10-27-a950-automatic-upgrades-design.md)
> for current rollback scope. It restores the captured application volume set while retaining
> logs, host evidence and the newest floor overlay; it closes rollback after a clean, running
> restart. Earlier first-order titles and whole-volume descriptions below are historical.
> The newer/unknown/damaged-floor requirements and A1042's owner decisions remain. The A950 plan
> awaits owner approval before any build.

> 2026-10-26 (A1137): the backup API checks referenced below now span
> `setup-first-backup-api.test.ts` and `setup-first-backup-api-adapters.test.ts`.
> Run both files to include the queued-commit and provider-adapter cases.
> The original test blocks and assertions are unchanged.


> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Task 0 re-runs a fresh-context review of this plan against main after A731 lands, before any implementer is dispatched.**

**Revisions, 2026-10-24.** Revised three times for fresh-context reviews, all with probes run on main: `~/waitron-campaign/item-a1042-plan-review.md` (round 1: 4 high, 4 medium, 8 low), `item-a1042-plan-review-2.md` (round 2: 2 high, 6 medium, 4 low) and `item-a1042-plan-review-3.md` (round 3: 3 high, 6 medium, 7 low). The PR description lists each finding and what changed. Round 2 corrected the plan's account of `node.db`: it holds no tables at all. Round 3 corrected the recovery-page wording to the owner's never-reset rule and covered the record store's nested step folders.

**Revision 4, 2026-10-24 (the owner's seven answers).** The answers are in "Owner answers (2026-10-24)" below. What changed: a Start again on a missing venue database now **asks** the person and proceeds only on a confirmation recorded before anything is deleted (D3a, Task 3a); the note is **never deleted** by anything but `waitron.sh reset --all`, and is only ever replaced by a later name (D1); a reinstall from the USB stick should **keep** the note, drafted as a change to B3's design ("For the owner: what waits for approval", part 3); a plain `waitron.sh reset` keeps it (Task 6b). The items of "Existing assertions this plan changes" that the owner already approved are marked so; the ones these answers change are rewritten and marked "REVISED — needs owner approval", and go back to the owner with the screen wording ("For the owner: what waits for approval", part 2) and the B3 change **before any build**. Every file and line revision 4 cited was re-read at main 69a7e2ae3; `git diff --stat db4e0a6bf..69a7e2ae3` over the files the assertion list names prints nothing, and over the whole tree it lists three `packages/provisioning` configuration-transfer files, none of them cited.

**Revision 5, 2026-10-24 (A731 landed; round-4 review).** Lane E's A731 landed as main 40eed0cde ("Recover authenticated backups from the interrupted setup page", #2043); this branch was rebased onto it. Task 0 Step 3's checks (e), (i), (j), (k), (l) and a new (m) were run by reading the landed code, and the results are in "What A731 changed" below. The fresh-context review of revision 4, `~/waitron-campaign/item-a1042-plan-review-4.md` (6 medium, 12 low), is folded in: the confirmation now carries the summary the page **displayed** (M2); a backup recovery that was started and given up no longer blocks Start again for good, pending the owner (point 5, M3); A731's records in both the state and the venue folder are named (M4); a plain reset of an unfinished setup is part of point 1 (M5); Tasks 3a2, 3d and 3e are split (M6); every low finding is applied. Everything waiting for the owner is now in one section, "For the owner: what waits for approval". Line references into the setup app, the repair page's strings, the setup client and `first-setup-entry.ts` were re-read at 40eed0cde; references into `node-entry.ts`, `first-setup-launch.ts` and `boot.ts` (D5, Tasks 5c and 5e) were moved by A731 and are refreshed by Task 0 Step 5 before Task 5c (examples: `runEntry`'s call of `resolveFirstSetupEntry` is now `node-entry.ts:326`, `assertOtherAllowed` now `boot.ts:1123`).

**Revision 6, 2026-10-25 (Task 0 Steps 1–5 at main 91aa8dfe0; the owner's answers).** Task 0's re-check ran on main 91aa8dfe0; its results are under Task 0, "Task 0 results". No code file this plan cites changed after 40eed0cde except `apps/server/src/start-full-disk.e2e.test.ts` (four lines added above S22's case), so the line references read at 40eed0cde stand; the `node-entry.ts`, `first-setup-launch.ts` and `boot.ts` references that were still at db4e0a6bf are refreshed, as are Task 7's document references. Step 3 (m) was **run** with A731's own fixtures, for an archive source and for a Cloud source. The owner's answers of 2026-10-25 are folded in: every point, part and test change in "For the owner: what waits for approval" is approved, with one wording change (the repair page says "activation", not "the fiscal step"). What Task 0 found that the owner has not yet seen is in "Task 0 findings that need the owner", below.

**Revision 6, 2026-10-25:** Task 0's re-check, the owner's 2026-10-25 answers, and the round-6 review (`~/waitron-campaign/item-a1042-plan-review-6.md`, 1 high, 5 medium, 10 low) folded in.

**Goal:** when the owner presses **Start again** on an unused first setup, the box checks once that the attempt never activated, filed or sold anything — or, when the venue database is missing and nothing can be checked, asks the person and records their answer — deletes the attempt, and keeps one small note: the last invoice series name any attempt chose. From then on the box never issues a series name at or before that note.

**Architecture:** the note is one small file in the box's own settings folder (the "state folder", `WAITRON_STATE_DIR`), written only by Start again, only ever replaced by a later name, never deleted except by `waitron.sh reset --all`, and never carried in or written by a backup. Every place that picks a new production series name — first setup, a restore, a re-registration and a promotion — adds the note to the history it already checks, as a "time floor" (the earliest moment a new name may be taken). A second small file, written before any deletion and removed after it, names exactly what Start again is deleting, so a deletion cut off by a power cut is finished safely or refused with a page that says what to do. When the venue database is missing, a third kind of small file — one per confirmation, kept beside the note — records who confirmed that nothing was filed or sold, when, and what the attempt's own record showed them. The kept copies of abandoned attempts ("retirement archives") and the separate folder each new attempt used to get (a "workspace") are removed.

**Tech stack:** TypeScript, Node's `node:sqlite`, Vitest (real databases through `useVenueDb`), Lit and Chromium for the setup screens.

**Spec:** the owner's ruling of 2026-10-24 04:39 (`~/waitron-campaign/questions.md`, "OWNER ANSWER — A1037's open question: neither; replace the archive with one small note") and the queue entry A1042 (`~/waitron-campaign/queue.md`). Read both with this plan. The ruling supersedes "Preserve the original attempt and artifacts" in `docs/superpowers/specs/2026-10-16-a679-hour-coded-series-design.md:157`.

**Before the build:** the owner answered the seven questions on 2026-10-24, and on 2026-10-25 approved everything in "For the owner: what waits for approval": points 1–5 as recommended (1A, 2A, 3A, 4A, 5B), the screen wording for a missing database with one change ("activation" in place of "the fiscal step", part 2), the proposed B3 change as written (part 3), and every test change marked REVISED or NEW (part 4). Task 0 Steps 1–5 ran on main 91aa8dfe0 (2026-10-25). Before Task 4b1 and Task 5a, the owner approves the items in "Task 0 findings that need the owner". Task 0 Step 6's fresh-context review ran on 2026-10-25 (round 6) and is folded in.

## Task 0 findings that need the owner

Found by Task 0 Steps 3, 5 and 6 on 2026-10-25 (main 91aa8dfe0). Nothing in items 1 and 2 is built until the owner answers; item 3 needs no answer.

1. **Three more existing test cases change, all in A731's suites** (STOP rule: a changed or deleted existing assertion waits for the owner). They are listed in full as S25, S26 and P8 under "Existing assertions this plan changes".
   - **S25.** `apps/server/src/first-setup-backup-history.test.ts:239-311` "reads both retained and current databases after an ordinary workspace selection": builds a box that today's Start again moved into a workspace and checks that A731's backup history reads both the kept (archived) database and the new one (`:311`). Proposed: deleted, subject gone — there are no archives or workspaces after this change. Task 4b1.
   - **S26.** The same file, `:682-710` "reads retained outside evidence privately from archived snapshots, and refuses unreadable JSON" and `:726-735` "does not pass another module's retained setup context to the requested module". Both hand an attempt to `readFirstSetupBackupSetups` through its `retired` argument — the argument that carries archived attempts, which goes with the archive reader. Proposed: `:682-710` deleted, subject gone (outside evidence inside archived snapshots); `:726-735` rebuilt to hand the same attempt through the `roots` argument **with canonical roots** (`realpath`; the fixture's raw roots are refused `module.operation_invalid`, because the stored folders must equal the ones given: `parseFirstSetupState`, called at `apps/server/src/first-setup-backup-setups.ts:66`), its one assertion (`toEqual({ setups: [], publicEvidence: [] })`) unchanged — if that rebuild cannot keep the assertion, STOP. That assertion would also pass if `roots` were never read, so one **new** case beside it is the control: the same call for the real module returns one setup. The round-6 reviewer ran all three in a scratch test, since deleted: `OTHER {"setups":[],"publicEvidence":[]}`, `SAME setups 1 evidence 0`, and with the raw roots `module.operation_invalid`. Task 4b1.
   - **P8.** `packages/provisioning/src/first-setup-backup-workspace.test.ts:328-376` "rejects V1's retired source as a raw boot target while its V2 repair is pending": builds a workspace through today's Start again records. Proposed: deleted, subject gone (no workspaces; such a box is refused at the start, D4). Task 5a.
2. **Point 5 B costs more than the plan could say before.** Run on 2026-10-25 (Task 0 results, (m)): once a recovery has been prepared, A731 refuses any **other** backup into it — `setup.attempt_conflict`, both with and without the recovery's id — and accepts the same backup again (the control). So a person who starts a recovery and gives up can afterwards only finish a recovery **with that same backup**, or have Waitron reinstalled. Point 5 B stands as approved unless the owner says otherwise. If the owner wants the page to say so, one possible longer `recoverBackupNote` (not adopted; the approved words stay until the owner chooses): "After you start a recovery, Start again is no longer offered, and only the same backup can be used." / «Si empiezas una recuperación, ya no podrás empezar de nuevo ni usar otra copia.»
3. **For information, no answer needed: worked example 2 gains a line.** Part 2's table says `recoverBackupNote` shows under Recover from backup "while no recovery has started", and worked example 1 shows it, but worked example 2 left it out in both languages. Revision 6 adds the approved line there (round-6 review, L5); no approved words change.

## Words used in this plan

- **Attempt:** one run of first setup, from claiming the box to finishing. Its record is `first-setup.json` in the state folder and `first-setup-claim.json` in the venue folder.
- **Series name:** the five symbols after an invoice series letter, such as `0CNQT` in `A-0CNQT`. They encode the UTC minute the name was chosen (`packages/fiscal-verifactu/src/hour-identity.ts`), so a later minute is a later name.
- **Start again:** the repair page's button for an interrupted, unused attempt (`apps/setup/src/setup-app.ts:2196-2248`).
- **Retirement archive:** what Start again keeps today — a byte-for-byte copy of the abandoned attempt's files, plus the abandoned folders themselves.
- **Workspace:** the fresh pair of folders under `<state>/first-setup-workspaces/<id>/` that Start again moves the box into today. The box's original folders are the **anchor**.
- **Kept picks file:** `module-preparation-state.json`, which keeps every name the chooser has picked on this box, in the anchor state folder.
- **Empty-database proof:** the one-time check that the venue database holds no business rows and the attempt never reached activation.
- **The ask:** what the repair page shows instead of the empty-database proof when the venue database is missing — the box says it cannot check, shows what the attempt's own record says it reached, and offers recovery from a backup or a confirmed Start again (D3a).
- **Confirmation record:** the small file the ask writes, before anything is deleted, naming who confirmed, when, and what the record showed (D3a).
- **Setup password:** the administrator password chosen during first setup. The repair page's password step ("ownership recovery", `recover` in the attempt's history) proves the person holds it.
- **Time floor:** a moment before which no new series name may be taken. The name chooser already takes several (`packages/fiscal-verifactu/src/hour-history.ts:20,72-73`).
- **Module seat:** a hook in the shared module contract that a module fills in, so shared code can ask the fiscal module a question without knowing fiscal rules (`CLAUDE.md` §3, composition list rule).
- **Throwaway naming:** the naming used by Demo, Preparation, a development box's Live, and the readiness test run before a production Live; it has no history check (`apps/server/src/setup-api.ts:585,598-605`, `packages/provisioning/src/fiscal-readiness-runner.ts:40`).
- **Side files:** SQLite's `-wal` and `-shm` files beside a database.
- **Recovery page:** the page the box serves when it cannot start, with a title and an action chosen by error code (`apps/server/src/recovery-surface.ts:251-480`). **Repair page:** the setup app's page for an interrupted first setup.
- **Golden huella test:** `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, which pins the fingerprint ("huella") of real fiscal records; the **inmutabilidad suite** is `packages/fiscal-verifactu/src/inmutabilidad.test.ts`, which pins that fiscal records cannot be changed.
- **STOP:** the campaign rule that a changed or deleted existing assertion waits for the owner.

## Global constraints

- Fiscal: invoice series names. Review path FULL. The PR ends `needs-owner-review`; the owner lands it.
- The golden huella test and the inmutabilidad suite pass **unedited**. No change to `registerSif`, fiscal writers, hashes, numbering, SQL, migrations or `registros_facturacion`.
- No migration. No backwards-compatibility code (`CLAUDE.md` §3).
- The empty-database proof is never loosened. Who may Start again (`apps/server/src/first-setup-resolution.ts:233-299`) stays as it is, except where this plan says otherwise; **no implementer changes those rules to make a test reach its scenario.** This plan narrows them (the missing-database confirmation, the `node.db` rule, outside evidence, an unfinished deletion) and widens them in one place, approved by the owner on 2026-10-25 (point 2 A): with the database missing and the confirmation given, the attempt's status may be any status except `complete` (D3a, point 2 in "For the owner: what waits for approval").
- **The note is never deleted, and never lowered** (owner, Q3 and Q4). No code path removes `first-setup-start-again.json` — not a read, a start, Start again, a restore, the in-app reset, or a plain `waitron.sh reset`; the one deliberate way is `waitron.sh reset --all`. A write replaces it only with a later floor, through `writeDurableHostJson`'s write-to-a-temporary-file-then-rename (`packages/provisioning/src/durable-host-json.ts:44-90`), so a cut write leaves the old note whole. The same holds for the confirmation records.
- Missing, partial, corrupt or unreadable never counts as empty, **with two stated exceptions:** a missing `node.db` counts as nothing to check, because no migration set is ever applied to it (`packages/migrations/src/apply.ts:33`, "`node.db` stays empty (#548)"; `packages/db/src/client.ts:56`); and a damaged kept recovery record counts as missing (Task S7l-a, owner 2026-10-25), because for Start again's floor a recovery statement names no series — it has no `format`, `knownHistory` or `history`, and `isNamelessEvidence` accepts it (`packages/fiscal-verifactu/src/initial-hour-setup.ts`) — so treating a damaged one as missing loses no floor. This is about Start again's floor only: the repair-history path does give a recovery statement a time floor (`packages/fiscal-verifactu/src/hour-repair-history.ts`). A missing note file, or a missing state folder, means "no floor" (`readDurableHostJson` returns `null` for both, `packages/provisioning/src/durable-host-json.ts:22-26`); a note that exists but is empty, partial, has unknown keys, or holds an empty string is refused, never read as "no floor" (`CLAUDE.md` §3, "An empty value is a valid value").
  2026-10-27, A1099: a third — a damaged name record counts as an unknown name with a time floor (`docs/superpowers/plans/2026-10-27-a1099-damaged-names-start-again.md`).
- The note, the confirmation records and the deletion marker are written only inside Start again's existing turn — `host.resolution.withVenueExclusion` (holding `venue.lock`, which refuses a second process) and `host.coordinator.run` (one action at a time in this process) — and the marker is removed by the start under `lockVenueDatabase`. Writes go through `writeDurableHostJson` (`durable-host-json.ts:44-90`: temporary file, file sync, rename, folder sync; it sets the folder to `0700`, as the claim marker already does, `packages/provisioning/src/first-setup-state.ts:558`). Never unlink `venue.lock`, `venue.holder.json`, `migrations.lock` or `recovery.lock`.
- Each new provisioning file has `import "./errors.js";`.
- Error codes. Reused: `sif.allocation_invalid` with `{ reason: "minute_not_later", allowedFromMs }` for a name refused because of the note, which the setup and restore screens already explain in English and Spanish (`packages/fiscal-verifactu/src/setup/clock-wait.ts:100-111,263-269`); `setup.attempt_invalid` for a damaged note (the setup screen shows "The saved setup cannot be read. Contact support.", `apps/setup/src/i18n/strings/shell.ts:8`); `setup.not_ready` for a Start again that is not allowed. **New, two:** `setup.start_again_incomplete` (a Start again deletion is unfinished, or cannot be finished safely) and `setup.workspace_unsupported` (the box holds a first setup kept by an earlier Waitron, D4). Each is registered in `packages/provisioning/src/errors.ts` with no params, imported where thrown, given recovery-page operator text (D5), and given setup-app wording in English and Spanish through both `apps/setup/src/i18n/strings/shell.ts` and the code-to-text map `FIRST_SETUP_ERROR_MESSAGES` (`apps/setup/src/setup-app.ts:196-201`, read at `:751,1162,1452`; without the map entry nothing reads the strings), and each is mapped to 409 in the three server error maps that map `setup.attempt_uncertain` to 409 (`apps/server/src/setup-first-fiscal-api.ts:33`, `setup-api.ts:645`, `setup-first-backup-api.ts:22`; Tasks 3c, 3d and 5a2), because `createErrorBoundary` answers 400, the status for a malformed request, for any code its map lacks (`packages/server-kit/src/error-boundary.ts:41-46`). Why new codes and not `setup.attempt_uncertain`: the recovery page picks its advice by code, and `setup.attempt_uncertain` is also thrown on committed paths (`apps/server/src/first-setup-publication.ts:27-34`, `first-fiscal-activation.ts:31-33`, `packages/provisioning/src/first-setup-state.ts:513`), so its text must stay general.
- **The recovery page never suggests wiping or resetting anything** (owner decision 2026-09-10, `apps/server/src/recovery-surface.ts:247-249`: "the action is always restore or reinstall"). The test that pins it is `apps/server/src/recovery-surface.test.ts:386-394`, "never suggests wiping anything, in either language". Every task that touches recovery-page text runs `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts` whole, not only its new cases.
- English only in code, tests and comments; Spanish only in translation files.
- Coverage holds `98/98/98/95` in every touched package. `@waitron/fiscal-verifactu` has no mutation run (no Stryker config there; `docs/developers/ci-and-gates.md:417` lists only `packages/fiscal`).
- Every implementer is dispatched as `subagent_type: "implementer"`; one that passes about 150 tool calls with its task unfinished stops at a passing or cleanly red point, commits, and returns a handover.
- **Any change to an existing assertion that is not in "Existing assertions this plan changes" is a STOP.** The implementer reports it; it does not make it.
- A run with no `Tests` count is no evidence (`CLAUDE.md` §4). Run each command from the worktree root.

## Current behaviour (read at db4e0a6bf, with runs named; re-checked at 69a7e2ae3, and at 40eed0cde for A731)

What was run for revision 4, at 69a7e2ae3:

- `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.route.test.ts src/first-fiscal-hour-finish.test.ts src/first-setup-unused-pdf.test.ts src/first-setup-resolution-inspection.test.ts -t "missing"`: 13 passed, 75 skipped. These are today's missing-database Start again cases (S5, S10, S13, S14's `:176-221` among them), all succeeding with the password and no other question.
- `pnpm --filter @waitron/setup exec vitest run src/first-setup-retirement.test.ts src/setup-app-missing-database.test.ts`: 32 passed (A2, A3 as they stand).
- The plain-reset clean-up of `deploy/waitron.sh:745`, run as written against a scratch state folder holding `tls/ca.crt`, the note, a confirmation folder, `first-setup.json` and `trading.env` (script `/tmp/a1042rev/reset-probe.sh`, outside the repo): it left only `tls/ca.crt`, so **today a plain reset deletes the note**. The same expression with `! -name first-setup-start-again.json ! -name first-setup-start-again-confirmations` added left `tls/`, the note and the confirmation folder. The failing case would have shown the note gone in the second run.
- The existing pin `scripts/waitron-sh.test.mjs:1487-1491` (`/^run\b.*--entrypoint sh app -c find "\$\{WAITRON_STATE_DIR:\?\}" .*! -name tls/`) run in `node` against the command with the two added clauses: matches; against the command with `! -name tls` removed (control): does not match. So Task 6b changes no existing assertion there.

What was run earlier. By me: `pnpm --filter @waitron/server exec vitest run src/first-setup-retired-assignments.test.ts` (36 passed), and the sweep commands in "How the assertion list was built". By the reviewers, in throwaway worktrees at the same commit:

- Turning off the kept-picks history source moves today's refusals to the archive check (`setup.attempt_conflict`, HTTP 409).
- Start again on an attempt that has chosen a name, with the `no-current-master` answer, is refused `setup.not_ready`. With the `current-master` answer, a new attempt whose clock is 10 minutes behind is refused `minute_not_later` with `allowedFromMs` 1792150980000 (the start of the minute after the abandoned name), and the kept picks file is still there afterwards.
- After the start's own `applyMigrations` and `openVenueDatabase`, `node.db` has an empty `sqlite_schema`; `venue.db` holds `change_log, node_roles, mirror_config, join_requests, node_sealed_state, fiscal_certificate_installs, fiscal_certificate_reminders`. `firstSetupDatabaseIsEmpty` answers `true` for that `venue.db` and `false` for that `node.db`. A read-only open of a missing file throws "unable to open database file".
- Read-only opens of both databases create `-wal` and `-shm` side files, which stay after the connections close; a read-only open leaves `-wal` at 0 bytes. A committed row can live in `-wal` alone while the main file's bytes, and so its SHA-256, stay the same (round 3: `main=8192 -wal=4152`, same hash, a later reader sees the row; `packages/store/src/index.ts:51-54` says the same).
- After a complete Live first setup and the trading restart, `node.db` still has an empty schema (round 3).
- Two password recoveries on one attempt leave the record folder holding `000001.json … 000004.json`, `manifest.json`, `original-0-0.json` **and a `step-000003/` subfolder** with its own `manifest.json` and chunk (round 3; `packages/provisioning/src/first-setup-resolution.ts:461-462`).
- The recovery page rendered with `uncounted: true` for a code that has nothing to do with the disk prints "This start was not counted: the disk is full." (round 3).
- The password Start again on a missing database succeeds for an attempt abandoned after `activation-started`, and also for one taken through `committed` with a result; with the database present, the same attempt is refused `setup.not_ready`.
- One attempt from `hourFirstFiscalFixture` leaves `first-fiscal-documents/fiscal-verifactu.recovery.json`, `first-setup-node-key.json`, `first-setup.json`, `module-preparation-state.json` in the state folder and `first-setup-claim.json`, `venue.db`, `venue.lock` in the venue folder.

Everything else in this section was read.

**Where Start again keeps the attempt.** `startAgainFirstSetup` (`apps/server/src/first-setup-resolution.ts:210-345`) checks the request against a fresh inspection (`:222-229`), requires the attempt's status to be `claimed`, `consumption-intent` or `abandoned` (`:233`), runs the empty-database proof (`:234-270`), snapshots the attempt's files (`:251`), makes a new workspace path (`:307-318`), writes a `retire` record holding the snapshot (`:319-337`), and moves the box into the new workspace (`:338`; `selectFirstSetupWorkspace`, `packages/provisioning/src/first-setup-workspace.ts:330-408`, writes the retirement witness, the backlink and both selection files at `:399-401`). The abandoned folders stay. The route answers `{ workspaceId, selectionGeneration, restarting: true }` and restarts the server (`apps/server/src/setup-first-fiscal-api.ts:813-851`). Start again is served only by the repair listener, which runs without the venue store open: the route is wired at `apps/server/src/first-setup-entry.ts:201-203` (`:165` at db4e0a6bf), and ordinary setup mounts the repair routes without it (`setup-first-fiscal-api.ts:416`).

**Who may Start again today.**
- With no password: an attempt with no history beyond claiming (`unused`, `first-setup-resolution.ts:40-51`) plus a confirmed `no-current-master` answer (`:276-282`); or an attempt that chose a name but never used it (`apps/server/src/first-setup-unused-assignment.ts:9-140`) with a `current-master` answer or none (`:253-258`).
- With the original password: also a missing database (`:296-298`). On that route only the status is checked (`:233`); history and result are not read. In production any status except `complete` and `abandoned` can be abandoned through `POST /setup-api/first-setup/abandon` (`setup-first-fiscal-api.ts:555-561`, `packages/provisioning/src/first-setup-owner.ts:171-185`, `first-setup-state.ts:720-722,799-801`), so an attempt whose fiscal commit finished can be started again with its database missing (reviewer's probe). This is not a live defect today: Start again deletes nothing, it archives the attempt with its frozen request and inputs, the next attempt's names are checked against the archives and the kept picks file, and the database was already gone before Start again ran (round-2 review, item M5, read). The owner's Q1 answer decides it for the new design: the box asks (D3a).

**Every reader of the archives.**

| Reader | Defined | Called from | What it decides |
| --- | --- | --- | --- |
| `readFirstSetupRetirementArchives` | `packages/provisioning/src/first-setup-workspace.ts:511-550` | `apps/server/src/module-operation-host.ts:54`; `apps/server/src/first-setup-resolution.ts:242`; A731's `apps/server/src/first-setup-backup-history.ts:58` (on main since 40eed0cde), whose result reaches `readFirstSetupBackupSetups`'s `retired` argument (`apps/server/src/first-setup-backup-setups.ts:22-25,88`) | walks every retirement and re-checks every archived file |
| `readFirstSetupRetirements` | `first-setup-workspace.ts:552-559` | `packages/provisioning/src/first-setup-runtime.ts:88` (refuses `setup.not_ready` if any exist and no host reader was given) | — |
| `readRetiredFirstSetupStates` | `first-setup-workspace.ts:572-576` | `packages/provisioning/src/first-setup-state.ts:650` (`claim` refuses a new attempt that reuses any old id) | — |
| `readRetiredSetup` (host seat) | type `packages/module/src/operation-preparation.ts:48-54`; server `apps/server/src/module-operation-host.ts:52-78` | `packages/provisioning/src/first-setup-preparation.ts:85` (`assertFreshAssignment`, refusing `setup.attempt_conflict`, `:91-121`), run at select `:226`, import `:267`, activation (`apps/server/src/first-fiscal-activation.ts:111`, `packages/provisioning/src/first-setup-activation.ts:105`) and evidence reads (`module-operation-host.ts:119`); `first-setup-runtime.ts:212`; the historical dispatcher `packages/fiscal-verifactu/src/allocation-configuration.ts:58-119`, which production does not use (its header `:1`; `packages/fiscal-verifactu/src/index.ts:8`) | refuses a fresh name at or before a retired one, including names in the retired attempt's public evidence (`module-operation-host.ts:54-67`) |
| `readOriginals` | `packages/provisioning/src/first-setup-resolution.ts:513` | `first-setup-workspace.ts:172,277,390,536`; `apps/server/src/first-setup-resolution.ts:154,175`; `packages/provisioning/src/first-setup-owner-audit.ts:60` (the password-recovery audit reads its own records; unaffected) | reads archived bytes |

**Where the name is chosen and checked against history.** The chooser (`packages/fiscal-verifactu/src/hour-selection.ts:255-500`) takes history from the database (`packages/fiscal-verifactu/src/hour-preparation.ts:162-175`), from the kept picks file (`hour-selection.ts:292-310`, added as `retained-intents` at `:385-406`) and, on a restore, from the backup plus a `backup-created` floor (`apps/server/src/recovery-preparation.ts:200-209`). It refuses `minute_not_later` when the earliest allowed minute is more than 150 seconds away (`hour-selection.ts:444-463`), before anything is written (writes at `:492,507`). The kept picks file lives in the anchor state folder (`packages/provisioning/src/module-preparation-state.ts:78-80,101-104`), survives Start again, and **is what refuses today's "clock behind" case** (reviewer's probe). So unless Start again folds that file into the note and deletes it, removing the note's check would fail no test.

**What a backup carries.** A module-history file projected from the kept picks file (`apps/server/src/backup-sources.ts:41-61`, read from the anchor at `apps/server/src/archive-entries.ts:37-42`). Once Start again deletes that file, an abandoned name stops appearing in later backups. That is safe: every later name is later than the note (D2), and a trading box's backup carries that later name in its database.

**The two database files.** The venue folder holds `venue.db` and `node.db` (`packages/store/src/index.ts:47-49`). Every migration set is applied to `venue.db`; `node.db` has no tables (`apply.ts:33`, `client.ts:56`, reviewer's probe). The tables classified `local` — `node_roles`, `mirror_config`, `join_requests`, `change_log`, `node_sealed_state` (`packages/db/src/classification.ts:239-257`) and the certificate tables (`packages/fiscal-verifactu/src/classification.ts:17-26`) — therefore live in `venue.db`, so today's proof already covers them. The recovery-key verifier is written to `venue.db`'s `node_roles` only once the attempt is `committed` or `publication` (`packages/provisioning/src/first-setup-node-key.ts:160-182`). A first-setup start creates a missing `node.db` (`apps/server/src/boot.ts:942,974` at 91aa8dfe0, `:932,964` at db4e0a6bf; `packages/store/src/index.ts:247-248`). The empty-database proof's inspection opens `venue.db` only (`packages/provisioning/src/first-setup-resolution-inspection.ts:87`); the repair page's `GET /setup-api/first-setup/resolution` runs that inspection with no venue lock and no coordinator turn (`setup-first-fiscal-api.ts:611-615`).

**What the start does today when admission fails.** `resolveFirstSetupEntry` (`apps/server/src/first-setup-entry.ts:45-110` at db4e0a6bf; since A731 the old body is `resolveLegacyFirstSetupEntry`, `:80-…` at 40eed0cde) serves the repair app (`kind: "resolution"`) when workspace resolution or its admission check throws (`:61-82` at db4e0a6bf). In the supervised entry, `runEntry` calls it with no `catch` (`apps/server/src/node-entry.ts:316` at db4e0a6bf, `:326` at 40eed0cde); a throw there reaches `bootThisProcess`'s `.catch`, which logs `server.boot_failed` and exits (`:648-656` at db4e0a6bf), so the container restarts into the same refusal with no page. The full-disk branch shows the pattern for serving the recovery page without counting a failure (`node-entry.ts:368-384` at db4e0a6bf). The direct entry (`apps/server/src/first-setup-launch.ts:72-100` at db4e0a6bf) falls back to a bootstrap-only listener when `launch()` fails (`:58-63` at db4e0a6bf). **Refreshed at 91aa8dfe0 (Task 0 Step 5; unchanged since 40eed0cde):** `runEntry`'s call `node-entry.ts:326`; `bootThisProcess` `:630`, its `.catch` `:668-675`; the full-disk branch `:378-397`; the direct entry's `launch` `first-setup-launch.ts:71-113`, its fallback still `:58-63`. D5 and Tasks 5a2, 5c1, 5c2 and 5e cite the refreshed numbers.

**What A731 changed (landed as main 40eed0cde).** Items 1–6 are from its plan `docs/superpowers/plans/2026-10-24-a731-repair-backup.md` **as it stood at b49f701a1** (their `:NN` line numbers are that version's; at 40eed0cde `:102` is `:134`, `:116` is `:148`, `:120` is `:152`, `:39` is `:43`, `:21` is `:25`) and its branch; items 7–12 were read on `main` at 40eed0cde:

1. A separate "version 2" recovery journal under `<anchor state>/first-setup-resolutions/backup-recovery/<id>/`, restoring into a nested target and selecting it through paired discovery files (plan `:83,87`); a repair route under `/setup-api/first-setup/resolution/backup` (`:116`).
2. Edits to `apps/server/src/{module-operation-host,setup-first-fiscal-api,first-setup-entry,first-setup-launch,node-entry,boot,cloud-recovery}.ts` and `apps/setup/src/{setup-app.ts,screens/initial-owner-strings.ts}` (`:63-64`).
3. It keeps today's retirements, workspace selection and readers unchanged (`:7,84`); its history reader walks the archives (`first-setup-backup-history.ts:57-60`) and calls `firstSetupAnchorFor` (`:57`; also `apps/server/src/first-setup-backup-recovery.ts:170,387`, `apps/server/src/first-setup-backup-entry.ts:35,90` and `packages/provisioning/src/first-setup-backup-workspace.ts:681` — corrected 2026-10-25 from `:216`; at 40eed0cde, as at 91aa8dfe0, `/usr/bin/grep -n "firstSetupAnchorFor("` finds it at `:170` and `:387` of that file).
4. It carries archive-based floors into the restore target's module history file and requires that "a second backup/recovery still sees the later floor" (plan `:102`); its tests race its commit against "normal empty start-again" (`:120`).
5. Its restore runs `createSelectedRecoveryPreparation` on the nested target's folders (`:102`).
6. It preserves old databases and never deletes: "Preserve old databases, sidecars, attempts, preparation histories, malformed remnants and resolution records. Do not reset, prune …" (its plan, `:21` at b49f701a1, `:25` at 40eed0cde).
7. **(j) The Recover from backup button.** `apps/setup/src/setup-app.ts:2249`: `data-test="recover-backup"`, label `t.recoverBackup` ("Recover from backup" / «Recuperar desde una copia», `apps/setup/src/screens/initial-owner-strings.ts:4,41`), drawn when `inspection && !this.firstRestarting`, where `inspection` is set whenever the database is missing (`:2120`) — so it is drawn before the password step and beside the ask after it. It opens the screen `first-backup`.
8. **(k) Its open step needs no setup password.** Its routes live under `/setup-api/first-setup/resolution/backup/` (`mountFirstSetupBackupApi`, `apps/server/src/setup-first-backup-api.ts:204-274`); its POST routes refuse anything but same-origin HTTPS (its `transport` check, `:216-221`), while `GET …/backup/status` runs without it (`:212-215`); the open proof takes the backup and the node recovery key (`proof`: `observation`, `nodeRecoverySecret`, `context`, `recoveryId`), not the setup password. The ask's wording ("If you have a backup, recover from it.") does not promise otherwise.
9. **(e), (l) What it writes.** At its first `prepare`, before any data is placed (`packages/provisioning/src/first-setup-backup-workspace.ts:597-603`), and during the preparation that follows. Listed by the round-5 reviewer's probe (`/tmp/a1042-review5/target-lock.test.ts`, outside the repo, using A731's own fixture `apps/server/test/first-setup-backup-recovery-fixture.ts`: open an archive, prepare, choose a name, close, list every file):
   - **venue folder:** only `first-setup-resolutions/backup-recovery/current.json` (`currentPaths`, `:233-235`);
   - **state folder:** `first-setup-resolutions/backup-recovery/current.json`, and `first-setup-resolutions/backup-recovery/<recoveryId>/` holding `000001.json` and `000002.json` (both phase `prepared`; a name pick keeps the phase at `prepared` and puts the pick in `000002.json`'s `input`), `evidence/<n>.bin` copies of the attempt's control files (`archiveControls`, `:393-…`), `originals.json`, `retained-evidence.json`, and the restore target (`:123`):
     - `target/state/`: `first-setup-resolutions/backup-recovery/backlink.json` (`:236-238`), `module-evidence/fiscal-verifactu/hour-history.json` and `module-preparation-state.json` (the recovery's own kept picks);
     - `target/venue/`: `first-setup-resolutions/backup-recovery/backlink.json` and **`venue.lock`**, which the preparation host's venue exclusion creates (`apps/server/src/recovery-preparation.ts:146-152`, `lockVenueDatabase`) and which is never unlinked (`packages/store/src/venue-lock.ts:7-10`: "Never unlink it"; `CLAUDE.md` §3);
   - **with a Cloud source** (probed 2026-10-25, Task 0 results, (m)): also `<recoveryId>/cloud/cloud-recovery.json` (`apps/server/src/first-setup-backup-recovery.ts:170-177,421-422`); `<recoveryId>/publication.json` is written only during `commit` (`:1025`, read), so a recovery given up before committing has none.
   - Re-run on 2026-10-25 with an archive source too: the same list, and nothing removed from either folder (Task 0 results, (m)).
   Its phases are `prepared`, `placement-started`, `restored`, `selected` (`:62`). Its `witness` refuses `setup.attempt_uncertain` when `backup-recovery/` exists in either folder without a `current.json` (`:242-252`), and the start treats the folder in either folder as present (`apps/server/src/first-setup-backup-entry.ts:72-86`).
10. **(m) A recovery started and given up.** Closing the session only drops it from memory (`apps/server/src/first-setup-backup-recovery.ts:1184-1192`); nothing deletes the journal. From then on every start finds it and serves the repair page from the source folders (`first-setup-backup-entry.ts:98-104`, `apps/server/src/first-setup-entry.ts:56-62`). The recovery's own name pick runs on the target folders (`first-setup-backup-recovery.ts:447-448`, `createSelectedRecoveryPreparation({ ...entry.record!.target.target, … })`), so a name it picked is recorded inside the journal's target, not in the box's own kept picks file — pinned by A731's landed test `apps/server/src/first-setup-backup-recovery-opening.test.ts:155-217` ("prepares in a derived isolated target …"; the box's `module-preparation-state.json` keeps its original bytes, `:214`), which the round-5 reviewer ran (1 passed). Today's Start again has no check of its own for the journal (`/usr/bin/grep -n backup-recovery apps/server/src/first-setup-resolution.ts packages/provisioning/src/first-setup-resolution-inspection.ts` prints nothing); this plan's D3 refuses Start again while any journal exists (point 5, the owner chose B on 2026-10-25). Re-run on 2026-10-25: Task 0 results, (m).
11. **(i) Entry order.** `resolveFirstSetupEntry` (`apps/server/src/first-setup-entry.ts:50-78`) now asks A731's `resolveFirstSetupBackupEntry` first (`:56`) and only then runs the old body, renamed `resolveLegacyFirstSetupEntry` (`:80-…`, canonicalising at `:86-97`). D5's start checks therefore go before `:56` (D5).
12. **A731's landed tests that touch Start again**, by `grep -n "start-again\|cloudStartAgain"`: `apps/server/src/setup-first-backup-api.test.ts:674-…` (a Start again queued behind a recovery commit loses with 503 `setup.not_ready`: the send `:741-749`, the expectation `:755-766`; expected unchanged, since D3 refuses during an unfinished recovery); `apps/server/src/first-setup-backup-handoff.test.ts:275-285` (a list of routes refused during handoff — item S23); `apps/server/src/first-setup-backup-entry.v1.test.ts:65-75,111-…` (a box moved into a first-setup workspace by today's Start again — item S24). A731's own `cloud/start-again` route (`setup-first-backup-api.ts:268`, `cloudStartAgain`) restarts a Cloud recovery, not a first setup; it is untouched.

**Where the missing-database Start again is offered today, and why the ask belongs there.** Two different pages exist:

- The **repair page** is the setup app's `screen-first-owner` (`#renderFirstOwner`, `apps/setup/src/setup-app.ts:2116-2292`), served by the repair listener when the start finds an interrupted first setup (`resolveFirstSetupEntry`, `apps/server/src/first-setup-entry.ts:50-78`, `kind: "resolution"`). Anyone on the venue's network can open it, but its missing-database Start again is drawn enabled only after the setup password step: `authenticatedMissing` needs a recovered session (`setup-app.ts:2121-2125`), and the server refuses that Start again unless the request carries an owner whose latest event is a fresh `recover` (`apps/server/src/first-setup-resolution.ts:284-299`) and arrives over HTTPS (`apps/server/src/setup-first-fiscal-api.ts:817-819`, `setup.owner_required` otherwise).
- The **recovery page** (`recoveryApp`, `apps/server/src/recovery-surface.ts`) is served when a start fails. It needs no password, its title and action are fixed strings chosen by error code, its only action is Try again, and its wording "never suggests wiping or resetting anything" (`recovery-surface.ts:247-249`, pinned by `apps/server/src/recovery-surface.test.ts:386-394`; `docs/developers/conventions-ui.md:1053-1056`).

So the ask lives on the **repair page, after the setup password step**. It cannot live on the recovery page: it offers a deletion, which that page's rule forbids, and that page has no password step and no form. The recovery page's never-wipe rule does not bind the setup app: the setup app's wording already offers to abandon an attempt (`initialOwnerStrings.abandon`, `apps/setup/src/screens/initial-owner-strings.ts:27`).

## Decisions

### D1. Where the note lives: one file in the box's own state folder

The note is `first-setup-start-again.json` in the box's own state folder, found by `boxFolders` (Task 0b). Exact keys only:

```json
{ "version": 1, "floorMs": 1792154580000, "lastName": "0CNQT", "module": "fiscal-verifactu" }
```

`floorMs` is the first moment a later name may be taken (the start of the minute after the last name). `lastName` is that name, for people reading the folder; shared code never parses it. `module` is the module whose seat gave the floor. Limit 4096 bytes.

| Place | Survives Start again | Survives a restore | Rolled back by a restore | Verdict |
| --- | --- | --- | --- | --- |
| inside `venue.db` | no — Start again deletes it | no — a restore replaces it | yes | rejected |
| inside the kept picks file | yes today | yes | no | rejected: it is the growing list of every pick (each pick writes a revision holding the whole list again: `hour-selection.ts:420` with `module-preparation-state.ts:127-137`), the archive the owner asked to remove |
| a file in the venue folder | yes | partly — a restore removes some venue sub-folders (`apps/server/src/restore.ts:654`) | no | rejected |
| **a file in the state folder** | **yes** | **yes — a restore writes only named files there** | **no — see below** | **chosen** |
| copied into every backup | — | — | yes — an older backup would bring back an older note | rejected |

A restore cannot overwrite it: a restore archive writes only its database dump and state-folder secrets (`restore.ts:221-241`), and its secret entries are filtered through `isFirstSetupHostPath` (`:236-241`, reached from all three archive readers at `:190`, `:208`, `:866`). The note's name joins `FIRST_SETUP_HOST_FILES` (`first-setup-state.ts:137-151`), so an archive carrying it is refused as an unexpected entry, and a recovery bundle carrying it is refused `recovery.bundle_invalid` (`apps/server/src/state-secrets.ts:87`). Task 2 checks whether the bucket-stream restore (`apps/server/src/restore-stream.ts`) writes state files by another path.

When the restored backup has its own history, the latest floor wins: the note sits beside the backup's history and its `backup-created` floor on every restore, re-registration and promotion (Task 6). A backup never carries the note: the state files a backup takes are a fixed list (`collectStateSecrets`, `apps/server/src/state-secrets.ts:26-46`, reading `RECOVERY_FILES`), and the note is not on it.

**The write rule (owner, Q3).** The note is only ever **replaced by a later one**: `raiseStartAgainNote` writes only when the new `floorMs` is strictly greater, so an equal or earlier floor writes nothing; the write goes to a temporary file that is synced and then renamed over the note (`durable-host-json.ts:44-90`), so at every moment the file holds either the old note or the new one, never nothing. **No code path deletes it**: there is no delete function; D3's deletion list never names it, and `deleteMarkedAttempt` refuses a marker that names it or the confirmation folder (Task 3b). Read today, the app's other state-folder deletions name their files one by one and do not reach it — the in-app reset (`apps/server/src/reset-request.ts:104-108`), restore staging (`apps/server/src/restore-request.ts:324-331`), the configuration import (`packages/provisioning/src/configuration-import.ts:115-118`) and the start's space clean-up, which deletes only backup staging, staged recovery copies, rotated logs and crash reports (`apps/server/src/start-space.ts:53-60`); this was read, not run, and Task 6c runs it. The failure the owner named — a step that reads the note and then deletes it, followed by a restart that finds none — therefore has no path. A root guard (Task 6c) fails if any `.ts`, `.mjs` or `.sh` source file outside one allowlist — the note's own module, the confirmation record's module, `packages/provisioning/src/first-setup-state.ts` (the host-file list), `packages/provisioning/src/index.ts` and `deploy/waitron.sh` — names `first-setup-start-again.json`, `START_AGAIN_NOTE_FILE` or `first-setup-start-again-confirmations`.

**Where the note is kept, event by event.** Every new production name still needs the box's clock and a second clock to agree within 30 seconds (`CLAUDE.md` §5), so after any event that loses the note, a repeated name needs both clocks to read earlier than the forgotten name.

| Event | What happens to the note | Where decided |
| --- | --- | --- |
| a read, a start, Start again, a restore, the in-app reset | kept | Q3; Task 6c tests each |
| `waitron.sh reset` (plain) | **kept**. Today it is deleted: the clean-up empties the state folder except `tls/` (`deploy/waitron.sh:738-746`, the `find` at `:745`; run, see Current behaviour). Task 6b adds the note and the confirmation folder to what it keeps. Its production check (`is_production`, `:521-583`) is unchanged | Q4, Task 6b |
| `waitron.sh reset --all` | **removed**, with the whole state volume (`deploy/waitron.sh:739`). The one deliberate way to remove it, and the way out of a damaged note on a box that has `waitron.sh` | Q4 |
| reinstall from the USB stick (B3, not built) | **kept**, once B3 takes the change drafted in "For the owner: what waits for approval", part 3: today B3's installer erases the whole disk (B3 design §5.5, `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md:322-324`) and keeps no venue data (§17 item 5, `:1038-1039`), and the state folder sits inside the encrypted container (§6 table, `:356` and `:359`) | Q3, Task 7 |
| a disk the stick cannot read (B3's «BORRAR» path, §5.2, `:252-257`) | lost: nothing on the disk can be read | stated in the B3 change |
| A950's upgrade rollback (not built) | must keep the newer note (A950 rolls every volume back to its snapshot, `docs/backlog/box.md:67-123`); an ordinary upgrade never writes the note | Q5, Task 7 |
| reinstall from the dashboard (B3's revision, not on main — no mention in the B3 design) | carried, like the stick's reinstall | Task 7 adds it to B3's backlog entry |
| a second node in the venue (not built) | each new note the primary writes is written on every secondary too | Q3, Task 7 records it as a failover requirement |

### D2. The note is read as a time floor, everywhere a production name is chosen

The history reader applies `timeFloorMs` from every source with no taxpayer or environment filter (`hour-history.ts:72-73`), whereas named records of another taxpayer or environment are skipped (`:93`). A time floor therefore binds the whole box, as the owner worded it (Q2 confirms). Shared code hands it over in the shape `recovery-preparation.ts:204-209` already uses for `backup-created`: `{ reference: "start-again-note", complete: true, records: [], timeFloorMs: note.floorMs }`. With a correct clock a new name is later than the note anyway; the floor only bites when the box's clock reads earlier than the minute after the note's name. Throwaway naming stays outside every history check, as today (Q6).

### D3. Start again deletes the attempt in place, under a marker that names exactly what it deletes

**Invariant:** Start again runs only on the repair listener, where the venue store is not open (Current behaviour). A change that offers it in ordinary setup must first close the store; Task 3c pins the route's absence from ordinary setup with a test.

**Refused before anything is written** (`setup.not_ready` unless named otherwise):
- the database is missing and the request does not carry a confirmation that matches the box's own summary of the attempt (D3a; a mismatch is `setup.attempt_conflict`);
- `node.db` exists and its `sqlite_schema` has any row whose name does not start with `sqlite_`. A missing `node.db` is not opened (opening it read-only throws) and counts as nothing to check (Global constraints). `firstSetupDatabaseIsEmpty` is never called on `node.db`: it answers `false` for an untouched one;
- any of `trading.env`, `setup-operation.json`, `restore-request.json`, `reset-request.json`, `modules.json`, `cloud-replacement.json` is present (the inspection's own artifact list, `first-setup-resolution-inspection.ts:287-297`);
- `.venue.db-litestream/` is present in the venue folder. The stream runs only once backup settings exist (`apps/server/src/stream-host.ts:155`, read), so an unused attempt never has it, and a streamed folder is never half-emptied (`CLAUDE.md` §3);
- any outside evidence is configured or present. Production configures none (`packages/fiscal-verifactu/src/initial-hour-setup.ts:115`, read into `packages/provisioning/src/first-setup-runtime.ts:123-133`), so this refuses only test and historical configurations;
- an A731 journal, `first-setup-resolutions/backup-recovery/`, in **either** the state folder or the venue folder ("What A731 changed", item 9), whatever its phase (point 5: the owner chose B on 2026-10-25). Start again never deletes or changes anything of A731's: its target holds a `venue.lock` that must never be unlinked;
- a legacy workspace file (D4, `setup.workspace_unsupported`), or anything under `first-setup-resolutions/`, in either folder, that is not a record folder laid out as below;
- a deletion marker already exists (`setup.start_again_incomplete`; the next start finishes or refuses it, D5);
- the marker would exceed its limit (below). This is checked before writing, because `writeDurableHostJson` itself turns an over-limit write into `setup.attempt_invalid` (`durable-host-json.ts:52-53,86-87`).

**The floor comes from a new module seat**, so shared code never reads a series name:

```ts
// packages/module/src/initial-setup.ts, on InitialSetupContribution
startAgainFloor?(input: {
  readonly attempts: readonly { readonly context: InitialSetupContext; readonly input: unknown }[];
  readonly preparations: readonly unknown[];
  readonly publicEvidence: readonly unknown[];
}): { readonly floorMs: number; readonly lastName: string } | null;
```

`publicEvidence` is the abandoned attempt's own public evidence, gathered from the live snapshot (`captureFirstSetupOriginals`, `first-setup-resolution.ts:251`) by the readers `module-operation-host.ts:54-67` applies to archives today — `readFirstFiscalEvidenceSnapshot`, `readFirstSetupRecoveryDeliverySnapshot` and `readFirstFiscalDeliverySnapshot` — **without** the `outside-file:` branch (`:56-63`), since outside evidence refuses Start again.

**What a record folder holds.** Each UUID-named folder under `first-setup-resolutions/` (written by the record store, `packages/provisioning/src/first-setup-resolution.ts:372`) holds `NNNNNN.json` records, evidence chunks (`original-*.json`) and a `manifest.json`, and, for every record from step 3 on, a `step-NNNNNN/` subfolder with its own chunks and manifest (`:461-462`). The password-recovery audit writes to one fixed id per attempt (`packages/provisioning/src/first-setup-owner-audit.ts:15-25`) and adds a step for each recovery (`:123-155`), so a second recovery on one attempt creates `step-000003/` (round 3's probe). These folders hold this attempt's marker repairs, ownership rebinds and password-recovery audit, and those of its earlier attempts in `previous`.

**The deletion list, in order.** Main database files first, so that a read opening the venue folder after them finds nothing to open; then their side files; then the rest; the claim pair last. Every entry of a listed folder is covered, including names that start with a dot (a crash in `writeDurableHostJson` leaves `.first-setup-<uuid>.tmp`, `durable-host-json.ts:50`).

1. Venue folder: `venue.db`, `node.db`, then `venue.db-wal`, `venue.db-shm`, `node.db-wal`, `node.db-shm`.
2. State folder:
   - `module-preparation-state.json` (Task 1b deletes it directly; Task 3c moves its deletion into this marked list);
   - each file in `first-fiscal-documents/`, then the folder;
   - `first-setup-node-key.json`; `module-operation-public.json`;
   - in each record folder: each file in each `step-*` subfolder, then that subfolder; then each file of the record folder, then the folder; then `first-setup-resolutions/`.
3. Venue folder: `first-setup-claim.json`. State folder: `first-setup.json`, last.

A folder is removed only with `rmdir` once empty, never recursively, so a file that appeared after the marker was written makes the removal fail and is never swept away.

**Never on the list:** the note `first-setup-start-again.json`, the confirmation folder `first-setup-start-again-confirmations/`, `tls/`, and anything else in the state folder not named above. A marker naming the note or the confirmation folder is refused as damaged (`setup.start_again_incomplete`) by both the writer and the finisher (Task 3b).

**Order of writes:**
1. The existing proof, unchanged, plus the refusals above — or, when the database is missing, the confirmation check of D3a in its place.
2. When the database is missing: write the confirmation record (D3a). Nothing has been deleted yet.
3. Raise the note, only if the seat gives a floor.
4. Write the deletion marker `first-setup-deleting.json` in the **venue** folder, whether or not the attempt chose a name. Exact keys:
   - `version: 1`, `attemptId`, `frozenDigest` (from `first-setup.json`), and canonical `venueDir` and `stateDir`;
   - `files`: one entry for every present file of the list at every level (record folders and their `step-*` subfolders included), `{ root: "venue" | "state", name: <relative path, no "..">, size: <bytes>, sha256: <hex> }`;
   - `wal`: for `venue.db-wal` and `node.db-wal`, either `null` (absent) or `{ size, sha256 }`. These cannot change while Start again holds `venue.lock`, and a read-only reader does not write to a `-wal` (round 3's probe left it at 0 bytes).

   `-shm` files are never recorded. The limit is 1 MiB: `first-fiscal-documents/` holds at most 1024 names before the inspection refuses (`first-setup-resolution-inspection.ts:308-309`), an entry is under 300 bytes, and the record folders of one attempt hold far fewer.
5. Delete in the list's order, syncing each parent folder.
6. Remove the marker; sync the venue folder.

**Side files.**
- A `-shm` file is never fingerprinted. A read-only open rewrites it, and the repair page's poll opens `venue.db` read-only with no lock (`setup-first-fiscal-api.ts:611-615`); a hash of it would go stale after a harmless read and strand the box after a power cut.
- A `-wal` is accepted at the finish only if it is absent, 0 bytes, or exactly the recorded bytes. Otherwise the finish refuses, because committed rows can live in a `-wal` while the main file's hash is unchanged (Current behaviour). That covers a process that does not check the marker writing after a cut — `waitron-break-glass` (`apps/server/src/break-glass-command.ts:27`) or `packages/credentials/src/bin.ts`.
- The alternative, putting the GET inspection behind the coordinator so nothing can touch the files during deletion, was rejected. It would also have to cover every other in-process reader, and a power cut between a read and the marker's hashes would still strand the box.
- Task 3c tests an inspection read interleaved between the deletions, then a cut, then the next start finishing.

**Finishing at the next start** (`finishStartAgainDeletion`, D5 says where it runs). With no marker it does nothing. With one, it first canonicalises the folders it is given, as `bindRoots` does (`first-setup-state.ts:528-536`). It then deletes only if all of these hold, and otherwise refuses `setup.start_again_incomplete` and deletes nothing:
- the marker's folders are those canonical folders;
- nothing on the refusal list is present;
- every listed file still present has its recorded size and SHA-256;
- each `-wal` passes the rule above;
- no main database file, claim-pair file or record file is present that the marker does not name (a newly placed `venue.db` fails here).

Then it deletes the present items in the list's order and removes the marker.

**A deletion that throws** (an `rmdir` refused, an `EACCES`) leaves the marker in place. The route answers `setup.start_again_incomplete` and requests a restart (`requestRestart`, as the success path does at `setup-first-fiscal-api.ts:845`), so the next start finishes the deletion or serves the recovery page.

**While a marker exists, these refuse `setup.start_again_incomplete`:**
- Start again itself;
- a new claim (`first-setup-state.ts` `claim`);
- **every write of the first-setup store**, through its `persist` (`first-setup-state.ts:555-560`; this covers abandon, ownership recovery and every other `update`);
- **every write of the record store**, through `prepare` and `apply` (`packages/provisioning/src/first-setup-resolution.ts`; this covers marker repair, ownership rebind and the password-recovery audit);
- every caller of `assertVenueFirstSetupAllowed`: restore placement (`apps/server/src/restore.ts:354`), restore staging (`restore-request.ts:416`), the `waitron-restore` command (`restore-command.ts:300`), reset (`reset-request.ts:97`), and command-line provisioning when no `authorize` is given (`packages/provisioning/src/cli.ts:505,514`);
- the `assertOtherAllowed` hook used by adopt and provision (`apps/server/src/boot.ts:1123` at 91aa8dfe0, used by `setup-api.ts:655`), which reads the state store and so needs the marker check added;
- the recovery entry (`apps/server/src/recovery-entry.ts:56`);
- A731's repair open and resume: `open` (`apps/server/src/first-setup-backup-recovery.ts:556-…`) and `resume` (`:758-…`), reached by `POST …/backup/open` and `POST …/backup/resume` (`apps/server/src/setup-first-backup-api.ts:224-241`). Both open a recovery from the box's folders (Task 0 results, (h)).

**Not covered, and safe:** `waitron-rejoin` (`apps/server/src/rejoin-command.ts:89-136`), `waitron-break-glass` and `packages/credentials/src/bin.ts` do not check the marker. Each changes `venue.db` or its `-wal`, which makes the finisher refuse rather than delete. Task 3d reads `rejoin-command.ts:89-136`; if a rejoin can remove or overwrite the marker itself, it adds the marker check there.

The marker's name also joins `FIRST_SETUP_HOST_FILES`. That follows `first-setup-claim.json`'s precedent, and is harmless rather than needed: nothing a restore carries reaches the venue folder except `venue.db` (`restore.ts:221-241`).

### D3a. When the venue database is missing: ask, then proceed only on a recorded confirmation (owner, Q1)

With `venue.db` missing, the empty-database proof has nothing to read, so the box cannot tell whether this attempt filed anything to AEAT or made a sale. The owner's answer: neither refuse nor proceed silently — **ask**. Maybe there is no backup; maybe the database was deleted while trying to make Start again work.

**Where, and for whom.** On the repair page only, after the setup password step, over HTTPS only — the same gates as today's missing-database Start again ("Where the missing-database Start again is offered today", above). D3's other refusals all still apply (a `node.db` holding a table, `trading.env` and the other artifacts, a Litestream folder, outside evidence, an A731 journal in either folder whatever its phase — point 5, the owner's B — and an existing marker). **Statuses:** any except `complete`, widened from today's `claimed`, `consumption-intent` and `abandoned` (`first-setup-resolution.ts:233`), because the owner's own example is an attempt that "finished the fiscal step", and the page today offers no way to abandon one: its abandon button is drawn only when the database is present and the status is not one of the finishing ones (`setup-app.ts:2145-2151,2274`). The owner approved this widening on 2026-10-25 (point 2 A in "For the owner: what waits for approval").

**The summary: what the attempt's own record says it reached.** Built by the server, never by the page:

```ts
// packages/provisioning, beside the note
type StartAgainSummary = {
  readonly reached: "claimed" | "named" | "fiscal-started" | "fiscal-finished";
  readonly lastName: string | null;
  readonly recoveryRecordDamaged?: true;
};
```

`recoveryRecordDamaged` is present only when the kept recovery record cannot be read; it travels in `shown` and in the confirmation record, so the person must have been shown it (Task S7l-a).

- `reached` is read by shared code from the event kinds of the attempt and of every attempt in its `previous` (`history`, `packages/provisioning/src/first-setup-state.ts:94`; events appended at `:807-811`): `fiscal-finished` if any has a `result` or a `committed`, `publication` or `complete` event; otherwise `fiscal-started` if any has `activation-started` or `uncertain`; otherwise `named` if any has `candidates`, `import` or `consumption-intent`; otherwise `claimed`. `reached` decides only the fiscal line on the page and the record; whether the page shows a series name is decided by `lastName` alone, so an `input` or `checked` event (`first-setup-state.ts:65,69`), which these rules do not count, cannot hide a name. (`consumption-intent` is written straight after the last module's name is chosen, `packages/provisioning/src/first-setup-preparation.ts:238-256`; `activation-started` just before the fiscal step runs and `committed` once its result is checked, `packages/provisioning/src/first-setup-activation.ts:116-145`.)
- `lastName` is the `lastName` the module seat `startAgainFloor` gives for the attempt (D3), or `null` when it gives none. Shared code and the page never read a series name themselves.
- Served by a new route, `POST /setup-api/first-setup/resolution/start-again/summary`, taking the same body (`inspectionId`, `revision`, `ownerGeneration`) and owner headers as Start again, HTTPS only, answering `{ reached, lastName }`, and refused `setup.not_ready` when the database is not missing. A POST because, like Start again, it needs the owner headers.

**The confirmation.** The Start again request gains `confirmMissingDatabase: { nothingFiledOrSold: true, shown: StartAgainSummary }` — required when the database is missing and refused (`setup.attempt_conflict`) when it is not; the route's exact-keys check (`setup-first-fiscal-api.ts:820-826`) gains the key. **`shown` is the summary the page displayed**, carried from the screen through `#startAgainFirstSetup` into the session's `retireMissingDatabase(shown)`, never a fresh read. The session takes a fresh inspection just before Start again (`apps/setup/src/first-setup-session.ts:547-556`) and compares its `revision` and `ownerGeneration` with the session owner's (`:553-554`), which does refuse a change to `first-setup.json` made after the page was drawn; it would not catch a change outside that revision, such as the kept picks file behind `lastName` (read, not run). If the session reads the summary again before sending, it refuses `setup.attempt_conflict` on any difference from `shown` and sends nothing. Inside Start again's turn the server rebuilds the summary; if `shown` differs, it refuses `setup.attempt_conflict` and writes nothing. The request's inspection ids still refuse a record that changed since the session's last inspection (`first-setup-resolution.ts:222-229`).

**The confirmation record.** One small file per confirmation, in the box's own state folder (found by `boxFolders`, Task 0b): `first-setup-start-again-confirmations/<server time in ms>-<attemptId>.json`, written by `writeDurableHostJson`, limit 16 KiB (the claim marker's limit, `first-setup-state.ts:153`). Exact keys:

```json
{
  "version": 1,
  "at": "2026-10-24T13:50:12.000Z",
  "attemptId": "6f0c…",
  "database": "missing",
  "administrator": { "displayName": "Elena García", "email": "elena@example.com" },
  "ownerGeneration": 3,
  "shown": { "reached": "fiscal-finished", "lastName": "0CNQT" }
}
```

- **Who:** the attempt's administrator as its frozen request names them (`state.frozen.request.admin`, checked at `first-setup-state.ts:252-277`), whose setup password the person has just proved, and the ownership generation that password step produced. The box knows no other identity at this point.
- **When:** the server's clock.
- **What the record showed:** the summary as the server rebuilt it — which equals what the page showed, or Start again refused.
- **Written before anything is deleted:** step 2 of D3's order of writes, before the note, the marker and every deletion. A cut after it leaves a record beside an attempt that is still there; a retry writes a second record.
- **Kept like the note:** never deleted except by `waitron.sh reset --all`; kept by a plain reset (Task 6b); never in a backup (not on `RECOVERY_FILES`); its folder name joins `FIRST_SETUP_HOST_FILES`, so no restore archive or recovery bundle carries one. Nothing reads these records to decide anything; they are for people. Not carried by a reinstall from the stick (point 3 for the owner).
- **Not logged with the name or email:** `waitron.log`'s tail is shown on the recovery page to anyone on the venue's network (`docs/developers/conventions-ui.md:1099,1110-1115`), so no log line carries the record.

**Then Start again proceeds as D3 says:** the note (the seat's floor over the attempt's frozen requests, inputs, kept picks and public evidence — all in the state folder, so all still there), the marker, the deletion. A missing `venue.db` is simply absent from the marker's file list.

### D4. Boxes that already hold archives: refused, not read

Pre-live, every box may be reset (`CLAUDE.md` §3). Nothing reads an old archive or seeds the note from one.

A box is refused `setup.workspace_unsupported` when its folders hold `first-setup-selection.json`, `first-setup-retirement.json`, `first-setup-workspace.json` or `<state>/first-setup-workspaces/`, or when its venue folder sits inside `first-setup-workspaces/<id>/` (today's check at `first-setup-workspace.ts:461,492`, kept because such a folder is a workspace from that same older layout). It is refused at the start (D5), and wherever today's check `assertFirstSetupVenueTarget` refuses an old witness: claim, update, `inspectFirstSetupMarker` and `assertVenueFirstSetupAllowed` (`first-setup-state.ts:488-506`); and wherever today's `assertFirstSetupBootTarget` runs: the first-setup owner's checks (`packages/provisioning/src/first-setup-owner.ts:173,238,361`), the inspection's venue exclusion (`first-setup-resolution-inspection.ts:256,259`), Start again (`apps/server/src/first-setup-resolution.ts:222`), raw `bootServer` (`apps/server/src/boot.ts:873`) and the ordinary entry's `run` (`apps/server/src/first-setup-entry.ts:140`). Task 5a lists every caller and the task that rewrites it. So the restore command, staged restore and reset keep refusing such a box.

`assertNoLegacyFirstSetupWorkspace` refuses `setup.workspace_unsupported` only when one of those names is actually present. Every other failure — a folder that is a symbolic link, or one that cannot be read — keeps today's `setup.attempt_uncertain` (`first-setup-workspace.ts:471-473`), so a symbolic link is never described as "an older Waitron".

The way out, for a developer: `wa-wt reset demo <name>`. On a box, the recovery page says "reinstall Waitron" (D5), keeping to the owner's never-reset rule. The PR's first line says so, as #1990's did.

The first-setup record store keeps its `retire` and `select-workspace` action names and its `nextWorkspace` field for now (`packages/provisioning/src/first-setup-resolution.ts:20-48`). After this change nothing writes them. Their only readers that decide anything are `apps/server/src/first-setup-resolution.ts:115` (removed in Task 5d) and `:245` (removed in Task 4b1), and Start again deletes the record folders. Removing them would rewrite the record store's own durability and integrity suites without changing what the box does. Task 7 adds a backlog entry to remove them.

### D5. What the operator sees when the start refuses

Since A731, `resolveFirstSetupEntry` (`apps/server/src/first-setup-entry.ts:50-78`) asks A731's backup entry first (`:56`) and then runs the old body, `resolveLegacyFirstSetupEntry` (`:80-…`), which canonicalises the folders (`:86-97`; its canonicalisation-failure branch is unchanged). D5's checks go **at the top of `resolveFirstSetupEntry`, before `:56`**: canonicalise the folders there (as `:86-97` does; a failure falls through to today's path unchanged), then, in a `try` of their own, run `assertNoLegacyFirstSetupWorkspace` and `finishStartAgainDeletion`, and turn either new code into a new admission result `{ kind: "refused", code, roots }`. Any other error keeps today's behaviour. They come before A731's entry so that an interrupted Start again deletion is finished, or refused with the recovery page, before the entry decides what to serve: A731's entry catches its own failures and serves the repair page from whatever it finds (`apps/server/src/first-setup-backup-entry.ts:98-101`), so it would otherwise serve the repair page from a half-deleted attempt. Start again never touches A731's records (D3), so nothing of A731's is ever half-deleted. Two steps of `runEntry` still run before `resolveFirstSetupEntry` (`node-entry.ts:311-324`): A731's `resolveFirstSetupBackupEntry(deps)` and `freeSpaceAtStart`. Neither touches an attempt: with no journal A731's entry answers `absent` (`apps/server/src/first-setup-backup-entry.ts:72-96`), and no journal exists while a marker does (D3 refuses Start again while a journal exists, and Task 3d refuses A731's open and resume while a marker exists); the clean-up deletes only backup staging, staged recovery copies, rotated logs and crash reports (its contract, `apps/server/src/start-space.ts:53-60`, read), none of D3's files. Task 0 Step 3 (i) re-checks this order on the build's main.

Both consumers of the admission result handle the new kind (`first-setup-launch.ts:96-112`; `node-entry.ts:399-417`; both at 91aa8dfe0).

**Supervised entry** (`runEntry`):
- The refused branch goes after `needsConnectionBootstrap` (`node-entry.ts:349`); the full-disk branch (`:379`) takes precedence.
- First it writes `server.boot_started`, then `server.boot_failed` with `{ errorCode: code, detail }`, through `pageLog` (`node-entry.ts:213-220`), as `runAdmittedEntry` does (`:503-565`). This keeps the page's "Why the last start failed" (`lastFailureIn`, `recovery-surface.ts:60-69`) from showing an earlier start's failure.
- Then it serves `recoveryApp` with:
  - the state from a new helper `refusedAtStart(current, code, at)` beside `fullDiskAtStart` (`apps/server/src/recovery-state.ts:152`), which the start serves and never writes;
  - a new flag `refusedAtStart: true` on `RecoveryDeps`, **not** `uncounted: true`, whose status line is about the disk (`recovery-surface.ts:169,188,533-534`);
  - **Try again** exiting so Docker restarts the box.
- No restart loop and no failure count: it returns before `runAdmittedEntry` (`:453`), the only place the count is written.

**Direct entry** (`launch`, `first-setup-launch.ts:71-113`): serves the same `recoveryApp` through its `listen` (`:43-47`), with `state` from `refusedAtStart(await readRecoveryState(stateDir), code, now)`, `logDir` from `resolveLogDir(env, stateDir)`, and `onRetry` calling the existing `requestRestart` (SIGTERM by default, `:75`).

**Raw `bootServer`** (`boot.ts:843`, whose first-setup target check is `:873`; used by tests and development, not by a box): throws the code.

**What the page shows.**

The new status line, in both languages:
- English: "Level: {level}. This start was refused before it began, and was not counted."
- Spanish: "Nivel: {level}. Este arranque se rechazó antes de empezar y no se ha contado."

The operator text is chosen by code (`recovery-surface.ts:474-481`). Both actions follow the never-reset rule (Global constraints) and the wording of the existing rows (`:404`, `:417`):

| Code | Title (English / Spanish) | Action (English / Spanish) |
| --- | --- | --- |
| `setup.workspace_unsupported` | This box holds a first setup kept by an older Waitron. / Este equipo guarda una configuración inicial de una versión anterior de Waitron. | Ask whoever installed this box to reinstall Waitron on it. / Pide a quien instaló este equipo que reinstale Waitron en él. |
| `setup.start_again_incomplete` | Start again did not finish, and the box found files it did not expect. / «Empezar de nuevo» no terminó y el equipo encontró archivos que no esperaba. | Ask whoever installed this box to look at its setup folders before anything else: the files it found may be a restored venue. / Antes de nada, pide a quien instaló este equipo que revise sus carpetas de configuración: los archivos que encontró pueden ser un local recuperado. |

Setup-app wording for the same two codes (`shell.ts`, through `FIRST_SETUP_ERROR_MESSAGES`), for the repair page and any restore or reset screen that receives them:

| Code | English | Spanish |
| --- | --- | --- |
| `setup.start_again_incomplete` | Start again has not finished. Restart the box, then try again. | «Empezar de nuevo» aún no ha terminado. Reinicia el equipo y vuelve a intentarlo. |
| `setup.workspace_unsupported` | This box holds a first setup kept by an older Waitron. Reinstall Waitron on it. | Este equipo guarda una configuración inicial de una versión anterior de Waitron. Reinstala Waitron en él. |

_2026-10-26: the built words differ from both tables above_ — the recovery page's in 7713ffb86 (owner, 2026-10-25: never "ask whoever installed") and 812e1d595, the setup app's `setup.start_again_incomplete` in U7d (882f4ced1, bbda87303) and its `setup.workspace_unsupported` in 7713ffb86. They live in `apps/server/src/recovery-surface.ts:458-481` and `apps/setup/src/i18n/strings/shell.ts:9-12` (English) and `:157-160` (Spanish).

A damaged note is not a start refusal. It is read only when a name is chosen, so the setup or restore screen shows `setup.attempt_invalid`'s existing text. On a box with `waitron.sh` the way out is `waitron.sh reset --all` (Q4); on a box the USB stick installed, which has no `waitron.sh` (B3 design §17 item 3, `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md:1031-1033`), the way out is in "For the owner: what waits for approval", part 3.

## Review focus

1. **Clock set back by more than 150 seconds behind the note**, with a second clock that agrees: refused `minute_not_later` with `allowedFromMs` equal to the note's floor; nothing recorded. Task 1b.
2. **Power lost at each step of Start again** — after the confirmation record, after the note, after the marker, after each deletion, with a repair-page read in between: the next start finishes exactly the marked deletion, or serves the recovery page and deletes nothing; a restored or newly placed database, and rows written into a `-wal` after the cut, are never deleted. Tasks 3b, 3c.
3. **An attempt that never chose a name, or whose owner recovered the password twice (a `step-000003/` record subfolder), interrupted mid-deletion:** the next start finishes it and leaves nothing behind. Tasks 3b, 3c.
4. **A damaged note** (empty file, `{}`, `"lastName": ""`, an extra key, a lower floor): refused wherever it is read; a second Start again never lowers it. Task 2.
5. **The abandoned attempt's `node.db`** is never reused by the next attempt, and a `node.db` that holds a table refuses Start again. Task 3c.
6. **The missing-database ask:** no Start again without the confirmation; a `shown` summary that differs from the server's own refuses with nothing written; the confirmation record exists before the first deletion (inject a failure into the first deletion and read it); a finished-fiscal-step attempt shows that line and is still deletable on confirmation; the note still holds the attempt's name; the summary sent is the one the page displayed. Tasks 3a2, 3a3, 3c, 5g.
7. **The note is never deleted or lowered:** after Start again (both paths), a restart, a restore, the in-app reset, a plain `waitron.sh reset` and a cut note write, the note's bytes are the same or a later note's; only `reset --all` removes it. Tasks 2, 3b, 6b.
8. **A backup recovery started and given up (point 5):** an A731 journal in either folder, at any phase, refuses Start again and nothing of A731's is deleted or changed — above all never its target's `venue.lock`; the page shows the line under Recover from backup and does not offer Start again while a journal exists. Tasks 3c, 5g, 0 (m).

## Owner answers (2026-10-24)

The owner's verbatim answers are in `~/waitron-campaign/questions.md` (the sections headed "OWNER ANSWER — A1042 question …" and "OWNER CHANGE — A1042 question 3 REPLACED, and question 4 answered"). What each means for this plan:

1. **Start again when the venue database is missing — neither refuse nor proceed silently: ask.** Owner: "If we can't check the dB to see where we got to then we need to ask. Maybe there is no backup, maybe deleting the dB was an attempt to get the start again working properly." The repair page says plainly the box cannot check whether this attempt filed or sold anything, shows what the attempt's own record says it reached, and offers (a) recovery from a backup (A731) and (b) "nothing was filed or sold — start again", the latter still behind the setup password. The confirmation is recorded (who, when, what the record showed) before anything is deleted, and the note is still raised. **Built by:** D3a, Tasks 3a, 3a2, 3a3 and 5g; the wording is in "For the owner: what waits for approval", part 2.
2. **One note per box, whatever the tax number (A).** D2 as written; items S7c and S7k as approved.
3. **The note is never deleted in normal operation, and survives a reinstall from the USB stick (changed from A to B).** Owner: "Leave the note on disk. Imagine we start, write the note, restart read and delete the note, restart, no note to read, reuse the old note. So we only write the new note on top of the old, the note stays there. And when we get a new note from the primary we write it on the secondary as well, so there is distributed knowledge of the current note." Confirmed: "Yes, but reset --all wipes". No read, restart, Start again, recovery or plain `waitron.sh reset` removes it; a write only replaces it with a later name, never an earlier one and never nothing; a stick reinstall keeps it (a change to B3's design, drafted below, not edited into B3's spec); copies to a second node are a requirement on the failover work, not built here. **Built by:** D1's write rule, Global constraints, Tasks 2, 3b, 6b and 6c; Task 7 records the B3 change and the failover requirement.
4. **A plain `waitron.sh reset` keeps the note; `reset --all` removes it.** Task 6b.
5. **A950's rollback keeps the newer note (A).** Owner: "But normally we wouldn't update the note on an upgrade. It would be exceptional, eg changing the name of the software provider." Task 7 adds to A950's entry: its rollback never takes the note backwards, an ordinary upgrade never writes it, and it moves only when a new installation name is picked. See point 1 in "For the owner: what waits for approval" for what this build does about the moments it names.
6. **Practice databases stay outside the note (A)** — Demo, Prepare, a development box's Live, the readiness test run. D2 as written.
7. **"Existing assertions this plan changes" approved as written, except the items the answers to 1 and 3 change.** Those are rewritten in "For the owner: what waits for approval", part 4, and marked "REVISED — needs owner approval"; every other item is marked "approved 2026-10-24 (Q7)". The golden huella test and the inmutabilidad suite stay untouched.

## Owner answers (2026-10-25)

The owner answered "For the owner: what waits for approval" on 2026-10-25, about 02:52 (`~/waitron-campaign/questions.md`):

1. **Points 1–5 approved as recommended:** 1A (build Start again only now; Task 7 adds the backlog entry and the `deploy/README.md` sentence), 2A (every status but `complete` on a missing database), 3A (confirmation records in the state folder, not carried by a stick reinstall), 4A (on a stick-installed box nothing removes the note but an unreadable header copy), 5B (Start again stays refused while any A731 journal exists, and the page says so).
2. **Part 2, the repair page's words, approved with one change:** the page says "activation", the setup app's own word, instead of "the fiscal step" — EN "started activation, with no record that it finished" / "finished activation"; ES «empezó la activación, sin constancia de que terminara» / «terminó la activación». Owner: "Write these to match the article style of the setup app's existing 'activation' strings; check its EN and ES files." Checked on 2026-10-25; the table in part 2 says which strings were matched.
3. **Part 3, the B3 header change, approved as written.**
4. **Part 4, every test change approved as written:** S5, S10, S12, S13, S14, A2, A3, S23, S24, each now marked "approved 2026-10-25 (owner)".

Task 0 then found three more test changes and one cost of point 5 that the owner has not seen: "Task 0 findings that need the owner", near the top.

## For the owner: what waits for approval

**Status, 2026-10-25: all four parts approved by the owner** ("Owner answers (2026-10-25)"), with one wording change in part 2. The text below is kept as the owner read it, apart from that change and the answer recorded beside each point. Anything newer waits in "Task 0 findings that need the owner".

Four parts, all to be answered or approved before any build: (1) five points, each with a recommended answer; (2) the repair page's words when the database is missing, in English and Spanish, with two worked examples; (3) the proposed change to B3's design; (4) the test changes marked REVISED or NEW.

### 1. Points to answer

Each comes with a recommendation. **The owner chose the recommended answer for all five on 2026-10-25: 1A, 2A, 3A, 4A, 5B.**

1. **When the note moves.** The owner's Q5 remark names the moments a new installation name is picked: setup, restore, re-registration, promotion, and rare changes such as the software provider's name. **This build writes the note only at Start again**, as approved. Writing it at the moment each of those paths picks its name would make the name chooser refuse that same request's own name until the next minute starts: the chooser takes the request's existing pick (`packages/fiscal-verifactu/src/hour-selection.ts:326-328`) and refuses it with `minute_not_later` while the clock is before any recorded time floor (`:409-416`). The round-4 reviewer ran this (`/tmp/a1042-review4/own-pick.test.ts`, outside the repo, driving the real chooser): with no note, a re-read 20 seconds after the pick answered `selected`; with a note at the start of the next minute, `minute_not_later`; at that next minute, `selected` again. What the note therefore does not hold in this build:
   - **the name the box trades under** — after a stick reinstall without a backup, only the two-clock check guards it, as today;
   - **the name an unfinished setup chose, after a plain `waitron.sh reset`** — the reset deletes `first-setup.json` and the kept picks file and keeps the note, so the abandoned name (perhaps already printed on a delivered recovery sheet) is guarded only by the two-clock check, as today.

   **A (recommended): build Start again only now.** Task 7 adds one backlog entry for both: move the note whenever a name is put into use (setup's fiscal step finishing, a restore finishing, a re-registration, a promotion), designed so the chooser never refuses its own request, and have a plain reset raise the note from an unfinished setup before deleting it. Until then `deploy/README.md` says plainly that a reset during an unfinished setup forgets that setup's series name (Task 7). This entry is also what makes the failover copy "the current note". B: add both to this plan now, as their own tasks, after a trace of those paths.
2. **Statuses on a missing database.** To show "finished the fiscal step", as the owner's example does, the ask is offered for every status except `complete` — wider than today's `claimed`, `consumption-intent` and `abandoned` (D3a). **A (recommended): approve.** B: keep today's three statuses; an attempt past them then has no way forward on the page but recovery from a backup or a reinstall.
3. **Where the confirmation records live.** In the box's state folder, beside the note, kept like it (a plain reset keeps them, `reset --all` removes them), never in a backup, and **not carried by a stick reinstall** — only the note is. Each holds the administrator's name and email for as long as the box keeps it, because the owner asked to record who confirmed. **A (recommended): accept.** B: carry them in the header copy too — which would make that name and email readable from the disk without its key.
4. **On a box the stick installed, nothing removes the note** except a header copy that cannot be read; there is no `waitron.sh` there. A damaged state-folder copy is put back from the header at the next start. **A (recommended): accept.** B: give the reinstall screen a way to drop the note.
5. **A backup recovery that was started and then given up.** Read and probed on the landed A731 ("What A731 changed", items 9 and 10): the moment a backup is prepared, before any data is placed, A731 writes a journal into the state folder and a pointer to it into both folders; it never deletes them; from then on every start serves the repair page from them; and a name the recovery picked is recorded inside the journal. The journal's restore target also holds a `venue.lock` (`target/venue/venue.lock`), which nothing may ever unlink (`packages/store/src/venue-lock.ts:7-10`, `CLAUDE.md` §3). A731's own plan asks to preserve such records (`docs/superpowers/plans/2026-10-24-a731-repair-backup.md:25` at 40eed0cde).
   - **B (recommended): Start again stays refused while any A731 journal exists, and the page says so before the person chooses.** Under Recover from backup the ask shows: "After you start a recovery, Start again is no longer offered." / «Si empiezas una recuperación, ya no podrás empezar de nuevo.» Once a journal exists, the ask no longer offers Start again (the page learns it from A731's `GET …/backup/status`, which needs no password; Task 0 (m) names the field: `phase`, where `"unstarted"` means no journal). **Safe because nothing is deleted:** Start again writes nothing at all while a journal exists, so no name can be lost and no lock or half-deleted folder can result. **What it costs:** a person who starts a recovery and then gives up can only finish a recovery or have Waitron reinstalled; whether A731 then accepts a different backup into the same recovery was not checked (Task 0 (m) checks it). **Run on 2026-10-25: it does not** — "Task 0 findings that need the owner", item 2. A backlog entry (Task 7) records the gap.
   - **A, not recommended:** Start again deletes a recovery that never placed anything, together with the attempt. It needs one of two things this plan cannot show to be safe. **Either** an exception to "never unlink `venue.lock`" for the abandoned target's lock — which the owner's rule and `CLAUDE.md` §3 forbid, and which this plan does not propose. **Or** leaving the target's venue folder, and so its lock, in place — but then `backup-recovery/` stays, and A731 cannot tell it from a live recovery: with its `current.json` kept, every start keeps serving A731's repair for an attempt that no longer exists, and its next record is refused because the attempt's files no longer match (`packages/provisioning/src/first-setup-backup-workspace.ts:578`); with `current.json` removed, its `witness` refuses `setup.attempt_uncertain` (`:242-252`) and the start falls back to the repair page (`apps/server/src/first-setup-backup-entry.ts:98-101`). Either way the box never reaches a fresh first setup. A safe A needs A731 itself to learn an "abandoned" recovery that its entry treats as absent while its folder and lock stay — its own design, not this plan's.

### 2. The repair page's words when the database is missing

**Where this appears, and why there.** On the setup app's repair page, which the box serves after an interrupted first setup — not on the recovery page the box serves after a failed start. Evidence and reasons: "Where the missing-database Start again is offered today, and why the ask belongs there" (Current behaviour). Before the setup password is entered, anyone on the venue's network sees the first line below, today's password field (not drawn when the password cannot be checked: it needs a saved session or a checkable password, `setup-app.ts:2160-2165`; today's `uncheckable` line shows instead), A731's Recover from backup button, and today's disabled Start again button with its `startUnavailable` line (`:2198,2206`) — but none of the ask's lines, which need the password step; the rest appears after the password step, as today's Start again does (`setup-app.ts:2121-2132`).

**The words.** Keys in `apps/setup/src/screens/initial-owner-strings.ts` (Spanish goes only in that file when built). `{name}` is the series name the server sends; the page never works it out.

| Key | English | Spanish |
| --- | --- | --- |
| `missingDatabase` (replaces today's, `:12-13`, `:49-50`) | The setup database is missing. | Falta la base de datos de configuración. |
| `missingAsk` | This box cannot check whether this setup filed anything to AEAT or made a sale. Its record says it: | Este equipo no puede comprobar si esta configuración envió algo a la AEAT o hizo alguna venta. Su registro dice que: |
| `reachedName` | chose the invoice series name {name} | eligió el nombre de serie de facturas {name} |
| `reachedNoName` | chose no invoice series name | no eligió ningún nombre de serie de facturas |
| `reachedFiscalStarted` (owner, 2026-10-25) | started activation, with no record that it finished | empezó la activación, sin constancia de que terminara |
| `reachedFiscalFinished` (owner, 2026-10-25) | finished activation | terminó la activación |
| `missingBackup` | If you have a backup, recover from it. | Si tienes una copia, recupera desde ella. |
| `recoverBackupNote` (point 5 B; under the Recover from backup button, while no recovery has started) | After you start a recovery, Start again is no longer offered. | Si empiezas una recuperación, ya no podrás empezar de nuevo. |
| `recoverBackup` (A731's, landed, unchanged: `:4`, `:41`) | Recover from backup | Recuperar desde una copia |
| `startAgain` (unchanged) | Start again | Empezar de nuevo |
| `startAgainHelp` (also used when the database is present) | Deletes this attempt. This box will not use its invoice series names again. | Borra este intento. Este equipo no volverá a usar sus nombres de serie de facturas. |
| `recoveryRecordDamaged` | This setup's recovery-key record is damaged and cannot be read. | El registro de la clave de recuperación de esta configuración está dañado y no se puede leer. |
| `missingConfirm` (the tick box's label; the tick box keeps `data-test="retire-confirmed"`, and Start again stays disabled until it is ticked) | Nothing was filed to AEAT and nothing was sold. | No se envió nada a la AEAT ni se vendió nada. |
| `restarting` (also used when the database is present) | The old attempt is deleted. Reconnect to continue. | El intento anterior se ha borrado. Reconecta para continuar. |

Why these words: «de configuración» is kept as today's strings say it. "Invoice series name" replaces this page's older "installation code" / «código de instalación» (today's `startAgainHelp`, `:21`, `:60`), to match the fiscal screens ("Series name", `packages/fiscal-verifactu/src/setup/first-hour.ts:89`); "installation code" is retired on this page. The help line says "this box will not use" rather than "never used again", because the note is per box and `reset --all` removes it (round-4 review, L4).

The list under `missingAsk` has one or two lines: `reachedName` (or `reachedNoName` when the server sends no name), then `reachedFiscalStarted` or `reachedFiscalFinished` when the record reached that far. **"Activation", in the setup app's own article style (owner, 2026-10-25).** The draft said "the fiscal step"; the owner chose the setup app's word. Its existing strings use the bare noun in English and the noun with its article in Spanish: "Do not repeat activation." / «No repitas la activación.» (`apps/setup/src/screens/initial-owner-strings.ts:35`, `:74` — this same page's strings file); "This request does not confirm activation." / «Esta solicitud no confirma la activación.» (`apps/setup/src/i18n/strings/restore.ts:20`, `:194`); "Confirm before activation." / «Confirma antes de activar.» (`apps/setup/src/screens/initial-setup-strings.ts:9`, `:28`); and the verb in "before activating production" / «antes de activar la producción» (`apps/setup/src/i18n/strings/shell.ts:46`, `:188`). Found by `/usr/bin/grep -rn -i "activat\|activación\|activar" apps/setup/src/i18n apps/setup/src/screens/*strings*.ts`. So the English lines say "started activation" and "finished activation", with no article, and the Spanish lines say «la activación» — the owner's words, unchanged.

**Worked example 1 — an attempt that only chose a series name** (it chose `0CNQT`; its record shows `candidates` and `consumption-intent`, no `activation-started`). After the password step:

> **First setup was interrupted**
> The setup database is missing.
> This box cannot check whether this setup filed anything to AEAT or made a sale. Its record says it:
> - chose the invoice series name 0CNQT
>
> If you have a backup, recover from it.
> [Recover from backup] [Start again]
> After you start a recovery, Start again is no longer offered.

Pressing Start again opens the confirmation:

> Deletes this attempt. This box will not use its invoice series names again.
> ☐ Nothing was filed to AEAT and nothing was sold.
> [Cancel] [Start again] ← disabled until ticked

Spanish:

> **La configuración inicial se interrumpió**
> Falta la base de datos de configuración.
> Este equipo no puede comprobar si esta configuración envió algo a la AEAT o hizo alguna venta. Su registro dice que:
> - eligió el nombre de serie de facturas 0CNQT
>
> Si tienes una copia, recupera desde ella.
> [Recuperar desde una copia] [Empezar de nuevo]
> Si empiezas una recuperación, ya no podrás empezar de nuevo.
>
> Borra este intento. Este equipo no volverá a usar sus nombres de serie de facturas.
> ☐ No se envió nada a la AEAT ni se vendió nada.
> [Cancelar] [Empezar de nuevo]

The confirmation record written before anything is deleted: `"shown": { "reached": "named", "lastName": "0CNQT" }`, with the administrator's name and email, the time and the attempt's id (D3a). The note then holds `0CNQT`.

**Worked example 2 — an attempt that finished activation** (it chose `0CNQT`; its record shows `activation-started` and `committed`):

> **First setup was interrupted**
> The setup database is missing.
> This box cannot check whether this setup filed anything to AEAT or made a sale. Its record says it:
> - chose the invoice series name 0CNQT
> - finished activation
>
> If you have a backup, recover from it.
> [Recover from backup] [Start again]
> After you start a recovery, Start again is no longer offered.

Spanish:

> **La configuración inicial se interrumpió**
> Falta la base de datos de configuración.
> Este equipo no puede comprobar si esta configuración envió algo a la AEAT o hizo alguna venta. Su registro dice que:
> - eligió el nombre de serie de facturas 0CNQT
> - terminó la activación
>
> Si tienes una copia, recupera desde ella.
> [Recuperar desde una copia] [Empezar de nuevo]
> Si empiezas una recuperación, ya no podrás empezar de nuevo.

The confirmation is the same as in example 1. The record: `"shown": { "reached": "fiscal-finished", "lastName": "0CNQT" }`.

**After Start again** the page shows `restarting` and the box restarts into a new first setup (Task 3c). A refused Start again shows its code's existing text (`FIRST_SETUP_ERROR_MESSAGES`, `apps/setup/src/setup-app.ts:196-201`) and asks for the password again, as today (`apps/setup/src/setup-app-missing-database.test.ts:70-90`).

### 3. Proposed change to B3's design (B3's spec is not edited here)

**Where the note lives on a box the stick installed.** The note is `first-setup-start-again.json` in the state folder. On a box the stick installed, the state folder is the `waitron_state` Docker volume, inside the `@volumes` subvolume, inside the encrypted container (B3 design §6, `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md:356,359`). A reinstall erases the whole disk (§5.5, `:322-324`), and B3 proposes no reinstall that keeps venue data (§17 item 5, `:1038-1039`). So, as B3 is designed today, a reinstall erases the note.

**The change: a copy of the note travels in the container's header, beside the name tag.** B3 already keeps one thing the installer reads before erasing: the venue's name tag, "a record of Waitron's own kind in the container's header — readable and writable without the key" (§7.6, `:605-613`), which the reinstall screen reads (§5.1 guard 3, `:223-227`). The note goes there too. Proposed wording, to add to B3 §7.6 after its first paragraph:

> **The series-name note travels with the name tag** (owner, A1042, 2026-10-24). Beside the name tag, the container's header holds a second record of Waitron's own kind: a copy of the box's series-name note (`first-setup-start-again.json`, the last invoice series name an abandoned first setup chose and the earliest moment a later one may be taken). The box's host service (§8) copies the note there whenever it changes, and only ever replaces the copy with a later one. Like the name tag it is readable without the key; it holds nothing secret, because a series name is printed on every invoice. **A reinstall carries it:** when the installer reads the disk (§5 step 2) it reads this copy with the name tag, keeps it in memory, and writes it into the new disk's state folder when it writes the box's setup code (§5.5), so the reinstalled box never issues a series name at or before it. A copy that cannot be read, or that fails the note's own checks, is not carried, and the reinstall screen says so in one line: «No se puede leer la nota del último nombre de serie; no se conservará.» A disk the installer cannot recognise (§5.2) carries nothing. **At every start** the host service compares the two copies and writes the header's back into the state folder when it is later or the state folder's cannot be read — which is also how a rollback of `@volumes` by A950 (§6) never takes the note backwards.

And one sentence at the end of §17 item 5: "The series-name note is the one exception: a reinstall carries it (§7.6)."

What this leaves: a box the stick installed has no `waitron.sh`, so no `reset --all` (§17 item 3, `:1031-1033`); nothing removes its note except a header copy that cannot be read. Point 4 asks the owner to accept that. The confirmation records (D3a) are not carried (point 3).

### 4. Test changes that need approval

**Approved by the owner, every item as written, on 2026-10-25.** The owner approved "Existing assertions this plan changes" as written except the items the answers to Q1 and Q3 change (Q7). Those are rewritten here and marked **REVISED**; the landed A731 adds two items marked **NEW**. Every line was re-read at main 40eed0cde (none of the files behind S5–S14, A2 and A3 changed between 69a7e2ae3 and 40eed0cde; the round-4 reviewer confirmed every reference). The full list, with the approved items, is "Existing assertions this plan changes" below.

- **S5. REVISED — approved 2026-10-25 (owner).** `apps/server/src/first-setup-unused-pdf.test.ts:205-239` "an earlier abandoned activation with a missing database does not become empty because a replacement has an unused PDF". Old: an attempt taken to `activation-started` and abandoned, its `venue.db` removed, the password recovered; the password Start again succeeds (`:221-232`), and a replacement attempt built in the new workspace is refused `setup.not_ready` at `start()` (`:233-238`). The version the owner saw: refused `setup.not_ready` (Q1 A) — withdrawn. New, Task 3a3: the same Start again without a confirmation is refused `setup.not_ready` and nothing changes; with a confirmation whose `shown` is `{ reached: "fiscal-started", lastName: <the attempt's name> }` it succeeds and a confirmation record holding that summary is in the box's state folder; a `shown` that differs is refused `setup.attempt_conflict` with nothing written; an added row takes an attempt through `committed` before abandoning it and gets `fiscal-finished`. New, Task 3e: `:233-238` — no replacement is built in a new workspace; a fresh attempt in the same folders, with both clocks before the note's floor, is refused `minute_not_later` at selection, and the note holds the abandoned attempt's name. Why: Q1's answer is ask, not refuse.
- **S10. REVISED — approved 2026-10-25 (owner).** `apps/server/src/first-fiscal-hour-finish.test.ts:498-535` "a missing hour database needs freshly recovered ownership before retirement". Old: after a fresh password recovery, Start again with no register answer resolves `{ selectionGeneration: 1 }` (`:513-514`); the record store holds four records, each `{ database: "missing", authority: "original-password", register: null }` (`:515-532`); its stored originals equal the snapshot (`:533`). The version the owner saw: refused whatever the ownership — withdrawn. New, Task 3a3: without the confirmation → `setup.not_ready`; with it (its `shown` as the fixture's record gives, which Task 3a3 writes into the commit message) → succeeds, and the confirmation record holds the administrator's name and email from the frozen request, `ownerGeneration`, `database: "missing"` and that summary; an added row whose owner's latest event is not a fresh `recover` is refused `setup.owner_required` even with the confirmation — the subject the title names, which the case never tested. New, Task 3e: the record-store assertions (`:515-533`) go, because Start again deletes the record folders; the case asserts that no marker remains and the note holds the attempt's name. Why: Q1's answer.
- **S12. REVISED — approved 2026-10-25 (owner).** `apps/server/src/first-fiscal-hour.e2e.test.ts:23-194` (six rows: `src/bin.ts` and `src/node-entry.ts`, each with three selection states). Old: a trusted HTTPS password Start again on a missing database, with `restore-request.json` and `reset-request.json` written first (`:75-76`), answers `{ workspaceId, selectionGeneration: 1, restarting: true }` (`:99-103`); the box restarts into the new workspace (`:106-112`); two rows interrupt and resume the workspace selection (`:113-157`); later starts serve `{ claimed: false }` in the workspace with a new certificate (`:158-172`); the old claim files, `restore-request.json` and `reset-request.json` are unchanged and `venue.db` is still missing in the original folders (`:173-186`). The version the owner saw: each row refused `setup.not_ready` — withdrawn. New, Task 3a3: each row reads the summary and sends the confirmation (one more request, no assertion changed), and an added request without it is refused `setup.not_ready`. New, Task 3e: two rows, one per script — the selection-state rows' subject, resuming a workspace selection, is gone (Task 5d). Each: with `restore-request.json` and `reset-request.json` present, the confirmed Start again is refused `setup.not_ready` (D3's refusal list) and both files are unchanged; after removing them, it answers `{ restarting: true }`, the process exits to restart, the next two starts serve `{ claimed: false }` in the same folders, `tls/ca.crt` is unchanged, the note and one confirmation record are present, and `first-setup.json` and `first-setup-claim.json` are gone. Why: Q1's answer, and Start again now deletes in place.
- **S13. REVISED — approved 2026-10-25 (owner).** `apps/server/src/first-setup-resolution.route.test.ts:12-115` "trusted HTTPS recovers a missing-database attempt and retires it after %s" (three register answers). Old: the password Start again answers 200 `{ workspaceId, selectionGeneration: 1, restarting: true }` (`:92-97`), names no folder (`:98`) and requests a restart (`:99`); `first-setup.json` keeps `consumptionIntent: true` and its frozen request (`:100-102`); `venue.db` is still missing (`:103`); `/retry` answers 404 (`:104-107`). The version the owner saw: refused `setup.not_ready` — withdrawn. New, Task 3a3: the case reads the summary route (200, `{ reached: "named", lastName: <the fixture's name> }`); a Start again without the confirmation is refused `setup.not_ready` with `first-setup.json` unchanged; with it, 200, and the confirmation record holds that summary. New, Task 3e: the answer is `{ restarting: true }` (W1); `:100-102` → `first-setup.json` is gone; `:98`, `:99`, `:103` and `:104-107` unchanged. Why: Q1's answer.
- **S14. REVISED — approved 2026-10-25 (owner)** (only `:176-222` differs in substance from the version the owner saw). `apps/server/src/first-setup-resolution-inspection.test.ts`, Task 3e unless noted:
  - unchanged from the version the owner saw: `:96-111` "Start again retires a qualified unused workspace …" (`assertVenueFirstSetupAllowed` refuses afterwards, `:108-110`) → after a finished deletion it passes, and the folders hold nothing on D3's list; `:285-297` (two browsers) → one deletion, the second request refused `setup.start_again_incomplete` or `setup.not_ready` (recorded); `:299-337` (`selectionGeneration: 2` at `:325`) → two Start agains in the same folders each delete, and the note holds the later name; the vacuous `first-setup-retirement.json` absence checks at `:122,171,230,280,415` → "no marker and no note change".
  - **changed:** `:176-222` "an authenticated missing-database retirement preserves spent intent and all document bytes". Old: the Start again succeeds; `first-setup.json` is byte-for-byte unchanged with `consumptionIntent: true` (`:211-214`); `venue.db` is missing (`:215`); the malformed `first-fiscal-documents/orphan.json` keeps its bytes (`:216-218`); the new workspace has no `venue.db` (`:219-221`). The version the owner saw: refused (Q1 A) — withdrawn. New, Task 3a3: without the confirmation → `setup.not_ready`, nothing changed; with it, the outcome is recorded in Task 3a3's commit message: either it succeeds, with a confirmation record whose `shown` is `{ reached: "named", lastName: null }` (this fixture's frozen request names no module, `:40`), or the malformed chunk refuses it (`setup.attempt_invalid` or `sif.allocation_invalid`; S7l's rule: damage refuses, never "no floor") with nothing written. Anything else is a STOP. New, Task 3e, if it succeeded: `:211-214` → `first-setup.json` is gone; `:216-218` → `first-fiscal-documents/` is gone; `:215` unchanged; `:219-221` go.
- **A2. REVISED — approved 2026-10-25 (owner).** `apps/setup/src/setup-app-missing-database.test.ts` (whole suite, `:20-171`) and `setup-app-missing-database.a11y.test.ts` (`:25-68`). The version the owner saw: replaced by "no Start again on a missing database" — withdrawn; the suite stays and follows the ask (Task 5g):
  - `:20-34` (repair page kept after the password step) and `:131-171` (a late inspection): unchanged.
  - `:36-55` "retires only after password recovery, confirmation and a fresh owner-bound missing inspection": the page shows the summary's lines (expected text read from the strings file, both languages); the tick box keeps `data-test="retire-confirmed"` (so `:43`, `:82`, `:96`, `:102` and `:119` are unchanged) and its label is `missingConfirm`; the sent body (`:47`) gains `confirmMissingDatabase: { nothingFiledOrSold: true, shown: <the summary the page displayed> }`; `:45`'s literal "The old attempt is retained." → the strings file's `restarting`; `:52` (`requests.at(-2)` is the inspection) → the recorded order, with the summary request before it. Headers (`:48-51`), `:53` and `:54` unchanged.
  - `:57-68` "does not offer missing-database retirement for %s work" (`activation-started`, `committed`, `publication`, `complete`, `uncertain`): → the ask **is** offered for every one but `complete`, showing `reachedFiscalStarted` or `reachedFiscalFinished`; `complete` keeps all five assertions. Needs point 2's answer.
  - `:70-90` (a refused Start again asks for the password again) and `:106-129` (duplicate clicks): `:89` and `:128`'s literal "The old attempt is retained." → the strings file's `restarting`; every other assertion unchanged.
  - `:92-104` (cancel): unchanged.
  - The a11y suite's assertions are unchanged; its states gain one showing the ask with both summary lines.
- **A3. REVISED — approved 2026-10-25 (owner).** `apps/setup/src/first-setup-retirement.test.ts` (`:62-157`, the session's `retireMissingDatabase()`). The version the owner saw: Q1 A removes most of it — withdrawn; the file stays (Task 5g):
  - `:62-84`: `retireMissingDatabase(shown)` takes the summary the page displayed; the request paths (`:67-71`) gain the summary request, read again before sending; the body (`:72-76`) gains `confirmMissingDatabase`; the answer (`:66`) and the second call's `setup.owner_required` (`:79-83`) unchanged.
  - `:85-101` (changed evidence refused before Start again): unchanged.
  - `:102-111` "refuses %s work before inspection": `activation-started`, `committed`, `publication` and `uncertain` now proceed to the inspection and summary; `complete` keeps its refusal and its one-request assertion. Needs point 2's answer.
  - `:112-121` (incomplete restart answer) and `:122-157` (late answers): unchanged; `:122`'s rows gain a `summary` stage.
  - Added row (round-4 review, M2): "a summary that changed between display and confirmation is refused, and nothing is sent" — the summary route answers `fiscal-finished` where the page displayed `named`; `retireMissingDatabase(shown)` rejects `setup.attempt_conflict`, and no request reaches `/start-again`.
- **S23. NEW — approved 2026-10-25 (owner).** `apps/server/src/first-setup-backup-handoff.test.ts:275-285` (A731's list of routes refused while a recovery hands over): **one line added, none removed.** The new `/first-setup/resolution/start-again/summary` joins the list, so the test pins that it is refused during a handoff like Start again. `/first-setup/resolution/resume-selection` stays: the refusal comes from a fence over all of `/setup-api/*` (`apps/server/src/boot.ts:1018-1032`, `backupRepairOnly`), which answers 503 `setup.not_ready` whether or not the route exists, so the line stays valid after Task 5d removes that route. Task 3a2.
- **S24. NEW — approved 2026-10-25 (owner).** `apps/server/src/first-setup-backup-entry.v1.test.ts`, whose fixture `retired()` (`:35-110`, the `retire` record at `:65-75`) builds a box that today's Start again moved into a first-setup workspace; four cases use it (`/usr/bin/grep -n "retired(" apps/server/src/first-setup-backup-entry.v1.test.ts` prints `:35,112,222,274,304`). Such a box is refused `setup.workspace_unsupported` at the start (D4). **Deleted, subject gone:** `:111` "recovers from a V1 replacement while keeping its original anchor". **Rebuilt on an attempt in its own folders, assertions unchanged:** `:221` "uses the factory's bounded S3 adapter and preserves a missing-pointer refusal", `:273` "authenticates an archive despite a malformed unrelated Cloud origin" and `:303` "enables configured preproduction Cloud approval without enabling production", whose subjects are the S3 adapter, Cloud-origin handling and the Cloud approval gate, not the old layout. `:204` does not use the fixture and is unchanged. Task 5c1.

## How the assertion list was built

1. One sweep over every test file and test helper, for every symbol, file, field, route answer and code the tasks change or delete:
   ```sh
   PAT='readFirstSetupRetirementArchives|readFirstSetupRetirements|readRetiredFirstSetupStates|readRetiredSetup|selectFirstSetupWorkspace|resolveFirstSetupWorkspace|inspectFirstSetupWorkspaceSelection|assertFirstSetupBootTarget|assertFirstSetupVenueTarget|firstSetupAnchorFor|nextWorkspace|selectionGeneration|workspaceId|first-setup-workspaces|first-setup-selection\.json|first-setup-retirement\.json|first-setup-workspace\.json|"retire"|select-workspace|retireMissingDatabase|startAgainFirstSetup|resolution/start-again|module-preparation-state\.json|old attempt is retained|assertFreshAssignment|WorkspaceBinding'
   git ls-files '*.test.ts' '*.test.mjs' 'apps/*/test/*.ts' | xargs /usr/bin/grep -c -E "$PAT" | /usr/bin/grep -v ':0$'
   ```
   It prints 56 files at db4e0a6bf (re-run under bash, piped to `wc -l`; an earlier draft of this plan said 57). Each was read at its hits (`/usr/bin/grep -n -E "$PAT" <file>`).
2. Hits that do not change, and why:
   - `module-preparation-state.json` read in suites that never call Start again (`first-fiscal-hour-clock`, `-configured`, `-import.e2e`, `-modes`, `-preparation`, `-route`, `setup-first-fiscal.route`, `hour-promotion`, `hour-recovery-host`, `hour-recovery-placement-3`, `cli-owned-entry`, `cli-same-hour-entry`, `module-preparation-backup`, `setup-preparation-host`). Only Start again deletes that file.
   - The paper-register `"retire"` events (`packages/fiscal-verifactu/src/{paper-register-history,register-document,register-history}.test.ts`), which are another concept.
   - `packages/provisioning/src/first-setup-host-path.test.ts:12-15` and `apps/server/src/first-setup-entry.test.ts:334-365`, whose lists only gain the three new names: the note and the deletion marker (Tasks 1a and 2) and the confirmation folder (Task 3a).
   - The record store's suites `packages/provisioning/src/first-setup-resolution{,.integrity,.durability}.test.ts`, `first-setup-owner-audit.test.ts:344,360-363` and `apps/server/src/first-fiscal-declared-publication.test.ts:228`, because the record store keeps its actions and fields (D4).
3. Additions that need no approval (a whole-shape pin gaining a key): a `readSetupFacts` result gains `floors: []` in the stubs of `packages/fiscal-verifactu/src/{hour-preparation,initial-hour-setup,hour-setup-defaults}.test.ts`, `packages/provisioning/src/{setup-preparation-host,first-setup-runtime}.test.ts` and `apps/server/src/testing/hour-test-clock.test.ts`. Recovery history arrays gain nothing when no note exists (`startAgainFloorSources(null)` is `[]`), so suites without a note keep their pinned histories.
4. A second sweep for the two new codes and the refusals added to existing entry points: `git ls-files '*.test.ts' | xargs /usr/bin/grep -n -E 'assertVenueFirstSetupAllowed|inspectFirstSetupMarker|assertOtherSetupAllowed|attempt_uncertain'`. The legacy-refusal hits are items P5, P6 and S16.
5. Task 0's last step re-runs both sweeps after A731 lands; each task's first step re-runs the first sweep narrowed to its files.

## Existing assertions this plan changes — owner approval needed before the build

Line numbers at db4e0a6bf; none of these files changed between db4e0a6bf and 69a7e2ae3 (`git diff --stat` over them prints nothing), and the REVISED items were re-read at 69a7e2ae3. Task 0 re-reads them all after A731. "Subject gone" means the case tests something this change removes — archives, workspaces, workspace selection — and has no successor. The task named makes the change. Tests whose expected screen text comes from the strings file follow the new wording without an assertion change and are not listed.

**Status, 2026-10-24.** The owner approved this list as written (Q7) **except** the items the answers to Q1 and Q3 change. Each approved item ends "Approved 2026-10-24 (Q7)." The seven items marked **REVISED** (S5, S10, S12, S13, S14, A2, A3) replace the versions the owner saw, and two items marked **NEW** (S23, S24) come from the landed A731; their full text is in "For the owner: what waits for approval", part 4, and only a pointer is left here. **Status, 2026-10-25:** the owner approved all nine as written; each is marked "approved 2026-10-25 (owner)". Task 0 (2026-10-25, main 91aa8dfe0) added three items, S25, S26 and P8, which are marked **NEW (Task 0) — waits for the owner** and are not built before the owner approves them ("Task 0 findings that need the owner"). Line numbers moved since db4e0a6bf are corrected in place: S22's second file and nothing else in this list (Task 0 results, Step 5). A sweep for items the never-deleted note or the USB change touch found no other: the one existing pin on the reset's state clean-up, `scripts/waitron-sh.test.mjs:1487-1491`, still matches the changed command (run, see Current behaviour), and the list's other items concern archives, workspaces and the record store, not the note's lifetime.

**Wire body**
- **W1.** `apps/server/src/setup-first-fiscal-api.ts:846-850`, the Start again answer: `{ workspaceId, selectionGeneration, restarting: true }` → `{ restarting: true }` (keys removed; no workspace). Pinned at `apps/server/src/first-fiscal-hour-finish.test.ts:489`. The setup app's client already types the answer as `{ restarting: true }` (`apps/setup/src/api/client.ts:639-649`), and `apps/setup/src/first-setup-retirement.test.ts:112-120` is the incomplete-answer case, unchanged. The stubs that send the old shape change with it: `apps/setup/test/missing-database-browser.ts:61-65` and `apps/setup/src/setup-app-resolution.test.ts:52` (A4). Task 3e. **Approved 2026-10-24 (Q7).**

**Server — `apps/server/src/first-setup-unused-pdf.test.ts`**
- **S1.** `:84-119` "a never-activated box with a delivered PDF can start again after answering %s". Old: the new folders differ (`:90`); the records are `retire`/`select-workspace` (`:95-101`); the register is kept (`:102`); `readOriginals` equals the snapshot (`:103`); every old file is byte-for-byte unchanged (`:104-110`); `readForRepair().consumptionIntent` is true (`:111`); the new venue has no `venue.db` (`:112-114`); the old owner's status is `setup.attempt_uncertain` (`:115-117`). New: the same folders hold nothing on D3's list; no marker remains; the note's `lastName` is the PDF's name; the old owner's status is refused (Task 3e records the code; STOP if it succeeds). Why: deleted, not kept. Task 3e. **Approved 2026-10-24 (Q7).**
- **S2.** `:120-165` "retiring the unused PDF excludes hour $identity …": `assertFreshAssignment` → `setup.attempt_conflict` for spent rows becomes the next selection → `minute_not_later` at or before the note; the unspent row's name is selected. Why: the after-the-fact archive check goes. Task 3e3. **Approved 2026-10-24 (Q7).**
- **S3.** `:178-184`: resolves `{ selectionGeneration: 1 }` → resolves, note written. Task 3e. **Approved 2026-10-24 (Q7).**
- **S4.** `:186-203` "successive never-activated PDFs retain every old block while allowing a third replacement": the third Start again's `selectionGeneration: 3` under the same anchor → three Start agains in the same folders succeed and the note's floor is the latest name. Task 3e. **Approved 2026-10-24 (Q7).**
- **S5. REVISED — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- **S6.** `:279-281` (`first-setup-retirement.json` absent): passes whatever the code does once that file no longer exists → replaced by "no deletion marker and no note change". Task 3e. **Approved 2026-10-24 (Q7).**
- **S7.** `:325-355` and `:357-…` (interrupted unused-PDF selection resumes; HTTPS fresh answer for the same selection): deleted, subject gone. Task 3e3. **Approved 2026-10-24 (Q7).**

**Server — `apps/server/src/first-setup-retired-assignments.test.ts`** (the fixture retires through `records.prepare` and `selectFirstSetupWorkspace`, `:281-302`; rebuilt on Start again in Task 4b2)
- **S7a.** `:359-368` "fresh events cannot reuse a retired hour …": `assertFreshAssignment` → `setup.attempt_conflict` becomes the selection → `minute_not_later`. Task 4b2. **Approved 2026-10-24 (Q7).**
- **S7b.** `:369-381` "retirement still permits a %s": the `later-hour` row stays permitted. Task 4b2. **Approved 2026-10-24 (Q7).**
- **S7c.** the same case's `other-taxpayer` and `other-environment` rows: permitted → refused `minute_not_later` (Q2 A). Task 4b2. **Approved 2026-10-24 (Q7).**
- **S7d.** `:382-428` "the real hour candidate route protects a retired hour before freezing hour offset %s": offset 1 answers 400 `minute_not_later` with `allowedFromMs: instant(1) + 180_000` → refused or waiting, then a name later than the note; the exact answer is recorded by the task (the old value came from the kept picks file). STOP if a name at or before the note is ever given. Offset 2 is unchanged. Task 4b2. **Approved 2026-10-24 (Q7).**
- **S7e.** `:430-447` "activation refuses a retired hour even when a caller bypassed the candidate route": deleted. Activation no longer re-checks. A frozen request is written only by `select` (`packages/provisioning/src/first-setup-preparation.ts:242`, which runs the chooser with the note) and by `import`, which accepts only an input equal to that request (`:266`, through `packages/fiscal-verifactu/src/initial-hour-setup.ts:79`). Task 4b2 re-runs `/usr/bin/grep -rn 'kind: "candidates"\|kind: "import"' --include='*.ts' apps packages`; a new non-test writer is a STOP. **Approved 2026-10-24 (Q7).**
- **S7f.** `:449-455` "a retired hour at offset42 bounds fresh offset%s": `assertFreshAssignment` refusal → selection refusal for 1, 41, 42; 43 permitted. Task 4b2. **Approved 2026-10-24 (Q7).**
- **S7g.** `:457-476` "an empty replacement cannot erase inherited spent hours": Start again refused `setup.not_ready` → Start again succeeds, and the note keeps the inherited floor. Task 4c. **Approved 2026-10-24 (Q7).**
- **S7h.** `:478-507` "password recovery retires an unused replacement …": `selectionGeneration: 2`, two retirements with `register: null`, and the second retirement's state equal to the old → Start again with the password succeeds in the same folders, and the note holds the later of the two names. Task 3e3. **Approved 2026-10-24 (Q7).**
- **S7i.** `:509-520` and `:544-553` (retained public hour42; retained recovery document): `assertFreshAssignment` refusal → the name is folded into the note from the attempt's own public evidence, and the next selection is refused at or before it. `:570-582`'s outside row (`source: "outside"`): → Start again refused `setup.not_ready` while outside evidence is configured. Task 4c. **Approved 2026-10-24 (Q7).**
- **S7j.** `:522-528` "a retained hour under another software ID still consumes that taxpayer's hour": the same, through the note. Task 4c. **Approved 2026-10-24 (Q7).**
- **S7k.** `:530-543` "retained public hour facts preserve the %s namespace": permitted → refused (Q2 A). Task 4c. **Approved 2026-10-24 (Q7).**
- **S7l.** `:555-568` "damaged retired recovery document %s never becomes absence of history" and `:584-592` "invalid retained public evidence fails with a domain refusal": the damage now refuses Start again itself (`setup.attempt_invalid` or the seat's `sif.allocation_invalid`), never "no floor". Task 4c. **Approved 2026-10-24 (Q7).** Changed 2026-10-25 (owner, 10:04): a damaged kept recovery record is treated as missing; the summary says so and Start again needs that summary confirmed. Rows `syntax`, `binding`, `digest` at `first-setup-retired-assignments.test.ts:569-577`. Task S7l-a.
- **S7m.** `:594-680` "ordinary hour preparation retains earlier abandoned events for %s": `reuse` keeps its refusal, from the note; `later` keeps `0CR6J`, and the assertions on the old kept picks file (`:619-620`) move to the new attempt's file. Task 4c. **Approved 2026-10-24 (Q7).**
- **S7n.** `:683-…` "a live outside history may %s without releasing its archived hour42": → Start again refused `setup.not_ready` while outside evidence is configured (outside evidence is no longer folded). Task 4c. **Approved 2026-10-24 (Q7).**

**Server — `apps/server/src/first-fiscal-hour-finish.test.ts`**
- **S8.** `:267-366` "empty never-activated hour restart retains originals and burns the entire hour on every base". Old: new folders (`:290`), `resolveFirstSetupWorkspace` equals the binding (`:291-…`), `readOriginals` equals the snapshot (`:304`), files unchanged (`:305-322`), the kept picks file byte-for-byte unchanged (`:323`, read at `:276`), the old owner refused (`:325-…`). New: the kept picks file is gone after Start again (Task 1b); then, in Task 3e, the folders hold nothing on D3's list and the note holds the abandoned name. The case's subject — every base's name is burnt — is kept: the next selection is refused at or before the note (`:348-…`) and a later name is selected (`:354-…`). Tasks 1b and 3e. **Approved 2026-10-24 (Q7).**
- **S9.** `:368-421` (Start again refused for a non-empty database): the refusal stays; the vacuous `first-setup-retirement.json` absence check (`:416`) → "no marker and no note change". Task 3e. **Approved 2026-10-24 (Q7).**
- **S10. REVISED — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- **S11.** `:712-756` "hour restart can resume an interrupted workspace selection …": deleted, subject gone. Task 3e3. **Approved 2026-10-24 (Q7).**

**Server — other files**
- **S12. REVISED — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- **S13. REVISED — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- **S14. REVISED — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- **S15.** `apps/server/src/first-setup-recovery-delivery.test.ts:488-492`: the recovery document's bytes stay in place after Start again → the document is deleted with `first-fiscal-documents/`. Task 3e. **Approved 2026-10-24 (Q7).**
- **S16.** `apps/server/src/first-setup-workspace.test.ts` (three cases — raw boot `:25-39`, the restore command, staged restore and reset — refusing an old witness with `setup.attempt_uncertain`): refusal kept, code → `setup.workspace_unsupported` (D4). Task 5a2. **Approved 2026-10-24 (Q7).**
- **S17.** `apps/server/src/first-setup-resolution.boot.test.ts` (workspace-selection cases built on `:56`): replaced by the legacy-refusal and unfinished-deletion cases served on the recovery page (D5). Subject gone. Task 5c2. **Approved 2026-10-24 (Q7).**
- **S18.** `apps/server/src/first-setup-retirement-reads.test.ts` (whole suite; `:78` counts archive file opens): deleted, subject gone. Task 3e3. **Approved 2026-10-24 (Q7).**
- **S19.** `apps/server/src/first-setup-empty-selection.route.test.ts` (whole suite, `:205-400`): deleted, subject gone. Its HTTPS refusal (`:271`) moves to the Start again route; its "a file appears after retirement" rows (`:338-353`) are succeeded by Task 3c's marker cases. Task 3e3. **Approved 2026-10-24 (Q7).**
- **S20.** `apps/server/src/first-setup-selection.route.test.ts` (whole suite, `:145-336`): deleted, subject gone. Its password-throttling case (`:297`) moves to ownership recovery unless a case there already checks it (Task 5d greps first). Task 5d. **Approved 2026-10-24 (Q7).**
- **S21.** `apps/server/src/hour-backup-state.test.ts:207-316` ("captures the original anchor journal and restored floor after workspace retirement") and `apps/server/src/recovery-document-evidence.test.ts:106-158` ("retains the anchor's journal and both public floors after workspace selection"): deleted, subject gone; the anchor reads become reads of the folders given. Task 5a3. **Approved 2026-10-24 (Q7).**
- **S22.** `apps/server/src/node-entry.full-disk.test.ts:424-503` ("a start that first setup moved to a workspace") and `apps/server/src/start-full-disk.e2e.test.ts:497-534` (`:493-530` at 40eed0cde; #2049 added four lines above it): deleted, subject gone (the start no longer cleans a workspace's staging). Task 5e. **Approved 2026-10-24 (Q7).**

**Provisioning**
- **P1.** `packages/provisioning/src/first-setup-workspace.test.ts` (whole suite, 44 cases): deleted, replaced by the legacy-refusal cases. Subject gone. Task 5a. **Approved 2026-10-24 (Q7).**
- **P2.** `packages/provisioning/src/first-setup-state.test.ts:994-1160` (`retiredFixture`; claim refuses ids reused from retired attempts, `:1154`): deleted; the check against earlier attempts in `previous` stays. Task 4a. **Approved 2026-10-24 (Q7).**
- **P3.** `packages/provisioning/src/first-setup-preparation.test.ts:307-…, 402-…, 428-…` and `first-setup-command.test.ts:463-…` (conflicts driven by `readRetiredSetup`): deleted; Task 1b's cases check the floor. Task 4a. **Approved 2026-10-24 (Q7).**
- **P4.** `packages/provisioning/src/cli-first-setup.test.ts:277-334` "a command without a retired-evidence adapter refuses a successor workspace" (the `first-setup-runtime.ts:88` refusal): deleted with that refusal. Its other workspace fixtures are re-pointed to plain folders, assertions unchanged. Task 4a. **Approved 2026-10-24 (Q7).**
- **P5.** `packages/provisioning/src/first-setup-state.test.ts:975-992` "a retired root cannot be claimed again or accept a delayed state update": refusal kept, code `setup.attempt_uncertain` → `setup.workspace_unsupported`. Task 5a. **Approved 2026-10-24 (Q7).**
- **P6.** `packages/provisioning/src/first-setup-owner.test.ts:573-593` "retirement refuses existing owner capabilities …": the same code change. Task 5a. **Approved 2026-10-24 (Q7).**
- **P7.** `packages/provisioning/src/module-preparation-state.test.ts:243` (workspace fixture) and `:274-278` (`expect(await firstSetupAnchorFor(next))…`): the fixture becomes plain folders and the anchor assertion goes. Task 5a. **Approved 2026-10-24 (Q7).**

**Fiscal** (the historical dispatcher)
- **F1.** `packages/fiscal-verifactu/src/declared-paper-standby.test.ts:514,565,589,625,657`, `initial-cloud-setup.test.ts:335` and `declared-paper-consumers.test.ts:374` (each supplies `readRetiredSetup` and asserts its refusal): deleted with the retired-archive block of `allocation-configuration.ts:58-119`, which production does not use. Subject gone. Neither `allocation-configuration.test.ts` mentions retired setup (round-2 grep printed nothing), so neither is listed. Task 4d. **Approved 2026-10-24 (Q7).**

**Setup app** (A1 and A4 in Task 5f; A2 and A3 in Task 5g)
- **A1.** `apps/setup/src/setup-app-workspace-selection.test.ts` (whole suite, `:22-369`), `setup-app-workspace-selection.a11y.test.ts` and `apps/setup/test/workspace-selection-browser.ts`: deleted, subject gone. **Approved 2026-10-24 (Q7).**
- **A2. REVISED — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- **A3. REVISED — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- **A4.** `apps/setup/src/setup-app-resolution.test.ts:52` (a Start again stub sending the old answer) → sends `{ restarting: true }`; `:333`, `:338` and `:362` pin the literal "The old attempt is retained." (`:338` fails under the new wording; `:333` and `:362` would pass whatever happens) → read `restarting` from the strings file. **Approved 2026-10-24 (Q7).**

**A731's landed cases.** Read at 40eed0cde ("What A731 changed", item 12):
- **S23. NEW — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- **S24. NEW — approved 2026-10-25 (owner):** see "For the owner: what waits for approval", part 4.
- `apps/server/src/setup-first-backup-api.test.ts:674-…` (a Start again queued behind a recovery commit loses with 503 `setup.not_ready`): expected unchanged; Task 3a2 runs it, and a change is a STOP.
- Its archive-based floor carry-forward (Task 0 results, (a)): the cases that read archives are S25 and S26 below. Its "another backup sees the later floor" cases — `apps/server/src/first-setup-backup-recovery-opening.test.ts:155-218` and `apps/server/src/first-setup-backup-recovery-preparation.test.ts:69-…` — read the box's own kept picks file and the backup's history, never an archive, and never call Start again: expected unchanged; Task 4b1 runs both files, and a change is a STOP.
- **S25. NEW (Task 0) — waits for the owner.** `apps/server/src/first-setup-backup-history.test.ts:239-311` "reads both retained and current databases after an ordinary workspace selection" (it retires an attempt with a `retire` record and `selectFirstSetupWorkspace`, `:253-293`, and asserts both databases are read, `:311`): deleted, subject gone. Task 4b1.
- **S26. NEW (Task 0) — waits for the owner.** The same file: `:682-710` "reads retained outside evidence privately from archived snapshots, and refuses unreadable JSON" — deleted, subject gone (outside evidence inside archived snapshots; `readFirstSetupBackupSetups` loses its `retired` argument with the archive reader); `:726-735` "does not pass another module's retained setup context to the requested module" — rebuilt to hand the same attempt through the `roots` argument with canonical roots (`realpath`), its assertion `toEqual({ setups: [], publicEvidence: [] })` unchanged; if it cannot be kept, STOP. A new control case beside it: the same call for the real module returns one setup (run by the round-6 reviewer, see "Task 0 findings that need the owner"). Task 4b1.
- **P8. NEW (Task 0) — waits for the owner.** `packages/provisioning/src/first-setup-backup-workspace.test.ts:328-376` "rejects V1's retired source as a raw boot target while its V2 repair is pending" (it builds a workspace with `selectFirstSetupWorkspace`, `:330-368`, and its last refusal, `:374`, is about that workspace): deleted, subject gone (no workspaces; such a box is refused at the start, D4). Task 5a.
- Every other sweep hit in A731's suites is listed, with why it does not change, in Task 0 results, Step 5.

---

## Tasks

| Task | Title |
| --- | --- |
| 0 | After A731 lands, re-check this plan against main, with a fresh-context review |
| 0b | One way to find the box's own folders |
| 1a | The note file and the fiscal module's floor |
| 1b | Setup never issues a name at or before the note; Start again writes it and deletes the kept picks file |
| 2 | The note cannot be lowered, damaged into "no floor", or carried in by a restore |
| 3a | The summary and the confirmation record (provisioning) |
| 3a2 | A missing database: Start again asks, then proceeds on a recorded confirmation (Q1) — the server |
| 3a3 | The existing missing-database suites send the confirmation (S5, S10, S12, S13, S14: their Task 3a3 parts) |
| 3b | The deletion marker, and finishing an interrupted deletion safely |
| 3c | Start again deletes the attempt in place under the marker |
| 3d | Every other write and entry point refuses while a deletion is unfinished — provisioning and the server |
| 3d2 | The setup app's words for the two new codes |
| 3e | The existing Start again suites follow the deletion — the action-level suites |
| 3e2 | The existing Start again suites follow the deletion — the HTTPS suites (S12, S13) |
| 3e3 | The suites that needed Start again to make a workspace (S2, S7, S11, S18, S19, S7h) |
| 4a | Remove the retirement readers: module contract and provisioning |
| 4b1 | Remove the retirement readers from the server, with A731's archive callers (S25, S26) |
| 4b2 | Rebuild the retired-name fixture on Start again (S7a–S7f) |
| 4c | The remaining retired-name cases (S7g, S7i–S7n) and the second deletion proof |
| 4d | Remove the retired block of the historical dispatcher |
| 5a | Provisioning forgets workspaces; old archives are refused |
| 5a2 | The server's callers of the removed workspace functions (S16) |
| 5a3 | The anchor readers go (S21) |
| 5b | The recovery page's text for the two refusals |
| 5c1 | The start refuses an old archive or an unfinishable deletion (S24) |
| 5c2 | The start serves the recovery page for those refusals (S17) |
| 5d | The server's repair routes forget workspace selection (S20) |
| 5e | The start's workspace clean-up goes (S22) |
| 5f | The setup screens: Start again with the database present |
| 5g | The setup screens: the ask on a missing database |
| 6 | Restores, re-registrations and promotions honour the note |
| 6b | A plain `waitron.sh reset` keeps the note and the confirmation records; `reset --all` removes them (Q4) |
| 6c | Nothing deletes the note (Q3) |
| S7l-a | Start again treats a damaged kept recovery record as missing, and needs the warning acknowledged (server and provisioning) — as built |
| S7l-b | The repair page says the recovery-key record is damaged before Start again (setup screen) — as built |
| 7 | Documentation, backlog (A950, the failover requirement, B3) and the A679 pointer |
| 8 | Final qualification and parking for the owner |

**Push groups.** Each group is pushed once, after its last task; inside a group the tasks run in the table's order.
- **3a2–3a3**, because 3a2 makes the confirmation required and 3a3's suites still send none.
- **3c–3e3** (3c, 3d, 3d2, 3e, 3e2, 3e3), because 3c changes the Start again answer that 3e's and 3e2's suites still pin, and stops making the workspace that 3e3's suites need: S7, S11 and S19 inject a failure into the renaming of `first-setup-workspace.json` or `first-setup-selection.json`, S18 counts archive opens around three Start agains, and S7h and S2 read the returned workspace binding (round-6 review, M1; S2 was found while folding it in: `first-setup-unused-pdf.test.ts:129-130` builds its next host from the binding `f.start()` returns, read).
- **4a–4d** (4a, 4b1, 4b2, 4c, 4d), because 4a's removal leaves three things red: the server's type check until 4b1 (`apps/server/src/module-operation-host.ts:15` and A731's `first-setup-backup-history.ts:11` import a reader); `@waitron/fiscal-verifactu`'s type check until 4d (`packages/fiscal-verifactu/src/allocation-configuration.ts:48,58` calls `host?.readRetiredSetup?.(…)` on `ModuleOperationHost`, and F1's tests pass `readRetiredSetup` in host literals; the round-6 reviewer's probe showed TypeScript refuses such a call once the type lacks the field, TS2339); and `first-setup-retired-assignments.test.ts` until 4b2 and 4c, because `assertFreshAssignment` no longer reads archives (round-6 review, M2).
- **5a–5e** (5a, 5a2, 5a3, 5b, 5c1, 5c2, 5d, 5e), because 5a removes names the server imports. 5a2 and 5a3 rewrite every server caller on a path a later task's tests reach, so 5b–5e run their tests on working code; what stays red until its own task is listed in Task 5a, "Callers" (round-6 review, H1). The server's type check is red from 5a until 5d.

Every other task ends green.

### Task 0: Re-check this plan against main (A731 has landed), with a fresh-context review

**Files:** read only; edit only this plan.

- [x] **Step 1:** In the build worktree (`python3 ~/workspace/tools/worktree.py new waitron feat/a1042-start-again-note --headless`, from current main), confirm A731 is on main: `git log --oneline --grep=A731 -5` shows 40eed0cde (landed 2026-10-24). Note every commit since 40eed0cde that touches a file this plan names (`git log --stat 40eed0cde..HEAD`).
- [x] **Step 2:** `/usr/bin/grep -rn "readFirstSetupRetirementArchives\|readFirstSetupRetirements\|readRetiredFirstSetupStates\|readRetiredSetup\|selectFirstSetupWorkspace\|resolveFirstSetupWorkspace\|firstSetupAnchorFor\|startAgainFirstSetup\|assertVenueFirstSetupAllowed\|start-again\|cloudStartAgain" --include='*.ts' apps packages scripts` (the last two find routes named as text, such as A731's handoff list, and A731's separate Cloud "start again"). Put each A731 caller beside the task that changes it.
- [x] **Step 3:** For A731, record by `file:line`: (a) where it carries archive-based floors into its restore target's module history file, and its "a second backup/recovery still sees the later floor" case; (b) its tests that race its commit against Start again; (c) its calls of `firstSetupAnchorFor`; (d) how it finds the box's own folders from inside its nested target (its discovery file and resolver), for Task 0b; (e) its journal folder's name **in both the state and the venue folder** (D3's refusal and deletion lists; revision 5 read `first-setup-resolutions/backup-recovery/` in both, "What A731 changed", item 9); (f) whether its observation fingerprint covers files D3 deletes; (g) whether it added `apps/server/src/guide/{en,es}/backup-recovery.md` mentioning Start again; (h) its repair-open entry point (D3's marker refusals); (i) how its new entry admission orders against D5's refusals (revision 5: D5's checks go before `resolveFirstSetupBackupEntry`, item 11); (j) its Recover from backup button (revision 5, item 7); (k) whether its open step needs the setup password (revision 5, item 8: it does not); (l) what it writes into either folder that D3's lists or the note's "never deleted" rule must know about (revision 5, item 9); (m) **run, not read**: after an A731 open and `prepare` that never reached `placement-started`, then `close`, with an archive source and again with a Cloud source, (1) list every file it left in both folders (item 9's list; the Cloud source adds `cloud/` and perhaps `publication.json`), (2) re-check where the recovery's name pick landed (already pinned by `first-setup-backup-recovery-opening.test.ts:155-217`), (3) name the field of `GET …/backup/status` that tells the page a journal exists (point 5 B), (4) check whether A731 accepts a different backup into the same recovery, and (5) confirm point 5's answer still holds. (j)–(l) were read at 40eed0cde for revision 5; this step re-checks them on the build's main and runs (m).
- [x] **Step 4:** Check whether lane B's #2025 (clock check at every start) has landed; this plan does not depend on it.
- [x] **Step 5:** Re-run both sweeps of "How the assertion list was built"; correct moved line numbers; add every new hit, and (a) and (b), to the list. Send the additions to the owner before Task 4b. Refresh every line reference into `node-entry.ts`, `first-setup-launch.ts` and `boot.ts` (D5, Tasks 5c and 5e), and Task 7's backlog references (cited there by heading). If (j)–(m) change the ask's wording, point 5 or the REVISED or NEW items, send those to the owner too, before Task 3a2.
- [x] **Step 6:** Dispatch a fresh-context review of the updated plan against main (high effort, not an implementer), with probes where a claim can be run. Fold its findings into the plan; any change to the owner questions or the assertion list goes back to the owner. No implementer is dispatched before this review is folded in.
- [x] **Step 7:** Commit `git add docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md && git commit -s -m "docs: re-check A1042's plan against main after A731"`.

**Task 0 results (2026-10-25, main 91aa8dfe0, worktree `waitron-feat-a1042-start-again-note`).** Steps 1–7. "Read" means the code was read and nothing was run.

- **Step 1.** The worktree already existed (made from main 91aa8dfe0), so it was not created again. `git merge-base --is-ancestor 40eed0cde HEAD` answers yes. `git log --oneline 40eed0cde..HEAD` lists 22 commits. `git diff --name-only 40eed0cde..HEAD`, intersected with the paths this plan names, lists only: `apps/server/src/start-full-disk.e2e.test.ts` (#2049, 5ec6563c0: four lines added at `:303`, so S22's case moved from `:493-530` to `:497-534`); `apps/server/README.md` (#2049: a privacy-notice paragraph no task reads); `docs/backlog.md`, `docs/backlog/box.md`, `docs/backlog/setup.md` (A939 moves and landings: Task 7's references refreshed); `docs/developers/conventions-data.md` (one line added at `:787`, so Task 7's two references are one line later); `docs/developers/conventions-ui.md` and `docs/developers/testing-guide.md` (changes at `:498`, same length, and below `:1591`; below `:1494` — no cited line moved); and this plan. No first-setup, setup-app, entry or provisioning file changed after 40eed0cde.
- **Step 2.** The grep, re-run. A731's callers, each now beside its task: `apps/server/src/first-setup-backup-history.ts:9,11,57,58` (archive read: Task 4b1; anchor: Task 5a3); `apps/server/src/first-setup-backup-setups.ts:9,22-25` (the `retired` argument's type: Task 4b1); `apps/server/src/first-setup-backup-entry.ts:9,35,90` (anchor: Task 5a3); `apps/server/src/first-setup-backup-recovery.ts:18,20,170,387,388` (anchor and workspace: Task 5a3; these task names follow the round-6 review); `packages/provisioning/src/first-setup-backup-workspace.ts:11,280,681` (workspace and anchor: Task 5a). `first-setup-backup-recovery.ts:538` and `setup-first-backup-api.ts:268` are A731's Cloud restart, untouched. Every other hit is a caller this plan already names, or the setup app's Cloud "start again" (`apps/setup/src/screens/cloud-restore-screen.ts:143,215-217`, `apps/setup/src/api/client.ts:335,380`), untouched.
- **Step 3.**
  - **(a)** `preparation` (`apps/server/src/first-setup-backup-recovery.ts:354-439`) calls `readFirstSetupBackupHistory` (`:366-371`), which walks the archives (`first-setup-backup-history.ts:57-60`) and passes them to `readFirstSetupBackupSetups` (`:103-109`; archived attempts collected at `first-setup-backup-setups.ts:88`); it projects the result (`first-setup-backup-recovery.ts:380-384`) and writes it into the target's `module-evidence/<module>/<source>.json` through `evidence(entry, true)` (`:428`; the writer is `:328-353`). The archive-reading tests are S25 and S26 (new). The "another backup sees the later floor" cases, `first-setup-backup-recovery-opening.test.ts:155-218` and `first-setup-backup-recovery-preparation.test.ts:69-…`, read no archive: unchanged. The chooser on the target reads `readRecoveryFacts` (`:457-479`, history at `:465`), which is handed to `createSelectedRecoveryPreparation` as `options.readRecoveryFacts` (`:447-457`); that wrapper calls it (`apps/server/src/recovery-preparation.ts:154-158`) and appends its own floors, `backup-created` among them, to the history it returns (`:199-209`). So Task 6's one addition there, beside `backup-created`, also reaches A731's chooser, and A731's builder is not changed (corrected 2026-10-25 by the round-6 review, M4, which found the earlier draft adding the note twice). Read.
  - **(b)** `apps/server/src/setup-first-backup-api.test.ts:674-779`: the `start-again` row sends Start again at `:741-749` and expects 503 `setup.not_ready` (`:755-766`; corrected 2026-10-25 from `:757-766`, which left out the status line `:756`). D3 also refuses during a journal: expected unchanged. Read.
  - **(c)** `firstSetupAnchorFor`: `first-setup-backup-history.ts:57`, `first-setup-backup-entry.ts:35,90`, `first-setup-backup-recovery.ts:170,387`, `packages/provisioning/src/first-setup-backup-workspace.ts:681` (revision 5's `first-setup-backup-recovery.ts:216` was wrong; corrected in "What A731 changed", item 3).
  - **(d)** From inside the nested target, `resolveFirstSetupBackupWorkspace` (`packages/provisioning/src/first-setup-backup-workspace.ts:634-671`) reads `first-setup-resolutions/backup-recovery/backlink.json` in each target folder (`:638-640`), requires its `target.target` to be the folders given and every copy to agree (`:649-652`), takes `backlink.target.anchor` as the box's folders (`:654`), and requires the anchor's `current.json` (`witness`, `:242-278`) to equal the backlink (`:655`); any disagreement refuses `setup.attempt_uncertain`. Task 0b's "A731's target gives the anchor" uses it. Read.
  - **(e)** `first-setup-resolutions/backup-recovery/` (`NAMESPACE`, `first-setup-backup-workspace.ts:59`) in **both** folders, with a `current.json` in each (`currentPaths`, `:233-235`). Run: (m) found both.
  - **(f)** Yes. Its fingerprint `originals` (`first-setup-backup-workspace.ts:283-361`) walks every file of the box's folders and the source folders except its own journal folder, the `current.json` pointers and the venue lock journal and holder files (`walk`, `:298-309`), so it covers every file D3 deletes; the digest is checked before each action (`first-setup-backup-recovery.ts:252`) and at each append (`first-setup-backup-workspace.ts:578`). D3 refuses Start again while a journal exists, so the two never meet. Read.
  - **(g)** No. `/usr/bin/grep -rn -i "start again\|empezar de nuevo" apps/server/src/guide` prints nothing (exit 1); that covers A731's `backup-recovery.md` in both languages.
  - **(h)** `open` (`apps/server/src/first-setup-backup-recovery.ts:556-…`) and `resume` (`:758-…`), through `POST …/backup/open` and `…/backup/resume` (`apps/server/src/setup-first-backup-api.ts:224-241`). D3's marker list and Task 3d now name both.
  - **(i)** Unchanged: `resolveFirstSetupEntry` (`apps/server/src/first-setup-entry.ts:50-78`) asks A731's entry first (`:56`), then `resolveLegacyFirstSetupEntry` (`:80-…`, canonicalising at `:86-97`). D5's order stands.
  - **(j)** Unchanged: `apps/setup/src/setup-app.ts:2249`, drawn when `inspection && !this.firstRestarting`, with `inspection` set whenever the database is missing (`:2120`); labels `apps/setup/src/screens/initial-owner-strings.ts:4,41`.
  - **(k)** Unchanged: `GET …/backup/status` runs no transport check (`setup-first-backup-api.ts:212-215`); every POST does (`transport(c)`, `:220`); `open` takes the uploaded backup and the node recovery key, not the setup password.
  - **(l)** Run: (m) lists exactly item 9's files, and nothing in either folder was removed.
  - **(m)** **Run.** Two scratch test files in `apps/server/src/` (deleted before this commit; copies and their JSON reports kept in `/tmp/a1042-task0/`), `pnpm --filter @waitron/server exec vitest run src/zz-a1042-probe-archive.test.ts src/zz-a1042-probe-cloud.test.ts`: `Test Files 2 passed (2)`, `Tests 2 passed (2)`. Archive source: A731's `fixture(true)` (`apps/server/test/first-setup-backup-recovery-fixture.ts`); Cloud source: A731's `fixture()` (`apps/server/test/first-setup-backup-cloud-fixture.ts`, an approved Cloud point). Each: `open`, choose a name with `recoverySelectPastWaits` (both chose `0CNQW`), `close`, and list both folders before and after.
    1. Files left: the venue folder gains only `first-setup-resolutions/backup-recovery/current.json`; the state folder gains `first-setup-resolutions/backup-recovery/current.json` and `<recoveryId>/` holding `000001.json` and `000002.json` (both phase `prepared`; the pick only in the second), `evidence/0.bin`, `1.bin`, `2.bin`, `originals.json`, `retained-evidence.json`, `target/state/first-setup-resolutions/backup-recovery/backlink.json`, `target/state/module-evidence/fiscal-verifactu/hour-history.json`, `target/state/module-preparation-state.json`, `target/venue/first-setup-resolutions/backup-recovery/backlink.json` and `target/venue/venue.lock` (0 bytes). The Cloud source leaves the same plus `<recoveryId>/cloud/cloud-recovery.json`, and no `publication.json` (written only during `commit`, `first-setup-backup-recovery.ts:1025`, through `persistBackupRepairPublication`, `first-setup-backup-publication.ts:58-90` — read).
    2. The box's own `module-preparation-state.json` kept its bytes in both runs; the target's copy holds the recovery's pick.
    3. The field is **`phase`**: `GET …/backup/status` (`service.status()`, `first-setup-backup-recovery.ts:484-497`) answered `{ phase: "unstarted", proofRequired: true }` before and `{ phase: "prepared", recoveryId, proofRequired: true }` after `close`. It answers `"uncertain"` when it cannot read the journal (`:493`, read). A journal exists whenever `phase` is not `"unstarted"`. The setup app already types it (`apps/setup/src/api/first-setup-types.ts:133`) and calls it (`apps/setup/src/api/client.ts:283`).
    4. **A different backup is refused.** The same archive with one entry added (as A731's own `selectedRepair` builds a second backup) was refused `setup.attempt_conflict` both without the recovery's id (`first-setup-backup-recovery.ts:582-583`: a journal already exists) and with it (`:631-636`: another source). Control: the same backup with the id reopened the recovery. Had A731 accepted another backup, the probe would have printed `resolved` for it. Tried with the archive source only.
    5. After `close`, A731's start check `resolveFirstSetupBackupEntry` answered `repair` with the box's own folders in both runs, and `/usr/bin/grep -n backup-recovery apps/server/src/first-setup-resolution.ts packages/provisioning/src/first-setup-resolution-inspection.ts` still prints nothing (exit 1). Point 5 B holds; its newly known cost is "Task 0 findings that need the owner", item 2.
- **Step 4.** Lane B's #2025 has **not** landed: `gh pr view 2025` answers `"state":"OPEN"`, "parked for the owner". This plan does not depend on it.
- **Step 5.**
  - **First sweep**, run under bash as written: **64 files** at 91aa8dfe0, against 56 at db4e0a6bf and at 40eed0cde's parent (`git grep -c` at each). The 8 new files are all A731's: `first-setup-backup-entry.v1.test.ts` (S24); `first-setup-backup-handoff.test.ts:283` (S23); `first-setup-backup-history.test.ts` — `:34,254-293` are S25 (new), while `:98,478,569` read the box's kept picks file in cases that never call Start again (unchanged); `first-setup-backup-recovery-opening.test.ts:157,214,216,305,370`, `first-setup-backup-recovery-preparation.test.ts:72,85` and `first-setup-backup-recovery.test.ts:21,43` (kept picks reads; unchanged); `first-setup-backup-recovery.test.ts:347` (writes `first-setup-retirement.json` so the box stops admitting actions, and asserts only that the private copy is deleted, `:350`; the refusal's code becomes `setup.workspace_unsupported` under D4 but nothing asserts it — expected unchanged, and Task 5a3 runs it); `setup-first-backup-api.test.ts:683,742` ((b); unchanged); `packages/provisioning/src/first-setup-backup-workspace.test.ts:330-368` (P8, new). In the 56 older files every per-file count equals db4e0a6bf's; of them only `apps/setup/src/setup-app-resolution.test.ts` (A731 appended a case after `:468`; A4's `:52,333,338,362` unchanged) and `apps/server/src/start-full-disk.e2e.test.ts` (S22, moved) changed.
  - **Second sweep:** **36 files, 170 lines** at 91aa8dfe0, against 28 files and 145 lines at db4e0a6bf. The 8 new files are A731's, and the older 28 have the same per-file counts. The new hits are `setup.attempt_uncertain` refusals of A731's own journal; `/usr/bin/grep -n -i "first-setup-workspace\|retirement\|V1"` over those files finds a first-setup workspace only in `first-setup-backup-entry.v1.test.ts:189` (inside S24's deleted `:111` case) and `first-setup-backup-workspace.test.ts:374` (inside P8). No other item.
  - **Found outside the sweep pattern, by (a):** S26 (`readFirstSetupBackupSetups`'s `retired` argument).
  - **Line references refreshed** (unchanged since 40eed0cde): `node-entry.ts` — `pageLog` `:213-220`, the call `:326`, `needsConnectionBootstrap` `:349`, the moved-folders clean-up `:365-377`, the full-disk branch `:378-397`, the admission consumer `:399-417`, `runAdmittedEntry` `:453` and its log pair `:503-565`, `bootThisProcess` `:630` and its `.catch` `:668-675`; `first-setup-launch.ts` — `launch` `:71-113`, its consumer `:96-112`, `listen` `:43-47`, `requestRestart` `:75`, the fallback `:58-63`; `boot.ts` — `bootServer` `:843`, its first-setup target check `:873`, the `node.db` opens `:942,974`, the repair fence `:1018-1032`, `assertOtherAllowed` `:1123`; `packages/provisioning/src/index.ts:69-71`; `first-setup-entry.ts:201-203` (Start again's wiring). Task 7: `docs/backlog/setup.md`'s Decisions heading `:417`, `docs/backlog.md`'s entry `:557`, `docs/backlog/box.md:67` and `:382` unchanged, `docs/backlog/replication-cloud.md:372` unchanged, `docs/developers/conventions-data.md:2965-2968,3079-3084`.
  - The additions (S25, S26, P8) and point 5's cost go to the owner: "Task 0 findings that need the owner". Nothing found changes the approved wording, the approved answer to point 5, or an approved item.
- **Step 6.** The round-6 review (`~/waitron-campaign/item-a1042-plan-review-6.md`: 1 high, 5 medium, 10 low, four probes) is folded in. It changes no approved wording, not point 5, and not the substance of an approved item. It moves approved items between tasks — S2, S7, S11, S18, S19 and S7h to 3e3; S16 to 5a2; S21 to 5a3; S24 to 5c1; S17 to 5c2; S7a–S7f to 4b2 — and S25 and S26 to 4b1; adds detail and a control case to S26, which still waits for the owner; and adds the approved `recoverBackupNote` line to worked example 2 ("Task 0 findings that need the owner", item 3).
- **Step 7.** Committed as `docs: re-check A1042's plan against main and fold in the owner's answers`, since the commit also folds in the owner's answers of 2026-10-25.

### Task 0b: One way to find the box's own folders

**Files:** Create `packages/provisioning/src/box-folders.ts` and `box-folders.test.ts`; modify `packages/provisioning/src/index.ts`.

**Interfaces — produces:** `boxFolders(roots: { stateDir: string; venueDir: string }): Promise<{ stateDir: string; venueDir: string }>`, the box's own folders: for a first-setup workspace, its anchor (through today's `firstSetupAnchorFor`, until Task 5a); for a folder inside A731's nested target, the anchor its discovery file names (A731's resolver, Task 0 Step 3d); otherwise the folders given, canonical. An ambiguous answer refuses `setup.attempt_uncertain`. Tasks 1b, 3c and 6 read the note through it; Task 5a keeps it without the workspace branch.

- [ ] **Step 1:** Failing cases: "plain folders are their own", "a workspace's folders give the anchor", "A731's target gives the anchor", "a target whose discovery file disagrees is refused". Run `pnpm --filter @waitron/provisioning exec vitest run src/box-folders.test.ts`; expected FAIL (missing module).
- [ ] **Step 2:** Implement; run; PASS.
- [ ] **Step 3:** Commit `git commit -s -m "Find the box's own folders from a workspace or a repair target (A1042)"`.

### Task 1a: The note file and the fiscal module's floor

**Files:**
- Create: `packages/provisioning/src/first-setup-start-again-note.ts` and its `.test.ts`
- Modify: `packages/provisioning/src/first-setup-state.ts:137-148` (add `first-setup-start-again.json` and `first-setup-deleting.json`), `packages/provisioning/src/errors.ts` (the two new codes), `packages/provisioning/src/index.ts`, `packages/module/src/initial-setup.ts:69-84` (seat), `packages/fiscal-verifactu/src/initial-hour-setup.ts` (seat body) and its test

**Interfaces — produces:**
- `START_AGAIN_NOTE_FILE = "first-setup-start-again.json"`
- `interface StartAgainNote { version: 1; floorMs: number; lastName: string; module: string }`
- `readStartAgainNote(stateDir: string): Promise<StartAgainNote | null>` — missing file or folder → `null`; anything not exactly this shape → `setup.attempt_invalid`; limit 4096 bytes.
- `raiseStartAgainNote(stateDir: string, next: Omit<StartAgainNote, "version">): Promise<StartAgainNote>` — keeps whichever has the later `floorMs`, with that one's `lastName` and `module`; writes only when it rises.
- `startAgainFloorSources(note: StartAgainNote | null): readonly { reference: "start-again-note"; complete: true; records: readonly []; timeFloorMs: number }[]` — `[]` for `null`.
- Seat `startAgainFloor` as in D3. The fiscal body takes the latest minute across every attempt's frozen request or input (`readHourSetupInput`, `initial-hour-setup.ts:45`), every intent in `preparations` (`publicHourSelectionHistory`, `hour-selection.ts:178`, each row checked as `hour-backup-state.ts:22-44` does) and every name in `publicEvidence`, read by **calling** the seat's own `retainedAssignments` (`packages/fiscal-verifactu/src/initial-setup.ts:289`; `createHourInitialSetup` spreads it from its base), not by copying its parsing — once Tasks 4a and 4d remove its two production callers (`packages/provisioning/src/first-setup-preparation.ts:88`, `packages/fiscal-verifactu/src/allocation-configuration.ts:102`), this is the one left; `floorMs = EPOCH + (minute + 1) × 60 000`; `null` when there is none; any unreadable value throws `sif.allocation_invalid` (`history_invalid`), never `null`.

- [ ] **Step 1: Failing tests.** Provisioning: "a missing note is no floor", "a missing state folder is no floor", "a note round-trips exactly", "raising never lowers the floor" (write 200, raise to 100, read 200 with the first `lastName`), "an unreadable note is refused, not read as absent". Fiscal: "no name gives no floor", "the latest of a frozen request, an intent and public evidence gives the floor", "the floor is the start of the minute after the name", "an unreadable intent refuses rather than giving no floor".
- [ ] **Step 2:** Run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-note.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/initial-hour-setup.test.ts`; expected FAIL on the missing exports and seat.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both, `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-host-path.test.ts` (its pin only gains entries) and `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts`; PASS.
- [ ] **Step 5:** Commit `git commit -s -m "The start-again note file and the fiscal module's floor seat (A1042)"`.

### Task 1b: Setup never issues a name at or before the note; Start again writes it and deletes the kept picks file

Start again still makes a workspace here; Task 3c makes it delete in place.

**Files:**
- Create: `apps/server/src/first-setup-start-again-note.test.ts`
- Modify: `packages/module/src/operation-preparation.ts:29-35` (`readSetupFacts` gains `readonly floors: readonly unknown[]`), `packages/provisioning/src/first-setup-runtime.ts:236-245` (`floors: startAgainFloorSources(await readStartAgainNote((await boxFolders(options)).stateDir))`), `packages/fiscal-verifactu/src/hour-preparation.ts:173` (`history: [facts.localHistory, ...facts.floors]`), `apps/server/src/first-setup-resolution.ts:249-300` (gather, raise, delete the kept picks file)
- The six stubs in "How the assertion list was built" item 3 gain `floors: []`; S8's first part (`first-fiscal-hour-finish.test.ts:323`: the kept picks file is gone after Start again)
- Fixture: `apps/server/test/hour-first-fiscal.ts` (`hourFirstFiscalFixture`), the `answer()` and `start()` helpers of `apps/server/src/first-setup-unused-pdf.test.ts:66-81`, the clock helpers in `apps/server/src/testing/hour-test-clock.ts`

- [ ] **Step 1: Write the failing test** `apps/server/src/first-setup-start-again-note.test.ts` on `hourFirstFiscalFixture` (an attempt that has chosen a name and has a delivered recovery PDF), starting again with the `current-master` answer built exactly as `first-setup-unused-pdf.test.ts:66-81` builds it:
  - `"a start-again with the clock set back behind the abandoned attempt's name is refused, not given a repeated name"`: read the abandoned name `M` from the frozen request; Start again; `expect(await readStartAgainNote(anchorStateDir)).toEqual({ version: 1, floorMs: F, lastName: M, module: "fiscal-verifactu" })` where `F` is the start of the minute after `M`; the kept picks file in the anchor state folder is gone; set both clocks to 10 minutes before `M`'s minute; a new attempt's selection rejects with `{ code: "sif.allocation_invalid", params: { reason: "minute_not_later", allowedFromMs: F } }`; afterwards the new attempt's frozen request is `null`, `consumptionIntent` is `false`, and `readModulePreparationHistory` holds no intent for the new event.
  - `"at the abandoned name's own minute, setup waits and then chooses a later name"`: clock at the start of `M`'s minute; `selectPastWaits` resolves to a name whose `decodeMinuteIdentity` is greater than `M`'s.
  - `"a clock past the note chooses a later name at once"`: clock 5 minutes after `F`; the name decodes later than `M`.
- [ ] **Step 2: Run it and read the failure.** `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts`. **The refusal assertions already pass on today's code**, because the kept picks file refuses the clock-behind case. The test fails today only on the note assertions: it prints that `readStartAgainNote` returned `null` where the note object was expected (or the missing export, if Task 1a has not landed), and the kept picks file still exists. What makes the check count is the deletion proof in Step 5, and again in Task 4c. **Do not change Start again's rules to make the test reach its scenario.** If the fixture is refused `setup.not_ready`, the fixture is wrong: STOP and report.
- [ ] **Step 3: Implement.** In `startAgainFirstSetup`, after the proof and before `records.prepare`: for each frozen module with a seat, collect `[state, ...state.previous]` contexts and inputs (`firstSetupModuleContext`), `readModulePreparationHistory(anchor, module)` and the attempt's own public evidence from `snapshot.originals` (D3's readers, without `outside-file:`); take the latest floor; `raiseStartAgainNote(anchor.stateDir, …)` when there is one; remove `<anchor state>/module-preparation-state.json`. If the frozen request names a module and `host.modules` is missing, refuse `setup.not_ready` as `:256` does; an attempt whose frozen request names no module (as `first-setup-resolution-inspection.test.ts`'s fixture, `:40`) needs no seat and gets no floor.
- [ ] **Step 4:** Run the new file (PASS, non-zero count), the six stub files, and `pnpm --filter @waitron/server exec vitest run src/first-fiscal-hour-finish.test.ts src/first-setup-unused-pdf.test.ts src/first-setup-recovery-delivery.test.ts src/first-setup-resolution-inspection.test.ts`. Also run `src/first-setup-retired-assignments.test.ts`: its fixture retires without Start again (`:281-302`), but S7h calls `startAgainFirstSetup` at `:497`, through this task's new code (S7g is refused before it, `:469`). Only S8's `:323` change is expected; anything else is a STOP.
- [ ] **Step 5: Prove the check by deletion.** In a scratch commit, remove `...facts.floors` from `hour-preparation.ts:173` and re-run the new file. Written before running: a broken check shows as `setup.attempt_conflict` (the archive check still exists until Task 4c) or a given name, instead of `minute_not_later`. Record the output in the commit message; restore; re-run green.
- [ ] **Step 6:** Commit `git commit -s -m "Start again records the last series name; setup never issues one at or before it (A1042; item S8 part 1)"`.

### Task 2: The note cannot be lowered, emptied, damaged into "no floor", or carried in by a restore

**Files:** `packages/provisioning/src/first-setup-start-again-note.ts` and its test; `apps/server/src/first-setup-entry.test.ts:334-365` (gains two rows); `apps/server/src/first-setup-start-again-note.test.ts`.

- [ ] **Step 1: Failing cases.** Provisioning, one `it.each` row each, all `setup.attempt_invalid`: empty file; `{}`; `"lastName": ""`; an extra key; `floorMs` as a string; `floorMs: 1.5`; `floorMs` before the name epoch; `module: ""`; a symbolic link in place of the file. `first-setup-entry.test.ts:334-365` gains the rows `first-setup-start-again.json` and `first-setup-deleting.json`: a bundle naming either is refused `recovery.bundle_invalid` and `validateDatabaseEntries` refuses a `secrets/` entry naming either. Server: `"two Start again requests at once raise the note once"` (barriers, not sleeps). The write rule (owner, Q3): `"an equal floor writes nothing"` (the file's bytes and modification time unchanged); `"a later floor replaces the note whole"`; `"a write cut before its rename leaves the old note readable"` and `"a write cut after its rename leaves the new one"` (inject through `writeDurableHostJson`'s `io` argument, `durable-host-json.ts:44-49`; `raiseStartAgainNote` takes an optional `io` for tests only).
- [ ] **Step 2:** Read `apps/server/src/restore-stream.ts`. If the bucket-stream restore writes state files by a path that does not reach `validateEntryMetadata`, add a case for it; otherwise put the receipt (`file:line`) in the commit message.
- [ ] **Step 3:** Run the three files; expected FAIL only where Task 1a's store does not refuse yet.
- [ ] **Step 4:** Implement the remaining validation: integers only, `floorMs` at or after the name epoch, `lastName` 1–64 characters, `module` matching `/^[a-z][a-z0-9-]*$/`. The module exports no function that deletes the note.
- [ ] **Step 5:** Run the three files and `pnpm exec vitest run scripts/errors-reachable.test.ts`; PASS.
- [ ] **Step 6:** Commit `git commit -s -m "Refuse a damaged or lowered start-again note; restores never carry one (A1042)"`.

### Task 3a: The summary and the confirmation record (provisioning)

Unit work; nothing calls it yet.

**Files:** Create `packages/provisioning/src/first-setup-start-again-confirmation.ts` and its test; modify `packages/provisioning/src/first-setup-state.ts:137-148` (`FIRST_SETUP_HOST_FILES` gains `first-setup-start-again-confirmations`), `packages/provisioning/src/index.ts`; `apps/server/src/first-setup-entry.test.ts:334-365` gains the row `first-setup-start-again-confirmations/x.json` — a bundle naming it is refused `recovery.bundle_invalid`, and `validateDatabaseEntries` refuses a `secrets/` entry naming it — which is what D3a's "no restore archive or recovery bundle carries one" rests on (round-6 review, L6).

**Interfaces — produces:**
- `type StartAgainSummary` as in D3a.
- `startAgainSummary(state: FirstSetupState, lastName: string | null): StartAgainSummary` — D3a's rule over `[state, ...state.previous]`.
- `writeStartAgainConfirmation(stateDir: string, record: Omit<StartAgainConfirmation, "version">): Promise<string>` — writes `first-setup-start-again-confirmations/<at ms>-<attemptId>.json` with D3a's exact keys through `writeDurableHostJson` (16 KiB), refuses `setup.attempt_conflict` if that file already exists (checked with `lstat` first), and returns its name. Exports no delete.

- [ ] **Step 1: Failing cases:** one `it.each` row per rule of D3a's summary — no events past claiming → `claimed`; `candidates`, `import`, `consumption-intent` → `named`; `activation-started`, `uncertain` → `fiscal-started`; `committed`, `publication`, `complete`, a non-null `result` → `fiscal-finished`; an event found only in a `previous` attempt counts; `lastName` passes through unread. Then: "a confirmation record round-trips with exactly D3a's keys"; "two confirmations for one attempt are two files"; "an existing file of the same name is refused, not overwritten"; "a record over 16 KiB is refused `setup.attempt_invalid` and writes nothing"; `first-setup-host-path.test.ts` (its pin only gains the entry).
- [ ] **Step 2:** Run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-confirmation.test.ts src/first-setup-host-path.test.ts` and `pnpm --filter @waitron/server exec vitest run src/first-setup-entry.test.ts`; expected FAIL (missing module; the new row is not refused).
- [ ] **Step 3:** Implement; run; PASS; also `pnpm exec vitest run scripts/errors-reachable.test.ts`.
- [ ] **Step 4:** Commit `git commit -s -m "The missing-database summary and confirmation record (A1042, owner Q1)"`.

### Task 3a2: A missing database: Start again asks, then proceeds on a recorded confirmation (Q1) — the server

Start again still makes a workspace here; Task 3c makes it delete in place, after the confirmation record.

**Files:**
- `apps/server/src/first-setup-resolution.ts:210-345`: on `inspection.database === "missing"`, allow every status but `complete` (D3a; point 2 for the owner), require `confirmMissingDatabase`, rebuild the summary (`startAgainSummary` with the seat's `lastName`, gathered as Task 1b gathers the floor), compare it with `shown` (`setup.attempt_conflict` on a difference), and write the confirmation record **before raising the note and before deleting the kept picks file** (Task 1b's two steps) — so before every deletion at every commit of this branch, not only once Task 3c reorders the writes; refuse `confirmMissingDatabase` when the database is present. The action's own key list (`:213-220`: `inspectionId`, `revision`, `ownerGeneration`, `owner`, `register`) gains `confirmMissingDatabase` too; without it every confirmed request is refused `setup.attempt_conflict` (round-6 review, L7). `createFirstSetupResolutionActions` (`:52-58`) gains an optional test-only `remove` option, used for the kept picks file's deletion here and passed on to `deleteMarkedAttempt` by Task 3c. A `summary` action beside `startAgainFirstSetup` takes the same request and owner and answers the summary, `setup.not_ready` when the database is present.
- `apps/server/src/setup-first-fiscal-api.ts:813-851`: the route's exact-keys list (`:820-826`) gains `confirmMissingDatabase` (`{ nothingFiledOrSold: true, shown: { reached, lastName } }`, exact keys, `reached` one of D3a's four, `lastName` a string of 1–64 characters or `null`); the new route `POST …/resolution/start-again/summary`, HTTPS only as `:817-819`, owner headers read by `firstFiscalOwner` as `:841-843` does.
- `apps/server/src/first-setup-entry.ts:202-203`: wire the summary action beside `startAgain`.
- Tests: `apps/server/src/first-setup-start-again-note.test.ts`, and `apps/server/src/first-setup-backup-handoff.test.ts:275-285` gains the summary route (item S23); the other existing suites follow in Task 3a3.

- [ ] **Step 1: Failing cases** in `first-setup-start-again-note.test.ts`, each with `venue.db` removed after a fresh password recovery:
  - "a missing database: Start again without the confirmation is refused, and nothing changes" (`setup.not_ready`; the attempt's files byte-for-byte unchanged; no confirmation folder);
  - "a confirmation whose summary differs from the box's own is refused, and nothing is written" (`setup.attempt_conflict`; one row with a different `reached`, one with a different `lastName`);
  - "a confirmed Start again writes the confirmation record with who, when and what the record showed" (administrator from the frozen request, `ownerGeneration`, `database: "missing"`, `at` from the injected clock, `shown` equal to the summary route's answer);
  - "an attempt that finished activation shows it and can be started again on confirmation, and the note holds its name" (an attempt taken through `committed`; summary `{ reached: "fiscal-finished", lastName: M }`; the note's `lastName` is `M`);
  - "the summary route refuses when the database is present", "…without the owner headers" (`setup.owner_required`) and "…over plain HTTP";
  - "a confirmation sent while the database is present is refused";
  - "a `complete` attempt is still refused".
  - "the confirmation record is on disk before the kept picks file is deleted" (fail the deletion through the test-only `remove` option; the record exists, the kept picks file too).
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts`; expected FAIL (Start again proceeds without a confirmation). **Do not change who may Start again beyond D3a to make a case reach its scenario**; a fixture refused for another reason is a STOP — in particular, if a D3 refusal (`modules.json`, `trading.env` and the rest) blocks the `committed` case, stop and report: the owner's example then cannot be met without changing D3's list.
- [ ] **Step 3:** Implement; apply S23; re-run; PASS. Also run `pnpm --filter @waitron/server exec vitest run src/first-setup-backup-handoff.test.ts src/setup-first-backup-api.test.ts` (A731's queued Start again, `:674-…`, unchanged, or a STOP).
- [ ] **Step 4: Prove the confirmation check by deletion.** In a scratch commit, remove the requirement for `confirmMissingDatabase`. Written before running: the "without the confirmation" case then shows Start again succeeding. Record the output; restore; re-run green.
- [ ] **Step 5:** Commit `git commit -s -m "A missing database: Start again asks, and records the confirmation first (A1042, owner Q1)"`. Not pushed until Task 3a3.

### Task 3a3: The existing missing-database suites send the confirmation

**Files (tests only):** `apps/server/src/first-setup-unused-pdf.test.ts` (S5), `first-fiscal-hour-finish.test.ts` (S10), `first-fiscal-hour.e2e.test.ts` (S12), `first-setup-resolution.route.test.ts` (S13), `first-setup-resolution-inspection.test.ts` (S14's `:176-222`) — each item's "New, Task 3a3" part only.

- [ ] **Step 1:** Rewrite those parts exactly as their items say; anything else is a STOP.
- [ ] **Step 2:** Check free memory (`memory_pressure | grep free`; S12 starts the server twice in each of six rows), then run `pnpm --filter @waitron/server exec vitest run src/first-setup-unused-pdf.test.ts src/first-fiscal-hour-finish.test.ts src/first-fiscal-hour.e2e.test.ts src/first-setup-resolution.route.test.ts src/first-setup-resolution-inspection.test.ts` whole. `first-setup-resolution.route.test.ts`'s malformed-request case (`:212`, a Start again with no owner on a missing database, expecting 503 `setup.not_ready`) is not on the list: if Task 3a2's order of checks changes its answer, that is a STOP.
- [ ] **Step 3:** Commit `git commit -s -m "Missing-database suites send the confirmation (A1042; items S5, S10, S12, S13, S14 part)"`, writing S10's and S14's recorded outcomes into the message; push 3a2 and 3a3 together.

### Task 3b: The deletion marker, and finishing an interrupted deletion safely

Unit work in provisioning; nothing calls it yet.

**Files:** `packages/provisioning/src/first-setup-start-again-note.ts` (marker read, write and removal; `finishStartAgainDeletion`; `assertNoStartAgainDeletion`), its test.

**Interfaces — produces:**
- `writeStartAgainMarker(roots, marker: StartAgainMarker): Promise<void>` and `readStartAgainMarker(venueDir): Promise<StartAgainMarker | null>`, the marker as in D3. `markerSize(marker): number` lets the caller refuse `setup.not_ready` before writing anything over 1 MiB.
- `deleteMarkedAttempt(roots, marker, remove?: (path: string, kind: "file" | "folder") => Promise<void>): Promise<void>` — D3's order and side-file rules: record `step-*` subfolders before their record folder, every entry of a listed folder including dot-names, folders by `rmdir`. `remove` is replaced only by tests, to inject a failure.
- `finishStartAgainDeletion(roots: { stateDir: string; venueDir: string }): Promise<void>` — canonicalises the folders, then takes `lockVenueDatabase` and makes D3's checks, then `deleteMarkedAttempt`, then removes the marker; otherwise `setup.start_again_incomplete`, nothing deleted.
- `assertNoStartAgainDeletion(venueDir: string): Promise<void>` — refuses `setup.start_again_incomplete` while a marker exists.

- [ ] **Step 1: Failing cases**, on real files in a temporary folder:
  - "no marker does nothing";
  - "a marked deletion cut after the marker, after the first, middle and last deletion is finished" (inject through `remove`);
  - "an attempt that never chose a name is finished from the marker alone";
  - "a record folder with a `step-000003/` subfolder is finished, subfolder first";
  - "a leftover `.first-setup-<uuid>.tmp` in a listed folder is removed with it";
  - "a side file recreated by a read after its main file was deleted is removed", and "a zero-length `-wal` is accepted";
  - "folders given through a symbolic link are canonicalised before they are compared with the marker";
  - refusals, each with nothing deleted:
    - a pending deletion beside `trading.env`;
    - beside a `venue.db` whose bytes differ from the marker;
    - beside a newly placed `venue.db` the marker does not name;
    - **a row written into `venue.db-wal` after the cut** (the main file's bytes unchanged);
    - a marker naming other folders;
    - a file newly added inside `first-fiscal-documents/` (the `rmdir` fails);
  - "a marker over 1 MiB is refused `setup.not_ready` before anything is written";
  - "a marker that names the note, or anything in the confirmation folder, is refused by the writer and by the finisher, and nothing is deleted" (`setup.start_again_incomplete`; the note's bytes unchanged).
- [ ] **Step 2:** Run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-note.test.ts`; expected FAIL (missing exports).
- [ ] **Step 3:** Implement; run; PASS.
- [ ] **Step 4:** Commit `git commit -s -m "A deletion marker that names exactly what Start again deletes, and a safe finisher (A1042)"`.

### Task 3c: Start again deletes the attempt in place under the marker

**Files:** `apps/server/src/first-setup-resolution.ts:210-345` (D3's refusals and order of writes; replace `:300-342`; the kept picks file's deletion from Task 1b moves into the marked list), `apps/server/src/setup-first-fiscal-api.ts:813-851` (W1, and the answer and restart for a deletion that throws) and its error map (`:25-35`), which gains `"setup.start_again_incomplete": 409`; tests: `apps/server/src/first-setup-start-again-note.test.ts`. The server-level failure injections below go through `createFirstSetupResolutionActions`'s test-only `remove` option (Task 3a2), which this task passes to `deleteMarkedAttempt`, as `raiseStartAgainNote` takes `io`; route-level cases mount `mountFirstSetupResolutionApi` with actions built that way (round-6 review, L8).

- [ ] **Step 1:** Re-run the first sweep narrowed to `first-setup-resolution|setup-first-fiscal-api|start-again`, and confirm every hit is an item for Task 3e.
- [ ] **Step 2: Failing cases**, fixtures opening the venue folder with `openVenueDatabase` so `node.db` exists:
  - "start again leaves no workspace and none of the attempt's files, node.db included";
  - "start again is refused when node.db holds a table" (`create table t(x)` in `node.db`);
  - "start again with no node.db does not create one and succeeds";
  - one row per name on D3's refusal list, including `.venue.db-litestream/` (folders unchanged, no marker, no note change);
  - "start again is refused while a deletion marker exists" (`setup.start_again_incomplete`; the first marker unchanged);
  - "an attempt whose owner recovered the password twice can start again, and the next start finds nothing left";
  - "a deletion that throws part-way answers 409 `setup.start_again_incomplete` and requests a restart, and the restart finishes it" (the status read through the route);
  - "the start-again route is not served by ordinary setup";
  - "a repair-page inspection read between deletions, then a cut, still lets the next start finish" (the GET route's inspection, then `finishStartAgainDeletion`);
  - "on a missing database, the confirmation record is on disk before the first deletion" (fail the first deletion through `remove`; the confirmation record and the note are there, the marker is there, nothing is deleted);
  - "Start again leaves the note and the confirmation folder in place" (their bytes, before and after);
  - "a backup recovery prepared and given up refuses Start again, and nothing is written or deleted" (a journal made by A731's real `prepare` and a name pick, then `close`; afterwards every file A731 wrote — item 9's list, `target/venue/venue.lock` included — has its bytes, and the attempt's files are unchanged; no marker, no confirmation record, no note change);
  - "a recovery at `placement-started` refuses Start again, and nothing is deleted".
- [ ] **Step 3:** Run `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts`; expected FAIL (a workspace is still made).
- [ ] **Step 4: Implement.** Keep `:211-299` (request check, status check, proof, authority) apart from D3's added refusals. Put those refusals after the checks this task keeps and before the first write (the confirmation record), so a request today's checks refuse keeps its code: S7g (`first-setup-retired-assignments.test.ts:457-476`, whose box sits in the old fixture's workspace until Task 4b2) stays `setup.not_ready` until Task 4c changes it. Invalidate the host's caches as `:339-341` do.
- [ ] **Step 5:** Run the file; PASS. The suites of Tasks 3e, 3e2 and 3e3 are expected red until they land; nothing else may fail.
- [ ] **Step 6:** Commit `git commit -s -m "Start again deletes the unused attempt in place under a marker (A1042)"`.

### Task 3d: Every other write and entry point refuses while a deletion is unfinished — provisioning and the server

**Files:**
- `packages/provisioning/src/first-setup-state.ts`: `persist` (`:555-560`), `claim`, and `assertVenueFirstSetupAllowed` (`:502-506`) call `assertNoStartAgainDeletion`.
- `packages/provisioning/src/first-setup-resolution.ts`: `prepare` and `apply` call it.
- `apps/server/src/boot.ts` `assertOtherAllowed` (`:1123` at 40eed0cde) and `apps/server/src/recovery-entry.ts:56`.
- A731's repair open and resume (`apps/server/src/first-setup-backup-recovery.ts:556-…` `open`, `:758-…` `resume`; D3).
- The error maps of `apps/server/src/setup-api.ts:640-646` and `apps/server/src/setup-first-backup-api.ts:16-23` gain `"setup.start_again_incomplete": 409` beside `"setup.attempt_uncertain": 409` (`:645`, `:22`). On 2026-10-25 `/usr/bin/grep -rn '"setup.attempt_uncertain": 409' apps/server/src` printed these two and `setup-first-fiscal-api.ts:33` (Task 3c's); a new hit gets the code too.
- Tests: `apps/server/src/first-setup-start-again-note.test.ts`, `packages/provisioning/src/first-setup-start-again-note.test.ts`.

- [ ] **Step 1: Failing cases:**
  - "while a deletion is pending, a claim, abandon, ownership recovery, a record-store prepare or apply, restore placement, restore staging, the restore command, reset, adopt, the recovery entry, A731's repair open and A731's resume are refused" — one row each, `setup.start_again_incomplete`, and the marked files unchanged;
  - "A731's repair open while a deletion is pending answers 409" (`POST …/backup/open`, the status read through the route).
- [ ] **Step 2:** Run the two files; expected FAIL.
- [ ] **Step 3:** Implement. Read `apps/server/src/rejoin-command.ts:89-136`; if a rejoin can remove or overwrite the marker, add the check there with a case.
- [ ] **Step 4:** Run the two files and `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-state.test.ts src/first-setup-resolution.test.ts src/first-setup-resolution.durability.test.ts src/first-setup-resolution.integrity.test.ts`. Only assertion-list items may change; these four suites are not on it.
- [ ] **Step 5:** Commit `git commit -s -m "Every first-setup write and placing path refuses while Start again is unfinished (A1042)"`.

### Task 3d2: The setup app's words for the two new codes

**Files:** `apps/setup/src/setup-app.ts:196-201` (`FIRST_SETUP_ERROR_MESSAGES` gains `setup.start_again_incomplete` and `setup.workspace_unsupported`; read at `:751,1162,1452`), `apps/setup/src/i18n/strings/shell.ts` (D5's setup-app wording, English and Spanish); test `apps/setup/src/setup-app-resolution.test.ts`.

- [ ] **Step 1: Failing cases** in `setup-app-resolution.test.ts`, reading the expected text from the strings file in both languages: the repair page shows each new code's text, and so does one restore or reset screen receiving `setup.start_again_incomplete`.
- [ ] **Step 2:** Check free memory, then `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement; run; PASS; `pnpm exec vitest run scripts/english-only.test.ts`.
- [ ] **Step 4:** Commit `git commit -s -m "Setup app: words for an unfinished Start again and an older first setup (A1042)"`.

### Task 3e: The existing Start again suites follow the deletion — the action-level suites

**Files (tests and stubs only):** `apps/server/src/first-setup-unused-pdf.test.ts` (S1, S3, S4, S5's Task 3e part, S6), `first-fiscal-hour-finish.test.ts` (W1, S8 part 2, S9, S10's Task 3e part), `first-setup-resolution-inspection.test.ts` (S14, including its `:176-222` Task 3e part), `first-setup-recovery-delivery.test.ts` (S15), `apps/setup/test/missing-database-browser.ts:61-65` (W1).

- [ ] **Step 1:** Change each case exactly as its item says; anything else is a STOP. Write each value an item says is "recorded" into the commit message.
- [ ] **Step 2:** Run each file with `pnpm --filter <package> exec vitest run <file>`.
- [ ] **Step 3:** Commit `git commit -s -m "Start again suites follow the deletion in place (A1042; items W1, S1, S3-S6, S8 part 2, S9, S10, S14, S15)"`.

### Task 3e2: The existing Start again suites follow the deletion — the HTTPS suites

**Files (tests only):** `apps/server/src/first-fiscal-hour.e2e.test.ts` (S12's Task 3e part), `first-setup-resolution.route.test.ts` (S13's Task 3e part).

- [ ] **Step 1:** Change each case exactly as its item says; anything else is a STOP.
- [ ] **Step 2:** Check free memory (`memory_pressure | grep free`; S12 starts the server twice per row), then run both files whole.
- [ ] **Step 3:** Commit `git commit -s -m "HTTPS Start again suites follow the deletion in place (A1042; items S12, S13)"`. Not pushed until Task 3e3.

### Task 3e3: The suites that needed Start again to make a workspace

From Task 3c on, Start again no longer renames `first-setup-workspace.json` or `first-setup-selection.json` and returns no workspace binding, so these six items' cases fail; each item is applied here, exactly as approved, instead of in its old task (round-6 review, M1: this changes when an item is done, not its text).

**Files (tests only):**
- `apps/server/src/first-setup-unused-pdf.test.ts` — S7 (`:325-355` and `:357-…`, which inject a rename failure and expect `setup.attempt_uncertain` and `interrupted === true`): deleted. S2 (`:120-165`, which builds its next host from the binding `f.start()` returns, `:129-130`): applied as its item says, on a new attempt in the same folders.
- `apps/server/src/first-fiscal-hour-finish.test.ts` — S11 (`:712-756`, the same injection): deleted.
- `apps/server/src/first-setup-empty-selection.route.test.ts` — S19 (the whole suite; it interrupts selection with the same injection, `:118-145`): deleted. Its HTTPS refusal (`:271`) is already pinned for the Start again route by `first-setup-resolution.route.test.ts:254-…` (its `start-again` row: plain HTTP with `X-Forwarded-Proto: https` answers 404 and leaves `first-setup.json` unchanged; read 2026-10-25), so nothing needs to move.
- `apps/server/src/first-setup-retirement-reads.test.ts` — S18 (counts archive opens around three Start agains): deleted.
- `apps/server/src/first-setup-retired-assignments.test.ts` — S7h (`:478-507`, which asserts `binding.selectionGeneration`, `anchorStateDir` and `readFirstSetupRetirements(binding)`, and whose box sits in the fixture's workspace, which Task 3c's Start again refuses as an older layout). The fixture gains an option that abandons the earlier attempt through `startAgainFirstSetup` on the missing-database path that Task 4b2 describes (and then makes the fixture's only path), instead of `records.prepare` and `selectFirstSetupWorkspace`; S7h uses it and then follows its item. Every other case keeps the old fixture until Task 4b2; S7g keeps `setup.not_ready` (Task 3c Step 4).

- [ ] **Step 1:** Apply the six items exactly as they say; anything else is a STOP.
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/first-setup-unused-pdf.test.ts src/first-fiscal-hour-finish.test.ts src/first-setup-retired-assignments.test.ts src/first-setup-resolution.route.test.ts` whole.
- [ ] **Step 3:** Commit `git commit -s -m "Suites that needed a workspace from Start again follow the deletion (A1042; items S2, S7, S11, S18, S19, S7h)"`, then push 3c–3e3 together. Deleting S7, S11 and S19 leaves `inspectWorkspaceSelection` and `resumeWorkspaceSelection` (`apps/server/src/first-setup-resolution.ts:61-209`) to S20 alone until Task 5d deletes them: read the server's coverage on this push, and if it falls under the bar, bring Task 5d's deletion forward into this task rather than adding tests for code about to go.

### Task 4a: Remove the retirement readers — module contract and provisioning

**Files:** `packages/module/src/operation-preparation.ts:48-54` (delete `readRetiredSetup`), `packages/provisioning/src/first-setup-runtime.ts:79,85-91,115,212,278`, `packages/provisioning/src/first-setup-preparation.ts:28,85-101,109` (keep the `state.previous` loop, `:102-121`), `packages/provisioning/src/first-setup-state.ts:650-668` (claim keeps the id check against `previous`), `packages/provisioning/src/first-setup-workspace.ts:511-576` (delete the three readers), `packages/provisioning/src/index.ts:69-71`; tests P2, P3, P4.

- [ ] **Step 1:** Delete; `pnpm --filter @waitron/provisioning typecheck`, `pnpm --filter @waitron/module typecheck` and `pnpm --filter @waitron/fiscal-verifactu typecheck` find the callers. The fiscal ones — `allocation-configuration.ts:48,58` and F1's host literals — are Task 4d's and stay red until it lands (push group 4a–4d).
- [ ] **Step 2:** Apply P2–P4; run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-preparation.test.ts src/first-setup-command.test.ts src/first-setup-state.test.ts src/first-setup-runtime.test.ts src/cli-first-setup.test.ts`.
- [ ] **Step 3:** Commit `git commit -s -m "Remove the retired-archive readers from the module contract and provisioning (A1042; items P2-P4)"`. Not pushed until Task 4d.

### Task 4b1: Remove the retirement readers from the server, with A731's archive callers

**Files:** `apps/server/src/module-operation-host.ts:15,52-78,82`, `apps/server/src/first-setup-resolution.ts:242-270` (the inherited-register and per-retirement loops go; the current attempt's proof stays), A731's archive callers (Task 0 results, Step 2): `apps/server/src/first-setup-backup-history.ts:11,58-60,103-109` (no `retired` list; the roots are the box's own folders and the folders given) and `apps/server/src/first-setup-backup-setups.ts:9,22-25,88` (the `retired` argument goes); `apps/server/src/first-setup-backup-history.test.ts` (S25, S26 — only once the owner approves them, "Task 0 findings that need the owner").

- [ ] **Step 1:** Delete the readers; `pnpm --filter @waitron/server typecheck` passes.
- [ ] **Step 2:** Apply S25 and S26: S26's rebuilt case passes canonical roots (`realpath`), and its new control case (the real module returns one setup) goes beside it. Run `pnpm --filter @waitron/server exec vitest run src/first-setup-backup-history.test.ts src/first-setup-backup-recovery-opening.test.ts src/first-setup-backup-recovery-preparation.test.ts`; only S25 and S26 may change. `first-setup-retired-assignments.test.ts` and S2's case are red from Task 4a until Tasks 4b2 and 4c, and are not run here.
- [ ] **Step 3:** Commit `git commit -s -m "Server: retired-archive readers removed; A731's history reads no archives (A1042; items S25, S26)"`. Not pushed until Task 4d.

### Task 4b2: Rebuild the retired-name fixture on Start again (S7a–S7f)

**Files:** `apps/server/src/first-setup-retired-assignments.test.ts` (the fixture, `:281-302`, and S7a–S7f).

- [ ] **Step 1:** Re-run S7e's grep; a new non-test writer is a STOP.
- [ ] **Step 2:** Rebuild the fixture so each case abandons its earlier attempt through `startAgainFirstSetup` on the **missing-database path** — the option Task 3e3 added for S7h, now the fixture's only path. The fixture never places a `venue.db` in the attempt's venue folder (it records `venue/venue.db` with `bytes: null`, `:213-224`, and retires with `database: "missing"`, `:301`), so each rebuilt case recovers the password as S7h does (`:483-489` at a642c0505), reads the `summary` action's answer (Task 3a2), and starts again with `owner` and `confirmMissingDatabase` carrying that summary, the database left missing. Not the empty-database path of Task 1b's test: there an attempt that chose and imported a name can only qualify as an unused assignment, and `firstSetupUnusedAssignment` refuses any snapshot holding `state/module-operation-public.json` (`apps/server/src/first-setup-unused-assignment.ts:43-62`, an allowed list without it), while `noOtherHistory` fails on that file too (`apps/server/src/first-setup-resolution.ts:236-241`) — so S7i, S7j, S7k and S7l would be refused `setup.not_ready` (round-6 review, M3). **Do not loosen those rules to reach a scenario** (Global constraints). No case archives a database before its fixture's Start again; S7g (`:459`) and S7h (`:480`) archive one after it, as today. S7a–S7f's assertions do not change: each case gains requests, as S12 gained one, and no assertion. Cases S7g and S7i–S7n are marked `it.skip` with their item name for the length of this task only; Task 4c removes every skip. Apply S7a–S7f.
- [ ] **Step 3:** Run `pnpm --filter @waitron/server exec vitest run src/first-setup-retired-assignments.test.ts`; only S7a–S7f may change, and S7h passes as Task 3e3 left it.
- [ ] **Step 4:** Commit `git commit -s -m "Retired-name cases rebuilt on Start again (A1042; items S7a-S7f)"`. Not pushed until Task 4d.

### Task 4c: The remaining retired-name cases (S7g, S7i–S7n) and the second deletion proof

**Files:** `apps/server/src/first-setup-retired-assignments.test.ts` (S7g and S7i–S7n, every skip from 4b2 removed). S7h and S2 were applied in Task 3e3.

- [ ] **Step 1:** Apply the items; run `pnpm --filter @waitron/server exec vitest run src/first-setup-retired-assignments.test.ts src/first-setup-unused-pdf.test.ts src/first-setup-start-again-note.test.ts`; `/usr/bin/grep -n "it.skip" apps/server/src/first-setup-retired-assignments.test.ts` prints nothing.
- [ ] **Step 2: Re-prove Task 1b's check by deletion** — the code around it changed shape (`CLAUDE.md` §4). Written before running: with the archive check gone, a broken check shows as a name at or before `M` being given. Record the output; restore; re-run green.
- [ ] **Step 3:** Commit `git commit -s -m "The note is the only memory of an abandoned name (A1042; items S7g, S7i-S7n)"`. Not pushed until Task 4d.

### Task 4d: Remove the retired block of the historical dispatcher

**Files:** `packages/fiscal-verifactu/src/allocation-configuration.ts:58-119`; tests F1.

- [ ] **Step 1:** Delete the block; `pnpm --filter @waitron/fiscal-verifactu typecheck` and `pnpm --filter @waitron/composition typecheck`.
- [ ] **Step 2:** Apply F1; run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declared-paper-standby.test.ts src/initial-cloud-setup.test.ts src/declared-paper-consumers.test.ts src/allocation-configuration.test.ts` and `pnpm --filter @waitron/composition exec vitest run src/allocation-configuration.test.ts`.
- [ ] **Step 3:** Commit `git commit -s -m "Historical dispatcher: drop the retired-archive block (A1042; item F1)"`, then push 4a–4d together; `pnpm --filter @waitron/fiscal-verifactu typecheck` passes here (4a's red there ends).

### Task 5a: Provisioning forgets workspaces; old archives are refused

**Files:** `packages/provisioning/src/first-setup-workspace.ts` (keep only `assertNoLegacyFirstSetupWorkspace`), `first-setup-state.ts` (claim, update, `inspectFirstSetupMarker` and `assertVenueFirstSetupAllowed` call it in place of `assertFirstSetupVenueTarget`; the old names stay in `FIRST_SETUP_HOST_FILES`), `first-setup-owner.ts`, `first-setup-resolution-inspection.ts`, `module-preparation-state.ts`, `first-setup-finish-audit.ts` (each as the "Callers" table below says), `box-folders.ts` (drop the workspace branch), `index.ts`, and A731's `first-setup-backup-workspace.ts:11,279-282,680-681` (its source is the anchor itself, and its boot check loses the V1 branch); tests P1, P5, P6, P7, P8 (P8 only once the owner approves it, "Task 0 findings that need the owner"). The record store (`first-setup-resolution.ts`) is not changed (D4).

**Interfaces — produces:** `assertNoLegacyFirstSetupWorkspace(roots: { stateDir: string; venueDir: string }): Promise<void>` — refuses `setup.workspace_unsupported` only when one of D4's names is present, or the venue folder sits inside `first-setup-workspaces/<id>/` (kept from `first-setup-workspace.ts:461,492`); any other failure (a symbolic-link or unreadable folder) keeps today's `setup.attempt_uncertain` (`:471-473`).

**Callers** of every name this task removes — `inspectFirstSetupWorkspaceSelection`, `selectFirstSetupWorkspace`, `resolveFirstSetupWorkspace`, `assertFirstSetupVenueTarget`, `assertFirstSetupBootTarget`, `firstSetupAnchorFor` and the type `FirstSetupBootTarget` with its `binding` (the three retirement readers went in Tasks 4a and 4b1). Found by `git grep -n -w <name> -- 'apps/*.ts' 'packages/*.ts' ':!*.test.ts' ':!*/test/*'` for each name, at a642c0505. A server file that imports a name provisioning no longer exports still loads, and calling it throws `TypeError: … is not a function` (round-6 reviewer's probe): left alone, `resolveLegacyFirstSetupEntry` would catch that throw (`apps/server/src/first-setup-entry.ts:98-106`) and serve the repair app on every start, and Start again would throw at `first-setup-resolution.ts:222`. So every caller on a path a later task's tests reach is rewritten in this push group before those tests run (round-6 review, H1):

| Caller | Rewritten as | Task |
| --- | --- | --- |
| `packages/provisioning/src/first-setup-state.ts:2,492,503,638,699` (`assertFirstSetupVenueTarget` in claim, update, `inspectFirstSetupMarker`, `assertVenueFirstSetupAllowed`) | `assertNoLegacyFirstSetupWorkspace` on the attempt's folders | 5a |
| `first-setup-owner.ts:27,173,238,361` (`assertFirstSetupBootTarget(state)` in `authorize`, the rebind and `status`) | `assertNoLegacyFirstSetupWorkspace(state)` | 5a |
| `first-setup-resolution-inspection.ts:12,251-262` (`withVenueExclusion`: the anchor, two locks, two target checks) | one `lockVenueDatabase(options.venueDir)`, then `assertNoLegacyFirstSetupWorkspace(options)`, then the body | 5a |
| `module-preparation-state.ts:6,78,102`, `first-setup-finish-audit.ts:5,22` (`firstSetupAnchorFor`) | the folders given | 5a |
| A731's `first-setup-backup-workspace.ts:11,280,681` | its source is the folders given; its boot check loses the V1 branch | 5a |
| `box-folders.ts` (Task 0b) | drops its workspace branch | 5a |
| `apps/server/src/first-setup-entry.ts:10-14,94,98-142` (`resolveLegacyFirstSetupEntry` and its `run`) | the target is the canonical folders it was given, with no `binding` (`:94`'s fallback returns the folders as given); `resolveFirstSetupWorkspace(roots)` at `:100` becomes `assertNoLegacyFirstSetupWorkspace(roots)` inside the same `try`, whose `catch` keeps serving the repair app until Task 5c1 puts D5's refusal ahead of it; `run` returns `body(false)` when nothing is claimed, and otherwise takes **one** lock, `lockVenueDatabase(roots.venueDir)` — no anchor lock and no second target lock — re-runs `assertNoLegacyFirstSetupWorkspace(roots)` and `needsResolution` (`setup.attempt_uncertain` if unresolved), runs `body(true)` and releases the lock; the re-read of the selection (`:138-139`) goes | 5a2 |
| `first-setup-resolution.ts:9,222` (inside Start again) | `assertNoLegacyFirstSetupWorkspace(options)` | 5a2 |
| `boot.ts:9,873` (`bootServer`) | `assertNoLegacyFirstSetupWorkspace(...)` — what makes raw `bootServer` throw `setup.workspace_unsupported` (D5) and S16 hold | 5a2 |
| `first-setup-launch.ts:98-101` (`admission.roots.binding === null &&`) | the clause goes; the folder comparison stays | 5a2 |
| `node-entry.ts:416` (`admission.roots.binding === null && !moved`) | `!moved`; Task 5e then removes `moved` | 5a2 |
| `archive-entries.ts:11,42`, `recovery-document-evidence.ts:3,16`, A731's `first-setup-backup-history.ts:9,57`, `first-setup-backup-entry.ts:9,35,90-91`, `first-setup-backup-recovery.ts:18,20,170,387-388` | the folders given, or `boxFolders` (moved here from Task 5e: `readRecoveryDocumentEvidence` runs in `bootServer`, `boot.ts:294`, so Task 5d's suites reach it) | 5a3 |
| `first-setup-resolution.ts:8,13,61-209` (`inspectWorkspaceSelection`, `resumeWorkspaceSelection`) and their routes | deleted; until then only S20 calls them (S7, S11 and S19 went in Task 3e3) | 5d |
| `first-setup-resolution.ts:10,11,300-301,338` | already gone with Task 3c's replacement of `:300-342` | 3c |

Test files that still import a removed name after Task 5a3, each changed only by its own task and not run before it: `apps/server/src/first-setup-backup-entry.v1.test.ts` (S24, Task 5c1), `first-setup-resolution.boot.test.ts` (S17, Task 5c2), `first-setup-selection.route.test.ts` (S20, Task 5d). The server's type check is red from this task until Task 5d.

- [ ] **Step 1: Failing cases** (replacing P1): one row per D4 name in each folder → `setup.workspace_unsupported`; an empty file counts; a venue folder inside `first-setup-workspaces/<id>/` → `setup.workspace_unsupported`; a folder that is a symbolic link → `setup.attempt_uncertain`; a box with none passes.
- [ ] **Step 2:** Run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-workspace.test.ts`; expected FAIL.
- [ ] **Step 3:** Re-run the "Callers" grep at the current head, and the same names over test files (`git grep -l -w -E '<names>' -- '*.test.ts' 'apps/*/test/*.ts'`). Expected test hits only: the three files listed above, S21's `hour-backup-state.test.ts` and `recovery-document-evidence.test.ts` (Task 5a3), this task's own P1, P7 and P8, and A1's `apps/setup/src/setup-app-workspace-selection.test.ts` and `apps/setup/test/workspace-selection-browser.ts`, which name the setup client's method of the same name (Task 5f). A non-test caller not in the table, or any other test hit, is a STOP.
- [ ] **Step 4:** Implement and delete; apply P5–P8; run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-backup-workspace.test.ts src/first-setup-backup-workspace.entry.test.ts src/first-setup-backup-workspace.durability.test.ts src/first-setup-workspace.test.ts src/first-setup-state.test.ts src/first-setup-owner.test.ts src/module-preparation-state.test.ts src/cli-first-setup.test.ts src/box-folders.test.ts src/first-setup-resolution-inspection.test.ts`.
- [ ] **Step 5:** Commit (no push until 5e) `git commit -s -m "Provisioning: no first-setup workspaces; a pre-A1042 archive is refused (A1042; items P1, P5-P8)"`.

### Task 5a2: The server's callers of the removed workspace functions

**Files:** the rows of Task 5a's "Callers" table marked 5a2 (`apps/server/src/first-setup-entry.ts`, `first-setup-resolution.ts:9,222`, `boot.ts:9,873`, `first-setup-launch.ts:98-101`, `node-entry.ts:416`); the three error maps of the Global constraints (`setup-first-fiscal-api.ts:25-35`, `setup-api.ts:640-646`, `setup-first-backup-api.ts:16-23`) gain `"setup.workspace_unsupported": 409` (round-6 review, L3; Task 5a is provisioning-only, so the server's maps take it here); tests: S16 (`apps/server/src/first-setup-workspace.test.ts`).

- [ ] **Step 1: Failing cases:** apply S16 (its three cases now expect `setup.workspace_unsupported`); add one route case: a first-setup request on a box holding `first-setup-selection.json` answers 409 `setup.workspace_unsupported`. Run `pnpm --filter @waitron/server exec vitest run src/first-setup-workspace.test.ts`; expected FAIL (raw boot still calls a removed name).
- [ ] **Step 2:** Rewrite each 5a2 row as the table says; add the map entries.
- [ ] **Step 3:** Run `pnpm --filter @waitron/server exec vitest run src/first-setup-workspace.test.ts src/first-setup-entry.test.ts src/node-entry.test.ts src/connection-bootstrap.entry.test.ts src/first-setup-backup.boot.test.ts src/first-setup-resolution.route.test.ts src/first-setup-start-again-note.test.ts`; only S16 may change.
- [ ] **Step 4:** Commit (no push until 5e) `git commit -s -m "Server: the entry, boot and Start again check for an older first setup, not a workspace (A1042; item S16)"`.

### Task 5a3: The anchor readers go

**Files:** the rows of Task 5a's "Callers" table marked 5a3: `apps/server/src/archive-entries.ts:11,37-42`, `apps/server/src/recovery-document-evidence.ts:3,16` (the canonical folders it is given), and A731's anchor callers `apps/server/src/first-setup-backup-history.ts:9,57`, `first-setup-backup-entry.ts:9,35,90-91` (the anchor lookup and its recursion go), `first-setup-backup-recovery.ts:18,20,170,387-388` (the folders given, or `boxFolders`); tests S21.

- [ ] **Step 1:** Rewrite; apply S21.
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/hour-backup-state.test.ts src/recovery-document-evidence.test.ts src/archive-read-budget.test.ts src/first-setup-recovery-delivery.test.ts src/first-setup-backup-recovery.test.ts src/first-setup-backup-entry.test.ts src/first-setup-backup-history.test.ts src/first-setup-backup-recovery-opening.test.ts src/first-setup-backup-recovery-preparation.test.ts`; only S21 may change (A731's suites are expected unchanged — Task 0 results, Step 5).
- [ ] **Step 3:** Commit (no push until 5e) `git commit -s -m "Server: no anchor lookups (A1042; item S21)"`.

### Task 5b: The recovery page's text for the two refusals

**Files:**
- `apps/server/src/recovery-surface.ts`:
  - `:251-457`: D5's two `OPERATOR_TEXT` rows;
  - `RecoveryDeps` gains `refusedAtStart?: true`;
  - `PAGE_TEXT` (`:165-195`) gains D5's status line in both languages, chosen at `:533-534` in place of the counted or uncounted line.
- `apps/server/src/recovery-state.ts:152`: `refusedAtStart(current: RecoveryState, code: ErrorCode, at: Date): RecoveryState` beside `fullDiskAtStart`. It is served, never written.
- Tests: `apps/server/src/recovery-surface.test.ts`, `apps/server/src/recovery-state.test.ts`.

- [ ] **Step 1: Failing cases:** each code renders its title and action in both languages; a page served with `refusedAtStart: true` shows D5's status line in both languages and never contains "disk" or "disco"; `refusedAtStart` sets `lastErrorCode` and the level and touches nothing on disk.
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/recovery-state.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement. Run `src/recovery-surface.test.ts` **whole**: "never suggests wiping anything, in either language" (`:386-394`) must pass unedited. Render the page's HTML to a file and open it with the workspace's Playwright Chromium in both languages, light and dark, at phone width (`CLAUDE.md` §4).
- [ ] **Step 4:** Commit `git commit -s -m "Recovery page: text for an old archive and an unfinishable Start again (A1042)"`.

### Task 5c1: The start refuses an old archive or an unfinishable deletion

**Files:**
- `apps/server/src/first-setup-entry.ts:50-78` (40eed0cde): D5's checks at the top of `resolveFirstSetupEntry`, before A731's backup entry (`:56`), after canonicalising there, in their own `try`, returning `{ kind: "refused", code, roots }` (D5).
- `apps/server/src/boot.ts:843-873` (`bootServer`): beside `:873`, which Task 5a2 made `assertNoLegacyFirstSetupWorkspace`, an unfinished deletion throws `setup.start_again_incomplete` too (D5: raw `bootServer` throws the code).
- Tests: `apps/server/src/first-setup-entry.test.ts`, `apps/server/src/first-setup-workspace.test.ts` (one added case), S24 (`apps/server/src/first-setup-backup-entry.v1.test.ts`).

- [ ] **Step 1: Failing cases** in `first-setup-entry.test.ts`, through `resolveFirstSetupEntry`: "a box holding a pre-A1042 archive is refused `setup.workspace_unsupported` before A731's entry runs"; "an interrupted Start again is finished and setup is served"; "an unfinishable deletion is refused `setup.start_again_incomplete` and nothing is deleted"; "folders reached through a symbolic link still finish an interrupted Start again". In `first-setup-workspace.test.ts`: "raw boot refuses an unfinishable deletion with `setup.start_again_incomplete`". Run `pnpm --filter @waitron/server exec vitest run src/first-setup-entry.test.ts src/first-setup-workspace.test.ts`; expected FAIL.
- [ ] **Step 2:** Implement; apply S24; run the two files plus `src/first-setup-backup-entry.v1.test.ts src/first-setup-backup-entry.test.ts`. The admission consumers in `node-entry.ts` and `first-setup-launch.ts` handle the new kind only from Task 5c2, so do not run them on a refusing box here.
- [ ] **Step 3:** Commit (no push until 5e) `git commit -s -m "Start: refuse an old archive or an unfinishable Start again before anything else is decided (A1042; item S24)"`.

### Task 5c2: The start serves the recovery page for those refusals

**Files:**
- `apps/server/src/node-entry.ts`:
  - after `:349` (`needsConnectionBootstrap`, at 91aa8dfe0), before the resolution branch, with the full-disk branch at `:379` taking precedence;
  - the `server.boot_started` and `server.boot_failed` pair through `pageLog` (`:213-220`);
  - `recoveryApp` with `refusedAtStart(...)` and `refusedAtStart: true`;
  - the admission consumer at `:399-417`.
- `apps/server/src/first-setup-launch.ts:71-113` (its admission consumer `:96-112`): the same page through `listen`, with D5's `state`, `logDir` and `onRetry`.
- Tests: S17 (`apps/server/src/first-setup-resolution.boot.test.ts`), `apps/server/src/node-entry.test.ts`.

- [ ] **Step 1: Failing cases** in `first-setup-resolution.boot.test.ts`, through `runEntry` and `startServerOrFirstSetupResolution` with real listeners (`freePorts(n)` once per case):
  - "a box holding a pre-A1042 archive serves the recovery page naming it, in every entry mode" — fetch the page and assert the English and Spanish title, action and D5's status line;
  - "the start finishes an interrupted Start again before serving setup";
  - "an unfinishable deletion serves the recovery page naming it, and Try again exits";
  - "a refused start after an earlier failed start shows the new code under 'Why the last start failed'" (an older `server.boot_failed` in the log first);
  - "folders reached through a symbolic link still finish an interrupted Start again" (the checks run after canonicalising).
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution.boot.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement; apply S17; run the file plus `src/node-entry.test.ts src/first-setup-entry.test.ts src/connection-bootstrap.entry.test.ts src/recovery-surface.test.ts` (the last whole, Global constraints).
- [ ] **Step 4:** Commit (no push until 5e) `git commit -s -m "Start: serve the recovery page for an old archive or an unfinishable Start again (A1042; item S17)"`.

### Task 5d: The server's repair routes forget workspace selection

**Files:** `apps/server/src/first-setup-resolution.ts:61-209` (delete `inspectWorkspaceSelection`, `resumeWorkspaceSelection`), `apps/server/src/setup-first-fiscal-api.ts` (their routes), `apps/server/src/first-setup-unused-assignment.ts:50` (drop `workspace:predecessor`); tests S20 (S7, S11 and S19 went in Task 3e3).

- [ ] **Step 1:** Before deleting S20, grep the ownership-recovery suites for a failed-password throttling case; if none, move S20's `:297` case there first.
- [ ] **Step 2:** Delete; apply S20; `pnpm --filter @waitron/server typecheck` passes (5a's red ends here); run `pnpm --filter @waitron/server exec vitest run src/first-setup-unused-pdf.test.ts src/first-fiscal-hour-finish.test.ts src/first-setup-start-again-note.test.ts` and the file the throttling case moved to.
- [ ] **Step 3:** Commit (no push until 5e) `git commit -s -m "Server: drop workspace-selection resumption (A1042; item S20)"`.

### Task 5e: The start's workspace clean-up goes

**Files:** `apps/server/src/node-entry.ts:365-377` (the moved-folders clean-up and its `moved` branch; also `moved` at `:416`, whose `binding` clause Task 5a2 removed); tests S22. The anchor readers and A731's anchor callers moved to Task 5a3.

- [ ] **Step 1:** Delete; `pnpm --filter @waitron/server typecheck` passes.
- [ ] **Step 2:** Apply S22; run `pnpm --filter @waitron/server exec vitest run src/node-entry.full-disk.test.ts src/node-entry.full-disk-order.test.ts src/node-entry.test.ts`. The `start-full-disk.e2e.test.ts` case needs a small real filesystem (`hdiutil` on macOS; `WAITRON_FULL_DISK_DIR` on Linux); a skip is not a pass (`CLAUDE.md` §4).
- [ ] **Step 3:** Commit `git commit -s -m "Server: no workspace clean-up at the start (A1042; item S22)"`, then push 5a–5e together.

### Task 5f: The setup screens: Start again with the database present

**Files:** `apps/setup/src/screens/initial-owner-strings.ts:2-37,38-75` (the keys below), `apps/setup/src/setup-app.ts:1254-1286,2196-2248`, `apps/setup/src/api/client.ts` (the workspace-selection methods go); tests A1 and A4, `setup-app-resolution.unsaved.test.ts`, `setup-app-resolution.a11y.test.ts`.

Wording (concise, as the owner prefers; `startAgainHelp` and `restarting` are shared with Task 5g's ask):

| Key | English | Spanish |
| --- | --- | --- |
| `startAgainHelp` | Deletes this attempt. This box will not use its invoice series names again. | Borra este intento. Este equipo no volverá a usar sus nombres de serie de facturas. |
| `retireConfirmed` | Delete the old attempt and start again. | Borrar el intento anterior y empezar de nuevo. |
| `restarting` | The old attempt is deleted. Reconnect to continue. | El intento anterior se ha borrado. Reconecta para continuar. |

- [ ] **Step 1: Failing cases** in `setup-app-resolution.test.ts`, reading expected text from the strings file in both languages: the confirmation shows the new help and label; after Start again the page shows `restarting`.
- [ ] **Step 2:** Check free memory (`memory_pressure | grep free`), then `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts`; expected FAIL on the old text.
- [ ] **Step 3:** Implement; apply A1 and A4; run the files above and `pnpm --filter @waitron/setup build`.
- [ ] **Step 4:** Commit `git commit -s -m "Setup: Start again says it deletes the attempt (A1042; items A1, A4)"`.

### Task 5g: The setup screens: the ask on a missing database

**Files:** `apps/setup/src/screens/initial-owner-strings.ts` (the wording section's keys: `missingDatabase` replaced, `missingAsk`, `reachedName`, `reachedNoName`, `reachedFiscalStarted`, `reachedFiscalFinished`, `missingBackup`, `recoverBackupNote`, `missingConfirm` added), `apps/setup/src/setup-app.ts:2116-2292` (`#renderFirstOwner`: after the password step on a missing database, the summary list, A731's Recover from backup button with `recoverBackupNote` under it, no Start again in the ask while A731's status reports a journal (point 5 B: `GET …/backup/status` answers `phase` other than `"unstarted"` — `"uncertain"` included, which it answers when it cannot read the journal; Task 0 results, (m)), and `missingConfirm` as the tick box; `authenticatedMissing`, `:2121-2125`, takes every status but `complete`) and `:1254-1286` (`#startAgainFirstSetup` passes on the summary the page displayed), `apps/setup/src/first-setup-session.ts:537-574` (`retireMissingDatabase(shown)`: `shown` is the summary the page displayed; it reads the summary again just before sending, refuses `setup.attempt_conflict` on any difference, and sends `shown`; its status check `:541-545` allows every status but `complete`), `apps/setup/src/api/client.ts` (a `startAgainSummary` method; `startAgainFirstSetup` takes the optional confirmation), `apps/setup/test/missing-database-browser.ts` (stubs answer the summary route); tests A2, A3.

- [ ] **Step 1: Failing cases**, reading expected text from the strings file in both languages:
  - in `setup-app-missing-database.test.ts`: the ask shows `missingAsk` and one `reachedName` line for a `named` summary; `reachedNoName` when the name is `null`; both `reachedName` and `reachedFiscalFinished` for a `fiscal-finished` one (the owner's two worked examples); Start again stays disabled until `missingConfirm` is ticked; the Recover from backup button is drawn beside it with `recoverBackupNote` under it; while A731's status reports a journal, the ask offers no Start again; before the password step none of the ask's lines are shown.
  - in `first-setup-retirement.test.ts`: the session sends exactly the summary the page displayed, and "a summary that changed between display and confirmation is refused, and nothing is sent" (A3's added row).
- [ ] **Step 2:** Check free memory, then `pnpm --filter @waitron/setup exec vitest run src/setup-app-missing-database.test.ts src/first-setup-retirement.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement; apply A2 and A3 exactly as their items say (anything else is a STOP); run both files, `src/setup-app-missing-database.a11y.test.ts` and `pnpm --filter @waitron/setup build`. Open the repair page with a stubbed missing database and look at both worked examples in light and dark, at phone width, in both languages.
- [ ] **Step 4:** Commit `git commit -s -m "Setup: on a missing database the repair page asks, and shows what the attempt reached (A1042, owner Q1; items A2, A3)"`.

### Task 6: Restores, re-registrations and promotions honour the note

**Files:** `apps/server/src/recovery-preparation.ts:200-209` (append `startAgainFloorSources(await readStartAgainNote((await boxFolders(options)).stateDir))` beside `backup-created`), `apps/server/src/node-operation-preparation.ts:89-110` (the same, into `current.history`). A731's recovery facts need no change of their own: its `readRecoveryFacts` (`apps/server/src/first-setup-backup-recovery.ts:457-479`) is handed to `createSelectedRecoveryPreparation` as `options.readRecoveryFacts` (`:447-457`), and that wrapper calls it (`recovery-preparation.ts:154-158`) and appends its floors to the history it returns (`:199-209`), so the one addition at `:200-209` reaches A731's chooser; there `boxFolders(options)` gets the recovery's target folders and returns the box's own (Task 0b). Adding the note at `first-setup-backup-recovery.ts:465` as well would put a second, identical floor beside it, and neither addition's proof by deletion could then fail (round-6 review, M4). Tests go through the production builders, not the test-only helpers `apps/server/test/hour-recovery-host.ts` and `apps/server/src/testing/staged-hour-*.ts`, which build their own chooser.

- [ ] **Step 1: Failing cases:** "a restore with the clock set back behind the start-again note is refused, not given a repeated name" (a note at `F`, a backup whose history ends before `F`, both clocks 10 minutes before `F` → `minute_not_later` with `allowedFromMs: F`); "a backup whose history is later than the note wins"; "a restore into A731's nested target reads the box's own note"; one re-registration case with the note ahead → refused; "an A731 backup recovery with both clocks before the note is refused" (A731's fixture `apps/server/test/first-setup-backup-recovery-fixture.ts`, a note written into the box's state folder before `open`; `prepare` answers `minute_not_later` with `allowedFromMs` equal to the note's floor).
- [ ] **Step 2:** Run each file with `pnpm --filter @waitron/server exec vitest run <file>`; expected FAIL (a name is given).
- [ ] **Step 3:** Implement; run; PASS. Prove each addition by deletion as in Task 1b Step 5, recording the output: the `recovery-preparation.ts` addition with both the ordinary restore case and the A731 case (each must then show a name given), and the `node-operation-preparation.ts` addition with the re-registration case.
- [ ] **Step 4:** Commit `git commit -s -m "Restore, re-register and promote honour the start-again note (A1042)"`.

### Task 6b: A plain `waitron.sh reset` keeps the note and the confirmation records; `reset --all` removes them (Q4)

**Files:** `deploy/waitron.sh:745` (`! -name tls ! -name first-setup-start-again.json ! -name first-setup-start-again-confirmations`; `wipe_box`, `:726-747`, serves both `reset` and `--reset install`); the script's own words, which would otherwise go stale — its usage lines `:8` ("keeps the certificate") and `:31` ("keeps the certificate; --all drops it too") and the comment at `:741` ("Empty state except tls/"); `scripts/waitron-sh.test.mjs`, including the title of `:1471` ("removes the transient volumes, empties state except tls, keeps .env"), which becomes "… empties state except tls, the start-again note and the confirmation records …" — a title, not an assertion, so no approval is needed.

- [ ] **Step 1: Failing cases** in `scripts/waitron-sh.test.mjs`:
  - beside the existing text match at `:1487-1491`: "a plain reset's state clean-up spares the start-again note and the confirmation records". Weaker than its name — under stubbed Docker it can only match the command text.
  - "the reset's state clean-up keeps tls/, the note and the confirmation records and removes the rest": extract the `sh -c` expression from `deploy/waitron.sh` and run it with `WAITRON_STATE_DIR` set to a temporary folder holding `tls/`, the note, a confirmation folder with one record, `first-setup.json` and `trading.env` (the experiment in Current behaviour, as a test).
  - "`--reset install` keeps them too": the same text match on the `--reset install` path.
  - "reset --all removes the state volume, note included": the existing `rm_volume waitron_state` match, and no `! -name first-setup-start-again.json` call on that path.

  The existing assertions at `:1487-1491`, `:1583` and `:1600` are unchanged (Current behaviour: the `:1489` pattern still matches the changed command). Run `pnpm exec vitest run scripts/waitron-sh.test.mjs`; expected FAIL on the new cases.
- [ ] **Step 2:** Implement; run; PASS.
- [ ] **Step 3:** Commit `git commit -s -m "waitron.sh reset keeps the start-again note and confirmation records; reset --all removes them (A1042, owner Q4)"`.

### Task 6c: Nothing deletes the note (owner, Q3)

**Files:** Create `scripts/start-again-note-writers.test.ts` (root guard); `apps/server/src/first-setup-start-again-note.test.ts`.

- [ ] **Step 1: Failing guard.** `scripts/start-again-note-writers.test.ts`: no tracked non-test `.ts`, `.mjs` or `.sh` file names `first-setup-start-again.json`, `START_AGAIN_NOTE_FILE` or `first-setup-start-again-confirmations`, except D1's one allowlist: `packages/provisioning/src/first-setup-start-again-note.ts`, `packages/provisioning/src/first-setup-start-again-confirmation.ts`, `packages/provisioning/src/first-setup-state.ts` (the host-file list), `packages/provisioning/src/index.ts` (an explicit re-export) and `deploy/waitron.sh`. `.md` files are not read: Task 7 names the note in `deploy/README.md` and the docs. Weaker than its name: it reads text, so a path built from pieces escapes it; it never checks what an allowed file does with the name. Prove it by adding the name to a scratch source file: the guard fails naming that file; remove it.
- [ ] **Step 2: Lifetime cases** in `first-setup-start-again-note.test.ts`, each starting from a note and one confirmation record and ending with their bytes unchanged: a Start again with the database present; a confirmed Start again on a missing database whose attempt chose no name (the note is not rewritten); a start that finishes an interrupted deletion (`finishStartAgainDeletion`); a staged restore placed and discarded; the in-app reset (`apps/server/src/reset-request.ts`); a restart of the repair listener. And one where a later name raises it: the bytes change, the floor is later, the file is never absent (read it between the temporary write and the rename through the `io` hook).
- [ ] **Step 3:** Run `pnpm exec vitest run scripts/start-again-note-writers.test.ts` and `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts`; PASS (these pin behaviour the earlier tasks built; a failure is a defect in them, fixed at its task's file).
- [ ] **Step 4:** Commit `git commit -s -m "Nothing deletes the start-again note: lifetime cases and a guard (A1042, owner Q3)"`.

### Task S7l-a: Start again treats a damaged kept recovery record as missing, and needs the warning acknowledged (as built, 2026-10-25)

Added after the owner's 10:04 answer of 2026-10-25. With the database missing, a kept recovery-key record that cannot be read is treated as missing for Start again's floor, and the summary carries `recoveryRecordDamaged: true`, which the confirmation must echo; commit `966c088a6`, with `136abec48` (a stray file beside a damaged record still refuses).

### Task S7l-b: The repair page says the recovery-key record is damaged before Start again (as built, 2026-10-25)

The repair page draws `recoveryRecordDamaged` above `startAgainHelp` in the Start again confirmation, with Cancel beside the confirm button; commit `ba2aacf8a`.

### Task 7: Documentation, backlog (A950, the failover requirement, B3) and the A679 pointer

**Files:**
- `docs/backlog/setup.md:307-326`: move "Owner decision: should a setup request stop re-checking every old 'start again' archive in full?" into `## Decisions and deliberate limits` (`:417` at 91aa8dfe0) as "DECIDED (owner, 2026-10-24): neither — Start again deletes the attempt after its empty-database proof (or, with the database missing, after the person's recorded confirmation) and keeps one small note of the last series name, which nothing but `waitron.sh reset --all` deletes (A1042)". Give D1's file, D2's floor and the owner's answers to Q1–Q6 one sentence each.
- `docs/backlog.md`, the entry headed "Owner decision: should a setup request stop re-checking every old 'start again' archive in full?" (`:557` at 91aa8dfe0): delete it, and an A1042 entry if one exists by then. Task 7 cites backlog entries by heading, because their line numbers move with every landing.
- **B3**, the `docs/backlog.md` entry headed "B3. The bootable USB installer" (index) and its detail in `docs/backlog/box.md` ("Box image constraints (B3)", `:382`): one paragraph — "Owner, 2026-10-24 (A1042 Q3): a reinstall from the stick, and the dashboard's reinstall, keep the box's series-name note. Proposed change to the design, waiting for the owner's review of B3: `docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md`, 'Proposed change to B3's design'." The B3 spec itself is not edited here (lane A owns it; the owner reviews B3).
- **A950**, `docs/backlog/box.md` "Automatic upgrades that can be undone until the first order" and its `docs/backlog.md` index entry of the same name: "Owner, 2026-10-24 (A1042 Q5): a rollback never takes the start-again note backwards — it keeps the newer one. An ordinary upgrade never writes the note; it moves only when a new installation name is picked (setup, restore, re-registration, promotion, or an exceptional change such as the software provider's name)."
- **The failover requirement**, `docs/backlog/replication-cloud.md:372-…` ("Replication, membership & failover — residuals"), as a requirement for what failover is rebuilt into: "Owner, 2026-10-24 (A1042 Q3): every new start-again note the primary writes is written on each secondary too, so every node knows the current note; a secondary joining a venue takes the primary's note first. Not built: a venue has one node." The `docs/backlog.md` index entry "Replication, membership & failover — residuals" gains nothing (it points at the detail).
- New backlog entries:
  - "The recovery page's never-wipe test misses Spanish subjunctive forms": `apps/server/src/recovery-surface.test.ts:386-394` matches `\brestablece` but not `restablezca` or `restablezcas`. Tightening it changes an existing assertion, so the owner approves that change.
  - "The first-setup record store still accepts the `retire` and `select-workspace` actions and `nextWorkspace`, which nothing writes since A1042" (D4).
  - Point 1 was answered A (owner, 2026-10-25): "Move the start-again note whenever a series name is put into use, and when a plain reset ends an unfinished setup" — setup's fiscal step finishing, a restore finishing, a re-registration, a promotion, designed so the name chooser never refuses its own request (`packages/fiscal-verifactu/src/hour-selection.ts:326-328,409-416`; the round-4 reviewer's probe), and a plain `waitron.sh reset` raising the note from an unfinished setup's chosen name before it deletes that setup; the failover requirement above depends on it.
  - Point 5 was answered B (owner, 2026-10-25): "Starting a backup recovery and giving it up blocks Start again for good" — the journal A731 writes at `prepare` is never deleted, its target holds a `venue.lock` that must never be unlinked, and A731 refuses any other backup into that recovery (`setup.attempt_conflict`, run on 2026-10-25: Task 0 results, (m)); a way out needs A731 to learn an abandoned recovery that its entry treats as absent while the folder and lock stay.
- `docs/superpowers/specs/2026-10-16-a679-hour-coded-series-design.md`: a dated pointer at the top and beside `:157` — "Dated pointer, 2026-10-24: 'Preserve the original attempt and artifacts' is superseded by A1042 — Start again deletes the attempt and keeps one small note; see `docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md`".
- `docs/operations/first-live-fiscal-setup.md:84-87` (including what the repair page asks when the database is missing); `docs/developers/conventions-data.md:2965-2968,3079-3084` (one line later than at 40eed0cde); `docs/developers/testing-guide.md:1307`; `deploy/README.md:341-347` (what a plain `reset` keeps: `tls/`, the note and the confirmation records; what `--all` removes; and, since point 1 was answered A, one plain sentence: "A reset during an unfinished first setup forgets the series name that setup chose; the box's clock check still guards it.").
- `CLAUDE.md` §5's installation-name rule: one clause naming the note, and only if "every name in the history it can read" no longer covers it.

User guide: none at db4e0a6bf or 69a7e2ae3 (`/usr/bin/grep -rn -i "start again\|empezar de nuevo" apps/server/src/guide` finds nothing), and A731's `backup-recovery.md` at #2043's head def03078a does not mention Start again (read in `gh pr diff 2043`). If Task 0 finds that changed, change both languages with the same `{#id}`s.

- [ ] **Step 1:** Read the whole base-to-tip range for claims about kept attempts, workspaces or archives, and about what a reset or a reinstall erases: `/usr/bin/grep -rn -i "workspace\|retire\|retain.*attempt\|archive\|reset --all\|except tls" docs/operations docs/developers README.md apps/server/README.md deploy/README.md`, reviewing every hit (`CLAUDE.md` §1). Historical documents get a dated pointer, never a rewrite.
- [ ] **Step 2:** Make the edits.
- [ ] **Step 3:** Run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and, if a guide changed, `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`. For each changed `.md` outside `docs/`, `pnpm exec prettier --check <file>`; inside `docs/`, `pnpm exec prettier --file-info <file>` shows it is ignored.
- [ ] **Step 4:** Commit `git commit -s -m "Docs: Start again keeps one small note; A1037's question settled; A950, B3 and failover requirements (A1042)"`.

### Task 8: Final qualification and parking for the owner

- [ ] **Step 1:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/hour-selection.test.ts src/hour-clock.test.ts src/minute-selection-unknown-name.test.ts`; `git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts` prints nothing.
- [ ] **Step 2:** `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/coverage-thresholds.test.ts scripts/waitron-sh.test.mjs scripts/start-again-note-writers.test.ts`, and `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts` whole.
- [ ] **Step 3:** Coverage once for the touched non-shard packages, reading the per-file table: `pnpm --filter @waitron/provisioning test:coverage`, `pnpm --filter @waitron/fiscal-verifactu test:coverage`, `pnpm --filter @waitron/module test:coverage` (server and setup are left to CI's shards).
- [ ] **Step 4:** Compare the branch's changed assertions with "Existing assertions this plan changes": `git diff main --stat -- '*.test.ts' '*.test.mjs' 'apps/*/test/*.ts'` and read each hunk; re-run both sweeps on the branch. Anything not on the list is a STOP.
- [ ] **Step 5:** `/finish-branch` on the worktree — FULL path, the Codex run-it seat as two reviews side by side (the second sets the checklist aside). Brief both with Review focus 1–8, the owner's answers to Q1–Q7 and the owner's answers to the five points of "For the owner: what waits for approval".
- [ ] **Step 6:** Open the PR. First line: "Reset any development or demo box that holds a first-setup workspace or start-again archive (`wa-wt reset demo <name>`): such a box now refuses to start and says so." State the owner's answers as built (the seven questions and the five owner points), and list each finding of the plan reviews (three rounds, revision 4's review, Task 0's, and round 6's) with what changed. Watch CI on the current head; park `needs-owner-review` (fiscal: series names); post the landing note to `~/waitron-campaign/questions.md`.

## Self-review

- **Spec coverage.**
  - Delete after the empty-database proof: Tasks 1b and 3c.
  - One small note: D1, Tasks 1a and 2.
  - Never at or before it: D2, Tasks 1b and 6.
  - Readers replaced: Tasks 4a–4d; the workspace machinery: Tasks 5a–5e.
  - A1037's question moved to Decisions, and the A679 pointer: Task 7.
  - Never deleted, never lowered, only `reset --all` removes it (Q3, Q4): D1's write rule, Global constraints, Tasks 2, 3b, 6b and 6c.
  - Survives a restore (D1, Tasks 2 and 6), a plain reset (Task 6b), a stick reinstall (the B3 change, Task 7), A950's rollback and a second node (Task 7's backlog requirements).
  - The missing-database ask, its confirmation (the displayed summary) recorded before any deletion, and its wording: D3a, Tasks 3a, 3a2, 3a3, 3c and 5g;
  - A731's records in both folders, and a given-up recovery: "What A731 changed" items 9–11, D3's lists, D5's order, point 5, Task 0 Step 3 (e), (i), (m); "For the owner: what waits for approval", part 2.
  - Old boxes: D4, D5, Tasks 5a–5c2.
  - Failing test first, proved by deletion: Task 1b Steps 1, 2 and 5; re-proved in Task 4c Step 2.
  - Waits for A731 and re-checks: Tasks 0 and 0b.
- **Names across tasks:** `boxFolders`, `readStartAgainNote`, `raiseStartAgainNote`, `startAgainFloorSources`, `StartAgainSummary`, `startAgainSummary`, `writeStartAgainConfirmation` (module `first-setup-start-again-confirmation.ts`), the server's `summary` action, request field `confirmMissingDatabase`, route `…/resolution/start-again/summary`, folder `first-setup-start-again-confirmations/` (state folder), guard `scripts/start-again-note-writers.test.ts`, `writeStartAgainMarker`, `readStartAgainMarker`, `deleteMarkedAttempt`, `finishStartAgainDeletion`, `assertNoStartAgainDeletion`, `assertNoLegacyFirstSetupWorkspace`, `START_AGAIN_NOTE_FILE`, seat `startAgainFloor`, facts field `floors`, admission kind `refused`, recovery flag `refusedAtStart` and helper `refusedAtStart`, `markerSize`, codes `setup.start_again_incomplete` and `setup.workspace_unsupported`, files `first-setup-start-again.json` (state folder) and `first-setup-deleting.json` (venue folder).
- **Assumptions to watch:** A731 as re-checked at 91aa8dfe0 (Task 0 results; a later main needs the same check); S7d's exact answer (Task 4b2 records it); S10's and S14's recorded outcomes (Task 3a3); whether `rejoin` can remove the marker (Task 3d Step 3); the owner's answers on S25, S26, P8 and point 5's cost ("Task 0 findings that need the owner"). The five owner points were answered on 2026-10-25 (1A, 2A, 3A, 4A, 5B).
- **Not verified in this revision:** everything about B3 is design text, not code (B3 is not built); the chooser's own-request refusal behind point 1 was run by the round-4 reviewer, not by this revision; where a given-up A731 recovery records its name pick (point 5) — run on 2026-10-25 in Task 0 (m), archive and Cloud sources; the claim that no other app path deletes a state-folder file by listing the folder was read (the grep in D1), and Task 6c runs it.

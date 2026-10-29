# A1206: retire the start-again note — no record of used series names is kept on disk — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`; one that passes about 150 tool calls with its task unfinished stops at a passing (or cleanly failing) point, commits, and hands over (done, left, files, each check's state).

**Owner decision (2026-10-29 ~10:38, verbatim):** "I think we must remove this concept of storing the used series name on disk. It introduces too many complications. We use the current minute, with confirmed clock times, and the latest invoice numbers if we have any." Queue entry: A1206 in `~/waitron-campaign/queue.md`. This reverses the owner's 2026-10-24 A1042 decision (the note and its floor) and everything built on it: A1098's Move floor, A1099's damaged-name-record floor, and A1131's counting of every installation name a setup database held.

**Review path: FULL.** Risk triggers: invoice series names (a name is never reused), and two cross-package contracts (the module seat `startAgainFloor`/`startAgainHistory` in `packages/module/src/initial-setup.ts`, and `readSetupFacts().floors` in `packages/module/src/operation-preparation.ts`). The `/finish-branch` Codex run-it seat runs twice (the second angle sets this checklist aside). **Parks `needs-owner-review` for the owner to land** (series naming is fiscal).

## Goal

A new installation name is chosen by three rules only, and nothing else:
1. it is the box's current UTC minute (five symbols);
2. only after a clock on another machine agrees within 30 seconds;
3. strictly later than every name in the history the box can still read (a restored or surviving database, a backup's own newest record or creation time, the module's own preparation history).

Setup and restore keep their 90–150 second wait. The preproduction throwaway is unchanged. The start-again note `<state>/first-setup-start-again.json` and every writer, reader, floor and refusal that exists only for it go. Start again itself (deleting a failed first-setup attempt), its confirmation records, the Keep/Move choice for files a cut-off Start again found (A1098) and the set-aside folder, the guess counter, the held-state counts and refusals (A1131 part 1), and the "recovery-key record is damaged" warning all stay.

**What the owner accepts by this (state it in the PR).** A name an abandoned attempt used is no longer remembered once Start again deletes the attempt. What keeps a later name from repeating it is rules 1–2 plus the wait: a name is written only once the clock has reached its minute (`identity: encodeMinuteIdentity(now)` after `now >= targetMs`, `packages/fiscal-verifactu/src/hour-selection.ts:483-503`), and a later setup or restore targets the start of a minute at least 90 seconds ahead (`:446-451`, `SETTLE_MS = 90_000` at `:66`), which is more than the 60 seconds two clocks each within 30 seconds of the truth can disagree by. Task 1 pins that with a test and a deletion control. If both clocks are wrong together (set back by the same amount), a repeated name is now possible; until today the note refused it. The test that pinned that refusal is deleted (Changed test checks, C1).

## Fiscal boundary

Nothing touches `registros_facturacion` or its triggers, `computeHuella`, the chain, invoice numbering, `registerSif`, `restoreFiscal`, `activate`, or the chooser `hour-selection.ts` (its new case in Task 1 is a test only). The edits inside `packages/fiscal-verifactu` are: one source fewer in `hour-preparation.ts`, the note's special case in `hour-history.ts`, and the start-again seat in `initial-hour-setup.ts`, `hour-configuration.ts` and `start-again-holdings.ts`. These must pass **unedited** after every task that touches `packages/fiscal-verifactu`, and at the end:

```
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
```

**No migration.** No task touches a schema, a `drizzle` folder or a migration set. The note, the confirmation records and the choice records are JSON files in the state folder.

## Measurement (2026-10-29, this worktree at `70eeac815`, `AI_AGENT`/`CLAUDECODE` unset)

Commands run and what they printed:

- `git grep -l -i -E 'first-setup-start-again|start-again note|startAgainNote|StartAgainNote|start_again_note'` → 82 files (code, tests and docs), listed in the consumer table below with the files the grep misses (the seat `startAgainFloor`, `noteFloorMs`, `unreadable`, `attemptLastWriteMs`, `moveFloor`).
- `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-note.test.ts` → `Tests 145 passed (145)`.
- `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts src/hour-promotion.test.ts src/hour-recovery-host.test.ts` → `Tests 195 passed (195)`, exit 0, 92 s.
- **Probe: the note is what refuses a promotion (failing case and control).** In a throwaway copy of `apps/server/src/hour-promotion.test.ts` (restored afterwards; `git status` clean) I appended the existing case "a promotion with the clock behind the start-again note is refused, not given a repeated name" (`:601-618`) again with its one `raiseStartAgainNote` line removed, and ran `pnpm exec vitest run src/hour-promotion.test.ts -t "start-again note|PROBE A1206"` from `apps/server` → `Tests 2 passed | 37 skipped`. With the note (10 minutes ahead of the clock): refused `sif.allocation_invalid`, `reason: "minute_not_later"`, `allowedFromMs` = the note's floor. Without it, the same request answered `{"status":"selected", …}`. So on that path the note's floor alone decides between a refusal and a name.

**Where the note's floor enters the name choice today, and what the comparison becomes.**
- The note is read by `readStartAgainFloors` (`packages/provisioning/src/box-folders.ts:25-29`), which turns it into one history source `{ reference: "start-again-note", complete: true, records: [], timeFloorMs: floorMs }` (`startAgainFloorSources`, `packages/provisioning/src/first-setup-start-again-note.ts:74-83`).
- Three callers add that source to the name chooser's history: first setup (`packages/provisioning/src/first-setup-runtime.ts:231-234`, as `readSetupFacts().floors`, spread into the history at `packages/fiscal-verifactu/src/hour-preparation.ts:173`), promotion (`apps/server/src/node-operation-preparation.ts:99-104`) and restore (`apps/server/src/recovery-preparation.ts:209-214`).
- `projectHourHistory` (`packages/fiscal-verifactu/src/hour-history.ts:60-66`) refuses a note source whose floor is before the epoch, then takes the largest `timeFloorMs` of all sources as `recordedTimeFloorMs` (`:77-78`).
- The chooser (`hour-selection.ts`) refuses a stored pick made before `recordedTimeFloorMs` (`:409-415`) and sets `earliestMs = max(greatestSpentMinute + 1 minute, recordedTimeFloorMs, settleTarget)` (`:452-457`); a target more than 150 seconds away is refused `minute_not_later` with the target as `allowedFromMs` (`:460-462`). That refusal is the one the docs call "the clock set back behind the start-again note".
- **After this plan** the chooser's code is unchanged. Its history simply never holds the note's source, so `recordedTimeFloorMs` is the largest time floor among the sources that remain (the backup's `createdAt` source `backup-created`, module evidence and surviving history, `recovery-preparation.ts:200-208`; the hour module's own floors), and `greatestSpentMinute` still comes from every readable record.

**Writers of the note:** Start again (`apps/server/src/first-setup-resolution.ts:675`, `raiseStartAgainNote(box.stateDir, floor)`, with the floor from `gatherStartAgainFloor`, `:140-276`, and a stopped recovery's floor from `stoppedRecovery`, `:357-400`), and a Move (`raiseNoteToRecord`, `packages/provisioning/src/first-setup-start-again-set-aside.ts:236-245`, called at `:369` and `:456`, with `noteFloorMs` from the survey, `first-setup-start-again-leftovers.ts:245-248`). **Readers besides the floor:** the Move survey (`leftovers.ts:246`, "is there a note?"), and the test helpers.

**What exists only for the note** (each traced to its caller):
- A1099's damaged-name-record path: the summary's `unreadable` `{ records, floorMs }`, the request field `confirmUnreadable`, the `seriesPicksUnreadable` parameter of `setup.start_again_password_required` (`apps/server/src/errors.ts:1036-1041`), the database-present summary offered only for damaged picks (`presentPicksOnly`, `first-setup-resolution.ts:450-459`, `:491`), `attemptLastWriteMs` (`packages/provisioning/src/first-setup-start-again-deletion.ts:337`), `readSeriesPicks`/`seriesPicksUnreadable` (`apps/server/src/first-setup-start-again-name-records.ts`, whole file), `readWellFormedModulePreparations` (`packages/provisioning/src/module-preparation-state.ts:89`) and `readWellFormedFirstFiscalEvidence` (`apps/server/src/first-fiscal-evidence.ts:105`), whose only callers are the floor code (`git grep`, non-test files). Before A1099 these damaged records refused Start again only because the floor could not be worked out (A1099 plan, PROBE 2/3: "damaged picks → `setup.attempt_invalid`"; its review I5: an attempt whose module has no `startAgainFloor` seat "still starts again password-free as today, because the gather never reads the picks for it").
- The seat: `startAgainFloor` and `startAgainHistory` in `packages/module/src/initial-setup.ts:77-107`, the hour module's `hourStartAgainFloor` and `isNamelessEvidence` (`packages/fiscal-verifactu/src/initial-hour-setup.ts:123-200`, `:422-424`; `hour-configuration.ts:88-90`), `startAgainHistory` (`start-again-holdings.ts:48`), and `holdings.history` (`apps/server/src/first-setup-database-holdings.ts:145-157`, A1131).
- The summary's `lastName` and the stopped recovery's `shown.lastName`: worked out only by the seat (`summaryOf`, `first-setup-resolution.ts:278-290`; `stoppedRecovery` `:360-400`). The setup app draws `summary.lastName` in one line of the missing-database ask (`apps/setup/src/setup-app.ts:2826-2832`); see open question Q1.
- `stoppedRecovery`'s refusal when the recovery's name cannot be worked out (`:363`, `:385-389`).
- The Move's floor: the survey's `noteFloorMs`, the choice record's `noteFloorMs` (`first-setup-start-again-choice.ts:32-33`, `:118-172`), `startAgainSetAsideFloorMs` and `START_AGAIN_FLOOR_MARGIN_MS` (`leftovers.ts:48`, `:88-99`), and the recovery page's `moveFloor` line in English and Spanish (`apps/server/src/recovery-start-again.ts:35`, `:74`, `:117`, `:195`, `:257-258`).
- The setup app's damaged-name words: `seriesPicksDamaged`, `publicRecordDamaged`, `fiscalDocumentsDamaged`, `namesFrom` and `namesFromText` (`apps/setup/src/screens/initial-owner-strings.ts:43-48`, `:132-138`, `:178`), `damagedRecordSummary` (`apps/setup/src/first-setup-session.ts:798`), the `#seriesPicksUnreadable` field and its branch (`setup-app.ts:1152`, `:1491-1492`, `:1579`, `:2610`).
- The guard `scripts/start-again-note-writers.test.ts` — but only its note half: it also holds that only listed files name the confirmation folder, the choice folder and the set-aside folder, which survive (Task 10 narrows and renames it).
- `deploy/waitron.sh:743-749`: the plain `reset` spares the note by name.

**What survives although it was built beside the note** (decided conservatively):
- **The Move/Keep choice (A1098) stays.** It is about files a cut-off Start again found and did not create (`surveyStartAgainLeftovers` binds them from the deletion marker, `leftovers.ts:225-252`); Move sets them aside instead of deleting them, under the owner's never-delete rule. Only its floor goes. With no note, a Move moves the files and finishes Start again, and raises nothing.
- **The "recovery-key record is damaged" warning stays** on every path where it shows today (owner, 2026-10-25, A1042 S7l-a: the person must have been shown it). On the missing-database and held paths it is worked out inside `gatherStartAgainFloor` today (`:183-196`); Task 5 keeps that read, alone, in a small function. See Q2.
- **The refusal when the host was given no modules stays** (`first-setup-resolution.ts:153`, and `stoppedRecovery`'s `host.modules === undefined`): the held-state counts (`readSetupDatabaseHoldings(roots, host.modules!)`) and the recovery-key record read still need the module list.
- **Error codes:** none becomes unused. `setup.start_again_password_required` stays (damaged recovery-key record, discarding a stopped recovery) and loses only its `seriesPicksUnreadable` parameter; `setup.attempt_invalid`, `setup.not_ready` and `sif.allocation_invalid` have other throwers. `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts` must still pass (Task 10). No alert code names the note.
- **`scripts/backup-room-note.test.ts`** lists `first-setup-start-again-deletion.ts` and `first-setup-start-again-set-aside.ts` as files allowed to delete the backup-room note (`:28-29`); both keep doing that, so its lists do not change.
- **The abandon-time check of a backup recovery** ("Start again writes its note and confirmation into the box's state folder before it abandons", `packages/provisioning/src/first-setup-backup-workspace.ts:537-540`) stays for the confirmation; its comment loses "its note and".
- **The retirement record** (`first-setup-retirement.json`, an abandoned attempt kept readable) is not the note and is out of scope; its names are history the box can still read (rule 3).

## A box that already holds a note file

**Ignore it; nothing deletes it in the app.** No code reads, writes or names `first-setup-start-again.json` after this change, so a leftover file is an inert file in the state folder. A plain `waitron.sh reset` deletes it from now on (Task 10 removes the name from its spare list) and `reset --all` always did. Why not delete it at start: that would be compatibility code naming a retired file, which `CLAUDE.md` §3 rules out before a venue is live, and an extra write at start on a box that may be on a full disk. Why ignoring is safe:
- the recovery's originals walk already includes any state file, so an old note is just one more original, as a confirmation record is (`first-setup-backup-workspace.ts:304-360`; the row "the series-name note" of the case at `first-setup-backup-workspace.test.ts:937` goes, its confirmation row stays);
- the leftovers survey works from the deletion marker, not by listing the state folder, so an old note is never a "found" file;
- the name is removed from `FIRST_SETUP_HOST_FILES` (`packages/provisioning/src/first-setup-state.ts:153`). Its two other readers, `restore.ts:239` and `state-secrets.ts:87`, then treat a backup entry `secrets/first-setup-start-again.json` as an ordinary state file instead of refusing it. Nothing reads such a file, so this is harmless; the rows that pinned the refusal are listed in C-rows below.

Tasks 2 and 3 each add a failing test that a box holding a leftover note file (written as raw JSON, with a floor 10 minutes ahead) names its minute exactly as a box without one does.

**Choice records written before this change** hold `noteFloorMs`, which the new parser refuses (no compatibility code, `CLAUDE.md` §3). A development box that made a Keep or Move choice since A1098 (26 October) will refuse at start with `setup.attempt_invalid` until `sudo bash waitron.sh reset --all` (a plain reset keeps choice records). The PR's first line says so.

## Open questions for the owner (each is built with its default; the PR lists them)

- **Q1. The missing-database ask's series-name line.** Today the page says "Its record says it: chose the invoice series name {name}" (or "chose no invoice series name"), and the name comes only from the seat being deleted. Keeping the name means keeping the module reading every name record, with the damaged-record handling the owner called too complicated. **Default: drop the series-name line**; the list keeps "started activation, with no record that it finished" and "finished activation", and when the record reached neither it shows a new line "did not start activation" / «no empezó la activación» (derived words, not approved). `reached` already says this: `claimed` and `named` are exactly the attempts whose record holds no result and none of the events `activation-started`, `uncertain`, `committed`, `publication` or `complete`, which are what draw the two activation lines today (`startAgainSummary`, `packages/provisioning/src/first-setup-start-again-confirmation.ts:59-76`). Not "chose no name": a `named` attempt may only have asked for candidates (`candidates` counts as unused, `apps/server/src/first-setup-resolution.ts:118-129`), so the record cannot say whether a name was chosen.
- **Q2. The "recovery-key record is damaged" warning on the missing-database and held paths.** It was added so the person sees why the record is read past while the floor is gathered (A1042 S7l-a). With no floor, the box need not read that record on those two paths at all. **Default: keep it exactly as today** (no change to what the person sees beyond the series names); dropping it is a later, separate change.

Behaviour changes that follow directly from "no floor" (not questions; the PR lists them):
- With the venue database present, a damaged record of chosen names (`module-preparation-state.json`) no longer asks for the setup password or a confirmation: Start again treats it as it treats an intact one.
- With the venue database missing, a damaged picks file, public fiscal record or fiscal documents file no longer adds warning lines or a "New series names can start from" line; the confirmation is the ordinary missing-database one.
- Beside a stopped recovery, a damaged public fiscal record or documents file no longer refuses `setup.attempt_invalid` (the floor was the only reader, A1042 S7l), and a stopped recovery whose name cannot be worked out is no longer refused `setup.not_ready`.
- A Move no longer raises a floor, and the recovery page no longer says from when new names can start.
- After a Start again, nothing stops a later setup from naming a minute earlier than the abandoned name if both clocks agree on a time set back that far (the note used to refuse it).

## Consumer table

Class: **(a)** exists only for the note → delete; **(b)** mixed → named lines go, the surviving rule stays; **(c)** prose only. Test files are classified case by case under Changed test checks.

| File | Class | What goes / what stays | Task |
| --- | --- | --- | --- |
| `packages/provisioning/src/first-setup-start-again-note.ts` | a | whole module | 8 |
| `packages/provisioning/src/box-folders.ts` | b | `readStartAgainFloors` goes; `boxFolders` stays | 3 |
| `packages/provisioning/src/first-setup-runtime.ts` | b | `floors` in `readSetupFacts` (`:231-234`) | 3 |
| `packages/provisioning/src/first-setup-state.ts` | b | `START_AGAIN_NOTE_FILE` in `FIRST_SETUP_HOST_FILES` (`:11`, `:153`) | 8 |
| `packages/provisioning/src/index.ts` | b | note exports (`:178-185`), `attemptLastWriteMs` (`:202`), `START_AGAIN_FLOOR_MARGIN_MS`/`startAgainSetAsideFloorMs` (`:242-244`), `type StartAgainUnreadable`, `readWellFormedModulePreparations` (`:25`) | 5, 6, 8 |
| `packages/provisioning/src/first-setup-start-again-confirmation.ts` | b | `lastName`, `unreadable` in the summary and the recovery shown; `startAgainSummary`'s second argument; a present-database record needs `recovery` | 5 |
| `packages/provisioning/src/first-setup-start-again-deletion.ts` | b | `attemptLastWriteMs` (`:337-…`) | 8 |
| `packages/provisioning/src/module-preparation-state.ts` | b | `readWellFormedModulePreparations` (`:89`) | 8 |
| `packages/provisioning/src/first-setup-start-again-leftovers.ts` | b | `noteFloorMs`, `startAgainSetAsideFloorMs`, `START_AGAIN_FLOOR_MARGIN_MS`, the note read | 6 |
| `packages/provisioning/src/first-setup-start-again-choice.ts` | b | `noteFloorMs` in the record | 6 |
| `packages/provisioning/src/first-setup-start-again-choose.ts` | b | passing `noteFloorMs`; "raises the note" in the doc comment (`:84`) | 6 |
| `packages/provisioning/src/first-setup-start-again-set-aside.ts` | b | `raiseNoteToRecord` and its two calls | 6 |
| `packages/provisioning/src/first-setup-backup-workspace.ts` | c | comment `:538` | 8 |
| `packages/provisioning/test/start-again-attempt.ts` | b | the `note` option (`:9`, `:82`, `:101`) | 6 |
| `packages/module/src/initial-setup.ts` | b | `startAgainFloor`, `startAgainHistory` | 7 |
| `packages/module/src/operation-preparation.ts` | b | `floors` (`:35`) | 3 |
| `packages/fiscal-verifactu/src/hour-preparation.ts` | b | `...facts.floors` (`:173`) | 3 |
| `packages/fiscal-verifactu/src/hour-history.ts` | b | the `start-again-note` branch (`:60-66`) | 3 |
| `packages/fiscal-verifactu/src/initial-hour-setup.ts` | b | `hourStartAgainFloor`, `isNamelessEvidence`, `START_AGAIN_WRITE_MARGIN_MS`, the two seat entries; `hourInputIdentity`/`publicHourSelectionHistory` imports if unused | 7 |
| `packages/fiscal-verifactu/src/hour-configuration.ts` | b | seat entries `:88-90` | 7 |
| `packages/fiscal-verifactu/src/start-again-holdings.ts` | b | `startAgainHistory`; `startAgainHoldings` stays | 7 |
| `apps/server/src/first-setup-resolution.ts` | b | note write, `gatherStartAgainFloor`, `confirmUnreadable`, `presentPicksOnly`, the seat in `stoppedRecovery`, `lastName`; the recovery-key record read, held counts and every other refusal stay | 4, 5 |
| `apps/server/src/first-setup-start-again-name-records.ts` | a | whole file | 5 |
| `apps/server/src/first-setup-database-holdings.ts` | b | `history` | 5 |
| `apps/server/src/setup-first-fiscal-api.ts` | b | `unreadableConfirmation`, `shownUnreadable`, `confirmUnreadable`, `lastName` in the shown parsers (`:91-160`, `:1069`, `:1094-1106`) | 5 |
| `apps/server/src/errors.ts` | b | `seriesPicksUnreadable` param and its doc (`:1036-1041`) | 5 |
| `apps/server/src/first-fiscal-evidence.ts` | b | `readWellFormedFirstFiscalEvidence` (`:105`) | 5 |
| `apps/server/src/node-operation-preparation.ts` | b | `readStartAgainFloors` spread (`:99-104`) | 2 |
| `apps/server/src/recovery-preparation.ts` | b | `readStartAgainFloors` spread (`:209-214`) | 2 |
| `apps/server/src/recovery-start-again.ts` | b | `moveFloor` (EN/ES) and its paragraph | 6 |
| `apps/server/test/start-again-deleted.ts` | b | `startAgainNoteName`; the note half of `startAgainUnchanged` | 4 |
| `apps/server/test-durations.json` | b | the server note test's key (`:427`) renamed | 8b |
| `apps/setup/src/{setup-app.ts, first-setup-session.ts, api/client.ts, api/first-setup-types.ts, screens/initial-owner-strings.ts}` | b | `unreadable`, `confirmUnreadable`, `seriesPicksUnreadable`, `damagedRecordSummary`, `namesFrom`, the name-record lines, `lastName` + Q1 | 9 |
| `deploy/waitron.sh` | b | `! -name first-setup-start-again.json` (`:749`) and the comments `:8`, `:31`, `:743-746` | 10 |
| `scripts/start-again-note-writers.test.ts` | b | the note's names go; the records/set-aside half stays, renamed | 10 |
| `scripts/waitron-sh.test.mjs` | b | cases `:1471`, `:1498`, `:1519-1536`, `:1597`, `:1706` | 10 |
| `CLAUDE.md`, `apps/server/README.md`, `deploy/README.md`, `docs/operations/first-live-fiscal-setup.md`, `apps/server/src/guide/{en,es}/backup-recovery.md`, `docs/developers/{conventions-data,conventions-ui,workflow-guide,ci-and-gates}.md`, `docs/backlog.md`, `docs/backlog/{setup,replication-cloud,self-service-refusals,box}.md` | c | rewritten or entries deleted | 11 |
| historical plans/specs (A1042, A1098, A1099, A1127, A1131, A1131bc slice 1, A1167, B3, `docs/operations/a1154-changed-checks.md`) | c | not rewritten; three in-flight designs get a dated pointer (Task 11) | 11 |

Counts: (a) 2 production files (the note module, `first-setup-start-again-name-records.ts`) and 3 whole test files (`first-setup-start-again-last-write.test.ts`, `first-setup-start-again-name-records.test.ts`, `packages/composition/src/start-again-floor.test.ts`); (b) 32 table rows covering 36 production, helper, config and guard files, plus about 40 test files changed case by case (Changed test checks); (c) one code comment and about 20 current docs, plus the historical plans and specs, which stay as they are.

## Global constraints (every task)

- Work only in `/Users/clintongormley/workspace/worktrees/waitron-refactor-a1206-retire-start-again-note`, branch `refactor/a1206-retire-start-again-note`. Every commit `git commit -s`, explicit paths only. Do not push.
- Test-first wherever behaviour changes: write the failing test, run it, see it fail for the stated reason, then change the code.
- **A test change not named in this task's Changed test checks rows is a STOP** (owner's 2026-10-05 rule): setup, fixtures, helpers and mocks may change; what a test checks may not, except as listed. A case marked NARROW keeps the named surviving assertion. If a case needs a change not listed, stop and report.
- When a task makes a comment false, delete it (prefer deleting to rewording, `CLAUDE.md` §1).
- General code is English only; Spanish only in the setup app's and recovery page's string tables.
- A run with no `Tests` count is no evidence. Unset `AI_AGENT` and `CLAUDECODE` to see a passing test's console output.
- Browser-mode suites (`apps/setup`) run headless Chromium: check `memory_pressure | grep free` first; beside another session only well above 15% free.
- Each task ends by running its focused tests, the typecheck of every package it touched (`pnpm --filter <pkg> typecheck`), and `pnpm format:check`.
- Order: Tasks 1→11 in sequence; each leaves its packages green. Readers go first (2, 3), then writers (4, 6), then the code nothing calls any more (5, 7, 8).

---

## Task 1: pin the surviving rule — a forgotten name is still never repeated (test only)

**Files:** `packages/fiscal-verifactu/src/hour-selection.test.ts` (beside "restore waits until a minute start 90 to 150 seconds after its check", `:738`).

- [ ] **Step 1: the case.** "a setup that has forgotten an earlier attempt's name still names a later minute when each clock was within 30 seconds": selection A with an empty history and the box clock 30 s fast (the second clock agreeing), driven past its wait to `selected`, records name N_A; then a fresh selection state (Start again deleted A's state) with an empty history, the real time one second after A's intent and the box clock 30 s slow, driven to `selected`: `decodeMinuteIdentity(N_B) > decodeMinuteIdentity(N_A)`. Use the suite's own clock and comparison helpers; one `it.each` over setup and restore (both settle).
- [ ] **Step 2: deletion control (throwaway, never committed).** Set `SETTLE_MS` to `0` in `hour-selection.ts:66`, rerun the case: it must FAIL (with no settle wait, a box 30 s slow can re-target A's minute: the arithmetic is in the Goal). Say in the commit message what it printed. Restore the file (`git diff --exit-code packages/fiscal-verifactu/src/hour-selection.ts`).
- [ ] **Step 3:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-selection.test.ts`, then the two fiscal gates. Commit: "Pin that a name is never repeated after Start again forgets it: the 90-second settle outlasts two clocks 30 seconds apart (A1206)".

## Task 2: restore and promotion stop reading the note

**Files:** `apps/server/src/node-operation-preparation.ts:99-104`, `apps/server/src/recovery-preparation.ts:209-214`; tests `apps/server/src/hour-promotion.test.ts`, `apps/server/src/hour-recovery-host.test.ts`, `apps/server/src/first-setup-backup-recovery-preparation.test.ts`.

- [ ] **Step 1: failing tests.** (i) `hour-promotion.test.ts:601`: replace C2's case with "a promotion beside a leftover start-again note file names its minute as a box without one does": write `{"version":1,"floorMs":<now + 10 min>,"lastName":"0CNQT","module":"fiscal-verifactu"}` to `<state>/first-setup-start-again.json` with `writeFile` (no provisioning helper), then the same `select` → `status: "selected"` (the measurement's control answered exactly that). Fails today: `minute_not_later` at the file's floor. (ii) `hour-recovery-host.test.ts:834`: same shape for a restore — with the leftover file 10 minutes ahead, `recoverySelectPastWaits` reaches `selected` at the restore's ordinary target. Fails today: refused at the floor.
- [ ] **Step 2: implement.** Delete the two `...(await readStartAgainFloors({...}))` spreads and the imports. Do not touch the `backup-created` source.
- [ ] **Step 3: test changes C3–C5** (below), then `pnpm --filter @waitron/server exec vitest run src/hour-promotion.test.ts src/hour-recovery-host.test.ts src/first-setup-backup-recovery-preparation.test.ts`; `pnpm --filter @waitron/server typecheck`. Commit.

## Task 3: first setup's name choice stops reading the note

**Files:** `packages/module/src/operation-preparation.ts:35` (drop `floors`), `packages/provisioning/src/first-setup-runtime.ts:34`, `:231-234`, `packages/provisioning/src/box-folders.ts` (delete `readStartAgainFloors`), `packages/provisioning/src/index.ts:178` (export), `packages/fiscal-verifactu/src/hour-preparation.ts:173` (`history: [facts.localHistory]`), `packages/fiscal-verifactu/src/hour-history.ts:60-66`; any fake `readSetupFacts` in tests that sets `floors` (`git grep -n 'floors' -- '*.test.ts'`): drop the field (setup only). Tests `apps/server/src/first-setup-start-again-note.test.ts`, `packages/fiscal-verifactu/src/hour-history.test.ts`.

- [ ] **Step 1: failing test.** In `apps/server/src/first-setup-start-again-note.test.ts`, beside `:190`: "a new setup beside a leftover start-again note file names its minute as if there were none": after `startedAgain()`, overwrite the note file with raw JSON whose floor is 10 minutes ahead of the clock, then `compareAndSelect` past the ordinary wait → a name, no refusal. Fails today: `minute_not_later`.
- [ ] **Step 2: implement** as listed. `startAgainFloorSources` now has no caller outside its own module and tests; leave it for Task 8.
- [ ] **Step 3: test changes C1, C6, C7.** Then `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-history.test.ts src/hour-preparation.test.ts`, `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-runtime.test.ts`, `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts src/first-fiscal-hour.e2e.test.ts`; typecheck module, provisioning, fiscal-verifactu, server; the two fiscal gates. Commit.

## Task 4: Start again stops writing the note

**Files:** `apps/server/src/first-setup-resolution.ts:675` (delete the `raiseStartAgainNote` call and import; the `floor` value is now unused — delete only the variable binding, the gather stays until Task 5), `:661` comment ("the record and the note change" → "the record changes"); `apps/server/test/start-again-deleted.ts` (delete `startAgainNoteName`; `startAgainUnchanged` keeps only its marker check). Tests: every server file whose cases read the note after a Start again (C8–C20).

- [ ] **Step 1: failing tests** in `apps/server/src/first-setup-start-again-note.test.ts`: (i) "Start again writes no start-again note" — the `abandonedAttempt()` fixture (whose attempt chose a name), Start again → no `first-setup-start-again.json` in the state folder. Fails today (the note holds the name). (ii) "Start again leaves a leftover note file byte for byte": write raw bytes to the file first, Start again, compare bytes. Fails today (raised).
- [ ] **Step 2: implement.**
- [ ] **Step 3: the note-reading assertions after a Start again go** (C8–C20). Each is a removed `readStartAgainNote`/`startAgainNoteName` line or a case whose only check is the note; the rows say which.
- [ ] **Step 4:** `pnpm --filter @waitron/server exec vitest run` over the files in C8–C20; typecheck server. Commit.

## Task 5: Start again reads no name records

The floor is no longer written (Task 4), so the code that works it out, and every refusal and screen field it fed, goes. Server and provisioning together, because the summary's shape is shared.

**Files:**
- `packages/provisioning/src/first-setup-start-again-confirmation.ts`: `StartAgainSummary` becomes `{ reached, recoveryRecordDamaged?, recovery?, held? }`; `StartAgainRecoveryShown` loses `lastName`; delete `StartAgainUnreadable`, `UNREADABLE_RECORDS`, `unreadableShown`; `startAgainSummary(state)`; the present-database rule (`:184-189`) needs `recovery` only (its comment loses "or goes past damaged name records"). `index.ts`: drop `type StartAgainUnreadable`.
- `apps/server/src/first-setup-resolution.ts`: delete `gatherStartAgainFloor`, `summaryOf`'s floor input, `UNREADABLE_ORDER`, `PUBLIC_RECORD`/`DOCUMENTS` if unused, `type Seat`, `type Floor`, `confirmUnreadable`, `presentPicksOnly`, `picksDamaged` and the `seriesPicksUnreadable` parameter, the `attemptLastWriteMs` import; `stoppedRecovery` keeps its liveness, chain and stopped-phase checks and `host.modules === undefined → unavailable()`, and loses the seat, the picks read, the name and the "name unknown → not ready" refusal. **Keep the recovery-key record read** (Q2 default) as `recoveryRecordDamagedOf(state, originals, modules)`, moved out of `gatherStartAgainFloor:183-196` unchanged: for each frozen module, `readFirstSetupRecoveryDeliverySnapshot`; an `AppError` while the record's bytes are present → damaged; anything else rethrows; called where `gatherStartAgainFloor` was, on the same paths, and with the same "no frozen modules → false" and "modules undefined → `setup.not_ready`" answers.
- `apps/server/src/first-setup-database-holdings.ts`: drop `history` and the "history reader missing" refusal.
- `apps/server/src/setup-first-fiscal-api.ts`: drop `unreadableConfirmation`, `shownUnreadable`, `confirmUnreadable` in the body keys and handler, and `lastName` in the shown-summary and shown-recovery parsers.
- `apps/server/src/errors.ts:1036-1041`: `"setup.start_again_password_required": Record<string, never>`; its doc loses the picks clause.
- Delete `apps/server/src/first-setup-start-again-name-records.ts` and its test; delete `readWellFormedFirstFiscalEvidence` from `apps/server/src/first-fiscal-evidence.ts` if `git grep` shows no other caller.

- [ ] **Step 1: failing tests** (in `apps/server/src/first-setup-start-again-note.test.ts` unless named): (i) database present, a damaged picks file (`damagePicks` from `first-setup-unused-pdf.test.ts:576`, or the fixture at `:1115`), no password → Start again succeeds, deletes the attempt. Fails today: `setup.start_again_password_required` with `seriesPicksUnreadable`. (ii) database missing, a damaged picks file → the summary `toEqual({ reached: "named" })` and Start again with that summary succeeds. Fails today: the summary carries `lastName` and `unreadable`. (iii) `first-setup-start-again-backup.test.ts`: a stopped recovery whose target's picks were removed and whose journal records no input still gets a summary (fails today: `setup.not_ready`, the case at `:590`). (iv) `first-setup-start-again-backup-discard.test.ts:644`'s fixture: a damaged public record beside a stopped recovery → the summary answers and the discard goes ahead (fails today: `setup.attempt_invalid`).
- [ ] **Step 2: controls kept as they are:** a damaged recovery-key record alone still answers `setup.start_again_password_required` with `params: {}` (`first-setup-unused-pdf.test.ts:593`, and `first-setup-start-again-note.test.ts:2097`); with the database missing it still reaches the confirmation with `recoveryRecordDamaged: true` (`:839`, `:850`, `:869`, `:886`); "an attempt naming a module is refused when the host was given no modules to ask" (`:270`) still refuses `setup.not_ready`; a damaged public record or a stray documents file with the database present and no stopped recovery still refuses `setup.not_ready` (the case at `:2015`; if that refusal turns out to have come from the gather, STOP and report).
- [ ] **Step 3: implement.**
- [ ] **Step 4: test changes C21–C35.**
- [ ] **Step 5:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-confirmation.test.ts`; `pnpm --filter @waitron/server exec vitest run` over the files in C21–C35 plus `src/first-setup-resolution.route.test.ts src/start-again-full-disk.e2e.test.ts`; typecheck provisioning and server. Commit. **If this task passes ~100 tool calls, split at Step 4 by file and hand over** (house rule).

## Task 6: a Move raises no floor

**Files:** `packages/provisioning/src/first-setup-start-again-leftovers.ts` (drop `noteFloorMs`, `startAgainSetAsideFloorMs`, `START_AGAIN_FLOOR_MARGIN_MS`, `MINUTE_NS` if unused, the note read); `first-setup-start-again-choice.ts` (drop `noteFloorMs` from the record, its key list and checks); `first-setup-start-again-choose.ts` (stop passing it; comment `:84`); `first-setup-start-again-set-aside.ts` (delete `raiseNoteToRecord` and its two calls); `index.ts:242-244`; `packages/provisioning/test/start-again-attempt.ts` (drop the `note` option); `apps/server/src/recovery-start-again.ts` (`moveFloor` in both languages, `utcMinute` if unused, the paragraph at `:257-258`).

- [ ] **Step 1: failing test** in `first-setup-start-again-set-aside.test.ts`: "a Move on a box holding a leftover note file leaves the file byte for byte and moves the found files": raw bytes in `first-setup-start-again.json`, found files dated hours ahead, Move → the found files are set aside, the note file's bytes and inode are unchanged. Fails today (the note is raised).
- [ ] **Step 2: implement.** In `first-setup-start-again-choose.test.ts`, the three surviving refusal cases that inject their failure through the note module's mock (`:866`, `:879`, `:908`) re-home the same injected error to the next write after the record (mock `finishStartAgainDeletion`, or the set-aside rename); their assertions stay (C38).
- [ ] **Step 3: test changes C36–C42.**
- [ ] **Step 4:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-leftovers.test.ts src/first-setup-start-again-choice.test.ts src/first-setup-start-again-choose.test.ts src/first-setup-start-again-set-aside.test.ts`; `pnpm --filter @waitron/server exec vitest run src/recovery-start-again.test.ts src/first-setup-resolution.boot.test.ts src/first-setup-set-aside-lifetime.test.ts`; typecheck provisioning and server. Commit.

## Task 7: the hour module and the module contract drop the start-again seat

**Files:** `packages/module/src/initial-setup.ts` (delete `startAgainFloor` and `startAgainHistory` with their docs; `startAgainHoldings` stays); `packages/fiscal-verifactu/src/initial-hour-setup.ts` (delete `isNamelessEvidence`, `START_AGAIN_WRITE_MARGIN_MS`, `hourStartAgainFloor`, the seat entries `:422-424`; then delete any import left unused); `hour-configuration.ts:88-90`; `start-again-holdings.ts` (delete `startAgainHistory`, and its helpers if nothing else uses them; `hourHistorySource` stays if `readHourHistory` uses it); `hourInputIdentity` in `allocation-envelope.ts` only if `git grep` shows no remaining non-test caller. Delete `packages/composition/src/start-again-floor.test.ts`.

- [ ] **Step 1:** no behaviour change remains (nothing calls the seat after Task 5): confirm with `git grep -n 'startAgainFloor\|startAgainHistory' -- '*.ts'` before deleting; the only hits must be the definitions and their tests.
- [ ] **Step 2: implement; test changes C43–C46.**
- [ ] **Step 3:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/initial-hour-setup.test.ts src/start-again-holdings.test.ts`; `pnpm --filter @waitron/composition exec vitest run`; typecheck module, fiscal-verifactu, composition, server; the two fiscal gates; `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts`. Commit.

## Task 8a: delete the note module from provisioning

**Files:** delete `packages/provisioning/src/first-setup-start-again-note.ts`; `index.ts:179-185`; `first-setup-state.ts:11`, `:153` (the name leaves `FIRST_SETUP_HOST_FILES`); `first-setup-start-again-deletion.ts` (delete `attemptLastWriteMs`, export `index.ts:202`); `module-preparation-state.ts` (delete `readWellFormedModulePreparations`, export `index.ts:25`, once `git grep` shows no caller); `first-setup-backup-workspace.ts:538` comment. Tests: `git mv packages/provisioning/src/first-setup-start-again-note.test.ts packages/provisioning/src/first-setup-start-again-marker.test.ts` and apply C47; delete `first-setup-start-again-last-write.test.ts` (C48); C49–C51.

- [ ] **Step 1:** `git grep -n -E 'StartAgainNote|START_AGAIN_NOTE_FILE|startAgainFloorSources|attemptLastWriteMs|readWellFormedModulePreparations' -- '*.ts' '*.mjs'` → only this task's files.
- [ ] **Step 2: implement and apply C47–C51.**
- [ ] **Step 3:** `pnpm --filter @waitron/provisioning exec vitest run`  (the whole package: its file list changes); typecheck provisioning and server. Commit.

## Task 8b: the server's note suite becomes the Start again route suite

**Files:** `git mv apps/server/src/first-setup-start-again-note.test.ts apps/server/src/first-setup-start-again.test.ts`; `apps/server/test-durations.json:427` (rename the key; keep the value); C52.

- [ ] **Step 1:** delete the cases that are about the note or A1099 and were not already removed by Tasks 3–5 (C52 lists them by line on `70eeac815`), drop the note imports and helpers, retitle the "lifetime" cases to "… leaves the confirmation record unchanged".
- [ ] **Step 2:** `git grep -n -E 'first-setup-start-again-note\.test' -- . ':!docs/superpowers'` → no hits outside historical plans; `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again.test.ts`; `pnpm exec vitest run scripts/vitest-duration-sequencer.test.mjs scripts/ci-workflow.test.mjs`. Commit.

## Task 9: the setup app drops the damaged-name screens and the series name

**Files:** `apps/setup/src/api/first-setup-types.ts` (`StartAgainSummary`/`StartAgainRecoveryShown` lose `lastName`; delete `unreadable`, `StartAgainUnreadable`, `StartAgainUnreadableRecord`); `api/client.ts:659-669` (`confirmUnreadable`); `first-setup-session.ts` (the summary and recovery validators and `sameSummary` lose `lastName` and `unreadable`; delete `readableUnreadable`, `sameUnreadable`, `damagedRecordSummary`; `retireDamagedRecord` loses its summary parameter); `setup-app.ts` (`#seriesPicksUnreadable`, `firstDamagedSummary`, the `unreadable`/`namesFrom` drawing at `:2536-2538` and `:2708-2717`, the name line at `:2826-2832` → Q1 default); `screens/initial-owner-strings.ts` (delete `reachedName`, `reachedNoName`, `seriesPicksDamaged`, `publicRecordDamaged`, `fiscalDocumentsDamaged`, `namesFrom`, `namesFromText`; add Q1's `reachedNotStarted`: "did not start activation" / «no empezó la activación»). Test helper `apps/setup/test/missing-database-browser.ts`.

- [ ] **Step 1: failing tests** in `setup-app-missing-database.test.ts`: for `reached` `claimed` and `named`, the drawn list is exactly `[t.reachedNotStarted]`; for `fiscal-started`/`fiscal-finished`, exactly the existing activation line; no element names a series. Fails today (the name line). In `setup-app-resolution.test.ts`: a `setup.start_again_password_required` answer with no params after a database-present Start again shows today's recovery-key warning path, and the page never requests a summary (C55's surviving half).
- [ ] **Step 2: implement; test changes C53–C58.**
- [ ] **Step 3:** memory check, then `pnpm --filter @waitron/setup exec vitest run src/first-setup-retirement.test.ts src/setup-app-missing-database.test.ts src/setup-app-missing-database.a11y.test.ts src/setup-app-resolution.test.ts src/setup-app-resolution.a11y.test.ts`; typecheck setup. Look at the missing-database ask in both themes and at phone width (a screenshot from the a11y suite's page is enough). Commit.

## Task 10: the box script and the root guards

**Files:** `deploy/waitron.sh` (`:749` drop `! -name first-setup-start-again.json`; the usage lines `:8`, `:31` and the comment `:743-746` lose the note); `scripts/waitron-sh.test.mjs` (C59); `git mv scripts/start-again-note-writers.test.ts scripts/start-again-records-writers.test.ts` (C60).

- [ ] **Step 1: failing test** in `scripts/waitron-sh.test.mjs`: the plain reset's state clean-up deletes a leftover `first-setup-start-again.json` and keeps the confirmation and choice records, the set-aside folder and `tls` (the case at `:1519-1536` with its expectation inverted for the note only). Fails today.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** `pnpm exec vitest run scripts/waitron-sh.test.mjs scripts/start-again-records-writers.test.ts scripts/backup-room-note.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/personal-log-params.test.ts scripts/english-only.test.ts scripts/claude-md-pointers.test.ts`; prove the renamed guard by deletion (add `first-setup-start-again-choices` to a non-listed source file in a throwaway edit: it must fail; revert). Commit.

## Task 11: documents

Read the receipts across the whole branch range before writing (`CLAUDE.md` §1: a behaviour change retires every receipt about the old behaviour). Every sentence written here is a new claim: point it at a test or `file:line`.

- [ ] `CLAUDE.md` §5, the "Restore and promotion start a new chain" rule (`:806-813`): replace the note clause and its guard with the three rules: "Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation), strictly later than all readable historical names; nothing records used names on disk (owner, 2026-10-29, A1206, retiring A1042's start-again note). Setup/restore wait 90–150 seconds." Keep the rest. Add to §3 Data one line: "**Start again's confirmation and choice records and the set-aside folder are removed only by `waitron.sh reset --all`** (A1042, A1098). Guard: `scripts/start-again-records-writers.test.ts`, weaker than its name: reads text, never what a listed file does." Check §3's spare-space and backup-room lines: they name `waitron.sh reset` and not the note; leave them.
- [ ] `docs/developers/conventions-data.md`: the restore receipt (`:3780-3782`) loses the note and its test; the §5 receipt (`:5078-5100`) states the three rules with their tests (`hour-clock.test.ts` "a name needs a second clock within 30 seconds of the box", `minute-selection-unknown-name.test.ts`, `hour-recovery-host.test.ts` "a backup's own floors", `hour-selection.test.ts` restore wait, and Task 1's case), and the records guard. `conventions-ui.md:1190`, `:1250` (the Move's floor and the survey reading the note) and `workflow-guide.md:336-337`: remove the note. `ci-and-gates.md`: remove the mention `git grep` finds.
- [ ] `docs/backlog/setup.md`: delete the entries "Move the start-again note whenever a series name is put into use…" (`:385`) and "A1145" (`:557`); in "A1142" (`:522`) delete the sentence about a note the survey cannot read. In `## Decisions and deliberate limits`, add, dated and citing the owner: "**DECIDED (owner, 2026-10-29 ~10:38; A1206): no record of used series names is kept on disk.** A new installation name is the box's current UTC minute, taken only after a second clock on another machine agrees within 30 seconds, strictly later than every name in the history the box can still read, after setup's and restore's 90–150 second wait. The start-again note, its floor, A1098's Move floor, A1099's time floor and A1131's name counting are gone. A leftover note file is ignored; `waitron.sh reset` deletes it." Keep the A1042 entry (`:716-747`) and prefix it with "(2026-10-29: superseded by A1206 below — the note is retired; Q1's confirmation records and Q4's reset rule for them remain.)". The A1131bc entry (`:692`) gets "(2026-10-29, A1206: the never-reuse note is retired, so the wipe adds nothing first.)"; the A1131 part-1 line (`:703-706`) loses "the start-again note's floor also covers the database's own series names".
- [ ] `docs/backlog.md`: delete the index lines for A1160 (`:504`), "Move the start-again note…" (`:525`) and A1145 (`:594`); `:582` loses "or a start-again note the box cannot read"; `:637` loses the never-reuse note step; `:4859` (B3) loses the note sentence. `docs/backlog/self-service-refusals.md`: delete the A1160 section (`:716`); `:460` loses its A1099 sentence about the note if it describes the floor. `docs/backlog/replication-cloud.md:326-333`: delete "Every node holds the current start-again note". `docs/backlog/box.md:131` and `:408-409`: delete the note requirements (A950 rollback, reinstall keeps the note).
- [ ] Guides: `apps/server/src/guide/en/backup-recovery.md:44-51` and the Spanish twin: delete the damaged-name paragraph; check the other Start again paragraphs against Q1's wording. Run `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.
- [ ] `apps/server/README.md:51-60`, `deploy/README.md:379`, `:389-394`, `:448`, `docs/operations/first-live-fiscal-setup.md:86-135`: remove the note, the floors and the damaged-name warnings; keep the confirmation records, the Move, and the recovery-key warning.
- [ ] Dated pointer lines (one line each, at the top), because each is an approved design a later build follows: `docs/superpowers/specs/2026-10-27-a950-automatic-upgrades-design.md` ("2026-10-29, A1206: the start-again note is retired; §'s note-preservation requirement no longer applies"), `docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md` ("…the wipe adds nothing to a note"), `docs/superpowers/plans/2026-10-26-b3-usb-installer.md` ("…a reinstall has no note to keep"). No other historical plan or spec is touched.
- [ ] `pnpm exec vitest run scripts/claude-md-pointers.test.ts`; `pnpm exec prettier --check CLAUDE.md apps/server/README.md deploy/README.md`. Commit.

---

## Changed test checks

Line numbers are on `70eeac815`. DELETE: the case goes. NARROW: the named surviving assertion stays, the rest goes. SETUP: only fixtures, helpers or setup change. Every row goes in the PR's "Changed test checks" section.

**Fiscal and setup naming (Tasks 1–3)**
- C1 `apps/server/src/first-setup-start-again-note.test.ts:190` "a start-again with the clock set back behind the abandoned attempt's name is refused…": DELETE. The behaviour it pinned is retired by the owner's decision. Surviving guards: Task 1's case and `:220` "at the abandoned name's own minute, setup waits and then chooses a later name" (kept; its fixture loses `floorMs` and the clock is set from the name's minute). `:227` "a clock past the note chooses a later name at once": NARROW, retitled "a clock past the abandoned name…", the assertion stays.
- C2 `apps/server/src/hour-promotion.test.ts:601`: DELETE, replaced by Task 2's case.
- C3 `apps/server/src/hour-recovery-host.test.ts:834`: DELETE, replaced by Task 2's case. `:851` "a backup whose history is later than the note wins": NARROW — keep the backup `createdAt` refusal (`allowedFromMs` 08:00) with no note, outside the `describe("the start-again note")`; if "a backup's own floors" already asserts the same refusal, DELETE it and name that case in the PR.
- C4 `apps/server/src/first-setup-backup-recovery-preparation.test.ts:620`, `:637` and the helper `noteTenMinutesAhead` (`:610`): DELETE.
- C5 `apps/server/src/first-fiscal-hour-finish.test.ts:271`: NARROW — keep the deletion and the fresh attempt picking `0CNPK`; drop `:299` (the note's name) and the 11:40 `minute_not_later` refusal (`:320`), which came from the note.
- C6 `packages/fiscal-verifactu/src/hour-history.test.ts:256`, `:270` and the helper `startAgainNote` (`:247`): DELETE. `:229` and `:242` (the generic `timeFloorMs`) stay.
- C7 `apps/server/src/first-setup-retired-assignments.test.ts:408`, `:419`, `:438`, `:486`, `:496`: DELETE (each refusal came from the note's floor). `:727` "ordinary hour preparation retains earlier abandoned events for %s": NARROW — keep the "later" row (`event_mismatch`, replay); drop the "reuse" row.

**Start again writes no note (Task 4)**
- C8 `apps/server/test/start-again-deleted.ts`: `startAgainNoteName` deleted; `startAgainUnchanged` keeps its marker check (SETUP for its callers in `first-fiscal-hour-finish.test.ts:341`, `:394`, `first-setup-resolution-inspection.test.ts:121`, `:144`, `:254`, `:299`, `:399`, `:425`, `first-setup-unused-pdf.test.ts:324`–`:568`).
- C9 `first-fiscal-hour.e2e.test.ts:44`: NARROW — drop `:154`, `:173`; keep the restart, the confirmation count and the deletions.
- C10 `first-fiscal-hour-finish.test.ts:470`: NARROW — keep the confirmation record; drop `:519`.
- C11 `first-setup-resolution-inspection.test.ts:330`: NARROW — keep the two deletions; drop `:334`, `:357`.
- C12 `first-setup-start-again-backup.test.ts:201`: NARROW — keep the discard and the lock; drop `:206`. Helpers `expectNothingWritten` (`:149`) and `expectDiscarded` (`:176`) drop their note lines (SETUP for `:211`, `:358`).
- C13 `first-setup-start-again-backup-discard.test.ts:522`: NARROW — drop `:527`, keep the record of who chose. `:932` "when the note cannot be written…": DELETE, unless no other case covers "a failure before the abandon deletes nothing"; then re-hook the same failure on `writeStartAgainConfirmation` and keep its assertions. Helpers `expectNothingWritten` (`:128`), `expectDiscarded` (`:155`) as C12.
- C14 `first-setup-start-again-backup-restart.test.ts:269`: NARROW — keep the finish and the single confirmation; drop `:279-288`. `:292`, `:319`, `:465`: DELETE. `:402`: SETUP — move the interleave hook from `raiseStartAgainNote` to the confirmation write; the `recovery_in_progress` assertion stays. `:703`: NARROW — drop `:771`, `:775-776`, `:792-795`; keep the 409, the restart, the emptying and the confirmation. Helpers `PICKS_NAMING_NOTHING`, `laterInput` go with `:319`/`:465`.
- C15 `first-setup-start-again-damaged-recovery.test.ts:155`: NARROW — drop `:177`; `:187`: SETUP — drop `:195`.
- C16 `first-setup-start-again-held.test.ts:272`, `:296`: NARROW — keep the deletion, the record and the abandon; drop `:284-285`, `:313-314`, and the note in `LEFT_STATE` (`:269`). `:367`: DELETE. Helper `expectStartAgainRefused` (`:251`) drops its note line; `floorOf` (`:264`) goes.
- C17 `first-setup-unused-pdf.test.ts:83`, `:168`, `:177`, `:459`: NARROW — drop `:89`, `:175`, `:186`, `:474`; the deletions stay. `:95`: DELETE. `:249`: NARROW — keep up to `:268`.
- C18 `first-setup-retired-assignments.test.ts:520`: NARROW — keep the same folders and `expectStartAgainDeleted`; drop `:522`, `:525`, `:555`. Helper `expectStartAgainRefused` (`:380`) drops its note line.
- C19 `start-again-full-disk.e2e.test.ts:165`, `:201`, `:280`: NARROW — drop `:198`, `:236`, `:316` (the `lastName` checks go in Task 5).
- C20 `first-setup-start-again-note.test.ts:261` "…starts again without a note", `:282` "two Start again requests at once raise the note once", `:2518` "Start again leaves the note and the confirmation folder in place" and the "lifetime" cases `:2824`, `:2870`, `:2914`, `:2930`: NARROW — keep "the confirmation record unchanged" and "the confirmation folder in place"; for `:282` keep that the second request is refused or joins and only one deletion happens, drop the note. `:2832`, `:2961`: DELETE.

**Start again reads no name records (Task 5)**
- C21 `apps/server/src/first-setup-start-again-name-records.test.ts`: whole file DELETE (12 cases on `readSeriesPicks`/`seriesPicksUnreadable`).
- C22 `first-setup-start-again-note.test.ts` A1099 cases `:724`, `:762`, `:995`–`:1889` (except `:1630`) and `:2068`: DELETE. `:1951`, `:1974`, `:1996`, `:2015`, `:2035` keep their refusals unchanged (`setup.owner_required`, `setup.attempt_conflict`, `setup.not_ready`); the damaged picks file beside them becomes irrelevant context and stays. `:1630` (a summary read fault → `setup.not_ready`): NARROW — rebuild its setup on a stopped recovery instead of damaged picks; the `setup.not_ready` assertion stays. `:463`, `:629`, `:2173`: NARROW — drop `lastName`; `reached` and the rest stay.
- C23 `first-setup-start-again-backup.test.ts:332`, `:437`, `:460`, `:674`, `:696`: NARROW — drop `lastName` from the expected `recovery`; keep the times, `failed`, `cloud`. `:489`, `:502`, `:557`, `:571`, `:590`, `:649`: DELETE (how `recovery.lastName` was worked out, and the seat). `:732` "host lists no modules refuses the summary": kept unchanged (the refusal stays). Helpers `removeTargetPicks`, `appendInput`, `laterInput` go.
- C24 `first-setup-start-again-backup-discard.test.ts:573`, `:589`, `:605`, `:625`, `:777`: DELETE. `:644`: DELETE, replaced by Task 5's case (iv). `:748`: NARROW — drop the "damaged" row. `:359`: NARROW — assert `recovery` is defined, not its `lastName`. `:725`: SETUP. Helpers `damagedPicksDiscard`, `stampTree` go; `:867` drops `lastName`.
- C25 `first-setup-start-again-held.test.ts:126`: NARROW — keep `held` and `recovery`, drop `lastName`. Helper `handMade` (`:434`) drops `lastName`.
- C26 `first-setup-start-again-damaged-recovery.test.ts:155`: NARROW — drop `recovery.lastName` (`:159`).
- C27 `first-setup-retired-assignments.test.ts:557`, `:566`, `:572`, `:578`, `:592`, `:600`, `:625`, `:633`, `:646`, `:668`, `:686`: DELETE. `:609`: NARROW — keep `recoveryRecordDamaged: true`; drop `lastName` and `:615`. `:618`, `:659`, `:816`: SETUP. Helpers `expectTimeFloorNote`, `expectNoteBounds`, `STAMP_AT_MS`, `TIME_FLOOR_MS`, `stampTree` and the fixture options `stampAtMs`/`stray`/`legacy` go.
- C28 `first-setup-unused-pdf.test.ts:581`, `:603` and helper `damagePicks`: DELETE (move `damagePicks` into Task 5's case (i) first if used there). `:249`, `:310`: NARROW — drop `lastName`s.
- C29 `first-setup-resolution.route.test.ts:37`: NARROW — the expected `shown` (`:121-125`) loses `lastName`; the confirmation record stays. `:297`: SETUP.
- C30 `first-fiscal-hour-finish.test.ts:530` and helper `hourShown` (`:522`): SETUP — drop `lastName`. `:470`: drop `lastName` from `shown`.
- C31 `first-setup-resolution-inspection.test.ts:182`: NARROW — `:234` drops `lastName`; `reached: "named"` and the record stay.
- C32 `start-again-full-disk.e2e.test.ts:165`, `:201`: drop the `recovery.lastName` checks; keep `failed: true` and the rest.
- C33 `packages/provisioning/src/first-setup-start-again-confirmation.test.ts`: `:68`, `:264`, `:322`, `:349`, `:362`, `:378`: DELETE. `:39` (expect `{ reached }`), `:89` (keys `["reached"]`), `:173` (drop the numeric-name row, drop `lastName` from `:180`), `:205` (keys `["reached","recoveryRecordDamaged"]`), `:243` (drop `"lastName"` from both key lists), `:273` (drop rows `:278-280`): NARROW. Fixtures `:85`, `:238` lose `lastName`; `:317` goes.
- C34 `apps/server/src/first-setup-start-again-note.test.ts:2140`, `:903`, `:922`, `:839`–`:886`: kept; fixtures lose `lastName`.
- C35 `first-setup-database-holdings` callers in `first-setup-start-again-held.test.ts`: the `history` field disappears from any expected holdings (SETUP).

**A Move raises no floor (Task 6)**
- C36 `first-setup-start-again-leftovers.test.ts:332`, `:358`, `:369`, `:382`: DELETE (the `units` check in `:382` is covered by the survey cases that list `first-setup-workspaces`).
- C37 `first-setup-start-again-choice.test.ts:84` (drop the three `noteFloorMs` rows `:97-99`), `:322` (drop `{noteFloorMs:-5}`; the path checks stay; retitled "paths in a record stay inside their folders"): NARROW. Helpers `choice()`/`keep()` drop the field (SETUP for the rest).
- C38 `first-setup-start-again-choose.test.ts:592`: NARROW — keep "one record exists at the first rename"; drop the note checks; retitled. `:849`: DELETE. `:866`, `:879`, `:908`: SETUP — the same error injected after the record by another seam (Task 6 Step 2); `move failed: <errno>` and the path-relative assertions stay; `:908`'s expected `state/note/x.json` becomes the re-homed path. `:552`, `:626`: SETUP. The note-module mock (`:60-87`, `:97`) goes.
- C39 `first-setup-start-again-set-aside.test.ts:421`, `:873`: DELETE. `:453`: NARROW — keep the negative `mtimeNs` recorded and moved; drop the note. `:529`, `:1265`, `:1461`: SETUP. Fixture `prepared()` (`:137`) drops `noteFloorMs`.
- C40 `apps/server/src/recovery-start-again.test.ts:343`, `:365`: DELETE. `:388`: NARROW — `sample` drops `moveFloor`; the every-key-differs check stays.
- C41 `apps/server/src/first-setup-resolution.boot.test.ts:836`: NARROW — keep the set-aside path, the bytes, the single restart and setup served; drop the note, the file-time stamping and `:882`. `:790`: SETUP. Helper `foundFilesBox(note?)` drops the parameter.
- C42 `apps/server/src/first-setup-set-aside-lifetime.test.ts:296`: DELETE. Helpers `movedBox` (drop the note option and `:135`), `kept` (drop the note walk `:160`), `NOTE_FLOOR_MS`: SETUP for `:173`, `:181`, `:212`, `:249`.

**The seat (Task 7)**
- C43 `packages/fiscal-verifactu/src/initial-hour-setup.test.ts:1006`, `:1017`, `:1037`, `:1062`, `:1071`, `:1081`, `:1103`, `:1120`, `:1132`, `:1148`, `:1230`, `:1250`, `:1307`, `:1344`, `:1372`, `:1382`, `:1394`: DELETE, with helpers `hourEvidence`, `selectedIntents`, `recoveryInput`, `databaseRecord`, `databaseSource`, `historyInvalid`. `:1166`: NARROW — keep `retainedAssignments(...).positions` length 2 (`:1206`); drop the seat check (`:1207-1209`).
- C44 `packages/fiscal-verifactu/src/start-again-holdings.test.ts`: `describe("startAgainHistory")` (`:125-282`) DELETE; the `startAgainHoldings` cases stay.
- C45 `packages/composition/src/start-again-floor.test.ts`: whole file DELETE (one case).
- C46 any module-contract test naming `startAgainFloor`: none on `70eeac815` (`git grep`).

**Provisioning and server clean-up (Task 8)**
- C47 `packages/provisioning/src/first-setup-start-again-note.test.ts` → `first-setup-start-again-marker.test.ts`: the 18 note-module cases (`:48-355`) DELETE; the 37 marker/deletion/kept-state cases stay. `:748` "a marker that names %s:%s is refused…": NARROW — drop the `START_AGAIN_NOTE_FILE` row (`:749`). SETUP: `attemptFolders()` raises no note (`:410`); `expectOnlyKept()` (`:438-452`) no longer expects or reads the note; `KEPT_STATE` keeps the confirmations and `tls`.
- C48 `packages/provisioning/src/first-setup-start-again-last-write.test.ts`: whole file DELETE (8 cases on `attemptLastWriteMs`).
- C49 `packages/provisioning/src/first-setup-backup-workspace.test.ts:937`: NARROW — drop the "series-name note" row; the confirmation and attempt-file rows stay.
- C50 `packages/provisioning/src/first-setup-host-path.test.ts:4`: NARROW — drop `"first-setup-start-again.json"` (`:16`).
- C51 `apps/server/src/first-setup-entry.test.ts:372`, `apps/server/src/restore.test.ts:285`, `apps/server/src/backup-data-placement.test.ts:293`: NARROW — drop the note-file row; the other reserved names stay.
- C52 `apps/server/src/first-setup-start-again-note.test.ts` → `first-setup-start-again.test.ts`: whatever of C1, C20 and C22's DELETE rows is still there DELETE; the surviving cases (missing-database confirmation `:404`–`:521`, ordering `:552` — keep "confirmation → marker → first deletion", drop "the note before the marker" —, route shapes `:592`, `:629`, `:678`, `:903`, `:922`, the recovery-key record `:839`–`:886`, `:2097`, `:2122`, `:2140`, the surviving refusals `:1630`, `:1951`–`:2035`, deletion `:2173`–`:2537`, `:2755`, `:2778`, records `:2518`, `:2824`–`:2930`) move with the file.

**Setup app (Task 9)**
- C53 `apps/setup/test/missing-database-browser.ts`: `namedSummary` loses `lastName`; `namesFloorMs`, `namesDamagedSummary` go; `stoppedRecovery.lastName` goes (SETUP).
- C54 `apps/setup/src/first-setup-retirement.test.ts:179`, `:187`, `:199`, `:208`, `:309`, `:447`, `:456`, `:474`, `:498`: DELETE. `:130` (the conflict refusal stays, the difference becomes `reached`), `:139` (drop the `lastName: ""` row), `:506` (keep the recovery-key-record-only row), `:539` (keep the `confirmRecoveryDiscard` check without `unreadable`, or DELETE if `:625` covers it — name which): NARROW. Others SETUP.
- C55 `apps/setup/src/setup-app-resolution.test.ts:790`, `:828`, `:852`, `:866`, `:882`, `:1688`: DELETE. `:919`: NARROW — keep "reads no summary" and today's warning; drop the name-record/names-from checks. `:1613`, `:1657`, `:1832`: SETUP.
- C56 `apps/setup/src/setup-app-missing-database.test.ts:246`, `:260`, `:527`, `:550`, `:564`, `:577`, `:585`, `:596`: DELETE (the series-name line and the damaged-name lines), replaced by Task 9's failing test. `:55`, `:103`, `:272`, `:695`: NARROW — the activation and recovery lines stay; the name line goes. Helper `askLines` (`:235`) follows Q1.
- C57 `apps/setup/src/setup-app-resolution.a11y.test.ts:220` (damaged names): DELETE; `:352`: SETUP.
- C58 `apps/setup/src/setup-app-missing-database.a11y.test.ts:38`, `:114`: SETUP.

**Box script and guards (Task 10)**
- C59 `scripts/waitron-sh.test.mjs:1471` and `:1498`: NARROW — the confirmation records, choice records and set-aside folder are still spared; the note is no longer named (retitled). `:1519-1536`: the note file is now expected deleted (Task 10's failing test). `:1597`: the assertion that `--all` does not spare the note stays true and is deleted as redundant only if it reads nothing else. `:1706`: NARROW — retitled, the records half stays.
- C60 `scripts/start-again-note-writers.test.ts` → `scripts/start-again-records-writers.test.ts`: NARROW — `NAMES` loses `first-setup-start-again\.json` and `START_AGAIN_NOTE_FILE`; `ALLOWED` loses `first-setup-start-again-note.ts`; the header comment states the records/set-aside rule only. The check on the confirmation, choice and set-aside names stays.

## Plan review and claim checks

Before dispatch: a fresh-context Opus review of this plan against the queue entry and the owner's words, then a round-3 claim check of whatever the review's folds changed (house rule: corrections breed false claims). After the build: the full `/finish-branch` wave with the Codex run-it seat twice; the PR carries the open questions Q1–Q2, the behaviour changes above, the stale-file and choice-record lines, and the Changed test checks, and parks `needs-owner-review`.

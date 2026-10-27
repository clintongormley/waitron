# A1099: a damaged record of an attempt's series names no longer blocks Start again — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`; one that passes about 150 tool calls with its task unfinished stops at a passing (or cleanly failing) point, commits, and hands over.

**Revision 2 (fresh-context plan review folded, 2026-10-27).** Important findings I1–I6 and minors M1–M9 are folded where each task names them. The splits: Task 6 → 6a/6b, Task 10 → 10a/10b, Task 16 → 16a/16b, Task 18 → 18a/18b. The password refusal's flag is renamed `seriesPicksUnreadable` (I3). Task 18b files five backlog entries.

**Owner points for the PR** (none blocks the build; each is built as stated and listed in the PR for the owner):
1. **The floor follows the password step.** Entering the setup password rewrites files on the design's list, so "New series names can start from" usually shows a time about 3 minutes after the password, not the attempt's last write (difference D-3, R-1).
2. **With the database present, only a damaged kept picks file gets the way out.** A public record or a documents file refuses there whether damaged or intact; it becomes backlog entry (iv) (D-4, R-2).
3. **The wait line's date words are derived, not approved:** "You can carry on from {date}, {time}." / «Podrás seguir a partir del {date} a las {time}.» (D-9, R-4).
4. **"Chose no invoice series name" can sit beside "the record of the invoice series names it chose is damaged"** when the only copy of the name was in the damaged picks file (D-6, R-3).
5. **An older note's later floor is shown as an earlier time.** The page shows this attempt's floor; the box enforces the later one and its own wait line names it (R-5).

**Goal.** When one of an abandoned first-setup attempt's **name records** is damaged, Start again stops dead-ending. The repair page says which record is damaged, that Start again deletes this attempt and its series names will not be used again, and from when new names can start. Start again then keeps a note saying "name unknown" with a **time floor**: the start of the minute after (the newest file time among the attempt's own files and folders + 150 seconds). From then on the box refuses any series name at or before that floor, and waits when the floor is still to come. With the venue database present, the setup password is asked first.

Words used in this plan:
- **Name record:** a file Start again reads to find which invoice series names the attempt used. There are three: the kept picks file (`state/module-preparation-state.json`, every name the chooser picked), the public fiscal record (`state/module-operation-public.json`), and the fiscal documents (`state/first-fiscal-documents/<module>.json` and its parts). A fourth case is evidence that reads as JSON but that the hour module cannot use, or a stray file in the documents folder.
- **File time:** the "modified" time the operating system stamps on a file or folder when it is written (`mtime`).
- **Floor:** the first minute from which a new series name may be chosen. The note stores it as `floorMs`.
- **The note:** `state/first-setup-start-again.json`, the one small file Start again keeps.
- **The summary:** what the repair page shows before Start again (`StartAgainSummary`). The page sends back exactly what it showed (`shown`), and the box refuses Start again if that differs from what it reads now. That comparison is the proof the person was told.
- **The chooser:** the code that picks a new series name (`createHourSelection`, `packages/fiscal-verifactu/src/hour-selection.ts`).
- **The seat:** the hour module's `startAgainFloor` function, which turns the records Start again read into a floor (`hourStartAgainFloor`, `packages/fiscal-verifactu/src/initial-hour-setup.ts:139-179`).

**Owner approval.** The design is `~/waitron-campaign/a1099-damaged-evidence-design.md`, approved AS WRITTEN on 2026-10-25 at 15:24 CET ("A1042 damaged: A", `~/waitron-campaign/questions.md`, heading "OWNER ANSWER — A1042 damaged: A"). The approved English and Spanish words are the design's §D3 table and are used here unchanged. Queue entry: A1099 in `~/waitron-campaign/queue.md`.

**Review path: FULL.** Risk triggers: invoice series names (a name can never be reused), and a cross-package contract (the module seat `startAgainFloor` in `packages/module/src/initial-setup.ts`). The `/finish-branch` Codex run-it seat runs twice (the second angle sets this checklist aside).

**Parks for the owner to land** (series names are fiscal). The PR ends `needs-owner-review`.

**Fiscal gates.** These must pass UNEDITED after every task that touches `packages/fiscal-verifactu` and at the end:
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` (the golden hash, `huella`)
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`

No task changes `computeHuella`, the chain, invoice-number allocation, `registros_facturacion`, `recordSale`/`recordCorrection`/`recordSubstitution`, `registerSif` or `restoreFiscal`. No task changes `hour-selection.ts` (the chooser); its new cases are tests only. Changing the hour module's start-again seat (design T3) is approved and is not the fiscal core.

**No migration.** Confirmed: no task touches a schema, a `drizzle` folder or a migration set. The note and the confirmation record are JSON files in the state folder. The note's new `lastName: null` needs no conversion code: no venue is live (`CLAUDE.md` §3, "No backwards-compatibility or data-migration code until Waitron is in production").

**Global constraints (every task).**
- General code is English only. Spanish appears only in the setup app's string tables (`apps/setup/src/screens/initial-owner-strings.ts`) and in `packages/fiscal-verifactu` (exempt).
- Error codes name domain concepts. This plan adds **no** new error code. It adds one optional parameter, `seriesPicksUnreadable`, to the existing `setup.start_again_password_required` (Task 8). Not `seriesNames…`: `scripts/personal-log-params.test.ts`'s word list holds `name`, matched without regard to case (review I3).
- When a task makes a comment false, it deletes or corrects that comment in the same commit; each task names the ones known (review M4).
- **"The module set"** everywhere in this plan means what `gatherStartAgainFloor` reads: the attempt's own frozen modules (`state` and `state.previous`) that have a `startAgainFloor` seat (`first-setup-resolution.ts:83-92`), never every installed module (review I5).
- Every commit `git commit -s`. Stage explicit paths only.
- Test-first: write the failing test, run it, see it fail for the stated reason, then implement.
- **Any edit to an existing assertion not on the list below is a STOP.** Setup, fixtures and mocks may change; what a test checks may not. If a task finds it must change one, it stops and reports.
- Browser-mode suites (`apps/setup`, `packages/fiscal-verifactu`'s `*.browser.test.ts`) run real headless Chromium. Check `memory_pressure | grep free` first; beside another session only well above 15% free.
- Unset `AI_AGENT` and `CLAUDECODE` to see a passing test's console output. A run with no `Tests` count is not evidence.

**Approved assertion changes** (design §4 T4, re-checked against `b8a06f203`; these are the only existing assertions that may be edited):
1. `apps/server/src/first-setup-retired-assignments.test.ts:593-602`, "a damaged recovery document beside another file in the documents folder still refuses with a domain refusal". Becomes: reaches the confirmation; the summary has `recoveryRecordDamaged: true` and `unreadable.records` `["fiscal-documents"]`; the note takes the time floor.
2. `:603-612`, "a damaged recovery document beside invalid public evidence still refuses with a domain refusal". Becomes the same with `unreadable.records` `["public-record"]`.
3. `:622-631`, "invalid public evidence refuses Start again with a domain refusal" rows 0–2. Becomes: reaches the confirmation; `unreadable.records` `["public-record"]`; the note takes the time floor.

All three are edited in Task 6b.

The design's T5 also allowed changes to `apps/server/src/first-setup-unused-pdf.test.ts`. Under this plan's database-present adaptation (difference D-4 below) **none of its assertions change**: its "other damaged evidence (key, stage, unknown-input, orphan-document) still refuses `setup.not_ready`" rows (`:518-548`) keep passing as written. If one must change, STOP.

**Baseline on `b8a06f203`** (run 2026-10-27 in this worktree, `AI_AGENT`/`CLAUDECODE` unset):
- `pnpm --filter @waitron/server exec vitest run src/first-setup-retired-assignments.test.ts` → `Tests 40 passed (40)`.
- `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts src/first-setup-unused-pdf.test.ts src/first-setup-start-again-damaged-recovery.test.ts src/first-setup-start-again-backup-discard.test.ts` → `Tests 130 passed (130)`.
- `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-note.test.ts` → `Tests 142 passed (142)` (the design saw 139; A1098 added 3).
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/initial-hour-setup.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts` → `Tests 116 passed (116)`.

---

## Where the code now differs from the design, and what this plan does about it

The design's line references were read at A1042's branch tip `7806c4b9b`. A1042 (#2101) and A1098 (#2131) have since landed, and `7806c4b9b` is not an ancestor of `main` (squash merge). Every reference below was re-read at `b8a06f203`.

**Experiments run for this plan** (the design's probe, copied to `/tmp/a1099-probe.oJq3XX/probe.test.ts` with its imports pointed at this worktree; run from `apps/server` with `./node_modules/.bin/vitest run --config /tmp/a1099-probe.oJq3XX/vitest.config.mjs -t "<name>"`):
- **PROBE 2/3 (the design's F1 matrix), re-run.** Database missing: damaged `first-setup.json` and `first-setup-claim.json` → `setup.owner_required` at the password step; damaged kept picks file → `setup.attempt_invalid` at the summary; a damaged public record (created) → `setup.attempt_invalid` at the summary; damaged node key, damaged (created) `fiscal-verifactu.json` with the recovery record present, damaged recovery record → Start again succeeds, note `{"lastName":"0CNNY",...}`; a damaged (created) note → refused at Start again, `setup.attempt_invalid`. Database present (no password): damaged `first-setup.json`/claim → `setup.attempt_conflict`; damaged picks → `setup.attempt_invalid`; public record, node key, `fiscal-verifactu.json` → `setup.not_ready`; **damaged recovery record → `setup.start_again_password_required`** (the design saw `setup.not_ready`: A1042's database-present S7l work has landed); damaged note → `setup.attempt_invalid`. Everything else matches F1.
- **PROBE 4–7 (the design's F5), re-run.** Same results as the design: with no time floor, a clock at 13:40 chose `0CNSP = 13:42`, the lost name's minute; with a time-only floor of 13:43 it was refused `minute_not_later` with `allowedFromMs` = 13:43. A clock past the known name with an ahead floor was refused at the floor; the control chose 11:50 after setup's own wait. So the chooser needs no change.
- **PROBE 8 (new): what the password step writes.** Failing case for "the password step leaves the listed files alone": `first-setup.json` keeps the old time. Every file and folder was first stamped 2 h back with `utimes`. After the password step: `first-setup.json`, `venue/first-setup-claim.json` and every file and folder under `state/first-setup-resolutions/<uuid>/` showed new times; the kept picks file, the node key and `first-fiscal-documents/` were unchanged.
- **PROBE 9 (new): with the database present, an intact public record alone refuses.** Writing a valid, empty `module-operation-public.json` (`{"version":1,"modules":{},"history":[]}`) made a password-free Start again answer `setup.not_ready`; the control without it succeeded.
- **PROBE 10 (new): reading moves no file time.** With every file stamped to a known time after the password step, two summaries and a Start again refused at the `shown` comparison (`setup.attempt_conflict`) left every file and folder time in the state and venue folders unchanged (database missing). The failing case would have listed a moved item.

Differences, each with how the plan adapts:

- **D-1. File paths.** `first-fiscal-evidence.ts`, `first-fiscal-delivery.ts`, `first-setup-resolution.ts` and `setup-first-fiscal-api.ts` are in `apps/server/src/`, not `packages/provisioning`. `gatherStartAgainFloor` is `apps/server/src/first-setup-resolution.ts:76-131`. Its readers are now: public record `:93`, recovery record `:94-113` (A1042's S7l catch), delivery `:114-115`, kept picks `:124`, seat call `:117-126`. The deep-equality check is `:433-440`; the route parser is `shownSummary`, `setup-first-fiscal-api.ts:86-105`, and the Start again route `:934-995`. The confirmation record is `packages/provisioning/src/first-setup-start-again-confirmation.ts`. The note module is `packages/provisioning/src/first-setup-start-again-note.ts`, parser `:23-49`.
- **D-2. The deletion list changed.** `itemsOnDisk` is now `packages/provisioning/src/first-setup-start-again-deletion.ts:264-318`. It now also lists `venue/node.db` and its side files, and handles a kept backup recovery folder (`first-setup-resolutions/backup-recovery`), which is skipped when abandoned or being discarded, and throws when it is neither. The plan reads file times from exactly this list (as the design says), skipping the databases (`venue.db`, `node.db`) and side files, and passes the same `discarding` option Start again passes, so a kept backup recovery is never counted.
- **D-3. The floor follows the password step (PROBE 8).** The design's list (D1) includes `first-setup.json`, the claim and the ownership-recovery records, and the password step rewrites all three. So in practice the floor is never earlier than the start of the minute after (the moment the person entered the password + 150 seconds). The design's Example 1 ("pressed Start again at 15:05 … new series names can start from 14:54") would read about 15:08 instead. This is the safe direction and is what D1 says, so the plan builds D1 unchanged and lists it for the owner (Risks, R-1). With honest clocks the new setup then waits up to about 3½ minutes after the password instead of its usual 1½–2½.
- **D-4. The database-present path can only meet a damaged kept picks file.** With the database present, Start again is allowed only for a provably unused attempt (`firstSetupUnusedAssignment`, `apps/server/src/first-setup-unused-assignment.ts:44-62`, and `noOtherHistory`, `first-setup-resolution.ts:359-365`). Both refuse when a public record or an unexpected documents file exists **at all**, damaged or not (PROBE 9, and the approved "orphan-document" row at `first-setup-unused-pdf.test.ts:518-548`). The kept picks file is not part of that proof: the inspection does not list it, so it is read only by the floor, and today a damaged one refuses `setup.attempt_invalid` there (PROBE 3). So on this path the plan turns only a damaged or unusable kept picks file into the way out. A damaged public record or documents file keeps today's `setup.not_ready`, exactly as an intact one does (Risks, R-2); Task 18b files it as backlog entry (iv).
- **D-5. With the database present there is no summary today, and the page learns about damage from a refusal.** On that path the page first sends Start again without a password; the box answers `setup.start_again_password_required` (403); the page infers a damaged recovery-key record, asks for the password, then shows the warning and sends `recoveryRecordDamagedShown: true` (`apps/setup/src/setup-app.ts:1427-1441`, `:1491-1523`; `first-setup-session.ts:702-723`). The summary route refuses `setup.not_ready` when the database is present and no stopped backup recovery is found (`first-setup-resolution.ts:304`), and the confirmation record refuses `database: "present"` without a stopped recovery (`first-setup-start-again-confirmation.ts:111-112`). The design's "the same `unreadable` summary … travels in `shown` and in the confirmation record" therefore needs, on this path: (a) the password refusal to say a name record is damaged, as an optional parameter `{ seriesPicksUnreadable: true }`; (b) the summary route to answer, after the password, when the kept picks file is damaged; (c) a new Start again field `confirmUnreadable: { shown }`, compared exactly like the others; (d) the confirmation record to accept `database: "present"` when `shown` holds `unreadable`. A damaged recovery-key record alone keeps today's flow and request unchanged.
- **D-6. What the summary's own `lastName` shows.** The page's "Its record says it: chose the invoice series name {name}" reads `summary.lastName`. If it took the note's `lastName`, a time floor later than the attempt's own name would make the page say "chose no invoice series name" while `first-setup.json` names one. The plan keeps `summary.lastName` as the latest name the readable records show (exactly what it is today), and gives the note `lastName: null` when the time floor is later (design D2). An undamaged summary is unchanged.
- **D-7. A1098 already uses the same margin.** `START_AGAIN_FLOOR_MARGIN_MS = 150_000` and `startAgainSetAsideFloorMs` (`packages/provisioning/src/first-setup-start-again-leftovers.ts:48`, `:87-98`) give a Move's floor as the first whole minute at least 150 s after the newest moved file. `packages/fiscal-verifactu` does not depend on `@waitron/provisioning` (its `package.json`), so the seat keeps its own constant, as the design places it (D2, T3). The design's rounding is "the start of the minute after (last write + 150 s)", which is one minute later than A1098's only when last write + 150 s falls exactly on a minute. Both are safe; this plan uses the design's, never A1098's. Worked: a last write at 15:42:30.000 gives 15:42:30 + 150 s = 15:45:00.000, so the design's floor is 15:46 (A1098's would be 15:45); at 15:42:29.999 both give 15:45 (Task 3, review I1).
- **D-8. The note's floor sources** now carry `complete: true` (`first-setup-start-again-note.ts:73-82`); the chooser still never reads `lastName`. The three naming paths that read the note are now `packages/provisioning/src/first-setup-runtime.ts:231`, `apps/server/src/recovery-preparation.ts:211` and `apps/server/src/node-operation-preparation.ts:101`, all through `readStartAgainFloors` (`packages/provisioning/src/box-folders.ts:25-29`).
- **D-9. The wait line's date (design T8).** Four existing assertions expect "You can carry on from 22:04." for a floor of 2026-10-18 while the real date is later (`packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts:512`, `:1162`; `recovery-hour.browser.test.ts:843`, `:1052`; their fake timers do not fake `Date`). A rule "add the date when the floor is not today" would edit them. The plan adds the date when the floor falls on a **later** day than today in the venue's time zone. That is the only case that happens in use (the chooser names a floor only when it is in the future) and leaves those four untouched. The English and Spanish date words are not in the design's table; Task 15 derives them from the approved `namesFrom` pattern and the PR lists them for the owner (R-4).
- **D-10. Other line moves, no behaviour change:** `hourStartAgainFloor` `:139-179` (was `:138-174`), `isNamelessEvidence` `:122-138`; `readModulePreparationHistory` `module-preparation-state.ts:73-83`, parse `:44-62`, `setup.attempt_invalid` `:29-31`; shell words `apps/setup/src/i18n/strings/shell.ts:8`, `:31`, mapped at `apps/setup/src/setup-app.ts:224`, `:250`; outside evidence refusal `first-setup-resolution.ts:392-393`; unreadable database refusal `:358`. `hour-selection.ts`, `hour-history.ts` and `setup/clock-wait.ts` are unchanged since `7806c4b9b` (`git diff --stat 7806c4b9b HEAD` lists none of them), so the design's lines in them still hold.
- **D-11. Backlog.** There is no A1099 entry in `docs/backlog.md` or `docs/backlog/setup.md`. Both mention A1099 only as what **A1145** ("a Move on a box with no start-again note raises no series-name floor") waits for (`docs/backlog.md:503-505`, `docs/backlog/setup.md:539-548`). Task 18b updates A1145 to say the "name unknown" note now exists; building A1145 itself is not in this item's approval.

**STOP findings:** none. Nothing the design needs is impossible, and nothing changes a fiscal core function.

---

## Guards (design §3) mapped to tasks

| Guard | What it checks | Task |
|---|---|---|
| G1 | damaged kept picks file stamped 2 h after the name → note `{lastName: null, floorMs: minute after (stamp + 150 s)}`; control: same stamps, undamaged → today's note | 6a (database missing), 11 (present) |
| G2 | next setup at floor − 3 min refused with `allowedFromMs` = floor; at floor − 1 min waits then picks later than the lost minute; control: past floor, one move | 14 |
| G3 | two listed files, damaged one lowered, node key at +2 h → floor from +2 h; control: both lowered | 2 |
| G4 | chooser with a pick at T and clock at T − 10 min writes nothing; control: a write at T + 1 min | 4 |
| G5 | database present, `-shm` touched between summary and Start again → same floor, success; control: a listed file's time moved → `setup.attempt_conflict` | 11 |
| G6 | `shown` lacking `unreadable` or with another floor → `setup.attempt_conflict`, nothing written; route takes the field only in its exact shape; control: exact `shown` succeeds and the record holds it | 7 (missing), 10a and 10b (present) |
| G7 | X1, X2, X4, X5 keep today's codes; a damaged name record beside outside evidence still refuses | 6b |
| G8 | note parser: `null` accepted; `""` and a missing key refused; a `null` note never lowers a known one | 1 |
| G9 | the wait line shows the date for a later day, in English and Spanish; control: later today shows the time alone | 15 |

---

## Tasks

Order: 0 → 1 → 2 → 3 → 4 → 5 → 6a → 6b → 7 → 8 → 9 → 10a → 10b → 11 → 12 → 13 → 14 → 15 → 16a → 16b → 17 → 18a → 18b → 19. Tasks 1, 2, 3 and 4 touch different packages; run them in order unless the driver merges parallel worktrees. Tasks 12–13 depend on 7, 10a and 10b. Task 14 depends on 6a. Task 15 is independent of 5–14.

**Size check (review I6).** Each task below is written to finish well under about 100 tool calls. The largest are 6a, 6b, 10b and 16a, at an estimated 50–80 calls each: one production function, a handful of new cases and one or two focused suites. The rest are smaller. An implementer that passes about 100 calls stops at a passing point, commits and hands over.

### Task 0 (driver, not an implementer): re-check the base

- [ ] **Step 1.** `git -C <worktree> fetch origin && git -C <worktree> log --oneline -1 origin/main`. If `main` has moved past `b8a06f203`, run `git diff --stat b8a06f203 origin/main -- apps/server/src/first-setup-resolution.ts apps/server/src/first-fiscal-evidence.ts apps/server/src/first-fiscal-delivery.ts apps/server/src/first-setup-unused-assignment.ts apps/server/src/setup-first-fiscal-api.ts apps/server/src/errors.ts packages/provisioning/src/first-setup-start-again-note.ts packages/provisioning/src/first-setup-start-again-deletion.ts packages/provisioning/src/first-setup-start-again-confirmation.ts packages/fiscal-verifactu/src/initial-hour-setup.ts packages/fiscal-verifactu/src/hour-selection.ts packages/fiscal-verifactu/src/setup/clock-wait.ts packages/module/src/initial-setup.ts apps/setup/src/setup-app.ts apps/setup/src/first-setup-session.ts apps/setup/src/api/client.ts apps/setup/src/screens/initial-owner-strings.ts scripts/personal-log-params.test.ts`. For each file listed, re-read the lines this plan cites and correct the plan before dispatch; rebase the branch.
- [ ] **Step 2.** Re-run the baseline commands above; the counts must match.

### Task 1 (provisioning): the note can hold an unknown name — G8

**Files:** `packages/provisioning/src/first-setup-start-again-note.ts:16-49` (type `StartAgainNote.lastName`, `parseNote`); test `packages/provisioning/src/first-setup-start-again-note.test.ts` (add cases only; the refusal table is `:94-128`, the round-trip `:59-79`, "raising never lowers" `:80-93`). Type ripple only: `apps/server/test/start-again-deleted.ts:39-41` (`startAgainNoteName` returns `string | null | undefined`).

- [ ] **Step 1: failing tests.**
  - "a note whose name is unknown round-trips": `raiseStartAgainNote(dir, { floorMs: 1792150980000, lastName: null, module: "fiscal-verifactu" })`, then `readStartAgainNote(dir)` `toEqual({ version: 1, floorMs: 1792150980000, lastName: null, module: "fiscal-verifactu" })`. Fails today: `parseNote` throws `setup.attempt_invalid` because `typeof note.lastName !== "string"` (`:36`).
  - "an unknown-name note never lowers a known one": raise `{floorMs: 200, lastName: "first"}`, then `{floorMs: 100, lastName: null}` → the file still holds `"first"`/200; then `{floorMs: 200, lastName: null}` (equal) → still `"first"`; then `{floorMs: 300, lastName: null}` → holds `null`/300.
  - New refusal row: "a missing name key" `'{"version":1,"floorMs":1,"module":"m"}'` → `setup.attempt_invalid`. (The existing "a missing key" row is missing `module`, not `lastName`.) It already passes; it pins that a missing key is not read as "unknown".
  - Control (existing, unchanged): "an empty name" row `:105` stays refused; "a note round-trips exactly" `:59` unchanged.
- [ ] **Step 2: implement.** `lastName: string | null`; in `parseNote` accept `note.lastName === null`, otherwise keep the string checks (1–64 characters). Nothing else changes; `raiseStartAgainNote` keeps "only a strictly later floor replaces the note".
- [ ] **Step 3: run.** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-note.test.ts` (expect 142 + the new cases, all passing); `pnpm --filter @waitron/provisioning typecheck`; `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 4: root guard.** `pnpm exec vitest run scripts/start-again-note-writers.test.ts`.
- [ ] **Step 5: commit** `git commit -s` (the note file, its test, `apps/server/test/start-again-deleted.ts` if its type changed).

### Task 2 (provisioning): the attempt's newest file time — G3

**Files:** `packages/provisioning/src/first-setup-start-again-deletion.ts` (new exported `attemptLastWriteMs`, beside `itemsOnDisk` `:264-318`); export it from `packages/provisioning/src/index.ts`; new test file `packages/provisioning/src/first-setup-start-again-last-write.test.ts` (look at `first-setup-start-again-deletion.test.ts` and `packages/provisioning/test/start-again-attempt.ts` for how folders are laid out).

Behaviour: `attemptLastWriteMs(roots, options: { discarding?: string } = {}): Promise<number | null>`. Canonicalise the roots as `startAgainMarkerFor` does (`:344`). Take `itemsOnDisk(canonical, options)`. For each `file` item **except** `venue/venue.db` and `venue/node.db`, and each `folder` item, `lstat` its `mtimeMs`; skip `side` items. Return `Math.ceil` of the largest, or `null` when there is none. An `AppError` from `itemsOnDisk` is rethrown; any other error is turned into the module's `checkFailed` refusal, as `startAgainMarkerFor` does (`:345-347`).

**`first-setup-resolutions/` itself (review M3).** `itemsOnDisk` lists that folder as an item when no backup recovery is kept there (`:313`), so its time counts then; when a backup recovery is kept (abandoned, or the one being discarded) it is not listed and does not count. The password step's ownership-recovery records move this folder's time (PROBE 8), which is part of difference D-3.

- [ ] **Step 1: failing test first.** "a side file written later does not move the answer": lay out an attempt (picks file, `first-setup.json`, claim, `venue.db`), stamp every item to T with `utimes`, then stamp `venue/venue.db-shm` to T + 1 h. Expect `attemptLastWriteMs(...)` = T. It fails because the function does not exist.
- [ ] **Step 2: the rest of the cases**, table-driven. Each "excluded" row stamps that item later than every listed item, so a wrong answer would show it (the class representative has to be a value the two sides treat differently, `CLAUDE.md` §1):
  - excluded: `venue.db`, `node.db`, `venue.db-wal`, `venue.db-shm`, `node.db-wal`, `node.db-shm`, the note, `first-setup-start-again-confirmations/`, `tls/`, `venue.lock`, the state folder itself, the venue folder itself, and (with `discarding` set to the recovery's id) a kept `first-setup-resolutions/backup-recovery/`, its files, **and `first-setup-resolutions/` itself**;
  - included: the kept picks file, a file in `first-fiscal-documents/`, the `first-fiscal-documents/` folder, `first-setup-node-key.json`, `module-operation-public.json`, an ownership-recovery record file, its `<uuid>/` folder and a `step-000001/` folder, **`first-setup-resolutions/` itself when no backup recovery is kept**, `first-setup-claim.json`, `first-setup.json` — each stamped latest gives exactly its time;
  - **G3:** two listed files, the damaged one (`{damaged`) lowered to T − 1 h, the node key at T + 2 h → T + 2 h. Control: both lowered to T − 1 h → T − 1 h (shows the node key held it);
  - a fractional `mtimeMs` rounds up (`Math.ceil`);
  - nothing on disk → `null`;
  - a folder in place of `module-preparation-state.json` is refused (`itemsOnDisk`'s "layout unexpected"), not skipped.
- [ ] **Step 3: implement**, then run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-last-write.test.ts src/first-setup-start-again-deletion.test.ts` and `pnpm --filter @waitron/provisioning typecheck`.
- [ ] **Step 4: root guard.** `pnpm exec vitest run scripts/start-again-note-writers.test.ts` (the new function must not name the note).
- [ ] **Step 5: commit.**

### Task 3 (module contract + fiscal-verifactu seat): the seat takes `lastWriteMs`

**Files:** `packages/module/src/initial-setup.ts:77-86` (`startAgainFloor`'s input gains `readonly lastWriteMs?: number`; its result becomes `{ readonly floorMs: number; readonly lastName: string | null } | null`); `packages/fiscal-verifactu/src/initial-hour-setup.ts:139-179`; type ripple `apps/server/src/first-setup-resolution.ts:88`, `:155` (`lastName: string | null`); test `packages/fiscal-verifactu/src/initial-hour-setup.test.ts` (the seat's cases are near `:1006-1100`).

Behaviour, in `hourStartAgainFloor`:
- `known` = today's result from the minutes (`floorMs` = start of the minute after the latest name, `lastName` = that name), or none.
- When `lastWriteMs` is given: refuse `history_invalid` unless it is a safe integer; `timeFloorMs = max(EPOCH_MS, (Math.floor((lastWriteMs + START_AGAIN_WRITE_MARGIN_MS) / MINUTE_MS) + 1) * MINUTE_MS)` — the design's "start of the minute after (last write + 150 s)", never A1098's round-up (review I1) — with `START_AGAIN_WRITE_MARGIN_MS = 150_000` (one line at the constant: it is the chooser's wait bound, `WAIT_BOUND_MS`, `hour-selection.ts:65`).
- Result: neither → `null`. Otherwise `floorMs = max(known.floorMs, timeFloorMs)`, and `lastName = known.lastName` when `known.floorMs >= timeFloorMs`, else `null`.
- Every refusal the seat makes today stays (an unreadable intent still refuses when `lastWriteMs` is given).

- [ ] **Step 1: failing test.** "a last write alone gives a time floor with no name": `seat.startAgainFloor!({ attempts: [], preparations: [], publicEvidence: [], lastWriteMs: Date.parse("2026-10-16T15:42:10.000Z") })` `toEqual({ floorMs: Date.parse("2026-10-16T15:45:00.000Z"), lastName: null })` (15:42:10 + 150 s = 15:44:40, and the minute after that is 15:45, the design's Example 2). Fails today: the seat returns `null`.
- [ ] **Step 2: more cases.**
  - a known name whose floor is later than the time floor keeps the name and its floor;
  - a time floor later than the known name gives `lastName: null` and the time floor;
  - equal floors keep the known name;
  - **boundary (review I1):** `lastWriteMs` 15:42:30.000 + 150 s = 15:45:00.000 exactly, so the floor is the minute after, **15:46**. Control: 15:42:29.999 + 150 s = 15:44:59.999 → **15:45**. A1098's round-up would give 15:45 for both; this pair is the case that tells the two formulas apart;
  - a `lastWriteMs` before 2026 gives `EPOCH_MS` (2026-01-01), which `hour-history.ts:61-66` accepts;
  - `lastWriteMs: 1.5` or `NaN` refuses `sif.allocation_invalid` `history_invalid`;
  - control, unchanged: with no `lastWriteMs` every existing case passes as written, including `packages/composition/src/start-again-floor.test.ts:36`.
- [ ] **Step 3: implement**, then run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/initial-hour-setup.test.ts`, `pnpm --filter @waitron/composition exec vitest run src/start-again-floor.test.ts`, `pnpm --filter @waitron/module typecheck`, `pnpm --filter @waitron/fiscal-verifactu typecheck`, `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 4: fiscal gates** (both commands in the header), unedited.
- [ ] **Step 5: root guard.** `pnpm exec vitest run scripts/module-seams.test.ts`.
- [ ] **Step 6: commit.**

### Task 4 (fiscal-verifactu, tests only): the chooser writes nothing before it refuses — G4

**Files:** `packages/fiscal-verifactu/src/hour-selection.test.ts` only. **No change to `hour-selection.ts`.** If a case cannot be built without changing it, STOP.

The design's margin argument rests on this: a resume under a clock behind its own pick refuses before writing (`hour-selection.ts:409-416` precede the write at `:417-425`), and a new pick writes only a wait within 150 s. The suite's state is in memory with a `replace` function (`:68`, `:348`, `:435`, `:840`); the real picks file is written only through `replace` (`packages/provisioning/src/module-preparation-state.ts`, `createModulePreparationState`). So "no write" here means "no `replace` call".

- [ ] **Step 1: cases**, with a `replace` spy:
  - a pick recorded at T, clock at T − 10 min: `resume` refuses `minute_not_later` and `replace` was never called;
  - the same history, a new `select` for another event at T − 10 min: refuses `minute_not_later` with `allowedFromMs` = the minute after T, and `replace` was never called;
  - control: at T + 1 min (setup binding, so it settles), a new `select` records a wait — `replace` was called once with a `wait` entry — which shows the spy sees writes.
- [ ] **Step 2: run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-selection.test.ts`; then the fiscal gates.
- [ ] **Step 3: commit.**

### Task 5 (server): the kept picks file, read on its own

**Files:** new `apps/server/src/start-again-name-records.ts`; test `apps/server/src/start-again-name-records.test.ts`.

Two functions, used by Tasks 6a, 8 and 9:
- `readSeriesPicks(roots, module, seat)` → `{ preparations: readonly unknown[]; unreadable: boolean }`. Call `readModulePreparationHistory(roots, module)` (`packages/provisioning/src/module-preparation-state.ts:73-83`). If it throws an `AppError` and `lstat(join(roots.stateDir, "module-preparation-state.json"))` finds an entry, return `{ preparations: [], unreadable: true }`; if no entry, rethrow; any other error, rethrow. If it reads, call `seat({ attempts: [], preparations, publicEvidence: [] })`; an `AppError` from that means the hour module cannot use the picks (design E4) → `{ preparations: [], unreadable: true }`.
- `seriesPicksUnreadable(roots, modules, moduleNames)` → `boolean`: true when `readSeriesPicks` reports `unreadable` for any name in `moduleNames` whose module in `modules` has a `startAgainFloor` seat. The caller passes **the module set** (global constraints): the attempt's frozen modules, as `gatherStartAgainFloor` collects them at `first-setup-resolution.ts:83-85` (review I5). A name with no seat is skipped, exactly as the gather skips it (`:91-92`).

- [ ] **Step 1: failing tests** (real temporary folders): `{damaged` in the picks file → `unreadable: true`; a picks file that parses but whose row the hour seat refuses (use the shape of the existing "an unreadable intent refuses" case, `initial-hour-setup.test.ts` near `:1077`) → `unreadable: true`; a missing picks file → `{ preparations: [], unreadable: false }`; a valid one → its rows, `unreadable: false`; an `EACCES`-style non-`AppError` from a stubbed reader is rethrown, not counted; `seriesPicksUnreadable` with a damaged file but `moduleNames` naming only a module with no seat → `false`. Fail because the file does not exist.
- [ ] **Step 2: implement; run** `pnpm --filter @waitron/server exec vitest run src/start-again-name-records.test.ts`; `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 3: commit.**

### Task 6a (server, database missing): the kept picks file — G1

**Files:** `apps/server/src/first-setup-resolution.ts` (`gatherStartAgainFloor` `:76-131`, `summaryOf` `:132-143`, `startAgainSummary` `:295-325`, `startAgainFirstSetup` `:414-461`); `packages/provisioning/src/first-setup-start-again-confirmation.ts:12-17` (type only: `StartAgainSummary` gains `readonly unreadable?: StartAgainUnreadable`, `StartAgainUnreadable = { readonly records: readonly ("series-picks" | "public-record" | "fiscal-documents")[]; readonly floorMs: number }`, exported from `index.ts`); tests `apps/server/src/first-setup-start-again-note.test.ts` (new cases beside the damaged-recovery-record cases `:737-910`, using its `abandonedAttempt` `:106` and `missingDatabase` `:304` helpers).

Behaviour of `gatherStartAgainFloor(roots, state, originals, modules, deletion: { discarding?: string })`, in this task for the kept picks file only:
1. **Kept picks:** per module with a seat, `readSeriesPicks` (Task 5). Unreadable → record `"series-picks"`, preparations `[]`.
2. `known` = `seat({ attempts, preparations, publicEvidence })` over what was readable, exactly as today.
3. If any record was found unreadable: `lastWriteMs = await attemptLastWriteMs(roots, deletion)` (an `AppError` from it becomes `setup.not_ready` with its reason, as `assertStartAgainAllowedOnDisk` does), and `floor = seat({ ..., lastWriteMs })` for **every** module in the module set (the picks file is shared by all modules). Otherwise `floor = known`.
4. Return `{ floor, known, recoveryRecordDamaged, unreadable }`, where `unreadable` (only when a record was found) = `{ records, floorMs }`: `records` in the fixed order `series-picks`, `public-record`, `fiscal-documents`, no repeats; `floorMs` = the floor Start again will give the note: the latest of `floor.floorMs` across modules and, on the stopped-recovery path, `found.floor.floorMs` (`:421-426`).

`summaryOf`: `startAgainSummary(state, gathered.known?.lastName ?? null)` (difference D-6), plus `unreadable` when present. An undamaged summary is exactly today's. Both `startAgainSummary` and `startAgainFirstSetup` pass the same `deletion` option Start again uses (`:342`: `{ discarding: found.id }` when a recovery was found).

**Stamping file times (review M1).** File times follow the real clock, not the suite's faked `Date` (design F3), and the password step rewrites listed files (PROBE 8). So give `missingDatabase` an optional `stamp(f)` callback that runs **after** `recoverFirstSetupOwner` and before the caller's summary; Tasks 6b, 11 and 14 reuse it. (`afterRemove` runs before the password step and is too early.)

- [ ] **Step 1: failing test, G1.** Damage the picks file (`{damaged`) after the attempt; in `stamp`, `utimes` every listed item to the attempt's name minute + 1 min and the picks file to name + 2 h. Expect the summary `toEqual({ reached: "named", lastName: <the attempt's own name>, unreadable: { records: ["series-picks"], floorMs: <minute after (name + 2 h + 150 s)> } })`, Start again with that `shown` succeeds, and the note `toEqual({ version: 1, floorMs: <same>, lastName: null, module: "fiscal-verifactu" })`. Fails today: the summary refuses `setup.attempt_invalid`.
- [ ] **Step 2: control (G1).** The same stamps on an **undamaged** picks file: the summary has no `unreadable` key and the note is today's (`lastName` = the name, `floorMs` = the minute after it).
- [ ] **Step 3:** a damaged recovery record **and** a damaged picks file → `recoveryRecordDamaged: true` and `unreadable` together.
- [ ] **Step 4: run** (review M7) `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts src/first-setup-retired-assignments.test.ts src/first-setup-start-again-damaged-recovery.test.ts src/first-setup-start-again-backup.test.ts src/first-setup-start-again-backup-discard.test.ts src/first-setup-start-again-backup-restart.test.ts src/first-setup-unused-pdf.test.ts src/first-setup-recovery-delivery.test.ts src/first-setup-resolution.route.test.ts src/first-setup-set-aside-lifetime.test.ts src/recovery-start-again.test.ts` and `pnpm --filter @waitron/composition exec vitest run src/start-again-floor.test.ts` — all pass with no assertion edited. `pnpm --filter @waitron/server typecheck`; `pnpm --filter @waitron/provisioning typecheck`.
- [ ] **Step 5: root guards.** `pnpm exec vitest run scripts/start-again-note-writers.test.ts scripts/module-seams.test.ts scripts/errors-reachable.test.ts`.
- [ ] **Step 6: commit.**

### Task 6b (server, database missing): the public record, the documents, each evidence item — G7, approved changes 1–3

**Files:** as Task 6a, plus `apps/server/src/first-setup-retired-assignments.test.ts` (approved changes 1–3; its helper `startAgainMissingDatabase` `:153-180`).

Behaviour added to `gatherStartAgainFloor`, per module with a seat:
1. **Public record:** `readFirstFiscalEvidenceSnapshot(module, originals)` (`:93`). An `AppError` while `originals` holds bytes for `state/module-operation-public.json` → record `"public-record"`, evidence `[]`. Otherwise rethrow.
2. **Recovery record:** A1042's S7l catch (`:94-113`) unchanged.
3. **Fiscal documents:** `readFirstFiscalDeliverySnapshot(module, state, seen)` (`:114-115`). An `AppError` while any `state/first-fiscal-documents/` entry in `seen` has bytes → record `"fiscal-documents"`, document none. Otherwise rethrow.
4. **Each public evidence item on its own:** call `seat({ attempts: [], preparations: [], publicEvidence: [item] })`; an `AppError` drops the item and records `"public-record"` or `"fiscal-documents"` by where it came from (the public record, or the recovery statement / delivery document).
5. **The attempts alone:** `seat({ attempts, preparations: [], publicEvidence: [] })` must not refuse; if it does, rethrow (this is `first-setup.json`'s own input, design X1, out of scope).

**Comment made false (review M4):** `first-setup-resolution.ts:105-107` ("… Every other reader here still refuses.") — the other name-record readers no longer refuse; correct it to what stays true (the recovery record names nothing, so a damaged one is read as missing) or delete it.

- [ ] **Step 1: failing tests**, each a summary + note case (stamped with Task 6a's callback): a created `{damaged` public record → `["public-record"]`; recovery record removed and `fiscal-verifactu.json` `{damaged` (PROBE 5's shape) → `["fiscal-documents"]`; a stray `first-fiscal-documents/stray.json` beside a missing recovery record → `["fiscal-documents"]`; picks + public record both damaged → `["series-picks", "public-record"]`. Each fails today with `setup.attempt_invalid` at the summary.
- [ ] **Step 2: approved changes 1–3** in `first-setup-retired-assignments.test.ts` (`:593-612`, `:622-631`): replace each `expectStartAgainRefused(...)` with assertions on `f.shown` (`unreadable.records` as listed in the header, and `recoveryRecordDamaged: true` for 1–2) and on the note (`floorMs` ≥ the time floor; `lastName` `null` when the time floor wins). `startAgainMissingDatabase` gets an optional `stamp` callback between the password step and the summary so the floor is predictable. List the three in the PR as changed approved items.
- [ ] **Step 3: G7** (note suite), each with the attempt's files unchanged (`attemptFiles`), no note, no marker: damaged `first-setup.json` → `setup.owner_required` (missing) / `setup.attempt_conflict` (present); damaged claim → the same; a corrupt `venue.db` (database present, not missing) → `setup.not_ready`; an outside evidence file configured (`publicEvidencePaths`, as `:1048`) **beside a damaged picks file** → `setup.not_ready`; all with no confirmation record. These are the design's F1 rows (PROBE 2/3 above).
- [ ] **Step 4: G7, the damaged note (review I2).** A damaged note (E6) beside a damaged picks file, database missing: the summary is shown, then Start again is refused `setup.attempt_invalid`. Start again writes the confirmation record (`first-setup-resolution.ts:450-460`) **before** it raises the note (`:461`), so expect exactly **one new confirmation record**, the damaged note's bytes unchanged, no deletion marker, and the attempt's files unchanged. Do not reorder those writes; this is today's order, and backlog entry (iii).
- [ ] **Step 5: run** the commands of Task 6a Step 4 (all pass; the only edited assertions are changes 1–3), both typechecks, and Task 6a's root guards.
- [ ] **Step 6: commit.**

### Task 7 (provisioning + server, database missing): the route and the confirmation record take `unreadable` — G6

**Files:** `packages/provisioning/src/first-setup-start-again-confirmation.ts:92-129` (`confirmation()` validates and keeps `unreadable`); `apps/server/src/setup-first-fiscal-api.ts:86-105` (`shownSummary` takes optional `unreadable` in its exact shape); tests `packages/provisioning/src/first-setup-start-again-confirmation.test.ts`, `apps/server/src/first-setup-start-again-note.test.ts` (route cases beside `:580` "the Start again route takes the confirmation only in its exact shape").

The exact shape, in both places: an object with exactly `records` and `floorMs`; `records` a non-empty array of the three known values, in the fixed order, no repeats; `floorMs` a safe integer. Anything else: `setup.attempt_invalid` in the record writer, `setup.request_invalid` at the route.

- [ ] **Step 1: failing tests.** Record writer: a record whose `shown` has `unreadable` round-trips with it (fails today: `confirmation()` rebuilds `shown` without it, `:122-127`). Route: a `confirmMissingDatabase.shown` holding a valid `unreadable` reaches Start again with it (fails today: `exact(...)` refuses the unknown key, `:87`).
- [ ] **Step 2: refusal rows** (both places): missing `records`, empty `records`, an unknown record name, a repeat, out of order, an extra key, a text `floorMs`, `null`.
- [ ] **Step 3: G6, database missing** (note suite): a Start again whose `shown` lacks `unreadable` when the box finds one → `setup.attempt_conflict`, nothing written; one whose `unreadable.floorMs` differs by one minute → the same; the exact `shown` succeeds and the confirmation record's `shown` `toEqual`s it, `unreadable` included.
- [ ] **Step 4: run** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-confirmation.test.ts`, `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-note.test.ts src/first-setup-resolution.route.test.ts`, both typechecks.
- [ ] **Step 5: commit.**

### Task 8 (server, database present): the password refusal says the picks file is damaged

**Files:** `apps/server/src/errors.ts:1033-1037` (`"setup.start_again_password_required": { seriesPicksUnreadable?: true }`); `apps/server/src/first-setup-resolution.ts:409-413`; tests `apps/server/src/first-setup-unused-pdf.test.ts` (add cases; its `fixture()`, `withPassword`, `startAgainUnchanged` helpers) or the note suite's `abandonedAttempt` (PROBE 3's shape).

Behaviour: with the database present, compute `picksDamaged = host.modules !== undefined && await seriesPicksUnreadable(roots, host.modules, <the module set from state>)` (Task 5) just after `markerFor(discarding)` (`:409`). The password condition at `:410` becomes `(recoveryRecordDamaged || discardsStopped || picksDamaged) && request.owner === undefined`, and the refusal carries `{ seriesPicksUnreadable: true }` only when `picksDamaged`; otherwise `{}` exactly as today.

**Comment made false (review M4):** `errors.ts:1033-1036` says the refusal means the recovery-key record cannot be read and has "NO params". Rewrite it to the code's two causes (the recovery-key record, the kept picks file) and its one optional parameter.

- [ ] **Step 1: failing test.** Database present, a damaged picks file, no owner (PROBE 3's request) → rejects `{ code: "setup.start_again_password_required", params: { seriesPicksUnreadable: true } }`, nothing written. Fails today: `setup.attempt_invalid`.
- [ ] **Step 2: controls:** (existing, unchanged) a damaged recovery-key record alone still answers `params: {}` (`first-setup-start-again-note.test.ts:836`, "the password-required refusal answers 403 over HTTPS"); an intact picks file with the same request still starts again without a password (PROBE 9's control); a damaged record beside a refused artifact still refuses `setup.not_ready` before the password (`first-setup-unused-pdf.test.ts:568`). (New, review I5) an attempt whose frozen modules have no `startAgainFloor` seat, with a damaged picks file, still starts again password-free as today, because the gather never reads the picks for it (`:91-92`); build the host with a module list whose frozen module lacks the seat.
- [ ] **Step 3: run** `pnpm --filter @waitron/server exec vitest run src/first-setup-unused-pdf.test.ts src/first-setup-start-again-note.test.ts src/first-setup-start-again-backup-discard.test.ts`; typecheck.
- [ ] **Step 4: root guards.** `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts` (the second fails on a parameter name containing `name`; that is why it is `seriesPicksUnreadable`).
- [ ] **Step 5: commit.**

### Task 9 (server, database present): the summary route answers when the kept picks file is damaged

**Files:** `apps/server/src/first-setup-resolution.ts:295-325`; tests in `apps/server/src/first-setup-start-again-note.test.ts`.

Behaviour: the module set needs the attempt, which today is read at `:305`, after the early refusal at `:304`. So, only when the database is present and no stopped recovery was found: read the attempt with `host.store.readForRepair()` inside a guard that turns any failure or `null` into today's `setup.not_ready`, then refuse `setup.not_ready` unless `seriesPicksUnreadable(roots, host.modules, <its module set>)` is true. An undamaged box therefore keeps refusing `setup.not_ready` **before** the password check, as now. After the gather on that path, refuse `setup.not_ready` unless `gathered.unreadable` is present. Everything else (the database and status checks `:307-312`, the password check `:313`, the missing-database path) is unchanged.

- [ ] **Step 1: failing test.** Database present, damaged picks file, owner recovered with the password → the summary `toEqual({ reached: …, lastName: …, unreadable: { records: ["series-picks"], floorMs: … } })` (stamp the listed items after the password step, Task 6a's pattern). Fails today: `setup.not_ready`.
- [ ] **Step 2: controls (existing, unchanged):** "the summary route refuses when the database is present" (`first-setup-start-again-note.test.ts:467`, a non-recovered owner, `setup.not_ready`); "with the database present and no recovery, the summary refuses `setup.not_ready`" (`first-setup-start-again-backup-discard.test.ts:590`); the stopped-recovery summary rows `:620`. New: damaged picks with a non-recovered owner → `setup.owner_required` (the password is still required); damaged picks on an attempt whose frozen modules have no seat → `setup.not_ready`.
- [ ] **Step 3: run** the three suites above and typecheck.
- [ ] **Step 4: commit.**

### Task 10a (provisioning + server route): the record and the route take the database-present confirmation

**Files:** `packages/provisioning/src/first-setup-start-again-confirmation.ts:111-112` (`database: "present"` is accepted when `shown` holds `recovery` **or** `unreadable`); `apps/server/src/setup-first-fiscal-api.ts:76-85` (an `unreadableConfirmation` beside `recoveryDiscardConfirmation`, requiring `shown.unreadable`) and `:940-985` (take `confirmUnreadable` in its exact shape and pass it on); tests `packages/provisioning/src/first-setup-start-again-confirmation.test.ts`, `apps/server/src/first-setup-start-again-note.test.ts` (route cases).

**Comment made false (review M4):** `first-setup-start-again-confirmation.ts:111` ("With the database present, the only Start again that writes a record discards a recovery.") — it now also writes one past a damaged picks file.

- [ ] **Step 1: failing tests.** Record writer: `database: "present"` with `shown.unreadable` and no `recovery` is written and reads back equal; the existing refusal `:306` (neither) stays. Route: `confirmUnreadable: { shown }` with `shown.unreadable` reaches the action (a stub `startAgain`, as the route tests do).
- [ ] **Step 2: route refusals** (`setup.request_invalid`): `confirmUnreadable` not an object, an extra key, `shown` without `unreadable`, a malformed `unreadable`.
- [ ] **Step 3: run** the two suites and `first-setup-resolution.route.test.ts`; both typechecks.
- [ ] **Step 4: commit.**

### Task 10b (server, database present): Start again takes `confirmUnreadable` and writes the record — G6

**Files:** `apps/server/src/first-setup-resolution.ts` (`StartAgainFirstSetupRequest` `:41-50`, `exactKeys` list `:329-338`, `:349-352`, `:414-460`); tests in the note suite.

Behaviour: `presentUnreadable = !missing && !discardsStopped && gathered.unreadable !== undefined`. Refuse `setup.attempt_conflict` when `confirmUnreadable` is sent with the database missing, beside `confirmRecoveryDiscard`, or when `presentUnreadable !== (request.confirmUnreadable !== undefined)`. If `presentUnreadable` and no owner, throw `setup.start_again_password_required` with `{ seriesPicksUnreadable: true }`. `shown` is computed for `missing || discardsStopped || presentUnreadable`; with `presentUnreadable`, `isDeepStrictEqual(request.confirmUnreadable.shown, shown)` or conflict. The confirmation record is written for `presentUnreadable` too, with `database: "present"`. With a stopped recovery being discarded, `confirmRecoveryDiscard.shown` already carries `unreadable` (Task 6a's `summaryOf`), so no second field.

**An abandoned recovery not yet emptied (review M8).** When `found.kind === "unemptied"` (`finishing`, `:429`), Start again today writes no confirmation record because the Start again that abandoned the recovery already wrote one (`:427-428`, `:450`). Nothing in today's code decides what happens when, on that path with the database present, the picks file is damaged: today the gather refuses `setup.attempt_invalid`. Conservative choice: keep that refusal. When `finishing && presentUnreadable`, throw `setup.attempt_invalid` before anything is written, as today. Test it, and it goes into backlog entry (v) beside review M6's case (Task 18b).

- [ ] **Step 1: failing test.** Database present, damaged picks, password, summary, Start again with `confirmUnreadable: { shown }` → succeeds; the note `lastName: null` with the shown floor; the confirmation record `database: "present"` and `shown` equal to what was sent.
- [ ] **Step 2: G6 rows:** `confirmUnreadable` missing → conflict, nothing written; `shown` lacking `unreadable` or with another floor → conflict; `confirmUnreadable` on a box with no damage → conflict; with the database missing → conflict; beside `confirmRecoveryDiscard` → conflict.
- [ ] **Step 3: M8 row:** an abandoned, not yet emptied recovery (the fixture of `first-setup-start-again-backup-restart.test.ts:269`, "an abandoned journal whose emptying was refused is finished by the next Start again") with the database present and a damaged picks file → `setup.attempt_invalid`, nothing written, no confirmation record.
- [ ] **Step 4: run** the note suite, `first-setup-start-again-backup-discard.test.ts`, `first-setup-start-again-backup.test.ts`, `first-setup-unused-pdf.test.ts`; typecheck.
- [ ] **Step 5: commit.**

### Task 11 (server, database present): the floor is stable across the two reads, and follows the listed files — G1, G5

**Files:** tests only, in the note suite (or a new `apps/server/src/first-setup-start-again-damaged-names.test.ts` if the note suite's helpers can be imported without copying; do not copy more than the helpers need).

Stamp file times **after** the password step (review M1), with the same kind of callback Task 6a adds to `missingDatabase`.

- [ ] **Step 1: G1 on this path.** Database present, damaged picks stamped name + 2 h, other listed items stamped name + 1 min → after password, summary, Start again: note `{ lastName: null, floorMs: minute after (name + 2 h + 150 s) }`. Control: same stamps, undamaged picks → no `unreadable`, password-free Start again as today, note with the name.
- [ ] **Step 2: G5.** Between the summary and Start again, create or `utimes` `venue/venue.db-shm` to a later time (the inspection's read-only open moves it, design F4 G) → Start again with the summary's `shown` succeeds and the note's floor equals `shown.unreadable.floorMs`.
- [ ] **Step 3: G5 control.** Between the two, `utimes` `state/first-setup-node-key.json` to **name + 3 h**, above the current newest (name + 2 h), without changing its bytes, so the floor really moves (review M1). Assert the inspection id is unchanged (the inspection fingerprints bytes, not times: `packages/provisioning/src/first-setup-resolution-inspection.ts:42-72`), then Start again → `setup.attempt_conflict`, nothing written. This shows the refusal came from the floor, not from the inspection.
- [ ] **Step 4: run** the suite; commit.

### Task 12 (setup app): types, client, session and the words

**Files:** `apps/setup/src/api/first-setup-types.ts:134-139` (`unreadable?`); `apps/setup/src/api/client.ts:652-670` (`startAgainFirstSetup` gains `confirmUnreadable?: { shown: StartAgainSummary }`); `apps/setup/src/first-setup-session.ts` — `summaryOf` `:84-99` accepts `unreadable` in its exact shape, `sameSummary` `:100-111` compares it, new `damagedRecordSummary()` beside `stoppedRecoverySummary()` `:687-700` (database present; requires `summary.unreadable`), `retireDamagedRecord` `:702-723` (sends `recoveryRecordDamagedShown: true` when no summary or `summary.recoveryRecordDamaged`, `confirmRecoveryDiscard` only when `summary.recovery`, `confirmUnreadable: { shown: summary }` when `summary.unreadable` and no `summary.recovery`); `apps/setup/src/screens/initial-owner-strings.ts` (English `:2-59`, Spanish from `:61`): the four keys, word for word from the design's §D3:

| Key | English | Spanish |
|---|---|---|
| `seriesPicksDamaged` | This box's record of the invoice series names it chose is damaged and cannot be read. | El registro de los nombres de serie de facturas que eligió este equipo está dañado y no se puede leer. |
| `publicRecordDamaged` | This setup's public fiscal record is damaged and cannot be read. | El registro fiscal público de esta configuración está dañado y no se puede leer. |
| `fiscalDocumentsDamaged` | This setup's fiscal documents on this box are damaged and cannot be read. | Los documentos fiscales de esta configuración en este equipo están dañados y no se pueden leer. |
| `namesFrom` | New series names can start from {date}, {time}. | Los nuevos nombres de serie podrán empezar el {date} a las {time}. |

Add a small pure function `namesFromText(locale, floorMs, timeZone?)` (the browser's zone by default; date with `dateStyle: "medium"`, time with `timeStyle: "short"`, the page's locale as `shownAt` uses, `apps/setup/src/screens/first-setup-backup-screen.ts:56-61`).

- [ ] **Step 1: failing tests** (`apps/setup/src/first-setup-retirement.test.ts`, beside `:152` and `:161`): a summary with `unreadable` is read and sent back unchanged; one whose `unreadable.floorMs` changed between display and confirmation is refused and nothing is sent; malformed `unreadable` rows → `setup.attempt_invalid`. `namesFromText("en-GB", Date.parse("2026-10-16T13:45:00Z"), "Europe/Madrid")` = "New series names can start from 16 Oct 2026, 15:45." and the Spanish one = "Los nuevos nombres de serie podrán empezar el 16 oct 2026 a las 15:45." (the design's Example 2; Node's own `Intl` printed "16 Oct 2026" / "16 oct 2026" and "15:45" for these options on 2026-10-27 — Chromium's output is what the test measures).
- [ ] **Step 2: implement; run** `pnpm --filter @waitron/setup exec vitest run src/first-setup-retirement.test.ts` (browser mode: check memory first); `pnpm --filter @waitron/setup typecheck`.
- [ ] **Step 3: commit.**

### Task 13 (setup app, database missing): the page draws the lines

**Files:** `apps/setup/src/setup-app.ts` — the confirmation block `:2553-2595`: after the recovery-key line, one `<p data-test="name-record-damaged">` per entry in `ask.unreadable.records` (keys from Task 12), then the existing `startAgainHelp`, then `<p data-test="names-from">` with `namesFromText`. Tests `apps/setup/src/setup-app-missing-database.test.ts` (beside `:471-500`), `apps/setup/src/setup-app-missing-database.a11y.test.ts` (add a state, e.g. `"names-damaged"`, to the loop `:25-33`), fixtures `apps/setup/test/missing-database-browser.ts` (add a summary with `unreadable`).

- [ ] **Step 1: failing tests.** A summary with `unreadable: { records: ["series-picks"], floorMs }` → the three lines in order (damaged record, `startAgainHelp`, `namesFrom`), then the tick box; Cancel sends nothing; confirming sends the summary exactly as displayed, `unreadable` included; Spanish words; two records → two lines in the fixed order; with `recoveryRecordDamaged` too, both kinds of line before `startAgainHelp`. Control: a summary without `unreadable` draws no `name-record-damaged` and no `names-from` (beside `:491`).
- [ ] **Step 2: axe**, both themes, both languages, 390 px and 1280 px: the new state passes `expectNoA11yViolations` and nothing is wider than the viewport (the loop's existing checks).
- [ ] **Step 3: run** `pnpm --filter @waitron/setup exec vitest run src/setup-app-missing-database.test.ts src/setup-app-missing-database.a11y.test.ts`; typecheck.
- [ ] **Step 4: commit.**

### Task 14 (server): the next setup waits for the floor — G2

**Files:** tests in `apps/server/src/first-setup-start-again-note.test.ts`, beside the "clock set back" cases `:180-249`. Depends on Task 6a.

Build the note through the real path: the database-missing fixture (`missingDatabase`, `:304`) with the picks file damaged, and, in Task 6a's `stamp` callback **after the password step** (review M1), every listed item stamped at the attempt's name N + 1 min except the picks file at L = N + 2 h (the "lost" minute an ahead clock would have named); then summary and Start again. Expect the note `{ lastName: null, floorMs: F }` with F = minute after (L + 150 s). Then claim a new setup as the suite's `startedAgain` does (`:133`).

- [ ] **Step 1:** clock at F − 3 min → `compareAndSelect` rejects `{ code: "sif.allocation_invalid", params: { reason: "minute_not_later", allowedFromMs: F } }`; no intent recorded (as `:195-207`).
- [ ] **Step 2:** clock at F − 1 min → `selectPastWaits` waits, then chooses a name whose minute is later than L.
- [ ] **Step 3: control:** F in the past (clock at F + 5 min) → one move only (setup's own 90–150 s wait), as "a clock past the note chooses a later name at once" (`:217-223`).
- [ ] **Step 4: run** the suite; commit.

### Task 15 (fiscal-verifactu setup screens): the wait line shows the date for a later day — G9

**Files:** `packages/fiscal-verifactu/src/setup/clock-wait.ts` — strings `:35-62` gain `laterFromDay(date, time)`; `ClockWords` gains it; `renderClockProblem` `:237-275` (the `later` branch `:261-273`). Check `first-hour.ts:512` and `recovery-hour.ts:415` pass words that include the new key (type errors will show it). Tests `packages/fiscal-verifactu/src/setup/clock-wait.browser.test.ts`.

Words (derived from the approved `namesFrom` pattern; listed in the PR for the owner, R-4):
- EN `laterFromDay: (date, time) => \`You can carry on from ${date}, ${time}.\``
- ES `laterFromDay: (date, time) => \`Podrás seguir a partir del ${date} a las ${time}.\``

Rule: when `allowedFromMs`'s calendar day in the venue's time zone is **later** than today's (`Date.now()`) in that zone, use `laterFromDay` with the date (`dateStyle: "medium"`, through `dateTimeFormat`); otherwise `laterFrom(time)` exactly as now (difference D-9).

- [ ] **Step 1: failing tests** (fake `Date` with `vi.setSystemTime` in these new cases only): now 2026-10-16 14:15 in Europe/Madrid, floor two days later → "You can carry on from 18 Oct 2026, 15:45." and the Spanish line. **The midnight case (review M2)**, which only the venue's zone can decide: pin a date **before 25 Oct 2026**, while the Canary Islands are on UTC+1: now 2026-10-20 23:50 Atlantic/Canary (22:50 UTC), floor 2026-10-21 00:05 Atlantic/Canary (23:05 UTC on the 20th) → the date is shown, although the UTC date is the same. (On or after 25 Oct the Canaries are on UTC, the two dates coincide, and the case would prove nothing.)
- [ ] **Step 2: controls:** a floor later today → the time alone; a floor on an earlier day → the time alone. The four existing assertions (`first-hour.browser.test.ts:512`, `:1162`; `recovery-hour.browser.test.ts:843`, `:1052`) pass unedited.
- [ ] **Step 3: run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/setup/clock-wait.browser.test.ts src/setup/first-hour.browser.test.ts src/setup/recovery-hour.browser.test.ts src/setup/first-hour.a11y.browser.test.ts src/setup/recovery-hour.a11y.browser.test.ts` (browser mode: check memory); typecheck; the fiscal gates.
- [ ] **Step 4: commit.**

### Task 16a (setup app, database present): password first, then the lines

**Files:** `apps/setup/src/setup-app.ts` — the password-required catch `:1427-1441` (keep `params.seriesPicksUnreadable === true` in a private field); `#openPresentConfirmation` `:1491-1523` (with no stopped recovery, a damaged record inferred **and** the flag, call `session.damagedRecordSummary()` and keep it in its own field; a failure goes to `#presentReadsFailed` as the stopped path does); `#showsDamagedRecord` `:1591-1598`; the confirmation block `:2553-2595` (on this path draw the name-record lines and `namesFrom` from that summary); `#startAgainFirstSetup` `:1393-1461` (pass the summary to `retireDamagedRecord`). Tests `apps/setup/src/setup-app-resolution.test.ts` (beside `:1410` and `:1871`).

**`#showsDamagedRecord` (review I4).** Today, with the database present it draws "This setup's recovery-key record is damaged and cannot be read." whenever the confirmation step is open and no stopped summary is held (`:1594-1597`). With only the picks file damaged that line would be false. Change it so that whenever a summary is held (the stopped-recovery summary or the new damaged-record summary) it reads `summary.recoveryRecordDamaged === true`; with no summary held (a refusal without the flag, today's S7l flow) it stays as now.

- [ ] **Step 1: failing tests.** Database present: Start again → 403 `{ code: "setup.start_again_password_required", params: { seriesPicksUnreadable: true } }` → the password step (`damaged-record-password`) → after the password the page requests the summary → draws the series-picks line, `startAgainHelp`, `namesFrom`, the tick box, and **no `recovery-record-damaged` element** (I4) → Cancel sends nothing → Confirm sends `confirmUnreadable: { shown: <the summary> }` and no `recoveryRecordDamagedShown`. With the recovery-key record also damaged (summary has both): both lines, and the request carries both keys.
- [ ] **Step 2: controls (existing, unchanged):** a 403 with `params: {}` keeps today's damaged-recovery flow and requests no summary; the rows `:1496`, `:1664`, `:1683`, `:1871` pass unedited.
- [ ] **Step 3: run** `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts src/setup-app-resolution.unsaved.test.ts` (browser mode: check memory); typecheck.
- [ ] **Step 4: commit.**

### Task 16b (setup app, database present): a stopped recovery beside damaged names, and the accessibility checks

**Files:** `apps/setup/src/setup-app.ts` (the confirmation block draws `firstStoppedSummary.unreadable` lines when a stopped recovery is shown); tests `apps/setup/src/setup-app-resolution.test.ts` (beside `:1410`), `apps/setup/src/setup-app-resolution.a11y.test.ts` (a "damaged names" step loop beside `:136`).

- [ ] **Step 1: failing test.** A stopped recovery and a damaged picks file: after the password the stopped block, the name-record line and `namesFrom` are drawn, no `recovery-record-damaged` element unless the summary says so, and Confirm sends `confirmRecoveryDiscard.shown` carrying `unreadable` and no `confirmUnreadable`.
- [ ] **Step 2: axe**, both themes, both languages, 390 px and 1280 px, for the password step and the confirmation with damaged names, with and without a stopped recovery; nothing wider than the viewport.
- [ ] **Step 3: run** `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts src/setup-app-resolution.a11y.test.ts`; typecheck.
- [ ] **Step 4: commit.**

### Task 17 (driver or implementer): LOOK at it

Nothing to commit in the worktree. Model the script on A1042's `~/waitron-campaign/a1042-s7lb-shots/look.config.ts` and `look.test.ts`, in a new folder `~/waitron-campaign/a1099-shots/`, with every path pointed at this worktree. Run with `pnpm --filter @waitron/setup exec vitest run --config ~/waitron-campaign/a1099-shots/look.config.ts` (and a second config for `packages/fiscal-verifactu` for the wait line).

- [ ] **Step 1:** screenshots at **375 px** and **1280 px**, `en-GB` and `es-ES`, light and dark, of: (a) database missing, damaged picks (the Example 2 floor); (b) database missing, damaged recovery-key record and damaged public record together; (c) database present, the password step after the flagged refusal; (d) database present, the confirmation with damaged names; (e) the first-hour screen's "You can carry on from 18 Oct 2026, 15:45." line.
- [ ] **Step 2:** open every image (Read tool) and check: the lines are in the design's order; nothing overflows or wraps badly at 375 px; the date reads "16 Oct 2026" / "16 oct 2026"; the warning is readable in dark mode; in (d) there is no recovery-key line. Fix and re-shoot anything that fails. Name the images in the ledger and the PR body.

### Task 18a (docs and guides)

Every claim checked against the built code (`CLAUDE.md` §1, "a behaviour change retires every receipt about the old behaviour").
- [ ] `docs/operations/first-live-fiscal-setup.md:86-128`: one paragraph on the damaged-name-record path — which records, what the page says (the approved words), the note keeps "name unknown" with a floor at the start of the minute after the attempt's newest file time plus 150 seconds, that the password step's own writes usually set that time (so it is a few minutes after the password), and that a later setup waits for it ("You can carry on from …"). Correct `:87-89` ("keeps one small note of the last invoice series name the attempt chose") and `:124-125` (confirmation records are now also written with the database present past a damaged picks file).
- [ ] `apps/server/src/guide/en/backup-recovery.md` and `apps/server/src/guide/es/backup-recovery.md`, section `{#interrupted-setup}`: a short paragraph in each (the page is a screen this guide describes; `CLAUDE.md` §3, "a screen change updates its guide in English and Spanish"). Spanish in the guide's «tú» register.
- [ ] `deploy/README.md:358-366` and `apps/server/README.md:50-60`: the note may hold no name, only a time; the confirmation record's cases.
- [ ] `docs/developers/conventions-data.md:3624` and `docs/developers/workflow-guide.md:336`: "later than the name the start-again note keeps" → the note's floor; `conventions-data.md:4700-4706`: add the A1099 raiser beside A1098's.
- [ ] Root `CLAUDE.md` §5, the "Re-registering starts a new chain…" rule (`:773`; its note clause is at `:776`): a few words after A1098's clause — "; a Start again past a damaged name record raises it to the start of the minute after the attempt's newest file time plus 150 seconds, A1099". The root file is format-checked: `pnpm exec prettier --check CLAUDE.md`.
- [ ] **A dated pointer in a historical plan (review M5).** `docs/superpowers/plans/2026-10-24-a1042-start-again-series-note.md:71` lists "two stated exceptions" to "missing, partial, corrupt or unreadable never counts as empty". Add one dated line after it, without rewriting it: "2026-10-27, A1099: a third — a damaged name record counts as an unknown name with a time floor (`docs/superpowers/plans/2026-10-27-a1099-damaged-names-start-again.md`)."
- [ ] Guards: `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`; `pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts`.
- [ ] Commit.

### Task 18b (backlog entries and the item counter)

- [ ] Take **five** item numbers from `~/waitron-campaign-shared/next-item-number` (read, use, write back; it read `A1154` on 2026-10-27). Each entry is a section in `docs/backlog/self-service-refusals.md` (under the setup-state follow-ups, `:696-698`) and an index line in `docs/backlog.md` under "The setup wizard, onboarding and the demo venue" (`:438-452`), in the existing "A1089: …" style with an `[Audit](...)` link:
  - **(i)** a damaged `first-setup.json` or claim marker refuses `setup.owner_required` at the password step (database missing) and `setup.attempt_conflict` (present);
  - **(ii)** an unreadable venue database with the file present refuses `setup.not_ready`; it could be treated as missing so that the missing-database ask applies;
  - **(iii)** a damaged note is refused only after the summary is shown (and after Start again has written its confirmation record), and blocks every later naming; a file time past the naming range (`END_MS`, `hour-selection.ts:69`) would block naming on the box for good;
  - **(iv)** with the database present, a public record or a documents file refuses `setup.not_ready` whether damaged or intact (difference D-4, PROBE 9), so a damaged one there still dead-ends;
  - **(v)** a stopped backup recovery whose copy of the picks file is damaged, with no input in its journal, still refuses the summary `setup.not_ready` (`apps/server/src/first-setup-start-again-backup.test.ts:590-647`, "a stopped recovery whose journal %s and whose copy's picks %s refuses the summary"); and, with the database present, an abandoned recovery not yet emptied beside a damaged picks file still refuses `setup.attempt_invalid` (Task 10b, review M8).
- [ ] `docs/backlog/self-service-refusals.md:458` (the `shell.first_setup.attempt_invalid` "Route" line) and the A1089 setup-state index line (`docs/backlog.md:450`): say A1099 lets Start again go past a damaged name record after a warning; the remaining places stay listed.
- [ ] A1145 (`docs/backlog.md:503-505`, `docs/backlog/setup.md:539-548`): it no longer "waits for A1099's name unknown note" — the note can now hold `lastName: null`; the entry stays open (building it is its own item).
- [ ] Commit. (`docs/` is ignored by prettier; check with `pnpm exec prettier --file-info docs/backlog.md`, which should print `"ignored": true`.)

### Task 19 (driver): finish

- [ ] Re-run every focused command from Tasks 1–16b, the fiscal gates, and the root guards `scripts/start-again-note-writers.test.ts`, `scripts/module-seams.test.ts`, `scripts/errors-reachable.test.ts`, `scripts/english-only.test.ts`, `scripts/personal-log-params.test.ts`, `scripts/guide-links.test.ts`, `scripts/native-form-fields.test.ts`, `scripts/style-token-names.test.ts`. No whole-workspace run; CI owns the package suites.
- [ ] `git diff b8a06f203 --stat -- '*.test.ts'` and read every changed test hunk: the only edited assertions are approved changes 1–3.
- [ ] `/finish-branch` FULL (Codex run-it seat ×2). The PR body lists approved changes 1–3, the "Owner points for the PR" at the top of this plan, and the risks below. Park `needs-owner-review`.

---

## Risks and open points

- **R-1 (owner point 1): the floor is usually a few minutes after the password, not the attempt's last write.** PROBE 8: the password step rewrites `first-setup.json` and the claim and writes ownership-recovery records, all in the design's list. So "New series names can start from" will usually show a time about 3 minutes after the person entered the password, and the next setup may wait that long. Example 1's "14:54" would read about "15:08". Built as D1 says (the safe side). If the owner wants Example 1's time, the list would have to leave out what the repair itself writes — a change to the approved design.
- **R-2 (owner point 2): with the database present, only a damaged kept picks file gets the way out.** A public record or a documents file refuses `setup.not_ready` on that path whether damaged or intact (PROBE 9). That dead end predates this item: `git log -S` finds both checks (`allowed` in `first-setup-unused-assignment.ts` and `noOtherHistory` in `first-setup-resolution.ts`) arriving in `4e318802f` (#1752, A679, 2026-10-20). Backlog entry (iv).
- **R-3 (owner point 4): the reached line when the only name was in the damaged picks file.** The summary's `lastName` is what the readable records show (D-6). If the attempt was cut between picking a name and saving it in `first-setup.json`, the page says "chose no invoice series name" above the line saying the record of chosen names is damaged. Both sentences are true of their own record; the owner may want different words.
- **R-4 (owner point 3): the wait line's date words are derived, not approved.** EN "You can carry on from {date}, {time}." and ES "Podrás seguir a partir del {date} a las {time}." follow the approved `namesFrom` pattern.
- **R-5 (owner point 5): the page shows this attempt's floor, not a later one an older note already holds.** If an earlier Start again left a note with a later floor, `raiseStartAgainNote` keeps it, and the page's time is earlier than the one the box enforces. The chooser's own "You can carry on from …" then names the real time. Reading the note into the summary would move the damaged-note refusal (backlog entry (iii)) earlier, which is out of scope.
- **R-6: a stopped backup recovery's damaged picks copy still dead-ends (review M6).** A stopped backup recovery whose copy of the picks file is damaged, with no input recorded in its journal, still refuses the summary `setup.not_ready` (`apps/server/src/first-setup-start-again-backup.test.ts:590-647`). That reader is the stopped-recovery path (`first-setup-resolution.ts:229-241`), not the attempt's name records, and is outside the approved design. The same goes for review M8's case (an abandoned, not yet emptied recovery beside a damaged picks file, database present), which Task 10b keeps refusing. Both are backlog entry (v).
- **R-7: not verified here.** File-time behaviour (design F4) was measured on macOS APFS, not on the box's Linux ext4. The other writer through the same picks seat, `packages/fiscal-verifactu/src/hour-dormant-standby.ts:162`, was not traced (design D1 says the same). The design's clock-step behaviour was modelled with `utimes`, never with a real clock step.
- **R-8: the error parameter is new surface.** `setup.start_again_password_required` gains an optional `seriesPicksUnreadable`. An unauthenticated caller learns that the picks file is damaged, which the password step reveals anyway. The page treats a missing flag exactly as today.

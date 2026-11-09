# A1466: setup and restore make the series by themselves — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`. Keep the ledger `docs/handoffs/2026-11-09-a1466-series-made-by-themselves.md` current at the end of every task.

**Goal:** nobody presses a button to make the invoice series. The first-setup page makes them once the box's clock is confirmed and the person has ticked "The country, place, time zone and displayed time are correct."; the restore page makes them once the clock is confirmed and the person has added the recovery key and ticked both statements. The three first-visit cases the A1385 run-it seat found stop being cases at all. Both pages' words, the restore guide (English and Spanish) and the two runbooks say so.

**Architecture:** page-only. Each page's two request paths today (`#compare`, which reads the clocks and asks the box for a preview, and `#select`, which reads the clocks again and asks the box to choose) become one path, `#run`, that reads the clocks, explains whatever stops it, and asks the box to choose as soon as the person's part is done. The server is not changed: `hour-selection.ts` already records a wait, reuses it, and answers with the name (M3). The pages stop asking for the preview, so `ClockWait.showPreview` goes. "Make the series" goes from both pages and "Compare clocks" from the restore page; "Check again" stays as the one retry.

**Tech stack:** TypeScript, Lit pages tested in real Chromium (`--project browser` in `packages/fiscal-verifactu`; `apps/setup` runs its tests in the browser), one Playwright end-to-end case in `apps/server`.

**Spec (the owner's words and where they are recorded):**
- 7 Nov, `~/waitron-campaign-b/questions.md` "WATCHER 2026-11-07 10:31": "making a new series is not a problem, we can make 1000 and throw each one away without using them, the first invoice is the real commitment to that series." "it should be automatic. the user shouldn't need to answer the question of whether we need a new series or not … refreshing the page doesn't change that". A retry taking a second series name is fine (point 4).
- The rule under those words, as the watcher wrote it the same day (same section, point 2): "setup and restore make the series by themselves once the clock is confirmed; nobody is asked", relayed again on 8 Nov ("WATCHER 2026-11-08 09:39", point 2).
- 9 Nov 13:15 (same file, "WATCHER 2026-11-09 13:15 — owner: keep the "details are correct" tick"): "the series starts by itself once the clock is confirmed and the tick is given."
- 9 Nov 13:13 (same file): the run-it seat's three first-visit cases go to A1466.
- `docs/backlog/setup.md:601-604`, decision "The setup and restore pages carry on by themselves, pressed or not, reloaded or not".
- Owner, 8 Nov: no code or test for an event that cannot really happen at a venue. Owner, 9 Nov: the test rules in "Tests" below.

**Base:** main `5766fc72d8` (includes #2532, A1385, and #2638, A1379 part 2). Line numbers are on that commit; match by name when a line has moved.

**Review weight: FULL.** Risk trigger: invoice series names (a fiscal invariant). `/finish-branch` runs the Codex run-it seat twice (the second sets this checklist aside). One pull request. The **owner lands it** (fiscal package).

## Global constraints

- **No server, schema or migration change.** No task edits `hour-selection.ts`, `hour-preparation.ts`, `hosted-hour-recovery.ts`, `initial-hour-setup.ts`, `apps/server/src/recovery-preparation.ts`, or anything under `packages/*/src/schema/`. If a step seems to need one, stop and report.
- **The fiscal core is untouched.** After every task that touches `packages/fiscal-verifactu`, these pass **unedited**:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts` (20 tests on the base, run while writing this plan).
- **No new error code and no new `reason`**, so `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts` do not apply. `packages/fiscal-verifactu` is outside `scripts/english-only.test.ts`'s scope by the root `CLAUDE.md` exception.
- **User-visible words are only those in "Words for the owner".** English and Spanish change together.
- **Refusals** say what happened and what each choice does, and never send the person to somebody else (root `CLAUDE.md` §3). The two existing "ask for help" sentences are Q2's, not this plan's (they predate it: `git blame` gives A947 slice 4a, #1990, 2026-10-24, for `first-hour.ts:90-91` and `recovery-hour.ts:65-66`).
- **Tests** (owner, 2026-11-09): each property has one owner layer; a dependency's failure modes are tested once, at that dependency, and a caller only for what it does differently with each answer; before asserting that something asynchronous did NOT happen, run the timers to a stated end point and show once (in the commit message, not kept) that the assertion fails when the effect is forced; reuse the existing test support (`mount`, `ready`, `scripted`, `gatedClocks`, `fakeClock`, `actionsOf`, `selects`) before adding helpers; leave existing tests where they are. **A test that has to be edited to pass is a STOP unless its edit is in a class or a row of "Changed test checks".**
- **Browser runs:** check `memory_pressure | grep free` first; run beside another session only well above 15% free.
- Run tests with `AI_AGENT` and `CLAUDECODE` unset when output matters (`env -u AI_AGENT -u CLAUDECODE …`). Read the `Tests` count, never a pipe's exit status.
- Every commit `git commit -s`, message in plain English. Every task ends with `pnpm format:check` and `pnpm exec eslint <changed files>`.

## What was measured or read before writing this plan

**M1. On a first visit nothing is asked for until someone presses (run).** Throwaway (Codex's probe patch from the #2532 review, `~/waitron-campaign-b/a1385-rework/codex-probes.patch`, applied, plus four probes of mine appended to the two page test files; both files then restored with `git checkout --`, and `git status --short` printed nothing). Stated beforehand: if a page already started by itself, the "no press" probes would list a `candidates` (setup) or any request (restore) and their assertions would fail. Command, from `packages/fiscal-verifactu`: `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run --project browser src/setup/first-hour.browser.test.ts src/setup/recovery-hour.browser.test.ts -t "REVIEW|PROBE"` printed `Tests 4 failed | 4 passed | 141 skipped (149)` (the notes in brackets are mine):

```
PROBE-SETUP-NOPRESS ["clock-challenge","compare-clocks","selection"]          (tick given, 300 s of timers: passed)
PROBE-SETUP-PRESS   [...,"selection","clock-challenge","compare-clocks","candidates","input"]   (control: a press)
PROBE-RESTORE-NOPRESS []                                                       (key and both statements, 300 s: passed)
PROBE-RESTORE-COMPARE ["clock-challenge","compare-clocks","preview"]
PROBE-RESTORE-PRESS   [...,"preview","clock-challenge","compare-clocks","select"]   (control)
× REVIEW setup with no second clock carries on without a press        expected [] to have a length of 1 but got +0
× REVIEW setup after expired wait carries on without a press          expected [] to have a length of 1 but got +0
× REVIEW restore after expired wait carries on without Make the series   expected [] to have a length of 1 but got +0
× REVIEW restore with a taken minute carries on without Make the series  expected [] to have a length of 1 but got +0
```

The two setup REVIEW probes never tick the details, so under the owner's 9 Nov ruling they stay "nothing is asked for"; what they become is in D1.

**M2. Why, in the code (read).**
- *Setup page.* On load, `#compare` (`packages/fiscal-verifactu/src/setup/first-hour.ts:285-304`) reads the clocks and asks for a preview (`{ action: "selection" }`, `:298`); any clock refusal of that preview is dropped without an explanation or a re-check (`:299-300`), which is the "setup offline at first load never resumes" case. Only "Make the series" (`:599-605`) calls `#select` by hand, and only when `#canSelect` holds, which needs the tick (`:265-268`, `:307`). `#compare` also clears the tick (`:292`).
- *Restore page.* Nothing is sent until "Compare clocks" (`recovery-hour.ts:462-468`), enabled only with the key and both statements (`#canCompare`, `:252-254`). `#compare` asks for a preview (`:302`) and drops a taken-minute refusal on purpose (`:304-306`), which is the third run-it case. Only "Make the series" (`:469-475`) sends `select`.
- *Both.* `ClockWait.showPreview` (`clock-wait.ts:236-245`) shows only a preview with time left; anything else changes nothing.

**M3. What the box answers (read; the two cases run).** A preview counts down only a wait already recorded and with time left (`hour-selection.ts:468-471`); otherwise it answers `status: "preview"` (`:492`), so a reload after the wait has passed looks exactly like a first visit (the second run-it case). A `select` (setup's `candidates`) reuses a recorded wait up to a minute past its target (`:424-428`, `WAIT_REUSE_MS` `:63`), records a fresh 90-to-150-second one after that (`:472-480`), and returns the name already chosen if there is one (`:409-411`, `:423`). Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-selection.test.ts -t "reused up to a minute|a preview reports a recorded wait"` printed `Tests 3 passed | 101 skipped (104)` ("a recorded wait is reused up to a minute past its target: select at %s", `hour-selection.test.ts:1080-1096`; "a preview reports a recorded wait, and with none answers preview, writing nothing", `:1024-1037`). So no server change is needed for any trigger in D1.

**M4. The restore page cannot ask anything before the key and both statements (read).** Every restore preparation request, the clock challenge included, goes through `withRecoveryKeyAuthority` with the key (`apps/server/src/recovery-preparation.ts:321-326`) and is refused unless both statements are true (`:337-340`). So "on load" for the restore page means "as soon as the key and both statements are in".

**M5. The setup app asks for the administrator password on the page's first `candidates` (read).** `initial-setup-screen.ts:151-160` wraps `candidates` with `#password("block-use")`; `first-setup-session.ts:478-517` keeps the grant in memory after a wait, so a countdown's own re-check asks nothing, and a reload asks again. After this change that prompt follows the tick instead of the press (Q4).

**M6. What a reload is (read).** Setup: the event comes from the server's first-setup attempt (`packages/fiscal-verifactu/src/initial-setup.ts:100-112` accepts only the binding the server gives for that attempt), so the box's recorded wait and chosen name survive a reload (M3). The page's tick is held in memory only (`first-hour.ts:191`, `empty()` `:53`), so a reload clears it. Restore: every mount makes a new restore event (`apps/setup/src/screens/recovery-allocation.ts:119-123`; its only mount passes no binding, `recovery-copy.ts:342-347`), and a reload opens the setup app's first screen (`apps/server/src/guide/en/backup-recovery.md:167-170`), so a reloaded restore is a new restore with no recorded wait.

**M7. Other callers (read, `git grep`).** The box's preview stays: the setup command uses it (`initial-hour-setup.ts:184`). `showPreview`'s only callers are the two pages (`first-hour.ts:298`, `recovery-hour.ts:302`). The dashboard's identity-conflict page has its own "Compare clocks" and never switches by itself by design (`packages/fiscal-verifactu/src/dashboard/conflict-recovery-strings.ts:24,39`); it is not changed.

**M8. Guard baselines (run).** Golden huella and immutability: 20 passed. `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`: 44 passed. `pnpm exec vitest run scripts/guide-links.test.ts`: 25 passed. The two page test files hold 141 cases (M1's skipped count).

## Decisions

**D1. What starts the series.**

| Page | Starts by itself when | Stops when |
| --- | --- | --- |
| Setup | the page loads (clocks read; nothing else until the tick); the details tick is given; a countdown reaches zero; a 15-second check while no second clock answers (it now starts on load too); **Check again** | the tick is taken away (the wait in progress on the page stops; the box keeps its wait); the series are made |
| Restore | the recovery key decodes and both statements are ticked, in any order; a countdown reaches zero; a 15-second check; **Check again** | the key or either statement changes or is cleared (it starts again by itself once all three are back); **Clear**; leaving the page; the series are made |

On both pages the box is asked to choose only when the clocks agree (a second clock within 30 seconds, `hour-selection.ts:383`, unchanged) **and** the person's part is done. So the run-it seat's cases become: setup with no second clock on load now explains itself and checks every 15 seconds, and makes the series once a clock answers **and** the tick is given; a reload after the box's wait has passed is a first visit (the page asks with `select`, which records a fresh wait, M3); the restore page's taken-minute countdown now comes from `select` and counts down and checks again as it does today after a press.

**D2. The pages stop asking for a preview.** With D1 the preview's only use was showing a recorded wait before anyone had asked: on setup that countdown would wait for the tick anyway, and a restore page never has one (M6). `ClockWait.showPreview` is deleted with its two callers. The box's preview action stays (M7).

**D3. Check again keeps the details tick.** `first-hour.ts:292` clears it on every comparison (since A947 slice 4a). The tick confirms the place, the zone and the time the page shows; every later reading of the same clock is checked against a second clock anyway. Keeping the clear would make each Check again, and each 15-second check, wait for a fresh tick, which is a press.

**D4. Buttons.** "Make the series" goes from both pages; "Compare clocks" goes from the restore page, whose first button always reads "Check again". Check again is the one retry: after a failure, a clock refusal, or to ask the box again.

**D5. One path per page.** `#compare` and `#select` become `#run(automatic = false)`: read the clocks; stop with the release or range line if blocked; wait for a second clock (15-second checks) or show the disagreement; stop with the start hint if the person's part is not done; otherwise ask the box (`candidates`/`select`, or setup's `request()` when the attempt is not `claimed`, as today at `:321`) and handle the answer exactly as `#select` does today (`first-hour.ts:322-347`, `recovery-hour.ts:327-348`). `ClockWait`'s re-check calls `#run(true)`. A run the person started clears what the page explains first (`automatic = false`), as a press does today.

**D6. Not built.** Restarting when the same page element is taken out and put back (the `apps/setup` unsaved-changes test does that; this plan found no app path that does it outside a test, read only: `initial-setup-screen.ts:173` creates the module once per state). Check again still works there.

**D7. Every refusal's next step after the change.**

| What the page meets | What it shows | What happens next |
| --- | --- | --- |
| No second clock | why, and: connect the box to the internet, or open the page on a phone or till (setup, with the setup password) or a phone or laptop that has the backup (restore) | checks every 15 s and carries on by itself; setup also needs the tick (the start hint stays up) |
| Clocks more than 30 s apart | both readings, why, "try from another phone or till …: ask for help" | nothing by itself; Check again. **The words are Q2's** |
| Box time before this release / date outside the name range | one line | nothing by itself (unchanged; release time is Q2's) |
| A later minute in use (`minute_not_later`) | one line | unchanged |
| The next free minute is taken | "The auto-generated invoice series code … already exists" and a countdown | counts down and checks again by itself (unchanged; on restore it now follows the page's own `select`, D1) |
| This attempt's own name found taken (no time) | fault in Waitron; restore adds "reload and start the restore again" | unchanged; Q3 (A1223) |
| A request lost, or an answer the page cannot read, on load or a run the person started | the page's failure line: setup "Could not complete this step. Check again."; restore, new words (table below) | Check again; on restore, editing the key or a statement also starts again |
| The same during a countdown or 15-second wait | nothing new | keeps counting and checks every 15 s (unchanged, `clock-wait.ts:253-268`) |
| Restore key refused by the box | "Check the key for this backup." at the key | a corrected key starts again by itself |
| Setup password prompt cancelled | the failure line | Check again |

**D8. What a reload does.**
- *Setup:* the page reads the clocks and shows them, the tick is clear (M6). Once the person ticks, the setup app asks for the password (M5) and the page asks the box, which returns the name already chosen, takes the name at once if its recorded wait ended less than a minute ago, or records a new 90-to-150-second wait (M3).
- *Restore:* a new restore (M6). Once the key and both statements are in again, the page carries on by itself with a new wait.

## Words for the owner

| Where | Now | Proposed (EN) | Proposed (ES) |
| --- | --- | --- | --- |
| Setup page, below the tick, while the clocks are shown, the tick is clear and nothing is chosen (new `startHint`) | nothing | Once you confirm the details above, the series are made by themselves. | Cuando confirmes los datos de arriba, las series se crean solas. |
| Restore page, above the buttons, until the key and both statements are in (new `startHint`) | nothing | Once you add the key and confirm both statements, the series are made by themselves. | Cuando añadas la clave y confirmes las dos declaraciones, las series se crean solas. |
| Restore page failure line (`failed`, `recovery-hour.ts:55`, `:86`) | Check the fields and compare clocks again. / Revisa los campos y vuelve a comparar los relojes. | Check the fields, then press “Check again”. | Revisa los campos y pulsa «Comprobar otra vez». |
| Setup page button "Make the series" / «Crear las series» (`first-hour.ts:77`, `:116`) | button | removed | removed |
| Restore page buttons "Compare clocks" / «Comparar relojes» and "Make the series" (`recovery-hour.ts:47-48`, `:78-79`) | buttons | removed; the first button always reads "Check again" / «Comprobar otra vez» | — |
| Restore guide, `apps/server/src/guide/en/backup-recovery.md:149-150` | Choose **Compare clocks**. Follow the clock and waiting instructions; there is no installation code to type. Choose **Make the series** once the page allows it; it then shows the new series name. | Once you add the key and tick both statements, the page compares the clocks and makes the series by itself; there is no installation code to type. Follow any waiting instructions it shows. It then shows the new series name. | (`es/backup-recovery.md:162-164`) Cuando añadas la clave y marques las dos declaraciones, la página compara los relojes y crea las series sola; no hay ningún código de instalación que escribir. Sigue las instrucciones de espera que muestre. Después muestra el nombre de las nuevas series. |

Unchanged: the wait words, "It carries on by itself once the box reaches the internet …" (on the setup page once the details are ticked; the start hint says so beside it), the taken-minute words, the fault-in-Waitron words. The setup page has no staff guide section (`git grep` of `apps/server/src/guide` finds none); its runbook is `docs/operations/first-live-fiscal-setup.md` (English only, as every runbook).

## Owner questions

**Q1. After a reload during the setup's wait, must the details be ticked again?** Example: the owner ticks, the box records a 2-minute wait, the browser reloads at 1 minute. *Default (built):* yes. The page asks the box only while the tick is given, which is the 9 Nov ruling read literally; the box keeps its wait, so ticking within a minute of its end takes the name at once (M3). It changes one #2532 case ("Changed test checks", row S5). *Alternative:* a wait the box already recorded carries on with no tick, as #2532 built; it needs the page to remember that the countdown it shows came from a recorded wait, about 15 more lines and the preview kept on setup.

**Q2. The clocks disagree (A1420's page side).** Both pages say "If they still differ, the box's time may be wrong: ask for help." (`first-hour.ts:90-91`, `:128-129`; `recovery-hour.ts:65-66`, `:96-97`), which sends the person to somebody else. If the owner's A1420 decision moves "what the page does when the box's clock and AEAT or the device disagree" here, it slots into D5's disagreement branch and the release line: an action beside the explanation that sets the box's clock through the host service from AEAT (or, for an administrator, from this device, the sources root `CLAUDE.md` §5 allows), after which the page runs again by itself. Roughly a new preparation action on the server (about 120 lines), the two pages (about 40), four sentences in each language and about 250 lines of tests: a second pull request on top of this one, or a Task 6 here. *Default:* not in A1466; these sentences stay as they are until A1420 or that follow-up changes them.

**Q3. A1223, a stored series pick found taken.** (The lane queue added A1223 to A1466 at 20:53 on 9 Nov; this plan's brief says to leave it as a question.) It does **not** fall out of this change for free:
- *Restore page:* costs a little. After A1466 the way out the page already names (reload and start again) needs only the key and two ticks; making it fully automatic means the page taking a new restore event itself and the setup app staging the copy again under it (`recovery-copy.ts:114-129` stages per event). About 30 lines in `recovery-hour.ts`, 10 in the setup app, 100 of tests: Task 5, written out below.
- *Setup page and both activations* (the setup app's at first setup, and a restore placed after the restart): separate. The setup's event is the server's first-setup attempt (M6), so a new attempt is Start again or a new server route; at activation the choice is made at start-up, not on a page.
- How often: A1385 found no path a venue can take to it (other attempts' picks cannot hold it; of the database's writers, a standby joining mid-attempt was not ruled out; its tripwire probe reached it only through hand-seeded test data).
*Default:* not built, under the owner's 8 Nov rule; Task 4 records it as a deliberate limit in `docs/backlog/setup.md` and deletes the A1223 entry and its bundle. *Alternative:* build Task 5 (restore page only) and keep a narrowed A1223 for the other three places.

**Q4. The setup app's password prompt now follows the tick.** Today it appears after "Make the series" (M5); after this change it appears as soon as the tick is given and the clocks agree. *Default:* keep it. It is the administrator's authority to use the setup's block, not a question about whether to make a series.

## Review focus

1. **No series without the person's part:** setup never calls `candidates` or `request` with the tick clear; restore never sends anything without the key and both statements (Tasks 1-2, new cases N2 and N5, each with a stated end point and a forced-effect control).
2. **Nobody presses:** with the tick (setup) or the key and statements (restore), the series are made with no button, through a countdown, a missing second clock that later answers, and a taken minute (N1, N4, row R1, and `recovery-hour.browser.test.ts:938` reached with no press).
3. **Taking the person's part away stops the page,** and putting it back starts again (N3, N6, row R14).
4. **Every changed test check** is in the table below and matches a ruling.

---

## Task 1: the setup page starts by itself

**Files:** modify `packages/fiscal-verifactu/src/setup/first-hour.ts`; tests `first-hour.browser.test.ts`, `first-hour.a11y.browser.test.ts`, `first-hour-reissue.browser.test.ts` (same folder).

**Interfaces:** `#run(automatic = false): Promise<void>` replaces `#compare` and `#select`; `ClockWait<Selected>(this, () => void this.#run(true))`; `#edit` ends with `if (this.draft.reviewed) void this.#run();`; `willUpdate` calls `#run()` where it called `#compare()` (`:222-225`). Strings: `startHint` added, `select` removed (EN and ES).

- [ ] **Step 1: write the new cases** in `first-hour.browser.test.ts`, with the existing `mount`, `ready`, `fakeClock`, `actionsOf`, `text`:
  - **N1** "with the clocks agreeing, ticking the details makes the series with no press": `fakeClock()`; mount; wait for readings; tick; `candidates` once with `{ comparisonId: "comparison-2" }`; `[data-test=selected-hour]` shows; then `vi.advanceTimersByTime(200_000)`, one macrotask, and the call count is unchanged (end point: past the 150-second wait bound and many 15-second checks).
  - **N2** `it.each(["en","es"])` "without the tick nothing asks for the series, and the page says the tick starts it (%s)": `fakeClock()`; mount; wait for readings; `advanceTimersByTime(200_000)`; one macrotask; no `candidates`, no `request`; the start hint shows in that language. Control for the commit message (not kept): with the tick check removed from `#run`, this case fails at the `candidates` count.
  - **N3** "taking the tick away during the box's wait stops the page, and ticking again carries on": `select` answers `waiting` 61 s then `selected`; `fakeClock()`; tick; countdown shows `1:01`; untick; no `[data-test=remaining]`; advance 120 s and one macrotask: `candidates` still 1; tick; `candidates` 2 and the name shows.
  - **N4** "with no second clock on load it explains itself before the tick, and makes the series once a clock answers and the tick is given": `fakeClock()`; mount with `decision: () => decision` (no second clock); the second-clock explanation shows with no tick; tick; still explained, no `candidates`; set the decision to `clock`; advance 15 s; `candidates` 1 and the name shows.
- [ ] **Step 2: run, watch N1-N4 fail** for the reason expected (no `candidates` after the tick; no explanation on load):
  `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/setup/first-hour.browser.test.ts -t "<the four case names, joined by |>"`.
- [ ] **Step 3: production.** In `first-hour.ts`: `#run` per D5 (keep `#begin`, the result checks at `:322-338` and `settle` unchanged); stop asking for `{ action: "selection" }`; drop the tick clear (`:292`, D3); `#edit` starts or stops per D1 (it already cancels and clears the wait, `:257-264`); remove the "Make the series" button (`:599-605`) and `#canSelect`'s use in it; render the start hint (`<p data-test="start-hint">`) when a comparison is shown, it is not blocked or in disagreement, the tick is clear and nothing is chosen. Delete comments that the change makes false.
- [ ] **Step 4: bring the existing cases over** by "Changed test checks": the class P edits (delete the press lines, e.g. `sed -i '' '/await userEvent.click(button(el, "select"));/d'`, then move each `fakeClock()` that sat between `ready(el)` and the press to before `ready(el)`, because the tick now starts the run), class C2, and rows S1-S15. The `quiet` helper (`:1235-1238`) reads `button(el, "compare")`. In `first-hour.a11y.browser.test.ts` tick once after the first `review` state and reach each later state with `click("compare")` (row A1). In `first-hour-reissue.browser.test.ts` delete the press only (class P).
- [ ] **Step 5: run the three files and the guards:**
  `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/setup/first-hour.browser.test.ts src/setup/first-hour.a11y.browser.test.ts src/setup/first-hour-reissue.browser.test.ts src/setup/clock-wait.browser.test.ts`
  and the golden pair (Global constraints). `apps/setup` and the server end-to-end case are expected to fail until Task 3; do not push before it.
- [ ] **Step 6: commit** ("The first-setup page makes the series by itself once the details are ticked (A1466)"), listing each changed check by its row and the N2 control's output.

## Task 2: the restore page starts by itself

**Files:** modify `packages/fiscal-verifactu/src/setup/recovery-hour.ts`, `clock-wait.ts` (delete `showPreview`, `:236-245`); tests `recovery-hour.browser.test.ts`, `recovery-hour.a11y.browser.test.ts`.

**Interfaces:** `#run(automatic = false)` replaces `#compare` and `#select`; `#startIfReady()` = `if (this.#canCompare) void this.#run();`, called at the end of the `recovery-key-change` handler (`:389-395`) and of `#edit` (`:196-202`); `ClockWait` re-check calls `#run(true)`. Strings: `startHint` added; `compare` and `select` removed; `failed` reworded (EN and ES).

- [ ] **Step 1: new cases** in `recovery-hour.browser.test.ts`, with `mount`, `ready`, `check`, `scripted`, `selects`, `fakeClock` (the first case also gains the end-point check of row R1):
  - **N5** `it.each(["en","es"])` "nothing is sent before the key and both statements, and the page says what starts it (%s)": `fakeClock()`; enter the key and one statement only; advance 200 s; one macrotask; `prepare` not called; the start hint shows in that language; tick the second statement: `select` once. Control for the commit message (not kept): with `#startIfReady` ignoring `#canCompare`, it fails.
  - **N6** "a corrected key after the box refuses the key makes the series by itself": `prepare` refuses the first call with `{ code: "promotion.break_glass_invalid" }`, then answers normally; `ready(el)`; "Check the key for this backup." shows; re-enter the key; `select` once and credentials returned.
- [ ] **Step 2: run, watch N5-N6 fail** (N5 at the hint and the `select` after the second tick; N6 at the `select`):
  `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/setup/recovery-hour.browser.test.ts -t "<names>"`.
- [ ] **Step 3: production.** `#run` per D5: read the clocks; stop on `releaseBlocked` or `rangeBlocked`; second clock or disagreement as `#select` does today (`:325-326`); then `select` and the answer checks of `:327-340`; `settle` unchanged. Remove the preview call and the comment at `:304`; remove "Make the series"; the first button reads `words.again` always; render the start hint while `!#canCompare` and nothing is chosen. Delete `ClockWait.showPreview`.
- [ ] **Step 4: bring the existing cases over** (class P: delete `button(el, "select").click()`, `await userEvent.click(button(el, "select"))` and the `await compare(el)` that only started the run, moving `fakeClock()` before `ready(el)`; class C1; rows R1-R15). In `scripted()` delete the `preview` branch and `state.preview`. In the a11y file drop the `compare` and `select` clicks and the `compared` state (row A2).
- [ ] **Step 5: run** both restore files, `clock-wait.browser.test.ts`, the two setup files from Task 1 (they share `clock-wait.ts`) and the golden pair.
- [ ] **Step 6: commit** ("The restore page makes the series by itself once the key and both statements are in (A1466)").

## Task 3: the setup app and the server's end-to-end case

**Files (tests only):** `apps/setup/src/setup-app-first-fiscal.test.ts` (`:525-527`), `setup-app-first-fiscal.unsaved.test.ts` (`:86-91`), `setup-app-key-reissue.test.ts` (`:164-170`), `setup-app.test.ts` (helper `compareClocks`, `:5718-5745`, and `:5794-5795`), `screens/recovery-hour.test.ts` (`fill`, `:105-145`), `screens/recovery-allocation-binding.test.ts`; `apps/server/src/first-fiscal-document-download.e2e.test.ts` (`:226-231`).

- [ ] **Step 1:** delete each click on `[data-test=select]` and each first click on `[data-test=compare]` (class P). In the end-to-end case register `waitForResponse(…/first-setup/candidates)` before `.check()` on the tick. Rename `compareClocks` to `fillRecoveryHour` and fix its comment (the page then stages and prepares by itself). `setup-app.test.ts:5794-5795` take the new `failed` words (row X1). If the unsaved-changes case's tick now opens the password prompt and that blocks its navigation, give its fixture a comparison with no second clock so the run stops before `candidates` (a fixture change; its checks stay).
- [ ] **Step 2: run:** `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts src/setup-app-first-fiscal.unsaved.test.ts src/setup-app-key-reissue.test.ts src/setup-app.test.ts src/screens/recovery-hour.test.ts src/screens/recovery-allocation-binding.test.ts` and `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/first-fiscal-document-download.e2e.test.ts`.
- [ ] **Step 3: commit.**

## Task 4: words in the guides and runbooks, and the backlog

**Files:** `apps/server/src/guide/en/backup-recovery.md:149-150`, `es/backup-recovery.md:162-164` (words table); `docs/operations/first-live-fiscal-setup.md:15-70` and `docs/operations/hour-recovery.md:100-185` (rewrite the flow paragraphs to D1, D7 and D8, cite the new and renamed cases by name, drop "Before you press Make the series…", "after you press Make the series", "A reload before the box's own wait begins … press Make the series again", and the "whether or not Make the series was pressed" sentences); `docs/developers/conventions-data.md` (`git grep -n` each renamed case name and fix its citation); `docs/backlog/setup.md:601-604` (the decision becomes: setup and restore make the series by themselves; setup waits only for the details tick, restore for the key and both statements; owner 2026-11-07, 2026-11-09); per Q3's default, add the A1223 deliberate limit there and delete the A1223 entry (`:417-426`) and the bundle that holds only it (`:519-526`), with `docs/backlog.md:392`'s A1385 line.

- [ ] **Step 1:** edit; then `git grep -n "Make the series\|Crear las series\|Compare clocks\|Comparar relojes" -- apps/server/src/guide docs/operations docs/developers` finds only the identity-conflict page's lines (`box-status.md:92`, `es/box-status.md:97`, `hour-recovery.md:17`, M7) and dated history.
- [ ] **Step 2: run** `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` (44 on the base), `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/guide-links.test.ts` (25), `pnpm exec prettier --file-info` on each changed `docs/` file before trusting `format:check` there.
- [ ] **Step 3: commit.**

## Task 5: (only if the owner answers Q3 "build") the restore page starts a new restore when its own name is found taken

**Files:** `recovery-hour.ts`, `apps/setup/src/screens/recovery-allocation.ts`; tests `recovery-hour.browser.test.ts`, `apps/setup/src/screens/recovery-hour.test.ts`.

- [ ] Test first: a `select` refused `minute_in_use` with no time, then `selected` under a new `eventId`: the page sends the second `select` with a binding whose `eventId` differs and whose other fields are equal, keeps the key and statements, and returns credentials carrying the new binding. Then: on that refusal `#run` replaces `context.binding.eventId` with `crypto.randomUUID()` (without `clear()`) and runs again by itself, once per page load; the restore page's `inUse` addition becomes "Starting a new restore with a new series name." / «Empezando una restauración nueva con otro nombre de serie.» (owner to approve). Keep a narrowed A1223 for the setup page and both activations. About 30 + 10 lines of code, 100 of tests.

---

## Changed test checks

**Classes** (each listed case by name in the commit message; no per-line row):
- **P, the press is gone (no check changes).** The case's only edits are: deleting the "Make the series" press, or a "Compare clocks"/`compare(el)` that only started the run; moving `fakeClock()` before the tick or `ready(el)` that now starts the run; registering a wait before the tick (Playwright); renaming "press" to "tick" in a case name. Its `expect`s are untouched. Setup: every case in `first-hour.browser.test.ts` not in a row below that presses today (`:275`, `:300`, `:341`, `:458`, `:489`, `:506`, `:545`, `:562`, `:589`, `:634`, `:680`, `:714`, `:753`, `:827`, `:868`, `:921`, `:1071`, `:1105`, `:1129`, `:1203`, `:1285`, `:1308`, `:1333`, `:1354`, `:1380`, `:1407`, `:1421`, `:1450`, `:1535`), and `first-hour-reissue.browser.test.ts`. Restore: every case in `recovery-hour.browser.test.ts` that presses and is not a row. Apps: Task 3's files except row X1.
- **C1, restore comparison numbers.** Where the deleted "Compare clocks" made a comparison of its own, a `comparisonId: "comparison-N"` or a count of `compare-clocks` goes down by exactly one (for example `:647-648`, `comparison-2`/`comparison-3` → `comparison-1`/`comparison-2`). Ruling: O8 (nobody presses).
- **C2, setup 15-second checks before the tick.** Where a case's comparison count includes checks that now also run from load with no second clock (D1), the count rises by exactly those checks. Same ruling.

Anything else is a STOP.

**Rows.** Ruling key: **O8** = the owner's rule of 7 Nov 10:31, relayed 8 Nov 09:39 point 2 (nobody is asked); **O9** = owner 9 Nov 13:15 (keep the tick); **OC** = 9 Nov 13:13 (the run-it seat's cases go to A1466); **D2/D3/D4** = this plan's decisions, which follow from O8.

| Row | File:line, case | Before | After | Ruling |
| --- | --- | --- | --- | --- |
| S1 | `first-hour.browser.test.ts:208-229`, "automatically compares clocks and shows … before selection" | after the tick: no `candidates`, Make the series enabled | the texts and the two clock calls are checked before the tick; no `candidates` before it (the hint and the end point are N2's) | O9, D4 |
| S2 | `:251`, "requires the scope confirmation then imports only selected server input" | Make the series disabled before the tick | that line deleted (button gone; the property is N2's); the rest unchanged | D4 |
| S3 | `:296`, "keeps %s selection blocked" | Make the series disabled | deleted; "no `candidates`" stays | D4 |
| S4 | `:364-379`, "a reload during a wait shows the server's time left" | on load with no tick: `1:01` from the preview; calls `[challenge, compare, selection]` | deleted: with no preview, the time left comes from the box's answer to the tick, which is S5's (it checks `1:01` after the tick and nothing counting before it) | O9, D2 |
| S5 | `:383-408`, "a reload during the box's wait makes the series by itself at zero, with no press or tick" | series made at zero with the tick clear | renamed "… at zero once ticked, with no press": no countdown before the tick; tick; `1:01`; series at zero; nothing more in 120 s; the no-tick half is N2's | O9 (Q1 default) |
| S6 | `:410-447`, "Check again after Make the series still makes the series by itself at the end of the wait" | Check again clears the tick (`:439`); the preview's wait carries on | renamed "Check again during the box's wait keeps the tick and the wait": the tick stays ticked; Check again's own `candidates` returns the wait; the series at its end | O8, D3 |
| S7 | `:449-456`, "shows no countdown before a press when no wait is recorded" | calls `[challenge, compare, selection]` | renamed "… before the tick"; calls `[challenge, compare]` | D2 |
| S8 | `:621` in "a minute in use shows one countdown …" | Make the series quiet during the countdown | deleted | D4 |
| S9 | `:749`, "allows retry after a request refusal" | Make the series enabled | Check again enabled, and pressing it asks again | D4 |
| S10 | `:947`, `:971`, malformed challenge / comparison | Make the series disabled | deleted; "no readings" stays | D4 |
| S11 | `:1004`, "refuses malformed hour result %j … and permits retry" | Make the series enabled | Check again enabled | D4 |
| S12 | `:1239-1248`, `:1255-1262`, "draws Make the series quiet and disabled while …" (two cases) | the button's state | both cases deleted (button gone) | D4 |
| S13 | `:1371`, `:1398` | `quiet` read Make the series | `quiet` reads Check again; values unchanged | D4 |
| S14 | `:1468-1512`, "a preview refused for %s on load shows the readings with no failure and no explanation" | no explanation, nothing more sent in 45 s | renamed "%s found on load is explained, with no failure": no second clock → its explanation and a check every 15 s; disagreement → its explanation and nothing sent in 45 s | OC, O8 |
| S15 | `:1514-1533`, "… release line when the preview is refused" | stub refuses the preview | renamed "… release line"; the stub's preview refusal goes (never called); checks unchanged | D2 |
| A1 | `first-hour.a11y.browser.test.ts:165-183` | each state: Check again, tick, Make the series | tick once after `review`; each later state by Check again; `review` now also shows the start hint under axe; states and checks unchanged | D4 |
| R1 | `recovery-hour.browser.test.ts:185-222` | Compare clocks, then Make the series | class P, plus the end-point check moved from row R9 | O8 |
| R2 | `:223-234`, "requires both explicit isolation declarations" | all three in, then each statement taken away: nothing sent | the key and one statement at a time: Check again disabled, nothing sent (all three in now starts the run) | O8 |
| R3 | `:437-446`, "all three actions expose a visible native button" | `compare`, `select`, `clear` | renamed "both actions …": `compare`, `clear` | D4 |
| R4 | `:531-544`, "keeps Select quiet while the clock has a blocking condition %j" | Make the series disabled | renamed "sends no select while …": `selects(prepare)` empty | D4 |
| R5 | `:545-560`, "… release line when the preview is refused" | stub refuses the preview | renamed "… release line"; checks unchanged | D2 |
| R6 | `:561-594`, "a preview refused for a taken minute starts no countdown and sends no select" | no countdown, no `select` | deleted: the page asks no preview; a taken minute from `select` counting down and checking again is `:938`'s, now reached with no press | OC, D2 |
| R7 | `:679-697`, "Check again during a wait shows the server's time left" | preview's wait; calls `[challenge, compare, preview]`; Make the series quiet | deleted: with no preview, Check again during a wait showing the box's time left is R10's (it checks `1:01` after Check again) | D2, D4 |
| R8 | `:698-722`, "Compare clocks with no second clock explains the wait and checks again by itself" | reached by Compare clocks | deleted: with no press it is `:801` "with no second clock it explains itself and carries on when the internet arrives"; its "no failure message" check moves to `:801` | O8 |
| R9 | `:723-746`, "a recorded wait shown by Compare clocks makes the series by itself at zero, with no press" | preview's wait, series at zero, nothing more in 120 s | deleted; the countdown-to-series is `:616`'s, and the "nothing more in 120 s" check moves to row R1 | D2 |
| R10 | `:747-770`, "Compare clocks after Make the series still makes the series …" | `select` counts 1, 2 | renamed "Check again during the box's wait still makes the series at its end": counts 1 (the run), 2 (Check again), 3 (the end) | O8, D4 |
| R11 | `:796`, `:1151`, `:1180` | `quiet` read Make the series | `quiet` reads Check again; values unchanged | D4 |
| R12 | `:815-816`, `:969` | Make the series quiet while waiting | deleted | D4 |
| R13 | `:1061-1074`, "draws Make the series quiet and disabled while a countdown runs" | the button's state and its words | deleted | D4 |
| R14 | `:1189-1212`, "an edit to a declaration stops the wait" | after putting the statement back, `select` count stays 1 | renamed "… and putting it back starts again": count 2 | O8 |
| R15 | `:1223`, `:1246`, `:1262` in "explains each wait in Spanish with the restore page's words" | «Crear las series» and its state | deleted (the Spanish start hint is N5's); `:1259` «Comprobar otra vez» stays | D4 |
| A2 | `recovery-hour.a11y.browser.test.ts:52-63`, `:165-197` | states include `compared`; Compare clocks then Make the series | `compared` removed (the page no longer rests there); states reached by the key and statements alone | D4 |
| X1 | `apps/setup/src/setup-app.test.ts:5794-5795` | "Check the fields and compare clocks again." | "Check the fields, then press “Check again”." | words table |

Restore cases not in a row are class P; if one needs more, stop.

## Size

Counted from the cases and lines above, before building (estimates):
- **Production code:** about 300 changed lines (+130, −170): `first-hour.ts` about 140, `recovery-hour.ts` about 140, `clock-wait.ts` −12. Net shorter.
- **Tests:** about 1,050 changed lines (+600, −450): `first-hour.browser.test.ts` about 400 (about 45 press lines out, 15 rows, four new cases), `recovery-hour.browser.test.ts` about 450 (about 75 press lines out, 15 rows, two new cases), the two a11y files about 80, the `apps/*` files about 60, the end-to-end case about 6.
- **Test support:** about 30 lines (`quiet` in both files, `scripted()`'s preview branch, `compareClocks` → `fillRecoveryHour`).
- **Documents:** about 160 lines (two guide paragraphs, two runbook sections, backlog).
- Task 5, if built: about 40 code, 100 tests.

**One pull request.** Tasks 1 and 2 are each the largest dispatch (one page and its test file); each is well under 100 tool calls if the class P edits are made by the `sed` in Task 1 Step 4 and its restore equivalent, not case by case.

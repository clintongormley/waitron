# A788: the business day's start changes at the next changeover — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to
> implement this plan task by task. Every implementer is dispatched as `subagent_type:
> "implementer"`. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Owner question pending — two waits, both on Task 3 (3a and 3b):**
> 1. **A Save while a change waits and the old changeover has already passed** (plan review H1).
>    Default built here, pending the owner: the running business day is worked out from the clock
>    WITH the waiting change; if the moment the new start would end today is now or earlier, the
>    waiting row stays (it now defines today's end) and the new start takes effect one changeover
>    later (rule 2, as the owner answered question 3). The alternative the owner may choose instead:
>    refuse with "A new start is already changing tonight — save again after it." Task 1 computes the
>    plan either way; Tasks 3a/3b turn it into behaviour, so a different answer changes only them.
> 2. **The `business-day-history.test.ts` edit** (only when each Save happens; no assertion edited)
>    — needed by Task 3b.
>
> The driver asks both through the campaign watcher before dispatching Task 3a; Tasks 1, 2 and 4
> onwards that do not depend on them can run meanwhile.

**Goal:** a Save in the Business-day card moves the changeover that ends today's business day (or
the one after, when the new time has already passed tonight); there is no date field, no Replace,
no Cancel and no lock; opening hours stay editable while a change waits, refused only when an edit
clashes with the waiting start; and new hours are checked only against the start in force (plus the
waiting one), with past days in the Opening hours calendar cut at their own ends.

**Architecture:** the server works out the effective business date itself (rules 1, 2 and 7) in a
pure module beside `business-day-start.ts`, and the preview hands that date to the browser, which
sends it back with Save. Venue service stops refusing hours writes while a change waits: the
editors' own parse and last-orders checks run against the starts already in force (a "settled"
clock in slice 2, then the start in force alone in slice 5), and every time-changing writer re-runs
the venue-wide clash checker against each waiting change after its write, refusing with
`hours.clock_change_conflict` and rolling the write back. The dashboard card and dialog are rebuilt
to the mockups. The calendar cuts a past day's misfitting ranges in a calendar-only step, so nothing
that decides service or a sale's business day changes.

**Tech stack:** TypeScript, Hono routes (`apps/server`), drizzle on `node:sqlite` (`@waitron/db`),
Lit web components (`apps/dashboard`, `packages/venue-service/src/dashboard`), Vitest 4 (node and
real-Chromium browser projects).

**Spec:** `docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md` (owner's
answers recorded there, 2026-10-18: all four questions A). Mockups:
`docs/backlog/mockups/a788-business-day/`. Probes the design ran, and the planner's own
(`plan-check.ts`, `plan-dst.ts`, `plan-h1.ts`, `plan-fold.mts`):
`/Users/clintongormley/waitron-campaign/a788-mockups-src/probe/`, run with the worktree's
`node_modules/.pnpm/node_modules/.bin/tsx`. Plan review folded in:
`/Users/clintongormley/waitron-campaign/item-a788-plan-review.md` (probes in `/tmp/a788-review/`).

**Worktree and branch:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a788-business-day-next-changeover`,
`feat/a788-business-day-next-changeover`. Ledger: `docs/handoffs/2026-10-18-a788-business-day-next-changeover.md`
(gitignored; the driver keeps it current after every task).

**Risk triggers:** a cross-package contract (the conflict-reason union, the preview/PUT body, the
pending model, a new error code); fiscal-adjacent business-day boundaries (which day a sale and its
report belong to); a race at the changeover moment (rule 7). **Review path: FULL.**

---

## Global constraints

- Every commit `git commit -s`. No push from a task. No `--no-verify`.
- TDD: write the failing test, run it and see it fail for the reason expected, then implement.
  Every new guard or check is proven by deletion: remove the line that makes it pass, watch the test
  fail, put the line back.
- The fiscal core is not touched: `computeHuella`, the chain, invoice numbering,
  `registros_facturacion`, the alta builders. The golden and huella tests and `inmutabilidad` run
  unedited in Task 17.
- Database tests use `useVenueDb`. Dashboard and venue-service `src/dashboard/**` tests run in real
  headless Chromium; follow `docs/developers/testing-guide.md` (restore the screen language after a
  test that changes it; `userEvent.click` where an update's ordering matters; wait for `wt-close`
  before checking what a dialog's close does; never `history.length`). Check free memory
  (`memory_pressure | grep free`) before a browser run.
- Forms follow `docs/developers/design-system.md` → Forms: `draftScopeFor` + `saveActionState`, an
  early return in the save handler, Save quiet (`variant="secondary"`) and disabled while it cannot
  act, a refusal under the field it names plus one bottom line. Colours and spacing read `--wt-*`
  tokens only.
- Error codes: name the domain concept; every throwing file imports its `errors.ts`; add EN and ES
  copy; the HTTP status follows the owner's rule (a clash with stored data → 409).
  `grep` found no prefix matcher for `hours.` or `venue.` (`claimFor` in `apps/server/src/alerts.ts`,
  the setup wizard, rejoin and restore handlers) and no stored copy to rewrite (pre-live rule).
- Comments: only an invariant or a non-obvious why; never history. Any sentence about behaviour,
  in a comment, doc or commit, carries its receipt (CLAUDE.md §1).
- Each task ends with `pnpm exec prettier --check <every file the task touched>` and a commit.
  `docs/` is prettier-ignored; for a `docs/` file run `pnpm exec prettier --file-info <file>` once to
  confirm `"ignored": true` rather than trusting a clean `--check`.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing (or
  cleanly red) point, commits, and returns a handover: done, left, files, each check's state.
- **Changed test checks.** Any existing assertion this plan changes is recorded in the running list
  below (file:line at the base, before → after, why) by the task that changes it, and mirrored to
  `/Users/clintongormley/waitron-campaign/a788-changed-checks.md`. A changed check verifies the new
  behaviour at least as strictly; nothing is deleted or loosened. A check that fails and is NOT on
  this plan's list, or that sits in a fiscal, golden, `inmutabilidad`, `scripts/` guard,
  permissions or money test and is not marked below as cleared, is a **STOP**: commit nothing for
  it and report to the driver, who asks the owner.

## Consumer map (traced 2026-10-18 at `373b96623`; plan-review additions marked ★)

| Contract | Producer | Consumers to change |
| --- | --- | --- |
| Conflict `reason` union (+`overlap`, +`kept_open`) | `packages/module/src/module.ts:607` (`BusinessDayClockConflict`) | `packages/venue-service/src/business-day-schedule.ts:418-439`; `packages/venue-service/src/errors.ts:25-28` (imports the type); `apps/dashboard/src/api/client.ts:146` (own copy of the union); label map `apps/dashboard/src/screens/business-day-start-editor.ts:336-345`; new venue-service reason labels (Task 10) |
| `pending` shape (loses `locksAt`, `editable`; still the FIRST waiting row — a second can exist after an H1 Save) | `apps/server/src/business-day-start.ts:69-97`, `apps/server/src/venue-detail-types.ts:65-76`; `packages/venue-service/src/business-day-schedule.ts:538-565`, `service-day-context.ts:27-38` | `apps/dashboard/src/api/client.ts:108-119`; `business-day-start-editor.ts:114,137,142-143,287,380-440`; carried through `menu-timetable.ts:920`, `opening-hours-calendar.ts:70,220`, `named-days.ts:24`, `holiday-types.ts:50`, `menu-timetable-types.ts:56` (types only); no reader in `apps/till` or the venue-service dashboard |
| Preview query (only `dayCutover`, `expectedClockRevision`; no `locksAt` in the answer) | `business-day-start.ts:178-214`, route `apps/server/src/location-settings-api.ts:181-203` | `client.ts:2949-2959` (`previewBusinessDayStart`), `client.ts:120-149` types, the dialog; ★ `business-day-start.test.ts:604-647` builds its query from `proposal()` |
| PUT body (`effectiveBusinessDay` must equal the server's answer) | `business-day-start.ts:230-274` | the dialog; server tests that PUT: `business-day-start.test.ts` (★ every use of `proposal()`, whose default date is `2026-11-04` at `:154`), `business-day-history.test.ts`, `boot.clock-wiring.test.ts:174-196`, `attendance-cutover-settings.test.ts:80-89` |
| `DELETE /management-api/venue-details/business-day-start` and `cancelBusinessDayStart` (removed) | `location-settings-api.ts:216-225`, `business-day-start.ts:275-298` | `client.ts:2967-2971`, `client-routes.test.ts:1389,1397`, editor `#cancelPending` (`:286-304`) |
| Refusal reasons `transition_started`, `cancel_required`, `future_date` (removed), `changeover_passed` (added), `clock_transition` (gains `clocksChangeOn`, `saveFrom`; field becomes `dayCutover`) | `business-day-start.ts:102-111,128-142,242-245`; params type `apps/server/src/errors.ts:45-47` | dashboard copy `apps/dashboard/src/i18n/codes.ts:84-95`; the dialog's refusal handling (`business-day-start-editor.ts:266-281`) |
| `hours.clock_change_pending` (retired) → `hours.clock_change_conflict` (409, `{ dayCutover, startsAt, timeZone, conflicts, conflictCount }`) | `business-day-schedule.ts:501-508`; registry `packages/venue-service/src/errors.ts:23`; status `packages/venue-service/src/routes.ts:134` | copy `packages/venue-service/src/dashboard/strings.ts:377,1232`; `season-painter.ts:549`; `special-day-painter.ts:955,1071`; `season-refusal.ts:38`; `period-delete-dialog.ts:106`; `period-dialog.ts:412-419` (generic line today); ★ `department-dialogs.ts:281-288` (adding a department writes a 09:00–17:00 week through `placeOpenPeriod`, `menu-timetable.ts:64-101`, called from `createDepartment`, `operations.ts:215`); docs `conventions-data.md:660-661,675-676`, `design-system.md:5145` |
| ★ Last-orders (end-offset) check clock | `endOffsetClash` (`menu-timetable.ts:172-243`) → `findSeasonEndOffsetClash` (`period-end-offset.ts:85-210`, whose dated loop `:181-186` also visits every change's date and the day before) | callers that must pass the settled (slice 2) then in-force (slice 5) clock: `assertWeekEndOffsets` (`menu-timetable.ts:674`), `writeMenuPeriod` (`:597`), `seasons.ts:72` (`scheduleEndOffsetClash(tx, cfg)`, reads the full clock), `special-days.ts:1190` and `:1206` (`checkScheduleAfterWrite`, full clock or none), `period-delete.ts:253` (`departmentEndOffsetClash`, full clock from `:213`) |
| `scheduleCutovers` | `packages/venue-service/src/service-day-context.ts:40-44` (unchanged; callers pass narrower clocks) | `menu-timetable.ts:709`, `zone-closed-times.ts:86`, `special-days.ts:585-588` (`cutoversFor`), `period-end-offset.ts:106`; `configuration-transfer.ts:490` passes a string clock, unaffected |
| ★ Readers of the venue's FIRST start (`clock.dayCutover`) once slice 5 lets stored hours misfit it | — | validating, moved to the start in force in Task 11: `zone-closure-hours.ts:45-47` (`closureOutsideHours` on a season week), `period-delete.ts:341` (which touching ranges are joined). Sorting only, each day re-sorted from its own start afterwards (`fromChangeover`), left: `menu-timetable.ts:165,207`, `day-resolver.ts:149,198`, `season-weeks.ts:361`, `zone-closed-times.ts:96`. Fallbacks for an unreadable clock, left: `keep-open.ts:39`, `routing-store.ts:655,1070`, `zone-closed-times.ts:220`, `menu-timetable.ts:922`, `named-days.ts:32`. Staffing: backlog A851. |
| Calendar range drawing | `opening-hours-calendar.ts:211-259` (month), `hours.ts` `calendarDays` (year tone) via `day-resolver.ts:134-219` | dashboard `zone-own-hours.ts:25-34` `placeOnDay` is shared with server validation (`closureOutsideHours`) and is NOT changed; ★ `readSeasonDays` (`opening-hours-calendar.ts:276-320`) feeds the special-day EDITOR and is deliberately not cut (Task 12) |
| i18n keys | `apps/dashboard/src/i18n/strings.ts:845-870` (EN), `:3792-3818` (ES), `:878`/`:3826` (`venue_details.dayCutover`) | the editor only (every non-test use is in `business-day-start-editor.ts`) |

## Changed test checks (running list; each task appends, the PR copies it)

Expected from tracing and the plan review; each task confirms or corrects its own rows. **Bold**
rows are owner stops or need marking in the PR.

| Task | File:line (base `373b96623`) | Before → after |
| --- | --- | --- |
| 2 | `apps/server/src/business-day-start.test.ts:193` | preview `locksAt` asserted → key absent (`not.toHaveProperty("locksAt")`) |
| 2 | `business-day-start.test.ts:207`, `:551` | `pending.editable` true/false → `pending.startsAt` exact instant, and no `editable`/`locksAt` keys |
| 2 | `packages/venue-service/src/business-day-schedule.test.ts:579` | `pending: { …, editable: false }` → `pending: { effectiveBusinessDay, dayCutover, startsAt: "2026-11-04T06:00:00.000Z" }` with no `locksAt`/`editable` |
| 3a | `business-day-start.test.ts:172-197` (preview half) | preview with a date at 11-02 for 11-04 → preview with the start only; `effectiveDay.businessDay "2026-11-03"`; `previousDay` `2026-11-02T04:00:00.000Z → 2026-11-03T02:00:00.000Z`, `effectiveDay` `2026-11-03T02:00:00.000Z → 2026-11-04T02:00:00.000Z` (`plan-check.ts`) |
| 3a | `business-day-start.test.ts:604-647` (both cases, preview half) | query built from `proposal()` → from `dayCutover` and `expectedClockRevision` only; counts 7, 14 and 56 rechecked after the date moves (expected unchanged: the conflicts are per weekday and season, not per date) |
| 3a | `business-day-start.test.ts:355-369` (GET) | GET permission case: its query loses `effectiveBusinessDay`; 401/403 unchanged |
| 3b | `business-day-start.test.ts:154-160` | `proposal()` default `effectiveBusinessDay "2026-11-04"` → `"2026-11-03"` (the next changeover at the file's `at`, `2026-11-02T12:00Z`); every case using the default (`:198-222`, `:489-501`, `:572-602`, `:604-647` Save halves) keeps its assertions with 11-03 where it asserts the date |
| 3b | `business-day-start.test.ts:223-247` | `2026-11-02`, `2026-11-03`, `2027-11-04` refused by code only (`future_date`) → `2026-11-02`, `2026-11-04`, `2027-11-04` refused with exact params `{ field: "dayCutover", reason: "changeover_passed" }` |
| 3b | `business-day-start.test.ts:248-280` | replace then DELETE (cancel) → replace then Save the start in force (undo); same revision arithmetic and stale/ABA refusals |
| 3b | `business-day-start.test.ts:281-304` | DELETE quiet/stale cases → Saving the start in force while a change waits: 409 `cancel_required` → 200, waiting row removed; same-as-waiting Save quiet; stale revision 409 |
| 3b | `business-day-start.test.ts:305-354` | lock at the preceding day (`transition_started`) → replace accepted up to the changeover; after activation the next Save takes the following changeover |
| **3b** | **`business-day-start.test.ts:355-369` (PUT, DELETE) — permissions check** | **DELETE stays in the matrix, at least as strict: with no cookie, the staff cookie and the manager cookie, `DELETE …/business-day-start` answers exactly what `DELETE /management-api/venue-details/no-such-route` answers under the same cookie, and nothing is written. PUT 401/403 unchanged. Cleared by the spec (the route is removed, design §6); marked in the PR as a changed permissions check.** |
| 3b | `business-day-start.test.ts:370-400` | DST refusal by code with A755 dates → refusal with exact reason at the probe's moments (Task 4 adds `clocksChangeOn`/`saveFrom`) |
| 3b | `business-day-start.test.ts:411-465` | queued save/cancel/minimum-date refused `locked`/`invalid` → queued save/undo/plain refused `changeover_passed` (exact params), rows unchanged |
| 3b | `business-day-start.test.ts:466-488` | future anchor refuses DELETE and PUT → refuses undo and replace, same `future_history`, anchor moved to the new earliest boundary `2026-11-03T02:00:00.000Z` |
| 3b | `business-day-start.test.ts:537-571` | reopened copy reads at `2026-11-04T01:59:59.999Z`/`02:00` → at `2026-11-03T01:59:59.999Z`/`02:00` (the new effective date) |
| 3b | `apps/server/src/attendance-cutover-settings.test.ts:76-90` | Save at `2026-01-05T12:00Z` for `2026-01-08` → Save at `2026-01-07T12:00Z` (the day whose end moves); every assertion unchanged |
| 3b | `apps/server/src/boot.clock-wiring.test.ts:183,194` | `2026-11-04` → `2026-10-14` (the next changeover at the test's fixed `2026-10-14T00:00Z`) in body and expected clock |
| **3b** | **`apps/server/src/business-day-history.test.ts:63,100-110,383-433,435-529`** | **OWNER STOP (fiscal-adjacent):** location-settings `now` follows the faked clock, and each Save happens at a moment whose next changeover is 2026-11-04 (system time set to `2026-11-03T12:00:00.000Z` just before the PUT, restored after where a test continues). No assertion edited. |
| 6 | `business-day-schedule.test.ts:396-409` (assertions `:404-405`) | two overlapping raw ranges both `range` → both `overlap` (count 2 unchanged). Confirmed by Task 6; no other existing assertion changed |
| 7a | `business-day-schedule.test.ts:430-467` | `hours.clock_change_pending` while waiting → resolves while waiting; stale revision still `hours.clock_changed`; bad revisions unchanged |
| 7a, 7b, 8 | `business-day-schedule.test.ts:489-561` | each writer refused `hours.clock_change_pending` → each writer accepts a non-clashing time edit while waiting, and refuses a clashing one with `hours.clock_change_conflict` (exact params) and nothing written |
| 7b | (none) | no existing assertion changed: 7b's part of the 7a/7b/8 row is new clashing-refusal cases (zone week, season week, period delete, another department's clash, adding a department) beside 7a's accepting ones |
| 8 | (none) | no existing assertion changed: 8's part of the 7a/7b/8 row is new cases in `business-day-schedule.test.ts` (one-off, repeating and zone special-day paint, special-day delete, adding a season, and last orders through a special day, a special-day delete and a season save); the route row was taken by 7a |
| 8 (done in 7a) | `packages/venue-service/src/menu-timetable-routes.test.ts:852-873` | route answers 409 pending → route accepts 09:00–14:00 (204) and refuses 06:00–08:00 with 409 `hours.clock_change_conflict` (exact params); stale case unchanged |
| 10 | `packages/venue-service/src/dashboard/seasons-window.test.ts:705-706`, `season-painter.save.test.ts:543`, `periods-list.delete.test.ts:405`, `period-delete-dialog.test.ts:252,312` | "Cancel the pending business-day change…" for the pending code → the clash sentence for `hours.clock_change_conflict` |
| 11 | `business-day-schedule.test.ts:640-657` | annual 07:00–07:00 refused "against every retained start" → accepted under the start in force (07:00), and an annual range crossing 07:00 refused |
| 13 | `apps/dashboard/src/screens/business-day-start-editor.test.ts:222-241,473-509` | Replace/Cancel/locked/"Editable until"/"Scheduled change" rows → "Starts at" always, one "New start" row per waiting change with when and day length, Change start only |
| 13 | `apps/dashboard/src/screens/venue-details-business-day.test.ts:94-144` | passive timer flips `pending.editable` → passive re-read at `pending.startsAt` shows the new start, no active read |
| 13 | `apps/dashboard/src/api/client-routes.test.ts:1389,1397` | `cancelBusinessDayStart` DELETE → no cancel method (`not.toHaveProperty`) |
| 14a | `apps/dashboard/src/api/client-routes.test.ts:1356,1392` | preview query with `effectiveBusinessDay` → query of `dayCutover` and revision only |
| 14a | `business-day-start-editor.test.ts:250-470` (preview and conflict lines) | "Conflicting schedules:", "Range crosses the new start", hour-count after "Previous day length:" → new headings, labels and lines |
| 14b | `business-day-start-editor.test.ts:98-220` (Save gating, refusals) | date field, acknowledge gate → one field, Save gated by a ready conflict-free preview |
| 14b | `business-day-start-editor.unsaved.test.ts:40,103-125` | date-field draft cases, acknowledge before Save → the time field's draft cases, Save without acknowledgement |
| 14b | `venue-details-business-day.test.ts:29-72,146-208` | date draft and acknowledge → time draft, Save after the preview |

Task 3a confirmed its three rows; exact base lines: `business-day-start.test.ts:176` and `:181-192` (preview half, values as the row says), `:358` (GET permission query), `:608` and `:626` (conflict-count queries; 7, 14, 56 and 4 seasons unchanged). No other assertion failed.

Task 3b confirmed the plan's Task 3b rows, with the corrections marked

| File:line (base `373b96623`) | Before → after | Why |
| --- | --- | --- |
| `apps/server/src/business-day-start.test.ts:156` | `proposal()` default `effectiveBusinessDay "2026-11-04"` → `"2026-11-03"` | the next changeover at the file's `2026-11-02T12:00Z` is 11-03. Cases asserting the date: `:207-221` (first case's Save half: `pending` `{ 2026-11-03, 03:00, startsAt 2026-11-03T02:00:00.000Z }` by `toEqual`, row `2026-11-03`) and `:591` (isolation case, own row `2026-11-03`); `:489-501` and the Save halves of `:605-647` pass unedited (conflict counts 7 and 14 unchanged) |
| `business-day-start.test.ts:229-232` | `2026-11-02`, `2026-11-03`, `2027-11-04` inside the malformed `it.each`, refused by code only → `2026-11-02`, `2026-11-04`, `2027-11-04` in their own `it.each`, refused 400 with the whole body by `toEqual`: `{ code: "venue.business_day_invalid", params: { field: "dayCutover", reason: "changeover_passed" } }`, no rows | the date is no longer a free choice; the remaining malformed bodies stay code-only as before |
| `business-day-start.test.ts:248-280` | `DELETE` (rev 2) cancel → `PUT` of the start in force `05:00` (rev 2); stale `DELETE` (rev 0) → stale `PUT 05:00` (rev 0) | undo is a Save of the start in force; same revision arithmetic (3, then 4) and the same stale/ABA refusals |
| `business-day-start.test.ts:281-304` | quiet `DELETE` with nothing waiting → removed; stale `DELETE` (rev 1) 409 → stale `PUT 05:00` (rev 1) 409 `venue.business_day_changed`, before the quiet rule; `PUT 05:00` while a change waits 409 `venue.business_day_locked` (`cancel_required`) → 200 `changed: true`, revision 2, `pending: null`, no rows; added: the same Save as the waiting one twice → `changed: false`, revision stays 1 | Saving the start in force is the undo |
| `business-day-start.test.ts:305-354` (**corrected shape**) | `it.each(["PUT","DELETE"])` refused at the preceding-day lock `2026-11-03T04:00Z` → one case: at `2026-11-03T01:59:59.999Z` a replace to `04:00` is accepted (row `2026-11-03 04:00:00`); at `2026-11-03T03:00:00.000Z`, once that 04:00 has taken effect, `PUT 07:00` naming 11-03 → 400 `changeover_passed` by `toEqual` (was 400 code-only at 11-04T02:00Z), rows unchanged; GET `details.dayCutover "04:00"` (was `"03:00"`), `currentBusinessDay "2026-11-03"` (was `"2026-11-04"`), `pending: null`; the next Save names `2026-11-04` (was `2026-11-06`) and gives 2 rows (unchanged) | there is no lock; a DELETE variant cannot exist |
| **`business-day-start.test.ts:355-369` — changed permissions check** | `it.each(["PUT","DELETE","GET"])` → `it.each(["PUT","GET"])` with 401/403 unchanged, plus a new case: with no cookie, the staff cookie and the manager cookie, `DELETE …/business-day-start` answers exactly (status and body text) what `DELETE /management-api/venue-details/no-such-route` answers under the same cookie (404 `404 Not Found` today), and the clock rows are unchanged | the route is removed (spec §6); cleared by the spec, marked in the PR as a changed permissions check |
| `business-day-start.test.ts:370-400` (**corrected moments**) | refused by code at `2026-10-22T12:00Z` (E 10-25) and `2027-03-25T12:00Z` (E 03-28) → refused 400 by `toEqual` at Task 4's moments: `2026-10-23T01:00Z` E `2026-10-24` → `{ field: "dayCutover", reason: "clock_transition", clocksChangeOn: "2026-10-25", saveFrom: "2026-10-26T01:30:00.000Z" }`; `2027-03-27T11:00Z` E `2027-03-28` → `clocksChangeOn "2027-03-28"`, `saveFrom "2027-03-29T00:30:00.000Z"`; added: no rows after both; the accepted `2027-03-30` Save moves to `2027-03-29T01:00Z` | the old moments now name a date that is not the next changeover, so they would be refused `changeover_passed` first. The params are wired here, so Task 4 is left with the preview's answer and the `saveFrom` deletion proof |
| `business-day-start.test.ts:411-465` | kinds `save`/`cancel`/`minimum-date` refused 409 `locked` / 409 `locked` / 400 code-only → kinds `save`/`undo`/`plain`, all `PUT`, each refused 400 by `toEqual` with `changeover_passed`; rows unchanged and the later PATCH 200 unchanged | the time after acquiring the lock still decides, now through the changeover |
| `business-day-start.test.ts:466-488` | anchor `opened_at 2026-11-04T02:00:00.000Z` and `DELETE` → anchor `2026-11-03T02:00:00.000Z` and an undo `PUT 05:00` (rev 1); both refusals still 409 `venue.business_day_locked`, rows unchanged | the waiting change's boundary is now 11-03 02:00Z |
| `business-day-start.test.ts:545-558` | reads at `2026-11-04T01:59:59.999Z`/`02:00Z` → at `2026-11-03T01:59:59.999Z`/`02:00Z`; `currentBusinessDay` before `"2026-11-03"` → `"2026-11-02"`, after `"2026-11-04"` → `"2026-11-03"`; `pending` `{ 2026-11-04, 03:00, 2026-11-04T02:00Z }` → `{ 2026-11-03, 03:00, 2026-11-03T02:00Z }` | the saved change now takes effect a day earlier; same keys, still exact |
| `apps/server/src/attendance-cutover-settings.test.ts:75` | location-settings `now: () => now` (`2026-01-05T12:00Z`) → `now: () => new Date("2026-01-07T12:00:00Z")`; discovery still uses `now`; every assertion unchanged | the Save is pressed on the day whose end moves |
| `apps/server/src/boot.clock-wiring.test.ts:183,194` | `2026-11-04` → `2026-10-14` in the body and the expected clock | the next changeover at the test's fixed `2026-10-14T00:00Z` |
| **`apps/server/src/business-day-history.test.ts:63,100,394,418,514` — OWNER-APPROVED 2026-10-18 ~14:07** | location-settings `now` fixed at `2026-11-02T12:00Z` → follows the faked clock (`new Date()`); system time set to `2026-11-03T12:00:00.000Z` just before each PUT (in `schedule()`, restored after it, since those tests continue; in the three refusal tests, left set as nothing follows but the frozen-row comparison) | the owner approved changing only when each Save is pressed. No assertion in the file changed: every sale, filing, invoice-number and daily-close comparison and every expected value is as it was (`git diff` shows only the `now` line, the constant, and the `setSystemTime` lines) |

No other existing assertion failed (`pnpm --filter @waitron/server exec vitest run` over the nine files of Step 4 plus `business-day-changeover.test.ts`: `Tests  403 passed (403)`).

Task 7a confirmed the plan's 7a row, took the 7a part of the 7a/7b/8 row, and took Task 8's route row

| File:line (base `373b96623`) | Before → after | Why |
| --- | --- | --- |
| `packages/venue-service/src/business-day-schedule.test.ts:431-466` (case "refuses time writes while pending, allows metadata, …" renamed "allows time writes while a change waits, allows metadata, …"; assertion `:445-448`) | `guard("time", 1)` rejects `{ code: "hours.clock_change_pending", params: { effectiveBusinessDay: E } }` → resolves; every other assertion (metadata, stale `hours.clock_changed`, activation, cancellation, bad revisions) unchanged | design rule 5: the guard keeps only its revision check |
| `business-day-schedule.test.ts:500-506` (describe "pending guards every time writer" renamed "every time writer stays open while a change waits"; case "guards normal and special-day menu ranges but accepts an equivalent week" renamed "accepts normal and special-day menu ranges and an equivalent week"; special-day paint `:503-505`) | `paintDate(… "2026-12-25" …)` rejects pending → `paintDate(… "2026-12-26" …)` resolves | the pending refusal is gone; the date moves because the fixture already holds a special day on 12-25, so a second one is refused `special_day.date_taken` — the base never reached that check. Task 8 adds the clashing refusal |
| `business-day-schedule.test.ts:507-517` (same case: week `:510-512`, empty week `:514-517`) | Wed 09:00–17:00 at revision 1 rejects pending → resolves; the empty-week (revision 0) check moved before it, assertion unchanged | the week now fits the waiting start; after it is stored the empty week is a time change, so revision 0 would answer `hours.clock_changed` |
| `business-day-schedule.test.ts:518-538` (case "guards offsets but accepts names, colours and equivalent offsets" renamed "accepts offsets, names, colours and equivalent offsets"; offset `:521-525`, metadata `:526-537`) | `endOffsetMinutes: 1` at revision 1 rejects pending → resolves; the name/colour/offset-0 update (revision 0) moved before it, assertion unchanged | same ordering reason |
| `business-day-schedule.test.ts:539-560` (case "guards zone closed weeks and dates" renamed "accepts zone closed weeks and dates"; zone week `:542-556`, zone date `:557-559`) | both reject pending → both resolve; the zone date moves 12-25 → 12-26 | as above; Task 7b and 8 add the clashing refusals |
| `packages/venue-service/src/menu-timetable-routes.test.ts:852-873` (case "returns the pending and stale clock refusals through real hours routes" renamed "accepts a fitting week, refuses a clashing one and a stale one while a change waits"; it now fakes `Date` at `2026-11-02T12:00Z`, since the route reads the clock and the stored change is dated 2026-11-04; Task 8's row, taken here because 7a's `replaceMenuWeek` change makes the old assertion fail) | `PUT …/menu-week` 09:00–14:00 rev 1 → 409 `{ code: "hours.clock_change_pending", params: { effectiveBusinessDay: "2026-11-04" } }` → 204; added: 06:00–08:00 rev 1 → 409 by `toEqual` `{ code: "hours.clock_change_conflict", params: { dayCutover: "07:00", timeZone: "Europe/Madrid", startsAt: "2026-11-04T06:00:00.000Z", conflictCount: 1, conflicts: [{ departmentId, departmentName "Restaurant", periodId, periodName "Mañanas", seasonId, seasonName "Autumn", weekday 1, startsAt "06:00", endsAt "08:00", rangeIndex 0, reason "range" }] } }` and the model's departments unchanged; stale case (rev 0 → 409 `hours.clock_changed`) unchanged, moved first | the route now accepts a fitting week and names the clash |

No other existing assertion failed (`pnpm exec vitest run --project node` in `packages/venue-service`: `Tests  2510 passed (2510)`).

Task 10 confirmed the plan's Task 10 row (exact base lines below)

| File:line (base `373b96623`) | Before → after | Why |
| --- | --- | --- |
| `packages/venue-service/src/dashboard/seasons-window.test.ts:704-707` (case title "a changed or pending business-day start" → "a changed business-day start, a clash with a waiting one") | `{ code: "hours.clock_change_pending" }` → "Cancel the pending business-day change before editing hours." becomes mockup 06's `hours.clock_change_conflict` refusal → "Dinner 21:00–02:45 clashes with the new business-day start, 03:00 from Wed 21 Oct, 03:00: Hours overlap the changed start." | the pending refusal is retired; the window names the clashing range |
| `season-painter.save.test.ts:542-549` (case "a pending business-day change has its own message" → "a clash with a waiting business-day start names the range") | pending code → pending sentence becomes the conflict refusal → the clash sentence, by `toBe` | same |
| `periods-list.delete.test.ts:404-407,414` | thrown `{ code: "hours.clock_change_pending", params: { effectiveBusinessDay } }` and the pending sentence → the conflict refusal and the clash sentence; every other assertion in the case unchanged | same |
| `period-delete-dialog.test.ts:251-254,257` and `:311-314` | pending refusal → pending sentence (both cases) becomes the conflict refusal → the clash sentence | same |

New cases beside them (no existing assertion changed): `clock-change-conflict.test.ts` (EN, ES, each hours reason, the name fallback, the venue's zone, other codes), a `period-dialog.test.ts` bottom-line case, a row in `special-day-painter.save.test.ts`'s beside-Save `it.each`, and a refused special-day delete in `special-day-painter.test.ts`, and a refused department add in `department-dialogs.test.ts`. The follow-up adds `timeZone` to the `hours.clock_change_conflict` params; the server assertions it extends (`business-day-schedule.test.ts`, `menu-timetable-routes.test.ts`, `operations.test.ts`) are all this branch's own, as the code did not exist at base. No other existing assertion failed in the ten browser files run (`Tests  452 passed (452)`) or the five server files run (`Tests  326 passed (326)`); the rest of the package's suite was not run.

Task 11 confirmed the plan's Task 11 row (exact base lines below)

| File:line (base `373b96623`) | Before → after | Why |
| --- | --- | --- |
| `packages/venue-service/src/business-day-schedule.test.ts:640-645` (case "checks annual menu ranges against every retained start" → "… against the start in force") | annual 2026-12-25 07:00–07:00 after the 07:00 start took effect: rejects `{ code: "special_day.invalid", params: { field: "paint.0.ranges" } }` → resolves; added in the same case: annual 2026-12-26 06:00–08:00 rejects that same `{ code, params: { field: "paint.0.ranges" } }` | a repeating day is checked against the start in force (07:00), not every start the venue had |
| `business-day-schedule.test.ts:647-656` (case "checks annual zone ranges against every retained start" → "… against the start in force") | the same for zone paint, `field: "zonePaint.0.ranges"` | same |

Retitled only, assertions unchanged: `:602` and `:613` ("against the retained 07:00 start" → "against the 07:00 start in force"). New cases beside them (no existing assertion changed): `inForceClock` and "undated hours are checked against the start in force" in `business-day-schedule.test.ts`, and a season-closure case in `zone-closure-hours.test.ts`, whose `venue()` helper now also returns `restaurant` and `menuId`. No other existing assertion failed (`pnpm exec vitest run --project node` in `packages/venue-service`: `Tests  2544 passed (2544)`).

Task 13 confirmed the plan's three Task 13 rows (exact base lines below)

| File:line (base `373b96623`) | Before → after | Why |
| --- | --- | --- |
| `apps/dashboard/src/screens/business-day-start-editor.test.ts:222-241` ("offers Replace and Cancel only before the pending lock …") | Replace and Cancel buttons, a DELETE with revision 4, and the `locked` line once `editable` is false → "offers only Change start while a change waits, and opens the dialog from it": the card header's only button is `change`, and it opens the dialog with the waiting `03:00` | there is no lock, Replace or Cancel (design §5) |
| `business-day-start-editor.test.ts:474-475` (`it.each` "draws its own card …") | rows `["Starts at 05:00", "Scheduled change None"]` / `["Empieza a las 05:00", "Cambio programado Ninguno"]` → `["Starts at 05:00"]` / `["Empieza a las 05:00"]`; heading, zone and header-button checks unchanged | the "Scheduled change: None" row goes (design §5) |
| `business-day-start-editor.test.ts:489-509` ("shows a pending change as date · time with its lock time …") | rows `"Scheduled change 2026-11-04 · 03:00"` and `/^Editable until /`, Replace and Cancel in the header → an `it.each` over EN and ES: labels `["Starts at", "New start"]`, start `05:00`, the New start row `"03:00, from Wed 21 Oct, 03:00"` + `"Business day Tue 20 Oct lasts 22 h."` (ES `"03:00, desde mié 21 oct, 03:00"` + `"El día de trabajo mar 20 oct dura 22 h."`), Change start in the header, no Replace or Cancel | the card shows the waiting change's moment and the changeover day's length (mockups 03, 05) |
| `business-day-start-editor.test.ts:36` (the `preview()` fixture), `business-day-start-editor.unsaved.test.ts:40`, `venue-details-business-day.test.ts:170` | fixture field `locksAt` removed; no assertion read it | the preview answer has no `locksAt` (Task 2) |
| `apps/dashboard/src/screens/venue-details-business-day.test.ts:94-144` ("passive timer reads update a pending lock …") | `pending.editable` true → false after the 60 s refresh and the `locked` line, `active 1`, `passive 1` → at 10 s before a waiting 03:00 change's moment: start `05:00` and one New start row; no passive read at 9 999 ms; at the moment one passive read, then start `03:00` and no New start row; `active` stays 1 | the card re-reads at the changeover rather than at a lock |
| `apps/dashboard/src/api/client-routes.test.ts:1389,1397,1401` | `cancelBusinessDayStart({ expectedClockRevision: 5 })` → `DELETE` with that body, headers `["1", null, null]` → `expect(api).not.toHaveProperty("cancelBusinessDayStart")`, calls without the DELETE, headers `["1", null]`; the preview fixture loses `locksAt` | the route and method are removed (spec §6) |

New cases beside them (no existing assertion changed): read-only with two waiting changes, two New start rows after an H1 (b) Save, a change already in force not shown as waiting, the re-read timer, no timer for a change 300 days ahead, and the timer cleared on a new model and on disconnect. The existing read-only case (`:243-248`) is unchanged. No other existing assertion failed (the four brief files: `Tests  159 passed (159)`; `business-day-start-editor.unsaved.test.ts`: `Tests  7 passed (7)`).

## Task 14a — the plan's 14a rows, and the parts of the 14b rows the date field's removal forced (lines at `3749e0147`)

| File:line (at `3749e0147`) | Before → after | Why |
| --- | --- | --- |
| `apps/dashboard/src/api/client-routes.test.ts:1385,1390` | `previewBusinessDayStart(input)` with `effectiveBusinessDay` and a query `effectiveBusinessDay=2026-11-05&dayCutover=07%3A00&expectedClockRevision=4` → called with `{ dayCutover: "07:00", expectedClockRevision: 4 }` and the query `dayCutover=07%3A00&expectedClockRevision=4` (whole URL by `toEqual`); the PUT half unchanged | the server's preview takes the start only (Task 3a) |
| `business-day-start-editor.test.ts:143-144` (14b row, first case) | preview text contains `"22"`, and a `<time datetime="2026-11-04T02:00:00.000Z">` → the day line contains `"22 h"`, and the `<strong>` reads exactly `"Wed 4 Nov, 03:00"` (that instant in Madrid, en-GB); the date field's `required` check `:138` dropped (the field is gone; the time field's stays); the write still `toEqual` `{ effectiveBusinessDay: "2026-11-04", dayCutover: "03:00", expectedClockRevision: 4 }`, the date now taken from the preview | design §5: one field |
| `business-day-start-editor.test.ts:163,170` (14b row, late preview) | the draft moves by date 11-04 → 11-05 and the newer preview names `businessDay "2026-11-05"` → the draft moves by time 03:00 → 04:00 and the newer preview names `dayCutover "04:00:00"`; assertions unchanged | the draft has no date |
| `business-day-start-editor.test.ts:202` (14b row) | the date field shows an error → dropped; the time field's error, the bottom message and the disabled Save unchanged | no date field |
| `business-day-start-editor.test.ts:232,238` (14b row) | refusal `{ field: "effectiveBusinessDay", reason: "too_soon" }` marks the date field → `{ field: "dayCutover", reason: "changeover_passed" }` marks the time field; bottom message and enabled Save unchanged | the server's refusal now names `dayCutover` (Task 3b) |
| `business-day-start-editor.test.ts:315` | an `endpoint_day` row contains `"crosses the new start"` → contains `"Moves to another day"` | design §7 relabels `endpoint_day` |
| `business-day-start-editor.test.ts:365,492,495` | `"Conflicting schedules: N. Review opening hours"` → `"Opening hours that clash with the new start: N. Review opening hours"` (exact) | design §7 |
| `business-day-start-editor.test.ts:413-424` | `<time>` elements for both instants contain 05:00 and 03:00 and no `.000Z` → the day line is exactly `"Business day Tue 3 Nov runs 05:00 → 03:00: 22 h."` and no `.000Z` | the preview prints the venue-clock times in one sentence (mockup 02) |
| `business-day-start-editor.test.ts:458-459,467-468,482` | `endpoint_day` label `"Range crosses the new start"` / `"El tramo cruza el nuevo inicio"` → `"Moves to another day"` / `"Pasa a otro día"`, whole lines still exact | design §7 |
| every `change(el, "effectiveBusinessDay", "2026-11-04")` step in `business-day-start-editor.test.ts` (in `ready()` and the conflict cases) | removed; the time change that follows now starts the preview | no date field |
| `business-day-start-editor.unsaved.test.ts:100,128` (14b row) | a date change before the time change / as the Cancel case's edit → removed / a time change to `03:00` | no date field |
| `business-day-start-editor.unsaved.test.ts:105,122` (14b row) | the protect-and-revert case runs for the date and the time, reverting to `""` → for the time only, reverting to the start in force `"05:00"` | the dialog opens with the start in force (or the last waiting start), not empty |
| `venue-details-business-day.test.ts:59-69,200` (14b row) | a bad date `"bad-date"` kept through a live re-read; a date step before the time step → a bad time `"bad"` kept through the same re-read; the date step removed | no date field |

New cases beside them: mockup 02's three lines, the request carrying only the time and revision, no preview request before the time is changed, the not-today day line in EN and ES, the clocks-go-back day (23 h), mockup 04's heading and lines, the `kept_open` line, each clash label in EN and ES, the whole preview in Spanish with the new field label. The acknowledge button and the Save gating are left for Task 14b.

## Task 14b — Save gating without acknowledgement (lines at `c071e9b95`)

| File:line (at `c071e9b95`) | Before → after | Why |
| --- | --- | --- |
| `apps/dashboard/src/screens/business-day-start-editor.test.ts:125` (`ready()`), `:143`, `:170` | `click(el, "acknowledge")` before Save → removed; each case's `save.disabled` assertion after it unchanged | design §5: no acknowledge step; Save is gated by a ready preview |
| `business-day-start-editor.test.ts:132-149` (first case) | preview resolved at once; Save disabled after the time change because unacknowledged → the preview is held back: after the time change Save is disabled AND `variant "secondary"`; after it resolves Save is enabled AND `variant "primary"`; the write `toEqual` unchanged | Save is quiet and disabled until a ready preview, then primary (Forms contract) |
| `business-day-start-editor.test.ts:132,184,237` | test titles name acknowledgement → name the ready preview / a disabled Save; bodies unchanged | wording only |
| `business-day-start-editor.unsaved.test.ts:101-102` (`ready()`) | poll for `[data-test=acknowledge]` and click it → poll until Save is enabled | no acknowledge step |
| `venue-details-business-day.test.ts:205-210` | poll for and click acknowledge, then `save.disabled` false → poll until `save.disabled` is false, and `[data-test=acknowledge]` is null | no acknowledge step |

New cases beside them: a ready 05:00 → 03:00 preview makes Save primary and enabled with no acknowledge button and writes `{ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00", expectedClockRevision: 4 }`; clashes keep Save secondary and disabled and a submitted form writes nothing; `changeover_passed` in EN and ES under the field and at the bottom, with a second preview request and the draft kept; `clock_transition` in EN and ES on Save, and in EN on the preview; unsaved: a `changeover_passed` refusal keeps the protected draft. No other existing assertion failed.

Task 14b fix round 1 (lines at `34dca7fd7`):

| File:line (at `34dca7fd7`) | Before → after | Why |
| --- | --- | --- |
| `apps/dashboard/src/screens/business-day-start-editor.test.ts:879-903` ("says when a preview will work after the clocks change") | the message in the editor's `p[role=alert]` (the preview error line) → renamed "puts a preview refusal naming the time under the field, without Retry": the same exact message as the time field's `error` and the bottom line, no `[data-test=preview-retry]`, Save disabled; the bottom line is cleared once the time is set back | Forms: a refusal naming a shown field goes under that field (review I1) |
| `business-day-start-editor.test.ts:840-857` (changeover_passed, EN/ES) | the second preview answered at once with the same day; checks message, two preview calls, draft kept → the second preview is held back: Save `secondary` and disabled while it waits; after it answers `2026-10-22`, Save `primary` and enabled, and the retried write sends `2026-10-22` after a first write of `2026-10-21` | rule 7: the retried Save carries the new preview's date (review M1) |

Review fix round (lines at `1550c16c9`):

| File:line (at `1550c16c9`) | Before → after | Why |
| --- | --- | --- |
| `apps/server/src/business-day-changeover.test.ts:212` ("a day that would end before it starts, where midnight is skipped, is a clocks change", America/Havana) | `clocksChangeOn: "2027-03-13"` → `"2027-03-14"`; `saveFrom` unchanged | the old value was the business date whose bounds fail, the day before Havana's clocks jump from 13 March 23:59:59 to 14 March 01:00; the refusal now names the date the clocks show just after they change. The Europe/Madrid cases (`2026-10-25`, `2027-03-28`) pass unedited |

## Review focus (inputs no task's main tests reach; each line names the test that pins it)

1. **The rule-2 flip mid-dialog**: a preview taken at 00:20 for 00:30 and a Save at 00:31 must be
   refused `changeover_passed`, not saved for the wrong night. Pinned in Task 3b.
2. **A Save while tonight's change is already running** (H1): replace, keep-and-follow, and undo
   inside the window between the old and the new changeover. Pinned in Tasks 1 and 3b (cases a–d).
3. **A waiting change saved by A755's old form for a far date** (up to 366 days ahead): the card
   shows it and schedules no timer past `2^31−1` ms; a Save replaces it. Pinned in Task 3b and 13.
4. **A clash in a department other than the one being edited**: the refusal names the other range.
   Pinned in Task 7b.
5. **A changeover day across the clocks changing**: 05:00 → 03:00 saved on Sat 24 Oct 2026 22:00
   lasts 23 h, and the dialog shows "23 h" from the instants. Pinned in Tasks 3a and 14a.

---

## Slice 1 — Server: the next-changeover rule

Per-task reviewer: **yes** for Tasks 1–5.

### Task 1: the next-changeover plan as pure functions (~30 tool calls)

**Files:**
- Create: `apps/server/src/business-day-changeover.ts`, `apps/server/src/business-day-changeover.test.ts`
- Modify: `apps/server/src/backup-schedule.test.ts` (one new case)

**Interfaces — produces:**
- `planBusinessDayStart(clock: BusinessDayClock, dayCutover: string, at: Date): BusinessDayStartPlan`,
  where `clock` is the FULL clock (waiting rows included) and
  `BusinessDayStartPlan = { today: string; effectiveBusinessDay: string; kept: CutoverChange[]; removed: string[]; before: BusinessDayClock; candidate: BusinessDayClock }`:
  - `today = businessDayAt(clock, at)`; `future` = changes dated after `today`; `base` = the clock
    without `future`.
  - Rule 1: E = today + 1, `candidate = base` plus `{ E, dayCutover }` (no row when `dayCutover`
    already equals `cutoverForBusinessDay(base, E)`, which is an undo). If
    `businessDayBoundaryAt(candidate, E) > at`: `kept = []`, `removed` = every future date,
    `before = base`.
  - Otherwise (rule 2, and the H1 default): `kept` = the future row dated today + 1, if any (it ends
    today, and its moment is still ahead because today is running); E = today + 2;
    `before = base + kept`; `candidate = before` plus `{ E, dayCutover }` (no row when it equals
    `cutoverForBusinessDay(before, E)`); `removed` = the other future dates.
- `clockTransitionAt(clock: BusinessDayClock, dayCutover: string, at: Date): null | { clocksChangeOn: string; saveFrom: string | null }`
  — today's `candidateFor` daylight-saving check (`business-day-start.ts:128-142`: for days E−1, E,
  E+1, `plan.before` and `{ ...plan.before, dayCutover, cutoverChanges: [] }` must each have exactly
  one `localTimeOccurrences` of their start, and `businessDayBounds(plan.candidate, day)` must not
  throw) on the plan for `at`. `clocksChangeOn` is the first failing day in that order (review fix
  round: now the date the clocks show just after they change near that day, `clocksChangeDate`). `saveFrom` is
  the first moment after `at`, among `businessDayBoundaryAt(clock, d)` and
  `businessDayBoundaryAt({ ...clock, dayCutover, cutoverChanges: [] }, d)` for d = today … today+9,
  sorted, at which the check on that moment's own plan passes; `null` if none does. (The effective
  date changes only at those moments, design §5.)

- [ ] **Step 1: failing tests** in `business-day-changeover.test.ts`, Madrid clock
  `{ timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] }` (values from
  `plan-check.ts`, `plan-dst.ts`, `plan-h1.ts`, run 2026-10-18):
  - Save at `2026-10-20T20:00:00Z` (Tue 22:00): `"03:00"` → E `"2026-10-21"`; `"21:00"` → E `"2026-10-21"`.
  - Save at `2026-10-20T23:00:00Z` (Wed 01:00, still Tue's day): `"00:30"` → E `"2026-10-22"`,
    `kept []` (rule 2); `"03:00"` → E `"2026-10-21"`.
  - Extremes: base `23:59`, Save `"00:00"` at `2026-10-21T08:00:00Z` → E `"2026-10-22"`, and
    `businessDayBounds(candidate, "2026-10-21")` lasts 1 minute; base `00:00`, Save `"23:59"` at
    `2026-10-21T08:00:00Z` → E `"2026-10-22"`, `2026-10-21` lasts 2879 minutes.
  - H1, clock with `{ effectiveBusinessDay: "2026-10-21", dayCutover: "21:00" }`, Save at
    `2026-10-21T11:00:00Z` (Wed 13:00; `today "2026-10-20"`):
    (a) `"23:00"` → E `"2026-10-21"`, `kept []`, `removed ["2026-10-21"]`, Tue 20 ends
    `2026-10-21T21:00:00.000Z`;
    (b) `"10:00"` → E `"2026-10-22"`, `kept` the 21:00 row, `removed []`, Wed 21 runs
    `2026-10-21T19:00:00.000Z → 2026-10-22T08:00:00.000Z` (13 h);
    (c) `"05:00"` → same shape as (b), Wed 21 runs `2026-10-21T19:00:00.000Z → 2026-10-22T03:00:00.000Z`;
    (d) `"21:00"` → E `"2026-10-21"`, candidate equal to the clock (a no-op).
  - `clockTransitionAt(base, "02:30", at)`: `2026-10-23T01:00:00Z` →
    `{ clocksChangeOn: "2026-10-25", saveFrom: "2026-10-26T01:30:00.000Z" }`; `2026-10-26T01:15:00Z`
    → same; `2026-10-26T01:30:00Z` → `null`; `2026-10-26T02:00:00Z` → `null`;
    `2027-03-27T11:00:00Z` → `{ clocksChangeOn: "2027-03-28", saveFrom: "2027-03-29T00:30:00.000Z" }`;
    `2027-03-29T01:00:00Z` → `null`. `"03:00"` at every one of those moments → `null`.
- [ ] **Step 2:** add to `backup-schedule.test.ts` the accepted backup timing (design §5, probe
  `backup.ts`, seed `"seed"`, `{ kind: "wall-clock", days: "daily", at: "auto" }`): computed at Tue 20
  Oct 05:45 local on the unchanged clock → `Date.parse("2026-10-21T03:33:00.000Z")`; with 03:00
  effective 2026-10-21, computed at Wed 21 05:45 local → `2026-10-22T01:33:00.000Z`; with 21:00
  effective 2026-10-21, computed at Wed 21 05:45 local → `2026-10-21T19:33:00.000Z` (the reviewer
  re-ran these). It passes today (no product change); prove it by deletion — set
  `AUTO_MARGIN_MINUTES` to 31 locally, watch it fail, revert.
- [ ] **Step 3:** `pnpm --filter @waitron/server exec vitest run src/business-day-changeover.test.ts` — FAIL (module missing).
- [ ] **Step 4:** implement. Import `localTimeOccurrences` from `@waitron/venue-service` (as
  `business-day-start.ts:17` does) and the resolver from `@waitron/shared`.
- [ ] **Step 5:** run both files; PASS. Prettier. Commit
  `A788: work out which changeover a business-day start takes effect at`.

### Task 2: the waiting change loses its lock fields (~35 tool calls)

**Files:**
- Modify: `apps/server/src/business-day-start.ts:69-97,178-214`, `apps/server/src/venue-detail-types.ts:65-90`,
  `packages/venue-service/src/business-day-schedule.ts:538-565`,
  `packages/venue-service/src/service-day-context.ts:27-38`
- Test: `apps/server/src/business-day-start.test.ts`, `packages/venue-service/src/business-day-schedule.test.ts:563-588`

**Interfaces — produces:** `pending: null | { effectiveBusinessDay: string; dayCutover: string; startsAt: string }`
(the first waiting row) in both `BusinessDayClockModel` and `BusinessDayScheduleStatus`;
`BusinessDayStartPreview` without `locksAt`.

- [ ] **Step 1:** change the checks listed for Task 2 to exact objects (`startsAt` for the 11-04
  07:00 row is `2026-11-04T06:00:00.000Z`; for the server's 11-04 03:00 row `2026-11-04T02:00:00.000Z`),
  asserting `pending` with `toEqual` so a leftover key fails. Run; FAIL on the extra keys.
- [ ] **Step 2:** remove `locksAt`/`editable` from both producers and types, and `locksAt` from the
  preview. `assertEditable` stays until Task 3b, computing the lock from the day-before boundary
  locally, so behaviour is unchanged in this task.
- [ ] **Step 3:** `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts src/venue-details.test.ts src/business-day-persistence.test.ts`
  and `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/opening-hours-calendar.test.ts`;
  PASS. The dashboard client keeps its own copy of the old fields until Task 13.
- [ ] **Step 4:** prettier; commit `A788: a waiting business-day change has no lock time`.

### Task 3a: the preview takes only the start (~45 tool calls; waits on owner question 1)

**Files:** `apps/server/src/business-day-start.ts:49-68,178-214`, `apps/server/src/location-settings-api.ts:181-203`,
`apps/server/src/business-day-start.test.ts` (preview cases only).

**Interfaces — consumes** Task 1's `planBusinessDayStart`, `clockTransitionAt`. **Produces:**
`GET …/business-day-start/preview?dayCutover=HH:MM&expectedClockRevision=N` — any other key is
refused `venue.business_day_invalid` `{ field: "body", reason: "unknown_field" }`. Answer:
`{ revision, previousDay, effectiveDay, conflicts, conflictCount, backupDeadlines }`, where
`effectiveDay.businessDay` is the plan's E, `previousDay` is E − 1, both bounded on
`plan.candidate`; refusals: revision, unreadable clock, `clock_transition` (Task 4 adds the params),
history for E, and the conflicts catch, with `assertBusinessDayClockChange(tx, cfg, plan.before, plan.candidate, E)`.
**Decision:** conflicts compare `plan.before` (the clock without the rows being replaced) with the
candidate, not the stored clock: replacing a waiting 21:00 with 23:00 is a move from the start in
force, not from 21:00. (Today the stored clock, waiting row included, is `before`,
`business-day-start.ts:193-199`.) An undo previews the plan's candidate (no row added).
**Decision (controller ruling, Task 3b fix round 1):** the history check for E compares the STORED
clock (`model.clock`, waiting rows included) with `plan.candidate`, in the preview and the Save:
spec §5 refuses only what is recorded at or after the earlier of the stored and the new changeover.
Measured from `plan.before`, a replace of a waiting 21:00 with 23:00 was refused for an order opened
at Wed 10:00, which stays in Tuesday under both clocks. Conflicts still compare `plan.before`.

- [ ] **Step 1: failing tests** — the Task 3a rows of the running list, plus at
  `at = 2026-10-20T20:00:00Z` (Tue 22:00 Madrid): preview `03:00` → `effectiveDay.businessDay
  "2026-10-21"`, `previousDay { businessDay: "2026-10-20", dayCutover: "05:00", startAt:
  "2026-10-20T03:00:00.000Z", endAt: "2026-10-21T01:00:00.000Z" }`; `21:00` → previousDay ends
  `2026-10-21T19:00:00.000Z`; at `2026-10-20T23:00:00Z`, `00:30` → E `2026-10-22`, previousDay
  `2026-10-21T03:00:00.000Z → 2026-10-21T22:30:00.000Z`; at `2026-10-24T20:00:00Z`, `03:00` →
  previousDay `2026-10-24T03:00:00.000Z → 2026-10-25T02:00:00.000Z` (23 h); a query carrying
  `effectiveBusinessDay` → 400 `unknown_field`; H1 (b) with the 21:00 row inserted, at
  `2026-10-21T11:00:00Z`, `10:00` → E `2026-10-22`, previousDay `2026-10-21T19:00:00.000Z →
  2026-10-22T08:00:00.000Z`.
- [ ] **Step 2–4:** fail; implement the preview path; pass
  `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`. The PUT path is
  untouched, so the PUT halves of the cases keep the A755 date until 3b.
- [ ] **Step 5:** prettier; append rows; commit `A788: the business-day preview chooses the changeover itself`.

### Task 3b: Save takes the next changeover; DELETE goes (~70 tool calls; waits on both owner questions)

**Files:** `apps/server/src/business-day-start.ts` (write path), `apps/server/src/location-settings-api.ts:204-225`,
`apps/server/src/errors.ts:45` (params gain optional `clocksChangeOn?: string; saveFrom?: string | null`),
tests `business-day-start.test.ts`, `business-day-history.test.ts`, `boot.clock-wiring.test.ts`,
`attendance-cutover-settings.test.ts`.

**Order of the write path** (each step pinned by a test):
1. parse body; read model; revision check (`venue.business_day_changed`), unreadable clock refusal (unchanged);
2. `dayCutover` equals the start in force (`cutoverForBusinessDay(model.clock, currentBusinessDay)`)
   and nothing waits → `{ changed: false }`, before any date check (so `business-day-start.test.ts:522`
   stays unedited);
3. `plan = planBusinessDayStart(model.clock, dayCutover, at)`; body date ≠ `plan.effectiveBusinessDay`
   → `venue.business_day_invalid` `{ field: "dayCutover", reason: "changeover_passed" }`;
4. the plan's candidate equals the stored clock → `{ changed: false }` (same Save twice);
5. `clockTransitionAt` non-null → `venue.business_day_invalid`
   `{ field: "dayCutover", reason: "clock_transition", clocksChangeOn, saveFrom }`;
6. `protectHistory(model.clock, plan.candidate, d)` for each removed date `d`, and
   `protectHistory(model.clock, plan.candidate, E)` (the stored clock, per the controller's ruling in
   fix round 1; see Task 3a's decision); `assertBusinessDayClockChange(plan.before, plan.candidate, E)`;
7. delete the removed rows, insert `{ E, dayCutover }` unless the plan adds no row, bump revision.

- [ ] **Step 1: failing tests** — the Task 3b rows of the running list, and, at Tue 22:00
  (`2026-10-20T20:00:00Z`): Example 1 PUT with E `2026-10-21` → one row 03:00; Example 4 (03:00 at
  Tue 22:00, then 04:00 at `2026-10-20T21:30:00Z`, rev 1) → one row 04:00, Tue 20 ends
  `2026-10-21T02:00:00.000Z`; Example 5 (then 05:00 at `2026-10-20T21:45:00Z`, rev 1) → no rows,
  revision 2; a far A755 row (`{ "2027-06-01", "07:00:00" }`, revision 1) replaced by a Save of 03:00
  → only the 10-21 row; the rule-7 races: preview 03:00 at Tue 22:00, PUT with E 10-21 at
  `2026-10-21T03:00:00.000Z` → 400 `changeover_passed`, no row; preview `00:30` at
  `2026-10-20T22:20:00Z`, PUT at `2026-10-20T22:31:00Z` → 400 `changeover_passed`.
  **H1 (default pending the owner)**, 21:00 saved at Tue 22:00 (row `2026-10-21`), then at
  `2026-10-21T11:00:00Z` (Wed 13:00): (a) `23:00` with E `2026-10-21` → rows `[2026-10-21 23:00]`;
  (b) `10:00` with E `2026-10-22` → rows `[2026-10-21 21:00, 2026-10-22 10:00]`, and the model reads
  Wed 21 as `2026-10-21T19:00:00.000Z → 2026-10-22T08:00:00.000Z`; (c) `05:00` with E `2026-10-22`
  → rows `[2026-10-21 21:00, 2026-10-22 05:00]`; (d) `21:00` → `changed: false`. In each, Tue 20's
  end is still after `at` (assert it), so nothing is relabelled.
  In `business-day-history.test.ts` (after owner approval), `boot.clock-wiring.test.ts` and
  `attendance-cutover-settings.test.ts` make only the edits in the running list.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`; FAIL as expected.
- [ ] **Step 3:** implement; delete `assertFutureDate`, `assertEditable`, `cancelBusinessDayStart`,
  the `DELETE` route and its import.
- [ ] **Step 4:** run `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts src/business-day-history.test.ts src/boot.clock-wiring.test.ts src/attendance-cutover-settings.test.ts src/business-day-persistence.test.ts src/venue-details.test.ts src/venue-details-api.test.ts src/location-settings-api.test.ts src/configuration-transfer.test.ts`; PASS.
- [ ] **Step 5:** prettier; append rows; commit `A788: a business-day start saves for the next changeover`.

### Task 4: the clocks-change refusal names when a Save will work (~25 tool calls)

**Files:** `apps/server/src/business-day-start.ts`, `apps/server/src/business-day-start.test.ts`

- [ ] **Step 1:** exact bodies for the DST case: PUT 05:00 → 02:30 at `2026-10-23T01:00:00Z` with E
  `2026-10-24` → 400 `{ code: "venue.business_day_invalid", params: { field: "dayCutover", reason: "clock_transition", clocksChangeOn: "2026-10-25", saveFrom: "2026-10-26T01:30:00.000Z" } }`;
  at `2026-10-26T01:15:00Z` (E `2026-10-26`) → same `saveFrom`; at `2026-10-26T02:00:00Z` with E
  `2026-10-27` → 200. Spring: at `2027-03-27T11:00:00Z` (E `2027-03-28`) → `clocksChangeOn
  "2027-03-28"`, `saveFrom "2027-03-29T00:30:00.000Z"`; at `2027-03-29T01:00:00Z` (E `2027-03-30`) →
  200. The preview at each refused moment answers the same 400.
- [ ] **Step 2–4:** fail; wire the params (if 3b already did, this task adds the assertions and
  proves them by deleting `saveFrom` from the throw); pass
  `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`.
- [ ] **Step 5:** prettier; commit `A788: the clocks-change refusal says when to save again`.

### Task 5: a "keep open" for today past the new changeover is a clash (~45 tool calls)

**Files:** `packages/module/src/module.ts:607` (union gains `"kept_open"`),
`packages/venue-service/src/business-day-schedule.ts` (new `keptOpenConflicts`, called by
`assertBusinessDayClockChange` only); tests `packages/venue-service/src/business-day-schedule.test.ts`,
`apps/server/src/business-day-start.test.ts`.

**Interfaces — produces:** `keptOpenConflicts(tx, cfg, before, candidate, effectiveBusinessDay): Promise<BusinessDayClockConflict[]>`
— reads `period_extensions` (`schema/period-extensions.ts`) and `zone_extensions`
(`schema/zone-extensions.ts`) rows of the venue with `business_day = E − 1`; a row clashes when
`(minuteOfServiceDay(endsAt, cutoverForBusinessDay(before, E − 1)) || 1440) > serviceDayWallContext(candidate, E − 1).endMinute`.
Conflict: `{ departmentId, departmentName, periodId?, periodName?, zoneId?, zoneName?, endsAt: "HH:MM", rangeIndex: 0, reason: "kept_open" }`
— no `startsAt` and no `date` (it is always tonight; the dialog's line builder prints a `date` when
one is present, `business-day-start-editor.ts:350`). `assertBusinessDayClockChange` appends them to `businessDayClockConflicts`' list and
count. `businessDayClockConflicts` is unchanged: an extension saved after a Save is already bounded
by the waiting end (`keep-open.ts:40,133`), so the hours writers' after-write check does not read
extensions.

- [ ] **Step 1: failing tests.** venue-service: fixture department/period, `period_extensions` row
  for `2026-11-03` 22:00 → 04:30, 05:00 → 03:00 effective `2026-11-04` → one `kept_open` conflict
  with `endsAt "04:30"`; `02:30` → none; a `zone_extensions` row names the zone. Server: `authorRange("13:00", "16:00")`
  (no clash of its own with 03:00, probe `a788-probe`), a raw-SQL `period_extensions` row for
  `2026-10-20` until `04:30` on that department and period; Save 03:00 at Tue 22:00 → 409
  `venue.business_day_hours_conflict` with `conflictCount 1` and conflicts
  `[expect.objectContaining({ reason: "kept_open", endsAt: "04:30" })]`; the preview lists it.
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`,
  `pnpm --filter @waitron/module exec tsc --noEmit`, `pnpm --filter @waitron/venue-service exec tsc --noEmit`.
- [ ] **Step 5:** prettier; commit `A788: a keep-open past the new changeover blocks the change`.

## Slice 2 — Venue service: hours stay editable, clashes name their range

Per-task reviewer: **yes** for Tasks 6, 7a, 7b, 8 and 10.

### Task 6: only the ranges that fail are marked `range` (~40 tool calls)

**Files:** `packages/venue-service/src/business-day-schedule.ts:368-462`, `packages/module/src/module.ts:607`
(union gains `"overlap"`), test `packages/venue-service/src/business-day-schedule.test.ts`.

**Algorithm (design §6):** for a group whose ranges do not parse together under the old or the new
start, parse each range alone under both; a range that fails alone gets `range`. If at least one
fails alone, every other range goes through the remaining checks (`all_day`, `endpoint_day`,
`sending_cutoff`, `transition_strip`) as if the day had parsed, and `sending_cutoff`'s "later range
on the same day" list leaves the failing ranges out. If none fails alone, every range of the group
gets `overlap`. `all_day` keeps priority over both.

- [ ] **Step 1: failing tests** with the file's `fixture`/`seasonDay`/`check` helpers, weekday 3:
  lunch 13:00–16:00 + dinner 22:00–04:30, 05:00 → 03:00 → exactly one conflict, the dinner, `range`
  (probe `a788-fix-probe` "mixed"); lunch 13:00–16:00 + dinner 20:00–23:30, 05:00 → 21:00 → dinner
  `range`, lunch `endpoint_day` (probe `a788-fix2`); the overlap case (`:396`) → both `overlap`,
  count 2. Mockup 04 (Fri 21:00–04:00, Sat 21:00–04:30, 05:00 → 03:00) → two `range`, unchanged.
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/special-days.holiday-name.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`.
- [ ] **Step 5:** prettier; append row; commit `A788: a clash names only the range that crosses the new start`.

### Task 7a: the guard, the after-write check and the menu writers (~55 tool calls)

**Files:**
- Modify: `packages/venue-service/src/service-day-context.ts` (add `settledClock`),
  `business-day-schedule.ts:485-509` (guard; new `assertWaitingChangeFits`), `errors.ts:23` (retire
  `hours.clock_change_pending`, add `hours.clock_change_conflict`), `routes.ts:134` (409 for the new
  code; the old entry removed), `menu-timetable.ts` (`replaceMenuWeek` :649-670, `writeMenuPeriod`
  :510-605, `stageMenuWeek` :695-730), `index.ts` (exports if needed)
- Test: `packages/venue-service/src/business-day-schedule.test.ts`

**Interfaces — produces:**
- `settledClock(clock: BusinessDayClock, at: Date): BusinessDayClock` — the clock without changes
  whose `businessDayBoundaryAt(clock, change.effectiveBusinessDay) > at.toISOString()`.
- `assertWaitingChangeFits(tx, cfg, at: Date, acquiredClock?: BusinessDayClock): Promise<void>` —
  for each waiting change in date order (normally one; two after an H1 keep-and-follow Save),
  `businessDayClockConflicts(tx, cfg, <clock up to the previous waiting change>, <clock up to and including this one>, change.effectiveBusinessDay)`;
  the first with a count above 0 throws
  `AppError("hours.clock_change_conflict", { dayCutover: "HH:MM", startsAt: <boundary ISO>, conflicts, conflictCount })`.
  It walks up to 400 years of each yearly special day (`business-day-schedule.ts:216-228`) on every
  call; that cost is paid only while a change waits, and was already paid on every Save preview.
- `assertBusinessDayScheduleWrite` keeps its revision check and loses the pending refusal; the
  module seat signature (`module.ts:619`) is unchanged.
- Decision: the editors' own parse and last-orders checks run on `settledClock(clock, at)`, so the
  waiting start is checked once, after the write, by the venue-wide checker — which names the
  department, period, weekday and season. A failure under the waiting start alone therefore answers
  `hours.clock_change_conflict` (design rule 5), `range` and `all_day` included. A throw inside the
  writer's transaction rolls the write back (`routes.ts:438-450` `gated` is `withTransaction`; the
  reviewer re-ran `season-weeks.test.ts` "writing nothing", 9 passed).
- Every time-changing call (`changeKind === "time"`) runs `assertWaitingChangeFits` after its
  write; metadata writes do not.

- [ ] **Step 1: failing tests.** With a waiting 03:00 change (settings revision 1, change row `E`,
  `at = 2026-11-02T12:00Z`):
  - guard: `assertBusinessDayScheduleWrite(tx, cfg, "time", at, 1)` resolves (running list `:430`).
  - `replaceMenuWeek` Wed 09:00–17:00 → resolves and is stored; Sat 21:00–04:30 → rejects
    `{ code: "hours.clock_change_conflict", params: { dayCutover: "03:00", startsAt: "2026-11-04T02:00:00.000Z", conflictCount: 1, conflicts: [expect.objectContaining({ weekday: 6, startsAt: "21:00", endsAt: "04:30", reason: "range" })] } }`
    and the week reads back as before; Sat 21:00–02:45 with the period's offset +30 →
    `transition_strip` (mockup 06), nothing written.
  - `updateMenuPeriod` offset 0 → +30 with Sat 21:00–02:45 stored → `transition_strip`, offset
    still 0; `saveMenuPeriod` creating a period with offset +15 and no ranges → accepted (L5).
  - Last-orders under the waiting start alone: Fri 04:00–06:00, offset +30, 05:00 in force, 03:00
    waiting (reviewer probe `offset-full.mts`) → `hours.clock_change_conflict`, not
    `menu_timetable.invalid` `end_offset`; nothing written.
  - `settledClock` unit cases: a change whose boundary is after `at` is dropped; one at or before is kept.
- [ ] **Step 2:** `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts`; FAIL.
- [ ] **Step 3:** implement. `stageMenuWeek` receives the settled clock from `replaceMenuWeek` for
  parsing; `assertWeekEndOffsets` and `writeMenuPeriod`'s `endOffsetClash` (`:597`) get it as
  `acquiredClock`. The other writers' cases in `:489-561` now expect acceptance of their non-clashing
  edits; their refusal cases come in 7b and 8.
- [ ] **Step 4:** run `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/menu-timetable.test.ts src/period-end-offset.test.ts`;
  PASS. Prove the after-write check by deleting its call in `replaceMenuWeek`: the Sat 21:00–02:45
  case must fail.
- [ ] **Step 5:** prettier; append rows; commit `A788: opening hours stay editable while a business-day change waits`.

### Task 7b: zone weeks, season weeks, period delete, adding a department (~50 tool calls)

**Files:** `packages/venue-service/src/zone-closed-times.ts:33-90`, `season-weeks.ts:314-385`
(`saveSeasonWeeks`), `period-delete.ts:188-260` (and `:253` `departmentEndOffsetClash` gets the
settled clock), test `business-day-schedule.test.ts`, `operations.test.ts` (the add-department case).

- [ ] **Step 1: failing tests** (03:00 waiting as in 7a):
  - `replaceZoneClosedWeek` closed 22:00–04:30 → `range` naming the zone, nothing written;
    12:00–13:00 accepted.
  - `saveSeasonWeeks`: a clashing department week → refused, nothing written; a non-clashing one
    (Wed 09:00–17:00) → accepted (L5).
  - `deletePeriod`: with a raw clashing range (`seasonDay`) on period A and a second period B,
    deleting B is refused naming A's range; deleting A is accepted (its clash goes with it).
  - Review focus 4: department X edited cleanly while department Y holds a raw clash → refused,
    the conflict names Y's department and range.
  - Adding a department (M4): with 21:00 waiting, `createDepartment` (whose `placeOpenPeriod` writes
    Mon–Fri 09:00–17:00) → `hours.clock_change_conflict` with `reason "endpoint_day"` (lunch-time
    ranges move date under 21:00, probe `a788-fix-probe`), and no department row; with 03:00 waiting
    → accepted. Decision: refusing is honest (the new department's default hours would clash); the
    dialog shows the clash line (Task 10).
- [ ] **Step 2–4:** fail; wire `assertWaitingChangeFits` and the settled clock; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/zone-closed-times.test.ts src/season-weeks.test.ts src/period-delete.test.ts src/operations.test.ts`.
- [ ] **Step 5:** prettier; append rows; commit `A788: zone, season-week and period writers check the waiting start after they write`.

### Task 8: special days and seasons, and the route (~55 tool calls)

**Files:** `packages/venue-service/src/special-days.ts` (`saveSpecialDay` :1035, `deleteSpecialDay`
:1196, `cutoversFor` :585-588, `checkScheduleAfterWrite` calls at `:1190` and `:1206`), `seasons.ts`
(`saveSeasons` :79, `checkScheduleAfterSeasonWrite` :71-74), tests `business-day-schedule.test.ts`,
`special-days.test.ts`, `seasons.test.ts`. (`menu-timetable-routes.test.ts:852-873` was changed in Task 7a, because 7a's `replaceMenuWeek` change made it fail.)

**Decisions:** `cutoversFor`: a repeating day parses under the settled clock's starts (Task 11
narrows them); a one-off date parses under its own date's start on the SETTLED clock, so a one-off
date on or after the waiting change's date is checked against the waiting start after the write,
like every other range. `checkScheduleAfterWrite` and `checkScheduleAfterSeasonWrite` take a clock
argument and receive `settledClock(clock, at)` (both writers have `at`: `saveSeasons(…, at, …)`
`seasons.ts:79-84`, `deleteSpecialDay(…, at, …)` `special-days.ts:1196-1202`).

- [ ] **Step 1: failing tests.** While 03:00 waits: a one-off special day dated `2026-11-04`
  painting 22:00–04:30 → `hours.clock_change_conflict` naming the special day (`specialDayName`,
  `date`), nothing written; 09:00–17:00 accepted; a zone paint likewise. `deleteSpecialDay` of the
  day holding a raw clash → accepted; of another while one exists → refused. `saveSeasons` adding a
  season while a raw clash exists → refused (the copy carries the clash), nothing written; with none
  → accepted. Last-orders under the waiting start alone, through `saveSeasons` and through
  `saveSpecialDay` (H3, with Task 7a's values: 01:00–03:00 followed by 03:00–04:00 on the next
  day, offset +30, 03:00 waiting; the earlier Fri 04:00–06:00 cannot be written under the 05:00
  start in force) → `hours.clock_change_conflict`, not
  `season.invalid` / `special_day.invalid` `end_offset`. Route (running list, done in Task 7a):
  `PUT …/menu-week` 09:00–14:00 → 204; 06:00–08:00 with a waiting 07:00 → 409 with exact params
  (`startsAt: "2026-11-04T06:00:00.000Z"`).
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/special-days.test.ts src/seasons.test.ts src/menu-timetable-routes.test.ts src/hours-routes.test.ts`.
  `/usr/bin/grep -rn "clock_change_pending" packages apps scripts` now finds only the venue-service
  dashboard (Task 10) — say so in the handover.
- [ ] **Step 5:** prettier; commit `A788: special days and seasons check the waiting start after they write`.

### Task 9: shared formatters for the changeover (~20 tool calls; no reviewer)

**Files:** `packages/dashboard-kit/src/date-format.ts`, `date-format.test.ts`, `index.ts` (export).

**Interfaces — produces** (locale defaults to `currentLocale()`):
- `formatChangeoverMoment(iso: string, timeZone: string, locale?: string): string` — from
  `Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts`
  as `${weekday} ${day} ${month}, ${hour}:${minute}` (es-ES's own format adds a comma after the
  weekday; checked with Node 2026-10-18, and by the reviewer).
- `formatBusinessDate(day: string, locale?: string): string` — `${weekday} ${day} ${month}` read in UTC.
- `formatDayLength(minutes: number): string` — whole hours and minutes, a zero part left out.

- [ ] **Step 1: failing tests:** `formatChangeoverMoment("2026-10-21T01:00:00.000Z", "Europe/Madrid", "en-GB")`
  → `"Wed 21 Oct, 03:00"`; `"es-ES"` → `"mié 21 oct, 03:00"`; `formatBusinessDate("2026-10-20", "en-GB")`
  → `"Tue 20 Oct"`, es-ES → `"mar 20 oct"`; `formatDayLength(1320)` → `"22 h"`, `1170` →
  `"19 h 30 min"`, `2879` → `"47 h 59 min"`, `1` → `"1 min"`, `1380` → `"23 h"`, `780` → `"13 h"`.
- [ ] **Step 2–4:** fail; implement; pass `pnpm --filter @waitron/dashboard-kit exec vitest run src/date-format.test.ts`.
- [ ] **Step 5:** prettier; commit `A788: format a changeover moment, a business date and a day's length`.

### Task 10: the opening-hours screens show the clash line (~60 tool calls)

**Files:**
- Create: `packages/venue-service/src/dashboard/clock-change-conflict.ts` (+ `.test.ts`)
- Modify: `dashboard/strings.ts` (EN `:377`, ES `:1232`: remove `hours.clock_change_pending`; add the
  keys below), `season-painter.ts:549`, `special-day-painter.ts:955,1071`, `season-refusal.ts:38`,
  `period-delete-dialog.ts:104-107`, `period-dialog.ts:412-419` (bottom line),
  `department-dialogs.ts:281-288` (`refusal`)
- Tests: the five in the running list, plus a period-dialog and a department-dialog case.

**Interfaces — produces:** `clockChangeConflictText(refusal: Refusal): string | undefined`
— `undefined` unless `refusal.code === "hours.clock_change_conflict"`; otherwise
`format("hours.clock_change_conflict", { range, time: params.dayCutover, when: formatChangeoverMoment(params.startsAt, params.timeZone), reason })`
for `params.conflicts[0]`, where `range` is `${periodName ?? zoneName ?? departmentName} ${startsAt}–${endsAt}`.
Decision on review L6: mockup 06's sentence (period and times only) is the approved shape and is
kept; a line naming a range in another department or weekday is ambiguous, recorded as a backlog
entry in Task 17 rather than changed here.

Strings (design §7; the reason labels are copied because this dashboard has its own catalogue):

| Key | EN | ES |
| --- | --- | --- |
| `hours.clock_change_conflict` | {range} clashes with the new business-day start, {time} from {when}: {reason}. | {range} choca con el nuevo inicio del día de trabajo, {time} desde {when}: {reason}. |
| `hours.conflict.range` | Crosses the new start | Cruza el nuevo inicio |
| `hours.conflict.overlap` | Invalid or overlapping range | Tramo inválido o solapado |
| `hours.conflict.endpoint_day` | Moves to another day | Pasa a otro día |
| `hours.conflict.all_day` | All-day range needs new hours | El día completo necesita otro horario |
| `hours.conflict.sending_cutoff` | Last orders clash with the new start or next period | (copy `apps/dashboard/src/i18n/strings.ts:3808-3809` verbatim) |
| `hours.conflict.transition_strip` | Hours overlap the changed start | El horario coincide con el cambio de inicio |

- [ ] **Step 1: failing tests:** the formatter with mockup 06's refusal (`periodName "Dinner"`,
  `21:00–02:45`, `dayCutover "03:00"`, `startsAt "2026-10-21T01:00:00.000Z"`, Madrid,
  `transition_strip`) → `"Dinner 21:00–02:45 clashes with the new business-day start, 03:00 from Wed 21 Oct, 03:00: Hours overlap the changed start."`;
  the ES sentence (restore the locale after). Each listed screen test feeds
  `hours.clock_change_conflict` and expects that sentence where it expected the pending one; the
  department dialog shows it for a refused add.
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/clock-change-conflict.test.ts src/dashboard/seasons-window.test.ts src/dashboard/season-painter.save.test.ts src/dashboard/periods-list.delete.test.ts src/dashboard/period-delete-dialog.test.ts src/dashboard/period-dialog.test.ts src/dashboard/special-day-painter.save.test.ts src/dashboard/department-dialogs.test.ts`.
  `/usr/bin/grep -rn "clock_change_pending" packages apps scripts` → nothing outside dated plan docs.
- [ ] **Step 5:** prettier; append rows; commit `A788: opening-hours screens name the range that clashes with the new start`.

## Slice 5 — Only the start in force limits new hours (question 4, A)

Per-task reviewer: **yes** for Tasks 11–12.

### Task 11: the editors check the start in force, not every start ever (~60 tool calls)

**Files:** `packages/venue-service/src/service-day-context.ts` (add `inForceClock`), every caller
that receives `settledClock` from Tasks 7a–8 for an UNDATED check, `zone-closure-hours.ts:40-47`,
`period-delete.ts:341`; tests `business-day-schedule.test.ts:590-657`, `period-end-offset.test.ts`,
`zone-closure-hours.test.ts`.

**Interfaces — produces:** `inForceClock(clock: BusinessDayClock, at: Date): BusinessDayClock` =
`{ ...clock, dayCutover: <start in force at at>, cutoverChanges: [] }`.

**Decisions:**
- Undated checks (normal and season weeks, zone weeks, repeating special days, and every
  last-orders check through `endOffsetClash`/`findSeasonEndOffsetClash`) get `inForceClock`. With no
  changes in it, `scheduleCutovers` returns the start in force alone and `findSeasonEndOffsetClash`'s
  dated loop (`period-end-offset.ts:181-186`) visits no past change's dates. Probe `plan-fold.mts`
  (2026-10-18): Wed and Sat 22:00–04:30, offset +30, on a folded 05:00 clock → `null`; the same on the
  unfolded settled clock (reviewer `offset.mts`) → a clash dated `2026-10-21`. `scheduleCutovers`
  itself is unchanged.
- One-off dates keep their own date's start on the settled clock (special days, and the dated
  closure check `assertDatedClosuresInHours`, which already uses each date's own start).
- First-start readers (consumer map ★): `assertSeasonClosuresInHours` (`zone-closure-hours.ts:45-47`)
  and `period-delete.ts:341` move to the start in force; the sorting-only and fallback readers stay.
  List each with its decision in the handover.
- `parsed[0]` in `stageMenuWeek`/`stageZoneClosedWeek` is now the parse under the start in force;
  touching same-period ranges are joined in that order, which can store a range that crosses an
  older start. Task 12 draws it.

- [ ] **Step 1: failing tests** (probe `hours-back.mts`; venue 05:00, changes 03:00 from
  `2026-10-21` and 05:00 from `2026-10-28`, `at = 2026-11-02T12:00Z`): `replaceMenuWeek` Wed
  22:00–04:30 → accepted (refused `order` today); 05:00–05:00 → accepted (refused `empty`);
  22:00–02:30 → accepted; Wed 22:00–04:30 with the period's offset +30 → accepted (H2; refused
  `end_offset` on the settled clock). At `at = 2026-10-25T12:00Z` (03:00 in force) 22:00–04:30 →
  refused `menu_timetable.invalid` reason `order`. Annual special day 07:00–07:00 after 07:00 took
  effect → accepted; annual 06:00–08:00 → refused (running list `:640-657`). A zone closure (H4):
  department 04:00–06:00, closure 05:30–06:00, after 05:00 → 03:00 took effect → accepted (refused
  `outside_hours` today; reviewer `closure2.mts`, re-run 2026-10-18: `0` under 05:00, `-1` under
  03:00); closure 06:00–07:00 → still refused (control). Unchanged checks `:602`, `:613`, `:626`, `:633`
  keep passing (titles may say "the start in force").
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/special-days.test.ts src/period-end-offset.test.ts src/menu-timetable.test.ts src/zone-closed-times.test.ts src/zone-closure-hours.test.ts src/period-delete.test.ts src/seasons.test.ts`
  (existing files only).
- [ ] **Step 5:** prettier; append rows; commit `A788: new opening hours are checked against the start in force`.

### Task 12: the calendar cuts a past day's misfitting range at that day's ends (~70 tool calls)

**Files:**
- Create: `packages/venue-service/src/calendar-cut.ts` (+ `.test.ts`)
- Modify: `packages/venue-service/src/day-resolver.ts:134-219` (an optional, calendar-only `cut`
  option on `resolveDepartmentsDays` and `resolveZoneClosedDays`, applied to each day's SEASON ranges
  before `layerPaint`/`layerZonePaint` and to the result; absent → today's behaviour exactly),
  `opening-hours-calendar.ts:211-259` (month), `hours.ts` `calendarDays` (year tone; thread
  `readOpeningHoursYear`'s `at` to it) — the only callers that pass it
- Tests: `calendar-cut.test.ts`, `opening-hours-calendar.test.ts`, `day-resolver.test.ts`

**Interfaces — produces:**
`cutToOwnDay<T extends ClosedRange>(range: T, day: { dayCutover: string; endMinute: number }, anchor: string): T | null`
— `anchor` is the start in force (`cutoverForBusinessDay(clock, currentBusinessDay)` from the read's
`at`; the venue's first start when the current day cannot be read). A range that fits the day's own
start (`rangeSpan(range, dayCutover)` start < end, or `startsAt === endsAt === dayCutover`) is
returned unchanged — the dashboard's `placeOnDay` already clips a fitting range at `endMinute`
(`zone-own-hours.ts:25-34`). Otherwise, if it fits `anchor`, it is placed by the anchor
(`offset = minutes(anchor) − minutes(dayCutover)`, interval `[span(anchor).start + offset,
span(anchor).end + offset]`), clipped to `[0, endMinute]`, and returned with `startsAt`/`endsAt`
rewritten to the clipped wall times (`null` when nothing is left). A range that fits neither is
returned unchanged (today's drawing). Pure.

**Why server-side:** on a special-day date `layerPaint` drops a range whose span runs backwards
(`day-paint.ts:39-50`), so the client never receives it; and `placeOnDay` is shared with server
validation (`closureOutsideHours`) and must not change. Nothing that decides service, keep-open,
routing, closures or a sale's business day passes the option (`resolveDepartmentService`,
`keep-open.ts`, `operations.ts`, `routing-store.ts`, `working-order.ts`, `module.ts:709`,
`planned-service-guides.ts`, staffing — grep the callers and list them in the handover).
**`readSeasonDays` (M5) is not given the option:** it feeds the special-day painter, which layers
paint over those ranges in the browser for editing (`special-day-painter.ts:1193,1250-1251,1292`);
a cut range there would show season hours different from what is stored. Task 17 records it as a
backlog entry.

- [ ] **Step 1: failing tests** (`calendar-cut.test.ts`): day 03:00/1440, anchor 05:00, 22:00–04:30
  → 22:00–03:00; day 07:00/1440, anchor 05:00, 06:00–08:00 → 07:00–08:00; day 03:00/1440, anchor
  05:00, 05:00–05:00 → 05:00–03:00; a fitting range (09:00–17:00 on a 05:00 day) is returned as the
  same object; a range fitting neither is returned unchanged. Calendar
  (`opening-hours-calendar.test.ts`, `at = 2026-11-02T12:00Z`): venue 05:00, changes 03:00 from
  `2026-10-21` and 05:00 from `2026-10-28`, Saturday 22:00–04:30 stored after the return (Task 11
  allows it); October 2026: Sat 24 Oct draws `22:00–03:00`, Sat 31 Oct `22:00–04:30`; a one-off
  special day on Sat 24 Oct painting only a 12:00–15:00 lunch keeps the season's cut dinner (dropped
  today). `day-resolver.test.ts`: the same data without the option gives today's ranges.
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/calendar-cut.test.ts src/opening-hours-calendar.test.ts src/day-resolver.test.ts src/hours.test.ts src/menu-timetable.test.ts src/keep-open.test.ts`.
  Prove the option is calendar-only by deletion: drop it from the month read; the Sat 24 Oct case
  fails, nothing else does.
- [ ] **Step 5:** prettier; commit `A788: past days draw a range that misfits their start cut at their ends`.

## Slice 3 — Dashboard: card and dialog

Per-task reviewer: **yes** for Tasks 14a and 14b (rule 7 on the client); Tasks 13 and 15 take the
LIGHT path.

### Task 13: the Business-day card (~60 tool calls)

**Files:** `apps/dashboard/src/api/client.ts:108-149,2967-2971`, `apps/dashboard/src/api/client-routes.test.ts`,
`apps/dashboard/src/screens/business-day-start-editor.ts` (card part `:374-441`, `#cancelPending`
`:286-304`, and every read of `pending.editable`: `:137`, `:389`, `:440`), `apps/dashboard/src/i18n/strings.ts`,
tests `business-day-start-editor.test.ts`, `venue-details-business-day.test.ts`.

**Decisions:**
- Client: `pending` without `locksAt`/`editable`, preview without `locksAt` (the dialog's "Editable
  until" preview row goes); reason union gains `"overlap" | "kept_open"` (mapped to today's
  `conflict_range` text until Task 14a); `cancelBusinessDayStart` and `#cancelPending` removed;
  `#begin` no longer checks `editable` (L3). The preview input changes in 14a.
- Card rows: "Starts at" = start in force, always. One "New start" row per waiting change (changes
  in `model.clock.cutoverChanges` dated after `model.currentBusinessDay`, at most two after an H1
  Save): `fill("business_day.new_start_value", { time, when: formatChangeoverMoment(businessDayBoundaryAt(model.clock, E), tz) })`
  and a muted line `fill("business_day.day_length", { day: formatBusinessDate(E − 1), duration })`
  from `businessDayBounds(model.clock, E − 1)` (`@waitron/shared`). Header action: "Change start"
  whenever not read-only and no dialog.
- Re-read at the changeover: while the first waiting change's moment is ahead and at most
  `2_147_483_647` ms away, a timer calls `this.api.liveData.invalidate([{ type: "location_day_cutover_changes" }])`
  then (the panel's live query depends on that table, `api/live-queries.ts:507-515`, and re-reads
  through the background client, so the read is passive). Cleared on disconnect and on a new model.
  (Design §5 said the panel has no live subscription; it has one, with a 60 s refresh,
  `live-queries.ts:585-593`.)
- Strings: add `business_day.new_start`, `.new_start_value`, `.day_length` (design §7); remove
  `.scheduled`, `.none`, `.locks`, `.locked`, `.replace`, `.cancel_pending`.

- [ ] **Step 1: failing tests:** nothing waiting → rows `["Starts at 05:00"]` and a Change start
  button; waiting `{ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00", startsAt: "2026-10-21T01:00:00.000Z" }`
  on a Madrid 05:00 clock → "New start" `"03:00, from Wed 21 Oct, 03:00"` and `"Business day Tue 20
  Oct lasts 22 h."`; in Spanish `"03:00, desde mié 21 oct, 03:00"` and `"El día de trabajo mar 20 oct
  dura 22 h."` (restore after); two waiting rows (H1 (b)) → two "New start" rows, the second
  `"10:00, from Thu 22 Oct, 10:00"` with `"Business day Wed 21 Oct lasts 13 h."`; read-only shows the
  rows and no button; re-read with fake timers (`vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })`):
  advancing to the moment calls `liveData.invalidate` once with that type and makes no non-background
  request; a waiting row 300 days ahead schedules nothing. Client: `expect(api).not.toHaveProperty("cancelBusinessDayStart")`.
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/business-day-start-editor.test.ts src/screens/venue-details-business-day.test.ts src/api/client-routes.test.ts src/screens/venue-details-panel.test.ts`
  and `pnpm --filter @waitron/dashboard exec tsc --noEmit`.
- [ ] **Step 5:** prettier; append rows; commit `A788: the Business-day card shows the start and any waiting change`.

### Task 14a: the dialog's preview (~45 tool calls)

**Files:** `apps/dashboard/src/screens/business-day-start-editor.ts` (draft, preview call, preview
box, conflict lines), `apps/dashboard/src/api/client.ts:120-124,2949-2959`, `client-routes.test.ts`,
`apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts:84-95`,
`docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md` §7 (dated note),
test `business-day-start-editor.test.ts` (preview and conflict cases).

**Decisions:**
- Client: `previewBusinessDayStart(input: { dayCutover: string; expectedClockRevision: number })`
  builds the query from those two only; client-routes path
  `/management-api/venue-details/business-day-start/preview?dayCutover=07%3A00&expectedClockRevision=4`.
- Draft `{ dayCutover }`; the date field is removed; baseline = the last waiting change's start ??
  the start in force.
- Preview box, in order: `business_day.takes_effect` with `{when}` in `<strong>` (split the
  translated string at `{when}`); `business_day.today_runs` when `previousDay.businessDay ===
  model.currentBusinessDay`, else `business_day.day_runs` — `{day}` = `formatBusinessDate`,
  `{start}`/`{end}` = HH:MM of the instants in the venue's zone, `{duration}` =
  `formatDayLength((endAt − startAt) / 60000)`; `business_day.history` muted; conflicts in today's
  shape (season first): heading `business_day.conflicts` + count + the Opening hours link; labels
  `range` → `conflict_range`, `overlap` → `conflict_overlap`, `endpoint_day` → `conflict_endpoint`,
  `kept_open` → `fill("business_day.conflict_kept_open", { time: endsAt })` (the line builder already
  omits a range without both ends, `business-day-start-editor.ts:352`; L4 pinned by a test).
- Strings (EN and ES, design §7): add `takes_effect`, `today_runs`, `conflict_overlap`,
  `conflict_kept_open`; replace `history`, `conflicts`, `conflict_range`, `conflict_endpoint`; ES
  `venue_details.dayCutover` → "El día de trabajo empieza a las"; remove `date`, `date_invalid`,
  `transition`. Two lines not in the design's table, both needed (review L8): `business_day.day_runs`
  "Business day {day} runs {start} → {end}: {duration}." / "El día de trabajo {day} va de {start} a
  {end}: {duration}." (under rule 2 the day whose length changes is tomorrow, so "Today's business
  day" would be false), and `venue.business_day_invalid`'s generic copy (`codes.ts:84-87`) → "Check
  the start time." / "Revisa la hora de inicio." (the date field is gone). Record both in the
  design's §7 with a dated note.

- [ ] **Step 1: failing tests** (fixtures from mockups 02 and 04): preview
  `{ previousDay: { businessDay: "2026-10-20", dayCutover: "05:00", startAt: "2026-10-20T03:00:00.000Z", endAt: "2026-10-21T01:00:00.000Z" }, effectiveDay: { businessDay: "2026-10-21", …, startAt: "2026-10-21T01:00:00.000Z" } }`,
  `currentBusinessDay "2026-10-20"` → "Changes at the next changeover: Wed 21 Oct, 03:00.", "Today's
  business day (Tue 20 Oct) runs 05:00 → 03:00: 22 h.", "Earlier reports keep their days."; the
  preview request carries only `dayCutover` and the revision. Rule-2 fixture (previousDay
  `2026-10-21`, 19 h 30 min) → "Business day Wed 21 Oct runs 05:00 → 00:30: 19 h 30 min."; DST
  fixture → "23 h". Mockup 04 → "Opening hours that clash with the new start: 2.", line "All year:
  Restaurant · Fri · Dinner · 21:00–04:00 · Crosses the new start". `kept_open` line exactly
  "Restaurant · Dinner · Kept open until 04:30 tonight" (no "undefined"). Spanish for one line of
  each kind (restore after).
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/business-day-start-editor.test.ts src/api/client-routes.test.ts`.
- [ ] **Step 5:** prettier; append rows; commit `A788: the Change start dialog previews when the change takes effect`.

### Task 14b: the dialog's Save, refusals and drafts (~45 tool calls)

**Files:** `apps/dashboard/src/screens/business-day-start-editor.ts` (Save gating, refusals),
`apps/dashboard/src/i18n/strings.ts`, tests `business-day-start-editor.test.ts` (Save cases),
`business-day-start-editor.unsaved.test.ts`, `venue-details-business-day.test.ts`,
`apps/dashboard/src/dashboard-app.venue-settings-unsaved.test.ts`.

**Decisions:**
- Save sends `{ effectiveBusinessDay: preview.effectiveDay.businessDay, dayCutover, expectedClockRevision }`.
- Ready = preview for this draft, revision and clock, `conflictCount === 0`. Save
  `variant = ready ? saveAction.variant : "secondary"`, disabled unless ready and changed. The
  acknowledge state, button and string (`business_day.acknowledge`) go.
- Refusals (Save and preview): `changeover_passed` → `t("business_day.changeover_passed")` under the
  field and at the bottom, and the preview refreshes; `clock_transition` →
  `fill("business_day.clock_transition", { date: formatBusinessDate(clocksChangeOn), when: formatChangeoverMoment(saveFrom, tz) })`;
  others as today. Strings: add `changeover_passed`, `clock_transition` (design §7).

- [ ] **Step 1: failing tests:** a ready 05:00 → 03:00 preview → Save primary and enabled; the write
  is `[{ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00", expectedClockRevision: 4 }]`; with
  conflicts Save `variant="secondary"` and disabled; no `[data-test=acknowledge]`; `changeover_passed`
  shows "That changeover has just passed. Check the new time and save again." under the field and at
  the bottom, and a second preview request is made; `clock_transition` with `clocksChangeOn
  "2026-10-25"`, `saveFrom "2026-10-26T01:30:00.000Z"` → "The clocks change on Sun 25 Oct. Save again
  from Mon 26 Oct, 02:30."; Spanish for both (restore after). Unsaved: the time field's draft is
  protected and released on a literal revert; a refusal keeps the draft.
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/business-day-start-editor.test.ts src/screens/business-day-start-editor.unsaved.test.ts src/screens/venue-details-business-day.test.ts src/screens/venue-details-panel.test.ts src/dashboard-app.venue-settings-unsaved.test.ts`.
  `/usr/bin/grep -rn "business_day\.\(scheduled\|none\|locks\|locked\|date\|replace\|cancel_pending\|acknowledge\|transition\)\b" apps/dashboard/src` → nothing.
- [ ] **Step 5:** prettier; append rows; commit `A788: the Change start dialog saves for the changeover it showed`.

### Task 15: accessibility and the LOOK (~60 tool calls)

**Files:** create `apps/dashboard/src/screens/business-day-start-editor.a11y.test.ts` (none exists);
screenshots outside the repo in `/Users/clintongormley/waitron-campaign/a788-shots/`.

- [ ] **Step 1:** axe test (the package's `*.a11y.test.ts` pattern) for: card with nothing waiting,
  card with one and with two waiting changes, dialog with a ready preview, dialog with conflicts —
  each in both themes. Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/business-day-start-editor.a11y.test.ts`; PASS.
- [ ] **Step 2: LOOK, deterministic states.** Copy the shape of
  `/Users/clintongormley/waitron-campaign/a346-shots/a346-shots.test.ts.keep`: a temporary browser
  test beside the editor, never committed (kept as `a788-shots/a788-shots.test.ts.keep`), mounting
  the card and dialog with Task 13–14's fixtures and saving `page.screenshot` files for: card
  nothing waiting, card waiting, dialog 05:00 → 03:00, dialog with mockup 04's clashes — en-GB and
  es-ES, light and dark, 1280 and 390 px. Compare with
  `docs/backlog/mockups/a788-business-day/01-…05-*.png`; note every difference.
- [ ] **Step 3: LOOK, real stack.** `wa-wt demo waitron-feat-a788-business-day-next-changeover`
  (`docs/developers/workflow-guide.md`; demo manager `manager@demo.waitron.local`;
  `docs/ui-review.md` → "Running the stack from a worktree"). Venue settings → Venue details.
  Clashes: Change start, `21:00` — the demo's lunches give `endpoint_day` lines; screenshot. A waiting
  change: type a start a few minutes either side of the current one; if the list shows clashes,
  shorten the named ranges in Opening hours until none remain, then Save; screenshot the card in both
  themes and at 390 px with the workspace's Playwright Chromium. The painter line (mockup 06): with
  that change waiting, give a Saturday dinner a range crossing the waiting start in the painter and
  Save; screenshot. Afterwards check the venue's holders (`lsof +D <venue dir>`, port 8080) and run
  `wa-wt reset demo waitron-feat-a788-business-day-next-changeover`.
- [ ] **Step 4:** fix what the LOOK found (tokens only), rerun the editor tests, prettier, commit
  `A788: accessibility checks for the Business-day card and dialog`. List the screenshot paths and
  each difference from the mockups (fixed or accepted, with why) in the handover.

## Slice 4 — Attendance, docs, backlog

Per-task reviewer: none (LIGHT), except the driver reads Task 17's doc claims against their receipts.

### Task 16: attendance follows today's moved end (~35 tool calls)

**Files:** `apps/server/src/attendance-cutover-settings.test.ts` (new case).

- [ ] **Step 1:** on the file's setup (Madrid, 04:00 start, a published shift on 2026-01-07):
  discover days at `2026-01-07T12:00Z`; Save 06:00 at that moment (E `2026-01-08`, through the real
  route); then evaluate day `2026-01-07` with `nextAttendanceDay` at a `now` after the NEW end
  (`2026-01-08T05:00:00.000Z`): the day row's `endAt` is `2026-01-08T05:00:00.000Z` (it was `03:00Z`),
  and a fact recorded at `2026-01-08T04:30:00Z` (05:30 local) is labelled `2026-01-07` (before the
  change it would belong to `2026-01-08`).
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/attendance-cutover-settings.test.ts src/attendance-discovery.test.ts`.
  Expected to pass with no product change (design §5; bounds refresh while unevaluated,
  `attendance-discovery.ts:526-549,568-582`). Prove by deletion: comment out the refresh loop
  (`:535-549`); the `endAt` assertion must fail; restore. If it does not pass, STOP and report.
- [ ] **Step 3:** prettier; commit `A788: attendance takes today's moved end`.

### Task 17: docs, backlog, final checks (~50 tool calls)

**Files:** `docs/developers/conventions-data.md` (`:655-661`, `:672-676`, `:1202-1210`),
`docs/developers/design-system.md:5141-5147`, `docs/superpowers/specs/2026-10-11-a495-business-day-history-design.md`
(dated pointer under the title), `docs/backlog/service-periods.md:578-588` (dated pointer in the
Decisions entry), `docs/backlog.md` (`:1431-1435` A788 line; `:1543-1544` loose end), the design
doc's Status line.

- [ ] **Step 1:** rewrite each passage to the built behaviour, every sentence with its receipt (a
  test name or `file:line`): a Save sets the next changeover (rule 2 when the new time has passed;
  a change already ending today stays and the new one follows it), no Replace or Cancel, saving the
  start in force removes a waiting change; hours writes refuse `hours.clock_change_conflict` only for
  a clash with a waiting start, after the write; new hours are checked against the start in force;
  the calendar cuts a past day's misfitting range. Pointers, not rewrites, in the A495 spec and the
  service-periods decision: "2026-10-xx, A788: dated scheduling replaced — see
  `docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md`."
- [ ] **Step 2:** backlog: DELETE the A788 line under "Loose ends left by A755 (#1809)"; A851 stays.
  The A506-4 loose end "reports 'Invalid or overlapping range' before 'Range crosses the new start'"
  — check against the built labels and delete it only if a Task 6 or 14a test shows the case it
  describes; say which. New short entries: the special-day painter's season days are not cut on a
  past date (M5, `readSeasonDays`); a clash line naming a range in another department or weekday is
  ambiguous (L6); every Review focus item not fully closed; any LOOK difference accepted rather than
  fixed. Design Status → built.
- [ ] **Step 3: final checks.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts src/sale-amount.huella.test.ts`
  (unedited; PASS); `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/module-seams.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/claude-md-pointers.test.ts`;
  `pnpm --filter @waitron/dashboard-kit test:coverage` (read the per-file table for `date-format.ts`);
  `git diff 373b96623 --stat -- packages/fiscal-verifactu packages/fiscal packages/core packages/reporting/src/daily-close-hash.ts packages/workforce/src/pay-period-chain.ts`
  → empty. Read the `Tests` count of every run. The server, venue-service and dashboard package
  suites and their coverage bars are CI's (CLAUDE.md §2); run one locally only to chase a failure.
- [ ] **Step 4:** prettier `--file-info` on the docs; commit `A788: docs and backlog for the next-changeover start`.
  Driver: set the ledger to `Status: done` and announce the branch is ready for `/finish-branch`.

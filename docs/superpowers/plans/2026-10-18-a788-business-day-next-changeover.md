# A788: the business day's start changes at the next changeover — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to
> implement this plan task by task. Every implementer is dispatched as `subagent_type:
> "implementer"`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a Save in the Business-day card moves the changeover that ends today's business day (or
the one after, when the new time has already passed tonight); there is no date field, no Replace,
no Cancel and no lock; opening hours stay editable while a change waits, refused only when an edit
clashes with the waiting start; and new hours are checked only against the start in force (plus the
waiting one), with past days in the Opening hours calendar cut at their own ends.

**Architecture:** the server works out the effective business date itself (rules 1, 2 and 7) in a
pure module beside `business-day-start.ts`, and the preview hands that date to the browser, which
sends it back with Save. Venue service stops refusing hours writes while a change waits: the
editors' own parse check runs against the starts already in force (a "settled" clock), and every
time-changing writer re-runs the venue-wide clash checker against the waiting change after its
write, refusing with `hours.clock_change_conflict` and rolling the write back. The dashboard card
and dialog are rebuilt to the mockups. The calendar cuts a past day's misfitting ranges in a
calendar-only step, so nothing that decides service or a sale's business day changes.

**Tech stack:** TypeScript, Hono routes (`apps/server`), drizzle on `node:sqlite` (`@waitron/db`),
Lit web components (`apps/dashboard`, `packages/venue-service/src/dashboard`), Vitest 4 (node and
real-Chromium browser projects).

**Spec:** `docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md` (owner's
answers recorded there, 2026-10-18: all four questions A). Mockups:
`docs/backlog/mockups/a788-business-day/`. Probes the design ran:
`/Users/clintongormley/waitron-campaign/a788-mockups-src/probe/`.

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
  `registros_facturacion`, the alta builders. `pnpm --filter @waitron/fiscal-verifactu exec vitest
  run src/write-path.e2e.test.ts` and `… src/inmutabilidad.test.ts` must pass unedited (Task 17).
- Database tests use `useVenueDb`. Dashboard and venue-service `src/dashboard/**` tests run in real
  headless Chromium; follow `docs/developers/testing-guide.md` (restore the screen language after a
  test that changes it; `userEvent.click` where an update's ordering matters; wait for `wt-close`
  before checking what a dialog's close does; never `history.length`).
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
  permissions or money test, is a **STOP**: commit nothing for it and report to the driver, who asks
  the owner.

## Consumer map (traced 2026-10-18 at `373b96623`)

| Contract | Producer | Consumers to change |
| --- | --- | --- |
| Conflict `reason` union (+`overlap`, +`kept_open`) | `packages/module/src/module.ts:607` (`BusinessDayClockConflict`) | `packages/venue-service/src/business-day-schedule.ts:418-439`; `packages/venue-service/src/errors.ts:25-28` (imports the type); `apps/dashboard/src/api/client.ts:146` (own copy of the union); label map `apps/dashboard/src/screens/business-day-start-editor.ts:336-345`; new venue-service reason labels (Task 10) |
| `pending` shape (loses `locksAt`, `editable`) | `apps/server/src/business-day-start.ts:69-97`, `apps/server/src/venue-detail-types.ts:65-76`; `packages/venue-service/src/business-day-schedule.ts:538-565`, `service-day-context.ts:27-38` | `apps/dashboard/src/api/client.ts:108-119`; `business-day-start-editor.ts:114,137,142-143,287,380-440`; carried through `menu-timetable.ts:920`, `opening-hours-calendar.ts:70,220`, `named-days.ts:24`, `holiday-types.ts:50`, `menu-timetable-types.ts:56` (types only); no reader in `apps/till` or the venue-service dashboard |
| Preview query (only `dayCutover`, `expectedClockRevision`; no `locksAt` in the answer) | `business-day-start.ts:178-214`, route `apps/server/src/location-settings-api.ts:181-203` | `client.ts:2949-2959` (`previewBusinessDayStart`), `client.ts:120-149` types, the dialog |
| PUT body (`effectiveBusinessDay` must equal the server's answer) | `business-day-start.ts:230-274` | the dialog; server tests that PUT: `business-day-start.test.ts`, `business-day-history.test.ts`, `boot.clock-wiring.test.ts:174-196`, `attendance-cutover-settings.test.ts:80-89` |
| `DELETE /management-api/venue-details/business-day-start` and `cancelBusinessDayStart` (removed) | `location-settings-api.ts:216-225`, `business-day-start.ts:275-298` | `client.ts:2967-2971`, `client-routes.test.ts:1389,1397`, editor `#cancelPending` (`:286-304`) |
| Refusal reasons `transition_started`, `cancel_required`, `future_date` (removed), `changeover_passed` (added), `clock_transition` (gains `clocksChangeOn`, `saveFrom`; field becomes `dayCutover`) | `business-day-start.ts:102-111,128-142,242-245`; params type `apps/server/src/errors.ts:45-47` | dashboard copy `apps/dashboard/src/i18n/codes.ts:84-95`; the dialog's refusal handling (`business-day-start-editor.ts:266-281`) |
| `hours.clock_change_pending` (retired) → `hours.clock_change_conflict` (409, `{ dayCutover, startsAt, conflicts, conflictCount }`) | `business-day-schedule.ts:501-508`; registry `packages/venue-service/src/errors.ts:23`; status `packages/venue-service/src/routes.ts:134` | copy `packages/venue-service/src/dashboard/strings.ts:377,1232`; `season-painter.ts:549`; `special-day-painter.ts:955,1071`; `season-refusal.ts:38`; `period-delete-dialog.ts:106`; `period-dialog.ts:412-419` (shows a generic line today; not in the design's list); docs `conventions-data.md:660-661,675-676`, `design-system.md:5145` |
| `scheduleCutovers` (narrowed) | `packages/venue-service/src/service-day-context.ts:40-44` | `menu-timetable.ts:709`, `zone-closed-times.ts:86`, `special-days.ts:585-588` (`cutoversFor`), `period-end-offset.ts:106` (`findSeasonEndOffsetClash`, also called by `configuration-transfer.ts:490` with a string clock, unaffected) |
| Calendar range drawing | `opening-hours-calendar.ts:211-259` (month), `hours.ts` `calendarDays` (year tone) via `day-resolver.ts:134-219` | dashboard `zone-own-hours.ts:25-34` `placeOnDay` is shared with server validation (`closureOutsideHours`) and is NOT changed |
| i18n keys | `apps/dashboard/src/i18n/strings.ts:845-870` (EN), `:3792-3818` (ES), `:878`/`:3826` (`venue_details.dayCutover`) | the editor only (every non-test use is in `business-day-start-editor.ts`) |

## Changed test checks (running list; each task appends, the PR copies it)

Expected from tracing; each task confirms or corrects its own rows.

| Task | File:line (base `373b96623`) | Before → after |
| --- | --- | --- |
| 2 | `apps/server/src/business-day-start.test.ts:193` | preview `locksAt` asserted → key absent (`not.toHaveProperty("locksAt")`) |
| 2 | `business-day-start.test.ts:207`, `:551` | `pending.editable` true/false → `pending.startsAt` exact instant, and no `editable`/`locksAt` keys |
| 2 | `packages/venue-service/src/business-day-schedule.test.ts:579` | `pending: { …, editable: false }` → `pending: { effectiveBusinessDay, dayCutover, startsAt: "2026-11-04T06:00:00.000Z" }` with no `locksAt`/`editable` |
| 3 | `business-day-start.test.ts:172-222` | preview with a date at 11-02 for 11-04 → preview with the start only; answer's `effectiveDay.businessDay` is `2026-11-03`; `previousDay` `2026-11-02T04:00:00.000Z → 2026-11-03T02:00:00.000Z`, `effectiveDay` `2026-11-03T02:00:00.000Z → 2026-11-04T02:00:00.000Z` (shared resolver, run 2026-10-18); row and `pending.startsAt` for 11-03 |
| 3 | `business-day-start.test.ts:223-247` | `2026-11-02`, `2026-11-03`, `2027-11-04` refused by code only (`future_date`) → `2026-11-02`, `2026-11-04`, `2027-11-04` refused with exact params `{ field: "dayCutover", reason: "changeover_passed" }` |
| 3 | `business-day-start.test.ts:248-280` | replace then DELETE (cancel) → replace then Save the start in force (undo); same revision arithmetic and stale/ABA refusals |
| 3 | `business-day-start.test.ts:281-304` | DELETE quiet/stale cases → `DELETE` answers 404 and changes nothing; Saving the start in force while a change waits: 409 `cancel_required` → 200, waiting row removed |
| 3 | `business-day-start.test.ts:305-354` | lock at the preceding day (`transition_started`) → replace accepted up to the changeover; after activation the next Save takes the following changeover |
| 3 | `business-day-start.test.ts:355-369` | permissions for PUT, DELETE, GET → PUT and GET (401/403 unchanged); DELETE covered by the 404 case |
| 3 | `business-day-start.test.ts:370-400` | DST refusal by code with A755 dates → refusal with exact reason at the probe's moments (Task 4 adds `clocksChangeOn`/`saveFrom`) |
| 3 | `business-day-start.test.ts:411-465` | queued save/cancel/minimum-date refused `locked`/`invalid` → queued save/undo/plain refused `changeover_passed` (exact params), rows unchanged |
| 3 | `business-day-start.test.ts:466-488` | future anchor refuses DELETE and PUT → refuses undo and replace, same `future_history`, anchor moved to the new earliest boundary `2026-11-03T02:00:00.000Z` |
| 3 | `business-day-start.test.ts:537-571` | reopened copy reads at `2026-11-04T01:59:59.999Z`/`02:00` → at `2026-11-03T01:59:59.999Z`/`02:00` (the new effective date) |
| 3 | `apps/server/src/attendance-cutover-settings.test.ts:76-90` | Save at `2026-01-05T12:00Z` for `2026-01-08` → Save at `2026-01-07T12:00Z` (the day whose end moves); every assertion unchanged |
| 3 | `apps/server/src/boot.clock-wiring.test.ts:183,194` | `2026-11-04` → `2026-10-14` (the next changeover at the test's fixed `2026-10-14T00:00Z`) in body and expected clock |
| 3 | **`apps/server/src/business-day-history.test.ts:63,100-110,383-433,435-529`** | **STOP (fiscal-adjacent):** location-settings `now` follows the faked clock, and each Save happens at a moment whose next changeover is 2026-11-04 (system time set to `2026-11-03T12:00:00.000Z` just before the PUT, restored after where a test continues). No assertion edited. Driver asks the owner before Task 3 is dispatched. |
| 6 | `business-day-schedule.test.ts:396-409` | two overlapping raw ranges both `range` → both `overlap` (count 2 unchanged) |
| 7 | `business-day-schedule.test.ts:430-467` | `hours.clock_change_pending` while waiting → resolves while waiting; stale revision still `hours.clock_changed`; bad revisions unchanged |
| 7, 8 | `business-day-schedule.test.ts:489-561` | each writer refused `hours.clock_change_pending` → each writer accepts a non-clashing time edit while waiting, and refuses a clashing one with `hours.clock_change_conflict` (exact params) and nothing written |
| 8 | `packages/venue-service/src/menu-timetable-routes.test.ts:852-873` | route answers 409 pending → route accepts 09:00–14:00 (200) and refuses 06:00–08:00 with 409 `hours.clock_change_conflict` (exact params); stale case unchanged |
| 10 | `packages/venue-service/src/dashboard/seasons-window.test.ts:705-706`, `season-painter.save.test.ts:543`, `periods-list.delete.test.ts:405`, `period-delete-dialog.test.ts:252,312` | "Cancel the pending business-day change…" for the pending code → the clash sentence for `hours.clock_change_conflict` |
| 11 | `business-day-schedule.test.ts:640-657` | annual 07:00–07:00 refused "against every retained start" → accepted under the start in force (07:00), and an annual range crossing 07:00 refused |
| 13 | `apps/dashboard/src/screens/business-day-start-editor.test.ts:222-241,473-509` | Replace/Cancel/locked/"Editable until"/"Scheduled change" rows → "Starts at" always, "New start" row with when and day length, Change start only |
| 13 | `apps/dashboard/src/screens/venue-details-business-day.test.ts:94-144` | passive timer flips `pending.editable` → passive re-read at `pending.startsAt` shows the new start, no active read |
| 13 | `apps/dashboard/src/api/client-routes.test.ts:1389,1397` | `cancelBusinessDayStart` DELETE → no cancel method (`not.toHaveProperty`) |
| 14 | `apps/dashboard/src/api/client-routes.test.ts:1356,1392` | preview query with `effectiveBusinessDay` → query of `dayCutover` and revision only |
| 14 | `business-day-start-editor.test.ts:98-220,250-470` | date field, acknowledge gate, "Conflicting schedules:", "Range crosses the new start" → one field, Save gated by a ready conflict-free preview, new headings and labels |
| 14 | `business-day-start-editor.unsaved.test.ts:40,103-125` | date-field draft cases, acknowledge before Save → the time field's draft cases, Save without acknowledgement |
| 14 | `venue-details-business-day.test.ts:29-72,146-208` | date draft and acknowledge → time draft, Save after the preview |

## Review focus (inputs no task's main tests reach; each line names the test that pins it)

1. **The rule-2 flip mid-dialog**: a preview taken at 00:20 for 00:30 and a Save at 00:31 must be
   refused `changeover_passed`, not saved for the wrong night. Pinned in Task 3 ("queued undo/plain"
   plus a direct case).
2. **A waiting change saved by A755's old form for a far date** (up to 366 days ahead): the card
   must show it and schedule no timer past `2^31−1` ms; an hours edit must name it in the clash line;
   a Save replaces it. Pinned in Task 3 (replace a far row) and Task 13 (no timer beyond the limit).
3. **A clash in a department other than the one being edited**: the refusal names the other range.
   Pinned in Task 7.
4. **A changeover day across the clocks changing**: 05:00 → 03:00 saved on Sat 24 Oct 2026 22:00
   lasts 23 h, and the dialog shows "23 h" from the instants, not 22 h from the wall times. Pinned in
   Task 3 (server bounds) and Task 14 (dialog line).
5. **Extreme lengths**: "1 min" and "47 h 59 min" format and the server accepts both days.
   Pinned in Task 1 (rules) and Task 9 (formatter).

---

## Slice 1 — Server: the next-changeover rule

Per-task reviewer: **yes** for Tasks 1–5.

### Task 1: the next-changeover rules as pure functions (~25 tool calls)

**Files:**
- Create: `apps/server/src/business-day-changeover.ts`, `apps/server/src/business-day-changeover.test.ts`
- Modify: `apps/server/src/backup-schedule.test.ts` (one new case)

**Interfaces — produces:**
- `effectiveDayFor(before: BusinessDayClock, dayCutover: string, at: Date): string` — `before` is
  the clock without any waiting change. Today = `businessDayAt(before, at)`; E = today + 1; with
  `candidate = { ...before, cutoverChanges: [...before.cutoverChanges, { effectiveBusinessDay: E, dayCutover }] }`,
  if `businessDayBoundaryAt(candidate, E) <= at.toISOString()` then E = today + 2 (rule 2).
- `clockTransitionAt(before: BusinessDayClock, dayCutover: string, at: Date): null | { clocksChangeOn: string; saveFrom: string | null }`
  — runs today's `candidateFor` daylight-saving check (`business-day-start.ts:128-142`: for days
  E−1, E, E+1, both the old clock and `{ ...before, dayCutover, cutoverChanges: [] }` must have
  exactly one `localTimeOccurrences`, and `businessDayBounds(candidate, day)` must not throw) for
  the E `effectiveDayFor` gives. `clocksChangeOn` is the first failing day in that order.
  `saveFrom` is the first moment after `at`, among the old clock's boundaries of today … today+9 and
  the instants `businessDayBoundaryAt({ ...before, dayCutover, cutoverChanges: [] }, d)` for the same
  dates, sorted, at which the same check passes; `null` if none does. (The effective date can only
  change at those moments — design §5.)

- [ ] **Step 1: failing tests** in `business-day-changeover.test.ts`, Madrid clock
  `{ timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] }`. Values were computed with
  the shared resolver on 2026-10-18 (scratch `/tmp/a788-plan/check.ts`, `dst.ts`):
  - Save at `2026-10-20T20:00:00Z` (Tue 22:00): `"03:00"` → `"2026-10-21"`; `"21:00"` → `"2026-10-21"`.
  - Save at `2026-10-20T23:00:00Z` (Wed 01:00, still Tue's day): `"00:30"` → `"2026-10-22"` (rule 2);
    `"03:00"` → `"2026-10-21"`.
  - Rule-2 edge: base `23:59`, Save `"00:00"` at `2026-10-21T08:00:00Z` → `"2026-10-22"`, and
    `businessDayBounds` of `2026-10-21` on the resulting candidate lasts exactly 1 minute; base
    `00:00`, `"23:59"`, day before E lasts 2879 minutes.
  - `clockTransitionAt(base, "02:30", at)`:
    `2026-10-23T01:00:00Z` → `{ clocksChangeOn: "2026-10-25", saveFrom: "2026-10-26T01:30:00.000Z" }`;
    `2026-10-26T01:15:00Z` → same; `2026-10-26T01:30:00Z` → `null`; `2026-10-26T02:00:00Z` → `null`;
    `2027-03-27T11:00:00Z` → `{ clocksChangeOn: "2027-03-28", saveFrom: "2027-03-29T00:30:00.000Z" }`;
    `2027-03-29T01:00:00Z` → `null`. `"03:00"` at every one of those moments → `null` (probe `dst.ts`:
    05:00 → 03:00 is never refused).
- [ ] **Step 2:** add to `backup-schedule.test.ts` the accepted backup timing (design §5, probe
  `backup.ts`, seed `"seed"`, `{ kind: "wall-clock", days: "daily", at: "auto" }`): computed at Tue 20
  Oct 05:45 local on the unchanged clock → `Date.parse("2026-10-21T03:33:00.000Z")`; with 03:00
  effective 2026-10-21, computed at Wed 21 05:45 local → `2026-10-22T01:33:00.000Z`; with 21:00
  effective 2026-10-21, computed at Wed 21 05:45 local → `2026-10-21T19:33:00.000Z`. Run it; it
  passes today (no product change): it records the accepted behaviour, so prove it by deletion —
  change `AUTO_MARGIN_MINUTES` to 31 locally, watch it fail, revert.
- [ ] **Step 3:** run `pnpm --filter @waitron/server exec vitest run src/business-day-changeover.test.ts` — FAIL (module missing).
- [ ] **Step 4:** implement the two functions. Import `localTimeOccurrences` from
  `@waitron/venue-service` (as `business-day-start.ts:17` does) and the resolver from `@waitron/shared`.
- [ ] **Step 5:** run both test files; PASS. Prettier on the three files. Commit
  `A788: work out the next changeover a business-day start takes effect at`.

### Task 2: the waiting change loses its lock fields (~35 tool calls)

**Files:**
- Modify: `apps/server/src/business-day-start.ts:69-97,178-214`, `apps/server/src/venue-detail-types.ts:65-90`,
  `packages/venue-service/src/business-day-schedule.ts:538-565`,
  `packages/venue-service/src/service-day-context.ts:27-38`
- Test: `apps/server/src/business-day-start.test.ts`, `packages/venue-service/src/business-day-schedule.test.ts:563-588`

**Interfaces — produces:** `pending: null | { effectiveBusinessDay: string; dayCutover: string; startsAt: string }`
in both `BusinessDayClockModel` and `BusinessDayScheduleStatus`; `BusinessDayStartPreview` without
`locksAt`.

- [ ] **Step 1:** change the checks listed for Task 2 in the running list to the exact objects
  (`startsAt` for the 11-04 07:00 row is `2026-11-04T06:00:00.000Z`; for the server's 11-04 03:00 row
  `2026-11-04T02:00:00.000Z`), asserting with `toEqual` on `pending` so a leftover key fails. Run;
  FAIL on the extra keys.
- [ ] **Step 2:** remove `locksAt`/`editable` from both producers and types, and `locksAt` from the
  preview. `assertEditable` stays for now (Task 3 removes it) but reads the pending lock from the
  boundary of the day before (compute it locally) so behaviour is unchanged in this task.
- [ ] **Step 3:** `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts src/venue-details.test.ts src/business-day-persistence.test.ts`
  and `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/opening-hours-calendar.test.ts`;
  PASS. Dashboard client types still carry the old fields until Task 13 (separate copy; nothing
  imports across).
- [ ] **Step 4:** prettier; commit `A788: a waiting business-day change has no lock time`.

### Task 3: preview and Save take the next changeover (~85 tool calls; STOP before dispatch)

**Before dispatching:** the driver asks the owner (through the campaign watcher) to approve the
`business-day-history.test.ts` edit described in the running list. No assertion in that file
changes; only when each Save happens.

**Files:**
- Modify: `apps/server/src/business-day-start.ts` (whole write/preview path), `apps/server/src/location-settings-api.ts:181-225`,
  `apps/server/src/errors.ts:45` (params type gains optional `clocksChangeOn?: string; saveFrom?: string | null`)
- Test: `apps/server/src/business-day-start.test.ts`, `apps/server/src/business-day-history.test.ts`,
  `apps/server/src/boot.clock-wiring.test.ts`, `apps/server/src/attendance-cutover-settings.test.ts`

**Interfaces — consumes** Task 1's `effectiveDayFor`, `clockTransitionAt`. **Produces:**
- `GET …/business-day-start/preview?dayCutover=HH:MM&expectedClockRevision=N` — any other key is
  refused `venue.business_day_invalid` `{ field: "body", reason: "unknown_field" }`. Answer:
  `{ revision, previousDay, effectiveDay, conflicts, conflictCount, backupDeadlines }`;
  `effectiveDay.businessDay` is the date the server chose.
- `PUT …/business-day-start` body `{ effectiveBusinessDay, dayCutover, expectedClockRevision }`
  (all required, as today).
- No `DELETE` route; `cancelBusinessDayStart` deleted.

**Order of the write path** (each step a decision the tests pin):
1. parse body; read model; revision check (`venue.business_day_changed`), unreadable clock refusal (unchanged);
2. `before` = clock without the waiting change; `inForce` = `cutoverForBusinessDay(model.clock, currentBusinessDay)`;
3. `dayCutover === inForce` and nothing waits → `{ changed: false }` (before any date check, so
   `business-day-start.test.ts:522` stays unedited);
4. E = `effectiveDayFor(before, dayCutover, at)` when `dayCutover !== inForce`; when it equals
   `inForce` (undo) E = the waiting change's date; body date ≠ E →
   `venue.business_day_invalid` `{ field: "dayCutover", reason: "changeover_passed" }`;
5. same start and same E as the waiting change → `{ changed: false }`;
6. `clockTransitionAt` non-null → `venue.business_day_invalid`
   `{ field: "dayCutover", reason: "clock_transition", clocksChangeOn, saveFrom }`;
7. undo: `protectHistory(model.clock, before, waiting.effectiveBusinessDay)`, delete the waiting row,
   bump revision; otherwise as today (`protectHistory` for the waiting day and for E,
   `assertBusinessDayClockChange`, delete waiting row, insert, bump).

The preview runs steps 1, 2, 4 (without the body comparison), 6, history for E, and the conflicts
catch as today. For `dayCutover === inForce` with a change waiting (an undo) it answers E = the
waiting change's date with the bounds of the clock without it, so the dialog sends back the date the
PUT expects; with nothing waiting it answers E = today + 1 on the unchanged clock (the PUT is a
no-op before any date check).

- [ ] **Step 1: failing tests** — rewrite the Task 3 rows of the running list, and add, at
  `at = 2026-10-20T20:00:00Z` (Tue 22:00 Madrid; set `locations.time_zone` as the file's fixture
  has it — `Europe/Madrid`):
  - Example 1: preview `03:00` → `effectiveDay.businessDay "2026-10-21"`, `previousDay`
    `{ businessDay: "2026-10-20", dayCutover: "05:00", startAt: "2026-10-20T03:00:00.000Z", endAt: "2026-10-21T01:00:00.000Z" }`;
    PUT with that date → 200, one row `{ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00:00" }`.
  - Example 2: `21:00` → previousDay ends `2026-10-21T19:00:00.000Z` (40 h). The fixture venue has no
    hours, so no conflicts.
  - Example 3: `at = 2026-10-20T23:00:00Z`, `00:30` → E `2026-10-22`, previousDay `2026-10-21`
    `2026-10-21T03:00:00.000Z → 2026-10-21T22:30:00.000Z`.
  - Example 4: Save 03:00 at Tue 22:00, then 04:00 at `2026-10-20T21:30:00Z` (rev 1) → one row 04:00,
    previous day ends `2026-10-21T02:00:00.000Z`.
  - Example 5: Save 03:00, then 05:00 at `2026-10-20T21:45:00Z` (rev 1) → `changed: true`, no rows,
    revision 2.
  - A far A755 row (insert `{ effectiveBusinessDay: "2027-06-01", dayCutover: "07:00:00" }`, revision
    1) is replaced by a Save of 03:00 at Tue 22:00 → only the 10-21 row remains.
  - Race (rule 7): preview 03:00 at Tue 22:00 (E 10-21); PUT with E 10-21 at
    `2026-10-21T03:00:00.000Z` (the old changeover) → 400 `changeover_passed`, no row; preview `00:30`
    at `2026-10-20T22:20:00Z` (00:20 Wed) → E 10-21, PUT at `2026-10-20T22:31:00Z` → 400
    `changeover_passed`.
  - Daylight saving: at `2026-10-24T20:00:00Z` (Sat 22:00 CEST) preview 03:00 → previousDay
    `2026-10-24T03:00:00.000Z → 2026-10-25T02:00:00.000Z` (23 h).
  - `DELETE …/business-day-start` with a manager cookie → 404, rows unchanged.
  In `business-day-history.test.ts`, `boot.clock-wiring.test.ts`, `attendance-cutover-settings.test.ts`
  make only the edits in the running list.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`; FAIL as expected.
- [ ] **Step 3:** implement the order above; delete `assertFutureDate`, `assertEditable`,
  `cancelBusinessDayStart`, the `DELETE` route and its import; `clock_transition` raised with field
  `dayCutover`.
- [ ] **Step 4:** run `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts src/business-day-history.test.ts src/boot.clock-wiring.test.ts src/attendance-cutover-settings.test.ts src/business-day-persistence.test.ts src/venue-details.test.ts src/venue-details-api.test.ts src/location-settings-api.test.ts src/configuration-transfer.test.ts`; PASS.
- [ ] **Step 5:** prettier; append rows; commit `A788: a business-day start saves for the next changeover`.

### Task 4: the clocks-change refusal names when a Save will work (~25 tool calls)

**Files:** `apps/server/src/business-day-start.ts`, `apps/server/src/business-day-start.test.ts`

- [ ] **Step 1:** extend the DST case (Task 3's rewrite of `:370`) to exact bodies: PUT 05:00 → 02:30
  at `2026-10-23T01:00:00Z` with the date the preview would choose (`2026-10-24`) → 400
  `{ code: "venue.business_day_invalid", params: { field: "dayCutover", reason: "clock_transition", clocksChangeOn: "2026-10-25", saveFrom: "2026-10-26T01:30:00.000Z" } }`;
  at `2026-10-26T01:15:00Z` (E `2026-10-26`) → same `saveFrom`; at `2026-10-26T02:00:00Z` with E
  `2026-10-27` → 200. Spring: at `2027-03-27T11:00:00Z` (E `2027-03-28`) → `clocksChangeOn
  "2027-03-28"`, `saveFrom "2027-03-29T00:30:00.000Z"`; at `2027-03-29T01:00:00Z` (E `2027-03-30`)
  → 200. The preview at each refused moment answers the same 400.
- [ ] **Step 2–4:** fail, wire the params through (Task 3 may already have — then this task only
  adds the assertions and proves them by deleting `saveFrom` from the throw), pass:
  `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`.
- [ ] **Step 5:** prettier; commit `A788: the clocks-change refusal says when to save again`.

### Task 5: a "keep open" for today past the new changeover is a clash (~45 tool calls)

**Files:**
- Modify: `packages/module/src/module.ts:607` (union gains `"kept_open"`),
  `packages/venue-service/src/business-day-schedule.ts` (new `keptOpenConflicts`, called by
  `assertBusinessDayClockChange` only)
- Test: `packages/venue-service/src/business-day-schedule.test.ts`, `apps/server/src/business-day-start.test.ts`

**Interfaces — produces:** `keptOpenConflicts(tx, cfg, before, candidate, effectiveBusinessDay): Promise<BusinessDayClockConflict[]>`
— reads `period_extensions` (`schema/period-extensions.ts`) and `zone_extensions`
(`schema/zone-extensions.ts`) rows of the venue with `business_day = E − 1`; a row clashes when
`(minuteOfServiceDay(endsAt, oldCutover) || 1440) > serviceDayWallContext(candidate, E − 1).endMinute`
(the extension ends after the new changeover). Conflict: `{ departmentId, departmentName, periodId?,
periodName?, zoneId?, zoneName?, date: E − 1, endsAt: "HH:MM", rangeIndex: 0, reason: "kept_open" }`.
`assertBusinessDayClockChange` throws with these appended to `businessDayClockConflicts`' list and
count. `businessDayClockConflicts` itself is unchanged (Task 7's post-write check must not see
extensions: an extension saved after the Save is already bounded by the waiting change's end,
`keep-open.ts:40,133`).

- [ ] **Step 1: failing tests.** venue-service: fixture department/period, `period_extensions` row
  for `2026-11-03` (the day before `E = "2026-11-04"`) 22:00 → `04:30`, 05:00 → 03:00 → one
  `kept_open` conflict with `endsAt "04:30"`; `02:30` → none; a `zone_extensions` row likewise
  names the zone. Server: Save 03:00 at Tue 22:00 with a `period_extensions` row for `2026-10-20`
  until `04:30` (insert with raw SQL into `period_extensions`, department and period from
  `authorRange`) → 409 `venue.business_day_hours_conflict` whose conflicts include
  `{ reason: "kept_open", endsAt: "04:30" }`; the preview lists it.
- [ ] **Step 2–4:** fail, implement, pass:
  `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts` and
  `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`. Typecheck the
  module and venue-service: `pnpm --filter @waitron/module exec tsc --noEmit` and
  `pnpm --filter @waitron/venue-service exec tsc --noEmit`.
- [ ] **Step 5:** prettier; commit `A788: a keep-open past the new changeover blocks the change`.

## Slice 2 — Venue service: hours stay editable, clashes name their range

Per-task reviewer: **yes** for Tasks 6–8 and 10.

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
  lunch 13:00–16:00 + dinner 22:00–04:30, 05:00 → 03:00 → exactly one conflict, the dinner,
  `range` (probe `a788-fix-probe` "mixed"); lunch 13:00–16:00 + dinner 20:00–23:30, 05:00 → 21:00 →
  dinner `range`, lunch `endpoint_day` (probe `a788-fix2`); the overlap case (`:396`) → both
  `overlap`, count 2 (running list). Mockup 04 (Fri 21:00–04:00, Sat 21:00–04:30, 05:00 → 03:00) →
  two `range`, unchanged.
- [ ] **Step 2–4:** fail; implement; pass `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/special-days.holiday-name.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/business-day-start.test.ts`.
- [ ] **Step 5:** prettier; append row; commit `A788: a clash names only the range that crosses the new start`.

### Task 7: hours stay editable while a change waits — week, period and delete writers (~80 tool calls)

**Files:**
- Modify: `packages/venue-service/src/service-day-context.ts` (add `settledClock`),
  `business-day-schedule.ts:485-509` (guard; new `assertWaitingChangeFits`),
  `errors.ts:23` (retire `hours.clock_change_pending`, add `hours.clock_change_conflict`),
  `routes.ts:134` (409 for the new code, entry for the old removed), `menu-timetable.ts`
  (`replaceMenuWeek` :649-670, `writeMenuPeriod` :510-605, `stageMenuWeek` :695-730),
  `season-weeks.ts:314-385` (`saveSeasonWeeks`), `zone-closed-times.ts:33-90`, `period-delete.ts:188-230`,
  `index.ts` (export the new function if a server or test needs it)
- Test: `packages/venue-service/src/business-day-schedule.test.ts`

**Interfaces — produces:**
- `settledClock(clock: BusinessDayClock, at: Date): BusinessDayClock` — the clock without changes
  whose `businessDayBoundaryAt(clock, change.effectiveBusinessDay) > at.toISOString()`.
- `assertWaitingChangeFits(tx, cfg, at: Date, acquiredClock?: BusinessDayClock): Promise<void>` —
  the waiting change is found as `readBusinessDayScheduleStatus` finds it; none → return; otherwise
  `businessDayClockConflicts(tx, cfg, { ...clock, cutoverChanges: without it }, clock, waiting.effectiveBusinessDay)`
  and, on a count above 0, `throw new AppError("hours.clock_change_conflict", { dayCutover: "HH:MM", startsAt: <boundary ISO>, conflicts, conflictCount })`.
- `assertBusinessDayScheduleWrite` keeps its revision check and loses the pending refusal; its
  module seat signature (`module.ts:619`) is unchanged.
- Decision: the editors' own parse and end-offset checks run on `settledClock(clock, at)`, so the
  waiting start is checked once, after the write, by the venue-wide checker — which names the
  department, period, weekday and season the parse layer does not have. A failure under the waiting
  start alone therefore always answers `hours.clock_change_conflict` (design rule 5), including
  `range` and `all_day`. A throw inside the writer's transaction rolls the write back.
- Every time-changing call (`changeKind === "time"`) runs `assertWaitingChangeFits` after its write;
  metadata writes do not.

- [ ] **Step 1: failing tests.** With a waiting 03:00 change (settings revision 1, change row `E`,
  `at = 2026-11-02T12:00Z`):
  - guard: `assertBusinessDayScheduleWrite(tx, cfg, "time", at, 1)` resolves (running list `:430`).
  - `replaceMenuWeek` Wed 09:00–17:00 → resolves and is stored; Sat 21:00–04:30 → rejects
    `{ code: "hours.clock_change_conflict", params: { dayCutover: "03:00", startsAt: "2026-11-04T02:00:00.000Z", conflictCount: 1, conflicts: [expect.objectContaining({ weekday: 6, startsAt: "21:00", endsAt: "04:30", reason: "range" })] } }`
    and the department's week is as before (read back); Sat 21:00–02:45 with the period's offset
    +30 → `transition_strip` (mockup 06), nothing written.
  - `updateMenuPeriod` offset 0 → +30 with Sat 21:00–02:45 stored → `transition_strip`, offset still 0.
  - `saveSeasonWeeks` with a clashing department week → refused, nothing written.
  - `replaceZoneClosedWeek` closed 22:00–04:30 → `range` naming the zone, nothing written; 12:00–13:00 accepted.
  - `deletePeriod`: with a raw clashing range (`seasonDay`) on period A and a second period B,
    deleting B is refused naming A's range; deleting A is accepted (its clash goes with it).
  - Review focus 3: department X edited cleanly while department Y holds a raw clash → refused,
    the conflict names Y's department and range.
  - `settledClock` unit cases: a change whose boundary is after `at` is dropped; one at or before is kept.
- [ ] **Step 2:** run `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts`; FAIL.
- [ ] **Step 3:** implement. `stageMenuWeek`/`stageZoneClosedWeek` receive the settled clock from
  their callers for parsing; `assertWeekEndOffsets` and `writeMenuPeriod`'s `endOffsetClash` get the
  settled clock as `acquiredClock`. Keep the special-day and season writers on today's guard path
  until Task 8, but their tests in `:489-561` now expect acceptance of the non-clashing edits
  (running list).
- [ ] **Step 4:** run `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/menu-timetable.test.ts src/zone-closed-times.test.ts src/season-weeks.test.ts src/period-delete.test.ts src/period-end-offset.test.ts`
  (use the files that exist; `ls src/*.test.ts` first); PASS. Prove the post-write check by
  deleting the `assertWaitingChangeFits` call in `replaceMenuWeek`: the Sat 21:00–02:45 case must fail.
- [ ] **Step 5:** prettier; append rows; commit `A788: opening hours stay editable while a business-day change waits`.

### Task 8: special days and seasons, and the route (~50 tool calls)

**Files:** `packages/venue-service/src/special-days.ts` (`saveSpecialDay` :1035, `deleteSpecialDay`
:1196, `cutoversFor` :585-588), `seasons.ts` (`saveSeasons` :79-…), tests
`business-day-schedule.test.ts`, `special-days.test.ts`, `menu-timetable-routes.test.ts:852-873`.

**Decision for `cutoversFor`:** a repeating day parses under the settled clock's starts (Task 11
narrows these to the start in force); a one-off date parses under its own date's start on the
SETTLED clock. A one-off date on or after the waiting change's date is therefore parsed under the
start in force, and the waiting start is checked after the write like every other range — one rule
for every writer.

- [ ] **Step 1: failing tests.** While 03:00 waits: a one-off special day dated `2026-11-04` painting
  22:00–04:30 → `hours.clock_change_conflict` naming the special day (`specialDayName`, `date`),
  nothing written; 09:00–17:00 accepted; a zone paint likewise. `deleteSpecialDay` of the day that
  holds a raw clash → accepted; of another while one exists → refused. `saveSeasons` adding a
  season while a raw clash exists → refused (the copy carries the clash), nothing written; with no
  clash → accepted. Route (running list): `PUT …/menu-week` 09:00–14:00 → 200; 06:00–08:00 with a
  waiting 07:00 → 409 with the exact params (`startsAt: "2026-11-04T06:00:00.000Z"`).
- [ ] **Step 2–4:** fail; wire `assertWaitingChangeFits` after each write and the settled clock into
  `cutoversFor`; pass `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/special-days.test.ts src/seasons.test.ts src/menu-timetable-routes.test.ts src/hours-routes.test.ts`.
  `/usr/bin/grep -rn "clock_change_pending" packages apps scripts` now finds only the venue-service
  dashboard (Task 10) — say so in the handover.
- [ ] **Step 5:** prettier; commit `A788: special days and seasons check the waiting start after they write`.

### Task 9: shared formatters for the changeover (~20 tool calls; no reviewer)

**Files:** `packages/dashboard-kit/src/date-format.ts`, `date-format.test.ts`, `index.ts` (export).

**Interfaces — produces** (locale defaults to `currentLocale()`):
- `formatChangeoverMoment(iso: string, timeZone: string, locale?: string): string` — built from
  `Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts`
  as `${weekday} ${day} ${month}, ${hour}:${minute}` (en-GB alone prints this shape; es-ES's own
  format inserts a comma after the weekday — checked with Node 2026-10-18).
- `formatBusinessDate(day: string, locale?: string): string` — `${weekday} ${day} ${month}` read in UTC.
- `formatDayLength(minutes: number): string` — whole hours and minutes, a zero part left out.

- [ ] **Step 1: failing tests:** `formatChangeoverMoment("2026-10-21T01:00:00.000Z", "Europe/Madrid", "en-GB")`
  → `"Wed 21 Oct, 03:00"`; `"es-ES"` → `"mié 21 oct, 03:00"`; `formatBusinessDate("2026-10-20", "en-GB")`
  → `"Tue 20 Oct"`, es-ES → `"mar 20 oct"`; `formatDayLength(1320)` → `"22 h"`, `1170` → `"19 h 30 min"`,
  `2879` → `"47 h 59 min"`, `1` → `"1 min"`, `1380` → `"23 h"`.
- [ ] **Step 2–4:** fail; implement; pass `pnpm --filter @waitron/dashboard-kit exec vitest run src/date-format.test.ts`.
- [ ] **Step 5:** prettier; commit `A788: format a changeover moment, a business date and a day's length`.

### Task 10: the opening-hours screens show the clash line (~60 tool calls)

**Files:**
- Create: `packages/venue-service/src/dashboard/clock-change-conflict.ts` (+ `.test.ts`)
- Modify: `dashboard/strings.ts` (EN `:377`, ES `:1232`: remove `hours.clock_change_pending`; add
  `hours.clock_change_conflict` and six reason labels), `season-painter.ts:549`,
  `special-day-painter.ts:955,1071`, `season-refusal.ts:38`, `period-delete-dialog.ts:104-107`,
  `period-dialog.ts:412-419` (bottom line), and whatever passes each the venue's `timeZone`
  (`businessDayClock.timeZone` of the model they already hold)
- Tests: the five in the running list, plus a period-dialog case.

**Interfaces — produces:** `clockChangeConflictText(refusal: Refusal, timeZone: string): string | undefined`
— `undefined` unless `refusal.code === "hours.clock_change_conflict"`; otherwise
`format("hours.clock_change_conflict", { range, time: params.dayCutover, when: formatChangeoverMoment(params.startsAt, timeZone), reason })`
for `params.conflicts[0]`, where `range` is `${periodName ?? zoneName ?? departmentName} ${startsAt}–${endsAt}`.

Strings (design §7; the reason labels are copied here because the venue-service dashboard has its
own catalogue — the design's table names only the app's keys):

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
  in Spanish (set the locale, restore after) the ES sentence. Each listed screen test now feeds
  `hours.clock_change_conflict` and expects that sentence where it expected the pending one.
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/clock-change-conflict.test.ts src/dashboard/seasons-window.test.ts src/dashboard/season-painter.save.test.ts src/dashboard/periods-list.delete.test.ts src/dashboard/period-delete-dialog.test.ts src/dashboard/period-dialog.test.ts src/dashboard/special-day-painter.save.test.ts`
  (browser project; check free memory first with `memory_pressure | grep free`).
  `/usr/bin/grep -rn "clock_change_pending" packages apps scripts` → nothing.
- [ ] **Step 5:** prettier; append rows; commit `A788: opening-hours screens name the range that clashes with the new start`.

## Slice 5 — Only the start in force limits new hours (question 4, A)

Per-task reviewer: **yes** for Tasks 11–12.

### Task 11: the editors check the start in force, not every start ever (~45 tool calls)

**Files:** `packages/venue-service/src/service-day-context.ts:40-44`, its callers
(`menu-timetable.ts:709`, `zone-closed-times.ts:86`, `special-days.ts:585-588`,
`period-end-offset.ts:106`), tests `business-day-schedule.test.ts:590-657`, a new case file or block
for `scheduleCutovers`.

**Decision:** `scheduleCutovers(clock, day?)` without `day` returns `[the last change's dayCutover ?? clock.dayCutover]`
— callers already pass the settled clock (Tasks 7–8), whose last change is the start in force.
With `day` it is unchanged (that date's own start). `findSeasonEndOffsetClash`'s year walk over
`cutoverChanges` (`period-end-offset.ts:126-136`) is unchanged. `parsed[0]` is now the parse under
the start in force; touching same-period ranges are joined in that order (`joinTouching`), which can
store a joined range that crosses an older start — Task 12 draws it.

- [ ] **Step 1: failing tests** (probe `hours-back.mts`; venue 05:00, changes 03:00 from
  `2026-10-21`, 05:00 from `2026-10-28`, `at = 2026-11-02T12:00Z`): `replaceMenuWeek` with
  22:00–04:30 → accepted (refused `order` today); 05:00–05:00 → accepted (refused `empty`);
  22:00–02:30 → accepted. At `at = 2026-10-25T12:00Z` (03:00 in force) 22:00–04:30 → refused
  `menu_timetable.invalid` reason `order`. Annual special day 07:00–07:00 after activation of 07:00
  → accepted; annual 06:00–08:00 → refused (running list `:640-657`). Zone and one-off equivalents
  as `:613`, `:626`, `:633` (unchanged checks; titles may say "the start in force").
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule.test.ts src/special-days.test.ts src/period-end-offset.test.ts src/menu-timetable.test.ts src/zone-closed-times.test.ts`.
- [ ] **Step 5:** prettier; append rows; commit `A788: new opening hours are checked against the start in force`.

### Task 12: the calendar cuts a past day's misfitting range at that day's ends (~70 tool calls)

**Files:**
- Create: `packages/venue-service/src/calendar-cut.ts` (+ `.test.ts`)
- Modify: `packages/venue-service/src/day-resolver.ts:134-219` (an optional, calendar-only `cut`
  option on `resolveDepartmentsDays` and `resolveZoneClosedDays`, applied to each day's SEASON ranges
  before `layerPaint`/`layerZonePaint` and to the result; absent → today's behaviour byte for byte),
  `opening-hours-calendar.ts:211-259` (month), `hours.ts` `calendarDays` (year tone) — the only two
  callers that pass it
- Tests: `calendar-cut.test.ts`, `opening-hours-calendar.test.ts`, `day-resolver.test.ts`

**Interfaces — produces:**
`cutToOwnDay<T extends ClosedRange>(range: T, day: { dayCutover: string; endMinute: number }, anchor: string): T | null`
— `anchor` is the start in force (`cutoverForBusinessDay(clock, currentBusinessDay)` from the read's
`at`; the venue's first start when the current day cannot be read). `calendarDays` has no `at`
today; thread `readOpeningHoursYear`'s `at` to it. If the range
fits the day's own start (`rangeSpan(range, dayCutover)` start < end, or `startsAt === endsAt ===
dayCutover`), return it unchanged. Otherwise, if it fits `anchor`, place it by the anchor
(`offset = minutes(anchor) − minutes(dayCutover)`, interval `[span(anchor).start + offset,
span(anchor).end + offset]`), clip to `[0, endMinute]`, and return it with `startsAt`/`endsAt`
rewritten to the clipped wall times (or `null` when nothing is left). If it fits neither, return it
unchanged (today's drawing). Pure; no database.

**Why server-side:** on a special-day date `layerPaint` drops a range whose span runs backwards
(`day-paint.ts:39-50`), so the client never receives it; and the dashboard's `placeOnDay`
(`dashboard/zone-own-hours.ts:25-34`) is shared with server validation (`closureOutsideHours`) and
must not change. Nothing that decides service, keep-open, routing, closures or a sale's business day
passes the option (`resolveDepartmentService`, `keep-open.ts`, `operations.ts`, `routing-store.ts`,
`working-order.ts`, `module.ts:709`, `planned-service-guides.ts`, `staffing` — grep the callers and
list them in the handover).

- [ ] **Step 1: failing tests** (`calendar-cut.test.ts`): day 03:00/1440, anchor 05:00, 22:00–04:30
  → 22:00–03:00; day 07:00/1440, anchor 05:00, 06:00–08:00 → 07:00–08:00; day 03:00/1440, anchor
  05:00, 05:00–05:00 → 05:00–03:00; a fitting range is returned as the same object; a range fitting
  neither is returned unchanged; changeover day 05:00 with `endMinute` 1320, anchor 05:00, 22:00–04:30
  → 22:00–03:00. Calendar (`opening-hours-calendar.test.ts`): venue 05:00, a past change to 03:00 on
  `2026-10-21` and back to 05:00 on `2026-10-28`, week Saturday 22:00–04:30 stored after the return
  (raw insert, as Task 11 now allows it), read October 2026: Sat 24 Oct draws `22:00–03:00`, Sat 31
  Oct `22:00–04:30`; a one-off special day on Sat 24 Oct painting only a 12:00–15:00 lunch keeps the
  season's cut dinner (today it is dropped). `day-resolver.test.ts`: the same data without the option
  gives today's ranges (the uncut 22:00–04:30, and the dinner dropped on the special day).
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/venue-service exec vitest run src/calendar-cut.test.ts src/opening-hours-calendar.test.ts src/day-resolver.test.ts src/hours.test.ts src/menu-timetable.test.ts src/keep-open.test.ts`
  (existing files only). Prove the option is calendar-only by deletion: drop it from the month read,
  the Sat 24 Oct case fails; nothing else does.
- [ ] **Step 5:** prettier; commit `A788: past days draw a range that misfits their start cut at their ends`.

## Slice 3 — Dashboard: card and dialog

Per-task reviewer: **yes** for Task 14 (rule 7 on the client); Tasks 13 and 15 take the LIGHT path.

### Task 13: the Business-day card (~60 tool calls)

**Files:** `apps/dashboard/src/api/client.ts:108-149,2949-2971`, `apps/dashboard/src/api/client-routes.test.ts:1354-1402`,
`apps/dashboard/src/screens/business-day-start-editor.ts` (card part: `:286-304`, `:374-441`),
`apps/dashboard/src/i18n/strings.ts` (EN `:845-870`, ES `:3792-3818`),
`apps/dashboard/src/screens/business-day-start-editor.test.ts`, `venue-details-business-day.test.ts`.

**Decisions:**
- Client: `pending` without `locksAt`/`editable`, preview without `locksAt` (the dialog's "Editable
  until" preview row goes with it); reason union gains `"overlap" | "kept_open"` (the label map gets
  both, with Task 14's strings — until then map them to today's `conflict_range` text); conflicts
  already carry optional `endsAt`; `cancelBusinessDayStart` and `#cancelPending` removed. The preview
  input changes in Task 14, not here.
- Card rows: "Starts at" = start in force, always. While `pending`: "New start" =
  `fill("business_day.new_start_value", { time, when: formatChangeoverMoment(pending.startsAt, tz) })`
  and a muted second line `fill("business_day.day_length", { day: formatBusinessDate(E−1), duration })`,
  the duration from `businessDayBounds(model.clock, E−1)` (`@waitron/shared`). Header action: "Change
  start" whenever not read-only and no dialog. No Replace, Cancel, "locked", "Editable until" or
  "Scheduled change".
- Re-read at the changeover: while `pending.startsAt` is in the future and at most `2_147_483_647`
  ms away, a timer calls `this.api.liveData.invalidate([{ type: "location_day_cutover_changes" }])`
  at that moment (the panel's live query depends on that table, `api/live-queries.ts:507-515`, and
  re-reads through the background client, so the read is passive). Cleared on disconnect and on a
  new model. (Design §5 said the panel has no live subscription; it has one, with a 60 s refresh —
  the timer makes the switch exact.)
- Strings: add `business_day.new_start`, `business_day.new_start_value`, `business_day.day_length`
  (design §7); remove `business_day.scheduled`, `.none`, `.locks`, `.locked`, `.replace`,
  `.cancel_pending`.

- [ ] **Step 1: failing tests:** card with nothing waiting → rows `["Starts at 05:00"]`, a Change
  start button, nothing else; with `pending { effectiveBusinessDay: "2026-10-21", dayCutover: "03:00",
  startsAt: "2026-10-21T01:00:00.000Z" }` on a Madrid 05:00 clock → "New start" value
  `"03:00, from Wed 21 Oct, 03:00"` and `"Business day Tue 20 Oct lasts 22 h."`; in Spanish
  `"03:00, desde mié 21 oct, 03:00"` and `"El día de trabajo mar 20 oct dura 22 h."` (restore the
  language after); read-only shows the rows and no button; the re-read: with fake timers
  (`vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })`) advance to `startsAt` →
  the spy on `liveData.invalidate` was called once with that type, and no non-background request was
  made; a far `startsAt` (300 days) schedules nothing. Client routes: preview path
  no `cancelBusinessDayStart` (`expect(api).not.toHaveProperty("cancelBusinessDayStart")`).
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/business-day-start-editor.test.ts src/screens/venue-details-business-day.test.ts src/api/client-routes.test.ts src/screens/venue-details-panel.test.ts`.
  The dialog keeps its date field until Task 14; its date-typing tests still pass against the
  server-shaped fixtures and are rewritten there.
- [ ] **Step 5:** prettier; append rows; commit `A788: the Business-day card shows the start and a waiting change`.

### Task 14: the Change start dialog (~75 tool calls)

**Files:** `apps/dashboard/src/screens/business-day-start-editor.ts` (dialog part),
`apps/dashboard/src/api/client.ts:120-124,2949-2959`, `apps/dashboard/src/api/client-routes.test.ts`,
`apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/codes.ts:84-95`, tests
`business-day-start-editor.test.ts`, `business-day-start-editor.unsaved.test.ts`,
`venue-details-business-day.test.ts`.

**Decisions:**
- Draft `{ dayCutover }`; baseline `pending?.dayCutover ?? start in force` (Save quiet until it
  changes); `draftScopeFor`/`saveActionState` as today.
- Client: `previewBusinessDayStart(input: { dayCutover: string; expectedClockRevision: number })`
  builds the query from those two only (`client.ts:2949-2959`); the client-routes check moves to
  that path:
  `/management-api/venue-details/business-day-start/preview?dayCutover=07%3A00&expectedClockRevision=4`.
- Preview on every valid draft with `{ dayCutover, expectedClockRevision }`; Save sends
  `{ effectiveBusinessDay: preview.effectiveDay.businessDay, dayCutover, expectedClockRevision }`.
- Ready = preview for this draft, revision and clock, `conflictCount === 0`. Save
  `variant = ready ? saveAction.variant : "secondary"`, disabled unless ready and changed. The
  acknowledge state and button go.
- Preview box, in order: `business_day.takes_effect` with `{when}` drawn in `<strong>` (split the
  translated string at `{when}`); `business_day.today_runs` when `previousDay.businessDay ===
  model.currentBusinessDay`, else `business_day.day_runs` (see the gap below) — `{day}` =
  `formatBusinessDate`, `{start}`/`{end}` = HH:MM of the instants in the venue's zone, `{duration}` =
  `formatDayLength((endAt − startAt) / 60000)`; `business_day.history` muted; conflicts as today's
  shape (season first), heading `business_day.conflicts` + count + the Opening hours link, labels:
  `range` → `conflict_range`, `overlap` → `conflict_overlap`, `endpoint_day` → `conflict_endpoint`,
  `kept_open` → `fill("business_day.conflict_kept_open", { time: endsAt })`.
- Refusals (Save and preview): `changeover_passed` → under the field and at the bottom, and the
  preview refreshes; `clock_transition` → `fill("business_day.clock_transition", { date:
  formatBusinessDate(clocksChangeOn), when: formatChangeoverMoment(saveFrom, tz) })`; others as today.
- Strings (design §7, EN and ES): add `takes_effect`, `today_runs`, `conflict_overlap`,
  `conflict_kept_open`, `changeover_passed`, `clock_transition`; replace `history`, `conflicts`,
  `conflict_range`, `conflict_endpoint`; ES `venue_details.dayCutover` → "El día de trabajo empieza
  a las"; remove `date`, `date_invalid`, `acknowledge`, `transition`. **Two lines not in the design's
  table (driver: confirm with the plan reviewer, and with the owner if the reviewer doubts them):**
  `business_day.day_runs` "Business day {day} runs {start} → {end}: {duration}." / "El día de
  trabajo {day} va de {start} a {end}: {duration}." — under rule 2 the day whose length changes is
  tomorrow, so "Today's business day" would be false; and `venue.business_day_invalid`'s generic
  copy (`codes.ts:84-87`) "Check the future date and start time." → "Check the start time." /
  "Revisa la hora de inicio.", because the date field is gone.

- [ ] **Step 1: failing tests** (fixtures from mockups 02 and 04): 05:00 → 03:00 preview
  `{ previousDay: { businessDay: "2026-10-20", dayCutover: "05:00", startAt: "2026-10-20T03:00:00.000Z", endAt: "2026-10-21T01:00:00.000Z" }, effectiveDay: { businessDay: "2026-10-21", … startAt: "2026-10-21T01:00:00.000Z" } }`,
  `currentBusinessDay "2026-10-20"` → text "Changes at the next changeover: Wed 21 Oct, 03:00.",
  "Today's business day (Tue 20 Oct) runs 05:00 → 03:00: 22 h.", "Earlier reports keep their days.";
  Save enabled and primary; the write is `[{ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00", expectedClockRevision: 4 }]`.
  Rule 2 fixture (`currentBusinessDay "2026-10-20"`, previousDay `2026-10-21`, 19 h 30 min) →
  "Business day Wed 21 Oct runs 05:00 → 00:30: 19 h 30 min.". DST fixture (23 h). Mockup 04: two
  `range` conflicts → "Opening hours that clash with the new start: 2.", lines
  "All year: Restaurant · Fri · Dinner · 21:00–04:00 · Crosses the new start" (season named
  "All year"), Save quiet (`variant="secondary"`) and disabled. `kept_open` line "… · Kept open
  until 04:30 tonight". Refusals: `changeover_passed` shows the sentence under the field and at the
  bottom and a second preview request is made; `clock_transition` with
  `clocksChangeOn "2026-10-25"`, `saveFrom "2026-10-26T01:30:00.000Z"` → "The clocks change on Sun
  25 Oct. Save again from Mon 26 Oct, 02:30.". Spanish for one line of each kind (restore after).
  Unsaved tests: the time field's draft is protected and released on a literal revert; a refusal
  keeps the draft.
- [ ] **Step 2–4:** fail; implement; pass
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/business-day-start-editor.test.ts src/screens/business-day-start-editor.unsaved.test.ts src/screens/venue-details-business-day.test.ts src/screens/venue-details-panel.test.ts src/dashboard-app.venue-settings-unsaved.test.ts src/api/client-routes.test.ts`.
  `/usr/bin/grep -rn "business_day\.\(scheduled\|none\|locks\|locked\|date\|replace\|cancel_pending\|acknowledge\|transition\)\b" apps/dashboard/src`
  → nothing.
- [ ] **Step 5:** prettier; append rows; commit `A788: the Change start dialog has one field and says when it takes effect`.

### Task 15: accessibility and the LOOK (~60 tool calls)

**Files:** create `apps/dashboard/src/screens/business-day-start-editor.a11y.test.ts` (none exists);
screenshots outside the repo in `/Users/clintongormley/waitron-campaign/a788-shots/`.

- [ ] **Step 1:** axe test (the package's existing `*.a11y.test.ts` pattern) for: card with nothing
  waiting, card with a waiting change, dialog with a ready preview, dialog with conflicts — each in
  both themes. Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/business-day-start-editor.a11y.test.ts`; PASS.
- [ ] **Step 2: LOOK, deterministic states.** Copy the shape of
  `/Users/clintongormley/waitron-campaign/a346-shots/a346-shots.test.ts.keep`: a temporary browser
  test beside the editor, never committed (kept as `a788-shots/a788-shots.test.ts.keep`), mounting
  the card and dialog with Task 13–14's fixtures and saving `page.screenshot` files for: card
  nothing waiting, card waiting, dialog 05:00 → 03:00, dialog with mockup 04's clashes — each
  en-GB and es-ES, light and dark, at 1280 and 390 px wide. Compare side by side with
  `docs/backlog/mockups/a788-business-day/01-…05-*.png`; note every difference.
- [ ] **Step 3: LOOK, real stack.** `wa-wt demo waitron-feat-a788-business-day-next-changeover`
  (`docs/developers/workflow-guide.md`; the demo manager is `manager@demo.waitron.local`; read
  `docs/ui-review.md` → "Running the stack from a worktree"). Open Venue settings → Venue details.
  Clashes: Change start, type `21:00` — the demo's lunches give `endpoint_day` lines; screenshot.
  A waiting change: type a start a few minutes either side of the current one; if the list shows
  clashes, shorten the named ranges in Opening hours until none remain, then Save; screenshot the
  card in both themes and at 390 px with the workspace's Playwright Chromium. The painter line
  (mockup 06): with that change waiting, give a Saturday dinner a range crossing the waiting start
  in the Opening hours painter and Save; screenshot. Afterwards check the venue's holders
  (`lsof +D <venue dir>`, port 8080) and run `wa-wt reset demo waitron-feat-a788-business-day-next-changeover`.
- [ ] **Step 4:** fix what the LOOK found (tokens only), rerun the editor tests, prettier, commit
  `A788: accessibility checks for the Business-day card and dialog`. List the screenshot paths and
  each difference from the mockups (fixed or accepted, with why) in the handover.

## Slice 4 — Attendance, docs, backlog

Per-task reviewer: none (LIGHT), except the driver reads Task 17's doc claims against their receipts.

### Task 16: attendance follows today's moved end (~35 tool calls)

**Files:** `apps/server/src/attendance-cutover-settings.test.ts` (new case).

- [ ] **Step 1:** a test, built on the file's existing setup (Madrid, 04:00 start, a published
  shift on 2026-01-07): discover days at `2026-01-07T12:00Z`; Save 06:00 at that moment (E
  `2026-01-08`, through the real route); then evaluate day `2026-01-07` with `nextAttendanceDay` at
  a `now` after the NEW end (`2026-01-08T05:00:00.000Z`, 06:00 local): the day row's `endAt` is
  `2026-01-08T05:00:00.000Z` (it was `03:00Z`), and a fact recorded at `2026-01-08T04:30:00Z`
  (05:30 local) is labelled `2026-01-07`. Before the change that fact would belong to `2026-01-08`.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/attendance-cutover-settings.test.ts src/attendance-discovery.test.ts`.
  It is expected to pass with no product change (design §5: bounds refresh while unevaluated,
  `attendance-discovery.ts:526-549,568-582`). Prove it by deletion: comment out the refresh loop at
  `:535-549`; the `endAt` assertion must fail; restore. If it does not pass, STOP and report — the
  design said no change was needed.
- [ ] **Step 3:** prettier; commit `A788: attendance takes today's moved end`.

### Task 17: docs, backlog, final checks (~50 tool calls)

**Files:** `docs/developers/conventions-data.md` (`:655-661`, `:672-676`, `:1202-1210`),
`docs/developers/design-system.md:5141-5147`, `docs/superpowers/specs/2026-10-11-a495-business-day-history-design.md`
(dated pointer under the title), `docs/backlog/service-periods.md:578-588` (dated pointer in the
Decisions entry), `docs/backlog.md` (`:1431-1435` A788 line; `:1543-1544` loose end), the design doc's
Status line.

- [ ] **Step 1:** rewrite each passage to the built behaviour, every sentence with its receipt
  (a test name or `file:line`): a Save sets the next changeover (rule 2 when the new time has
  passed), no Replace or Cancel, saving the start in force removes a waiting change; hours writes
  refuse `hours.clock_change_conflict` only for a clash with the waiting start, after the write;
  new hours are checked against the start in force; the calendar cuts a past day's misfitting
  range. Pointers, not rewrites, in the A495 spec and the service-periods decision: "2026-10-xx,
  A788: dated scheduling replaced — see `docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md`."
- [ ] **Step 2:** backlog: DELETE the A788 line under "Loose ends left by A755 (#1809)"; A851 stays.
  The A506-4 loose end "reports 'Invalid or overlapping range' before 'Range crosses the new start'"
  — check against the built labels (`range` now reads "Crosses the new start", overlaps their own
  label) and delete it only if a test from Task 6 or 14 shows the case it describes; say which. Each
  open point the build left becomes a short entry in its area (at least: Review focus items not
  fully closed, any LOOK difference accepted rather than fixed). Design doc Status → built, with the
  PR to be named by `/finish-branch`.
- [ ] **Step 3: final checks.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` (unedited; PASS);
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/module-seams.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/claude-md-pointers.test.ts`;
  `pnpm --filter @waitron/dashboard-kit test:coverage` (small; read the per-file table for
  `date-format.ts`); `git diff 373b96623 --stat -- packages/fiscal-verifactu packages/fiscal packages/core`
  → empty. Read the `Tests` count of every run. The server, venue-service and dashboard package
  suites and their coverage bars are CI's (CLAUDE.md §2); run one locally only to chase a failure.
- [ ] **Step 4:** prettier `--file-info` on the docs; commit `A788: docs and backlog for the next-changeover start`.
  Driver: set the ledger to `Status: done` and announce the branch is ready for `/finish-branch`.

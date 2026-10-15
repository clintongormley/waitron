# Working time and staff — detail

The open entries are listed in [the backlog](../backlog.md), under "Working time and staff". This file holds
their full text.

## A10. Clocking in and out — the working-time record

You can clock in, take breaks and clock out on an admitted till or venue handheld. The
_registro de jornada_ is a legal duty from the first day
the deli employs anyone ([design](../superpowers/specs/2026-07-22-workforce-and-time-record-design.md)).
Built: the append-only, hash-chained time entries (per node since #268), contracts, the daily
projection of worked time, correction requests and approvals, the Spanish export
(`packages/workforce-es`), and the rota, absences, swaps, planned-versus-actual view and staff portal.
The trading server connects the till adapter to `clockIn`, `clockOut` and the break events in
`packages/workforce/src/clocking.ts`. You can request and answer corrections on the till, and
review or propose them in the dashboard.

Left, as the legal minimum:

- read access for the worker, their representatives and the labour inspectorate, with four years'
  retention, and a route that produces the export.

Then: shift templates and availability (the tables exist and the configuration export copies them,
but no feature uses them); wages (A9); the payroll export, which waits on the gestoría's import
format. **Designed 2026-10-12** in
[the A10 spec](../superpowers/specs/2026-10-12-a10-clocking-in-and-out-design.md), six parts that land
on their own. The labour-advisor gate is answered: the digital-record decree was not published in the
BOE up to 12 Oct 2026 (the spec's legal-basis table has the sources), so A10 builds to the October 2025
draft and is checked against the final text if it is published. The time record cannot be edited once
written, so its chain and correction paths take the owner's sign-off at land.

Part 1 added missing-entry corrections, worker and manager decisions, immediate confirmed automatic
hours with a separate worker acknowledgment, stored admin-only self-approval (owner, 2026-10-14),
pay-period closure, scoped frozen records and the Spanish history export. Export routes and screens remain open. Reset/reseed old workforce venue folders before installing the nullable-recorder
constraint migration (owner decision, 2026-10-13). The populated old-record migration test checks
the refused rebuild and unchanged rows/head after rollback; the empty old-schema test upgrades.


Part 2 connects till clocking through the reviewed
[till-clocking plan](../superpowers/plans/2026-10-14-a10-2-till-clock-plan.md). New Counter and
Handheld profiles include `clock-in`; enable it explicitly on an existing profile in Device profiles.
At the first sign-in of the business day, you see Clock in and Cancel together. Cancel lets you work
without clocking in, and the next sign-in asks again. After that, your name menu holds the clock-state
dot, break actions, Clock in or Clock out, and Log out. On a phone these fold into More. Clock out
ends a current break and records your finish together, then locks and logs out. Log out alone leaves
your time record open. If the finish was recorded but logout fails, the till stays locked and shows
Clocked out. A lost clock response is checked with a fresh own-state read before another write is
available. An open shift in another location is shown with clock actions unavailable.

Part 3 connects the [end-of-day checks](../superpowers/plans/2026-10-14-a10-3-end-of-day-plan.md).
A forgotten clock-out closes at your last later sign-in, order, accepted payment or break activity
in that business day. Without later activity, the shift stays open and a question records the missing
time. A published rota shift without a clock-in, or till work without a clock-in, also creates a
question. Automatic ends count immediately; you answer their questions at a later sign-in.
Your clock state and clock actions reconcile an overdue open day before returning the current state.

Missing-time reminders use the venue's email setup and your saved address. Without an address,
the question remains without email. SMTP acceptance and uncertain delivery suppress another
automatic attempt; an explicit refusal waits fifteen minutes before retrying. SMTP acceptance does
not establish inbox delivery. Restoring an older backup can lose the sent marker and permit a
duplicate. Background checks run only on a writable primary with workforce enabled. They catch up
after restart and wait for source discovery before processing an old day. Database-content restore
checks retain the chain, questions and reminder identity; these keep the destination's identity and
skip fiscal restore hooks.

Order and draft snapshots retain the admitted worker, original location and command instant.
Payment callbacks qualify the original request instead of creating later human activity. Party
names, bill-request flags and group reminder timing do not count as order or payment activity.

Part 4 connects [answers and corrections](../superpowers/plans/2026-10-15-a10-4-answers-and-corrections-plan.md).
At sign-in, you answer pending questions before Clock in. Cancel lets you work without answering;
the unanswered questions return at a later sign-in. In your name menu or handheld More, Fix my hours
opens a day and location so you can request a changed time or supply missing times. A selected
supervisor or manager can approve or decline the request with their PIN.

In the dashboard, Team → Time corrections shows requests waiting for a manager, proposals waiting
for the worker and disagreements. A manager can propose a change; you accept it or give a reason
for disagreeing. Original entries and responses remain in the history. Automatic finishes count
before acknowledgment, and administrator self-approval is shown explicitly. If a reply is lost,
Retry read checks the saved response before another attendance write is offered.

Part 5 connects the [hours screens](../superpowers/plans/2026-10-15-a10-5-hours-screens-plan.md).
Open My hours from your name menu or handheld More, or the Hours tab in My Schedule.
Choose a week or month, starting with the current week on Monday. Days show completed
worked time, recorded offsets and original/corrected history; open shifts and breaks stay
separate. Pending answers remain visible outside the selected dates. Fix my hours opens
the existing correction request; own dashboard requests also wait for manager approval.

In Team → Hours, choose a workplace, worker and pay period. The initial period follows
the venue’s configured cadence, monthly by default. Open a day to propose a change or read
a request before approval or decline. Time corrections remains a separate queue. Automatic
ends already count while awaiting acknowledgment; stored self-approval, frozen period totals
and later changes are shown separately.

Part 6 remains open: PDF/CSV and representatives’ export surfaces. Inspector remote access
and the period-read cost remain separate open entries.


## A10 period read cost

A10-1 narrows ordinary clock state to the latest live instant, targets and acknowledgments to their
ids, and own records to that person before projection. Period summaries, location planned-versus-actual
and pay-period closure still load their scoped complete history; future bounded reads must retain
late answers and corrections that move a session across period boundaries.

Measured 2026-10-14 on Node v26.7.0, macOS, a temporary real venue store with ten synthetic workers
and four years of weekday in/out events: 20,860 entries (2,086 per worker), with their real computed
hashes verified by `verifyChain`. Current code took 2.8 ms to clock in, 22.1 ms for the person's
September record, 16.9 ms for their summary, 99.4 ms for location planned-versus-actual and 354.2 ms
for closure. September assertions checked 10,560 minutes per worker and 105,600 location minutes.
This measures this fixture on this laptop, not a box, large venues or all possible corrections.
The command was `pnpm --filter @waitron/workforce exec vitest run
src/zz-read-performance-probe.test.ts --reporter=verbose` in an independently installed disposable
checkout; the probe and log are retained with PR #1638’s review receipts. Optimise the remaining period paths with their cross-window
and frozen-history assertions intact; do not replace them with a bare event-time filter.

## A708. Special-day staffing on a date with its own changeover

The special-day staffing painter draws every date's column, and the blocks in it, on the read's one
`cutover`, which `readSpecialDayStaffing` (`packages/staffing/src/paint.ts`) takes from
`clock.dayCutover`: the location's baseline changeover, not necessarily the one in force on each
date. Each date's opening hours behind the paint (`resolveDepartmentsDays`) and the month's slot
count (`slotsForDay` in `packages/staffing/src/month.ts`, given `day.dayCutover`) use that date's
own changeover. So when a changeover change is scheduled, a block can be drawn longer than the
slots it produces: A585-4's review reported a 02:00–04:00 block drawn as 120 minutes against 60 in
slots, on a date with a 03:00 changeover and a 06:00 baseline. Opening hours' special-day painter
draws from the first date's changeover and says so when the dates' changeovers differ. Needs a
decision on how one grid with one time ruler shows dates with different changeovers. Left open by
A585-4.

## A710. Staffing painter polish

Found by A585-4's look at both painters and its review:

- The staffing paint row has no "Drag down a day to paint…" hint; Opening hours' paint row has one
  (`painter.hint`, `packages/venue-service/src/dashboard/paint-row.ts`).
- "+ New staff role" opens the staff-role dialog titled "Add staff role" with a Save button; the
  period dialog opened from Opening hours' painter says "Add and paint with it".
- A block shorter than about 45 minutes shows no text.
- An editable block has no hover tooltip; a read-only one has its full name as `title`
  (`staffing-grid.ts`).
- The block menu's How many ignores a value outside 1–50, while the paint row's How many puts it
  back within 1–50. Two tests pin the two rules: "How many changes the block's headcount, within 1
  to 50, and keeps the menu open" (`staffing-grid.test.ts`) and "puts How many back to the number
  it paints when it is given one it cannot use…" (`staffing-season-painter.test.ts`).
- In the Staffing month, a focused day's ring and today's frame look alike.

Left open by A585-4.

## A711. Shared staffing painter code

- `staffing-season-painter.ts` and `staffing-special-day-painter.ts` (under
  `packages/staffing/src/dashboard/`) repeat the same lifecycle: the read and its re-read after a
  save, the draft scope, Save and its refusal, the area picker and the staff-role dialog wiring. A
  shared base class or controller could hold it.
- Copied from venue-service rather than exported from `@waitron/venue-service/painter`: the season
  ‹ › stepper and its CSS; the staffing paint row's markup, which relies on `paintRowStyles`' class
  names; and the `--paint-grid-fill` height (staffing's `painter-parts.ts`, and venue-service's
  `season-painter.ts` and `special-day-painter.ts`), whose sum depends on the height of the grid's
  heading row.
- The special-day painter takes its list of dates from the read's first area, as no top-level list
  exists in `SpecialDayStaffing`.

Left open by A585-4.

## Pay-period changes after closure

A January month closed with 480 minutes keeps that snapshot after the cadence changes to weekly.
For 1 February, `resolvePayPeriod` then returns 26 January–2 February; `closePayPeriod` refuses
that overlap with `pay_period.invalid`. The next whole week, 2–9 February, can close. This was
run on base `580bf71e46b6803de525cceed39f04f28b34a4ac` on 2026-10-15, independently of the
Hours implementation, through `pnpm --filter @waitron/workforce exec vitest run
src/zz-a10-5-cadence-probe.test.ts --reporter=dot` (one passing case). The retained probe is
`~/waitron-campaign-f/receipts/a10-5-base-cadence-probe.test.ts`.

`setPayPeriodSettings` currently has no application caller: `rg -n setPayPeriodSettings apps
packages --glob '!*.test.ts'` found only its workforce definition and export. Hours follows the
approved read contract: a date inside a saved closure uses that stored period; otherwise it uses
the configured cadence. Its totals describe the printed date range, and reading creates no closure.

Before adding cadence editing, decide how the first partial period follows a closed period.
The proposed conservative default is to refuse a cadence change after the first closure until
that transition is specified. Keep saved periods and snapshots intact. This is separate from
A10-5 and its read-only hours presentation.

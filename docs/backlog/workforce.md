# Working time and staff — detail

The open entries are listed in [the backlog](../backlog.md), under "Working time and staff". This file holds
their full text.

## Inspector access to working-time records

Add authenticated read-only remote access when Waitron Cloud can reach the venue's box. Until then,
you can download a record on request from the dashboard. Remote inspector access remains outside
[the October A10 design](../superpowers/specs/2026-10-12-a10-clocking-in-and-out-design.md).

## Advisor review of the working-time export

Have the labour advisor check the final applicable text, required export fields and the
representatives' version before go-live. The current representatives' default omits contact details,
ID numbers and free-form reasons, while keeping names, actor references and recorded decisions.
The final policy and any additional required format remain the advisor's decision.

## Payroll export and unused scheduling tables

Ask the gestoría which payroll package and import format it accepts before building a payroll export.
Keep that separate from the working-time PDF/CSV. Build shift-template and availability features as separate scheduling work.

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
Owner decision, 2026-10-15: a future cadence editor refuses a change after the first closed period
until the owner approves a transition rule. Leave this work in the backlog until that editor is built. Keep saved periods and snapshots intact. This is separate from
A10-5 and its read-only hours presentation.


## Frozen-summary name collection

The A10-6 run-it review deleted the name collection for people named only in a frozen summary
(`record-export.ts:161`) and all 12 provider cases still passed. The current closure writer derives
summary subjects from frozen entries (`pay-period-close.ts:144`); no valid summary-only fixture
was established in the review. Keep the defensive collection and qualify a supported snapshot
shape before adding a case for it. This is a test gap, not an observed incorrect exported name.

## PDF boolean and empty values

The PDF currently prints scalar values as `null`, `true` and `false`, including in Spanish. The
reviewed serializer contract and its tests retain these spellings. Decide readable localized PDF
wording separately, keeping CSV's scalar spellings stable; no legal-field or writer change is implied.

## A724. Staffing: named opening hours behind the grid, a prep station's hours, special days reached from the day box

**A724 (owner, 2026-10-15).** Mockups: [a department](mockups/a718-a727-calendar-and-stations/08-staffing-painter-department.png),
[a prep station](mockups/a718-a727-calendar-and-stations/09-staffing-painter-station.png), [the month](mockups/a718-a727-calendar-and-stations/10-staffing-month.png).
Files: `packages/staffing/src/dashboard/staffing-grid.ts`, `staffing-season-painter.ts`,
`staffing-special-day-painter.ts`, `staffing-month.ts`, `packages/staffing/src/paint.ts`.
Coordinate with A585 parts 5–8 on the same files.

1. **The opening hours behind the grid are named.** Today each period is a light blue band with a
   dashed top and bottom edge, so where periods meet there are unexplained dotted lines
   (`staffing-grid.ts:156-169`). Draw each period faded in its own colour with its name and times at
   the top, and say in the paint row what the shading is: "Shaded: {department}'s opening hours, by
   period".
2. **A prep station's grid shows when it gets orders.** Today the server sends hours for
   departments only (`paint.ts:250-257`), so Kitchen's grid is blank. Shade it from each period's
   start to its last orders (its end offset), counting a period only when its menu has a dish routed
   to the station, in one lane per department that sends it dishes, each band labelled with its
   department and period. Owner: "we do know the minimum hours for the departments because we derive
   them from the periods and the menus". A722 point 6 draws the same reading.
3. **Special days are reached from the day box.** The special-day staffing painter exists (A585-4)
   but opens only from a special day's date. The month gets A720's day box, offering "Edit
   {special day} staffing" or "Edit {season}'s standard week"; no seasons or special-days row.
4. **"Autumn: standard week"** as A723 point 1.

## Rota warning query boundaries

The A585-5 review replaced the unattached-shift SQL date with the UTC date and all nine warnings
cases passed. Those cases exercise the separate JavaScript filter's local dates. Add fixtures at
the previous week's first local Monday and the next week's last local Sunday, where the SQL
selection decides whether the neighboring week is represented for weekly rest. Retain the existing
offset and location assertions; require the UTC-query mutation to fail. The route currently keeps
the offset-aware query. This is a test gap, not an observed wrong answer from that query.

## Roster browser-entry re-exports

The A585-5 review added `export { readFileSync } from "node:fs"` to the browser entry in a
disposable installed candidate; both browser-entry checks still passed. A direct Node import fails
the source guard. Extend the guard to runtime re-exports and test that negative control. The current
entry was separately bundled for a browser and executed in Chromium; this follow-up concerns what
the text guard would fail to catch in a later edit.

## Decisions and deliberate limits

### A10. Clocking in and out — the working-time record

The [October design](../superpowers/specs/2026-10-12-a10-clocking-in-and-out-design.md) records the
owner's clocking, correction and automatic-finish decisions. Parts 1–6 are built through their
[plans](../superpowers/plans/2026-10-15-a10-6-record-export-plan.md).

At your first till sign-in of the day, Clock in and Cancel sit together. Cancel lets you work and
the next sign-in asks again. Later clock actions and My hours live behind your name, folded into
More on a handheld. Clock out logs you out; Log out alone leaves your time record open.

A forgotten finish counts automatically at your last later qualifying activity. Without later
activity, no finish is invented. You answer automatic or missing-time questions at a later sign-in.
Automatic time already counts while acknowledgment waits. Only an admin may approve their own
request, and that self-approval stays in the recorded history after a role change (owner, 2026-10-14).
A manager's proposed time takes effect after worker acceptance; a disagreement keeps both versions.
Pay periods default to monthly, and a closed period keeps its frozen record alongside later changes.

You can download your own record from My Schedule → Hours. Team → Hours offers a manager PDF or
CSV for Everyone or one person when you hold `report.export`. The displayed period supplies the
initial dates; From is included and Before is excluded, and you can choose another valid range.
PDF and the standard version are the defaults. Export uses the enabled provider; it neither closes
a period nor appends attendance entries. The snapshot captures complete scoped history before
formatting outside its transaction; complete-history read cost remains open above.

The representatives' default removes free-form reasons as well as contact details and ID numbers.
It retains names, record references, attribution and decisions. That default still needs the advisor's
check above. Inspector remote access and payroll export remain separate work.

Old workforce folders from before part 1 must be reset/reseeded for the nullable-recorder constraint
migration (owner, 2026-10-13). No backwards conversion was added.


### A585. Pending swaps follow a copied draft

The owner's 2026-10-13 decision is to warn that a request exists rather than block changing the
week. Pending requests follow the copies immediately; decided requests stay on the old shifts.
Deleting the copied offered shift cascades its pending request while the published original stays
visible. Part 7's approved plan requires a marker and confirmation saying that deletion cancels the
request, and warns before changing its person or time. Build those controls with the first
application caller of `copyPublishedToDraft`; part 5 adds only the library method. See
[Task 7.2](../superpowers/plans/2026-10-13-a585-staffing-and-rota.md#task-72-changing-a-published-week).

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

## A710. Readable initials in short staffing blocks

A later zoom/readability design remains open for short blocks. Keep the whole-day overview without
vertical scrolling. Read a short block's full name through its tooltip or block menu, as the owner
decided on 2026-10-16. No new zoom or scrolling design is agreed.

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

## Staffing paint in calendar delete confirmations

The A585 design leaves the count of staffing paint out of season and special-day date deletion
confirmations (open point 7). Decide whether to add a shared deletion-impact seam, so venue-service
can ask contributing modules for that count, or deliberately keep the confirmation without it.
The completed rota retirement does not depend on that choice.

## A761. The staffing grid: a drag paints unless a block is picked, and a wide block editor

**A761 (owner, 2026-10-16).** Files: `packages/staffing/src/dashboard/staffing-grid.ts` and the two
staffing painters that host it.

1. **A drag paints a new block unless you have clicked an existing one first.** Today a drag that
   starts on a block acts on it: its top and bottom quarters resize it and the rest opens its menu
   (`staffing-grid.ts:62-63`, the `.edge` rule at `:140`). A block fills its column's width for its
   hours, so painting a second role over the same hours almost always lands on the first and
   resizes it. Owner: "if you want to edit an existing one then you should click it first. once it
   loses focus then dragging paints a new one instead". An unpicked block lets a drag paint through
   it; clicking a block picks it, and only then do its edges resize it and its editor open. The
   keyboard keeps working: picking a block also focuses it.
2. **The block's editor becomes wide, with a Save.** Today it lists one button per staff role, the
   current one drawn disabled so it reads as unavailable; a role click and the "How many" stepper
   save at once; Delete is a large red button; the contents do not line up. Owner: a dropdown of
   roles, wide rather than long, and a Save rather than saving on a click outside.

   ```
   Staff role                How many
   [ Sous chef         ▾ ]   [ −  3  + ]

   [Cancel] [Delete]                [Save]
   ```

   The role field is the shared combobox (searchable); Save stays quiet until something changes; a
   click outside or Cancel throws the change away; the bottom row follows the house rule for a
   destructive action (design-system.md → Forms). A707's note that on a phone the block menu can
   cover its block is checked against the new editor.

## A763. The Rota view redesigned: one Show menu, no button per cell, an empty week that says why

**A763 (owner, 2026-10-16).** The owner, on the Santet venue: "the rota screen is completely
unusable". Approved [mockups](mockups/a763-rota/) (canvas:
https://claude.ai/artifact/AoJHtjzj7j4wiPKFWuy5Rw). What the owner saw on Calendar → Rota, week of
26 Jan 2026: By person was a wall of 7 × N "Add shift" buttons; By area showed staff role rows with
nothing in them and did not say the week had no staffing painted; "People this week (all areas)"
repeated the By person rows and squeezed the grid; three rows of controls came before any content,
with "Labour rules are not set up" on a line of its own. Files:
`packages/staffing/src/dashboard/rota-view.ts`, `rota-by-area.ts`, `rota-by-person.ts`,
`slot-picker.ts`, `staffing-month.ts` and `strings.ts`. Before A586–A588, which build on this
screen.

1. **One Show menu replaces both the Area picker and the By area | By person switch**
   ([board 1](mockups/a763-rota/01-show-one-area.png)). "Everyone" draws one row per person; an area
   draws its staff roles and their slots. This retires the A585 spec's decision 9. A staff role row
   appears only when the area has slots or shifts for it that week.
2. **Two rows of controls.** The Calendar switch stays; one bar holds `‹ week ›`, Show, then on the
   right the week's state, what needs attention and the one action. The week title keeps a fixed
   width and links back to Staffing → Month for that month, as A722's Week title is to (service-periods.md, A722 point 3).
3. **"People this week" goes.** Hours show where a choice is made — in the picker — and under each
   name in Show: Everyone. The picker opens beside the slot that was clicked, not in a side panel.
4. **No "Add shift" in every cell.** In an area, a dashed slot is the place to fill; a shift beyond
   the paint is added from the empty part of a cell, where "+ Add shift" appears on hover or focus.
   In Show: Everyone ([board 2](mockups/a763-rota/02-show-everyone.png)), clicking the empty part of
   a day offers that day's open slots, those in the person's staff roles first and the rest marked
   outside staff role, then "Another shift…" (the shift editor), so the rota can be filled from
   either view.
5. **The bar's counts are buttons that step to the next such slot**; zero counts are left out, and
   with none left it reads "All slots filled". A day needing attention says so under its date ("2
   unfilled"). A day with no paint and no hours reads "Closed" once, in its header.
6. **Empty weeks say why** ([board 3](mockups/a763-rota/03-empty-week.png)). An area with no paint
   for the week explains that slots come from staffing paint and offers "Paint {season}'s standard
   week" (the painter for that area, or the special day's editor on a special day) and "Show
   everyone"; shifts it already has show beneath, marked not needed. Show: Everyone with no shifts
   keeps everyone's rows with one line saying how to add one.
7. **The bar in each state** ([board 4](mockups/a763-rota/04-toolbar-states.png)). "Labour rules are
   not set up" becomes a quiet "No labour rules to check against" in the bar. A published week
   shows "Change this week"; a week being changed says "Staff still see the published week" and its
   button reads "Publish changes"; the open-swaps notice sits under the bar. Publish is always in
   the bar of a week that is not published, drawn quiet while the week has no shifts. Today it
   shows only once the week has a draft version, which its first shift creates
   (`packages/staffing/src/rota.ts:231-232`), and a draft whose shifts were all deleted still
   offers it. The warnings dialog is unchanged.
8. **Phone width: one day at a time** ([board 5](mockups/a763-rota/05-phone.png)), as A722's Week
   view: a seven-day strip marking days that need attention, the week arrows still stepping a week,
   the picker as a sheet from the bottom, Publish at the foot. Show: Everyone lists each person with
   that day's shifts; a tap opens the same open-slots menu.
9. **Staffing month: the Monday "Rota for this week" link goes**
   ([board 6](mockups/a763-rota/06-staffing-month.png); today the `rota-week` button in
   `staffing-month.ts`), so Monday's box is the same height as the others. The day box already offers "Rota for this week" on every
   day (A720 Part 5); it is still to state where that week's rota stands. The Rota tab opens the
   week of the day last picked in the month, else the current week.

## Decisions and deliberate limits

### Whole-day staffing overview (A710, owner 2026-10-16)

Keep both staffing painters at the whole-day scale without vertical scrolling. Short blocks use
their tooltip and block menu for the full name. The two existing “still showing the whole day”
tests stay unchanged; a later zoom/readability design remains open above.

### Named staffing guide bands (A724, owner 2026-10-15)

The season painter is headed “{season}: standard week”. A department's opening periods are named,
faded bands in their own colours, with their times at the top. Its paint row says “Shaded:
{department}'s opening hours, by period”. A prep station's guides show when it gets orders from the
period menus that route it dishes, from each period's start to last orders. Sending departments keep
separate, stable lanes, each band named by department and period. Staffing paint remains independent
of those guides. The [Part 1 plan](../superpowers/plans/2026-10-16-a724-staffing-guide-bands.md)
records the implementation and its verification checks.

### A585. Staff roles and rota planning

The [agreed design](../superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md) keeps the
owner's staffing and rota decisions. Plan shifts in Calendar → Rota, by area or by person. Each
assignment names an area and a staff role; own schedules show module descriptions, or no label
when no module describes a shift. The old Team Rota screen and free-text shift/template role are
retired in part 8. Reset pre-live venues for that contract change.


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
visible. The Calendar's Rota marks shifts with pending requests and asks before deleting a shift
or changing its person or time. Deleting an offered shift cancels its requests; deleting a return
shift removes that side of the offer. The shift editor states those separate effects. The
`changeRotaWeek` operation copies assignments in the same transaction as `copyPublishedToDraft`. See
[Task 7.2](../superpowers/plans/2026-10-13-a585-staffing-and-rota.md#task-72-changing-a-published-week).


### A585. A rota version and its business-day overflow

The approved [part 6 plan](../superpowers/plans/2026-10-13-a585-staffing-and-rota.md#task-61-the-rota-read)
settles the calendar-week/business-week difference: a week reads its version's shifts and unattached
shifts by local calendar date, then places each on its business day. An existing unattached shift
keeps that calendar week when edited. A local Monday 00:30 shift therefore appears under Not in a
slot on Monday's week, labelled as belonging to the previous week; the preceding Sunday's slot
remains unfilled. A shift filled from Sunday's slot instead attaches to that slot's authoring week.
This limit was reproduced during part 6 review and retained from the approved plan. Part 7's editor
must retain the overflow label; changing membership to the business week requires changing that
agreed rule. Published-week edits and deletion remain refused even for an unattached shift.

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

Optimise the remaining period paths with their cross-window
and frozen-history assertions intact; do not replace them with a bare event-time filter.

## A708. Special-day staffing on a date with its own changeover

The special-day staffing painter draws every date's column, and the blocks in it, on the read's one
`cutover`, which `readSpecialDayStaffing` (`packages/staffing/src/paint.ts`) takes from
`clock.dayCutover`: the location's baseline changeover, not necessarily the one in force on each
date. Each date's opening hours behind the paint (`resolveDepartmentsDays`) and the month's slot
count (`slotsForDay` in `packages/staffing/src/month.ts`, given `day.dayCutover`) use that date's
own changeover. So when a changeover change is scheduled, a block can be drawn longer than the
slots it produces. Opening hours' special-day painter draws from the first date's changeover and
says so when the dates' changeovers differ. Needs a
decision on how one grid with one time ruler shows dates with different changeovers.

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
  heading row; the style of the "which weeks it edits" line (`.covers`).
- The special-day painter takes its list of dates, and the dates in its heading, from the read's
  first area, as no top-level list exists in `SpecialDayStaffing`.

## Pay-period changes after closure

A January month closed with 480 minutes keeps that snapshot after the cadence changes to weekly.
For 1 February, `resolvePayPeriod` then returns 26 January–2 February; `closePayPeriod` refuses
that overlap with `pay_period.invalid`. The next whole week, 2–9 February, can close.

`setPayPeriodSettings` currently has no application caller. Hours follows the
approved read contract: a date inside a saved closure uses that stored period; otherwise it uses
the configured cadence. Its totals describe the printed date range, and reading creates no closure.

Before adding cadence editing, decide how the first partial period follows a closed period.
Keep saved periods and snapshots intact. The
[owner's cadence rule](#pay-period-cadence-after-closure-owner-2026-10-15) applies to that editor.

## Frozen-summary name collection

The current closure writer derives
summary subjects from frozen entries (`pay-period-close.ts:144`); no valid summary-only fixture
was established in the review. Keep the defensive collection and qualify a supported snapshot
shape before adding a case for it. This is a test gap, not an observed incorrect exported name.

## PDF boolean and empty values

The PDF currently prints scalar values as `null`, `true` and `false`, including in Spanish. The
reviewed serializer contract and its tests retain these spellings. Decide readable localized PDF
wording separately, keeping CSV's scalar spellings stable; no legal-field or writer change is implied.

## The Spanish working-time record prints English words and internal codes

Seen in A980 S2b's look at the PDF and CSV the working-time export builds: the Spanish files print
"Versión: standard", the access holders as the codes `trabajador`, `representantes_legales` and
`inspeccion_trabajo`, "Evento: in/out", "Tipo de autor: worker", and raw `true`, `false` and
`null` values (`null` in the English files too, see the section above); the English CSV prints the
access holders as words. Files: `apps/server/src/attendance-export-pdf.ts`,
`apps/server/src/attendance-export-csv.ts` and `packages/workforce-es/src/`. This predates A980
S2b (#1750, #1975). Print each value in the file's language.

## Rota warning query boundaries

The warnings cases exercise the separate JavaScript filter's local dates. Add fixtures at
the previous week's first local Monday and the next week's last local Sunday, where the SQL
selection decides whether the neighboring week is represented for weekly rest. Retain the existing
offset and location assertions; require the UTC-query mutation to fail. The route currently keeps
the offset-aware query. This is a test gap, not an observed wrong answer from that query.

## Roster browser-entry re-exports

The browser-entry guard accepts runtime re-exports such as `export { readFileSync } from "node:fs"`.
A direct Node import fails the source guard. Extend the guard to runtime re-exports and test that negative control. This follow-up concerns what the text guard would fail to catch in a later edit.

## Staffing paint in calendar delete confirmations

The A585 design left the count of staffing paint out of the season and special-day date deletion
confirmations (open point 7); the Seasons window's delete note, which replaced the season
confirmation in A721, leaves it out too. Decide whether to add a shared deletion-impact seam, so
venue-service can ask contributing modules for that count, or deliberately keep both without it.

## A763 point 9. The Staffing month's Monday "Rota for this week" link goes

**Owner, 2026-10-16.** Waits for the second part of [A724](#named-staffing-guide-bands-a724-owner-2026-10-15), which has not landed. The owner's point, as written:

> **Staffing month: the Monday "Rota for this week" link goes**
> ([board 6](mockups/a763-rota/06-staffing-month.png); today the `rota-week` button in
> `staffing-month.ts`), so Monday's box is the same height as the others. The day box already
> offers "Rota for this week" on every day (A720 Part 5); it is still to state where that week's
> rota stands. The Rota tab opens the week of the day last picked in the month, else the current
> week.

## A699. The Staffing month keeps its own copy of month stepping, and staffing its own date formatting

`stepMonth` and the first and last month in
`packages/staffing/src/dashboard/staffing-month.ts` are a third copy beside
`add-dates-calendar.ts` and `opening-hours-month.ts` in `packages/venue-service/src/dashboard/`,
and the cached `dateFormat` in `packages/staffing/src/dashboard/format.ts`, which the month and
both staffing painters use, copies `hours-view.ts`'s (the season tints are
already shared through `@waitron/venue-service/dashboard/season-tint`). The same file's
`dateAroundDay` repeats `hours-view.ts`'s, taking a formatter where that one takes format options,
because venue-service's `exports` map does not include `hours-view.ts` (A775). A763 added more
copies of venue-service code that the map does not make reachable: `weekTitleParts` in `format.ts`
(of `formatWeekTitleParts`, `hours-view.ts`); `rota-popup.ts`'s follow-and-close logic (private to
`CalendarDayBox` in `calendar-day-box.ts`, a file the map exports; the rota's version also places
once per frame and again when its own size changes, which `CalendarDayBox` does not), with its own
`flatParent` and `scrollTargets` (of `flat-tree.ts`, which the map does not export); and `rota-view.ts`'s
swipe with `SWIPE_PX` and `PHONE_WIDTH` (of `opening-hours-week.ts`). Next: move `stepMonth` and the
limits, and these, into browser-safe venue-service files and export them.

## A586. Each person's contract terms

**Owner, 2026-10-22.** Kept per person, because one venue can hold different contracts:

- pay per hour;
- contracted hours a week, and the most extra hours a week;
- the days-off pattern: two days together, a day and a half together, or one day plus another day
  (or plus a half day) elsewhere in the week;
- whether they work split shifts, and the most hours they work in one stretch;
- annual holiday, in days;
- for someone who starts in Waitron partway through a year: when they started work, the hours
  worked so far this year and the holiday days taken, so the hours still due can be counted.

**Two kinds of rule (owner, 2026-10-22).** The terms above are the same for staff anywhere, so
they are generic workforce data. Other rules depend on the country, such as Spain's 10% of the
year's hours that may be moved (below): those come with the country pack, as ready-made rule sets
the person's contract takes, holding limits such as the most hours a week and a day, rest between
shifts, weekly rest, breaks and the yearly overtime cap. Today these are
one `convenio_config` row per location (`packages/workforce-es/src/schema/convenio-config.ts`);
moving them per person reaches every reader, so start from `packages/workforce/src/ruleset.ts` and
grep `convenio`. Still to decide: whether the owner can change a ready-made set or only pick one,
and which sets ship first.

Then a running total of hours worked and rostered against hours due, holiday counted
([spec open point 6](../superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md)).

**The owner's planning questions, with what Spain's Workers' Statute says.** Quoted from the
consolidated text (BOE-A-2015-11430, last updated 21/10/2026), fetched 2026-10-22. These are for
the labour advisor to confirm: a collective agreement can change each of them.

- **More hours in summer, fewer in winter.** Art. 34.2: «En defecto de pacto, la empresa podrá
  distribuir de manera irregular a lo largo del año el diez por ciento de la jornada de trabajo»,
  respecting the minimum daily and weekly rest, and «el trabajador deberá conocer con un preaviso
  mínimo de cinco días el día y la hora de la prestación de trabajo resultante». The differences
  «deberán quedar compensadas en el plazo de doce meses». So, unless an agreement says otherwise:
  10% of the year's hours may be moved, with five days' notice of the new times.
- **How much the rota can be rearranged.** The same five days' notice for moved hours; at least
  twelve hours between one day's work and the next, and no more than nine ordinary hours a day
  unless an agreement says otherwise (art. 34.3); weekly rest of «día y medio ininterrumpido»,
  which can be added up over periods of up to fourteen days (art. 37.1).
- **Overtime repaid as time off, so quiet shifts become time off and busy ones are staffed.**
  Art. 35.1: an agreement or the contract chooses between paying overtime and «compensarlas por
  tiempos equivalentes de descanso retribuido»; with no agreement, overtime «deberán ser
  compensadas mediante descanso dentro de los cuatro meses siguientes». Art. 35.2: overtime repaid
  as rest within those four months does not count against the 80-hour yearly cap.
- **Annual holiday is not the same tool.** Art. 38.1: at least «treinta días naturales», and it
  cannot be paid out instead of taken; art. 38.3: the person knows their dates «dos meses antes, al
  menos». So annual holiday can be planned into quiet seasons, but not moved shift by shift the way
  time off for overtime can.

## A851. Staffing reads the venue's first business-day start, not the one in force (found by A788's design)

`currentCutover` (`packages/staffing/src/paint.ts`), the paint, route, rota and month
reads use `clock.dayCutover`, the venue's first start; since dated start changes landed (#1563)
a venue that changes its start sees staffing on the wrong boundary. Read the start in force for
each date instead, with a test that changes the start and checks the painter and the Staffing
month. Detail: A788's design, `docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md`
("The staffing painters read the venue's first start").

## A780. The staffing painters read holder names they never show (left open by #1828)

Both
staff-role feeds (`staff-roles` and `painter-staff-roles`, `packages/staffing/src/dashboard/client.ts`)
read `GET /management-api/staffing/staff-roles`, which always looks up every holder's name
(`listStaffRolesWithHolderNames`, `packages/staffing/src/staff-roles.ts`). The painters use only
each role's name, colour and holder ids. Give the painters a read without the names (a query
parameter or a second route), keeping the Staff roles list's.

## Nothing in the product closes a pay period

(found by A793's design, read). The workforce
module's `closePayPeriod` (`packages/workforce/src/pay-period-close.ts:76`) is called only by test
files (among them the fixture `apps/server/test/attendance-export-fixture.ts:77`); no route,
scheduled duty or screen calls it. A793's slice 6 (tips frozen with the pay period) waits for one. Next: decide
with the owner who closes a period and when (a manager's button, or automatically once it is
due), then build it.

## Loose ends left by A585-7 (#1766)

- Copy rota assignments in one read: `changeRotaWeek` reads an assignment per copied shift.
  Measure a large week under the venue write queue, then batch that read while preserving the
  shift-id map and rollback checks. Query cost is unmeasured.
- Reuse the rota picker's baseline labour checks: `candidateWarnings` validates the unchanged
  week once per candidate on each redraw. Measure a large picker, then share that baseline across
  its candidates without sharing candidate-specific warnings. Cost unmeasured.
- The dashboard live-query guard misses inline dependency lists: `scripts/live-subscriptions.test.ts`
  reads `live-queries.ts` declarations, not inline lists in `client.ts`. Add a guard that refuses inline lists and a failing control.

## A700. A failed Opening hours read also hides the Calendar's other views

A module view draws
only once the page's own model loads (`render` in
`packages/venue-service/src/dashboard/opening-hours-screen.ts`), so a person who only wanted the
Staffing view sees the switch and the Opening hours error instead. Next: decide whether a
module view draws without that model.

## A701. Opening hours' month reads the holiday tables twice on a holiday-linked special day

`readOpeningHoursMonth` (`packages/venue-service/src/opening-hours-calendar.ts`) reads `tenants`
and `holiday_geographies` once in `readCalendarMonthPlan` and again in its own holiday read
(`locations` is already read once). Next: hand the plan's holiday facts to the
second read.

## A702. Opening hours' season chip is clipped on a season name that is one long word

Next: wrap the chip's text with `overflow-wrap: anywhere` (`packages/venue-service/src/dashboard/season-chips.ts`).

## At 390 px the staff role dialog's open colour panel covers its own Colour field

Picking a colour still works. See `positionPopup` in
`packages/ui/src/components/wt-colour-chooser.ts`.

## A colour chooser left open while its window narrows may hide the chosen colour

Read from
the code by A783's finish-branch re-read on 2026-10-18, not measured: open on the last colour in a
wide window short enough that two columns would scroll but four do not, then narrow it until two
columns are needed; the resize re-places the panel at the same scroll position and nothing scrolls
the chosen tile into view (`positionPopup` in `packages/ui/src/components/wt-colour-chooser.ts`).
Next: try it, and if it shows, keep the focused tile in view after the columns change.

## A644. Staffing slots stop at minute 1440 on a business day longer than a day

When the
changeover moves later between two days (02:00 one day, 04:00 the next), that business day runs 25
hours, but `slotsForDay` (`packages/staffing/src/slots.ts`) ends every slot by minute 1440, so no
block can ask for anyone in the last hour, while `placeShift` can place a shift there. Next: decide
whether a block may run to the day's real end.

## A707. On a phone, a paint grid's block menu or Copy to… chooser can cover the block it belongs to

`placePopover` (`packages/venue-service/src/dashboard/paint-grid-parts.ts`) moves a menu that
does not fit below its trigger up over it. The staffing grid's block editor opens above its
block when it fits there and not below; with room on neither side it still covers the block, and
at 390 px the wide editor can cover blocks in the next column (A761's look, 2026-10-17). Opening
hours' block menu and the Copy to… chooser have no such placement. Next: place them above or
beside the block instead.

## A588. A solver drafts the rota, as a paid Waitron Cloud feature (owner, 2026-10-22)

Fills
A585's open slots from each person's staff roles, contract terms (A586), availability and
preferences (A587), for the manager to adjust. It runs in Waitron Cloud, not on the box; the
owner's choice of engine is Google's OR-Tools (its CP-SAT solver, Apache 2.0 licence), which
takes rules that must hold and preferences to honour where it can. What the box sends is staff
personal data, so it belongs in A980's data map. Waitron Cloud's backlog needs the matching
entry. After A587.

## Wages / labour cost (SP16)

A per-person pay-rule set (hourly or fixed salary for N contracted
hours, rate overrides by condition of the hour, paid non-worked states) turning recorded and
scheduled hours into accrued-versus-pending money. Rates are editable data, never hardcoded convenio
numbers; needs public holidays for every year it pays (today only 2026 exists), national,
regional and local. Gated on the labour advisor; not fiscal.

## A link look for `wt-button` (left open by #1841).

The Rota's picker and open-slots menu draw
"Show everyone" and "Another shift…" as underlined links by restyling a `wt-button` locally
(`slot-picker.ts`, `open-slots-menu.ts`). A `link` variant on the shared button would replace both;
it changes a shared primitive, so it needs its token-painting and a11y tests.

## Staffing's day box: each area's staff roles and times.

The box lists each area's number; the
mockup's role names and times ("Head chef ×1 16:00–01:30") need the month read to carry each
block. Decision 13 of the [A720 plan](../superpowers/plans/2026-10-15-a720-calendar-year-month.md),
[mockup](mockups/a718-a727-calendar-and-stations/10-staffing-month.png).

## The Rota shift routes read a null or malformed JSON body as an empty object.

For no body, `{` and `null`, `POST …/rota/shifts` answered 400 with `field: "week"` and
`PATCH …/rota/shifts/:shiftId` 404 `shift.not_found` for an unknown id, neither naming `body`
(A750's probe, 2026-10-16). Next: swap `readJsonBody` for `readRawJsonBody`, as change-week did.

## A587. Availability and personal preferences

"can't work Wednesdays"; "Anna only works
mornings, Monday to Thursday" (owner, 2026-10-22). A preference warns as a broken rule does, in
words that say it is the person's preference, not their contract. The `availability` table
exists unused. Shown in A585's picker and warnings. After A586.

## Decisions and deliberate limits

### Pay-period cadence after closure (owner, 2026-10-15)

A future cadence editor refuses a change after the first closed period until the owner approves
a transition rule. Leave this work in the backlog until that editor is built.

### Labour rules are ready-made sets chosen per person, and they warn, never refuse (owner, 2026-10-22)

Waitron does not keep up with or enforce the labour law of every country or region. Terms that
are the same for staff anywhere are generic; rules that depend on the country come with the
country pack as ready-made rule sets, and the owner chooses one for each person's contract. A
broken rule, or a
broken personal preference (A587), is a warning; neither stops a shift being planned or a rota
being published: "some labour laws are unworkable and it would be impossible to run a business
while obeying all of the laws."

### A703. Keeping a Calendar view's address words stays a special case named in the app (owner, 2026-10-17)

`apps/dashboard/src/navigation.ts` names `opening-hours` in `keepUnlisted`
(`packages/ui/src/url-state.ts`), and the screen re-reads and re-builds the path itself
(`moduleParams`, `calendarViewPath`). The owner kept it as it is, turning down the two general
forms A585-3's review offered: keep unknown pairs for every destination while it stays the same,
or let a screen's own address config declare a destination open-ended and hand back its unknown
pairs.

### Whole-day staffing overview (A710, owner 2026-10-16)

Keep both staffing painters at the whole-day scale without vertical scrolling. Short blocks use
their tooltip and block menu for the full name. The two existing “still showing the whole day”
tests stay unchanged; a later zoom/readability design remains open above.

### Named staffing guide bands (A724, owner 2026-10-15)

The season painter is headed “{season}: standard week”. A department's opening periods are named,
faded bands in their own colours, with their times at the top. Its paint row says “Shaded:
{department}'s opening hours, by period”. A prep station's guides show when it gets orders from the
period menus that route it dishes, from each period's start to its end. Sending departments keep
separate, stable lanes, each band named by department and period. Staffing paint remains independent
of those guides. The [Part 1 plan](../superpowers/plans/2026-10-16-a724-staffing-guide-bands.md)
records the implementation and its verification checks.

### A585. Staff roles and rota planning

The [agreed design](../superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md) keeps the
owner's staffing and rota decisions. Plan shifts in Calendar → Rota, for one area or for everyone
(A763, 2026-10-17). Each
assignment names an area and a staff role; own schedules show module descriptions, or no label
when no module describes a shift. The old Team Rota screen and free-text shift/template role are
retired in part 8. Reset pre-live venues for that contract change.

In one area the rota does not show a person's weekly labour warnings (weekly maximum, overtime
cap, weekly rest), which have no cell there; the bar's labour count and the publish dialog still
include them, and Everyone shows them under the name (A763, 2026-10-17). A rota day's header reads
"Closed" when no active department opens that day, whichever area is shown, and the shown area (or
Everyone) has no slot that day (`isClosed`, `packages/staffing/src/dashboard/rota-model.ts`; A763).
The Rota's bar takes two rows when the view is narrower than its words: its end (the state, the
counts, the labour line and Publish) wraps whole onto a second line. The words are kept rather than shortened (A763).

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
The approved plan retains this limit. Part 7's editor
must retain the overflow label; changing membership to the business week requires changing that
agreed rule. Published-week edits and deletion remain refused even for an unattached shift.

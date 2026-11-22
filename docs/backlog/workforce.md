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

## A708. Special-day staffing on a date with its own changeover

The special-day staffing painter draws every date's column, and the blocks in it, on the read's one
`cutover`, which `readSpecialDayStaffing` (`packages/staffing/src/paint.ts`) takes from
`clock.dayCutover`: the venue's baseline changeover, not necessarily the one in force on each
date. Each date's opening hours behind the paint (`resolveDepartmentsDays`) and the month's slot
count (`slotsForDay` in `packages/staffing/src/month.ts`, given `day.dayCutover`) use that date's
own changeover. So when a changeover change is scheduled, a block can be drawn longer than the
slots it produces. Opening hours draws one-off special days with a ruler in each column when
the dates' changeovers differ. Staffing special-day saves validate blocks against the first start (`packages/staffing/src/routes.ts`, `cutoverOf`).

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

## A586. Each person's contract terms

**Owner, 2026-10-22.** Kept per person, because one venue can hold different contracts:

- pay per hour;
- contracted hours a week, and the most extra hours a week;
- distinguish complementary hours for part-time staff from overtime when applying those terms.
  Today's PDF shows target excess without making that legal classification; the
  [labour research](../compliance/research/2026-11-06-adviser-labour.md#part-time-staff-l210-answered)
  records the open distinction;
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
one `convenio_config` row (`packages/workforce-es/src/schema/convenio-config.ts`);
moving them per person reaches every reader, so start from `packages/workforce/src/ruleset.ts` and
grep `convenio`. Still to decide: whether the owner can change a ready-made set or only pick one,
and which sets ship first.

A586 also owns the yearly-hours ceiling and rota warning, and distinguishing overtime from complementary hours.

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

## Nothing in the product closes a pay period

(found by A793's design, read). The workforce
module's `closePayPeriod` (`packages/workforce/src/pay-period-close.ts:76`) is called only by test
files (among them the fixture `apps/server/test/attendance-export-fixture.ts:77`); no route,
scheduled duty or screen calls it. A793's slice 6 (tips frozen with the pay period) waits for one. Next: decide
with the owner who closes a period and when (a manager's button, or automatically once it is
due), then build it. Also decide how a later paid-break policy change affects the comparison with a saved closure; keep the saved totals intact.

## A644. Staffing slots stop at minute 1440 on a business day longer than a day

When the
changeover moves later between two days (02:00 one day, 04:00 the next), that business day runs 25
hours, but `slotsForDay` (`packages/staffing/src/slots.ts`) ends every slot by minute 1440, so no
block can ask for anyone in the last hour, while `placeShift` can place a shift there. Next: decide
whether a block may run to the day's real end.

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

## A587. Availability and personal preferences

"can't work Wednesdays"; "Anna only works
mornings, Monday to Thursday" (owner, 2026-10-22). A preference warns as a broken rule does, in
words that say it is the person's preference, not their contract. The `availability` table
exists unused. Shown in A585's picker and warnings. After A586.

## Bundle: Staffing reads the day start in force on each date

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A644. Staffing slots stop at minute 1440 on a business day longer than a day.** Decide whether
  a block may run to the day's real end.
  [Detail](workforce.md#a644-staffing-slots-stop-at-minute-1440-on-a-business-day-longer-than-a-day).
- **A708. The special-day staffing painter draws every date on the venue's baseline changeover,
  while each date's opening hours and staffing slots use that date's own.** Needs a decision on
  how one grid shows dates with different changeovers.
  [Detail](workforce.md#a708-special-day-staffing-on-a-date-with-its-own-changeover).

## Bundle: Give the built close step a caller, then its cadence rule

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Nothing in the product closes a pay period** (found by A793's design, read). A793's slice 6
  (tips frozen with the pay period) waits for one. Decide with the owner who closes a period and when.
  [Detail](workforce.md#nothing-in-the-product-closes-a-pay-period).
- **Pay-period cadence changes need a rule after closure.** A future editor refuses changes after
  the first closed period until the owner approves a transition rule (owner, 2026-10-15); leave it
  in the backlog until then.
  [Receipt and next step](workforce.md#pay-period-changes-after-closure).

## Decisions and deliberate limits

- Hours keeps the full history for a person with a correction awaiting a decision, to check
  whether it can still be applied. Open shifts, disputed corrections, unanswered questions
  and unconfirmed automatic clock-outs can appear in any selected period (watcher, 2026-11-18).

- Season staffing uses the start in force when the season runs (owner, 2026-11-16, “1” in the watcher window). The Calendar month selects the occurrence; stepping to an absent season selects its next occurrence (driver choice, watcher cleared 2026-11-16). One grid uses the first matching date's start and notes later changes; changed weekdays must fit every applicable start. Crossing blocks are marked before saving (watcher, 2026-11-16). Special days and longer-than-day staffing remain A708/A644.

### A1268 corrections after a backward clock step

The owner chose “Small fix (Recommended)” in the watcher window on 18 November 2026 at 10:13 CET,
as recorded in Lane I’s questions. A correction can go through when the worker’s record already
contains a sequence fault. Waitron still refuses a new fault introduced by the correction,
including a retime that leaves a completed shift open. A missing shift in the gap
after a reversed shift can still be refused when the reversed shift's clock-in looks open
(watcher, 18 November 2026 at 11:31 CET).

Hours still pair by the recorded times. A shift whose clock-out sorts before its clock-in can be
missing from hours until you correct the recorded time.
This is the delivered scope for [A1268 §4](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/specs/2026-11-01-a1268-clock-ins-per-venue-design.md#4-part-2--readings-that-order-entries-by-time-after-a-backward-clock-step).

### First and latest staff activity per planned shift (owner, 2026-11-15)

The owner said “all we need to know is the time of the first user action and the latest user action”
and “We definitely do NOT need to record every action immutably”; when the watcher proposed keeping
those times per planned shift, the owner answered “sounds good” (Lane H `queue.md`, copied from the
watcher's window at about 21:10–21:17). This overrides A1543's Keep for the two attendance-copy tables.

`staff_activity` keeps first/latest instants per person and captured planned shift, or per gap between
shifts; without a rota it keeps a person/day pair. Clock-ins, clock-outs and corrections stay in the
legal record. Under the watcher-cleared plan, payment attempts count when staff start them, including failed attempts; outcome and
recovery workers add no staff activity. The checker reads these endpoints and legal clock entries,
not per-action history or source-table discovery. Earlier endpoint detail is deliberately unavailable.
The implementation and remaining log-retention work are in the
[DB-GROWTH plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-db-growth.md).


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
of those guides. The [Part 1 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-16-a724-staffing-guide-bands.md)
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
[plans](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-15-a10-6-record-export-plan.md).

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
`changeRotaWeek` operation uses `copyPublishedToDraft` to copy each shift with its job role and area. See
[Task 7.2](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-13-a585-staffing-and-rota.md#task-72-changing-a-published-week).

### A585. A rota version and its business-day overflow

The earlier [part 6 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-13-a585-staffing-and-rota.md#task-61-the-rota-read)
read both a version's shifts and unattached shifts by local calendar date.
**2026-11-17, A1308 pp7:** every shift now belongs to a rota week; a week reads its selected
version's shifts and places each on its business day. Editing a shift keeps that week. A local
Monday 00:30 shift on Monday's week therefore appears under Not in a slot, labelled as belonging
to the previous week; the preceding Sunday's slot remains unfilled. A shift filled from Sunday's
slot instead belongs to that slot's authoring week. The editor keeps the overflow label;
changing membership to the business week remains a separate decision. Published-week edits and
deletion remain refused.


### Paid breaks and split warnings (A1406-2, owner 2026-11-08)

The first venue configures continuous-break credit separately from the existing split-break flag.
Annual limits and their rota warning remain with A586. Changes to a policy after a saved closure
remain with the future closure decision above.

The additive migration leaves existing agreement values in place; configure the new policy with
the [first-venue recipe](../operations/first-venue-work-time.md).

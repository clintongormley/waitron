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
`packages/workforce/src/clocking.ts`. Correction routes and screens remain open.

Left, as the legal minimum:

- end-of-day automatic closure and the worker questions it creates;
- correction requests and their approval, as routes and screens;
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
pay-period closure, scoped frozen records and the Spanish history export. The correction and export libraries still have no staff-facing route or screen. Reset/reseed old workforce venue folders before installing the nullable-recorder
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

Part 3 has a reviewed [end-of-day plan](../superpowers/plans/2026-10-14-a10-3-end-of-day-plan.md).
The part-3 branch has a library processor for automatic finishes, missing-time questions, overnight
wake-ups and late clock/rota reconciliation. Its tests retain a question when there is no later
activity or existing clock history conflicts with an automatic finish. On this branch, reading your
clock state or submitting a clock action reconciles your open completed day first. A stale action is
refused after committing the automatic finish. This worker-only pass leaves the shared day's work
pending for a complete background pass. A loop helper processes one completed day per pass and waits
for its active pass on shutdown. The missing-time reminder helper rechecks current clock and rota
evidence before claiming, snapshots the saved email rather than a pending replacement, and sends
outside the write transaction. SMTP acceptance and uncertain delivery suppress another automatic
attempt; an explicit refusal waits fifteen minutes before retrying. An abandoned claim becomes
uncertain after sixty seconds. SMTP acceptance does not establish inbox delivery, and restoring an
older backup can lose the sent marker and permit a duplicate. Writable workforce primaries start
both duties and begin a fresh discovery generation at each open. Setup, mirror, fenced, secondary
and workforce-disabled boots start neither duty. Failure unwind and normal close abort and await
the duties before closing their database handle. Place/cancel till routes forward the amendment
recorder. Invoice choice, receipt language and cancellation/comp/discount commands also capture the
admitted worker and trusted instant in their write transaction. The route tests check capture refusal
rolls back those commands and that repeated submissions create no later activity. Direct line
course/send/recall and make-at changes, preparation and pass transitions, serving, station moves and
handover also capture the admitted worker. Their route tests check rollback on capture refusal,
replays and unchanged commands, while device-only work records no worker activity. A group spanning
two bills records each affected bill at one trusted instant. Bill and party command scopes keep
separate activity identities even when their submission ids match. The retained group-command audit,
restore-path qualification and final branch checks remain open; part 3 is unfinished.

My hours stays with part 5; no placeholder is offered in part 2. Parts 3–6 remain open: automatic
closure/questions, corrections, hours and the export/access screens. The period-read cost and the
correction waiting-list follow-ups remain in the backlog.

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

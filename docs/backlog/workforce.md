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

- answering automatic-finish and missing-time questions at sign-in;
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

Part 3 connects the [end-of-day checks](../superpowers/plans/2026-10-14-a10-3-end-of-day-plan.md).
A forgotten clock-out closes at your last later sign-in, order, accepted payment or break activity
in that business day. Without later activity, the shift stays open and a question records the missing
time. A published rota shift without a clock-in, or till work without a clock-in, also creates a
question. Automatic ends count immediately; their questions wait for the response screens in part 4.
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

My hours stays with part 5; no placeholder is offered. Parts 4–6 remain open: answering questions,
corrections, hours and the export/access screens. The period-read cost and correction waiting-list
follow-ups remain below.


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

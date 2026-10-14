# Working time and staff — detail

The open entries are listed in [the backlog](../backlog.md), under "Working time and staff". This file holds
their full text.

## A10. Clocking in and out — the working-time record

**Staff cannot clock in or out today.** The _registro de jornada_ is a legal duty from the first day
the deli employs anyone ([design](../superpowers/specs/2026-07-22-workforce-and-time-record-design.md)).
Built: the append-only, hash-chained time entries (per node since #268), contracts, the daily
projection of worked time, correction requests and approvals, the Spanish export
(`packages/workforce-es`), and the rota, absences, swaps, planned-versus-actual view and staff portal.
But `clockIn`, `clockOut`, the break events and the correction functions in
`packages/workforce/src/clocking.ts` have no caller outside the package:
`apps/server/src/workforce-api.ts` serves the rota and says it is "plumbed ahead of a clock-in
route". So the planned-versus-actual view has no actual hours to compare.

Left, as the legal minimum:

- a till clock-in and clock-out screen and its routes;
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

Part 1 adds missing-entry corrections, worker and manager decisions, immediate confirmed automatic
hours with a separate worker acknowledgment, stored admin-only self-approval (owner, 2026-10-14),
pay-period closure, scoped frozen records and the Spanish history export. The library has no new
route or screen yet. Reset/reseed old workforce venue folders before installing the nullable-recorder
constraint migration (owner decision, 2026-10-13). The populated old-record migration test checks
the refused rebuild and unchanged rows/head after rollback; the empty old-schema test upgrades.


Part 2 has a reviewed [till-clocking plan](../superpowers/plans/2026-10-14-a10-2-till-clock-plan.md).
Implementation has not started; parts 2–6 remain open.

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

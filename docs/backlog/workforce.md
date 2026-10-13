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

Part 1 is in progress on `feat/a10-1-record-library`. Its schema, correction and automatic-entry
methods, and record reads are implemented locally. Pay-period closure, configuration transfer and
the Spanish history export remain, followed by the full branch review and current-head CI. The
library has no new route or screen yet.

A10-1 library checkpoint: rich reads now include frozen pay-period snapshots and later changes,
with worker-scoped snapshots and summaries. Period closing and the rich Spanish export remain in
this branch; the library is not ready for owner review.

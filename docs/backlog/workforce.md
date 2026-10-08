# Working time and staff — detail

The open entries are listed in [the backlog](../backlog.md), under "Working time and staff". This file holds
their full text.

## A shift that runs past midnight (22:00–02:00) is refused as `shift.invalid`

- **Shift times are stored in one spelling — DONE (W22, #1134); left open,** found by #1134's
  review and not taken there: the dashboard's shift dialog
  (`apps/dashboard/src/widgets/shift-dialog.ts`) builds the end time on the START's day, so a
  shift that runs past midnight (22:00–02:00) is refused as `shift.invalid` — as it was before
  #1134. And an edit keeps the shift's stored offsets, so moving a shift across a summer-time
  change keeps the old offset. Next action: let the dialog put the end on the next day when it
  is not after the start, and derive each offset from the venue's time zone for the date.

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
format. **Before building, ask the labour
advisor** whether the digital-registro decree is in force and which fields it requires
([asesor-laboral-questions.md](../compliance/asesor-laboral-questions.md)). The time record cannot be
edited once written, so its chain and correction paths take the owner's sign-off at land.

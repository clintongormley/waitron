# Service periods, opening hours and departments — detail

The open entries are listed in [the backlog](../backlog.md), under "Service periods, opening hours and departments". This file holds
their full text.

## Service times, departments, zones and prep stations (A366, owner 2026-10-07) — SPEC APPROVED 2026-10-07

- **Service times, departments, zones and prep stations (A366, owner 2026-10-07) — SPEC
  APPROVED 2026-10-07; slice 1 plan approved and queued in campaign lane D (A366-1, then
  A366-2 … A366-7, each planned then built without stopping for the owner)**
  ([slice 1 plan](../superpowers/plans/2026-10-07-a366-slice-1-service-periods.md); slice 2 plan
  written ahead: [slice 2 plan](../superpowers/plans/2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md)). Opening hours and the menu timetable become one idea: a period is
  a name with one customer menu plus staff-only menus, a department's day is time ranges each given
  a period, and the till sells only the current period's menus. Zones can be closed for part of
  their department's time; prep stations lose their hours and fallbacks; routing cells can name
  periods; a printer shared by stations prints one combined ticket; watchers become monitors on
  device profiles; receipts move to departments with translated text.
  [Spec](../superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md); §13 is
  the seven-slice build order and §15 the defaults the owner accepted. It replaces A254 §4, A261
  §4–§7 in part, and §2 of the devices, menus and service zones spec; it folds in S11.
  Slice 5's plan is written ahead of lane D (A366-5p, 2026-10-08): [slice 5 plan](../superpowers/plans/2026-10-08-a366-slice-5-monitors.md),
  in two pull requests — monitors after slice 1, watcher printers retired after slice 4 — with its
  open decisions for the owner at its top.
  Slice 7's plan is written ahead of lane D too (A366-7p, 2026-10-08): [slice 7 plan](../superpowers/plans/2026-10-08-a366-slice-7-receipts-per-department.md),
  in two pull requests — each department's receipt with translated subtitle and footer after
  slice 1, the department page's Receipt tab after slice 6 — with its open decisions at its top.

## Departments, service styles and opening hours (A254, owner 2026-10-03) — DRAFT SPEC, partly implemented through A261

- **Departments, service styles and opening hours (A254, owner 2026-10-03) — DRAFT SPEC, partly
  implemented through A261.** The first department is named after the venue; the
  four-value service style splits into separate settings, and a tab no longer needs a table; hours
  come from venue-wide day types plus a calendar; a per-department switch prints the trading name.
  [Spec](../superpowers/specs/2026-10-03-departments-service-styles-hours-design.md); §6 lists what is
  open, including advisor questions Q21, Q14, Q27 and Q22.
  Its §4 day types and §5 placement are revised by A261. A261 step 2 names the sole department on
  Departments and zones; other screens still await their own one-department survey. Tab billing
  remains open; the shared calendar is built by A261 step 5 (below), and its public holidays by
  step 6.

# A718 — Departments and zones: a column for the receipt and floor plan, a trimmed zone editor

Spec: backlog entry A718 (`docs/backlog.md`) and its detail in `docs/backlog/service-periods.md`
("## A718."), mockup `docs/backlog/mockups/a718-a727-calendar-and-stations/12-departments-and-zones.png`.
The owner reviewed the entry and mockup (2026-10-15); there are no open questions.

Review path: LIGHT. No stored record, route, migration or shared `wt-*` primitive changes; the
change is two screens in `packages/venue-service/src/dashboard/`. Lane A's open A720 branch shares
only `strings.ts` with this one (different keys).

## Decisions taken here (recorded in the PR)

- **Column heading:** "Also edit" / «Editar también», as drawn. Column key `also` (never `actions`:
  `scripts/pinned-actions-column.test.ts` holds every `key: "actions"` to the row-menu rule).
- **Link labels:** the mockup's shorter words. Department: "Receipt" / «Recibo». Zone: "Floor plan" /
  «Plano de sala», or "Add floor plan" / «Añadir plano de sala» once the zone's plan is read and has
  no placed table (`placedTables`, `client.ts`). While the plan has not been read, or its read failed,
  the link reads "Floor plan" — the rule the zone editor used ("while the plan loads the link reads
  Edit floor plan"); the link goes to the same place either way. A failed read shows no alert in the
  cell: the link still works and the watch retries.
- **Each shown zone row watches its own floor plan** with the existing `api.watchZoneFloorPlan`
  (one passive GET per zone, re-run on a floor-plan change), released when the row goes, the api
  changes or the list disconnects. The alternative — a placed-table count on `GET
  /management-api/zones` — changes a route and its other readers; not taken.
- **The zone row menu loses its floor-plan link too**, along with its plan watch and load alert:
  the column replaces it, as it replaces the department menu's Edit receipt (spec point 4). The
  spec names only Edit receipt; this is the symmetric reading, said in the PR and as an FYI in the
  lane's questions file.
- **The receipt link** keeps `data-test="receipt-department-<id>"` and the `edit-receipt` event, so
  `apps/dashboard/src/dashboard-app.test.ts` ("the receipt row menu navigates…", "Settings hides…")
  and `departments-list.test.ts`'s event table pass unchanged. It is an `<a>` with
  `href="/manage/venue-operations/department/<id>/view/receipt"`, `data-own-click`, and the name
  link's plain-click handling (modified clicks follow the href). Shown only where
  `receiptAvailable(row)` is not false — the same condition the menu item used.
- **The floor-plan link** keeps `data-test="floor-plan-zone-<id>"` and its href
  (`/manage/floor-plan/zone/<id>?back=%2Fmanage%2Fvenue-operations`), with `data-own-click`.
- **Removed with the zone editor's season sentence:** `zone-closed-week.ts` (its only consumer is
  `zone-edit-dialog.ts`) and every string key only it or the removed markup read. Grep each key
  across `packages/` and `apps/` before deleting it.

## Task 1 — Departments list: no column picker; the "Also edit" column

Files: `departments-list.ts`, `strings.ts`, tests beside them (`departments-list.test.ts`,
`departments-zones-list.test.ts`, `departments-list.a11y.test.ts`; add cases where they fit).

Test first (real Chromium, `pnpm --filter @waitron/venue-service exec vitest run <file>`):

1. No column chooser: the table's shadow root has no customise-columns control (find the selector
   `wt-data-table` uses for it; it renders only when some column is `choosable`, `wt-data-table.ts`
   ~2909). Then remove `choosable` from the three policy columns and the now-unused customise/column
   label properties on `<wt-data-table>`.
2. A department row's "Also edit" cell holds "Receipt" when `receiptAvailable` is unset or true,
   nothing when it returns false; clicking it emits `edit-receipt` `{departmentId}` and does NOT emit
   `open-department` (no row activation); its href is the receipt path.
3. The department ⋮ menu no longer offers Edit receipt (`receipt-department-<id>` is not inside
   `wt-row-actions`).
4. A zone row's cell reads "Floor plan" before its plan is read; "Add floor plan" once a plan with no
   placed table arrives (`tables: []`, and a table with `placement: null`); "Floor plan" for a plan
   with a placed table; the href as above; a click does not activate the row.
5. Watches: each shown zone gets one `watchZoneFloorPlan` call on mount; a zone removed from the
   model (or made inactive, or its department disabled) has its detach called exactly once; a new
   `api` re-watches; disconnect detaches all.
6. The zone ⋮ menu holds no floor-plan link and opening it makes no floor-plan read.
7. Column order: Name, How orders start, When counter service is used, Print a receipt, Also edit,
   Actions (pinned end).

Changed test checks expected (list each in the PR's "Changed test checks"):
`departments-zones-list.test.ts` ~105–140 (menu-open read and "Edit floor plan" text → the column's
watch and new labels) and ~141–150 (menu subject releases its watch → a removed zone row releases
its watch). Any other check that breaks is a STOP: report it, do not edit it.

Prove 2, 4 and 5 by deletion (remove the condition or the detach, see the case fail, restore).

## Task 2 — Zone editor trimmed; Save lines up with the fields

Files: `zone-edit-dialog.ts`, `zone-closed-week.ts` (delete), `strings.ts`, and the zone editor's
tests: `zone-edit-dialog.test.ts`, `zone-edit-dialog-hours.test.ts`, `zone-edit-dialog-hours.a11y.test.ts`,
`zone-edit-dialog-floor-plan.test.ts`, `zone-edit-dialog-floor-plan.a11y.test.ts`,
`service-edit-dialog.legacy.test.ts` (the "floor-plan link keeps token spacing below Opening hours"
case, ~386).

Test first:

1. In `zone-edit-dialog.test.ts`, one case: the open editor shows no closed-week summary, no
   Opening hours link, no floor-plan link and no `wt-floor-plan-preview`, and mounting it makes no
   `watchZoneFloorPlan` and no `openingHours.watchOpeningHours` call (spy both before mount). This
   is the new behaviour's check, at least as strict as the deleted ones.
2. Save's right edge equals the last field's right edge (within 1 px) at 1280 px and at 390 px,
   measured with `getBoundingClientRect` in real Chromium. Watch it fail first, then find the cause
   (the modal body sets `--wt-field-max-width: var(--wt-form-max-width)`, `wt-modal.ts` ~51, and the
   button row is not bounded by it) and fix it IN THE ZONE EDITOR — e.g. bound `.form` the same way.
   If the only right fix is in a shared `wt-*` primitive, STOP and report: that widens the item.
3. Then remove: the `.zone-context` block, the plan and hours watches and their state, the
   `floorPlan()` method, the imports only they used, styles only they used, `zone-closed-week.ts`,
   and the now-unused string keys (EN and ES).

Delete the test files and cases that check only removed features (`zone-edit-dialog-hours*.test.ts`,
`zone-edit-dialog-floor-plan*.test.ts`, the legacy spacing case, and any zone-editor case asserting
on the removed links). List every deleted file and case in the PR's "Changed test checks" with the
spec line (A718 point 2) and point at case 1 as the check that replaces them. A case in those files
that checks something still present (Save, name, policy fields) moves into `zone-edit-dialog.test.ts`
rather than being deleted.

## Task 3 — LOOK, backlog

1. Open Departments and zones and the zone editor in both themes at 1280 and 390 px (the venue-service
   browser harness or the dev stack); save pictures; check the column, the absent picker, the trimmed
   editor and Save's edge against the mockup.
2. `docs/backlog.md`: delete A718's entry and the three notes it makes moot ("The zone editor's
   closed-times sentences without a season name", "Closing a painter opened from the zone dialog's
   'Opening hours (normal week)' link lands on the Opening hours Year…", "The zone editor's 'Edit
   floor plan' link is not hidden without `venue.configure`"), and their detail sections in
   `docs/backlog/service-periods.md` (and wherever else they live). Re-file the last against the new
   column: the "Floor plan" link in the list is likewise not hidden without `venue.configure` (check
   that it is still true before writing it).

Checks: the focused files above; `pnpm --filter @waitron/venue-service exec vitest run
src/dashboard/departments src/dashboard/zone-edit src/dashboard/venue-departments
src/dashboard/service-edit-dialog`; `pnpm exec vitest run scripts/pinned-actions-column.test.ts
scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`; `pnpm format:check`;
`pnpm --filter @waitron/venue-service typecheck`.

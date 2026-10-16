# A718 — Departments and zones: a column for the receipt and floor plan, a trimmed zone editor

Spec: backlog entry A718 (`docs/backlog.md`) and its detail in `docs/backlog/service-periods.md`
("## A718."), mockup `docs/backlog/mockups/a718-a727-calendar-and-stations/12-departments-and-zones.png`.
The owner reviewed the entry and mockup (2026-10-15); there are no open questions.

Review path: FULL — `GET /management-api/zones` gains a field (Task 0). No stored record,
migration or shared `wt-*` primitive changes. Lane A's open A720 branch shares only `strings.ts`
with this one (different keys).

## Decisions taken here (recorded in the PR)

- **Column heading:** "Also edit" / «Editar también», as drawn. Column key `also` (never `actions`:
  `scripts/pinned-actions-column.test.ts` holds every `key: "actions"` to the row-menu rule).
- **Link labels:** the mockup's shorter words. Department: "Receipt" / «Recibo». Zone: "Add floor
  plan" / «Añadir plano de sala» when the zone's `hasPlacedTables` is `false`, otherwise "Floor plan"
  / «Plano de sala» (also when the field is missing). Each link carries an `aria-label` naming its
  row, as the row menu does (`departments-list.ts:312`): "<name>: Receipt", "<name>: Floor plan".
- **The list learns which zones have a placed table from the zones read it already makes**, not
  from a floor-plan read per zone. A per-zone `watchZoneFloorPlan` (the plan's first version) would
  re-read every zone's plan on every `dining_tables` change — which happens whenever a table's
  status changes in service (`QUERY_DEPENDENCIES["floor-plan"]`, `live-queries.ts`) — where today
  the list reads at most one. So `GET /management-api/zones` answers each zone with
  `hasPlacedTables` (Task 0), and the `operations` live dependencies gain `floor_plans` and
  `floor_plan_tables` so the label follows a saved plan. `listZones` (`apps/server/src/tables.ts`),
  which the till also reads, does not change: the field is added in the management route only.
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
  The id is `encodeURIComponent`-encoded, as the name link's is.
- **The floor-plan link** keeps `data-test="floor-plan-zone-<id>"` and its href
  (`/manage/floor-plan/zone/<id>?back=%2Fmanage%2Fvenue-operations`) and has NO `data-own-click`
  and no click handler: `data-own-click` tells the dashboard shell's link handler to leave a link
  alone (`apps/dashboard/src/dashboard-app.ts` ~1784–1803), so on a handler-less link it turns app
  navigation into a full page load. What keeps a cell link from opening the row is the table's
  layering (`wt-data-table.ts` ~331–366), for both links.
- **Stored column order.** `wt-data-table` applies a stored column order under its `viewKey` whether
  or not any column is choosable (`wt-data-table.ts` ~1359–1406), and with no chooser there is no
  Restore. Rename the list's `viewKey` (to `waitron.venue.departments-zones`; grep that no guard pins
  the old name) so an order saved before this change no longer applies and the new column sits where
  drawn. The remembered sort starts afresh once.
- **Removed with the zone editor's season sentence:** `zone-closed-week.ts` (its only consumer is
  `zone-edit-dialog.ts`) and every string key only it or the removed markup read. Grep each key
  across `packages/` and `apps/` before deleting it.

## Task 0 — The zones read says which zones have a placed table

Files: `apps/server/src/management-api.ts` (the `GET /management-api/zones` route, ~1696),
`apps/server/src/floor-plan.ts` (a helper beside `readZonePlan`), their tests;
`packages/venue-service/src/dashboard/client.ts` (`FloorZone` gains `hasPlacedTables?: boolean`),
`packages/venue-service/src/dashboard/live-queries.ts` (`operations` gains `floor_plans`,
`floor_plan_tables`); `apps/dashboard/src/api/client.ts`'s `FloorZone` if it is a separate type.

Test first (`useVenueDb`; the route's existing test file):

1. A zone with no plan, a zone whose plan has only unplaced tables, and a zone with one placed table
   answer `hasPlacedTables` false, false, true — "placed" by the same rule `readZonePlan` uses for
   `placement` (read `placementOf` in `floor-plan.ts`; a placed table is one whose placement is not
   null). One query for all zones, not one per zone (CLAUDE.md §3: resolve shared data once).
2. Only active zones of this location, as now; the existing fields unchanged.

An existing assertion pinning the route's WHOLE answer may gain the `hasPlacedTables` key with every
existing value unchanged (THE RULE's 2026-09-27 exception) — name each in the PR. Run
`scripts/live-subscriptions.test.ts` after the dependency change.

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
4. A zone row's cell reads "Add floor plan" when its `floorZones` entry has `hasPlacedTables:
   false`, "Floor plan" when true and when the field is absent; the href as above; a click (with
   `userEvent.click`) does not activate the row; the link has no `data-own-click`.
5. The list makes no floor-plan read at all: mounting it, and opening a zone's ⋮ menu, call
   `watchZoneFloorPlan` zero times (spy on the api). Remove the list's plan-watch state
   (`plan`, `planFailed`, `planDetach`, `planZone`, `planApi`, `#watchPlan`, the `willUpdate` and
   `disconnectedCallback` parts) with it.
6. The zone ⋮ menu holds no floor-plan link.
7. Column order: Name, How orders start, When counter service is used, Print a receipt, Also edit,
   Actions (pinned end) — including when an order was stored under the OLD `viewKey` before mount.
8. The Receipt and Floor plan links' accessible names name their row.

Changed test checks expected (list each in the PR's "Changed test checks", before → after, with
the spec point):
- `departments-list.test.ts` ~150–157 (column keys and labels; the `viewKey` at ~150) and ~360–366
  (Spanish column labels): gain the `also` column; the new `viewKey`.
- `departments-list.test.ts` ~455–500 ("A462 Customise ends the toolbar"): the chooser is gone
  (spec point 3) → replaced by case 1 above.
- `departments-zones-list.test.ts` ~34–40 (column keys): gain `also`.
- `departments-zones-list.test.ts` ~76–99 (department menu includes "Edit receipt") → it does not
  (point 4); case 2/3 check the column.
- `departments-zones-list.test.ts` ~105–140 (no read on mount, a read when the zone menu opens,
  "Edit floor plan" in the menu) → no read at all, the column's label from `hasPlacedTables`.
- `departments-zones-list.test.ts` ~141–150 (a removed menu subject releases its watch) → deleted
  with the watch; case 5 checks that no watch is made.
Any other check that breaks is a STOP: report it, do not edit it.

Prove 2, 4 and 5 by deletion (remove the condition, or restore a watch call, see the case fail,
restore).

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
   measured with `getBoundingClientRect` in real Chromium. Watch it fail first. Cause: the modal
   body sets `--wt-field-max-width: var(--wt-form-max-width)` (`wt-modal.ts` ~51) and the shared
   form-actions row deliberately spans the full width (`wt-form-actions.test.ts` ~60–70 pins that),
   so the fix belongs in the zone editor: bound its `.form` with `max-inline-size:
   var(--wt-field-max-width)`, the pattern `design-system.md` ~510–514 names (precedents:
   `department-settings.ts` ~62–66, `printers-screen.ts` ~336–343). Do not change a `wt-*` primitive.
3. Then remove: the `.zone-context` block, the plan and hours watches and their state, the
   `floorPlan()` method, the imports only they used, styles only they used, `zone-closed-week.ts`,
   and the now-unused string keys (EN and ES).

Delete the test files and cases that check only removed features (`zone-edit-dialog-hours*.test.ts`,
`zone-edit-dialog-floor-plan*.test.ts`, the legacy spacing case, `zone-edit-dialog.test.ts` ~203–260,
and any other zone-editor case asserting on the removed links).
`venue-departments-shell.unsaved.test.ts` ~228 leaves the zone editor through its Opening hours link:
that case's subject is the leave question, not the link — move it to another way out of the editor
that still navigates away with a draft (a row's name link, or `history` navigation, whichever the
file's other cases use), keeping every assertion on the question; list it as changed. List every deleted file and case in the PR's "Changed test checks" with the
spec line (A718 point 2) and point at case 1 as the check that replaces them. A case in those files
that checks something still present (Save, name, policy fields) moves into `zone-edit-dialog.test.ts`
rather than being deleted.

## Task 3 — LOOK, docs, backlog

1. Open Departments and zones and the zone editor in both themes at 1280 and 390 px (the venue-service
   browser harness or the dev stack); save pictures; check the column, the absent picker, the trimmed
   editor and Save's edge against the mockup.
2. `docs/developers/design-system.md` ~4352–4353 (Edit receipt and the floor-plan link in the row
   menus) and ~4370–4376 (the zone editor's Opening hours link, closed-times sentence and floor-plan
   preview): rewrite to the new behaviour, and add the zone editor to the ~510–514 paragraph on
   bounding a form by `--wt-field-max-width` if it lists screens. Grep `docs/` for any other prose
   naming the removed links. `apps/dashboard/src/i18n/codes.ts` ~820 ("the Email field under Edit
   receipt in Departments and zones"): if the receipt dialog's own heading still reads "Edit receipt"
   the sentence still holds — say so in the PR; otherwise reword it to the Receipt link (EN and ES)
   and list `codes.test.ts` ~650 as a changed check.
3. `docs/backlog.md`: delete A718's entry and the three notes it makes moot ("The zone editor's
   closed-times sentences without a season name", "Closing a painter opened from the zone dialog's
   'Opening hours (normal week)' link lands on the Opening hours Year…", "The zone editor's 'Edit
   floor plan' link is not hidden without `venue.configure`"), and their detail sections in
   `docs/backlog/service-periods.md` (and wherever else they live). Re-file the last against the new
   column: the "Floor plan" link in the list is likewise not hidden without `venue.configure` (check
   that it is still true before writing it).

Checks: the focused files above; the route's test file in `apps/server`;
`pnpm exec vitest run scripts/live-subscriptions.test.ts`; `pnpm --filter @waitron/venue-service exec vitest run
src/dashboard/departments src/dashboard/zone-edit src/dashboard/venue-departments
src/dashboard/service-edit-dialog`; `pnpm exec vitest run scripts/pinned-actions-column.test.ts
scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`; `pnpm format:check`;
`pnpm --filter @waitron/venue-service typecheck`.

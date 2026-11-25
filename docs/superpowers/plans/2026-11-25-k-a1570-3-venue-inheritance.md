# A1570 PR 3 — Inheritance in Devices and venue settings

**Finish line.** In Devices, Zones and Periods, you can see which settings follow a parent and can
set a choice even when it matches the inherited one. Calendar hours and Routes retain the muted,
upright facts already delivered by PR 1. [Design, Order 3](../specs/2026-11-24-inherited-values-design.md#order).

Build on PR 1 (#4281). Reuse `wt-combobox` with `inherited: true`, a translated `label`, the effective
`valueLabel`, and `inherited-suffix`. Reuse each field's existing empty value and save handler.
Use “Inherit: {value}” and “inherited” in English and Spanish in Dashboard and Venue Service. Reuse
Venue Service's `routing.inherited` wording. This slice is confined
to the dashboard. The product and menu screens, till, remaining hints and wording guard have their
own slices. Routes keeps its editor and station selection rules. Use existing request and data shapes.
The watcher cleared this plan at 02:48 on 25 November. The branch's base is the rebased PR 1 head
`3955de990710c34ddec438e86f8f6fe497c67f03`.

1. **Devices.** In `apps/dashboard/src/screens/devices-screen.ts` and `src/i18n/strings.ts`, mark the
   profile choice as the first inherit row. Use the existing resolution for named equipment or
   “None” when another device holds it. Remove the ready placeholders sourced from `options[0]`
   for printers and readers. Keep the printer loading and failure prompts. A reader box has no
   placeholder before or after a failed read. Offer its inherit row only when `readerState` is
   ready and the profile's list is present. Keep an inactive reader as a `fixed` row only while it
   is the stored choice and the profile is unchanged. Keep inactive readers out of ordinary options.
   Keep choice annotations and access rules. Leave inherited cells visually blank, keep the
   resolved name and “from the profile” hidden for screen readers where the role applies, and
   sort by the resolved name. Remove the old inherited-cell styling. In `devices-screen.test.ts`,
   first require inherited and explicit equipment with the same name to display differently. Check
   sorting, a held default, a fixed inactive reader, and a profile change whose reader read fails. Keep the
   existing save-by-ID and `null` assertions.
2. **Zones.** In `packages/venue-service/src/dashboard/service-settings-fields.ts` and `strings.ts`,
   use the same inherit row for fields with a department value. Keep the named value available as
   an explicit choice. In `departments-list.ts`, base blanks on the stored zone override. Keep paid
   timing blank for table-service zone rows, and keep the department row's timing when a counter
   zone needs it. First cover the inherit row and explicit selection in `service-settings-fields.test.ts`
   and the equal explicit, inherited and table-service cases in `departments-zones-list.test.ts`.
   Delete `venue.same_as_department`. Update `zone-edit-dialog.test.ts`,
   `zone-edit-dialog-policy.test.ts` and `venue-departments-policy.test.ts` for the new row.
3. **Floor plans.** In `period-dialog.ts`, remove `shownPlan` from the draft comparison, submitted
   value and picker. Offer the current default in the inherit row and under its own ID. Keep the
   plan field out of saves when absent. In `periods-list.ts`, show every known saved ID by name,
   including the default's ID. Leave `null` blank where the department has a plan. Use “—” for a
   department without plans or an ID missing from the list. Remove the `default-mark` style. In
   `floor-plan-set-delete-dialog.ts`, show the default only in the inherit row and keep `null` for
   that action. First pin ID vs `null` and draft cleanliness in `period-dialog.test.ts`, blank vs
   explicit-default vs “—” in `periods-list.test.ts`, and replacement choices and payload in
   `floor-plan-set-delete-dialog.test.ts`. Deliberately update tests that treated the saved default
   ID as inherited. Update `periods-list.a11y.test.ts`, `floor-plans-screen.test.ts`,
   `season-painter.test.ts` and `special-day-painter.paint.test.ts` for the changed displays and
   replacement list. Replace the two old localized default templates.
4. **Calendar, Routes and guides.** Keep PR 1's styling and coverage in `calendar-day-box.test.ts`
   and `routing-grid.test.ts`. Remove the three unused `hours.inherit*` keys from Venue Service.
   Update the design-system reference for Devices, zone overrides, floor plans and Periods, the
   English and Spanish `printers.md` guides and the remaining A1570 scope in `docs/backlog.md`.
   Preserve guide heading IDs. PR 1 already updated the opening-hours guide.

Where an inherit row replaces an empty option, remove `show-empty-option`, `muted` and the old
placeholder. Screen tests own the option fields and suffix, table cells and saved values. The
shared combobox suites own the arrow, ink, search and spoken suffix. Change only failing
expectations in the two zone edit suites, venue department policy, Floor plans and both painters.
In the PR, list the changed test checks and show that a held device default now leaves a blank
instead of “None”, a blank period's plan is named nowhere in that table, and a period already
storing the default ID stays fixed after “Make default”.

Run each changed browser suite red for the new expectation, then green with the smallest change.
Run the Calendar, Routes and guide guards. Check the changed controls and tables with keyboard and
at desktop and phone widths in both themes, including a held default in Devices and the blank and
fixed plan cells in Periods. Attach screenshots for the owner's approval before landing. Budget
about 110 production lines, 230 test lines and four documents. Report additions and removals
separately.

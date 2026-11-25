# A1570 PR 3 — Inheritance in Devices and venue settings

**Finish line.** In Devices, Zones and Periods, you can see which settings follow a parent and can
set a choice even when it matches the inherited one. Calendar hours and Routes retain the muted,
upright facts already delivered by PR 1. [Design, Order 3](../specs/2026-11-24-inherited-values-design.md#order).

Build on PR 1 (#4281). Reuse `wt-combobox` with `inherited: true`, a translated `label`, the effective
`valueLabel`, and `inherited-suffix`. Reuse each field's existing empty value and save handler.
Add one English/Spanish string pair to each of Dashboard and Venue Service. This slice is confined
to the dashboard. The product and menu screens, till, remaining hints and wording guard have their
own slices. Routes keeps its editor and station selection rules. Use existing request and data shapes.

1. **Devices.** In `apps/dashboard/src/screens/devices-screen.ts` and `src/i18n/strings.ts`, mark the
   profile choice as the first inherit row. Use the existing resolution for named equipment or
   “None” when another device holds it. Keep loading and failure prompts, choice annotations and
   access rules. Display only explicit equipment in the table, keeping existing spoken context
   and sorting by the resolved name. In `devices-screen.test.ts`, first require an inherited and
   an explicit choice with the same name to display differently, order by the resolved printer,
   and check that a held default shows “Inherit: None” while an explicit choice still saves by ID.
2. **Zones.** In `packages/venue-service/src/dashboard/service-settings-fields.ts` and `strings.ts`,
   use the same inherit row for fields with a department value. Keep the named value available as
   an explicit choice. In `departments-list.ts`, base blanks on the stored zone override. Keep paid
   timing blank for table-service zone rows, and keep the department row's timing when a counter
   zone needs it. First cover the inherit row and explicit selection in `service-settings-fields.test.ts`
   and the equal explicit, inherited and table-service cases in `departments-zones-list.test.ts`.
   Update zone dialog and policy expectations that currently pin “Same as department”.
3. **Floor plans.** In `period-dialog.ts`, use the saved ID directly in the draft and offer the
   current default twice by purpose: inherit with an empty value, or fix it using its ID. Keep the
   plan field out of saves when absent. In `periods-list.ts`, show every explicitly saved plan by
   name, leave inheritance blank and keep “—” for departments without plans. In
   `floor-plan-set-delete-dialog.ts`, show the default only in the inherit row and keep `null` for
   that action. First pin ID vs `null` and draft cleanliness in `period-dialog.test.ts`, blank vs
   explicit-default vs “—” in `periods-list.test.ts`, and replacement choices and payload in
   `floor-plan-set-delete-dialog.test.ts`. Replace the two old localized default templates.
4. **Calendar, Routes and guides.** Keep PR 1's styling and coverage in `calendar-day-box.test.ts`
   and `routing-grid.test.ts`. Remove the three unused `hours.inherit*` keys from Venue Service.
   Update `docs/developers/design-system.md`, English and Spanish `printers.md` and `opening-hours.md`,
   and the remaining A1570 scope in `docs/backlog.md`. Preserve guide heading IDs.

Run each changed browser suite red for the new expectation, then green with the smallest change.
Run the Calendar, Routes and guide guards. Check the changed controls and tables with keyboard and
at desktop and phone widths in both themes, and attach screenshots for the owner's approval before
landing. Budget about 180 production lines, 230 test lines and a short guide update. Report additions
and removals separately.

# A1570 PR 4 — Inheritance on the till and example hints

**Finish line.** At a till you can see when equipment, a dish's course or a temporary name follows
its default and choose a fixed value where offered. The pay sheet plainly names the printer in
force. The six named examples start with “e.g.” or “p. ej.”.
[Design, Order 4](../specs/2026-11-24-inherited-values-design.md#order).

Stack on #4292 at `ee4285b9886bd5c63f5fbf374607711e5b56eccc`. Use #4281's shared fields and the
existing reads, saves and empty values. Keep server, schema, wire and payment behaviour as they
are. The watcher assigned this slice at 03:47 on 25 November. The dashboard's `editor.takeaway_vat_same`,
`editor.nutrition.same_as` and `menus.set_menu_product_course` would fail the wording guard.
Per that note, leave the guard in the backlog to land after PR 2.

1. **Equipment.** In `apps/till/src/widgets/equipment-dialog.ts` and
   `apps/till/src/screens/till-ticket-view.ts`, share an inherit row from `widgets/equipment-labels.ts`
   with `value: ""`, `inherited: true`, localized “Inherit: {value}” and a plain `valueLabel`.
   Name the profile's item, or “None” if absent or held by another device. Keep ordinary choices
   with their existing labels. Show a saved item outside the list as a fixed row in both selectors.
   Keep the held, off, busy and free messages and the free reader's claim through the inherit row.
   Drop the ordinary default/fixed notes and the name above the picker when it repeats the choice.
   A held default shows “None” in the picker and names the item and holder in the status message.
   Preserve distinct resolved status for a fixed item that cannot be used. In `widgets/pay-equipment.ts`
   use the plain ticket summary and keep the saving note. The pay list still selects the resolved ID.
   Drop the now-unused `fromDefault` from `state/pay-equipment.ts` and its shape tests. First pin
   the inherit and equal fixed IDs, held/free states, the claim, the fixed off-list printer and the
   pay summary in `widgets/equipment-dialog.test.ts`, `screens/till-ticket-view.test.ts` and
   `widgets/pay-equipment.test.ts`. Keep takeover and refusal assertions. Update the matching
   `till-app-handheld-pay.test.ts` expectation.
2. **Course.** In `widgets/basket.ts`, start on the stored override or `""`. In
   `widgets/modifier-picker.ts`, use `#selectedProduct.courseId` for the inherit row so its name
   follows a variant change. Use the configured course name or a matching snapshot. If there is
   no known name, use “None” and keep the existing inherited course ID resolution. Keep an equal
   course selectable by ID and keep the display fallback for a saved course missing from the list.
   Set-menu lines already carrying a course ID stay fixed. In `state/working-order.ts`, re-run
   the placer for a course edit only when the effective course (override or product course)
   changes. In `state/working-order.line-details.test.ts`, first prove fixing the current course
   and returning to Inherit preserve a manual placement. In `screens/till-table-order-screen.test.ts`
   and `widgets/modifier-picker.test.ts`, check the empty initial picker, explicit equal ID,
   return to Inherit and variant switch. Keep the existing omitted `courseId`, saved course,
   cancel and stale-choice checks.
3. **Names.** In `widgets/today-name-dialog.ts`, `widgets/party-name-dialog.ts` and
   `widgets/fit-placeholder.ts`, pass the fitted name as `wt-input.inherited` with its suffix.
   After the input updates, read its computed arrow padding while empty. Refit after clearing,
   stored-value changes, viewport changes and font loads. Keep separators and grapheme fitting.
   In both name-dialog suites and `fit-placeholder.test.ts`, first check fitting while focused at
   phone width and after clearing. Keep draft, save and keyboard assertions. Update
   `screens/till-floor-screen.rename.test.ts` to check the inherited property.
4. **Copy and guides.** Add one Till pair for Inherit and its spoken suffix. Remove the old keys
   `equipment.use_default`, `equipment.from_default`, `equipment.chosen_here`,
   `pay_equipment.ticket_at_default` and `table.course_default` from `apps/till/src/i18n/strings.ts`
   in both languages and update its course comment. In `apps/dashboard/src/i18n/strings.ts`, update
   course, tax ID, kitchen inactivity and privacy URL/email examples. Check the displayed examples
   in `screens/venue-privacy-panel.test.ts`. Localize the two port suggestions in Dashboard's
   `widgets/email-settings-form.ts` and Setup's `screens/email-screen.ts` and their catalogues.
   Run the matching suites for both ports and preserve the entered port check. Update both the
   equipment and document printer instructions in `apps/server/src/guide/{en,es}/table-service.md`
   with their heading IDs intact. Update the A1570 backlog entry for the remaining work.

Run the changed browser suites red for the new behaviour and then green, plus the guide and
language guards. Show held/free equipment, inherited and equal fixed courses, and a shortened
name at desktop and phone widths in both themes. Attach screenshots for the owner's landing
decision. Estimate production +110/−75 and tests +160/−120 lines, with four changed documents.
Report the actual additions and removals separately.

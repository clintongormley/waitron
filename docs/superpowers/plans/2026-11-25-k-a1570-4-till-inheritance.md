# A1570 PR 4 — Inheritance on the till and example hints

**Finish line.** At a till you can see when equipment, a dish's course or a temporary name follows
its default and choose an explicit value where the field offers one. The pay sheet names the printer
in force plainly, and the six named examples start with “e.g.” or “p. ej.”.
[Design, Order 4](../specs/2026-11-24-inherited-values-design.md#order).

This stacks on #4292 at `ee4285b9886bd5c63f5fbf374607711e5b56eccc`. Reuse the shared fields from
#4281 and the current saves, reads and empty values. Keep server, schema and wire shapes and
payment behaviour as they are. The watcher assigned this slice at 03:47 on 25 November. PR 2 still
owns the dashboard editors and list. Its strings `editor.takeaway_vat_same`,
`editor.nutrition.same_as` and `menus.set_menu_product_course` would fail the wording guard, so the
guard follows PR 2 as directed in that note. Keep that work in the backlog alongside PR 2.

1. **Equipment.** In `apps/till/src/widgets/equipment-dialog.ts` and
   `apps/till/src/screens/till-ticket-view.ts`, use the shared combobox's first row with
   `value: ""`, `inherited: true`, localized “Inherit: {value}” and the plain `valueLabel`.
   Reuse a row builder in `widgets/equipment-labels.ts`. Name the profile's item, or “None”
   when absent or held by another device. Keep the item as an ordinary eligible choice, along with
   paper labels and the held, off, busy and free messages. Keep the free reader's claim through the
   inherit row. Remove the two ordinary default/fixed notes. In `widgets/pay-equipment.ts`, use
   the plain ticket summary and keep only the saving note. Keep the pay list's resolved item
   selected and keep its existing choices. First pin these displays, the free-reader claim and
   the difference between the default row and the same named item's ID in `equipment-dialog.test.ts`,
   `screens/till-ticket-view.test.ts` and `pay-equipment.test.ts`. Keep take-over and refusal assertions.
2. **Course.** In `widgets/basket.ts`, start the picker from the stored override or `""`, and
   give its first row the product's named course, using the configured course list and a matching
   snapshot where available. Use the existing “No course” label when there is no course to inherit.
   Keep the same course in the list as an explicit choice. In `widgets/modifier-picker.ts`, use
   the shared suffix and keep the existing display fallback for a saved course missing from the
   choices. In `screens/till-table-order-screen.test.ts`, first require the untouched line to omit
   `courseId`, picking the same named course to send its ID and returning to Inherit to omit it
   again. Keep the existing cancel, stale-choice and different-course checks.
3. **Names.** In `widgets/today-name-dialog.ts`, `widgets/party-name-dialog.ts` and
   `widgets/fit-placeholder.ts`, pass the fitted name as `wt-input.inherited` with the till's
   `inherited` suffix. Fit the native placeholder to the text box with its computed arrow padding
   when empty, including after clearing and after a viewport or font change. Keep name groups,
   separators and grapheme fitting. In both name-dialog suites and `fit-placeholder.test.ts`,
   first check a focused, narrow empty field fits with the arrow and that clearing restores the
   fitted inherited value. Keep the existing draft, saved name and keyboard checks.
4. **Copy and guides.** Use one Till pair for Inherit and its spoken suffix in `i18n/strings.ts`.
   Update the Dashboard examples in `apps/dashboard/src/i18n/strings.ts` for course name, tax ID,
   kitchen inactivity and privacy URL/email. Use localized examples for the encryption-specific
   mail port in `widgets/email-settings-form.ts` and `apps/setup/src/screens/email-screen.ts`
   and their catalogues. Test both port examples and keep the entered port assertion in the
   existing mail suites. Keep other prompts and formats. Update the English and Spanish
   `apps/server/src/guide/*/table-service.md` Equipment instructions, keeping their heading ID,
   and update the A1570 backlog entry for the work still due.

Run each changed browser test file, starting with a failing assertion for the new display or
choice. Run the guide and language guards. Show the held and free equipment, an inherited and
an equal explicit course, and a shortened name at desktop and phone widths in both themes.
Attach the screenshots for the owner's landing decision. Budget about 140 changed production
lines and 220 changed test lines, plus the plan, backlog and two guides. Count additions and
removals separately in the PR.

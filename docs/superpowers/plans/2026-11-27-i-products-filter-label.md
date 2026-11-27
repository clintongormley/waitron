# Keep Products filter choices readable

Staff can read the whole Spanish standalone-ordering choice in Products Filters, including when the table leaves little room beside its rows.

Keep the existing Filters panel and its 768 px breakpoint. Let the chosen value or placeholder of the existing table dropdown wrap within the field. Expose its text through a `value` part on `wt-combobox.ts` and style that part on `.table-filter` in `wt-data-table.ts`. The existing field can grow vertically. Keep the option list, translations, type scale and filter behavior as they are.

- Run the existing Spanish whole-choice test in `apps/dashboard/src/widgets/product-browser.test.ts`. Keep its default-size case and add the supported larger text setting to reproduce the overflow on macOS too. Assert that all the text fits in both directions. Re-run it after the fix.
- Run the Products browser and accessibility files, the table's Filters and breakpoint cases, and the combobox suite. Inspect the filter on phone and desktop in English and Spanish with both themes.
- Document the wrapping in `docs/developers/design-system.md`. The Products guide already directs staff to this filter. The interaction stays the same.

Expected size is about 6 lines of production code and 20 lines of tests. The backlog has no open entry for this fix.

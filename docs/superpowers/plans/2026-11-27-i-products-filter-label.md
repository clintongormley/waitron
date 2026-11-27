# Keep Products filter choices readable

Staff can read the whole Spanish standalone-ordering choice in Products Filters, including with the venue’s 130% text size or a wider system font.

Keep the existing Filters panel and its 768 px breakpoint. Let the chosen value or placeholder of the existing table dropdown wrap within the field. Expose its text through a `value` part on `wt-combobox.ts` and apply `text-wrap: wrap` to that part on `.table-filter` in `wt-data-table.ts`. The existing field can grow vertically. Keep the option list, translations, type scale and filter behavior as they are.

- Run the existing Spanish whole-choice test in `apps/dashboard/src/widgets/product-browser.test.ts`. Keep its default-size case, which passes on this Mac, and add the 130% case using `TEXT_130_SHEET` from the shared venue theme fixture. Remove the sheet in `finally`. Check `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight`. Run before and after the fix, then confirm the default-size case in PR CI.
- Run the Products browser and accessibility files, the table's Filters and breakpoint cases, and the combobox suite. Inspect the filter on phone and desktop in English and Spanish with both themes.
- Document the `value` part and Filters wrapping in `docs/developers/design-system.md`. The Products guide already directs staff to this filter. The interaction stays the same.

- Finish and land one PR from main. Record the merge in Lane I `questions.md`.

Expected size is about 6 lines of production code and 20 lines of tests. The backlog has no open entry for this fix.

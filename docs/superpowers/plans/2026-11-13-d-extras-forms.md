# D-EXTRAS-FORMS: picker wording and table layout

13 November 2026. Sol-high draft, driver checked. Watcher queued this at 19:34; no owner design approval is recorded. Claude reads this before watcher clearance and implementation.

**Queue ask, verbatim:** “Extra bread · Extras” says “ · Extras” twice; “+ Add options list…” opens at the dropdown’s bottom edge; at 1280px the items table “scrolls sideways by 4px”; at 390px it is wider than its scrolling box, headings cut (“Preselecc…”).

**Finish line:** say each kind once in the grouped picker, expose both create choices in the reproduced small-list opening, remove desktop excess, and keep phone headings and controls reachable. Reuse existing fixtures, `wt-combobox`, fields and table scrolling; no API, records, framework or card redesign. Leave Each/portion wording and deliberate limits alone.

Current-main base `71baa3c8d01cc3d1d362aa705b2e0c93abb5f526`: driver inspected EN/ES × light/dark × 1280/390 captures in `/Users/clintongormley/waitron-campaign-d/receipts/extras-forms-before/`. `measurements.json` records 978px content/974px desktop box, 700px/356px phone box, and Add options below the initial list viewport. Phone width alone does not prove broken scrolling.

- **Picker:** `apps/dashboard/src/widgets/product-editor.ts`: plain names under kind headings; each create row first in its group. Preserve IDs, attached-row/summary kind labels, search, creation events and returned focus. In `product-editor.test.ts`, pin “names lists once under their kind headings” and “shows both create choices on opening the reproduced picker”; retain event assertions when updating the last-row expectation. No shared combobox change planned.
- **Table:** `extra-list-form.ts` in that directory: identify the overflowing control, correct local column/padding sizing, and make Preselected readable without overlapping headings. In `extra-list-form.test.ts`, pin “fits the items scroller at 1280px” and “keeps headings readable and last controls reachable while scrolling at 390px”. Check wrapper bounds, heading text bounds after scrolling each column into view, then fully-right price digits and Remove. Do not squeeze seven columns into 356px. Read `option-list-form.ts` as the sibling reference; preserve its behavior.

Run each new assertion red before its fix, then green. Widget tests own geometry, wording and events; no server tests. Run changed widget files, existing a11y siblings, and focused Options width cases; restore viewport/locale. Preserve existing long-unit, reorder and save assertions. Inspect matching after captures including right-scrolled phone views. Update the EN/ES modifier guides only with useful placement/scrolling instructions, remove the four finished complaints from `docs/backlog/catalogue.md`, and correct its bundle count in `docs/backlog.md`.

Expected production +20–45/−20–40 lines; tests +90–140/−10–25; support/generated zero. One PR; screenshots remain local.

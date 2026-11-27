# Restore dashboard and till coverage (A1616)

Both packages pass their existing 98% statement, line and function gates and 95% branch gate. Keep
production code, coverage settings and existing assertions intact. Use the current browser and API
fixtures. Add focused tests for behaviour introduced or moved since the last passing nightly.

The 26 November merge reports (run 45741432235) show dashboard at 98.12% statements and 95.07%
branches and till at 98% statements. Merging the 27 November shards (run 45927524956) gives
dashboard 38,478/39,321 statements and 27,258/28,789 branch paths and till 37,285/38,047
statements. That leaves 57 statements and 92 branch paths on dashboard and two statements on till.
The zero-percent rows for the till's new `order-types.ts` and `till-request.ts` (#4371) each
contribute zero counters. The earlier till report already contains several zero-percent type rows.

- **Dashboard menu Structure (#4420, #4436).** Extend `screens/menus-screen.test.ts`,
  `screens/menus-screen.heading.test.ts`, `widgets/menu-structure-draft.test.ts` and
  `widgets/menu-structure-table.test.ts`. Check “focuses a refused price or section and lets you
  retry”, “shows a save refusal when its row is filtered out”, and “names the items and variant
  prices dropped by Save”. Exercise price/category/availability/modifier/variant filters with
  mixed rows, checking which dishes and variants stay visible. Pin equivalent price edits and
  missing move members at the draft, where those decisions live.
- **Dashboard Home and customer preview (#4432, #4440, #4444).** Extend
  `screens/menus-screen.home-tab.test.ts` and `screens/menus-screen.customer-preview.test.ts`.
  Test “keeps a staged shortcut after a refusal and explains which shortcut was refused” and
  “keeps the draft when a product disappears from its choices”. In the customer preview, test
  “renders price ranges and units, and defers photos after the first”, using the existing preview.
- **Dashboard box and equipment (#4454, #4461, #4389).** Extend
  `screens/box-status-screen.test.ts` and `widgets/equipment-profile-picker.unsaved.test.ts`.
  Check “can retry loading staff after a refusal”, “can stop a pending shutdown or retry the
  final backup”, and “retries loading equipment profiles and explains when none can be assigned”.
  If focused coverage identifies a remaining gap, use `screens/printers-screen.test.ts` for
  “shows the paper-out reason and restores selection after leaving a queue preview” (#4405).
- **Till problem reports.** In `apps/till/src/api/client.test.ts`, use the existing fetch fixture
  to assert preview and send go to their report endpoints, pass cancellation through, and send
  a description only when provided. The public client currently executes neither request in its
  tests after the split (#4371). The screen already tests what staff see with a stubbed API.

Run the changed test files in Chromium. In a disposable checkout, remove the refusal or request
handling one case depends on and record the failing assertion, then verify the intact code passes.
Run both package `test:coverage` commands locally, then finish and land through the lane workflow.
Dispatch full `ci.yml` on main and verify both coverage merge jobs on the dispatched SHA. Check the
PR and coverage tables against above before attributing drops. The backlog has no A1616 entry.
Estimate: 0 production lines, 250–400 test lines using existing fixtures, plus this plan.

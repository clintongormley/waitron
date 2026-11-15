# UI mutation regression checks

**Request:** Lane I's `MUTATION-0605-FAILURE` asks to find and fix the scheduled mutation failure. The watcher narrowed this UI work on 15 November at 08:17: “Keep looking for meaningful UI tests for the 58 new misses (tabs, dialog, data table first), never restoring the history-count check. Each needs a test that fails when the behaviour is deleted.”

**Finish line:** one bounded test repair catches misplaced help badges, fields covered after a sticky row grows, and a table row left highlighted after keyboard focus leaves. Existing assertions remain. This alone does not promise a passing aggregate; the overall UI failure stays open.

**Reuse and size:** reuse three existing Chromium cases/files, theme hosts, `frames()` and native keyboard interaction. Production +0/-0; tests about +10/-0; shared support +0/-0; this plan about +35/-0. No new test project or helper. Execute inline after Claude review and watcher clearance; neither is owner design approval.

- [ ] In `packages/ui/src/components/wt-tabs.help.test.ts`, offset the local `setup()` theme host by 80px left and 60px top. Keep all existing LTR/RTL coordinate assertions and the other cases. In a disposable copy, replace both badge-coordinate subtractions with addition: expect the existing placement checks to fail horizontally; restore x alone and expect vertical failure; restore both and require the full file to pass.
- [ ] In `packages/ui/src/components/wt-tabs.test.ts`, extend the first `sticky=%s keeps its strip visible and focused fields below it` fixture with a 40px action-slot button. After the initial sticky assertions, let existing `frames()` settle, grow only the action to 120px, and settle again. Keep the existing input scroll-margin and actual `scrollIntoView` clearance assertions. Deleting only the row's `ResizeObserver.observe(row)` must fail the margin assertion; restoring it must pass the full file.
- [ ] In `packages/ui/src/components/wt-data-table.test.ts`, extend `keeps a clickable row lifted when Tab reaches a shared button inside it`: after its final ArrowDown assertion, press Tab, assert focus reaches the second row activator, then assert every prior-row cell loses the lifted background. Removing only `focusout` from the connected listener list must fail that background assertion; restore the source and require the full file to pass.

**Test ownership:** these browser tests check rendered placement, scroll clearance and painted focus. Mutate only the disposable copy, preserve every existing assertion and report warnings. The completed diagnostic controls pass 11 badge cases, 93 tab cases and 586 table cases after source restoration. Row-observation deletion runs also logged ResizeObserver loop warnings; they are not clean-run receipts. Removing the table's event-type condition alone still passed: no detection is claimed for it.

Run every changed file, reading actual counts:

```sh
pnpm --filter @waitron/ui exec vitest run src/components/wt-tabs.help.test.ts src/components/wt-tabs.test.ts src/components/wt-data-table.test.ts
```

**Limits:** do not change product code, thresholds, exclusions, projects, navigation spies or dialog behavior; do not restore `history.length`. Keep the existing helper-owner-decision backlog bundle open; do not invent a new backlog entry merely to delete it. No existing backlog entry describes these fixture gaps, so this repair does not complete one.

The complete failed-night UI score is 11,812/13,172 (89.675%). It needs 43 more detections at that denominator; these checks promise no such count. Leaving the two Node-only helpers out gives 11,812/13,047 (90.534%) arithmetically, but that remains the owner's decision and is not verified qualification. DB's separate refresh already passed its required run, `43691802402`, after #3310.

Once cleared and built, run `finish-branch` with Claude's run-it review, the normal hook and current-head scoped CI. Keep one test-repair PR. The overall UI failure closes only after the repair as a whole passes the required `mutation.yml` run on main with `packages=ui`; do not dispatch that run while this partial repair cannot yet establish the aggregate result.

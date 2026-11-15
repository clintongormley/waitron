# UI mutation regression checks

**Request:** Lane I's `MUTATION-0605-FAILURE` asks to find and fix the scheduled mutation failure. The watcher narrowed this UI work on 15 November at 08:17: “Keep looking for meaningful UI tests for the 58 new misses (tabs, dialog, data table first), never restoring the history-count check. Each needs a test that fails when the behaviour is deleted.”

**Finish line:** one bounded test repair catches misplaced help badges, fields covered after a sticky row grows, and a table row left highlighted after keyboard focus leaves. Existing assertions remain. This alone does not promise a passing aggregate; the overall UI failure stays open.

**Reuse and size:** reuse three existing Chromium cases/files, theme hosts, `frames()` and native keyboard interaction. Production +0/-0; tests about +10/-0; shared support +0/-0; this plan stays within one page. No new test project or helper. Execute inline after Claude review and watcher clearance; neither is owner design approval.

- [ ] In `packages/ui/src/components/wt-tabs.help.test.ts`, set `host.style.margin = "60px 0 0 80px"` in the local `setup()`. Keep all existing LTR/RTL coordinate assertions and the other cases. In a disposable copy, replace both badge-coordinate subtractions with addition: expect the existing placement checks to fail horizontally; restore x alone and expect vertical failure; restore both and require the full file to pass.
- [ ] In `packages/ui/src/components/wt-tabs.test.ts`, extend the first `sticky=%s keeps its strip visible and focused fields below it` fixture with a 40px-high button in `slot="actions"`. After the initial sticky assertions, let existing `frames()` settle, change only that button's height to 120px without changing its width, and settle again before the existing input scroll-margin poll. Keep that poll and the actual `scrollIntoView` clearance assertions. Deleting only the row's `ResizeObserver.observe(row)` must fail the margin assertion; restoring it must pass the full file.
- [ ] In `packages/ui/src/components/wt-data-table.test.ts`, extend `keeps a clickable row lifted when Tab reaches a shared button inside it`: after its final ArrowDown assertion, press Tab, assert focus reaches the second row activator, then assert every prior-row cell loses the lifted background. Removing only `focusout` from the connected listener list must fail that background assertion; restore the source and require the full file to pass.

**Test ownership:** these browser tests check rendered placement, scroll clearance and painted focus. Mutate only the disposable copy, preserve every existing assertion and report warnings. The completed diagnostic controls pass 11 badge cases, 93 tab cases and 586 table cases after source restoration. Row-observation deletion runs also logged ResizeObserver loop warnings; they are not clean-run receipts. Removing the table's event-type condition alone still passed: no detection is claimed for it.

**Targets and remaining search:** the four demonstrated changes are the two subtractions at `wt-tabs.ts:332-333`, the row observation at `wt-tabs.ts:228`, and `"focusout"` in the connected listener list at `wt-data-table.ts:1206`. Compare those targets with the eventual complete mutation reports; do not infer an aggregate gain from manual controls. Other tab/table survivors have not been ruled out. Dialog survivors were read but not deletion-controlled; no dialog repair is justified here yet. Navigation's false-positive history-count losses were reproduced, while the current spy starting points and exact counts were retained; further useful navigation checks remain unexplored. This is a bounded partial result, not the end of that search.

Run every changed file, reading actual counts:

```sh
pnpm --filter @waitron/ui exec vitest run src/components/wt-tabs.help.test.ts src/components/wt-tabs.test.ts src/components/wt-data-table.test.ts
```

**Limits:** do not change product code, thresholds, exclusions, projects, navigation spies or dialog behavior; do not restore `history.length`. Keep the existing helper-owner-decision backlog bundle open; do not invent a new backlog entry merely to delete it. No existing backlog entry describes these fixture gaps, so this repair does not complete one.

The complete failed-night UI score is 11,812/13,172 (89.675%). It needs 43 more detections at that denominator; these checks promise no such count. Leaving the two Node-only helpers out gives 11,812/13,047 (90.534%) arithmetically, but that remains the owner's decision and is not verified qualification. DB's separate refresh already passed its required run, `43691802402`, after #3310.

Keep these checks on one UI repair branch; do not open a partial test PR now. Await the owner's helper decision or a separately reviewed meaningful repair before `finish-branch`, then use Claude's run-it review, the normal hook and current-head scoped CI. The overall UI failure closes only after the repair as a whole passes the required `mutation.yml` run on main with `packages=ui`; do not dispatch that run while this partial repair cannot yet establish the aggregate result. The watcher must clear this branch-holding approach before build.

**15 November, owner decision (watcher’s 12:12 note in Lane I questions.md):**
The owner chose “Leave them out (Recommended)”: remove `vitest-park-pointer.ts`
and `vitest-pointer-gestures.ts` from UI’s mutate list and land the three checks.
This supersedes the exclusion/holding limits above; no owner plan approval is claimed.
Add exactly those two exclusions to `packages/ui/stryker.config.json`; add the same
files to the existing UI-only exclusion assertion in `scripts/mutation-shard.test.mjs`,
keeping all prior values and the 90 floor. No source or coverage setting changes.
Remove the standalone helper entry and the obsolete two-entry bundle in
`docs/backlog/ci.md`; point its index row directly to the retained DB static-mutant
question at `backlog/ci.md#packagesdbs-static-mutants-are-not-in-its-mutation-score`.
Record the helper choice under CI’s decisions. Additional code/config about +3/-1, guard +2/-0, docs +6/-20.
Run the complete mutation-shard guard and the three browser files; then finish/CI/land.
Dispatch `mutation.yml --ref main -f packages=ui` and read all shard and aggregate
results before calling the scheduled UI failure fixed. The earlier score is arithmetic,
not qualification; no new test project, helper, mutator or lower threshold is needed.
The earlier instructions to keep the helper bundle open and await its owner decision
are superseded; the threshold limit remains. Claude reviewed this addendum and its
corrections are applied; watcher clearance is still required before the config/guard build.
If main’s score is below 90, keep this item open and report the actual score and shards;
change no threshold and add no further exclusion.

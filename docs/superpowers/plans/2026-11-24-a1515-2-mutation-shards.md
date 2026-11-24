# Split the Shared set-menu mutation work

This follows the watcher’s 24 November 14:48 decision for #4224. The set-menu calculation can reach
main once all four Shared mutation jobs fit their ten-minute budget and their combined score reaches
90. Use the existing range support and the existing four jobs. The calculation and its search limits
stay as reviewed in the [grouping plan](2026-11-24-a1515-2-set-menu-grouping.md).

- [ ] In `scripts/mutation-shard.test.mjs`, expect two contiguous ranges for
  `src/set-menu-grouping.ts` in the first two jobs and update the `HEAVY_FILES` pin. Require
  every other source file exactly once across jobs three and four, except the two named fixture
  files. Run this test file and observe it fail against the old selection.
- [ ] In `scripts/mutation-shard.mjs`, name Shared’s grouping file with two ranges in `HEAVY_FILES`.
  In `packages/shared/stryker.config.json`, exclude `!src/**/*.fixtures.ts`. Search the tree first
  for consumers of `set-menu-fit.fixtures.ts` and `set-menu-bill.fixtures.ts`. Each supplies inputs
  to test files. Keep the fixture sizes and every price, placement and replay assertion from `80335c451c`.
  Run the 40-diner timing test under ordinary Vitest.
- [ ] Run the shard and workflow guards and the focused Shared test files. Compare Stryker’s full
  grouping-file mutant count with the sum of the two range counts. Report the difference in #4224.
  Score every selected range and remaining shard, then use the existing aggregate command at 90.
  Use three ranges only if a range exceeds the job limit. Check with the watcher if the single
  remaining job for the other files then exceeds its limit.
- [ ] Update the comments in the sharder and `ci.yml` and the Shared mutation guide and its link in
  `docs/developers/ci-and-gates.md`. Record the changed guard checks and CI results in the PR,
  along with the import audit showing the excluded fixtures only supply test inputs. Land after
  current-head CI.

Expect two configuration lines, about 15 test lines and brief documentation updates. A new
workflow, calculation change or mutation-floor change is outside this plan.

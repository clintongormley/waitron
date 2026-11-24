# Split the Shared set-menu mutation work

This follows the watcher’s 24 November 14:48 decision for #4224. The set-menu calculation can reach
main once all four Shared mutation jobs fit their ten-minute budget and their combined score reaches
90. Use the existing range support and the existing four jobs. The calculation and its search limits
stay as reviewed in the [grouping plan](2026-11-24-a1515-2-set-menu-grouping.md).

- [ ] In `scripts/mutation-shard.test.mjs`, expect two contiguous ranges for
  `src/set-menu-grouping.ts` in the first two jobs. Require every other eligible file exactly once
  across jobs three and four, with both set-menu fixture files absent. Run this test file and
  observe it fail against the old selection.
- [ ] In `scripts/mutation-shard.mjs`, name Shared’s grouping file with two ranges in `HEAVY_FILES`.
  In `packages/shared/stryker.config.json`, exclude `!src/**/*.fixtures.ts`. Search the tree first
  for consumers of `set-menu-fit.fixtures.ts` and `set-menu-bill.fixtures.ts`. Each supplies inputs
  to test files. Keep all existing price, placement and replay assertions. Use the compact six
  fixtures only if the complete scored run supports them, including the 40-diner timing case.
- [ ] Run the shard and workflow guards and the focused Shared test files. Compare Stryker’s full
  grouping-file mutant count with the sum of the two range counts. Report the difference in #4224.
  Score every selected range and remaining shard, then use the existing aggregate command at 90.
  Use three ranges only if a range exceeds the job limit. Keep at least two bins for the other
  files, adding a shard only if necessary to retain those bins.
- [ ] Update the Shared mutation section of `docs/developers/ci-and-gates.md` and record any changed
  guard checks, eligible-file changes and CI results in the PR. Land only after current-head CI.

The intended code change is two configuration lines plus about 15 test lines and a short update
to the CI guide. A new workflow, calculation change or mutation-floor change is outside this plan.

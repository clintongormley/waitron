# Keep the forty-diner set-menu check reliable

The nightly should check that a forty-diner bill with two percentage discounts totals 83,327 cents and completes within a CPU budget that allows for coverage. Ordinary runs keep the existing 500 ms limit. Lane F's watcher assigned this on 25 November at 03:31.

The first scheduled run after #4224 added the check failed at 680 ms on Ubuntu with V8 coverage. On Node 26.13.1 on macOS, three whole-file runs of the same fixture with coverage used 546–646 ms on `b925d5f767`, the parent of #4267, and 578–679 ms on `1c2057aadf`. All six ran below 181 ms without coverage. A cold, case-only run with coverage reached 884 ms. Every run returned 83,327 cents. A covered profile spent 477 ms of samples scanning the dish-placement graph. A scratch change to use an indexed loop still failed its three covered runs. [Nightly failure](https://github.com/clintongormley/waitron/actions/runs/45532039292/job/138929805703)

## Change and verify

1. Keep `packages/shared/src/set-menu-grouping.test.ts` as the regression test. Its original CPU assertion is already red in the covered runs above, and the fixture checks the price before the CPU limit.
2. In `packages/shared/vitest.config.ts`, register `test/coverage-mode.ts` as global setup. That file reads `TestProject.globalConfig.coverage.enabled` and passes it to the test through Vitest's typed `provide` and `inject` API. In the forty-diner test use 1,500,000 CPU microseconds with coverage and 500,000 in ordinary runs. The covered ceiling leaves about 70% above the slowest observed covered sample, which ran the case cold. Use the effective configuration so `--coverage.enabled=false` retains the ordinary ceiling. Keep Stryker's compact fixture and 1,817-cent assertion.
3. Run the grouping file with `pnpm --filter @waitron/shared exec vitest run src/set-menu-grouping.test.ts` with coverage off, explicitly off, and on. A filtered coverage run measures only the file and does not establish package-wide thresholds. Use the same fixture in disposable controls that force the ordinary ceiling with coverage and a too-low ceiling in an ordinary run. Check that each fails at its CPU assertion and that the mutation fixture still checks its price. Run the Shared typecheck and let the existing hook and PR CI run their checks.
4. After landing, coordinate with the watcher for one full `ci.yml` dispatch on `main` containing Lane E's fix as well. Check the exact SHA, `test-light-a` and the full run's result.

About 15 lines of test and setup changes. Keep the production grouping and pricing code, existing coverage thresholds, and CI workflow. The watcher filed this failure in the lane queue, which holds the tracking entry.

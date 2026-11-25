# Keep the forty-diner set-menu check reliable

The Shared suite should check that a forty-diner bill with two percentage discounts totals 83,327 cents and uses at most 20 placement solves, including when the nightly collects coverage. Ordinary runs also keep the 500 ms CPU ceiling. The watcher assigned the failure to Lane F at 03:31 and cleared these two checks at 03:56 on 25 November.

The old assertion measures process CPU time. Ubuntu's nightly measured 680 ms against a 500 ms ceiling. On Node 26.13.1 on macOS, three whole-file runs with V8 coverage measured 546–646 ms before #4267 (`b925d5f767`) and 578–679 ms on the starting main (`1c2057aadf`). All six ordinary runs came in at 152–180 ms. Every run returned the same price. The covered failure predates #4267 in this reproduction. [Nightly failure](https://github.com/clintongormley/waitron/actions/runs/45532039292/job/138929805703)

Claude proposed counting placement solves, using the existing spy pattern in `packages/shared/src/set-menu-search.test.ts`. In a disposable checkout the forty-diner bill needed 15 solves in both modes. Raising `REFINEMENT_WORK_LIMIT` from 16,000 to 1,600,000 kept the price while raising the count to 62. A limit of 20 rejected it in both modes. CPU time varied between runs. The watcher also measured covered runs at 288–317 ms. Repeating the solver's path scan eight times kept 15 calls and the same price while breaking the ordinary timing check.

## Change and verify

1. In `packages/shared/src/set-menu-grouping.test.ts`, count calls to the real `solvePlacement` with `vi.spyOn`, as the sibling search test does. Assert 1–20 calls on the same forty-diner input in both modes and read the count before restoring the spy. Keep both prices and the compact mutation fixture.
2. Run the grouping file in ordinary mode and validate with V8 coverage. Run the Shared typecheck and compact mutation case. In a disposable checkout, lift the refinement limit and check that the count fails in both modes. Then repeat the solver path scan eight times and check that the ordinary CPU assertion fails. Restore the original code and check the case again.
3. Once this fix, Lane E's Country Packs fix (#4293), and Lane K's NIGHTLY-STEPDOWN are on main, Lane F dispatches `gh workflow run ci.yml --ref main`. Verify the run's SHA includes all three fixes, then read Shared and the full result.

The whole-branch review reproduced a covered timing failure in “opens a useful menu at the limit and closes it after a cancellation”. The watcher cleared this case at 04:07. Use one helper to skip the 500 ms timing assertions for the two forty-diner cases when the worker reports coverage enabled. Keep the neighboring case's existing placement, price and cancellation assertions, and the earlier eight-diner timings.

Expect about 25 test lines added. The lane queue is the tracking entry for this failure.

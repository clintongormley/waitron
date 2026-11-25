# Keep the forty-diner set-menu check reliable

The Shared suite should check that a forty-diner bill with two percentage discounts totals 83,327 cents and uses at most 20 placement solves, including when the nightly collects coverage. The watcher assigned this test failure to Lane F on 25 November at 03:31.

The old assertion measures process CPU time. Ubuntu's nightly measured 680 ms against a 500 ms ceiling. On Node 26.13.1 on macOS, three whole-file runs with V8 coverage measured 546–646 ms before #4267 (`b925d5f767`) and 578–679 ms on the starting main (`1c2057aadf`). All six ordinary runs came in at 152–180 ms. Every run returned the same price. The covered failure predates #4267 in this reproduction. [Nightly failure](https://github.com/clintongormley/waitron/actions/runs/45532039292/job/138929805703)

Claude proposed counting placement solves, using the existing spy pattern in `packages/shared/src/set-menu-search.test.ts`. In a disposable checkout the forty-diner bill needed 15 solves in both modes. Raising `REFINEMENT_WORK_LIMIT` from 16,000 to 1,600,000 kept the price and exact result while raising the count to 62. A limit of 20 failed the control in both modes and passed when restored. The limit leaves room for five more calls and protects the amount of placement work on this bill. The existing fit timing checks still measure solver speed on their own fixtures.

## Change and verify

1. In `packages/shared/src/set-menu-grouping.test.ts`, count calls to the real `solvePlacement` with `vi.spyOn`, as the sibling search test does. Assert at most 20 calls on the same forty-diner input. Read the call count before restoring the spy. Keep both price assertions and the compact mutation fixture. Remove the CPU timer and its now-unused type from this file.
2. Run the whole grouping file without coverage and with V8 coverage, and run the Shared typecheck. Repeat the single-case refinement-limit control in a disposable checkout on the final code. The control must fail at the placement-call assertion and pass after restoration. Exercise the compact mutation case and let the normal hook and PR CI run their checks.
3. Once this and Lane E's nightly fix are on main, Lane F dispatches `gh workflow run ci.yml --ref main` and reads the result. Confirm the dispatch SHA includes both fixes and check the Shared job and the full run. Verify Lane E's exact merge SHA with the watcher before dispatch.

Expect about 10 test lines added and a similar number removed. Production grouping, the fit timing cases, coverage configuration, and the CI workflow stay as they are. The lane queue is the tracking entry for this failure.

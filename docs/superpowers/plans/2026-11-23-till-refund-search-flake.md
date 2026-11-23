# Wait for the search request in the till refund test

The browser test can reach the refund and check that the search text, filters, sort and page
survive the return to Transactions when Chromium falls behind during search setup.

The screen waits 200 ms before sending a typed search. The test polls with `vi.waitFor` for up
to 1,000 ms. If that deadline runs before the next poll, Vitest throws the previous poll's error.
In the scratch reproduction at `554af5ed58`, the table emitted the search at 8 ms, Chromium was
busy from 33 ms to 1,109 ms, and the correct request arrived at 1,110 ms. At 1,112 ms the test
still reported `q: ""`. In CI runs `43259195658` and `45083073547`, failure screenshots started
1.427 s and 1.250 s after Playwright reported the fill complete. Those runs lack the query trace
needed to establish their exact ordering.

- [ ] In `apps/till/src/till-app.test.ts`, add `q` to the `listTransactions` stub's query type in
  “a completed refund keeps the Transactions query, filters, sorting and page while leaving the
  basket intact”. Create a promise before the fill and resolve it from the stub for `q: "0091 "`.
  Await it after the real fill and keep the request assertion. Vitest's 15-second browser test
  timeout bounds the wait. Keep the filter, paging and refund assertions. This case is the scope
  of the change. The named debounce test and other polling waits retain their current timing.
- [ ] Apply `poll-control.patch` from `~/waitron-campaign-i/receipts/till-refund-search-flake-20261123/`
  in a disposable checkout of `554af5ed58`. It requests a block 20 ms after the fill completes
  and releases it after 1,100 ms. Run the named refund case once with `pnpm --filter @waitron/till
  exec vitest run src/till-app.test.ts -t 'a completed refund keeps the Transactions query'`.
  The old test reports `q: ""` after the correct request, as in `local-poll-stale.log` there.
  Run the same control once with the proposed change, then suppress the matching query in the
  disposable copy and confirm the case hits its timeout. Retain the logs outside the branch.
- [ ] Run the changed `src/till-app.test.ts` file and “debounces typed search once, preserves its
  trailing space and uses only that server page” in `src/screens/till-find-bill-screen.test.ts`.
  Remove the two refund paragraphs in `docs/backlog/ci.md` after the focused proof. Rebase and
  repeat focused checks if Lane D overlaps the test file.

Expect 0 product lines and about 8 added and 4 removed test lines, plus this plan and the backlog
cleanup. The ask is TILL-REFUND-SEARCH-FLAKE in the Lane I queue and the fourth unexplained
incident in `docs/backlog/ci.md`.

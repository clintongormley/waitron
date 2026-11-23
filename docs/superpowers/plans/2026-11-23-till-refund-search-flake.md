# Wait for the search request in the till refund test

The browser test can reach the refund and verify that the search text, filters, sort and page
survive the return to Transactions, even if the browser falls behind during search setup.

On Chromium at `554af5ed58`, a scratch task blocked the renderer from 33 ms to 1,109 ms
into the search. The table emitted the correct search at 8 ms and the till sent it at
1,110 ms. `vi.waitFor` still threw its previous assertion with `q: ""` at 1,112 ms, after
that API call. The error matches runs `43259195658` and `45083073547`; those runs lack a
trace of the query and request, so the precise ordering in those failures is unknown.

- [ ] In `apps/till/src/till-app.test.ts`, make the existing `listTransactions` stub in
  “a completed refund keeps the Transactions query, filters, sorting and page while leaving the
  basket intact” resolve a test-local promise when it receives `q: "0091 "`. Await that request
  after the real fill and keep the request assertion. The case's existing test timeout bounds
  the wait. Keep the real filter and paging actions and all post-refund assertions. The screen
  test “debounces typed search once, preserves its trailing space and uses only that server page”
  continues to own the debounce and wire query. Product code, shared test helpers and other
  cases are outside this change.
- [ ] In a disposable checkout, run the focused refund case with the same early renderer block.
  The old test must fail with `q: ""` even though the trace records the new query before the
  error. Apply the test change and repeat the same block. Also suppress the filled query in
  the disposable copy and verify the test still fails. Keep these experiments out of the branch.
- [ ] Run the changed `src/till-app.test.ts` file and the named debounce case in
  `src/screens/till-find-bill-screen.test.ts` with `pnpm --filter @waitron/till exec vitest run`.
  Remove the refund incident's two paragraphs from `docs/backlog/ci.md` once the controlled
  test passes. The other incidents still use the index entry in `docs/backlog.md`.

Expected change is 0 product lines and about 8 added and 4 removed test lines, plus the plan
and backlog deletion. References are the TILL-REFUND-SEARCH-FLAKE queue item and the fourth
unexplained incident in `docs/backlog/ci.md`.

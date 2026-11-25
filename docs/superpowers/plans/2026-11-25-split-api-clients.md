# Split the Dashboard and Till API clients

Move each area's calls and types together so you can find a request in a file under 1,000 lines.
Keep `new DashboardApi(...)`, `new TillApi(...)` and `api.method(...)` at their current call sites.
The watcher queued the work on 25 November at 13:35. The class arrangement, two constructor edits
and Dashboard route-test change below need the watcher's clearance.

## Two pull requests

- **Dashboard first.** Under `apps/dashboard/src/api/`, split menu and catalog, people and roster,
  venue and floor, devices, printing, reports and purchase invoices, box and cloud, payments,
  orders, email and theme. Keep the real class and request setup in `client.ts`, including
  background reads, the fresh-sign-in request, locale caching and calls that use that private state.
- **Till next.** Under `apps/till/src/api/`, split menu and catalog, orders and drafts, payments,
  kitchen and pass, device and session calls, floor and parties, attendance and invoices. Keep the
  real class, request and person-header handling, whole-bill request state and live events in
  `client.ts`. Keep `#todayChange` with its callers. Reuse the existing request types where possible.
- Each area class stores the same request callback in its own `#request` field, so the moved methods
  retain their text. Chain the area classes and have the real client inherit the last one. Change
  the constructor bodies only to pass the request callback and initialise instance state after
  `super`. Keep the area constructors free of requests. Order the areas so methods can reach their
  dependencies, and keep a group together if its methods call one another.

## Build and verify each move

- Extend `scripts/move-ts-declarations.mjs` using its route-lift pattern. Put names in
  `scripts/dashboard-client-split.json` or `scripts/till-client-split.json`. Verify moved method and
  function bodies byte for byte, and compare type declaration tokens after formatting. Allow only
  the named constructor changes in retained methods. Rewrite named and inline type imports to the
  definition. Remove forwarding exports and check for runtime import cycles. Stage new files and
  run `scripts/product-file-size.test.ts`. Remove both `client.ts` caps when they fit the default.
- Run each changed API suite and both app typechecks. Keep the A4 guard's checks and point them at
  the relocated declarations. Keep Till's person-fetch guard and its source anchors. Walk the
  prototype chain in Dashboard `client-routes.test.ts` so its forbidden-name assertion still sees
  every method. First reproduce inherited-route omission and inline-import handling in focused
  checks. Run `scripts/move-ts-declarations.test.mjs` for the mover's own test cases.
- Agree a quiet hour with the watcher for each app. Before opening its PR, run the **full** map on
  disposable copies of the base and a real open branch that edits the client. Compare the branch's
  edits after the move and run focused tests and typecheck. Include the replay command in the PR so
  lanes can run it before rebasing. Land the complete app move after current-head CI passes.
  Update live backlog references in that PR. [Replay steps](2026-11-24-working-order-file-split.md#carry-an-open-branch-across-the-split).
- **Size estimate.** Dashboard about 5,500 lines moved, Till about 5,000. Expect roughly 600–1,200
  import lines per app. Aim for 200–350 new mover lines shared by both and 80–150 focused test
  lines. A source scan counted 164 Dashboard and 524 Till member lines outside the simple moves,
  before imports and grouping. Measure caps on the resulting files.

A disposable copy of open PR #4334 carried its widget edit across a seven-type move. Dashboard
typecheck and 166 API cases passed. A separate TypeScript and Node pilot moved `listMenus` and
`listZoneOffers` with exact method text and verified their request arguments. The old route
inventory missed a deliberately inherited `listTills`. Walking the prototypes caught it. The two
probes cover a sample only. The full replay needs the reviewed mover and maps.

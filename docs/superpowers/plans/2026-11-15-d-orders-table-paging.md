# Orders: shared database-backed table pages

**Finish:** Orders has 50-row pages, Previous/Next and matching totals, whole-dataset search, SQL sorting and passive live reads through `TableRequestController`. One PR within three build hours; Lane D's elapsed-time stop applies. Separate Sol-high draft: driver verification, Claude review and watcher clearance precede implementation. No owner design approval exists.

**Ask/source:** Lane D `queue.md`, started 2026-11-15 20:51: move Orders onto the shared requests used by Users; retain SQL sorting for this potentially large dataset. Reference: `2026-11-15-d-table-paging-users.md` and `docs/backlog/dashboard.md#shared-database-backed-table-paging-search-and-sorting`.

1. **Query.** Keep status/date/credited/staff/table controls, URL filters (`orders-filter.ts`), today's business-day default and session visibility. “Whole dataset” means all rows those filters and permissions permit, before paging.
   Keep exact order/invoice/corrective-number search and ranked words over party/table names, including saved names and trailing-space semantics. No search expansion.
   Enable exactly `opened`, `invoice`, `total` header sorts, ascending/descending. Empty or hidden sort uses word rank ascending, then `at DESC, id DESC`; without words, newest first. An explicit sort replaces relevance ordering while retaining the same search matches.
   Opened sorts `at`; Invoice sorts series code with SQLite `NOCASE`, then numeric invoice number; Total sorts the displayed original total as integer cents (invoice total, otherwise line total), never formatted text or net after credits. Null invoices sort last in both directions; every primary tie ends `at DESC, id DESC`.
   Bill, Table, Status, Still owed, Staff and Actions remain unsortable.

2. **Server selection/totals.** In `apps/server/src/orders-list.ts`, add `listOrdersTablePage`; reuse `rowsSql`, filter/search clauses, materialized ranking and an extracted existing row hydrator. Share only construction needed by both readers.
   Count identical filtered matches, clamp the zero-based page (empty means page 0), then SQL `ORDER BY`, `LIMIT 50 OFFSET`; hydrate selected rows only. Await reads sequentially in the existing transaction. No JavaScript key sorting.
   In `apps/server/src/orders-api.ts`, add `GET /management-api/orders/page` before `/:id`, reusing query parsing, `scoped`, `orderScope` and date-window resolution. Return `{ rows, total, page, pageSize: 50, from, to }`.
   Accept existing filters plus `page`, `sortKey` and `sortDirection`; validate nonnegative safe page/offset, the three keys or empty, and `ascending|descending`. Default page 0, empty sort, descending; refuse cursor/size overrides with `management.request_invalid` naming the field. Use fixed SQL fragment maps and bound values.
   Preserve `listOrders`, `ordersPageSql`, cursor responses and `readVisibleOrder` contracts for lookup/find-bill/upgrade/detail consumers; add no count to them. Leave fiscal writes and detail/action permissions unchanged.

3. **Dashboard request/presentation.** In `apps/dashboard/src/api/client.ts`, add `listOrdersPage` and query/page DTOs; retire cumulative `listOrderPages` after updating traced callers, retaining cursor `listOrders`.
   In `api/live-queries.ts`, transfer the cumulative reader's full dependencies to the new method. Update `apps/server/scripts/a1308/time-today-wake.ts`'s reader/route mapping so its existing Orders measurement follows the adopted read.
   In `screens/orders-screen.ts`, inject `DashboardQueries.watch` into the unchanged shared controller. Map `q` to its `search`, take only sort from `wt-query-change`, and wait for the initial restored query before reading. External controls remain authoritative; filter/search/sort changes reset page 0.
   Replace Show more with `serverPaging`, localized range/Previous/Next and `wt-page-change`. Supply `sortValue` for the three sortable headers only; server mode does no local search/sort. Reuse table accessibility/overflow.
   Reuse Users' returned-page/clamping and refused-move retry handling, retaining rows during requests. Keep the existing table-text debounce and immediate Enter/composition behavior; use the controller's 200 ms debounce for search. Keep URL navigation and field refusals.
   Observers assign snapshots; query replacement owns stale replies and passive refresh/error recovery. Keep detail/print dialogs when their row leaves the page. Shared controller/table stay unchanged.

4. **TDD by layer.** Write assertions first, run the owning file and observe the expected failure; implement minimally and rerun. Preserve behavioral assertions when adapting fixtures; replace cumulative-page expectations only.
   New `apps/server/src/orders-list.paging.test.ts`: use `useVenueDb` and existing `testing/order-venue.ts` writers. More than 100 rows prove 50-row boundaries/count/clamp, matches beyond page one, each direction of all three sorts, numeric totals/invoices, null/tie ordering and default relevance versus explicit sort. Include filtered/scoped totals and hydrated credit/payment/table/staff facts.
   Extend `orders-list.reads.test.ts`: the new page hydrates only its selected rows with no per-row reads; retain the cursor reader's seven-read, rank-after-filter and index assertions. No new planner/performance claim or year-data benchmark.
   New `apps/server/src/orders-api.paging.test.ts`: route precedence, session/staff visibility, date defaults, invalid page/sort/size/cursor refusals and exact response shape. Query semantics stay in the list tests.
   Adapt dashboard `api/{client-routes,live-queries}.test.ts`, `screens/orders-screen.test.ts` and `screens/orders-screen.a11y.test.ts`: serialization/dependencies; restored sort, page/reset requests, no replay of earlier pages, passive refresh, stale reply/error recovery, retry/clamp and surviving dialogs. Retain `orders-filter.test.ts` URL/search assertions.
   Update Orders stubs in dashboard `dashboard-app{,.unsaved-changes,.schedule-unsaved,.disk-stop,.help,.venue-settings-unsaved}.test.ts`, preserving assertions. Reuse test helpers.

**Focused verification:** `pnpm --filter @waitron/server exec vitest run src/orders-list.paging.test.ts src/orders-api.paging.test.ts src/orders-list.test.ts src/orders-list.reads.test.ts src/orders-api.test.ts src/bill-lookup-api.test.ts src/boot.upgrade.test.ts`; also rerun affected named consumers if shared SQL/hydration changes expose another dependency.
Run dashboard's changed test files plus `src/screens/orders-filter.test.ts`; run UI `src/components/table-request-controller.test.ts` and `src/components/wt-data-table.server-paging.test.ts` with `pnpm --filter @waitron/<package> exec vitest run <files>`. Read actual test counts. Normal pre-push checks and current-head scoped CI finish validation, without a whole-workspace local run.

**Look and document:** inspect EN/ES, light/dark, phone/desktop: headers/`aria-sort`, footer, overflow, loading/empty/refusal and row dialogs. Update `apps/server/src/guide/{en,es}/table-service.md` with matching section ids; run server `guide-content.test.ts` and root `scripts/guide-links.test.ts`.
Document Orders in the tables section of `docs/developers/design-system.md`; update `docs/backlog.md` and `docs/backlog/dashboard.md`, retaining returned invoices and Find a bill as later adopters.

**Forecast, added/removed lines:** production +260/−100; tests +350/−140; support +20/−20; docs (including this plan) +75/−10. Total 975 changed lines; stop for watcher opinion before exceeding 1.5× (1,463 lines), or at the runbook's three-hour limit.
**Excluded:** handover returned invoices, other adopters, expanded search, additional sorts, in-memory sorting, benchmark work, schema/migrations, new query frameworks/protocols/ledgers, fiscal writes and permission changes. No unresolved scope decision is identified; material departures go to the watcher before building.

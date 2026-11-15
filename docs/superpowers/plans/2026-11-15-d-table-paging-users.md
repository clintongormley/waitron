# Users: database-backed table requests

**Finish line:** One PR, under three build hours: Users shows 50 rows per page, searches and sorts the complete database dataset, and retains live updates, existing controls, all six sortable columns, row actions and the default “current users” filter. Queue work is owner-authorised; this design still requires Claude approach review and watcher clearance.

**Reuse:** Keep `wt-data-table` unchanged: use `serverPaging`, `wt-query-change` and `wt-page-change`. Put reusable request state in dashboard-kit, delegating observation, superseded-response rejection and passive refresh to existing `DashboardQueries`/`QueryController`/`LiveData`.

## Implementation

1. Add `TableRequestController` with injected watch/release callbacks, query state, zero-based page, loading state and cleanup. Debounce search alone by **200 ms**; filter, sort and page changes run immediately. Query changes reset page to zero and release the previous observation immediately, including during debounce. Cancel pending timers on disconnect. Retain external search/role/status controls; forward table events without duplicate requests.

2. Add **GET `/management-api/staff/page`**, `DashboardApi.listStaffPage(query)` and identity `listPersonsPage(tx, { managementSessionId, ...query })`. Query contains `page`, `search`, `roleIds`, `status`, `sortKey`, `sortDirection`, `locale`. Return `{ rows, total, page, pageSize }`.

   Validate non-negative safe-integer pages, supported locale, filters and the six-key sort whitelist; fix page size at **50**, refusing size/limit overrides. Reject malformed input with `management.request_invalid`. Authorise `person.manage`. Execute whole-set filtering, count, ordering and LIMIT/OFFSET sequentially within one transaction; clamp pages after count shrinkage.

   Use `waitron_search_rank` over name, email and telephone, retaining trailing-space semantics and rank-first ordering, followed by requested sort and deterministic person-id ties. Use membership EXISTS for role filtering. Localised SQL role keys concatenate translated built-in/custom role labels in deterministic membership order; status/no-role labels come from shared wording. Bind labels as values. Fetch memberships only for returned people, preserving complete per-row role arrays. Extract and reuse summary projection/mapping, including credential booleans.

3. Wire Users to the controller and register page-query dependencies including `roles`. Keep unpaged `listStaff()`/`listPersons()` and `person-edit.ts:440` unchanged. Preserve read/action error ownership, editor drafts and downloads. After `person.email_taken` only, reuse the unpaged read to find and reopen a disabled account outside the displayed page.

## Exact source files

- New: `packages/dashboard-kit/src/table-request-controller.ts`; `packages/shared/src/i18n/person-list-labels.ts`.
- Modify: `packages/dashboard-kit/src/index.ts`; `packages/shared/src/index.ts`; `packages/identity/src/staff.ts`, `index.ts`.
- Modify under `apps/dashboard/src/`: `api/client.ts`, `api/live-queries.ts`, `screens/staff-screen.ts`, `widgets/staff-list.ts`, `i18n/domain.ts`, `i18n/strings.ts`.
- Modify `apps/server/src/management-api.ts`.

## TDD and verification

For each layer, write behavioural assertions, observe the expected failure, implement minimally, then rerun:

- `packages/identity/src/staff.paging.test.ts` (new, `useVenueDb`): >100 users, whole-set matches/order/count, multi-role uniqueness, localised keys, stable ties, page shrinkage, authorisation and secret-free rows.
- `apps/server/src/management-api.staff-paging.test.ts` (new): parser refusals, cap and response contract.
- `packages/dashboard-kit/src/table-request-controller.test.ts` (new): debounce, immediate transitions, reset, release and teardown.
- Dashboard `api/client.test.ts`, `api/live-queries.test.ts`, `screens/staff-filters.test.ts`, `screens/staff-screen.test.ts`, `widgets/staff-list.test.ts`: wire encoding, passive refresh, stale replies, controls and actions. Adapt existing `staff-*.test.ts` screen fixtures without removing behavioural assertions; retain person-edit reload tests.

Deletion controls must expose removed LIMIT, search predicate, stale-response protection and passive refresh. Run focused suites, existing table server-paging tests, and inspect both themes/phone width before `finish-branch`.

Update `apps/server/src/guide/{en,es}/staff.md`, `docs/developers/design-system.md` and `docs/backlog/dashboard.md`, retaining remaining adopters.

**Forecast:** code +400/−80 lines; tests +450/−100; docs +35/−10. No schema/migrations, other table conversions, new Language feature, browser slicing or additional request framework.

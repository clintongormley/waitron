# Menus usage columns implementation plan

Lane D `MENUS-USAGE-COLUMNS` draft for [spec Part 1](../specs/2026-11-23-menus-list-usage-and-archive.md#part-1-two-columns-saying-where-a-menu-is-used). Base `ae659b8a61` includes #4158. Build after Claude's plan review and watcher clearance.

**Result.** Menus shows **Starts** and **Staff can switch** for periods in active departments. Add the department only for names repeated across departments, as in **Bar: Lunch**. Link each name to its editor when editing is allowed. Only a successful read with neither kind of usage shows muted **Not used by any period** in Starts. Staff-only usage leaves Starts empty. Set menus leave both cells empty. Phones stack the lists below Name and Status.

## Tests first

1. `apps/dashboard/src/screens/menus-screen.test.ts`. **Shows starting and staff periods on desktop and phone** checks both roles, duplicate and unique names, unused and set menus, and that links and Actions fit just above the layout breakpoint and at 390 px. **Only a successful read can show unused** checks loading, failure, recovery and a successful empty read. Expect missing usage cells or messages.
2. `apps/dashboard/src/dashboard-app.search-modules.test.ts`. Extend the shell and Periods fixture. **Opens the exact period and follows changes passively** checks the passive GET, live `menu_periods` refresh, a real link click into the editor, Back to Menus, and detachment in a menu editor. **Menu usage follows venue access** checks plain names for read-only access and no read or stale labels when the module or read grant is absent or removed, including a late answer. Expect missing reads or links in the permitted cases.

Run each case with `pnpm --filter @waitron/dashboard exec vitest run <file> -t '<case name>'`. Confirm red before implementing, then rerun to green alongside the existing Menus layout and Periods navigation cases.

## Build

- In `packages/dashboard-kit/src/contract.ts`, add optional `menuPeriodUsage` with read and edit grants and a factory taking the module context and edit access. `watch(publish)` emits `{ periodId, label, menuId, staffMenuIds, href? }` rows or `null` on failure and returns a stop function. Supply it in `packages/venue-service/src/dashboard/index.ts` through `OpeningHoursApi.watchOpeningHours`, deriving labels once per read. Add `periodPath(id)` in `packages/venue-service/src/dashboard/opening-hours-paths.ts` using the existing encoder and Periods controller's `/periods/period/<id>`.
- In `apps/dashboard/src/dashboard-app.ts`, keep `menu.manage` for Menus and pass a stable provider from the enabled module only with `venue.view`, as required by the GET in `packages/venue-service/src/routes.ts`. Require `venue.configure` for editor links, matching Periods. In `apps/dashboard/src/screens/menus-screen.ts`, group usage by menu ID once per read, watch only on the list, and stop and clear on departure or provider change. Omit columns without a provider. Show localized loading or unavailable text until usage is known. Reuse the responsive `wt-data-table` layouts, cell parts and pinned Actions. Use real links with guarded navigation.
- Add labels in `apps/dashboard/src/i18n/strings.ts` and short instructions under `{#menus}` in `apps/server/src/guide/en/products.md` and `apps/server/src/guide/es/products.md`.

**Limits and handoff.** Estimate 130–180 production lines and 140–200 test lines. Scope excludes endpoints, schema or grant changes, archiving, replacement, usage filters and sorting. Run two run-it angles covering the contract and permissions, and the live read, layout and navigation. Get owner approval on desktop and phone screenshots in light and dark before landing.

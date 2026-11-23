# Menus usage columns implementation plan

Lane D's `MENUS-USAGE-COLUMNS` implements [spec Part 1](../specs/2026-11-23-menus-list-usage-and-archive.md#part-1-two-columns-saying-where-a-menu-is-used). Base includes #4158. Claude reviewed the plan, and the watcher cleared it with changes on 23 November at 22:35.

**Result.** Menus shows **Starts** and **Staff can switch** for periods in active departments. Add the department only for names repeated across departments, as in **Bar: Lunch**. Link to the exact period editor when the person can edit it. A successful read with neither kind of usage shows muted **Not used by any period** in Starts. Staff-only usage leaves Starts empty. Set menus leave both cells empty. On phones, stack the lists below Name and Status.

## Tests first

1. `apps/dashboard/src/screens/menus-screen.test.ts`. **Shows starting and staff periods on desktop and phone** covers both roles, unused and set menus, and links and Actions fitting at 390 px and around the stack cutoff with Kind present. **Only a successful read can show unused** covers loading, failure, recovery and a successful empty read. Expect missing usage cells or messages.
2. `apps/dashboard/src/dashboard-app.search-modules.test.ts`. Reuse the real shell and Periods fixture. **Opens the exact period and follows changes passively** covers the passive GET, live `menu_periods` refresh, a click into the named editor, browser Back to Menus, Close to Periods and detachment in a menu editor. **Menu usage follows venue access** covers plain names for read-only access, no read without the module or read grant, and an old answer after access is removed. Expect missing reads or links in the permitted cases. The shell also refuses to start with two enabled providers.
3. `packages/venue-service/src/dashboard/index.test.ts` covers active departments, duplicate names, edit access and read failure. `opening-hours-paths.test.ts` checks the encoded editor address.

Run each named case with `pnpm --filter @waitron/dashboard exec vitest run <file> -t '<case name>'`. Observe the expected failure, implement, then rerun alongside the existing Menus layout and Periods navigation cases.

## Build

- Add optional `menuPeriodUsage` to `packages/dashboard-kit/src/contract.ts` with read and edit grants and a factory taking the module context and edit access. Its `watch(publish)` emits `{ periodId, label, menuId, staffMenuIds, href? }` rows or `null` on failure and returns a stop function. Supply it in `packages/venue-service/src/dashboard/index.ts` using the passive opening-hours read and a watch on `menu_periods`, `departments` and `menus`. Derive labels once per read. Add `periodPath(id)` to `packages/venue-service/src/dashboard/opening-hours-paths.ts` using the existing encoder for `/periods/period/<id>`.
- In `apps/dashboard/src/dashboard-app.ts`, refuse two enabled providers and pass a stable provider only with its read grant (`venue.view`). The edit grant (`venue.configure`) enables links. Menus still requires `menu.manage`. In `apps/dashboard/src/screens/menus-screen.ts`, group usage by menu ID once per read, watch only on the list and stop and clear on departure or provider change. Omit the columns without a provider and rebuild them when its availability changes. Show localized loading or unavailable text until usage is known.
- Reuse the table's cell parts and pinned Actions. Both usage columns opt out of opening the menu row. Extend the existing stacked layout up to a width that fits the wide list with Kind and Spanish headings, using one cutoff throughout. Real links use the shell's guarded navigation. Close, Cancel and the editor's parent link keep returning to Periods.
- Add labels to `apps/dashboard/src/i18n/strings.ts` and short instructions under `{#menus}` in `apps/server/src/guide/en/products.md` and `apps/server/src/guide/es/products.md`.

**Limits and handoff.** Estimate 130–180 production lines and 180–260 test lines. The seat reports visible usage. Archive checks belong to Part 2's server transaction. Scope excludes new endpoints, schema or grant changes, usage filters and sorting. Run two run-it reviews for the contract, permissions, live read, layout and navigation. Get owner approval on desktop and phone screenshots in light and dark before landing.

# Restore dashboard coverage (A1616 part 2)

Part 1 landed in #4468 and passed the till's local coverage gate. The dashboard baseline at
`c37b01983c` passed 18,415 tests, with six skipped. Coverage was 97.95% statements,
94.90% branches, 98.33% functions and 99.05% lines. It needs another 18 statements and
28 branch paths. The finish line is a dashboard suite that passes 98% statements, lines and
functions and 95% branches locally, with both packages passing full main CI.

Use the existing Chromium fixtures and API doubles. Prioritise the gaps below from the
fresh report. Keep production code, coverage settings, till tests and existing assertions intact.

| Test under `apps/dashboard/src/` | What a person can see or do | Gap to measure |
| --- | --- | --- |
| `screens/menus-screen.test.ts` | Remove an empty section without a contents confirmation. Show a dropped ordinary product price by its product name. These are #4420 paths. When loading the menu's details for Rename fails, show Retry and let the manager reopen Rename after recovery. | `menus-screen.ts:1345,1604–1605,2891` |
| `widgets/menu-structure-draft.test.ts` (#4420) | Refresh one of two includes while the other keeps the section from the structure read. Check the arrangement when each source arrives. | `menu-structure-draft.ts:196–197` |
| `widgets/menu-structure-table.test.ts` | Drag two selected dishes beside a row in another section. Check the destination and insertion order above and below that row with the existing drag fixture. | `menu-structure-table.ts:622,625,719` |
| `screens/box-status-screen.test.ts` and `api/client.test.ts` | Stop closes confirmation without losing the downloaded file. Pin the requests that read staff, start, retry, confirm the named file and cancel. Use the screen's existing fixture and the API client's request recorder. These actions come from #4454, #4461 and #4467. | `box-status-screen.ts:1243`, `servers-api.ts:478–490` |
| `screens/menus-screen.customer-preview.test.ts` (#4440) | Show a single price with no empty description, and an allergen label without a subtype where none is recorded. | `customer-menu-page.ts:61–62,419–421` |
| `screens/menus-screen.heading.test.ts` (#4436) | Open the clashes from Home and verify the displayed Structure filter and browser address. | `menus-screen.ts:2978–2979` |
| `screens/printers-screen.test.ts` | A failed Older jobs read leaves the current jobs on screen. Retry to load the older jobs and use Newer jobs to return. Extend the existing history case with the same job fixture, asserting the refusal and each resulting page. | `printers-screen.ts:1480,4548` |
| `screens/set-menus-screen.test.ts` | Recover a failed list read with Retry and follow an offering link to the menu's Structure. Reuse the list fixture. | `set-menus-screen.ts:100,190–197,393` |

Budget about 250–400 added test lines, with no production or support changes. Measure focused
coverage as cases pass and stop adding cases when both gaps close with a small margin. Show that
the new assertions fail with the behaviour removed in a disposable checkout using `mktemp -d`
for scratch. If the named cases leave a gap or their size grows by half, checkpoint with the
remaining count for the watcher before opening the PR.

Run `pnpm --filter @waitron/dashboard test:coverage` and record all four totals. The PR body
names the coverage drops from the 26 and 27 November logs and the Git diffs, and distinguishes
#4467, which landed after the failing nightly. The dashboard's `tender-refund-types.ts` already
appeared at 0% on 26 November and contributes zero counters locally. Reuse the till's full local
result unless the till changed since part 1. After landing, dispatch full `ci.yml` on main and
read `test-dashboard-merge` and `test-till-merge` for its SHA. Keep A1616 open until both pass.

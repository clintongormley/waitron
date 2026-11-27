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
| `screens/menus-screen.test.ts` | Remove an empty section without a contents confirmation, then cancel and recover the section. Show a dropped ordinary product price by its product name. These are #4420 paths. If loading the menu's details for Rename fails, show Retry and let the manager open Rename again after recovery. | `menus-screen.ts:1345,1604–1605,2891`, `menu-structure-save.ts:151–153` |
| `widgets/menu-structure-draft.test.ts` (#4420) | Refresh one of two includes while the other keeps the section from the structure read. Check the arrangement and effective offers when each source arrives. | `menu-structure-draft.ts:196–197,256–258` |
| `screens/menus-screen.home-shortcuts.unsaved.test.ts` (#4432) | If saving the Home page fails with a storage error, show the form-level reason and let the manager save the same draft when storage recovers. | `menu-home-save.ts:253–265`, general rather than shortcut-specific refusal |
| `screens/box-status-screen.test.ts` (#4467) | If saving the shutdown marker fails after a complete transfer, show the reason and keep the named file and confirmation action. Stop closes the confirmation and keeps the download. Extend the existing cancel table with this state and check the initial shutdown action returns. | `box-status-screen.ts:1128,1243`, download cancellation |
| `screens/menus-screen.customer-preview.test.ts` (#4440) | Show a single price with no empty description, and an allergen label without a subtype where none is recorded. An extra counted each shows a price without a portion suffix. | `customer-menu-page.ts:61–62,377,419–421` |
| `screens/menus-screen.heading.test.ts` (#4436) | Open the clashes from Home and verify the displayed Structure filter and browser address. | `menus-screen.ts:2978–2979` |

Budget about 220–330 added test lines, with no production or support changes. Run the changed
files and measure their gain against the baseline. Show that the new assertions fail with the
behaviour removed in a disposable checkout using `mktemp -d` for scratch. If the named cases
leave a gap or their size grows by half, checkpoint with the remaining count for the watcher.

Run `pnpm --filter @waitron/dashboard test:coverage` and record all four totals. The PR body
names the coverage drops from the 26 and 27 November logs and the Git diffs, and distinguishes
#4467, which landed after the failing nightly. The dashboard's `tender-refund-types.ts` already
appeared at 0% on 26 November and contributes zero counters locally. Reuse the till's full local
result unless the till changed since part 1. After landing, dispatch full `ci.yml` on main and
read `test-dashboard-merge` and `test-till-merge` for its SHA. Keep A1616 open until both pass.

# Restore dashboard coverage (A1616 part 2)

Part 1 landed in #4468. Its tests pass the till's local coverage gate. Replaying them against
nightly 45927524956 still leaves the dashboard 12 statements and 24 branches short. Measure
the current dashboard baseline at `c37b01983c`, which also includes #4467's backup download.
The finish line is a dashboard suite that tests the cases below and passes the existing
98% statements, lines and functions and 95% branches gates locally and in full main CI.

Use the existing Chromium screen fixtures, API doubles, and translated expectations. Keep
production code, coverage settings, till tests and existing assertions intact. Run the cases
in this order until both dashboard gaps are closed with room for a few counters of drift.

| Test under `apps/dashboard/src/screens/` | What a person can see or do |
| --- | --- |
| `menus-screen.home-tab.test.ts` (#4432) | Save a home page whose saved missing shortcut is sent as a missing reference without its display name. If another manager removed it between load and save, show its own name in the refusal and preserve the edits for a retry. If a newly added shortcut becomes unreachable, name it and explain why. On a successful save that drops deleted additions, name the omitted shortcuts and show the saved list. Use the Home tab API double and the results `packages/menu/src/menu-home.ts` actually returns. |
| `menus-screen.structure-move.unsaved.test.ts` (#4420) | Keep the draft and show a refusal on the specific Drinks member identified by `sections.0.members.0.ref`, distinct from the existing section-level case. Clear a refused price message when its input is corrected and prove the retry submits the corrected amount. |
| `box-status-screen.test.ts` (#4467) | When the status read reports that saving the shutdown marker failed after a complete transfer, show the reason and retain the same file and the option to confirm it again. Check that cancelling from that state restores the initial action. Reuse the download-phase fixture. |
| `menus-screen.customer-preview.test.ts` (#4440) | Show a measured variant's portion with its fixed price and an unportioned variant's price per unit. Use the published-menu fixture and read the displayed choice text. |

If the branch count still needs coverage, extend `apps/dashboard/src/widgets/menu-structure-draft.test.ts`
so one included menu can refresh while another keeps its last known section and prices. Reuse
the draft fixture and check the returned arrangement and override prices after each source arrives.

Budget about 220–330 added test lines, with no production or support changes. Use the fresh
coverage report and the part 1 replay to prioritise these cases. In a disposable checkout,
run each new case against its missing behaviour to see its assertion fail, then restore the
production code and run the changed files with the normal dashboard browser project.

Run `pnpm --filter @waitron/dashboard test:coverage` and record all four totals. The PR body
names the coverage drops from the 26 and 27 November logs and the Git diffs, and distinguishes
#4467, which landed after the failing nightly. Reuse the till's full local result from part 1
unless the till sources or tests have since changed on the candidate base. After the test-only
branch lands, dispatch full `ci.yml` on main and read `test-dashboard-merge` and `test-till-merge`
for that dispatch's SHA. Keep A1616 open until both merges pass.

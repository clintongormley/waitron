# Restore dashboard and till coverage (A1616)

Restore both packages to the existing 98% statement, line and function gates and 95% branch gate.
Use existing fixtures and keep production code, coverage settings and existing assertions intact.

The 26 November nightly's merges (45741432235) passed: dashboard 98.12/95.07/98.50/99.11,
till 98.00/95.54/99.17/99.23 (statements/branches/functions/lines). Merging the 27 November
shards (45927524956) reproduces dashboard 97.85/94.68/98.26/98.96 and till
97.99/95.53/99.14/99.21. Dashboard needed 57 more statements and 92 more branch paths.
Till needed two more statements. The older blobs were unavailable, so compare per-file percentages
from the old logs and exact missed counters from the new blobs. The till's `order-types.ts` and
`till-request.ts` were added by #4371 and each contributes zero counters. The older report
already has ten type-only rows at 0%.

| 27 Nov uncovered statements / branches | Test target and the gap it exercises |
| --- | --- |
| Structure filters 7/5, draft 9/20, table 16/40 (#4420, #4436) | `menu-structure-table.test.ts`: show the right variants and dishes under own-price, category, modifier and variants filters (`menu-structure-filters.ts:23–34,86–104`). `menu-structure-draft.test.ts`: could not move a now-missing row, and equivalent price edits stay clean while changing one variant keeps the other price (`224–238,319–326`). |
| Box status 14/18, down from 98.15% to 96.73% statements (#4454, #4461); equipment picker 7/6 (#4389) | `box-status-screen.test.ts`: recover from a staff-load refusal, retry or cancel a paused shutdown, and show a refused decision (`1061–1093,1136–1169`). `equipment-profile-picker.unsaved.test.ts`: retry a failed choices load and explain when no profiles can be assigned (`101–123,176–215`). |
| Structure save 16/14, menus screen 52/115 (down from 98.18% to 96.35% statements, mainly #4420) | `menus-screen.structure-move.unsaved.test.ts`: a refusal addressed to the section itself, a hidden row or an out-of-range price appears where the manager can act on it (`menu-structure-save.ts:22–43,229–239`). Extend the dropped-item case for named variant prices (`menus-screen.ts:2887–2891`). In `menus-screen.heading.test.ts`, check that opening the clash link from a nested section preserves its address (`867,889–892,2978–2979`). |
| Home save 10/17 (#4432), customer menu page 1/12 (#4440, #4444), print preview 1/4 (#4405) and job status 2/3 (#4398) | As needed after measuring the cases above: `menus-screen.home-tab.test.ts` keeps a newly staged shortcut when choices refresh or its product vanishes (`menu-home-save.ts:138–150`); `menus-screen.customer-preview.test.ts` shows a priced range and unit, keeps the first photo eager and defers later photos (`customer-menu-page.ts:373–448`); `printers-screen.test.ts` keeps the next printout visible when an earlier read fails late and explains a recognized non-paper hold (`print-queue-preview.ts:60–69`, `printer-job-status.ts:39–46`). |
| Till shell 6/14 and floor 9/28 (#4443), device session 2/2 (moved in #4371) | `till-shell.device-zones.test.ts`: widening with the **zone chooser** open returns focus to the matching wide toolbar (`till-shell.ts:864–867`, `till-floor-screen.ts:2383–2389`); the existing test uses More. `client.test.ts`: preview and send a problem report to its encoded URL with the supplied cancellation signal, and with or without a description (`device-session-api.ts:284–298`). Both report requests were untested in the 26 November client too. |

The paths in the table are under `apps/dashboard/src` or `apps/till/src`. Prioritise tests that
move the measured gap. Aim for a margin above the gates where these real cases provide it.
Run the changed files. Use a disposable checkout to prove the new assertions catch a removed
behaviour. Run both local `test:coverage` commands. For the PR, compare both nightly reports and
the dated Git range to name the PRs tied to the drop, distinguishing moved, already-uncovered
code. For the till, #4443 added the missed zone-chooser focus path while #4371 moved the existing
report requests. Finish and land the branch, then run full `ci.yml` on main and verify both merge jobs for that
SHA because local V8 coverage and the CI shard merge measure through different paths.

The watcher cleared a split on 27 November at 04:20 CET if the remaining dashboard
coverage needed more than about 900 net test lines. The first pull request adds the
tested dashboard and till cases. On nightly 45927524956, replaying those cases
recovers 45 dashboard statements and 68 branches and brings the till to 98.01% statements.
The dashboard still needs 12 statements and 24 branches in that replay. Close the
remaining gap in a second test-only pull request, then verify both coverage jobs
in a full run on main.

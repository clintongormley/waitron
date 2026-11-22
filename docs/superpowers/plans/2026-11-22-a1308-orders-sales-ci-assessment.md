# A1308 orders and sales package move

**The split would skip zero server test steps across the 30 sampled orders-and-sales PRs.**
Each still selects the server. With both packages selected, moving suites saves no test execution
in this group. The watcher can take that result to the owner before any groundwork starts.
The earlier estimate of about 860 seconds also counted PRs outside this area. Those are outside
this sample. [Build order](2026-11-08-a1308-build-order.md#batch-2--area-slices)

## What CI ran

At `eaeb7f7e6a8e7671a6206e40be2621d3731a33c3`, Lane H matched the last 30 merged PRs touching
production files in os1's inventory to successful CI runs on their exact heads, 20–22 November UTC.
Each ran 24 server test groups and the stream and full-disk step. Summed test-step time
was 2,981–3,480 seconds per PR, median 3,102. Those are raw observations from overlapping jobs.
Twenty-nine runs exceeded the 10-second checkout cutoff. #3984 qualified after the log and GitHub
incident checks. It ran 3,303 test-step seconds and its longest test step took 173 seconds.
[Os1 inventory](2026-11-08-a1308-os1-order-numbers.md#area-files-for-the-package-move) ·
[Qualified run](https://github.com/clintongormley/waitron/actions/runs/44947249189) ·
[GitHub incident history](https://www.githubstatus.com/api/v2/incidents.json)

Replaying the actual changed paths through CI's classifier with all 146 area suites moved still
selects the server. In the more conservative 44-suite replay, 23 PRs retained server production
edits and four others retained server tests or helpers. Three selected every package through files
outside the workspace members, `deploy/compose.yml` in #4088 and `bench/box-installer/run.mjs` in
#4011 and #3956. An area-only control skipped the server, and adding a retained server test, a
till edit or the lockfile selected it. [Classifier](../../../scripts/changed-packages.mjs#L132)

## What you could move

The potential relocation covers 105 production files (38,736 lines), 146 suites (135,901 lines)
and five helpers (1,417 lines). Start with 44 suites if the two bill fixture substitutions work.
Examples are `order-preview.test.ts`, `working-order.customer-fallback.test.ts` and
`receipt-money.test.ts`. Keep 102 area suites that import startup or till modules through their
tests or helpers, including bill payment and refund API tests. Keep the whole-app suites already
excluded from the 146 too. A package-only PR would skip these dependent server tests.
[Earlier assessment](2026-11-17-a1308-orders-sales-package-move.md#full-move-inventory-and-later-acceptance) ·
[Fixture split](2026-11-21-a1308-orders-sales-first-shared-piece.md)

In #3984 the 44 files account for 1.7% of summed server file time (214 of 12,563 seconds).
All 146 account for 10.8%. These shares show the test work a future PR confined to the remaining
server could skip in that one run. Runner time and elapsed CI time after the move remain unmeasured.

## Shared work to size if the move goes ahead

The scan finds 182 distinct server modules outside the selection, including 58 test helpers.
Production imports 89 of the 182. The earlier 157 count used the 17 November tree. The table
sizes six possible PRs by current files and distinct area importers. It covers 24 of the 182
targets. The remaining boundary and the amount of handwritten change still need designs.

| Possible pull request | Current footprint |
| --- | --- |
| Bill fixture with the first suite move | 67 suites use the fixture. The planned split changes two suites, +270/−230 support lines and +20/−10 test lines. |
| Orders error registry | 1 server module, 61 production files and 36 suites importing it. |
| Request context and till mounts | 6 server modules, 44 production files and 31 suites importing them. |
| Floor and kitchen | 7 server modules, 18 production files and 33 suites importing them. |
| Device and document support | 5 server modules, 12 production files and 18 suites importing them. |
| Card and refund support | 4 server modules, 6 production files and 3 suites importing them. |

Qualify independent coverage and CI selection with the move. The per-PR worksheet, file lists
and import counts are local in Lane H's `receipts/a1308-orders-sales-ci-assessment/`.

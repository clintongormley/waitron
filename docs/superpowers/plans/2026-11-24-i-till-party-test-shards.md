# Split the slowest till test file

The seven till CI shards can run the same browser checks with the parties file split across shards. Lane I's queue item CI-JOBS-OVER-FOUR-MINUTES asks for one PR addressing the slowest job by measured median.

## Baseline

29 PR runs and one nightly on the current CI workflow, plus 20 PRs to supplement thin groups. Times run from job start to completion, excluding queue time. The watcher cleared checking each job's own checkout and downloads at 13:43 CET. No relevant GitHub incident overlapped. Each row uses passing jobs with a checkout of at most 10 seconds and no download HTTP 5xx in the job log. The single matching nightly is [45311390022](https://github.com/clintongormley/waitron/actions/runs/45311390022). The PR run IDs and job logs are in Lane I's CI-JOBS-OVER-FOUR-MINUTES receipts.

| Event | Runner | Job | Samples | Median / worst job seconds | Median / worst test-step seconds |
| --- | --- | --- | ---: | ---: | ---: |
| Nightly | GitHub | test-till (2) | 1 | 287 / 287 | 254 / 254 |
| PR | GitHub | root-guards | 2 | 273.5 / 288 | 247 / 262 |
| Nightly | GitHub | test-till (3) | 1 | 260 / 260 | 225 / 225 |
| Nightly | GitHub | test-setup | 1 | 258 / 258 | 226 / 226 |
| Nightly | GitHub | test-light-a | 1 | 254 / 254 | 228 / 228 |
| Nightly | GitHub | test-dashboard (5) | 1 | 242 / 242 | 203 / 203 |
| Nightly | GitHub | test-server (22) | 1 | 242 / 242 | 210 / 210 |
| Nightly | GitHub | test-server (15) | 1 | 241 / 241 | 201 / 201 |
| PR | Our server | root-guards | 4 | 240.5 / 244 | 204.5 / 210 |

The [287-second job](https://github.com/clintongormley/waitron/actions/runs/45311390022/job/138168403875) spent 235 seconds in 714 serial cases of `till-app-parties.test.ts`. Three closing groups took 73.5 seconds. Seven PR observations of the shard had a 239-second median and 249-second worst. The [supplemental full run](https://github.com/clintongormley/waitron/actions/runs/45323660109/job/138208313750) had the same 714 cases, which took 153 seconds. A replay of the nightly file times with the existing seven-shard packer and three workers estimated 243 seconds for the worst test schedule before the split and 194 after it. The replay omits non-test overhead and runner variation.

## Change and checks

1. Save the existing case-name inventory and run the packing replay with the original file. The control must keep the two groups on one shard. Move the complete blocks for cancelling and crediting an invoiced bill, reopening a printed bill to split it, and Finish table confirms paid unserved dishes from `apps/till/src/till-app-parties.test.ts` into `apps/till/src/till-app-parties-closing.test.ts`. Move only shared fixture definitions and reset into `apps/till/test/party-app-fixture.ts`. Reuse the locale label registry and give the mock sale an English QR placeholder if these two strings move. Preserve test names, actions and assertions.
2. Update just the two parties weights in `apps/till/test-durations.json` from the measured coverage-on case split. Run the same packer with both files and check distinct shards and the modeled load. In `.github/workflows/ci.yml`, add the new path alongside the existing diagnostics. Same worker limits, seven shards and coverage merge. Other jobs and A1027's stall investigation are outside the fix.
3. Run the two named files in Chromium, compare the case-name multiset against the base, and run till typecheck and the existing duration and workflow guards. Compare all seven till jobs in the branch's full verification with the nightly, per-job checkout and downloads checked. Record the actual test and job seconds and require the usual coverage merge. Put the baseline table and run links in the PR and one line under A1398 in `docs/backlog/ci.md`.

Estimate 2,550 existing case lines and up to 500 fixture lines moved, under 125 lines of import, fixture wiring, timing entries and diagnostics edits, and zero product-code lines.

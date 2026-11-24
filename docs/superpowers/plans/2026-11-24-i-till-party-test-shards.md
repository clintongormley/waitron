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

The [287-second job](https://github.com/clintongormley/waitron/actions/runs/45311390022/job/138168403875) spent 235 seconds in 714 serial parties cases, finishing the file in the last six seconds of the test step. Three closing groups took 73.48 seconds. Seven PR observations had a 239-second job median and 249-second worst. The [supplemental full run](https://github.com/clintongormley/waitron/actions/runs/45323660109/job/138208313750) took 191 seconds for shard 2, with the parties file at 154.6 seconds compared with 236.5 on the nightly. The till tree was identical. The median nightly-to-manual ratio was 1.37 for 63 common files in shard 2, and the manual run's qualified shards 4, 6 and 7 took 262, 279 and 273 seconds. The PR carries all seven timings from both runs. For root guards, 39 passing PR jobs and the nightly missed the checkout cutoff, and four PR jobs failed. The table describes the observations that qualified.

## Change and checks

1. Capture case names and replay the nightly file times through the seven-shard packer. The existing file must run all 714 cases on one shard. Move the complete blocks for cancelling and crediting an invoiced bill, reopening a printed bill to split it, and Finish table confirms paid unserved dishes from `apps/till/src/till-app-parties.test.ts` to `apps/till/src/till-app-parties-closing.test.ts`. Move shared setup, reset and `held()` to `apps/till/test/party-app-fixture.ts`. Use a setter for the one old case that assigns the mock API directly, the shared locale labels, and an English QR placeholder for the mock sale. Preserve names and assertions.
2. Split the existing 146.4 s weight in `apps/till/test-durations.json` by the measured case share, 100.6 s remaining and 45.8 s moved. The replay with these exact values projects 192 s at most, down from 243 s, and puts the two files on shards 3 and 6. Moving just Finish projects 195 s at most and keeps about 10 s more work on the shard holding the original file. The model omits runner variability, setup and gaps between files. The old model fell 11–32 s below measured test steps for shards 2 and 3. With that gap and setup, the candidate's slowest job could still take about 240–260 s. Shard 3's original overage and the other jobs in the table remain reported.
3. Add the new file to the existing case diagnostics in `.github/workflows/ci.yml` and update its pointers in `docs/developers/ci-and-gates.md` and `docs/backlog/{ci,till}.md`. Coordinate the moved Finish block with the watcher because the future Give money back plan names its old file. Recheck before edits. Keep the existing A1027 coverage and diagnostics.
4. Run both files in Chromium, compare case names and assertions against the base, and run till typecheck and the existing duration and workflow guards. Check the till coverage merge in the candidate's full verification. Qualify each job's checkout and downloads. Report actual job and test-step times for all seven shards in both baselines and the candidate, with the four-minute job target. Report the two parts' file times beside unchanged file times from the same runners. Whole-job times vary across runners, including on the unchanged baselines. The watcher cleared this comparison on 24 November at 14:17. If the slowest job holding either part is as slow as or slower than shard 2 in both baselines, put that result in the PR and bring it to the watcher before landing. Add one line under A1398 in `docs/backlog/ci.md`.

Estimate 2,550 existing case lines and up to 500 fixture lines moved, up to 125 lines of wiring, weights and diagnostics edits, and zero product-code lines.

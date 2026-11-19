# A1544: sale requests with a year of history and limited memory

Measured on 17 November 2026. The uncapped, 7 GiB and 8 GiB conditions all completed.
At 7 GiB, the counter-sale median rose from 12.323 to 13.752 ms (11.6%); partial and final
payments rose by 2.6% and 9.8%. The 8 GiB run varied more and overlapped other host workloads.
You cannot use these runs to isolate a memory-only effect or predict an appliance's response time.
They leave A1531's archiving recommendation unchanged. Actual appliance memory use remains open.

## Dataset and method

The unchanged bench at `30c1c1c56498d3adeb7c8065cc6f03eb63dfdfb4` built 366 days,
from 2025-11-03 through 2026-11-03, through its real in-process routes: 250 bills per day,
seed 1, 91,500 sales and 7,230,630 rows. The closed `venue.db` is 12,471,033,856 bytes
(11.61 GiB). The completed-build marker exists. The stopped dataset passed `quick_check`,
exact daily-close/sale counts, all 366 sequential timing stamps and a zero-content WAL check.

The owned bench host is `root@2.29.240.15`, Linux x64, Ryzen 9 7950X3D, 32 logical CPUs,
134,521,815,040 bytes RAM and ext4 without reflink support. The private official Node 26.13.1
reports SQLite 3.54.1 and STAT4 disabled, matching the freshly checked `node:26-slim` index
`sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` and amd64 image
`sha256:a5a5adfee3013de54504e0e6aff49993acf7daed072e86be75b8818c0f6ac258`.
The source's lockfile SHA-256 is `38549e33e011daf0f7767cf43afa97e4891d8ad873d66575f156bf7c5d203230`.
The host's own Node was left unchanged.

Each measurement uses the existing `measure --samples 200 --rounds 3`, with swap prohibited.
Every round copies the same closed history before timing. An external observer records memory
counters, process RSS and `fincore` residency every ten seconds, distinguishing snapshots with a
copy child from later snapshots. No shared cache was flushed or cache setting changed.

## Completed uncapped reference

The run completed in 39 min 34.860 s with exit 0. Every case has three rounds of 200 samples.
The table preserves all outcome counts and the bench's minimum observed prepared quantity
(`leastSeen`); its meaning varies by case. All timed HTTP answers were 200, and every filing
sample accepted 50 records. Values in each timing cell are rounds 1, 2 and 3, in milliseconds.

| Case | Median ms | 95th percentile ms | Outcome and count | leastSeen |
| --- | --- | --- | --- | ---: |
| `payment.partial` | 5.331 / 5.292 / 5.319 | 6.973 / 7.032 / 7.139 | 200: 600 | 1 |
| `payment.final` | 11.763 / 11.830 / 11.867 | 15.260 / 15.287 / 15.390 | 200: 600 | 1 |
| `sale.counter` | 12.299 / 12.323 / 12.392 | 15.853 / 15.925 / 16.035 | 200: 600 | 1 |
| `floor.read` | 19.658 / 18.404 / 19.698 | 20.269 / 19.256 / 20.916 | 200: 600 | 15 |
| `floor.open` | 21.011 / 19.765 / 21.216 | 21.593 / 20.340 / 21.636 | 200 200: 600 | 15 |
| `kitchen.queue` | 17.999 / 16.556 / 17.979 | 18.629 / 16.879 / 19.075 | 200: 600 | 30 |
| `kitchen.screen` | 18.541 / 17.316 / 18.538 | 19.157 / 19.007 / 19.639 | 200: 600 | 30 |
| `kitchen.pass` | 495.976 / 505.073 / 506.178 | 503.003 / 508.209 / 509.506 | 200: 600 | 30 |
| `kitchen.pass-screen` | 651.164 / 858.582 / 654.442 | 656.917 / 1463.167 / 659.107 | 200: 600 | 30 |
| `dashboard.open` | 764.647 / 1081.225 / 775.123 | 769.647 / 2011.651 / 783.363 | 200 200 200: 600 | 600 |
| `kitchen.pass-release` | 7.344 / 8.004 / 7.330 | 7.827 / 14.453 / 8.225 | 200: 600 | 2 |
| `print.problems` | 22.421 / 24.365 / 22.557 | 23.013 / 24.748 / 23.020 | 200: 600 | 1 |
| `filing.pass` | 12.960 / 13.013 / 13.217 | 16.859 / 16.832 / 16.998 | accepted 50: 600 | 50 |

Post-copy snapshots showed about 12.47–12.58 GB of the changing round database resident,
13.14–13.35 GB charged to the unit, and 260–389 MB of anonymous memory. Observed file-cache
refault and memory-limit counters stayed zero. Those are residency and process observations;
they do not isolate SQLite's allocation. A fresh connection to the closed copy reported
`cache_size=-2000`, `mmap_size=0`, `page_size=4096`. The store opens writer/reader pairs for
venue and node files without overriding those cache settings (`packages/store/src/index.ts`).

## Completed capped conditions

The 7 GiB run completed in 36 min 53.771 s; 8 GiB completed in 46 min 55.809 s. Both exited 0,
with no swap. The 7 GiB condition assumes 1 GiB for the operating system and other services on
an 8 GiB box; it does not measure that remainder. Node and its child process share each cap.
Every case below retains three rounds of 200 samples, the same outcomes and `leastSeen` as the
uncapped table. Cells give rounds 1, 2 and 3 in milliseconds.

### 7 GiB

| Case | Median ms | 95th percentile ms |
| --- | --- | --- |
| `payment.partial` | 5.457 / 5.441 / 5.460 | 7.377 / 7.224 / 7.216 |
| `payment.final` | 12.922 / 12.983 / 13.063 | 16.450 / 16.514 / 16.633 |
| `sale.counter` | 13.752 / 13.917 / 13.690 | 17.417 / 17.912 / 17.171 |
| `floor.read` | 19.483 / 19.520 / 19.637 | 20.484 / 20.018 / 20.244 |
| `floor.open` | 20.481 / 21.036 / 21.011 | 20.947 / 22.027 / 21.951 |
| `kitchen.queue` | 17.462 / 17.926 / 17.681 | 18.103 / 18.999 / 18.642 |
| `kitchen.screen` | 18.028 / 18.350 / 18.226 | 18.649 / 19.402 / 19.303 |
| `kitchen.pass` | 501.380 / 503.393 / 522.234 | 505.861 / 507.127 / 525.258 |
| `kitchen.pass-screen` | 660.373 / 655.927 / 670.888 | 664.490 / 660.794 / 676.732 |
| `dashboard.open` | 777.276 / 777.893 / 777.703 | 786.564 / 782.958 / 787.761 |
| `kitchen.pass-release` | 7.308 / 8.093 / 7.548 | 10.838 / 8.995 / 8.918 |
| `print.problems` | 22.743 / 22.639 / 22.550 | 23.192 / 23.027 / 23.063 |
| `filing.pass` | 13.169 / 13.122 / 13.237 | 16.922 / 18.523 / 17.058 |

### 8 GiB

| Case | Median ms | 95th percentile ms |
| --- | --- | --- |
| `payment.partial` | 5.407 / 6.065 / 9.451 | 7.124 / 9.071 / 20.783 |
| `payment.final` | 12.631 / 14.690 / 17.013 | 16.040 / 18.832 / 25.906 |
| `sale.counter` | 13.386 / 15.419 / 19.339 | 16.736 / 19.939 / 27.804 |
| `floor.read` | 19.534 / 21.535 / 25.409 | 20.438 / 23.264 / 29.295 |
| `floor.open` | 20.893 / 23.252 / 26.681 | 21.468 / 24.713 / 29.970 |
| `kitchen.queue` | 17.845 / 20.365 / 23.500 | 18.361 / 21.484 / 28.766 |
| `kitchen.screen` | 18.279 / 21.747 / 25.509 | 18.860 / 23.767 / 31.749 |
| `kitchen.pass` | 504.866 / 502.479 / 737.108 | 509.985 / 593.123 / 1217.182 |
| `kitchen.pass-screen` | 662.832 / 921.790 / 654.632 | 667.708 / 1270.761 / 800.053 |
| `dashboard.open` | 1117.249 / 1077.700 / 777.824 | 1632.329 / 1231.300 / 783.110 |
| `kitchen.pass-release` | 8.995 / 10.219 / 7.343 | 18.071 / 15.440 / 8.559 |
| `print.problems` | 61.273 / 44.372 / 22.892 | 72.472 / 58.569 / 23.751 |
| `filing.pass` | 17.537 / 19.259 / 13.227 | 39.455 / 34.128 / 17.391 |

Taking the median of each case's three round medians gives this comparison. Ratios use the
uncapped value as 1.00; they describe these runs, without attributing their cause.

| Sale request | Uncapped ms | 7 GiB ms | Ratio | 8 GiB ms | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| `payment.partial` | 5.319 | 5.457 | 1.026 | 6.065 | 1.140 |
| `payment.final` | 11.830 | 12.983 | 1.098 | 14.690 | 1.242 |
| `sale.counter` | 12.323 | 13.752 | 1.116 | 15.419 | 1.251 |

The existing `compare` command flags only `sale.counter` as slower at 7 GiB against uncapped.
At 8 GiB against uncapped it flags partial/final payment, counter sale, kitchen queue/screen,
pass release, print problems and filing. Comparing 8 GiB with 7 GiB flags every case as `same`:
that verdict includes a 10% margin outside the earlier run's range of round medians, and the
8 GiB spread is wide. It is not evidence of equivalent performance.

After each round's copy child had exited, 7 GiB snapshots showed 6.81–6.99 GB of the round
database resident; 8 GiB showed 7.93–8.00 GB. Each database grew from about 12.47 to 12.58 GB
during requests. The capped runs therefore exercised partially resident databases. Anonymous
memory ranged from 248 to 385 MB at 7 GiB and 261 to 386 MB at 8 GiB. These are decimal GB/MB,
not GiB/MiB. They describe observed residency and charges, not SQLite's private cache allocation.

Within rounds, file-cache refault counters rose by about 98,000–107,000 at 7 GiB and
81,000–87,000 at 8 GiB after the first post-copy snapshot. These count pages needed again after
eviction. Memory-limit counters also continued rising after copies, by 272–309 and 207–224
respectively; observed OOM and OOM-kill counters stayed zero. Copy work contributes to cumulative
counters, so these within-round changes exclude the next copy rather than treating the whole
unit's counters as request-only activity. Ten-second sampling does not capture every transition.

## Limits and retained evidence

The 8 GiB run's sale medians increased across rounds, while its print-problem median fell from
61.273 to 22.892 ms. At 15:27:58, the host snapshot showed several other QEMU guests active,
103,317,164,032 bytes available and no CPU affinity set on the measurement unit. Other lanes'
workloads were preserved. Host scheduling and load were not controlled, so the slower 8 GiB
run does not show that giving the database more memory makes it slower.

These are synthetic, in-process requests with fake AEAT, without boot's middleware, network,
physical devices or background maintenance. Each measurement runs cases serially against an idle
database; the JSON's `load: "idle"` does not establish an idle host. The build was resumed across
firings with other workloads observed, so its daily times are not a controlled history comparison.
There is no matched short-history run here to isolate history growth. Actual appliance service
use, database-cache allowance and physical-box response times remain unmeasured.

The retained dataset is `/srv/waitron-bench/a1544-j-20261116-2240/history`, 12,472,128,368 bytes;
the whole owned folder is 12,707,240,467 bytes after cleanup. The unchanged source and all three
result files sit beside it. Owned round copies, private Node and dependencies were removed;
the host's Node remains 26.13.0. To reuse the dataset, restore the checksum-verified private
Node 26.13.1 and frozen dependencies. The [cleared plan](https://github.com/clintongormley/waitron/blob/28f9998ef84db3fb671b1e59a7a5916b0d317da4/docs/superpowers/plans/2026-11-16-a1544-memory-measurement.md)
gives the commands.

Lane J's `receipts/a1544-plan-20261116/` retains `unlimited.json`, `remainder.json`, `8g.json`,
`volume.json`, daily timings, all observer logs, comparison output, runtime provenance and
`final-dataset-check.json`. Each complete result was checked for 13 cases, 200 samples per round,
three rounds, matching source/runtime/profile/machine, exact outcomes and `leastSeen`, and finite
ordered median/p95/maximum values. The final stopped-copy check found 366 daily closes, 91,500
sales, 7,230,630 rows, `quick_check=ok` and zero WAL content. Earlier intentionally interrupted
attempts are retained as partial logs, separate from these complete results.

Claude reviewed the plan in 243 and 128 seconds; the watcher cleared it on 16 November at 22:40,
and cleared docs-only publication on 17 November at 15:38. The owner decides any change to
A1531's recommendation; this measurement makes none.

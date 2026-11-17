# A1544: year-history reference; memory comparisons still open

Measured on 17 November 2026. Only the uncapped reference completed. The 7 GiB and
8 GiB comparisons still need full runs, so these results do not answer whether limited
memory slows the sale or change A1531's archiving recommendation.

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

## Interrupted conditions and what remains

The first 8 GiB attempt ran for 7 min 32.657 s. It was deliberately stopped when the watcher's
08:52 note prioritised 7 GiB. Its observations showed about 7.95–7.97 GB of the copied database
resident, with re-reading of evicted pages continuing after the copy; no completed timing file
was written. The subsequent 7 GiB attempt was deliberately stopped after 1 min 10.321 s under
the watcher's 08:59 shutdown instruction. Both stopped with status 143. Neither is a completed
measurement or evidence of a product failure. Their partial working copies were removed.

Resume 7 GiB first, then a fresh full 8 GiB run, keeping 200 samples and three rounds. Compare
their completed files with the retained uncapped reference using the existing `compare` command,
and read its verdicts. The 7 GiB condition assumes 1 GiB for the operating system and other
services on an 8 GiB box. Actual appliance service use and the memory left for database caching
remain unmeasured. The watcher's 10:30 measurement deadline was superseded by shutdown; follow
the latest queue and scheduling instructions when the campaign resumes.

The retained dataset is `/srv/waitron-bench/a1544-j-20261116-2240/history`; source and small
results sit beside it. Restore the checksum-verified private Node 26.13.1 and frozen dependencies
before resuming. The [cleared plan](../superpowers/plans/2026-11-16-a1544-memory-measurement.md)
gives the commands. Lane J's `receipts/a1544-plan-20261116/checkpoint.json` records the exact state,
with `unlimited.json`, `volume.json`, all daily timings and observer logs beside it.

These are synthetic, in-process requests with fake AEAT, without boot's middleware, network,
physical devices or background maintenance. The build was resumed across firings with other
workloads observed, so its daily times are not a controlled history comparison. Each measurement
runs its cases serially against an idle database; the JSON's `load: "idle"` does not establish an
idle host or physical-box fidelity. Round two's dashboard and pass-screen tails are retained above.

Claude reviewed the plan in 243 and 128 seconds; the watcher cleared it on 16 November at 22:40.
The watcher changed the run order at 08:52 on 17 November and required a WIP push, no PR or merge,
at 08:59. No owner approval of an archiving design or a measured appliance allowance is claimed.

# A1544: sale requests with second-year history and limited memory

Measure [A1544](../../backlog.md) and [A1531 aim 2](../specs/2026-11-14-a1531-archive-closed-records-design.md#does-a-year-of-history-slow-the-sale-down-aim-2) using the existing bench unchanged. Publish request times and observed cache use; change no product code or archiving decision. Claude reviews this proposal; the watcher clears it before execution, including the assumed remainder, extra control, machine-time budget and retained dataset across firings.

## Build the smallest history that meets the ask

Reserve an exclusive clone and separate output folder under `/srv/waitron-bench/a1544-j-20261116-<unique>` on owned `root@2.29.240.15`. Pin source `30c1c1c56498d3adeb7c8065cc6f03eb63dfdfb4`, install frozen dependencies and record clean HEAD, lockfile and filesystem. `$RUN` stays outside `$SRC`. The host is x86_64 with cgroup v2, systemd and fincore; Docker is absent.

Host Node 26.13.0 reports SQLite 3.54.0/STAT4=0. Locally cached `node:26-slim` digest `e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` reports 26.13.1/3.54.1/0. Before building, resolve today's box-base tag to its digest and probe it on a Docker-equipped machine. Use the matching official Linux x64 Node release in the owned folder, verify its published checksum and actual SQLite/STAT4, and leave host Node unchanged. A mismatch blocks timing.

Run the existing `apps/server/scripts/bench/cli.ts` through its installed tsx, using the verified Node (`B` below). Reuse all of `apps/server/scripts/bench/` unchanged:

```sh
B=("$NODE" "$SRC/apps/server/node_modules/tsx/dist/cli.mjs" "$SRC/apps/server/scripts/bench/cli.ts")
systemd-run --wait --pipe --collect --unit="$BUILD_UNIT" -p RuntimeMaxSec=25min \
  "${B[@]}" build --out "$RUN/history" --days 366 --bills-per-day 250 --seed 1
```

366 days exceeds a calendar year. The older 360-day bench produced a 15.5 GB file; A1531's later 6.1 GB estimate uses a compacted month after A1532's payload cleanup. Those are different measurements, not proof of today's working-set size. Record actual file/allocated bytes, rows, completed dates and build timings. Never pad data, fabricate volume.json, gather planner statistics or change cache settings.

Estimate 11–14 machine hours including three measurements from the historical 8 h 28 min build, not a guarantee. Request watcher clearance for that machine time outside the three active-hour driver budget and for retaining only this resumable dataset across firings. Each build unit expires before firing end; resume from last-day/bench-session.json with the same source. Restarts copy the last day again and may repeat a partial day, adding unmeasured overhead; build times are not comparable to an uninterrupted run.

## Measure memory and requests

Propose three sequential runs: uncapped reference, 8 GiB, and **7 GiB assuming 1 GiB for OS/other services**. The extra reference distinguishes capped behavior from one where history fits. Actual appliance service use remains unmeasured; get watcher clearance for that assumption. Node sits inside each cap.

A read-only Node probe on each closed database reads `cache_size`, `mmap_size`, `page_size`; trace `packages/store/src/index.ts` for overrides and connection count. Record configured SQLite cache targets separately from resident memory; they are not measured allocations. Observe each round's venue.db with `fincore`, excluding live -shm files. An outside shell observer records cgroup memory.current/peak/stat/events, file/anon, workingset_refault_file, pgmajfault, pressure and process RSS, then ends with the unit.

```sh
systemd-run --wait --pipe --collect --unit="$UNIT" -p RuntimeMaxSec=3h \
  -p MemoryAccounting=yes -p MemorySwapMax=0 -p MemoryMax="$LIMIT" \
  "${B[@]}" measure --venue "$RUN/history" --out "$RUN/$MODE.json" --samples 200 --rounds 3
"${B[@]}" compare --before "$RUN/unlimited.json" --after "$RUN/8g.json"
"${B[@]}" compare --before "$RUN/8g.json" --after "$RUN/remainder.json"
```

Use `MemoryMax=infinity` for the reference. Keep measure execution attached until completion/deadline, with no detached processes at firing end. An OOM or deadline is a reported failed condition, never permission to raise a limit. Each round copies last-day into fresh files inside its unit before timing. Record filesystem/reflink behavior and initial residency. Separate each round's copy counters from later counters after its cp child exits; report database residency during requests, not copy-induced pressure. First samples can fault pages in. Check observed charges rather than asserting every cached source page changes owner. Never flush shared caches. Rising max events/refaults and resident database bytes below its size demonstrate pressure; absent pressure, narrow conclusions and ask before extending the experiment.

## Publish the evidence

Keep all case outcomes/counts and 200 samples × 3 rounds. Report per-round p50/p95, ratios and cache figures; read compare's text. Disclose synthetic data, in-process requests, fake AEAT, missing network/devices/background maintenance and physical-box fidelity. Add dated findings to A1531 aim 2; narrow/delete A1544. Preserve small lane-local receipts; after a failed/expired measure remove its recorded owned measure-* folders, and remove remaining owned runtime after results. Forecast docs +110–180/−0–20; production/tests +0/−0. No new framework, rig or paid machine.

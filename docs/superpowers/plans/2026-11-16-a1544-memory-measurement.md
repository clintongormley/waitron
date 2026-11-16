# A1544: sale requests with second-year history and limited memory

Measure the question in `docs/backlog.md` A1544 and A1531's [aim 2](../specs/2026-11-14-a1531-archive-closed-records-design.md#does-a-year-of-history-slow-the-sale-down-aim-2): does memory pressure slow sale requests after more than a year's trading? This proposal changes no archiving decision. The driver obtains Claude's completed plan read and watcher clearance before the long build.

## Build one real history

Use the owned host `root@2.29.240.15`, reserving `/srv/waitron-bench/a1544-j-20261116-<unique>` and unique transient systemd units. Driver-supplied facts report no surviving dataset, native Node 26.13.0 with SQLite 3.54.0/STAT4=0, and no Docker. The driver then checked locally cached `node:26-slim` digest `e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc`: Node 26.13.1, SQLite 3.54.1, STAT4=0, so that cache differs from the host. Before building, pin the box-base image and verify its runtime. If needed, use the matching official Linux x64 Node release in the owned run folder, checking its published checksum and actual SQLite/STAT4; never replace the host Node. A mismatch blocks timing. Record HEAD, lockfile, runtime and filesystem. Install frozen dependencies in an exclusive remote clone pinned to `30c1c1c56498d3adeb7c8065cc6f03eb63dfdfb4`; verify its clean tree.

Reuse `apps/server/scripts/bench/{cli,build-year,bench-venue,profile,runtime}.ts` unchanged. Build 540 days, 250 bills/day, seed 1 through real routes. Do not pad files, fabricate `volume.json`, gather planner statistics or change caches. With `SRC` the clone and `RUN` the reserved folder:

```sh
NODE=/absolute/path/to/the/verified/node
B=("$NODE" "$SRC/apps/server/node_modules/tsx/dist/cli.mjs" "$SRC/apps/server/scripts/bench/cli.ts")
"${B[@]}" build --out "$RUN/history" --days 540 --bills-per-day 250 --seed 1
```

Record actual bytes, table rows, dates and elapsed time from build outputs. Use `bench-session.json`/`last-day` for same-source resumption (`build-year.ts`). Estimate 16–24 machine hours including measurements, using the historical 360-day receipt in [The bench](../../developers/testing-guide.md#the-bench), without predicting dataset size. Keep planning, setup and review within three active hours. Return to the watcher if materially longer; keep execution attached, or stop at a completed-day checkpoint before the firing ends. Leave no detached processes.

## Establish two memory conditions

First cap the whole bench at 8 GiB. Derive the second cap by subtracting observed services outside the bench plus a stated OS allowance from 8 GiB. Inside each cap, Node and SQLite still compete with file cache; report their footprints separately. If appliance services cannot be observed, flag the gap to the watcher before building: propose 7 GiB with an assumed 1 GiB reservation, explicitly leaving the exact appliance remainder unqualified. Do not build another appliance rig.

Use scratch-only observation of live read/write connections for both database files (`packages/store/src/index.ts`): read `PRAGMA cache_size`, `mmap_size` and `page_size` after configuration. These settings describe budgets, not resident bytes. Keep SQLite's per-connection cache distinct from Node anonymous memory and Linux's cached files; RSS alone cannot separate them.

Run both conditions sequentially on identical CPU/disk with fresh unit names:

```sh
systemd-run --wait --pipe --unit="$UNIT" -p MemoryAccounting=yes \
  -p MemoryMax="$LIMIT" -p MemorySwapMax=0 \
  "${B[@]}" measure --venue "$RUN/history" --out "$RUN/$MODE.json" --samples 200 --rounds 3
"${B[@]}" compare --before "$RUN/8g.json" --after "$RUN/remainder.json"
```

Capture each unit's `ControlGroup`, `memory.current/stat/peak/events`, anonymous/file bytes, major faults/refaults, pressure and process RSS during rounds. Record caps separately from the result's host-memory field. `measure.ts` copies the entire dataset before each round's timers. Preserve identical copy/warmup sequencing; verify copied-file cache charges and reclaim pressure. Escaping shared-cache charges invalidate the pressure claim; diagnose first. Never drop host caches or claim cold-disk timings.

## Report and finish

Preserve outcomes, counts and all cases. Report per-round p50/p95 and case ratios side by side; inspect compare text, since exit zero is not a verdict. Similar times without demonstrated pressure do not establish immunity. Disclose synthetic data, in-process `app.request`, fake AEAT, missing network/devices, boot middleware, background duties and physical-box fidelity.

Add dated findings to A1531 aim 2, preserving history; narrow/delete A1544 accordingly. Keep small evidence in lane-local receipts, then remove only owned runtime resources after copying results. Forecast: documentation +100–170/−0–20 lines including this plan; production +0/−0; tests +0/−0. No framework, tables, suite or paid machine.

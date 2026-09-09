# Fix recurring test hangs

You are seeing two failure paths: the supplied CI jobs leave Bookings browser files unfinished,
and local replication tests can stall on a Docker connection even when PostgreSQL is healthy.
The local stall has a reproduced networking fix. The CI change isolates Bookings, reduces
competing work and supplies a deadline outside the browser. A green retry alone would not
establish either fix.

## Evidence

Downloaded with `gh api repos/clintongormley/waitron/actions/jobs/<id>/logs
--allow-escape-sequences` on 2026-09-09:

| Job | Unfinished package | Browser files without a result |
| --- | --- | --- |
| [102467621738](https://github.com/clintongormley/waitron/actions/runs/34352057261/job/102467621738) | Bookings | index |
| [102286258907](https://github.com/clintongormley/waitron/actions/runs/34293066773/job/102286258907) | Bookings | all four |
| [102164738830](https://github.com/clintongormley/waitron/actions/runs/34256817173/job/102164738830) | Bookings | booking-form, bookings-screen |
| [101979568694](https://github.com/clintongormley/waitron/actions/runs/34200986924/job/101979568694) | Bookings | bookings-screen |

Every other selected package, including Sync, reports `Done` in these logs. Bookings' database
files also report success. The final two jobs run for approximately six hours. The supplied
rerun job 102475748977 subsequently reports `Done` for every selected package, including Bookings.

You also reported local Sync stalls, without a retained log. The earlier PostgreSQL contention
work is recorded in commit `d99e3a4b` (#286). These CI logs do not establish that the browser
hang and the local PostgreSQL stall share a cause.

| External source | Source's words | What this establishes |
| --- | --- | --- |
| [Vitest issue 10791](https://github.com/vitest-dev/vitest/issues/10791), read 2026-09-09 | “testTimeout and retry are enforced inside the tester iframe's own JS” | A browser that stops executing can also stop its timeout. This is a possible failure mechanism, not a diagnosis of these runs. |

The installed `@vitest/browser` 3.2.7 also calls `orchestrator.createTesters()` without a
deadline in `BrowserPool.runNextTest` (`dist/index.js`). An external process must enforce the
final bound; a larger Vitest hook timeout cannot supply it.

### Local replication stall and ineffective worker cap

The first full `TESTCONTAINERS_RYUK_DISABLED=true REQUIRE_DOCKER=1 pnpm test` on this branch
reproduced a Sync stall while fiscal-verifactu ran beside it. `ps -axo pid,ppid,etime,pcpu,command`
showed **17 fiscal workers**, despite `maxForks: 4` inside that package's `main` project.
Sync held the cluster mutex; fiscal's replication project eventually failed its 240-second
acquisition deadline. The fiscal package finished with 38 passing files and one failed file.

`git show d99e3a4b^:packages/fiscal-verifactu/vitest.config.ts` and the same command at
`d99e3a4b` show that #286 moved the fork limit from the outer config into the project. Installed
Vitest 3.2.7's `createForksPool` reads `vitest.config.poolOptions`, while its scheduling code
separately reads per-project `singleFork`. The inner `maxForks` therefore did not cap the pool.
The new root guard fails with `expected undefined to be 4` before the correction.

Live `pg_stat_activity` snapshots from the test peers showed PostgreSQL waiting for client
input, with no blocking backend. One migration connection was idle in a transaction. The
Node inspector showed its client waiting for the next migration query's response. This
locates the stall during migration traffic; it does not establish the cause of that transport
stall. The independently verified defect is the lost worker limit.

### Local transport reproduction

Restoring the four-worker cap was insufficient: the second fiscal/Sync coverage run stalled
and reached its 150-second outer deadline. Forcing IPv4 also stalled. Both live snapshots
stopped after `GRANT SELECT, INSERT, UPDATE, DELETE ON working_order_lines TO app_user`,
with the client waiting for the next 1,644-byte function definition.

A standalone `pg.Client` probe against the leftover container used `query_timeout: 3000`
and `SELECT length('<payload>')`. Payloads of 100 and 1,400 bytes passed; 1,600 bytes timed
out. The peer and a default-network-only container passed payloads through 100 KB.
`docker inspect` and `docker exec <id> ip link` showed two network interfaces on the failing
container: the default bridge at MTU 65535 and the test network at MTU 1500. MTU is the
maximum packet size an interface accepts.

After `docker network disconnect bridge <id>` on that same disposable container, the probe
passed 1,400, 1,600, 10,000 and 100,000 bytes in 1–2 ms. This isolates the dual-network
configuration as a cause of this local stall, independently of package contention. It does
not establish the cause of the Bookings CI browser hang.

Installed Testcontainers 12.0.4 clears `HostConfig.NetworkMode` when network aliases are
requested, then connects the requested network separately. The fixture now uses a unique
container name for Docker DNS and `withNetwork()` without aliases. The new real-Docker
regression failed with two Ethernet interfaces before this change, then passed with one,
including name resolution and a 100 KB parameter round-trip. The existing replication and
WireGuard smoke assertions remain; 26 focused fixture tests pass.

## Changes

- Give Bookings and Sync their own CI jobs. Keep the remaining two bins, each capped at two
  package processes. Preserve changed-package scoping and enforce that every package runs once.
- Give networked PostgreSQL fixtures one interface and unique Docker names; use the actual
  peer name for WireGuard endpoints.
- Restore fiscal-verifactu's `maxForks: 4` on the outer Vitest configuration. Keep its project
  ordering and the replication project's `singleFork` setting.
- Run Bookings' Node project before its browser project, and run browser files one at a time.
  Keep both projects in one coverage invocation with the existing thresholds.
- Bound every CI test job to 15 minutes, including checkout, installation and cleanup. Bound
  the local root commands' package phase and the pre-push coverage command to 20 minutes,
  with two package processes. Direct package commands retain their existing behavior.
- The local deadline lives in a parent process. On timeout or cancellation, terminate the
  command's POSIX process group, then force termination after five seconds. Return failure,
  never a passing result or an automatic retry. Preserve ordinary child exit codes.

These changes reduce competing work and contain stalls. Repeated local runs and CI results
must establish whether they remove the intermittent browser hang; the configuration alone
does not establish that.

## Local verification, 2026-09-09

Run the same five-package selection with `TESTCONTAINERS_RYUK_DISABLED=true REQUIRE_DOCKER=1`:

```sh
pnpm --filter @waitron/bookings --filter @waitron/core --filter @waitron/payments \
  --filter @waitron/provisioning --filter @waitron/sync --no-sort \
  --workspace-concurrency=2 test:coverage
```

The baseline used the original Bookings configuration and omitted the concurrency flag.
Each run started with Bookings' generated `node_modules/.vite` cache removed and enabled
`DEBUG=vitest:browser*,vite:deps`. Each had an external 120-second deadline.

| Measurement | Baseline, three runs | New configuration, three runs |
| --- | --- | --- |
| Outcome | All pass | All pass |
| Total seconds | 31.7, 43.1, 57.3 | 37.1, 37.4, 37.7 |
| Bookings browser sessions per run | 4 | 1 |
| Browser session starts after all Node result lines | No | Yes |

Bookings runs all 130 tests in each new-configuration run, with coverage
100% statements / 96.69% branches / 100% functions / 100% lines. Sync also passes each run.
This verifies the resource limits, but does not reproduce or prove removal of the intermittent
CI hang: the baseline passes too.

A temporary browser test with a 50 ms Vitest timeout printed a marker and entered
`while (true) {}`. Running it through `node scripts/run-with-deadline.mjs 5 -- pnpm --filter
@waitron/bookings exec vitest run --project browser deadline-probe` returned 124 after 10 seconds,
including the five-second termination window. A subsequent `ps` check found no Chromium or
Vitest processes. The temporary test was removed. The committed deadline suite separately checks
blocked Node execution, ordinary exit codes, cancellation, and a descendant that announces
readiness only after installing its SIGTERM handler.

`pnpm vitest run --coverage` passes 1,318 root tests with 100% statements/functions/lines
and 99.47% branches, including the deadline wrapper and CI partition guards. Lint, whole-workspace typechecking and formatting pass.

After the networking correction, three runs of the same fiscal/Sync selection with
`--no-sort --workspace-concurrency=2 test:coverage` pass in 77.6, 79.8 and 61.7 seconds.
Each runs all 56 Sync tests and all 342 fiscal tests, including replication fidelity and
WireGuard replication. The first two overlapped another session's server coverage; no
other suite was started by this session. Retained logs: `/tmp/waitron-replication-network-fixed-{1,2,3}.log`.

The deadline suite also checks a command that exits with status 7 while its worker stays alive
and ignores SIGTERM. Before the cleanup change the worker survived; afterwards the wrapper
preserves status 7 and stops the worker. All ten deadline tests pass.

`TESTCONTAINERS_RYUK_DISABLED=true REQUIRE_DOCKER=1 pnpm --filter @waitron/db test:coverage`
passes 553 tests (two skipped), with 99.23% statements/lines, 98.03% branches and 99.36%
functions. The two-node and WireGuard fixture files each have 100% measured coverage.

The complete repository gate passes after these changes: `pnpm lint`, `pnpm typecheck`,
`pnpm format:check`, and `TESTCONTAINERS_RYUK_DISABLED=true REQUIRE_DOCKER=1 pnpm test`.
The workspace test run completes all 39 runnable packages, including Sync, Bookings, fiscal
replication and all 202 server test files. Log: `/tmp/waitron-test-load-full-test-final.log`.
`sh -n .husky/pre-push` and `git diff --check` also pass. The CI workflow has not yet run
with these changes; the intermittent browser freeze was not reproduced locally.

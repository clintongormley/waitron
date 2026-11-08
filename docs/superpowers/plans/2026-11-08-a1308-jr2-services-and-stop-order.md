# A1308 jr2 — services on the runner, the stop order, and the box noticing a role change — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6: nothing fiscal, no AEAT sending).

**Goal:** The runner gains its second kind, the **service** (something long-running that is started
and stopped rather than run in passes); the bucket copy and the tunnel become services that start
and stop when the box's role changes; the sealed copy of the box's keys becomes a job woken by each
`node.db` commit; and the close stops jobs together, then services in a fixed order with the bucket
copy last.

**Architecture:** `JobRunner` (jr1, `apps/server/src/job-runner.ts`) gains `addService` and
`stopServices`. Today the bucket copy checks the role only when it starts
(`apps/server/src/stream-host.ts:137-140`) and the tunnel only at boot (`apps/server/src/boot.ts:3372`).
The deployment holders (`apps/server/src/deployment-holders.ts:8-34`) gain a change listener, so an
in-process promotion (`apps/server/src/promote.ts:176`) tells the runner at once; the runner then
wakes every job and starts or suspends every service. A slow re-check every 60 seconds is the safety
net.

**Spec:** [jobs.md §1 "The clean version" (stop order), "What A1018 asks of the runner"; §2 R0, R13, R14, R19; §4 "Data loss"; §5 measures 4, 5, 8](../specs/2026-11-02-rationalisation/jobs.md).
Slice rules apply throughout. jr1's interfaces are used as fixed there.

## What it builds

1. Services on the runner, with `SERVICE_STOP_ORDER = ["tunnel", "stream"]` (bucket copy last).
2. `DeploymentHolders.onChange`, wired to `jobRunner.roleChanged()`.
3. R14 `stream` and R19 `tunnel` as services; R13 `backups.sealed_state` as a job.
4. The close: `jobRunner` (jobs, together) first among the closers, `jobRunnerServices` last.
5. Measures 4 and 5 (Tasks 1 and 4), and measure 8's promotion test, which later PRs extend.

## What it leaves out

Backups (`backups.scheduled`) stay on `BackupSupervisor` until jr8; the alert until jr3.

## Files

- Modify: `apps/server/src/job-runner.ts`, `job-runner.test.ts`, `deployment-holders.ts`,
  `deployment-holders.test.ts` (create if absent), `stream-host.ts` (`:200-230`), `stream-host.test.ts`,
  `sealed-state.ts` (`:160-201`), `sealed-state.test.ts`, `boot.ts` (`:2894-2937`, `:3369-3392`,
  `:3872-3907`, `:3909-3926`), `background-duties.ts` (`:55-58, 63-64, 137-153, 182-196, 215-220`),
  `background-duties.test.ts`, `handover-stepdown.test.ts` (`:284-313`), `boot.promote.test.ts`
- Create: `apps/server/src/tunnel-service.ts`, `apps/server/src/tunnel-service.test.ts`

## Size

| Hand-written | Lines |
| --- | --- |
| Code: runner services 110, holders 20, `stream-host.ts` 15, `tunnel-service.ts` 40, `sealed-state.ts` 25, `boot.ts` 50, `background-duties.ts` 15, docs 10 | **~285** |
| Tests: runner 180, holders 30, stream-host 30, tunnel-service 60, sealed-state 40, stepdown and duties 55, promotion (measure 8) 80 | **~475** |
| Total | **~760** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/job-runner.test.ts src/deployment-holders.test.ts src/stream-host.test.ts src/tunnel-service.test.ts src/sealed-state.test.ts src/background-duties.test.ts src/handover-stepdown.test.ts src/boot.promote.test.ts src/boot.restricted-quiet.test.ts src/boot.failed-start.test.ts` — passes, `Tests` count printed.
2. With Litestream and the S3 test server installed (`node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`): `pnpm --filter @waitron/server exec vitest run src/stream-loop.e2e.test.ts src/stream-pause.e2e.test.ts` — passes (CLAUDE.md §4: missing binaries skip locally, so read the count).
3. Typecheck and format clean; measures 4 and 5 in the PR description.

## Expected protection-list difference

**EQUAL.** Any line is a stop.

## Stop points (beyond rules §5)

1. Measure 4 after the change: the close takes 6 seconds or more with Litestream running.
2. Measure 5 fails (see Task 4): take the design's fallback only once the watcher confirms.
3. `handover-stepdown.test.ts`'s "backups and Litestream are not stopped before the answer"
   (`:284`) or "after the answer the close runs in the table's order, Litestream last" (`:294`)
   needs a changed assertion rather than changed names.

## Needs

jr1.

## Global Constraints

- The bucket copy stops last, after anything that may still write `venue.db` (`background-duties.ts:215-220`).
- A service never starts after `signalStepdown()`; the stepdown leaves running services running
  until the close (today's behaviour, `handover-stepdown.test.ts:284`).
- A role read is always the holders' `current` value, re-read at each check (`deployment-holders.ts:4-7`).
- A holders listener runs inside `refreshDeploymentHolders`; it only schedules, never throws.

## Review Focus

1. **A promotion while the bucket copy's settings are being saved** (`StreamHost.reload`,
   `stream-host.ts:221-230`). The runner's start must not interleave with a reload: a start during a
   reload is skipped and the 60-second re-check settles it. Task 2's "a re-check while the host
   reloads starts nothing twice".
2. **A demotion in process** (role leaves `primary`). The bucket copy and tunnel are suspended, not
   stopped for good, so a later promotion starts them again. Task 2's "suspends, then starts again".
3. **A close during a service's start.** `stopServices` waits for the start under way, then stops.
4. **A burst of `node.db` commits** (a handover writes several rows). The sealed state refreshes once
   for the burst, then once more, as `sealed-state.ts:186-195` already collapses requests. Task 4.
5. **A service whose start throws.** Logged, counted in its view, retried at the next re-check; the
   box keeps selling.

---

### Task 1: Measure 4 — how long the close takes today

- [ ] **Step 1:** Throwaway worktree on the base (as jr1 Task 1). Install Litestream and the S3 test
  server (Finish line 2). Start `wa-wt demo <name>` with the bucket copy set up against the local S3
  server on the Backups screen; wait until `/health`'s `stream.state` is running.
- [ ] **Step 2:** In the throwaway copy, log the time `stopWork` takes (`boot.ts:3914-3925`) and the
  time `streamHost.stop()` takes. Send SIGTERM to the server process (its recorded id). Repeat 5
  times; record each.
- [ ] **Step 3: Verdict, written in advance.** Under 4 s every time: "the parallel stop is a tidy-up,
  not a fix" (jobs.md §5.4). 6 s or more on any run: "near the 8-second deadline
  (`run-server.ts:31`), the parallel stop is needed first" — record it, carry on (this PR is the
  parallel stop), and Task 6 repeats the measurement; 6 s or more after the change is stop point 1.

### Task 2: Services on the runner, and the holders' change listener

**Files:** `job-runner.ts`, `job-runner.test.ts`, `deployment-holders.ts`, `deployment-holders.test.ts`

**Interfaces — FIXED:**

```ts
// job-runner.ts (additions)
export interface ServiceDefinition {
  readonly name: JobName;            // catalogue kind "service"
  applies(): boolean;
  start(): Promise<void>;            // idempotent while running
  suspend(): Promise<void>;          // stop for now; start() may run it again
  stop(): Promise<void>;             // for good
}
export const SERVICE_STOP_ORDER: readonly JobName[] = ["tunnel", "stream"];
// JobRunner gains:
addService(service: ServiceDefinition): Promise<void>; // starts it before resolving when applies()
stopServices(): Promise<void>;     // each in SERVICE_STOP_ORDER, one after another; idempotent
// createJobRunner deps gain: serviceCheckMs?: number  (default 60_000)

// deployment-holders.ts
export interface DeploymentHolders {
  readonly mode: { current: DeploymentMode };
  readonly singletonRole: { current: SingletonRole };
  onChange(listener: () => void): () => void;
}
```

Rules the tests pin: each service has one runner-held flag, `active`. A check (at `addService`, at
`roleChanged()`, every `serviceCheckMs`) runs per service one at a time: `applies() && !active` →
`start()`, `active = true`; `!applies() && active` → `suspend()`, `active = false`. A throw from
`start` or `suspend` is logged as `job.failed` with the service's name, counted in its view, and
leaves `active` unchanged. After `signalStepdown()` a check may suspend but never starts. A
service's view `state` is `running` while `active`, `not_applicable` otherwise, `stopped` after
`stopServices`. `addService` refuses a name missing from `SERVICE_STOP_ORDER`.
`refreshDeploymentHolders` calls the listeners only when either axis changed.

- [ ] **Step 1: Failing tests.** `job-runner.test.ts`: `"a service that applies starts before addService resolves"`;
  `"roleChanged starts a service that now applies, and suspends one that no longer does"`;
  `"suspends, then starts again on the next promotion"`; `"the 60-second re-check settles a missed change"`;
  `"a re-check while one is under way starts nothing twice"`; `"no service starts after signalStepdown"`;
  `"stopServices stops tunnel then stream, each after the one before settles, and waits for a start under way"`;
  `"a throwing start is logged and retried at the next check"`. `deployment-holders.test.ts`:
  `"tells its listeners when the role changes, and not when a refresh changes nothing"`;
  `"a listener that throws does not fail the refresh"`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS. Commit: "Add services to the job runner and tell it when the role changes".

### Task 3: The bucket copy and the tunnel as services

**Files:** `stream-host.ts`, `stream-host.test.ts`, create `tunnel-service.ts`, `tunnel-service.test.ts`

**Interfaces:**
- `StreamHost.suspend(): Promise<void>` — today's private `#retire()` (`stream-host.ts:207-217`) made
  public, and clears `#notStarted`; unlike `stop()` it leaves `#stopped` false, so `start()` works
  again. `streamService(host: StreamHost, isPrimary: () => boolean): ServiceDefinition` — name
  `stream`, `applies: isPrimary`, the three methods mapped one to one.
- `tunnelService(deps: { config: TunnelConfig; isPrimary: () => boolean; localPort: number; log: Logger; run?: typeof runTunnelClient }): ServiceDefinition` —
  name `tunnel`; `start` makes an `AbortController` and calls `run` with today's arguments
  (`boot.ts:3373-3384`), keeping the promise and today's `tunnel.worker_rejected` log;
  `suspend`/`stop` abort it and await the promise (rejection swallowed, as `background-duties.ts:194` does).
  Built only when `loadTunnelConfig(env)` returns a config; the `tunnel.disabled` log stays. **If
  A951 has removed `@waitron/tunnel` at the base, skip the tunnel half of this task** and drop
  `"tunnel"` from `SERVICE_STOP_ORDER`.

- [ ] **Step 1: Failing tests.** `stream-host.test.ts`: `"suspend stops the copy and a later start runs it again; stop is for good"`.
  `tunnel-service.test.ts`: `"starts the tunnel client on the primary with a relay set"`;
  `"suspend aborts the client and waits for it"`; `"a client that rejects is logged and suspend still settles"`.
- [ ] **Step 2–4:** Run — FAIL; implement; run — PASS. Commit: "Run the bucket copy and the tunnel as services".

### Task 4: The sealed state as a job, and measure 5

**Files:** `sealed-state.ts`, `sealed-state.test.ts`

- [ ] **Step 1: Measure 5.** Reuse jr1 Task 1's throwaway harness (or rebuild it): count
  `store.node.onCommit` calls per minute (`packages/store/src/index.ts:275`) during the simulated
  service, 10 minutes. **Failing result, written in advance: more than one `node.db` commit a minute
  on average.** Then the design's fallback (jobs.md §5.5, "add a minimum gap between re-seals")
  applies: the job's `minSleepMs` is `60_000` instead of `1_000`. Stop and ask the watcher before
  taking it (stop point 2).
- [ ] **Step 2: Failing tests** for `sealedStateJob(refresher: SealedStateRefresher, unsubscribe: () => void): JobDefinition` —
  name `backups.sealed_state`; `applies: () => true` (every node writes its own row, `boot.ts:2910-2911`);
  `pass` awaits `refresher.refresh()` and returns `{ nextDueAt: null, degraded: outcome === "failed" }`;
  `minSleepMs: 1_000` (or measure 5's fallback); `maxSleepMs` and `firstPassAfterMs`: 24 hours
  (boot has just refreshed, `boot.ts:2912`); `backoff { firstMs: 60_000, maxMs: 3_600_000 }`;
  `ownFailureAlert: "backup.sealed_state_failed"` (its own alert, `alert-sources.ts:240-258`);
  `onStop`: `unsubscribe()`, then `await refresher.settled()` (today's closer order,
  `background-duties.ts:141-153`). Cases: `"a node.db commit wakes one refresh"`;
  `"a burst of commits gives one refresh and one more"`; `"a failed refresh marks the view degraded and raises no job.failing"`;
  `"stop unhooks the commit listener, then waits for a refresh under way"`.
- [ ] **Step 3–5:** Run — FAIL; implement; run — PASS. Commit: "Refresh the sealed state as a job woken by node.db commits".

### Task 5: Wire into boot; the close order; measure 8's promotion test

**Files:** `boot.ts`, `background-duties.ts`, `background-duties.test.ts`, `handover-stepdown.test.ts`, `boot.promote.test.ts`

- [ ] **Step 1: Failing tests.**
  - `boot.promote.test.ts`, in "historical promote: local secondary → primary, live" (`:247`), a new
    case `"after a live promote, every primary-only job has passed and every primary-only service has started, with no restart"`:
    before the promote, GET `/health`'s `jobs` shows `menu.activation` `not_applicable` and
    `stream` `not_applicable`; after `promoteLocalSecondaryToPrimary` resolves, within 5 s,
    `menu.activation` has a `lastRunAt` after the promote and `stream` is `running`, and the restart
    seam was never called. Keep the expected names in a `PRIMARY_ONLY` array at the top of the
    file; jr4, jr5 and jr8 add to it (measure 8, jobs.md §5.8).
  - `handover-stepdown.test.ts`: the closer names change (`streamHost`, `tunnelController`,
    `tunnelWorker`, `stopSealingNodeCommits`, `sealedState` go; `jobRunnerServices` comes, last).
    "backups and Litestream are not stopped before the answer" now asserts `jobRunnerServices` is
    not called before the answer; "the close runs in the table's order, Litestream last" asserts the
    last closer is `jobRunnerServices`. Assertions keep their shape (stop point 3).
- [ ] **Step 2: Implement.**
  - `boot.ts`: the runner's `undoOnFailure` entry (jr1) becomes `async () => { await jobRunner.stopJobs(); await jobRunner.stopServices(); }`.
    After the holders exist and the runner is made: `holders.onChange(() => jobRunner.roleChanged())`.
  - `:2914-2918`: `const stopSealingNodeCommits = store.node.onCommit(() => jobRunner.wake("backups.sealed_state"));`
    then `jobRunner.add(sealedStateJob(sealedState, stopSealingNodeCommits))`; drop the two
    `undoOnFailure` lines (the runner's entry covers them). Routes that call `sealedState.refresh()`
    directly (`mountBackupApi`, `mountStreamApi`) keep doing so.
  - `:2935-2936`: `await jobRunner.addService(streamService(streamHost, () => holders.singletonRole.current === "primary"));`,
    dropping `undoOnFailure.push(() => streamHost.stop())`. `mountStreamApi` keeps `stream: streamHost`.
  - `:3369-3392`: `if (tunnelConfig !== undefined) await jobRunner.addService(tunnelService({ … }))`
    replacing the `isSingletonPrimary &&` start; `tunnel.disabled` logs when `tunnelConfig` is
    undefined on the primary, as now.
  - `background-duties.ts`: remove the handles and closers named above; move the `jobRunner` closer
    to the top of `closers`; add `{ name: "jobRunnerServices", close: () => h.jobRunner.stopServices(), reason: "stops the runner's services in SERVICE_STOP_ORDER, the bucket copy last, after anything that may still write venue.db" }`
    as the last closer. `jobRunner`'s handle type gains `stopServices`.
- [ ] **Step 3:** Run the Finish line's first command — PASS. Commit: "Stop jobs together and services in order, the bucket copy last".

### Task 6: Measure 4 again, docs

- [ ] **Step 1:** Repeat Task 1 on the branch. Record both tables in the PR description. 6 s or more
  is stop point 1.
- [ ] **Step 2:** `apps/server/README.md` "What `/health` means": services appear under `jobs` with
  `running`/`not_applicable`. `rg -n "checked only on .start|only if the box is primary at start" docs`
  — update any runbook sentence that says the bucket copy or tunnel needs a restart after a promotion
  (CLAUDE.md §1, a behaviour change retires its receipts). Commit: "Document services on the runner".

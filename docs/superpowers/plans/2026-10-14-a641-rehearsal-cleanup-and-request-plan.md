# A641 — the Amazon S3 rehearsal cleans up when interrupted, and refuses an unplanned request before sending it

Status: plan, 2026-10-14. Branch `feat/a641-rehearsal-cleanup-and-request-plan`. Review path FULL (it
guards real requests to the owner's AWS account). No migration. **No live Amazon run in this item.**

## The owner's words (lane B queue, A641, 2026-10-14 ~10:45, quoted)

> (1) **"Yes, always clean up"** — an interrupted rehearsal (Ctrl-C / SIGTERM from the lane watchdog /
> an uncaught error) still deletes every bucket it created and its temporary recovery secrets; if any
> clean-up step fails it prints exactly what was left (bucket names, paths) and exits non-zero.
> (2) **"Refuse before sending"** — every S3/AWS request the rehearsal would send is checked against
> its plan BEFORE it is sent; a request not on the plan is refused locally, never reaches Amazon, and
> fails the run naming the request. Keep the existing after-the-fact inventory check as well.
>
> Prove both against the LOCAL S3 test server (versitygw), never live AWS: interrupt a run mid-way
> (SIGINT and SIGTERM, at least two points) and show zero buckets and no secrets left; issue an
> unplanned request (e.g. a delete of a bucket the run did not create) and show it is refused before
> the server sees it (the server's own log shows nothing). State what the failing case would print
> before each probe.

This closes two open edges in `docs/backlog.md`: A538-7's (1) (Ctrl-C or a killed process skips
teardown) and A538-9's (1) (an unlisted API is caught only after Amazon S3 answered it).

## What is true on main `c7c1b26c6` (read by the planner)

- The runner is `apps/server/src/testing/aws-rehearsal.ts` (`withAwsRehearsal`, `runOwned`,
  `teardownOwnedBucket`, `rehearsalLifecycle`, `cleanupFromReceipt`). The four AWS test files are
  `apps/server/src/aws-{stream-loop,stream-pause,archive,delete}.aws-rehearsal.test.ts`, run by
  `apps/server/vitest.aws-rehearsal.config.ts` (`maxWorkers: 1`).
- The runner's own requests go through `call()` on its admin client. Scenario requests go through
  stores from `@waitron/stream` (`createS3ObjectStore`, `createS3FileStore`) and, in the loop and pause
  scenarios, through the IN-PROCESS server (`startServer`) whose production code builds its own
  clients (`apps/server/src/boot.ts:920`, `:1947`, `restore-stream.ts`, `cloud-recovery.ts:122`
  `new S3Client`, and others). Litestream is a Go child process; no Node hook sees its requests.
- The after-the-fact check: `requestRecorder` (`apps/server/src/testing/aws-request-recorder.ts`)
  throws on an API outside `RECEIPT_APIS`, from the `observe` hook in
  `packages/stream/src/s3-client.ts`, which runs AFTER the command's attempts end.
- Every SDK client's `send` is `Client.prototype.send`, one level above `S3Client.prototype`
  (`Object.getPrototypeOf(S3Client.prototype)`), and there is one copy of `@aws-sdk/client-s3`
  (3.1140.0) in the store: measured 2026-10-14, an ESM `import` and a CommonJS `require` from
  `apps/server` gave the same class and the same base prototype.
- Ctrl-C today: Vitest's main process exits 1 ms after SIGINT/SIGTERM
  (`vitest/dist/chunks/cli-api.CnMVyzaz.js:2053-2062`), and a fork worker exits on its next send to
  the closed channel (`init-forks.H5ZuobOQ.js`, `onError` → `processExit(1)`). A signal handler in
  the worker therefore cannot be relied on to finish a two-minute teardown.
- The lane watchdog's `kill_tree` (`~/waitron-campaign-shared/runner-lib.sh:246`) sends TERM to every
  process whose parent chain reaches its root, waits `KILL_GRACE` (10 s), then KILLs what the chain
  still reaches. A process whose parent is pid 1 is not in that chain.
- Measured 2026-10-14 (Node v26.7.0, `/tmp/a641-probe/als.mjs`): an `AsyncLocalStorage` value set
  around `createServer(...).listen()` and `setInterval` was seen by the request handler (for a request
  made from OUTSIDE the context) and by the interval; code outside saw none. The failing case would
  have printed `handler sees: none`.
- versitygw 1.8.0 takes `--region <r>` and `--access-log <file>` (`.bin/versitygw --help`).
  `startS3TestServer` (`apps/server/src/testing/s3-test-server.ts:135`) passes neither; its region is
  `us-east-1`, which `withAwsRehearsal` refuses.
- The scenario scratch folders (`$TMPDIR/waitron-aws-{stream-loop,stream-pause,archive,delete}-*`) are
  made and removed by each AWS test file (`mkdtemp` before `rehearsal.run`, `rm` in `afterAll`), so an
  interrupted run leaves them, with `secrets.env` and `recovery-kit.txt` inside.

## Design decisions

- **D1 — One choke point for every Node request: a gate on `Client.prototype.send`.** The in-process
  server builds its own SDK clients in production code, so a per-client hook cannot reach them. The
  gate wraps the base prototype's `send` once per process. It is installed only by the rehearsal's
  own code (`withAwsRehearsal`, the keeper, the gate's tests); nothing in production imports it. The
  plan in force is found through an `AsyncLocalStorage` scope that the runner opens around setup,
  scenario and teardown (the probe above shows a server started inside keeps it). A refused request
  rejects without calling the real `send`, so no byte leaves the process.
- **D2 — Strict outside a scope, in the AWS processes only.** The AWS rehearsal config gains a setup
  file that turns the gate on in strict mode: a send with no scope is refused. Everywhere else the
  gate (when installed) lets a scope-less send through, so ordinary tests are untouched.
- **D3 — The plan.** A run's plan is: its own bucket name; the prefixes `ctx.prefix(label)` issued;
  and the scenario's declared API list (a subset of the object-level APIs below). Two senders:
  - the runner's admin client (marked by the runner) may send only the lifecycle APIs, only on the
    run's own bucket: `CreateBucket`, `PutObject` and `GetObject` of the ownership marker key only,
    `GetBucketEncryption`, `GetBucketVersioning`, `PutBucketPolicy`, `DeleteBucketPolicy`,
    `ListMultipartUploads`, `AbortMultipartUpload`, `ListObjectsV2`, `DeleteObjects`,
    `DeleteObject`, `DeleteBucket`;
  - any other client ("scenario") may send only the declared APIs, only on the run's bucket, with
    every key (`Key`, each `Delete.Objects[].Key`) and every listing `Prefix` under an issued prefix.
    A scenario may never declare a bucket-level API (`CreateBucket`, `DeleteBucket`, the policy,
    encryption and versioning APIs); declaring one is refused when the plan is made.
  A refusal's detail names the API and the rule broken; it names a bucket only when the name matches
  `REHEARSAL_BUCKET_PATTERN` and otherwise says "a bucket this run did not create". It never echoes a
  key, a prefix or any other value.
- **D4 — A refusal fails the run even when the caller swallows it.** The server's stream code catches
  bucket errors and retries; so the scope counts refusals itself, records each as a receipt event
  (`phase: "request-refused"`, `outcome: "refused"`, and `api` only when the API is in
  `RECEIPT_APIS` — the receipt refuses any other `api`, `aws-rehearsal-receipt.ts:285`; the failure
  message always names it), and `runOwned` adds
  `AwsRehearsalFailed("N unplanned request(s) refused before sending; the first: <detail>")` to its
  problems. After the run, the scope is closed: anything sent through it later is refused and printed
  (`deps.print`) as a late refusal.
- **D5 — The runner checks its own `call()` too**, before `client.send`, so the plan holds for an
  admin client that is not an SDK client (the unit suites' `FakeAdmin`) and is proven there.
- **D6 — The after-the-fact check stays** (`requestRecorder`'s unlisted-API throw), unchanged.
- **D7 — Litestream's requests are outside the check**, because no Node code sends them. Stated in the
  runbook and in the PR. (The pause scenario's transport gate already limits Litestream's CONNECTs to
  the run's bucket host; the loop scenario has no such gate.) A question goes to `questions.md` with
  the default "leave it so".
- **D8 — Cleanup after an interrupt is done by a KEEPER process that outlives the run.** Before
  `CreateBucket`, the runner writes a journal (`aws-rehearsal-<runId>-journal.json` in the receipt
  folder: run id, region, the bucket name it is about to create, its state, the tracked upload ids
  and child pids each with its start time (`ps -o lstart=`), the run's scratch folder, the receipt
  header fields the keeper's receipt needs (`startedAt`, `commit`, `limits`), the teardown limit and
  the keeper's ceiling, and the endpoint when a test set one) and starts the keeper: ONE process,
  `process.execPath --import <tsx's ESM loader, resolved with createRequire>` (`.bin/tsx` would run
  the script in a second process), launched through a short-lived intermediate so its parent is
  pid 1 (out of Ctrl-C's process group and out of the watchdog's tree), with the environment passed
  explicitly (`WAITRON_RUN_AWS_REHEARSAL`, `AWS_PROFILE`, `AWS_REGION`, the two credential-file
  variables, `TMPDIR`, `PATH`). The keeper's stdin is a pipe whose other end only the runner holds:
  the runner's death is end-of-file on it, not a polled pid (no pid-reuse wait). The runner does not
  create the bucket until the journal shows the keeper ready. On a normal end the runner marks the
  journal `finished`, then ends the pipe; the keeper reads `finished` and exits 0 having done
  nothing. On end-of-file with the journal unfinished it acts: first a `GetObject` of the ownership
  marker (an answer of `NoSuchBucket` means nothing is left), then the same `teardownOwnedBucket`
  (journal uploads; a journal pid is signalled only while its start time still matches), removes the
  scratch folder, writes its OWN receipt, `aws-rehearsal-<runId>-interrupted.json`, opened with `wx`
  so a run receipt is never overwritten (with a `phase: "interrupted"` event), and prints its lines.
  The runner writes `deleted` to the journal as soon as `DeleteBucket` succeeds.
- **D8a — The keeper trusts the journal only within bounds.** It accepts the scratch path only if it
  is exactly `<tmpdir>/waitron-aws-rehearsal-<runId>`, an endpoint only if it is loopback
  (`http://127.0.0.1:<port>` or `http://localhost:<port>`), a bucket only if it matches
  `REHEARSAL_BUCKET_PATTERN`; otherwise it refuses, deletes nothing, prints why and exits 1. Every journal write is synchronous and atomic (write a temporary file, rename), so a kill
  right after `trackChild`, `trackUpload`, `scratch()` or the create answer is covered. The keeper
  exits non-zero when anything is left. It ignores SIGHUP (a closing terminal) and honours SIGTERM
  sent to it directly. It stops waiting after a ceiling of twice the run's whole budget (deadline +
  settle + teardown), logging that it gave up.
- **D9 — Where the keeper prints.** Always to `aws-rehearsal-<runId>-keeper.log` beside the receipt;
  and to the terminal when the runner had one (the runner opens `/dev/tty` before the fork and hands
  the descriptor down; under launchd the open fails and only the log is written). Its lines: the
  receipt path; then either `nothing left behind` or `left behind:` followed by one line per bucket
  (`bucket <name>` or `bucket <name> (ownership unknown)`), upload id and folder path.
- **D10 — Ownership after an interrupt.** Journal state `owned` (written as soon as `CreateBucket`
  answers owned) → teardown. State `deleted` → nothing to do for the bucket. State `creating` (about
  to send, or sent with no answer) → the keeper waits a grace period (the create may still land),
  then reads the marker: `NoSuchBucket` → nothing was created; anything else → it does not delete,
  reports `bucket <name> (ownership unknown)` and exits 1, as `unowned-candidate` works today.
  State `not-created`/`collision` → no bucket step.
- **D11 — The runner owns scratch.** `ctx.scratch(label)` makes `<tmpdir>/waitron-aws-rehearsal-<runId>/<label>/`
  (the root is named in the journal before it is made), and teardown gains a step `remove-scratch`
  that removes the root — on every run, owned bucket or not, after the bucket steps. The four AWS test
  files use it and drop their own `mkdtemp`/`rm`. The receipt's teardown table accepts the new step;
  it is required in a run receipt's owned teardown but not in a cleanup receipt's.
- **D12 — A local endpoint for proofs only.** `AwsRehearsalDeps` gains `endpoint?: string` (tests
  only, never read from the environment): the admin client and `bucketConfig` carry it, and the
  journal records it so the keeper's client goes to the same server. The AWS test files never set it.
  versitygw answers `GetBucketEncryption` with 501 `NotImplemented` (plan review, ran), so with an
  endpoint set the encryption and versioning preflight is skipped and recorded as a `skipped` event;
  without one it always runs. The runbook says so.
- **D13 — The loop scenario's Litestream is tracked.** `runStreamLoopScenario` gains a
  `serverSeams.spawn` (as the pause scenario has, `stream-pause-scenario.ts:181`, passed to
  `startServer`'s `stream` deps at `:424`), and the AWS loop test passes a spawn that calls
  `ctx.trackChild(pid)`, so teardown and the keeper can stop it.

## Global constraints

- TDD: every behaviour gets a failing test first; state what the failing case prints before each probe
  (CLAUDE.md §1). Prove each guard by deletion.
- Never send a request to Amazon. Every test here uses `FakeAdmin` or versitygw.
- `src/testing/**` and `scripts/**` are outside `apps/server`'s coverage (`vitest.config.ts`), so
  coverage is not the measure; assertions are.
- A new versitygw e2e file joins the `test-server-stream` job and the shards' `--exclude` list in
  `.github/workflows/ci.yml`, and follows `s3-rehearsal-scenarios.e2e.test.ts`'s skip-locally /
  fail-in-CI rule. Run `pnpm exec vitest run scripts/ci-workflow.test.mjs` from the root after.
- Messages and receipt fields never carry a key, secret, key, prefix or value from the environment
  (existing rule at `AwsRehearsalRefused`).
- Existing tests keep their assertions; a test that must change says so in the ledger's "Changed test
  checks" list for the PR.
- Focused runs: `pnpm --filter @waitron/server exec vitest run <files>`; typecheck
  `pnpm --filter @waitron/server typecheck`; lint the touched files.

## Plan review, folded in (2026-10-14, fresh-context reviewer)

Fifteen findings, all taken: versitygw fails the encryption preflight (D12); false "left behind"
from teardown steps answering `NoSuchBucket` (D8 marker read first, `deleted` state, D10 grace);
the keeper's receipt is its own kind with `wx` (D8); one keeper process via `--import` with an
explicit environment (D8); journal bounds and start-time-checked pids, death by pipe end-of-file
(D8, D8a); journal carries budgets and header fields (D8); refusal events carry `api` only when the
receipt allows it (D4); Task 3's test drives a real store with a recording handler; the loop's
Litestream is tracked (D13, Task 5b); one proof runs through Vitest itself (Task 7b); the CI guard's
`STREAM_TEST_FILES` list (Task 2b, 7b); a log control for every "no line in the log" probe; Task 4
uses a record mode; runbook line 9 and the listing-denial rule (Task 8); five rehearsal files, not
four (the profile file sends nothing); Tasks 2, 6 and 7 split.

## Tasks

### Task 1 — The plan check (pure)

New `apps/server/src/testing/aws-request-plan.ts` and its test:

- `SCENARIO_APIS` (the object-level APIs a scenario may declare: `GetObject`, `PutObject`,
  `ListObjectsV2`, `DeleteObject`, `DeleteObjects`, `HeadObject`, `GetBucketLocation`,
  `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`,
  `ListMultipartUploads`) and `LIFECYCLE_APIS` (D3).
- `createRequestPlan({ bucket, apis, prefixes })` — refuses an API outside `SCENARIO_APIS`
  (reason `plan-refused`; put the refusal error class where both this module and `aws-rehearsal.ts`
  can import it without a cycle — e.g. move `AwsRehearsalRefused` to a small module re-exported from
  `aws-rehearsal.ts`). `prefixes` is a live read of the issued set.
- `planRefusal(plan, sender: "runner" | "scenario", api, input): string | null` implementing D3,
  including `GetBucketLocation` (no key), the marker key for the runner, `DeleteObjects` key lists,
  listing prefixes (a missing `Prefix` on a scenario listing is refused).
- Tests: one passing and one refused case per rule, including: another bucket (named when it matches
  the rehearsal pattern, otherwise "a bucket this run did not create"); a key in the bucket but outside
  every issued prefix; a `DeleteObjects` list with one key outside; a scenario `DeleteBucket`; a runner
  `PutObject` of a non-marker key; an undeclared scenario API; an API name outside `RECEIPT_APIS`; a
  declared bucket-level API refused at plan creation. Assert no refusal detail contains the key,
  prefix or foreign bucket name used.

### Task 2a — The send gate (unit level)

New `apps/server/src/testing/aws-send-gate.ts` and a unit test (no versitygw):

- `installSendGate()` — idempotent wrap of `Object.getPrototypeOf(S3Client.prototype).send`
  (signature `send(command, optionsOrCb, cb)`). Finds the scope from an `AsyncLocalStorage`; sender
  `runner` when the client was passed to `markRunnerClient(client)` (a `WeakSet`), else `scenario`;
  API from the command's constructor name minus `Command`. Refusal → reject, or call the callback
  argument with the error, without calling the real `send`. No scope: refused when strict, passed
  through otherwise.
- `setSendGateStrict(on: boolean)`; `openRequestScope({ plan, mode: "enforce" | "record", onRefused })`
  returning `{ run(body), check(sender, api, input), close(), refusals(), seen() }` — `run` enters the
  `AsyncLocalStorage`; `check` is the same check `send` makes (Task 3 calls it from `call()`);
  `record` mode lets every request through and lists the `(sender, api)` pairs it saw (Task 4 uses
  it); after `close()` every check refuses with "the run has ended".
- Unit tests drive a real `S3Client` with a recording `requestHandler` (no network): a planned request
  reaches the handler; an unplanned one does not (handler count 0) and rejects; control with the scope
  absent and the gate non-strict: reaches it; strict scope-less refused; callback form; idempotent
  install (one wrap after two installs); closed scope refuses; a client created BEFORE the scope is
  still checked; record mode lists and passes.

### Task 2b — The gate against versitygw, and CI wiring

- `startS3TestServer` gains `region?` and `accessLog?` options (passes `--region`, `--access-log`).
- New `apps/server/src/aws-send-gate.e2e.test.ts` against versitygw (skip locally without it, fail in
  CI — as `s3-rehearsal-scenarios.e2e.test.ts` does). State the failing output before each case:
  1. a planned `PutObject` under an issued prefix reaches versitygw (its access log has the line);
  2. `DeleteBucket` of a second, pre-made bucket from a scenario client inside the scope is refused,
     the second bucket still exists, and the access log has NO line for that bucket; control: a
     scope-less `GetBucketLocation` on the second bucket (non-strict) DOES appear in the log;
  3. a store from `@waitron/stream` (`createS3ObjectStore`) built inside the scope is checked;
  4. a request sent from an HTTP server's handler — the server started inside the scope, called from
     outside it — is checked.
- Add the file to `test-server-stream` and to the shards' `--exclude` list in `ci.yml`
  (`:804-807`, `:869-872`), and to `STREAM_TEST_FILES` in `scripts/ci-workflow.test.mjs:59-64`; run
  `pnpm exec vitest run scripts/ci-workflow.test.mjs` from the root.

### Task 3 — The runner enforces the plan

In `aws-rehearsal.ts`:

- `withAwsRehearsal(scenario, overrides)` takes the scenario's API list
  (`rehearsalLifecycle({ apis })` and `withAwsRehearsal(scenario, { apis, ... })`; required — a run
  with no list is refused, `plan-refused`). Install the gate; mark the admin client as the runner's;
  open the scope around `runWithDeadline(setUpAndRun)` AND teardown; `call()` runs `scope.check`
  before `client.send` (D5) and returns a refused outcome without sending.
- Each refusal is recorded (D4) and fails the run with the first refusal named; close the scope after
  the receipt is written; a late refusal is printed.
- `vitest.aws-rehearsal.config.ts` gains a setup file that turns strict mode on (D2).
- Each AWS test file passes its API list from one module, `aws-rehearsal-plans.ts`
  (`LOOP_APIS`, `PAUSE_APIS`, `ARCHIVE_APIS`, `DELETE_APIS`). Archive and delete: derive the lists
  from their scenarios' code now; loop and pause: provisional lists, confirmed by Task 4.
- Tests with `FakeAdmin`: a scenario store built from `ctx.bucketConfig(...)` with a recording
  `requestHandler` sends a request for another bucket → the handler saw zero requests, the run fails
  naming it, teardown still runs, and the receipt carries the `request-refused` event; control: the
  same store outside any run reaches the handler; the runner's own `call()` refuses a non-lifecycle
  API before `FakeAdmin` records it; a refusal the scenario swallows still fails the run; a refused API
  outside `RECEIPT_APIS` still fails the run naming it, and its event has no `api`; the existing
  suites stay green with no assertion changed.

### Task 4 — The plans proven locally

- Run the local versions of each scenario inside a scope with its plan (bucket = the local bucket,
  prefixes = the scenario's prefix), the local servers STARTED inside the scope:
  `s3-rehearsal-scenarios.e2e.test.ts` (archive, delete), `stream-loop.e2e.test.ts`,
  `stream-pause.e2e.test.ts`. A refusal there fails the test, naming the request, so a server change
  that sends a new API is caught locally and in CI before an AWS run.
- Fill `LOOP_APIS` and `PAUSE_APIS` from one run each in `record` mode, then switch to `enforce` and
  re-run green.
- Record in the ledger which APIs each list holds and the run that showed it. The stream loop and
  pause tests need both binaries (installed in the worktree's `.bin/`).

### Task 5a — The runner owns scratch

- `ctx.scratch(label)` and the `remove-scratch` teardown step (D11), receipt changes in
  `aws-rehearsal-receipt.ts` (step accepted; required in a run receipt's owned teardown, not in a
  cleanup receipt's; `readLeftReceipt` unaffected), and the thrown teardown message names the folder
  when its removal failed.
- The four scenario AWS test files switch to `ctx.scratch`; their `afterAll` keeps `rehearsal.stop()`.
- Tests with `FakeAdmin` and a real temporary directory: removed on success, on scenario failure, on a
  not-created bucket; a removal failure fails the run and names the folder; a second `scratch` with
  the same label is refused.

### Task 5b — The loop scenario's Litestream is tracked (D13)

- `runStreamLoopScenario` takes `serverSeams?: Pick<StreamHostDeps, "spawn">` and passes it to both
  servers' `startServer(..., { stream: ... })`; the AWS loop test passes a spawn that calls
  `ctx.trackChild(pid)`. A local test proves the seam is called for each Litestream the loop starts
  (the local `stream-loop.e2e.test.ts` or a unit case).
- Runbook lines 52–54 ("the runner never learns the Litestream child's process id") change in Task 8.

### Task 6a — The journal, and the runner's writes to it

- New `apps/server/src/testing/aws-rehearsal-journal.ts`: the shape (D8), atomic synchronous writes
  (temporary file, rename), a strict reader that refuses anything malformed or outside D8a's bounds
  (fields named, never values).
- The runner writes it through a `deps.journal` seam: created before `CreateBucket` (state
  `creating`), `owned`/`not-created`/`collision` on the answer, `deleted` once `DeleteBucket`
  succeeds, uploads and pids (with start times) as tracked, scratch root before it is made,
  `finished` after the receipt is written.
- `assertCleanupCommandFits` also checks the `-interrupted` receipt name; `receiptFileName` gains the
  `interrupted` kind.
- Tests with `FakeAdmin`: the journal's states in order for a passing run, a failed create, a failed
  teardown; a kill can only ever find a journal that names every tracked upload and pid (written
  before `trackUpload`/`trackChild` return); the reader refuses each D8a violation.

### Task 6b — The keeper (unit level)

- New `apps/server/src/testing/aws-rehearsal-keeper.ts`: `runKeeper(journalPath, deps)` returning
  the exit status, with `deps` for the end-of-file wait, `sleep`, `now`, the admin client factory,
  `print`, the log file, process start-time lookup. Behaviour per D8–D10. Its teardown runs inside a
  scope with the lifecycle plan, the gate strict.
- Tests with `FakeAdmin`: exits 0 untouched when the journal is finished; on end-of-file with `owned`
  it stops tracked pids (only those whose start time matches), aborts tracked uploads, deletes objects
  and the bucket, removes scratch, writes the `-interrupted` receipt with the `interrupted` event,
  prints `nothing left behind`, exits 0; marker read `NoSuchBucket` → nothing left, exit 0; a failing
  `DeleteBucket` prints `left behind:` and the bucket line, the receipt names the cleanup command,
  exit 1; `creating` + marker `NoSuchBucket` after the grace → nothing left, exit 0; `creating` +
  bucket present → `(ownership unknown)`, deletes nothing, exit 1; scratch removal failure prints the
  folder, exit 1; an existing `-interrupted` receipt is not overwritten; the ceiling ends the wait.

### Task 7a — Starting the keeper, and the first proof against versitygw

- `apps/server/scripts/aws-rehearsal-keeper.ts`: the entry (`--journal <path>`; `--launch` spawns the
  real keeper detached with stdin inherited and exits, so the keeper's parent is pid 1).
- The runner's default `startKeeper` (D8, D9): opens `/dev/tty` if it can, spawns the launcher with
  `process.execPath --import <tsx loader>`, the explicit environment and a stdin pipe it keeps
  (unref'd), waits up to 10 s for the journal to show the keeper ready, refuses the run otherwise
  (`keeper-unavailable`).
- `AwsRehearsalDeps.endpoint` and the preflight skip (D12).
- New `apps/server/src/testing/aws-rehearsal-interrupt-driver.ts` (run as a child under
  `node --import <tsx>`, in its own process group) and `apps/server/src/aws-rehearsal-interrupt.e2e.test.ts`
  against versitygw started with `--region eu-north-1 --access-log <file>`, credentials written to
  temporary files outside the repository, short teardown and ceiling limits. The driver's scenario
  writes objects under its prefix, starts a multipart upload (`trackUpload`), spawns a long `sleep`
  (`trackChild`), writes a `secrets.env` into `ctx.scratch`, then announces its point on stdout and
  waits. First case: SIGINT to the driver's process group mid-scenario → versitygw lists no
  `waitron-rehearsal-` bucket, the scratch root is gone, the tracked `sleep` is dead, the keeper's
  `-interrupted` receipt has `remaining.bucket` null, its log says `nothing left behind`. State the
  failing output first.
- Add the file to `ci.yml` (both lists) and `STREAM_TEST_FILES`.

### Task 7b — The remaining interrupt proofs

In the same e2e file, the failing output stated first in each:
1. SIGINT to the group right after setup (bucket and marker made, nothing else);
2. SIGTERM mid-scenario to the driver's pid alone (a watchdog that misses the group);
3. SIGTERM to the group while the runner's own teardown is held (versitygw paused with SIGSTOP as
   teardown starts, resumed after the kill);
4. an uncaught error thrown from a timer in the driver mid-scenario;
5. a failing cleanup: versitygw paused for longer than the keeper's (short) teardown limit → the log
   says `left behind:` with the bucket's name, the receipt carries the cleanup command, the log's last
   line gives exit status 1; then resume and run `cleanupFromReceipt` so the test leaves nothing;
6. the unplanned request end to end: the driver's scenario sends `DeleteBucket` for a second,
   pre-made bucket; the run fails naming the request; the second bucket still exists; the access log
   has no line for it; control: a scope-less `GetBucketLocation` on it does appear;
7. through Vitest itself: a tiny test file run by `vitest run` under a config like
   `vitest.aws-rehearsal.config.ts` (with the endpoint seam set in the test), SIGINT to the vitest
   process group mid-scenario → same end state as the first case.
Each case's end state as in Task 7a. Measure the file's run time and keep `test-server-stream` (1 min
49 s on `c7c1b26c6`, run 38559788791) within about 4 minutes; write the measurement in the ledger.

### Task 8 — The runbook, the backlog, and the question

- `docs/developers/aws-backup-rehearsal.md`: line 9 and the "Ctrl-C is not handled" bullet become
  what the keeper does, its log and receipt, its ceiling and its limits (`creating` is reported, not
  deleted; the keeper trusts the journal only within D8a's bounds); lines 52–54 on the loop's
  Litestream; a section on the request plan: what is checked before sending, the strict mode, the
  late refusal, what is NOT checked (Litestream, D7); the scratch now made and removed by the runner;
  the preflight skipped for a local endpoint (D12). Grep `docs/` for "Ctrl-C", "not handled",
  "observer", "after the call" and fix every stale claim.
- `docs/backlog.md`: remove A538-7's (1) (including its listing-denial rule, which the keeper's
  `remove-policy` step now covers) and A538-9's (1) from their entries; renumber what remains; add a
  short entry for anything this branch leaves open.
- `questions.md` (campaign file, not the repo): D7's question with its default.
- No screen changes; nothing to look at in a browser.

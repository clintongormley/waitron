# CI, tests and developer tooling — detail

The open entries are listed in [the backlog](../backlog.md), under "CI, tests and developer tooling". This file holds
their full text.

## Venue-service browser startup remains unexplained (#1557)

On 2026-10-11, [CI attempt 1's venue-service shard 2](https://github.com/clintongormley/waitron/actions/runs/38170156450/job/114561139899)
passed 317 database tests, then reported `Failed to connect to the browser session` before any
browser test started; attempt 2 passed on the same commit, and so did local macOS runs of shard
`2/4` with a warm and a cold dependency cache. The cause is still unknown.

Every `test-venue-service` shard now logs each browser start-up step with its time,
and a failed shard keeps the artifact `venue-service-diagnostics-<shard>` (its whole output, 5 s
resource samples and a runner snapshot, 14 days). How to read one, and the measurements:
[ci-and-gates.md](../developers/ci-and-gates.md#a-failed-venue-service-shard-keeps-its-browser-start-up-record).

Next: when the message appears again, download that shard's artifact and find the first start-up
step missing from `shard.log`; fix that step. Do not raise `connectTimeout`, add a retry or lower
concurrency first. A raised limit goes in the outer config's `test.browser` block, the only place
Vitest 4.1.11 reads it.

## What the landing-port fix (A80, PR #740) left open

A configured or mixed caller needs a known address; it still has a gap if it releases that address before its first real listener binds, whoever owns that listener. Keep configured addresses, advertised origins and listener-release assertions when choosing a fixture. An unused endpoint is a separate risk: another process can take it even though the test expects no listener.

The source audit at `213d0ec3bc` covered 229 allocation expressions in 85 operational caller files, including aliases: 160 already used bind-time fixtures. The configured and mixed rows were checked separately for first-bind ownership. This is a source classification, not a runtime verification of every caller. The following table keeps the remaining contracts and gaps. Allocation line numbers refer to the reviewed candidate `4fb4d32d6b`; fiscal rows below remain with Lane L.

| Caller under `apps/server/src/` | Allocation line(s) | Remaining contract or ownership gap |
| --- | --- | --- |
| `boot-peer-check.test.ts` | 1821 | Unused peer address; nothing holds it while the refusal is checked. |
| `boot.failed-start.test.ts` | 485, 505, 616, 1165, 1412 | Configured main/landing/staff first binds remain unreserved; keep the failed-start and exact listener-release checks. |
| `boot.invoice-delivery.test.ts` | 188 | Ordinary HTTP binds at zero; configured mirror starts still have an initial gap, and the unused peer address is unreserved. |
| `boot.joining-spare-answers.test.ts` | 206 | Advertised HTTPS and public store addresses are known before the first binds, which remain unreserved; the fake gateway does not bind its loopback argument. |
| `boot.mirror.test.ts` | 381, 948, 1150 | The staff address is intentionally unused and unreserved. Fake-gateway loopback arguments are configured data, not listening sockets. |
| `boot.reconcile.test.ts` | 415, 461, 490 | Unused peer addresses remain unreserved. |
| `boot.restore.test.ts` | 443 | Malformed-membership cases expect a refusal rather than a successful listener; their unused peer input remains unreserved. |
| `boot.setup-routes.test.ts` | 480 | The extra unused peer is unreserved. |
| `boot.start-check.test.ts` | 877 | The first configured waiting listener is unreserved; preserve the separate, intentional waiting-to-normal rebind check. |
| `boot.test.ts` | 2745 | The unresolvable-host case keeps configured port input and expects ENOTFOUND. |
| `boot.upgrade.test.ts` | 346 | The built-entry child checks still release the configured address before each new child binds; preserve their release/rebind checks. |
| `boot.adoption-allocation.test.ts` | 324 | The sleep stub records its configured loopback argument without binding a listener. |
| `handover-controlled.e2e.test.ts` | 576 | Both advertised box addresses are released before first use. Later saved-origin restarts also retain their existing binding contract. |
| `testing/s3-test-server.ts` | 152 | The real Go listener still has a first-bind gap; bounded PortTaken retries and instance-signed readiness recover collisions without retaining the socket. |
| `testing/spare-join-scenario.ts` | 631 | Main/spare HTTPS and store addresses are released before their first listeners bind; preserve the saved origins and later restarts. |
| `testing/stream-loop-scenario.ts` | 264, 492 | The primary/restore addresses are persisted before later starts bind them; first-bind ownership remains open. |
| `testing/stream-loop-spare.ts` | 148 | Spare HTTPS/store addresses remain configured and unreserved through their first starts. |
| `testing/stream-pause-scenario.ts` | 273 | The advertised address is persisted before the first start binds it; ownership remains open. |
| `spare-store.test.ts` | 275 | The real versitygw process, launched through spawnLitestream, receives a configured loopback port. Its first bind remains unreserved; keep the real successful-key and 403/404 checks. |

Fiscal rows, left unchanged for Lane L:

| Caller under `apps/server/src/` | Allocation line(s) | Contract / first-bind ownership |
| --- | --- | --- |
| `first-fiscal-document-download.e2e.test.ts` | 107 | Configured management origin; initial bind unreserved. |
| `first-fiscal-hour-import.e2e.test.ts` | 207 | Initial bind unreserved; later same-port rebind is separate. |
| `first-fiscal-launch.test.ts` | 140 | Initial bind unreserved. |
| `first-fiscal-setup.e2e.test.ts` | 159, 565, 648 | Initial binds unreserved; later same-port rebind is separate. |
| `first-fiscal-state-write.boot.test.ts` | 48 | Initial bind unreserved. |
| `fiscal-certificate-api.verifactu.test.ts` | 259 | Initial bind unreserved. |
| `fiscal-readiness-first-setup.test.ts` | 145 | Initial bind unreserved; later same-port rebind is separate. |
| `hour-promotion.test.ts` | 847, 944 | Configured origins; initial binds unreserved, later rebind separate. |
| `hour-recovery-placement-3.test.ts` | 419, 780 | Configured management origin and later recovery start; initial binds unreserved. |

Cloud’s external `scripts/test-waitron-pairing.mjs:56` stops and relaunches the same saved origin while no process holds its port; retain that socket in Cloud’s runner across restarts (source read, not run). Later same-port rebinds inside one process still need their own handoff audit. The bench’s refused endpoint has its own entry below.

A1152 applies the bind-time port-zero fixture to the matching in-process `boot*.test.ts`
siblings. The fixture delegates to real Hono, waits for its real listener, and directs requests
to that listener's address. `boot.failed-start.test.ts` retains its configured-port teardown
checks. Explicit configured-port, tunnel-target, advertised-origin and paired landing-listener
cases retain the configured binding, including an unused peer drawn alongside the HTTP port. A907's
existing clock-listener fixture already selects at bind time. None changes production validation.

7 November 2026: A951-S removes the retired TCP relay's tunnel-target case. The remaining
configured-binding checks above still apply.

C88 (#920) reproduced the release-to-bind gap as one way the pause test's single CI failure
could happen; `startS3TestServer` now recovers from it.

Keep the shared fixture’s scope explicit when extending it: `ephemeralHttpMock` in
`apps/server/src/testing/ephemeral-listener.ts` rewrites every `serve` port in its default mode,
and `httpPort()` reports the last listener. A synthetic two-listener request reached the second
listener. The converted suites passed 233 cases with listener-call instrumentation.
Paired main/landing listeners retain the configured binding;
do not assume the default fixture can identify the main listener in that shape.

## Give the failover bench an endpoint that stays refused

`bench/sqlite-failover/src/unreachable-store.ts` releases a port intended to stay unreachable, so another worker can bind it later. Give the SDK/Litestream consumers an endpoint that remains refused for its lifetime, preserving the existing bounded `probeRefusal` check for actual `ECONNREFUSED`.

The port-zero candidate failed a probe of Node’s `http.request`: a 16 November control on macOS Node 26.13.0 observed port 0 reaching the transport as 80, while port 1 remained 1. This did not exercise the SDK or Litestream. Port zero, an assumed-free fixed port and startup-only refusal do not establish lifetime refusal. This independent design remains open after the [server fixture audit](#what-the-landing-port-fix-a80-pr-740-left-open).

**17 November, REFUSED-ENDPOINT probe.** A TCP socket bound to `127.0.0.1` without
calling `listen` did not provide the required portable refusal. Lane I ran the disposable
`probe.mjs` in `~/waitron-campaign-i/receipts/refused-endpoint-20261117/` with Node 26.13.0,
the real AWS SDK `ListObjectsV2` client and checksum-verified Litestream 0.5.18. The Linux
run used Docker Desktop's aarch64 `node:26-trixie` guest, not a separate physical host.
The recorded commands were, with `probe` naming that receipt directory and `repo` the
registered `waitron-fix-refused-endpoint` checkout:

```sh
REPO="$repo" LITESTREAM="$probe/runtime/darwin/litestream" node "$probe/probe.mjs" held
docker run --rm --name lane-i-refused-linux-20261117 \
  -v "$repo:$repo:ro" -v "$probe:/probe:ro" \
  -e REPO="$repo" -e LITESTREAM=/probe/runtime/linux/litestream \
  node:26-trixie node /probe/probe.mjs held
```

| Platform | Competing Node bind | Node connection | AWS SDK | Litestream |
| --- | --- | --- | --- | --- |
| macOS | `EADDRINUSE` | `TIMEOUT` after 2 seconds | `AbortError` at its 2-second bound | Outer `ETIMEDOUT`, `SIGTERM` after 30 seconds; no refusal output |
| Linux guest | `EADDRINUSE` | `ECONNREFUSED` | `ECONNREFUSED` | Exit 1; `connect: connection refused` |

The macOS command with final argument `released` let the competing listener print
`listening`, failing the assertion that expected `EADDRINUSE`. A separate released-port
macOS control returned errno 61, `Connection refused`; `sysctl net.inet.tcp.blackhole`
printed `0`. Wildcard and IPv6 bound-socket variants on macOS timed out too, and the
wildcard variants allowed a competing bind. The raw records are `released-red.log`,
`macos-held.log`, `macos-clients.log`, `linux-held.log` and `macos-address-options.jsonl`
beside the probe. Downloaded binaries were collected after the run; re-running requires
restoring the pinned binaries and checkout dependencies. The watcher parked this item at
01:34 CET pending a portable design. The five unused-peer server rows above remain open;
keep `probeRefusal` and its `ECONNREFUSED` requirement unchanged.

## What the per-push CI concurrency groups (#384) left open

- **No run has exercised the `hold` answer** — an older run publishing after a newer one — which
  needs two merges close enough together to overlap and is not worth forcing.
- **Two states stop publishing until a person intervenes:** a `:main` carrying no
  `WAITRON_BUILD_ID`, and one built from a commit GitHub's comparison cannot place against the
  commit being published. Both wedge every later publish, the `sha-` tags included (read from
  `.github/workflows/ci.yml`, not run: the guard's step fails and the publish steps after it have
  no `if:`). A rewritten history reaches the second state whenever GitHub refuses the comparison:
  no common ancestor, or an old tip it no longer holds
  ([dated probes](../developers/ci-and-gates.md#separated-pushes-overlap-so-publishing-asks-before-it-takes-main)). The repair is
  to delete or retag `:main` by hand. Nothing alerts on it.
- **The first publish into a brand-new package will stop**, because GHCR answers `403 Forbidden`
  for a package that does not exist rather than `not found`, and treating a 403 as "no tag yet" is
  exactly the broadening that would publish a backwards tag. It matters only to a fork.
- **The guard's concurrency cases see ci.yml alone.** `scripts/ci-workflow.test.mjs` reads that
  one file as text for them, so a future push-triggered workflow that groups by ref is seen by
  nothing.

## Unexplained incidents, each seen once or twice; on recurrence retain the log before retrying

Standing rule: a flaky test is fixed at the root. Eleven UI suites failing to load with
"Vitest failed to find the current suite/runner" after a rebase (2026-09-11); bookings' browser
freeze, never reproduced locally after #291. A third, from #334's validation run (2026-09-12):
the service-status browser suite failed with Playwright's "Frame was detached" during a
whole-workspace run, and then passed on its own with no code change. The original log and screenshot were kept; the cause is unexplained, so retain them
again on the next sighting rather than re-running to green.

A fourth, first seen on PR #2979 (2026-11-12, run 43259195658, attempt 1, `test-till` shard 3):
`apps/till/src/till-app.test.ts` "a completed refund keeps the Transactions query, filters, sorting
and page while leaving the basket intact" gave up waiting with the last list request still sending
`q: ''` after "0091 " was typed in the Transactions search. The branch changed only a comment in the
till; the case passed locally and on the shard's re-run. Of the 40 most recent failed CI runs, two
had failing `test-till` jobs whose failed cases were read (runs 43240726730 and 43137922853); none
was this case. Earlier sightings were not searched further. The log is kept at
`~/waitron-campaign-c/ci-logs/pr2979-run43259195658-attempt1-test-till-3.log`.

## Server shard 2 stalled once on a hosted runner (PR #2664, 2026-11-09)

Run [42690313010](https://github.com/clintongormley/waitron/actions/runs/42690313010), job
`test-server` shard 2, on a GitHub-hosted ubuntu-26.04 runner: two database-open hooks
(`boot.place-copy.test.ts`, `till-api.table-actions.test.ts`) hit "Hook timed out in 60000ms", and
`first-fiscal-boot.test.ts`'s "real HTTPS claim readiness … trading interruption restarts a separate
process" timed out at 120 s, with two sibling cases failing after it. The same server code had
passed that shard on the run before; the re-run of the failed job passed. No earlier sighting was
searched for beyond this file. The full log is kept at
`~/waitron-campaign-l/ci-logs/pr2664-run42690313010-test-server-2.log`. On the next sighting keep
that log too and locate what the hooks were waiting on before changing a deadline.

**Server shard 19 ran silent to the job limit (PR #3342, 2026-11-15).** Run
[43721700167](https://github.com/clintongormley/waitron/actions/runs/43721700167), job
`132835178034`: the shard step started at 14:01:02Z and the job was cancelled at its 10-minute
limit ("The job has exceeded the maximum execution time of 10m0s"); the jobs-logs API answered
`BlobNotFound`, so no file progress survives. The same branch passed shard 19 in about two minutes on
its two previous heads. Locally on macOS the same 60-file shard (`--shard=19/24`, CI's excludes and
the file-progress reporter) passed every file. The server test command now has a diagnostic
process deadline: a hang inside that step reports unfinished files and a live process snapshot
before the job limit, within the measured setup allowance. Setup stalls and runner loss remain
outside that report. Neither this diagnostic nor the passing runs locates the original wait.

## A throwaway script found six comments that described code that was no longer there, and it is not a guard yet

Written 2026-09-14 during the tenant-column removal. It flags a comment whose
subject has gone from the lines beneath it. It is not usable as it stands: 13 of its 19 hits
were the legitimate shape where a block comment heads a group of members rather than describing
the one line below it. **Next action:** rewrite it as a real root guard with an allowlist for that
header-then-member shape, and its own tests, rather than re-running a scratch script.

## Schema files keep `v8 ignore` pairs with no stated reason

- Schema files in `packages/db/src/schema` (including `identity/`),
  `packages/fiscal-verifactu/src/schema`, `packages/node-db/src/schema` and
  `packages/payments/src/schema` keep `v8 ignore` pairs, and none says why. Removing a pair is a
  code change, for whoever next changes that package's code.

## `--no-verify`: the docs say "Claude never", the hook says "agents never"

`CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` say "Claude
never pushes with `--no-verify`"; the hook's hint (`.husky/pre-push`) says "agents never". Codex
sometimes drives and reads `CLAUDE.md`, so the docs may need "no agent". **Next action:** the owner
decides whether the rule covers every agent, then the two docs follow.

## A668-5 normal-push recurrence, 2026-10-16

2026-10-22: A994 reproduces the diagnostic failure cold and starts that fixture after self refresh,
retaining its Docker, error, signal and 700 ms assertions. Its root worker estimate and concurrent
validation are recorded in [CI and gates](../developers/ci-and-gates.md#root-workers-start-from-available-headroom).

2026-10-17: A770 (#1816, `d2f9bc3de08c2a3c0d2284a03efcc342319809a1`) reproduced
paused-thread failures in the step-watch cases and changed their budgets, retaining their phase
checks. The installer, menu-upgrade and mutation-fixture failures retain their separate investigations.

Retain the full-suite workload when investigating the menu-upgrade failure; for the installer case, separate
the preparation before Docker from the deliberately hung command before deciding what its
700 ms budget should measure. Lane G retains both full logs and the process/open-file/memory
snapshots under its A668-5 receipts.

The moving-phases case in `scripts/step-watch.test.mjs` rejected against its no-progress
limit; the diagnostic-matching case raised `TypeError: object null is not iterable`.
Investigate the monitor's observed phase timing and its
missing diagnostic match separately from the mutation fixture's elapsed-time limit. The new
failure log is `push-final-attempt.log` in Lane G's A668-5 receipts.

## Bundle A1398: Pack the other packages' test shards by measured time

1 conditional entry. Add an inventory of run test files only if a same-count wrong-files case is
ever seen. For later packing comparisons, use qualified runs with one coverage mode; never mix
runs from before and after A1427.
Db, provisioning, venue-service and fiscal-verifactu keep the file-count split because their
measured shards are inside the four-minute target; revisit a package when a job passes about four minutes.

## Bundle: Get ready for A1308's history rewrite (A1306 and CI's concurrency groups)

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06),
except A1306's timing and the guard's corrected sentences (2026-11-07). The owner kept A1306 as the last step of A1308 (2026-11-06), so Task 19 of
[A760's plan](../superpowers/plans/2026-11-04-a760-squash-into-eight-sets.md) did not run in A760's
freeze. A760 part 3 corrected the guard's two wrong sentences.

- **A1306. Rewrite git history to drop the development artifacts** (owner, 2026-11-02: "there is
  no point in keeping these development artifacts as history"). Rewrite `main` with them removed,
  at a moment when the lanes are paused, as the last step of A1308 (owner, 2026-11-06).
  [Detail](ci.md#a1306-rewrite-git-history-to-drop-the-development-artifacts).
- **What the per-push CI concurrency groups (#384) left open:** two states stop publishing until a
  person intervenes; the repair is to delete or retag `:main` by hand. Nothing alerts on it. [Detail](ci.md#what-the-per-push-ci-concurrency-groups-384-left-open)

## CI incidents to watch

The causes and qualification limits below remain open. Sightings are the records already kept
in this backlog; “not recorded” marks information absent from the source entry. Keep the log
before retrying and reproduce the pending operation before assigning a cause.

| What was seen | Last recorded sighting (run/job) | Retain next time | Retained logs |
| --- | --- | --- | --- |
| A1022: GitHub created no workflows for A987’s main merge; cause unverified. Recovery and a successful-CI baseline do not explain the trigger. | No CI run created for `e7ce92a7c`; runs API returned none. | Keep the after-merge run check. | No CI log recorded; [recovery procedure](../developers/ci-and-gates.md#recover-a-main-commit-whose-ci-run-was-never-created). |
| A891: missing product-information window. A busy-renderer probe reproduces the symptom; the gesture now recognises a held release before its overdue timer. The exact CI cause remains unverified. | [39180066136](https://github.com/clintongormley/waitron/actions/runs/39180066136); job ID not recorded; that run retained no such trace. | Pointer timestamps, hold-callback timing, selection count and screenshot before retrying. | [Reproduction](../developers/testing-guide.md#a-held-press-can-reach-pointer-up-before-its-hold-timer-runs); CI trace not retained. |
| A999: allergy move; the original loaded run reported two failures without case names or assertion output. The 2026-10-22 reproduction found the corrected-guest case, where a parent restored a cleared refusal. | Original CI run/job not recorded; reproduction: 2026-10-22. | Capture the exact case and output before attributing another recurrence to the same mechanism. | [Receipt](../developers/conventions-ui.md#a-parent-render-must-not-restore-a-corrected-request-refusal); original case names and output not retained. |
| Silent pnpm setup stayed active through cancellation; final log unavailable. Fresh-runner samples do not establish its cause. | [40644939856](https://github.com/clintongormley/waitron/actions/runs/40644939856/job/122671628160) | Last phase `start`/`end` and the named operation; retain cleanup/GITHUB_PATH evidence before changing limits. | [Detail](#explain-the-two-older-silent-pnpm-setup-stalls); final log unavailable. |
| Silent pnpm setup timed out with no script output or tests. Removing the initial Node dependency does not establish its cause. | [42034714487](https://github.com/clintongormley/waitron/actions/runs/42034714487/job/127269970638) | Last phase `start`/`end` and the named operation before changing limits. | [Detail](#explain-the-two-older-silent-pnpm-setup-stalls); retained-log path not recorded. |
| A544 / step-watch pre-push failures: the earlier late-worker cause remains likely, unconfirmed; the later undefined held-thread result has a controlled reproduction, with the original delay unobserved. | Local pre-push, no CI run; latest recorded failure 2026-10-16 (A770). | Keep the exact message and distinguish stalled phases, an empty report and a held call that never ran. | [Detail](#the-step-watch-cases-a544-pre-push-failure-is-fixed-at-a-likely-cause-not-a-confirmed-one); [held-thread observation](#the-step-watch-guard-received-an-undefined-held-thread-result). |
| A1230: dashboard shard 1’s blocked operation remains unknown. | [41046955691](https://github.com/clintongormley/waitron/actions/runs/41046955691/job/124036233860); 2026-10-30. | Whole log, selected-file case/hook events and Playwright API log; locate the pending operation first. | Retained-log path not recorded; [detail](#a1230-dashboard-shard-1s-blocked-operation-is-unknown). |
| A1305: dashboard page blocked during a switch click; what blocked it remains unknown. | [41338680756](https://github.com/clintongormley/waitron/actions/runs/41338680756/job/124944000948); 2026-11-01, `test-dashboard (4)`. | Read `[file-progress] stack:` first once a file is silent 60 seconds past its limits; retain the complete log. | Retained-log path not recorded; [detail](#a1305-the-dashboard-page-blocked-during-a-click-and-what-blocked-it-is-unknown). |
| A1027: till shard’s blocked operation remains unknown; preceding/following healthy shards do not diagnose it. | [39898823017](https://github.com/clintongormley/waitron/actions/runs/39898823017/job/120235613840) at `c76bcdaf3`; log lost. | Failed step log, unfinished-file/process reports, selected-file case/hook events, Playwright calls and any stack sample. | Original log lost; retained-log path not recorded; [detail](#the-till-shards-blocked-operation-is-unknown-a1027). |
| #1557: venue-service browser startup remains unexplained. | [38170156450](https://github.com/clintongormley/waitron/actions/runs/38170156450/job/114561139899); 2026-10-11, attempt 1. | Download `venue-service-diagnostics-<shard>` and locate the first missing startup step before changing limits or concurrency. | [Detail](#venue-service-browser-startup-remains-unexplained-1557). |
| A419 / #1474: dashboard stall remains unexplained; `catalogue-screen.test.ts` unfinished. Focused/full local and diagnostic CI passed; no repair established. The failed run was cancelled after 3m26s without output. | [37932573955](https://github.com/clintongormley/waitron/actions/runs/37932573955); job/date not recorded. Diagnostic [37936013331](https://github.com/clintongormley/waitron/actions/runs/37936013331) passed. | Per-test progress; locate the waiting operation before changing the browser harness. A441 reports file start/end and unfinished files every 60 s via `scripts/vitest-file-progress.mjs`. | Retained-log path not recorded. |
| Frozen-bucket control in `stream-pause.e2e.test.ts`, step 6 / line 540: expected `unanswered`, got `answered` after `s3.pause()`. W30 awaits stopped state; original one-off race not reproduced locally. | [37108993254](https://github.com/clintongormley/waitron/actions/runs/37108993254/job/111163230954); PR #1101, 2026-10-03, attempt 1; re-run passed. | Keep the log and inspect child state before naming another cause. | Retained-log path not recorded. |
| Suite loading; bookings freeze; detached frame; refund search. Causes and reproduction limits remain in the linked detail. | See detail. | Retain the log before retrying; keep each incident’s timing, process/browser state and reproduction limits. | [Detail](#unexplained-incidents-each-seen-once-or-twice-on-recurrence-retain-the-log-before-retrying) contains every retained path. |
| Fiscal shard 2: first-hour PDF assertion failed before the deadline; cause unconfirmed. Passing focused runs do not diagnose it. | [43604245865](https://github.com/clintongormley/waitron/actions/runs/43604245865/job/132475525462); 2026-11-14. Earlier [43548232659](https://github.com/clintongormley/waitron/actions/runs/43548232659/job/132304715811). | Keep diagnostics on; retain assertion trace and unfinished-file/process report before retrying, then locate the pending operation. | `receipts/a1308-5h/ci-rebased-fiscal.log` in lane E; [timing and trace limits](#fiscal-shard-2-first-hour-pdf-failed-before-the-deadline). |
| Dashboard heading order remains unexplained after #350: `dashboard-app.a11y.test.ts` is a different rule with no colour evidence. | Run/job/date not recorded. | Retain the exact heading-order failure log before assigning a cause. | Retained-log path not recorded. |
| #414: shard exited 1 with every test passing. Vitest 4.1.11 / #437 closed that exit-1 path; why the reporting call went unanswered remains open. | PR #414; run/job/date not recorded. | Keep the next job log. Under 3.2.7 `onTaskUpdate` hit birpc’s 60-second default; on 4.1.11 an unanswered call instead waits for the 10-minute job cancellation. | Retained-log path not recorded; [CI guide](../developers/ci-and-gates.md), written up rather than fixed (owner, 2026-09-18). |
| Server shard 2 / #2664: two database-open hooks and a process case timed out on a hosted runner; the re-run passed without locating the wait. | [42690313010](https://github.com/clintongormley/waitron/actions/runs/42690313010); 2026-11-09, shard 2; job ID not recorded. | Keep the log and locate what the hooks were waiting on before changing a deadline. | `~/waitron-campaign-l/ci-logs/pr2664-run42690313010-test-server-2.log`; [Detail](#server-shard-2-stalled-once-on-a-hosted-runner-pr-2664-2026-11-09). |
| Server shard 19 / #3342: silent to the 10-minute job limit; jobs-logs API returned `BlobNotFound`. Earlier heads and the local shard passed; cause unknown. | [43721700167](https://github.com/clintongormley/waitron/actions/runs/43721700167/job/132835178034); 2026-11-15. | Read the diagnostic deadline's unfinished-file and process report if the test step hangs again; setup and runner loss remain outside it. Locate the wait before changing limits. | [Detail](#server-shard-2-stalled-once-on-a-hosted-runner-pr-2664-2026-11-09); no file progress survives from the original incident. |

## Fiscal shard 2: first-hour PDF failed before the deadline

[Run 43548232659, job 132304715811](https://github.com/clintongormley/waitron/actions/runs/43548232659/job/132304715811)
has no retained assertion trace. The PDF case passed five focused local runs unchanged.
`backup-verification-history.test.ts` took 323.1 s; `recovery-hour.browser.test.ts` was assigned
only 14.224 s before the 420 s shard deadline, so that report does not establish a recovery-hour hang.
Keep diagnostics on. On recurrence, retain the assertion trace and unfinished-file/process report
before retrying; locate the pending operation before changing test or product behaviour.
Recurrence on 14 November: [run 43604245865, job 132475525462](https://github.com/clintongormley/waitron/actions/runs/43604245865/job/132475525462)
failed the same first-hour key-only PDF case before the deadline; the deadline again prevented
Vitest's final assertion trace. The complete failed log and process report are retained in lane E's
`receipts/a1308-5h/ci-rebased-fiscal.log`. History verification passed in 311.4 s; recovery-reader
began 20.8 s before the deadline. The unchanged first-hour file passed all 142 cases locally.

## Bundle: Qualify CI's server routing and action setup

The [checked routing records](../developers/ci-and-gates.md#disposable-server-test-runners)
cover guest tools/history/API, real PR planner pickup, scheduled unavailable-label rescue,
one untouched-run overflow and a natural blind hosted choice. Fresh-capacity server/hosted
choices, including an idle-server decision followed by successful server jobs on 15 November,
are reconciled with their workflow commits. The natural agreeing-row inventory exception is
also qualified by run 43948927220 attempt 1: acceptance of the recorded empty rows and counts
1,1 was followed by a hosted choice, and all selected jobs and aggregate passed. Later idle snapshots did not
invalidate earlier busy-server choices. The bundle stays open; these records
supply no full-day queue or speed result. Keep the corrected v41 controller and the
[13 November measured-memory decision](#decisions-and-deliberate-limits).

- **Planner discovery shortfall: qualify live recovery.** Retain a natural Server health pass that logs `Planner discovery count shortfall`, then recovers an eligible PR on its recorded workflow/module commit, with run/attempt/job and runner identities. Fixture recovery from the captured count 2/row 1/empty-page shape does not close this. Standalone `check` now tolerates a short queued workflow list after one reread, while running and job lists stay strict. Its partial green answer cannot establish whole-queue health or recover omitted runs. Earlier runs [43828425789](https://github.com/clintongormley/waitron/actions/runs/43828425789) (3 of 4 rows) and [43858443488](https://github.com/clintongormley/waitron/actions/runs/43858443488) (1 of 2) refused short lists; their underlying API cause remains open. During #3470’s wait, passes [43820479461](https://github.com/clintongormley/waitron/actions/runs/43820479461) and [43821896202](https://github.com/clintongormley/waitron/actions/runs/43821896202) reported no stalled run without naming its old, unassigned, correctly labelled planner; the reason remains unknown. The queued-list capture in [43882357125](https://github.com/clintongormley/waitron/actions/runs/43882357125) returned 11 of 12 rows and omitted #3521; accepting those rows does not explain its unassigned wait. On recurrence retain the discovered run IDs and contemporaneous PR/job state. [Capture and limits](../developers/ci-and-gates.md#disposable-server-test-runners).

- **A1424 / A1440: remaining real-run qualification.** Each line names the evidence that would close that gap; do not drain other lanes or repeat the completed rescue drill.
  - Idle probe: one scheduled Server health run dispatches a probe during genuine idle capacity, followed by its first-attempt server pickup and successful aggregate; a manual probe or hosted retry cannot close it.
  - Browser guest/workload: one server-scoped PR finishes its selected server and browser families with runner identities, full Chromium/system-library and deadline logs, `/proc` and cache checks, and aggregate. Venue-service also needs its `/dev/shm` and `sudo dmesg` checks. Run 43742448917's till shard 2 passed, but its cancelled server shard and aggregate do not complete this proof. The earlier stream job 42506794616 proved its MTU 1500 and `/dev/shm` setup only.
  - Server coverage: one natural full main/nightly/release run selects server, completes its selected coverage merges and aggregate at the recorded head. Inspected nightly 43545365252 passed on hosted runners; 43667121845 also used hosted merges and failed overall.
  - Image guest: one separately cleared disposable-guest image-smoke run passes the Bluetooth check and full smoke. Retained runs 42550200310 and 42525659420 stop at `dbus_unreachable`; keep image smoke hosted meanwhile (watcher, 2026-11-09 08:20).
  - Per-job overflow: one untouched mixed-workload run demonstrates the remaining per-job behavior with controller source, run/attempt/job and runner identities; the 13 November no-op forward-move drill did not run product checks. Reverse movement was dropped by the owner.
  - Remaining workflows: retain a real selected run for each still-unqualified workflow with source, runner, selected checks and aggregate; a CI-only record cannot qualify other workflows.
  - Full-day capacity/queue target: one full-day ordinary-traffic measurement must account for waits and available capacity throughout; no single isolated CI run or episodic status sample can close it. A1461's smaller run sizes do not replace this measurement.
  - Historical planner 43278084012: recover that run's contemporaneous admission/recovery logs; a new run cannot establish why its untouched planner waited 32 minutes without running the ratio.

- **A935: setup action-download bound.** One separately cleared, selectively stalled action-transfer run on a single owned runner must retain the successful-download control, actual version/action/source/job limit, listener cancellation and worker-exit logs, with an independent safety stop and cleanup. Keep control traffic reachable. Fast refusal or manual cancellation does not qualify the job limit. The [experiment proposal](../superpowers/plans/2026-11-16-a935-action-download-experiment-proposal.md) is parked until a natural setup-download stall is captured (watcher, 16 November 14:56); build no guest setup hook or two-job lease reuse merely to stage it. [Source trace and limits](#the-runners-action-repository-download-at-job-setup-remains-unqualified-a935).

## Bundle: One small pull request for rule lines

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Decide whether browser tests stop replacing modules (A943 follow-up).**
  [Detail](ci.md#decide-whether-browser-tests-stop-replacing-modules-a943-follow-up).
- **`--no-verify`: the docs say "Claude never", the hook says "agents never"** — OWNER'S CALL.
  [Detail](ci.md#--no-verify-the-docs-say-claude-never-the-hook-says-agents-never).

## Bundle: apps/server's test speed: restart tests and recovery-key checks

2 entries, size L.

- **Find why each restart test in `apps/server/src/first-fiscal-hour.e2e.test.ts` and
  `first-fiscal-hour-boot.e2e.test.ts` boots the real entry point twice.** Left open by A938 (#1930).
  [Receipt](../developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration)
- **The server's test suite has more measured speed-ups left.** A1297 took the three largest;
  the remaining wider memo work stays open.
  [Detail](ci.md#server-test-time-levers-left-after-a1297).

## Bundle: Vitest settings: remaining measurements

2 entries, size M. The remaining work is:

- **Worker limits (A490):** compare each unqualified one-worker setting on a loaded runner; isolated package pairs do not recreate the reported condition.
- **Dependency optimizer:** qualify the remaining Vite 8 behavior; the setup control was inconclusive and dashboard, till and UI remain unmeasured.
  [Detail](dependencies.md#a-dependency-optimizer-receipt-taken-on-vite-6-was-not-re-measured).


## Decisions and deliberate limits

### Remaining fixed-secret setup: measured below the conversion threshold

Keep the remaining server setup unchanged after the 17 November 2026 measurement
(SERVER-FIXED-SECRET-HASHES). At `7493b0794d4fabc50f16f4a0010f2e27a2ec83db`,
`rg -l 'hashPin\(|hashPassword\(' apps/server -g '*.test.ts' -g '**/testing/**'`
found 146 candidate files. A Node preload forwarded to the real `scryptSync`, recording
repeated PIN/password inputs per file without writing secrets or salts. On macOS, Node
26.13.0, 110 selected files passed 4,027 tests. Repeated calls took 56.91 seconds,
about 0.76% of the duration table's 7,495 file-seconds, below the queued roughly 1% bar.
The other 36 files were left out for open-PR, fiscal/clock or sign-in/verification scope.
This is an optimistic local saving estimate: it includes repeated hashing outside setup;
it is not a measured CI or whole-shard improvement.

A temporary setup-only conversion of `payments-api.stuck.test.ts`, `receipt-print.test.ts`
and `till-sale-integrated.db.test.ts` reused the existing fixture helpers. With two workers,
alternating original and converted checkouts twice, the three files' summed collection-to-end
times were 52.1 / 35.6 seconds, then 51.0 / 27.4 seconds. All four runs passed the same
413 tests, with every assertion unchanged; recorded repeated hash calls fell from 1,066 to
zero in each converted run. All trial edits were restored. No CI timing run was made.

### Native stripping rejected for three server test children

On 16 November 2026, CHILD-LOADER tested one candidate on macOS with Node v26.13.0:
native type stripping plus a small synchronous resolver that retries missing `.js` imports
as `.ts`. A typed-fixture import failed with `ERR_MODULE_NOT_FOUND` under an empty preload
and passed with this resolver. A disposable checkout of
`c9e1c435d0108512a4750e676864f309bf49713f` then changed only the `tsx` preload argument
in the three files below. Existing module replacements and assertions stayed unchanged.

Each command exited 1, reporting one failed case. Each real child printed:

```text
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
```

| Test file under `apps/server/src/` | First refused source |
| --- | --- |
| `handover-activation-repair.test.ts` | `packages/payments-sumup/src/provider.ts:126`, `constructor(private readonly opts: SumUpCloudProviderOptions)` |
| `handover-stepdown.crash.test.ts` | `packages/credentials/src/backup-verification.ts:9`, `constructor(readonly status: Refusal)` |
| `hour-recovery-placement-1.test.ts` | `packages/credentials/src/backup-verification.ts:9`, `constructor(readonly status: Refusal)` |

Commands from the disposable checkout's root, after replacing each file's one `tsx` preload
with the scratch native resolver:

```sh
node scripts/run-with-deadline.mjs 240 --diagnostics -- pnpm --filter @waitron/server exec vitest run src/handover-activation-repair.test.ts -t 'M2 killed between the venue.db commit' --maxWorkers=1
node scripts/run-with-deadline.mjs 240 --diagnostics -- pnpm --filter @waitron/server exec vitest run src/handover-stepdown.crash.test.ts -t 'after the node transaction, before the answer' --maxWorkers=1
node scripts/run-with-deadline.mjs 240 --diagnostics -- pnpm --filter @waitron/server exec vitest run src/hour-recovery-placement-1.test.ts -t 'restarts publication after archive process death' --maxWorkers=1
```

The candidate was rejected before timing comparisons. There are no before/after medians or
speed-up claim; `hour-recovery-placement-2` was not run because compatibility failed first.
No loader, test edit or product change ships. The watcher cleared this rejection path at
20:39 on 16 November; Claude reviewed the plan, not a faster-loader result. Small logs,
commands, the scratch resolver and three-preload replacement diff are retained in Lane I's
`receipts/child-loader-20261116/`. This rejects native stripping for these paths; it does not
qualify another loader or settle other startup costs.


- **Browser-console forwarding is off in every browser package’s Vitest config** (owner, 16 November 2026, “Turn it off everywhere”, recorded by the watcher in Lane I’s `questions.md` at 02:25). Keep the Vite-level `server.forwardConsole: false` setting; its placement and A902’s receipt are in the [testing guide](../developers/testing-guide.md#vitest-hides-a-passing-tests-console-output-under-an-ai-agent).

### UI pointer command helpers stay outside the mutation score

On 15 November 2026 the owner chose “Leave them out”: UI's `vitest-park-pointer.ts`
and `vitest-pointer-gestures.ts` join the existing test-helper exclusions in
`packages/ui/stryker.config.json`. They provide Node-side browser test commands.
This changes only mutation selection; the coverage configuration and 90 aggregate
mutation floor stay unchanged.

### A1398-2: slow browser test files

**15 November 2026 qualification.** The watcher accepted root at 244 seconds and
light jobs at 242–244 seconds as “about four minutes” at 06:17, after removing the
checkout-time filter and the requirement for unrelated jobs to pass at 06:09.
Qualification checks each measured job's passing test inventory and coverage,
plus incident and download-error evidence. Checkout seconds remain part of
whole-job time. The watcher made these qualification decisions; the measurements
do not establish a speed gain.

The cleared full [run 43678677640](https://github.com/clintongormley/waitron/actions/runs/43678677640),
from `a88ac161049776bb27d9711ed202ff0f69de5522`, records root at 244 seconds
(196 files, 21,741 tests; statement/branch/function/line coverage
98.12/96.71/98.87/98.65), stream at 135 seconds (15 files, 93 tests), light-a
and light-b at 242 seconds each (16 and 17 package coverage summaries), and all
24 server shards at 132–235 seconds. Root's coverage step is 211 seconds;
light-a's and light-b's test steps are 214 and 217 seconds. These are whole-job
observations; file times overlap and do not explain the complete wall time.

The watcher had already accepted dashboard and till measurements on 14 November
at 06:51 and 09:44. This run's dashboard jobs take 188–250 seconds and till jobs
172–238 seconds. The 250-second dashboard shard remains visible in the record;
it is not rounded to 240. Setup's separate statement coverage failure belongs
to its repair and does not invalidate passing jobs' timings.

The [server coverage merge](https://github.com/clintongormley/waitron/actions/runs/43678677640/job/132710589600)
passed at 05:49:31 UTC: 1,413 files, 33,411 passing tests and one skip, with
statement/branch/function/line coverage of 98.26/96.13/98.61/98.95. That includes
all 24 server shards and the stream job. The six other coverage merges and shared
mutation summary also pass. The incident-history read found no overlapping
Actions, Git Operations, API Requests or Webhooks incident across the measured
run, and the log scan identified no download HTTP 5xx. In that run setup's
2,792 tests passed but its statement coverage was 97.95%, below 98%. With the
tests that the pull request "Cover the handover screen's paths #3219 left
untested" adds, setup's statement coverage measured 98.52% locally; the first
full main run after it lands is the check. This closes the watcher's remaining
A1398-2 qualification; it does not make the whole full run green.

Earlier cuts and their limits remain in their dated plans:
[dashboard packing](../superpowers/plans/2026-11-14-a1398-next-browser-cut.md),
[till task turns](../superpowers/plans/2026-11-14-a1398-till-task-waits.md),
[stream readiness polling](../superpowers/plans/2026-11-14-a1398-stream-clock-poll.md),
[root colour scan](../superpowers/plans/2026-11-14-a1398-root-colour-scan.md),
[table-write detection](../superpowers/plans/2026-11-14-a1398-table-write-regex.md)
and [history prefilter](../superpowers/plans/2026-11-14-a1398-history-scan.md).
The local history-prefilter timing target was missed; it is not a measured hosted
gain. The accent-precheck proposal was withdrawn and remains unbuilt. Do not add
another small cut without a measured whole-job benefit. The archiver's separate
observations follow below; A1027 still requires a captured stall.

### A1398-2 archiver evidence

The 34.972-second silent interval in [run 43034947887, till job 5](https://github.com/clintongormley/waitron/actions/runs/43034947887/job/130571604284)
starts at `2026-11-11T14:21:08.2987746Z`, when `cpu-features` prints its `ar crs`
command, and ends at `14:21:43.2702952Z`, when the same optional build prints
`COPY Release/cpu_features.a`. The log locates the interval inside that native
build; it has no process sample establishing what the archiver waited on.

[PR #2955](https://github.com/clintongormley/waitron/pull/2955) disabled the optional
`cpu-features` and `ssh2` builds. In retained hosted full run
[43572788079, attempt 2](https://github.com/clintongormley/waitron/actions/runs/43572788079/attempts/2),
all seven till install steps took four seconds at the API's one-second resolution.
Each install log reports both build scripts ignored and contains no native-build
output or `ar crs` command. The watcher accepted this run's till measurement on
14 November at 09:44: whole till jobs took 189–221 seconds, with 3–9-second
checkouts. The unrelated merge job's 14-second checkout was explicitly accepted
for that measurement.

You do not need another archiver change to remove this recorded build path. Its
historical wait cause remains unknown; these observations do not measure a
35-second saving attributable to the archiver alone or qualify every CI job.

- **A1473 point 4 and reverse movement were dropped by the owner on 13 November 2026.** Reopen only after a measured stall leaves a job waiting with free room for a reason other than a refusal or a recorded turn (watcher, 09:55).

- **Keep buildx for the existing image builds (13 November 2026).** Publication rebuilds from its local checking-build cache with SBOM and provenance; image smoke uses the same builder for loaded images. The [recorded action limits](../developers/ci-and-gates.md#cache-docker-and-codeql-steps-have-measured-limits) retain this reason. No builder-removal experiment was run.

- **A1454: retain measured-family memory admission (watcher, 2026-11-13 08:39).**
  The sixteen-identifier pool is the running setup. The bounded third watch reached fifteen
  live guests, eight on one host; ordinary PR runs [43383817678](https://github.com/clintongormley/waitron/actions/runs/43383817678)
  and [43383904860](https://github.com/clintongormley/waitron/actions/runs/43383904860) passed
  all 8 and 48 selected checks. No infrastructure failure or sampled memory kill was observed.
  The watcher accepted keeping it and closing A1454. Checkout maxima of 12/14 seconds make
  the timing comparison unqualified; no speed gain is claimed. Rollback applies to a failure
  outside a job's own steps, including a memory kill, or five minutes with admissible room and
  queued server work but no new admission. Read failed jobs' last test lines before deciding;
  a pull request's failing assertions, coverage or lint are not by themselves server failures
  (watcher, 13 November 07:43). The fresh-generation fallback retains six fixed guests per host.

- **CI-gate-skipped: trust an omitted record only for exact saved `skipped` (watcher, 2026-11-12 19:33).**
  A complete jobs inventory and the saved result together allow the omission; present records
  remain checked. The accepted limit and observed runs are in
  [the final gate's API check](../developers/ci-and-gates.md#the-ci-check-passes-only-when-every-needed-job-succeeded-or-was-skipped).

- **A1454: keep six CI slots per host (owner, 2026-11-11).**
  **Superseded on 12 November:** the owner renewed the full-day measurement, per-family
  sizes and memory-admission ask. The watcher cleared its sixteen-identifier first cut on
  13 November at 01:54, without a second live-free-memory gate. See Cloud’s
  [governing plan](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/plans/2026-11-13-a1454-memory-admission.md).
  The decision below records the declined fixed split; it does not govern the renewed work.
  The 11 November measurements show about 125 GiB per host. The simplest fixed split
  is two large and five small guests, seven jobs against six today, but large-job
  concurrency falls from six to two. The owner answered “Ok” to not building it
  (Lane I questions.md, watcher 19:07). No guest profiles or slot changes were built.


- **A1440: retain v40 without a new capacity gate (watcher, 2026-11-08 22:14).**
  The [routing comparison](../superpowers/plans/2026-11-08-a1440-capacity-routing.md) is an
  illustrative replay, not measured alternate outcomes. Its fit-only rules leave more modeled
  capacity idle; no snapshot-freshness limit was validated. Keep the deployed controller,
  advance A1454 and A1461, and report existing-record observations on 15 November. **2026-11-09:** the watcher
  dropped A1454 and retained six slots after its measurement-only cut; A1461 reduces run sizes. No new
  collector, workflow, reservation service or credential carrier is approved. **2026-11-09 10:01:**
  the owner approved the repository-only GitHub-first approximation in the existing router: no
  hosted queue and fewer than 20 running hosted jobs chooses GitHub; otherwise the server-health
  check applies. This supersedes parking that routing rule; v40 and six guest slots stay unchanged. **2026-11-09 12:05:**
  hosted routing additionally requires the selected initial job wave to fit the remaining room.
  Cloud PR #1115 publishes the matching 30-record reader in v41; six slots remain. **2026-11-09 17:19:**
  the owner replaced initial-wave fit with whole-run queue pressure; qualify the count variable and route before activation.
  **2026-11-10, A1470:** the owner chose “Unsure → GitHub (Recommended)”. New-run routing uses GitHub when inventory, capacity or its module cannot be read; normal ratios and server ties remain. Degraded reads may leave the server idle; retain the first natural blind decision’s source, route and runner results before claiming live qualification.
  **2026-11-15 15:55, watcher:** two agreeing queued CI-workflow row sets count as readable, including empty sets; both reads could miss the same run. The watcher has told the owner and will reverse this interpretation if they say so. Every other list stays strict; live qualification remains open.
  **2026-11-16 13:31, watcher:** planner candidate discovery accepts short workflow lists with its own diagnostic; complete job lists and final cancellation checks remain required. Other commands and routing keep their existing rules; live planner recovery remains unqualified.
  **2026-11-12 20:47, watcher:** after successful server-health and capacity checks, idle positive server capacity needs no hosted-count read: all hosted counts select server. Busy and zero-capacity paths retain their checks; the earlier planner diagnosis stays open under A1473.

- **A1459: measured shared startup, with child internals still unknown (2026-11-08).**

  The [coverage-on nightly](https://github.com/clintongormley/waitron/actions/runs/42437905513) saved 1,275 files and 11,903.6 summed file-seconds, split into 27.0% import/collection, 4.3% shared hooks and residual execution, 68.1% case intervals including per-case hooks and 0.6% runner/setup work; the [single coverage-off probe](https://github.com/clintongormley/waitron/actions/runs/42517343026) below passed all 1,280 captured files on a newer revision, so these totals are separate workloads rather than a before/after comparison.

  The table ranks the twenty files with the most measured shared-helper time, in seconds, with nested intervals removed from starred columns in migration, watchdog, database-setup, boot, listener order; its total also includes 70.8 seconds of runner preparation, environment and setup-file work omitted from those columns, and both runs passed the incident-history, setup-download and checkout checks, with maximum checkouts of 10 and 9 seconds respectively.

  The factory at `packages/store/src/venue-liveness.ts:223` creates a watchdog thread through `startWatchdog`, `beginHolding`, `lockVenueDirectory` and `openVenueStore`, gated by exclusive/monitored opens and whether a watchdog already exists; A1453's older capture records 1,818 factory calls in 921 files and 489 child-process API calls in 76 files, which are calls rather than successful starts, and `?` means that capture provides no call record for the row.

  Known helper waits total 495.2 seconds, 4.91% of this probe's file-time, comprising 628 `startServer` settlements, 99 listener waits, 950 database-setup hooks, 20,451 migration calls and 1,701 watchdog-creation spans; the remaining 6,408.5 execution seconds still include test work, child startup, teardown and unmeasured paths, while bundle loading, child readiness, asynchronous watchdog bootstrap and instrumentation overhead remain unknown.

  No compatible group sharing a server was demonstrated, so there is no numeric warm-server estimate: `apps/server/vitest.config.ts` retains Vitest's measured `isolate: true` default and the 27.0% nightly import share, or 30.9% in the probe, is not counted as saved; per-file timings, mock/fake-clock/seeding flags, thirteen source-reference-without-span flags, qualification logs and the executable controls are retained in `~/waitron-campaign-d/receipts/a1459-20261108/` alongside the [approved plan](../superpowers/plans/2026-11-08-a1459-process-startup-measurement.md).

  | File | File seconds | Import | DB setup* | Migration* | Server boot* | Listen* | Watchdog* | Remaining execution | Past child / worker calls |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
  | **Total** | 10094.7 | 3120.2 | 161.4 | 118.2 | 212.7 | 0.2 | 2.79 | 6408.5 | separate capture |
  | `src/boot.test.ts` | 35.0 | 7.6 | 0.0 | 0.9 | 16.6 | 0.0 | 0.00 | 9.8 | ? / 2 |
  | `src/boot.place-copy.test.ts` | 162.5 | 12.4 | 0.1 | 0.2 | 14.7 | 0.0 | 0.00 | 135.0 | 14 / 1 |
  | `src/boot.failed-start.test.ts` | 20.7 | 6.0 | 0.0 | 0.4 | 11.9 | 0.0 | 0.08 | 2.3 | ? / 201 |
  | `src/boot.setup-routes.test.ts` | 41.1 | 10.6 | 0.0 | 2.7 | 8.9 | 0.0 | 0.01 | 18.8 | 1 / 2 |
  | `src/boot.invoice-delivery.test.ts` | 21.1 | 4.1 | 0.1 | 0.2 | 10.3 | 0.0 | 0.00 | 6.4 | ? / 1 |
  | `src/first-fiscal-setup.e2e.test.ts` | 39.6 | 13.9 | 0.1 | 2.2 | 5.4 | 0.0 | 0.00 | 17.8 | ? / 1 |
  | `src/boot.restricted.test.ts` | 18.5 | 4.0 | 0.1 | 0.2 | 7.4 | 0.0 | 0.00 | 6.8 | ? / 2 |
  | `src/boot.disk-full-wiring.test.ts` | 13.8 | 4.4 | 0.1 | 0.2 | 6.1 | 0.0 | 0.00 | 2.9 | ? / 1 |
  | `src/boot.backup-network.test.ts` | 12.9 | 3.2 | 0.7 | 0.1 | 5.4 | 0.0 | 0.00 | 3.5 | ? / 1 |
  | `src/boot.restore.test.ts` | 17.6 | 7.7 | 0.0 | 1.2 | 3.5 | 0.0 | 0.00 | 5.2 | ? / 2 |
  | `src/boot.certificate-diagnosis.test.ts` | 10.7 | 4.1 | 0.1 | 0.2 | 4.4 | 0.0 | 0.00 | 2.0 | ? / 1 |
  | `src/boot.handover-chart-moved-on.test.ts` | 16.9 | 4.6 | 0.1 | 0.3 | 3.7 | 0.0 | 0.00 | 8.0 | ? / 1 |
  | `src/boot.attendance.test.ts` | 44.8 | 7.9 | 0.1 | 0.2 | 3.8 | 0.0 | 0.01 | 32.7 | ? / 2 |
  | `src/handover-controlled.e2e.test.ts` | 26.6 | 7.5 | 0.0 | 0.2 | 3.7 | 0.0 | 0.00 | 15.1 | ? / 1 |
  | `src/boot.attendance-export.test.ts` | 10.7 | 3.8 | 0.1 | 0.3 | 3.4 | 0.0 | 0.00 | 2.9 | ? / 3 |
  | `src/boot.node-configuration.test.ts` | 8.7 | 3.0 | 0.0 | 0.1 | 3.7 | 0.0 | 0.00 | 1.8 | ? / 1 |
  | `src/boot.box-emails.test.ts` | 8.2 | 2.4 | 0.0 | 0.1 | 3.7 | 0.0 | 0.00 | 1.9 | ? / 1 |
  | `src/boot.venue-details.test.ts` | 11.8 | 3.0 | 0.0 | 0.1 | 3.5 | 0.0 | 0.00 | 5.1 | ? / 1 |
  | `src/boot.hours.test.ts` | 10.0 | 3.6 | 0.1 | 0.2 | 3.3 | 0.0 | 0.00 | 2.7 | ? / 2 |
  | `src/boot.zone-admission.test.ts` | 10.4 | 2.7 | 0.0 | 0.1 | 3.4 | 0.0 | 0.00 | 4.1 | ? / 1 |

- **A1446 closed without a production cache (watcher, 2026-11-08).** The baseline and cold-cache runs each passed 31,487 server tests across 24 shards. The experimental cache occupied 263,556,548 stored bytes. A deliberately wrong sender name failed six existing local tests; restoring it passed all 13. The hosted changed-source control and restored warm run did not complete before the 19:30 stop, so warm savings and hosted invalidation remain unverified. Disposable PR #2613 closed without merging. Keep the cache disabled; [the dated result](../superpowers/plans/2026-11-08-a1446-server-module-cache.md#experiment-disposition-8-november-2026) records the runs and measurement limits.

- **A1452, owner 2026-11-08:** ordinary main pushes keep quick checks and skip package tests/shared mutation in `ci.yml`. PR selection and full nightly/manual/release testing remain. UI registry publication and deploy-selected image smoke keep their checks. BEHIND merges retain their existing rule; package-level failures caused only by combining branches wait for the next full run. Watcher approval and owner risk acceptance: Lane F, 17:48, confirming the owner’s 17:35 decision.

- **A1453 — drop this measured selector and remembered-result prototype (2026-11-08).**
  The initial 82.17% retention figure used a conservative static scan for worker paths.
  Direct child-process API records cover 12,452.6 of 78,421.8 qualified scoped file-seconds (15.88%).
  Positive V8 counts also show execution of the one-line worker factory in files accounting for
  61,871.0 seconds (78.90%); its body is `new Worker(source, options)` at the captured revision's
  `packages/store/src/venue-liveness.ts:223`. Their union is 64,135.2 seconds (81.78%). These are
  calls, not proof that every process started successfully or coverage of the worker body.

  **This sample does not support tens of times fewer test minutes.** Keeping that union, as the
  approved plan requires, caps savings at 18.22% even if every other file is free, below the 30% bar.
  Keeping only the directly recorded child-process files still leaves 15.88% of the file-time;
  a tenfold cut would need 10% or less. The original rule also retains 3.7 static-only seconds and
  297 seconds with no baseline map, giving its 17.83% ceiling. Keep package scoping; this does not
  establish a limit on every possible cache, another workload or the watcher's warm-runner proposal.

  The frozen sample ends at PR #2611, merged at 17:54 CET on 8 November, and contains 40 PRs.
  Ten scoped rows qualify: six ran measured tests and four ran none. Qualification checks incident history, download 5xx
  and checkout under about ten seconds. A separate coverage-enabled row has 2,517.6 file-seconds;
  other rows remain in the receipt with their disqualifying evidence. File-time sums concurrent
  file elapsed times: it is not runner minutes or the time a person waits.

  | Qualified scoped sample | Own-package fallbacks | Stricter dependent-package fallbacks |
  | --- | ---: | ---: |
  | Selection saving | 4.11% | 2.43% |
  | Additional conservative remembered passes | 0 | 0 |
  | Combined saving: ceiling, not verified safe | 5.36% | 5.36% |

  These are gross estimates before map download, matching and installation costs. No qualified
  whole job becomes empty: zero whole-job minutes avoided; partial-job wall-time savings are unmeasured.

  The ceiling adds only 1.25 percentage points over the own-package result (1.30% of its remaining work). The extra ceiling permits an old executed-function fingerprint to bypass
  a fallback. Each extra reuse has a risk line in the receipt: changed code the old map never ran,
  or an unrecorded input, can invalidate that result. Its key includes the whole test, recorded
  function bodies, their files' top-level code, helpers and configuration/runtime dependency
  identity. The retained history yields 2,981 ceiling keys, modelled as 539,561 serialized bytes. No production selector, cache or recurring workflow was installed.

  All 2,537 expected files have one record; 2,194 remain gap-marked, including 1,177 unreadable source-map paths. Maps are captured before Vitest merges coverage, with one test path per record;
  Node and concurrent Chromium controls distinguish called functions from merely imported ones.
  Worker exclusions come from a static scan of mapped source files, not proof each test starts a worker.
  The historical map base is `147914ca764a66a6dfc7fbe8500ea66c53763100`. Raw maps occupy 213.4 MB; hosted artifacts 30.7 MB. The 36 successful jobs took 150.25 summed job-minutes, including 119.50 capture-step minutes; conversion timers sum to 51.28 minutes within those steps.
  Rebuild costs are observed instrumented jobs, not measured savings or an incremental nightly cost.
  All 36 had no relevant incident or setup/download 5xx and checkout at most 10 seconds.
  Hosted receipts: [24 server jobs](https://github.com/clintongormley/waitron/actions/runs/42506976544)
  and [12 browser jobs](https://github.com/clintongormley/waitron/actions/runs/42510919846).

  All eleven observed failed PR file/head pairs and one main pair remain selected by the gap rule; none is reused. Six predate the map. The audit retains one unavailable attempt-metadata response and one missing
  failed-job log. Earlier-pass history requested 202 PR/main attempts; 42 archives were unavailable,
  supplemented where exact job logs survived. Missing history limits the ceiling; retaining those
  observed files does not prove safety. Other packages and required checks stay unchanged.

  Receipts: `~/waitron-campaign-d/receipts/a1453-20261108/measurement-results.md`, with all 40
  per-PR rows, failure heads, fallback reasons, risk lines, map/store sizes and commands.
  The [approved measurement plan](../superpowers/plans/2026-11-08-a1453-executed-test-measurement.md)
  records the scope; its prototype and temporary hosted workflow are not part of the product.

  **A1460 follow-up, 2026-11-08: exempt the fixed watchdog, retain child processes.**

  Source check at capture revision `147914ca`: `startWatchdog` passes the fixed `WATCHDOG_SOURCE` string to `new Worker` with `eval: true`, while its shared buffer, timing values and settings are read as data, with no data-derived code-loading path in that string (`packages/store/src/venue-liveness.ts:114`, `:223` and `:231`).

  Changing only that retention rule releases 866 watchdog-only gaps; every mapped watchdog caller is explicitly selected when `venue-liveness.ts` changes, other worker sources and child-process calls retain their fallbacks, all 39,769 stored function hashes match the current parser, and the unchanged-rule control reproduces all 59,206 historical file selections before this adjustment.

  Across the forty PRs below, five ran no measured files and median selected file-time is 11,395.4 seconds with a 0–17,179.7 spread; the thirty-five nonempty rows have median 98.94% selected and a 48.80–100% spread, but unqualified rows are diagnostic only and the ten qualified scoped rows, six nonempty, give 16.73% gross selection savings against the original 4.11%, or 8.91% under the stricter dependent-package fallback.

  In that qualified scoped sample, child-call files still force 12,452.6 of 78,421.8 file-seconds (15.88%), stale maps retain 41,359.4 and remaining attribution gaps retain 23,740.2; all twelve observed failed file/head pairs remain selected, including the one on main, while no sampled PR changes `venue-liveness.ts`, so its explicit invalidation rule is checked by a synthetic control and a deletion that makes that control fail.

  Keep the measured selector stopped under the original 30% bar: this replay reaches neither that bar nor a tens-fold reduction, measures selection rather than remembered passes or job-time savings, and adds no CI run, product selector or recurring workflow; all forty rows, the twelve failure heads, three passing controls and two failed deletion controls are retained in `~/waitron-campaign-d/receipts/a1460-20261108/`.

  | PR | Timing basis | All file-seconds | Original selected | New selected | Stricter selected | Child-call files |
  | --- | --- | ---: | ---: | ---: | ---: | ---: |
  | #2611 | qualified scoped | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2610 | qualified scoped | 11673.5 | 11673.5 | 11673.5 | 11673.5 | 1921.6 |
  | #2609 | unqualified | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2607 | unqualified | 10553.3 | 10553.3 | 10553.3 | 10553.3 | 1843.5 |
  | #2605 | unqualified | 10616.9 | 10478.4 | 10477.3 | 10616.9 | 1640.3 |
  | #2598 | unqualified | 17179.7 | 17179.7 | 17179.7 | 17179.7 | 2147.4 |
  | #2596 | unqualified | 13752.5 | 13752.5 | 13752.5 | 13752.5 | 2148.0 |
  | #2595 | unqualified | 16660.1 | 16507.8 | 16506.9 | 16660.1 | 2140.8 |
  | #2593 | unqualified | 16805.8 | 16805.8 | 16805.8 | 16805.8 | 2242.3 |
  | #2591 | unqualified | 12032.9 | 12032.9 | 12032.9 | 12032.9 | 2249.8 |
  | #2590 | unqualified | 14132.0 | 14132.0 | 14132.0 | 14132.0 | 2219.2 |
  | #2589 | unqualified | 14134.9 | 13986.0 | 13985.3 | 13985.3 | 2153.5 |
  | #2588 | unqualified | 14755.9 | 14595.9 | 14594.9 | 14755.9 | 2332.7 |
  | #2587 | unqualified | 11770.3 | 11770.3 | 11770.3 | 11770.3 | 2141.3 |
  | #2586 | unqualified | 11893.6 | 11215.0 | 11193.1 | 11193.1 | 2220.5 |
  | #2585 | qualified scoped | 10348.6 | 9767.9 | 9747.1 | 9747.1 | 1883.7 |
  | #2583 | unqualified | 11613.8 | 11613.8 | 11613.8 | 11613.8 | 2063.2 |
  | #2582 | qualified scoped | 11383.5 | 10743.3 | 8273.2 | 8273.2 | 2074.8 |
  | #2581 | qualified scoped | 14945.9 | 14258.9 | 11669.8 | 11669.8 | 2367.7 |
  | #2580 | qualified scoped | 16750.9 | 16080.2 | 13579.1 | 16750.9 | 2151.9 |
  | #2579 | unqualified | 10322.8 | 10322.8 | 10322.8 | 10322.8 | 1962.4 |
  | #2578 | unqualified | 16356.4 | 16356.4 | 16356.4 | 16356.4 | 2197.7 |
  | #2577 | qualified scoped | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2576 | unqualified | 16655.0 | 15963.5 | 12634.2 | 12634.2 | 2142.9 |
  | #2575 | qualified scoped | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2574 | unqualified | 10901.0 | 10308.1 | 8049.6 | 10901.0 | 2040.2 |
  | #2573 | unqualified | 12800.7 | 12800.7 | 12800.7 | 12800.7 | 1957.7 |
  | #2572 | unqualified | 10586.8 | 9901.2 | 6854.2 | 6854.2 | 1940.1 |
  | #2571 | qualified scoped | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2569 | unqualified | 11319.8 | 10622.4 | 7472.8 | 7472.8 | 2062.0 |
  | #2568 | unqualified | 12278.8 | 11244.4 | 7843.2 | 7843.2 | 2022.6 |
  | #2567 | unqualified | 15096.6 | 14062.7 | 10669.2 | 15096.6 | 2079.8 |
  | #2566 | unqualified | 19391.6 | 18325.0 | 9463.4 | 19391.6 | 2354.6 |
  | #2565 | unqualified | 12597.7 | 11924.3 | 9065.6 | 12597.7 | 1855.2 |
  | #2561 | qualified coverage | 2517.6 | 2517.6 | 2517.6 | 2517.6 | 0.0 |
  | #2558 | unqualified | 17171.8 | 17171.8 | 17171.8 | 17171.8 | 2153.0 |
  | #2557 | unqualified | 11597.6 | 11597.6 | 11597.6 | 11597.6 | 2114.0 |
  | #2545 | unqualified | 11788.3 | 11788.3 | 11788.3 | 11788.3 | 2228.0 |
  | #2542 | unqualified | 16259.0 | 15316.9 | 11672.0 | 16259.0 | 2325.1 |
  | #2531 | qualified scoped | 13319.4 | 12678.5 | 10358.8 | 13319.4 | 2052.9 |

- **A1448 — keep plain typechecks (watcher, 2026-11-08).** Do not adopt TypeScript 7.0.2’s incremental build information: in the retained reproduction, renaming `WtModal.heading` in `packages/ui/src/components/wt-dialog.ts` left two warm dashboard checks passing, while plain `tsc --noEmit` reported 119 errors. The affected callers receive the component type through the global `HTMLElementTagNameMap`; imported-dependency controls did catch errors and did not expose this case. The watcher closed the item and kept the implementation private. Reproduction and results: `~/waitron-campaign-k/receipts/a1448-20261108/reproduce-global-error.py` and `global-error-results.json`.

- **A1449, owner and watcher 2026-11-08:** the pre-push hook keeps sign-off, frozen install, formatting, lint and scoped typechecks. Root tests and coverage run in CI. Known package, machinery and documentation scopes check changed files with content caches; global or unknown scopes retain full format/lint scans.

- **An older PR head may lack a newer workflow's browser smoke script (watcher, 2026-11-08 04:18, A1402).** Keep checking out the PR head. When `apps/setup/test/bundle-smoke.mjs` is absent, skip only that browser check with a notice; builds and other smoke checks stay required. An existing script's failure still fails the job. [Mechanism and test](../developers/ci-and-gates.md#built-applications-in-bundle-smoke).

- **A1427 — keep package scoping; stop related-file selection (2026-11-07).** The corrected 40-PR replay narrowed five server runs to 1,135 of 1,273 files, retained 26 full runs and skipped nine. Its duration-table estimate was about 241 test-job seconds saved at four workers, against 698 local selection seconds plus 24 installs at 5.2 seconds each. These are estimates and local timings, not observed hosted savings. The watcher stopped PR2 at 22:49; keep the prototype and receipts unpublished and add no further selection machinery. Keep PR2557's package-scoped tests and nightly/manual full coverage.

  **A1442 measurement (2026-11-08):** Ten recent successful pull-request runs, each on its first attempt, had 150 test jobs: 144 server shards with 51–54 files each and six stream jobs with 13 each. Four runs started no package-test job; none of the 150 jobs ran zero to ten files. One job lacked API step timings, but its log reported 53 files. Only one test-bearing run met the checkout-time check: [42460639755](https://github.com/clintongormley/waitron/actions/runs/42460639755/attempts/1) spent 15.22 job-minutes before test steps and 45.75 in them. The watcher closed A1442 as measurement-only; keep package selection and the related-file prototype stopped.

- **Investigate CI failures before retrying (owner, 2026-10-31, A1243).** Follow the
  [CI-failure rule](../developers/ci-and-gates.md#what-to-do-when-ci-fails). Record a recurring
  unrelated failure against its root-cause fix before obtaining a clean run for unrelated work;
  a passing re-run is never the repair.

- **The IPP polling-clock fixture observes server connections, not the next agent pause (A1251,
  #2092).** Keep the exact 295 ms first-query assertion. In disposable probes, adding one
  `setImmediate` turn after the agent reads a job reply made both cases report 300 ms; five turns
  made their real-time wait expire. Delaying every server reply by 4 ms passed both cases.
  These probes changed the poller; they do not establish the cause of the historical CI failure.
  If you add a wait to that continuation, coordinate the fixture with it rather than widening
  the boundary assertion.

- **The floor suites' fixed till-API clock keeps the system clock's time-zone offset (A1117,
  #2100).** `{ ...v.clock, now: () => ({ ...v.clock.now(), instant: NOW }) }` changes only the
  instant, so on the review machine it reported an offset of 60 minutes where Madrid on 10 October
  is 120. The floor code these suites reach reads the instant only, and none of them writes a fiscal
  record through the API; `floor-today-mark-moved` and `floor-catch-up` built their clocks the same
  way before. If one of these suites starts recording a sale through the API, give its clock the
  offset of its fixed instant.

- **Upgrade-test work budget follows the migration count (A489, 2026-10-11) and counts the walk's
  own processor time (A751, 2026-10-16).** The captured 110.242-second walk exceeded the old fixed
  deadline near its final step. Keep the workload budget and remeasure it when a new reset changes
  the cost of rebuilding the baseline. A walk with no phase start or finish for 120 s fails;
  Vitest's 1,800 s bound is a backstop above CI's eight-minute `root-guards` limit.
  [Receipt](../developers/ci-and-gates.md#the-upgrade-deadline-grows-with-the-walk),
  [processor time](../developers/ci-and-gates.md#the-upgrade-budget-counts-the-walks-own-processor-time).

- **Job-sharding levers:** server, dashboard and till use measured-duration packing
  ([tables and refresh](../developers/ci-and-gates.md#package-duration-tables)); bump `shard: [1..N]` and the denominator
  together with N at or below the file count; rebalance `LIGHT_A/B_PACKAGES` when one light shard
  dominates. db, ui-core and ui mutation shards use separate cost tables; follow the
  [refresh recipes](../developers/ci-and-gates.md#dbs-mutation-shards-are-packed-by-estimated-cost),
  keeping ui-core's and ui's recorded-duration recipes separate from the db-calibrated generator.
- **The package suites' databases stay on the runner's disk, except in `test-venue-service` and
  `test-server-stream`.** With
  `TMPDIR=/dev/shm` on every database test job (A441, #1477: run 37945937673 against main run
  37938947421, one run each), no job's time moved consistently: the server shards took 219, 330 and
  424 s against 297, 273 and 438 s, and `apps/server/src/bill-payments.test.ts` 175.8 s against
  174.6 s. The root suites were not measured. The exceptions: `test-server-stream`'s step sets
  `TMPDIR=/dev/shm` (`docs/developers/testing-guide.md`, "In CI their temporary files are in
  memory"), and so does `test-venue-service`'s since A500 (2026-10-11), after main run 38142687186's
  shard 4 hit its 10-minute limit on a slow runner.
  [Receipt](../developers/ci-and-gates.md#the-venue-service-shards-keep-their-test-databases-in-memory).

- **`packages/db`'s mutation gate runs only overnight, and that lag is accepted** (owner,
  2026-10-17). The gate lives in `.github/workflows/mutation.yml`, which runs nightly or by hand,
  so a pull request that thins a `packages/db` test merges green and the score drops the next
  night. No cheaper per-pull-request signal is wanted; `ui` and `ui-core` work the same way, and
  [ci-and-gates.md](../developers/ci-and-gates.md#mutation-floors-and-where-each-one-actually-bites) says
  so where a reader meets the gate.

**The development stack:**

- **A stale dev database is only reported AFTER the boot dies, never before it** (#343). A pre-flight
  check was offered and deliberately not built (owner chose the message and the documentation
  instead, 2026-09-13): compare each set's applied rows against its journal entry count
  (`packages/migrations/migrations.manifest.json` gives the set-to-table mapping) and warn before
  launching. Worth doing only if the after-the-fact line turns out not to be enough.
- **The hint cannot fire for an ahead-of-image database** (`provisioning.database_ahead`), by
  design: its operator text never suggests wiping — the remedy there is restore or reinstall (owner
  decision 2026-09-10).

**House rules and their guards:**

- **`CLAUDE.md` stays contained through regular housekeeping — it is not gated** (owner, 2026-09-14
  and 2026-10-07). #1337 (2026-10-07) moved the receipts into the `docs/developers/` topic files and
  took it from about 102 KB to about 71 KB. Add rules freely; prune when touching an entry, and sweep
  when the file has grown noticeably, as a loose guide past about 71 KB, per `CLAUDE.md` §7. The campaign watcher checks it on
  its 3-hourly evaluation. A housekeeping check, never a blocker. Receipt excerpts and the pointer guard's limits are retained in the
  [developer topics](../developers/writing-claims.md#root-instruction-receipts-retained-on-2026-10-14).
- **The pointers guard is deliberately narrower than "every pointer"** (#337): it does not check a
  root-level filename such as `eslint.config.js`, nor a bare directory. `CLAUDE.md` §7 says so;
  widen the guard if that gap ever costs something.


## Menu prices' narrow-layout CI failure still needs a cause (A613)

Main run [38505417966](https://github.com/clintongormley/waitron/actions/runs/38505417966/job/115661820912)
failed the cleared-price range case in `apps/dashboard/src/widgets/menu-prices-table.test.ts`:
its 320 px table did not acquire `narrow` during the existing wait. The cause remains unverified.

The phone-width helper now attaches a geometry and font snapshot to the original failed
assertion, without changing its check or wait. Next: use that snapshot and
the existing failure screenshot to distinguish a wide scrolling box, delayed layout and missing
resize delivery before changing the screen or its test.

## Explain the two older silent pnpm setup stalls

Reproduce the two earlier silent setup failures before assigning their cause. Main run
[40644939856](https://github.com/clintongormley/waitron/actions/runs/40644939856), job
`122671628160`, stayed active through cancellation and its final job log was unavailable.
Run [42034714487](https://github.com/clintongormley/waitron/actions/runs/42034714487), job
`127269970638`, timed out in setup with no script output and no tests run. Both fresh-runner
samples passed without diagnosing the first attempt. The later named Node-read timeouts do not
establish what ran during those silent waits, and removing that initial Node dependency proves
nothing about their causes.

Retain each recurrence's last `start` and `end` lines and reproduce the named operation before
changing its limits. Prefix cleanup and writing `GITHUB_PATH` remain outside the command timeouts;
a cleanup start without an end needs evidence from that operation, not an npm retry. The legacy
attempt summary still names npm after a version failure; use the preceding named-phase status
and mismatch reports to identify the failed operation. Changing that retained summary needs
approval for its existing exact-output checks. The read, install and version limits are in
[the CI guide](../developers/ci-and-gates.md#every-pnpm-setup-is-bounded).

## The step-watch guard received an undefined held-thread result

On 2026-10-16, A737 Part 2's normal push at `877d14981`, rebased onto A751's
`39d07827e`, ran `pnpm vitest run --coverage`. The failing case was
`scripts/step-watch.test.mjs`'s "reports the phase a synchronous call holds the thread in,
from another thread, counting from the last phase event". At line 557,
`expect(seenWhileHeld).toMatch(...)` received undefined. Its callback assigns that value
inside the held database call; the retained output does not explain why it was absent.

Raw logs remain in Lane F's local
`receipts/a737-after-a751/push.log` and `step-watch-focused.log`.

2026-10-17: A770 landed in [#1816](https://github.com/clintongormley/waitron/pull/1816),
`d2f9bc3de08c2a3c0d2284a03efcc342319809a1`. Its controlled 200 ms thread pause reproduced this
failure, and the revised test limits passed the same pause. The original run's delay remains
unobserved. See [the retained experiment](../developers/ci-and-gates.md#the-upgrade-test-names-the-phase-it-stalled-in).

## The step-watch case's A544 pre-push failure is fixed at a likely cause, not a confirmed one

The failure's message was not kept. A worker that starts late could report
`Stalled between phases` with no finished phases although phases had already been sent, which
the fix closes
([receipt](../developers/ci-and-gates.md#the-upgrade-test-names-the-phase-it-stalled-in)); a worker
that writes nothing within the held case's 5 s wait, so that the case reads an empty report, was
not reproduced and is unchanged. Next: if "reports the phase a synchronous call holds the thread in…"
fails again, keep its message and compare it with those two shapes.

On 2026-10-16 (A770) it failed in lane F's pre-push run with
`.toMatch() expects to receive a string, but got undefined`, neither shape: the held call never
ran. A pause that fails the body first on A751's 100 ms no-progress limit reproduces that error,
and A770 widened the limit
([receipt](../developers/ci-and-gates.md#the-upgrade-test-names-the-phase-it-stalled-in)); neither
shape above has yet been seen in a real run.

## The upgrade walk's historical runtime variation remains unexplained after reducing setup work (A736, #1788)

- [#1788](https://github.com/clintongormley/waitron/pull/1788): the captured 165,500/171,000 ms overruns have not been reproduced on the quieter host.
  On recurrence, retain the phase report and host state before retrying; compare repeated samples
  before assigning the variation to CPU scheduling or storage. Since A751 the budget counts the
  walk's own processor time, so a recurrence fails the test when that time passes the budget or no
  phase starts or finishes for 120 s (or, starved further, at CI's eight-minute `root-guards` limit
  with no report). Keep the failure report: a work-budget failure names the processor time used, a
  no-progress failure the wall time.
  [Measurement](../developers/ci-and-gates.md#reducing-repeated-upgrade-test-setup-work-a736)

## The runner's action-repository download at job setup remains unqualified (A935)

Step limits for cache, Docker and CodeQL do not qualify the earlier “Download action
repository” phase. The inspected 12 and 15 November hosted and disposable job logs report
runner **2.338.2**. The source trace below narrows the question; it is not a live setup-stall
or job-timeout measurement. `ActionManager.cs` is byte-identical in the downloaded
v2.337.0 and v2.338.2 sources, but this does not establish either version's runtime bound.

| Source, read 15 November 2026 | Source words | What to test |
| --- | --- | --- |
| [JobExtension v2.338.2](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Worker/JobExtension.cs#L63-L77) and [preparation](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Worker/JobExtension.cs#L298-L301) | `context.CancelToken()`; `PrepareActionsAsync(context, message.Steps)` | Setup receives root cancellation; measure its arrival during a stalled transfer. |
| [ActionManager v2.338.2](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Worker/ActionManager.cs#L1644-L1684) | `retryCount < 3`; `20 * 60`; `httpClient.GetAsync(downloadUrl)` | The linked token reaches copy/flush, but is not an argument to the initial GET. Do not describe the 20-minute token as a measured transfer bound. |
| [JobDispatcher v2.338.2](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Listener/JobDispatcher.cs#L626-L690) and [Worker](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Worker/Worker.cs#L102-L125) | `MessageType.CancelRequest`; `workerProcessCancelTokenSource.Cancel()` | The listener has a cancellation/kill path; measure whether the job limit invokes it during setup and when the worker exits. |

Read-only inspection of Cloud `6cfbabb374f8cc94dc02188f36f63824526ad9cb`'s
`deploy/disposable-tests/{guest-exec.py,operations.py,session.py,host.py,runner-tools.sh}`
found command/deadline and VM-network controls, not a ready selective action-transfer stall
entry point. No live guest/tool check or fault injection ran. A guest-local interception
mechanism would need its own concrete clearance; no source change or new fault tool is
cleared by this audit. The [bundle](#bundle-qualify-cis-server-routing-and-action-setup)
keeps the required real-run control and cleanup evidence open.

## Whether the 2026-10-20 checkout stalls were a GitHub-side incident was not checked (A935)

In which phase they stalled is unknown: the action passes no `--progress`, so its log is
silent while it waits. On a recurrence, read the bounded checkout's log: a low-speed failure
(`Operation too slow`) means a transfer stall; a step timeout says only that the attempt ran
out of time, not in which phase.

On 27 October, [main run 40555390596](https://github.com/clintongormley/waitron/actions/runs/40555390596)
failed in bookings job `122371062426`. Both checkout attempts logged a running `git fetch`
then "has timed out after 2 minutes", before dependency installation or tests. The log gives
no transfer progress or lower-level network error. The cause of that wait remains unverified;
retain this failure when comparing later runs rather than treating a fresh pass as its diagnosis.

On 28 October, [PR #2202's run 40729880084](https://github.com/clintongormley/waitron/actions/runs/40729880084/job/122963741771)
hit the same two checkout timeouts in `test-server (20)`. Both logs end at `git fetch`,
with no transfer progress or lower-level network error; dependency installation and tests
never ran in that job. The cause remains unverified.

The A1178 diagnosis compared three morning runs with first-checkout medians of 11 to
12.5 seconds and no retries against later run `40723334721`, with a 42.5-second median
and eight retries. Fresh local full-history pack controls grew by 1.49%; they did not reproduce
the hosted timeout. CI's checkout attempts emit Git Trace2 JSON events,
and successful checkouts print stored-pack byte counts. See the
[measured diagnosis and its limits](../developers/ci-and-gates.md#checkout-stage-diagnostics-28-october-2026-a1178).
In full comparison run `40765243305`, both a full-history and a shallow first attempt reached
`fetch_refs` with a started `index-pack` child and no matching completion before timeout. This
does not distinguish waiting for incoming data from local indexing. Capture more evidence at
that boundary before attributing the wait to GitHub, the network or local indexing.
Suite jobs use depth one, with full history retained for change classification and sign-off.
Since A1316 the full-history checkout skips old file contents
([why, and what was measured](../developers/ci-and-gates.md#the-full-history-checkout-skips-old-file-contents-a1316)).
Full baseline `40757792434` and shallow comparison `40765243305` each passed 76 jobs, with
one skipped publish. Package test counts matched; the root gained the new history guard.
Across the 35 converted suite instances, median stored pack bytes fell from 408,161,710 to
206,776,315 and median first-checkout time from 32 to 22 seconds. Stored bytes are not wire
traffic, and these hosted runs do not isolate timing from runner or network conditions. Both
coverage gates passed; the history change reduces requested data, not a proved timeout cause.

On 28 October, [main run 40750935978, till shard 3](https://github.com/clintongormley/waitron/actions/runs/40750935978/job/123038600113)
exhausted both 120-second attempts with `--depth=1`, before installation or tests. Reducing
full-history transfers does not eliminate this observed shallow-checkout failure mode.


## Decide whether browser tests stop replacing modules (A943 follow-up)

A spy mock of
the till's pricing module failed once in CI with its cause not found, and #1934 replaced it
with a function the store takes. Its convention reviewer proposed a CLAUDE.md rule against
module mocks in browser tests; #1934 did not add one, because one failure with no known
cause is thin ground for a house rule. The owner decides.


## `packages/db`'s static mutants are not in its mutation score

Left open by A539.
`"ignoreStatic": true` in `packages/db/stryker.config.json` leaves out every mutant in code that
runs when a module loads (322 `Ignored` on run 38256003987, 229 of them in
`src/classification.ts`). Stryker runs every test for each static mutant; what measuring them
would cost has not been timed. Owner's call.

## drizzle-kit 0.31.11 left out `ON DELETE` when it generated an `ALTER TABLE … ADD … REFERENCES` on this engine, while its snapshot kept it

The schema-conformance suite compares declared
delete rules with the migrated database for the sets that opt in; [A812's deletion
experiment](../developers/testing-guide.md#a-missing-delete-rule-fails-the-schema-comparison) caught
one omitted rule. The generator omission was observed once by an implementer (five store tests
failed with a foreign-key refusal), not independently re-run. Left open by A429 slice 1 (#1493).

## The till shard's blocked operation is unknown (A1027)

Main run `39898823017` at `c76bcdaf3` lost the log for `test-till (2)`, job
`120235613840`; both the CLI and jobs-logs API could not retrieve it. The job
started at 04:29:59Z and ended cancelled at 04:44:59Z, while its configuration
named a ten-minute limit. Those timestamps do not establish where it waited.
The preceding and following healthy shards do not diagnose the hang.

A1027 adds a diagnostic process deadline with unfinished-file and process reports
to every browser package's test command. The original wait remains unlocated.
On recurrence, retain the failed step log and use its file list, selected-file
case/hook events, Playwright API calls, any `[file-progress] stack:` lines and the
process state to identify a blocked operation or slow cases. The parties file ran
long; the line-detail and refund-unsaved files started within 13 seconds of the
deadline. The till shard selects all three for the existing case/hook trace and
enables `DEBUG=pw:api`; these diagnostics do not establish a cause or repair. Keep the venue-service startup investigation and A419's dashboard stall
separate; no shared cause is established.

## A1230: dashboard shard 1's blocked operation is unknown

Main CI run `41046955691`, job `124036233860`, ended at its 360-second
command deadline on 30 October 2026. Its unfinished files were
`content-languages-screen.a11y.test.ts`, `content-translations-dialog.a11y.test.ts`
and `extra-list-form.save-state.test.ts`. The retained log identifies assigned
files, not the pending case, hook or browser command.

On macOS, the three files passed all 138 cases in 62.92 seconds. The original
shard-1 command with coverage passed 130 files and 3,327 cases in 104.55 seconds.
Neither run reproduced the CI stall; neither establishes its cause or a repair.

The dashboard shard now selects those three files for detailed reporter events
and enables Playwright API logging. On recurrence, preserve the whole failing log,
read each selected file's last collected/case/hook event and any unfinished
Playwright API call, then reproduce that wait. A completed collection event
separates a loaded module from an assigned file; a case-start event precedes its
beforeEach hooks. These events do not name a pending application promise. A
browser file that reports no case or hook for 60 seconds past its time limits also gets `[file-progress] stack:` lines once a page shows it (see A1305
below). Product behavior, test assertions, test deadlines
and shard counts have not changed in this diagnostic slice.

## A1305: the dashboard page blocked during a click, and what blocked it is unknown

Main CI run `41338680756` (`b0aa3502d`), job `124944000948`, `test-dashboard (4)`,
reached its 360-second deadline on 1 November 2026 with only
`src/screens/device-profiles-screen.clock.test.ts` unfinished. The file started at
18:58:17. Its Playwright API log shows the click on the Clock in switch at 18:58:17.532
log `performing click action` and never `click action done`: of the 83 clicks
started between 18:58:17 and 18:58:32, 82 succeeded and that one failed, at
18:58:32.166, when Playwright's timeout (the test's remaining 15 seconds) ran out on
the Node side. The log's click lines name no browser page, so it does not show which
pages the 82 ran on. Its `navigated to` lines do name a browser session: the clock
file's session loaded that file at 18:58:16.788 and nothing after it, while the other
two sessions went on loading test files until 18:58:56. No later API call in the log
names an element the clock file clicks, and its two later cases, whose first click is on
`edit-clock-profile`, never reached that click.

A blocked main thread explains that shape and a waiting test does not. On macOS,
a test whose click handler loops forever never finished and its file never ended,
as in CI; a test awaiting a promise that never settles failed at 15 seconds and its
file's next case passed. What blocked the page in CI was not found: the clock file
passed in 1,025 runs in batches of 25 (the file and 24 copies, three browser
workers; 275 runs with coverage on) and in 28 runs beside its CI neighbours (17
with coverage). Reading the click's path
(`wt-switch`, the screen's capability toggle, the draft scope, `wt-dialog`) found
no loop.

On the next stall, read the `[file-progress] stack:` lines first
([how they are taken](../developers/ci-and-gates.md#a-browser-file-silent-past-its-time-limits-gets-a-stack-sample)).
They show where the page's JavaScript was when paused, or that nothing paused and
whether the page answered, or that no page showed the file, or that a time limit Vitest treats as none kept it from pausing then. A file whose silence
began too close to the deadline for its limit to pass gets no `stack:` line. The earlier dashboard
stall (A1230, above) left too little evidence to say whether it was the same.

**1 November 2026, another unfinished browser file.** Main run `41338680756` on
`b0aa3502d761d8d327b00c32e0d43c498bdaf024`, job `124944000948` (`test-dashboard (4)`),
reached its 360-second command deadline with only
`src/screens/device-profiles-screen.clock.test.ts` unfinished. Its missing coverage blob
then failed upload. The full log, including the last browser calls and process snapshot, is
retained in Lane F's `receipts/w41s8-payload-20261101/a1304-main-dashboard4.log`.
No assertion failure was reported; whether this shares the earlier stall's cause is unverified.
A1305 owns that investigation in Lane B. Keep the failed run; a passing retry would not establish
the cause or a repair.

## Server test time levers left after A1297

[PR #2418](https://github.com/clintongormley/waitron/pull/2418) (A1297) remembered recovery-key checks
within a test file, migrated `heldSetup`'s databases once per file, sealed the test helpers' backups
under one salt per file and split `first-fiscal-hour.e2e.test.ts`. Its investigators measured or named
these, which it did not build (local figures, 2 November 2026):

- **One migrated template for every `useVenueDb` suite: measured and not worth building** (A1443,
  8 November 2026). The 0.85 s per file recorded on 2 November predates [PR #2539](https://github.com/clintongormley/waitron/pull/2539),
  which took the repository from 405 migration files to 7. Timed on one Mac in a new process per run
  (every file is its own process under Vitest's defaults) with the full manifest: migrating takes a
  median of 65 ms and copying an already migrated database 18 ms, a saving of 47 ms per file. The same
  timing on the commit before #2539 gave about 1.9 s against 23 ms, so the timing can see a real gain.
  Across the 826 server test files in `apps/server/test-durations.json` that is about 39 s of 12,724 s
  recorded, or 0.3%; three times that, for a slower CI machine, is still under 1%. The 5% bar would need
  about 770 ms per file. Measured locally only: no CI run was made. Measure again only if the
  migration history grows back to hundreds of files.
- **Recovery-key checks outside the host and staged-restore fixtures still derive repeatedly.**
  Moving the memo into wider test setup
  must keep `src/testing/watched-scrypt.ts`'s derivation counts correct.


## A1252: remaining server job time after the held-setup split

**Coordination, 1 November at 12:45:** the watcher closed A1252 after its split and three
observations, and assigned the remaining over-270-second work to **A1297**. The measurements
below remain receipts for that follow-up; they do not mean A1252 is still open.

On 31 October 2026, [PR #2341](https://github.com/clintongormley/waitron/pull/2341)
landed the held-setup split, preserving all 73 cases, including A1131's three
fresh-box restore cases. Its final [CI run 41200533986](https://github.com/clintongormley/waitron/actions/runs/41200533986)
checked out `3f446266f2b8872798ddc250fabce46b8079aeea` in every ordinary server job.
All 1,125 selected ordinary files ran exactly once. The coverage merge reports
26,935 tests passed and one skipped across 1,135 files, including the separate
stream/full-disk job.

The five held-setup files took 90.2–143.6 seconds each. Complete ordinary jobs
took 173–305 seconds, so this run does not meet the target of about 4.5 minutes
for every job. The table lists each job above 270 seconds and its longest file.
The test step runs the complete file group and coverage; setup and cleanup are
the rest of the job's recorded duration.

| Shard | Whole job (s) | Test step (s) | Setup and cleanup (s) | Longest file (s) |
| --- | ---: | ---: | ---: | --- |
| test-server (1) | 283 | 238 | 45 | `src/first-setup-start-again-backup-discard.test.ts` (206.6) |
| test-server (13) | 272 | 228 | 44 | `src/hour-recovery-placement-3.test.ts` (144) |
| test-server (2) | 274 | 226 | 48 | `src/invoice-pdf.test.ts` (180.1) |
| test-server (11) | 295 | 250 | 45 | `src/first-setup-backup-reopen.test.ts` (186.5) |
| test-server (10) | 274 | 228 | 46 | `src/first-setup-backup-recovery-preparation.test.ts` (167.1) |
| test-server (5) | 305 | 249 | 56 | `src/first-fiscal-hour.e2e.test.ts` (199.5) |
| test-server (20) | 271 | 236 | 35 | `src/first-setup-backup-resume-authority.test.ts` (141.6) |
| test-server (16) | 275 | 231 | 44 | `src/hour-recovery-placement-2.test.ts` (160.4) |

**1 November follow-up:** the three natural full main observations now exist:
[41288426367](https://github.com/clintongormley/waitron/actions/runs/41288426367),
[41278766733](https://github.com/clintongormley/waitron/actions/runs/41278766733) and
[41272334746](https://github.com/clintongormley/waitron/actions/runs/41272334746).
Each successfully executes all 20 ordinary server shards. Their maximum whole jobs
are 278, 292 and 306 seconds, respectively. The observation wait is complete; the
all-jobs target still has residual work.

| Run / shard | Whole job (s) | Test step (s) | Setup and cleanup (s) | Longest file (s) |
| --- | ---: | ---: | ---: | --- |
| 41288426367 / 3 | 276 | 230 | 46 | `first-setup-backup-resume-publication.test.ts` (177.8) |
| 41288426367 / 10 | 276 | 225 | 51 | `first-setup-backup-recovery-preparation.test.ts` (149.8) |
| 41288426367 / 19 | 278 | 236 | 42 | `restore-emergency-crash.e2e.test.ts` (123.7); `first-setup-backup-lease.test.ts` also takes 118.3 |
| 41278766733 / 11 | 292 | 250 | 42 | `first-setup-backup-reopen.test.ts` (174.1); `first-setup-database-holdings-damage.test.ts` also takes 147.4 |
| 41272334746 / 5 | 306 | 239 | 67 | `first-fiscal-hour.e2e.test.ts` (183.1) |

The first three rows cover every over-270-second job in the latest run; the final
two identify the longest job in each older observation. Retain whole-job,
test-step and per-file times when choosing further packing or suite-setup work,
with every behavioural assertion preserved. These measurements identify
contributors; they do not establish the cause of every aggregate delay.

**A696 observation, 1 November:** [PR CI 41305909069](https://github.com/clintongormley/waitron/actions/runs/41305909069)
passes at `4b85799d4`, after the branch's process matrix is split from one 348-second file
into five files retaining all 18 cases. The five files take 14.8–99.1 seconds. Their containing
jobs take 196, 204, 265, 269 and 294 seconds. The 294-second job's largest files are `boot.test.ts`
(126.7), `first-setup-database-holdings.test.ts` (123.2) and
`zone-process-matrix.callers.test.ts` (99.1). Nine server jobs exceed 270 seconds; the maximum is
329, with `first-fiscal-hour.e2e.test.ts` (213.2) and `boot.setup-routes.test.ts` (168.8) its largest
files. These are measured contributors, not a controlled causal comparison. This PR observation
is additional evidence, not a replacement for the three main observations above. The remaining
packing/setup work stays open. Lane E retains the exact twenty job logs, complete durations and
per-file measurements under `receipts/a696-resume-20261101/`.

A1242's separate publication/fallback qualification is complete. Main run
[41282000200](https://github.com/clintongormley/waitron/actions/runs/41282000200)
reuses successful PR run 41281175428, reports `code=true`, and successfully pushes
both `:main` images. PR #2365's tested head tree
`b5eeb91d4b82ec128a9c356e03f0330b780884e2` differs from its main squash tree
`bc1116107149662396b1b46ff1900d791c91bf9f`; main run 41278766733 reports
`reuse=false` and runs the full global suite successfully. Earlier post-fix run
41183258278 and docs run 41183408052 both report `code=false`, with publication
skipped. The API tree pairs, job scopes and publication logs are retained in
Lane E `receipts/a696-resume-20261101/`.


## A1306. Rewrite git history to drop the development artifacts

Owner, 2026-11-02: "there is no point in keeping these development artifacts as history".
Mock-ups and screenshots left the tree on 2026-11-02, but history still holds 2,327 image
versions, about 300 MB compressed of a 584 MB pack (measured that day with `git rev-list
--objects --all` and `git cat-file --batch-check`). Rewrite `main` with them removed, at a moment
when the lanes are paused, as the last step of A1308 (owner, 2026-11-06). Every clone, worktree, lane and open pull
request then restarts from the rewritten `main`, and old commit links stop resolving. Decide then
whether other development artifacts (finished specs and plans, look reports) go too.

## A1251. Finish qualifying and reviewing historical PRs that skipped the Claude run-it review

Exclude documentation-only changes, verified test-data/name renames and changes already reviewed.
Review each remaining squash against its parent and check findings against current main before
opening a repair. Check refusal wording against independent expectations kept in the app's
`i18n` area.
Use the [qualified public-connection wording receipt](self-service-refusals.md#tls-repair)
without treating browser refusal checks as certificate-recovery qualification.
Check the later regional demo guides’ photo-library name claims against image metadata and the
screen’s content-language selection.
Keep the IPP clock-driver limit explicit when
changing the polling continuation, and check that a failed fixture’s print call settles after
teardown.


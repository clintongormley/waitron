# A1424: server shard routing implementation plan

Authority: F questions.md, 2026-11-07 14:39: “Build both”. Approved direct expression/metadata-only hosted watchdog: 20-minute queue allowance exceeds I’s 15-minute controller stop. Preserve existing reuse. Watcher, 2026-11-07 14:43, approved: “Give it test-server's gate and exit successfully without an API call on main, retries, forks and disabled routing”. final-plan-review.md S1, WATCHER-NEEDED 14:50: driver recommends retaining existing identity GET/409 readback pending verification; cancellation decision before LAND, not BUILD. Claude reads amended plan before build; none started.

Healthy [run 42370934080](https://github.com/clintongormley/waitron/actions/runs/42370934080) queued 24 server jobs for median 552 seconds and executed them for median 182 seconds. Dashboard and heavy remain I's probes.

1. **Route directly.** Pin this exact `test-server.runs-on` expression in `.github/workflows/ci.yml` and `scripts/ci-workflow.test.mjs`:

   ```yaml
   runs-on: ${{ github.run_attempt == 1 && github.event_name == 'pull_request' && github.event.pull_request.head.repo.id == github.repository_id && github.event.pull_request.head.repo.full_name == github.repository && vars.DISPOSABLE_TESTS_MODE == 'server' && matrix.shard <= (vars.DISPOSABLE_TESTS_SERVER_JOBS || '0') && fromJSON(format('["self-hosted",{0}]', toJSON(format('{0}-{1}-{2}-{3}-test-server-{4}', vars.DISPOSABLE_TESTS_LABEL_PREFIX || 'dt', github.repository_id, github.run_id, github.run_attempt, matrix.shard)))) || 'ubuntu-latest' }}
   ```

   Budget defaults zero. Keep 24 shards, ten-minute limits, hosted retries, forks, other events/jobs. No helper, output map, shell budget calculation or GitHub coercion model. I's 14:23 handoff: `dt` only; keys `test-server-N`, N=1–24. Hardcode `test-server` plus `matrix.shard`, never `github.job`. Executor: one published slot, no permanent poller, capacity unmeasured.

2. **Watch the queue.** Hosted `server-queue-watchdog`: needed by `ci`, depends on `changes`; gate EXACTLY original `test-server` gate (code/server/nonreuse). Env `SHOULD_WATCH` combines successful-changes/first-attempt/same-repository-PR/server-mode with exactly `1 <= (vars.DISPOSABLE_TESTS_SERVER_JOBS || '0')`, shard 1's routing comparison. Shell exits 0 immediately without API calls if `SHOULD_WATCH != true`. Main/retries/forks/disabled-routing: successful no-op; routed PR: metadata polling. Cost: one hosted no-op job. Only watchdog gets `actions: write`; `ci` keeps `actions: read`. Timeout: 22 minutes; no `always()`, job name, `continue-on-error`, checkout or source execution.

   `findReuse` probe/fixture: main watchdog skipped → false; identical success → true. `scripts/ci-reuse.mjs:166–174` requires all full-main jobs successful; PR-only gating disables future main reuse. Keep verifier.

   Poll attempt-scoped jobs: full pagination, ten-second calls, five-second sleeps. Require `total_count` stable WITHIN each full paginated read; allow growth between polls. Require matching unique-ID count, exactly 24 actual `test-server (N)` jobs; guard ties watchdog's expected 24 to actual matrix count. Watch actual self-hosted labels; verify prefix, repository ID, run ID, attempt, shard key. Empty/missing/partial inventories never succeed. Complete valid inventory without self-hosted jobs fails immediately WITHOUT cancelling. Success: every watched job assigned or completed. No shell budget recomputation.

   Allow 1,200-second polling within 1,260-second outer shell limit. Ten-second paginated calls can overrun polling by at most ten seconds. The 60-second cancellation reserve includes overrun, current-identity GET (run/head/attempt), normal cancellation (two tries), 409 readback. A 409 succeeds only with recorded-run completion readback. Never force-cancel. API outage: red watchdog; `ci` may await queued shards until GitHub queue expiry. Neither limit guarantees total elapsed time.

3. **Prove, then qualify.** Failing tests, minimal implementation, passing tests. Check expression/gate-equality/permissions/needs. Run extracted real shell controlling HTTP/sleep/time: no-op zero API calls, incomplete inventories, within-read inconsistent totals, legitimate between-poll growth, no-self-hosted immediate failure/no-cancellation, duplicate jobs, labels, API errors, assignment, completion, stale identity, retry, 409. Existing reuse guard/fixtures/assertions untouched. `findReuse` tests: metadata job success permits reuse; skipped refuses. Temporary removal of reuse must fail. Keep other guards; changed expectations outside `runs-on` require watcher decision. Deletion controls stay temporary.

   Run focused workflow/reuse/root-scope guards; update CI guide/backlog bundle. Signed-off commits, hook, `finish-branch` review, current-head CI. First probe: reviewed workflow commit, queued job ID. Qualify on real server-scoped PR after disabled routing lands, perhaps A1381; never fake scope/add unrelated code. Activate after I measures readiness/capacity, ordinary PR admission/fallback, confirms `all_external_contributors`. Drill unavailable label, hosted attempt two; inspect runner identity, checkout head, coverage merge, `ci`.

| Official provenance | Residual |
| --- | --- |
| [Security](https://docs.github.com/en/enterprise-cloud@latest/actions/reference/security/secure-use#hardening-for-self-hosted-runners): “can be persistently compromised by untrusted code in a workflow” | Public-repository VM, hypervisor and network exposure; I owns disposable VMs and Mac-side durable credentials. |
| [Routing](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#routing-precedence-for-self-hosted-runners): “the job will remain queued until a runner comes online” | Hosted watchdog availability matters; execution timeout does not bound queueing. |

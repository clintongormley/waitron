# Run the venue theme start-up checks in WebKit in CI

Lane I item `WEBKIT-STARTUP-CI` in `queue.md` and both “WebKit in CI” backlog entries.
The watcher requested one shared job at 20:02 on 2026-11-23 in Lane I's `questions.md`.
The 20:47 note in the same file records “plan CLEARED by the watcher WITH CHANGES”.
A change that selects the dashboard or till gets eight WebKit start-up checks per app in
required CI. Qualify the entire hosted job against 240 seconds in both a cold and a warm run.

1. **Start from current main.** Carry this plan forward and drop the retired two-shard
   implementation from the candidate. Verify the base-to-tip diff leaves the Chromium shard jobs
   and coverage merges intact. Keep app manifests and suite bodies as on main.
2. **Prove the workflow wiring.** In `scripts/ci-workflow.test.mjs`, add focused cases for the
   two app gates, both WebKit commands and their blocking engine setting, and separate browser
   caches in one folder. Reuse the `ci` job-graph check. Extend `withDepsWaits` to catch an
   unbounded direct Playwright `install-deps`. Check that the WebKit job fails its guard with
   the deadline outside sudo or with its test allowed to fail. Run
   `pnpm exec vitest run scripts/ci-workflow.test.mjs` before and after wiring.
3. **Add `test-webkit-startup` to `.github/workflows/ci.yml`.** Use `ubuntu-latest` for sudo and APT, outside the server-routing list. Give it an
   eight-minute job timeout, `needs: changes`, the existing `code` gate and either the
   `dashboard` or `till` gate. Add its id to `ci.needs`. Reuse bounded checkout, pnpm and
   Node setup, and frozen install. Follow `bundle-smoke` for restore-only Chromium and its
   headless-shell fallback. Restore or clear Chromium first. Cache only `webkit-*` in the
   default Playwright folder under a separate OS, architecture, release and Playwright-version
   key. Clear a failed WebKit restore within its own scope. Bound the browser download.
4. **Retry APT under a root-owned deadline.** Hosted probe [45241092879](https://github.com/clintongormley/waitron/actions/runs/45241092879)
   installed 185 packages in 24.8 s. Resolve and verify a GNU timeout executable before sudo.
   Under `sudo -n`, bound the pinned Playwright CLI's `install-deps webkit` to 90 seconds
   and send KILL at the deadline. Pass step-local `APT_CONFIG` with `Dpkg::Use-Pty=false`
   on sudo's command line so dpkg stays in the signalled group. The GNU version check replaces the 19:09 plain-timeout
   wording because uutils can leave a child alive after forced kill
   ([CI and gates](../../developers/ci-and-gates.md#every-pnpm-setup-is-bounded)). The existing
   `withDepsWaits` check accepts this resolved timeout only inside sudo. After a failed attempt, run bounded `dpkg --configure -a`
   before retrying once. Fail the job if recovery or the second attempt fails. Bound the step.
   In a disposable hosted run, stall dpkg at its pre-invoke hook. Capture the PIDs, process
   groups and the state of both locks. Require exit 137, the apt and dpkg processes no
   longer running, and both locks free before recovery and a successful retry. Keep the probe out
   of the shipped workflow.
5. **Run and measure.** With `WAITRON_STARTUP_ENGINES=webkit`, run
   `pnpm --filter @waitron/dashboard exec vitest run src/venue-theme-startup.test.ts --reporter=verbose`
   and the same command for `@waitron/till`, each under `scripts/run-with-deadline.mjs 120 --diagnostics`.
   Confirm eight named WebKit passes per app in hosted CI. Run both engines locally for 16 per app.
   Time the hosted job through cleanup with a WebKit cache miss and hit, both within 240 s.
   Record run, attempt, job and image ids, cache state, and the cache API's `size_in_bytes` and
   ref for the new entries. Count PR-scoped copies before a matching default-branch entry exists.
   The cache competes with existing Chromium and pnpm entries. Qualifying runs need healthy
   GitHub incident history, checkouts under about 10 s and no download HTTP 5xx. The retired trial
   [45242704718](https://github.com/clintongormley/waitron/actions/runs/45242704718) failed at 324 s
   and 339 s. Bring any qualified result over 240 s to the watcher.

Update `docs/developers/testing-guide.md` and `docs/developers/ci-and-gates.md`, and remove the
entries in `docs/backlog.md` and `docs/backlog/till.md`. Estimate 100–135 workflow lines and
30–45 guard lines, plus docs.

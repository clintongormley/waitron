# A1440: keep image smoke on GitHub

The watcher’s **2026-11-09 08:20** instruction in
`~/waitron-campaign-i/questions.md:827` is “image smoke always runs on GitHub's
machines, until a guest is proven to run it.” Ship this small A1440 correction first.
Retained job logs for nightly `42550200310` and lane E’s `42525659420` (#2543)
both end at the Bluetooth check with `dbus_unreachable`. The nightly’s ssh2
optional-binding compiler error is followed by `Done` and later successful image
builds; it is not established as a failing-job cause. Receipts are in
`~/waitron-campaign-i/receipts/a1440-hosted-image-20261109/`.

**Approval before build:** obtain one Claude plan read through
`~/workspace/tools/claude-seat.sh review-branch`, then watcher approval. Explicitly
request approval to change the routing guard under `scripts/`: the queue’s
changed-check rule calls such changes controversial. Replace image’s server
expectations with equally strict hosted expectations; preserve other jobs’ checks.

**Exact files and estimated size:** configuration: one changed line; runtime code:
zero; tests: 20–40 changed lines; existing docs: 15–30 changed lines; this one-page plan.

| File | Change |
| --- | --- |
| `.github/workflows/image-smoke.yml` | Set `jobs.smoke.runs-on` to literal `ubuntu-latest`. Keep declared `server_route` input. |
| `scripts/ci-server-first.test.mjs` | Make image an explicit hosted exception and directly test it. |
| `docs/developers/ci-and-gates.md` | Update disposable-runner prose: image is always hosted; input is retained but unused for placement; `image-smoke-1` is historical. |
| `docs/backlog.md` | Update the network-step bundle for the hosted exception and parked A1454. |
| `docs/backlog/ci.md` | Update A1440’s bundle; retain the guest-failure investigation and unfinished routing work. Add a dated correction to the earlier A1454 decision. |
| `docs/superpowers/plans/2026-11-09-a1440-hosted-image-smoke.md` | This plan. |

**Build and verification, after approval:**

1. Extend the existing routing suite first. Assert image’s literal hosted route and
   hosted results with server mode/input, events `pull_request`, `push`, `schedule`,
   `workflow_dispatch`, attempts 1, 2 and 7, and marked/unmarked retries. Change
   image’s expectations in the general server and overflow cases; retain fork,
   maintenance, health fallback and caller-input assertions. Run
   `pnpm exec vitest run scripts/ci-server-first.test.mjs`; observe the new hosted
   assertion fail because the current workflow selects self-hosted.
2. Make the one-line workflow edit and update the three docs. Leave
   `.github/workflows/ci.yml:812–819` and its input forwarding unchanged. Run the
   routing suite again, then
   `pnpm exec vitest run scripts/ci-workflow.test.mjs -t 'disposable server routing|the image smoke.s scoping|ci.yml.s job graph|CI image provenance'`.
   Require passing test counts. In a disposable candidate copy, restore only the
   old server-routing expression: the new hosted assertion must fail. Keep the
   working checkout unchanged during this deletion control.
3. Use `finish-branch`, including Claude run-it review, signed-off commits, the
   normal pre-push hook and required CI on the exact candidate SHA. Record changed
   assertions and approval in the PR’s “Changed test checks” section.

**Leaves out:** guest qualification, guest root-cause fixes, capacity/overflow changes,
new controls or credentials, runtime changes and further A1454 measurements. Six
slots stay. Keep unfinished work in the existing A1440 bundle. Any additional file
requires a named plan amendment and watcher approval before editing.

**Finish line:** hosted image smoke and required checks pass on the exact candidate.
Land through `land-branch` under `~/waitron-campaign-shared/main.lock`. Then follow
`~/waitron-campaign-shared/ci-failure-rule.md`: read the failed nightly’s logs and
history, dispatch the same CI workflow with `gh workflow run ci.yml --ref main`,
and read its result before claiming the correction complete. Retain source SHA,
runner and run receipts; report to lane E and the watcher. This full nightly is
required failure followup, not a local whole-suite run or proof the guest causes
are fixed.

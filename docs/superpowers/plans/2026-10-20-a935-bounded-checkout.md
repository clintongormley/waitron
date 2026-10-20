# A935 bounded checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`. Every
> implementer is dispatched as `subagent_type: "implementer"` (medium effort). Steps use checkboxes.
> An implementer that passes about 150 tool calls with its task unfinished stops at a passing (or
> cleanly red) point, commits with `git commit -s`, and returns a handover: done, left, files, each
> check's state.

**Goal:** No `actions/checkout` step in `.github/workflows/*.yml` can wait longer than a short
bound, and a stalled attempt is retried once before the job fails — the same shape CLAUDE.md §2
already requires of the pnpm setup.

**Mechanism (chosen from the measurements below):** every checkout becomes three consecutive steps:

```yaml
      - id: checkout
        name: Check out the code
        uses: actions/checkout@v7
        timeout-minutes: 2
        continue-on-error: true
        env:
          GIT_HTTP_LOW_SPEED_LIMIT: 1000
          GIT_HTTP_LOW_SPEED_TIME: 20
      - name: Stop the first checkout's leftover git
        if: steps.checkout.outcome == 'failure'
        run: for p in $(pgrep -x git); do [ "$(readlink /proc/$p/cwd)" = "$GITHUB_WORKSPACE" ] && kill -9 "$p" && echo "stopped git $p"; done; true
      - name: Check out the code, second attempt
        if: steps.checkout.outcome == 'failure'
        uses: actions/checkout@v7
        timeout-minutes: 2
        env:
          GIT_HTTP_LOW_SPEED_LIMIT: 1000
          GIT_HTTP_LOW_SPEED_TIME: 20
```

A site that passes `with:` (for example `fetch-depth: 0`) carries the identical `with:` block on
both attempts. Two layers:

1. **git's own low-speed limit** (`GIT_HTTP_LOW_SPEED_LIMIT`/`_TIME`, read by git from the step's
   environment, which the action passes through to every git it runs). A transfer that moves less
   than 1000 bytes a second for 20 s is ended by git with exit 128, and the action's built-in
   retry runs the fetch again — three fetches at most, 10–20 s apart. Worst case 3 × 20 + 2 × 20 =
   100 s.
2. **The step's `timeout-minutes: 2`**, for any stall git's limit cannot see (measured below: a TLS
   handshake that never completes is waited on for 300 s, and a TCP connect to an address that
   never answers is not ended by the low-speed limit either). `continue-on-error` lets the job go
   on; the stop step kills the first attempt's git, which the runner leaves running; the second
   attempt runs under its own 2-minute limit and fails the job if it fails.

Worst case for one checkout: 2 + 2 minutes.

**Tech stack:** GitHub Actions YAML, the pinned `actions/checkout@v7`
(`3d3c42e5aac5ba805825da76410c181273ba90b1`), Vitest root guards in `scripts/ci-workflow.test.mjs`
(text readers, no YAML library in the workspace).

**Path:** FULL review (CI gate, every workflow). No migration. No package code changes.

## Global constraints

- Plan base: `a6b9f9484` (`origin/main`). Worktree
  `/Users/clintongormley/workspace/worktrees/waitron-feat-a935-bounded-checkout`, branch
  `feat/a935-bounded-checkout`. Prefix every command with `cd <worktree> &&`.
- Checkout sites on the base, counted with
  `grep -c '^      - uses: actions/checkout@v7$' .github/workflows/*.yml`: ci.yml 31, mutation.yml 5,
  licence.yml 2, codeql.yml 1, image-smoke.yml 1, stripe-sandbox.yml 1, image-nightly.yml 0 — 41,
  all at six-space indent, all `@v7`. Re-count after any rebase.
- `codeql.yml` is ours to change: it is a committed workflow (`git log -- .github/workflows/codeql.yml`
  shows #1535 and #1595), and `gh api repos/clintongormley/waitron/code-scanning/default-setup`
  answered `{"state":"not-configured"}` on 2026-10-20. It gets the same three steps.
- Never `--no-verify`. Every commit `git commit -s`. Local runs are focused; CI owns the package
  suites. This branch changes no package code, so the hook's "repository machinery only" path is
  expected.
- The throwaway branch `probe/a935-checkout-stall` (local and on `origin`, tip `32edde190`) holds
  the planning probes. Task 5 deletes it, with the final probe branch, and verifies both are gone
  on the remote.
- Do not edit the receipts and numbers below when copying them into the docs; if a re-measurement
  differs, report it, write the new figure with its own run id, and keep the old one beside it.

## Measured receipts (planning, 2026-10-20)

### The incidents

| Run / job | What the log shows |
| --- | --- |
| `39446310822`, `test-dashboard (2)` (lane G, `feat/a669-4-kitchen-allergy`) | `git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +157e6fa…:refs/remotes/pull/1919/merge` at 15:15:31.76Z, then nothing until `##[error]The operation was canceled.` at 15:21:25.20Z (353 s). Receipt: `~/waitron-campaign-g/receipts/resume-a669-wording-20261020-164550/checkout-job-log.txt`. The same fetch run locally: 8.534 s, exit 0 (`checkout-probe-result.json`). |
| `39440790729`, `test-server (4)` (lane C, `feat/a757-4b-owner-look-changes`) | Sat in `actions/checkout` from 14:42:09 until the 10-minute job limit at 14:52:13 (queue text; lane C's `progress.log` line 1718 records "CI test-server (4) checkout hang re-run"). Log not re-read here. |
| `39444354037` (a `main` run), `test-till (3)`, job `118702531645` | Found while measuring: the fetch started 15:09:30.14Z and printed `* [new ref]` at 15:14:13.00Z — 283 s, then succeeded. `gh run view 39444354037 --log --job 118702531645`. |

All three fell between 14:42 and 15:21 UTC on 2026-10-20. Whether GitHub reported an incident then
was not checked.

### What the pinned action does on a stalled fetch (source read, then run)

Source at `3d3c42e5aac5ba805825da76410c181273ba90b1`, fetched with
`gh api -H 'Accept: application/vnd.github.raw' "repos/actions/checkout/contents/<path>?ref=<sha>"`:

- `src/git-command-manager.ts` L315–317 — the fetch is wrapped in the retry helper:
  `await retryHelper.execute(async () => { await that.execGit(args) })`
  (https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/src/git-command-manager.ts#L315-L317).
- `src/retry-helper.ts` L3–5 and L25–43 — `defaultMaxAttempts = 3`, sleeps 10–20 s, and retries
  only when the action throws: `try { return await action() } catch (err) { core.info(...) }`
  (https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/src/retry-helper.ts#L25-L43).
- `src/git-command-manager.ts` L628–653 — git runs with `env` copied from `process.env` plus the
  action's own, and `result.exitCode = await exec.exec(\`"${this.gitPath}"\`, args, options)` with
  no time limit in `options`
  (https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/src/git-command-manager.ts#L628-L653).
  So a fetch that never exits is never retried, and a variable on the step's `env:` reaches git.
- `src/git-directory-helper.ts` L33–46 — a later checkout into the same directory deletes
  `index.lock` and `shallow.lock` "left by a previously canceled run or crashed git process", and
  L117–124 deletes the contents when it cannot reuse them.

Run locally (the action's own `dist/index.js` from that SHA, driven by `/tmp/a935-probe/run-action.sh`
with `GITHUB_SERVER_URL`/`INPUT_GITHUB-SERVER-URL` pointed at a local server; node v26.11.1, git
2.56.0, macOS). Before each run, the failing case was stated: for "the action waits forever" the
failing case is an exit before the outer limit; for "the low-speed limit ends it" the failing case
is exit 124 at the outer limit.

| Probe | Printed |
| --- | --- |
| A1: silent server (accepts, never answers), no low-speed limit, `gtimeout 150` | `exit=124 seconds=150`; last log line is the `git … fetch` command, the same shape as the CI log |
| A2: silent server, `GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=10` | `exit=1 seconds=65`; three `Operation too slow. Less than 1000 bytes/sec transferred the last 10 seconds`, with `Waiting 20 seconds` and `Waiting 13 seconds` between |
| A5: server sending an HTTP 200 head, then one byte every 2 s, same limit | `exit=1 seconds=66` |
| A3 / A4: github.com, `actions/checkout` at that SHA, with / without the limit | `exit=0 seconds=1` / `exit=0 seconds=2`, HEAD `3d3c42e…` both |

git alone, in `ubuntu:24.04` (git 2.43.0, libcurl 8.5.0 OpenSSL), each under `timeout 60`:

| Probe | Printed |
| --- | --- |
| P1 silent, no limit | `exit=124 seconds=60` |
| P2 silent, limit 1000/10 | `Operation too slow …` `exit=128 seconds=10` |
| P3 trickle, limit 1000/10 | `exit=128 seconds=10` |
| P4 `http://10.255.255.1` (no answer to connect), limit 1000/10 | `exit=124 seconds=60` — the low-speed limit did not end it |
| P5 / P6 github.com, with / without limit | `exit=0 seconds=1` both |
| P7 `https://` to the silent server (a TLS handshake that never completes), limit 1000/10, under `timeout 400` | `SSL connection timeout` `exit=128 seconds=300` — the low-speed limit did not end it; curl's 300 s connect timeout did |

Margin for a full-history fetch: `git fetch` of all of `clintongormley/waitron` (292 MB `.git`)
from this Mac took 14 s with limit 1000/20, and 15 s and 13 s with the window cut to 2 s — the
2-second window never fired.

### What the runner does (CI, throwaway branch `probe/a935-checkout-stall`)

Runner source v2.337.0 (`src/Runner.Worker/StepsRunner.cs` L322–329): a step whose own token
expires while the job's has not gets `The action '…' has timed out after N minutes.` and
`TaskResult.Failed`; `ExecutionContext.ApplyContinueOnError` then sets `Outcome = Result` and
`Result = Succeeded`. Measured:

- Run `39468071988`, job `outer-bound` (first attempt pointed at a silent local server with
  `github-server-url`, no low-speed limit, `timeout-minutes: 1`, `continue-on-error: true`):
  `##[error]The action 'Run actions/checkout@v7' has timed out after 1 minutes.`, then
  `attempt 1 outcome=failure conclusion=success; attempt 2 outcome=success`, HEAD equal to
  `GITHUB_SHA`, `status lines: 0`. **The first attempt's git outlived the step:**
  `2210 64 /usr/bin/git -c protocol.version=2 fetch …` and `2211 64 /usr/lib/git-core/git remote-http origin http://127.0.0.1:18081/…`
  were still running. Both post-job checkout cleanups succeeded.
- Same run, job `inner-bound` (limit 1000/20, `timeout-minutes: 3`): three
  `Operation too slow … the last 20 seconds`, `Waiting 10 seconds`, `Waiting 13 seconds`; the first
  attempt failed after 83 s (17:40:14 → 17:41:37); the second attempt succeeded in 8 s.
- Same run, normal speed, five of each, `Run actions/checkout@v7` step seconds: bounded shape
  `fetch-depth: 1` 12, 10, 9, 10, 10 and `fetch-depth: 0` 12, 19, 15, 13, 15; plain checkout
  `fetch-depth: 1` 5, 10, 11, 9, 10 and `fetch-depth: 0` 19, 15, 15, 15, 24. Every second attempt
  `skipped`.
- Run `39469682050`, job `inline-stall`: the inline stop step (with `$PWD` where the final text has
  `$GITHUB_WORKSPACE`) printed `stopped 2215` and `stopped 2216`; the second attempt then took 6 s,
  HEAD equal to `GITHUB_SHA`, `no git process left`.
- Same run, the alternative of a `$/.github/actions/checkout-retry` composite (one file holding the
  stop and the second attempt): it worked when stalled (`stopped the first attempt's git 2090`,
  `… 2091`, HEAD correct), but merely naming it made the runner download this whole repository at
  job set-up even when the step was skipped
  (`Download action repository 'clintongormley/waitron@32edde19…'`): "Set up job" took 13, 17, 16,
  14, 12 s against 0, 1, 1, 1, 0 s for a plain checkout job. Rejected.

Healthy baseline on `main`: the `Run actions/checkout@v7` step over the 10 latest completed
`ci.yml` runs on `main` (read 2026-10-20 ~17:40 UTC, `gh api …/runs/<id>/jobs`, whole seconds),
378 step records: median 10, 90th percentile 17, 99th 24, longest 285 (the stall above); next
longest 37.

### Why not the other shapes

- **A script like `scripts/ci-setup-pnpm.sh`:** the script is in the repository the step is about
  to check out, so it cannot run before it.
- **A `./` local composite action:** github/docs `workflow-syntax.md` (commit `c67a9362`): "You
  must check out your repository before using the action".
- **A `$/` composite action:** measured above — 12–17 s added to every job's set-up and a new
  network download at set-up that nothing bounds. Also github/docs `metadata-syntax.md` lists
  `runs.steps[*]` keys `run`, `shell`, `if`, `name`, `id`, `env`, `working-directory`, `uses`,
  `with`, `continue-on-error` — no `timeout-minutes`, so a composite cannot bound its own first
  attempt.
- **YAML anchors to shorten the 41 copies:** every guard in `scripts/ci-workflow.test.mjs` reads
  text and would see `- *alias` as an empty step; not tried on GitHub.
- **Step limit only, no low-speed limit:** every silent stall would cost the full 2 minutes before
  the retry; with the limit, the action ends it itself in about 100 s at worst and retries inside
  the same step.
- **Low-speed limit only:** P4 and P7 — a connect or handshake stall is not ended by it, and P7
  waited 300 s per fetch, three fetches.

## Decisions to name in the PR

1. Three steps per checkout at every site, not a script, a local or `$/` composite, or anchors
   (receipts above).
2. Two layers: git's low-speed limit (1000 bytes/s for 20 s) inside the action's own three-fetch
   retry, and a 2-minute step limit for anything else.
3. Two attempts, not three: the action already makes up to three fetches inside each attempt, and
   a third 2-minute attempt would exceed the 5-minute jobs (`changes`, `typecheck`, the `-merge`
   jobs, `stripe-sandbox`, both licence jobs, the mutation aggregates). Even with two, a double
   stall in a 5-minute job can end with the job cancelled by its own limit rather than the second
   attempt failing; the same caveat the pnpm section states for its setup.
4. The stop step kills only `git` processes whose working directory is `$GITHUB_WORKSPACE` — the
   ones the first attempt started — measured to leave none behind. Leaving the leftover running was
   rejected: a fetch that resumed would write into `.git` while later steps read it.
5. A first attempt that fails leaves `##[error]` annotations on a run that still passes (seen in
   both probes). That is the trace of the stall, kept on purpose.
6. The checkout steps get names (`Check out the code`, `…, second attempt`), so the jobs API no
   longer reports `Run actions/checkout@v7`. Nothing in this repository reads that name
   (`grep -rn "Run actions/" scripts/ .github/` found nothing); a campaign tool outside it that
   does must use the new names.
7. The low-speed limit is set on the two checkout steps only, not workflow-wide, so no other git
   call in a job changes behaviour.
8. `codeql.yml` is changed too: it is ours (see Global constraints).
9. One pointer comment per workflow file to the receipt, not a comment at each site.

## Task 1: the guard, red on the tree

**Files:** modify `scripts/ci-workflow.test.mjs` only.

- [ ] **1.1** Extend `workflowSteps` (L2244) so each returned step also carries `id`, `uses`,
  `if`, `continueOnError` (each the value as written at the step's key indent, passed through
  `unquoted`, `undefined` when absent) and `env` and `with` (plain objects built from the
  `key: value` lines one indent deeper than the step's keys under an `env:` or `with:` key whose
  own value is empty; comment and blank lines skipped; values through `unquoted`; `{}` when
  absent). Keep `step`, `timeoutMinutes` and `command` exactly as they are. Run
  `pnpm exec vitest run scripts/ci-workflow.test.mjs` — all existing cases must still pass (read
  the `Tests` count: 195 on the base).
- [ ] **1.2** Move the job-splitting loop out of `pnpmSetups` (L2858–2873) into a helper
  `jobBlocks(text)` returning `[{ id, lines }]`, and use it in `pnpmSetups`. Run the file again;
  same count, all passing.
- [ ] **1.3** Write the failing synthetic cases first, in a new
  `describe("the workflows' checkouts", …)` placed after the pnpm-setup block and built the same
  way (a `workflow(steps)` helper and a `bounded` constant holding the exact three-step text from
  this plan's Mechanism section). The function under test is `checkoutAttempts(text)`, returning
  `[{ job, step, shape }]`, one entry per FIRST attempt, where `step` is the step's label from
  `workflowSteps` and `shape` is `"bounded"` or the first failing reason from this ordered list:
  `"no time limit"` (the first attempt's `timeoutMinutes` is not a positive whole number),
  `"no low-speed limit"` (`env.GIT_HTTP_LOW_SPEED_LIMIT` or `env.GIT_HTTP_LOW_SPEED_TIME` not a
  positive whole number), `"a stall fails the job"` (no `id`, or `continueOnError` not `"true"`),
  `"leftover git not stopped"` (the next step's `if` is not exactly
  `steps.<id>.outcome == 'failure'`, or its `command` lacks `pgrep -x git`, `GITHUB_WORKSPACE` or
  `kill -9`), `"no second attempt"` (the step after that has a different `uses` or a different
  `if`), `"second attempt unbounded"` (its `timeoutMinutes` is not a positive whole number, or its
  `env` differs from the first's), `"second attempt differs"` (its `with` differs from the
  first's), `"second attempt cannot fail the job"` (its `continueOnError` is `"true"`). A step
  counts as a checkout when its `uses` starts `actions/checkout@`. When the step two after a first
  attempt is a checkout whose `if` names `steps.<id>.`, both following steps are consumed and not
  judged as first attempts. Cases, each expecting one exact `toEqual`:
  - the bounded shape passes, with no `with:` and with `with:\n fetch-depth: 0` on both attempts;
  - a commented-out `# - uses: actions/checkout@v7` is not counted (`[]`);
  - a lone `- uses: actions/checkout@v7` → `"no time limit"`;
  - a job-level `timeout-minutes: 10` with no step limit → `"no time limit"`;
  - each other reason, made by breaking exactly one line of the bounded text (low-speed time `0`;
    no `continue-on-error`; stop step's `if` naming another id; stop step missing; second attempt
    missing; second attempt with no `if`; second attempt with no `timeout-minutes`; second attempt
    without the `env:`; `fetch-depth: 0` on the first only; `continue-on-error: true` on the
    second);
  - a double-quoted `uses: "actions/checkout@v7"` and a double-quoted `if:` still pass.
  Run the file: these fail because `checkoutAttempts` does not exist yet.
- [ ] **1.4** Implement `checkoutAttempts(text)` above the describe block, with a doc comment in
  the house shape (what it returns, and "Weaker than its name: it reads each workflow as TEXT …",
  listing what it misses: a checkout in a composite action or a called workflow outside
  `.github/workflows/`, a checkout reached through an expression or an anchor, the numbers'
  sizes, and whether the stop step actually stops anything). Run the file: the synthetic cases
  pass.
- [ ] **1.5** Add the whole-tree cases, copying the pnpm block's ending: `found` built from
  `workflowFiles`; "finds checkouts to check" (`ci.yml`'s count `> 0` and the total `> 0`); and
  "bounds and retries every checkout in every workflow": every entry whose `shape` is not
  `"bounded"` as `` `${name}: job ${job}: ${shape}` ``, expected `[]`, with the message
  `"run each checkout as the three steps in docs/developers/ci-and-gates.md, \"Every checkout is bounded\""`.
  Run it and confirm it FAILS listing 41 entries, all `no time limit` (that is the red proof that
  the case reads the real tree). Update the file's header comment (L31–33) to name "the checkout
  cases" among those reading every .yml file.
- [ ] **1.6** `pnpm exec prettier --check scripts/ci-workflow.test.mjs && pnpm exec eslint scripts/ci-workflow.test.mjs`.
  Commit: `git commit -s` — "Add a guard that refuses a code checkout with no time limit or second
  attempt (A935); it fails on every workflow until they are converted".

## Task 2: convert ci.yml (31 sites)

**Files:** `.github/workflows/ci.yml`.

- [ ] **2.1** Rewrite each of the 31 `      - uses: actions/checkout@v7` steps into the three steps
  in the Mechanism section, carrying any `with:` block (ten sites have `fetch-depth: 0`, starting
  with the `changes` job at L139) onto both attempts unchanged. Keep comments above a site above
  the first attempt. A throwaway rewrite script is fine if it lives outside the worktree (for
  example under `mktemp -d`) and is not committed; read the whole diff afterwards
  (`git diff --stat` and `git diff .github/workflows/ci.yml | grep -c '^+.*uses: actions/checkout@v7'`
  must print 62 — 31 first plus 31 second).
- [ ] **2.2** Add one comment line above the first converted site in the file:
  `# Each checkout is three steps: docs/developers/ci-and-gates.md, "Every checkout is bounded".`
- [ ] **2.3** Run `pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/setup-node-pnpm.test.mjs`
  and `pnpm exec prettier --check .github`. Expected: every case passes except "bounds and
  retries every checkout", which now lists only the 10 sites outside ci.yml. If any other case
  fails, the reader change or a step-order assumption broke it — fix the cause, not the case.
- [ ] **2.4** Commit `-s`: "Bound and retry every code checkout in the main CI workflow (A935)".

## Task 3: convert the other workflows (10 sites) and stale comments

**Files:** `.github/workflows/mutation.yml` (5), `licence.yml` (2, one with `fetch-depth: 0`),
`codeql.yml` (1), `image-smoke.yml` (1), `stripe-sandbox.yml` (1); `scripts/check-signoff.sh`,
`scripts/check-signoff.test.mjs`.

- [ ] **3.1** Same rewrite and pointer comment as Task 2 in each file.
- [ ] **3.2** `scripts/check-signoff.sh` L26–27 and `scripts/check-signoff.test.mjs` L13 say the
  `dco` job "is `actions/checkout` plus one `run:` step". That stops being true. Cut the clause to
  what still holds and matters — the job installs no pnpm and no setup-node — and change nothing
  else in either file.
- [ ] **3.3** Run `pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/setup-node-pnpm.test.mjs scripts/check-signoff.test.mjs`
  — all pass, read the `Tests` counts. Then the deletion proof: remove the stop step at one
  site in `licence.yml`, rerun the file, confirm "bounds and retries every checkout" fails naming
  that job with `leftover git not stopped`; restore the step (`git diff` shows no change to that
  file afterwards). Record the two outputs for the PR.
- [ ] **3.4** `pnpm exec prettier --check .github scripts/check-signoff.sh scripts/check-signoff.test.mjs`.
  Commit `-s`: "Bound and retry the code checkout in the mutation, licence, CodeQL, image smoke
  and Stripe workflows (A935)".

## Task 4: the rule, the receipt and the backlog

**Files:** `CLAUDE.md`, `docs/developers/ci-and-gates.md`, `docs/backlog.md`.

- [ ] **4.1** `docs/developers/ci-and-gates.md`: add `### Every checkout is bounded` directly after
  the "Every pnpm setup is bounded" section and its `####` subsection (before "The image build
  bounds its package installs", around L1354). Content, in plain English, copied from this plan's
  Measured receipts with their run ids, commands and printed lines: the rule and the three steps;
  the incidents table; what the action does, quoting its code with the URLs and lines above; the
  local and CI measurements; the numbers and the worst case (2 + 2 minutes, and the 5-minute-job
  caveat); why not the other shapes; and the guard paragraph — "the checkout cases in
  `scripts/ci-workflow.test.mjs`, weaker than their name: they read every workflow as TEXT and
  never run one; a checkout in a composite action, a called workflow outside `.github/workflows/`,
  or written through an anchor or expression is not seen; they do not judge the numbers, nor
  whether the stop step stops anything." Include Task 3.3's deletion proof and Task 5's CI
  results (fill them in after Task 5; leave a visible `TODO(Task 5)` line until then — Task 5
  removes it).
- [ ] **4.2** `CLAUDE.md` §2: add one bullet directly after the pnpm-setup bullet:

  ```markdown
  - **Every `actions/checkout` runs as three steps: a first attempt under a step `timeout-minutes`
    with git's low-speed limit and `continue-on-error`, a step that stops its leftover git, and a
    second attempt run only when the first failed.** The action retries a fetch that fails but
    waits on one that stalls with no limit of its own. Cost: on 2026-10-20 a `test-dashboard (2)`
    fetch printed nothing for 353 s and `test-server (4)` sat in checkout until its 10-minute
    limit. Guard: the checkout cases in `scripts/ci-workflow.test.mjs`, weaker than their name —
    they read text and never run a workflow. Receipt:
    [ci-and-gates.md](docs/developers/ci-and-gates.md#every-checkout-is-bounded).
  ```

  Then `pnpm exec prettier --check CLAUDE.md` and
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (the anchor must exist; that guard
  skips anchors, so also open the heading and check the slug by hand).
- [ ] **4.3** `docs/backlog.md`: `grep -n A935 docs/backlog.md docs/backlog/` found nothing on the
  base — the item lives only in lane B's queue — so there is no entry to delete. Add short entries
  under "CI, tests and developer tooling" for what stays open:
  - **Other `uses:` steps that fetch over the network have no step time limit.** List them by
    command (for example
    `grep -n -E '^\s*-?\s*uses: (actions/(setup-node|cache|upload-artifact|download-artifact)|docker/|github/codeql-action)' .github/workflows/*.yml`),
    check which already carry a step `timeout-minutes`, and state the property, not a count. Each
    relies on its job's limit alone, as checkout did.
  - **Whether the 2026-10-20 checkout stalls were a GitHub-side incident was not checked**, and in
    which phase they stalled is unknown (the action passes no `--progress`, so its log is silent
    while it waits). On a recurrence, read the new steps' log: a low-speed failure means a transfer
    stall, a step timeout means connect or handshake.
  Check `pnpm exec prettier --file-info docs/backlog.md` (docs are ignored by prettier; this
  prints `"ignored": true`).
- [ ] **4.4** Commit `-s`: "Write down the bounded-checkout rule, its receipts and what it leaves
  open (A935)".

## Task 5: CI controls with the final text, then clean up

Local runs cannot show what the runner does on a step timeout or with `continue-on-error`; only a
run on GitHub can. These controls use the exact three-step text from the converted `lint` job,
changed only where stated.

- [ ] **5.1** From the branch tip, create `probe/a935-final`. Add
  `.github/workflows/probe-a935-final.yml` (`on: push: branches: ["probe/a935-*"]`,
  `permissions: contents: read`, each job `timeout-minutes: 10`) with a first step that starts the
  silent server (copy the "Start a server that accepts and never answers" step from
  `git show 32edde190:.github/workflows/probe-a935.yml`) and then the three steps verbatim, plus a
  report step printing `steps.checkout.outcome`, `git rev-parse HEAD` against `$GITHUB_SHA`,
  `git status --porcelain | wc -l`, and `ps -eo pid,etimes,args | grep '[g]it ' || echo "no git process left"`.
  Two stall jobs, differing only in the first attempt's `with:` (the `normal` job of 5.2 goes in
  the same file, so one push runs all three):
  - `transfer-stall`: `github-server-url: http://127.0.0.1:18081`. Expected: three
    `Operation too slow … the last 20 seconds`, the first attempt failing in about 60–100 s without
    a step timeout, the stop step stopping nothing or the leftover, the second attempt succeeding,
    HEAD equal, no git left. The failing case would be a step timeout at 2 minutes or a red job.
  - `handshake-stall`: `github-server-url: https://127.0.0.1:18081`. Expected:
    `has timed out after 2 minutes`, the stop step printing `stopped git <pid>` lines, the second
    attempt succeeding, HEAD equal, no git left. The failing case would be a red job or a git left
    running.
  The pre-push hook runs; never `--no-verify`. Wait for the run with a blocking loop on
  `gh run view <id> --json status`, read both job logs, and copy the printed lines into the
  ci-and-gates.md section in place of `TODO(Task 5)`.
- [ ] **5.2** Normal-speed control, in the same probe workflow: a third job `normal`, matrix
  `depth: [1, 0]` × `rep: [1, 2, 3, 4, 5]`, running the three steps verbatim with
  `with: fetch-depth: ${{ matrix.depth }}` on both attempts and no server override. Read the
  durations:
  `gh api --paginate "repos/clintongormley/waitron/actions/runs/<id>/jobs?per_page=100" --jq '.jobs[] | . as $j | .steps[] | select(.name|startswith("Check out the code")) | [$j.name, .name, .conclusion, ((.completed_at|fromdate)-(.started_at|fromdate))] | @tsv'`.
  Expected: every second attempt `skipped`, first-attempt seconds in line with the planning probe
  (shallow 9–12, full history 12–19) and the main baseline (median 10, 90th percentile 17). The
  failing case would be a second attempt that ran, or times well above both. Write the figures
  into the ci-and-gates.md section. Later, during `/finish-branch`, the PR's own CI run can be read
  with the same command as a further check; it is not required before the PR exists.
- [ ] **5.3** Delete both probe branches, local and remote:
  `git branch -D probe/a935-final probe/a935-checkout-stall && git push origin --delete probe/a935-final probe/a935-checkout-stall`,
  then `git ls-remote --heads origin 'probe/a935-*'` must print nothing.
- [ ] **5.4** Commit `-s` the filled-in receipt: "Record the bounded checkout's CI controls (A935)".
  Then `/finish-branch` (FULL path).

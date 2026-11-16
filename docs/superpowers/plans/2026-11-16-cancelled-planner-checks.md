# Cancelled planner checks

Goal: cancellation selects neither `lint` nor `root-guards`; ordinary failed `changes` still selects both; `ci` remains strict.
Authority: the Lane I watcher’s 18:10 diagnosis request and 18:25 method clearance in ~/waitron-campaign-i/questions.md, copied to receipts/planner-cancellations-20261116/approved-ask.md; no owner design approval claimed.
> WATCHER 2026-11-16 18:25: “Cleared as you recommend: add `!cancelled()` to the lint and root-guards job conditions, keeping them running after an ordinary changes failure and leaving the aggregate check strict.”
Driver reads/checks this plan and obtains Claude's read before build; no further owner wait within the cleared method. Return material review changes to the watcher.

- [ ] Recheck gate consumers with `rg -n --hidden 'needs\.changes|root-guards|always\(|cancelled\(' .github/workflows scripts .husky docs/developers/ci-and-gates.md`; follow relevant consumers, without speculative guard rewrites.
Current receipts: `.github/workflows/ci.yml:388,474` both use `always() && !inputs.server_probe`; `ci:4192` uses `always()`. Preserve routing, controller, permissions, timeouts and all aggregate logic.
Reuse `scripts/ci-workflow.test.mjs`’s `routingContext` and `jobCondition` directly; `jobCondition` already accepts the cancellation function in context, so change no evaluator/helper. Read the TDD skill before code.
- [ ] Add named test `skips lint and root-guards when workflow and changes are cancelled`: set `context.cancelled = () => true`, `needs.changes.result = "cancelled"`, `server_probe=false`; assert each extracted condition selects false through `jobCondition`; use one case per job.
- [ ] Run `pnpm exec vitest run scripts/ci-workflow.test.mjs -t 'skips lint and root-guards when workflow and changes are cancelled|runs only lint, root-guards, the watchdog and ci after changes failed with outputs set'`; retain the observed cancellation failures (received true, expected false) and passing ordinary-failure controls before editing YAML.
- [ ] Change only the two job conditions to `${{ always() && !cancelled() && !inputs.server_probe }}` (`ci.yml` +2/-2). Retain every assertion; update only the pinned condition string in `run the repo-level Vitest project only in root-guards, including failed classification`.
- [ ] Rerun those named cases green, then `pnpm exec vitest run scripts/ci-workflow.test.mjs`; read the test count and exit status.
Keep unchanged `runs only lint, root-guards, the watchdog and ci after changes failed with outputs set`, `fails when one failed or was cancelled, printing every job before naming it`, and `accepts skipped selected coverage in scoped mode and still refuses failed changes`.
These are local expression/aggregate checks, not observations of GitHub scheduling; ordinary failed-planner behavior is preserved locally.

- [ ] Deliberately include this plan in a signed-off commit; push the candidate through the normal hook. After UPLOAD-RERUN-PROBE and before FIXED-SECRETS-3, perform exactly one manual CI dispatch: `gh workflow run ci.yml --ref <this-feature-ref>` (default `server_probe=false`).
Use the existing hosted non-PR `changes` route. Record the owned run ID, attempt, head SHA, dispatch time and attempt-specific job IDs; bounded polling must observe `changes` queued or in_progress before success, then `gh run cancel <owned-run-id>` immediately; record observation/cancel timestamps.
No probe workflow/input/hold step, filler job, persistent fault hook, routing override or campaign mutation.
- [ ] Retain timestamped pre/post snapshots from `gh api repos/clintongormley/waitron/actions/runs/<run-id>/attempts/<attempt>/jobs --paginate`, plus run identity/conclusion. Require `changes` conclusion cancelled, no lint/root-guards runner assignment (`runner_id` zero or jobs absent) or executed steps, and `ci` not success.
If cancellation lands after planning succeeds, record the attempt as inconclusive and return to the watcher; do not silently dispatch again. Any unmet acceptance condition also returns to the watcher.

- [ ] Update `docs/developers/ci-and-gates.md` with a dated receipt, qualifying its “every CI run except a server_probe dispatch” wording. Keep source proof and hosted observations separate; link the owned run/attempt, IDs, timing and retained evidence.
Add provenance rows quoting the official GitHub status-functions and cancellation documentation for `always()`/`cancelled()`, then narrowly paraphrase; obtain the actual source wording before writing claims. Do not rewrite historical receipts.
Allowed files: `.github/workflows/ci.yml`, small cases/helper injection/pinned-string update in `scripts/ci-workflow.test.mjs`, that gate document and this plan; `docs/backlog.md` only if an existing entry becomes stale, never invent an entry.
Estimate: two implementation lines, tests about 15–25 changed lines, gate docs about 20–35 plus this plan; roughly 60–100 changed physical lines. Growth past 150 gets an outside opinion, not a hard ceiling; material scope changes return to the watcher.
- [ ] Driver runs the already-authorised `finish-branch` for its own small PR, follows its review requirements, and waits for normal PR CI green on the final head; then uses the already-authorised `land-branch`. No extra owner approval for the cleared method.

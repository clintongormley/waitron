# Keep CI on the server when the pnpm cache is slow

## Finish line

Jobs on our disposable runners finish Node setup and reach their checks through the existing
frozen pnpm install. GitHub-hosted jobs still use the existing pnpm cache. Qualify both paths in CI.

## What failed

- [Main 44359772777/1 lint](https://github.com/clintongormley/waitron/actions/runs/44359772777/job/134997963205) reached 92.9% and 97.6% of a 177,466,126-byte archive at the two Node setup deadlines. [PR 44368424650/1 server shard 4](https://github.com/clintongormley/waitron/actions/runs/44368424650/job/135029629291) reached 37.8% twice, with last reported rates of 0.6 and 0.5 MiB/s. The second attempts found Node locally. The four main jobs and 11 PR jobs that reached the second deadline ran no checks.
- That same archive finished at a reported 149.2 MiB/s on [GitHub's shard 10 in the same PR](https://github.com/clintongormley/waitron/actions/runs/44368424650/job/135029629332) and at 6.3 MiB/s on [our server's lint earlier that day](https://github.com/clintongormley/waitron/actions/runs/44279533864/job/134716579091). The 17 retained main archives from 10–17 November span 176.8–177.5 MB. The evidence locates the slowdown on the cache download path to our server. The logs cannot locate the slow link or show whether concurrent guests caused it.
- [setup-node v7.0.0](https://github.com/actions/setup-node/blob/v7.0.0/src/main.ts#L71) awaits the explicit cache restore after setting up Node. GitHub describes [runner.environment](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#runner-context) as “the environment of the runner executing the job.”

## One change

1. In `scripts/ci-workflow.test.mjs`, add the case “restores the pnpm cache only on GitHub-hosted CI runners.” Use `jobBlocks`, `workflowSteps` and `expressionValue` to examine both attempts in each CI job that can run on our server and runs a frozen pnpm install. Assert that the cache input is empty for `self-hosted` and `pnpm` for `github-hosted`. Run `pnpm exec vitest run scripts/ci-workflow.test.mjs -t 'restores the pnpm cache only'` first. The old `pnpm` input fails the self-hosted assertion.
2. In `.github/workflows/ci.yml`, make both explicit `cache` inputs in those jobs select `pnpm` only when `runner.environment == 'github-hosted'` and the empty string otherwise. Reuse the pinned pnpm setup and the frozen install already in the jobs. Keep both Node attempts bounded with identical inputs. Scope this to the CI workflow. Routing, runner images and registry configuration are outside this item.
3. Run the two changed-area guard files, `pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/setup-node-pnpm.test.mjs`, and `actionlint` if available. On the current PR head, retain disposable job logs with successful Node setup, no pnpm archive restore, a frozen install and checks run. Retain a hosted job log showing the archive restore and successful checks. Capture run, attempt, head and runner identities and step durations. If the disposable install fails or takes the job past its limit, keep this open and use that failure to choose the next step.

Record the result beside “Every Node setup is bounded” in `docs/developers/ci-and-gates.md` and cross-reference it from the existing CI incidents material in `docs/backlog/ci.md` if the transfer problem still needs tracking. Expected change is 64 input lines replaced, about 25 test lines and a short evidence note.

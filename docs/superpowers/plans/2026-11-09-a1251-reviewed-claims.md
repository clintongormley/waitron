# A1251 reviewed claims — wording-only plan

**Outcome:** Remove two unsupported statements above `recordSubstitution` and make the demo test title match its stored-description assertion. Staff behavior stays unchanged. Lane F RUNNER’s driver implements inline only after Claude reads this plan and the watcher approves.

**Authority (campaign notes supplied by the watcher):**

> watcher2026-11-09 11:25, A1251 #1986: "Accepted: #1986 is reviewed with no introduced code defect ... delete them ... on the A1251 fix branch, batched with any other A1251 findings so it is one pull request and one CI run ... Check the deletion with node scripts/comments-only.mjs <base>. Not part of A790."

> Watcher2026-11-09 11:46, A1251 #2011: "Yes: keep the direct stored-description assertion, shorten its title to "stores an English operation description", and batch it with the two #1986 comment deletions on the one A1251 fix branch. No new guard."

**Exact scope and order (five files):**

1. In `packages/core/src/record-substitution.ts:57–60`, delete the entire two-line JSDoc and its delimiters immediately above `recordSubstitution`: the customer-already-paid statement and the failed-integrity-proceeds-anyway statement. Add no replacement prose; leave executable code unchanged.
2. Make a signed-off intermediate commit containing only that deletion, optionally with Markdown. At that committed HEAD, capture its explicit parent SHA and check the deletion **before editing or committing the title**:
   ```sh
   BASE=$(git rev-parse HEAD^)
   node scripts/comments-only.mjs "$BASE"
   ```
   Record the expanded SHA and successful result. This command compares committed changes only and does not inspect changed Markdown; it cannot establish the later title-only change.
3. In `apps/server/scripts/demo-seed/testing/provision-venue.test.ts:13`, rename only the first title from `stores an English operation description for the Spanish practice venue` to `stores an English operation description`. Keep every assertion and fixture unchanged.
4. Update only the existing A1251 text in `docs/backlog.md` and `docs/backlog/ci.md` to record these three completed wording corrections. Retain the unfinished historical audit and every outstanding finding. Keep this plan at `docs/superpowers/plans/2026-11-09-a1251-reviewed-claims.md` as the fifth file; sign off the subsequent commit too.

**Changed-line estimate:** Production source: 4 comment lines deleted, 0 executable lines. Tests: 1 line replaced (−1/+1), 0 assertion/fixture changes. Documentation: roughly 45–55 added lines across the two existing A1251 entries and this plan.

**Focused verification, after the edits (from the repository root):**

```sh
pnpm --filter @waitron/core test src/record-substitution.test.ts &&
pnpm --filter @waitron/server test scripts/demo-seed/testing/provision-venue.test.ts &&
pnpm --filter @waitron/fiscal-verifactu test src/write-path.e2e.test.ts src/inmutabilidad.test.ts --project node
p=apps/server/scripts/demo-seed/testing/provision-venue.test.ts
git show "$BASE:$p" | sed 's/stores an English operation description for the Spanish practice venue/stores an English operation description/' | cmp - "$p"
```

Require successful exits and nonzero passing test counts for each selected suite; `cmp` must report byte equality after the exact title substitution. Inspect the complete five-file diff, including Markdown. Keep both fiscal protection suites byte-identical to the base.

**Omissions:** No behavior change, fiscal implementation/test edits, `CLAUDE.md` edits, new spec, guard, test case or regression test; no whole-package suites, A790 work, or completion claim for the remaining historical audit.

**Finish line:** Maintainers no longer read the two unsupported statements, the title matches its actual assertion, and the focused checks pass with assertions/fixtures preserved. Then complete `finish-branch`, including the full Claude run-it review, normal push hook and successful current-head CI, in one pull request and one CI run. Land only through owner-authorized `land-branch`.

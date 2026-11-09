# A1251 reviewed claims — wording-only plan

**Outcome:** Remove two overbroad comments above `recordSubstitution` and make one demo test title match its assertion. Staff behavior stays unchanged. Implement inline after Claude reads this plan and the watcher approves it.

**Authority:** Lane F `questions.md` has these watcher answers, quoted because campaign files are outside this checkout:

> WATCHER 2026-11-09 11:25 — A1251 #1986: Accepted: #1986 is reviewed with no introduced code defect, and the standing owner instructions you found (pruning sweeps, 2026-09-23; English only) are its authority — cite them in the receipt. The two retained over-claiming comments are not left for "claims maintenance": per the fix-loose-ends rule, delete them (prefer deleting to rewording, CLAUDE.md §1) on the A1251 fix branch, batched with any other A1251 findings so it is one pull request and one CI run, not one per old PR. Check the deletion with node scripts/comments-only.mjs <base>. Not part of A790.

> WATCHER 2026-11-09 11:46 — A1251 #2011: Yes: keep the direct stored-description assertion, shorten its title to "stores an English operation description", and batch it with the two #1986 comment deletions on the one A1251 fix branch. No new guard.

**Approval:** Watcher 2026-11-09 12:05 approved `3986199c85` as written, added only deletion of “in its header and” from `docs/backlog/fiscal.md:857`, retained #2006's existing tests without extra instrumentation, and specified no further plan read. One pull request for the batch.

**Files and steps (four files, including this plan):**

1. Delete only the JSDoc and its delimiters at `packages/core/src/record-substitution.ts:57–60`. Add no replacement. Sign off a commit containing only that source deletion, capture its parent SHA, and run `node scripts/comments-only.mjs <literal-parent-SHA>` before changing the title. It compares committed source changes and skips Markdown.
2. At `apps/server/scripts/demo-seed/testing/provision-venue.test.ts:13`, change only `stores an English operation description for the Spanish practice venue` to `stores an English operation description`. Keep every assertion and fixture.
3. In `docs/backlog/fiscal.md:857`, delete only “in its header and”; keep the README reference and every A888 check. Inspect the whole diff, sign off the title commit, and run the checks below. Existing A1251 backlog entries retain unfinished audit work. Record completed corrections in the commit/PR, not the backlog.

**Size:** Production source: 4 comment lines removed, 0 executable lines. Tests: 1 line replaced (−1/+1), 0 assertions/fixtures changed. Documentation: this plan, about 35 lines, and one short phrase removed. No generated files.

**Verification:** Run commands separately and check each exit status and nonzero test count. Run `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/testing/provision-venue.test.ts`. Retain Lane F H2’s unchanged fiscal protection pair with `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`; these protect recording behavior, not prose. The comments-only result proves executable tokens unchanged. Check the title against the literal branch baseline, not an unset shell variable:

```sh
python3 - <<'CHECK'
import subprocess
from pathlib import Path
p = "apps/server/scripts/demo-seed/testing/provision-venue.test.ts"
before = subprocess.check_output(["git", "show", "650929c73215f62ef5a8f0c21b2be581bd30ab4c:" + p])
old = b"stores an English operation description for the Spanish practice venue"
assert before.count(old) == 1
assert Path(p).read_bytes() == before.replace(old, b"stores an English operation description")
CHECK
```

**Omissions and finish line:** No runtime, fiscal implementation/test, assertion, fixture, `CLAUDE.md`, new guard, new test, A790 or other audit repair changes; no whole-package tests. Maintainers lose the two overbroad comments and get an accurate test title. Complete `finish-branch` with one full Claude run-it review, the normal hook and current-head CI, then the owner-authorized `land-branch`. This does not finish the remaining A1251 audit.

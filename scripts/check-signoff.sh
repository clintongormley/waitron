#!/usr/bin/env sh
# The sign-off (DCO) predicate and the walk over a push's commits — the one copy, called by both
# gates: `.husky/pre-push`'s `check_signoff` and `.github/workflows/licence.yml`'s `dco` job. Each
# kept its own byte-identical `grep -qiE '^Signed-off-by: .+ <.+@.+>'` and its own loop until
# 2026-08-01. The two agreeing is the whole point of the check, and two copies is not how that is
# kept true.
#
# CONTRACT
#
#   stdin    commit shas, one per line. Blank lines are skipped, so a caller may hand over a list
#            it built with `printf '%s\n%s'` (the hook's, which starts with an empty line).
#   stdout   one line per commit MISSING a trailer, as `git log -1 --oneline` renders it — or the
#            bare sha when this checkout does not have that commit. Nothing else ever, because
#            both callers wrap these lines in their own reporting: `::error::` annotations in CI,
#            an indented list in the hook.
#   stderr   git's own, undisguised, for the second call only (see below).
#   exit     1 if any commit is missing a trailer, 0 otherwise.
#
# What is NOT here is the range: CI diffs a pull request (`git rev-list "$BASE_SHA".."$HEAD_SHA"`)
# while the hook accumulates one range per pushed ref and has already computed the list by the time
# it gets here. Those are genuinely different questions, and the reporting is different too — this
# file is the predicate and the walk, which is the part that has to agree.
#
# Shell rather than node, decided on how the callers invoke it. The hook runs this step FIRST,
# before `pnpm install` and before the classifier, and its header carries the run proving it works
# with no node on PATH; licence.yml's `dco` job is `actions/checkout` plus one `run:` step, with no
# pnpm and no setup-node, and it produces a REQUIRED status check. A node script would put an
# interpreter under both of those. Tested by scripts/check-signoff.test.mjs, which spawns this file
# the way both callers do, against throwaway git repositories.
missing=0

# `|| [ -n "$sha" ]` so a final line with no trailing newline is still processed: `read` returns
# non-zero at EOF but has already assigned what it read.
while read -r sha || [ -n "$sha" ]; do
  [ -n "$sha" ] || continue

  # `</dev/null` so neither git call can consume the sha list this loop is reading from stdin, and
  # `2>/dev/null` because this call is EXPECTED to fail for a sha the checkout does not have — the
  # failure is handled below by reporting the commit rather than by explaining it twice.
  if git log -1 --format=%B "$sha" </dev/null 2>/dev/null | grep -qiE '^Signed-off-by: .+ <.+@.+>'; then
    continue
  fi

  # Stderr is NOT discarded here. By the time a commit reaches this line it has already failed the
  # predicate, so in the ordinary case this call succeeds; when it fails, git's own `fatal: bad
  # object …` is the only thing that tells a reader the range was wrong rather than the commit
  # unsigned. The bare sha still goes to stdout so the machine-readable stream stays complete.
  git log -1 --oneline "$sha" </dev/null || echo "$sha"
  missing=1
done

exit "$missing"

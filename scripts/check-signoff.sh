#!/usr/bin/env sh
# stdout is consumed by both gates: report only commits missing a sign-off, one per line.
missing=0

# `|| [ -n "$sha" ]` so a final line with no trailing newline is still processed: `read` returns
# non-zero at EOF but has already assigned what it read.
while read -r sha || [ -n "$sha" ]; do
  [ -n "$sha" ] || continue

  if git log -1 --format=%B "$sha" </dev/null 2>/dev/null | grep -qiE '^Signed-off-by: .+ <.+@.+>'; then
    continue
  fi

  # Keep git's error on stderr so an unknown commit is distinguishable from an unsigned one.
  git log -1 --oneline "$sha" </dev/null || echo "$sha"
  missing=1
done

exit "$missing"

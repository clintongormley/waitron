#!/usr/bin/env sh
# Decides whether the commit being published may move the `:main` image tag. Called by the `publish`
# job in `.github/workflows/ci.yml`; the guard suite is `scripts/main-tag-guard.test.mjs`, which
# runs this script for real against stubbed `docker` and `gh`.
#
# WHY IT EXISTS. Every push to `main` now runs in a concurrency group of its own (ci.yml's
# `concurrency:` block), so two merges landing close together are built at the same time and the
# run that finishes LAST is not always the one carrying the newest commit. A registry tag is
# last-write-wins, so without this check the older run retags `:main` and every box following that
# tag is pulled backwards onto an older image. The immutable `sha-` tag is never affected: it names
# one commit and is always published.
#
# CONTRACT
#
#   argv     <image-ref> <repository> <sha>  — the `:main` tag to inspect, the `owner/name` of the
#            GitHub repository, and the commit being published.
#   stdout   `move` (this commit may take the tag) or `hold` (a newer commit already has it).
#   exit     0 with a decision; non-zero with a message on stderr when it cannot reach one.
#
# It fails rather than guessing. A publish that stops is repaired by the next merge to `main`; a
# `:main` moved the wrong way is noticed by nobody.
set -eu

IMAGE=${1:-}
REPOSITORY=${2:-}
SHA=${3:-}

if [ -z "$IMAGE" ] || [ -z "$REPOSITORY" ] || [ -z "$SHA" ]; then
  echo "usage: main-tag-guard.sh <image-ref> <repository> <sha>" >&2
  exit 2
fi

# The image's own environment, one `NAME=value` per line — buildx's Go template rather than JSON so
# the script needs no parser. A tag nothing has published yet is the first publish, not a failure;
# any OTHER registry error is one, and is passed through.
errors=$(mktemp)
if published_env=$(docker buildx imagetools inspect "$IMAGE" \
  --format '{{range .Image.Config.Env}}{{println .}}{{end}}' 2>"$errors"); then
  :
elif grep -qiE 'not found|manifest unknown|manifest_unknown' "$errors"; then
  echo move
  exit 0
else
  cat "$errors" >&2
  exit 1
fi

published=$(printf '%s\n' "$published_env" | sed -n 's/^WAITRON_BUILD_ID=//p' | head -1)
if [ -z "$published" ]; then
  echo "$IMAGE carries no WAITRON_BUILD_ID, so the commit it was built from is unknown" >&2
  exit 1
fi

if [ "$published" = "$SHA" ]; then
  echo move
  exit 0
fi

# GitHub reports the SECOND commit's position relative to the first, so the published commit goes
# first: `behind` means the commit being published is the older of the two.
status=$(gh api "repos/$REPOSITORY/compare/$published...$SHA" --jq .status)
case "$status" in
  behind) echo hold ;;
  ahead | identical | diverged) echo move ;;
  *)
    echo "cannot place $SHA against the published $published: git comparison said '$status'" >&2
    exit 1
    ;;
esac

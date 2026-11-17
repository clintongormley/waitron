#!/usr/bin/env sh
# This pre-build check is not a registry compare-and-swap; simultaneous publishes remain
# last-write-wins.
set -eu

IMAGE=${1:-}
REPOSITORY=${2:-}
SHA=${3:-}

if [ -z "$IMAGE" ] || [ -z "$REPOSITORY" ] || [ -z "$SHA" ]; then
  echo "usage: main-tag-guard.sh <image-ref> <repository> <sha>" >&2
  exit 2
fi

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT

hand_back() {
  if [ -n "${MAIN_TAG_GUARD_ENV_OUT:-}" ]; then
    printf '%s' "$published_env" >"$MAIN_TAG_GUARD_ENV_OUT"
  fi
}

read_status=0
published_env=$("$(dirname "$0")/published-image-env.sh" "$IMAGE") || read_status=$?
case "$read_status" in
  0) hand_back ;;
  3)
    published_env=
    hand_back
    echo move
    exit 0
    ;;
  *) exit 1 ;;
esac

published=$(printf '%s\n' "$published_env" | sed -n 's/^WAITRON_BUILD_ID=//p' | head -1)
if [ -z "$published" ]; then
  echo "$IMAGE carries no WAITRON_BUILD_ID, so the commit it was built from is unknown" >&2
  exit 1
fi

if [ "$published" = "$SHA" ]; then
  echo move
  exit 0
fi

# GitHub compares the second commit against the first; `behind` means this publish is older.
if ! status=$(gh api "repos/$REPOSITORY/compare/$published...$SHA" --jq .status 2>"$errors"); then
  cat "$errors" >&2
  echo "cannot place $SHA against the published $published - see above" >&2
  exit 1
fi

case "$status" in
  behind) echo hold ;;
  ahead | identical | diverged) echo move ;;
  *)
    echo "cannot place $SHA against the published $published: git comparison said '$status'" >&2
    exit 1
    ;;
esac

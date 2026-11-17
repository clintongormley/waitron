#!/usr/bin/env sh
set -eu

IMAGE=${1:-}
if [ -z "$IMAGE" ]; then
  echo "usage: published-image-env.sh <image-ref>" >&2
  exit 2
fi

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT

# Match the image-specific absence: a bare "not found" can also mean a broken credential
# helper, a proxy failure or a missing docker binary.
if docker buildx imagetools inspect "$IMAGE" \
  --format '{{range .Image.Config.Env}}{{println .}}{{end}}' 2>"$errors"; then
  exit 0
elif grep -qF "$IMAGE: not found" "$errors"; then
  cat "$errors" >&2
  exit 3
else
  cat "$errors" >&2
  exit 1
fi

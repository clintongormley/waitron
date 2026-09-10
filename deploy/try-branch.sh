#!/usr/bin/env bash
#
# Build and run a Waitron branch's image on this box, to test a PR before it merges:
#
#   deploy/try-branch.sh <branch-or-ref> [extra docker build args…]
#   curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/try-branch.sh | sudo bash -s -- <branch-or-ref>
#
# CI does not publish an image for a pull request (only pushes to main and version tags publish to
# GHCR), so there is no PR image to pull — this builds it. Docker fetches the branch itself as the
# build context, so the box needs no checkout and no pnpm; only a git ref that exists on the public
# repo (a PR branch, or a commit SHA).
#
# It leaves the box's .env alone: WAITRON_IMAGE is set inline on the compose command, overriding
# compose.yml's default for this run only. A plain `docker compose up -d` afterwards drops back to
# whatever .env selects (the published image by default). WAITRON_DIR points at the box's compose
# file, matching prepare.sh; add `sudo` if your user is not in the docker group.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "try-branch.sh: usage: try-branch.sh <branch-or-ref> [docker build args…]" >&2
  exit 2
fi

REF=$1
shift
WAITRON_DIR="${WAITRON_DIR:-/opt/waitron}"
# Tag named after the ref: non-tag-safe characters become dashes, and it is capped to a valid length
# — a Docker tag is at most 128 chars, so a long branch name would otherwise be rejected. You test
# one ref at a time, so reusing a tag is fine; a rebuild overwrites it.
safe="${REF//[^A-Za-z0-9._-]/-}"
TAG="waitron:${safe:0:100}"

docker build -t "$TAG" -f deploy/Dockerfile "$@" "https://github.com/clintongormley/waitron.git#${REF}"

WAITRON_IMAGE="$TAG" docker compose -f "$WAITRON_DIR/compose.yml" up -d

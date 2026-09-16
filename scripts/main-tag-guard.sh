#!/usr/bin/env sh
# Decides whether the commit being published may take the `:main` image tag. Called by the `publish`
# job in `.github/workflows/ci.yml`; the guard suite is `scripts/main-tag-guard.test.mjs`, which
# runs this script for real against a stubbed `docker` and `gh`.
#
# WHY IT EXISTS. Every push to `main` now runs in a concurrency group of its own (ci.yml's
# `concurrency:` block), so two merges landing close together build at the same time and the run
# that finishes LAST is not always the one carrying the newest commit. A registry tag is
# last-write-wins, so the older run would retag `:main` and pull every box following that tag back
# onto an older image. The immutable `sha-` tag is never affected: it names one commit and is always
# published.
#
# WHAT IT DOES NOT BUY. This is a question asked before the build, not a compare-and-swap at the
# registry. It covers the case this repository actually hits — a newer run that has ALREADY
# published — and not two publishes in flight at the same instant, which remain last-write-wins.
#
# CONTRACT
#
#   argv     <image-ref> <repository> <sha>  — the APP image's `:main` tag (the print-agent image
#            carries no build id of its own, so it is tagged on this same decision), the `owner/name`
#            of the GitHub repository, and the commit being published.
#   stdout   `move` (this commit may take the tag) or `hold` (a newer commit already has it).
#   exit     0 with a decision; non-zero with a message on stderr when it cannot reach one.
#
# It fails rather than guessing. For a transient registry error the next merge repairs it. Two
# states are NOT self-repairing and need a person: a `:main` carrying no `WAITRON_BUILD_ID`, and one
# built from a commit this repository's history does not contain (an image built outside CI, or a
# rewritten history). Both wedge every later publish identically until `:main` is deleted or retagged
# by hand. Publishing stops; the `sha-` tags keep coming.
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

# The image's own environment, one `NAME=value` per line — buildx's Go template rather than JSON, so
# the script needs no parser. Verified against the real published image on 2026-09-16:
# `docker buildx imagetools inspect ghcr.io/clintongormley/waitron:main --format
# '{{range .Image.Config.Env}}{{println .}}{{end}}'` printed 15 lines including
# `WAITRON_BUILD_ID=1c57940…`, anonymously, on an index carrying a provenance attestation.
#
# A tag nothing has published yet is the first publish, not a failure. The match is the exact wording
# buildx gives for that one case (`ERROR: <ref>: not found`, same command, same day) and nothing
# wider: `not found` on its own also appears in a missing credential helper, a proxy's 404 page and
# a missing `docker` binary, and reading any of those as "no tag yet" would publish the backwards
# tag this script exists to prevent. Anything else, including the `403 Forbidden` GHCR answers for a
# package that does not exist at all, stops the publish and prints the registry's own words.
if published_env=$(docker buildx imagetools inspect "$IMAGE" \
  --format '{{range .Image.Config.Env}}{{println .}}{{end}}' 2>"$errors"); then
  :
elif grep -qF "$IMAGE: not found" "$errors"; then
  cat "$errors" >&2
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

#!/usr/bin/env sh
# Reads a published image's environment off the registry. The one registry read the `publish` job in
# `.github/workflows/ci.yml` makes of `:main`: `scripts/main-tag-guard.sh` calls it on a nightly or
# manual run on main, and the tags step calls it directly on a release tag. Its suite is in
# `scripts/main-tag-guard.test.mjs`, against a stubbed `docker`.
#
# CONTRACT
#
#   argv     <image-ref>
#   stdout   the image's environment, one `NAME=value` per line.
#   exit     0 with the environment; 3 when nothing is published under the ref yet, when this
#            script prints nothing to stdout itself (`docker`'s own stdout passes through
#            uncleared); any other non-zero, with the registry's own words on stderr, when it cannot
#            read.
set -eu

IMAGE=${1:-}
if [ -z "$IMAGE" ]; then
  echo "usage: published-image-env.sh <image-ref>" >&2
  exit 2
fi

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT

# buildx's Go template rather than JSON, so no parser is needed. Verified against the real published
# image on 2026-09-16: `docker buildx imagetools inspect ghcr.io/clintongormley/waitron:main --format
# '{{range .Image.Config.Env}}{{println .}}{{end}}'` printed 15 lines including
# `WAITRON_BUILD_ID=1c57940…`, anonymously, on an index carrying a provenance attestation.
#
# A tag nothing has published yet is the first publish, not a failure. The match is the exact wording
# buildx gives for that one case (`ERROR: <ref>: not found`, same command, same day) and nothing
# wider: `not found` on its own also appears in a missing credential helper, a proxy's 404 page and
# a missing `docker` binary, and reading any of those as "no tag yet" would publish the backwards
# tag main-tag-guard.sh exists to prevent. Anything else, including the `403 Forbidden` GHCR answers
# for a package that does not exist at all, is a failure that prints the registry's own words.
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

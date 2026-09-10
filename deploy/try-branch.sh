#!/usr/bin/env bash
#
# Build and run a Waitron branch's image on this box, to test a PR before it merges:
#
#   deploy/try-branch.sh <branch-or-ref> [extra docker build args…]
#   curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/try-branch.sh | sudo bash -s -- <branch-or-ref>
#
# CI does not publish an image for a pull request (only pushes to main and version tags publish to
# GHCR), so there is no PR image to pull — this builds both the app image and the print-agent image
# from the same Dockerfile. Docker fetches the branch itself as the build context, so the box needs
# no checkout and no pnpm; only a git ref that exists on the public repo (a PR branch, or a commit
# SHA).
#
# It leaves the box's .env alone: WAITRON_IMAGE and WAITRON_PRINT_AGENT_IMAGE are set inline on the
# compose command, overriding compose.yml's defaults for this run only. A plain `docker compose up -d`
# afterwards drops back to whatever .env selects (the published images by default). WAITRON_DIR points
# at the box's compose file, matching prepare.sh; add `sudo` if your user is not in the docker group.
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

AGENT_TAG="waitron-print-agent:${safe:0:100}"

# It cannot tell whether this ref carries a migration — the branch's files are not on the box until
# the build fetches them — so it warns every time. A migration-carrying branch migrates the box's
# live database ONE WAY: there is no backward migration, and a plain `docker compose up -d` back to
# :main afterwards may then fail to boot with `provisioning.database_ahead`, whose only fix is a
# restore from backup or a reinstall. A demo box's data is disposable; a real venue's is not.
cat >&2 <<'WARNING'
try-branch.sh: this migrates the box's live database ONE WAY.

  If this branch carries a database migration, running it changes the box's database in a way
  that going back to the published image cannot undo. The box may then refuse to boot, and the
  only fix is restoring from a backup or reinstalling.

  Safe on a demo box. On a box holding a real venue's records, take a backup first.

WARNING

docker build -t "$TAG" -f deploy/Dockerfile "$@" "https://github.com/clintongormley/waitron.git#${REF}"
docker build -t "$AGENT_TAG" -f deploy/Dockerfile --target print-agent "$@" "https://github.com/clintongormley/waitron.git#${REF}"

# Both image vars set on ONE line with the compose up — NOT split with a `\` continuation. The guard
# scripts/deploy-image-env.test.ts asserts `WAITRON_IMAGE=…docker compose…up` with a single-line regex
# (`[^\n]*`), which a line break would fail (preflight ruling, 2026-09-10).
WAITRON_IMAGE="$TAG" WAITRON_PRINT_AGENT_IMAGE="$AGENT_TAG" docker compose -f "$WAITRON_DIR/compose.yml" up -d

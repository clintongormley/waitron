#!/usr/bin/env bash
#
# Run-from-the-web bootstrap for a Waitron box:
#
#   curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/install.sh | sudo bash
#
# It downloads prepare.sh and the files prepare.sh copies out of its own directory, then hands off to
# prepare.sh — which owns Docker install, the box's POSTGRES_PASSWORD, and starting the containers.
# Nothing here is duplicated from prepare.sh; keep it a thin fetch-and-hand-off wrapper.
#
# WAITRON_REF pins the revision (a tag or commit) instead of tracking main — the honest default while
# the repo has no release tags. WAITRON_DIR and every other prepare.sh variable pass straight through
# the environment to the child process, so `sudo WAITRON_DIR=/srv/waitron bash` works unchanged.
set -euo pipefail

REF="${WAITRON_REF:-main}"
BASE_URL="https://raw.githubusercontent.com/clintongormley/waitron/${REF}/deploy"

# The set prepare.sh needs beside itself: prepare.sh plus the two files it copies into WAITRON_DIR.
# scripts/deploy-image-env.test.ts pins this list against prepare.sh's own `cp`s so the two cannot
# drift.
FILES=(prepare.sh compose.yml .env.example)

# curl is preferred (the documented one-liner uses it); wget is the fallback a minimal Debian may
# ship instead. Neither present is a clear failure, not a half-staged directory.
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  echo "install.sh: need curl or wget to download the box files — install one and re-run" >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

for file in "${FILES[@]}"; do
  fetch "${BASE_URL}/${file}" "${STAGE_DIR}/${file}"
done
chmod +x "${STAGE_DIR}/prepare.sh"

bash "${STAGE_DIR}/prepare.sh"

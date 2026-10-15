#!/usr/bin/env bash
# Installs the pnpm that package.json's packageManager names, each attempt under a time limit,
# three attempts. Why not pnpm/action-setup: docs/developers/ci-and-gates.md#every-pnpm-setup-is-bounded
# Called by every workflow's "Set up pnpm" step; its suite is scripts/ci-setup-pnpm.test.mjs.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"

manager="$(node -p 'require(process.argv[1]).packageManager ?? ""' "$repo/package.json")"
if [[ ! "$manager" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+(\+.*)?$ ]]; then
  echo "package.json packageManager must be pnpm@<major>.<minor>.<patch>, got: '$manager'" >&2
  exit 1
fi
version="${manager#pnpm@}"
version="${version%%+*}"

for name in RUNNER_TEMP GITHUB_PATH; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name must be set and non-empty" >&2
    exit 1
  fi
done

positive_seconds() {
  local name="$1" default="$2" value="${!1:-}"
  [[ -z "$value" ]] && value="$default"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "$name must be a positive whole number of seconds, got: '$value'" >&2
    return 1
  fi
  printf '%s' "$value"
}
bound="$(positive_seconds PNPM_SETUP_ATTEMPT_SECONDS 60)"
kill_grace="$(positive_seconds PNPM_SETUP_KILL_SECONDS 10)"
version_bound="$(positive_seconds PNPM_SETUP_VERSION_SECONDS 10)"

TIMEOUT="$(command -v gtimeout || command -v timeout || true)"
if [[ -z "$TIMEOUT" ]]; then
  echo "neither gtimeout nor timeout is on PATH" >&2
  exit 1
fi

prefix="$RUNNER_TEMP/pnpm-setup"
for attempt in 1 2 3; do
  rm -rf "$prefix"
  if "$TIMEOUT" -k "$kill_grace" "$bound" \
    npm install --global --prefix "$prefix" --no-audit --no-fund "pnpm@$version" &&
    actual="$("$TIMEOUT" -k 2 "$version_bound" "$prefix/bin/pnpm" --version)" &&
    [[ "$actual" == "$version" ]]; then
    echo "$prefix/bin" >>"$GITHUB_PATH"
    echo "pnpm $version installed on attempt $attempt of 3"
    exit 0
  fi
  echo "attempt $attempt of 3 failed or stalled: npm install pnpm@$version" >&2
done
echo "pnpm setup failed or stalled on all 3 attempts" >&2
exit 1

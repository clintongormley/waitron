#!/usr/bin/env bash
# Installs the pnpm that package.json's packageManager names, each attempt under a time limit,
# three attempts. Why not pnpm/action-setup: docs/developers/ci-and-gates.md#every-pnpm-setup-is-bounded
set -euo pipefail

echo "pnpm setup: start" >&2

repo="$(cd "$(dirname "$0")/.." && pwd)"

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
read_bound="$(positive_seconds PNPM_SETUP_READ_SECONDS 10)"

# GNU's first: uutils' timeout sends its forced kill to its child alone.
# docs/developers/ci-and-gates.md#every-pnpm-setup-is-bounded
TIMEOUT="$(command -v gnutimeout || command -v gtimeout || command -v timeout || true)"
if [[ -z "$TIMEOUT" ]]; then
  echo "none of gnutimeout, gtimeout or timeout is on PATH" >&2
  exit 1
fi

run_bounded() {
  local phase="$1" seconds="$2" grace="$3" started=$SECONDS status
  shift 3
  printf '%s: start limit=%ss kill-after=%ss command=' "$phase" "$seconds" "$grace" >&2
  printf '%q ' "$@" >&2
  printf '\n' >&2
  if "$TIMEOUT" -k "$grace" "$seconds" "$@"; then
    status=0
  else
    status=$?
  fi
  echo "$phase: end status=$status elapsed=$((SECONDS - started))s" >&2
  return "$status"
}

if ! manager="$(run_bounded "packageManager read" "$read_bound" 2 \
  sed -nE 's/.*"packageManager"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$repo/package.json")"; then
  exit 1
fi
if [[ ! "$manager" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+(\+.*)?$ ]]; then
  echo "package.json packageManager must be pnpm@<major>.<minor>.<patch>, got: '$manager'" >&2
  exit 1
fi
version="${manager#pnpm@}"
version="${version%%+*}"

prefix="$RUNNER_TEMP/pnpm-setup"
for attempt in 1 2 3; do
  echo "attempt $attempt/3 cleanup: start command=rm -rf pnpm-setup" >&2
  rm -rf "$prefix"
  echo "attempt $attempt/3 cleanup: end status=0" >&2
  if run_bounded "attempt $attempt/3 install" "$bound" "$kill_grace" \
    npm install --global --prefix "$prefix" --no-audit --no-fund "pnpm@$version" &&
    actual="$(run_bounded "attempt $attempt/3 version" "$version_bound" 2 "$prefix/bin/pnpm" --version)"; then
    if [[ "$actual" == "$version" ]]; then
      echo "$prefix/bin" >>"$GITHUB_PATH"
      echo "pnpm $version installed on attempt $attempt of 3"
      exit 0
    fi
    echo "attempt $attempt/3 version mismatch: expected $version, got $actual" >&2
  fi
  echo "attempt $attempt of 3 failed or stalled: npm install pnpm@$version" >&2
done
echo "pnpm setup failed or stalled on all 3 attempts" >&2
exit 1

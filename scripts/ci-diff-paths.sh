#!/usr/bin/env bash
set -euo pipefail

diff_paths() {
  local paths
  if ! paths=$(git diff --no-renames --name-only "$@"); then
    echo "cannot diff the main CI baseline or PR range: using global change scope" >&2
    return
  fi
  if [[ ${#paths} -gt 131072 ]] || printf '%s\n' "$paths" | LC_ALL=C grep -q '[^A-Za-z0-9._/-]'; then
    echo "unsafe or oversized changed paths: using global change scope" >&2
    return
  fi
  printf '%s\n' "$paths"
}

if [[ "$EVENT" == pull_request ]]; then
  if ! git fetch --no-tags origin "$BASE_REF"; then
    echo "cannot fetch the PR base: using global change scope" >&2
    exit
  fi
  diff_paths "origin/$BASE_REF...HEAD"
  exit
fi

# Empty output selects global change scope; the workflow decides which checks run.
if [[ "$EVENT" != push || "$REF" != refs/heads/main ]]; then
  echo "manual recovery or release ref: using global change scope" >&2
  exit
fi

deadline=$(command -v gnutimeout || command -v gtimeout || command -v timeout || true)
if [[ -z "$deadline" ]]; then
  echo "no timeout command: using global change scope" >&2
  exit
fi
if ! candidates=$("$deadline" -k 5 30 gh api \
  "repos/$REPOSITORY/actions/workflows/ci.yml/runs?branch=main&per_page=100" \
  --jq '.workflow_runs[] | select(.head_branch == "main" and (.event == "push" or .event == "schedule" or .event == "workflow_dispatch") and .status == "completed" and .conclusion == "success") | .head_sha'); then
  echo "cannot read main CI runs: using global change scope" >&2
  exit
fi

baseline=""
while IFS= read -r candidate; do
  [[ "$candidate" =~ ^[0-9a-f]{40}$ && "$candidate" != "$SHA" ]] || continue
  if git merge-base --is-ancestor "$candidate" "$SHA" 2>/dev/null; then
    if [[ -z "$baseline" ]] || git merge-base --is-ancestor "$baseline" "$candidate" 2>/dev/null; then
      baseline="$candidate"
    fi
  fi
done <<< "$candidates"

if [[ -n "$baseline" ]]; then
  echo "main CI baseline: $baseline" >&2
  diff_paths "$baseline" "$SHA"
else
  echo "no eligible ancestor in the latest 100 main CI runs: using global change scope" >&2
fi

#!/usr/bin/env bash
set -euo pipefail

if [[ "$EVENT" == pull_request ]]; then
  git fetch --no-tags origin "$BASE_REF"
  git diff --name-only "origin/$BASE_REF...HEAD"
  exit
fi

# Empty output makes the classifier run every package and the image.
if [[ "$EVENT" != push || "$REF" != refs/heads/main ]]; then
  echo "manual recovery or release ref: running everything" >&2
  exit
fi

# Missing or refused main runs cannot own the earlier code range.
deadline=$(command -v gtimeout || command -v timeout || true)
if [[ -z "$deadline" ]]; then
  echo "no timeout command: running everything" >&2
  exit
fi
if ! candidates=$("$deadline" -k 5 30 gh api \
  "repos/$REPOSITORY/actions/workflows/ci.yml/runs?branch=main&per_page=100" \
  --jq '.workflow_runs[] | select(.head_branch == "main" and (.event == "push" or .event == "workflow_dispatch") and ((.status == "completed" and .conclusion == "success") or ((.status == "queued" or .status == "in_progress") and .conclusion == null))) | .head_sha'); then
  echo "cannot read main CI runs: running everything" >&2
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
  if ! git diff --name-only "$baseline" "$SHA"; then
    echo "cannot diff the main CI baseline" >&2
    exit 1
  fi
else
  echo "no eligible ancestor in the latest 100 main CI runs: running everything" >&2
fi

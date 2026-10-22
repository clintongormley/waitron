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

# A later docs push must include code whose earlier CI run was lost or has not succeeded.
deadline=$(command -v gtimeout || command -v timeout || true)
if [[ -z "$deadline" ]]; then
  echo "no timeout command: running everything" >&2
  exit
fi
if ! candidates=$("$deadline" -k 5 30 gh api \
  "repos/$REPOSITORY/actions/workflows/ci.yml/runs?branch=main&status=success&per_page=100" \
  --jq '.workflow_runs[] | select(.head_branch == "main" and .status == "completed" and .conclusion == "success" and (.event == "push" or .event == "workflow_dispatch")) | .head_sha'); then
  echo "cannot read successful main CI runs: running everything" >&2
  exit
fi

while IFS= read -r candidate; do
  [[ "$candidate" =~ ^[0-9a-f]{40}$ && "$candidate" != "$SHA" ]] || continue
  if git merge-base --is-ancestor "$candidate" "$SHA" 2>/dev/null; then
    echo "main CI baseline: $candidate" >&2
    if ! git diff --name-only "$candidate" "$SHA"; then
      echo "cannot diff the main CI baseline" >&2
      exit 1
    fi
    exit
  fi
done <<< "$candidates"

echo "no successful ancestor in the latest 100 main CI runs: running everything" >&2

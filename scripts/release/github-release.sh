#!/usr/bin/env bash
# Attaches the published image's own declaration to the GitHub Release v<version>, making the
# Release when there is none. Usage: github-release.sh <version> <image>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: github-release.sh <version> <image>" >&2
  exit 2
fi
version=$1
image=$2
tag="v$version"

work=$(mktemp -d)
container=""
cleanup() {
  if [ -n "$container" ]; then docker rm "$container" >/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

container=$(docker create --pull never "$image")
pdf="$work/waitron-$version-declaration.pdf"
txt="$work/waitron-$version-declaration.txt"
docker cp "$container:/app/declaration/declaration.pdf" "$pdf"
docker cp "$container:/app/declaration/declaration.txt" "$txt"

# gh exits 1 for every failure; only these words mean the Release is missing (measured with gh
# 2.103.3, 2026-11-12: a bad token prints "HTTP 401: Bad credentials", no network a dial error).
errors="$work/view-errors"
if gh release view "$tag" >/dev/null 2>"$errors"; then
  gh release upload "$tag" --clobber "$pdf" "$txt"
elif [ "$(cat "$errors")" = "release not found" ]; then
  gh release create "$tag" --title "$version" --verify-tag "$pdf" "$txt"
else
  cat "$errors" >&2
  echo "cannot ask GitHub whether the Release $tag exists" >&2
  exit 1
fi

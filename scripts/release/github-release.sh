#!/usr/bin/env bash
# Attaches the published image's own declaration to the GitHub Release v<version>, making the
# Release when there is none. Usage: github-release.sh <version> <image>
set -euo pipefail

if [ "${1-}" = "--signed-file" ]; then
  if [ "$#" -ne 3 ]; then
    echo "usage: github-release.sh --signed-file <version> <file>" >&2
    exit 2
  fi
  tag="v$2"
  file=$3
  asset=waitron-release.json
  existing=$(gh release view "$tag" --json assets --jq '.assets[] | select(.name == "waitron-release.json") | .name')
  if [ -z "$existing" ]; then
    gh release upload "$tag" "$file"
  elif ! gh release download "$tag" --pattern "$asset" --output - | cmp -s "$file" -; then
    echo "The published $asset could not be read or differs from the signed file for $tag" >&2
    exit 1
  fi
  exit 0
fi

if [ "$#" -ne 2 ]; then
  echo "usage: github-release.sh <version> <image>" >&2
  exit 2
fi
version=$1
image=$2
tag="v$version"
release_flags=(--verify-tag)
case "${RELEASE_PRERELEASE-}" in
  true) release_flags+=(--prerelease --latest=false) ;;
  false) if [ "${RELEASE_MAINTENANCE-}" = "true" ]; then release_flags+=(--latest=false); fi ;;
  *)
    echo "RELEASE_PRERELEASE must be true or false" >&2
    exit 2
    ;;
esac

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

# Only the missing-Release response permits creation. The exit status also covers read failures.
errors="$work/view-errors"
if existing=$(gh release view "$tag" --json isPrerelease --jq .isPrerelease 2>"$errors"); then
  if [ "$existing" != "$RELEASE_PRERELEASE" ]; then
    echo "The GitHub Release $tag has a different prerelease flag. Check its tag annotation and signed file before correcting it." >&2
    exit 1
  fi
  gh release upload "$tag" --clobber "$pdf" "$txt"
elif [ "$(cat "$errors")" = "release not found" ]; then
  gh release create "$tag" --title "$version" "${release_flags[@]}" "$pdf" "$txt"
else
  cat "$errors" >&2
  echo "cannot ask GitHub whether the Release $tag exists" >&2
  exit 1
fi

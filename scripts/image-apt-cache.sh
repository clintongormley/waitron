#!/usr/bin/env bash
set -euo pipefail

cache=$(realpath "$1")
# The workflow apt scanner cannot see this helper; the Linux probe runs the real offline install.
# Keep the runner's dpkg status: the saved set includes dependencies absent on other runner images.
exec sudo timeout 90 unshare --net apt-get \
  -o Dir::Etc::sourcelist="$cache/sources.list" \
  -o Dir::Etc::sourceparts="$cache/source-parts" \
  -o Dir::State::lists="$cache/lists" \
  -o Dir::Cache::archives="$cache/archives" \
  -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 \
  install -y --no-download --no-install-recommends bluez python3-dbus python3-gi

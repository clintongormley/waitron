#!/usr/bin/env bash
set -euo pipefail
refuse() { echo "upgrade bootstrap: $1" >&2; exit 1; }
[ "$#" -eq 2 ] || refuse "expected host directory and box directory"
host_dir="$1" box_dir="$2"
[[ "$host_dir" = /* && "$box_dir" = /* ]] || refuse "directories must be absolute"
[ "$(uname -s)" = Linux ] || refuse "Linux host required"
exec 9>"${box_dir}.upgrade.lock"
flock -n 9 || refuse "another host operation is running"
if [ -d "${box_dir}.upgrades" ] && [ -n "$(find "${box_dir}.upgrades" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  refuse "resolve the upgrade attempt before refreshing the host runtime"
fi
case "$(uname -m)" in
  x86_64) arch=x64; checksum=982aa24dd8be4c889c6a8ab337ddff3b0896645b20f4239356e80552c16277ee ;;
  aarch64 | arm64) arch=arm64; checksum=afc7a004018485092ac8985b817b0d5684472bd9472e0b57d2ab88737e50090d ;;
  *) refuse "unsupported host architecture" ;;
esac
mkdir -p "$host_dir"
[ ! -e "$host_dir/node-v26.7.0" ] || {
  [ "$("$host_dir/node-v26.7.0/bin/node" --version)" = v26.7.0 ] && [ -f "$host_dir/node-v26.7.0/LICENSE" ] || refuse "installed runtime is incomplete"
  exit 0
}
work="$(mktemp -d "$host_dir/.bootstrap.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
curl -fsSL --retry 3 --connect-timeout 10 --max-time 300 \
  "https://nodejs.org/dist/v26.7.0/node-v26.7.0-linux-${arch}.tar.xz" -o "$work/node.tar.xz"
printf '%s  %s\n' "$checksum" "$work/node.tar.xz" | sha256sum -c - >/dev/null || refuse "checksum mismatch"
tar -xJf "$work/node.tar.xz" -C "$work"
[ -x "$work/node-v26.7.0-linux-${arch}/bin/node" ] && [ -f "$work/node-v26.7.0-linux-${arch}/LICENSE" ] || refuse "archive is incomplete"
sync -f "$work"
mv "$work/node-v26.7.0-linux-${arch}" "$host_dir/node-v26.7.0"
sync -f "$host_dir"

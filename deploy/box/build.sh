#!/usr/bin/env bash
set -euo pipefail
inputs="${1:?input directory}"
output="${2:?new output directory}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir "$output"
output="$(realpath "$output")"
inputs="$(realpath "$inputs")"
mkdir -p "$output/sandbox/etc/apt/sources.list.d" "$output/sandbox/usr/share/keyrings"
curl --fail --retry 3 --connect-timeout 15 --max-time 60 \
  https://download.docker.com/linux/debian/gpg -o "$output/sandbox/usr/share/keyrings/docker.asc"
cat > "$output/sandbox/etc/apt/sources.list.d/docker.sources" <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: amd64
Signed-By: /usr/share/keyrings/docker.asc
EOF
cp -a "$output/sandbox/etc/apt/sources.list.d/docker.sources" /etc/apt/sources.list.d/
cp "$output/sandbox/usr/share/keyrings/docker.asc" /usr/share/keyrings/
timeout -k 10 180 apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=20 update
packages=()
for package in docker-ce docker-ce-cli containerd.io docker-compose-plugin; do
  version="$(apt-cache policy "$package:amd64" | awk '/Candidate:/ {print $2}')"
  test -n "$version" && test "$version" != '(none)'
  packages+=(--package="$package=$version")
done
cd "$output"
timeout -k 10 600 mkosi --directory="$repo/deploy/box" --sandbox-tree="$output/sandbox" \
  --output-directory="$output" "${packages[@]}" build
root="$output/recipe-root"
install -d -m 0755 "$root/opt/waitron" "$root/etc/dracut.conf.d"
cp "$repo/deploy/compose.yml" "$root/opt/waitron/compose.yml"
cp "$inputs/compose.env" "$root/opt/waitron/.env"
chmod 0600 "$root/opt/waitron/.env"
install -m 0644 "$repo/deploy/apparmor/waitron-print-agent" "$root/etc/apparmor.d/waitron-print-agent"
mkdir -p "$root/etc/systemd/system/bluetooth.service.d"
bluez="$(sed -n 's/^ExecStart=//p' "$root/usr/lib/systemd/system/bluetooth.service")"
printf '[Service]\nExecStart=\nExecStart=%s --noplugin=autopair\n' "$bluez" \
  > "$root/etc/systemd/system/bluetooth.service.d/waitron-noautopair.conf"
printf 'hostonly="no"\nadd_drivers+=" virtio_pci virtio_blk ext4 "\n' > "$root/etc/dracut.conf.d/waitron.conf"
printf '{"features":{"containerd-snapshotter":true}}\n' > "$root/etc/docker/daemon.json"
systemctl --root="$root" enable docker.service NetworkManager.service
mkdir -p "$root/etc/systemd/system-preset"
printf 'disable systemd-networkd.service\ndisable systemd-networkd.socket\ndisable systemd-networkd-wait-online.service\nenable NetworkManager.service\n' \
  > "$root/etc/systemd/system-preset/00-waitron.preset"
systemctl --root="$root" preset systemd-networkd.service systemd-networkd.socket systemd-networkd-wait-online.service NetworkManager.service
kernel="$(basename "$root"/usr/lib/modules/*)"
timeout -k 10 180 chroot "$root" dracut --force --no-hostonly "/boot/initrd.img-$kernel" "$kernel"
cp "$root/boot/vmlinuz-$kernel" "$output/kernel"
cp "$root/boot/initrd.img-$kernel" "$output/initrd"
uuid="$(cat /proc/sys/kernel/random/uuid)"
truncate -s 8G "$output/waitron-box-dev.img"
mkfs.ext4 -q -F -U "$uuid" -d "$root" "$output/waitron-box-dev.img"
bytes="$(du -sb "$inputs" | cut -f1)"
truncate -s "$((bytes + 134217728))" "$output/inputs.img"
mkfs.ext4 -q -F -d "$inputs" "$output/inputs.img"
printf '%s\n' "$uuid" > "$output/uuid"
B3_RECIPE_IMAGE="$output/waitron-box-dev.img" B3_POPULATE=1 \
  node "$repo/bench/box-installer/run.mjs" --case recipe-setup --run-dir "$output/populate"
sha256sum "$output/waitron-box-dev.img" "$output/kernel" "$output/initrd" > "$output/SHA256SUMS"
chroot "$root" dpkg-query -W > "$output/packages.txt"
printf 'Recipe assembled at %s\n' "$output"

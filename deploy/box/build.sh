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
packages=(
  --package='docker-ce=5:29.9.3-1~debian.13~trixie'
  --package='docker-ce-cli=5:29.9.3-1~debian.13~trixie'
  --package='containerd.io=2.4.2-3~debian.13~trixie'
  --package='docker-compose-plugin=5.7.0-1~debian.13~trixie'
)
cd "$output"
timeout -k 10 600 mkosi --directory="$repo/deploy/box" --sandbox-tree="$output/sandbox" \
  --output-directory="$output" "${packages[@]}" build
root="$output/recipe-root"
install -d -m 0755 "$root/opt/waitron" "$root/etc/dracut.conf.d"
install -D -m 0755 "$repo/deploy/box/start-dev.sh" "$root/usr/local/sbin/waitron-dev-start"
install -D -m 0644 "$repo/deploy/box/waitron-dev.service" "$root/etc/systemd/system/waitron-dev.service"
systemctl --root="$root" enable waitron-dev.service
cp "$repo/deploy/compose.yml" "$root/opt/waitron/compose.yml"
mkdir "$output/input-stage"
for kind in app agent mailpit; do
  archive="$inputs/$kind.tar"
  cp --reflink=auto "$archive" "$output/input-stage/$kind.tar"
  config="$(tar -xOf "$archive" manifest.json | jq -er '.[0].Config')"
  digest="$(tar -xOf "$archive" -- "$config" | sha256sum | cut -d' ' -f1)"
  name="$kind"
  if [ "$kind" = agent ]; then name=print-agent; fi
  printf '%s\t%s\n' "$name" "$digest" >> "$output/input-stage/expected-configs.tsv"
done
app="$(tar -xOf "$inputs/app.tar" manifest.json | jq -er '.[0].RepoTags[0]')"
agent="$(tar -xOf "$inputs/agent.tar" manifest.json | jq -er '.[0].RepoTags[0]')"
printf 'WAITRON_IMAGE=%s\nWAITRON_PRINT_AGENT_IMAGE=%s\nWAITRON_INSTALLATION_ORIGIN=usb\n' "$app" "$agent" > "$root/opt/waitron/.env"
chmod 0600 "$root/opt/waitron/.env"
install -D -m 0644 "$output/sandbox/usr/share/keyrings/docker.asc" "$root/usr/share/keyrings/docker.asc"
install -D -m 0644 "$output/sandbox/etc/apt/sources.list.d/docker.sources" "$root/etc/apt/sources.list.d/docker.sources"
install -m 0644 "$repo/deploy/apparmor/waitron-print-agent" "$root/etc/apparmor.d/waitron-print-agent"
mkdir -p "$root/etc/systemd/system/bluetooth.service.d"
bluez="$(sed -n 's/^ExecStart=//p' "$root/usr/lib/systemd/system/bluetooth.service")"
printf '[Service]\nExecStart=\nExecStart=%s --noplugin=autopair\n' "$bluez" \
  > "$root/etc/systemd/system/bluetooth.service.d/waitron-noautopair.conf"
printf 'hostonly="no"\nadd_drivers+=" virtio_pci virtio_blk ext4 btrfs "\n' > "$root/etc/dracut.conf.d/waitron.conf"
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
bytes="$(du -sb "$output/input-stage" | cut -f1)"
truncate -s "$((bytes + 134217728))" "$output/inputs.img"
mkfs.ext4 -q -F -d "$output/input-stage" "$output/inputs.img"
printf '%s\n' "$uuid" > "$output/uuid"
B3_RECIPE_IMAGE="$output/waitron-box-dev.img" B3_POPULATE=1 \
  node "$repo/bench/box-installer/run.mjs" --case recipe-setup --run-dir "$output/populate"
bash "$repo/deploy/box/firmware-image.sh" "$root" "$output/waitron-box-dev.img" "$output/waitron-install-dev.img"
sha256sum "$output/waitron-install-dev.img" "$output/waitron-box-dev.img" "$output/kernel" "$output/initrd" > "$output/SHA256SUMS"
chroot "$root" dpkg-query -W > "$output/packages.txt"
printf 'Recipe assembled at %s\n' "$output"

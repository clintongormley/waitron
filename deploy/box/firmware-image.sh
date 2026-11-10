#!/usr/bin/env bash
set -euo pipefail
root="${1:?guest root}"
payload="${2:?preloaded ext4 payload}"
output="${3:?new image}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d "$(dirname "$output")/firmware.XXXXXX")"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
cp -a --reflink=auto "$root" "$work/root"
installer="$work/root"
install -D -m 0755 "$repo/deploy/box/install-dev.sh" "$installer/usr/local/sbin/waitron-dev-install"
install -D -m 0644 "$repo/deploy/box/waitron-dev-install.service" "$installer/etc/systemd/system/waitron-dev-install.service"
installer_uuid="$(cat /proc/sys/kernel/random/uuid)"
kernel="$(basename "$installer"/usr/lib/modules/*)"
cat > "$installer/tmp/waitron-grub.cfg" <<CONFIG
serial --unit=0 --speed=115200
terminal_input serial
terminal_output serial
set timeout=0
search --no-floppy --fs-uuid --set=root $installer_uuid
linux /boot/vmlinuz-$kernel root=UUID=$installer_uuid rootfstype=ext4 rw console=ttyS0,115200 systemd.unit=waitron-dev-install.service rd.shell=0
initrd /boot/initrd.img-$kernel
boot
CONFIG
chroot "$installer" grub-mkstandalone -O x86_64-efi -o /boot/BOOTX64.EFI 'boot/grub/grub.cfg=/tmp/waitron-grub.cfg'
truncate -s 2G "$work/installer.img"
mkfs.ext4 -q -F -U "$installer_uuid" -d "$installer" "$work/installer.img"
payload_bytes="$(stat -c %s "$payload")"
truncate -s "$((payload_bytes + 2684354560 + 2097152))" "$output"
sfdisk "$output" <<LAYOUT
label: gpt
size=512M, type=U
size=2G, type=L
 type=L
LAYOUT
truncate -s 512M "$work/efi.img"
mkfs.vfat "$work/efi.img"
mmd -i "$work/efi.img" ::/EFI ::/EFI/BOOT
mcopy -i "$work/efi.img" "$installer/boot/BOOTX64.EFI" ::/EFI/BOOT/BOOTX64.EFI
cp --reflink=auto --sparse=always "$payload" "$work/payload.img"
tune2fs -L WAITRON_PAYLOAD "$work/payload.img"
dd if="$work/efi.img" of="$output" bs=1M seek=1 conv=notrunc,sparse status=progress
dd if="$work/installer.img" of="$output" bs=1M seek=513 conv=notrunc,sparse status=progress
dd if="$work/payload.img" of="$output" bs=1M seek=2561 conv=notrunc,sparse status=progress
sync
printf 'B3_FIRMWARE_IMAGE:%s\n' "$output"

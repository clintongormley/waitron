#!/usr/bin/env bash
set -euo pipefail
refuse() { printf 'install.refused:%s\n' "$1" >&2; exit 1; }
[ "$#" = 0 ] || refuse arguments
[ "$(cat /sys/class/dmi/id/product_name)" = Waitron-B3-dev ] || refuse machine
# Volatile boot exposes its backing device through systemd's link.
source_root="$(readlink -f /run/systemd/volatile-root)"
source_disk="/dev/$(lsblk -nro PKNAME "$source_root")"
disks="$(lsblk --json -bdno PATH,TYPE,SERIAL,SIZE)"
targets="$(jq -c --arg source "$source_disk" '[.blockdevices[] | select(.type == "disk" and .path != $source)]' <<< "$disks")"
[ "$(jq length <<< "$targets")" = 1 ] || refuse disk-count
target="$(jq -r '.[0].path' <<< "$targets")"
[ "$(jq -r '.[0].serial' <<< "$targets")" = waitron-dev-target ] || refuse serial
[[ "$target" = /dev/vd? ]] || refuse device
size="$(blockdev --getsize64 "$target")"
[ "$size" -ge 12884901888 ] || refuse size
[ -z "$(lsblk -nro MOUNTPOINTS "$target")" ] || refuse mounted
[ -z "$(ls -A "/sys/class/block/${target##*/}/holders")" ] || refuse holders
cmp -n "$size" "$target" /dev/zero >/dev/null 2>&1 || refuse occupied
[ "$(blockdev --getsize64 "$target")" = "$size" ] || refuse size
[ "$(lsblk -nro SERIAL "$target")" = waitron-dev-target ] || refuse serial
sfdisk "$target" <<'LAYOUT'
label: gpt
size=512M, type=U
size=1G, type=L
 type=a8aaea61-baef-47f4-9cff-c4c967ee12c7, name="waitron-box"
LAYOUT
udevadm settle
mkfs.vfat "${target}1"
mkfs.ext4 -q -F "${target}2"
work="$(mktemp -d /run/waitron-install.XXXXXX)"
opened=false
cleanup() {
  umount -R "$work/root" 2>/dev/null || true
  umount "$work/top" "$work/payload" 2>/dev/null || true
  if "$opened"; then cryptsetup close waitron-dev-root; opened=false; fi
  rm -f "$work/empty-password"
  rmdir "$work/root" "$work/top" "$work/payload" "$work" 2>/dev/null || true
}
trap cleanup EXIT
: > "$work/empty-password"
cryptsetup --type luks2 --batch-mode --subsystem waitron-box-1 --key-file "$work/empty-password" luksFormat "${target}3"
cryptsetup open --key-file "$work/empty-password" "${target}3" waitron-dev-root
opened=true
mapped=/dev/mapper/waitron-dev-root
mkfs.btrfs -q -f "$mapped"
mkdir "$work/top" "$work/root" "$work/payload"
mount "$mapped" "$work/top"
for area in rootfs images volumes logs host-state; do btrfs subvolume create "$work/top/@$area"; done
mount -o subvol=@rootfs "$mapped" "$work/root"
root="$work/root"
mkdir -p "$root/boot/efi" "$root/var/lib/waitron-images" "$root/var/lib/waitron-host"
mount "${target}2" "$root/boot"
mkdir -p "$root/boot/efi"
mount "${target}1" "$root/boot/efi"
mount -o subvol=@images "$mapped" "$root/var/lib/waitron-images"
mkdir -p "$root/var/lib/waitron-images/docker" "$root/var/lib/waitron-images/containerd" "$root/var/lib/docker" "$root/var/lib/containerd"
mount --bind "$root/var/lib/waitron-images/docker" "$root/var/lib/docker"
mount --bind "$root/var/lib/waitron-images/containerd" "$root/var/lib/containerd"
mkdir -p "$root/var/lib/docker/volumes"
mount -o subvol=@volumes "$mapped" "$root/var/lib/docker/volumes"
mkdir -p "$root/var/lib/docker/volumes/waitron_logs/_data"
mount -o subvol=@logs "$mapped" "$root/var/lib/docker/volumes/waitron_logs/_data"
mount -o subvol=@host-state "$mapped" "$root/var/lib/waitron-host"
mount -o ro /dev/disk/by-label/WAITRON_PAYLOAD "$work/payload"
cp -a --sparse=always "$work/payload/." "$root/"
tar -C "$work/payload" -cpf - . | tar -C "$root" -df -
uuid="$(blkid -s UUID -o value "$mapped")"
luks_uuid="$(cryptsetup luksUUID "${target}3")"
boot_uuid="$(blkid -s UUID -o value "${target}2")"
efi_uuid="$(blkid -s UUID -o value "${target}1")"
printf '%s\n' "$uuid" > "$root/etc/waitron-dev-root"
printf '%s\n' "$luks_uuid" > "$root/etc/waitron-dev-luks"
printf 'luks-%s UUID=%s none luks,try-empty-password=yes,headless=yes\n' "$luks_uuid" "$luks_uuid" > "$root/etc/crypttab"
cat > "$root/etc/fstab" <<FSTAB
UUID=$uuid / btrfs defaults,subvol=@rootfs 0 0
UUID=$boot_uuid /boot ext4 defaults 0 2
UUID=$efi_uuid /boot/efi vfat defaults 0 2
UUID=$uuid /var/lib/waitron-images btrfs defaults,subvol=@images 0 0
/var/lib/waitron-images/docker /var/lib/docker none bind,x-systemd.requires-mounts-for=/var/lib/waitron-images 0 0
/var/lib/waitron-images/containerd /var/lib/containerd none bind,x-systemd.requires-mounts-for=/var/lib/waitron-images 0 0
UUID=$uuid /var/lib/docker/volumes btrfs defaults,subvol=@volumes 0 0
UUID=$uuid /var/lib/docker/volumes/waitron_logs/_data btrfs defaults,subvol=@logs 0 0
UUID=$uuid /var/lib/waitron-host btrfs defaults,subvol=@host-state 0 0
FSTAB
kernel="$(basename "$root"/usr/lib/modules/*)"
cat > "$root/tmp/waitron-grub.cfg" <<CONFIG
serial --unit=0 --speed=115200
terminal_input serial
terminal_output serial
search --no-floppy --fs-uuid --set=root $boot_uuid
linux /vmlinuz-$kernel root=UUID=$uuid rootfstype=btrfs rootflags=subvol=@rootfs rw console=ttyS0,115200 rd.shell=0 rd.emergency=reboot rd.luks.uuid=$luks_uuid rd.luks.options=$luks_uuid=try-empty-password=yes,headless=yes
initrd /initrd.img-$kernel
boot
CONFIG
mkdir -p "$root/boot/efi/EFI/BOOT"
chroot "$root" grub-mkstandalone --modules="part_gpt ext2 search_fs_uuid" -O x86_64-efi -o /boot/efi/EFI/BOOT/BOOTX64.EFI 'boot/grub/grub.cfg=/tmp/waitron-grub.cfg'
sync
cleanup
trap - EXIT
printf 'B3_INSTALL_OK:%s\n' "$uuid"

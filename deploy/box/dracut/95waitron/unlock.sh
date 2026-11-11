#!/bin/sh
[ ! -f /lib/dracut-lib.sh ] || . /lib/dracut-lib.sh
waitron_unlock() {
  waitron_uuid="$(getarg rd.waitron.luks.uuid=)"
  [ -n "$waitron_uuid" ] || return 0
  [ -e /run/waitron-disk-opened ] && return 0
  waitron_device="/dev/disk/by-uuid/$waitron_uuid"
  [ -e "$waitron_device" ] || return 0
  umask 077
  waitron_opened=failed
  printf 'failed\n' >/run/waitron-disk-opened
  if systemd-cryptsetup attach waitron-data "$waitron_device" - tpm2-device=auto,headless=yes; then
    waitron_opened=chip
    printf 'chip\n' >/run/waitron-disk-opened
  fi
  if ! tpm2_pcrextend 15:sha256=1111111111111111111111111111111111111111111111111111111111111111; then
    printf 'failed\n' >/run/waitron-disk-opened
    reboot -f
    return 1
  fi
  [ "$waitron_opened" = chip ] && return 0
  : >/run/waitron-empty-key
  if ! cryptsetup open --type luks --key-file /run/waitron-empty-key "$waitron_device" waitron-data; then
    rm -f /run/waitron-empty-key
    reboot -f
    return 1
  fi
  rm -f /run/waitron-empty-key
  printf 'bootstrap\n' >/run/waitron-disk-opened
}
waitron_unlock

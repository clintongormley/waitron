#!/bin/bash
check() { return 0; }
depends() { echo 'systemd crypt'; }
installkernel() { instmods tpm_crb tpm_tis; }
install() {
  inst_binary "$systemdutildir/systemd-cryptsetup" /usr/bin/systemd-cryptsetup
  inst_multiple cryptsetup tpm2_pcrextend reboot rm
  inst_libdir_file 'libtss2-*.so.*'
  inst_libdir_file 'cryptsetup/libcryptsetup-token-systemd-*.so'
  inst_hook initqueue/settled 20 "$moddir/unlock.sh"
}

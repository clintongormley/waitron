# B3-17: measure the firmware’s one-time boot choice

**11 November 2026, later cut:** the [B3-18b plan](2026-11-11-b3-18b-firmware-return.md) builds the development console return. The measurement below records the earlier firmware-only experiment.

Sol high wrote the original installed-return proposal; Claude’s sole 546-second read recommended this smaller measurement first. The driver revised it accordingly. **The watcher cleared the firmware-only measurement at 09:39 on 11 November 2026 (Lane K’s questions.md), at signed proposal `0d1ac4a926`.** The parent B3 build authority is recorded in Lane K’s queue as owner 2026-11-01 “Yes, build it”; that does not mean the owner approved this cut.

**Finish line.** A developer has a measured answer to whether the development firmware starts a selected EFI loader after a guest-requested restart with the source still attached and first in the ordinary boot order. This retires one uncertainty in [design §5.1 guard 3](../specs/2026-10-21-b3-usb-installer-design.md), not a usable reinstall feature. Today the development installer refuses an occupied target (`deploy/box/install-dev.sh:19`); its unit powers off. Product behavior stays as it is during this measurement.

**Reuse and scope.** Use the existing rig’s OVMF firmware and USB-first/virtio-target attachment shape (`bench/box-installer/run.mjs`), in a new disposable tool container. Prepare a minimal Debian 13 source guest with `efibootmgr` and a run-owned GPT target with an EFI partition and a fallback loader that starts the same minimal guest in a distinct target stage. No application image, installed venue, encryption key, virtual TPM enrollment or full image build is needed. Attach source and target read-only; only the private firmware-variable copy is writable. Record tool/firmware versions, exact QEMU arguments, source/target partition identities and initial firmware entries.

**One bounded experiment.** Before running, write down PASS and each FAIL below. Start with no BootNext. Inside the source guest, create the target entry using `--create-only`, matching its EFI partition UUID and `\EFI\BOOT\BOOTX64.EFI`, leaving BootOrder unchanged. Read back that entry, set/read BootNext, and request reboot. Keep one QEMU process, the source attached with bootindex 1 and the target with bootindex 2 throughout. The target guest reads and reports BootCurrent and BootNext, emits its distinct marker and powers off. Finish at that guest-requested poweroff, then compare both disk hashes.

PASS requires the source stage once, a guest reset, the exact target entry after reset, BootNext absent, unchanged BootOrder and both disk hashes, and normal target-guest completion. Poweroff before reset, QEMU exit at reset, a second source start, vanished/wrong entry, uncleared BootNext, a second QEMU process or detached source is FAIL. An unavailable observation is inconclusive, not PASS. No host-issued reset, chainloading or fallback boot counts. Stop after 30 minutes including preparation; retain the last stage and command statuses when unfinished.

**Files, size and delivery.** No product or test files change. Expect at most 120 lines of disposable probe support outside the checkout; stop above 180. Once measured, update this plan, `docs/backlog.md` and `docs/backlog/box.md` with the narrow result, about +35/−0 documentation lines. Use the docs-only signed-commit/main-lock workflow, not a separate PR. Keep small commands/logs/JSON locally; discard this run’s disks, container and firmware variables. Do not remove shared images or caches.

**What remains open.** Installed-disk automatic return, its disk/header observer, console behavior, firmware adapter and whole-boot rig remain unbuilt. A later product plan must address the review’s R1–R13, including actual reset/PCR5/7/8/9/15/chip-unlock evidence. The tag writer still lands with its consuming reader/screen. No signing, release, physical-device or theft-protection claim. B3 remains 0/6 parent slices complete. The watcher decides after the measurement whether automatic return lands alone or with the reinstall screen.

## Measured on 11 November 2026

The one firmware run passed the stated criteria. You can use this result when planning the
installed-return adapter; it does not qualify an encrypted installed boot or a physical box.
Preparation and the completed probe fit within the 30-minute allowance (started 09:55 CET;
the completed evidence was checked at 10:04 CET).

- Debian 13 guests used kernel `6.12.107-1`, systemd `257.13-1~deb13u1`, dracut `106-6`
  and efibootmgr `18-2`. The tool container ran QEMU `10.0.13` and OVMF `2025.02-8+deb13u1`.
- One QEMU process kept the read-only USB source at bootindex 1 and read-only virtio target at
  bootindex 2. A fresh private OVMF-variable copy initially had no BootNext. No host reset,
  disk detachment or second QEMU launch occurred in the recorded command.
- The source created active entry `0004` with `--create-only`, bound to target EFI partition
  `1764B79F-2A5B-4430-A72C-614275564F09` and `\EFI\BOOT\BOOTX64.EFI`, then read back
  `BootNext: 0004` and requested its own reboot. QEMU reported `RESET` with `reason: guest-reset`.
- The target started once and reported `BootCurrent: 0004`, with BootNext absent. Every observed
  BootOrder was `0001,0002,0000,0003`. The target requested poweroff; QEMU reported
  `SHUTDOWN` with `reason: guest-shutdown` and exited 0. The source stage appeared once.
- Both SHA-256 hashes matched before and after: source
  `d8a256d0ff0ed75695bbecbca29c080887b2d1e61e01b789c3bae2c166ed8122`, target
  `88e0b28819105a65497d24084bde144a15ef877c865b1a84f69d969a424d456b`.

The local receipt is `~/waitron-campaign-k/receipts/b3-17-firmware-20261111/`: commands,
package/firmware versions, exact QEMU arguments, partition layouts, serial/QMP logs, hashes and
`result.json`. After guest preparation, the run command was `docker exec -e B317_ROOT_READY=1
waitron-k-b317-20261111-1000 timeout -k 10 600 bash /probe.sh`.
`python3 check.py out` reported `PASS`; changing only the target's recorded BootCurrent from
0004 to 0002 made its `BootCurrent target` assertion fail, and the original evidence passed again.

Preparation first failed at mkosi's `mount_setattr` call (`ENOSYS`) in the amd64 container.
Debootstrap unpacked the guest but selected conflicting dracut/initramfs-tools packages;
`dpkg --configure -a` configured the unpacked dracut installation before the probe continued.
Those preparation failures remain in the receipt. The run-owned container, guest disks and
firmware variables were removed. Product behavior is unchanged; the watcher still decides
whether the later automatic-return adapter lands alone or with the reinstall screen.

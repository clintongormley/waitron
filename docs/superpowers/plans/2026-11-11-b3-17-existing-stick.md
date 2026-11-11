# B3-17: reinsert the development installer

Sol high wrote this proposal for Lane K. It needs Claude review and watcher clearance before building; the owner has not approved this cut. Scope: [design §§5.1 guard 3, 7, 19–20](../specs/2026-10-21-b3-usb-installer-design.md), [parent Task 2.1](2026-10-26-b3-usb-installer.md), retaining [B3-15](2026-11-10-b3-15-retained-key-startup.md)/[B3-16](2026-11-11-b3-16-name-tag-duty.md) limits.

**Finish line.** In the emulator-only recipe, reinserting the source with an installed target attached needs no typing: recognise Waitron, wait 15 seconds, set BootNext (firmware’s next-start choice), restart and reach the existing setup through its existing TPM seal. Preserve target contents and identity. Firmware variables may change; normal installed startup writes are expected.

**Feasibility first, 30 minutes maximum.** Reuse current app archives/build inputs. `install-dev.sh` writes only `\EFI\BOOT\BOOTX64.EFI`; probe `efibootmgr` selecting an entry matching the target ESP’s partition UUID and loader path, or registering it with `--create-only`, then `--bootnext`. Read back the selection. Use real OVMF firmware, persistent variables and the enrolled virtual TPM. Require a guest-requested reboot with source attached and subsequent chip unlock. If unresolved, stop and return commands, statuses and logs to the watcher. No chainloading, kexec, resealing or weaker seal substitution.

**Files and forecast, added/removed lines.**

| Responsibility | Exact files | +/− |
| --- | --- | --- |
| Production | Add `scripts/box/installed-boot.mjs`; modify `deploy/box/{install-dev.sh,firmware-image.sh,mkosi.conf,waitron-dev-install.service}` | 240/20 |
| Tests | Add `scripts/box/installed-boot.test.mjs`; extend `scripts/box/{installed-start,recipe-setup,rig-contract}.test.mjs` | 200/15 |
| Support | Extend `bench/box-installer/run.mjs`, `scripts/box/rig-contract.mjs` | 170/20 |
| Docs | This plan; `bench/box-installer/README.md`, `deploy/README.md`, `docs/backlog.md`, `docs/backlog/box.md` | 80/15 |

**Build test-first.** Observe failing Linux-binding tests before minimal implementation. Reuse `classifyDisk`, `createInstallerState`/`nextInstallerStep`; policy tests retain ownership of timing. Bind read-only GPT/LUKS observations without opening/repairing encryption. Keep machine/source/serial/size/mount/holder restrictions and the all-zero requirement for fresh writes. Freeze target identity; recheck disk, partition and LUKS identities before EFI selection. Refuse changed targets, non-Waitron occupied or unclassifiable layouts, multiple targets, missing loaders and failed firmware writes. Never select by label alone. Package adapter dependencies only into the installer. Enable console interruption. Preserve fresh-install poweroff; existing-disk success requests reboot. No new protocol, record or source-only guard.

Linux tests own command ordering, exact target/EFI binding and key-interrupt stop. Run commands to completion; deletion of target matching must fail its assertion, then restore/pass. Run:

`pnpm exec vitest run scripts/box/{installed-boot,installed-start,recipe-setup,rig-contract,installer-policy,disk-state}.test.mjs`

Record actual focused pass counts. No full package suite.

**Mandatory VM evidence.** Add `existing-stick`: `B3_INSTALLER_IMAGE=<candidate> node bench/box-installer/run.mjs --case existing-stick --run-dir <fresh-private-dir>`. Reuse installed setup observations. Remove `-no-reboot` for this transition; keep one QEMU process, source priority/attachment, variables and TPM across reset. Attach no private recovery-proof disk during target counting. Require BootNext consumption/BootCurrent, chip opening, unchanged disk/machine/CA identities and setup HTTP 200 plus rendering. Qualify installer writes separately with a read-only target through actual reset, never marker-triggered termination. Keep secrets/private disks local. Complete refusal runs before hash comparisons.

**Stops.** Budget three active hours to PR, excluding watcher waits. Forecast 760 changed lines; stop above 1.5× (1,140) or at time/scope departure. Then normal `finish-branch` Claude reviews, focused fixes, hook and current-head CI.

**Development limit.** A key safely stops untouched; no reinstall screen/key reader/name-tag writer. Writer and consuming screen stay together. No downloads/signing/publication, network/hotspot, boot-trust/physical or fiscal work. This independently exercises default guard 3 only; if that is insufficiently usable, return to watcher without expanding. B3 remains 0/6 parent slices.

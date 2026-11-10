# B3-15: retained-key sealing and startup

For the driver’s Claude read and watcher clearance. The owner’s 2026-11-01 “Yes, build it” covers the [six-slice parent](2026-10-26-b3-usb-installer.md), not this draft. Implement [design §§7.2–7.3](../specs/2026-10-21-b3-usb-installer-design.md#72-what-the-key-is-sealed-to-requirements-the-exact-registers-are-slice-1s-measurement) after [B3-14](2026-11-10-b3-14-encrypted-layout.md).

**Finish line.** Install onto a disposable disk, detach USB, bootstrap without starting Waitron, restart automatically, then reach the existing setup screen through TPM unlock with the empty slot removed. Another unattended restart reaches setup again. The retained recovery key independently unlocks that same disk. Restore §7.3 item 3 as an enforced startup check, including Docker’s automatic container restart path.

**Feasibility first.** No guest ran. The author subprocess was denied Docker access; the driver’s `docker info --format '{{.OSType}} {{.Architecture}}'` returned `linux aarch64`. QEMU/swtpm are absent from the Mac’s `PATH`; the existing rehearsal runs Linux tools in Docker. `install-dev.sh:97` generates GRUB; the rig lacks TPM and recreates firmware variables (`run.mjs:275–285`). On accessible Linux/OVMF/swtpm, prove signed Debian boot, persistent firmware/TPM, measured PCRs 5/7/8/9, and headless unlock followed by PCR15 extension. Probe `systemd-cryptenroll --unlock-key-file=/run/empty --tpm2-device=auto --tpm2-pcrs=5+7+8+9+15:sha256=<pre-extension-digest> <disk>` and recovery enrollment/verification through file descriptors. These commands are unverified candidates. At 30 minutes, failure stops with commands/status/stderr. Smallest split: firmware/TPM feasibility rehearsal, then one working startup PR; no refusal-only delivery or plaintext boot key. Request available owner hardware early; the older restriction is superseded.

| Interface source | Source’s words | Meaning |
| --- | --- | --- |
| [systemd v257](https://raw.githubusercontent.com/systemd/systemd/v257/man/systemd-cryptenroll.xml) | “will be used instead of reading the current PCR value” | Explicit digest supported; guest unverified. |

**Proposed files.**

| Layer | Files and responsibility | Added/removed forecast |
| --- | --- | --- |
| Production | New `scripts/box/disk-start.mjs`, `deploy/box/waitron-disk-start.service`, `deploy/box/dracut/95waitron/{module-setup.sh,unlock.sh}`; modify `scripts/box/disk-key.mjs`, `deploy/box/{build.sh,mkosi.conf,install-dev.sh,firmware-image.sh,start-dev.sh,waitron-dev.service}`. Bind the existing store, add boot/gate adapters, signed boot files, pinned host runtime/tools/notices and Docker service/socket dependencies. | 390/45 |
| Tests | New `scripts/box/disk-start.test.mjs`; extend `scripts/box/{installed-start,recipe-setup}.test.mjs`. | 240/15 |
| Support | Extend `bench/box-installer/{run.mjs,Containerfile}`, `scripts/box/recipe-setup.mjs`. | 190/20 |
| Docs | This plan, `bench/box-installer/README.md`, `deploy/README.md`, `docs/backlog.md`, `docs/backlog/box.md`. | 70/20 |

**Build sequence after clearance.**

1. Reuse `createDiskRecoveryStore` and `diskRecoveryKeyPassphrase`; inspect mount/device/inode/UUID for root-only encrypted `@host-state`. Retain one random 32-byte key in its UUID record; enroll its formatted passphrase separately from the TPM slot. Retry validates, never rotates. Use pipes/descriptors or root-only tmpfs; disable tracing, swap and dumps. No raw secret enters arguments, environment, logs, boot files or the app container.
2. One dracut-owned TPM attempt precedes empty fallback; extend PCR15 on success and every failure exit, with no competing automatic attempt or shell. Bootstrap stores/enrolls/verifies the retained key and seal, then reboots without Compose. Only a fresh, TPM-only successful boot permits authenticated removal of the identified empty slot. Recheck empty authentication actually fails before releasing Docker. Interrupted/ambiguous enrollment refuses with fixed secret-free host status; no regeneration. Keep measured startup bytes unchanged. `build.sh:67` builds initrd before disk UUID exists: install crypttab alone cannot wire this path.

**Evidence by layer.** Existing disk-key, recovery-key and preboot suites retain their policy assertions. New adapter tests own mount binding, enrollment ordering, interrupted retry and secret handling; caller tests assert refused gate means zero Compose calls. Observe red, implement, then green with `pnpm exec vitest run scripts/box/{disk-start,disk-key,disk-recovery-key,preboot,preboot-locked,installed-start,recipe-setup}.test.mjs`. Delete the empty-slot guard temporarily: its refusal assertion must fail; restore/pass.

Run `B3_INSTALLER_IMAGE=/work/output/waitron-install-dev.img node bench/box-installer/run.mjs --case installed-setup --run-dir /work/sealed-start` with persistent swtpm/Secure Boot: install, bootstrap, then two disk-only setup boots. Record actual TPM slot used, unchanged identities/measured bytes, empty-password failure and retained-key success without exporting secrets. Broken seal must not count as TPM success; test second-unseal refusal and missing-disk/no-shell. Secure Boot-off/non-TPM proves development plumbing only. Recovery UI/Android trust, update resealing and physical experiments remain parent gates; this does not complete six slices.

**Bounds.** Conditional forecast +890/−100 = 990 changed lines. Budget: 30 minutes feasibility, 65 implementation, 40 qualification, 45 review/PR. Stop before 1,000 lines or three hours; return scope changes to Claude/watcher. No ledger, protocol, framework, fiscal change or publication. A1187 part 3/A950 cuts 4+ stay blocked until startup lands; tell the watcher then and preserve its multi-slice counter. Encryption before go-live remains required.

# B3-15: retained-key sealing and development startup

The owner authorised the [parent](2026-10-26-b3-usb-installer.md), not this draft. Sol high wrote it; Claude read it (514 seconds); watcher 2026-11-10 22:20 clears the corrected development cut without another read. Apply [design §§7.2–7.3](../specs/2026-10-21-b3-usb-installer-design.md#72-what-the-key-is-sealed-to-requirements-the-exact-registers-are-slice-1s-measurement) after [B3-14](2026-11-10-b3-14-encrypted-layout.md).

**Usable result.** A disposable disk bootstraps without Docker, restarts through a virtual TPM, removes its empty password, then reaches setup twice unattended. Its retained key independently unlocks it in the rig. Empty-password authentication keeps Waitron stopped, including Docker’s automatic restart. Unsigned development boot provides no theft-protection claim.

**Watcher-cleared deferrals.** Signed boot/Secure Boot; parent Task 1.2 emulator experiments (b), another stick refusing unlock, and (i), missing encrypted disk opening no console; `waitron.local` failure page; recovery screen/key sheets; update resealing; physical/Android qualification. They remain release gates. Report failures through secret-free serial/console status and reboot without a shell. Broken seals have no supported recovery; retained-key verification is a rig check. Use no venue data; publish no image. B3 remains **0/6 parent slices complete**. A1187 part 3/A950 cuts 4+ remain blocked until startup lands and their other prerequisites are checked.

**Feasibility first.** Driver Docker reports `linux aarch64`; use Linux containers. B3-14 outputs were deleted. Allow 30 minutes including tool preparation for Debian/swtpm probes: reset-PCR15 enrollment, headless unlock, refusal after extension, empty-file authentication, retained-key descriptor input, and startup-image `tpm2_pcrextend` from `tpm2-tools`. Preserve commands/status/stderr; stop if unresolved. These command probes do not replace final guest measurement/ordering checks. Make no production change or policy relaxation on failure.

| Layer | Exact files | Added/removed forecast |
| --- | --- | --- |
| Production | New `scripts/box/disk-start.mjs`, `deploy/box/waitron-disk-{start,ready}.service`, `deploy/box/docker-waitron-disk.conf`, `deploy/box/dracut/95waitron/{module-setup.sh,unlock.sh}`; modify `deploy/box/{build.sh,mkosi.conf,install-dev.sh,firmware-image.sh,start-dev.sh,waitron-dev.service}`. | 290/35 |
| Tests | New `scripts/box/disk-start.test.mjs`; extend `scripts/box/{installed-start,recipe-setup}.test.mjs`. | 190/10 |
| Support | Extend `bench/box-installer/{run.mjs,Containerfile}`, `scripts/box/recipe-setup.mjs`. | 130/15 |
| Docs | This plan, `bench/box-installer/README.md`, `deploy/README.md`, `docs/backlog.md`, `docs/backlog/box.md`. | 70/20 |

| Interface source | Source’s words |
| --- | --- |
| [systemd v257](https://raw.githubusercontent.com/systemd/systemd/v257/man/systemd-cryptenroll.xml) | “used instead of reading the current PCR value”; “for wiping all key slots that are unlocked by an empty passphrase” |

**Build.** Reuse `createDiskRecoveryStore`, `diskRecoveryKeyPassphrase` and preboot policies. Bind the store to root-owned encrypted `@host-state`; enroll its 32-byte key as recovery passphrase. Accept three states: clean first start, empty password only; enrolled/chip-opened with empty password, removed now; enrolled/chip-opened without empty password, every later boot. Refuse others; reinstall rather than retry/rotate. Authenticate `--wipe-slot=empty` using the retained-key descriptor; prove empty authentication fails. Secrets use descriptors/root-only tmpfs, never arguments/environment/logs; no tracing/swap/dumps. Use Debian host `nodejs` and existing notice collection.

Add GRUB’s `tpm`. Replace automatic `rd.luks.*` discovery with `rd.luks=0` and a Waitron disk-UUID argument. Skip unencrypted populate/stick boots. Attempt chip once, record its outcome in root-only `/run/waitron-disk-opened`, immediately extend PCR15 on every exit, then permit empty bootstrap fallback marked separately. Removal requires “chip”. The first-start service performs the proving restart; the rig observes. Use `tpm2_pcrextend` from `tpm2-tools`; seal PCRs 5/7/8/9 and PCR15’s zero reset. Keep measured files unchanged. Enrollment precedes a read-only `RemainAfterExit=yes` gate required by Docker service/socket. Rig-injected runtime-only overrides permit populate/recipe boots; none ships.

**Evidence.** TDD: adapters own mount binding/three-state ordering/secrets; callers own refusal/no Compose; recipe tests own Docker dependencies. Retain store/policy assertions; run those suites plus installed-start/recipe-setup. Delete empty-slot guard: refusal fails; restore/pass.

Persistent swtpm/firmware qualification installs, bootstraps, then boots setup twice. Require real TPM slot identity, nonzero PCR8/9 differing between stick/disk, one PCR15 extension, no bootstrap Docker, no prompt/shell, unchanged measured bytes, empty refusal and retained-key success. Missing TPM cannot qualify. Budget three hours to PR including 55-minute guest qualification. Forecast +680/−80 = 760; growth past 1,140 stops for watcher opinion. No ledger/protocol/framework. No physical session needed; the owner remains available for separately prepared measurement-only checks.

# B3-11 PR A: boot the recipe’s setup screen

**Proposal awaiting watcher approval.** Controlling scope is Lane K `questions.md`, WATCHER 2026-11-10 05:52:
> PR A: the recipe builds a disk image that boots to setup in an emulator on this Mac, with one boot check. Three hours to an open PR.

That note separates PR B’s image-consumed Demo restriction, reusing `setup.mode_not_allowed` and omitting `box-env.test.ts`. Read the [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) (D), [original plan](2026-10-26-b3-usb-installer.md), and `docs/backlog/box.md:981–990`. The local receipt `~/waitron-campaign-k/receipts/b3-recipe-feasibility-20261110/feasibility.md` proves minimal Debian direct-kernel/shell boot only. Waitron/Docker/firmware/TPM remain untested.

**Finish:** a developer runs one acceptance case and sees the existing setup screen and Prepare navigation from the built root. Deliver `waitron-box-dev.img`, an unencrypted ext4 development root, its kernel/initrd and inventory. This is not the encrypted installed layout or a settled installer transport. No automatic appliance startup: approved first-start sealing/restart remains later. PR A changes no app, compose, mode, field or error behavior.

| Owner | Exact paths | Estimated +/− |
| --- | --- | --- |
| Build | New `deploy/box/mkosi.conf`, `deploy/box/build.sh` | 230/0 |
| Tests | New `scripts/box/recipe-setup.test.mjs`; extend `scripts/box/rig-contract.test.mjs` | 140/0 |
| Support | New `scripts/box/recipe-setup.mjs`, `bench/box-installer/run.mjs`, `bench/box-installer/setup-smoke.service`, `bench/box-installer/Containerfile`; extend `scripts/box/rig-contract.mjs` | 330/0 |
| Docs | New `bench/box-installer/README.md`; update `deploy/README.md`, `docs/backlog.md`, `docs/backlog/box.md` and this plan | 100/35 |

Total **835 changed lines / 14 paths**. No generated outputs are committed. The container definition pins a Debian 13/Node 26 tool base, mkosi 25.3, QEMU, e2fsprogs and Chromium dependencies. Install frozen workspace dependencies; `run.mjs` resolves existing Playwright through `createRequire` at `apps/setup/package.json`, adding no dependency/lockfile. Mac launches the private Linux container and copies inputs/results with `docker cp`; no host mounts, sockets, loop devices or shared Docker state.

Build with mkosi `Format=directory`, generic dracut (`hostonly=no`, virtio/ext4), then `mkfs.ext4 -d` with a recorded UUID. Stage unchanged compose, root-owned `0600` `.env`, print-agent profile and BlueZ drop-in (`waitron.sh:199–317`); omit `WAITRON_ENV`, the origin key and AppArmor profile name. Install Docker Engine, Compose plugin, dracut, AppArmor, BlueZ/D-Bus, timesyncd and NetworkManager. Keep copyrights/notices. Clock/socket integration, NTP activation parity, kiosk and first-start remain open; the design’s dated line references stay historical.

Pull published amd64 app/agent images at resolved digests, plus pinned mailpit `v1.33.0`; save archives and record source labels. Pin guest Docker/backend. A networkless build-time QEMU boot loads archive-preserved tags from a read-only ext4 input drive. Pass the loading unit through systemd `systemd.extra-unit.*` SMBIOS credentials; it starts no app, clears machine identity and powers off. Timeout, nonzero exit or digest mismatch fails the build. Compare configuration-file SHA256 from input versus guest `docker save`; record guest IDs for acceptance, never equate host/guest `Id`. Inventory both Docker/containerd storage within this root.

**Future TDD and one acceptance case:** root `recipe-setup.mjs` owns pure argument/status/inventory/cleanup decisions, fully tested; add `recipe-setup` to existing `RIG_CASES`, retaining its parser. Unmeasured `run.mjs` owns Docker/QEMU/Playwright. Use fixed private-container paths and recorded IDs, avoiding a generic shared-path adapter/ledger. First observe missing-output/status assertions fail, implement, then repeat:

- `pnpm exec vitest run scripts/box/rig-contract.test.mjs scripts/box/recipe-setup.test.mjs`
- `deploy/box/build.sh /inputs /work/output`
- `B3_RECIPE_IMAGE=/work/output/waitron-box-dev.img node bench/box-installer/run.mjs --case recipe-setup --run-dir /work/check`

Acceptance boots the exact deliverable with `snapshot=on`, its own kernel/initrd and SMBIOS smoke unit, no image editing. Require unchanged artifact hash, mounted UUID, guest IDs, all three services and `compose up --pull never` without profiles. Use `restrict=on`, forwarding guest 443 only to container loopback 443. Assert status 200, `provisioned:false`, preproduction, `needs:["venue"]`, no development/operation flags (`setup-api.ts:748–777`), real nonblank `/setup` and Prepare navigation. Render in a throwaway `ignoreHTTPSErrors` context, recording CA fingerprint; this is not TLS qualification. Preserve serial/Docker logs, screenshot, hashes and timings; stop/remove only recorded resources.

Budget: first 25 minutes includes the initial recipe/Docker pass and confirms SMBIOS units, preload and setup startup. Refused builder, missing unit support or failure to reach setup within that allocation returns to the watcher, not an invented fallback. Remaining 155 minutes covers completion, focused checks, full run-it review, normal hook and opening the PR. Current-head CI precedes landing. README says CI does not rerun this recipe. Backlog updates move key-use/fingerprint, Linux adapters and `first-start.status` to later slices. PR B keeps `WAITRON_INSTALLATION_ORIGIN=usb`; release, encrypted host-state and real stick/box/Android checks stay open.

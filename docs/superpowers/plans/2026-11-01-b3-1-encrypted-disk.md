# B3 slice 1, first pull request: disk decision, rig ledger and retained disk-key store

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Build the parts of B3 slice 1 that an unprivileged macOS machine and CI's root Vitest project can fully test:

- the installer's disk classification;
- the bench rig's resource ledger;
- the host's retained disk-key store.

Nothing here runs on a box, and nothing here is a qualified boot path.

**Architecture:** Three small host libraries under `scripts/box/`, each a plain `.mjs` file with JSDoc types and a sibling `.test.mjs` in the root Vitest project. Anything that needs Linux, root, a loop device, a TPM or a virtual machine sits behind an injected function (a "seam": a function the caller passes in, so tests can supply a stand-in). The real Linux versions of those seams are not written in this pull request. Where a seam has no real version yet, the module's fixed production entry point refuses. A950 does the same thing: its `readAttempt` refuses when it has no IO adapter (`scripts/box/upgrades/journal.mjs`, "No production adapter is supplied until B3's host/layout qualification").

**Tech Stack:** Node 26 (`.nvmrc`), `node:fs/promises`, `node:crypto`, Vitest 4.1.12 root project. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §5.1 guard 3, §5.2, §6, §7.3, §7.5 ("Proposed host storage and delivery choice"), §7.6 and §7.7.

**Parent plan:** [six-slice plan](2026-10-26-b3-usb-installer.md), Slice 1, Tasks 1.1 and 1.2 (the unprivileged parts only).

**Build authority:** the owner's "Yes, build it", 2026-11-01, relayed by the lead session. The build is cut one pull request at a time.

**Review:** a fresh-context plan review (16 findings) was folded in on 2026-11-01. The driver adopted every finding, with three choices of its own:

- `replace` is dropped;
- the hardware check becomes a separate field;
- the key-leak sweep becomes its own task.

## Global Constraints

- **Machine limits on 2026-11-01:** macOS, Docker off until 3 November, no Linux, no VM tool, no TPM. Anything that needs those is not built here and is never described as working.
- **Retained-key path (proposed):** `/var/lib/waitron-host/disk-recovery/<LUKS UUID>.json`, mode `0600`, owned by root, inside root-only parent folders on the separately mounted `@host-state` (spec §7.5). A950 already fixed the folder convention for its own records on the same mount: root-owned `0700` folders and `0600` files ([A950 plan](2026-10-29-a950-automatic-upgrades.md) line 97). Use the same.
- **Mount check first.** Before any read or write, check that `/var/lib/waitron-host` is the expected disk's `@host-state` mount. If the mount is missing, refuse. Never write into the folder underneath it (spec §7.5).
- **The key** is 256 random bits, so 32 bytes (spec §7.5, P40). It never appears in a returned value, a thrown error, a log line, or any file other than its record and that record's same-folder staging file.
- **Reinstall makes a new disk and key.** Same-box cutover keeps the existing pair. Disk-key rotation is not designed (spec §7.5). So the store writes a record once per disk UUID and never replaces one.
- **Name tag:** anyone with the disk can read or forge it. It only names what the warning shows and never decides anything (spec §7.6).
- **Disks needing a person:** an unknown or damaged encrypted disk needs a keyboard. With several internal disks the installer picks none (parent plan, Global Constraints).
- **Coverage:** the root project holds `98/98/98/95` (`vitest.config.ts:120`). No `exclude`, no ignore comment, and no moving code into a testing folder.
- **Code style:** English only in code. Comments only for an invariant or a reason the code cannot show.
- **Commits:** `git commit -s`, staging only named paths, never `git add -A`.

## Review Focus

1. **A disk that is partly Waitron's**, after an interrupted header write. Examples: only the partition type survives; only the subsystem field survives; the two header copies disagree; the partition name is wrong; or a Waitron-named partition sits on a Windows disk. Expected: the classification is `unknown` (needs a keyboard), never `recognised-other` (erased without asking). Task 1.
2. **Two internal disks, or an external SSD the system does not mark removable.** Expected: `multiple` with `diskId: null`, never the first disk found. An `unknown` attachment counts as internal, and duplicate disk ids are refused. Task 1.
3. **A forged or very long name tag** (accented, longer than 48 UTF-8 bytes, or holding Waitron's marker text). Expected: the result is exactly the same as with no tag. Task 1.
4. **A `@host-state` mount that is missing, malformed, or belongs to another disk or folder.** Expected: zero files created and no key handed out. Zero file calls when the mount check throws, answers malformed, or names another disk or hostRoot. A removed root or a changed rootId costs one lstat of hostRoot. Tasks 4 and 5.
5. **An interrupted write, or a record copied under another disk's UUID.** Expected: no partial record is ever handed over, and disk A's key never opens for disk B. Task 5 states exactly which outcome each interrupted stage gives.

---

## What this pull request builds, and what it leaves out

**In (testable on this machine):**

| Task | File | Parent-plan source |
| --- | --- | --- |
| 1 | `scripts/box/disk-state.mjs` and test: `classifyDisk` | Task 1.1, red step |
| 2 | `scripts/box/rig-contract.mjs` and test: argument and run-folder rules | Task 1.1, rig-contract step |
| 3 | `scripts/box/rig-contract.mjs` and test: write-ahead ledger, cleanup of recorded resources only | Task 1.1, rig-contract step |
| 4 | `scripts/box/disk-key.mjs` and test: record format, path, owner and mount checks, read path | Task 1.2, red step |
| 5 | `scripts/box/disk-key.mjs` and test: atomic store, interrupted writes, one turn at a time | Task 1.2, red step |
| 6 | `scripts/box/disk-key.test.mjs`: key-leak sweep across Tasks 4 and 5 | Task 1.2, "no synthetic key canary" |
| 7 | Backlog, plus dated pointers in the spec and the six-slice plan | — |

**Out, and where each goes next:**

**PR 2: the preboot pure logic (parent Task 1.3).**

- The unlock gate: `scripts/box/preboot.mjs`, `createUnlockGate`, with the shared 2/4/8/16/32/60-second delay.
- The locked-mode redirect decision.
- The Wi-Fi record reader.

All three can be tested here, but together they would roughly double this review. The delay numbers remain the plan's proposal, not numbers the owner chose (spec §7.5).

**Recipe files: deferred to a pull request built on a Linux machine.**

- The files: `deploy/box/mkosi.conf`, `build.sh`, `first-start.sh`, `deploy/box/dracut/95waitron/` and `deploy/box/preboot/`.
- The machine they need has KVM, OVMF (UEFI firmware with Secure Boot for virtual machines) and swtpm (a software TPM).
- Nothing on this machine can build or boot them. Recipe text committed unrun would look finished without ever having executed; that is the testing guide's "a fixture no check reads" trap, applied to a build recipe.
- Docker coming back on 3 November does not by itself provide a TPM or a Secure Boot VM. That is my belief, not checked.

**Rig entry point and fixture factory: deferred to the same Linux pull request,** which adds the first case that can actually run.

- The files: `bench/box-installer/run.mjs` and `bench/box-installer/fixtures.mjs` (`createFixture`, `FixtureDisk`).
- Code under `bench/` is measured by nothing: it is outside the root test glob (`vitest.config.ts:71`) and outside root coverage (`vitest.config.ts:119`).
- A disk image with GPT, LUKS2 or BitLocker signatures built here could not be checked by `blkid` or `cryptsetup` on this machine.
- The rig's rules ship now, in Tasks 2 and 3. A later `run.mjs` stays a thin wrapper that imports them.
- Do not give `bench/box-installer/` a `package.json`: `bench/*` is a pnpm workspace glob (`pnpm-workspace.yaml:14`).

**Real seams: deferred to the Linux pull request.**

- Turning `lsblk`, `blkid`, `sfdisk` and `cryptsetup luksDump` output into a `MachineObservation`.
- The `@host-state` mount check (`/proc/self/mountinfo`, `subvol=/@host-state`, and the device-mapper UUID of the opened container).
- The real cleanup adapter: `umount`, `losetup -j`/`-d`, and stopping a VM only after checking that its process belongs to this run.
- First start: generate the key, store it, then add the keyslot.

**Root ownership checked as root: pending on the Linux rig.**

- The test suite runs unprivileged on macOS, and as the non-root `runner` user in CI. CI's `root-guards` job runs on `ubuntu-latest` and ends in `pnpm vitest run --coverage` (`.github/workflows/ci.yml:418-487`).
- The store compares each owner with an injected `ownerUid`. The fixed entry points pass `0`; tests pass `process.getuid()` and use other values as controls.
- So the code enforces the check, but no run here has seen a real root-owned file.

**Real power cuts: pending on the Linux rig.**

- Tasks 3 and 5 inject failures at chosen steps. That only imitates a power cut.
- On macOS, `fsync` does not ask the drive to flush its write cache. That is my belief, not run here; full flushing needs `F_FULLFSYNC`. So nothing here measures durability.
- Real cut-and-reboot cases on the chosen filesystem belong to the Linux rig.

**Seal experiments and slice-1 measurements: Linux or hardware work, none touched here.**

- Seal experiments (a) to (i).
- The `@volumes` rollback with `@logs` inside it.
- SQLite on btrfs.
- Image size.
- The hand-installed versus stick-installed file comparison.

**Open points from Task 1's review, for the owner or a later slice.**

- A lone disk whose attachment is `unknown` counts as internal (rule 1), so it can be the disk the installer erases. That is right for a second disk (it gives `multiple`), but for a lone disk it is for the owner or slice 2 to confirm.
- A Waitron disk whose two partition tables were both wiped reads as blank, and so as erasable. The observation has no field for "an encryption header found where Waitron's partition would start"; the Linux adapter has to decide how to look for one and report it.

## Re-map against main on 2026-11-01

The six-slice plan was written on 2026-10-26. This re-map checks it against main at `612535109`.

1. **`scripts/box/` already exists.** It holds A950's `upgrades/` (cuts 1–2, `ab08b4b94` and `024e0459e`).
   - A950's `JournalIo` uses an `inspectRoot()` seam that returns four fields, `{hostRoot, diskUuid, layoutDigest, rootId}`, and leaves the real adapter to B3.
   - The disk-key seam here, `inspectHostState()`, returns three fields, `{hostRoot, diskUuid, rootId}`. The shapes differ, so one adapter does **not** serve both as specified.
   - Whoever writes the Linux mount reader decides how the two answers relate. This pull request requires strict validation of its own seam's answer instead (Task 4).
   - A950 fixed `0700` folders and `0600` files under `/var/lib/waitron-host/updates/` (A950 plan line 97). The six-slice plan says only "root-only parents".
2. **The root globs already pick up `scripts/box/*.mjs`**, with no config change. Test include: `vitest.config.ts:71` (`scripts/**/*.test.mjs`). Coverage include: `vitest.config.ts:119` (`scripts/**/*.mjs`).
   - Checked by running `pnpm exec vitest run scripts/box/upgrades/settings.test.mjs`: 49 passed.
   - A coverage run with `--coverage.include=scripts/box/upgrades/settings.mjs` measured that file alone (8/8 statements) and exited 0.
3. **Nothing measures `bench/box-installer/`.** The parent plan says root coverage covers "the new tools", but `bench/` is in neither glob (`vitest.config.ts:71`, `:119`). So the rig rules live in `scripts/box/rig-contract.mjs`.
4. **`classifyDisk` takes a whole-machine observation.** The parent plan's `classifyDisk(input: DiskObservation)` cannot return `multiple`, because one disk says nothing about the others.
   - The input becomes a `MachineObservation`.
   - The TPM and Secure Boot state come back in a separate `hardware` field instead of a `refuse-hardware` kind (review finding 8). The spec fixes the order against guard 3 only by word order in §5 step 2, and guard 3's reason ("without leaving a venue dark") argues the other way.
   - Slice 2's installer policy decides that order, and Task 7 records it as a point for the owner.
   - `kind` loses `refuse-hardware` and gains `none` (no internal disk). The result also gains `layoutVersion` and `recognised`.
5. **The store's entry points take no path.** The parent plan's `storeDiskRecovery({diskUuid, key, hostRoot})` takes the host root as caller input, yet the same plan calls that override test-only. Here the fixed exports take no path; tests use `createDiskRecoveryStore(deps)`. The parent plan's "cut write preserving the previous whole record" assumed a replace operation, which has no caller in the spec, so it is dropped (Task 5 states the outcome for each interrupted stage).
6. **`deploy/waitron.sh` line numbers in the spec have moved.** The file last changed on 2026-10-31. Checked by reading:

   | What | Spec says | Now |
   | --- | --- | --- |
   | `ensure_docker` | `:143-165` | starts at `:144` |
   | `wait_healthy` | `:574-586` | `:597` |
   | `docker compose up -d --remove-orphans` | `:629` | `:684` and `:761` |
   | production reset refusal | `:659-662` | `:701-712` |

   `deploy/compose.yml:12` (`restart: unless-stopped`) still holds. The D-Bus socket mount is at `:150-151`, inside the spec's `:149-153`. The recipe pull request must re-read these.
7. **Slice 8's recovery-document files are gone.** A1187 part 1 (`58de3963a`, #2274) removed `apps/server/src/recovery-document-api.ts` and the dashboard recovery-document panel. The recovery pack replaced them (`backup-recovery-pack-*.ts`, `recovery-pack-card.ts`). A1187 part 3, the disk-key page, waits for B3 (`docs/backlog.md`). Slice 8 must re-map; this pull request is unaffected.
8. **The docs said "no build"** (backlog B3 entry, the spec's status line, box.md's B3 section); Task 7 rewrites the backlog and box.md lines and adds dated pointers to the spec and the six-slice plan.
9. **Still true, checked by reading:**
   - No `deploy/box/`, no `bench/box-installer/`, and no `.github/workflows/box-image.yml`.
   - `apps/server/src/self-signed-cert.ts:27-33` still names the permitted subtrees and commit `75f17f9e3`.
   - `apps/server/src/box-secrets.ts:41-52` still holds the `tls/` paths.

## Execution notes for every task

**Worktree.** Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-1-encrypted-disk`, and run commands from that folder.

**Style precedent.**
- `scripts/box/upgrades/contracts.mjs` sets the style for errors (`Object.assign(new Error(code), { code, reason })`) and for strict exact-key records.
- The real file operations follow the **test** adapter in `scripts/box/upgrades/journal.test.mjs:82-115`. That is where A950 does `wx` mode `0600` creates, `O_NOFOLLOW` opens, and file and folder flushes. `journal.mjs` itself imports no `fs` and ships no file adapter. `disk-key.mjs` and `rig-contract.mjs` **do** ship one, so their real file code is measured by coverage.
- `apps/server/src/box-secrets.ts:80` opens a folder with `O_RDONLY | O_DIRECTORY | O_NOFOLLOW`.

**Test conventions.**
- Tests import `describe`, `expect` and `it` from `vitest`.
- Real-file tests use `fs.realpath(await fs.mkdtemp(join(tmpdir(), "...")))` (macOS `/var` is a symlink to `/private/var`) and remove their folders in `afterEach`.
- Rejected inputs assert both `code` and `reason`.

**Letter case.** No test may depend on file-name letter case. The reviewer ran this: on macOS's default case-insensitive filesystem, `ABCDEF.json` opened as `abcdef.json` with `O_NOFOLLOW`. CI's Linux runner is case-sensitive (my belief, not run). So a case-dependent test could pass on one and fail on the other. UUID case is refused as `input-invalid` **before any file call**, and no test creates two files whose names differ only in case.

**Coverage for one file.** Read the summary counts; `0/0` means the include matched nothing. The run must exit 0 at 98/98/98/95; aim for 100%.
`pnpm exec vitest run scripts/box/<name>.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/<name>.mjs`

**Before each commit.** Run `pnpm exec prettier --check <files>` and `pnpm exec eslint <files>`, and read the `Tests` count (CLAUDE.md §4). The pre-push hook and CI do the rest; do not run the whole workspace.

**Long runs.** An implementer past about 150 tool calls with the task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover: what is done, what is left, which files, and each check's state.

**Order.** Run Tasks 1, 2→3 and 4→5→6 one after another in this worktree. They touch separate files, so working in parallel would need separate worktrees (CLAUDE.md §6). Task 7 comes last.

---

### Task 1: the installer's disk classification

**Files:**
- Create: `scripts/box/disk-state.mjs`
- Test: `scripts/box/disk-state.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the exports below, for slice 2's `installer-policy.mjs` and for the later Linux observation adapter.

```js
/** Waitron's own markers per layout version; every layout an installer ever wrote stays listed. */
export const WAITRON_LAYOUTS; // readonly [{ version: 1, typeGuid: "a8aaea61-baef-47f4-9cff-c4c967ee12c7", partitionName: "waitron-box", subsystem: "waitron-box-1" }]
export const MICROSOFT_RESERVED_TYPE; // "e3c9e316-0b5c-4db8-817d-f92df00215ae"
/** @param {MachineObservation} input @returns {DiskClassification} frozen */
export function classifyDisk(input);
/**
 * @typedef {{ state: 'valid'|'damaged'|'absent', subsystem: string|null, uuid: string|null }} HeaderObservation
 *   subsystem/uuid are non-null exactly when state === 'valid'; uuid is lowercase canonical.
 * @typedef {'none'|'ntfs'|'bitlocker'|'vfat'|'luks2'|'other'|'unreadable'} ContentKind   ext4 is 'other'
 * @typedef {{ content: ContentKind, luks: readonly [HeaderObservation, HeaderObservation]|null }} SignatureObservation
 *   luks (primary, secondary) is non-null exactly when content === 'luks2'.
 * @typedef {SignatureObservation & { typeGuid: string|null, name: string }} PartitionObservation
 *   typeGuid is lowercase canonical for GPT and null for MBR.
 * @typedef {object} DiskObservation
 * @property {string} diskId  a /dev/disk/by-id basename, never a path (pattern below)
 * @property {'internal'|'external'|'installer'|'unknown'} attachment
 * @property {'gpt'|'mbr'|'none'|'unreadable'} table
 * @property {readonly PartitionObservation[]} partitions  empty when table is none or unreadable
 * @property {SignatureObservation} whole  signature of the whole device (a disk with no partition table)
 * @property {Uint8Array|null} nameTag  raw name-tag bytes, display only
 * @typedef {object} MachineObservation
 * @property {'enabled'|'disabled'|'absent'|'unknown'} tpm
 * @property {'user-mode'|'setup-mode'|'off'|'unknown'} secureBoot
 * @property {readonly DiskObservation[]} disks
 * @typedef {object} DiskClassification
 * @property {'waitron'|'recognised-other'|'unknown'|'multiple'|'none'} kind
 * @property {string|null} diskId  null for multiple and none
 * @property {'no-tpm'|'secure-boot-off'|null} hardware  independent of kind; no-tpm wins when both fail
 * @property {number|null} layoutVersion  waitron only
 * @property {'blank'|'windows'|'bitlocker'|null} recognised  recognised-other only
 */
```

**What a disk id may contain.** `diskId` must match `/^(?:[A-Za-z0-9#+.:=@_-]|\\x[0-9a-f]{2})+$/`, be at most 255 bytes, and not be `.` or `..`.
- The receipt is systemd v257, fetched with `curl` on 2026-11-01: `src/shared/device-nodes.c:13-19` allows digits, letters and `#+-.:=@_` (the `allow_listed_char_for_devnode` function). `src/shared/udev-util.c:347-359` also keeps `\x` hex escapes and valid UTF-8.
- Non-ASCII UTF-8 is refused here. A disk whose by-id name carries one makes the observation invalid, so the installer writes nothing. That is the safe direction.
- Two things for the Linux adapter to confirm on real hardware: which udev rule builds each by-id name, and whether a real disk ever carries UTF-8.

**Malformed observations** throw `code: "disk.observation_invalid"`, `reason: "observation-invalid"`. That covers:
- a wrong type, or an extra or missing key;
- a `diskId` against the pattern, or two disks with the **same** `diskId`;
- a non-canonical GUID or UUID;
- a `luks` field that does not match `content`;
- partitions present when `table` is none or unreadable;
- a non-`Uint8Array` `nameTag`;
- a hole in the `disks`, `partitions` or `luks` array (a sparse array), which `forEach` would skip.

Slice 2 treats a throw as "write nothing".

**Classification rules.**

1. **Internal disks** are those whose `attachment` is `internal` or `unknown`. External disks and the installer stick are ignored.
2. **Count.** More than one internal disk gives `multiple`. None gives `none`. In both cases `diskId` is null.
3. **Hardware.** `hardware` is `no-tpm` when `tpm !== "enabled"`. Otherwise it is `secure-boot-off` when `secureBoot !== "user-mode"`. Otherwise it is null. It is computed whatever the kind, and it never changes the kind.
4. **The one internal disk:**
   - a) If `table`, `whole.content` or any partition's `content` is `unreadable`, the result is `unknown`. This holds even when a complete Waitron partition is also present.
   - b) **Any Waitron marker anywhere** sends the disk down this branch. A marker is any of:
     - a partition `typeGuid` from `WAITRON_LAYOUTS`;
     - a partition `name` from `WAITRON_LAYOUTS`;
     - a valid header whose `subsystem` is listed there, on a partition or on `whole`.

     The result is `waitron` only when all of the following hold; otherwise it is `unknown`.
     - Exactly one partition has one layout's `typeGuid` **and** its `partitionName` **and** `content: "luks2"`.
     - At least one of that partition's headers is valid with that layout's `subsystem`.
     - No valid header carries a different subsystem.
     - If both headers are valid, their uuids match.
     - No other partition, and no `whole` signature, carries any marker.
   - c) No marker, but some `luks2` content anywhere (foreign encryption): `unknown`.
   - d) `table: "none"` and `whole.content: "none"`: `recognised-other`, `blank`.
   - e) `whole.content` is `none`, `table` is gpt or mbr with at least one partition, every partition is `ntfs`, `bitlocker`, `vfat`, or `none` with `typeGuid === MICROSOFT_RESERVED_TYPE`, and at least one is `ntfs` or `bitlocker`: `recognised-other`. It is `bitlocker` if any partition is BitLocker, otherwise `windows`.
   - f) Anything else is `unknown`. That includes a partition table with **no** partitions, which narrows §5.2's "empty" in the safe direction: only a disk with no table at all counts as blank. Widening what is erased without asking is a later explicit decision.

`nameTag` is type-checked and read by no rule.

**Test helpers.** `completeWaitronDisk()` holds §6's three partitions:
- a 512 MiB EFI partition (`vfat`, EFI type GUID);
- a 1 GiB boot partition (`other`, which is ext4);
- the Waitron LUKS2 partition, whose two headers are valid and share one uuid.

`windowsDisk()` holds EFI `vfat`, an MSR partition (`none`), and two `ntfs` partitions (one is Windows recovery).

- [ ] **Step 1: Write the failing tests.** Every case asserts the full classification with `toEqual`.

  **Recognised disks**
  - `blank internal disk → {kind:"recognised-other", diskId, hardware:null, layoutVersion:null, recognised:"blank"}`.
  - `windowsDisk → recognised "windows"`.
  - `windowsDisk with one bitlocker partition → "bitlocker"`.
  - `MBR disk with ntfs → "windows"`.
  - `windowsDisk plus one "other" partition → unknown`.
  - `"none" partition whose type is not Microsoft reserved → unknown`.
  - `windowsDisk whose whole device reads as vfat | ntfs | other | bitlocker | unreadable | foreign luks2 → unknown`, and `MBR disk with ntfs whose whole device reads as other → unknown`.
  - `gpt table with zero partitions → unknown`.

  **Waitron disks**
  - `it.each(WAITRON_LAYOUTS)`: `completeWaitronDisk → {kind:"waitron", layoutVersion}`. Only version 1 exists today and no earlier layout has ever been written; the case name says so.
  - `primary damaged, secondary valid → waitron`.
  - `primary valid, secondary damaged → waitron`.
  - `primary valid, secondary absent → waitron`.

  **Review Focus 1: partly Waitron's**
  - `both headers damaged → unknown`.
  - `Waitron typeGuid with a foreign subsystem → unknown`.
  - `Waitron subsystem on a non-Waitron typeGuid → unknown`.
  - `Waitron typeGuid with content "none" → unknown`.
  - `Waitron typeGuid and valid Waitron headers but partition name "data" → unknown`.
  - `windowsDisk with one ntfs partition renamed "waitron-box" → unknown`.
  - `both headers valid with the SAME uuid but different subsystems (one Waitron, one foreign) → unknown`.
  - `both headers valid Waitron with different uuids → unknown`.
  - `completeWaitronDisk plus a second partition with the Waitron typeGuid → unknown`.
  - `completeWaitronDisk plus one unreadable partition → unknown`.
  - `whole-disk LUKS2 with the Waitron subsystem and no table → unknown`.

  **Foreign and unreadable disks**
  - `foreign LUKS2 partition → unknown`.
  - `whole-disk foreign LUKS2 → unknown`.
  - `unreadable table → unknown`.
  - `ntfs plus one unreadable partition → unknown`.
  - `completeWaitronDisk whose whole device is unreadable → unknown`.

  **Review Focus 2: which disks count**
  - `two internal Windows disks → {kind:"multiple", diskId:null}`.
  - `two internal complete Waitron disks → multiple`.
  - `one internal plus one "unknown" attachment → multiple`.
  - **Legitimate-case control**, with disks listed in this order: an **external** complete Waitron disk, then the `installer` stick, then one internal `windowsDisk`. Expected: `recognised-other` with the **internal** disk's id. Ignoring attachment counts three disks and gives multiple.
  - `only external disks → {kind:"none", diskId:null}`.
  - `two disks with the same diskId → disk.observation_invalid`.

  **Hardware**
  - `tpm "disabled" | "absent" | "unknown" → hardware "no-tpm"`, with kind unchanged.
  - `secureBoot "off" | "setup-mode" | "unknown" → "secure-boot-off"`.
  - `tpm disabled on completeWaitronDisk → {kind:"waitron", hardware:"no-tpm"}`.
  - `both failing → "no-tpm"`.

  **Review Focus 3: the name tag**
  For each of blank, `windowsDisk`, `completeWaitronDisk` and the damaged Waitron disk, the result is `toEqual` across every one of these tags:
  - `null`;
  - `"Bar Àngels"`;
  - an accented name with `Buffer.byteLength > 48` (assert the length in the test);
  - the bytes of `"waitron-box-1"`;
  - `{"live":true,"subsystem":"waitron-box-1"}` as UTF-8;
  - 4096 bytes of `0xff`.

  **Disk ids**
  - Accepted: `nvme-Samsung_SSD_980_500GB_S64DNF0R123456A`, `wwn-0x5002538e40a0b1c2`, and one id holding each of `#+=@` and a `\x20` escape.
  - Refused as `disk.observation_invalid`: `"../sda"`, `"/dev/sda"`, `"."`, `".."`, an id with `é`, and an id of 256 bytes.

  **Other malformed shapes:** each one listed above throws `disk.observation_invalid`. The returned object is frozen.

- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/disk-state.test.mjs`. Expect the failures to say `classifyDisk` is missing, not that a fixture failed to parse.
- [ ] **Step 3: Implement** `classifyDisk` and the two constants: pure, synchronous, no I/O.
- [ ] **Step 4: Run green.** Read the `Tests` count, then run the one-file coverage command.
- [ ] **Step 5: Deletion controls.** For each one, make the change, see the named test fail, then restore. Record each in the commit body.
  - Remove the "more than one internal disk" branch → "two internal Windows disks" fails.
  - Treat `unknown` attachment as external → "one internal plus one unknown attachment" fails.
  - Drop rule b's "any marker but incomplete → unknown" → "windowsDisk with one ntfs partition renamed waitron-box" fails. Without the rule, that disk would be erased without asking.
  - Drop "no valid header carries a different subsystem" → "SAME uuid but different subsystems" fails. The uuid rule cannot catch it.
  - Drop rule a for partitions → "completeWaitronDisk plus one unreadable partition" fails.
  - Add `if (disk.nameTag && disk.nameTag.length > 48) return unknown` → the Review Focus 3 table fails.
  - Ignore `attachment` → the legitimate-case control fails, which shows the rule does not wrongly refuse.
  - Remove the duplicate-id check → "two disks with the same diskId" fails.
  - Drop rule e's `whole.content === "none"` → the five Windows and MBR whole-device cases that rules a and c do not already refuse fail.
  - Drop rule a's whole-device check → "completeWaitronDisk whose whole device is unreadable" fails.
  - Iterate disks or luks headers with `forEach` → the sparse-array cases fail (a hole would otherwise pass validation).
  - Deleting rule c, or rule a's `table === "unreadable"` check, changes no result: rules d and e already refuse those disks. A comparison over 1,000,000 random single-disk observations found no difference, while a control mutant (rule e without its whole-device check) differed 13,614 times. Rule c stays so that a wider rule e cannot let foreign encryption through.
- [ ] **Step 6: Commit.** Run prettier and eslint, then `git add scripts/box/disk-state.mjs scripts/box/disk-state.test.mjs && git commit -s -m "feat(box): classify the disks an installer finds"`. The commit body names the deletion controls. It also says that the order of the hardware check against guard 3 is slice 2's, and that the observation adapter and real-disk fixtures wait for the Linux rig.

### Task 2: rig arguments and a fresh run folder

**Files:**
- Create: `scripts/box/rig-contract.mjs`
- Test: `scripts/box/rig-contract.test.mjs`

**Interfaces:**
- Produces the exports below. Task 3 extends the same file.

```js
/** Case names the argument parser recognises. None is runnable yet: each needs the Linux recipe and rig adapter, and a later PR wires it. */
export const RIG_CASES; // ["layout","seal-a","seal-b","seal-d","seal-f","seal-g","seal-i","preboot-local","preboot-headless","preboot-two-boxes","preboot-tamper"]
/** @param {readonly string[]} argv  arguments after the script name @returns {{caseName: string, runDir: string}} */
export function parseRigArgs(argv);
/** Creates runDir (mode 0700, parent must exist, never recursive) and an empty ledger. @returns {Promise<RigRun>} */
export async function createRun(runDir);
```

**Refusals** use `code: "rig.refused"` with one of these reasons:

| `reason` | When |
| --- | --- |
| `device-argument` | **Any** argv element that starts with `/dev/`. Checked first. |
| `argument-unknown` | Anything other than `--case <name>` and `--run-dir <path>`. |
| `argument-repeated` | Either option given twice. |
| `argument-missing` | Either option, or its value, missing. |
| `case-unknown` | A case not in `RIG_CASES`. |
| `run-dir-relative` | The run folder is not absolute. |
| `run-dir-unsafe` | The path does not equal its own `path.resolve`, holds a NUL, is `/`, or is `/dev` or under `/dev/`. |
| `run-dir-exists` | `EEXIST`, whether the folder is empty or not. |
| `run-dir-parent-missing` | The parent folder does not exist. |

**`createRun`** calls `fs.mkdir(runDir, { mode: 0o700 })` without `recursive`, so "does it exist?" and "create it" are one atomic step. It then writes `ledger.json` (Task 3's format with `resources: []`) using `wx`. `RigRun` is `{ runDir, rootId }`, where `rootId` is `"<dev>:<ino>"` from `lstat`.

- [ ] **Step 1: Write the failing tests.**
  - `parses --case layout --run-dir <abs> in either order`.
  - One case for each refusal in the table, asserting `code` and `reason`.
  - `/dev/sdb as the run folder → device-argument`.
  - `an extra /dev/nvme0n1 argument → device-argument`.
  - `"/tmp/x/../y" → run-dir-unsafe`.
  - `existing empty folder → run-dir-exists`, with its mode unchanged.
  - `existing non-empty folder → run-dir-exists`, with its file unchanged.
  - `missing parent → run-dir-parent-missing`, and nothing created.
  - `fresh path → the folder has mode & 0o777 === 0o700 and ledger.json holds {"version":1,"runDir":…,"resources":[]}`.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/rig-contract.test.mjs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green**, then run the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Remove the `/dev/` scan → both device-argument tests fail.
  - Pass `recursive: true` to `mkdir` → the existing-empty-folder test fails.
- [ ] **Step 6: Commit** the two files: `feat(box): refuse rig runs that name a device or reuse a folder`.

### Task 3: write-ahead resource ledger and cleanup of recorded resources only

**Files:**
- Modify: `scripts/box/rig-contract.mjs` and `scripts/box/rig-contract.test.mjs`

**Interfaces:**
- Consumes: `createRun` and `RigRun` (Task 2).
- Produces:

```js
/**
 * @typedef {{kind:'image', path:string}
 *   | {kind:'loop', image:string}       loop devices are found by their recorded backing image, never named by id
 *   | {kind:'mount', target:string}
 *   | {kind:'vm', pidFile:string}} RigResource   every path absolute, normalised, strictly inside runDir, with no part named ledger.json or ledger.json.next in any letter case
 * @typedef {{action:'stop-vm', pidFile:string}|{action:'unmount', target:string}
 *   |{action:'detach-loops', image:string}|{action:'remove-file', path:string}} CleanupStep
 * @typedef {{ stopVm(pidFile:string):Promise<void>, unmount(target:string):Promise<void>,
 *   detachLoops(image:string):Promise<void>, removeFile(path:string):Promise<void> }} CleanupAdapter
 */
/** Durably records the resource, then runs step. step never runs if recording fails. Calls on one RigRun take turns. */
export async function withRecorded(run, resource, step);
/** Checks the run, then reads and strictly validates its ledger.json; refuses any resource outside runDir. @returns {Promise<readonly RigResource[]>} */
export async function loadLedger(run);
/** Pure: reverse recording order; image → remove-file, loop → detach-loops, mount → unmount, vm → stop-vm. */
export function planCleanup(resources);
/** Loads the run's ledger itself and runs every step even after failures. @returns {Promise<{status:'clean'|'incomplete', failed: readonly CleanupStep[]}>} */
export async function runCleanup(run, adapter);
```

**The ledger file** is `{"version":1,"runDir":"…","resources":[…]}` plus a newline, in canonical bytes.

**`withRecorded` takes turns.** Calls on one `RigRun` go through an in-process promise chain, so each rewrite of the ledger includes every earlier record. Inside its turn, a call rewrites the ledger in four steps:
1. write `ledger.json.next` with `wx`, mode 0600;
2. flush that file;
3. rename it over `ledger.json`;
4. flush the folder.

Only then does the turn end and `step` run, outside the turn. A step may therefore record its own sub-resources without deadlocking.

**`loadLedger` refuses with `ledger-invalid`** when `ledger.json` is a symlink, missing, or not a regular file (it is opened with `O_NONBLOCK`, so a FIFO is refused rather than waited on), when the bytes are not canonical, when `runDir` differs from the folder being read, on an unknown kind or key, or when any path is outside `runDir` or under `/dev/`.

**Stopping a VM.** The real `CleanupAdapter` (Linux) must check that a VM's process is the one this run started before stopping it. That belongs to the Linux pull request.

Contract notes from the per-task review (2026-11-01):
- **Run checks.** `withRecorded`, `loadLedger` and `runCleanup` check the run as text first (`run-invalid`, then Task 2's `run-dir-*` reasons), then `lstat` the run folder: anything but a real folder whose `dev:ino` equals `rootId` is `run-dir-replaced`.
- **Symlinks on the way.** A resource path reached through an existing symlink is refused when recorded (`resource-through-symlink`); at cleanup that step fails without reaching the adapter. A path with any part named `ledger.json` or `ledger.json.next`, compared lower-cased, is refused as `resource-outside-run` before any file call, because a case-insensitive file system opens `LEDGER.JSON` as the ledger. At cleanup, a step whose path has the device and inode of the ledger or its staging file (a hard link, or a name the lower-casing misses) fails as `resource-is-ledger` without reaching the adapter.
- **Recording is not ownership.** Inside the turn, holding the staging-file lock, `withRecorded` refuses a resource the ledger already holds (`resource-duplicate`), a loop whose image is not a recorded image (`loop-image-unrecorded`), and an image or pid file path that already exists in any form (`resource-exists`), because cleanup removes or reads it. A mount's folder must exist before its step, so it is not refused for existing. A process running as the same user can still create a path between that check and the step. At cleanup, an image or pid file path that exists but is not a regular file fails as `resource-not-file` without reaching the adapter.
- **Cleanup takes no plan.** `runCleanup(run, adapter)` loads the ledger and re-checks the run folder and each path before every step; `planCleanup` stays pure and refuses unknown or inherited kinds.
- **Across processes.** The append opens `ledger.json.next` with `wx` before reading the ledger, so the staging file is the lock: a second process gets `EEXIST`, and a staging file left by a crash refuses every later record until removed.
- **The real adapter's duty (not built in this pull request).** These checks go by path; the Linux adapter must open every path beneath the run folder without following a symlink, with `openat2` and `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`.

- [ ] **Step 1: Write the failing tests.**
  - `step sees its resource already in ledger.json on disk` (the test reads the file inside `step`).
  - `two concurrent withRecorded calls → the ledger holds both resources`.
  - `the ledger write fails (ledger.json.next pre-created as a folder) → step never called, ledger unchanged`.
  - `resource outside runDir → rig.refused "resource-outside-run"`.
  - `/dev/loop0 as an image path → resource-outside-run`.
  - `loadLedger refuses a ledger edited to name /etc/passwd → ledger-invalid`.
  - `planCleanup reverses the order and maps each kind`.
  - `runCleanup passes the adapter exactly the recorded paths, in plan order` (a fake adapter records the calls).
  - `an unlisted file in runDir is never passed to the adapter`.
  - `one failing step → later steps still run, status "incomplete", failed names it`.
  - `all steps succeed → "clean"`.
- [ ] **Step 2: Run red**, using Task 2's command.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green**, then run the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Run `step` before recording → "step sees its resource" fails.
  - Remove the turn → the concurrent test fails. Run it 20 times, to see it fails reliably and not just once.
  - Remove the inside-`runDir` check in `loadLedger` → the `/etc/passwd` test fails.
  - Stop `runCleanup` at the first failure → the incomplete test fails.
- [ ] **Step 6: Commit:** `feat(box): record rig resources before creating them and clean up only those`.

### Task 4: retained disk-key record, path checks and the read path

**Files:**
- Create: `scripts/box/disk-key.mjs`
- Test: `scripts/box/disk-key.test.mjs`

**Interfaces:**

```js
export const HOST_ROOT; // "/var/lib/waitron-host"
/**
 * @typedef {object} HostStateIdentity  what the mount check saw
 * @property {string} hostRoot  @property {string} diskUuid  the opened container's LUKS UUID
 * @property {string} rootId  "<dev>:<ino>" of hostRoot
 * @typedef {object} DiskRecoveryDeps
 * @property {string} hostRoot  absolute, realpath-equal
 * @property {number} ownerUid  0 in production; tests pass process.getuid()
 * @property {() => Promise<HostStateIdentity>} inspectHostState
 * @property {DiskRecoveryIo} [io]  test-only override of the file operations, default node:fs/promises:
 *   one object with lstat, open, mkdir, writeFile, rename, unlink, syncFile, syncDirectory, readdir,
 *   so a test can count calls, fail any one, or alter one path's lstat answer.
 * @typedef {object} DiskRecoveryStore
 * @property {(input:{diskUuid:string, key:Uint8Array}) => Promise<void>} store   Task 5
 * @property {(input:{diskUuid:string}, consume:(key:Uint8Array)=>Promise<void>) => Promise<void>} withKey
 */
/** Test seam and the future host service's constructor; callers never take hostRoot from a request. */
export function createDiskRecoveryStore(deps);
/** Fixed production entry points. No inspectHostState adapter exists until the Linux rig, so both refuse "mount-unverified" before any file call. */
export async function storeDiskRecovery(input);
export async function withDiskRecovery(input, consume);
```

**Record.** The path is `<hostRoot>/disk-recovery/<diskUuid>.json`.
- Bytes: `{"version":1,"diskUuid":"<uuid>","key":"<64 lowercase hex>"}` plus a newline, canonical, at most 1024 bytes. Check the size through `handle.stat()` before reading.
- `diskUuid` must match `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`. That pattern stops path traversal; `O_NOFOLLOW` and `lstat` stop symlinks.

**Refusals** use `code: "disk_recovery.refused"`, and the error's message is the code alone. Checks run in this order:

| # | `reason` | When |
| --- | --- | --- |
| 1 | `input-invalid` | A bad UUID, a key that is not a 32-byte `Uint8Array`, or an all-zero key. Checked before any file call, so it never depends on file-name case. |
| 2 | `mount-unverified` | `inspectHostState` throws, or its answer is not strictly valid: exact keys `hostRoot`, `diskUuid`, `rootId`; a canonical UUID; `rootId` matching `/^\d+:\d+$/`; and `hostRoot` equal to the configured one. |
| 3 | `disk-mismatch` | The seam's `diskUuid` differs from the input's. |
| 4 | `mount-unverified` | `lstat(hostRoot)` answers `ENOENT`: a missing mount point is a missing mount. Any other `lstat` error gives `io-failed`. |
| 5 | `root-changed` | `lstat(hostRoot)`'s `dev:ino` differs from the seam's `rootId`. |
| 6 | `path-unsafe` | `hostRoot` or `disk-recovery` is a symlink or not a folder, or the record is a symlink or not a regular file. |
| 7 | `permissions-unsafe` | On `hostRoot`, `disk-recovery` or the record, the owner is not `ownerUid` or `mode & 0o077` is not 0. |
| 8 | `record-missing` | No record for this disk. |
| 8 | `record-corrupt` | The record fails the format above. |
| 8 | `record-mismatch` | The record's `diskUuid` differs from its file name. |
| — | `io-failed` | Any other file error. |
| — | `consumer-failed` | `consume` threw or rejected, with anything. |

**`withKey`** takes the store's turn (Task 5) for the checks and the read, and releases it before calling `consume`. A slow consumer therefore never blocks a store, and a `consume` that calls `store` cannot deadlock. It then:
- decodes the key into a fresh `Uint8Array` and awaits `consume`;
- overwrites that array with zeros in `finally`;
- returns `undefined` whatever `consume` returns;
- refuses any `consume` failure as `consumer-failed`: a fresh refusal holding neither the consumer's error nor a `cause`, because that error may hold the key (Global Constraints).

That array is the only copy this pull request zeros. Strings parsed from the file stay in memory until garbage collection, and nothing is claimed about their lifetime.

**The test stand-in.** In every test, `hostRoot` is a real temporary folder (chmod `0700`) and `ownerUid` is `process.getuid()`. Unless a case says otherwise, the stand-in mount check returns the folder, disk A's UUID, and the folder's real `dev:ino` captured **when the fixture is created**.

- [ ] **Step 1: Write the failing tests.** Records are written straight to disk by the test here; Task 5 adds `store`.

  **Reading**
  - `withKey hands consume exactly the stored 32 bytes, then the array is all zeros`.
  - `a throwing consume → consumer-failed, holding neither its error nor a cause, and the array still zeroed`.
  - `withKey returns undefined even when consume returns a value`.

  **Review Focus 4: the mount check**
  - `inspectHostState throws → mount-unverified; consume not called; the counting io saw zero calls`.
  - `the seam answers with an extra key | a missing rootId | rootId "x" | an upper-case UUID → mount-unverified, zero io calls`.
  - `the seam reports another hostRoot → mount-unverified`.
  - `the seam reports disk B → disk-mismatch`.
  - `the seam's rootId has the real inode but a different device → root-changed`.
  - `the seam's rootId has the same device but a different inode → root-changed`. (The reviewer believes, unrun, that btrfs subvolume tops all share inode 256; then only the device tells two mounts apart.)
  - `the fixed withDiskRecovery and storeDiskRecovery → mount-unverified`. They have no seam, so they refuse before any file call; the test pins the reason.

  **Folder replaced or missing**
  - `hostRoot replaced by a symlink to a copy holding a valid record → root-changed`. The stand-in still reports the identity captured at setup, and `lstat` now sees the link's own identity.
  - `the same, but the stand-in reports the link's own lstat identity → path-unsafe`.
  - `hostRoot removed → mount-unverified`.

  **Review Focus 5: another disk's key**
  - `record for disk A, request for disk B (stand-in also reports B) → record-missing, consume not called`.
  - `disk A's record copied under B's file name → record-mismatch`.

  **Symlinks inside the root**
  - `disk-recovery is a symlink to a folder holding a valid record → path-unsafe`.
  - `the record is a symlink → path-unsafe`.

  **Permissions, one level at a time.** The real-mode cases use `chmod`. The owner cases wrap io.lstat for hostRoot and disk-recovery, and wrap io.open so the returned handle's stat() reports uid: ownerUid + 1 for the record. The owner is never taken from an lstat of the record.
  - `hostRoot mode 0755 → permissions-unsafe`.
  - `disk-recovery mode 0755 → permissions-unsafe`.
  - `record mode 0644 → permissions-unsafe`.
  - `hostRoot owner wrong → permissions-unsafe`.
  - `disk-recovery owner wrong → permissions-unsafe`.
  - `record owner wrong → permissions-unsafe`.
  - `all three owners equal to ownerUid → the read succeeds`.

  **Corrupt records.** An `it.each` over each of these gives `record-corrupt`: invalid JSON; non-canonical spacing; an extra key; `version: 2`; a 63-character key; an upper-case-hex key; an all-zero key; a 2048-byte file.

  **Bad input.** Each of these gives `input-invalid` with zero io calls: `"../x"`, an upper-case UUID, `""`, `"a/b"`.

- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/disk-key.test.mjs`.
- [ ] **Step 3: Implement** `createDiskRecoveryStore` with `withKey` only, the fixed `withDiskRecovery`, the checks and the parser. Open the record with `O_RDONLY | O_NOFOLLOW` and stat it through its handle; `lstat` the two folders. Add one comment at the check: only root can write in root-only parents, so only root could swap a folder between the check and the open, and root is already trusted (spec §7.5, "they do not protect it from host root").
- [ ] **Step 4: Run green**, then run the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Remove the call to the mount seam → the throwing-seam test fails.
  - Remove the strict validation of the seam's answer → the malformed-answer tests fail.
  - Compare only the inode part of `rootId` → "real inode, different device" fails.
  - Remove the owner comparison → all three owner tests fail.
  - Check the owner on the record only (through its handle's stat()) → the `hostRoot` and `disk-recovery` owner tests fail.
  - Take the record's owner from an lstat before the open instead of from its handle → the record-owner test fails, because only io.open's handle reports the wrong uid.
  - Remove the record-UUID comparison → `record-mismatch` fails.
  - Remove the `fill(0)` → both zeroing tests fail.
- [ ] **Step 6: Commit:** `feat(box): read a disk's retained recovery key only from its checked host-state record`. The commit body says that the uid-0 check has not run as root, and that the real mount check waits for the Linux rig.

### Task 5: atomic store and interrupted writes

**Files:**
- Modify: `scripts/box/disk-key.mjs` and `scripts/box/disk-key.test.mjs`

**Interfaces:**
- Consumes: Task 4's deps, checks, parser and errors.
- Produces: `DiskRecoveryStore.store({diskUuid, key})`, and the fixed `storeDiskRecovery(input)`, which refuses `mount-unverified`.

**`store` writes once per disk.** There is no replace and no delete. Reinstall makes a new UUID, and the parent plan's "confirming a first sheet retains key bytes" holds because nothing can remove a record. A corrupt record stays refused until a reinstall or a later repair design; this pull request adds no repair.

**Sequence**, inside the store's turn: an in-process promise chain shared with `withKey`. A lock across processes is slice 3's host-service design.
1. Run Task 4's checks 1–7 on `hostRoot`.
2. If `disk-recovery` is absent, create it with mode `0700` (never `hostRoot`), then check it.
   Then flush `hostRoot`, on every store and not only after creating the folder: an earlier store may have created it and failed before this flush, and a retry cannot tell. A failure here is `io-failed`.
3. If `<uuid>.json` exists at all, valid or corrupt, refuse `record-exists`.
4. Unlink a leftover `<uuid>.json.next`. Only that fixed name is ever unlinked.
5. Write `.next` with `wx`, mode `0600`.
6. Flush the file.
7. Rename it to `<uuid>.json`.
8. Flush the folder. A failure here is reported as publication-unverified.
9. Read the record back through Task 4's parser. Refuse `publication-unverified` if it is not identical.

**After an interrupted store.** These injected failures only imitate a power cut (see "Out").

| Failing stage | `store` result | Afterwards |
| --- | --- | --- |
| `writeFile`, `syncFile` or `rename` | `io-failed` | `withKey` refuses `record-missing`. A leftover `.next` may remain; the next store removes it. |
| `syncDirectory` (the rename already happened) | `publication-unverified` | `withKey` hands over the **whole new** key. A retry gives `record-exists`. Callers read the record that now exists rather than writing again; this is the same shape as A950's `journal.test.mjs:471-501` (its `publish` reads back separately at `journal.mjs:372-379`, and `:427-430` maps every failure that is not already a journal refusal to `publication-unverified`). |
| any | — | No stage ever lets `withKey` hand over a partial key. |

- [ ] **Step 1: Write the failing tests.**
  - `store then withKey round-trips the bytes`, using a key of 32 **different** bytes (`(i * 7 + 3) % 256` for i from 0 to 31). The file has mode `0600` and the folder `0700`.
  - `store over an existing valid record → record-exists`, with the file bytes unchanged.
  - `store over a corrupt record → record-exists`, with the file unchanged.
  - `two concurrent stores for one disk → exactly one fulfilled, the other record-exists`.
  - `withKey started straight after store, on the same instance → receives the new key` (it queues behind the store's turn).
  - `it.each(["writeFile","syncFile","rename"])`: fail that stage through `deps.io` → `io-failed`, then `withKey` gives `record-missing`, then a fresh store succeeds and removes the leftover `.next`.
  - `syncDirectory fails after the rename → publication-unverified`; `withKey` gives the whole new key; a second store gives `record-exists`.
  - `the read-back returns different bytes (wrap io.open after the rename) → publication-unverified`.
  - `a truncated leftover .next (half the bytes) is ignored by withKey and removed by the next store`.
  - **Review Focus 4:**
    - `hostRoot removed (stand-in still answers) → mount-unverified, nothing created`;
    - `stand-in throws → mount-unverified`, and a recursive listing of `hostRoot` is empty afterwards;
    - `stand-in rootId names another folder → root-changed`, and no `disk-recovery` folder is created.
  - `store refuses a key that is all zeros or 31 bytes → input-invalid`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** `store` and `storeDiskRecovery`.
- [ ] **Step 4: Run green**, then run the coverage command for `disk-key.mjs`.
- [ ] **Step 5: Deletion controls.**
  - Write straight to `<uuid>.json` instead of `.next` → the `rename` failure case fails, because the record appears without a rename.
  - Remove the `record-exists` check → both "existing record" tests fail.
  - Remove the turn → the concurrent-store test fails (run it 20 times).
  - Skip the read-back → the different-bytes test fails.
  - Report a step-8 failure as io-failed → the syncDirectory case fails.
- [ ] **Step 6: Commit:** `feat(box): store a disk's recovery key once, atomically, on the checked host-state mount`.

### Task 6: key-leak sweep

**Files:**
- Modify: `scripts/box/disk-key.test.mjs` (a new `describe` block). Change `disk-key.mjs` only if the sweep finds a leak.

**Interfaces:**
- Consumes: `createDiskRecoveryStore`, `storeDiskRecovery` and `withDiskRecovery` (Tasks 4 and 5).
- Produces: nothing new.

**The key.** Use 32 **different** bytes, `(i * 7 + 3) % 256` for i from 0 to 31; 7 is coprime with 256, so all 32 values are distinct. The search forms are:
- lowercase and uppercase hex;
- hex with spaces (`03 0a 11 …`);
- base64 and base64url;
- the decimal list joined with `", "` and with `","` (the forms `Array.join` prints);
- `JSON.stringify` of the array (`{"0":3,"1":10,…}`);
- **every 8-byte window** of the key, in hex and in decimal-list form, so that a slice also counts as a leak.

- [ ] **Step 1: Write the sweep.** Run every path from Tasks 4 and 5, failures included:
  - each refusal reason;
  - each injected stage failure;
  - a throwing `consume` whose failure holds the key as hex, as base64 or as raw bytes in its message, as a property, or as the thrown value;
  - the fixed entry points.

  While doing so, spy on `console.*`, `process.stdout.write` and `process.stderr.write`. Collect every returned value and every thrown error's `message`, `stack`, `JSON.stringify(error)` and `util.inspect(error, { depth: 10 })`.

  Before matching the decimal forms, collapse every run of whitespace in the collected text to one space. util.inspect pads and wraps arrays; Array.join does not.

  Assert:
  - no form appears in any of them;
  - no console, stdout or stderr call happened at all;
  - the only files under the temporary root that contain any form are `<uuid>.json` and a leftover `<uuid>.json.next`, both in the `0700` folder. Scan every other file.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/box/disk-key.test.mjs`. If the sweep fails on today's code, fix the leak in `disk-key.mjs` and say so in the commit.
- [ ] **Step 3: Deletion controls (proving the sweep catches leaks).** For each one, make the change, see the sweep fail, then restore:
  - add `err.input = input` where a refusal is built (the 2026-11-01 run reported it in both `JSON.stringify(error)`'s `{"0":3,…}` form and `util.inspect`'s decimal form);
  - put the key's hex into a refusal's `reason`;
  - `console.log` the decoded key in `withKey`.
- [ ] **Step 4: Run the coverage command** for `disk-key.mjs` again. It is unchanged unless a leak was fixed.
- [ ] **Step 5: Commit:** `test(box): sweep every disk-key path for the key in any form`.

### Task 7: backlog and dated pointers

**Files:**
- Modify: `docs/backlog.md`, the B3 entry.
- Modify: `docs/backlog/box.md`, `## B3. The bootable USB installer`, lines 745–817. "authorised; no build" is at 751–752 and "Nothing built." is at 816.
- Modify: `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md`, one dated pointer line at the top.
- Modify: `docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, one dated pointer line at the top.

- [ ] **Step 1: Backlog entry.** Replace "no build" with three facts:
  - The owner authorised the build on 2026-11-01; it is cut one pull request at a time.
  - PR 1 (its number, filled in once the pull request exists) adds three host libraries under `scripts/box/`, none called yet: the disk classification; the rig's ledger and cleanup rules; the retained disk-key store.
  - What still waits:
    - the recipe and dracut files;
    - the rig entry point and disk fixtures;
    - the real observation, mount and cleanup adapters;
    - the root-owned check run as root;
    - real power cuts;
    - seal experiments (a)–(i) and every slice-1 measurement.

    All of these need a Linux machine with KVM, OVMF and swtpm, or the hardware. Keep the Android hold sentence exactly as it is.
- [ ] **Step 2: `docs/backlog/box.md`.** Make the same change at 751–752 and 816, and link this plan.
  - Add **one point for the owner**, in plain words: when a box with a Waitron disk has its TPM or Secure Boot switched off, should the stick start the installed box anyway, or stop and show the firmware message? The spec does not settle it (§5 step 2 lists the checks; guard 3 says "without leaving a venue dark"). Today's wording, «…vuelve a empezar», is written for installing. A box that already holds Waitron would need its own variant. Slice 2 decides, and this pull request reports both facts separately.
  - List re-map findings 3–7 as items for later slices.
- [ ] **Step 3: Pointers.** At the top of the spec and of the six-slice plan, add: `> 2026-11-01: the owner authorised the build; PR 1's plan and its re-map against main: [2026-11-01-b3-1-encrypted-disk.md](…).` Do not rewrite either historical body (CLAUDE.md §6, docs).
- [ ] **Step 4: Guides and CLAUDE.md.** No guide changes: nothing a person sees changed. No CLAUDE.md line unless a task above paid for a new trap; if one did, add one line plus a pointer.
- [ ] **Step 5: Commit** in this branch (it is not a docs-only branch): `docs(backlog): record B3's first built pull request and what still waits for Linux`.

---

## Self-review

**Spec coverage for this pull request.**

| Spec section | Where |
| --- | --- |
| §5.1 guard 3 markers; §5.2 recognised, unknown and multiple; §7.7 checks reported separately | Task 1 |
| §7.6 name tag decides nothing | Task 1, Review Focus 3 |
| §7.5 storage contract: path, modes, mount check, UUID binding, refusals | Tasks 4–5 |
| §7.5 nothing in logs or outputs | Task 6 |
| Parent Task 1.1's rig contract | Tasks 2–3 |

Every other slice-1 sentence is listed under "Out", with where it goes.

**Names.** These match the parent ledger where it named them: `classifyDisk`, `kind`, `diskId`, `storeDiskRecovery`, `withDiskRecovery`. Deviations are recorded in re-map findings 4 and 5.

**What the planner ran:**
- the existing `scripts/box/upgrades/settings.test.mjs` through the root project: 49 passed;
- a one-file coverage run: 8/8 statements;
- `node -e`, to generate the layout GUID and to confirm that `O_DIRECTORY` and `O_NOFOLLOW` exist and that `process.getuid()` is 503 here;
- `curl` of systemd v257's `device-nodes.c` and `udev-util.c`, for the disk-id character rule.

**What the planner only read:** everything else, including every line number cited here. Those were re-checked on 2026-11-01 after the review fold.

No test of the code above has run, because none of it exists yet.

# B3 slice 1, first pull request: disk decision, rig ledger and retained disk-key store

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Build the parts of B3 slice 1 that an unprivileged macOS machine and CI's root Vitest project can fully test: the installer's disk decision, the bench rig's resource ledger, and the host's retained disk-key store. Nothing here runs on a box, and nothing here is a qualified boot path.

**Architecture:** Three small host libraries under `scripts/box/`, each a plain `.mjs` file with JSDoc types and a sibling `.test.mjs` in the root Vitest project. Anything that needs Linux, root, a loop device, a TPM or a virtual machine sits behind an injected function (a "seam": a function the caller passes in, so tests can supply a stand-in). The real Linux versions of those seams are not written in this pull request. Where a seam has no real version yet, the module's fixed production entry point refuses, the way A950's `readAttempt` does when it has no IO adapter (`scripts/box/upgrades/journal.mjs`, "No production adapter is supplied until B3's host/layout qualification").

**Tech Stack:** Node 26 (`.nvmrc`), `node:fs/promises`, `node:crypto`, Vitest 4.1.12 root project. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §5.1 guard 3, §5.2, §6, §7.3, §7.5 ("Proposed host storage and delivery choice"), §7.6, §7.7. Parent plan: [six-slice plan](2026-10-26-b3-usb-installer.md), Slice 1, Tasks 1.1 and 1.2 (the unprivileged parts only). Build authority: the owner's "Yes, build it", 2026-11-01, relayed by the lead session; built one pull request at a time.

## Global Constraints

- Machine limits on 2026-11-01: macOS, Docker off until 3 November, no Linux, no VM tool, no TPM. Anything that needs those is not built here and is never described as working.
- Proposed retained-key path: `/var/lib/waitron-host/disk-recovery/<LUKS UUID>.json`, mode `0600`, owned by root, inside root-only parent folders on the separately mounted `@host-state` (spec §7.5). A950 already fixed the folder convention for its own records on the same mount: root-owned, `0700` folders, `0600` files ([A950 plan](2026-10-29-a950-automatic-upgrades.md) line 97). Use the same.
- Before any read or write, check that `/var/lib/waitron-host` is the expected disk's `@host-state` mount. If the mount is missing, refuse. Never write into the folder underneath it (spec §7.5).
- The key is **256 random bits**, so 32 bytes (spec §7.5, P40). It never appears in a returned value, a thrown error, a log line or any file other than its record.
- Name tag: anyone with the disk can read or forge it. It only names what the warning shows and never decides anything (spec §7.6).
- An unknown or damaged encrypted disk needs a keyboard. When there are several internal disks, the installer picks none (parent plan, Global Constraints).
- Coverage: the root project holds `98/98/98/95` (`vitest.config.ts:120`). No `exclude`, no ignore comment, no moving code under a testing folder.
- English only in code. Write comments only for an invariant or a reason the code cannot show.
- Commit with `git commit -s` and stage only the files you name. Never use `git add -A`.

## Review Focus

1. **A disk that is partly Waitron's**, after an interrupted header write: only the partition type survives, or only the encrypted container's subsystem field, or the two header copies disagree. The decision must be `unknown` (keyboard needed), never `recognised-other` (erased without asking). Task 1.
2. **Two internal disks, or an external SSD that the system does not mark as removable.** The decision must be `multiple` with `diskId: null`, never the first disk found. A USB-attached disk reported as `unknown` counts as internal. Task 1.
3. **A forged or very long name tag**: accented, longer than 48 bytes in UTF-8, or containing Waitron's marker text. It must leave the decision object exactly as it would be without the tag. Task 1.
4. **The `@host-state` mount is missing or belongs to another disk**: zero file-system calls and zero files created, and no key handed out. Task 4.
5. **A write cut part-way**, or a record that was moved or renamed so it now sits under another disk's UUID: the previous whole record is still read, or the store refuses. Never a partial record, and disk A's key never opens for disk B. Tasks 4 and 5.

---

## What this pull request builds, and what it leaves out

**In (machine-testable):**

| Task | File | Parent-plan source |
| --- | --- | --- |
| 1 | `scripts/box/disk-state.mjs` + test: `classifyDisk` | Task 1.1, red step |
| 2 | `scripts/box/rig-contract.mjs` + test: argument and run-folder rules | Task 1.1, rig-contract step |
| 3 | `scripts/box/rig-contract.mjs` + test: ledger written before each step, cleanup of recorded resources only | Task 1.1, rig-contract step |
| 4 | `scripts/box/disk-key.mjs` + test: record format, path, owner and mount checks, read path | Task 1.2, red step |
| 5 | `scripts/box/disk-key.mjs` + test: atomic store, interrupted writes, one write at a time, key-leak sweep | Task 1.2, red step |
| 6 | Backlog, plus dated pointers in the spec and the six-slice plan | — |

**Out, and where each part goes next:**

- **The preboot unlock gate** (`scripts/box/preboot.mjs`, `createUnlockGate` with the shared 2/4/8/16/32/60-second delay), the locked-mode redirect decision and the Wi-Fi record reader (parent Task 1.3, pure parts). These go in **PR 2**. All three can be tested on this machine, but adding them would roughly double this review. The 2/4/8/16/32/60 numbers are still the plan's proposal, not numbers the owner chose (spec §7.5).
- **The recipe files**: `deploy/box/mkosi.conf`, `build.sh`, `first-start.sh`, `deploy/box/dracut/95waitron/`, `deploy/box/preboot/`. These are **deferred to a pull request built on a Linux machine** that has KVM, OVMF (UEFI firmware for virtual machines, with Secure Boot) and swtpm (a software TPM). Nothing on this machine can build or boot them. Committing them unrun would put recipe text in the tree that looks finished and has never executed. This is the "a fixture no check reads" trap (testing guide), applied to a build recipe. Docker coming back on 3 November does not by itself provide a TPM or a Secure Boot VM. That is my belief and has not been checked.
- **The bench entry point** `bench/box-installer/run.mjs` and the fixture factory `bench/box-installer/fixtures.mjs` (`createFixture`, `FixtureDisk`). Both are deferred to that Linux pull request, which adds the first case that can actually run. Two reasons. First, `bench/` is outside the root test glob (`vitest.config.ts:71`) and outside root coverage (`vitest.config.ts:119`), so code placed there is measured by nothing. Second, a disk image built here with real GPT, LUKS2 or BitLocker signatures could not be checked by `blkid` or `cryptsetup` on this machine. The rules the rig must follow ship now in Tasks 2 and 3, under `scripts/box/`, where coverage measures them. When `bench/box-installer/run.mjs` is added, it stays a thin wrapper that imports `rig-contract.mjs`. `bench/*` is a pnpm workspace glob (`pnpm-workspace.yaml:14`), so do not give it a `package.json`.
- **The real seams**, all for the Linux pull request:
  - turning `lsblk`, `blkid`, `sfdisk` and `cryptsetup luksDump` output into a `MachineObservation`;
  - checking the `@host-state` mount (`/proc/self/mountinfo`, `subvol=/@host-state`, the device-mapper UUID of the opened container);
  - the real cleanup adapter (`umount`, `losetup -j`/`-d`, stopping a VM only after checking that its process is the one this run started);
  - the first-start flow that generates the key, stores it, then adds the keyslot.
- **Root ownership checked as root.** The test suite runs unprivileged on macOS and as the non-root `runner` user in CI (`root-guards` runs on `ubuntu-latest`, `.github/workflows/ci.yml:418-486`). The store compares each file's owner with an injected `ownerUid`. The fixed production entry points pass `0`; the tests pass `process.getuid()` and use a different uid as a control. So the code enforces the owner check, but no run here has observed a real root-owned file. That check stays **pending on the Linux rig**.
- **Seal experiments (a) to (i)**, the `@volumes` rollback with `@logs` inside it, SQLite on btrfs, image size, and the hand-installed versus stick-installed file comparison. All Linux or hardware work; none of it is touched here.

## Re-map against main on 2026-11-01

The six-slice plan was written on 2026-10-26. Checked against main `612535109`:

1. **`scripts/box/` already exists.** It holds A950's `upgrades/` (cuts 1–2, `ab08b4b94`, `024e0459e`). Its `JournalIo` uses an `inspectRoot()` seam returning `{hostRoot, diskUuid, layoutDigest, rootId}` and leaves the production adapter to B3. Name the disk-key mount seam to match (`inspectHostState`), so one Linux adapter can later serve both. A950 also fixed `0700` folders and `0600` files under `/var/lib/waitron-host/updates/` (A950 plan line 97). The six-slice plan only says "root-only parents".
2. **The root test and coverage globs pick up `scripts/box/*.mjs` with no config change.** Test include: `vitest.config.ts:71` (`scripts/**/*.test.mjs`). Coverage include: `vitest.config.ts:119` (`scripts/**/*.mjs`). Checked by running `pnpm exec vitest run scripts/box/upgrades/settings.test.mjs` (49 passed). A coverage run with `--coverage.include=scripts/box/upgrades/settings.mjs` measured that file alone (8/8 statements) and exited 0.
3. **`bench/box-installer/` would be measured by nothing.** The parent plan says root coverage covers "the new tools", but `bench/` is in neither glob (`vitest.config.ts:71`, `:119`). This plan therefore puts the rig rules in `scripts/box/rig-contract.mjs`.
4. **The parent plan's `classifyDisk(input: DiskObservation)` cannot return `multiple` or `refuse-hardware`.** One disk's observation says nothing about other disks, the TPM or Secure Boot. The input becomes a `MachineObservation` that contains the disks. `DiskDecision` gains `reason`, `layoutVersion` and `recognised`, and keeps `kind` and `diskId` as the parent plan names them.
5. **The parent plan's `storeDiskRecovery({diskUuid, key, hostRoot})` takes the host root as caller input, yet the same plan says that override is test-only.** Here the fixed exports take no path. The test-only path and uid go through `createDiskRecoveryStore(deps)`.
6. **`deploy/waitron.sh` line numbers in the spec have moved** (the file last changed 2026-10-31). Checked by reading:
   - `ensure_docker` still starts at `:144`;
   - `wait_healthy` is now `:597`, not `:574-586`;
   - `docker compose up -d --remove-orphans` is at `:684` and `:761`, not `:629`;
   - the production reset refusal is at `:701-712`, not `:659-662`.

   The recipe pull request must re-read these. `deploy/compose.yml:12` (`restart: unless-stopped`) still holds. The D-Bus socket mount is at `:150-151`, inside the spec's `:149-153`.
7. **Slice 8 bindings named in the parent file map are gone.** `apps/server/src/recovery-document-api.ts` and the dashboard recovery-document panel were removed by A1187 part 1 (`58de3963a`, #2274). The recovery pack replaced them (`backup-recovery-pack-*.ts`, `recovery-pack-card.ts`). A1187 part 3, the disk-key page, waits for B3 (`docs/backlog.md:4920`). This does not affect this pull request. Slice 8 must re-map before binding.
8. **The backlog and spec still say "no build"** (`docs/backlog.md:5151`; the spec's status line; `docs/backlog/box.md:751-752`). Task 6 adds dated pointers.
9. **Still true:** no `deploy/box/`, no `bench/box-installer/`, no `.github/workflows/box-image.yml`. `apps/server/src/self-signed-cert.ts:27-33` still names the permitted subtrees and the commit `75f17f9e3`. `apps/server/src/box-secrets.ts:41-52` still holds the `tls/` paths. All checked by reading.

## Execution notes for every task

- Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-1-encrypted-disk`. Run every command from that folder.
- Style precedent: `scripts/box/upgrades/contracts.mjs` and `journal.mjs`. Errors are built as `Object.assign(new Error(code), { code, reason })`; inputs are strict exact-key records; files are written with `wx` mode `0600`, flushed, renamed, and the folder flushed; reads open with `O_NOFOLLOW`. Tests import `describe/expect/it` from `vitest`. Real-file tests use `fs.realpath(await fs.mkdtemp(join(tmpdir(), "...")))`, because on macOS `/var` is a symlink to `/private/var`, and remove their folders in `afterEach`.
- Rejected inputs assert both `code` and `reason`, never only that an `Error` was thrown (CLAUDE.md §4).
- Coverage for one file, read from the summary counts (a summary of `0/0` means the include matched nothing):
  `pnpm exec vitest run scripts/box/<name>.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/<name>.mjs`
  It must exit 0 at 98/98/98/95. Aim for 100%.
- Before each commit, run `pnpm exec prettier --check <files>` and `pnpm exec eslint <files>`. Read the `Tests` count (CLAUDE.md §4). The pre-push hook and CI run the rest; do not run the whole workspace.
- An implementer that passes about 150 tool calls with the task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover: what is done, what is left, which files, and the state of each check.
- Order: Tasks 1, 2→3 and 4→5 touch separate files. Run them one after another in this worktree. Parallel work would need separate worktrees (CLAUDE.md §6). Task 6 comes last.

---

### Task 1: the installer's disk decision

**Files:**
- Create: `scripts/box/disk-state.mjs`
- Test: `scripts/box/disk-state.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the following, for slice 2's `installer-policy.mjs` and for the later Linux observation adapter.

```js
/** Waitron's own markers per layout version; every layout an installer ever wrote stays listed. */
export const WAITRON_LAYOUTS; // readonly [{ version: 1, typeGuid: "a8aaea61-baef-47f4-9cff-c4c967ee12c7", partitionName: "waitron-box", subsystem: "waitron-box-1" }]
export const MICROSOFT_RESERVED_TYPE; // "e3c9e316-0b5c-4db8-817d-f92df00215ae"
/** @param {MachineObservation} input @returns {DiskDecision} frozen */
export function classifyDisk(input);
/**
 * @typedef {{ state: 'valid'|'damaged'|'absent', subsystem: string|null, uuid: string|null }} HeaderObservation
 *   subsystem/uuid are non-null exactly when state === 'valid'; uuid is lowercase canonical.
 * @typedef {'none'|'ntfs'|'bitlocker'|'vfat'|'luks2'|'other'|'unreadable'} ContentKind
 * @typedef {{ content: ContentKind, luks: readonly [HeaderObservation, HeaderObservation]|null }} SignatureObservation
 *   luks (primary, secondary) is non-null exactly when content === 'luks2'.
 * @typedef {SignatureObservation & { typeGuid: string|null, name: string }} PartitionObservation
 *   typeGuid is lowercase canonical for GPT and null for MBR.
 * @typedef {object} DiskObservation
 * @property {string} diskId  a /dev/disk/by-id basename token, never a path: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
 * @property {'internal'|'external'|'installer'|'unknown'} attachment
 * @property {'gpt'|'mbr'|'none'|'unreadable'} table
 * @property {readonly PartitionObservation[]} partitions  empty unless table is gpt or mbr
 * @property {SignatureObservation} whole  signature of the whole device (a disk with no partition table)
 * @property {Uint8Array|null} nameTag  raw name-tag bytes, display only
 * @typedef {object} MachineObservation
 * @property {'enabled'|'disabled'|'absent'|'unknown'} tpm
 * @property {'user-mode'|'setup-mode'|'off'|'unknown'} secureBoot
 * @property {readonly DiskObservation[]} disks
 * @typedef {object} DiskDecision
 * @property {'waitron'|'recognised-other'|'unknown'|'multiple'|'refuse-hardware'} kind
 * @property {string|null} diskId  null for multiple and refuse-hardware
 * @property {'no-internal-disk'|'no-tpm'|'secure-boot-off'|null} reason  refuse-hardware only
 * @property {number|null} layoutVersion  waitron only
 * @property {'blank'|'windows'|'bitlocker'|null} recognised  recognised-other only
 */
```

A malformed observation throws `code: "disk.observation_invalid"` with `reason: "observation-invalid"`. That covers a wrong type, an extra or missing key, a `diskId` containing `/` or `..`, a non-canonical GUID or UUID, a `luks` that does not match `content`, or a non-`Uint8Array` `nameTag`. Slice 2 treats a throw as "write nothing".

**Decision order.** The order is the design, so it is fixed here:
1. Internal disks are those whose `attachment` is `internal` or `unknown`. `external` and `installer` are ignored. An `unknown` USB SSD therefore counts, and the safe result is `multiple`.
2. More than one internal disk → `multiple`. None → `refuse-hardware`, `no-internal-disk`.
3. `tpm !== "enabled"` → `refuse-hardware`, `no-tpm`. `secureBoot !== "user-mode"` → `refuse-hardware`, `secure-boot-off`. **This is a planner's call, open to review: hardware refusal comes before guard 3.** Both outcomes write nothing. A Waitron disk on a box whose TPM or Secure Boot has been switched off cannot unseal, because its seal includes register 7 and the chip (§7.2). Starting it would land on the recovery screen and need the key. The refusal names the firmware setting that fixes the problem with no key. If review prefers guard 3 first, swap the steps and the two tests named below together.
4. Classify the one internal disk:
   - a) `table`, `whole.content` or any partition's `content` is `unreadable` → `unknown`.
   - b) **Any Waitron marker anywhere** sends the disk down this branch. A marker is any partition `typeGuid` or `name` from `WAITRON_LAYOUTS`, or any valid header whose `subsystem` is listed there, on a partition or on `whole`. The result is `waitron` only if all of the following hold:
     - exactly one partition matches one layout's `typeGuid` **and** `partitionName` **and** has `content: "luks2"`;
     - at least one of its headers is `valid` with that layout's `subsystem`;
     - no valid header carries a different subsystem;
     - two valid headers carry the same `uuid`;
     - no other partition and no `whole` signature carries any marker.

     Otherwise the result is `unknown`.
   - c) No marker, and some `luks2` content anywhere (foreign encryption) → `unknown`.
   - d) `table: "none"` and `whole.content: "none"` → `recognised-other`, `blank`.
   - e) `table` is gpt or mbr, and every partition is `ntfs`, `bitlocker`, `vfat`, or `none` with `typeGuid === MICROSOFT_RESERVED_TYPE`, and at least one is `ntfs` or `bitlocker` → `recognised-other`. It is `bitlocker` if any partition is BitLocker, otherwise `windows`.
   - f) Anything else → `unknown`. Widening the list of systems erased without asking is a later explicit decision, not an implementer's call.

`nameTag` is checked for type and nothing else. It is never read by any rule.

- [ ] **Step 1: Write the failing tests** in `disk-state.test.mjs`. Build observations with small factory helpers: `waitronPartition()`, `windowsDisk()`, `machine({disks})`. Each case asserts the full decision with `toEqual`:
  - `blank internal disk → {kind:"recognised-other", diskId, recognised:"blank", reason:null, layoutVersion:null}`
  - `Windows (EFI vfat + MSR none + ntfs + recovery ntfs) → recognised "windows"`; `same with one bitlocker partition → recognised "bitlocker"`; `MBR ntfs → "windows"`
  - `Windows disk plus one ext4 ("other") partition → unknown`; `"none" partition whose type is not Microsoft reserved → unknown`
  - `it.each(WAITRON_LAYOUTS)`: `complete layout → {kind:"waitron", layoutVersion: version}`. Only version 1 exists today, and no earlier layout has ever been written. Say so in the case name, so nobody reads it as evidence about earlier installers.
  - `primary header damaged, secondary valid Waitron → waitron`; `primary valid, secondary damaged → waitron`; `primary valid, secondary absent → waitron`
  - **Review Focus 1:**
    - `both headers damaged on a Waitron partition → unknown`;
    - `Waitron typeGuid with a foreign subsystem → unknown`;
    - `Waitron subsystem on a non-Waitron typeGuid → unknown`;
    - `Waitron typeGuid with content "none" (header wiped) → unknown`;
    - `partition named "waitron-box" on a Windows disk → unknown`;
    - `valid headers with different subsystems → unknown`; `valid headers with different uuids → unknown`;
    - `a complete Waitron partition plus a second partition carrying the Waitron typeGuid → unknown`;
    - `whole-disk LUKS2 with the Waitron subsystem and no table → unknown`.
  - `foreign LUKS2 partition (valid headers, other subsystem) → unknown`; `whole-disk foreign LUKS2 → unknown`; `unreadable table → unknown`; `ntfs + one unreadable partition → unknown`
  - **Review Focus 2:**
    - `two internal Windows disks → {kind:"multiple", diskId:null}`;
    - `two internal complete Waitron disks → multiple, diskId null`;
    - `one internal + one "unknown" attachment → multiple`;
    - **legitimate-case control:** `one internal Waitron + the installer stick + one external USB disk → waitron with the internal diskId`;
    - `only external disks → refuse-hardware "no-internal-disk", diskId null`.
  - `tpm "disabled" | "absent" | "unknown" → refuse-hardware "no-tpm"`; `secureBoot "off" | "setup-mode" | "unknown" → "secure-boot-off"`; `tpm disabled on a complete Waitron disk → refuse-hardware "no-tpm"` (pins the step-3 order)
  - **Review Focus 3:** for each of a blank disk, a Windows disk, a complete Waitron disk and a damaged Waitron disk, `classifyDisk` must give the same `toEqual` result for every tag in this list:
    - `null`;
    - `"Bar Àngels"`;
    - an accented name with `Buffer.byteLength > 48` (assert the length in the test);
    - the bytes of `"waitron-box-1"`;
    - `{"live":true,"subsystem":"waitron-box-1"}` as UTF-8;
    - 4096 bytes of `0xff`.
  - Each malformed shape listed above throws `disk.observation_invalid`. Include a `diskId` of `"../sda"` and of `"/dev/sda"`. The returned decision is frozen (`Object.isFrozen`).
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/disk-state.test.mjs`. Expect failures because `classifyDisk` is missing, not because a fixture fails to parse.
- [ ] **Step 3: Implement** `classifyDisk` and the two constants in `disk-state.mjs`, following the decision order above. Pure, synchronous, no I/O.
- [ ] **Step 4: Run green.** Run the same command and read the `Tests` count. Run the single-file coverage command and expect 98/98/98/95 or better.
- [ ] **Step 5: Deletion controls.** Make each change below, run, see the named test fail, then restore. Record each in the commit message.
  - Remove the `internal.length > 1` branch → "two internal Windows disks" fails.
  - Count `unknown` attachment as external → "one internal + one unknown attachment" fails.
  - Drop the "any marker but incomplete → unknown" rule → "Waitron typeGuid with content none" fails.
  - Drop the "no valid header carries a different subsystem" check → "valid headers with different subsystems" fails.
  - Add `if (disk.nameTag && disk.nameTag.length > 48) return unknown` → the Review Focus 3 table fails.
  - Ignore `attachment` altogether → the stick/external control fails. This proves the rule does not wrongly refuse.
- [ ] **Step 6: Commit.** Run prettier and eslint on both files, then `git add scripts/box/disk-state.mjs scripts/box/disk-state.test.mjs && git commit -s -m "feat(box): decide what an installer may do with the disks it finds"`. The body names the deletion controls and says that the observation adapter and real-disk fixtures wait for the Linux rig.

### Task 2: rig arguments and a fresh run folder

**Files:**
- Create: `scripts/box/rig-contract.mjs`
- Test: `scripts/box/rig-contract.test.mjs`

**Interfaces:**
- Produces (Task 3 extends the same file):

```js
/** Case names a rig run accepts today; later PRs extend it with the case they make runnable. */
export const RIG_CASES; // ["layout","seal-a","seal-b","seal-d","seal-f","seal-g","seal-i","preboot-local","preboot-headless","preboot-two-boxes","preboot-tamper"]
/** @param {readonly string[]} argv  arguments after the script name @returns {{caseName: string, runDir: string}} */
export function parseRigArgs(argv);
/** Creates runDir (mode 0700, parent must exist, never recursive) and an empty ledger. @returns {Promise<RigRun>} */
export async function createRun(runDir);
```

Refusals use `code: "rig.refused"` with one of these `reason` values:
- `argument-unknown`: anything other than `--case <name>` and `--run-dir <path>`, each exactly once;
- `argument-repeated`, `argument-missing`;
- `case-unknown`;
- `device-argument`: **any** argv element starting with `/dev/`, checked before anything else, so `--run-dir /dev/sdb` and a stray `/dev/nvme0n1` are both refused;
- `run-dir-relative`;
- `run-dir-unsafe`: not equal to `path.resolve` of itself, contains a NUL, or is `/`;
- `run-dir-exists`: `EEXIST`, whether empty or not;
- `run-dir-parent-missing`.

`createRun` calls `fs.mkdir(runDir, { mode: 0o700 })` without `recursive`, so the existence check and the creation are one atomic step. It then writes `ledger.json` (Task 3's format, with `resources: []`) using `wx`. `RigRun` is `{ runDir, rootId }`, where `rootId` is `"<dev>:<ino>"` from `lstat`.

- [ ] **Step 1: Failing tests:**
  - `parses --case layout --run-dir <abs> in either order`;
  - one case per refusal reason above, asserting both `code` and `reason`;
  - `/dev/sdb as the run dir → device-argument`; `an extra /dev/nvme0n1 argument → device-argument`;
  - `relative run dir → run-dir-relative`; `"/tmp/x/../y" → run-dir-unsafe`;
  - `existing empty folder → run-dir-exists, and its contents and mode are unchanged`; `existing non-empty folder → run-dir-exists, the file inside unchanged`;
  - `missing parent → run-dir-parent-missing and nothing created`;
  - `a fresh path → folder exists with mode & 0o777 === 0o700 and ledger.json holds {"version":1,"runDir":…,"resources":[]}`.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/rig-contract.test.mjs`.
- [ ] **Step 3: Implement** `RIG_CASES`, `parseRigArgs` and `createRun`.
- [ ] **Step 4: Run green.** Read the count and run the single-file coverage command.
- [ ] **Step 5: Deletion controls.** Make each change, see the named test fail, then restore:
  - Remove the `/dev/` scan → both device-argument tests fail.
  - Pass `recursive: true` to `mkdir` → the existing-empty-folder test fails.
- [ ] **Step 6: Commit** the two files: `feat(box): refuse rig runs that name a device or reuse a folder`.

### Task 3: write-ahead resource ledger and cleanup of recorded resources only

**Files:**
- Modify: `scripts/box/rig-contract.mjs`, `scripts/box/rig-contract.test.mjs`

**Interfaces:**
- Consumes: `createRun`, `RigRun` (Task 2).
- Produces:

```js
/**
 * @typedef {{kind:'image', path:string}
 *   | {kind:'loop', image:string}       loop devices are found by their recorded backing image, never named by id
 *   | {kind:'mount', target:string}
 *   | {kind:'vm', pidFile:string}} RigResource   every path absolute, normalised, strictly inside runDir, never ledger.json
 * @typedef {{action:'stop-vm', pidFile:string}|{action:'unmount', target:string}
 *   |{action:'detach-loops', image:string}|{action:'remove-file', path:string}} CleanupStep
 * @typedef {{ stopVm(pidFile:string):Promise<void>, unmount(target:string):Promise<void>,
 *   detachLoops(image:string):Promise<void>, removeFile(path:string):Promise<void> }} CleanupAdapter
 */
/** Durably records the resource, then runs step. step never runs if recording fails. */
export async function withRecorded(run, resource, step);
/** Reads and strictly validates runDir/ledger.json; refuses any resource outside runDir. @returns {Promise<readonly RigResource[]>} */
export async function loadLedger(runDir);
/** Pure: reverse recording order; image → remove-file, loop → detach-loops, mount → unmount, vm → stop-vm. */
export function planCleanup(resources);
/** Runs every step even after failures. @returns {Promise<{status:'clean'|'incomplete', failed: readonly CleanupStep[]}>} */
export async function runCleanup(plan, adapter);
```

The ledger file is `{"version":1,"runDir":"…","resources":[…]}` plus a newline, in canonical bytes. Each `withRecorded` call rewrites it through `ledger.json.next`: write with `wx` mode 0600, flush the file, rename, flush the folder. `loadLedger` refuses with `reason: "ledger-invalid"` when:
- the bytes are not canonical;
- `runDir` differs from the folder being read;
- there is an unknown kind or key;
- a path lies outside `runDir` or is a `/dev/` path.

A ledger damaged after a crash therefore cannot direct cleanup at another path. The real `CleanupAdapter` (Linux) must check a VM's process identity before stopping it; that belongs to the Linux pull request.

- [ ] **Step 1: Failing tests:**
  - `step sees its resource already in ledger.json on disk` (read the file inside `step`);
  - `a failing write before the rename → step never called and ledger unchanged` (inject by making `ledger.json.next` a folder beforehand, so `wx` fails);
  - `resource outside runDir → rig.refused "resource-outside-run"`; `/dev/loop0 as an image path → resource-outside-run`;
  - `loadLedger refuses a ledger edited to name /etc/passwd → ledger-invalid`;
  - `planCleanup reverses order and maps each kind`;
  - `runCleanup calls the adapter with exactly the recorded paths, in plan order` (fake adapter that records calls);
  - `a file in runDir that the ledger does not list is never passed to the adapter`;
  - `one failing step → later steps still run, status "incomplete", failed lists that step`;
  - `all succeed → "clean"`.
- [ ] **Step 2: Run red** with the Task 2 command.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green** and the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Swap `withRecorded` to run the step first → "step sees its resource" fails.
  - Remove the inside-`runDir` check in `loadLedger` → the `/etc/passwd` test fails.
  - Stop the loop at the first failure in `runCleanup` → the incomplete test fails.
- [ ] **Step 6: Commit:** `feat(box): record rig resources before creating them and clean up only those`.

### Task 4: retained disk-key record, path checks and the read path

**Files:**
- Create: `scripts/box/disk-key.mjs`
- Test: `scripts/box/disk-key.test.mjs`

**Interfaces:**

```js
export const HOST_ROOT; // "/var/lib/waitron-host"
/**
 * @typedef {object} HostStateIdentity  what the mount check saw: hostRoot, the opened container's LUKS UUID, "<dev>:<ino>" of hostRoot
 * @property {string} hostRoot @property {string} diskUuid @property {string} rootId
 * @typedef {object} DiskRecoveryDeps
 * @property {string} hostRoot          absolute, realpath-equal
 * @property {number} ownerUid          0 in production; tests pass process.getuid()
 * @property {() => Promise<HostStateIdentity>} inspectHostState
 * @property {DiskRecoveryIo} [io]  test-only override of the file operations; defaults to node:fs/promises.
 *   One object with lstat, open, mkdir, writeFile, rename, unlink, syncFile, syncDirectory, readdir, so a test can count calls and fail any one.
 * @typedef {object} DiskRecoveryStore
 * @property {(input:{diskUuid:string, key:Uint8Array, replace:boolean}) => Promise<void>} store    Task 5
 * @property {(input:{diskUuid:string}, consume:(key:Uint8Array)=>Promise<void>) => Promise<void>} withKey
 */
/** Test seam and the future host service's constructor; callers never take hostRoot from a request. */
export function createDiskRecoveryStore(deps);
/** Fixed production entry points. No inspectHostState adapter exists until the Linux rig, so both refuse "mount-unverified" before any file-system call. */
export async function storeDiskRecovery(input);
export async function withDiskRecovery(input, consume);
```

Record path: `<hostRoot>/disk-recovery/<diskUuid>.json`. Bytes: `{"version":1,"diskUuid":"<uuid>","key":"<64 lowercase hex>"}` plus a newline, canonical, at most 1024 bytes (check the size through `handle.stat()` before reading). `diskUuid` must match `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`. That regex alone stops path traversal; the `O_NOFOLLOW` and `lstat` checks stop symlinks.

Refusals use `code: "disk_recovery.refused"` and the error message is the code alone. `reason` is one of:
- `input-invalid`: bad UUID; a key that is not a 32-byte `Uint8Array` or is all zeros; `replace` not a boolean;
- `mount-unverified`: the seam throws, or its `hostRoot` differs from the one configured;
- `disk-mismatch`: the seam's `diskUuid` differs from the input's;
- `root-changed`: `lstat(hostRoot)` dev:ino differs from the seam's `rootId`;
- `path-unsafe`: `hostRoot` or `disk-recovery` is a symlink or not a folder, or the record is not a regular file or is a symlink;
- `permissions-unsafe`: owner ≠ `ownerUid`, or `mode & 0o077 !== 0`, on `hostRoot`, `disk-recovery` or the record;
- `record-missing`, `record-corrupt`, `record-mismatch` (the record's `diskUuid` differs from its file name);
- `io-failed`, for any other file-system error.

`withKey` checks the input, then calls `inspectHostState` **before any file-system call**. It then checks `root-changed`, the folders and the record, decodes the key into a fresh `Uint8Array`, awaits `consume`, and in `finally` overwrites that array with zeros. It returns `undefined` whatever `consume` returns, and rethrows a `consume` error unchanged. The array handed over is the only copy this pull request zeros. Strings parsed from the file stay in memory until garbage collection, and the plan claims nothing about their lifetime.

- [ ] **Step 1: Failing tests.** Each uses a real temporary `hostRoot` (`chmod 0700`), `ownerUid: process.getuid()`, and a stand-in `inspectHostState` that returns that root, a disk A UUID and the root's real `dev:ino`. Records are written straight to disk by the test for now; Task 5 adds `store`.
  - `withKey hands consume exactly the stored 32 bytes, then the array is all zeros`; `a throwing consume → same error rethrown, array still zeroed`; `withKey returns undefined even when consume returns a value`
  - **Review Focus 4:**
    - `inspectHostState throws → mount-unverified, consume not called, and the counting `io` saw zero calls`;
    - `seam reports another hostRoot → mount-unverified`;
    - `seam reports disk B → disk-mismatch`;
    - `seam rootId differs from lstat → root-changed`;
    - `fixed withDiskRecovery and storeDiskRecovery → mount-unverified` (they have no seam, so they refuse before any file call; the code shows it, the test pins the reason).
  - **Review Focus 5:**
    - `record for disk A, request for disk B (seam also B) → record-missing, consume not called`;
    - `disk A's record copied to B's file name → record-mismatch`.
  - `disk-recovery is a symlink to another folder holding a valid record → path-unsafe`; `record is a symlink → path-unsafe`; `hostRoot itself replaced by a symlink → path-unsafe`
  - `record mode 0644 → permissions-unsafe`; `disk-recovery mode 0755 → permissions-unsafe`; **owner control:** `ownerUid: process.getuid() + 1 → permissions-unsafe`. That last case is how the owner check is proved on a machine where nothing can be owned by root.
  - `it.each` of corrupt records → `record-corrupt`: invalid JSON, non-canonical spacing, an extra key, `version: 2`, a 63-character key, an upper-case-hex key, an all-zero key, a 2048-byte file.
  - Bad input → `input-invalid`: `"../x"`, upper-case UUID, `""`, `"a/b"`.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/disk-key.test.mjs`.
- [ ] **Step 3: Implement** `withKey`, the fixed `withDiskRecovery`, the checks and the parser. Open the record with `O_RDONLY | O_NOFOLLOW` and `fstat` it through the handle. Use `lstat` for the two folders. Because the parents are root-only, only root could swap them between the check and the open, and root is already trusted (spec §7.5, "they do not protect it from host root"). Put that as the one comment at the check.
- [ ] **Step 4: Run green** and the coverage command.
- [ ] **Step 5: Deletion controls.** Make each change, see the named test fail, then restore:
  - Remove the mount-seam call → the four Review Focus 4 tests fail.
  - Remove the owner comparison → the owner control fails.
  - Remove the record-UUID comparison → `record-mismatch` fails.
  - Remove the `fill(0)` → both zeroing tests fail.
- [ ] **Step 6: Commit:** `feat(box): read a disk's retained recovery key only from its checked host-state record`. The body says the uid-0 check has not been run as root, and that the real mount check waits for the Linux rig.

### Task 5: atomic store, interrupted writes and the key-leak sweep

**Files:**
- Modify: `scripts/box/disk-key.mjs`, `scripts/box/disk-key.test.mjs`

**Interfaces:**
- Consumes: Task 4's deps, checks, parser and errors.
- Produces: `DiskRecoveryStore.store({diskUuid, key, replace})` and the fixed `storeDiskRecovery(input)`, which refuses `mount-unverified`.

Sequence inside one per-store serial turn (an in-process promise chain; a lock across processes is slice 3's host-service design):
1. Check the input, run the mount check and `root-changed`, and check `hostRoot` as in Task 4.
2. Create `disk-recovery` with mode `0700` if it is absent (never `hostRoot`), then check it.
3. If `<uuid>.json` exists and `replace` is false → `record-exists`. This includes a corrupt record: nothing silently overwrites one.
4. Unlink a leftover `<uuid>.json.next` (that fixed name only).
5. Write `.next` with `wx` mode `0600`, flush it, rename it to `<uuid>.json`, flush the folder.
6. Read it back through Task 4's parser, and refuse `publication-unverified` if it is not identical.

The function returns `undefined`. The parent plan's step "confirming a first sheet retains key bytes" maps to this: the module exports no delete operation at all. Do not add one.

- [ ] **Step 1: Failing tests:**
  - `store then withKey round-trips the bytes; file mode 0600, folder 0700`;
  - `store with replace:false over an existing record → record-exists and the file bytes are unchanged`;
  - `store with replace:false over a corrupt record → record-exists`;
  - `replace:true writes the new key`;
  - `two concurrent replace:false stores → exactly one fulfilled, the other record-exists`.
  - **Review Focus 4:** `hostRoot missing (seam still answers) → path-unsafe and nothing created`; `seam throws → mount-unverified and a recursive listing of hostRoot is empty afterwards`.
  - **Review Focus 5:**
    - `it.each(["create","sync","rename","syncDirectory"])`: a failure at that stage during a `replace:true` store leaves `withKey` handing over the **previous** whole key.
    - The same failure in a first store leaves `record-missing`.
    - Inject the failures through Task 4's `deps.io`, wrapping the real operations the way A950's journal test wraps its IO.
  - `a truncated leftover .next (half the bytes) is ignored by withKey and removed by the next store`;
  - `store refuses a key that is all zeros or 31 bytes → input-invalid`.
  - **Key-leak sweep.** Use canary key bytes `0xa5` repeated 32 times. Run every store and withKey path above, failures included, while spying on `console.*`, `process.stdout.write` and `process.stderr.write`. Collect every returned value and every thrown error: `message`, `stack`, `JSON.stringify`, and `util.inspect(…, {depth: 10})`. Assert that none contains the key's hex, base64 or base64url form. Also assert no console or stdout/stderr call happened at all. The only files that may contain the canary are `<uuid>.json` and a leftover `.next` in the same `0700` folder. Scan every other file under the temporary root.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** `store` and `storeDiskRecovery`.
- [ ] **Step 4: Run green** and the coverage command for `disk-key.mjs` (Tasks 4 and 5 together).
- [ ] **Step 5: Deletion controls.** Make each change, see the named test fail, then restore:
  - Write straight to `<uuid>.json` instead of `.next` → the rename-stage case fails.
  - Remove the `record-exists` check → both replace:false tests fail.
  - Remove the serial turn → the concurrency test fails. Run it 20 times before restoring, to see that it fails reliably rather than once.
  - Put the key into an error's `reason` → the sweep fails.
- [ ] **Step 6: Commit:** `feat(box): store a disk's recovery key atomically on the checked host-state mount`.

### Task 6: backlog and dated pointers

**Files:**
- Modify: `docs/backlog.md` (the B3 entry at about line 5151)
- Modify: `docs/backlog/box.md` (`## B3. The bootable USB installer`, about lines 745–812)
- Modify: `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md` (one dated pointer line at the top)
- Modify: `docs/superpowers/plans/2026-10-26-b3-usb-installer.md` (one dated pointer line at the top)

- [ ] **Step 1: Backlog entry.** Replace "no build" with: build authorised by the owner on 2026-11-01 and cut one pull request at a time. PR 1 (its number, filled in once the pull request exists) adds three host libraries under `scripts/box/` with no caller yet:
  - the disk decision;
  - the rig's ledger and cleanup rules;
  - the retained disk-key store.

  Then state what is still open:
  - the recipe and dracut files;
  - the rig entry point and disk fixtures;
  - the real observation, mount and cleanup adapters;
  - the root-owned check run as root;
  - seal experiments (a) to (i), and every measurement listed under slice 1;
  - PR 2's preboot logic.

  All of these wait for a Linux machine with KVM, OVMF and swtpm, or for hardware. Keep the Android hold sentence exactly as it is.
- [ ] **Step 2: `docs/backlog/box.md`.** Change "authorised; no build" (lines 751–752) and the closing "Nothing built." to the same facts, linking this plan. Add the planner's call (hardware refusal before guard 3) as an open review point, and list the re-map findings 3–7 as items for later slices.
- [ ] **Step 3: Pointers.** At the top of the spec and of the six-slice plan add `> 2026-11-01: the owner authorised the build; PR 1's plan and its re-map against main: [2026-11-01-b3-1-encrypted-disk.md](…).` Do not rewrite either historical body (CLAUDE.md §6, docs).
- [ ] **Step 4:** No guide changes: nothing a person sees changed. No CLAUDE.md line, unless a task above paid for a new trap; if one did, add it as one line plus a pointer.
- [ ] **Step 5: Commit** in the same branch as the code (this is not a docs-only branch): `docs(backlog): record B3's first built pull request and what still waits for Linux`.

---

## Self-review

- **Spec coverage for this pull request.**
  - §5.1 guard 3 markers, §5.2 recognised, unknown and multiple, §7.7 refusals: Task 1.
  - §7.6 name tag decides nothing: Task 1, Review Focus 3.
  - §7.5 storage contract (path, modes, mount check, UUID binding, refusals, nothing in logs): Tasks 4 and 5.
  - Parent Task 1.1's rig contract: Tasks 2 and 3.
  - Every other slice-1 sentence is listed under "Out" with where it goes.
- **Names match the parent ledger** where it named them: `classifyDisk`, `DiskDecision.kind/diskId`, `storeDiskRecovery`, `withDiskRecovery`. Deviations are recorded in re-map findings 4 and 5.
- **What the planner ran versus read.**
  - Ran:
    - the existing `scripts/box/upgrades/settings.test.mjs` through the root project (49 passed);
    - a single-file coverage run that measured 8/8 statements;
    - `node -e` to generate the layout GUID and to confirm `O_DIRECTORY`/`O_NOFOLLOW` exist and that `process.getuid()` is non-zero (503) here.
  - Read: everything else, including every line number in the re-map.
  - The planner ran no test of the code above, because none of it exists yet.

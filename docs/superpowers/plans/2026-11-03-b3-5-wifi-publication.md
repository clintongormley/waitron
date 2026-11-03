# B3, fifth pull request: publishing the Wi-Fi boot copy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Build the part of slice 3 Task 3.1 that puts the Wi-Fi boot copy on the boot partition and takes it off again, which an unprivileged macOS machine and CI's root Vitest project can fully test.

The boot copy is `/boot/waitron-recovery/wifi.json`: the venue's normal Wi-Fi name and password, kept outside the encryption so a locked box can join Wi-Fi and show its unlock page (spec §7.5, "Approved normal Wi-Fi copy"). PR 2 built its reader; PR 4 built its byte format (`formatWifiRecord`) and the decision "write this copy" or "no copy, because …" (`decideWifiBootCopy`). This pull request builds the **publisher** (`scripts/box/wifi-boot-copy.mjs`, new): given that decision, it

- checks the boot partition's mount and the folder before it changes anything, and refuses with no write at all when the mount is not the expected one, or when the folder or either fixed name (`wifi.json`, `wifi.json.next`) is a symbolic link (a name that points at another path), not a plain file or folder, has a second name (a hard link), or has the wrong owner or permissions;
- writes a new copy through a *staging file* in the same folder, `wifi.json.next`: write it, *flush* it (ask the operating system to put the cached bytes on the disk itself, the `fsync` call), rename it to `wifi.json` (one step that replaces the old copy), then flush the folder so the new name is on the disk too;
- removes `wifi.json` and any leftover `wifi.json.next` on every "no copy" answer, cable-only included, and flushes the folder;
- reads the result back with PR 2's reader before it says the copy is current or gone;
- reports a typed copy state (`pending`, `current`, `absent`, `failed`) with the decision's reason, which says nothing about whether the box is actually connected.

Its file operations come in through an injected set of functions (a *seam*), so the tests can make each step fail, and the happy path and the leftovers of a stopped publication also run on real files in a `mkdtemp` folder.

Nothing here runs on a box, reads NetworkManager, joins a network or writes `/boot`. `publishWifiBootCopy` answers a valid decision with `failed` / `mount-unverified` and no file call until the Linux pull request adds the boot-mount check, as PR 2's reader does. Nothing here is a qualified boot or Wi-Fi path.

Task 3.1 also asks for a durable pending record on `@host-state`. It is left out (D11), but not because it could not be tested here: PR 1 built and tested an `@host-state` store on this machine. It is left out because what it must record depends on the live NetworkManager half of a network change, which is not built.

**Review folded 2026-11-03.** A fresh-context review found five important and eleven minor points; all are folded:

- I1: Task 6's pending cases now finish one publication first, then check `pending`; a new case pauses `removeCable` behind `writeA` and checks `{state: "pending", reason: "cable-only"}` after A finishes, so the "status set to the finished outcome" control fails a named case.
- I2: Task 2's three file-error rows also assert that the log's last entry is the failing call, so they are red on Task 1's code; the red expectation says which rows pass early.
- I3: the one-file coverage command exits 1 below the bar; the bar applies from Task 5 on, and Tasks 1–4 name the stubbed functions whose lines may be uncovered. Never pad tests or add an ignore comment to pass it.
- I4: console, `process.stdout.write` and `process.stderr.write` are spied for the whole test file and checked after every case; the sweep asserts a stated minimum number of collected statuses; the default-operations `current` case asserts `fsCalls.log` is not empty, the positive control for Task 1's empty-log check.
- I5: D11's reason (b) is dropped (PR 1 built and tested an `@host-state` store here); the reason given is (a), and the Goal says so.
- M1: D4 and Task 8 now say an unsafe name refuses a removal too, so after a switch to cable-only an obsolete password can stay where preboot reads it until root clears the fault.
- M2: Task 6's bytes case fills the caller's array with spaces (A's record is 105 bytes and B's 109, measured with `node`), and adds a `Buffer` input whose `subarray` shares its memory.
- M3: Task 7's "half" stop writes with the caller's own options, so the in-place-write control fails as it should.
- M4: a decision whose `kind` or `bytes` getter throws, with the password in its message, rejects `decision-invalid` holding no form of the password (D2, Task 1).
- M5: D13 refuses `io: undefined`, as PR 2's reader does (`exactRecord` counts a key whose value is `undefined`); Task 5 builds the default-operations publisher with no `io` key.
- M6: the publisher's own `lstat` of the folder goes through the folder check every time (D3), with a Task 2 row for a folder that changes between the reader's check and the publisher's.
- M7: D8 states one failure rule: a file operation that throws while writing, flushing or removing is `io-failed`, before or after the rename; any failure or mismatch during the read-back or the removal check, its own reads included, is `publication-unverified`. PR 1 splits at the rename (`scripts/box/disk-key.mjs:273-281`) because a second store for the same disk is refused; here a retry is always safe, so the split would tell the caller nothing it can act on.
- M8: Review Focus 5 now matches D6 and D7.
- M9: Task 8's `#PR5` placeholders say "filled in once the pull request exists".
- M10: Task 5's plain-string throw is a permanent case. PR 1's default file operations are exported from `disk-key.mjs` as `hostFileIo` (one export line; `disk-key.test.mjs` unchanged at 103), and `WifiCopyIo` is PR 1's `DiskRecoveryIo` type, instead of a copy (D13).
- M11: `fsCalls.log` is cleared right before the call under test, and `fsHooks.writeFile` is set only after the fixture is built.

A third, narrower claim check of that fold found one important and six minor points, all folded: D8's rule now covers the read-back's and the removal check's own reads, with a Task 5 row for the check's `lstat` of `wifi.json.next`; PR 1's refusal is per disk, not per key; the bytes controls' results and the `Buffer` control (both `slice` and `subarray` share a `Buffer`'s memory, measured) are restated; Task 1 gains a control for the throwing decisions; and three lines left stale by the earlier fold now say which task replaces the stub and that the default file operations are imported, not copied.

**Architecture:** One new host library under `scripts/box/`, a plain `.mjs` file with JSDoc types and a sibling `.test.mjs` in the root Vitest project, in the style PR 1–4 set. It imports PR 2's reader and format from `scripts/box/wifi-record.mjs`, which gains one exported constant (the list of "no copy" reasons) and nothing else. Its file operations are PR 1's disk-key store's (`scripts/box/disk-key.mjs:12-20`), and `disk-key.mjs` gains one export line so the default ones are shared rather than copied (D13).

**Tech Stack:** Node 26 (`.nvmrc` holds `26`; `node --version` printed `v26.13.0` on 2026-11-03), Vitest 4.1.12 root project. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §7.5, "Approved normal Wi-Fi copy" (lines 695–703 on main) and "Proposed minimal-copy update contract" (lines 705–738); the storage table (lines 385–395); §19 item 3 (lines 1612–1617, "including the minimal Wi-Fi boot-copy update/removal (§7.5)"). Line numbers are main's at `93667fe547`; this branch adds a two-line pointer at the top, so add 2 for the spec as merged. Line numbers in `wifi-record.mjs` past line 182 and in `disk-key.mjs` past line 67 are main's too; this branch adds 15 and 2 lines there, and 2 at the top of the six-slice plan.

**Parent plan:** [six-slice plan](2026-10-26-b3-usb-installer.md) Slice 3 Task 3.1: the "Proposed boot-copy contract" (lines 191–199), the second red step on network-copy cases (line 202) and the implementation step after it (line 203), the publication parts only.

**Build authority:** the owner's "Yes, build it", 2026-11-01, relayed by the lead session for PR 1, with the build cut one pull request at a time ([PR 1's plan](2026-11-01-b3-1-encrypted-disk.md), "Build authority").

## Global Constraints

- **Machine limits on 2026-11-03:** macOS, unprivileged. No Linux box, TPM, real disk or network. The planner's Linux measurements ran in a throwaway `node:26-slim` container (re-map finding 4); implementers need no Docker.
- **Zero writes when the starting state is unsafe.** Every refusal of the mount, the folder or a fixed name as found happens after only `lstat` and read-only `open` calls (the two later failures, a folder this publication made that comes out wrong and a read-back that does not match, come after writes, D5 and D8). No `mkdir`, `writeFile`, `rename`, `unlink`, `syncFile` or `syncDirectory` call comes before it (parent line 202: "symlinks/non-regular files and wrong boot/`@host-state` mount refuse with zero fallback writes").
- **Two names only.** The publisher creates, replaces or removes `waitron-recovery/wifi.json` and `waitron-recovery/wifi.json.next` and creates the `waitron-recovery` folder when it is missing. It never removes the folder, never lists it, and never touches another name in it (spec line 720–721: "The fixed Wi-Fi cleanup allowlist is `wifi.json.next` plus, for cable-only, `wifi.json`; never scan/delete arbitrary boot paths").
- **No path from a caller.** The boot root comes from the constructor's deps (a test seam) or the fixed `BOOT_ROOT`; `publish` takes only a decision.
- **The Wi-Fi password never leaves** in a status, an error or a log line. Only the bytes written to the two fixed names hold it. The module writes nothing to the console.
- **Coverage:** the root project holds `98/98/98/95` (`vitest.config.ts:120`). No `exclude`, no ignore comment, no moving code into a testing folder.
- **Code style:** English only in code (CLAUDE.md §3). Comments only for an invariant or a reason the code cannot show. Error codes name the domain (`wifi_copy.*`), never the file.
- **Tests:** no existing assertion in any test changes; counts may only grow (re-map finding 11).
- **Commits:** `git commit -s`, staging only named paths, never `git add -A`.

## Review Focus

1. **Zero writes on every unsafe start.** Expected: for every wrong mount, unsafe folder, unsafe `wifi.json` or unsafe `wifi.json.next`, the status is `failed` with the reason, the call log holds only `lstat` and `open`, and the folder tree is identical before and after. Tasks 1, 2.
2. **Preboot never sees half a copy.** Expected: stopped after any step, the reader answers what it answered before the publication or what it answers after a complete one, never anything else. Task 7.
3. **No obsolete password survives a later publication.** Expected: after a stopped publication, a fresh publisher given the box's current decision leaves at most the current copy, and no file under the folder holds an older password. Task 7.
4. **The password never leaves.** Expected: no status, error or console output holds any form of it (text, hex, base64), even when an injected file operation's error message holds it. Tasks 1, 5.
5. **The status is honest.** Expected: `current` only after the folder flush and either a matching read-back of what was written or, when nothing needed writing, the first check's matching read (D6); `absent` only after the folder flush and a check that both names are gone, or with no folder at all (D7); `pending` from construction until a publication finishes, and while any is queued; `failed` never says which copy is on the disk. Tasks 3, 4, 5, 6.

---

## What this pull request builds, and what it leaves out

**In (testable on this machine):**

| Task | File | Parent-plan or spec source |
| --- | --- | --- |
| 1 | `wifi-record.mjs`: export the "no copy" reasons; `wifi-boot-copy.mjs` and test: construction, the decision check, the first status, the mount refusal, the fixed entry points | parent line 202, "Unknown fields, arbitrary paths … refuse"; spec line 717, "verify the expected boot mount" |
| 2 | same files: every other refusal before a write | parent line 202, "symlinks/non-regular files … refuse with zero fallback writes"; spec line 717 |
| 3 | same files: writing a copy | spec lines 717–719; parent line 203, "root-only same-directory temporary write/flush, atomic fixed-name rename/directory flush" |
| 4 | same files: removing the copy | spec lines 720–724; parent line 203, "fixed-allowlist obsolete/temp cleanup and durable removal on cable-only" |
| 5 | same files: a failure at every step, the default file operations, and the password sweep | parent line 202, "Inject failures at … temporary-file flush, rename, directory flush and cleanup"; "No password … canary in logs, status" |
| 6 | same files: one publication at a time, and the status while one runs | spec line 711, "The host serializes network changes"; parent lines 195–196, typed copy state |
| 7 | `wifi-boot-copy.test.mjs`: whole-flow sweep of stopped publications and the next start | spec lines 724–726; parent line 203, "reconcile on unlocked restart without reviving obsolete credentials" |
| 8 | Backlog (PR 5's paragraph, the re-map's leftovers, settled notes), plus dated pointers in the spec and the six-slice plan | — |

**Out, and where each goes next:**

**The durable pending intent on `@host-state`: slice 3's host service** (decision D11 says why it is not here). The record that a network change has begun, kept on the box's encrypted disk until the boot copy is published or removed.

**Reading the box's NetworkManager connection into `WifiSettings`, applying a change, and watching for changes made outside the dashboard: slice 3's `network.mjs`** (spec line 708, "including host-observed changes outside the dashboard"). That adapter calls `decideWifiBootCopy` and then this publisher.

**When the host publishes:** at every unlocked start, before it reports the copy state, and after every Wi-Fi change the host applies or observes: slice 3's host service. The first copy at installation handoff: slice 2's installer adapter (parent line 159).

**The boot-mount check behind `inspectBootMount`**, and where the startup image mounts the boot partition: the Linux pull request, shared with PR 2's reader (`scripts/box/wifi-record.mjs:265-266`, `:428-434`).

**Reporting:** the host request and reply that carry the copy state, the status page's words for each state and reason in Spanish and English, the line that says Wi-Fi unlock is or is not available, and reporting a live-network change and a failed publication as two outcomes (spec lines 713–715): slice 3's host protocol and Task 3.2's screen.

**Rig checks (Linux, slices 1, 3 and 6):** that the flushes make the copy and its removal survive a power cut on the boot partition's real ext4 (spec line 729, "Exact durability on the selected filesystem is a rig qualification"); that no boot-loader-measured byte changes across publications (spec line 728); real power cuts at every step; preboot joining with old, new, missing and corrupt copies (spec lines 736–737).

## Re-map against main on 2026-11-03

The six-slice plan was written on 2026-10-26. This re-map checks Task 3.1's boot-copy sentences, spec §7.5 and the backlog's open notes against main at `93667fe547`.

1. **Nothing publishes the copy yet.** `git grep -n -E "wifi\.json|\"waitron-recovery\"|\.next\b" -- scripts deploy`, test files left out, finds only the reader's two constants (`scripts/box/wifi-record.mjs:269-270`). `git grep -n -i "wifi\|wi-fi\|nmcli\|NetworkManager" -- deploy` finds nothing. No `network.mjs`, `host.mjs` or `host-protocol.mjs` exists (`ls scripts/box/`). No other worktree or remote branch is on B3 (`git worktree list`, `git branch -r`).
2. **The publication is testable here; the rest of Task 3.1 is not.** The publication's whole input is `decideWifiBootCopy`'s answer, already built (`scripts/box/wifi-record.mjs:218-250`), and its whole effect is file operations under one folder, which a seam and a `mkdtemp` folder can drive. Everything else in Task 3.1 needs NetworkManager, the socket, systemd or a screen ("Out"). So this pull request takes the publication, as the backlog's PR 2 note asks (`docs/backlog/box.md:967-969`): "Task 3.1's publication writes `decideWifiBootCopy`'s bytes (built in PR 4) and removes the copy on every "no copy" answer; it shows the answer's reason with the copy state".
3. **PR 1's store already does a staged write in this style**, and the publisher takes its file-operation names and its flush rules: the names and flush code by importing PR 1's default operations (D13), the flush rules by following them. `createDiskRecoveryStore` takes `io` with `lstat`, `open`, `mkdir`, `writeFile`, `rename`, `unlink`, `syncFile` and `syncDirectory` (`scripts/box/disk-key.mjs:12-20`); its default flushes open the path with `O_NOFOLLOW | O_NONBLOCK` and call `handle.sync()`, the file one refusing anything but a regular file (`:44-66`); it flushes the parent folder on every store, "not only after the mkdir: an earlier store may have made the folder and then failed to flush hostRoot, and a retry cannot tell" (`:253-255`); it writes `<record>.next` with `{ flag: "wx", mode: 0o600 }`, flushes it, renames it and flushes the folder (`:261-276`). Two differences, both decisions below: PR 1 unlinks a leftover `.next` symlink (`:262-267`), where this publisher refuses (D4); and PR 1 never replaces a record, where this one does.
4. **What the file operations do, measured on both systems.** A probe script (below) ran on 2026-11-03 with `node /tmp/b3p5-probe/probe.mjs` on this Mac (`darwin node v26.13.0 uid 503`), and with `docker run --rm -v /tmp/b3p5-probe:/probe:ro node:26-slim sh -c 'node /probe/probe.mjs; su node -s /bin/sh -c "node /probe/probe.mjs"'` on Linux (`linux node v26.10.0`, as uid 0 and uid 1000; `memory_pressure` printed 93% free before it). Every line printed the same on both systems and both users, except where noted:
   - A folder opened `O_RDONLY | O_DIRECTORY` (with and without `O_NOFOLLOW`) can be flushed: `fs.fsyncSync`, `handle.sync()` and `handle.datasync()` each printed `ok`. Opening a symlink to a folder that way printed `ENOTDIR`, and so did a regular file.
   - `rename(next, existing file)` printed `ok content=new inoIsNext=true nextGone=true`: the old file is replaced by the staged one, and the staged name is gone. `rename` onto a symlink replaced the link itself (`bIsLink=false target=target`: the link's target was not touched). `rename` onto an empty or a non-empty folder printed `EISDIR`. `rename` of a staged file that had a second hard link printed `nlink=2` at the new name, so a copy published from such a file would be refused by the reader (`scripts/box/wifi-record.mjs:373`).
   - `lstat` of a symlink reports a symlink (`true`); `stat` of the same follows it (`false`), and `stat` of a link to nothing printed `ENOENT` where `lstat` printed `true`. So every check here is an `lstat`.
   - `writeFile(path, …, { flag: "wx" })` onto a symlink to nothing printed `EEXIST` and created nothing at the target (`false`); with flag `w` it created the target (`createdTarget=true`). So the `wx` flag is what keeps a planted link from redirecting the write.
   - `writeFile(…, { flag: "wx", mode: 0o600 })` made mode `600` under umask `22` (both systems as root) and `2` (Linux uid 1000); `mkdir(…, { mode: 0o700 })` made `700`.
   - `unlink` of a symlink removed the link and left its target (`targetStill=true`); `unlink` of a FIFO (a named pipe) printed `ok`; `unlink` of a missing name printed `ENOENT`. **`unlink` of a folder differs:** `EPERM` on macOS, `EISDIR` on Linux. So no rule here may depend on `unlink`'s error code for a folder; the `lstat` check finds a folder first (D4).
5. **CI already runs real folder flushes on its Linux runner.** On main's CI run 41626568917 (head `93667fe547`, conclusion `success`), the `root-guards` job ran on `Ubuntu 26.04.1` (its "Operating System" log group) and printed `✓ scripts/box/disk-key.test.mjs (103 tests)`. Those tests call real `handle.sync()` on folders opened `O_RDONLY | O_DIRECTORY` (`scripts/box/disk-key.test.mjs:96-104`, used at `:818`, `:973`).
6. **What a flush and a rename promise, in the sources' own words (provenance table below).** The rename keeps the name pointing at the old or the new file "throughout the renaming operation" for other processes; Linux's `fsync` page says flushing a file does not flush its folder's entry, which needs a flush of the folder. Neither source promises what is on the disk after a power cut on a given filesystem: that stays a rig check (spec line 729).
7. **The reader is the right check before a write.** `createWifiRecordReader`'s `read()` checks the mount answer, then `lstat`s the boot root (identity, symlink, folder, owner, group and other write bits), then the folder (symlink, folder, owner, mode `& 0o077`), then opens `wifi.json` with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` and checks it is a regular file with one link, the owner and mode `& 0o077`, and its size (`scripts/box/wifi-record.mjs:345-414`). Its own refusals are `path-unsafe` (`:341`, `:373`, `:406`), `permissions-unsafe` (`:342`, `:374`), `mount-unverified` (`:353`, `:356`, `:362`), `root-changed` (`:365`), `io-failed` for anything else thrown (`:422`), and `record-oversized` for a file over 1024 bytes (`:375`, `:384`); `parseWifiRecord` adds `record-oversized`, `record-corrupt` and `record-unsupported` about the bytes. It never opens `wifi.json.next` (PR 2's rule, its plan line 46). So the publisher runs the reader first, with the same deps, and adds only its own `lstat` of `wifi.json.next` (D3).
8. **The pending intent's place is the encrypted disk.** The spec puts it on `@host-state` (line 712, "records a durable encrypted pending operation on `@host-state`"); `@host-state` is a subvolume inside the LUKS2 container (storage table, lines 390 and 395), and PR 1's disk-key record is plain JSON there, "inside the encrypted disk on the separate `@host-state` mount" (line 617), protected by the disk's own encryption. PR 1 built and tested that store here with an injected mount check, its fixed entry points refusing `mount-unverified` until the Linux adapter exists (`scripts/box/disk-key.mjs:320-343`), so an `@host-state` record is testable on this machine. The cutover handoff, a different record, asks for "host-owned encryption keys" (line 1187); the Wi-Fi intent's sentence does not. Decision D11 uses this.
9. **"For cable-only" is wider in PR 4's decision.** The spec's allowlist removes `wifi.json` "for cable-only" (line 720) and "switching to cable-only or forgetting the selected Wi-Fi removes it" (lines 709–710). PR 4's `decideWifiBootCopy` answers `remove` for cable-only and for ten other reasons, meaning "no copy should exist, so any copy present is obsolete" (`scripts/box/wifi-record.mjs:179-180`; PR 4's plan D11). Decision D7 follows PR 4.
10. **The root Vitest project needs no change.** Its test glob is `scripts/**/*.test.mjs` (`vitest.config.ts:71`), its coverage glob `scripts/**/*.mjs` and thresholds `98/98/98/95` (`:119-120`). PR 3's plan proved a new `scripts/box/` file is found and measured on its own by the one-file command (its re-map finding 2). No root guard names `scripts/box/` files: `git grep -ln "scripts/box" -- scripts ':!scripts/box'` printed nothing.
11. **Baseline, run on 2026-11-03:** `pnpm exec vitest run scripts/box/wifi-record.test.mjs` printed `Tests  267 passed (267)`; `pnpm exec vitest run scripts/box/disk-key.test.mjs` printed `Tests  103 passed (103)`. The one-file coverage command for `wifi-record.mjs` printed `Statements : 100% ( 179/179 )`, `Branches : 100% ( 159/159 )`, `Functions : 100% ( 27/27 )`, `Lines : 100% ( 146/146 )` (its per-file table printed no rows; read the summary). Counts may only grow, and no existing assertion changes.
12. **The test file's `node:fs/promises` mock pattern exists twice.** PR 2's reader test logs `lstat` and `open` through a mock to see the fixed entry point's calls (`scripts/box/wifi-record.test.mjs:244-255`); PR 1's store test swaps `writeFile` through a hook to reach its default flushes (`scripts/box/disk-key.test.mjs:26-31`). The new test needs both in one mock (Task 1, Task 5).

The probe script (kept outside the repository; reproduce by saving it and running the two commands above):

```js
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { constants as C } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const out = (k, v) => console.log(`${k}: ${v}`);
const tryIt = async (k, f) => { try { const r = await f(); out(k, `ok${r === undefined ? "" : " " + r}`); } catch (e) { out(k, `${e.code ?? e.name} ${e.message.split(",")[0]}`); } };
const d = fs.mkdtempSync(join(tmpdir(), "b3p5-"));
out("platform", `${process.platform} node ${process.version} uid ${process.getuid()}`);
await tryIt("fsyncSync(dir fd O_RDONLY|O_DIRECTORY)", () => { const fd = fs.openSync(d, C.O_RDONLY | C.O_DIRECTORY); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } });
await tryIt("handle.sync() on dir (O_RDONLY|O_DIRECTORY|O_NOFOLLOW)", async () => { const h = await fsp.open(d, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); try { await h.sync(); } finally { await h.close(); } });
await tryIt("handle.datasync() on dir", async () => { const h = await fsp.open(d, C.O_RDONLY | C.O_DIRECTORY); try { await h.datasync(); } finally { await h.close(); } });
fs.mkdirSync(join(d, "real")); fs.symlinkSync(join(d, "real"), join(d, "link"));
await tryIt("open(symlink-to-dir, O_RDONLY|O_DIRECTORY|O_NOFOLLOW)", async () => { const h = await fsp.open(join(d, "link"), C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); await h.close(); });
fs.writeFileSync(join(d, "plain"), "x");
await tryIt("open(regular file, O_RDONLY|O_DIRECTORY)", async () => { const h = await fsp.open(join(d, "plain"), C.O_RDONLY | C.O_DIRECTORY); await h.close(); });
fs.writeFileSync(join(d, "a.next"), "new"); fs.writeFileSync(join(d, "a"), "old");
const inoNext = fs.lstatSync(join(d, "a.next")).ino;
await tryIt("rename(file, existing file)", async () => { await fsp.rename(join(d, "a.next"), join(d, "a")); return `content=${fs.readFileSync(join(d, "a"), "utf8")} inoIsNext=${fs.lstatSync(join(d, "a")).ino === inoNext} nextGone=${!fs.existsSync(join(d, "a.next"))}`; });
fs.writeFileSync(join(d, "target"), "target"); fs.symlinkSync(join(d, "target"), join(d, "b")); fs.writeFileSync(join(d, "b.next"), "new");
await tryIt("rename(file, existing symlink)", async () => { await fsp.rename(join(d, "b.next"), join(d, "b")); return `bIsLink=${fs.lstatSync(join(d, "b")).isSymbolicLink()} target=${fs.readFileSync(join(d, "target"), "utf8")}`; });
fs.mkdirSync(join(d, "c")); fs.writeFileSync(join(d, "c.next"), "new");
await tryIt("rename(file, existing empty dir)", () => fsp.rename(join(d, "c.next"), join(d, "c")));
fs.mkdirSync(join(d, "e")); fs.writeFileSync(join(d, "e", "inner"), "x"); fs.writeFileSync(join(d, "e.next"), "new");
await tryIt("rename(file, non-empty dir)", () => fsp.rename(join(d, "e.next"), join(d, "e")));
await tryIt("lstat(symlink).isSymbolicLink", async () => (await fsp.lstat(join(d, "link"))).isSymbolicLink());
await tryIt("stat(symlink).isSymbolicLink", async () => (await fsp.stat(join(d, "link"))).isSymbolicLink());
fs.symlinkSync(join(d, "nowhere"), join(d, "dangling"));
await tryIt("stat(dangling symlink)", () => fsp.stat(join(d, "dangling")));
await tryIt("lstat(dangling symlink)", async () => (await fsp.lstat(join(d, "dangling"))).isSymbolicLink());
await tryIt("writeFile(dangling symlink, flag wx)", () => fsp.writeFile(join(d, "dangling"), "x", { flag: "wx", mode: 0o600 }));
await tryIt("nowhere created by wx on dangling?", async () => fs.existsSync(join(d, "nowhere")));
await tryIt("writeFile(dangling symlink, flag w)", async () => { await fsp.writeFile(join(d, "dangling"), "x", { flag: "w" }); return `createdTarget=${fs.existsSync(join(d, "nowhere"))}`; });
fs.symlinkSync(join(d, "nowhere2"), join(d, "dangling2"));
await tryIt("open(dangling, O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW)", async () => { const h = await fsp.open(join(d, "dangling2"), C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600); await h.close(); });
out("umask", process.umask().toString(8));
await tryIt("writeFile wx mode 0o600 → mode", async () => { await fsp.writeFile(join(d, "m"), "x", { flag: "wx", mode: 0o600 }); return (fs.lstatSync(join(d, "m")).mode & 0o777).toString(8); });
await tryIt("mkdir mode 0o700 → mode", async () => { await fsp.mkdir(join(d, "md"), { mode: 0o700 }); return (fs.lstatSync(join(d, "md")).mode & 0o777).toString(8); });
fs.mkdirSync(join(d, "dir1"));
await tryIt("unlink(dir)", () => fsp.unlink(join(d, "dir1")));
await tryIt("unlink(symlink to file) removes link only", async () => { await fsp.unlink(join(d, "b")); return `targetStill=${fs.existsSync(join(d, "target"))}`; });
await tryIt("unlink(missing)", () => fsp.unlink(join(d, "missing")));
const { execFileSync } = await import("node:child_process");
execFileSync("mkfifo", ["-m", "600", join(d, "fifo")]);
await tryIt("unlink(fifo)", () => fsp.unlink(join(d, "fifo")));
await tryIt("rename(missing, x)", () => fsp.rename(join(d, "nosuch"), join(d, "x")));
await tryIt("open wx + write + sync + close", async () => { const h = await fsp.open(join(d, "w.next"), "wx", 0o600); try { await h.writeFile("abc"); await h.sync(); } finally { await h.close(); } });
fs.writeFileSync(join(d, "h.next"), "x"); fs.linkSync(join(d, "h.next"), join(d, "h.other"));
await tryIt("rename of a file with 2 links → dest nlink", async () => { await fsp.rename(join(d, "h.next"), join(d, "h")); return `nlink=${fs.lstatSync(join(d, "h")).nlink}`; });
fs.rmSync(d, { recursive: true, force: true });
```

### Provenance of the outside facts

| Claim used here | Source's own words | Source |
| --- | --- | --- |
| A rename replaces an existing name, and the name never disappears for other processes meanwhile | "Otherwise, if the directory entry named by new exists, it shall be removed and old renamed to new. In this case, a directory entry named new shall remain visible to other threads throughout the renaming operation and refer either to the file referred to by new or old before the operation began." | The Open Group Base Specifications Issue 8, IEEE Std 1003.1-2024, `rename()`, pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html, fetched with `curl` 2026-11-03 |
| A rename of a file onto a folder fails | "If the old argument names a file that is not a directory and the new argument names a directory, … rename() shall fail." | same |
| Flushing a file does not flush its folder's entry | "Calling fsync() does not necessarily ensure that the entry in the directory containing the file has also reached disk. For that an explicit fsync() on a file descriptor for the directory is also needed." | Linux man-pages 6.19 (2026-02-08), `fsync(2)`, man7.org/linux/man-pages/man2/fsync.2.html, fetched with `curl` 2026-11-03 |
| What `fsync` flushes | "fsync() transfers ("flushes") all modified in-core data of (i.e., modified buffer cache pages for) the file referred to by the file descriptor fd to the disk device (or other permanent storage device) so that all changed information can be retrieved even if the system crashes or is rebooted." | same |

The fetched pages' SHA-256 sums (`shasum -a 256`), copies in a `mktemp -d` folder outside the repository: `rename.html` `06671610134b0a52cdf4dcdaf382f72fef85ef51088b8a52b8679c7f03829318`; `fsync.html` `f0a986d21500222ecb69580fc7a910f346c6b1ff1005ca515501fb05bb5d91f5`.

The man page's "even if the system crashes" is the kernel's promise for the call; whether the boot partition's disk and filesystem keep it through a power cut is the rig's (spec line 729).

### Decisions where the parent plan or spec left a choice

Each is the conservative option the planner could find; each is recorded in the backlog (Task 8).

- **D1. A new file, `scripts/box/wifi-boot-copy.mjs`, not `network.mjs`.** The parent plan gives the copy to `network.mjs` (line 191), which is also the NetworkManager driver (line 159), Linux-only and not built. PR 2 already split the format out into `wifi-record.mjs` (its plan's re-map finding 1). The publisher is a third piece that the driver will call; a file of its own keeps each suite inside one implementer's budget. Error codes are `wifi_copy.*`.
- **D2. The publisher takes `decideWifiBootCopy`'s answer, and checks it.** A decision is exactly `{kind: "write", bytes}`, whose `bytes` is a `Uint8Array` that `parseWifiRecord` loads, or exactly `{kind: "remove", reason}`, whose `reason` is one of `WIFI_NO_COPY_REASONS` (new export of `wifi-record.mjs`, the eleven reasons of its `WifiNoCopyReason` type at `:176-178`). Anything else rejects `wifi_copy.decision_invalid` (`decision-invalid`), with no file call and no field value in the error. The whole check runs inside one `try`, so a decision whose `kind` or `bytes` getter throws, or a proxy whose keys throw when listed, is `decision-invalid` too and its error is never kept, as the reader guards its mount answer (`scripts/box/wifi-record.mjs:348-354`). The bytes are copied when `publish` is called, so a caller changing its array while the publication waits its turn changes nothing.
- **D3. The checks before a write are PR 2's reader, plus the publisher's own `lstat` of the folder and of the staging name.** The publisher builds a reader from its own deps (`createWifiRecordReader({bootRoot, ownerUid, inspectBootMount, io: {lstat, open}})`) and runs `read()` first. The reader's refusals `mount-unverified`, `root-changed`, `path-unsafe`, `permissions-unsafe` and `io-failed` become `failed` with that reason and no write. Its refusals about the bytes (`record-oversized`, `record-corrupt`, `record-unsupported`) do not stop the publication: they describe a damaged copy that a regular, root-only file holds, which the publication replaces or removes. So the mount check, the folder rules and the record rules are one code path for reading and writing (re-map finding 7). The publisher then `lstat`s the folder itself (to learn whether it exists) and puts every answer through the same folder check the reader uses (a folder, not a symlink, owned by `ownerUid`, mode `& 0o077` zero; else `path-unsafe` or `permissions-unsafe`), every time and not only after a `mkdir`, so a folder that changed after the reader's check is still refused before a write.
- **D4. `wifi.json.next` must be absent, or a regular file with one link, owned by `ownerUid`, with mode `& 0o077` zero; anything else refuses.** A symlink (to something or to nothing), a folder, a FIFO, a second hard link → `path-unsafe`; a wrong owner or mode → `permissions-unsafe`; an `lstat` error other than "no such name" → `io-failed`; each with no write. A regular leftover that passes is the writer's own (it writes with `wx` and mode `0o600`, re-map finding 4) and is removed. This differs from PR 1, which unlinks a leftover `.next` symlink (`scripts/box/disk-key.mjs:262-267`): parent line 202 says symlinks and non-regular files "refuse with zero fallback writes", and only root can put anything in a root-only folder, so such a name is a fault, not a leftover. The cost: a box with one stays `failed` until root removes it, and that includes every removal. An unsafe `wifi.json.next` or `wifi.json` refuses a "no copy" answer too, so after a switch to cable-only an obsolete copy, and its password, can stay where preboot reads it until the fault is cleared. The status says `failed`, never `absent`.
- **D5. Writing a copy, in this order** (the folder already checked): if the folder is missing, `mkdir` it with mode `0o700` and `lstat` it again (a folder, the owner, mode `& 0o077` zero, else `path-unsafe` or `permissions-unsafe`); flush the boot root, on every write, as PR 1 flushes its parent (`scripts/box/disk-key.mjs:253-255`); `unlink` a leftover `wifi.json.next`; `writeFile(next, bytes, {flag: "wx", mode: 0o600})`; `syncFile(next)`; `rename(next, wifi.json)`; `syncDirectory(folder)`; read back with the reader, which must answer `loaded` with a network whose `formatWifiRecord` bytes equal the decision's. Only then `current`.
- **D6. Nothing is written when the copy is already right.** When the reader answered `loaded` with the decision's bytes and there is no `wifi.json.next`, the publication only flushes the boot root and the folder (an earlier flush may have failed in this process, which a later call cannot tell) and answers `current`. So a publication at every start rewrites nothing on a box whose Wi-Fi did not change.
- **D7. Every "no copy" answer removes `wifi.json` too, not only cable-only.** Re-map finding 9: PR 4's `remove` means no copy should exist. Order: `unlink(wifi.json)` if the reader found one, then `unlink(wifi.json.next)` if present, then `syncDirectory(folder)` (also when nothing was removed, for the same reason as D6), then check that the reader answers `absent` and `wifi.json.next` is gone. Only then `absent`. The active copy goes first, so preboot stops trying an obsolete network as early as possible; both names hold a password, so the order does not change the exposure. A missing folder is `absent` with no write and no flush. The folder itself is never removed, because other recovery files may share it.
- **D8. A failed step stops the publication there, and one rule names the failure.** A file operation that throws (or rejects with anything at all, a plain string included) while writing, flushing or removing ends the publication with `failed` / `io-failed`, whether it came before or after the rename; no further file call is made, not even a clean-up of `wifi.json.next`: the next publication removes a leftover (D4). Any failure or mismatch during the read-back or the removal check, its own reads included (the reader's calls and the check's `lstat` of `wifi.json.next`), is `failed` / `publication-unverified`. PR 1 splits differently, calling a failed folder flush after the rename `publication-unverified` (`scripts/box/disk-key.mjs:273-281`), because there a second store for the same disk is refused whatever the key (`record-exists` is decided by the disk's id alone, `:258-259`) and the caller must know the record is in place. Here a retry is always safe and `failed` claims nothing about which copy is on the disk, so a split at the rename would tell the caller nothing it can act on. `failed` never says which copy, if any, is on the disk (spec lines 725–727: "do not claim secure erasure or that a failed cleanup removed physical exposure"). The thrown error is never kept, passed on or logged: an injected operation's message may hold the password.
- **D9. The status.** `status()` answers a frozen `{state, reason, failure}` with no other key, so it can never be read as a connectivity answer (parent lines 195–196, "separately from actual live connectivity"):
  - `state`: `pending` from construction until the first publication finishes, and whenever a publication is called and not yet finished; otherwise the state the last finished publication reached: `current`, `absent` or `failed`.
  - `reason`: the most recently called decision's reason when it is a `remove`, else `null` (a `write`, or no publication yet).
  - `failure`: one of `mount-unverified`, `root-changed`, `path-unsafe`, `permissions-unsafe`, `io-failed`, `publication-unverified` when `state` is `failed`, else `null`.
  
  `publish` resolves with the status its own publication reached, never `pending`. A publication refused as `decision-invalid` changes no status.
- **D10. One publication at a time per publisher, in call order.** A second call waits for the first to finish (PR 1's turn, `scripts/box/disk-key.mjs:149-159`). With the latest decision always last, the copy ends as the latest decision says, whatever was queued before it. Serialising the whole network change (live apply and publication together) is the host service's (spec line 711).
- **D11. The durable pending intent is Out, and should hold no password.** It is not out for want of a way to test it: PR 1 built and tested an `@host-state` store here (re-map finding 8). (a) The intent covers a whole network change, whose other half, applying and checking the new settings in NetworkManager (spec line 712), is Linux and radio work not built here; what the intent must record (which change, which phase, what the restart does with it) depends on that half, so writing its format now would be guessing. (b) The publication alone does not need it: it always starts from the decision for the box's current settings, removes any leftover, and is safe to repeat, so a restart's reconciliation is one `publish(decideWifiBootCopy(<current settings>))`, which Task 7 tests after every stopped step. (c) For slice 3, a proposal: the intent records only that a change began and finished, with no password. Then it can never replay an obsolete password (spec line 725), and it is encrypted by the LUKS2 container that already holds `@host-state` (re-map finding 8), so it needs no new host key, which nothing owns today.
- **D12. Fixed entry points.** `publishWifiBootCopy(decision)` and `wifiBootCopyStatus()` share one publisher over `BOOT_ROOT` (`/boot`, `scripts/box/wifi-record.mjs:266`) with owner 0 and a mount check that throws. Until the Linux pull request replaces that check, every valid decision answers `failed` / `mount-unverified` with no file call, as the reader's fixed entry point does (`:428-443`).
- **D13. The deps are the reader's, with PR 1's eight file operations.** `createWifiBootCopyPublisher` takes exactly `bootRoot`, `ownerUid`, `inspectBootMount` and an optional `io` with exactly `lstat`, `open`, `mkdir`, `writeFile`, `rename`, `unlink`, `syncFile`, `syncDirectory` as functions; anything else throws `wifi_copy.deps_invalid` (`deps-invalid`) at construction, before any call. A key present with the value `undefined` counts as present, so `io: undefined` is refused, as PR 2's reader refuses it (`exactRecord` counts every own key, `scripts/box/upgrades/contracts.mjs:7-15`; the reader's check, `scripts/box/wifi-record.mjs:306-314`); a caller wanting the default leaves the key out. The default `io` is PR 1's: `disk-key.mjs` gains one line, `export { defaultIo as hostFileIo };`, with no other change to it and none to its tests (103 before and after), and `WifiCopyIo` is `import("./disk-key.mjs").DiskRecoveryIo`. One copy of the flush code serves both stores.

## Execution notes for every task

**Worktree.** Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-5-wifi-publication`, and run commands from that folder.

**Style precedent.**
- `scripts/box/disk-key.mjs` sets the style for a staged write: the eight-operation `io`, the turn, refusals kept in a `WeakSet` so an injected error that merely carries a code cannot pass through (`:68-82`), and the default flushes.
- `scripts/box/wifi-record.mjs` sets the style for results: an expected outcome is a returned frozen object; only a caller's programming error throws, as `Object.assign(new Error(code), { code, reason })`.
- No decision number (D1, D2 …) goes into code, a comment or a test name; cite the spec section or nothing. `git grep -n -E "\bD[0-9]+\b" -- 'scripts/box/*.mjs'` printed nothing on 2026-11-03.

**Test conventions.**
- Tests import `afterEach`, `describe`, `expect`, `it` and `vi` from `vitest`.
- **Red means a named assertion failing.** Before implementing, add new exports as stubs that throw `new Error("not implemented")` (constants get their real values), so the red run reports each case failing with "not implemented" or on its assertion, not one import error for the whole file. Where a later task's red run sees an earlier task's catch-all turn its stub's throw into `failed` / `io-failed`, the case fails on its assertion; that is red too.
- Do not import from another `*.test.mjs` file (its tests would run twice); copy the helpers a task names.
- **Real files.** Every fixture lives under `fs.realpath(await fs.mkdtemp(join(tmpdir(), "b3-wifi-copy-")))`, removed in `afterEach`. Set modes with `fs.chmod` after creating (the umask may differ). No test may depend on letter case in file names (macOS's default file system treats `WIFI.JSON` as `wifi.json`, PR 2's plan line 164).
- **The `node:fs/promises` mock** (Task 1 adds it, Task 5 uses its hook): one `vi.mock("node:fs/promises", …)` that records `[name, path]` for every `lstat`, `open`, `mkdir`, `writeFile`, `rename`, `unlink` call into a hoisted `fsCalls.log`, and routes `writeFile` through a hoisted `fsHooks.writeFile` when one is set (re-map finding 12). The mock also logs the fixture's own setup calls, so a case clears `fsCalls.log` immediately before the call under test, and sets `fsHooks.writeFile` only after its fixture is built. `afterEach` clears both.
- **No output, for the whole file.** A `beforeEach` spies on every `console` method, `process.stdout.write` and `process.stderr.write`; the `afterEach` asserts none was called, then restores them. So every case, not only the sweep, checks that nothing was written out.

**Coverage for one file.** Read the summary counts (the per-file table may print no rows, re-map finding 11); `0/0` means the include matched nothing. The command exits 1 when the file is below the bar ("ERROR: Coverage for lines (…) does not meet global threshold"). In Tasks 1–4 that is expected while a later task's code is still a stub: each task names the stubbed functions whose lines may be uncovered, and any other uncovered line is a gap to close in that task. From Task 5 on the run must exit 0 at 98/98/98/95; aim for 100%. Never add a test that asserts nothing, an `exclude` or an ignore comment to reach it.
`pnpm exec vitest run scripts/box/wifi-boot-copy.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/wifi-boot-copy.mjs`

**Before each commit.** `pnpm exec prettier --check <changed .mjs files>` and `pnpm exec eslint <changed .mjs files>`, each checked for its own exit status, and read the `Tests` count (CLAUDE.md §4). `docs/` is ignored by prettier whole (`pnpm exec prettier --file-info docs/backlog/box.md` prints `"ignored": true`), so Task 8 checks nothing with prettier. The pre-push hook and CI do the rest; do not run the whole workspace.

**Long runs.** An implementer past about 150 tool calls with the task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover: what is done, what is left, which files, and each check's state.

**Order.** Tasks 1 → 7 one after another (one module and one test file), then 8. All in this one worktree (CLAUDE.md §6).

### Shared test helpers (Task 1 writes them; later tasks add to them)

- `SSID`, `wifiFields`-style builders copied from `scripts/box/wifi-record.test.mjs:20-35`; `PASSWORD_A = "Bar-Àngels-2026"`, `PASSWORD_B = "Crème-brûlée-2027"`; `writeA = decideWifiBootCopy(wifi({keyMgmt: "sae", psk: PASSWORD_A}))`, `writeB` the same with `PASSWORD_B`; `removeCable = decideWifiBootCopy({kind: "cable-only"})`; `removeOpen = decideWifiBootCopy(wifi({keyMgmt: null, psk: null}))`.
- `countingIo(overrides)`: the eight real operations (`REAL_IO`, as `scripts/box/disk-key.test.mjs:96-105`), each logging `[name, path]` (both paths for `rename`) into `log` and then calling the override or the real one.
- `WRITE_OPS = ["mkdir", "writeFile", "rename", "unlink"]`, `FLUSH_OPS = ["syncFile", "syncDirectory"]`.
- `fixture({folder = true, record = "A" | "B" | null | <text>, next = null | <text>})`: makes `<parent>/boot` (mode `0o755`), `boot/waitron-recovery` (`0o700`) when `folder`, `wifi.json` and `wifi.json.next` (`0o600`) from the record's bytes or text, and an unrelated `boot/waitron-recovery/recovery.crt` (`0o600`, text `"not wifi"`); returns `{parent, bootRoot, folder, recordPath, nextPath, answer, inspectBootMount, counting, make(deps), reader()}`, where `make` builds a publisher with `ownerUid: process.getuid()` and the counting io, and `reader()` builds PR 2's reader over the same boot root with real io.
- `snapshot(parent)`: walks the tree with `lstat` only, never following a link or opening a FIFO, and returns a sorted list of `[relative path, kind, mode & 0o7777, nlink, link target or file bytes as hex]`.
- `statsWith`, `foreignOwner`, `lstatAt`, `settleOrRelease`, `mkfifo`, `passwordForms`, `expectNoForm` copied from `scripts/box/wifi-record.test.mjs:277-336`, `:432-435`, `:1078-1106`.

---

### Task 1: the reasons list, construction, the decision check, the first status and the mount refusal

**Files:**
- Modify: `scripts/box/wifi-record.mjs` (one export), `scripts/box/wifi-record.test.mjs` (one new `describe` at the end; nothing existing changes)
- Modify: `scripts/box/disk-key.mjs`, one line only: `export { defaultIo as hostFileIo };` (D13). `scripts/box/disk-key.test.mjs` is not changed.
- Create: `scripts/box/wifi-boot-copy.mjs`
- Test: `scripts/box/wifi-boot-copy.test.mjs`

**Interfaces:**

```js
// wifi-record.mjs
/** Every reason decideWifiBootCopy gives for no copy. Frozen. */
export const WIFI_NO_COPY_REASONS; // ["cable-only", "open", "open-or-wep", "dynamic-wep", "owe", "enterprise",
//   "unsupported-security", "password-unavailable", "password-not-printable", "password-too-long", "password-invalid"]

// wifi-boot-copy.mjs
/**
 * @typedef {'pending'|'current'|'absent'|'failed'} WifiCopyState
 * @typedef {'mount-unverified'|'root-changed'|'path-unsafe'|'permissions-unsafe'|'io-failed'
 *   |'publication-unverified'} WifiCopyFailure
 * @typedef {object} WifiCopyStatus  frozen; exactly these keys; says nothing about live connectivity
 * @property {WifiCopyState} state
 * @property {import("./wifi-record.mjs").WifiNoCopyReason|null} reason  when the decision is a remove, its reason: from publish, its own decision's; from status(), the most recently called one's
 * @property {WifiCopyFailure|null} failure  set exactly when state is failed
 * @typedef {import("./disk-key.mjs").DiskRecoveryIo} WifiCopyIo
 * @typedef {object} WifiCopyDeps
 * @property {string} bootRoot  absolute and equal to its own path.resolve; equal to its realpath is the caller's duty
 * @property {number} ownerUid  0 in production; tests pass process.getuid()
 * @property {() => Promise<{bootRoot: string, rootId: string}>} inspectBootMount
 * @property {WifiCopyIo} [io]  test-only override; leave the key out for disk-key.mjs's hostFileIo (undefined is refused)
 */
/** Throws wifi_copy.deps_invalid (deps-invalid) at construction. @param {WifiCopyDeps} deps
 *  @returns {{ publish(decision: import("./wifi-record.mjs").WifiCopyDecision): Promise<WifiCopyStatus>, status(): WifiCopyStatus }} */
export function createWifiBootCopyPublisher(deps);
/** Fixed production entry point; until the Linux pull request adds the boot-mount check, a valid decision
 *  answers failed / mount-unverified with no file call. */
export async function publishWifiBootCopy(decision);
export function wifiBootCopyStatus();
```

In this task `publish` validates the decision, takes its turn, runs the reader, and maps the reader's five unsafe refusals to `failed`; what follows a passing check is a stub that throws `new Error("not implemented")`, which the turn's catch-all reports as `failed` / `io-failed` (Tasks 3 and 4 replace it).

- [ ] **Step 1: Write the failing tests.**
  - **`WIFI_NO_COPY_REASONS`** (in `wifi-record.test.mjs`, a new `describe` after the last one): equals the eleven reasons above in that order and is frozen; every `removeCases` reason (`scripts/box/wifi-record.test.mjs:1391`) is in it, and every entry is the reason of at least one `removeCases` row.
  - **Deps:** each of a relative `bootRoot`, `"/tmp/x/../y"`, `ownerUid` `-1` and `1.5`, a missing `inspectBootMount`, an extra key, `io` missing any one of the eight operations (eight cases), `io` with `rename: "x"`, `io: undefined` (a key present with no value) → throws `{code: "wifi_copy.deps_invalid", reason: "deps-invalid"}`, and neither the seam nor any io operation was called.
  - **First status:** a new publisher's `status()` is `{state: "pending", reason: null, failure: null}`, frozen, with exactly those three keys.
  - **Decision check:** each of `null`, `{kind: "write"}`, `{kind: "write", bytes: [1, 2]}`, `{kind: "write", bytes: "x"}`, `writeA` plus an extra key, `{kind: "write", bytes: <canonical bytes of a WPA2 record whose password is "CANARY1">}` (7 characters, which the reader refuses), `{kind: "remove"}`, `{kind: "remove", reason: "other"}`, `{kind: "remove", reason: null}`, `{kind: "erase", reason: "cable-only"}`, an object whose `bytes` getter throws `new Error("bytes unreadable: " + PASSWORD_A)`, one whose `kind` getter does the same, and a `Proxy` whose `ownKeys` throws an error holding `PASSWORD_A` → `publish` rejects `{code: "wifi_copy.decision_invalid", reason: "decision-invalid"}`; no seam or io call; `status()` is still the first status; and each of the CANARY case's and the three throwing cases' errors, as `String`, `JSON.stringify({...error})` and `inspect(error, {depth: 10, showHidden: true})`, holds no form of `"CANARY1"` or `PASSWORD_A`.
  - **The mount refusal, with zero calls:** for `writeA` and for `removeCable`, with `inspectBootMount` that throws (its message holding `PASSWORD_A`), answers `null`, answers another `bootRoot`, answers `rootId: "x"` → `publish` resolves `{state: "failed", reason: <null for writeA, "cable-only" for removeCable>, failure: "mount-unverified"}`, `status()` equals it, and the counting io's log is empty.
  - **One `lstat`:** the boot root removed → `mount-unverified`; a `rootId` for another folder → `root-changed`; the boot root `0o775` → `permissions-unsafe`. Each log holds exactly one `lstat`, of the boot root, and `snapshot(parent)` is unchanged.
  - **Positive control:** `writeA` on a clean fixture does **not** resolve `failed` with `mount-unverified`, `root-changed` or `permissions-unsafe` (it resolves `failed` / `io-failed` from the stub in this task, and `current` from Task 3 on; assert only the negative).
  - **Fixed entry points:** `publishWifiBootCopy(writeA)` resolves `{state: "failed", reason: null, failure: "mount-unverified"}`, `wifiBootCopyStatus()` then equals it, and `fsCalls.log` is empty; `publishWifiBootCopy({kind: "write"})` rejects `decision-invalid`. Both in one case, because the fixed publisher is shared by the whole file.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/wifi-record.test.mjs scripts/box/wifi-boot-copy.test.mjs`. Expected: the `WIFI_NO_COPY_REASONS` case passes once the constant is added with its real value (the stub rule above), and the 267 earlier `wifi-record` cases pass; every `wifi-boot-copy` case fails with "not implemented" or on its assertion; no import error.
- [ ] **Step 3: Implement** the export, `createWifiBootCopyPublisher` (deps check, decision check, the turn, the reader run and its mapping, the status), the `hostFileIo` export in `disk-key.mjs` and its import as the default, and the two fixed entry points.
- [ ] **Step 4: Run green**, then the coverage command for `wifi-boot-copy.mjs`. It may exit 1: uncovered lines are expected only in the stub that stands for the work after the checks (Tasks 3 and 4 replace it); any other uncovered line is a gap to close now. Then the one-file coverage command for `wifi-record.mjs` (`--coverage.include=scripts/box/wifi-record.mjs`), which must still read 100%, and `pnpm exec vitest run scripts/box/disk-key.test.mjs`: `Tests  103 passed`.
- [ ] **Step 5: Deletion controls.** Make each change, run, see the named case fail, undo:
  - Accept a write whose bytes the reader refuses → the CANARY1 case resolves.
  - Drop the extra-key check on the decision → its case resolves.
  - Map the reader's `mount-unverified` to `io-failed` → the four mount cases fail.
  - Return the reader's refusal object as the status instead of building one → the mount cases' exactly-three-keys assertion fails (the reader's answer has `kind` and `reason`).
  - Read `decision.bytes` outside the `try` → the throwing-getter case rejects with the getter's own error (its code is not `wifi_copy.decision_invalid`, and its message holds `PASSWORD_A`).
- [ ] **Step 6: Commit.** `git add scripts/box/wifi-record.mjs scripts/box/wifi-record.test.mjs scripts/box/disk-key.mjs scripts/box/wifi-boot-copy.mjs scripts/box/wifi-boot-copy.test.mjs && git commit -s -m "feat(box): check a Wi-Fi boot-copy decision and the boot mount before publishing"`. The body says the publisher takes PR 4's decision and checks it (D2), uses PR 2's reader as its first check (D3), starts `pending` (D9), and that the fixed entry points refuse until the Linux mount check exists (D12); says `disk-key.mjs` only gained the `hostFileIo` export (D13, 103 tests before and after); names the deletion controls.

### Task 2: every other refusal before a write

**Files:**
- Modify: `scripts/box/wifi-boot-copy.mjs`, `scripts/box/wifi-boot-copy.test.mjs`

- [ ] **Step 1: Write the failing tests.** One table, each row run twice, with `writeB` and with `removeCable`, on a fixture holding record A unless the row says otherwise. Every row asserts: the status is `{state: "failed", reason: <null | "cable-only">, failure: <the row's>}`; no `WRITE_OPS` or `FLUSH_OPS` name is in the log; `snapshot(parent)` equals the one taken before.
  - The folder is a symlink to a real folder holding a valid record → `path-unsafe`; the folder is a regular file → `path-unsafe`; the folder is `0o750` → `permissions-unsafe`; the folder's owner reads as another (`lstatAt(folder, foreignOwner)`) → `permissions-unsafe`.
  - `wifi.json` is a symlink to a valid record elsewhere → `path-unsafe`; a symlink to nothing → `path-unsafe`; a folder → `path-unsafe`; a FIFO → `path-unsafe`, and the publication settles within 2 seconds (`settleOrRelease`); has a second hard link (`fs.link` to `wifi.json.other` in the same folder) → `path-unsafe`; is `0o640` → `permissions-unsafe`; its owner reads as another (through the handle's `stat`, as `scripts/box/wifi-record.test.mjs:308-321` does with `openWith`) → `permissions-unsafe`.
  - `wifi.json.next` is a symlink to a regular file → `path-unsafe`, and the target is unchanged; a symlink to nothing → `path-unsafe`, and nothing exists at the target; a folder → `path-unsafe`; a FIFO → `path-unsafe`; has a second hard link → `path-unsafe`; is `0o640` → `permissions-unsafe`; its owner reads as another → `permissions-unsafe`.
  - The same `.next` rows with **no** `wifi.json` (the folder holding only the `.next`), so the reader's `absent` does not hide them.
  - The reader's `open` of `wifi.json` throws `EACCES` → `io-failed` (the reader's own); the publisher's own `lstat` of the folder (the second `lstat` of that path in the log) throws `EIO` → `io-failed`; the `lstat` of `wifi.json.next` throws `EIO` → `io-failed`. These three rows also assert that the log's last entry is the failing call (Task 1's catch-all answers `io-failed` for its stub too, so without this the rows would pass before Task 2's code exists).
  - **The folder changes after the reader's check:** the publisher's own `lstat` of the folder (the second of that path) answers `foreignOwner` stats → `permissions-unsafe`; answers stats whose `isSymbolicLink()` is true → `path-unsafe` (D3).
  - **Positive controls:** a regular, `0o600` leftover `wifi.json.next` → not refused (in this task it reaches the stub's `io-failed`; assert only that `failure` is not `path-unsafe` or `permissions-unsafe`); a `wifi.json` holding a corrupt record (`"{}\n"`) and one of 1025 bytes → the same.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/wifi-boot-copy.test.mjs`. Expected: the folder and `wifi.json` rows already pass (the reader refuses them, Task 1), and so does the reader's `EACCES` row, last-entry assertion included (Task 1 already ends the publication on the reader's `io-failed`); the `.next` rows, the publisher's own `lstat` rows and the changed-folder rows fail on their assertions; Task 1's cases pass.
- [ ] **Step 3: Implement** the publisher's `lstat` of the folder (to learn whether it exists) and of `wifi.json.next`, and D4's rules.
- [ ] **Step 4: Run green**, then the coverage command. It may exit 1: uncovered lines are expected only in the stub for the write and remove paths (Tasks 3–4).
- [ ] **Step 5: Deletion controls.**
  - Check `wifi.json.next` with `stat` instead of `lstat` → the symlink-to-a-file row is not refused.
  - Drop the `nlink` check → the hard-link `.next` row is not refused.
  - Skip the `.next` check when the reader answered `absent` → the no-`wifi.json` rows fail.
  - Unlink a `.next` symlink instead of refusing (PR 1's rule) → the symlink rows see `unlink` in the log.
- [ ] **Step 6: Commit.** `git add scripts/box/wifi-boot-copy.mjs scripts/box/wifi-boot-copy.test.mjs && git commit -s -m "feat(box): refuse an unsafe Wi-Fi boot-copy folder or staging file with no write"`. The body lists D3 and D4 and says why a `.next` symlink is refused here where PR 1's store removes one.

### Task 3: writing a copy

**Files:**
- Modify: `scripts/box/wifi-boot-copy.mjs`, `scripts/box/wifi-boot-copy.test.mjs`

- [ ] **Step 1: Write the failing tests.** `path(f, name)` is the folder's path for a name; the logs below are the counting io's, in order, with the reader's calls included.
  - **A new folder:** `fixture({folder: false})`, `writeB` → `{state: "current", reason: null, failure: null}`; the log is exactly `lstat boot`, `lstat folder` (the reader: absent), `lstat folder` (the publisher), `mkdir folder`, `lstat folder`, `syncDirectory boot`, `writeFile next`, `syncFile next`, `rename next → record`, `syncDirectory folder`, `lstat boot`, `lstat folder`, `open record` (the read-back). The folder is `0o700`, `wifi.json` is `0o600` with one link and holds exactly `writeB.bytes`, there is no `wifi.json.next`, and `f.reader().read()` answers `loaded` with B's network.
  - **Replacing A with B:** the log is `lstat boot`, `lstat folder`, `open record`, `lstat folder`, `lstat next`, `syncDirectory boot`, `writeFile next`, `syncFile next`, `rename next → record`, `syncDirectory folder`, then the read-back's three calls; `wifi.json` holds B; `recovery.crt` is unchanged.
  - **A leftover `.next`** (regular, `0o600`, holding half of A's bytes): `unlink next` comes right after `syncDirectory boot` and before `writeFile next`; the result is `current` with B.
  - **A damaged copy** (`"{}\n"`, and 1025 bytes of `"a"`) → replaced by B, `current`.
  - **Already right:** a fixture holding B, `writeB` → `current`; the log has no `WRITE_OPS` and no `syncFile`, and holds exactly `syncDirectory boot` and `syncDirectory folder` after the checks; `wifi.json`'s inode and `mtimeMs` are unchanged.
  - **Already right, with a leftover `.next`** → the full write runs (the log holds `unlink next`, `writeFile next`, `rename`), `current`.
  - **The written file is what the reader loads:** for every write case in `scripts/box/wifi-record.test.mjs:1381-1389`'s style (WPA2; hidden WPA3 with `"Crème brûlée Àngels"`; a 64-hex-digit WPA2 password), `publish(decideWifiBootCopy(settings))` then `f.reader().read()` → `loaded` with that network.
  - **A new folder that comes out wrong:** a `mkdir` override that makes the folder with mode `0o755` → `failed` / `permissions-unsafe`, and no `writeFile` in the log (the folder made is left).
  - **The read-back must match:** an `open` override that, for the read-back only (the second `open` of `wifi.json` in the log), opens a different valid record (A's, written to `elsewhere.json` in the folder) → `failed` / `publication-unverified`.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/wifi-boot-copy.test.mjs`. Expected: the new cases fail on their assertions (the stub answers `failed` / `io-failed`); Tasks 1–2's cases pass.
- [ ] **Step 3: Implement** D5 and D6.
- [ ] **Step 4: Run green**, then the coverage command. It may exit 1: uncovered lines are expected only in the stub for the remove path (Task 4).
- [ ] **Step 5: Deletion controls.**
  - Drop `syncDirectory folder` → both write logs fail.
  - Write `wifi.json` directly instead of through `.next` → the logs fail, and so does Task 7 later.
  - Skip the read-back → the read-back mismatch case answers `current`.
  - Skip the flushes in the already-right path → its log fails.
  - Use flag `w` instead of `wx` → no case here fails, but Task 7's "planted link" case does (re-map finding 4); note it in the commit body instead of adding a duplicate case.
- [ ] **Step 6: Commit.** `git add scripts/box/wifi-boot-copy.mjs scripts/box/wifi-boot-copy.test.mjs && git commit -s -m "feat(box): publish the Wi-Fi boot copy through a flushed staging file and read it back"`. The body lists D5 and D6 and names the controls.

### Task 4: removing the copy

**Files:**
- Modify: `scripts/box/wifi-boot-copy.mjs`, `scripts/box/wifi-boot-copy.test.mjs`

- [ ] **Step 1: Write the failing tests.**
  - **Cable-only over A:** `removeCable` → `{state: "absent", reason: "cable-only", failure: null}`; the log after the checks is exactly `unlink record`, `syncDirectory folder`, then the verification (the reader's `lstat boot`, `lstat folder` and `open record`, which finds nothing, then `lstat next`); there is no `wifi.json` and no `.next`; the folder and `recovery.crt` remain, unchanged; `f.reader().read()` → `absent`.
  - **Every reason removes it:** for each row of `WIFI_NO_COPY_REASONS`, a decision `{kind: "remove", reason}` over A → `absent` with that reason, and no `wifi.json`.
  - **A over a leftover `.next`:** the log holds `unlink record` before `unlink next`, then `syncDirectory folder`; both gone.
  - **Only a leftover `.next`:** `unlink next`, `syncDirectory folder` → `absent`.
  - **A damaged copy** (`"{}\n"`) → removed, `absent`.
  - **Nothing there, folder present:** no `WRITE_OPS`; exactly one `syncDirectory folder`; `absent`.
  - **No folder:** no `WRITE_OPS` and no `FLUSH_OPS`; `absent`; the folder is still absent (never made).
  - **The verification must see nothing:** an `unlink` override that reports success for `wifi.json` without removing it → `failed` / `publication-unverified`; the same for `.next`.
  - **Remove, then write:** `removeCable` then `writeB` on one publisher → `absent`, then `current` with B.
- [ ] **Step 2: Run red.** Same command. Expected: the new cases fail on their assertions; Tasks 1–3's pass.
- [ ] **Step 3: Implement** D7.
- [ ] **Step 4: Run green**, then the coverage command. Read the counts; a line still uncovered here is either reached by Task 5's failure cases (name it in the handover) or a gap to close now.
- [ ] **Step 5: Deletion controls.**
  - Remove `wifi.json` only for `cable-only` (the spec's literal words) → the every-reason rows fail for the other ten.
  - Swap the two unlinks → the order case fails.
  - Skip the flush when nothing was removed → the nothing-there case fails.
  - Skip the verification → the fake-unlink cases answer `absent`.
- [ ] **Step 6: Commit.** `git add scripts/box/wifi-boot-copy.mjs scripts/box/wifi-boot-copy.test.mjs && git commit -s -m "feat(box): remove the Wi-Fi boot copy and its staging file on every no-copy answer"`. The body lists D7 and says the folder is never removed.

### Task 5: a failure at every step, the default file operations, and the password sweep

**Files:**
- Modify: `scripts/box/wifi-boot-copy.mjs` only if a case finds a defect (record the cause in the commit body), `scripts/box/wifi-boot-copy.test.mjs`

**Helper.** `failAt(name, nth = 1, message)`: an override for operation `name` that throws `Object.assign(new Error(message), {code: "EIO"})` on its `nth` call and calls the real one otherwise. Every injected message holds the password being written (`PASSWORD_B`) and the one on disk (`PASSWORD_A`).

- [ ] **Step 1: Write the tests.**
  - **Write path, A → B with a leftover `.next`** (half of A's bytes), failing at each step. Each → `{state: "failed", reason: null, failure: "io-failed"}`, and the log ends with the failing call (no call after it). On disk afterwards, and what `f.reader().read()` answers:

    | Failing call | `wifi.json` | `wifi.json.next` | reader |
    | --- | --- | --- | --- |
    | `syncDirectory`, `nth` 1 (the boot root) | A | the leftover | `loaded` A |
    | `unlink` (the leftover) | A | the leftover | `loaded` A |
    | `writeFile` (throws before writing) | A | none | `loaded` A |
    | `syncFile` | A | B whole | `loaded` A |
    | `rename` | A | B whole | `loaded` A |
    | `syncDirectory`, `nth` 2 (the folder) | B | none | `loaded` B |

    Then a second publisher with real io and `writeB` → `current`, B, no `.next`.
  - **New-folder path** (`fixture({folder: false})`, `writeB`), failing at `mkdir`, and at the publisher's `lstat` of the folder after it (the third `lstat` of the folder in the log, counting the reader's): each → `failed` / `io-failed`, the log ends with the failing call, no `wifi.json`, the reader answers `absent`; then real io and `writeB` → `current`.
  - **Remove path, A with a leftover `.next`**, failing at the first `unlink` (`wifi.json`), the second (`.next`) and `syncDirectory`: each → `{state: "failed", reason: "cable-only", failure: "io-failed"}`; the log ends with the failing call; on disk, A and `.next` remain for the first, only `.next` for the second, neither for the third. Then real io and `removeCable` → `absent`.
  - **The read-back's own calls fail:** the read-back's `open` throws → `failed` / `publication-unverified` (the reader turns the throw into `io-failed`, which is not `loaded`; D8's rule). The same for the removal check's reader call, and for the removal check's own `lstat` of `wifi.json.next` throwing `EIO` (the last `lstat` of that path in the log): `failed` / `publication-unverified`, with that `lstat` the log's last entry.
  - **A rejection that is not an error:** an override for `writeFile` that rejects with the plain string `"boom " + PASSWORD_B` → `failed` / `io-failed`, the promise resolves (it does not reject), and the status holds no form of `PASSWORD_B`. A permanent case.
  - **The default operations** (publisher made with no `io` key at all, not `io: undefined`, which D13 refuses; so `disk-key.mjs`'s `hostFileIo` runs over the mocked `node:fs/promises`, seen through `fsCalls` and `fsHooks`): `writeB` on a clean fixture → `current`, B on disk, and `fsCalls.log`, cleared just before the call, is not empty and holds `rename` (the positive control for Task 1's empty-log check); `fsHooks.writeFile` that creates a symlink at the staging path instead of writing → `failed` / `io-failed` (the default `syncFile` opens with `O_NOFOLLOW`), `wifi.json` still A; `fsHooks.writeFile` that makes a FIFO there → `failed` / `io-failed` within 2 seconds (`settleOrRelease`), `wifi.json` still A. Set each hook only after the fixture is built. These run the publisher over PR 1's default flushes' symlink and non-file branches, as `scripts/box/disk-key.test.mjs:1106-1155` does for PR 1's store.
  - **Password sweep (Review Focus 4):** one case that reruns every failure case above (the write table's six rows, the two new-folder rows, the three remove rows, the two read-back rows, the plain-string row, the two default-operation refusals) and every `decision-invalid` decision of Task 1, collecting each status and each error. Assert the list holds at least 29 entries (16 statuses and 13 errors: Task 1's ten shape refusals including the CANARY1 bytes, and its three throwing decisions), so a filtered or emptied list cannot pass. Assert no entry's `JSON.stringify` (of `{...error}` for an error), `String` or `inspect(…, {depth: null, showHidden: true})` holds any of `passwordForms(PASSWORD_A)` or `passwordForms(PASSWORD_B)`. The file-wide output spies (execution notes) check that nothing was written out. Positive control: the bytes on disk after a `current` do hold `PASSWORD_B`.
- [ ] **Step 2: Run them.** `pnpm exec vitest run scripts/box/wifi-boot-copy.test.mjs`. They should pass on Tasks 1–4's code; a failure here is a defect to fix under this task.
- [ ] **Step 3: Deletion controls.**
  - Make one clean-up attempt (`unlink next`) after a failed `writeFile` → the log-ends-with-the-failing-call assertion fails.
  - Put the caught error's message into the status's `failure` → the sweep fails.
  - Catch only `Error` objects and let others through → the plain-string case sees `publish` reject instead of answering `io-failed`.
- [ ] **Step 4: Run the coverage command** and read the counts: 100% is the aim, 98/98/98/95 the bar.
- [ ] **Step 5: Commit.** `git add scripts/box/wifi-boot-copy.test.mjs` (plus `scripts/box/wifi-boot-copy.mjs` if changed) `&& git commit -s -m "test(box): fail the Wi-Fi boot copy at every step and sweep for its password"`. The body lists D8.

### Task 6: one publication at a time, and the status while one runs

**Files:**
- Modify: `scripts/box/wifi-boot-copy.mjs`, `scripts/box/wifi-boot-copy.test.mjs`

**Helper.** `gate(name, nth)`: an override for operation `name` whose `nth` call waits on a promise the test releases, then calls the real one; it exposes `reached` (a promise that settles when the call starts) and `release()`.

- [ ] **Step 1: Write the failing tests.**
  - **Pending while it runs:** a publisher that has already finished one publication (`await publish(writeA)`, `current`); then right after `const p = publisher.publish(writeB)` (not awaited), `status()` is `{state: "pending", reason: null, failure: null}`; after `await p`, `current`. (A new publisher is `pending` from construction, D9, so the first publication must finish before this check means anything.)
  - **Pending until the last queued one finishes:** `const a = publish(writeA)`, then `publish(removeCable)` paused at its `unlink`; `await a` (A is `current`); then `status()` is `{state: "pending", reason: "cable-only", failure: null}`, not A's outcome; after release, `absent` with `cable-only`.
  - **Pending carries a remove's reason:** a publisher that has reached `current` with B, then `publish(removeOpen)` gated at `unlink` → while waiting, `status()` is `{state: "pending", reason: "open", failure: null}`.
  - **In call order, one at a time:** `publish(writeA)` gated at `rename`, then `publish(writeB)` called at once. While A waits, the log holds no call of B's (B's first call, the reader's `lstat boot`, comes after A's last read-back call). After both: A's promise resolved `current`, B's resolved `current`, the disk holds B, and `status()` equals B's.
  - **The last call wins, whatever came before:** `publish(writeB)`, `publish(removeCable)`, `publish(writeA)` in one tick → the disk holds A; `status()` is `current` with reason `null`; the three promises resolved `current`, `absent` (reason `cable-only`), `current`.
  - **A failure, then a success:** a first publication failing at `rename` (Task 5's `failAt`), then a second with real io → `failed`, then `current`; `status()` is `current`.
  - **The bytes are taken at the call:** a hand-built `{kind: "write", bytes: Uint8Array.from(writeB.bytes)}` published while another publication is gated, then its array filled with spaces (`bytes.fill(0x20)`) before the gate is released → the disk holds B. (Overwriting it with A's bytes would leave a mix, A's record being 105 bytes and B's 109, measured with `node`.) The same with `bytes: Buffer.from(writeB.bytes).subarray(0)`, whose memory is shared with the buffer it came from: filling that buffer afterwards leaves B on the disk.
  - **A refused decision does not disturb the queue:** while a publication is gated, `publish({kind: "write"})` rejects `decision-invalid` at once, and `status()` stays `pending`; after release, the gated one resolves `current`.
  - **Every status is frozen**, with exactly the keys `state`, `reason`, `failure`, and no key named like a connection (`connected`, `online`, `reachable`, `joined`).
- [ ] **Step 2: Run red.** Same command. Expected: the cases that need the pending count or the call-order turn fail on their assertions (Task 1 built a turn; if every case already passes, record that in the commit body and go to the deletion controls).
- [ ] **Step 3: Implement** D9 and D10: a queued count raised in the same tick as the decision check, the reason of the latest call, and the last finished outcome.
- [ ] **Step 4: Run green**, then the coverage command. It must exit 0 (the bar applies from Task 5 on).
- [ ] **Step 5: Deletion controls.**
  - Run publications without the turn → the call-order case sees B's calls while A waits.
  - Set the status to the finished publication's outcome even when another is queued → the pending-until-the-last case fails (it sees A's `current`).
  - Keep the caller's array instead of a copy → the bytes-at-the-call case's disk does not hold B (it holds the 109 spaces, and the read-back answers `publication-unverified`).
  - Copy with `bytes.slice()` or `bytes.subarray()` instead of `Uint8Array.from(bytes)` → the `Buffer` case's disk does not hold B: on a `Buffer` both share memory (`subarray shares true slice shares true`, measured with `node`), while on a plain `Uint8Array` `slice` copies (`Uint8Array.slice shares false`), so the `Uint8Array` case alone would not catch it.
- [ ] **Step 6: Commit.** `git add scripts/box/wifi-boot-copy.mjs scripts/box/wifi-boot-copy.test.mjs && git commit -s -m "feat(box): publish Wi-Fi boot copies one at a time and report pending while one runs"`. The body lists D9 and D10 and says the status holds no connectivity.

### Task 7: whole-flow sweep of stopped publications and the next start

**Files:**
- Modify: `scripts/box/wifi-boot-copy.test.mjs` only (and `scripts/box/wifi-boot-copy.mjs` if a property fails: fix it under this task and record the cause in the commit body)

A test-only task: it checks properties across whole flows that no single case shows. A *stop* here is a file operation that throws, after which the publisher makes no further call (Task 5 proved that), so the files on disk are what a process stopped at that point would leave. A power cut can also lose bytes the system had not yet put on the disk; that is the rig's ("Out").

**Helpers.**
- `stopAt(k, mode)`: an io whose `k`-th call among `WRITE_OPS` and `FLUSH_OPS` (counting from 0) either throws without acting (`mode: "before"`) or, for a `writeFile`, calls the real `writeFile` on the same path with the first half of its bytes and the caller's own options, and then throws (`mode: "half"`). Using the caller's options keeps the in-place-write deletion control honest: with `wx` forced, a start already holding `wifi.json` would answer `EEXIST` and write nothing.
- `steps(start, decision)`: the number of `WRITE_OPS` and `FLUSH_OPS` calls in a clean run from that start (run it once in a fresh fixture).
- `allFileBytes(folder)`: the bytes of every regular file directly in the folder, by name.

- [ ] **Step 1: Write the sweep.** Starting states: no folder; an empty folder; A; A with a leftover `.next` holding half of B's bytes; a corrupt `wifi.json` (`"{}\n"`); B. Each start also holds `recovery.crt` when it has a folder. Decisions: `writeB`, `removeCable`, `removeOpen`. For every pair, every `k` below `steps(start, decision)`, and both modes where the `k`-th call is a `writeFile` (only `before` otherwise):
  - **Preboot never sees half a copy (Review Focus 2):** after the stop, `f.reader().read()` deep-equals either what it answered on the start state or what it answers after a clean run of the same decision on the same start (record both first).
  - **The next start repairs it (Review Focus 3):** a fresh publisher with real io and a later decision — the same decision, and, for a `writeB` run, also `removeCable`, and, for a `remove…` run, also `writeA` — answers `current` (for a write) or `absent` (for a remove), and then: `wifi.json` holds exactly the later decision's bytes, or does not exist; `wifi.json.next` does not exist; `allFileBytes(folder)` holds no form of a password other than the later decision's own (for a remove, no password at all); `recovery.crt` is byte-identical to the start's.
  - **Once is enough:** a second publication of the later decision makes no `WRITE_OPS` call.
  - **Nothing else under the boot root:** after the stop and after the repair, `snapshot(bootRoot)` lists no name outside `waitron-recovery`, `waitron-recovery/wifi.json`, `waitron-recovery/wifi.json.next` and `waitron-recovery/recovery.crt`.
  - **A planted link never redirects the write:** on a fixture holding A and no `wifi.json.next`, a `writeFile` override that first creates a symlink at the staging path pointing at `<parent>/outside.txt` (which does not exist) and then calls the real `writeFile` with the arguments it was given → `failed` / `io-failed`; `<parent>/outside.txt` does not exist and `wifi.json` still holds A (re-map finding 4: the `wx` flag refuses an existing name, a link to nothing included).
- [ ] **Step 2: Run it.** `pnpm exec vitest run scripts/box/wifi-boot-copy.test.mjs`. It should pass on Tasks 1–6's code. Read the `Tests` count: it must be above Task 6's.
- [ ] **Step 3: Deletion controls.**
  - Write `wifi.json` in place (`writeFile(record, bytes)`, no staging) → the "half" mode leaves a half record, and the preboot property fails.
  - In the remove path, unlink `.next` but not `wifi.json` → the repair property fails for `removeCable` after `writeB` (A's or B's password remains).
  - Use flag `w` in the publisher's `writeFile` → the planted-link case finds `outside.txt`.
- [ ] **Step 4: Run the coverage command** and read the counts.
- [ ] **Step 5: Commit:** `git add scripts/box/wifi-boot-copy.test.mjs && git commit -s -m "test(box): stop the Wi-Fi boot copy after every step and check the next start repairs it"`. The body says a stop is a process stop, not a power cut, which stays a rig check, and lists D11's reason (b).

### Task 8: backlog and dated pointers

> 2026-11-03: what landed in `docs/backlog.md`, `docs/backlog/box.md` and the two dated pointers differs from the drafts below, and was narrowed and added to after review; those files, not the drafts, are the record.

**Files:**
- Modify: `docs/backlog.md`, the B3 entry (line 5157 on main).
- Modify: `docs/backlog/box.md`: `## B3. The bootable USB installer` (line 744): its "Built so far (2026-11-03), PR 4" paragraph (lines 916–945); "PR 3 left for later" (line 913, "joining Wi-Fi and staging the first Wi-Fi boot copy"); "For later slices, from PR 2's re-map" (line 963) and its Wi-Fi bullet (lines 967–969); "For later slices, from PR 4's re-map" (line 1029).
- Modify: `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md` and `docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, one dated pointer line each at the top.

- [ ] **Step 1: `docs/backlog.md`.** After the PR 4 sentence, add: PR 5 (`#PR5`, filled in once the pull request exists, [plan](superpowers/plans/2026-11-03-b3-5-wifi-publication.md)) adds the Wi-Fi boot copy's publisher under `scripts/box/`, none called yet: it writes the copy through a flushed staging file, removes it on every "no copy" answer, refuses an unsafe boot folder with no write, and reports the copy's state.
- [ ] **Step 2: `docs/backlog/box.md`.**
  - After PR 4's "Built so far" paragraph (after line 945), add a dated PR 5 paragraph (`#PR5` filled in once the pull request exists; `**Built so far (2026-11-03), PR 5.** [PR 5](../superpowers/plans/2026-11-03-b3-5-wifi-publication.md) (#PR5) adds one host library under `scripts/box/`, none of it called yet.`) with two bullets in the same style:
    - `disk-key.mjs` exports its default file operations as `hostFileIo`, so both stores share one flush implementation; nothing else in it changed.
    - `wifi-boot-copy.mjs`: `createWifiBootCopyPublisher` takes `decideWifiBootCopy`'s answer (PR 4) and checks it: a copy the reader would refuse, or a reason not on `WIFI_NO_COPY_REASONS` (now exported by `wifi-record.mjs`), is refused as `decision-invalid`. It runs PR 2's reader first, so the boot mount, folder and record rules are the reader's, and also checks the staging name `wifi.json.next`; a symbolic link, folder, named pipe, second hard link, wrong owner or wrong permissions at either name or the folder refuses with no write (`failed`, with the reason). A copy is written to `wifi.json.next` with the `wx` flag and mode `0600`, flushed, renamed to `wifi.json`, the folder flushed, and read back; an unchanged copy is not rewritten. Every "no copy" answer, not only cable-only, removes `wifi.json` and any `wifi.json.next`, flushes the folder and checks both are gone; the folder and other files in it are never touched. A failed step stops there with no clean-up, and the next publication removes what it left. `status()` answers `pending`, `current`, `absent` or `failed`, with the "no copy" reason and the failure, and nothing about whether the box is connected; it is `pending` until the first publication finishes and while one runs. Publications run one at a time, in call order. The fixed `publishWifiBootCopy` answers `failed` / `mount-unverified` with no file call until the Linux pull request adds the boot-mount check.
  - In the "PR 3 left for later" sentence (line 913), change "joining Wi-Fi and staging the first Wi-Fi boot copy" to "joining Wi-Fi and calling PR 5's publisher for the first Wi-Fi boot copy".
  - In "For later slices, from PR 2's re-map", replace the Wi-Fi bullet (lines 967–969) with: "Task 3.1's host service shows the publisher's state (PR 5) with its reason, because open, WEP, OWE and enterprise networks and the password cases get no Wi-Fi unlock in version 1."
  - Add, after the PR 4 re-map list, a new heading "**For later slices, from PR 5's [re-map against main](../superpowers/plans/2026-11-03-b3-5-wifi-publication.md#re-map-against-main-on-2026-11-03):**" with these bullets:
    - Slice 3's host service publishes at every unlocked start, before it reports the copy state, and after every Wi-Fi change it applies or sees, with `decideWifiBootCopy` of NetworkManager's current settings; slice 2's installer publishes the first copy at handoff. Until then the state is `pending`.
    - The durable pending intent on `@host-state` is slice 3's, beside the live NetworkManager change it covers. Proposed (D11): it records only that a change began and ended, with no password, so it cannot replay an obsolete one and needs no key beyond the disk encryption that already holds `@host-state`. Its shape waits for the live NetworkManager change it covers, not for a way to test it: PR 1's store shows an `@host-state` record can be built and tested with an injected mount check.
    - The host reports a live-network change and the copy's state as two outcomes, and says Wi-Fi unlock is available only when the state is `current` (spec §7.5).
    - Rig checks: that the flushes keep a new copy and a removal through a power cut on the boot partition's real ext4; that no boot-loader-measured byte changes across publications; preboot with old, new, missing and corrupt copies after a cut at every step.
    - `unlink` of a folder answers `EPERM` on macOS and `EISDIR` on Linux (measured 2026-11-03), so no box code may read a folder from `unlink`'s error.
    - Decisions recorded for review: a `wifi.json.next` that is a symbolic link or not a regular file refuses with no write, where PR 1's store removes a leftover link, and an unsafe `wifi.json` or `wifi.json.next` refuses a removal too, so after a switch to cable-only an obsolete password can stay where preboot reads it until root clears the fault (D4); a file operation that throws while writing, flushing or removing is `io-failed`, before or after the rename, and any failure or mismatch during the read-back or the removal check, its own reads included, is `publication-unverified` (D8); every "no copy" answer removes the active copy, not only cable-only (D7); a failed step makes no clean-up (D8).
- [ ] **Step 3: Pointers.** At the top of the spec and of the six-slice plan, above the 2026-11-03 PR 4 line, add: `> 2026-11-03: PR 5's plan (publishing and removing the Wi-Fi boot copy, and its state) and its re-map against main: [2026-11-03-b3-5-wifi-publication.md](…).` (`../plans/…` from the spec, the bare file name from the plan.) Do not rewrite either historical body (CLAUDE.md §6, docs).
- [ ] **Step 4: Guides and CLAUDE.md.** No guide changes: nothing a person sees changed. No CLAUDE.md line unless an implementing task paid for a new trap; if one did, add one line plus a pointer.
- [ ] **Step 5: Commit** in this branch (it is not a docs-only branch): `git add docs/backlog.md docs/backlog/box.md docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md docs/superpowers/plans/2026-10-26-b3-usb-installer.md && git commit -s -m "docs(backlog): record B3's Wi-Fi boot-copy publisher and what it leaves for slice 3"`.

---

## Self-review

**Spec and parent-plan coverage for this pull request.**

| Sentence | Where |
| --- | --- |
| §7.5: "verify the expected boot mount and root-owned directory, reject symlinks/non-regular files" | D3, D4; Tasks 1, 2 |
| §7.5: "write root-only `wifi.json.next` in the same directory, flush its bytes, atomically rename it to `wifi.json`, then flush the directory" | D5; Task 3; Task 7's preboot property |
| §7.5: "The fixed Wi-Fi cleanup allowlist is `wifi.json.next` plus, for cable-only, `wifi.json`; never scan/delete arbitrary boot paths" | D7 (widened to every "no copy" answer, re-map finding 9); Task 4; Task 7's "nothing else under the boot root" |
| §7.5: "Remove obsolete staging copies, flush deletions" | D4, D7; Tasks 3, 4 |
| §7.5: "Do not report the whole change complete until the boot copy or its removal is durable" | D5, D7 (`current`/`absent` only after the folder flush and read-back); D9 |
| §7.5: "On an unlocked restart reconcile unfinished operations against authoritative settings; never replay an obsolete password over a newer configuration" | D11 (b); Task 7's repair property |
| §7.5: "Interrupted deletion can leave an old copy until reconciliation, so do not claim secure erasure" | D8; Task 5's remove-path failures |
| §7.5: "No … secret audit fields or password-bearing command arguments/logs" | Global Constraints; Task 5's sweep |
| Parent lines 195–196: "typed status with non-secret copy state (`current`, `absent`, `pending`, `failed`) separately from actual live connectivity. Copy presence never asserts a join." | D9; Task 6 |
| Parent line 202: "Unknown fields, arbitrary paths, symlinks/non-regular files and wrong boot … mount refuse with zero fallback writes. Inject failures at … temporary-file flush, rename, directory flush and cleanup." | D2, D3, D4; Tasks 1, 2, 5 |
| Parent line 203: "Retain pending evidence until cleanup completes and reconcile on unlocked restart without reviving obsolete credentials." | the reconciliation half: Task 7; the pending evidence: Out (D11) |

Parent line 202's "pending-intent write" and "live apply/check" failures, its `@host-state` mount, its audit and measured-image canaries, and its "if live configuration changed, report that separately" are under "Out", with where each goes.

**Names.** The parent plan names the record path `/boot/waitron-recovery/wifi.json`, the staging name `wifi.json.next` and the four states (lines 191–199); none changes. New names are this plan's: `wifi-boot-copy.mjs`, `createWifiBootCopyPublisher`, `publishWifiBootCopy`, `wifiBootCopyStatus`, `WIFI_NO_COPY_REASONS`, `hostFileIo` (PR 1's `defaultIo` under an exported name), `wifi_copy.deps_invalid`, `wifi_copy.decision_invalid`, and the failure names, of which five are the reader's own.

**Task size.** Each task touches one module and its test file, with one table of cases or one sweep; Task 1 is the largest (construction, the decision check and the mount refusal) and has no file writes.

**What the planner ran (2026-11-03):**
- `pnpm exec vitest run` of `wifi-record` and `disk-key` tests (267 and 103) and the one-file coverage command for `wifi-record.mjs` (100% of 179 statements, 159 branches, 27 functions, 146 lines);
- the probe script above with `node` on this Mac, and in `node:26-slim` as root and as uid 1000 (`memory_pressure`: 93% free before it);
- `gh run list --branch main --workflow ci.yml` and `gh run view 41626568917` (the `root-guards` job's result, its runner's operating system and its `disk-key` test line);
- `curl` of the POSIX `rename()` page and Linux's `fsync(2)` page, `shasum -a 256` of both, and a text search of each for the quoted sentences;
- for the review fold, `node` against `wifi-record.mjs`: `decideWifiBootCopy` gives A's record 105 bytes and B's 109, a `Buffer`'s `slice` shares its memory (`slice shares true`), and a `Buffer` is a `Uint8Array`; then `node -e` printed `subarray shares true slice shares true` for a `Buffer` and `Uint8Array.slice shares false` for a plain `Uint8Array`; and a reading of `exactRecord` and the reader's deps check for `io: undefined`;
- `git grep` over `scripts`, `deploy`, `apps` and `packages` for the copy's names, NetworkManager, root guards naming `scripts/box`, and decision numbers in `scripts/box`; `git worktree list` and `git branch -r` for other B3 work.

**What the planner only read:** the repository lines cited for the reader, PR 1's store and the spec; the two outside pages' meaning beyond the quoted sentences.

**Not measured:** durability through a power cut on any filesystem; the boot partition's real ext4 and its mount options; the probe on the exact Node 26 release CI installs (it ran on 26.13.0 here and 26.10.0 in the container). The default `syncFile` flushes a regular file through a read-only handle, as PR 1's does; this probe flushed only a write handle and folders, so the read-only file flush rests on PR 1's tests passing in CI (re-map finding 5 names the folder flushes; PR 1's real-io helper flushes files the same way, `scripts/box/disk-key.test.mjs:103`).

No test of the code above has run, because none of it exists yet.

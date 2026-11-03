# B3 slice 2, first pull request: the installer's decisions and its network fallback decisions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Build the parts of the USB installer's behaviour that an unprivileged macOS machine and CI's root Vitest project can fully test. The installer is the small system on the stick that downloads a Waitron release and writes it to the box's own disk (spec §3–§5). Two pieces:

- the **installer's decisions** (`installer-policy.mjs`): given what the installer has seen so far and the next thing that happens (the disk survey, a key press, the download's result, a tick of the clock), what it does next. This holds the spec's three guards (§5.1), the 15-second start of a box that already holds Waitron, the two-minute return from the reinstall screen, the typed venue name or «BORRAR» before an erase that needs a person, the 60-second wait before an unattended erase, the «Ya puedes quitar el USB» moment, the refusals for no security chip, Secure Boot off, no disk or two disks, and the rule that the clock is set before anything is downloaded;
- the **network fallback decisions** (`installer-network.mjs`): when to open the installer's own Wi-Fi network «Waitron-Instalar», when to join the venue's, and when to try again (§5.3).

Both are *pure functions*: they compute an answer from their inputs only, and touch no file, disk, network, firmware, clock or keyboard. The code that does those things (the Linux "adapters") is not written here. Nothing here runs on a box, and nothing here is a qualified install path.

**The release list is left out of this pull request.** The parent plan puts `release-list.mjs` (`verifyReleaseList`, the signed list of what a release contains) in the same task. Its byte format, its version identity and its signature format all depend on work that is not on main (re-map finding 9, decision D1). The installer's decisions take only the release check's *outcome* (verified, unavailable, bad signature, too old an installer, and so on), so they do not depend on the list's format.

**The numbers are the spec's, not separately the owner's.** 15 seconds, two minutes, 60 seconds and one minute are each the spec author's call ("**my call**" or unmarked) inside a design the owner approved whole on 2026-10-26 ("The rest approved", spec lines 14–15). The spec also says its implementation details "remain PROPOSED requirements" (spec lines 19–20). None is a number the owner chose by itself. Each lives in one exported constant, so a change is one line. Every task, commit and doc line that names them says where they come from.

**Architecture:** Two small host libraries under `scripts/box/`, each a plain `.mjs` file with JSDoc types and a sibling `.test.mjs` in the root Vitest project, in the style PR 1 and PR 2 set (`scripts/box/disk-state.mjs`, `preboot.mjs`). `installer-policy.mjs` calls PR 1's `classifyDisk` (`scripts/box/disk-state.mjs:205`) on the disk survey and never re-implements disk recognition.

**Tech Stack:** Node 26 (`.nvmrc`), Vitest 4.1.12 root project. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §5 whole (the order, §5.1 the three guards, §5.2, §5.3, §5.4, §5.5, §5.6), §7.6 (the name tag), §7.7 (the hardware refusals), §13–§14 (the release list, for what this pull request leaves out).

**Parent plan:** [six-slice plan](2026-10-26-b3-usb-installer.md), Slice 2: Task 2.1's decision logic (its red steps 1–3, without `release-list.mjs`) and Task 2.2's pure network decisions (its red step 1, the decision half).

**Build authority:** the owner's "Yes, build it", 2026-11-01, relayed by the lead session for PR 1, with the build cut one pull request at a time ([PR 1's plan](2026-11-01-b3-1-encrypted-disk.md), "Build authority").

## Global Constraints

- **Machine limits on 2026-11-03:** macOS, unprivileged. No Linux, no virtual machine, no TPM (the security chip), no real disk, network, USB or firmware. Anything that needs those is not built here and is never described as working.
- **Nothing is erased before the release is downloaded and checked** (spec §5 step 5, §5.3 line 296). In this pull request that means: the only action that writes to a disk, `write-owned-target`, is never answered before a `release-checked` event whose outcome is `verified`.
- **One frozen target.** The disk an erase may touch is fixed once, from the first disk survey, and only that disk id is ever named by an action. The installer stick, an external disk or a second internal disk is never named.
- **Nothing is written to the stick** (spec §4 item 1, §5 step 2). No action names the stick; there is no action that writes anything but the frozen target.
- **No typed text, password or key is kept.** The typed venue name or «BORRAR» is compared and dropped; it never appears in a state, a decision or a status. The Wi-Fi password never enters either module: the join event carries only the network's name. The recovery key is not handled here at all.
- **Deadlines use a clock that never jumps.** Every event carries `atMs` from a clock that does not move when the wall clock is set (in production `performance.now()` or the kernel's boot-time clock), because the installer sets the wall clock itself in the middle of a run (spec §5.4, lines 329–333). The network time the installer sets is a separate value.
- **Coverage:** the root project holds `98/98/98/95` (`vitest.config.ts:120`). No `exclude`, no ignore comment, and no moving code into a testing folder.
- **Code style:** English only in code. The installer's Spanish and English words live in its translation file (the Linux pull request), never here: these modules return message *keys*. Comments only for an invariant or a reason the code cannot show. Error codes name the domain (`installer.*`, `installer_network.*`), never the file.
- **Commits:** `git commit -s`, staging only named paths, never `git add -A`.

## Review Focus

1. **A disk that looks partly like Waitron, or two internal disks, or a disk whose attachment is unclear.** Expected: no unattended erase. Partly-Waitron and damaged disks need «BORRAR» typed; two disks or none stop with a reason; a lone Windows disk whose attachment is `unknown` needs «BORRAR» too (decision D3). Tasks 1 and 2.
2. **A stick left in a working box, a barcode scanner that types, a forged name tag.** Expected: the installed box starts after 15 seconds with zero disk actions; any key opens the reinstall screen, which returns to starting the installed box after two minutes with no typing; only the exact venue name (or «BORRAR» when the name tag cannot be read) confirms an erase; whatever the name tag says, an erase still needs the typing. Task 2.
3. **Anything goes wrong before the erase.** Bad signature, bad checksum, truncated download, too old an installer, no network, a failed clock, a stick pulled out too early, a second disk survey, an adapter answering out of turn. Expected: no `write-owned-target`, ever; no older release is tried in place of a bad newest one. Tasks 3 and 5.
4. **The stick and the final restart.** Expected: «Ya puedes quitar el USB» only once the installer is wholly in memory and on a box it is going to install; after the write, the restart waits while the stick is in (guard 2), including a stick put back in. Tasks 3 and 4.
5. **The installer's own Wi-Fi network.** Expected: a cable with internet at the start never opens it; one minute without internet opens it; a failed join reopens it; a retry every minute; the Wi-Fi password never enters the decisions. Task 6.

---

## What this pull request builds, and what it leaves out

**In (testable on this machine):**

| Task | File | Parent-plan source |
| --- | --- | --- |
| 1 | `scripts/box/installer-policy.mjs` and test: the state, the events, and the path chosen from the disk survey | Task 2.1, red step 1 ("no TPM or Secure Boot, unknown disk or two disks") |
| 2 | same files: guard 3 (15 seconds, the reinstall screen, two minutes, the typed confirmations) and the unknown disk | Task 2.1, red step 2 ("Existing Waitron with no key waits exactly 15 seconds …"; "unknown needs `BORRAR`, known venue needs typed exact name …"; "Name-tag forgery cannot authorise an erase") |
| 3 | same files: in-memory readiness, «Ya puedes quitar el USB», early stick removal, network, clock and the download's outcomes | Task 2.1, red steps 1–2 ("RAM not ready means no safe-remove message"; "Clock floor/network time precede HTTPS fetch"; "Invalid newest release never falls back silently"; "minimum-version refusal") |
| 4 | same files: the 60-second erase wait, the write, guard 2's restart, and the public status | Task 2.1, red step 2 ("Verified download at t=1000 yields erase only at t=61000"; "Key interrupts countdown"); Task 2.2, red step 1 ("Public status contains only stage/progress/stop reason") |
| 5 | `scripts/box/installer-policy.test.mjs`: whole-run sweep (closed action set, frozen target only, no typed text kept) | Task 2.1, red step 3 ("assert exact action sequences and refused writes") |
| 6 | `scripts/box/installer-network.mjs` and test: the hotspot, the join and the retries | Task 2.2, red step 1 (the decision half) |
| 7 | Backlog, plus dated pointers in the spec and the six-slice plan | — |

**Out, and where each goes next:**

**The release list (`release-list.mjs`): deferred until its three bindings exist** (decision D1, re-map finding 9). Its byte format, version identity and signature format are each owned by work that has not landed. It goes in a later B3 pull request, shared with slice 5's `release-assets.mjs` (parent Task 5.1) and with A950's `verifyManifest` boundary, once A940's release slices 2 and 4 have landed and the owner has chosen the signing keys' custody (spec §14, "Who holds them is the owner's, at slice 7"; parent Task 5.1, "owner selects custody/signing authority before publication").

**The name tag's format and its decoder: slice 1's format, slice 3's writer** (spec §19 items 1 and 3). PR 1 carries the tag as raw bytes, "display only" (`scripts/box/disk-state.mjs:17`), and no decoder exists on main (re-map finding 4). The installer's decisions take an already-decoded `venueTag` (`{name, live}` or `null`). The Linux driver must decode the *frozen internal disk's* own tag and no other; that duty is recorded for the pull request that defines the format.

**Typing the recovery key on the reinstall screen to see the disk's last sale and unsent records** (spec §5.1 guard 3, lines 262–264): needs the disk opened, the letters-to-bytes decoder PR 2 also deferred, and the Linux adapters. Deferred to the Linux installer pull request.

**The installer's screens, words and printed matter: deferred to the Linux installer pull request** (parent Task 2.2's UI half). The local screen and status page in Spanish and English, light and dark, at 390 px and 1280 px; the translation file that turns this pull request's message keys into words; `WAITRON/LEEME.html`, `README.html` and the printed card; download and write progress figures.

**Real adapters: deferred to the Linux installer pull request (`deploy/installer/`).**

- The disk survey: turning `lsblk`, `blkid`, `sfdisk` and `cryptsetup luksDump` output into PR 1's `MachineObservation`, plus the TPM and Secure Boot state (PR 1 already defers this).
- Knowing that the installer has wholly copied itself into memory (`ram-ready`), and whether the stick is in (`usb-removed`, `usb-inserted`).
- Keyboard input (`key`, `submit`, `choice`).
- Setting the clock from network time, refusing a time below the installer image's clock floor (`/usr/lib/clock-epoch`, spec §5.4 line 333), and writing the battery clock in UTC. This pull request only orders the step and checks the reported time against a floor it is given.
- Fetching and checking the release list and the disk, held in memory (spec §5.4, lines 347–349), and reporting one `release-checked` outcome.
- The write: erasing, laying out the partitions and the encrypted container, writing and checking, setting the firmware's boot order and the fallback loader (guard 1). **Before its first write, the write adapter re-checks that the frozen disk id still carries the partition table it was surveyed with, and that the disk is at least as large as the release needs**: PR 1's `DiskObservation` has no size field (`scripts/box/disk-state.mjs:11-17`), so a disk below the spec's 128 GB (§16) cannot be refused here.
- `boot-installed`: setting the firmware's one-time boot choice (`BootNext`) to the box's disk and restarting; `power-off`.
- The status page at `http://waitron-instalar.local` (Avahi), and the hotspot itself: «Waitron-Instalar», open, at the fixed `http://10.42.0.1`, forwarding nothing (spec §5.3). That forwarding is denied is a rig assertion, not a configuration-text assertion (parent Task 2.2).
- Joining Wi-Fi with NetworkManager, phone hotspots and USB tethering; staging the first Wi-Fi boot copy at the handoff in PR 2's version-1 format (`scripts/box/wifi-record.mjs`), with a cable-only install leaving none (parent Task 2.2).

**Rig cases: deferred to the Linux installer pull request.** `install`, `existing-stick`, `damaged-marker`, `two-disks`, `cut-header`, `remove-usb`, `disk-write-cut` (parent Task 2.1) and `network-fallback` (parent Task 2.2). `RIG_CASES` (`scripts/box/rig-contract.mjs:31-43`) is not extended here: the names belong with the runner that can run them. Measuring the stick's size, the install time and memory at 8 GB goes with them.

**Firmware that ignores `BootNext`, so the stick starts again every time** (spec §5.1 guard 3, lines 252–253): slice 6, on the chosen model.

**The old source-history-floor behaviour on reinstall:** stays gated on the A1042 binding (parent Task 2.1, rig step).

**A Waitron disk whose two partition tables were both wiped reads as blank** (PR 1's open point, `docs/backlog/box.md`, "For later slices, from PR 1's re-map"): the Linux observation adapter decides how to look for an encryption header there. Unchanged here.

## Re-map against main on 2026-11-03

The six-slice plan was written on 2026-10-26, before PR 1 and PR 2. This re-map checks Task 2.1 and Task 2.2 against main at `6ff1ebb951`.

1. **Two files, and `release-list.mjs` is not one of them.** The decisions go in `installer-policy.mjs`, as the parent plans. The network decisions go in their own `installer-network.mjs`, not in the parent's `scripts/box/network.mjs`: slice 3's host service owns `network.mjs` and its Wi-Fi boot-copy writer (parent Task 3.1), and the installer's hotspot rules are a different job. `release-list.mjs` is deferred (finding 9).
2. **The root Vitest project finds and measures new `scripts/box/` files with no change.** Its test glob is `scripts/**/*.test.mjs` (`vitest.config.ts:71`), its coverage glob is `scripts/**/*.mjs` (`vitest.config.ts:119`) and its thresholds are `98/98/98/95` (`vitest.config.ts:120`). Checked on 2026-11-03 with a throwaway pair, `scripts/box/zz-planner-probe.mjs` and its test, removed afterwards: with one test covering one of two branches, `pnpm exec vitest run scripts/box/zz-planner-probe.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/zz-planner-probe.mjs` ran 1 test, measured that file alone at 50% lines and exited 1 with "does not meet global threshold"; with a second test, 2 passed, 100% of 3 statements and 2 branches, exit 0. So a new file is found, and the one-file command holds it to the bar on its own. In the root project's full run the thresholds apply to all measured files together (`thresholds` sits beside the shared `include`, `vitest.config.ts:119-120`), so the one-file command is the per-file check.
3. **`classifyDisk`'s real shape** (`scripts/box/disk-state.mjs:22-28`, `:205-224`). The parent plan's `DiskDecision.kind` included `refuse-hardware`. PR 1 instead returns `kind` (`waitron`, `recognised-other`, `unknown`, `multiple` or `none`), a separate `hardware` field (`no-tpm`, `secure-boot-off` or `null`, "no-tpm wins when both fail"), `layoutVersion` and `recognised` (`blank`, `windows` or `bitlocker`). It throws `disk.observation_invalid` for a malformed survey (`:51-56`), and PR 1's plan says "Slice 2 treats a throw as 'write nothing'" (`docs/superpowers/plans/2026-11-01-b3-1-encrypted-disk.md:244`). So: the policy calls `classifyDisk`, a throw becomes the refusal `observation-invalid`, and the order of the hardware check against the disk's kind is this pull request's (decisions D2 and D19).
4. **No name-tag decoder on main.** `grep -n nameTag scripts/box/*.mjs` finds only `disk-state.mjs:17`, `:94` and `:104`: the tag is checked to be a `Uint8Array` and read by no rule. The `observed` event therefore carries a decoded `venueTag` beside the survey (see "Out").
5. **The owner's open point on a Waitron box with its TPM or Secure Boot off** (`docs/backlog/box.md:875-881`, "Slice 2 decides"). Lane B's 2026-11-01 note recommended "start it and raise an alert, because guard 3 says the stick must not leave a venue dark" (lane B's questions file, line 932, outside the repository); no owner answer is recorded there or in the backlog. Decision D2 follows that recommendation and keeps it as one rule with its own named test, so the opposite answer is a one-line change.
6. **A lone disk whose attachment is `unknown` counts as internal** (`scripts/box/disk-state.mjs:213-216`), so `classifyDisk` can call it `recognised-other`. PR 1 left that "for the owner or slice 2 to confirm" (PR 1's plan, line 120). Decision D3: such a disk needs «BORRAR» typed, never an unattended erase.
7. **A Waitron disk that also holds a foreign encrypted partition is `waitron`** (PR 2's plan, re-map finding 16, line 146; the reason is `scripts/box/disk-state.mjs:150-167`). PR 2 left it to "slice 2's installer policy". Decision D18: no change, because a `waitron` disk is never erased unattended here; erasing it needs the venue's name typed on the reinstall screen.
8. **The parent's state, events and actions, as built.** The ledger (parent plan line 73) and Task 2.1's action list (line 142) are kept, with these changes:
   - The state holds the release check's outcome, not a "verified manifest", because the list is out (finding 9).
   - "Keyboard input" becomes three events: `key` (any press, no content), `submit` (a typed line, ended with Enter) and `choice` (`install-now` or `power-off`, spec §5.2's two buttons).
   - "Network result" becomes `online`, which the driver sends when `installer-network.mjs` answers `continue`.
   - "Verified-download" becomes `release-checked` with one of seven outcomes; `clock-set`, `write-finished` and `usb-inserted` are added.
   - Actions gain `find-network`, `set-clock` and `power-off`. `confirm-erase` means "show a screen that waits for the keyboard", as the parent's name suggests.
   - The decision's message is a key with parameters, never words (the spec keeps the installer's words in its translation file, §5).
   - A state is frozen and only one this module made is accepted, as PR 2 marks genuine targets in a `WeakSet` (PR 2's plan, review M1–M11).
9. **The release list's three bindings are not on main.** Run on 2026-11-03:
   - **Version identity (A940).** A940's approved design defines a release as a `v<major>.<minor>.<patch>` tag on `main` (A940 design §5.1, lines 589–603), made by `pnpm release prepare` and `pnpm release tag` (A940 §5.4) in slice 2, with CI on the tag in slice 4 (A940 §10, lines 1376–1378). On main: `git tag -l 'v*'` and `git ls-remote --tags origin 'v*'` both list nothing; `packages/fiscal-verifactu/declarations/` does not exist; `grep -n '"release' package.json` finds no script; `docs/operations/release.md` does not exist; and `softwareVersion()` returns only `"0.0.0-dev"` or `"0.0.0-dev+<commit>"` (`packages/fiscal-verifactu/src/software-identity.ts:47-49`). The backlog says slices 1b to 6 are still open (`docs/backlog/fiscal.md:1290-1291`). Only slice 1 has landed (#2000).
   - **Signature format and keys.** The spec fixes two public keys, "the one that signs today and a spare kept offline", and leaves who holds them to the owner (§14, lines 1457–1459); its only source on the tool is "cosign verifies against a key, offline" (P17, line 1704). The parent plan says the owner "selects custody/signing authority before publication" (Task 5.1, line 276). Nothing on main chooses an algorithm, a key encoding or a signed byte layout.
   - **A950's fields.** A950's discovery calls `deps.verifyManifest(bytes)` (`scripts/box/upgrades/discovery.mjs:126`, typed at `:177` as "Trusted strict signature/key verifier") and then `parseVerifiedRelease`, which expects `releaseDigest`, `sourceDigest`, `platform`, `minimumHostProtocol`, `imageDigests` and `requiresNewInstallation`, and says of itself: "Internal adapter envelope, not B3's signed wire format" (`scripts/box/upgrades/contracts.mjs:92-123`). A950's plan waits on "B3 `release-list.mjs` after P-B3" (`docs/superpowers/plans/2026-10-29-a950-automatic-upgrades.md:60`, `:73`). So the list's format must also carry A950's fields; fixing it here would fix A950's wire by precedent.
   - **The installer's own version.** The spec says only that "a release's list names the oldest installer it accepts" (§13, lines 1429–1431). No source defines how an installer is numbered.

   A partial verifier would have to invent at least two of these. Decision D1: leave `release-list.mjs` out entirely.
10. **The Wi-Fi network's name travels as hex.** PR 2's record format carries the network name as `ssidHex`, "1-32 bytes", because "a network name is up to 32 arbitrary bytes and need not be UTF-8" (`scripts/box/wifi-record.mjs:9`, `:22-23`). Task 6's `join-requested` event uses the same `ssidHex` rule.
11. **Spec line numbers used here, checked by reading on 2026-11-03:** the order of steps, lines 210–222; guard 1, 226–232; guard 2, 233–239; guard 3, 240–269; §5.2, 273–292; §5.3, 296–323; §5.4, 327–349; §5.5, 353–355; §5.6, 359–369; §7.6, 849–857; §7.7, 861–877.

### Decisions where the parent plan or spec left a choice

Each is the conservative option the planner could find; each is recorded in the backlog (Task 7).

- **D1. The release list is left out** (finding 9).
- **D2. A box that holds Waitron but has its TPM or Secure Boot off goes guard 3's way:** 15 seconds, then the installed box starts, and the message says which firmware setting is off. A confirmed reinstall on such a box is then refused with that setting's reason, because §7.7 refuses "before it erases anything" (lines 861–863). Reasoning, not tested: the installed disk's seal depends on the security chip and on Secure Boot's measurement (spec §7.1–§7.2), so the installed box should ask for its recovery key rather than open by itself; starting it does not open the disk without a person. Still the owner's point (finding 5).
- **D3. A `recognised-other` disk whose attachment is `unknown` needs «BORRAR» typed** (finding 6), with a message saying the installer is not sure the disk is inside the box.
- **D4. The 60-second wait applies only to an unattended erase.** An erase a person confirmed by typing (an unknown disk, a reinstall) goes ahead as soon as the download is verified. The spec ties the 60 seconds to the unattended case (§5.2, lines 276–279).
- **D5. Two minutes without typing on the reinstall screen starts the installed box at once** («goes back to starting the installed box, as if no key had been pressed», line 264–265), rather than showing the 15 seconds again.
- **D6. After a key stops the 60-second wait, the installer waits for «Instalar ahora» or «Apagar» with no time limit.** Nothing is erased while it waits; the power button still turns it off (§5.3 item 4).
- **D7. Typed confirmations are compared exactly.** The venue name is compared after Unicode NFC normalisation of both sides (checked with `node` on 2026-11-03: `"Bar Àngels" === "Bar Àngels"` is `false`, and after `.normalize("NFC")` it is `true`), with letter case and spaces significant. «BORRAR» is the exact upper-case word on both the Spanish and the English screen (the spec names no English word). When the name tag can be read, «BORRAR» does not confirm a reinstall: the spec allows it only "if the name tag cannot be read" (line 261–262).
- **D8. A name tag whose name cannot be used counts as unreadable**, so «BORRAR» is asked: an empty name after NFC, more than 256 characters, a character below U+0020 or U+007F–U+009F, or a string that is not well-formed. A tag's *shape* being wrong (not `null` or `{name: string, live: boolean}`) is the driver's bug and throws.
- **D9. Deadlines are measured on `atMs`, a clock that never jumps** (Global Constraints). The network time from `clock-set` changes no deadline.
- **D10. A failed clock step waits one minute, then checks the network again before retrying.** A network time below the floor the policy was created with counts as a failure.
- **D11. Download outcomes.** `unavailable` and `truncated` wait one minute and check the network again (§5.3 item 4, "trying again every minute"). `signature`, `checksum` and `too-large` stop with that reason: no retry and no older release (parent: "Invalid newest release never falls back silently"). `installer-too-old` stops with the release's version for the message (§5.4, lines 337–339).
- **D12. A stick taken out before the installer is wholly in memory stops the installer**, whatever it was doing, guard 3's countdown included (guard 2: "A stick taken out before that just stops a start that had not touched the disk", lines 238–239).
- **D13. A second disk survey, or an adapter result the policy did not ask for, stops the installer** with `sequence-invalid`. A person's key, line or choice where it means nothing is ignored.
- **D14. After a final action (`refuse`, `boot-installed`, `power-off`), every later event answers `wait`** with the same message, so a firmware or power action is never asked for twice.
- **D15. The public status says only the stage, whether the stick may be taken out, and a stop reason.** No disk id, venue name, release version or typed text: the status page is open to anyone on the network (§5.6).
- **D16. A Wi-Fi join counts as failed when no internet follows within one minute**, the spec's one minute (§5.3 item 2) reused, and the hotspot reopens. The join event shape refuses a `password` key, so the password cannot enter the decisions.
- **D17. The network decisions live in `installer-network.mjs`** (finding 1).
- **D18. A Waitron disk with a foreign encrypted partition stays `waitron`** (finding 7).
- **D19. Refusal order:** a malformed survey; then no or two internal disks; then a Waitron disk (guard 3, even with hardware off, D2); then no TPM; then Secure Boot off; then the unknown and recognised paths. A refusal for the disk count still carries `classifyDisk`'s `hardware` value, so both problems can be shown at once.

## Execution notes for every task

**Worktree.** Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-3-installer-policy`, and run commands from that folder.

**Style precedent.**
- `scripts/box/disk-key.mjs` and `scripts/box/preboot.mjs` set the style for refusal errors (`Object.assign(new Error(code), { code, reason })`) and for strict exact-key records (`exactRecord` and `safeInteger` from `scripts/box/upgrades/contracts.mjs`).
- `scripts/box/preboot.mjs` sets the style for marking genuine objects in a module-level `WeakSet`.
- Expected states (a refusal, a wait) are returned as frozen decisions, not thrown. Only a caller's programming error (bad options, a malformed event, a state this module did not make) throws.

**Test conventions.**
- Tests import `describe`, `expect`, `it` from `vitest`. No timers: time is the `atMs` each event carries.
- Copy the disk builders from `scripts/box/disk-state.test.mjs` lines 1–64 into the new test file (`valid`, `damaged`, `plain`, `luks`, `partition`, `efi`, `boot`, `waitronPartition`, `disk`, `blankDisk`, `completeWaitronDisk`, `waitronWith`, `windowsDisk`, `machine`, and the id constants). Do not import from `disk-state.test.mjs`, which would run its tests twice. Add `STICK_ID`'s disk as an `installer`-attachment disk to every survey, so a stray action naming it would be visible.
- A `play(events, options)` helper folds `nextInstallerStep` over a list of events from `createInstallerState(options)` and returns every decision. Assertions read `decisions.map(d => [d.action, d.diskId])` for sequences, and whole decisions with `toEqual` where the message matters.
- **Red means a named assertion failing.** Before implementing, add the new exports as stubs that throw `new Error("not implemented")`, so the red run reports each case failing on its assertion, not one import error for the whole file.

**Coverage for one file.** Read the summary counts; `0/0` means the include matched nothing. The run must exit 0 at 98/98/98/95; aim for 100%.
`pnpm exec vitest run scripts/box/<name>.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/<name>.mjs`

**Before each commit.** Run `pnpm exec prettier --check <files>` and `pnpm exec eslint <files>`, and read the `Tests` count (CLAUDE.md §4). The pre-push hook and CI do the rest; do not run the whole workspace.

**Long runs.** An implementer past about 150 tool calls with the task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover: what is done, what is left, which files, and each check's state.

**Order.** Tasks 1→2→3→4→5 one after another (one file pair), then Task 6 (its own file pair), then Task 7. All in this one worktree (CLAUDE.md §6).

---

### Task 1: the state, the events, and the path chosen from the disk survey

**Files:**
- Create: `scripts/box/installer-policy.mjs`
- Test: `scripts/box/installer-policy.test.mjs`

**Interfaces:**
- Consumes: `classifyDisk` from `scripts/box/disk-state.mjs`; `exactRecord`, `safeInteger` from `scripts/box/upgrades/contracts.mjs`.
- Produces (Tasks 2–5 fill in the phases this task only enters):

```js
/** Spec §5.1 guard 3 (line 247), §5.1 (lines 264-266), §5.2 (lines 276-279), §5.3 item 4 (line 322). The spec's calls, not separately the owner's. */
export const INSTALLER_TIMINGS_MS; // frozen { waitronStart: 15_000, reinstallIdle: 120_000, eraseWait: 60_000, retry: 60_000 }
/** Spec §5.1 guard 3 and §5.2. */
export const ERASE_WORD; // "BORRAR"
/**
 * @typedef {{ name: string, live: boolean }} VenueTag  decoded from the frozen internal disk's name tag; display only (spec §7.6)
 * @typedef {'observing'|'refused'|'waitron-found'|'reinstall-screen'|'awaiting-erase-word'|'loading'|'network'
 *   |'clock'|'clock-retry'|'downloading'|'download-retry'|'erase-countdown'|'erase-stopped'|'writing'
 *   |'remove-usb'|'booting'|'powering-off'} InstallerPhase
 * @typedef {object} InstallerState  frozen; only states this module made are accepted
 * @property {InstallerPhase} phase
 * @property {number} atMs  the last event's time
 * @property {number} clockFloorMs
 * @property {boolean} ramReady
 * @property {boolean} usbPresent
 * @property {null|{diskId:string, kind:'waitron'|'recognised-other'|'unknown', recognised:'blank'|'windows'|'bitlocker'|null,
 *   layoutVersion:number|null, hardware:'no-tpm'|'secure-boot-off'|null, attachmentUnclear:boolean, venueTag:VenueTag|null}} target
 * @property {null|'unattended'|'typed'} confirmed
 * @property {boolean} clockSet
 * @property {number|null} deadlineMs
 * @property {null|{reason:string, hardware:'no-tpm'|'secure-boot-off'|null, releaseVersion:string|null}} refusal
 * @property {{key:string, params:object}} message  the last message, repeated by final phases (D14)
 * @typedef {'wait'|'find-network'|'set-clock'|'download'|'confirm-erase'|'write-owned-target'|'boot-installed'|'power-off'|'refuse'} InstallerAction
 * @typedef {object} InstallerDecision  frozen
 * @property {InstallerAction} action
 * @property {string|null} diskId  the frozen target's id for write-owned-target and boot-installed; null otherwise
 * @property {{key:string, params:object}} message  frozen
 * @property {number|null} deadlineMs  on atMs's clock
 * @property {InstallerState} state
 */
/** Throws installer.options_invalid / options-invalid unless options is exactly {atMs, clockFloorMs}, both safe non-negative integers. */
export function createInstallerState(options);
/** Pure. Throws installer.state_invalid / state-invalid for a state this module did not make; installer.event_invalid / event-invalid for a malformed event, or / time-backwards when event.atMs < state.atMs. */
export function nextInstallerStep(state, event);
```

**Events** (each an exact record; `atMs` a safe non-negative integer, never below `state.atMs`):

| `kind` | Other keys |
| --- | --- |
| `observed` | `observation` (PR 1's `MachineObservation`, checked by `classifyDisk`), `venueTag` (`null` or exactly `{name: string, live: boolean}`) |
| `ram-ready`, `usb-removed`, `usb-inserted`, `key`, `online`, `tick` | none |
| `submit` | `text`: a string of at most 512 UTF-16 units |
| `choice` | `choice`: `install-now` or `power-off` |
| `clock-set` | `ok`: boolean; `utcMs`: a safe non-negative integer when `ok`, `null` otherwise |
| `release-checked` | `outcome`: `verified`, `unavailable`, `truncated`, `signature`, `checksum`, `too-large` or `installer-too-old`; `releaseVersion`: for `installer-too-old` a string of 1–32 printable ASCII characters (opaque display text; its format is the deferred release list's), otherwise `null` |
| `write-finished` | `ok`: boolean |

**Message keys** (the whole set; Tasks 2–4 use the rest):

| Key | Params |
| --- | --- |
| `installer.starting` | `{}` |
| `installer.refused` | `{reason, hardware, releaseVersion}`; reasons: `observation-invalid`, `disk-none`, `disk-multiple`, `no-tpm`, `secure-boot-off`, `usb-removed-early`, `sequence-invalid`, `release-signature`, `release-checksum`, `release-too-large`, `installer-too-old`, `write-failed` |
| `installer.waitron_found` | `{seconds: 15, venueName, live, hardware}` (`venueName`/`live` null when the tag is unreadable) |
| `installer.reinstall` | `{prompt: 'venue-name'|'erase-word', venueName, live, mismatch}` |
| `installer.unknown_disk` | `{word: 'BORRAR', attachmentUnclear, mismatch}` |
| `installer.loading` | `{}` |
| `installer.safe_to_remove` | `{}` |
| `installer.finding_network`, `installer.setting_clock`, `installer.downloading`, `installer.erase_stopped`, `installer.writing`, `installer.remove_usb`, `installer.starting_installed`, `installer.powering_off` | `{}` |
| `installer.clock_retry`, `installer.download_retry` | `{seconds: 60}` |
| `installer.erase_countdown` | `{seconds: 60, recognised}` |

**What `observed` does in phase `observing`** (any other phase: D13, `refuse` with `sequence-invalid`):

0. Check the event's shape first (throws as above). Normalise a usable `venueTag.name` with NFC; an unusable one makes `venueTag` `null` (D8).
1. `classifyDisk(observation)` throws → `refuse`, reason `observation-invalid`, `hardware: null`.
2. `kind` `none` → `refuse` `disk-none`; `multiple` → `refuse` `disk-multiple`; both carry `classifyDisk`'s `hardware` (D19).
3. `kind` `waitron` → phase `waitron-found`, `deadlineMs = atMs + 15_000`, action `wait`, message `installer.waitron_found` (Task 2 fills in the rest). `hardware` is carried, not refused (D2).
4. `hardware` `no-tpm` or `secure-boot-off` → `refuse` with that reason.
5. `kind` `unknown` → phase `awaiting-erase-word`, action `confirm-erase`, message `installer.unknown_disk` with `attachmentUnclear: false`, `mismatch: false`.
6. `kind` `recognised-other` on a disk whose `attachment` is `unknown` → the same as rule 5, with `attachmentUnclear: true` (D3).
7. `kind` `recognised-other` on an `internal` disk → `confirmed: 'unattended'`, phase `loading`, action `wait`, message `installer.loading` (Task 3 adds what follows).

The target is built from strings and numbers copied out of the classification and the survey, never a reference into the caller's objects. `venueTag` is kept only on a `waitron` target; on any other target it is `null`.

A `refuse` makes the phase `refused`.

**General rules, checked in this order before any phase's own rules:**

- **D14:** in `refused`, `booting` and `powering-off`, every event (still checked for shape and time) answers `wait`, `diskId: null`, `deadlineMs: null`, the same message, and a state that differs only in `atMs`.
- **D13, adapter results:** `observed` outside `observing`, `online` outside `network`, `clock-set` outside `clock`, `release-checked` outside `downloading`, and `write-finished` outside `writing` → `refuse` `sequence-invalid`.
- **D13, a person's input:** `key`, `submit` or `choice` in a phase whose rules (here and in Tasks 2–4) do not name it → `wait`, state unchanged but for `atMs`.
- `tick` in a phase with no deadline, or before its deadline → `wait`. `ram-ready`, `usb-removed` and `usb-inserted` follow Task 3's rules 1 and 3; until Task 3 they set their flag and answer `wait`.

- [ ] **Step 1: Write the failing tests.** Every case asserts the whole decision with `toEqual` unless it says otherwise.
  - `createInstallerState({atMs: 0, clockFloorMs: 1_700_000_000_000})` → frozen state, phase `observing`, `ramReady: false`, `usbPresent: true`, message `installer.starting`; bad options (missing key, extra key, `-1`, `1.5`, a string) throw `installer.options_invalid` with reason `options-invalid`.
  - **Paths (Review Focus 1):**
    - `one internal blank disk → wait, loading, confirmed unattended, target recognised blank`; the same for `windowsDisk()` (`windows`) and a BitLocker variant (`bitlocker`).
    - `one internal complete Waitron disk → wait, waitron-found, deadlineMs atMs + 15000`.
    - `a damaged Waitron disk (both headers damaged) → confirm-erase, awaiting-erase-word, installer.unknown_disk`.
    - `a foreign LUKS2 disk → confirm-erase`.
    - `a lone blank disk whose attachment is "unknown" → confirm-erase with attachmentUnclear true` (D3).
    - `two internal disks → refuse disk-multiple`; `an internal and an "unknown"-attachment disk → refuse disk-multiple`; `no internal disk (only the stick) → refuse disk-none`.
    - `tpm "disabled" with a Windows disk → refuse no-tpm`; `secureBoot "setup-mode" → refuse secure-boot-off`; `both off → refuse no-tpm` (PR 1's "no-tpm wins").
    - `two internal disks and tpm "absent" → refuse disk-multiple with hardware "no-tpm"` (D19).
    - `a Waitron disk with tpm "disabled" → waitron-found with hardware "no-tpm"`, not a refusal (D2).
    - `a survey classifyDisk refuses (a disk id "../sda") → refuse observation-invalid`.
  - **Name tag (D8):** `venueTag {name: "Bar Àngels", live: true}` on a Waitron disk → the target's name is `"Bar Àngels"`; `name ""`, a 257-character name, a name holding `"\u0007"`, `"\u0085"` or a lone surrogate `"\uD800"` → `venueTag: null` on the target; `venueTag` on a Windows disk → the target's `venueTag` is `null` and the path is unchanged; `venueTag: {name: 5, live: true}` or with an extra key → throws `installer.event_invalid`.
  - **Events:** each malformed event throws `installer.event_invalid` / `event-invalid`: unknown `kind`, an extra key, `atMs: -1`, `submit.text` of 513 units, `choice: "erase"`, `clock-set {ok: true, utcMs: null}`, `clock-set {ok: false, utcMs: 5}`, `release-checked {outcome: "verified", releaseVersion: "1.0.0"}`, `release-checked {outcome: "installer-too-old", releaseVersion: "1.0.0\n"}`. An event at `atMs` below the state's throws reason `time-backwards`. A hand-made copy of a genuine state (`{...state}`) throws `installer.state_invalid`.
  - **Final phases (D14):** after `refuse disk-multiple`, a `tick`, a `key`, a `submit "BORRAR"` and a `write-finished` each answer `wait` with the refusal's message and `diskId: null`.
  - **Sequence (D13):** a second `observed` after a Waitron path → `refuse sequence-invalid`.
  - **Copies:** changing the caller's survey and tag objects after `observed` leaves the state's target unchanged; the decision, its message and its state are frozen.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/installer-policy.test.mjs`. With the exports as stubs that throw, expect each case to fail on its own assertion.
- [ ] **Step 3: Implement** `INSTALLER_TIMINGS_MS`, `ERASE_WORD`, `createInstallerState` and `nextInstallerStep` for the rules above. Pure, synchronous, no I/O.
- [ ] **Step 4: Run green.** Read the `Tests` count, then the one-file coverage command for `installer-policy.mjs`. Phases that Tasks 2–4 fill in may hold coverage below the bar now; record the figures and reach the bar by Task 4. Push only after Task 4, when the file meets the bar on its own.
- [ ] **Step 5: Deletion controls.** For each, make the change, see the named test fail, then restore. Record each in the commit body.
  - Treat `attachment: "unknown"` like `internal` in rule 6 → the lone-unknown-attachment case answers `wait`/`loading`.
  - Check `hardware` before rule 3 → the Waitron-with-TPM-disabled case refuses.
  - Drop the NFC step → the decomposed-accent case keeps the decomposed name.
  - Keep `venueTag` on a Windows target → its case fails.
  - Answer the refusal again instead of `wait` in a final phase → the D14 case fails.
- [ ] **Step 6: Commit.** `git add scripts/box/installer-policy.mjs scripts/box/installer-policy.test.mjs && git commit -s -m "feat(box): choose the installer's path from the disk survey"`. The body names the deletion controls, says the decoded name tag and the real survey come from later pull requests, and lists decisions D2, D3, D8, D13, D14 and D19.

### Task 2: guard 3, the reinstall screen and the unknown disk

**Files:**
- Modify: `scripts/box/installer-policy.mjs` and `scripts/box/installer-policy.test.mjs`

**Rules.**

*`waitron-found`* (entered in Task 1; message params `{seconds: 15, venueName, live, hardware}` from the target):
1. `tick` with `atMs >= deadlineMs` → `boot-installed`, `diskId` the target's, phase `booting`, message `installer.starting_installed`. **No other action names the disk on this path.** A `tick` before the deadline → `wait`, same deadline.
2. `key` or `submit` before the deadline → phase `reinstall-screen`, `deadlineMs = atMs + 120_000`, action `confirm-erase`, message `installer.reinstall` with `prompt` `venue-name` when the target's `venueTag` is not null, else `erase-word`, and `mismatch: false`. A `submit` here only opens the screen; its text confirms nothing.

*`reinstall-screen`:*
3. `key` → `wait`, `deadlineMs = atMs + 120_000` (two minutes from the last typing, spec lines 264–266), message unchanged.
4. `submit` whose text matches (D7: NFC of the text equals the tag's name for `venue-name`; the text is exactly `BORRAR` for `erase-word`):
   - target `hardware` not null → `refuse` with that reason (D2, §7.7);
   - otherwise `confirmed: 'typed'`, phase `loading`, action `wait`, message `installer.loading` (Task 3 continues).
5. `submit` that does not match → `confirm-erase`, `mismatch: true`, `deadlineMs = atMs + 120_000`. With `prompt: 'venue-name'`, the text `BORRAR` does not match (D7).
6. `tick` with `atMs >= deadlineMs` → `boot-installed`, phase `booting` (D5).

*`awaiting-erase-word`* (entered in Task 1):
7. `submit` exactly `BORRAR` → `confirmed: 'typed'`, phase `loading`, action `wait`. Any other text → `confirm-erase`, `mismatch: true`. `key` and `tick` → `wait`. No deadline: an unknown disk waits for a person for as long as it takes (§5.2, lines 283–288).

**Typed text is never stored.** The comparison reads `event.text` and keeps nothing derived from it beyond the `mismatch` flag.

- [ ] **Step 1: Write the failing tests.**
  - **15 seconds (Review Focus 2):** `Waitron disk observed at 1000, ticks at 15999 and 16000 → wait, then boot-installed with the internal disk id at 16000`; the whole run's actions are `[wait, wait, boot-installed]` and no `write-owned-target`, `download`, `set-clock` or `find-network` appears.
  - `the same with venueTag {name: "Bar Santet", live: true} → the first message is {key: "installer.waitron_found", params: {seconds: 15, venueName: "Bar Santet", live: true, hardware: null}}`.
  - **Reinstall screen:** `a key at 5000 → confirm-erase, prompt venue-name, deadline 125000`; `then a key at 60000 → deadline 180000`; `then a tick at 179999 → wait; at 180000 → boot-installed` (D5).
  - `a scanner's line "8412345678905" submitted on the screen → mismatch true, no erase path`.
  - `the exact name typed → confirmed typed, loading`; `"bar santet" → mismatch` (case); `"Bar Santet " → mismatch` (trailing space); `the name typed with a decomposed accent when the tag holds the composed one → matches` (D7).
  - `with a readable name, "BORRAR" → mismatch` (D7); `with an unreadable tag (venueTag null) the prompt is erase-word, and "BORRAR" confirms`; `"borrar" → mismatch`.
  - **Forgery:** `a tag whose name is "BORRAR" → prompt venue-name, and "BORRAR" confirms` (the tag only chooses the word; a person still types it); `whatever the tag says (live true or false, any name), with no key the run ends in boot-installed at 15 s`.
  - **Hardware off (D2):** `Waitron disk with tpm "disabled", no key → boot-installed at 15 s, message carries hardware "no-tpm"`; `the same, name typed on the reinstall screen → refuse no-tpm`, and no `write-owned-target` follows any later event.
  - **Unknown disk:** `a damaged Waitron disk, "BORRAR" submitted → confirmed typed, loading`; `"BORRAR\n" → mismatch` (taking off the Enter is the adapter's job); `a key, then ticks for an hour → still awaiting-erase-word, no action but wait`.
  - **Not kept:** after a mismatching `submit` of `"CANARY-2b9c"`, neither `JSON.stringify(decision)` nor `JSON.stringify(decision.state)` contains `CANARY`. (A sweep across whole runs is Task 5.)
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** the rules.
- [ ] **Step 4: Run green**, then the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Use `>` instead of `>=` against the 15-second deadline → the tick-at-16000 case waits.
  - Do not reset the idle deadline on `key` → the 180000 case boots at 125000.
  - Accept `BORRAR` on a `venue-name` prompt → its case confirms.
  - Compare case-insensitively → the `"bar santet"` case confirms.
  - Skip D2's refusal after a typed confirmation → the hardware-off reinstall case reaches `loading`.
  - Give `awaiting-erase-word` a two-minute return → the hour-of-ticks case changes.
- [ ] **Step 6: Commit:** `feat(box): start a box that already holds Waitron after 15 seconds unless a person confirms a reinstall`. The body names the deletion controls, says the 15 seconds and two minutes are the spec's calls (lines 247, 264–266), and lists D2, D5 and D7.

### Task 3: in memory, «Ya puedes quitar el USB», network, clock and the download

**Files:**
- Modify: `scripts/box/installer-policy.mjs` and `scripts/box/installer-policy.test.mjs`

**Rules.**

1. `ram-ready` in any phase that is not final → `ramReady: true`. If the phase is `loading`, continue as rule 2. Otherwise `wait`, phase unchanged. A repeated `ram-ready` changes nothing.
2. **Leaving `loading`:** whenever the phase is `loading` and `ramReady` is true (on entering `loading` or on `ram-ready`), the answer is `find-network`, phase `network`, message `installer.safe_to_remove`. This is the one place that message is given (spec §5 step 3, lines 217–219).
3. `usb-removed` while `ramReady` is false, in a phase that is not final → `refuse` `usb-removed-early` (D12). While `ramReady` is true → `usbPresent: false`, `wait`, nothing else changes. `usb-inserted` → `usbPresent: true`, `wait`.
4. *`network`:* `online` → if `clockSet` is false: `set-clock`, phase `clock`, message `installer.setting_clock`; otherwise `download`, phase `downloading`, message `installer.downloading`.
5. *`clock`:* `clock-set` with `ok` and `utcMs >= clockFloorMs` → `clockSet: true`, `download`, phase `downloading`. With `ok: false`, or `utcMs < clockFloorMs` → phase `clock-retry`, `deadlineMs = atMs + 60_000`, `wait`, message `installer.clock_retry` (D10).
6. *`clock-retry`* and *`download-retry`:* `tick` with `atMs >= deadlineMs` → `find-network`, phase `network`, message `installer.finding_network`.
7. *`downloading`:* `release-checked`:
   - `verified` → Task 4's rule 1;
   - `unavailable` or `truncated` → phase `download-retry`, `deadlineMs = atMs + 60_000`, `wait`, message `installer.download_retry` (D11);
   - `signature`, `checksum`, `too-large` → `refuse` `release-signature`, `release-checksum`, `release-too-large`;
   - `installer-too-old` → `refuse` `installer-too-old`, `releaseVersion` copied into the refusal (D11).
8. D13's general rules (Task 1) cover out-of-turn adapter results and a person's input in these phases. Until Task 4, `verified` answers `wait` and stays in `downloading`; Task 4's rule 1 replaces that.

- [ ] **Step 1: Write the failing tests.**
  - **In memory first (Review Focus 4):** `Windows disk observed at 0, no ram-ready, ticks to 600000 → only wait, and installer.safe_to_remove never appears`; `ram-ready at 3000 → find-network with installer.safe_to_remove`; `ram-ready at 0, then Windows observed at 1000 → find-network at once`.
  - `a Waitron disk with ram-ready → no installer.safe_to_remove before a typed confirmation`; `after the venue name is typed → find-network with installer.safe_to_remove`.
  - `a refused box (two disks) with ram-ready → never installer.safe_to_remove`.
  - **Early removal (D12):** `usb-removed before ram-ready on the Windows path → refuse usb-removed-early`; `the same on the Waitron path during the 15 seconds → refuse usb-removed-early, and no boot-installed follows`; `usb-removed after ram-ready → wait, and the run continues to set-clock on online`.
  - **Clock before download:** `online → set-clock`, never `download` first; `clock-set ok with utcMs equal to the floor → download`; `utcMs one below the floor → clock-retry`; `clock-set ok: false at 10000 → wait with deadline 70000; tick at 70000 → find-network; online → set-clock again`; `once the clock is set, a later online goes straight to download`.
  - **Download outcomes (Review Focus 3):** for each of `signature`, `checksum`, `too-large`: `→ refuse` with its reason, and every later event answers `wait`; `installer-too-old` with `releaseVersion "1.4.0"` → the refusal's params carry `"1.4.0"`; `unavailable` at 30000 → deadline 90000, then `find-network` at 90000; `truncated` the same.
  - **No fallback:** after `signature`, a further `online` or `release-checked verified` answers `wait`, never `download` or `write-owned-target`.
  - **D13:** `release-checked` while in `clock` → `refuse sequence-invalid`; `write-finished` while in `downloading` → `refuse sequence-invalid`; `online` while in `waitron-found` → `refuse sequence-invalid`.
  - **No time-zone question:** no message key in any run of this task contains `zone`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** the rules.
- [ ] **Step 4: Run green**, then the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Give `installer.safe_to_remove` on entering `loading` without checking `ramReady` → the no-ram-ready case shows it.
  - Skip `set-clock` (go from `online` straight to `download`) → the clock-first case fails.
  - Drop the floor comparison → the one-below-the-floor case downloads.
  - Retry after `signature` like `unavailable` → its case leaves `refused`.
  - Ignore `usb-removed` before `ram-ready` → the D12 cases continue.
  - Accept an out-of-turn `release-checked` → the D13 case does not refuse.
- [ ] **Step 6: Commit:** `feat(box): set the clock, download and check before anything is erased, and say when the stick can come out`. The body names the controls and lists D9–D13.

### Task 4: the 60-second wait, the write, guard 2 and the public status

**Files:**
- Modify: `scripts/box/installer-policy.mjs` and `scripts/box/installer-policy.test.mjs`

**Interfaces (added):**

```js
/**
 * @typedef {object} InstallerStatus  frozen; what the public status page may show (spec §5.6)
 * @property {InstallerPhase} stage
 * @property {boolean} safeToRemove  ramReady and a confirmed path, until a final phase
 * @property {string|null} stopReason  the refusal's reason, or null
 */
/** Pure. Throws installer.state_invalid for a state this module did not make. @param {InstallerState} state @returns {InstallerStatus} */
export function installerStatus(state);
```

**Rules.**

1. `release-checked` `verified` in `downloading`:
   - `confirmed` `unattended` → phase `erase-countdown`, `deadlineMs = atMs + 60_000`, `wait`, message `installer.erase_countdown` `{seconds: 60, recognised}`;
   - `confirmed` `typed` → `write-owned-target`, `diskId` the target's, phase `writing`, message `installer.writing` (D4).
2. *`erase-countdown`:* `tick` with `atMs >= deadlineMs` → `write-owned-target`, phase `writing`. `key` or `submit` before the deadline → phase `erase-stopped`, `confirm-erase`, message `installer.erase_stopped`, `deadlineMs: null`.
3. *`erase-stopped`:* `choice` `install-now` → `write-owned-target`, phase `writing`; `choice` `power-off` → `power-off`, phase `powering-off`, message `installer.powering_off`. `tick`, `key`, `submit` → `wait` (D6). A `choice` in any other phase → `wait`, ignored.
4. *`writing`:* `write-finished` `ok: true` → with `usbPresent` true: phase `remove-usb`, `wait`, message `installer.remove_usb`; with `usbPresent` false: `boot-installed`, phase `booting`. `ok: false` → `refuse` `write-failed`.
5. *`remove-usb`:* `usb-removed` → `boot-installed`, phase `booting`. `usb-inserted` → `wait`. `tick` → `wait`.
6. `usb-removed` and `usb-inserted` during `writing` update `usbPresent` (Task 3's rule 3), so a stick taken out and put back before the write ends still holds the restart.

- [ ] **Step 1: Write the failing tests.**
  - **60 seconds:** `Windows disk, ram-ready, online, clock set, verified at 1000 → wait with deadline 61000; tick at 60999 → wait; tick at 61000 → write-owned-target with the internal disk id` (the parent plan's case).
  - `a key at 30000 during the countdown → confirm-erase, installer.erase_stopped; ticks to 3600000 → wait only` (D6); `then choice install-now → write-owned-target`; `or choice power-off → power-off, and no write-owned-target ever`.
  - **D9:** `clock-set ok with utcMs 1_900_000_000_000 at atMs 10000, then verified at 20000 → the 60-second deadline is 80000`: the network time moves no deadline.
  - **Typed paths (D4):** `unknown disk, "BORRAR", ram-ready, online, clock set, verified → write-owned-target at once`; `Waitron disk, name typed, …, verified → write-owned-target at once`.
  - **Guard 2 (Review Focus 4):** `write-finished ok with the stick in → wait, installer.remove_usb; usb-removed → boot-installed`; `stick removed after safe-to-remove and before the write ends → write-finished ok → boot-installed at once`; `stick removed during writing, then inserted again, then write-finished ok → wait, remove_usb`; `ticks for an hour with the stick in → only wait` (present USB always holds the final restart).
  - `write-finished ok: false → refuse write-failed`, then every event answers `wait`.
  - **Status (D15):** `installerStatus` of a new state → `{stage: "observing", safeToRemove: false, stopReason: null}`; on the Windows path after `ram-ready` → `safeToRemove: true`; on a Waitron path before a typed confirmation → `false`; after `refuse disk-multiple` → `{stage: "refused", safeToRemove: false, stopReason: "disk-multiple"}`; for a Waitron disk with `venueTag {name: "Bar Santet", live: true}` and for a refused `installer-too-old "1.4.0"`, `JSON.stringify(status)` contains neither `"Bar Santet"`, `"1.4.0"` nor the internal disk id; `Object.keys(status)` is exactly the three keys; a hand-made state throws `installer.state_invalid`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** the rules and `installerStatus`.
- [ ] **Step 4: Run green**, then the coverage command. It must now meet 98/98/98/95.
- [ ] **Step 5: Deletion controls.**
  - Start the 60 seconds at `ram-ready` instead of at `verified` → the deadline-61000 case fails.
  - Apply the 60-second wait to typed paths too → the D4 cases wait.
  - Skip the stick check after the write → the stick-in case boots.
  - Do not update `usbPresent` on `usb-inserted` → the out-and-back-in case boots.
  - Put the venue name in the status → the D15 case fails.
- [ ] **Step 6: Commit:** `feat(box): wait 60 seconds before an unattended erase and restart only once the stick is out`. The body says the 60 seconds is the spec's call (lines 276–279) and lists D4, D6 and D15.

### Task 5: whole-run sweep

**Files:**
- Modify: `scripts/box/installer-policy.test.mjs` only

A test-only task: it checks properties across complete runs that no single case shows.

- [ ] **Step 1: Write the sweep.** Build a table of at least these complete runs, each a list of events: blank, Windows and BitLocker unattended installs to `boot-installed`; an unknown disk with «BORRAR»; a Waitron reinstall by name; a Waitron reinstall by «BORRAR» with an unreadable tag; a Waitron disk left alone (15 s); a Waitron disk with a scanner's line and a two-minute return; a hardware-off Waitron box; each refusal reason reachable from events (every one in Task 1's list); a run interrupted by every `release-checked` outcome; a run with a clock failure then success; an erase stopped then powered off. For every run assert:
  - **Closed action set:** every action is one of the nine `InstallerAction` values.
  - **Frozen target only:** every non-null `diskId` equals `INTERNAL_ID`; `STICK_ID`, `EXTERNAL_ID` and `SECOND_ID` never appear in any decision's `diskId`, message or `installerStatus`.
  - **Nothing written before verification:** `write-owned-target` appears at most once, and only after a `release-checked` `verified` event in the same run.
  - **Nothing written on the guard-3 path without typing:** a run with a Waitron disk and no matching `submit` contains no `write-owned-target`, `download`, `set-clock` or `find-network`.
  - **One final action:** at most one `boot-installed`, `power-off` or `refuse` per run, and nothing but `wait` after it.
  - **No typed text kept:** for every `submit` with a text that is not `BORRAR` and not the tag's name (use canaries such as `"CANARY-7f3a"`, `"Bar Santet extra"`), `JSON.stringify` of every later decision, state and status, and `util.inspect(state, { depth: 10, showHidden: true })`, contain no canary. For the matching texts, the state after the match contains no field holding the typed string (the tag's own name is expected in the target).
  - **Every state and decision is frozen** (`Object.isFrozen`, recursively over plain objects).
- [ ] **Step 2: Run it.** It should pass on Tasks 1–4's code. If a property fails, fix the code in `installer-policy.mjs` under this task, and record the cause in the commit body.
- [ ] **Step 3: Deletion controls.**
  - Name `STICK_ID` in `boot-installed` on the guard-3 path → the frozen-target property fails.
  - Keep the last submitted text on the state for the screen to show → the canary property fails.
  - Answer `write-owned-target` when `release-checked` `verified` arrives during `erase-countdown` (instead of D13's refusal) → the at-most-once property or the D13 case fails; say which.
- [ ] **Step 4: Run the coverage command** and read the counts.
- [ ] **Step 5: Commit:** `test(box): sweep whole installer runs for the frozen target, the order of writes and kept text`.

### Task 6: the network fallback decisions

**Files:**
- Create: `scripts/box/installer-network.mjs`
- Test: `scripts/box/installer-network.test.mjs`

**Interfaces:**
- Consumes: `exactRecord`, `safeInteger` from `scripts/box/upgrades/contracts.mjs`.
- Produces:

```js
/** Spec §5.3 item 2 (line 300) and item 4 (line 322); joinWithin reuses the one minute (D16). The spec's calls, not separately the owner's. */
export const NETWORK_TIMINGS_MS; // frozen { hotspotAfter: 60_000, retryEvery: 60_000, joinWithin: 60_000 }
/**
 * @typedef {'probing'|'hotspot'|'joining'|'joined'|'online'} NetworkPhase
 * @typedef {object} NetworkState  frozen; only states this module made are accepted
 * @property {NetworkPhase} phase
 * @property {number} atMs
 * @property {number|null} deadlineMs  probing: when the hotspot opens; hotspot: the next probe; joining/joined: when the join counts as failed
 * @property {boolean} joinFailed  the last join failed; the page says the password was wrong or the network has no internet
 * @property {'join-failed'|'no-internet'|null} failure
 * @typedef {'wait'|'probe'|'open-hotspot'|'join'|'continue'} NetworkAction
 *   open-hotspot: open «Waitron-Instalar» (fixed name, open, 10.42.0.1, forwarding nothing; the adapter's duty)
 *   join: close the hotspot, then join ssidHex with the password the adapter took from the form
 *   continue: internet found; close the hotspot if open; the installer goes on
 * @typedef {{ action: NetworkAction, ssidHex: string|null, deadlineMs: number|null, state: NetworkState }} NetworkDecision  frozen
 */
/** Throws installer_network.options_invalid unless options is exactly {atMs}. */
export function createNetworkState(options);
/** Pure. Throws installer_network.state_invalid / installer_network.event_invalid (event-invalid, time-backwards). */
export function nextNetworkStep(state, event);
/** Pure. @returns {{stage: NetworkPhase, joinFailed: boolean, failure: 'join-failed'|'no-internet'|null}} frozen */
export function networkStatus(state);
```

**Events** (exact records; `atMs` as in Task 1): `link {atMs, internet: boolean}` (the adapter's report that some link — cable, USB tethering or a joined Wi-Fi — has, or has not, a usable route to the internet); `tick {atMs}`; `join-requested {atMs, ssidHex}` (`ssidHex` as PR 2's rule: lowercase hex of 1–32 bytes; any other key, `password` included, throws); `join-result {atMs, ok: boolean}`.

**Rules.**

1. `createNetworkState({atMs})` → phase `probing`, `deadlineMs = atMs + 60_000`.
2. `link` with `internet: true` in `probing`, `hotspot`, `joining` or `joined` → `continue`, phase `online`.
3. *`probing`:* `tick` at or after the deadline → `open-hotspot`, phase `hotspot`, `deadlineMs = atMs + 60_000`.
4. *`hotspot`:* `tick` at or after the deadline → `probe`, `deadlineMs = atMs + 60_000` (every minute). `join-requested` → `join` with its `ssidHex`, phase `joining`, `deadlineMs = atMs + 60_000`.
5. *`joining`:* `join-result` `ok: false` → `open-hotspot`, phase `hotspot`, `joinFailed: true`, `failure: 'join-failed'`, `deadlineMs = atMs + 60_000`. `ok: true` → `probe`, phase `joined`, deadline unchanged.
6. *`joining`* or *`joined`:* `tick` at or after the deadline → `open-hotspot`, phase `hotspot`, `joinFailed: true`, `failure` `join-failed` from `joining`, `no-internet` from `joined` (D16).
7. A successful `continue` clears nothing it does not need: `joinFailed` stays as it was for the status page's last word.
8. `join-requested` outside `hotspot`, `join-result` outside `joining`, `link` with `internet: false`, and early `tick`s → `wait`. *`online`* answers `wait` to everything: when the installer needs the network again (Task 3's retries), its driver starts a new state.

- [ ] **Step 1: Write the failing tests.**
  - **Cable (Review Focus 5):** `link internet true at 0 → continue`; ticks after that → `wait`, and no `open-hotspot` in the run.
  - `a cable with no internet: link internet false at 0, ticks to 59999 → wait; tick at 60000 → open-hotspot`.
  - `ticks at 120000, 180000 → probe each time` (retry every minute); `a cable plugged in at 150000: link internet true → continue`.
  - `join-requested "56656e7565" at 70000 → join with ssidHex "56656e7565", deadline 130000`; `join-result false → open-hotspot, joinFailed true, failure join-failed`; `then join-requested again, join-result true, link internet true → continue`.
  - `join-result true, then no internet until 130000 → open-hotspot, failure no-internet` (D16).
  - `join-result never arrives: tick at 130000 → open-hotspot, failure join-failed`.
  - `a phone's USB tethering reported as link internet true while the hotspot is open → continue`.
  - `join-requested while probing → wait` (no form is offered before the hotspot opens).
  - **No password (Review Focus 5):** `join-requested with a password key → throws installer_network.event_invalid`; `ssidHex "" | "5G" | 33 bytes | upper-case hex → throws`.
  - **Status:** `networkStatus` has exactly `stage`, `joinFailed`, `failure`; it never holds the `ssidHex`.
  - Bad options, a hand-made state and an event earlier than the state throw their codes.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/installer-network.test.mjs`.
- [ ] **Step 3: Implement.** Pure, synchronous, no I/O.
- [ ] **Step 4: Run green**, then the coverage command for `installer-network.mjs`.
- [ ] **Step 5: Deletion controls.**
  - Open the hotspot on the first `link internet: false` → the cable-without-internet case opens it at 0.
  - Drop the joined-without-internet deadline → the `no-internet` case waits for ever.
  - Accept `join-requested` while probing → its case joins.
  - Allow a `password` key on `join-requested` → its throw case fails.
- [ ] **Step 6: Commit:** `feat(box): decide when the installer opens its own Wi-Fi network and when it tries again`. The body says the one minute is the spec's (lines 300, 322), lists D16 and D17, and says the hotspot's address, open security and no forwarding are the adapter's and the rig's.

### Task 7: backlog and dated pointers

**Files:**
- Modify: `docs/backlog.md`, the B3 entry (line 5114 on 2026-11-03).
- Modify: `docs/backlog/box.md`, `## B3. The bootable USB installer` (line 744): "Built so far (2026-11-03)" at line 829; the owner point at lines 875–881; "For later slices, from PR 2's re-map" at line 897, whose slice-2 bullet is at lines 907–908.
- Modify: `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md`, one dated pointer line at the top.
- Modify: `docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, one dated pointer line at the top.

- [ ] **Step 1: Backlog entry.** After the PR 2 sentence, add one: PR 3 (`#PR3`, filled in once the pull request exists, [plan](superpowers/plans/2026-11-03-b3-3-installer-policy.md)) adds the installer's decisions and its network fallback decisions under `scripts/box/`, none called yet; the signed release list waits for A940's release slices and the owner's choice of signing keys.
- [ ] **Step 2: `docs/backlog/box.md`.**
  - After PR 2's "Built so far" paragraph, add a dated PR 3 paragraph (`#PR3`) with two bullets in the same style: `installer-policy.mjs` (the path from PR 1's `classifyDisk`; 15 seconds then the installed box unless a person confirms; the two-minute return; the typed name or «BORRAR»; the clock before the download; the 60-second wait before an unattended erase; the restart only once the stick is out; the numbers are the spec's calls in one constant); `installer-network.mjs` (the hotspot after one minute, a retry every minute, a failed join reopening it, no password in the decisions).
  - Replace the owner point's last sentence ("Slice 2 decides; PR 1 reports …") with: the installer's decisions follow the recommended default — the installed box starts after 15 seconds and the message names the setting that is off, and a reinstall on such a box is refused — as one rule (D2); the opposite answer is a one-line change. Keep the question itself: it is still the owner's.
  - Delete the slice-2 bullet at lines 907–908 (decided: D18) and add, under a new "For later slices, from PR 3's re-map" heading:
    - the signed release list waits for three things not on main: A940's release version (slices 2 and 4), the owner's choice of signing keys and their custody, and A950's fields (`parseVerifiedRelease`); it is shared with slice 5 and with A950's `verifyManifest`, and must name the oldest installer a release accepts, which needs an installer version scheme nobody has defined yet;
    - the name tag's format and decoder: the Linux driver hands the policy the frozen internal disk's own decoded tag, and no other;
    - the write adapter re-checks the frozen disk's partition table and the disk's size before its first write, because the survey has no size field;
    - the rig case names `install`, `existing-stick`, `damaged-marker`, `two-disks`, `cut-header`, `remove-usb`, `disk-write-cut` and `network-fallback` join `RIG_CASES` with the runner that can run them;
    - decisions recorded for review: a lone disk of unknown attachment needs «BORRAR» (D3); a Waitron disk with a foreign encrypted partition is never erased unattended (D18); typed confirmations are compared exactly after NFC, and «BORRAR» is the word on the English screen too (D7).
- [ ] **Step 3: Pointers.** At the top of the spec and of the six-slice plan, above the 2026-11-03 PR 2 line, add: `> 2026-11-03: PR 3's plan (the installer's decisions and its network fallback decisions; the signed release list deferred) and its re-map against main: [2026-11-03-b3-3-installer-policy.md](…).` Do not rewrite either historical body (CLAUDE.md §6, docs).
- [ ] **Step 4: Guides and CLAUDE.md.** No guide changes: nothing a person sees changed. No CLAUDE.md line unless an implementing task paid for a new trap; if one did, add one line plus a pointer.
- [ ] **Step 5: Commit** in this branch (it is not a docs-only branch): `docs(backlog): record B3's installer decisions and what still waits for the release list and Linux`.

---

## Self-review

**Spec coverage for this pull request.**

| Spec sentence | Where |
| --- | --- |
| "nothing is erased until everything that could stop the install has been checked" and the six steps (§5, lines 210–222) | Tasks 1, 3, 4; Task 5's order properties |
| "one internal disk, a security chip switched on and Secure Boot switched on. A box that fails a check is refused here, untouched" (§5 step 2) | Task 1 rules 2 and 4 |
| "confirms that the complete installer is running from memory, then says «Ya puedes quitar el USB»" (§5 step 3) | Task 3 rules 1–2 |
| Guard 2: "restarts into the box only once the stick is gone … A stick taken out before that just stops a start that had not touched the disk" | Task 4 rules 4–6; Task 3 rule 3 |
| Guard 3: "waits 15 seconds, then starts the installed box … sets … `BootNext`" | Task 2 rules 1, 6 (the firmware call is the adapter's) |
| "A key pressed … opens the reinstall screen … Erasing needs the venue's name typed …, or «BORRAR» if the name tag cannot be read … Two minutes with no typing and the screen goes back to starting the installed box" | Task 2 rules 2–6 |
| §5.2: recognised disks "erased with no question", "the erase waits 60 seconds after the release has been downloaded and checked … A key stops it and offers «Instalar ahora» or «Apagar»" | Task 4 rules 1–3 |
| §5.2: "A disk it cannot classify … is never erased without a key … typing «BORRAR»"; "More than one internal disk: the installer picks none and stops" | Task 1 rules 2, 5, 6; Task 2 rule 7 |
| §5.3: "after one minute the installer opens its own Wi-Fi network … if that fails, it opens its network again … Otherwise it waits, trying again every minute" | Task 6 |
| §5.4: "sets the clock from network time before it downloads anything"; "A stick older than that says so and stops before erasing anything" | Task 3 rules 4, 5, 7 |
| §5.6: the status page "shows the step, the progress, «Ya puedes quitar el USB» and any reason it has stopped … never disk or fiscal keys" | Task 4's `installerStatus` (progress figures are the adapter's, "Out"); Task 6's `networkStatus` |
| §7.6: the name tag "decides nothing, and erasing still needs a person at a keyboard" | Task 2's forgery cases; Task 5 |
| §7.7: "The installer refuses, before it erases anything" | Task 1 rule 4; Task 2 rule 4 (D2) |

Every other Task 2.1 and Task 2.2 sentence is listed under "Out", with where it goes.

**Names.** These match the parent plan where it named them: `nextInstallerStep`, `InstallerState`, `InstallerEvent` (as the event table), `InstallerDecision`, and the actions `wait`, `download`, `confirm-erase`, `write-owned-target`, `boot-installed`, `refuse`. Additions and changes are in re-map finding 8. `verifyReleaseList` is not built (D1).

**What the planner ran (2026-11-03):**
- the probe pair `scripts/box/zz-planner-probe.mjs` and its test, with the one-file coverage command: 1 test, 50% lines, exit 1 ("does not meet global threshold"); then 2 tests, 100%, exit 0; both files then removed (`git status --short` empty);
- `memory_pressure`: 92% free before that run;
- `git tag -l 'v*'` and `git ls-remote --tags origin 'v*'`: no tags; `ls packages/fiscal-verifactu/declarations` and `ls docs/operations/release.md`: absent; `grep -n '"release' package.json`: no match;
- `grep` for `nameTag` in `scripts/box/*.mjs`, for `verifyManifest` in `scripts/box/upgrades/discovery.mjs`, and for the owner point and its recommendation in `docs/backlog/box.md` and lane B's questions file;
- a `node` check of NFC normalisation of a decomposed «À»;
- `pnpm exec prettier --file-info` on PR 2's plan: `"ignored": true` (`docs/` is ignored whole), so this file's format is not enforced.

**What the planner only read:** everything else, including every line number cited here, the claim that the installed disk asks for its key when the TPM or Secure Boot is off (D2's reasoning), and the A940 and A950 design and plan contents.

No test of the code above has run, because none of it exists yet.

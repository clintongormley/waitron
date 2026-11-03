# B3 slice 1, second pull request: the preboot unlock gate, the locked-mode redirect and the Wi-Fi record reader

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Build the parts of the box's *preboot* step that an unprivileged macOS machine and CI's root Vitest project can fully test. "Preboot" means the small program that runs from the unencrypted startup image before the encrypted disk is open, when the security chip has refused to open it by itself and a person has to type the disk's recovery key. Three pieces:

- the **unlock gate**: one shared checker for typed recovery keys, with the 2/4/8/16/32/60-second wait after each wrong key;
- the **locked-mode redirect decision**: what the box answers at `http://waitron.local` and `https://waitron.local` while it is locked, and which certificate it shows;
- the **Wi-Fi record reader**: reads the one saved Wi-Fi connection the box needs to be reachable over Wi-Fi while locked.

Nothing here runs on a box, opens a disk, listens on a socket, or joins a network. Nothing here is a qualified boot path.

**The wait numbers are a proposal, not the owner's choice.** The 2, 4, 8, 16, 32 and 60 seconds come from the spec's "retained wrong-attempt proposal (my call)" (spec §7.5). The owner's 2026-10-26 answers settled reachability and Wi-Fi but did not choose these numbers, and the spec says they "do not create a new pending approval question". Every task, commit and doc line that names them says "proposed".

**Architecture:** Three small host libraries under `scripts/box/`, each a plain `.mjs` file with JSDoc types and a sibling `.test.mjs` in the root Vitest project, in the style PR 1 set (`scripts/box/disk-state.mjs`, `rig-contract.mjs`, `disk-key.mjs`). Anything that needs Linux, root, the startup image, a disk or a socket sits behind an injected function (a "seam": a function the caller passes in, so tests can supply a stand-in). The real Linux versions are not written here. Where a seam has no real version yet, the module's fixed production entry point refuses, as PR 1's `storeDiskRecovery` and `withDiskRecovery` do (`scripts/box/disk-key.mjs`, the `fixedStore` at the end of the file).

**Tech Stack:** Node 26 (`.nvmrc`), `node:crypto` (`X509Certificate`), `node:fs/promises`, Vitest 4.1.12 root project. Test fixtures call the `openssl` command line once per file. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §7.3 (first start), §7.5 ("Preboot requirements, before root opens", "Approved reachability", the recovery-leaf paragraphs, "Approved normal Wi-Fi copy", "Proposed minimal-copy update contract", "Retained wrong-attempt proposal").

**Parent plan:** [six-slice plan](2026-10-26-b3-usb-installer.md), Slice 1, Task 1.3, the parts an unprivileged machine can test. PR 1's plan named this pull request's scope in its "Out" section: [PR 1](2026-11-01-b3-1-encrypted-disk.md), "PR 2: the preboot pure logic (parent Task 1.3)".

**Build authority:** the owner's "Yes, build it", 2026-11-01, relayed by the lead session for PR 1, with the build cut one pull request at a time ([PR 1's plan](2026-11-01-b3-1-encrypted-disk.md), "Build authority").

**Review folded 2026-11-03.** A fresh-context plan review found six important and eleven minor points; the coordinator ruled on each, and all are folded in:

- I1: a recovery certificate carrying the CA's own public key is refused (`recovery-same-key`, Task 5).
- I2: the real box CA is written by node-forge with `\r\n` line endings and RSA-2048 keys, so a certificate block may use `\n` or `\r\n`, one style per block, and the fixtures include an RSA-2048 CA and a `\r\n` case (Task 5).
- I3: `cancel()` becomes `close()`, for preboot shutdown only; no screen or network path calls it. `close()` never wipes a key an adapter is still using; an open already running finishes and its result stands. A submission while `open` runs answers `wait` with `retryAt: null` (Tasks 2 and 3).
- I4: the gate copies a key only on the path that calls `verify`; every other path zeroes the caller's array and keeps no copy (Task 3).
- I5: the spec's public CA download and help page is listed under "Out" (Task 6's rule that no path reaches the decision would be relaxed for that one fixed path).
- I6: a box whose recovery certificate is refused answers HTTP with a fixed, form-free explanation (`explain`, Task 6), instead of silence.
- M1–M11: an `unhandledRejection` listener and `util.inspect(gate, { depth: 10, showHidden: true })` in the sweep (Task 4); the spawn-timeout guard named as a negative check only (Task 5); `prebootUnlockGate` built like PR 1's `fixedStore` (Task 3); red steps that fail on named assertions (every task); the 0xFF case on a `sae` record, the 64-digit key's letter case, and unsupported networks named as a gap for task 3.1 (Task 7 and re-map finding 12); genuine targets marked in a `WeakSet` and a refused redirect identity throwing (Task 6); the observation copied once with `structuredClone` (Task 1); every `input_invalid` reason named, and bad reader deps refused (Tasks 2, 5, 6, 7, 8); the redirect certificate must be self-signed (Task 5); wording fixes (Task 1, re-map finding 12, Self-review); the `openssl` receipt, two more "Out" items, `retryAt`'s clock, and who sets the installation id's minimum length (Out, Tasks 2 and 5, re-map finding 7).
- Q7: the proposed CLAUDE.md line is dropped; the backlog line about `apps/server/src/box-tls-repair.test.ts:397` stays, worded as a weak test assertion (Task 9).

**Round-3 check folded 2026-11-03.** A narrow check of the folded plan, with probe scripts, found fourteen points; all are folded as the coordinator ruled: Task 1's rule-4 and copy deletion controls reworded so each fails as named, and its red step matched to the stub convention; Task 2's submission-during-open case asserts the call counts before awaiting; Task 3's `close()` window defined (`verifying` until the running call settles, a submission then answers `closed`, `close()` on a refused gate does nothing); Task 4 inspects the gate while calls are pending and waits one event-loop turn before checking for unhandled rejections; Task 5's timeout-guard sentence and Vitest's 10-second hook default stated exactly; Task 6's `selectLockedIdentity` names its `target-invalid` throw; Task 7 compares bytes, not strings, and calls a non-ASCII WPA2 password `record-unsupported`; Task 8 says `realpath` equality is the caller's duty; line numbers in `self-signed-cert.ts` corrected; the spec's "cancel" narrowed to a person cancelling, with the screen's own clearing added to "Out".

## Global Constraints

- **Machine limits on 2026-11-03:** macOS, unprivileged. No Linux, no virtual machine, no TPM (the security chip), no `cryptsetup` (the Linux disk-encryption tool). Anything that needs those is not built here and is never described as working.
- **The wait numbers are proposed** (see above). They live in one exported constant, `UNLOCK_DELAYS_MS`, so the owner can change them in one place.
- **One gate per boot.** Every route that accepts a key (the local screen and the trusted recovery address) uses the same gate object, so the wait is shared. A restart starts a fresh gate and resets the wait (spec §7.5: "Reboot resets the proposed in-memory backoff").
- **A typed disk key** reaches the gate as 32 bytes (256 random bits, spec §7.5 and P40). It never appears in a returned value, a status, a thrown error, a log line, an environment variable, a process argument or a file. The gate clears every copy it holds when an attempt ends, however it ends.
- **The redirect routes take no key.** Neither `http://waitron.local` nor `https://waitron.local` accepts a key, a sign-in or a configuration change, and neither points anywhere but the one fixed recovery address (spec §7.5, "Approved reachability").
- **The two locked certificates stay apart.** The recovery certificate is signed by the box's certificate authority (the CA: the root certificate devices are asked to trust) and names only the recovery address. The redirect certificate is NOT signed by that CA (spec §7.5). The normal server certificate and the CA's signing key stay encrypted and are never an input here.
- **The Wi-Fi reader reads one fixed file** and nothing else: never the staging copy `wifi.json.next`, never another path, never a whole network profile (spec §7.5: "read only the validated active fixed-path record, never leftover temporary copies").
- **Coverage:** the root project holds `98/98/98/95` (`vitest.config.ts:120`). No `exclude`, no ignore comment, and no moving code into a testing folder.
- **Code style:** English only in code. Comments only for an invariant or a reason the code cannot show. Error codes name the domain (`unlock.*`, `recovery_identity.*`, `locked_request.*`, `wifi_record.*`), never the file.
- **Commits:** `git commit -s`, staging only named paths, never `git add -A`.

## Review Focus

1. **Someone floods wrong keys from the local screen and the network at once.** Expected: one shared wait; two submissions in flight call the checker once; a malformed submission neither starts a second check nor skips a wait. Task 2.
2. **The disk the gate would open is the wrong one.** Examples: the internal disk's encryption header names another disk; a copy of the disk is plugged in by USB; both headers are damaged; first start never finished. Expected: the gate refuses before any check, with zero calls to the checker or the opener. Task 1.
3. **A key left behind.** Expected: the caller's array is zeros as soon as `submit` returns; the gate holds a copy only while `verify` or `open` is using it, and that copy is zeros when the call settles, including after `close()` and when the checker or opener throws an error that holds the key. Tasks 3 and 4.
4. **A wrong certificate staged for the locked listeners.** Examples: the normal server certificate staged as the redirect certificate; a recovery certificate that also names `waitron.local`, or that carries the CA's own key; a certificate whose issuer *name* matches the CA but which another key signed; a private key appended to a certificate file. Expected: refused, and the redirect certificate is never one the CA signed. The real box CA, RSA-2048 with `\r\n` line endings, is accepted. Task 5.
5. **A request that tries to use a redirect route for more than navigation.** Examples: a key POSTed to `http://waitron.local`; a connection that presents `waitron.local` to choose the untrusted certificate and then asks for the recovery address in its `Host` header; a request path or query that tries to choose the redirect target. Expected: no key form under the untrusted certificate, no redirect that tells the browser to re-send a body, and every redirect points at the one fixed address. Task 6.
6. **A Wi-Fi record that is damaged, oversized, of an unknown version, or not where it should be.** Expected: it never loads; the staging copy is never read in its place; nothing but `wifi.json` is opened. Tasks 7 and 8.

---

## What this pull request builds, and what it leaves out

**In (testable on this machine):**

| Task | File | Parent-plan source |
| --- | --- | --- |
| 1 | `scripts/box/preboot.mjs` and test: `freezeUnlockTarget`, which disk the gate may open | Task 1.3, red step 1 ("Wrong UUID/state, missing/duplicate disk and damaged metadata refuse with zero `open` calls") |
| 2 | `scripts/box/preboot.mjs` and test: `createUnlockGate`, the shared wait, one check at a time, the outcomes | Task 1.3, red step 1 |
| 3 | `scripts/box/preboot.mjs` and test: key buffers, `close()`, the fixed `prebootUnlockGate` | Task 1.3, red step 3 ("clear owned buffers on cancel/error/success") |
| 4 | `scripts/box/preboot.test.mjs`: key-leak sweep across Tasks 2 and 3 | Task 1.3, red step 3 ("Canary assertions keep submitted disk keys out of args/env/files/logs/storage") |
| 5 | `scripts/box/preboot-locked.mjs` and test: `freezeLockedTarget`, the two locked certificates | Task 1.3, red step 2 ("distinct non-CA-signed redirect identity"; "Recovery leaf SANs exclude `waitron.local`") |
| 6 | `scripts/box/preboot-locked.mjs` and test: `selectLockedIdentity` and `decideLockedRequest` | Task 1.3, red step 2 |
| 7 | `scripts/box/wifi-record.mjs` and test: `parseWifiRecord`, the version-1 record format | Task 1.3, red step 2 ("Missing/corrupt/oversized/unsupported Wi-Fi records never load") |
| 8 | `scripts/box/wifi-record.mjs` and test: `createWifiRecordReader`, the fixed file read, and a password sweep | Task 1.3, red step 2 ("No arbitrary-path reads or temporary-copy fallback") |
| 9 | Backlog, plus dated pointers in the spec and the six-slice plan | — |

**Out, and where each goes next:**

**The preboot screen itself: deferred to the Linux pull request that adds `deploy/box/preboot/`.**

- The Spanish/English local screen and the trusted key form, their light and dark themes, and the 390 px and 1280 px checks (parent Task 1.3, last step).
- Turning the 64 typed letters into 32 bytes. The letters come from systemd's 16-letter "modhex" set (P40). The decoder belongs beside the screen, and slice 8's sheet must print with the same alphabet; one shared encoder and decoder is that pull request's choice. The gate takes bytes only.
- The changed-startup warning («Han cambiado los archivos de arranque») and the "the startup image cannot prove itself honest" warning (spec §7.5).
- On a person's Cancel, the screen clears its own copy of the typed key (spec §7.5: "clear on cancel/error"). It does not call the gate's `close()`.
- The words for Task 6's `explain` answer, in the preboot screen's English and Spanish translation files, keyed by its fixed code `unlock.remote_unavailable`.
- Showing a wait. The gate's `retryAt` is a deadline on a clock that never jumps (`performance.now()` in production), which means nothing to a browser; the HTTP adapter converts it to time remaining before sending it.

**The public CA download and help page: deferred to the HTTP adapter pull request.** Spec §7.5 says "Public CA download/help is available without a key form" (spec line 682). Task 6 does not build it. Adding it means relaxing Task 6's rule that no request path reaches the decision, for that one fixed path only; that pull request designs it.

**Real adapters: deferred to the Linux pull request.**

- `verify` and `open` with `cryptsetup`, passing the key on standard input, never as an argument or in the environment. Before it opens anything, the opener re-checks that the partition it found on `handle.diskId` still carries `handle.diskUuid`, because a disk can be plugged in after the target was frozen.
- The machine observation inside the startup image (the same `MachineObservation` PR 1's `classifyDisk` reads), the expected disk UUID from the measured startup configuration, and the first-start state (spec §7.3).
- The boot-partition mount check behind `createWifiRecordReader`'s `inspectBootMount`, and the path where the startup image mounts the boot partition. `BOOT_ROOT` is `/boot` here, per the spec's `/boot/waitron-recovery/wifi.json`; the Linux pull request confirms or changes it.
- Reading the recovery identity files from `/boot/waitron-recovery/` (the recovery certificate and key, the redirect certificate and key, the public CA certificate, the installation id) and building the two TLS contexts.
- Listening on ports 80 and 443, choosing the certificate by the name the browser asks for (Task 6's `selectLockedIdentity` is the decision; the TLS callback is the adapter), closing the listeners after unlock, and extending the security chip's measurement on every exit (spec §7.2).
- Joining the Wi-Fi network in the startup image with bounded retries, showing the real failure on the local screen, and the cable and local-screen fallback.
- After unlock: recording that the recovery key was used, without its bytes, and comparing the startup files' fingerprints with the ones recorded inside the encrypted disk before resealing (spec §7.5, "Changed-startup warning and limits").
- Calling the gate's `close()` when the preboot service shuts down.

**Made elsewhere, not read here: the host side.**

- Minting the installation id at first start, signing the recovery certificate while the system is unlocked, renewing it before expiry, and keeping the old pair until the new one is checked (spec §7.5). This is the first-start and host-service work (slice 1's Linux pull request and slice 3).
- Writing `wifi.json`: task 3.1's `network.mjs`. It must write the format Task 7 defines; it should import Task 7's parser to read back what it wrote, as PR 1's store reads its record back.

**The address fallback: deferred to the Linux rig.** A box reached by its IP address, when the `.local` name does not resolve, needs a recovery certificate naming that address (spec §7.5: "changing the address requires a leaf naming it"). Task 5 refuses any recovery certificate that names more than the recovery address, and Task 6 refuses an IP address as a host. The rig decides the rule for an address entry and widens both.

**Real rig cases: deferred to the Linux pull request.** `preboot-local`, `preboot-headless`, `preboot-two-boxes` and `preboot-tamper`, which `RIG_CASES` already names (`scripts/box/rig-contract.mjs:31-43`), plus memory, swap, crash-dump and browser-retention measurements of the typed key (spec §7.5: "Actual memory lifetime, browser retention and crash paths need measurement").

**Actual Android Chrome: slice 6, Task 6.1.** The three trust rows and the separate redirect-warning row are **UNVERIFIED / NOT RUN**. Node checks in this pull request cannot fill them (parent Task 1.3: "Node TLS receipts cannot fill these rows"). The historical failure in commit `75f17f9e36125af3a620266a584507420e7197de` still holds the affected trust design and release for requalification.

## Re-map against main on 2026-11-03

The six-slice plan was written on 2026-10-26, before PR 1. This re-map checks Task 1.3 against main at `24ddc63fe7`.

1. **Three files, not one.** The parent plan puts everything in `scripts/box/preboot.mjs`. Here the gate stays in `preboot.mjs`, the redirect decision goes in `preboot-locked.mjs`, and the Wi-Fi reader goes in `wifi-record.mjs`. Reason: the Wi-Fi record format needs one owner that task 3.1's writer imports, and three smaller suites keep each task inside one implementer's budget.
2. **The root Vitest project needs no change.** Its test glob is `scripts/**/*.test.mjs` (`vitest.config.ts:71`) and its coverage glob is `scripts/**/*.mjs` (`vitest.config.ts:119`), so all three new files are found and measured. Checked by running `pnpm exec vitest run scripts/box/disk-state.test.mjs` (118 passed) and the same with `--coverage --coverage.include=scripts/box/disk-state.mjs`, which measured that file alone (98/98 statements, 122/122 branches) and exited 0.
3. **The gate freezes its target from PR 1's whole-machine observation.** The parent plan's `createUnlockGate({diskUuid, now, verify, open})` takes a UUID and leaves "missing/duplicate disk and damaged metadata" to an unnamed check. PR 1 now ships `classifyDisk(MachineObservation)` (`scripts/box/disk-state.mjs:205`), which already refuses partly-Waitron, damaged and multiple disks. So the gate takes `{observation, now, verify, open}`, where `observation` is `{expectedDiskUuid, firstStart, machine}`, and `freezeUnlockTarget` runs `classifyDisk` first (Task 1). The TPM and Secure Boot field `classifyDisk` returns is ignored: a changed chip state is a common reason a person is typing a key at all.
4. **No client id.** The parent's `submit(clientId, key)` takes a client id, but the wait is shared, so nothing would read it. Sharing comes from one gate object instead, and the fixed `prebootUnlockGate()` returns the same object every time (Task 3).
5. **The result gains a `reason`, and the gate gains `status()`.** The parent's `{kind, retryAt}` cannot say *why* the gate refuses, and the spec requires that "wrong, missing or multiple matching disks, damaged metadata or first-start-repair state offer Stop/reinstall guidance". The screen also needs to show a wait without submitting a key.
6. **Choices the parent plan does not make, each recorded as a decision (the conservative option):**
   - The wait starts when the checker *answers*, read from an injected clock (in production `performance.now()`, which does not jump when the wall clock is set). A check takes real time on a real disk, and starting the wait at submission would let that time eat into it.
   - A malformed submission (not a 32-byte `Uint8Array`) counts as a failed attempt and starts the next wait, without calling the checker. The spec says malformed submissions "cannot start concurrent verification or bypass the delay"; counting them is the simplest rule that holds.
   - A checker that throws, or answers anything but `true` or `false`, ends the gate: every later submission is refused until a restart. So is an opener that throws. The gate never retries a failing device; a restart resets it.
   - `submit` takes ownership of the array it is handed. It zeroes the caller's array before its first `await`, and copies the bytes first only when it is about to call `verify` (review I4).
   - The parent's `cancel()` is renamed `close()` and is for the preboot service's shutdown only (review I3). A screen's Cancel button or a browser that disconnects never calls it, because closing is permanent until a restart. `close()` never wipes a copy that `verify` or `open` is still using; that copy is wiped when the call settles. An `open` already running when `close()` is called finishes, and its result stands. `close()` after a successful open does nothing.
7. **There is no installation id on main, and the two existing ids must not be used.** The spec names the recovery address `unlock-<installation-id>.waitron.local` but does not define the id. A grep finds two things with similar names, and neither fits:
   - `installationId` in `apps/server/src/cloud-installation.ts:142` and `:240` is Waitron Cloud's registration id;
   - `installationIdentity` in the fiscal package (for example `packages/fiscal-verifactu/test/conflict-browser-fixture.ts:9`, `"0CNQA"`) is the five-symbol fiscal installation name, which restore and promotion replace (CLAUDE.md §5).

   The spec says "restoring a venue must not replace the physical disk's preboot identity", so the recovery address needs its own per-disk id, made at first start (see "Out"). Task 5 checks only its spelling: 1 to 56 lowercase letters or digits. 56 is 63 minus the 7 characters of `unlock-`; a DNS label is "63 octets or less" (RFC 1035 §2.3.4, fetched with `curl` on 2026-11-03). Hyphens are refused so the address has one spelling; the first-start pull request may widen this. The minimum length that keeps two boxes' addresses apart belongs to whichever pull request mints the id; 1 here is only the spelling floor.
8. **"Not signed by the CA" is checked by signature, never by name.** Node's `X509Certificate.checkIssued(ca)` matches the issuer's name and key identifier, both of which another CA can copy, so only `verify(ca.publicKey)` ties a leaf to the CA's key. Run on 2026-11-03 with OpenSSL 4.1.0: a self-signed certificate whose subject copies the CA's name gave `checkIssued(ca) = true` and `verify(ca.publicKey) = false`. So Task 5 proves "signed by the CA" with `verify(ca.publicKey)` and uses `checkIssued` only as an extra condition. While checking this, the planner saw that `apps/server/src/box-tls-repair.test.ts:396-401` asserts a repaired leaf with `checkIssued` alone. That is outside this pull request; Task 9 records it in the backlog.
9. **A certificate input is exactly one PEM certificate block.** Run on 2026-11-03: `new X509Certificate(leafPem + caPrivateKeyPem)` parsed without error and returned the leaf. A file holding a certificate plus a private key would pass a parse-only check, so Task 5 refuses any input that is not one `-----BEGIN CERTIFICATE-----` block and nothing else. The block may use `\n` or `\r\n` line endings, one style throughout (review I2): the box CA is written by node-forge's `certificateToPem` (`apps/server/src/self-signed-cert.ts:222`, written to disk at `apps/server/src/box-secrets.ts:212`), and a `certificateToPem` run on 2026-11-03 produced `\r\n` on every line. Its keys are RSA-2048, generated at `apps/server/src/self-signed-cert.ts:156`.
10. **A recovery certificate may name exactly one thing, the recovery address.** The spec's Android table describes the leaf as "with its SANs naming only the recovery identity" (SAN: the certificate's list of names it is valid for). The address fallback (see "Out") is the later exception.
11. **A temporary redirect, never a permanent one.** RFC 9110 says a 308 (and a 301) "is heuristically cacheable" (§15.4.9 and §15.4.2, fetched with `curl` on 2026-11-03). A browser that cached a permanent redirect from `http://waitron.local` would keep sending people to the recovery address after the box unlocks. So the redirect is a 302 with `Cache-Control: no-store`. Methods other than GET and HEAD get 405, never a redirect, so a browser is never told to send a submitted body on to another address. A request for any other host gets 421, which RFC 9110 §15.5.20 describes as "the request was directed at a server that is unable or unwilling to produce an authoritative response for the target URI".
12. **The Wi-Fi record format does not exist yet.** Task 3.1, which writes it, is not built: no `wifi.json`, `waitron-recovery` or `network.mjs` exists in the tree (checked with `grep -rn` over `apps`, `packages`, `scripts` and `deploy`). Task 7 defines version 1, the minimum the spec allows: the network name, the security type, the password and whether the network is hidden. The field rules follow NetworkManager 1.52.0, fetched with `curl` on 2026-11-03:
    - network name: `src/libnm-core-impl/nm-setting-wireless.c:1109-1113`, "SSID length is out of range <1-32> bytes";
    - WPA2 password: `src/libnm-core-impl/nm-setting-wireless-security.c:1707-1711`, "either an ASCII passphrase of 8 to 63 characters … or the key in form of 64 hexadecimal character", and `src/libnm-core-impl/nm-utils.c:1237-1258`;
    - WPA3 password: the same comment, "a passphrase of any length for SAE authentication", and `nm-setting-wireless-security.c:858-863`, which asks for the password again when it is empty.

    Version 1 supports `wpa-psk` (WPA2 and WPA3 personal) and `sae` (WPA3 personal only). Open networks, WEP, enterprise sign-in and OWE are "unsupported" and never load, and a WPA2 password with a character outside printable ASCII is refused as `record-unsupported` (Task 7's rule 8, so task 3.1 can explain the refusal), although NetworkManager's own check (`nm-utils.c:1237-1258`) counts only its length. Such a box has no Wi-Fi unlock and needs cable or the local screen. That is a gap, recorded for task 3.1, which reports the copy as failed rather than claiming Wi-Fi recovery works.
13. **The reader has a boot-mount seam, and its fixed entry point refuses.** Without one, a fixed entry point reading `/boot` would answer differently on macOS (no `/boot`) and on CI's Linux runner (a real `/boot`), so a test of it would depend on the machine. PR 1's pattern avoids that: the fixed entry refuses `mount-unverified` until the Linux pull request supplies the check.
14. **Spec line numbers that moved.** The spec cites `apps/server/src/self-signed-cert.ts:31-35` and `:29-33` for the CA's permitted names. They are now at `:27-33` (`PERMITTED_DNS` is at `:33`). Checked by reading. The spec is historical and is not edited (CLAUDE.md §6, docs).
15. **PR 1's refusal codes are registered nowhere** (`grep -rn 'disk_recovery.refused'` outside `scripts/box/` finds only PR 1's plan). Host libraries keep their codes local; this pull request does the same. `apps/server/src/errors.ts` is untouched.
16. **`classifyDisk` accepts a Waitron disk that also holds a foreign encrypted partition.** Run on 2026-11-03 with a `node` script: a complete Waitron disk plus a fourth `luks2` partition whose valid headers carry subsystem `"other"` classified as `{kind:"waitron", layoutVersion:1}`. The reason is in `scripts/box/disk-state.mjs:150-167`: `completeLayout` checks the headers of the one marked partition only, and an unmarked foreign partition is not a marker. PR 1's plan words this rule as "No valid header carries a different subsystem", which reads either way. Whether that was meant is for slice 2's installer policy. For the unlock it does not matter, because Task 1's rule 4 refuses a second signature carrying the expected UUID, and the opener opens by that UUID on the frozen disk. Task 9 records it for slice 2.

## Execution notes for every task

**Worktree.** Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-2-preboot-logic`, and run commands from that folder.

**Style precedent.**
- `scripts/box/disk-key.mjs` sets the style for refusal errors (`Object.assign(new Error(code), { code, reason })`), for a `WeakSet` of refusals built in the module so an injected function's error never passes through, for strict exact-key records (`exactRecord` from `scripts/box/upgrades/contracts.mjs`), for an in-process turn, and for a fixed production entry point built from a seam that refuses.
- `scripts/box/disk-key.mjs` also sets the file-reading style Task 8 copies: open with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, check the handle's own `stat()`, refuse a second hard link, and `lstat` each folder.
- Results that are expected states (a wrong key, an absent Wi-Fi record) are returned as frozen objects, not thrown. Only a caller's programming error (wrong option types or keys) throws.

**Test conventions.**
- Tests import `describe`, `expect`, `it` (and `beforeAll`, `afterEach`, `vi` where needed) from `vitest`.
- Real-file tests use `fs.realpath(await fs.mkdtemp(join(tmpdir(), "...")))` (macOS `/var` is a symlink to `/private/var`) and remove their folders in `afterEach`.
- Refusals assert both `code` and `reason`; results are asserted whole with `toEqual`.
- The gate's tests use no timers: the clock is a variable the test sets, and the checker is a promise the test resolves.
- **Red means a named assertion failing.** Before implementing, add the new exports as stubs that throw `new Error("not implemented")` (or import the module as a namespace, `import * as preboot from "./preboot.mjs"`), so the red run reports each case failing on its assertion, not one import error for the whole file.

**Letter case.** As in PR 1, no test may depend on file-name letter case: on macOS's default file system `WIFI.JSON` opens `wifi.json`. No test creates two files whose names differ only in case.

**Coverage for one file.** Read the summary counts; `0/0` means the include matched nothing. The run must exit 0 at 98/98/98/95; aim for 100%.
`pnpm exec vitest run scripts/box/<name>.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/<name>.mjs`

**Before each commit.** Run `pnpm exec prettier --check <files>` and `pnpm exec eslint <files>`, and read the `Tests` count (CLAUDE.md §4). The pre-push hook and CI do the rest; do not run the whole workspace.

**Long runs.** An implementer past about 150 tool calls with the task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover: what is done, what is left, which files, and each check's state.

**Order.** Run Tasks 1→2→3→4, 5→6 and 7→8 one after another in this worktree, then Task 9. The three groups touch separate files, so working in parallel would need separate worktrees (CLAUDE.md §6).

---

### Task 1: which disk the gate may open

**Files:**
- Create: `scripts/box/preboot.mjs`
- Test: `scripts/box/preboot.test.mjs`

**Interfaces:**
- Consumes: `classifyDisk` and `WAITRON_LAYOUTS` from `scripts/box/disk-state.mjs`; `exactRecord` from `scripts/box/upgrades/contracts.mjs`.
- Produces:

```js
/**
 * @typedef {object} UnlockObservation  taken once, before any listener starts
 * @property {string} expectedDiskUuid  lowercase canonical; from the measured startup configuration (Linux seam)
 * @property {'complete'|'pending'|'unknown'} firstStart  spec §7.3; only 'complete' allows a key
 * @property {import("./disk-state.mjs").MachineObservation} machine  PR 1's whole-machine observation
 * @typedef {{ diskId: string, diskUuid: string, layoutVersion: number }} UnlockHandle  frozen
 * @typedef {{ kind: 'ready', handle: UnlockHandle } | { kind: 'refused', reason: UnlockTargetRefusal }} UnlockTarget  frozen
 * @typedef {'observation-invalid'|'disk-missing'|'disk-multiple'|'disk-not-waitron'|'disk-mismatch'|'disk-duplicate'|'first-start-pending'} UnlockTargetRefusal
 */
/** Pure. Never throws for a bad observation: it answers refused "observation-invalid". @param {unknown} observation @returns {UnlockTarget} */
export function freezeUnlockTarget(observation);
```

**Rules, in this order:**

0. Copy the observation once with `structuredClone`, inside a `try`; a throw (a function, a getter that throws, a proxy) gives `observation-invalid`. Every later rule reads only the copy, so the caller cannot change what is checked between two reads (review M7).
1. The copy is exactly `{expectedDiskUuid, firstStart, machine}`, `expectedDiskUuid` is a lowercase canonical UUID, and `firstStart` is one of the three values. Otherwise `observation-invalid`.
2. Run `classifyDisk(machine)`. A throw (PR 1's `disk.observation_invalid`) gives `observation-invalid`. Kind `none` gives `disk-missing`, `multiple` gives `disk-multiple`, and `unknown` or `recognised-other` gives `disk-not-waitron`. The `hardware` field is ignored.
3. On the Waitron disk, find the one partition with its layout's `typeGuid`, `partitionName` and `luks2` content (`classifyDisk` guarantees exactly one). Its UUID is the `uuid` of its valid header or headers (`classifyDisk` guarantees they agree). If it differs from `expectedDiskUuid`, the answer is `disk-mismatch`.
4. Count every signature on **every** disk, whatever its attachment (internal, external, installer or unknown), whole-disk or partition, that has at least one valid header whose `uuid` is `expectedDiskUuid`. A signature with two such headers counts once. If the count is not exactly 1, the answer is `disk-duplicate`. This catches a cloned disk on USB, which `classifyDisk` ignores because it is external.
5. `firstStart` other than `complete` gives `first-start-pending`. That covers `unknown`.
6. Otherwise the answer is `ready`, with a frozen handle built from strings and numbers taken from the copy, so later changes to the observation cannot change it. The handle never leaves the gate except as the argument it hands to `verify` and `open`; no function accepts a handle from outside, so none needs to check that one is genuine.

**Test helpers.** Copy a small builder into the test (do not import from `disk-state.test.mjs`, which would run its tests twice): `waitronDisk({diskId, uuid, attachment})` gives §6's three partitions, as PR 1's `completeWaitronDisk()` does (`scripts/box/disk-state.test.mjs`), and `machine(disks, {tpm, secureBoot})` wraps them.

- [ ] **Step 1: Write the failing tests.** Every case asserts the whole result with `toEqual`.
  - `one internal Waitron disk whose header UUID is the expected one, firstStart complete → {kind:"ready", handle:{diskId, diskUuid, layoutVersion:1}}`, and the result and handle are frozen.
  - `primary header damaged, secondary valid → ready`, and `primary valid, secondary absent → ready`.
  - `tpm "disabled" and secureBoot "off" on that machine → still ready`.
  - `the observation is changed after freezing → the handle is unchanged`.
  - **Review Focus 2:**
    - `the Waitron disk's UUID differs from expectedDiskUuid → disk-mismatch`;
    - `an external disk carries a valid header with the expected UUID as well → disk-duplicate`;
    - `the installer stick carries it → disk-duplicate`;
    - `a foreign LUKS2 partition (subsystem "other") on the same disk also carries the expected UUID → disk-duplicate`. `classifyDisk` calls that disk `waitron` (re-map finding 16), so only rule 4 catches it;
    - `the expected UUID appears only on an external disk, and the internal disk is Windows → disk-not-waitron`;
    - `both headers damaged → disk-not-waitron`;
    - `two internal Waitron disks → disk-multiple`;
    - `no internal disk → disk-missing`;
    - `firstStart "pending" | "unknown" → first-start-pending`.
  - **Bad shapes,** each `observation-invalid`: `null`; an extra key; a missing `firstStart`; `firstStart: "done"`; an upper-case `expectedDiskUuid`; a `machine` that `classifyDisk` refuses (a disk id `"../sda"`); an observation holding a function; an observation whose `firstStart` is a getter that throws.
  - `a getter that answers "complete" the first time it is read and "pending" after → the answer follows one read only` (the copy), and the test counts the getter's reads as 1.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/preboot.test.mjs`. With `freezeUnlockTarget` exported as a stub that throws (see "Red means a named assertion failing"), expect each case to fail on its own assertion, not one import error or a fixture error.
- [ ] **Step 3: Implement** `freezeUnlockTarget`: pure, synchronous, no I/O.
- [ ] **Step 4: Run green.** Read the `Tests` count, then run the one-file coverage command for `preboot.mjs`.
- [ ] **Step 5: Deletion controls.** For each one, make the change, see the named test fail, then restore. Record each in the commit body.
  - Remove rule 3's UUID comparison → `disk-mismatch` fails.
  - Count only internal disks in rule 4 → the external-disk and installer-stick duplicate cases fail.
  - Count at most one signature per disk in rule 4 → the same-disk foreign-partition case answers `ready`.
  - Read `observation.firstStart` directly instead of from the copy → the getter case reads twice.
  - Accept `firstStart: "unknown"` → its case fails.
  - Bypass the copy and point the handle into the caller's own observation object → the "changed after freezing" case fails.
  - Refuse when `hardware` is not null → the TPM-disabled case fails, which shows the rule does not wrongly refuse a box that needs its key typed.
- [ ] **Step 6: Commit.** `git add scripts/box/preboot.mjs scripts/box/preboot.test.mjs && git commit -s -m "feat(box): decide which disk the preboot unlock may open"`. The commit body names the deletion controls and says the real observation, expected UUID and first-start state come from the Linux pull request.

### Task 2: the unlock gate, its shared wait and one check at a time

**Files:**
- Modify: `scripts/box/preboot.mjs` and `scripts/box/preboot.test.mjs`

**Interfaces:**
- Consumes: `freezeUnlockTarget` (Task 1).
- Produces:

```js
/** Proposed in spec §7.5, not chosen by the owner. */
export const UNLOCK_DELAYS_MS; // frozen [2000, 4000, 8000, 16000, 32000, 60000]
/**
 * @typedef {object} UnlockGateOptions
 * @property {unknown} observation  handed to freezeUnlockTarget; a refusal makes a refused gate, not a throw
 * @property {() => number} now  milliseconds on a clock that never jumps; production uses performance.now()
 * @property {(handle: UnlockHandle, key: Uint8Array) => Promise<boolean>} verify  must finish with key before it settles
 * @property {(handle: UnlockHandle, key: Uint8Array) => Promise<void>} open  must finish with key before it settles
 * @typedef {object} UnlockResult  frozen
 * @property {'opened'|'wrong-key'|'wait'|'refused-state'} kind
 * @property {number|null} retryAt  wrong-key and wait: the deadline on now()'s clock (monotonic, so the HTTP adapter sends time remaining, never this number); null while verify or open runs, and for opened and refused-state
 * @property {string|null} reason  refused-state only: a Task 1 refusal, or 'opened'|'closed'|'verifier-failed'|'open-failed'|'adapter-missing'
 * @typedef {object} UnlockStatus  frozen
 * @property {'ready'|'waiting'|'verifying'|'opened'|'closed'|'refused'} state  'verifying' while verify or open runs
 * @property {number|null} retryAt  waiting only
 * @property {string|null} reason  refused only
 * @typedef {{ submit(key: unknown): Promise<UnlockResult>, close(): void, status(): UnlockStatus }} UnlockGate  close() is for the preboot service's shutdown only (Task 3)
 */
/** Throws code "unlock.options_invalid", reason "options-invalid", when options is not exactly {observation, now, verify, open} with functions. @param {UnlockGateOptions} options @returns {UnlockGate} */
export function createUnlockGate(options);
```

**What `submit` does**, in order:

1. If the gate is refused, opened or closed: `refused-state` with that reason (`opened` and `closed` are their own reasons).
2. If `verify` or `open` is running: `wait`, `retryAt: null`. Neither is called again.
3. If `now() < retryAt`: `wait` with that `retryAt`. The failure count does not change.
4. If the key is not a `Uint8Array` of length 32 (malformed): count a failure, set `retryAt = now() + delay`, answer `wrong-key`. The checker is not called.
5. Otherwise call `verify(handle, key)` once. When it answers:
   - `false`: count a failure, set `retryAt` from `now()` read **after** the answer, answer `wrong-key`;
   - `true`: call `open(handle, key)` once; when it resolves, the gate is opened, answer `opened`;
   - a throw or any other value: the gate is refused with `verifier-failed`;
   - `open` throws: the gate is refused with `open-failed`, and `open` is never called again.

The delay after the n-th failure is `UNLOCK_DELAYS_MS[min(n, 6) - 1]`: 2, 4, 8, 16, 32, then 60 seconds for every later failure. A submission exactly at `retryAt` is checked. A gate whose target is refused answers every submission `refused-state` with the Task 1 reason, and its status is `refused` with that reason.

- [ ] **Step 1: Write the failing tests.** The test owns `let clock = 0; const now = () => clock;` and a `deferred()` helper for the checker.
  **The wait (Review Focus 1)**
  - `failed keys at 0, 2000 and 6000 → retryAt 2000, 6000 and 14000` (the parent plan's case).
  - `failing at each deadline from 14000 on → retryAt 30000, 62000, 122000, 182000` (the 60-second cap holds).
  - `a submission at 1999 → {kind:"wait", retryAt:2000, reason:null}`, the checker not called; then a failure at 2000 gets 4000, not 8000.
  - `a submission exactly at retryAt is checked`.
  - `two routes holding the same gate share the wait`: route A fails at 0; route B submits at 1000 and gets `wait` until 2000.
  - `a new gate after six failures on the old one → its first failure gets 2000` (a restart resets the wait).
  - `slow checker: submitted at 0, answers false at 1500 → retryAt 3500`.
  **One check at a time (Review Focus 1)**
  - `two submissions while the checker is pending → the checker is called once; the second gets {kind:"wait", retryAt:null}`.
  - `a submission while open is pending → {kind:"wait", retryAt:null}`. Before awaiting that second result, assert the checker has been called exactly once and the opener once, so the deletion control below fails on an assertion, not on a timeout; then resolve the opener, and the first submission's result is `opened`.
  - `a malformed submission while the checker is pending → wait, and the checker is still called once`.
  - `malformed submissions — a string, 31 bytes, 33 bytes, an Array of 32 numbers, null → wrong-key with retryAt 2000`, the checker never called.
  - `a malformed submission during a wait → wait`, and the failure count does not change.
  **Outcomes**
  - `checker answers true → open is called once with the same handle object and the same bytes; result {kind:"opened", retryAt:null, reason:null}; status opened`.
  - `the right key again after opening → {kind:"refused-state", reason:"opened"}`, with no further checker or opener calls.
  - `checker answers 1 | "true" | undefined → refused-state "verifier-failed"`; later submissions are refused with zero calls.
  - `checker throws → refused-state "verifier-failed"`.
  - `opener throws → refused-state "open-failed"`; the right key again calls neither.
  - `it.each` over every Task 1 refusal: `a gate made from that observation → refused-state with that reason, zero checker and opener calls; status {state:"refused", reason}`.
  - `checker and opener receive the frozen handle from Task 1, the same object every call`.
  **Status**
  - `status() is ready, then verifying while the checker is pending (and while the opener is pending), then waiting with retryAt after a failure, then ready again once now() reaches retryAt`.
  **Options**
  - `missing now | verify not a function | an extra key → throws unlock.options_invalid`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** `createUnlockGate` and `UNLOCK_DELAYS_MS`. No timers: status and the wait are computed from `now()`.
- [ ] **Step 4: Run green**, then run the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Keep one failure count per caller (a `Map` keyed by a submission counter) → the shared-wait case fails.
  - Remove the "verify or open is running" branch → the two-pending-submissions case calls the checker twice.
  - Clear the running flag when `verify` answers instead of when `open` settles → the submission-while-open case is checked.
  - Read `now()` before calling the checker → the slow-checker case fails.
  - Let malformed submissions through without counting them → the malformed cases fail.
  - Cap at `UNLOCK_DELAYS_MS[4]` → the 60-second case fails.
  - Treat a truthy answer as `true` → the `1` and `"true"` cases open.
  - Allow `open` after an `open-failed` → that case fails.
- [ ] **Step 6: Commit:** `feat(box): share one preboot unlock check and the proposed 2-60 second wait across every route`. The commit body says the numbers are the spec's proposal, not the owner's choice.

### Task 3: key buffers, close and the fixed gate

**Files:**
- Modify: `scripts/box/preboot.mjs` and `scripts/box/preboot.test.mjs`

**Interfaces:**
- Consumes: Task 2's gate.
- Produces: `close()` behaviour, and

```js
/** The one gate for this process. No verify or open adapter exists yet, so it is refused "adapter-missing". @returns {UnlockGate} */
export function prebootUnlockGate();
```

**Key ownership** (review I4). `submit(key)` keeps a copy only on the one path that calls `verify`:
- On that path (Task 2's step 5), before its first `await`, it copies the 32 bytes into a new array the gate owns, then fills the caller's array with zeros.
- On every other path (refused, opened, closed, running, waiting, malformed), it fills the caller's array with zeros if it is a `Uint8Array` of any length, keeps no copy, and answers.
- A string or other non-array key cannot be cleared; the gate refuses it as malformed and holds nothing. That is the limit of what the gate can do.

The gate's copy is handed to `verify` and then `open`, and filled with zeros when the last of them settles: on `opened`, `wrong-key`, `verifier-failed`, `open-failed`, and on `closed`.

**`close()`** (review I3) is for the preboot service's shutdown and teardown only. No screen button, network request or disconnecting browser calls it, because a closed gate stays closed until a restart; a person's "Cancel" on the screen just stops waiting for the answer and leaves the gate alone. `close()` does this:
- marks the gate closed, so every later submission answers `refused-state "closed"`;
- never wipes a copy that `verify` or `open` is still using; that copy is wiped when the call settles;
- if `verify` is running: when it settles, the copy is wiped, `open` is not called, and that submission answers `refused-state "closed"`;
- if `open` is already running: it finishes, and that submission's result stands and is reported (`opened`, or `refused-state "open-failed"`);
- `status()` reports `verifying` until a `verify` or `open` that was running at `close()` settles, then `opened` if the open succeeded and `closed` otherwise;
- a submission made in that window answers `refused-state "closed"` (Task 2's rule 1 comes before its rule 2);
- after opening, or a second time: changes nothing;
- on a refused gate, including the fixed `prebootUnlockGate()`: changes nothing, and the gate stays refused with its reason.

**The fixed gate** (review M3) follows PR 1's `fixedStore` (`scripts/box/disk-key.mjs`, end of file): `prebootUnlockGate()` is built once by the same internal constructor `createUnlockGate` uses, given a target seam that is called once and answers refused `adapter-missing`. No stub `verify`, `open` or clock is written for it: a refused gate never calls them, and an uncalled stub would be an uncovered function.

- [ ] **Step 1: Write the failing tests.** Use 32 **different** bytes, `(i * 7 + 3) % 256` for i from 0 to 31, as PR 1 does (`scripts/box/disk-key.test.mjs:19`).
  - `it.each` over opened, wrong-key, wait during a delay, wait while verify runs, wait while open runs, refused-state, closed, a 31-byte array: `the caller's array is all zeros as soon as submit returns its promise, before it is awaited`.
  - `it.each` over wait during a delay, wait while verify runs, refused-state, closed, malformed: `no copy is made`. The implementation makes its one copy with `Uint8Array.from(key)` and no other way; the test wraps `Uint8Array.from` with `vi.spyOn`, keeps every array it returns, and asserts none was made on these paths.
  - `every array Uint8Array.from returned during a verify-path submission is zeros once submit settles`.
  - `the checker receives the original bytes in an array that is not the caller's`, and the opener receives that same array.
  - `it.each` over opened, wrong-key, checker throws, opener throws: `the array the checker received is all zeros once submit settles`.
  - `close while the checker is pending → the array the checker holds still has its bytes right after close() (the test reads it before resolving the checker); the checker then answers true; open is never called; the result is refused-state "closed"; the array is zeros`.
  - `close while the opener is pending → the array the opener holds still has its bytes right after close(); status() is verifying; the opener resolves; the result is {kind:"opened"}; status opened; the array is zeros`.
  - `close while the opener is pending, and the opener then throws → the result is refused-state "open-failed"; status closed`.
  - `close while the opener is pending, then a second submission → refused-state "closed"`, the checker and opener each still called once.
  - `close on a gate whose target was refused → status still {state:"refused", reason}`; `close on prebootUnlockGate() → status still refused "adapter-missing"`.
  - `close, then submit → refused-state "closed"`; `close twice → status closed`; `close after opened → status still opened`.
  - `prebootUnlockGate() returns the same object twice; its status is {state:"refused", reason:"adapter-missing"}; submit gives refused-state "adapter-missing", zeroes the caller's array and makes no copy`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green**, then run the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Hand the caller's array to the checker instead of a copy → "not the caller's" fails.
  - Copy the key at the top of `submit`, before the state checks → the "no copy is made" cases fail.
  - Remove the `finally` that zeroes the copy → the "zeros once submit settles" cases fail.
  - Zero the caller's array after the first `await` → the "before it is awaited" cases fail.
  - Wipe the copy inside `close()` → both "still has its bytes right after close()" cases fail.
  - Remove the closed check after the checker answers → the close-while-verifying case calls `open`.
  - Report `closed` instead of the opener's result → the close-while-opening case fails.
  - Build a new gate on every `prebootUnlockGate()` call → its same-object case fails.
- [ ] **Step 6: Commit:** `feat(box): clear every copy of a typed disk key when its preboot attempt ends`. The commit body says `close()` is for shutdown only, and that these checks do not show what the browser, the operating system or `cryptsetup` keep (parent Task 1.3: "These checks do not prove all browser/OS copies erased").

### Task 4: key-leak sweep for the gate

**Files:**
- Modify: `scripts/box/preboot.test.mjs` (a new `describe` block). Change `preboot.mjs` only if the sweep finds a leak.

**Interfaces:**
- Consumes: `createUnlockGate` and `prebootUnlockGate` (Tasks 2 and 3).
- Produces: nothing new.

**The key and its search forms.** Copy PR 1's form list into this suite (`scripts/box/disk-key.test.mjs:1227-1267`): lowercase and uppercase hex, spaced hex, base64, base64url, the decimal lists joined with `", "` and `","`, `JSON.stringify` of the array, every 8-byte window of each, and the raw bytes. Do not edit PR 1's suite, and do not move the list into a shared `.mjs` file: root coverage measures every `scripts/**/*.mjs` (`vitest.config.ts:119`).

- [ ] **Step 1: Write the sweep.** Run every path from Tasks 2 and 3:
  - each result kind and each refused reason;
  - a checker and an opener that throw an error holding the key in its message as hex, as base64 and as raw bytes, as a property, and as the thrown value itself;
  - a checker that answers with the key itself instead of a boolean;
  - `close()` while `verify` runs and while `open` runs;
  - the fixed `prebootUnlockGate`.

  While doing so, spy on `console.*`, `process.stdout.write` and `process.stderr.write`. Collect every result, every `status()` taken before and after each step, and every thrown error's `message`, `stack`, `JSON.stringify(error)` and `util.inspect(error, { depth: 10 })`. Collect `util.inspect(gate, { depth: 10, showHidden: true })` after each step, and also while `verify` is pending, while `open` is pending, and just after `close()` (review M1): after a step the copy is already zeros, so only these moments can show a copy kept on the gate. Register a `process.on("unhandledRejection")` listener for the whole block and collect what it receives. Node reports an unhandled rejection only after a full turn of the event loop (the checker's Vitest probe: nothing after a microtask, one report after `setImmediate`), so before asserting, `await new Promise((resolve) => setImmediate(resolve))`. Take `JSON.stringify(process.env)` and `process.argv` before and after. Collapse runs of whitespace before matching the decimal forms, as PR 1 does.

  Assert:
  - no form appears in any collected value;
  - no console, stdout or stderr call happened;
  - the `unhandledRejection` listener received nothing;
  - `process.env` and `process.argv` are unchanged and hold no form;
  - `preboot.mjs`'s import lines name only `./disk-state.mjs` and `./upgrades/contracts.mjs`. This reads the file as text, so it is weaker than "the gate writes no file": it shows only that the gate imports no file or process module.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/box/preboot.test.mjs`. If the sweep fails on today's code, fix the leak and say so in the commit.
- [ ] **Step 3: Deletion controls (proving the sweep catches leaks).** For each, make the change, see the sweep fail, then restore:
  - add `key` to the `wrong-key` result object;
  - put the checker's error message into the `verifier-failed` reason;
  - `console.log` the copied key in `submit`;
  - set `process.env.WAITRON_LAST_KEY` to the key's hex;
  - keep the last copied key on the gate object as a property (`gate.lastKey = copy`) → the `util.inspect(gate)` check fails;
  - keep awaiting `verify`, and also attach an extra `.then(() => {})` with no `catch` to its promise, so a throwing checker's rejection goes unhandled on that branch → the listener check fails.
- [ ] **Step 4: Run the coverage command** for `preboot.mjs` again. It is unchanged unless a leak was fixed.
- [ ] **Step 5: Commit:** `test(box): sweep every preboot unlock path for the typed key in any form`. The commit body states the limit: this proves what the gate returns, throws, logs and sets, not what a real adapter, the browser or the operating system keeps.

### Task 5: the two locked certificates

**Files:**
- Create: `scripts/box/preboot-locked.mjs`
- Test: `scripts/box/preboot-locked.test.mjs`

**Interfaces:**

```js
export const BOX_NAME; // "waitron.local"
/**
 * @typedef {object} LockedIdentityInput  every certificate is public PEM text; no private key is ever an input
 * @property {string} installationId  1-56 lowercase letters or digits (re-map finding 7)
 * @property {string} caCertificate  the box CA's public certificate
 * @property {string} recoveryCertificate  the per-disk recovery leaf
 * @property {string} redirectCertificate  the untrusted redirect-only certificate
 * @property {number} now  wall-clock milliseconds since 1970, for the validity dates
 * @typedef {object} LockedTarget  frozen
 * @property {string} recoveryHost  "unlock-<installationId>.waitron.local"
 * @property {string} recoveryUrl  "https://unlock-<installationId>.waitron.local/"
 * @property {'ready'|'refused'} redirect
 * @property {string|null} redirectRefusal
 * @typedef {{ kind: 'ready', target: LockedTarget } | { kind: 'refused', reason: string }} LockedTargetResult  frozen
 */
/** Pure apart from parsing. Throws code "recovery_identity.input_invalid", reason "input-invalid", when input is not exactly these five keys with these types (now a finite number). A string that is not a certificate is a refusal, not a throw. @param {LockedIdentityInput} input @returns {LockedTargetResult} */
export function freezeLockedTarget(input);
```

**Checks.** A certificate input is accepted only if it is exactly one PEM certificate block and nothing else: `-----BEGIN CERTIFICATE-----`, base64 lines, `-----END CERTIFICATE-----`, one optional final line ending (re-map finding 9). Lines end in `\n` or in `\r\n`, the same throughout the block; a block that mixes the two is refused (review I2). Then:

| Order | `reason` (whole result refused: no remote unlock, local screen only) | When |
| --- | --- | --- |
| 1 | `installation-id-invalid` | Not 1–56 characters of `[a-z0-9]`. |
| 2 | `certificate-unreadable` | The CA or recovery input is not one PEM certificate block, or `X509Certificate` cannot parse it. |
| 3 | `ca-invalid` | The CA certificate is not a CA (`ca` is false) or does not verify with its own public key. |
| 4 | `recovery-not-ca-signed` | The recovery certificate fails `checkIssued(ca)` **or** `verify(ca.publicKey)` (re-map finding 8). |
| 5 | `recovery-is-ca` | The recovery certificate is itself a CA. |
| 6 | `recovery-same-key` | Its public key equals the CA's (`KeyObject.equals`). Its private key sits unencrypted on the boot partition, so sharing the CA's key pair would put the CA's signing key there (review I1). |
| 7 | `recovery-names-wrong` | Its `subjectAltName` is not exactly `DNS:<recoveryHost>` (re-map finding 10). |
| 8 | `recovery-expired` | `now` is before its `validFromDate` or after its `validToDate`. |
| 9 | `recovery-outlives-ca` | Its `validToDate` is after the CA's (spec §7.5: "Refuse a leaf that outlives the CA"). |

| `redirectRefusal` (redirect alone refused: HTTPS `waitron.local` gets no certificate; HTTP and the recovery address still work) | When |
| --- | --- |
| `certificate-unreadable` | Not one PEM certificate block, or unparseable. |
| `redirect-ca-signed` | It verifies with the CA's public key. That covers the normal server certificate, the recovery certificate and the CA certificate itself. |
| `redirect-not-self-signed` | It does not verify with its own public key, so some other authority signed it (review M9). |
| `redirect-is-ca` | It is a CA. |
| `redirect-names-wrong` | Its `subjectAltName` is not exactly `DNS:waitron.local`. |
| `redirect-same-key` | Its public key equals the recovery certificate's or the CA's (`KeyObject.equals`). |

The redirect certificate's dates are not checked: it is untrusted anyway, so an expired one still gives the person the one warning the owner accepted. The recovery certificate's dates are checked against the box's own clock; a box whose clock is wrong refuses a good certificate and sends the person to the local screen, which is the safe direction.

Two decisions here, both the conservative reading: a bad recovery certificate turns off every remote route (a redirect to an address that cannot be trusted helps nobody), while a bad redirect certificate turns off only HTTPS `waitron.local`, so the sheet's full address and `http://waitron.local` still work.

**Fixtures.** Write one shell script into a temporary folder in `beforeAll` and run it once with `execFileSync("sh", [script], { cwd, timeout: 20_000 })`, with the hook's own bound at 30 000 ms. If `openssl` is missing the hook fails; it never skips. Use EC P-256 keys, `openssl req -x509 … -addext` for self-signed certificates and `openssl x509 -req … -extfile` for CA-signed ones. The planner ran this shape on 2026-11-03: eight certificates in 0.08 seconds with OpenSSL 4.1.0, and the same commands worked with macOS's LibreSSL 3.3.6. CI's Ubuntu runner has `openssl`: `.github/workflows/image-smoke.yml:206-210` runs it on `ubuntu-latest` (`:23`). That is a reading-level receipt; no passing run was looked up. `apps/server/src/name-constraints.test.ts:13-22` also uses it but skips when it is missing, so its passing is no receipt. The set:
- `ca`: self-signed, `CA:TRUE`, name constraint `permitted;DNS:waitron.local`, 30 days;
- `recovery`: signed by `ca`, SAN `DNS:unlock-a1b2.waitron.local`, 7 days;
- `normal`: signed by `ca`, SAN `DNS:waitron.local,IP:192.168.1.5` (stands in for the encrypted normal server certificate);
- `withBoxName`: signed by `ca`, SAN `DNS:unlock-a1b2.waitron.local,DNS:waitron.local`;
- `withAddress`: signed by `ca`, SAN `DNS:unlock-a1b2.waitron.local,IP:192.168.1.5`;
- `otherId`: signed by `ca`, SAN `DNS:unlock-zz99.waitron.local`;
- `longLived`: signed by `ca`, 60 days;
- `leafAsCa`: signed by `ca`, SAN the recovery address, `CA:TRUE`;
- `impostorCa`: self-signed with the **same subject name** as `ca` and its own key, and `impostorRecovery` signed by it with the recovery SAN;
- `redirect`: self-signed, SAN `DNS:waitron.local`, `CA:FALSE`;
- `redirectAsCa`: self-signed, SAN `DNS:waitron.local`, `CA:TRUE`;
- `redirectWrongName`: self-signed, SAN `DNS:example.test`;
- `redirectSameKey`: self-signed with the **recovery** key, SAN `DNS:waitron.local`;
- `recoverySameKey`: signed by `ca`, SAN the recovery address, made from a request signed with **`ca`'s own key**, so it carries the CA's public key;
- `redirectByImpostor`: signed by `impostorCa`, SAN `DNS:waitron.local`, `CA:FALSE`;
- `rsaCa` and `rsaRecovery`: the same as `ca` and `recovery` but with RSA-2048 keys (`-newkey rsa:2048`), as the real box CA uses. The test turns both into `\r\n` text with `.replace(/\n/g, "\r\n")`, which is the shape node-forge writes (re-map finding 9).

The tests read each certificate's real dates with `new X509Certificate(pem).validFromDate` and choose `now` from them, never from the wall clock.

- [ ] **Step 1: Write the failing tests.**
  - `the valid set → {kind:"ready", target:{recoveryHost:"unlock-a1b2.waitron.local", recoveryUrl:"https://unlock-a1b2.waitron.local/", redirect:"ready", redirectRefusal:null}}`, frozen.
  - `a 56-character id → ready`, and the test asserts `"unlock-" + id` is 63 characters; `"" | 57 characters | "A1B2" | "a-b2" | "a.b2" → installation-id-invalid`.
  - **Review Focus 4:**
    - `recovery PEM with the CA's private key appended → certificate-unreadable`, and the result's `JSON.stringify` holds no `PRIVATE KEY` text;
    - `two certificates concatenated | a private key alone | "garbage" → certificate-unreadable`;
    - `impostorRecovery (issuer name matches, another key signed it) → recovery-not-ca-signed`;
    - `withBoxName → recovery-names-wrong`; `withAddress → recovery-names-wrong`; `otherId → recovery-names-wrong`; `normal as the recovery certificate → recovery-names-wrong`;
    - `normal as the redirect certificate → ready, redirect "refused", redirectRefusal "redirect-ca-signed"`; the same for `recovery` and for `ca` as the redirect certificate;
    - `redirectAsCa → redirect-is-ca`; `redirectWrongName → redirect-names-wrong`; `redirectSameKey → redirect-same-key`; `"garbage" → certificate-unreadable`.
  - `the recovery certificate passed as the CA → ca-invalid`; `leafAsCa → recovery-is-ca`; `recoverySameKey → recovery-same-key`.
  - **The real box CA's shape:** `rsaCa and rsaRecovery, both with \r\n line endings → ready`; `the same with \n → ready`; `rsaRecovery with one line ending changed to \n among \r\n → certificate-unreadable`.
  - `redirectByImpostor → ready, redirect "refused", redirectRefusal "redirect-not-self-signed"`.
  - `now one second before validFrom | one second after validTo → recovery-expired`; `longLived → recovery-outlives-ca`.
  - `a missing key | an extra key | a non-string certificate | now NaN → throws {code:"recovery_identity.input_invalid", reason:"input-invalid"}`.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/preboot-locked.test.mjs`.
- [ ] **Step 3: Implement** `freezeLockedTarget` and `BOX_NAME`.
- [ ] **Step 4: Run green**, the one-file coverage command for `preboot-locked.mjs`, and `pnpm exec vitest run scripts/spawn-timeout-budget.test.ts`. That guard reads text, and for this shape (one `execFileSync` inside a `beforeAll`) it returns "unreadable" and declines to judge it (the round-3 checker's run), so passing it says nothing about this suite (review M2). What matters is the hook's own 30 000 ms bound. The root config sets only `testTimeout: 30_000` (`vitest.config.ts:96`) and no hook timeout, and Vitest 4.1.12's default hook timeout is 10 seconds (`hookTimeout ??= resolved.browser.enabled ? 3e4 : 1e4`, confirmed by the round-3 checker).
- [ ] **Step 5: Deletion controls.**
  - Use `checkIssued(ca)` alone for rule 4 → the impostor case fails.
  - Drop the one-block rule → the appended-private-key case loads.
  - Accept a SAN list that merely contains the recovery address → `withBoxName` and `withAddress` load.
  - Remove the redirect's CA-signature check → all three "redirect-ca-signed" cases load.
  - Drop rule 9 → `longLived` loads.
  - Drop rule 6 → `recoverySameKey` loads.
  - Drop the self-signed check → `redirectByImpostor` gives `redirect: "ready"`.
  - Accept `\n` endings only → the `\r\n` RSA case is refused.
  - Accept any mix of endings → the mixed case loads.
- [ ] **Step 6: Commit:** `feat(box): check the two certificates a locked box shows before it listens`. The commit body says the files are read and the TLS contexts built by the Linux pull request, and that Android Chrome qualification is UNVERIFIED / NOT RUN.

### Task 6: what a locked box answers

**Files:**
- Modify: `scripts/box/preboot-locked.mjs` and `scripts/box/preboot-locked.test.mjs`

**Interfaces:**
- Consumes: `LockedTargetResult` (Task 5). `freezeLockedTarget` adds every result it returns, ready or refused, to a module-level `WeakSet`; both functions below throw for any other object, so a hand-built target cannot reach them (review M6).
- Produces:

```js
/** For the TLS adapter's name callback. Throws code "locked_request.invalid", reason "target-invalid", when result is not from freezeLockedTarget. @param {LockedTargetResult} result @param {string|undefined} serverName @returns {'recovery'|'redirect'|null} */
export function selectLockedIdentity(result, serverName);
/**
 * @typedef {object} LockedRequest  exactly these keys: no path, query, headers or body ever reaches the decision
 * @property {'http'|'https'} scheme
 * @property {'recovery'|'redirect'|null} identity  null for http; for https, what selectLockedIdentity chose
 * @property {string|null} host  the request's Host header as received
 * @property {string} method
 * @typedef {{kind:'redirect', status:302, headers:{location:string, 'cache-control':'no-store'}}
 *   | {kind:'refuse', status:405, headers:{allow:'GET, HEAD', 'cache-control':'no-store'}}
 *   | {kind:'refuse', status:421, headers:{'cache-control':'no-store'}}
 *   | {kind:'explain', status:503, code:'unlock.remote_unavailable', reason:string, headers:{'cache-control':'no-store'}}
 *   | {kind:'unlock'}} LockedDecision  frozen; 'unlock' hands the request to the trusted key screen (not built here)
 */
/**
 * Throws code "locked_request.invalid" with reason "target-invalid" (result not from freezeLockedTarget),
 * "request-invalid" (any other request shape), or "identity-unavailable" (an https request naming an
 * identity the result does not offer: anything on a refused result, or 'redirect' when the redirect is refused).
 * @param {LockedTargetResult} result @param {LockedRequest} request @returns {LockedDecision}
 */
export function decideLockedRequest(result, request);
```

**`selectLockedIdentity`.** A refused result gives `null` for every name: no certificate is served, so the adapter does not listen on 443 at all. On a ready result the name is compared in lower case, so a name sent in capitals gets the same answer as in lower case (a decision; no source is cited for how browsers send it). The recovery address gives `recovery`. `waitron.local` gives `redirect` when `target.redirect` is `ready`, otherwise `null`. Anything else gives `null`, and the adapter ends the handshake: no name, an empty name, an IP address (RFC 6066: "Literal IPv4 and IPv6 addresses are not permitted in 'HostName'"), a trailing dot (RFC 6066: the name is sent "without a trailing dot"), or another name.

**`decideLockedRequest` on a ready result.** The host is compared in lower case, after removing the scheme's own default port (`:80` for http, `:443` for https). Any other port, an IP address, or a missing host does not match.

| Scheme and certificate | Host | GET or HEAD | Any other method |
| --- | --- | --- | --- |
| http | `waitron.local` or the recovery address | 302 to `recoveryUrl` | 405 |
| http | anything else | 421 | 421 |
| https, redirect certificate | anything | 302 to `recoveryUrl` | 405 |
| https, recovery certificate | the recovery address | `unlock` | `unlock` |
| https, recovery certificate | anything else | 421 | 421 |

The redirect certificate never leads to `unlock`, whatever the `Host` header says. That is the case where a browser asks for `waitron.local` in the handshake (getting the untrusted certificate) and then for the recovery address in its `Host` header. No decision has a body: neither redirect route ever offers a form. The parent plan names only `waitron.local` on plain HTTP. Here the recovery address on plain HTTP also redirects to the same fixed URL, which accepts nothing (a decision).

**`decideLockedRequest` on a refused result** (review I6). A box whose recovery certificate is refused would otherwise answer nothing over the network, and a person at a headless box would not know why. CLAUDE.md §3 says a refusal explains what happened. So plain HTTP, whatever the host, answers GET and HEAD with `explain`: status 503, the fixed code `unlock.remote_unavailable`, and the Task 5 refusal `reason` (none of the reasons is secret). The words, in the preboot screen's English and Spanish translation files, say that unlocking from another device is unavailable on this box and that the key goes in on the box's own screen, with a display and keyboard plugged in if it has none. That pull request writes them (see "Out"). Any other method gets 405. The answer carries no form, no link and no address.

- [ ] **Step 1: Write the failing tests.** Results come from Task 5's fixtures through `freezeLockedTarget`.
  - `selectLockedIdentity`: `"unlock-a1b2.waitron.local" → recovery`; `"UNLOCK-A1B2.WAITRON.LOCAL" → recovery`; `"waitron.local" → redirect`; the same with `redirect: "refused" → null`; `undefined | "" | "192.168.1.5" | "waitron.local." | "other.waitron.local" | "unlock-zz99.waitron.local" → null`; `a refused result, any of those names → null`.
  - Every row of the table, as `it.each`, asserting the whole decision with `toEqual`. Methods: `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, and lower-case `get` (405: methods are case-sensitive).
  - Hosts: `waitron.local`, `WAITRON.LOCAL`, `waitron.local:80` (http), `waitron.local:443` (https), `waitron.local:8080`, the recovery address, `192.168.1.5`, `[::1]`, `evil.example`, `null`.
  - **Review Focus 5:**
    - `https, redirect certificate, Host the recovery address, POST → 405`, and with GET → 302, never `unlock`;
    - `http, waitron.local, POST → 405 with no location`;
    - `every redirect's location is target.recoveryUrl`, over every host and both schemes;
    - `a request with an extra key — path | query | url | body | headers → throws {code:"locked_request.invalid", reason:"request-invalid"}`;
    - `http with identity "redirect" | https with identity null | scheme "ftp" → request-invalid`.
  - **Genuine results (M6):** `a copy of a ready result ({...result}) | a hand-built {kind:"ready", target:{…}} → throws target-invalid`, for both functions; `https with identity "redirect" on a result whose redirect is refused → throws identity-unavailable`.
  - **Refused result (I6):** `it.each` over the Task 5 refusal reasons: `http GET, any host → {kind:"explain", status:503, code:"unlock.remote_unavailable", reason, headers:{"cache-control":"no-store"}}`; `http POST → 405`; `https with identity "recovery" or "redirect" → throws identity-unavailable`.
  - `every decision is frozen, and each kind has exactly the keys in its type`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green**, then run the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Drop the exact-key check on the request → the extra-key cases are accepted.
  - Drop the `WeakSet` check → the hand-built and copied results are accepted.
  - Answer 308 → the redirect rows fail.
  - Route `https` by the `Host` header instead of the certificate → the redirect-certificate-with-recovery-Host case gives `unlock`.
  - Skip the Host check for the recovery certificate → its "anything else" row gives `unlock`.
  - Redirect a POST → the 405 rows fail.
  - Answer 421 instead of `explain` on a refused result → the I6 cases fail.
  - Accept `identity: "redirect"` when the redirect is refused → its throw case fails.
- [ ] **Step 6: Commit:** `feat(box): send a locked box's waitron.local to its one recovery address, and explain when there is none`.

### Task 7: the Wi-Fi record format

**Files:**
- Create: `scripts/box/wifi-record.mjs`
- Test: `scripts/box/wifi-record.test.mjs`

**Interfaces:**

```js
export const WIFI_RECORD_MAX_BYTES; // 1024
/**
 * @typedef {object} WifiNetwork  frozen
 * @property {string} ssidHex  the network name's bytes as lowercase hex, 1-32 bytes
 * @property {'wpa-psk'|'sae'} keyMgmt
 * @property {string} psk  the password
 * @property {boolean} hidden
 * @typedef {{kind:'loaded', network: WifiNetwork} | {kind:'refused', reason:'record-oversized'|'record-corrupt'|'record-unsupported'}} WifiParseResult  frozen
 */
/** Pure. Throws code "wifi_record.input_invalid", reason "input-invalid", when bytes is not a Uint8Array. @param {Uint8Array} bytes @returns {WifiParseResult} */
export function parseWifiRecord(bytes);
```

**Version 1, exact bytes.** `JSON.stringify({version:1, ssidHex, keyMgmt, psk, hidden})` with keys in that order, plus one newline, encoded as UTF-8, at most 1024 bytes.

- `ssidHex`: `/^(?:[0-9a-f]{2}){1,32}$/`. Hex, because a network name is up to 32 arbitrary bytes and need not be valid UTF-8 (NetworkManager, re-map finding 12).
- `keyMgmt` `wpa-psk`: `psk` is 8–63 characters from space to `~` (0x20–0x7E), or exactly 64 hex digits in either letter case, as NetworkManager's `g_ascii_isxdigit` check accepts both (`nm-utils.c:1249-1254`). The record keeps the case the writer used. A password with a character outside printable ASCII is `record-unsupported` (rule 8): a gap for task 3.1 to report (re-map finding 12), not a safe default.
- `keyMgmt` `sae`: `psk` is 1–256 UTF-8 bytes, well-formed (no lone surrogate), with no control character (U+0000–U+001F or U+007F). The 256-byte bound is this plan's choice; NetworkManager sets none.
- `hidden`: a boolean.

**Order of checks.**
1. More than 1024 bytes → `record-oversized`.
2. Not valid UTF-8 → `record-corrupt`. Decode with `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`; a byte-order mark then stays in the text, and `JSON.parse` refuses it at rule 3.
3. Not JSON, not a plain object, or `version` not a whole number → `record-corrupt`.
4. `version` other than 1 → `record-unsupported`, whatever else the record holds.
5. Keys other than exactly the five → `record-corrupt`.
6. The bytes are not exactly the canonical form → `record-corrupt`. This compares **bytes**: the parsed fields go back through `JSON.stringify` in the fixed key order, plus a newline, are encoded with `TextEncoder`, and must equal the input byte for byte. Rules 2 and 6 each refuse a record with a bad byte on their own: a non-fatal decoder would turn 0xFF into U+FFFD, which re-encodes as the three bytes EF BF BD, so the byte comparison still differs. Only a non-fatal decoder together with a string comparison would load a different password.
7. `keyMgmt` a string other than `wpa-psk` or `sae` → `record-unsupported` (for example `none`, `wpa-eap`, `owe`, `WPA-PSK`); not a string → `record-corrupt`.
8. `keyMgmt` `wpa-psk` with a `psk` of 8–63 characters that holds a character outside 0x20–0x7E, and is not the 64-hex-digit form → `record-unsupported`, so task 3.1 can say why the copy was refused rather than calling it damaged (review round 3).
9. Any other field rule fails → `record-corrupt`.

- [ ] **Step 1: Write the failing tests.** The test builds records with a `recordBytes(fields)` helper that writes the canonical form.
  - **Loads:** a WPA2 record; a WPA3 record whose password is `"contraseña Àngels"`; a 32-byte network name; passwords of 8 and 63 characters; a 64-hex-digit password in lower case and the same in upper case; `hidden: true`. Each asserts the whole result, frozen.
  - `the largest valid record — a 32-byte name and a 256-byte WPA3 password of '"' characters, which JSON doubles — is under 1024 bytes and loads` (assert its length).
  - **Oversized:** `1025 bytes → record-oversized`, even when the first 1024 are a valid record.
  - **Corrupt:** invalid JSON; extra spaces; keys in another order; no final newline; an extra key; a missing key; `ssidHex` odd length, upper case, empty, or 33 bytes; a WPA2 password of 7 characters, 64 non-hex characters, or 65 characters; a WPA3 password empty, of 257 bytes, holding U+0000, holding U+001F, or written as `"\ud800"`; `hidden: "false"`; a 0xFF byte inside a **`sae`** record's password (a `wpa-psk` password would be refused by its printable-ASCII rule anyway, so it would not prove the decoder; review M5); a byte-order mark before the record; `version: "1"`; `version: 1.5`; `keyMgmt: 7`.
  - **Unsupported:** a WPA2 password of 8–63 characters holding a tab, and one holding `ñ`; `version: 2` with otherwise valid fields; `version: 2` with extra keys; `version: 0`; `keyMgmt` `"none"`, `"wpa-eap"`, `"owe"`, `"WPA-PSK"`.
  - `a string or an Array → throws {code:"wifi_record.input_invalid", reason:"input-invalid"}`.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/wifi-record.test.mjs`.
- [ ] **Step 3: Implement** `parseWifiRecord` and `WIFI_RECORD_MAX_BYTES`.
- [ ] **Step 4: Run green**, then run the coverage command for `wifi-record.mjs`.
- [ ] **Step 5: Deletion controls.**
  - Decode with `Buffer.from(bytes).toString("utf8")` **and** compare strings instead of bytes in rule 6 → the `sae` 0xFF case loads (with U+FFFD in its password). Each change alone still refuses it; run both singly too and record that they do.
  - Answer `record-corrupt` for rule 8 → the tab and `ñ` cases fail.
  - Accept lower-case hex only for the 64-digit form → the upper-case case is refused.
  - Drop the canonical comparison → the extra-spaces and key-order cases load.
  - Drop the well-formed check → the lone-surrogate case loads.
  - Check keys before the version → `version: 2` with extra keys gives `record-corrupt` instead of `record-unsupported`.
  - Drop the size check → the 1025-byte case gives `record-corrupt` instead of `record-oversized`.
- [ ] **Step 6: Commit:** `feat(box): define the boot copy's one Wi-Fi record and refuse every other shape`. The commit body says task 3.1's writer must produce exactly this format, and names the gap: open, WEP, enterprise and OWE networks, and WPA2 passwords outside printable ASCII, get no Wi-Fi unlock in version 1.

### Task 8: reading the one fixed Wi-Fi file

**Files:**
- Modify: `scripts/box/wifi-record.mjs` and `scripts/box/wifi-record.test.mjs`

**Interfaces:**
- Consumes: `parseWifiRecord` (Task 7).
- Produces:

```js
export const BOOT_ROOT; // "/boot"; the Linux pull request confirms where the startup image mounts it
/**
 * @typedef {{ bootRoot: string, rootId: string }} BootMountIdentity  rootId is "<dev>:<ino>" of bootRoot
 * @typedef {object} WifiReaderDeps
 * @property {string} bootRoot  absolute and equal to its own path.resolve (checked at construction); being equal to its realpath is the caller's duty, not checked
 * @property {number} ownerUid  0 in production; tests pass process.getuid()
 * @property {() => Promise<BootMountIdentity>} inspectBootMount
 * @property {{ lstat: typeof fs.lstat, open: typeof fs.open }} [io]  test-only override; the reader has no other file operation
 * @typedef {{kind:'loaded', network: WifiNetwork} | {kind:'absent'} | {kind:'refused', reason: string}} WifiReadResult  frozen
 */
/**
 * Throws code "wifi_record.deps_invalid", reason "deps-invalid", at construction when deps is not exactly these keys
 * (io optional): bootRoot an absolute path equal to its own path.resolve, ownerUid a non-negative safe integer,
 * inspectBootMount a function, io (if given) an object whose lstat and open are functions. Nothing is read first.
 * @param {WifiReaderDeps} deps @returns {{ read(): Promise<WifiReadResult> }}
 */
export function createWifiRecordReader(deps);
/** Fixed production entry point. No boot-mount check exists until the Linux pull request, so it answers refused "mount-unverified" with no file call. */
export async function readActiveWifiRecord();
```

**Sequence** (the record is `<bootRoot>/waitron-recovery/wifi.json`):

| # | Outcome | When |
| --- | --- | --- |
| 1 | refused `mount-unverified` | `inspectBootMount` throws, or its answer is not exactly `{bootRoot, rootId}` with `bootRoot` equal to the configured one and `rootId` matching `/^\d+:\d+$/`. No file call is made. |
| 2 | refused `mount-unverified` | `lstat(bootRoot)` answers `ENOENT`. |
| 3 | refused `root-changed` | `lstat(bootRoot)`'s `dev:ino` differs from `rootId`. |
| 4 | refused `path-unsafe` | `bootRoot` or `waitron-recovery` is a symlink or not a folder; `wifi.json` is a symlink (`ELOOP`), not a regular file, or has more than one hard link. |
| 5 | refused `permissions-unsafe` | `bootRoot` is not owned by `ownerUid` or is writable by group or others (`mode & 0o022`); `waitron-recovery` or `wifi.json` is not owned by `ownerUid` or `mode & 0o077` is not 0. `/boot` is normally `0755`, so the first rule is looser than the other two. |
| 6 | `absent` | `waitron-recovery` or `wifi.json` does not exist. A cable-only box has no record. |
| 7 | refused `record-oversized` | The handle's `stat().size` is over 1024, or more than 1024 bytes come back from the read. Read through the handle into a buffer of 1025 bytes, never `readFile`, so a file that grows after the `stat` cannot make the reader read more. |
| 8 | `parseWifiRecord`'s answer | Otherwise. |
| — | refused `io-failed` | Any other file error. The error itself is never kept. |

Open `wifi.json` with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, as `disk-key.mjs` opens its record. `wifi.json.next` is never opened, whatever state `wifi.json` is in.

- [ ] **Step 1: Write the failing tests.** The fixture makes `bootRoot` (mode `0755`), `waitron-recovery` (mode `0700`) and a `0600` record in a temporary folder, with a counting `io` that records every `lstat` and `open` path, and a stand-in mount check returning the folder's real `dev:ino` captured when the fixture is created.
  - `a valid record → loaded`, and the counting io opened exactly one path, `…/waitron-recovery/wifi.json`.
  - `no waitron-recovery folder → absent`; `no wifi.json → absent`.
  - **Review Focus 6:**
    - `only a valid wifi.json.next → absent`, and `.next` was never opened;
    - `a corrupt wifi.json beside a valid wifi.json.next → refused record-corrupt`, `.next` never opened;
    - `ca.key, server.key and recovery.key files beside wifi.json → loaded`, and none of them was opened or `lstat`ed;
    - `wifi.json is a symlink to a valid record → path-unsafe`; `waitron-recovery is a symlink to a folder holding one → path-unsafe`; `wifi.json is a folder → path-unsafe`; `wifi.json has a second hard link → path-unsafe`;
    - `wifi.json is a FIFO → path-unsafe, and the read does not hang` (use PR 1's `settleOrRelease` helper, `scripts/box/disk-key.test.mjs:41-68`, copied);
    - `stat reports 100 bytes but the read returns 2000 → record-oversized` (wrap `io.open` so the handle's `stat` lies);
    - `a 1025-byte file → record-oversized`, and the handle read no bytes.
  - **The mount check:** `the stand-in throws | answers with an extra key | a missing rootId | rootId "x" | another bootRoot → mount-unverified, zero io calls`; `bootRoot removed → mount-unverified`; `rootId with the right inode but another device | the right device but another inode → root-changed`; `bootRoot replaced by a symlink → root-changed`, and `path-unsafe` when the stand-in reports the link's own identity.
  - **Permissions, one level at a time:** `bootRoot 0775 → permissions-unsafe`; `bootRoot 0755 → loaded` (the positive control); `waitron-recovery 0750 → permissions-unsafe`; `wifi.json 0640 → permissions-unsafe`; each of the three owners wrong (wrap `io.lstat` for the folders and the handle's `stat` for the file, as PR 1 does) → `permissions-unsafe`.
  - `io.open throws an EIO error → refused io-failed`.
  - `an io that throws on any property besides lstat and open (a Proxy) → loaded`, which shows the reader uses no other file operation.
  - `readActiveWifiRecord() → refused mount-unverified`, and `BOOT_ROOT` is `"/boot"`.
  - `bad deps — a relative bootRoot | "/tmp/x/../y" | ownerUid -1 | ownerUid 1.5 | inspectBootMount missing | io without open | an extra key → throws {code:"wifi_record.deps_invalid", reason:"deps-invalid"}` at construction, with zero io and seam calls.
  - **Password sweep.** With the password `"Bar-Àngels-2026"`, collect every result's `JSON.stringify` and `util.inspect`, while spying on `console.*`, `process.stdout.write` and `process.stderr.write`. Run: every refusal above; a corrupt record holding the password; an `io.open` whose error message and properties hold the password; a handle whose `stat` throws an error holding it. Assert no refused or absent result holds the password, its UTF-8 hex or its base64, and no console, stdout or stderr call happened. Positive control: the `loaded` result does hold it. This is the boot Wi-Fi field test the parent plan asks for separately; the spec allows the password in this one file.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** `createWifiRecordReader`, `readActiveWifiRecord` and `BOOT_ROOT`.
- [ ] **Step 4: Run green**, then run the coverage command for `wifi-record.mjs`.
- [ ] **Step 5: Deletion controls.**
  - On `absent`, try `wifi.json.next` → the `.next`-only case loads.
  - Drop `O_NOFOLLOW` → the symlinked-record case loads.
  - Drop the hard-link check → its case loads.
  - Read with `handle.readFile()` → the growing-file case loads or gives `record-corrupt`, not `record-oversized`.
  - Remove the mount-check call → the throwing-stand-in case reads files.
  - Compare only the inode part of `rootId` → the other-device case loads.
  - Put the caught error's message into the `io-failed` result → the password sweep fails.
- [ ] **Step 6: Commit:** `feat(box): read only the boot copy's one Wi-Fi record, from a checked boot mount`. The commit body says the real boot-mount check and the startup image's mount point come from the Linux pull request.

### Task 9: backlog and dated pointers

**Files:**
- Modify: `docs/backlog.md`, the B3 entry (line 5117 on 2026-11-03).
- Modify: `docs/backlog/box.md`, `## B3. The bootable USB installer`: "Built so far" starts at line 818 and its PR 2 sentence is at line 834; "For later slices, from PR 1's re-map against main" is at line 844.
- Modify: `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md`, one dated pointer line at the top.
- Modify: `docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, one dated pointer line at the top.

- [ ] **Step 1: Backlog entry.** After the PR 1 sentence, add one: PR 2 (`#PR2`, filled in once the pull request exists, [plan](superpowers/plans/2026-11-03-b3-2-preboot-logic.md)) adds the preboot unlock gate with the proposed 2/4/8/16/32/60-second wait, the locked-mode redirect decision and the Wi-Fi record reader under `scripts/box/`, none called yet. Keep the Android sentence exactly as it is.
- [ ] **Step 2: `docs/backlog/box.md`.**
  - Under "Built so far", add a dated PR 2 paragraph (`#PR2`) with three bullets in the style of PR 1's: `preboot.mjs` (which disk may be opened, one shared check, the proposed waits, every key copy cleared); `preboot-locked.mjs` (the two certificates, the 302 to the one recovery address, refusals); `wifi-record.mjs` (version 1, the one fixed file, never the staging copy).
  - Replace the sentence "PR 2, the preboot logic … can be built now." with what still waits from this plan's "Out": the preboot screen, the words for the `explain` answer, and the letters-to-bytes decoder; the public CA download and help page; the key-use record and the startup-fingerprint check before resealing; the real `cryptsetup`, observation, boot-mount, certificate-file and listener adapters; joining Wi-Fi; the address fallback; the four preboot rig cases; key-memory measurements.
  - Under "For later slices", add:
    - the installation id must be a new per-disk value made at first start, never Cloud's `installationId` or the fiscal `installationIdentity` (re-map finding 7);
    - task 3.1's writer writes Task 7's version-1 format and reads it back with `parseWifiRecord`; open, WEP, enterprise and OWE networks, and WPA2 passwords outside printable ASCII, get no Wi-Fi unlock in version 1, a gap 3.1 reports rather than hides;
    - the address fallback widens Task 5's one-name rule and Task 6's host rule together;
    - slice 8's sheet and the preboot screen share one letters-to-bytes alphabet.
  - Add, for slice 2: `classifyDisk` calls a Waitron disk with an extra foreign encrypted partition `waitron` (re-map finding 16); the installer policy decides whether that is right.
  - Add one short item, worded as a weak test assertion, not a production defect: `apps/server/src/box-tls-repair.test.ts:397` checks a repaired leaf with `X509Certificate.checkIssued`, which matches the issuer's name and key identifier, both of which another CA can copy, so only `verify(ca.publicKey)` ties a leaf to the CA's key (re-map finding 8); the test would therefore also pass for a leaf another key signed; a `verify(ca.publicKey)` assertion would check the signature.
- [ ] **Step 3: Pointers.** At the top of the spec and of the six-slice plan, above the 2026-11-01 line, add: `> 2026-11-03: PR 2's plan (the preboot unlock gate, locked-mode redirect and Wi-Fi record reader) and its re-map against main: [2026-11-03-b3-2-preboot-logic.md](…).` Do not rewrite either historical body (CLAUDE.md §6, docs).
- [ ] **Step 4: Guides and CLAUDE.md.** No guide changes: nothing a person sees changed. No CLAUDE.md line (the coordinator dropped the one this plan proposed, review Q7) unless an implementing task paid for a new trap; if one did, add one line plus a pointer.
- [ ] **Step 5: Commit** in this branch (it is not a docs-only branch): `docs(backlog): record B3's preboot logic and what still waits for Linux`.

---

## Self-review

**Spec coverage for this pull request.**

| Spec sentence (§7.5 unless noted) | Where |
| --- | --- |
| "Freeze the unlock target before listening: expected disk UUID plus expected layout/state. Wrong, missing or multiple matching disks, damaged metadata or first-start-repair state offer Stop/reinstall guidance" | Task 1, and Task 2's `reason` and `status()` |
| "first-start-repair state offer[s] Stop/reinstall guidance, not a key form" (§7.5). §7.3's "Waitron does not start while an empty passphrase remains" stays the first-start service's duty; the gate only refuses a key form while first start is unfinished | Task 1, `first-start-pending` |
| "one verifier at a time across local and all remote clients … 2, 4, 8, 16, 32, then 60 seconds, capped at 60 until successful unlock or reboot" | Task 2 |
| "Malformed submissions cannot start concurrent verification or bypass the delay" | Task 2 |
| "Do not log submitted bytes. Keep key input only in process memory; never arguments, environment, files … Clear input … on success; clear on cancel/error" | Tasks 3 and 4 (process-level only; see their stated limits). The spec's "cancel" (spec line 813) is a person cancelling: the screen clears its own copy of the typed key then ("Out"), and the gate already keeps no copy outside a running check. The gate's `close()` is shutdown, a different thing |
| "While locked, `http://waitron.local` redirects straight to `https://unlock-<installation-id>.waitron.local`" | Task 6 |
| "`https://waitron.local` instead serves a deliberately untrusted redirect-only certificate, NOT signed by the box CA" | Task 5 (`redirect-ca-signed`) and Task 6 (`selectLockedIdentity`) |
| "Neither entry point accepts a key, sign-in or configuration change. The target is a fixed host-owned per-disk URL, never a request-supplied redirect or credential-bearing URL" | Task 6 |
| "`waitron.local` is redirect-only while locked, never an alias on the trusted recovery leaf" | Task 5 (`recovery-names-wrong`) |
| "Refuse a leaf that outlives the CA. An actually expired or unreadable recovery identity requires the local Waitron screen" | Task 5, and Task 6's `explain` answer saying so over HTTP |
| "Before unlock, read only the validated active fixed-path record, never leftover temporary copies" | Task 8 |
| "SSID and password, plus only validated security/join fields" | Task 7 |

Every other Task 1.3 sentence is listed under "Out", with where it goes.

**Names.** These match the parent plan where it named them: `createUnlockGate`, `submit`, `UnlockResult` and its four kinds, `verify`, `open`. The parent's `cancel` is `close` here (review I3). Deviations are recorded in re-map findings 3–6.

**What the planner ran (2026-11-03):**
- `pnpm exec vitest run scripts/box/disk-state.test.mjs`: 118 passed; with `--coverage --coverage.include=scripts/box/disk-state.mjs`: 98/98 statements, 122/122 branches, exit 0;
- `memory_pressure`: 92% free before that run;
- `openssl` (4.1.0, and macOS's LibreSSL 3.3.6 for the same commands) plus `node` probes of `X509Certificate`: `checkIssued` true and `verify` false for a same-name impostor; a certificate with an appended private key parsed; a leaf signed for 60 days under a 30-day CA was issued; the SAN string of a two-name leaf is `"DNS:waitron.local, IP Address:192.168.1.5"`; `KeyObject.equals` told two keys apart; eight certificates in 0.08 seconds from one shell script;
- `curl` of NetworkManager 1.52.0's `nm-setting-wireless.c`, `nm-setting-wireless-security.c` and `nm-utils.c`, and of RFC 9110, RFC 6066 and RFC 1035, for the lines quoted above;
- `grep` for an installation-id source, for `wifi.json` and `waitron-recovery`, for registrations of PR 1's codes, and for `checkIssued`;
- for the review fold: a node-forge `certificateToPem` run from `apps/server` (every line ended in `\r\n`), and a read of `vitest.config.ts:96` and `.github/workflows/image-smoke.yml:23` and `:206-210`;
- `pnpm exec prettier --file-info` on PR 1's plan: `"ignored": true` (`docs/` is ignored whole), so this file's format is not enforced.

**What the planner only read:** everything else, including every line number cited here.

No test of the code above has run, because none of it exists yet.

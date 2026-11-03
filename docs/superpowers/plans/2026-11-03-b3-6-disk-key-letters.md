# B3, sixth pull request: the disk recovery key as letters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Build the one pure module that turns the box's disk recovery key between its two forms: the 32 bytes the box keeps and checks (PR 1's store, PR 2's unlock gate) and the 64 letters a person reads on the recovery sheet and types on the preboot screen. Also narrow two code comments that claim more than the spec says.

- **The letters** (`scripts/box/disk-recovery-key.mjs`, new). Spec §7.5 (lines 609–611 on main) shows the key "as 64 letters in eight groups of eight from the 16-letter set in P40", which is systemd's recovery-key format. Three functions: bytes to the sheet's text, bytes to the exact passphrase bytes the disk's key slot holds, and a person's typed text back to bytes.
- **Two comments** (`scripts/box/disk-key.mjs:222-223`, `scripts/box/wifi-record.mjs:415-416`) say "root is already trusted (spec §7.5)". `grep -n -i trusted` over the spec finds no sentence about trusting root; the sentence PR 1's plan cited for the clause (§7.5, lines 651–652 on main: "they do not protect it from host root") says the record's protections stop at host root, not that a swap by root between the checks and the open is accepted. PR 5's review showed what a root process can do between those checks and the open. The clause goes; the rest of each comment stays.

Nothing here runs on a box, opens a disk, or draws a screen. The module is called by nothing yet.

**Review folded 2026-11-03.** A fresh-context review recomputed every literal and systemd vector with its own formatter and parser (all matched) and found four important and five minor points; all are folded:

- I1: the comment check compares `HEAD~1`, not `HEAD` (which compares nothing: `comments-only: no files changed`).
- I2: the box opens the disk with `cryptsetup`, not `systemd-cryptsetup` (spec lines 472–474: the chip unlock runs `headless`, and the recovery-key screen is Waitron's own step). Re-map finding 4, D2, the unlock-adapter note and the backlog text now rest the passphrase on what `systemd-cryptenroll` enrols (finding 7) and say the adapter sends exactly 71 bytes with `--key-file=-` and no newline; finding 8 stays only as a note about systemd's own prompt.
- I3: the Kelvin sign U+212A and capital I with dot U+0130 join the letter refusals, so a `toLowerCase()` implementation fails.
- I4: the coverage command is PR 4's, with its own report folder; read the summary counts.
- M1: finding 8's callers are cited at v257. M2: `KEY_HEX` is `disk-key.mjs:37`. M3: the canary groups are literals. M4: the backlog sentence after the deletion is given in full. M5: D3's reason is the one-answer-per-text property; a refused text never reaches the gate; slice 8's QR code holds the formatted text.

**Architecture:** One new host library under `scripts/box/`, a plain `.mjs` file with JSDoc types and a sibling `.test.mjs` in the root Vitest project, in the style PRs 1–5 set (`name-tag.mjs` is the nearest model: a pure format with a `refusal(code, reason)` error helper).

**Tech Stack:** Node 26 (`node --version` printed v26.13.0 on 2026-11-03), Vitest 4.1.12 root project. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §7.5 (lines 603–625 and 830–845 on main), provenance row P40 (line 1733). This branch adds a pointer line at the top of the spec, so add 2 to each line number once it merges.

**Parent plan:** [six-slice plan](2026-10-26-b3-usb-installer.md), Task 1.3 (preboot unlock) and Task 8.4 (every disk-key sheet), the text-form part of each only. [PR 2's plan](2026-11-03-b3-2-preboot-logic.md) line 83 left this piece out: "Turning the 64 typed letters into 32 bytes … The decoder belongs beside the screen, and slice 8's sheet must print with the same alphabet; one shared encoder and decoder is that pull request's choice. The gate takes bytes only."

**Build authority:** the owner's "Yes, build it", 2026-11-01, with the build cut one pull request at a time ([PR 1's plan](2026-11-01-b3-1-encrypted-disk.md), "Build authority").

## Global Constraints

- **Machine limits on 2026-11-03:** macOS, unprivileged. No Linux box, TPM, real disk or `cryptsetup`. Nothing in this pull request needs them.
- **No key and no typed text in any answer but the key itself.** A refusal, a thrown error, its message and its fields never hold a key byte, a key letter or any character the person typed. A refusal may say how many key letters it counted and the position of the first character it could not read.
- **The key bytes the module returns are fresh `Uint8Array`s the caller owns and zeroes.** The module keeps no reference to them. A JavaScript string cannot be zeroed, so the sheet's text (a string) and the typed text (a string the screen hands over) stay in memory until collected; the key-memory measurements are already a later rig item (PR 2's "Out").
- **Coverage:** the root project holds `98/98/98/95` (`vitest.config.ts`). No `exclude`, no ignore comment, and no moving code into a testing folder.
- **Code style:** English only (CLAUDE.md §3). Comments only for an invariant or a reason the code cannot show; no decision numbers from this plan in code. Error codes name the domain: `disk_recovery_key.invalid`. The name says "disk" because the dashboard already has a different "recovery key", the backup one (`apps/dashboard/src/screens/backup-screen.ts:1124`).
- **Commits:** `git commit -s`, staging only named paths, never `git add -A`.

## Review Focus

1. **The passphrase is byte-for-byte what systemd's own tools enrol and accept.** Expected: `diskRecoveryKeyPassphrase` gives the 71 ASCII bytes of systemd's formatted key (lower case, a hyphen after every eight letters but the last), high half of each byte first. Task 1, checked against systemd's own vectors in Task 2.
2. **A typed key reads one way only.** Expected: every accepted text gives the same 32 bytes that formatting those bytes would print; no two different keys can come from the same typed text; a text with a character outside the 16 letters and the listed separators is refused, never skipped. Task 2.
3. **Nothing leaks.** Expected: the canary sweep in Task 2 finds no typed character or key letter in any refusal or error. Tasks 1, 2.

---

## What this pull request builds, and what it leaves out

**In (testable on this machine):**

| Task | File | Source |
| --- | --- | --- |
| 1 | `scripts/box/disk-recovery-key.mjs` and test: the letter set, `formatDiskRecoveryKey`, `diskRecoveryKeyPassphrase`, the byte check | spec §7.5 lines 609–611; P40; D1, D2, D5 |
| 2 | same files: `parseDiskRecoveryKey`, systemd's vectors, the round trip and the canary sweep | PR 2's plan line 83; D3, D4 |
| 3 | the two comments; backlog (PR 6's paragraph, settled and new re-map notes); dated pointers in the spec and the six-slice plan | queue note on PR 5; — |

**Out, and where each goes next:**

- **Making the key at first start and enrolling its key slot:** slice 1's recipe and host adapter (spec §7.3). Whether it runs `systemd-cryptenroll --recovery-key` (which prints the formatted text, and the adapter then reads it back with `parseDiskRecoveryKey` before PR 1's store keeps the bytes) or makes 32 random bytes and enrols `diskRecoveryKeyPassphrase(bytes)` as an ordinary passphrase is that adapter's choice; both put the same 71 bytes in the key slot.
- **The unlock adapter** (slice 1, Task 1.3): its `verify`/`open` receive the gate's 32 bytes (`scripts/box/preboot.mjs:95-96`), call `diskRecoveryKeyPassphrase`, send exactly those 71 bytes to `cryptsetup` with `--key-file=-` and no newline, and zero them. cryptsetup 2.7.5's man page says that from a key file "trailing newlines are not stripped" (`man/cryptsetup.8.adoc:570-581`, its plain-mode passphrase notes); that LUKS reads standard input the same way is a rig check.
- **The preboot screen's refusal handling:** a refused text never reaches the unlock gate, so it never starts the gate's 2/4/8-second waits (`scripts/box/preboot.mjs`); the screen says what was wrong and lets the person correct it.
- **The preboot screen and its words** for each refusal reason, in Spanish and English: slice 1, Task 1.3's screen.
- **The sheet's text and QR code** (slice 8, Task 8.4): the host draws the disk-key page, and `apps/server` receives document bytes only (the parent plan's `DiskDocumentDeps`: "Host RPC returns document bytes, never a raw-key JSON response"). Proposed: the host draws it with `formatDiskRecoveryKey`'s text and a QR code holding that same text, so `parseDiskRecoveryKey` reads a scan of it.
- **The key-use record and the startup-fingerprint check before resealing** (spec §7.5 lines 841–844): their record shapes depend on the slice 1 recipe's files, so they wait for it.

## Re-map against main on 2026-11-03

1. The unlock gate takes exactly 32 bytes in a genuine `Uint8Array` (`scripts/box/preboot.mjs:88`, `:120-123`, `:188`), and zeroes the caller's array before `submit` returns.
2. PR 1's store keeps the key as 64 lower-case hex characters on disk and hands its consumer 32 bytes (`scripts/box/disk-key.mjs:37`, `:140-141`).
3. No code in the tree knows systemd's letter set: `git grep -n -i "modhex\|cbdefghijklnrtuv" -- ':!docs'` prints nothing.
4. The key slot holds what `systemd-cryptenroll` enrolled, which is the formatted text (finding 7). The box does not type at systemd's own prompt: the chip unlock runs with its prompt switched off (`headless`), and the recovery-key screen is a separate step of Waitron's own (spec lines 472–474). So the screen's adapter must hand `cryptsetup` the formatted text byte for byte.

### Provenance of the outside facts

Read in systemd's source at tag v257 (Debian 13 ships 257.13, spec P32), fetched with `curl -sfL https://raw.githubusercontent.com/systemd/systemd/v257/<path>` on 2026-11-03.

| # | Fact | Source's words | Where |
| --- | --- | --- | --- |
| 5 | The 16 letters, in nibble order | `const char modhex_alphabet[16] = { 'c', 'b', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'n', 'r', 't', 'u', 'v' };` | `src/shared/recovery-key.c:7-9` |
| 6 | 32 random bytes, each written high half first, a hyphen after every fourth byte, the last replaced by the end of the string | `formatted[j++] = modhex_alphabet[key[i] >> 4]; formatted[j++] = modhex_alphabet[key[i] & 0xF]; if (i % 4 == 3) formatted[j++] = '-';` … `formatted[RECOVERY_KEY_MODHEX_FORMATTED_LENGTH-1] = 0; /* replace final dash with a NUL */` | `src/shared/recovery-key.c:95-105`; `RECOVERY_KEY_MODHEX_RAW_LENGTH 32`, `FORMATTED_LENGTH (RAW_LENGTH*2/8*9)` = 72 with the end byte, `recovery-key.h` |
| 7 | The key slot's passphrase is that formatted text | `r = make_recovery_key(&password);` … `crypt_keyslot_add_by_volume_key(…, password, strlen(password));` | `src/cryptenroll/cryptenroll-recovery.c:28`, `:36-42` |
| 8 | A note only, since the box does not use systemd's prompt (finding 4): `systemd-cryptsetup` does not rewrite a typed key either | `grep -c normalize_recovery_key src/cryptsetup/cryptsetup.c` printed `0` (2675 lines at v257); the plan review found that `get_password` (`cryptsetup.c:870-980`) only pads with NUL bytes below the 32-byte key size, and that v257's terminal reader only edits (newline ends, backspace deletes); at v257 `normalize_recovery_key` is called from `src/home/homework.c` and `src/home/user-record-util.c` (checked with those files and `cryptenroll.c`, `homework-luks.c`, not the whole tree) | — |
| 9 | systemd reads a letter in either case | `/* Check both upper and lowercase */ if (modhex_alphabet[i] == x \|\| (modhex_alphabet[i] - 32) == x)` | `src/shared/recovery-key.c:13-16` |
| 10 | systemd's own normaliser accepts exactly two layouts: 64 letters, or 71 characters with hyphens at the fixed places | `if (!IN_SET(l, RECOVERY_KEY_MODHEX_RAW_LENGTH*2, /* syntax without dashes */ RECOVERY_KEY_MODHEX_FORMATTED_LENGTH-1)) /* syntax with dashes */ return -EINVAL;` | `src/shared/recovery-key.c:29-32` |
| 11 | systemd's test vectors (input → normalised, or refused) | Accepted: `"cdefghijcdefghij…"` (64 letters, `"cdefghij"` × 8) → `"cdefghij-"` × 7 + `"cdefghij"`; `"cdefVhij-cDefghij-cdefkhij-cdufghij-cdefgdij-cidefIhj-cdefNijR-cdVfguij"` → `"cdefvhij-cdefghij-cdefkhij-cdufghij-cdefgdij-cidefihj-cdefnijr-cdvfguij"`; `"BFGHICEHHIUVLKJIHFHEDlntruvcdefjiTUVKLNIJVTUTKJIHDFBCBGHIJHHFDBC"` → `"bfghiceh-hiuvlkji-hfhedlnt-ruvcdefj-ituvklni-jvtutkji-hdfbcbgh-ijhhfdbc"`; the five spellings of `"iefgcelh-biduvkjv-cjvuncnk-vlfchdid-jhtuhhde-urkllkeg-ilkjgbrt-hjkbgktj"` (as is, unhyphenated, upper case with and without hyphens, capitalised groups, one capital) → that text. Refused: `"1234-5678-90AB-CDEF-1234-5678-90AB-CDEF"`; `""`; `"cde123hi-cdefgzij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghijcdefghij"`; `"cdefghij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghijcdefghij"` (one hyphen missing); the `iefg…` key one letter short, three ways; `"xefg…"` and `"Xefg…"`; `"iefgcelh+biduvkjv-…"`; `"iefgcelhebiduvkjv-…"` (a letter where a hyphen goes) | `src/test/test-recovery-key.c:100-134`; `src/test/test-modhex.c:20-48` |

### Decisions where the spec or parent plan left a choice

- **D1. The letters are systemd's, in systemd's order** (finding 5). The spec names P40's set; the order fixes which letter means which half-byte, and only systemd's order makes our text the text systemd's prompt accepts.
- **D2. The passphrase is the formatted text, as bytes** (findings 6, 7). `diskRecoveryKeyPassphrase` returns a new `Uint8Array` of 71 ASCII bytes so the unlock adapter can zero it after `cryptsetup` reads it; `formatDiskRecoveryKey` returns the same characters as a string for the sheet. A typed text is never passed on as typed: the screen always re-forms it through bytes, because the key slot holds only the one lower-case hyphenated spelling, and `cryptsetup` compares the bytes it is given.
- **D3. What a person may type: wider than systemd's normaliser, never ambiguous.** Letters in either case (finding 9). Hyphen-minus (U+002D), space (U+0020), tab, carriage return and line feed are ignored wherever they are, so `"cdef ghij…"`, a pasted sheet split over lines and systemd's two layouts (finding 10) all read. What makes this unambiguous is that a text has exactly one reading (its key letters, in order, with the separators dropped), and formatting a key and reading it back gives the same bytes (Task 2's round trip and 200-key test). Every other character is refused, including other dashes (en dash U+2013), a no-break space (U+00A0) and full-width letters: refusing costs a retype, while guessing a mapping could make a typo read as someone else's key. Of systemd's refused examples (finding 11), one is accepted here: `"cdefghij-…-cdefghijcdefghij"`, with one hyphen missing, still has 64 key letters and reads as the key systemd's normaliser would have made of it with the hyphen in place. That is the point of D3, and it is safe because the screen re-forms the text through bytes (D2) before `cryptsetup` sees it. Every other refused example is refused here, with the reason D4 gives.
- **D4. Refusals, first reason found wins.** Reading left to right: the first character that is neither a key letter nor a separator → `{ ok: false, reason: "letter", position }`, where `position` counts code points from 1 in the typed text (so a character outside the Basic Multilingual Plane counts once). If every character reads but the letters are not exactly 64 → `{ ok: false, reason: "length", letters }`, the count of key letters. A text that is not a string throws `disk_recovery_key.invalid` with reason `not-text`; a string over 4096 UTF-16 code units → `{ ok: false, reason: "length", letters: null }` before reading it, so a pasted page cannot make the screen scan a megabyte (4096 is generous: the longest sensible typing is 71 characters plus whitespace). Neither answer carries a character.
- **D5. Byte input is checked as the gate checks it.** `formatDiskRecoveryKey` and `diskRecoveryKeyPassphrase` take a genuine `Uint8Array` (`util.types.isUint8Array`, so a `Buffer` is accepted) of exactly 32 bytes, read through the typed-array prototype's `length` getter as `preboot.mjs:114-123` does, so a subclass or proxy cannot lie about its length. Anything else throws `disk_recovery_key.invalid` with reason `not-bytes` or `wrong-length`. They read the bytes once each and do not change the caller's array.

## Execution notes for every task

- Work in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-6-recovery-key-text`, branch `feat/b3-6-recovery-key-text`.
- Focused command: `pnpm exec vitest run scripts/box/disk-recovery-key.test.mjs` from the worktree root. A run with no `Tests` count is no evidence; read the count.
- Coverage for the new file: `pnpm exec vitest run scripts/box/disk-recovery-key.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/disk-recovery-key.mjs` and read the summary counts (statements, branches, functions, lines); `0/0` means the include matched nothing. They must be 100% or the gap explained to the reviewer; the bar is 98/98/98/95.
- Before each commit: `pnpm exec prettier --check <changed files>` and `pnpm exec eslint <changed .mjs files>`.
- Every expected value in a test is a literal written in the test or taken from systemd's vectors (finding 11), never computed by the module under test.

### Task 1: the letter set, the two formatters and the byte check

**Files:** create `scripts/box/disk-recovery-key.mjs`, `scripts/box/disk-recovery-key.test.mjs`.

**Interface:**

```js
export const DISK_KEY_LETTERS = "cbdefghijklnrtuv"; // index = half-byte value
export const DISK_KEY_BYTES = 32;
export const DISK_KEY_TEXT_LENGTH = 71;
/** @param {Uint8Array} key @returns {string} 8 groups of 8 lower-case letters joined by "-" */
export function formatDiskRecoveryKey(key) {}
/** @param {Uint8Array} key @returns {Uint8Array} the same 71 characters as ASCII bytes, a new array the caller zeroes */
export function diskRecoveryKeyPassphrase(key) {}
```

- [ ] **Step 1: Write the failing tests.**
  - All-zero key → `"cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc"`.
  - All-0xFF key → `"vvvvvvvv-"` × 7 + `"vvvvvvvv"`.
  - Key `[0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef]` repeated four times → `"cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv"` (every half-byte value once, high half first: 0x01 is `c` then `b`).
  - Key whose first byte is 0x10 and the rest 0 → starts `"bc"` (high half first; reversed order would print `"cb"`).
  - `diskRecoveryKeyPassphrase` of each key above equals `new TextEncoder().encode(<same literal>)`, has length 71, and is a new array each call (two calls give arrays that are not the same object; zeroing one leaves the other).
  - Neither function changes the input array (compare to a copy after the call).
  - A `Buffer` of 32 bytes is accepted.
  - Throws with `code: "disk_recovery_key.invalid"`: `reason: "not-bytes"` for a plain array of 32 numbers, a string, `null`, an `ArrayBuffer`, a `Uint16Array(32)`; `reason: "wrong-length"` for `new Uint8Array(31)`, `new Uint8Array(33)`, `new Uint8Array(0)`, and for a `Uint8Array` subclass whose own `length` getter answers 32 while its real length is 31.
  - No thrown error's `message`, `reason` or own enumerable values contain the canary key: pass a 33-byte array whose first 32 bytes are `[0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef]` × 4; the error's `JSON.stringify` and `String(error)` contain none of the literals `"cbdefghi"`, `"jklnrtuv"` and `"0123456789abcdef"`.
- [ ] **Step 2:** Run the focused command; expect failures because the module does not exist.
- [ ] **Step 3: Implement** the module: the constants, a `refusal(code, reason)` helper like `name-tag.mjs:24-26`, a byte check as D5 says, and one shared function producing the 71 character codes, which both exports use (the string through `String.fromCharCode`, the bytes as a new `Uint8Array`). Zero any intermediate array the module itself allocates other than the returned one.
- [ ] **Step 4:** Focused command green; coverage row read; prettier and eslint clean.
- [ ] **Step 5: Commit:** `git commit -s -m "feat(box): the disk recovery key's letters and passphrase bytes"`.

### Task 2: reading a typed key

**Files:** modify `scripts/box/disk-recovery-key.mjs`, `scripts/box/disk-recovery-key.test.mjs`.

**Interface:**

```js
/**
 * @param {string} text  what the person typed or pasted
 * @returns {{ ok: true, key: Uint8Array } | { ok: false, reason: "letter", position: number } | { ok: false, reason: "length", letters: number | null }}
 */
export function parseDiskRecoveryKey(text) {}
export const DISK_KEY_TEXT_MAX = 4096;
```

- [ ] **Step 1: Write the failing tests.**
  - **systemd's vectors (finding 11), copied as literals from the two systemd files:** for each accepted input, `parseDiskRecoveryKey(input)` is `ok` and `formatDiskRecoveryKey(result.key)` equals systemd's normalised literal. Refused inputs, with the answer this module gives: `"1234-5678-90AB-CDEF-1234-5678-90AB-CDEF"` → `letter`, position 1; `""` → `length`, `letters: 0`; `"cde123hi-…"` → `letter`, position 4; the three one-letter-short `iefg…` spellings → `length`, `letters: 63`; `"xefg…"` and `"Xefg…"` → `letter`, position 1; `"iefgcelh+…"` → `letter`, position 9; `"iefgcelhebiduvkjv-…"` → `length`, `letters: 65`. The one-hyphen-missing input (systemd's case 4) → `ok`, and formats to `"cdefghij-"` × 7 + `"cdefghij"` (D3: wider than systemd, on purpose).
  - **Round trip:** for the Task 1 keys, `parseDiskRecoveryKey(formatDiskRecoveryKey(k)).key` equals `k` byte for byte, and so does the upper-case form, the form without hyphens, the form with every hyphen replaced by a space, the form split over two lines with `"\r\n"`, and the form with a tab and spaces before and after.
  - **Letter refusals, with positions:** an `a` (not in the set) at typed position 9 → `{ ok: false, reason: "letter", position: 9 }`; the same with `o`, `0`, `ç` (U+00E7), the Kelvin sign `"\u212A"` (which `toLowerCase()` turns into `k`), capital I with a dot `"\u0130"` (which Turkish lower-casing turns into `i`), en dash U+2013 replacing a hyphen, no-break space U+00A0, full-width `ｃ` (U+FF43); an emoji `"\u{1F600}"` at position 3 followed later by an `a` → position 3 (the emoji itself is refused first); the text `"\u{1F600}a"` → position 1; a valid 63-letter text followed by `a` → `letter` (not `length`), proving letters are checked before the count.
  - **Length refusals:** 63 letters → `{ reason: "length", letters: 63 }`; 65 → `letters: 65`; only separators `" - \n"` → `letters: 0`; a string of 4097 `c` → `{ reason: "length", letters: null }`; a string of exactly 4096 characters made of 64 letters and 4032 spaces → `ok`.
  - **Two different keys never read the same:** for 200 keys drawn with `crypto.getRandomValues`, parse(format(k)) equals k (catches a wrong table even where the fixed vectors happen to agree).
  - **Not text:** `parseDiskRecoveryKey(undefined)`, `(42)`, `(new String("c".repeat(64)))` throw `code: "disk_recovery_key.invalid"`, `reason: "not-text"`.
  - **The returned key is fresh:** two parses of the same text give arrays that are not the same object; zeroing one leaves the other.
  - **Canary sweep:** for a canary key's formatted text with one letter replaced by `a`, with one letter removed, and with one added, the refusal's `JSON.stringify` holds none of the canary's eight letter groups and no run of 8 or more key letters at all (`/[cbdefghijklnrtuv]{8}/` does not match, case-insensitive); the same for the `not-text` error built from a `String` object wrapping the canary text.
- [ ] **Step 2:** Run the focused command; expect the new cases to fail (no export yet).
- [ ] **Step 3: Implement** `parseDiskRecoveryKey` as D3 and D4 say: check `typeof text === "string"` (throw otherwise), refuse over `DISK_KEY_TEXT_MAX` code units, then walk the text by code point (`for … of`), counting positions from 1; skip the five separators; map a letter (lower-casing ASCII `A`–`Z` only) through `DISK_KEY_LETTERS.indexOf`; refuse the first unreadable character; collect half-bytes into a 64-entry array; refuse when the count is not 64 (keep counting past 64 so `letters` reports the real count); build the 32-byte key. Zero the half-byte array before returning, on every path.
- [ ] **Step 4:** Focused command green; coverage row read; prettier and eslint clean.
- [ ] **Step 5: Commit:** `git commit -s -m "feat(box): read a typed disk recovery key back into its bytes"`.

### Task 3: the two comments, backlog and pointers

**Files:** modify `scripts/box/disk-key.mjs`, `scripts/box/wifi-record.mjs`, `docs/backlog/box.md`, `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md` (line 1 pointer only), `docs/superpowers/plans/2026-10-26-b3-usb-installer.md` (line 1 pointer only).

- [ ] **Step 1: The comments.** In `scripts/box/disk-key.mjs:222-223` change "Only root can write in root-only parents, so only root could swap a folder between these checks and the open below, and root is already trusted (spec §7.5)." to "Only root can write in root-only parents, so only root could swap a folder between these checks and the open below." In `scripts/box/wifi-record.mjs:415-416` drop ", and root is already trusted (spec §7.5)" in the same way. Run `pnpm exec vitest run scripts/box/disk-key.test.mjs scripts/box/wifi-record.test.mjs` (unchanged pass counts). After committing this step alone, run `node scripts/comments-only.mjs HEAD~1`; it must print `2 code files compared; only comments changed in them` (with `HEAD` it compares nothing). Commit: `git commit -s -m "docs(box): two comments no longer claim the spec trusts root"`.
- [ ] **Step 2: Backlog** (`docs/backlog/box.md`, section "B3. The bootable USB installer"):
  - Add a paragraph after PR 5's "Built so far": **Built so far (2026-11-03), PR 6.** [PR 6](../superpowers/plans/2026-11-03-b3-6-disk-key-letters.md) adds `scripts/box/disk-recovery-key.mjs`, called by nothing yet: `formatDiskRecoveryKey` (32 bytes → systemd's 64 letters in eight hyphenated groups, for the sheet), `diskRecoveryKeyPassphrase` (the same 71 characters as bytes the caller zeroes, which is exactly the passphrase `systemd-cryptenroll` enrols, so the unlock adapter sends these bytes rather than what was typed), and `parseDiskRecoveryKey` (typed text → 32 bytes; either case; hyphen-minus, ASCII space, tab, carriage return and line feed ignored anywhere; any other character refused with its position; a count other than 64 refused with the count; nothing typed ever in an answer).
  - In PR 2's "left for later" sentence, change "the preboot screen, the words for the `explain` answer and the letters-to-bytes decoder;" to "the preboot screen and the words for the `explain` answer;".
  - Replace the PR 2 re-map bullet "Slice 8's sheet and the preboot screen share one letters-to-bytes alphabet." with a "For later slices, from PR 6's re-map" list: the unlock adapter calls `diskRecoveryKeyPassphrase` on the gate's bytes, sends exactly those 71 bytes to `cryptsetup` with `--key-file=-` and no newline, and zeroes them, never a typed spelling (that LUKS reads standard input without stripping is a rig check); a refused text never reaches the unlock gate, so it starts none of the gate's waits; first start either reads `systemd-cryptenroll --recovery-key`'s printed text back with `parseDiskRecoveryKey` or enrols `diskRecoveryKeyPassphrase` of its own 32 random bytes, which give the same key slot; the host draws slice 8's disk-key page and `apps/server` receives document bytes only (proposed: the page carries `formatDiskRecoveryKey`'s text and a QR code holding that same text, so `parseDiskRecoveryKey` reads a scan of it); the screen's words for the `letter` and `length` refusals, in Spanish and English, come with the preboot screen; the key-use record and the startup-fingerprint check wait for slice 1's recipe.
  - Remove the queue-noted comment item if the backlog lists it (search `already trusted`); if it is not listed, add nothing.
- [ ] **Step 3: Pointers.** Add one dated line at the top of the spec and of the six-slice plan, above PR 5's, in the same form: `> 2026-11-03: PR 6's plan (the disk recovery key as systemd's letters, and reading a typed key back): [2026-11-03-b3-6-disk-key-letters.md](…); the passphrase is the formatted text itself, as `systemd-cryptenroll` enrols it, so the box re-forms a typed key before `cryptsetup` sees it (its D2).` followed by a blank line.
- [ ] **Step 4:** `pnpm exec prettier --file-info docs/backlog/box.md` (docs are ignored; confirm) and `pnpm exec vitest run scripts/claude-md-pointers.test.ts` if a root `CLAUDE.md` changed (it should not). Commit: `git commit -s -m "docs(b3): PR 6's paragraph, re-map notes and pointers"`.

## Self-review

- Every spec sentence this pull request touches has a task: the 64 letters in eight groups (Task 1), the 16-letter set (Task 1), typing the key on the preboot screen (Task 2, logic only).
- No placeholder: every expected value is a literal or one of systemd's vectors.
- The names are consistent: `DISK_KEY_LETTERS`, `DISK_KEY_BYTES`, `DISK_KEY_TEXT_LENGTH`, `DISK_KEY_TEXT_MAX`, `formatDiskRecoveryKey`, `diskRecoveryKeyPassphrase`, `parseDiskRecoveryKey`, code `disk_recovery_key.invalid`.

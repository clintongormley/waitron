# B3, fourth pull request: the name tag's format and the Wi-Fi boot copy's writer format

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Build two pure formats that an unprivileged macOS machine and CI's root Vitest project can fully test, plus one owner decision written into the backlog.

- **The name tag** (`scripts/box/name-tag.mjs`, new). When a stick finds Waitron already on a box, its reinstall screen shows the venue's name and whether it is Live, read from the disk without the disk key (spec §5.1 guard 3, §7.6). This pull request fixes where that record lives and what its bytes are. It lives in a LUKS2 *token*: a small JSON record that the encrypted container's header keeps in its metadata area beside the keys' descriptions, readable and writable without the disk key. This pull request builds the encoder, the decoder, the function that finds the tag in the whole header, and a pure *write plan* (which token to add, replace or remove), and nothing that touches a disk.
- **The Wi-Fi boot copy's writer format** (`scripts/box/wifi-record.mjs`, extended). PR 2 built the reader of `/boot/waitron-recovery/wifi.json`, version 1. This pull request adds the writer (`formatWifiRecord`), which produces only bytes that reader accepts, and the decision from the box's normal Wi-Fi settings to "write this copy" or "no copy, because …", so slice 3's host service can report why a box has no Wi-Fi unlock instead of hiding it.
- **The owner's answer on a Waitron box whose TPM or Secure Boot is off** goes into `docs/backlog/box.md` as a dated decision.

Nothing here runs on a box, reads or writes a disk header, writes a file, or joins a network. Nothing here is a qualified boot or install path.

**Review folded 2026-11-03.** A fresh-context review found four important and six minor points; all are folded:

- I1: `decodeNameTag` throws on `null`, so every place that feeds it `findNameTag`'s answer now reads `nameTag === null ? null : decodeNameTag(nameTag)` (the adapter note in "Out", Task 5's `readBack` helper, Task 8's backlog bullet), and Task 1 adds `null` as a throwing input.
- I2: the encoder's NFC step is stated in its JSDoc and in D2; every decomposed or composed test literal is written as an escape (`"Bar A\u0300ngels"`, `"Bar \u00C0ngels"`); a decomposed round trip is added.
- I3: D11 counts a WPA2 password in code points, as the reader does, and takes the password reasons from `formatWifiRecord`'s error rather than a second copy of the reader's rules; Task 7 gains the 40-emoji and four-emoji-plus-one-letter cases, both checked against `parseWifiRecord` with `node`.
- I4: Task 5's installer-screen property runs on every starting header as well as every result, and asserts `live`.
- M1: no decision number in any JSDoc the implementers copy, and an execution note says so. M2: a too-big replacement's header is read, not measured, and is added to the rig checks. M3: `formatWifiRecord` returns on `loaded`, with no field comparison. M4: Tasks 4 and 7 give their red command and expected output. M5: Review Focus 3 says "one rule and one limit", not "the same names". M6: Task 5 says its "nothing else changes" property tests its own simulator.

**Architecture:** One new host library and one extended one under `scripts/box/`, each a plain `.mjs` file with JSDoc types and a sibling `.test.mjs` in the root Vitest project, in the style PR 1–3 set. `installer-policy.mjs` changes only to import the name tag's text rule and length limit instead of holding its own copy; its behaviour and its tests do not change.

**Tech Stack:** Node 26 (`.nvmrc`; `node --version` printed v26.13.0 on 2026-11-03), Vitest 4.1.12 root project. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §5.1 guard 3 (lines 242–271 on main), §7.5 "Approved normal Wi-Fi copy" and "Proposed minimal-copy update contract" (lines 693–739), §7.6 (lines 849–859), §19 items 1 and 3 (lines 1594–1616), provenance rows P45 and P57 (lines 1734, 1746). Line numbers are main's on 2026-11-03; this branch adds a two-line pointer at the top, so add 2 for the spec as merged.

**Parent plan:** [six-slice plan](2026-10-26-b3-usb-installer.md): Slice 3 Task 3.1's red step 1 sentence "Name tag write changes only tag bytes, never disk-classification markers; huge accented name fits the custom record format without truncating markers" (line 199), the `tag.write` host verb (line 164), and the "Proposed boot-copy contract" (lines 189–197) and red step 2 (line 200), the pure parts only.

**Build authority:** the owner's "Yes, build it", 2026-11-01, relayed by the lead session for PR 1, with the build cut one pull request at a time ([PR 1's plan](2026-11-01-b3-1-encrypted-disk.md), "Build authority").

## Global Constraints

- **Machine limits on 2026-11-03:** macOS, unprivileged. No Linux box, TPM, real disk or network. The planner's measurements of `cryptsetup` ran in throwaway Debian 13 containers on header images held in files (re-map finding 3); implementers do not need Docker, and nothing in this pull request calls `cryptsetup`.
- **The name tag never touches what marks the disk as Waitron's.** Not the LUKS2 header's label field, not its subsystem field, not the partition's type or name (spec §7.6 line 855–856, "**never** the fields that mark the disk as Waitron's"). A write plan names only tokens of Waitron's own type, or a free token number.
- **The name tag decides nothing.** A forged, damaged, doubled or missing tag can at most show a wrong name or make the reinstall screen ask for the erase word instead of the name (spec §7.6 line 857–858). Disk recognition (`classifyDisk`) never reads it.
- **The Wi-Fi password never leaves in a "no copy" answer, an error or a log.** Only a "write" answer's bytes hold it, because they are the copy.
- **Coverage:** the root project holds `98/98/98/95` (`vitest.config.ts:120`). No `exclude`, no ignore comment, and no moving code into a testing folder.
- **Code style:** English only in code (CLAUDE.md §3). Test names such as `"Bar Àngels"` are venue-name data, as PR 1's tests already use (`scripts/box/disk-state.test.mjs:372-375`). Comments only for an invariant or a reason the code cannot show. Error codes name the domain (`name_tag.*`, `wifi_record.*`), never the file.
- **Commits:** `git commit -s`, staging only named paths, never `git add -A`.

## Review Focus

1. **A forged, doubled or damaged name tag.** Expected: `findNameTag` answers `null` for no tag and for two or more, never picking one; `decodeNameTag` answers `null` for anything but the exact version-1 bytes; neither throws on bytes; and the disk's classification is the same whatever the tag holds. Tasks 1, 3, 5.
2. **A write that touches something else.** Expected: every step of a write plan names a token of Waitron's type or a token number nobody holds; no step names a token of another type; the tag's bytes hold no `label` or `subsystem` key; a power cut between two steps leaves the tag unreadable, never the old name, on every plan that writes a name. Tasks 4, 5.
3. **One text rule.** Expected: the encoder, the decoder and the installer's decisions use one exported rule (`usableVenueName`) and one exported limit (`NAME_TAG_MAX_CODE_POINTS`). They are not identical in what they accept: the installer and the encoder normalise a decomposed name to NFC, while the decoder refuses tag bytes whose name is not already NFC (D2). Tasks 1, 2.
4. **The Wi-Fi writer and its decision.** Expected: `formatWifiRecord` never returns bytes `parseWifiRecord` refuses; every network the reader cannot load gets "no copy" with a named reason; no "no copy" answer or error holds the password. Tasks 6, 7.

---

## What this pull request builds, and what it leaves out

**In (testable on this machine):**

| Task | File | Parent-plan or spec source |
| --- | --- | --- |
| 1 | `scripts/box/name-tag.mjs` and test: the text rule, the limits, `encodeNameTag`, `decodeNameTag` | spec §7.6; parent Task 3.1 red step 1 ("huge accented name fits the custom record format") |
| 2 | `scripts/box/installer-policy.mjs`: import the text rule and limit instead of its own copy | PR 3's D8 ("the pull request that defines the tag's format sets the real limit") |
| 3 | `scripts/box/name-tag.mjs` and test: `findNameTag` over the whole header's metadata; `disk-state.mjs`'s `nameTag` JSDoc | spec §5.1 guard 3 (the screen reads the tag); PR 1's `nameTag` field |
| 4 | same files: `planNameTagWrite` | parent Task 3.1 red step 1 ("Name tag write changes only tag bytes, never disk-classification markers") |
| 5 | `scripts/box/name-tag.test.mjs`: whole-flow sweep (plans applied to simulated headers, disk classification, the installer's screen) | Review Focus 1–2 |
| 6 | `scripts/box/wifi-record.mjs` and test: `formatWifiRecord` | parent Task 3.1 red step 2 (the format half); PR 2's backlog note "Task 3.1's writer writes the version-1 Wi-Fi format and reads it back with `parseWifiRecord`" |
| 7 | same files: `decideWifiBootCopy`, with its password sweep | same note: "a gap 3.1 reports rather than hides" |
| 8 | Backlog (the owner's decision, PR 4's paragraph, settled re-map notes), plus dated pointers in the spec and the six-slice plan | — |

**Out, and where each goes next:**

**The real `cryptsetup` adapter: slice 3's host service (`tag.write`, parent line 164).** It runs `cryptsetup luksDump --dump-json-metadata` on the frozen disk, hands the bytes to `planNameTagWrite`, then runs each step in order: `import` as `cryptsetup token import --token-id <n> --json-file -`, `replace` as the same with `--token-replace`, `remove` as `cryptsetup token remove --token-id <n>`, never with `--key-slot`. It holds the host's one header-write turn so `systemd-cryptenroll` cannot change tokens between the read and the write; if `cryptsetup` answers "Token <n> in use" it reads and plans again; a step refused for space is reported, not retried (re-map finding 3 says what `cryptsetup` does in each case).

**When the host writes the tag, and which name.** Slice 3 writes it at installation handoff and whenever the venue's name or its Live state changes (spec §7.6 line 852, "written by the box when either changes"). Which of the venue's names it writes — the taxpayer's legal name (`tenants.legal_name`, which the dashboard banner shows) or a trading name — is slice 3's binding (re-map finding 7).

**The Linux installer's observation adapter** fills `DiskObservation.nameTag` with `findNameTag(<the frozen internal disk's luksDump bytes>)` and hands the installer's decisions `nameTag === null ? null : decodeNameTag(nameTag)` as `venueTag`, for that disk and no other (PR 3's backlog note, unchanged in substance).

**The Wi-Fi boot copy's publication: slice 3 (parent Task 3.1 red step 2 and its implementation step).** Reading the box's NetworkManager connection into `WifiSettings`; the encrypted pending intent on `@host-state`; the root-only `wifi.json.next`, flush, rename and directory flush; obsolete-copy cleanup; the typed copy state (`current`, `absent`, `pending`, `failed`) and its reason on the status page; the screen's words for each "no copy" reason in Spanish and English; the operator guide's "If a box is stolen, change the venue's Wi-Fi password" (spec §7.5 line 699–700).

**Rig checks (Linux, slice 1 and slice 6):** that a token of an unknown type assigned to no keyslot does not slow or stop `systemd-cryptsetup`'s automatic unlock (re-map finding 10 is reading only); the real header's free metadata space once systemd's TPM and recovery tokens are in it (re-map finding 5); that the subsystem marker survives first start's header writes; that a too-big `--token-replace` leaves the header as it was (read, not measured: re-map finding 3).

## Re-map against main on 2026-11-03

The six-slice plan was written on 2026-10-26. This re-map checks spec §7.6, parent Task 3.1's tag and boot-copy sentences and the backlog's open notes against main at `6556a57fff`.

1. **The scope is right: the format is this pull request's, the writing is slice 3's.** Spec §19 item 1 lists "the name tag's format (§7.6; the host service that writes it is slice 3)" (line 1598), and item 3 lists "writing the name tag (§7.6)" (line 1612). Nothing on main decodes or writes a tag: `grep -rn "name-tag\|nameTag\|name_tag"` over `scripts`, `apps`, `packages` and `deploy` code files finds only PR 1's `nameTag` field (`scripts/box/disk-state.mjs:17`, `:94`, `:104`) and tests that set it: to `null` in the disk builders, and to forged bytes or wrong types in PR 1's forged-tag and bad-shape cases (`scripts/box/disk-state.test.mjs:394`, `:450-451`). PR 1's tests already prove that a tag's bytes cannot change `classifyDisk`'s answer (`scripts/box/disk-state.test.mjs:372-394`). The Wi-Fi writer does not exist either: `grep -rn "formatWifiRecord\|decideWifi"` finds nothing.
2. **"A record of Waitron's own kind in the container's header" is a LUKS2 token.** The spec's words are at line 852–853. The LUKS2 format's only place for a record the format itself does not define is a token. The LUKS2 On-Disk Format Specification, version 1.1.4, 2025-06-16 (`luks2_doc.tex` in `gitlab.com/cryptsetup/LUKS2-docs`, fetched with `curl` on 2026-11-03), says: "The token can contain user-defined metadata that are not part of the basic LUKS2 definition (in general, any JSON metadata can be stored as a token)" (lines 238–239). "The mandatory fields for every token are: type [string] the token type (tokens with luks2- prefix are reserved for the implementation internal use). keyslots [array] the array of keyslot objects names that are assigned to the token" (lines 1031–1038). Every token sits under the JSON metadata's `tokens` object, named by a decimal number: "all JSON objects must have their names formatted as a string that represents a number in the decimal notation (unsigned integer)" (lines 510–512). The label and subsystem fields are not in the JSON at all: they are in the 4096-byte binary header, `char label[LABEL_L]; // ASCII label or empty` and `char subsystem[LABEL_L]; // owner subsystem label or empty` (lines 360, 364). So a token can never overwrite them.
3. **What `cryptsetup` 2.7.5 does, measured.** Debian 13 ships cryptsetup 2:2.7.5 (spec P41). Run on 2026-11-03 in three throwaway `debian:trixie` containers (`docker run --rm`, `apt-get install cryptsetup-bin`, which printed `cryptsetup 2.7.5`), each on a 64 MiB file formatted with `cryptsetup luksFormat --type luks2 --label waitron-box --subsystem waitron-box-1`:
   - The default JSON metadata area was `"json_size":"12288"` bytes.
   - `token import` accepted `{"type":"waitron-name-tag","keyslots":[],"version":1,"name":"Bar \u00c0ngels \"q\" / x 😀","live":true}` (exit 0). `luksDump --dump-json-metadata` printed the token with its keys **in the order imported**, non-ASCII characters as raw UTF-8, `/` unescaped and `"` as `\"`. A token imported with keys in another order came back in that other order.
   - Two tokens of the same type were both accepted: `cryptsetup` does not stop a second tag, so the reader must.
   - `token import --token-id 0` onto an occupied number printed "Token 0 in use." and exited 1; with `--token-replace` it replaced it (exit 0). `--token-replace` onto a free number was accepted too.
   - A `luks2-` type, a token without `keyslots`, `keyslots` as an object, a `type` that is a number, and a `keyslots` entry naming a keyslot that does not exist were each refused ("Failed to import token from file.", exit 1).
   - With 32 tokens present the 33rd import was refused (exit 1), and `--token-id 32` printed "Token 32 is invalid." So token numbers run 0 to 31. Source: `#define LUKS2_TOKENS_MAX 32` (cryptsetup v2.7.5 `lib/luks2/luks2.h:28`, fetched with `curl`).
   - An import too big for the area, onto a free number, was refused (exit 1), the `luksDump --dump-json-metadata` output before and after was byte-identical (`cmp`), and the header's epoch stayed 7. The refusal is `-ENOSPC` with "Not enough space in header json area for new token." (`lib/luks2/luks2_token.c:402-406`). A too-big **replacement** (`--token-replace`) was refused too (exit 1, in the size loop), but the planner did not compare the header after it. By reading only: `_token_import` makes one `crypt_token_json_set` call for an import and a replacement alike (`src/cryptsetup.c:3282-3326`, the call at `:3309`), and `LUKS2_token_create` returns `-ENOSPC` at `lib/luks2/luks2_token.c:406`, before the only header write at `:411`, so the header on disk should be left as it was.
   - The label and subsystem bytes in **both** binary header copies (offsets 24 and 208, and the same plus 16384) read `waitron-box` and `waitron-box-1` before and after every import, replacement and removal.
   - `token remove --token-id 1` removed only that token, and the dump lists token numbers in the order they were added (`["0","10","2"]` after adding 10, then 2).
4. **The default area holds the largest tag with room to spare, measured; the real box header is not measured.** The largest tag this plan allows is 1100 bytes (256 four-byte characters plus 76 bytes of fixed text: `node` on 2026-11-03, `Buffer.from(JSON.stringify({type:"waitron-name-tag",keyslots:[],version:1,name:"😀".repeat(256),live:false})).length` is 1100), and `cryptsetup` imported exactly that token. A header with three keyslots was 1342 bytes of compact JSON, and 1934 with a 588-byte tag, against 12,288. On an otherwise empty header, a token holding a 12,000-letter string was refused and one holding 11,500 accepted.
5. **The real box's header is formatted by `systemd-repart`, which the planner only read.** `systemd-repart` v257 (`src/repart/repart.c`, fetched with `curl`) formats with `struct crypt_params_luks2 luks_params = { .label = strempty(ASSERT_PTR(p)->new_label), … }` (lines 4480–4484) and calls `crypt_format` with it (lines 4559–4566); `grep -n -i "subsystem\|metadata_size"` over that file finds no match. So on a repart-made disk the LUKS2 label holds the partition's own label (one more reason the tag never uses it), the subsystem marker PR 1 recognises (`waitron-box-1`, `scripts/box/disk-state.mjs:31-38`) has to be set by some other step, and the JSON area is libcryptsetup's default, which this planner did not measure through `crypt_format`. systemd's TPM and recovery tokens will also sit in that area. All three are slice 1's recipe and rig (Task 8 records them).
6. **Why not the label field, again.** Besides P57's 48 bytes, the format calls the label "ASCII label or empty" (finding 2), and an accented venue name is not ASCII.
7. **The venue's name has no general length limit.** `tenants.legal_name` is plain text (`packages/db/src/schema/tenants.ts:45`, `label("legal_name")`; `label` is `text(name)` at `packages/db/src/schema/columns.ts:162`). The dashboard's legal-name route refuses only an empty name and whatever the optional fiscal seat's `validateLegalName` refuses (`apps/server/src/venue-settings-api.ts:265-267`, `deps.fiscal.venueFields?.validateLegalName`). The Veri\*Factu seat caps it at 120 code points (`packages/fiscal-verifactu/src/venue-fields.ts:31`, `NOMBRE_RAZON_MAX = 120`; checked at `:83`) and allows tab, line feed and carriage return (`CONTROL_CHARS`, `:35`). The server stores the name NFC-normalised and trimmed (`normalizeVenueText`, `apps/server/src/venue-details.ts:62-64`). So a tag limit can cover every name the Veri\*Factu seat admits, but not every name a venue without it could hold (decisions D3 and D4).
8. **The installer's decisions already hold a text rule and a placeholder limit.** `usableText` (`scripts/box/installer-policy.mjs:77-82`) refuses a non-string, a string that is not well-formed, any character U+0000–U+001F or U+007F–U+009F, and a length outside 1 to the limit in code points; `usableTag` applies it after NFC with the limit 256 (`:195-199`). Typed text is compared only up to 512 UTF-16 units after NFC (`MAX_TYPED_UNITS`, `:62`, `:310-313`), so a 256-code-point name, at most 512 units, can always be typed. Tests that pin 256: `scripts/box/installer-policy.test.mjs:427-443` and `:1024-1030`. They stay unchanged (Task 2).
9. **The token's own byte form.** `cryptsetup` keeps key order (finding 3), and its dump is pretty-printed with two-space indents and no space after a colon (the fixture in Task 3, captured from cryptsetup 2.7.5; `LUKS2_hdr_dump_json` prints with `JSON_C_TO_STRING_PRETTY | JSON_C_TO_STRING_NOSLASHESCAPE`, `lib/luks2/luks2_json_metadata.c:2212-2213`). So the finder parses the whole dump as JSON and returns the token as `JSON.stringify` writes it, which keeps the parsed key order; the decoder then demands the exact canonical bytes (D2).
10. **An unknown token type at unlock, read only.** When a token handler for a type outside the `luks2-` prefix fails, `cryptsetup` turns its error into "no such token" and moves on: `translate_errno` (`lib/luks2/luks2_token.c:500-507`) maps a positive result, `-EINVAL` or `-EPERM` to `-ENOENT` "&& !is_builtin_candidate(type)". The tag is assigned to no keyslot (`"keyslots":[]`). Whether `systemd-cryptsetup`'s automatic unlock then behaves exactly as without the tag is a Linux rig check ("Out").
11. **The Wi-Fi settings' vocabulary is NetworkManager's.** NetworkManager 1.52.0 (`src/libnm-core-impl/nm-setting-wireless-security.c`, fetched with `curl`): "Key management used for the connection. One of "none" (WEP or no password protection), "ieee8021x" (Dynamic WEP), "owe" (Opportunistic Wireless Encryption), "wpa-psk" (WPA2 + WPA3 personal), "sae" (WPA3 personal only), "wpa-eap" (WPA2 + WPA3 enterprise) or "wpa-eap-suite-b-192" (WPA3 enterprise only). This property must be set for any Wi-Fi connection that uses security." (lines 1401–1407). Its `verify` accepts exactly those seven (line 897). Whether NetworkManager itself holds the password is its secret flags: `NM_SETTING_SECRET_FLAG_NONE`: "the system is responsible for providing and storing this secret (default)"; `AGENT_OWNED`: "a user secret agent is responsible for providing and storing this secret"; `NOT_SAVED`: "this secret should not be saved" (`src/libnm-core-public/nm-setting.h:43-49`). Version 1 of the record (PR 2) loads only `wpa-psk` and `sae` (`scripts/box/wifi-record.mjs:21`).
12. **The root Vitest project needs no change.** Its test glob is `scripts/**/*.test.mjs` (`vitest.config.ts:71`), its coverage glob `scripts/**/*.mjs` and thresholds `98/98/98/95` (`:119-120`); PR 3's plan proved a new `scripts/box/` file is found and measured on its own by the one-file command (its re-map finding 2). No root guard lists `scripts/box/` files (`grep -rln "scripts/box"` over `scripts` outside `scripts/box/` finds none).
13. **Baseline, run on 2026-11-03:** `pnpm exec vitest run scripts/box/<file>.test.mjs` printed `Tests 453 passed` for `installer-policy`, `146 passed` for `wifi-record` and `118 passed` for `disk-state`. Those counts may only grow, and no existing assertion changes.
14. **`docs/backlog/box.md` has a `## Decisions and deliberate limits` section** (line 1095), so the owner's answer goes there (`docs/backlog.md` → "How to keep this file honest": "A decision a comment or doc cites moves to its area's `## Decisions and deliberate limits`").

### Provenance of the outside facts

| Claim used here | Source's own words | Source |
| --- | --- | --- |
| A token is the place for user-defined data | "The token can contain user-defined metadata that are not part of the basic LUKS2 definition (in general, any JSON metadata can be stored as a token)." | LUKS2 On-Disk Format Specification 1.1.4, `luks2_doc.tex:238-239`, gitlab.com/cryptsetup/LUKS2-docs, fetched 2026-11-03 |
| `type` and `keyslots` are mandatory; `luks2-` is reserved | "type [string] the token type (tokens with luks2- prefix are reserved for the implementation internal use)"; "keyslots [array] the array of keyslot objects names that are assigned to the token" | same, lines 1031–1038 |
| Tokens are named by decimal numbers | "all JSON objects must have their names formatted as a string that represents a number in the decimal notation (unsigned integer)" | same, lines 510–512 |
| Label and subsystem are binary-header fields | `char label[LABEL_L]; // ASCII label or empty`; `char subsystem[LABEL_L]; // owner subsystem label or empty` | same, lines 360, 364 |
| The JSON area is fixed in size | "The header cannot store larger metadata than this fixed JSON area." | same, line 443 |
| At most 32 tokens | `#define LUKS2_TOKENS_MAX 32` | cryptsetup v2.7.5 `lib/luks2/luks2.h:28`, fetched 2026-11-03 |
| Import onto a used number needs `--token-replace` | "If --token-id is used with action _add_ or action _import_ and a token with that ID already exists, option --token-replace can be used to replace the existing token." | cryptsetup v2.7.5 `man/cryptsetup-token.8.adoc:46-48` |
| A token too big is refused | `log_dbg(cd, "Not enough space in header json area for new token."); … return -ENOSPC;` | cryptsetup v2.7.5 `lib/luks2/luks2_token.c:402-406` |
| Unknown token failures become "no token" | `if ((ret_val > 0 \|\| ret_val == -EINVAL \|\| ret_val == -EPERM) && !is_builtin_candidate(type)) { … ret_val = -ENOENT;` | cryptsetup v2.7.5 `lib/luks2/luks2_token.c:500-507` |
| repart sets the LUKS2 label from the partition label | `.label = strempty(ASSERT_PTR(p)->new_label),` | systemd v257 `src/repart/repart.c:4481`, fetched 2026-11-03 |
| NetworkManager's key management values | quoted in finding 11 | NetworkManager 1.52.0 `nm-setting-wireless-security.c:1401-1407` |
| NetworkManager's secret flags | quoted in finding 11 | NetworkManager 1.52.0 `nm-setting.h:43-49` |

The fetched files' SHA-256 sums (`shasum -a 256`), for anyone re-fetching; the planner's copies were in a `mktemp -d` folder outside the repository:

- `lib/luks2/luks2.h` `10736540b3f911b48df6e720cea060711f223aab035ba23f279f0686eb7cec18`
- `lib/luks2/luks2_token.c` `9b120eea47ea685b259a169f0f6b74f8e1001d7c60bfeaf95567d794c2e91544`
- `lib/luks2/luks2_json_metadata.c` `5351177e2d3a55260fc51e52857ee6e6a867c7b24132c8298e97985d181f1b1b`
- `src/cryptsetup.c` `fb082d2470dbebace45482e539be6c8856b73990bffa252061482cae3ffd2778`
- `man/cryptsetup-token.8.adoc` `3461382161f15334cb7bb95d508b330f604937d50046cde255351ea2d3360fc7`
- `luks2_doc.tex` `48627849e5ddfe6d9cf5ad9596672f5f251294d7499ad1071a37259595528c5c`
- systemd v257 `src/repart/repart.c` `9853024aab7583281301cb6c7228df750b086aeca25244e71cbff578e695ea71`
- NetworkManager 1.52.0 `nm-setting-wireless-security.c` `01227d05491c642acc23a321bd20ad2b1c0201f0a52169be856cea5369097e04`
- NetworkManager 1.52.0 `nm-setting.h` `8f506d3d0dbdbc84f20d2f6fcdd65161961ebe4fec38f45cc4cc1fba114fbc12`

### Decisions where the parent plan or spec left a choice

Each is the conservative option the planner could find; each is recorded in the backlog (Task 8).

- **D1. The tag is one LUKS2 token of type `waitron-name-tag`, version 1, assigned to no keyslot.** Its fields are exactly `type`, `keyslots` (always `[]`), `version` (always `1`), `name` and `live`. The type avoids the reserved `luks2-` prefix, which `cryptsetup` refuses (finding 3), and is spelled like systemd's own token types (`systemd-tpm2`, `systemd-recovery`). It is never the label, never the subsystem, never a partition field.
- **D2. One canonical byte form.** The tag's bytes are `JSON.stringify({type, keyslots: [], version: 1, name, live})`, where `name` is `usableVenueName(tag.name)` (the NFC form), in that key order, UTF-8, no whitespace, no final newline. `decodeNameTag` accepts only bytes equal to that form; everything else, including a future `version` 2, is `null`. The largest tag is 1100 bytes (`NAME_TAG_MAX_BYTES`, finding 4), and longer input is `null` before any parsing.
- **D3. One text rule, and 256 code points is now the real limit.** `usableVenueName(value)` returns the NFC form of a name, or `null` when the name is not a string, not well-formed, holds a character U+0000–U+001F or U+007F–U+009F, or is outside 1 to `NAME_TAG_MAX_CODE_POINTS` = 256 code points after NFC. This is the installer's existing rule (finding 8) moved into `name-tag.mjs`; `installer-policy.mjs` imports it (Task 2), so its 256 placeholder becomes this constant with no change in behaviour. 256 is kept because it covers every name the Veri\*Factu seat admits (120, finding 7) with room, its largest tag (1100 bytes) fits the measured default area beside three keyslots (finding 4), and every 256-code-point name can still be typed within the installer's 512-unit limit (finding 8). Raising it later means raising `MAX_TYPED_UNITS` too.
- **D4. A name the rule refuses gets no tag, never a cut-down one.** `planNameTagWrite` then removes any tag and says `name-unusable`, so the stick asks for the erase word, as the spec does when the tag "cannot be read" (line 263–264). A truncated name would be one nobody could type to match. Cases: a name over 256 code points on a venue without the Veri\*Factu seat, and a name holding a tab, which the Veri\*Factu seat allows (finding 7).
- **D5. The decoder throws only for a caller's mistake.** A non-`Uint8Array` input throws `name_tag.input_invalid`; any bytes answer a tag or `null`.
- **D6. The finder answers `null` unless exactly one token has Waitron's type.** Zero tags, two or more (finding 3: `cryptsetup` allows two), and a header that is not valid UTF-8 JSON with a `tokens` object are all `null`. Tokens of other types are ignored. A lone Waitron-type token that is malformed is returned, and the decoder turns it into `null`. The finder refuses input over `NAME_TAG_METADATA_MAX_BYTES` = 16 MiB as `null` without parsing: four times the largest JSON area the format lists (4,092 KiB, `luks2_doc.tex` table at lines 316–335), against a pretty-to-compact size ratio of 1.54 measured on a three-keyslot header (2063 and 1342 bytes); the bound is this plan's choice.
- **D7. The write plan's steps.** With a usable name: if exactly one Waitron token already holds the same bytes, no steps (`unchanged`); else if one or more Waitron tokens exist, **replace the lowest-numbered one first, then remove the others** in ascending order, so a power cut between steps leaves two or more tags, which read as unreadable, never one old name; else import at the lowest free number from 0 to 31; with none free, refuse `no-free-token` and change nothing. With `tag` `null` or an unusable name, remove every Waitron token in ascending order. A cut in the middle of removing two or more can leave one old tag readable until the next write; that is the one path where a stale name can show, it needs a doubled tag first, and the plan names it. A header whose token numbers are not exactly the decimals 0 to 31 (for example `"007"`, `"32"`, `"-1"`) is refused `metadata-unreadable`: the plan does not guess which number `cryptsetup` would use.
- **D8. The plan does not check the area's free space.** `cryptsetup` refuses a token that does not fit; for an import onto a free number the header was measured byte-identical afterwards, and for a replacement that is read from its source, not measured (finding 3). The adapter reports the refusal. A second, estimated check here could only disagree with the real one.
- **D9. Steps never assign a keyslot,** so the adapter has no `--key-slot` to pass; every step's JSON has `"keyslots":[]`.
- **D10. `formatWifiRecord` is the reader run backwards.** It builds the canonical version-1 bytes PR 2 defined (`JSON.stringify({version: 1, ssidHex, keyMgmt, psk, hidden}) + "\n"`), then runs `parseWifiRecord` on them, and returns them when it answers `loaded`. There is no field-by-field comparison: the bytes are built from the fields, and the reader's own canonical check (`scripts/box/wifi-record.mjs:102-105`) already refuses bytes that are not exactly that form, so a comparison would always agree and its other branch would be one no test reaches (reasoning, not tested). Otherwise it throws `wifi_record.network_invalid` with the reader's reason (`record-corrupt`, `record-unsupported`), or `network-invalid` for a wrong shape. The error carries no field value.
- **D11. `decideWifiBootCopy` speaks NetworkManager's words** (finding 11) and answers `write` or `remove`. "Remove" means no copy should exist: an older copy for another network is obsolete and goes too (spec line 707–708, "switching to cable-only or forgetting the selected Wi-Fi removes it"). Each "remove" carries one reason:

  | Settings | Reason |
  | --- | --- |
  | cable only | `cable-only` |
  | Wi-Fi with no security setting (`keyMgmt` `null`) | `open` |
  | `none` ("WEP or no password protection") | `open-or-wep` |
  | `ieee8021x` ("Dynamic WEP") | `dynamic-wep` |
  | `owe` | `owe` |
  | `wpa-eap`, `wpa-eap-suite-b-192` | `enterprise` |
  | any other string | `unsupported-security` |
  | `wpa-psk` or `sae` with no password the host can read (`psk` `null`) | `password-unavailable` |
  | `wpa-psk`, 8–63 code points, one outside printable ASCII (the reader's count, `[...psk].length`, `scripts/box/wifi-record.mjs:41-45`) | `password-not-printable` (PR 2's version-1 gap) |
  | `sae`, a valid password over 256 UTF-8 bytes | `password-too-long` (PR 2's bound) |
  | any other password the reader refuses | `password-invalid` |

  The security type is checked before the password, so an open network reports `open` whatever `psk` holds. **The password reasons come from the reader, not a second copy of its rules:** for `wpa-psk` and `sae` with a string `psk`, the decision calls `formatWifiRecord`; a `record-unsupported` throw becomes `password-not-printable` and a `record-corrupt` throw `password-invalid`. The shape checks run first (D12), so those throws can only be about the password. The one reason the reader cannot give is `password-too-long`: it answers `record-corrupt` for a 257-byte WPA3 password and for one holding U+0000 alike (both run with `node` against `parseWifiRecord` on 2026-11-03), so for `sae` the decision itself answers `password-too-long` when the password is well-formed, holds no character U+0000–U+001F or U+007F, and is over 256 UTF-8 bytes. Measured the same day: 40 emoji (80 UTF-16 units, 40 code points) as a WPA2 password → `record-unsupported`; `"\u{1F600}".repeat(4) + "a"` (9 units, 5 code points) → `record-corrupt`; `"pass\u00F1word"` → `record-unsupported`.
- **D12. A wrong shape throws.** `decideWifiBootCopy` throws `wifi_record.settings_invalid` (`settings-invalid`) for settings that are not exactly `{kind: "cable-only"}` or `{kind: "wifi", ssidHex, keyMgmt, psk, hidden}`, an `ssidHex` outside PR 2's rule (lowercase hex, 1–32 bytes), a `keyMgmt` that is neither `null` nor a string, a `psk` that is neither `null` nor a string, or a `hidden` that is not a boolean. These are the adapter's bugs, not network kinds.
- **D13. The owner's decision on a Waitron box with its TPM or Secure Boot off** (owner, 2026-11-03 ~09:20, relayed by the watcher): "turn the backlog's 'For the owner' paragraph into a decision … and keep D2 as built. The timings (15 s, two minutes, 60 s, one minute) stay the spec's proposals; the owner was not asked about those." The stick starts the installed Waitron after 15 seconds so the venue keeps selling; the screen and the status page name the setting that is off; slice 3's host service raises the alert; a reinstall on that box stays refused. No code changes: PR 3 built it as its D2 (`scripts/box/installer-policy.mjs`).

## Execution notes for every task

**Worktree.** Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-4-name-tag-wifi-copy`, and run commands from that folder.

**Style precedent.**
- `scripts/box/wifi-record.mjs` sets the style for strict byte formats: fatal UTF-8 decoding with `ignoreBOM: true`, `exactRecord` from `scripts/box/upgrades/contracts.mjs`, and a byte-for-byte comparison with the canonical form (`sameBytes`, `:35-37`, used at `:102-105`).
- Errors are `Object.assign(new Error(code), { code, reason })` (`scripts/box/installer-policy.mjs:71-73`). An expected outcome is returned, not thrown; only a caller's programming error throws.
- No decision number (D1, D2 …) goes into code, a comment or a test name; cite the spec section or nothing. PR 1–3's code has none: `grep -rnE '\bD[0-9]+\b' scripts/box` found no match in any `.mjs` file on 2026-11-03.
- Returned objects are frozen. A `Uint8Array` with elements cannot be frozen (`Object.freeze` throws on it), so a frozen answer holds a fresh array that the caller may change without affecting a later call.

**Test conventions.**
- Tests import `describe`, `expect`, `it` (and `vi` where a spy is named) from `vitest`.
- **Red means a named assertion failing.** Before implementing, add the new exports as stubs that throw `new Error("not implemented")` (constants get their real values), so the red run reports each case failing with "not implemented" or on its assertion, not one import error for the whole file.
- Do not import from another `*.test.mjs` file (its tests would run twice); copy the helpers a task names.

**Coverage for one file.** Read the summary counts; `0/0` means the include matched nothing. The run must exit 0 at 98/98/98/95; aim for 100%.
`pnpm exec vitest run scripts/box/<name>.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/<name>.mjs`

**Before each commit.** `pnpm exec prettier --check <changed .mjs files>` and `pnpm exec eslint <changed .mjs files>`, each checked for its own exit status, and read the `Tests` count (CLAUDE.md §4). `docs/` is ignored by prettier whole (`pnpm exec prettier --file-info docs/backlog/box.md` prints `"ignored": true`), so Task 8 checks nothing with prettier. The pre-push hook and CI do the rest; do not run the whole workspace.

**Long runs.** An implementer past about 150 tool calls with the task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover: what is done, what is left, which files, and each check's state.

**Order.** Tasks 1→2→3→4→5 one after another (`name-tag.mjs` and its test, with Task 2 touching `installer-policy.mjs`), then 6→7 (`wifi-record.mjs` and its test), then 8. Tasks 6–7 do not depend on 1–5 and may run first. All in this one worktree (CLAUDE.md §6).

---

### Task 1: the text rule, the limits, the encoder and the decoder

**Files:**
- Create: `scripts/box/name-tag.mjs`
- Test: `scripts/box/name-tag.test.mjs`

**Interfaces:**
- Consumes: `exactRecord` from `scripts/box/upgrades/contracts.mjs`.
- Produces:

```js
export const NAME_TAG_TYPE; // "waitron-name-tag"
export const NAME_TAG_VERSION; // 1
/** The longest venue name a tag holds, in code points after NFC. */
export const NAME_TAG_MAX_CODE_POINTS; // 256
/** 76 bytes of fixed text plus 256 four-byte characters. */
export const NAME_TAG_MAX_BYTES; // 1100
/** cryptsetup v2.7.5 lib/luks2/luks2.h:28. */
export const LUKS2_TOKENS_MAX; // 32
/**
 * @typedef {{ name: string, live: boolean }} VenueTag  frozen; display only (spec §7.6)
 */
/** Pure. The name's NFC form, or null when a tag cannot hold it. Never throws. @param {unknown} value @returns {string|null} */
export function usableVenueName(value);
/**
 * Pure. Encodes usableVenueName(tag.name), the name's NFC form, so a decomposed name is stored composed.
 * Throws name_tag.tag_invalid: reason "tag-invalid" unless tag is exactly {name: string, live: boolean};
 * reason "name-unusable" when usableVenueName(name) is null. @param {VenueTag} tag @returns {Uint8Array} a fresh array
 */
export function encodeNameTag(tag);
/** Pure. Throws name_tag.input_invalid (input-invalid) unless bytes is a Uint8Array. @param {Uint8Array} bytes @returns {VenueTag|null} */
export function decodeNameTag(bytes);
```

**Rules for `decodeNameTag`, in order.**
1. Not a `Uint8Array` → throw.
2. Longer than `NAME_TAG_MAX_BYTES` → `null`, without calling `JSON.parse`.
3. Not valid UTF-8 (`new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`) → `null`.
4. Not JSON → `null`.
5. Not exactly the five keys; `type` not `NAME_TAG_TYPE`; `keyslots` not an empty array; `version` not the number 1; `live` not a boolean; `usableVenueName(name) !== name` (unusable, or not already NFC) → `null`.
6. The bytes are not exactly `encodeNameTag({name, live})` → `null` (key order, whitespace, `\u00c0` written as an escape).
7. Otherwise a frozen `{name, live}`.

- [ ] **Step 1: Write the failing tests.** A helper `utf8(text)` is `new TextEncoder().encode(text)`; `canonical(name, live)` is `utf8(JSON.stringify({type: "waitron-name-tag", keyslots: [], version: 1, name, live}))`.
  - **Constants:** the five constants have the values above; `encodeNameTag({name: "\u{1F600}".repeat(256), live: false}).length` is exactly `NAME_TAG_MAX_BYTES` (1100), and `encodeNameTag({name: '"'.repeat(256), live: false}).length` is 588 (each `"` becomes `\"`), both measured by the planner (re-map finding 4).
  - **`usableVenueName`:** `"Bar Santet"` → itself; `"Bar A\u0300ngels"` → `"Bar \u00C0ngels"`; `"\u{1F600}".repeat(256)` → itself; `"e\u0323\u0302".repeat(256)` (768 code points before NFC) → `"\u1EC7".repeat(256)`; each of `""`, `"\u{1F600}".repeat(257)`, `"Bar\u0007"`, `"Bar\u0085"`, `"Bar\u007F"`, `"Bar\t"` (a tab, which the Veri\*Factu seat allows, re-map finding 7), `"Bar\uD800"`, `7`, `null` → `null`. These are installer-policy's own unreadable cases (`scripts/box/installer-policy.test.mjs:427-434`) plus the tab, the decomposed long name and non-strings.
  - **Encoder:** `{name: "Bar \u00C0ngels", live: true}` → bytes equal to `utf8('{"type":"waitron-name-tag","keyslots":[],"version":1,"name":"Bar \u00C0ngels","live":true}')`; `{name: "Bar A\u0300ngels", live: false}` → `canonical("Bar \u00C0ngels", false)`; two calls return different arrays with equal bytes.
  - **A name that looks like a marker:** `{name: '","subsystem":"waitron-box-1","label":"x', live: true}` → `Object.keys(JSON.parse(text))` is exactly `["type", "keyslots", "version", "name", "live"]`, and the parsed `name` equals the input (the name stays inside one JSON string; spec §7.6's "never the fields that mark the disk").
  - **Encoder refusals:** each unusable name above → throws `{code: "name_tag.tag_invalid", reason: "name-unusable"}`; `null`, `{name: "Bar"}`, `{name: "Bar", live: true, extra: 1}`, `{name: "Bar", live: "true"}`, `{name: 7, live: true}` → throws reason `tag-invalid`.
  - **Round trip:** for `"Bar Santet"`, `"Bar \u00C0ngels"`, `"Café Àngels and the Old Crème Brûlée Kitchen on Main Street"` (PR 1's 60-character case, over the 48-byte label), the 256-emoji name, the 256-quote name, `"\\".repeat(256)` and `'a/b'`, with `live` true and false: `decodeNameTag(encodeNameTag(tag))` equals the tag and is frozen. A decomposed input comes back composed: `decodeNameTag(encodeNameTag({name: "Bar A\u0300ngels", live: true}))` equals `{name: "Bar \u00C0ngels", live: true}`.
  - **Decoder `null` cases:** `canonical("Bar", true)` with a space after the first `{`; with a final `"\n"`; keys `name` and `live` swapped; an extra `"subsystem":"waitron-box-1"` key; `live` missing; `type` `"luks2-name-tag"` and `"Waitron-name-tag"`; `keyslots` `["0"]`; `version` `2`, `"1"` and `1.0` written as `1.0`; `live` `"true"`; `name` `""`; `name` `"Bar A\u0300ngels"` (decomposed: not NFC); `name` 257 ASCII letters; `name` holding U+0085; the name `"Bar \\u00c0ngels"` written with a JSON escape (valid JSON, same parsed value, not the canonical bytes); a byte-order mark before the record; a 0xFF byte inside the name; `"not json"`; `"[]"`; `"null"`.
  - **Size first:** `NAME_TAG_MAX_BYTES + 1` bytes of spaces → `null`, and `vi.spyOn(JSON, "parse")` records no call (restore the spy after).
  - **Input:** `null`, `undefined`, a string, an `Array`, a `Buffer`-like plain object → throws `{code: "name_tag.input_invalid", reason: "input-invalid"}` (so a caller holding `findNameTag`'s `null` must not pass it on; D5); a `Buffer` (a `Uint8Array`) holding canonical bytes decodes.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/name-tag.test.mjs`. Expected: the constant cases pass, every other case fails with "not implemented"; no import error.
- [ ] **Step 3: Implement** the four functions. `usableVenueName` normalises first, then checks well-formedness, the control range and the code-point count, exactly as `installer-policy.mjs:77-82` and `:195-199` do today.
- [ ] **Step 4: Run green**, then the coverage command for `name-tag.mjs`.
- [ ] **Step 5: Deletion controls.** Make each change, run, see the named case fail, undo:
  - Drop rule 6's byte comparison → the space, newline, swapped-keys and escaped-name cases decode.
  - Drop the NFC equality in rule 5 (accept any usable name) → the decomposed-name case decodes.
  - Accept any `keyslots` array → the `["0"]` case decodes.
  - Move rule 2 after the parse → the size-first case records a `JSON.parse` call.
  - Normalise without counting after NFC (count the raw string) → the decomposed 768-code-point case answers `null`.
- [ ] **Step 6: Commit.** `git add scripts/box/name-tag.mjs scripts/box/name-tag.test.mjs && git commit -s -m "feat(box): define the name tag's one byte form and its text rule"`. The body says the tag is a LUKS2 token of Waitron's own type (D1), lists D2, D3 and D5, names the deletion controls, and says nothing writes or reads a real header yet.

### Task 2: the installer's decisions use the same rule

**Files:**
- Modify: `scripts/box/installer-policy.mjs` only. `scripts/box/installer-policy.test.mjs` is not changed.

- [ ] **Step 1: Baseline.** `pnpm exec vitest run scripts/box/installer-policy.test.mjs`; expect `Tests 453 passed` (re-map finding 13).
- [ ] **Step 2: Change.** Import `usableVenueName` from `./name-tag.mjs`. `usableTag(tag)` becomes: `null` for `null`; otherwise `const name = usableVenueName(tag.name)`, and `null` when that is `null`, else `Object.freeze({ name, live: tag.live })`. The literal `256` disappears from the file. `usableText` stays for `eraseWord` (its 32-code-point check, `:107`).
- [ ] **Step 3: Run** the same command: `Tests 453 passed` again, no test edited (`git diff --stat` names only `installer-policy.mjs`). Then the coverage command for `installer-policy.mjs`.
- [ ] **Step 4: Deletion control (proves the one limit is shared).** Set `NAME_TAG_MAX_CODE_POINTS` to 255 in `name-tag.mjs`; run both `installer-policy.test.mjs` and `name-tag.test.mjs`: installer-policy's "keeps a 256-code-point name" (`:439-443`) and the decomposed 256-code-point typing case (`:1024-1030`) fail, and Task 1's 256-emoji cases fail. Undo, and rerun both green.
- [ ] **Step 5: Commit.** `git add scripts/box/installer-policy.mjs && git commit -s -m "refactor(box): the installer reads venue names with the name tag's own rule"`. The body says no behaviour changed (453 before and after, no test edited), that PR 3's 256 placeholder is now the format's limit (D3), and names the deletion control.

### Task 3: finding the tag in the whole header

**Files:**
- Modify: `scripts/box/name-tag.mjs`, `scripts/box/name-tag.test.mjs`
- Modify: `scripts/box/disk-state.mjs`, the JSDoc of `nameTag` only (line 17)

**Interfaces (added):**

```js
/** Four times the largest JSON area LUKS2 lists. */
export const NAME_TAG_METADATA_MAX_BYTES; // 16 * 1024 * 1024
/**
 * Pure. metadata is what `cryptsetup luksDump --dump-json-metadata` prints. Answers the one token of type
 * NAME_TAG_TYPE as JSON.stringify writes it (its own key order kept), or null for none, two or more, or
 * metadata that is not UTF-8 JSON with a `tokens` object. Throws name_tag.input_invalid unless metadata is a Uint8Array.
 * @param {Uint8Array} metadata @returns {Uint8Array|null} a fresh array
 */
export function findNameTag(metadata);
```

**`disk-state.mjs` line 17** becomes: `@property {Uint8Array|null} nameTag  the name-tag token's bytes as findNameTag (name-tag.mjs) returns them; display only, never read here`. No code change in that file.

**Test fixture.** `REAL_DUMP` is this exact text, captured by the planner on 2026-11-03 from `cryptsetup luksDump --dump-json-metadata` (cryptsetup 2.7.5, Debian 13 container) on a throwaway 64 MiB image after one `token import`. Its salts and digest are from that image and protect nothing. The output ends without a newline.

```js
const REAL_DUMP = `{
  "keyslots":{
    "0":{
      "type":"luks2",
      "key_size":64,
      "af":{
        "type":"luks1",
        "stripes":4000,
        "hash":"sha256"
      },
      "area":{
        "type":"raw",
        "offset":"32768",
        "size":"258048",
        "encryption":"aes-xts-plain64",
        "key_size":64
      },
      "kdf":{
        "type":"pbkdf2",
        "hash":"sha256",
        "iterations":1000,
        "salt":"I6yEof6QPPd2ryE0K/5SCaHhcJPTOqOa+ln+dx1Ttkc="
      }
    }
  },
  "tokens":{
    "0":{
      "type":"waitron-name-tag",
      "keyslots":[],
      "version":1,
      "name":"Bar Àngels",
      "live":true
    }
  },
  "segments":{
    "0":{
      "type":"crypt",
      "offset":"16777216",
      "size":"dynamic",
      "iv_tweak":"0",
      "encryption":"aes-xts-plain64",
      "sector_size":4096
    }
  },
  "digests":{
    "0":{
      "type":"pbkdf2",
      "keyslots":[
        "0"
      ],
      "segments":[
        "0"
      ],
      "hash":"sha256",
      "iterations":1000,
      "salt":"Y6PcR+jNKMBz6odZDxDfPoo9imDg54+aw3/AE2F5fpY=",
      "digest":"eqDuknDpVH6tdKmfWlW6jAZY2e/Sf8EmNbvCRIiZqCM="
    }
  },
  "config":{
    "json_size":"12288",
    "keyslots_size":"16744448"
  }
}`;
```

Helpers: `BASE` is `JSON.parse(REAL_DUMP)` without `tokens`; `header(tokens)` is `utf8(JSON.stringify({...BASE, tokens}))`; `TPM` is `{type: "systemd-tpm2", keyslots: ["0"], "tpm2-pcrs": [7]}` and `RECOVERY` is `{type: "systemd-recovery", keyslots: ["0"]}` (stand-ins named like systemd's tokens; their other fields are illustrative, not measured); `tagObject(name, live)` is `JSON.parse` of `canonical(name, live)`.

- [ ] **Step 1: Write the failing tests.**
  - `findNameTag(utf8(REAL_DUMP))` → bytes equal to `encodeNameTag({name: "Bar \u00C0ngels", live: true})`, and `decodeNameTag` of them → `{name: "Bar \u00C0ngels", live: true}`.
  - The same text compacted (`header(JSON.parse(REAL_DUMP).tokens)`) → the same bytes.
  - `header({})` → `null`; `header({0: TPM, 1: RECOVERY})` → `null`.
  - `header({0: TPM, 1: RECOVERY, 2: tagObject("Bar Santet", false)})` → the tag's canonical bytes.
  - **Two tags (Review Focus 1):** the same tag at 2 and 5 → `null`; two different tags → `null`; a good tag plus a Waitron-type token with `version: 2` → `null`.
  - **One malformed tag is returned and decodes to `null`:** `{type: "waitron-name-tag", keyslots: [], version: 2, name: "Bar", live: true}` alone → its `JSON.stringify` bytes, and `decodeNameTag` → `null`.
  - **Key order is kept, not repaired:** a lone tag object written with keys `live, name, keyslots, type, version` (as `cryptsetup` keeps them, re-map finding 3) → bytes whose `decodeNameTag` is `null`.
  - **Not ours:** `header({0: TPM})` → `null`; `{0: "waitron-name-tag"}` (a string, not an object) and `{0: {type: "Waitron-name-tag", keyslots: []}}` → `null`.
  - **Unreadable header:** a 0xFF byte inside `REAL_DUMP`; a byte-order mark before it; `"not json"`; `"[]"`; `"null"`; `{...BASE}` with no `tokens`; `tokens` `[]`; `tokens` `null` → `null`.
  - **Size first:** `NAME_TAG_METADATA_MAX_BYTES + 1` bytes of spaces → `null`, and `vi.spyOn(JSON, "parse")` records no call.
  - **Fresh bytes:** zero the first answer's bytes; a second call on the same input still decodes.
  - **Input:** a string or an `Array` → throws `{code: "name_tag.input_invalid", reason: "input-invalid"}`.
- [ ] **Step 2: Run red** (`pnpm exec vitest run scripts/box/name-tag.test.mjs`): the new cases fail with "not implemented"; Task 1's cases still pass.
- [ ] **Step 3: Implement** `findNameTag`, sharing one private `readTokens(metadata)` (size, UTF-8, JSON, `tokens` a plain object; `null` otherwise) that Task 4 reuses. Edit the `disk-state.mjs` JSDoc line.
- [ ] **Step 4: Run green**, then the coverage command for `name-tag.mjs`, and `pnpm exec vitest run scripts/box/disk-state.test.mjs` (`118 passed`).
- [ ] **Step 5: Deletion controls.**
  - Return the first Waitron token when there are two → both two-tag cases answer bytes.
  - Rebuild the answer with `encodeNameTag` from the parsed fields instead of `JSON.stringify(token)` → the key-order case decodes.
  - Drop the type filter (take any lone token) → the `header({0: TPM})` case answers bytes.
  - Move the size check after the parse → the size-first case records a call.
- [ ] **Step 6: Commit.** `git add scripts/box/name-tag.mjs scripts/box/name-tag.test.mjs scripts/box/disk-state.mjs && git commit -s -m "feat(box): find the one name tag in a header's metadata and refuse two"`. The body says the fixture is a real cryptsetup 2.7.5 dump, lists D6, and names the controls.

### Task 4: the write plan

**Files:**
- Modify: `scripts/box/name-tag.mjs`, `scripts/box/name-tag.test.mjs`

**Interfaces (added):**

```js
/**
 * @typedef {{op:'import', tokenId:number, json:Uint8Array}
 *   | {op:'replace', tokenId:number, json:Uint8Array}
 *   | {op:'remove', tokenId:number}} NameTagStep  frozen object; json is a fresh array
 *   import: `cryptsetup token import --token-id <tokenId>`; replace: the same with --token-replace;
 *   remove: `cryptsetup token remove --token-id <tokenId>`. Never --key-slot.
 * @typedef {object} NameTagWritePlan  frozen
 * @property {'unchanged'|'write'|'remove'|'refused'} kind
 * @property {null|'name-unusable'|'no-free-token'|'metadata-unreadable'} reason
 * @property {readonly NameTagStep[]} steps  frozen; run in order; empty for unchanged and refused
 */
/**
 * Pure. tag null means "this box has no tag" (spec §7.6). Throws name_tag.input_invalid unless metadata is a
 * Uint8Array; name_tag.tag_invalid (tag-invalid) unless tag is null or exactly {name: string, live: boolean}.
 * @param {Uint8Array} metadata @param {VenueTag|null} tag @returns {NameTagWritePlan}
 */
export function planNameTagWrite(metadata, tag);
```

**Rules.**
1. `readTokens` answers `null`, or any token key is not one of `"0"` … `"31"` exactly → `refused`, `metadata-unreadable`, no steps.
2. `ours` = the numbers of tokens that are plain objects with `type === NAME_TAG_TYPE`, ascending.
3. Desired bytes: `tag` `null` → none, reason `null`; `usableVenueName(tag.name)` `null` → none, reason `name-unusable`; otherwise `encodeNameTag({name: <the NFC name>, live: tag.live})`.
4. Desired bytes, `ours` is one token whose `JSON.stringify` bytes equal them → `unchanged`, reason `null`.
5. Desired bytes, `ours` not empty → `write`: `replace` at `ours[0]`, then `remove` at each later number.
6. Desired bytes, `ours` empty → the lowest number 0–31 not in `tokens`: `write` with one `import` there; none free → `refused`, `no-free-token`.
7. No desired bytes, `ours` empty → `unchanged`, with rule 3's reason. `ours` not empty → `remove`, one `remove` per number ascending, with rule 3's reason.

- [ ] **Step 1: Write the failing tests** (Task 3's helpers; `BAR = {name: "Bar Santet", live: true}`; `others(n)` is `n` `{type: "filler", keyslots: []}` tokens at 0 … n−1).
  - `header({})`, `BAR` → `{kind: "write", reason: null, steps: [{op: "import", tokenId: 0, json: encodeNameTag(BAR)}]}`.
  - `header({0: TPM, 1: RECOVERY})` → import at 2; `header({0: TPM, 1: RECOVERY, 3: TPM})` → import at 2 (lowest free, not next after the highest).
  - `header(others(32))` → `{kind: "refused", reason: "no-free-token", steps: []}`.
  - `header({...others(31), 31: tagObject("Old", false)})`, `BAR` → replace at 31.
  - `header({4: tagObject("Bar Santet", true)})`, `BAR` → `unchanged`, no steps; the same with `{name: "Bar Santet", live: false}` → replace at 4.
  - `header({5: tagObject("Old", true), 2: tagObject("Old", true)})`, `BAR` → steps exactly `[replace 2, remove 5]`, in that order (D7).
  - A lone malformed Waitron token (version 2) at 6 → replace at 6.
  - `tag` `null`: `header({4: tagObject("Old", true), 0: TPM})` → `{kind: "remove", reason: null, steps: [remove 4]}`; `header({0: TPM})` → `{kind: "unchanged", reason: null, steps: []}`.
  - **Unusable name (D4):** `{name: "\u{1F600}".repeat(257), live: true}` with a tag at 4 → `{kind: "remove", reason: "name-unusable", steps: [remove 4]}`; with none → `{kind: "unchanged", reason: "name-unusable", steps: []}`; `{name: "Bar\tSantet", live: true}` the same.
  - **NFC:** a header holding `tagObject("Bar \u00C0ngels", true)` and `tag` `{name: "Bar A\u0300ngels", live: true}` → `unchanged`.
  - **Unreadable or odd numbers:** `utf8("not json")`, and headers whose `tokens` has a key `"32"`, `"007"`, `"-1"`, `"a"` or `""` → `{kind: "refused", reason: "metadata-unreadable", steps: []}`.
  - **Throws:** `tag` `{name: "Bar"}` or `"Bar"` → `name_tag.tag_invalid` (`tag-invalid`); metadata a string → `name_tag.input_invalid`.
  - **Frozen:** the plan, its `steps` array and every step object are frozen; each step's `json` is a fresh `Uint8Array` (two plans' arrays are different objects with equal bytes).
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/name-tag.test.mjs`. Expected: the new `planNameTagWrite` cases fail with "not implemented"; Tasks 1 and 3's cases still pass; no import error.
- [ ] **Step 3: Implement** the rules.
- [ ] **Step 4: Run green**, then the coverage command.
- [ ] **Step 5: Deletion controls.**
  - Put the removes before the replace → the order case fails.
  - Use the number after the highest token → the `{0, 1, 3}` case imports at 4.
  - Skip rule 4 → the equal-tag case answers a replace.
  - Accept `"007"` as a number → its case does not refuse.
  - When none is free, replace token 0 instead of refusing → the `no-free-token` case fails.
  - Truncate an unusable name to 256 code points instead of removing → the D4 cases fail.
- [ ] **Step 6: Commit.** `git add scripts/box/name-tag.mjs scripts/box/name-tag.test.mjs && git commit -s -m "feat(box): plan a name-tag write that touches only Waitron's own token"`. The body lists D4, D7, D8 and D9, says the real `cryptsetup` adapter is slice 3's, and names the controls.

### Task 5: whole-flow sweep

**Files:**
- Modify: `scripts/box/name-tag.test.mjs` only

A test-only task: it checks properties across whole flows that no single case shows.

**Helpers.**
- `apply(headerObject, steps)` simulates `cryptsetup` as the planner measured it (re-map finding 3): `import` throws when the number is used or outside 0–31; `replace` sets the number (used or free); `remove` throws when the number is free; every step sets `tokens[String(tokenId)]` to `JSON.parse` of its `json` or deletes it, and nothing else. It returns a new object (use `structuredClone`).
- `readBack(tokens)` is `const bytes = findNameTag(header(tokens)); return bytes === null ? null : decodeNameTag(bytes);`. Every property below reads a tag through it: `decodeNameTag` throws on `null` (D5).
- Copy `completeWaitronDisk`, `machine` and the builders they need from `scripts/box/disk-state.test.mjs` lines 1–64 (do not import that file).

- [ ] **Step 1: Write the sweep.** Starting headers: `{}`; `{0: TPM, 1: RECOVERY}`; a tag at 0; a tag at 7 beside `TPM` at 0; two equal tags at 2 and 5; two different tags; a malformed Waitron token; `others(31)`; `others(31)` plus a tag at 31; `others(32)` (refused `no-free-token` for a name, so skipped by the properties below unless a control changes that). Desired tags: `BAR`; `{name: "Bar \u00C0ngels", live: false}`; the 256-emoji name; the 256-quote name; `{name: "Bar A\u0300ngels", live: true}`; `null`; the 257-emoji name. For every pair whose plan is not `refused`:
  - **Only Waitron's tokens (Review Focus 2):** every step's `tokenId` is a number that held a Waitron-type token in the start header, or a number absent from it. No step names a number holding another type.
  - **The bytes carry nothing else:** every `json` decodes with `decodeNameTag` to the desired tag with its name in NFC, and `Object.keys(JSON.parse(json))` is exactly the five keys, with no `label` or `subsystem`.
  - **Nothing else changes:** after `apply`, every token of another type deep-equals the start header's, and `keyslots`, `digests`, `segments` and `config` deep-equal the start's. This checks the plan's steps against the test's own simulator of `cryptsetup`, not `cryptsetup`: it is no evidence for the parent plan's "only tag bytes" sentence about a real header. The real-header evidence is re-map finding 3's container probe, and a real write stays a slice 3 rig check.
  - **The result reads back:** `readBack(after.tokens)` is the desired tag, or `null` when the desired tag is `null` or unusable.
  - **Once is enough:** planning again on the result answers `unchanged`.
  - **A cut between steps (D7):** for every plan with two or more steps, after applying each proper prefix of its steps, `readBack` of the result is `null` or the desired tag — and, for a `kind: "write"` plan, never a tag that the start header held and the desired tag differs from. For a `kind: "remove"` plan, the prefix may read as a tag from the start header; assert that this happens only when the start held two or more Waitron tokens (the one stale-name path D7 names).
  - **The disk is still recognised:** `classifyDisk(machine([completeWaitronDisk({nameTag})]))` equals its answer with `nameTag: null`, for `nameTag` each start header's and each result's `findNameTag` answer (skip `null`).
  - **The installer's screen shows it, before and after:** with `createInstallerState({atMs: 0, clockFloorMs: 0, eraseWord: "ERASE-CONFIRM"})` from `./installer-policy.mjs`, an `observed` event `{kind: "observed", atMs: 1000, observation: machine([completeWaitronDisk()]), venueTag: readBack(tokens)}` and then a `key` event at 2000, run for **every starting header** and for every result:
    - one good tag (a starting header holding exactly one canonical tag, or a result with a desired usable tag): the first decision's `message.params.venueName` is that tag's name in NFC and `message.params.live` is its `live`; the `key` decision's message has `prompt: "venue-name"`;
    - no tag, two or more tags, or a malformed one (the empty, systemd-only, doubled and malformed starting headers; results whose desired tag is `null` or unusable): `venueName` and `live` are both `null`, and the `key` decision has `prompt: "erase-word"` (spec §5.1 guard 3, lines 256–264).
- [ ] **Step 2: Run it.** It should pass on Tasks 1–4's code. If a property fails, fix `name-tag.mjs` under this task and record the cause in the commit body.
- [ ] **Step 3: Deletion controls.**
  - When none is free, replace token 0 instead of refusing → `others(32)` is no longer skipped, and the "only Waitron's tokens" property fails on it.
  - Put the removes before the replace → the cut property fails on the two-tag start header.
  - Let the encoder write a `"label":""` key → the "bytes carry nothing else" property fails.
- [ ] **Step 4: Run the coverage command** for `name-tag.mjs` and read the counts.
- [ ] **Step 5: Commit:** `git add scripts/box/name-tag.test.mjs && git commit -s -m "test(box): sweep name-tag writes for other tokens, cut writes and the installer's screen"`.

### Task 6: the Wi-Fi record's writer

**Files:**
- Modify: `scripts/box/wifi-record.mjs`, `scripts/box/wifi-record.test.mjs`

**Interfaces (added):**

```js
/**
 * Pure. network is exactly {ssidHex: string, keyMgmt: string, psk: string, hidden: boolean}.
 * Returns the canonical version-1 bytes once parseWifiRecord answers loaded for them; it makes no field-by-field comparison.
 * Throws code "wifi_record.network_invalid" with reason "network-invalid" (wrong shape) or the reason
 * parseWifiRecord gives those bytes ("record-corrupt", "record-unsupported"). The error holds no field value.
 * @param {{ssidHex:string, keyMgmt:string, psk:string, hidden:boolean}} network @returns {Uint8Array} a fresh array
 */
export function formatWifiRecord(network);
```

- [ ] **Step 1: Write the failing tests** (the file's existing `wifiFields` and `recordBytes` helpers, `scripts/box/wifi-record.test.mjs:22-34`; `fields(network)` is `{ssidHex, keyMgmt, psk, hidden}` of `wifiFields(...)`).
  - **Loads, byte for byte:** for each of PR 2's loading records (WPA2; WPA3 with `"Crème brûlée Àngels"`; a 32-byte name; passwords of 8 and 63 characters; 64 hex digits in lower and in upper case; `hidden: true`): `formatWifiRecord(network)` equals `recordBytes(network)` and `parseWifiRecord` of it is `{kind: "loaded", network}`.
  - The largest valid record (a 32-byte name and a 256-byte WPA3 password of `"`) → under `WIFI_RECORD_MAX_BYTES`, and loads.
  - **Refusals with the reader's reason:** a 7-character WPA2 password, a 65-character one, an empty WPA3 password, a 257-byte one, a WPA3 password holding U+0000, `ssidHex` `"ABCD"` (upper case) or `""` → `{code: "wifi_record.network_invalid", reason: "record-corrupt"}`; a WPA2 password holding a tab or `ñ`, `keyMgmt` `"owe"`, `"none"` or `"WPA-PSK"` → `reason: "record-unsupported"`.
  - **Wrong shape:** `null`, a missing key, an extra `version` key, `psk` `7`, `psk` `10n` (a BigInt, which `JSON.stringify` cannot write), `hidden` `"false"`, `keyMgmt` `null` → `reason: "network-invalid"`.
  - **No password in a refusal:** for each refusal above whose `psk` is a string, prefix it with `"CANARY-"` where the case allows (for example a tab case `"CANARY-\tpass1"`), and check that `String(error)`, `JSON.stringify({...error})` and `inspect(error, {depth: 10, showHidden: true})` hold no `CANARY`.
  - **Fresh bytes:** two calls return different arrays with equal bytes.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/wifi-record.test.mjs`: the new cases fail; the existing 146 pass.
- [ ] **Step 3: Implement:** shape check, then the canonical bytes, then `parseWifiRecord`; return the bytes only when it answers `loaded`.
- [ ] **Step 4: Run green**, then the coverage command for `wifi-record.mjs`.
- [ ] **Step 5: Deletion controls.**
  - Skip the `parseWifiRecord` check → the 7-character case returns bytes.
  - Leave off the final newline → every loading case throws `record-corrupt`.
  - Put the password in the error's message → the canary check fails.
- [ ] **Step 6: Commit:** `git add scripts/box/wifi-record.mjs scripts/box/wifi-record.test.mjs && git commit -s -m "feat(box): write the Wi-Fi boot copy only in the form its reader loads"`. The body lists D10 and says publication (the pending intent, `wifi.json.next`, rename, cleanup) is slice 3's.

### Task 7: the decision from the box's Wi-Fi settings

**Files:**
- Modify: `scripts/box/wifi-record.mjs`, `scripts/box/wifi-record.test.mjs`

**Interfaces (added):**

```js
/**
 * @typedef {{kind:'cable-only'}
 *   | {kind:'wifi', ssidHex:string, keyMgmt:string|null, psk:string|null, hidden:boolean}} WifiSettings
 *   the box's normal network settings as the network adapter reads them from NetworkManager: keyMgmt is
 *   802-11-wireless-security.key-mgmt, null when the connection has no security setting; psk is null when
 *   NetworkManager holds no password the host can read
 * @typedef {'cable-only'|'open'|'open-or-wep'|'dynamic-wep'|'owe'|'enterprise'|'unsupported-security'
 *   |'password-unavailable'|'password-not-printable'|'password-too-long'|'password-invalid'} WifiNoCopyReason
 * @typedef {{kind:'write', bytes:Uint8Array} | {kind:'remove', reason:WifiNoCopyReason}} WifiCopyDecision  frozen;
 *   remove: no copy should exist, so any copy present is obsolete
 */
/** Pure (spec §7.5). Throws wifi_record.settings_invalid (settings-invalid). @param {WifiSettings} settings @returns {WifiCopyDecision} */
export function decideWifiBootCopy(settings);
```

**Rules:** D11's table, in its order (security type first, then the password), and D12's throws. A `write` decision's `bytes` are `formatWifiRecord({ssidHex, keyMgmt, psk, hidden})`.

- [ ] **Step 1: Write the failing tests.** `wifi(fields)` builds `{kind: "wifi", ssidHex: SSID, keyMgmt: "wpa-psk", psk: "correct horse", hidden: false, ...fields}`.
  - **Writes:** `wifi()` → `{kind: "write", bytes}` with `bytes` equal to `formatWifiRecord` of the same network; `wifi({keyMgmt: "sae", psk: "Crème brûlée Àngels", hidden: true})` → write; a 64-hex-digit WPA2 password → write.
  - **Each reason, one case per table row:** `{kind: "cable-only"}` → `cable-only`; `wifi({keyMgmt: null, psk: null})` → `open`; `wifi({keyMgmt: null, psk: "correct horse"})` → `open` (type before password); `none` → `open-or-wep`; `ieee8021x` → `dynamic-wep`; `owe` → `owe`; `wpa-eap` and `wpa-eap-suite-b-192` → `enterprise`; `"wep"` and `"WPA-PSK"` → `unsupported-security`; `wpa-psk` and `sae` with `psk: null` → `password-unavailable`; `wpa-psk` `"pass\tword"`, `"pass\u00F1word"` and `"\u{1F600}".repeat(40)` (80 UTF-16 units, 40 code points) → `password-not-printable`; `wpa-psk` `"\u{1F600}".repeat(4) + "a"` (9 units, 5 code points) → `password-invalid`; `sae` with 257 bytes of `"a"` → `password-too-long`; `wpa-psk` of 7 characters, of 65, and 64 non-hex characters → `password-invalid`; `sae` `""`, holding U+0000, and `"\uD800"` → `password-invalid`.
  - **Wrong shapes throw `{code: "wifi_record.settings_invalid", reason: "settings-invalid"}`:** `null`; `{kind: "cable-only", ssidHex: SSID}`; `{kind: "ethernet"}`; `wifi()` with an extra key, a missing key, `ssidHex` `"ABCD"`, `""` or 33 bytes, `keyMgmt` `7`, `psk` `7`, `hidden` `"false"`.
  - **Every decision is frozen** and has exactly the keys `kind` and `bytes`, or `kind` and `reason`.
  - **Password sweep (Review Focus 4):** for every `remove` case and every throwing case above, rebuilt with a password containing `"CANARY"` where the case's rule allows it (for example `"CANARY-\tx1"` for `password-not-printable`, `"CANARY" + "a".repeat(251)` for `password-too-long`), `JSON.stringify(decision)`, `inspect(decision, {depth: 10, showHidden: true})`, and for throws `String(error)`, `JSON.stringify({...error})` and `inspect(error, …)` hold no `CANARY`. Positive control: a write decision's `new TextDecoder().decode(bytes)` does hold it.
  - **Round trip:** every `write` decision's `parseWifiRecord(bytes)` is `{kind: "loaded", network: {ssidHex, keyMgmt, psk, hidden}}` of its settings.
- [ ] **Step 2: Run red.** `pnpm exec vitest run scripts/box/wifi-record.test.mjs`. Expected: the new `decideWifiBootCopy` cases fail with "not implemented"; the 146 earlier cases and Task 6's still pass; no import error.
- [ ] **Step 3: Implement.** Shape checks, then the security type, then (for `sae`) the too-long check, then `formatWifiRecord`, mapping its throw to a reason as D11 says.
- [ ] **Step 4: Run green**, then the coverage command for `wifi-record.mjs`.
- [ ] **Step 5: Deletion controls.**
  - Map `none` to `open` → its case fails.
  - Check the password before the type → the open-with-password case answers a password reason or a write.
  - Map `record-unsupported` to `password-invalid` → the non-printable cases, the 40-emoji case included, fail.
  - Count the WPA2 password in UTF-16 units instead of using the reader's answer → the 40-emoji case (80 units) answers `password-invalid`.
  - Put `psk` in the `remove` decision → the sweep fails.
- [ ] **Step 6: Commit:** `git add scripts/box/wifi-record.mjs scripts/box/wifi-record.test.mjs && git commit -s -m "feat(box): decide whether a box's Wi-Fi settings get a boot copy, and say why not"`. The body lists D11 and D12 and says the status page's reporting and the words for each reason are slice 3's.

### Task 8: backlog and dated pointers

**Files:**
- Modify: `docs/backlog.md`, the B3 entry (line 5157 on main).
- Modify: `docs/backlog/box.md`: `## B3. The bootable USB installer` (line 744); its "Built so far (2026-11-03), PR 3" paragraph (line 864); the "For the owner" paragraph (lines 916–927); "For later slices, from PR 2's re-map" (line 943) and its Wi-Fi bullet (lines 947–949); "For later slices, from PR 3's re-map" (line 960) and its bullets on the name tag (lines 968–969), the alert (lines 975–976) and the length limit (lines 982–983); `## Decisions and deliberate limits` (line 1095).
- Modify: `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md` and `docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, one dated pointer line each at the top.

- [ ] **Step 1: `docs/backlog.md`.** After the PR 3 sentence, add: PR 4 (`#PR4`, filled in once the pull request exists, [plan](superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md)) defines the name tag (a LUKS2 token of Waitron's own type), its decoder, the finder and a write plan, and the Wi-Fi boot copy's writer and its write-or-why-not decision, under `scripts/box/`, none called yet.
- [ ] **Step 2: `docs/backlog/box.md`.**
  - After PR 3's "Built so far" paragraph, add a dated PR 4 paragraph (`#PR4`) with two bullets in the same style:
    - `name-tag.mjs`: the name tag is one LUKS2 token of type `waitron-name-tag`, version 1, assigned to no keyslot, never the header's label or subsystem field. `decodeNameTag` accepts only its one byte form and answers `null` for anything else; `findNameTag` reads it from `cryptsetup luksDump --dump-json-metadata` output and answers `null` for none or two; `planNameTagWrite` names only Waitron's own token or a free number, replaces before it removes, and refuses when all 32 token numbers are taken. A venue name the tag cannot hold (over 256 code points, or with a control character such as a tab) gets no tag, so the stick asks for the erase word. The installer's decisions now use the tag's own text rule and limit (`usableVenueName`, `NAME_TAG_MAX_CODE_POINTS`).
    - `wifi-record.mjs`: `formatWifiRecord` writes version 1 only in the form `parseWifiRecord` loads; `decideWifiBootCopy` turns the box's NetworkManager settings into a copy to write or a named reason for none (cable only, open, WEP, OWE, enterprise, a password the host cannot read, a WPA2 password outside printable ASCII, a WPA3 password over 256 bytes).
  - Replace the whole "For the owner: a box that already holds Waitron, with its TPM or Secure Boot switched off." paragraph with one line: `**A box that already holds Waitron, with its TPM or Secure Boot switched off:** the owner decided on 2026-11-03; see [Decisions and deliberate limits](#decisions-and-deliberate-limits).`
  - Under `## Decisions and deliberate limits`, directly before the bullet that begins `- **Cloud verification keeps worker threads denied (owner, 2026-10-22, A1004).**`, add:
    `- **A box that already holds Waitron but has its TPM or Secure Boot switched off still starts (owner, 2026-11-03).** The stick starts the installed Waitron after 15 seconds so the venue keeps selling; the screen and the status page name the setting that is off; slice 3's host service raises the alert; a reinstall on that box stays refused. Built as the installer's decision D2 in B3 PR 3 (`scripts/box/installer-policy.mjs`, #2426) and kept as built. The 15 seconds, two minutes, 60 seconds and one minute stay the spec's proposals; the owner was not asked about them. ([B3 PR 4's plan](../superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md), D13.)`
  - In "For later slices, from PR 2's re-map", replace the Wi-Fi bullet with: Task 3.1's publication writes `decideWifiBootCopy`'s bytes (built in PR 4) and removes the copy on every "no copy" answer; it shows the answer's reason with the copy state, because open, WEP, OWE and enterprise networks and the password cases get no Wi-Fi unlock in version 1.
  - In "For later slices, from PR 3's re-map": replace the name-tag bullet with "The Linux installer fills `DiskObservation.nameTag` with `findNameTag` of the frozen internal disk's own `luksDump --dump-json-metadata` output and hands the policy `nameTag === null ? null : decodeNameTag(nameTag)`, for that disk and no other."; change the alert bullet's "(D2's other half)" to "(the owner's decision of 2026-11-03)"; delete the length-limit bullet (settled: PR 4's D3).
  - Add, under a new "For later slices, from PR 4's [re-map against main](../superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md#re-map-against-main-on-2026-11-03):" heading:
    - slice 3's `tag.write` runs `planNameTagWrite`'s steps with `cryptsetup token import --token-id <n>` (`--token-replace` for a replace) and `cryptsetup token remove --token-id <n>`, never `--key-slot`, inside the host's one header-write turn; on "Token <n> in use" it reads and plans again; a step refused for space is reported, because the plan does not estimate free space (D8);
    - slice 3 writes the tag at installation handoff and whenever the venue's name or Live state changes, and chooses which name (the legal name the dashboard banner shows, or a trading name);
    - slice 1's recipe: `systemd-repart` v257 sets the LUKS2 label to the partition's label and sets no subsystem, so the `waitron-box-1` subsystem marker needs its own step; the real header's free metadata space with systemd's TPM and recovery tokens in it is a rig measurement (cryptsetup 2.7.5's default area was 12,288 bytes and the largest tag is 1100);
    - a rig check that a token of an unknown type assigned to no keyslot leaves `systemd-cryptsetup`'s automatic unlock unchanged, and one that a too-big `--token-replace` leaves the header as it was (read in cryptsetup's source, not measured);
    - decisions recorded for review: a name the tag cannot hold gets no tag, never a cut-down one (D4); a power cut while removing a doubled tag can leave one old tag readable until the next write (D7).
- [ ] **Step 3: Pointers.** At the top of the spec and of the six-slice plan, above the 2026-11-03 PR 3 line, add: `> 2026-11-03: PR 4's plan (the name tag's format as a LUKS2 token, and the Wi-Fi boot copy's writer format) and its re-map against main: [2026-11-03-b3-4-name-tag-wifi-copy.md](…).` (`../plans/…` from the spec, the bare file name from the plan.) Do not rewrite either historical body (CLAUDE.md §6, docs).
- [ ] **Step 4: Guides and CLAUDE.md.** No guide changes: nothing a person sees changed. No CLAUDE.md line unless an implementing task paid for a new trap; if one did, add one line plus a pointer.
- [ ] **Step 5: Commit** in this branch (it is not a docs-only branch): `git add docs/backlog.md docs/backlog/box.md docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md docs/superpowers/plans/2026-10-26-b3-usb-installer.md && git commit -s -m "docs(backlog): record B3's name tag and Wi-Fi copy formats and the owner's TPM decision"`.

---

## Self-review

**Spec and parent-plan coverage for this pull request.**

| Sentence | Where |
| --- | --- |
| §7.6: "a record of Waitron's own kind in the container's header — readable and writable without the key" | D1; Tasks 1, 3 |
| §7.6: "**Not** the header's label field … and **never** the fields that mark the disk as Waitron's" | D1; Task 1's marker-looking name; Task 5's "bytes carry nothing else" and "disk is still recognised" |
| §7.6: "Anyone with the disk can read or forge it, so it only names what the warning shows; it decides nothing" | D5, D6; Task 3's two-tag cases; Task 5's installer-screen property |
| §5.1 guard 3: "the venue's name and whether it is Live, read from the disk's name tag … or «BORRAR» if the name tag cannot be read" | Task 5's installer-screen property; D4 |
| Parent Task 3.1: "Name tag write changes only tag bytes, never disk-classification markers" | Task 4; Task 5's "only Waitron's tokens" and "nothing else changes", which run against the test's simulator of `cryptsetup`; the real header's binary fields were measured unchanged by `cryptsetup` 2.7.5 itself (re-map finding 3), and a real write is slice 3's rig check |
| Parent Task 3.1: "huge accented name fits the custom record format without truncating markers" | Task 1's 256-emoji and 60-character cases; D3, D4 |
| §7.5: "Copy no arbitrary network profile, other credentials …"; the copy holds "only validated security/join fields" | D10, D11; Tasks 6, 7 |
| PR 2's note: "a gap 3.1 reports rather than hides" | D11's reasons; Task 7 |
| The owner's 2026-11-03 answer | D13; Task 8 |

Every other Task 3.1 sentence about the tag or the copy is under "Out", with where it goes.

**Names.** The parent plan names the host verb `tag.write` (line 164) and the record path `/boot/waitron-recovery/wifi.json` (line 190); neither changes. New names are this plan's: `encodeNameTag`, `decodeNameTag`, `findNameTag`, `planNameTagWrite`, `usableVenueName`, `formatWifiRecord`, `decideWifiBootCopy`.

**What the planner ran (2026-11-03):**
- `curl` of cryptsetup v2.7.5's `lib/luks2/luks2.h`, `luks2_token.c`, `luks2_json_metadata.c`, `luks2_internal.h`, `lib/libcryptsetup.h`, `src/cryptsetup.c` and `man/cryptsetup-token.8.adoc`; the LUKS2 specification's `luks2_doc.tex` (1.1.4); systemd v257's `src/repart/repart.c` and `src/shared/cryptsetup-util.h`; NetworkManager 1.52.0's `nm-setting-wireless-security.c` and `nm-setting.h`; then `grep` and `sed` over them for every line cited;
- three `docker run --rm` probes on `debian:trixie` (`memory_pressure`: 94% free before them), each installing `cryptsetup-bin` (2.7.5) and running `luksFormat`, `luksAddKey`, `token import`/`remove`, `luksDump` and `dd` over a 64 MiB file image, with the results in re-map findings 3 and 4 and the fixture in Task 3;
- for the review fold: `node` runs of `parseWifiRecord` on a WPA2 password of 40 emoji (`record-unsupported`), of four emoji and a letter (`record-corrupt`), of `"pass\u00F1word"` (`record-unsupported`), and on WPA3 passwords of 257 bytes and holding U+0000 (both `record-corrupt`); a second `curl` of cryptsetup v2.7.5's `src/cryptsetup.c` and `lib/luks2/luks2_token.c` (both SHA-256 sums are in the list above) to read the replacement path; `grep -rnE '\bD[0-9]+\b' scripts/box` (no match);
- `node` (v26.13.0) for the tag sizes (76, 75, 1100, 588, 555 bytes), `JSON.parse`'s ordering of number-like keys and `String.prototype.isWellFormed`;
- `pnpm exec vitest run` of `installer-policy`, `wifi-record` and `disk-state` tests for the baseline counts (453, 146, 118);
- `grep` over the repository for the name tag, the Wi-Fi writer, `scripts/box` guards, venue-name limits and `## Decisions and deliberate limits`.

**What the planner only read:** the repository lines cited for the venue name's limits and the installer's rule; what `systemd-repart` does with its parameters at run time (re-map finding 5); `translate_errno`'s effect on a real unlock (finding 10); NetworkManager's meanings (finding 11).

**Not measured:** the header after a too-big `--token-replace` (read only, re-map finding 3); the real box header's JSON area and free space through `crypt_format`; how `systemd-cryptsetup` treats the tag at boot; any behaviour of `cryptsetup` older than 2.7.5 (for example whether `--token-replace` exists there).

No test of the code above has run, because none of it exists yet.

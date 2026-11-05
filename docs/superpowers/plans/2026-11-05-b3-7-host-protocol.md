# B3, seventh pull request: the box host protocol

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Build the part of slice 3 Task 3.1 that defines what Waitron's server may ask the box's host service for B3, and what the host may answer, as one pure module an unprivileged macOS machine and CI's root Vitest project can fully test: `scripts/box/host-protocol.mjs` (new). It

- names seven of B3's requests (Task 3.1's list without `first-start.status`, which is Out) and treats slice 9b's two clock requests as the shell handler's, never its own;
- reads one request line into a checked request or a refusal, checking the line's framing, the request's fields and the form of the *actor* (the ids the server sends to say who asked);
- writes and checks each request's reply, so the later server client can check what it receives with the same rules;
- answers one line with `handleHostRequest(line, adapters)`, which calls *adapters* (functions handed in by the caller, here test doubles, later the Linux code that drives NetworkManager, the screen setting and the disk header), never throws, and answers a fixed refusal when an adapter fails, with no adapter error text and no password in it.

Nothing here opens a socket, runs as root, reads NetworkManager, writes a disk header or draws a screen. The module is called by nothing yet.

**Review folded 2026-11-05.** The lane moved `first-start.status` out of this pull request: nothing defines or reads it, and the host itself serves first start's failure page while the server is not running (spec lines 554–559). A fresh-context review found no critical and twelve other points; all are folded:

- R1: Task 4's adapters-check control names the cases that fail without the check (the extra key; `networkRead: "x"` leaving `calls` empty), and a new case sends invalid adapters with a line the parser refuses.
- R2: the whole of `handleHostRequest`, the adapters check included, runs inside its one `try` (D15), with cases for a throwing `log` getter and a Proxy whose key listing throws.
- R3: the canary sweep asserts `networkJoin` was not called in the runs where `log` fails, keeps "exactly once, as `psk`" for the runs where it succeeds, and adds a run where `networkJoin` throws the canary.
- R4: every non-ASCII character in a line literal is written as a lower-case `\u` escape (execution notes); the `é` examples are spelled out.
- R5: the zeroing test asserts exactly one recorded array per accepted join, through a pass-through mock built with `importOriginal`.
- R6: the "not the same object" check, which could never fail, and its control are dropped.
- R7: a case where the one JSON copy changes the answer (a `toJSON` on the prototype), so the copy's control fails.
- R8: the counts that included `first-start.status` are corrected, and D16 words `unknown_request` per request.
- R9: Task 1's lines with fields use values Task 2 accepts, so Task 2 changes no Task 1 assertion.
- R10: the longest `tag.write` line is 3142 characters, with the server actor it requires.
- R11: the "frozen" checks follow a value check in the same test, since `Object.isFrozen(undefined)` is true.
- R12: D6's server-only `tag.write` carries an "Answer any to override" line with its reason.

A third, narrower check of that fold found two important and eight minor points, all folded: the Linux-adapters "Out" bullet no longer names a first-start reader; Task 5's re-map draft uses D16's per-request reading of `unknown_request`; the 1003- and 3142-character lengths name the inputs that give them; the zeroing test asserts at least one recorded array, every one zeroed, and replaces the refused `wpa-eap` case (which records nothing whatever the code does) with a join refused after its Wi-Fi check; Task 2's expected red run includes the zeroing cases; seven addresses, not nine; D6's reason no longer names an undefined reconciliation duty; and D15 step 4 passes the parser's frozen fields through instead of claiming an untested new copy.

**Architecture:** One new host library under `scripts/box/`, a plain `.mjs` file with JSDoc types and a sibling `.test.mjs` in the root Vitest project, in the style PRs 1–6 set. It reuses PR 4's Wi-Fi record writer (`formatWifiRecord`) and name rule (`usableVenueName`), and PR 5's copy-state values. `wifi-record.mjs` gains one exported function (`isSsidHex`) and `wifi-boot-copy.mjs` two exported lists (`WIFI_COPY_STATES`, `WIFI_COPY_FAILURES`), and nothing else in either changes.

**Tech Stack:** Node 26 (`node --version` printed `v26.13.0` on 2026-11-05), Vitest 4.1.12 root project. No new dependency and no workspace package.

**Spec:** [B3 design](../specs/2026-10-21-b3-usb-installer-design.md) §8, the host service (lines 911–920 on main); §9 (lines 961–973); §10's table (lines 1036–1049); §7.5, "Proposed minimal-copy update contract" (lines 709–732); §7.6 (lines 855–866); §7.3 item 3 (lines 554–559), for why `first-start.status` is Out. Line numbers are main's at `3ba44b9922`; Task 5 adds a pointer line and a blank line at the top of the spec, so add 2 once it merges.

**Parent plan:** [six-slice plan](2026-10-26-b3-usb-installer.md), Slice 3 Task 3.1: its **Interfaces** paragraph (line 170 on main), **The clock requests slice 9b shipped** (lines 172–192), the first red step's protocol cases (line 205) and the shared contract ledger's `HostReply`, `VerifiedHostActor` row (line 82). This branch's first commit adds a pointer line at the top of that plan and two pointer notes inside it, so its later line numbers move by up to 6.

**Build authority:** the owner's "Yes, build it", 2026-11-01, with the build cut one pull request at a time ([PR 1's plan](2026-11-01-b3-1-encrypted-disk.md), "Build authority").

## Global Constraints

- **Machine limits on 2026-11-05:** macOS, unprivileged. No Linux box, systemd, socket activation, NetworkManager or `cryptsetup`. Nothing in this pull request needs them.
- **No password leaves the join.** A Wi-Fi password reaches exactly one place: the `networkJoin` adapter's argument. It is in no reply, no refusal, no thrown error, no log entry and no other adapter's argument, even when an adapter's error message or answer holds it. The module writes nothing to the console.
- **No path, command or free text from the caller reaches an adapter** beyond the checked fields each request names (D9–D12): an SSID as hex, a key-management name from a list of two, a password the boot-copy writer accepts, a hidden flag, a start-page name from a list of two, a venue name the name tag can hold.
- **No tables, migrations or schema files** (an owner hold on table changes is in force). Nothing here touches `apps/` or `packages/`.
- **Coverage:** the root project holds `98/98/98/95` (`vitest.config.ts:120`). No `exclude`, no ignore comment, no moving code into a testing folder.
- **Code style:** English only (CLAUDE.md §3). Comments only for an invariant or a reason the code cannot show; no decision numbers from this plan in code. Thrown error codes name the domain: `host_request.invalid`, `host_reply.invalid`. Wire refusal reasons are snake_case, as slice 9b's are (`deploy/box/waitron-box.sh:111-177`); status values inside a reply are kebab-case, as PR 5's are.
- **Tests:** no existing assertion in any test changes; counts may only grow (re-map finding 14).
- **Commits:** `git commit -s`, staging only named paths, never `git add -A`.

## Review Focus

1. **One reading per line.** Expected: a line is accepted only when it is exactly the line `formatHostRequest` writes for the request it reads as, so duplicate keys, reordered keys, extra spaces, upper-case escapes and raw non-ASCII are all refused (D4). Tasks 1, 2.
2. **The actor is checked for form, never trusted as permission.** Expected: each request accepts only the actor sources D6 lists, with ids of the stated form; no request carries or checks a permission name; the log entry names the verb's permission from the module's own table (D7). Task 1, Task 4.
3. **The password goes to the join adapter and nowhere else.** Expected: the canary sweep in Task 4 finds the canary in no reply, log entry, thrown error or other adapter's arguments. Tasks 2, 4.
4. **An adapter cannot widen the reply.** Expected: every adapter answer is copied once and then checked by the same per-request rules the client will use; any extra field, wrong value, throwing getter or parser-only reason answers `host_failed` (D15). Tasks 3, 4.
5. **The clock requests are untouched.** Expected: `clock.status` and `clock.set …` lines answer `unknown_request` from this module and call no adapter; no file under `deploy/` or `apps/` changes (D1, D5). Task 1.

---

## What this pull request builds, and what it leaves out

**In (testable on this machine):**

| Task | File | Source |
| --- | --- | --- |
| 1 | `scripts/box/host-protocol.mjs` and test: the verb lists, line framing, the canonical line, the actor | parent line 170 ("validates fixed fields and actor"); line 205 ("reject unknown verb, oversized/malformed fields … missing/forged actor"); D1–D7 |
| 2 | same files, plus `wifi-record.mjs`'s `isSsidHex`: each request's fields | parent line 205; spec lines 711, 731; D9–D12 |
| 3 | same files, plus `wifi-boot-copy.mjs`'s two lists: replies, written and read back | parent line 170 (`NetworkSnapshot`), lines 199–200 (copy state beside connectivity); spec lines 715–719; D8, D13, D14, D16 |
| 4 | same files: `handleHostRequest`, the adapters, the log entry, the fixed failure and the canary sweep | parent line 205 ("without leaking its password"); spec line 731 ("no … password-bearing … logs"); D15 |
| 5 | backlog (PR 7's paragraph, PR 7's re-map list, the 9b entry settled and its decision moved); spec pointer; the parent plan's pointer filled in | — |

**Out, and where each goes next:**

- **The Linux adapters:** reading, scanning, joining and forgetting through NetworkManager, the durable pending intent beside them (PR 5's D11), publishing the boot copy after each change (PR 5's publisher), the screen setting's store, `cryptsetup token` writes for the name tag (PR 4's plan, run in the host's one header-write turn): slice 3's Linux host-service pull request.
- **systemd and socket changes, and the Node runtime on the host:** the pinned host Node runtime is slice 1's recipe (parent plan, "Tech Stack"); any unit or socket change is slice 3's Linux pull request.
- **The shell handler forwarding B3's verbs to the Node host**, including letting a B3 line past the shell's 700-character read and choosing how long a forwarded exchange may run under `RuntimeMaxSec=15`: slice 3's Linux pull request (D1, D8).
- **The server's `box-host-api` routes and the client's B3 methods** (`apps/server/src/box-host-client.ts` is unchanged here): slice 3's server pull request, the parent's `box-host-api.test.ts` step (line 209).
- **The dashboard's This box screen:** Task 3.2.
- **The kiosk** (`cage`, Chromium, the screen service): Task 3.1's last step (line 210).
- **The alert on an installed box whose TPM or Secure Boot is off:** slice 3's host service (`docs/backlog/box.md`, PR 3's re-map list).
- **Which venue name the tag holds** (the legal name or a trading name): slice 3's server pull request (PR 4's re-map list).
- **`first-start.status`** (Task 3.1's list): slice 1's recipe pull request, which builds the first-start service. Nothing defines its answer or reads it: the spec has the host itself answer first start's failure page at `waitron.local`, and Waitron does not start while the empty passphrase remains (lines 554–559), so the server is not running to ask. That pull request decides whether a request is needed at all, and if so its steps and its reader.

## Re-map against main on 2026-11-05

Task 3.1 was written on 2026-10-26. This re-map checks its interface sentences, the clock paragraph and the ledger row against main at `3ba44b9922`.

1. **Slice 9b's socket and units exist and own the names Task 3.1 planned.** `deploy/box/waitron-box.socket` listens on `/run/waitron-box/box.sock` with `Accept=yes`, `SocketMode=0660`, `SocketUser=root`, `SocketGroup=waitron-box` and `MaxConnections=4` (`:5-10`); `deploy/box/waitron-box@.service` runs `/usr/local/lib/waitron/waitron-box.sh %i` per connection with the socket as its input and output and `RuntimeMaxSec=15` (`:6-11`). The parent's `deploy/box/waitron-box.service` would collide with them (parent lines 172–179, unchanged since).
2. **The shell handler's wire, as built.** It reads one line of at most 700 characters within 5 seconds, else answers `request_invalid` (`deploy/box/waitron-box.sh:161-167`); dispatches on the line's start with a `case` (`:168-178`); answers `unknown_request` for any other line (`:177`); refuses with `{"ok":false,"reason":"<reason>"}` (`:28`); `clock.set`'s reasons are `target_invalid`, `requester_invalid`, `synchronised`, `busy`, `set_failed` (`:111-142`); a requester is printable ASCII from `{` to `}` of at most 512 bytes (`:25`, `:114`), and is written to the journal by `logger` before the set (`:128`).
3. **The server's client exists** (`apps/server/src/box-host-client.ts`, slice 9b; the parent's file map lists it as new). It sends one line, reads one reply of at most 4096 bytes (`:37`, `:70-77`), requires exactly one trailing newline (`:84`), and reads `{"ok":true,…}` or `{"ok":false,"reason":<string>}` (`:100-106`). It escapes non-ASCII in a requester as `\uXXXX` with lower-case hex (`:147-151`). It waits 2 s for a status and 20 s for a set, "longer than the host unit's `RuntimeMaxSec=15`" (`:34-36`).
4. **The clock requests are in use.** `boot.ts:2196` builds the client; `clock-correction.ts:294` sets the clock through it, for the clock watch (`clock-watch.ts:257`, requester `{ source: "authority", check }`), the administrator's confirmation (`box-health-api.ts:358`, `{ source: "admin", person }`) and a till during the stop (`till-box-clock-api.ts:341-345`, `{ source, person, device }`); `time-health.ts` and `clock-sync-alert.ts` read its status type (all under `apps/server/src/`).
5. **A hand-installed box has no Node on its host.** `deploy/waitron.sh` installs on the host only `ca-certificates`, `curl`, the Docker packages, `qrencode` and `jq` (`:157`, `:164`, `:168`, `:412`), and installs the shell handler and its two units (`install_box_service`, `:357-397`, called at `:739`); it runs Node only inside the app image (`:534-535`, `:633`). Slice 9b's plan chose the shell handler for this reason (`docs/superpowers/plans/2026-10-24-a798-9b-box-sets-its-clock.md:548-550`).
6. **Who can reach the socket.** Compose mounts the socket's folder into the `app` service alone (`deploy/compose.yml:49`; no other line names it), whose process runs as uid and gid 10001 (`deploy/Dockerfile:185-186`, `:280`); `waitron.sh` makes the host group `waitron-box` with that same gid, and refuses to install when the name or the number belongs to something else (`deploy/waitron.sh:332-356`).
7. **The permissions.** `system.manage` exists (`packages/identity/src/permissions.ts:22`) and is held by managers (`:58-75`) and admins (`:78`, `:84`). The box's own reads and actions use it today (`apps/server/src/box-health-api.ts:80`, `:125`), and spec §10 puts Red and the start-screen setting under it (lines 1044, 1046). Slice 9b's three clock routes use `person.admin` instead (`box-health-api.ts:125-127`).
8. **The request names Task 3.1 planned do not exist yet:** `ls scripts/box/` lists no `host.mjs`, `host-protocol.mjs` or `network.mjs`, and no other worktree or remote branch is on B3 (`git worktree list`, `git branch -r`, 2026-11-05).
9. **Task 3.1's `NetworkSnapshot` names an SSID as `ssid: string`; PR 2's format carries it as hex**, because "a network name is up to 32 arbitrary bytes and need not be UTF-8" (`scripts/box/wifi-record.mjs:22-23`). The hex rule `SSID_HEX` is not exported (`:23`).
10. **PR 4's writer is the boot copy's whole field rule.** `formatWifiRecord` accepts exactly `{ssidHex, keyMgmt, psk, hidden}`, with `keyMgmt` `wpa-psk` or `sae` and the password rules of each, and throws an error that "holds no field value" (`scripts/box/wifi-record.mjs:146-168`). PR 4's name rule `usableVenueName` answers a name's NFC form or `null` (`scripts/box/name-tag.mjs:55-59`), and `planNameTagWrite` takes `null` for "this box has no tag" and refuses with `no-free-token` or `metadata-unreadable` (`:154-205`).
11. **PR 5's copy states are a typedef, not a value.** `WifiCopyState` and `WifiCopyFailure` are JSDoc types (`scripts/box/wifi-boot-copy.mjs:13-15`); `status()` answers exactly `{state, reason, failure}`, `failure` set exactly when `state` is `failed` (`:16-21`; PR 5's D9). `WIFI_NO_COPY_REASONS` is exported (`scripts/box/wifi-record.mjs:184-196`).
12. **Production person ids are UUIDs, but nothing enforces it.** New rows take `randomUUID()` (`packages/db/src/schema/columns.ts:178`); the mirror viewer's fixed id is `"acce55ed-0000-4000-8000-000000000001"` (`apps/server/src/mirror-session.ts:19`); the `id` column is plain text.
13. **Nothing in `apps/` or `packages/` imports `scripts/box/`:** `git grep -n "scripts/box" -- apps packages` printed nothing. How the later client reuses this module's reply rules is the client pull request's choice ("For later", Task 5).
14. **Baseline, run on 2026-11-05:** `pnpm exec vitest run scripts/box/<file>` printed `Tests  646 passed (646)` for `name-tag.test.mjs`, `268` for `wifi-record.test.mjs` and `198` for `wifi-boot-copy.test.mjs`. The one-file coverage command (execution notes) for `name-tag.mjs` printed `Statements : 100% ( 90/90 )`, `Branches : 100% ( 80/80 )`, `Functions : 100% ( 22/22 )`, `Lines : 100% ( 76/76 )`, with no per-file rows: read the summary. The same command for `wifi-record.mjs` printed 100% of 180 statements, 159 branches, 27 functions and 147 lines, and for `wifi-boot-copy.mjs` 100% of 140, 91, 28 and 119.
15. **The root project needs no change.** Its test glob is `scripts/**/*.test.mjs` (`vitest.config.ts:71`), its coverage glob `scripts/**/*.mjs` (`:119`).
16. **Sizes, measured with `node /tmp/b3p7-probe/probe.mjs` on this Mac on 2026-11-05** (the script builds each line with the client's escaping, `box-host-client.ts:148-151`, and a 64-character person id): the longest `network.join` line, a WPA3 password of 256 bytes as 128 `é` or 64 emoji with a 32-byte SSID (`ff`×32) and `hidden: false`, is 1003 characters (re-measured with `node -e`: 1002 with `hidden: true`, 955 with the 8-byte SSID `4361666550657065`); one of 85 CJK characters (255 bytes) is 745; one of 256 `"` is 747. A `tag.write` line with a name of 256 emoji is 3218 characters with that person id; with the server actor, the only one `tag.write` accepts (D6), it is 3142 (`live: false`; 3141 with `true`), re-measured with `node -e` on 2026-11-05. A scan reply of 32 networks, each a 64-character hex SSID with signal 100 and `wpa-psk`, is 3640 bytes before its newline; of 64 networks, 7256. `JSON.parse('{"a":1,"a":2}')` kept the last value (`{"a":2}`). `net.isIP` answered 4 for `192.168.1.10`, 6 for `fe80::1%eth0`, `::ffff:1.2.3.4`, `FE80::1` and `ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255`, and 0 for `01.2.3.4` and ` 1.2.3.4`.
17. **Vitest's answer to an import that is not there yet**, measured with a throwaway test on 2026-11-05: a missing module fails the file with `Error: Cannot find module './…mjs' imported from …`; a missing *named export* of an existing module imports as `undefined`, so its first call fails with a `TypeError` (`… is not a function`), not an import error.

## Decisions where the parent plan or spec left a choice

The lane decided D1 and D2 on 2026-11-05, as the watcher asked it to rather than leave them open. Every other decision is this plan's.

- **D1. The clock requests stay on slice 9b's wire and shell handler, unchanged.** *Answer any to override (FYI).* Reasons: they have landed and are used by the clock-behind stop and the clock confirmation (re-map finding 4); every box installed today by `waitron.sh install` runs the shell handler and has no Node on its host (finding 5); and moving them would change a working contract and gain nothing measurable until B3's host service runs on a real box. B3's own requests share the same socket path (`/run/waitron-box/box.sock`), the same framing (one request line in, one JSON line out, `{"ok":true,…}` or `{"ok":false,"reason":…}`, finding 2) and the one server client file `apps/server/src/box-host-client.ts`, which this pull request does not change: it is the host side's protocol alone. How the shell handler hands a B3 line to the Node host is Linux wiring for slice 3's Linux pull request. This settles the backlog entry "B3 keeps or replaces the clock requests slice 9b shipped" (Task 5).
- **D2. The host knows its caller by the socket itself.** *Answer any to override (FYI).* Only root and members of the `waitron-box` group, which is the app's gid 10001, can connect (`SocketMode=0660`, `SocketUser=root`, `SocketGroup=waitron-box`, `deploy/box/waitron-box.socket:7-9`; finding 6). Each connection carries one request and gets one answer (`Accept=yes`, one service instance per connection, `RuntimeMaxSec=15`, `waitron-box.socket:6`, `waitron-box@.service:6-11`), so there is no token to replay: the replay boundary is access to the socket. The server alone mints the actor, from a verified session it has already authorised (`system.manage` for every person request, finding 7), and never from browser JSON or the kiosk's local-screen marker. The host checks the actor's *form* and logs it; it does not re-check permission names the server reports about itself, because a check of a self-reported value is weaker than its name. **A compromised server process, or any code running as the app's gid, can send any actor**; this is the same model as slice 9b's requester (parent lines 189–192). So the parent ledger's `VerifiedHostActor` now means: ids only (D6), minted by the server from a session it authorised, checked by the host for form and logged; no permission list, no request digest and no "internal origin evidence" travel, because the socket's access is the only origin the host can see. The first commit of this branch adds dated pointers to this in the parent plan.
- **D3. One pure module, `scripts/box/host-protocol.mjs`.** The parent names `host.mjs` (the service) and `host-protocol.mjs` (the protocol) separately (file map, slice 3). This pull request builds only the protocol, with the dispatcher taking adapters, so `host.mjs` later wires the socket's standard input and output to `handleHostRequest` and the real adapters to it.
- **D4. The line: `<verb> <JSON object>`, printable ASCII, at most 4096 characters, in one canonical form.** A request line is the verb, one space, and one JSON object holding the request's fields in a fixed order and then `actor`. It is checked in this order, each step's refusal winning over later ones:
  1. not a string, longer than `HOST_LINE_MAX` (4096) characters, or holding any character outside U+0020–U+007E (so no newline, carriage return, tab or raw non-ASCII) → `request_invalid`; the length check comes first, as the shell's does (finding 2);
  2. an empty verb → `request_invalid`; a verb not on `HOST_VERBS` (the shell's two included, D5) → `unknown_request`; then a listed verb with no space after it → `request_invalid` (as built: the verb is read before the space is looked for, so a bare unlisted verb answers `unknown_request`);
  3. the rest not JSON, not a plain object, or its own keys not exactly the verb's fields plus `actor` → `request_invalid`;
  4. the actor's form (D6) → `actor_invalid`;
  5. each field's value (D9–D12) → `fields_invalid`;
  6. the line not exactly `formatHostRequest` of what it read → `request_invalid`.

  Why each choice. The verb comes first because the shell handler dispatches on the line's start (finding 2), so forwarding B3's verbs is one more `case` pattern. ASCII only, with every other character a lower-case `\uXXXX` escape, is how the client already sends a requester (finding 3), and makes characters equal bytes. 4096 holds the longest valid line, a 256-emoji venue name at 3142 characters (finding 16); 700, the shell's own limit, does not hold the longest join (1003), so the forwarding pull request must let B3 lines past 700 without changing a clock answer. The canonical check (step 6) gives every accepted line exactly one reading, as PR 2's record format does (`scripts/box/wifi-record.mjs:101-105`): a duplicate key, which `JSON.parse` silently resolves to its last value (finding 16), a different key order, extra spaces or an upper-case escape are all refused. The actor is checked before the fields so that a wrong caller learns nothing about which field values would pass.
- **D5. The Node parser answers `unknown_request` for `clock.status` and `clock.set …`, and calls no adapter.** `SHELL_VERBS` (`["clock.status", "clock.set"]`) is exported so the forwarding pull request can test that the shell forwards no line the Node host refuses as its own and keeps both clock verbs. No separate reason: such a line reaches the Node host only through a forwarding mistake, and a new reason would be one more wire value the server's client must know for a case no correct box produces.
- **D6. The actor's form and who may ask for what.** Two actor forms, ids only, as slice 9b's requesters are:
  - `{"source":"person","person":<id>}`, a person the server authorised for this request;
  - `{"source":"server"}`, one of the server's own duties, with no person.

  A person id is 1 to 64 characters from `A–Z a–z 0–9 -`. Production ids are UUIDs (finding 12), which pass; the wider set lets a restored or test id through, and admits no quote, space, separator or escape into the log. Sources per verb:

  | Verb | Sources |
  | --- | --- |
  | `network.read`, `screen.read` | `person`, `server` |
  | `network.scan`, `network.join`, `network.forget`, `screen.set` | `person` |
  | `tag.write` | `server` |

  Anything else, slice 9b's `admin`, `staff` and `authority` included, and any extra key, is `actor_invalid`. `tag.write` is the server's duty because the spec has the box write the tag "when either changes" (line 858), at installation handoff and after a rename or a move to Live commits; the person who renamed the venue is in the server's own records. *Answer any to override (FYI):* this narrows spec §8, which has a change carry the person so the box's log names who did it (lines 917–919); the reason is that the tag follows a committed rename or move to Live, at handoff, so most writes have no person behind them, and a person on some writes and not others would make the box's log look complete when it is not. The rename's person stays in the server's records.
- **D7. The permission is named by the verb, not carried.** *Answer any to override (FYI).* Spec §8 says a request that changes the box "carries the person and permission the server checked, so the box's log names who did it" (lines 917–919). Here the actor carries the person, and the module's `VERB_PERMISSION` table names the permission the server must have checked for a person request (`system.manage` for each of the six person-capable verbs, spec lines 1044, 1046 and finding 7); the log entry writes it beside the person (D15). The log names who did it and under which permission, as the spec asks; a permission field on the wire would be one more self-reported value whose only possible check is weaker than its name (D2).
- **D8. Joining and forgetting are started by a request and reported by `network.read`.** `network.join` and `network.forget` answer `{"ok":true}` once the host has started the change, or a refusal; the change's progress and outcome are in `network.read`'s `change` (D13). Reason: every connection's instance is stopped at 15 seconds (`waitron-box@.service:11`), and how long a NetworkManager join takes on the box's radio, address included, has not been measured; a started-then-read change keeps every exchange short whatever the join takes. It also matches the spec's own order: the host serialises changes, records a pending operation, applies and checks, and then reports "those two outcomes and recovery availability separately" (lines 715–719). The dashboard polls `network.read` while a change runs.
- **D9. A join's fields are exactly what the boot-copy writer accepts.** `network.join` takes `{ssidHex, keyMgmt, psk, hidden}`, and is accepted only when `formatWifiRecord` of those four would succeed (finding 10); the bytes it returns are zeroed and dropped. So the box joins WPA2-personal (`wpa-psk`) and WPA3-personal (`sae`) networks with the passwords the boot copy can hold, and no others. *Answer any to override (FYI):* open, WEP, OWE and enterprise networks cannot be joined from Red with this protocol; joining one would be a product decision, and the boot copy would then answer "no copy" for it (PR 4's reasons).
- **D10. An SSID travels as hex everywhere.** Requests and replies carry `ssidHex` (1 to 32 bytes as lower-case hex, PR 2's rule, finding 9), never text; turning it into a name to show is the dashboard's. `network.forget` takes `{ssidHex}`, naming the saved network the person saw, so a stale page cannot forget a different one (`not_saved`, D14). `isSsidHex(value)` is exported from `wifi-record.mjs` over its existing `SSID_HEX`, rather than a second copy of the pattern.
- **D11. The start screen is `dashboard` or `till`.** The spec's setting is «Pantalla de este equipo: Panel / Caja» (lines 971–972, 1046); the setup wizard before setup is not a setting (line 965). `screen.set` takes `{start}`, `screen.read` and `screen.set` answer `{"ok":true,"start":…}`. The narrowest set the spec allows; English values, as code is English (CLAUDE.md §3).
- **D12. The name tag request carries a tag the tag can hold, or none.** `tag.write` takes `{tag}`: `null` ("this box has no tag", which removes any tag, as `planNameTagWrite(…, null)` does), or exactly `{name, live}` with `live` a boolean and `usableVenueName(name) === name`, so the name is already NFC and within PR 4's 256 code points without control characters. The server sends `null` for a name the tag cannot hold, which has the same effect as PR 4's `name-unusable` plan. It answers `{"ok":true,"tag":"written"|"removed"|"unchanged"}` (PR 4's plan kinds), or `busy`, `no_free_token`, `header_unreadable` (PR 4's refusals `no-free-token`, `metadata-unreadable`) or `no_space` (PR 4's note: "A step refused for lack of space is reported").
- **D13. The network snapshot.** `network.read` answers exactly:

  ```json
  {"ok":true,"wired":{"connected":true,"address":"192.168.1.10"},"wifi":{"connectedSsidHex":"…","savedSsidHex":"…"},"change":null,"bootCopy":{"state":"current","reason":null,"failure":null}}
  ```

  - `wired.address`: `null`, or a string that `net.isIP` answers 4 or 6 for and holding no `%`, so no interface name rides along (finding 16); `null` whenever `connected` is false. As built, the code has no length limit of its own: on Node v26.13.0 `net.isIP` accepted no form longer than 45 characters among those tried (the hand cases, and 200,000 random IPv6 shapes).
  - `wifi.connectedSsidHex` and `savedSsidHex`: each `null` or hex (D10); the saved one is the box's normal Wi-Fi, which `network.forget` names.
  - `change`: `null`, or `{kind, ssidHex, state, reason}` for the latest change: `kind` `join` or `forget`; `state` `running`, `applied` or `refused`; `reason` `null` unless `refused`, then for a join `password-rejected`, `network-not-found`, `timed-out` or `failed`, and for a forget `failed`.
  - `bootCopy`: exactly PR 5's `status()` shape (finding 11): `state` on `WIFI_COPY_STATES`, `reason` `null` or on `WIFI_NO_COPY_REASONS`, `failure` on `WIFI_COPY_FAILURES` exactly when `state` is `failed`, else `null`.

  So the live change and the boot copy are two outcomes side by side, and the whole change is complete only when `change.state` is `applied` and `bootCopy.state` is `current` or `absent`; the protocol claims neither from the other (spec lines 717–719). `network.scan` answers `{"ok":true,"networks":[{ssidHex, signal, security}, …]}`: at most `NETWORK_SCAN_MAX` (32) networks, each SSID once, `signal` a whole number 0–100, `security` `wpa-psk`, `sae` or `other` (only the first two can be joined, D9). How NetworkManager's flags map onto these is the Linux adapter's. 32 keeps the largest scan reply at 3641 bytes with its newline, under the client's 4096 (findings 3, 16).
- **D14. Refusals.** Any request may be refused with the parser's four, `request_invalid`, `unknown_request`, `actor_invalid`, `fields_invalid`, or the dispatcher's `host_failed` (D15). Each verb adds only these, which an adapter may answer:

  | Verb | Its own refusals |
  | --- | --- |
  | `network.scan` | `busy`, `no_wifi` |
  | `network.join` | `busy`, `no_wifi` |
  | `network.forget` | `busy`, `not_saved` |
  | `tag.write` | `busy`, `no_free_token`, `header_unreadable`, `no_space` |
  | the other three | none |

  `busy` means another change or header write is running, as slice 9b's `busy` means another set is (finding 2). A refusal holds only `ok` and `reason`, as slice 9b's do.
- **D15. The dispatcher.** `handleHostRequest(line, adapters)` resolves with one reply line ending in exactly one `\n` and never rejects: its whole body, step 1 included, runs inside one `try`, so a throwing getter on `adapters` or a Proxy whose key listing throws also answers `host_failed`.
  1. `adapters` not exactly the eight functions (`networkRead`, `networkScan`, `networkJoin`, `networkForget`, `screenRead`, `screenSet`, `tagWrite`, `log`) → `host_failed`, before reading the line, so a broken host answers `host_failed` even to a line the parser would refuse;
  2. a parser refusal (D4) → that refusal, with no adapter and no log call;
  3. `await adapters.log(entry)`, `entry` a frozen `{verb, actor, permission}` (`permission` from `VERB_PERMISSION` for a person actor, `null` for the server), before the request's adapter; a throw or rejection → `host_failed`, and no request adapter runs, so no change happens that the log did not record;
  4. the verb's adapter: called with no argument for a request without fields, and otherwise with the parser's frozen object of exactly the checked fields (`networkJoin` gets `{ssidHex, keyMgmt, psk, hidden}`, `networkForget` `{ssidHex}`, `screenSet` `{start}`, `tagWrite` `{tag}` with `tag` `null` or a frozen `{name, live}`);
  5. its answer, awaited, copied once with `JSON.parse(JSON.stringify(answer))`, and written from the copy by `formatHostReply`, which checks it; a throw, a rejection with anything at all, a copy that throws (a getter, a BigInt), an answer that fails the verb's rules, or a refusal that is not one of the verb's own (D14) → `host_failed`.

  `host_failed` is the fixed line `{"ok":false,"reason":"host_failed"}\n`; no adapter error, message or value is kept, passed on or logged. The module holds no state: serialising changes, timing them out and remembering the latest change are the host service's (spec line 715).
- **D16. `HostReply`, as the parent ledger names it.** `parseHostReply(verb, text)` answers a frozen `{kind:"ok", value}` (the reply without its `ok` key, deeply frozen), `{kind:"refused", reason}` (one of the parser's four, `host_failed`, or the verb's own), or `{kind:"malformed"}` for anything else: text longer than `HOST_REPLY_MAX` (4096) bytes, not ending in exactly one `\n`, not printable ASCII before it, not JSON, or not exactly `formatHostReply`'s line for what it read. The ledger's `{kind:'refused',code}` becomes `reason`, the wire's own word. The later client reads `unknown_request` for a request as "this host does not know this request", for that request only: a host built before a later request was added answers `unknown_request` to that one and still serves the rest, and a box with the shell handler alone answers it to a B3 line of at most 700 characters but `request_invalid` to a longer one, before reading the verb (`deploy/box/waitron-box.sh:161-165`; a join line reaches 1003 characters, a `tag.write` line 3142), so the client must not read `request_invalid` from a shell-only box as a fault in its own line; the forwarding pull request, which lets a B3 line past the shell's 700-character read, removes the case.

## Execution notes for every task

- Work in `/Users/clintongormley/workspace/worktrees/waitron-feat-b3-7-host-protocol`, branch `feat/b3-7-host-protocol`.
- Focused command, from the worktree root: `pnpm exec vitest run scripts/box/host-protocol.test.mjs`. A run with no `Tests` count is no evidence; read the count.
- Coverage for the new file: `pnpm exec vitest run scripts/box/host-protocol.test.mjs --coverage --coverage.reportsDirectory="$(mktemp -d)" --coverage.include=scripts/box/host-protocol.mjs`. The table prints no per-file rows for one included file; read the four summary lines. `0/0` means the include matched nothing. Each must be 100%, or the gap named to the reviewer; the bar is 98/98/98/95. Never pad tests or add an ignore comment to reach it.
- Before each commit: `pnpm exec prettier --check <changed files>` and `pnpm exec eslint <changed .mjs files>`.
- Every expected value in a test is a literal written in the test, never computed by the module under test, except where a step says "round trip".
- **Deletion controls:** each task lists checks to remove one at a time. Remove the check, run the focused command, confirm that the named test fails *for that reason* (read the assertion message), restore the check, and report each control's failing test name in the task's handover. Commit none of them.
- **Escapes in line literals.** In this plan, a line literal holds only ASCII: every non-ASCII character in it is written as a lower-case `\u` escape, and `\u00e9` inside a line means those six characters on the wire (in a JavaScript test literal, `"\\u00e9"` or `String.raw`), which the parser reads as `é`. The one exception is Task 1's framing case "a raw `é`", which is the single character U+00E9 in the line and must be refused before parsing.
- Shared test helpers, written in Task 1 and added to later: `person = { source: "person", person: "0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11" }`, `server = { source: "server" }`, and `line(verb, objectText)` which joins with one space. Write each line's JSON as a literal string in the test, not with `JSON.stringify`, so the canonical form is pinned by the test and not by the code.

### Task 1: the verbs, the line, the canonical form and the actor

**Files:** create `scripts/box/host-protocol.mjs`, `scripts/box/host-protocol.test.mjs`.

**Interface (this task):**

```js
export const HOST_VERBS; // frozen, seven of Task 3.1's eight, in its order
export const SHELL_VERBS; // frozen: ["clock.status", "clock.set"]
export const HOST_LINE_MAX = 4096;
export const PERSON_ID_MAX = 64;
export const VERB_PERMISSION; // frozen: each verb with a person source -> "system.manage"
/** @returns {{ok:true, request:{verb, fields, actor}} | {ok:false, reason}} frozen, never throws */
export function parseHostRequest(line) {}
/** @param {{verb, fields, actor}} request @returns {string} the canonical line, no newline; throws host_request.invalid */
export function formatHostRequest(request) {}
```

In this task the field verbs check their field **keys** only (D4 step 3) and accept any JSON values; Task 2 adds the value rules. `fields` is a frozen object of exactly the verb's field keys (`{}` for the three field-less verbs). Every Task 1 line that has fields, accepted or refused for its form, uses values Task 2 accepts (for example `"start":"dashboard"`, `"tag":{"name":"Bar Pepe","live":true}`, the Task 2 `network.join` example), so Task 2 changes no Task 1 assertion.

- [ ] **Step 1: Write the failing tests.**
  - Lists: `HOST_VERBS` equals the literal `["network.read","network.scan","network.join","network.forget","screen.read","screen.set","tag.write"]`; `SHELL_VERBS` equals `["clock.status","clock.set"]`; the two share no entry; `first-start.status` is a verb like any unknown one (`unknown_request`); and only after those equality checks, in the same test, both are frozen (`Object.isFrozen(undefined)` is true, so a frozen check alone passes before the export exists). `VERB_PERMISSION` equals the literal object naming `system.manage` for the six person-capable verbs (D6) and has no `tag.write` key, then is frozen.
  - Accepted, with the exact frozen result: `network.read {"actor":{"source":"person","person":"0b9c…"}}` → `{ok:true, request:{verb:"network.read", fields:{}, actor:{source:"person", person:"0b9c…"}}}`, all three objects frozen; the same with `{"actor":{"source":"server"}}`; one line per field-less verb with each source D6 allows.
  - Framing (`request_invalid`): `undefined`, `42`, a `Buffer` of a valid line, `""`, `"network.read"` (no space), `"network.read "` (nothing after), `" network.read {…}"` (leading space: empty verb), two spaces after the verb, a trailing space, a trailing `"\n"`, a `"\r"`, a tab inside the JSON, a raw `"é"` inside a string, DEL (U+007F). A 4097-character line whose verb is unknown → `request_invalid` (length first); a 4096-character line whose verb is unknown → `unknown_request` (the limit is inclusive).
  - Verb (`unknown_request`): `clock.status`; `clock.set 1730073600000 {"source":"admin","person":"p1"}`; `network.readx {…}`; `NETWORK.READ {…}`; `network {…}`; and no adapter exists to be called (Task 4 repeats this through the dispatcher).
  - Object and keys (`request_invalid`): `network.read []`, `network.read null`, `network.read "x"`, `network.read {` (not JSON), `network.read {}` (no actor), `{"actor":…,"extra":1}`, `{"__proto__":{},"actor":…}`, and for `network.join` an object missing `psk` or holding `password` instead.
  - Canonical (`request_invalid`): the valid `network.read` line with a space after `:`; with the actor's keys as `{"person":…,"source":"person"}`; with `"actor"` given twice (the second valid); a `screen.set` line, `"start":"dashboard"`, with `actor` before `start`; a `tag.write` line whose tag is `{"name":"Caf\u00E9","live":true}` with the server actor, the escape in upper case (refused here, and still refused in Task 2, where the same line with `Caf\u00e9` is accepted).
  - Actor (`actor_invalid`), each on a `network.read` line unless named: actor `null`, `[]`, `"person"`, `{}`; `{"source":"admin","person":"p1"}`; `{"source":"staff","person":"p1","device":"d1"}`; `{"source":"authority","check":null}`; person with an extra `device` key; person id `""`, 65 characters, `"a b"`, `"a_b"`, `"a\"b"`, `"a.b"`, a number, `null`; `{"source":"server","person":"p1"}`; `{"source":"server"}` on `network.scan`, `network.join`, `network.forget`, `screen.set`; a person on `tag.write`. Accepted: a 64-character id, an upper-case UUID, `"p1"`.
  - Order: a line with both an unknown actor source and a bad key set → `request_invalid` (keys before actor); a line with a bad actor that is also non-canonical → `actor_invalid` (actor before the canonical check).
  - `formatHostRequest`: for each accepted line above, `formatHostRequest(parseHostRequest(line).request)` equals the line (round trip). It throws `code: "host_request.invalid"` for an unknown verb, a shell verb, a bad actor, a missing or extra field key, a non-object; the error's `JSON.stringify` and `String()` hold none of the request's values (pass a field holding the canary `"Canary-7f3a91"` with a wrong key set).
  - Nothing is written to the console: spy `console.log`, `console.error`, `process.stdout.write` and `process.stderr.write` for the whole file and assert none was called, after each case.
- [ ] **Step 2:** Run the focused command. Expected failure: `Error: Cannot find module './host-protocol.mjs' imported from …` (re-map finding 17), `0 test`.
- [ ] **Step 3: Implement.** The constants; a `refusal(reason)` returning a frozen `{ok:false, reason}`; `programmingError(code)` like `name-tag.mjs:24-26` with no value in it; the D4 steps 1–4 and 6 in order (step 5 is Task 2's); the per-verb field-key table; the actor check by D6; the canonical writer used by both `formatHostRequest` and step 6: `JSON.stringify` of an object built in the verb's key order with `actor` last (`{source, person}` or `{source}`), then every character outside U+0020–U+007E replaced by `\u` and four lower-case hex digits (the client's rule, finding 3). Use `exactRecord` from `scripts/box/upgrades/contracts.mjs:7-15` for every key-set check, so `__proto__` counts as a key.
- [ ] **Step 4:** Focused command green; coverage summary read; prettier and eslint clean.
- [ ] **Step 5: Deletion controls.** Remove, one at a time: the length check (the 4097 case fails, answering `unknown_request`); the ASCII check (the raw `é` case fails); the shell-verb exclusion, if implemented as a separate check rather than by absence from `HOST_VERBS` (otherwise say so); the exact-keys check (the `extra` case fails); the canonical comparison (the duplicate-`actor` case fails); the source-per-verb table (the server-on-`network.scan` case fails); the person-id pattern (the `"a b"` case fails).
- [ ] **Step 6: Commit:** `git commit -s -m "feat(box): the host protocol's request line and actor"`.

### Task 2: each request's fields

**Files:** modify `scripts/box/host-protocol.mjs`, `scripts/box/host-protocol.test.mjs`, `scripts/box/wifi-record.mjs` (one export), `scripts/box/wifi-record.test.mjs` (new cases only).

**Interface:** `wifi-record.mjs` gains `export function isSsidHex(value) { return typeof value === "string" && SSID_HEX.test(value); }` beside `SSID_HEX` (`:23`), and nothing else in it changes. `parseHostRequest` and `formatHostRequest` gain D4 step 5.

- [ ] **Step 1: Write the failing tests.**
  - `wifi-record.test.mjs`: `isSsidHex` answers true for `"00"`, `"ff"`, 64 hex characters; false for `""`, `"f"`, `"FF"`, 66 characters, `"zz"`, `null`, `42`. Its count grows from 268; no existing case changes.
  - `network.join` accepted, each with person: `{"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false,"actor":…}`; a 63-character printable password; 64 hex characters as the password; `keyMgmt` `sae` with a 1-byte password and with `\u00e9` repeated 128 times (256 bytes as UTF-8); that last one with `"ssidHex"` `"ab"` repeated 32 times, `"hidden":false` and a 64-character person id is 1003 characters (finding 16; assert the literal `1003`); `hidden` true. Each `request.fields` is exactly the four keys, frozen.
  - `network.join` refused `fields_invalid`: `keyMgmt` `"wpa-eap"`, `"none"`, `"WPA-PSK"`, `null`; `psk` of 7 characters, 64 characters not all hex, `"caf\u00e9secret"` with `wpa-psk` (not printable ASCII once read), `null`; `sae` with 257 bytes, with a tab (`\t` escape), with a lone surrogate `"\ud800"`; `ssidHex` `""`, `"F0"`, `"f"`, 66 characters; `hidden` `"false"` and `0`.
  - `network.forget` accepted with `{"ssidHex":"4361666550657065","actor":…}`; refused `fields_invalid` for each bad `ssidHex` above.
  - `screen.set` accepted for `"dashboard"` and `"till"`; refused `fields_invalid` for `"Panel"`, `"Caja"`, `"setup"`, `""`, `"DASHBOARD"`, `null`.
  - `tag.write` accepted with server for `{"tag":null,…}`, `{"tag":{"name":"Bar Pepe","live":true},…}`, `{"tag":{"name":"Caf\u00e9","live":false},…}` (NFC `é`), and `{"tag":{"name":<256 emoji, each as its two lower-case `\u` escapes>,"live":false},"actor":{"source":"server"}}`, 3142 characters (finding 16; assert the literal `3142`; with `"live":true` it is 3141). For each accepted non-null tag, `request.fields.tag` is frozen, since the dispatcher hands the parser's fields to `tagWrite` as they are (D15 step 4). Refused `fields_invalid`: the decomposed `"Cafe\u0301"` (an `e` and a combining acute accent; its NFC form differs); 257 code points; `""`; a name holding `\t`; a name `42`; `live` `"true"`; a tag with an extra key; `tag` `"Bar"` or `[]`. A `tag.write` line whose name has an upper-case escape stays `request_invalid` (Task 1's case, now with an otherwise valid name).
  - Round trip: for every accepted line, `formatHostRequest(parseHostRequest(line).request) === line`. `formatHostRequest` throws `host_request.invalid` for every refused field value above.
  - Canary: a `network.join` request object whose `psk` is `"Canary-7f3a91"` and whose `keyMgmt` is `"wpa-eap"` makes `formatHostRequest` throw an error whose `JSON.stringify`, `String()` and `stack` hold no `Canary-7f3a91`; `parseHostRequest` of the same as a line answers exactly `{ok:false, reason:"fields_invalid"}`.
  - The join check zeroes what it borrows. `vi.mock` is hoisted and applies to the whole test file, so mock `./wifi-record.mjs` once with a pass-through built from `importOriginal`: every export is the real one, except that `formatWifiRecord` calls the real function and records each array it returns. Clear the record before the call under test. For each accepted join line: at least one array is recorded (so an empty record cannot pass), every recorded array has that record's length (95 bytes for the `wpa-psk` example above, measured with `node` on 2026-11-05; write each expected length as a literal), and every byte of every one is zero after `parseHostRequest` answers. The same for a join whose fields are valid but whose line is refused later: the `wpa-psk` example with a space after one colon answers `request_invalid` at D4 step 6, after the Wi-Fi check has run, and at least one array is recorded, every one zeroed.
- [ ] **Step 2:** Run the focused command and `pnpm exec vitest run scripts/box/wifi-record.test.mjs`. Expected: the `isSsidHex` cases fail with `TypeError: isSsidHex is not a function` (finding 17); in `host-protocol.test.mjs` every `fields_invalid` case fails, answering `ok: true` (Task 1 checks keys only), the zeroing cases fail with no array recorded (Task 1 never calls `formatWifiRecord`), and the accepted and round-trip cases pass.
- [ ] **Step 3: Implement** D9–D12 as step 5 of `parseHostRequest` and inside `formatHostRequest`: `network.join` through `formatWifiRecord` in a `try`, zeroing the returned bytes with `.fill(0)` before answering; `network.forget` through `isSsidHex`; `screen.set` against `["dashboard","till"]`; `tag.write`: `null`, or `exactRecord(tag, ["name","live"])`, `typeof live === "boolean"` and `usableVenueName(name) === name`.
- [ ] **Step 4:** Both focused commands green (`wifi-record.test.mjs` above 268, none changed); coverage summary read for `host-protocol.mjs` and, with the same command naming `wifi-record`, for `wifi-record.mjs` (100% of 180 statements, 159 branches, 27 functions and 147 lines before, finding 14); prettier and eslint clean.
- [ ] **Step 5: Deletion controls.** Remove, one at a time: the `formatWifiRecord` call (the `wpa-eap` case fails, and the zeroing case records no array); the `.fill(0)` (the zeroing case fails on a non-zero byte); the `isSsidHex` call for forget (the `"F0"` forget case fails); the NFC equality (the decomposed-name case fails); the screen list (the `"Panel"` case fails).
- [ ] **Step 6: Commit:** `git commit -s -m "feat(box): the host protocol's request fields"`.

### Task 3: replies, written and read back

**Files:** modify `scripts/box/host-protocol.mjs`, `scripts/box/host-protocol.test.mjs`, `scripts/box/wifi-boot-copy.mjs` (two exports), `scripts/box/wifi-boot-copy.test.mjs` (new cases only).

**Interface:**

```js
// wifi-boot-copy.mjs, beside the typedefs at :13-15; nothing else in it changes:
export const WIFI_COPY_STATES = Object.freeze(["pending", "current", "absent", "failed"]);
export const WIFI_COPY_FAILURES = Object.freeze(["mount-unverified", "root-changed", "path-unsafe",
  "permissions-unsafe", "io-failed", "publication-unverified"]);

// host-protocol.mjs:
export const HOST_REPLY_MAX = 4096; // bytes with the newline, the client's limit
export const NETWORK_SCAN_MAX = 32;
/** @returns {string} one line ending "\n"; throws host_reply.invalid */
export function formatHostReply(verb, reply) {}
/** @returns {{kind:"ok", value} | {kind:"refused", reason} | {kind:"malformed"}} frozen, never throws */
export function parseHostReply(verb, text) {}
```

`formatHostReply` accepts any refusal D14 allows for the verb (the parser's four, `host_failed`, the verb's own); the dispatcher (Task 4) narrows what an adapter may answer.

- [ ] **Step 1: Write the failing tests.** Write each expected line as a literal.
  - `wifi-boot-copy.test.mjs`: the two lists equal the literals above (`toEqual`, so `undefined` fails) and then, in the same test, are frozen; a fresh publisher's first `status()` has its `state` on `WIFI_COPY_STATES` and its `failure` `null`. Count grows from 198.
  - Each verb's valid replies, written by `formatHostReply` and read back by `parseHostReply` to `{kind:"ok", value}` with `value` deep-equal to the reply without `ok` and deeply frozen:
    - `network.read`: the D13 example; wired disconnected with `address: null`; an IPv6 address `"fe80::1"`; `change` running, applied, refused with each join reason, forget refused `failed`; `bootCopy` each state, `failed` with each failure, `absent` with `"cable-only"`.
    - `network.scan`: no networks; one of each `security`; 32 networks.
    - `network.join`, `network.forget`: `{ok:true}`.
    - `screen.read`, `screen.set`: each start.
    - `tag.write`: each of `written`, `removed`, `unchanged`.
  - Refusals: each verb's own (D14), the parser's four and `host_failed` read back as `{kind:"refused", reason}`; `not_saved` for `network.join`, `no_wifi` for `screen.read`, and `"nope"` for any verb make `formatHostReply` throw `host_reply.invalid` and `parseHostReply` answer `malformed`.
  - Refused shapes, each making `formatHostReply` throw `host_reply.invalid` and the same text (built by hand as a literal) answer `malformed`: an extra key at the top or in any nested object; `wired.connected` `"yes"`; an address with `connected` false; `"01.2.3.4"`, `" 1.2.3.4"`, `"fe80::1%eth0"`, `"host.local"`, 46 characters; `connectedSsidHex` `"FF"`; `change` with `state` `running` and a reason; `refused` with `null`; a forget refused `password-rejected`; `kind` `"scan"`; `bootCopy` `failed` with `failure: null`, `current` with a failure, `state` `"ok"`, `reason` `"wifi"`; 33 networks; the same `ssidHex` twice; `signal` `101`, `-1`, `50.5`, `"50"`; `security` `"wep"`; `start` `"Panel"`; `tag` `"replaced"`; `ok` missing; `ok` `"true"`; a refusal with an extra key.
  - Read-back framing (`malformed`): no trailing newline; two; `"\r\n"`; a space after a colon; keys reordered; a duplicate key; a non-string; a 4097-byte text; non-JSON.
  - Size: the largest scan reply (32 networks, each a different 64-character hex SSID, signal 100, `wpa-psk`) written by `formatHostReply` is at most `HOST_REPLY_MAX` bytes (the planner measured 3640 before the newline for 32 equal entries, finding 16); write the length the test measures as a literal in the test once, so a change to the shape shows as a changed number.
- [ ] **Step 2:** Run both focused commands. Expected: every new case fails with `TypeError: formatHostReply is not a function` (or `parseHostReply`), and the two list cases with `expected undefined to deeply equal […]` (finding 17).
- [ ] **Step 3: Implement** one rule table per verb that both functions use: `formatHostReply` builds the canonical object in a fixed key order from the checked values (`ok` first, then the D13 order) and `JSON.stringify`s it with Task 1's ASCII escaping, adding `"\n"`; `parseHostReply` checks type, size and `^[ -~]*\n$`, parses, and answers `ok` or `refused` only when `formatHostReply(verb, parsed)` (in a `try`) equals the text exactly; otherwise `malformed`. Addresses through `net.isIP` plus the length and `%` rules; copy states through PR 5's lists and `WIFI_NO_COPY_REASONS`.
- [ ] **Step 4:** Both focused commands green; coverage summary read for `host-protocol.mjs` and `wifi-boot-copy.mjs`; prettier and eslint clean.
- [ ] **Step 5: Deletion controls.** Remove, one at a time: the `%` rule (the zone case fails); the scan's uniqueness check (the duplicate case fails); the 32 limit (the 33 case fails); the `failure`-iff-`failed` rule (the `failed`/`null` case fails); the per-verb refusal list (the `not_saved`-for-join case fails); the canonical comparison in `parseHostReply` (the reordered-keys case fails).
- [ ] **Step 6: Commit:** `git commit -s -m "feat(box): the host protocol's replies"`.

### Task 4: answering one line

**Files:** modify `scripts/box/host-protocol.mjs`, `scripts/box/host-protocol.test.mjs`.

**Interface:**

```js
/**
 * @param {unknown} line  one request line without its newline
 * @param {HostAdapters} adapters  exactly networkRead, networkScan, networkJoin, networkForget,
 *   screenRead, screenSet, tagWrite, log; each may return a value or a promise
 * @returns {Promise<string>} one reply line ending "\n"; never rejects
 */
export async function handleHostRequest(line, adapters) {}
```

Test helper: `fakeAdapters(overrides)` returns the eight as `vi.fn()`s answering a valid reply per verb, and a shared `calls` array each pushes `[name, ...args]` to, so order is visible.

- [ ] **Step 1: Write the failing tests.**
  - Each verb: a valid line answers exactly `formatHostReply(verb, <the fake's answer>)` (round trip); `calls` is exactly `[["log", {verb, actor, permission}], [<adapter>, …]]`, in that order; the log entry is frozen, with `permission` `"system.manage"` for a person and `null` for the server.
  - Arguments: field-less adapters are called with zero arguments (`mock.calls[0].length === 0`); `networkJoin` with one frozen object deep-equal to the four fields; `tagWrite` with `{tag: null}` and with a frozen `{tag: {name, live}}` whose `tag` is frozen too.
  - Parser refusals through the dispatcher: one line for each of `request_invalid`, `unknown_request` (including `clock.status` and `clock.set …`), `actor_invalid`, `fields_invalid` answers `{"ok":false,"reason":"<r>"}\n` and `calls` stays empty.
  - `host_failed` (`{"ok":false,"reason":"host_failed"}\n`, every time): `adapters` `undefined`, `null`, missing `log`, an extra key, `networkRead: "x"` (and `calls` stays empty), an object whose `log` is a getter that throws, and a `Proxy` whose `ownKeys` trap throws; invalid adapters (`undefined`) with a line the parser refuses (`clock.status`) → `host_failed`, not `unknown_request` (D15 step 1); `log` throwing, and rejecting (the request adapter is not called); the adapter throwing an `Error`, throwing a string, rejecting with `undefined`, returning a promise that rejects with an object whose `toString` throws; answering `{ok:true}` with an extra key, a getter that throws, a `BigInt`, an object with `toJSON` returning an invalid shape, `undefined`, `null`; answering a parser reason (`actor_invalid`), `host_failed`, or another verb's reason (`not_saved` from `networkJoin`).
  - The answer is copied once before it is checked: `screenRead` answering `Object.assign(Object.create({toJSON: () => ({ok: true, start: "till"})}), {ok: true, start: "dashboard"})` answers exactly `{"ok":true,"start":"till"}\n` (the copy's value; reading the object's own fields would give `dashboard`).
  - A valid adapter refusal passes through: `networkJoin` answering `{ok:false, reason:"busy"}` → `{"ok":false,"reason":"busy"}\n`; `tagWrite` answering `no_space` → that line.
  - Never rejects: 2,000 lines made from the valid lines of Tasks 1–3 by a seeded generator (delete, insert or replace one character, chosen by a fixed-seed linear congruential generator written in the test), each with `fakeAdapters()`; every promise resolves, and every answer either equals a refusal line `{"ok":false,"reason":"<one of D14's>"}\n` or is `parseHostReply` `ok` for the line's verb.
  - **Canary sweep.** `CANARY = "Canary-psk-7f3a91"`; forms: the text, its UTF-8 hex, its base64; `canaryError = Object.assign(new Error(CANARY), {code: CANARY, reason: CANARY})`. A valid `network.join` line whose password is `CANARY`, run once with each of:
    - runs where `log` fails, so no request adapter runs (D15 step 3): every adapter, `log` included, throwing `canaryError`; `log` alone throwing `canaryError`; `log` rejecting with it. In each: `networkJoin` was not called.
    - runs where `log` succeeds: every adapter but `log` throwing `canaryError`; `networkJoin` alone throwing it; `networkJoin` rejecting with it; `networkJoin` answering `{ok:false, reason: CANARY}`; `networkJoin` answering `{ok:true, psk: CANARY}`; the fakes' normal answers. In each: `networkJoin` was called once, and its call holds the canary exactly once, as `psk`.
    - In every run: the answer is exactly `{"ok":false,"reason":"host_failed"}\n` or the fakes' normal `{"ok":true}\n`, and holds no form of the canary; `JSON.stringify` of every call except `networkJoin`'s holds none (the log entry included); the console spies (Task 1) were not called.
    - Also a `network.read` whose adapter answers a snapshot with an extra `psk: CANARY` answers `host_failed` with no form of it.
- [ ] **Step 2:** Run the focused command. Expected: the new cases fail with `TypeError: handleHostRequest is not a function` (finding 17).
- [ ] **Step 3: Implement** D15 in order, the whole body inside one `try` whose `catch` answers the fixed `host_failed` line and keeps nothing from the error: the adapters check with `exactRecord` and `typeof … === "function"` for each; `parseHostRequest`; the log entry; the adapter call by a verb-to-name table, passing the parser's frozen `fields` (whose non-null `tag` is frozen too); `await`; the one copy; the adapter's refusal list (the verb's own, D14, only); `formatHostReply`.
- [ ] **Step 4:** Focused command green; coverage summary 100% (or the gap named); prettier and eslint clean.
- [ ] **Step 5: Deletion controls.** Remove, one at a time: the adapters check (the extra-key case fails, answering the fake's normal reply; the `networkRead: "x"` case fails its "`calls` stays empty" check, `log` having been called; the invalid-adapters-with-`clock.status` case fails, answering `unknown_request`; the missing-`log` case still answers `host_failed`, through the `try`, so it is not this control's test); awaiting `log` before the adapter (the order case fails); the `try` (the throwing-adapter case rejects, and so does the throwing-`log`-getter case); the JSON copy (the `toJSON` case fails, answering `dashboard`); the adapter refusal narrowing (the `actor_invalid`-from-adapter case fails).
- [ ] **Step 6: Commit:** `git commit -s -m "feat(box): answer one host request through injected adapters"`.

### Task 5: backlog, pointers and the settled 9b question

> The drafts below are what to write. If the pull request's review narrows anything, write what landed, not the draft.

**Files:**
- Modify: `docs/backlog.md`: the B3 entry (line 5300 on main) and the summary line "B3 keeps or replaces the clock requests slice 9b shipped." (lines 5382–5383).
- Modify: `docs/backlog/box.md`: after PR 6's "Built so far" paragraph (ends line 994 on main); after "For later slices, from PR 6's re-map" (ends before "Left open by PR 1's review", line 1164); `## Decisions and deliberate limits` (line 1252); the entry `## B3 keeps or replaces the clock requests slice 9b shipped.` (lines 1861–1869).
- Modify: `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md`, one dated pointer line at the top.
- Modify: `docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, the pointer line this branch's first commit added: put the pull request's number in it.

- [ ] **Step 1: Citations first.** Run `git grep -n "keeps or replaces\|keeps or migrates\|b3-keeps-or-replaces"`. On main it printed `docs/backlog.md:5382-5383`, `docs/backlog/box.md:1861`, the parent plan's line 173 and slice 9b's plan line 3705. The two plans are historical and cite the question, so its answer moves to Decisions (Step 3) rather than vanishing; the parent plan already carries this branch's pointer under its paragraph.
- [ ] **Step 2: `docs/backlog/box.md`, PR 7's paragraph**, after PR 6's (`#PR7` filled in once the pull request exists): **Built so far (2026-11-05), PR 7.** [PR 7](../superpowers/plans/2026-11-05-b3-7-host-protocol.md) (#PR7) adds `scripts/box/host-protocol.mjs`, called by nothing yet: what the server may ask B3's host service and what it may answer, as a pure module with no socket, root or NetworkManager.
  - Seven requests from Task 3.1's list (`HOST_VERBS`; `first-start.status` is left to slice 1's recipe); `clock.status` and `clock.set` stay slice 9b's shell handler's (`SHELL_VERBS`) and this module answers them `unknown_request`.
  - A request is one line: the verb, one space and one JSON object of the request's fields and then `actor`, printable ASCII only, at most 4096 characters, and accepted only in the exact form `formatHostRequest` writes, so a duplicate key, another key order, extra spaces or an upper-case escape is refused. Refusals: `request_invalid`, `unknown_request`, `actor_invalid`, `fields_invalid`.
  - The actor is ids only: `{"source":"person","person":<id>}` (1–64 of `A–Z a–z 0–9 -`) or `{"source":"server"}`, each request accepting only its listed sources; the host checks the form and never a permission; the log entry names the verb's permission (`system.manage`) from the module's own table.
  - Fields: a join takes exactly what the boot-copy writer accepts (`formatWifiRecord`: WPA2 or WPA3 personal), with the SSID as hex (`isSsidHex`, now exported by `wifi-record.mjs`); a forget names the saved SSID; the start screen is `dashboard` or `till`; the name tag is `null` or a name `usableVenueName` leaves unchanged.
  - Replies: each request's shape is checked when written and when read back (`formatHostReply`, `parseHostReply`), so the server's client can check what it receives by the same rules. A join or forget answers once started, and `network.read` reports the change and the boot copy's state (PR 5's, its lists now exported by `wifi-boot-copy.mjs`) side by side. A scan lists at most 32 networks, which keeps the reply under the client's 4096 bytes.
  - `handleHostRequest(line, adapters)` logs the verb and actor, calls the one adapter with only the checked fields, copies and checks its answer, and answers the fixed `host_failed` for any adapter failure or wrong answer, with no adapter error text in it. A canary sweep finds the Wi-Fi password only in the join adapter's argument.
- [ ] **Step 3: Decisions**, as a bullet under `## Decisions and deliberate limits`: **B3 keeps slice 9b's clock requests on their wire and shell handler (B3 PR 7's D1; the lane's decision of 2026-11-05, open to the owner).** They have landed, the clock-behind stop and the clock confirmation use them, and a box installed by `waitron.sh` has no Node on its host. B3's requests will share the socket, the one-line framing and `apps/server/src/box-host-client.ts`; the shell handler is to forward them to the Node host in slice 3's Linux pull request. The host knows its caller by the socket alone (D2): only root and the app's group can connect, one request per connection, so there is no token to replay; the server is to mint an ids-only actor from a session it authorised, and the host checks its form and logs it, and a compromised server can send any actor, as with slice 9b's requester. ([PR 7's plan](../superpowers/plans/2026-11-05-b3-7-host-protocol.md), D1, D2.)
- [ ] **Step 4: Delete** the entry `## B3 keeps or replaces the clock requests slice 9b shipped.` in `docs/backlog/box.md` and its two summary lines in `docs/backlog.md`.
- [ ] **Step 5: "For later slices, from PR 7's re-map"**, a new heading after PR 6's list: **For later slices, from PR 7's [re-map against main](../superpowers/plans/2026-11-05-b3-7-host-protocol.md#re-map-against-main-on-2026-11-05):**
  - The shell handler forwards a line whose verb is on `HOST_VERBS` to the Node host and keeps answering both clock verbs itself; a B3 line can be up to 4096 characters, so it must be read past the clock's 700-character limit without changing a clock answer. A box with the shell alone answers `unknown_request` to a B3 line of at most 700 characters, and `request_invalid` to a longer one, before it reads the verb (`deploy/box/waitron-box.sh:161-165`; a join line reaches 1003 characters, a `tag.write` line 3142). So the server's client must not read `request_invalid` from a shell-only box as a fault in its own line; the forwarding pull request, which lets a B3 line past the shell's 700-character read, removes the case. The client reads `unknown_request` as "this host does not know this request", for that request only (D16), since a host built before a later request was added answers it to that request alone.
  - Every connection's instance stops at `RuntimeMaxSec=15`. A join and a forget answer once started (D8), so each exchange stays short; how long a scan takes on the box's radio, and a join with its address, are rig measurements.
  - The server's client sends the exact line `formatHostRequest` writes and checks each reply with `parseHostReply`. Nothing in `apps/` imports `scripts/box/` today, so the client pull request chooses between importing the module, moving it into a package, or a TypeScript twin held to it by a shared test.
  - The server's routes check `system.manage` for every person request; `tag.write` runs as the server's own duty at handoff and after a rename or a move to Live commits, sending `null` for a name the tag cannot hold.
  - The host service holds the latest change, serialises changes (one at a time, `busy` otherwise) and publishes the boot copy after each, keeping the two outcomes separate in `network.read`.
  - `first-start.status`, in Task 3.1's list, is left to slice 1's recipe pull request: nothing defines its answer or reads it, because the host itself serves first start's failure page while Waitron is not yet running (spec §7.3 item 3). That pull request decides whether the request exists, and if it does, its answer and who reads it.
  - Decisions recorded for review: the permission is named by the verb on the host, not carried on the wire, narrowing spec §8's "carries the person and permission" (D7); a join takes WPA2 and WPA3 personal networks only, so open, OWE and enterprise networks cannot be joined from Red (D9); `tag.write` takes no person actor, narrowing spec §8's "carries the person" (D6).
- [ ] **Step 6: `docs/backlog.md`.** After the PR 6 sentence in the B3 entry, add: PR 7 (#PR7, [plan](superpowers/plans/2026-11-05-b3-7-host-protocol.md)) adds the box host protocol under `scripts/box/`, called by nothing yet: seven of B3's requests as checked one-line requests with an ids-only actor, their checked replies, and an answer function that calls injected adapters and never leaks a Wi-Fi password; the clock requests stay on slice 9b's shell handler.
- [ ] **Step 7: Pointers.** At the top of the spec, above the PR 6 line, add `> 2026-11-05: PR 7's plan (the box host protocol: B3's requests, their actor and replies): [2026-11-05-b3-7-host-protocol.md](../plans/2026-11-05-b3-7-host-protocol.md); the clock requests stay on slice 9b's wire and shell handler (its D1), and the host knows its caller by the socket alone (its D2).` and a blank line. In the parent plan, replace `(#PR7)` in the top pointer line with the number. Do not rewrite either historical body (CLAUDE.md §6, docs).
- [ ] **Step 8: Guides and CLAUDE.md.** No guide changes: nothing a person sees changed. No CLAUDE.md line unless an implementing task paid for a new trap; if one did, add one line plus a pointer.
- [ ] **Step 9:** `pnpm exec prettier --file-info docs/backlog/box.md` (prints `"ignored": true`; docs are not format-checked). Commit: `git add docs/backlog.md docs/backlog/box.md docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md docs/superpowers/plans/2026-10-26-b3-usb-installer.md && git commit -s -m "docs(backlog): record B3's host protocol and settle the clock requests question"`.

---

## Self-review

**Parent-plan and spec coverage for this pull request.**

| Sentence | Where |
| --- | --- |
| Parent line 170: "`HostRequest` discriminated union in `host-protocol.mjs`: `network.read`, … `first-start.status`" | `HOST_VERBS`, seven of the eight; Task 1. `first-start.status`: Out (the lane's ruling) |
| Parent line 170: "`NetworkSnapshot={wired:{connected,address},wifi:{connectedSsid,networks}}`" | D13, split into `network.read` and `network.scan`, SSIDs as hex (D10); Task 3 |
| Parent line 170: "`handleHostRequest(request, actor)` validates fixed fields and actor/permission at each action" | D15 (the actor travels in the line), D2/D7 (form, not permission); Tasks 1, 4 |
| Parent line 170: "no arbitrary path or command execution" | Global Constraints; D4, D9–D12 |
| Parent lines 172–192: "B3 either keeps the two requests on this wire or moves them" | D1; Task 5 |
| Ledger line 82: "Specify its exact wire authentication and replay boundary in 3.1" | D2 |
| Parent line 205: "reject unknown verb, oversized/malformed fields, path/shell injection and missing/forged actor; a genuine permitted request still works" | Tasks 1, 2 (forged: any actor form D6 refuses; "genuine" round trips); socket permission controls: Out |
| Parent line 205: "A set network failure returns actionable refusal without leaking its password" | D13's change reasons, D14; Task 4's canary sweep |
| Spec lines 917–919: "accepts a fixed list of requests and nothing else … carries the person and permission … the box's log names who did it" | D4, D5, D6, D7, D15's log entry |
| Spec lines 715–719: "report those two outcomes and recovery availability separately" | D8, D13 |
| Spec line 731: "No … secret audit fields or password-bearing command arguments/logs" | Global Constraints; Task 4's sweep |

Parent line 205's Linux permission controls, the name tag's header bytes, the hotspot and prior-connection cases, and the network-copy cases on line 206 are Linux adapter work, under "Out".

**Names.** New names are this plan's: `HOST_VERBS`, `SHELL_VERBS`, `HOST_LINE_MAX`, `HOST_REPLY_MAX`, `PERSON_ID_MAX`, `NETWORK_SCAN_MAX`, `VERB_PERMISSION`, `parseHostRequest`, `formatHostRequest`, `formatHostReply`, `parseHostReply`, `handleHostRequest`, `isSsidHex`, `WIFI_COPY_STATES`, `WIFI_COPY_FAILURES`, codes `host_request.invalid` and `host_reply.invalid`, and the wire reasons of D14.

**Task size.** Each task touches one module and its test file, plus at most one export and its cases in one sibling. Task 3 has the most cases (one table per verb) and no new control flow beyond the rule tables.

**What the planner ran (2026-11-05):**
- `pnpm exec vitest run` of `name-tag`, `wifi-record` and `wifi-boot-copy` tests (646, 268, 198) and the one-file coverage command for `name-tag.mjs` (100% of 90 statements, 80 branches, 22 functions, 76 lines);
- `node /tmp/b3p7-probe/probe.mjs` (finding 16: line and reply sizes with the client's escaping, `JSON.parse` of a duplicate key, `net.isIP` on seven addresses); `node -e` for the `tag.write` line with the server actor (3142) and for the `toJSON` copy case (the copy answered `till`, the object's own `start` read `dashboard`);
- a throwaway `scripts/box/zz-probe.test.mjs`, deleted after, for Vitest's missing-module and missing-export output (finding 17);
- `git grep` for the box client's consumers, `system.manage`, the socket mount, `scripts/box` imports from `apps` and `packages`, and the 9b question's citations; `git worktree list` and `git branch -r`.

**What the planner only read:** the shell handler, the units, `waitron.sh`, the compose file, the Dockerfile's users, the client, the permission map, and the PR 4 and PR 5 modules, at the lines cited.

**Not measured:** how long a NetworkManager scan or join takes on any box; whether a forwarded B3 exchange fits `RuntimeMaxSec=15`; whether a process in the app container other than the server can reach the socket in practice (it holds the gid, finding 6, so this plan assumes it can).

No test of the code above has run, because none of it exists yet.

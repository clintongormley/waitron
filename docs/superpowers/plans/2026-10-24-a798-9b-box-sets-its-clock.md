# A798-B slice 9b — the box sets its own clock, and watches its time service

> **Revision 1 (2026-10-24).** Planned beside slice 9's revision 4
> ([2026-10-23-a798-9-clock-restart.md](2026-10-23-a798-9-clock-restart.md), whose "Owner FYI
> defaults" list covers this slice too: items 15–17). Design: revision 7, §4.9 c, d, g
> ([design](../specs/2026-10-19-a798-degraded-trading-design.md)). Its own branch and pull request,
> after slice 9 (#2025) lands: `python3 ~/workspace/tools/worktree.py new waitron
> feat/a798-9b-box-sets-clock --headless`. **Parked for the owner** (it changes the clock that dates
> every record). Review path: FULL, two Codex run-it reviews side by side.
>
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Implementers
> are dispatched as `subagent_type: "implementer"`; each task is test-first and well under 100 tool
> calls; one past about 150 stops at a passing or cleanly red point, commits, and hands over.

**Goal:** when AEAT's time, two tills or handhelds that agree with each other, or an administrator's
own device say the box's clock is wrong, the box sets its clock to that time (and its battery
clock), records who or what did it with both readings, and then judges the stop again; the box
reads whether its time service is running and synchronised, and the bell warns when it is not.

**What this slice does not do:** it opens no new stop. The box sets its clock only inside a stop it
already has (slice 8's clock behind the chain, slice 3's clock before 28-10-2024). Checks at start
and after a change are slice 9c.

## What this rests on — and what nobody has measured yet

**Nothing here was run on Linux** (slice 9 plan, revision 4, T4: Docker Desktop could not be started
unattended, no Linux machine was reachable, and the owner's box is off limits). The mechanism rests
on these reads (saved in `~/waitron-campaign-b/a798-9-rev/probe/man/`, fetched 2026-10-24):

- The app container cannot set the clock and must not be given the power to: a default container's
  bounding set lacks `cap_sys_time` (design §12 experiment 6, Docker Desktop), `deploy/compose.yml`
  adds none, and the app runs as the unprivileged `waitron` user (`deploy/Dockerfile`'s runtime
  stage). A time namespace would not help: "time namespaces do not virtualize the CLOCK_REALTIME
  clock" (`time_namespaces(7)`). Giving the whole server `CAP_SYS_TIME` would let any code in it set
  the venue's clock, and it still could not write the battery clock (no `/dev/rtc` in the
  container) nor read the time service's state (no `timedatectl`, no system bus).
- So a service on the HOST does it: `timedatectl set-time` "will also update the RTC time
  accordingly" (`timedatectl(1)`); systemd refuses it while a time service runs ("Automatic time
  synchronization is enabled", `src/timedate/timedated.c:878-879`), so the service is switched off
  around the set and back on after; `@<seconds>` is accepted as a time ("an integer prefixed with
  "@" is evaluated relative to the UNIX epoch", `systemd.time(7)`).
- "Synchronised" is systemd's `NTPSynchronized`: the kernel's maximum error under 16 seconds
  (`timedated.c:572-582`). After a set by hand it should read "no" until the time service syncs
  (an inference, measured in Task 0).
- B3 already plans exactly this place: "one small service on the host … that does for Waitron what
  a container cannot … Waitron reaches it through a socket in a mounted folder; it accepts a fixed
  list of requests and nothing else, and a request that changes the box carries the person and
  permission the server checked" (`docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md`
  §8). This slice builds its first two requests.

**Rejected alternative, for the owner's information:** keep the box's clock and store an offset
that the server adds to its readings. Design §2.5's "one reading stamps everything" breaks: records
would carry the offset clock while the AEAT certificate check (TLS), Litestream, the logs, session
expiry and every `new Date()` outside the clock seat keep the wrong one, so a record and its own
payment could be dated by two clocks. Not built.

## Task 0: measure on Linux first — STOP if any line prints the failing case

Needs a disposable Linux machine with systemd and Docker: a GitHub-hosted `ubuntu-24.04` runner
(a `workflow_dispatch` job the coordinator runs on this branch's draft PR), or a local virtual
machine made for it. **Never Docker Desktop's own machine** (its clock is every container's clock
on this Mac, shared with other sessions) and never the owner's box. Script:
`scripts/host-clock-measure.sh` (committed; prints each line below). Record every printed line in
this plan under "Measured for 9b" before Task 1.

| # | Command (as root unless said) | Expected | The failing case prints |
| --- | --- | --- | --- |
| M1 | which time service `timedatectl show -p NTP -p NTPSynchronized` and `systemctl is-active systemd-timesyncd chronyd chrony` report | `NTP=yes`; one active unit | no time service: the helper must report `none` |
| M2 | `timedatectl set-time @$(( $(date +%s) + 120 ))` with the service on | `Failed to set time: Automatic time synchronization is enabled` | the clock moved: the helper's set-ntp toggle is not needed |
| M3 | `set-ntp false`; `set-time @now+120`; print `date +%s`, `/proc/uptime`, `timedatectl show -p RTCTimeUSec`, `NTPSynchronized` | wall +120 s ± 2; uptime moved only by the elapsed seconds; RTC +120 s; `NTPSynchronized=no` | RTC unchanged (the battery clock would undo a set at the next power cut); uptime +120 s (the jump detector of 9c would be blind) |
| M4 | `set-ntp true`, wait up to 120 s polling `date` | the clock steps back to network time | the clock stays 120 s ahead: the service does not have the last word |
| M5 | from a container (`--user 10001:10001`, no added capability, `/run/waitron-box` bind-mounted) send `clock-status` and `clock-set` to the socket | a JSON status; the set applied on the host | `EACCES` on the socket: the socket's group or mode is wrong |
| M6 | the same container WITHOUT the bind | the client answers "unavailable" within 2 s | a hang |
| M7 | on Docker Desktop (macOS), `docker compose -f deploy/compose.yml up -d app` with the new bind, then `docker compose down` | the app starts; its status probe says "unavailable" | the container refuses to start (`mounts denied`): the bind must be made optional |

If M2–M6 print their failing case, STOP and report to the coordinator: the mechanism needs a new
decision. If only M7 fails, make the bind optional for development (a second compose file the box
uses), say so, and go on.

## Decisions

1. **The host service** is `waitron-box`: a socket unit `waitron-box.socket`
   (`ListenStream=/run/waitron-box/box.sock`, `Accept=yes`, `SocketMode=0660`, group the app's gid
   10001 — by number if M5 shows systemd accepts it, else a `waitron-box` host group made with that
   gid) and a template service `waitron-box@.service` running `/usr/local/lib/waitron/waitron-box.sh`
   as root with standard input and output on the connection. One request line in, one JSON line out,
   a 15 s limit (`RuntimeMaxSec`).
2. **`clock-status`** answers `{ "service": "active" | "inactive" | "none", "ntp": bool,
   "synchronised": bool, "lastSyncAt": ms | null, "nowMs": ms }` (`lastSyncAt` the mtime of
   `/run/systemd/timesync/synchronized`, which "is touched on each successful synchronization",
   `systemd-timesyncd.service(8)`; null without it).
3. **`clock-set <epochMs> <requester>`** refuses (`{ "ok": false, "reason": … }`): a target that is
   not digits (`invalid`), before 2024-10-28T00:00:00Z or after 2100-01-01 (`out_of_range`), while
   `NTPSynchronized=yes` (`synchronised`), and a requester that is not one line of JSON under 512
   bytes (`invalid`). Otherwise: remember whether NTP was on; `set-ntp false`; `set-time
   @<seconds>`; `set-ntp true` if it was on (also when the set failed, by a `trap`); answer
   `{ "ok": true, "beforeMs", "afterMs" }`; write one journal line naming the requester (source,
   person id, the confirmation's reason). Whole seconds: the error is under a second, inside the
   one-minute margin.
4. **Installed by `deploy/waitron.sh install`** (root, as the time-sync step slice 10 added), files
   from `deploy/host/`; a host without systemd prints a line that the box cannot set its own clock,
   and install carries on. B3's image installs the same files (a dated pointer in B3's design §8).
5. **The app container mounts `/run/waitron-box`** (the directory, so a re-created socket is seen).
6. **The server's client** (`apps/server/src/host-box.ts`): `clockStatus()` (2 s) and
   `setClock(targetMs, requester)` (15 s); a missing socket, a refused connection or a timeout answer
   `{ available: false }`, never a throw. Path from `WAITRON_HOST_SOCKET`, default
   `/run/waitron-box/box.sock` (an empty value means the default, CLAUDE.md §3).
7. **The time service is watched**: the Box status Clock row's sync line reads `clockStatus()`
   instead of an in-container `timedatectl` (`checkTimeHealth`), and an ongoing server alert
   `clock.sync_off` (warning, area `box`, `system.manage`, `screen: "box-status"`, params
   `{ reason: "off" | "stopped" | "unsynchronised" | "unreachable" }`) is raised when the service is
   off, not running or not synchronised; `unreachable` only when `WAITRON_ENV` is `production`
   (FYI 17). Read at most once a minute (cached), like today's probe.
8. **When the box sets its clock** (`apps/server/src/clock-correction.ts`, the server's; the module
   stays a database rule): during a stop (behind the chain, or before 28-10-2024) —
   - AEAT disagrees (outside the minute, after uncertainty) → target AEAT's time projected to now by
     the steady clock;
   - otherwise, with no AEAT witness, a group of two or more devices (none on the box) that agree
     with each other disagrees with the box → target their mean, projected;
   - otherwise an administrator's device that differs, on their Confirm → target the device's time;
   - never while `clockStatus().synchronised` (devices get `clock.disagrees`; the administrator is
     refused `synchronised`); never when the status is unavailable (the administrator is refused
     `unavailable`).
   Then: verify `|Date.now() − (target + elapsed)| ≤ 2 000`, else `set_failed`; tell the clock watch
   to take its next reading as a new start (so its own set is not a "jump" disproof); and in one
   transaction write the confirmation: `box_clock_at` the reading before, `confirmed_at` the reading
   after, `step_ms`, the source, the person for `admin`, `reason` `behind_chain` or `unusable`, and
   `registro_id`/`record_at` only if the clock still reads more than a minute behind the latest
   record. The row is written even when the set alone ended the stop (the owner: record who, when
   and both readings). Wrongly dated records as slice 9 (R4) — a clock set back below records stamped
   ahead lists them.
9. **The seat**: `confirmClockStop` gains `step: { beforeMs, afterMs } | null` and writes the row
   with no stop left when a step was applied; the `differs` refusal is gone for an administrator
   (it becomes "Use your phone's time?").
10. **A clock before 28-10-2024** may be set from devices or an administrator; AEAT is not reachable
    then (its certificate cannot be checked, design §2.5). The clock watch runs during that stop too.

## Behaviour this slice changes

The box's clock can now be set by the box itself; the Clock row shows the time service's real state;
a new bell warning; the administrator's dialog offers to use their device's time; the clock-stop
and minimum-date words no longer send the operator to a terminal.

## Global constraints

As slice 9 revision 4's: the fiscal core untouched and checked after each task in
`packages/fiscal-verifactu`; **no migration** (`git diff main --name-only -- '*/drizzle/*'
packages/migrations` prints nothing — slice 9 created every column this needs); no device or AEAT
time stamped on a record (the box's clock, once set, stamps it); English only outside translation
files; tests never contact AEAT and never set a real clock (the host script is tested under stubs,
as `scripts/waitron-sh.test.mjs` tests `waitron.sh`).

## Tasks

### Task 0: Measure (above). Commit the script and the receipts.

### Task 1: The host script, under stubs

**Files:** create `deploy/host/waitron-box.sh`, `scripts/waitron-box.test.mjs` (stub `timedatectl`,
`systemctl`, `date` on `PATH`, each logging its arguments; the request on standard input).
- [ ] **Failing tests**: `clock-status` with the stubs answering each state → the JSON of decision
  2; `clock-set` refusals (`abc`, `1`, a 2101 target, synchronised, a requester of 600 bytes) → each
  reason and no `set-time` call; a good set → `set-ntp false`, `set-time @<s>`, `set-ntp true` in that
  order; a failing `set-time` → `set-ntp true` still called and `ok: false`; NTP off before → no
  `set-ntp true`. Run `pnpm exec vitest run scripts/waitron-box.test.mjs` → fails (no script).
- [ ] **Implement**; run → PASS; `shellcheck` if installed. Commit.

### Task 2: Installing it, and the container's mount

**Files:** `deploy/host/waitron-box.socket`, `deploy/host/waitron-box@.service`, `deploy/waitron.sh`
(install writes them, `daemon-reload`, `enable --now waitron-box.socket`, one line either way),
`deploy/compose.yml` (the bind), `deploy/README.md` (the paragraph about time sync gains the host
service), `scripts/waitron-sh.test.mjs`, `scripts/deploy-image-env.test.ts`.
- [ ] **Failing tests**: under stubs, install writes the three files with the measured socket group
  and enables the socket; a host with no `systemctl` prints the line and carries on; the compose
  text binds `/run/waitron-box` into `app` only (not the print agent). Commands:
  `pnpm exec vitest run scripts/waitron-sh.test.mjs scripts/deploy-image-env.test.ts`.
- [ ] Implement; PASS; `pnpm exec prettier --check deploy/compose.yml`. Commit.

### Task 3: The server's client

**Files:** `apps/server/src/host-box.ts`, `apps/server/src/host-box.test.ts` (a real Unix socket
server in a temp directory answering canned lines).
- [ ] **Failing tests**: status parsed; a malformed line → unavailable; no socket → unavailable in
  under 2 s; a server that never answers → unavailable at the limit; `setClock` sends one line with
  the digits and the requester JSON; an empty `WAITRON_HOST_SOCKET` → the default path.
  `pnpm --filter @waitron/server exec vitest run src/host-box.test.ts`. Implement; commit.

### Task 4: The time service on the Box status page, and `clock.sync_off`

**Files:** `apps/server/src/time-health.ts` (`checkTimeHealth` reads `clockStatus()`; the type keeps
`source`), `apps/server/src/box-status.ts`, `apps/server/src/boot.ts`, create
`apps/server/src/clock-sync-alert.ts` (+ test), `apps/server/src/errors.ts`,
`apps/dashboard/src/i18n/alert-messages.ts`, `apps/dashboard/src/screens/box-status-rows.ts`,
strings; `scripts/ongoing-alert-codes.test.ts` gains the source file (a hand-kept list gaining one
entry: declared, its own commit).
- [ ] **Failing tests**: each status → the alert or none; `unreachable` only in production; the row's
  words for each state with the last sync time. Words: EN "The box's time service is {reason:clock_sync_reason}.
  If its clock goes wrong it will not be corrected by itself. Check the box's network, or ask whoever
  installed it." / ES the same in Spanish; reasons "switched off", "not running", "not synchronised",
  "not answering". Commands: `pnpm --filter @waitron/server exec vitest run src/clock-sync-alert.test.ts
  src/time-health.test.ts src/box-status.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run
  src/screens/box-status-rows.test.ts src/i18n/alerts.test.ts`; `pnpm exec vitest run
  scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts`. Commit.

### Task 5: The box corrects its clock on AEAT's time or two agreeing devices

**Files:** create `apps/server/src/clock-correction.ts` (+ test); modify `apps/server/src/clock-watch.ts`
(calls it before confirming; restarts its jump reference after a set; runs during the before-2024
stop too), `packages/fiscal-verifactu/src/clock-confirmation.ts` and its test (decision 9),
`packages/fiscal/src/backend.ts`.
- [ ] **Failing tests** (injected host client, wall and steady clocks):
  1. AEAT 2 h ahead of the box, status unsynchronised → one `setClock` to AEAT's time projected, the
     row `step_ms ≈ 7 200 000`, `box_clock_at` before, `confirmed_at` after, `source "authority"`;
     a sale afterwards carries the corrected time;
  2. the same with status synchronised → no set, no row, `clock.disagrees` raised;
  3. two LAN devices agreeing 400 days ahead, no AEAT → set to their mean; one of them on the box →
     no set (the owner's rule, through slice 9's on-box check);
  4. the host answering `set_failed`, or the wall clock not moving (verify fails) → no row, a
     `clock_watch.correction_failed` log line, the stop on;
  5. after a set the clock watch records no `clock.behind_chain_disproved` for its own step (the
     built watch would read +2 h as a jump);
  6. a set that ends the stop (records not ahead any more) still writes the row, `registro_id` null;
  7. the clock set back below a record stamped ahead → that record listed (slice 9's R4).
  Commands: `pnpm --filter @waitron/server exec vitest run src/clock-correction.test.ts
  src/clock-watch.test.ts`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/clock-confirmation.test.ts inmutabilidad src/write-path.e2e.test.ts`. Proofs by deletion: the
  synchronised refusal (case 2 sets); the re-anchor (case 5 records a disproof). Commit.

### Task 6: "Use your phone's time?"

**Files:** `apps/server/src/box-health-api.ts` (the confirm route sets when the device differs:
refusals `synchronised`, `unavailable`, `set_failed`; `differs` deleted),
`apps/server/src/clock-confirm.route.test.ts`, `apps/dashboard/src/screens/box-status-screen.ts`,
strings, `box-status-screen.test.ts`, `box-status-screen.a11y.test.ts`.
- [ ] **Failing tests**: a device 400 days ahead, unsynchronised → 200, the clock set, the row
  `source "admin"` with the person and both readings; synchronised → `synchronised`, nothing set;
  no host service → `unavailable`; **from the box itself → still `same_machine`, nothing set** (the
  owner's refusal, kept by this slice). The dialog: "The box's clock says {box}. Your device says
  {device}. Use your device's time?" / "La hora del equipo es {box}. Tu dispositivo marca {device}.
  ¿Usar la hora de tu dispositivo?", buttons Cancel and "Use this time" / "Usar esta hora"; the
  refusal words. Axe in both themes. Commit.

### Task 7: The words that sent the operator to a terminal

`apps/dashboard/src/i18n/strings.ts` (`box_status.clock…` about `:3260`, `:6606`),
`alert-messages.ts` (`clock.unusable`), `apps/server/src/i18n/box-emails.ts` (`clock.unusable`,
`clock.behind_chain`): "connect the box to the internet … or call whoever installed it" becomes
"connect the box to the internet, switch on two tills, or have an administrator confirm the time
with their own phone on the Box status page". Tests that pin those sentences change with them:
list each in a `Changed test checks (A798 slice 9b):` commit. Guides: `{#clock-behind}` and the
minimum-date paragraph in `apps/server/src/guide/en|es/box-status.md`; `till-notices.md`. Run
`src/guide-content.test.ts`, `scripts/guide-links.test.ts`. Commit.

### Task 8: Docs

CLAUDE.md §5 (the clock-stop rule: "the box sets its clock only through the host service, from
AEAT's time, two agreeing devices off the box or an administrator's device off the box, never while
its time service reports itself synchronised"; guard names, weaker than their names);
`docs/developers/conventions-data.md` (the receipt: Task 0's lines);
`docs/compliance/asesor-questions.md` — **Q54, a clock set from a till's or an administrator's
device**: whether a SIF may correct its own clock from a device's clock when it has no internet,
and whether that should be recorded anywhere beyond our own table; the backlog (A798-B: 9b landed;
open: the host service grows into B3's `waitron-box`; the battery clock on the chosen box model is
B3 slice 6's); B3 design §8 and §10 dated pointers ("Hora" is no longer read-only in effect: the box
sets it from a confirmed source, still never from a typed time). Commit.

### Task 9: LOOK (English, then Spanish)

The Clock row in each time-service state; the bell on `clock.sync_off`; the dialog offering the
device's time, and refused for `synchronised`, `unavailable` and on the box. Light and dark, 1280 and
390.

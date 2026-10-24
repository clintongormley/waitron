# A798-B slice 9b — the box sets its own clock, and watches its time service (OUTLINE)

> **An outline, not a plan to dispatch** (round 1, I9). When slice 9b is taken, this file becomes a
> full plan — tasks sized for one implementer each, exact files and focused commands, its "Changed
> test checks" — and gets its own fresh-context plan review against the spec before its first
> dispatch. What it fixes now: the scope, the decisions the split depends on, the measurements that
> must come first, and the risks round 1 found. Design: revision 7, §4.9 c, d, g, h
> ([design](../specs/2026-10-19-a798-degraded-trading-design.md)). Slice 9's plan
> ([2026-10-23-a798-9-clock-restart.md](2026-10-23-a798-9-clock-restart.md), revision 5) is its
> base. Its own branch and pull request after slice 9 (#2025) lands: `python3
> ~/workspace/tools/worktree.py new waitron feat/a798-9b-box-sets-clock --headless`. **Parked for the
> owner** (it changes the clock that dates every record). Review path: FULL, two Codex run-it
> reviews side by side.

**Goal.** When AEAT's time, two tills or handhelds that agree with each other (from two addresses,
none on the box), or an administrator's own device say the box's clock is wrong, the box sets its
clock (and its battery clock) to that time, records who or what did it with both readings, alerts
and emails the managers, and judges the stop again. The box reads whether its time service runs and
is synchronised; the bell warns when it does not. It opens no new stop: it sets the clock only inside
a stop it already has (slice 8's clock behind the chain, slice 3's clock before 28-10-2024). Slice
9c adds the checks at start and after a change.

## Owner FYI defaults for 9b

1. **The host service is the first request of B3's planned `waitron-box` service**, installed by
   `waitron.sh install`; the app's container gets no clock capability.
2. **While the time service reports itself synchronised, the box never sets its clock from devices or
   an administrator** — they can only agree with it. An internet time server is a better source than
   two tablets, and the two would undo each other.
3. **Every clock change the box makes raises a bell alert and an email to managers**: the source,
   the person for an administrator, the reading before and after, and the step (round 1, I3).
4. **A device's or administrator's time is self-reported** (slice 9's FYI 12): from this slice it
   can SET the clock. A scripted request from two enrolled devices at two addresses, or from a
   signed-in administrator off the box, can set any time between 2024-10-28 and 2100. "Only inside
   a stop the box already has" stops being a limit once slice 9c lands: unplugging the box's
   internet and restarting it opens a start check at will, with the time service unsynchronised, so
   two devices can then set the clock with no person involved (round 3, M1). What limits it:
   enrolment and sign-in, two addresses, never while synchronised, the alert and email on every
   change, the append-only record with its proof, and the wrongly dated list. The asesor question
   below names this window.
5. **`clock.sync_off` is a warning in the bell only, no email.** A production box whose host service
   does not answer raises it too (`unreachable`); elsewhere (a laptop) it stays silent, as today.

## Owner question, to ask when 9b is planned (round 3, M1; the runner's ruling)

Round 1's I3 (d) would have refused any set, from devices or an administrator, that moves the clock
back past the latest sale without AEAT; that leaves a clock that is AHEAD no way back offline, so it
was not adopted. A narrower version keeps a way out and closes the backdating path that needs no
person: **devices alone may not set the clock back past the last sale; an administrator may.** It
runs against the owner's 04:24 answer ("two tills … no admin needed"), so it is the owner's to
decide. Worked example for the question: the box's clock reads 24 Oct 21:00 after someone set it a
day ahead by mistake; the last sale reads 24 Oct 20:55; two tills say 23 Oct 21:00. Under the
narrower rule the tills do not set it back; an administrator confirming their phone's time does.
The cost of the narrower rule: once slice 9c stops selling while a check waits, a box whose two
tills would have set its clock back stays stopped until an administrator confirms — with no
administrator there, payments stay stopped, where under the 04:24 answer the tills would have set
the clock and selling would have gone on (round 4, M11).

## What it rests on — and what nobody has measured yet

Nothing here was run on Linux (slice 9 plan, T4). The reads, saved in
`~/waitron-campaign-b/a798-9-rev/probe/man/` (2026-10-24):
- The container cannot set the clock: a default container's bounding set lacks `cap_sys_time`
  (design §12 experiment 6, Docker Desktop); `compose.yml` adds none; the app runs as uid 10001. A
  time namespace would not help: "time namespaces do not virtualize the CLOCK_REALTIME clock"
  (`time_namespaces(7)`). No `/dev/rtc` is mounted into `app` (read: no `devices:`, no `/dev` bind;
  not run). Whether a service is enabled and running needs the host (no `timedatectl`, no system bus
  in the container, read); the "synchronised" half alone is the read-only `adjtimex` call an
  unprivileged process may make (general knowledge, not run).
- `timedatectl set-time` "will also update the RTC time accordingly" (`timedatectl(1)`); it takes
  `@<seconds>` (`systemd.time(7)`, and `timedatectl.c`'s `parse_timestamp`, claim check T18).
- systemd refuses `set-time` while a time service **listed in `ntp-units.d`** (or in
  `$SYSTEMD_TIMEDATED_NTP_SERVICES`) is active ("Automatic time synchronization is enabled",
  `timedated.c:878-879`, systemd main), and `set-ntp false` "disables and stops the known network
  synchronization services" — only those listed. A chrony or ntpd with no list entry is invisible to
  both (claim check W1): the measurement prints the list.
- `NTPSynchronized` on systemd main is the kernel's maximum error under 16 s (`timedated.c:572-582`);
  the box's systemd version was not read.
- `systemd-timesyncd.service(8)`: `/var/lib/systemd/timesync/clock` is "updated on each successful
  NTP synchronization or after each SaveIntervalSec= time interval" and its time is used to advance
  the clock at boot — so after a backward set, a power cut before the next save can bring the clock
  back AHEAD (claim check U3). The set must reset that file, measured below (M8).
- B3 plans the place: "one small service on the host … Waitron reaches it through a socket in a
  mounted folder; it accepts a fixed list of requests and nothing else, and a request that changes
  the box carries the person and permission the server checked" (B3 design §8).

**Rejected alternative:** keep the box's clock and add an offset to the server's readings. Design
§2.5's "one reading stamps everything" breaks: records would carry the offset clock while TLS,
Litestream, logs, sessions and every `new Date()` outside the clock seat keep the wrong one.

## The first task: measure on Linux — STOP if any line prints its failing case

**Where it runs** (round 1, I6): a GitHub Actions job on the 9b branch triggered by `pull_request`
and limited by `paths:` to `scripts/host-clock-measure.sh` and its workflow file, on a GitHub-hosted
`ubuntu-24.04` runner (a disposable machine with systemd and Docker). A `workflow_dispatch`-only file
cannot run from a feature branch: GitHub shows its button "if the workflow file exists on the default
branch", and dispatching to another branch needs it to have "run at least once" (round 1, experiment
6). The new workflow passes `pnpm exec vitest run scripts/ci-workflow.test.mjs`: `timeout-minutes`
on its job, the three-step bounded checkout, `scripts/ci-setup-pnpm.sh` if it needs pnpm, and an
outer `timeout` on any apt step. **Who runs it:** implementers do not push; the lane's coordinator
opens the 9b draft pull request early so the job runs, and copies its log into the plan. M7 alone
runs locally on Docker Desktop (it sets no clock). **Never** set a clock on Docker Desktop's own
machine (every container on this Mac shares it) or on the owner's box. The job's last step puts the
runner's time service back on. Record every printed line under "Measured for 9b" before any other
task.

| # | What the script runs (as root unless said) | Expected | The failing case prints, and what it means |
| --- | --- | --- | --- |
| M1 | `timedatectl show -p NTP -p NTPSynchronized`; `ls /usr/lib/systemd/ntp-units.d /etc/systemd/ntp-units.d`; `systemctl is-active systemd-timesyncd chronyd chrony ntp` | `NTP=yes`; one active unit, and it is listed | an active unit not listed: `set-ntp` cannot switch it off, so the helper must stop it itself |
| M2 | `timedatectl set-time @$(( $(date +%s) + 120 ))` with the service on | `Failed to set time: Automatic time synchronization is enabled` | the clock moved: the set-ntp toggle is not needed (and a running service may undo the set) |
| M3 | `set-ntp false`; `set-time @now+120`; print `date +%s`, `/proc/uptime`, `/proc/sys/kernel/random/boot_id`, `timedatectl show -p RTCTimeUSec -p NTPSynchronized` before and after | wall +120 s ± 2; uptime moved only by the elapsed seconds; boot id unchanged; RTC +120 s; `NTPSynchronized=no` | RTC unchanged (a power cut would undo the set); uptime +120 s (9c's change detector and slice 9's corrected stop start would be blind) |
| M4 | `set-ntp true`; poll `date` for up to 120 s | the clock steps back to network time | it stays 120 s ahead: the time server does not have the last word |
| M5 | from a container (`--user 10001:10001`, no added capability, `/run/waitron-box` bind-mounted) send `clock-status` and `clock-set` to the socket; read `/proc/sys/kernel/random/boot_id` there too | a JSON status; the set applied on the host; the host's boot id | `EACCES` on the socket (its group or mode is wrong); a different boot id (slice 9's fallback would always apply) |
| M6 | the same container without the bind | the client answers "unavailable" within 2 s | a hang |
| M7 | locally on Docker Desktop: `docker compose -f deploy/compose.yml up -d app` with the new bind, then `down` | the app starts; its status probe says "unavailable" | `mounts denied`: the bind goes in a second compose file the box uses |
| M8 | after a backward set of 120 s: the mtime of `/var/lib/systemd/timesync/clock` | not later than the new time (the helper touches it) | later than the new time: at the next boot timesyncd would advance the clock to it — back ahead |
| M9 | `systemd-analyze verify` of the socket with a numeric `SocketGroup=10001`, and an instance under `RuntimeMaxSec=15` | accepted; an instance killed at 15 s | refused: use a named host group with gid 10001 |

If M2–M6, M8 or M9 print their failing case, STOP and report: the mechanism needs a new decision.
If only M7 fails, make the bind optional for development, say so, and go on.

## Decisions the full plan builds from

1. **The host service** `waitron-box`: a socket unit (`/run/waitron-box/box.sock`, `Accept=yes`,
   `SocketMode=0660`, group the app's gid 10001 per M9) and a template service running
   `/usr/local/lib/waitron/waitron-box.sh` as root, one request line in, one JSON line out, 15 s at
   most. Installed by `deploy/waitron.sh install` (a host without systemd prints a line and install
   carries on); B3's image installs the same files. The app container mounts `/run/waitron-box` (the
   directory, so a re-created socket is seen).
2. **`clock-status`** answers `{ service, ntp, synchronised, lastSyncAt, nowMs }` (`lastSyncAt` the
   mtime of `/run/systemd/timesync/synchronized`, "touched on each successful synchronization",
   `systemd-timesyncd.service(8)`).
3. **`clock-set <epochMs> <requester>`** refuses a target that is not digits, before 2024-10-28 or
   after 2100, while synchronised, or with a requester that is not one short line of JSON; otherwise
   switches the listed service off, sets, touches the saved-clock file (M8), switches the service back
   on (also after a failed set), and answers before and after; one journal line names the requester.
4. **The server's client** (`apps/server/src/host-box.ts`): `clockStatus()` (2 s) and `setClock()`
   (15 s); a missing socket, a refusal or a timeout answer `{ available: false }`, never a throw.
5. **The time service is watched**: the Clock row and `clock.sync_off` (warning, `box`,
   `system.manage`, reasons `off`, `stopped`, `unsynchronised`, `unreachable`) read `clockStatus()`.
   Today only `/api/box/health` caches the probe (60 s, `boot.ts`); `/api/box/status` runs it on
   every request (`box-status.ts:127`, claim check W11) — the plan caches both. `checkTimeHealth`'s
   behaviour changes, so `apps/server/src/time-health.test.ts` (on `main`) goes in the plan's
   "Changed test checks". The guard suites include `scripts/errors-reachable.test.ts`.
6. **When the box sets its clock** (a server module, `clock-correction.ts`): during a stop — AEAT
   disagreeing → AEAT's time; else a group of devices from two addresses, none on the box,
   disagreeing → their mean; else an administrator's device that differs, on their Confirm ("Use your
   device's time?"). Never while synchronised; never when the host service is unavailable. Order
   (round 1, M7): tell the clock watch and 9c's guard that a set is coming, ask the host, verify
   `|now − (target + elapsed)| ≤ 2 000`, re-anchor, then write the confirmation with `box_clock_at`,
   `confirmed_at`, `step_ms`, and record the alert (decision 3 of the FYI) — tested in that order.
7. **Every job that reads the wall clock** is listed and made safe for a step of days, or accepted
   with a reason (round 1, I5): backups pruned by the age in their names (`apps/server/src/backup-sweep.ts`
   `pruneBackend`, `:232-257`: after a recorded step, no age-based pruning of backups named before the
   step — tested with a +400-day and a −400-day set, slice 9's T6 shows today's behaviour); the
   stream's generation pruning (`PRUNE_WINDOW_MS`, `packages/stream/src/supervisor.ts:145`); session
   expiry (the confirming administrator's own session); certificate reminders; scheduled day closes;
   and whatever a grep for `Date.now()` and `new Date()` in scheduled duties finds.
8. **A clock before 28-10-2024** may be set from devices or an administrator; AEAT is not reachable
   then (its certificate cannot be checked; the production QR host's certificate starts 2025-11-17,
   claim check T27). The clock watch runs during that stop too.

## The measurement workflow does not land (round 3, M11)

The `pull_request` workflow that runs the measurement sets the runner's clock, which has no place
in `main`'s CI. Its last commit on the 9b branch removes it, keeping `scripts/host-clock-measure.sh`
and copying the job's log into the plan under "Measured for 9b"; the pull request's description
says so.

## Review notes for the full plan

Codex seat 2 adds: forged matching headers from two device cookies at two addresses (expected: the
clock is set, with an alert and an email — FYI 4); an administrator's `deviceAt` sent by `curl`; a
set racing the clock watch; the host service killed mid-set (the time service must come back on).
Asesor: a new question at the next free number on `main` at build time — whether a SIF may correct
its own clock from a device's clock when it has no internet, and what it should record; its text
names FYI 4's residual risk.

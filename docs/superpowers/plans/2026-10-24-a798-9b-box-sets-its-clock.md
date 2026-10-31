# A798-B slice 9b — the box sets its own clock, and watches its time service (BUILD PLAN)

> **Revision 1 of the full plan (2026-10-31).** Written from the outline of 2026-10-24 when slice
> 9b was taken; the outline's owner FYI defaults, owner question, rejected alternative,
> measurement table, decisions and review notes are folded in below, each corrected where the
> tree on `main` `65bc0441a` contradicts it (listed under "Where the outline was wrong on this
> tree"). It gets its own fresh-context plan review against the spec before the first task.
> Design: revision 7, §4.9 c, d, g, h, with §2.5, §8 item 9b and §12
> ([design](../specs/2026-10-19-a798-degraded-trading-design.md)). Base: slice 9
> ([plan](2026-10-23-a798-9-clock-restart.md), landed as #2025); seams left for slice 9c
> ([outline](2026-10-24-a798-9c-clock-check-at-start-and-change.md)).
>
> **Branch and worktree:** `python3 ~/workspace/tools/worktree.py new waitron
> feat/a798-9b-box-sets-clock --headless`. **Build method: inline** — the lane's lead writes every
> task's test and code itself, test first. **Review path: FULL** (it changes the clock that dates
> every fiscal record): a per-task review after each task, then `/finish-branch` with TWO Codex
> run-it reviews side by side, the second told to set the checklist aside (Review notes, below).
> **The finished pull request is parked `needs-owner-review`; the lane never lands it.**

**Goal.** When AEAT's time, two tills or handhelds that agree with each other (from two addresses,
none on the box), or an administrator's own device say the box's clock is wrong, the box sets its
clock (and its battery clock) to that time, records who or what did it with both readings, alerts
and emails the managers, and judges the stop again. The box reads whether its time service runs and
is synchronised; the bell warns when it does not. It opens no new stop: it sets the clock only
inside a stop it already has — slice 8's clock behind the latest record, and the clock before
28-10-2024 (`clock.unusable`). Slice 9c adds the checks at start and after a change.

## The pull request, task by task

Run in this order. A STOP stops the build there and the lead reports to the coordinator.

1. **Measure the mechanism on a GitHub Linux runner** — `scripts/host-clock-measure.sh`,
   `.github/workflows/host-clock-measure.yml`. STOP if M2–M6, M8 or M9 print the failing case.
2. **The host's request handler and its systemd units** — `deploy/box/waitron-box.sh`,
   `waitron-box.socket`, `waitron-box@.service`; `scripts/waitron-box-sh.test.mjs`.
3. **`waitron.sh install` installs it; the bind is optional** — `deploy/waitron.sh`,
   `deploy/compose.yml`, `scripts/waitron-sh.test.mjs`, `scripts/deploy-image-env.test.ts`.
4. **Measure the shipped files on the runner** (M5′, M7′, M8′, M9′) — the Task 1 workflow,
   re-run. STOP as Task 1.
5. **The server's client for the host** — `apps/server/src/box-host-client.ts`.
6. **Time health read from the host, cached on both reads** — `time-health.ts`, `box-status.ts`,
   `boot.ts`.
7. **`clock.sync_off` in the bell** — `apps/server/src/clock-sync-alert.ts`.
8. **The seat records a step of the clock** — `packages/fiscal-verifactu/src/clock-step.ts`,
   `clock-stop-incidents.ts`. STOP if the fiscal core would have to change.
9. **`clock.corrected`'s words, bell and email** — `alert-messages.ts`, `box-alert-email.ts`,
   `i18n/box-emails.ts`.
10. **Setting the clock: the order, one at a time, verified** —
    `apps/server/src/clock-correction.ts`.
11. **The watch sets it during a stop** — `clock-watch.ts`, `boot.ts`.
12. **An administrator's "Use your device's time?"** — `box-health-api.ts`
    (`POST /api/box/clock-set`).
13. **The dashboard's dialog and refusals** — `box-status-screen.ts`, `api/client.ts`, `i18n/*`.
14. **Backups pruned safely across a step** — `backup-sweep.ts`.
15. **The other wall-clock jobs, and the audit table** — `supervisor.ts`, `management-session.ts`,
    `passkey.ts`. STOP if a job that deletes data or keeps a credential alive is left unfixed.
16. **Guides, English and Spanish** — `apps/server/src/guide/{en,es}/box-status.md`.
17. **LOOK, without the dev stack** — browser-test screenshots.
18. **Developer docs, the asesor question, the deploy README** — `conventions-data.md`,
    `asesor-questions.md`, `deploy/README.md`, `CLAUDE.md`.
19. **The measurement workflow goes; the backlog** — delete the workflow; `docs/backlog.md`,
    `docs/backlog/box.md`.

Each task: failing test first, watch it fail for the stated reason, minimal code, run again, the
task's guards, commit with `git commit -s` and a plain-English message, explicit paths only (never
`git add -A`). A deletion control (remove the check, see the named test fail, restore) for every new
guard and refusal. Every task is sized to finish in well under 100 tool calls; one that passes
about 150 stops at a passing or cleanly red point, commits, and writes a handover (done, left,
files, each check's state) into the ledger before going on.

## Owner FYI defaults for 9b (from the outline; unchanged unless marked)

1. **The host service is the first request of B3's planned `waitron-box` service**, installed by
   `waitron.sh install`; the app's container gets no clock capability. *(Names follow B3's plan of
   2026-10-26 where it names them; see "Where the outline was wrong", item 3.)*
2. **While the time service reports itself synchronised, the box never sets its clock from AEAT,
   devices or an administrator** — they can only agree with it. An internet time server is a
   better source than two tablets, and the two would undo each other. *(The outline said "devices
   or an administrator"; design §4.9 h.1 says AEAT cannot set it then either, and the plan follows
   the design.)*
3. **Every clock change the box makes raises a bell alert and an email to managers**: the source,
   the person for an administrator, the reading before and after, and the step (round 1, I3).
   Recorded as `clock.corrected` (warning, area `box`, `system.manage`). A second change while the
   first's alert is open marks the first handled by the system and records its own, so each
   change has its own alert and its own email (decision 9).
4. **A device's or administrator's time is self-reported** (slice 9's FYI 12): from this slice it
   can SET the clock. A scripted request from two enrolled devices at two addresses, or from a
   signed-in administrator off the box, can set any time between 2024-10-28 and 2100. "Only inside
   a stop the box already has" stops being a limit once slice 9c lands: unplugging the box's
   internet and restarting it opens a start check at will, with the time service unsynchronised, so
   two devices can then set the clock with no person involved (round 3, M1). What limits it:
   enrolment and sign-in, two addresses, never while synchronised, the alert and email on every
   change, the append-only record with its proof, and the wrongly dated list. The asesor question
   (Task 18) names this window.
5. **`clock.sync_off` is a warning in the bell only, no email.** A production box whose host service
   does not answer raises it too (`unreachable`); elsewhere (a laptop, a preproduction box) it stays
   silent, as today.
6. **New, for the plan review:** after a step of more than half an hour forward, or more than a
   minute back, every dashboard session — the confirming administrator's included — must sign in
   again (decision 11). A backward step would otherwise keep every open session alive for as long
   as the step.

## Owner question — text for questions.md

The lead appends this to `~/waitron-campaign-b/questions.md` when the plan review is folded, and the
build goes on with the owner's standing answer (2026-10-24 04:24, "two tills … no admin needed")
built as the default. The narrower rule is one constant and one test expectation (Task 10,
`DEVICES_MAY_SET_BACK_PAST_LAST_SALE`), so either answer is a few lines.

> **A798-B slice 9b — may two tills set the box's clock back to before the last sale, or only an
> administrator?** (1 of 1)
>
> From slice 9b, when the box's clock is wrong it can set its own clock: from the tax agency's
> time, from two tills or handhelds that agree with each other, or from an administrator's phone.
> On 24 October (04:24) you said two tills may do it with no administrator needed, and that is what
> is being built.
>
> There is one narrower version to choose instead: **two tills alone may not set the clock back to
> a time before the last sale; an administrator may.** Example: the box's clock reads 24 Oct 21:00
> because someone set it a day ahead by mistake; the last sale reads 24 Oct 20:55; two tills say 23
> Oct 21:00.
> - As built now: the tills set the box's clock to 23 Oct 21:00 and selling goes on.
> - Narrower: the tills do not; an administrator confirming their phone's time does.
>
> Why ask: a till's time is whatever its browser sends, so a scripted request from two enrolled
> tills could move the clock back past the last sale with nobody present, and the box would then
> date new sales before older ones. Every change is alerted, emailed and kept with its proof either
> way. The cost of the narrower rule: once slice 9c stops selling while a check waits, a box whose
> two tills would have set its clock back stays stopped until an administrator confirms — with no
> administrator there, payments stay stopped, where under your 04:24 answer the tills would have set
> the clock and selling would have gone on (round 4, M11). Until slice 9c lands, the example only
> arises during a stop the box already has.
>
> - **Keep the 04:24 answer** (recommended: it is what you chose, and nothing is lost that the
>   alert and the list do not show)
> - **The narrower rule**: tills may set the clock forward, never back past the last sale
> - Stop here — I'll write

## What it rests on

The reads the outline saved in `~/waitron-campaign-b/a798-9-rev/probe/man/` (2026-10-24), not
re-read for this revision:
- The container cannot set the clock: a default container's bounding set lacks `cap_sys_time`
  (design §12 experiment 6, Docker Desktop); `deploy/compose.yml` adds none (read: `:9-73`); the app
  runs as uid and gid 10001 (`deploy/Dockerfile:185-186`, `USER waitron` at `:285`). A time
  namespace would not help: "time namespaces do not virtualize the CLOCK_REALTIME clock"
  (`time_namespaces(7)`). No `/dev/rtc` is mounted into `app` (read: no `devices:`, no `/dev` bind,
  `deploy/compose.yml:42-45`; not run). The runtime image installs only `ca-certificates` and
  `libcap2-bin` (`deploy/Dockerfile:172`), so there is no `timedatectl` in the container (read, not
  run) — see "Where the outline was wrong", item 4.
- `timedatectl set-time` "will also update the RTC time accordingly" (`timedatectl(1)`); it takes
  `@<seconds>` (`systemd.time(7)`, and `timedatectl.c`'s `parse_timestamp`, claim check T18).
- systemd refuses `set-time` while a time service **listed in `ntp-units.d`** (or in
  `$SYSTEMD_TIMEDATED_NTP_SERVICES`) is active ("Automatic time synchronization is enabled",
  `timedated.c:878-879`, systemd main as read 2026-10-24), and `set-ntp false` "disables and stops
  the known network synchronization services" — only those listed. A chrony or ntpd with no list
  entry is invisible to both (claim check W1): M1 prints the list.
- `NTPSynchronized` on systemd main is the kernel's maximum error under 16 s
  (`timedated.c:572-582`); the box's systemd version was not read.
- `systemd-timesyncd.service(8)`: `/var/lib/systemd/timesync/clock` is "updated on each successful
  NTP synchronization or after each SaveIntervalSec= time interval" and its time is used to advance
  the clock at boot — so after a backward set, a power cut before the next save can bring the clock
  back AHEAD (claim check U3). The set touches that file (M8).
- `/run/systemd/timesync/synchronized` is "touched on each successful synchronization"
  (`systemd-timesyncd.service(8)`); its mtime is `lastSyncAt`.
- B3 plans the place: "one small service on the host … Waitron reaches it through a socket in a
  mounted folder; it accepts a fixed list of requests and nothing else, and a request that changes
  the box carries the person and permission the server checked" (B3 design §8). B3's plan
  (`2026-10-26-b3-usb-installer.md`, slice 3, file map row 3) names `deploy/box/` for its units and
  `apps/server/src/box-host-client.ts` for the server's client, with dotted request names
  (`network.read`, `screen.set`).
- **Install already switches time synchronisation on**: `enable_time_sync` runs `timedatectl
  set-ntp true` under a 60-second limit and prints a line when it cannot
  (`deploy/waitron.sh:322-332`, called at `:675`), landed by slice 10. The host service switches it
  off only around a set and back on after.

**Rejected alternative:** keep the box's clock and add an offset to the server's readings. Design
§2.5's "one reading stamps everything" breaks: records would carry the offset clock while TLS,
Litestream, logs, sessions and every `new Date()` outside the clock seat keep the wrong one.

## What slice 9 left that this slice builds on (read on `65bc0441a`)

- **No migration is needed.** `clock_confirmations` already has `box_clock_at` (the reading before
  any step), `confirmed_at` and `step_ms`
  (`packages/fiscal-verifactu/src/schema/clock-confirmations.ts:35-38`;
  `drizzle/0011_clock_checks_and_confirmations.sql`, columns `box_clock_at`, `confirmed_at`,
  `step_ms integer NOT NULL`, no CHECK on `step_ms`, so a negative step stores). Its `reason` CHECK
  already allows `unusable` and its `check_id` is nullable (same file). Both writers today store
  `stepMs: 0` and `boxClockAt = confirmedAt` (`clock-confirmation.ts:217-219`,
  `clock-checks.ts:187-189`). `count()` is a plain `integer`
  (`packages/db/src/schema/columns.ts:148`).
  The new alert is an `incidents` row, whose `code` is free text with only a non-empty CHECK
  (`packages/db/src/schema/incidents.ts:78`). Nothing in this plan changes a table, so
  `git diff main --name-only -- '*/drizzle/*' packages/migrations` must print nothing at the end.
- **The cover reads `confirmed_at` as the time adopted**: `accepted = record_at − confirmed_at`,
  and a later reading is covered while `latest − reading ≤ accepted + 60 000`
  (`packages/fiscal-verifactu/src/clock-behind.ts:133-137`). So a step's row must store the reading
  AFTER the set as `confirmed_at`, and the reading before it as `box_clock_at`.
- **The wrongly dated list's start** is `confirmed_at` less the boot-time clock's elapsed time since
  the check opened (`correctedStart`, `clock-checks.ts:75-89`); with `confirmed_at` the reading
  after the set, and the boot reading taken after the set, the formula holds unchanged.
- **The witness store drops a reading once the wall clock steps** by more than a second against
  the steady clock (`fresh`, `apps/server/src/clock-witnesses.ts:58-64`), and keeps AEAT's
  disagreements until `endStop()` or `clear()` (`:113-120`).
- **The watch** opens the check and confirms only on `proof === "ready"`
  (`apps/server/src/clock-watch.ts:268-289`); on `contrary` it does nothing today. It takes a
  forward move of the wall clock of more than a minute against the boot-time clock as a jump and
  records a disproof (`:218-225`, `JUMP_MS` at `:26`), so a set made by the box would read as one
  unless the watch is re-anchored.
- **The administrator's routes** are `POST /api/box/clock-challenge` and `POST
  /api/box/clock-confirm` (`apps/server/src/box-health-api.ts:240-311`), refused `same_machine` on
  the box outside development (`:247-250`), refused `differs` when the device disagrees
  (`clock-confirmation.ts:190`). The dashboard's dialog draws only Close when the device differs
  (`apps/dashboard/src/screens/box-status-screen.ts:498-557`).
- **Time health today**: `checkTimeHealth` runs `timedatectl show -p NTPSynchronized --value` in
  the server's own process (`apps/server/src/time-health.ts:36-45`); `/api/box/health` caches it
  60 s (`apps/server/src/boot.ts:2528`, used at `:2565`), `/api/box/status` runs it on every request
  (`apps/server/src/box-status.ts:127`).

## Where the outline was wrong on this tree

1. `pruneBackend` is at `apps/server/src/backup-sweep.ts:327-351` (called at `:271`), not
   `:232-257`.
2. The outline does not mention that slice 10's install half has landed: `enable_time_sync`
   (`deploy/waitron.sh:322-332`) already switches the time service on at every install.
3. B3's plan, written two days after the outline, names the client
   `apps/server/src/box-host-client.ts` (the outline: `host-box.ts`) and puts the host's units under
   `deploy/box/`; its requests are dotted. This plan uses `box-host-client.ts`, `deploy/box/`, and
   `clock.status` / `clock.set` (the outline: `clock-status` / `clock-set`). B3's plan names a
   long-running `deploy/box/waitron-box.service` and a Node host (`scripts/box/host.mjs`); a
   hand-installed box has no Node on its host, so 9b ships a socket-activated shell handler. **For
   the lead to rule:** whether B3 slice 3 takes the socket over, keeping these two requests and
   their replies.
4. Not in the outline, and it changes what 9b's first read shows: today the server cannot read
   the time service on a box at all. The runtime image has no `timedatectl`
   (`deploy/Dockerfile:172`), so `checkTimeHealth`'s spawn fails and it answers `source:
   "unavailable"` (`time-health.ts:42-43`), and the Clock row draws its "Kept in time over the
   internet" line only for `source: "timedatectl"`
   (`apps/dashboard/src/screens/box-status-rows.ts:292-293`). Read, not run: so on a box that line
   has never been drawn, and 9b is the first slice that shows it.
5. FYI 3's "every change raises a bell alert" would not hold as a plain `recordIncident`: two open
   `clock.corrected` incidents with no sale share the open-incident key and the second is dropped
   (`packages/db/src/schema/incidents.ts:52-77`, `packages/core/src/incidents.ts:103-116`). Decision
   9 marks the earlier one handled, as `clock-stop-incidents.ts:100-120` already does for
   `clock.records_misdated`.
6. The stream's generation pruning compares the box's clock with the BUCKET's `lastModified`
   (`packages/stream/src/generations.ts:98`, `:102`), not with names the box wrote: a correct
   forward set is harmless there, while a box clock wrongly ahead — or a forged forward set —
   deletes every generation but the live one. Task 15 holds it.
7. FYI 2 named only devices and administrators; design §4.9 h.1 says AEAT cannot set the clock
   while synchronised either.
8. M7 cannot run (Docker Desktop not answering, below); its fallback is taken up front, and a
   `docker compose config` check on the runner (M7′) stands in for the part that can be read.

## Measurement — Task 1 runs it, and the build STOPS if any line prints its failing case

**Where it runs** (round 1, I6): a GitHub Actions job on the 9b branch triggered by `pull_request`
and limited by `paths:` to `scripts/host-clock-measure.sh`, its workflow file and `deploy/box/**`,
on a GitHub-hosted `ubuntu-24.04` runner (a disposable machine with systemd and Docker). A
`workflow_dispatch`-only file cannot run from a feature branch: GitHub shows its button "if the
workflow file exists on the default branch", and dispatching to another branch needs it to have
"run at least once" (round 1, experiment 6). **One small job**: the account is near GitHub's
20-concurrent-jobs limit. The workflow passes `pnpm exec vitest run scripts/ci-workflow.test.mjs`:
a `permissions:` block, `timeout-minutes` on its job, the three-step bounded checkout, no pnpm, no
apt. **Who runs it:** the lane's lead pushes the branch and opens the 9b pull request as a DRAFT
right after Task 1's commit, so the job runs; the lead copies the job's log lines into the table
below. **Never** set a clock on Docker Desktop's own machine (every container on this Mac shares
it) or on the owner's box. The job's last step, `if: always()`, puts the runner's time service back
on.

**M7 not run: Docker Desktop not answering on 2026-10-31** (run while writing this plan:
`gtimeout 15 docker info` exited 1 and `ls ~/.docker/run/docker.sock` printed "No such file or
directory"; the coordinator reports the socket missing since 2026-10-23, and nobody may restart
Docker Desktop, since other sessions share it). The outline's fallback for a failed M7 is taken up front: the bind is
optional for development (decision 1, Task 3). No other step of this plan needs local Docker.

A GitHub runner is an Azure virtual machine. If M3 or M4 shows the clock undone within seconds
with no listed time service active, the hypervisor's own time synchronisation may be the cause,
which a box does not have; the STOP then asks whether to measure elsewhere, not whether the design
is wrong.

Each row: what the script runs (as root unless said); what is expected; what the failing case
prints, and what it means.

- **M1.** `timedatectl show -p NTP -p NTPSynchronized`; `ls /usr/lib/systemd/ntp-units.d
  /etc/systemd/ntp-units.d` and their contents; `systemctl is-active systemd-timesyncd chronyd
  chrony ntp ntpsec`; `systemd --version`. *Expected:* `NTP=yes`; one active unit, and it is
  listed. *Failing:* an active unit not listed — `set-ntp` cannot switch it off, so the handler
  must stop and start it itself (not a STOP; Task 2 takes it in).
- **M2.** `timedatectl set-time @$(( $(date +%s) + 120 ))` with the service on. *Expected:*
  `Failed to set time: Automatic time synchronization is enabled`. *Failing:* the clock moved —
  the `set-ntp` toggle is not needed (and a running service may undo the set).
- **M3.** `set-ntp false`; `set-time @now+120`; print `date +%s%N`, `/proc/uptime`,
  `/proc/sys/kernel/random/boot_id` and `timedatectl show -p RTCTimeUSec -p NTPSynchronized`
  before and after. *Expected:* wall +120 s ± 2; uptime moved only by the elapsed seconds; boot id
  unchanged; RTC +120 s; `NTPSynchronized=no`. *Failing:* RTC unchanged (a power cut would undo
  the set); uptime +120 s (9c's change detector and slice 9's corrected stop start would be
  blind).
- **M4.** `set-ntp true`; poll `date` for up to 120 s. *Expected:* the clock steps back to network
  time. *Failing:* it stays 120 s ahead — the time server does not have the last word.
- **M5.** A throwaway socket unit with Task 2's settings (`/run/waitron-box-measure/box.sock`,
  `Accept=yes`, `SocketMode=0660`, `SocketGroup=10001`) and a five-line handler; from a container
  (`node:26.11.1-slim`, `--user 10001:10001`, no added capability, the directory bind-mounted)
  send `clock.status` and `clock.set <ms> {"source":"measure"}`; read
  `/proc/sys/kernel/random/boot_id` there too. *Expected:* a JSON status; the set applied on the
  host; the host's boot id. *Failing:* `EACCES` on the socket (its group or mode is wrong); a
  different boot id (slice 9's `partial` fallback would always apply).
- **M6.** The same container without the bind. *Expected:* the client prints `unavailable` within
  2 s. *Failing:* a hang.
- **M7.** Locally on Docker Desktop, `docker compose up` with the bind. **Not run** (above).
- **M8.** After a backward set of 120 s, the mtime of `/var/lib/systemd/timesync/clock`.
  *Expected:* not later than the new time (the handler touches it). *Failing:* later than the new
  time — at the next boot timesyncd would advance the clock to it, back ahead.
- **M9.** `systemd-analyze verify` of the socket with a numeric `SocketGroup=10001`, and an
  instance under `RuntimeMaxSec=15` running `sleep 60`. *Expected:* accepted; the instance killed
  at 15 s. *Failing:* refused — the units need a named host group with gid 10001, which is the
  new decision the STOP asks for.

**STOP rule:** if M2, M3, M4, M5, M6, M8 or M9 prints its failing case, the build stops after
Task 1 and the lead reports to the coordinator: the mechanism needs a new decision. Only M1's
failing case is taken in by the plan (decision 3). M7 is not run.

### Measured for 9b

Filled from the job's log by the lead; each row gives the run's URL and the printed lines verbatim.

| # | Run | Printed | Verdict |
| --- | --- | --- | --- |
| M1 | | | |
| M2 | | | |
| M3 | | | |
| M4 | | | |
| M5 | | | |
| M6 | | | |
| M7 | — | not run: Docker Desktop not answering on 2026-10-31 | — |
| M8 | | | |
| M9 | | | |
| M5′ (Task 4) | | | |
| M7′ (Task 4) | | | |
| M8′ (Task 4) | | | |
| M9′ (Task 4) | | | |

## Decisions the build follows

1. **The host service** `waitron-box`: a socket unit `deploy/box/waitron-box.socket`
   (`ListenStream=/run/waitron-box/box.sock`, `Accept=yes`, `SocketMode=0660`, `SocketUser=root`,
   `SocketGroup=10001` (M9), `MaxConnections=4`) and a template `deploy/box/waitron-box@.service`
   (`StandardInput=socket`, `StandardOutput=socket`, `RuntimeMaxSec=15`) running
   `/usr/local/lib/waitron/waitron-box.sh` as root: one request line in, one JSON line out.
   Installed by `waitron.sh install` (a host without systemd prints a line and install carries on);
   B3's image installs the same files. The app container mounts `/run/waitron-box` (the directory,
   so a re-created socket is seen) **only when `.env` names it**: compose reads
   `${WAITRON_BOX_SOCKET_DIR:-box_socket}:/run/waitron-box`, so with nothing in `.env` it mounts an
   empty named volume and the client answers unavailable. Install writes
   `WAITRON_BOX_SOCKET_DIR=/run/waitron-box` only once the socket is listening, and removes it when
   it is not — the pattern `load_print_agent_apparmor` uses (`deploy/waitron.sh:217-234`). That is
   the outline's M7 fallback: a laptop or Docker Desktop never names `/run`.
2. **`clock.status`** answers `{"ok":true,"service":"on"|"off"|"stopped","unit":<name>|null,
   "synchronised":bool,"lastSyncAt":<ms>|null,"nowMs":<ms>}` — `off` when `NTP=no`, `stopped` when
   `NTP=yes` and no listed unit is active, `on` otherwise; `lastSyncAt` the mtime of
   `/run/systemd/timesync/synchronized`.
3. **`clock.set <epochMs> <requester>`** refuses (`{"ok":false,"reason":…}`) a target that is not
   digits, before 2024-10-28T00:00:00Z or from 2100-01-01T00:00:00Z on (`target_invalid`; the
   server's own check of the first issue date is in the venue's offset, this is only a range), while
   `NTPSynchronized=yes` (`synchronised`), or with a requester that is not one line of printable
   ASCII from `{` to `}` of at most 512 bytes (`requester_invalid`); the server sends ids only,
   never a name. Otherwise it switches the listed service off, sets `@<seconds>` (the target plus
   the time since the request arrived, by `/proc/uptime`), touches `/var/lib/systemd/timesync/clock`
   to the new time when it exists (M8), switches the service back on — from a `trap` on every exit,
   so also after a failed set or a kill at 15 s — and answers
   `{"ok":true,"beforeMs":…,"afterMs":…}`; `set_failed` when `set-time` fails. One
   `logger -t waitron-box` line names the target and the requester. Any other line answers
   `unknown_request`. If M1 printed an active unlisted unit, the handler stops and starts that unit
   by name around the set instead.
4. **The server's client** (`apps/server/src/box-host-client.ts`): `clockStatus()` (2 s) and
   `setClock({ targetMs, requester })` (15 s); a missing socket, a refusal, a malformed reply or a
   timeout answers `{ available: false, reason }`, never a throw.
5. **The time service is watched.** `checkTimeHealth` reads `clockStatus()` instead of running
   `timedatectl` itself, keeping its answer's shape (`synced`, `source`, `warn`): `source:
   "timedatectl"` stays true, since the host reads `timedatectl`. Both `/api/box/health` and
   `/api/box/status` read it through one 60-second cache. `clock.sync_off` (warning, area `box`,
   `system.manage`, `screen: "box-status"`, params `{ reason }`, reasons `off`, `stopped`,
   `unsynchronised`, `unreachable`) is an ongoing alert source over the same cached status;
   `unreachable` only when `config.environment === "production"`.
6. **When the box sets its clock** (`apps/server/src/clock-correction.ts`, called by the watch and
   by the administrator's route), during a stop the box already has:
   - the clock behind the latest record (the stop proper, `clockBehindChain` non-null): AEAT
     disagreeing (`contrary.authority`) → AEAT's time; else a group of devices from two addresses,
     none on the box, disagreeing (`contrary.devices`) → their mean;
   - the clock before 28-10-2024 (`clock.unusable`): a group of devices disagreeing → their mean
     (AEAT cannot be reached then: its certificate cannot be checked; the production QR host's
     certificate starts 2025-11-17, claim check T27);
   - either stop, with no AEAT witness and no group of devices taken during it: an administrator's
     device that differs by more than a minute, on their Confirm ("Use your device's time?").
   Never while `clockStatus()` says synchronised; never when the host service is unavailable. The
   target is the box's reading now plus the witnesses' difference (`witnessAt − boxAt`, unchanged
   since the store holds only readings taken with no step since).
   **Order (round 1, M7), each step tested in order:** take the one-at-a-time turn; read
   `clockStatus()` fresh; tell every registered anchor (the clock watch; 9c's guard later) that a
   set is coming; read wall and boot clocks; ask the host; read both again; verify
   `|wallAfter − (target + (bootAfter − bootBefore))| ≤ 2 000`; re-anchor; clear the witness store;
   then write the row (decision 7) and the alert in one transaction.
7. **The row** (seat method `confirmClockStep`, Task 8): one `clock_confirmations` row,
   `box_clock_at` the reading before, `confirmed_at` the reading after, `step_ms` the measured step
   (`(wallAfter − wallBefore) − (bootAfter − bootBefore)`, rounded), `source` the witness's
   (`authority`, `devices`, `admin`), `person_id` for `admin`, `proof` the witnesses that set it
   plus `step: { beforeAt, afterAt, stepMs, targetAt }` and, for a stop, `heads` and `closing` as
   slice 9 writes them. For the clock-behind stop: it closes the open check (opening one at the
   before reading first if none is open, as `confirmClockStop` does,
   `clock-confirmation.ts:193-203`); if the after reading is still more than a minute behind the
   latest record it names that record (a lift, `clock.behind_chain_restarted`), otherwise it names
   none; `clock.records_misdated` through `recordMisdated` as every closing does. For
   `clock.unusable`: `reason: "unusable"`, `check_id` null, no record named, nothing listed (no
   record can be written before 28-10-2024). Always `clock.corrected` (decision 9). A set that
   failed verification writes no row and records `clock.corrected` with `verified: false` and the
   measured step, when the clock moved by more than a second.
8. **A step whose row could not be written** (a full disk) is kept in memory and written on the
   watch's next look, as the watch keeps disproofs (`clock-watch.ts:79-117`); a restart loses it,
   and the host's journal line remains. Logged `clock_correction.row_pending` once.
9. **`clock.corrected`** params `{ confirmationId | null, source, person | null, before,
   beforeOffsetMinutes, after, afterOffsetMinutes, stepMs, verified }`, severity warning, no sale.
   Recording it first marks any open `clock.corrected` handled by the system
   (`markIncidentHandled`, person null). Claimed by the Veri\*Factu module
   (`{ prefix: "clock.corrected", area: "box", permission: "system.manage" }` beside its two clock
   claims, `packages/fiscal-verifactu/src/alerts.ts:13-14`; the server resolves the longest prefix,
   `apps/server/src/alerts.ts:41-42`, so `packages/db`'s `clock.` claim does not take it). Emailed
   once per incident through `INCIDENT_EMAIL_CODES` (`apps/server/src/box-alert-email.ts:38-42`).
10. **The administrator's set** is a third route, `POST /api/box/clock-set`, `person.admin`, the
    same challenge (`clock-challenges.ts`) and the same on-the-box refusal. Refusals are
    `clock.set_refused { reason }` (409): `same_machine`, `not_stopped` (no stop proper and no
    `clock.unusable`), `host_unavailable`, `synchronised`, `witnessed` (AEAT or a group of devices
    has spoken during the stop: the box sets or confirms from them itself), `agrees` (the device is
    within a minute: confirm instead); `clock.check_expired` (400) as today; a failed or unverified
    set is `clock.set_failed { reason: "refused" | "unverified" }` (502). No transaction is held
    while the host sets.
11. **Every job that reads the wall clock** is made safe for a step of days, or accepted with a
    reason (round 1, I5), in Tasks 14 and 15: backups pruned by the age in their names; the stream's
    generation pruning; management sessions and passkey challenges whose stored time is ahead of
    the clock; then whatever the audit's greps find (Task 15's table).
12. **What 9c inherits:** the anchor registration of decision 6 (9c's change guard registers
    beside the watch); `confirmClockStep` taking any open check's reason (9c's `start`, `change`,
    `disagrees`); `clock.sync_off`'s `unreachable` (9c's alert-not-stop case, design §4.9 h.2).
    9b opens no check of its own and adds no stop.

## Changed test checks

Each goes in a commit of its own whose message begins `Changed test checks (A798 slice 9b):` and
lists each `file:line` with before and after; the pull request names them. A test that must be
EDITED to pass and is not on this list is a STOP, unless the spec changes what it checks.

**Behaviour the design changes:**
1. `apps/server/src/time-health.test.ts:17-31` (`describe("checkTimeHealth")`, three cases built on
   a `CommandRunner` that stands in for `timedatectl`): the reading moves to the host (design §4.9
   g; outline decision 5). Each case keeps its state and its exact `toEqual` — synced →
   `{ synced: true, source: "timedatectl", warn: false }`, not synced → `warn: true`, unreachable →
   `{ synced: false, source: "unavailable", warn: false }` — with the stub swapped from a runner to
   a client answering `clockStatus()`. `CommandRunner` and the `execFile` default go
   (`time-health.ts:13-34`). Task 6.

**Whole-shape lists gaining entries** (the owner's standing exception of 2026-09-27):
2. `packages/fiscal-verifactu/src/alerts.test.ts:10-11` (`FISCAL_ALERTS` `toEqual`) gains the
   `clock.corrected` claim. Task 8.
3. `scripts/ongoing-alert-codes.test.ts`'s hand list of source files gains
   `apps/server/src/clock-sync-alert.ts`. Task 7.
4. `packages/fiscal-none/src/backend.test.ts:74-81` and
   `packages/fiscal/src/testing/fake-backend.test.ts:66-74` gain
   `expect(x.confirmClockStep).toBeUndefined()` (Task 8) and
   `expect(x.latestClockStep).toBeUndefined()` (Task 14); no existing line changes.
5. Any whole-list assertion of `INCIDENT_EMAIL_CODES` gains `clock.corrected` (expected: none —
   `/usr/bin/grep -rn 'INCIDENT_EMAIL_CODES' apps/server/src --include='*.test.ts'` printed nothing
   on `65bc0441a`; re-run in Task 9 and list any it finds). Task 9.

**Fixtures only, no assertion changed:**
6. `apps/server/src/box-status.route.test.ts:120` and
   `apps/server/src/awaiting-fiscal-cert.test.ts:70`:
   the `mountBoxStatusApi` deps gain the required `readTime`, a stub answering the fixture's time
   health. Task 6.
7. `apps/server/src/clock-watch.test.ts`'s harness: no `correction` dep is passed, which the watch
   reads as "cannot set" — so every existing case runs unedited. Listed only so the review checks
   that no existing case changed.

**Must pass unedited:** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (the golden huella),
`inmutabilidad.test.ts`, `apps/server/src/boot.box-health.test.ts:209-224` ("caches the clock check
and the disk walk for a minute…", which mocks `checkTimeHealth` by name: the name stays), every
`clock-confirmation*`, `clock-checks*`, `clock-behind*`, `clock-misdated*` and `clock-confirm.route`
test, and every other test on `main`.

## Global constraints

- **The fiscal core is untouched**: `computeHuella`, the hash chain (`chain.ts`), `registro-row.ts`,
  invoice-number and series allocation, `registros_facturacion` and its triggers, `recordSale`,
  `recordCorrection`, `recordSubstitution`, A679's `hour-*.ts`. After every task touching
  `packages/fiscal-verifactu`, `packages/fiscal` or `packages/core`:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  passes, and
  `git diff main -- packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/registro-row.ts packages/core/src 'packages/fiscal-verifactu/src/hour-*' ':!packages/core/src/*.test.ts'`
  prints nothing. **If a task finds it needs to change any of these, it STOPS there** and the lead
  reports.
- **No migration.** `git diff main --name-only -- '*/drizzle/*' packages/migrations` prints nothing.
  If a task finds it needs a schema change, it STOPS: the CHECK and column set of slice 9's
  migration were declared so that 9b would need none (slice 9 plan, R1).
- **No time from a device or AEAT is stamped on a record**: the box's clock stamps every record;
  this slice only moves that clock, through the host.
- **Nothing external blocks a sale** (CLAUDE.md §5): no new stop; a host that does not answer
  leaves the box exactly as slice 9 left it.
- Every refusal test asserts the domain code and params, with a row count before and after, and has
  a control that goes through. Server tests that record sales follow slice 8 decision 13
  (`docs/developers/testing-guide.md`, "A fiscal record dated after a later write's clock makes the
  chain refuse that write").
- English only outside translation files and guides (`scripts/english-only.test.ts`; the review
  greps the diff).
- `apps/dashboard` runs in real headless Chromium: `memory_pressure | grep free` first.
- Every push the lead makes passes the pre-push hook unaided; never `--no-verify`. The draft pull
  request is open from Task 1, so each task leaves the tree typechecking.
- Every new workflow job carries `timeout-minutes`, a `permissions:` block and the three-step
  bounded checkout; no apt-get anywhere in this slice.

## Tasks

### Task 1: Measure on a Linux runner (STOP gate)

**Goal.** Run M1–M6, M8 and M9 on a GitHub-hosted `ubuntu-24.04` runner, before any product code.

**Files.** Create `scripts/host-clock-measure.sh`, `.github/workflows/host-clock-measure.yml`.

**Failing test first.** `pnpm exec vitest run scripts/ci-workflow.test.mjs` with a first draft of
the workflow that omits `timeout-minutes`: "the workflows' job time limits" → "give every job a
time limit" (`scripts/ci-workflow.test.mjs:2958`) fails naming the new file's `measure` job.
Add it, and the bounded checkout's three steps copied from
`.github/workflows/licence.yml:17-37`; the guard passes.

**Steps.**
1. The workflow: `on: pull_request` with `paths:` `scripts/host-clock-measure.sh`,
   `.github/workflows/host-clock-measure.yml`, `deploy/box/**`; top-level `permissions: contents:
   read`; one job `measure`, `runs-on: ubuntu-24.04`, `timeout-minutes: 15`; the three checkout
   steps; `run: sudo timeout 600 bash scripts/host-clock-measure.sh`; a last step
   `if: always()`, `run: sudo timeout 60 timedatectl set-ntp true; timedatectl show -p NTP`.
2. The script (`set -euo pipefail`, every external command under `timeout`), printing one block
   per row of the measurement table, each line prefixed `M<n>:` with the raw values first and then
   `expected` or `FAILING CASE`. M5's handler is five lines written by the script into
   `/run/waitron-box-measure/` with units under `/run/systemd/system/` (runtime only; removed at the
   end): `clock.status` answers `timedatectl show -p NTPSynchronized --value`, `clock.set` runs
   `set-ntp false`, `set-time`, `set-ntp true`. The container: `timeout 180 docker run --rm --user
   10001:10001 -v /run/waitron-box-measure:/run/waitron-box node:26.11.1-slim node -e '<connect to
   /run/waitron-box/box.sock, write one line, print the reply, print the boot id>'`. M6 is the same
   without `-v`, with the client's own 2-second limit. M8 does its own backward set as root,
   prints the clock file's mtime before and after touching it, and prints `M8: not measured (no
   file)` when the runner has no `/var/lib/systemd/timesync/clock` (not a STOP; a backlog entry
   then asks for it on a real box). Expected failures (M2's refusal) are captured with `|| rc=$?`,
   never left to `set -e`. The script exits 1 when any of M2–M6, M8 or
   M9 printed its failing case, so the job's colour matches the table; the table is still read from
   the lines, not the colour.
3. Run locally only `bash -n scripts/host-clock-measure.sh` (syntax; it sets no clock).
4. Commit; push the branch; open the DRAFT pull request (`gh pr create --draft`), its description's
   first line: "Parked for the owner when finished: it changes the clock that dates every record.
   The measurement workflow is removed by the last commit." Watch the `measure` job
   (`gh run watch` on that run only); copy every `M<n>:` line into "Measured for 9b"; commit the
   table.

**Focused commands.** `pnpm exec vitest run scripts/ci-workflow.test.mjs`; `bash -n
scripts/host-clock-measure.sh`.

**STOP** as the measurement section says. If M1 prints an active unlisted unit, record it and carry
the unit's name into Task 2's handler (decision 3's last sentence).

### Task 2: The host's request handler and its units

**Goal.** Decisions 1–3 as files, tested without root and without systemd.

**Files.** Create `deploy/box/waitron-box.sh`, `deploy/box/waitron-box.socket`,
`deploy/box/waitron-box@.service`, `scripts/waitron-box-sh.test.mjs` (root project, beside
`scripts/waitron-sh.test.mjs`, whose stub pattern it copies: a directory of executable stubs for
`timedatectl`, `systemctl`, `touch`, `stat`, `logger`, `date`, put first on `PATH`; the uptime and
the two timesync paths overridable through `WAITRON_BOX_UPTIME`, `WAITRON_BOX_TIMESYNC_CLOCK` and
`WAITRON_BOX_TIMESYNC_SYNCHRONIZED` test variables, as `WAITRON_SH_BLUETOOTH_DROPIN` is,
`deploy/waitron.sh:245-248`). Each stub logs its arguments to a file.

**Failing tests first** (`pnpm exec vitest run scripts/waitron-box-sh.test.mjs`, red for "no such
file"):
- `clock.status` with `NTP=yes`, synchronised, a listed active unit → the exact JSON of decision 2;
  with `NTP=no` → `service: "off"`; with `NTP=yes` and no listed unit active → `"stopped"`; no
  `synchronized` file → `lastSyncAt: null`.
- `clock.set` refusals, each answering its reason and calling no `timedatectl set-*`: a target
  with letters; `1730073599999` (one ms before 2024-10-28T00:00:00Z); `4102444800000`
  (2100-01-01T00:00:00Z); `NTPSynchronized=yes`; a requester with a control character; one of 513
  bytes; one not wrapped in braces. Controls that go through: `1730073600000`, `4102444799999`,
  and a requester of exactly 512 bytes.
- A valid set calls, in order, `set-ntp false`, `set-time @<seconds>`, `touch -d @<seconds>
  <clock file>`, `set-ntp true`, and answers before and after; the `logger` line names target and
  requester.
- A `set-time` that fails still calls `set-ntp true` and answers `set_failed`; a handler killed
  with `SIGTERM` after `set-ntp false` still calls `set-ntp true` (the `trap`).
- An unknown first word answers `unknown_request`; an empty line too.
- The socket and service files, read as text: `Accept=yes`, `SocketMode=0660`,
  `SocketGroup=10001`, `RuntimeMaxSec=15`, `StandardInput=socket`.

**Deletion controls.** Remove the `synchronised` refusal → its case fails; remove the `trap` → the
kill case fails; remove the range check → the 2100 case fails. Restore each.

**Focused command.** `pnpm exec vitest run scripts/waitron-box-sh.test.mjs`.

### Task 3: Install installs it, and the bind is optional

**Goal.** `waitron.sh install` fetches the three files from the installed ref, installs them, and
names the socket folder in `.env` only once it listens; compose mounts it only then.

**Files.** Modify `deploy/waitron.sh` (a new `install_box_service <ref>` beside
`load_print_agent_apparmor`, called from `cmd_install` after `enable_time_sync`),
`deploy/compose.yml`
(the app's `volumes:` gains `- ${WAITRON_BOX_SOCKET_DIR:-box_socket}:/run/waitron-box`; top-level
`volumes:` gains `box_socket:`), `scripts/waitron-sh.test.mjs`, `scripts/deploy-image-env.test.ts`,
`deploy/.env.example` (the variable, commented: set by install, never by hand).

**Failing tests first.**
- `scripts/waitron-sh.test.mjs`, a new `describe("waitron.sh install and the box's host service")`:
  install fetches `deploy/box/waitron-box.sh`, `.socket` and `@.service` from the ref's raw URL,
  installs them under the test's override directories, runs `systemctl daemon-reload` and
  `systemctl enable --now waitron-box.socket`, then sets `WAITRON_BOX_SOCKET_DIR=/run/waitron-box`
  in `.env` before `docker compose up`; when `systemctl` is missing or enabling fails, prints one
  line naming what the box cannot do (set its own clock from a confirmed time), unsets the variable
  and carries on; reset leaves the service alone; a production `--reset install` refused before
  touching it (as the time-sync case at `:1267` does).
- `scripts/deploy-image-env.test.ts`: the app's bind reads `${WAITRON_BOX_SOCKET_DIR:-box_socket}`
  and `box_socket` is declared; no `cap_add`, no `SYS_TIME`, no `/dev/rtc` anywhere in
  `deploy/compose.yml`.

**Deletion controls.** Remove the `env_set` → the `.env` case fails; make it unconditional → the
"enabling fails" case fails.

**Focused commands.** `pnpm exec vitest run scripts/waitron-sh.test.mjs -t "host service"`;
`pnpm exec vitest run scripts/deploy-image-env.test.ts`; then each file whole, since a name-filtered
run does not load its other cases.

### Task 4: Measure the shipped files on the runner

**Goal.** Run the files Tasks 2–3 wrote on Linux: M5′ (M5 against `deploy/box/` installed by the
script instead of the throwaway handler), M8′ (M8 through the shipped handler), M9′
(`systemd-analyze verify` of the shipped units) and M7′ (`docker compose -f deploy/compose.yml
config --format json` with and without `WAITRON_BOX_SOCKET_DIR=/run/waitron-box`, printing the
app's `volumes`: a named `box_socket` volume without, a bind of `/run/waitron-box` with).

**Files.** Modify `scripts/host-clock-measure.sh` (a `--shipped` part, run by the same job after the
first part). Tasks 2 and 3 are pushed with this task's change; the script and `deploy/box/**` are
both in the workflow's `paths:`, so the push runs the job.

**Failing test first.** None in Vitest: this task's check is the job. Before pushing, `bash -n` the
script. The STOP rule of Task 1 applies to M5′, M8′ and M9′; M7′'s failing case (the bind present
with no variable set) sends Task 3 back.

**Steps.** Push; read the job; fill the four rows; commit the table.

### Task 5: The server's client for the host

**Goal.** Decision 4.

**Files.** Create `apps/server/src/box-host-client.ts`, `apps/server/src/box-host-client.test.ts`.

**Interface.**
```ts
export type ClockServiceStatus =
  | { available: false; reason: "missing" | "refused" | "timeout" | "malformed" }
  | { available: true; service: "on" | "off" | "stopped"; unit: string | null;
      synchronised: boolean; lastSyncAt: string | null };
export type ClockSetAnswer =
  | { available: false; reason: "missing" | "refused" | "timeout" | "malformed";
      refusal?: string }
  | { available: true; beforeMs: number; afterMs: number };
export interface BoxHostClient {
  clockStatus(): Promise<ClockServiceStatus>;
  setClock(input: { targetMs: number; requester: Record<string, string | null> }):
    Promise<ClockSetAnswer>;
}
export function boxHostClient(deps?: { socketPath?: string; statusMs?: number; setMs?: number }):
  BoxHostClient;
```
The default path is `/run/waitron-box/box.sock`; no environment variable. `StartServerSeams` gains
`boxHost?: BoxHostClient` (`apps/server/src/boot.ts:836-845`) so boot tests never touch a socket.

**Failing tests first**, each against a real `net.createServer` on a socket in `mkdtemp`:
`clockStatus` parses decision 2's JSON; a missing socket → `missing` within 50 ms; a server that
never answers → `timeout` at the 2-second limit (fake timers are not used: the limit is passed as
200 ms in the test); a reply that is not JSON, or JSON of the wrong shape → `malformed`; a reply
over 4 KiB → `malformed` and the connection closed; `{"ok":false,"reason":"synchronised"}` →
`refused` with `refusal: "synchronised"`; `setClock` writes exactly `clock.set <ms> <json>\n` with
a requester of ids only and answers before and after; a `targetMs` that is not a safe integer
answers `malformed` without connecting. Control: the happy path of each.

**Deletion controls.** Remove the size cap → the 4 KiB case fails; remove the timer → the timeout
case runs to Vitest's own limit and fails.

**Focused command.** `pnpm --filter @waitron/server exec vitest run src/box-host-client.test.ts`.

### Task 6: Time health from the host, cached on both reads

**Goal.** Decision 5's first half.

**Files.** Modify `apps/server/src/time-health.ts` (`checkTimeHealth(deps: { status: () =>
Promise<ClockServiceStatus> })`, mapping `available: true` → `{ synced, source: "timedatectl",
warn: !synced }` and unavailable → `{ synced: false, source: "unavailable", warn: false }`),
`apps/server/src/box-status.ts` (`BoxStatusDeps.readTime`, used at `:127`),
`apps/server/src/boot.ts` (one `boxHost` client — `seams.boxHost ?? boxHostClient()`; a new
`clockServiceCache` of 60 s over `boxHost.clockStatus()`, which Task 7's alert source reads too;
`timeHealthCache` at `:2528` stays and wraps `checkTimeHealth({ status: () =>
clockServiceCache.get("status", () => boxHost.clockStatus()) })`; `timeHealth` at `:2565` and the
new `readTime` both read `timeHealthCache`). Keeping `timeHealthCache` around the call to
`checkTimeHealth` is what lets `boot.box-health.test.ts:209-224`, which counts calls to the mocked
`checkTimeHealth` over three reads, pass unedited.

**Failing tests first.** Changed test check 1 (the three cases rewritten against a stub client;
they fail on the old signature). A new case beside `boot.box-health.test.ts:209`, "reads Box
status's clock through the same minute's cache": `GET /api/box/health`, then `GET
/api/box/status` twice, calls the mocked `checkTimeHealth` once (today: once for the health read
and once per status read, `box-status.ts:127`). `boot.box-health.test.ts:209-224` passes
unedited.

**Deletion control.** Call `checkTimeHealth` directly in `box-status.ts` again → the new case
fails.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/time-health.test.ts
src/box-status.route.test.ts src/boot.box-health.test.ts src/awaiting-fiscal-cert.test.ts`.

### Task 7: `clock.sync_off` in the bell

**Goal.** Decision 5's second half; FYI 5.

**Files.** Create `apps/server/src/clock-sync-alert.ts`
(`clockSyncAlertSource({ status, production })`, shaped like `clock-disagrees-alert.ts:7-37`, its
code written as a `code: "clock.sync_off"` literal, which is what the ongoing-codes guard reads),
its test; modify `boot.ts` (push it into `serverAlertSources` at `:2451-2481`,
`production: config.environment === "production"`), `apps/server/src/errors.ts`
(`"clock.sync_off": { reason: "off" | "stopped" | "unsynchronised" | "unreachable" }`, "built as
data … never thrown", beside `clock.disagrees` at `:1419-1422`),
`apps/dashboard/src/i18n/alert-messages.ts` (English and Spanish per reason; `unreachable` says
the box cannot read or set its own clock, worded as "For the lead to rule" item 2 decides),
`scripts/ongoing-alert-codes.test.ts` (changed test check 3).

**Failing tests first.** Source: `on` and synchronised → no alert; `off`, `stopped`,
`unsynchronised` (service `on`, not synchronised) → one warning each with its reason, `screen:
"box-status"`; unavailable with `production: true` → `unreachable`; unavailable with `production:
false` → none. `scripts/ongoing-alert-codes.test.ts` fails until the file is listed and the words
exist. The dashboard's alert-messages test: each reason worded in both languages.

**Deletion controls.** Drop the `production` check → the laptop case fails; drop the file from the
guard's list → the guard stays green (it hand-lists files): this is the guard's known weakness
(`docs/developers/conventions-data.md:90-95`), stated, not a control.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/clock-sync-alert.test.ts`;
`pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/errors-reachable.test.ts`;
`pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`.

### Task 8: The seat records a step of the clock

**Goal.** Decisions 7 and 9, in the Veri\*Factu module, without touching the fiscal core.

**Files.** Create `packages/fiscal-verifactu/src/clock-step.ts` and `clock-step.test.ts`; modify
`packages/fiscal/src/backend.ts` (`ClockStepRequest`, optional `confirmClockStep?(tx, input):
Promise<{ confirmation: ClockConfirmation | null }>` beside `confirmClockStop` at `:367-374`),
`packages/fiscal-verifactu/src/clock-stop-incidents.ts` (`recordCorrected`, already a listed
incident source in `scripts/alert-codes.test.ts:24-43`), `packages/fiscal-verifactu/src/alerts.ts`
(the claim), `packages/fiscal-verifactu/src/errors.ts` (`"clock.corrected"` params, beside
`clock.behind_chain_restarted` at `:378`), the seat's wiring (`backend.ts` of the Veri\*Factu
module), `packages/fiscal-none/src/backend.test.ts`,
`packages/fiscal/src/testing/fake-backend.test.ts`
(changed test checks 2 and 4).

```ts
export interface ClockStepRequest {
  before: Pick<TrustedReading, "instant" | "offsetMinutes">;
  after: Pick<TrustedReading, "instant" | "offsetMinutes">;
  bootBefore: BootReading;
  bootAfter: BootReading;
  targetAt: string;
  stepMs: number;
  verified: boolean;
  reason: "behind_chain" | "unusable";
  source: "authority" | "devices" | "admin";
  witnesses: readonly ClockWitness[];
  admin?: ClockAdminConfirm;
  nodeId: string;
}
```

**Failing tests first** (`useVenueDb`, a sale recorded a day ahead of the reading, as
`clock-confirmation.test.ts` builds its stop):
- AEAT sets the clock forward past the latest record: one row, `box_clock_at` the before reading,
  `confirmed_at` the after, `step_ms` the step, `source: "authority"`, `check_id` the open check,
  `registro_id` null; `clockBehindChain` at the after reading answers null; one `clock.corrected`
  with exact params; no `clock.behind_chain_restarted`.
- Two devices set it to a time still behind the latest record: `registro_id` the latest record, a
  lift that covers the after reading and readings up to a minute further back
  (`clockBehindChain` null at `after`, non-null at `after − 61 s`, `clock-behind.ts:133-137`);
  `clock.behind_chain_restarted` recorded.
- The list: a record written before the check opened and stamped more than a minute after the
  corrected start is listed; `proof.closing.correctedStart` equals `after − (bootAfter −
  check.bootMs)`.
- No check open: one opens at the before reading and the closing is `partial: true`.
- `reason: "unusable"`: a row with `check_id` null, `reason "unusable"`, no record named, no
  `clock.records_misdated`, one `clock.corrected`.
- `verified: false`: no row; `clock.corrected` with `confirmationId: null`, `verified: false`.
- A second step while the first `clock.corrected` is open: the first is handled by the system
  (person null), the second open; two incidents in all.
- `admin` source: `person_id` the person; the row's person CHECK satisfied; without `admin`,
  source `admin` is refused by the CHECK (control for the CHECK's reach).
- The golden huella and `inmutabilidad` pass; the `git diff` of the global constraints prints
  nothing.

**Deletion controls.** Store the before reading as `confirmed_at` → the lift-cover case fails;
drop the `markIncidentHandled` → the second-step case fails; drop the `unusable` branch's skip of
`recordMisdated` → the unusable case fails.

**Focused commands.**
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-step.test.ts
src/alerts.test.ts`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
src/write-path.e2e.test.ts`; `pnpm --filter @waitron/fiscal-none exec vitest run
src/backend.test.ts`; `pnpm --filter @waitron/fiscal exec vitest run
src/testing/fake-backend.test.ts`; `pnpm exec vitest run scripts/alert-codes.test.ts
scripts/errors-reachable.test.ts scripts/no-till-as-issuer.test.ts`.

### Task 9: `clock.corrected`'s words, in the bell and the email

**Files.** Modify `apps/dashboard/src/i18n/alert-messages.ts` (English and Spanish, one sentence per
source, naming the person for `admin`, before and after in the venue's offset, and the step in
words — "moved forward 2 days 3 hours" / "adelantado 2 días y 3 horas"; a `verified: false`
variant saying the box asked for the change and could not confirm it took), its test;
`apps/server/src/box-alert-email.ts` (`INCIDENT_EMAIL_CODES` gains `clock.corrected`; `wordsFor`
and `TIME_PLACEHOLDERS` gain `before` and `after`), `apps/server/src/i18n/box-emails.ts`
(`CLOCK_CORRECTED_EMAIL_WORDS`), `apps/server/src/box-alert-email.test.ts`.

**Failing tests first.** `scripts/alert-codes.test.ts`'s "every recorded code … has English and
Spanish wording" fails after Task 8 until the words land (a free red); the email: each source's
exact English text with both times in their offsets; Spanish read from `box-emails.ts`; the duty
emails a `clock.corrected` once (`box-alert-email.duty.test.ts`'s pattern); a step of exactly one
day and one of 400 days worded; no `{` left in any text. The bell's "never breaks a written time
across two lines" cases (`alerts-bell.test.ts:129-160`, `alerts-screen.test.ts:90-106`) pass
unedited.

**Focused commands.** `pnpm exec vitest run scripts/alert-codes.test.ts`;
`pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts
src/box-alert-email.duty.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run
src/i18n/alerts.test.ts`.

### Task 10: Setting the clock — the order, one at a time, verified

**Goal.** Decisions 6–8, and the owner question's switch.

**Files.** Create `apps/server/src/clock-correction.ts`, `clock-correction.test.ts`; modify
`apps/server/src/errors.ts` (`clock.set_refused`, `clock.set_failed`).

**Interface.**
```ts
export const DEVICES_MAY_SET_BACK_PAST_LAST_SALE = true; // owner, 2026-10-24 04:24
export function devicesMaySet(input: { targetMs: number; stepMs: number;
  latestRecordAt: number | null; rule: boolean }): boolean;
export interface ClockAnchor { stepComing(): void; reanchor(): void }
export function clockCorrection(deps: {
  host: BoxHostClient; backend: Pick<FiscalBackend, "confirmClockStep">;
  store: Pick<ClockWitnessStore, "clear">; clock: Pick<TrustedClock, "now">;
  wall?: () => number; boot: Pick<BootReader, "readBoot">;
  transaction: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  nodeId: string; log: Logger;
}): {
  addAnchor(anchor: ClockAnchor): void;
  set(input: { reason: "behind_chain" | "unusable"; source: "authority" | "devices" | "admin";
    offsetMs: number; witnesses: readonly ClockWitness[]; admin?: ClockAdminConfirm;
    latestRecordAt: number | null; requester: Record<string, string | null> }):
    Promise<{ set: true; confirmationId: string | null } | { set: false; reason: string }>;
  writePending(): Promise<void>;
};
```

**Failing tests first** (fake host, fake wall and boot clocks, a stub seat recording calls):
- The order: `clockStatus`, every anchor's `stepComing`, the readings, `setClock`, the readings,
  every anchor's `reanchor`, `store.clear`, then `confirmClockStep` — asserted as one list of
  calls.
- Synchronised → `{ set: false, reason: "synchronised" }`, no `setClock`, no anchor told;
  unavailable → `host_unavailable`, the same.
- A target before 2024-10-28 or after 2100 → refused before the host is asked.
- Verification: the host moves the wall clock by the step → `verified: true`; by the step + 2 001
  ms → `verified: false`, no row asked for but `confirmClockStep` called with `verified: false`
  (the alert); the host answering `set_failed` with the clock unmoved → no seat call, `{ set:
  false, reason: "refused" }`.
- One at a time: two `set` calls started together → the host sees one `clock.set` at a time and the
  second re-reads the status (synchronised now, in the test) and is refused.
- A seat transaction that throws a full-disk error → the step kept; `writePending()` on the next
  call writes it once; a second `writePending()` writes nothing.
- `devicesMaySet` with `rule: true` → true for a backward target before the latest record; with
  `rule: false` → false for that case and true for a forward one; the `set` path refuses a
  devices source with `devices_back_past_last_sale` only when the constant is false (test passes
  the rule through a test seam, not by editing the constant).
- The requester holds ids only: `{ source, check }` for automatic sets, `{ source: "admin", person:
  <uuid> }` for an administrator; a test asserts no `personName` reaches the host.

**Deletion controls.** Skip `reanchor` → the order case fails; drop the verification → the +2 001
case fails; drop the turn → the together case sees two sets.

**Focused command.** `pnpm --filter @waitron/server exec vitest run src/clock-correction.test.ts`.

### Task 11: The watch sets the clock during a stop

**Goal.** Decision 6's automatic half; the watch is an anchor.

**Files.** Modify `apps/server/src/clock-watch.ts` (an optional `correction` dep; the watch
implements `ClockAnchor`: `stepComing` sets a flag that skips the next jump comparison, `reanchor`
sets `previous` from fresh readings; on `stop.proof === "contrary"` after `openCheck`, call
`correction.set` with AEAT's offset when `stop.contrary.authority` is set, else the devices'
mean; when `stop === null` and the reading is not recordable, judge `deps.store.witnesses()` with
`judgeClockWitnesses` and set from a disagreeing group of devices; `writePending()` first on each
look; log a refusal once per change of reason, not every 15 s), `apps/server/src/boot.ts` (create
the correction before `startClockWatch` at `:2437`, pass it, `correction.addAnchor(clockWatch)`).

**Failing tests first** in a new `apps/server/src/clock-watch.correction.test.ts` (the existing
harness, a fake correction recording calls):
- A stop with AEAT disagreeing by +2 days → one `set` with `source: "authority"` and AEAT's offset;
  devices disagreeing too → still AEAT's.
- A stop with two devices from two addresses disagreeing, no AEAT → `source: "devices"`, the mean.
- A stop with one device disagreeing → no set.
- `clock.unusable` (a reading in 2001) with two devices disagreeing → `reason: "unusable"`.
- After `stepComing` and a +2-day move of the wall clock, the next look records no `jump`
  disproof; without `stepComing` the same move records one (the control: today's behaviour,
  `clock-watch.test.ts`'s jump case).
- A correction answering `synchronised` on three looks logs `clock_watch.cannot_set` once.
- One boot-level case in `boot.clock-watch.test.ts`'s style, for the wiring: `seams.boxHost` a
  fake host, a venue whose latest sale is a day ahead of the box, two equipment reads from two LAN
  addresses (`requestFromBox` false) reporting a day ahead → within one look the fake host was
  asked `clock.set` with a target about a day ahead and an ids-only requester. A real server's
  clock is `systemClock()` (`boot.ts:1816`), which no seam moves (`seams.testClock`, `:843`, is the
  module operations' hour clock, `module-operation-host.ts:31`), so the fake host cannot move it:
  the case asserts the honest outcome — no `clock_confirmations` row, no `clock.corrected` (the
  clock did not move, decision 7's last sentence) and one `clock_correction.unverified` log line.
  The success path through the row and the lift is Tasks 8, 10 and 12's, on clocks the test
  controls.

**Deletion controls.** Drop the `contrary` branch → the AEAT case fails; drop `stepComing`'s skip →
the jump case fails.

**Focused commands.**
`pnpm --filter @waitron/server exec vitest run src/clock-watch.correction.test.ts
src/clock-watch.test.ts src/clock-watch.elapsed.test.ts src/clock-watch.restart.test.ts
src/boot.clock-watch.test.ts`.

### Task 12: An administrator's "Use your device's time?"

**Goal.** Decision 10.

**Files.** Modify `apps/server/src/box-health-api.ts` (`clockConfirm` deps gain `correction` and
`hostStatus`; mount `POST /api/box/clock-set` when `confirmClockStep` exists); create
`apps/server/src/clock-set.route.test.ts`; modify `apps/server/src/boot.ts` (`:2594-2605`).

**The route**, in order: refuse on the box (`same_machine`, as `:247-250`);
`requireManagementSession`; authorize `person.admin` in one transaction; parse
`{ challengeId, deviceAt }` as `confirmBody`
does (`:87-102`); take the challenge (`clock.check_expired` when gone); judge, in a write-lock turn
with no drain, whether the stop proper holds or the reading is before 28-10-2024 (else
`not_stopped`) and whether AEAT or a group of devices has spoken during it (`witnessed`); compute
`boxAt` at the round trip's midpoint as `:281-295` does, and refuse `agrees` when the device is
within a minute; then `correction.set` with `source: "admin"` and the device's offset, outside any
transaction; map `synchronised`, `host_unavailable` to `clock.set_refused` and a failed or
unverified set to `clock.set_failed`; answer `{ confirmationId, stepMs, confirmedAt }`.

**Failing tests first** (the route mounted as `clock-confirm.route.test.ts` mounts it, with the
correction built on the test's own `clock` and `wall`, so the fake host can move them): a manager
→ 403 `{ permission: "person.admin" }`; no session → 401; on the
box → 409 `same_machine` with the fake host never asked; no stop → `not_stopped`; AEAT disagreeing
during the stop → `witnessed`; two devices during the stop → `witnessed`; the device 30 s off →
`agrees`; synchronised → `synchronised`; no host → `host_unavailable`; an old challenge → 400
`clock.check_expired`; the host moving the clock 3 s short → 502 `clock.set_failed { reason:
"unverified" }`; the control: a device a day ahead, nothing else spoken → 200, one row
`source: "admin"` with the person, `clock.corrected` naming the person, the stop lifted at the next
read; the before-2024 case → 200 with `reason: "unusable"`. Every refusal: zero rows written,
zero host sets, counted.

**Deletion controls.** Drop the `witnessed` check → its two cases fail; drop the on-the-box check →
`same_machine` fails; drop the permission → the manager case fails.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/clock-set.route.test.ts
src/clock-confirm.route.test.ts src/box-health-api.test.ts`.

### Task 13: The dashboard's dialog, refusals and row

**Files.** Modify `apps/dashboard/src/api/client.ts` (`clockSet` beside `clockConfirm` at `:4595`),
`apps/dashboard/src/screens/box-status-screen.ts` (the dialog at `:498-557`: when the reading does
not agree and `health.clock.sync` says the box can set — `source === "timedatectl" &&
!synced` — draw "The box's clock says {box}. Your device says {device}. Use your device's time?"
with Cancel and a primary "Use this time"; on Confirm a fresh challenge and `clockSet`; the check is
offered while `clock.unusable` is among the notices too, `#offersClockCheck` at `:410-416`),
`apps/dashboard/src/i18n/strings.ts` and the Spanish block (new keys under
`box_status.clock.admin.set.*`), `apps/dashboard/src/i18n/codes.ts` (`clock.set_refused`,
`clock.set_failed`), the refusal map beside `CONFIRM_REFUSALS` (`:41-46`).

**Words** (concise; CLAUDE.md §3's refusal rule — what happened and what each choice does, never
"ask someone"): `synchronised` — "The box keeps its clock in time over the internet and says it is
right, so it does not take a time from a device. If your device's time is right, check the box's
internet connection." `witnessed` — "The tax agency's time or two tills already decide the box's
clock; the box sets or confirms it by itself within a minute." `agrees` — the existing agree path.
`host_unavailable` — see "For the lead to rule". Success — "The box's clock is set. Everyone signs
in again." when the step is past half an hour forward or a minute back (FYI 6).

**Failing tests first** (`box-status-screen.test.ts`, browser): a differing device on a box that
can set shows the question, Cancel and "Use this time"; Confirm sends a fresh challenge then
`clockSet` with `deviceAt`; each refusal's words under the buttons; a box that cannot set still
shows today's `differ` sentence and Close only (control: today's behaviour unchanged);
`clock.unusable` offers the check. `box-status-screen.a11y.test.ts`: the set question, both themes.
Existing dialog cases pass unedited.

**Deletion control.** Drop the `canSet` condition → the "cannot set" control fails.

**Focused commands.** `memory_pressure | grep free`, then
`pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts
src/screens/box-status-screen.a11y.test.ts src/api/client.test.ts src/i18n/codes.test.ts`.

### Task 14: Backups pruned safely across a step

**Goal.** Decision 11 for `pruneBackend` (`apps/server/src/backup-sweep.ts:327-351`), which today
deletes past either cap by the stamp in the archive's name against `nowMs`. Today's behaviour
across a step, read from that code and not run (Task 14's first tests show it before the fix):
after a +400-day set, every archive made while the clock was behind looks 400 days old, so the age
cap deletes it at once and the count cap ranks it last; after a −400-day set, the archives made
while the clock was ahead rank first and never age, so once a destination holds `retain` archives
each new one is deleted on the next run.

**The rule.** `pruneBackend` gains `held?: { fromMs: number; toMs: number }`. While the latest step
the box made (`confirmClockStep`'s rows with `step_ms ≠ 0`, read through a new optional seat method
`latestClockStep(tx)` answering `{ confirmedAt, stepMs } | null`) is less than `retainDays` old by
the clock now, an archive stamped before the step's `confirmed_at` or more than a minute after now
is kept and takes no kept slot; the caps apply to the others as today. With no recent step,
nothing changes, except that an archive stamped more than a minute after now ranks after every
other (so it is the first deleted by count, never kept in place of a correctly dated one).

**Files.** `apps/server/src/backup-sweep.ts`, `backup-sweep.test.ts`;
`packages/fiscal/src/backend.ts` and `packages/fiscal-verifactu/src/clock-step.ts`
(`latestClockStep`); `boot.ts` (the sweep's deps);
changed test check 4 names `latestClockStep`.

**Failing tests first** (slice 9's T6 shows today's behaviour: `pnpm --filter @waitron/server exec
vitest run src/backup-sweep.test.ts -t "prunes by count AND age"` → 1 passed): a +400-day step
yesterday keeps every archive stamped before it; a −400-day step yesterday keeps the
future-stamped ones and keeps each new one up to `retain`; `retainDays + 1` days after either step,
pruning is as today; the future-stamped ranking with no step; `justStored` still never deleted.
"prunes by count AND age" passes unedited.

**Deletion control.** Drop `held` → the +400 case deletes the held archives and fails.

**Focused command.** `pnpm --filter @waitron/server exec vitest run src/backup-sweep.test.ts
src/backup-sweep-file.test.ts src/backup-sweep-staging.test.ts src/backup-sweep-stopped.test.ts`.

### Task 15: The other wall-clock jobs, and the audit table

**Goal.** Decision 11 for the rest; then a written table.

**Fixed in this task:**
- **Stream generations** (`#pruneDaily`, `packages/stream/src/supervisor.ts:815`, window
  `PRUNE_WINDOW_MS` at `:145`): the supervisor's deps gain
  `pruneHeld?: (now: Date) => Promise<boolean>`; boot answers true while the latest step is
  younger than `PRUNE_WINDOW_MS`, so for a week after a step the old generations are kept whatever
  the clock says. Its limit, stated in the code and the backlog: a box left a week on a clock set
  wrongly forward then prunes against it. Measuring age by the bucket's own times instead
  (the live generation's newest `lastModified`) would remove that limit, but changes what
  `packages/stream/src/generations.test.ts:156-157` and `:177-180` check (old generations pruned
  beside an old live one), so it is a backlog entry, not this slice. Test in
  `packages/stream/src/supervisor.test.ts`: held → `pruneGenerations` not called; not held →
  called as today.
- **Management sessions** (`packages/identity/src/management-session.ts:80`): a `lastSeenAt` more
  than a minute after now counts as expired (`management_session.expired`), so a backward step
  ends sessions as a forward one past 30 minutes already does. Tests: 61 s ahead → expired; 59 s
  ahead → accepted (the control).
- **Passkey challenges** (`packages/identity/src/passkey.ts:109`): a `createdAt` more than a minute
  ahead counts as expired. Same pair of tests.

**The audit.** Run and keep the output in the task's commit message:
`/usr/bin/grep -rn 'Date.now()\|new Date()\|now()\.getTime()' apps/server/src packages/*/src --include='*.ts' | /usr/bin/grep -v '\.test\.ts' | /usr/bin/grep -v '/testing/'`
and, for scheduled duties, the files that hold timers
(`/usr/bin/grep -rln 'unrefTimer\|setInterval\|setTimeout' apps/server/src packages/*/src --include='*.ts'`;
the browser packages' own timers are out of scope). Write a table into
`docs/developers/conventions-data.md` (Task 18's section) with one row per job that compares a
stored time with the clock: what a +400-day and a −400-day step does to it, and "fixed (test)" or
"accepted: <reason>". Named already, each to be decided there: certificate reminders
(`apps/server/src/certificate-reminder-worker.ts`,
`packages/fiscal-verifactu/src/certificate-reminders.ts`),
account-action links (`packages/identity/src/account-action.ts:115`, stored `expiresAt`), Cloud
grants (`cloud-backup.ts:137-138`, `cloud-recovery.ts:121`), the backup schedule's next fire
(`backup-sweep.ts:384-386`, which sleeps in hour chunks), working-time pay periods
(`packages/workforce/src/pay-period-close.ts`), and tender-refund ageing (`bill-refunds.ts:485`).

**STOP rule.** A job that deletes data, or keeps a credential alive past its limit, on a step of
days, is fixed in this task with a test, or the build stops for a decision.

**Focused commands.** `pnpm --filter @waitron/stream exec vitest run src/supervisor.test.ts`;
`pnpm --filter @waitron/identity exec vitest run src/management-session.test.ts
src/passkey.test.ts`.

### Task 16: Guides, English and Spanish

**Files.** `apps/server/src/guide/en/box-status.md` and `apps/server/src/guide/es/box-status.md`:
"When payments stop because of the clock" (`{#clock-behind}`) says the box sets its own clock from
the tax agency's time or two tills, or from an administrator's device on "Use your device's time?",
never while it keeps time over the internet; a new section `{#clock-service}` on the time service
and `clock.sync_off`'s reasons; "Emails about the box" (`{#emails}`) gains the clock-change email;
the sign-in-again note. `deploy/README.md` gains the host service (Task 18).

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`;
`pnpm exec vitest run scripts/guide-links.test.ts`.

### Task 17: LOOK, without the dev stack

The dev stack (`wa-wt demo`) needs Docker, which is not answering on this Mac, so the LOOK uses the
browser test runner: a throwaway case (not committed) in `apps/dashboard` renders the Box status
screen with (a) the set question open, (b) each set refusal under the buttons, (c) the Clock row
with "Not kept in time over the internet", (d) the bell with `clock.corrected` and each
`clock.sync_off` reason, and saves `page.screenshot` at 1280 and 390 wide, light and dark, English
and Spanish, into `~/waitron-campaign-b/a798-9b-shots/`. The email's text is written to a file and
read. The lead opens every image and notes what it saw in the ledger; a defect goes back to its
task.

### Task 18: Developer docs, CLAUDE.md, the deploy README and the asesor question

- `docs/developers/conventions-data.md`: a section "The box sets its own clock" after "A
  confirmation of the clock lifts the stop for one step back" (`:3969`): the host service and its
  two requests, the order, what a step's row stores, the alert, the pruning holds, Task 15's audit
  table, and the measurements with their run URLs. Update "A jump" (`:4163`) for `stepComing`.
- `CLAUDE.md` §5's clock bullet gains one clause: "the box sets its clock only through the host
  service, never while it keeps time over the internet, and every step it makes is alerted and
  emailed", naming its guards (`clock-correction.test.ts`, `clock-set.route.test.ts`,
  `scripts/waitron-box-sh.test.mjs`) and saying they are weaker than the rule where they are (the
  handler's suite runs stubs, not systemd). Run
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- `deploy/README.md`: the host service, what install writes, how to see its journal
  (`journalctl -t waitron-box`), and that a box upgraded without re-running install cannot set its
  clock.
- `docs/compliance/asesor-questions.md`: **Q61** (the next free number on `65bc0441a` — the
  headings run to Q60 at `:3814`; re-check with `/usr/bin/grep -nE '^### Q[0-9]+'
  docs/compliance/asesor-questions.md | tail -3` at build time and take the next free one):
  "A system that corrects its own clock from a device's clock when it has no internet (added
  <date>)" — whether a SIF may correct its own clock from devices' clocks or an administrator's
  device when it has no internet, and what it should record; its text names FYI 4's residual risk
  (a scripted request from two enrolled devices can set any time between 2024-10-28 and 2100, and
  after slice 9c can do so with nobody present). Plain English with a Spanish quotation block, as
  Q60 has; a dated note at the top beside the 2026-10-24 one; none in the shortened list.
- Docs-only changes travel in this pull request (they describe its code).

### Task 19: The measurement workflow goes; the backlog

1. `git rm .github/workflows/host-clock-measure.yml` (the script stays, round 3 M11);
   `pnpm exec vitest run scripts/ci-workflow.test.mjs`.
2. `docs/backlog.md:155-156`: "slices 1 to 10 landed; slices 9b and 9c are outlined" → "slices 1
   to 10 landed; slice 9b built and parked for the owner (#<pr>); slice 9c outlined".
   `docs/backlog/box.md`: the A798-B entry (`:1534-1546`) names 9b's pull request and Q61; "A
   device's or an administrator's time is self-reported" (`:1448-1457`) says slice 9b added the
   alert and email and that the time can now set the clock; "The clock watch's suspend-aware clock
   has not been run on Linux" (`docs/backlog.md:5106`) is narrowed to what M3 measured
   (a setting of the wall clock), leaving a real suspend unmeasured. New entries for anything Task
   15 accepted that a later slice must revisit, and for B3's takeover of the socket (item 3 of
   "Where the outline was wrong").
3. This plan's status line: built, parked, the pull request's number.

## Review notes

**Per-task review** after each task, at `high` effort, on that task's diff, stating the experiment
it ran.

**Codex seat 1 (with this checklist).** On `clock-correction.ts`, the watch and the
administrator's route with clocks the test controls (a server booted with `seams.boxHost` cannot
have its clock moved by the fake host, so there it checks only that the host is asked): a venue a
day ahead of the box; AEAT disagreeing by a day → within one look one `set`, one row
`source: "authority"`, `clock.corrected` open; two devices
from two addresses disagreeing, no AEAT → their mean; one device → nothing; the host answering
synchronised → nothing set, `clock.sync_off` absent (it is on) and the Clock row unchanged; the
host missing on a production box → `clock.sync_off` `unreachable`; an administrator's
`POST /api/box/clock-set` refusals each with zero rows; a +400-day and a −400-day step against
`pruneBackend`. Delete, one at a time: the synchronised refusal in the handler and in the server,
the verification, `stepComing`, the `witnessed` check, the `held` window; name the failing test.

**Codex seat 2 (checklist set aside)** — make the box set a wrong time, or lose data:
- forged matching headers from two device cookies at two addresses (expected: the clock is set,
  with an alert and an email — FYI 4; check both are recorded with the proof);
- an administrator's `deviceAt` sent by `curl` (expected: set, the person named);
- a set racing the clock watch (an admin's set and an automatic one together: one host set at a
  time, two rows or one, never a jump disproof);
- the host service killed mid-set (expected: the time service back on — the `trap` — and no row);
- a requester carrying a newline or 4 KiB (expected: refused by the handler);
- a step forward of 400 days then back: backups, stream generations and sessions.

## For the lead to rule

1. **B3's host.** 9b ships a shell handler under socket activation; B3's plan names a Node host and
   a long-running unit. Does B3 slice 3 take the socket over, keeping `clock.status`, `clock.set`
   and their replies? (Default built: yes, and a backlog entry says so.)
2. **`host_unavailable` and `clock.sync_off`'s `unreachable` words.** FYI 5 and design §4.9 h.2
   say "re-run the install", which needs a terminal the operator does not have and reads as sending
   them to whoever installed the box (CLAUDE.md §3's refusal rule). Default drafted: say what
   happened ("This box cannot read or set its own clock: the part of its install that does it is
   missing") and what still works (confirming an agreeing clock), with no instruction. Overturn if
   the install line is wanted.
3. **The backup hold** of Task 14 (archives outside `[step, now]` kept for `retainDays` after a
   step; future-stamped archives rank last afterwards) is this plan's own rule, not the design's.
4. **FYI 6** (everyone signs in again after a large step) is new and touches sign-in (a risk
   trigger already on the full path).

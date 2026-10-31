# A798-B slice 9b — the box sets its own clock, and watches its time service (BUILD PLAN)

> **Revision 3 (2026-10-31, after Task 1's two runs):** M5 printed its failing case — systemd will
> not start a socket whose numeric group names no host group — and M5b took the fallback M9
> names: a host group `waitron-box` of gid 10001, which install creates (decision 1, Tasks 2, 3
> and 18). The owner is told in `questions.md` as an FYI with that default; the build carries on,
> since the pull request is parked for the owner either way.
>
> **Revision 2 of the full plan (2026-10-31).** Written from the outline of 2026-10-24 when slice
> 9b was taken; the outline's owner FYI defaults, owner question, rejected alternative,
> measurement table, decisions and review notes are folded in below, each corrected where the
> tree on `main` `65bc0441a` contradicts it (listed under "Where the outline was wrong on this
> tree"). Revision 2 folds the fresh-context plan review of revision 1 (one critical, eight
> important, seven minor findings) and the lead's rulings on its four open points ("The lead's
> rulings", at the end). A narrow claim check of that fold (2026-10-31) is folded too: Task 15a
> split into 15a and 15b, the turn taken before the write lock, one `recordPending` at a time,
> `reanchor` taking and recording again, and a bounded read that can see an over-long line.
> Design: revision 7, §4.9 c, d, g, h, with §2.5, §8 item 9b and §12
> ([design](../specs/2026-10-19-a798-degraded-trading-design.md)). Base: slice 9
> ([plan](2026-10-23-a798-9-clock-restart.md), landed as #2025); seams left for slice 9c
> ([outline](2026-10-24-a798-9c-clock-check-at-start-and-change.md)).
>
> **Branch and worktree:** `python3 ~/workspace/tools/worktree.py new waitron
> feat/a798-9b-box-sets-clock --headless`. **Build method: inline** — the lane's lead writes every
> task's test and code itself, test first. Why inline: the owner's inline-coding trial (started
> 2026-10-27, runs until 2026-11-03, `~/waitron-campaign-shared/inline-trial.md:1`, `:11`) has each
> lane alternate item by item between `inline` and `implementers` (`:32-33`), and this item's turn
> is `inline` (the lead's count). A build that starts after the trial ends follows whatever rule
> the owner then sets. **Review path: FULL** (it changes the clock that dates
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
4. **Measure the shipped files on the runner** (M5′, M7′, M8′, M9′, M10′) — the Task 1 workflow,
   re-run; then **delete the workflow at once**, in the commit that fills the table (round 2, I6).
   STOP as Task 1.
5. **The server's client for the host** — `apps/server/src/box-host-client.ts`.
6. **Time health read from the host, cached on both reads** — `time-health.ts`, `box-status.ts`,
   `boot.ts`.
7. **`clock.sync_off` in the bell** — `apps/server/src/clock-sync-alert.ts`.
8. **The seat records a step of the clock, and the bell words it** —
   `packages/fiscal-verifactu/src/clock-step.ts`, `clock-stop-incidents.ts`, `alert-messages.ts`.
   STOP if the fiscal core would have to change.
9. **`clock.corrected`'s email, never lost to a later step** — `box-alert-email.ts`,
   `i18n/box-emails.ts`.
10. **Setting the clock: the order, one at a time, verified** —
    `apps/server/src/clock-correction.ts`.
11. **The watch as an anchor, and the store's settable readings** — `clock-watch.ts`,
    `clock-witnesses.ts`, `boot.ts`.
11a. **The watch sets it during a stop, with a backoff** — `clock-watch.ts`.
12. **An administrator's "Use your device's time?"** — `box-health-api.ts`
    (`POST /api/box/clock-set`).
13. **The dashboard's dialog and refusals** — `box-status-screen.ts`, `api/client.ts`, `i18n/*`.
14. **Backups pruned safely across a step** — `backup-sweep.ts`.
15. **The other wall-clock jobs, and the audit table** — `supervisor.ts`, `management-session.ts`,
    `passkey.ts`. STOP if a job that deletes data, keeps a credential alive, cuts tills off or
    blocks a legal record is left unfixed and not accepted by this plan.
15a. **A shift begun before a backward step can be clocked out and in again** —
    `packages/workforce/src/record-reads.ts`, `clocking.ts`. STOP if a workforce suite must be
    edited.
15b. **The till reads the same state** — `apps/server/src/till-clock-state.ts`,
    `attendance-discovery.ts`. STOP if a till-clock or attendance suite must be edited.
16. **Guides, English and Spanish** — `apps/server/src/guide/{en,es}/box-status.md`.
17. **LOOK, without the dev stack** — browser-test screenshots.
18. **Developer docs, the asesor question, the deploy README, B3's contract** —
    `conventions-data.md`, `asesor-questions.md`, `deploy/README.md`, `CLAUDE.md`,
    `docs/superpowers/plans/2026-10-26-b3-usb-installer.md`.
19. **The backlog** — `docs/backlog.md`, `docs/backlog/box.md`. (The measurement workflow is
    already gone: Task 4 deletes it.)

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
   change has its own alert; each has its own email too, because the correction hands every
   `clock.corrected` to the email duty directly and the duty keeps it until sent, whether or not
   the alert is still open (decision 9 — reading only open alerts once a minute would lose the
   first of two steps within a minute).
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
   silent, as today. **Its `unreachable` words give no install instruction** — a deliberate
   deviation from design §4.9 h.2 ("`clock.sync_off` says to re-run the install",
   `docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md:1227-1229`) and from 9c's
   FYI 5, which the same commit updates (decision 13, the lead's ruling (b)).
6. **New, for the plan review:** only DASHBOARD sessions can end on a step, and only when the
   session's last use (`lastSeenAt`) is more than `IDLE_TIMEOUT_MS` (30 minutes,
   `packages/identity/src/management-session.ts:13`) ahead of the new clock — the mirror of today's
   idle rule (`:80`), which already ends a session after a forward step past 30 minutes. So a step
   of more than about half an hour either way signs the confirming administrator out (their
   request has just stamped `lastSeenAt` at the reading before). A smaller FORWARD step shortens
   every session's remaining idle time by the step (the rule is `Date.now() − lastSeenAt >
   IDLE_TIMEOUT_MS`, `:80`), so a session already idle for more than 30 minutes less the step
   ends; a smaller BACKWARD step ends none.
   Tills and handhelds stay signed in: `apps/server/src/till-session.ts` has no time-based
   expiry, and the only one in `packages/identity/src` is `IDLE_TIMEOUT_MS`, for management
   sessions (run 2026-10-31: `/usr/bin/grep -rn "\.expired\"\|_TIMEOUT_MS\|TTL_MS\|expiresAt"
   packages/identity/src --include='*.ts' | /usr/bin/grep -v '\.test\.ts'` printed
   `IDLE_TIMEOUT_MS` and `CHALLENGE_TTL_MS`, a passkey challenge's, plus stored `expires_at`
   columns of one-off links, enrolments and sign-in states — none a staff session's). The lead's
   ruling (d).
7. **New, for the plan review:** after a backward step, a person who clocked out at one location
   and then clocks in at ANOTHER location within the step's window reads as clocked out on the
   till until real time passes their earlier clock-out (Task 15a, "Accepted residual"). What they
   clocked is recorded correctly; only the state the till shows is wrong, and a manager can retime
   the entry. It needs two locations on one box. The lead's ruling (e).

## Owner question — text for questions.md

The lead appends this to `~/waitron-campaign-b/questions.md` when the plan review is folded, and the
build goes on with the owner's standing answer (2026-10-24 04:24, "two tills … no admin needed")
built as the default. The narrower rule is one constant and one test expectation (Task 10,
`DEVICES_MAY_SET_BACK_PAST_LAST_SALE`), so either answer is a few lines. Re-read against
revision 2: the question and its example still hold. Its "every change is alerted, emailed and
kept with its proof" now rests on decision 9 (each change's email kept until sent, even after a
later change), whose one limit — a restart before the email goes out — the guide states; the
backoff and the `stale` refusal change how often the box tries, not what two tills may set.

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
re-read for revision 1; revision 2 re-read the saved `timedated.c` and `time-util.c` for the lines
it cites below:
- The container cannot set the clock: a default container's bounding set lacks `cap_sys_time`
  (design §12 experiment 6, Docker Desktop); `deploy/compose.yml` adds none (read: `:9-73`); the app
  runs as uid and gid 10001 (`deploy/Dockerfile:185-186`, `USER waitron` at `:285`). A time
  namespace would not help: "time namespaces do not virtualize the CLOCK_REALTIME clock"
  (`time_namespaces(7)`). No `/dev/rtc` is mounted into `app` (read: no `devices:`, no `/dev` bind,
  `deploy/compose.yml:42-45`; not run). The runtime image installs only `ca-certificates` and
  `libcap2-bin` (`deploy/Dockerfile:172`), so there is no `timedatectl` in the container (read, not
  run) — see "Where the outline was wrong", item 4.
- `timedatectl set-time` "will also update the RTC time accordingly" (`timedatectl(1)`); it takes
  `@<seconds>` (`systemd.time(7)`, and `timedatectl.c`'s `parse_timestamp`, claim check T18), and
  the number may carry a fraction: `parse_timestamp` hands what follows `@` to `parse_sec`
  (saved `time-util.c:843-844`), whose `parse_time` reads a `.` after the digits (`:1198-1240`;
  systemd main as saved 2026-10-24, the box's version not read). So the handler sends
  `@<seconds>.<milliseconds>` and M3 measures that form; `@<seconds>` alone would lose up to a
  second against the 2-second verification (round 2, minor 4).
- systemd refuses `set-time` while a time service **listed in `ntp-units.d`** (or in
  `$SYSTEMD_TIMEDATED_NTP_SERVICES`) is ACTIVE: `method_set_time` refuses "Automatic time
  synchronization is enabled" when `context_ntp_service_is_active` counts a listed unit whose
  `active_state` is neither `inactive` nor `failed` (saved `timedated.c:239-249`, `:878-879`).
  **`set-ntp false` is not a runtime switch**: `method_set_ntp` calls `unit_enable_or_disable(…,
  false)` and then `unit_start_or_stop(…, false)` on every listed unit (`:1033-1043`), and the
  first calls systemd's `DisableUnitFiles` (`:552-561`), so it DISABLES the unit on disk. A
  handler that switched it off with `set-ntp false` and died before switching it back (a power
  cut; a kill past `TimeoutStopSec`, which no `trap` survives) would leave the box without time
  synchronisation after every later boot (round 2, I1). So the handler
  stops and starts the listed unit with `systemctl stop` / `systemctl start` — runtime only,
  nothing written to disk — and M3 measures that `set-time` then succeeds. A chrony or ntpd with
  no list entry is invisible to `set-time`'s check (claim check W1): M1 prints the list.
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
  (`deploy/waitron.sh:322-332`, called at `:675`), landed by slice 10. The host service stops the
  running unit only around a set, at runtime, and starts it again after; it never disables it.

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
- **The witness store drops a device's reading, and an agreeing AEAT reading, once the wall clock
  steps** by more than a second against the steady clock (`fresh`,
  `apps/server/src/clock-witnesses.ts:58-64`), but NOT AEAT's disagreements: those it keeps
  "whatever its age and through steps" until `endStop()` or `clear()` (`:27-29`, `:113-120`), and
  it stores them without the steady-clock reading `fresh` needs. `clear()` also keeps AEAT
  readings not yet taken (`:35-36`), which the watch turns into `authority` disproofs at the end
  of its look (`apps/server/src/clock-watch.ts:290-297`), with `trustedUntil` the box's reading
  when the reply came. A disproof names every lift with `confirmed_at ≤ trustedUntil < record_at`
  (`packages/fiscal-verifactu/src/clock-stop-incidents.ts:197`). So, unless this plan changes it,
  a filing reply noted just before a backward set, still behind the latest record, would disprove
  the lift the set has just written: its `confirmed_at` (the reading after) lies below the reply's
  reading (taken on the old clock). Decision 6 changes it (round 2, I2).
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
   hand-installed box has no Node on its host, so 9b ships a socket-activated shell handler. B3's
   Task 3.1 fixes a different contract — `boxHostCall<T>(request)` with JSON requests and a
   `VerifiedHostActor` that "caller JSON or the kiosk marker cannot mint"
   (`2026-10-26-b3-usb-installer.md:70`, `:158`) — and its `waitron-box.service` would compete
   for the same unit name and socket path. Ruled (the lead's ruling (a)): 9b ships the shell
   handler; Task 18 writes 9b's text-line wire format and its self-reported requester into B3's
   Task 3.1 as the server↔host contract B3 must keep or migrate, and Task 19 adds a backlog line.
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
9. Revision 1 dropped the outline's "scheduled day closes" from the jobs to audit without saying
   so. There is no scheduled SALES day close (`/usr/bin/grep -rn -i
   'day.close\|dayclose\|closeDay\|z.report' apps/server/src packages/*/src`, run 2026-10-31, found
   only comments and calendar code), but there is a scheduled ATTENDANCE day close:
   `runAttendanceLoop` (`apps/server/src/attendance-loop.ts:59-75`, started from `boot.ts:1891`)
   runs `processAttendanceDay` on a day only once it has ended by the wall clock
   (`nextAttendanceDay` picks only a day whose `next_due_at` and `end_at` are `≤ now`,
   `apps/server/src/attendance-discovery.ts:557-558`), and that can append an automatic clock-out to
   the working-time record
   (`packages/workforce/src/end-of-day.ts:213`, `:360`). The fresh review's "no scheduler for
   them" holds for sales only. Task 15's audit now names it, under the widened STOP rule.

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
it) or on the owner's box. The job's last step, `if: always()`, starts the runner's listed time
service again.

**The workflow lives only from Task 1 to Task 4** (round 2, I6). A `paths:` filter on
`pull_request` is judged against the pull request's three-dot diff — "a comparison between the
most recent version of the topic branch and the commit where the topic branch was last synced
with the base branch" (GitHub's docs,
`data/reusables/actions/workflows/triggering-a-workflow-paths5.md`
in `github/docs`, fetched 2026-10-31). Once the script is on the branch it stays in that diff, so
every later push would run the job again and set a runner's clock for nothing. So the commit that
fills Task 4's rows also deletes the workflow file; the script stays (round 3, M11).
`pnpm exec vitest run scripts/ci-workflow.test.mjs` passed 345 of 345 on this plan's tree
(2026-10-31) and reads only workflow files that exist, so the deletion leaves it green; Task 4
re-runs it.

**M7 not run: Docker Desktop not answering on 2026-10-31** (run while writing this plan:
`gtimeout 15 docker info` exited 1 and `ls ~/.docker/run/docker.sock` printed "No such file or
directory"; the coordinator reports the socket missing since 2026-10-23, and nobody may restart
Docker Desktop, since other sessions share it). The outline's fallback for a failed M7 is taken up
front: the bind is optional for development (decision 1, Task 3). No other step of this plan needs
local Docker.

A GitHub runner is an Azure virtual machine. If M3 or M4 shows the clock undone within seconds
with no listed time service active, the hypervisor's own time synchronisation may be the cause,
which a box does not have; the STOP then asks whether to measure elsewhere, not whether the design
is wrong.

Each row: what the script runs (as root unless said); what is expected; what the failing case
prints, and what it means. `<unit>` is the active listed unit M1 prints.

- **M1.** `timedatectl show -p NTP -p NTPSynchronized`; `ls /usr/lib/systemd/ntp-units.d
  /etc/systemd/ntp-units.d` and their contents; `systemctl is-active systemd-timesyncd chronyd
  chrony ntp ntpsec`; `systemd --version`. *Expected:* `NTP=yes`; one active unit, and it is
  listed. *Failing:* an active unit not listed — `set-time` cannot see it, and it would undo a
  set, so the handler must stop and start it by name too (not a STOP; Task 2 takes it in).
- **M2.** `timedatectl set-time @$(( $(date +%s) + 120 ))` with `<unit>` active. *Expected:*
  `Failed to set time: Automatic time synchronization is enabled`. *Failing:* the clock moved —
  stopping the unit is not needed (and a running service may undo the set). M2 is also the
  control for M3: the same command, refused only because the unit runs.
- **M3.** `systemctl is-enabled <unit>`; `systemctl stop <unit>`; `set-time @<now+120>.250`;
  print `date +%s%N`, `/proc/uptime`, `/proc/sys/kernel/random/boot_id`, `systemctl is-enabled
  <unit>` and `timedatectl show -p NTP -p RTCTimeUSec -p NTPSynchronized` before and after.
  *Expected:* `set-time` exits 0; wall +120.25 s ± 0.5 (the fraction taken); uptime moved only by
  the elapsed seconds; boot id unchanged; `is-enabled` the same before and after (nothing written
  to disk); RTC +120 s; `NTPSynchronized=no`. *Failing:* `set-time` refused after the stop (the
  handler would need `set-ntp false`, which disables the unit on disk — a new decision); the
  fraction dropped (wall +120.0); `is-enabled` changed; RTC unchanged (a power cut would undo the
  set); uptime +120 s (9c's change detector and slice 9's corrected stop start would be blind).
- **M4.** `systemctl start <unit>`; poll `date` for up to 120 s. *Expected:* the clock steps back to
  network time. *Failing:* it stays 120 s ahead — the time server does not have the last word.
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
  *Expected:* not later than the new time (the handler touches it after stopping the unit).
  *Failing:* later than the new time — at the next boot timesyncd would advance the clock to it,
  back ahead.
- **M9.** `systemd-analyze verify` of the socket with a numeric `SocketGroup=10001`, and an
  instance under `RuntimeMaxSec=15` running `sleep 60`. *Expected:* accepted; the instance killed
  at 15 s. *Failing:* refused — the units need a named host group with gid 10001, which is the
  new decision the STOP asks for.

**STOP rule:** if M2, M3, M4, M5, M6, M8 or M9 prints its failing case, the build stops after
Task 1 and the lead reports to the coordinator: the mechanism needs a new decision. Only M1's
failing case is taken in by the plan (decision 3). M7 is not run. Task 4's rows (M5′, M8′, M9′,
M10′) stop the build the same way.

### Measured for 9b

Filled from the job's log by the lead; each row gives the run's URL and the printed lines verbatim.

| # | Run | Printed | Verdict |
| --- | --- | --- | --- |
| M1 | [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | `NTP=yes NTPSynchronized=yes`; `systemd 255 (255.4-1ubuntu8.18)`; `list /usr/lib/systemd/ntp-units.d/50-chrony.list: chrony.service`; `is-active systemd-timesyncd: inactive`, `chronyd: active`, `chrony: active`; `chronyd is unit chrony.service` | expected — the active unit is listed (`chronyd` is an alias of `chrony.service`). Run [41172990866](https://github.com/clintongormley/waitron/actions/runs/41172990866) printed a false failing case: the script compared the alias, not the unit (fixed in 48be808ad) |
| M2 | [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | `rc=1 output: Failed to set time: Automatic time synchronization is enabled; wall moved 0 s` | expected |
| M3 | [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | before `wall_ns=1793425411088008032 uptime=53.43 is-enabled=alias NTP=yes`; after `wall_ns=1793425531253131399 uptime=53.45 is-enabled=alias NTP=no NTPSynchronized=no`; boot id `c149e53c-…` both; `wall minus target: -0.007 s`; `uptime moved 0.020 s`; battery clock `05:43:30` → `05:45:31` | expected — the fraction taken, uptime and boot id untouched, enablement unchanged, battery clock +121 s. Run [41172990866](https://github.com/clintongormley/waitron/actions/runs/41172990866)'s battery-clock failing case was the script reading a date as a number (fixed in 48be808ad; that run's dates moved 05:32:54 → 05:34:54) |
| M4 | [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | `offset from the reference just after start: 120.142 s`; `offset after polling: 0.007 s` | expected |
| M5 | [41172990866](https://github.com/clintongormley/waitron/actions/runs/41172990866), [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | `socket start rc=1; srw-rw---- root:root`; `group 10001 in /etc/group: none`; journal `Failed to resolve group 10001: No such process`, `status=216/GROUP`; container `unavailable EACCES` for both requests | **FAILING CASE** — systemd resolves a numeric `SocketGroup=` through the group database, so a gid with no host group is refused at start. Taken in by M9's named fallback (decision 1, revision 3): M5b |
| M5b | [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | `with group waitron-box (gid 10001) added: socket start rc=0; srw-rw---- root:waitron-box`; `clock.status … reply {"synchronised":"yes"} boot c149e53c-… took 51 ms`; `clock.set 1793425487119 … reply {"rc":0,"before":1793425457238,"after":1793425487121} boot c149e53c-… took 59 ms` | expected — with a named host group of gid 10001 the unprivileged container reads status, sets the host clock (after − target = 2 ms) and sees the host's boot id |
| M6 | [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | `without the bind: unavailable ENOENT … took 2 ms` | expected |
| M7 | — | not run: Docker Desktop not answering on 2026-10-31 | — |
| M8 | [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | `M8: not measured (no file /var/lib/systemd/timesync/clock on this runner)` | not measured — the runner runs chrony, not timesyncd; Task 19's backlog entry asks for it on a real box (Task 1, step 2) |
| M9 | [41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824) | `systemd-analyze verify rc=0 output: <none>`; `a 60-second instance under RuntimeMaxSec=15 ended after 15 s (state failed)` | the kill: expected. The verify line is no evidence: it accepted the numeric `SocketGroup=10001` that M5's start refused, so `verify` does not resolve the group. The failing case M9 was there to catch is M5's |
| M5′ (Task 4) | | | |
| M7′ (Task 4) | | | |
| M8′ (Task 4) | | | |
| M9′ (Task 4) | | | |
| M10′ (Task 4) | | | |

## Decisions the build follows

1. **The host service** `waitron-box`: a socket unit `deploy/box/waitron-box.socket`
   (`ListenStream=/run/waitron-box/box.sock`, `Accept=yes`, `SocketMode=0660`, `SocketUser=root`,
   `SocketGroup=waitron-box`, `MaxConnections=4`) and a template `deploy/box/waitron-box@.service`
   (`StandardInput=socket`, `StandardOutput=socket`, `StandardError=journal`, `RuntimeMaxSec=15`,
   `ExecStart=/usr/local/lib/waitron/waitron-box.sh %i`,
   `ExecStopPost=/usr/local/lib/waitron/waitron-box.sh --restore %i`) running as root: one
   request line in, one JSON line out. `StandardError=journal` because the default, `inherit`,
   would send `timedatectl`'s and `systemctl`'s error lines down the socket ahead of the answer,
   and the client would read `malformed` (round 2, I5). `ExecStopPost=` is the backstop of
   decision 3's `trap`: it starts again a time service the instance stopped, after any end of the
   instance — a kill at `RuntimeMaxSec` included (systemd.service(5), not read for this plan; M10′
   measures it). A power cut needs no backstop: the unit was only stopped, never disabled, so the
   next boot starts it. Install puts the handler at `0755` and the two units at `0644`, all
   `root:root` (round 2, I5). Installed by `waitron.sh install` (a host without systemd prints a
   line and install carries on); B3's image installs the same files (and must keep or migrate
   their wire format: "Where the outline was wrong", item 3). The app container mounts
   `/run/waitron-box` (the directory, so a re-created socket is seen) **only when `.env` names
   it**: compose reads `${WAITRON_BOX_SOCKET_DIR:-box_socket}:/run/waitron-box`, so with nothing
   in `.env` it mounts an empty named volume and the client answers unavailable. Install writes
   `WAITRON_BOX_SOCKET_DIR=/run/waitron-box` only once the socket is listening, and removes it when
   it is not — the pattern `load_print_agent_apparmor` uses (`deploy/waitron.sh:217-234`). That is
   the outline's M7 fallback: a laptop or Docker Desktop never names `/run`. The handler's own
   state (the per-instance "stopped unit" marker, the set lock) lives in `/run/waitron-box-state/`,
   created `0700 root`, never in the mounted folder: a marker the app could write would let it
   name a unit for root to start.
   **The socket's group is a named host group, `waitron-box`, of gid 10001** (revision 3, from
   M5 and M5b): systemd refused to start a socket whose `SocketGroup=10001` names no host group
   (`Failed to resolve group 10001: No such process`, `status=216/GROUP`), and started it with
   `root:waitron-box` once the group existed, after which the container's uid and gid 10001 read
   and set the clock. Install makes the group: when `waitron-box` exists with gid 10001 it is used;
   when neither the name nor gid 10001 exists it runs `groupadd --system --gid 10001 waitron-box`;
   when `waitron-box` exists with another gid, or gid 10001 belongs to another group, install
   prints one line naming what the box cannot do and installs no service (as when `systemctl` is
   missing). It never reuses another group's gid: that group's members would gain a socket that
   sets the clock. Reset and a re-install leave the group alone.
2. **`clock.status`** answers `{"ok":true,"service":"on"|"off"|"stopped","unit":<name>|null,
   "synchronised":bool,"lastSyncAt":<ms>|null,"nowMs":<ms>}` — `off` when `NTP=no`, `stopped` when
   `NTP=yes` and no listed unit is active, `on` otherwise; `lastSyncAt` the mtime of
   `/run/systemd/timesync/synchronized`.
3. **The handler reads one line, bounded**: `read -r -t 5 -n 701`, and a line of more than 700
   characters read, or none within 5 s, answers `request_invalid`. `-n 700` could not tell: lines
   of 700 and 701 characters both read 700 with status 0; with `-n 701` a line of 700 reads 700,
   one of 701 or 702 reads 701, each with status 0 (bash 3.2.57 on this Mac, 2026-10-31; Task 2's
   tests run both lengths on the runner's bash). **`clock.set <epochMs>
   <requester>`** refuses (`{"ok":false,"reason":…}`) a target that does not match
   `^[1-9][0-9]{12}$` (`target_invalid`; bash reads a leading zero as octal —
   `t=037000000000000; echo $(( t / 1000 ))` printed `2130303778`, 2037-07-04, and
   `t=0370000000009` stopped with "value too great for base", both run on this Mac's bash 3.2.57
   on 2026-10-31 — so the pattern refuses it and every sum is written `10#$t`), before
   2024-10-28T00:00:00Z or from 2100-01-01T00:00:00Z on (`target_invalid`; the server's own check
   of the first issue date is in the venue's offset, this is only a range), while
   `NTPSynchronized=yes` (`synchronised`), or with a requester that is not one line of printable
   ASCII from `{` to `}` of at most 512 bytes (`requester_invalid`); the server sends ids only,
   never a name. The requester is never evaluated: it reaches `logger` as one quoted argument, so
   `$(…)`, a backtick or `;` inside it is logged as written and runs nothing. A second set while
   one runs answers `busy` (an `flock -n` on `/run/waitron-box-state/set.lock`). Otherwise it
   writes the marker `/run/waitron-box-state/stopped.<instance>` naming each active listed unit,
   stops them with `systemctl stop` (runtime only, decision 1), sets
   `@<seconds>.<milliseconds>` (the target plus the time since the request arrived, by
   `/proc/uptime`; the fraction form is M3's), touches `/var/lib/systemd/timesync/clock` to the new
   time when it exists (M8), starts the units again with `systemctl start` and removes the marker
   — the start and removal also from a `trap` on every exit, so after a failed set too — and
   answers `{"ok":true,"beforeMs":…,"afterMs":…}`; `set_failed` when `set-time` fails. `--restore
   <instance>` (decision 1's backstop) starts only a unit that its marker names AND that is on the
   `ntp-units.d` list (or is M1's unlisted unit), then removes the marker. One
   `logger -t waitron-box` line names the target and the requester. Any other line answers
   `unknown_request`. If M1 printed an active unlisted unit, the handler stops and starts that unit
   by name as well.
4. **The server's client** (`apps/server/src/box-host-client.ts`): `clockStatus()` (2 s) and
   `setClock({ targetMs, requester })` (20 s — longer than the host's `RuntimeMaxSec=15`, so the
   host's own limit ends a stuck set first and the client reads its answer or the closed
   connection; round 2, minor 2); a missing socket, a refusal, a malformed reply or a timeout
   answers `{ available: false, reason }`, never a throw. A timed-out set is still verified by the
   correction (decision 6): the clock may have moved.
5. **The time service is watched.** `checkTimeHealth` reads `clockStatus()` instead of running
   `timedatectl` itself, keeping its answer's shape (`synced`, `source`, `warn`): `source:
   "timedatectl"` stays true, since the host reads `timedatectl`. Both `/api/box/health` and
   `/api/box/status` read it through one 60-second cache. `clock.sync_off` (warning, area `box`,
   `system.manage`, `screen: "box-status"`, params `{ reason }`, reasons `off`, `stopped`,
   `unsynchronised`, `unreachable`) is an ongoing alert source over the same cached status;
   `unreachable` only when `config.environment === "production"`. Its `unreachable` words follow
   decision 13.
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
   Never while `clockStatus()` says synchronised; never when the host service is unavailable.
   **Each set carries where its offset was measured** (round 2, C1): `measuredAt: { wallMs,
   monoMs }`, the box's wall and steady clocks when the witness's reading arrived (the store's
   `BoxClockReading`; the store gains `forSetting()`, handing out each settable reading WITH its
   `at`, AEAT's kept disagreements now stored with theirs), and `stepsSeen`, the correction's step
   counter when the caller measured. The counter rises once for every `clock.set` sent to the host,
   whatever its answer. The target is the wall clock now plus the offset — valid only while no
   step has happened since `measuredAt`.
   **Order (round 1, M7; round 2, C1, I2), each step tested in order:** take the one-at-a-time
   turn — the same turn the watch's two confirmation writers (`confirm` and `closeWaiting`) and
   `POST /api/box/clock-confirm` now take, so no confirmation lifts or closes the stop between the
   judging below and the row. **The turn is always taken before the write lock, never inside it**
   (claim check, 2026-10-31): `withTransaction` is a `db.withWriteLock` turn
   (`packages/db/src/tenancy.ts:30-39`), so a caller that waited for the turn inside a
   transaction would hold the lock while the set, holding the turn, waits for the lock in its
   `read` — neither would finish. So every user wraps its WHOLE transaction in the turn: the
   route's `withTransaction` (`apps/server/src/box-health-api.ts:269`), the watch's whole
   `deps.transaction` in `confirm` (`clock-watch.ts:156`) and in `closeWaiting` (`:192`; its
   AEAT question, `:190`, stays outside the turn, so no network wait holds it); refuse `stale`
   when `stepsSeen` is not the counter now, or when the wall clock has moved against the steady
   clock by more than a second since `measuredAt` (a step by the time service or by hand); judge
   the stop again in a write-lock turn with no drain (the stop proper or `clock.unusable` at a
   fresh reading, else `not_stopped`; for `admin`, also `witnessed`); read `clockStatus()` fresh;
   tell every registered anchor that a set is coming (the clock watch's `stepComing` first records
   every AEAT reading not yet taken as it would at the end of a look — `takeNewAuthority`, then its
   pending disproofs in their own transaction — so no reading measured on the old clock is left to
   disprove the lift this set writes; if that write fails, the set is refused `pending_disproofs`
   and nothing is asked of the host); read wall and boot clocks; raise the step counter; ask the
   host; read both again; verify `|wallAfter − (target + (bootAfter − bootBefore))| ≤ 2 000`;
   re-anchor every anchor (also when the host refused or timed out) — `reanchor()` returns a
   promise, and the watch's first takes and records again every AEAT reading not yet taken, as
   `stepComing` does, because a filing reply noted while the host was setting (up to the client's
   20 s) was measured on the old clock and `clear()` keeps untaken readings
   (`clock-witnesses.ts:34-36`, `:116-120`); if that write fails, the row is kept pending
   (decision 8) rather than written now; clear the witness store; then
   write the row (decision 7) and the alert in one transaction, and hand the alert to the email
   duty (decision 9).
   **Backoff** (round 2, I3): after a set that the host refused (`set_failed`, `busy`), that timed
   out or that did not verify, the watch asks for no automatic set in the same stop (the open
   check's id; for `clock.unusable`, the boot id) for 10 minutes by the steady clock, doubling
   after each further failure up to 4 hours; a new stop starts again at none. Refusals that ask
   nothing of the host (`synchronised`, `host_unavailable`, `stale`, `not_stopped`) are not backed
   off: they toggle nothing. An administrator's set is never held back by it.
7. **The row** (seat method `confirmClockStep`, Task 8): one `clock_confirmations` row,
   `box_clock_at` the reading before, `confirmed_at` the reading after, `step_ms` the measured step
   (`(wallAfter − wallBefore) − (bootAfter − bootBefore)`, rounded), `source` the witness's
   (`authority`, `devices`, `admin`), `person_id` for `admin`, `proof` the witnesses that set it
   plus `step: { beforeAt, afterAt, stepMs, targetAt }` and, for a stop, `heads` and `closing` as
   slice 9 writes them. For the clock-behind stop: it closes the open check (opening one at the
   before reading first if none is open, as `confirmClockStop` does,
   `clock-confirmation.ts:193-203`); if the after reading is still more than a minute behind the
   latest record it names that record (a lift, `clock.behind_chain_restarted`), otherwise it names
   none; `clock.records_misdated` through `recordMisdated` as every closing does. **With no stop
   at the before reading** (the turn makes this unlikely, but real time can still pass the record
   between the judging and the row): `openClockCheck` answers null there
   (`packages/fiscal-verifactu/src/clock-checks.ts:238-239`), so `confirmClockStep` never writes
   `opened!` as `confirmClockStop` does (`clock-confirmation.ts:196-200`); it closes an open check
   if there is one, and otherwise writes the row with `check_id` null, no record named and nothing
   listed — the clock did move, so the row and `clock.corrected` are still written. For
   `clock.unusable`: `reason: "unusable"`, `check_id` null, no record named, nothing listed (no
   record can be written before 28-10-2024). Always `clock.corrected` (decision 9). A set that
   failed verification writes no row and records `clock.corrected` with `verified: false` and the
   measured step, when the clock moved by more than a second.
8. **A step whose row could not be written** (a full disk, or an anchor whose `reanchor()` write
   failed) is kept in memory and written on the watch's next look, as the watch keeps disproofs
   (`clock-watch.ts:79-117`), and only after that look's first `recordPending()` has succeeded, so
   a disproof measured on the old clock is always written before the step's row; a restart loses
   it, and the host's journal line remains. Logged `clock_correction.row_pending` once.
9. **`clock.corrected`** params `{ confirmationId | null, source, person | null, before,
   beforeOffsetMinutes, after, afterOffsetMinutes, stepMs, verified }`, severity warning, no sale.
   Recording it first marks any open `clock.corrected` handled by the system
   (`markIncidentHandled`, person null). Claimed by the Veri\*Factu module
   (`{ prefix: "clock.corrected", area: "box", permission: "system.manage" }` beside its two clock
   claims, `packages/fiscal-verifactu/src/alerts.ts:13-14`; the server resolves the longest prefix,
   `apps/server/src/alerts.ts:41-42`, so `packages/db`'s `clock.` claim does not take it).
   **Emailed once per incident, even when a later step has already marked it handled** (round 2,
   I3). The duty reads only OPEN alerts of `INCIDENT_EMAIL_CODES`
   (`apps/server/src/box-alert-email.ts:144-156`) once a minute (`BOX_EMAIL_CHECK_MS`, `:159`), and
   ends an alert's episode as soon as the alert is no longer open (`:358-362`), so a step marked
   handled by a second step within the minute would never be emailed. So: `INCIDENT_EMAIL_CODES`
   gains `clock.corrected`; `startBoxEmailDuty` gains `remember(incident: EmailedIncident)`,
   which begins that alert's episode at once, with no read; the correction calls it after the
   step's transaction commits; and a `clock.corrected` episode ends only once every recipient has
   been sent it (or there are none, or email is not configured — the duty's existing `sayOnce`
   lines), whether or not the alert is still open. Every other code keeps today's rule. Limit,
   stated in the code and the guide: a restart before the email is sent loses it for an alert
   already handled; the alert itself stays in the bell's Handled list and the host's journal line
   remains.
10. **The administrator's set** is a third route, `POST /api/box/clock-set`, `person.admin`, the
    same challenge (`clock-challenges.ts`) and the same on-the-box refusal. Refusals are
    `clock.set_refused { reason }` (409), judged in this order so that each says what is true
    (round 2, I4): `same_machine`; `not_stopped` (no stop proper and no `clock.unusable`);
    `host_unavailable`; `synchronised`; `witnessed` (AEAT or a group of devices has spoken during
    the stop, and the box can set its clock: it sets or confirms from them itself); `agrees` (the
    device is within a minute: confirm instead); `stale` (the clock stepped while the request was
    in flight: read the time again). `clock.check_expired` (400) as today; a failed or unverified
    set is `clock.set_failed { reason: "refused" | "unverified" }` (502). No transaction is held
    while the host sets.
11. **Every job that reads the wall clock** is made safe for a step of days, or accepted with a
    reason (round 1, I5), in Tasks 14, 15, 15a and 15b: backups pruned by the age in their names;
    the stream's generation pruning; management sessions (the lead's ruling (d)) and passkey
    challenges whose stored time is ahead of the clock; a shift begun before a backward step; then
    whatever the audit's greps find (Task 15's table). The STOP rule covers a job that deletes data,
    keeps a credential alive past its limit, cuts tills off, or blocks a legal record (round 2, I7).
12. **What 9c inherits:** the anchor registration of decision 6 (9c's change guard registers
    beside the watch); `confirmClockStep` taking any open check's reason (9c's `start`, `change`,
    `disagrees`); `clock.sync_off`'s `unreachable` (9c's alert-not-stop case, design §4.9 h.2).
    9b opens no check of its own and adds no stop.
13. **A deliberate deviation from design §4.9 h.2: no install instruction** (the lead's ruling (b);
    round 2, I8). The design says "`clock.sync_off` says to re-run the install"
    (`docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md:1227-1229`), and 9c's
    outline repeats it (its FYI 5). The box's operator has no terminal, so that sentence sends them
    to whoever installed the box, which CLAUDE.md §3's refusal rule forbids. The state is not one
    only a fault in Waitron can produce — `deploy/README.md:170` documents
    `docker compose pull && docker compose up -d` as an update, which does not run install — so the
    rule's fault exception does not apply. The words for `clock.sync_off` `unreachable` and for the
    `host_unavailable` refusal say what happened and the one step the person can take themselves:
    "This box cannot read or set its own clock: the part of its install that does that is not
    answering. If the box can reach the internet, its own time service may still put the clock
    right by itself. An administrator can still confirm the clock when it is right." (Spanish to
    match, Tasks 7 and 13.) `deploy/README.md`, read by whoever installs, keeps the install line
    (Task 18). This plan's commit updates 9c's outline to match.

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

8. `apps/server/src/clock-witnesses.test.ts` and `clock-watch.test.ts`: none of their assertions
   changes; the store's new `forSetting()` and the kept disagreements' new `at` are covered by new
   cases (Task 11). Listed so the review checks it.

**Must pass unedited:** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (the golden huella),
`inmutabilidad.test.ts`, `apps/server/src/boot.box-health.test.ts:209-224` ("caches the clock check
and the disk walk for a minute…", which mocks `checkTimeHealth` by name: the name stays), every
`clock-confirmation*`, `clock-checks*`, `clock-behind*`, `clock-misdated*` and `clock-confirm.route`
test, `apps/server/src/box-alert-email*.test.ts` (every other code keeps today's episode rule),
every suite under `packages/workforce/src` and `packages/workforce/test` (Task 15a), every
`apps/server/src/till-clock*`, `attendance-discovery*` and `boot.till-clock` suite (Task 15b), and
every other test on `main`.

## Global constraints

- **The fiscal core is untouched**: `computeHuella`, the hash chain (`chain.ts`), `registro-row.ts`,
  invoice-number and series allocation, `registros_facturacion` and its triggers, `recordSale`,
  `recordCorrection`, `recordSubstitution`, A679's `hour-*.ts`. After every task touching
  `packages/fiscal-verifactu`, `packages/fiscal` or `packages/core`:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  passes, and this prints nothing:
  ```bash
  git diff main -- packages/fiscal-verifactu/src/chain.ts \
    packages/fiscal-verifactu/src/write-path.e2e.test.ts \
    packages/fiscal-verifactu/src/inmutabilidad.test.ts \
    packages/fiscal-verifactu/src/registro-row.ts packages/core/src \
    'packages/fiscal-verifactu/src/hour-*' ':!packages/core/src/*.test.ts'
  ```
  **If a task finds it needs to change any of these, it STOPS there** and the lead reports.
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
   `if: always()` that starts again the unit M1 found (the script writes its name to
   `$RUNNER_TEMP/time-unit`): `sudo timeout 60 systemctl start "$(cat "$RUNNER_TEMP/time-unit")";
   timedatectl show -p NTP -p NTPSynchronized`.
2. The script (`set -euo pipefail`, every external command under `timeout`), printing one block
   per row of the measurement table, each line prefixed `M<n>:` with the raw values first and then
   `expected` or `FAILING CASE`. M5's handler is five lines written by the script into
   `/run/waitron-box-measure/` with units under `/run/systemd/system/` (runtime only; removed at the
   end): `clock.status` answers `timedatectl show -p NTPSynchronized --value`, `clock.set` runs
   `systemctl stop <unit>`, `set-time`, `systemctl start <unit>`. The container: `timeout 180 docker
   run --rm --user
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
   The measurement workflow is removed as soon as its last measurement is copied (Task 4)." Watch
   the `measure` job
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
`timedatectl`, `systemctl`, `touch`, `stat`, `logger`, `date`, `flock`, put first on `PATH`; the
uptime, the two timesync paths and the state folder overridable through `WAITRON_BOX_UPTIME`,
`WAITRON_BOX_TIMESYNC_CLOCK`, `WAITRON_BOX_TIMESYNC_SYNCHRONIZED` and `WAITRON_BOX_STATE_DIR` test
variables, as `WAITRON_SH_BLUETOOTH_DROPIN` is, `deploy/waitron.sh:245-248`). Each stub logs its
arguments to a file. The leading-zero cases below pass on any bash, because the pattern refuses
the target before any sum reads it.

**Failing tests first** (`pnpm exec vitest run scripts/waitron-box-sh.test.mjs`, red for "no such
file"):
- `clock.status` with `NTP=yes`, synchronised, a listed active unit → the exact JSON of decision 2;
  with `NTP=no` → `service: "off"`; with `NTP=yes` and no listed unit active → `"stopped"`; no
  `synchronized` file → `lastSyncAt: null`.
- `clock.set` refusals, each answering its reason and calling no `systemctl stop` and no
  `timedatectl set-*`: a target with letters; `037000000000000` and `0370000000009` (leading
  zeros: `target_invalid`, not 2037 and not a shell error); `1730073599999` (one ms before
  2024-10-28T00:00:00Z); `4102444800000` (2100-01-01T00:00:00Z); `NTPSynchronized=yes`; a
  requester with a control character; one of 513 bytes; one not wrapped in braces. Controls that
  go through: `1730073600000`, `4102444799999`, and a requester of exactly 512 bytes.
- The read is bounded: a line of 701 characters → `request_invalid`; the control, a `clock.set`
  line of exactly 700 characters (a valid target, its requester too long), → `requester_invalid`,
  not `request_invalid` (no valid request is 700 characters long); no line within the test's
  shortened limit → `request_invalid` (the limit read from `WAITRON_BOX_READ_SECONDS`, 5 when
  unset).
- A requester `{"x":"$(touch <marker>)`;`touch <marker>`;"}` (within the charset) goes through: the
  `logger` stub received it verbatim as one argument, and `<marker>` does not exist afterwards.
- A valid set calls, in order, `systemctl stop <unit>` (never `set-ntp`), `set-time
  @<seconds>.<milliseconds>`, `touch -d @<seconds>.<milliseconds> <clock file>`, `systemctl start
  <unit>`, and answers before and after; the marker file exists between the stop and the start and
  not after; the `logger` line names target and requester. `timedatectl set-ntp` appears nowhere
  in the stub log of any case.
- A `set-time` that fails still calls `systemctl start <unit>` and answers `set_failed`; a handler
  killed with `SIGTERM` after the stop still calls it (the `trap`); `--restore <instance>` with a
  marker naming a listed unit starts it and removes the marker, and with a marker naming an
  unlisted unit (say `ssh.service`) starts nothing.
- A second set while the lock is held (the `flock` stub answering busy) → `busy`, no stop.
- An unknown first word answers `unknown_request`; an empty line too.
- The socket and service files, read as text: `Accept=yes`, `SocketMode=0660`,
  `SocketGroup=waitron-box`, `RuntimeMaxSec=15`, `StandardInput=socket`, `StandardError=journal`, and an
  `ExecStopPost=` running the handler with `--restore %i`.

**Deletion controls.** Remove the `synchronised` refusal → its case fails; remove the `trap` → the
kill case fails; remove the range check → the 2100 case fails; drop the leading-zero pattern
(keep only the range) → the `037000000000000` case fails; drop the more-than-700 check (keep
`-n 701`) → the 701-character case fails; drop the restore's list check → the `ssh.service`
case fails. Restore each.

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
  and carries on; the host group (decision 1): with no `waitron-box` and no gid 10001 the
  `groupadd` stub is called with `--system --gid 10001 waitron-box` before `enable`; with
  `waitron-box` at gid 10001 no `groupadd` is called; with `waitron-box` at gid 10002, and with gid
  10001 named `staff2`, no `groupadd`, no unit installed, no `enable`, one printed line, and the
  variable unset; reset leaves the service and the group alone; a production `--reset install` refused before
  touching it (as the time-sync case at `:1267` does). The installed files: the handler mode
  `0755`, both units `0644` (read with `statSync` in the override directory), and the `install`
  stub's log shows `-o root -g root` for all three (a test cannot chown to root without root).
- `scripts/deploy-image-env.test.ts`: the app's bind reads `${WAITRON_BOX_SOCKET_DIR:-box_socket}`
  and `box_socket` is declared; no `cap_add`, no `SYS_TIME`, no `/dev/rtc` anywhere in
  `deploy/compose.yml`.

**Deletion controls.** Remove the `env_set` → the `.env` case fails; make it unconditional → the
"enabling fails" case fails; install the handler `0644` → the mode case fails; drop the check that
gid 10001 is free → the `staff2` case fails.

**Focused commands.** `pnpm exec vitest run scripts/waitron-sh.test.mjs -t "host service"`;
`pnpm exec vitest run scripts/deploy-image-env.test.ts`; then each file whole, since a name-filtered
run does not load its other cases.

### Task 4: Measure the shipped files on the runner

**Goal.** Run the files Tasks 2–3 wrote on Linux: M5′ (M5 against `deploy/box/` installed by the
script instead of the throwaway handler, its host group made by the same `groupadd --system --gid 10001
waitron-box` install's step runs — `waitron.sh` cannot be sourced, it ends `main "$@"`
(`deploy/waitron.sh:800`), so the step's group rule is tested in Task 3, not here; `systemd-analyze verify` does not resolve the group,
M9's row, so the socket's start is the evidence), M8′ (M8 through the shipped handler), M9′
(`systemd-analyze verify` of the shipped units, and `systemctl show -p StandardError
waitron-box@measure.service` answering `journal`), M7′ (`docker compose -f deploy/compose.yml
config --format json` with and without `WAITRON_BOX_SOCKET_DIR=/run/waitron-box`, printing the
app's `volumes`: a named `box_socket` volume without, a bind of `/run/waitron-box` with) and M10′
(the backstop: a runtime drop-in written by the script, under `/run/systemd/system/`, replaces
only the shipped instance's `ExecStart=` with three lines that stop `<unit>`, write the marker as
the handler does and `sleep 60`, keeping the shipped `ExecStopPost=`; the instance is killed at
`RuntimeMaxSec=15` — no test switch is added to the handler itself; *expected:* `systemctl is-active
<unit>` answers
`active` within 5 s of the kill and the marker is gone; *failing:* the unit stays stopped — the
`ExecStopPost=` backstop does not run on a kill, a new decision).

**Files.** Modify `scripts/host-clock-measure.sh` (a `--shipped` part, run by the same job after the
first part). Tasks 2 and 3 are pushed with this task's change; the script and `deploy/box/**` are
both in the workflow's `paths:`, so the push runs the job.

**Failing test first.** None in Vitest: this task's check is the job. Before pushing, `bash -n` the
script. The STOP rule of Task 1 applies to M5′, M8′, M9′ and M10′; M7′'s failing case (the bind
present with no variable set) sends Task 3 back.

**Steps.** Push; read the job; fill the five rows. Then, in the same commit as the table,
`git rm .github/workflows/host-clock-measure.yml` (the measurement section says why: every later
push would run it again) and run `pnpm exec vitest run scripts/ci-workflow.test.mjs`, which must
still pass; the script stays. After that commit, no push on this branch runs the job.

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
The default path is `/run/waitron-box/box.sock`; no environment variable. The defaults are
`statusMs: 2_000` and `setMs: 20_000` (decision 4). `StartServerSeams` gains
`boxHost?: BoxHostClient` (`apps/server/src/boot.ts:836-845`) so boot tests never touch a socket.

**Failing tests first**, each against a real `net.createServer` on a socket in `mkdtemp`:
`clockStatus` parses decision 2's JSON; a missing socket → `missing` within 50 ms; a server that
never answers → `timeout` at the 2-second limit (fake timers are not used: the limit is passed as
200 ms in the test); a reply that is not JSON, or JSON of the wrong shape → `malformed`; a reply
over 4 KiB → `malformed` and the connection closed; `{"ok":false,"reason":"synchronised"}` →
`refused` with `refusal: "synchronised"`; `setClock` writes exactly `clock.set <ms> <json>\n` with
a requester of ids only and answers before and after; a `targetMs` that is not a safe integer
answers `malformed` without connecting; a reply preceded by a line that is not the answer (what
`StandardError=inherit` would have put first) → `malformed` (the handler side of that is Task 2's
unit-file case and M9′). A case asserts the default `setMs` is 20 000, above the unit's
`RuntimeMaxSec=15`. Control: the happy path of each.

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
`apps/dashboard/src/i18n/alert-messages.ts` (English and Spanish per reason; `unreachable` in
decision 13's words — no install instruction),
`scripts/ongoing-alert-codes.test.ts` (changed test check 3).

**Failing tests first.** Source: `on` and synchronised → no alert; `off`, `stopped`,
`unsynchronised` (service `on`, not synchronised) → one warning each with its reason, `screen:
"box-status"`; unavailable with `production: true` → `unreachable`; unavailable with `production:
false` → none. `scripts/ongoing-alert-codes.test.ts` fails until the file is listed and the words
exist. The dashboard's alert-messages test: each reason worded in both languages, and the
`unreachable` words in either language contain neither "install" nor "instal" (decision 13).

**Deletion controls.** Drop the `production` check → the laptop case fails; drop the file from the
guard's list → the guard stays green (it hand-lists files): this is the guard's known weakness
(`docs/developers/conventions-data.md:90-95`), stated, not a control.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/clock-sync-alert.test.ts`;
`pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/errors-reachable.test.ts`;
`pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`.

### Task 8: The seat records a step of the clock, and the bell words it

**Goal.** Decisions 7 and 9, in the Veri\*Factu module, without touching the fiscal core; and the
bell's words for `clock.corrected` in the same task, since `scripts/alert-codes.test.ts`'s "every
recorded code, and alert.source_unavailable, has English and Spanish wording" (`:128`, reading
`ALERT_MESSAGES` at `:19`) is red from the moment the code is recorded until the words exist
(round 2, minor 3).

**Files.** Create `packages/fiscal-verifactu/src/clock-step.ts` and `clock-step.test.ts`; modify
`packages/fiscal/src/backend.ts` (`ClockStepRequest`, optional `confirmClockStep?(tx, input):
Promise<{ confirmation: ClockConfirmation | null }>` beside `confirmClockStop` at `:367-374`),
`packages/fiscal-verifactu/src/clock-stop-incidents.ts` (`recordCorrected`, already a listed
incident source in `scripts/alert-codes.test.ts:24-43`), `packages/fiscal-verifactu/src/alerts.ts`
(the claim), `packages/fiscal-verifactu/src/errors.ts` (`"clock.corrected"` params, beside
`clock.behind_chain_restarted` at `:378`), the seat's wiring (`backend.ts` of the Veri\*Factu
module), `packages/fiscal-none/src/backend.test.ts`,
`packages/fiscal/src/testing/fake-backend.test.ts`
(changed test checks 2 and 4), and `apps/dashboard/src/i18n/alert-messages.ts` with its test
(English and Spanish, one sentence per source, naming the person for `admin`, before and after in
the venue's offset, and the step in words — "moved forward 2 days 3 hours" / "adelantado 2 días y
3 horas"; a `verified: false` variant saying the box asked for the change and could not confirm
it took).

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
- No stop at the before reading (the latest record not ahead of it) and no check open: no throw;
  one row with `check_id` null, `registro_id` null, nothing listed; one `clock.corrected`
  (decision 7, round 2 C1). Control: the same call with the stop holding opens a check.
- `reason: "unusable"`: a row with `check_id` null, `reason "unusable"`, no record named, no
  `clock.records_misdated`, one `clock.corrected`.
- `verified: false`: no row; `clock.corrected` with `confirmationId: null`, `verified: false`.
- A second step while the first `clock.corrected` is open: the first is handled by the system
  (person null), the second open; two incidents in all.
- `admin` source: `person_id` the person; the row's person CHECK satisfied; without `admin`,
  source `admin` is refused by the CHECK (control for the CHECK's reach).
- The golden huella and `inmutabilidad` pass; the `git diff` of the global constraints prints
  nothing.

- `scripts/alert-codes.test.ts` passes with the words; the bell's "never breaks a written time
  across two lines" cases (`apps/dashboard/src/widgets/alerts-bell.test.ts:171-200`,
  `apps/dashboard/src/screens/alerts-screen.test.ts:91-124`) pass unedited.

**Deletion controls.** Store the before reading as `confirmed_at` → the lift-cover case fails;
drop the `markIncidentHandled` → the second-step case fails; drop the `unusable` branch's skip of
`recordMisdated` → the unusable case fails; use `openClockCheck(…)!` as `confirmClockStop` does →
the no-stop case throws.

**Focused commands.**
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-step.test.ts
src/alerts.test.ts`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
src/write-path.e2e.test.ts`; `pnpm --filter @waitron/fiscal-none exec vitest run
src/backend.test.ts`; `pnpm --filter @waitron/fiscal exec vitest run
src/testing/fake-backend.test.ts`; `pnpm exec vitest run scripts/alert-codes.test.ts
scripts/errors-reachable.test.ts scripts/no-till-as-issuer.test.ts`; `pnpm --filter
@waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/widgets/alerts-bell.test.ts
src/screens/alerts-screen.test.ts`.

### Task 9: `clock.corrected`'s email, never lost to a later step

**Goal.** Decision 9's email half (round 2, I3).

**Files.** `apps/server/src/box-alert-email.ts` (`INCIDENT_EMAIL_CODES` gains `clock.corrected`;
`wordsFor` and `TIME_PLACEHOLDERS` gain `before` and `after`; `startBoxEmailDuty` answers
`{ stop, remember }`; a `clock.corrected` episode ends only once every recipient has it),
`apps/server/src/i18n/box-emails.ts` (`CLOCK_CORRECTED_EMAIL_WORDS`),
`apps/server/src/box-alert-email.test.ts`, `apps/server/src/box-alert-email.duty.test.ts`,
`apps/server/src/boot.ts` (the duty's `remember` handed to the correction as `onCorrected`).

**Failing tests first.** The email: each source's exact English text with both times in their
offsets; Spanish read from `box-emails.ts`; a step of exactly one day and one of 400 days worded;
no `{` left in any text. The duty (`box-alert-email.duty.test.ts`'s pattern, fake timer and fake
reads):
- a `clock.corrected` open on one check is emailed once;
- **two steps within one check interval**: `remember(first)`, then the first marked handled and
  `remember(second)`, then one check whose read answers only the second → both emailed, each once;
- a remembered `clock.corrected` whose send fails, then handled before the next check → sent on
  the next check, then never again;
- with no recipients, a remembered one is dropped after its `box_email.no_recipients` line;
- control, unchanged behaviour: a `clock.records_misdated` handled before it was sent is not sent
  (today's rule, `:358-362`).
`INCIDENT_EMAIL_CODES` whole-list assertions: `/usr/bin/grep -rn 'INCIDENT_EMAIL_CODES'
apps/server/src --include='*.test.ts'` printed nothing on `65bc0441a`; re-run it here and list any
it finds as changed test check 5.

**Deletion controls.** End `clock.corrected` episodes when not open again (today's rule) → the
two-steps case loses the first; drop the `remember` call in the correction → the same case fails
from Task 10's side (`onCorrected` asserted called once per step).

**Focused commands.** `pnpm exec vitest run scripts/alert-codes.test.ts`;
`pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts
src/box-alert-email.duty.test.ts`.

### Task 10: Setting the clock — the order, one at a time, verified

**Goal.** Decisions 6–8, and the owner question's switch. The turn's other users (the watch's
confirmation, the confirm route) join it in Tasks 11 and 12.

**Files.** Create `apps/server/src/clock-correction.ts`, `clock-correction.test.ts`; modify
`apps/server/src/errors.ts` (`clock.set_refused`, `clock.set_failed`).

**Interface.**
```ts
export const DEVICES_MAY_SET_BACK_PAST_LAST_SALE = true; // owner, 2026-10-24 04:24
export function devicesMaySet(input: { targetMs: number; stepMs: number;
  latestRecordAt: number | null; rule: boolean }): boolean;
/** Both may write (the watch records its pending disproofs). A throw from `stepComing` refuses
 * the set; a throw from `reanchor` keeps the step's row pending (decision 8). */
export interface ClockAnchor { stepComing(): Promise<void>; reanchor(): Promise<void> }
export function clockCorrection(deps: {
  host: BoxHostClient; backend: Pick<FiscalBackend, "confirmClockStep" | "clockStopState">;
  store: Pick<ClockWitnessStore, "clear">; clock: Pick<TrustedClock, "now">;
  wall?: () => number; monotonic?: () => number; boot: Pick<BootReader, "readBoot">;
  /** A write-lock turn with no drain, for judging the stop again inside the set's turn. */
  read: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  transaction: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  /** The email duty's `remember` (Task 9). */
  onCorrected?: (incident: EmailedIncident) => void;
  nodeId: string; log: Logger;
}): {
  addAnchor(anchor: ClockAnchor): void;
  /** The correction's step counter; a caller reads it when it measures its offset. */
  steps(): number;
  /** The one-at-a-time turn, which the watch's `confirm` and `closeWaiting` and the confirm
   * route also take. Taken before any transaction, never inside one (decision 6). */
  inTurn<T>(fn: () => Promise<T>): Promise<T>;
  set(input: { reason: "behind_chain" | "unusable"; source: "authority" | "devices" | "admin";
    offsetMs: number; measuredAt: { wallMs: number; monoMs: number }; stepsSeen: number;
    witnesses: readonly ClockWitness[]; admin?: ClockAdminConfirm;
    latestRecordAt: number | null; requester: Record<string, string | null> }):
    Promise<{ set: true; confirmationId: string | null; stepMs: number }
      | { set: false; reason: string }>;
  writePending(): Promise<void>;
};
```

**Failing tests first** (fake host, fake wall and boot clocks, a stub seat recording calls):
- The order: the stop judged (`clockStopState` in `read`), `clockStatus`, every anchor's
  `stepComing`, the readings, `setClock`, the readings, every anchor's `reanchor`, `store.clear`,
  `confirmClockStep`, then `onCorrected` — asserted as one list of calls.
- An anchor whose `reanchor` rejects (a full-disk write) → the clock set, no `confirmClockStep`
  now; the next `writePending()` writes the row once.
- Synchronised → `{ set: false, reason: "synchronised" }`, no `setClock`, no anchor told;
  unavailable → `host_unavailable`, the same; the stop no longer holding → `not_stopped`, the
  same; an anchor whose `stepComing` throws → `pending_disproofs`, no `setClock`, every anchor
  re-anchored.
- **Stale** (round 2, C1): `stepsSeen` one below `steps()` → `stale`, no host call; `measuredAt`
  from before a +5-second move of the fake wall clock with no steady-clock move → `stale`; the
  control, nothing moved → set.
- A target before 2024-10-28 or after 2100 → refused before the host is asked.
- Verification: the host moves the wall clock by the step → `verified: true`; by the step + 2 001
  ms → `verified: false`, no row asked for but `confirmClockStep` called with `verified: false`
  (the alert); the host answering `set_failed` with the clock unmoved → no seat call, `{ set:
  false, reason: "refused" }`; **the host timing out after moving the clock** (the fake host moves
  the fake wall clock by the step, then never answers; the client's limit passed short) →
  `confirmClockStep` called with `verified: false` and the measured step (round 2, minor 2);
  timing out with the clock unmoved → no seat call. Every one of these still re-anchors.
- **One at a time, two concurrent sets** (round 2, C1): an AEAT set and an administrator's set,
  both measured at `steps() === 0`, started together, the fake host still answering
  `synchronised: false` after the first set → the host sees exactly ONE `clock.set`; the second
  answers `stale`; the stub seat was asked for exactly one row. Control: the second started after
  the first has finished, with `stepsSeen` read afresh → it is judged on its own (here
  `not_stopped`, since the first lifted the stop in the stub).
- A seat transaction that throws a full-disk error → the step kept; `writePending()` on the next
  call writes it once; a second `writePending()` writes nothing.
- `devicesMaySet` with `rule: true` → true for a backward target before the latest record; with
  `rule: false` → false for that case and true for a forward one; the `set` path refuses a
  devices source with `devices_back_past_last_sale` only when the constant is false (test passes
  the rule through a test seam, not by editing the constant).
- The requester holds ids only: `{ source, check }` for automatic sets, `{ source: "admin", person:
  <uuid> }` for an administrator; a test asserts no `personName` reaches the host.

**Deletion controls.** Skip `reanchor` → the order case fails; drop the verification → the +2 001
case fails; drop the turn → the together case sees two sets; drop the step-counter check (keep
the turn) → the together case sees two sets (the host still unsynchronised); drop the stop
re-judging → the `not_stopped` case calls the host.

**Focused command.** `pnpm --filter @waitron/server exec vitest run src/clock-correction.test.ts`.

### Task 11: The watch as an anchor, and the store's settable readings

**Goal.** Decision 6's anchor half (round 2, C1, I2, minor 1); no set is asked for yet.

**Files.** Modify `apps/server/src/clock-witnesses.ts` (AEAT's kept disagreements stored with
their `BoxClockReading`; `forSetting()` hands out every reading `witnesses()` would, each with its
`at`, and only those with no step since — a kept disagreement included only while `fresh` holds
for it; `witnesses()` and its doc unchanged), `apps/server/src/clock-watch.ts` (the watch
implements `ClockAnchor`; when a `correction` dep is passed, BOTH its confirmation writers take
`correction.inTurn` around their whole `deps.transaction` — `confirm` (`clock-watch.ts:150-170`)
and `closeWaiting`'s `closeClockCheckByItself` (`:185-208`), which also closes a check and so
must not land between a set's judging and its row; `closeWaiting`'s `askAuthority()` stays outside
the turn; `recordPending` runs one call at a time), `apps/server/src/boot.ts` (create the
correction before `startClockWatch` at `:2437`, pass it, `correction.addAnchor(clockWatch)`).

**The anchor.** `stepComing()` sets a hold that skips the jump comparison on EVERY look until
`reanchor()` clears it — not only the next look, which a set still in flight would use up (round
2, minor 1) — and first takes every AEAT reading not yet taken (`takeNewAuthority`), keeps each
disagreeing one as a disproof as the end of a look does (`clock-watch.ts:290-297`), and records the
pending disproofs in their own transaction; a failed write throws, so the correction refuses the
set (`pending_disproofs`). `reanchor()` (a promise) does the same take-and-record first — a filing
reply noted while the host was setting was measured on the old clock, and `clear()` leaves it
untaken (`clock-witnesses.ts:34-36`) — then sets `previous` from fresh readings and clears the
hold whatever the write's outcome, and rejects if the write failed.

**One `recordPending` at a time** (claim check, 2026-10-31). Today it reads `pending[0]`, awaits
the write, then `shift()`s with no check that the head is still the entry it wrote
(`clock-watch.ts:105-109`); a `stepComing` or `reanchor` during a look runs a second copy. Read,
not run, with the write queue first come, first served (`packages/store/src/write-queue.ts:44-46`):
both copies write the head, and a copy's `shift()` can remove the next disproof while the other
copy is still writing it — so `stepComing` can return before that disproof is recorded, and if
its write then fails it is gone from `pending` and never recorded. Each call waits for the one
before it to settle (a promise chain that passes on neither the earlier call's value nor its
error), then runs as today.

**Failing tests first** in a new `apps/server/src/clock-watch.anchor.test.ts` (the existing
harness) and in `apps/server/src/clock-witnesses.test.ts` (new cases only):
- After `stepComing`, a +2-day move of the wall clock, then two looks before `reanchor` → no
  `jump` disproof on either; after `reanchor`, a further +2-minute move → one `jump` (control:
  without `stepComing`, the first move records one, today's behaviour, `clock-watch.test.ts`'s jump
  case).
- **A filing reply noted before a backward set** (round 2, I2): the stop proper holding, an AEAT
  reading noted through `noteAuthority` saying the box is a day ahead, not yet taken; then
  `stepComing` → the disproof is recorded at once, against the lifts that exist then; then the
  fake seat writes the set's lift with `confirmed_at` the after reading (a day back) and the next
  look records NO `clock.behind_chain_disproved` naming that lift. Control: the same reading noted
  AFTER `reanchor` and saying the new clock is wrong → disproved as today.
- `stepComing` with a seat whose `noteClockProvedWrong` throws a full-disk error → it throws.
- **A reply noted while the host is still answering** (claim check, 2026-10-31): the stop proper
  holding; `stepComing`; then an AEAT reading saying the box is a day ahead noted through
  `noteAuthority` while the fake set has not answered; the fake host answers, moving the clock a
  day back; `reanchor()` → the disproof is recorded before the fake seat writes the lift, and the
  next look records NO `clock.behind_chain_disproved` naming that lift. Control: the same reading
  noted after `reanchor` → disproved as today. `reanchor` with a seat that throws a full-disk
  error → it rejects, and the hold is cleared.
- **Two `recordPending` at once**: two disproofs pending, the seat's `noteClockProvedWrong` held
  on a promise the test releases; a look starts recording the first; `stepComing` is called
  during it → `stepComing` does not resolve before both are written; each is written exactly
  once, in order. The same with the second write failing (a full-disk error) → `stepComing`
  rejects and the second disproof is still pending, and the next look records it.
- **Turn, then lock** (claim check, 2026-10-31): the correction and the watch on a real venue
  database (`useVenueDb`), so `read` and `transaction` take the real write lock; a `set` held at
  the fake host's `clockStatus` (after its `read`, so it holds the turn) until the watch's
  `confirm` has started, then released → both finish within a 5-second deadline on real timers
  (`Promise.race` with a timer that fails the case), so a deadlock fails rather than hangs; the
  same with `closeWaiting`. Control: the turn moved inside the transaction (the deletion below)
  → the deadline fires.
- The store: a disagreement noted, then the wall clock stepped by 5 s against the steady clock →
  `witnesses()` still hands it out (unchanged), `forSetting()` does not; with no step, both do and
  `forSetting()` carries the `at` it was noted with.
- A confirmation that the watch writes, from `confirm` and from `closeWaiting`, waits for a set
  in flight in the same turn (a fake correction whose `inTurn` records order).

**Deletion controls.** Clear the hold on the next look instead of on `reanchor` → the two-looks
case records a jump; drop the take-and-record in `stepComing` → the filing-reply case disproves
the new lift; drop it in `reanchor` → the reply-while-answering case disproves the new lift; drop
the chain in `recordPending` → the two-at-once case writes the first twice or loses the
second; take the turn inside `deps.transaction` instead of around it → the turn-then-lock case
hits its deadline; drop the `fresh` filter from `forSetting()` → the stepped-disagreement case
fails.

**Focused commands.**
`pnpm --filter @waitron/server exec vitest run src/clock-watch.anchor.test.ts
src/clock-witnesses.test.ts src/clock-watch.test.ts src/clock-watch.elapsed.test.ts
src/clock-watch.restart.test.ts`.

### Task 11a: The watch sets the clock during a stop, with a backoff

**Goal.** Decision 6's automatic half and its backoff (round 2, I3).

**Files.** Modify `apps/server/src/clock-watch.ts` (on `stop.proof === "contrary"` after
`openCheck`, call `correction.set` with AEAT's offset when `stop.contrary.authority` is set, else
the devices' mean, each with the chosen readings' `measuredAt` from `forSetting()` and
`stepsSeen: correction.steps()` read when the witnesses are read; when `stop === null` and the
reading is not recordable, judge `forSetting()` with `judgeClockWitnesses` and set from a
disagreeing group of devices; `writePending()` on each look straight after its first
`recordPending()` succeeds (`clock-watch.ts:228`), never before it or when it failed, so a disproof
measured on the old clock is written before the step's row (decision 8); the backoff of
decision 6, kept in memory by stop key; log a refusal once per change of reason, not every 15 s).

**Failing tests first** in a new `apps/server/src/clock-watch.correction.test.ts` (the existing
harness, a fake correction recording calls):
- A stop with AEAT disagreeing by +2 days → one `set` with `source: "authority"` and AEAT's offset;
  devices disagreeing too → still AEAT's.
- A stop with two devices from two addresses disagreeing, no AEAT → `source: "devices"`, the mean.
- A stop with one device disagreeing → no set.
- `clock.unusable` (a reading in 2001) with two devices disagreeing → `reason: "unusable"`.
- A correction answering `synchronised` on three looks logs `clock_watch.cannot_set` once.
- A disproof pending in the watch and a step row pending in the correction → the look writes the
  disproof, then calls `writePending()`; with the disproof's write failing → `writePending()` is
  not called on that look.
- **Backoff**: a correction answering `{ set: false, reason: "refused" }` on every call, looks
  every 15 s of the fake steady clock → one call in the first 10 minutes, the second at 10
  minutes, the third 20 minutes after that; an answer `synchronised` on every look → asked every
  look (nothing toggled, no backoff); a new open check id → asked at once; a fake correction
  recording `clock.corrected` per unverified answer → at most one per backoff step.
- One boot-level case in `boot.clock-watch.test.ts`'s style, for the wiring: `seams.boxHost` a
  fake host, a venue whose latest sale is a day ahead of the box, two equipment reads from two LAN
  addresses (`requestFromBox` false) reporting a day ahead → within one look the fake host was
  asked `clock.set` with a target about a day ahead and an ids-only requester. A real server's
  clock is `systemClock()` (`boot.ts:1816`), which no seam moves (`seams.testClock`, `:843`, is the
  module operations' hour clock, `module-operation-host.ts:31`), so the fake host cannot move it:
  the case asserts the honest outcome — no `clock_confirmations` row, no `clock.corrected` (the
  clock did not move, decision 7's last sentence) and one `clock_correction.unverified` log line;
  and the next look within 10 minutes does not ask the host again (the backoff, wired).
  The success path through the row and the lift is Tasks 8, 10 and 12's, on clocks the test
  controls.

**Deletion controls.** Drop the `contrary` branch → the AEAT case fails; drop the backoff → the
backoff case sees a call every look.

**Focused commands.**
`pnpm --filter @waitron/server exec vitest run src/clock-watch.correction.test.ts
src/clock-watch.test.ts src/clock-watch.elapsed.test.ts src/clock-watch.restart.test.ts
src/boot.clock-watch.test.ts`.

### Task 12: An administrator's "Use your device's time?"

**Goal.** Decision 10.

**Files.** Modify `apps/server/src/box-health-api.ts` (`clockConfirm` deps gain `correction`;
mount `POST /api/box/clock-set` when `confirmClockStep` exists; `POST /api/box/clock-confirm`'s
WHOLE `withTransaction` (`:269`) runs inside `correction.inTurn` when a correction is passed —
the turn before the lock, never inside it, decision 6; round 2 C1); create
`apps/server/src/clock-set.route.test.ts`; modify `apps/server/src/boot.ts` (`:2594-2605`).

**The route**, in order: refuse on the box (`same_machine`, as `:247-250`);
`requireManagementSession`; authorize `person.admin` in one transaction; parse
`{ challengeId, deviceAt }` as `confirmBody`
does (`:87-102`); take the challenge (`clock.check_expired` when gone); compute `boxAt` at the
round trip's midpoint as `:281-295` does, keeping the wall and steady readings taken there as
`measuredAt` and `correction.steps()` as `stepsSeen`; then `correction.set` with
`source: "admin"` and the device's offset, outside any transaction. The correction judges, inside
its turn and in decision 10's order, `stale`, `not_stopped`, `host_unavailable`, `synchronised`,
`witnessed` (AEAT or a group of devices has spoken during the stop) and `agrees` (the device
within a minute) — so `witnessed` is only ever said where the box can set its clock (round 2, I4).
Map each to `clock.set_refused { reason }` and a failed or unverified set to `clock.set_failed`;
answer `{ confirmationId, stepMs, confirmedAt }`.

**Failing tests first** (the route mounted as `clock-confirm.route.test.ts` mounts it, with the
correction built on the test's own `clock` and `wall`, so the fake host can move them): a manager
→ 403 `{ permission: "person.admin" }`; no session → 401; on the
box → 409 `same_machine` with the fake host never asked; no stop → `not_stopped`; AEAT disagreeing
during the stop → `witnessed`; two devices during the stop → `witnessed`; the device 30 s off →
`agrees`; synchronised → `synchronised`; no host → `host_unavailable`; **AEAT disagreeing during
the stop AND the host synchronised → `synchronised`, and AEAT disagreeing with no host →
`host_unavailable`, never `witnessed`** (round 2, I4); a step made between the challenge and the
set (the fake correction's counter raised) → `stale`; an old challenge → 400
`clock.check_expired`; the host moving the clock 3 s short → 502 `clock.set_failed { reason:
"unverified" }`; the control: a device a day ahead, nothing else spoken → 200, one row
`source: "admin"` with the person, `clock.corrected` naming the person, the stop lifted at the next
read; the before-2024 case → 200 with `reason: "unusable"`. Every refusal: zero rows written,
zero host sets, counted.

A case for the confirm route: `POST /api/box/clock-confirm` started while a set holds the turn
writes its row only after the set's row (both through the stub seat, order recorded). And the
deadlock case (claim check, 2026-10-31): on the route's real venue database, a `correction.set`
held at the fake host's `clockStatus` (after its `read`, so it holds the turn) until a
`POST /api/box/clock-confirm` has started, then released → both finish within a 5-second
deadline on real timers (`Promise.race` with a timer that fails the case).

**Deletion controls.** Drop the `witnessed` check → its two cases fail; judge `witnessed` before
the host's status → the two I4 cases answer `witnessed`; drop the on-the-box check →
`same_machine` fails; drop the permission → the manager case fails; take the confirm route out of
the turn → the order case fails; take the turn inside its `withTransaction` → the deadlock case
hits its deadline.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/clock-set.route.test.ts
src/clock-confirm.route.test.ts src/box-health-api.test.ts`.

### Task 13: The dashboard's dialog, refusals and row

**Files.** Modify `apps/dashboard/src/api/client.ts` (`clockSet` beside `clockConfirm` at `:4595`),
`apps/dashboard/src/screens/box-status-screen.ts` (the dialog at `:498-557`: when the reading does
not agree and `canSet` holds — `health.clock.sync` says the box can set (`source ===
"timedatectl" && !synced`) AND a stop the set route accepts is showing: `health.clockStop` not
null and not `confirmed`, or `clock.unusable` among the notices — draw "The box's clock says
{box}. Your device says {device}. Use your device's time?" with Cancel and a primary "Use this
time"; on Confirm a fresh challenge and `clockSet`. `#offersClockCheck`
(`apps/dashboard/src/screens/box-status-screen.ts:410-416`) also opens the dialog for
`health.clockCheckWaiting`, where Task 12 answers `not_stopped`, so `canSet` must not follow it
(round 2, I4); the check is offered while `clock.unusable` is among the notices too),
`apps/dashboard/src/i18n/strings.ts` and the Spanish block (new keys under
`box_status.clock.admin.set.*`), `apps/dashboard/src/i18n/codes.ts` (`clock.set_refused`,
`clock.set_failed`), the refusal map beside `CONFIRM_REFUSALS` (`:41-46`).

**Words** (concise; CLAUDE.md §3's refusal rule — what happened and what each choice does, never
"ask someone"): `synchronised` — "The box keeps its clock in time over the internet and says it is
right, so it does not take a time from a device. If your device's time is right, check the box's
internet connection." `witnessed` — "The tax agency's time or two tills already disagree with
the box's clock, so the box sets its clock from them by itself; your device's time was not used."
(Said only where the box can set, decision 10, so "by itself" is true; no "within a minute": the
backoff can hold an automatic set longer.) `stale` — "The box's clock changed while this was being
checked. Read the time again." `agrees` — the existing agree path. `host_unavailable` — decision
13's words. Success — "The box's clock is set." and, when `|stepMs|` is more than
`IDLE_TIMEOUT_MS` (FYI 6), "Sign in again to go on."; tills and handhelds are not mentioned, as
they stay signed in.

**Failing tests first** (`box-status-screen.test.ts`, browser): a differing device on a box that
can set shows the question, Cancel and "Use this time"; Confirm sends a fresh challenge then
`clockSet` with `deviceAt`; each refusal's words under the buttons; a box that cannot set still
shows today's `differ` sentence and Close only (control: today's behaviour unchanged);
`clock.unusable` offers the check; **a waiting check (`clockCheckWaiting` set, `clockStop` null,
no `clock.unusable`) on a box that can set shows today's dialog and no "Use this time"** (round 2,
I4). `box-status-screen.a11y.test.ts`: the set question, both themes. Existing dialog cases pass
unedited.

**Deletion controls.** Drop the `canSet` condition → the "cannot set" control fails; let `canSet`
follow `#offersClockCheck` → the waiting-check case draws "Use this time".

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
other (so it is the first deleted by count, never kept in place of a correctly dated one) — a
rule kept permanently, not only after a step (the lead's ruling (c)). **Its limit, stated in the
code, the guide and `conventions-data.md`** (round 2, minor 7): the hold covers only steps the
BOX made, which are the only ones with a `clock_confirmations` row; a step by the time service
itself, or by hand on the host, holds nothing, and its archives are pruned by today's rule plus
the future-stamped ranking.

**Files.** `apps/server/src/backup-sweep.ts`, `backup-sweep.test.ts`;
`packages/fiscal/src/backend.ts` and `packages/fiscal-verifactu/src/clock-step.ts`
(`latestClockStep`); `boot.ts` (the sweep's deps);
changed test check 4 names `latestClockStep`.

**Failing tests first** (slice 9's T6 shows today's behaviour: `pnpm --filter @waitron/server exec
vitest run src/backup-sweep.test.ts -t "prunes by count AND age"` → 1 passed): a +400-day step
yesterday keeps every archive stamped before it; a −400-day step yesterday keeps the
future-stamped ones and keeps each new one up to `retain`; `retainDays + 1` days after either step,
pruning is as today; the future-stamped ranking with no step; `justStored` still never deleted;
**held archives never fill the destination** (the lead's ruling (c)): after a −400-day step with
`retain` future-stamped archives present, thirty daily runs each storing one new archive leave at
most `retain` + (the archives held at the step) in the destination after every run, and the held
set never grows. "prunes by count AND age" passes unedited.

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
  than `IDLE_TIMEOUT_MS` (30 minutes, `:13`) after now counts as expired
  (`management_session.expired`) — the mirror of today's idle rule, so a backward step past half
  an hour ends sessions as a forward one already does, and a smaller backward step ends none (a
  smaller forward step already shortens every session's idle time by the step; FYI 6, the lead's
  ruling (d)). Tests: 30 minutes and 1 s ahead → expired; 29 minutes 59 s ahead → accepted
  (the control); 10 minutes ahead → accepted, and the touch then stamps `lastSeenAt` at now. No
  till or handheld session changes: `apps/server/src/till-session.ts` has no time-based expiry.
- **Passkey challenges** (`packages/identity/src/passkey.ts:109`): a `createdAt` more than a minute
  ahead counts as expired. Same pair of tests.

**The audit.** Run these and keep their output in the task's commit message (the second lists,
for scheduled duties, the files that hold timers; the browser packages' own timers are out of
scope):
```bash
/usr/bin/grep -rn 'Date.now()\|new Date()\|now()\.getTime()' apps/server/src packages/*/src \
  --include='*.ts' | /usr/bin/grep -v '\.test\.ts' | /usr/bin/grep -v '/testing/'
/usr/bin/grep -rln 'unrefTimer\|setInterval\|setTimeout' apps/server/src packages/*/src \
  --include='*.ts'
```
Write a table into `docs/developers/conventions-data.md` (Task 18's section) with one row per
job that compares a stored time with the clock: what a +400-day and a −400-day step does to it,
and "fixed (test)" or "accepted: <reason>". Named already, each to be decided there:
certificate reminders (`apps/server/src/certificate-reminder-worker.ts`,
`packages/fiscal-verifactu/src/certificate-reminders.ts`),
account-action links (`packages/identity/src/account-action.ts:115`, stored `expiresAt`), Cloud
grants (`cloud-backup.ts:137-138`, `cloud-recovery.ts:121`), the backup schedule's next fire
(`backup-sweep.ts:384-386`, which sleeps in hour chunks), working-time pay periods
(`packages/workforce/src/pay-period-close.ts`), and tender-refund ageing (`bill-refunds.ts:485`).
Two more, decided here (round 2, I7):
- **The attendance day close** (`runAttendanceLoop`, "Where the outline was wrong", item 9): it
  closes a day once the wall clock passes its end, and may then append an automatic clock-out
  (`packages/workforce/src/end-of-day.ts:213`, `:360`). A step the box makes moves the clock
  TOWARDS the right time, so the days it then closes have really ended; the wrong closes come
  from a clock wrongly ahead before any step, which 9b does not cause. The row is written from a
  test in `apps/server/src/attendance-loop.test.ts` (a shift open across a +400-day and a
  −400-day move of the pass's `now`), not from reading; if that test shows a step blocking a
  later clock event or deleting an entry, the STOP rule below applies.
- **The box's TLS certificate** (`apps/server/src/self-signed-cert.ts:160-165`, `validityFrom`:
  `notBefore` is the box's clock less a day). Accepted, with a backlog line: a leaf (or a CA)
  issued while the box's clock was more than a day AHEAD is refused by every device whose clock is
  right from the moment it is issued — the issue under a wrong clock causes it, not the step; a
  backward step is what lets the box itself see the leaf as not yet valid (`healthy`,
  `apps/server/src/box-tls-repair.ts:131-148`, `current` at `:47-49`), and its repair route
  reissues a leaf that is not healthy (`connection-bootstrap.ts:128-131`, `readCandidate` in
  `box-tls-repair.ts:242-262`). Read, not run; whether a device that refuses the certificate can
  reach that route is not checked here, and the backlog line says so. It also asks 9c to refuse a
  certificate issue while a clock check waits.

**STOP rule** (widened, round 2 I7). A job that, on a step of days, deletes data, keeps a
credential alive past its limit, cuts tills off, or blocks a legal record is fixed in
this task (or Tasks 15a and 15b) with a test, or accepted by this plan with a reason (the
certificate, above), or the build stops for a decision.

**Focused commands.** `pnpm --filter @waitron/stream exec vitest run src/supervisor.test.ts`;
`pnpm --filter @waitron/identity exec vitest run src/management-session.test.ts
src/passkey.test.ts`.

### Task 15a: A shift begun before a backward step can be clocked out and in again

**Goal.** The working-time record keeps working across a backward step (round 2, I7; the STOP
rule's "blocks a legal record"). Split from one task after the claim check of 2026-10-31 found
three more reads: 15a fixes the workforce package's read, 15b the till's.

**What happens today.** A clock-out after a backward step is not refused `shift.invalid`
`ends_not_after_starts`, as the fresh review said: the only thrower of that reason is
`shiftInterval` (`packages/workforce/src/clocking.ts:678-692`; `/usr/bin/grep -rn
ends_not_after_starts apps packages --include='*.ts'`, test files left out, printed only `:689` on
2026-10-31), which only the roster's `addShift` and `updateShift` call (`:436`, `:462`). A
clock-out goes `clockOut` → `append` → `appendToChain` (`:179-183`, `:614-642`) with no check of
time order, so the record IS written. The defect is in the reading, in three places, each of which
takes the latest entry by `event_at` first:
- `currentState` (`clocking.ts:607-612`, behind `clockIn`, `clockOut`, `breakStart`, `breakEnd`)
  sorts by `compareEvents` (`packages/workforce/src/effective-entries.ts:11-13`), but only over
  what `readLatestLiveEntries` hands it — the person's live entries AT the latest `event_at`
  (`packages/workforce/src/record-reads.ts:83-100`) — so re-sorting inside `currentState` alone
  changes nothing;
- the till's `readTillClockState` (`apps/server/src/till-clock-state.ts:42-57`, ordered by
  `event_at` first), behind `GET /api/clock/state`, the clock routes' `before.state` and
  `lastEntryId` check (`apps/server/src/till-clock-api.ts:115-121`) and
  `reconcileAttendanceBeforeClock` (`apps/server/src/attendance-discovery.ts:29`);
- that function's `start` read, the person's latest clock-in (`attendance-discovery.ts:31-49`).

The claim checker ran it on this tree (2026-10-31; its receipt, not re-run for this fold): clock
in at 21:00, clock out at 20:30 → written; the next clock-in refused `attendance.already_open`;
and a SECOND clock-out at 20:50 also accepted and written (`sequence_no` 3), because the only
entry read was the 21:00 `in`; and the till's state read still said `working` after the
clock-out. So until real time passes the clock-in, the person cannot clock in again, and (read,
not run beyond the second) every clock-out dated before 21:00 is accepted, since the latest
instant stays the 21:00 `in` — a legal record blocked and wrong ones written — and
`projectWorkSessions`
(`packages/workforce/src/projection.ts:145-181`) sees an `out` before any `in`.

**The rule, for every state read.** Chain positions are only comparable within one chain: a chain
is one node and one location (`workforce_chains`' primary key, `schema/workforce-chains.ts:27`),
each append takes that chain's next `sequence_no` (`chain.ts:109`), and the person's entries at
two locations sit in two chains (clock in at A, out at A, in at B → 1, 2, 1 on a fresh box). So:
1. For each chain (`node_id`, `location_id`), the person's latest DIRECT live entry (`in`, `out`,
   `break_start`, `break_end` — entries the clocking routes wrote, not a manager's approved
   missing-entry correction) by `sequence_no`: within one chain a later position is a later
   write, whatever the clock said.
2. Across chains, the latest of those by `compareEvents`.
3. Unless an approved missing-entry correction is dated after that entry's `event_at`: then the
   latest such correction by `compareEvents` decides, as today.
While the box's clock only moves forward, each chain's latest by position is also its latest by
`event_at`, so this answers what today's rule answers.

**It changes only how state is DERIVED, never what is recorded.** `append` (`clocking.ts:614-642`)
and the chain's `attemptAppend` (`chain.ts:102-…`) are not touched: an entry's `event_at` is still
the clock action's own time (`clocking.ts:625`), its `recorded_at` still clamped to its chain's
high-water mark (`chain.ts:115-122`), its position and hash as today (`:109`, `:124-140`). What
follows the derived state is which clock action is accepted, and on the till the `lastEntryId` a
request is checked against and whether a break end is appended before a clock-out
(`till-clock-api.ts:160`). Every entry keeps the time it was written with — the legal record's
times are the box's clock, as every record's are (CLAUDE.md §5); the session's hours read as
written (a negative or missing session) and a manager corrects the clock-in through the existing
correction flow. Accepted for 9b, with a backlog line: the hours read, the end-of-day pass
(`end-of-day.ts`'s `intervalsFor`) and the correction check (`corrections.ts`'s
`validateSequence`, `:94-113`) still order by `compareEvents`. Read, not run: that check runs over
all the person's effective entries (`corrections.ts:202`, `:207-216`), so until the clock-in is
retimed to before the clock-out every other correction for that person is refused
`correction.invalid` `unmatched_out`; the retime itself puts the entries back in order. The test
below tries the retime.

**Accepted residual (the lead's ruling (e), 2026-10-31).** Step 2 still compares times across
chains, so it can mislead after a backward step when the person moved location within it: in at A
at 21:00 and out at A at 21:10, the clock stepped back an hour, in at B at 20:15 → A's latest is the
`out` at 21:10, B's is the `in` at 20:15, and the person reads `out` while working at B until real
time passes 21:10 — up to the step's size. It needs two locations on one node and a move within the
step. No order across chains is immune to a step: `time_entries.id` is a random id
(`packages/workforce/src/schema/time-entries.ts:50`, `$defaultFn(newId)`), `recorded_at` is
clamped monotonic per chain only (`:63-64`), and an implicit row number is not kept by a vacuum or
a restore. Nothing recorded is wrong in that window — only the state the till shows — and a manager
can retime the entry. Task 19 adds the backlog line; the owner FYI list carries it as FYI 7.

**Files.** Modify `packages/workforce/src/record-reads.ts` (`readLatestLiveEntries`, whose only
caller is `currentState` — `/usr/bin/grep -rn readLatestLiveEntries packages apps
--include='*.ts'` printed only `record-reads.ts:83` and `clocking.ts:29`, `:608` on 2026-10-31 —
is replaced by `readLatestLiveEntry(tx, personId, { kind?: "in" })`, which applies the rule above
and is exported from `packages/workforce/src/index.ts` for Task 15b), `clocking.ts`
(`currentState` reads it). Create `packages/workforce/src/clocking-step.test.ts`.

**Failing tests first** (`useVenueDb`, the workforce test fixture): clock in at 21:00, then clock
out at 20:30 the same day (a backward step of an hour in between) → the out is written (a row
counted) AND the state reads `out` (today: `working`); a second clock-out at 20:50 → refused
`attendance.no_open_entry`, no row written (today: accepted, `sequence_no` 3); then clock in at
20:45 → accepted (today: `attendance.already_open`) and the state reads `working`; then clock out
at 21:30 → accepted. `readLatestLiveEntry` with `kind: "in"` after that → the 20:45 entry. A
manager's retime of the 21:00 clock-in to 20:00 → accepted (refused is the STOP rule's "blocks a
legal record").
Controls, each passing before AND after the change: clock in 09:00, out 17:00 → as today; **two
locations**: clock in at A, out at A, in at B, no step (sequence numbers 1, 2, 1) → reads
`working`, the entry B's `in`; a manager's approved missing-entry `out` dated after the latest
direct `in` → reads `out`, as today; one dated before it → `working`, as today (corrections come
through `liveClockEntries`' missing-entry branch, `effective-entries.ts:68-76`).

**STOP** if any existing suite under `packages/workforce` must be edited to pass: the rule then
needs a workforce decision, and the lead reports.

**Deletion controls.** Order each chain's entries by `compareEvents` again → the 20:30 case reads
`working`; order by `sequence_no` across all chains → the two-location control reads `out`; drop
the correction branch → the later-dated missing-entry control reads `working`.

**Focused commands.** `pnpm --filter @waitron/workforce exec vitest run src/clocking-step.test.ts`;
then `pnpm --filter @waitron/workforce exec vitest run` whole, since the rule touches the state
every clocking route reads.

### Task 15b: The till reads the same state

**Goal.** The till's state, its stale-request check and the attendance reconcile follow Task
15a's rule, so the till and the clocking routes never disagree.

**Files.** Modify `apps/server/src/till-clock-state.ts` (the `latest` read, `:42-57`, becomes
`readLatestLiveEntry`; the `firstClockIn` read, `:58-71`, is unchanged: it asks whether any
clock-in falls in today's bounds, not which is latest) and `apps/server/src/attendance-discovery.ts`
(the `start` read, `:31-49`, becomes `readLatestLiveEntry(tx, personId, { kind: "in" })`). Create
`apps/server/src/till-clock-step.test.ts`, on `till-clock-attendance.test.ts`'s harness (a
mutable `instant` the API's `now` reads, `:27-29`).

**Failing tests first.** Through the till's routes, with `instant` moved back an hour between the
clock-in and the clock-out: `POST /api/clock/in` at 21:00, `POST /api/clock/out` at 20:30 → 200;
then `GET /api/clock/state` → `state: "out"`, `activeLocationId: null` (today: `working`); a
second `POST /api/clock/out`, sent with the `expectedEntryId` the state read gave → refused
`attendance.no_open_entry`, no row written (today: written); `POST /api/clock/in` at 20:45 with
the `expectedEntryId` the state read gave → 200 and `working`. Controls, passing before and
after: the same with no step (in 09:00, out 17:00), and Task 15a's two-location case through the
state read. The reconcile's `start`, with the venue's `dayCutover` at 05:00 local: in at 05:30,
the clock stepped back an hour, out at 04:35, in at 04:40, then a state read at 05:10 → the 04:40
clock-in's business day (ended at 05:00) is the one reconciled. (Before Task 15a the 04:40
clock-in is itself refused; the case shows the `start` read through its deletion control below.)

**STOP** if any existing `till-clock*`, `attendance-discovery*` or `boot.till-clock` suite must be
edited to pass.

**Deletion controls.** Put back `readTillClockState`'s `event_at`-first order → the state case
reads `working`; put back the `start` read's → it picks 05:30, whose day has not ended, so
`reconcileAttendanceBeforeClock` returns at `attendance-discovery.ts:58` and the reconcile case
finds nothing reconciled.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/till-clock-step.test.ts
src/till-clock-state.test.ts src/till-clock-api.test.ts src/till-clock-attendance.test.ts
src/attendance-discovery.test.ts src/boot.till-clock.test.ts`.

### Task 16: Guides, English and Spanish

**Files.** `apps/server/src/guide/en/box-status.md` and `apps/server/src/guide/es/box-status.md`:
"When payments stop because of the clock" (`{#clock-behind}`) says the box sets its own clock from
the tax agency's time or two tills, or from an administrator's device on "Use your device's time?",
never while it keeps time over the internet; a new section `{#clock-service}` on the time service,
`clock.sync_off`'s reasons and decision 13's words for `unreachable` (no install instruction);
"Emails about the box" (`{#emails}`) gains the clock-change email and its limit (a restart before
it is sent loses it for a change already handled); the sign-in note of FYI 6 (only a dashboard
session; a step of more than half an hour either way ends it, and a smaller forward step shortens
its idle time by the step; tills stay signed in); and the backup hold's limit (Task 14: only
steps the box made). `deploy/README.md` gains the host service (Task 18).

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

### Task 18: Developer docs, CLAUDE.md, the deploy README, the asesor question and B3's contract

- `docs/developers/conventions-data.md`: a section "The box sets its own clock" after "A
  confirmation of the clock lifts the stop for one step back" (`:3969`): the host service and its
  two requests, the order, the step counter and `stale`, what a step's row stores, the alert and
  its email, the backoff, the pruning holds and their limit, Task 15's audit table, Tasks 15a
  and 15b's rule, the turn taken before the write lock, and the measurements with their run URLs.
  Update "A jump" (`:4163`) for `stepComing`'s and `reanchor`'s take-and-record and the hold until
  `reanchor`.
- `CLAUDE.md` §5's clock bullet gains one clause: "the box sets its clock only through the host
  service, never while it keeps time over the internet, and every step it makes is alerted and
  emailed", naming its guards (`clock-correction.test.ts`, `clock-set.route.test.ts`,
  `scripts/waitron-box-sh.test.mjs`) and saying they are weaker than the rule where they are (the
  handler's suite runs stubs, not systemd). Run
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- `deploy/README.md` (read by whoever installs, who has a terminal): the host service, what
  install writes and with which modes, how to see its journal (`journalctl -t waitron-box`), that
  it stops the time service only while it sets the clock and never disables it, and that a box
  updated with `docker compose pull` alone (`deploy/README.md:170`) has no host service until
  install is run again. The install instruction lives here and nowhere the operator reads
  (decision 13).
- `docs/compliance/asesor-questions.md`: **Q61** (the next free number on `65bc0441a` — the
  headings run to Q60 at `:3814`; re-check with `/usr/bin/grep -nE '^### Q[0-9]+'
  docs/compliance/asesor-questions.md | tail -3` at build time and take the next free one):
  "A system that corrects its own clock from a device's clock when it has no internet (added
  <date>)" — whether a SIF may correct its own clock from devices' clocks or an administrator's
  device when it has no internet, and what it should record; its text names FYI 4's residual risk
  (a scripted request from two enrolled devices can set any time between 2024-10-28 and 2100, and
  after slice 9c can do so with nobody present). Plain English with a Spanish quotation block, as
  Q60 has; a dated note at the top beside the 2026-10-24 one; none in the shortened list.
- **B3's plan** (`docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, Task 3.1, after its
  **Interfaces** paragraph at `:158`; the lead's ruling (a)): a paragraph "The clock requests
  slice 9b shipped" stating the server↔host contract B3 must keep or migrate: the socket
  `/run/waitron-box/box.sock` (`waitron-box.socket`, `Accept=yes`, host group `waitron-box` of
  gid 10001, mode 0660) and its
  template `waitron-box@.service`, which B3's planned `waitron-box.service` would collide with by
  name; the server's client `apps/server/src/box-host-client.ts`, which B3's plan lists as a NEW
  file (its Task 3 row, `:51`) but 9b creates first, so B3 changes or replaces 9b's client rather
  than creating it; one text line in, one JSON line out; `clock.status` and `clock.set
  <epochMs> <requester>` with decision 2's and decision 3's replies; and that the requester is
  SELF-REPORTED JSON the host only logs — weaker than B3's `VerifiedHostActor`, which "caller
  JSON … cannot mint" (`:70`), since the server alone authorizes a set. B3 either keeps the two
  requests on this wire or moves them under its own protocol and actor, in the same change that
  moves the server's client. Lines ≤ 100 characters, in the paragraph's own words.
- Docs-only changes travel in this pull request (they describe its code).

### Task 19: The backlog

1. `docs/backlog.md:155-156`: "slices 1 to 10 landed; slices 9b and 9c are outlined" → "slices 1
   to 10 landed; slice 9b built and parked for the owner (#<pr>); slice 9c outlined".
   `docs/backlog/box.md`: the A798-B entry (`:1534-1546`) names 9b's pull request and Q61; "A
   device's or an administrator's time is self-reported" (`:1448-1457`) says slice 9b added the
   alert and email and that the time can now set the clock; "The clock watch's suspend-aware clock
   has not been run on Linux" (`docs/backlog.md:5106`) is narrowed to what M3 measured
   (a setting of the wall clock), leaving a real suspend unmeasured.
2. New entries: B3 keeps or migrates 9b's clock requests and requester (the lead's ruling (a),
   pointing at the B3 paragraph Task 18 writes); the box's certificate issued under a clock wrongly
   ahead (Task 15); the hours read, the end-of-day pass and the correction check after a
   backward step, and the accepted cross-chain case (Task 15a, ruling (e)); the stream's
   pruning measured by the bucket's own times (Task 15); anything else Task 15 accepted
   that a later slice must revisit.
3. This plan's status line: built, parked, the pull request's number. (The measurement workflow
   was deleted in Task 4; `git log --diff-filter=D --oneline --
   .github/workflows/host-clock-measure.yml`
   shows that commit.)

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
host missing on a production box → `clock.sync_off` `unreachable`, with no install instruction in
its words; an administrator's `POST /api/box/clock-set` refusals each with zero rows; two steps
within a minute → two emails; a host that refuses every set → at most one set per backoff step; a
+400-day and a −400-day step against `pruneBackend`. Delete, one at a time: the synchronised
refusal in the handler and in the server, the verification, the step counter, `stepComing`'s hold,
the `witnessed` check, the `held` window, the backoff; name the failing test.

**Codex seat 2 (checklist set aside)** — make the box set a wrong time, or lose data:
- forged matching headers from two device cookies at two addresses (expected: the clock is set,
  with an alert and an email — FYI 4; check both are recorded with the proof);
- an administrator's `deviceAt` sent by `curl` (expected: set, the person named);
- a set racing the clock watch (an admin's set and an automatic one together, the host still
  unsynchronised after the first: exactly one host set and one row, the other answering `stale`;
  never a jump disproof);
- the host service killed mid-set (expected: the time service started again — the `trap`, or
  `ExecStopPost=` on a kill — never disabled, and no row);
- a requester carrying a newline, 4 KiB, or `$(…)` (expected: refused, or logged and not run);
- a step forward of 400 days then back: backups, stream generations, dashboard sessions, a shift
  clocked in before the step.

## The lead's rulings (2026-10-31)

The fresh review of revision 1 left four points open, and the narrow check of its fold a fifth;
the lead ruled on each, and the build
follows the ruling.

1. **(a) B3's host.** 9b ships the shell handler: a host installed by `waitron.sh` has no Node,
   and socket activation leaves no long-running root process. B3's plan fixes a different
   contract, so Task 18 writes 9b's wire format and its self-reported requester into B3's Task 3.1
   as the contract B3 must keep or migrate, and Task 19 adds a backlog line ("Where the outline
   was wrong", item 3).
2. **(b) The words when the host service does not answer** carry no install instruction; they
   give the one step the person can take themselves, worded with care (decision 13, a deliberate
   deviation from design §4.9 h.2 and 9c's FYI 5, which this commit updates).
3. **(c) The backup hold of Task 14 is accepted**, with its limit stated (only steps the box made)
   and a test that held archives never fill the destination; the "future-stamped archives rank
   last" rule is kept permanently.
4. **(d) Tills and handhelds are not signed out.** Only a dashboard session ends, and only when
   its `lastSeenAt` is more than `IDLE_TIMEOUT_MS` ahead of the new clock (FYI 6, Task 15). It
   stays an owner FYI default in that form.
5. **(e) Task 15a's cross-chain case is accepted** with a backlog line and owner FYI 7: no order
   across a person's chains survives a step (Task 15a, "Accepted residual"), and the case needs two
   locations on one node plus a move inside the step's window; nothing recorded is wrong, only
   the state the till shows until real time passes the earlier entry.

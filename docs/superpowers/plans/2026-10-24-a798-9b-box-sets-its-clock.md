# A798-B slice 9b — the box sets its own clock, and watches its time service (BUILD PLAN)

> **Revision 5 (2026-10-31, the fresh-context review of revision 4, commit `b43a6c337`, and the
> lead's rulings on it).** Two of revision 4's defaults are reversed by the lead, because they
> follow the owner's words and are not the lead's to override:
> - **(R1) While the start-up window is open, two agreeing devices no longer lift the stop by
>   themselves**; AEAT agreeing still does (decision 18, Task 11b). Slice 9's lift is unchanged
>   outside the window.
> - **(R2) A staff member's confirmation gets a real `staff` source**, through ONE new
>   fiscal-verifactu migration that rebuilds `clock_confirmations` with a wider source CHECK and a
>   person CHECK of "`admin` or `staff` ⇔ a person" (new Task 8-0, decision 16 rewritten). Pre-live,
>   CLAUDE.md §3's "No backwards-compatibility or data-migration code until Waitron is in
>   production" applies. Its safety receipts, run for this revision, are under "What slice 9 left".
> Every other finding is folded: storing a proof key only when set (C1); the start-up proposal
> only ever arising inside a stop the box already has, said in the owner block (I3); the cost of a
> power cycle (I4); an administrator signing in on the till in place, and "Check the time" as the
> existing clock line's own hint rather than a second line (I5); `device_profile.not_admitted`
> checked again inside the transaction (I6); what the window's `admit` answers once AEAT has
> answered (I7); the payments-restarted alert and email naming the staff member and the till (I8);
> Task 12a split into 12a and 12b (M1); more deletion controls (M2); refusals above the buttons
> (M3); narrower `witnessed` words (M4); a next step for the till's `contrary_proof` (M5); the
> window created before the tills' notice sources (M6); `agrees` in Task 10 (M7); and the window
> on a node that is not primary, or whose looks keep failing (decision 14). FYIs 3, 8, 10, 12, 13
> and 15 and the `questions.md` block are rewritten to match; 9c's outline and the design pointer
> follow R1.
>
> **Revision 5a (2026-10-31, a fresh claim check of revision 5, commit `ee3489826`).** Folded:
> `witnessed` covers any AEAT reading taken during the stop, agreeing or not, for `admin` and
> `staff`, with the agreeing case tested in Tasks 10 and 12a and both `witnessed` wordings made
> true for it (decisions 10, 14 and 15); `scripts/migration-upgrade.test.ts` is no longer claimed
> to check Task 8-0's migration, and a dedicated upgrade test takes its place; changed test check
> 13 (`hour-recovery-staged.test.ts`'s hand-undone migrations); the CSV header names a staff
> member (Task 8a); the generation's `PRAGMA` lines and `--name`; CHECK deletion controls that
> regenerate the migration; the journal-replaying suites added to Task 8-0's checks; the
> `apply.ts` lines corrected; Task 11b's `noStop()` path and boot's `primaryAtStart` tested; a
> separate `checkTimeOffered` helper in Task 13a; a node demoted while running keeps its window
> (decision 14); `not_admitted` answered as `device_profile.not_admitted`, and where an
> administrator's override is checked (decision 15); AEAT agreeing still lifts the stop at
> start-up (the `questions.md` block and the design pointer); and they/them for the owner.
>
> **Revision 4 (2026-10-31, the owner's answer of 07:00 and 07:05).** The owner did not pick
> either option of the question this plan asked; they gave a new rule instead (`questions.md`,
> "OWNER ANSWER 2026-10-31 ~07:00" and "~07:05", `~/waitron-campaign-b/questions.md:823-836`):
> "If we can't check the time on the internet, then use a till to choose the likely time, but ask
> for confirmation from a human before continuing with startup." Then: any staff member signed in
> on site may confirm; a clock problem found while the box is already running "gets an alert to an
> admin"; and every confirmation is recorded, alerted and emailed like the other clock changes. That
> replaces the owner's 24 October 04:24 rule ("two tills may set it, no admin needed"), which revisions 1–3
> built. What changed:
> - **Two agreeing devices no longer set the clock.** The tax agency's (AEAT's) time still sets it
>   with nobody asked. The administrator's "Use your device's time?" stays, at any time.
> - **New: a till proposes the likely time and a staff member confirms it, on the till**, only
>   during a stop the box found when it started (decision 14 says what "found when it started"
>   means in code, and decision 15 is the till's check). New tasks 11b, 12a and 13a.
> - **While the box is running, a clock stop alerts the administrators**: the existing
>   `clock.behind_chain` and `clock.unusable` alert and email now say that an administrator can set
>   the clock from their own phone or computer (new task 13b).
> - **A staff member's confirmation is stored with no migration** (reversed by revision 5's R2), as `source = 'admin'` with
>   their person id and a `proof.staff` entry naming the till (decision 16, with the run that shows
>   the shipped CHECK accepts it); every reader that words "who confirmed" learns to tell the two
>   apart (new task 8a).
> - Tasks 8, 10, 11, 11a, 12, 13, 16–19 rewritten to match; the "owner question" section becomes a
>   record of the answer; FYI 2–4 rewritten and FYI 8–14 added, with a block for `questions.md`;
>   9c's outline updated in the same commit (decision 14 says how start-up splits between 9b and
>   9c), and a dated pointer added to design §4.9 c–d.
> Tasks 1–7 are built and unchanged: nothing in the owner's answer touches the host service, its
> install, the client, time health or `clock.sync_off`.
>
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

**Goal.** The box sets its own clock (and its battery clock) when one of three sources says it is
wrong: AEAT's time, by itself, with nobody asked; a till's time, which the till proposes and any
staff member signed in on it confirms, only during a stop the box found when it started; or an
administrator's own device, on their Confirm, at any time. It records who or what did it, which till
proposed it, both readings and the step, alerts and emails the managers, and judges the stop again.
While the box is running, a clock stop alerts the administrators, whose own device is then the way
to set it. The box reads whether its time service runs and is synchronised; the bell warns when it
does not. It opens no new stop: it sets the clock only inside a stop it already has — slice 8's
clock behind the latest record, and the clock before 28-10-2024 (`clock.unusable`). Slice 9c adds
the checks at start and after a change, and makes the till's confirmation the gate every start
waits on (decision 14).

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
8-0. **A real `staff` source: one migration** — `packages/fiscal-verifactu/src/schema/clock-confirmations.ts`,
   its generated `drizzle/0012_*.sql`, `packages/fiscal/src/backend.ts`. STOP if a guard shows the
   rebuild unsafe.
8. **The seat records a step of the clock, and the bell words it** —
   `packages/fiscal-verifactu/src/clock-step.ts`, `clock-stop-incidents.ts`, `alert-messages.ts`.
   STOP if the fiscal core would have to change.
8a. **Slice 9's confirmation takes a staff member, and every reader words the `staff` source** —
    `packages/fiscal/src/backend.ts`, `clock-confirmation.ts`, `clock-checks.ts`, `box-health.ts`,
    `misdated-sales-csv.ts`, the words files.
9. **`clock.corrected`'s email, never lost to a later step** — `box-alert-email.ts`,
   `i18n/box-emails.ts`.
10. **Setting the clock: the order, one at a time, verified** —
    `apps/server/src/clock-correction.ts`.
11. **The watch as an anchor, and the store's settable AEAT readings** — `clock-watch.ts`,
    `clock-witnesses.ts`, `boot.ts`.
11a. **The watch sets it from AEAT during a stop, with a backoff** — `clock-watch.ts`.
11b. **The start-up window, the till's marker, and no devices-only lift during start-up** —
    `apps/server/src/clock-start-up.ts`, `clock-watch.ts`, `box-staff-notices.ts`, `boot.ts`.
12. **An administrator's "Use your device's time?"** — `box-health-api.ts`
    (`POST /api/box/clock-set`).
12a. **The till's check: its routes and refusals** — `apps/server/src/till-box-clock-api.ts`
    (`POST /api/box-clock/challenge`, `/confirm`).
12b. **The till's check: one at a time, and wired into boot** — the same file's tests, `boot.ts`.
13. **The dashboard's dialog and refusals** — `box-status-screen.ts`, `api/client.ts`, `i18n/*`.
13a. **The till's "Check the time" and its dialog** — `apps/till/src/widgets/notice-strip.ts`,
    `box-time-dialog.ts`, `till-app.ts`, `api/client.ts`, `i18n/*`.
13b. **A running stop's alert and email lead an administrator to set the clock** —
    `apps/dashboard/src/i18n/alert-messages.ts`, `apps/server/src/i18n/box-emails.ts`.
14. **Backups pruned safely across a step** — `backup-sweep.ts`.
15. **The other wall-clock jobs, and the audit table** — `supervisor.ts`, `management-session.ts`,
    `passkey.ts`. STOP if a job that deletes data, keeps a credential alive, cuts tills off or
    blocks a legal record is left unfixed and not accepted by this plan.
15a. **A shift begun before a backward step can be clocked out and in again** —
    `packages/workforce/src/record-reads.ts`, `clocking.ts`. STOP if a workforce suite must be
    edited.
15b. **The till reads the same state** — `apps/server/src/till-clock-state.ts`,
    `attendance-discovery.ts`. STOP if a till-clock or attendance suite must be edited.
16. **Guides, English and Spanish** — `apps/server/src/guide/{en,es}/box-status.md` and
    `till-notices.md`.
17. **LOOK, without the dev stack** — browser-test screenshots of the dashboard and the till.
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
2. **While the time service reports itself synchronised, the box never sets its clock from AEAT, a
   till or an administrator** — they can only agree with it, and a till or an administrator whose
   time agrees may still confirm it. An internet time server is a better source than a tablet, and
   the two would undo each other. *(The outline said "devices or an administrator"; design §4.9
   h.1 says AEAT cannot set it then either, and the plan follows the design. Revision 4: "devices"
   becomes "a till", the only device that may still propose a time.)*
3. **Every clock change the box makes raises a bell alert and an email to managers**: the source,
   the person who confirmed (an administrator, or a staff member on a till), which till proposed
   the time, the reading before and after, and the step (round 1, I3; the owner, 2026-10-31 07:05,
   point 3). Recorded as `clock.corrected` (warning, area `box`, `system.manage`). A second change
   while the first's alert is open marks the first handled by the system and records its own, so
   each change has its own alert; each has its own email too, because the correction hands every
   `clock.corrected` to the email duty directly and the duty keeps it until sent, whether or not
   the alert is still open (decision 9 — reading only open alerts once a minute would lose the
   first of two steps within a minute). A staff member's confirmation that moves nothing (decision
   15) is recorded and alerted as slice 9's administrator's confirmation is, by
   `clock.behind_chain_restarted`, whose bell words and email Task 8a extends to name the staff
   member and the till (today they name neither: `apps/dashboard/src/i18n/alert-messages.ts:171-174`,
   `apps/server/src/box-alert-email.ts:97-108`).
4. **Rewritten in revision 4. A till's time, and an administrator's, is whatever its browser
   sends** (slice 9's FYI 12). From this slice it can SET the clock. A scripted request from any
   staff member signed in on an enrolled till, during a stop the box found when it started, or from
   a signed-in administrator off the box at any time, can set any time between 2024-10-28 and 2100.
   Once slice 9c lands, every start is such a stop, so unplugging the box's internet and
   restarting it lets anyone who can sign in on a till set the clock — which is what the owner's
   rule allows, with a person always named. What limits it: a staff member's own sign-in on an
   enrolled device, never from the box's own screen, only while the start-up stop lasts, never
   while synchronised, the alert and email on every change naming the person and the till, the
   append-only record with its proof, and the wrongly dated list. Two devices with nobody present
   can no longer set it at all. The asesor question (Task 18) names this.
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
   ruling (d). So the staff member who confirms a till's time stays signed in on that till.
7. **New, for the plan review:** after a backward step, a person who clocked out at one location
   and then clocks in at ANOTHER location within the step's window reads as clocked out on the
   till until real time passes their earlier clock-out (Task 15a, "Accepted residual"). What they
   clocked is recorded correctly; only the state the till shows is wrong, and a manager can retime
   the entry. It needs two locations on one box. The lead's ruling (e).
8. **New in revision 4, cost corrected in revision 5: "start-up" is this server's start, a restart
   included.** A stop counts as found at start-up when it holds from the moment the server process
   starts and no reader of the stop has seen it end since; the first look (or till read) that finds
   no stop ends start-up for that run, and any later stop is a running one (decision 14). A restart
   of the server — after a power cut, an update, or by hand — is a start, so a stop that began while
   the box was running and still holds after a restart becomes a start-up stop, and a till may then
   propose a time. Cost: anyone who can restart the box can hand a running stop to staff — and that
   holds under either choice, because pulling the plug also starts a new machine boot with a new
   boot id (`/proc/sys/kernel/random/boot_id`, read by `apps/server/src/boot-reader.ts:4`, `:45-51`;
   Task 1's M3 row shows the id unchanged by a clock set, so it changes only with a boot). The
   narrower choice (only a machine boot counts) would block only a software restart, and would
   leave a box whose server restarted, with its clock still wrong, waiting for an administrator.
9. **New in revision 4: the till is offered only once the box has tried the tax agency's time and
   had no answer** — or at once where the box cannot ask: a clock before 28-10-2024 (AEAT's
   certificate cannot then be checked) or a box that files nothing. The clock watch's first look
   comes 15 seconds after start (`CLOCK_WATCH_MS`, `apps/server/src/clock-watch.ts:16`, its first
   check one interval after start, `:33-34`) and AEAT's read gives up after 5 seconds
   (`AUTHORITY_TIME_DEADLINE_MS`, `packages/fiscal-verifactu/src/authority-time.ts:7`), so a till
   is offered about 15 to 20 seconds after start, depending on how fast the first ask fails. If AEAT
   answers later, the offer ends and the box acts on AEAT's time itself. Cost: those seconds; the
   owner's "if we can't check the time on the internet" is honoured literally.
10. **New in revision 4: a till that agrees with the box can be confirmed too, and that moves
    nothing.** When the till's time is within a minute of the box's, the staff member's
    confirmation lifts the stop exactly as slice 9's administrator's confirmation of an agreeing
    clock does (payments restart on the box's own clock, earlier than the last sale), and the
    payments-restarted alert and email name the staff member and the till (Task 8a). Cost: at
    start-up, one till and one staff member can lift a clock-behind stop. Without it, a box whose
    clock is right but whose last sale was dated ahead would wait for AEAT or an administrator after
    every start with no internet (two agreeing devices no longer lift it during start-up, decision
    18).
11. **New in revision 4: the running-time "alert to an admin" is the alert the stop already
    raises.** No new alert: `clock.behind_chain` and `clock.unusable` are already a bell alert and an
    email to everyone holding `system.manage`
    (`packages/fiscal-verifactu/src/clock-behind-alerts.ts:8-10`), which every administrator holds
    (`packages/identity/src/permissions.ts:84`, `admin: ALL`). Task 13b rewrites their words to say
    that an administrator can set the clock from their own phone or computer on the Box status page
    (and, while the box has just started, any staff member from a till). Cost: managers keep
    receiving it although only an administrator can then act; narrowing it to administrators would
    hide a payments stop from managers.
12. **Changed in revision 5 (the lead's ruling R1), no longer a default: while the start-up window
    is open, two agreeing devices do not lift the stop by themselves.** That follows the owner's
    07:00 words, "ask for confirmation from a human before continuing with startup". AEAT agreeing
    still lifts it; outside the window slice 9's lift (`apps/server/src/clock-watch.ts:279-285`,
    `packages/fiscal-verifactu/src/clock-confirmation.ts:79-81`, `:184-185`) is unchanged
    (decision 18).
13. **New in revision 4, shape changed in revision 5: "Check the time" is the till's existing clock
    line's own hint, offered only to a signed-in person; no dialog opens by itself.** While the till
    is offered, the red line "Payments stopped: the box's clock reads earlier than its last sale"
    (or "…the box's clock is wrong") ends in a "Check the time" button instead of «Tell a
    manager», and a refused payment says to use it (Task 13a). The line is not drawn on the till's
    sign-in page (`apps/server/src/guide/en/till-notices.md:5`); a person signs in with their PIN
    there, as for any work. Any device whose profile admits the person offers it; confirming the time
    needs no profile action and no permission. Cost: someone at the sign-in page sees nothing about
    the clock until they sign in.
14. **New in revision 4: other devices that disagree with the till do not block a staff member's
    confirmation.** The owner said one till is enough with a person; the other devices' readings at
    that moment are kept in the record's proof and named in the email. Cost: a till whose own clock
    is wrong, confirmed by someone who did not look, sets a wrong time — alerted, emailed and listed,
    and put right by the next confirmation.
15. **Changed in revision 5 (the lead's ruling R2), no longer a default: a staff member's
    confirmation is recorded as `source = 'staff'`.** One new migration rebuilds slice 9's
    `clock_confirmations` with the wider CHECKs (Task 8-0, decision 16), before go-live, under
    CLAUDE.md §3's rule that no data-migration code is needed until production. Revision 4's
    "stored under `admin`" scheme is dropped.

### For `questions.md` (the coordinator pastes this)

> **FYI — A798-B slice 9b, revision 5 (lane B, 2026-10-31): your 07:00 and 07:05 answers are in the
> plan; the defaults below are being built unless you say otherwise.** No answer needed.
>
> Built as you said: the tax agency's time sets the box's clock by itself; without it, a till
> proposes its time and any signed-in staff member confirms it on the till before payments start
> again; while the box is running, a clock problem alerts the administrators, who can set the clock
> from their own phone or computer; every change is recorded, alerted and emailed with who
> confirmed, which till, the times before and after, and the step. Two tills can no longer set the
> clock with nobody present, and during start-up two tills that agree with the box no longer
> restart payments by themselves either — a person confirms, unless the tax agency's time agrees
> with the box, which still restarts them. A staff member's confirmation is
> recorded as a staff member's (one small database change, made before go-live).
>
> What this slice does not yet cover: the till is asked only when the box already knows its clock
> is wrong — it reads earlier than the last sale, or before 28 October 2024. A clock that is wrong
> FORWARD, or behind by less than the gap to the last sale, asks nobody until the next slice (9c)
> checks the clock at every start.
>
> Defaults on points you did not settle (each overridable in one line):
> 1. **"Start-up" includes a restart of the box's software**, not only a power-on. A clock stop
>    still there after a restart can then be confirmed from a till. *Cost:* whoever can restart the
>    box can hand a running stop to staff — and unplugging it does the same under either choice, so
>    "only a power-on counts" would block only a software restart. *Override:* "only a power-on
>    counts".
> 2. **The till is offered only after the box has tried the tax agency's time and had no answer**
>    (15 to 20 seconds after start), or at once when the box's clock reads before 28 October 2024.
>    *Override:* "offer the till at once".
> 3. **A till whose time agrees with the box's can be confirmed too**, which restarts payments
>    without moving the clock (as an administrator can today); the alert names the person and the
>    till. *Cost:* one till and one staff member can restart payments after a start. *Override:*
>    "only when the till's time differs".
> 4. **The "alert to an admin" while running is the payments-stopped alert and email that already
>    exist**, reworded to say an administrator can set the clock from their own device; managers
>    keep receiving it. *Override:* "administrators only".
> 5. **"Check the time" replaces «Tell a manager» on the till's red clock line once someone is
>    signed in**; no window pops up by itself. *Override:* "open it by itself".
> 6. **Other tills that disagree with the confirmed till do not block it**; their times are kept in
>    the record and the email. *Override:* "refuse when another till disagrees".

## The owner's answer (2026-10-31) — what replaced the question

Revision 3 asked whether two tills may set the box's clock back past the last sale, or only an
administrator (posted 06:23, `~/waitron-campaign-b/questions.md:777-808`). The owner chose neither
(`:823-836`, relayed by the watcher):
- **07:00:** "If we can't check the time on the internet, then use a till to choose the likely time,
  but ask for confirmation from a human before continuing with startup." Read by the watcher, and
  accepted by the owner's follow-up: AEAT's time stays first and needs no confirmation; without it
  ONE till supplies the likely time; the box does not take it by itself; a person confirms it on
  screen before the box carries on starting, so before selling; forward and backward alike. This
  replaces the 24 October 04:24 rule ("two tills … no admin needed").
- **07:05:** (1) any staff member signed in on site may confirm, no administrator needed; (2) a clock
  problem found while the box is already running "gets an alert to an admin" — the confirmation step
  is for start-up; (3) the confirmation is recorded, alerted and emailed like the other clock
  changes.

What that removes from revision 3: `DEVICES_MAY_SET_BACK_PAST_LAST_SALE` and `devicesMaySet` (Task
10), the watch setting the clock from two agreeing devices and setting `clock.unusable` from them
(Task 11a), the devices half of the administrator's `witnessed` refusal (decision 10), and
(revision 5) slice 9's devices-only lift while the start-up window is open (decision 18). What it
adds: decisions 14–18 and Tasks 8-0, 8a, 11b, 12a, 12b, 13a and 13b. The finished pull request still parks
`needs-owner-review`; the lane never lands it.

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

- **No new column is needed** (revision 5: one migration is, for the CHECKs — next bullet). `clock_confirmations` already has `box_clock_at` (the reading before
  any step), `confirmed_at` and `step_ms`
  (`packages/fiscal-verifactu/src/schema/clock-confirmations.ts:35-38`;
  `drizzle/0011_clock_checks_and_confirmations.sql`, columns `box_clock_at`, `confirmed_at`,
  `step_ms integer NOT NULL`, no CHECK on `step_ms`, so a negative step stores). Its `reason` CHECK
  already allows `unusable` and its `check_id` is nullable (same file). Both writers today store
  `stepMs: 0` and `boxClockAt = confirmedAt` (`clock-confirmation.ts:217-219`,
  `clock-checks.ts:187-189`). `count()` is a plain `integer`
  (`packages/db/src/schema/columns.ts:148`).
  The new alert is an `incidents` row, whose `code` is free text with only a non-empty CHECK
  (`packages/db/src/schema/incidents.ts:78`). Only Task 8-0's migration changes a table, so
  `git diff main --name-only -- '*/drizzle/*' packages/migrations` must print only that migration's
  SQL, its snapshot and the journal of `packages/fiscal-verifactu/drizzle/` at the end.
- **A staff member's confirmation needs one migration, and the rebuild is safe** (revision 5,
  the lead's ruling R2, replacing revision 4's "fits the shipped table"). The shipped CHECKs allow a
  person only with `source = 'admin'` and allow no `staff` value
  (`packages/fiscal-verifactu/drizzle/0011_clock_checks_and_confirmations.sql:30`, `:32`). Widening
  them makes drizzle-kit rebuild the table (copy into `__new_clock_confirmations`, drop, rename), as
  every CHECK change on this engine does — the shape is visible in a shipped rebuild,
  `packages/adjustments/drizzle/0005_lucky_chamber.sql`. Checked 2026-10-31 against CLAUDE.md §3's
  migration traps:
  - **Nothing points at the table.** A grep of every `.sql` and `.ts` file under `packages` and `apps`
    for a `REFERENCES` clause naming `clock_confirmations`, or a drizzle `references(() =>
    clockConfirmations…)`, printed nothing, so the
    rebuild's `DROP TABLE` (foreign keys stay ON inside the migrator's transaction) cascades into and
    is refused by no child.
  - **No trigger body in any set names it.** `/usr/bin/grep -rln clock_confirmations --include='*.sql'`
    over the tree printed only `packages/fiscal-verifactu/drizzle/0011_clock_checks_and_confirmations.sql`
    (and its copy under `apps/server/dist/`), and the TypeScript hits are comments, the
    classification (`packages/fiscal-verifactu/src/classification.ts:13`) and the backup
    verifier's foreign-key list (`backup-verification-history.ts:435-437`) — no trigger SQL. The
    change feed's triggers (`waitron_change_*`) are dropped before every migration
    (`packages/db/src/change-feed.ts:144-151`, called first in `applyMigrations`,
    `packages/migrations/src/apply.ts:65`).
  - **Its own append-only triggers** go with the `DROP TABLE` and are put back right after the set
    (`installAppendOnlyTriggers`, called inside the per-set loop at `apply.ts:74`, its comment
    `:72-73`; `create trigger if not exists`,
    `packages/store/src/append-only.ts:58-65`). Boot counts only triggers missing BEFORE the
    migration (`missingBeforeMigration`, `apps/server/src/boot.ts:1011-1014`), so the rebuild
    raises no `append_only.triggers_restored` warning.
  - **No expression index** (its three indexes are on plain columns, `schema/clock-confirmations.ts:50-52`)
    and **no column added in the same generation**, so neither drizzle-kit 0.31.x rebuild trap
    applies (drizzle-kit `^0.31.11`, e.g. `packages/adjustments/package.json:40`).
  - **Journal times:** the set's latest `when` is `1792872397401`
    (`packages/fiscal-verifactu/drizzle/meta/_journal.json:85`), before today's clock
    (`1793432504000`, `date +%s000` on 2026-10-31), so a generation made now sorts after it.
  - **The rehearsal, on the app's engine:** a script ran under Node v26.11.1's `node:sqlite` (SQLite
    3.54.0) built the shipped `CREATE TABLE` (from `0011…sql`), its seq index, the two append-only
    triggers and two rows, then ran a rebuild written in drizzle's shape with the wider CHECKs inside
    `BEGIN … COMMIT`. It printed: foreign keys still `1` inside the transaction after `PRAGMA
    foreign_keys=OFF`; `rows after: 2`; append-only triggers after the rebuild `0` (so `apply.ts`
    must put them back, as it does); parents intact; the CHECK text rewritten from
    `__new_clock_confirmations` to `clock_confirmations`; then `staff` with a person inserted, while
    `staff` without a person, `devices` with a person, `admin` without a person and an undeclared
    source were each refused by the named CHECK. **The same rename FAILS under the system `sqlite3`
    3.51.0 CLI** (`error in table t after rename: no such column: __new_t.a`, on a two-line
    reproduction), so a rehearsal of a drizzle rebuild must run on `node:sqlite`, not the CLI.
  - **Existing schema tests stay green:** `packages/fiscal-verifactu/src/clock-confirmations.test.ts`'s
    refusal table (`:211-231`) uses `"clock"` as the undeclared source and keeps `devices`-with-a-person
    and `admin`-without-one refused; "keeps a full row for every declared source and reason"
    (`:143-192`) inserts four named sources and passes unedited (Task 8-0 adds a `staff` case beside it).
  Pre-live, CLAUDE.md §3's "No backwards-compatibility or data-migration code until Waitron is in
  production" covers it: the rebuild copies every existing row, and no reader of old rows changes.
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
| M5′ (Task 4) | [41175687596](https://github.com/clintongormley/waitron/actions/runs/41175687596), [41176674962](https://github.com/clintongormley/waitron/actions/runs/41176674962) | `group: waitron-box:x:10001:`; `socket start rc=0; srw-rw---- root:waitron-box`; status `reply {"ok":true,"service":"on","unit":"chrony.service","synchronised":false,"lastSyncAt":null,…}` with the host's boot id; `clock.set 1793428183845 … reply {"ok":true,"beforeMs":1793428153993,"afterMs":1793428183867}`; `chronyd after the set: active`; logged `clock.set target=1793428183845 requester={"source":"measure"}` | expected — the shipped handler answers an unprivileged container and lands 22 ms from the target, then starts chrony again (run 3 the same) |
| M7′ (Task 4) | [41175687596](https://github.com/clintongormley/waitron/actions/runs/41175687596), [41176674962](https://github.com/clintongormley/waitron/actions/runs/41176674962) | without the variable `{"type":"volume","source":"box_socket",…}`; with it `{"type":"bind","source":"/run/waitron-box",…,"bind":{"create_host_path":true}}` | expected — and taken locally with no Docker daemon too (Task 3) |
| M8′ (Task 4) | [41175687596](https://github.com/clintongormley/waitron/actions/runs/41175687596), [41176674962](https://github.com/clintongormley/waitron/actions/runs/41176674962) | file made for the row, mtime `1793431785` (an hour ahead), now `1793428185`; backward `clock.set 1793428065051 … afterMs 1793428065074`; after: mtime `1793428065`, now `1793428065` | expected — the handler moves timesyncd's clock file with a backward set. The runner has no timesyncd, so the file was made for the row; what timesyncd does with it at the next boot is not measured (Task 19's backlog entry) |
| M9′ (Task 4) | [41175687596](https://github.com/clintongormley/waitron/actions/runs/41175687596), [41176674962](https://github.com/clintongormley/waitron/actions/runs/41176674962) | run 3: `Unknown key name 'CollectMode' in section 'Service', ignoring`, `CollectMode=inactive` — **FAILING CASE**, a defect in the unit file (fixed in 6debb905d: the key moved to `[Unit]`); run 4: `verify rc=0 output: <none>`; `RuntimeMaxUSec=15s StandardError=journal CollectMode=inactive-or-failed`; `/run/systemd/system: present` | expected on run 4 |
| M10′ (Task 4) | [41175687596](https://github.com/clintongormley/waitron/actions/runs/41175687596), [41176674962](https://github.com/clintongormley/waitron/actions/runs/41176674962) | `chronyd stopped by the instance after 1 s, active again after 16 s; markers left:` (none); journal `Service reached runtime time limit. Stopping.`, `Failed with result 'timeout'` | expected — the unit's stop step starts the time service again after a kill at the limit, and removes the marker |

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
   correction (decision 6): the clock may have moved. **Built (Task 5 review):** a connection that
   breaks, or closes with no answer, after the request was sent answers `lost`, not `missing`; Task
   10 treats `lost` exactly as `timeout` (verified, `verified: false` when the clock did not move to
   the target), and only `missing` means nothing was asked of the host. `missing` carries the
   socket error's code as `detail`; a requester is sent with non-ASCII escaped and refused unsent
   over 512 bytes.
5. **The time service is watched.** `checkTimeHealth` reads `clockStatus()` instead of running
   `timedatectl` itself, keeping its answer's shape (`synced`, `source`, `warn`): `source:
   "timedatectl"` stays true, since the host reads `timedatectl`. Both `/api/box/health` and
   `/api/box/status` read it through one 60-second cache. `clock.sync_off` (warning, area `box`,
   `system.manage`, `screen: "box-status"`, params `{ reason }`, reasons `off`, `stopped`,
   `unsynchronised`, `unreachable`) is an ongoing alert source over the same cached status;
   `unreachable` only when `config.environment === "production"`. Its `unreachable` words follow
   decision 13.
6. **When the box sets its clock** (`apps/server/src/clock-correction.ts`, called by the watch, by
   the administrator's route and by the till's route), during a stop the box already has
   (revision 4, the owner's 2026-10-31 rule):
   - the clock behind the latest record (the stop proper, `clockBehindChain` non-null), AEAT
     disagreeing (`contrary.authority`) → AEAT's time, by the watch, with nobody asked;
   - either stop — the stop proper, or the clock before 28-10-2024 (`clock.unusable`) — found at
     start-up (decision 14), once the box has tried AEAT and had no answer or cannot ask it (AEAT
     cannot be reached during `clock.unusable`: its certificate cannot be checked; the production QR
     host's certificate starts 2025-11-17, claim check T27): a till's time that differs by more than
     a minute, on the Confirm of a staff member signed in on that till (decision 15);
   - either stop, at any time, with no AEAT witness taken during it: an administrator's device that
     differs by more than a minute, on their Confirm ("Use your device's time?" in the dashboard, or
     on a till they sign in on, revision 5, decision 15).
   **Devices never set the clock by themselves any more**: a group of devices from two addresses
   disagreeing is kept in the proof and shown on Box status, and sets nothing (revision 4; the
   owner's 07:00 rule replaces their 24 October 04:24 one). Never while `clockStatus()` says
   synchronised; never when the host service is unavailable.
   **Each set carries where its offset was measured** (round 2, C1): `measuredAt: { wallMs,
   monoMs }`, the box's wall and steady clocks when the witness's reading arrived (for AEAT, the
   store's `BoxClockReading`: the store gains `forSetting()`, handing out each AEAT reading WITH its
   `at`, AEAT's kept disagreements now stored with theirs; for a till or an administrator, the
   readings the route takes at its round trip's midpoint), and `stepsSeen`, the correction's step
   counter when the caller measured. The counter rises once for every `clock.set` sent to the host,
   whatever its answer. The target is the wall clock now plus the offset — valid only while no
   step has happened since `measuredAt`.
   **Order (round 1, M7; round 2, C1, I2), each step tested in order:** take the one-at-a-time
   turn — the same turn the watch's two confirmation writers (`confirm` and `closeWaiting`),
   `POST /api/box/clock-confirm` and the till's agreeing confirmation (decision 15) now take, so no
   confirmation lifts or closes the stop between the judging below and the row. **The turn is
   always taken before the write lock, never inside it**
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
   fresh reading, else `not_stopped`; for `admin` and `staff`, also `witnessed`; for `staff`, also
   the start-up window's `not_start_up` and `authority_pending`, decision 15); read `clockStatus()`
   fresh;
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
   check's id) for 10 minutes by the steady clock, doubling after each further failure up to 4
   hours; a new stop starts again at none. Refusals that ask nothing of the host (`synchronised`,
   `host_unavailable`, `stale`, `not_stopped`) are not backed off: they toggle nothing. A person's
   set — an administrator's or a staff member's — is never held back by it. (Revision 4: the watch
   sets only from AEAT, so only during the stop proper; `clock.unusable` has no automatic set.)
7. **The row** (seat method `confirmClockStep`, Task 8): one `clock_confirmations` row,
   `box_clock_at` the reading before, `confirmed_at` the reading after, `step_ms` the measured step
   (`(wallAfter − wallBefore) − (bootAfter − bootBefore)`, rounded), `source` `authority`,
   `admin` or `staff` (revision 5: `staff` is a real value, Task 8-0, decision 16), `person_id` the
   administrator or staff member, `proof` the witnesses that set it (`authority`; `admin` for an
   administrator's device; `staff` for a staff member's till reading; and `till` naming the till
   when the device was one — each key written only when set, decision 16) plus `step: { beforeAt,
   afterAt, stepMs, targetAt }` and, for a stop, `heads` and `closing` as slice 9 writes them. For
   the clock-behind stop: it closes the open check (opening one at the
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
9. **`clock.corrected`** params `{ confirmationId | null, source, person | null, deviceId | null,
   device | null, before, beforeOffsetMinutes, after, afterOffsetMinutes, stepMs, verified }`,
   `source` `"authority" | "admin" | "staff"`, plus the booleans `byAdmin` and `byStaff` that pick
   the bell's words (a variant is chosen by its param being `true`,
   `packages/dashboard-kit/src/alert-messages.ts:14-16`, `:84-88`), `person` the administrator's or
   staff member's name
   (`person` is on `PERSONAL_LOG_KEYS`, `apps/server/src/log-personal-data.ts:38`, so the logger
   masks it), `deviceId` and `device` the proposing till's id and its label for `staff` (the owner's
   "which till proposed"), severity warning, no sale.
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
    `host_unavailable`; `synchronised`; `witnessed` (AEAT has spoken during the stop — any AEAT
    reading among the stop's witnesses, agreeing or disagreeing, for both `admin` and `staff`
    (revision 5a) — and the box can set its clock: it sets or confirms from AEAT itself — revision 4: devices no longer count
    here, since they no longer set the clock); `agrees` (the
    device is within a minute: confirm instead); `stale` (the clock stepped while the request was
    in flight: read the time again). `clock.check_expired` (400) as today; a failed or unverified
    set is `clock.set_failed { reason: "refused" | "unverified" }` (502). No transaction is held
    while the host sets. It is open at any time, start-up or running: it is how an administrator
    answers the running-time alert (decision 17).
11. **Every job that reads the wall clock** is made safe for a step of days, or accepted with a
    reason (round 1, I5), in Tasks 14, 15, 15a and 15b: backups pruned by the age in their names;
    the stream's generation pruning; management sessions (the lead's ruling (d)) and passkey
    challenges whose stored time is ahead of the clock; a shift begun before a backward step; then
    whatever the audit's greps find (Task 15's table). The STOP rule covers a job that deletes data,
    keeps a credential alive past its limit, cuts tills off, or blocks a legal record (round 2, I7).
12. **What 9c inherits:** the anchor registration of decision 6 (9c's change guard registers
    beside the watch); `confirmClockStep` taking any open check's reason (9c's `start`, `change`,
    `disagrees`); `clock.sync_off`'s `unreachable` (9c's alert-not-stop case, design §4.9 h.2);
    and, from revision 4, the till's check (decision 15) with its `staff` source (decision 16) and
    the start-up window (decision 14), which 9c widens so that the till is offered while its `start`
    check is open, with decision 18's hold on the devices-only lift. 9b opens no check of its own and adds no stop.
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
14. **Start-up, in code, and how it splits between 9b and 9c** (revision 4; the owner's "before
    continuing with startup"). A new `apps/server/src/clock-start-up.ts` holds, for this server
    process, a start-up window and what AEAT has said during it:
    - **Opens** when `bootServer` creates it — before the tills' notice sources are built
      (`deviceNoticeSources`, `apps/server/src/boot.ts:2011`), which is earlier than the clock watch
      (`:2441`) and the routes (revision 5, M6) — and only on a node that is the primary at its start
      (`isSingletonPrimary`, `boot.ts:1668`, a boot decision that "an in-process promotion does not
      start … without a restart", `:1666-1667`). On any other node it is created closed, so a node
      promoted while running treats a stop it then has as a running one, and a restart after the
      promotion opens it as usual (revision 5, the review's split-soundness point: the watch returns
      early off the primary, `clock-watch.ts:214-217`, so a window opened there would never close).
      The reverse case (revision 5a): a node that is primary at its start and demoted while running
      keeps its window open, since the watch asks `isPrimary` on every look (`boot.ts:2450`) and
      returns early once it is false, so no look closes it. Little harm: the tills follow the
      primary (CLAUDE.md §5), so the demoted node's offer and route are not where a till asks.
    - **Closes for good** when any reader of the stop sees none holding: the clock watch's look — the
      branch where it already ends the stop for the witness store (`stop === null` and the reading
      recordable, `apps/server/src/clock-watch.ts:255-259`), or a stop state whose `proof` is
      `confirmed` (a covering confirmation has lifted it, and the seat still answers a state then,
      `packages/fiscal-verifactu/src/clock-confirmation.ts:76-77`, `:125`, so the look takes the
      `stop !== null` branch, `clock-watch.ts:268`) — and equally the till notice source's own read and
      the till route's judging (decision 15), each with the same test. A reading before 28-10-2024 is
      not recordable, so `clock.unusable` keeps it open. A stop that holds from the start with no
      reader having seen it end is a **start-up stop**; any stop after the window closed is a
      **running stop**. **No time bound** (revision 5): staff may arrive hours after a box started
      alone, and the owner's rule is about that start. A look whose read keeps throwing closes
      nothing; while every read of the stop fails, the other two readers fail too and nothing is
      offered (the notice source's read is the offer), so the window stays as it was until a read
      succeeds — stated, not fixed.
    - **What AEAT said**: `not_asked`, `unanswered` or `answered`. The watch's `askAuthority`
      (`clock-watch.ts:172-179`) reports `answered` on a sample and `unanswered` on null; an AEAT time
      noted from a filing reply (`boot.ts:1633`, `createAuthorityClockStatus({ onSample })`) reports
      `answered`. `answered` stays for the rest of the window.
    - **`tillMayOffer(reading)`**: the window is open, a stop holds at the reading (the stop proper
      with no covering confirmation, or `clock.unusable`), and AEAT cannot help: the reading is
      before 28-10-2024, or the box cannot ask (`filesRecords()` false, or no `readAuthorityTime`
      on the seat, `clock-watch.ts:173`), or AEAT is `unanswered`. FYI 9 gives the timing.
    - **`admit(...)`, for the till route's staff branch** (revision 5, I7): `not_start_up` once the
      window has closed; `authority_pending` while AEAT is `not_asked` and the box can ask; **null
      otherwise — including once AEAT has `answered`**, although `tillMayOffer` is then false. So a
      request that arrives after AEAT answered is judged on: on the differing branch, `witnessed`
      whenever an AEAT reading taken during the stop is among the witnesses and the box can set its
      clock, whether AEAT agreed with the box or not (decision 10, revision 5a); on the agreeing
      branch, `contrary_proof` when AEAT disagrees. The agreeing case matters because the watch
      confirms before it asks AEAT in the same look (`clock-watch.ts:279-288`), so an agreeing AEAT
      answer lifts the stop only at the next look, up to `CLOCK_WATCH_MS` (15 s,
      `clock-watch.ts:16`) later; a differing till served in that
      gap would set the clock against AEAT. An agreeing AEAT reading stays among the witnesses while
      it is fresh, five minutes by the steady clock (`clock-witnesses.ts:26-29`).
    - "Start" is the server process's start, a restart included (FYI 8). The boot reader's boot id
      (`apps/server/src/boot-reader.ts:45-51`) could tell a machine boot from a restart; it is not
      used for this.
    **Why the gate is 9c's, not 9b's.** 9b opens no new stop ("Global constraints"); a stop at
    every start that refuses every record is 9c's whole risk, with its own test fallout (9c outline,
    "Tests that boot a whole server"). So **9b builds the till's proposal and the staff member's
    confirmation for the stops the box already has at start (the stop proper and `clock.unusable`),
    and 9c makes them the gate** by opening a `start` check at every start, during which the till is
    offered too. Cost until 9c lands: a clock wrong FORWARD at start, or wrong backward by less than
    the gap to the last sale, raises no stop, so nobody is asked and sales are dated on it, as today.
    9c's outline is updated in this commit.
15. **The till's check** (revision 4; the owner's 07:00 rule and 07:05 point 1).
    - **Offered** through a marker from the box's own staff notice source (`boxStaffNoticeSource`,
      `apps/server/src/box-staff-notices.ts:45-53`): `clock.check_time`, severity `error`, no params,
      sent while `tillMayOffer(reading)` holds, to the tills' notice sources only. **The till draws
      no line of its own for it** (revision 5, I5 b): while it holds the marker, its existing
      `clock.behind_chain` / `clock.unusable` line keeps its words and swaps its hint «Tell a
      manager» (`apps/till/src/i18n/staff-notices.ts:8-15`, `:27-29`) for a "Check the time" button,
      and the matching payment refusals (`apps/till/src/i18n/codes.ts:783-790`, drawn by
      `apps/till/src/widgets/pay-refusal.ts:78-85`) end "Use «Check the time» at the top of the
      screen" instead of «Tell a manager» (FYI 13, Task 13a). With no marker every word is as
      today. A till too old to know the code would draw it as "The box needs attention"
      (`staff-notices.ts:6`, `:53`) — tills load from the box they talk to, so that lasts only until
      the till reloads.
    - **Two routes on the till API**, `POST /api/box-clock/challenge` and `POST /api/box-clock/confirm`
      (not under `/api/clock/`, which is attendance clocking, `apps/server/src/till-clock-api.ts:87`,
      `:106`). Both refuse `clock.set_refused { reason: "same_machine" }` when the request comes from
      the box (`requestFromBox`, `apps/server/src/request-from-box.ts:40-42`) outside development —
      slice 9's rule that the box's own screen is never a witness; take `requireSession(deps, c)`
      (`apps/server/src/till-session.ts:93-143`) with the device profile admitting the person
      (`canUseDeviceProfile`), refused `device_profile.not_admitted` (403) as the till's other routes
      outside attendance refuse it (`apps/server/src/till-api.ts:1039-1040`, `:466`;
      `department-transfer-api.ts:54`, `tender-refund-api.ts:81`, `device-zones.ts:18`) and checked
      AGAIN inside the confirm's own transaction, as `till-clock-api.ts:109-111` re-admits inside
      its write (revision 5, I6); no permission and no profile action (any staff member, FYI 13); and
      use their own `clockChallenges` instance keyed by the till session's id
      (`apps/server/src/clock-challenges.ts:23-58`; a challenge lives 5 s, `:3`).
    - **An administrator on a till, at any time** (revision 5, I5 a). When the session's person holds
      `person.admin`, or the body carries `override: { personId, pin }` of someone who does — checked
      as the drawer route checks its override: `overrideToCheck`, `withPinCheckAhead` outside any
      transaction, then `authorize(tx, { sessionId, permission, override }, attempts)` with the
      device's override PIN attempts (`apps/server/src/till-api.ts:2650-2668`, `:745-750`;
      `apps/server/src/pin-check-ahead.ts:24`, `:55-74`) — the confirmation is an administrator's:
      `source: "admin"`, no `admit` (the window does not bound it, as decision 10's route is not
      bounded), `proof.admin` the reading and `proof.till` the till. A till is an administrator's
      device that is not the box, as decision 10 requires. This is the sign-in the `not_start_up`
      refusal offers in place (CLAUDE.md §3; `docs/developers/conventions-ui.md:15-17`: "If a choice
      needs more rights, offer administrator or owner sign-in there").
    - **challenge** checks `not_stopped`, `not_start_up` and `authority_pending` first, so the dialog
      shows a refusal at once, and answers `{ challengeId, boxAt }`.
    - **confirm** takes `{ challengeId, deviceAt }` — the till's own clock, never a typed time —
      parsed as `confirmBody` does (`apps/server/src/box-health-api.ts:87-102`); takes the challenge
      (`clock.check_expired` when gone); computes the box's time at the round trip's midpoint and its
      uncertainty as the administrator's confirmation does (`box-health-api.ts:278-294`), keeping the
      wall and steady readings there as `measuredAt` and `correction.steps()` as `stepsSeen`. Then,
      first `target_invalid` (the till's time before 2024-10-28 or from 2100 on), before any turn;
      then one of two branches, each judged inside the correction's turn:
      - **the till agrees** (within a minute, uncertainty included — slice 9's `adminAgrees`,
        `packages/fiscal-verifactu/src/clock-confirmation.ts:133-138`): in `correction.inTurn`, one
        transaction that answers `stale` when the correction's step counter is no longer
        `stepsSeen` (a set landed after the reading, so the comparison is void), then checks the
        person's admission again (`device_profile.not_admitted`), then `not_stopped`, then the
        window's `not_start_up` or `authority_pending` (skipped for an administrator), then runs
        slice 9's `confirmClockStop` with the person as its `admin` input, marked `role: "staff"`
        for a staff member (Task 8a) — refused `clock.confirm_refused { reason:
        "contrary_proof" }` when AEAT or a group of devices disagrees during the stop, as for an
        administrator; it lifts the stop with no step, and `clock.behind_chain_restarted` names the
        person and the till (FYI 10; its words, Task 8a). A `clock.unusable` stop cannot reach this branch: an
        agreeing till would read before 2024-10-28 too, which `target_invalid` has refused;
      - **the till differs**: `correction.set` with `source: "staff"` (or `"admin"` for an
        administrator), the till's offset and — for a staff member only — the window's check plus
        the admission check as `admit`, which judges in Task 12's order — `stale`, `not_stopped`,
        then `admit` (`device_profile.not_admitted`, `not_start_up`, `authority_pending`),
        `host_unavailable`, `synchronised` (FYI 2), `witnessed` (AEAT has spoken during the stop,
        agreeing with the box or not, and the box can set its clock — decision 14, revision 5a).
        `admit`'s `"not_admitted"` is answered at the route as `device_profile.not_admitted` (403),
        the same code and status as the route's other admission refusals, never as
        `clock.set_refused`; its `not_start_up` and `authority_pending` are `clock.set_refused {
        reason }` (409).
      - **Where an administrator's override is checked** (revision 5a). On the agreeing branch,
        `authorize(tx, …)` runs inside that branch's one transaction, before `confirmClockStop`. On
        the differing branch, `correction.set` holds no transaction while the host sets (decision
        10), so `authorize(tx, …)` runs in its own `withTransaction` inside `withPinCheckAhead`,
        before `correction.set` and outside the correction's turn — a **commented decision at the
        site** (CLAUDE.md §3: splitting one logical change across transactions is a commented
        decision). The comment says what the split costs: an administrator whose `person.admin` is
        withdrawn between that transaction and the set is still served, and the stop is judged
        again inside the set's own turn either way.
      It answers `{ confirmationId, stepMs, confirmedAt }`; a failed or unverified set is
      `clock.set_failed` (502). The host's requester is `{ source: "staff" | "admin", person:
      <uuid>, device: <uuid> }`, ids only. Either branch that sees no stop holding closes the window
      (decision 14).
    - **Revision 5 replaces revision 4's "Not changed"**: the clock line's hint and the clock
      payment refusals change while the marker is held (the first bullet); with no marker they read
      as today.
16. **A staff member's row** (revision 5, the lead's ruling R2, replacing revision 4's "under
    `admin`" scheme; FYI 15). Column `source = 'staff'`, `person_id` the staff member. Task 8-0's
    one migration widens `clock_confirmations_source_ck` to `authority`, `devices`, `admin`,
    `staff`, `elapsed` and makes `clock_confirmations_person_ck` read "`source` is `admin` or
    `staff` ⇔ `person_id` is not null" (with its non-empty test kept); `ClockConfirmationSource`
    (`packages/fiscal/src/backend.ts:184`) and the schema's `clockConfirmationSource`
    (`packages/fiscal-verifactu/src/schema/clock-confirmations.ts:7`) gain `staff`. The receipts
    that the rebuild is safe are under "What slice 9 left". **The proof's keys are written only
    when set** (revision 5, C1): a staff member's till reading under `staff = { deviceId, address,
    boxAt, witnessAt, uncertaintyMs }`, and for an administrator confirming on a till a `till = {
    deviceId, address }` beside slice 9's `admin` reading; a row with neither carries neither key,
    because slice 9's whole-proof `toEqual` cases would fail on an extra `null` key
    (`packages/fiscal-verifactu/src/clock-checks.test.ts:241-265`, `:455-475`;
    `clock-confirmation.test.ts:229-245`). **Every reader of the source learns `staff`** (Task 8a):
    traced 2026-10-31 with `/usr/bin/grep -rn 'ClockConfirmationSource\|clockConfirmationSource'
    apps packages --include='*.ts'`, tests left out — `apps/server/src/box-health.ts:42`,
    `apps/server/src/misdated-sales-csv.ts:26-31` (whose `satisfies Record<ClockConfirmationSource,
    …>` fails to compile until `staff` has words, so the type checker finds that reader),
    `packages/fiscal-verifactu/src/clock-checks.ts:173`, `:347`, `clock-misdated.ts:42`, `:73` —
    and the local copies that follow them: the dashboard's confirmation type
    (`apps/dashboard/src/api/client.ts:1888-1893`) and `confirmedBy` (`box-status-rows.ts:387-396`),
    the bell's `clock_confirmed_by` words (`alert-messages.ts:507-516`), the email's
    `CLOCK_CONFIRMED_BY_WORDS` (`apps/server/src/i18n/box-emails.ts:45-58`, read at
    `box-alert-email.ts:97-108`), and `clock.behind_chain_restarted`'s `confirmedBy` param type
    (`packages/fiscal-verifactu/src/errors.ts:380`).
17. **A running stop alerts the administrators** (revision 4; the owner's 07:05 point 2). During a
    running stop the till offers nothing (no `clock.check_time`; a till's confirm answers
    `not_start_up`), AEAT still sets the clock by itself, and the alert is the one the stop already
    raises: `clock.behind_chain` / `clock.unusable`, in the bell and by email to everyone holding
    `system.manage`, administrators included (FYI 11). Its bell entry already opens Box status
    (`screen: "box-status"`, `packages/fiscal-verifactu/src/clock-behind-alerts.ts:20`, `:33`),
    where the administrator's "Use your device's time?" is (decision 10). Task 13b rewrites the
    words; no new code.
18. **During start-up, two agreeing devices do not lift the stop by themselves** (revision 5, the
    lead's ruling R1; the owner's 07:00 "ask for confirmation from a human before continuing with
    startup"). Slice 9's watch confirms on `proof === "ready"` (`apps/server/src/clock-watch.ts:279-285`),
    which a group of agreeing devices alone makes ready
    (`packages/fiscal-verifactu/src/clock-confirmation.ts:79-81`; the seat writes it with no person,
    `:184-185`). From this slice the watch also requires, while its optional `startUp` window is
    open, that AEAT is among the agreeing witnesses: `if (stop.proof === "ready" &&
    !(startUp?.open() === true && stop.agreeing.authority === null)) confirm(…)`. AEAT agreeing
    still lifts; outside the window, and in every harness that builds the watch with no window, the
    devices lift is unchanged. Read, not run: the slice-9 cases that lift or close on two devices —
    `apps/server/src/clock-watch.test.ts:593-618` ("confirms the clock once when the witnesses are
    ready…", its log naming `source: "devices"`) and `clock-watch.restart.test.ts:276`, `:333` (two
    devices closing a WAITING check through `closeWaiting`, which this gate does not touch) — build
    the watch through harnesses that pass no `startUp` (`clock-watch.test.ts:120`,
    `clock-watch.restart.test.ts:83-91`), so no existing assertion changes. `closeWaiting` is left
    alone on purpose: it closes a check whose stop has already ended, so it restarts nothing, and a
    look that finds the stop ended closes the window in the same branch (decision 14). The till's
    agreeing confirmation (decision 15) is how a person confirms the box's own time during
    start-up.

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
9. *(Revision 4.)* `apps/server/src/box-alert-email.test.ts:76-82` ("writes both times, each in its
   own offset, in English", the `clock.behind_chain` email's exact text): its "What to do" sentence
   changes with decision 17 — no "call whoever installed it", no "two tills switched on, the box
   does it by itself"; an administrator's own device and, after a start, a staff member on a till
   instead. The case keeps both times and the subject; only the expected text changes. The Spanish
   case (`:84-94`) builds its expectation from the words file and passes unedited. Task 13b.
   (`/usr/bin/grep -rln 'whoever installed\|two tills switched on' apps packages --include='*.test.ts'`,
   run 2026-10-31, printed this file and `recovery-surface.test.ts`, whose lines are about a
   different page and are not touched.)

**Whole-shape lists gaining entries** (the owner's standing exception of 2026-09-27):
2. `packages/fiscal-verifactu/src/alerts.test.ts:10-11` (`FISCAL_ALERTS` `toEqual`) gains the
   `clock.corrected` claim. Task 8.
2a. *(Added while building Task 8, 2026-10-31.)* `apps/dashboard/src/i18n/alerts.test.ts:267-271`
   ("names only registered word lists in its word-list slots…"): its hand list of the formatter's
   built-in kinds (`money`, `date`, `bytes`, `minute`) gains `duration`, the kind Task 8 adds to
   `packages/dashboard-kit/src/alert-messages.ts` so `clock.corrected` can write its step in
   words from the browser's own locale data (`Intl.NumberFormat` units, `Intl.ListFormat`), with
   no Spanish in the kit. The `toEqual([])` is unchanged. Task 8.
3. `scripts/ongoing-alert-codes.test.ts`'s hand list of source files gains
   `apps/server/src/clock-sync-alert.ts`. Task 7.
4. `packages/fiscal-none/src/backend.test.ts:74-81` and
   `packages/fiscal/src/testing/fake-backend.test.ts:66-74` gain
   `expect(x.confirmClockStep).toBeUndefined()` (Task 8) and
   `expect(x.latestClockStep).toBeUndefined()` (Task 14); no existing line changes.
5. Any whole-list assertion of `INCIDENT_EMAIL_CODES` gains `clock.corrected` (expected: none —
   `/usr/bin/grep -rn 'INCIDENT_EMAIL_CODES' apps/server/src --include='*.test.ts'` printed nothing
   on `65bc0441a`; re-run in Task 9 and list any it finds). Task 9.
10. *(Revision 4.)* `apps/dashboard/src/i18n/alerts.test.ts:509-519` ("words each way the clock can
    be confirmed", a `toEqual` of the `clock_confirmed_by` words) gains `staff: { en: "a staff
    member", es: expect.any(String) }`; its three entries and `otherwise` are unchanged. Task 8a.
11. *(Revision 4.)* The route map comment of `apps/server/src/till-api.profile-actions.test.ts`
    (`:39-…`) gains a row for `POST /api/box-clock/challenge, /confirm` — "admitted session; no
    profile action" — naming its refusing and allowed cases (CLAUDE.md §3). A comment, not an
    assertion; listed so the review checks the row. Task 12a.

14. *(Added while building Task 10, 2026-10-31.)* `packages/fiscal-verifactu/src/clock-step.test.ts`
    `:219`, `:527` and `:538`: three `toEqual`s of `confirmClockStep`'s whole answer gain the
    `corrected` key Task 10 adds (`expect.anything()` for the two that record an alert, `null` for
    the sub-second unverified step); every existing value is unchanged. New cases check what
    `corrected` holds. Task 10.

15. *(Added after CI on Task 11b's review fold, 2026-10-31.)*
   `apps/server/src/boot.disk-full-wiring.test.ts:254` (the equipment read's notice owners,
   `toEqual(["box", "fiscal-verifactu"])`) gains `"box-clock"` between them: Task 11b's review
   gave the till's clock marker its own owner, so a failing clock read never marks the box's
   storage notices unavailable. Both existing owners keep their values and order. CI run
   41202806427 (`test-server (19)`) is where it failed.

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
12. *(Revision 4.)* `clock-watch.test.ts`'s harness passes no `startUp` dep either, which the watch
    reads as "nothing to tell" (Task 11b). Listed so the review checks that no existing case changed.
13. *(Revision 5a.)* `apps/server/src/hour-recovery-staged.test.ts:66-98` (`olderBackup()`, "a
    backup taken by the release before fiscal-verifactu's 0009"): it undoes the set's latest three
    migrations by hand, newest first — each step drops that migration's schema, deletes the row with
    the largest `created_at` from `__drizzle_migrations_fiscal`, and lowers
    `manifest.modules["fiscal-verifactu"]` by one (`:80-85` for 0011, `:86-91` for 0010, `:92-98`
    for 0009). Once Task 8-0's migration is the newest, those three deletes remove 0012's, 0011's
    and 0010's rows instead, so the backup records 0009 applied while 0009's two columns are gone;
    the test still passes but no longer tests what its comment says (the claim check's probe
    printed `{"n":10,"m":1792550481436}`, 0009's `when`, and no `technical_incidence` column). The
    edit adds one step before `:80`: delete the largest-`created_at` row (0012's; its rebuild
    leaves the same columns, and the next step drops `clock_confirmations` anyway) and lower the
    manifest count by one more. The comment at `:67-68` stays true. No assertion changes. Task 8-0.

**Must pass unedited:** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (the golden huella),
`inmutabilidad.test.ts`, `apps/server/src/boot.box-health.test.ts:209-224` ("caches the clock check
and the disk walk for a minute…", which mocks `checkTimeHealth` by name: the name stays), every
`clock-confirmation*`, `clock-checks*`, `clock-behind*`, `clock-misdated*` and `clock-confirm.route`
test (Task 8a's `staff` is a new optional input and an answer key left out unless set, decision 16),
`packages/fiscal-verifactu/src/clock-stop-incidents.test.ts` (its `confirmedBy` cases keep their
values), `packages/fiscal-verifactu/src/clock-checks.test.ts` and `clock-confirmation.test.ts`
(their whole-proof `toEqual` cases, `clock-checks.test.ts:241-265`, `:455-475`,
`clock-confirmation.test.ts:229-245`, hold because a proof key is written only when set, decision
16), `packages/fiscal-verifactu/src/clock-confirmations.test.ts` (Task 8-0 adds a case beside
"keeps a full row for every declared source and reason", `:143-192`), every `clock-watch*` suite
(decision 18's gate needs a `startUp` window, which no existing harness passes), `apps/till/src/widgets/notice-strip*.test.ts` and `apps/till/src/i18n/staff-notices.test.ts`
(Task 13a adds a code and a button; no existing line's words change),
`apps/server/src/box-alert-email*.test.ts` except changed test check 9 (every other code keeps
today's episode rule and words),
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
- **Exactly one migration** (revision 5, the lead's ruling R2): Task 8-0's, in
  `packages/fiscal-verifactu/drizzle/`, changing only `clock_confirmations`' source and person
  CHECKs. At the end `git diff main --name-only -- '*/drizzle/*' packages/migrations` prints only
  that generation's SQL file, its snapshot and the set's `_journal.json`. Slice 9 declared every
  value it foresaw so that 9b would need none (slice 9 plan, R1); a staff member was not foreseen.
  Any OTHER schema change a task finds it needs is a STOP. The generation is made by drizzle-kit and
  never edited by hand; on a rebase that collides with another migration number, the migrations
  folder is reset to `main`'s and the generation made again, then verified by running the guards
  CLAUDE.md §3 names (Task 8-0).
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
kill case fails (built: both traps; with only the `TERM` one removed bash 3.2.57 still ran the
`EXIT` trap on the kill and the case passed); remove the range check → the 2100 case fails; drop
the target pattern (keep only the range) → the `01793425531250` case fails (built: a leading-zero
target in range once read as base 10 — `037000000000000` and `0370000000009` stay refused by the
range, since every sum reads `10#$t`); drop the more-than-700 check (keep
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

### Task 8-0: A real `staff` source — one migration

**Goal.** Decision 16's table change (the lead's ruling R2): `clock_confirmations` accepts
`source = 'staff'`, and a person exactly when the source is `admin` or `staff`. The earliest task
that needs it — Tasks 8, 8a and 12a write `staff` rows. Nothing writes one yet in this task.

**Files.** Modify `packages/fiscal-verifactu/src/schema/clock-confirmations.ts`
(`clockConfirmationSource`, `:7`, gains `"staff"`; the person CHECK, `:55-58`, becomes
`` sql`(${t.source} in ('admin', 'staff')) = (${t.personId} is not null) and (${t.personId} is null or length(${t.personId}) > 0)` ``;
the comment above `personId` says a person is an administrator or a staff member);
`packages/fiscal/src/backend.ts` (`ClockConfirmationSource`, `:184`, gains `"staff"`); the
generation `pnpm --filter @waitron/fiscal-verifactu db:generate --name clock_confirmations_staff`
writes (`drizzle/0012_clock_confirmations_staff.sql`, its snapshot, `_journal.json`; without
`--name` drizzle-kit picks a random name) — **made by drizzle-kit and never edited by hand**,
CLAUDE.md §3; read the SQL and check it is the rebuild "What slice 9 left" rehearsed:
`PRAGMA foreign_keys=OFF`, one `__new_clock_confirmations` table, an `INSERT … SELECT` naming all
thirteen columns, `DROP`, `RENAME`, `PRAGMA foreign_keys=ON`, the three indexes again, and nothing
else (drizzle-kit writes the two `PRAGMA` lines around every table rebuild, e.g.
`packages/adjustments/drizzle/0005_lucky_chamber.sql:1` and `:28`; inside the migrator's
transaction they change nothing, as "What slice 9 left" says);
`packages/fiscal-verifactu/src/clock-confirmations.test.ts` (new cases only); a new
`packages/fiscal-verifactu/src/clock-confirmations-upgrade.test.ts` (below);
`apps/server/src/hour-recovery-staged.test.ts` (changed test check 13);
`apps/server/src/misdated-sales-csv.ts` (`SOURCE_WORD`, `:26-31`, gains `staff: "staff"`, which its
`satisfies Record<ClockConfirmationSource, …>` now demands) and
`apps/server/src/i18n/box-emails.ts` (`CLOCK_CONFIRMED_BY_WORDS`, `:45-58`, gains `staff`: "a staff
member on a till" / "un empleado en una caja"), so the tree typechecks in this task.

**Failing tests first** (`clock-confirmations.test.ts`, red until the schema and generation exist):
a `staff` row with a person and a negative `step_ms` → kept, read back with its source; `staff`
without a person → `clock_confirmations_person_ck`; `admin` with a person → still kept (control);
`devices` with a person → still refused; the existing refusal table (`:211-231`, including the
undeclared `"clock"`) and "keeps a full row for every declared source and reason" (`:143-192`) pass
unedited.

**The upgrade test** (revision 5a), `clock-confirmations-upgrade.test.ts`, modelled on
`packages/fiscal-verifactu/src/outage-upgrade.test.ts`: copy `FISCAL_MIGRATIONS.migrationsFolder`
to a temporary folder and cut its journal below the new migration (that file's `:16-23` does the
same below `0009_aeat_outage_flag`); apply the test migration sets with the cut fiscal set
(keeping `clock_confirmations` among its append-only tables, since slice 9's migration created it);
insert one `admin` row (with a person), one `devices` row and one `elapsed` row; read every row;
run `runMigrations(suite.db, FISCAL_MIGRATIONS)` and put the append-only triggers back with
`installAppendOnlyTriggers`, as `applyMigrations` does after a set
(`packages/migrations/src/apply.ts:74`; `runMigrations` alone does not,
`packages/db/src/migrate.ts:23-31`); then the rows read
back are `toEqual` to those read before, both of `clock_confirmations`' append-only triggers
exist, and an UPDATE and a DELETE of a row are each refused by them. This case cannot fail before
the generation exists (the cut then removes nothing), so it is not a failing test first; its proof
is the deletion control below. `scripts/migration-upgrade.test.ts` stays in
the guards as a guard only: its header says its rows are synthetic, that "Rows are counted, not
compared", and that apart from "the nine product triggers" "other triggers dropped by a rebuild
are not checked here" (`scripts/migration-upgrade.test.ts:18-50`, the quoted words at `:47-49`), so it
is not evidence this migration keeps rows or triggers.

**Guards to run** (CLAUDE.md §3's list for a generation): `pnpm exec vitest run
scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts
scripts/journal-monotonic.test.ts scripts/append-only-migration-sets.test.ts
scripts/migration-upgrade.test.ts`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run
inmutabilidad src/write-path.e2e.test.ts src/clock-confirmations.test.ts
src/clock-confirmations-upgrade.test.ts src/outage-upgrade.test.ts`; the suites that replay this
set's journal (revision 5a): `pnpm exec vitest run scripts/fiscal-allocation-migration.test.ts
scripts/fiscal-certificate-migration.test.ts` and `pnpm --filter @waitron/server exec vitest run
src/hour-recovery-staged.test.ts`; `pnpm --filter
@waitron/fiscal typecheck`, `pnpm --filter @waitron/fiscal-verifactu typecheck` and `pnpm --filter
@waitron/server typecheck` (the `satisfies` reader). **On a rebase that collides with another fiscal-verifactu migration number:**
reset `packages/fiscal-verifactu/drizzle/` to `main`'s, run `db:generate` again, and rerun every
guard above — never hand-edit a snapshot or the journal.

**Deletion controls.** The test database is built from the migrations, not from the TypeScript
schema, so each CHECK control is made by regenerating the migration from the changed schema (or by
editing the generated SQL for the run only, then restoring it with `git checkout`); editing the
schema alone changes nothing the test sees. Leave the person CHECK as slice 9 wrote it (only the
source widened) → the `staff`-with-a-person case is refused `clock_confirmations_person_ck`; drop
`staff` from the source list (only the person CHECK widened) → the same case is refused
`clock_confirmations_source_ck`; leave a column out of the generated `INSERT … SELECT` (SQL edited
for the run only) → the upgrade test's `toEqual` fails; drop `staff` from `SOURCE_WORD` → `tsc`
fails on the `satisfies`. Changed test check 13 makes no test fail when left out (the claim check
found the test still passes), so it gets a probe instead: a read of the backup's
`max(created_at)` from `__drizzle_migrations_fiscal` prints 0009's `when` (`1792550481436`,
`_journal.json:71`) without the extra undo step and 0008's (`1792358085639`, `:64`) with it — say
what the run printed.

**STOP** if any guard above shows the rebuild loses a row, leaves a trigger missing after apply,
or if drizzle-kit's SQL differs from the rehearsed shape in anything but whitespace and quoting.

### Task 8: The seat records a step of the clock, and the bell words it

**Goal.** Decisions 7, 9 and 16 (revision 5: a step confirmed by a staff member on a till is
stored as `source = 'staff'`, the value Task 8-0 adds), in the Veri\*Factu module, without touching
the fiscal core; and the bell's words for `clock.corrected` in the same task, since `scripts/alert-codes.test.ts`'s "every
recorded code, and alert.source_unavailable, has English and Spanish wording" (`:128`, reading
`ALERT_MESSAGES` at `:19`) is red from the moment the code is recorded until the words exist
(round 2, minor 3).

**Files.** Create `packages/fiscal-verifactu/src/clock-step.ts` and `clock-step.test.ts`; modify
`packages/fiscal/src/backend.ts` (`ClockStepRequest`, optional `confirmClockStep?(tx, input):
Promise<{ confirmation: ClockConfirmation | null }>` beside `confirmClockStop` at `:367-374`;
`ClockAdminConfirm`, `:230-234`, gains `role?: "staff"` (absent: an administrator) and `till?: {
deviceId: string; deviceLabel: string | null; address: string | null }`, present when the reading
came from a till),
`packages/fiscal-verifactu/src/clock-checks.ts` (`storedWitnesses`, `:122-144`, writes the reading
under `staff` instead of `admin` for `role: "staff"`, and a `till` key when one is given — each key
ONLY when set, so a proof with neither is exactly the shape slice 9 writes; revision 5, C1: an extra
`null` key would fail slice 9's whole-proof `toEqual` cases, `clock-checks.test.ts:241-265`,
`:455-475`, `clock-confirmation.test.ts:229-245`),
`packages/fiscal-verifactu/src/clock-stop-incidents.ts` (`recordCorrected`, already a listed
incident source in `scripts/alert-codes.test.ts:24-43`), `packages/fiscal-verifactu/src/alerts.ts`
(the claim), `packages/fiscal-verifactu/src/errors.ts` (`"clock.corrected"` params, beside
`clock.behind_chain_restarted` at `:378`), the seat's wiring (`backend.ts` of the Veri\*Factu
module), `packages/fiscal-none/src/backend.test.ts`,
`packages/fiscal/src/testing/fake-backend.test.ts`
(changed test checks 2 and 4), and `apps/dashboard/src/i18n/alert-messages.ts` with its test
(English and Spanish, one `replace` variant per person source, chosen by `byAdmin` / `byStaff`
being `true` (`packages/dashboard-kit/src/alert-messages.ts:14-16`), naming the person for `admin`
and the person and the till for `staff` — "set from till Barra 1, confirmed by Ana" / "puesta con la caja Barra 1,
confirmada por Ana" — before and after in the venue's offset, and the step in words — "moved forward 2 days 3 hours" / "adelantado 2 días y
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
  source: "authority" | "admin" | "staff";
  witnesses: readonly ClockWitness[];
  /** For `admin` and `staff`; for `staff`, with `role: "staff"`. */
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
- A staff member's till sets it to a time still behind the latest record: `registro_id` the
  latest record, a lift that covers the after reading and readings up to a minute further back
  (`clockBehindChain` null at `after`, non-null at `after − 61 s`, `clock-behind.ts:133-137`);
  `clock.behind_chain_restarted` recorded with `confirmedBy: "staff"`, the person and the till.
- `staff` source (decision 16): the column `source` is `staff`, `person_id` the staff member,
  `proof.staff` the till's id, address and reading and NO `admin` key; `clock.corrected` has
  `source: "staff"`, `byStaff: true`, `person`, `deviceId` and `device`. An administrator's step
  from a till: `source` `admin`, `proof.admin` and `proof.till`. An administrator's step from the
  dashboard: `proof.admin` and no `till` key. Control: `source: "staff"` with no `admin` input →
  refused before any write (a programming error, thrown), zero rows.
- **C1's control** (revision 5): an AEAT step's `proof` is `toEqual` to `{ authority, devices,
  admin: null, step, heads, closing }` — no `staff` and no `till` key.
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
the no-stop case throws; write a staff step's reading under `proof.admin` instead of
`proof.staff` → the `staff` case fails; write `staff: null` on every proof → the C1 control fails;
store a staff step as `source: "admin"` → the `staff` case fails.

**Focused commands.**
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-step.test.ts
src/alerts.test.ts`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
src/write-path.e2e.test.ts`; `pnpm --filter @waitron/fiscal-none exec vitest run
src/backend.test.ts`; `pnpm --filter @waitron/fiscal exec vitest run
src/testing/fake-backend.test.ts`; `pnpm exec vitest run scripts/alert-codes.test.ts
scripts/errors-reachable.test.ts scripts/no-till-as-issuer.test.ts`; `pnpm --filter
@waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/widgets/alerts-bell.test.ts
src/screens/alerts-screen.test.ts`.

### Task 8a: Slice 9's confirmation takes a staff member, and every reader words the `staff` source

**Goal.** Decision 16's readers, and decision 15's agreeing branch: slice 9's `confirmClockStop`
accepts a staff member through its existing `admin` input marked `role: "staff"` and writes
`source = 'staff'`; every place that says who confirmed words `staff` as a staff member; and the
payments-restarted alert and email name the person and the till (revision 5, I8 — today the bell
names neither, `apps/dashboard/src/i18n/alert-messages.ts:171-174`, and the email neither,
`apps/server/src/box-alert-email.ts:97-108`, `apps/server/src/i18n/box-emails.ts:60-69`). No
behaviour of slice 9 changes for an input without `role` or `till`.

**Files.** Modify `packages/fiscal-verifactu/src/clock-confirmation.ts` (`confirmClockStop`,
`:177-264`: `source` `staff` for `role: "staff"`; the proof through `storedWitnesses` as Task 8
writes it; `recordRestarted`'s params gain `byStaff: true` for a staff member and `device` (the
till's label) whenever a `till` is given — `person` is already there; `closeWaitingAsAdmin`,
`:143-164`, refuses a `role: "staff"` input as `not_stopped` — a staff member never closes a
waiting check, decision 15), `packages/fiscal-verifactu/src/errors.ts`
(`clock.behind_chain_restarted`, `:378-384`: `confirmedBy` gains `"staff"`, and `byStaff?: true`
and `device: string | null` params), `apps/server/src/box-health.ts` (`:180-182`: nothing but the
widened type), `apps/server/src/misdated-sales-csv.ts` (revision 5a: the header names a
person only when `closing.source === "admin"`, `:57-60`, with the condition at `:58`; it widens to
`admin` or `staff`, worded with `by[SOURCE_WORD[closing.source]]` rather than `by.admin`, so a
staff closing reads "a staff member on a till (Ana)"; the name comes from the closing's
`person_id`, `apps/server/src/box-health-api.ts:214`, which a `staff` row carries),
`apps/dashboard/src/api/client.ts` (the confirmation's `source`, `:1890`, gains
`"staff"`), `apps/dashboard/src/screens/box-status-rows.ts` (`confirmedBy`, `:387-396`, finds
`staff` in the words), `apps/dashboard/src/i18n/alert-messages.ts` (`clock_confirmed_by`,
`:507-516`, gains `staff`: "a staff member" / "un empleado"; `clock.behind_chain_restarted`,
`:171-174`, gains a `byStaff` `replace` variant: "Payments restarted on the box's clock
({clockAt:minute}), earlier than the last sale ({lastRecordAt:minute}), once {person}, a staff
member, confirmed it on till {device}." / Spanish to match), `apps/server/src/box-alert-email.ts`
and `apps/server/src/i18n/box-emails.ts` (the restarted email, `:60-69`, names `{person}` and
`{device}` when `byStaff` is set: "…was confirmed by {person}, a staff member, on till
{device}…"). `person` is on `PERSONAL_LOG_KEYS` (`apps/server/src/log-personal-data.ts:38`), so the
logger masks it in any line; `device` is a till's label, not personal data.

**Failing tests first.**
- `clock-confirmation.test.ts` (new cases only): a stop proper, a `role: "staff"` input with a `till`
  and a reading that agrees → one row, column `source` `staff`, `person_id` the staff member,
  `proof.staff` with the device id and NO `admin` key; `clock.behind_chain_restarted` params
  `confirmedBy: "staff"`, `byStaff: true`, `person`, `device`; `clockStopState` at the next reading
  answers a confirmation with `source: "staff"`. Control: the same input without `role` or `till`
  → `source` `admin`, `proof.admin`, no `staff` or `till` key, `confirmedBy: "admin"`, no `byStaff`
  (`toEqual` against the slice-9 shape). A waiting check and a `role: "staff"` input →
  `clock.confirm_refused { reason: "not_stopped" }`, zero rows; control, the same without `role` →
  closes it, as today.
- `clock-misdated.test.ts`: a list closed by a staff member's confirmation reads `source: "staff"`.
- `misdated-sales-csv.test.ts`: a `staff` closing's header names the staff member in English and
  Spanish; an `admin` closing still names an administrator (`:238`, unedited).
- `box-alert-email.test.ts`: `clock.behind_chain_restarted` with `confirmedBy: "staff"`, `byStaff`,
  `person` and `device` names both in both languages (a new case after the `it.each` at `:118-121`,
  which is left unedited).
- `alerts.test.ts`: the `byStaff` variant names `{person}` and `{device}` in both languages, and a
  restarted alert without `byStaff` reads as today (`:483`, `:496-497`, unedited); changed test
  check 10. `box-status-rows.test.ts`: a covering confirmation with `source: "staff"` reads "a staff
  member".

**Deletion controls.** Drop the `role` branch in `confirmClockStop` → the staff case stores
`source: "admin"`; drop the `not_stopped` refusal for a staff input on a waiting check → that case
writes a row; drop `byStaff` from the restarted params → the bell and email cases name nobody;
keep `misdated-sales-csv.ts`'s condition `admin`-only → the staff closing's header names nobody.

**Focused commands.** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
src/clock-confirmation.test.ts src/clock-misdated.test.ts src/clock-stop-incidents.test.ts
src/clock-checks.test.ts`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
src/write-path.e2e.test.ts`; `pnpm --filter @waitron/server exec vitest run
src/misdated-sales-csv.test.ts src/box-alert-email.test.ts src/clock-confirm.route.test.ts
src/box-health.test.ts`; `memory_pressure | grep free`, then `pnpm --filter @waitron/dashboard exec
vitest run src/screens/box-status-rows.test.ts src/i18n/alerts.test.ts`; `pnpm exec vitest run
scripts/alert-codes.test.ts scripts/personal-log-params.test.ts`.

### Task 9: `clock.corrected`'s email, never lost to a later step

**Goal.** Decision 9's email half (round 2, I3).

**Files.** `apps/server/src/box-alert-email.ts` (`INCIDENT_EMAIL_CODES` gains `clock.corrected`;
`wordsFor` and `TIME_PLACEHOLDERS` gain `before` and `after`; `startBoxEmailDuty` answers
`{ stop, remember }`; a `clock.corrected` episode ends only once every recipient has it),
`apps/server/src/i18n/box-emails.ts` (`CLOCK_CORRECTED_EMAIL_WORDS`),
`apps/server/src/box-alert-email.test.ts`, `apps/server/src/box-alert-email.duty.test.ts`,
`apps/server/src/boot.ts` (the duty's `remember` handed to the correction as `onCorrected`).

**Failing tests first.** The email: each source's exact English text with both times in their
offsets — `authority`, `admin` naming the person, `staff` naming the person and the till (the
owner's 07:05 point 3); Spanish read from `box-emails.ts`; a step of exactly one day and one of 400 days worded;
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

**Goal.** Decisions 6–8 for the three sources revision 4 keeps — AEAT, an administrator, a staff
member (`source: "authority" | "admin" | "staff"`). The turn's other users (the watch's
confirmation, the confirm route, the till's agreeing confirmation) join it in Tasks 11, 12 and 12a.
Revision 3's `DEVICES_MAY_SET_BACK_PAST_LAST_SALE` and `devicesMaySet` are not built: devices no
longer set the clock.

**Files.** Create `apps/server/src/clock-correction.ts`, `clock-correction.test.ts`; modify
`apps/server/src/errors.ts` (`clock.set_refused`, `clock.set_failed`).

**Interface.**
```ts
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
  set(input: { reason: "behind_chain" | "unusable"; source: "authority" | "admin" | "staff";
    offsetMs: number; measuredAt: { wallMs: number; monoMs: number }; stepsSeen: number;
    witnesses: readonly ClockWitness[];
    /** For `admin` and `staff`; for `staff`, with `role: "staff"` (Task 8). */
    admin?: ClockAdminConfirm;
    /** Asked inside the turn, in the same write-lock turn that judges the stop, after it: the
     * till's route passes the person's admission and the start-up window's check (Task 11b). */
    admit?: (tx: Transaction) =>
      Promise<"not_admitted" | "not_start_up" | "authority_pending" | null>;
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
- A target before 2024-10-28 or from 2100 on → `target_invalid`, before the host is asked.
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
- **`staff`** (revision 4): `admit` answering `not_start_up` → `{ set: false, reason:
  "not_start_up" }`, no anchor told, no host call; `authority_pending` and `not_admitted` the same;
  control, `admit` answering null → set, and `confirmClockStep` called with `source: "staff"` and
  the `admin` input carrying `role: "staff"`. `set` answers `{ set: false, reason: "not_admitted" }`
  as it is; the till's route (Task 12a) turns that one reason into `device_profile.not_admitted`
  (403), not `clock.set_refused` (decision 15, revision 5a).
- **`agrees`** (revision 5, M7; decision 10 lists it, revision 4 never tested it): an `admin` or
  `staff` offset within a minute of the box, uncertainty included → `{ set: false, reason:
  "agrees" }`, no anchor told, no host call — the caller confirms instead (Task 12's route answers
  it as a refusal; Task 12a's route never sends an agreeing reading here, it takes the agreeing
  branch); control, the same offset at 61 s → set. An `authority` offset under a minute is not an
  AEAT disagreement, so the watch never asks (Task 11a). `admit` is called after the stop is judged (the order list shows it), so a stop
  that ended answers `not_stopped`, not `not_start_up`.
- **`witnessed`** for `admin` and `staff`: an AEAT disagreement taken during the stop, the host
  available and unsynchronised → `witnessed`, no host call; **an AEAT reading that AGREES with the
  box, taken during the stop, the stop still holding (the watch has not yet looked again), the
  host available and unsynchronised → `witnessed`, no host call, for both `admin` and `staff`**
  (revision 5a, decision 14; written and seen failing before the rule is widened); control: a
  group of devices from two addresses disagreeing and no AEAT → not `witnessed` (devices set
  nothing now), the set goes on.
- The requester holds ids only: `{ source: "authority", check }` for AEAT, `{ source: "admin",
  person: <uuid> }` for an administrator, `{ source: "staff", person: <uuid>, device: <uuid> }` for
  a staff member; a test asserts no `personName` and no device label reaches the host.

**Deletion controls.** Skip `reanchor` → the order case fails; drop the verification → the +2 001
case fails; drop the turn → the together case sees two sets; drop the step-counter check (keep
the turn) → the together case sees two sets (the host still unsynchronised); drop the stop
re-judging → the `not_stopped` case calls the host; skip `admit` → the `not_start_up` case calls
the host; drop the `agrees` check → the 30-second case calls the host; count devices in `witnessed` → the devices control answers `witnessed`; count only AEAT
disagreements in `witnessed` → the agreeing-AEAT case calls the host.

**Focused command.** `pnpm --filter @waitron/server exec vitest run src/clock-correction.test.ts`.

### Task 11: The watch as an anchor, and the store's settable AEAT readings

**Goal.** Decision 6's anchor half (round 2, C1, I2, minor 1); no set is asked for yet.

**Files.** Modify `apps/server/src/clock-witnesses.ts` (AEAT's kept disagreements stored with
their `BoxClockReading`; `forSetting()` hands out every AEAT reading `witnesses()` would, each
with its `at`, and only those with no step since — a kept disagreement included only while `fresh`
holds for it; revision 4: no device reading, since devices no longer set the clock; `witnesses()`
and its doc unchanged), `apps/server/src/clock-watch.ts` (the watch
implements `ClockAnchor`; when a `correction` dep is passed, BOTH its confirmation writers take
`correction.inTurn` around their whole `deps.transaction` — `confirm` (`clock-watch.ts:150-170`)
and `closeWaiting`'s `closeClockCheckByItself` (`:185-208`), which also closes a check and so
must not land between a set's judging and its row; `closeWaiting`'s `askAuthority()` stays outside
the turn; `recordPending` runs one call at a time), `apps/server/src/boot.ts` (create the
correction before `startClockWatch` at `:2441` (moved from `:2437` by Tasks 6–7), pass it,
`correction.addAnchor(clockWatch)`).

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
- The store: an AEAT disagreement noted, then the wall clock stepped by 5 s against the steady
  clock → `witnesses()` still hands it out (unchanged), `forSetting()` does not; with no step, both
  do and `forSetting()` carries the `at` it was noted with. A device reading noted beside it →
  `witnesses()` hands it out, `forSetting()` never does.
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

### Task 11a: The watch sets the clock from AEAT during a stop, with a backoff

**Goal.** Decision 6's automatic half — AEAT only, revision 4 — and its backoff (round 2, I3).

**Files.** Modify `apps/server/src/clock-watch.ts` (on `stop.proof === "contrary"` after
`openCheck`, call `correction.set` with AEAT's offset when `stop.contrary.authority` is set, with
that reading's `measuredAt` from `forSetting()` and `stepsSeen: correction.steps()` read when the
witnesses are read, and nothing when only devices disagree; nothing during `clock.unusable`, where
AEAT cannot be asked; `writePending()` on each look straight after its first `recordPending()`
succeeds (`clock-watch.ts:228`), never before it or when it failed, so a disproof measured on the
old clock is written before the step's row (decision 8); the backoff of decision 6, kept in memory
by stop key; log a refusal once per change of reason, not every 15 s).

**Failing tests first** in a new `apps/server/src/clock-watch.correction.test.ts` (the existing
harness, a fake correction recording calls):
- A stop with AEAT disagreeing by +2 days → one `set` with `source: "authority"` and AEAT's offset;
  devices disagreeing too → still AEAT's, once.
- **Revision 4 controls:** a stop with two devices from two addresses disagreeing and no AEAT → no
  `set` (today's slice-9 behaviour: nothing); `clock.unusable` (a reading in 2001) with two devices
  disagreeing → no `set`. Each with the AEAT case beside it so the harness is shown able to set.
- A correction answering `synchronised` on three looks logs `clock_watch.cannot_set` once.
- A disproof pending in the watch and a step row pending in the correction → the look writes the
  disproof, then calls `writePending()`; with the disproof's write failing → `writePending()` is
  not called on that look.
- **Backoff**: a correction answering `{ set: false, reason: "refused" }` on every call, looks
  every 15 s of the fake steady clock → one call in the first 10 minutes, the second at 10
  minutes, the third 20 minutes after that; an answer `synchronised` on every look → asked every
  look (nothing toggled, no backoff); a new open check id → asked at once; a fake correction
  recording `clock.corrected` per unverified answer → at most one per backoff step.
- One boot-level case in `boot.clock-watch.test.ts`, beside "shares one boot reader between the
  watch and the administrator's confirm route" (`:132-143`) and in its style: the watch is handed
  the correction boot made, and that correction has the watch as its one anchor. A booted server
  cannot be made to hear AEAT (`readAuthorityTime` has no seam on `startServer`), and its clock is
  `systemClock()`, which no seam moves (`seams.testClock`, `boot.ts:843`, is the module operations'
  hour clock, `module-operation-host.ts:31`), so the AEAT path through a real server is not run
  here; the till route's boot-level case (Task 12b) runs the correction through a booted server.
  The success path through the row and the lift is Tasks 8, 10 and 12's, on clocks the test
  controls.

**Deletion controls.** Drop the `contrary` branch → the AEAT case fails; let the devices' mean set
the clock again (revision 3's branch) → the revision 4 control calls `set`; drop the backoff → the
backoff case sees a call every look.

**Focused commands.**
`pnpm --filter @waitron/server exec vitest run src/clock-watch.correction.test.ts
src/clock-watch.test.ts src/clock-watch.elapsed.test.ts src/clock-watch.restart.test.ts
src/boot.clock-watch.test.ts`.

### Task 11b: The start-up window, the till's marker, and no devices-only lift during start-up

**Goal.** Decision 14's window, decision 15's marker and decision 18's gate (the lead's ruling R1):
what the server knows about start-up, the notice that tells a till to offer "Check the time", and
the watch no longer lifting on two devices alone while the window is open.

**Files.** Create `apps/server/src/clock-start-up.ts` and `clock-start-up.test.ts`; modify
`apps/server/src/clock-watch.ts` (an optional `startUp` dep: `noStop()` from the branch that calls
`deps.store.endStop()`, `:259`, under the same condition, and on a look whose stop state's `proof`
is `confirmed`; `authorityAsked(answered)` after each `askAuthority` sample, `:176-178`; and
decision 18's gate on `confirm`, `:279-285`), `apps/server/src/box-staff-notices.ts`
(`boxStaffNoticeSource` gains a `clockCheck?: (tx, reading) => Promise<boolean>` input and sends `{
key: "clock.check_time", code: "clock.check_time", severity: "error", params: {} }` while it
answers true — the literal sits in this file, which `scripts/staff-notice-codes.test.ts:15` already
reads; the `clockCheck` also calls `noStop()` when its read sees no stop holding, decision 14,
and is built by an exported `tillClockCheck(...)` in `clock-start-up.ts` rather than inline in
boot, so its `noStop()` path is tested on its own — revision 5a), `apps/server/src/boot.ts` (create the window BEFORE the tills' notice sources at
`:2011` — revision 5, M6 — open only when `isSingletonPrimary`, `:1668`, else closed; pass it to the
watch at `:2441`; wrap `createAuthorityClockStatus`'s `onSample` at `:1633` so a filing reply's AEAT
time also reports `answered`; hand the `clockCheck`, built from `startUp.tillMayOffer`, the seat's
`assertRecordableAt` and `clockStopState`, to the DEVICES' notice sources only —
`deviceNoticeSources` is called twice, for the tills' equipment read (`:2011`) and for the Box
status page (`:2551`); the page's call gets none, so the dashboard and the managers' email duty,
which reads the page's notices and emails only listed codes (`box-alert-email.ts:343-347`), never
see `clock.check_time`), `apps/till/src/i18n/staff-notices.ts` (the marker's words, so the guard
passes in this task; Task 13a makes the till draw no line for it).

```ts
export interface ClockStartUp {
  /** True until a reader of the stop sees none holding; never true again in this process. Created
   * closed on a node that is not the primary at its start. */
  open(): boolean;
  noStop(): void;
  authorityAsked(answered: boolean): void;
  /** Decision 14's rule. `canAskAuthority`: the box files records and the seat reads AEAT's time. */
  tillMayOffer(input: { stopped: boolean; unusable: boolean; canAskAuthority: boolean }): boolean;
  /** For the till route's staff branch: `not_start_up` once closed; `authority_pending` while AEAT
   * is not asked and the box can ask; null otherwise, `answered` included (decision 14, I7). */
  admit(input: { unusable: boolean; canAskAuthority: boolean }):
    "not_start_up" | "authority_pending" | null;
}
export function clockStartUp(input: { primaryAtStart: boolean }): ClockStartUp;
```

**Failing tests first.**
- `clock-start-up.test.ts`: `primaryAtStart: true` → `open()`; `tillMayOffer` with a stop and
  `canAskAuthority` true → false (`not_asked`), and `admit` → `authority_pending`; after
  `authorityAsked(false)` → true and null; after `authorityAsked(true)` then `authorityAsked(false)`
  → `tillMayOffer` false (`answered` stays) and **`admit` → null** (revision 5, I7 — so a request
  after AEAT answered reaches `witnessed` or `contrary_proof`); `unusable: true` → true before any
  ask; `canAskAuthority: false` → true before any ask; after `noStop()` → false and `admit` →
  `not_start_up`, whatever follows; `stopped: false` → false. `primaryAtStart: false` → closed from
  the start, `admit` → `not_start_up`. **The notice source's `noStop()` path** (revision 5a), with
  `tillClockCheck` over a stub seat and a real window: a read that sees no stop holding at a
  recordable reading → answers false and `open()` is false afterwards; a read whose stop state is
  `confirmed` → the same; a read during the stop proper → `open()` stays true; a read at a 2001
  reading (`clock.unusable`) → `open()` stays true.
- In a new `apps/server/src/clock-watch.start-up.test.ts` (the existing harness): a look with no
  stop at a recordable reading calls `noStop()` once; a look whose stop state is `confirmed` calls
  it; a look at a 2001 reading (no stop, not recordable) does not; a look during the stop proper
  does not; an AEAT ask answering null calls `authorityAsked(false)`, one answering a sample
  `authorityAsked(true)`. **Decision 18:** the stop proper with two devices from two addresses
  agreeing with the box and no AEAT witness, the window open → no `confirmClockStop` call, the stop
  holds; the same with an agreeing AEAT witness added → one confirmation, `source: "authority"`; the
  devices-only case with the window closed (`noStop()` called, then the stop brought back) → one
  confirmation, `source: "devices"`, as slice 9; and with no `startUp` dep → the same, as slice 9
  (changed test check 12).
- `box-staff-notices.test.ts` (new cases): `clockCheck` answering true → one `clock.check_time`
  notice; false or absent → none; disk-full and space-low notices unchanged beside it.
- Boot-level, in `boot.clock-watch.test.ts`'s style (calls recorded through the module mocks the
  file already uses): the devices' notice source is built with a `clockCheck` and the page's
  without; the window is created before `deviceNoticeSources` is first called; a filing-reply
  `onSample` reaches the window's `authorityAsked(true)`; **`clockStartUp` is called with
  `primaryAtStart: true` on a primary boot and `primaryAtStart: false` on a boot whose singleton
  role is not primary** (revision 5a: boot passes `isSingletonPrimary`, `boot.ts:1668`), read from
  the mock's recorded argument.

**Deletion controls.** Close the window on a `clock.unusable` look too → the 2001 case calls
`noStop()`; let a later `false` overwrite `answered` → that case offers; make `admit` answer
`authority_pending` whenever `tillMayOffer` is false → the I7 case fails; drop the `noStop()` call
→ the no-stop look leaves the window open; drop the `confirmed` condition → the lifted case leaves
it open; drop decision 18's gate → the devices-only window-open case confirms; hand the
`clockCheck` to the page's `deviceNoticeSources` call too (revision 5, M2) → the boot-level case
sees it on both; open the window on a non-primary inside `clockStartUp` → the `primaryAtStart:
false` case fails; pass `primaryAtStart: true` from boot whatever the role → the boot-level
non-primary case fails (revision 5a: the `clockStartUp` case alone cannot see this one); drop
`tillClockCheck`'s `noStop()` call → its no-stop and `confirmed` cases leave `open()` true.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/clock-start-up.test.ts
src/clock-watch.start-up.test.ts src/clock-watch.test.ts src/clock-watch.restart.test.ts
src/clock-watch.elapsed.test.ts src/box-staff-notices.test.ts src/boot.clock-watch.test.ts`;
`pnpm exec vitest run scripts/staff-notice-codes.test.ts`; `memory_pressure | grep free`, then
`pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts`.

### Task 12: An administrator's "Use your device's time?"

**Goal.** Decision 10.

**Files.** Modify `apps/server/src/box-health-api.ts` (`clockConfirm` deps gain `correction`;
mount `POST /api/box/clock-set` when `confirmClockStep` exists; `POST /api/box/clock-confirm`'s
WHOLE `withTransaction` (`:269`) runs inside `correction.inTurn` when a correction is passed —
the turn before the lock, never inside it, decision 6; round 2 C1); create
`apps/server/src/clock-set.route.test.ts`; modify `apps/server/src/boot.ts` (the `clockConfirm`
deps at `:2615`, moved from `:2594-2605` by Tasks 6–7).

**The route**, in order: refuse on the box (`same_machine`, as `:247-250`);
`requireManagementSession`; authorize `person.admin` in one transaction; parse
`{ challengeId, deviceAt }` as `confirmBody`
does (`:87-102`); take the challenge (`clock.check_expired` when gone); compute `boxAt` at the
round trip's midpoint as `:281-295` does, keeping the wall and steady readings taken there as
`measuredAt` and `correction.steps()` as `stepsSeen`; then `correction.set` with
`source: "admin"` and the device's offset, outside any transaction. The correction judges, inside
its turn and in decision 10's order, `stale`, `not_stopped`, `host_unavailable`, `synchronised`,
`witnessed` (AEAT has spoken during the stop — revision 4: devices no longer count, since they no
longer set the clock) and `agrees` (the device within a minute) — so `witnessed` is only ever said
where the box can set its clock (round 2, I4). The route is open at start-up and while running
(decision 17): it passes no `admit`.
Map each to `clock.set_refused { reason }` and a failed or unverified set to `clock.set_failed`;
answer `{ confirmationId, stepMs, confirmedAt }`.

**Failing tests first** (the route mounted as `clock-confirm.route.test.ts` mounts it, with the
correction built on the test's own `clock` and `wall`, so the fake host can move them): a manager
→ 403 `{ permission: "person.admin" }`; no session → 401; on the
box → 409 `same_machine` with the fake host never asked; no stop → `not_stopped`; AEAT disagreeing
during the stop → `witnessed`; two devices disagreeing during the stop, no AEAT → NOT
`witnessed`: 200, the clock set from the administrator's device (revision 4); the device 30 s off →
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

**Deletion controls.** Drop the `witnessed` check → its AEAT case fails; count devices in it
again → the two-devices case answers `witnessed`; judge `witnessed` before
the host's status → the two I4 cases answer `witnessed`; drop the on-the-box check →
`same_machine` fails; drop the permission → the manager case fails; take the confirm route out of
the turn → the order case fails; take the turn inside its `withTransaction` → the deadlock case
hits its deadline.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/clock-set.route.test.ts
src/clock-confirm.route.test.ts src/box-health-api.test.ts`.

### Task 12a: The till's check — its routes and refusals

**Goal.** Decision 15's two routes on the server, for a staff member and for an administrator on a
till: the owner's 07:00 rule and 07:05 points 1 and 3. Concurrency and the boot wiring are Task
12b (revision 5, M1).

**Files.** Create `apps/server/src/till-box-clock-api.ts` (`mountTillBoxClockApi(app, deps, log)`,
mounted from `mountTillApi` beside `mountTillClockApi`, `apps/server/src/till-api.ts:1281-1286`,
whenever the seat has `confirmClockStop` and a correction is passed — not gated on the workforce
module), `apps/server/src/till-box-clock-api.test.ts`; modify `apps/server/src/till-api.ts`
(`TillApiDeps` gains an optional `boxClock` with the correction, the window, the seat, the witness
store's `witnesses` and `clear`, the clock, `readBoot`, `steady`, `requestFromBox`, `devMode`; the
route reuses `mountTillApi`'s `pinThrottle` through `overridePinAttempts`, `:745-750`),
`apps/server/src/errors.ts` (`clock.set_refused`'s reasons gain `not_start_up`, `authority_pending`,
`target_invalid`), `apps/server/src/till-api.profile-actions.test.ts` (the map row, changed test
check 11, and its refusing cases).

**The routes**, as decision 15 says. Their `STATUS` map: `session.required` 401,
`device.unauthorized` 403, `device_profile.not_admitted` 403 (revision 5, I6; the till's own map
has it at `till-api.ts:466`; also the answer to `correction.set`'s `not_admitted` reason, revision
5a), `pin.invalid` and `pin.throttled` and `authorization.not_permitted`
as the drawer route answers them, `clock.set_refused` 409, `clock.confirm_refused` 409,
`clock.check_expired` 400, `clock.set_failed` 502, `management.request_invalid` 400 (the body's
field, as `confirmBody` throws it). The person is the session's (`requireSession(deps, c)`,
`till-session.ts:93`) or, with an override, the administrator it names; the name, read with
`displayNameOf` (`apps/server/src/box-health.ts:133`), goes to the seat for the alert, never to the
host. The device is the session's `deviceId`; its label is read from `devices` for the alert's
`device` param. The window is closed by either branch's judging when it sees no stop holding
(decision 14).

**Failing tests first** (`useVenueDb`, a till enrolled with `enrolDeviceForTest`, a staff member
with a PIN session on it, a sale recorded a day ahead of the test's clock so the stop proper holds,
a correction built on the test's own `clock` and `wall` with a fake host that moves them, and a
real `clockStartUp({ primaryAtStart: true })` the test drives):
- **Differs, the control:** the window open, AEAT `unanswered`, the till a day ahead → 200; one
  `clock.set` on the fake host with requester `{ source: "staff", person, device }` and nothing
  else; one row, column `source` `staff`, `person_id` the staff member, `proof.staff.deviceId` the
  till; `clock.corrected` with `source: "staff"`, `byStaff`, the person and the till's label; the
  stop lifted at the next read (`clockStopState` null or `confirmed`).
- **Agrees:** the till 20 s from the box → 200 with `stepMs: 0`, no host call, one row
  `source: "staff"`, `clock.behind_chain_restarted` naming the staff member and the till (Task 8a).
  Agreeing, with the correction's counter raised between the challenge and the confirm → `stale`,
  zero rows.
- **`clock.unusable`:** the test's clock in 2001, the till a day ahead of real time → 200, row
  `reason: "unusable"`; the window open and AEAT `not_asked` (the box cannot ask it then).
- **An administrator on the till** (revision 5, I5 a): the window closed (`noStop()`, the stop
  back) and a staff member's session → 409 `not_start_up`; the same request with `override` naming
  an administrator and their right PIN → 200, row `source: "admin"`, `proof.admin` and `proof.till`,
  the host's requester `{ source: "admin", person, device }`; a wrong PIN → `pin.invalid`, zero
  rows, and the device's override attempts counted (`overridePinAttempts`); an override naming a
  manager (no `person.admin`) → `authorization.not_permitted`; an administrator signed in on the till
  themselves, no override, the window closed → 200, `source: "admin"`.
- Refusals, each with zero rows, zero host sets and zero incidents, counted, and each with the
  differ control above as the case that goes through: the request from the box (`requestFromBox`
  answering true, `devMode` false) → 409 `same_machine` on both routes; the same with `devMode`
  true → served (slice 9's development exception); no session → 401 `session.required`; a profile
  that no longer admits the person → 403 `device_profile.not_admitted` on both routes, AND the same
  when admission is withdrawn between the challenge and the confirm's transaction (the profile
  changed through the test's database after the challenge) — revision 5, I6; no stop → 
  `not_stopped`, and the window is then closed; the window closed with the stop back →
  `not_start_up`; AEAT `not_asked` with the box able to ask → `authority_pending` (and the
  challenge route answers it too, before any challenge is issued); **AEAT `answered` and
  disagreeing during the stop, the host able to set → `witnessed`** (reachable because `admit`
  answers null once AEAT has answered, Task 11b); **AEAT `answered` and AGREEING with the box
  during the stop, the stop still holding (no watch look since), a staff member's till a day
  ahead, the host able to set → `witnessed`, zero host sets** (revision 5a, decision 14; written
  and seen failing first), and the same with an administrator's override → `witnessed`; the till's time in 2001 → `target_invalid`, also
  when the box's own clock reads 2001 and the till 30 s from it (the agreeing branch, which never
  reaches the correction's own range check); the till a day ahead with the host synchronised →
  `synchronised`, and with the host missing → `host_unavailable`; the till agreeing while AEAT
  disagrees → `clock.confirm_refused { reason: "contrary_proof" }`; an old challenge → 400
  `clock.check_expired`; a challenge issued to another till's session → 400 `clock.check_expired`;
  a step between challenge and confirm on the differing branch → `stale`; the fake host moving the
  clock 3 s short → 502 `clock.set_failed { reason: "unverified" }`.
- **Profile actions** (CLAUDE.md §3): both routes in the map as "admitted session; no profile
  action"; refusing cases "requires an open session on POST /api/box-clock/challenge and /confirm"
  and the changed-admission case; allowed: "serves a staff member whose profile has no selling
  action" (a profile with only `clock-in`, or with none of `PROFILE_ACTIONS`). These routes are not
  bounded by service zones, so `till-api.profile-zones.test.ts`'s `ROUTES` (`:514`, routes refused
  by zone access) gains no row; the task re-reads that file's header and says so in the pull
  request.

**Deletion controls** (revision 5, M2 adds the last five). Drop the on-the-box refusal →
`same_machine` fails; skip `admit` → the `not_start_up` and `authority_pending` cases call the
host; send the person's name in the requester → the requester case fails; let the agreeing branch
skip `contrary_proof` → that case writes a row; drop the route's own `target_invalid` → the
agreeing 2001 case reaches `confirmClockStop`, which throws `clock.unusable`
(`packages/fiscal-verifactu/src/first-issue-date.ts:20`), which this route's `STATUS` does not map
(the administrator's routes map it, `box-health-api.ts:65`), so the case's expected 409
`target_invalid` fails — what status the unmapped code gets is the error boundary's, not read here; key the challenges by device instead of by session → the
other-session case is served; drop the admission check inside the confirm's transaction (keep the
one in the challenge) → the withdrawn-between case writes a row; drop `stale` from the agreeing
branch → its counter case writes a row; skip the override's `authorize` → the manager-override case
writes a row; count only AEAT disagreements in `witnessed` (Task 10) → the agreeing-AEAT case
sets the clock from the till.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/till-box-clock-api.test.ts
src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts
src/clock-correction.test.ts`; `pnpm exec vitest run scripts/errors-reachable.test.ts
scripts/personal-log-params.test.ts scripts/no-till-as-issuer.test.ts`.

### Task 12b: The till's check — one at a time, and wired into boot

**Goal.** The concurrency and wiring half of decision 15, split from Task 12a (revision 5, M1).

**Files.** `apps/server/src/till-box-clock-api.test.ts` (new cases) or a sibling
`till-box-clock-api.turn.test.ts` if the first file grows past easy reading;
`apps/server/src/boot.ts` (pass `boxClock` to `mountTillApi`); `apps/server/src/boot.clock-watch.test.ts`
(one case).

**Failing tests first.**
- **Two tills at once:** two staff members on two tills confirm differing times together → the
  host sees exactly one `clock.set`; the other answers `stale` or `not_stopped` (whichever the
  turn makes true), never a second row.
- **The agreeing confirmation takes the turn:** a till's agreeing confirmation started while a set
  holds the turn writes its row only after the set's (order recorded through the stub seat), and the
  deadlock case on the real database, as Task 12's: a held `correction.set` and a till's agreeing
  confirm both finish within a 5-second deadline on real timers (`Promise.race` with a timer that
  fails the case).
- **One boot-level case**, for the wiring (`boot.clock-watch.test.ts`'s environment): a booted
  server with `seams.boxHost` a fake host answering unsynchronised, `seams.requestFromBox` answering
  false, a venue whose latest sale is a day ahead of the real clock, a box that files nothing (so
  the window offers at once), a till session; `POST /api/box-clock/challenge` then `/confirm` with
  `deviceAt` a day ahead → the fake host was asked `clock.set` with a target about a day ahead and
  `{ source: "staff", person, device }`. A booted server's clock is `systemClock()`, which the fake
  host cannot move, so the honest answer is 502 `clock.set_failed { reason: "unverified" }` with no
  `clock_confirmations` row (decision 7's last sentence); a `clock.corrected` only if the measured
  step exceeds a second, which it does not here.

**Deletion controls.** Take the agreeing confirmation out of the turn → its order case fails; move
the turn inside its transaction → the deadlock case hits its deadline; drop the step-counter check
on the differing branch → the two-tills case sees two sets (the host still unsynchronised).

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/till-box-clock-api.test.ts
src/boot.clock-watch.test.ts src/clock-correction.test.ts`.

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
internet connection." `witnessed` — "The box has the tax agency's time, so it confirms or sets its
clock from that time itself, not from a device's. If a try fails, it tries again later."
(Revision 5a: `witnessed` now also answers when AEAT agrees with the box, decision 14, so the words
no longer say it disagrees, and the bell clause goes because nothing is set when AEAT agrees.
Revision 4: "or two tills" goes — devices no longer set the
clock. Revision 5, M4: "sets its clock … by itself" alone was untrue while the backoff holds or the
host refuses a set, decision 6, so the words say it tries and may try again; no "within a minute".) `stale` — "The box's clock changed while this was being
checked. Read the time again." `agrees` — the existing agree path. `host_unavailable` — decision
13's words. Success — "The box's clock is set." and, when `|stepMs|` is more than
`IDLE_TIMEOUT_MS` (FYI 6), "Sign in again to go on."; tills and handhelds are not mentioned, as
they stay signed in.

**Failing tests first** (`box-status-screen.test.ts`, browser): a differing device on a box that
can set shows the question, Cancel and "Use this time"; Confirm sends a fresh challenge then
`clockSet` with `deviceAt`; each refusal's words above the buttons, as the `wt-form-actions`
`error` the dialog already uses (`apps/dashboard/src/screens/box-status-screen.ts:528`; CLAUDE.md
§3's forms rule: one message on its own line above the buttons — revision 5, M3); a box that cannot set still
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

### Task 13a: The till's "Check the time" and its dialog

**Goal.** Decision 15 on the till: the existing red clock line's hint becomes a "Check the time"
button while the marker is held (revision 5, I5 b — no second line), the clock payment refusals
point at it, and a dialog shows the box's time beside the till's, asks the signed-in person to
confirm, offers an administrator's sign-in in place when a staff member cannot (I5 a), and words
every refusal as CLAUDE.md §3 asks — what happened and what each choice does, never "ask someone".

**Files.** Modify `apps/till/src/state/staff-notices.ts` (`nextNotices`, `:23-37`, keeps its
signature and still returns a plain `StaffNotice[]`, leaving out any `clock.check_time` entry; a
new exported `checkTimeOffered(read: DeviceEquipmentRead): boolean` beside it answers whether the
read's well-formed notices hold that marker — revision 5a: a flag on `nextNotices`'s answer would
change its shape and break the file's `toEqual` cases (`apps/till/src/state/staff-notices.test.ts:21`,
`:25`, `:35`, `:43`, `:49`, `:66`, `:94`), which stay unedited; `till-app.ts` calls both where it
calls `nextNotices` today, `:9807`),
`apps/till/src/widgets/notice-strip.ts` (with `checkTimeOffered`, a `clock.behind_chain` or
`clock.unusable` line draws a `wt-button` "Check the time" as its hint, in the first line and in the
opened list; a press dispatches `till-check-time`, `bubbles: true, composed: true`, an app-owned
event name; the class comment's "it emits no events" becomes "its one event is `till-check-time`"),
`apps/till/src/i18n/staff-notices.ts` (`staffNoticeText`, `:23-30`, takes `checkTimeOffered` and
returns the button's words as the hint for the two clock codes; every other code as today),
`apps/till/src/i18n/t.ts` (`clockUnusableText`, `:69`, and `clockBehindText`, `:127`, take the
same flag and end "Use «Check the time» at the top of the screen." / "Usa «Comprobar la hora»
arriba." instead of «Tell a manager» while it is set; `clockDateTime(at)` beside `clockTime`,
`:160`), `apps/till/src/widgets/pay-refusal.ts` (`:78-85` pass the flag),
`apps/till/src/i18n/codes.ts` (the plain-code fallbacks `clock.unusable` / `clock.behind_chain`,
`:783-790`, are unchanged: they are used only when the refusal's params cannot be read), create
`apps/till/src/widgets/box-time-dialog.ts` (`till-box-time-dialog`, a `wt-dialog` with
`wt-form-actions`), modify `apps/till/src/till-app.ts` (holds `checkTimeOffered` from
`#readDeviceEquipment`, `:9801-9810`, passes it to the strip and the pay refusals, opens the dialog
on `till-check-time`, and after a success reads the equipment again at once so the hint clears),
`apps/till/src/api/client.ts` (`boxClockChallenge()`, `boxClockConfirm({ challengeId, deviceAt,
override? })`), `apps/till/src/i18n/strings.ts` (English and the Spanish block),
`apps/till/src/i18n/codes.ts` (`clock.set_refused`, `clock.set_failed`, `clock.check_expired`,
`clock.confirm_refused`, worded by reason; `device_profile.not_admitted` already has till words,
`:735-738`, but they are about signing in — "You can't sign in on that profile" — so the dialog
words it itself, below).

**Existing assertions.** With no marker every word, line and count is as today, so
`notice-strip.test.ts`, `notice-strip.a11y.test.ts`, both `staff-notices.test.ts` files and
`i18n/t.test.ts` (which tests `clockBehindText` and the refusal texts) pass unedited; each new behaviour is a new case with the marker set. If a build finds an
existing case must change, it is a STOP for the lead, not an edit.

**The dialog.** On open it asks for a challenge. The till never asks anyone to type a time; it
sends its own `Date.now()`.
- **The till differs by more than a minute:** "The box's clock says {box}. This till says {till}."
  then "Use this till's time? The box's clock is set to it and payments start again. Every manager
  is told it was you, from this till." Under it, the self-service step for a wrong till: "If this
  till's time is wrong too, correct it in the till's own settings first." Buttons: "Not now"
  (closes; nothing changes, payments stay stopped) and the primary "Use this till's time".
- **The till agrees:** "The box's clock says {box}, and this till agrees. If that is the right time,
  confirm it: payments start again. Every manager is told it was you." Buttons: "Not now" and the
  primary "The time is right".
- On the primary: a FRESH challenge (a challenge lives 5 s), then the confirm with `deviceAt`; the
  primary is disabled while it is sent (CLAUDE.md §3's action states). Success: "The box's clock
  is set to {after}." or "The box's time is confirmed.", with Close.
- **Refusals** are the `wt-form-actions` `error`, one message on its own line ABOVE the buttons
  (revision 5, M3; the dashboard's dialog does the same, `box-status-screen.ts:528`), with the
  choices it leaves as the buttons:
  `not_stopped` "The box's clock no longer needs checking." (Close);
  **`not_start_up`** (revision 5, I5 a) "The box has been running since its clock was last right, so
  a staff member can no longer set it from a till. An administrator can, here." (Close, and
  "Administrator sign-in", which opens the staff picker and PIN pad — the pattern of
  `till-supervisor-override-dialog`, `apps/till/src/widgets/supervisor-override-dialog.ts:24-30`,
  listing the administrators — and on a PIN sends the confirm again with `override`;
  `pin.invalid` / `pin.throttled` / `authorization.not_permitted` are worded as that dialog words
  them, `:19-22`);
  `authority_pending` "The box is still trying the tax agency's time over the internet. Check again
  in a minute." (Check again, Close);
  `witnessed` (revision 5, M4; revision 5a, since it now also answers when AEAT agrees) "The box
  has the tax agency's time, so it confirms or sets its clock from that time itself, not from this
  till's. If a try fails, it tries again later." (Close);
  `target_invalid` "This till's clock reads {till}, which cannot be right. Correct this till's date
  and time in its settings, then check again." (Check again, Close);
  `synchronised` "The box keeps its clock in time over the internet, so it does not take a time
  from a till. Check this till's own clock." (Close);
  `host_unavailable` decision 13's first two sentences, then "If this till's time agrees with the
  box's, you can still confirm it." (Close);
  `stale` "The box's clock changed while this was being checked." and `clock.check_expired` "This
  took too long." (Check again, Close);
  `same_machine` "This screen is the box itself, so its clock is the box's own. Check from a till
  or handheld instead." (Close);
  `contrary_proof` (revision 5, M5) "The tax agency's time or two other tills disagree with the
  box's clock, so this till cannot confirm it. If one of those tills shows the right time, check the
  time from that till." (Close);
  `device_profile.not_admitted` (revision 5, I6) "This till's profile no longer lets you work on it,
  so it cannot check the time for you. Sign in on a till whose profile admits you." (Close);
  `clock.set_failed` `refused` "The box could not set its clock. Nothing was changed." and
  `unverified` "The box asked for its clock to be set but could not confirm it took." (Check
  again, Close). Spanish to match; words as short as the meaning allows.

**Failing tests first** (browser; `memory_pressure | grep free` first):
- `state/staff-notices.test.ts` (new cases): a read carrying the marker and `clock.behind_chain` →
  `nextNotices` answers the clock notice only, and `checkTimeOffered(read)` is true; without the
  marker → false and the list as today.
- `notice-strip.test.ts` (new cases): `checkTimeOffered` with a `clock.behind_chain` notice → the
  line's words unchanged and its hint a "Check the time" button, no «Tell a manager»; the same for
  `clock.unusable`; a press dispatches `till-check-time` once, bubbling out of the shadow root; the
  clock notice as the second of two → the button in the opened list; control, `checkTimeOffered`
  false → «Tell a manager» and no button; a disk-full notice with the flag set → no button.
- `t.test.ts` (new cases; it is where `clockBehindText` and `refusalText` are tested today): a
  `clock.behind_chain` refusal with the flag → ends with the «Check the time» sentence; without → as
  today.
- `box-time-dialog.test.ts` (fake api, `Date.now` stubbed): differs → both times and "Use this
  till's time"; the primary takes a second challenge and sends the confirm with the stubbed
  `Date.now()` as `deviceAt`; agrees → "The time is right"; "Not now" sends no confirm (calls
  counted); each refusal above → its words in the form-actions error above the buttons and its
  buttons; "Check again" asks for a new challenge; `not_start_up` → "Administrator sign-in" → the
  PIN pad → the confirm is sent again with `override: { personId, pin }`.
- `t.test.ts`: `clockDateTime` in English and Spanish, a date in 2001 and one in 2026.
- `till-app.box-time.test.ts`: a read with the marker → the strip's flag set; `till-check-time`
  opens the dialog; after a success the equipment is read again at once (the fake's call count).
- `box-time-dialog.a11y.test.ts`: the differs, agrees, refusal, administrator sign-in and success
  states, in both themes.
- `i18n/codes.test.ts` and `strings.test.ts`: each new key in both languages.

**Deletion controls.** Draw the button whatever the flag → the control without the marker fails;
let the marker through to the strip as its own line → the list case holds two notices; reuse the
first challenge for the confirm → the second-challenge case fails; drop "Not now"'s early return →
it sends a confirm; drop the administrator sign-in → the `not_start_up` case finds no way on.

**Focused commands.** `memory_pressure | grep free`, then `pnpm --filter @waitron/till exec vitest
run src/state/staff-notices.test.ts src/widgets/notice-strip.test.ts
src/widgets/notice-strip.a11y.test.ts src/widgets/box-time-dialog.test.ts src/widgets/box-time-dialog.a11y.test.ts
src/till-app.box-time.test.ts src/i18n/t.test.ts src/i18n/codes.test.ts src/i18n/strings.test.ts
src/i18n/staff-notices.test.ts src/api/client.test.ts`; `pnpm exec vitest run
scripts/staff-notice-codes.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts
scripts/english-only.test.ts`.

### Task 13b: A running stop's alert and email lead an administrator to set the clock

**Goal.** Decision 17: the words of the alert and email the stop already raises point to the
administrator's "Use your device's time?", and stop sending the reader to whoever installed the box
(CLAUDE.md §3's refusal rule) — the box can now set its own clock.

**Files.** `apps/server/src/i18n/box-emails.ts` (`clock.unusable`, `:22-31`; `clock.behind_chain`,
`:32-41`), `apps/dashboard/src/i18n/alert-messages.ts` (`clock.unusable`, `:200-203`; the bell's
`clock.behind_chain`, `:167-170`, already ends "Sort it out on the Box status page" and is left as
it is), `apps/server/src/box-alert-email.test.ts` (changed test check 9),
`apps/dashboard/src/i18n/alerts.test.ts` (new cases).

**Words (English; Spanish to match).**
- `clock.unusable`, bell: "The box's clock reads {clockAt:minute}, before 28 October 2024, so no sale
  can be recorded for the tax agency. With the internet the box puts it right by itself; otherwise
  an administrator can set it on the Box status page."
- `clock.unusable`, email: "The box at {venue} has its clock set before 28 October 2024, so no sale
  can be recorded for the tax agency until the clock is right. With the internet the box puts it
  right by itself. Otherwise an administrator can set it from their own phone or computer on the Box
  status page (in the dashboard, Settings → Box status); if the box has just started, any staff
  member can do it from a till with «Check the time»."
- `clock.behind_chain`, email, its "What to do": "• If the box's clock is wrong (usual after a power
  cut): with the internet the box puts it right by itself; otherwise an administrator can set it
  from their own phone or computer on the Box status page (in the dashboard, Settings → Box
  status), and if the box has just started any staff member can do it from a till with «Check the
  time». • If you think the box's clock is right: an administrator can confirm it on the same page;
  with the internet the box does it by itself, and so do two tills that agree with it — except just
  after a start, when a staff member confirms it from a till with «Check the time»." (Revision 5,
  R1: two agreeing devices lift the stop only outside the start-up window, decision 18.)

**Failing tests first.** `alerts.test.ts`: `clock.unusable` in both languages names the Box status
page (`t("nav.box_status", …)`) and contains neither "installed" nor "instaló". The email: changed
test check 9's new exact English text; the `clock.unusable` email in both languages contains
neither "installed" nor "instaló" and names the till's button as it is written there — the
literals "Check the time" and "Comprobar la hora", which Task 13a's strings test pins too, since the
server does not import the till's strings.

**Deletion control.** Put "ask whoever installed it" back in either text → its new case fails.

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts
src/box-alert-email.duty.test.ts`; `memory_pressure | grep free`, then `pnpm --filter
@waitron/dashboard exec vitest run src/i18n/alerts.test.ts`; `pnpm exec vitest run
scripts/alert-codes.test.ts`.

### Task 13b's departures (2026-10-31)

- **English quotes the till's button as “Check the time”**, as Task 13a's till strings do (not «…»,
  which the plan's words used); Spanish keeps «Comprobar la hora».
- **The Box status page's own Clock-row advice changed too** (`box_status.clock.behind_chain_fix`,
  `apps/dashboard/src/i18n/strings.ts`), which still said "call whoever installed it": it now reads
  "With the internet the box corrects its clock by itself; otherwise an administrator can use “Check
  with this device's time”." Its new case is in `box-status-rows.test.ts`. The guides
  (`apps/server/src/guide/{en,es}/box-status.md`, the Clock row's quoted words and "call whoever
  installed the box: the box has no page for setting its clock") are this plan's guide task's to
  rewrite.
- **The email cases test for `install`/`instal` as a stem**, so "installer" is caught as well as
  "installed".

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
the tax agency's time by itself; after a start with no internet, from a till's time once a staff
member signed in on it confirms it ("Check the time"); and at any time from an administrator's
device on "Use your device's time?" — never while it keeps time over the internet, and never from
two tills on their own (two tills that agree with the box can still restart payments while it is
running, slice 9, but not just after a start, decision 18);
that while the box is running a clock stop alerts the administrators; a new section `{#clock-service}` on the time service,
`clock.sync_off`'s reasons and decision 13's words for `unreachable` (no install instruction);
"Emails about the box" (`{#emails}`) gains the clock-change email and its limits (a restart before
it is sent loses it for a change already handled; once the change is handled, a manager whose
address the mail server refused outright is not tried again — Task 9's review); the sign-in note of FYI 6 (only a dashboard
session; a step of more than half an hour either way ends it, and a smaller forward step shortens
its idle time by the step; tills stay signed in); and the backup hold's limit (Task 14: only
steps the box made). `apps/server/src/guide/{en,es}/till-notices.md`: the `{#notices}` section
gains what "Check the time" at the end of a red clock line means (the box started with its clock in
doubt and could not reach the tax agency's time), what the dialog shows,
what each button does, that nobody types a time, that the till's own time is what is sent so a
wrong till must be corrected in its settings first, and that every manager is told who confirmed
and from which till. The section now describes the clock line's hint, not a separate line
(revision 5): while offered, "Payments stopped: the box's clock reads earlier than its last sale"
ends in "Check the time" instead of «Tell a manager». Its paragraph on fixing the clock
(`till-notices.md:58-60`, "tax agency or two tills or handhelds confirm the clock, or an
administrator confirms it there") is rewritten to stay true after decision 18: the tax agency, an
administrator, or — just after a start — a staff member with «Check the time»; two tills or
handhelds that agree with the box only once it has been running (they never set it). `deploy/README.md` gains the host
service (Task 18).

**Focused commands.** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`;
`pnpm exec vitest run scripts/guide-links.test.ts`.

### Task 17: LOOK, without the dev stack

The dev stack (`wa-wt demo`) needs Docker, which is not answering on this Mac, so the LOOK uses the
browser test runner: a throwaway case (not committed) in `apps/dashboard` renders the Box status
screen with (a) the set question open, (b) each set refusal above the buttons, (c) the Clock row
with "Not kept in time over the internet", (d) the bell with `clock.corrected` for each source —
AEAT, an administrator, a staff member with the till's name — and each `clock.sync_off` reason,
and the reworded `clock.unusable`; and a throwaway case in `apps/till` renders (e) the red clock
line with its "Check the time" hint (both clock codes), alone and as the second of two notices with
the list open, and a refused payment's text with the «Check the time» sentence, and (f) the dialog
in each state — differs, agrees, sending, success, every refusal above its buttons, and the
administrator sign-in's picker and PIN pad — with times days and years apart. Each is saved with `page.screenshot` at 1280 and 390 wide (the till also at 1024, a
till tablet's width), light and dark, English and Spanish, into
`~/waitron-campaign-b/a798-9b-shots/`. The two emails' texts (`clock.corrected` for a staff member,
and the reworded `clock.unusable` and `clock.behind_chain`) are written to a file and read. The
lead opens every image and notes what it saw in the ledger — in particular that the dialog's two
times and its buttons fit a 390-wide phone in Spanish without clipping; a defect goes back to its
task.

### Task 18: Developer docs, CLAUDE.md, the deploy README, the asesor question and B3's contract

- `docs/developers/conventions-data.md`: a section "The box sets its own clock" after "A
  confirmation of the clock lifts the stop for one step back" (`:3969`): the host service and its
  two requests, the order, the step counter and `stale`, what a step's row stores, the alert and
  its email, the backoff, the pruning holds and their limit, Task 15's audit table, Tasks 15a
  and 15b's rule, the turn taken before the write lock, the measurements with their run URLs, and
  (revision 4) the start-up window, the till's check and its refusals, the devices-only lift held
  during start-up (decision 18), and (revision 5) the `staff` source and its one migration —
  including that a drizzle table rebuild must be rehearsed on `node:sqlite`, since the system
  `sqlite3` 3.51.0 CLI refuses the rename that SQLite 3.54.0 accepts ("What slice 9 left").
  CLAUDE.md §3's migration traps gain that one line if the lead agrees it is a reusable trap.
  Update "A jump" (`:4163`) for `stepComing`'s and `reanchor`'s take-and-record and the hold until
  `reanchor`.
- `CLAUDE.md` §5's clock bullet, whose list of confirmation sources today reads "AEAT, two agreeing
  devices at different addresses or an administrator's own device, never a box device outside
  development", gains the staff member and loses the devices during start-up: "two agreeing devices
  at different addresses (not while the stop found at start-up lasts) or an administrator's own
  device, or, during a stop found at start-up and once AEAT has not answered, a till's time
  confirmed by a staff member signed in on it (owner, 2026-10-31)", naming
  `clock-watch.start-up.test.ts` among its guards; and one
  clause: "the box sets its clock only through the host service, from AEAT, a staff member's till
  at start-up or an administrator's device — never from devices alone and never while it keeps time
  over the internet — and every step it makes is alerted and emailed", naming its guards
  (`clock-correction.test.ts`, `clock-set.route.test.ts`, `till-box-clock-api.test.ts`,
  `scripts/waitron-box-sh.test.mjs`) and saying they are weaker than the rule where they are (the
  handler's suite runs stubs, not systemd; the route suites cover the named routes only). Run
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
  "A system that corrects its own clock from a till's clock when it has no internet (added
  <date>)" — whether a SIF may correct its own clock, when it cannot reach AEAT's time, from the
  clock of one of its own tills once a staff member present confirms that time on the till, or
  from an administrator's own device; what it should record (today: who confirmed, which till, the
  readings before and after, the step, kept in an append-only table, alerted and emailed to the
  managers); and whether records dated by the clock before such a correction need any treatment
  beyond the list the box already gives the owner. Its text names FYI 4's residual risk: a scripted
  request from any staff member signed in on an enrolled till, during a stop found at start-up —
  after slice 9c, at every start without internet — can set any time between 2024-10-28 and 2100,
  with that person named. Plain English with a Spanish quotation block, as Q60 has; a dated note at
  the top beside the 2026-10-24 one; none in the shortened list.
- **B3's plan** (`docs/superpowers/plans/2026-10-26-b3-usb-installer.md`, Task 3.1, after its
  **Interfaces** paragraph at `:158`; the lead's ruling (a)): a paragraph "The clock requests
  slice 9b shipped" stating the server↔host contract B3 must keep or migrate: the socket
  `/run/waitron-box/box.sock` (`waitron-box.socket`, `Accept=yes`, host group `waitron-box` of
  gid 10001, mode 0660) and its
  template `waitron-box@.service`, which B3's planned `waitron-box.service` would collide with by
  name; the server's client `apps/server/src/box-host-client.ts`, which B3's plan lists as a NEW
  file (its Task 3 row, `:51`) but 9b creates first, so B3 changes or replaces 9b's client rather
  than creating it; one text line in, one JSON line out; `clock.status` and `clock.set
  <epochMs> <requester>` with decision 2's and decision 3's replies; the three requesters 9b sends
  (`{ source: "authority", check }`, `{ source: "admin", person }`, `{ source: "staff", person,
  device }`, ids only); and that the requester is
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
   alert and email, that a till's time (confirmed by a staff member at start-up) and an
   administrator's can now set the clock, and that two devices alone no longer can; "The clock
   watch's suspend-aware clock has not been run on Linux" (`docs/backlog.md:5106`) is narrowed to what M3 measured
   (a setting of the wall clock), leaving a real suspend unmeasured.
2. New entries: B3 keeps or migrates 9b's clock requests and requester (the lead's ruling (a),
   pointing at the B3 paragraph Task 18 writes); the box's certificate issued under a clock wrongly
   ahead (Task 15); the hours read, the end-of-day pass and the correction check after a
   backward step, and the accepted cross-chain case (Task 15a, ruling (e)); the stream's
   pruning measured by the bucket's own times (Task 15); anything else Task 15 accepted
   that a later slice must revisit; and, from revision 4: a clock wrong forward at start (or wrong
   backward by less than the gap to the last sale) asks nobody until slice 9c's start check
   (decision 14); a node promoted while running gets no start-up window until it restarts, and a
   window stays open while every read of the stop keeps failing (decision 14, both stated, not
   fixed); the go-live migration squash folds Task 8-0's rebuild in with slice 9's migration.
3. This plan's status line: built, parked, the pull request's number. (The measurement workflow
   was deleted in Task 4; `git log --diff-filter=D --oneline --
   .github/workflows/host-clock-measure.yml`
   shows that commit.)

## Review notes

**Per-task review** after each task, at `high` effort, on that task's diff, stating the experiment
it ran.

**Codex seat 1 (with this checklist).** On `clock-correction.ts`, the watch, the
administrator's route and the till's route with clocks the test controls (a server booted with `seams.boxHost` cannot
have its clock moved by the fake host, so there it checks only that the host is asked): a venue a
day ahead of the box; AEAT disagreeing by a day → within one look one `set`, one row
`source: "authority"`, `clock.corrected` open; two devices
from two addresses disagreeing, no AEAT → nothing set (revision 4); during a start-up stop with AEAT
unanswered, a staff member's till a day ahead → one set, the row `source: "staff"` with `proof.staff`,
`clock.corrected` naming the person and the till; the same after the window has closed →
`not_start_up`, nothing set; a till agreeing → the stop lifted with no step; two devices agreeing
with the box during the start-up window → no lift, and the same after the window closed → slice
9's lift; the host answering
synchronised → nothing set, `clock.sync_off` absent (it is on) and the Clock row unchanged; the
host missing on a production box → `clock.sync_off` `unreachable`, with no install instruction in
its words; an administrator's `POST /api/box/clock-set` refusals each with zero rows; two steps
within a minute → two emails; a host that refuses every set → at most one set per backoff step; a
+400-day and a −400-day step against `pruneBackend`. Delete, one at a time: the synchronised
refusal in the handler and in the server, the verification, the step counter, `stepComing`'s hold,
the `witnessed` check, the `held` window, the backoff, the till route's `admit` and its
on-the-box refusal, decision 18's gate, the person CHECK's `staff` half; name the failing test.

**Codex seat 2 (checklist set aside)** — make the box set a wrong time, or lose data:
- forged matching headers from two device cookies at two addresses (expected, revision 4: the
  clock is NOT set; if they agree with the box during a running stop, slice 9's lift, nothing
  more; during the start-up window, not even that — revision 5, decision 18);
- a slice-9 database upgraded across Task 8-0's migration (expected: every `clock_confirmations`
  row kept, both append-only triggers present after start, an UPDATE and a DELETE refused, a
  `staff` row without a person refused);
- a staff member's till session sending a forged `deviceAt` by `curl` during a start-up stop
  (expected: set, with the person and the till named in the row, the alert and the email — FYI 4);
  the same from the box's own address (expected: `same_machine`); the same with the window closed
  by a look that found no stop, then the stop brought back (expected: `not_start_up`), and then
  with an administrator's PIN as `override` (expected: set, `source: "admin"`, the till named);
  the profile's admission withdrawn while the confirm waits (expected: `device_profile.not_admitted`);
- a restart of the server during a running stop (expected: the stop is a start-up stop for the new
  process, FYI 8; the till is offered once AEAT has had no answer);
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

Revision 5 adds two, on the fresh-context review of revision 4: **(R1)** while the start-up window
is open, two agreeing devices do not lift the stop by themselves (decision 18); **(R2)** a staff
member's confirmation gets a real `staff` source through one migration (Task 8-0, decision 16);
every other finding folded as the review proposed (the revision note at the top).

Revision 4 changes none of these rulings. It carries out the owner's answer of 2026-10-31 07:00 and
07:05; where the owner left a point open, the default is an owner FYI (8–15), not a lead's ruling.

### Ruling R3 and Task 8's departures (2026-10-31, while building Task 8)

- **R3: the till is named `device`, never `till`, in fiscal code.** `scripts/no-till-as-issuer.test.ts`
  refuses any identifier matching `/till/i` under the fiscal packages
  (`scripts/no-till-as-issuer.mjs:74`), and decision 16's `till` key and `ClockAdminConfirm.till`
  are identifiers there. So `ClockAdminConfirm.device = { deviceId, deviceLabel, address }`, and an
  administrator's reading on a till is stored with a `device = { deviceId, address }` key beside
  `admin` (written only when set, as decision 16 says of `till`). Every later task that names
  `admin.till` or `proof.till` reads `admin.device` and `proof.device`. Code outside the fiscal
  packages may still say till.
- **The step in words** is a new formatter kind, `{stepMs:duration}`
  (`packages/dashboard-kit/src/alert-messages.ts`): the two largest non-zero whole units from days to
  seconds, worded by the browser's own `Intl.NumberFormat` units joined by `Intl.ListFormat`
  ("2 days and 3 hours" / "2 días y 3 horas"), so no Spanish enters the kit (its source is scanned
  by `scripts/english-only.test.ts`). The direction is a `direction` param, `"forward"` or
  `"back"`, worded by the dashboard's `clock_step_direction` list. Changed test check 2a.
- **`unverified`** is a param beside `verified` (always `!verified`): a variant is chosen only by a
  param being `true` (`packages/dashboard-kit/src/alert-messages.ts`, `chooseTemplate`). The
  unverified words name no person, because a `replace` variant cannot combine with another.
- **Times in the bell** use `{name:minute}`, the browser's zone, as every other clock alert does;
  no formatter kind writes an instant in a stored offset. The email (Task 9) writes each time in its
  own offset.
- **`clock.behind_chain_restarted`** gains `confirmedBy: "staff"`, `byStaff?: true` and
  `device?: string | null` in Task 8 (each key only when set), because Task 8's seat records it;
  Task 8a's bell and email words use them. `scripts/personal-log-params.test.ts` approves both
  `byStaff` keys as naming no one.
- **No stop, but a check open**: the step closes that check (decision 7), and names the latest
  record when the after reading is still more than a minute behind it, as during a stop.

### Task 8's per-task review, folded (2026-10-31)

- **The unverified step's words** no longer say the box "asked to move its clock from {before} to
  {after}": `after` is the reading taken after the attempt, not the time asked for (`targetAt`,
  which the alert does not carry). They now say the box tried to set its clock and could not
  confirm it took, and what the clock read before and after. Task 9's email follows the same rule.
- **An earlier `clock.corrected` is marked handled at the later of its own detection and the new
  step's after reading**, so a second step that goes back never makes it handled before it was
  detected (`clock-stop-incidents.ts`, `recordCorrected`).
- Two cases added for rules the review's mutations showed untested: a step with no stop but a
  check open names the latest record when it lands more than a minute behind it, and an after
  reading exactly a minute behind names none.
- **Task 8's database-constraint case moved, it was not dropped**: `confirmClockStep` refuses an
  `admin` source with no person before any write, so the case cannot reach the database; Task
  8-0's `clock-confirmations.test.ts` tests the constraint directly.
- Not changed: the row's `step_ms` is `Math.round(stepMs)` while `proof.step.stepMs` and the alert
  keep the measured value, a difference under a millisecond. A till's label is `devices.label`,
  NOT NULL in the schema, so `deviceLabel` is null only when the device row is not found; Task 12a
  builds the staff input from the signed-in device's own row, and the bell then writes the kit's
  "—" for a missing value.

### Task 8a's per-task review, folded (2026-10-31)

- **`confirmClockStop` refuses a staff member's input with no till** before any write, as Task 8's
  `confirmClockStep` does: a staff reading counts only as a device that is not the box (decision
  15), and an append-only row naming no till could never be put right. No caller passes `role`
  yet; Task 12a's route is the first.
- **The two sentences that name a staff member say "miembro del personal" in Spanish**, not "un
  empleado" as Task 8a's text had it: the person's name follows, and the code cannot know whether
  "empleado" or "empleada" fits. The words without a name keep "un empleado".
- **The wrongly-dated sales CSV header reads "a staff member (Ana) on a till"** ("un miembro del
  personal (Ana) en una caja"), so the name sits beside the person and not beside the till.
- Added a staff `differs` case during a stop, so a later caller that skipped the agreement check
  for a staff member is caught here.

### Task 9's departures (2026-10-31, while building Task 9)

- **The step's length in the email uses the bell's own formatter, moved to `@waitron/shared`** as
  `formatDuration` beside `formatBytes`, which the kit already re-uses the same way; the kit's
  `{name:duration}` now calls it, and its tests are unchanged.
- **`boot.ts` is not changed in Task 9.** The code that records a step (`clock-correction.ts`) is
  Task 10's, so boot keeps the duty's handle and Task 10 hands `boxEmails.remember` to the
  correction as `onCorrected`; Task 10's "`onCorrected` called once per step" case is the deletion
  control for that call.
- **Not configured ends a handled `clock.corrected` episode, as no recipients does**, so a step
  remembered while email is unset is never emailed once email is set up; the bell keeps it.
- `boot.failed-start.test.ts`'s stand-in for the duty gains the new `remember` (a fixture growing
  the method it lacks; no assertion changed).
- `INCIDENT_EMAIL_CODES` has no whole-list assertion in `apps/server/src` (the plan's grep printed
  nothing), so there is no changed test check 5.

### Task 9's per-task review, folded (2026-10-31)

- **A handled `clock.corrected` email ends for a manager whose address was refused outright**
  (`rejected`), as well as for one who has it (the lead's ruling on review finding I1): decision 9
  said "until every recipient has been sent it", and a permanently refused address would have kept
  every handled step in memory, re-sent each minute, until a restart. An `unknown` outcome is
  still tried again; while the alert stays open, a refused address is still tried again, as for
  every other code. Task 16's guide states the limit.
- Cases added for two exits the review's mutations showed untested: a handled step's failed send
  is tried again; a step that reached everyone ends once its alert is handled (the email settings
  are read no more). Also a database case: `readOpenEmailedIncidents` reads an open
  `clock.corrected` and no handled one.
- **The email chooses its words by `source`, not by `byAdmin`/`byStaff`**, writing "—" for a
  missing name as the bell does, so no person's step can ever be worded as the tax agency's.
- Comments narrowed: the restart limit applies only to an alert already handled (an open one is
  read again after a restart); the episode ends when nothing is left worth trying.
- Not changed: the review's M7 (the guide half "assigned to no task") — Task 16 already names it.

### Task 10's departures (2026-10-31, while building Task 10)

- **`confirmClockStep` answers the alert it recorded**, `corrected: { id, params } | null`
  (`ClockStepRecorded` in `packages/fiscal/src/backend.ts`), because the email duty's `remember`
  needs the alert's id and core's `recordIncident` answers nothing: `recordCorrected` reads back
  the one open `clock.corrected` after recording it. Changed test check 14.
- **The interface's deps grow two methods it needs**: `backend` also picks `assertRecordableAt`
  (how the correction judges `clock.unusable` again, as the watch's `recordable` does), and
  `store` also picks `witnesses` (what `clockStopState` judges, and AEAT's readings during
  `clock.unusable`). `latestRecordAt` is not an input: the stop judged inside the turn names the
  latest record.
- **The order of refusals inside the turn**: `stale`, then `target_invalid`, both before anything
  is read; then the stop and, for a staff member, `admit`, in one write-lock turn; then the host's
  status (`host_unavailable`, `synchronised`); then, for a person, `witnessed` and `agrees`. So
  `stale` and the till's refusals ask the host nothing at all, and `witnessed` and `agrees` are
  answered only once the host is known to be available and unsynchronised, as decision 10 orders
  them. During `clock.unusable`, `witnessed` is an AEAT reading among the store's witnesses whose
  box time is itself before 28-10-2024: the store keeps AEAT's disagreements until a usable
  reading ends the stop proper, so one kept from before the clock went back was not taken during
  this stop (review I2). `stale` is judged again after the host's status and the anchors, just
  before the target is computed, since those waits leave time for a step by the time service.
- **A set the host did not confirm is never verified**: a timeout or a lost connection is
  recorded with `verified: false` even when the clock reached the target. This follows Task 10's
  test text and overrides decision 4's parenthesis ("`verified: false` when the clock did not move
  to the target"); it errs the safe way, since an unverified step writes no row and lifts no stop. The seat is asked for nothing,
  and the witness store is kept, when the clock moved by a second or less, whatever the host
  answered; the set then answers `refused`. A verified set whose row is pending answers
  `confirmationId: null`. When the boot-time clock cannot be read (`bootReader` answers NaN),
  the step is measured against the steady clock instead, so a real step is never taken for an
  unmoved clock (review M1).
- **No set while a step's row is pending** (review I1): the pending row is not in the database,
  so the stop still reads as holding, and a second set's row written first would be judged
  against a check the first step's row should have closed. A set answers `pending_disproofs`
  until `writePending()`, which now takes the turn, has written every kept row. An email duty
  that throws is logged, never turned into a second write of the row.
- **The step counter's deletion control is its own case**: in the two-together case the first
  set moves the fake wall clock, so the wall-against-steady check also refuses the second; the
  counter is proved by "refuses an offset measured before a step the correction made", which
  measures afresh after the step.
- **`clock.set_refused` and `clock.set_failed` are added with the route that throws them, Task
  12**, not here: the correction answers its refusals as data and throws neither.
- **Boot builds the correction in Task 11**, with its first caller, the watch: `onCorrected:
  boxEmails.remember` (Task 9's departure), and an anchor whose `reanchor` clears
  `clockServiceCache` and `timeHealthCache`, so a reading taken before a set is not served for a
  minute after it (Task 7's review).

### Task 11's departures (2026-10-31, while building Task 11)

- **Boot's wiring has its own boot-level case**, `apps/server/src/boot.clock-correction.test.ts`
  (not named in Task 11's files): the watch is handed the correction boot made and is one of its
  anchors, and after the anchors re-anchor, box status and the alerts read the time service
  afresh instead of from the one-minute caches. Each of the four wiring lines has a deletion
  control that fails it.
- **The correction has two anchors, not one**: the watch, and one whose `reanchor` clears
  `clockServiceCache` and `timeHealthCache` (Task 10's departure). Task 11a's boot case ("that
  correction has the watch as its one anchor") must read "has the watch among its anchors".
- **The host client and both caches are created before the correction in boot**, above
  `startClockWatch`, so the cache anchor names them; nothing else about them moved.
- **`forSetting()` answers `SettableReading { witness, at }`**, AEAT's fresh agreeing readings
  first, then its fresh kept disagreements, in the order `witnesses()` lists them; "fresh" is the
  store's own test (at most five minutes old by the steady clock, no step since), so a kept
  disagreement older than five minutes is not handed out for setting either (its own case).
- **The two-looks case moves the wall clock before each look**, not once before both: with a
  single move, clearing the hold on the next look still passed (the second look compares
  against the first look's reading, taken after the move). With a move before each, that
  deletion control fails.
- **`reanchor` clearing the hold when its write fails** has its own deletion control (clear it
  only on success → the reanchor-fails case sees no jump).

### Task 11's per-task review, folded (2026-10-31)

- **A stopped watch refuses a set it cannot guard** (review I2): after `stop()`, `stepComing` and
  `reanchor` throw while a disagreeing AEAT reading is left unrecorded, so the correction refuses
  the set (`pending_disproofs`) or keeps the row pending rather than writing a lift that reading
  would disprove. With nothing unrecorded they still answer success.
- **`reanchor`'s reset of the jump comparison has its own case** (review I1): a forward set with no
  look during it, then one look, records no jump; deleting the reset fails it.
- **The hold lasts until `reanchor`'s write is done** (review M3): a look during that write records
  no jump; clearing the hold first fails it.
- **`forSetting()`'s freshness filter on agreeing readings has its own case** (review M4), read
  before `witnesses()` could prune them.
- **For Task 11a** (review): the watch's `correction` dependency widens from `{ inTurn }` to also
  take `set`, `steps` and `writePending`.

### Task 11a's departures (2026-10-31, while building Task 11a)

- **The set carries AEAT's reading alone as its witness**, not every witness the look judged:
  the seat's step row takes the first `authority` witness and every `device` witness it is
  handed as the proof that set the clock (`packages/fiscal-verifactu/src/clock-step.ts`), so
  disagreeing devices handed in beside AEAT would be recorded as having set it.
- **A disagreement the store no longer hands out for setting sets nothing**: the offset's
  `measuredAt` comes from `forSetting()`, matched to the stop's `contrary.authority` by its two
  times, and a reading older than five minutes by the steady clock (or from before a step) is
  not among them, although the stop still lists it until the stop ends. Its own case, with a
  fresh reading beside it as the control.
- **No new boot-level case**: Task 11's `boot.clock-correction.test.ts` already shows the watch
  handed the correction boot made and among its anchors (Task 11's departures). Boot passes the
  whole correction, so `set`, `steps` and `writePending` reach the watch with no boot change.
- **The look's other failures do not stop it**: a `writePending()` or a `set` that throws is
  logged `clock_watch.check_failed`, and the look goes on (a set still runs after a failed
  `writePending()`; AEAT's disagreement is still recorded after a failed set). The plan's
  `writePending()` rule is kept as written: only after that look's first `recordPending()`
  succeeded.
- **The refusal log** is `info` `clock_watch.cannot_set { reason }`, written when the reason
  differs from the last one logged; a set that goes through forgets the last reason, so the same
  refusal after it is logged again.
- **Fixtures grown, no assertion changed**: the fake stores in `clock-watch.test.ts` (two) and
  `clock-watch.elapsed.test.ts` gain `forSetting`, and `clock-watch.anchor.test.ts`'s harness
  fills in `set`, `steps` and `writePending` (a refusal, 0, nothing) around the `inTurn` its
  cases hand it, since the watch's `correction` dependency now names all four.
- **Deletion controls**: besides the plan's three (drop the `contrary` branch; a revision 3
  branch setting from the devices' reading; drop the backoff), each of these fails a named case
  of `clock-watch.correction.test.ts`: back off every refusal; no doubling; no four-hour cap; a
  backoff not keyed by the check; log every refusal; keep the last reason after a set;
  `writePending()` after a failed disproof write; no `writePending()`; `stepsSeen` not read; a
  set during `clock.unusable`; a stale reading set with the look's own clocks.

### Task 11a's per-task review, folded (2026-10-31)

- **A host socket that is gone at the set is `host_unavailable`, not `refused`** (review M1): the
  host client's `missing` answer means the request never reached the host, so the correction
  answers `host_unavailable` and the watch does not back off on it, as decision 6 says. A
  timeout, a lost connection, a malformed answer and the host's own refusal still answer
  `refused` when the clock did not move.
- **No set on a look whose first disproof write failed** (review M2): the set could only be
  refused `pending_disproofs`, after asking the host's status and retrying the failing write
  twice through the watch's own anchor methods. This also keeps true the comment that each
  pending disproof is tried at most once a look.
- **When the step counter is read has its own case** (review M3): the counter rises while the seat
  judges the stop, and the set must carry the value read with the witnesses.
- **The stop-during-a-look cases now see what they name** (review M4): the `writePending` variant
  asserts no stop read follows; the check after the set was removed, since the check before the
  AEAT ask already covers it (nothing between them can run on a `contrary` stop).
- **Renamed** the case that counts sets per backoff step (review M5); the boot case checks all
  four correction methods the watch is handed, with a deletion control (review M6); the watch's
  description names the automatic set (review M7).
- **Not changed**: a steady clock that cannot be read lets a set through the backoff, as it lets
  an AEAT ask through (`authorityDue`); the reviewer called it a deliberate choice.

### Task 11b's departures and per-task review, folded (2026-10-31)

- **The marker has a source and an owner of its own** (review I1). `boxStaffNoticeSource` is
  unchanged; `clock.check_time` comes from `clockCheckNoticeSource(check)` under the owner
  `box-clock` (`BOX_CLOCK_NOTICE_OWNER`), which `deviceNoticeSources` adds after the box's own source
  only when it is handed a `clockCheck`. Cost avoided: the box's source used to read no database, and
  with the clock-stop read inside it a failing read marked the whole `box` owner unavailable, so the
  till kept a stale storage notice or missed a new disk-full one. The literal stays in
  `apps/server/src/box-staff-notices.ts`, which `scripts/staff-notice-codes.test.ts` reads. **For
  Task 13a:** the till finds the marker by its code; its owner is `box-clock`, not `box`.
- **`createAuthorityClockStatus` moved down beside the window**, straight after `isSingletonPrimary`,
  so its `onSample` can tell the window AEAT answered. Its first use is the alert source after the
  watch, and nothing calls its `observe` before the filing wiring.
- **The watch reports `authorityAsked` only after its `stopped` check**, as it notes the sample.
- **`tillClockCheck`'s "the box can ask"** is `filesRecords()` and a seat with `readAuthorityTime`,
  decision 14's definition; it skips its read once the window has closed.
- **The boot cases are a new file**, `apps/server/src/boot.clock-start-up.test.ts`; the non-primary
  boot stamps the deployment before setting the singleton role `secondary`. Its cases also check
  that the till's check reads the same window, seat and filing switch as the watch (review I2) and
  that a filing reply's AEAT time still reaches the witness store (review I3).
- **The till's words until Task 13a**: "The box's time needs checking" / "Hay que comprobar la hora
  del equipo", with the tell-a-manager hint the other fixed codes take. Its case checks only the
  words (review M3), so Task 13a's change of hint edits no assertion.
- 26 deletion controls (20 from the task, 6 from the review), each failing a named case.

### Task 12's departures and per-task review, folded (2026-10-31)

- **`clock.set_refused` already carries `target_invalid` and `pending_disproofs`**, because an
  administrator's set can be refused for both (a device time before 28-10-2024 or from 2100 on;
  readings from before an earlier step not yet recorded). Task 12a adds only `not_start_up` and
  `authority_pending`; Task 13's refusal words cover `stale`, `target_invalid` and
  `pending_disproofs` as well as decision 10's list.
- **The route judges which stop it is answering** from the seat's date check
  (`assertRecordableAt`): `clock.unusable` there is the before-28-10-2024 stop, anything else the
  clock-behind one. The correction judges the stop again inside its turn either way.
- **The correction's successful answer carries `confirmedAt`**, the reading the row's
  `confirmed_at` is written from, so the route answers `{ confirmationId, stepMs, confirmedAt }`
  without a second reading.
- **The administrator's set hands the correction no witnesses** (review I1): the row's proof lists
  what set the clock, and that is the administrator's device alone, which travels as `admin`.
  Handing over the witness store wrote every device the box had noted, and during the
  before-28-10-2024 stop an AEAT reading kept from the stop before, into an uncorrectable row as
  if they had set it. Both cases now pin `authority: null, devices: []`; each fails when the
  store's witnesses are handed over again.
- **Review, folded:** the error comments now say the box asked its host to set nothing (it does
  ask for the time service's status), that `target_invalid` also covers 2100 on, that
  `pending_disproofs` is an earlier step's readings, and that `refused` is a clock that moved by a
  second or less; the midpoint case's round trip is 4 seconds, so a wall/steady pair measured at
  different moments is refused `stale` (its control fails that case).
- **Not changed (review M4):** the order case's 200 ms race and the deadlock case's 100 ms wait
  decide only whether the broken versions are caught; with the turn in place neither can fail.

### Task 12a's departures and per-task review, folded (2026-10-31)

- **The challenge takes an `override` too, and checks only that one is there.** A staff member
  refused `not_start_up` asks again with an administrator's PIN; the challenge then skips the
  window's checks, and the confirm checks the PIN and, when the confirm carries no override, the
  window again (a case pins that a made-up override at the challenge still meets `authority_pending`
  and `not_start_up` at the confirm, on both branches). A challenge grants nothing by itself.
- **The confirm checks the person's admission before it takes the challenge** as well as inside the
  turn, so a till whose profile no longer admits the person is told so rather than that its check
  expired.
- **The seat, the clock and development mode come from `TillApiDeps`** (`backend`, `clock`,
  `devMode`); `boxClock` carries the correction, the window, the witness store's `witnesses` and
  `clear`, `readBoot`, `steady`, `requestFromBox` and `filesRecords` (the box can ask AEAT only when
  it files records).
- **Every refusal of the agreeing branch but `contrary_proof` is `clock.set_refused`**
  (`stale`, `not_stopped`, `not_start_up`, `authority_pending`); Task 13a's words cover both codes.
- **An administrator on a till is refused `not_stopped`** where no stop holds, rather than closing a
  check that waits: that stays the dashboard's (decision 10's route).
- **The till is stored under the proof's `device` key** beside `admin`, as Task 8 built
  `confirmClockStop` (ruling R3), not under `till`.
- **A staff member's set hands the correction no witnesses**, as Task 12's review decided for the
  administrator's; `witnessed` is still judged from the correction's own store.
- **The agreeing branch also refuses `stale` when the wall clock moved against the steady clock by
  more than a second** while the confirm waited for its turn (review I1): a step the correction did
  not make, such as the time service's, voids the comparison as one it made does. The plan asked
  only for the step counter.
- **Deletion controls.** The plan's "key the challenges by device" is caught by a case where the
  next person signed in on the same till answers the first one's challenge; keying by person is
  caught by the same person on two tills. Added controls, each failing a named case: the confirm's
  own window checks, the override's PIN derived outside the write lock (`watchDerivationsAndLock`),
  the witness store emptied after an agreeing confirmation, the wall-clock drift, and an override
  that is not an object answered `management.request_invalid { field: "override" }` (the till's
  `parseOverrideField`, reused).
- **Review, folded:** the `clock.set_refused` and `clock.confirm_refused` comments name the till and
  staff member; a person's name is read with `requiredNameOf`, which throws, as the administrator's
  routes read it.
- **Not changed:** `till-api.profile-zones.test.ts`'s `ROUTES` lists routes bounded by service zones;
  these two are bounded by none, so it gains no row.

### Task 12b's departures (2026-10-31)

- **Boot builds the host client and the correction just before the till's routes**, not after the
  email duty: `mountTillApi` runs before `startBoxEmailDuty`. The correction's `onCorrected` is
  therefore `(incident) => boxEmails.remember(incident)`, which is called only once a set has run.
  The cache anchor and the watch are still added to it where the watch starts.
- **The two-tills case uses one staff member on two tills** (the fixture's second till), not two
  people; challenges are keyed by session, so the case is the same.
- **The plan's control for it does not hold on its own.** Without the step counter, the second
  set is still refused `stale`, by the stale check's other half: the first set moved the wall clock
  and not the steady clock. Without the whole stale check, it is refused `not_stopped`: the first
  set's row confirms the stop, and the second set judges the stop again inside the turn. Without the
  turn, the stale check made after the host's status read refuses it. Run, each on its own: dropping
  either half of the stale check leaves the case green (the review's run); dropping the whole check
  changes the second till's refusal to `not_stopped` (the case fails on it); taking the set out of
  the turn alone leaves the case green; the turn and the whole check together give two host sets.
- **The cases wait for each request to reach the turn, never a fixed time** (review I2): the till
  test's box counts the route's calls to the correction's `inTurn` and `set`. Task 12a's
  `confirmWhileHeld` waits the same way now.
- **The order case's agreeing confirmation is refused `stale`**, writing no row, because a real set
  moved the clock after the till's reading: the case asserts the order `["step"]`. Taken out of the
  turn, it writes first: `["stop", "step"]`.
- **The boot case answers `clock.set_failed { reason: "refused" }`, not `"unverified"`.** A host that
  answers but leaves the clock where it was is `refused` (`!verified && !moved` in
  `clock-correction.ts`); `unverified` needs a clock that moved but not to the target, which a fake
  host cannot cause on a booted server's real clock. No row either way.
- **`boot.clock-watch.test.ts`'s stand-in for `startClockWatch` now passes the real watch's methods
  through.** It returned only `stop`, so once the correction held the watch as an anchor, a set found
  no `stepComing` and answered `pending_disproofs`.
- **Wiring controls, each failing the boot case:** no `boxClock` handed to `mountTillApi` (404), and a
  filing switch that is always on (409 at the challenge: AEAT not yet asked).

### Task 13's departures and per-task review, folded (2026-10-31)

- **`host_unavailable`'s words speak to the administrator reading them.** Decision 13's last
  sentence, "An administrator can still confirm the clock when it is right", becomes "Once the
  box's clock is within a minute of your device's, you can confirm it here", since the person who
  reads it is that administrator; "the part of its install" becomes "the part of the box", as
  Task 7's departure did for `clock.sync_off`.
- **Every set refusal has its own words**, `target_invalid` and `pending_disproofs` included
  (Task 12's departure added both), and `same_machine` and `not_stopped` say "use" and "set"
  rather than the confirmation's "confirm" (review M6). `pending_disproofs` names no earlier
  step, since the box also answers it when the watch cannot record this step's readings first
  (review M4). Each `clock.set_failed` reason has its own words: `unverified` says the box moved
  its clock, as the bell's `clock.corrected` will (review I1).
- **"Use this time" is not offered once AEAT's time is in hand during a clock-behind stop**
  (review I2): the box answers `witnessed` whenever the stop's `agreeing.authority` or
  `contrary.authority` is set (`apps/server/src/clock-correction.ts`, `judge`), and the read
  carries both. During the before-28-10-2024 stop the box judges AEAT from readings the read does
  not carry, so the offer stays and the refusal's words answer.
- **A refusal a second press could only meet again ends the question** — `not_stopped`,
  `witnessed`, `stale` and either `clock.set_failed` — leaving Close, and their words say "Close
  this and check again" where a fresh reading is what helps (review M5).
- **A set clock keeps the dialog open** with "The box's clock is set." and Close only. When the
  step is more than `IDLE_TIMEOUT_MS` either way, it adds "Sign in again to go on." The screen
  reads again at once: the background read and the live connection meet the ended session within
  about 15 seconds anyway (review I3), and the sign-in page then says the session has expired.
- **A challenge refused during a set** is worded as the check's own refusal (review M9), and a
  set reason the screen does not know by `clock.set_refused`'s sentence, which now points at the
  Clock row.
- **Not changed:** the 30-minute limit is judged on the step alone (review M2): the confirming
  administrator's request has just stamped the session's last use, so only the step can carry it
  past the limit; a backward step ends a session from Task 15 on, in this same pull request.

### Task 13a's departures (2026-10-31)

- **English quotes the button's three-word name as “Check the time”**, so a sentence such as "Use
  “Check the time” at the top of the screen" reads as one instruction; the till's English names a
  one-word button unquoted ("press Pay"). Spanish keeps «Comprobar la hora».
- **The dialog says "this device", not "this till"** ("This device says…", "Use this device's
  time"), in Spanish "este dispositivo", since the strip shows on handhelds too; the till's other
  strings say the same for the screen in hand (`device_zones.title`).
- **With the offer set and a clock stop as the FIRST of several notices**, the first line is no
  longer one toggle button: its words and "Check the time" sit in the line, and "+N" is a toggle of
  its own beside them, since a button never holds another. Without the offer, or with any other
  first notice, the strip is drawn exactly as before.
- **The administrators are listed by `GET /api/adjustment-approvers?roles=admin`**, the existing
  session-gated list of active people holding given roles (`apps/server/src/adjustments-api.ts:307`);
  `person.admin` is the admin role's alone (`packages/identity/src/permissions.ts:15-16`). No new
  route.
- **A refusal reason the till does not word** (`agrees`, a confirm's `differs`), and no answer at
  all, are worded "The box's time could not be checked. Check again to see where it stands." with
  Check again and Close: a confirm whose answer was lost may have set the clock, so the words claim
  nothing about what changed.
  `pending_disproofs` has its own words ("…Check again in a minute.").
- **`apps/till/src/i18n/codes.ts` gains plain sentences for the four codes**, used only where a
  refusal's reason cannot be read; the dialog words each reason itself.
- **`refusalText` had no test file**; its new cases are in `i18n/t.test.ts`, as this task said.
  `find-bill-dialog.ts`, `bill-refund-dialog.ts` and `tender-refund-dialog.ts` word clock refusals
  too, through `codeMessage`; this task does not name them and they keep «Tell a manager».
- **An administrator's PIN shows the question first.** The server refuses a staff member
  `not_start_up` at the challenge, before either time is shown, so "on a PIN sends the confirm
  again" would set the box's clock to this device's time unseen. After the PIN the dialog asks for a
  challenge carrying it and shows both times; the confirm goes only on the primary, and carries the
  PIN. The PIN is checked only there: a `pin.*` or `authorization.not_permitted` refusal is shown as
  the refusal, in the PIN pad's own words, with Close and «Administrator sign-in». The pad closes on
  the first answer and ignores a second; the dialog cannot be dismissed while a confirm is out.
- **A read naming the `box-clock` source unavailable keeps the previous offer**
  (`checkTimeOffered(read, previous)`), as `nextNotices` keeps that source's lines.
- **Three flag sites have no case of their own**: the pay dialogs' field messages (a clock refusal
  names no field) and the presented sheet's locked-view `.error` (the app always hands that sheet
  worded text through `#counterRefusal`). Every other site is proved by deletion
  (`~/waitron-campaign-b/a798-9b/t13a/mutate-fold.py`).
- **The till app's wiring was written before `till-app.box-time.test.ts`**; each of its three
  cases is proved by deletion instead (removing the flag, the dialog's opening, or the read after
  a success each fails a named case), with the plan's five controls and four more.

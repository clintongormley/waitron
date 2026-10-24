# A798-B slice 9c — a clock check at every start and after every change, with selling stopped while it waits (OUTLINE)

> **An outline, not a plan to dispatch** (round 1, I9). When slice 9c is taken, this file becomes a
> full plan — tasks sized for one implementer each, exact files and focused commands, its "Changed
> test checks" — and gets its own fresh-context plan review against the spec before its first
> dispatch. Design: revision 7, §4.9 a, b, f, h. **Depends on slices 9 and 9b being on `main`**:
> this slice adds stops, and lands only once the box can confirm and correct its clock. Its own
> branch: `python3 ~/workspace/tools/worktree.py new waitron feat/a798-9c-clock-check --headless`.
> **Parked for the owner** (it stops every record while a check waits). Review path: FULL, two
> Codex run-it reviews side by side.

**Goal.** The box checks its clock at every start and whenever its clock changes by more than a
minute in either direction; while a check waits, everything slice 8's stop refuses is refused, staff
see the red strip, managers the bell and (after five minutes) an email; AEAT's time, two agreeing
tills or handhelds, or an administrator's own device confirm it (and, by slice 9b, correct the
clock); a confirmation lists the records the wrong clock may have dated. **No check may stop selling
where nothing on the venue's network could lift it** (design §4.9 h).

## Owner FYI defaults for 9c

1. **A clock change of up to a minute in total since the last confirmation is not a check**; more
   than a minute, either way, is. A time service's small steps would otherwise stop the venue.
2. **The start opens its check before the server serves, and tries AEAT once (five seconds at most)
   before serving**, so a box with internet sells at once.
3. **The managers' email goes out when a check has waited five minutes.**
4. **Only the Veri\*Factu module stops** (design decision 16 stands).
5. **Where the box cannot correct its clock, a check is an alert, not a stop**: when the host service
   does not answer (a box upgraded without re-running the install, a host without systemd), a start
   or change check raises `clock.sync_off` (`unreachable`) telling the operator to re-run the
   install, and selling goes on (round 1, I4.2).
6. **When AEAT disagrees and the box cannot set its clock** (synchronised, or no host service), an
   administrator's confirmation still closes a 9c check; AEAT's disagreement is kept in the proof
   and raises `clock.disagrees` (round 1, I4.1).
7. **Development** (`WAITRON_ENV=dev`, round 1, I7): no start or change checks at all. That covers
   a developer's laptop and the `wa-wt demo` and `wa-wt onboarding` stacks, which run `pnpm dev`
   with `WAITRON_ENV` `"dev"` in the checkout's `apps/server/.env` (`apps/server/scripts/dev-setup.ts:145`,
   `dev-onboard.ts:79`; `isDevMode` is `env.WAITRON_ENV === "dev"`, `config.ts:356-357`; round 3,
   M3). `/proc/uptime` is missing on macOS, where `elapsedClock` falls back to `performance.now()`,
   which stops during sleep, so the change guard is off wherever that fallback is in use — on every
   system, not only in development. A box written `preproduction` — a Prepare box, or a demo box
   installed with `waitron.sh` — checks like a live one.
8. **An AEAT disagreement during normal trading opens a check** (reason `disagrees`, declared in
   slice 9's migration, round 1 M6), stopping selling until the box sets its clock to AEAT's time
   (9b) — or, where it cannot, an alert only (FYI 5, 6). The full plan's review may overturn it.
9. **A future cloud or proxied primary**, where every request looks like the box's own: today a
   venue has one node and there is no cloud primary (CLAUDE.md §5); such a node gets its own rule
   before it exists. A backlog entry.

## What it rests on

- **The check's state is in the database** (`clock_checks`, slice 9's migration): `attemptAppend`
  calls `refuseWhileClockBehind(tx, reading)` from `clock-behind.ts` (`chain.ts:136-137`), which this
  slice extends; no edit to `chain.ts`. At most one check is open (slice 9, Words). Since slice 9's
  revision 7 a `behind_chain` check can wait open indefinitely once its stop has ended (no internet,
  fewer than two devices, no administrator), and opening a `start` or `change` check answers the
  open one, which stops nothing — so the start check would be skipped exactly at a venue with no
  internet (round 5, I4). Default: opening a `start` or `change` check first closes a waiting
  `behind_chain` check `elapsed` (cannot tell, its `clock.records_misdated` task recorded) in the
  same transaction; the full plan keeps this or decides otherwise, and tests it.
- **A change of the clock** is read against `CLOCK_BOOTTIME` through `/proc/uptime`, as slice 9's
  watch does. As built the watch counts only forward jumps (slice 9 plan, T3); this slice builds a
  separate guard for both directions and leaves the watch's forward-jump disproof alone. **9b's M3
  must have printed its expected line first.**
- **Tests that boot a whole server**: on 2026-10-24, 73 files under `apps/server/src` name
  `startServer` (every one; `bootServer` is internal, `boot.ts:842`), 24 of them `serverFixture`;
  7 name `recordSale`, `/api/sales` or `/api/pay`, and more may sell through the `testing/` helpers
  (claim check W3; the earlier "35" counted any case-insensitive mention of Veri\*Factu). The full
  plan measures which fail, and handles them with a start seam, never by weakening the check.

## Decisions the full plan builds from

1. **What opens a check** (seat `openClockCheck`, slice 9): `start` in `startServer`'s trading mode,
   on the primary, before `serve()`; `change` from the clock guard; `disagrees` (FYI 8); a promotion
   that makes this node the seller opens a `start` check (no new reason value: slice 9's CHECK
   allows `start`, `change`, `behind_chain` and `disagrees`; round 3, M6) — the full plan finds
   whether the server restarts after one, which would make it the ordinary start.
2. **One refusal code, with a reason** (round 1, C2; the runner's ruling): while a `start`, `change`
   or `disagrees` check is open, `refuseWhileClockBehind` throws **`clock.behind_chain`** with
   `reason: "unconfirmed"` and `since`, `checkReason`, `stepMs` — not a new code — so every place that
   matches the code by name keeps working. Each is named and tested in the full plan, from
   `/usr/bin/grep -rn '"clock.behind_chain"' apps packages` (round 1, experiment 4; its `.` also
   matches `_`) — seven places in two till files, five that match the code and two the
   charged-but-not-recorded reason `"clock_behind_chain"` (`till-app.ts:1547`, `pay-refusal.ts:88`;
   round 4, M9), and four in the dashboard's rows:
   `apps/server/src/bill-payments.ts:1262-1266` (`notRecordedReason`: a refusal after a card was
   charged becomes `sale.charged_not_recorded`), the status maps `apps/server/src/payments-api.ts:179`
   and `apps/server/src/till-api.ts:455`, `apps/till/src/till-app.ts:574`, `:847`, `:922`, `:1547`,
   `:1554` (whose `case` also returns the code at `:1556`), `apps/till/src/widgets/pay-refusal.ts:82`,
   `:88`,
   `apps/dashboard/src/screens/box-status-rows.ts:50`, `:59`, `:150`, `:262`, and the words files
   (the till's refusal and strip, the bell, the email: each words the new reason). **The mid-payment
   test:** a check opens (an injected guard tick) between a payment route's pre-check and the record
   append after a card is charged → `sale.charged_not_recorded` with the reason, the card not charged
   again. The readers that go through `clockBehindChain` rather than `refuseWhileClockBehind` (the
   staff notice, the bell's source, `clockStopState`) are changed too; "every reader goes through one
   function" was false and is not repeated.
3. **The clock guard** (`apps/server/src/clock-guard.ts`): an anchor `{ wall, boot }` set at the
   start, after each confirmation and before and after each set the box makes (9b's order, round 1
   M7); every second, `(wall − anchor.wall) − (boot − anchor.boot)` past ±60 000 ms opens a `change`
   check (`detail { stepMs, wallBefore, wallAfter, heads, lastRecordId, bootMs, bootId }`, as slice
   9's R6 and R7 shape it) and re-anchors. A failed write is retried with a back-off, not every
   second (round 1, M5). Off where `elapsedClock` fell back to `performance.now()` (FYI 7).
4. **The start's first try** (FYI 2), and **a full disk at start** (round 1, M5): if the check cannot
   be written, the start still serves, every sale is refused (the full-disk stop already does), and
   nothing loops; compare `fullDiskFailure` and `start-full-disk.e2e.test.ts`.
5. **What closes a check**: slice 9's confirmations with "the stop" widened to "a stop or an open
   check"; a witness counts only if noted after the check opened (the witness store is cleared when
   one opens).
6. **Wrongly dated after a change** (round 1, I8, the runner's ruling): with e₀ the clock's error
   before the change, Δ the change and s the step the confirmation applies, e₀ = −(Δ + s) and the
   clock after the change was off by −s. List the records written since the previous confirmation
   and before the change when |Δ + s| > 60 s, and the records written between the change and the
   check's `heads` when |s| > 60 s — beside slice 9's rule for the stop's start. Tests: a forward
   change endorsed; a forward change undone; a backward wrong change; a partial correction; records
   written in the gap between the change and the check opening.
7. **What staff and managers see**: the strip "No se puede cobrar: comprobando la hora del equipo ·
   Avisa al encargado" / "Payments stopped: checking the box's clock · Tell a manager"; the bell's
   error naming why (just started; changed by n minutes; the tax agency disagrees) and the three ways
   out; the Clock row "Checking the clock since …"; the email at five minutes.
8. **Demo and seed scripts that record sales** (`apps/server/scripts/demo-seed/seed-sales.ts`,
   `record-one-sale.ts`, `daily-close*-demo.ts`, round 1 I7) are callers of the record append: on a
   box with an open check they are refused like a till. On a laptop (FYI 7) no check opens. Each is
   named in the full plan with a test of one of them against an open check.

## Open for the full plan

- **A time service synchronised to a wrong local time server, with no internet** (round 3, M7;
  design §4.9 h case 5): devices and the administrator disagree, and 9b never sets the clock while
  it reports itself synchronised. The full plan decides it — for example, a check is an alert only
  while the time service reports synchronised and AEAT is unreachable — before any check can stop
  selling there.

## Review notes for the full plan

Codex seat 1: boot with no AEAT and no devices → stopped; an administrator off the box confirms →
selling; the clock moved +2 h by hand → stopped again with `reason: "unconfirmed"`; the mid-payment
case through a real route. Seat 2: a check that can never be closed (host service gone, AEAT
disagreeing, the time service synchronised) — expected: never a stop with no way out.

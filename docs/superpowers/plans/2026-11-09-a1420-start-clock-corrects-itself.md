# A1420: every start confirms the box's time before it trades — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`. Keep the ledger `docs/handoffs/2026-11-09-a1420-start-clock.md` current at the end of every task.

**Revision 3, corrected (2026-11-09).** Re-planned to the owner's answer of 2026-11-09 22:01 (verbatim in `waitron-campaign-b/questions.md`, "A1420 revision 2: OWNER's answer"). At every start of a box that files records, before it trades: (1) with the internet, a synchronised time service (NTP) is used, and AEAT disagreeing raises a dashboard alert, not emailed; not synchronised but AEAT answers, the clock is set to AEAT's time, with no one-minute margin. (2) With no internet, a till or handheld confirms the time. (3) Failing that, an administrator confirms the date, which never names a new series. (4) No block for being behind the latest invoice. A restore follows the same order. Revision 2's Q2 (how long a till may set the clock) is replaced by this design.

Corrected after the watcher's read of 23:19 (`waitron-campaign-b/receipts/a1420-rev3-watcher-plan-verdict-20261109-2319.txt`): a fourth owner question on the misdated-sales list; the "never on the sale path" sentences quoted; Q2 restated against the research's "exact time" condition and its three-record test; the gate moved onto the seat's record writers (R6, run); PR 1 split; PR 5 reduced to the behaviour change; the test plan and suite lists; revision 2's restore PRs written out here; the host's 20-second limit.

Corrected again after the fresh review of 2eee06cc52 (2026-11-10; its report: `waitron-campaign-b/receipts/a1420-rev3-fresh-review-2eee06cc52-20261109-2356.txt`): PR 5 no longer edits `chain.ts` (R8, run: two functions answering "nothing" switch off the stop everywhere, including the staff notice and bell alert that bypass the seat); Task 17 lists the suites that measurably fail; Task 18a names every caller of the seat methods 18b deletes; Q4 keeps the case of records the box dated ahead of internet time; Q2 names its condition (b) as a block for being behind the last invoice; a fifth question on orders while payments wait; the heading and the `conventions-data.md` copies of the changed sentences; the base commit. (Task numbers as they were then; Task 17 is now 17a-17c and 18b is now 18c.)

Corrected a third time after the watcher's note of 2026-11-10 01:14 (`waitron-campaign-b/questions.md`, "A1420 revision 3 corrected: six changes", citing `waitron-campaign-shared/codex-review/reports/plan-b-20261110-0106.md`): an administrator's "Check with this device's time" now works while payments wait, through both of its routes (R9, Task 7); PR 5 rewrites the staff guides that describe the stop (Task 17c) and PR 6's grep reads the guides; Q2 and the limits say plainly that no tax adviser has answered, that AEAT's test covers only three minutes on preproduction, and that a clock falling back during trading is no longer stopped; C5 keeps the card-refund re-check; Tasks 17 and 18a are split, the four remedy cases are deleted rather than rewritten, and PR 1b's gate was run against every server suite that starts a server (R10); PRs 5 and 6 land together.

**What a person can do when this lands.**

- **PR 1a.** A box that comes up with its clock wrong puts it right as it starts whenever it can reach the internet: it keeps its time service's time, or sets its clock to the tax agency's (AEAT's). Administrators get a bell alert when the time service and AEAT disagree.
- **PR 1b.** With no internet at the start, the box takes no payment and writes no fiscal record until a person confirms its time: staff signed in on any till or handheld see "The server's time is not confirmed yet" and "Check the time"; an administrator can confirm the date on Box status, or use "Check with this device's time" there, which confirms or sets the clock from their own phone or computer. Orders still reach the kitchen. The internet coming back confirms it by itself.
- **PR 2** (if Q4 is yes). When the internet later moves a clock a person confirmed by more than a minute, the bell names the sales recorded meanwhile, with the list on Box status; and records the box had stamped ahead of internet time are listed the same way.
- **PR 3.** A restore whose box clock is out and not kept by a time service sets it from AEAT and finishes, instead of failing.
- **PR 4.** A restore that cannot reach AEAT waits and retries every minute without bringing up the start-failure page; when that page does show for a clock reason, it says which.
- **PR 5** (needs the owner's yes, Q2). A sale is never refused because the clock reads earlier than the last sale.
- **PR 6.** The old "clock behind the last sale" stop's code is gone from the server, tills, dashboard and fiscal module.

**Base:** `1252e2b6b3`, this branch's merge base with main. Line numbers are on that commit; on later main some sit a few lines higher (`nodeBackend` is `boot.ts:2074` here, `:2071` on `049ddd9db9`, `:2070` on `9e497a0a7f`), so match by name.

**Review weight: FULL, every PR.** Risk triggers: the clock in front of fiscal records and series naming (a fiscal invariant), a cross-package contract (`ModuleOperationHost`, PR 3), and what the chain's append refuses (PR 5). The plan gets a fresh-context review before any implementer is dispatched; each PR's `/finish-branch` runs the Codex run-it seat twice (the second sets this checklist aside). Every PR **waits for the owner** to land it.

## Words used in this plan

- **AEAT's time**: the `Date` header of a reply from AEAT's servers over a checked HTTPS connection. The running server reads it with `readAuthorityTime` (`packages/fiscal-verifactu/src/authority-time.ts`, 5-second limit). The header is whole seconds, so a reading carries an uncertainty of 500 ms plus half the round trip (`authority-time.ts:88-92`). "Exactly" below means within that uncertainty: about a second.
- **Time service / synchronised**: the host's own internet time keeper (systemd-timesyncd or chrony) and the `NTPSynchronized` flag the host service reads with `timedatectl show` (`deploy/box/waitron-box.sh:59-62,93`).
- **Host service**: the small root program outside Waitron's container that can set the clock (`deploy/box/waitron-box.sh`), asked through `apps/server/src/box-host-client.ts`, which waits up to 20 s for a set (`DEFAULT_SET_MS`, `:45`). It refuses to set while synchronised (`waitron-box.sh:118-121`).
- **The seat**: the fiscal module's one `FiscalBackend` object, built once in boot (`nodeBackend`, `apps/server/src/boot.ts:2074`) and handed to every route and loop. Every fiscal record is written by one of its four writers, `recordSale`, `recordVoid`, `recordCorrection`, `recordSubstitution` (`packages/fiscal-verifactu/src/backend.ts:305,431,504,609`); the only other callers of the chain's append are the record remedies, which production switches off (R7).
- **The start check** (new): each start's decision on whether its time is confirmed. Its state is **waiting** (nothing has confirmed it), **by a person** (a till or administrator confirmed it; trading, and still listening for the internet once) or **by the internet** (done).
- **The stop** (today; its behaviour ends in PR 5, its code in PR 6): while the clock reads more than a minute before the latest fiscal record, no record is written and no money moves (`refuseWhileClockBehind`, `packages/fiscal-verifactu/src/clock-behind.ts:167-175`).
- **The series check**: naming a new invoice series at setup, restore or promotion needs a second clock within 30 seconds of the box's (`compareHourClocks`, `packages/fiscal-verifactu/src/hour-clock.ts:63`, `AGREEMENT_MS` at `:39`).

## Global constraints

- **No table, column, index, trigger, migration or schema-file change** (A1308 hold). `clock_confirmations` already accepts reason `start` with sources `authority`, `staff` and `admin` (`packages/fiscal-verifactu/src/schema/clock-confirmations.ts:7-20`). The stop's tables stay, unwritten, after PR 6. If a step seems to need a schema change, stop and report.
- **The fiscal core is untouched in every PR**: `computeHuella`, the chain (`chain.ts`), numbering, `registros_facturacion` and its triggers, the alta builders, `allocation.ts`, `hour-selection.ts`. **PR 5 changes what the chain's append refuses without editing it**: `attemptAppend` (`chain.ts:158`) asks `refuseWhileClockBehind`, which asks `clockBehindChain`, and PR 5 makes that function and `clockStopState` answer null (R8). PR 5 is not started without the owner's yes to Q2 and AEAT's answer to the test Q2 names. After every task touching `packages/fiscal-verifactu`, this passes **unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts inmutabilidad`.
- **No new clock source.** Every set goes through the host service, from AEAT, a staff member's till, or an administrator's own device, and never while synchronised. An administrator's date confirmation sets nothing. A device alone never confirms: a staff member taps (Q3).
- **The series check is untouched except for Q1.** No till or administrator confirmation is ever read by it (R5).
- **A test that has to be edited to pass is a STOP** unless "Changed test checks" lists it.
- **User-visible words** are only those in "Words"; English and Spanish change together.
- **Real events only** (owner, 2026-11-08). Each branch names the venue event that reaches it.
- **Tests.** Each property has one owner layer. AEAT's and the host's own failure modes are already tested where they are read (`authority-time.test.ts`, `hour-clock-internet.test.ts`, `box-host-client.test.ts`); a start is tested only for what it does with each answer. A "did NOT happen" assertion runs to a stated end point and has a control in which the same fake forces the effect. Reuse `ephemeralServerFixture`, `setupVenue`, `insertFiscalRegistro`, `deviceCookieForTest`, `provisionBillVenue`, and the fake host in `boot.clock-watch.test.ts:166-182`.
- Tests run with `AI_AGENT` and `CLAUDECODE` unset when output matters; server tests with `TESTCONTAINERS_RYUK_DISABLED=true`. Read the `Tests` count. Browser runs (`apps/dashboard`, `apps/till`, `apps/setup`): `memory_pressure | grep free` first.
- Every commit `git commit -s`, plain English. Every task ends with `pnpm format:check` and `pnpm exec eslint <changed files>`.
- **Implementer size.** Each task is sized for one implementer in well under 100 tool calls. One that passes about 150 calls stops at a passing (or cleanly failing) point, commits, and hands over.

## What is true today (receipts)

### R1. An ordinary start does not look at the clock; only a clock behind the latest record is caught (RUN, revision 2)

Revision 2's probe: a real `startServer` on a real venue database (`useVenueDb` + `setupVenue`, `WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`), the global `Date` swapped for one reading the real clock plus an offset, AEAT's `authenticatedHourHead` mocked, a fake host whose `setClock` moves the swapped clock, one fiscal record an hour before the true time. What it printed, in short:

- **Clock 2 days ahead:** `start=ok … setsAtStart=0 aeatAsksAtStart=0`, `saleCheckAfter75s=allowed`, `aeatAsks=0`: sales dated two days ahead, nothing checks.
- **Clock 2 days behind, AEAT answers:** sales refused at first (`refused clock.behind_chain`); after about 30 s the watch set the clock from AEAT (`clock_correction.stepped`, `confirmations=["authority"]`) and sales resumed.
- **Same, AEAT unreachable:** sales stay refused; AEAT asked once a minute.
- **Flat battery, 10 minutes slow, last sale 10 min 5 s earlier:** `saleCheck=allowed`, nothing asked: sales dated 10 minutes early.
- **Every set needs a stop today** (`clock-correction.ts:221-229`; `clock-set.route.test.ts -t "refuses a set with no stop"` → `Tests 1 passed`).

Why a flat battery comes up slow (systemd(1), "System clock epoch", read, not run): the clock starts near the last save of `/var/lib/systemd/timesync/clock`, so it is slow by about the length of the cut.

### R2. The restore's start (run in revisions 1-2, still true)

- Only a start that places a staged restore names a series. `runEntry` runs `runStagedRestore` before `startServer` (`apps/server/src/node-entry.ts`). The module's `resume` compares clocks as a box with no browser (`packages/fiscal-verifactu/src/hosted-hour-recovery.ts:146-149`) and refuses `sif.allocation_invalid` with `reason` `second_clock_missing` (AEAT unreachable) or `clock_disagreement` (more than 30 s out). Revision 1's probe printed `internet offset=29000 canSelect=true`, `offset=31000 … clock_disagreement` and `offset=null … second_clock_missing`.
- Each start writes one failure into `recovery.json` before its first step; three in a row bring up the start-failure page (`RECOVERY_AT`, `apps/server/src/recovery-state.ts`). `withoutAttempt` takes one back (used today for a start refused because a live process holds the venue folder). The process then exits and Docker starts it again (`restart: unless-stopped`, `deploy/compose.yml`).
- AEAT's failure reasons at the restore's start are `network`, `timeout`, `tls`, `response`, `configuration` and `clock-corrected` (`hour-clock-internet.ts:74-153`). Only `network` and `timeout` mean "not reachable yet".
- The restore page checks the clock when the person presses Make the series; the start that places it follows after the container restarts. So a disagreement at placement needs a machine restart or a time-service step in between: real but rare. AEAT unreachable at that moment (a router still coming back) is the common failure (read, not run).

### R3. Point 2 is feasible: the server serves tills while it is not trading (RUN, 2026-11-09)

**Harness.** A throwaway file, `apps/server/src/probe-a1420-till-at-start.test.ts` (moved out of the tree after the run; `git status --short` then printed nothing). R1's harness, with: AEAT unreachable (the mock throws `ENETUNREACH`); the host not synchronised; one enrolled till (`seedDevice` + `deviceCookieForTest`) and one staff member with a PIN; everything the till does goes over HTTP to the real listener, as the till app does: `GET /api/device/equipment` (its notices) with only the device cookie, `POST /api/session` (PIN sign-in), then `POST /api/box-clock/challenge` and `/confirm` ("Check the time") with the till's true time. The sale check is `refuseWhileClockBehind` at the box's reading, as in R1. Each scenario waits 20 s after start, past the clock watch's first look at 15 s (`CLOCK_WATCH_MS`).

**Stated before running.** If the server did not serve tills at that stage, BEHIND prints a non-200 equipment read or sign-in, or no `clock.check_time` notice. The control must print no notice and a refused challenge, or the probe cannot tell the cases apart.

Command: `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/probe-a1420-till-at-start.test.ts` → `Tests 4 passed (4)`.

```
CONTROL boxMinusTrue=0s
CONTROL start=ok in 211ms aeatAsksAtStart=0
CONTROL till(no one signed in) at once: equipment 200 notices=[]
CONTROL PIN sign-in: 200
CONTROL saleCheckAtStart=allowed
CONTROL after20s aeatAsks=0
CONTROL till(signed in) after20s: equipment 200 notices=[]
CONTROL Check the time -> challenge: 409 {"error":{"code":"clock.set_refused","params":{"reason":"not_stopped"}}}
CONTROL sets=0 requester=null boxMinusTrue=0s confirmations=[]
BEHIND boxMinusTrue=-172800s
BEHIND start=ok in 245ms aeatAsksAtStart=0
BEHIND till(no one signed in) at once: equipment 200 notices=["clock.behind_chain"]
BEHIND PIN sign-in: 200
BEHIND saleCheckAtStart=refused clock.behind_chain
BEHIND after20s aeatAsks=1
BEHIND till(signed in) after20s: equipment 200 notices=["clock.check_time","clock.behind_chain"]
BEHIND Check the time -> challenge: 200 {"challengeId":"6946c2ec-…","boxAt":"2026-11-07T21:55:29.908Z"}
BEHIND Check the time -> confirm: 200 {"confirmationId":"6c9274d6-…","stepMs":172799998.930542,"confirmedAt":"2026-11-09T21:55:29.914Z"}
BEHIND sets=1 requester={"source":"staff","person":"7f59418c-…","device":"6a37f17f-…"} boxMinusTrue=0s confirmations=[{"source":"staff","reason":"behind_chain"}]
BEHIND saleCheckAfter=allowed
BEHIND till after: equipment 200 notices=[]
AHEAD  … start=ok, equipment 200 notices=[] (at once and after 20 s), PIN sign-in 200, aeatAsks=0,
AHEAD  challenge: 409 … "not_stopped", sets=0, boxMinusTrue=172800s, saleCheckAfter=allowed
SLOW10 … the same as AHEAD, boxMinusTrue=-600s
```

**What it means.**

- **Yes, it is feasible, and most of it exists.** While today's stop holds, the server is fully up: an enrolled till reads its notices with nobody signed in, staff sign in by PIN, and after AEAT's first failed ask (about 15 s) "Check the time" is offered; one confirm set the box's clock from the till's time through the host and sales resumed. Sending an order to the kitchen is not among the stop's checks (read, not run: the list in `conventions-data.md`, "Where a route's named check goes", names only payment, refund and invoice routes).
- **What the person sees.** The till shows notices only on its signed-in screens and clears them at sign-out (`apps/till/src/till-app.ts:18666-18669`), so the PIN screen shows nothing; after sign-in the line reads "Payments stopped: the server's clock reads earlier than its last sale" with "Check the time" (`apps/till/src/i18n/strings.ts:1897-1906`). The dialog shows both clocks ("The server's clock says {box}. This device says {till}.") and offers "Use this time" or "The time is right" (`strings.ts:1909-1918`). PR 1b gives the line new words for the waiting state and reuses the dialog unchanged.
- **The gap.** A clock 2 days ahead or 10 minutes slow triggers none of it: no notice, the challenge is refused `not_stopped`, sales are taken. Point 2 needs the start check's "waiting" state, not the comparison with the last sale, to open this path. That is PR 1b.
- **A till or handheld already paired** is what connects. A new one cannot pair without an administrator: each start opens the pairing window shut (`apps/server/src/boot.ts`, "a restart or a promotion starts SHUT"). Read, not run.
- **At a restore's placement no till can help**: the server that serves tills starts only after placement (R2), and a till's confirmation never satisfies the series check (R5).

### R4. Why a box can be online, reach AEAT, and still not be synchronised (read, not run)

- **Waitron installs no time service.** `waitron.sh install` only runs `timedatectl set-ntp true` (`deploy/waitron.sh:325-328`); if that fails, or no time service is installed, it prints a line and carries on. The dashboard already raises `clock.sync_off` with `off`, `stopped` or `unsynchronised` (`apps/server/src/clock-sync-alert.ts`).
- **Every boot starts unsynchronised.** The flag turns "yes" only after the time service's first successful exchange. The app's container starts as soon as Docker does, so the start's first look can come first. After a power cut the venue's router usually comes back after the box, so for the first minute or more neither the time service nor AEAT can answer. This is the common case, and it is why the start check keeps listening and confirms by itself. Task 19 measures it on the test box.
- **The venue's network blocks the time protocol.** NTP uses UDP port 123 (timedatectl(1)'s own example: "Using Time Server 216.239.38.15:123"); AEAT is HTTPS on TCP 443. A shared, guest, hotel or shopping-centre network that lets only web traffic out gives exactly "AEAT answers, never synchronised". Task 19 blocks UDP 123 on the test box to show what the start does.
- **The reverse also happens.** A clock years out cannot complete AEAT's checked HTTPS connection (its certificate looks not yet valid or expired), so AEAT reads as unreachable while NTP still works; the time service then puts the clock right.

### R5. Who uses the stop today, and what each does after this plan (read; two claims checked)

A read-only trace of every consumer, 2026-11-09. Checked by me: `hour-clock.ts`, `hour-selection.ts`, `hour-setup-clock.ts` and `hosted-hour-recovery.ts` contain no reference to confirmations (`grep -n 'clock-confirmation\|clockConfirm'` printed nothing, exit 1), so **no till or administrator confirmation can ever let a series be named**; the series check's second clock is AEAT or, during setup, the setup page's own browser (`hour-setup-clock.ts:103-124`). And `SAME_CODE_REFUSAL_LIMIT = 3` (`fiscal-verifactu/src/drain.ts:64`).

**The stop cannot be switched off at one point.** `clockStopState`'s judge compares the clock with the latest record itself (`packages/fiscal-verifactu/src/clock-confirmation.ts:63-67`) and then asks `clockBehindChain` whether a confirmation covers it (`:75`). Making only `clockBehindChain` answer "not behind" would read every behind clock as confirmed, then fail on a missing confirmation row (`:102`). So PR 5 makes both `clockBehindChain` (`clock-behind.ts:147`) and `clockStopState` (`clock-confirmation.ts:107`) answer null. That reaches every reader, including two that bypass the seat: the staff notice (`staff-notices.ts:27`) and the bell alert (`clock-behind-alerts.ts:25`) call `clockBehindChain` directly (R8). PR 6 then deletes the callers and the code.

| Consumer | Where | Today | After PR 1b | After PR 5 | After PR 6 |
| --- | --- | --- | --- | --- | --- |
| The chain's append | `fiscal-verifactu/src/chain.ts:158` | refuses a record more than a minute before the latest | unchanged | refuses only a time before 28-10-2024 (`refuseBeforeFirstIssueDate`, `first-issue-date.ts:15-24`); `chain.ts` unchanged (R8) | same |
| The seat's four writers | `backend.ts:305,431,504,609` | write through the append | refuse `clock.unconfirmed` while waiting (wrapper in boot) | same | same |
| Route checks: till sales, bill payments and refunds, tender refunds and retry, unpaid departure, eight dashboard resolutions | `till-sale.ts:720,1180,2246`; `bill-payments.ts:1141`; `bill-refunds.ts:216,685,698`; `tender-refunds.ts:93,98`; `tender-refund-api.ts:262`; `unpaid-departure.ts:102`; `payments-api.ts:368-369` | call the seat's `refuseWhileClockBehind` | refuse `clock.unconfirmed` first while waiting (wrapper in boot) | waiting or before 28-10-2024 only | same, renamed `refuseUntilRecordable` |
| Refund recovery loops; a card refund's re-check after a provider wait | `tender-refund-recovery.ts:36`; `bill-payments-loop.ts:244`; `clockStopsRefund`, `bill-refunds.ts:209-220` | pause during the stop | also pause while waiting | pause only while waiting | same |
| Clock watch | `apps/server/src/clock-watch.ts` | opens checks, sets from AEAT, confirms, all inside a stop | also runs the start check while not confirmed by the internet (PR 1a) | its stop part sees no stop | stop part deleted |
| Correction's admission | `clock-correction.ts:143-169,221-229` | sets only inside a stop | also admits reason `start` while not confirmed by the internet (PR 1a) | same | only reason `start`, or `clock.unusable` |
| "Check the time" (staff) and the start-up window | `till-box-clock-api.ts:158-370`; `clock-start-up.ts` | offered during a stop found at start-up, after AEAT failed | also while waiting | only while waiting, or `clock.unusable` | stop branches deleted |
| Administrator's confirm and set ("Check with this device's time") | `box-health-api.ts:258-371`; the dashboard's offer, `box-status-screen.ts:452-459,1217-1231` | inside a stop only: without one, confirm refuses `not_stopped` (`:307`) and set, sent as reason `behind_chain` (`:343`), is refused `not_stopped` by the correction (`clock-correction.ts:226`) (R9) | also while waiting: confirm writes a `start`/`admin` row, set is sent as reason `start`; either moves the start check to by a person (Task 7); the dashboard offers the button while waiting (Task 8) | same | stop branches deleted; both admitted only while the start is not confirmed by the internet, or under `clock.unusable` |
| Clock checks, confirmations covering a step back, disproofs | `clock-checks.ts`, `clock-confirmation.ts`, `clock-stop-incidents.ts` | exist only for the stop | unchanged | never reached | deleted; tables stay, unwritten |
| The misdated-sales list, its download and `clock.records_misdated` | `clock-misdated.ts`, `box-health-api.ts:149-200` | listed after a stop's closing | unchanged | not reached by the stop | Q4 yes: kept, fed by PR 2. Q4 no: deleted |
| Alerts, emails and till/dashboard words for `clock.behind_chain`, `_restarted`, `_disproved` | `clock-behind-alerts.ts`, `box-alert-email.ts`, `staff-notices.ts`, till `pay-refusal.ts`, dashboard `box-status-rows.ts`, `alert-messages.ts` | shown and emailed | unchanged | never raised | deleted |
| `fiscal.clock_drift` hidden during the stop | `boot.ts:3106-3112`, `time-health.ts:91-112` | hidden while stopped | unchanged | never hidden | hidden while waiting instead |
| Survives untouched | `clock.unusable`, `clock.corrected`, `latestClockStep` (backup hold, `backup-sweep.ts:205`), witnesses and `clock.disagrees`, `clock.sync_off`, challenges | | | | |

### R6. The gate must sit on both the route check and the seat's writers (RUN, 2026-11-09)

**Harness.** A throwaway file, `apps/server/src/probe-a1420-seat-gate.test.ts` (moved out of the tree after the run). `provisionBillVenue`'s venue (its app uses one seat object, as boot's does), with the seat's `refuseWhileClockBehind` and its four writers wrapped in place, as PR 1b's boot wrapper would; each wrapper logs its call and, when its flag is on, throws a stand-in refusal (`clock.unusable`). Then a cash sale (`POST /api/sales`) and a card sale (`POST /api/pay`) under each arrangement.

**Stated before running.** If gating only the writers were enough, the card sale under "WRITERS-ONLY" prints `cardCollects+0`; the A798 measurement (`conventions-data.md`, "Why the routes need their own check") predicts `+1`. The control must print `records+1` for each sale.

Command: `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/probe-a1420-seat-gate.test.ts` → `Tests 1 passed (1)`.

```
CONTROL(no gate) cash: status=200 seatCalls=["refuseWhileClockBehind","recordSale"] records+1 sales+1 cardCollects+0
CONTROL(no gate) card: status=200 seatCalls=["refuseWhileClockBehind","recordSale"] records+1 sales+1 cardCollects+1
WRITERS-ONLY gate cash: status=409 seatCalls=["refuseWhileClockBehind","recordSale"] records+0 sales+0 cardCollects+0
WRITERS-ONLY gate card: status=507 seatCalls=["refuseWhileClockBehind","recordSale"] records+0 sales+0 cardCollects+1
ROUTE+WRITERS gate cash: status=409 seatCalls=["refuseWhileClockBehind"] records+0 sales+0 cardCollects+0
ROUTE+WRITERS gate card: status=409 seatCalls=["refuseWhileClockBehind"] records+0 sales+0 cardCollects+0
```

**What it means.** Wrapping the seat's writers holds every record, including paths with no route check (`cancel-credit.ts:68` writes a correction through `recordCorrection`), and the sale's whole transaction rolls back. But alone it charges the card first and answers `507`. The route check stops money before the reader. Both wrappers go in PR 1b, at one place in boot.

### R7. The record remedies cannot write in production (RUN, 2026-11-09)

The administrator remedies (`packages/fiscal-verifactu/src/record-remedy.ts:194`, `record-remedy-absent.ts:130`) call `appendToChain` directly, past the seat's writers. Production mounts them with the default set of enabled remedies, which is empty (`record-remedy-routes.ts:20,46`, mounted at `routes.ts:26`), so every remedy is refused `fiscal.remedy_disabled` before it writes.

- Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/record-remedy-corrective-http.test.ts -t "keeps the default production policy closed"` → `Tests 1 passed`.
- Control: with the default set changed to `new Set(["corrective-invoice"])` and the same command → `AssertionError: expected 200 to be 409`, `Tests 1 failed`: the remedy wrote. The file was restored (`git checkout --`; `git status --short` printed nothing).

So no remedy is gated in this plan (real events only), and revision 3's `clock.unconfirmed` entry in `record-remedy-routes.ts`'s status map is dropped: nothing there can throw it. The A1407 backlog entry, which is what will switch a remedy on, gains one clause: an enabled remedy takes the start gate first.

### R8. Two functions answering "nothing" end the stop everywhere, with `chain.ts` unchanged (RUN, 2026-11-10)

**Harness.** A throwaway worktree (`git worktree add --detach` in `mktemp -d`, on this branch's code, removed afterwards). In it, `clockBehindChain` (`clock-behind.ts:147`) and `clockStopState` (`clock-confirmation.ts:107`) each got `return null` as their first statement; `git diff --stat -- packages/fiscal-verifactu/src/chain.ts` printed nothing.

**Stated before running.** If this ends the stop everywhere, `chain.clock-behind.test.ts` fails because the append now writes the earlier record, and the "behind" cases of `staff-notices.test.ts` and `clock-behind-alerts.test.ts` fail because nothing is reported. If those pass, the notice and alert still bypass the change.

- `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node` → `Test Files 16 failed | 224 passed (240)`, `Tests 161 failed | 5296 passed (5457)`. Among them: `chain.clock-behind.test.ts > … refuses a sale a day behind the last record and writes nothing` → `AssertionError: promise resolved "{ …(2) }" instead of rejecting` (the record was written); `staff-notices.test.ts > … a reading more than a minute before the latest record shows the stop` failed; `clock-behind-alerts.test.ts > … raises one error while the clock reads more than a minute before the latest record` failed.
- The 34 server suites that name the stop (`grep -l -E 'behind_chain|clockBehind|clockStopState|records_misdated|clock_checks|confirmClockStop|clock-behind|behind the chain' src/*.test.ts`), in three runs: 15 files and 146 cases failed; the other 19 passed (530 cases in the last batch alone). `hour-recovery-host.test.ts`, which the scan does not match, was run on its own: 1 failed of 37.

So the suggestion holds, and PR 5 takes it. Not run: the rest of `apps/server`, `apps/till` and `apps/dashboard` (PR 5 changes no code they import beyond the seat's answers); a failure there is a STOP. Every failing suite is in Tasks 17a and 17b.

### R9. Without a stop, an administrator can neither confirm nor set the clock (read; two cases run, 2026-11-10)

Read on this branch's head (`d4a9aea323`, whose code is the base's):

- `POST /api/box/clock-confirm` asks the seat's `confirmClockStop`, and when it answers no confirmation the route throws `clock.confirm_refused` with reason `not_stopped` (`apps/server/src/box-health-api.ts:307`).
- `POST /api/box/clock-set` always sends reason `behind_chain` unless the clock reads before 28-10-2024 (`box-health-api.ts:343`). The correction's admission then judges the stop (`clock-correction.ts:143-169`) and answers `not_stopped` when there is none (`clock-correction.ts:226`), which the route turns into `clock.set_refused` (`box-health-api.ts:361,384-391`).
- The dashboard offers the button only during a stop or `clock.unusable` (`#canSetClock` and `settableStop`, `apps/dashboard/src/screens/box-status-screen.ts:452-459,1226-1231`).

Run in a throwaway worktree: `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/clock-set.route.test.ts src/clock-confirm.route.test.ts -t "refuses a set with no stop|refuses a confirmation with no stop and no check waiting"` → `Tests 2 passed | 65 skipped (67)`. Those cases put the clock at the latest record's time; a clock two days ahead is also "no stop" by the same comparison (`clock-confirmation.ts:63-67`; R3's AHEAD row shows the till's route refusing `not_stopped` for exactly that clock). So with no internet, no till and a clock two days ahead, today nobody can confirm or set it, and after PR 1b nobody could lift the wait except by the date button. Task 7 opens both routes while waiting.

### R10. PR 1b's gate at boot breaks four existing server suites (RUN, 2026-11-10)

**Harness.** A throwaway worktree (`git worktree add --detach` under `mktemp -d`, on this branch's head; removed afterwards). In `bootServer`, straight after the seat is built (`boot.ts:2074`), a stand-in for PR 1b's gate: at a start where `filesRecords()` is true, ask the host's `clockStatus` (the test's fake host, else the real client); unless it answers available and synchronised, replace the seat's `refuseWhileClockBehind` and its four writers with a function that throws a stand-in refusal (`clock.unusable`), for the life of the process. This is an upper bound: the stand-in never asks AEAT and nothing ever lifts it, where PR 1b would confirm on an AEAT answer, a till, an administrator or the internet coming back. The patch is kept at `waitron-campaign-b/receipts/a1420-start-gate-probe-20261110.patch`.

**Stated before running.** If the gate reached no existing test, every suite passes; a suite that starts a filing server and then sells fails with `409 clock.unusable`. The control is the same suites with the patch taken out, which must pass, or a failure cannot be put down to the gate.

Suites: the 102 files under `apps/server/src` that name `bootServer`, `startServer`, `ephemeralServerFixture` or `runEntry` (the gate lives in boot, so nothing else can meet it; `apps/till`, `apps/dashboard` and `packages/fiscal-verifactu` start no server). Command: `env -u AI_AGENT -u CLAUDECODE A1420_PROBE_LOG=1 TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run <the 102 files>` in `apps/server` → `Test Files 4 failed | 98 passed (102)`, `Tests 9 failed | 1346 passed | 37 skipped (1392)`; the stand-in printed `waiting=true` 85 times and `waiting=false` never.

- `boot.backup-network.test.ts`: 8 of 8 failed, each at `expect(sale.status, …).toBe(200)` (`:236`) with `{"error":{"code":"clock.unusable",…}}: expected 409 to be 200`.
- `promote-endpoint-e2e.test.ts`: 1 of 6 ("restart into primary; sells + chains on its own reserved SIF"), `expected 409 to be 200` at `:516`.
- `handover-controlled.e2e.test.ts`: its shared setup failed (`clock.unusable … expected 409 to be 200` at `:842`), so its 32 cases were skipped.
- `handover-stepdown.real.test.ts`: its setup failed (`expected [] to have a length of 1 but got +0`), so its 5 cases were skipped.

Control, patch removed, the same four files → `Test Files 4 passed (4)`, `Tests 51 passed (51)`.

**What it means.** PR 1b must give those four suites a start whose time is confirmed: a fake host answering synchronised, through `StartServerSeams.boxHost` (`boot.ts:979`), or whatever seam Task 3 gives the start check (Task 6; "Changed test checks" lists them). Not measured: PR 1a's own AEAT ask. Today a start asks AEAT nothing (R1); after PR 1a each of those 85 filing starts that is not synchronised would ask it, so Task 3 keeps that ask off the real network in tests.

## Decisions

**D1. The start check, at every start of a filing primary** (`filesRecords()`), in `bootServer` after the correction exists (`boot.ts:2303`) and before the trading listener binds (`boot.ts:3611`). A box that does not file records (demo, preproduction without test submissions) starts confirmed, as today. Order:

| # | Asked | Answer | What the box does | Who sees what | PR |
| --- | --- | --- | --- | --- | --- |
| 1 | Time service (fresh `clockStatus`, not the one-minute cache) | synchronised | confirmed **by the internet**; asks AEAT once (5 s) only to compare | administrators: `clock.authority_disagreed` bell alert, not emailed, when AEAT differs by more than a minute | 1a |
| 2 | AEAT | answers, not synchronised | if the box differs by more than the reading's uncertainty, sets the clock to AEAT's time through the host (reason `start`, source `authority`) and reads AEAT once more; confirmed **by the internet** when that reading agrees | administrators: the existing `clock.corrected` alert **and email** (§5: every step) | 1a |
| 3 | nothing (AEAT unreachable or refused, not synchronised; or 2's second reading still out; or the host refused) | — | **waiting**: the listener opens; orders still reach the kitchen. In 1a it trades as today; from 1b no record and no money | staff on any signed-in till: the waiting notice with "Check the time"; administrators: the bell alert `clock.unconfirmed` and the Box status row | 1b |
| 3a | a staff member's "Check the time" | the till's time | agrees within a minute: confirmed **by a person** (no set). Differs: sets the box from the till's time through the host, then confirmed by a person | existing dialog words; a set raises `clock.corrected` and its email | 1b |
| 3b | an administrator | "The date is right", or the existing "Check with this device's time" | confirmed **by a person**. The date confirmation sets nothing (and, under Q2's default, is refused while the clock reads over a minute before the latest record). The device's time within a minute confirms through `/api/box/clock-confirm` (no set); further out, it sets the box through `/api/box/clock-set` with reason `start` and source `admin`, then confirms (R9) | a set raises `clock.corrected` and its email | 1b |
| 4 | while waiting or confirmed by a person | the watch, every 15 s, reads the time service fresh and asks AEAT at most once a minute (`AUTHORITY_EVERY_MS`) | the first internet answer is applied as rows 1-2 and confirms **by the internet**; it stops asking after that. If it moves a person-confirmed clock by more than a minute, PR 2 names the sales | as rows 1-2 | 1a |

There is no timer between the till and the administrator: both are offered from the first moment of waiting, and the internet coming back confirms by itself. A power cut whose router returns a minute later then needs nobody.

**D2. Waits.** At the start: one AEAT ask of at most 5 s, a host set the client waits up to 20 s for (`DEFAULT_SET_MS`), one more 5 s ask after a set: at most about 30 s before the listener binds, usually under a second. After that the listener is open whatever the answer. The watch's existing cadences are kept (15 s looks, AEAT once a minute); a host that refuses or does not verify is not asked again by the start check, and the watch tries again only after its existing back-off (`clock-watch.ts:37-38`).

**D3. "Waiting" is in memory, per process.** Each start begins waiting; nothing is stored about it except the confirmation rows (`clock_confirmations`, reason `start`, sources `authority`, `staff` or `admin`, `step_ms` 0 when nothing was set, proof carrying the chain heads at that moment and `{ "dateOnly": true }` for the administrator's date). Confirmation by the time service writes a log line, not a row.

**D4. Where the gate holds (R6).** In `boot.ts`, the one seat object is wrapped twice while the start check waits: its `refuseWhileClockBehind` throws `clock.unconfirmed` (409, no params) so every route R5 lists refuses before any card reader, refund send or drawer job; and its four writers throw the same, so no fiscal record is written by any path. The two refund loops and `clockStopsRefund` pause while waiting. A card already charged when a writer refuses is answered as today's stop answers it (`507 sale.charged_not_recorded`, new reason `clock_unconfirmed`). The Stripe webhook still stores a payment whose money has moved without writing a record (§5: "Still store money already moved"); it is recorded by the bill-payments loop once confirmed.

**D5. The restore follows the same order** (PRs 3-4). Placement names a series only on the series check. Synchronised: placement proceeds (Q1), and AEAT disagreeing by more than 30 s raises `clock.authority_disagreed` (owner, 2026-11-07). Not synchronised and AEAT answers out by more than 30 s: the host sets the clock to AEAT's time and placement runs once more in the same process. Neither: the restore waits, retrying every 60 s, uncounted. After placement the started server runs D1 like any start.

**D6. The start-failure page chooses words by code and cause (PR 4)** (owner, 2026-11-07, option A of A1385's question 2, as `queue.md` records it): `recovery.json` gains `lastErrorCause` from a closed set (`clock_set_failed`, `clock_moved`), kept on read only when a member (as `holderKind` is). Any other `sif.allocation_invalid` reason keeps #2532's words.

**D7. Waiting tries do not grow the start-failure log (PR 4).** A start taken back as waiting writes one line to the server log (`server.start_waiting_for_internet_clock`, with the `internet` reason) and nothing to the file the recovery page reads its tail from.

## Owner questions

**Q1. At a restore, may a synchronised time service stand in for AEAT when AEAT cannot be reached?** Example: a box is restored on Monday at 10:00; the venue's firewall lets the time service through, but AEAT is down for maintenance. Today the series check needs AEAT (or the setup page's browser) within 30 s. *Recommended default: yes.* "Synchronised" means the time service has exchanged time with internet time servers, which are other machines; your point 1 already trusts it for ordinary starts. It changes the §5 sentence quoted below. *Alternative:* the restore waits for AEAT, retrying every minute. About 20 lines either way.

**Q2. May a sale's time be earlier than the last sale's?** This is your point 4, and it changes what the chain accepts, though no line of the chain itself changes (R8). The adviser research allows an earlier time **only "when the new time is the exact one"** (`docs/compliance/research/2026-11-06-adviser-clock.md`, 51.1): after a real correction, the new time is exact and the earlier one was wrong. Internet time is exact; a till's time is the till's own clock, which staff look at before confirming; **an administrator's date-only confirmation is not exact**. AEAT's acceptance is not known: "nothing published refuses it. A free test settles it" (51.2). *Recommended default: yes, with two conditions.* (a) Before PR 5 is opened, run 51.2's free preproduction test: record A stamped now, record B chained to it stamped three minutes before A, record C stamped now as the control; PR 5 goes ahead only if B and C get the same answer. (b) **This condition is a block for being behind the last invoice, which you asked to drop**, kept in one narrow place: an administrator's date-only confirmation is refused while the box's clock reads more than a minute before the latest record. The dashboard then offers "Check with this device's time" or a till instead, both of which take a time someone looked at, so every time earlier than the last stays one the research covers. Payments are never refused for it once a time is confirmed. About 25 lines. **Three things to weigh before you answer:** (1) **No tax adviser has answered this.** The research file says of itself "This is research for the owner, not professional advice" (`2026-11-06-adviser-clock.md`, line 6), and the plan cites no adviser's answer. (2) **AEAT's test can show only a three-minute step, and only on preproduction.** The research says "A gap of days cannot be tried this way" and "Preproduction is not production, so this shows only what preproduction does" (51.2). PR 5 lets a sale's time be any amount earlier than the last, hours or days included, so a larger step in production rests on "nothing published refuses it" alone. (3) **After PR 5, a clock that falls back while the box is trading is no longer stopped.** Today, a clock that slips more than a minute behind the last sale stops payments. Afterwards the box keeps selling with the earlier time, and at most the existing `fiscal.clock_drift` warning shows (`apps/server/src/time-health.ts:104`); the start check has stopped asking by then (D1 row 4), and Q4's list does not catch it, because that list covers only a clock a person confirmed and records stamped ahead at the first internet answer. *Alternatives:* drop (b) and accept a date-only confirmation in every case, so a sale can carry an inexact time earlier than the last, which 51.1 does not cover; or keep today's stop, so PRs 1-4 land and PRs 5-6 do not.

**Q3. Does a till confirm with a staff member's tap, or by itself when it connects?** *Recommended default: a tap.* The till shows both clocks and the person chooses "The time is right" or "Use this time"; §5's "never from devices alone" stands, and a tablet whose own clock is wrong cannot confirm a wrong time unseen. *Alternative:* the first signed-in till whose clock is within a minute of the box's confirms silently. That changes §5 and about 15 lines.

**Q4. Should the box still list sales recorded with a wrong time?** Your decision of 2026-11-06 (`docs/backlog/box.md:1595`) says records dated in the future beyond the margin "are flagged for correction", and `:1596` that misdated sales have a remedy (A1407). The research says a wrong time alone needs only the file kept (52.1(a)), but a wrong **date** needs a corrective invoice (52.1(b)). Today the list is made when the old stop ends; removing the stop (PR 6) would leave nothing that makes it. Example: the router is dead after a power cut, an administrator confirms the date at 09:00 on a clock three hours ahead, and the internet returns at 14:00 and sets the clock back three hours. *Recommended default: keep the list for exactly that case.* When internet time later moves a clock that a person confirmed by more than a minute, the bell alert names how many sales were recorded since that confirmation, from when to when, and the existing list and download on Box status show them, so you can take the wrong-date ones to your tax adviser (PR 2, about 70 production and 100 test lines, reusing `clock-misdated.ts`). The same PR keeps the other case today's list covers, the one your 2026-11-06 decision names ("records dated in the future beyond the margin are flagged for correction"): when the internet first answers after a start and the latest record is more than a minute ahead of internet time, the alert names the records dated after that time, which the old box stamped in the future (about 30 more lines; PR 2 in all is about 100 production and 130 test lines). *Alternative:* no list; the `clock.corrected` alert alone says the clock moved and by how much, and records already stamped in the future are no longer flagged, which drops part of the 2026-11-06 decision.

**Q5. While payments wait for the time to be confirmed, do orders still reach the kitchen?** You said the time is confirmed "before we trade". Example: after a power cut with the router dead, a waiter takes a table's order on a handheld before anyone has tapped "Check the time". *Recommended default: yes.* An order sent to the kitchen writes no fiscal record and moves no money, so its time does not matter to the tax agency; only taking payment and issuing invoices wait, and the first payment attempt shows staff the "Check the time" button. *Alternative:* the till refuses sending orders too until the time is confirmed. That holds the kitchen for as long as nobody taps, and adds a check to every order route (about 40 lines, and the order routes' tests).

## Words

| Where | English | Spanish |
| --- | --- | --- |
| Till staff notice `clock.unconfirmed` (`apps/till/src/i18n/strings.ts`, `codes.ts`), PR 1b | The server's time is not confirmed yet. Payments wait until it is. | La hora del servidor aún no está confirmada. Los cobros esperan hasta que lo esté. |
| Same, hint | the existing "Check the time" (`staff_notice.check_time`; `CHECKABLE` gains the code) | «Comprobar la hora» (unchanged) |
| Till payment refusal `sale.clock_unconfirmed`, PR 1b | Payment not recorded: the server's time is not confirmed yet. The order stays open. Use “Check the time” at the top of the screen. | Cobro no registrado: la hora del servidor aún no está confirmada. El pedido sigue abierto. Usa «Comprobar la hora» en la parte superior de la pantalla. |
| Till card charged but refused, `sale.charged_clock_unconfirmed`, PR 1b | Card charged, but the payment is not recorded: the server's time is not confirmed yet. Don't charge again. Once it is confirmed, try this payment again: it is recorded without charging again. | Tarjeta cobrada, pero el cobro no está registrado: la hora del servidor aún no está confirmada. No cobres otra vez. Cuando esté confirmada, vuelve a intentar este cobro: se registra sin cobrar otra vez. |
| Bell alert `clock.authority_disagreed` (dashboard `alert-messages.ts`), PR 1a | When the box started, its clock ({boxAt:minute}) and the tax agency's time ({authorityAt:minute}) were {differenceMs:duration} apart. The box's time service says its clock is right, so the box kept it. Check the box's date and time on the Box status page. | Al arrancar, el reloj del equipo ({boxAt:minute}) y la hora de Hacienda ({authorityAt:minute}) se diferenciaban en {differenceMs:duration}. El servicio de hora del equipo indica que su reloj está bien, así que el equipo lo mantuvo. Comprueba la fecha y la hora del equipo en Estado del equipo. |
| Bell alert `clock.unconfirmed`, PR 1b | The box has not confirmed its time since it started, so it is not taking payments. It confirms by itself once it reaches the internet. Otherwise, sign in on any till or handheld and use “Check the time”, or confirm the date on the Box status page. | El equipo no ha confirmado su hora desde que arrancó, así que no acepta cobros. La confirma solo en cuanto llega a internet. Si no, inicia sesión en cualquier terminal y usa «Comprobar la hora», o confirma la fecha en Estado del equipo. |
| Box status, Clock row while waiting, PR 1b | Not confirmed since the box started: no payments are taken. The box's clock says {boxAt:date-time}. | Sin confirmar desde que arrancó el equipo: no se aceptan cobros. El reloj del equipo indica {boxAt:date-time}. |
| Same, button | The date is right | La fecha es correcta |
| Same, help under the button | Confirming the date lets the box take payments with its own clock. Use “Check with this device's time” if the time is out by more than a few minutes. | Confirmar la fecha permite al equipo cobrar con su propio reloj. Usa «Comprobar con la hora de este dispositivo» si la hora se desvía más de unos minutos. |
| Same, refusal under Q2(b) (`clock.date_behind_last_sale`) | The box's clock reads earlier than its last sale, so the date alone is not enough. Use “Check with this device's time”, or “Check the time” on a till. | El reloj del equipo indica una hora anterior a su última venta, así que la fecha sola no basta. Usa «Comprobar con la hora de este dispositivo» o «Comprobar la hora» en un terminal. |
| Bell alert `clock.records_misdated` for a clock that was behind (PR 2; the existing words cover a clock that was ahead) | {count} sales were recorded with a time earlier than the real time (from {from:minute} to {to:minute}). They stay as recorded. Go through them with your tax adviser; the list is on the Box status page. | Se registraron {count} ventas con una hora anterior a la real (de {from:minute} a {to:minute}). Quedan como se registraron. Revísalas con tu asesor; la lista está en Estado del equipo. |
| Bell and email after any set | unchanged `clock.corrected` words | unchanged |
| Start-failure page, cause `clock_set_failed` — title (PR 4) | The box could not set its clock. | El equipo no pudo poner su reloj en hora. |
| Same — action | Its clock is more than 30 seconds from the tax agency's time, and setting it did not work. Press “Retry a normal boot” to try again. | Su reloj se aparta más de 30 segundos de la hora de Hacienda y no se pudo poner en hora. Pulsa «Reintentar un arranque normal» para intentarlo de nuevo. |
| Start-failure page, cause `clock_moved` — title | The box could not check its clock. | El equipo no pudo comprobar su reloj. |
| Same — action | Its clock changed while the box was comparing it with the tax agency's time. Press “Retry a normal boot” to check again. | Su reloj cambió mientras el equipo lo comparaba con la hora de Hacienda. Pulsa «Reintentar un arranque normal» para comprobarlo de nuevo. |
| Waiting page (box's address while the restore waits) — title (PR 4) | The box is waiting for the tax agency's time. | El equipo está esperando la hora de Hacienda. |
| Same — body | It needs that time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | La necesita para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Setup done screen, under "The server is restarting to finish setup." (`done.waiting_internet_clock`), PR 4 | The box is waiting for the tax agency's time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | El equipo está esperando la hora de Hacienda para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Guide `backup-recovery.md` (EN/ES), replacing #2532's sentence after "If the clock check refuses, resolve its cause and try again." (PR 4) | If the box cannot get the tax agency's time when it restarts to finish the restore, it tries again every minute by itself; connect it to the internet if it is not. If it then shows a page saying it could not set or check its clock, do what that page says. | Si al reiniciarse para terminar la restauración el equipo no puede obtener la hora de Hacienda, lo vuelve a intentar solo cada minuto; conéctalo a internet si no lo está. Si después muestra una página que dice que no pudo poner en hora o comprobar su reloj, haz lo que indica esa página. |
| Guide, the till's clock section (EN/ES), PR 1b | When the server starts and cannot confirm its time over the internet, signed-in tills show “The server's time is not confirmed yet”. Use “Check the time”: payments wait until someone does, or until the server reaches the internet. | Cuando el servidor arranca y no puede confirmar su hora por internet, los terminales con sesión iniciada muestran «La hora del servidor aún no está confirmada». Usa «Comprobar la hora»: los cobros esperan hasta que alguien lo haga o hasta que el servidor llegue a internet. |

The dashboard's existing button is “Check with this device's time” / «Comprobar con la hora de este dispositivo» (`box_status.clock.admin.open`, `apps/dashboard/src/i18n/strings.ts:3741,7636`). The till's "Check the time" words are pinned in `apps/till/src/i18n/strings.test.ts:304-305`.

## Sentences changed, word for word

### Root `CLAUDE.md`

**C1. PR 1a inserts a new rule** in §5, in front of "More than a minute behind the latest fiscal record…" (line 899), and **PR 1b extends it** with the second sentence:

> **Every start of a box that files records checks its time with the internet before it opens: a synchronised time service confirms it (AEAT disagreeing by over a minute raises a dashboard alert, not emailed); otherwise the box sets its clock to AEAT's time when it differs.** *(PR 1b adds:)* **Until the internet, a staff member's "Check the time" on a till or handheld, or an administrator's confirmation (of the date, or from their own device's time) confirms it, the box writes no fiscal record and moves no money; orders still reach the kitchen.** Guards: `apps/server/src/start-clock-check.test.ts`, `apps/server/src/clock-unconfirmed-gate.test.ts` and `apps/server/src/boot.start-clock-gate.test.ts`, weaker than the rule: the money routes in the gate table only; the record remedies, off in production, are outside it.

**C2. PR 1b changes the "Nothing EXTERNAL may block a sale" rule** (§5, lines 878-880): its bold heading and its first sentence. Replace the heading

> **Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.**

with

> **Nothing EXTERNAL may block a sale, though a start must have its time confirmed first — and a till needs the venue's PRIMARY.**

and replace

> AEAT, the card network and the internet are never on the sale path of whichever node is primary: records chain locally and the outbox drains later; a card falls back to 4G, a standalone terminal or cash.

with

> AEAT, the card network and the internet are never on the sale path of whichever node is primary, except that a start the internet cannot confirm waits for a person to confirm its time before its first payment (owner, 2026-11-09): records chain locally and the outbox drains later; a card falls back to 4G, a standalone terminal or cash.

**C3. PR 1b changes the clock-setting sentence** (§5, lines 909-913). Replace

> **The box sets its clock only through the host service, from AEAT, a till's time (a staff member's during start-up, an administrator's at any time) or an administrator's own device — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed.**

with

> **The box sets its clock only through the host service, from AEAT, a till's time (a staff member's while the start has not confirmed the time, an administrator's at any time) or an administrator's own device — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed.**

**C4. PR 3 changes the restore sentence** (§5, lines 928-930). Replace

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation); a minute whose name is already in a history the box reads is not taken.

with, if Q1 is yes,

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds, or, at the start placing a restore, the box's time service says it is synchronised (AEAT disagreeing then raises a dashboard alert); never on a till's or administrator's confirmation; a minute whose name is already in a history the box reads is not taken.

or, if Q1 is no,

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds, except that the start placing a restore keeps the clock of a box whose time service says it is synchronised when AEAT's disagrees, with a dashboard alert; never on a till's or administrator's confirmation; a minute whose name is already in a history the box reads is not taken.

**C5. PR 5 replaces the stop's rule** (§5, lines 899-908). Replace

> **More than a minute behind the latest fiscal record, write no record and take/refund no new money unless a clock confirmation covers it.** After replay, call `refuseWhileClockBehind` before reader/refund/drawer work; pause both refund recovery loops. Recheck card-refund send/outcome in their dating transaction after provider waits. Still store money already moved. **Clock confirmation lifts the stop for one step back, with no gap limit; once a record is written under it, readings stay within a minute of the latest record written since.** Sources, never a box device outside development: [conventions-data.md](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-06). Guards: clock-behind-stop, payments clock-behind, fiscal chain/restart/confirmation, clock-confirm route and `apps/server/src/clock-watch.start-up.test.ts` suites, weaker than the rule: only named routes/readings/requests; new money routes unguarded.

with

> **A record's time is never compared with the latest record's: the start confirms the time, and a record may carry a time earlier than the one before it when that time came from the internet or a device clock a person looked at** (owner, 2026-11-09; research 51.1). After replay, call the seat's `refuseWhileClockBehind` (by then: waiting, or before 28-10-2024) before reader/refund/drawer work; pause both refund recovery loops while waiting. Recheck card-refund send/outcome in their dating transaction after provider waits, against the same check. Still store money already moved. Guards: `packages/fiscal-verifactu/src/chain.earlier-time.test.ts` and `apps/server/src/clock-unconfirmed-gate.test.ts`, weaker than the rule: the money routes in the gate table only, and nothing checks where an earlier time came from.

(PR 6 renames `refuseWhileClockBehind` to `refuseUntilRecordable`, and C5 follows the rename.)

C5 keeps today's "Recheck card-refund send/outcome in their dating transaction after provider waits", with "against the same check" added, because the re-check stays in the code (R5's refund row: `clockStopsRefund`, `bill-refunds.ts:209-220`, still pauses while waiting). Within one process the start check never goes back to waiting (D3), so after PR 5 the re-check finds little the request's own check did not: for a manager's confirmed outcome, a clock set before 28-10-2024 during the provider's wait (`bill-refunds.ts:215-217`, read, not run). It stays as long as the code does, so that a later change to what may refuse a record reaches the refund paths too.

**C6. PR 5 deletes the fiscal-fixture rule** in §4 (lines 738-740), which exists only because the stop refused a write behind a fixture's record:

> **A fiscal fixture must not be over a minute ahead of a later recording write's clock.** In a shared database, every write and helper takes its clock from the latest record time; otherwise give the case its own database. Nothing guards it.

Replacement: none (deleted, and the commit says so). Its receipt in `docs/developers/testing-guide.md` gets a dated pointer to this plan.

### `docs/developers/conventions-data.md`

**C7. PR 1b**, the section "Nothing external may block a sale, and a till needs the venue's primary" (lines 3985-3989): its heading becomes "Nothing external may block a sale, though a start must have its time confirmed first, and a till needs the venue's primary", and its bold line and first sentence take C2's replacements word for word.

**C9. The copies in "Who may confirm or set the clock"** (lines 6101-6118) hold C3's and C5's sentences word for word. Each copy takes the same replacement in the same PR (C3 in PR 1b, C5 in PR 5). The sentence between them, "Sources: AEAT, two agreeing devices at different addresses (not while the stop found at start-up lasts), an administrator's own device, or a till's time confirmed on it by an administrator at any time or, during a stop found at start-up once AEAT has not answered or cannot be asked, by a staff member signed in on it (owner, 2026-10-31); never a box device outside development.", becomes in PR 1b "Sources: AEAT, two agreeing devices at different addresses (not while the stop found at start-up lasts), an administrator's own device, or a till's time confirmed on it by an administrator at any time or, while the start has not confirmed the time, by a staff member signed in on it (owner, 2026-10-31; 2026-11-09); never a box device outside development.", and in PR 5 loses "two agreeing devices at different addresses (not while the stop found at start-up lasts),", since only the stop used them.

**C10. PR 1b**, the till routes' entry (line 4535): "any staff member the till's profile admits, during the start-up window only (below)" becomes "any staff member the till's profile admits, while the start has not confirmed the time (below)".

**C8. PR 1a**, "The box sets its own clock" (lines 4479-4481). Replace "The box sets its clock only inside a stop it already has: the clock behind the latest record, or the clock before 28-10-2024 (`clock.unusable`). It opens no stop of its own." with "The box sets its clock inside a stop it already has (the clock behind the latest record, or before 28-10-2024), and while a start has not had its time confirmed by the internet. It opens no stop of its own." (PR 6 drops "the clock behind the latest record, or".)

### `docs/backlog/box.md`, the owner's decision of 2026-11-06 (line 1595)

This is a dated decision record, so the sentences are not rewritten in place: **PR 1b adds a dated line under it** — "**Superseded in part (owner, 2026-11-09, A1420).**" — followed by each sentence and its replacement:

| 2026-11-06 sentence | Replaced by (2026-11-09) | PR |
| --- | --- | --- |
| "Being unable to reach AEAT never stops trading." | "A start that neither the time service nor AEAT can confirm takes no payment until a till or an administrator confirms its time." | 1b |
| "A start with no internet whose latest record is in the future beyond the margin needs the time confirmed first." | "Every start with no internet needs its time confirmed first, wherever its latest record is." | 1b |
| "Any accepted source showing the clock outside the margin stops trading until it is corrected, and AEAT disagreeing during normal trading is such a source." | "AEAT showing the clock out sets it when the time service is not synchronised, and raises an alert when it is; neither stops trading." | 5 |
| "…and records dated in the future beyond the margin are flagged for correction." | Q4 yes: "…and records stamped more than a minute ahead of internet time, and the sales recorded while a clock a person confirmed was out, are listed for the tax adviser." Q4 no: deleted. | 2 or 6 |

"AEAT refusing the latest record as too far in the future stops trading until the clock is reset" and "The margin is one minute" are not changed by this plan.

## PR 1a — the internet confirms or sets the clock at every start (no gate)

### Task 1: the start check's decision (apps/server, pure)

Files: new `apps/server/src/start-clock-check.ts` and its test.

- [ ] Tests, with a fake `readAuthorityTime` (a sample or null), a fake `clockStatus`, a fake correction. End point: the check's promise settled.
  1. Synchronised, AEAT 2 days ahead → `by_internet`, no `set`, one disagreement note with both times. Control: AEAT within a minute → `by_internet`, no note.
  2. Not synchronised, AEAT 2 days behind → one `set` (reason `start`, source `authority`, offset within 1 s), then a second ask; it agrees → `by_internet`; it still disagrees → `waiting`.
  3. Not synchronised, AEAT 400 ms off with uncertainty 600 ms → no `set`, `by_internet`. Control: 1,500 ms off → one `set`.
  4. Not synchronised, AEAT null → `waiting`, no `set`. Control: case 2.
  5. A set the correction does not complete (one case, answer `refused`) → `waiting`, and no second `set` within this check.
- [ ] Implement `startClockCheck(deps) → Promise<{ state: "by_internet" | "waiting"; note?: Disagreement }>` and `startClockState()` holding `waiting | by_person | by_internet` with `confirm(by)` and `unconfirmed()`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/start-clock-check.test.ts`.

### Task 2: the start confirmation row and the disagreement alert (fiscal-verifactu, fiscal seat)

Files: `packages/fiscal-verifactu/src/clock-step.ts` (a step at reason `start` writes its row with no check, as non-`behind_chain` reasons already do at `:90`; new `recordStartConfirmation(tx, { source, personId, boxAt, stepMs, proof })` beside it, storing the chain heads in its proof); `clock-stop-incidents.ts` (`clock.authority_disagreed`, warning, `system.manage`, params `boxAt`, `authorityAt`, `differenceMs`); `packages/fiscal/src/backend.ts` (optional seats); `apps/dashboard/src/i18n/alert-messages.ts` (its words); the area claim (follow `scripts/alert-codes.test.ts`'s failure message).

- [ ] Tests: `clock-step.test.ts` (a `start` confirmation by staff with `stepMs` 0 writes one row with no check and the heads in its proof; one by `admin` keeps `dateOnly`), `clock-stop-incidents.test.ts` (one `clock.authority_disagreed` with its three params).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-step.test.ts src/clock-stop-incidents.test.ts`, `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`, then the fiscal core command.

### Task 3: boot runs the check before the listener; the correction admits reason `start`

Files: `boot.ts` (run Task 1 after `:2303` and before `:3611`; record the disagreement note; hold the state; the start check's AEAT reader and host come in through `StartServerSeams`, so no test's start reaches the real AEAT: R10 counted 85 filing starts in the server's suites); `clock-correction.ts` (reason `start` admitted without a stop while the state is not `by_internet`; a set at reason `start` from source `staff` or `admin` moves the state to `by_person`, one from `authority` leaves it to Task 1's second reading).

- [ ] Test (`clock-correction.test.ts`, new cases only; **this suite owns "refused once confirmed by the internet"**): reason `start` admitted while waiting and while by a person; refused `not_stopped` once by the internet. Control: the existing "refuses a set with no stop" case, unedited.
- [ ] Test (one case in `boot.clock-correction.test.ts`, which already boots with a fake host): AEAT 2 days ahead and the host not synchronised → the host receives one set before the listener's first answer. Control: synchronised → no set.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-correction.test.ts src/boot.clock-correction.test.ts`.

### Task 4: the watch keeps listening for the internet (apps/server)

Files: `clock-watch.ts`, `clock-watch.start-up.test.ts` (new cases).

- [ ] Tests: while waiting or by a person, a look reads the time service fresh (cache cleared) and asks AEAT at most once a minute, and hands the first answer to Task 1's decision; once by the internet, a look asks nothing for the start check. A waiting box whose time service turns synchronised is confirmed at the next look. Control: the existing "no stop" case, unedited.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-watch.start-up.test.ts src/clock-watch.test.ts`.

### Task 5: PR 1a documents

- [ ] Root `CLAUDE.md` C1's first sentence; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] `conventions-data.md`: C8, and a new section "Every start confirms the box's time before it trades" (D1-D3, R1, R4). Grep the file for every other "only inside a stop" or "only during a stop" claim and fix each.
- [ ] `docs/backlog.md`: A798 slice 9c's "a clock running ahead dates sales…" line narrows to a clock that drifts ahead while the box runs.

## PR 1b — with no internet, a person confirms the time before the first payment

### Task 6: the gate (apps/server)

Files: `boot.ts` (the two wrappers of D4 around the one seat; hand `unconfirmed()` to the two loops and `clockStopsRefund`); `tender-refund-recovery.ts`, `bill-payments-loop.ts`, `bill-refunds.ts` (one condition each); `apps/server/src/errors.ts` (`clock.unconfirmed: {}`; reason `clock_unconfirmed` on `sale.charged_not_recorded`); `till-api.ts` and `payments-api.ts` status maps (409). Not `record-remedy-routes.ts` (R7).

- [ ] Test, new `apps/server/src/clock-unconfirmed-gate.test.ts` on `provisionBillVenue` with its seat wrapped by the same helper boot uses (exported from a small `start-clock-gate.ts`). **One table, `it.each`, over every money route R5 lists** — `POST /api/pay` (counter card, stored order, zero total), `POST /api/sales` (cash), collect, bill payment, bill refund (new and pending replay), tender refund (new and pending), the tender-refund retry, unpaid departure, and the eight dashboard resolutions — each while waiting: answers 409 `clock.unconfirmed`, `collectCalls`, refund sends and drawer jobs unchanged, no row in `registros_facturacion`, `sales`, `tenders` or the route's own table. Control row: the same request once confirmed answers its success status.
- [ ] Same file, the money already moved: a card charged as the gate turns on whose sale would file answers `507 sale.charged_not_recorded` with `reason: "clock_unconfirmed"` and writes the payment once confirmed; the webhook stores a hosted payment while waiting (as `webhook.test.ts`'s behind case does); a correction through `cancel-credit.ts` is refused with nothing written. Both loops leave a pending refund untouched for one pass while waiting, and complete it once confirmed (control).
- [ ] Test, new `apps/server/src/boot.start-clock-gate.test.ts` (wiring only, R3's harness): AEAT unreachable, not synchronised → `POST /api/sales` answers 409 `clock.unconfirmed`; with AEAT answering → 200 and one record (control).
- [ ] The four suites R10 found failing under the gate (`boot.backup-network.test.ts`, `promote-endpoint-e2e.test.ts`, `handover-controlled.e2e.test.ts`, `handover-stepdown.real.test.ts`) get a start whose time is confirmed: a fake host answering synchronised, through `StartServerSeams.boxHost` or Task 3's seam. Setup only; no assertion changes. Then run the same 102-file selection R10 ran; any other failure is a STOP.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-unconfirmed-gate.test.ts src/boot.start-clock-gate.test.ts src/clock-behind-stop.pay.test.ts src/clock-behind-stop.refunds.test.ts src/webhook.test.ts src/boot.backup-network.test.ts src/promote-endpoint-e2e.test.ts src/handover-controlled.e2e.test.ts src/handover-stepdown.real.test.ts`, then the fiscal core command.

### Task 7: "Check the time" and the administrator's date while waiting (server and till)

Files: `clock-start-up.ts` (`tillMayOffer` and `admit` also true while waiting, at once: the start already asked AEAT); `till-box-clock-api.ts` (while waiting: "The time is right" or a till within a minute writes Task 2's confirmation with `stepMs` 0; a differing till sets through the host as today, then confirms; both move the state to `by_person`); the staff-notice source (`clock.unconfirmed` while waiting); `box-health-api.ts` (R9: `/api/box/clock-confirm` admitted while waiting, writing Task 2's confirmation with source `admin` and `stepMs` 0, either from the device's time within a minute or, with `dateOnly: true`, from the date alone, which under Q2's default is refused `clock.date_behind_last_sale` while the clock reads more than a minute before the latest record; `/api/box/clock-set` sends reason `start` instead of `behind_chain` while waiting, `unusable` still taking precedence; both move the state to `by_person`; routes handed no start check behave as today, so the existing route suites' setups stand); `apps/till/src/i18n/strings.ts`, `codes.ts`, `staff-notices.ts` (`CHECKABLE` gains `clock.unconfirmed`), `widgets/pay-refusal.ts` (the two refusals).

- [ ] Tests: `clock-start-up.test.ts` (offered while waiting with no AEAT answer yet). `till-box-clock-api.test.ts` (waiting, "The time is right" → one `start`/`staff` row, no host call, state `by_person`; a till 2 days off → one host set, then the row; **one route case: by the internet → refused**, the property's other owner being Task 3). `clock-confirm.route.test.ts` (while waiting, an administrator's device within a minute of the box → 200, one `start`/`admin` row with `stepMs` 0 and no `dateOnly`, no host call, state `by_person`; an administrator's `dateOnly` confirm while waiting → one `start`/`admin` row, no host call; Q2(b): the clock an hour before the latest record → refused, no row; control: the existing "refuses a confirmation with no stop and no check waiting", unedited). `clock-set.route.test.ts` (R9's case: waiting, no internet, no till, the box's clock two days ahead of the administrator's device → 200; the host receives one set with reason `start` and requester `{ source: "admin", person }`; one `start`/`admin` row with `stepMs` about −2 days; end point: the start check reads `by_person` (Task 6's table owns the payment that then goes through). Control: the existing "refuses a set with no stop", unedited, for a box not waiting). Till: `src/i18n/staff-notices.test.ts` and `src/i18n/t.test.ts` (both languages), `pnpm exec vitest run scripts/staff-notice-codes.test.ts`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-start-up.test.ts src/till-box-clock-api.test.ts src/clock-confirm.route.test.ts src/boot.clock-watch.test.ts`, `pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts src/i18n/t.test.ts`.

### Task 8: the bell alert and the Box status row (server and dashboard)

Files: new `apps/server/src/clock-unconfirmed-alert.ts` (an `AlertSource`, `system.manage`, raised while waiting); `apps/server/src/box-health.ts` (the clock read answers `waiting` with `boxAt`); `apps/dashboard/src/screens/box-status-rows.ts`, `box-status-screen.ts` (`settableStop` and `stopShowing`, `:1217-1231`, also hold while the Clock row reads waiting, so "Check with this device's time" is offered then: R9), `apps/dashboard/src/i18n/strings.ts`, `alert-messages.ts`; in `apps/server/src/guide/en/box-status.md` and `es/box-status.md`, a new section "When payments wait for the box's time" with the shared id `{#clock-waiting}` (what staff and administrators do: the three ways in D1 rows 3a-3b, and that the internet confirms by itself); the till guide sentence in `till-notices.md` (EN/ES).

- [ ] Tests: `clock-unconfirmed-alert.test.ts` (raised while waiting; not once confirmed: the control). `box-status-rows.test.ts` and `box-status-screen.test.ts` (the row's words and the box's date while waiting, absent once confirmed; "The date is right" sends `dateOnly: true` and the row goes after the answer; the Q2(b) refusal shows beside the button, per the Forms contract; while waiting, with the box not kept in time over the internet and the device two days off, "Check with this device's time" is offered and sends `/api/box/clock-set`; control: the same health once confirmed offers no set). `box-status-screen.a11y.test.ts` gains the waiting state in both themes.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-unconfirmed-alert.test.ts src/box-health.test.ts src/guide-content.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts src/screens/box-status-screen.test.ts src/screens/box-status-screen.a11y.test.ts src/i18n/alerts.test.ts` (free memory first), `pnpm exec vitest run scripts/guide-links.test.ts scripts/alert-codes.test.ts`.

### Task 9: PR 1b documents

- [ ] Root `CLAUDE.md` C1's second sentence, C2, C3; `conventions-data.md` C7 and the new section's gate part (D4, R3, R6, R7); `docs/backlog/box.md`'s dated line (its PR 1b rows); the A1407 entry in `docs/backlog.md` gains "an enabled remedy takes the start gate first" (R7). `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.

## PR 2 — the alert names the sales a person-confirmed clock dated (only if Q4 is yes)

### Task 10: list the sales between a person's confirmation and the internet's correction

Files: `packages/fiscal-verifactu/src/clock-misdated.ts` (`misdatedSelection` also reads a `start` confirmation with no check, in two shapes: the records written after a person's confirmation's stored heads and up to the heads at the internet's step; and the records whose time is later than the internet's time plus a minute), `clock-stop-incidents.ts` (`recordMisdated` called with either; a `direction` param, `later` or `earlier`), `apps/server/src/clock-watch.ts` and the start check (the first internet answer after a start records the second shape when the latest record is more than a minute ahead of it; and the first shape when it steps a person-confirmed clock by more than a minute), the dashboard words for `earlier`.

- [ ] Tests: `clock-misdated.test.ts` (new cases: a staff `start` confirmation, three sales, an `authority` step of −3 h → the three listed, earliest first; a step of 40 s → nothing recorded, the control. Two records stamped 2 h ahead of the internet's time and one 30 s ahead → the two listed; none ahead → nothing recorded, the control). `start-clock-check.test.ts` (one case: the internet confirms a start whose latest record is 2 h ahead → one `clock.records_misdated`, `later`). `clock-watch.start-up.test.ts` (one case: a person-confirmed clock moved 3 h by AEAT → one `clock.records_misdated`). The existing list and download routes are unchanged and their suites pass unedited.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-misdated.test.ts src/clock-misdated-detail.test.ts src/clock-stop-incidents.test.ts`, `pnpm --filter @waitron/server exec vitest run src/clock-watch.start-up.test.ts src/box-health.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`, then the fiscal core command.
- [ ] `docs/backlog/box.md`'s Q4 row.

## PR 3 — the restore's placement follows the same order

### Task 11: the comparison trusts a synchronised box, and its refusal carries AEAT's offset (fiscal-verifactu)

Files: `packages/fiscal-verifactu/src/hour-clock.ts`, `hour-clock.test.ts`, `hour-setup-clock.ts`, `hour-setup-clock.test.ts`, `errors.ts` (optional params on `sif.allocation_invalid`: `authorityOffsetMs?: number`, `internet?: string`).

- [ ] Tests (`hour-clock.test.ts`): `compareHourClocks(obs, release, { boxSynchronised: true })` with AEAT 31 s ahead → `canSelectHour` true. The same without the option → false and `clock_disagreement` (control; the existing cases stay unedited). With the option and AEAT unavailable → **Q1 yes:** true; **Q1 no:** false and `second_clock_missing`. In `hour-setup-clock.test.ts`: a reading made with `boxSynchronised: true` keeps it on `read`; a `clock_disagreement` refusal's params carry `authorityOffsetMs` within 1 s of +31 000; a `second_clock_missing` refusal carries `internet: "network"`.
- [ ] Implement. The release and range checks are unchanged.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-clock.test.ts src/hour-setup-clock.test.ts src/hour-selection.test.ts`, then the fiscal core command.

### Task 12: the restore's start tells the module whether the box is synchronised (module contract)

Files: `packages/module/src/operation-preparation.ts` (type), `packages/provisioning/src/first-setup-runtime.ts` (`createModuleOperationHost` passes it through), `packages/fiscal-verifactu/src/hosted-hour-recovery.ts` and its test; `apps/server/src/recovery-preparation.ts`, `recovery-entry.ts`, `restore-request.ts` (the start's runner supplies it; the page runner does not).

- [ ] Add to `ModuleOperationHost`, with one comment saying only the start placing a staged restore supplies it:
  ```ts
  startClock?: {
    synchronised(): Promise<boolean>; // false when the host service does not answer
    disagreed(note: { boxAt: string; authorityAt: string; differenceMs: number }): void;
  };
  ```
- [ ] Tests (`hosted-hour-recovery.test.ts`), through `configure!(host).resumeRecovery` then `prepare` as existing cases do: (1) AEAT 31 s ahead with `synchronised` → true: `prepare` admits, and `disagreed` is called once with the two times about 31 000 ms apart. (2) The same with `synchronised` → false: it throws `clock_disagreement` with `authorityOffsetMs`, and `disagreed` is never called; the end point is the thrown refusal, case 1 the control. (3) No seat: today's refusal (the existing cases, unedited).
- [ ] Test (`apps/server/src/restore-request.test.ts`): the start's runner hands the seat to the module, and `createInteractiveRecoveryPreparation` does not.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hosted-hour-recovery.test.ts`, `pnpm --filter @waitron/server exec vitest run src/restore-request.test.ts src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts`, `pnpm exec vitest run scripts/module-seams.test.ts`, then the fiscal core command.

### Task 13: not synchronised and out: set from AEAT and place once more (apps/server)

Files: new `apps/server/src/clock-host-step.ts` (lines `clock-correction.ts:285-311` moved, a pure move) and its test; `clock-correction.ts` (calls it); `node-entry.ts`; `start-clock-note.ts` (new, the in-memory note type handed to `startServer`).

- [ ] Move first. `stepClockThroughHost({ host, offsetMs, requester, wall, monotonic, boot })` → `{ verified, moved, stepMs, before, after, answer }`. `clock-correction.test.ts`, `clock-correction.backup-hold.test.ts` and `boot.clock-correction.test.ts` pass **unedited**. The new test covers the three host answers once (lands within 2 s, refuses unmoved, throws).
- [ ] Tests in `node-entry.test.ts`, with a `runStagedRestore` stub and a fake host: (1) the first placement throws `clock_disagreement` with `authorityOffsetMs: 300 000` and the host says not synchronised → the host is asked once to set with requester `{"source":"authority","start":"restore"}`; placement runs a second time; `startServer` receives one step note, which it records through `confirmClockStep` (reason `start`, source `authority`) before the backup supervisor starts. Control: the same stub with `synchronised: true` asks nothing. (2) Set, and the second placement still throws `clock_disagreement` → the start counts, with cause `clock_set_failed` (PR 4 adds the page words; PR 3 records the cause name in the log). (3) The host refuses, or answers `available: false` → the start counts and placement is not run again. End point: `runEntry` settled; case 1 is the forced-effect control.
- [ ] Root `CLAUDE.md` C4.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-host-step.test.ts src/node-entry.test.ts src/clock-correction.test.ts src/clock-correction.backup-hold.test.ts src/boot.clock-correction.test.ts`, `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.

## PR 4 — the restore waits for AEAT without counting, and the page names the cause

### Task 14: a restore's start that cannot reach AEAT waits, uncounted (apps/server)

Files: `apps/server/src/node-entry.ts`; new `start-clock-waiting.ts` (the waiting app) and its test; `apps/server/src/errors.ts` (`server.waiting_for_internet_clock: {}`); `i18n/recovery-page.ts` (waiting page words). Under Q1 yes, a synchronised box never reaches this wait.

- [ ] Tests (`node-entry.test.ts`, a `runStagedRestore` stub, a fake `serveRecovery`, fake timers). End point: `runEntry` settled.
  1. `second_clock_missing` with `internet: "network"` → the count after equals the count before; the waiting app is served, closed at 60 000 ms and not before; the start-failure log file has the same length as before. Control (forced effect): `internet: "tls"` → the count rises by one and the log grows.
  2. `internet: "timeout"` → as case 1.
  3. Three `network` starts in a row → the box state is still `normal`.
- [ ] Tests (`start-clock-waiting.test.ts`): `GET /` (HTML) → 503, `Retry-After: 60`, the words in English, and in Spanish with `Accept-Language: es`. `GET /setup-api/status` → 503 `{ error: { code: "server.waiting_for_internet_clock" } }`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts src/start-clock-waiting.test.ts`, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

Why every 60 seconds with no overall limit: it is the watch's AEAT cadence, a router coming back is noticed within a minute, each try repeats the restore's archive checks so faster costs more, and the box cannot trade until the restore is placed, so waiting costs nothing. `tls`, `response` and `configuration` are not a network that will come back, so they count as today.

### Task 15: the setup page says what the box is waiting for

Files: `apps/setup/src/screens/done-screen.ts` and its test, `apps/setup/src/i18n/strings/finish.ts`.

- [ ] Test: a poll answered 503 with `server.waiting_for_internet_clock` shows the waiting line under the restarting line. A following poll that fails to connect keeps it (between tries nothing answers). A 404 (trading) shows "ready" and drops it.
- [ ] `pnpm --filter @waitron/setup exec vitest run src/screens/done-screen.test.ts src/screens/done-screen.a11y.test.ts` (free memory first).

### Task 16: the start-failure page names the cause

Files: `recovery-state.ts` (`lastErrorCause`), `node-entry.ts` (`failStart` sets it; Task 13 already chose the cause names), `recovery-surface.ts`, `i18n/recovery-page.ts`; the guide sentence in `backup-recovery.md` (EN/ES).

- [ ] Tests: `recovery-state.test.ts` (a cause outside the set is dropped on read; `withFailureCode` clears a stale one). `node-entry.test.ts`: Task 13's `clock_set_failed` reaches the state; `clock-corrected` → `clock_moved`; `minute_in_use` → no cause. `recovery-surface.test.ts`: each cause's words in both languages; no cause → #2532's words (its case stays unedited).
- [ ] `pnpm --filter @waitron/server exec vitest run src/recovery-state.test.ts src/node-entry.test.ts src/recovery-surface.test.ts src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`.

## PR 5 — the stop stops answering (Q2; the fiscal core unchanged)

Not started without the owner's yes to Q2 and AEAT's answer to 51.2's test (Task 19, PR 5 part). **Behaviour only: no production deletion, and no edit to `chain.ts`.** Three tasks, each for one implementer; the branch is pushed only after Task 17c, since between 17a and 17b the server's suites still expect the stop.

**PRs 5 and 6 land together.** PR 6 is built on PR 5's branch before PR 5 goes to the owner; both are put to the owner as one approval and landed one straight after the other in the same sitting. PR 5 alone leaves the stop's code in place but unreached, and the nightly run enforces `98/98/98/95` coverage, so a nightly between them could fail. If PR 6 is not ready when PR 5 is approved, PR 5 waits for it.

### Task 17a: `clockBehindChain` and `clockStopState` answer null (fiscal-verifactu)

Files: `packages/fiscal-verifactu/src/clock-behind.ts` (`clockBehindChain` answers null; its body goes in PR 6) and `clock-confirmation.ts` (`clockStopState` answers null). About +4 / −0 production lines. Through them the append, the seat's `refuseWhileClockBehind` and `clockBehindLatestRecord`, the staff notice and the bell alert all stop finding a stop; `refuseWhileClockBehind` still refuses a time before 28-10-2024 first (`clock-behind.ts:172`).

- [ ] Test first: new `packages/fiscal-verifactu/src/chain.earlier-time.test.ts`: a record dated an hour before the latest is written, chained after it in `secuencia`, with its own time. Control (forced effect): one dated 27-10-2024 is refused `clock.unusable`. Watch the first fail on the current code.
- [ ] Then delete or trim the fiscal suites R8 measured failing (161 cases), each case because the behaviour it asserts is removed: `chain.clock-behind.test.ts` (2 of 5 fail; deleted, replaced by `chain.earlier-time.test.ts`), `backend.clock-behind.test.ts` (1 of 3), `backend.clock-stop.test.ts` (3 of 6), `clock-behind.test.ts` (4 of 7), `clock-behind.restart.test.ts` (32 of 38), `clock-checks.test.ts` (27 of 41), `clock-confirmation.test.ts` (40 of 61), `clock-stop-incidents.test.ts` (33 of 37), `clock-misdated.test.ts` (10 of 24), `clock-step.test.ts` (2 of 29: the stop-closing steps), `clock-behind-alerts.test.ts` (2 of 9: the behind alert; the unusable cases stay), `staff-notices.test.ts` (1 of 22: the behind notice), and one case each in `record-remedy-http.test.ts` ("refuses a server clock behind the chain without appending"), `record-remedy-absent.test.ts` ("refuses a clock more than a minute behind the chain"), `record-remedy-corrective.test.ts` ("uses the host clock stop before appending the corrective invoice") and `record-remedy-corrective-http.test.ts` ("refuses a new corrective record when the host clock is behind the chain"). Those four remedy cases are deleted, not rewritten: a remedy is switched off in production, its refusal there comes only from the disabled policy, and "keeps the default production policy closed" already owns that (R7); a rewritten case would only repeat the chain's behaviour on a feature nobody can use.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node` (read the `Tests` count; a failure in a suite not listed here is a STOP), the fiscal core command **unedited**, and `git diff --stat <base> -- packages/fiscal-verifactu/src/chain.ts` prints nothing.

### Task 17b: the server's suites (apps/server)

- [ ] Delete or trim the server suites R8 measured failing (146 cases), each case because the behaviour it asserts is removed: `clock-behind-stop.bills.test.ts` (6 of 7), `.charged` (3 of 7), `.open` (4 of 5), `.pay` (7 of 9), `.records` (6 of 16), `.refunds` (14 of 16), `payments-api.clock-behind.test.ts` (9 of 26), `zone-clock-stop-interaction.test.ts` (4 of 4, deleted), `clock-watch.restart.test.ts` (13 of 13, deleted), `clock-confirm.route.test.ts` (34 of 45), `till-box-clock-api.test.ts` (31 of 41), `clock-set.route.test.ts` (12 of 22), `boot.clock-behind-wiring.test.ts` (1 of 3: "answers stopped for a time a day before the latest record"), `webhook.test.ts` (1 of 16: "records a hosted payment while the box's clock reads behind its last sale"; Task 6's table owns the waiting version), `hour-recovery-host.test.ts` (1 of 37: "a restore below the backup's newest invoice names its minute, a sale is then refused by the clock-behind stop, and a confirmation lists the later sale"; becomes: the sale after that restore is taken, dated by the box's clock). Task 7's new cases in `clock-confirm.route.test.ts`, `till-box-clock-api.test.ts` and `clock-set.route.test.ts` are about waiting and stay.
- [ ] The PR lists each case removed. **A failure in a suite not on this list is a STOP.** Task 6's gate table already owns what the route suites tested that survives.
- [ ] `pnpm --filter @waitron/server exec vitest run` on every suite named here and the 102-file selection R10 ran (read the `Tests` count).

### Task 17c: rules and staff guides

- [ ] Root `CLAUDE.md` C5 and C6; C9's PR 5 parts; `docs/backlog/box.md`'s PR 5 row; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] The staff guides, English in `apps/server/src/guide/en/` and the Spanish twin of each in `apps/server/src/guide/es/`. Each sentence that describes the stop is cut, not reworded (a guide sentence earns its place by changing what staff do):
  - `box-status.md`: the section "When payments stop because of the clock" `{#clock-behind}` (EN lines 174-380; ES "Cuando se paran los cobros por la hora", 185-402) is deleted. In "Read the rows", the Red row's "or payments have stopped because the clock reads earlier than the last sale" (EN 24-25; ES 26-28) goes. In "Just after a start" `{#clock-at-start}` (EN 381-408; ES 403-432) and "Devices as clock witnesses" `{#clock-witnesses}` (EN 491-506; ES 527-543), every sentence about the stop goes; the `clock.disagrees` warning and the clock before 28 October 2024 stay. "Sales dated wrongly" `{#sales-dated-wrongly}` (EN 432-490; ES 460-526): with Q4 yes, only PR 2's two cases stay; with Q4 no, the section goes.
  - `till-notices.md`: the "Payments stopped: the server's clock reads earlier than its last sale" notice (EN 39-50; ES "No se puede cobrar: la hora del servidor es anterior a la última venta", from line 45) goes, and the clock paragraphs after it (EN 65-93) keep only what serves PR 1b's waiting notice and the clock before 28 October 2024.
  - `backup-recovery.md`: "If the backup holds sales dated more than a minute after the box's time, the box stops taking payments once the recovery finishes…" (EN 157-159; ES 172-174) goes. PR 4's sentence in the same file is a different one and stays.
  - Every link to a deleted section moves to PR 1b's `{#clock-waiting}` or `{#clock-at-start}`, or goes.
- [ ] `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`, and `grep -rn -e 'clock-behind' -e 'earlier than its last sale' -e 'earlier than the last sale' -e 'anterior a la última venta' apps/server/src/guide` prints nothing.

## PR 6 — delete the stop's code (three tasks, each builds)

Lands with PR 5 (above). Order: 18a, 18b, 18c.

### Task 18a: the server stops calling the stop

Delete what R5's last column marks dead in `apps/server`: the stop parts of `clock-watch.ts`, `clock-start-up.ts`'s stop branch, `till-box-clock-api.ts`'s and `box-health-api.ts`'s stop admissions (keeping the misdated list and download routes if Q4 is yes), the `clock.behind_chain*` emails, reasons and the `clock.behind_chain` staff notice source. Rename `refuseWhileClockBehind` to `refuseUntilRecordable` across its callers. `fiscal.clock_drift` is hidden while waiting instead. Every caller of a seat method 18c deletes is changed here, so 18c builds; the list comes from this grep, run 2026-11-10 on the base (`grep -rnE '\b(clockBehindLatestRecord|clockStopState|openClockCheck|confirmClockStop|waitingClockCheck|closeClockCheckByItself|noteClockProvedWrong)\b' apps packages --include='*.ts'`, leaving out tests, `packages/fiscal-verifactu/src/`, the seat contract and `fiscal-none`):

- `clockBehindLatestRecord`: `bill-refunds.ts:219` (`clockStopsRefund`), `tender-refund-recovery.ts:36`, `bill-payments-loop.ts:244` (each pauses while waiting only), `boot.ts:3109` (the drift alert's "stopped" test becomes "waiting").
- `clockStopState`: `box-health.ts:145-198` (the Clock row reads the start check's state), `clock-correction.ts:86,161-162` (admission reads the start check's state and `clock.unusable`), `clock-start-up.ts:48-61`, `clock-watch.ts:54,360`, `till-box-clock-api.ts:165-167`.
- `waitingClockCheck`, `closeClockCheckByItself`: `box-health.ts:200-208`, `clock-watch.ts:59-60,295-305`.
- `openClockCheck`, `confirmClockStop`, `noteClockProvedWrong`: `clock-watch.ts:55-58,138,196-215`; `till-box-clock-api.ts:109-110,291` and `box-health-api.ts:244-245,291`. **Both route files mount nothing when the seat has no `confirmClockStop`** (`till-box-clock-api.ts:110`, `box-health-api.ts:245`), and PR 1b's waiting confirmations live in those routes, so their mount condition moves to the start check's confirmation writer before 18c deletes `confirmClockStop`.
- `misdatedRecords`, `misdatedDetail` (`box-health-api.ts:145-208`) stay if Q4 is yes.

The same grep, re-run after 18a, must print only the seat contract, `fiscal-none` and `packages/fiscal-verifactu/src/`.

Suites deleted whole: `clock-watch.anchor.test.ts` (492 lines, 12 cases), `clock-watch.elapsed.test.ts` (151, 5), `boot.clock-start-up.test.ts` (217, 2). Trimmed to their surviving cases: `clock-watch.test.ts` (876, 48), `clock-watch.correction.test.ts` (441, 17), `clock-start-up.test.ts` (183, 16), `clock-confirm.route.test.ts` (1,988, 45), `till-box-clock-api.test.ts` (1,126, 41), `clock-set.route.test.ts` (700, 22), `clock-correction.test.ts` (1,137, 69). (`zone-clock-stop-interaction.test.ts` and `clock-watch.restart.test.ts` are already gone, in Task 17b.)

### Task 18b: tills and dashboard stop showing the stop

Delete the `clock.behind_chain` notice, refusal and dialog branches in `apps/till`, and the stop rows and alert words in `apps/dashboard` (`box-status-rows.ts`, `box-status-screen.ts`'s stop branches beside PR 1b's waiting ones, `alert-messages.ts`), with the till's and dashboard's clock-stop cases. Run after 18a, so the server has stopped sending a code before its words go.

### Task 18c: the fiscal module and the seat contract

Delete the seat methods `clockBehindLatestRecord`, `clockStopState`, `openClockCheck`, `confirmClockStop`, `waitingClockCheck`, `closeClockCheckByItself`, `noteClockProvedWrong` from `packages/fiscal/src/backend.ts`, its fake and `fiscal-none`, and their Veri\*Factu implementations: `clock-behind.ts`'s comparison (keeping `latestRecord`, used by Q2(b)), `clock-checks.ts`, the stop parts of `clock-confirmation.ts`, `clock-stop-incidents.ts` and `clock-behind-alerts.ts`, and `clock-misdated.ts`'s stop path (the whole file if Q4 is no).

Suites deleted whole: `clock-behind.test.ts` (138, 7), `clock-behind.restart.test.ts` (558, 25), `clock-checks.test.ts` (718, 32), `clock-confirmation.test.ts` (1,083, 57), `clock-stop-restarts.test.ts` (96, 4); with Q4 no, also `clock-misdated.test.ts` (828, 24) and `clock-misdated-detail.test.ts` (443, 8). Trimmed: `clock-stop-incidents.test.ts` (771, 24), `clock-behind-alerts.test.ts` (133, 9; its unusable case stays), `clock-step.test.ts` (683, 23; its no-stop and `clock.corrected` blocks stay).

Documents: `conventions-data.md`'s sections "While the box's clock reads behind the latest fiscal record…" and "A confirmation of the clock lifts the stop…" become a dated pointer to this plan; then fix every claim this grep finds: `grep -rn -e 'clock-behind' -e 'behind_chain' -e 'records_misdated' -e 'behind the latest' -e 'minute ahead' -e 'minute behind' -e 'clock_checks' -e 'earlier than its last sale' -e 'earlier than the last sale' -e 'anterior a la última venta' CLAUDE.md docs/developers docs/backlog.md apps/server/src/guide` (it reaches the §4 fixture rule C6 removed, its receipt in `testing-guide.md`, and any guide sentence Task 17c missed).

- [ ] Each task: the suites of every package it touches, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/staff-notice-codes.test.ts scripts/claude-md-pointers.test.ts scripts/classification-complete.test.ts`.

## Task 19: on the test box (the lane runs the PR's part before it lands)

On the Debian 13 test box once the watcher reports it back, or a preproduction box the owner names, with `WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`. Record each command and its output in the PR description.

**PR 1a:**

1. **Every boot starts unsynchronised (R4).** Reboot. Compare `journalctl -u systemd-timesyncd -o short-iso | grep -m1 -i 'contacted\|synchroni'` with the server's first `clock_start.*` log line. **A failing reading of R4** shows the time service synchronised before the server's first look on every one of three boots.
2. **NTP blocked, AEAT reachable.** `nft add table inet a1420; nft add chain inet a1420 out '{ type filter hook output priority 0; }'; nft add rule inet a1420 out udp dport 123 drop`. Set the clock 2 days ahead (`timedatectl set-ntp false; timedatectl set-time …; timedatectl set-ntp true`), `docker compose restart app`. **Expect:** one `clock.set` in `journalctl -t waitron-box` whose requester says `start`; `date -u` within 2 s of AEAT's `Date`; the first sale dated right. Then `nft delete table inet a1420`.

**PR 1b:**

3. **No internet at all.** Unplug the WAN; restart. **Expect:** a cash sale on a till is refused with the waiting words; the signed-in till shows the notice; "The time is right" lets the next sale through. Plug the WAN back in on a second run without tapping: **expect** payments to resume by themselves within about a minute of the router being up. Time it. On a third run, with the WAN unplugged, no till signed in and the clock set 2 days ahead before the restart, an administrator uses "Check with this device's time" on Box status from a phone: **expect** one `clock.set` in `journalctl -t waitron-box` whose requester says `admin`, and the next sale taken and dated right.
4. **Flat battery** (revision 2's step 1): power off at the wall for 10 minutes with the time service stopped and the WAN unplugged; **expect** waiting at power-on, not a sale dated 10 minutes early.

**PRs 3-4:** press Make the series, block 443, press Restore backup. **Expect** the waiting line and page, `failures` unchanged over five minutes, one log line a minute, the start-failure log not grown (`wc -c` before and after); unblock and expect the restore to finish within about two minutes. Report one try's length from the log times.

**PR 5, before it is opened:** research 51.2's free preproduction test, through the verifactu library's preproduction workflow as A985 did: record A stamped now; record B chained to A, stamped three minutes before A (over the minute, inside the 240 seconds seen on a late record, so code 2004 cannot be mistaken for an ordering refusal); record C chained to B, stamped now, as the control. Record AEAT's answer to each. **If B prints an error code C does not, PR 5 does not go ahead** and Q2 goes back to the owner.

## Deliberately unchanged, and limits

- **A box confirmed by a person trades on its own clock** until the internet answers; an administrator's date confirmation can leave it hours out (owner: "the same day would be sufficient"). The research (52.1(a)) finds the file enough when only the time is wrong; a wrong date needs a corrective (52.1(b)), which Waitron cannot yet issue for every case (A1407). Q4's list is how the owner learns of either.
- **A clock confirmed hours ahead can be refused by AEAT.** A time ahead of AEAT's is accepted with warning 2004 (research 52.6), but once the box's date passes midnight before the real date does, records are refused (`1112`, "La FechaExpedicionFactura no podrá ser superior a la fecha actual", research 60.8), and after three identical refusals later records on the chain are held (`SAME_CODE_REFUSAL_LIMIT = 3`, `drain.ts:64`). The 2026-11-06 decision "AEAT refusing the latest record as too far in the future stops trading until the clock is reset" covers what follows; this plan does not change it.
- **Before PR 5**, a clock confirmed by a person that reads more than a minute behind the latest sale still meets today's stop; its existing "Check the time" and AEAT paths lift it as today. Under Q2(b) an administrator's date confirmation is refused in that state, so only a till or a device's time can lift it.
- **The record remedies are not gated** (R7): production refuses them all. A1407's entry carries the rule for the day one is switched on.
- **A clock that falls back while the box trades is no longer stopped after PR 5.** Today the stop catches a clock that slips more than a minute behind the last sale. After PR 5 the box keeps selling with the earlier time; at most the existing `fiscal.clock_drift` warning shows (`time-health.ts:104`), the start check no longer asks once the internet has confirmed (D1 row 4), and Q4's list does not cover it. A clock that drifts ahead while the box runs is not watched beyond D1 row 4 either (A798 slice 9c, backlog).
- **No tax adviser's answer is cited.** Q2 rests on research that calls itself "research for the owner, not professional advice" (`docs/compliance/research/2026-11-06-adviser-clock.md`, line 6).
- **AEAT's test covers a three-minute step on preproduction only** ("A gap of days cannot be tried this way"; "Preproduction is not production", research 51.2). PR 5 admits a time any amount earlier than the last; nothing tested shows how production AEAT answers a step of hours or days.
- **Promotion and first setup are untouched**; the restore and setup pages keep their own clock check, because a person on a page can act.
- **Nothing measured on a real box yet**: R4's timing and the router path are Task 19's.

## Changed test checks

- PR 1b: the four suites R10 found failing under the gate (`boot.backup-network.test.ts`, `promote-endpoint-e2e.test.ts`, `handover-controlled.e2e.test.ts`, `handover-stepdown.real.test.ts`) gain a start whose time is confirmed (Task 6); setup only, no assertion changes.
- PR 5: `packages/fiscal-verifactu/src/chain.clock-behind.test.ts` is deleted; `chain.earlier-time.test.ts` asserts the opposite (point 4). Every other case Tasks 17a and 17b list (R8's measured 307) is deleted, or in one case (`hour-recovery-host.test.ts`) rewritten as Task 17b says, because the behaviour it asserts is removed; each is named in the PR.
- PR 6: the suites Tasks 18a, 18b and 18c list. Any OTHER existing test that has to change is a STOP.

## Size (estimates; lines added / removed)

Production and tests counted apart. Removals come from `wc -l` and case counts of the suites named above (counted 2026-11-09 on this base): the six `clock-behind-stop.*` suites hold 2,541 lines and 59 cases; the stop-only fiscal files hold 1,327 production lines and their suites 5,216 test lines; the server's `clock-watch.ts`, `clock-start-up.ts` and `till-box-clock-api.ts` hold 919 production lines, part of which survives.

| PR | Production | Tests | Docs |
| --- | --- | --- | --- |
| **1a** internet confirms or sets the clock at start | +230 / −5 (Task 1: 90; 2: 50 with words; 3: 50; 4: 40) | +250 | +50 / −5 |
| **1b** the gate, the till and the administrator | +280 / −5 (Task 6: 60; 7: 110 with words and the administrator's two routes; 8: 110 with words and the dashboard's offer) | +520 (the gate table, about 200, replaces the 2,541 lines PR 5 deletes; the administrator's route cases about 60; the dashboard case about 20; R10's four suites' setup about 20) | +65 / −10 (the guide's new waiting section, both languages) |
| **2** list the sales a person-confirmed clock dated, and records stamped ahead of internet time (Q4) | +100 | +130 | +5 |
| **3** restore placement (Tasks 11-13, plus a 40-line pure move) | +170 / −5 | +190 | +5 / −3 |
| **4** restore waits uncounted; page names the cause (Tasks 14-16) | +190 / −5 | +230 | +30 / −10 |
| **5** two functions answer "nothing"; `chain.ts` unchanged (Q2) | +4 | +40 / about −8,500 (R8's 307 failing cases, by each suite's lines per case; the four remedy cases are now deleted, not rewritten) | +35 / about −610 (the guides about −585 of it, both languages, counted with Q4 yes) |
| **6** delete the stop's code (18a, 18b, 18c) | +40 / about −2,100 | about −3,450 (the suites deleted whole, by `wc -l`; `zone-clock-stop-interaction.test.ts`, counted here before, is PR 5's. The four fiscal suites deleted whole here also lost cases in PR 5, which both rows count, so the true total is smaller) | +30 / −200 |

PRs 1a-4 add about 970 production and 1,320 test lines. PRs 5-6 add about 44 production and 40 test lines, and remove about 2,100 production and 11,950 test lines.

## Review focus

1. No set happens while the time service is synchronised: the start check, the till's set while waiting, the restore's set (Tasks 1, 7, 13; the host refuses as well).
2. While waiting, every route in Task 6's table refuses before any card reader, refund send or drawer job, every seat writer refuses, and the two loops pause; the table exists before PR 5 deletes the stop's route suites.
3. A person's confirmation never reaches the series check (R5; Task 11 adds no read of confirmations).
4. A device alone never confirms: the till needs a staff member's tap (Task 7; Q3).
5. PR 5 changes exactly two functions (`clockBehindChain`, `clockStopState`), no line of `chain.ts` or the rest of the fiscal core, and is opened only after 51.2's test.
6. Task 18a's grep, re-run, prints only the seat contract, `fiscal-none` and the fiscal module, so 18c builds.
7. While payments wait, an administrator with no till and no internet can confirm or set the clock from their own device (R9, Task 7), and the dashboard offers it (Task 8).
8. After Task 17c, `grep` finds no description of the stop in `apps/server/src/guide/` in either language.

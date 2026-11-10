# A1420: every start confirms the box's time before it trades — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`. Keep the ledger `docs/handoffs/2026-11-09-a1420-start-clock.md` current at the end of every task.

**Revision 4 (2026-11-10).** Re-planned to the owner's answers of 2026-11-10 to Q1, Q2 and Q3, given at the desk (`waitron-campaign-shared/desk/done/20261110-0946-B-a1420-start-clock-q1.md`, `-q2.md`, `-q3.md`) and passed on in `waitron-campaign-b/questions.md` ("WATCHER 2026-11-10 14:37" and "14:52"). The owner's words are quoted under each question below. In short:

- **The start uses the box's internet time service (NTP) only. AEAT is not asked at an ordinary start.** Revision 3's "set the clock to AEAT's time" and its `clock.authority_disagreed` alert are gone.
- **Once the time service has synchronised, the box sells, however far the sync moved the clock.** The old "clock behind the last sale" stop goes (PRs 5-6), with no AEAT test first and no date-only condition.
- **With no internet**, either two tills or handhelds report times within a few seconds of the box's, and the box carries on with nobody tapping; or a person confirms the box's date and time, or corrects it. The administrator's date-only button goes.
- **At a restore, a synchronised time service stands in for AEAT** (Q1).
- Q4 and Q5 are still with the owner and are kept as revision 3 put them, adjusted only where the answers above reach them. A new question, Q6, asks about sales already stamped ahead into a later day when the time service moves the clock back.

Earlier revisions (1 to 3, with three corrections) are in this branch's history (`git log docs/a1420-start-clock-plan`); their receipts R1-R10 still hold and are kept below. Task numbers are kept from revision 3 so earlier notes still point at the right task; Tasks 5 and 13 are gone (5 folded into 9, 13 dropped with the AEAT set).

**What a person can do when this lands.**

- **PR 1.** A box that starts with no internet takes no payment and writes no fiscal record until its time is confirmed; orders still reach the kitchen. It confirms by itself once its time service reaches the internet, or once two tills or handhelds with staff signed in show the same time as the box to within 5 seconds. Otherwise staff signed in on any till or handheld see "The server's time is not confirmed yet" and use "Check the time", which confirms the box's time or sets it from the till's; an administrator can confirm the date and time on Box status, or use "Check with this device's time" there.
- **PR 2** (if Q4 is yes). When the time service later moves a clock that a person or two devices confirmed by more than a minute, the bell names the sales recorded meanwhile, with the list on Box status; and sales the box had stamped ahead of internet time are listed the same way.
- **PR 3.** A restore on a box whose time service is synchronised names its series without asking AEAT.
- **PR 4.** A restore that can reach neither its time service nor AEAT waits and retries every minute without bringing up the start-failure page; when that page does show because the clock moved during the check, it says so.
- **PR 5.** A sale is never refused because the clock reads earlier than the last sale.
- **PR 6.** The old stop's code is gone from the server, tills, dashboard and fiscal module.

**Base:** `1252e2b6b3`, this branch's merge base with main. Line numbers are on that commit; on later main some sit a few lines higher (`nodeBackend` is `boot.ts:2074` here, `:2071` on `049ddd9db9`, `:2070` on `9e497a0a7f`), so match by name.

**Review weight: FULL, every PR.** Risk triggers: the clock in front of fiscal records and series naming (a fiscal invariant), a cross-package contract (`ModuleOperationHost`, PR 3), and what the chain's append refuses (PR 5). The plan gets a fresh-context review before any implementer is dispatched; each PR's `/finish-branch` runs the Codex run-it seat twice (the second sets this checklist aside). Every PR **waits for the owner** to land it.

## Words used in this plan

- **Time service / synchronised**: the host's own internet time keeper (systemd-timesyncd or chrony) and the `NTPSynchronized` flag the host service reads with `timedatectl show` (`deploy/box/waitron-box.sh:59-62,93`). The time service sets the clock itself; Waitron only reads the flag.
- **Host service**: the small root program outside Waitron's container that can set the clock (`deploy/box/waitron-box.sh`), asked through `apps/server/src/box-host-client.ts`, which waits up to 2 s for a status (`DEFAULT_STATUS_MS`, `:43`) and 20 s for a set (`DEFAULT_SET_MS`, `:45`). It refuses to set while synchronised (`waitron-box.sh:118-121`).
- **AEAT's time**: the `Date` header of a reply from AEAT's servers over a checked HTTPS connection, read by `readAuthorityTime` (`packages/fiscal-verifactu/src/authority-time.ts`, 5-second limit). AEAT has no time service of its own; this header is the only reading (the desk's check, WATCHER 14:52). After revision 4 it is used only by the restore's series check, as today, and by the old stop until PR 6.
- **Device readings**: the clock each enrolled till or handheld sends with every equipment read (R11).
- **The seat**: the fiscal module's one `FiscalBackend` object, built once in boot (`nodeBackend`, `apps/server/src/boot.ts:2074`) and handed to every route and loop. Every fiscal record is written by one of its four writers, `recordSale`, `recordVoid`, `recordCorrection`, `recordSubstitution` (`packages/fiscal-verifactu/src/backend.ts:305,431,504,609`); the only other callers of the chain's append are the record remedies, which production switches off (R7).
- **The start check** (new): each start's decision on whether its time is confirmed. Its state is **waiting** (nothing has confirmed it), **by devices** (two devices agreed), **by a person** (a till or administrator confirmed or corrected it), or **by the internet** (the time service is synchronised). "By devices" and "by a person" trade and keep listening for the time service; "by the internet" is final for the process.
- **The stop** (today; its behaviour ends in PR 5, its code in PR 6): while the clock reads more than a minute before the latest fiscal record, no record is written and no money moves (`refuseWhileClockBehind`, `packages/fiscal-verifactu/src/clock-behind.ts:167-175`).
- **The series check**: naming a new invoice series at setup, restore or promotion needs a second clock within 30 seconds of the box's (`compareHourClocks`, `packages/fiscal-verifactu/src/hour-clock.ts:63`, `AGREEMENT_MS` at `:39`).

## Global constraints

- **No table, column, index, trigger, migration or schema-file change.** The A1308 hold was lifted on 2026-11-07, but none is needed: `clock_confirmations` already accepts reason `start` with sources `devices`, `staff` and `admin`, and requires a person exactly for `staff` and `admin` (`packages/fiscal-verifactu/src/schema/clock-confirmations.ts:7-20,62-65`). The stop's tables stay, unwritten, after PR 6. If a step seems to need a schema change, stop and report.
- **The fiscal core is untouched in every PR**: `computeHuella`, the chain (`chain.ts`), numbering, `registros_facturacion` and its triggers, the alta builders, `allocation.ts`, `hour-selection.ts`. **PR 5 changes what the chain's append refuses without editing it**: `attemptAppend` (`chain.ts:158`) asks `refuseWhileClockBehind`, which asks `clockBehindChain`, and PR 5 makes that function and `clockStopState` answer null (R8). After every task touching `packages/fiscal-verifactu`, this passes **unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts inmutabilidad`.
- **Clock sources (the owner's rule, 2026-11-10).** The time service confirms. Two devices agreeing with the box confirm it and set nothing. A person confirms or corrects; a correction is a set through the host service from the till's time or the administrator's own device, never while synchronised. AEAT never sets the clock at a start. The old stop's AEAT set stays, unreached after PR 5, until PR 6 deletes it.
- **The series check is untouched except for Q1.** No device, till or administrator confirmation is ever read by it (R5).
- **A test that has to be edited to pass is a STOP** unless "Changed test checks" lists it.
- **User-visible words** are only those in "Words"; English and Spanish change together.
- **Real events only** (owner, 2026-11-08). Each branch names the venue event that reaches it.
- **Tests.** Each property has one owner layer. The host's and the time service's own failure modes are already tested where they are read (`box-host-client.test.ts`); a start is tested only for what it does with each answer. A "did NOT happen" assertion runs to a stated end point and has a control in which the same fake forces the effect. Reuse `ephemeralServerFixture`, `setupVenue`, `insertFiscalRegistro`, `deviceCookieForTest`, `provisionBillVenue`, `createClockWitnessStore`, and the fake host in `boot.clock-watch.test.ts:166-182`.
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
- Today's start-failure words for `sif.allocation_invalid` already say "It checks its time against the internet first. Connect the box to the internet, then press “Retry a normal boot”." (`apps/server/src/i18n/recovery-page.ts:286-298`), chosen by code alone.

### R3. The server serves tills while it is not trading (RUN, 2026-11-09)

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

- **Most of the person's path exists.** While today's stop holds, the server is fully up: an enrolled till reads its notices, staff sign in by PIN, "Check the time" is offered, and one confirm set the box's clock from the till's time through the host and sales resumed. Sending an order to the kitchen is not among the stop's checks (read, not run: the list in `conventions-data.md`, "Where a route's named check goes", names only payment, refund and invoice routes).
- **What the person sees.** The till shows notices only on its signed-in screens and clears them at sign-out (`apps/till/src/till-app.ts:18666-18669`), so the PIN screen shows nothing; after sign-in the line reads "Payments stopped: the server's clock reads earlier than its last sale" with "Check the time" (`apps/till/src/i18n/strings.ts:1897-1906`). The dialog shows both clocks ("The server's clock says {box}. This device says {till}.") and offers "Use this time" or "The time is right" (`strings.ts:1909-1918`). PR 1 gives the line new words for the waiting state and reuses the dialog unchanged: it is how a person confirms the date and time, or corrects them.
- **The gap.** A clock 2 days ahead or 10 minutes slow triggers none of it today: no notice, the challenge is refused `not_stopped`, sales are taken. The start check's "waiting" state opens this path (PR 1).
- **A till or handheld already paired** is what connects. A new one cannot pair without an administrator: each start opens the pairing window shut (`apps/server/src/boot.ts`, "a restart or a promotion starts SHUT"). Read, not run.
- **At a restore's placement no till can help**: the server that serves tills starts only after placement (R2), and no device or person confirmation satisfies the series check (R5).

### R4. Why a box can be online and still not be synchronised (read, not run)

- **Waitron installs no time service.** `waitron.sh install` only runs `timedatectl set-ntp true` (`deploy/waitron.sh:325-328`); if that fails, or no time service is installed, it prints a line and carries on. The dashboard already raises `clock.sync_off` with `off`, `stopped` or `unsynchronised` (`apps/server/src/clock-sync-alert.ts`).
- **Every boot starts unsynchronised.** The flag turns "yes" only after the time service's first successful exchange. The app's container starts as soon as Docker does, so the start's first look can come first. After a power cut the venue's router usually comes back after the box, so for the first minute or more the time service cannot answer. This is the common case, and it is why the start check keeps listening and confirms by itself. Task 19 measures it on the test box.
- **The venue's network blocks the time protocol.** NTP uses UDP port 123 (timedatectl(1)'s own example: "Using Time Server 216.239.38.15:123"). A shared, guest, hotel or shopping-centre network that lets only web traffic out never lets the time service synchronise. Under the owner's rule such a box waits at every start for two devices or a person (see "Limits"); `clock.sync_off` already tells the administrator the time service is not synchronised. Task 19 blocks UDP 123 on the test box to show what the start does.

### R5. Who uses the stop today, and what each does after this plan (read; two claims checked)

A read-only trace of every consumer, 2026-11-09. Checked by me: `hour-clock.ts`, `hour-selection.ts`, `hour-setup-clock.ts` and `hosted-hour-recovery.ts` contain no reference to confirmations (`grep -n 'clock-confirmation\|clockConfirm'` printed nothing, exit 1), so **no device, till or administrator confirmation can ever let a series be named**; the series check's second clock is AEAT or, during setup, the setup page's own browser (`hour-setup-clock.ts:103-124`). And `SAME_CODE_REFUSAL_LIMIT = 3` (`fiscal-verifactu/src/drain.ts:64`).

**The stop cannot be switched off at one point.** `clockStopState`'s judge compares the clock with the latest record itself (`packages/fiscal-verifactu/src/clock-confirmation.ts:63-67`) and then asks `clockBehindChain` whether a confirmation covers it (`:75`). Making only `clockBehindChain` answer "not behind" would read every behind clock as confirmed, then fail on a missing confirmation row (`:102`). So PR 5 makes both `clockBehindChain` (`clock-behind.ts:147`) and `clockStopState` (`clock-confirmation.ts:107`) answer null. That reaches every reader, including two that bypass the seat: the staff notice (`staff-notices.ts:27`) and the bell alert (`clock-behind-alerts.ts:25`) call `clockBehindChain` directly (R8). PR 6 then deletes the callers and the code.

| Consumer | Where | Today | After PR 1 | After PR 5 | After PR 6 |
| --- | --- | --- | --- | --- | --- |
| The chain's append | `fiscal-verifactu/src/chain.ts:158` | refuses a record more than a minute before the latest | unchanged | refuses only a time before 28-10-2024 (`refuseBeforeFirstIssueDate`, `first-issue-date.ts:15-24`); `chain.ts` unchanged (R8) | same |
| The seat's four writers | `backend.ts:305,431,504,609` | write through the append | refuse `clock.unconfirmed` while waiting (wrapper in boot) | same | same |
| Route checks: till sales, bill payments and refunds, tender refunds and retry, unpaid departure, eight dashboard resolutions | `till-sale.ts:720,1180,2246`; `bill-payments.ts:1141`; `bill-refunds.ts:216,685,698`; `tender-refunds.ts:93,98`; `tender-refund-api.ts:262`; `unpaid-departure.ts:102`; `payments-api.ts:368-369` | call the seat's `refuseWhileClockBehind` | refuse `clock.unconfirmed` first while waiting (wrapper in boot) | waiting or before 28-10-2024 only | same, renamed `refuseUntilRecordable` |
| Refund recovery loops; a card refund's re-check after a provider wait | `tender-refund-recovery.ts:36`; `bill-payments-loop.ts:244`; `clockStopsRefund`, `bill-refunds.ts:209-220` | pause during the stop | also pause while waiting | pause only while waiting | same |
| Clock watch | `apps/server/src/clock-watch.ts` | opens checks, sets from AEAT, confirms, all inside a stop | also re-reads the time service and the device readings while the start is not confirmed by the internet | its stop part sees no stop | stop part deleted, with its AEAT set |
| Correction's admission | `clock-correction.ts:143-169,221-229` | sets only inside a stop | also admits reason `start` from a staff member or administrator while the start is not confirmed by the internet | same | only reason `start`, or `clock.unusable` |
| "Check the time" (staff) and the start-up window | `till-box-clock-api.ts:158-370`; `clock-start-up.ts` | offered during a stop found at start-up, after AEAT failed | also while waiting, at once | only while waiting, or `clock.unusable` | stop branches deleted |
| Administrator's confirm and set ("Check with this device's time") | `box-health-api.ts:258-371`; the dashboard's offer, `box-status-screen.ts:452-459,1217-1231` | inside a stop only: without one, confirm refuses `not_stopped` (`:307`) and set, sent as reason `behind_chain` (`:343`), is refused `not_stopped` by the correction (`clock-correction.ts:226`) (R9) | also while waiting: confirm writes a `start`/`admin` row, set is sent as reason `start`; either moves the start check to by a person (Task 7); the dashboard offers the button while waiting (Task 8) | same | stop branches deleted; both admitted only while the start is not confirmed by the internet, or under `clock.unusable` |
| Device readings | `clock-witnesses.ts`; `agreeingDeviceGroup`, `packages/fiscal/src/clock-witnesses.ts:116` | lift the stop at a 60 s margin | also confirm a waiting start at a 5 s margin (Task 1) | stop use never reached | the 60 s stop use deleted |
| Clock checks, confirmations covering a step back, disproofs | `clock-checks.ts`, `clock-confirmation.ts`, `clock-stop-incidents.ts` | exist only for the stop | unchanged | never reached | deleted; tables stay, unwritten |
| The misdated-sales list, its download and `clock.records_misdated` | `clock-misdated.ts`, `box-health-api.ts:149-200` | listed after a stop's closing | unchanged | not reached by the stop | Q4 yes: kept, fed by PR 2. Q4 no: deleted |
| Alerts, emails and till/dashboard words for `clock.behind_chain`, `_restarted`, `_disproved` | `clock-behind-alerts.ts`, `box-alert-email.ts`, `staff-notices.ts`, till `pay-refusal.ts`, dashboard `box-status-rows.ts`, `alert-messages.ts` | shown and emailed | unchanged | never raised | deleted |
| `fiscal.clock_drift` hidden during the stop | `boot.ts:3106-3112`, `time-health.ts:91-112` | hidden while stopped | unchanged | never hidden | hidden while waiting instead |
| Survives untouched | `clock.unusable`, `clock.corrected`, `latestClockStep` (backup hold, `backup-sweep.ts:205`), `clock.disagrees`, `clock.sync_off`, challenges | | | | |

### R6. The gate must sit on both the route check and the seat's writers (RUN, 2026-11-09)

**Harness.** A throwaway file, `apps/server/src/probe-a1420-seat-gate.test.ts` (moved out of the tree after the run). `provisionBillVenue`'s venue (its app uses one seat object, as boot's does), with the seat's `refuseWhileClockBehind` and its four writers wrapped in place, as PR 1's boot wrapper would; each wrapper logs its call and, when its flag is on, throws a stand-in refusal (`clock.unusable`). Then a cash sale (`POST /api/sales`) and a card sale (`POST /api/pay`) under each arrangement.

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

**What it means.** Wrapping the seat's writers holds every record, including paths with no route check (`cancel-credit.ts:68` writes a correction through `recordCorrection`), and the sale's whole transaction rolls back. But alone it charges the card first and answers `507`. The route check stops money before the reader. Both wrappers go in PR 1, at one place in boot.

### R7. The record remedies cannot write in production (RUN, 2026-11-09)

The administrator remedies (`packages/fiscal-verifactu/src/record-remedy.ts:194`, `record-remedy-absent.ts:130`) call `appendToChain` directly, past the seat's writers. Production mounts them with the default set of enabled remedies, which is empty (`record-remedy-routes.ts:20,46`, mounted at `routes.ts:26`), so every remedy is refused `fiscal.remedy_disabled` before it writes.

- Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/record-remedy-corrective-http.test.ts -t "keeps the default production policy closed"` → `Tests 1 passed`.
- Control: with the default set changed to `new Set(["corrective-invoice"])` and the same command → `AssertionError: expected 200 to be 409`, `Tests 1 failed`: the remedy wrote. The file was restored (`git checkout --`; `git status --short` printed nothing).

So no remedy is gated in this plan (real events only). The A1407 backlog entry, which is what will switch a remedy on, gains one clause: an enabled remedy takes the start gate first.

### R8. Two functions answering "nothing" end the stop everywhere, with `chain.ts` unchanged (RUN, 2026-11-10)

**Harness.** A throwaway worktree (`git worktree add --detach` in `mktemp -d`, on this branch's code, removed afterwards). In it, `clockBehindChain` (`clock-behind.ts:147`) and `clockStopState` (`clock-confirmation.ts:107`) each got `return null` as their first statement; `git diff --stat -- packages/fiscal-verifactu/src/chain.ts` printed nothing.

**Stated before running.** If this ends the stop everywhere, `chain.clock-behind.test.ts` fails because the append now writes the earlier record, and the "behind" cases of `staff-notices.test.ts` and `clock-behind-alerts.test.ts` fail because nothing is reported. If those pass, the notice and alert still bypass the change.

- `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node` → `Test Files 16 failed | 224 passed (240)`, `Tests 161 failed | 5296 passed (5457)`. Among them: `chain.clock-behind.test.ts > … refuses a sale a day behind the last record and writes nothing` → `AssertionError: promise resolved "{ …(2) }" instead of rejecting` (the record was written); `staff-notices.test.ts > … a reading more than a minute before the latest record shows the stop` failed; `clock-behind-alerts.test.ts > … raises one error while the clock reads more than a minute before the latest record` failed.
- The 34 server suites that name the stop (`grep -l -E 'behind_chain|clockBehind|clockStopState|records_misdated|clock_checks|confirmClockStop|clock-behind|behind the chain' src/*.test.ts`), in three runs: 15 files and 146 cases failed; the other 19 passed (530 cases in the last batch alone). `hour-recovery-host.test.ts`, which the scan does not match, was run on its own: 1 failed of 37.

So PR 5 takes this route. Not run: the rest of `apps/server`, `apps/till` and `apps/dashboard` (PR 5 changes no code they import beyond the seat's answers); a failure there is a STOP. Every failing suite is in Tasks 17a and 17b.

### R9. Without a stop, an administrator can neither confirm nor set the clock (read; two cases run, 2026-11-10)

Read on `d4a9aea323`, whose code is the base's:

- `POST /api/box/clock-confirm` asks the seat's `confirmClockStop`, and when it answers no confirmation the route throws `clock.confirm_refused` with reason `not_stopped` (`apps/server/src/box-health-api.ts:307`).
- `POST /api/box/clock-set` always sends reason `behind_chain` unless the clock reads before 28-10-2024 (`box-health-api.ts:343`). The correction's admission then judges the stop (`clock-correction.ts:143-169`) and answers `not_stopped` when there is none (`clock-correction.ts:226`), which the route turns into `clock.set_refused` (`box-health-api.ts:361,384-391`).
- The dashboard offers the button only during a stop or `clock.unusable` (`#canSetClock` and `settableStop`, `apps/dashboard/src/screens/box-status-screen.ts:452-459,1226-1231`).

Run in a throwaway worktree: `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/clock-set.route.test.ts src/clock-confirm.route.test.ts -t "refuses a set with no stop|refuses a confirmation with no stop and no check waiting"` → `Tests 2 passed | 65 skipped (67)`. Those cases put the clock at the latest record's time; a clock two days ahead is also "no stop" by the same comparison (`clock-confirmation.ts:63-67`; R3's AHEAD row shows the till's route refusing `not_stopped` for exactly that clock). So Task 7 opens both routes while waiting.

### R10. PR 1's gate at boot breaks four existing server suites (RUN, 2026-11-10)

**Harness.** A throwaway worktree (`git worktree add --detach` under `mktemp -d`, on this branch's head; removed afterwards). In `bootServer`, straight after the seat is built (`boot.ts:2074`), a stand-in for PR 1's gate: at a start where `filesRecords()` is true, ask the host's `clockStatus` (the test's fake host, else the real client); unless it answers available and synchronised, replace the seat's `refuseWhileClockBehind` and its four writers with a function that throws a stand-in refusal (`clock.unusable`), for the life of the process. This is an upper bound: nothing ever lifts the stand-in, where PR 1 would confirm on the time service, two devices or a person. The patch is kept at `waitron-campaign-b/receipts/a1420-start-gate-probe-20261110.patch`. Under revision 4 the stand-in is close to the real decision at start: PR 1 also asks only the time service there.

**Stated before running.** If the gate reached no existing test, every suite passes; a suite that starts a filing server and then sells fails with `409 clock.unusable`. The control is the same suites with the patch taken out, which must pass, or a failure cannot be put down to the gate.

Suites: the 102 files under `apps/server/src` that name `bootServer`, `startServer`, `ephemeralServerFixture` or `runEntry` (the gate lives in boot, so nothing else can meet it; `apps/till`, `apps/dashboard` and `packages/fiscal-verifactu` start no server). Command: `env -u AI_AGENT -u CLAUDECODE A1420_PROBE_LOG=1 TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run <the 102 files>` in `apps/server` → `Test Files 4 failed | 98 passed (102)`, `Tests 9 failed | 1346 passed | 37 skipped (1392)`; the stand-in printed `waiting=true` 85 times and `waiting=false` never.

- `boot.backup-network.test.ts`: 8 of 8 failed, each at `expect(sale.status, …).toBe(200)` (`:236`) with `{"error":{"code":"clock.unusable",…}}: expected 409 to be 200`.
- `promote-endpoint-e2e.test.ts`: 1 of 6 ("restart into primary; sells + chains on its own reserved SIF"), `expected 409 to be 200` at `:516`.
- `handover-controlled.e2e.test.ts`: its shared setup failed (`clock.unusable … expected 409 to be 200` at `:842`), so its 32 cases were skipped.
- `handover-stepdown.real.test.ts`: its setup failed (`expected [] to have a length of 1 but got +0`), so its 5 cases were skipped.

Control, patch removed, the same four files → `Test Files 4 passed (4)`, `Tests 51 passed (51)`.

**What it means.** PR 1 must give those four suites a start whose time is confirmed: a fake host answering synchronised, through `StartServerSeams.boxHost` (`boot.ts:979`) ("Changed test checks" lists them).

### R11. Every signed-in till and handheld already reports its clock to the box (read, not run, 2026-11-10)

- Each `GET /api/device/equipment` carries the device's clock in a header; the route notes it, with the box's wall and steady clocks at arrival, unless the request comes from the box itself (`apps/server/src/device-api.ts:430-438`).
- The till reads its equipment every 15 s (`apps/till/src/state/equipment-poll.ts:4`), from sign-in to sign-out (`till-app.ts:5686`, `:18705`). So a device reports while staff are signed in on it; the PIN screen alone may not (read, not run).
- The store keeps each device's latest reading for five minutes by the steady clock, and drops it if the wall clock stepped since (`apps/server/src/clock-witnesses.ts:5-6,62-68`).
- `agreeingDeviceGroup` (`packages/fiscal/src/clock-witnesses.ts:116-119`) returns the largest group of two or more devices, one per network address, each agreeing with the box and with each other, today within `CLOCK_WITNESS_MARGIN_MS` = 60 s (`:1`). Devices at one address count as one.
- `clock_confirmations` accepts source `devices` with reason `start` and no person (see "Global constraints").

So "two devices connect and show their time is within a few seconds of ours" needs one new margin and a call at each watch look; nothing on the till changes. PR 1 uses 5 s ("a few seconds", owner 2026-11-10); the 60 s margin stays for the stop until PR 6.

### R12. What AEAT does with a record dated ahead, and with one earlier than the record before it (read; facts the desk checked, 2026-11-10)

- **Issue date ahead of AEAT's date: refused.** «La FechaExpedicionFactura no podrá ser superior a la fecha actual», code `1112`, a rejection (research `2026-11-06-adviser-clock.md`, 60.8; `verifactu-findings.md:339-341`). Developer FAQ §17: such a record «no figuraría jamás en los sistemas de la AEAT». Its remedy is a corrective invoice naming it, issued at once, the original needing nothing more (FAQ §17 case 2.a, research 60.8's same-day correction); AEAT's test service took an R1 naming a refused invoice as `Correcto` (2026-10-05, verifactu run 37286368370, mode `rejected-invoice-credit`).
- **Generation time ahead of AEAT's clock on the same day: accepted with warning `2004`** beyond 240 s (`verifactu-findings.md:152-195`).
- **What Waitron does after refusals** (read, not run): each refusal opens a filing case; after `SAME_CODE_REFUSAL_LIMIT` (three) refusals in a row with one code, the chain's next never-sent records are held and the first held is sent again hourly; the hold lifts once a send breaks the run (`packages/fiscal-verifactu/src/drain.ts:59-64`). The administrator already gets `fiscal.refusals_repeated` for such a hold (`submission-alerts.ts:79-147`).
- **A record stamped earlier than the record before it.** The chain is sent in the order records were made (`drain.ts` orders by `secuencia` within a chain; research 51.1: «en el mismo orden secuencial en el que hayan sido generados»). The previous-record block carries no time, only NIF, number, issue date and fingerprint, and AEAT's error list has no code comparing a record's time with the previous one's (research 51.2). No AEAT run has tried it; the owner judged the proposed test not worth running (Q2's answer).
- **"How old does an invoice have to be to be marked as old?"** (the owner's question in Q2's answer). Not by age. The box marks the records it sends while a technical failure has stopped sending (`technicalIncidentToken`, `drain.ts:317-324`), which sets `Incidencia="S"` in the message header (art. 16.4). Late records are accepted with no deadline (`verifactu-findings.md`, "Unplanned outage"). On AEAT's preproduction service, unmarked records sent over 5 minutes late came back `2004`, and a marked one sent 6 minutes late came back `Correcto` (`verifactu-findings.md` §18; production not tested).

## Decisions

**D1. The start check, at every start of a filing primary** (`filesRecords()`), in `bootServer` after the correction exists (`boot.ts:2303`) and before the trading listener binds (`boot.ts:3611`). A box that does not file records (demo, preproduction without test submissions) starts confirmed, as today. Order:

| # | Asked | Answer | What the box does | Who sees what |
| --- | --- | --- | --- | --- |
| 1 | Time service (a fresh `clockStatus`, not the one-minute cache) | synchronised | confirmed **by the internet**; no row, a log line | nothing |
| 2 | — | not synchronised, or the host does not answer | **waiting**: the listener opens; orders still reach the kitchen; no record and no money | staff on any signed-in till: the waiting notice with "Check the time"; administrators: the bell alert `clock.unconfirmed` and the Box status row |
| 3a | device readings, at each watch look | two or more devices at different addresses, each within 5 s of the box and of each other (R11) | confirmed **by devices**: one `start`/`devices` row with `stepMs` 0, the readings in its proof; sets nothing | the notice and alert clear |
| 3b | a staff member's "Check the time" | the till's time | "The time is right", or the till within a minute: confirmed **by a person** (no set). "Use this time": sets the box from the till's time through the host, then confirmed by a person | existing dialog words; a set raises `clock.corrected` and its email |
| 3c | an administrator, on Box status | "The date and time are right", or the existing "Check with this device's time" | confirmed **by a person**. The first sets nothing. The device's time within a minute confirms through `/api/box/clock-confirm` (no set); further out, it sets the box through `/api/box/clock-set` with reason `start` and source `admin`, then confirms (R9) | a set raises `clock.corrected` and its email |
| 4 | while not confirmed by the internet | the watch, every 15 s, reads the time service fresh | synchronised: confirmed **by the internet**, and it stops asking. If the time service stepped a clock confirmed by devices or a person by more than a minute, PR 2 names the sales | the notice and alert clear |

There is no timer between the routes: devices, staff and administrators are all accepted from the first moment of waiting, and the time service coming back confirms by itself. A power cut whose router returns a minute later then needs nobody. Once synchronised, the box trades however far the sync moved the clock (owner, 2026-11-10); until PR 5, a clock the sync moved more than a minute behind the latest record still meets today's stop, which its existing paths lift.

**D2. Waits.** At the start: one `clockStatus` of at most 2 s (`DEFAULT_STATUS_MS`) before the listener binds; AEAT is not asked. The watch keeps its 15 s look. A host that does not answer counts as not synchronised.

**D3. The state is in memory, per process.** Each start begins waiting; nothing is stored about it except the confirmation rows (`clock_confirmations`, reason `start`, sources `devices`, `staff` or `admin`, `step_ms` 0 when nothing was set, proof carrying the chain heads at that moment, the device readings for `devices` and `{ "asShown": true }` for the administrator's "The date and time are right"). Confirmation by the time service writes a log line, not a row.

**D4. Where the gate holds (R6).** In `boot.ts`, the one seat object is wrapped twice while the start check waits: its `refuseWhileClockBehind` throws `clock.unconfirmed` (409, no params) so every route R5 lists refuses before any card reader, refund send or drawer job; and its four writers throw the same, so no fiscal record is written by any path. The two refund loops and `clockStopsRefund` pause while waiting. A card already charged when a writer refuses is answered as today's stop answers it (`507 sale.charged_not_recorded`, new reason `clock_unconfirmed`). The Stripe webhook still stores a payment whose money has moved without writing a record (§5: "Still store money already moved"); it is recorded by the bill-payments loop once confirmed.

**D5. The restore (PRs 3-4).** Placement names a series only on the series check. Synchronised: placement proceeds without asking AEAT (Q1). Not synchronised: today's check (AEAT within 30 s); AEAT unreachable (`network` or `timeout`): the restore waits, retrying every 60 s, uncounted, until the time service synchronises or AEAT answers; AEAT more than 30 s out: the start counts as today, with today's words, which already say to connect the box to the internet (R2). Nothing sets the clock at a restore. After placement the started server runs D1 like any start. **Revision 3 also raised `clock.authority_disagreed` when a synchronised box's AEAT reading differed by over 30 s (owner, 2026-11-07); revision 4 drops it with the AEAT reading, reading the owner's 2026-11-10 "we rely on NTP only, we don't bother about AEAT" as replacing it.** The watcher can restore it (about 30 lines, one AEAT ask per restore) if that reading is wrong.

**D6. The start-failure page chooses words by code and cause (PR 4)** (owner, 2026-11-07, option A of A1385's question 2, as `queue.md` records it): `recovery.json` gains `lastErrorCause` from a closed set (`clock_moved`), kept on read only when a member (as `holderKind` is). Any other `sif.allocation_invalid` reason keeps #2532's words.

**D7. Waiting tries do not grow the start-failure log (PR 4).** A start taken back as waiting writes one line to the server log (`server.start_waiting_for_internet_clock`, with the `internet` reason) and nothing to the file the recovery page reads its tail from.

## Owner questions

**Q1. At a restore, may a synchronised time service stand in for AEAT when AEAT cannot be reached? ANSWERED 2026-11-10: yes.** Owner's words: "Yes, time service stands in (Recommended)". PR 3 builds it; C4 below takes the "yes" wording.

**Q2. May a sale's time be earlier than the last sale's? ANSWERED 2026-11-10, in the owner's own words (which also answer Q3):**

> "The AEAT check won't work. If we have a long outage we could send invoices from days ago and AEAT will accept them, but i think they should be marked as old because of an outage. How old does an invoice have to be the require being marked as old?
>
> But either way, AEAT won't refuse them for being old, which means the test fails. I think it might refuse them for being too far in the future? But perhaps that requires a different day? We've tested all this in the Verifactu package. Check there for the answers.
>
> So if this was how you were planning on checking the AEAT time then I think it is flawed. I thought there was some API to ask AEAT for its current time. In this case, we rely on NTP only, we don't bother about AEAT.
>
> And if we successfully sync the clock using ntp then we continue to sell, it doesn't matter how much the clock changes.
>
> If we are not on the internet then we either wait for two devices (eg till and or handheld) to connect and to show that their time is within a few seconds of our time, in which case we accept the current time as correct and continue. Or we stop and ask a user to confirm that our current date+time is correct (or we ask them to correct it), then we continue."

What it decides here: yes, with neither of revision 3's conditions. PR 5 needs no AEAT test first, and there is no date-only confirmation to refuse. The owner's questions are answered from the Verifactu findings in R12: AEAT refuses a record dated a later day than its own (`1112`) and only warns on a time ahead on the same day (`2004`); "old" is marked not by age but when a technical failure stopped sending.

**Q3. Does a device confirm by itself? ANSWERED 2026-11-10 (the words above):** two devices whose times are within a few seconds of the box's confirm it with nobody tapping (D1 row 3a, 5 s); otherwise a person confirms the date and time or corrects them (rows 3b, 3c). A single device never confirms alone, and devices never set the clock.

**Q4. Should the box still list sales recorded with a wrong time? STILL WITH THE OWNER.** Your decision of 2026-11-06 (`docs/backlog/box.md:1595`) says records dated in the future beyond the margin "are flagged for correction", and `:1596` that misdated sales have a remedy (A1407). The research says a wrong time alone needs only the file kept (52.1(a)), but a wrong **date** needs a corrective invoice (52.1(b)). Today the list is made when the old stop ends; removing the stop (PR 6) would leave nothing that makes it. Example: the router is dead after a power cut, a waiter taps "The time is right" at 09:00 on a till whose own clock is as wrong as the box's, three hours ahead, and the internet returns at 14:00 and the time service sets the clock back three hours. *Recommended default: keep the list for that case.* When the time service later moves a clock that devices or a person confirmed by more than a minute, the bell alert names how many sales were recorded since that confirmation, from when to when, and the existing list and download on Box status show them, so you can take the wrong-date ones to your tax adviser (PR 2, reusing `clock-misdated.ts`). The same PR keeps the other case today's list covers, the one your 2026-11-06 decision names: when the time service first synchronises after a start and the latest record is more than a minute ahead of the synchronised time, the alert names the records dated after that time (PR 2 in all is about 100 production and 130 test lines). *Alternative:* no list; the `clock.corrected` alert alone says the clock moved and by how much, and records already stamped in the future are no longer flagged, which drops part of the 2026-11-06 decision.

**Q5. While payments wait for the time to be confirmed, do orders still reach the kitchen? STILL WITH THE OWNER.** You said the time is confirmed "before we trade". Example: after a power cut with the router dead, a waiter takes a table's order on a handheld before anyone has tapped "Check the time". *Recommended default: yes.* An order sent to the kitchen writes no fiscal record and moves no money, so its time does not matter to the tax agency; only taking payment and issuing invoices wait, and the first payment attempt shows staff the "Check the time" button. *Alternative:* the till refuses sending orders too until the time is confirmed. That holds the kitchen for as long as nobody taps, and adds a check to every order route (about 40 lines, and the order routes' tests).

**Q6 (new, for the watcher to put to the owner). When the time service moves the clock back past midnight, what happens to the sales already stamped with the later day?** Example: the router is dead after a power cut; at 22:00 a waiter taps "The time is right" on a till whose own clock, like the box's, reads 03:00 the next day; the box takes ten sales stamped with tomorrow's date; at 23:30 the internet returns and the time service sets the clock back five hours. What happens, by R12 (read, not run): each of those ten is refused by AEAT when sent (`1112`, date later than today). After three refusals in a row, later records on that chain wait, retried hourly, and you get the existing "refusals repeated" alert; sales after 23:30 are still taken, but their filing waits until the real date reaches the stamped date (here, after midnight) or the held records are dealt with. The ten refused sales need a corrective invoice each (FAQ §17), which Waitron cannot yet issue for every case (A1407); Q4's list names them. The sales made after the sync carry times earlier than the last refused one; nothing in Waitron refuses that after PR 5, and nothing published at AEAT refuses it (R12). How it is reached: only if a person confirms a wrong date beside a till showing the same wrong date (two devices a day out and within 5 s of the box is not a real event), since the box takes no payment on an unconfirmed time. *Recommended default: accept it as it is, no new code.* It needs a person's mistake on two wrong clocks, trading never stops, filing catches up by itself within the clock's lead, and the existing alerts plus Q4's list tell you what to take to your adviser. *Alternative:* when the time service first synchronises and the latest record carries a later date than today's, raise a bell alert naming the date the held filing will resume and the records to correct (about 40 production and 50 test lines, in PR 2).

## Words

| Where | English | Spanish |
| --- | --- | --- |
| Till staff notice `clock.unconfirmed` (`apps/till/src/i18n/strings.ts`, `codes.ts`), PR 1 | The server's time is not confirmed yet. Payments wait until it is. | La hora del servidor aún no está confirmada. Los cobros esperan hasta que lo esté. |
| Same, hint | the existing "Check the time" (`staff_notice.check_time`; `CHECKABLE` gains the code) | «Comprobar la hora» (unchanged) |
| Till payment refusal `sale.clock_unconfirmed`, PR 1 | Payment not recorded: the server's time is not confirmed yet. The order stays open. Use “Check the time” at the top of the screen. | Cobro no registrado: la hora del servidor aún no está confirmada. El pedido sigue abierto. Usa «Comprobar la hora» en la parte superior de la pantalla. |
| Till card charged but refused, `sale.charged_clock_unconfirmed`, PR 1 | Card charged, but the payment is not recorded: the server's time is not confirmed yet. Don't charge again. Once it is confirmed, try this payment again: it is recorded without charging again. | Tarjeta cobrada, pero el cobro no está registrado: la hora del servidor aún no está confirmada. No cobres otra vez. Cuando esté confirmada, vuelve a intentar este cobro: se registra sin cobrar otra vez. |
| Bell alert `clock.unconfirmed`, PR 1 | The box has not confirmed its time since it started, so it is not taking payments. It confirms by itself once it reaches the internet, or once two tills or handhelds with staff signed in show the same time. Otherwise, sign in on any till or handheld and use “Check the time”, or confirm the date and time on the Box status page. | El equipo no ha confirmado su hora desde que arrancó, así que no acepta cobros. La confirma solo en cuanto llega a internet, o en cuanto dos terminales con sesión iniciada muestran la misma hora. Si no, inicia sesión en cualquier terminal y usa «Comprobar la hora», o confirma la fecha y la hora en Estado del equipo. |
| Box status, Clock row while waiting, PR 1 | Not confirmed since the box started: no payments are taken. The box's clock says {boxAt:date-time}. | Sin confirmar desde que arrancó el equipo: no se aceptan cobros. El reloj del equipo indica {boxAt:date-time}. |
| Same, button | The date and time are right | La fecha y la hora son correctas |
| Same, help under the button | Press this only if the date and time above match a clock you trust. If they do not, use “Check with this device's time”. | Pulsa esto solo si la fecha y la hora de arriba coinciden con un reloj de confianza. Si no, usa «Comprobar con la hora de este dispositivo». |
| Bell alert `clock.records_misdated` for a clock that was behind (PR 2; the existing words cover a clock that was ahead) | {count} sales were recorded with a time earlier than the real time (from {from:minute} to {to:minute}). They stay as recorded. Go through them with your tax adviser; the list is on the Box status page. | Se registraron {count} ventas con una hora anterior a la real (de {from:minute} a {to:minute}). Quedan como se registraron. Revísalas con tu asesor; la lista está en Estado del equipo. |
| Bell and email after any set | unchanged `clock.corrected` words | unchanged |
| Start-failure page, cause `clock_moved` — title (PR 4) | The box could not check its clock. | El equipo no pudo comprobar su reloj. |
| Same — action | Its clock changed while the box was comparing it with the tax agency's time. Press “Retry a normal boot” to check again. | Su reloj cambió mientras el equipo lo comparaba con la hora de Hacienda. Pulsa «Reintentar un arranque normal» para comprobarlo de nuevo. |
| Waiting page (box's address while the restore waits) — title (PR 4) | The box is waiting for the internet's time. | El equipo está esperando la hora de internet. |
| Same — body | It needs that time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | La necesita para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Setup done screen, under "The server is restarting to finish setup." (`done.waiting_internet_clock`), PR 4 | The box is waiting for the internet's time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | El equipo está esperando la hora de internet para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Guide `backup-recovery.md` (EN/ES), replacing #2532's sentence after "If the clock check refuses, resolve its cause and try again." (PR 4) | If the box cannot get the internet's time when it restarts to finish the restore, it tries again every minute by itself; connect it to the internet if it is not. If it then shows a page saying it could not check its clock, do what that page says. | Si al reiniciarse para terminar la restauración el equipo no puede obtener la hora de internet, lo vuelve a intentar solo cada minuto; conéctalo a internet si no lo está. Si después muestra una página que dice que no pudo comprobar su reloj, haz lo que indica esa página. |
| Guide, the till's clock section (EN/ES), PR 1 | When the server starts and cannot confirm its time over the internet, signed-in tills show “The server's time is not confirmed yet”. Payments wait until two signed-in tills or handhelds show the same time as the server, someone uses “Check the time”, or the server reaches the internet. | Cuando el servidor arranca y no puede confirmar su hora por internet, los terminales con sesión iniciada muestran «La hora del servidor aún no está confirmada». Los cobros esperan hasta que dos terminales con sesión iniciada muestren la misma hora que el servidor, alguien use «Comprobar la hora» o el servidor llegue a internet. |

The dashboard's existing button is “Check with this device's time” / «Comprobar con la hora de este dispositivo» (`box_status.clock.admin.open`, `apps/dashboard/src/i18n/strings.ts:3741,7636`). The till's "Check the time" words are pinned in `apps/till/src/i18n/strings.test.ts:304-305`.

## Sentences changed, word for word

### Root `CLAUDE.md`

**C1. PR 1 inserts a new rule** in §5, in front of "More than a minute behind the latest fiscal record…" (line 899):

> **Every start of a box that files records writes no fiscal record and moves no money until its time is confirmed: by the box's internet time service being synchronised, by two enrolled devices at different addresses reading within 5 seconds of it, or by a person confirming or correcting the date and time on a till or on Box status; AEAT is not asked, and orders still reach the kitchen** (owner, 2026-11-10: "we rely on NTP only, we don't bother about AEAT … If we are not on the internet then we either wait for two devices … Or we stop and ask a user to confirm that our current date+time is correct (or we ask them to correct it)"). Guards: `apps/server/src/start-clock-check.test.ts`, `apps/server/src/clock-unconfirmed-gate.test.ts` and `apps/server/src/boot.start-clock-gate.test.ts`, weaker than the rule: the money routes in the gate table only; the record remedies, off in production, are outside it.

**C2. PR 1 changes the "Nothing EXTERNAL may block a sale" rule** (§5, lines 878-880): its bold heading and its first sentence. Replace the heading

> **Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.**

with

> **Nothing EXTERNAL may block a sale, though a start must have its time confirmed first — and a till needs the venue's PRIMARY.**

and replace

> AEAT, the card network and the internet are never on the sale path of whichever node is primary: records chain locally and the outbox drains later; a card falls back to 4G, a standalone terminal or cash.

with

> AEAT, the card network and the internet are never on the sale path of whichever node is primary, except that a start the internet cannot confirm waits for two devices or a person to confirm its time before its first payment (owner, 2026-11-10): records chain locally and the outbox drains later; a card falls back to 4G, a standalone terminal or cash.

**C3. The clock-setting sentence** (§5, lines 909-913), in two steps. Today:

> **The box sets its clock only through the host service, from AEAT, a till's time (a staff member's during start-up, an administrator's at any time) or an administrator's own device — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed.**

PR 1 replaces it with:

> **The box's internet time service keeps its clock; Waitron sets it only through the host service, from a till's time (a staff member's while the start has not confirmed the time, an administrator's at any time), an administrator's own device, or AEAT only inside the clock-behind stop — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed** (owner, 2026-11-10: "we rely on NTP only, we don't bother about AEAT").

PR 6, which deletes the stop and its AEAT set, drops ", or AEAT only inside the clock-behind stop".

**C4. PR 3 changes the restore sentence** (§5, lines 928-930). Replace

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation); a minute whose name is already in a history the box reads is not taken.

with

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds, or, at the start placing a restore, the box's time service says it is synchronised (owner, 2026-11-10); never on a device's, till's or administrator's confirmation; a minute whose name is already in a history the box reads is not taken.

**C5. PR 5 replaces the stop's rule** (§5, lines 899-908). Replace

> **More than a minute behind the latest fiscal record, write no record and take/refund no new money unless a clock confirmation covers it.** After replay, call `refuseWhileClockBehind` before reader/refund/drawer work; pause both refund recovery loops. Recheck card-refund send/outcome in their dating transaction after provider waits. Still store money already moved. **Clock confirmation lifts the stop for one step back, with no gap limit; once a record is written under it, readings stay within a minute of the latest record written since.** Sources, never a box device outside development: [conventions-data.md](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-06). Guards: clock-behind-stop, payments clock-behind, fiscal chain/restart/confirmation, clock-confirm route and `apps/server/src/clock-watch.start-up.test.ts` suites, weaker than the rule: only named routes/readings/requests; new money routes unguarded.

with

> **A record's time is never compared with the latest record's: the start confirms the time, and once it is confirmed the box records with its clock however far a later sync moves it** (owner, 2026-11-10: "if we successfully sync the clock using ntp then we continue to sell, it doesn't matter how much the clock changes"). After replay, call the seat's `refuseWhileClockBehind` (by then: waiting, or before 28-10-2024) before reader/refund/drawer work; pause both refund recovery loops while waiting. Recheck card-refund send/outcome in their dating transaction after provider waits, against the same check. Still store money already moved. Guards: `packages/fiscal-verifactu/src/chain.earlier-time.test.ts` and `apps/server/src/clock-unconfirmed-gate.test.ts`, weaker than the rule: the money routes in the gate table only.

(PR 6 renames `refuseWhileClockBehind` to `refuseUntilRecordable`, and C5 follows the rename.)

C5 keeps today's "Recheck card-refund send/outcome in their dating transaction after provider waits", with "against the same check" added, because the re-check stays in the code (R5's refund row: `clockStopsRefund`, `bill-refunds.ts:209-220`, still pauses while waiting). Within one process the start check never goes back to waiting (D3), so after PR 5 the re-check finds little the request's own check did not: for a manager's confirmed outcome, a clock set before 28-10-2024 during the provider's wait (`bill-refunds.ts:215-217`, read, not run). It stays as long as the code does, so that a later change to what may refuse a record reaches the refund paths too.

**C6. PR 5 deletes the fiscal-fixture rule** in §4 (lines 738-740), which exists only because the stop refused a write behind a fixture's record:

> **A fiscal fixture must not be over a minute ahead of a later recording write's clock.** In a shared database, every write and helper takes its clock from the latest record time; otherwise give the case its own database. Nothing guards it.

Replacement: none (deleted, and the commit says so). Its receipt in `docs/developers/testing-guide.md` gets a dated pointer to this plan.

### `docs/developers/conventions-data.md`

**C7. PR 1**, the section "Nothing external may block a sale, and a till needs the venue's primary" (lines 3985-3989): its heading becomes "Nothing external may block a sale, though a start must have its time confirmed first, and a till needs the venue's primary", and its bold line and first sentence take C2's replacements word for word.

**C8. PR 1**, "The box sets its own clock" (lines 4479-4481). Replace "The box sets its clock only inside a stop it already has: the clock behind the latest record, or the clock before 28-10-2024 (`clock.unusable`). It opens no stop of its own." with "The box sets its clock inside a stop it already has (the clock behind the latest record, or before 28-10-2024), and, from a staff member's till or an administrator's device, while a start has not had its time confirmed by the internet. It opens no stop of its own." (PR 6 drops "the clock behind the latest record, or".)

**C9. The copies in "Who may confirm or set the clock"** (lines 6101-6118) hold C3's and C5's sentences word for word. Each copy takes the same replacement in the same PR (C3 in PRs 1 and 6, C5 in PR 5). The sentence between them, "Sources: AEAT, two agreeing devices at different addresses (not while the stop found at start-up lasts), an administrator's own device, or a till's time confirmed on it by an administrator at any time or, during a stop found at start-up once AEAT has not answered or cannot be asked, by a staff member signed in on it (owner, 2026-10-31); never a box device outside development.", becomes in PR 1 "Sources: the box's time service; during the stop, AEAT and two agreeing devices at different addresses (not while the stop found at start-up lasts); while a start waits, two devices at different addresses within 5 seconds, which confirm and set nothing; an administrator's own device; or a till's time confirmed on it by an administrator at any time or, while the start has not confirmed the time, by a staff member signed in on it (owner, 2026-10-31; 2026-11-10); never a box device outside development.", and in PR 6 loses "during the stop, AEAT and two agreeing devices at different addresses (not while the stop found at start-up lasts);".

**C10. PR 1**, the till routes' entry (line 4535): "any staff member the till's profile admits, during the start-up window only (below)" becomes "any staff member the till's profile admits, while the start has not confirmed the time (below)".

### `docs/backlog/box.md`, the owner's decision of 2026-11-06 (line 1595)

This is a dated decision record, so the sentences are not rewritten in place: **PR 1 adds a dated line under it** — "**Superseded in part (owner, 2026-11-10, A1420).**" — followed by each sentence and its replacement:

| 2026-11-06 sentence | Replaced by (2026-11-10) | PR |
| --- | --- | --- |
| "Being unable to reach AEAT never stops trading." | "AEAT is not asked at a start. A start whose time service is not synchronised takes no payment until two devices agree with its clock or a person confirms or corrects its date and time." | 1 |
| "A start with no internet whose latest record is in the future beyond the margin needs the time confirmed first." | "Every start with no internet needs its time confirmed first, wherever its latest record is." | 1 |
| "Any accepted source showing the clock outside the margin stops trading until it is corrected, and AEAT disagreeing during normal trading is such a source." | "Nothing stops trading for the clock once a start's time is confirmed; a synchronised time service may move it any distance." | 5 |
| "…and records dated in the future beyond the margin are flagged for correction." | Q4 yes: "…and records stamped more than a minute ahead of internet time, and the sales recorded while a clock confirmed by devices or a person was out, are listed for the tax adviser." Q4 no: deleted. | 2 or 6 |

"AEAT refusing the latest record as too far in the future stops trading until the clock is reset" is changed by Q6's answer only; "The margin is one minute" is not changed by this plan.

## PR 1 — a start the internet cannot confirm waits for two devices or a person

### Task 1: the start check's decision (apps/server and packages/fiscal, pure)

Files: new `apps/server/src/start-clock-check.ts` and its test; `packages/fiscal/src/clock-witnesses.ts` (`agreeingDeviceGroup(witnesses, marginMs = CLOCK_WITNESS_MARGIN_MS)`, the margin passed through to its agreement and grouping tests) and its test.

- [ ] Tests, `clock-witnesses.test.ts` (fiscal): two devices at two addresses 3 s and 4 s from the box, with `marginMs` 5 000 → both returned; one of them 6 s out → none. Control: the existing 60 s cases, unedited.
- [ ] Tests, `start-clock-check.test.ts`, with a fake `clockStatus` and a `createClockWitnessStore` fed device readings. End point: each call settled.
  1. Synchronised → `by_internet`. Not synchronised → `waiting`. The host throws or answers `available: false` → `waiting`.
  2. Waiting, two devices at different addresses within 5 s → `confirmDevices` returns the two readings and the state becomes `by_devices`. Controls: two devices at one address → stays waiting; two devices 2 days out, agreeing with each other → stays waiting (and nothing is set).
  3. `by_devices` or `by_person`, then a look that finds the time service synchronised → `by_internet`; once `by_internet`, nothing moves it.
- [ ] Implement `startClockCheck(deps) → Promise<"by_internet" | "waiting">` and `startClockState()` holding `waiting | by_devices | by_person | by_internet` with `confirm(by)` and `unconfirmed()`.
- [ ] `pnpm --filter @waitron/fiscal exec vitest run src/clock-witnesses.test.ts`, `pnpm --filter @waitron/server exec vitest run src/start-clock-check.test.ts`.

### Task 2: the start confirmation row (fiscal-verifactu, fiscal seat)

Files: `packages/fiscal-verifactu/src/clock-step.ts` (a step at reason `start` writes its row with no check, as non-`behind_chain` reasons already do at `:90`; new `recordStartConfirmation(tx, { source, personId, boxAt, stepMs, proof })` beside it, storing the chain heads in its proof); `packages/fiscal/src/backend.ts` (an optional seat method).

- [ ] Tests (`clock-step.test.ts`): a `start` confirmation by `devices` with `stepMs` 0 writes one row with no person and the readings and heads in its proof; one by `staff` keeps its person; one by `admin` keeps `asShown`. A `devices` row with a person is refused by the table's check (the domain error code asserted).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-step.test.ts`, then the fiscal core command.

### Task 3: boot runs the check before the listener; the correction admits reason `start`

Files: `boot.ts` (run Task 1 after `:2303` and before `:3611` through `StartServerSeams.boxHost`, so no test's start reaches a real host; hold the state); `clock-correction.ts` (reason `start` admitted without a stop from source `staff` or `admin` while the state is not `by_internet`; such a set moves the state to `by_person`; source `authority` at reason `start` is refused).

- [ ] Test (`clock-correction.test.ts`, new cases only; **this suite owns "refused once confirmed by the internet"**): reason `start` from staff admitted while waiting and while by devices; refused `not_stopped` once by the internet; reason `start` from `authority` refused. Control: the existing "refuses a set with no stop" case, unedited.
- [ ] Test (one case in `boot.clock-correction.test.ts`, which already boots with a fake host): not synchronised → the start check reads waiting before the listener's first answer, and the host receives no set. Control: synchronised → `by_internet`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-correction.test.ts src/boot.clock-correction.test.ts`.

### Task 4: the watch keeps listening (apps/server)

Files: `clock-watch.ts`, `clock-watch.start-up.test.ts` (new cases).

- [ ] Tests: while not `by_internet`, each look reads the time service fresh (cache cleared) and, while waiting, asks Task 1 about the device readings; a waiting box whose time service turns synchronised is `by_internet` at the next look; two agreeing devices noted between looks confirm at the next look and write one `start`/`devices` row (Task 2); once `by_internet`, a look asks nothing for the start check. AEAT is asked by no start-check look (the fake AEAT's ask count stays 0 over three looks; control: the existing stop case that asks it). Control: the existing "no stop" case, unedited.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-watch.start-up.test.ts src/clock-watch.test.ts`.

### Task 6: the gate (apps/server)

Files: `boot.ts` (the two wrappers of D4 around the one seat; hand `unconfirmed()` to the two loops and `clockStopsRefund`); `tender-refund-recovery.ts`, `bill-payments-loop.ts`, `bill-refunds.ts` (one condition each); `apps/server/src/errors.ts` (`clock.unconfirmed: {}`; reason `clock_unconfirmed` on `sale.charged_not_recorded`); `till-api.ts` and `payments-api.ts` status maps (409). Not `record-remedy-routes.ts` (R7).

- [ ] Test, new `apps/server/src/clock-unconfirmed-gate.test.ts` on `provisionBillVenue` with its seat wrapped by the same helper boot uses (exported from a small `start-clock-gate.ts`). **One table, `it.each`, over every money route R5 lists** — `POST /api/pay` (counter card, stored order, zero total), `POST /api/sales` (cash), collect, bill payment, bill refund (new and pending replay), tender refund (new and pending), the tender-refund retry, unpaid departure, and the eight dashboard resolutions — each while waiting: answers 409 `clock.unconfirmed`, `collectCalls`, refund sends and drawer jobs unchanged, no row in `registros_facturacion`, `sales`, `tenders` or the route's own table. Control row: the same request once confirmed answers its success status.
- [ ] Same file, the money already moved: a card charged as the gate turns on whose sale would file answers `507 sale.charged_not_recorded` with `reason: "clock_unconfirmed"` and writes the payment once confirmed; the webhook stores a hosted payment while waiting (as `webhook.test.ts`'s behind case does); a correction through `cancel-credit.ts` is refused with nothing written. Both loops leave a pending refund untouched for one pass while waiting, and complete it once confirmed (control).
- [ ] Test, new `apps/server/src/boot.start-clock-gate.test.ts` (wiring only, R3's harness): not synchronised → `POST /api/sales` answers 409 `clock.unconfirmed`; synchronised → 200 and one record (control).
- [ ] The four suites R10 found failing under the gate (`boot.backup-network.test.ts`, `promote-endpoint-e2e.test.ts`, `handover-controlled.e2e.test.ts`, `handover-stepdown.real.test.ts`) get a start whose time is confirmed: a fake host answering synchronised, through `StartServerSeams.boxHost`. Setup only; no assertion changes. Then run the same 102-file selection R10 ran; any other failure is a STOP.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-unconfirmed-gate.test.ts src/boot.start-clock-gate.test.ts src/clock-behind-stop.pay.test.ts src/clock-behind-stop.refunds.test.ts src/webhook.test.ts src/boot.backup-network.test.ts src/promote-endpoint-e2e.test.ts src/handover-controlled.e2e.test.ts src/handover-stepdown.real.test.ts`, then the fiscal core command.

### Task 7: "Check the time" and the administrator's confirmation while waiting (server and till)

Files: `clock-start-up.ts` (`tillMayOffer` and `admit` also true while waiting, at once); `till-box-clock-api.ts` (while waiting or by devices: "The time is right" or a till within a minute writes Task 2's confirmation with `stepMs` 0; "Use this time" sets through the host as today, then confirms; both move the state to `by_person`); the staff-notice source (`clock.unconfirmed` while waiting); `box-health-api.ts` (R9: `/api/box/clock-confirm` admitted while waiting, writing Task 2's confirmation with source `admin` and `stepMs` 0, either from the device's time within a minute or, with `asShown: true`, as the box's date and time stand; `/api/box/clock-set` sends reason `start` instead of `behind_chain` while waiting, `unusable` still taking precedence; both move the state to `by_person`; routes handed no start check behave as today, so the existing route suites' setups stand); `apps/till/src/i18n/strings.ts`, `codes.ts`, `staff-notices.ts` (`CHECKABLE` gains `clock.unconfirmed`), `widgets/pay-refusal.ts` (the two refusals).

- [ ] Tests: `clock-start-up.test.ts` (offered while waiting, at once). `till-box-clock-api.test.ts` (waiting, "The time is right" → one `start`/`staff` row, no host call, state `by_person`; a till 2 days off choosing "Use this time" → one host set, then the row; **one route case: by the internet → refused**, the property's other owner being Task 3). `clock-confirm.route.test.ts` (while waiting, an administrator's device within a minute of the box → 200, one `start`/`admin` row with `stepMs` 0 and no `asShown`, no host call, state `by_person`; an `asShown` confirm while waiting → one `start`/`admin` row with `asShown`, no host call; control: the existing "refuses a confirmation with no stop and no check waiting", unedited). `clock-set.route.test.ts` (R9's case: waiting, no internet, no till, the box's clock two days ahead of the administrator's device → 200; the host receives one set with reason `start` and requester `{ source: "admin", person }`; one `start`/`admin` row with `stepMs` about −2 days; end point: the start check reads `by_person`. Control: the existing "refuses a set with no stop", unedited, for a box not waiting). Till: `src/i18n/staff-notices.test.ts` and `src/i18n/t.test.ts` (both languages), `pnpm exec vitest run scripts/staff-notice-codes.test.ts`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-start-up.test.ts src/till-box-clock-api.test.ts src/clock-confirm.route.test.ts src/clock-set.route.test.ts src/boot.clock-watch.test.ts`, `pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts src/i18n/t.test.ts`.

### Task 8: the bell alert and the Box status row (server and dashboard)

Files: new `apps/server/src/clock-unconfirmed-alert.ts` (an `AlertSource`, `system.manage`, raised while waiting); `apps/server/src/box-health.ts` (the clock read answers `waiting` with `boxAt`); `apps/dashboard/src/screens/box-status-rows.ts`, `box-status-screen.ts` (`settableStop` and `stopShowing`, `:1217-1231`, also hold while the Clock row reads waiting, so "Check with this device's time" is offered then: R9; the "The date and time are right" button and its help), `apps/dashboard/src/i18n/strings.ts`, `alert-messages.ts`; the area claim for `clock.unconfirmed` (follow `scripts/alert-codes.test.ts`'s failure message); in `apps/server/src/guide/en/box-status.md` and `es/box-status.md`, a new section "When payments wait for the box's time" with the shared id `{#clock-waiting}` (what staff and administrators do: D1 rows 3a-3c, and that the internet confirms by itself); the till guide sentence in `till-notices.md` (EN/ES).

- [ ] Tests: `clock-unconfirmed-alert.test.ts` (raised while waiting; not once confirmed: the control). `box-status-rows.test.ts` and `box-status-screen.test.ts` (the row's words and the box's date and time while waiting, absent once confirmed; "The date and time are right" sends `asShown: true` and the row goes after the answer; a refusal shows beside the button, per the Forms contract; while waiting, with the box not kept in time over the internet and the device two days off, "Check with this device's time" is offered and sends `/api/box/clock-set`; control: the same health once confirmed offers neither). `box-status-screen.a11y.test.ts` gains the waiting state in both themes.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-unconfirmed-alert.test.ts src/box-health.test.ts src/guide-content.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts src/screens/box-status-screen.test.ts src/screens/box-status-screen.a11y.test.ts src/i18n/alerts.test.ts` (free memory first), `pnpm exec vitest run scripts/guide-links.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`.

### Task 9: PR 1 documents

- [ ] Root `CLAUDE.md` C1, C2, C3 (PR 1 form); `conventions-data.md` C7, C8, C9 (PR 1 form), C10 and a new section "Every start confirms the box's time before it trades" (D1-D4, R3, R4, R6, R7, R11), quoting the owner's 2026-11-10 words; grep the file for every other "only inside a stop" or "only during a stop" claim and fix each; `docs/backlog/box.md`'s dated line (its PR 1 rows); the A1407 entry in `docs/backlog.md` gains "an enabled remedy takes the start gate first" (R7); A798 slice 9c's "a clock running ahead dates sales…" line narrows to a clock that drifts ahead while the box runs. `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.

## PR 2 — the alert names the sales a wrong confirmed clock dated (only if Q4 is yes)

### Task 10: list the sales between a confirmation and the time service's correction

Files: `packages/fiscal-verifactu/src/clock-misdated.ts` (`misdatedSelection` also reads a `start` confirmation, in two shapes: the records written after a devices' or person's confirmation's stored heads and up to the heads when the time service synchronised; and the records whose time is later than the synchronised time plus a minute), `clock-stop-incidents.ts` (`recordMisdated` called with either; a `direction` param, `later` or `earlier`), `apps/server/src/clock-watch.ts` and the start check (at the first `by_internet` after a start: the second shape when the latest record is more than a minute ahead of the synchronised clock; the first shape when the box's wall clock moved more than a minute against its steady clock since a `by_devices` or `by_person` confirmation), the dashboard words for `earlier`.

- [ ] Tests: `clock-misdated.test.ts` (new cases: a staff `start` confirmation, three sales, the clock then moved −3 h → the three listed, earliest first; moved 40 s → nothing recorded, the control. Two records stamped 2 h ahead of the synchronised time and one 30 s ahead → the two listed; none ahead → nothing recorded, the control). `clock-watch.start-up.test.ts` (one case each: a person-confirmed clock moved 3 h when the time service synchronises → one `clock.records_misdated`, `earlier`; a start whose latest record is 2 h ahead of the synchronised clock → one, `later`). The existing list and download routes are unchanged and their suites pass unedited.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-misdated.test.ts src/clock-misdated-detail.test.ts src/clock-stop-incidents.test.ts`, `pnpm --filter @waitron/server exec vitest run src/clock-watch.start-up.test.ts src/box-health.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`, then the fiscal core command.
- [ ] `docs/backlog/box.md`'s Q4 row.

## PR 3 — a synchronised restore names its series without AEAT (Q1)

### Task 11: the comparison trusts a synchronised box (fiscal-verifactu)

Files: `packages/fiscal-verifactu/src/hour-clock.ts`, `hour-clock.test.ts`, `hour-setup-clock.ts`, `hour-setup-clock.test.ts`, `errors.ts` (optional param on `sif.allocation_invalid`: `internet?: string`, for PR 4).

- [ ] Tests (`hour-clock.test.ts`): `compareHourClocks(obs, release, { boxSynchronised: true })` with AEAT unavailable → `canSelectHour` true. The same without the option → false and `second_clock_missing` (control; the existing cases stay unedited). In `hour-setup-clock.test.ts`: with `boxSynchronised: true` no AEAT reading is taken (the fake reader's ask count is 0; control: without the option, 1); a `second_clock_missing` refusal carries `internet: "network"`.
- [ ] Implement. The release and range checks are unchanged.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-clock.test.ts src/hour-setup-clock.test.ts src/hour-selection.test.ts`, then the fiscal core command.

### Task 12: the restore's start tells the module whether the box is synchronised (module contract)

Files: `packages/module/src/operation-preparation.ts` (type), `packages/provisioning/src/first-setup-runtime.ts` (`createModuleOperationHost` passes it through), `packages/fiscal-verifactu/src/hosted-hour-recovery.ts` and its test; `apps/server/src/recovery-preparation.ts`, `recovery-entry.ts`, `restore-request.ts` (the start's runner supplies it; the page runner does not).

- [ ] Add to `ModuleOperationHost`, with one comment saying only the start placing a staged restore supplies it:
  ```ts
  startClock?: {
    synchronised(): Promise<boolean>; // false when the host service does not answer
  };
  ```
- [ ] Tests (`hosted-hour-recovery.test.ts`), through `configure!(host).resumeRecovery` then `prepare` as existing cases do: (1) AEAT unreachable with `synchronised` → true: `prepare` admits and AEAT is not asked. (2) The same with `synchronised` → false: it throws `second_clock_missing`; case 1 is the control. (3) No seat: today's refusal (the existing cases, unedited).
- [ ] Test (`apps/server/src/restore-request.test.ts`): the start's runner hands the seat to the module, and `createInteractiveRecoveryPreparation` does not.
- [ ] Root `CLAUDE.md` C4.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hosted-hour-recovery.test.ts`, `pnpm --filter @waitron/server exec vitest run src/restore-request.test.ts src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts`, `pnpm exec vitest run scripts/module-seams.test.ts scripts/claude-md-pointers.test.ts`, then the fiscal core command.

## PR 4 — the restore waits for the internet without counting, and the page names the cause

### Task 14: a restore's start that cannot reach the internet waits, uncounted (apps/server)

Files: `apps/server/src/node-entry.ts`; new `start-clock-waiting.ts` (the waiting app) and its test; `apps/server/src/errors.ts` (`server.waiting_for_internet_clock: {}`); `i18n/recovery-page.ts` (waiting page words). Under Q1, a synchronised box never reaches this wait.

- [ ] Tests (`node-entry.test.ts`, a `runStagedRestore` stub, a fake `serveRecovery`, fake timers). End point: `runEntry` settled.
  1. `second_clock_missing` with `internet: "network"` → the count after equals the count before; the waiting app is served, closed at 60 000 ms and not before; the start-failure log file has the same length as before. Control (forced effect): `internet: "tls"` → the count rises by one and the log grows.
  2. `internet: "timeout"` → as case 1.
  3. Three `network` starts in a row → the box state is still `normal`.
- [ ] Tests (`start-clock-waiting.test.ts`): `GET /` (HTML) → 503, `Retry-After: 60`, the words in English, and in Spanish with `Accept-Language: es`. `GET /setup-api/status` → 503 `{ error: { code: "server.waiting_for_internet_clock" } }`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts src/start-clock-waiting.test.ts`, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

Why every 60 seconds with no overall limit: a router coming back is noticed within a minute, each try repeats the restore's archive checks so faster costs more, and the box cannot trade until the restore is placed, so waiting costs nothing. `tls`, `response` and `configuration` are not a network that will come back, so they count as today.

### Task 15: the setup page says what the box is waiting for

Files: `apps/setup/src/screens/done-screen.ts` and its test, `apps/setup/src/i18n/strings/finish.ts`.

- [ ] Test: a poll answered 503 with `server.waiting_for_internet_clock` shows the waiting line under the restarting line. A following poll that fails to connect keeps it (between tries nothing answers). A 404 (trading) shows "ready" and drops it.
- [ ] `pnpm --filter @waitron/setup exec vitest run src/screens/done-screen.test.ts src/screens/done-screen.a11y.test.ts` (free memory first).

### Task 16: the start-failure page names the cause

Files: `recovery-state.ts` (`lastErrorCause`), `node-entry.ts` (`failStart` sets it), `recovery-surface.ts`, `i18n/recovery-page.ts`; the guide sentence in `backup-recovery.md` (EN/ES).

- [ ] Tests: `recovery-state.test.ts` (a cause outside the set is dropped on read; `withFailureCode` clears a stale one). `node-entry.test.ts`: AEAT's `clock-corrected` reason → cause `clock_moved`; `clock_disagreement` and `minute_in_use` → no cause. `recovery-surface.test.ts`: the cause's words in both languages; no cause → #2532's words (its case stays unedited).
- [ ] `pnpm --filter @waitron/server exec vitest run src/recovery-state.test.ts src/node-entry.test.ts src/recovery-surface.test.ts src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`.

## PR 5 — the stop stops answering (Q2; the fiscal core unchanged)

**Behaviour only: no production deletion, and no edit to `chain.ts`.** Q2's yes is the owner's 2026-11-10 answer; no AEAT test comes first. Three tasks, each for one implementer; the branch is pushed only after Task 17c, since between 17a and 17b the server's suites still expect the stop.

**PRs 5 and 6 land together.** PR 6 is built on PR 5's branch before PR 5 goes to the owner; both are put to the owner as one approval and landed one straight after the other in the same sitting. PR 5 alone leaves the stop's code in place but unreached, and the nightly run enforces `98/98/98/95` coverage, so a nightly between them could fail. If PR 6 is not ready when PR 5 is approved, PR 5 waits for it.

### Task 17a: `clockBehindChain` and `clockStopState` answer null (fiscal-verifactu)

Files: `packages/fiscal-verifactu/src/clock-behind.ts` (`clockBehindChain` answers null; its body goes in PR 6) and `clock-confirmation.ts` (`clockStopState` answers null). About +4 / −0 production lines. Through them the append, the seat's `refuseWhileClockBehind` and `clockBehindLatestRecord`, the staff notice and the bell alert all stop finding a stop; `refuseWhileClockBehind` still refuses a time before 28-10-2024 first (`clock-behind.ts:172`).

- [ ] Test first: new `packages/fiscal-verifactu/src/chain.earlier-time.test.ts`: a record dated an hour before the latest is written, chained after it in `secuencia`, with its own time; and one dated a day before. Control (forced effect): one dated 27-10-2024 is refused `clock.unusable`. Watch the first fail on the current code.
- [ ] Then delete or trim the fiscal suites R8 measured failing (161 cases), each case because the behaviour it asserts is removed: `chain.clock-behind.test.ts` (2 of 5 fail; deleted, replaced by `chain.earlier-time.test.ts`), `backend.clock-behind.test.ts` (1 of 3), `backend.clock-stop.test.ts` (3 of 6), `clock-behind.test.ts` (4 of 7), `clock-behind.restart.test.ts` (32 of 38), `clock-checks.test.ts` (27 of 41), `clock-confirmation.test.ts` (40 of 61), `clock-stop-incidents.test.ts` (33 of 37), `clock-misdated.test.ts` (10 of 24), `clock-step.test.ts` (2 of 29: the stop-closing steps), `clock-behind-alerts.test.ts` (2 of 9: the behind alert; the unusable cases stay), `staff-notices.test.ts` (1 of 22: the behind notice), and one case each in `record-remedy-http.test.ts` ("refuses a server clock behind the chain without appending"), `record-remedy-absent.test.ts` ("refuses a clock more than a minute behind the chain"), `record-remedy-corrective.test.ts` ("uses the host clock stop before appending the corrective invoice") and `record-remedy-corrective-http.test.ts` ("refuses a new corrective record when the host clock is behind the chain"). Those four remedy cases are deleted, not rewritten: a remedy is switched off in production, its refusal there comes only from the disabled policy, and "keeps the default production policy closed" already owns that (R7).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node` (read the `Tests` count; a failure in a suite not listed here is a STOP), the fiscal core command **unedited**, and `git diff --stat <base> -- packages/fiscal-verifactu/src/chain.ts` prints nothing.

### Task 17b: the server's suites (apps/server)

- [ ] Delete or trim the server suites R8 measured failing (146 cases), each case because the behaviour it asserts is removed: `clock-behind-stop.bills.test.ts` (6 of 7), `.charged` (3 of 7), `.open` (4 of 5), `.pay` (7 of 9), `.records` (6 of 16), `.refunds` (14 of 16), `payments-api.clock-behind.test.ts` (9 of 26), `zone-clock-stop-interaction.test.ts` (4 of 4, deleted), `clock-watch.restart.test.ts` (13 of 13, deleted), `clock-confirm.route.test.ts` (34 of 45), `till-box-clock-api.test.ts` (31 of 41), `clock-set.route.test.ts` (12 of 22), `boot.clock-behind-wiring.test.ts` (1 of 3: "answers stopped for a time a day before the latest record"), `webhook.test.ts` (1 of 16: "records a hosted payment while the box's clock reads behind its last sale"; Task 6's table owns the waiting version), `hour-recovery-host.test.ts` (1 of 37: "a restore below the backup's newest invoice names its minute, a sale is then refused by the clock-behind stop, and a confirmation lists the later sale"; becomes: the sale after that restore is taken, dated by the box's clock). Task 7's new cases in `clock-confirm.route.test.ts`, `till-box-clock-api.test.ts` and `clock-set.route.test.ts` are about waiting and stay.
- [ ] The PR lists each case removed. **A failure in a suite not on this list is a STOP.** Task 6's gate table already owns what the route suites tested that survives.
- [ ] `pnpm --filter @waitron/server exec vitest run` on every suite named here and the 102-file selection R10 ran (read the `Tests` count).

### Task 17c: rules and staff guides

- [ ] Root `CLAUDE.md` C5 and C6; C9's PR 5 parts; `docs/backlog/box.md`'s PR 5 row; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] The staff guides, English in `apps/server/src/guide/en/` and the Spanish twin of each in `apps/server/src/guide/es/`. Each sentence that describes the stop is cut, not reworded (a guide sentence earns its place by changing what staff do):
  - `box-status.md`: the section "When payments stop because of the clock" `{#clock-behind}` (EN lines 174-380; ES "Cuando se paran los cobros por la hora", 185-402) is deleted. In "Read the rows", the Red row's "or payments have stopped because the clock reads earlier than the last sale" (EN 24-25; ES 26-28) goes. In "Just after a start" `{#clock-at-start}` (EN 381-408; ES 403-432) and "Devices as clock witnesses" `{#clock-witnesses}` (EN 491-506; ES 527-543), every sentence about the stop goes; the `clock.disagrees` warning and the clock before 28 October 2024 stay. "Sales dated wrongly" `{#sales-dated-wrongly}` (EN 432-490; ES 460-526): with Q4 yes, only PR 2's two cases stay; with Q4 no, the section goes.
  - `till-notices.md`: the "Payments stopped: the server's clock reads earlier than its last sale" notice (EN 39-50; ES "No se puede cobrar: la hora del servidor es anterior a la última venta", from line 45) goes, and the clock paragraphs after it (EN 65-93) keep only what serves PR 1's waiting notice and the clock before 28 October 2024.
  - `backup-recovery.md`: "If the backup holds sales dated more than a minute after the box's time, the box stops taking payments once the recovery finishes…" (EN 157-159; ES 172-174) goes. PR 4's sentence in the same file is a different one and stays.
  - Every link to a deleted section moves to PR 1's `{#clock-waiting}` or `{#clock-at-start}`, or goes.
- [ ] `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`, and `grep -rn -e 'clock-behind' -e 'earlier than its last sale' -e 'earlier than the last sale' -e 'anterior a la última venta' apps/server/src/guide` prints nothing.

## PR 6 — delete the stop's code (three tasks, each builds)

Lands with PR 5 (above). Order: 18a, 18b, 18c.

### Task 18a: the server stops calling the stop

Delete what R5's last column marks dead in `apps/server`: the stop parts of `clock-watch.ts` (with its AEAT set, `setFromAuthority`), `clock-start-up.ts`'s stop branch, `till-box-clock-api.ts`'s and `box-health-api.ts`'s stop admissions (keeping the misdated list and download routes if Q4 is yes), the `clock.behind_chain*` emails, reasons and the `clock.behind_chain` staff notice source. Rename `refuseWhileClockBehind` to `refuseUntilRecordable` across its callers. `fiscal.clock_drift` is hidden while waiting instead. Root `CLAUDE.md` C3's PR 6 step and C9's PR 6 part. Every caller of a seat method 18c deletes is changed here, so 18c builds; the list comes from this grep, run 2026-11-10 on the base (`grep -rnE '\b(clockBehindLatestRecord|clockStopState|openClockCheck|confirmClockStop|waitingClockCheck|closeClockCheckByItself|noteClockProvedWrong)\b' apps packages --include='*.ts'`, leaving out tests, `packages/fiscal-verifactu/src/`, the seat contract and `fiscal-none`):

- `clockBehindLatestRecord`: `bill-refunds.ts:219` (`clockStopsRefund`), `tender-refund-recovery.ts:36`, `bill-payments-loop.ts:244` (each pauses while waiting only), `boot.ts:3109` (the drift alert's "stopped" test becomes "waiting").
- `clockStopState`: `box-health.ts:145-198` (the Clock row reads the start check's state), `clock-correction.ts:86,161-162` (admission reads the start check's state and `clock.unusable`), `clock-start-up.ts:48-61`, `clock-watch.ts:54,360`, `till-box-clock-api.ts:165-167`.
- `waitingClockCheck`, `closeClockCheckByItself`: `box-health.ts:200-208`, `clock-watch.ts:59-60,295-305`.
- `openClockCheck`, `confirmClockStop`, `noteClockProvedWrong`: `clock-watch.ts:55-58,138,196-215`; `till-box-clock-api.ts:109-110,291` and `box-health-api.ts:244-245,291`. **Both route files mount nothing when the seat has no `confirmClockStop`** (`till-box-clock-api.ts:110`, `box-health-api.ts:245`), and PR 1's waiting confirmations live in those routes, so their mount condition moves to the start check's confirmation writer before 18c deletes `confirmClockStop`.
- `misdatedRecords`, `misdatedDetail` (`box-health-api.ts:145-208`) stay if Q4 is yes.

The same grep, re-run after 18a, must print only the seat contract, `fiscal-none` and `packages/fiscal-verifactu/src/`.

Suites deleted whole: `clock-watch.anchor.test.ts` (492 lines, 12 cases), `clock-watch.elapsed.test.ts` (151, 5), `boot.clock-start-up.test.ts` (217, 2). Trimmed to their surviving cases: `clock-watch.test.ts` (876, 48), `clock-watch.correction.test.ts` (441, 17), `clock-start-up.test.ts` (183, 16), `clock-confirm.route.test.ts` (1,988, 45), `till-box-clock-api.test.ts` (1,126, 41), `clock-set.route.test.ts` (700, 22), `clock-correction.test.ts` (1,137, 69). (`zone-clock-stop-interaction.test.ts` and `clock-watch.restart.test.ts` are already gone, in Task 17b.)

### Task 18b: tills and dashboard stop showing the stop

Delete the `clock.behind_chain` notice, refusal and dialog branches in `apps/till`, and the stop rows and alert words in `apps/dashboard` (`box-status-rows.ts`, `box-status-screen.ts`'s stop branches beside PR 1's waiting ones, `alert-messages.ts`), with the till's and dashboard's clock-stop cases. Run after 18a, so the server has stopped sending a code before its words go.

### Task 18c: the fiscal module and the seat contract

Delete the seat methods `clockBehindLatestRecord`, `clockStopState`, `openClockCheck`, `confirmClockStop`, `waitingClockCheck`, `closeClockCheckByItself`, `noteClockProvedWrong` from `packages/fiscal/src/backend.ts`, its fake and `fiscal-none`, and their Veri\*Factu implementations: `clock-behind.ts`'s comparison (keeping `latestRecord` if PR 2 or Q6's alternative uses it), `clock-checks.ts`, the stop parts of `clock-confirmation.ts`, `clock-stop-incidents.ts` and `clock-behind-alerts.ts`, and `clock-misdated.ts`'s stop path (the whole file if Q4 is no).

Suites deleted whole: `clock-behind.test.ts` (138, 7), `clock-behind.restart.test.ts` (558, 25), `clock-checks.test.ts` (718, 32), `clock-confirmation.test.ts` (1,083, 57), `clock-stop-restarts.test.ts` (96, 4); with Q4 no, also `clock-misdated.test.ts` (828, 24) and `clock-misdated-detail.test.ts` (443, 8). Trimmed: `clock-stop-incidents.test.ts` (771, 24), `clock-behind-alerts.test.ts` (133, 9; its unusable case stays), `clock-step.test.ts` (683, 23; its no-stop and `clock.corrected` blocks stay).

Documents: `conventions-data.md`'s sections "While the box's clock reads behind the latest fiscal record…" and "A confirmation of the clock lifts the stop…" become a dated pointer to this plan; then fix every claim this grep finds: `grep -rn -e 'clock-behind' -e 'behind_chain' -e 'records_misdated' -e 'behind the latest' -e 'minute ahead' -e 'minute behind' -e 'clock_checks' -e 'earlier than its last sale' -e 'earlier than the last sale' -e 'anterior a la última venta' CLAUDE.md docs/developers docs/backlog.md apps/server/src/guide` (it reaches the §4 fixture rule C6 removed, its receipt in `testing-guide.md`, and any guide sentence Task 17c missed).

- [ ] Each task: the suites of every package it touches, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/staff-notice-codes.test.ts scripts/claude-md-pointers.test.ts scripts/classification-complete.test.ts`.

## Task 19: on the test box (the lane runs the PR's part before it lands)

On the Debian 13 test box once the watcher reports it back, or a preproduction box the owner names, with `WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`. Record each command and its output in the PR description.

**PR 1:**

1. **Every boot starts unsynchronised (R4).** Reboot. Compare `journalctl -u systemd-timesyncd -o short-iso | grep -m1 -i 'contacted\|synchroni'` with the server's first `clock_start.*` log line. **A failing reading of R4** shows the time service synchronised before the server's first look on every one of three boots.
2. **NTP blocked, web traffic allowed.** `nft add table inet a1420; nft add chain inet a1420 out '{ type filter hook output priority 0; }'; nft add rule inet a1420 out udp dport 123 drop`. With the clock right, `docker compose restart app`. **Expect:** a cash sale refused with the waiting words; then staff sign in on a till and a handheld at the true time, and within about 30 s payments resume with no tap and one `start`/`devices` row. Set the clock 2 days ahead (`timedatectl set-ntp false; timedatectl set-time …; timedatectl set-ntp true`) and restart: **expect** the two signed-in devices not to confirm, and "Use this time" on one of them to produce one `clock.set` in `journalctl -t waitron-box` whose requester says `staff`, then the next sale dated right. Then `nft delete table inet a1420`.
3. **No internet at all.** Unplug the WAN; restart; one till only. **Expect:** the notice; "The time is right" lets the next sale through. Plug the WAN back in on a second run without tapping: **expect** payments to resume by themselves within about a minute of the router being up. Time it. On a third run, with the WAN unplugged, no till signed in and the clock set 2 days ahead before the restart, an administrator uses "Check with this device's time" on Box status from a phone: **expect** one `clock.set` whose requester says `admin`, and the next sale taken and dated right.
4. **Flat battery** (revision 2's step 1): power off at the wall for 10 minutes with the time service stopped and the WAN unplugged; **expect** waiting at power-on, not a sale dated 10 minutes early.

**PRs 3-4:** press Make the series, block 443 and UDP 123, press Restore backup. **Expect** the waiting line and page, `failures` unchanged over five minutes, one log line a minute, the start-failure log not grown (`wc -c` before and after); unblock UDP 123 only and expect the restore to finish within about two minutes with no AEAT ask. Report one try's length from the log times.

## Deliberately unchanged, and limits

- **A venue whose network blocks the time protocol confirms by devices or a person at every start** (R4). Nothing falls back to AEAT's time; the existing `clock.sync_off` alert tells the administrator the time service is not synchronised.
- **A synchronised time service is trusted whatever it says**, including one pointed at a wrong server; AEAT no longer cross-checks it at a start or a restore (D5).
- **A box confirmed by devices or a person trades on its own clock** until the time service synchronises. Devices agree within 5 s and a person sees both clocks, so the clock is close unless the person confirms a wrong one. The research (52.1(a)) finds the file enough when only the time is wrong; a wrong date needs a corrective (52.1(b)), which Waitron cannot yet issue for every case (A1407). Q4's list is how the owner learns of either.
- **Sales stamped ahead into a later day are refused by AEAT and can hold later filing** (R12; Q6).
- **Devices report their clocks only while staff are signed in on them** (R11). Two devices sitting at the PIN screen do not confirm the time.
- **A clock that falls back while the box trades is no longer stopped after PR 5.** At most the existing `fiscal.clock_drift` warning shows (`time-health.ts:104`); the start check no longer asks once the internet has confirmed (D1 row 4), and Q4's list does not cover it. A clock that drifts ahead while the box runs is not watched beyond D1 row 4 either (A798 slice 9c, backlog).
- **No AEAT run has tried a record stamped earlier than the record before it**; nothing published refuses it (R12), and the owner judged the proposed test not worth running (Q2).
- **No tax adviser's answer is cited.** Q2 rests on the owner's decision and on research that calls itself "research for the owner, not professional advice" (`docs/compliance/research/2026-11-06-adviser-clock.md`, line 6).
- **Before PR 5**, a clock that a confirmation or the sync leaves more than a minute behind the latest sale still meets today's stop; its existing "Check the time" and AEAT paths lift it as today.
- **The record remedies are not gated** (R7): production refuses them all. A1407's entry carries the rule for the day one is switched on.
- **Promotion and first setup are untouched**; the restore and setup pages keep their own clock check, because a person on a page can act.
- **Nothing measured on a real box yet**: R4's timing, the router path and the device confirmation are Task 19's.

## Changed test checks

- PR 1: the four suites R10 found failing under the gate (`boot.backup-network.test.ts`, `promote-endpoint-e2e.test.ts`, `handover-controlled.e2e.test.ts`, `handover-stepdown.real.test.ts`) gain a start whose time is confirmed (Task 6); setup only, no assertion changes.
- PR 5: `packages/fiscal-verifactu/src/chain.clock-behind.test.ts` is deleted; `chain.earlier-time.test.ts` asserts the opposite (the owner's 2026-11-10 answer). Every other case Tasks 17a and 17b list (R8's measured 307) is deleted, or in one case (`hour-recovery-host.test.ts`) rewritten as Task 17b says, because the behaviour it asserts is removed; each is named in the PR.
- PR 6: the suites Tasks 18a, 18b and 18c list. Any OTHER existing test that has to change is a STOP.

## Size (estimates; lines added / removed)

Production and tests counted apart. Removals come from `wc -l` and case counts of the suites named above (counted 2026-11-09 on this base): the six `clock-behind-stop.*` suites hold 2,541 lines and 59 cases; the stop-only fiscal files hold 1,327 production lines and their suites 5,216 test lines; the server's `clock-watch.ts`, `clock-start-up.ts` and `till-box-clock-api.ts` hold 919 production lines, part of which survives.

| PR | Production | Tests | Docs |
| --- | --- | --- | --- |
| **1** start check, gate, devices, till and administrator (Tasks 1-9) | +400 / −5 (Task 1: 70; 2: 30; 3: 30; 4: 30; 6: 60; 7: 100 with words and the administrator's two routes; 8: 80 with words) | +620 (the gate table, about 200, replaces the 2,541 lines PR 5 deletes; devices about 60; the administrator's route cases about 60; the dashboard about 40; R10's four suites' setup about 20) | +110 / −15 (the guide's new waiting section, both languages, and the rules) |
| **2** list the sales a wrong confirmed clock dated, and records stamped ahead (Q4) | +100 | +130 | +5 |
| **3** a synchronised restore names its series (Tasks 11-12) | +60 / −5 | +90 | +5 / −3 |
| **4** restore waits uncounted; page names the cause (Tasks 14-16) | +170 / −5 | +210 | +30 / −10 |
| **5** two functions answer "nothing"; `chain.ts` unchanged | +4 | +40 / about −8,500 (R8's 307 failing cases, by each suite's lines per case) | +35 / about −610 (the guides about −585 of it, both languages, counted with Q4 yes) |
| **6** delete the stop's code (18a, 18b, 18c) | +40 / about −2,150 (including the watch's AEAT set) | about −3,450 (the suites deleted whole, by `wc -l`; the four fiscal suites deleted whole here also lost cases in PR 5, which both rows count, so the true total is smaller) | +30 / −200 |

PRs 1-4 add about 730 production and 1,050 test lines. PRs 5-6 add about 44 production and 40 test lines, and remove about 2,150 production and 11,950 test lines. Against revision 3, PR 1 replaces PRs 1a and 1b (510 production lines before) and PR 3 loses its AEAT set (Task 13, 110 production lines before).

## Review focus

1. AEAT is asked by no start check (Tasks 1, 4) and by no synchronised restore (Tasks 11-12); nothing sets the clock from AEAT outside the old stop.
2. Two devices confirm only from two addresses, within 5 s of the box and of each other, and set nothing (Task 1); one device never confirms.
3. While waiting, every route in Task 6's table refuses before any card reader, refund send or drawer job, every seat writer refuses, and the two loops pause; the table exists before PR 5 deletes the stop's route suites.
4. No device, till or administrator confirmation reaches the series check (R5; Task 11 adds no read of confirmations).
5. No set happens while the time service is synchronised (Tasks 3, 7; the host refuses as well).
6. While payments wait, an administrator with no till and no internet can confirm or correct the clock from their own device (R9, Task 7), and the dashboard offers it (Task 8).
7. PR 5 changes exactly two functions (`clockBehindChain`, `clockStopState`), no line of `chain.ts` or the rest of the fiscal core.
8. Task 18a's grep, re-run, prints only the seat contract, `fiscal-none` and the fiscal module, so 18c builds.
9. After Task 17c, `grep` finds no description of the stop in `apps/server/src/guide/` in either language.

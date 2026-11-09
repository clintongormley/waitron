# A1420: every start confirms the box's time before it trades — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`. Keep the ledger `docs/handoffs/2026-11-09-a1420-start-clock.md` current at the end of every task.

**Revision 3 (2026-11-09).** Re-planned to the owner's answer of 2026-11-09 22:01 (verbatim in `waitron-campaign-b/questions.md`, "A1420 revision 2: OWNER's answer"). At every start of a box that files records, before it trades: (1) with the internet, a synchronised time service (NTP) is used, and AEAT disagreeing raises a dashboard alert, not emailed; not synchronised but AEAT answers, the clock is set to AEAT's time, with no one-minute margin. (2) With no internet, a till or handheld confirms the time. (3) Failing that, an administrator confirms the date, which never names a new series. (4) No block for being behind the latest invoice. A restore follows the same order. Revision 2's Q2 (how long a till may set the clock) is replaced by this design. Revision 2's experiment (R1) and restore facts (R2) still hold and are kept. Revision 2's "a start that cannot reach AEAT still trades" (its row 3, the owner's 2026-11-06 line) is replaced by point 2: such a start waits for a person's confirmation.

**What a person can do when this lands.**

- **PR 1.** A box that comes up after a power cut, with its clock right or wrong, takes no payment until its time is confirmed. When it can reach the internet that happens by itself within seconds: from its time service, or by setting its clock from the tax agency's (AEAT's) time. With no internet, staff who sign in on any till or handheld see "The server's time is not confirmed yet" with "Check the time"; one tap confirms or sets it. Orders still reach the kitchen meanwhile. Administrators get a bell alert when the time service and AEAT disagree.
- **PR 2.** An administrator can confirm the box's date on the Box status page when no till is at hand.
- **PR 3.** A restore whose box clock is out and not kept by a time service sets it from AEAT and finishes, instead of failing.
- **PR 4.** A restore that cannot reach AEAT waits and retries every minute without bringing up the start-failure page; when that page does show for a clock reason, it says which.
- **PR 5** (needs the owner's yes to touch the chain, Q2). A sale is never refused because the clock reads earlier than the last sale.
- **PR 6.** The old "clock behind the last sale" stop is gone from the server, tills and dashboard.

**Base:** `origin/main` at `049ddd9db9`. Line numbers are on that commit; match by name if a line has moved.

**Review weight: FULL, every PR.** Risk triggers: the clock in front of fiscal records and series naming (a fiscal invariant), a cross-package contract (`ModuleOperationHost`, PR 3), and the chain's append (PR 5). The plan gets a fresh-context review before any implementer is dispatched; each PR's `/finish-branch` runs the Codex run-it seat twice (the second sets this checklist aside). Every PR **waits for the owner** to land it.

## Words used in this plan

- **AEAT's time**: the `Date` header of a reply from AEAT's servers over a checked HTTPS connection. The running server reads it with `readAuthorityTime` (`packages/fiscal-verifactu/src/authority-time.ts`, 5-second limit). The header is whole seconds, so a reading carries an uncertainty of 500 ms plus half the round trip (`authority-time.ts:88-92`). "Exactly" below means within that uncertainty: about a second.
- **Time service / synchronised**: the host's own internet time keeper (systemd-timesyncd or chrony) and the `NTPSynchronized` flag the host service reads with `timedatectl show` (`deploy/box/waitron-box.sh:59-62,93`).
- **Host service**: the small root program outside Waitron's container that can set the clock (`deploy/box/waitron-box.sh`), asked through `apps/server/src/box-host-client.ts`. It refuses to set while synchronised (`waitron-box.sh:118-121`).
- **The start check** (new): each start's decision on whether its time is confirmed. Its state is one of **waiting** (nothing has confirmed it: no record is written and no money moves), **by a person** (a till or administrator confirmed it: trading, and still listening for the internet once), or **by the internet** (done).
- **The stop** (today, removed by PRs 5-6): while the clock reads more than a minute before the latest fiscal record, no record is written and no money moves (`refuseWhileClockBehind`, `packages/fiscal-verifactu/src/clock-behind.ts:167-175`).
- **The series check**: naming a new invoice series at setup, restore or promotion needs a second clock within 30 seconds of the box's (`compareHourClocks`, `packages/fiscal-verifactu/src/hour-clock.ts:63`, `AGREEMENT_MS` at `:39`).

## Global constraints

- **No table, column, index, trigger, migration or schema-file change** (A1308 hold). `clock_confirmations` already accepts reason `start` with sources `authority`, `staff` and `admin` (`packages/fiscal-verifactu/src/schema/clock-confirmations.ts:7-20`). The stop's tables stay, unwritten, after PR 6. If a step seems to need a schema change, stop and report.
- **The fiscal core is untouched in PRs 1-4 and 6**: `computeHuella`, the chain, numbering, `registros_facturacion` and its triggers, the alta builders, `allocation.ts`, `hour-selection.ts`. **PR 5 changes one call in the chain's append** (`attemptAppend`, `chain.ts:158`) and is not started without the owner's yes (Q2). After every task touching `packages/fiscal-verifactu`, this passes **unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts inmutabilidad`.
- **No new clock source.** Every set goes through the host service, from AEAT, a staff member's till, or an administrator's own device, and never while synchronised. An administrator's date confirmation sets nothing. A device alone never confirms: a staff member taps.
- **The series check is untouched except for Q1.** No till or administrator confirmation is ever read by it (R5).
- **A test that has to be edited to pass is a STOP** unless "Changed test checks" lists it.
- **User-visible words** are only those in "Words"; English and Spanish change together.
- **Real events only** (owner, 2026-11-08). Each branch names the venue event that reaches it.
- **Tests.** Each property has one owner layer. AEAT's and the host's own failure modes are already tested where they are read (`authority-time.test.ts`, `hour-clock-internet.test.ts`, `box-host-client.test.ts`); a start is tested only for what it does with each answer. A "did NOT happen" assertion runs to a stated end point and has a control in which the same fake forces the effect. Reuse `ephemeralServerFixture`, `setupVenue`, `insertFiscalRegistro`, `deviceCookieForTest`, and the fake host in `boot.clock-watch.test.ts:166-182`.
- Tests run with `AI_AGENT` and `CLAUDECODE` unset when output matters; server tests with `TESTCONTAINERS_RYUK_DISABLED=true`. Read the `Tests` count. Browser runs (`apps/dashboard`, `apps/till`, `apps/setup`): `memory_pressure | grep free` first.
- Every commit `git commit -s`, plain English. Every task ends with `pnpm format:check` and `pnpm exec eslint <changed files>`.
- **Implementer size.** Each task is sized for one implementer in well under 100 tool calls. One that passes about 150 calls stops at a passing (or cleanly failing) point, commits, and hands over.

## What is true today (receipts)

### R1. An ordinary start does not look at the clock; only a clock behind the latest record is caught (RUN, revision 2)

Revision 2's probe: a real `startServer` on a real venue database (`useVenueDb` + `setupVenue`, `WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`), the global `Date` swapped for one reading the real clock plus an offset, AEAT's `authenticatedHourHead` mocked, a fake host whose `setClock` moves the swapped clock, one fiscal record an hour before the true time. Summary of what it printed:

- **Clock 2 days ahead:** `start=ok … setsAtStart=0 aeatAsksAtStart=0`, `saleCheckAfter75s=allowed`, `aeatAsks=0`: sales dated two days ahead, nothing checks.
- **Clock 2 days behind, AEAT answers:** sales refused at first (`refused clock.behind_chain`); after about 30 s the watch set the clock from AEAT (`clock_correction.stepped`, `confirmations=["authority"]`) and sales resumed.
- **Same, AEAT unreachable:** sales stay refused; AEAT asked once a minute.
- **Flat battery, 10 minutes slow, last sale 10 min 5 s earlier:** `saleCheck=allowed`, nothing asked: sales dated 10 minutes early.
- **Every set needs a stop today** (`clock-correction.ts:221-229`; `clock-set.route.test.ts -t "refuses a set with no stop"` → `Tests 1 passed`).

Why a flat battery comes up slow (systemd(1), "System clock epoch", read, not run): the clock starts near the last save of `/var/lib/systemd/timesync/clock`, so it is slow by about the length of the cut.

### R2. The restore's start (read and run in revisions 1-2, still true)

- Only a start that places a staged restore names a series. `runEntry` runs `runStagedRestore` before `startServer` (`apps/server/src/node-entry.ts`). The module's `resume` compares clocks as a box with no browser (`packages/fiscal-verifactu/src/hosted-hour-recovery.ts:146-149`) and refuses `sif.allocation_invalid` with `reason` `second_clock_missing` (AEAT unreachable) or `clock_disagreement` (more than 30 s out). Revision 1's probe printed `internet offset=29000 canSelect=true`, `offset=31000 … clock_disagreement` and `offset=null … second_clock_missing`.
- Each start writes one failure into `recovery.json` before its first step; three in a row bring up the start-failure page (`RECOVERY_AT`, `apps/server/src/recovery-state.ts`). `withoutAttempt` takes one back.
- AEAT's failure reasons at the restore's start are `network`, `timeout`, `tls`, `response`, `configuration` and `clock-corrected` (`hour-clock-internet.ts:74-153`). Only `network` and `timeout` mean "not reachable yet".

### R3. Feasibility of point 2: the server serves tills while it is not trading (RUN, 2026-11-09)

**Harness.** A throwaway file, `apps/server/src/probe-a1420-till-at-start.test.ts` (moved out of the tree after the run; `git status --short` then printed nothing). R1's harness, with: AEAT unreachable (the mock throws `ENETUNREACH`); the host not synchronised; one enrolled till (`seedDevice` + `deviceCookieForTest`) and one staff member with a PIN; everything the till does goes over HTTP to the real listener, as the till app does: `GET /api/device/equipment` (its notices) with only the device cookie, `POST /api/session` (PIN sign-in), then `POST /api/box-clock/challenge` and `/confirm` (the till's "Check the time") with the till's true time. The sale check is `refuseWhileClockBehind` at the box's reading, as in R1. Each scenario waits 20 s after start, past the clock watch's first look at 15 s (`CLOCK_WATCH_MS`).

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

- **Yes, it is feasible, and most of it exists.** While today's stop holds, the server is fully up: an enrolled till reads its notices with nobody signed in, staff sign in by PIN, and after AEAT's first failed ask (about 15 s) "Check the time" is offered; one confirm set the box's clock from the till's time through the host and sales resumed. Sending an order to the kitchen is not among the stop's route checks (read, not run: the list in `conventions-data.md`, "Where a route's named check goes", names only payment, refund and invoice routes).
- **What the person sees.** The till shows notices only on its signed-in screens and clears them at sign-out (`apps/till/src/till-app.ts:18666-18669`), so the PIN screen shows nothing; after sign-in the line reads "Payments stopped: the server's clock reads earlier than its last sale" with "Check the time" (`apps/till/src/i18n/strings.ts:1897-1906`). The dialog shows both clocks ("The server's clock says {box}. This device says {till}.") and offers "Use this time" or "The time is right" (`strings.ts:1909-1918`). PR 1 gives the line new words for the waiting state and reuses the dialog unchanged.
- **The gap.** A clock 2 days ahead or 10 minutes slow triggers none of it: no notice, the challenge is refused `not_stopped`, sales are taken. Point 2 needs the start check's "waiting" state, not the comparison with the last sale, to open this path. That is PR 1.
- **A till or handheld already paired** is what connects. A new one cannot pair without an administrator: each start opens the pairing window shut (`apps/server/src/boot.ts`, "a restart or a promotion starts SHUT"). Read, not run.
- **At a restore's placement no till can help**: the server that serves tills starts only after placement (R2), and a till's confirmation never satisfies the series check (R5).

### R4. Why a box can be online, reach AEAT, and still not be synchronised (read, not run)

- **Waitron installs no time service.** `waitron.sh install` only runs `timedatectl set-ntp true` (`deploy/waitron.sh:325-328`); if that fails, or no time service is installed, it prints a line and carries on. The dashboard already raises `clock.sync_off` with `off`, `stopped` or `unsynchronised` (`apps/server/src/clock-sync-alert.ts`).
- **Every boot starts unsynchronised.** The flag turns "yes" only after the time service's first successful exchange. The app's container starts as soon as Docker does, so the start's first look can come first. After a power cut the venue's router usually comes back after the box, so for the first minute or more neither the time service nor AEAT can answer. This is the common case, and it is why point 2 must not hold trading longer than the internet takes to come back: the start check keeps listening and confirms by itself. Task 12 measures it on the test box.
- **The venue's network blocks the time protocol.** NTP uses UDP port 123 (timedatectl(1)'s own example: "Using Time Server 216.239.38.15:123"); AEAT is HTTPS on TCP 443. A shared, guest, hotel or shopping-centre network that lets only web traffic out gives exactly "AEAT answers, never synchronised". Task 12 blocks UDP 123 on the test box to show what the start does.
- **The reverse also happens.** A clock years out cannot complete AEAT's checked HTTPS connection (its certificate looks not yet valid or expired), so AEAT reads as unreachable while NTP still works; the time service then puts the clock right.

### R5. Who uses the stop today, and what each does after this plan (read; one claim checked)

A read-only trace of every consumer, 2026-11-09. Checked by me: `hour-clock.ts`, `hour-selection.ts`, `hour-setup-clock.ts` and `hosted-hour-recovery.ts` contain no reference to confirmations (`grep -n 'clock-confirmation\|clockConfirm'` printed nothing, exit 1), so **no till or administrator confirmation can ever let a series be named**; the series check's second clock is AEAT or, during setup, the setup page's own browser (`hour-setup-clock.ts:103-124`).

**The stop cannot be switched off at one point.** `clockStopState`'s judge compares the clock with the latest record itself (`packages/fiscal-verifactu/src/clock-confirmation.ts:63-67`) and then asks `clockBehindChain` whether a confirmation covers it (`:75`). Making only `clockBehindChain` answer "not behind" would read every behind clock as confirmed, then fail on a missing confirmation row (`:102`). So PR 5 makes the seat's stop methods answer "no stop" as a whole, and PR 6 deletes their callers.

| Consumer | Where | Today | After PR 1 | After PRs 5-6 |
| --- | --- | --- | --- | --- |
| The chain's append | `fiscal-verifactu/src/chain.ts:158` | refuses a record more than a minute before the latest | unchanged | refuses only a time before 28-10-2024 (`refuseBeforeFirstIssueDate`, `first-issue-date.ts:15-24`) |
| Route checks: till sales, bill payments and refunds, tender refunds and retry, unpaid departure, eight dashboard resolutions | `till-sale.ts:720,1180,2246`; `bill-payments.ts:1141`; `bill-refunds.ts:216,685,698`; `tender-refunds.ts:93,98`; `tender-refund-api.ts:262`; `unpaid-departure.ts:102`; `payments-api.ts:368-369` | call the seat's `refuseWhileClockBehind` | refuse `clock.unconfirmed` first while the start check waits (one wrapper in boot), then as today | `clock.unconfirmed` and `clock.unusable` only |
| Refund recovery loops; a card refund's re-check after a provider wait | `tender-refund-recovery.ts:36`; `bill-payments-loop.ts:244`; `clockStopsRefund`, `bill-refunds.ts:209-220` | pause during the stop | also pause while waiting | pause only while waiting |
| Clock watch | `apps/server/src/clock-watch.ts` | opens checks, sets from AEAT, confirms, all inside a stop | also runs the start check while waiting or confirmed by a person | only the start check's part, plus the drift and jump alerts that do not need a stop |
| Correction's admission | `clock-correction.ts:143-169,221-229` | sets only inside a stop | also admits reason `start` while the check is not answered by the internet | only reason `start`, or `clock.unusable` |
| "Check the time" (staff) and the start-up window | `till-box-clock-api.ts:158-370`; `clock-start-up.ts` | offered during a stop found at start-up, after AEAT failed | also while waiting | only while waiting, or `clock.unusable` |
| Administrator's confirm and set | `box-health-api.ts:258-371` | inside a stop only | also while waiting (PR 1 route, PR 2 screen) | only while waiting or by a person; set at any time as today |
| Clock checks, confirmations covering a step back, disproofs, the misdated-sales list and its download | `clock-checks.ts`, `clock-confirmation.ts`, `clock-stop-incidents.ts`, `clock-misdated.ts`, `box-health-api.ts:149-200` | exist only for the stop | unchanged | deleted; tables stay, unwritten (A1308) |
| Alerts, emails and till/dashboard words for `clock.behind_chain`, `_restarted`, `_disproved`, `clock.records_misdated` | `clock-behind-alerts.ts`, `box-alert-email.ts`, `staff-notices.ts`, till `pay-refusal.ts`, dashboard `box-status-rows.ts`, `alert-messages.ts` | shown and emailed | unchanged | deleted |
| `fiscal.clock_drift` hidden during the stop | `boot.ts:3106-3112`, `time-health.ts:91-112` | hidden while stopped | unchanged | hidden while waiting instead |
| Survives untouched | `clock.unusable`, `clock.corrected`, `latestClockStep` (backup hold, `backup-sweep.ts:205`), witnesses and `clock.disagrees`, `clock.sync_off`, challenges | | | |

## Decisions

**D1. The start check, at every start of a filing primary** (`filesRecords()`), in `bootServer` after the correction exists (`boot.ts:2303`) and before the trading listener binds (`boot.ts:3611`). A box that does not file records (demo, preproduction without test submissions) starts confirmed, as today. Order:

| # | Asked | Answer | What the box does | Who sees what |
| --- | --- | --- | --- | --- |
| 1 | Time service (fresh `clockStatus`, not the one-minute cache) | synchronised | confirmed **by the internet**; asks AEAT once (5 s) only to compare | administrators: `clock.authority_disagreed` bell alert, not emailed, when AEAT differs by more than a minute |
| 2 | AEAT | answers, not synchronised | if the box differs by more than the reading's uncertainty, sets the clock to AEAT's time through the host (reason `start`, source `authority`) and reads AEAT once more; confirmed **by the internet** when that reading agrees | administrators: the existing `clock.corrected` alert **and email** (§5: every step) |
| 3 | nothing (AEAT unreachable or refused, not synchronised; or 2's second reading still out; or the host refused) | — | **waiting**: the listener opens; orders still reach the kitchen; no record, no money | staff on any signed-in till: the waiting notice with "Check the time"; administrators: the bell alert `clock.unconfirmed` (PR 1) and the Box status row (PR 2) |
| 3a | a staff member's "Check the time" | the till's time | agrees within a minute: confirmed **by a person** (no set). Differs: sets the box from the till's time through the host, then confirmed by a person | existing dialog words; a set raises `clock.corrected` and its email |
| 3b | an administrator | "The date is right" (PR 2), or the existing “Check with this device's time” | confirmed **by a person**; the date confirmation sets nothing | — |
| 4 | while waiting or confirmed by a person | the watch, every 15 s, reads the time service fresh and asks AEAT at most once a minute (`AUTHORITY_EVERY_MS`) | the first internet answer is applied as rows 1-2 and confirms **by the internet**; it stops asking after that | as rows 1-2 |

There is no timer between the till and the administrator: both are offered from the first moment of waiting, and the internet coming back confirms by itself. That keeps a power cut whose router returns a minute later from needing anyone.

**D2. Waits.** At the start: one AEAT ask of at most 5 s, a host set the host bounds at 15 s (`RuntimeMaxSec=15`, `deploy/box/waitron-box@.service`), one more 5 s ask after a set: at most about 25 s before the listener binds, usually under a second. After that the listener is open whatever the answer. The watch's existing cadences are kept (15 s looks, AEAT once a minute); a host that refuses or does not verify is not asked again by the start check, and the watch tries again only after its existing back-off (`clock-watch.ts:37-38`).

**D3. "Waiting" is in memory, per process.** Each start begins waiting; nothing is stored about it except the confirmation rows (`clock_confirmations`, reason `start`, sources `authority`, `staff` or `admin`, `step_ms` 0 when nothing was set, proof `{ "dateOnly": true }` for the administrator's date). Confirmation by the time service writes a log line, not a row.

**D4. Where the gate holds.** At the route checks R5 lists, through one wrapper of the seat's `refuseWhileClockBehind` in `boot.ts`, plus the two loops and `clockStopsRefund`. The refusal is `clock.unconfirmed` (409, no params). A card already charged when the gate refuses is handled as today's stop handles it (`507 sale.charged_not_recorded`, new reason `clock_unconfirmed`). The Stripe webhook still stores a payment whose money has moved (§5: "Still store money already moved").

**D5. The restore follows the same order** (PRs 3-4). Placement names a series only on the series check. Synchronised: placement proceeds (Q1), and AEAT disagreeing by more than 30 s raises `clock.authority_disagreed` (owner, 2026-11-07). Not synchronised and AEAT answers out by more than 30 s: the host sets the clock to AEAT's time and placement runs once more in the same process. Neither: the restore waits, retrying every 60 s, uncounted (revision 2's PR 2, unchanged). After placement the started server runs D1 like any start.

**D6. The start-failure page chooses words by code and cause (PR 4)** (owner, 2026-11-07): `recovery.json` gains `lastErrorCause` from a closed set (`clock_set_failed`, `clock_moved`), kept on read only when a member.

## Owner questions

**Q1. At a restore, may a synchronised time service stand in for AEAT when AEAT cannot be reached?** Example: a box is restored on Monday at 10:00; the venue's firewall lets the time service through, but AEAT is down for maintenance. Today the series check needs AEAT (or the setup page's browser) within 30 s. *Recommended default: yes.* "Synchronised" means the time service has exchanged time with internet time servers, which are other machines; your point 1 already trusts it for ordinary starts. It changes the §5 sentence quoted below. *Alternative:* the restore waits for AEAT, retrying every minute. About 20 lines either way.

**Q2. Point 4 needs one call in the chain's append changed, which is the fiscal core. May PR 5 change it?** `attemptAppend` (`chain.ts:158`) refuses any record dated more than a minute before the latest; it is the last line of defence the routes rely on. Removing only the route checks would let a card be charged and then the sale refused, which revision A798 measured (conventions-data.md, "Why the routes need their own check"). So point 4 is either both or neither. The legal reading supports it: the adviser research (`docs/compliance/research/2026-11-06-adviser-clock.md`, 51.1) finds no rule in force for Veri\*Factu against a time earlier than the last record, but notes AEAT's acceptance is "NARROWED: nothing published refuses it. A free test settles it" (51.2). *Recommended default: yes, in its own PR, after that free preproduction test (send a record, then one stamped a minute earlier) shows AEAT accepts it.* *Alternative:* keep the chain's refusal and the stop; PRs 1-4 still land, and the stop then only ever fires for a clock confirmed by a person that reads behind the last sale.

**Q3. Does a till confirm with a staff member's tap, or by itself when it connects?** *Recommended default: a tap.* The till shows both clocks and the person chooses "The time is right" or "Use this time"; §5's "never from devices alone" stands, and a tablet whose own clock is wrong cannot confirm a wrong time unseen. *Alternative:* the first signed-in till whose clock is within a minute of the box's confirms silently. That changes §5 and about 15 lines.

## Words

| Where | English | Spanish |
| --- | --- | --- |
| Till staff notice `clock.unconfirmed` (`apps/till/src/i18n/strings.ts`, `codes.ts`), PR 1 | The server's time is not confirmed yet. Payments wait until it is. | La hora del servidor aún no está confirmada. Los cobros esperan hasta que lo esté. |
| Same, hint | the existing "Check the time" (`staff_notice.check_time`; `CHECKABLE` gains the code) | «Comprobar la hora» (unchanged) |
| Till payment refusal `sale.clock_unconfirmed`, PR 1 | Payment not recorded: the server's time is not confirmed yet. The order stays open. Use “Check the time” at the top of the screen. | Cobro no registrado: la hora del servidor aún no está confirmada. El pedido sigue abierto. Usa «Comprobar la hora» en la parte superior de la pantalla. |
| Till card charged but refused, `sale.charged_clock_unconfirmed`, PR 1 | Card charged, but the payment is not recorded: the server's time is not confirmed yet. Don't charge again. Once it is confirmed, try this payment again: it is recorded without charging again. | Tarjeta cobrada, pero el cobro no está registrado: la hora del servidor aún no está confirmada. No cobres otra vez. Cuando esté confirmada, vuelve a intentar este cobro: se registra sin cobrar otra vez. |
| Bell alert `clock.unconfirmed` (dashboard `alert-messages.ts`), PR 1 | The box has not confirmed its time since it started, so it is not taking payments. It confirms by itself once it reaches the internet. Otherwise, sign in on any till or handheld and use “Check the time”, or confirm the date on the Box status page. | El equipo no ha confirmado su hora desde que arrancó, así que no acepta cobros. La confirma solo en cuanto llega a internet. Si no, inicia sesión en cualquier terminal y usa «Comprobar la hora», o confirma la fecha en Estado del equipo. |
| Bell alert `clock.authority_disagreed`, PR 1 | When the box started, its clock ({boxAt:minute}) and the tax agency's time ({authorityAt:minute}) were {differenceMs:duration} apart. The box's time service says its clock is right, so the box kept it. Check the box's date and time on the Box status page. | Al arrancar, el reloj del equipo ({boxAt:minute}) y la hora de Hacienda ({authorityAt:minute}) se diferenciaban en {differenceMs:duration}. El servicio de hora del equipo indica que su reloj está bien, así que el equipo lo mantuvo. Comprueba la fecha y la hora del equipo en Estado del equipo. |
| Box status, Clock row while waiting (PR 2) | Not confirmed since the box started: no payments are taken. The box's clock says {boxAt:date-time}. | Sin confirmar desde que arrancó el equipo: no se aceptan cobros. El reloj del equipo indica {boxAt:date-time}. |
| Same, button | The date is right | La fecha es correcta |
| Same, help under the button | Confirming the date lets the box take payments with its own clock. Use “Check with this device's time” if the time is out by more than a few minutes. | Confirmar la fecha permite al equipo cobrar con su propio reloj. Usa «Comprobar con la hora de este dispositivo» si la hora se desvía más de unos minutos. |
| Bell and email after any set | unchanged `clock.corrected` words | unchanged |
| Restore waiting page, setup done line, start-failure page causes, guide sentence (PRs 3-4) | revision 2's words, unchanged: see the table in commit `1ce23b74ca`, rows "Start-failure page, cause …" to "Guide `backup-recovery.md`" | unchanged |
| Guide, the till's clock section (EN/ES), PR 1 | When the server starts and cannot confirm its time over the internet, signed-in tills show “The server's time is not confirmed yet”. Use “Check the time”: payments wait until someone does, or until the server reaches the internet. | Cuando el servidor arranca y no puede confirmar su hora por internet, los terminales con sesión iniciada muestran «La hora del servidor aún no está confirmada». Usa «Comprobar la hora»: los cobros esperan hasta que alguien lo haga o hasta que el servidor llegue a internet. |

The dashboard's existing button is “Check with this device's time” / «Comprobar con la hora de este dispositivo» (`box_status.clock.admin.open`, `apps/dashboard/src/i18n/strings.ts:3741,7636`).

## Root `CLAUDE.md` §5, word for word

**1. PR 1 inserts a new rule** in front of "More than a minute behind the latest fiscal record…" (line 899):

> **Every start of a box that files records confirms its time before it writes a record or moves money: a synchronised time service confirms it (AEAT disagreeing by over a minute raises a dashboard alert, not emailed); otherwise AEAT's time, which the box sets its clock to when it differs; otherwise a staff member's "Check the time" on a till or handheld, or an administrator's confirmation of the date. While it waits, orders still reach the kitchen, and the box keeps asking the internet.** Guards: `apps/server/src/start-clock-check.test.ts` and `apps/server/src/boot.start-clock-gate.test.ts`, weaker than the rule: named routes only.

**2. PR 1 changes the clock-setting sentence** (lines 909-913). Replace

> **The box sets its clock only through the host service, from AEAT, a till's time (a staff member's during start-up, an administrator's at any time) or an administrator's own device — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed.**

with

> **The box sets its clock only through the host service, from AEAT, a till's time (a staff member's while the start has not confirmed the time, an administrator's at any time) or an administrator's own device — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed.**

**3. PR 3 changes the restore sentence** (lines 928-930), only if Q1 is yes. Replace

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation); a minute whose name is already in a history the box reads is not taken.

with

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds, or, at the start placing a restore, the box's time service says it is synchronised (AEAT disagreeing then raises a dashboard alert); never on a till's or administrator's confirmation; a minute whose name is already in a history the box reads is not taken.

If Q1 is no, PR 3 still adds the alert case (owner, 2026-11-07): "…after another machine's clock agrees within 30 seconds, except that the start placing a restore keeps the clock of a box whose time service says it is synchronised when AEAT's disagrees, with a dashboard alert (no confirmation); …".

**4. PR 6 replaces the stop's rule** (lines 899-908). Replace

> **More than a minute behind the latest fiscal record, write no record and take/refund no new money unless a clock confirmation covers it.** After replay, call `refuseWhileClockBehind` before reader/refund/drawer work; pause both refund recovery loops. Recheck card-refund send/outcome in their dating transaction after provider waits. Still store money already moved. **Clock confirmation lifts the stop for one step back, with no gap limit; once a record is written under it, readings stay within a minute of the latest record written since.** Sources, never a box device outside development: [conventions-data.md](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-06). Guards: clock-behind-stop, payments clock-behind, fiscal chain/restart/confirmation, clock-confirm route and `apps/server/src/clock-watch.start-up.test.ts` suites, weaker than the rule: only named routes/readings/requests; new money routes unguarded.

with

> **A record's time is never compared with the latest record's: the start confirms the time, and a record may carry a time earlier than the one before it** (owner, 2026-11-09). After replay, call the seat's `refuseWhileClockBehind` (by then: waiting or before 28-10-2024 only) before reader/refund/drawer work; pause both refund recovery loops while waiting. Still store money already moved. Guards: `packages/fiscal-verifactu/src/chain.earlier-time.test.ts` and `apps/server/src/boot.start-clock-gate.test.ts`, weaker than the rule: named routes only; new money routes unguarded.

(PR 6 also renames `refuseWhileClockBehind` to `refuseUntilRecordable`, and the sentence follows the rename.)

## PR 1 — every start confirms the time before it trades (server and till)

### Task 1: the start check's decision (apps/server, pure)

Files: new `apps/server/src/start-clock-check.ts` and its test.

- [ ] Tests, with a fake `readAuthorityTime` (a sample or null), a fake `clockStatus`, a fake correction. End point: the check's promise settled.
  1. Synchronised, AEAT 2 days ahead → `by_internet`, no `set`, one disagreement note with both times. Control: AEAT within a minute → `by_internet`, no note.
  2. Not synchronised, AEAT 2 days behind → one `set` (reason `start`, source `authority`, offset within 1 s), then a second ask; it agrees → `by_internet`; it still disagrees → `waiting`.
  3. Not synchronised, AEAT 400 ms off with uncertainty 600 ms → no `set`, `by_internet`. Control: 1,500 ms off → one `set`.
  4. Not synchronised, AEAT null → `waiting`, no `set`. Control: case 2.
  5. The correction answers `refused`, `host_unavailable` or `unverified` → `waiting`, no second `set`.
  6. Host `available: false` and AEAT answers → as not synchronised (the host refuses or is absent; the set's own answer decides).
- [ ] Implement `startClockCheck(deps) → Promise<{ state: "by_internet" | "waiting"; note?: Disagreement }>` and `startClockState()` holding `waiting | by_person | by_internet` with `confirm(by)` and `unconfirmed()`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/start-clock-check.test.ts`.

### Task 2: records, codes and alerts (fiscal-verifactu, fiscal seat, server errors)

Files: `packages/fiscal-verifactu/src/clock-step.ts` (a step or confirmation at reason `start` writes its row with no check, as non-`behind_chain` reasons already do at `:90`), new `recordStartConfirmation(tx, { source, personId, boxAt, stepMs, proof })` beside it; `clock-stop-incidents.ts` (`clock.authority_disagreed`, warning, `system.manage`, params `boxAt`, `authorityAt`, `differenceMs`); `packages/fiscal/src/backend.ts` (optional seats); `apps/server/src/errors.ts` (`clock.unconfirmed: {}`; reason `clock_unconfirmed` on `sale.charged_not_recorded`); `apps/server/src/clock-unconfirmed-alert.ts` (an `AlertSource`, `system.manage`, raised while waiting); `apps/dashboard/src/i18n/alert-messages.ts` (both alerts' words); the area claim (follow `scripts/alert-codes.test.ts`'s failure message).

- [ ] Tests: `clock-step.test.ts` (a `start` confirmation by staff with `stepMs` 0 writes one row with no check; one by `admin` keeps the proof), `clock-stop-incidents.test.ts` (one `clock.authority_disagreed` with its three params), `clock-unconfirmed-alert.test.ts` (raised while waiting, not once confirmed: the control).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-step.test.ts src/clock-stop-incidents.test.ts`, `pnpm --filter @waitron/server exec vitest run src/clock-unconfirmed-alert.test.ts`, `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`, then the fiscal core command.

### Task 3: boot runs the check and the gate holds (apps/server)

Files: `boot.ts` (run Task 1 after `:2303` and before `:3611`; wrap the seat's `refuseWhileClockBehind` to throw `clock.unconfirmed` while unconfirmed; hand `unconfirmed()` to the two loops and `clockStopsRefund`; record the disagreement note); `clock-correction.ts` (reason `start` admitted without a stop while the state is not `by_internet`); `tender-refund-recovery.ts`, `bill-payments-loop.ts`, `bill-refunds.ts` (one condition each); `till-api.ts` and `fiscal-verifactu/src/record-remedy-routes.ts` status maps (409).

- [ ] Test, new `apps/server/src/boot.start-clock-gate.test.ts`, R3's harness (real server, fake host, mocked AEAT):
  1. AEAT unreachable, not synchronised: `POST /api/pay` for a cash counter sale answers 409 `clock.unconfirmed`; nothing written to `registros_facturacion`. Control: the same with AEAT answering → 200 and one record.
  2. AEAT 2 days ahead, not synchronised: the host receives one set before the listener's first answer; the first sale is dated within 2 s of the true time.
  3. Synchronised, AEAT 2 days off: no set; one `clock.authority_disagreed`; the sale is taken.
  4. Waiting: the tender-refund loop leaves a pending refund untouched for one pass. Control: confirmed → it completes.
- [ ] Test (`clock-correction.test.ts`, new cases only): reason `start` admitted while waiting or by a person; refused `not_stopped` once by the internet.
- [ ] `pnpm --filter @waitron/server exec vitest run src/boot.start-clock-gate.test.ts src/clock-correction.test.ts src/clock-behind-stop.refunds.test.ts src/clock-behind-stop.pay.test.ts src/boot.clock-correction.test.ts`, then the fiscal core command.

### Task 4: the watch keeps listening for the internet (apps/server)

Files: `clock-watch.ts`, `clock-watch.start-up.test.ts` (new cases).

- [ ] Tests: while waiting or by a person, a look reads the time service fresh (cache cleared) and asks AEAT at most once a minute, and hands the first answer to Task 1's decision; once by the internet, a look asks nothing for the start check. A waiting box whose time service turns synchronised is confirmed at the next look. Control: the existing "no stop" case, unedited.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-watch.start-up.test.ts src/clock-watch.test.ts`.

### Task 5: "Check the time" while waiting (server and till)

Files: `clock-start-up.ts` (`tillMayOffer` and `admit` also true while waiting, at once, without waiting for an AEAT failure, since the start already asked); `till-box-clock-api.ts` (while waiting: "The time is right" or a till within a minute writes Task 2's confirmation with `stepMs` 0; a differing till sets through the host as today, then confirms; both move the state to `by_person`); `apps/server/src/box-staff-notices.ts` or the fiscal staff-notice source (`clock.unconfirmed` while waiting); `box-health-api.ts` (`/api/box/clock-confirm` admitted while waiting, with `dateOnly: true`, writing source `admin`); `apps/till/src/i18n/strings.ts`, `codes.ts`, `staff-notices.ts` (`CHECKABLE` gains `clock.unconfirmed`), `widgets/pay-refusal.ts` (the two refusals; their words are tested in `src/i18n/t.test.ts`); the till guide sentence (EN/ES).

- [ ] Tests: `clock-start-up.test.ts` (offered while waiting with no AEAT answer yet; not once by the internet: the control). `till-box-clock-api.test.ts` (waiting, "The time is right" → one `start`/`staff` row, no host call, state `by_person`; a till 2 days off → one host set, then the row; by the internet → `not_stopped` as today). `clock-confirm.route.test.ts` (an administrator's `dateOnly` confirm while waiting → one `start`/`admin` row, no host call; once by the internet → refused). Till: `src/i18n/staff-notices.test.ts` and `src/i18n/t.test.ts` (both languages), `pnpm exec vitest run scripts/staff-notice-codes.test.ts`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-start-up.test.ts src/till-box-clock-api.test.ts src/clock-confirm.route.test.ts src/boot.clock-watch.test.ts src/guide-content.test.ts`, `pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts src/i18n/t.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`.

### Task 6: PR 1 documents

- [ ] Root `CLAUDE.md` §5 changes 1 and 2; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] `docs/developers/conventions-data.md`: a new section "Every start confirms the box's time before it trades" (D1-D4, R3, R4, the limits below). In "The box sets its own clock", replace "The box sets its clock only inside a stop it already has: the clock behind the latest record, or the clock before 28-10-2024 (`clock.unusable`). It opens no stop of its own." with "The box sets its clock inside a stop it already has (the clock behind the latest record, or before 28-10-2024), and while a start has not had its time confirmed by the internet. It opens no stop of its own." Grep the file for every other "only inside a stop" or "only during a stop" claim and fix each.
- [ ] `docs/backlog.md`: A798 slice 9c's "a clock running ahead dates sales…" line narrows to a clock that drifts ahead while the box runs.

## PR 2 — an administrator confirms the date on Box status

### Task 7: the Clock row while waiting (apps/dashboard)

Files: `apps/dashboard/src/screens/box-status-rows.ts` and the Box status screen, `apps/dashboard/src/i18n/strings.ts`, `apps/server/src/box-health.ts` (the clock read answers `waiting` with `boxAt`); the dashboard guide's Box status section (EN/ES).

- [ ] Tests: the row shows the words and the box's date while waiting, and is absent once confirmed (control); "The date is right" sends `dateOnly: true` and the row goes after the answer; a refusal shows beside the button (Forms contract). `*.a11y.test.ts` for the new state in both themes.
- [ ] `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status*.test.ts` (free memory first), `pnpm --filter @waitron/server exec vitest run src/box-health.test.ts src/guide-content.test.ts`.

## PR 3 — the restore's placement follows the same order

Revision 2's Tasks 1-3, with Q1's answer. Files and steps as revision 2 (commit `1ce23b74ca`, "PR 1", Tasks 1-3), changed as follows:

### Task 8: the comparison trusts a synchronised box (fiscal-verifactu)

- [ ] `compareHourClocks(obs, release, { boxSynchronised: true })`: AEAT 31 s ahead → `canSelectHour` true. **Q1 yes:** AEAT unavailable → true as well. **Q1 no:** → false, `second_clock_missing`. Without the option, every existing case unedited. A `clock_disagreement` refusal carries `authorityOffsetMs`; `second_clock_missing` carries `internet` (the reason).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-clock.test.ts src/hour-setup-clock.test.ts src/hour-selection.test.ts`, then the fiscal core command.

### Task 9: the restore's start supplies the time service's answer (module contract)

- [ ] Revision 2's Task 2, unchanged: `ModuleOperationHost.startClock?: { synchronised(); disagreed(note) }`, supplied only by the start placing a staged restore; the disagreement note reaches `startServer` in memory and is recorded with Task 2's incident.

### Task 10: not synchronised and out: set from AEAT and place once more (apps/server)

- [ ] Revision 2's Task 3, unchanged: move the host-step lines out of `clock-correction.ts` into `clock-host-step.ts` (a pure move; its three existing suites pass unedited), set the clock from the refusal's `authorityOffsetMs`, run placement once more, hand the step to `startServer` (reason `start`, source `authority`); a second disagreement counts with cause `clock_set_failed`.
- [ ] Root `CLAUDE.md` §5 change 3.

## PR 4 — the restore waits for AEAT without counting, and the page names the cause

Revision 2's PR 2, Tasks 7-9, unchanged (commit `1ce23b74ca`): the uncounted 60-second retry for `network`/`timeout` only, the waiting app and setup line, `lastErrorCause` with its page words. Under Q1 yes, a synchronised box never reaches this wait.

## PR 5 — the chain and the fiscal seat stop comparing with the last record (fiscal core; Q2)

Not started without the owner's yes to Q2 and the AEAT preproduction test it names.

### Task 11: one call in the append; the seat answers "no stop"

Files: `packages/fiscal-verifactu/src/chain.ts` (`attemptAppend`: `refuseWhileClockBehind(...)` becomes `refuseBeforeFirstIssueDate(...)`, +1/−4), `backend.ts` (`clockBehindLatestRecord` and `clockStopState` answer null; `refuseWhileClockBehind` keeps only the 28-10-2024 rule), and the deletion of what only they used: `clock-behind.ts`'s comparison, `clock-checks.ts`, the stop parts of `clock-confirmation.ts`, `clock-stop-incidents.ts` and `clock-behind-alerts.ts`, `clock-misdated.ts`, and their tests (R5).

- [ ] Test first: `chain.earlier-time.test.ts`: a record dated an hour before the latest is written, chained after it in `secuencia`, with its own time. Control (forced effect): one dated 27-10-2024 is refused `clock.unusable`. Watch the first fail on the current code.
- [ ] `chain.clock-behind.test.ts` is deleted (listed in "Changed test checks").
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node`, the fiscal core command **unedited**, `pnpm --filter @waitron/server exec vitest run src/boot.start-clock-gate.test.ts src/till-box-clock-api.test.ts`.

## PR 6 — delete the stop from the server, tills and dashboard

### Task 12a: server

Delete what R5's last column marks dead: the stop parts of `clock-watch.ts`, `clock-start-up.ts`'s stop branch, `till-box-clock-api.ts`'s stop admission, the misdated routes in `box-health-api.ts`, the `clock.behind_chain*` and `clock.records_misdated` emails, the `clock_behind_chain` reasons; the seat methods `clockBehindLatestRecord`, `clockStopState`, `openClockCheck`, `confirmClockStop`, `waitingClockCheck`, `closeClockCheckByItself`, `noteClockProvedWrong` from `packages/fiscal/src/backend.ts`, its fake and `fiscal-none`; rename `refuseWhileClockBehind` to `refuseUntilRecordable`. `fiscal.clock_drift` is hidden while waiting instead. Delete the stop-only suites R5 names.

### Task 12b: tills, dashboard and documents

Delete the `clock.behind_chain` notice, refusal and dialog branches in `apps/till`, and the stop rows, misdated list and alert words in `apps/dashboard`. Root `CLAUDE.md` §5 change 4. `conventions-data.md`: replace the sections "While the box's clock reads behind the latest fiscal record…" and "A confirmation of the clock lifts the stop…" with a dated pointer to this plan, and fix every claim the grep `clock-behind\|behind_chain\|records_misdated` finds in `docs/developers/`.

- [ ] Each task: the package suites of every package it touches, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/staff-notice-codes.test.ts scripts/claude-md-pointers.test.ts`.

## Task 13: on the test box (the lane runs the PR's part before it lands)

On the Debian 13 test box once the watcher reports it back, or a preproduction box the owner names, with `WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`. Record each command and its output in the PR description.

**PR 1:**

1. **Every boot starts unsynchronised (R4).** Reboot. Compare `journalctl -u systemd-timesyncd -o short-iso | grep -m1 -i 'contacted\|synchroni'` with the server's first `clock_start.*` log line. **A failing reading of R4** shows the time service synchronised before the server's first look on every one of three boots.
2. **NTP blocked, AEAT reachable.** `nft add table inet a1420; nft add chain inet a1420 out '{ type filter hook output priority 0; }'; nft add rule inet a1420 out udp dport 123 drop`. Set the clock 2 days ahead (`timedatectl set-ntp false; timedatectl set-time …; timedatectl set-ntp true`), `docker compose restart app`. **Expect:** one `clock.set` in `journalctl -t waitron-box` whose requester says `start`; `date -u` within 2 s of AEAT's `Date`; the first sale dated right. Then `nft delete table inet a1420`.
3. **No internet at all.** Unplug the WAN; restart. **Expect:** a cash sale on a till is refused with the waiting words; the signed-in till shows the notice; "The time is right" lets the next sale through. Plug the WAN back in on a second run without tapping: **expect** payments to resume by themselves within about a minute of the router being up. Time it.
4. **Flat battery** (revision 2's step 1): power off at the wall for 10 minutes with the time service stopped and the WAN unplugged; **expect** waiting at power-on, not a sale dated 10 minutes early.

**PR 3-4:** revision 2's restore step: press Make the series, block 443, press Restore backup. **Expect** the waiting line, `failures` unchanged over five minutes; unblock and expect the restore to finish within about two minutes.

**PR 5:** the AEAT preproduction test Q2 names, before the PR is opened: two records, the second stamped a minute earlier; record AEAT's answer to each.

## Deliberately unchanged, and limits

- **A box confirmed by a person trades on its own clock** until the internet answers; an administrator's date confirmation can leave it hours out (owner: "the same day would be sufficient"). The adviser research (52.1a) finds a file enough when only the time is wrong. A wrong date confirmed by a person is not caught.
- **Before PR 5**, a clock confirmed by a person that reads more than a minute behind the latest sale still meets today's stop; its existing "Check the time" and AEAT paths lift it as today.
- **Before PR 6**, a mid-day set from AEAT after a person's confirmation can step the clock back behind the latest sale and open today's stop, which then lifts by itself at the watch's next AEAT agreement (R1's behind case). After PR 5 this cannot happen.
- **Records written outside the gated routes while waiting**: a payment the card provider already took (stored, as §5 requires) and an administrator's remedy from the dashboard (anulación, corrective) are not held by the gate; they are dated by the box's clock. Both are rare in the minutes after a start; the second has the administrator in front of the Box status row.
- **A clock that drifts while the box runs** is not watched beyond D1 row 4 (A798 slice 9c, backlog).
- **Promotion and first setup are untouched**; the restore and setup pages keep their own clock check, because a person on a page can act.
- **Nothing measured on a real box yet**: R4's timing and the router path are Task 13's.

## Changed test checks

- PR 5: `packages/fiscal-verifactu/src/chain.clock-behind.test.ts` is deleted; its replacement asserts the opposite (point 4).
- PR 5 and PR 6: every suite R5 lists as testing only the stop is deleted with its code. Any OTHER existing test that has to change is a STOP.

## Size (estimates; lines added / removed)

Production and tests counted apart. The removals come from `wc -l` of the files R5 names: the stop-only fiscal files hold 1,327 production and 5,216 test lines; the server's `clock-watch.ts`, `clock-start-up.ts` and `till-box-clock-api.ts` hold 919 production lines, part of which survives, and the stop-only server suites 8,336 test lines.

| PR | Production | Tests | Docs |
| --- | --- | --- | --- |
| **1** start check and gate, server and till | +330 / −10 (Task 1: 90; 2: 70 with words; 3: 70; 4: 40; 5: 60 with words) | +370 (1.1×) | +70 / −10 |
| **2** administrator's date on Box status | +80 | +100 (incl. a11y) | +10 |
| **3** restore placement | +170 / −5 (revision 2's Tasks 1-3 plus Q1's 20) | +190 | +5 / −3 |
| **4** restore waits uncounted, page words | +190 / −5 (revision 2's PR 2) | +230 | +30 / −10 |
| **5** chain and seat (core, Q2) | +30 / −1,100 | +50 / −4,800 | +5 |
| **6** delete the stop elsewhere | +30 / −1,100 | +20 / −7,500 | +30 / −200 |

Added lines across PRs 1-4: about 770 production and 890 test, against revision 2's 590 and 670; the difference is the till and administrator paths (points 2-3). PRs 5-6 remove about 2,200 production and 12,300 test lines.

## Review focus

1. No set happens while the time service is synchronised: the start check, the till's set while waiting, the restore's set (Tasks 1, 5, 10; the host refuses as well).
2. While waiting, every route R5 lists refuses before any card reader, refund send or drawer job, and the two loops pause (Task 3).
3. A person's confirmation never reaches the series check (R5; Task 8 adds no read of confirmations).
4. A device alone never confirms: the till needs a staff member's tap (Task 5; Q3).
5. PR 5 changes exactly one call in `chain.ts` and nothing else in the fiscal core.

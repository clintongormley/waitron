# A1420: every start sets or keeps the box's clock, and a restore waits for the tax agency without counting — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`. Keep the ledger `docs/handoffs/2026-11-09-a1420-start-clock.md` current at the end of every task.

**Revision 2 (2026-11-09).** Rewritten after a fresh-eyes review and the owner's answer of 2026-11-09 20:46, whose four points govern: set the clock at start-up, because a flat clock battery after a power cut is an ordinary venue event; rely on the box's internet time service (NTP) — a box whose time service has synchronised keeps its time, raises a dashboard alert (no email, owner 20:31) and starts; use every other way §5 allows to confirm the time before waiting; give the reason for every wait. Two pull requests (coordinator, 20:30). Revision 1's design (a seat in the restore placement that also set the clock, a notes file read at the next boot) is replaced; what it measured (F2-F5 below) still holds.

**What a person can do when this lands.**

- **PR 1.** A box that comes up with its clock wrong — after a power cut with a flat clock battery, or with a clock that ran ahead — puts it right as it starts, from the tax agency's (AEAT's) time when it can reach it, and otherwise from a till's time when a staff member taps "Check the time". A box whose time service says it is synchronised keeps its own time and tells the administrators in the dashboard bell when AEAT disagrees. A restore whose start meets that same disagreement finishes instead of failing.
- **PR 2.** A restore whose start cannot reach AEAT (router still coming back, internet down) waits and tries again every minute by itself, without bringing up the start-failure page; and when the start-failure page does show for a clock reason, it says which reason and what to press.

**Base:** `origin/main` at `81790abdf1` (#2532, A1385, has landed). Line numbers are on that commit; match by name if a line has moved.

**Review weight: FULL, both PRs.** Risk triggers: the clock check in front of fiscal records and invoice-series naming (a fiscal invariant) and a cross-package contract (`ModuleOperationHost`, PR 1 Task 2). The plan gets a fresh-context review before any implementer is dispatched; each PR's `/finish-branch` runs the Codex run-it seat twice (the second sets this checklist aside). Both PRs **wait for the owner** to land them.

## Words used in this plan

- **AEAT's time**: the `Date` header of a web reply from AEAT's servers over a checked HTTPS connection. The running server reads it with the fiscal backend's `readAuthorityTime` (`packages/fiscal-verifactu/src/authority-time.ts`, AEAT's QR-check page, 5-second limit); the restore's start reads it with `observeInternetHourClock` (`hour-clock-internet.ts`, AEAT's filing address).
- **Time service / synchronised**: the box's own internet time keeper (systemd-timesyncd or chrony) and its `NTPSynchronized` flag, read through the host service's `clock.status`.
- **Host service**: the small root program outside Waitron's container that can set the clock (`deploy/box/waitron-box.sh`), asked over a socket through `apps/server/src/box-host-client.ts`.
- **The stop**: today's rule that while the clock reads more than a minute before the latest fiscal record, no record is written and no money moves (`refuseWhileClockBehind`, root `CLAUDE.md` §5).
- **The start's clock check**: new in PR 1 — the check every start makes before it takes a sale. "Unanswered" means neither AEAT nor the time service has said anything yet.
- **The count**: failed starts in a row, kept in `recovery.json`; at three the box shows the start-failure page (`RECOVERY_AT`, `apps/server/src/recovery-state.ts`).

## Global constraints

- **No table, column, index, trigger, migration or schema-file change** (A1308 hold). `clock_confirmations.reason` already allows `start` (`packages/fiscal-verifactu/src/schema/clock-confirmations.ts:14-19`). If a step seems to need a schema change, stop and report.
- **The fiscal core is untouched**: `computeHuella`, the chain, numbering, `registros_facturacion` and its triggers, `allocation.ts`, `hour-selection.ts`, the stop's comparison (`clock-behind.ts`). After every task touching `packages/fiscal-verifactu`, this passes **unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts inmutabilidad`.
- **No new clock source.** Every set goes through the host service from AEAT, a staff member's till during start-up, or an administrator's own device, and never while synchronised (§5). The one exception to "another machine's clock agrees within 30 seconds" for naming a minute is the owner's point 2, worded in "Root `CLAUDE.md` §5".
- **A test that has to be edited to pass is a STOP** unless "Changed test checks" lists it.
- **User-visible words** are only those in "Words"; English and Spanish change together.
- **Real events only** (owner, 2026-11-08). Each branch names the venue event that reaches it; no code or test for one that cannot happen.
- **Tests.** Each property has one owner layer. AEAT's and the host's own failure modes are already tested where they are read (`authority-time.test.ts`, `hour-clock-internet.test.ts`, `box-host-client.test.ts`, `clock-correction.test.ts`); a start is tested only for what it does with each answer ("a sample", "nothing", "synchronised", "set", "refused"). A "did NOT happen" assertion runs to a stated end point and has a control in which the same fake forces the effect. Reuse `ephemeralServerFixture`, `setupVenue`, `insertFiscalRegistro`, the fake host shape in `boot.clock-watch.test.ts:166-182`, and `clockStartUp`. Tests stay well under 1.5 times the production lines (Size).
- Tests run with `AI_AGENT` and `CLAUDECODE` unset when output matters; server tests with `TESTCONTAINERS_RYUK_DISABLED=true`. Read the `Tests` count. Browser runs (`apps/setup`): `memory_pressure | grep free` first.
- Every commit `git commit -s`, plain English. Every task ends with `pnpm format:check` and `pnpm exec eslint <changed files>`.
- **Implementer size.** Each task is sized for one implementer in well under 100 tool calls. One that passes about 150 calls stops at a passing (or cleanly failing) point, commits, and hands over.

## What is true today (receipts)

### R1. An ordinary start does not look at the clock at all; only a clock behind the latest record is caught, and only once the box is trading (RUN)

**Harness.** A throwaway Vitest file, `apps/server/src/probe-a1420-ordinary-start.test.ts` (deleted after; `git status --short` then printed nothing). It is `boot.clock-watch.test.ts`'s harness: a real `startServer` on a real venue database (`useVenueDb` + `setupVenue`), production-shaped (`WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`, so the box files records and asks AEAT, as a live venue does). Changes from that harness:

- **The box's clock.** The global `Date` is swapped for a subclass answering the real clock plus an offset; timers and `performance.now()` stay real. The true time is the real `Date`.
- **AEAT.** `authenticatedHourHead` (`@waitron/fiscal-verifactu/src/hour-clock-internet.js`) is mocked to answer `200` with the true time in its `Date` header, or to throw a connection error for "AEAT unreachable". The rest of `readAuthorityTime`, including its checks, runs as written.
- **The host service.** A fake whose `clockStatus` answers `available: true, service: "on", synchronised: false`. Its `setClock` moves the swapped `Date` to the target, as the real host moves the box's clock.
- **The last sale.** One fiscal record, an hour before the true time (the flat-battery cases put it 10 min 5 s before).
- **What it reads.** Whether `startServer` resolved; how many host and AEAT calls were made during the start. Then, at once and after 75 seconds, `refuseWhileClockBehind` on the venue database at the box's reading: that is the check every sale and refund route makes (`conventions-data.md`, "Where a route's named check goes"). After 75 seconds it also reads the `clock_checks`, `clock_confirmations` and `clock.*` incident rows.

**Stated before running.** A start that checks the clock and refuses prints `start=threw`. One that sets it prints `setsAtStart=1`. One that ignores the clock prints `start=ok … setsAtStart=0 aeatAsksAtStart=0`. The sale check prints `allowed` or `refused clock.behind_chain`. The control (clock right) must print `allowed` with no sets, or the probe cannot tell the cases apart.

Two earlier runs measured nothing and are not used. The first left the box not filing, so the watch never asked AEAT. The second used Vitest fake timers, whose `Date` fell 6 seconds behind the steady clock in 75 seconds; the witness store then judged AEAT's reading stale, so no set happened.

Command (each scenario selected with `-t`):
`env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/probe-a1420-ordinary-start.test.ts`

```
CONTROL boxMinusTrue=0s
CONTROL start=ok statusAsksAtStart=0 setsAtStart=0 aeatAsksAtStart=0
CONTROL saleCheckAtStart=allowed
CONTROL after75s aeatAsks=0 sets=0 requester=null boxMinusTrue=0s clockChecks=0 confirmations=[] incidents=[]
CONTROL saleCheckAfter75s=allowed
AHEAD boxMinusTrue=172800s
AHEAD start=ok statusAsksAtStart=0 setsAtStart=0 aeatAsksAtStart=0
AHEAD saleCheckAtStart=allowed
AHEAD after75s aeatAsks=0 sets=0 requester=null boxMinusTrue=172800s clockChecks=0 confirmations=[] incidents=[]
AHEAD saleCheckAfter75s=allowed
BEHIND boxMinusTrue=-172800s
BEHIND start=ok statusAsksAtStart=0 setsAtStart=0 aeatAsksAtStart=0
BEHIND saleCheckAtStart=refused clock.behind_chain
{"checkId":"0b3177d5-…","at":"2026-11-07T20:29:08.079Z","level":"info","event":"clock_watch.stop_opened"}
{"source":"authority","stepMs":172800418.929417,"verified":true,"at":"2026-11-09T20:29:23.511Z","level":"info","event":"clock_correction.stepped"}
BEHIND after75s aeatAsks=1 sets=1 requester={"source":"authority","check":"0b3177d5-…"} boxMinusTrue=0s clockChecks=1 confirmations=["authority"] incidents=["clock.corrected"]
BEHIND saleCheckAfter75s=allowed
BEHIND_NO_AEAT boxMinusTrue=-172800s
BEHIND_NO_AEAT start=ok statusAsksAtStart=0 setsAtStart=0 aeatAsksAtStart=0
BEHIND_NO_AEAT saleCheckAtStart=refused clock.behind_chain
BEHIND_NO_AEAT after75s aeatAsks=2 sets=0 requester=null boxMinusTrue=-172800s clockChecks=1 confirmations=[] incidents=[]
BEHIND_NO_AEAT saleCheckAfter75s=refused clock.behind_chain
FLAT_ONLINE boxMinusTrue=-630s
FLAT_ONLINE start=ok statusAsksAtStart=0 setsAtStart=0 aeatAsksAtStart=0
FLAT_ONLINE saleCheckAtStart=allowed
FLAT_ONLINE after75s aeatAsks=0 sets=0 requester=null boxMinusTrue=-630s clockChecks=0 confirmations=[] incidents=[]
FLAT_ONLINE saleCheckAfter75s=allowed
FLAT_OFFLINE … (the same five lines as FLAT_ONLINE, aeatAsks=0)
```

`Tests 3 passed` (control, ahead, behind), `1 passed` (behind, AEAT unreachable), `2 passed` (the flat-battery pair).

**What it means for a venue.**

- **Clock 2 days ahead.** The start does not ask the time service or AEAT, and nothing does for as long as the box runs. Every sale is recorded and filed dated two days in the future: the misdating the owner's 2026-11-06 decision calls irreparable without a corrective (A1407).
- **Clock 2 days behind.** Sales are refused from the first moment. The clock watch opens a check about 15 seconds after start, asks AEAT, and at its next look (about 30 seconds) sets the clock from AEAT's time, records the `authority` confirmation and the `clock.corrected` alert, and sales resume. This already works today. It needs AEAT to answer and the time service not to be synchronised.
- **Same, AEAT unreachable.** Sales stay refused. The box asks AEAT once a minute (`AUTHORITY_EVERY_MS`, `clock-watch.ts:22`). The existing way out is "Check the time" on a till, offered to staff during a stop found at start-up once AEAT has not answered (`clockStartUp`). Its route and host call were run: `pnpm --filter @waitron/server exec vitest run src/boot.clock-watch.test.ts -t "serves a till's check of the time"` → `Tests 1 passed`.
- **Flat battery after a 10-minute cut.** This is the owner's case. The box comes up about 10 minutes slow but less than a minute before its last sale, so no stop holds. It sells dated 10 minutes early and nothing looks, online or offline. The probe's host never synchronises. On a real box with internet the time service would put the clock right; the probe cannot show how soon.
- **Every set needs a stop today.** `clockCorrection().set` refuses `not_stopped` without one (`clock-correction.ts:221-229`). So do the administrator's route (`pnpm --filter @waitron/server exec vitest run src/clock-set.route.test.ts -t "refuses a set with no stop"` → `Tests 1 passed`) and the staff route (`till-box-clock-api.ts:171-174`).

**Why a flat battery comes up slow, not fast** (outside source, read, not run on a box). From systemd(1), "System clock epoch": «When initializing, the local clock is advanced to the epoch if it was set to a lower value.» «The epoch is set to the highest of: the build time of `systemd`, the modification time ("mtime") of `/usr/lib/clock-epoch`, and the modification time of `/var/lib/systemd/timesync/clock`.» «if the local clock is sufficiently far in the future (by default 15 years …), the hardware clock is assumed to be broken, and the system clock is rewound to the epoch.» From systemd-timesyncd.service(8): «The modification time ("mtime") of this file is updated on each successful NTP synchronization or after each `SaveIntervalSec=` time interval». So with a flat battery the clock starts near the last save before the cut, which is slow by about the length of the cut. A clock running ahead comes from something else, such as a wrong battery clock under 15 years ahead. Plan Task 10 checks this on the test box.

### R2. The restore's start, and what has not changed since revision 1

- **F1 (still true).** Only a start that places a staged restore makes a series. `runEntry` runs `runStagedRestore` before `startServer` (`apps/server/src/node-entry.ts`). The module's `resume` compares clocks as the box with no browser (`packages/fiscal-verifactu/src/hosted-hour-recovery.ts:146-149`). The activation refuses `sif.allocation_invalid` with `reason` `second_clock_missing` (AEAT unreachable) or `clock_disagreement` (more than 30 seconds out). The 30 seconds is `AGREEMENT_MS` (`hour-clock.ts:39`), measured against AEAT's filing address. Revision 1's probe printed `internet offset=29000 canSelect=true`, `offset=31000 … clock_disagreement` and `offset=null … second_clock_missing`.
- **F3 (still true).** Each start writes one failure into `recovery.json` before its first step, and at three in a row the box shows the start-failure page. A start refused because a live process holds the venue folder is taken back (`withoutAttempt`); that is where "do not count this one" goes. The process then exits and Docker starts it again (`restart: unless-stopped`, `deploy/compose.yml`).
- **F4/F5 (still true).** The running server's correction asks the host and verifies the step within 2 seconds (`VERIFY_MS`). It records through `confirmClockStep`, which writes the `clock.corrected` alert, and hands that alert to the email duty. The host refuses `synchronised` itself (`waitron-box.sh`). The server caches the host's status for a minute (`boot.ts:3061-3062`). `confirmClockStep` writes a row with no check for any reason other than `behind_chain` (`clock-step.ts:90`).
- **AEAT's failure reasons at the restore's start** are `network`, `timeout`, `tls`, `response`, `configuration` and `clock-corrected` (`hour-clock-internet.ts:74-153`). Only `network` and `timeout` mean "not reachable yet".
- **The restore's start, with a clock already checked.** The restore page checks the clock when the person presses Make the series (the fresh-eyes review's probe). The start that places it follows on the same machine, after the container restarts, not the machine. So a clock disagreement at placement needs the machine itself to restart in between (a power cut) or the time service to step the clock in between. Both are real but rare. AEAT being unreachable at that moment (a router still coming back) is the common failure, and it is PR 2. Read, not run.

## Decisions

**D1. Every start checks the clock before it takes a sale.** In `bootServer`, on the primary of a box that files records (`filesRecords()`), after the venue database and the correction exist (`boot.ts:2283-2297`) and before the trading listener opens. A non-filing box (demo, preproduction without test submissions) does not check, as today, because it never asks AEAT. Order of sources:

| # | Source asked | Answer | What the box does | What a person sees |
| --- | --- | --- | --- | --- |
| 1 | Time service (`clockStatus`) | synchronised | keeps its clock; still asks AEAT once (row 2) to compare | — |
| 2 | AEAT (`readAuthorityTime`, 5-second limit) | within a minute | nothing; the check is answered | — |
| 2a | | more than a minute out, **synchronised** | keeps its clock (owner point 2); records `clock.authority_disagreed` | administrators: bell alert, no email |
| 2b | | more than a minute out, **not synchronised** | sets the clock to AEAT's time through the host (`clockCorrection().set`, reason `start`, source `authority`), then asks AEAT once more (the review's I3); if the second reading is still out, the check stays unanswered (row 3) | administrators: the existing `clock.corrected` bell alert **and email** (§5 requires both for every step) |
| 3 | nothing (AEAT unreachable or refused, time service not synchronised, or 2b's second reading still out) | — | **starts and trades** (owner, 2026-11-06: "Being unable to reach AEAT never stops trading"); the check stays unanswered. While it is, the watch's existing looks (every 15 s, `CLOCK_WATCH_MS`) read the time service and ask AEAT at most once a minute (`AUTHORITY_EVERY_MS`), and apply rows 1-2b to the first answer | — |
| 3a | a till's time (§5: "a staff member's during start-up") | a till's own clock, sent with its notice poll, differs from the box's by more than a minute while the check is unanswered | that till shows "Check the time"; a staff member's tap sets the box's clock from the till's time through the existing staff route, as today during a stop | staff at that till: the notice in Words; administrators: `clock.corrected` alert and email (existing) |
| 3b | an administrator's own device (§5) | the administrator uses the Box status page's existing set | the existing admin route, now admitted while the check is unanswered as well as during a stop | administrators: `clock.corrected` alert and email (existing) |
| 4 | fallback | nothing answers and no till differs | the box keeps trading on its own clock. If that clock reads more than a minute before the latest record, today's stop holds sales and offers "Check the time" as it does now | the existing stop notices |

Rows 2b and 3a/3b are the only new kinds of set: outside a stop and inside the start's check. No new source. A device alone never sets the clock: 3a needs a staff member's tap.

**D2. Waits and retries, each with its reason.**

- **AEAT at the start: one ask, at most 5 seconds** (`AUTHORITY_TIME_DEADLINE_MS`, existing). A reply slower than 5 seconds carries too much uncertainty to judge a one-minute margin. The start is delayed by at most this, plus the host's set, which the host bounds at 15 seconds (`RuntimeMaxSec=15`, `deploy/box/`), plus one more 5-second ask after a set. Worst case about 25 seconds. The usual case is under a second.
- **While unanswered: AEAT at most once a minute, the time service every 15 seconds** (cached for a minute). Both cadences already exist and are not changed. A venue's router coming back after a power cut, or its line returning after an outage, is noticed within about a minute of the internet being back; asking more often would only add requests while it is down. Task 10 measures, on the test box, how long the router path takes. That figure is not measured yet, and none of these lengths depends on it.
- **No repeat of a refused set at the start.** A host that refuses (time service switched on meanwhile, or `busy`) or does not verify is not asked again by the start. The watch's existing back-off (10 minutes, doubling to 4 hours, `clock-watch.ts:37-38`) still applies inside a stop. The reason: the host refused for a reason, and a time service turning on will put the clock right itself.
- **The restore's uncounted retry (PR 2): every 60 seconds.** It applies only while AEAT is unreachable (`network` or `timeout`). It is the same one-minute cadence, for the same reason. Each try also repeats the restore's archive checks, so trying faster would cost more than it gains. There is no overall limit, because the box cannot trade until the restore is placed and waiting costs nothing. A refused secure connection (`tls`), an unusable reply (`response`) or a configuration fault is not a network that will come back, so it counts as today.

**D3. The restore's start meets the same answers (PR 1, Tasks 1-3).**

- **Synchronised and AEAT disagrees by more than 30 seconds.** The comparison admits the selection (owner point 2), and the start hands `clock.authority_disagreed` to `startServer` in memory, which records it with D1's alert. Both run in one process, so no file is needed.
- **Not synchronised, AEAT reachable and out.** The refusal `clock_disagreement` now carries AEAT's offset. `runEntry` asks the host to set the clock by it. The step uses the same helper the correction uses (Task 3), verified within 2 seconds. Then `runEntry` runs the placement **once more in the same process**, which takes a fresh AEAT reading: that is the re-compare. If it passes, the step's record is handed to `startServer` and written through `confirmClockStep` (reason `start`, source `authority`) before the backup supervisor starts; the alert is emailed. If it does not pass, the start counts, with cause `clock_set_failed` (PR 2's words).
- **AEAT unreachable.** There is no till or administrator at this point: the server that would serve them starts only after placement. So the restore waits (PR 2).
- **Synchronised but AEAT unreachable.** The box waits too, because naming a minute needs a second clock (§5). Whether a synchronised time service may stand in for AEAT here is **Q1**.

**D4. The disagreement alert is a one-off bell incident for `system.manage`, never emailed** (owner 20:31). One per start at most; a later start that also disagrees records another. Params `boxAt`, `authorityAt`, `differenceMs`.

**D5. The start-failure page chooses words by code and cause (PR 2)** (owner, 2026-11-07, option (b) of A1385 Q2). `recovery.json` gains `lastErrorCause`, from a closed set, kept on read only when it is a member (as `holderKind` is). The causes are `clock_set_failed` (the host refused, did not answer or did not verify, or the re-compare still disagreed) and `clock_moved` (AEAT's reading was unusable because the clock moved while it was asked: `clock-corrected`). Any other `sif.allocation_invalid` reason keeps #2532's words.

**D6. Waiting tries do not grow the start-failure log (PR 2).** A start taken back as waiting writes its one line to the server log (`server.start_waiting_for_internet_clock`, with the `internet` reason) and nothing to the file the recovery page reads its tail from. So an hour offline does not push the real failure out of the page's tail.

## Owner questions

**Q1. At a restore, when AEAT cannot be reached but the box's time service says it is synchronised, may the box use its own time and finish?** Example: a box is restored on Monday at 10:00; the venue's firewall lets the time service through but AEAT is down for maintenance. *Built default:* it waits, retrying every minute (PR 2), because §5 names a minute only "after another machine's clock agrees within 30 seconds", and the box's own synchronised flag is not a reading Waitron takes of another machine. *Alternative:* count "synchronised" as that second clock. That is a source §5 does not allow today, so it needs your yes and a §5 change: "…after another machine's clock, or the box's synchronised time service, agrees…". About 20 more lines (Task 1's comparison and one test).

**Q2. How long does "during start-up" last for a staff member's "Check the time"?** Today it lasts while a stop found at start-up lasts. PR 1 also opens it while the start's clock check is unanswered and a till's clock differs from the box's by more than a minute. With the internet down all day, that can be all day. *Built default:* until AEAT or the time service answers or someone confirms, because the till is then the only source there is. *Alternative:* close it after the first hour of trading. That is about 10 lines, and after that only an administrator could set the clock.

## Words

| Where | English | Spanish |
| --- | --- | --- |
| Bell alert `clock.authority_disagreed` (`apps/dashboard/src/i18n/alert-messages.ts`), PR 1 | When the box started, its clock ({boxAt:minute}) and the tax agency's time ({authorityAt:minute}) were {differenceMs:duration} apart. The box's time service says its clock is right, so the box kept it and carried on. Check the box's date and time on the Box status page. | Al arrancar, el reloj del equipo ({boxAt:minute}) y la hora de Hacienda ({authorityAt:minute}) se diferenciaban en {differenceMs:duration}. El servicio de hora del equipo indica que su reloj está bien, así que el equipo lo mantuvo y siguió. Comprueba la fecha y la hora del equipo en Estado del equipo. |
| Till staff notice `clock.unchecked`, main (`apps/till/src/i18n/codes.ts`), PR 1 | The server's clock and this till's clock are different. | El reloj del servidor y el de este terminal no coinciden. |
| Same, hint | the existing `staff_notice.check_time` words (`checksTime` gains this code) | unchanged |
| Bell alert and email after any start's step | unchanged `clock.corrected` words ("The box set its clock from the tax agency's time: …", and the staff/admin variants) | unchanged |
| Start-failure page, cause `clock_set_failed` — title (PR 2) | The box could not set its clock. | El equipo no pudo poner su reloj en hora. |
| Same — action | Its clock is more than 30 seconds from the tax agency's time, and setting it did not work. Press “Retry a normal boot” to try again. | Su reloj se aparta más de 30 segundos de la hora de Hacienda y no se pudo poner en hora. Pulsa «Reintentar un arranque normal» para intentarlo de nuevo. |
| Start-failure page, cause `clock_moved` — title | The box could not check its clock. | El equipo no pudo comprobar su reloj. |
| Same — action | Its clock changed while the box was comparing it with the tax agency's time. Press “Retry a normal boot” to check again. | Su reloj cambió mientras el equipo lo comparaba con la hora de Hacienda. Pulsa «Reintentar un arranque normal» para comprobarlo de nuevo. |
| Waiting page (box's address while the restore waits) — title (PR 2) | The box is waiting for the tax agency's time. | El equipo está esperando la hora de Hacienda. |
| Same — body | It needs that time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | La necesita para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Setup done screen, under "The server is restarting to finish setup." (`done.waiting_internet_clock`) | The box is waiting for the tax agency's time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | El equipo está esperando la hora de Hacienda para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Guide `backup-recovery.md` (EN/ES), replacing #2532's sentence after "If the clock check refuses, resolve its cause and try again." (PR 2) | If the box cannot get the tax agency's time when it restarts to finish the restore, it tries again every minute by itself; connect it to the internet if it is not. If it then shows a page saying it could not set or check its clock, do what that page says. | Si al reiniciarse para terminar la restauración el equipo no puede obtener la hora de Hacienda, lo vuelve a intentar solo cada minuto; conéctalo a internet si no lo está. Si después muestra una página que dice que no pudo poner en hora o comprobar su reloj, haz lo que indica esa página. |
| Guide, the till's clock section (EN/ES), one sentence (PR 1) | When the server starts without the tax agency's time and a till's clock is different, that till shows “Check the time”. | Cuando el servidor arranca sin la hora de Hacienda y el reloj de un terminal no coincide, ese terminal muestra «Comprobar la hora». |

The till already words the button "Check the time" / "Comprobar la hora" (`staff_notice.check_time`, pinned in `apps/till/src/i18n/strings.test.ts:304-305`); the guide sentence uses those words.

## Root `CLAUDE.md` §5, word for word

**PR 1, the "Restore and promotion" entry (lines 924-926).** Replace

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation); a minute whose name is already in a history the box reads is not taken.

with

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation), except that the start placing a restore keeps the clock of a box whose time service says it is synchronised when AEAT's disagrees, with a dashboard alert; a minute whose name is already in a history the box reads is not taken.

**PR 1, the clock-setting entry (lines 905-909).** Its rule sentence is unchanged, because the sources are unchanged. After "…is alerted and emailed.**", insert this new sentence:

> **Every start of a filing box compares its clock with AEAT before it takes a sale: a synchronised box keeps its clock and raises a dashboard alert when AEAT disagrees by over a minute; otherwise the box sets it from AEAT, or, with AEAT unreachable, a till whose clock differs offers staff "Check the time"; unable to reach AEAT, it still trades.**

In the guard list, add `` `apps/server/src/start-clock-check.test.ts` ``.

## PR 1 — every start sets or keeps the clock, and carries on

### Task 1: the restore's comparison can trust a synchronised box, and its refusal carries AEAT's offset (fiscal-verifactu)

Files: `packages/fiscal-verifactu/src/hour-clock.ts`, `hour-clock.test.ts`, `hour-setup-clock.ts`, `hour-setup-clock.test.ts`, `errors.ts` (optional params on `sif.allocation_invalid`: `authorityOffsetMs?: number`, `internet?: string`).

- [ ] Tests (`hour-clock.test.ts`): `compareHourClocks(obs, release, { boxSynchronised: true })` with AEAT 31 s ahead → `canSelectHour` true. Same without the option → false and `clock_disagreement` (control; the existing cases stay unedited). With the option and AEAT unavailable → false and `second_clock_missing`: synchronised never stands in for a missing second clock (Q1's default). In `hour-setup-clock.test.ts`: a reading made with `boxSynchronised: true` keeps it on `read`. A `clock_disagreement` refusal's params carry `authorityOffsetMs` within 1 s of +31 000, and a `second_clock_missing` refusal carries `internet: "network"`.
- [ ] Implement. The option's third parameter admits `disagreement` only when `secondClock` is true; the release and range checks are unchanged.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-clock.test.ts src/hour-setup-clock.test.ts src/hour-selection.test.ts`, then the fiscal core command.

### Task 2: the restore's start tells the module whether the box is synchronised (module contract)

Files: `packages/module/src/operation-preparation.ts` (type), `packages/provisioning/src/first-setup-runtime.ts` (`createModuleOperationHost` passes it through), `packages/fiscal-verifactu/src/hosted-hour-recovery.ts` and its test; `apps/server/src/recovery-preparation.ts`, `recovery-entry.ts`, `restore-request.ts` (the start's runner supplies it; the page runner does not).

- [ ] Add to `ModuleOperationHost`, with one comment saying only the start placing a staged restore supplies it:
  ```ts
  startClock?: {
    synchronised(): Promise<boolean>; // false when the host service does not answer
    disagreed(note: { boxAt: string; authorityAt: string; differenceMs: number }): void;
  };
  ```
- [ ] Tests (`hosted-hour-recovery.test.ts`), through `configure!(host).resumeRecovery` then `prepare` as existing cases do:
  1. AEAT 31 s ahead with `synchronised` → true: `prepare` admits, and `disagreed` is called once with the two times about 31 000 ms apart.
  2. The same with `synchronised` → false: it throws `clock_disagreement` with `authorityOffsetMs`, and `disagreed` is never called. The end point is the thrown refusal; case 1 is the control.
  3. No seat: today's refusal (the existing cases, unedited).
- [ ] Test (`apps/server/src/restore-request.test.ts` or `recovery-entry`'s existing suite, whichever builds both runners): the start's runner hands the seat to the module, and `createInteractiveRecoveryPreparation` does not.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hosted-hour-recovery.test.ts`, `pnpm --filter @waitron/server exec vitest run src/restore-request.test.ts src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts`, `pnpm exec vitest run scripts/module-seams.test.ts`, then the fiscal core command.

### Task 3: the restore's start sets the clock and tries the placement once more (apps/server)

Files: new `apps/server/src/clock-host-step.ts` (lines `clock-correction.ts:285-311` moved, a pure move) and its test; `clock-correction.ts` (calls it); `node-entry.ts`; `start-clock-note.ts` (new, the in-memory note type handed to `startServer`).

- [ ] Move first. `stepClockThroughHost({ host, offsetMs, requester, wall, monotonic, boot })` → `{ verified, moved, stepMs, before, after, answer }`. `clock-correction.test.ts`, `clock-correction.backup-hold.test.ts` and `boot.clock-correction.test.ts` pass **unedited**. The new test covers the three host answers once (lands within 2 s, refuses unmoved, throws).
- [ ] Tests in `node-entry.test.ts`, with a `runStagedRestore` stub and a fake host:
  1. The first placement throws `clock_disagreement` with `authorityOffsetMs: 300 000` and the host says not synchronised. Expect: the host is asked once to set with requester `{"source":"authority","start":"restore"}`; placement runs a second time; `startServer` receives one step note. Control: the same stub with `synchronised: true` asks nothing and counts the start.
  2. Set, and the second placement still throws `clock_disagreement` → the start counts, with cause `clock_set_failed` (PR 2 adds the page words; PR 1 only records the cause name in the log).
  3. The host refuses, or answers `available: false` → the start counts and placement is not run again. The end point is `runEntry` settled; case 1 is the forced-effect control.
- [ ] Implement. `pnpm --filter @waitron/server exec vitest run src/clock-host-step.test.ts src/node-entry.test.ts src/clock-correction.test.ts src/clock-correction.backup-hold.test.ts src/boot.clock-correction.test.ts`.

### Task 4: the ordinary start's clock check (apps/server)

Files: new `apps/server/src/start-clock-check.ts` and its test; `clock-correction.ts` (reason `start`: admitted without a stop, only through the start check, at most once per process); `boot.ts` (runs it before the trading listener; records notes handed in by Task 3; holds the "unanswered" flag); `clock-watch.ts` (while unanswered: reads the time service and asks AEAT on its existing cadence, and applies the check to the first answer); `packages/fiscal-verifactu/src/errors.ts` and `clock-stop-incidents.ts` (`clock.authority_disagreed`, `recordAuthorityDisagreed`, warning, `system.manage`); `packages/fiscal/src/backend.ts` (optional seat `recordAuthorityDisagreed?(tx, note)`); `apps/dashboard/src/i18n/alert-messages.ts`; the area claim for the new code (follow `scripts/alert-codes.test.ts`'s failure message).

- [ ] Tests (`start-clock-check.test.ts`), with a fake `readAuthorityTime` answering a sample or null, a fake `clockStatus`, and a fake correction. Each case states its end point as "the check's promise settled":
  1. Synchronised, AEAT 2 days ahead → no `set`; one `recordAuthorityDisagreed`. Control: not synchronised → one `set` with reason `start` and an offset within 1 s of 2 days.
  2. Not synchronised, AEAT 2 days behind → one `set`, then a second AEAT ask. That reading agrees → answered. That reading still disagrees → unanswered.
  3. AEAT answers null → unanswered, no `set`. Control: case 1's control.
  4. Within a minute → answered, nothing recorded.
  5. The correction refuses (`refused`, `host_unavailable`, `unverified`) → unanswered, and no second `set` within this check.
- [ ] Test (`clock-correction.test.ts`, new cases only): reason `start` is admitted with no stop the first time and refused `not_stopped` the second time in the same process. A step at reason `start` writes a `clock_confirmations` row with `reason = 'start'` and the `clock.corrected` alert, and is handed to the email duty.
- [ ] Test (`clock-stop-incidents.test.ts`): `recordAuthorityDisagreed` writes one `clock.authority_disagreed` incident with the three params.
- [ ] Test (one case in `boot.clock-correction.test.ts`, which already boots with a fake host): with `readAuthorityTime` 2 days ahead and a not-synchronised host, the host receives the set before the listener first answers a request. This is the wiring; the branches are owned by `start-clock-check.test.ts`.
- [ ] Test (`clock-watch.start-up.test.ts`, new cases): while unanswered and with no stop, a look asks AEAT once a minute and hands the first sample to the check. Once answered, a look with no stop asks nothing. Control: the existing "no stop" case.
- [ ] `pnpm --filter @waitron/server exec vitest run src/start-clock-check.test.ts src/clock-correction.test.ts src/boot.clock-correction.test.ts src/clock-watch.start-up.test.ts src/clock-watch.test.ts`, `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-stop-incidents.test.ts`, `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`, then the fiscal core command.

### Task 5: a till that disagrees offers "Check the time" while the check is unanswered; staff and administrator sets are admitted then

Files: `apps/server/src/clock-start-up.ts` (`tillMayOffer` and `admit` gain "unanswered, and this till's clock differs by more than a minute"), `till-box-clock-api.ts` (admitted while unanswered, as during a stop), `clock-set.route` file (the administrator's set, the same widening), `clock-correction.ts` (`admission` also passes while unanswered for sources `staff` and `admin`), the staff-notice source that emits `clock.unchecked`, `apps/till/src/i18n/codes.ts` and `staff-notices.ts` (`CHECKABLE` gains `clock.unchecked`).

- [ ] Tests: `clock-start-up.test.ts` (offered only while unanswered **and** a fresh reading from this device disagrees by more than a minute; not offered when it agrees — the control). `till-box-clock-api.test.ts` (a staff confirm while unanswered with no stop sets through the host; once answered the same request is refused `not_stopped`, as today). `clock-set.route.test.ts` (the same pair for an administrator; "refuses a set with no stop" stays unedited and still passes once the check is answered). `staff-notices.test.ts` (the code's words in both languages, with the Check the time hint). `pnpm exec vitest run scripts/staff-notice-codes.test.ts`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-start-up.test.ts src/till-box-clock-api.test.ts src/clock-set.route.test.ts src/boot.clock-watch.test.ts`, `pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts`.

### Task 6: PR 1 documents

- [ ] Root `CLAUDE.md` §5 as above; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] `docs/developers/conventions-data.md` → "The box sets its own clock". Replace "The box sets its clock only inside a stop it already has … It opens no stop of its own." (lines 4478-4480) with: "The box sets its clock inside a stop it already has (the clock behind the latest record, or before 28-10-2024), and at a start whose clock check finds it more than a minute from AEAT's time, or a restore's start more than 30 seconds out, while the time service is not synchronised. It opens no stop of its own." Then add a paragraph naming D1's table, D2's waits, and the in-memory note from the restore's start (lost if the process dies between the step and the record; the host's journal line remains). Grep the file for every other "only inside a stop" or "only during a stop" claim and fix each.
- [ ] Till guide (EN/ES) sentence (Words). `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] `docs/backlog.md`. A798 slice 9c's "a clock running ahead dates sales…" line: PR 1 covers the case at the start when AEAT answers. Narrow that line to what is left (a clock that drifts ahead while the box runs, and a start with no internet and no till that differs), and say so in the commit.

## PR 2 — the restore's start waits for AEAT without counting, and the start-failure page names the cause

### Task 7: a restore's start that cannot reach AEAT waits, uncounted (apps/server)

Files: `apps/server/src/node-entry.ts`; new `start-clock-waiting.ts` (the waiting app) and its test; `apps/server/src/errors.ts` (`server.waiting_for_internet_clock: {}`); `i18n/recovery-page.ts` (waiting page words).

- [ ] Tests (`node-entry.test.ts`, a `runStagedRestore` stub, a fake `serveRecovery`, fake timers). Each case's end point is `runEntry` settled:
  1. `second_clock_missing` with `internet: "network"` → the count after equals the count before; the waiting app is served, closed at 60 000 ms and not before; the start-failure log file has the same length as before. Control (forced effect): `internet: "tls"` → the count rises by one and the log grows.
  2. `internet: "timeout"` → as case 1.
  3. Three `network` starts in a row → the box state is still `normal`.
- [ ] Tests (`start-clock-waiting.test.ts`): `GET /` (HTML) → 503, `Retry-After: 60`, the words in English, and in Spanish with `Accept-Language: es`. `GET /setup-api/status` → 503 `{ error: { code: "server.waiting_for_internet_clock" } }`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts src/start-clock-waiting.test.ts`, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

### Task 8: the setup page says what the box is waiting for

Files: `apps/setup/src/screens/done-screen.ts` and its test, `apps/setup/src/i18n/strings/finish.ts`.

- [ ] Test: a poll answered 503 with `server.waiting_for_internet_clock` shows the waiting line under the restarting line. A following poll that fails to connect keeps it (between tries nothing answers). A 404 (trading) shows "ready" and drops it.
- [ ] `pnpm --filter @waitron/setup exec vitest run src/screens/done-screen.test.ts src/screens/done-screen.a11y.test.ts` (free memory first).

### Task 9: the start-failure page names the cause

Files: `recovery-state.ts` (`lastErrorCause`), `node-entry.ts` (`failStart` sets it; Task 3 already chose the cause names), `recovery-surface.ts`, `i18n/recovery-page.ts`.

- [ ] Tests: `recovery-state.test.ts` (a cause outside the set is dropped on read; `withFailureCode` clears a stale one). `node-entry.test.ts`: Task 3's `clock_set_failed` reaches the state; `clock-corrected` → `clock_moved`; `minute_in_use` → no cause. `recovery-surface.test.ts`: each cause's words in both languages; no cause → #2532's words (its case stays unedited).
- [ ] `pnpm --filter @waitron/server exec vitest run src/recovery-state.test.ts src/node-entry.test.ts src/recovery-surface.test.ts`.

### Task 10: on the test box (the lane runs this before each PR lands)

On the Debian 13 test box once the watcher reports it back, or another preproduction box the owner names. `sudo bash waitron.sh install <branch>`, with `WAITRON_FISCAL_TEST_SUBMISSIONS=enabled` so the box asks AEAT.

**PR 1:**

1. **Flat battery, as the box really boots.** `timedatectl show -p NTPSynchronized`, `stat -c %y /var/lib/systemd/timesync/clock`. Stop the time service, then power the box off at the wall for 10 minutes. Real battery removal is not asked for; say whether it was done. Before power-on, unplug the WAN. **Expect:** `date -u` right after boot is near the clock file's time, not ahead; this checks R1's systemd reading. Plug the WAN back in and time `ip route get 1.1.1.1` and the first `curl -sI https://prewww1.aeat.es/`: that is the router path D2 assumes takes about a minute or more. **A failing run** shows the clock ahead of the true time, or the server log showing no `clock_start.*` line.
2. **Clock out, not synchronised, AEAT answers.** Stop the time service, `sudo timedatectl set-time "@$(( $(date +%s) + 172800 ))"`, `docker compose restart app`. **Expect:** `journalctl -t waitron-box` shows one `clock.set` whose requester says `start`; `date -u` is within 2 s of AEAT's `Date`; the bell and the demo mailbox have the step. **Failing run:** a sale is taken dated two days ahead (`registros_facturacion`'s latest time).
3. **Synchronised, nothing to set.** With the time service running, restart. **Expect:** no `clock.set` line. AEAT's clock cannot be moved, so the disagreement alert is not run for real; say so in the PR. Task 4 covers it with a stubbed AEAT.
4. **AEAT unreachable, a till differs.** Block outbound 443 (the nft commands from revision 1) and set the box 5 minutes slow. **Expect:** sales are taken, and a till whose clock is right shows the notice; tapping Check the time sets the box. **Failing run:** no notice after a minute.

**PR 2:** revision 1's step 2, unchanged: press Make the series, block 443, press Restore backup. **Expect:** the waiting line and page; `failures` unchanged over five minutes; one log line a minute; the start-failure log not grown (`wc -c` before and after). Unblock and expect the restore to finish within about two minutes. Report one try's length from the log times.

Record each command and its output in the PR description.

## Deliberately unchanged, and limits

- A clock that drifts ahead **while the box runs** is still not watched outside a stop (A798 slice 9c, backlog). PR 1 covers only what a start sees.
- A start with no internet and a slow clock still within a minute of the latest record, and with no till that differs, sells on its own clock (row 4). R1's flat-battery offline case is exactly this. A till differs in the usual case, so the notice shows. Nothing else can be asked without a new source.
- Promotion and first setup are untouched. The restore and setup pages keep refusing a disagreement on a synchronised box, because a person on a page can act.
- A box whose clock is years out cannot complete AEAT's checked HTTPS connection (its certificate looks not yet valid or expired), so AEAT reads as unreachable (`tls`). The ordinary start then trades with the check unanswered (row 3). The restore counts (PR 2 waits only for `network`/`timeout`), and the time service puts the clock right within seconds of reaching the internet. Read, not run.
- The restore's step note lives in memory. If the process dies between the step and `startServer`'s record, the alert is lost; the host's journal line remains.

## Changed test checks

None expected. Any existing test that has to change is a STOP.

## Size (estimates; lines added / removed)

| | Production | Tests | Test support | Docs |
| --- | --- | --- | --- | --- |
| **PR 1** | +400 / −45 (Task 1: 40; 2: 50; 3: 70 plus a 40-line move; 4: 140 with words; 5: 60 with words) | +440 (1.1× production) | +0 (reuses the fixtures named in Global constraints) | +60 / −15 |
| **PR 2** | +190 / −5 (Task 7: 100 with words; 8: 25; 9: 65) | +230 (1.2×) | +0 | +30 / −10 |

Revision 1 was about 650 production and 1,300 test lines in one PR. The difference comes from dropping the notes file, the seat's `set` and its five-way branch table, testing AEAT's and the host's failures only where they are read, and putting each start branch in one pure check with one wiring case.

## Review focus

1. No set happens while the time service is synchronised, at the start check, the restore's set or the widened staff and administrator routes (Tasks 3, 4 and 5; the host refuses as well).
2. Reason `start` is admitted without a stop once per process, and only through the start check (Task 4).
3. A waiting restore leaves the count and the start-failure log where it found them, and only `network`/`timeout` wait (Task 7).
4. A device alone never sets the clock: Task 5's notice needs a staff member's tap.
5. Q2's reading of "during start-up" is stated, not assumed.

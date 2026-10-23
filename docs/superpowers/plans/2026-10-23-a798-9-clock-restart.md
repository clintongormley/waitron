# A798-B slice 9 — devices report their clock, `clock.disagrees`, `clock.unusable` in the bell, the manager's restart, and the clock-stop email

> **Revision 3 (2026-10-23).** Folds in the narrow round-3 check
> (`~/waitron-campaign-b/a798-9-plan-review/round3.md`, logs in `r3/`: I1, I2, M1–M6), marked
> **[r3 …]**. Under a restart each reading is now held to the LATEST TIME among the records written
> under it (a running maximum), so a clock walking back 59 s at a time stops at its second step; and
> the anchor of "written under it" is a map of every chain's head, which fails closed for any value a
> correct writer never stores (decisions 8c, 10, 21). Receipts: "Measured for revision 3"
> (`~/waitron-campaign-b/a798-9-plan-probe/r3/`).
>
> **Revision 2 (2026-10-23).** Folds in plan review round 1
> (`~/waitron-campaign-b/a798-9-plan-review/round1.md`: C1, I1–I7, M1–M12) and its claim check
> (`claim-check.md` beside it: FALSE 1–5, TOO WIDE 1–3, UNVERIFIED 1–2) under the coordinator's
> rulings. Each change names its finding in brackets, for example **[C1]**; claim-check rows are
> **[CC n]**, by the row number in that file. New receipts are under "Measured for revision 2"
> (`~/waitron-campaign-b/a798-9-plan-probe/r2/`). The biggest change: a restart now covers ONE
> backward step; after the first record written under it, every record is held to the one-minute
> rule against the latest time among the records written under it (decision 8; revision 3).
>
> **No migration.** The table this slice writes, `clock_stop_restarts`, and the index the stop reads
> were created by slice 8 (`packages/fiscal-verifactu/drizzle/0010_clock_stop.sql`). Nothing here
> adds or changes a table, an index or a trigger. If a task finds it needs one, STOP and report: it
> changes the lane's scheduling.
>
> **Parked for the owner** (build plan Part 1, row 9): the restart lifts the payment stop and lets
> one record be written with a generation time earlier than the record before it, and the box asks
> AEAT's web server for its time. It does **not** touch what is hashed (`computeHuella`, in
> `@waitron/verifactu`, outside this repository), the chain's links (`chain.ts`), numbering, series
> allocation, the alta and anulación builders or `registros_facturacion`'s immutability. The lift
> lives entirely in `packages/fiscal-verifactu/src/clock-behind.ts`, which `attemptAppend` already
> calls (P6–P9, Q1–Q8). The golden fingerprint test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`)
> and `inmutabilidad.test.ts` pass **unedited**. If a task finds it must change either, `chain.ts`,
> or anything else on that list, STOP and report.
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation, then run it again.
> Implementers are dispatched as `subagent_type: "implementer"`. Tasks run in their numbered order.
> Every task ends with the root guards and its own files green; the one exception inside a task is
> the commit just before a declared `Changed test checks` commit, which that commit turns green
> straight after.
>
> **Existing assertions [CC 42, CC 43].** This plan changes exactly these existing assertions,
> declared here so no implementer has to decide one. Each goes in the task named, in a commit of its
> own whose message begins `Changed test checks (A798 slice 9):` and lists each `file:line` with its
> before and after; the pull request names them. Each pins behaviour this slice deliberately
> changes, or is a guard's hand-kept file list that the coordinator ruled may gain an entry.
> 1. `packages/fiscal-verifactu/src/alerts.test.ts:7-10` (`FISCAL_ALERTS` `toEqual`): `events`
>    **gains** `{ prefix: "clock.behind_chain", area: "box", permission: "system.manage" }` after the
>    `fiscal.` claim (Task 7). Reason: decision 13's claim. A whole-shape list gaining one entry, every
>    existing entry kept: the owner's standing exception (2026-09-27).
> 2. `scripts/alert-codes.test.ts:24-41` (`INCIDENT_CODE_SOURCES`) **gains**
>    `"packages/fiscal-verifactu/src/clock-stop-incidents.ts"` (Task 7). Reason: the guard's
>    hand-kept list of files that record incidents; its first case (`:100-106`) fails for any
>    unlisted file calling `recordIncident(`, as design §4.8 c foresaw.
> 3. `scripts/ongoing-alert-codes.test.ts:12-17` (`ONGOING_CODE_SOURCES`) **gains**
>    `"apps/server/src/clock-disagrees-alert.ts"` (Task 4). Reason: the hand-kept list of files whose
>    ongoing alert codes must have words; without it the guard never sees `clock.disagrees`. The
>    guard's logic is unchanged (ruled allowed) **[CC 42 (d)]**.
> 4. `apps/server/src/box-health.test.ts:98-123` (the whole-shape `toEqual` of `collectBoxHealth`):
>    **gains** `clockStop: null` (Task 9b). Reason: decision 12's new field; the claim check printed
>    this case failing with `+ "clockStop": null` (`c14-box-health-shape.log`) **[CC 42 (a)]**.
> 5. `apps/server/src/box-alert-email.test.ts:45`: `expect(isBoxEmailCode("clock.behind_chain")).toBe(false)`
>    becomes `.toBe(true)` (Task 12). Reason: this slice gives that code email words **[CC 42 (b)]**.
> 6. `apps/server/src/box-alert-email.test.ts:15-24` ("words %s in %s with the venue's name"): the
>    `boxEmailMessage(code, language, "Corner Bistro")` call gains a params argument from one fixture
>    (`{ clockAt: "2025-03-14T08:12:00.000Z", offsetMinutes: 60, lastRecordAt:
>    "2026-10-18T21:40:00.000Z", lastRecordOffsetMinutes: 120 }`), and the expected subject and text
>    also replace `{clockAt}` with `14/03/2025 09:12` and `{lastRecordAt}` with `18/10/2026 23:40`.
>    The `not.toContain("{")` checks stay. Before: venue only; after: venue and the two times (Task
>    12). Reason: the new placeholders (decision 16) **[CC 42 (c)]**.
> 7. `apps/server/src/box-alert-email.duty.test.ts:381-392` ("emails no module notice without email
>    words"): its example `notice("clock.behind_chain")` becomes `notice("printer.jobs_waiting")`, a
>    real notice code that still has no email words; `fiscal.records_unsent` stays (Task 12). Reason:
>    `clock.behind_chain` gains words, so it can no longer stand for a code without them
>    **[CC 42 (b), CC 43]**.
> 8. `apps/dashboard/src/screens/box-status-rows.test.ts:534` (the Clock row's detail for
>    `driftSeconds: -3600`): `fill("box_status.clock.compared", { …, seconds: "3600" })` becomes
>    `fill("box_status.clock.compared_behind", { …, seconds: "3600" })` (Task 13). Reason: decision
>    17; the 2 s cases at `:156` and `:602` keep `compared` unchanged.
>
> Test **setup** changes are allowed where a task names them, never an assertion: a stub's methods;
> the dashboard's `BoxHealth` fixtures (`quietHealth` and its siblings in
> `apps/dashboard/src/screens/box-status-*.test.ts`) gaining `clockStop: null`, which the type
> requires. Any other assertion that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Base.** Every `file:line` below was read at `main` `de73c6144` (2026-10-23), this branch's base
> (`feat/a798-9-clock-restart`, worktree `waitron-feat-a798-9-clock-restart`); that base holds slice
> 8 (#2012) and slice 10 (#2019). Every claim about how the box, the engine, a library or AEAT
> behaves cites a probe in "Measured for this plan" or "Measured for revision 2", run that day on
> macOS (Darwin 25.6.0), Node v26.11.1, from scratch files under
> `~/waitron-campaign-b/a798-9-plan-probe/` (scripts in `scripts/` and `r2/scripts/`, logs beside
> them) and two throwaway worktrees of `de73c6144` made with `git worktree add --detach` and
> `pnpm install --frozen-lockfile --offline` (`Done in 3.6s` each, `install.log`,
> `r2/install.log`), both removed afterwards. A claim marked **(read)** comes from reading code, not
> running it. Nothing was measured on Linux, on a real box, or against AEAT's production hosts.

**Words used in this plan.**
- The **stop** is slice 8's: open while a reading of the box's clock is more than 60 000 ms earlier
  than the **latest record** — the one record that `latestRecord(tx)` answers: the largest
  `fecha_hora_huso_gen_registro` in `registros_facturacion`, any chain, any kind, ties broken by
  the larger `id` (decision 8a) **[I7]**. The **raw comparison** is that test alone, before any
  restart is taken into account.
- The **gap** is the latest record's time less the reading, in milliseconds.
- A **restart** is one row of `clock_stop_restarts`
  (`packages/fiscal-verifactu/src/schema/clock-stop-restarts.ts`): who, when, the reading accepted
  (`clock_at`), the record it names (`registro_id`, unique), that record's time (`record_at`) and
  the proof, which also carries `heads`: for every chain in the database when the restart was made,
  its node and the largest `secuencia` it held (decisions 10 and 21) **[C1, r3 I2]**. The
  **accepted gap** is `record_at − clock_at`.
- A record **written under a restart** is a record, in any chain, whose `secuencia` is larger than
  its node's entry in the restart's `heads` (0 for a node the map does not name), and, when a later
  restart exists, not larger than that later restart's entry. That is write order per chain, which
  is the chain code's own order (`chain.ts:150`, `:225`; review round 3, read), not time order.
  The **latest time written under it** is the largest generation time among those records
  **[r3 I1]**.
- A restart **covers** a reading when all four hold (decision 8): its `heads` are well formed and
  none is larger than its chain's current head (decision 21) **[r3 I2]**; it names the latest record;
  the gap is at most `min(accepted gap + 60 000, 86 400 000)` ms **[M1]**; and, once a record has been
  written under it, the reading is no more than 60 000 ms earlier than the latest time written under
  it **[C1, r3 I1]**.
- A **witness** is a reading of another clock taken by the box: a **device witness** (a till's or
  handheld's own clock, sent on its equipment read) or an **AEAT witness** (AEAT's time from the
  drain's submission reply or from the HEAD of decision 1). Each carries `boxAt`, the box's own
  wall clock at the moment the comparison refers to, `witnessAt`, the other clock's time at that
  moment, and `uncertaintyMs`.
- **Proof** for a restart is an AEAT witness that agrees with the box, or two different devices that
  each agree with it, taken during this stop and fresh (decisions 4–6). **Contrary proof** is an
  AEAT witness that disagreed at any time during this stop, or two devices that agree with each
  other and both disagree with the box (decision 5) **[I5]**.
- **Disproved**: after a restart, AEAT's time or a forward jump of the box's clock shows the accepted
  clock was wrong (design §4.8 b, "If the clock it accepted later proves wrong").

**Goal:** while payments are stopped for the clock, a manager on the Box status page sees whether the
box has fresh proof its clock is right and, only with such proof and a gap of at most 24 hours, can
restart payments; the restart allows one step back in the chain and no second one; it is kept in
the append-only table and the bell; the box keeps checking and says so if the accepted clock later
proves wrong; devices report their clock, so the bell warns when two of them agree the box's clock
is off; the bell shows a clock before 28-10-2024; and the managers get the clock-stop email once per
stop.

**Architecture:** seven pieces.
1. **Judging witnesses** (`packages/fiscal/src/clock-witnesses.ts`, Task 1): a pure function both
   the server's `clock.disagrees` alert and the module's restart use, so the two can never judge
   the same readings differently. Under mutation testing **[M12]**.
2. **Keeping witnesses** (`apps/server/src/clock-witnesses.ts`, Task 2): an in-memory store of the
   latest device readings and AEAT readings, handing out fresh agreeing ones taken on the box's
   current clock, and every AEAT disagreement until the stop ends **[I5]**.
3. **Feeding it**: the till sends its clock on every equipment read (Task 3); the drain's submission
   comparison and a once-a-minute HEAD to AEAT's QR validation host during a stop feed AEAT
   witnesses (Tasks 4, 10a, 10b).
4. **The module's restart** (`packages/fiscal-verifactu`, Tasks 5–7): one `latestRecord(tx)` that
   every caller uses **[I7]**; `clockBehindChain` honours a covering restart (the lift) and
   re-engages on a second step back **[C1]**; `clockStopState` says what the Clock row shows;
   `restartAfterClockStop` writes the row; `clock-stop-incidents.ts` records the two alerts.
5. **The seat** (Task 8): four optional `FiscalBackend` methods; only Veri\*Factu has them.
6. **Server** (Tasks 9a–12): the restart route, the Box status read's `clockStop`, the clock watch
   duty (AEAT HEAD, disproof), the `clock.disagrees` and `clock.unusable` alerts, the email.
7. **What people see** (Tasks 13–19): the dashboard words, the Clock row and its dialog, the guides,
   the docs, LOOK, the backlog.

**Tech stack:** TypeScript, `node:sqlite` behind drizzle 0.45.4, Hono, Lit, Vitest 4.1.12 (Node for
`packages/*` and `apps/server`; real headless Chromium for `apps/till`, `apps/dashboard` and part of
`packages/fiscal-verifactu`), Stryker for `packages/fiscal`.

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §4.3 (the new alerts), §4.5 items 3–4, **§4.8 b** (who can fix it, and how), §4.8 c (the
alerts and the email), §4.8 d (what clears the stop), §5, §6 ("Decisions revision 5 makes" 7, 11,
12, 13, 15), §7, **§8 item 9**, §9 question 4 and its answer (a), §10's two asesor questions, §12
experiment 7. Pictures: `docs/backlog/mockups/a798-degraded-trading/9-clock-behind-manager.png`
(the Reloj row with and without proof, the dialog, the email). Build plan:
[2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md) Part 1,
row 9 (fiscal invariants, auth; FULL; no migration; parked; depends on 7, 8 and 10, all landed).
Slice plans it builds on: [slice 8](2026-10-22-a798-8-clock-behind-stop.md) (the stop, the seat's
`clockBehindLatestRecord`/`refuseWhileClockBehind`, the table) and
[slice 10](2026-10-23-a798-10-emails-and-install.md) (the email duty, decision 9 "Room for slice
9"). Backlog: A798-B (`docs/backlog.md:4631-4649`) and the entries that name slice 9: "The clock
stop's email is slice 9's" (`:4651-4656`), "The backup verifier does not know
`clock_stop_restarts`' links" (`:4724-4726`), "The Box status page's Clock row drops the drift's
sign…" (`:4769-4773`), "Which alert area `clock.unusable` belongs to" (`:4830-4833`). Asesor
questions Q51 and Q52 (`docs/compliance/asesor-questions.md`, "Not built: it is slices 8 and 9" at
`:3637-3638` and "Not built: it is slice 9" at `:3678`).

### What "the minimum-date checks" are, for this slice

Design §8 item 9 names "the minimum-date checks". Revision 4's slice list had one slice for "Clock
checks (minimum date, chain, devices, `clock.*` alerts)" (`git show b86335d94` of the design, its
removed line `8.`); revision 5 split it. What is built today, by grep at `de73c6144`
(`/usr/bin/grep -rn 'clock.unusable' packages apps --include='*.ts'`, less tests): the refusal
before the reader and at the issue reading (slice 3, `first-issue-date.ts:14-25`), the staff notice
(slice 4, `staff-notices.ts:7-19`), the till's sentence (`apps/till/src/i18n/codes.ts:774`), the Box
status rows (`box-status-rows.ts:47`, `:56`), the dashboard's resolution words (`codes.ts:1271`)
and the email (slice 10, `apps/server/src/i18n/box-emails.ts:22`). **Not built: the bell's alert**
— design §4.3 lists `clock.unusable` (error) among the new alerts, and no alert source answers it
(the files naming `clock.unusable` and the files naming `AlertSource` have none in common; CC 60).
Slice 3 handed that alert, and the question of its area, to "the slice that raises it as an alert
(slice 9)" (`docs/backlog.md:4830-4833`; slice 3 plan `:2363-2365`). That is this slice's
minimum-date work (Task 11; decision 15).

---

## Measured for this plan

Logs and scripts are under `~/waitron-campaign-b/a798-9-plan-probe/`.

- **P1 — AEAT's pre-production submission host, unauthenticated, gives no time**
  (`p1-head-soap.log`). `curl -sS -o /dev/null -D - -I --max-time 10 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP?waitron_clock=probe1'`
  at `Fri, 23 Oct 2026 09:34:45 GMT` (`date -u` before and after) printed `HTTP/2 302`,
  `location: https://sede.agenciatributaria.gob.es/Sede/errores/erro4033.html`, `content-length: 0`,
  and **no `date:` line**. A GET (`p4-get-soap.log`) printed the same. The failing case would have
  printed a `date:` line. The claim check reproduced both at 09:59:35 UTC (CC 1).
- **P2 — the repository's existing internet time reading came back empty against pre-production**
  (`p2-internet-clock.log`). `observeInternetHourClock` (`packages/fiscal-verifactu/src/hour-clock-internet.ts:40-159`,
  A679's hour-code setup, the only code in the repository that reads AEAT's time from a header,
  CC 6) imported straight from the `.ts` file and run for `"preproduction"` printed
  `{"source":"internet","result":"unavailable","reason":"response",…}`: it follows only
  same-origin redirects (`:98-104`), and P1's redirect leaves the origin. The claim check ran it
  three more times, logging each hop: the same answer each time, and its control, the same function
  sent to the QR host, answered `usable` (CC 5). So it was unavailable in each of four runs on
  2026-10-23 — not "always" **[CC 7]**. Outside this slice; Task 19 files it.
- **P3 — AEAT's pre-production QR validation host does give its time** (`p3-head-qr-control.log`).
  `curl -sS -o /dev/null -D - -I --max-time 10 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'`
  printed `HTTP/2 200` and `date: Fri, 23 Oct 2026 09:35:02 GMT`; `date -u` right after printed
  `Fri Oct 23 09:35:02 UTC 2026`. No `age`, `cache-control` or `x-cache` header. Reproduced (CC 2).
- **P5 — the same host through the repository's own TLS-verified HEAD** (`p5-qr-head.log`,
  `p5-qr-head.mjs`). `authenticatedHourHead` (`hour-clock-internet.ts:12-38`: HEAD,
  `rejectUnauthorized: true`, no client certificate) on `QR_ENDPOINTS.preproduction`, three times
  with one random `waitron_clock` value reused for all three (CC 3): each `status 200`, `date`
  present and round-tripping, `age`/`cache-control`/`x-cache` null, round trips 177–206 ms, and
  the box's midpoint less the header's instant `858`, `52` and `229` ms. The control, the submission
  host, printed `soap 302 date: null`. The claim check's rerun, with the Mac's clock +0.028 s from
  `time.apple.com`, gave gaps of 71, 221 and 361 ms (CC 3). **What this does and does not show:**
  AEAT's public web server in pre-production states the time to within a second over a verified TLS
  connection with no certificate of ours. Nothing about production's
  `www2.agenciatributaria.gob.es` (not contacted) and nothing about the reply to a
  certificate-authenticated `consultar`.
- **P11 — a certificate-authenticated `consultar` reply was NOT measured** **[CC 10, CC 11, CC 12]**.
  - No certificate was used. My first search (`gtimeout 60 find ~ -maxdepth 5 …`) stopped at its
    60-second limit before reaching the campaign folders and printed only the two mitmproxy files;
    that sentence was wrong. Re-run with the claim check's pruning
    (`find ~ -maxdepth 5 \( -name node_modules -o -name Library -o -name 'My Drive' -o -name .Trash -o -name CloudStorage \) -prune -o \( -name '*.p12' -o -name '*.pfx' \) -print`,
    `r2/q11-p12-find.log`), it printed 22 files: `~/.mitmproxy/mitmproxy-ca.p12` and
    `mitmproxy-ca-cert.p12`, 18 under `~/waitron-campaign/a795-probes` and `a795-review`, and 2
    under `~/waitron-campaign-e/receipts` — fixtures made by earlier probes. None was opened, so
    none is known to be, or not to be, an AEAT certificate.
  - Pre-production accepts "no test NIFs, no test certificates, no self-signed certificates"
    (`docs/compliance/getting-to-production.md:287`).
  - The `verifactu` repository's live workflow holds an AEAT certificate as a CI secret
    (`~/workspace/repos/verifactu/.github/workflows/live-aeat.yml:79-80`, `AEAT_TEST_P12_BASE64`)
    and runs only from that repository's `main` (`:66`). Its monthly scheduled run files; a manual
    run takes a `mode`, and mode `consult` (also the script's default, `scripts/live-aeat.mjs:2388`)
    sends one `consultar` and returns before any submission (`:2440-2451`). Its `fetch` wrapper
    (`:2426-2431`) already holds each reply but prints no header, so one added line printing the
    reply's `Date` header in consult mode would measure it. This slice neither ran that workflow nor
    changed that repository (the coordinator's ruling); Task 19 files the one-line change.
- **P6–P8 — a restart row honoured in `clockBehindChain` alone lets the chain accept a record earlier
  than the one before it** (`p6-restart-chain.log`; the first prototype
  `scripts/prototype-clock-behind.diff`). Records through `VerifactuBackend` and `recordSale` at
  +120: after a restart naming the `21:40Z` record with `clock_at 07:12Z`, a sale at `07:13` was
  recorded with its `anterior_huella` equal to the previous `huella`, `verifyBackupFiscalChains`
  answered `true`, and an invoice dated `2026-10-19` linked to one dated `2026-10-20` was recorded
  (P7); the control with no restart row refused (P8). The claim check reproduced every line, showed
  that the verifier answers `false` when one `anterior_huella` is changed (CC 18), and that without
  the prototype every one of these sales is refused (CC 16). **This first prototype was wrong in
  one way:** it let later steps back go unnoticed (the review's E5, below; revision 2's Q1).
- **P9 — the fiscal core's suites with that first prototype** (`p9-fiscal-suites-with-prototype.log`):
  `Test Files 8 passed (8)`, `Tests 65 passed (65)`, unedited. Superseded by Q8 for the revised lift.
- **P10 — a second open incident with the same code and origin is dropped** (`p10-incident-dedupe.log`):
  two `recordIncident` calls with `jobOrigin("dashboard")` and one code left 1 row; after it was
  acknowledged a third was kept (2). The claim check repeated it with the real code
  `clock.behind_chain_restarted`: the kept row holds only the FIRST call's params, so nothing is
  merged — the second is simply not recorded (CC 27, CC 28) **[CC 28, CC 29]**. Decision 13 now
  keys each restart's alerts apart (Q10).
- **G1 — greps at `de73c6144`.** `behind_chain_restarted`, `behind_chain_disproved`,
  `restart_refused`, `clockStopState` and `x-waitron-device-clock`: no match under `packages`,
  `apps` or `scripts`; `clock.disagrees` searched as plain text (`grep -F`): no match (CC 58). The
  restarts table is written by nothing outside `clock-stop-restarts.test.ts` (CC 59). Every sentence
  naming slice 9 outside the A798 plans: `docs/backlog.md:4646`, `:4651`, `:4653`, `:4724`, `:4772`,
  `:4832`, and `docs/compliance/asesor-questions.md:3678` (CC 61).
- **R1 — reads this plan leans on (read).** The latest record is read with its offset, not its id
  (`clock-behind.ts:18-25`); the chain check is `attemptAppend`'s first statement (`chain.ts:137`);
  the strip's notice, the bell's alert, the named check and the drift suppression all reach
  `clockBehindChain` (`staff-notices.ts:27`, `clock-behind-alerts.ts:11`, `clock-behind.ts:46`,
  `boot.ts:2220-2226`; CC 23). The backup verifier keeps `clock_stop_restarts` immutable between
  copies (`backup-verification-history.ts:27-29`, `:482`); only its `LINKS` (`:424-433`) lack the
  table's keys. The chain verifier checks no time order (`backup-verification-chain.ts:94-138`). The
  equipment read is device-guarded and answers in write-lock turns (`apps/server/src/device-api.ts:397-427`);
  the till's client sends it with no header (`apps/till/src/api/client.ts:3459-3466`, `:4748-4764`);
  CORS allows only `content-type` and the dev device header (`apps/server/src/cors.ts:17`). A header
  on the equipment GET passes every till test, a query parameter fails one (CC 30). A word-list slot
  is written `{param:listName}` (`packages/dashboard-kit/src/alert-messages.ts:94-115`;
  `{hold:printer_hold}` at `apps/dashboard/src/i18n/alert-messages.ts:321`), and
  `apps/dashboard/src/i18n/alerts.test.ts:257-273` refuses a slot naming an unregistered list
  **[I1, CC 46]**. A non-`AppError` in a route answers `500 server.internal`
  (`packages/server-kit/src/error-boundary.ts:48-49`).

### The review's experiments this revision leans on

From `~/waitron-campaign-b/a798-9-plan-review/r1/` (not re-run here):
- **E1** — `{proof:list}` printed `Proof: —.`; `{proof:clock_proof}` with a list registered as
  `clock_proof` printed the words **[I1]**.
- **E2** — on a table with a unique index, a second insert targeted or untargeted printed
  `changes: 0`; a plain insert printed `UNIQUE constraint failed: r.registro_id` **[I2]**.
- **E3** — two `withTransaction` calls started together ran one after the other (`first begins`,
  `first ends`, `second begins`); one opened inside another's body was refused `write lock: a body
  asked for the lock it is already holding` **[I2]**.
- **E4** — two sales at the same instant: `order by … desc` named secuencia 2, `… desc, id asc`
  named secuencia 1 **[I7]**.
- **E5** — with the first prototype: a restart, sales at R + 1 min, R + 10 h (17:12) and R + 30 min
  (07:42) were all recorded, 9 h 30 min backwards between the last two **[C1]**.

## Measured for revision 2

Run on 2026-10-23, macOS, Node v26.11.1, in a throwaway worktree of `de73c6144`
(`~/waitron-campaign-b/a798-9-plan-probe/r2/wt`, removed with `git worktree remove --force`; free
memory 81%). Logs and scripts under `~/waitron-campaign-b/a798-9-plan-probe/r2/`.

- **Q1 — the revised lift stops a second step back** (`q-restart-r2.log`; the prototype
  `prototype-clock-behind-r2.diff`, `clock-behind.ts` only: `latestRecord` with the `id` tie-break,
  and `restartCovers` with the 24 h cap and the newest-written-record rule; the test
  `scripts/zz-restart-r2.test.ts`). A sale at `T = 21:40Z`, a restart naming it with `clock_at
  R = 07:12Z` and `recordsBefore: 1`, then sales at R + 1 min, R + 10 h, R + 30 min, R + 10 h − 59 s
  and R + 10 h − 2 min printed
  `["recorded","recorded","clock.behind_chain","recorded","clock.behind_chain"]` — the review's case
  (07:42 after 17:12) is refused, the margin (17:11:01 after 17:12) still sells. The rows kept:
  secuencia 1–4 at `21:40`, `07:13`, `17:12`, `17:11:01`.
- **Q7 — proof by deletion of the new rule** (`q7-mutation-no-newest-check.log`): the same case with
  the newest-written-record check deleted printed
  `["recorded","recorded","recorded","recorded","recorded"]` and rows at `07:42` after `17:12`: the
  review's E5 again. So that check, and nothing else, refuses the second step.
- **Q2 — its control, a clock moving forward** (`q-restart-r2.log`): after the restart, R + 1 min,
  R + 10 h, R + 10 h + 5 min → `["recorded","recorded","recorded"]`.
- **Q3 — the first step and its margin**: before any record under the restart, R − 61 s →
  `clock.behind_chain`, R − 59 s → `recorded`; then R + 1 min → `recorded`; then R − 59 s →
  `clock.behind_chain` (two minutes before the one record written under the restart).
- **Q4 — the cap is exactly 24 hours [M1]**: a restart accepted at exactly 24 h; a sale at
  T − 24 h − 1 s → `clock.behind_chain`; at T − 24 h → `recorded`.
- **Q5 — one total order for "latest" [I7]**: two sales at the same instant; `latestRecord` named
  one of them (which one follows the random ids; review round 3's X1 saw the other **[r3 M2]**); a
  restart naming the OTHER same-second record left the sale refused
  (`clock.behind_chain`); a restart naming `latestRecord()`'s record let it through (`recorded`).
- **Q6 — a restart row whose proof lacks `recordsBefore` covers nothing**: the sale was refused.
  (Revision 2's anchor; revision 3 replaces it, S6–S10.)
- **Q8 — the fiscal core's suites with the revised prototype** (`q8-fiscal-suites-r2.log`):
  `pnpm exec vitest run inmutabilidad src/write-path.e2e.test.ts src/clock-behind.test.ts src/chain.clock-behind.test.ts src/clock-behind-alerts.test.ts src/staff-notices.test.ts src/backend.clock-behind.test.ts src/clock-stop-restarts.test.ts src/chain.test.ts src/chain.concurrency.test.ts`
  in `packages/fiscal-verifactu` → `Test Files 10 passed (10)`, `Tests 87 passed (87)`, the golden
  huella test and `inmutabilidad` among them, unedited.
- **Q9 — kitchen screens never start the equipment poll [CC 35]** (`q9-kds-poll.log`). A throwaway
  case in `apps/till/src/till-app.test.ts` (Chromium), with `vi.spyOn(EquipmentPoll.prototype,
  "start")`: a `kds_station` device booted as the existing case at `:1921-1961` boots it, then 500 ms
  of waiting → `station shown true lock shown false poll starts 0`; the control, a till signed in by
  the lock screen's `logged-in` event → `poll starts 1`. The path (read): the poll starts only in
  `#enterSignedIn` (`till-app.ts:5082`), reached from `#onLoggedIn` (`:4934-4938`, the lock screen's
  sign-in), `#enterSwitchedProfile` (`:9620`) and the Retry button of the empty-service-zone section (`:17853`,
  `data-retry-device-zones`, inside `#activeTabBody`) **[r3 M6]**; a
  `kds_station` boot sets `deviceMode` and the station screen without a sign-in (`:4110-4128`), as
  the existing test says ("A KDS never logs in", `till-app.test.ts:8252`). So kitchen screens are
  not witnesses (decision 3). If a later change makes them poll, their readings would count like any
  device's, which the design allows ("devices that spoke in the last five minutes", §4.5 item 3).
- **Q10 — each restart's alerts kept apart by the named record's sale [CC 28, CC 29]**
  (`q10-incident-per-sale.log`): two sales recorded; `recordIncident` with one code and
  `jobOrigin("dashboard")`, `saleId` the first sale ("Ana"), then the second ("Marc"), then the
  first again: 2 open rows, Ana's and Marc's. The repeat on the first sale was dropped (the control).
  `registros_facturacion.sale_id` is `notNull` (`schema/registros.ts:49-50`), so every named record
  has a sale; the bell never shows an incident's sale (`apps/server/src/alerts.ts:63-76`, read).
- **Q11 — the certificate search, re-run**: see P11.

## Measured for revision 3

Run on 2026-10-23, macOS, Node v26.11.1, in a throwaway worktree of `de73c6144`
(`~/waitron-campaign-b/a798-9-plan-probe/r3/wt`, `pnpm install --frozen-lockfile --offline`
"Done in 3.5s", removed with `git worktree remove --force`). Prototype:
`r3/prototype-clock-behind-r3.diff` (`clock-behind.ts` only: `latestRecord`, `storedHeads`,
`latestWrittenAfter`, and the cover with the bound check, the 24 h cap and the running maximum).
Test: `r3/scripts/zz-restart-r3.test.ts`, run as
`TESTCONTAINERS_RYUK_DISABLED=true env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run src/zz-restart-r3.test.ts --silent=false`
in `packages/fiscal-verifactu`; log `r3/s-restart-r3.log`, `Tests 17 passed (17)`. Restart rows carry
`{ heads }` read from the database as decision 10 says.
- **S1 (Q1 again)**: `[R+1m, R+10h, R+30m, R+10h−59s, R+10h−2m]` →
  `["recorded","recorded","clock.behind_chain","recorded","clock.behind_chain"]`.
- **S2 (forward control)**: `[R+1m, R+10h, R+10h+5m]` → all `recorded`.
- **S3 (first step)**: `[R−61s, R−59s, R+1m, R−59s]` →
  `["clock.behind_chain","recorded","recorded","clock.behind_chain"]`.
- **S4 (cap)**: `[T−24h−1s, T−24h]` → `["clock.behind_chain","recorded"]`.
- **S5 — the review's twelve-step walk [r3 I1]**: restart, `R + 1 min`, `R + 10 h`, then
  `R + 10 h − 59 s × 1 … 12` → `recorded` ×3 (the first 59 s step sells), then `clock.behind_chain`
  ×11 — the second 59 s step is refused. The failing case is S11.
- **S11 — proof by deletion of the running maximum** (`r3/s11-mutation-last-written.log`): the
  "latest time written under it" read ordered by `secuencia` instead of by time (revision 2's rule)
  → S5 prints `recorded` ×14, the walk admitted, as the review's X12 printed.
- **S6 — a JSON `null` proof [r3 I2]** (raw SQL `proof = 'null'`): a sale at `R + 1 min` →
  `clock.behind_chain`, no `TypeError` (the review's X4 printed `TypeError: Cannot read properties of
  null` with revision 2's prototype).
- **S7 — each impossible stored value fails closed [r3 I2]**: a proof with no `heads`, `heads` an
  array, a value `"1"`, `-1`, `0.5`, `1e12` (larger than the chain's head), an empty map, and a map
  naming a node with no records → each `clock.behind_chain` at `R + 1 min`.
- **S12 — proof by deletion of the bound check** (`r3/s12-mutation-no-bound.log`): with "a head
  larger than its chain's current head covers nothing" deleted, the `1e12` row → `recorded`.
- **S8 — a restored database [r3 I2]**: the latest record on a second node's chain at `T`, the
  box's chain empty, `heads` from the database (one entry, the older chain); the box sells
  `[R+1m, R+10h, R+30m, R+10h+1m]` → `["recorded","recorded","clock.behind_chain","recorded"]`.
- **S9 — the row names another node**: `heads` right, `node_id` the second node →
  `[R+1m, R+10h, R+30m]` → `["recorded","recorded","clock.behind_chain"]`. The rule does not read the
  row's `node_id`, so a wrong one cannot widen it (the review's X6b admitted the step with revision
  2's anchor).
- **S10 — `heads` leaving out the older chain** (`{}` on S8's database): `R + 1 min` →
  `clock.behind_chain` — the older chain's records count as written under the restart, the named
  record among them, so the stop stays.
- **S13 — the tie-break's proof by deletion made reliable [r3 M2]** (`r3/s13-tiebreak.log`): two
  sales at one instant, eight runs, picking the latest by `… desc, id desc` and by `… desc, id asc`:
  the two picks differed in all eight (`differ true`). So a deletion that makes ONE caller order by
  `id asc` always picks the other record, and Task 5 case 7 fails every run.
- **S14 — the fiscal core's suites with the revised prototype** (`r3/s14-fiscal-suites-r3.log`):
  Q8's command → `Test Files 10 passed (10)`, `Tests 87 passed (87)`, the golden huella test
  (`write-path.e2e.test.ts`) and `inmutabilidad` among them, unedited.
- **S15 — what the route logs for a refused duplicate insert [r3 M4]** (`r3/p-unique-error.log`):
  `node:sqlite`'s refusal of a second row on a unique column is a plain `Error`
  (`{"code":"ERR_SQLITE_ERROR","errcode":2067}`, `UNIQUE constraint failed: r.registro_id`).
  `isAppError` is `value instanceof AppError` (`packages/shared/src/errors.ts:97-99`) and `codeOf`
  answers `"unknown"` for anything else (`packages/server-kit/src/error-code.ts:7-9`, read), so the
  boundary logs `errorCode: "unknown"`, not the index.

---

## Departures from the design

1. **AEAT's time comes from a HEAD to AEAT's QR validation host, not from a `consultar` reply's
   `Date` header.** Design §8 item 9: "AEAT's time from a read-only query's `Date` header, measured
   in pre-production first"; §4.8 b names the library's `consultar`. Measured: the submission host
   gives no time without our certificate (P1), and a certificate-authenticated reply could not be
   tried here (P11). The QR host is AEAT's own, read-only, needs no certificate, and gave its time
   over verified TLS to within a second (P3, P5). Decision 1; Task 19 files the `consultar`
   measurement with the one-line change that would make it.
2. **AEAT proof must be fresh (five minutes)**, as the design asks only of devices. AEAT contrary
   proof does NOT expire: per the design, any AEAT disagreement seen during the stop blocks a restart
   for the rest of that stop (decision 4) **[I5]**.
3. **The dashboard writes times as `2026-10-19 09:14`**, not `19/10/2026 09:14` (picture 9), as
   slice 7's departure 7 and slice 8's departure 4 chose (`formatIsoMinute`).
4. **The email carries no link**; it names the page by its menu path (slice 10 decision 11).
5. **The restart's bell alert names its proof by kind** ("the tax agency's time", "two devices or
   more", both), not the proof's figures; the figures are in the table and the dialog (decision 13).
6. **The 24-hour cap is exact, margin included [M1].** The design caps the restart "at most 24
   hours behind"; with the stop's one-minute margin on top, the first step back could reach 24 h
   59 s. The cover is capped at exactly 24 h (Q4).

## Decisions this plan makes that the design does not

Each is a DEFAULT to build; the owner or the plan review may overrule any.

1. **AEAT's time for a restart, two ways.** (a) The drain's existing comparison with a submission
   reply's `TimestampPresentacion` (`apps/server/src/time-health.ts:49-101`, fed at `boot.ts:2657`)
   also becomes an AEAT witness: its instant is the timestamp plus 500 ms and its uncertainty half
   the round trip plus 500 ms, since the timestamp is read to the second (`time-health.ts:58-60`),
   as A679 widens its header time (`hour-clock-internet.ts:138-139`) **[M2]**. (b) A new read: an
   HTTPS `HEAD` to `QR_ENDPOINTS[environment]` (`@waitron/verifactu`'s `dist/endpoints.js:27-30`;
   `DeploymentEnvironment` is `"production" | "preproduction"`, so every box has one, CC 4) through
   the existing `authenticatedHourHead` (verified TLS, no client certificate, a fresh random
   `waitron_clock` query each time against caches), with A679's header checks (a `Date` that
   round-trips, no `Age`, no cache hit, no positive `max-age`; `hour-clock-internet.ts:106-122`) and
   a 5 s deadline; instant `date + 500`, uncertainty `500 + roundTrip / 2` (`:138-139`). The new
   reader lives in a new file and changes no A679 file. **Not built:** reading a `consultar` reply's
   `Date` header (P11). **Not measured:** the production QR host. Cost if the owner wants only
   `consultar`: (b) goes, and AEAT proof exists only while records wait to be sent.
2. **When the HEAD runs:** at most once a minute, by the clock watch (Task 10b), only while the raw
   comparison is behind, the box files records (`filesRecords`, `boot.ts:1528-1529`, false on a
   demo or prepare box, CC 50) and it is the primary. Cost: up to 1 440 HEAD requests a day to AEAT's
   public host for as long as a stop lasts.
3. **How a device reports its clock:** a request header `x-waitron-device-clock`, the browser's
   `Date.now()` taken as the till builds its equipment read (`getDeviceEquipment`), every 15 s
   while the poll runs. The server takes its own wall and steady readings when the request arrives
   — the first thing the handler does — and notes the sample only once `requireDevice` has passed,
   so a wait behind the write lock is not counted as clock difference **[M3]**. A value that is not
   a safe integer is ignored. CORS's `allowHeaders` gains the header. Kitchen screens never start the
   poll (Q9) and so are not witnesses. Why a header: the equipment URL stays unchanged, which one
   till test pins (CC 30). Cost: the request's own travel time counts as clock difference; on a LAN
   it is far under the minute margin.
4. **Which witnesses count [I5].** The latest reading per device and every AEAT reading are kept in
   memory with the box's wall and steady clocks at the comparison's midpoint **[M2]**.
   - A device witness, and an AEAT witness that agrees or says nothing, is handed out only while it
     is at most five minutes old by the steady clock AND the box's wall clock has moved with the
     steady clock since, to within 1 000 ms (A679's tolerance, `hour-clock.ts:56`, CC 51).
   - An AEAT witness that DISAGREES (decision 5) and was taken during the stop is kept as contrary
     proof, with no age limit and through clock steps, until the clock watch sees the raw comparison
     no longer behind (the stop's end), when the store forgets it: design §4.8 b, "Any evidence the
     other way … and the restart is not offered". A server restart forgets every witness (design §7).
   - **Alternative for the owner:** let an AEAT disagreement lapse when the box's clock is stepped
     after it, since it was evidence about the clock before the step. Not built: it departs from
     the design's words.
5. **What agrees:** a witness agrees when `|witnessAt − boxAt| + uncertaintyMs ≤ 60 000`; it
   disagrees when `|witnessAt − boxAt| − uncertaintyMs > 60 000`; otherwise it says nothing. A
   device's uncertainty is 0. Two devices agree with each other when their differences from the box
   are within 60 000 ms of each other. **A group of devices is a set in which every pair agrees with
   each other [M11];** the largest group wins, and among groups of the same size the one whose
   newest `boxAt` is latest. With devices at +2 h, +2 h 50 s and +2 h 100 s the largest group has
   two (the ends do not agree).
6. **"Gathered after the stop began"** is judged per witness: its `boxAt` was itself more than a
   minute earlier than the latest record's time. The stop's start is not stored (design §7).
7. **`clock.disagrees`:** an ongoing alert from the server (devices are the core's), area `box`,
   permission `system.manage`, severity `warning`, `since: null`, `screen: "box-status"`, raised
   whenever a group of two or more fresh devices all disagree with the box, stop or no stop. Params
   `{ count, deviceAt, boxAt }`: the group's size, its mean device time projected to the read, and
   the box's time at the read. Staff see nothing: A364 still holds for every clock that is not behind
   the last record (design §6).
8. **The lift, and the one step back it allows [C1].**
   - **8a. One latest record [I7].** `latestRecord(tx)` in `clock-behind.ts` orders by
     `fecha_hora_huso_gen_registro desc, id desc` and is the only way any code finds the latest
     record: `clockBehindChain`, `clockStopState` and `restartAfterClockStop` call it. The
     disproof does not need it: it picks restarts by their `[restarted_at, record_at)` window
     (decision 14) **[r3 M5]**. `id` is a random UUID (`newId`, `packages/db/src/schema/columns.ts:178`), so the tie-break
     is arbitrary but total and stable.
   - **8b. The cover.** `clockBehindChain` answers `null` when the raw comparison is behind and a
     restart covers the reading (Words). Every reader of the stop then lifts together: the strip,
     the bell's `clock.behind_chain`, the named check on every money route, the chain check inside
     the append, the drift suppression and the email's episode. No edit to `chain.ts` (Q1–Q8).
   - **8c. One step back, then the ordinary rule.** Before any record is written under the restart,
     the first step may go up to a minute further back than accepted (Q3, S3). Once one is written,
     each reading is held to the ordinary one-minute rule against the **latest time written under
     the restart** — a running maximum over those records, exactly the ordinary rule applied to
     them **[r3 I1]**. So a second step back of more than a minute stops payments again (Q1, S1), and
     so does a clock walking back 59 s at a time, at its second step (S5; it is not the record
     written just before that counts, which revision 2 used and S11 shows admits the walk). The
     Clock row then says `stepped_back`; a second press of the same record is refused
     `stepped_back` (decision 9). The same holds for the chain's own check, so no record can be
     written past it.
   - **8d. What the refusal names then.** When the stop is open because of 8c, `clock.behind_chain`'s
     `lastRecordAt` and `lastRecordOffsetMinutes` are those of the record holding the latest time
     written under the restart; otherwise the latest record's. (Not probed: S1 checks only the code;
     Task 5 case 2 pins the params.)
   - **What the owner chose under question 4, as built:** "The first sale after the restart steps the
     chain back by up to 24 hours; later sales carry times earlier than the last sale until real time
     passes it." Later sales do carry times earlier than the NAMED record, but never more than a
     minute earlier than the latest sale written under the restart. The pull request says so.
9. **The restart's checks, in this order**, each refusing `clock.restart_refused { reason, … }`
   (HTTP 409) unless it says otherwise:
   1. a reading before 28-10-2024 → `clock.unusable` itself (design §4.8 d);
   2. the raw comparison not behind → `reason: "not_stopped"`;
   3. `recordId` in the request is not `latestRecord(tx)`'s → `"record_changed"`;
   4. a restart already names the latest record: if it covers the reading, the answer is that first
      restart, `replayed: true`, HTTP 200, no row and no alert; if not, `"stepped_back"` with
      `{ personId, restartedAt }` of the first;
   5. gap more than 24 hours (`> 86 400 000` ms; exactly 24 h is allowed, Q4) → `"too_far"`;
   6. contrary proof (decisions 4–5) → `"contrary_proof"`;
   7. no proof → `"no_proof"`.
   The same function answers the Box status page's offer, so the page offers exactly what the press
   would accept at that moment.
10. **What a restart row holds:** `node_id` the box's node, `person_id` the manager, `restarted_at`
    and `clock_at` both the route's one reading, `registro_id` and `record_at` the latest record,
    `proof` the agreeing witnesses only — `{ authority: { boxAt, witnessAt, uncertaintyMs } | null,
    devices: [{ deviceId, boxAt, witnessAt }], heads: { [nodeId]: largestSecuencia } }` — `heads`
    read in the restart's transaction as `select node_id, max(secuencia) from registros_facturacion
    group by node_id`, one entry per chain the database holds **[r3 I2]**. Why in `proof`: it is the
    one free JSON column and this slice adds no migration. Decision 21 says what a wrong value
    does. The insert is a plain insert, with no conflict clause **[I2]**: two presses
    cannot overlap (one write transaction at a time, E3), so the second meets decision 9.4 first; a
    duplicate that ever reached the insert would be refused by the unique index and answer
    `500 server.internal` (E2; `error-boundary.ts:48-49`), never a silent drop.
11. **The seat gains four OPTIONAL methods** on `FiscalBackend`, beside slice 8's two:
    `clockStopState`, `restartAfterClockStop`, `noteClockProvedWrong`, `readAuthorityTime`. Only the
    Veri\*Factu backend has them; the server treats a missing method as "nothing to restart, no AEAT
    time". Measured: four optional methods typecheck across all 28 packages that depend on
    `@waitron/fiscal`, test files included, where one required method gave 499 errors (CC 36). No
    name or string in `packages/fiscal` holds a word of its vocabulary guard
    (`no-regime-vocabulary.test.ts:57-71`; comments are blanked first): the record id is `recordId`
    there, never `registroId`.
12. **The route** is `POST /api/box/clock-restart`, body `{ recordId }`, in `box-health-api.ts`
    beside Liberar, `system.manage`, ONE `withTransaction` holding the authorization (a direct
    `authorizeManager(tx, …)` call — never `authorizeSystemManager` (`box-health-api.ts:25-36`),
    which opens its own transaction **[M7]**), the reading, the seat's checks, the row and the alert.
    A body that is not an object, or a `recordId` that is not a non-empty string, is refused
    `management.request_invalid { field: "recordId" }` (400; `packages/shared/src/errors.ts:58`). A
    till's device or PIN session gets `management_session.required` (401): the design keeps the
    restart off the till. It answers `{ restart: { personName, restartedAt, clockAt, lastRecordAt },
    replayed }`. The Box status read gains `clockStop: ClockStopView | null`, read in a write-lock
    turn with no drain like the rest of that read (`box-health.ts:68-69`). On a full disk the press
    is refused `storage.disk_full`, as any write is.
13. **The two recorded alerts, one per restart [CC 28, CC 29, M8].**
    `clock.behind_chain_restarted`: severity `warning`, origin `jobOrigin("dashboard")`, `saleId` the
    named record's sale, `detectedAt` the restart's reading, params `{ restartId, person, clockAt,
    lastRecordAt, proof }` with `person` the display name at that moment and `proof` one of
    `"authority"`, `"devices"`, `"authority_and_devices"`, worded by `{proof:clock_restart_proof}`
    with a word list registered as `clock_restart_proof` **[I1]**. `clock.behind_chain_disproved`:
    severity `error`, origin `jobOrigin("fiscal_filing")`, `saleId` the named record's sale, params
    `{ restartId, from, to }` (decision 14). Because the open-incident index keys on source, device,
    code and sale (P10), giving each restart's alerts its named record's sale keeps every restart's
    and every disproof's alert apart, each with its own person and times (Q10); restarts name
    different records (the unique index), so their sales differ except when two named records
    belong to one sale (an alta and its own anulación; no route issues an anulación today, slice 8
    decision 4), which Task 19 records. The Veri\*Factu module claims the prefix `clock.behind_chain`
    for area `box` under `system.manage`; the longest claim wins over the core's `clock.`
    (`apps/server/src/alerts.ts:37-46`). Both are written by `clock-stop-incidents.ts`, which throws
    nothing (the alert guard reads every dotted literal in a listed file as a recorded code,
    `scripts/alert-codes.test.ts:90-97`). Both codes are declared in the Veri\*Factu error registry
    with their params, as recorded codes are (`errors.ts:117`) **[M5]**.
14. **Disproof, kept by the clock watch** (`apps/server/src/clock-watch.ts`, every minute, primary
    only, unref'd timer, first tick a minute after start, each next armed after the last finished,
    `stop` waiting for a tick in flight — the shape of `box-alert-email.ts:84-235`; on both
    `undoOnFailure` and the close list `boot.ts:2859-2882` **[I3]**):
    - a **jump**: between two ticks the wall clock moved more than 60 000 ms further than the
      steady clock; `trustedUntil` is the earlier tick's wall time plus the steady time since
      (2026-10-23: the elapsed-time clock is /proc/uptime on Linux, so a resume from suspend is not
      a jump — `docs/developers/conventions-data.md`, "A jump");
    - **AEAT disagrees**: an AEAT witness that disagrees, noted since the last tick; `trustedUntil`
      is that witness's `boxAt` — the wrong clock's reading when AEAT contradicted it **[I4]**.
    Either calls `noteClockProvedWrong(tx, { trustedUntil, reason })`. For each restart **in force**
    at `trustedUntil` (`restarted_at ≤ trustedUntil < record_at`) with no `clock.behind_chain_disproved`
    yet (acknowledged or not, matched by `params.restartId`), it records one with **`from` the
    EARLIEST and `to` the LATEST generation time among the records written under that restart when
    the disproof is observed [I4, r3 M1]** — by time, not write order: the first record written can
    be later than the second (review round 3's X9: secuencia 2 at `07:13:00`, secuencia 3 at
    `07:12:02`). A restart under which no record was written gets no alert, since no sale carries its
    clock; the watch logs `clock_watch.disproved_unused { restartId }`. A backward step is not
    disproof; it stops payments again (decision 8c). Nothing else changes (design, decision 13):
    **after a disproof the restart still covers**, so sales recorded later fall after `to`, and no
    second alert is recorded for that restart (it already has one). The guide says so and Task 19
    records it **[r3 M1]**.
15. **`clock.unusable` in the bell.** The module's clock source (`clockBehindSource`, the name kept)
    answers `clock.unusable` instead of `clock.behind_chain` while the reading is before
    28-10-2024: error, area `box`, `system.manage`, `since: null`, `screen: "box-status"`, params
    `{ clockAt }`. It is an ongoing source, so the core's `clock.` claim for recorded incidents does
    not decide its area — settling slice 3's open question. Judged at offset 0, as the source already
    reads (`clock-behind-alerts.ts:11`; the alert context has no offset, `packages/module/src/alerts.ts:29-32`),
    so in the first hour or two of 28-10-2024 local time the bell can say "before" where the till
    does not. Under a 2001 clock the bell shows one red alert, not two; the drift alert stays
    suppressed there (`clockBehindChain` does not apply the minimum date; review "found sound").
16. **The clock-stop email** goes through slice 10's duty: the episode keeps the params of the notice
    that started it, `boxEmailMessage(code, language, venue, params?)` fills `{clockAt}` and
    `{lastRecordAt}`, each written `dd/mm/yyyy hh:mm` in its own offset. One email per stop: the
    episode ends when the notice goes — the clock is fixed, real time passes the record, or a restart
    lifts it.
17. **The Clock row says which way.** Past a minute, "…the box was {seconds} s ahead" or "…behind"
    (`box_status.clock.compared_ahead` / `_behind`; `driftSeconds` is box less AEAT,
    `time-health.ts:96`); within a minute today's "{seconds} s apart". The bell's seconds can still
    differ from the row's; that stays open.
18. **The dialog** is a `wt-dialog` opened from the Clock row's **Reanudar los cobros** (EN **Restart
    payments**), shown only while `clockStop.offer` is `"offered"`. It holds no staged input, so it
    takes no draft scope. Its confirm button is drawn primary, disabled and loading while its request
    is sent. A refusal shows its reason's sentence on its own line above the buttons, leaves the
    button enabled (design-system → Forms), **and refreshes the page** (`liveData.refresh`), so the
    row behind the dialog and its reason line match the box **[M9]**; a success closes the dialog and
    refreshes. The words for each reason live in `apps/dashboard/src/i18n/strings.ts` as
    `box_status.clock.refused.<reason>`, picked by the dialog from the error's `reason`;
    `apps/dashboard/src/i18n/codes.ts` gives `clock.restart_refused` one generic sentence for any
    other surface **[M6]**. Without an offer the row shows why in words, never a disabled button.
19. **The backup verifier learns the table's two links**
    (`["clock_stop_restarts", "node_id", "nodes", "id"]`,
    `["clock_stop_restarts", "registro_id", "registros_facturacion", "id"]`).
20. **Parked**, as the build plan's row 9 says.
21. **The anchor of "written under a restart" is a map of every chain's head, and it fails closed
    [r3 I2].** Revision 2 stored one count for "the box's own chain"; the rule then had to know which
    node sells, which the append's own check cannot be told (`refuseWhileClockBehind` gets only the
    reading, and `chain.ts` is not edited), and a wrong value or a wrong `node_id` widened the cover
    (the review's X5, X6b). Instead the row stores `heads`, every chain's largest `secuencia` at the
    restart (decision 10), and the rule never reads the row's `node_id`. One definition, used by the
    writer and the reader alike. The cover is NOTHING — the stop stays, and nothing throws — unless
    `proof` is a non-null, non-array object whose `heads` is a non-null, non-array object in which
    every value is a safe integer `≥ 0` and no value is larger than its node's current largest
    `secuencia` (0 for a node with no records). A node the map leaves out counts from 0, so its
    records all count as written under the restart, which can only narrow the cover (S10). Since
    `clock_stop_restarts` is append-only, a bad row is harmless for ever: it covers nothing and
    cannot be corrected or removed, and the next stop is a new latest record with no row. Measured:
    S6–S10, S12. Cost: one `group by node_id` read of `registros_facturacion` per covered reading
    (the cover runs only while the raw comparison is behind), on a database with a handful of
    chains.

## Behaviour this slice changes

1. While the stop is open and a manager restarts with proof, every action slice 8 stops works again;
   the next record carries the box's clock, earlier than the named record's (P6b, P7), and every
   record after it is held to the one-minute rule against the latest time among the records written
   under the restart (S1, S5).
2. New in the bell: `clock.disagrees`, `clock.unusable`, `clock.behind_chain_restarted`,
   `clock.behind_chain_disproved`. Under a clock before 28-10-2024 the bell shows `clock.unusable`
   instead of `clock.behind_chain`.
3. New route `POST /api/box/clock-restart`; `GET /api/box/health` gains `clockStop`.
4. The till sends `x-waitron-device-clock` on its equipment read.
5. During a stop the box makes a `HEAD` to AEAT's QR validation host once a minute.
6. The managers get the clock-stop email once per stop.
7. The Clock row says ahead or behind past a minute; it gains the restart offer and the dialog.
8. The backup verifier refuses a copy whose `clock_stop_restarts` names a missing node or record.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work only in this worktree. Stage explicit
  paths; never `git add -A`; never `git add -p` (interactive). Do not push.
- **The fiscal core rule.** Not edited: `@waitron/verifactu` (outside the repo), `chain.ts`,
  `registro-row.ts`, `backend.ts`'s record methods, `packages/core/src/record-*.ts`, the series and
  numbering code, A679's `hour-*.ts` files, the golden test and `inmutabilidad.test.ts`. After every
  task touching `packages/fiscal-verifactu`, `packages/fiscal` or `packages/core`:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  passes, and
  `git diff main -- packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/registro-row.ts packages/core/src 'packages/fiscal-verifactu/src/hour-*' ':!packages/core/src/*.test.ts'`
  prints nothing.
- **No migration.** `git diff main --name-only -- '*/drizzle/*' packages/migrations` prints nothing.
- **Module seams:** no file under `apps/server/src` imports `@waitron/fiscal-verifactu` outside
  `testing/` (`scripts/module-seams.test.ts`); the server reaches the module through
  `FiscalBackend`.
- **Transactions:** the restart route opens exactly one `withTransaction`; queries on it are awaited
  in turn, never `Promise.all`. The read paths (box health, alert sources, notices) only read.
- **Error codes:** new `clock.restart_refused` (thrown) and the recorded `clock.behind_chain_restarted`
  and `clock.behind_chain_disproved`, all three in the Veri\*Factu registry
  (`packages/fiscal-verifactu/src/errors.ts`, beside `clock.unusable` at `:360`) with their params
  **[M5]**. `clock.restart_refused` is thrown only from `clock-stop-restart.ts`, never from a file
  listed in `scripts/alert-codes.test.ts`. New ongoing code `clock.disagrees` (server). Every alert
  code has EN and ES words in `apps/dashboard/src/i18n/alert-messages.ts`. No other new code: a bad
  body reuses `management.request_invalid`.
- **Words:** general code is English only (CLAUDE.md §3). Spanish appears only in
  `apps/dashboard/src/i18n/*`, `apps/till/src/i18n/*`, `apps/server/src/i18n/box-emails.ts` and
  `apps/server/src/guide/es/`. Each task greps its own diff:
  `git diff main -U0 -- apps packages ':!*/i18n/*' ':!apps/server/src/guide/es/*' | /usr/bin/grep -nE '^\+.*(cobr|venta|hora del|encargado|equipo|reanud|prueba)'`
  prints nothing.
- **Tests:** database tests use `useVenueDb` (CLAUDE.md §4). A refused write asserts the domain code
  and its params, never `toBeInstanceOf(Error)`. Every "nothing written" is a row count before and
  after. Every refusing case has a control that goes through. Server files that record sales follow
  slice 8 decision 13 (`docs/developers/testing-guide.md`): setup records one sale at the real
  clock; each case reads NOW from the database; every write uses a clock built from NOW; a case that
  must write on another clock gets a database of its own. Witness and watch tests take injected
  `wall` and `monotonic` functions, never fake timers over the database.
- Coverage 98/98/98/95 in every touched package; no exclude, no ignore comment.
- Comments only for an invariant or a non-obvious why; no history, no slice numbers in code.
- Focused runs: `pnpm --filter <pkg> exec vitest run <files>`; root guards
  `pnpm exec vitest run scripts/<guard>.test.ts`. Read the `Tests` count every time. Unset
  `AI_AGENT` and `CLAUDECODE` to see a passing test's console output. Every task runs
  `pnpm exec prettier --check` on the files it touched (a file under `docs/` prints
  `"ignored": true` with `pnpm exec prettier --file-info <file>` instead).
  `TESTCONTAINERS_RYUK_DISABLED=true` for every local run. CI runs the package suites and coverage.
- `apps/till`, `apps/dashboard` and the browser half of `packages/fiscal-verifactu` run in real
  headless Chromium: check `memory_pressure | grep free` first; run beside another session's browser
  run only when free memory is well above 15%.
- **No test contacts AEAT.** The HEAD reader is tested against a local HTTPS server with a test
  authority, as `hour-clock-internet.test.ts:354-395` does (CC 54).

## Review focus

1. **A restart without proof, against contrary proof, or past 24 hours.** Expected: refused with its
   reason, nothing written (Task 6 cases 2–6; Task 9a cases 1–3). Proof by deletion for each check.
2. **A witness that should not count.** Older than five minutes; taken before a step of the box's
   clock; taken before the stop; one device twice; an AEAT disagreement older than five minutes
   still counting against (Tasks 1, 2, 6).
3. **The one step back [C1].** A covering restart sells; a second step back of more than a minute
   after a record is written stops again, and so does a clock walking back 59 s at a time, at its second
   step **[r3 I1]**; a malformed restart row covers nothing **[r3 I2]**; a forward-moving clock keeps selling; the strip, the bell,
   the named check and the chain check agree (Task 5; Task 9b case 2).
4. **One latest record [I7].** Two records in one second: the restart, the stop and the page name
   the same one (Task 5 case 7).
5. **The bell is not the record.** Marking `clock.behind_chain_restarted` handled leaves payments
   running (Task 9b case 1); two restarts give two alerts (Task 7 case 4).
6. **A second restart of the same record** is answered with the first, writes no row and no alert;
   after a further step back it is refused `stepped_back` (Task 6 cases 7–8; Task 9a case 5).
7. **Two simultaneous presses [I2]** through the real route: one row, one alert, one `replayed:
   false`, one `replayed: true` (Task 9a case 6).
8. **Disproof.** A forward jump while a restart is in force, and an AEAT reading that disagrees,
   record one `clock.behind_chain_disproved` per restart with its own `from` and `to`, and nothing
   else (Tasks 7, 10b).
9. **The fiscal core.** The golden test and `inmutabilidad` unedited and green; `chain.ts` and the
   hour-code files untouched.
10. **Devices cannot be the source of a time.** No device or AEAT time is ever stamped on a record
    (grep in Task 9a Step 5).
11. **A device that lies.** Two devices can fake proof; the restart still needs a `system.manage`
    holder's press and a gap of at most 24 hours. Recorded as a known limit (Task 19).

## Review path

**FULL** (build plan row 9: fiscal invariants, auth): per-task reviews, the full `/finish-branch`
wave, and two Codex run-it reviews side by side. The fresh-context plan-against-spec read runs
before implementers start. The slice is **parked** for the owner.

**The pull request description says**, in its first lines: it is parked (a manager's restart lets
ONE record carry a time earlier than the record before it; every later record is held to the
one-minute rule against the latest time among the records written under the restart — the reading of the owner's question-4 answer
that was built, decision 8); the box asks AEAT's QR validation host for its time during a stop;
no migration; `chain.ts`, the golden test and `inmutabilidad` unchanged; AEAT's time comes from the
QR host's `Date` header, not from `consultar`, which was not measured (departure 1, P11).

**Codex seat 1 (with this plan's checklist).** Experiments decided up front:
- Boot a server (`serverFixture` of `apps/server/src/boot.disk-full-wiring.test.ts`) on a venue with
  a sale recorded, its clock 14 hours behind it: `GET /api/box/health` as a manager →
  `clockStop.offer: "no_proof"`; two `GET /api/device/equipment` from two devices with
  `x-waitron-device-clock` equal to the box's time → `"offered"`; `POST /api/box/clock-restart` →
  200, one row in `clock_stop_restarts`; `POST /api/pay` cash → 200; the same press again → 200
  `replayed: true`, still one row; mark the bell's restart alert handled → pay again → 200.
- The same with the two devices 2 hours ahead of the box → `"contrary_proof"`, and the bell shows
  `clock.disagrees`; with the record 25 hours ahead → `"too_far"`.
- Delete, one at a time, the cover in `clockBehindChain`, the newest-written-record rule, the
  24-hour cap, the during-the-stop check and the freshness filter; name the test that fails for
  each.

**Codex seat 2 (told to set the checklist aside).** Find a way to restart without proof or to write
a record further back than the rules allow: replay a device header from an old request; send one
device's header from two browsers; step the box's clock back by 30 s, 61 s and 2 min after a restart;
restart, sell for an hour, then step back 30 min **[C1]**; restart, sell, then walk the clock back
59 s per sale **[r3 I1]**; store a restart row with a hand-made `heads` (too large, negative, a
string, `null`) and sell **[r3 I2]**; restart, let real time pass the record,
then step back; race two presses; restart under a clock before 28-10-2024; two records in one second.

---

### Task 1: Judging witnesses (packages/fiscal)

**Files:**
- Create: `packages/fiscal/src/clock-witnesses.ts`, `packages/fiscal/src/clock-witnesses.test.ts`
- Modify: `packages/fiscal/src/index.ts` (exports), `packages/fiscal/stryker.config.json` (`mutate`
  gains `src/clock-witnesses.ts` **[M12]**: its list is `src/clock.ts` and `src/backend.ts` today,
  and `packages/fiscal`'s mutation runs locally only, `docs/developers/ci-and-gates.md:397`)

**Interfaces:**
```ts
export const CLOCK_WITNESS_MARGIN_MS = 60_000;
export interface ClockWitness {
  readonly kind: "authority" | "device";
  /** The device's id; "authority" for AEAT readings. */
  readonly id: string;
  /** The box's wall clock at the moment the comparison refers to, ISO 8601. */
  readonly boxAt: string;
  /** The witness's clock at that moment, ISO 8601. */
  readonly witnessAt: string;
  readonly uncertaintyMs: number;
}
export interface ClockWitnessVerdict {
  /** Witnesses that agree with the box (decision 5), the latest per id. */
  readonly agreeing: readonly ClockWitness[];
  /** Authority witnesses that disagree, the latest first. */
  readonly authorityDisagrees: readonly ClockWitness[];
  /** The largest group (every pair agrees with each other) of two or more devices that all disagree with the box. */
  readonly devicesDisagreeing: readonly ClockWitness[];
}
export function judgeClockWitnesses(witnesses: readonly ClockWitness[]): ClockWitnessVerdict;
```

- [ ] **Step 1: Write the failing tests** (`clock-witnesses.test.ts`, plain Node):
  1. a device 60 000 ms off agrees; 60 001 ms off disagrees; an authority 59 000 ms off with
     uncertainty 1 000 agrees, with 1 001 says nothing; 61 001 off with uncertainty 1 000 disagrees;
  2. two devices +2 h and +2 h 0 min 59 s → `devicesDisagreeing` both; +2 h and +2 h 1 min 1 s → none;
     one device +2 h alone → none;
  3. three devices +2 h, +2 h 30 s, −3 h → the group of two;
  4. **[M11]** three devices +2 h, +2 h 50 s, +2 h 100 s → a group of two (the ends do not agree),
     the one with the latest `boxAt` among equal sizes;
  5. the same device id twice → only the later `boxAt` counts;
  6. no witnesses → empty verdict.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal exec vitest run src/clock-witnesses.test.ts` → fails to resolve
  `./clock-witnesses.js`.
- [ ] **Step 3: Implement.** Pure; no clock read.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/fiscal exec vitest run src/no-regime-vocabulary.test.ts`
  → PASS; `pnpm --filter @waitron/fiscal typecheck` exits 0; then
  `pnpm --filter @waitron/fiscal mutation` (local only; memory first) → the score at or above the
  break of 90 (`stryker.config.json`'s `thresholds`); every surviving mutant in
  `clock-witnesses.ts` killed by a new case or named in the report.
- [ ] **Step 5: Proofs by deletion**: `≤` → `<` → case 1 fails; drop the uncertainty widening → case
  1's authority case fails; drop the pairwise check → cases 2 and 4 fail.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal/src/clock-witnesses.ts packages/fiscal/src/clock-witnesses.test.ts packages/fiscal/src/index.ts packages/fiscal/stryker.config.json
  git commit -s -m "The fiscal seat's package can say whether other clocks agree with the box's, within a minute"
  ```

### Task 2: The server keeps witnesses

**Files:**
- Create: `apps/server/src/clock-witnesses.ts`, `apps/server/src/clock-witnesses.test.ts`

**Interfaces:**
```ts
export interface ClockWitnessStore {
  /** `arrived`: the box's wall and steady readings when the request arrived (decision 3). */
  noteDevice(deviceId: string, deviceMs: number, arrived: { wallMs: number; monoMs: number }): void;
  /** `at`: the box's wall and steady readings at the comparison's midpoint (decision 4). */
  noteAuthority(sample: { authorityMs: number; uncertaintyMs: number; at: { wallMs: number; monoMs: number } }): void;
  /** Fresh agreeing-or-silent witnesses (≤ 5 min, no step since) and every kept AEAT disagreement. */
  witnesses(): ClockWitness[];
  /** AEAT witnesses noted since the last call, for the clock watch's disproof. */
  takeNewAuthority(): ClockWitness[];
  /** The stop has ended: forget the kept AEAT disagreements. */
  endStop(): void;
}
export function createClockWitnessStore(deps?: { wall?: () => number; monotonic?: () => number }): ClockWitnessStore;
```

- [ ] **Step 1: Write the failing tests** with injected `wall` and `monotonic`:
  1. a device noted, read 299 s later → one witness with `boxAt` the ARRIVAL time, `witnessAt`,
     `uncertaintyMs: 0`; 301 s later → none;
  2. a device noted, then the wall clock steps forward 2 s against the steady clock → none; 900 ms
     → kept;
  3. the same device noted twice → one witness, the later;
  4. `NaN`, `1.5` and a string coerced — none noted;
  5. an agreeing AEAT witness 301 s old → gone; **a disagreeing one 10 min old and after a 2 s step
     → still handed out [I5]**; after `endStop()` → gone;
  6. `takeNewAuthority` returns each authority sample once.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-witnesses.test.ts`.
- [ ] **Step 3: Implement**, using Task 1's `judgeClockWitnesses` to tell a disagreeing AEAT sample.
- [ ] **Step 4: Run** → PASS; typecheck `@waitron/server`.
- [ ] **Step 5: Proof by deletion**: remove the step check → case 2 fails; remove the age check →
  case 1 fails; apply the age check to disagreements too → case 5 fails.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/clock-witnesses.ts apps/server/src/clock-witnesses.test.ts
  git commit -s -m "The box keeps other clocks' readings: fresh ones as proof, and every disagreement from AEAT until the stop ends"
  ```

### Task 3: Tills and handhelds report their clock on the equipment read

**Files:**
- Modify: `apps/till/src/api/client.ts` (`getDeviceEquipment`, `:3459-3466`: pass the header; let
  `#request` (`:4748`) take extra headers without changing any other call),
  `apps/server/src/device-api.ts` (the GET at `:397-427`: take the box's wall and steady readings
  first, note the header after `requireDevice`; `deps.clockWitnesses?: Pick<ClockWitnessStore,
  "noteDevice">` beside `notices` at `:133`), `apps/server/src/cors.ts` (`allowHeaders` gains
  `"x-waitron-device-clock"`), `apps/server/src/boot.ts` (create the store once; hand it to
  `mountDeviceApi` at `:1839`)
- Test: `apps/till/src/api/client.test.ts` (a new case beside `:3446`), `apps/till/src/till-app.test.ts`
  (a new case beside `:1921`), `apps/server/src/device-api.test.ts` (new cases), `apps/server/src/cors.test.ts`
  (a new case)

- [ ] **Step 1: Write the failing tests.**
  - Till client: `getDeviceEquipment` sends `x-waitron-device-clock` equal to `String(Date.now())`
    at the call (`vi.spyOn(Date, "now")`), with no `content-type` and no body; the existing case at
    `:3446` passes unedited (CC 30).
  - Till app: a `kds_station` device booted as `:1921-1961` does never starts the equipment poll
    (`vi.spyOn(EquipmentPoll.prototype, "start")` → 0 calls), and a till signed in starts it once —
    Q9 as a kept test, so a later change that makes kitchen screens poll is seen **[CC 35]**.
  - Server: a device's equipment read with `x-waitron-device-clock: <ms>` → `noteDevice` called
    once with the device's id, that number and the arrival readings; the arrival readings are taken
    before `requireDevice` (an injected `wall` that advances on each call shows the first value);
    without the header, or with `abc`, → not called; an unpaired request → refused as today and not
    called.
  - CORS: a preflight from an allowed origin asking for `x-waitron-device-clock` → the answer's
    `access-control-allow-headers` contains it.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/till-app.test.ts -t "equipment"`
  (Chromium: memory first; the kds case passes already — it pins today's behaviour);
  `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/cors.test.ts`.
- [ ] **Step 3: Implement** decision 3.
- [ ] **Step 4: Run** → PASS; typecheck both packages; `pnpm --filter @waitron/till exec vitest run src/till-app.nfc.test.ts src/widgets/equipment-dialog.nfc.test.ts`
  → PASS unedited.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/till/src/api/client.ts apps/till/src/api/client.test.ts apps/till/src/till-app.test.ts apps/server/src/device-api.ts apps/server/src/device-api.test.ts apps/server/src/cors.ts apps/server/src/cors.test.ts apps/server/src/boot.ts
  git commit -s -m "Tills and handhelds send their own clock with each equipment read, and the box keeps it as a witness"
  ```

### Task 4: `clock.disagrees`, and AEAT's submission comparison as a witness

**Files:**
- Create: `apps/server/src/clock-disagrees-alert.ts`, `apps/server/src/clock-disagrees-alert.test.ts`
- Modify: `apps/server/src/time-health.ts` (`createAuthorityClockStatus.observe` gains an optional
  `onSample`: for each comparison it keeps, `{ authorityMs: timestamp + 500, uncertaintyMs:
  (received − sent) / 2 + 500, at: the midpoint's wall and steady readings }` **[M2]**),
  `apps/server/src/boot.ts` (the source in `serverAlertSources` at `:2213`; `onSample` →
  `witnesses.noteAuthority`), `apps/dashboard/src/i18n/alert-messages.ts` (`clock.disagrees`'s
  words, Task 12's text)
- Modify (declared change 3, own commit): `scripts/ongoing-alert-codes.test.ts`
- Test: `apps/server/src/time-health.test.ts` (new cases; existing ones pass unedited)

- [ ] **Step 1: Write the failing tests.** Source: two fresh devices +2 h → one alert
  `{ key: "clock.disagrees", code: "clock.disagrees", severity: "warning", since: null, screen:
  "box-status", params: { count: 2, deviceAt, boxAt } }`, area `box`, permission `system.manage`;
  one device → none; two devices within a minute of the box → none. Time health: an observed reply
  calls `onSample` once with `timestamp + 500`, half the interval plus 500 and the midpoint; a reply
  with no timestamp calls nothing.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-disagrees-alert.test.ts src/time-health.test.ts`.
- [ ] **Step 3: Implement**; add the words.
- [ ] **Step 4: Declared change 3** in its own commit, after which
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts` → PASS
  (proof: drop the words → `ongoing-alert-codes` FAILS naming `clock.disagrees`; restore).
- [ ] **Step 5: Commit, in two.**
  ```bash
  git add apps/server/src/clock-disagrees-alert.ts apps/server/src/clock-disagrees-alert.test.ts apps/server/src/time-health.ts apps/server/src/time-health.test.ts apps/server/src/boot.ts apps/dashboard/src/i18n/alert-messages.ts
  git commit -s -m "Managers are warned when two devices agree the box's clock is more than a minute off, and AEAT's replies count as a witness"
  git add scripts/ongoing-alert-codes.test.ts
  git commit -s -m "Changed test checks (A798 slice 9): the ongoing alert guard reads the clock-disagrees source"
  ```

### Task 5: The lift — one latest record, one step back

**Files:**
- Modify: `packages/fiscal-verifactu/src/clock-behind.ts` (decisions 8 and 21; the shape is
  `~/waitron-campaign-b/a798-9-plan-probe/r3/prototype-clock-behind-r3.diff`; export `latestRecord`,
  `storedHeads` and `latestWrittenAfter`, which Tasks 6 and 7 reuse)
- Create: `packages/fiscal-verifactu/src/clock-behind.restart.test.ts`

The test inserts restart rows directly (the writer is Task 6), as `clock-stop-restarts.test.ts:20-37`
does, with `proof: { heads }` read from the database as decision 10 says (or hand-made for the
impossible values), and records through `VerifactuBackend` and `recordSale` as
`chain.clock-behind.test.ts:31-55` does. S1–S10 are its cases.

- [ ] **Step 1: Write the failing tests:**
  1. a record at `T`; a sale at `R = T − 14.5 h` → `clock.behind_chain`; a restart naming it
     (`clock_at R`, `record_at T`, `heads` from the database); a sale at `R + 1 min` → recorded, its
     `anterior_huella` the first's `huella`;
  2. **[C1]** after the restart: `R + 1 min`, `R + 10 h`, `R + 30 min`, `R + 10 h − 59 s`,
     `R + 10 h − 2 min` → recorded, recorded, `clock.behind_chain`, recorded, `clock.behind_chain`
     (S1); the third refusal's params name the record holding the latest time written under the
     restart (`lastRecordAt` `R + 10 h`, decision 8d);
  3. **[C1] control:** `R + 1 min`, `R + 10 h`, `R + 10 h + 5 min` → all recorded (S2);
  3b. **[r3 I1] the twelve-step walk:** `R + 1 min`, `R + 10 h`, then `R + 10 h − 59 s × 1 … 12` →
     recorded, recorded, recorded, then `clock.behind_chain` for each of the eleven after it: the
     second 59 s step is refused (S5);
  4. the first step: before any record under the restart, `R − 61 s` refused, `R − 59 s` recorded;
     then `R + 1 min` recorded and `R − 59 s` refused (Q3);
  5. **[M1]** a restart accepted at exactly 24 h: `T − 24 h − 1 s` refused, `T − 24 h` recorded (Q4);
  6. `clockBehindChain`, the staff-notice source and `clockBehindSource` agree at `R` (nothing) and
     at `R − 2 min` (the stop);
  7. **[I7]** two records at the same instant: `latestRecord` names one; a restart naming the other
     leaves the stop on; one naming `latestRecord()`'s lifts it (Q5);
  8. a restart naming a record that is no longer the latest (real time passed it) does not lift a
     new stop; a reading before 28-10-2024 with a restart → `refuseWhileClockBehind` still throws
     `clock.unusable`;
  8b. **[r3 I2] the anchor fails closed and never throws**, each a sale at `R + 1 min` →
     `clock.behind_chain`: a proof stored as JSON `null` (raw SQL); a proof with no `heads`; `heads`
     an array; a value `"1"`, `-1`, `0.5` and one larger than its chain's head; an empty map; a map
     naming a node with no records (S6, S7);
  8c. **[r3 I2] two chains**: the latest record on an older chain of a second node, the box's chain
     empty — `R + 1 min`, `R + 10 h`, `R + 30 min`, `R + 10 h + 1 min` → recorded, recorded,
     `clock.behind_chain`, recorded (S8); the same with the row's `node_id` the other node → the
     same answers (S9); `heads` leaving out the older chain → `clock.behind_chain` at `R + 1 min`
     (S10);
  9. an invoice dated a day earlier than the record it links to (P7) → recorded, and
     `verifyBackupFiscalChains` over a backup copy answers `true`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-behind.restart.test.ts` →
  every case that expects `recorded` after a restart fails `clock.behind_chain`; 7 fails to import
  `latestRecord`.
- [ ] **Step 3: Implement** `latestRecord`, `storedHeads` and the cover (one unique-index read, one
  `group by node_id` read of the chains' heads, and one read per chain of the latest time after its
  stored head, served by `registros_node_secuencia_idx`; all only when the raw comparison is
  behind). Nothing in it may throw for any stored `proof`.
- [ ] **Step 4: Run** the new file and Q8's list → PASS; the fiscal-core check of Global constraints
  prints nothing.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run, each failure named in the report:
  order the "latest time written under it" read by `secuencia` instead of by time → case 3b
  prints `recorded` for every step (S11); delete the rule altogether → case 2 records `R + 30 min`
  (Q7); delete the bound check → case 8b's too-large head is `recorded` (S12); drop the margin from
  the cover → case 4's `R − 59 s` is refused; drop the cap → case 5's `T − 24 h − 1 s` is recorded;
  make `clockStopState` (Task 6) or the test's second reader order by `id asc` while
  `latestRecord` keeps `id desc` → case 7 fails on every run, since two distinct ids always order
  differently (S13) **[r3 M2]**. (Deleting the tie-break outright is not a reliable proof: the
  engine's pick then matches the larger id only some of the time, review round 3's X14.)
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-behind.ts packages/fiscal-verifactu/src/clock-behind.restart.test.ts
  git commit -s -m "A manager's restart lifts the payment stop for one step back; any later step back of more than a minute, even in small steps, stops it again"
  ```

### Task 6: The restart rule and its writer

**Files:**
- Create: `packages/fiscal-verifactu/src/clock-stop-restart.ts`, `packages/fiscal-verifactu/src/clock-stop-restart.test.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts` (`clock.restart_refused` with its params)

**Interfaces** (the shared types move to `@waitron/fiscal` in Task 8; shapes do not change):
```ts
export type ClockRestartOffer =
  | "offered" | "no_proof" | "contrary_proof" | "too_far" | "stepped_back" | "restarted";
export interface ClockStopState {
  clockAt: string; offsetMinutes: number; lastRecordAt: string; lastRecordOffsetMinutes: number;
  recordId: string; gapMs: number;
  restart: { personId: string; restartedAt: string; clockAt: string } | null;
  offer: ClockRestartOffer;
  proof: { authority: ClockWitness | null; devices: ClockWitness[] };
  contrary: { authority: ClockWitness | null; devices: ClockWitness[] };
}
export async function clockStopState(tx, reading, witnesses: readonly ClockWitness[]): Promise<ClockStopState | null>;
export async function restartAfterClockStop(tx, input: {
  reading; witnesses: readonly ClockWitness[]; personId: string; nodeId: string; recordId: string;
}): Promise<{ restart: { id: string; personId: string; restartedAt: string; clockAt: string; lastRecordAt: string; proofKind: "authority" | "devices" | "authority_and_devices" }; replayed: boolean }>;
```
Both call `latestRecord(tx)` **[I7]**. `clockStopState` answers `null` when the raw comparison is not
behind and when the reading is before 28-10-2024; `offer` is `"restarted"` when a restart covers the
reading. Only witnesses taken during this stop count (decision 6). `restartAfterClockStop` runs
decision 9's checks in order and writes decision 10's row with a plain insert. **It records no
alert**: Task 7 adds that, so this task never makes the alert guard red **[M4]**.

- [ ] **Step 1: Write the failing tests** (`useVenueDb`, a record at `T`, witness fixtures with
  `boxAt` behind `T`):
  1. two devices agreeing, gap 14.5 h → `offer: "offered"`; restart → one row with decision 10's
     columns, `proof.heads` equal to `select node_id, max(secuencia) … group by node_id` read just
     before the press (one entry per chain), `replayed: false`; a sale at the reading → recorded;
  1b. **[r3 I2] a restored database through the writer**: an older chain on a second node holds the
     latest record, the box's chain is empty; the restart written by `restartAfterClockStop` (not by
     hand); then a sale at the reading → recorded; then a reading 30 min behind that sale →
     `clock.behind_chain`. A writer that stored only the box's chain, or counted all records as one
     number, fails this case or case 1;
  2. **no proof** (no witnesses; one device; an AEAT witness that says nothing) → `"no_proof"`;
     restart refused `clock.restart_refused { reason: "no_proof" }`, row count unchanged;
  3. **contrary proof**: two agreeing devices plus an AEAT witness that disagrees → `"contrary_proof"`;
     the same with the AEAT disagreement 10 minutes old and no step since → `"contrary_proof"`
     **[I5]**; two agreeing devices plus a group of two at +2 h → `"contrary_proof"`; each refused,
     nothing written;
  4. **a 25-hour gap** with proof → `"too_far"`, refused; exactly 24 h → offered; 24 h + 1 s →
     `"too_far"` **[M1]**;
  5. witnesses taken before the stop (`boxAt` within a minute of `T`) → `"no_proof"`;
  6. `recordId` of an older record → `"record_changed"`; a reading not behind → `"not_stopped"`;
     a 2001 reading → `clock.unusable`;
  7. **a second restart of the same record** → answers the first (`replayed: true`, same id, the
     first's `personId` when a second manager presses), row count still 1;
  8. after the first and a record written under it, a reading 2 min behind that record →
     `"stepped_back"` with the first's `{ personId, restartedAt }`, and `clockStopState.offer` the same.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-stop-restart.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`
  → PASS; typecheck the package; the fiscal-core check prints nothing.
- [ ] **Step 5: Proofs by deletion**, one at a time: the 24-hour check → case 4 fails; the contrary
  check → case 3 fails; the during-the-stop filter → case 5 fails; the replay branch → case 7 fails
  (the second insert is refused by the unique index: `UNIQUE constraint failed`, E2).
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-stop-restart.ts packages/fiscal-verifactu/src/clock-stop-restart.test.ts packages/fiscal-verifactu/src/errors.ts
  git commit -s -m "Veri*Factu offers a restart of payments only with fresh proof and at most 24 hours behind, and keeps each one"
  ```

### Task 7: The two recorded alerts, one per restart

**Files:**
- Create: `packages/fiscal-verifactu/src/clock-stop-incidents.ts`, `packages/fiscal-verifactu/src/clock-stop-incidents.test.ts`
- Modify: `packages/fiscal-verifactu/src/alerts.ts` (the claim, decision 13),
  `packages/fiscal-verifactu/src/errors.ts` (the two recorded codes with their params **[M5]**),
  `packages/fiscal-verifactu/src/clock-stop-restart.ts` (calls the restarted writer; gains
  `noteClockProvedWrong(tx, { trustedUntil: Date; reason: "jump" | "authority" }): Promise<{ recorded: string[]; unused: string[] }>`),
  `apps/dashboard/src/i18n/alert-messages.ts` (the two codes' EN and ES sentences, Task 12's text,
  and the word list `clock_restart_proof` registered in `ALERT_WORDS`, `:351` **[I1]**),
  `apps/dashboard/src/i18n/alerts.test.ts` (new cases)
- Modify (declared changes 1 and 2, own commit): `packages/fiscal-verifactu/src/alerts.test.ts`,
  `scripts/alert-codes.test.ts`

- [ ] **Step 1: Write the failing tests.**
  1. A restart records one `clock.behind_chain_restarted` (warning, `dashboard` origin, `sale_id`
     the named record's sale, params decision 13) in the restart's transaction; a refused restart
     records none; a replay records none.
  2. `noteClockProvedWrong` with `trustedUntil` inside a restart's `[restarted_at, record_at)`, after
     records written under it at `R + 1 min`, `R + 2 s` and `R + 90 s` (written in that order),
     records one `clock.behind_chain_disproved` with `from` `R + 2 s` and `to` `R + 90 s` — the
     earliest and latest by time, not the first and last written **[I4, r3 M1]**; a second call records none (also after the first is
     acknowledged); `trustedUntil` after `record_at` or before `restarted_at` → none; a restart with
     no record written under it → none, answered in `unused`; nothing in `registros_facturacion` or
     `clock_stop_restarts` changes (counts).
  3. **[I1]** `alertMessage("clock.behind_chain_restarted", { person: "Ana", clockAt, lastRecordAt,
     proof: "authority" }, "en")` equals the sentence with "the tax agency's time" in it, and the
     Spanish the same with "la hora de Hacienda"; the text contains no `—` (E1 printed `Proof: —.`
     for the wrong slot). Also `"devices"`, `"authority_and_devices"` and an unknown value.
  4. **[CC 28, CC 29]** two restarts of two different records (a stop, a restart, the clock set
     forward past the first record, a sale, a new stop, a second restart): two
     `clock.behind_chain_restarted` rows, each with its own `person`, `clockAt`, `lastRecordAt` and
     `restartId`; a disproof with both in force → two `clock.behind_chain_disproved` rows, each with
     its own `from` and `to`. The control: the same two inserts with one `sale_id` leave one row
     (Q10's shape), so the test can tell.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-stop-incidents.test.ts`;
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts` (Chromium: memory first).
- [ ] **Step 3: Implement**; the claim in `FISCAL_ALERTS.events`; the words and the list.
- [ ] **Step 4: Commit the implementation**, then the declared changes 1 and 2 in their own commit;
  after it `pnpm exec vitest run scripts/alert-codes.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/alerts.test.ts` and
  `pnpm --filter @waitron/composition exec vitest run` → PASS.
  ```bash
  git add packages/fiscal-verifactu/src/clock-stop-incidents.ts packages/fiscal-verifactu/src/clock-stop-incidents.test.ts packages/fiscal-verifactu/src/alerts.ts packages/fiscal-verifactu/src/errors.ts packages/fiscal-verifactu/src/clock-stop-restart.ts apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/alerts.test.ts
  git commit -s -m "Each restart of payments, and each restarted clock that later proved wrong, reaches the managers' bell with its own person and times"
  git add packages/fiscal-verifactu/src/alerts.test.ts scripts/alert-codes.test.ts
  git commit -s -m "Changed test checks (A798 slice 9): the fiscal alerts claim clock.behind_chain for the box area, and the alert guard lists the file that records it"
  ```

### Task 8: The fiscal seat offers the restart

**Files:**
- Modify: `packages/fiscal/src/backend.ts` (decision 11's four optional methods, the shared types
  `ClockStopState`, `ClockRestartOffer`, `ClockRestart`, `AuthorityTimeSample`),
  `packages/fiscal/src/index.ts`, `packages/fiscal-verifactu/src/backend.ts` (delegates, beside
  `:160-176`), `packages/fiscal-verifactu/src/clock-stop-restart.ts` (uses the shared types)
- Test: `packages/fiscal-verifactu/src/backend.clock-stop.test.ts` (new); a case each in the fake's
  and `fiscal-none`'s tests that the methods are absent

- [ ] **Step 1: Write the failing tests**: the Veri\*Factu backend answers `clockStopState` and
  `restartAfterClockStop` as Task 6 does (one stopped case, one offered restart);
  `NoneBackend.clockStopState` and `FakeFiscalBackend.clockStopState` are `undefined`.
- [ ] **Step 2: Run and watch them fail** (`clockStopState is not a function`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `pnpm --filter "...@waitron/fiscal" --workspace-concurrency 4 typecheck` exits 0
  (every package that depends on `@waitron/fiscal`, CC 36); `pnpm --filter @waitron/fiscal exec vitest run src/no-regime-vocabulary.test.ts`
  → PASS; `pnpm exec vitest run scripts/module-seams.test.ts scripts/workspace-cycles.test.ts` → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal/src/backend.ts packages/fiscal/src/index.ts packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/clock-stop-restart.ts packages/fiscal-verifactu/src/backend.clock-stop.test.ts
  git commit -s -m "The fiscal seat can say whether payments may be restarted for the clock, and restart them"
  ```
  (Add the fake's and none's test files once they hold their cases.)

### Task 9a: The restart route **[I6]**

**Files:**
- Modify: `apps/server/src/box-health-api.ts` (the route, decision 12; `STATUS` gains
  `"clock.restart_refused": 409`, `"clock.unusable": 409`, `"management.request_invalid": 400`),
  `apps/server/src/boot.ts` (hand the route the backend, the witness store and the clock)
- Create: `apps/server/src/clock-restart.route.test.ts` (its own database; slice 8 decision 13's rules)

- [ ] **Step 1: Write the failing tests** (sales on a clock built from NOW; witnesses noted straight
  into the store the app was built with):
  1. **no proof, no restart**: the press → 409 `clock.restart_refused { reason: "no_proof" }`;
     `POST /api/sales` still 409 `clock.behind_chain`;
  2. **contrary proof**: two devices +2 h → refused `contrary_proof`, nothing written;
  3. **a 25-hour gap** with two agreeing devices → refused `too_far`;
  4. **[M7]** without `system.manage` (a supervisor) → 403; no session → 401; a till's PIN session
     cookie → 401 `management_session.required`; body `{}`, `{ recordId: 7 }` and `{ recordId: "" }`
     → 400 `management.request_invalid { field: "recordId" }`; nothing written in any;
  5. **a second restart of the same record** → 200 `replayed: true`, `restart.personName` the first
     manager's, one row, one restarted alert;
  6. **[I2] two simultaneous presses**: `Promise.all` of two `POST`s with the same `recordId` → one
     200 `replayed: false`, one 200 `replayed: true`, one row, one `clock.behind_chain_restarted`.
     Proof by deletion: delete decision 9.4's replay branch → the second press answers
     `500 server.internal` (the engine's unique refusal is not an `AppError`, so the boundary logs
     only `errorCode: "unknown"`, S15 **[r3 M4]**), and the case fails on its status; restore.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-restart.route.test.ts src/box-health-api.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck; `pnpm exec vitest run scripts/module-seams.test.ts scripts/write-path-tables.test.ts`
  → PASS.
- [ ] **Step 5: Check** that no device or AEAT time is stamped anywhere:
  `git diff main -- apps packages | /usr/bin/grep -nE '^\+.*(witnessAt|deviceMs|authorityMs).*(instant|issuedAt|generadoEn)'`
  prints nothing.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-health-api.ts apps/server/src/boot.ts apps/server/src/clock-restart.route.test.ts
  git commit -s -m "Managers can restart payments from the dashboard when the box has fresh proof its clock is right"
  ```

### Task 9b: The Box status read's `clockStop`, and what the restart lifts **[I6]**

**Files:**
- Modify: `apps/server/src/box-health.ts` (`BoxHealth.clockStop`; `BoxHealthReaders` gains
  `clockStop?: (db) => Promise<ClockStopView | null>`; device ids to labels from `devices`, the
  restart's person to a display name), `apps/server/src/boot.ts` (wiring at `:2304-2330`)
- Modify (declared change 4, own commit): `apps/server/src/box-health.test.ts:98-123`
- Test: `apps/server/src/clock-restart.route.test.ts` (more cases), `apps/server/src/box-health.test.ts`
  (new cases)

- [ ] **Step 1: Write the failing tests:**
  1. **marking the bell's alert handled leaves payments running**: offered → press → 200; a cash
     `POST /api/sales` succeeds; `POST /management-api/alerts/incidents/:id/handled`
     (`apps/server/src/alerts-api.ts:89`) on the `clock.behind_chain_restarted` incident → 200; the
     same sale again succeeds; `GET /management-api/alerts` lists no `clock.behind_chain`;
  2. **[C1]** after the press and a sale, the box's clock 30 min behind that sale →
     `POST /api/sales` 409 `clock.behind_chain` and `GET /api/box/health`'s `clockStop.offer`
     `"stepped_back"`;
  3. after the press, `GET /api/device/equipment` has no `clock.behind_chain` notice;
  4. `GET /api/box/health` → `clockStop.offer` `"no_proof"`, then `"offered"` with two device
     labels after two equipment reads, then `"restarted"` with `restart.personName`;
  5. the box health read answers on a full disk with a change waiting (the shape of
     `box-health.test.ts`'s full-disk case), `clockStop` included.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-restart.route.test.ts src/box-health.test.ts`.
- [ ] **Step 3: Implement**; `:98-123` now fails on `clockStop: null` only.
- [ ] **Step 4: Commit the implementation, then declared change 4 alone**, after which both files
  PASS.
  ```bash
  git add apps/server/src/box-health.ts apps/server/src/boot.ts apps/server/src/clock-restart.route.test.ts apps/server/src/box-health.test.ts
  git commit -s -m "The Box status read says whether payments can be restarted, with the proof and who restarted them"
  ```
  For the second commit, make only the `:98-123` edit after the first, then
  `git add apps/server/src/box-health.test.ts` and
  `git commit -s -m "Changed test checks (A798 slice 9): the box health read carries clockStop"`.

### Task 10a: AEAT's time from its QR validation host **[I6]**

**Files:**
- Create: `packages/fiscal-verifactu/src/authority-time.ts`, `packages/fiscal-verifactu/src/authority-time.test.ts`
  (decision 1 (b); imports `authenticatedHourHead` from `./hour-clock-internet.js` and changes nothing
  there)
- Modify: `packages/fiscal-verifactu/src/backend.ts` (`readAuthorityTime` →
  `readAuthorityTime(this.deploymentEnvironment)`)

- [ ] **Step 1: Write the failing tests**, against a local HTTPS server with a test authority (the
  shape of `hour-clock-internet.test.ts:354-395`; the URL injected): a `Date` header → a sample
  `{ authorityMs: date + 500, uncertaintyMs: 500 + roundTrip / 2, at: midpoint }`; no `Date`, a 302 to
  another origin, `Age: 3`, a TLS name mismatch, and a server that never answers (5 s deadline) →
  `null`; each call sends a different `waitron_clock` value. With no URL injected it asks
  `QR_ENDPOINTS[environment]` (asserted on the URL handed to an injected request, never by
  contacting AEAT).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/authority-time.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; the fiscal-core check (with `hour-*`) prints nothing.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/authority-time.ts packages/fiscal-verifactu/src/authority-time.test.ts packages/fiscal-verifactu/src/backend.ts
  git commit -s -m "Veri*Factu can read AEAT's time from its QR validation site over a verified connection"
  ```

### Task 10b: The clock watch **[I6, I3, I4]**

**Files:**
- Create: `apps/server/src/clock-watch.ts`, `apps/server/src/clock-watch.test.ts`,
  `apps/server/src/boot.clock-watch.test.ts` (the shape of `boot.clock-behind-wiring.test.ts`:
  `serverFixture`, `vi.mock("./clock-watch.js")` capturing the start and the `stop`)
- Modify: `apps/server/src/boot.ts` (start in trading mode; `stop` onto `undoOnFailure` as soon as
  it exists, and into `closeAll([...])` at `:2859-2882` before `streamHost.stop()`)

- [ ] **Step 1: Write the failing tests** (`clock-watch.test.ts`, with injected wall, steady clock,
  timer, `stopState`, `readAuthorityTime`, `noteClockProvedWrong` and the witness store):
  1. during a stop and filing, one HEAD per tick and the sample noted; not stopped, or not filing,
     or not primary → no HEAD; the raw comparison no longer behind → `store.endStop()` called;
  2. a forward jump of 61 s between ticks → `noteClockProvedWrong` once with `trustedUntil` the
     earlier tick plus the steady time; 59 s → not called; a backward jump → not called;
  3. **[I4]** a disagreeing AEAT witness noted since the last tick, whose `boxAt` is 40 s before the
     tick → called with `reason: "authority"` and `trustedUntil` that `boxAt`, not the tick's time
     (a version using "now" fails this case);
  4. `noteClockProvedWrong` answering `unused: [id]` → one `clock_watch.disproved_unused` log line;
  5. a failing call logs `clock_watch.check_failed` and the next tick still runs;
  6. **[I3]** `stop` while a tick is in flight resolves only after it finishes; after `stop`,
     advancing the injected timer runs no HEAD and no `noteClockProvedWrong`.
  `boot.clock-watch.test.ts`: `server.close()` calls the captured `stop` once; a start that fails
  after the watch began calls it too (`undoOnFailure`).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-watch.test.ts src/boot.clock-watch.test.ts`.
- [ ] **Step 3: Implement** decisions 2 and 14.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/server exec vitest run src/boot.failed-start.test.ts`
  → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/clock-watch.ts apps/server/src/clock-watch.test.ts apps/server/src/boot.clock-watch.test.ts apps/server/src/boot.ts
  git commit -s -m "During a payment stop the box asks AEAT for its time each minute, and tells managers if a restarted clock proves wrong"
  ```

### Task 11: `clock.unusable` in the bell

**Files:**
- Modify: `packages/fiscal-verifactu/src/clock-behind-alerts.ts` (decision 15),
  `apps/dashboard/src/i18n/alert-messages.ts` (`clock.unusable`'s words, Task 12's text)
- Test: `packages/fiscal-verifactu/src/clock-behind-alerts.test.ts` (new cases; the existing ones use
  2025–2026 readings and pass unedited, CC 45)

- [ ] **Step 1: Write the failing tests**: a `2001-01-01T11:00:00.000Z` reading with a record →
  exactly one alert `{ key: "clock.unusable", code: "clock.unusable", severity: "error", since:
  null, screen: "box-status", params: { clockAt } }`; the same with no records → the same one;
  `2024-10-28T00:00:00.000Z` with no records → none.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-behind-alerts.test.ts`.
- [ ] **Step 3: Implement**; add the words.
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts`
  → PASS (`clock-behind-alerts.ts` is on the ongoing guard's list, CC 44).
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-behind-alerts.ts packages/fiscal-verifactu/src/clock-behind-alerts.test.ts apps/dashboard/src/i18n/alert-messages.ts
  git commit -s -m "Managers see a box clock set before 28 October 2024 in the bell"
  ```

### Task 12: The words — refusals and the email (the alert sentences went in with Tasks 4, 7, 11)

**Files:**
- Modify: `apps/dashboard/src/i18n/codes.ts` (one generic sentence for `clock.restart_refused`
  **[M6]**), `apps/dashboard/src/i18n/strings.ts` (`box_status.clock.refused.<reason>`, EN and ES),
  `apps/server/src/i18n/box-emails.ts` (`clock.behind_chain`), `apps/server/src/box-alert-email.ts`
  (decision 16)
- Modify (declared changes 5, 6 and 7, own commit): `apps/server/src/box-alert-email.test.ts:15-24`
  and `:45`, `apps/server/src/box-alert-email.duty.test.ts:381-392`
- Test: `apps/server/src/box-alert-email.test.ts`, `apps/server/src/box-alert-email.duty.test.ts`
  (new cases)

**Words.**
- `clock.disagrees` (Task 4): EN "{count} devices agree that the time is {deviceAt:minute}, but the
  box's clock reads {boxAt:minute}. Check the box's date and time on the Box status page." / ES
  "{count} dispositivos coinciden en que son las {deviceAt:minute}, pero el equipo marca
  {boxAt:minute}. Comprueba la fecha y la hora del equipo en Estado del equipo."
- `clock.unusable` (Task 11): EN "The box's clock reads {clockAt:minute}, before 28 October 2024, so
  no sale can be recorded for the tax agency. Connect the box to the internet; if its clock does not
  correct itself, ask whoever installed it to set it." / ES "El equipo marca {clockAt:minute}, antes
  del 28 de octubre de 2024, así que no se puede registrar ninguna venta en Hacienda. Conecta el
  equipo a internet; si la hora no se corrige sola, pide a quien lo instaló que la ponga."
- `clock.behind_chain_restarted` (Task 7, design §4.8 c): EN "{person} restarted payments on the
  box's clock ({clockAt:minute}), earlier than the last sale ({lastRecordAt:minute}). Proof:
  {proof:clock_restart_proof}." / ES "{person} reanudó los cobros con la hora del equipo
  ({clockAt:minute}), anterior a la última venta ({lastRecordAt:minute}). Prueba:
  {proof:clock_restart_proof}." List `clock_restart_proof`: `authority` "the tax agency's time" /
  "la hora de Hacienda"; `devices` "the clocks of two devices or more" / "la hora de dos
  dispositivos o más"; `authority_and_devices` "the tax agency's time and two devices or more" /
  "la hora de Hacienda y de dos dispositivos o más"; otherwise "recorded on the box" / "anotada en
  el equipo" **[I1]**.
- `clock.behind_chain_disproved` (Task 7, design §4.8 b): EN "Sales recorded between {from:minute}
  and {to:minute} were dated by a clock that proved wrong. They stay as recorded; ask your tax
  adviser." / ES "Las ventas registradas entre {from:minute} y {to:minute} se fecharon con un reloj
  que resultó estar mal. Quedan como se registraron; consúltalo con tu asesor."
- `clock.restart_refused` in `codes.ts`: EN "Payments cannot be restarted now. Look at the Box status
  page." / ES "Ahora no se pueden reanudar los cobros. Mira Estado del equipo."
- `box_status.clock.refused.<reason>`: `no_proof` "There is no fresh proof that the box's clock is
  right." / "No hay ninguna prueba reciente de que la hora del equipo sea correcta."; `contrary_proof`
  "Other clocks say the box's clock is wrong." / "Otros relojes dicen que la hora del equipo está
  mal."; `too_far` "The box's clock is more than 24 hours behind the last sale." / "La hora del
  equipo está más de 24 horas por detrás de la última venta."; `stepped_back` "Payments were already
  restarted, and the box's clock has gone back since. Get the clock checked." / "Ya se reanudaron los
  cobros y la hora del equipo ha retrocedido desde entonces. Haz que revisen la hora.";
  `record_changed` "The last sale changed. Look at the page again." / "La última venta ha cambiado.
  Vuelve a mirar la página."; `not_stopped` "Payments are not stopped." / "Los cobros no están
  parados."
- Email `clock.behind_chain` (design §4.8 c, departure 4): subject EN "Payments stopped at {venue}:
  the box's clock reads earlier than its last sale" / ES "No se puede cobrar en {venue}: la hora del
  equipo es anterior a la última venta"; text EN "The box's clock ({clockAt}) reads earlier than its
  last recorded sale ({lastRecordAt}). Since then no device can take payment. Orders can still be
  taken and sent to the kitchen. What to do: • If the box's clock is wrong (usual after a power
  cut): connect the box to the internet so it corrects itself, or call whoever installed it. • If
  you think the box's clock is right: look at the Box status page (in the dashboard, Settings → Box
  status), which says whether payments can be restarted." / ES the design's body, with "[Abrir
  Estado del equipo]" replaced by "(en el panel de gestión, Ajustes → Estado del equipo)".

- [ ] **Step 1: Write the failing tests**: the email with `{clockAt: "2025-03-14T08:12:00.000Z",
  offsetMinutes: 60, lastRecordAt: "2026-10-18T21:40:00.000Z", lastRecordOffsetMinutes: 120}` →
  "14/03/2025 09:12" and "18/10/2026 23:40" in both languages; the duty sends one email per stop per
  manager with those times, keeps the first notice's params when a later read's `clockAt` differs,
  and sends again after the notice went and came back; the dashboard's `clock.restart_refused`
  sentence in both languages.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts src/box-alert-email.duty.test.ts`.
- [ ] **Step 3: Implement.** Then `box-alert-email.test.ts:15-24` and `:45`, and
  `box-alert-email.duty.test.ts:381-392`, fail as the claim check printed (`c15-email-words.log`).
- [ ] **Step 4: Commit the implementation, then declared changes 5, 6 and 7 alone**, after which:
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts src/box-alert-email.duty.test.ts`
  → PASS, and `pnpm exec vitest run scripts/alert-codes.test.ts scripts/ongoing-alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`
  → PASS.
  ```bash
  git add apps/dashboard/src/i18n/codes.ts apps/dashboard/src/i18n/strings.ts apps/server/src/i18n/box-emails.ts apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.test.ts apps/server/src/box-alert-email.duty.test.ts
  git commit -s -m "Words for the restart refusals, and the managers' email when payments stop for the clock"
  ```
  The new cases go in that first commit; then edit `:15-24`, `:45` and `:381-392` as declared and
  commit them with `git commit -s -m "Changed test checks (A798 slice 9): clock.behind_chain has email words with both times"`,
  each before and after in the body.

### Task 13: The Clock row — the offer, the reasons, and which way the clock is off

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`BoxHealth.clockStop` beside `:1715`;
  `restartClockPayments(recordId)` beside `freeBoxSpace` at `:4183`),
  `apps/dashboard/src/screens/box-status-rows.ts` (decision 17's line; while `clockStop` is not null,
  a detail line with the proof — "Tax agency: matches (checked {time})", "Devices: {count} read
  {time}" — and a line for any offer other than `"offered"`: `box_status.clock.refused.<offer>`'s
  words, or "Payments restarted by {person} at {time}" for `"restarted"`),
  `apps/dashboard/src/i18n/strings.ts` (EN and ES)
- Modify (declared change 8, own commit): `apps/dashboard/src/screens/box-status-rows.test.ts:534`
- Test: `apps/dashboard/src/screens/box-status-rows.test.ts` (new cases; fixtures gain `clockStop: null`)

- [ ] **Step 1: Write the failing tests**: a drift of +90 s → `compared_ahead`, −90 s →
  `compared_behind`, 2 s → `compared`; `clockStop` with each offer → the row's detail lines;
  `"restarted"` → the row amber, not red, with who and when; the restart offer never on a row whose
  `clock.unusable` notice is on.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts`.
- [ ] **Step 3: Implement.** `:534` now fails (it expects `compared`); leave it red.
- [ ] **Step 4: Commit the implementation and the new cases**, then declared change 8 alone:
  ```bash
  git add apps/dashboard/src/api/client.ts apps/dashboard/src/screens/box-status-rows.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/box-status-rows.test.ts
  git commit -s -m "The Box status page's Clock row shows the proof the box has, why payments cannot be restarted, and which way the clock is off"
  ```
  Then edit `:534` as declared, run the file → PASS, `git add` it and
  `git commit -s -m "Changed test checks (A798 slice 9): the Clock row says the box was behind for a drift of -3600 s"`.

### Task 14: The restart dialog

**Files:**
- Modify: `apps/dashboard/src/screens/box-status-screen.ts` (the button on the Clock row, shown only
  for `"offered"`; the `wt-dialog`, decision 18), `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/box-status-screen.test.ts`, `apps/dashboard/src/screens/box-status-screen.a11y.test.ts`
  (new cases, both themes)

**Words** (design §4.8 b): title "Restart payments?" / "¿Reanudar los cobros?"; rows "The box reads"
/ "El equipo marca", "The last sale reads" / "La última venta marca", "Tax agency" / "Hacienda"
("matches (checked {time})" / "coincide (comprobado {time})"), "Devices" / "Dispositivos" ("{count}
read {time}" / "{count} marcan {time}"); body "If you restart, the next sales carry the box's clock,
earlier than the last sale's. No recorded sale is changed. It is noted that you did it." / "Si
reanudas, las ventas siguientes llevarán la hora del equipo, anterior a la de la última venta. No se
cambia ninguna venta registrada. Queda anotado que lo has hecho tú."; buttons "Cancel" / "Cancelar"
and "Restart payments" / "Reanudar los cobros".

- [ ] **Step 1: Write the failing tests**: no button unless `"offered"`; the dialog shows both
  times and the proof lines; Confirm sends `restartClockPayments(recordId)` with the page's
  `clockStop.recordId`, is disabled and loading while it waits, closes on success and refreshes
  (`liveData.refresh`, as Liberar does at `:222`); a refusal shows `box_status.clock.refused.<reason>`
  on its own line above the buttons, leaves Confirm enabled **and calls `liveData.refresh`**
  **[M9]**; Cancel and Escape close with no request; axe passes for the row with the button and the
  open dialog in light and dark.
- [ ] **Step 2: Run and watch them fail** (Chromium: memory first).
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts src/screens/box-status-screen.a11y.test.ts`.
- [ ] **Step 3: Implement.** No hand-drawn field; `wt-dialog` and `wt-button` only.
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/help-tooltip-mode.test.ts`
  → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/dashboard/src/screens/box-status-screen.ts apps/dashboard/src/screens/box-status-screen.test.ts apps/dashboard/src/screens/box-status-screen.a11y.test.ts apps/dashboard/src/i18n/strings.ts
  git commit -s -m "The Box status page asks a manager to confirm a restart of payments, showing both times and the proof"
  ```

### Task 15: The backup verifier learns the restarts' links

**Files:** `packages/fiscal-verifactu/src/backup-verification-history.ts` (`LINKS`, `:424-433`),
`packages/fiscal-verifactu/src/backup-verification-history.test.ts` (two new rows in the "rejects
internally damaged %s" table, `:283-296`, and a restart row in the fixture's capture)

- [ ] **Step 1: Write the failing cases**: "restart node parent" (`update clock_stop_restarts set
  node_id='missing'`) and "restart record parent" (`… set registro_id='missing'`) → `invalid`.
- [ ] **Step 2: Run and watch them fail** (`passed` where `invalid` is expected):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-history.test.ts`.
- [ ] **Step 3: Implement** decision 19.
- [ ] **Step 4: Run** → PASS, every existing case unedited.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/backup-verification-history.ts packages/fiscal-verifactu/src/backup-verification-history.test.ts
  git commit -s -m "The backup check refuses a copy whose payment restarts name a missing node or record"
  ```

### Task 16: The guides

**Files:** `apps/server/src/guide/en/box-status.md` and `apps/server/src/guide/es/box-status.md`
(`{#clock-behind}`: a third way out; `{#emails}`: the clock-stop email; a new `{#clock-witnesses}`
section after `{#clock-behind}`); `apps/server/src/guide/en/till-notices.md` and its twin
(`:31-57`).

What they say, in the guides' plain style (`~/.claude/docs-writing-style.md`):
- **Restart payments** as the third way out: only when the clock is right and the last sale's time
  was wrong; the page offers it only with fresh proof (the tax agency's time, or two devices, within
  a minute, in the last five minutes, since payments stopped), never after the tax agency disagreed
  during the stop, and at most 24 hours behind; who can (people who manage the system); what it does
  and never does (no recorded sale changes; the next sale carries an earlier time than the last; it
  is noted who did it); it allows one step back only — if the clock goes back again by more than a
  minute behind the latest sale made since the restart, even a little at a time, payments stop
  again and the page says to get the clock checked **[C1, r3 I1]**; a second press shows the first;
  if the accepted clock later proves wrong, the bell says which sales are affected and to ask the
  tax adviser, and that sales made after that alert are not added to it **[r3 M1]**. Rewrite "Wait … This is the only way out when the clock is
  right…" (EN `:118-120`), which this slice makes false.
- `{#clock-witnesses}`: tills and handhelds send their clock to the box (kitchen screens do not);
  the bell warns when two agree the box is off; staff see nothing for that.
- `{#emails}`: the list gains "its clock reads earlier than its last sale, so payments have
  stopped".
- `{#clock-behind}`'s paragraph on a clock before 28 October 2024: the bell now says so too.

- [ ] **Step 1: Write** all four files; ids shared.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts` → PASS.
- [ ] **Step 3: Commit.**
  ```bash
  git add apps/server/src/guide/en/box-status.md apps/server/src/guide/es/box-status.md apps/server/src/guide/en/till-notices.md apps/server/src/guide/es/till-notices.md
  git commit -s -m "Guides: restarting payments with proof the clock is right, devices as clock witnesses, and the clock-stop email"
  ```

### Task 17: Developer docs, CLAUDE.md and the compliance file

**Files:** `CLAUDE.md` §5 (the clock-stop rule slice 8 added); `docs/developers/conventions-data.md`;
`docs/compliance/asesor-questions.md` (`:3637-3638`, `:3678`); `docs/compliance/verifactu-findings.md`

- [ ] **Step 1: CLAUDE.md §5.** Add to the clock-stop rule, keeping it a rule **[M10, C1]**: "A
  manager's restart (`clock_stop_restarts`) lifts it for ONE step back: once a record is written
  under it, every reading is held to the minute against the latest time among the records written
  under it, and the stop reads that table only through `clockBehindChain`; a row whose stored chain
  heads are malformed covers nothing **[r3 I1, I2, M3]**. Guards:
  `packages/fiscal-verifactu/src/clock-behind.restart.test.ts` and
  `packages/fiscal-verifactu/src/clock-stop-restart.test.ts`, weaker than the rule — they cover the
  readings they name." Run `pnpm exec prettier --check CLAUDE.md` and
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (it reads backticked paths starting with
  a top-level directory, `:31-61`, which is why both are full paths).
- [ ] **Step 2: conventions-data.md**: the receipt — decision 8 (one latest record, the cover, the
  one step back), decision 9's order, decisions 4–6, Q1–Q8, and that AEAT's time is the QR host's
  `Date` header (P3, P5) while `consultar`'s was not measured (P11).
- [ ] **Step 3: asesor-questions.md**: Q51's "Not built: it is slices 8 and 9" and Q52's "Not built:
  it is slice 9" become dated pointers "Built by A798-B slices 8 (#2012) and 9 (#…), 2026-10-…;
  parked for the owner. One step back per restart; later records are held to the minute." No
  question text changes.
- [ ] **Step 4: verifactu-findings.md**: a dated pointer that slice 9 adds the restart.
- [ ] **Step 5: Commit.**
  ```bash
  git add CLAUDE.md docs/developers/conventions-data.md docs/compliance/asesor-questions.md docs/compliance/verifactu-findings.md
  git commit -s -m "CLAUDE.md and docs: a manager's restart lifts the clock stop for one step back, and where its proof comes from"
  ```

### Task 18a: LOOK in English

**Files:** a throwaway `apps/dashboard/src/zz-clock-restart.look.test.ts`, never committed;
screenshots to `~/waitron-campaign-b/a798-9-shots/`. A fix is committed with the file it touches.

- [ ] **Step 1: Write the throwaway look test**, shaped like slice 8's Task 17a (light and dark ×
  1280 and 390, the language a parameter): the Box status page during a stop with (a) no proof,
  (b) contrary proof from three devices (picture 9's top), (c) an offer with AEAT and two devices
  (picture 9's bottom row), (d) the dialog open, (e) the dialog with a `too_far` refusal under it,
  (f) after a restart, the amber row with who and when, (g) `stepped_back`; the bell open on
  `clock.disagrees`, two `clock.behind_chain_restarted` and a `clock.behind_chain_disproved`; the
  bell on `clock.unusable`. `page.screenshot` to a gitignored `__screenshots__/a798-9/` path; one
  contact sheet per theme and width with `sharp`; copy to `~/waitron-campaign-b/a798-9-shots/`.
- [ ] **Step 2: Run** `-t en` and LOOK beside picture 9: the proof lines readable and never broken
  mid-time at 390; the button on the row and the dialog's buttons; the refusal on its own line
  above them; the bell's sentences, with the proof's words and no dash. Write what you saw, sheet by
  sheet.
- [ ] **Step 3: Fix and re-run**, each fix with a test that would have caught it where one can.

### Task 18b: LOOK in Spanish

- [ ] **Step 1: Run** `-t es` and LOOK as 18a; the longer Spanish sentences fit at 1280 and wrap
  cleanly at 390.
- [ ] **Step 2: Fix and re-run**, then `-t en` once.
- [ ] **Step 3: Remove the throwaways**; `git status --short` shows none.

The till is unchanged on screen (it only sends a header), so no till LOOK.

### Task 19: Backlog

**Files:** `docs/backlog.md` (A798-B, `:4631-4649`, and the entries it names), `docs/backlog/box.md`,
`docs/backlog/fiscal.md`

- [ ] **Step 1: The A798-B entry**: "slice 9 (devices report their clock; `clock.disagrees` and
  `clock.unusable` in the bell; a manager's restart of payments with fresh proof, at most 24 hours
  behind and one step back, kept in `clock_stop_restarts`, with its bell alerts and the disproof
  check; the clock-stop email; parked for the owner) is #<PR>."
- [ ] **Step 2: Delete** the entries this slice finishes: "The clock stop's email is slice 9's"
  (`:4651-4656`); "The backup verifier does not know `clock_stop_restarts`' links" (`:4724-4726`);
  "Which alert area `clock.unusable` belongs to" (`:4830-4833`). Replace "The Box status page's
  Clock row drops the drift's sign, and an open clock-drift alert's seconds can differ from the
  latest read" (`:4769-4773`) by its open half: "**An open clock-drift alert's seconds can differ
  from the Clock row's.** The bell reads less often than the page. Left open by A798-B slice 7."
- [ ] **Step 3: Short open entries**, each "Left open by A798-B slice 9 (#…)":
  - "**AEAT's time for a restart comes from its QR validation host, not from a `consultar` reply.**
    Whether a certificate-authenticated `consultar` reply carries a `Date` header is not measured.
    The `verifactu` repository's live workflow can measure it without filing: a manual run in its
    `consult` mode sends one `consultar` (`scripts/live-aeat.mjs:2440-2451`), and one added line in
    its `fetch` wrapper (`:2426-2431`) writing `response.headers.get("date")` to its output would
    print it. The production QR host was not tried either." (decision 1; P11) **[CC 12]**
  - "**Two devices can fake a restart's proof.** A device's clock reading is whatever it sends; the
    restart still needs a manager's press and a gap of at most 24 hours."
  - "**Two restarts whose named records belong to one sale share a bell alert.** The open-alert
    index keys a restart's alerts by that sale (slice 9 decision 13), so the second is not recorded
    while the first is open; the table keeps both. Only an alta and its own anulación share a sale,
    and no route issues an anulación today." **[CC 28, CC 29]**
  - "**`clock.unusable` in the bell is judged at offset 0**, so in the first hours of 28 October 2024
    local time the bell can say the clock is before that day where the till does not."
  - "**During a stop the box sends AEAT's QR host a HEAD once a minute**, for as long as the stop
    lasts." (decision 2)
  - "**An AEAT disagreement blocks a restart for the rest of the stop, even after the clock is
    stepped.** The owner may prefer it to lapse at a step (slice 9 decision 4)." **[I5]**
  - "**A restart under which no sale was recorded raises no 'disproved' alert** when its clock later
    proves wrong; the box logs it." (decision 14)
  - "**After a 'disproved' alert, the restart still covers and later sales are not added to the
    alert.** Its `{to}` is the latest sale when the disproof was seen; sales made afterwards on the
    same clock appear in no alert. Whether a disproof should stop payments again is for the owner
    (slice 9 decision 14)." **[r3 M1]**
  - "**A malformed restart row covers nothing, for ever.** `clock_stop_restarts` is append-only, so a
    row whose stored chain heads are wrong cannot be corrected; it lifts no stop (slice 9 decision
    21)." **[r3 I2]**
- [ ] **Step 4: Outside A798, in `docs/backlog/fiscal.md`**: "**A679's internet time reading came
  back unavailable against pre-production in each of four runs on 2026-10-23.**
  `observeInternetHourClock` asks the submission host, which answered a certificate-less request with
  a redirect to another site and no `Date` header, and the reading follows only same-origin
  redirects (A798-B slice 9 plan, P1 and P2; production not tried). Found while planning A798-B
  slice 9." **[CC 7]** Add a one-line pointer to it in `docs/backlog.md`'s fiscal area.
- [ ] **Step 5: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true`.
  ```bash
  git add docs/backlog.md docs/backlog/box.md docs/backlog/fiscal.md
  git commit -s -m "Backlog: A798-B slice 9 lets a manager restart payments with proof the clock is right; what it leaves open"
  ```

---

## Overlap with open pull requests (checked 2026-10-23)

`gh pr diff <n> --name-only` (and, for #1990, whose diff is too large for that command,
`gh api repos/clintongormley/waitron/pulls/1990/files --paginate`; lists in the probe folder,
`pr-<n>-files.txt`; the review's G found the same lists):
- **#1990** (`feat/a947-4a-minute-names`, fiscal, owner lands; 191 files): shares
  `apps/server/src/boot.ts` (Tasks 3, 4, 9a, 9b, 10b), `packages/fiscal-verifactu/src/backup-verification-history.ts`
  and its test (Task 15), `packages/fiscal-verifactu/src/errors.ts` (Tasks 6, 7), `CLAUDE.md` and
  `docs/developers/conventions-data.md` (Task 17) and `docs/backlog.md` (Task 19). It changes
  `hour-clock.ts` and `hour-setup-clock.ts`, which this slice does not touch, and not
  `hour-clock-internet.ts`, which Task 10a imports.
- **#2003** (`feat/a758-7-collect-at-counter`, 32 files): shares `apps/till/src/api/client.ts` (Task
  3) and `docs/backlog.md` (Task 19); it also changes `apps/till/src/till-app.ts`, which this slice
  does not, and this slice adds a case to `apps/till/src/till-app.test.ts`, which it does not change.
- **#2010** (`chore/a974-test-helper-identifiers`, 5 files) and **#1986**
  (`fix/a974-core-comments-english`, 2 files): share only `docs/backlog.md`.

## Self-review against the spec

- §8 item 9's scope: the device reading (Task 3), AEAT's time (Tasks 4, 10a, 10b; departure 1), the
  restart route behind `system.manage` with fresh proof and the 24-hour cap writing
  `clock_stop_restarts` (Tasks 6, 9a), the two recorded alerts (Task 7), the Reloj row and dialog
  (Tasks 13, 14); plus the clock-stop email (Task 12) and the minimum-date alert (Task 11).
- §8 item 9's tests: no proof, no restart — Task 6 case 2, Task 9a case 1; contrary proof — Task 6
  case 3, Task 9a case 2; a 25-hour gap — Task 6 case 4, Task 9a case 3; a second restart answered
  with the first — Task 6 case 7, Task 9a case 5; marking the bell's alert handled leaves payments
  running — Task 9b case 1.
- §4.5 item 3: `clock.disagrees` with two devices that spoke in the last five minutes (Tasks 2, 4).
- §4.8 b: proof gathered after the stop began (decision 6), any AEAT evidence the other way blocks
  (decision 4), the one backward step a restart puts in the chain (decision 8; "a clock that keeps
  moving back is not one to trust"), what it never changes (Q1–Q8), disproof (Tasks 7, 10b), the
  table read directly (decision 8), the dialog (Task 14).
- §4.8 c: the restart and disproved alerts in the stop's area, one per restart (Task 7), the email
  (Task 12).
- §4.8 d: what clears it — the restart (Task 5); devices and AEAT never lift it themselves; the
  28-10-2024 rule first (decision 9.1, Task 11).
- §7: no new table; witnesses in memory (decision 4).

## Revision 3, finding by finding

- **r3 I1**: decision 8c now holds each reading to the latest TIME among the records written under
  the restart (a running maximum); Words, 8d, Behaviour 1, the PR description, the guide and the
  CLAUDE.md sentence reworded; Task 5 case 3b (the twelve-step walk, S5) with its proof by deletion
  (S11); Codex seat 2's list; golden and `inmutabilidad` re-run unedited (S14).
- **r3 I2**: one definition — `heads`, every chain's largest `secuencia` (decisions 10, 21);
  fails closed with no throw for a `null` proof and every impossible value (S6, S7, proof by
  deletion S12); the row's `node_id` is not read (S9); two chains (S8, S10); Task 5 cases 8b–8c and
  Task 6 case 1b through the real writer.
- **r3 M1**: `from`/`to` are the earliest and latest generation times, not write order (decision 14,
  Task 7 case 2); after a disproof the restart still covers and later sales join no alert — the guide
  and a backlog entry say so.
- **r3 M2**: the tie-break's proof by deletion is now one reader ordering by `id asc` (S13: eight of
  eight runs differ); Q5's "named secuencia 2" dropped.
- **r3 M3**: the CLAUDE.md sentence says the stop reads the table through `clockBehindChain`, not
  that it is the only reader.
- **r3 M4**: Task 9a case 6 no longer says the 500's log names the index (S15).
- **r3 M5**: decision 8a no longer lists the disproof among `latestRecord`'s callers.
- **r3 M6**: `till-app.ts:17853` is the empty-service-zone section's Retry button.

## Revision 2, finding by finding

- **C1**: decision 8 (8b–8d) and Words; `recordsBefore` in the proof (decision 10); Task 5 cases 2–4
  with Q1/Q2/Q3 and the proof by deletion Q7; Task 9b case 2; Q8 reruns the golden and
  `inmutabilidad`; decision 14's backward-step sentence now true; guide, CLAUDE.md, asesor pointer,
  Review focus 3, Codex seat 2 and the PR description say which reading was built.
- **I1 / CC 46**: `{proof:clock_restart_proof}` and the registered list (decision 13, Tasks 7, 12);
  Task 7 case 3 fails on the dash.
- **I2**: the racing-press case moved to the real route (Task 9a case 6) with a proof by deletion
  that prints a 500; the conflict clause and the "read the row on conflict" branch dropped
  (decision 10).
- **I3**: the watch's `stop` on the close list and `undoOnFailure`, waiting for a tick in flight
  (decision 14; Task 10b case 6 and `boot.clock-watch.test.ts`).
- **I4**: `trustedUntil` for an AEAT disproof is the witness's `boxAt`; `from`/`to` are the first and
  newest records written under the restart; none written, no alert (decision 14; Task 7 case 2,
  Task 10b case 3).
- **I5**: AEAT disagreements kept for the rest of the stop (decision 4, departure 2; Task 2 case 5,
  Task 6 case 3), with the alternative for the owner and a backlog entry.
- **I6**: Tasks 9 → 9a, 9b; Task 10 → 10a, 10b.
- **I7**: one `latestRecord(tx)` with an `id` tie-break (decision 8a; Q5; Task 5 case 7).
- **CC 7**: "always" narrowed to four runs on 2026-10-23 (P2, Task 19).
- **CC 10, 11**: the certificate search corrected and re-run (P11, Q11).
- **CC 12**: the live workflow's `consult` mode and the one-line change (P11, Task 19).
- **CC 28, 29**: each restart's alerts keyed by its named record's sale (decision 13; Q10; Task 7
  case 4); "folded into" removed.
- **CC 35**: kitchen screens traced and probed (Q9; decision 3; Task 3's kept test).
- **CC 42, 43**: existing assertions 3–7 declared; "every existing duty case passes unedited"
  removed.
- **M1** exact 24 h cap (departure 6, Q4); **M2** midpoint and the drain's 500 ms (decisions 1, 4;
  Task 4); **M3** arrival readings (decision 3; Task 3); **M4** Task 6 records no alert; **M5**
  registry entries (decision 13, Global constraints, Task 7); **M6** reason words' home (decision 18,
  Task 12); **M7** body and session cases, no `authorizeSystemManager` (decision 12, Task 9a case 4);
  **M8** answered by CC 28/29's keying; **M9** refresh after a refusal (decision 18, Task 14); **M10**
  full paths (Task 17); **M11** "group" defined (decision 5, Task 1 case 4); **M12** Stryker `mutate`
  (Task 1).
- Line citations the claim check found a line or so off (CC 9, CC 51, CC 54) are corrected in place.

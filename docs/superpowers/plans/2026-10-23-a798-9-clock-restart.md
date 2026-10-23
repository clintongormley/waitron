# A798-B slice 9 — devices report their clock, `clock.disagrees`, `clock.unusable` in the bell, the manager's restart, and the clock-stop email

> **No migration.** The table this slice writes, `clock_stop_restarts`, and the index the stop reads
> were created by slice 8 (`packages/fiscal-verifactu/drizzle/0010_clock_stop.sql`). Nothing here
> adds or changes a table, an index or a trigger. If a task finds it needs one, STOP and report: it
> changes the lane's scheduling.
>
> **Parked for the owner** (build plan Part 1, row 9): the restart lifts the payment stop and lets a
> record be written with a generation time earlier than the record before it, and the box asks
> AEAT's web server for its time. It does **not** touch what is hashed (`computeHuella`, in
> `@waitron/verifactu`, outside this repository), the chain's links (`chain.ts`), numbering, series
> allocation, the alta and anulación builders or `registros_facturacion`'s immutability. The lift
> lives entirely in `packages/fiscal-verifactu/src/clock-behind.ts`, which `attemptAppend` already
> calls (P6–P9). The golden fingerprint test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`)
> and `inmutabilidad.test.ts` pass **unedited**. If a task finds it must change either, `chain.ts`,
> or anything else on that list, STOP and report.
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation, then run it again.
> Implementers are dispatched as `subagent_type: "implementer"`. Tasks run in their numbered order.
> Every task ends with the root guards and its own files green; the one exception inside a task is
> the commit just before a declared `Changed test checks` commit (Tasks 7 and 13), which that commit
> turns green straight after.
>
> **Existing assertions.** This plan changes exactly these existing assertions, declared here so no
> implementer has to decide one. Each goes in the task named, in one commit of its own whose message
> begins `Changed test checks (A798 slice 9):` and lists each `file:line` with its before and after;
> the pull request names them.
> 1. `packages/fiscal-verifactu/src/alerts.test.ts:7-10` (`FISCAL_ALERTS` `toEqual`): `events`
>    **gains** `{ prefix: "clock.behind_chain", area: "box", permission: "system.manage" }` after the
>    `fiscal.` claim (Task 7). A list that pins a whole shape gains one entry and every existing
>    entry stays: the owner's standing exception (2026-09-27).
> 2. `scripts/alert-codes.test.ts:23-40` (`INCIDENT_CODE_SOURCES`) **gains**
>    `"packages/fiscal-verifactu/src/clock-stop-incidents.ts"` (Task 7). It is the guard's hand-kept
>    list of files that record incidents; without the entry its first case ("every file that
>    records an incident is a listed code source") fails, as the design foresaw (§4.8 c).
> 3. `apps/dashboard/src/screens/box-status-rows.test.ts:534` (the Clock row's detail for a drift of
>    `driftSeconds: -3600`): `fill("box_status.clock.compared", { …, seconds: "3600" })` becomes
>    `fill("box_status.clock.compared_behind", { …, seconds: "3600" })` (Task 13). The row now says
>    which way the box's clock is off past a minute (decision 17); the cases at `:156` and `:602`
>    (2 s apart) keep `compared` unchanged.
>
> Test **setup** changes (a stub's methods, a fixture's input) are allowed where a task names them;
> they are never an assertion. Any other assertion that turns out to need changing is a STOP:
> report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Base.** Every `file:line` below was read at `main` `de73c6144` (2026-10-23), this branch's base
> (`feat/a798-9-clock-restart`, worktree `waitron-feat-a798-9-clock-restart`); that base holds slice
> 8 (#2012) and slice 10 (#2019). Every claim about how the box, the engine, a library or AEAT
> behaves cites a probe in "Measured for this plan", run that day on macOS (Darwin 25.6.0), Node
> v26.11.1, from scratch files under `~/waitron-campaign-b/a798-9-plan-probe/` (scripts in
> `scripts/`, logs beside them) and a throwaway worktree of `de73c6144` made with
> `git worktree add --detach` and `pnpm install --frozen-lockfile --offline` (`Done in 3.6s`,
> `install.log`), removed afterwards. A claim marked **(read)** comes from reading code, not running
> it. Nothing was measured on Linux, on a real box, or against AEAT's production hosts.

**Words used in this plan.**
- The **stop** is slice 8's: open while a reading of the box's clock is more than 60 000 ms earlier
  than the **latest record time** (the largest `fecha_hora_huso_gen_registro` in
  `registros_facturacion`, any chain, any kind). The **raw comparison** is that test alone, before
  any restart is taken into account.
- The **gap** is the latest record time less the reading, in milliseconds.
- A **restart** is one row of `clock_stop_restarts`
  (`packages/fiscal-verifactu/src/schema/clock-stop-restarts.ts`): who, when, the reading accepted
  (`clock_at`), the record it names (`registro_id`, unique) and that record's time (`record_at`).
  The **accepted gap** is `record_at − clock_at`. A restart **covers** a reading when the latest
  record is the one it names and the gap is at most the accepted gap plus 60 000 ms.
- A **witness** is a reading of another clock taken by the box: a **device witness** (a till's or
  handheld's own clock, sent on its equipment read) or an **AEAT witness** (AEAT's time from the
  drain's submission reply or from the HEAD of decision 1). Each carries `boxAt`, the box's own
  wall clock when it was taken, `witnessAt`, the other clock's time at that moment, and
  `uncertaintyMs`.
- **Proof** for a restart is an AEAT witness that agrees with the box, or two different devices that
  each agree with it, taken during this stop and fresh (decisions 4–6). **Contrary proof** is an
  AEAT witness that disagrees, or two devices that agree with each other and both disagree with the
  box (decision 5).
- **Disproved**: after a restart, AEAT's time or a forward jump of the box's clock shows the accepted
  clock was wrong (design §4.8 b, "If the clock it accepted later proves wrong").

**Goal:** while payments are stopped for the clock, a manager on the Box status page sees whether the
box has fresh proof its clock is right and, only with such proof and a gap of at most 24 hours, can
restart payments; the restart is kept in the append-only table and the bell; the box keeps checking
and says so if the accepted clock later proves wrong; devices report their clock, so the bell warns
when two of them agree the box's clock is off; the bell shows a clock before 28-10-2024; and the
managers get the clock-stop email once per stop.

**Architecture:** seven pieces.
1. **Judging witnesses** (`packages/fiscal/src/clock-witnesses.ts`, Task 1): a pure function both
   the server's `clock.disagrees` alert and the module's restart use, so the two can never judge
   the same readings differently.
2. **Keeping witnesses** (`apps/server/src/clock-witnesses.ts`, Task 2): an in-memory store of the
   latest device readings and AEAT readings, handing out only fresh ones taken on the box's current
   clock (no step since).
3. **Feeding it**: the till sends its clock on every equipment read (Task 3); the drain's submission
   comparison and a once-a-minute HEAD to AEAT's QR validation host during a stop feed AEAT
   witnesses (Tasks 4, 10).
4. **The module's restart** (`packages/fiscal-verifactu/src/clock-stop-restart.ts`, Tasks 5–7):
   `clockBehindChain` honours a covering restart (the lift); `clockStopState` says what the Clock
   row shows; `restartAfterClockStop` writes the row and the `clock.behind_chain_restarted` alert;
   `noteClockProvedWrong` writes `clock.behind_chain_disproved`.
5. **The seat** (Task 8): four optional `FiscalBackend` methods; only Veri\*Factu has them.
6. **Server** (Tasks 9–12): the restart route, the Box status read's `clockStop`, the clock watch
   duty (AEAT HEAD, disproof), the `clock.disagrees` and `clock.unusable` alerts, the email.
7. **What people see** (Tasks 13–18): the dashboard words, the Clock row and its dialog, the guides,
   the docs, LOOK, the backlog.

**Tech stack:** TypeScript, `node:sqlite` behind drizzle 0.45.4, Hono, Lit, Vitest 4.1.12 (Node for
`packages/*` and `apps/server`; real headless Chromium for `apps/till`, `apps/dashboard` and part of
`packages/fiscal-verifactu`).

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
(the same grep finds none in an `AlertSource`). Slice 3 handed that alert, and the question of its
area, to "the slice that raises it as an alert (slice 9)" (`docs/backlog.md:4830-4833`; slice 3
plan `:2363-2365`). That is this slice's minimum-date work (Task 11; decision 15).

---

## Measured for this plan

Logs and scripts are under `~/waitron-campaign-b/a798-9-plan-probe/`.

- **P1 — AEAT's pre-production submission host, unauthenticated, gives no time**
  (`p1-head-soap.log`). `curl -sS -o /dev/null -D - -I --max-time 10 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP?waitron_clock=probe1'`
  at `Fri, 23 Oct 2026 09:34:45 GMT` (`date -u` before and after) printed `HTTP/2 302`,
  `location: https://sede.agenciatributaria.gob.es/Sede/errores/erro4033.html`, `content-length: 0`,
  and **no `date:` line**. A GET (`p4-get-soap.log`) printed the same. The failing case for "this
  host gives no time without a certificate" would have printed a `date:` line. This matches design
  §12 experiment 7 three days later.
- **P2 — so the repository's existing internet time reading comes back empty against
  pre-production** (`p2-internet-clock.log`, `p2-internet-clock.mjs`). `observeInternetHourClock`
  (`packages/fiscal-verifactu/src/hour-clock-internet.ts:40-159`, A679's hour-code setup, the only
  code in the repository that reads AEAT's time from a header) imported straight from the `.ts`
  file with Node's type stripping and run for `"preproduction"` printed
  `{"source":"internet","result":"unavailable","reason":"response",…}`: it follows only same-origin
  redirects (`:98-104`), and P1's redirect leaves the origin. The failing case for "it never reads
  a time here" would have printed `"result":"usable"`. Outside this slice; Task 19 files it.
- **P3 — AEAT's pre-production QR validation host does give its time** (`p3-head-qr-control.log`).
  `curl -sS -o /dev/null -D - -I --max-time 10 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'`
  printed `HTTP/2 200` and `date: Fri, 23 Oct 2026 09:35:02 GMT`; `date -u` right after printed
  `Fri Oct 23 09:35:02 UTC 2026`. No `age`, `cache-control` or `x-cache` header.
- **P5 — the same host through the repository's own TLS-verified HEAD** (`p5-qr-head.log`,
  `p5-qr-head.mjs`). `authenticatedHourHead` (`hour-clock-internet.ts:12-38`: HEAD,
  `rejectUnauthorized: true`, no client certificate) on `QR_ENDPOINTS.preproduction` with a random
  `waitron_clock` query, three times: each `status 200`, `date` present, `new Date(date).toUTCString()
  === date` true, `age`/`cache-control`/`x-cache` null, round trips 177–206 ms, and the box's
  midpoint less the header's instant `858`, `52` and `229` ms — inside the header's one-second
  resolution. The control in the same run, the submission host, printed `soap 302 date: null`.
  **What this does and does not show:** AEAT's public web server in pre-production states the time
  to within a second over a verified TLS connection with no certificate of ours. It says nothing
  about production's `www2.agenciatributaria.gob.es` (not tried: no production host was contacted)
  and nothing about the reply to a certificate-authenticated `consultar`.
- **P11 — a certificate-authenticated `consultar` reply was NOT measured.** No AEAT certificate is on
  this machine: `find ~ -maxdepth 5 \( -name '*.p12' -o -name '*.pfx' \)` outside `node_modules` and
  `Library` printed only `~/.mitmproxy/mitmproxy-ca.p12` and `mitmproxy-ca-cert.p12` (a proxy's own
  authority). Pre-production accepts "no test NIFs, no test certificates, no self-signed
  certificates" (`docs/compliance/getting-to-production.md:287-289`). The only AEAT certificate the
  project uses for live tests is a CI secret of the `verifactu` repository
  (`~/workspace/repos/verifactu/.github/workflows/live-aeat.yml:79-80`, `AEAT_TEST_P12_BASE64`),
  run only from that repository's `main` (`:66`), and its runs send filings; this plan neither
  dispatched it nor added a step to it. Decision 1 builds without it; Task 19 files the measurement.
- **P6–P8 — a restart row, honoured in `clockBehindChain` alone, lets the chain accept a record
  earlier than the one before it, and nothing else changes** (`p6-restart-chain.log`; the test
  `scripts/zz-restart-chain.test.ts`; the prototype `scripts/prototype-clock-behind.diff`, 13 added
  lines in `clock-behind.ts` only). In the throwaway worktree, records through `VerifactuBackend`
  and `recordSale` at offset +120:
  - P6a: a sale at `2026-10-19T21:40:00Z`, then one at `07:12:00Z` →
    `clock.behind_chain {"clockAt":"2026-10-19T07:12:00.000Z",…,"lastRecordAt":"2026-10-19T21:40:00.000Z",…}`
    (the stop, as slice 8 built it);
  - P6b: after inserting a restart naming the first record, `clock_at 07:12`, `record_at 21:40`, a
    sale at `07:13` → `recorded`;
  - P6c: a sale two minutes further back than accepted (`07:10`) → `clock.behind_chain` again;
    P6d: 59 s further back (`07:11:01`) → `recorded` (the margin);
  - the rows: `secuencia` 1, 2, 3 with generation times `21:40`, `07:13`, `07:11:01`; each later
    record's `anterior_huella` equals the one before's `huella` (`links: true`), so the chain's
    links are untouched; `verifyBackupFiscalChains` over a backup copy → `true`;
  - P7: a record at `2026-10-19T22:30:00Z` (invoice date `2026-10-20`), a restart, then a sale at
    `07:01Z` → `recorded` with `fecha 2026-10-19`, `anterior_fecha 2026-10-20`, and the backup
    verifier → `true`: the fiscal library's `validate` does not refuse an invoice dated a day before
    the one it links to;
  - P8, the control with no restart row: a sale a day behind → `clock.behind_chain`.
  `Tests 3 passed (3)`. The failing case for "the lift needs no chain edit" would have been P6b
  refused by something other than the clock check (a `fiscal.record_invalid` from `validate`, or a
  link mismatch) or the verifier answering `false`.
- **P9 — the fiscal core's suites with that prototype** (`p9-fiscal-suites-with-prototype.log`):
  `pnpm exec vitest run inmutabilidad src/write-path.e2e.test.ts src/clock-behind.test.ts src/chain.clock-behind.test.ts src/clock-behind-alerts.test.ts src/staff-notices.test.ts src/backend.clock-behind.test.ts src/clock-stop-restarts.test.ts`
  in `packages/fiscal-verifactu` → `Test Files 8 passed (8)`, `Tests 65 passed (65)`, unedited.
- **P10 — a second open incident with the same code and origin is dropped** (`p10-incident-dedupe.log`).
  Two `recordIncident` calls with `jobOrigin("dashboard")` and one code, then a count: `1`; after
  setting `acknowledged_at` on it, a third call: total `2`. That is `incidents_open_dedup` and the
  untargeted `.onConflictDoNothing()` (`packages/core/src/incidents.ts:95-108`). So a second
  restart's bell alert, while the first is not yet marked handled, is folded into it (decision 13).
- **G1 — greps at `de73c6144`.** `clock.disagrees`, `behind_chain_restarted`,
  `behind_chain_disproved`, `restart_refused`, `clockStopState` and `x-waitron-device-clock`:
  no match under `packages`, `apps` or `scripts`. `clock_stop_restarts` is written by nothing
  outside `clock-stop-restarts.test.ts` (`/usr/bin/grep -rn 'clockStopRestarts' packages apps --include='*.ts'`).
  No `AlertSource` answers `clock.unusable` (see above). Every sentence naming slice 9 outside the
  A798 plans: `docs/backlog.md:4646`, `:4651`, `:4653`, `:4724`, `:4772`, `:4832`, and
  `docs/compliance/asesor-questions.md:3678` (`/usr/bin/grep -rn -i 'slice 9'` over the tree,
  less `node_modules`; the other hits are other designs' own slice 9s).
- **R1 — reads this plan leans on (read).** The latest record is read with its offset, not its id
  (`clock-behind.ts:18-26`); the chain check is `attemptAppend`'s first statement through
  `refuseWhileClockBehind` (slice 8 decision 4); the strip's notice, the bell's alert and the named
  check all call `clockBehindChain` (`staff-notices.ts:21-38`, `clock-behind-alerts.ts:7-23`,
  `clock-behind.ts:41-48`), so one change there reaches all four. The backup verifier already keeps
  `clock_stop_restarts` immutable between copies: its table list is every classified fiscal table
  but two (`backup-verification-history.ts:27-29`); only its link list (`:424-433`) lacks the
  table's two keys. The chain verifier checks no time order (`backup-verification-chain.ts:94-138`).
  The equipment read is device-guarded and answers in write-lock turns
  (`apps/server/src/device-api.ts:397-427`); the till's client sends it with no header
  (`apps/till/src/api/client.ts:3459-3466`, `:4748-4764`); CORS lets a cross-origin request carry
  only `content-type` and the dev device header (`apps/server/src/cors.ts:17`). The only test that
  pins the equipment GET's arguments uses `expect.objectContaining` for the `init`
  (`apps/till/src/api/client.test.ts:3446-3457`), so a header added to `init` passes it.

---

## Departures from the design

1. **AEAT's time comes from a HEAD to AEAT's QR validation host, not from a `consultar` reply's
   `Date` header.** Design §8 item 9: "AEAT's time from a read-only query's `Date` header, measured
   in pre-production first"; §4.8 b names the library's `consultar`. Measured: the submission host
   gives no time without our certificate (P1), and a certificate-authenticated reply could not be
   tried (P11). The QR host is AEAT's own, read-only, needs no certificate, and gave its time over
   verified TLS to within a second (P3, P5). Decision 1; Task 19 files the `consultar` measurement
   as open, with the route to make it.
2. **AEAT proof must be fresh too (five minutes)**, as the design asks only of devices ("at least two
   devices that reported in the last five minutes"). Decision 4: one freshness rule for every
   witness, so a comparison from hours ago cannot stand as proof.
3. **The dashboard writes times as `2026-10-19 09:14`**, not `19/10/2026 09:14` (picture 9), as
   slice 7's departure 7 and slice 8's departure 4 chose (`formatIsoMinute`).
4. **The email carries no link**; it names the page by its menu path (slice 10 decision 11). The
   design's "[Abrir Estado del equipo]" becomes "en el panel de gestión, Ajustes → Estado del equipo".
5. **The restart's bell alert names its proof by kind** ("the tax agency's time", "2 devices",
   both), not the proof's figures; the figures are in the table and the dialog (decision 13).

## Decisions this plan makes that the design does not

Each is a DEFAULT to build; the owner or the plan review may overrule any.

1. **AEAT's time for a restart, two ways.** (a) The drain's existing comparison with a submission
   reply's `TimestampPresentacion` (`apps/server/src/time-health.ts:49-101`, fed at `boot.ts:2657`)
   also becomes an AEAT witness. (b) A new read: an HTTPS `HEAD` to `QR_ENDPOINTS[environment]`
   (`@waitron/verifactu`'s `dist/endpoints.js`: `prewww2.aeat.es/…/ValidarQR` in pre-production,
   `www2.agenciatributaria.gob.es/…/ValidarQR` in production), through the existing
   `authenticatedHourHead` (verified TLS, no client certificate, a random `waitron_clock` query
   against caches), with A679's header checks (a `Date` that round-trips, no `Age`, no cache hit, no
   positive `max-age`; `hour-clock-internet.ts:105-120`) and a 5 s deadline; uncertainty is 500 ms
   (the header's resolution) plus half the round trip, as A679 computes it (`:131-140`). The new
   reader lives in a new file and changes no A679 file. **Not built:** reading the `Date` header of
   a `consultar` reply (unmeasured, P11). **Not measured:** the production QR host. Cost if the
   owner wants only `consultar`: (b) is removed and, until that measurement, AEAT proof exists only
   when records are waiting to be sent.
2. **When the HEAD runs:** at most once a minute, by the clock watch (Task 10), only while the raw
   comparison is behind (the stop, or a restart covering it), the box files records (`filesRecords`,
   `boot.ts:1528-1529`) and is the primary. Never on a demo or prepare box, which never sends
   (design §4.2), never otherwise. Cost: up to 1 440 HEAD requests a day to AEAT's public host for
   as long as a stop lasts.
3. **How a device reports its clock:** a request header `x-waitron-device-clock`, the browser's
   `Date.now()` taken as the till builds its equipment read (`getDeviceEquipment`), every 15 s
   while the poll runs. The server reads it in `GET /api/device/equipment` after `requireDevice`,
   with the box's wall and steady clocks at that moment, and ignores a value that is not a safe
   integer. CORS's `allowHeaders` gains it, so a till on another of the venue's origins can send it.
   Kitchen screens do not run the equipment poll (`till-app.ts:5082` starts it on a till's
   sign-in) and so are not witnesses. Why a header and not a query: the equipment URL stays
   unchanged, which the till's tests pin (`client.test.ts:3452-3455`). Cost: latency between the
   till's stamp and the box's arrival time counts as clock difference; on a LAN it is far under the
   minute margin, and a read is abandoned after 25 s (`equipment-poll.ts:8`).
4. **Which witnesses count:** the latest reading per device, and every AEAT reading, each kept in
   memory with the box's steady clock when it was taken; one is handed out only while it is at
   most five minutes old by the steady clock **and** the box's wall clock has moved with the steady
   clock since, to within 1 000 ms (A679's tolerance, `hour-clock.ts:47`). So a reading taken before
   the box's clock was set or jumped never stands as proof about the clock after. A server restart
   forgets them all (design §7: clock checks keep their results in memory).
5. **What agrees:** a witness agrees with the box when its difference from the box, widened by its
   uncertainty, stays within 60 000 ms (`|witnessAt − boxAt| + uncertaintyMs ≤ 60 000`); it
   disagrees when even narrowed it is outside (`|witnessAt − boxAt| − uncertaintyMs > 60 000`);
   otherwise it says nothing. A device's uncertainty is 0. Two devices agree with each other when
   their differences from the box are within 60 000 ms of each other. The one-minute margin is the
   stop's own (design §4.5 item 2).
6. **"Gathered after the stop began"** is judged per witness: its `boxAt` was itself more than a
   minute earlier than the latest record time. The stop's start is not stored (design §7; slice 8
   decision 10's `since: null`), and this needs none: a witness taken while the box's clock was
   already behind is evidence about that clock.
7. **`clock.disagrees`:** an ongoing alert from the server (devices are the core's), area `box`,
   permission `system.manage`, severity `warning`, `since: null`, `screen: "box-status"`, raised
   whenever two or more fresh devices agree with each other and both disagree with the box, stop or
   no stop. Params `{ count, deviceAt, boxAt }`: how many devices are in the largest such group, the
   group's mean device time projected to the read, and the box's time at the read (ISO). Staff see
   nothing: A364 still holds for every clock that is not behind the last record (design §6).
8. **The lift lives in `clockBehindChain`.** When the raw comparison is behind and a restart names
   the latest record and covers the reading, `clockBehindChain` answers `null`. Every reader of the
   stop then lifts together — the strip, the bell's `clock.behind_chain`, the named check on every
   money route, the chain check inside the append, the drift alert's suppression and the email's
   episode — with no edit to `chain.ts` (P6–P9). The covering tolerance is the stop's margin: up to
   60 000 ms further back than accepted still sells (P6d), more stops again (P6c), so a time sync's
   small step back does not stop a venue twice.
9. **The restart's checks, in this order**, each refusing `clock.restart_refused { reason, … }`
   (HTTP 409) unless it says otherwise:
   1. a reading before 28-10-2024 → `clock.unusable` itself (design §4.8 d: "The 28-10-2024 rule is
      checked first");
   2. the raw comparison not behind → `reason: "not_stopped"`;
   3. the record the page showed (`recordId` in the request) is no longer the latest →
      `"record_changed"`, so a press never restarts on times the manager did not see;
   4. a restart already names the latest record: if it covers the reading, the answer is that
      first restart, `replayed: true`, HTTP 200, no row and no alert ("a second restart of the same
      record is answered with the first"); if not, `"stepped_back"` with `{ personId, restartedAt }`
      of the first (the page says to get the clock checked);
   5. gap more than 24 hours (`> 86 400 000` ms; exactly 24 h is allowed) → `"too_far"`;
   6. contrary proof (decision 5) → `"contrary_proof"`;
   7. no proof → `"no_proof"`.
   The same function answers the Box status page's offer, so the page offers exactly what the press
   would accept at that moment.
10. **What a restart row holds:** `node_id` the box's node, `person_id` the manager, `restarted_at`
    and `clock_at` both the route's one reading (the design: "when (on the box's clock)" and "the
    box's reading"), `registro_id` and `record_at` the latest record, `proof` the agreeing witnesses
    only: `{ authority: { boxAt, witnessAt, uncertaintyMs } | null, devices: [{ deviceId, boxAt,
    witnessAt }] }`. The insert names its conflict target (`registro_id`): a racing second press
    finds the first and answers it as a replay (CLAUDE.md §3, "An untargeted
    `.onConflictDoNothing()`…").
11. **The seat gains four OPTIONAL methods** on `FiscalBackend`, beside slice 8's two:
    `clockStopState`, `restartAfterClockStop`, `noteClockProvedWrong`, `readAuthorityTime`. Only the
    Veri\*Factu backend has them; `NoneBackend` and `FakeFiscalBackend` do not, and the server treats
    a missing method as "nothing to restart, no AEAT time". Why optional, where slice 8's are
    required: only one regime can ever answer them, and required methods would make every
    hand-written backend in tests list them (slice 8 changed three `packages/core` test sites for
    its two). No name or string in `packages/fiscal` holds a word of its vocabulary guard
    (`no-regime-vocabulary.test.ts:57-71`): the record id is `recordId` there, never `registroId`.
12. **The route** is `POST /api/box/clock-restart`, body `{ recordId }`, in `box-health-api.ts`
    beside Liberar, `system.manage`, ONE `withTransaction` holding the authorization, the reading,
    the seat's checks, the row and the alert. It answers `{ restart: { personName, restartedAt,
    clockAt, lastRecordAt }, replayed }`. The Box status read (`GET /api/box/health`) gains
    `clockStop: ClockStopView | null`, read in a write-lock turn with no drain like the rest of that
    read (`box-health.ts:68-69`), so it answers on a full disk. On a full disk the press itself is
    refused `storage.disk_full`, as any write is.
13. **The two recorded alerts.** `clock.behind_chain_restarted`: severity `warning`, origin
    `jobOrigin("dashboard")`, `detectedAt` the restart's reading, params `{ person, clockAt,
    lastRecordAt, proof }` with `person` the display name at that moment and `proof` one of
    `"authority"`, `"devices"`, `"authority_and_devices"`, worded by a `{proof:list}` word list.
    `clock.behind_chain_disproved`: severity `error`, origin `jobOrigin("fiscal_filing")` (the
    module's own job), params `{ from, to, restartId }`. The Veri\*Factu module claims the prefix
    `clock.behind_chain` for area `box` under `system.manage`; the longest claim wins over the
    core's `clock.` (`apps/server/src/alerts.ts:37-46`). Both are written by a new
    `clock-stop-incidents.ts`, which throws nothing: the alert guard reads every dotted literal in a
    listed file as a recorded code (`scripts/alert-codes.test.ts:89-95`), the reason slice 8 kept
    `"clock.behind_chain"` out of `chain.ts`. A second restart while the first's alert is open is
    folded into that alert (P10); the table keeps every restart.
14. **Disproof, kept by the clock watch** (`apps/server/src/clock-watch.ts`, every minute, primary
    only, unref'd timer, first tick a minute after start, each next armed after the last finished —
    the shape of `box-alert-email.ts:84-235`):
    - a **jump**: between two ticks the wall clock moved more than 60 000 ms further than the
      steady clock; the moment the box last trusted is the earlier tick's wall time plus the steady
      time since;
    - **AEAT disagrees**: an AEAT witness that disagrees (decision 5), taken since the last tick.
    Either calls `noteClockProvedWrong(tx, { trustedUntil, reason })`, which records one
    `clock.behind_chain_disproved` for each restart **in force** at `trustedUntil` —
    `restarted_at ≤ trustedUntil < record_at` — that has none yet (a read of `incidents` for that
    code and `params.restartId`, acknowledged or not). `from` is the restart's `clock_at`, `to` is
    `trustedUntil`. A backward step is not disproof: it stops payments again by decision 8. Nothing
    else changes (design §6, decision 13). The jump is seen only while the server runs, as the
    design says.
15. **`clock.unusable` in the bell.** The module's clock source (`clockBehindSource`, the name kept)
    answers `clock.unusable` instead of `clock.behind_chain` while the reading is before
    28-10-2024: error, area `box`, `system.manage`, `since: null`, `screen: "box-status"`, params
    `{ clockAt }`. It is an ongoing source, so the core's `clock.` claim for recorded incidents does
    not decide its area — that settles slice 3's open question (`docs/backlog.md:4830-4833`). The
    reading is judged at offset 0, as the source already reads (`clock-behind-alerts.ts:4-6`): the
    alert context has no offset (`packages/module/src/alerts.ts:29-32`), so in the first hour or two
    of 28-10-2024 local time the bell can say "before" where the till does not. Under a 2001 clock
    the bell therefore shows one red alert, not two.
16. **The clock-stop email** goes through slice 10's duty, as its decision 9 prepared: the episode
    keeps the params of the notice that started it, `boxEmailMessage` takes them and fills
    `{clockAt}` and `{lastRecordAt}`, each written `dd/mm/yyyy hh:mm` in its own offset (the till's
    form, design §4.8 a; the notice carries both offsets, slice 8 departure 3). One email per stop:
    the episode ends when the notice goes — the clock is fixed, real time passes the record, or a
    restart lifts it. Words: design §4.8 c with departure 4.
17. **The Clock row says which way.** Past a minute, the comparison line reads "…the box was {seconds}
    s ahead" or "…behind" (`box_status.clock.compared_ahead` / `_behind`; `driftSeconds` is box
    less AEAT, `time-health.ts:96`); within a minute it keeps today's "{seconds} s apart". The
    second half of that backlog entry (the bell's seconds can differ from the row's) stays open.
18. **The dialog** is a `wt-dialog` opened from the Clock row's **Reanudar los cobros** (EN **Restart
    payments**), shown only while the page's `clockStop.offer` is `"offered"`. It holds no staged
    input, so it takes no draft scope. Its confirm button is drawn primary, disabled and loading
    while its request is sent; a refusal shows its sentence on its own line above the buttons, in
    the dialog, and leaves the button enabled (design-system → Forms: "A refusal from a request
    never disables the action by itself"); a success closes it and refreshes the page. Without an
    offer the row shows why in words (no proof, contrary proof, more than 24 hours, already
    restarted and stepped back), never a disabled button.
19. **The backup verifier learns the table's two links**
    (`["clock_stop_restarts", "node_id", "nodes", "id"]`,
    `["clock_stop_restarts", "registro_id", "registros_facturacion", "id"]`), with this slice's
    first writer, as slice 8 decision 18 said.
20. **Parked**, as the build plan's row 9 says.

## Behaviour this slice changes

1. While the stop is open and a manager restarts with proof, every action slice 8 stops works again;
   the next records carry the box's clock, earlier than the named record's (P6b, P7).
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
  paths; never `git add -A`. Do not push.
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
- **Error codes:** new `clock.restart_refused` in the Veri\*Factu registry
  (`packages/fiscal-verifactu/src/errors.ts`, beside `clock.unusable` at `:360`), thrown from
  `clock-stop-restart.ts`, never from a file listed in `scripts/alert-codes.test.ts`. Every file
  that throws it imports the registry. New alert codes `clock.disagrees` (server source),
  `clock.behind_chain_restarted`, `clock.behind_chain_disproved` (recorded) — each with EN and ES
  words in `apps/dashboard/src/i18n/alert-messages.ts`.
- **Words:** general code is English only (CLAUDE.md §3). Spanish appears only in
  `apps/dashboard/src/i18n/*`, `apps/till/src/i18n/*`, `apps/server/src/i18n/box-emails.ts` and
  `apps/server/src/guide/es/`. Each task greps its own diff:
  `git diff main -U0 -- apps packages ':!*/i18n/*' ':!apps/server/src/guide/es/*' | /usr/bin/grep -nE '^\+.*(cobr|venta|hora del|encargado|equipo|reanud|prueba)'`
  prints nothing.
- **Tests:** database tests use `useVenueDb` (CLAUDE.md §4). A refused write asserts the domain code
  and its params, never `toBeInstanceOf(Error)`. Every "nothing written" is a row count before and
  after. Every refusing case has a control that goes through. Server files that record sales follow
  slice 8 decision 13 (`docs/developers/testing-guide.md`, the rule for records dated after a later
  write's clock): setup records one sale at the real clock; each case reads NOW from the database;
  every write uses a clock built from NOW; a case that must write on another clock gets a database
  of its own. Witness and watch tests take injected `wall` and `monotonic` functions, never fake
  timers over the database.
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
  authority, as `hour-clock-internet.test.ts:340-395` does.

## Review focus

1. **A restart without proof, against contrary proof, or past 24 hours.** Expected: refused with its
   reason, nothing written (Task 6 cases 2–6; Task 9 cases 2–4). Proof by deletion for each check.
2. **A witness that should not count.** Older than five minutes; taken before a step of the box's
   clock; taken before the stop (its `boxAt` not behind); one device twice (Tasks 1, 2, 6).
3. **The lift is exact.** A covering restart sells; 60 001 ms further back than accepted stops
   again; a new latest record (real time passed) needs no restart; the strip, the bell, the named
   check and the chain check agree (Task 5; Task 9 case 6).
4. **The bell is not the record.** Marking `clock.behind_chain_restarted` handled leaves payments
   running (Task 9 case 5); the stop reads only the table.
5. **A second restart of the same record** is answered with the first, writes no row and no alert;
   after a further step back it is refused `stepped_back` (Task 6 case 7–8; Task 9 case 7).
6. **One transaction per press**, and a racing second press answered as a replay (Task 6 case 9).
7. **Disproof.** A forward jump while a restart is in force, and an AEAT reading that disagrees,
   record one `clock.behind_chain_disproved` each per restart and nothing else; a restart no longer
   in force is untouched (Tasks 7, 10).
8. **The fiscal core.** The golden test and `inmutabilidad` unedited and green; `chain.ts` and the
   hour-code files untouched.
9. **Devices cannot be the source of a time.** No device or AEAT time is ever stamped on a record;
   they only decide whether the restart is offered (grep in Task 9 Step 5).
10. **A device that lies.** Two devices can fake proof; the restart still needs a `system.manage`
    holder's press and a gap of at most 24 hours. Recorded as a known limit (Task 19).

## Review path

**FULL** (build plan row 9: fiscal invariants, auth): per-task reviews, the full `/finish-branch`
wave, and two Codex run-it reviews side by side. The fresh-context plan-against-spec read runs
before implementers start. The slice is **parked** for the owner.

**The pull request description says**, in its first lines: it is parked (a manager's restart lets
a record carry a time earlier than the record before it; the box asks AEAT's QR validation host for
its time during a stop); no migration; `chain.ts`, the golden test and `inmutabilidad` unchanged;
AEAT's time comes from the QR host's `Date` header, not from `consultar`, which was not measured
(departure 1, P11).

**Codex seat 1 (with this plan's checklist).** Experiments decided up front:
- Boot a server (`serverFixture` of `apps/server/src/boot.disk-full-wiring.test.ts`) on a venue with
  a sale recorded, its clock 14 hours behind it: `GET /api/box/health` as a manager →
  `clockStop.offer: "no_proof"`; two `GET /api/device/equipment` from two devices with
  `x-waitron-device-clock` equal to the box's time → `"offered"`; `POST /api/box/clock-restart` →
  200, one row in `clock_stop_restarts`; `POST /api/pay` cash → 200; the same press again → 200
  `replayed: true`, still one row; mark the bell's restart alert handled → pay again → 200.
- The same with the two devices 2 hours ahead of the box → `"contrary_proof"`, and the bell shows
  `clock.disagrees`; with the record 25 hours ahead → `"too_far"`.
- Delete, one at a time, the covering check in `clockBehindChain`, the 24-hour check, the
  during-the-stop check and the freshness filter; name the test that fails for each.

**Codex seat 2 (told to set the checklist aside).** Find a way to restart without proof or to write a
record further back than a restart accepted: replay a device header from an old request; send one
device's header from two browsers; step the box's clock back by 30 s, 61 s and 2 min after a restart;
restart, then let real time pass the record and step back again; race two presses; restart under a
clock before 28-10-2024.

---

### Task 1: Judging witnesses (packages/fiscal)

**Files:**
- Create: `packages/fiscal/src/clock-witnesses.ts`, `packages/fiscal/src/clock-witnesses.test.ts`
- Modify: `packages/fiscal/src/index.ts` (exports)

**Interfaces:**
```ts
export const CLOCK_WITNESS_MARGIN_MS = 60_000;
export interface ClockWitness {
  readonly kind: "authority" | "device";
  /** The device's id; "authority" for AEAT readings. */
  readonly id: string;
  /** The box's wall clock when it was taken, ISO 8601. */
  readonly boxAt: string;
  /** The witness's clock at that moment, ISO 8601. */
  readonly witnessAt: string;
  readonly uncertaintyMs: number;
}
export interface ClockWitnessVerdict {
  /** Witnesses that agree with the box (decision 5), the latest per id. */
  readonly agreeing: readonly ClockWitness[];
  /** An authority witness that disagrees, the latest. */
  readonly authorityDisagrees: ClockWitness | null;
  /** The largest group of two or more devices that agree with each other and all disagree with the box. */
  readonly devicesDisagreeing: readonly ClockWitness[];
}
export function judgeClockWitnesses(witnesses: readonly ClockWitness[]): ClockWitnessVerdict;
```

- [ ] **Step 1: Write the failing tests** (`clock-witnesses.test.ts`, plain Node):
  1. a device 60 000 ms off agrees; 60 001 ms off disagrees; an authority 59 000 ms off with
     uncertainty 1 000 agrees, with 1 001 says nothing; 61 001 off with uncertainty 1 000 disagrees;
  2. two devices +2 h and +2 h 0 min 59 s → `devicesDisagreeing` both; +2 h and +2 h 1 min 1 s → none
     (they do not agree with each other); one device +2 h alone → none ("one device agrees with
     itself", design §4.5);
  3. three devices +2 h, +2 h 30 s, −3 h → the group of two;
  4. the same device id twice → only the later `boxAt` counts;
  5. no witnesses → empty verdict.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal exec vitest run src/clock-witnesses.test.ts` → fails to resolve
  `./clock-witnesses.js`.
- [ ] **Step 3: Implement.** Pure; no clock read.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/fiscal exec vitest run src/no-regime-vocabulary.test.ts`
  → PASS; `pnpm --filter @waitron/fiscal typecheck` exits 0.
- [ ] **Step 5: Proofs by deletion**: `≤` → `<` → case 1 fails; drop the uncertainty widening → case
  1's authority case fails; drop the pairwise check → case 2's second half fails.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal/src/clock-witnesses.ts packages/fiscal/src/clock-witnesses.test.ts packages/fiscal/src/index.ts
  git commit -s -m "The fiscal seat's package can say whether other clocks agree with the box's, within a minute"
  ```

### Task 2: The server keeps fresh witnesses

**Files:**
- Create: `apps/server/src/clock-witnesses.ts`, `apps/server/src/clock-witnesses.test.ts`

**Interfaces:**
```ts
export interface ClockWitnessStore {
  noteDevice(deviceId: string, deviceMs: number): void;
  noteAuthority(sample: { authorityMs: number; uncertaintyMs: number }): void;
  /** Fresh (≤ 5 min by the steady clock) and taken on the box's current clock (decision 4). */
  fresh(): ClockWitness[];
  /** AEAT witnesses noted since the last call, fresh or not, for the clock watch's disproof. */
  takeNewAuthority(): ClockWitness[];
}
export function createClockWitnessStore(deps?: { wall?: () => number; monotonic?: () => number }): ClockWitnessStore;
```
Each sample keeps `boxWallMs` and `monoMs` at the note. `fresh()` keeps a sample when
`mono() − monoMs ≤ 300_000` and `|(wall() − boxWallMs) − (mono() − monoMs)| ≤ 1_000`, and prunes
the rest. `noteDevice` ignores a `deviceMs` that is not a safe integer. One device sample per id.

- [ ] **Step 1: Write the failing tests** with injected `wall` and `monotonic`:
  1. a device noted, read 299 s later → one witness with `boxAt`, `witnessAt`, `uncertaintyMs: 0`;
     301 s later → none;
  2. a device noted, then the wall clock steps forward 2 s against the steady clock → none; 900 ms
     → kept;
  3. the same device noted twice → one witness, the later;
  4. `NaN`, `1.5` and `"x"` coerced — none noted;
  5. `takeNewAuthority` returns each authority sample once.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-witnesses.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck `@waitron/server`.
- [ ] **Step 5: Proof by deletion**: remove the step check → case 2 fails; remove the age check →
  case 1 fails.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/clock-witnesses.ts apps/server/src/clock-witnesses.test.ts
  git commit -s -m "The box keeps the last five minutes of other clocks' readings, dropping any taken before its own clock moved"
  ```

### Task 3: Tills and handhelds report their clock on the equipment read

**Files:**
- Modify: `apps/till/src/api/client.ts` (`getDeviceEquipment`, `:3459-3466`: pass the header; let
  `#request` (`:4748`) take extra headers without changing any other call),
  `apps/server/src/device-api.ts` (the GET at `:397-427` notes the header; `deps.clockWitnesses?:
  Pick<ClockWitnessStore, "noteDevice">` beside `notices` at `:133`), `apps/server/src/cors.ts`
  (`allowHeaders` gains `"x-waitron-device-clock"`), `apps/server/src/boot.ts` (create the store
  once; hand it to `mountDeviceApi` at `:1839`)
- Test: `apps/till/src/api/client.test.ts` (a new case beside `:3446`), `apps/server/src/device-api.test.ts`
  (new cases), `apps/server/src/cors.test.ts` (a new case)

- [ ] **Step 1: Write the failing tests.**
  - Till client: `getDeviceEquipment` sends `x-waitron-device-clock` equal to `String(Date.now())`
    at the call (`vi.spyOn(Date, "now")`), with no `content-type` and no body; the existing case at
    `:3446` passes unedited.
  - Server: a device's equipment read with `x-waitron-device-clock: <ms>` → the store's
    `noteDevice` called once with the device's id and that number; without the header, or with
    `abc`, → not called; an unpaired request (no device) → refused as today and not called.
  - CORS: a preflight from an allowed origin asking for `x-waitron-device-clock` → the answer's
    `access-control-allow-headers` contains it.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts` (Chromium: memory first);
  `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/cors.test.ts`.
- [ ] **Step 3: Implement** decision 3.
- [ ] **Step 4: Run** → PASS; typecheck both packages; `pnpm --filter @waitron/till exec vitest run src/till-app.nfc.test.ts src/widgets/equipment-dialog.nfc.test.ts`
  → PASS unedited (they pin the PUT's URL).
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/till/src/api/client.ts apps/till/src/api/client.test.ts apps/server/src/device-api.ts apps/server/src/device-api.test.ts apps/server/src/cors.ts apps/server/src/cors.test.ts apps/server/src/boot.ts
  git commit -s -m "Tills and handhelds send their own clock with each equipment read, and the box keeps it as a witness"
  ```

### Task 4: `clock.disagrees`, and AEAT's submission comparison as a witness

**Files:**
- Create: `apps/server/src/clock-disagrees-alert.ts`, `apps/server/src/clock-disagrees-alert.test.ts`
- Modify: `apps/server/src/time-health.ts` (`createAuthorityClockStatus.observe` gains an optional
  `onSample` callback: for each comparison it keeps, `{ authorityMs, uncertaintyMs: (received −
  sent) / 2 }` measured at the midpoint), `apps/server/src/boot.ts` (the source in
  `serverAlertSources` at `:2213`; `onSample` → `witnesses.noteAuthority`)
- Test: `apps/server/src/time-health.test.ts` (new cases; existing ones pass unedited)

The alert (decision 7) reads only memory; the words come in Task 12.

- [ ] **Step 1: Write the failing tests.** Source: two fresh devices +2 h → one alert
  `{ key: "clock.disagrees", code: "clock.disagrees", severity: "warning", since: null, screen:
  "box-status", params: { count: 2, deviceAt, boxAt } }`, area `box`, permission `system.manage`;
  one device → none; two devices within a minute of the box → none. Time health: an observed reply
  calls `onSample` once with its authority instant and half the interval; a reply with no timestamp
  calls nothing.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-disagrees-alert.test.ts src/time-health.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck `@waitron/server`. `scripts/alert-codes.test.ts` checks
  words only for RECORDED codes and `alert.source_unavailable` (`:126-131`), so it passes without
  words for this ongoing source; Task 12 adds them, and `apps/dashboard/src/i18n/alerts.test.ts`
  pins them there.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/clock-disagrees-alert.ts apps/server/src/clock-disagrees-alert.test.ts apps/server/src/time-health.ts apps/server/src/time-health.test.ts apps/server/src/boot.ts
  git commit -s -m "Managers are warned when two devices agree the box's clock is more than a minute off, and AEAT's replies count as a witness"
  ```

### Task 5: The lift — a covering restart ends the stop

**Files:**
- Modify: `packages/fiscal-verifactu/src/clock-behind.ts` (decision 8; the shape is
  `~/waitron-campaign-b/a798-9-plan-probe/scripts/prototype-clock-behind.diff`)
- Create: `packages/fiscal-verifactu/src/clock-behind.restart.test.ts`

The test inserts restart rows directly (the writer is Task 6), as `clock-stop-restarts.test.ts:20-37`
does, and records through `VerifactuBackend` and `recordSale` as `chain.clock-behind.test.ts:31-55`
does.

- [ ] **Step 1: Write the failing tests** (P6–P8's cases, as assertions):
  1. a record at `T`; a sale at `R = T − 14.5 h` → `clock.behind_chain`; a restart naming it
     (`clock_at R`, `record_at T`); a sale at `R + 1 min` → recorded, `secuencia` 2, its
     `anterior_huella` the first's `huella`;
  2. after it, `R − 59 s` → recorded; `R − 60 001 ms` → `clock.behind_chain` with its four params
     (the failing case for the margin);
  3. `clockBehindChain` answers `null` at `R` and the four params at `R − 2 min`; the staff notice
     source and `clockBehindSource` answer nothing at `R` and the stop at `R − 2 min`;
  4. a restart naming a record that is no longer the latest (a later record written by real time
     passing, `T + 1 min`) does not lift a new stop against that later record;
  5. a restart and a reading before 28-10-2024 → `refuseWhileClockBehind` still throws
     `clock.unusable`;
  6. an invoice dated a day earlier than the record it links to (P7) → recorded, and
     `verifyBackupFiscalChains` over a backup copy answers `true`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-behind.restart.test.ts` →
  cases 1–3 and 6 fail `clock.behind_chain`; 4 and 5 pass.
- [ ] **Step 3: Implement** the lookup by the latest record's id (one unique-index read, only when
  the raw comparison is behind).
- [ ] **Step 4: Run** the new file and P9's list → PASS; the fiscal-core check of Global constraints
  prints nothing.
- [ ] **Step 5: Proofs by deletion**: drop the margin from the covering test → case 2's `R − 59 s`
  fails; compare against the restart's record without checking it is the latest → case 4 fails.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-behind.ts packages/fiscal-verifactu/src/clock-behind.restart.test.ts
  git commit -s -m "A manager's restart lifts the payment stop while its record is the latest and the clock is no further behind it"
  ```

### Task 6: The restart rule and its writer

**Files:**
- Create: `packages/fiscal-verifactu/src/clock-stop-restart.ts`, `packages/fiscal-verifactu/src/clock-stop-restart.test.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts` (`clock.restart_refused`)

**Interfaces** (types re-exported from `@waitron/fiscal` in Task 8; declare them there now if the
implementer prefers — the shapes do not change):
```ts
export type ClockRestartOffer =
  | "offered" | "no_proof" | "contrary_proof" | "too_far" | "stepped_back" | "restarted";
export interface ClockStopState {
  clockAt: string; offsetMinutes: number; lastRecordAt: string; lastRecordOffsetMinutes: number;
  recordId: string; gapMs: number;
  /** The restart that names the latest record, if any. */
  restart: { personId: string; restartedAt: string; clockAt: string } | null;
  offer: ClockRestartOffer;
  /** The agreeing witnesses during this stop, and the contrary ones, as decision 5 judged them. */
  proof: { authority: ClockWitness | null; devices: ClockWitness[] };
  contrary: { authority: ClockWitness | null; devices: ClockWitness[] };
}
export async function clockStopState(tx, reading, witnesses: readonly ClockWitness[]): Promise<ClockStopState | null>;
export async function restartAfterClockStop(tx, input: {
  reading; witnesses: readonly ClockWitness[]; personId: string; nodeId: string; recordId: string;
}): Promise<{ restart: { id: string; personId: string; restartedAt: string; clockAt: string; lastRecordAt: string; proofKind: "authority" | "devices" | "authority_and_devices" }; replayed: boolean }>;
```
`clockStopState` answers `null` when the raw comparison is not behind and when the reading is
before 28-10-2024; `offer` is `"restarted"` when a restart covers the reading. Only witnesses
taken during this stop count (decision 6). `restartAfterClockStop` runs decision 9's checks in order
and writes decision 10's row with a targeted conflict on `registro_id`; on a conflict it reads the
row and answers it as a replay. It records the alert through Task 7's file (until then, a call
that Task 7's test pins — implement Task 7's writer first if simpler, in this task's commit).

- [ ] **Step 1: Write the failing tests** (`useVenueDb`, a record at `T`, witness fixtures built
  with `boxAt` behind `T`):
  1. two devices agreeing, gap 14.5 h → `offer: "offered"`; restart → one row with decision 10's
     columns, `replayed: false`; then a sale at the reading → recorded;
  2. **no proof** (no witnesses; one device; an AEAT witness that says nothing) → `"no_proof"`;
     restart refused `clock.restart_refused { reason: "no_proof" }`, row count unchanged;
  3. **contrary proof**: proof from two devices plus an AEAT witness that disagrees →
     `"contrary_proof"`; two agreeing devices plus two devices agreeing with each other at +2 h →
     `"contrary_proof"`; each refused, nothing written;
  4. **a 25-hour gap** with proof → `"too_far"`, refused; exactly 24 h → offered (control);
  5. witnesses taken before the stop (their `boxAt` within a minute of `T`) → `"no_proof"`;
  6. `recordId` of an older record → `"record_changed"`; a reading not behind → `"not_stopped"`;
     a 2001 reading → `clock.unusable`;
  7. **a second restart of the same record** → answers the first (`replayed: true`, same id,
     `personId` of the first even when a second manager presses), row count still 1;
  8. after the first, the reading 2 min further back → `"stepped_back"` with the first's
     `{ personId, restartedAt }`, and `clockStopState.offer` the same;
  9. a racing insert (a row for the record written in between the read and the insert, by a second
     transaction in the test) → answered as a replay, no throw.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-stop-restart.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`
  → PASS; typecheck the package; the fiscal-core check prints nothing.
- [ ] **Step 5: Proofs by deletion**, one at a time: the 24-hour check → case 4 fails; the contrary
  check → case 3 fails; the during-the-stop filter → case 5 fails; the replay branch → case 7
  fails; the conflict target → case 9 fails.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-stop-restart.ts packages/fiscal-verifactu/src/clock-stop-restart.test.ts packages/fiscal-verifactu/src/errors.ts
  git commit -s -m "Veri*Factu offers a restart of payments only with fresh proof and at most 24 hours behind, and keeps each one"
  ```

### Task 7: The two recorded alerts and their area

**Files:**
- Create: `packages/fiscal-verifactu/src/clock-stop-incidents.ts`, `packages/fiscal-verifactu/src/clock-stop-incidents.test.ts`
- Modify: `packages/fiscal-verifactu/src/alerts.ts` (the claim, decision 13),
  `packages/fiscal-verifactu/src/clock-stop-restart.ts` (calls the restarted writer; gains
  `noteClockProvedWrong(tx, { trustedUntil: Date; reason: "jump" | "authority" }): Promise<number>`)
- Modify (declared changes 1 and 2, own commit): `packages/fiscal-verifactu/src/alerts.test.ts`,
  `scripts/alert-codes.test.ts`

- [ ] **Step 1: Write the failing tests.** A restart records one `clock.behind_chain_restarted`
  (warning, `dashboard` origin, params decision 13) in the restart's transaction; a refused restart
  records none; a replay records none. `noteClockProvedWrong` with `trustedUntil` inside a restart's
  `[restarted_at, record_at)` records one `clock.behind_chain_disproved` (`from` = `clock_at`, `to`
  = `trustedUntil`, `restartId`), and a second call records none (also after the first is
  acknowledged); `trustedUntil` after `record_at` or before `restarted_at` → none; nothing in
  `registros_facturacion` or `clock_stop_restarts` changes (counts).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-stop-incidents.test.ts`.
- [ ] **Step 3: Implement**; the claim in `FISCAL_ALERTS.events`.
- [ ] **Step 4: Declared changes** 1 and 2 in their own commit; then
  `pnpm exec vitest run scripts/alert-codes.test.ts` → PASS only once Task 12's words exist: bring
  the two codes' EN and ES sentences (Task 12's text) into this task's commit, in
  `apps/dashboard/src/i18n/alert-messages.ts` with the `proof` word list, so the guard stays green.
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/alerts.test.ts` → PASS;
  `pnpm --filter @waitron/composition exec vitest run` → PASS.
- [ ] **Step 5: Commit, in two.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-stop-incidents.ts packages/fiscal-verifactu/src/clock-stop-incidents.test.ts packages/fiscal-verifactu/src/alerts.ts packages/fiscal-verifactu/src/clock-stop-restart.ts apps/dashboard/src/i18n/alert-messages.ts
  git commit -s -m "A restart of payments, and a restarted clock that later proved wrong, each reach the managers' bell"
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

`readAuthorityTime` is declared here and implemented in Task 10.

- [ ] **Step 1: Write the failing tests**: the Veri\*Factu backend answers `clockStopState` and
  `restartAfterClockStop` as Task 6 does (one stopped case, one offered restart);
  `NoneBackend.clockStopState` and `FakeFiscalBackend.clockStopState` are `undefined`.
- [ ] **Step 2: Run and watch them fail** (`clockStopState is not a function`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `pnpm --filter @waitron/fiscal --filter @waitron/fiscal-verifactu --filter @waitron/fiscal-none --filter @waitron/core --filter @waitron/server typecheck`
  exits 0; `pnpm --filter @waitron/fiscal exec vitest run src/no-regime-vocabulary.test.ts` → PASS;
  `pnpm exec vitest run scripts/module-seams.test.ts scripts/workspace-cycles.test.ts` → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal/src/backend.ts packages/fiscal/src/index.ts packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/clock-stop-restart.ts packages/fiscal-verifactu/src/backend.clock-stop.test.ts
  git commit -s -m "The fiscal seat can say whether payments may be restarted for the clock, and restart them"
  ```
  (Add the fake's and none's test files once they hold their cases.)

### Task 9: The restart route and the Box status read

**Files:**
- Modify: `apps/server/src/box-health-api.ts` (the route, decision 12; `STATUS` gains
  `"clock.restart_refused": 409`, `"clock.unusable": 409`), `apps/server/src/box-health.ts`
  (`BoxHealth.clockStop`; `BoxHealthReaders` gains `clockStop?: (db) => Promise<ClockStopView | null>`;
  resolves `restart.personId` to a display name), `apps/server/src/boot.ts` (wiring at
  `:2304-2330`)
- Create: `apps/server/src/clock-restart.route.test.ts`, a new file whose database holds its own
  records (slice 8 decision 13's rules)

`ClockStopView` is `ClockStopState` with device ids replaced by device labels (the `devices` table)
and `restart.personName` instead of `personId`; no witness ever names a person.

- [ ] **Step 1: Write the failing tests** (the server's sale helpers on a clock built from NOW;
  witnesses noted straight into the store the app was built with):
  1. **no proof, no restart**: `GET /api/box/health` → `clockStop.offer: "no_proof"`; the press →
     409 `clock.restart_refused { reason: "no_proof" }`; `POST /api/sales` still 409
     `clock.behind_chain`;
  2. **contrary proof**: two devices +2 h → `"contrary_proof"`, the press refused, nothing written;
  3. **a 25-hour gap** with two agreeing devices → `"too_far"`, refused;
  4. without `system.manage` (a supervisor) → 403, nothing written; without a session → 401;
  5. **marking the bell's alert handled leaves payments running**: offered → press → 200; a cash
     `POST /api/sales` → 201/200 as the route answers; `POST /management-api/alerts/incidents/:id/handled`
     (the bell's own route, `apps/server/src/alerts-api.ts:89`) on `clock.behind_chain_restarted` → 200; the same sale again
     → succeeds; `GET /management-api/alerts` no longer lists `clock.behind_chain`;
  6. after the press, `GET /api/device/equipment` has no `clock.behind_chain` notice;
     `GET /management-api/alerts` has no `clock.behind_chain` and does not list `fiscal.clock_drift`
     suppression any more (the drift alert shows again when its status is `warning`);
  7. **a second restart of the same record** → 200 `replayed: true`, `restart.personName` the first
     manager's, one row;
  8. the box health read answers on a full disk with a change waiting (the shape of
     `box-health.test.ts`'s full-disk case), `clockStop` included.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-restart.route.test.ts src/box-health.test.ts src/box-health-api.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck; `pnpm exec vitest run scripts/module-seams.test.ts scripts/write-path-tables.test.ts`
  → PASS.
- [ ] **Step 5: Check** that no device or AEAT time is stamped anywhere:
  `git diff main -- apps packages | /usr/bin/grep -nE '^\+.*(witnessAt|deviceMs|authorityMs).*(instant|issuedAt|generadoEn)'`
  prints nothing.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-health-api.ts apps/server/src/box-health.ts apps/server/src/boot.ts apps/server/src/clock-restart.route.test.ts
  git commit -s -m "Managers can restart payments from the Box status page when the box has fresh proof its clock is right"
  ```

### Task 10: The clock watch — AEAT's time during a stop, and disproof

**Files:**
- Create: `packages/fiscal-verifactu/src/authority-time.ts`, `packages/fiscal-verifactu/src/authority-time.test.ts`
  (decision 1 (b); it imports `authenticatedHourHead` from `./hour-clock-internet.js` and changes
  nothing there); `apps/server/src/clock-watch.ts`, `apps/server/src/clock-watch.test.ts`
- Modify: `packages/fiscal-verifactu/src/backend.ts` (`readAuthorityTime` → `readAuthorityTime(this.deploymentEnvironment)`),
  `apps/server/src/boot.ts` (start the watch in trading mode; push its `stop` onto `undoOnFailure`
  as soon as it exists — CLAUDE.md §3, `boot.failed-start.test.ts`)

- [ ] **Step 1: Write the failing tests.**
  - `authority-time.test.ts`, against a local HTTPS server with a test authority (the shape of
    `hour-clock-internet.test.ts:340-395`; the URL injected): a `Date` header → a sample
    `{ authorityMs: date + 500, uncertaintyMs: 500 + roundTrip/2 }`; no `Date`, a 302 to another
    origin, `Age: 3`, a TLS name mismatch, and a server that never answers (5 s deadline, fake
    timers on the request only) → `null`. It asks `QR_ENDPOINTS[environment]` when no URL is
    injected (asserted on the URL handed to the injected request, never by contacting AEAT).
  - `clock-watch.test.ts`, with injected wall, steady clock, timer, `stopState`, `readAuthorityTime`
    and `noteClockProvedWrong`: during a stop and filing, one HEAD per tick and the sample noted;
    not stopped, or not filing, or not primary → no HEAD; a forward jump of 61 s between ticks →
    `noteClockProvedWrong` once with `trustedUntil` the earlier tick plus the steady time; 59 s →
    not called; a backward jump → not called; a disagreeing AEAT witness noted since the last tick
    → called with `reason: "authority"`; a failing call logs `clock_watch.check_failed` and the next
    tick still runs; `stop` cancels the timer.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/authority-time.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/clock-watch.test.ts`.
- [ ] **Step 3: Implement** decisions 1, 2 and 14.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/server exec vitest run src/boot.failed-start.test.ts`
  → PASS; the fiscal-core check (with `hour-*`) prints nothing.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/authority-time.ts packages/fiscal-verifactu/src/authority-time.test.ts packages/fiscal-verifactu/src/backend.ts apps/server/src/clock-watch.ts apps/server/src/clock-watch.test.ts apps/server/src/boot.ts
  git commit -s -m "During a payment stop the box asks AEAT's web server for its time, and tells managers if a restarted clock proves wrong"
  ```

### Task 11: `clock.unusable` in the bell

**Files:**
- Modify: `packages/fiscal-verifactu/src/clock-behind-alerts.ts` (decision 15)
- Test: `packages/fiscal-verifactu/src/clock-behind-alerts.test.ts` (new cases; existing ones pass
  unedited)

- [ ] **Step 1: Write the failing tests**: a `2001-01-01T11:00:00.000Z` reading with a record →
  exactly one alert `{ key: "clock.unusable", code: "clock.unusable", severity: "error", since:
  null, screen: "box-status", params: { clockAt } }`; the same with no records → the same one;
  `2024-10-28T00:00:00.000Z` with no records → none.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-behind-alerts.test.ts`.
- [ ] **Step 3: Implement**; add the EN/ES sentence for `clock.unusable` to
  `apps/dashboard/src/i18n/alert-messages.ts` (Task 12's words) in this commit.
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/alert-codes.test.ts` → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-behind-alerts.ts packages/fiscal-verifactu/src/clock-behind-alerts.test.ts apps/dashboard/src/i18n/alert-messages.ts
  git commit -s -m "Managers see a box clock set before 28 October 2024 in the bell"
  ```

### Task 12: The words — alerts, refusals and the email

**Files:**
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (whatever Tasks 7 and 11 did not yet add),
  `apps/dashboard/src/i18n/codes.ts` (`clock.restart_refused` by reason),
  `apps/server/src/i18n/box-emails.ts` (`clock.behind_chain`), `apps/server/src/box-alert-email.ts`
  (decision 16)
- Test: `apps/dashboard/src/i18n/alerts.test.ts`, `apps/server/src/box-alert-email.test.ts`,
  `apps/server/src/box-alert-email.duty.test.ts` (new cases)

**Words.**
- `clock.disagrees`: EN "{count} devices agree that the time is {deviceAt:minute}, but the box's
  clock reads {boxAt:minute}. Check the box's date and time on the Box status page." / ES "{count}
  dispositivos coinciden en que son las {deviceAt:minute}, pero el equipo marca {boxAt:minute}.
  Comprueba la fecha y la hora del equipo en Estado del equipo."
- `clock.unusable`: EN "The box's clock reads {clockAt:minute}, before 28 October 2024, so no sale
  can be recorded for the tax agency. Connect the box to the internet; if its clock does not correct
  itself, ask whoever installed it to set it." / ES "El equipo marca {clockAt:minute}, antes del 28
  de octubre de 2024, así que no se puede registrar ninguna venta en Hacienda. Conecta el equipo a
  internet; si la hora no se corrige sola, pide a quien lo instaló que la ponga."
- `clock.behind_chain_restarted` (design §4.8 c): EN "{person} restarted payments on the box's clock
  ({clockAt:minute}), earlier than the last sale ({lastRecordAt:minute}). Proof: {proof:list}." / ES
  "{person} reanudó los cobros con la hora del equipo ({clockAt:minute}), anterior a la última venta
  ({lastRecordAt:minute}). Prueba: {proof:list}." Word list `proof`: `authority` "the tax agency's
  time" / "la hora de Hacienda"; `devices` "the clocks of two devices or more" / "la hora de dos
  dispositivos o más"; `authority_and_devices` "the tax agency's time and two devices or more" /
  "la hora de Hacienda y de dos dispositivos o más"; otherwise "recorded on the box" / "anotada en
  el equipo".
- `clock.behind_chain_disproved` (design §4.8 b): EN "Sales recorded between {from:minute} and
  {to:minute} were dated by a clock that proved wrong. They stay as recorded; ask your tax
  adviser." / ES "Las ventas registradas entre {from:minute} y {to:minute} se fecharon con un reloj
  que resultó estar mal. Quedan como se registraron; consúltalo con tu asesor."
- `clock.restart_refused` (dashboard `codes.ts`), by `reason`: `no_proof` "There is no fresh proof
  that the box's clock is right." / "No hay ninguna prueba reciente de que la hora del equipo sea
  correcta."; `contrary_proof` "Other clocks say the box's clock is wrong." / "Otros relojes dicen
  que la hora del equipo está mal."; `too_far` "The box's clock is more than 24 hours behind the
  last sale." / "La hora del equipo está más de 24 horas por detrás de la última venta.";
  `stepped_back` "Payments were already restarted, and the box's clock has gone back further since.
  Get the clock checked." / "Ya se reanudaron los cobros y la hora del equipo ha retrocedido más
  desde entonces. Haz que revisen la hora."; `record_changed` "The last sale changed. Look at the
  page again." / "La última venta ha cambiado. Vuelve a mirar la página."; `not_stopped` "Payments
  are not stopped." / "Los cobros no están parados."
- Email `clock.behind_chain` (design §4.8 c, departure 4): subject EN "Payments stopped at {venue}:
  the box's clock reads earlier than its last sale" / ES "No se puede cobrar en {venue}: la hora del
  equipo es anterior a la última venta"; text EN "The box's clock ({clockAt}) reads earlier than its
  last recorded sale ({lastRecordAt}). Since then no device can take payment. Orders can still be
  taken and sent to the kitchen. What to do: • If the box's clock is wrong (usual after a power
  cut): connect the box to the internet so it corrects itself, or call whoever installed it. • If
  you think the box's clock is right: look at the Box status page (in the dashboard, Settings → Box
  status), which says whether payments can be restarted." / ES the design's body, with "[Abrir
  Estado del equipo]" replaced by "(en el panel de gestión, Ajustes → Estado del equipo)".

- [ ] **Step 1: Write the failing tests**: each sentence in both languages from a fixture whose
  params differ (two different minutes); the word list's three values and an unknown one; the email
  with `{clockAt: "2025-03-14T08:12:00.000Z", offsetMinutes: 60, lastRecordAt:
  "2026-10-18T21:40:00.000Z", lastRecordOffsetMinutes: 120}` → "14/03/2025 09:12" and "18/10/2026
  23:40" in both languages; the duty sends one email per stop per manager with those times, keeps
  the first notice's params when a later read's `clockAt` differs, and sends again after the notice
  went and came back. Every existing duty case passes unedited.
- [ ] **Step 2: Run and watch them fail** (Chromium for the dashboard: memory first).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`
  → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/codes.ts apps/dashboard/src/i18n/alerts.test.ts apps/server/src/i18n/box-emails.ts apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.test.ts apps/server/src/box-alert-email.duty.test.ts
  git commit -s -m "Words for the new clock alerts and refusals, and the managers' email when payments stop for the clock"
  ```

### Task 13: The Clock row — the offer, the reasons, and which way the clock is off

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`BoxHealth.clockStop` beside `:1715`;
  `restartClockPayments(recordId)` beside `freeBoxSpace` at `:4183`),
  `apps/dashboard/src/screens/box-status-rows.ts` (the Clock row: decision 17's line; while
  `clockStop` is not null, a detail line with the proof — "Tax agency: matches (checked {time})",
  "Devices: {count} read {time}" — and a line for any offer other than `"offered"`: the reason's
  words, or "Payments restarted by {person} at {time}" for `"restarted"`), `apps/dashboard/src/i18n/strings.ts`
  (EN and ES)
- Modify (declared change 3, own commit): `apps/dashboard/src/screens/box-status-rows.test.ts:534`
- Test: `apps/dashboard/src/screens/box-status-rows.test.ts` (new cases)

- [ ] **Step 1: Write the failing tests**: a drift of +90 s → `compared_ahead`, −90 s →
  `compared_behind`, 2 s → `compared` (the existing cases); `clockStop` with each offer → the row's
  detail lines; `"restarted"` → the row is amber, not red (the stop's notice is gone), with who and
  when; the restart offer never on a row whose `clock.unusable` notice is on.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts`.
- [ ] **Step 3: Implement.** The `:534` case now fails (it expects `compared`); leave it red.
- [ ] **Step 4: Run** → only `:534` fails; typecheck. Commit the implementation and the new cases:
  ```bash
  git add apps/dashboard/src/api/client.ts apps/dashboard/src/screens/box-status-rows.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/box-status-rows.test.ts
  git commit -s -m "The Box status page's Clock row shows the proof the box has, why payments cannot be restarted, and which way the clock is off"
  ```
  This commit leaves `:534` red on purpose; the next one, straight after, is the declared change.
- [ ] **Step 5: Declared change 3**, alone: edit `:534` as declared, run the file → PASS, then
  ```bash
  git add apps/dashboard/src/screens/box-status-rows.test.ts
  git commit -s -m "Changed test checks (A798 slice 9): the Clock row says the box was behind for a drift of -3600 s"
  ```
  with the before and after in the message body.

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
and "Restart payments" / "Reanudar los cobros". A replay answer closes the dialog and the row shows
"Payments restarted by {person} at {time}" — the design's "Ya reanudado por {person} a las {time}".

- [ ] **Step 1: Write the failing tests**: no button unless `"offered"`; the dialog shows both
  times and the proof lines; Confirm sends `restartClockPayments(recordId)` with the page's
  `clockStop.recordId`, is disabled and loading while it waits, closes on success and refreshes
  (`liveData.refresh`, as Liberar does at `:222`); a refusal shows `clock.restart_refused`'s words
  for its reason on its own line above the buttons and leaves Confirm enabled; Cancel and Escape
  close with no request; axe passes for the row with the button and for the open dialog in light
  and dark.
- [ ] **Step 2: Run and watch them fail** (Chromium: memory first).
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts src/screens/box-status-screen.a11y.test.ts`.
- [ ] **Step 3: Implement.** No hand-drawn field; `wt-dialog` and `wt-button` only
  (`scripts/native-form-fields.test.ts`).
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/help-tooltip-mode.test.ts`
  → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/dashboard/src/screens/box-status-screen.ts apps/dashboard/src/screens/box-status-screen.test.ts apps/dashboard/src/screens/box-status-screen.a11y.test.ts apps/dashboard/src/i18n/strings.ts
  git commit -s -m "The Box status page asks a manager to confirm a restart of payments, showing both times and the proof"
  ```

### Task 15: The backup verifier learns the restarts' links

**Files:** `packages/fiscal-verifactu/src/backup-verification-history.ts` (`LINKS`, `:424-433`),
`packages/fiscal-verifactu/src/backup-verification-history.test.ts` (two new rows in the
"rejects internally damaged %s" table, `:283-296`, and a restart row in the fixture's capture)

- [ ] **Step 1: Write the failing cases**: "restart node parent" (`update clock_stop_restarts set
  node_id='missing'`) and "restart record parent" (`… set registro_id='missing'`) → `invalid`.
  The capture inserts one restart so the damage has a row to change.
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
(`{#clock-behind}`, `:97-133`: a third way out; `{#emails}`, `:135-152`: the clock-stop email; a new
`{#clock-witnesses}` section after `{#clock-behind}`); `apps/server/src/guide/en/till-notices.md` and
its twin (`:31-57`: payments can come back early when a manager restarts them).

What they say, in the guides' plain style (`~/.claude/docs-writing-style.md`):
- **Restart payments** as the third way out: only when the clock is right and the last sale's time
  was wrong; the page offers it only with fresh proof (the tax agency's time, or two devices,
  within a minute, in the last five minutes, since payments stopped) and at most 24 hours behind;
  who can (people who manage the system); what it does and never does (no recorded sale changes;
  the next sales carry an earlier time than the last; it is noted who did it); a second press shows
  the first; if the clock goes back further, payments stop again and the page says to get the
  clock checked; if the accepted clock later proves wrong, the bell says which sales are affected
  and to ask the tax adviser. Rewrite "Wait … This is the only way out when the clock is right…"
  (`:118-120`), which this slice makes false.
- `{#clock-witnesses}`: tills and handhelds send their clock to the box; the bell warns when two
  agree the box is off; staff see nothing for that.
- `{#emails}`: the list gains "its clock reads earlier than its last sale, so payments have
  stopped"; that email also waits while the box has no internet.
- The `{#clock-behind}` paragraph on a clock before 28 October 2024: the bell now says so too.

- [ ] **Step 1: Write** all four files; ids shared.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts` → PASS.
- [ ] **Step 3: Commit.**
  ```bash
  git add apps/server/src/guide/en/box-status.md apps/server/src/guide/es/box-status.md apps/server/src/guide/en/till-notices.md apps/server/src/guide/es/till-notices.md
  git commit -s -m "Guides: restarting payments with proof the clock is right, devices as clock witnesses, and the clock-stop email"
  ```

### Task 17: Developer docs, CLAUDE.md and the compliance file

**Files:** `CLAUDE.md` §5 (the clock-stop rule slice 8 added); `docs/developers/conventions-data.md`
(its receipt section for the stop); `docs/compliance/asesor-questions.md` (`:3637-3638`, `:3678`);
`docs/compliance/verifactu-findings.md` (the "built by A798-B slice 8" pointer)

- [ ] **Step 1: CLAUDE.md §5.** Read the rule slice 8 added ("While the box's clock reads more than
  a minute earlier than the latest fiscal record…"); add one sentence, keeping it a rule: "A
  manager's restart (`clock_stop_restarts`) lifts it while its record is the latest and the clock
  is no further behind; `clockBehindChain` is the one place that reads it. Guard:
  `clock-behind.restart.test.ts`, `clock-stop-restart.test.ts`." Run
  `pnpm exec prettier --check CLAUDE.md` and `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 2: conventions-data.md**: the receipt — decision 8 (the lift and its margin), decision
  9's order, decisions 4–6 (witnesses), P6–P9, and that AEAT's time is the QR host's `Date` header
  (P3, P5) while `consultar`'s was not measured (P11).
- [ ] **Step 3: asesor-questions.md**: Q51's "Not built: it is slices 8 and 9" and Q52's "Not built:
  it is slice 9" become dated pointers "Built by A798-B slices 8 (#2012) and 9 (#…), 2026-10-…;
  parked for the owner". No question text changes.
- [ ] **Step 4: verifactu-findings.md**: a dated pointer that slice 9 adds the restart.
- [ ] **Step 5: Commit.**
  ```bash
  git add CLAUDE.md docs/developers/conventions-data.md docs/compliance/asesor-questions.md docs/compliance/verifactu-findings.md
  git commit -s -m "CLAUDE.md and docs: a manager's restart lifts the clock stop, and where its proof comes from"
  ```

### Task 18a: LOOK in English

**Files:** a throwaway `apps/dashboard/src/zz-clock-restart.look.test.ts`, never committed;
screenshots to `~/waitron-campaign-b/a798-9-shots/`. A fix is committed with the file it touches.

- [ ] **Step 1: Write the throwaway look test**, shaped like slice 8's Task 17a (light and dark ×
  1280 and 390, the language a parameter): the Box status page during a stop with (a) no proof,
  (b) contrary proof from three devices (picture 9's top), (c) an offer with AEAT and two devices
  (picture 9's bottom row), (d) the dialog open, (e) the dialog with a `too_far` refusal under it,
  (f) after a restart, the amber row with who and when; the bell open on `clock.disagrees`,
  `clock.behind_chain_restarted` and `clock.behind_chain_disproved`; the bell on `clock.unusable`.
  `page.screenshot` to a gitignored `__screenshots__/a798-9/` path; one contact sheet per theme and
  width with `sharp`; copy to `~/waitron-campaign-b/a798-9-shots/`.
- [ ] **Step 2: Run** `-t en` and LOOK beside picture 9: the proof lines readable and never broken
  mid-time at 390; the button on the row and the dialog's buttons; the refusal on its own line
  above them; the bell's sentences. Write what you saw, sheet by sheet.
- [ ] **Step 3: Fix and re-run**, each fix with a test that would have caught it where one can.

### Task 18b: LOOK in Spanish

- [ ] **Step 1: Run** `-t es` and LOOK as 18a; the longer Spanish sentences fit at 1280 and wrap
  cleanly at 390.
- [ ] **Step 2: Fix and re-run**, then `-t en` once.
- [ ] **Step 3: Remove the throwaways**; `git status --short` shows none.

The till is unchanged on screen (it only sends a header), so no till LOOK.

### Task 19: Backlog

**Files:** `docs/backlog.md` (A798-B, `:4631-4649`, and the entries it names), `docs/backlog/box.md`,
`docs/backlog/fiscal.md` (A679's finding)

- [ ] **Step 1: The A798-B entry**: "slice 9 (devices report their clock; `clock.disagrees` and
  `clock.unusable` in the bell; a manager's restart of payments with fresh proof, at most 24 hours
  behind, kept in `clock_stop_restarts`, with its bell alerts and the disproof check; the clock-stop
  email; parked for the owner) is #<PR>." Slice 7b stays as written.
- [ ] **Step 2: Delete** the entries this slice finishes: "The clock stop's email is slice 9's"
  (`:4651-4656`); "The backup verifier does not know `clock_stop_restarts`' links" (`:4724-4726`);
  "Which alert area `clock.unusable` belongs to" (`:4830-4833`). Replace "The Box status page's
  Clock row drops the drift's sign, and an open clock-drift alert's seconds can differ from the
  latest read" (`:4769-4773`) by its open half: "**An open clock-drift alert's seconds can differ
  from the Clock row's.** The bell reads less often than the page. Left open by A798-B slice 7."
- [ ] **Step 3: Short open entries**, each "Left open by A798-B slice 9 (#…)":
  - "**AEAT's time for a restart comes from its QR validation host, not from a `consultar` reply.**
    Whether a certificate-authenticated `consultar` reply carries a `Date` header is not measured:
    no AEAT certificate is on the planning machine, and the only one, a CI secret of the
    `verifactu` repository, runs a workflow that files. A consulta-only step in that workflow would
    measure it; the production QR host was not tried either." (decision 1)
  - "**Two devices can fake a restart's proof.** A device's clock reading is whatever it sends; the
    restart still needs a manager's press and a gap of at most 24 hours."
  - "**A second restart's bell alert, while the first is not marked handled, is folded into the
    first.** The table keeps both (slice 9 plan P10)."
  - "**The restart's alert is judged at offset 0 for `clock.unusable`**, so in the first hours of 28
    October 2024 local time the bell can say the clock is before that day where the till does not."
  - "**During a stop the box sends AEAT's QR host a HEAD once a minute**, for as long as the stop
    lasts." (decision 2)
- [ ] **Step 4: Outside A798, in `docs/backlog/fiscal.md`**: "**A679's internet time reading is
  always unavailable against pre-production.** `observeInternetHourClock` asks the submission host,
  which without a client certificate redirects to another origin with no `Date` header, and the
  reading follows only same-origin redirects (A798-B slice 9 plan, P1 and P2; production not
  tried). Found while planning A798-B slice 9." Add a one-line pointer to it in `docs/backlog.md`'s
  fiscal area.
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
`pr-<n>-files.txt`):
- **#1990** (`feat/a947-4a-minute-names`, fiscal, owner lands; 191 files): shares
  `apps/server/src/boot.ts` (Tasks 3, 4, 9, 10), `packages/fiscal-verifactu/src/backup-verification-history.ts`
  and its test (Task 15), `CLAUDE.md` (Task 17), `docs/developers/conventions-data.md` (Task 17) and
  `docs/backlog.md` (Task 19). It also changes `packages/fiscal-verifactu/src/hour-clock.ts` and
  `hour-setup-clock.ts`, which this slice does not touch; it does not change
  `hour-clock-internet.ts`, whose `authenticatedHourHead` Task 10 imports. `packages/fiscal-verifactu/src/errors.ts`
  is in both (Task 6 adds `clock.restart_refused`), and `apps/server/src/errors.ts` only in #1990.
- **#2003** (`feat/a758-7-collect-at-counter`, 32 files): shares `apps/till/src/api/client.ts`
  (Task 3) and `docs/backlog.md` (Task 19); also `apps/till/src/i18n/strings.ts` and
  `apps/till/src/till-app.ts`, which this slice does not change.
- **#2010** (`chore/a974-test-helper-identifiers`, 5 files): shares only `docs/backlog.md`.
- **#1986** (`fix/a974-core-comments-english`, 2 files): shares only `docs/backlog.md`.

## Self-review against the spec

- §8 item 9's scope: the device reading (Task 3), AEAT's time (Tasks 4, 10; departure 1), the
  restart route behind `system.manage` with fresh proof and the 24-hour cap writing
  `clock_stop_restarts` (Tasks 6, 9), the two recorded alerts (Task 7), the Reloj row and dialog
  (Tasks 13, 14); plus the clock-stop email moved here (Task 12) and the minimum-date alert (Task
  11).
- §8 item 9's tests: no proof, no restart — Task 6 case 2, Task 9 case 1; contrary proof — Task 6
  case 3, Task 9 case 2; a 25-hour gap — Task 6 case 4, Task 9 case 3; a second restart answered
  with the first — Task 6 case 7, Task 9 case 7; marking the bell's alert handled leaves payments
  running — Task 9 case 5.
- §4.5 item 3: `clock.disagrees` with two devices that spoke in the last five minutes (Tasks 2, 4).
- §4.8 b: proof gathered after the stop began (decision 6), what it does and never changes (Task 5,
  P6–P9), disproof (Tasks 7, 10), the table read directly (decision 8), the dialog (Task 14).
- §4.8 c: the restart and disproved alerts in the stop's area (Task 7), the email (Task 12).
- §4.8 d: what clears it — the restart (Task 5); devices and AEAT never lift it themselves
  (decision 8: only a row does); the 28-10-2024 rule first (decision 9.1, Task 11).
- §7: no new table; witnesses in memory (decision 4).

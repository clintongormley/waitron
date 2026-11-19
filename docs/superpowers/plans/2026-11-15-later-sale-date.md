# LATER-SALE-DATE: an invoice issued on a later day files and prints the sale date — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Fresh Claude read 2026-11-15: Ready after fixes; folded in (the commit after `72a7eba3f2`).

Amended 2026-11-15: owner's Q1 answer folded in (option b). Amended again: the watcher's P3
answer (one new column, `working_order_lines.last_served_at`; lane L `questions.md`,
`## WATCHER 2026-11-15 15:58`).

Status: **cleared by the watcher** (2026-11-15 11:13; P1, P2 and P4 at 14:58; P3 as amended at
15:58). Build after #3342 (A1522 PR 2) lands: both rebuild the core starting migration. Written at
main `9f5b081084`.
**READ** = source read at that commit; **RUN** = a command was run and its output read.

**Goal:** when an invoice is issued on a later venue calendar day than the moment the guest paid,
because the box only learned of the payment later (a restart, the background loop, a manager's
recovery), or than the day a bill left open had its last dish served (Q1), the F1/F2 record files
that earlier day as `FechaOperacion`, is priced at that day's VAT rates, and every printed or
displayed copy shows "Date of the sale: …".

**Architecture:** the paths that issue later hand a close moment (`closedAt`, an instant already
stored) to the issue step; every order issue path also reads the bill's last served dish (Task 6).
`issueMoment` turns it into the venue day, prices at that day when it is earlier than the issue day, and returns it as `operationDate`. Core `recordSale` saves it
in the existing `sales.supply_day` and passes it to the backend, which files it with the conversion
`recordCorrection` already uses. Printing reuses #3301's `saleDay` row; only `readInvoiceTyping`
learns to emit it for an F1/F2.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest with `useVenueDb`, `@waitron/verifactu` 0.2.1.

**Spec:** the owner's rule, 2026-11-15 05:28. The question they answered
(`~/waitron-campaign-shared/desk/done/20261115-0530-L-later-sale-date-rule.md`): «the operation date
is when the table closed (or the takeaway was handed over); when the invoice's own date falls on a
later day, file it as the sale date (FechaOperacion) and print it; paths: card-payment recovery,
bill payments completed later, a bill left open for days, a takeaway collected days later». Their
answer: «Yes, as its own item». Their words at 01:58: «the invoice [uses] the timestamp of the
moment it was issued when it covers directly after a meal, eg the meal starts at 9pm and they pay
and close the table at 1am, so we use the 1am timestamp. But that doesn't apply to the scenario
where an invoice is issued days after the meal finished. In that case the operation date and the
invoice date should be distinct.» The 2026-11-12 rule stays for the ordinary case
(`docs/backlog/fiscal.md:1095-1109`). Input sweep:
`~/waitron-campaign-l/receipts/a1407-step2/days-later-invoice-paths.md` (every line re-read here).

## Global constraints

- Credit notes and every corrective (R1–R5, by differences or by replacement) keep their own rules.
- Never edited: `computeHuella`, the chain (`appendToChain`), `allocateInvoiceNumber`, the
  `registros_facturacion` schema and triggers. `write-path.e2e.test.ts` (golden fingerprint) and
  `inmutabilidad.test.ts` pass **unedited** after every task; if either needs a change, **STOP**,
  leave the PR `needs-owner-review` and write the question in lane L's `questions.md`.
- Pre-live schema rule (CLAUDE.md §3): edit the TypeScript schema and rebuild the core starting
  migration (`pnpm --filter @waitron/db db:generate`); never a new migration. The PR's title starts
  "Reset test venues:".
- Nothing new may refuse a sale: no new error code; a missing, equal or later close day files the
  invoice exactly as today.
- One PR, branch `feat/later-sale-date` from main; one `subagent_type: "implementer"` per task;
  fiscal is a risk trigger, so per-task reviews and `/finish-branch`'s full wave with two Codex
  angles. The owner lands it. No task depends on Q1 or Q2's answer except Task 7's marked steps.

## 1. Each path: the close moment, where it is stored, and what changes

A payment's close moment is passed **only** where the invoice is issued after the box lost or
deferred the payment's answer; Q1 adds the last served dish on every order path ("The one rule",
below the table). The ordinary live card completion stays as today, so a card started 23:58, tapped
00:01 and issued 00:01 carries one date, the owner's 1am case. For the passed paths the moment is
the card payment row's `created_at`, written before the reader is asked (SumUp `insertAttempting`,
`packages/payments-sumup/src/provider.ts:150-163`; Stripe `provider.ts:166`; column
`packages/payments/src/schema/payments.ts:83`), not `settled_at`, which recovery sets to when the
box noticed (`settledAt: now`, `payments-sumup/src/provider.ts:327`). No new column.

| Path (sweep item) | Close moment and source | Filed today | Filed after | Printed after |
| --- | --- | --- | --- | --- |
| 4. Paid at the till: cash/hand-keyed `/api/sales` (`till-api.ts:1791` → `fileImmediateSale`, `till-sale.ts:1007-1031`); live card `/api/pay` (`till-api.ts:1851` → `finalizeCapture`, `till-sale.ts:1764`) | the issue moment, then the one rule | issue date only | unchanged, except a bill left open: `FechaOperacion` = last served day (example 1) | "Date of the sale" when filed |
| 5a. Bill payments completed later: the loop (`bill-payments-loop.ts:136`), the manager's outcome routes (`payments-api.ts:1580`, `:2054`), attestation (`payments-api.ts:1625`) | latest **acceptance** among the bill's received payments; acceptance = earlier of `bill_payments.created_at` (`packages/db/src/schema/bill-payments.ts:57`, inserted `bill-payments.ts:1273`) and `created_at` of any `payments` row naming it. Attestation inserts its bill payment at attestation time (`payments-api.ts:1599-1614`), so only the card row holds 23:50; then the one rule | issue date only | `FechaOperacion` when that day is earlier | "Date of the sale" when filed |
| 5b. Bill payments completed live: cash (`takeBillPayment` → `issueWhenFullyPaid`, `bill-payments.ts:1375`), reader answer (`bill-payments.ts:1730`), edits and sends (`issueIfFullyPaid` callers, e.g. `till-api.ts:3184`) | the issue moment, then the one rule | issue date only | unchanged, except a bill left open or finished by a later edit: `FechaOperacion` = last served day (examples 1 and 3, D1) | "Date of the sale" when filed |
| 6. Card recovery at start and by its loop (`boot.ts:4451` → `recoverAutomaticCardPayments`, `pending-card-recovery.ts:86`) and the manager's stuck resolve (`payments-api.ts:1762`, `:1846`), all → `finalizeRecovery` (`till-sale.ts:1895`; `recordSale` `:1963`) | `created_at` of the captured row (`captured.id`, `:1949-1953`), then the one rule | issue date — the owner's example files 15 March | `FechaOperacion` 14-03 | "Date of the sale: 14 March" |
| 7. Placed takeaway collected later (`till-api.ts:2694` → `runCollectOrder`, `till-sale.ts:2280`) | collection is the handover and when the invoice issues (`:2383-2396`); one already issued only settles (`:2330-2380`); then the one rule: an order no party holds has no served marks (serving is a party action), so it finds none (P2). Whether a placed takeaway can be held by a party was not checked; one whose lines were marked served on an earlier business day would file that day | issue date only | unchanged: collection is the handover and the issue, one date | unchanged |
| 8. Unpaid departure (`closeBillDeferredTx`, `deferred-close.ts:73-78`, issuing through `issueUnpaidInvoice` at `:160`) | the staff's close action = the issue reading (`deferred-close.ts:98-99`), then the one rule (P4) | issue date only | unchanged, except a departure recorded on a later business day than the last served dish: the last served day | "Date of the sale" when filed |

`finalizeRecovery` also serves a till's retry after a lost answer (`till-sale.ts:1424-1428`), so a
retry that crosses midnight gets the sale date too — stated, not built around.

**The one rule (Q1, Task 6).** Each order issue path has a *payment close*: the acceptance moment
on rows 5a and 6, otherwise the issue reading. The bill's *last served moment* is the latest
`last_served_at` (new, Task 6) of its lines that still owe service (active quantity above zero after
cancellations); it exists only when every such line is fully served (`served_at` set). The close is the last served moment when its
**business day** is earlier than the payment close's, otherwise the payment close. §2 then applies
unchanged: a sale date only when the close's calendar day is earlier than the issue day, so nothing
later than the issue day is ever filed and nothing is refused. The business day is the venue's
trading day, which turns over at its day cutover (`businessDayAt`,
`packages/shared/src/business-day-clock.ts:110-124`; clock from `readVenueClock`,
`packages/db/src/venue.ts:163-165`).

Why business day, not calendar day (**P1**, the plan's, for the watcher): the owner's 01:58 rule
(meal from 21:00, paid at 01:00 → one date) and Q1 (meal Monday, paid Thursday → Monday) differ only
in whether payment came in the same sitting, and the trading day is the line the venue already
draws for one service. Cost: a venue whose cutover is 00:00 gets a sale date for a meal served
before midnight and paid after it.

Worked examples (Europe/Madrid, cutover 05:00; 16 March 2026 is a Monday). VAT accrues «cuando se
presten, ejecuten o efectúen las operaciones gravadas» (LIVA art. 75.Uno.2º, quoted at
`docs/compliance/research/2026-10-27-a948-operation-date-and-b2b.md:72`); in all three the service
ended Monday, and Monday is what files.

1. **Monday meal paid Thursday.** Last dish served Mon 22:30; cash Thu 19 March 12:00 (row 4 or 5b).
   Monday's business day is earlier than Thursday's → close Mon 22:30 → `FechaOperacion` 16-03-2026,
   issue date 19-03-2026, lines at Monday's rates, "Date of the sale: 16 March".
2. **Monday meal paid Mon 23:50 by card, recovered Tue 09:10** (row 5a or 6). Payment close 23:50
   Monday (acceptance); last served 22:30, same business day → close 23:50 → `FechaOperacion`
   16-03-2026, issue date 17-03-2026. The same as before Q1.
3. **Paid Monday, last unserved dish removed Wednesday** (row 5b, D1). The guests pay at 22:45 for
   what they ate; the bill stays unissued because its payments fall short of the total
   (`bill-payments.ts:779-781`). Staff remove the unserved dish Wed 18 March 11:00 and that edit
   issues the invoice. The removed dish owes no service and is ignored; the rest was served Monday →
   `FechaOperacion` 16-03-2026, issue date 18-03-2026, "Date of the sale: 16 March".

The 01:58 check: served Mon 23:30, paid Tue 01:00 — both in Monday's business day → close 01:00
Tuesday = issue day → one date.

**`served_at` facts.** READ: it is written only by staff marking a line served (`writeServed`,
`apps/server/src/working-order.ts:3755-3790`, from `markServed` `:3797` and `markGroupServed`
`:3883`, both taking a party and reading its lines through `servableLines(tx, partyId, …)`,
`:3522-3527`), cleared by unmarking (`unmarkServed` `:3809`, through `writeServed` `:3776`), and
re-stamped `row.servedAt ?? nowIso()` when a part-served line becomes fully served because the rest
was cancelled or moved (`clampServed` `:3924-3949`; `writeServiceCancellations`,
`line-service-cancel.ts:99-114`; `splitLineServiceState`, `line-service-state.ts:148-161`). RUN:
`git grep -n -E "servedAt|served_at"` over non-test `apps/` and `packages/` `.ts` found no other
writer. A whole line cancelled has no active quantity (`serviceQuantities`,
`line-service-state.ts:20-32`) and is skipped; `serviceCompletedAt` (`:34-49`) is not used, because
it counts a cancellation as service.

- **P2 (plan's, for the watcher):** when a line that still owes service has no `served_at` (staff
  never marked it, or no party holds the order, so nothing can mark it),
  there is no last served moment and the payment close stands: today's single date. The
  alternative, a never-marked line's `sent_at`, could file a day earlier than the dish was eaten.
- **P3 (the watcher's, 15:58, inside the owner's «Monday, last dish»):** a line part-served Monday
  whose rest is cancelled Wednesday was last served Monday, so that bill files Monday. `served_at`
  cannot say so: it is set only once the whole line is served (`orders.ts:193-194`; `writeServed`
  writes `null` while part-served, `working-order.ts:3776`), and the re-stamps above put Wednesday
  on it. About twenty readers take `served_at` as "fully served", so its meaning stays. Task 6 adds
  `working_order_lines.last_served_at`, the moment staff last marked a portion of the line served.
  READ: the served count is written only at `writeServed` (`working-order.ts:3779`, its extras
  `:3786`), `clampServed` (`:3946`), `writeServiceCancellations` (`line-service-cancel.ts:113`) and
  `splitLineServiceState` (`line-service-state.ts:152`, `:159`); new and copied lines start at 0
  (`working-order.ts:4790`, `:6430`, `:6449`). RUN: `git grep -n -E 'servedQuantity\s*:'` over
  non-test `apps/` and `packages/` `.ts` at main `d40ca53541` found no other writer. So:
  `writeServed` sets it to its reading on a line, and on each extra, whose served count rises, and
  clears it on one whose count falls to zero, keeping it otherwise; `clampServed` and
  `writeServiceCancellations` never touch it; `splitLineServiceState` gives each side the source's
  value while that side keeps a served count above zero, else `null` (its `source.servedAt ??
  nowIso()` re-stamp, `:148`, would otherwise put the move's time on a split part-served dish).
  Unmarking one of two served portions keeps the time.
- **P4 (plan's):** the unpaid departure (row 8) takes the rule too, so a departure recorded days
  after the last dish files that dish's day; in the ordinary case it is recorded the same business
  day and nothing changes.
- A clock the rule cannot read (`readVenueClock` throws `venue.not_found`, `venue.ts:12`, `:142`;
  `businessDayAt` throws `business_day.clock_invalid`) leaves the payment close: no new refusal.

## 2. What "a later day" means

Both days are venue calendar days. The **issue day** is `localCalendarDate(reading.instant,
reading.offsetMinutes)`, the day `issueMoment` rates at today (`apps/server/src/issue-moment.ts:17-28`)
and `FechaExpedicionFactura` files. The **close day** is `localCalendarDate(closedAt,
timeZoneOffsetMinutes(zone, closedAt))` with `zone` from `readIssueZone`
(`packages/fiscal/src/issue-clock.ts:6-12`): the offset at the close instant, never the issue's or
the process's. It is used only when close day < issue day.

## 3. Filing, pricing and the fingerprint

`VerifactuBackend.recordSale` (`packages/fiscal-verifactu/src/backend.ts:255-310`) is the one
builder that changes: its `AltaInput` gains `FechaOperacion` when handed an earlier day. The
day-to-`Date` conversion moves out of `recordCorrection` (`:565-571`) into one function both call.
`registro-row.ts:142-146` stops refusing `FechaOperacion` on F1/F2 (F3 and by-differences
correctives stay refused). Core `recordSale` (`packages/core/src/record-sale.ts:163-345`) gains the
input. Smallest because storage (`schema/registros.ts:81`), mapping (`registro-row.ts:200`, `:450`),
resend (`record-remedy-http.ts:203-205`) and the month readers (`imputationMonth`,
`registro-row.ts:101-110`; used at `reconcile.ts:325`, `reconcile-series.ts:75`,
`reconcile-sweep.ts:48`) landed with #3235.

**The fingerprint does not cover it.** AEAT, *Detalle de las especificaciones técnicas para
generación de la huella o hash de los registros de facturación*, v0.1.2, 27/08/2024, §3 "Datos de
entrada", p. 5 (URL and SHA-256 prefix `f4334c254bb875b4` at
`docs/superpowers/specs/2026-10-03-fiscal-chain-divergence-design.md:853`; RUN: re-fetched
2026-11-15, same prefix, `pdftotext -layout`): «a) Datos de campos a utilizar en el caso de registros
de facturación de alta … 1. IDEmisorFactura … 2. NumSerieFactura … 3. FechaExpedicionFactura … 4.
TipoFactura … 5. CuotaTotal … 6. ImporteTotal … 7. Huella (RegistroAlta/Encadenamiento/RegistroAnterior/Huella)
8. FechaHoraHusoGenRegistro». The library hashes those eight (`@waitron/verifactu` 0.2.1
`dist/huella.js:35-47`, READ). Task 1 runs the control.

**The VAT rate follows the sale day.** LIVA art. 90.Dos: «El tipo impositivo aplicable a cada
operación será el vigente en el momento del devengo» (quoted in
`docs/compliance/research/2026-10-09-vat-and-corrections.md:205-207`). The library checks each
line's rate against `FechaOperacion` when present, else the issue date (`dist/validate.js:401`,
`:1013-1014`, `TIPO_IMPOSITIVO_DATE`, READ). So when a close day is used, `issueMoment` rates at it
(`rateLines(gross, closeDay)`, `packages/menu/src/pricing.ts:179`).

**The law on printing.** RD 1619/2012 art. 7.1.c (simplified) and 6.1.i (full): «La fecha en que se
hayan efectuado las operaciones que se documentan […], siempre que se trate de una fecha distinta a
la de expedición de la factura» (quoted in [2026-10-15-a663-receipt-layout.md:209](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-15-a663-receipt-layout.md)).

## 4. Schema, tests, guides

- **Schema:** `sales_supply_day_ck` (`packages/db/src/schema/sales.ts:144`) becomes
  `supply_day is null or replaces_original = 1 or corrects_sale_id is null`; comment `:101-102`
  updated (Task 2). `working_order_lines.last_served_at` (`tsString`, nullable, no default; Task 6,
  P3). Core starting migration rebuilt in each task that changes the schema. No data migration
  (pre-live). The PR body names the new column plainly (the watcher, 15:58).
- **Deliberately changed test checks** (named in the PR): `packages/db/src/schema/sales.test.ts:837-841`
  (an ordinary sale's supply day is now stored; the by-differences half `:843-853` stays);
  `packages/fiscal-verifactu/src/record-payload-admission.test.ts:108-118` (the F2 case moves to
  "stores"; R5 "I" stays refused and F3 joins it).
- **Test clocks:** `created_at` defaults to `nowIso()`, the process clock
  (`packages/db/src/schema/columns.ts:182`), while issuance reads the trusted clock. Tasks 4 and 5
  write `created_at` explicitly beside a fake issue clock.
- **Guides:** none. Staff do nothing differently, and a guide sentence describing what the code does
  by itself is cut, not written (CLAUDE.md §3, A803 4b).

## Decisions and questions

- **Q1 (owner, answered 2026-11-15 ~12:05): a bill left open for days.** Asked: a table eats Monday
  evening and pays Thursday at 12:00 — which date does the invoice carry? Answer, picked in the
  watcher's window: «Monday, last dish (Recommended)», option (b): the sale date is the day the last
  dish was served, read at issue. Built from the latest `last_served_at` of the bill's fully served
  lines, a column added for P3 (the watcher, 15:58), since `served_at`
  (`packages/db/src/schema/orders.ts:194`) is re-stamped when a part-served dish's rest is
  cancelled or moved. The question said «The same answer settles a paid bill whose last
  unserved dish is cancelled days later». Record:
  `~/waitron-campaign-shared/desk/done/20261115-1113-L-later-sale-q1-open-bill.md`; relay
  `## WATCHER 2026-11-15 12:12` in `~/waitron-campaign-l/questions.md`. Built as §1's one rule
  (Tasks 6a and 6); P1–P4 there were settled by the watcher (14:58; P3 changed at 15:58). A takeaway **invoiced before**
  collection still cannot carry a later sale date: the library refuses «FechaExpedicionFactura may
  precede FechaOperacion only for IVA/IGIC regimes 14 or 15» (`FECHA_EXPEDICION_BEFORE_OPERACION`,
  `dist/validate.js:614-619`, citing AEAT validation §3.1.3.1), so it files its issue date only and
  nothing is built for it.
- **D1 (flipped by Q1's answer):** a bill paid Monday that issues days later because an edit
  removed its last unserved dish files and prints the day of its last served dish, not the issue
  day (example 3). Correction to D1's earlier wording: READ, none of `issueWhenFullyPaid`'s holds
  (`apps/server/src/bill-payments.ts:767-781`) reads `served_at`. What keeps a paid bill unissued is
  an open draft with unsent lines (`:774-775`, `readBillUnsent`, `bill-unsent.ts:8-36`) or payments
  short of the total (`:779-781`), not an unserved line.
- **Q2 (owner): reports.** Does Waitron's VAT return count such a sale in its sale day's period, and
  does the accountant export (which lists only the issue date, `apps/server/src/accountant-export.ts:200-207`)
  show the sale day? VAT accrues «cuando se presten, ejecuten o efectúen las operaciones gravadas»
  (LIVA art. 75.Uno.2º, `docs/compliance/research/2026-10-27-a948-operation-date-and-b2b.md:72`);
  the owner's answer E already does this for a replaced sale (`packages/reporting/src/vat-return.ts:35-44`);
  and A444's reason was that invoices, AEAT and reports use the same dates
  (`docs/backlog/fiscal.md:1097-1098`). **Recommended: yes to both** (Task 7).

## Review focus

1. Same meal past midnight: live card started 23:58, issued 00:01 → no second date. Task 4; with dishes served at 23:30 as well, Task 6.
2. Clocks go back: paid 25 Oct 2026 00:30 summer time (24 Oct 22:30Z), recovered 26 Oct 10:00 → `2026-10-25`; the issue offset would say the 24th. Task 3.
3. Process zone ≠ venue zone (`TZ=UTC`; Canary venue `Atlantic/Canary`): the day comes from `readIssueZone`. Task 3.
4. Year end across a rate change: paid 31 Dec 2026 23:50, recovered 1 Jan 2027 09:10 → `FechaOperacion` 31-12-2026, lines at 2026's rates, invoice identity and QR keep 01-01-2027, reconcile month 2026-12. Tasks 1 and 3.
5. A reprint days later shows the same "Date of the sale" (from `sales.supply_day`); a refund credit note of that sale shows none. Task 3.
6. Two croquetas, one served Monday 21:10, the other cancelled Wednesday, paid Wednesday → "Date of the sale: 16 March" (P3); the same dish moved to another bill after Monday's portion keeps Monday on the side holding it. Tasks 6a and 6.

---

### Task 1: the backend files `FechaOperacion` on an F1/F2

**Files:** `packages/fiscal/src/backend.ts:402` (`recordSale(tx, sale, filing?: { operationDate?: string })`),
`packages/fiscal-verifactu/src/backend.ts:255-310`, `:565-571`, `src/registro-row.ts:142-146`,
`src/schema/registros.ts:79-80` (comment). Tests: `src/backend.test.ts`, `src/record-payload-admission.test.ts`, `src/reconcile.period.test.ts`.

**Produces:** `FiscalBackend.recordSale(tx, sale, filing?)` — fake and none backends ignore `filing`;
`fechaOperacionFor(day: string, issuedAt: Date, offsetMinutes: number): Date | undefined` in `backend.ts`.

- [ ] Failing tests: F2 issued 2026-03-15T08:10Z at +60 with `operationDate` `2026-03-14` → record
  `FechaOperacion` `"14-03-2026"`, row `fecha_operacion` `"2026-03-14"`; the same on an F1; year end →
  `"31-12-2026"` with `FechaExpedicionFactura` `"01-01-2027"`; no `filing` → no `FechaOperacion`;
  "leaves the fingerprint unchanged": stored `huella` equals `computeHuella` of the record without
  `FechaOperacion` **and** differs when `TipoFactura` changes (control). Admission: F1/F2 store, F3
  and R5 "I" refuse. Reconcile: that F2 is in 2026-03, not 2026-04.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backend.test.ts src/record-payload-admission.test.ts src/reconcile.period.test.ts` → FAIL on the new cases.
- [ ] Implement; `recordCorrection` calls `fechaOperacionFor` in place of its inline conversion.
- [ ] Re-run (Tests count > 0); fiscal gate: `git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/chain.ts` (no output) and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts src/put-right.test.ts`; typecheck both packages. `git commit -s`.

### Task 2: schema and core keep an earlier day

**Files:** `packages/core/src/record-sale.ts` (`RecordSaleInput.operationDate?: string`),
`packages/db/src/schema/sales.ts:101-102,144`, rebuilt `packages/db/drizzle/*`. Tests: `packages/core/src/record-sale.test.ts`, `packages/db/src/schema/sales.test.ts`.

**Produces:** an `operationDate` earlier than the issue day → `sales.supply_day` set and
`backend.recordSale(tx, sale, { operationDate })`; equal, later or absent → neither, no refusal.

- [ ] Failing tests: those three outcomes (spy on `backend.recordSale`'s third argument; read
  `supply_day`), existing cases unedited; `sales.test.ts`: an ordinary sale stores a supply day,
  by-differences still refused.
- [ ] Run → FAIL. Implement; `pnpm --filter @waitron/db db:generate`.
- [ ] Re-run; `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`; fiscal gate; typechecks. `git commit -s`.

### Task 3: the venue day, the rate day and the printed row

**Files:** create `apps/server/src/sale-day.ts`; modify `apps/server/src/issue-moment.ts:17-28`,
`apps/server/src/invoice-typing.ts:60-62`. Tests: `src/sale-day.test.ts`, `src/issue-moment.test.ts`, `src/receipt-issuer.test.ts`.

**Produces:** `venueDayOf(tx: Transaction, scope: IssueScope, instant: string): Promise<string>`;
`issueMoment(clock, gross, fiscal, closeDay?: string): IssueMoment & { operationDate?: string }` —
`operationDate` set and lines rated at `closeDay` only when `closeDay` < the reading's day.

- [ ] Failing tests: `sale-day` — focus 2 and the Canary case, also run as
  `TZ=UTC pnpm --filter @waitron/server exec vitest run src/sale-day.test.ts`; `issue-moment` — with
  the file's existing dated table (reduced 10.00, 11.00 from 2027-01-01, `issue-moment.test.ts:8-20`),
  reading 2027-01-01 with `closeDay` `2026-12-31` → reduced line at 10.00 and `operationDate`
  `2026-12-31`; `closeDay` equal or later → 11.00, no `operationDate`; `receipt-issuer` — F2 with
  `supply_day` `2026-03-14` issued 2026-03-15 → `saleDay: "2026-03-14"`; equal → none; its
  by-differences corrective → none (focus 5).
- [ ] Run → FAIL. Implement. Re-run; fiscal gate. `git commit -s`.

### Task 4: card recovery passes the card's acceptance moment

**Files:** `apps/server/src/till-sale.ts` (`finalizeRecovery` `:1895-1963`: read the captured row's
`created_at`, `venueDayOf`, pass `closeDay` to `issueMoment` at `:1924-1928` and `operationDate` to
`recordSale`). `finalizeCapture` is not touched. Test: `apps/server/src/till-sale.later-sale-date.test.ts` (new).

- [ ] Failing tests (Europe/Madrid, `useVenueDb`, `created_at` written explicitly, fake issue clock,
  no line marked served): the owner's example — card row created `2026-03-14T22:50:00Z`, recovered `2026-03-15T08:10:00Z` →
  `supply_day` `2026-03-14`, ticket `saleDay` `2026-03-14`; same through the stuck-resolve route;
  focus 1 through `finalizeCapture` (created 23:58, live answer at 00:01) → no `saleDay`; a row
  created after the issue reading → none, sale issued; one case through the real Veri\*Factu backend
  reading `registros_facturacion.fecha_operacion` = `2026-03-14` after recovery.
- [ ] Run → FAIL. Implement. Re-run; fiscal gate. `git commit -s`.

### Task 5: bill payments completed later pass the latest acceptance

**Files:** `apps/server/src/bill-payments.ts` (`issueWhenFullyPaid` `:745-830` gains option
`closedAt?: "latest-acceptance"`; `completeBillPayment` `:1503` and `issueIfFullyPaid` `:895` forward
it), `bill-payments-loop.ts:136`, `payments-api.ts:1580`, `:1625`, `:2054` pass it. The live reader
answer (`bill-payments.ts:1730`), cash (`:1375`) and every edit caller do not. Test: `apps/server/src/bill-payments.later-sale-date.test.ts` (new).

- [ ] Failing tests (`created_at` explicit, fake issue clock, no line marked served): bill payment
  accepted 23:50 on 14 March,
  completed by the loop 09:10 on 15 March → `2026-03-14`; attestation (bill row 09:10, card row
  23:50) → `2026-03-14`; manager outcome route → `2026-03-14`; live reader answer across midnight →
  none; payments on the 14th 23:00 and the 15th 08:00, completed by the loop on the 15th → none.
  D1's example moved to Task 6 with its flipped answer.
- [ ] Run → FAIL. Implement. Re-run; fiscal gate. `git commit -s`.

### Task 6a: a dish keeps the moment it was last served (P3)

**Files:** `packages/db/src/schema/orders.ts:193-195` (`lastServedAt: tsString("last_served_at")`,
nullable, no default; one comment line: when staff last marked a portion served, set while
`served_quantity` is above zero), rebuilt `packages/db/drizzle/*`; `apps/server/src/working-order.ts`
(`writeServed`, `:3755-3790`); `apps/server/src/line-service-state.ts` (`splitLineServiceState`,
`:99-165`). Tests: extend `apps/server/src/served.test.ts` (its "served by quantity" block, `:453`)
and `apps/server/src/line-service-split.test.ts` (`:286`, `:341`).

**Produces:** the column §1's P3 describes. `writeServed`: on the line and on each extra, served
count up → its reading; down to zero → `null`; otherwise unchanged. `clampServed` and
`writeServiceCancellations` unchanged (they never set it). `splitLineServiceState`: each side takes
the source's value while its own served count stays above zero, else `null`. No reader yet (Task 6),
no error code, no refusal; `served_at` and its readers unchanged.

- [ ] Failing tests, existing cases unedited: serve 1 of 2 at T1 → `last_served_at` T1,
  `served_at` null; the other at T2 → both T2; unserve 1 → `last_served_at` T2, `served_at` null;
  unserve the last → null; an extra follows its dish; part-served at T1, rest cancelled at T2 →
  `served_at` T2, `last_served_at` T1; a part-served line split by a move at T2 → the side that
  keeps the served portion has T1, a side with none has null.
- [ ] `pnpm --filter @waitron/server exec vitest run src/served.test.ts src/line-service-split.test.ts` → FAIL on the new cases.
- [ ] Implement; `pnpm --filter @waitron/db db:generate`. Re-run (Tests count > 0); `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts`;
  fiscal gate; db and server typecheck. `git commit -s`.

### Task 6: a bill left open takes the day of its last served dish (Q1)

**Files:** `apps/server/src/sale-day.ts` (Task 3's) gains the helpers below. The five `issueMoment`
callers pass `closeDay = await saleCloseDay(…)`: `till-sale.ts:1021` (`fileImmediateSale`, rows 4
and 7), `:1794` (`finalizeCapture`, row 4's live card), `:1924` (`finalizeRecovery`, row 6, with
Task 4's acceptance as `paidAt`), `bill-payments.ts:787` (`issueWhenFullyPaid`, rows 5a and 5b,
with Task 5's acceptance as `paidAt` when `closedAt` is set) and `working-order.ts:7257`
(`priceForIssuance`, row 8). A caller with no acceptance first pins one reading (`pinnedAt`,
`apps/server/src/issue-moment.ts:30-36`, as `runCollectOrder` does at `till-sale.ts:2307`, `:2388`)
and passes that reading's instant as `paidAt`, so `issueMoment` rates and dates at the same reading.
Tests: `apps/server/src/sale-day.test.ts` (extend), `apps/server/src/bill-left-open.later-sale-date.test.ts` (new).

**Produces:** `lastServedAt(tx, workingOrderId): Promise<string | undefined>` — over the order's
lines, active quantity from `serviceQuantities` with `readLineCancellations`
(`line-service-state.ts:20-32`, `:51`); lines with none active are skipped; `undefined` when no line
is left or any left has no `served_at` (P2), else the latest `last_served_at` (Task 6a) of the
lines left; never `serviceCompletedAt`. `closeOf(lastServed, paidAt,
clock: BusinessDayClock): string` — pure: `lastServed` when its `businessDayAt` is earlier than
`paidAt`'s, else `paidAt`, and `paidAt` when `businessDayAt` throws. `saleCloseDay(tx, scope,
workingOrderId, paidAt): Promise<string>` — `venueDayOf` of that close; reads `readVenueClock` only
when `lastServedAt` is defined and takes `paidAt` on any `AppError` from it. No new error
code or refusal; `finalizeCapture` changes only by this call.

- [ ] Failing tests (Europe/Madrid, cutover 05:00, `useVenueDb`, `served_at`, `last_served_at` and `created_at` written
  explicitly, fake issue clock; §1's examples): example 1 through cash `/api/sales` and through a
  cash bill payment → `supply_day` `2026-03-16`, ticket `saleDay` `2026-03-16`, lines at Monday's
  rates; example 1 through the real Veri\*Factu backend → `registros_facturacion.fecha_operacion`
  `2026-03-16`; example 1 paid at a reader with a live answer (`finalizeCapture`) and through card
  recovery → `2026-03-16`; example 2 through the loop → `2026-03-16`; example 3 through the
  route that removes a sent dish and reaches `issueIfFullyPaid` (a candidate, not checked to remove
  a sent dish: `PUT /api/working-orders/:id/lines/:lineNo`, `till-api.ts:4051`, issuing at `:4080`)
  → `2026-03-16` (D1, was "none"); the 01:58 check (served Mon 23:30, cash Tue 01:00) → none; served
  Mon 22:30, cash Tue 07:00 → `2026-03-16`; one line owing service unmarked (P2) → none; a line
  part-served Monday 21:10, its rest cancelled Wednesday through the real cancel route, issued
  Wednesday (P3) → `2026-03-16`; a placed takeaway
  with no served marks collected Thursday (row 7) → none; an unpaid departure recorded Thursday for
  a Monday meal (P4) → `2026-03-16`. `closeOf`: earlier business day, same, later, and a clock `businessDayAt` refuses →
  `paidAt`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/sale-day.test.ts src/bill-left-open.later-sale-date.test.ts` → FAIL on the new cases.
- [ ] Implement. Re-run (Tests count > 0), and `src/till-sale.later-sale-date.test.ts
  src/bill-payments.later-sale-date.test.ts src/issue-moment.test.ts` pass unedited; fiscal gate;
  typecheck. `git commit -s`.

### Task 7: reports (Q2) and the docs that go stale

**Files:** `packages/reporting/src/vat-return.ts:40` (`coalesce(repl.supply_day, s.supply_day, ${filedDate})`,
doc `:24-27`) and `apps/server/src/accountant-export.ts:200-207` (a sale-day column) — **only on Q2
"yes"**; docs: `docs/backlog/fiscal.md:1095-1109` and `:1124-1126`, `docs/compliance/asesor-questions.md:472-474`,
`docs/compliance/research/2026-10-27-a948-operation-date-and-b2b.md:3-6`.

- [ ] On Q2 "yes": failing tests — an F2 issued 1 April with `supply_day` 31 March counts in Q1, and
  the export row shows `2026-03-31`. Run, FAIL, implement, pass.
- [ ] Docs: add dated pointers, never rewrites of history, saying an invoice issued on a later day
  now carries the sale date; replace "nothing about those paths has changed yet" with what landed,
  D1, and the Q1/Q2 answers. `git commit -s`.

## Not verified

Path cites were READ, not run. The huella quote was RUN (fetched); the LIVA and RD 1619/2012 quotes
come from repo research, and AEAT's validation PDF behind `validate.js` was not re-read. The parked
A444 branches are not reused: #3235 landed their storage and month readers.

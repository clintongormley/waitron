# LATER-SALE-DATE: an invoice issued on a later day files and prints the sale date — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: **awaiting a fresh read, then the watcher. Build nothing before then.** Written at main
`9f5b081084`. **READ** = source read at that commit; **RUN** = a command was run and its output read.

**Goal:** when a sale's invoice is issued on a later venue calendar day than the moment the guest
paid, the F1/F2 record files that earlier day as `FechaOperacion`, and every printed or displayed
copy shows "Date of the sale: …".

**Architecture:** the server works out the venue day of a moment it already stores (when the card
or bill payment was accepted) and hands it to core `recordSale` as `operationDate`. Core keeps it
only when it is strictly earlier than the issue day, saves it in the existing `sales.supply_day`,
and passes it to the backend, which files it with the conversion `recordCorrection` already uses.
Printing reuses #3301's `saleDay` row unchanged; only `readInvoiceTyping` learns to emit it for an
F1/F2.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest with `useVenueDb`, `@waitron/verifactu` 0.2.1.

**Spec:** the owner's rule, 2026-11-15 05:28 (`~/waitron-campaign-shared/desk/done/20261115-0530-L-later-sale-date-rule.md`;
lane L `questions.md:1865-1866`): "the operation date is when the table closed (or the takeaway was
handed over); when the invoice's own date falls on a later day, file it as the sale date
(FechaOperacion) and print it". The owner, 01:58: "the operation date is when the table closes,
which normally coincides with the invoice date … where an invoice is issued days after the meal
finished … the operation date and the invoice date should be distinct". The 2026-11-12 rule stays
for the ordinary case: no second date on an invoice issued at the end of the meal
(`docs/backlog/fiscal.md:1095-1109`). Input sweep: `~/waitron-campaign-l/receipts/a1407-step2/days-later-invoice-paths.md`
(at `caf0deb9ca`; every line below re-read at `9f5b081084`).

## Global constraints

- Credit notes and every corrective (R1–R5, by differences or by replacement) keep their own rules: untouched.
- Never edited: `computeHuella`, the chain (`appendToChain`), `allocateInvoiceNumber`, the
  `registros_facturacion` schema and triggers. `write-path.e2e.test.ts` (golden fingerprint) and
  `inmutabilidad.test.ts` pass **unedited** after every task; if either needs a change, **STOP**,
  leave the PR `needs-owner-review` and write the question in lane L's `questions.md`.
- Pre-live schema rule (CLAUDE.md §3): edit the TypeScript schema and rebuild the core starting
  migration (`pnpm --filter @waitron/db db:generate`); never a new migration. The PR's title starts
  "Reset test venues:".
- Nothing new may refuse a sale: a missing, equal or later close day files the invoice exactly as today.
- One PR, branch `feat/later-sale-date` from main; one `subagent_type: "implementer"` per task;
  fiscal is a risk trigger, so per-task reviews and `/finish-branch`'s full wave with two Codex angles. The owner lands it.

## 1. Each path: the close moment, where it is stored, and what changes

The close moment is when the server **accepted the payment that completed the bill**, before any
card reader answered — the moment the owner's example calls "card payment at 23:50". Every time
below is already stored; **no new column**.

| Path (sweep item) | Close/handover moment, and its source | Filed today | Filed after | Printed after |
| --- | --- | --- | --- | --- |
| 4a. Cash or hand-keyed card at the till, `/api/sales` (`till-api.ts:1791` → `fileImmediateSale`, `till-sale.ts:1007-1031`) | the payment itself, in the invoice's own transaction: the tender's `settledAt` is the issue reading (`:1030-1031`) | issue date only | unchanged | unchanged |
| 4b. Integrated card at the till, `/api/pay` (`till-api.ts:1851` → `finalizeCapture`, `till-sale.ts:1764`, `recordSale` `:1808`) | `payments.created_at` of the captured card row, written before the reader is asked (SumUp `insertAttempting`, `packages/payments-sumup/src/provider.ts:150-163`; Stripe `provider.ts:166`; column `packages/payments/src/schema/payments.ts:83`) | issue date only | `FechaOperacion` = that row's venue day when earlier than the issue day (reader running across midnight) | "Date of the sale" when filed |
| 5. Bill payments completed later: card capture (`completeBillPayment`, `bill-payments.ts:1503`, issues at `:1584-1591`), the background loop (`bill-payments-loop.ts:136`), a manager's recorded outcome (`payments-api.ts:1580`, `:2054`) and attestation of a whole-order card as a bill payment (`payments-api.ts:1600-1631`) — all reach `issueWhenFullyPaid` (`bill-payments.ts:745`, `recordSale` `:818`) with `moneyMoved: true` | the latest **acceptance** among the bill's received payments, where a payment's acceptance is the earlier of `bill_payments.created_at` (`packages/db/src/schema/bill-payments.ts:57`, inserted at `bill-payments.ts:1273`) and `created_at` of any `payments` row naming it. The attestation path inserts its bill payment at attestation time (`payments-api.ts:1599-1614`), so only the card row holds 23:50 | issue date only | `FechaOperacion` when that day is earlier | "Date of the sale" when filed |
| 5'. Same function reached by an edit, a send or a cancellation (`moneyMoved` false: `till-api.ts:3184` and the others in `git grep issueIfFullyPaid`) | the edit is what lets the invoice issue, so it closes the table: issue moment | issue date only | unchanged (decision D1) | unchanged |
| 6. Card recovery at start and by its loop (`boot.ts:312` → `pending-card-recovery.ts:86`) and a manager's stuck-payment resolve (`payments-api.ts:1762`, `:1846`) — all `payWorkingOrderIntegratedOrchestration` → `finalizeRecovery` (`till-sale.ts:1895`, `recordSale` `:1963`) | `payments.created_at` of the captured row (`captured.id`, `:1949-1953`) | issue date only — the owner's example files 15 March | `FechaOperacion` 14-03 | "Date of the sale: 14 March" |
| 7. A placed takeaway collected later (`till-api.ts:2694` → `runCollectOrder`, `till-sale.ts:2280`) | handover = collection. With no invoice yet, it issues at collection (`fileImmediateSale`, `:2383-2396`); with one already issued it only settles (`:2330-2380`) | issue date only | unchanged (question Q1) | unchanged |
| 8. Unpaid departure / deferred close (`closeBillDeferredTx`, `deferred-close.ts:73-78`, issuing through `issueUnpaidInvoice` at `:160`, `working-order.ts:7280`) | the staff's close action, which is the issue reading (`deferred-close.ts:98-99`); nothing earlier is stored | issue date only | unchanged | unchanged |

A table cannot be finished while a bill owes money (`finishTable` refuses `party.bill_outstanding`,
`apps/server/src/parties.ts:771-772`), and no code closes an open bill at the day change (sweep), so
a bill left open for days closes when it is paid — paths 4a/4b/5.

## 2. What "a later day" means

Both days are venue calendar days. The **issue day** is `localCalendarDate(now.instant,
now.offsetMinutes)` — the day `FechaExpedicionFactura` files, since `prepareIssueClock` sets the
venue zone's offset (`packages/fiscal/src/issue-clock.ts:14-28`). The **close day** is
`localCalendarDate(close, timeZoneOffsetMinutes(zone, close))`, with `zone` from `readIssueZone`
(`issue-clock.ts:6-12`) — the offset at the close instant, never the issue's or the process's. A date
is filed only when close day < issue day. Same-meal 1am: paid and issued 15 March 01:00 → both
15 March → nothing filed, as the owner requires.

## 3. Where `FechaOperacion` enters an F1/F2, and the fingerprint

`VerifactuBackend.recordSale` (`packages/fiscal-verifactu/src/backend.ts:255-310`) is the one
builder that changes: its `AltaInput` gains `FechaOperacion` when handed an earlier day. The
day-to-`Date` conversion moves out of `recordCorrection` (`:565-571`) into one module function both
call, so there is one mechanism. `registro-row.ts:142-146` stops refusing `FechaOperacion` on F1/F2
(F3 and by-differences correctives stay refused). Core `recordSale`
(`packages/core/src/record-sale.ts:163-345`) gains the input and the comparison. Smallest because
storage (`registros.fecha_operacion`, `schema/registros.ts:81`), its mapping (`registro-row.ts:200`,
`:450`), resend (`record-remedy-http.ts:203-205`) and the month readers (`imputationMonth`,
`registro-row.ts:101-110`, used at `reconcile.ts:325`, `reconcile-series.ts:75`, `reconcile-sweep.ts:48`)
already landed with #3235; core's comparison is the only place that sees both days.
`recordCorrection`, `recordSubstitution`, the chain and numbering keep their behaviour.

**The fingerprint does not cover it.** AEAT, *Detalle de las especificaciones técnicas para
generación de la huella o hash de los registros de facturación*, v0.1.2, 27/08/2024, §3 "Datos de
entrada", p. 5 (the URL and SHA-256 prefix `f4334c254bb875b4` cited at
`docs/superpowers/specs/2026-10-03-fiscal-chain-divergence-design.md:853`; RUN: re-fetched
2026-11-15, same prefix, `pdftotext -layout`): «a) Datos de campos a utilizar en el caso de registros
de facturación de alta … 1. IDEmisorFactura … 2. NumSerieFactura … 3. FechaExpedicionFactura … 4.
TipoFactura … 5. CuotaTotal … 6. ImporteTotal … 7. Huella (RegistroAlta/Encadenamiento/RegistroAnterior/Huella)
8. FechaHoraHusoGenRegistro». `FechaOperacion` is not listed; the library hashes those eight
(`@waitron/verifactu` 0.2.1 `dist/huella.js:35-47`, READ). Task 1 runs the control.

**The law.** RD 1619/2012 art. 7.1.c (simplified) and 6.1.i (full): «La fecha en que se hayan
efectuado las operaciones que se documentan […], siempre que se trate de una fecha distinta a la de
expedición de la factura» (quoted in `docs/superpowers/plans/2026-10-15-a663-receipt-layout.md:209`).
A day after the issue day is never filed: the library rejects «FechaExpedicionFactura may precede
FechaOperacion only for IVA/IGIC regimes 14 or 15», citing AEAT validation §3.1.3.1
(`dist/validate.js:604-620`, READ; AEAT's PDF not re-read here).

## 4. Schema, tests, guides

- **Schema:** `sales_supply_day_ck` (`packages/db/src/schema/sales.ts:144`) becomes
  `supply_day is null or replaces_original = 1 or corrects_sale_id is null` (ordinary sales and
  replacements; never a by-differences corrective). The column comment at `:101-102` is updated.
  Rebuilt core starting migration. `vat-return.ts:40` changes only on Q2.
- **Deliberately changed test checks** (each named in the PR): `packages/db/src/schema/sales.test.ts:837-841`
  (an ordinary sale's supply day is now stored; the by-differences half at `:843-853` stays);
  `packages/fiscal-verifactu/src/record-payload-admission.test.ts:108-118` (the F2 case moves to
  "stores"; the R5 "I" case stays refused, and F3 joins it).
- **Guides:** no change. Staff do nothing differently, and a guide sentence that only describes
  what the code does by itself is cut, not written (CLAUDE.md §3, A803 4b).

## Decisions and questions

- **D1 (plan's):** only payment-completion calls (`moneyMoved: true`) carry a close moment. An edit
  that lets a fully paid bill issue closes the table itself, so it files the issue date.
- **Q1 (owner):** a bill left open for days and a takeaway collected days later were named as
  later-day paths, but in today's code the close (payment) or handover (collection) is the moment
  the invoice issues (table 4a, 7), so nothing changes. **Recommended: confirm.** Filing an earlier
  "meal ended" day would need a new stored fact (`finishTable` refuses while money is owed); that
  is the parked A444 capture work (`feat/a444-close-day-capture`), not this plan.
- **Q2 (owner):** does Waitron's VAT return count such a sale in its sale day's period? VAT accrues
  «cuando se presten, ejecuten o efectúen las operaciones gravadas» (LIVA art. 75.Uno.2º, quoted in
  `docs/compliance/research/2026-10-27-a948-operation-date-and-b2b.md:72`), and answer E already does
  this for a replaced sale (`vat-return.ts:35-44`). **Recommended: yes** — Task 5. On "no", Task 5
  drops its code step.

## Review focus

1. Clocks go back: paid 25 Oct 2026 00:30 summer time (24 Oct 22:30Z), issued 26 Oct 10:00 → `2026-10-25`; the issue offset would say 24th. Task 2.
2. Process zone ≠ venue zone (`TZ=UTC` test run, Canary venue `Atlantic/Canary`): the day comes from `readIssueZone`. Task 2.
3. A close instant after the issue instant (clock stepped back between rows): nothing filed, the sale still issues. Task 3.
4. Year end: paid 31 Dec 2026 23:50, issued 1 Jan 2027 09:10 → `FechaOperacion` 31-12-2026; invoice identity and QR keep 01-01-2027; the reconcile month is 2026-12. Task 1.
5. A reprint days later shows the same "Date of the sale" (read from `sales.supply_day`), and a refund credit note of that sale shows none. Task 2.

---

### Task 1: the backend files `FechaOperacion` on an F1/F2

**Files:** Modify `packages/fiscal/src/backend.ts:402` (`recordSale(tx, sale, filing?: { operationDate?: string })`),
`packages/fiscal-verifactu/src/backend.ts:255-310`, `:565-571`, `src/registro-row.ts:142-146`,
`src/schema/registros.ts:79-80` (comment only). Test: `src/backend.test.ts`, `src/record-payload-admission.test.ts`, `src/reconcile.period.test.ts`.

**Interfaces — Produces:** `FiscalBackend.recordSale(tx, sale, filing?: { operationDate?: string })`
(`operationDate` is `YYYY-MM-DD`, already checked earlier than the issue day by core). Fake and
none backends ignore the argument. `function fechaOperacionFor(day: string, issuedAt: Date, offsetMinutes: number): Date | undefined` in `backend.ts` (undefined when the day equals the issue day).

- [ ] Write failing tests: `"files the earlier sale day as FechaOperacion on a simplified invoice"`
  (F2 issued 2026-03-15T08:10Z at +60 with `operationDate` `2026-03-14` → built record
  `FechaOperacion` `"14-03-2026"`, row `fecha_operacion` `"2026-03-14"`); the same on an F1; the year-end case
  (focus 4) → `"31-12-2026"`, `NumSerieFactura`/`FechaExpedicionFactura` `"01-01-2027"`; no `filing`
  → no `FechaOperacion`, `fecha_operacion` null; `"leaves the fingerprint unchanged"`: the stored
  `huella` equals `computeHuella` of the same record with `FechaOperacion` removed, **and** differs
  when `TipoFactura` is changed (the control that the check sees). `record-payload-admission`:
  F2/F1 store, F3 and R5 "I" refuse. `reconcile.period.test.ts`: that F2 is listed in 2026-03, not 2026-04.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backend.test.ts src/record-payload-admission.test.ts src/reconcile.period.test.ts`: expect FAIL on the new cases.
- [ ] Implement; `recordCorrection` calls `fechaOperacionFor` in place of its inline conversion.
- [ ] Re-run (Tests count > 0, all pass), plus the fiscal gate:
  `git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/chain.ts`
  (no output) and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts src/put-right.test.ts`; typecheck both packages.
- [ ] `git commit -s`.

### Task 2: core keeps an earlier day; the receipt prints it

**Files:** Modify `packages/core/src/record-sale.ts` (`RecordSaleInput.operationDate?: string`),
`packages/core/src/errors.ts` (`sale.operation_date_invalid`, `{ operationDate: string }`),
`packages/db/src/schema/sales.ts:101-102,144`, rebuilt `packages/db/drizzle/*`;
`apps/server/src/invoice-typing.ts:60-62`. Create `apps/server/src/sale-day.ts`.
Test: `packages/core/src/record-sale.test.ts`, `packages/db/src/schema/sales.test.ts`, `apps/server/src/sale-day.test.ts`, `apps/server/src/receipt-issuer.test.ts`.

**Interfaces — Produces:** `venueDayOf(tx: Transaction, scope: IssueScope, instant: string): Promise<string>`
(`sale-day.ts`, focus 1–2). Core: malformed → `sale.operation_date_invalid`; earlier than issue day
→ `sales.supply_day` set and `backend.recordSale(tx, sale, { operationDate })`; equal or later →
neither, no refusal.

- [ ] Failing tests: core — the three outcomes above (spy on `backend.recordSale`'s third argument;
  read `supply_day`), with the existing cases unedited; `sales.test.ts` — an ordinary sale stores a
  supply day, by-differences still refused; `sale-day.test.ts` — focus 1 and the Canary case, run
  once under `TZ=UTC`; `receipt-issuer.test.ts` — an F2 with `supply_day` `2026-03-14` issued
  `2026-03-15` → `saleDay: "2026-03-14"`; equal day → none; its by-differences corrective → none (focus 5).
- [ ] Run each file; expect FAIL. Implement; `pnpm --filter @waitron/db db:generate`.
- [ ] Re-run, then `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/errors-reachable.test.ts`, the fiscal gate, typechecks. `git commit -s`.

### Task 3: integrated card and card recovery pass the card's acceptance day

**Files:** Modify `apps/server/src/till-sale.ts` (`finalizeCapture` `:1808`, `finalizeRecovery` `:1963`).
Test: `apps/server/src/till-sale.later-sale-date.test.ts` (new).

**Interfaces — Consumes:** `venueDayOf` (Task 2). Each passes `operationDate: await venueDayOf(tx, cfg, <payments.created_at of the captured row>)`.

- [ ] Failing tests (venue Europe/Madrid, real `useVenueDb`): the owner's example — card row created
  `2026-03-14T22:50:00Z`, recovered at `2026-03-15T08:10:00Z` → `supply_day` `2026-03-14`, ticket
  `saleDay` `2026-03-14`; reader answering across midnight (created 23:59:50, captured 00:00:10) →
  `2026-03-14`; same-meal 1am → no `saleDay`; created after the issue reading (focus 3) → none, sale issued; the stuck-resolve route reaches the same result.
- [ ] Run; FAIL. Implement. Re-run; fiscal gate; `git commit -s`.

### Task 4: bill payments completed later pass the latest acceptance day

**Files:** Modify `apps/server/src/bill-payments.ts:745-830`. Test: `apps/server/src/bill-payments.later-sale-date.test.ts` (new).

**Interfaces — Produces:** `latestAcceptance(tx, workingOrderId): Promise<string>` (private): the max
over received `bill_payments` of min(own `created_at`, `created_at` of `payments` rows whose
`bill_payment_id` names it). Passed as `operationDate` only when `options.moneyMoved === true` (D1).

- [ ] Failing tests: card bill payment accepted 23:50 on 14 March, completed by the loop at 09:10 on
  15 March → `2026-03-14`; the attestation path (`payments-api.ts:1600-1631`, bill row created at
  09:10, card row at 23:50) → `2026-03-14`; two payments, 14th 23:00 and 15th 08:00 → nothing; cash
  at 01:00 → nothing; a fully paid bill issued by a cancellation at 00:20 (`moneyMoved` false) → nothing.
- [ ] Run; FAIL. Implement. Re-run; fiscal gate; `git commit -s`.

### Task 5: VAT return (on Q2 "yes") and the backlog

**Files:** `packages/reporting/src/vat-return.ts:40` (`coalesce(repl.supply_day, s.supply_day, ${filedDate})`, doc comment `:24-27`); test `src/vat-return.test.ts`; `docs/backlog/fiscal.md:1124-1126`.

- [ ] Failing test: an F2 issued 1 April with `supply_day` 31 March counts in Q1, not Q2. Run, FAIL, implement, pass.
- [ ] Replace the backlog's "queued as LATER-SALE-DATE; nothing … has changed yet" with what landed, D1 and the owner's Q1/Q2 answers. `git commit -s`.

## Not verified

Path cites were READ, not run. The huella quote was RUN (fetched); the art. 7.1.c and LIVA quotes are
taken from repo research, and AEAT's validation PDF behind `validate.js` was not re-read. Whether the
server tests use the real Veri\*Factu backend or the fake is left to Tasks 3–4's implementers; if
fake, the record-level check stays Task 1's. The parked A444 branches (`feat/a444-fiscal-operation-day`,
`feat/a444-close-day-capture`) are not reused: #3235 landed their storage and month readers, and their capture rule differs.

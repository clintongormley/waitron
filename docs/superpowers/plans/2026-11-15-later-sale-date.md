# LATER-SALE-DATE: an invoice issued on a later day files and prints the sale date — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Fresh Claude read 2026-11-15: Ready after fixes; folded in (the commit after `72a7eba3f2`).

Status: **awaiting the watcher. Build nothing before then.** Written at main `9f5b081084`.
**READ** = source read at that commit; **RUN** = a command was run and its output read.

**Goal:** when an invoice is issued on a later venue calendar day than the moment the guest paid,
because the box only learned of the payment later (a restart, the background loop, a manager's
recovery), the F1/F2 record files that earlier day as `FechaOperacion`, is priced at that day's VAT
rates, and every printed or displayed copy shows "Date of the sale: …".

**Architecture:** only the paths that issue later hand a close moment (`closedAt`, an instant
already stored) to the issue step. `issueMoment` turns it into the venue day, prices at that day
when it is earlier than the issue day, and returns it as `operationDate`. Core `recordSale` saves it
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
  angles. The owner lands it. No task depends on Q1 or Q2's answer except Task 6's marked steps.

## 1. Each path: the close moment, where it is stored, and what changes

A close moment is passed **only** where the invoice is issued after the box lost or deferred the
payment's answer. The ordinary live card completion stays as today, so a card started 23:58, tapped
00:01 and issued 00:01 carries one date, the owner's 1am case. For the passed paths the moment is
the card payment row's `created_at`, written before the reader is asked (SumUp `insertAttempting`,
`packages/payments-sumup/src/provider.ts:150-163`; Stripe `provider.ts:166`; column
`packages/payments/src/schema/payments.ts:83`), not `settled_at`, which recovery sets to when the
box noticed (`settledAt: now`, `payments-sumup/src/provider.ts:327`). No new column.

| Path (sweep item) | Close moment and source | Filed today | Filed after | Printed after |
| --- | --- | --- | --- | --- |
| 4. Paid at the till: cash/hand-keyed `/api/sales` (`till-api.ts:1791` → `fileImmediateSale`, `till-sale.ts:1007-1031`); live card `/api/pay` (`till-api.ts:1851` → `finalizeCapture`, `till-sale.ts:1764`) | the issue moment | issue date only | unchanged | unchanged |
| 5a. Bill payments completed later: the loop (`bill-payments-loop.ts:136`), the manager's outcome routes (`payments-api.ts:1580`, `:2054`), attestation (`payments-api.ts:1625`) | latest **acceptance** among the bill's received payments; acceptance = earlier of `bill_payments.created_at` (`packages/db/src/schema/bill-payments.ts:57`, inserted `bill-payments.ts:1273`) and `created_at` of any `payments` row naming it. Attestation inserts its bill payment at attestation time (`payments-api.ts:1599-1614`), so only the card row holds 23:50 | issue date only | `FechaOperacion` when that day is earlier | "Date of the sale" when filed |
| 5b. Bill payments completed live: cash (`takeBillPayment` → `issueWhenFullyPaid`, `bill-payments.ts:1375`), reader answer (`bill-payments.ts:1730`), edits and sends (`issueIfFullyPaid` callers, e.g. `till-api.ts:3184`) | the issue moment | issue date only | unchanged (D1) | unchanged |
| 6. Card recovery at start and by its loop (`boot.ts:4451` → `recoverAutomaticCardPayments`, `pending-card-recovery.ts:86`) and the manager's stuck resolve (`payments-api.ts:1762`, `:1846`), all → `finalizeRecovery` (`till-sale.ts:1895`; `recordSale` `:1963`) | `created_at` of the captured row (`captured.id`, `:1949-1953`) | issue date — the owner's example files 15 March | `FechaOperacion` 14-03 | "Date of the sale: 14 March" |
| 7. Placed takeaway collected later (`till-api.ts:2694` → `runCollectOrder`, `till-sale.ts:2280`) | collection is the handover and when the invoice issues (`:2383-2396`); one already issued only settles (`:2330-2380`) | issue date only | waits on Q1 | waits on Q1 |
| 8. Unpaid departure (`closeBillDeferredTx`, `deferred-close.ts:73-78`, issuing through `issueUnpaidInvoice` at `:160`) | the staff's close action = the issue reading (`deferred-close.ts:98-99`) | issue date only | unchanged | unchanged |

`finalizeRecovery` also serves a till's retry after a lost answer (`till-sale.ts:1424-1428`), so a
retry that crosses midnight gets the sale date too — stated, not built around.

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
la de expedición de la factura» (quoted in `docs/superpowers/plans/2026-10-15-a663-receipt-layout.md:209`).

## 4. Schema, tests, guides

- **Schema:** `sales_supply_day_ck` (`packages/db/src/schema/sales.ts:144`) becomes
  `supply_day is null or replaces_original = 1 or corrects_sale_id is null`; comment `:101-102`
  updated; core starting migration rebuilt.
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

- **D1 (plan's, for the watcher):** an edit, send or cancellation that lets a long-paid bill issue
  files the issue date only. Example: the guest pays Monday by card at a reader, the box answers
  live, but an unserved line holds the invoice (`bill-payments.ts:774-775`); staff cancel the line on
  Wednesday and the invoice issues Wednesday, dated Wednesday, with no "Date of the sale".
- **Q1 (owner): a bill left open for days, and a takeaway collected days later.** The owner's 05:28
  answer lists both among the cases that file and print the sale date. In today's code their close
  or handover is the moment the invoice issues: a table cannot be finished while it owes money
  (`finishTable` refuses `party.bill_outstanding`, `apps/server/src/parties.ts:771-772`), and a
  takeaway's collection is its handover and its issue (table row 7). Example: a table eats on Monday
  evening, leaves the bill open, and pays on Thursday at 12:00; the invoice is issued Thursday.
  (a) The Thursday payment is the close: one date, Thursday. (b) A stand-in for the end of the meal:
  the latest `served_at` of the bill's lines (`packages/db/src/schema/orders.ts:194`), read at issue,
  no new column — Monday, printed as "Date of the sale". Asking for the bill would not serve: the
  owner ruled on 27 October that it never counts as the close
  (`docs/compliance/research/2026-10-27-a948-operation-date-and-b2b.md:8-12`). (c) Revive the parked
  close-day capture (`feat/a444-close-day-capture`: three new `bill_payments` columns and a service
  fingerprint, never pushed). This build covers the clear later-issue paths now; Q1's paths follow
  the answer. A takeaway **invoiced before** collection cannot carry a later sale date: the library
  refuses «FechaExpedicionFactura may precede FechaOperacion only for IVA/IGIC regimes 14 or 15»
  (`FECHA_EXPEDICION_BEFORE_OPERACION`, `dist/validate.js:614-619`, citing AEAT validation §3.1.3.1).
- **Q2 (owner): reports.** Does Waitron's VAT return count such a sale in its sale day's period, and
  does the accountant export (which lists only the issue date, `apps/server/src/accountant-export.ts:200-207`)
  show the sale day? VAT accrues «cuando se presten, ejecuten o efectúen las operaciones gravadas»
  (LIVA art. 75.Uno.2º, `docs/compliance/research/2026-10-27-a948-operation-date-and-b2b.md:72`);
  the owner's answer E already does this for a replaced sale (`packages/reporting/src/vat-return.ts:35-44`);
  and A444's reason was that invoices, AEAT and reports use the same dates
  (`docs/backlog/fiscal.md:1097-1098`). **Recommended: yes to both** (Task 6).

## Review focus

1. Same meal past midnight: live card started 23:58, issued 00:01 → no second date. Task 4.
2. Clocks go back: paid 25 Oct 2026 00:30 summer time (24 Oct 22:30Z), recovered 26 Oct 10:00 → `2026-10-25`; the issue offset would say the 24th. Task 3.
3. Process zone ≠ venue zone (`TZ=UTC`; Canary venue `Atlantic/Canary`): the day comes from `readIssueZone`. Task 3.
4. Year end across a rate change: paid 31 Dec 2026 23:50, recovered 1 Jan 2027 09:10 → `FechaOperacion` 31-12-2026, lines at 2026's rates, invoice identity and QR keep 01-01-2027, reconcile month 2026-12. Tasks 1 and 3.
5. A reprint days later shows the same "Date of the sale" (from `sales.supply_day`); a refund credit note of that sale shows none. Task 3.

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

- [ ] Failing tests (Europe/Madrid, `useVenueDb`, `created_at` written explicitly, fake issue clock):
  the owner's example — card row created `2026-03-14T22:50:00Z`, recovered `2026-03-15T08:10:00Z` →
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

- [ ] Failing tests (`created_at` explicit, fake issue clock): bill payment accepted 23:50 on 14 March,
  completed by the loop 09:10 on 15 March → `2026-03-14`; attestation (bill row 09:10, card row
  23:50) → `2026-03-14`; manager outcome route → `2026-03-14`; live reader answer across midnight →
  none; payments on the 14th 23:00 and the 15th 08:00, completed by the loop on the 15th → none;
  D1's example → none.
- [ ] Run → FAIL. Implement. Re-run; fiscal gate. `git commit -s`.

### Task 6: reports (Q2) and the docs that go stale

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

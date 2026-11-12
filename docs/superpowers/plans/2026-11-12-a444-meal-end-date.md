# A444, revised: a full invoice carries the day the bill closed

Status: **awaiting clearance. The owner clears decisions 2, 5, 7 and 8; the watcher clears 1, 3, 4
and 6. Build nothing before then.** Replaces the [27 October plan](2026-10-27-a444-meal-completion-date.md);
the [spec](../specs/2026-10-27-a444-meal-completion-date-design.md) holds except where a decision
says otherwise. Main input: the re-map `~/waitron-campaign-l/receipts/a444-remap-20261112.md`
(at `3dc5acd83a`); this plan is at `dab79e12cf`, revised after a fresh-context review.

**Where the approvals live.** The owner's rule and the H2 permission ("the grant"):
`~/waitron-campaign-e/archive/questions-to-20261108.md:578–602` (27 Oct, 07:45 and ~12:00). The
watcher's instruction for this plan: `~/waitron-campaign-l/questions.md:1037–1038` (12 Nov, 08:06).

**RUN** means a command was run and its output read; **READ** means source was read only. #2919
moved lines in four server files this plan names (re-located here); under `packages/` it and #2920
changed only `ui` tests and `db`'s mutation costs (RUN: `git diff --stat 3dc5acd83a dab79e12cf -- packages`).

## What changes for people

Staff see nothing new: no date to pick, no question to answer, no new button.

A full invoice (an F1, the kind with the customer's tax details) for a meal open across midnight
will carry, on paper and at AEAT, the day the bill closed. The owner's rule: the bill closes at the
**earliest** of the final payment being accepted by the server (before the card reader answers),
the first full invoice being issued, an edit that settles the balance, or an accepted unpaid
departure. Asking for the bill never counts.

**The bug today.** A table's full invoice saves the day the bill was **opened**
(`packages/core/src/record-sale.ts:276–293`, READ; the three cases at `record-sale.test.ts:2016–2052`
pass, RUN by the re-map). The receipt, A4 invoice, email and till print it as the "operation date"
when it differs from the issue day (`receipt-issuer.ts:55–57`, `invoice-document.ts:174`,
`receipt-document.ts:254`, till `till-ticket-view.ts:1220`, READ). AEAT never receives it: the
backend call carries none (`record-sale.ts:351–364`, READ) and the record mapping refuses
`FechaOperacion` (`packages/fiscal-verifactu/src/registro-row.ts:120`, READ). A table opened at
23:30 and invoiced at 00:10 prints a date the filed record does not contain. Table full invoices are
switched on (`docs/backlog.md:280`, READ), so this is live.

## The design

**Only one case needs a stored date:** the final payment is accepted before midnight and the invoice
is issued after it. Every other close issues in the transaction that closes the bill, so its day is
the issue day (re-map Summary 4): cash (`takeBillPayment`, `bill-payments.ts:1277`), settling edits,
unpaid departure (`unpaid-departure.ts:152`) and close-by-transfer (`transfer-close.ts:164`), READ.
A card that is captured also issues in the capture's own transaction (`completeBillPayment` calls
`issueWhenFullyPaid` at `bill-payments.ts:1505`, READ), so "captured" and "issued" share a time below.

- **Capture.** When `beginBillPayment` (`bill-payments.ts:1153`, READ) accepts a payment that leaves
  nothing owed once every received and pending payment is counted, and the meal is complete, it
  writes three things on that `bill_payments` row: the acceptance instant, its venue day, and a
  **service print** (a hash of every active line of the party's bills with its quantity and
  cancelled quantity, built with `fingerprint`, `parties.ts:928`, READ). The row is inserted after
  every admission check and before the reader starts (`:1217–1235`, READ); the guard trigger
  freezes its identity columns (`packages/db/triggers/core.sql:98–134`, READ) and will freeze these.
- **The venue day comes from the saved venue zone**, through `prepareIssueClock`
  (`packages/fiscal/src/issue-clock.ts:14–28`, READ), as `transfer-close.ts:97` does. The raw server
  reading carries the **process** zone's offset (`till-backend.ts:21`, READ) and `deploy/Dockerfile`
  sets no `TZ` (READ: its `ENV` lines), so the raw offset is never used.
- **Use at issue** (`issueWhenFullyPaid`, `:686`; `recordSale` at `:760`, READ). If the meal is
  complete, take the bill's payment rows **in any state** (received, failed, declined) that carry a
  day and whose service print equals the party's print now; use the one with the **earliest saved
  instant**. If none matches, or the meal is not complete, use the issue day (decision 5).
  This follows the owner's "earliest close" rule and the spec's "a repeated close command … retains
  the earliest snapshot unless service actually resumed" (spec, "Capture automatically"): a retry
  after a decline keeps the first day; a new dish changes the print, so a resumed meal takes the
  new final payment's day.
- **A card captured short** stays `received` with `remaining_after` above zero, set at capture
  (`bill-payments.ts:1478–1499`, READ). It keeps its day; the payment that tops it up is the new
  final payment, and the earliest matching day still wins.
- **Edits are refused per bill while a card is pending** (`order-drafts.ts:160`, `:300` pass
  `[billId]` to `refusePaymentInFlight`, `working-order.ts:5372`, READ), but completeness is
  party-wide. A sibling bill can take a dessert meanwhile; its print change makes the stored day
  inapplicable and the meal is no longer complete. Accepted, and tested in Task 2.4.
- **Departure from the spec (decision 2).** The spec kept the snapshot on the bill
  (`working_orders.meal_completion`) with clearing rules for split, merge, move and new dishes and a
  new in-flight refusal: 500–700 more lines (re-map). The print replaces those rules.
- **#2919.** `beginBillPayment` now also admits a sent counter order or presented bill
  (`bill-payments.ts:1189`, `:1198–1200`, READ); Task 2.3 tests a presented bill. Counter full
  invoices stay refused (`till-sale.ts:558`, `working-order.ts:4248`, READ).
- **Cancellations.** A cancellation record has no operation date, and its row cannot be given one:
  `chain.ts:224` builds the row from the record (READ), and the grant excludes chain code. So the
  period readers take a cancellation's day from the same invoice's alta (matched by `sale_id`, as
  `reconcile.ts:297`'s `sameInvoice` already joins, READ). The cancellation's body is unchanged:
  `FechaExpedicionFacturaAnulada` stays the original's issue date (`backend.ts:490–496`, READ).

## Pull requests

Each leaves main working, is under 400 production lines, and rebuilds a starting migration, so each
needs a venue reset and a title starting "Reset test venues:", as #2804 did (RUN: `git log -- packages/db/drizzle`).

**PR 1, the fiscal path.** An optional, trusted operation day travels from the sale to the stored
record, to AEAT as `FechaOperacion`, and into every period reader. No caller passes it, so every
record, receipt and query stays as today. **Usable when it lands:** nothing visible.

**PR 2, capture and use.** **Usable when it lands:** the whole feature; it deletes the A444
backlog entries (`docs/backlog.md:237`, `docs/backlog/fiscal.md:11`).

## Process

- One `subagent_type: "implementer"` per task (the old "inline, no agents" line is retired by the
  global rule). Fiscal is a risk trigger: a fresh-context plan review before the first dispatch, a
  per-task review, `/finish-branch`'s full wave with **two** Codex run-it angles; the watcher may add
  Fable in lane M. The owner lands every PR.
- Every task: tests first, watched failing on the **behaviour**; least code; rerun with a nonzero
  `Tests` count and checked exit; `git diff --check`; `git commit -s`. Every bill in a test opens the
  day **before** the expected operation day, so today's opening-day value cannot pass it.
- Never edited: `computeHuella`, chain code, numbering, the library's record builders,
  `registerSif`/`restoreFiscal`, historical sales, `classification.ts` (it makes
  `registros_facturacion` append-only, `:6`, READ), and protected tests, except the lines decision 8 names.

**The fiscal gate**, at the end of every task in both PRs and again before finish:

```sh
git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/classification.ts packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/registro-sif.ts packages/db/src/allocate-number.ts   # expect no output
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

**After each baseline rebuild** (Tasks 1.2, 2.1), the root CLAUDE.md §3 list:
`pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`.
On a rebase conflict in a starting migration, take main's copy and rerun the rebuild. If A1308's
rename of `registros_facturacion` to `verifactu_records` lands first (`docs/superpowers/specs/2026-11-02-rationalisation/tables-fiscal.md:654`, READ), use the new name.

## Test times (Europe/Madrid unless named)

| Case | Accepted | Issued | Operation day / `FechaOperacion` |
| --- | --- | --- | --- |
| Across midnight | 27 Oct 2026 23:55 (22:55Z) | 28 Oct 00:05 | 2026-10-27 / `27-10-2026` |
| Same day | 28 Oct 00:05 | 28 Oct 00:05 | 2026-10-28 / omitted |
| Clocks go back (25 Oct) | 25 Oct 00:30 summer time (24 Oct 22:30Z) | 25 Oct 03:30 winter time | 2026-10-25 / omitted; the issue offset would give 24 |
| Server in UTC (`TZ=UTC`) | 28 Oct 00:30 (27 Oct 23:30Z) | 28 Oct 00:30 | 2026-10-28 / omitted; the process zone would give 27 |
| Month end | 31 Oct 23:55 | 1 Nov 00:05 | 2026-10-31; consultation period 2026/10 |
| Year end | 31 Dec 2026 23:55 | 1 Jan 2027 00:05 | 2026-12-31; 2026/12; invoice id and QR keep 01-01-2027 |
| Canary venue | 27 Oct 23:55 WET (23:55Z) | 28 Oct 00:05 | 2026-10-27 (Madrid's day would be 28) |

**Conversion control.** The library shifts a `Date` by the **issue** offset before formatting
(`dist/records.js:99–100`, `format.js:108–111`, READ); the re-map RAN UTC midnight `2026-10-27T00:00Z`
at offset −60 and got `26-10-2026`. The converter must give `27-10-2026` at −60, 0, +60 and +120;
reuse the "midnight UTC minus the issue offset" anchor at `backend.ts:490–495` (READ).

## PR 1 tasks (branch `a444-fiscal-operation-day`)

**1.1 The sale accepts a trusted day.** Files: `packages/fiscal/src/backend.ts` (`SaleForFiscalRecord`
`:97–114`: `operationDate?: string`), `packages/core/src/record-sale.ts` (`RecordSaleInput` `:62`),
`packages/core/src/errors.ts` (`sale.operation_date_invalid`), `record-sale.test.ts`.
- Red: a bill opened 26 Oct, an F1 given `2026-10-27` and issued 28 Oct 00:05 saves `2026-10-27` and
  hands the backend that day; refusals for `2026-02-30`, `27-10-2026`, a day after the issue day, and
  any day on an F2. The cases at `:2016–2052` stay unedited and green.
- `pnpm --filter @waitron/core exec vitest run src/record-sale.test.ts`; `pnpm --filter @waitron/core typecheck`; `pnpm --filter @waitron/fiscal typecheck`.

**1.2 The record stores and sends it.** Files: `schema/registros.ts` (nullable `fecha_operacion` by
`:66`), `registro-row.ts` (drop it from the refused list `:120`; map it in `:111` and `:350`),
`backend.ts` (`recordSale` `:314–371`: set `AltaInput.FechaOperacion` only when the day differs),
the fiscal starting migration. New `src/operation-date.test.ts`; added cases only in
`registro-row.roundtrip.test.ts`. **Changed assertions (decision 8):** in
`record-payload-admission.test.ts`, the `FechaOperacion` entry at `:35` goes, and the correction case
at `:129–137` expects `["Cupon"]` alone. All READ.
- Red, through the real backend and store: across midnight files `27-10-2026` and stores
  `2026-10-27`, and `fromRegistroRow` returns it after the database is closed and reopened; same day
  omits it and stores null; the conversion control; equal `Huella` with and without the field (the
  re-map RAN this on library 0.2.1; `dist/validate.js:403–412` lists the hash inputs, READ).
- Rebuild: `pnpm --filter @waitron/fiscal-verifactu db:generate` (`--set fiscal-verifactu`,
  `package.json:15`, READ). The append-only trigger is table-wide; no trigger change (re-map, READ).
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/operation-date.test.ts src/registro-row.roundtrip.test.ts src/record-payload-admission.test.ts`, the guards, the gate.

**1.3 Every period reader follows the operation day.** Files: `drain.ts` (`routeB` `:1749`),
`reconcile.ts` (`rowsForPeriod` `:278`), and, if decision 7 is cleared, `reconcile-sweep.ts:47` (the
months to reconcile) and `reconcile-series.ts:47` (the local list it compares with AEAT's). Each uses
the alta's `fecha_operacion`, a cancellation's from its invoice's alta, else `fecha_expedicion_factura`.
New `src/operation-date.periods.test.ts`; added cases only in `reconcile.period.test.ts`. All READ.
- Red, synthetic AEAT replies through the real client: month end and year end are queried under
  2026/10 and 2026/12; the sweep visits 2026/12 when the only December operation was issued 1 Jan;
  a cancellation of the year-end invoice made on 2 Jan 2027 reconciles under 2026/12 with no
  incident and no resubmission; the series check raises no gap; an F2 and a same-day F1 keep the
  issue month. That AEAT files the cancellation under the operation period is the reviewer's reading
  of the spec's §6.4 source; only the synthetic test checks it.
- Cut the "records never carry `FechaOperacion`" comments (`drain.ts:1746–1747`, `reconcile.ts:269–270`);
  run `rg -n 'FechaOperacion|operation month|expedition month' apps packages docs` and fix every sentence made false.
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/operation-date.periods.test.ts src/reconcile.period.test.ts src/drain.test.ts`, the gate.

**1.4 A correction resend keeps the day (only if decision 8 is cleared).** `record-remedy-http.ts`
(the subsanación, AEAT's word for re-sending a corrected record) rebuilds the record field by field
from `fromRegistroRow` (`:115`, `:164–202`, READ) and has no `FechaOperacion` line, so it would drop
the day. Add that line through its `day()` helper (`:124–127`). Test: a dated invoice's resend
files `27-10-2026`. `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/record-remedy-http.test.ts`, the gate.

## PR 2 tasks (branch `a444-close-day`, after PR 1 lands)

**2.1 The payment row can hold a close.** Files: `packages/db/src/schema/bill-payments.ts`
(`meal_ended_at`, `meal_end_date`, `meal_service_print`, all three or none, by CHECK), `core.sql`
(`bill_payments_guard_update`: all frozen, in every state change), the core starting migration;
added cases in `src/schema/bill-payments.test.ts`. The red here is the missing column; accepted for
a schema-only task. Rebuild: `pnpm --filter @waitron/db db:generate` (`--set core`,
`packages/db/package.json:29`, READ). `pnpm --filter @waitron/db exec vitest run src/schema/bill-payments.test.ts`, the guards.

**2.2 Completeness, print and day.** New `apps/server/src/meal-completion.ts` and test:
`mealServiceState` from `partyFamily`/`readFamilyBills` (`parties.ts:495`, `:870`), `readBillUnsent`
(`bill-unsent.ts:8`) and `serviceQuantities`/`readLineCancellations` (`line-service-state.ts:20`, `:51`),
all READ; `servicePrint`; and the venue day of a reading through `prepareIssueClock` and
`localCalendarDate` (`issue-moment.ts:25`, READ). Red: unserved dish, held course, unsent draft, or an
unserved dish on a settled sibling bill → continuing; the print changes on a new or cancelled dish
but not on a price cut; the clocks-go-back, `TZ=UTC` and Canary rows. `pnpm --filter @waitron/server exec vitest run src/meal-completion.test.ts`.

**2.3 Capture.** `beginBillPayment`; new `src/meal-completion.capture.test.ts`. Red: a final cash or
card payment of a complete meal writes all three; a share that leaves money owed writes none; two
cards begun 23:50 and 23:55 (the second leaves nothing owed) → only the second carries a day; a
presented bill (#2919) carries one; an unserved dish → none.
`pnpm --filter @waitron/server exec vitest run src/meal-completion.capture.test.ts src/bill-payments.card.test.ts src/placed-order-one-payment.test.ts`, the gate.

**2.4 Use at issue.** `issueWhenFullyPaid`; new `src/meal-completion.issue.test.ts`, each asserting
the sale's day, the backend's day and the printed ticket:
- card accepted 23:55, captured and issued 00:05 → 27 and 28, both printed; the same through the
  pending loop after a restart on 29 Oct, and through attestation → 27, one charge, one invoice;
- card declined 23:58, second card accepted and captured 00:05, no new dish → 27 (decision 2);
- declined 23:58, dessert sent and served, new final payment 00:15 → 28;
- captured short at 23:57, rest in cash 00:20 → 27 (decision 2);
- the two cards of Task 2.3 captured in reverse order → 27;
- a sibling bill takes a dessert while the card is pending → incomplete-meal result (decision 5);
- bill requested 23:50, cash final payment 00:05 → 28, nothing extra printed;
- settling price cut at 00:10 on a complete, part-paid bill with no dated row → 28.
Rerun unedited: `bill-payments-loop`, `bill-payments.issue-clock`, `bill-payments.in-flight`,
`adjustments-bill-payments` (exist, RUN: `ls`).
`pnpm --filter @waitron/server exec vitest run src/meal-completion.issue.test.ts src/bill-payments-loop.test.ts src/bill-payments.issue-clock.test.ts src/bill-payments.in-flight.test.ts src/adjustments-bill-payments.test.ts`, the gate.

**2.5 Unpaid departure and transfer close.** `issueUnpaidInvoice` (`working-order.ts:7024`); added
cases in `unpaid-departure.test.ts`, `transfer-close.test.ts`. Red: bill opened 27 Oct 23:30,
departure accepted 28 Oct 00:10 → 28, nothing extra printed; collection on 30 Oct adds no date; the
same for a transfer close; an unserved dish → decision 5's result.
`pnpm --filter @waitron/server exec vitest run src/unpaid-departure.test.ts src/transfer-close.test.ts`, the gate. Delete the backlog entries.

## Decisions

1. **Watcher: split into two PRs**, superseding the old "one complete fiscal PR, no partial
   publication" line. PR 1 changes no receipt and no filing. Default: split. Example: after PR 1, a
   meal closed 23:55 and invoiced 00:05 prints and files exactly as today.
2. **Owner: the earliest close holds until service changes.** Default: yes, as designed above.
   Example A: card declined 23:58, second card accepted 00:05, no new dish → 27 Oct. Example B: card
   captured short 23:57, rest paid in cash 00:20 → 27 Oct. The alternative, "the last payment's day",
   gives 28 Oct in both and is simpler by one column.
3. **Watcher: close-by-transfer (A275) is a close**, like unpaid departure. Default: yes; it issues
   in the same transaction, so nothing changes. Example: closed by transfer 00:20 → 28 Oct.
4. **Watcher: rebuilding the fiscal set's starting migration is inside the grant.** Root CLAUDE.md
   §3: before go-live "a schema change rebuilds the set's one starting migration, never a new
   migration". The grant's "new migration" and "no shipped migrations" were written under the old
   rule. Default: yes. Example: PR 1 adds one nullable column to `0000_baseline.sql`; boxes reset.
5. **Owner: what an incomplete meal's full invoice prints.** Today it saves and prints the opening
   day, which AEAT never receives. Default (recommended): the issue day, so paper and filing agree
   and nothing is filed. Example: opened 27 Oct 23:30, paid 28 Oct 00:10 with a dessert unserved →
   today prints "operation date 27 Oct"; recommended prints none. The opening day is not when the
   meal ended under the owner's rule either.
6. **Watcher: "complete" means every dish served or cancelled.** Payment marks nothing served; staff
   do (`markServed`, `markGroupServed`, `working-order.ts:3684`, `:3770`, READ). Default: keep the
   spec's rule. Example: where staff never tap "served", a card accepted 23:55 and captured 00:05
   files 28 Oct; with decision 5's default, paper and filing still agree.
7. **Owner: `reconcile-sweep.ts` and `reconcile-series.ts` are inside the grant.** The grant names
   `drain.ts` and `reconcile.ts` "consultation periods"; these two files choose which periods to
   consult and compare a period's local records with AEAT's, so they are the same periods, but the
   grant does not name the files. Default: yes. Example: without them, the year-end invoice is
   checked under January and shows as missing.
8. **Owner: the changed fiscal assertions and the correction resend.** (a) In
   `record-payload-admission.test.ts`, delete the `FechaOperacion` row at `:35` and change `:137`'s
   expected fields from `["FechaOperacion", "Cupon"]` to `["Cupon"]`. (b) Let a resend carry the
   day (Task 1.4, `record-remedy-http.ts`, outside the grant). AEAT lists, as content of an alta
   record, «la fecha en que se hayan efectuado las operaciones» «si son distintas a la de expedición
   de la factura» (spec's source table, AEAT alta-content page, item 5, checked 27 Oct; not
   re-fetched); a resend is an alta. Default: yes to both. Example: a dated invoice rejected and
   resent on 3 Nov still files `27-10-2026`. R5/F3 corrections stay unchanged, as the spec says.

## Size (estimates, not measured)

| PR | Production | Tests | Generated | Docs |
| --- | --- | --- | --- | --- |
| 1, fiscal path | 130–180 | 400–550 | 15–40 | about 10 |
| 2, capture and use | 200–280 | 700–900 | 15–40 | about 10 (backlog) |
| Total | 330–460 | 1,100–1,450 | 30–80 | about 20, plus this plan |

No guide text: root CLAUDE.md §3 keeps a guide sentence only if it changes what staff do. No
data-fault code: a payment without a matching day means the bill closed at issue. "Generated" is
each rebuilt `0000_baseline.sql`, its snapshot and journal, and `scripts/migration-baseline-epoch.json`.

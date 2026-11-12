# A444, revised: a full invoice carries the day the bill closed

Status: **awaiting the watcher's clearance of decisions 1, 2 and 4. Build nothing before then.**
Replaces the [27 October plan](2026-10-27-a444-meal-completion-date.md). The
[spec](../specs/2026-10-27-a444-meal-completion-date-design.md) still holds except where decision 2
says otherwise. Main input: the re-map `~/waitron-campaign-l/receipts/a444-remap-20261112.md`, taken
at `3dc5acd83a`. This plan is written at `dab79e12cf`.

**RUN** means a command was run and its output read; **READ** means source was read only. #2919
moved lines in four server files this plan names (re-located here); under `packages/` it and #2920
changed only `ui` tests and `db`'s mutation costs (RUN: `git diff --stat 3dc5acd83a dab79e12cf -- packages`).

## What changes for people

Staff see nothing new: no date to pick, no question to answer, no new button.

A full invoice (an F1, the kind with the customer's tax details) for a meal that was open across
midnight will carry, on paper and at AEAT, the day the bill closed. "Closed" is the owner's rule from
27 October: the earliest of the final payment being accepted, the first full invoice being issued, an
edit that settles the balance, or an accepted unpaid departure. Asking for the bill never counts.

**The bug today.** A table's full invoice saves the day the bill was **opened**
(`packages/core/src/record-sale.ts:276–293`, READ; the three cases at `record-sale.test.ts:2016–2052`
pass, RUN by the re-map). The receipt, A4 invoice, email and till print that day as the "operation
date" whenever it differs from the issue day (`receipt-issuer.ts:55–57`, `invoice-document.ts:174`,
`receipt-document.ts:254`, till `till-ticket-view.ts:1220`, READ). AEAT never receives it: the backend
call carries no operation date (`record-sale.ts:351–364`, READ) and the record mapping refuses
`FechaOperacion` (`packages/fiscal-verifactu/src/registro-row.ts:120`, READ). So a table opened at
23:30 and invoiced at 00:10 prints yesterday's date that the filed record does not contain. Table
full invoices are switched on (`docs/backlog.md:280`, READ), so this is live behaviour.

## The design, and where it departs from the spec

Only one case needs a stored date: the final payment is **accepted before midnight and the invoice is
issued after it**: a card still at the reader at midnight, or recovered after a restart or by a
manager's attestation. Every other close issues in the transaction that closes the bill, so its day
**is** the issue day (re-map Summary 4): cash (`takeBillPayment`, `bill-payments.ts:1277`), settling
edits, unpaid departure (`unpaid-departure.ts:152`) and close-by-transfer (`transfer-close.ts:164`), READ.

- **Save the close moment on the final payment row.** When `beginBillPayment`
  (`bill-payments.ts:1153`, READ) accepts a payment that leaves nothing owed once every received and
  pending payment is counted, and the meal is complete, it writes the acceptance reading's instant
  and venue day into two new nullable columns on `bill_payments`. The row is inserted after every
  admission check and before the card reader starts (`:1217–1235`, READ), and its guard trigger
  already freezes the other identity columns (`packages/db/triggers/core.sql:98–134`, READ).
- **Use it at issue.** `issueWhenFullyPaid` (`bill-payments.ts:686`, `recordSale` at `:760`, READ) is
  the one place a paid table bill becomes an invoice: cash, card, the pending loop, attestation and
  every settling edit reach it. If the meal is complete, it passes the day saved on the bill's last
  accepted received payment, or else the issue day. `issueUnpaidInvoice` (`working-order.ts:7024`,
  READ) passes the issue day for a complete meal.
- **"Complete meal"** keeps the spec's rule: no unsent draft on any bill of the party, and every
  active dish served or cancelled (`serviceQuantities`, `line-service-state.ts:20`, READ). A meal still
  in service keeps today's behaviour (decision 5).
- **Departure from the spec (decision 2).** The spec kept a snapshot on the bill
  (`working_orders.meal_completion`), with rules to clear it on split, merge, move or a new dish and a
  new `meal.completion_in_flight` refusal: 500–700 more lines (re-map). On the payment row none of it
  is needed: a declined card is never read, a resumed meal needs a new final payment with its own
  reading, and edits are already refused while a card is pending (`refusePaymentInFlight`,
  `working-order.ts:5372`; `requireUntouched`, `bill-actions.ts:68–80`; READ).
- **#2919.** `beginBillPayment` now also admits a sent counter order or presented bill
  (`bill-payments.ts:1189`, `:1198–1200`, READ); Task 2.3 tests a presented bill. Counter full
  invoices stay refused (`till-sale.ts:558`, `working-order.ts:4248`, READ).

## Pull requests

Each leaves main working, is under 400 production lines, and needs a venue reset because it rebuilds
a starting migration. Its title starts "Reset test venues:", as #2804 did (RUN: `git log -- packages/db/drizzle`).

**PR 1, the fiscal path (H2 files only).** An optional, trusted operation day travels from the sale
to the stored record, to AEAT as `FechaOperacion`, and into the consultation and reconciliation
periods, including a cancellation's original period. No caller passes it, so every record, receipt
and query stays as today. **Usable when it lands:** nothing visible; PR 2 builds on it.

**PR 2, capture and use.** The close day is saved on the final payment and handed to the sale.
**Usable when it lands:** the whole feature; it deletes the A444 backlog entries
(`docs/backlog.md:237`, `docs/backlog/fiscal.md:11`).

## Process

- One `subagent_type: "implementer"` per task (the old "inline, no agents" line is retired by the
  global rule). Fiscal is a risk trigger: a fresh-context plan review before the first dispatch, a
  per-task review, `/finish-branch`'s full wave with **two** Codex run-it angles; the watcher may add
  Fable in lane M. The owner lands every PR.
- Every task: tests first, watched failing on the **behaviour** (a missing column is not the red);
  least code; rerun with a nonzero `Tests` count and checked exit; `git diff --check`; `git commit -s`.
- Never edited, in either PR: `computeHuella`, chain code, numbering and allocation, the library's
  record builders, `registerSif`/`restoreFiscal`, historical sales, `packages/fiscal-verifactu/src/classification.ts`
  (it makes `registros_facturacion` append-only, `:6`, READ), and the protected tests.

**The fiscal gate**, run at the end of every task in both PRs and again before finish:

```sh
git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/classification.ts   # expect no output
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

**After each baseline rebuild** (Tasks 1.2, 2.1), the CLAUDE.md §3 list (inmutabilidad is in the gate):
`pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`.
On a rebase conflict in a starting migration, take main's copy and rerun the rebuild. If A1308's
rename of `registros_facturacion` to `verifactu_records` lands first (`docs/superpowers/specs/2026-11-02-rationalisation/tables-fiscal.md:654`, READ), use the new name.

## Test times (Europe/Madrid unless named)

| Case | Accepted | Issued | Operation day / `FechaOperacion` |
| --- | --- | --- | --- |
| Across midnight | 27 Oct 2026 23:55 (+01:00, 22:55Z) | 28 Oct 00:10 | 2026-10-27 / `27-10-2026` |
| Same day | 28 Oct 00:05 | 28 Oct 00:10 | 2026-10-28 / omitted |
| Clocks go back (25 Oct 2026, 03:00 CEST becomes 02:00 CET) | 24 Oct 23:55 (+02:00, 21:55Z) | 25 Oct 03:30 (+01:00) | 2026-10-24 / `24-10-2026` |
| Month end | 31 Oct 23:55 | 1 Nov 00:10 | 2026-10-31; consultation period 2026/10 |
| Year end | 31 Dec 2026 23:55 | 1 Jan 2027 00:05 | 2026-12-31; period 2026/12; invoice id and QR keep 01-01-2027 |
| Canary venue (`Atlantic/Canary`) | 27 Oct 23:55 WET (23:55Z; 00:55 in Madrid) | 28 Oct 00:10 | 2026-10-27 |

**Conversion control.** The library shifts a `Date` by the **issue** offset before formatting
(`dist/records.js:99–100`, `format.js:108–111`, READ); the re-map RAN UTC midnight `2026-10-27T00:00Z`
at offset −60 and got `26-10-2026`. The converter must give `27-10-2026` at −60, 0, +60 and +120;
reuse the "midnight UTC minus the issue offset" anchor the cancellation path uses (`backend.ts:490–495`, READ).

## PR 1 tasks (branch `a444-fiscal-operation-day`)

### Task 1.1: the sale accepts a trusted operation day

Files: `packages/fiscal/src/backend.ts` (`SaleForFiscalRecord`, `:97–114`, READ: add
`operationDate?: string`), `packages/core/src/record-sale.ts` (`RecordSaleInput`, `:62`),
`packages/core/src/errors.ts` (one code, `sale.operation_date_invalid`), `record-sale.test.ts`.

- Red, in a new `describe` in `record-sale.test.ts`: an F1 given `2026-10-27` and issued 28 Oct 00:10
  saves `2026-10-27` and hands the backend `operationDate: "2026-10-27"`; refusals with the domain
  code for `2026-02-30`, `27-10-2026`, a day after the issue day, and any day on an F2.
- The three opening-day cases at `:2016–2052` stay **unedited** and green: with no day supplied the
  opening-day default and the backend call are unchanged.
- `pnpm --filter @waitron/core exec vitest run src/record-sale.test.ts`, then
  `pnpm --filter @waitron/core typecheck` and `pnpm --filter @waitron/fiscal typecheck`.

### Task 1.2: the record stores and sends it

Files: `packages/fiscal-verifactu/src/schema/registros.ts` (nullable `fecha_operacion`, next to
`fecha_expedicion_factura` at `:66`), `registro-row.ts` (drop `FechaOperacion` from the refused list
at `:120`; map it in `toRegistroRow` `:111` and `fromRegistroRow` `:350`), `backend.ts` (`recordSale`
`:314–371`: set `AltaInput.FechaOperacion` only when the day differs from the issue day), the fiscal
starting migration. New `src/operation-date.test.ts`; additional cases only in
`registro-row.roundtrip.test.ts`. All READ.

- Red, through the real backend and store: the across-midnight case files `27-10-2026`, stores
  `2026-10-27`, and after closing and reopening the database `fromRegistroRow` gives it back; the
  same-day case omits the field and stores null; the clocks-go-back case; the conversion control at
  four offsets.
- Fingerprint: the same record with and without `FechaOperacion` has the same `Huella` (the re-map
  RAN this against the installed library 0.2.1; `dist/validate.js:403–412` lists the inputs, READ).
- Rebuild: `pnpm --filter @waitron/fiscal-verifactu db:generate` (which runs
  `migration-baseline rebuild --set fiscal-verifactu`, `packages/fiscal-verifactu/package.json:15`, READ).
  The append-only trigger is table-wide, so a new column needs no trigger change (re-map, READ).
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/operation-date.test.ts src/registro-row.roundtrip.test.ts`,
  then the migration guards and the fiscal gate.

### Task 1.3: periods follow the operation day

Files: `drain.ts` (`routeB`, `:1741–1765`), `reconcile.ts` (`rowsForPeriod`, `:268–280`, as
`coalesce(fecha_operacion, fecha_expedicion_factura)`), `backend.ts:490–500` (a cancellation looks up
its original by the original's operation period). New `src/operation-date.periods.test.ts`;
additional cases only in `reconcile.period.test.ts`. All READ.

- Red, with synthetic AEAT HTTP replies through the real client: the month-end and year-end cases ask
  for 2026/10 and 2026/12 in the targeted query and reconciliation; cancelling the year-end invoice
  looks in 2026/12; an F2 and a same-day F1 still use the issue month.
- Cut the comments at `drain.ts:1746–1747` and `reconcile.ts:269–270` that say records never carry
  the field. Grep `rg -n 'FechaOperacion|operation month' apps packages docs` and fix every sentence
  this makes false.
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/operation-date.periods.test.ts src/reconcile.period.test.ts src/drain.test.ts`,
  then the fiscal gate.

## PR 2 tasks (branch `a444-close-day`, on main after PR 1 lands)

### Task 2.1: the payment row can hold a close day

Files: `packages/db/src/schema/bill-payments.ts` (`meal_ended_at`, the trusted instant, and
`meal_end_date`, the ISO venue day; both or neither, by CHECK), `packages/db/triggers/core.sql`
(`bill_payments_guard_update`, `:98–134`: both frozen, including on the pending-to-received move),
the core starting migration. Additional cases in `packages/db/src/schema/bill-payments.test.ts`.

- Red: a row inserted with both reads back; one without the other, or `2026-13-01`, is refused; any
  update to either column is refused, in every state change the trigger allows.
- Rebuild: `pnpm --filter @waitron/db db:generate` (`migration-baseline rebuild --set core`,
  `packages/db/package.json:29`, READ). `bill_payments` keeps its classification
  (`packages/db/src/classification.ts:84`, READ).
- `pnpm --filter @waitron/db exec vitest run src/schema/bill-payments.test.ts`, then the guards.

### Task 2.2: is the meal complete, and which day closes it

Files: new `apps/server/src/meal-completion.ts` and `.test.ts`. `mealServiceState(tx, billId)`
returns `"complete" | "continuing"` from the party's bills (`partyFamily` `parties.ts:495`,
`readFamilyBills` `:870`, abandoned bills left out), `readBillUnsent` (`bill-unsent.ts:8`) and
`serviceQuantities`/`readLineCancellations` (`line-service-state.ts:20`, `:51`), all READ. A second
function turns a trusted reading into the venue day.

- Red: an unserved dish, a held course, an unsent draft, or an unserved dish on a settled bill of the
  same party → continuing; all served, or the rest cancelled → complete.
- Unverified, so RUN first: is the reading's `offsetMinutes` the saved venue zone's? The Canary case
  must give 2026-10-27 under `TZ=Europe/Madrid`. Candidate: `localCalendarDate` (`issue-moment.ts:25`,
  READ); otherwise the saved zone, as `record-sale.ts:286–292` uses.
- `pnpm --filter @waitron/server exec vitest run src/meal-completion.test.ts`

### Task 2.3: capture at final payment, use at issue

Files: `bill-payments.ts` (`beginBillPayment` `:1153`, `issueWhenFullyPaid` `:686`), new
`src/meal-completion.issue.test.ts`.

- Red, each asserting the sale's `operationDate`, the backend's day and what the ticket prints:
  - card accepted 23:55, captured 00:05, issued 00:10 → 27 and 28, both printed; the same answered
    by the pending loop after a restart on 29 Oct, and by attestation → 27, one charge, one invoice;
  - bill requested 23:50, cash final payment 00:05 → 28, nothing extra printed;
  - card declined 23:50, dessert added and served, new final payment 00:15 → 28;
  - a share at 23:30, the rest by card accepted 23:55, captured 00:05 → 27; two guests' cards begun
    23:50 and 23:55 (the second leaves nothing owed), captured in the other order → 27;
  - a final card captured short at 23:57, the rest in cash at 00:20 → 28 (decision 2);
  - a presented bill (#2919) paid by card accepted 23:55, captured 00:05 → 27;
  - a settling price cut at 00:10 on a complete, part-paid bill → 28, nothing extra printed;
  - control: one dish unserved at 23:55 → no day saved, the opening-day default stands (decision 5).
- Rerun unedited: `bill-payments.card`, `bill-payments-loop`, `bill-payments.issue-clock`,
  `bill-payments.in-flight`, `adjustments-bill-payments`, `placed-order-one-payment` (exist, RUN: `ls`).
- `pnpm --filter @waitron/server exec vitest run src/meal-completion.issue.test.ts src/bill-payments.card.test.ts src/bill-payments-loop.test.ts src/bill-payments.issue-clock.test.ts src/bill-payments.in-flight.test.ts src/adjustments-bill-payments.test.ts src/placed-order-one-payment.test.ts`,
  then the fiscal gate.

### Task 2.4: unpaid departure and close-by-transfer

Files: `working-order.ts` (`issueUnpaidInvoice`, `:7024`), additional cases in
`unpaid-departure.test.ts` and `transfer-close.test.ts`.

- Red: a complete meal's unpaid departure accepted 28 Oct 00:10 on a bill opened 27 Oct 23:30 → 28,
  nothing extra printed; collection on 30 Oct creates no new date. The same for a transfer close.
  Control: an unserved dish keeps the opening day.
- `pnpm --filter @waitron/server exec vitest run src/unpaid-departure.test.ts src/transfer-close.test.ts`,
  then the fiscal gate. Delete the A444 backlog entries.

## Decisions for the watcher or owner

1. **Split into two PRs.** The old plan said "one complete fiscal PR, no partial publication",
   meant to stop a receipt-only change. PR 1 changes no receipt and no filing, so it is not that.
   **Default: split** (superseding that line only if cleared). Example: PR 1 lands; a meal closed
   23:55 and invoiced 00:10 still prints the opening day and files none, exactly as today.
2. **Store the close day on the final payment row, not on the bill.** **Default: the payment row**,
   using the day on the bill's last accepted payment. Example: a card captured short at 23:57 and
   topped up in cash at 00:20 files 28 Oct, though the owner's "earliest close" wording would say 27;
   the meal may have resumed in between, and checking that is the machinery this design drops.
3. **Close-by-transfer (A275) counts as a close, like unpaid departure.** **Default: yes**; it issues
   in the same transaction, so the answer changes nothing. Example: closed by transfer 00:20 → 28 Oct.
4. **Rebuilding the fiscal set's starting migration is inside the H2 grant.** The grant's "no shipped
   migrations" was written under the old rule; before go-live nothing is shipped and the rebuild is
   how a column is added. **Default: yes.** Example: PR 1 adds one nullable column to
   `packages/fiscal-verifactu/drizzle/0000_baseline.sql`, and boxes are reset.
5. **A meal still in service keeps today's behaviour** (the S3/A447 question). **Default: keep**, as
   the spec says. Example: opened 23:30, paid in full at 00:10 with a dessert unserved → the receipt
   still prints 27 Oct and AEAT still gets no date; that mismatch stays until S3 is decided.
6. **"Complete" means every dish marked served or cancelled.** Payment marks nothing served; staff
   actions do (`markServed`, `markGroupServed`, `working-order.ts:3684`, `:3770`, READ).
   **Default: keep the spec's rule.** Example: a venue whose staff never tap "served" sees no change
   from A444 on any table. Counting "sent to the kitchen" instead is a small change to Task 2.2.

## Size (estimates, not measured)

| PR | Production | Tests | Generated | Docs |
| --- | --- | --- | --- | --- |
| 1, fiscal path | 95–130 | 300–400 | 15–40 | about 10 (comments and claims) |
| 2, capture and use | 150–220 | 600–800 | 15–40 | about 10 (backlog deletions) |
| Total | 245–350 | 900–1,200 | 30–80 | about 20, plus this plan |

Below the re-map's 330–430: PR 2 needs no shared snapshot type, no data-fault code (a missing day
means the bill closed at issue), and no guide text, since root CLAUDE.md §3 keeps a guide sentence
only if it changes what staff do. "Generated" is each rebuilt `0000_baseline.sql`, its snapshot and
journal, and `scripts/migration-baseline-epoch.json`.

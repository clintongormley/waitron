# Plan: a bill still open when the trading day ends is issued then (ADVISER-CLOSE-OF-DAY-TICKET)

Status: written 2026-11-19, lane L, for a fresh read and then the watcher. Not built. FISCAL: the
owner lands it. Read at main `cb1aeeb7b2`. **READ** = code read at that commit; **RAN** = a command
was run and its output read. Unmarked reasoning is inference.

## For the owner

**The ask.** Your decision at the top of the adviser sheet: "A bill still open when the venue's
trading day ends is issued then (question 1). Nothing does this today"
(`docs/compliance/2026-11-19-adviser-meeting.md:10-11`), and your answers to question 1: the meal
ends "Whichever comes first: printing the bill; taking the last payment; close of trading day", and
"yes" to a never-printed bill being issued at the day's end showing the amount still owed (`:95-96`).

**What staff get.** A table left seated past the end of the trading day, whose bill was never
printed, never fully paid and never recorded as a walkout, gets its ticket a few seconds after the
day ends: for everything on the bill, showing any payments already taken and the amount still owed.
Nothing prints in the empty venue. Next shift, the till shows that bill as printed with the amount
owed, exactly as after **Print the bill**: staff take the payment with **Pay**, record a walkout,
or print the ticket from **Find a bill**. If the box was off when the day ended, it does this as it
starts. If it is waiting for its time to be confirmed, it does nothing until the time is confirmed,
then issues them.

**No STOP.** The work only calls the existing issue path (`issueUnpaidInvoice`, the one Print the
bill and the walkout use). It does not change the fingerprint (`computeHuella`), the chain, invoice
numbering, the record builders (`recordSale`, `recordCorrection`, `recordSubstitution`) or
`registros_facturacion`'s append-only triggers. D2's default does change one list of allowed values
in the fiscal package's database layout; that is why D2 is yours.

**Decisions** (default first; D1–D5 are yours, the rest the lane's, open to you):

- **D1. The date on the ticket.** Default: the moment it is issued, like every other ticket. On
  time, that is the day's end itself (Tuesday 05:00 for a Monday dinner), so the ticket carries one
  date, and its VAT and takings count in Tuesday's trading day. This matches the reading LATER-SALE-
  DATE (#3398) proposes for the other two moments: a meal's day is the calendar day of the moment it
  ended (#3398's amendment D1, branch `feat/later-sale-date` at `a20aed887b`,
  `docs/superpowers/plans/2026-11-15-later-sale-date.md`, "Amendment 2026-11-19" §7). A ticket
  issued late (the box off for days, or waiting for its time) is dated when issued, as main dates
  every late ticket today; carrying the close's day as a separate sale date needs the record's
  sale-date field (`FechaOperacion`), which only #3398 adds. So that is left to #3398: whichever
  lands second passes the close's moment into #3398's single dating seam (`issueOrderMoment`, which
  takes an optional "meal ended at", amendment §3). Alternative: every close-of-day ticket carries
  the trading day that ended (Monday). That needs `FechaOperacion` on every one of them and a seam
  that takes a day rather than a moment (Tuesday 04:59 is still Tuesday): #3398's work, not this.
- **D2. What the record names as having issued it.** Every sale and record names a source: a
  device, or one of three jobs (`packages/shared/src/origin.ts:22-27`), enforced by a check on
  `registros_facturacion` (RAN `git grep -n registros_facturacion_source_ck
  packages/fiscal-verifactu/drizzle/0000_baseline.sql` → line 307, `in ('device', 'demo_seed',
  'readiness_test', 'operator_script')`). No device acts at 05:00. Default: add one source,
  "close of trading day". Cost: four starting migrations are rebuilt (core, payments, workforce,
  fiscal-verifactu), which means every test venue is reset once and the pull request says so in
  its first line (`CLAUDE.md` §3, "Editing a shipped migration file"); the watcher confirms A1308's
  table hold (`docs/backlog.md:1605`) allows it. Alternative: no schema change; name the till that
  opened the table, or, for a table seated from Bookings (`parties.ts:166`, a `dashboard` source),
  the till that sent its first dishes. Records are permanent, so that would write, for ever, that a
  till issued a ticket it never touched.
- **D3. No printing at the close.** Default: nothing prints; staff print it from **Find a bill**
  when the guest comes back, and a later payment prints its slip (#3752). This is one of the "sales
  that never show the till's window" that #3835 (ADVISER-NO-NONE) leaves unprinted (its point 2).
  Whether ADVISER-TICKET-OWED-MARK should treat these tickets as owed (printing at the next
  payment) is that item's question.
- **D4. What it charges.** Default: everything still on the bill, as **Print anyway** does
  (`meal-end.ts:112-116` skips the unserved check only when asked), including a dish never marked
  served or held back and never sent to the kitchen. Many kitchens never mark dishes served, so
  leaving those out would issue near-empty tickets. A dish that was not eaten is put right with
  **Correct invoice**. Alternative: leave such a bill open and alert.
- **D5. Which bills.** Default: table bills only (bills on a seated party). A Counter order or
  takeaway not handed over is left alone: an order nobody collected is usually a sale that never
  happened, and staff cancel it as today. Alternative: issue those too.
- L1. One transaction per bill. A refusal on one bill never stops the others; nothing is ever
  issued twice (the sale is unique per bill: `sales_working_order_id_key`,
  `packages/db/src/schema/sales.ts:162`).
- L2. A bill whose money is still moving (a card in progress, a refund pending) is skipped and
  tried again a minute later; the payment may complete it first.
- L3. A bill that cannot be issued (for example a full invoice missing the venue's address) is
  logged, and the box's existing alert "The box keeps failing at …" (`job.failing`,
  `apps/server/src/alert-sources.ts:990-1023`, after three failing passes over ten minutes) reaches
  Box status; no new alert. Staff see the open bill on the floor and get the real reason from
  **Print the bill**.
- L4. The party stays seated; staff finish the table as today. Any unsent dishes in someone's
  draft stay in the draft (never deleted); the issued bill refuses them as it refuses any dish after
  Print the bill (`bill.presented`, `parties.ts:321`), so staff move them to a new bill or remove
  them.
- L5. The bill's person on the ticket is the one who seated the table (`parties.opened_by`,
  `packages/db/src/schema/parties.ts:32`); an order's placement record requires a person
  (`order-amendments.ts:34`, not null), as a card payment the box finishes later names whoever
  asked for it (`apps/server/src/bill-payments.ts:1602-1607`). No attendance is recorded for it.

**Size.** About 180 production lines written by hand (half of them one new file), plus about 50
generated lines in the four rebuilt starting migrations (D2), 12 lines of guide (English and
Spanish) and about 450 lines of tests. Small to medium; one pull request.

## What happens today

- **Nothing issues a bill at the day's end.** The issue paths are listed in #3398's amendment §2
  (re-swept there with `git grep` at `db6a22acc9`); its row G is exactly this bill, "nothing issues
  then on main". The sheet says the same (`adviser-meeting.md:10-11`).
- **Print the bill** (`apps/server/src/meal-end.ts:65-154`): checks the till can trade
  (`requireEconomicWrite`, `:88`) and the time is recordable (`refuseUntilRecordable`, `:90`),
  refuses a bill already issued (`:102-103`), one owing nothing (`:104-105`, `:127-128`) and money
  still moving (`refuseBillPaymentInFlight`, `:106`); prices the bill (`priceForIssuance`,
  `working-order.ts:7594`), files it unpaid (`issueUnpaidInvoice`, `working-order.ts:7628-7676`),
  marks it placed (`markOrderPlaced`, `:7695`), settles a €0.00 bill at once
  (`settleIssuedOwingNothing`, `meal-end.ts:142`) and prints (`:144-147`). A walkout on an already
  issued bill issues nothing new (`unpaid-departure.ts:107-135`), so once the close has issued a
  bill, a walkout recorded later keeps the close's ticket and date, as #3398's D2 asks.
- **The trading day.** The venue's day start (and dated changes to it) is read by `readVenueClock`
  (`packages/db/src/venue.ts:161`); `businessDayAt` and `businessDayBounds`
  (`packages/shared/src/business-day-clock.ts:104-124`) give today's trading day and its start and
  end. The attendance job already wakes on changes to it (`apps/server/src/attendance-loop.ts:58-77`,
  `wakeOn: ["day_cutover_changes", "settings.business_day", …]`).
- **Waiting for the time.** On a box that files, the fiscal seat refuses `clock.unconfirmed` from
  `refuseUntilRecordable` and from every record writer while the start waits for its time
  (`start-clock-gate.ts:8-14`, `:29-45`; built at `boot.ts:2533-2539`). The bill-payment loop stops
  its pass on that refusal and raises nothing (`bill-payments-loop.ts:166-181`).
- **Who may.** A restricted start returns before the job runner exists (`boot.ts:2203`, `:2332`;
  runner made at `:2749`). A mirror or fenced box does not sell (`selling`, `boot.ts:3041`). Only
  one process holds the venue folder (`CLAUDE.md` §3, "One process owns a venue folder").
- **No device, no printer.** A job source has no receipt printer: "the origin is a job rather than
  a device … the hooks enqueue nothing" (`receipt-print.ts:79-83`).

## Design

**When.** A new job, `bills.close_of_day`, on the existing runner. Each pass takes one reading of
the trusted clock, works out today's trading day, and finds every **due bill**: a bill on a party,
status `open` or `placed`, with no sale, at least one line, opened before today's trading day began
(`working_orders.opened_at < startAt`). It issues each, then asks to run again at today's end
(`endAt`). So it issues a few seconds after each day ends while running, and on the first pass after
a start that missed the end (the runner runs a job's first pass as it starts,
`job-runner.ts:206-218`). It wakes on the two tables
above, so a changed day start re-arms it, and the runner wakes it at least hourly
(`DEFAULT_MAX_TICK_MS`, `config.ts:123`).

**While the time waits.** If the clock gate holds (`startClockHolds`, passed in as
`clockUnconfirmed`), the pass writes nothing and asks to run again in 60 seconds. Inside each
bill's transaction the seat's own `refuseUntilRecordable` refuses too, so a gate that starts
holding mid-pass rolls that bill back and ends the pass the same way. When the time is confirmed,
the next pass (within a minute) issues every due bill, dated with the confirmed clock (D1). A bill
is due by the clock after confirmation, so a wrong clock never decides which bills are due.

**Who.** `applies`: this box is the primary, not a mirror, not fenced; the same conditions under
which a till may print a bill. The admission check (`requireEconomicWrite`) refusing
(`venue.time_zone_not_ready`) ends the pass quietly. Catalogue mark: stops at a stepdown.

**Each bill**, in its own `withIssuanceTransaction`: re-read the bill and skip it if no longer due;
`refuseUntilRecordable`; `refuseBillPaymentInFlight` (any refusal: skip, run again in 60 s); price
it; if it is fully paid but was not issued (only possible when an edit made it fully paid while a
draft was open, `bill-payments.ts:789`), issue it as a payment would (`issueIfFullyPaid` with
`moneyMoved: true`); otherwise `issueUnpaidInvoice`, `markOrderPlaced` when open, and
`settleIssuedOwingNothing` for €0.00; bump the party's revision so tills reload it; log
`close_of_day.issued`. A staged full invoice is issued as staged, its A4 or email delivery reserved
by `issueUnpaidInvoice` as for Print the bill. Nothing prints (D3).

**Later work that must include this caller.** ADVISER-ADVANCES (plan awaiting approval): the final
ticket's deduction of an advance must cover the close as it covers Print the bill and the walkout.
#3398: D1's seam. #3724, #3752 and #3835 need nothing from this; it does not touch `meal-end.ts`.

## Tasks

Each task: test first, watch it fail, then the code. After each task run its focused tests, the
golden fingerprint and immutability suites unedited, the package typecheck and prettier on the
changed files:

```
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
git diff --exit-code main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/triggers
pnpm --filter @waitron/server typecheck
pnpm exec prettier --check <changed files>
```

### Task 1. The "close of trading day" source (only if D2 stands)

Files: `packages/shared/src/origin.ts` (add `trading_day_close` to `SOURCES` and `SALE_SOURCES`),
`packages/shared/src/origin.test.ts`, `apps/dashboard/src/i18n/strings.ts` (`source.trading_day_close`
beside `:1246` and `:5922`: "Close of trading day" / "Cierre de la jornada"),
`apps/server/src/trading-context.ts` (a `SaleOriginConfig`: a trading context whose origin is a
`SaleOrigin`), and the parameter types of `issueUnpaidInvoice` (`working-order.ts:7631`) and
`issueIfFullyPaid`/`issueWhenFullyPaid` (`bill-payments.ts:920`, `:760`) widened from
`DeviceRequestConfig` to it. Their bodies should need no change (the helpers they call take a
trading context or any origin, e.g. `invoice-selection.ts:88`); if the typecheck finds one that
does, widen that callee's type only, never its behaviour. Rebuild the four starting migrations:
`pnpm --filter @waitron/server migration-baseline rebuild --set core`, then `--set payments`,
`--set workforce`, `--set fiscal-verifactu` (confirm the list with `git grep -ln sourceColumn --
'packages/*/src/schema/**'`).

- Failing tests first: in `origin.test.ts`, `isSaleOrigin(jobOrigin("trading_day_close"))` is true;
  in `packages/fiscal-verifactu/src/registros-origin.test.ts` (a new case, existing ones untouched),
  a record with source `trading_day_close` and no device is accepted.
- Run: `pnpm --filter @waitron/shared exec vitest run src/origin.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/registros-origin.test.ts`; from the
  root `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`.
- Check the rebuilt SQL changed only the source lists: `git diff --stat main -- '*/drizzle/*'`, and
  read the diff of `packages/fiscal-verifactu/drizzle/0000_baseline.sql`.

### Task 2. Issue one due bill

New file `apps/server/src/close-of-day.ts` exporting `issueBillAtClose(tx, deps, cfg, billId,
dayStart)` (the "Each bill" steps above), and `close-of-day.test.ts` beside it, using
`provisionBillVenue`, `seatedWith`, `send` and `fiscalRecordCount` from
`apps/server/src/testing/bill-venue.ts`, and a trusted clock moved past the next day start
(`createTrustedClock`, `packages/fiscal/src/clock.ts:66`) so bills opened now are due.

Failing tests first, one per real case:

1. An unprinted, unpaid table bill: one sale for its whole total, one fiscal record, status
   `placed`, the party's revision bumped, no print job, the sale's source `trading_day_close`.
2. A part-paid bill (€5.00 of €30.00): one €30.00 sale, €25.00 still owed
   (`stillOwedOnIssuedBill`), the €5.00 kept against it.
3. A dish never marked served, and a held course never sent to the kitchen, are on the ticket (D4).
4. A staged full invoice naming a customer is issued as that full invoice.
5. A bill with a pending card payment is skipped and nothing is written; once settled as part
   paid, the next call issues it.
6. A bill paid in full by an edit while a draft holds unsent dishes is issued as paid, and the
   draft is left as it was.
7. A bill already issued (printed), a Counter order not handed over, and a bill opened after the
   day began are left alone (no sale, no record).
8. Called twice for the same bill: one sale, one record.
9. A refusal (venue address removed before a full invoice) rolls back everything for that bill:
   no sale, no record, status unchanged.

Run: `pnpm --filter @waitron/server exec vitest run src/close-of-day.test.ts`, then
`src/meal-end.test.ts src/unpaid-departure.test.ts` unedited.

### Task 3. The job, the clock wait and the boot wiring

Add to `close-of-day.ts` `closeOfDayJob(deps)` (a `JobDefinition`, shaped like
`menu-activation.ts:10-40`): the due query, a loop over `issueBillAtClose`, the 60-second retry and
the throw after the loop when any bill failed. Add `"bills.close_of_day": stop` to
`apps/server/src/job-catalogue.ts`, its words to `apps/dashboard/src/i18n/alert-messages.ts`
`job_name` ("issuing the tickets of bills left open at the end of the day" / "emitir los tiques de
las cuentas abiertas al cierre de la jornada"; guard `scripts/ongoing-alert-codes.test.ts:37-40`),
and register it in `boot.ts` beside `menuActivationJob` (`:4491`) with the gated seat,
`clockUnconfirmed: startClockHolds` and `applies` as in Design.

Failing tests first (job tests in `close-of-day.test.ts`):

1. Before the day's end the pass issues nothing and asks to run at `endAt`; after it, it issues
   every due bill and asks for the next `endAt`.
2. A box started after missing the end (clock moved two days on): the first pass issues bills from
   both earlier days.
3. While the gate holds (a seat wrapped with `gateSeatOnStartClock(backend, () => holds)`), a pass
   writes nothing, asks to run in 60 s and does not throw; the gate let go, the next pass issues
   the bill, dated with the clock's reading then.
4. The gate starting to hold mid-pass: bills already issued stay, the rest wait, no throw.
5. One bill refused and one fine: the fine one is issued, the pass throws naming the refused one.
6. `applies` is false on a mirror and on a box that is not primary.
7. Changing the venue's day start wakes the job (its `wakeOn`).

Run: `pnpm --filter @waitron/server exec vitest run src/close-of-day.test.ts
src/job-catalogue.test.ts src/handover-stepdown.test.ts src/boot.restricted-quiet.test.ts`; from
the root `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts`.

### Task 4. Guide and backlog

- `apps/server/src/guide/en/table-service.md` and its Spanish twin `es/table-service.md`, in
  **Switch bills** (`{#bill-switcher}`, after the unpaid-bill paragraphs near en `:537-547`): one
  short paragraph. A bill still open when the trading day ends gets its ticket then, without
  printing; take its payment with **Pay**, record a walkout, or print the ticket from **Find a
  bill**. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from
  the root, `pnpm exec vitest run scripts/guide-links.test.ts`.
- `docs/backlog/fiscal.md` A447: remove "and issuing, when the trading day ends, a bill that was
  neither printed nor fully paid" from "To build"; say the close issues it, citing this plan.

## Left open

- D1–D5 above are the owner's.
- Whether a ticket issued at the close should print automatically later (D3) belongs to
  ADVISER-TICKET-OWED-MARK.
- The rest of A447 (advances) is ADVISER-ADVANCES; the close calls the same issue path, so that item
  covers it.

# Plan: a bill still open when the business day ends is issued then (ADVISER-CLOSE-OF-DAY-TICKET)

Status: written 2026-11-19, lane L; revised the same day after one fresh-context read. **Approved
for building:** the owner, 2026-11-19 ~17:00–17:04 (watcher window, relayed in lane L `questions.md`,
WATCHER 2026-11-19 17:05): D1 "Calendar day it ended (Recommended)"; D2 "New: close of business day
(Recommended)"; D3–D6 "Accept all four (Recommended)"; build order puts this item first.
FISCAL: the owner lands it. Read at main `cb1aeeb7b2`. **RAN** = a command was run and its output
read; other citations were read at that commit. Unmarked reasoning is inference. "Business day" is
the screens' name for what the adviser sheet calls the trading day.

## For the owner

**Building waits for the adviser or for you.** The meeting answers this rests on are your own,
not yet the adviser's: "These are the owner's own answers, not the adviser's; the adviser will come
back with more details" (`docs/compliance/2026-11-19-adviser-meeting.md:21-23`), and A447 says the
adviser is still to confirm (`docs/backlog/fiscal.md:61`). Build once the adviser confirms, or you
say go.

**The ask.** Your decision: "A bill still open when the venue's trading day ends is issued then
(question 1). Nothing does this today" (`adviser-meeting.md:10-11`); the meal ends "Whichever comes
first: printing the bill; taking the last payment; close of trading day", and "yes" to a
never-printed bill being issued then, showing the amount still owed (`:95-96`).

**What staff get.** A table left seated past the end of the business day, whose bill was never
printed, fully paid or recorded as a walkout, gets its ticket within a minute of the day's end, for
everything on the bill, showing payments already taken and the amount still owed. Next shift the
till shows the bill as printed, as after **Print the bill**: staff take payment with **Pay**, record
a walkout, or print the ticket from **Find a bill**. (Corrected 2026-11-19 while building: on main no screen prints an issued, unpaid ticket; it reaches paper when the bill is paid and the payment window closes; a bill then recorded as a walkout gets no printed ticket. Put back to the owner as D3.) A box that was off at the day's end does this as
it starts; a box waiting for its time to be confirmed does it once the time is confirmed. The day's
start setting now issues tickets, so its help text says to pick an hour when the venue is closed.

**No STOP.** The work only calls the existing issue path (`issueUnpaidInvoice`, used by Print the
bill and the walkout). It does not change `computeHuella`, the chain, invoice numbering, the record
builders or `registros_facturacion`'s append-only triggers. D2's default changes one list of allowed
values in the fiscal package's database layout, which is why D2 is yours.

**Your decisions** (default first):

- **D1. The date on the ticket.** Default: the calendar day of the day's end (Tuesday, for a
  Monday dinner in a venue whose day starts at 05:00). On time, the ticket is issued at that moment,
  so it carries one date, and its VAT and takings count on Tuesday. This **departs from a literal
  reading** of your "yes" to "the sale date is the trading day the meal ended" (lane L
  `questions.md`, WATCHER 2026-11-19 13:20), which would put Monday; it matches the reading #3398
  proposes for the other two moments (its amendment D1: a meal's day is the calendar day of the
  moment it ended; branch `feat/later-sale-date` at `a20aed887b`,
  `docs/superpowers/plans/2026-11-15-later-sale-date.md`, "Amendment 2026-11-19" §7). A ticket
  issued late (box off for days, or waiting for its time) needs a separate sale date, the record's
  `FechaOperacion`, which only #3398 adds. #3398's own default holds only if this item owns the date
  of every bill the close ends (its amendment D2), so Task 5 settles who passes it. Until #3398
  lands, a late ticket carries only its issue date. Alternative: Monday on every close-of-day
  ticket; that needs `FechaOperacion` on all of them and a dating step that takes a business day,
  not a moment (Tuesday 04:59 is still Tuesday), and puts their VAT and takings on Monday.
- **D2. What the record names as having issued it.** Every sale and record names a device or one
  of three job sources (`packages/shared/src/origin.ts:22-27`), checked on `registros_facturacion`
  (RAN `git grep -n registros_facturacion_source_ck packages/fiscal-verifactu/drizzle/0000_baseline.sql`
  → line 307, `in ('device', 'demo_seed', 'readiness_test', 'operator_script')`). No device acts at
  05:00. Three options:
  - **(a) Default: a new source, "close of business day".** Truthful. Cost: four starting
    migrations rebuilt (core, payments, workforce, fiscal-verifactu: 13 generated files, each set's
    `0000_baseline.sql`, `meta/0000_snapshot.json` and `meta/_journal.json`, plus
    `scripts/migration-baseline-epoch.json`, the pattern of `6e749a4f79`); every test venue resets,
    said in the pull request's first line (`CLAUDE.md` §3); backups and exports from before cannot
    be restored or imported (`docs/developers/conventions-data.md:4079-4081`); the same source list
    also governs staff time entries (`packages/workforce/src/schema/time-entries.ts`); the watcher
    confirms A1308's table hold (`docs/backlog.md:1605`) allows it.
  - (b) `operator_script`, the source records filed without a device already use
    (`packages/fiscal-verifactu/src/record-remedy-corrective-http.ts:86`,
    `record-remedy-replacement.ts:76`). No schema change, but every close-of-day record would say
    for ever that an operator's script filed it.
  - (c) The till that opened the table, or for a table seated from Bookings (`parties.ts:166`) the
    till that sent its first dishes. No schema change; records would say for ever that a till issued
    a ticket it never touched.
- **D3. No printing at the close.** You said: "It is required to deliver a ticket. We must always
  print one unless we email it instead" (`adviser-meeting.md`, question 3). At 05:00 nobody is there
  to take it, so this is an **exception for you to accept**: no receipt prints; staff print it from
  **Find a bill** when the guest comes back. (Corrected 2026-11-19 while building: on main no screen prints an issued, unpaid ticket; it reaches paper when the bill is paid and the payment window closes; a bill then recorded as a walkout gets no printed ticket. Put back to the owner as D3.) It is one of the sales #3835 (ADVISER-NO-NONE) already
  leaves unprinted (its point 2); whether ADVISER-TICKET-OWED-MARK should print it later is that
  item's question. A full invoice the guests asked for on A4 or by email still goes out: the email
  is sent, and the A4 page is queued on the office printer and prints when it is on
  (`reserveStagedInvoiceDelivery`, `apps/server/src/invoice-choice-delivery.ts:68-100`).
- **D4. A bill with dishes the kitchen is not making is left open.** Default: follow the walkout's
  rule. Recording a walkout refuses a bill holding a dish never sent, or held, until staff cancel it
  (`unpaid_departure.unfired_dishes`, `apps/server/src/errors.ts:716-722`,
  `unpaid-departure.ts:108-109`), so the close leaves such a bill open (once issued, a later walkout
  would skip that check). Staff find the table still open next shift; the next day's close tries
  again. Every other dish on the bill is charged, served or not, as **Print anyway** does: many
  kitchens never mark dishes served, and a dish not eaten is put right with **Correct invoice**.
  Alternative: charge everything, held dishes included.
- **D5. Which bills.** Default: table bills only. A Counter order or takeaway not handed over is
  left alone: usually a sale that never happened, cancelled by staff as today.
- **D6. After a restore.** A restored box holds the backup's open bills, and the lost box may have
  issued some of them after that backup. Default: a bill opened before this box's current invoice
  series began is left for staff to review, never issued automatically. A cold restore retires every
  live series and opens new ones (`packages/db/src/schema/series.ts:31-33`), so the latest
  `invoice_series.retired_at` of this node marks it. Bills opened by another node are left alone
  too, as the deferred close does (`deferred-close.ts`, `ineligible("other_node")`).

**The lane's choices** (open to you): one transaction per bill, so one refusal never stops the
others and nothing is issued twice (one sale per bill: `sales_working_order_id_key`,
`packages/db/src/schema/sales.ts:162`); a bill whose money is still moving is retried a minute
later; a bill fully paid but held back only by someone's open draft (`bill-payments.ts:789`) is left
open, so no dish is sent to the kitchen at 05:00 (the payment path's `fireDishesAtPayment`,
`bill-payments.ts:870`, would send some); the party stays seated; unsent dishes in a draft stay in
it, refused on the issued bill as after Print the bill (`bill.presented`, `parties.ts:321`); the
person on the ticket is the one who seated the table (`parties.opened_by`, `schema/parties.ts:32`),
since the order's placement record requires a person (`order-amendments.ts:34`), as a card the box
finishes later names whoever asked for it (`bill-payments.ts:1602-1607`); no attendance is recorded.

**Size.** About 230 production lines written by hand (most in one new file), 13 generated
migration files (D2), about 20 lines of help and guide text in English and Spanish, and about 550
lines of tests. Medium; one pull request.

## What happens today

- Nothing issues a bill at the day's end: #3398's amendment §2 re-swept every issue path with
  `git grep` (row G: "nothing issues then on main"); the sheet says the same (`:10-11`).
- **Print the bill** (`meal-end.ts:65-154`) checks the till may trade (`:88`), reads the clock and
  refuses an unrecordable time (`:89-90`), refuses a bill already issued (`:102-103`), owing nothing
  (`:104-105`, `:127-128`) or with money moving (`:106`), prices at that same reading
  (`pinnedAt(deps.clock, reading)`, `:118-124`), files unpaid (`issueUnpaidInvoice`,
  `working-order.ts:7628-7676`), marks placed (`:7695`), settles a €0.00 bill (`meal-end.ts:142`) and
  prints. A walkout on an issued bill issues nothing (`unpaid-departure.ts:107-135`), so a walkout
  recorded after the close keeps the close's ticket.
- **The business day**: `readVenueClock` (`packages/db/src/venue.ts:161`), `businessDayAt` and
  `businessDayBounds` (`packages/shared/src/business-day-clock.ts:104-124`). The attendance job wakes
  on its changes (`attendance-loop.ts:62-68`).
- **Waiting for the time.** The fiscal seat refuses `clock.unconfirmed` from `refuseUntilRecordable`
  and every record writer while the start waits (`start-clock-gate.ts:8-14`, `:29-45`;
  `boot.ts:2533-2539`), but **orders still reach the kitchen and bills are still opened**, and a
  bill's `opened_at` is the box's own clock (`nowIso`, `packages/db/src/schema/columns.ts:182`).
  `clock_confirmations` does not record every confirmation: steps by the internet time service or a
  person on the host are never recorded (`packages/fiscal/src/backend.ts:389-391`), and an
  unverified step writes no row (`packages/fiscal-verifactu/src/clock-step.ts:80-83`).
- **Who may**: a restricted start returns before the job runner exists (`boot.ts:2203`, `:2332`;
  runner at `:2749`); a mirror or fenced box does not sell (`boot.ts:3041`). The runner's clock is
  the wall clock (`boot.ts:1203`) and it runs a job's first pass as soon as it is added
  (`job-runner.ts:321`, `:206-218`); the trading listener starts at `boot.ts:4469`.

## Design

**When.** A new job, `bills.close_of_day`, looks every minute (`maxSleepMs` 60 s, `minSleepMs` 500
as `attendance.end_of_day` has, since the pass reads the trusted clock and the runner the wall
clock). Most looks only check the clock gate and read the day-start setting. It runs the due query on its first pass, when
the day's end has passed since its last query, when the clock gate has just let go, and when a
retry is pending. A **due bill**: on a party; `open` or `placed`; no sale; at least one line; opened
by this node, after this node's latest series retirement (D6); and opened before today's business
day began, counting its opening time as described next.

**A wrong clock never decides.** Bills opened while the clock gate held carry untrusted times. The
job keeps, in memory, the bills' table position (`working_orders` row id, a growing number: the table
is an ordinary row-id table and nothing in product code deletes its rows, RAN `git grep -n
"delete(workingOrders)" -- 'apps/server/src/*.ts' 'packages/*/src/*.ts'` → none) at the last look
that saw the gate free, and when the gate lets go it records a window: rows above that mark and up
to the current highest, with the trusted clock's reading at release. A bill in a window counts as
opened at that release reading. The start's wait is the first window, from a mark read in `boot.ts`
before the trading listener starts (`:4469`). So a box starting a day behind, seating tables while
it waits, then corrected, issues none of them mid-service. Limit, stated in the pull request: the
windows live in memory, so a restart during a wait loses them.

**While the gate holds** the pass writes nothing, and each bill's transaction calls
`refuseUntilRecordable` itself, so a gate that starts holding mid-pass rolls that bill back and ends
the pass quietly (as `bill-payments-loop.ts:166-181` does). Once released, due bills are issued
within a minute, dated with the confirmed clock (D1).

**Who.** `applies`: primary, not a mirror, not fenced. An admission refusal
(`venue.time_zone_not_ready`) ends the pass quietly. Catalogue mark: stops at a stepdown.

**Each bill**, in its own `withIssuanceTransaction`: re-read and skip if no longer due; read the
clock once and `refuseUntilRecordable`; skip (retry in a minute) on any `refuseBillPaymentInFlight`
refusal; leave open a bill with dishes the kitchen is not making (`ordersWithUnfiredDish`, D4) or
owing nothing; price at that reading (`pinnedAt(clock, reading)`); `issueUnpaidInvoice`;
`markOrderPlaced` when open; `settleIssuedOwingNothing` for €0.00; bump the party's revision so
tills reload it; log `close_of_day.issued` with the bill and sale. No receipt print and no kitchen
send.

**Failures.** A refused bill is logged (`close_of_day.issue_failed`, naming the bill and the error
code), the others still run, and the pass throws at the end, so after three failing passes over ten
minutes Box status shows the existing "The box keeps failing at …" alert (`job.failing`,
`alert-sources.ts:990-1023`). A refusal the issue path already reports keeps its own alert, such as
a full invoice without the venue's address (`fiscal.taxpayer_domicile_missing`,
`packages/core/src/record-sale.ts:273`, worded at `apps/dashboard/src/i18n/alert-messages.ts:46-49`).
No new alert code.

**Later work that must include this caller.** ADVISER-ADVANCES: the final ticket's deduction of an
advance must cover the close. #3398: Task 5. #3724, #3752 and #3835 need nothing; `meal-end.ts` is
untouched.

## Tasks

Each task: test first, watch it fail, then the code. After each, run its focused tests, the golden
fingerprint and immutability suites unedited, the typecheck and prettier on changed files:

```
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
git diff --exit-code main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/triggers
pnpm --filter @waitron/server typecheck
pnpm exec prettier --check <changed files>
```

### Task 1. The "close of business day" source (only if D2 (a) stands)

Add `business_day_close` to `SOURCES` and `SALE_SOURCES` (`packages/shared/src/origin.ts`); its
label beside `apps/dashboard/src/i18n/strings.ts:1246` and `:5922` ("Close of business day" /
"Cierre de la jornada"); a `SaleOriginConfig` in `apps/server/src/trading-context.ts` (a trading
context whose origin is a `SaleOrigin`), and `issueUnpaidInvoice`'s parameter
(`working-order.ts:7631`) widened to it. Its body should need no change (the helpers it calls take a
trading context, e.g. `invoice-selection.ts:88`); if the typecheck finds one, widen that callee's
type only. Rebuild: `pnpm --filter @waitron/server migration-baseline rebuild --set core`, then
`--set payments`, `--set workforce`, `--set fiscal-verifactu`. Confirm no other set names the list:
`for s in packages/*/drizzle/0000_baseline.sql; do grep -l "'operator_script'" $s; done` must print
exactly those four (it does at `cb1aeeb7b2`).

- Failing tests first: `packages/shared/src/origin.test.ts` pins both whole lists (`SOURCES` at
  `:20-29`, `SALE_SOURCES` at `:37`); each gains the one new value, a pinned whole list gaining one
  key, allowed under the lane's rule. A new case in
  `packages/fiscal-verifactu/src/registros-origin.test.ts` (existing cases untouched): a record with
  source `business_day_close` and no device is accepted.
- Run: `pnpm --filter @waitron/shared exec vitest run src/origin.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/registros-origin.test.ts`; from the
  root `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`. Read the diff of
  `packages/fiscal-verifactu/drizzle/0000_baseline.sql`: only the source list changes.

### Task 2. Issue one due bill

New `apps/server/src/close-of-day.ts` exporting `issueBillAtClose(tx, deps, cfg, billId, rule)`,
and `close-of-day.test.ts` using `provisionBillVenue`, `seatedWith`, `send` and
`fiscalRecordCount` from `apps/server/src/testing/bill-venue.ts`, with a trusted clock moved past the
next day start (`createTrustedClock`, `packages/fiscal/src/clock.ts:66`). Failing tests first:

1. An unprinted, unpaid table bill: one sale for its total, one record, `placed`, the party's
   revision bumped, no print job, no kitchen job, source `business_day_close`.
2. Part-paid (€5.00 of €30.00): one €30.00 sale, €25.00 owed, the €5.00 kept against it.
3. A dish never marked served is charged; a bill holding a held course is left open (D4).
4. A staged full invoice by email or A4: issued as that invoice, its delivery queued, no receipt.
5. A pending card payment: skipped, nothing written; once settled part-paid, the next call issues.
6. Left alone, nothing written: a bill already printed; a Counter order not handed over; a bill
   opened after the day began; a bill fully paid but held by an open draft; a bill opened by another
   node; a bill opened before this node's latest series retirement (D6).
7. Called twice: one sale, one record.
8. A full invoice after the venue's address is removed: refused with
   `fiscal.taxpayer_domicile_missing`; no sale, no record, status unchanged.

Run: `pnpm --filter @waitron/server exec vitest run src/close-of-day.test.ts src/meal-end.test.ts
src/unpaid-departure.test.ts` (the last two unedited).

### Task 3. The job, the clock windows and the boot wiring

Add `closeOfDayJob(deps)` to `close-of-day.ts` (shaped like `menu-activation.ts:10-40`): the looks,
the windows, the due query, the loop, the 60-second retry, the throw after the loop. Add
`"bills.close_of_day": stop` to `job-catalogue.ts`; its words to `alert-messages.ts` `job_name`
("issuing the tickets of bills left open at the end of the business day" / "emitir los tiques de las
cuentas abiertas al cierre de la jornada"; guard `scripts/ongoing-alert-codes.test.ts:37-40`); in
`boot.ts`, read the start mark before `:4469` and register the job beside `menuActivationJob`
(`:4491`) with the gated seat, `clockUnconfirmed: startClockHolds` and `applies`. Failing tests
first:

1. Before the day's end nothing is issued; after it, every due bill is, at the next look.
2. A box started two days after the end: the first pass issues bills from both earlier days.
3. **The clock case.** A box whose clock runs a day behind: the gate holds, a table is seated and
   served, the clock is corrected and the gate lets go. No ticket is issued then; it is issued at the
   end of the corrected business day.
4. While the gate holds nothing is written and nothing throws; released, due bills are issued, dated
   with the reading then. The gate starting to hold mid-pass: issued bills stay, the rest wait.
5. One bill refused and one fine: the fine one is issued; the pass throws naming the refused one.
6. `applies` is false on a mirror and on a box that is not primary.
7. Changing the venue's day start wakes the job.

Run: `pnpm --filter @waitron/server exec vitest run src/close-of-day.test.ts src/job-catalogue.test.ts
src/handover-stepdown.test.ts src/boot.restricted-quiet.test.ts`; from the root `pnpm exec vitest run
scripts/ongoing-alert-codes.test.ts`.

### Task 4. Help text, guide and backlog

- The day's start now issues tickets. Setup's help `venue.help.day_cutover`
  (`apps/setup/src/i18n/strings/venue.ts:135-136`, Spanish `:400`), now "Keep 04:00 if you finish
  trading after midnight", becomes: choose an hour when the venue is closed; table bills still open
  then are issued at that hour. The dashboard's **Business-day start** dialog
  (`apps/dashboard/src/i18n/strings.ts:1270-1290`, label "Business day starts at" at `:1311`) gets the
  same short hint, English and Spanish, following the Forms contract.
- `apps/server/src/guide/en/table-service.md` and `es/table-service.md`, in **Switch bills**
  (`{#bill-switcher}`, after en `:537-547`): a bill still open when the business day ends gets its
  ticket then, without printing; take its payment with **Pay**, record a walkout, or print it from
  **Find a bill**. A bill with held dishes stays open.
- Run the setup and dashboard string tests for the files changed,
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, and from the root
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`.
- `docs/backlog/fiscal.md` A447: remove "and issuing, when the trading day ends, a bill that was
  neither printed nor fully paid" from "To build", citing this plan.

### Task 5. The late ticket's sale date (#3398)

- If #3398 is on main when this is built: pass the close's moment (the business day's end, never
  the issue time) into its dating step. Test: a box switched off over the day's end and started two
  days later issues the ticket with the close's day as its sale date, and an on-time ticket carries
  none.
- If it is not: add to #3398's queue entry and plan: "pass the close's moment from
  `apps/server/src/close-of-day.ts` into the dating step, with the switched-off-box test".

## Left open

D1–D6 are yours. Whether a close-of-day ticket prints later is ADVISER-TICKET-OWED-MARK's
question. Advances (the rest of A447) are ADVISER-ADVANCES; the close calls the same issue path.

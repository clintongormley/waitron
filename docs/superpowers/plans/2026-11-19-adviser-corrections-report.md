# Plan: the accountant's corrections report (ADVISER-CORRECTIONS-REPORT)

Status: written 2026-11-19, lane L; revised the same day after one fresh-context read; **revised
2026-11-21 on main `557b2e2e3c`, the owner's D1–D4 folded in** (D3 and D4 CHANGED), then a second
fresh-context read of `d47dd30466` folded in the same day. PRs #3398, #3916 and #3890 are on main.
PR 1 landed as #3974; PR 2 is `feat/adviser-corrections-report-2`. FISCAL: the owner lands both PRs. **RAN** = a command was run and its output read; a
`file:line` citation was read at `557b2e2e3c`, not run. Unmarked reasoning is inference.

Words used below. The **VAT return** is the quarterly tax form (modelo 303) that Waitron's
dashboard builds as a file for the accountant to upload. A **corrective** is an invoice that changes
an earlier one, for example the credit note filed with a correction of a paid bill (money handed
back with no corrective changes no VAT, `docs/compliance/2026-11-15-adviser-answers.md` Part B12).
A **replacement** is the kind of corrective that repeats a refused ticket in full with the day the
sale really happened. A **void** (annulment) cancels a record outright. A **comp** is a dish given
free with a reason. A **late ticket** is an invoice issued on a later day than the meal it is for,
which since #3398 records the meal's day. A **department** is one of the venue's selling areas
(for example Restaurant and Bar), each with its own zones, menus and receipt name, edited in the
dashboard under **Departments and zones**. A **payment on account** («Pago a cuenta») is the ticket
a guest who pays part of a table's bill can ask for since #3890; the table's own invoice later
takes it off.

## Part 1, for the owner

**What you asked for.** Your decisions D6 and D12 of 16 November
(`docs/compliance/2026-11-15-adviser-answers.md:342-346`, `:526-529`): "a filed report never
changes", and "we use a corrections report instead of just adding the transaction to the current
period". Your answers of 18 November (`docs/compliance/2026-11-19-adviser-meeting.md`): to the VAT
plan, "yes", and "any correctives to the previous quarter should be reported in the correctives
report" (`:204`); a rate set too low, "it should be per invoice line. but we should just produce a
corrections report which goes to the accountant" (`:156`); a rate set too high, "Again, we just
produce a correction report which goes to the accountant" (`:157`); a meal given free, "this should
be part of some report that we make available to the accountant to decide what to do" (`:167`).
These are your answers, not the adviser's; the adviser will come back with more details (`:24-25`).
Your answers to this plan's four questions are under **Your decisions** below.

**What the accountant gets when this lands.**

1. The sales side of the VAT return file for a period counts that period's invoices and the
   corrections made to them in the same period, and nothing else. Once the period has ended,
   nothing done later on the sales side changes its file. Today it does: a void, a date
   replacement or a late ticket made after a quarter ends rewrites that ended quarter's figures
   (RAN, see "What happens today"). Two exceptions remain on the sales side: a record stamped by a
   wrong clock stays where its stamp puts it (your A1420 D8), and after a handover, invoices the old
   main box made in an ended period and sends back later are counted in that period, because
   Waitron does not record when they arrived (see "What happens today"). The purchases side is
   unchanged: a supplier invoice can still
   be edited or deleted, including the date that decides its period
   (`apps/server/src/purchasing-api.ts:114`, `:195`, `:200-204`).
2. On the same screen, a second button, **Download corrections (XLSX)**, for the same year and
   period. It lists every correction made in that period to an invoice whose VAT belongs to an
   earlier period: a summary by the earlier period and VAT rate, reductions and additions apart, and
   one row per correction with both invoice numbers and dates. A late ticket for an earlier
   period's meal is on it too. The accountant decides whether to file each as a complementary
   return, ask for the old return to be corrected, or take it in the current return.
3. A third sheet in that workbook lists what was given free in the period (comps, and discounts
   that took a dish or a whole bill to zero), with the reason and note staff gave, the menu price,
   the ticket it was on, its department, and an **estimated cost** worked out from the department's
   **estimated margin**, a new setting you fill in per department in the dashboard.

**Warning: the VAT file alone is no longer the whole story.** A corrective issued on 2 April for a
31 March meal, a void made after the quarter ends, or a ticket issued on 1 April for a 31 March meal
appears in no period's VAT file. It is only on the corrections list of the period in which it was
made. The last case can arise at any period's end since #3398: for example a card taken on 31 March
whose answer the box only learns on 1 April is filed as a 31 March sale on a 1 April ticket
(`apps/server/src/sale-day.ts:31-41`, read). Uploading the file without reading that list pays too
much or too little VAT. The screen and the guide say so.

**What is not in it.** A VAT rate found wrong later (too low or too high) is not built: Waitron has
no way yet to record that a product's rate was wrong from a given day, and that belongs to the
"VAT rates per product" design, which is not written yet (`docs/backlog/fiscal.md:883-904`). Once a
product has dated rates, the wrong-rate section can be worked out per invoice line from what each
ticket stored, as you asked; it is a later item. Waitron files nothing here: no change to the tax
records, their fingerprints, the chain, invoice numbers or the record builders.

**Your decisions** (all four answered; where recorded: `~/waitron-campaign-l/questions.md`):

- **D1. When a period counts as "filed": the day it ends.** Your answer, 19 November ~17:00:
  "The day it ends (Recommended)" (entry "WATCHER 2026-11-19 17:05", line 291), repeated on
  20 November (entry "WATCHER 2026-11-20 22:48"). A correction made after the end goes on the
  corrections list, never into that period's file. Whatever happens between the end of a quarter
  and the day the accountant files it (a corrective issued on 3 April for a 30 March meal, a void, a
  late ticket) is not in that quarter's file even if the accountant files on 20 April; it is on the
  second quarter's corrections list, which can be downloaded at any time. The same rule applies to
  monthly returns. (The first version also said a **Mark as filed** button would have to wait for
  other database work; that was wrong, and your choice does not rest on it.)
- **D2. Build now.** Your answer: "Accept all three (Recommended)" for D2–D4 on 19 November (same
  entry, line 291). On 20 November the watcher wrote "D2: build now" in relaying your other answers
  (entry "WATCHER 2026-11-20 22:51"); those are the watcher's words, not yours. Nothing
  stored is rewritten: every figure is worked out again from the invoices each time, so if the
  adviser answers differently, a later change to this rule harms no data. The margin setting (D4)
  is a new stored value, entered by you.
- **D3 CHANGED. What counts as "given free": comps, and discounts that took a dish or a bill to
  zero; never a cancelled dish.** Your words, 20 November: "comps and zero discounts, cancels were
  never made, were they?" (22:48), then "if a dish is cancelled without being charged for, then i
  think it just disappears. it is like it never happened" (22:49) (entries "WATCHER 2026-11-20
  22:48" and "22:49"). So the earlier default's third kind (a served dish cancelled without its
  charge) is dropped. **How this plan reads "it just disappears" for a comp:** a dish that was
  comped and later taken off the bill is left out of the list, whether the kitchen had made it or
  not; a comped dish that stays on the bill (including one cancelled with its charge kept, which
  leaves it on the bill) is listed. Each row says which kind it is.
- **D4 CHANGED. An estimated margin per department.** Your words, 20 November: "i think we need a
  setting per department for an estimated margin, which we can use for this value" (entry
  "WATCHER 2026-11-20 22:51"). So each department gets an **Estimated margin (%)** field in the
  dashboard (Departments and zones, the department's **Details** tab), empty until you fill it. The
  free list gets an **Estimated cost** column worked out from that margin, left empty where the
  department has no margin. It carries no VAT figure: whether a free meal owes VAT is the
  accountant's call, as you said. This adds one stored value to each department, so the pull
  request that carries it (PR 2) resets the test venues, and says so in its first line.
- **D14. The estimated cost is worked out on the price without VAT.** Decided by the watcher, not
  you (`~/waitron-campaign-l/questions.md`, entry "WATCHER 2026-11-21 16:11"); the watcher told you,
  and you may overrule it. An €11.00 dish at 10% VAT is €10.00 without VAT, so a 30% margin gives an
  estimated cost of **€7.00**.

**Size.** Two pull requests. PR 1 (the period rule and the corrections list): about 510 lines of
code and 990 of tests, plus about 55 lines of guide and backlog text, about 33 files, no generated
files, no database change. PR 2 (the margin setting and the free list): about 310 lines of code and
620 of tests, plus about
35 of guide and backlog text and about 25 generated lines (the rebuilt starting database layout),
about 40 files; it resets the test venues.

_2026-11-21:_ at the owner's word (lane L `questions.md`, "WATCHER 2026-11-21 19:02") PR 1 also
adds `sales_supply_day_idx`, so it rebuilds core's starting migration (about 13 generated lines)
and resets every venue; PR 2 rebuilds it again. "Should this exist?" item 2's "one migration
rebuild, one venue reset" is now two of each.

## Should this exist?

1. **Need.** In the owner's words above: a filed quarter's figures never change, and later
   corrections, wrong rates and free meals go on a report the accountant acts on; for free meals, "a
   setting per department for an estimated margin, which we can use for this value". When this lands
   the accountant can download, per period, a VAT file whose sales side stays fixed once the period
   ends, and a workbook of later corrections by earlier period and rate, plus the free list with an
   estimated cost. Still unavailable: the wrong-rate section (waits on "VAT rates per product").
   **Simplest alternatives.** Changing nothing leaves the VAT file contradicting the owner's D12 (a
   later void, date replacement or late ticket rewrites an ended quarter, RAN). Adding columns to
   the existing **Download for accountant (XLSX)** workbook (`apps/server/src/accountant-export.ts`
   already lists correctives with the original's number, `:26-45`) was considered and rejected: that
   workbook takes any date range, while "an earlier period" depends on whether the venue files
   monthly or quarterly; a quarterly filer handed a month-based list would add May's corrections of
   April sales twice. So the list sits beside the VAT file, on the same chosen period. For the free
   list, the existing Adjustments report already lists every comp and discount with its reason and
   amounts (`listAdjustmentEntries`, `packages/adjustments/src/reports.ts:513-575`); PR 2 filters
   those entries rather than writing a second query. For the margin, a column on the department's
   own row is the smallest store the house rules allow (see Design, "Where the margin lives").
   Beyond the minimum: the summary sheet (asked for: "listed by original quarter and rate") and the
   department name on each free row (so the estimated cost can be checked against its margin).
2. **True size.** Estimated above: about 73 files (counted from the task lists below); about 820
   lines of code, 1,610 of tests and 90 of docs; about 25 generated lines in PR 2
   (`packages/db/drizzle/0000_baseline.sql`, `meta/0000_snapshot.json`, `meta/_journal.json`,
   `scripts/migration-baseline-epoch.json`), one migration rebuild, one venue reset. Later changes
   get smaller: the VAT period rule lives in one function.
3. **Approval.** D6 and D12 are recorded at `adviser-answers.md:342-346` and `:526-529`; the 18
   November answers at `adviser-meeting.md:156-157`, `:167`, `:204`. D1–D4 are the owner's,
   relayed by the watcher (`~/waitron-campaign-l/questions.md`, entries "WATCHER 2026-11-19 17:05",
   "WATCHER 2026-11-20 22:48", "22:49", "22:51"); I read them there, not from the owner directly.
   D5–D10 were cleared by the watcher at the plan's defaults, not by the owner (same file, entry
   "WATCHER 2026-11-19 15:55", line 281). D11, D13, the D3 reading and D14 were cleared by the
   watcher (entry "WATCHER 2026-11-21 16:11"), which told the owner of D14; the owner may overrule
   it. One fresh-context reviewer read the first version
   and re-ran its A/B/C test; a second read `d47dd30466` and ran the void-of-a-replaced-sale case,
   and its findings are folded in here.

## What happens today

- **The VAT return counts a sale by the day its VAT belongs to, whenever that sale was made.** The
  day is its replacement's `supply_day`, else its own `supply_day` (a late ticket, since #3398),
  else its issue date (`vatReturnDay`, `packages/reporting/src/vat-return.ts:10-25`, used at
  `:50-62`). It leaves out every voided sale whenever the void was made, every replacement and
  every exchange invoice (`activeSalesClause`, `packages/reporting/src/business-day.ts:220-230`, its
  only caller `vat-return.ts:62`, RAN `git grep -n activeSalesClause`), and counts each corrective
  by its own issue date at the rates of its own stored VAT split. **RAN** a throwaway test
  (`packages/reporting/src/zz-throwaway-filed-quarter.test.ts`, deleted after; from
  `packages/reporting`, `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run
  src/zz-throwaway-filed-quarter.test.ts --reporter=verbose --silent=false`, 5 passed), one ticket
  at 10%, €11.00, first and second quarter printed before and after the later step:
  - A, ticket 10 Feb, corrective −€5.50 issued 10 May: first quarter before and after
    `[{"rate":"10.00","base":"10.00","tax":"1.00"}]`; second quarter `[]`, then
    `[{"rate":"10.00","base":"-5.00","tax":"-0.50"}]`. The first quarter does not change.
  - B, ticket stamped 1 April, replacement on 10 May naming 31 March: first quarter `[]`, then the
    10.00 line; second quarter the 10.00 line, then `[]`. **An ended quarter's figures change.**
  - C, ticket 10 Feb, void recorded 10 May: first quarter the 10.00 line, then `[]`; second quarter
    `[]` both times. **An ended quarter's figures change.**
  - D, a late ticket issued 1 April for 31 March (#3398): first quarter `[]`, then the 10.00 line;
    second quarter `[]` both times. **An ended quarter's figures change.**
  - E, a 10 February ticket and a full corrective on 10 March: the first quarter is
    `[{"rate":"10.00","base":"0.00","tax":"0.00"}]`. A rate line that nets to zero stays in the
    result; the summing loop makes one line per rate it sees
    (`packages/reporting/src/vat-summary.ts:71-82`). No existing test expects such a line (RAN
    `grep -n 'base: "0.00"'` over `vat-return.test.ts`, `modelo-303.test.ts` and the four
    `apps/server` tests that call `computeVatReturn`: no match).
  So the backlog's "read, not run" sentence (`docs/backlog/fiscal.md:974-975`) holds for A and B;
  C and D are two more cases. Four existing tests pin today's replacement, refund-of-replacement,
  late-ticket and later-void behaviour (`packages/reporting/src/vat-return.test.ts:168-177`,
  `:190-207`, `:210-224`, `:237-250`), and one server test ties the accountant workbook to the
  return (`apps/server/src/accountant-export.test.ts:803-874`).
- **Late tickets come from real paths since #3398.** A card payment whose answer the box learns
  later dates its sale by when the card was taken (`apps/server/src/sale-day.ts:31-41`), and a
  bill's invoice issued after its meal ended is dated by the meal's end, a bill the end of the
  business day issues late no later than that day's end (`:44-66`); the meal's day goes in
  `sales.supply_day` when it is earlier than the issue day (read, not run; the column's rule
  `packages/db/src/schema/sales.ts:103-108`, `:152-155`). #3916 then counts a bill the end of the
  business day issued on the trading day it opened, in the daily close only
  (`packages/reporting/src/business-day.ts:232-257`); the VAT return does not read that clause.
- **Payments on account (#3890) are ordinary invoices.** RAN a throwaway test (deleted after;
  `apps/server/src/zz-throwaway-advance-vat.test.ts`, copied from `advance-final.test.ts`'s setup,
  run from `apps/server` with `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run
  src/zz-throwaway-advance-vat.test.ts`, 1 passed): a €30 payment on account on a €120 meal at 10%
  is a sale with no `corrects_sale_id`, not a replacement, no `supply_day`, breakdown
  `[{"rate":"10.00","base":"27.27","tax":"2.73"}]`; the table's invoice is another such sale,
  breakdown `[{"rate":"10.00","base":"81.82","tax":"8.18"}]` (the meal less the advance); that
  month's return gave `[{"rate":"10.00","base":"109.09","tax":"10.91"}]`, the whole meal once. The
  table's invoice can carry a negative rate line when the advance (always 10%) covers more than the
  meal's 10% dishes (`apps/server/src/advance-final.test.ts:470`, "leaves 10% negative"). Piece 1
  takes a payment on account only on an open bill at the till
  (`docs/superpowers/plans/2026-11-19-adviser-advances.md:229-242`); paying days ahead for a
  booking is piece 4, not built (`:252-261`). So an advance and its table's invoice fall in
  different periods only across the night a period ends; neither is a correction, and each counts
  in its own period, today and under the rule below. A refund of a payment on account is an
  ordinary corrective of its ticket.
- **Invoices returned after a handover keep their own times.** `receiveReturnedOriginals`
  (`packages/fiscal-verifactu/src/handover-return.ts:245`) inserts another box's sales (`:356`) and
  voids (`:476-500`) as the rows came, with their original issue and void times, and
  `computeVatReturn` counts every box (`apps/server/src/return-records.real.test.ts:629-631` reads
  such a sale into July's return). Nothing stores when a returned row arrived: the sale row has no
  such column, and `handover_return_batches` keeps a batch's index, count and digest, not a time
  (`packages/db/src/schema/handover/return-batches.ts:6-14`). So the rule cannot tell a late arrival
  from a row made on time; this plan states it as a limit and adds no column.
- **Voids have no product caller.** Core's `recordVoid` (`packages/core/src/record-void.ts:24`) is
  called outside tests only by `apps/server/src/testing/order-venue.ts:240` (RAN `git grep -n
  "recordVoid("` over `apps/` and `packages/`; the other hits are the fiscal backends' own
  `recordVoid` and the payments package's unrelated one). The rule must still treat them correctly.
- **Replacements come only from a ticket AEAT refused as dated in the future** (`1112`), put right
  from the case dialog with the real day
  (`packages/fiscal-verifactu/src/record-remedy-replacement.ts:20-25`). A replacement carries the
  original's own total and VAT split (`packages/core/src/record-replacement.ts:41-46`) and is
  refused once the original has any corrective (`:112-114`); later correctives go to the replacement
  (`packages/core/src/correction-target.ts:12-18`). So a corrective chain is at most corrective →
  replacement → original.
- **Nothing records that a return was filed.** RAN at `9faf8661eb` (19 November) `git grep -n -i
  "quarter.*filed\|filed_at\|period_closed\|vat_period\|return_filed\|closed_period\|period_lock"`
  over `packages/db/src/schema`, `packages/reporting/src` and `apps/server/src`: no match; not re-run
  since. The VAT file download writes no activity (`apps/server/src/report-api.ts:290-326`).
- **The purchases side** groups supplier invoices by `received_on`
  (`packages/reporting/src/input-vat.ts:47`), which a manager can edit later
  (`apps/server/src/purchasing-api.ts:114`, `:195`; `packages/purchasing/src/operations.ts:284-299`).
  Out of scope here; see "Left open".
- **Where it is shown.** **VAT return (modelo 303)** in the dashboard
  (`apps/dashboard/src/screens/vat-return-screen.ts`) downloads the file from
  `GET /management-api/reports/modelo-303` under permission `report.export`
  (`apps/server/src/report-api.ts:76`, `:290-326`), held by managers by default
  (`packages/identity/src/permissions.ts:25`). The screen offers quarters and months
  (`packages/reporting/src/period.ts:22-28`). No guide section describes the screen; one guide
  sentence names it (`apps/server/src/guide/en/table-service.md:614-615`, added by #3916) (RAN
  `grep -rn -i "303\|vat return"` over `apps/server/src/guide/*/`).
- **Free dishes carry a reason.** Every comp, discount and cancellation is an `adjustments` row with
  the reason's name and the staff note copied at the time, the action, the amounts (VAT included,
  stored in cents), the dish's stage and whether a cancel kept the charge
  (`packages/db/src/schema/adjustments/adjustments.ts:42-83`). The rows are never changed, and a
  cancel can delete the dish's line, so the row keeps a line id that may no longer exist (`:44-46`).
  A whole-bill discount has no line id (`:116-121`). The Adjustments report's drill-down returns
  these rows as decimals with reason, note, stage and order (`listAdjustmentEntries`,
  `packages/adjustments/src/reports.ts:513-575`, entry shape `:99-133`, rows read at `:316-356`),
  paged up to 500 (`packages/adjustments/src/entry-pages.ts:3`), chosen by the business day the bill
  was opened (`reports.ts:166-168`); it does not return the line id. Moving a dish to another bill
  keeps its line's id and changes its bill (`apps/server/src/working-order.ts:4342`, read).
  The adjustments module is mandatory and keeps its tables in core's set
  (`packages/composition/src/modules.ts:363-377`), and `apps/server` already imports it.
- **Departments.** A department is a row of `departments`
  (`packages/db/src/schema/venue-service/service.ts:15-38`), in core's migration set
  (`packages/db/drizzle/0000_baseline.sql:2421`). A bill records its zone's department
  (`working_orders.department_id`, both null or both set with the zone,
  `packages/db/src/schema/orders.ts:122`, `:174-175`); each line ordered from a menu records the
  department it was offered in (`working_order_lines.offer_department_id`, `orders.ts:278`, set
  from the bill's zone, `packages/venue-service/src/operations.ts:1411`), null for an item not from
  a menu (`orders.ts:437`). A department's other settings are columns on its row, saved by
  `PUT /management-api/venue-service/departments/:departmentId/settings`
  (`packages/venue-service/src/routes.ts:782`, `updateDepartment`,
  `packages/venue-service/src/operations.ts:214-245`) from the dashboard's department editor
  (`packages/venue-service/src/dashboard/department-settings.ts`, its **Details** tab
  `:1098-1146`).
- **Wrong rates.** Products still carry VAT classes; an order line stores a class, not a rate
  (`packages/db/src/schema/orders.ts:235-237`); no dated rate history exists, and its design is not
  written (`docs/backlog/fiscal.md:883-904`).

## Design

**The rule.** Every invoice and correction becomes one or two *VAT movements*, each with a rate
line (rate, base, VAT), a sign, the **day it was made** and the **day its VAT belongs to**. Below,
an ordinary invoice's *own day* is `coalesce(its supply_day, its issue date)`.

| Row | Movement | Made | Belongs to |
| --- | --- | --- | --- |
| Ordinary invoice (not an exchange, not a corrective; payments on account included) | + its VAT split | its issue date | its own day |
| Corrective that is not a replacement | + its (usually negative) split | its issue date | where its target's VAT belongs: a replacement target's `supply_day` when set, else the original's own day |
| Replacement with a `supply_day` | − the split, and + the split | its issue date | the original's own day, and the `supply_day` |
| Replacement without one | none | | |
| Void of a replacement | none (as today: a voided replacement's `supply_day` still decides where its original's VAT sits) | | |
| Void of any other row | − its VAT split | the void's date (in the voided sale's offset, D7) | where that row's VAT sits now: for an ordinary invoice, its replacement's `supply_day` when it has one, else its own day; for a corrective, its own "belongs to" |
| Exchange invoice (F3) | none (its tickets carry the VAT) | | |

Using the original's *own day* (not its issue date) for a replacement's "−" is what keeps a late
ticket later replaced counted once. A void takes the sale off where its VAT sits at the time, not
where it first landed: negating the original's own movement instead would leave a replaced sale's
VAT counted at its real day and taken off at its wrong one. Each sale's movements still net to zero
once it is voided (the "+", the replacement's "−" and "+", the void's "−" at the replacement's day),
so "every movement lands once" holds. **RAN** today's behaviour for both cases (throwaway
`packages/reporting/src/zz-throwaway-void-replaced.test.ts`, deleted; from `packages/reporting`,
`env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run src/zz-throwaway-void-replaced.test.ts
--reporter=verbose --silent=false`, 2 passed), a ticket stamped 1 April, replaced on 10 April naming
31 March, then voided on 10 May: V (void the original) first quarter `1.10` → `[]`, second `[]`
→ `[]`; R (void the replacement) first quarter `1.10` → `1.10`, second `[]` → `[]`. Under the rule:
V leaves the first quarter's return `[]` (the replacement that moves the ticket into it was made
after it ended) and the second's `[]`, and the second quarter's
corrections list `+1.10` (made 10 April) and `−1.10` (the void, made 10 May) for the first; R
changes nothing.

A period P's **VAT return** sums the movements that belong to P and were made on or before P's
last day, then drops any rate line whose base and VAT are both zero (a line with base zero and VAT
not zero stays). The drop is in `computeVatReturn` only; the daily close keeps its zero lines. It
changes one thing today too: a sale and its full corrective in the same quarter now give no line,
where today they give a 0.00 line (RAN, case E). P's **corrections** are the movements made in P
that belong before P's first day. Every movement lands exactly once: in the return of the period it
belongs to, when it was made no later than that period ends, otherwise on the corrections of the
period it was made in. On the sales side, a period that has ended never changes, with two
exceptions: a record stamped with a wrong clock, which A1420 D8 leaves uncorrected, and invoices
and voids another box made and returns after a handover, which arrive with their own issue and void
times and no record of when they arrived (see "What happens today"), so they count as made on
those times.

**The 18 November example, under the rule** (`adviser-meeting.md:194`). Ticket stamped 1 April,
really 31 March, replacement in May: the second quarter's return holds +ticket (1 April) and
−ticket (made May, belongs 1 April), so it stops counting it; the first quarter's return is
unchanged; the second quarter's corrections show +ticket as an addition for the first quarter.
Found in August instead: the third quarter's corrections show a reduction for the second and an
addition for the first ("any correctives to the previous quarter should be reported in the
correctives report").

**What changes for monthly periods.** A May correction of an April sale is in neither month's
return; it is on May's corrections. So a quarter no longer always equals the sum of its months
(the comment at `packages/reporting/src/period.ts:87-95` says it does; it stays true of the date
filter, and `vat-return.ts`'s header says the rule). A year period (`period.ts:13`; no route offers
it) follows the same rule, its "belongs to" label being the year.

**Reductions and additions** are split per rate line by the sign of its base, or of its VAT when
the base is zero (D5). A late table's invoice whose advance left its 10% line negative therefore
lists a reduction at 10% and an addition at its other rate.

**The corrections workbook** (`corrections-<year>-<period>.xlsx`, in the venue's language like the
accountant workbook): sheet **Summary** (made period, belongs to, rate, reduction or addition,
base, VAT, sorted by belongs-to then rate, reductions first; one line "No corrections" when empty),
sheet **Corrections** (made date, kind, invoice number, corrects invoice number and its date,
belongs to, rate, base, VAT, reduction or addition), and in PR 2 sheet **Given free** (below).
Kinds: Correction, Void, Date moved out, Date moved in, Issued after its sale's period (an ordinary
invoice whose own day lies in an earlier period than its issue date). No staff or customer names.

**The Given free sheet** (PR 2). One row per comp or discount whose amount after it is zero (actions
`comp`, `discount_amount`, `discount_percent`; D3), on a bill opened in the period (D10), told by
the rows it took money off (`adjustment_lines`) that are still on a bill. A row on an abandoned bill
(for example one split after printing, cancelled, or merged into another) is not on a bill. A comp
or discount, of a dish or a whole bill, with none of its rows still on a bill is left out (D3:
taken off the bill). Columns: date, invoice number (the invoice of the bill the dish is on now, or
of the discounted bill; for a whole bill whose bill was abandoned, the bill holding its dishes;
blank when none was issued), item or "Whole bill", quantity, kind (Comp, Discount to zero),
department, menu price, amount taken off, estimated cost, reason, note. **Quantity** is what is
still on a bill (comp three glasses, take one off: two). **Menu price** is the list price of those
rows (so a dish discounted earlier still shows its menu price); **amount taken off** is each row's
share of what the adjustment took off, by the quantity `adjustment_lines` stored. **Estimated cost**
(D14) = the price without VAT × (10000 − margin in basis points) ÷ 10000, blank when the department
has none. Each row still on a bill, extras included, is priced without VAT at its own rate:
`vatRateOn` of its `vat_class` (or `takeaway_vat_class` when the bill's `dining` is takeaway) on the
adjustment's civil day in the venue's zone. Those prices are summed exactly, the margin applied
once, and the result rounded half up to the cent once.
The department is the dish's line's `offer_department_id`, else the bill's `department_id` (D11).

**Where the margin lives.** A nullable column `departments.estimated_margin_bp` (basis points,
`rate()` from `packages/db/src/schema/columns.ts:71`, CHECK between 0 and 10000), not a settings
document. Why: a module's settings document must keep row ids out
(`docs/developers/conventions-data.md:6838`), and a per-department value kept there would be a map
keyed by department id; a department keeps its other settings on its own row
(`conventions-data.md:5500`). A schema change rebuilds core's one starting migration (`pnpm --filter
@waitron/server migration-baseline rebuild --set core`, as `packages/db/package.json:30` runs it),
never a new migration (CLAUDE.md §3). A box already migrated refuses to start on a changed starting
migration (`provisioning.database_ahead`, CLAUDE.md §3), so PR 2 resets the test venues and says so
in its first line, as #3398, #3916 and #3890 did. The column travels with the department in a
configuration copy; the copy's format number goes up by one, as #3783 did for a new `menus` column
(`packages/provisioning/src/configuration-transfer.ts:146`, `:574`, read).

**The margin field.** In the department editor's **Details** tab, after the trading name: a
`wt-input` named `estimatedMargin`, label **Estimated margin (%)** / **Margen estimado (%)**, not
required, `decimal-locale=${currentLocale()}` (design-system Forms: a percentage takes `2.80` or
`2,80`, `docs/developers/design-system.md:2947-2962`), hint as the placeholder text ("Used to
estimate the cost of free items" / "Para estimar el coste de las invitaciones"). Empty means none. A value outside 0 to
100, or with more than two decimals, is marked beside the field with a localized message once Save
is pressed, Save stays disabled until fixed, as the editor's other fields behave. The draft, the
unsaved-changes guard and Save's quiet state follow the editor's existing `draftScopeFor` and
`saveActionState` handling. The route takes `estimatedMargin` as a dot-decimal string or `null`
and refuses anything else with the route's existing `management.request_invalid` and `field:
"estimatedMargin"` (`routes.ts:797-807` does the same for `lateSendNeedsManager`).

**Watcher decisions** (default first; D5–D10 cleared at these defaults on 19 November; D11 and
D13 new):

- **D5.** Reduction or addition by the sign of each rate line's base (VAT when the base is zero).
- **D6.** Delivery: a button on the VAT return screen, same year and period as the file,
  `GET /management-api/reports/corrections`, permission `report.export`, no activity record (like
  the VAT file; the workbook names no customer or staff member). Why not the accountant workbook:
  see "Should this exist?".
- **D7.** A void's date uses the voided sale's own offset; `sale_voids` stores no offset
  (`packages/db/src/schema/sale-voids.ts:12-39`) and no product path voids today.
- **D8.** A corrective of an exchange invoice (F3) belongs to the F3's own date.
- **D9.** A new guide section "VAT return and corrections" `{#vat-return}` in `invoices.md`, English
  and Spanish; the screen has none today. The sentence at `table-service.md:614-615` links to it.
- **D10.** The free list reuses the Adjustments report's entries, so it is chosen the same way:
  by the business day each bill was opened, over the period's first to last business day. A bill
  opened at 02:00 on 1 April in a venue whose day starts at 05:00 falls in March's business day,
  so in the first quarter, while its ticket's date is in the second. Unchanged by D3 and D4.
- **D11 (new).** A free row's department is the department the dish was ordered in
  (`offer_department_id`), else, for a whole-bill discount or an item not from a menu, the bill's
  department; none, no estimated cost. The two differ only for a dish moved between departments'
  bills. Alternative: the bill's department for every row.
- **D13 (new).** The **Download for accountant (XLSX)** workbook keeps listing what #3398 made it
  list (each invoice in its sale day's range, each corrective by its own issue date). Its test that
  each quarter's rows equal that quarter's VAT return
  (`apps/server/src/accountant-export.test.ts:803-874`) cannot hold under the owner's 16 November
  rule (their D12), so it is restated (Task 2): the first quarter's return is the March original
  alone, the second's is empty, and over both quarters together the workbook's VAT equals the two
  returns plus the second quarter's corrections. Alternative: list each corrective in its target's
  period, which keeps a per-quarter identity but moves May's credit note for a February meal into
  the January–March workbook.
- **D14** (Part 1; there is no plan D12, to keep it apart from the owner's D12 of 16 November):
  the price without VAT, the watcher's decision of 2026-11-21 16:11, which the owner may overrule.
  The estimated cost is one column, with the department's name beside it and no VAT figure.

## Interplay

- **#3398 LATER-SALE-DATE landed** (`cc73fe7dc3`). It lets an ordinary sale carry
  `sales.supply_day` (`packages/db/src/schema/sales.ts:152-155`), counts it by that day through
  `vatReturnDay` (`vat-return.ts:10-25`, `:54-59`), lists the accountant workbook by the same day
  (`apps/server/src/accountant-export.ts:209-222`, with its sale-date column at `:258-260`), and
  pins it with "counts a sale issued on a later day in its sale day's period"
  (`vat-return.test.ts:210-224`) and `accountant-export.test.ts:803-874`. Its D4 handed "invoices
  issued after their sale day's quarter was filed" to this item as a go-live condition
  (`docs/superpowers/plans/2026-11-15-later-sale-date.md:601-611`). So, in this plan:
  - Task 2 removes `vatReturnDay` from `computeVatReturn` and renames it `saleVatDay` ("the day a
    sale's VAT belongs to"), which the movements and the accountant workbook keep using; its two
    callers and the barrel export move with it.
  - #3398's test changes: the first quarter's return no longer holds the late ticket (made after
    the first quarter ended), the second's does not either, and the second quarter's corrections
    list it as an addition for the first, kind "Issued after its sale's period" (Tasks 2 and 3).
  - The kind's label (English and Spanish) and the test "a late ticket later replaced is counted
    once" are built here (Tasks 1, 3 and 5).
  - `accountant-export.ts:209`'s comment ("The day `computeVatReturn` counts the sale in") becomes
    false and is reworded; its test is restated (D13).
- **#3916** (`8b8d85fb6f`) changed `issuedSalesClause` and `reversedSalesClause`
  (`business-day.ts:232-257`), which the daily VAT summary, record counts, category sales and top
  sellers read (RAN `git grep -n "issuedSalesClause\|reversedSalesClause"` over
  `packages/reporting/src`), not the VAT return. Nothing here changes them. Task 2 deletes
  `activeSalesClause` (`:220-230`), whose only caller is `vat-return.ts`; `notSubstituteClause` and
  `notReplacementClause` (`:206-218`) stay, as #3916's clauses use them.
- **#3890 ADVISER-ADVANCES piece 1** (`ff01506dc8`): no change needed (RAN, "What happens today").
  Task 3 adds the late-table-invoice-with-a-negative-line case.
- **Open #3961** (`feat/payments-on-account-reporting`) changes category sales, find-a-bill and two
  shared dashboard files this plan also edits, `apps/dashboard/src/api/client.ts` and
  `apps/dashboard/src/i18n/strings.ts` (RAN `gh pr view 3961 --json files`); different sections, so
  whichever lands second rebases. `feat/advance-refund-after-final` touches only category sales.
  `feat/h-a1308-os12-common-refunds` changes two lines of `packages/adjustments/src/reports.ts`,
  which Task 9 edits (RAN `git diff --stat main...<branch>` over this plan's files for every branch
  in `git worktree list`; no other branch touches them).
- **VAT rates piece A.** `free-items.ts` reads each line's `vat_class` / `takeaway_vat_class` label
  for its rate; PRs 2 and 3 of `docs/superpowers/plans/2026-11-22-vat-rates-a.md` must move it with
  the other readers.
- **A1308 table hold.** Lifted on 7 November (`~/waitron-campaign-shared/a1308-hold.md:3`), so it
  does not apply to PR 2's column. Three backlog entries still say they wait for it
  (`docs/backlog.md:1264`, `:1604`, `:1814`); they belong to other items and are left to the
  watcher.
- **Guards this touches.** `scripts/corrective-sums.test.ts` flags any SQL equality on
  `corrects_sale_id` (`:21-22`) and allows `vat-return.ts`'s join (`:68-74`) and the accountant
  workbook's (`:75-81`) by fragment; the movement query's joins replace the `vat-return.ts` entry
  with entries of their own, each with its reason. It reads text. For PR 2's column, Task 7a runs the
  schema guards CLAUDE.md §3 names for a starting-migration rebuild
  (`scripts/schema-constraints.test.ts`, `scripts/starting-migrations.test.ts` and the others
  listed there), each weaker than its name as §3 says.

## Tasks

Every task: test first, watch it fail, then the code. Focused runs use
`env -u AI_AGENT -u CLAUDECODE pnpm --filter <pkg> exec vitest run <files>` and read the `Tests`
count (`pnpm test <file> -t` drops `-t`). Browser suites (dashboard, venue-service's dashboard
files) check `memory_pressure | grep free` first. Every task ends with the package typecheck,
`pnpm exec prettier --check` on the changed files, and the fiscal gate, unedited:

```
env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu exec vitest run src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts src/inmutabilidad.test.ts
git diff --exit-code "$(git merge-base main HEAD)" -- packages/fiscal-verifactu packages/fiscal/src packages/core/src packages/db/src/schema packages/db/triggers apps/server/src/sale-day.ts ':(exclude)packages/db/src/schema/venue-service/service.ts'
```

(RAN the first line at `557b2e2e3c`: 4 files, 15 tests passed. RAN the second at `4cedb44322`: exit
0; with a line appended to `service.ts` it still exited 0, and the same diff without the exclusion
exited 1, so the exclusion lets only Task 7a's department column through. RAN the widened line at
`d47dd30466`: exit 0; with a line appended to `packages/fiscal/src/backend.ts` and
`apps/server/src/sale-day.ts`, exit 1.) The second line compares
with the point the branch left main, so it does not fail when main moves on. `git commit -s` per
task. An implementer that passes about 150 tool calls with the task unfinished stops at a passing
or cleanly failing point, commits, and hands over.

### PR 1: the period rule and the corrections list

#### Task 1. VAT movements (`@waitron/reporting`)

**Files:** new `packages/reporting/src/vat-movements.ts` and `vat-movements.test.ts`; `index.ts`
(export, for Task 2's server test); `scripts/corrective-sums.test.ts` (allowlist entries for the new
joins).

- `vatMovements(tx, { year, period })` returns one row per stored rate line of each movement in the
  table above that belongs to P or was made in P, with: rate, base, tax (signed), made day, belongs
  day, kind (`correction`, `void`, `date_moved_out`, `date_moved_in`, `issued_late`, or `invoice`
  for an ordinary invoice made in its own period), the row's sale id, and the corrected sale's id.
  One SQL statement (a `with` of `union all` branches plus the voids' negation, `json_each` over
  `vat_breakdown`), the issue date as `vat-return.ts:23` builds it; awaited, no `Promise.all`.
- **Failing tests first** (seeded with `packages/reporting/test/fixtures.ts`): each table row's
  movements; a late ticket (`supplyDay` before its issue date) gives `issued_late` when the two
  dates are in different periods and `invoice` when not; a refund of a replacement belongs to the
  replacement's `supply_day`; a late ticket later replaced gives +ticket (belongs to its
  `supply_day`), −ticket (belongs to that same day) and +ticket (belongs to the replacement's day);
  a void of a corrective negates the corrective; V (void the original of a sale replaced with an
  earlier day): one "−" made on the void's day, belonging to the replacement's `supply_day`; R (void
  the replacement): no movement, and the sale's movements are as before the void; an F3 makes none;
  a payment on account and its table's invoice (seeded with `advanceRole` lines) each make one
  ordinary movement; a movement outside P in both dates is not returned.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/reporting exec vitest run
  src/vat-movements.test.ts`, then `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run
  scripts/corrective-sums.test.ts` at the root.

#### Task 2. The VAT return under the rule (`@waitron/reporting`, plus its server callers' tests)

**Files:** `packages/reporting/src/vat-return.ts`, `vat-return.test.ts`, `vat-summary.ts` (factor
the per-rate summing of `aggregateVatByRate`, `:71-100`, into an exported `sumByRate(rows)` it keeps
using, unchanged), `business-day.ts` (delete `activeSalesClause`, `:220-230`), `index.ts` (export
rename), `period.ts` (comment), `examples/modelo-303.md` (`:29-31` states today's rule);
`apps/server/src/accountant-export.ts` (rename, comment at `:209`), `accountant-export.test.ts`;
`scripts/corrective-sums.test.ts` (drop the `vat-return.ts` entry).

- `computeVatReturn` sums the movements that belong to P and were made by P's last day through
  `sumByRate`, then drops rate lines with base and VAT both zero. Its result shape is unchanged.
  `vatReturnDay` becomes `saleVatDay`, same body.
- **Failing tests first** in `vat-return.test.ts`: A, B, C and D from "What happens today", and V
  and R from Design, by quarter, each ended quarter unchanged by the later step; E gives `[]`; a
  line with base 0.00 and VAT not zero is kept; "every movement lands once": for a year seeded with
  every kind (late tickets and a payment on account included), the four quarterly returns plus, for
  each quarter, the movements made in it that belong to an earlier quarter (from `vatMovements`)
  equal the net of every movement of the year.
- **Deliberately changed checks** (name them in the PR): `vat-return.test.ts:168-177` (February no
  longer holds the replacement, made in March: February `[]`, March `[]`; March's corrections hold
  it), `:190-207` (February `[]`, March `[]`: the refund and the move are March corrections of
  February), `:210-224` (#3398's case: the first quarter `[]`, the second `[]`), `:237-250` (August
  keeps the sale, 100.00 at 21%; September `[]`; the third quarter `[]`; its name and its comment
  about Q25 change with it), and `apps/server/src/accountant-export.test.ts:803-874` (D13: its id
  lists stay; the per-quarter "equals the return" check becomes: the first quarter's return tax is
  `3.30` (the March original), the second's is `0.00` with no lines, and the two quarters' workbook
  VAT together equals the two returns plus the second quarter's corrections, read from
  `vatMovements`, `6.30`). `vat-return.test.ts:226-235` ("excludes a voided sale", same month) keeps
  expecting `[]` thanks to the zero-line drop; every other case passes unedited, including the
  quarter-equals-months case at `vat-return.test.ts:488-582`, whose data has no correction.
- Doc: `vat-return.ts`'s header states the rule in a few lines; `period.ts:87-95` narrowed to "the
  date filter", not the return; the example's `:29-31` sentence rewritten from the code.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/reporting exec vitest run
  src/vat-movements.test.ts src/vat-return.test.ts src/modelo-303.test.ts src/dr303.test.ts
  src/vat-summary.test.ts src/vat-summary-period.test.ts src/daily-close.test.ts
  src/business-day.test.ts`; then, because PR CI tests only the changed packages, the server's
  callers locally: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run
  src/report-api.test.ts src/reporting-write-workflows.test.ts src/return-records.real.test.ts
  src/accountant-export.test.ts src/report-api.accountant-export.test.ts
  src/full-invoice-creation-date.test.ts src/outside-payments-report.test.ts` (the last two import
  `accountant-export.ts`); then the root guard as in Task 1.

#### Task 3. The corrections list (`@waitron/reporting`)

**Files:** new `packages/reporting/src/vat-corrections.ts`, `vat-corrections.test.ts`; `types.ts`,
`index.ts`.

- `computeVatCorrections(tx, { year, period })` → `{ summary, rows }`. `rows`: the movements made in
  P that belong before P, each with the made day, kind, its own and its target's series code,
  number and issue date (the server formats numbers with `formatInvoiceNumber`, as
  `accountant-export.ts` does), the period it belongs to (same kind as P: `"2026-1T"`, `"2026-03"`,
  or `"2026"` for a year), rate, base, tax and `direction: "reduction" | "addition"` (D5).
  `summary`: sums by (belongs-to, rate, direction), sorted as in Design, base and VAT summed at
  money scale.
- **Failing tests first:** the August case (third-quarter corrections: −second, +first); #3398's
  late ticket (second-quarter corrections: +first, kind `issued_late`); a late table's invoice whose
  10% line is negative and 21% line positive lists a 10% reduction and a 21% addition for the
  earlier period; a corrective with one line up and one down splits into an addition and a
  reduction; a monthly P lists a cross-month correction that a quarterly P of the same quarter does
  not; a year P lists a correction of the previous year; empty period → empty.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/reporting exec vitest run
  src/vat-corrections.test.ts src/vat-movements.test.ts`.

#### Task 4. One workbook writer (`apps/server`, a move)

**Files:** new `apps/server/src/xlsx-workbook.ts`; `apps/server/src/accountant-export.ts`.

- Move `Cell`, `numeric`, `xmlText`, `worksheet`, the styles and the zip step
  (`accountant-export.ts:53-84`, `:169-198`) into `renderWorkbook(sheets: { name: string; rows:
  Cell[][] }[])`; the accountant workbook calls it.
- **Gate:** `accountant-export.test.ts`, `report-api.accountant-export.test.ts`,
  `full-invoice-creation-date.test.ts` and `outside-payments-report.test.ts` pass unedited
  beyond Task 2's change (they read the produced workbook). Add `xlsx-workbook.test.ts` only for
  what they do not cover (a sheet name escaped; the yield to the event loop is already covered at
  `accountant-export.test.ts:154`).
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run
  src/accountant-export.test.ts src/report-api.accountant-export.test.ts src/xlsx-workbook.test.ts
  src/full-invoice-creation-date.test.ts src/outside-payments-report.test.ts`.

#### Task 5. The corrections workbook and its route (`apps/server`)

**Files:** new `apps/server/src/corrections-report.ts`, `corrections-report.test.ts`,
`apps/server/src/i18n/corrections-report.ts` (English and Spanish words, the five kinds included);
`apps/server/src/report-api.ts`, new `report-api.corrections.test.ts`.

- `GET /management-api/reports/corrections?year=&period=`: `requireYear` and
  `requireLiquidationPeriod` as the VAT file route does (`report-api.ts:293-294`), gated by
  `report.export`, one transaction, `Cache-Control: no-store`, attachment
  `corrections-<year>-<token>.xlsx`, venue language (`toLanguage(deps.venueLocale)`).
- **Failing tests first:** a manager gets a workbook whose Summary and Corrections sheets hold the
  August example's rows with formatted invoice numbers, in English and in Spanish; a late ticket's
  row reads "Issued after its sale's period" / its Spanish label; a person without `report.export`
  gets 403; a bad period gets 400 naming `period`; no session 401.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run
  src/corrections-report.test.ts src/report-api.corrections.test.ts src/accountant-export.test.ts`.

#### Task 6. The button, the guide and the backlog

**Files:** `apps/dashboard/src/api/client.ts` (`downloadVatCorrections`, beside
`downloadVatReturnFile`, `:5076-5086`), `apps/dashboard/src/screens/vat-return-screen.ts`,
`vat-return-screen.test.ts`, `vat-return-screen.a11y.test.ts`, `apps/dashboard/src/i18n/strings.ts`
(English and Spanish: the button, the intro's warning); `apps/server/src/guide/en/invoices.md` and
`es/invoices.md`, `en/table-service.md:614-615` and its Spanish twin (the link);
`docs/backlog.md:278-281`, `:363-367`, `docs/backlog/fiscal.md:200-208`, `:944-978`.

- A secondary button **Download corrections (XLSX)** in the same `wt-form-actions`
  (`vat-return-screen.ts:196-205`), with its own busy state. It needs year and period only, so it
  stays enabled when no declaration type is chosen and does not mark the declaration type field.
- **The one bottom message** (`vat-return-screen.ts:196`, today `marked ? fix_fields : refusal`):
  a marked field's "fix the fields" message wins, as now. Pressing either button clears the last
  refusal (`refusal`, and any refused year or period). A corrections refusal that names `year` or
  `period` marks that field, as the file's does; any other corrections refusal goes in `refusal`
  and shows when no field is marked. Pressing the corrections button does not clear the
  declaration type's "required" mark left by an earlier file press.
- The intro gains the warning in plain words: corrections and late tickets made after a period ends
  are not in its file; download the corrections too before filing.
- **Failing tests first:** pressing it with no declaration type chosen asks the client for the
  chosen year and period and saves `corrections-2026-1T.xlsx`; a server refusal shows as the bottom
  message and the next press of either button clears it; a refusal naming `period` marks the period
  field; the a11y test covers the screen with both buttons in both themes.
- Guide (D9): a short section on what the file holds, what the corrections workbook holds, the
  warning above and that an ended period's sales side never changes, written from the code; same
  `{#vat-return}` id in both languages.
- Backlog: delete the corrections part of the fiscal.md entry and its "read, not run" sentence
  (`:974-975`), keep "a VAT rate set too low or too high" (waits on VAT rates per product) and the
  free list until PR 2; rewrite the void decision's "keeps its old behaviour" text at
  `docs/backlog.md:279` and `fiscal.md:202-205`.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/dashboard exec vitest run
  src/screens/vat-return-screen.test.ts src/screens/vat-return-screen.a11y.test.ts`, then
  `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run
  src/guide-content.test.ts` and `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run
  scripts/guide-links.test.ts`.

### PR 2: the margin setting and the free list

The PR's first line starts "Reset test venues:" (Task 7a rebuilds core's starting migration).

#### Task 7a. The margin column, the rebuild and the configuration copy (`@waitron/db`, `@waitron/provisioning`)

**Files:** `packages/db/src/schema/venue-service/service.ts` (column `estimatedMarginBp:
rate("estimated_margin_bp")`, CHECK `departments_estimated_margin_ck`: null or 0–10000), the
rebuilt `packages/db/drizzle/0000_baseline.sql`, `meta/0000_snapshot.json`, `meta/_journal.json`,
`scripts/migration-baseline-epoch.json` (generated); `packages/venue-service/src/schema/service.test.ts`
(its expected checks for `departments`, `:33-46`, gain the new one);
`packages/provisioning/src/configuration-transfer.ts` (format number up by one, `:146`, `:574` and
the `ConfigurationBundle` type) and the tests that pin the number, as #3783 touched them
(`packages/provisioning/test/configuration-bundle.ts`,
`packages/provisioning/src/configuration-transfer.privacy-contact.test.ts`,
`apps/server/src/configuration-transfer.test.ts`, `apps/server/src/configuration-import.test.ts`,
`apps/server/src/first-setup-command-start-again.test.ts:428`);
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (its departments column list,
`:391-393`, if the rebuild moves the column).

- **Failing tests first:** the CHECK refuses −1 and 10001 and takes 0, 3000 and 10000 (asserting the
  constraint by name, in `service.test.ts`); a configuration copy carries `estimated_margin_bp` on
  the exported departments row and to the importing venue (copy
  `apps/server/src/configuration-transfer.test.ts:3778-3818`, the late-send case).
- Then `pnpm --filter @waitron/server migration-baseline rebuild --set core`, and RUN, as CLAUDE.md
  §3 asks: `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/schema-constraints.test.ts
  scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
  scripts/starting-migrations.test.ts` and `env -u AI_AGENT -u CLAUDECODE pnpm --filter
  @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/venue-service exec vitest run
  src/schema/service.test.ts`, `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/provisioning
  exec vitest run`, `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run
  src/configuration-transfer.test.ts src/configuration-import.test.ts
  src/first-setup-command-start-again.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts`.

#### Task 7b. Saving and reading the margin (`@waitron/venue-service`)

**Files:** `packages/venue-service/src/operations.ts` (`DepartmentEditInput` and
`saveDepartmentEditSettings`, `:665-700`, which the settings route calls, and `updateDepartment`,
`:214-245`, which it calls in turn), `routes.ts` (the settings route `:782-860`, and the read model
`:526-542`), a reader beside `listLateSendManagerDepartmentIds`
(`packages/venue-service/src/late-send.ts:19`), `packages/venue-service/src/dashboard/client.ts`
(the read model's type, `:103`, and the request body); the read model's test fixtures that list
`lateSendManagerDepartmentIds` (`packages/venue-service/src/testing/department-edit-fixture.ts`,
`department-zones-fixture.ts`, `packages/venue-service/test/service-delete-test-helpers.ts`,
`apps/dashboard/src/testing/department-receipt-app-fixture.ts`); `routes.test.ts`.

- The route reads `estimatedMargin`: absent leaves it, `null` clears it, a dot-decimal string from
  `0` to `100` with at most two decimals is stored as basis points; anything else is
  `management.request_invalid` with `field: "estimatedMargin"`. The read model gains
  `estimatedMarginByDepartment: Record<string, string>` (only departments with a margin, as
  `"30.00"`), the way it carries `lateSendManagerDepartmentIds`; `listDepartments` (`:77-99`, id,
  name and trading name) is not widened.
- **Failing tests first:** the route saves `"30"` as 3000 and the read model answers `"30.00"`;
  `null` clears it; a save without the key leaves it; `"101"`, `"-1"`, `"30.001"`, `"abc"` and `30`
  (a number) are refused naming the field.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/venue-service exec vitest run
  src/routes.test.ts src/operations.test.ts`, then the package typecheck and `pnpm --filter
  @waitron/dashboard typecheck` (the dashboard fixture).

#### Task 8. The margin field in the department editor (`@waitron/venue-service` dashboard)

**Files:** `packages/venue-service/src/dashboard/department-settings.ts` (Details tab,
`:1098-1146`; tab map `:86-102`, field list `:103-119`; draft comparison `:140-152`),
`packages/venue-service/src/dashboard/strings.ts` (English and Spanish: label, hint, the out-of-range
message), `department-settings.test.ts`, `department-settings.unsaved.test.ts`,
`department-settings.a11y.test.ts`.

- As Design, "The margin field". The draft takes the saved value from the read model's
  `estimatedMarginByDepartment` (Task 7b), as it takes `lateSendNeedsManager` from
  `lateSendManagerDepartmentIds` (`department-settings.ts:442`).
- **Failing tests first:** the field shows a saved `"30.50"` in the screen's decimal mark (`30,50` in
  Spanish); typing `30,5` saves `"30.5"`; clearing it saves `null`; `101` is marked beside the field
  after Save is pressed, with the one bottom message, and Save stays disabled until it is fixed;
  an unchanged draft leaves Save quiet; leaving with a changed margin asks to discard
  (`*.unsaved.test.ts`); the a11y test covers the field empty, filled and refused in both themes.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/venue-service exec vitest run
  src/dashboard/department-settings.test.ts src/dashboard/department-settings.unsaved.test.ts
  src/dashboard/department-settings.a11y.test.ts` (browser: check `memory_pressure | grep free`
  first).

#### Task 9. Line ids on the Adjustments report's entries (`@waitron/adjustments`)

**Files:** `packages/adjustments/src/reports.ts` (`AdjustmentEntry` `:99-133`, `readEntryRows`
`:316-356`), its test.

- Add `lineId: string | null` to each entry. Nothing else changes. `feat/h-a1308-os12-common-refunds`
  changes two lines of this file; whichever lands second rebases.
- **Failing test first:** an entry for a comp carries its line's id, a bill discount `null`. Update
  any `toEqual` on whole entries in the module's tests and route tests to include the field (name
  them in the PR).
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/adjustments exec vitest run
  src/reports.test.ts` and the module's route tests found by `git grep -ln listAdjustmentEntries
  packages/adjustments apps`.

#### Task 10. The Given free sheet (`apps/server`)

**Files:** new `apps/server/src/free-items.ts`, `free-items.test.ts`;
`apps/server/src/corrections-report.ts`, its test and words; the backlog entry
(`docs/backlog/fiscal.md:944-978`: delete the free-meals part; the entry then holds only the
wrong-rate part; `docs/backlog/fiscal.md:28`, A445's pointer, still holds).

- First establish, with a test through `apps/server/src/testing/adjustment-venue.ts`, which row an
  adjustment's `line_id` names when the comp covers part of a line (the row split off or the one it
  came from, see its `splits`), and that a settled bill's comped line is still found after
  settlement; record both in the PR. Then establish that a comped dish taken off the bill after
  serving leaves no `working_order_lines` row (the schema's comment says a cancel deletes the line,
  `adjustments.ts:44-46`); if a row stays, stop and report, since D3's reading then needs the
  cancel's own adjustment row instead.
- `listFreeItems(tx, clock, { year, period })` pages through `listAdjustmentEntries` (500 a page)
  over the period's first to last business day (`resolveVenueClock`, as `report-api.ts` does), and
  keeps the entries whose action is not `cancel` and whose `afterAmount` is zero, dropping a dish
  entry when neither its `lineId` nor any row its `splits` names still exists in
  `working_order_lines` (D3). _As built, 2026-11-22:_ it checks instead the rows each adjustment
  took money off, through `adjustment_lines`, leaving out rows on abandoned bills. One query reads, for the kept line ids, whether each exists, its
  current bill, its `offer_department_id`; one reads each bill's department and its invoice
  (series code, number; `sales_working_order_id_key` makes it one); one reads the departments'
  names and margins. Amounts are the entries' decimals; the estimated cost as Design. Staff names in
  the entries are not used.
- **Failing tests first:** listed: a comp on a dish that reached the bill; a 100% discount; an
  amount discount to zero on a dish; a whole-bill discount to zero ("Whole bill", the bill's
  department); a comped dish cancelled with its charge kept; a comped dish moved to another bill
  (the new bill's invoice number). Not listed: a comped dish later taken off the bill, before firing
  and after serving; a partial discount; any cancel; an adjustment on a bill opened outside the
  period. Estimated cost (D14, without VAT): an €11.00 dish at 10%, 30% margin, gives
  €7.00; a €12.10 dish at 21% at 33.33% gives €6.67 (10.00 × 0.6667, half up); a takeaway bill takes
  the dish's takeaway class; a whole bill of an €11.00 dish at 10% and a €12.10 dish at 21%, 30%
  margin, gives €14.00; a department with no margin, and a bill with no department, leave it blank;
  a dish ordered in the Bar and moved to a Restaurant bill takes the Bar's margin (D11). The
  workbook's third sheet holds these rows with the formatted invoice number, in both languages.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run
  src/free-items.test.ts src/corrections-report.test.ts src/report-api.corrections.test.ts`.

#### Task 11. The guide for the free list and the margin (`apps/server` guide, English and Spanish)

**Files:** `apps/server/src/guide/en/invoices.md`, `apps/server/src/guide/es/invoices.md`.

- The `{#vat-return}` section (Task 6) gains a short paragraph on the Given free sheet (what is on
  it, and that a dish taken off the bill is not) and where to set the margin (Departments and zones
  › the department › Details › Estimated margin), with how the estimated cost is worked out (D14).
  Written from the code, in both languages, same heading id.
- Commands: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run
  src/guide-content.test.ts` and `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run
  scripts/guide-links.test.ts`.

## Left open

- The wrong-rate section, after "VAT rates per product" lands.
- Whether the adviser agrees with the owner's 16 November D12 and with D1's reading of "filed";
  both are reversible (D2).
- The purchases side of the return still follows edits to a supplier invoice's received date; the
  owner's decisions speak only of sales corrections, so this plan leaves it as it is.
- A cross-check that a quarter's file plus later quarters' corrections equal what the chain filed is
  not built; Task 2's "every movement lands once" test covers the arithmetic only.
- Two ways an ended period's sales side can still change: a record stamped by a wrong clock (A1420
  D8), and invoices and voids another box made in that period and returns after a handover, since
  nothing records when they arrived. No column is added for the second.
- Three backlog entries still wait for the lifted A1308 hold (`docs/backlog.md:1264`, `:1604`,
  `:1814`); for the watcher, not changed here.

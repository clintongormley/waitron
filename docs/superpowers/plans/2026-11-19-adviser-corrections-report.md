# Plan: the accountant's corrections report (ADVISER-CORRECTIONS-REPORT)

Status: written 2026-11-19, lane L. Not built. FISCAL: the owner lands it. Read at main
`9faf8661eb`. **RAN** = a command was run and its output read; every other citation was read at
that commit, not run. Unmarked reasoning is inference.

Words used below. The **VAT return** is the quarterly tax form (modelo 303) that Waitron's
dashboard builds as a file for the accountant to upload. A **corrective** is an invoice that changes
an earlier one: a refund, a cancelled dish on a paid bill, a goodwill return. A **replacement** is
the kind of corrective that repeats a refused ticket in full with the day the sale really happened.
A **void** (annulment) cancels a record outright. A **comp** is a dish given free with a reason.

## Part 1, for the owner

**What you asked for.** Your decisions D6 and D12 of 16 November
(`docs/compliance/2026-11-15-adviser-answers.md:340-343`, `:524-527`): "a filed report never
changes", and "we use a corrections report instead of just adding the transaction to the current
period". Your answers of 18 November (`docs/compliance/2026-11-19-adviser-meeting.md`): to the VAT
plan, "yes", and "any correctives to the previous quarter should be reported in the correctives
report" (`:202`); a rate set too low, "it should be per invoice line. but we should just produce a
corrections report which goes to the accountant" (`:154`); a rate set too high, "Again, we just
produce a correction report which goes to the accountant" (`:155`); a meal given free, "this should
be part of some report that we make available to the accountant to decide what to do" (`:165`).
These are your answers, not the adviser's; the adviser will come back with more details (`:22-23`).

**What the accountant gets when this lands.**

1. The VAT return file for a quarter counts that quarter's invoices and the corrections made to them
   in the same quarter, and nothing else. Once the quarter has ended, nothing done later changes its
   file. Today it does (see "What happens today": a later void or a date replacement rewrites an
   ended quarter's figures, RAN).
2. On the same screen, a second button, **Download corrections (XLSX)**, for the same year and
   period. It lists every correction made in that period to an invoice whose VAT belongs to an
   earlier period: a summary by the earlier period and VAT rate, reductions and additions apart, and
   one row per correction with both invoice numbers and dates. The accountant decides whether to
   file each as a complementary return, ask for the old return to be corrected, or take it in the
   current return.
3. A third sheet in that workbook lists what was given free in the period: each free dish or free
   bill, with the reason and note staff gave, its menu price and the ticket it was on.

**What is not in it.** A VAT rate found wrong later (too low or too high) is not built: Waitron has
no way yet to record that a product's rate was wrong from a given day, and that belongs to the
"VAT rates per product" design, which is not written yet (`docs/backlog/fiscal.md:873-874`). Once a
product has dated rates, the wrong-rate section can be worked out per invoice line from what each
ticket stored, as you asked; it is a later item. Waitron files nothing here: no change to the tax
records, their fingerprints, the chain, invoice numbers or the record builders.

**Your decisions** (default first):

- **D1. When a quarter counts as "filed".** Nothing in Waitron records that a return was filed
  (RAN, see below). Default: **a period counts as closed the day it ends.** A correction made after
  the end goes on the corrections report, never into that period's file. This is exactly D12's
  wording ("a correction made later to an earlier quarter's invoice is never counted in the current
  quarter", `adviser-answers.md:516-519`) and gives your 18 November example the answer the sheet
  gave (`adviser-meeting.md:192`, worked through under Design). It needs no new table, so it
  does not wait for the A1308 table hold (`docs/backlog.md:1605`). The cost: a refund made on 3 April
  of a 30 March meal is not in the first quarter's file even if the accountant files on 20 April; it
  is on the second quarter's corrections report, which can be downloaded at any time, and the
  accountant adds it by hand if they want it in the first return. The same rule applies to monthly
  returns, which the screen also offers. Alternatives: (b) a person presses **Mark as filed** for a
  quarter: a new table (waits for the A1308 hold), a quarter forgotten keeps changing after it was
  filed, and a wrong press needs undoing; (c) the legal filing deadline: the accountant may file
  earlier, and the file would then change after filing.
- **D2. Build now or wait for the adviser.** Default: build now; you land it. Nothing stored
  changes: every figure is worked out again from the invoices each time, so if the adviser answers
  differently, a later change to this rule harms no data.
- **D3. What counts as "given free".** Default: a dish comped; a discount that left a dish or a
  bill at zero (an amount, or 100%); and a dish already served that was cancelled without keeping
  the charge (a cancelled served dish was eaten and not paid for). Each row says which. Alternative:
  comps only.
- **D4. The 30% margin.** You wrote "Saying that our margin is 30% so our cost is 70% gives you a
  basis for working out the VAT to invoice" (`adviser-meeting.md:165`). Default: leave it out. The
  free list shows each item's menu price with VAT included; the accountant applies their own basis.
  The rate of a free dish is not stored per dish today (only per rate total on the ticket), so a
  "VAT at cost" column could not be filled reliably before "VAT rates per product" lands.
  Alternative: a column "70% of the menu price".

**Size.** Two pull requests. PR 1 (the period rule and the corrections list): about 480 lines of
code and 850 of tests, plus about 40 lines of guide and backlog text, about 18 files. PR 2 (the free
list): about 130 lines of code and 200 of tests, about 6 files. No database change, no generated
files.

## Should this exist?

1. **Need.** In the owner's words above: a filed quarter's figures never change, and later
   corrections, wrong rates and free meals go on a report the accountant acts on. When this lands
   the accountant can download, per period, a VAT file that stays fixed once the period ends, and a
   workbook of later corrections by earlier period and rate, plus the free list. Still unavailable:
   the wrong-rate section (waits on "VAT rates per product"). **Simplest alternative.** Changing
   nothing leaves the VAT file contradicting D12 (a later void or date replacement rewrites an ended
   quarter, RAN). Adding columns to the existing **Download for accountant (XLSX)** workbook
   (`apps/server/src/accountant-export.ts:28-44` already lists correctives with the original's
   number) was considered and rejected: that workbook takes any date range, while "an earlier
   period" depends on whether the venue files monthly or quarterly; a quarterly filer handed a
   month-based list would add May's corrections of April sales twice. So the list sits beside the
   VAT file, on the same chosen period. Beyond the minimum: the free list (asked for) and the
   summary sheet (asked for: "listed by original quarter and rate").
2. **True size.** Estimated above: about 24 files, about 610 lines of code and 1,050 of tests, no
   generated files, no migration. Later changes get smaller: the VAT period rule lives in one
   function, which #3398 (LATER-SALE-DATE) then needs not edit (see Interplay).
3. **Approval.** D6 and D12 are recorded at `adviser-answers.md:340-343` and `:524-527`; the 18
   November answers at `adviser-meeting.md:154-155`, `:165`, `:202`. This plan's design (D1-D10) is
   not approved by anyone yet; the watcher queued the item ("Medium; plan first", per the brief).

## What happens today

- **The VAT return counts a sale by its issue date, or by its replacement's real day**
  (`packages/reporting/src/vat-return.ts:35-43`), leaves out every voided sale whenever the void was
  made, every replacement and every exchange invoice (`packages/reporting/src/business-day.ts:206-230`),
  and counts each corrective in its own issue period at the rates of its own stored VAT split.
  **RAN** a throwaway test (`packages/reporting/src/zz-throwaway-filed-quarter.test.ts`, deleted
  after; `pnpm --filter @waitron/reporting exec vitest run src/zz-throwaway-filed-quarter.test.ts`,
  3 passed), one ticket at 10%, €11.00:
  - A, ticket 10 Feb, corrective −€5.50 issued 10 May: first quarter before and after
    `[{"rate":"10.00","base":"10.00","tax":"1.00"}]`, second quarter
    `[{"rate":"10.00","base":"-5.00","tax":"-0.50"}]`. The first quarter does not change; the
    reduction lands in the second.
  - B, ticket stamped 1 April, replacement on 10 May naming 31 March: first quarter before `[]`,
    after `[{"rate":"10.00","base":"10.00","tax":"1.00"}]`; second quarter before that line, after
    `[]`. **An ended quarter's figures change.**
  - C, ticket 10 Feb, void recorded 10 May: first quarter before the line, after `[]`; second
    quarter `[]`. **An ended quarter's figures change.**
  So the backlog's "read, not run" sentence (`docs/backlog/fiscal.md:944-946`) holds for A and B,
  and C (voids) is a third case. Three existing tests pin today's replacement,
  refund-of-replacement and void behaviour by month
  (`packages/reporting/src/vat-return.test.ts:168-177`, `:190-207`, `:221-234`).
- **Voids have no product caller.** `recordVoid` (`packages/core/src/record-void.ts:24`) is called
  outside tests only by `apps/server/src/testing/order-venue.ts:241` (RAN `git grep -n "recordVoid("`
  over `apps/` and `packages/`). The rule must still treat them correctly.
- **Replacements come only from a ticket AEAT refused as dated in the future** (`1112`), put right
  from the case dialog with the real day (`packages/fiscal-verifactu/src/record-remedy-replacement.ts:20-25`,
  stored as `sales.supply_day`, `packages/db/src/schema/sales.ts:103-105`, `:149`). A replacement
  carries the original's own total and VAT split (`packages/core/src/record-replacement.ts:41-46`)
  and is refused once the original has any corrective (`:111-114`); later correctives go to the
  replacement (`packages/core/src/correction-target.ts:12-18`). So a corrective chain is at most
  corrective → replacement → original.
- **Nothing records that a return was filed.** RAN `git grep -n -i "quarter.*filed\|filed_at\|period_closed\|vat_period\|return_filed\|closed_period\|period_lock"`
  over `packages/db/src/schema`, `packages/reporting/src` and `apps/server/src`: no match. The VAT
  file download writes no activity (`apps/server/src/report-api.ts:297-335`), and `activity_log` may
  not drive a product decision anyway (CLAUDE.md §3).
- **Where it is shown.** **VAT return (modelo 303)** in the dashboard
  (`apps/dashboard/src/screens/vat-return-screen.ts`) downloads the file from
  `GET /management-api/reports/modelo-303` under permission `report.export`
  (`apps/server/src/report-api.ts:83`, `:297-335`), held by managers by default
  (`packages/identity/src/permissions.ts:25`). The screen offers quarters and months. No guide
  section describes it (RAN `grep -rn -i "303\|vat return" apps/server/src/guide/en/*.md`: none).
- **Free dishes carry a reason.** Every comp, discount and cancellation is an `adjustments` row with
  the reason's name and the staff note copied at the time, the action, the amounts (VAT included),
  the dish's stage and whether a cancel kept the charge
  (`packages/db/src/schema/adjustments/adjustments.ts:53-83`). `isFullComp`
  (`packages/adjustments/src/full-comp.ts:8-13`) already names "free". New venues start with the
  reasons Complaint, On the house, Staff meal and Discount (`packages/adjustments/src/starter-content.ts:36-49`).
  The adjustments module is mandatory and keeps its tables in core's set
  (`packages/composition/src/modules.ts:363-377`), and `apps/server` already imports it.
- **Wrong rates.** Products still carry VAT classes (`packages/db/src/schema/orders.ts:228-235`); no
  dated rate history exists, and its design is not written (`docs/backlog/fiscal.md:873-874`).

## Design

**The rule.** Every invoice and correction becomes one or two *VAT movements*, each with a rate
line (rate, base, VAT), a sign, the **day it was made** and the **day its VAT belongs to**:

| Row | Movement | Made | Belongs to |
| --- | --- | --- | --- |
| Ordinary invoice (not an exchange, not a corrective) | + its VAT split | its issue date | `coalesce(supply_day, issue date)` |
| Corrective that is not a replacement | + its (usually negative) split | its issue date | the day its target's VAT belongs to: a replacement's `supply_day`, else the original's day |
| Replacement with a `supply_day` | − the split, and + the split | its issue date | the original's day, and the `supply_day` |
| Replacement without one | none | | |
| Void of any row | the negation of that row's movements | the void's date (in the voided sale's offset, D7) | as for that row |
| Exchange invoice (F3) | none (its tickets carry the VAT) | | |

A period P's **VAT return** sums the movements that belong to P and were made on or before P's
last day. P's **corrections** are the movements made in P that belong before P's first day. Every
movement lands exactly once: in the return of the period it belongs to, when it was made no later
than that period ends, otherwise on the corrections of the period it was made in. A period that has
ended never changes, except for a record stamped with a wrong clock, which A1420 D8 leaves
uncorrected.

**The 18 November example, under the rule.** Ticket stamped 1 April, really 31 March, replacement
in May: the second quarter's return holds +ticket (1 April) and −ticket (made May, belongs 1 April),
so it stops counting it; the first quarter's return is unchanged; the second quarter's corrections
show +ticket as an addition for the first quarter. Found in August instead: the third quarter's
corrections show a reduction for the second and an addition for the first ("any correctives to the
previous quarter should be reported in the correctives report").

**What changes for monthly periods.** A May correction of an April sale is in neither month's
return; it is on May's corrections. So a quarter no longer always equals the sum of its months
(today's comment `packages/reporting/src/period.ts:88-97` says it does; it stays true of the date
filter, and `vat-return.ts`'s header says the rule).

**Reductions and additions** are split per rate line by the sign of its base, or of its VAT when
the base is zero (D5).

**The workbook** (`corrections-<year>-<period>.xlsx`, in the venue's language like the accountant
workbook): sheet **Summary** (made period, belongs to, rate, reduction or addition, base, VAT,
sorted by belongs-to then rate, reductions first; one line "No corrections" when empty), sheet
**Corrections** (made date, kind, invoice number, corrects invoice number and its date, belongs to,
rate, base, VAT, reduction or addition), and in PR 2 sheet **Given free** (date, ticket number when
one exists, ticket total, item or "Whole bill", quantity, kind, menu price given, reason, note).
Kinds: Correction, Void, Date moved out, Date moved in, Issued after its sale's period (the last
only once #3398 lands). No staff or customer names.

**Watcher decisions** (default first):

- **D5.** Reduction or addition by the sign of each rate line's base (VAT when the base is zero).
- **D6.** Delivery: a button on the VAT return screen, same year and period as the file,
  `GET /management-api/reports/corrections`, permission `report.export`, no activity record (like
  the VAT file; the workbook names no customer or staff member). Why not the accountant workbook:
  see "Should this exist?".
- **D7.** A void's date uses the voided sale's own offset; `sale_voids` stores no offset
  (`packages/db/src/schema/sale-voids.ts:12-39`) and no product path voids today.
- **D8.** A corrective of an exchange invoice (F3) belongs to the F3's own date.
- **D9.** A new guide section "VAT return and corrections" `{#vat-return}` in `invoices.md`, English
  and Spanish; the screen has none today.
- **D10.** The free list is chosen by when the adjustment was made, in the venue's time zone (as the
  accountant workbook chooses outside payments, `apps/server/src/accountant-export.ts:254-262`),
  not by ticket date, because whether a bill that is free in full issues a ticket is not
  established (Task 6 establishes it first and shows the ticket number when one exists).

## Interplay

- **#3398 LATER-SALE-DATE** (`feat/later-sale-date` at `a20aed887b`, not on main). It lets an
  ordinary sale carry `sales.supply_day` and edits `vat-return.ts:40` to count by it, through a new
  `vatReturnDay` helper (read: `git diff main...feat/later-sale-date -- packages/reporting/src/`);
  its D4 (unapproved) hands "invoices issued after their sale day's quarter was filed" to this item
  (`docs/superpowers/plans/2026-11-15-later-sale-date.md:575-590`, in that worktree). The rule above
  already reads `coalesce(supply_day, issue date)` for ordinary invoices; on main the column is
  always null there (`sales_supply_day_ck`, `packages/db/src/schema/sales.ts:149`), so it is a no-op
  until #3398 lands, then lists a late invoice under "Issued after its sale's period" with no further
  code. **If this lands first:** #3398's rebase drops its `vat-return.ts` and `vatReturnDay` edit
  (keeping its accountant-workbook sale-date column, which needs only a day helper of its own or
  `vatMovementDay` from Task 1), and adds the test "an F2 issued 1 April with `supply_day` 31 March:
  the first quarter's return is unchanged, the second quarter's corrections list an addition for
  the first". Recommend the runner add that line to #3398's queue entry. **If #3398 lands first:**
  Task 1 here takes main's `vatReturnDay` call out of `computeVatReturn` and adds that test itself;
  #3398's fixture already seeds an ordinary sale's `supply_day`.
- **Other lanes.** RAN `git diff --stat main...<branch>` over `packages/reporting`, `sales.ts`,
  `sale-voids.ts`, the adjustments schema, `accountant-export.ts`, `report-api.ts` and
  `vat-return-screen.ts` for every branch in `git worktree list` (advances, close-of-day ticket,
  goodwill corrective, no-none, one-way-to-pay and its till half, meal-end ticket, receipt owed,
  A1308 OS8 pre-plan): only `feat/later-sale-date` touches them. The goodwill corrective and
  advances branches create invoices through the existing paths, so their correctives would appear on
  this report with no change here (inferred from their names and the paths above, not read).
- **A1308 table hold.** No new table or column, so the hold does not apply. D1 (b) would add a table
  and wait for it.
- **Guards this touches.** `scripts/corrective-sums.test.ts` flags any SQL equality on
  `corrects_sale_id` (`:21-22`) and allows `vat-return.ts`'s join by name (`:69-74`); the movement
  query's joins replace that entry with entries of their own, each with its reason. It reads text.

## Tasks

Every task: test first, watch it fail, then the code. Focused runs use
`env -u AI_AGENT -u CLAUDECODE pnpm --filter <pkg> exec vitest run <files>` and read the `Tests`
count (`pnpm test <file> -t` drops `-t`). Every task ends with the package typecheck, `pnpm exec
prettier --check` on the changed files, and the fiscal gate, unedited:

```
env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu exec vitest run src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts src/inmutabilidad.test.ts
git diff --exit-code main -- packages/fiscal-verifactu packages/core/src packages/db/src/schema packages/db/triggers
```

(RAN the first line at `9faf8661eb`: 4 files, 15 tests passed.) `git commit -s` per task.

### PR 1: the period rule and the corrections list

#### Task 1. VAT movements, and the VAT return under the rule (`@waitron/reporting`)

**Files:** new `packages/reporting/src/vat-movements.ts` and `vat-movements.test.ts`;
`packages/reporting/src/vat-return.ts`, `vat-return.test.ts`, `vat-summary.ts` (factor the
per-rate summing loop of `aggregateVatByRate`, `:71-99`, into an exported `sumByRate(rows)` it keeps
using), `business-day.ts` (delete `activeSalesClause`, `:220-230`, once unused);
`scripts/corrective-sums.test.ts` (allowlist).

- `vatMovements(tx, { year, period })` returns one row per stored rate line of each movement in the
  table above that belongs to P or was made in P, with: rate, base, tax (signed), made day, belongs
  day, kind, the row's sale id, and the corrected sale's id. One SQL statement (a `with` of `union
  all` branches plus the voids' negation, `json_each` over `vat_breakdown`), dates as in
  `vat-return.ts:35`; awaited, no `Promise.all`.
- `computeVatReturn` sums the movements that belong to P and were made by P's last day, through
  `sumByRate`. Its result shape is unchanged.
- **Failing tests first** (`vat-movements.test.ts`, seeded with `packages/reporting/test/fixtures.ts`):
  each table row's movements; a refund of a replacement belongs to the replacement's `supply_day`;
  a void of a corrective negates the corrective; an F3 makes none. In `vat-return.test.ts`: A, B and
  C from "What happens today" by quarter, each ended quarter unchanged by the later step; "every
  movement lands once": for a year seeded with every kind, the four quarterly returns plus, for each
  quarter, the movements made in it that belong to an earlier quarter (read from `vatMovements`)
  equal the net of every movement of the year.
- **Deliberately changed checks** (name them in the PR): `vat-return.test.ts:168-177` (February no
  longer holds the replacement: it was made in March; March's corrections do),
  `:190-207` (February holds nothing, March nothing: the refund and the move are March corrections
  of February), `:221-234` (August keeps the sale; the September void is a September correction;
  the third quarter nets to nothing). Every other case passes unedited, including the
  quarter-equals-months case at `:472`, whose data has no correction.
- Doc: `vat-return.ts`'s header states the rule in a few lines; `period.ts:88-97` narrowed to "the
  date filter", not the return. Commands: `vitest run src/vat-movements.test.ts src/vat-return.test.ts
  src/modelo-303.test.ts src/dr303.test.ts`, then the root guard `pnpm exec vitest run
  scripts/corrective-sums.test.ts`.

#### Task 2. The corrections list (`@waitron/reporting`)

**Files:** new `packages/reporting/src/vat-corrections.ts`, `vat-corrections.test.ts`; `types.ts`,
`index.ts`.

- `computeVatCorrections(tx, { year, period })` → `{ summary, rows }`. `rows`: the movements made in
  P that belong before P, each with the made day, kind, its own and its target's series code,
  number and issue date (the server formats numbers with `formatInvoiceNumber`, as
  `accountant-export.ts` does), the period it belongs to (same kind as P: `"2026-1T"` or
  `"2026-03"`), rate, base, tax and `direction: "reduction" | "addition"` (D5). `summary`: sums by
  (belongs-to, rate, direction), sorted as in Design, base and VAT summed at money scale.
- **Failing tests first:** the August case (third-quarter corrections: −second, +first); a corrective
  with one line up and one down splits into an addition and a reduction; a monthly P lists a
  cross-month correction that a quarterly P of the same quarter does not; empty period → empty.
- Commands: `vitest run src/vat-corrections.test.ts`.

#### Task 3. One workbook writer (`apps/server`, a move)

**Files:** new `apps/server/src/xlsx-workbook.ts`; `apps/server/src/accountant-export.ts`.

- Move `worksheet`, the styles and the zip step (`accountant-export.ts:51-82`, `:165-192`) into
  `renderWorkbook(sheets: { name: string; rows: Cell[][] }[])`; the accountant workbook calls it.
- **Gate:** `accountant-export.test.ts` and `report-api.accountant-export.test.ts` pass unedited
  (they read the produced workbook). Add `xlsx-workbook.test.ts` only for what they do not cover (a
  sheet name escaped; a 250-row yield is already covered at `accountant-export.test.ts:146`).

#### Task 4. The corrections workbook and its route (`apps/server`)

**Files:** new `apps/server/src/corrections-report.ts`, `corrections-report.test.ts`,
`apps/server/src/i18n/corrections-report.ts` (English and Spanish words);
`apps/server/src/report-api.ts`, new `report-api.corrections.test.ts`.

- `GET /management-api/reports/corrections?year=&period=`: `requireYear` and
  `requireLiquidationPeriod` as the VAT file route does (`report-api.ts:300-301`), gated by
  `report.export`, one transaction, `Cache-Control: no-store`, attachment
  `corrections-<year>-<token>.xlsx`, venue language (`toLanguage(deps.venueLocale)`).
- **Failing tests first:** a manager gets a workbook whose Summary and Corrections sheets hold the
  August example's rows with formatted invoice numbers, in English and in Spanish; a person without
  `report.export` gets 403; a bad period gets 400 naming `period`; no session 401.
- Commands: `pnpm --filter @waitron/server exec vitest run src/corrections-report.test.ts
  src/report-api.corrections.test.ts src/accountant-export.test.ts`.

#### Task 5. The button, the guide and the backlog

**Files:** `apps/dashboard/src/api/client.ts` (`downloadVatCorrections`, beside
`downloadVatReturnFile`, `:5030-5040`), `apps/dashboard/src/screens/vat-return-screen.ts`,
`vat-return-screen.test.ts`, `vat-return-screen.a11y.test.ts`, `apps/dashboard/src/i18n/strings.ts`
(English and Spanish: the button, one intro sentence); `apps/server/src/guide/en/invoices.md` and
`es/invoices.md`; `docs/backlog.md:282-285`, `:367-371`, `docs/backlog/fiscal.md:170-176`,
`:915-948`.

- A secondary button **Download corrections (XLSX)** in the same `wt-form-actions`
  (`vat-return-screen.ts:196-205`). It needs year and period only, so it stays enabled when no
  declaration type is chosen, has its own busy state, and shows a refusal like the first button.
  The intro gains one sentence: corrections made after a period ends are on its own list, not in
  the file.
- **Failing tests first:** pressing it with no declaration type chosen asks the client for the
  chosen year and period and saves `corrections-2026-1T.xlsx`; a refusal shows under the actions;
  the a11y test covers the screen with both buttons in both themes.
- Guide (D9): a short section on what the file holds, what the corrections workbook holds and that
  an ended period's file never changes, written from the code; same `{#vat-return}` id in both
  languages. `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts` pass.
- Backlog: delete the corrections part of the fiscal.md entry and its "read, not run" sentence,
  keep "a VAT rate set too low or too high" as the remaining part (waits on VAT rates per product)
  and the free list until PR 2; update the void decision's "keeps its old behaviour" text at
  `docs/backlog.md:283` and `fiscal.md:174-176`.
- Commands: `pnpm --filter @waitron/dashboard exec vitest run src/screens/vat-return-screen.test.ts
  src/screens/vat-return-screen.a11y.test.ts` (browser: check `memory_pressure | grep free` first),
  then the two guide guards.

### PR 2: the free list

#### Task 6. Free items (`@waitron/adjustments`)

**Files:** new `packages/adjustments/src/free-items.ts`, `free-items.test.ts`; `index.ts`.

- First establish, with a test through the server's bill fixtures
  (`apps/server/src/testing/adjustment-venue.ts`), whether a bill comped in full issues a ticket;
  record the answer in the PR. The list does not depend on it (D10).
- `listFreeItems(tx, window)` → rows for D3's three kinds, made inside the window: date, the
  working order's sale (series code, number, total) when one exists, line name or none for a whole
  bill, quantity, kind, `reduction` as the menu price given, reason name, note. Bill-level rows
  (`line_id` null) say "Whole bill".
- **Failing tests first:** a comp, a 100% discount, an amount discount to zero, a served dish
  cancelled without the charge are listed; a partial discount, a cancel before firing and a served
  cancel that kept the charge are not; an adjustment outside the window is not.
- Commands: `pnpm --filter @waitron/adjustments exec vitest run src/free-items.test.ts`.

#### Task 7. The Given free sheet

**Files:** `apps/server/src/corrections-report.ts`, its test and words; the guide section (both
languages); the backlog entry (delete the free-meals part; the entry then holds only the wrong-rate
part).

- The route builds the window from the period's first and last day in the venue's zone
  (`readVenueClock`, cutover `00:00`, as `accountant-export.ts:254-262`) and adds the sheet.
- **Failing test first:** the workbook's third sheet lists Task 6's rows with the formatted ticket
  number, in both languages.

## Left open

- The wrong-rate section, after "VAT rates per product" lands.
- Whether the adviser agrees with D12 and with D1's reading of "filed"; both are reversible (D2).
- A cross-check that a quarter's file plus later quarters' corrections equal what the chain filed is
  not built; Task 1's "every movement lands once" test covers the arithmetic only.

# R2: Find a bill (lane O, TILL-REDESIGN-PAY-3)

What staff get: ☰ → Bills and cash opens one list of finished sales, newest first: the time, the
table or the counter's order number, how it was paid (a card's last four digits) and who served,
and the amount over the receipt number. Full invoices and refunds carry a small label. One search
box finds a number, a table, a name, card digits or an amount: a guest who says "you charged me
€80.52" is found by typing 80,52. Chips choose the days, the staff member and the kind. Refunds
still waiting on the card company sit in a strip on top. A row opens the receipt as today. The
Bills tab of open bills goes; bills still owed after the guest left get a strip of their own.

Sources: spec §7.12, §7.13, §13 (pass 3), §14 and §14.2; frame `be` 1 and 2 (`html/be-*.html`,
`base.css`); the R2 row of `2026-11-26-o-till-payment-after-pay.md`; the watcher's clearance,
26 November 23:08, change 4 ("amount search on the server first"). The text wins over `be` (§14):
the strip says "refund" (R1), not "money back"; chips are `--wt-tap-min` tall, not 36 px; and a
refund row carries the number of the sale it refunds, as today (`find-bill-transactions.ts:103`,
pinned at `find-bill-transactions.test.ts:631`), not `be` 1's "R-0012": §7.12 puts "the invoice
number under" the amount, and a refund has none of its own.

**Split** (no venue is live, so a short gap in the filters between R2b-2 and R2b-3 is accepted):

| PR | What | Waits for |
| --- | --- | --- |
| R2a | The server: amount search, row facts, kinds, owed bills | nothing |
| R2b-0 | The outlined search field and four icons, shared | nothing |
| R2b-1 | The Bills tab goes; owed bills get a strip in today's look; dead paths go | R2a, question 1 |
| R2b-2 | The new list: panel, top bar, field, Days chip, rows, highlight, Show more | R2b-0, R2b-1 |
| R2b-3 | Staff and kind chips; both strips as sheets | R2b-2 |

## R2a: the server

1. **Amount search** (`apps/server/src/find-bill-transactions.ts`). A new `amountSearchCents(q)`
   strips spaces and one `€`, with a `-` or `−` allowed before or after the `€`, and hands the rest
   to `stringToCents` (`packages/shared/src/cents.ts:23`) when it is digits with at most one `.` or
   `,` and one or two digits after it. Any refusal from `stringToCents` means "no amount", never an
   error: its pattern refuses leading zeros (`packages/shared/src/money.ts:14`), so "0412" and "00"
   are words only, while "0,50" is 50 cents. Amounts: "80,52", "80.52", "€80.52", "80,52 €",
   "−€8.50", "12,5" (1250 cents), "12" (1200). Not "1.234,50", "80.525" or "Table 12". A row matches
   when its own amount equals the cents in absolute value (a sale's `s.total`, line 73; a
   corrective's total; a refund's `applied_amount + tip_amount`, line 105) or, for a sale, one
   tender's `amount` does: the charge including the tip (`packages/db/src/schema/sales.ts:342-343`),
   as on the guest's card statement or one guest's share of a split bill. It is ORed with today's
   word match (line 160). With a separator or a `€`, amount matches rank first; bare digits rank
   them after the word matches, so "4" lists Table 4 before the €4.00 sales. Still finished sales
   only: it narrows `ranked`, never widens `listed` (lines 86–87, 101) or the zone scope (lines
   34–37). Rows gain `amountMatch: "amount" | "payment" | null`.
2. **Rows and kinds.** `TransactionRow` (`apps/server/src/find-bill-types.ts:57-71`; the till's copy,
   `apps/till/src/api/find-bill-types.ts:55`) gains `orderNumber` and `zoneName`, so a counter sale
   reads "Bar · No. 44". `type=corrective` (`packages/orders-sales/src/find-bill-query.ts:98-105`)
   means `correction`, `full-correction` or `replacement`; the five values accepted today stay.
3. **Owed bills.** `/api/bills` gains `owed=true`: a receipt printed, the bill placed, not settled,
   not voided, something still owing (`owing_cents`, `apps/server/src/find-bill-bills.ts:108`), and
   an unpaid departure recorded or the party closed (`packages/db/src/schema/parties.ts:35`). Not
   `collectionStatus`: it is null once any payment was received (lines 105–107), so a part-paid
   bill left unpaid would be missed (`find-bill-api.test.ts:126`). If the watcher takes question
   1's recommendation, `counter=true` too: today's Bills rows with no party (open, presented, or
   paid and not handed over).
4. **On screen** today's Transactions tab finds amounts at once, in that order; nothing else
   changes. An owed full invoice is already in that list (`listed`, lines 86–87) and is in the owed
   strip too: the row opens the invoice, the strip takes the payment.

Tests first, `apps/server/src/find-bill-transactions.test.ts`: every form above and each refusal,
"0412" (words only, finds T-0412) and "0,50"; "12,5" finds 12.50, not 1.25; a refund by "8,50" and
"−€8.50"; a split guest's card payment with its tip; one cent off is not found; "4" orders Table 4
before €4.00, "4,00" the reverse; an unsettled receipt, a voided sale and a hidden zone's sale of
that amount stay out; dates, staff and kind still apply; `corrective` and the five old kinds; a
counter row's number and zone. `find-bill-bills.test.ts`: owed, including a part-paid bill left
unpaid and a party closed with money owing, and not a seated table's printed bill.
`packages/orders-sales/src/find-bill-query.test.ts`: the new parameters.

Size: about 70 production lines, 220 of tests. It writes nothing, but changes `/api/transactions`'s
body, `TransactionsQuery` (shared through `@waitron/orders-sales`) and a zone-scoped read: a
cross-package contract, so the full `/finish-branch` wave with two Codex run-it reviews.

## R2b-0: the search field

`wt-input` (`packages/ui-core/src/components/wt-input.ts`) gains a `start` slot and an outlined look
as `be` draws it: 44 px, `--wt-radius-md`, 1 px `--wt-color-border` on `--wt-color-bg`, 2 px
`--wt-color-primary` while focused, label hidden, muted placeholder. Today's fields are the filled
56 px kind (`packages/ui-core/src/tokens/structure.css:39`). `packages/ui/src/components/wt-icon.ts`
registers the new `search`, `card`, `cash` (a note with a circle) and `undo` once; R3 reuses the
last three. Tests: `wt-input.test.ts` (tokens; the icon hidden from screen readers; the hidden label
still names the field) and `wt-input.a11y.test.ts`, both themes. About 35 production lines, 70 of
tests; light path, Codex run-it.

## R2b-1: the Bills tab goes

1. **Screen.** The tabs and the Bills table go (`till-find-bill-screen.ts:694-709`, 426–497), and
   `openCount` on both sides (140, 342, 700–702; `find-bill-transactions.ts:166-168`, 194). The
   Transactions table stays as it is. Owed bills (R2a item 3) appear as a section in today's
   "Refunds under way" look (lines 216–245), each opening `find-bill-open`. The search placeholder
   adds "or amount".
2. **Dead paths go.** With only owed bills coming through `find-bill-open`, `#onFindBillOpen`'s
   branches for a seated table (`apps/till/src/till-app.ts:9186-9210`) and, unless question 1 keeps
   them, for counter orders (9140–9145, 9213–9253) go with their tests; `till-app.test.ts`
   dispatches the event directly, so coverage would not flag them. The till client's `lookUpBills`
   (`apps/till/src/api/find-bill-api.ts:91`) and `/api/bills/lookup`
   (`apps/server/src/bill-lookup-api.ts`, 74 lines, and its 305-line test) have no other caller and
   go. `/api/bills`'s `zoneId` and `state` filters and the options' `zones` and `billStaff`
   (`find-bill-api.ts:24-33`) go if nothing else sends them.
3. **Tests.** `rg -c 'find-bill-open' apps/till/src/*.test.ts` counts 44 dispatches in six files (34
   in `till-app.test.ts`): each owed case moves to the owed section; the rest are deleted with their
   branch. The screen's Bills cases go; a case per owed row opening it is written first.
4. **Words.** Guide lines naming the tabs or opening an open bill from Find a bill, counted with
   `rg -c '\*\*(Bills|Transactions)\*\*|Find a bill' apps/server/src/guide/en/` (table-service 10,
   fiscal-filing 1, data-protection 3) and `rg -c '\*\*(Cuentas|Transacciones)\*\*|Buscar cuenta'
   apps/server/src/guide/es/` (11, 2, 3), are reread; line 693 (a returning guest) points at the
   owed section, and a short `{#find-a-bill}` section in both says search takes an amount. A737's
   two-tab contract (`docs/backlog/till.md:1768`) is rewritten. No help bubble names this screen.

About 60 production lines written and 450 deleted; 150 test lines changed and 300 deleted. Light
path, Codex run-it.

## R2b-2: the new list

1. **Panel.** `wt-full-screen-panel`; header above the scroll, as `be` places it: `wt-top-bar`
   ("Back" from `backKey`, line 136; "Find a bill" over "Paid today" and so on, or "{n} found"
   while searching); a band with a line under it holding the R2b-0 field ("Number, table, name, card
   digits or amount") and the Days chip; the refunds and owed sections, hidden while a search is
   typed (`be` 2 draws none); a muted bold `sm` label: "Matching the amount" while the first row
   matched by amount, else "Newest first" (no search) or "Best match first" (words).
2. **Days chip**: 8 px from its neighbours, fully rounded, 1 px border, bold `md`, `chevron-down`.
   A `wt-row-actions` with `bottom-sheet sheet-variant="menu"` (`packages/ui/src/components/`
   `wt-row-actions.ts:162`) and a text in its `trigger` slot (:574), holding `wt-menu-row`s with
   `check`: today's seven presets (lines 53–61). From / To shows today's two date fields and check
   under the chips (374–383, 557–603).
3. **Rows.** A button with a line under it, a 48 px / 1fr / auto grid, 10 × 14 px padding: the time
   (muted `md` tabular; a weekday within six days, else the date, in the venue zone); the place bold
   over a muted `sm` line starting with an 18 px `card`, `cash` or (refund) `undo` icon, then the
   ways and the person, or a full invoice's customer; the amount bold tabular over the receipt
   number, muted `sm`. A "Full invoice" or "Refund" pill: bold `sm`, fully rounded, on
   `--wt-color-surface-sunken`. An `"amount"` match sets the amount alone on
   `--wt-color-surface-lifted`, `--wt-radius-sm`, 2 px side padding (`.hl` inside `.a` in `be` 2).
4. **Show more** at the list's end appends the next page. Paging stays by offset (line 176), so a
   sale arriving between reads would repeat a row: the screen drops rows whose `transactionId` it
   already holds. A sale voided between reads can be skipped until the list is read again.
5. **Goes:** `wt-data-table` with columns, sorting, Customise, Filters and its footer (404–556,
   615–677), the method filter (533–539), the removable chips (606–614, 672–676), resolved dates
   (145, 352), the `h1` (680–690). The staff and kind filters are absent until R2b-3.

Tests first, `till-find-bill-screen.test.ts` rewritten, keeping as strict: venue zone; declined
Back; one debounce keeping a trailing space; late answers ignored; deactivation and reconnection;
rows open only while active and not busy; From / To checks; Retry; a new API context; refund rows'
sign and number. New: each row part, the highlight on the amount only, the label, the sections
hidden while searching, the Days sheet's one reread, Show more without repeats.
`.a11y.test.ts`: both frames, both themes. `state/keyboard-inset.layout.test.ts` keeps passing.
About 250 production lines, 350 of tests; light path, Codex run-it. Pictures beside `be` 1 and 2:
390 × 844, 844 × 390, 1280 × 800 and 800 × 1280; light and dark; English and Spanish; keyboard up;
the Days sheet (no frame: §14.2's sheet). Lane P's finish review says "ready for the owner" first.

## R2b-3: staff, kind and the strips

Staff and Kind chips as the Days chip: "Any staff" and today's list
(`apps/server/src/find-bill-api.ts:34-38`); "Any kind", Sale, Full invoice, Corrective receipt or
invoice, Refund. The refunds section (lines 188–245, kept because an unfinished refund must stay
finishable, `apps/server/src/guide/en/table-service.md:434-436`) becomes the lifted strip: 12 px in,
`--wt-radius-md`, "1 refund under way" bold `md` over "{invoice} · €15.00 waiting for the card
company" or "… left to refund", muted `sm`, `chevron-right`, opening a menu sheet of today's rows.
The read names the invoice, not the table (`apps/server/src/invoice-corrections.ts:406-409`). The
owed section becomes a second strip the same way. Tests: each chip's one reread; each strip's sheet
opens the chosen row, the correction reasons as typed and their Retry. About 100 production lines,
150 of tests; light path, Codex run-it; pictures of both chips' sheets and both strips.

## Who still reaches what

Finished sales open today's receipt with Reprint and Refund (`find-transaction-open`,
`till-app.ts:9264-9272`) until R3. Refunds under way open as today (9442–9450). Owed bills open
today's collection and pay paths (9146–9184). Seated tables' bills are on the floor. Counter orders
are on the counter screen, which only a till has: a phone or tablet never resolves to it
(`apps/till/src/built-in-screens.ts:6-9`, `till-app.ts:4491`). There, the Bills tab is the only way
to a held counter order (9238–9252), a presented counter bill (9141–9145) or one paid and not
handed over (9213–9218). A phone serving a counter zone is spec §3's new behaviour, lane N's 9b:
question 1.

## Questions for the watcher

1. Counter orders on phones and tablets until lane N's 9b: keep them reachable through the owed
   section (R2a's `counter=true`, the branches kept) and drop them when 9b lands (recommended), hold
   R2b-1 until 9b, or accept the loss until then?
2. Past 50 rows: "Show more" (recommended), or loading as the list scrolls?
3. Match payments as well as totals (recommended: the card statement shows the payment), with a
   payment-only match's amount shown highlighted on its second line (recommended)?
4. The spec labels only full invoices and refunds. Label correctives and replacements too, with
   today's names (recommended: the Type column that said so goes)?
5. Is anyone building the outlined search field (lane N's menu search, frames `d`, `m`)? If not,
   lane O builds it as R2b-0 (recommended) and lane N reuses it.

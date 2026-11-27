# R2: Find a bill (lane O, TILL-REDESIGN-PAY-3)

What staff get: ☰ → Bills and cash opens one list of finished sales, newest first: the time, the
table or the counter's order number, how it was paid (a card's last four digits) and who served,
and the amount over the receipt number. Full invoices and refunds carry a small label. One search
box finds a number, a table, a name, card digits or an amount: a guest who says "you charged me
€80.52" is found by typing 80,52. Chips choose the days, the staff member and the kind. Refunds
still waiting on the card company sit in a strip on top. A row opens the receipt as today. The
Bills tab of open bills goes.

Sources: spec §7.12, §7.13, §13 (pass 3), §14 and §14.2; frame `be` 1 and 2 (`html/be-*.html`,
`base.css`); the R2 row of `2026-11-26-o-till-payment-after-pay.md`; the watcher's clearance,
26 November 23:08, change 4 ("amount search on the server first"). The text wins over `be` (§14):
the strip says "refund" (R1), not "money back", and chips are `--wt-tap-min` tall, not 36 px.

**Split.** R2a, the server (items 1–3), first; nothing on screen changes. R2b-0, the search field
(item 4), any time. R2b, the screen (items 5–9), after both and after lane F's counter entry.

## What changes

1. **Amount search** (`apps/server/src/find-bill-transactions.ts`). A new `amountSearchCents(q)`
   reads the search as an amount when, without spaces and one `€` before or after, it is an
   optional `-` or `−`, digits, and at most one `.` or `,` with one or two digits after it:
   "80,52", "80.52", "€80.52", "80,52 €", "12,5" (1250 cents), "12" (1200), "-8.50" (850). Not
   "1.234,50", "80.525" or "Table 12". Cents come from `stringToCents`
   (`packages/shared/src/cents.ts:23`), never a float; one too wide for it is no amount, not a 500.
   It is ORed with today's word match (line 160), so "12" still finds Table 12. A row matches when
   its own amount equals it in absolute value (a sale's `s.total`, line 73; a corrective's total;
   a refund's `applied_amount + tip_amount`, line 105) or, for a sale, one tender's `amount` does:
   the charge including the tip (`packages/db/src/schema/sales.ts:342-343`), as on the guest's card
   statement or one guest's share of a split bill. Amount matches rank first, newest first. Still
   finished sales only: it narrows `ranked`, never widens `listed` (lines 86–87, 101) or the zone
   scope (lines 34–37). Rows gain `amountMatch: "amount" | "payment" | null`.
2. **Rows and kinds.** `TransactionRow` (`apps/server/src/find-bill-types.ts:57-71`; the till's copy,
   `apps/till/src/api/find-bill-types.ts:55`) gains `orderNumber` and `zoneName`, so a counter sale
   reads "Bar · No. 44". `type=corrective` (`packages/orders-sales/src/find-bill-query.ts:98-105`)
   means `correction`, `full-correction` or `replacement`: the spec's "corrective receipt or invoice".
3. **Owed bills** (question 1). `/api/bills` gains `owed=true`: bills with a receipt still owed whose
   guest has gone (an unpaid departure, or the party closed, `packages/db/src/schema/parties.ts:35`),
   from the collection facts read today (`apps/server/src/find-bill-bills.ts:89-93`, `104-107`).
4. **The search field** (R2b-0). `wt-input` (`packages/ui-core/src/components/wt-input.ts`) gains a
   `start` slot and an outlined look as `be` draws it: 44 px, `--wt-radius-md`, 1 px
   `--wt-color-border` on `--wt-color-bg`, 2 px `--wt-color-primary` while focused, label hidden.
   Today's fields are the filled 56 px kind (`packages/ui-core/src/tokens/structure.css:39`).
   `packages/ui/src/components/wt-icon.ts` registers the new `search`, `card`, `cash` (a note with
   a circle) and `undo` icons once; R3 reuses the last three.
5. **The screen** (`apps/till/src/screens/till-find-bill-screen.ts`) is a `wt-full-screen-panel`. Its
   header, above the scroll as `be` places it: `wt-top-bar` ("Back" from today's `backKey`, line
   136; "Find a bill" over "Paid today" and so on, or "{n} found" while searching); a band with a
   line under it holding the field ("Number, table, name, card digits or amount") and the chips
   (8 px apart, fully rounded, 1 px border, bold `md`, `chevron-down`); the strip; a muted bold
   `sm` label. Each row is a button with a line under it, a 48 px / 1fr / auto grid, 10 × 14 px
   padding: the time (muted `md` tabular; a weekday within six days, else the date, in the venue
   zone); the place bold over a muted `sm` line starting with an 18 px `card`, `cash` or (refund)
   `undo` icon, then the ways and the person, or a full invoice's customer; the amount bold tabular
   over the receipt number, muted `sm`. A "Full invoice" or "Refund" pill is bold `sm` on
   `--wt-color-surface-sunken`. An `"amount"` match sits on `--wt-color-surface-lifted`. The label
   reads "Matching the amount" while the first row matched by amount, else "Newest first" (no
   search) or "Best match first" (words).
6. **Chips** are `wt-row-actions` with `bottom-sheet sheet-variant="menu"` and a text trigger, as
   `apps/till/src/widgets/floor-bar.ts:310`, holding `wt-menu-row`s with `check`. Days: today's
   seven presets (lines 53–61); From / To shows today's two date fields and check under the chips
   (374–383, 557–603). Staff: "Any staff" and today's list (`apps/server/src/find-bill-api.ts:34-38`).
   Kind: "Any kind", Sale, Full invoice, Corrective receipt or invoice, Refund.
7. **The strip** is today's "Refunds under way" (lines 188–245), kept because an unfinished refund
   must stay finishable (`apps/server/src/guide/en/table-service.md:434-436`): a `wt-row-actions`
   sheet whose trigger is the lifted strip (12 px in, `--wt-radius-md`, "1 refund under way" bold
   `md` over "{invoice} · €15.00 waiting for the card company" or "… left to refund", muted `sm`,
   `chevron-right`) and whose rows are today's, opening as today. The read names the invoice, not
   the table (`apps/server/src/invoice-corrections.ts:406-409`). Owed bills get a second strip.
8. **Goes:** the tabs and the Bills table (lines 694–709, 426–497), `wt-data-table` with columns,
   sorting, Customise, Filters and paging (404–556, 615–677), the method filter (533–539), the
   removable chips (606–614, 672–676), resolved dates (145, 352), the `h1` (680–690), and
   `openCount` on both sides (140, 342, 700–702; `find-bill-transactions.ts:166-168`), with what
   only these used on the server. Past 50 rows, "Show more" (question 2).
9. **Words and docs.** New strings in English and Spanish. Each guide line naming Find a bill or its
   tabs is reread (`apps/server/src/guide/en/table-service.md`: 10, `fiscal-filing.md:43`,
   `data-protection.md`: 3; `es/`: 11, 2, 3); line 693 (a returning guest) points at the owed
   strip; a short `{#find-a-bill}` section in both says search takes an amount. No help bubble
   names this screen, and none is added. `docs/developers/design-system.md` gains the field look
   and the screen; A737's two-tab contract (`docs/backlog/till.md:1768`) is rewritten.

## Who still reaches what

Finished sales open today's receipt with Reprint and Refund (`find-transaction-open`,
`apps/till/src/till-app.ts:9264-9272`) until R3. Refunds under way open as today (9442–9450). Owed
bills open today's collection and pay paths (`find-bill-open`, 9146–9184). Open table bills are on
the floor; counter orders on the counter screen (3729, `widgets/counter-waiting.ts`). On a device
without a counter screen only the Bills tab reaches a presented counter bill (9140–9145), so R2b
waits for lane F's counter entry (`feat/f-till-floor-counter-entry`), checked at build.

## Tests, written first and seen failing

- R2a, `apps/server/src/find-bill-transactions.test.ts`: every form above and its refusals; a total
  in each form; "12,5" finds 12.50, not 1.25; a refund by "8,50" and "-8.50"; a split guest's card
  payment with its tip; one cent off is not found; "12" finds Table 12 and €12.00; an unsettled
  receipt, a voided sale and a hidden zone's sale of that amount stay out; dates, staff and kind
  still apply; `corrective`; a counter row's number and zone. `owed` in `find-bill-bills.test.ts`;
  both parameters in `packages/orders-sales/src/find-bill-query.test.ts`.
- R2b-0: `wt-input.test.ts` (tokens, the icon hidden from readers, the hidden label still names
  the field) and `wt-input.a11y.test.ts`, both themes.
- R2b: `till-find-bill-screen.test.ts` rewritten, keeping as strict: venue zone; declined Back; one
  debounce keeping a trailing space; late answers ignored; deactivation and reconnection; rows open
  only while active and not busy; From / To checks; Retry; a new API context; correction rows,
  reasons as typed, their Retry; refund rows' sign. New: each row part, the highlight and label,
  each chip's one reread, both strips, Show more. `.a11y.test.ts`: both frames, both themes. About
  60 lines in `till-app.test.ts` and seven more till-app suites open bills through the Bills tab;
  they move to the owed strip or the floor. `state/keyboard-inset.layout.test.ts` keeps passing.

## Size and review

R2a: about 60 production lines, 200 of tests. It writes nothing, but changes `/api/transactions`'s
body, `TransactionsQuery` (shared through `@waitron/orders-sales`) and a zone-scoped read: a
cross-package contract, so the full `/finish-branch` wave with two Codex run-it reviews. R2b-0:
about 35 and 70; light path, Codex run-it. R2b: about 420 written (the screen about 330 replacing
716), 600 of tests plus the 60 moved. Over the three-hour aim; a smaller cut leaves a half-new
screen or drops the staff and kind filters for a while. Light path, Codex run-it (a second if its
server trims reach `@waitron/orders-sales`). Pictures beside `be` 1 and 2: 390 × 844, 844 × 390,
1280 × 800 and 800 × 1280; light and dark; English and Spanish; keyboard up; both sheets (no
frame: §14.2's sheet). Lane P's finish review says "ready for the owner" first.

## Questions for the watcher

1. Bills still owed after the guest left: a second strip (recommended), rows labelled "Owed" in the
   list, or a home outside Find a bill?
2. Past 50 rows: "Show more" at the end (recommended), or loading as the list scrolls?
3. Match payments as well as totals (recommended: the card statement shows the payment), with a
   payment-only match's amount shown highlighted on its second line (recommended)?
4. The spec labels only full invoices and refunds. Label correctives and replacements too, with
   today's names (recommended: the Type column that said so goes)?
5. Is anyone building the outlined search field (lane N's menu search, frames `d`, `m`)? If not,
   lane O builds it as R2b-0 (recommended) and lane N reuses it.

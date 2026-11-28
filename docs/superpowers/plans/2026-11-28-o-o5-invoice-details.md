# O5: the full invoice's details (lane O, TILL-REDESIGN-PAY-2, spec item 17)

What staff get, once the four PRs land:
- **Full invoice** opens a full screen with Back, not today's small window: from the bill's ⋮ menu,
  the bill's own **Full invoice** button, the Counter, and (new) Pay's **Full invoice instead**. Tax
  number first; under the customer, **Send the invoice**: **Print it** (one **Printer** dropdown)
  or **Email it** (the customer's email). **Use full invoice** saves and goes back.
- On Pay, a saved full invoice is one line, "Full invoice · Garcia López SL / Printed on Office",
  with **Change**, and **Receipt instead** under it.
- On Pay's device sheet, a full invoice printed on A4 shows **Invoice printer** where the receipt
  printer was (frame `r` 3).
- It goes where it can go today: the device's A4 invoice printer, receipt paper, email, or, with
  none of those, no choice at all. Every printer in one list is O6's, which the owner lands.

Sources: spec §6, §7.2–§7.4, §7.11, §8, §12, §13, §14; frames `q` 1, 2, 4 and `r` 3
(`html/q-light.html`, `q-dark.html`, `r-light.html`, `base.css`); the order plan's O5 and O6 rows;
the pass-1 split (`2026-11-26-till-handheld-redesign-pass-1.md:58,61,66`); the watcher's notes of
28 November, 03:01 (lane A uses O5's fields without O5's save) and 03:48 (`r` 3 to O5), in lane O's
`questions.md`; lane A's F3 plan (`~/waitron-campaign/till-fiscal-f3-plan.md:118-123,150-154`).
Lines are `main` at `e2eac48b7a`, read, not run, unless a run is named.

## Should this exist?

The owner asked on 26 November (§7.4, approved with pass 1 on the spec's Status line): a full
screen, tax number first, "printed vs email, with a dropdown for the printers"; and §6: "Each choice
opens as a full screen with Back, never a small window." Lane A needs the same fields with no bill
to save. Simplest alternative: restyle today's window (`invoice-recipient-dialog.ts`). It breaks
§6 and gives lane A nothing. The extra: one split of that file into a field block and a screen,
and one look on the shared joined buttons. Size, all four PRs: about 700 new product lines, 600
moved; about 1,300 new test lines and 3,170 moved (the window's seven suites and the app suites'
lines that find it); no generated files. Approval: the spec's Status line; the watcher's clearance
of the order plan (26 November, 21:47, its line 17) and of `r` 3 here (03:48). This plan is not
yet cleared.

## The rules it keeps

- **The requests stay today's, and a file says so.** A bill's choice goes through
  `api.setOrderInvoiceChoice` (`PUT …/invoice-choice`, `till-working-order-routes.ts:243-292`); the
  Counter's goes with the sale (`till-app.ts:7276`) or is saved when Pay opens (`:21917-21919`). The
  server accepts receipt paper, the device's A4 invoice printer or email
  (`invoice-choice-delivery.ts:39-64`), and **no delivery at all** (`:38`), which is not the same as
  receipt paper: a bill merge copies a delivery only onto a bill that has none
  (`merge-invoice.ts:166-170`). One file, new `apps/till/src/invoice-choice-requests.test.ts`,
  writes each expected body literally; the code that drives the screens sits in a separate helper.
  **A later PR that edits an expected body goes to the owner to land.**
- **Kept although `q` 4 does not draw them**, each a fiscal need:
  - **Identifier type** and **Issuing country** (`invoice-recipient-dialog.ts:669-691`), for a
    passport or foreign VAT number (#2145);
  - **Customer country** (`:792-800`): a foreign address needs no postcode or province (`:752`,
    `:780`), and suggestions are offered only for Spain (`:372`);
  - the note when Email is not offered (`:588-592`), and the saved choices the till cannot confirm
    (`:198-258`), such as a saved email while Email is not offered now (`:200-205`);
  - **Simplified invoice instead** (`:807-817`), renamed **Receipt instead**. The server refuses it
    once the bill has a payment (`working-order-invoice.ts:153-166`). Saving it does not check the
    simplified-invoice limit (€3,000, `packages/fiscal-verifactu/src/backend.ts:83`; the save takes
    only `recipientNameMaxLength`, `working-order-invoice.ts:132`), and the payment is refused later
    (`simplified-limit.test.ts:552,575`), so the till hides Receipt instead over the limit;
  - the Counter's question before Pay over that limit (`till-app.ts:7138-7148`).
- **Dropped:** the window and its Cancel (Back, with the same unsaved-changes question), and the one
  **Delivery** dropdown.
- The tax-number check stays in Spain's country pack (`packages/country-packs/src/registry.ts:49-51`).
  No customer lookup is added (pass-1 split, line 76).

## The screen, element by element (`q` 4, measured in `q-light.html`)

- **Panel**: `wt-dialog full-screen` with `wt-full-screen-panel`, as the table's panels
  (`screens/table-action-panel.ts:22-40`; lane E's open #4553 edits that file, so whoever lands
  second rebases). Body on `--wt-color-bg`, 12 px (`--wt-space-3`) from the sides and the top bar.
- **Top bar** (`wt-top-bar`): Back names the screen before ("Pay", or the table or "Counter"; §7.11
  corrects `q` 4's "Table 4"); "Full invoice" over the bill's name; nothing on the right.
- **Fields**, the shared primitives in their own look (§7.11), each 56 px (`--wt-field-height`),
  8 px apart (`--wt-space-2`: the drawn 54 px boxes 10 px apart make the same 64 px step), every
  required one marked: tax number (focused on opening, `:403-406`); Identifier type, and Issuing
  country for another type (question 1); legal name; street and number (`wt-address-lookup`);
  postcode and city side by side, 24 px apart (`--wt-space-5`, as drawn), stacking if the Spanish
  labels do not fit at 390 px; province; Customer country (question 1).
- **"Send the invoice"**: small capitals (`--wt-font-size-sm`, `--wt-font-weight-bold`,
  `--wt-color-text-muted`, `--wt-letter-spacing-caps`), 16 px above (`--wt-space-4`), 8 px under,
  16 px in. **Not drawn at all when the device has no A4 invoice printer and Email is not offered**,
  and then no delivery is sent, as today (`invoice-recipient-dialog.test.ts:386`).
- **Switch**: `wt-segmented-control equal-width hide-label look="dark"`, named `delivery`: 44 px
  (`--wt-tap-min`), 1 px `--wt-color-border`, `--wt-radius-md`, words `--wt-font-size-md` bold; the
  chosen half `--wt-color-text` with `--wt-color-surface` words (§14's "dark"; today the control
  fills it with the primary colour, `wt-segmented-control.ts:95-98`). Shown only when Email is
  offered or saved; otherwise the Printer dropdown stands alone, with the note when it applies.
- **Printer** (`wt-combobox search="never"`): "Office (A4)" for the device's A4 invoice printer
  (a new string: today's says "A4 on Office", `strings.ts:709`), "Receipt printer", and a saved
  choice the till cannot confirm. A new full invoice starts on A4 when the device has one; a bill
  already set for a full invoice with no delivery starts on receipt paper (`:307-311`). The
  `invoice_delivery.printer_invalid` refusal shows **under this field** (today it is the bottom
  message, `till-app.ts:21195-21207`), after the re-read of the choices (`:21212-21215`).
- **Customer email** (`wt-input type="email"`, required) in the dropdown's place for Email.
- **Foot** (`wt-foot-button-bar`, 52 px, a line above): **Use full invoice**, filled, alone;
  **Receipt instead** as its text link on a bill already set for a full invoice and under the limit.

**Forms rules** (design-system.md → Forms, kept from `:420-460`, `:643-660`, `:821`): no errors
until the first press; then each invalid field shows its error under it, and one message sits above
the foot. Use full invoice is quiet and disabled while nothing has changed (`saveActionState`) and
after a failed press until fixed; a server refusal never disables it. Unsaved changes through
`draftScopeFor`.

## The field block, for this screen and lane A

New `apps/till/src/widgets/invoice-details-fields.ts`, `till-invoice-details-fields`. It never
saves and draws no window or foot. **Lane A's F3-2 builds on it, not on today's window.**
- **In:** the printers to offer (`{ value, label }`); whether Email is offered, and the note when it
  is not; the starting recipient and send choice; a saved choice it cannot confirm (kept and sent
  back unless changed); the address remembered for this bill; the address lookup; a refusal and
  the field it names.
- **Out:** `check()`, which marks errors, focuses the first invalid field and returns
  `{ recipient, send }` or nothing; the address as typed, for the opener to remember; an event when
  the refused field is edited; whether anything changed and whether a press failed, for the
  screen's foot; and `commit()` after a save, taking the saved values as the new starting point
  (today's `writeCompletion`, `invoice-recipient-dialog.ts:265-286`).
- **The send choice** is neutral: `{ by: "print", printer }`, `{ by: "email", address }`, the
  unconfirmed saved choice, or none. `recipient` is the server's recipient shape
  (`till-working-order-routes.ts:253-260`). Pay's opener turns a send choice into today's delivery;
  lane A's turns it into its per-sale print or email.

## Entry points, Counter and the wide till

- **The bill's menu and the bill's button** (`till-table-order-screen.ts:7083-7091`, `:5317-5352`)
  reach `#onChooseBillInvoice` (`till-app.ts:21092-21136`), which opens the screen. Lane E's 14d
  (pass-1 split, line 58) then has no invoice work left.
- **Pay's link and Change** (O5b). Table Pay: where the bill's menu shows Full invoice
  (`:7084-7087`), for a bill in the table's list with a party open, as `#onChooseBillInvoice`
  requires (`till-app.ts:21096-21103`). Counter Pay: where the Counter's button shows, full invoices
  on (`tender-pay.ts:1149-1150`). Focus comes back to the link or Change; today it goes to the
  table's control or ⋮ (`till-app.ts:21221-21231`).
- **Counter Pay saves at once.** Pay opens on the Counter only after the till has saved its
  in-memory choice (`till-app.ts:21917-21919`, Pay at `:21972-21977`); a bill payment carries no
  invoice choice (`api/payments-api.ts:264-296`), so a choice kept only in memory after that would
  issue a receipt while the till shows a full invoice (`#counterFullInvoice`, `till-app.ts:11874-11880`).
  So from Counter Pay, Use full invoice saves through today's `#saveInvoiceChoice` (`:10312-10325`),
  records the revision (`markSaved`), then asks Pay for a fresh amount. Receipt instead always
  writes `{ invoiceType: "F2", recipient: null }`, on a table or the Counter.
- **What a save changes on Pay.** A table payment carries no bill revision (`payments-api.ts:264-276`);
  Pay's amount is read for a context that holds the bill's revisions and edit state
  (`state/table-pay-quote.ts:56-73`), and the Counter's adds its order revision (`till-app.ts:21918-21919`).
  After a save Pay reads its amount again, asks for guests by the new invoice type
  (`till-app.ts:12482-12486`) and recomputes a part payment's own receipt (`bill-pay-dialog.ts:270`).
- **Wide till:** from the bill's menu the screen sits in the order's column through
  `orderPaneInset` (`party-name-dialog.ts:176-177`); from Pay and on the Counter it covers what Pay
  covers, the whole window until lane I docks Pay.

## Four PRs

| PR | What staff see | Waits for | Size |
| --- | --- | --- | --- |
| O5a-0 | Nothing: the window rebuilt on the block; `look="dark"`; the requests file | nothing | ~180 new / 600 moved; 400 tests; ~3 h |
| O5a | The full screen, from the bill's menu, its button and the Counter | O5a-0 | ~220; 350 tests + 3,170 moved; ~3 h |
| O5b | Pay's link, the saved line, Change, Receipt instead | O5a; question 4 | ~220; 350 tests; ~3 h |
| O5c | The device sheet's Invoice printer (`r` 3) | O4b, O4c, O5b; question 3 | ~80; 150 tests; ~1.5 h |

- **O5a-0** splits `invoice-recipient-dialog.ts` (834 lines) into the block and a thin window that
  turns `InvoiceDeliveryOptions` (`api/invoice-delivery-api.ts:42-56`) into the block's list and
  back. Lane A can start from here.
- **O5a**: new `widgets/invoice-details-screen.ts` replaces the window; the window's rendering in
  `till-app.ts` (`:24976-25033`) moves to a small new file, so the app (25,334 of 25,500,
  `scripts/product-file-size-limits.json`) gets shorter; the window's file goes.
- **O5b**: new `widgets/pay-invoice-line.ts` (`q` 2: a box 12 px in and below the ways to pay, 1 px
  line, `--wt-radius-md`, `--wt-color-surface`, `--wt-font-size-md`; "Full invoice" bold, the name
  and "Printed on Office" muted; Change a bold `--wt-color-primary-text` link 44 px tall, drawn 40;
  the links centred, `md` bold, 44 px). `bill-pay-dialog.ts` (2,431 of 2,500) gets properties and
  one call. The printer's name comes from the device-equipment read, whose items carry name and
  kind (`apps/server/src/device-equipment.ts:35-39`, `:128-131`); a printer it does not list reads
  "Printed on A4".
- **O5c**: with the bill's choice on A4, the sheet's receipt printer dropdown becomes **Invoice
  printer**, listing only A4 printers of the device's `invoice` role (the item's `kind`; the server
  refuses any other, `invoice-choice-delivery.ts:46-48`). Choosing one sends today's two requests in
  today's order: the device's invoice printer (`PUT /api/device/equipment`), then the bill's choice.
  If the second fails, the invoice still prints on the old printer (`invoice-choice-delivery.ts:86-95`),
  Pay's line still names it, and the dropdown shows the error with the device's new printer;
  opening the screen then offers the new one, as today after ☰ Equipment (`invoice-recipient-dialog.ts:207-216`).

## Tests, written first

- **O5a-0, first, the requests file** (expected bodies literal; driving code apart). Cases: each
  delivery (receipt paper, A4, email, each unconfirmed saved choice, **no delivery**); a passport; a
  French address; Receipt instead; the Counter's in-memory choice passed to `recordSale`; the
  Counter's save when Pay opens; the choices re-read after `printer_invalid`; each with its revision
  and `expectedEdit`. They pass on `main` and stay green after. Then the block alone: `check()`
  returns the same values, marks errors only once called, sends nothing. `look="dark"` paints its
  tokens; the default look is unchanged; its accessibility file covers both looks and themes.
- **O5a**: field order and focus; required marks; errors only after a press; one bottom message;
  disabled while unchanged and after a failed press; Email swapping the dropdown; no section with
  no printer and no Email; `printer_invalid` under Printer; Back with changes asks
  (`invoice-details-screen.unsaved.test.ts`); accessibility in both themes; the four openers; 1280 ×
  800 docks in the column.
- **Where today's seven window suites go**, each check kept: `identity`, `address-lookup` and
  `saved-recipient` to the block; `save-state`, `unsaved` and `a11y` to the screen; `test` split,
  fields and delivery to the block, heading, buttons and refusals to the screen. Five are on the
  English-only still-to-clean list (`scripts/english-only-still-to-clean.ts:669-673`), which cannot
  grow: an entry follows its renamed file, and the second half of a split file reads its expected
  words from `strings.ts`. `apps/till/test-durations.json` (`:421-424` and the rest) follows the new
  names. The app suites' 140 lines that find the window move to one helper.
- **O5b**: Counter Pay → Full invoice instead → Cash: the save request comes before the payment and
  the sale is a full invoice. Table Pay → save → Charge: a full invoice, Pay's amount read again.
  Receipt instead, then Cash: a simplified one; hidden over €3,000. `invoice.choice_locked` on Pay.
  Focus back on the link or Change. Hidden while Pay is busy or full invoices are off.
- **O5c**: the row swaps only for A4 and lists only A4; the two requests in order; the second
  refused leaves Pay's line on the old printer.

**Words.** New strings for the heading, Print it, Email it, Printer, "{printer} (A4)", Full invoice
instead, Receipt instead and the line, in English and Spanish. Changed with them:
`invoice.identifier_required` ("Cancel returns without saving", `strings.ts:673`),
`sale.email_unavailable_print` ("under Delivery, choose Receipt printer", `:1789-1790`) and
`invoice.delivery_printer_changed` ("Check Delivery", `:717-718`; Spanish "Revisa la entrega",
`:3226-3227`). The guide's "Issue a full invoice" (`guide/en/table-service.md:131-176`, "A4 on
{printer}" at `:172`) and its Spanish twin. `design-system.md`: the window's width note
(`:799-801`), the joined buttons' look (`:926`), "Choose Full invoice from the bill before opening
Pay" (`:7155-7156`), and a paragraph under "Full-screen panels and payment controls" (`:890`). The
backlog's A231 (`docs/backlog/fiscal.md:312-316`) in O5b.

**Pictures**, never committed: 390 × 844 light and dark beside `q` 4 (O5a), `q` 1 and 2 (O5b),
`r` 3 (O5c); 844 × 390; the till at 1280 × 800 and 800 × 1280; English and Spanish. States: Print,
Email, errors, a passport, no Email with its note, no section at all, suggestions open. Differences
listed: the shared field look, the kept fields, the 52 px foot (drawn 56), Change at 44 px.

## Who lands it

Each PR takes the full review with two Codex run-it reviews, and lands only after lane P says
"ready for the owner" and the watcher records the owner's visual OK (O5a-0 has nothing to show).
**Lane O lands O5a-0, O5a and O5b**: the server is unchanged and the requests file shows the
bodies are today's, so the invoice is issued, delivered and filed when and where it is today.
**O5c is arguably the owner's**: one choice on Pay changes where this device prints every later
invoice (question 3). **O6 is the owner's.**

## Questions for the watcher

1. **Where the kept fields go.** Recommended: Identifier type under the tax number, starting on
   "Spanish tax ID", with Issuing country under it for another type; Customer country **before**
   the street, so a foreign customer sets it before the fields it changes (suggestions, `:372`;
   postcode and province required only for Spain, `:752`, `:780`).
2. **Undoing a full invoice from the bill's menu.** `q` 4's foot has Use full invoice alone.
   Recommended: Receipt instead as its text link, listed as a difference.
3. **O5c**: its own PR after O4b and O4c (the till gets the sheet in O4c)? Does it wait for O6's
   design, since O6 changes which printers a full invoice may use? Who lands it? Recommended: its
   own PR after O4c; build it after O6 so it offers O6's list once; the owner lands it.
4. **`q` 2's line: O5b's or lane I's?** The pass-1 split gives "I · Pay with a saved invoice" to
   lane I (line 61) and "see the saved choice in Pay" to O 17 (line 66). I found no such item in
   lane I's `queue.md`, and its 15b PR says the link comes "in the saved-invoice slices".
   Recommended: O5b builds the link and the line; lane I keeps the presented bill's whole payment.

## Where the code and the spec disagree

- §7.4's six fields leave out three that today's form needs (question 1).
- §7.4 lists every printer; the server takes only the device's A4 printer or receipt paper
  (`invoice-choice-delivery.ts:43-48`). That is O6.
- "Printed on Office" needs a name the bill does not keep (`invoice-delivery-api.ts:53-56`).
- §7.2's "Receipt instead" has no Counter counterpart today: the window offers it only for a table
  bill (`till-app.ts:24992`).
- §7.11's chosen half in the text colour, against the control's primary (`design-system.md:926`).

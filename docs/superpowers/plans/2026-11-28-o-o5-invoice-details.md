# O5: the full invoice's details (lane O, TILL-REDESIGN-PAY-2, spec item 17)

What staff get, once the four PRs land:
- **Full invoice** opens a full screen with Back instead of today's small window, from the bill's
  ⋮ menu, from the bill's own **Full invoice** button, from the Counter, and (new) from Pay's
  small **Full invoice instead** link. The tax number comes first. Under the customer's details,
  **Send the invoice** is two joined buttons, **Print it** and **Email it**: Print shows one
  **Printer** dropdown, Email swaps it for the customer's email. **Use full invoice** saves and goes
  back to where staff came from.
- On Pay, a saved full invoice shows as one line, "Full invoice · Garcia López SL / Printed on
  Office", with **Change**, and **Receipt instead** under it.
- On Pay's device sheet, a full invoice that prints on A4 shows **Invoice printer** where the
  receipt printer was (frame `r` 3).
- The places it can go are today's: the device's A4 invoice printer, receipt paper, or email.
  Every printer in one list is O6's, which the owner lands.

Sources: spec §6 (the bill's menu), §7.2, §7.3, §7.4, §7.11 ("Pay with a full invoice set up",
"The full invoice's details", "The device sheet"), §8, §12, §13, §14, §14.2, §14.5; frames `q` 1,
2 and 4 and `r` 3 (`html/q-light.html`, `q-dark.html`, `r-light.html`, `base.css`); the order plan's
O5 and O6 rows; the pass-1 split's rows "O · 17", "I · Pay with a saved invoice" and "D · 14a–d"
(`2026-11-26-till-handheld-redesign-pass-1.md:58,61,66`); the watcher's notes of 28 November at
03:01 (lane A uses O5's fields without O5's save) and 03:48 (`r` 3 goes to O5), both in lane O's
`questions.md`; lane A's F3 plan (`~/waitron-campaign/till-fiscal-f3-plan.md:118-123,150-154`).
Lines are `main` at `2aa90c8939`, read, not run, unless a run is named.

## Should this exist?

The owner asked for it on 26 November (§7.4, approved with pass 1 on the spec's Status line): the
invoice's details as a full screen, tax number first, with "Print it or Email it" and "a dropdown
for the printers"; and §6: "Each choice opens as a full screen with Back, never a small window."
Lane A also needs the fields on their own for "Make it a full invoice" (F3), with no bill to save.

Simplest alternative: restyle today's window (`apps/till/src/widgets/invoice-recipient-dialog.ts`)
and leave it a window. That breaks §6's rule and gives lane A nothing to reuse. The extra here is
one split of that file into a field block and a screen, and one new look on the shared joined
buttons (`wt-segmented-control`). Size: about 600 product lines moved, about 600 new, about
1,100 test lines; no generated files. Approval: the spec's Status line (owner, pass 1); the order
plan cleared by the watcher on 26 November at 21:47 (order plan, line 17); `r` 3 moved here by the
watcher at 03:48 today. This plan itself is not yet cleared.

## The rules it keeps

- **Nothing the server receives changes.** The request that saves a bill's choice
  (`PUT /api/working-orders/:id/invoice-choice`, `apps/server/src/till-working-order-routes.ts:243-292`)
  and the Counter's choice sent with the sale (`till-app.ts:7276`) carry the same recipient and
  delivery as today. The server accepts receipt paper, the device's own A4 invoice printer, or email
  (`invoice-choice-delivery.ts:39-64`), and offers only an A4 invoice printer at payment
  (`till-working-order-routes.ts:326`). O5's first tests record today's bodies; every later PR keeps
  them.
- **Kept although `q` 4 does not draw them** (each a fiscal need):
  - **Identifier type** and **Issuing country** (`invoice-recipient-dialog.ts:669-691`): a full
    invoice for a passport or a foreign VAT number cannot be written without them (#2145,
    "Accept international invoice recipients with explicit document identity").
  - **Customer country** (`:792-800`): a foreign address has no postcode or province, and the
    invoice names its country (`recipientAddressErrors`, `:422`; the guide, `table-service.md:155-159`).
  - The note saying why Email is not offered (`:588-592`), and the saved-choice cases: a saved A4
    or email kept when the delivery read fails or email is not offered now (`:198-258`).
  - **Simplified invoice instead** on a bill already set for a full invoice (`:807-817`), renamed
    **Receipt instead** (question 2). The server refuses it once the bill has taken a payment
    (`invoice.choice_locked`, `apps/server/src/working-order-invoice.ts:153-166`).
  - The Counter's question before Pay when the order is over the simplified-invoice limit
    (`till-app.ts:7138-7148`).
- **Dropped:** the window and its Cancel (Back takes its place, with the same unsaved-changes
  question); the single **Delivery** dropdown (the switch and Printer dropdown take its place).
- **The tax-number check stays in Spain's country pack** (`recipientIdentifierResult`,
  `packages/country-packs/src/registry.ts:49-51`). Nothing Spanish enters the till's code.
- **No customer lookup is added.** The till remembers only the address last typed for this bill
  (`till-app.ts:7191-7217`); a returning-customer lookup stays open (pass-1 split, line 76).

## The screen, element by element (`q` 4, measured in `q-light.html`)

- **Panel**: `wt-dialog full-screen` holding `wt-full-screen-panel`, as the table's panels do
  (`apps/till/src/screens/table-action-panel.ts:22-40`). The body is on `--wt-color-bg`, 12 px
  (`--wt-space-3`) from each side and from the top bar.
- **Top bar** (`wt-top-bar`): Back names the screen before: "Pay" from Pay, the table (or "Counter")
  from the bill's menu (`q` 4 draws "Table 4" from Pay; §7.11 corrects it). Title "Full invoice"
  (`invoice.full`) over the bill's name. Nothing on the right.
- **Fields**, the shared primitives in their own look (§7.11: the frame's underline and fixed red
  star are not built): `wt-input`, `wt-address-lookup` (today's suggestions), `wt-combobox`.
  Each 56 px (`--wt-field-height`), 8 px apart (`--wt-space-2`: drawn 54 px boxes 10 px apart, the
  same 64 px step). Every required field is marked, as today. In order:
  1. Customer NIF, NIE or CIF (focused on opening, as today `:403-406`);
  2. Identifier type, starting on "Spanish tax ID", and Issuing country only for another type
     (question 1);
  3. Customer legal name; 4. Customer street and number;
  5. Customer postcode and Customer city side by side, 24 px apart (`--wt-space-5`, drawn as two
     boxes each 12 px in), stacking if the Spanish labels do not fit at 390 px;
  6. Customer province; 7. Customer country.
- **"Send the invoice"**: small capitals (`--wt-font-size-sm`, `--wt-font-weight-bold`,
  `--wt-color-text-muted`, `--wt-letter-spacing-caps`), 16 px above it (`--wt-space-4`, drawn
  10 + 6), 8 px under it, 16 px in (`--wt-space-4`, as drawn).
- **The switch**: `wt-segmented-control equal-width hide-label`, named `delivery` and labelled
  "Send the invoice": 44 px (`--wt-tap-min`), a 1 px `--wt-color-border` line, `--wt-radius-md`,
  words `--wt-font-size-md` bold. The chosen half is filled `--wt-color-text` with
  `--wt-color-surface` words (§14's "dark"); today the control fills it with the primary colour
  (`packages/ui/src/components/wt-segmented-control.ts:95-98`), so O5a adds `look="dark"`. Shown
  only when Email is offered or already saved; otherwise the Printer dropdown stands alone under
  the heading, with the existing note when it applies.
- **Printer** (`wt-combobox search="never"`, `chevron-down` from the primitive): today's places,
  "Office (A4)" for the device's A4 invoice printer and "Receipt printer" for receipt paper, plus a
  saved choice the read could not confirm. It starts where today's Delivery starts: A4 when the
  device has one, else receipt paper (`:307-311`).
- **Customer email** (`wt-input type="email"`, required) in the dropdown's place when Email is
  chosen.
- **Foot** (`wt-foot-button-bar`, 52 px buttons, a line above): **Use full invoice**, filled, alone;
  **Receipt instead** as the bar's text link only on a bill already set for a full invoice.

**The forms rules** (design-system.md → Forms, kept from `:420-460`, `:643-660`, `:821`): nothing is
said about errors until the first press of Use full invoice; then each invalid field shows its own
error under it, and one message sits above the foot ("Fix the marked fields" or a refusal that
belongs to no field). Use full invoice stays quiet and disabled while nothing has changed
(`saveActionState`), and after a failed press until the fields are fixed; a refusal from the server
never disables it. A refusal naming a field shows under that field, as today. The screen takes its
unsaved-changes check from `draftScopeFor`.

## Counter and the wide till

- **Counter**: the Counter's **Full invoice** (`tender-pay.ts:1149-1161`), its over-limit question,
  and (O5b) Counter Pay's link open the same screen. Saving keeps the choice in memory and sends it
  with the sale, as today (`till-app.ts:25016-25019`).
- **Wide till**: from the bill's menu the screen sits in the order's column, through the order
  screen's `orderPaneInset`, as the table's Name panel does (`party-name-dialog.ts:176-177`). From
  Pay, and on Counter, it covers what Pay covers: the whole window until lane I docks Pay.

## Both entry points, and the piece for lane A

- **The bill's menu** (lane D's #4495) already sends `choose-bill-invoice`
  (`till-table-order-screen.ts:7083-7091`), and so does the bill's own button (`:5317-5352`). Both
  reach `#onChooseBillInvoice` (`till-app.ts:21092-21136`), which opens the new screen. Lane E's
  14d ("use today's invoice form until O 17 supplies the shared one", pass-1 split line 58) then
  has no invoice work left.
- **Pay's link** opens the same screen for the bill Pay is on (O5b).
- **The field block for lane A** is `till-invoice-details-fields`, new
  `apps/till/src/widgets/invoice-details-fields.ts`. It holds the fields, their checks, the address
  suggestions and the send choice, and keeps its own draft. It never saves and draws no window or
  foot. The caller gives it the printers to offer (`{ value, label }`) and whether Email is offered,
  and calls `check()`: that marks the errors, focuses the first invalid field, and returns
  `{ recipient, send }` or nothing. `recipient` is the shape the server's recipient check takes
  (`till-working-order-routes.ts:253-260`). Lane A's F3 screen passes its own list of printers for a
  past sale; O6 passes every printer.

## Four PRs, each leaving `main` working

| PR | What staff see | Waits for | Size |
| --- | --- | --- | --- |
| O5a-0 | Nothing: today's window is rebuilt on the new field block | nothing | ~150 new / 600 moved, 250 tests, ~2.5 h |
| O5a | The full screen, from the bill's menu, its button and the Counter | O5a-0 | ~250 / 400 tests + moved, ~3 h |
| O5b | Pay's **Full invoice instead**, the saved line with Change, **Receipt instead** | O5a; question 4 | ~180 / 300, ~3 h |
| O5c | The device sheet's **Invoice printer** (`r` 3) | O4b, O5b | ~80 / 150, ~1.5 h |

**O5a-0.** Split `invoice-recipient-dialog.ts` (834 lines) into the block and a thin window around
it. The window turns `InvoiceDeliveryOptions` (`api/invoice-delivery-api.ts:42-56`) into the
block's printer list and back into today's delivery. Lane A can build on it from here.

**O5a.** New `apps/till/src/widgets/invoice-details-screen.ts` replaces the window. Its rendering
in `till-app.ts` (`:24976-25033`) moves into a small new file, so the app (25,334 of its 25,500
lines, `scripts/product-file-size-limits.json:40`) gets shorter. `wt-segmented-control` gains
`look="dark"`. The old window file goes.

**O5b.** New `apps/till/src/widgets/pay-invoice-line.ts` draws the link and `q` 2's line (box
12 px in and 12 px below the ways to pay, a 1 px line, `--wt-radius-md`, `--wt-color-surface`,
`--wt-font-size-md`; "Full invoice" bold, the name and "Printed on Office" muted; Change a bold
`--wt-color-primary-text` link 44 px tall, raised from the drawn 40 by §14's minimum; the links
`--wt-font-size-md` bold, centred, 44 px). `bill-pay-dialog.ts` (2,431 of 2,500) gets only the
properties and one call. The link and Change show where the bill's menu shows Full invoice
(`till-table-order-screen.ts:7083-7087`). "Printed on Office" takes the printer's name from the
delivery read (`getInvoiceDeliveryOptions`, the existing time-limited read, `till-app.ts:7174-7186`):
the bill keeps only the printer's id. It falls back to "Printed on A4". Three things change on
Pay after a save, and each gets a test: Pay carries the bill's new revision into Charge and Cash;
it asks for guests by the new invoice type (`till-app.ts:12482-12486`); and a part payment's own
receipt follows it (`bill-pay-dialog.ts:270`). On Counter, **Receipt instead** clears the choice
held in memory; a stored one is written back through the existing route.

**O5c.** With the bill's saved choice on A4, the sheet's receipt printer dropdown becomes
**Invoice printer**, listing the profile's invoice printers (the `invoice` role, `equipment-dialog.ts:46-53`).
Choosing one sends the two requests a person can send today, in today's order: the device's
invoice printer (`PUT /api/device/equipment`), then the bill's choice with that printer. If the
second fails, the error shows under the dropdown, and Pay's line still names the old printer,
which is where the invoice will print. Receipt paper and email keep the receipt printer row.

## Tests, written first

- **O5a-0, first:** each kind of choice saved through today's window sends a body recorded as a
  fixture (receipt paper, A4, email, each saved-choice case, a passport, a French address). They
  pass on `main` and must stay green in every later PR. Then the block mounted on its own:
  `check()` returns the same recipient and send choice, marks errors only after it is called, and
  sends no request. Today's seven window suites (3,029 lines) pass unchanged.
- **O5a:** field order, with the tax number first and focused; the required marks; errors only
  after the first press; one bottom message; Use full invoice disabled while unchanged and after a
  failed press; Email swapping the dropdown for the address field; no switch when Email is not
  offered, with the note; Back with changes asks (`invoice-details-screen.unsaved.test.ts`); the
  dark look paints its tokens, and the existing look is unchanged; the screen's accessibility file
  covers Print, Email and errors in both themes. App cases: the bill's menu, the bill's button, the
  Counter's button and the over-limit question each open it; 1280 × 800 docks it in the column.
- **Moving tests:** the app suites find the window through `till-invoice-recipient-dialog` and
  `data-invoice-save`: 59 lines in `till-app-bill-payments.test.ts`, 35 in `till-app.test.ts`, 20
  in `till-app-recipient-identity.test.ts`, 11 in `till-app-boot-and-counter.test.ts`, and 18
  more across five files. They move to one helper; the behaviour they check stays.
- **O5b:** save from Pay, then Charge: the sale is a full invoice for that customer, sent with the
  new revision. Receipt instead, then Cash: a simplified one. `invoice.choice_locked` shows on Pay.
  The link is hidden while Pay is busy, and when full invoices are off. Counter cases for both.
- **O5c:** the row swaps only for A4; the two requests go in order; when the second is refused,
  the old printer still shows on Pay.

**Words.** New `invoice.send`, `invoice.print_it`, `invoice.email_it`, `invoice.printer`,
`invoice.instead`, `invoice.receipt_instead` and the line's strings, in English and Spanish. Strings
that name the old window change in the same PR: `invoice.identifier_required` ("Cancel returns
without saving", `strings.ts:673`) and `sale.email_unavailable_print` ("under Delivery, choose
Receipt printer", `:1789-1790`). The guide's "Issue a full invoice" (`guide/en/table-service.md:131-176`
and the Spanish `{#full-invoice}`) is rewritten: Print it or Email it, Printer, Back, Receipt
instead, and (O5b) Full invoice instead on Pay. `design-system.md`: the window's width note
(`:799-801`), the joined buttons' look (`:926`), "Choose Full invoice from the bill before opening
Pay" (`:7155-7156`), and a paragraph under "Full-screen panels and payment controls" (`:890`).
The backlog's A231 text (`docs/backlog/fiscal.md:312-316`) is checked in O5b.

**Pictures**, never committed: 390 × 844 light and dark beside `q` 4 (O5a), `q` 1 and 2 (O5b),
`r` 3 (O5c); 844 × 390; the till at 1280 × 800 and 800 × 1280; English and Spanish. States: Print,
Email, errors after a press, a passport, Email not offered with its note, suggestions open.
Differences listed: the shared field look in place of the underline, the kept fields, the foot's
52 px against the drawn 56, Change at 44 px. Then lane P says "ready for the owner".

## Who lands it

**Lane O lands O5a-0, O5a and O5b**, each after the full review with two Codex run-it reviews (a
full invoice is a fiscal document, and O5b lets the choice change while Pay is open). The reason
is checked by the fixture tests above: the server is unchanged, the requests are today's, and the
invoice is issued, delivered and filed when and where it is today. **O5c is the closest call:** it
makes one choice send two of today's requests. Recommended: lane O, as question 3 asks. **O6 stays
the owner's.**

## Questions for the watcher

1. **Where do Identifier type and Issuing country go?** `q` 4 drops them, but a passport or foreign
   VAT number needs them. Recommended: a dropdown under the tax number, starting on "Spanish tax
   ID", as today but second.
2. **Undoing a full invoice from the bill's menu.** `q` 4's foot has Use full invoice alone, so
   only Pay's `q` 2 could undo it. Recommended: Receipt instead as the foot's text link on a bill
   already set for a full invoice, listed as a difference.
3. **`r` 3 as its own PR (O5c), after O4b, landed by lane O?** It needs O4b's sheet, which is not
   on `main` yet (O4a is building), and O5b's saved line. Recommended: yes.
4. **`q` 2's line: O5b's or lane I's?** The pass-1 split gives "I · Pay with a saved invoice" to
   lane I (line 61) and "see the saved choice in Pay" to O 17 (line 66). I found no such item in
   lane I's `queue.md`, and its 15b PR says the link comes "in the saved-invoice slices". Recommended: O5b
   builds the link and the line; lane I keeps the presented bill's whole-payment opening.

## Where the code and the spec disagree

- §7.4's six fields leave out three that today's form needs (question 1, and Customer country).
- §7.4 lists every printer, but the server accepts only the device's A4 printer or receipt paper
  (`invoice-choice-delivery.ts:43-48`). That is O6, as the order plan says.
- §6 and §7.2's "Printed on Office" needs a name the bill does not keep (`invoice-delivery-api.ts:53-56`).
- §7.2's "Receipt instead" has no Counter counterpart today: the window offers it only for a table
  bill (`till-app.ts:24992`).
- §7.11's chosen half in the text colour, against the control's primary colour (`design-system.md:926`).

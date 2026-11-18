# Receipt layout and payments on the receipt

Status: approved by the owner in conversation, 17 November 2026. Plan:
[2026-11-17-receipt-layout-and-payments.md](../plans/2026-11-17-receipt-layout-and-payments.md).

## Why

The owner compared two real receipts printed by Square at El Santet with ours (rendered from
`buildReceiptDocument`, `apps/server/src/receipt-document.ts`) and picked what a customer checking a
bill would miss on ours: a price for each unit, which tax rate each item carried, a tighter tax
summary, thin solid dividing lines, and the payment itself with its card. Separately, decision D1
(`docs/compliance/2026-11-15-adviser-answers.md` Part B1, lane L's MEAL-END-TICKET) makes an unpaid
receipt common: staff close the table, the receipt prints, guests pay against it. That receipt has
to say what is still owed.

## Goals

1. **Price each.** On a simplified receipt, an item whose quantity is not 1 gets an indented line
   under it: `2,70 € por unidad` (with a unit name, `24,00 € / kg`).
2. **Rate letters, only on mixed-rate bills.** On a simplified receipt whose tax summary has more
   than one rate, each item line and each extra or discount line ends in the letter of its rate,
   and the tax summary rows carry the same letters. A single-rate receipt carries no letters.
3. **One-row tax table.** On a simplified receipt, the tax summary becomes a table, one row per
   rate: rate, base, tax, total. Replaces today's two lines per rate
   (`Base imponible 10% … / IVA 10% …`).
4. **Solid dividing lines.** On thermal paper, the section rules are drawn as a thin solid line
   instead of a row of `-` characters, in the same places they print today.
5. **Payments as they stand when printed.** Every print of a receipt (simplified or full, original
   or duplicado, thermal or A4/PDF) shows the payments recorded at the moment it is printed:
   - each card payment with its brand and last four digits (`Visa ****4034`), how it was presented
     (`Sin contacto`, `Chip`, `Banda`) and its authorisation code, when the payment row holds them;
   - a **Pendiente** line with the amount still owed when the sale is not settled and owes more
     than zero.
6. **The payment slip** (`apps/server/src/payment-slip.ts`):
   - never shows an amount owed: the existing remaining line (`remaining`, from
     `bill_payments.remaining_after`) is removed;
   - prints for every payment that settles a ticket issued before the payment (cash, a card typed
     into a separate machine, or a connected reader that does not print its own slip), under the
     same device and printer conditions slips print under today.

## Non-goals

- No change to what is filed with AEAT, the hash chain, invoice numbers or series. This is
  presentation and printing only.
- No duplicado after payment printed automatically. A duplicado prints only when staff reprint, as
  today. Whether that is allowed on request, and whether it may show later payments, is question 24
  of the 19 November adviser meeting (`docs/compliance/2026-11-19-adviser-meeting.md`).
  _2026-11-18: the owner's answer, the adviser still to confirm the details — see question 2 of the 19 November sheet: a duplicate may be printed whenever the venue wants, and a slip may name the ticket it pays but need not; whether a duplicate may show later payments is still open._
- No pre-bill (A446 stays on the backlog, owner 2026-11-17).
- No change to the full invoice's (F1) item table or tax rows: goals 1–3 are simplified-receipt
  only. F1 already has unit-price and rate columns.
- No server name ("David"), website field or other header changes.
- No change to the till's on-screen receipt view (`apps/till/src/screens/till-ticket-view.ts`).
  _2026-11-18: #3740 then made that view, opened from Find a bill, draw the receipt builder's
  output, so the card details this design prints, like the rest of that output, show there too._
- The slip does not name the ticket it pays, for now: the adviser's ruling R2 covers a slip "with no
  invoice number and no QR, printed beside the ticket" (`docs/compliance/asesor-questions.md:434`).
  Question 24(c) asks whether it may; this design changes only if the answer is yes.

## Anti-goals

- A receipt that shows a debt for a bill closed by transfer (A275's deferred close): that bill is
  labelled as today and gets no Pendiente line (A275 final design §4: "Never show … a debt
  balance").
- A unit price that does not multiply back to the printed amount.
- A Pendiente line on a corrective or replacement invoice (R4/R5): they are recorded with no
  settlement of their own and owe nothing.
- Card data beyond brand, last four digits, entry mode and authorisation code.

## Constraints

- RD 1619/2012 art. 14: one original per invoice; duplicados only for several recipients or a lost
  original (`docs/compliance/verifactu-findings.md` §15.1). Hence goal 6 rather than a duplicado
  after payment (owner, 17 November, chose this over a duplicado; see Approaches).
- Every receipt language (`packages/country-es/src/receipt-labels.ts` and every other country pack's
  labels) needs the new words.
- 58 mm paper has 30 columns and 80 mm paper 42 (`textGrid`, `packages/printing/src/layout.ts`):
  the tax table and letters must fit there. (Corrected 2026-11-17 while building PR 1; this line
  said 32 for 58 mm.)
- The receipt is rebuilt from the database each time it prints (`readSettledTicket`,
  `readTransactionReceipt`); only a retry of a failed original reuses stored bytes
  (`receipt-print.ts:559`). Goal 5 relies on that.
- After a ticket is issued, a payment must settle the whole amount due (`settle-sale.ts`). Part
  payments are bill payments, kept in `bill_payments` until the sale settles; only settlement
  writes `tenders`, which is all today's receipt reads (`readBillTenderLines`). So for an issued,
  unsettled sale the receipt must read the received bill payments itself, and Pendiente = amount
  due (total plus correctives, `readIssuedSales` in `sale-due.ts`) minus their net applied amounts,
  tips excluded.
- A part-paid bill issued unpaid exists only once lane L's MEAL-END-TICKET lands (today an unpaid
  departure is refused while a bill holds a payment), so Pendiente and the slip are built after it.
  Card details on the receipt do not wait.

## Approaches

- **A. Duplicado after each payment.** The original prints unpaid with Pendiente; after each payment
  a DUPLICADO prints with the payments. Rejected: art. 14 admits a duplicado only for several
  recipients or a lost original.
- **B. Payment slip after a later payment (chosen, owner 17 November, with the slip showing no amount
  owed).** The original carries the payments known when it prints, and Pendiente if anything is
  owed. A payment after the ticket gets the existing payment slip, which is not an invoice
  (adviser answer 2.2). When everything is paid before the ticket issues, the usual case, one
  piece of paper carries everything.
- **C. B now, A later if the adviser allows it.** Question 24 asks; nothing waits on it.

## Decided in conversation

- Goals 1, 2, 3 and 5 are the owner's picks from the Santet comparison; goal 4 is the owner's
  "the lines to break it up".
- Approach B, and no amount owed on the slip (owner).
- "Print the payment info that we have in the moment the receipt is printed" (owner): goal 5.

## Left to the builder, as the author's calls (the owner may overrule)

- Goal 4 is read as "solid lines in the existing places", not "more lines".
- The tax table applies to every simplified receipt, single-rate included.
- The unit-price line prints the price the item was sold at, as its order line recorded it, and
  only when that price is per one unit and × quantity equals the printed amount exactly;
  otherwise none. A corrective receipt and a line charged nothing print none. It is never worked out from the amount: 0,01 kg sold at 6,60 €/kg is charged
  0,07 €, and the line is left out rather than printed as 7,00 €/kg. A receipt line with no recorded
  price prints none.
- Rate letters run A, B, C… in the order of the tax summary (`vatBreakdown`). A discount that
  spans rates carries no letter: a whole-bill discount, and (decided while building PR 1) a dish's
  discount that also covers an extra taxed at another rate.
- The solid line runs across the text columns, where today's dashes print, not the full paper
  width (decided while building PR 1).
- Column headings of the tax table are short per-language words (Spanish: `Tipo`, `Base`, `IVA`,
  `Total`); amounts in the table carry no `€`.
- Card line wording: `Visa ****4034 (Sin contacto)` with its amount on the right, then
  `Autorización 354739` when present; a typed reference keeps today's `Ref.` line.

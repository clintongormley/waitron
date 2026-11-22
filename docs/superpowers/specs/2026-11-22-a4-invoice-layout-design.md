# A4 invoice layout and bank-transfer instructions — design

Status: approved by the owner in conversation, 2026-11-22 ("approved"), after being asked whether
the title and the venue's name may be printed larger than the VERI\*FACTU caption, which extends the
2026-10-14 "only TOTAL is enlarged" call (`docs/backlog/printers.md`, Decisions and deliberate limits).
The approval is taken as covering that too.

## Why

The owner compared our A4 invoice with a Veri\*Factu invoice from another product and found ours
worse: "the layout is cleaner and makes more sense". Ours is the till receipt's content, in the
receipt's order, drawn down an A4 page (`apps/server/src/invoice-page.ts` walks the element list
`buildReceiptDocument` builds for the thermal roll). The result is a single centred column with a rule
between every section and no visual sign of what the document is.

The owner also wants payment instructions — bank transfer, IBAN, bank — on invoices for bills closed
as a deferred payment ("Pago aplazado", A275), on the A4 page and on the till receipt.

## Goals

- A4 invoices (the emailed PDF and the office-printer page; both come from `layoutInvoicePages`)
  follow the layout the owner chose from mock-ups on 2026-11-22: B's header, A's table (below).
- Every fact today's A4 invoice can carry is still carried, in a place of its own in the new layout.
- A bill closed as a deferred payment shows how to pay by bank transfer, on A4 and on the thermal
  receipt (and the till's on-screen receipt, which uses the same builder).
- One new business setting: the venue's bank account (IBAN and bank name).

## Non-goals

- The thermal receipt's layout. Apart from the deferred-payment lines, it does not change.
- Payment links, QR codes for payment, SEPA/Bizum, or anything that moves money.
- Tracking whether a deferred bill was later paid (A275: closing as deferred is final; the accountant
  reconciles the bank outside Waitron).
- Proforma invoices or quotes.

## Anti-goals

- Bank details on an invoice that is already paid. The owner agreed (2026-11-22): a customer who
  paid by card and reads "pay by transfer to this account" may pay twice.
- Bank details because "something is owed". `result.owed` is also set on an invoice issued before
  the table finished paying (`readReceiptPayments`, `apps/server/src/receipt-payments.ts`); that
  table is still paying at the till. The trigger is the deferred-payment closing alone.
- Weakening the QR rules: the QR stays first, 30–40 mm, with «QR tributario:» above it and
  VERI\*FACTU below (`docs/compliance/verifactu-findings.md`, C115/C123).

## The chosen layout (owner, 2026-11-22)

Mock-ups were shown in the brainstorming companion and are not committed (house rule). The owner
picked "B's header with A's table", then the payment footer, then two wording changes.

```text
+---------------------------------------------------------------+
| QR tributario:                                    (logo)      |
| [ QR 35 mm ]                                   La Buena       |  trading name, bold, large
| VERI*FACTU               Charcutería La Buena SL · NIF B1234… |  legal name + tax id
|                           domicile (wraps, right-aligned)     |
|                           Tel. … · email                      |
|===============================================================|  heavy rule
| Factura FF/1                 Fecha            Mesa   Pedido   |  band: title bold, large;
|                              18 ago 2026 00:34  6     41      |  grey labels over values
|---------------------------------------------------------------|  light rule
| +-------------------------------+                             |
| | Cliente                       |   shaded box, ~60% width    |
| | Cliente … Sociedad Limitada   |   name semibold             |
| | NIF B11223344                 |                             |
| | address · country             |                             |
| +-------------------------------+                             |
|                                                               |
| Descripción   Cant. Precio unit. Total    IVA   Total         |  shaded heading row
|                     sin IVA      sin IVA        con IVA       |
| Menú del día…   1   10,00 €     10,00 €  21 %  12,10 €        |  light rule under each row
|   Descuento 10 %                −1,00 €  21 %  −1,21 €        |  indented, grey
| Agua mineral    2   4,00 €       8,00 €  10 %   8,80 €        |
|                                                               |
|                         Tipo  Base imponible  Cuota IVA Total |  VAT summary, right half
|                         21 %        9,00 €     1,89 € 10,89 € |
|                         10 %        8,00 €     0,80 €  8,80 € |
|                         ==================================== |
|                         TOTAL                       19,69 €  |  bold, large
|                                                               |
|---------------------------------------------------------------|
| FORMA DE PAGO                                                 |  payment footer
| Pagado · Efectivo 20,00 € · Cambio 0,31 €                     |
|                Gracias por su visita · Hasta pronto           |  department footer message
+---------------------------------------------------------------+
```

Deferred-payment footer (owner's wording change: IBAN and bank on one line):

```text
| FORMA DE PAGO                                                 |
| Pago aplazado. Pagar por transferencia bancaria a la cuenta   |
| indicada, con referencia FF/1.                                |
| IBAN: ES91 2100 0418 4502 0005 1332   Banco: OPENBANK         |
```

Paid footer: "Pagado", then how it was paid (owner: "change the left one to say Pagado"; keeping the
payment details after it is my call, see Calls).

Typography: Noto Sans throughout, with a real bold for the trading name, the title, the table
heading row and TOTAL. Today the A4 page fakes bold by stroking the outline (`invoice-pdf.ts`,
`invoice-raster.ts`). The shipped `apps/server/src/assets/invoice-noto-sans.ttf` is a variable font
holding every weight, Bold included (builder check, 2026-11-22: fontkit's Bold instance draws bolder
outlines; PDFKit's `font(bytes, "Bold")` gave bold advance widths); use that instance, no new font
file. Confirm by rendering a PDF that the embedded glyphs are the bold ones. Grey labels (~#6b6b6b), a light grey
table heading fill (~#e4e4e8) and a grey customer box (~#f2f2f4). The office-printer page is already
8-bit greyscale (`invoice-raster.ts`, `sharp(...).greyscale()`), so greys survive printing.

## Where each fact goes

Everything `buildReceiptDocument` emits for `surface: "a4"` today
(`apps/server/src/receipt-document.ts`, 180–629) and its place in the new layout:

| Fact | Today | New place |
| --- | --- | --- |
| Practice warning, "no real charge" | top and bottom lines | a full-width boxed line at the very top of page 1 and above the footer, as today top and bottom |
| QR, caption, legend | centred at top | top left, same size and level, caption above, legend below |
| Logo | centred | top right, above the trading name; absent → the name block starts at the top |
| Trading name (when the header setting prints it and it differs from the legal name) | bold centred | top right, bold, large |
| Header subtitle | centred | under the trading name |
| Legal name, NIF | centred | top right, one line ("Legal name · NIF x"); bold and large when no trading name prints |
| Domicile, phone, email | full invoice: one centred wrapped line; simplified: phone and email on lines of their own, no domicile | top right, wrapped, right-aligned; a simplified invoice keeps today's content (no domicile) |
| Duplicate ("Copia") | centred line | in the band, after the title |
| Corrective invoice | bold line + "corrects invoice X, date" + rectification amount | band title becomes the corrective heading; a line under the band names the invoice it corrects (number, date) and, for a replacement in full, the rectification amount |
| Invoice number and date | two rows | band |
| Order label and number ("Mesa 6", "Pedido 41") | one row | band: the order label as stored (a table's name, a party's name, a Counter label) with no heading word over it, then the "Pedido" pair |
| Take-away | bold line | band, as a pair or a tag |
| Sale date (when different) | row | band, as a labelled pair |
| Customer (full invoice) | stacked lines | shaded box |
| Item lines, extras, answers, discounts, advances taken off | table, VAT-exclusive price and amount, rate column only when rates differ | six-column table (below) |
| "Prices exclude VAT" note | under the table | gone: the column headings say it |
| VAT rows / tax table | rows (full) / table (simplified) | VAT summary table, right half, for both |
| TOTAL | double size row | under the summary, bold, large |
| Payments, card details, auth code, reference, tip, refunds | rows | payment footer, one line per payment |
| Deferred payment | "Pago aplazado" line | payment footer with bank instructions (below) |
| Owed | bold row | payment footer, bold |
| Guests · per person | row | under TOTAL, small |
| Department footer message | centred | bottom of the last page, small, grey |

### The table

Full invoice columns: Descripción · Cant. · Precio unit. sin IVA · Total sin IVA · IVA · Total con IVA.
The VAT-exclusive figures come from the same filed values the table uses today
(`beforeVatFigures`, the line's `net.rate`). "Total con IVA" is what the row was charged, VAT
included (the line's gross, a discount's VAT-included amount, and for a whole-bill discount split
across rates by `invoiceDiscounts`, its share at that rate), never the VAT-exclusive amount plus VAT
worked out per row, which can drift a cent from the per-rate summary (three 0,03 € rows at 21 %:
0,12 € per row against 0,11 € per rate). The column must add up to TOTAL exactly; a test pins it
for the fixture in `apps/server/src/testing/full-invoice-fixture.ts` (12,10 − 1,21 + 8,80 = 19,69)
and for a case where per-row VAT would drift. The IVA column is
always shown (today it shows only when rates differ).

Discounts, extras, answers and advances stay where the builder puts them today, as indented rows.

Simplified invoices printed on A4 (`printsAsFullInvoice` false) have no customer and show amounts
with VAT. Their table: Descripción · Cant. · Precio · Importe, VAT included, with the same VAT
summary table under it.

### Pages

The header (QR, letterhead, band) and the customer box are on page 1 only; the QR stays on page 1
only, as today. The table heading row repeats on every page the table reaches. The VAT summary,
TOTAL and payment footer move to the next page whole rather than split. Later pages carry a small
"Factura FF/1 · 2/3" line at the top so a loose page can be matched to its invoice.

## The payment footer's first word

- "Pagado" prints only when the sale lists payments and nothing is owed.
- Owed: the payments listed, then the amount owed in bold; no "Pagado".
- Deferred (directly or through the sale it replaces): the instructions below.
- No payment of its own and not deferred (a corrective or refund invoice, a fully comped bill, a
  cancellation credit): no "Pagado"; the footer lists only refunds, if any, and is left out when it
  would be empty.

## Bank-transfer instructions

**Setting.** A new optional business setting: IBAN and bank name. It belongs to the taxpayer, not a
department: one per venue. Edited on the dashboard on Venue settings → Venue details → the Business
card (`apps/dashboard/src/screens/venue-details-panel.ts`), next to the legal name and tax number.
The IBAN is validated (country format and the mod-97 check) and stored without spaces; it prints
in groups of four. The bank name is free text. Both are optional; the bank name is printed only
when given.

**Who may change it (owner, 2026-11-22: "with the email").** Swapping the IBAN on a business's
invoices is a known fraud. Saving, changing or clearing the bank account takes the same gate as the
legal name (`taxpayerFieldRoute` in `apps/server/src/venue-settings-api.ts`: `venue.configure` and a
fresh sign-in), is written to the activity log, and sends an email to the venue's administrators
naming who changed it and the old and new account with the middle digits hidden (first four and
last four characters shown).

**When it prints.** Only when the bill was closed as a deferred payment (`tender.method ===
"deferred"`), and only from the current setting. A substitution or replacement of such an invoice
(`deferred-payment-export.ts` follows them as `replacedBy`; `record-remedy-replacement.ts` after an
AEAT refusal) records no payment of its own, yet it is the document the customer pays from: it
prints the instructions when the sale it replaces, followed back through its replacements, was
closed as a deferred payment. A reprint of an old deferred invoice prints the
account as it is at reprint time; if the setting has been cleared, the reprint shows "Pago
aplazado." alone.

**Words** (Spanish; English and the other receipt languages follow the receipt's own language):
"Pago aplazado. Pagar por transferencia bancaria a la cuenta indicada, con referencia {invoice
number}." then "IBAN: {iban}   Banco: {bank}". With no account set, "Pago aplazado." alone, as
today.

**Thermal receipt and till on-screen receipt.** On a deferred bill only, a "FORMA DE PAGO" heading
and the same lines; every other receipt is unchanged. A 58 mm roll
holds 30 characters (`packages/printing/src/layout.ts`), an 80 mm roll 42. A Spanish IBAN in
groups is 29 characters, so on 58 mm "IBAN:" sits on its own line and the number on the next; on
80 mm "IBAN: …" fits one line (35) and "Banco: …" takes the next. An IBAN never breaks inside a
group of four; a longer foreign IBAN wraps at a group boundary.

```text
58 mm                             80 mm
FORMA DE PAGO                     FORMA DE PAGO
Pago aplazado. Pagar por          Pago aplazado. Pagar por transferencia
transferencia bancaria a la       bancaria a la cuenta indicada, con
cuenta indicada, con              referencia FF/1.
referencia FF/1.                  IBAN: ES91 2100 0418 4502 0005 1332
IBAN:                             Banco: OPENBANK
ES91 2100 0418 4502 0005 1332
Banco: OPENBANK
```

## Approaches

1. **A layout of its own for the A4 page, fed the invoice's facts directly (chosen).** A new A4
   layout reads the same `ReceiptDocumentInput` facts the receipt builder reads and places them in
   the regions above, emitting the existing element kinds (text, rule, QR, logo) plus a filled
   rectangle and a font weight. `invoice-pdf.ts` and `invoice-raster.ts` keep drawing whatever the
   layout emits. Thermal receipts keep `buildReceiptDocument`. Trade-off: the receipt builder's
   decisions (labels, which rows exist, discount placement) must be reused, not re-derived, or the
   two documents drift; the builder should share the fact-gathering and keep only placement
   separate.
2. **Render HTML and print it to PDF.** Rejected: needs a headless browser on the box; the box image
   ships none.
3. **Adjust the current A4 walker.** Rejected: it places one element under another and cannot put
   the QR beside the letterhead or the summary beside the payment, which is the point of the change.

## Constraints

- QR rules above; the A4 QR stays 35 mm square, level M, decodable back to the filed text (the
  existing assertions in the invoice PDF tests).
- English-only code; Spanish strings live in the receipt labels' translation files.
- Third-party notices: Noto Sans Bold ships with its licence in `/app/third-party/` like the
  regular face (house rule; guard `scripts/deploy-image-env.test.ts`).
- A string-rendered page has nothing checking that it renders: open the PDF and the office-printer
  image and look, at both a one-page and a multi-page invoice.
- Help guide: the Business card's new field and the deferred-payment instructions are described in
  the dashboard guide (English and Spanish) and the invoices guide
  (`apps/server/src/guide/{en,es}/invoices.md`).

## Recording the decisions

The plan's first task records, in `docs/backlog/printers.md` → Decisions and deliberate limits, the
owner's 2026-11-22 approval that the A4 title and the venue's name are printed larger than the
VERI\*FACTU caption, beside the 2026-10-14 TOTAL entry, and the deferred-payment instructions rule
in `docs/backlog/payments.md` beside A275's entry.

## Calls I made (for the owner to check)

- The bottom section is A's (VAT summary table with base, VAT and total per rate, then TOTAL), not
  B's list of totals: its columns match the table above.
- "Pagado" is followed by how it was paid ("Pagado · Efectivo 20,00 € · Cambio 0,31 €").
- "con referencia {invoice number}" added to the transfer instruction.
- The bank account is one per venue, on the Business card, not per department.
- The IVA column always shows on A4, even with a single rate.
- Later pages carry "Factura FF/1 · 2/3".
- A reprint prints the bank account as it is set at reprint time, like the department's receipt
  messages today; it is not stored with the sale.

## Left to the builder

Exact sizes and spacing within the mock-up's proportions; how the shared fact-gathering is split
out of `buildReceiptDocument`; how a long foreign IBAN wraps on 58 mm.

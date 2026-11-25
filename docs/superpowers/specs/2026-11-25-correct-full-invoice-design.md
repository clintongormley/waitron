# Giving money back on a full invoice files a corrective full invoice (CORRECT-FULL-INVOICE)

Status: the owner answered all four questions on 2026-11-25 (section 6, "Owner's answers"); where an
answer changes a statement below, a dated note says so. Nothing here is built yet. The plan is
[2026-11-25-correct-full-invoice.md](../plans/2026-11-25-correct-full-invoice.md). Every "I
recommend" is mine (lane L), not the owner's.

**Words used here.** A *ticket* is the simplified invoice most guests get (no customer named). A
*full invoice* names the customer, usually a business, with its tax number and address. A
*corrective invoice* (Spanish *factura rectificativa*) is a new invoice, with its own number, that
reduces an invoice already issued; AEAT gives each kind a code: R5 for a ticket's, R1 to R4 for a
full invoice's. *Give money back* is the till's one button for giving money back on a past receipt
(#4257, #4300 and #4344).

## 1. The ask, and what happens today

The owner, 2026-11-24, told that the till cannot correct a full invoice naming a business customer:
"but we will build this functionality, no?" (queue entry written by the watcher, lane L
`queue.md`, CORRECT-FULL-INVOICE).

Today, Give money back on a full invoice gives the money back with **no** corrective invoice and
lists the refund for the accountant (the owner's call D3 in
`docs/superpowers/plans/2026-11-24-give-money-back.md`). So the business keeps an invoice that still
shows the full amount and the VAT on it, and the venue keeps declaring that VAT. Three places refuse
a corrective of a full invoice: the filing check (`not_simplified`,
`packages/fiscal-verifactu/src/correction-admission.ts:58-60`), the corrective writer in core
(`requireSupportedCorrection`, `packages/core/src/correction-eligibility.ts:5-9`, called from
`packages/core/src/record-correction.ts`), and the AEAT record builder, which only writes an R5 by
differences (`recordCorrection`, `packages/fiscal-verifactu/src/backend.ts:540-600`).

**Should this exist?** Yes. The law requires a corrective invoice whenever the price is lowered or a
sale is partly undone after the invoice was issued (section 3). The business customer deducts the
VAT on the invoice it holds, so an invoice that is never corrected overstates its deduction and the
venue's VAT. The simplest alternative, keeping today's refund with an accountant list, leaves the
accountant to issue the corrective by hand, outside Waitron's numbering and its record chain with
AEAT. Nothing simpler meets the ask.

## 2. What people will see

- **Staff:** nothing new to choose. Give money back works on a full invoice exactly as on a ticket:
  the same three choices (a dish, goodwill or a complaint, the extra), the same amounts, PIN and
  card or cash steps. The end screen adds one line saying the customer gets a new invoice, for
  example "€10.00 given back in cash. Give it to the customer. **A new invoice for Acme Foods SL,
  showing the €10.00 off, is printing.**" Staff still never see the word "corrective" on the till.
  _2026-11-25, the owner's answers 1 and 3 replace part of this: staff choose how the corrective
  invoice is delivered before the money goes back (it starts on the way the original was), and the
  end screen says "A corrective invoice for Acme Foods SL (−€10.00) is printing." Against a receipt it
  says "A corrective receipt (−€10.00) is printing."_
- **The customer** receives a corrective full invoice (section 4), delivered the way the original
  full invoice was (question 1). _2026-11-25: unless staff choose another way (answer 1)._
- **The accountant:** the refund no longer appears on the "Refunds with no corrective" sheet,
  because it now has one. The corrective counts in the VAT return like any other.

## 3. Which kind of corrective, and why — R1, by differences

**The kind.** AEAT's own schema lists the codes (`SuministroInformacion.xsd`, committed verbatim in
the `@waitron/verifactu` package's `schemas/`):

> R1: «FACTURA RECTIFICATIVA (Art 80.1 y 80.2 y error fundado en derecho)»
> R4: «FACTURA RECTIFICATIVA (Resto)»

(R2 and R3 are insolvency and bad debts, art. 80.Tres and 80.Cuatro, which do not apply.)

Articles 80.Uno and 80.Dos of the VAT law (Ley 37/1992, read at boe.es today, BOE-A-1992-28740) are
the two cases Give money back covers:

> Uno. … 2.º «Los descuentos y bonificaciones otorgados con posterioridad al momento en que la
> operación se haya realizado siempre que sean debidamente justificados.»
>
> Dos. «Cuando por resolución firme, judicial o administrativa o con arreglo a Derecho o a los usos
> de comercio queden sin efecto total o parcialmente las operaciones gravadas o se altere el precio
> después del momento en que la operación se haya efectuado, la base imponible se modificará en la
> cuantía correspondiente.»

In plain words: goodwill or a complaint is a discount given after the sale (80.Uno.2.º); a dish that
never came or was sent back undoes part of the sale (80.Dos). Both are **R1**. R4 ("the rest") is for
corrections that are not one of those, such as A1407's replacement of a full invoice AEAT refused for
a wrong date, which stays R4. The tax adviser's answer 1.5 names art. 80.Uno.2.º for money given back
after a **ticket** ("will, where applicable, require" a corrective,
`docs/compliance/2026-11-15-adviser-answers.md`); the adviser has not yet confirmed that goodwill
always needs one (`docs/compliance/2026-11-19-adviser-meeting.md`, question 6). **For the adviser:** a
dish that never came could be read as the invoice simply being wrong (R4) rather than the sale being
partly undone (R1). My best guess is R1 for every give-back; the build goes ahead on it and the
adviser confirms (one line added to the open adviser sheet).

**That it is required, and when.** The invoicing regulation (Real Decreto 1619/2012, art. 15, read
at boe.es today, BOE-A-2012-14696):

> 15.2 «… será obligatoria la expedición de una factura rectificativa en los casos en que … se
> hubieran producido las circunstancias que, según lo dispuesto en el artículo 80 de la Ley del
> Impuesto, dan lugar a la modificación de la base imponible.»
>
> 15.3 «La expedición de la factura rectificativa deberá efectuarse tan pronto como el obligado a
> expedirla tenga constancia de las circunstancias …»

So Waitron issues it at the moment the money goes back, as it does for tickets today.

**By differences.** Article 15.5 lets the corrective show either the amount of the change or the
figures after it:

> «… bien indicando directamente el importe de la rectificación, con independencia de su signo, bien
> tal y como queden tras la rectificación efectuada …»

I recommend the amount of the change (AEAT's *por diferencias*, `TipoRectificativa` "I"), with
negative figures: it is what Waitron's ticket correctives already do, the writer and the paper
already work that way, and several give-backs on one invoice each stand alone.

**The customer on it.** AEAT refuses an R1 without a customer block: «1189 = Si TipoFactura es F1 o
F3 o R1 o R2 o R3 o R4 el bloque Destinatarios tiene que estar cumplimentado.» (AEAT's validations
list, quoted in `docs/compliance/research/2026-10-09-vat-and-corrections.md`). The record copies the
customer block (name and tax number) exactly as it was sent to AEAT for the original, as A1407's
replacement does. The paper also needs both addresses (art. 15.5 sends a corrective back to art. 6's
contents): the customer's from the original sale row, the venue's from its current registered
address. A venue with no registered address is refused **before** any money moves, at the preview,
with A1407's existing refusal, never after the cash is out.

The library's own checker (`@waitron/verifactu` 0.2.1, run by the reviewer on five shapes) accepts an
R1 "I" with a customer block and negative amounts, and rejects it without the customer block or with
an `ImporteRectificacion`; AEAT's own answer is the live test in section 5.

**Its own series.** Correctives of full invoices take the `full_corrective` series (default code
`FR`), apart from the tickets' correctives: the owner's decision of 15 November, agreed by the
adviser the same day (answer 1.14). The series exists on every box since 2026-11-23.

**The VAT return.** AEAT's developer FAQ §27: «para el modelo 303 se tienen en cuenta todas las
facturas identificadas con clave de factura rectificativa (R1, R2, R3, R4 y R5)»
(`docs/compliance/verifactu-faq-notes.md` §19). An R1 counts exactly as an R5 does today.

## 4. What the customer receives

A corrective full invoice in the venue's receipt language, carrying what a full invoice carries plus
what makes it a corrective:

- the title **Factura rectificativa** and its own number (`FR/…`) and date;
- the venue's legal name, tax number and address; the customer's legal name, tax number and address,
  as on the original;
- **the invoice it corrects**: number and date;
- the dishes and amounts given back, each negative, with the base and VAT at each rate, and the
  negative total (shared by menu price when no dish was ticked, as for tickets). _2026-11-25, answer
  4: a line given back only in part prints no quantity and no unit price; a whole dish keeps
  −1 × price;_
- the Veri\*Factu QR code and words, as on every invoice.

Pictures: 80 mm and A4, Spanish and English, in `~/waitron-campaign-shared/desk/correct-full-invoice/`.

## 5. What changes in Waitron

1. **The writer, for Give money back only.** The give-back route asks core for a full invoice's
   corrective explicitly; core then takes the `full_corrective` series, copies the customer (name,
   tax number, address) onto the corrective's sale row, and the record builder files an R1 by
   differences with the stored customer block. Lifted for that request only: the filing check
   (`correction-admission.ts`), core's two refusals (`record-correction.ts` and the preview read in
   `correction-history.ts`), and the builder's (`backend.ts`). A1407's R4 replacement of a full
   invoice stands in for it, as an R5 replacement stands in for a ticket. Every other caller keeps
   today's refusal: cancelling a placed order or splitting a printed bill (which credit an invoice
   holding no money, `cancel-credit.ts`), and the dashboard's fix for records AEAT refused, which
   keeps its R4 replacement. Every other refusal stays (another box's invoice, records that need
   checking, the waits).
2. **Give money back** sends a full invoice down the same route as a ticket; it no longer falls back
   to a plain refund for it (the "refused for good" lists in `invoice-corrections.ts` lose that case).
   The accountant's sheet keeps listing refunds that still have no corrective for other reasons. _2026-11-25,
   answer 2: a cancelled dish's money goes on the corrective too, so on a full invoice Give money back
   makes no plain refund of it._
3. **Paper:** the full-invoice layout with both parties and the corrected invoice (pictures). Every
   place that types "a corrective naming a customer" as R4 learns R1: `invoice-typing.ts`
   (`printsAsFullInvoice` and the typing), `tax-office-list.ts` and the dashboard's kinds list, the
   email title (`invoice-email.ts`), the till's invoice type.
4. **Delivery (question 1).** _2026-11-25: answered; option 1, with staff able to change it before the
   money goes back (answer 1)._ Today a corrective prints only on the receipt printer
   (`fileCorrectionIn`), and the full-invoice delivery (A4, email, the saved choice, the "not
   delivered" buttons) refuses correctives (`deliversAsFullInvoice`, `reserveInvoiceDelivery`). If you
   choose option 1, those learn a full invoice's corrective; with option 2, only the receipt printer
   and Find a bill's existing Email.
5. **Readers** that count correctives already take R1 (`returned-invoices.ts`; the VAT return sums
   every sale's VAT whatever its type).
6. **Both till guides** and the backlog lose the "full invoice: no correction" sentences.

**Before it lands:** one R1 by differences naming a customer, sent to AEAT's test service through the
`@waitron/verifactu` library's live test, must come back accepted. AEAT's test service has accepted
an R1 before (run 37286368370, cited in `docs/compliance/2026-11-06-adviser-questions.md`), but not
this exact shape. I recommend holding the pull request on that run rather than adding a switch like
A1407's. _2026-11-25: "not this exact shape" was wrong. Run 37286368370's control credit was an R1 "I"
naming a customer, correcting one full invoice, and came back `Correcto`
([plan](../plans/2026-11-25-correct-full-invoice.md), section 5)._

**Size (estimate):** about 700 production lines and 1,300 test lines with question 1's option 1,
in two pull requests: (1) writer, filing and receipt-printer paper; (2) A4 and email delivery. With
option 2, the first alone. No new table, no migration, no venue reset.
_2026-11-25: superseded by the plan's sizes: eight pull requests; one new column holds staff's delivery
choice, so a late card answer follows it (the watcher, 15:52), and that pull request resets every venue._

## 6. Questions for the owner (each with my recommendation)

1. **How the customer gets it.** I recommend: the same way the original full invoice was delivered
   (its saved choice: A4 on the office printer, by email to the address it was sent to, or on the
   receipt printer), with the same "not delivered, try again" buttons as a full invoice today.
   Alternative: always on the receipt printer, with Email and A4 offered from Find a bill.
2. **Cancelled dishes' money.** On a ticket, money for a dish cancelled after payment goes back with
   no corrective today (your Q43 decision of 18 October that it should file one is listed as still
   open in `docs/backlog/fiscal.md`). On a full
   invoice I recommend it goes on the corrective, because the business deducts that dish's VAT
   otherwise. Tickets stay as they are in this item.
3. **The till's line** on the end screen: "A new invoice for {customer}, showing the {amount} off, is
   printing." (Spanish: «Se está imprimiendo una nueva factura para {customer} con los {amount}
   descontados.») Or say nothing on the till and let the paper speak.

4. **A line given back in part.** Today's corrective paper prints such a line as quantity −1 at
   the dish's full price, beside the smaller amount actually given back (picture: Paella −1 ×
   16,36 €, total −6,82 €); tickets' correctives print the same way. A business's accountant reads
   that as arithmetic that does not add up. I recommend leaving quantity and unit price blank on a
   line given back only in part, on full invoices' correctives (a whole dish given back keeps
   −1 × price). Alternative: leave it as tickets print it.

### Owner's answers, 2026-11-25

Relayed by the watcher in lane L's `questions.md`: "WATCHER 2026-11-25 10:35" (1 to 3) and "12:21"
(4). The words in quotation marks are the owner's; "For the build" is this design's.

1. **Delivery:** "default to the original but allow the staff to change it". For the build: the
   choice starts on how the original full invoice was delivered, with the choices a full invoice has
   today, and is made in Give money back before the money goes back. The "not delivered, try again"
   buttons come with it.
2. **A cancelled dish's money:** "so yes we should file a corrective. but once we have issues a full
   invoice i believe we have to keep with full invoices, and not switch back to receipts". For the
   build: on a full invoice it goes on the corrective full invoice. Every path that issues a document
   against an original is checked never to issue a receipt-type one against a full invoice, and a
   refusal today stays a refusal (the watcher's list). On a receipt nothing changes here: the October
   decision stays its own backlog item.
3. **Words:** "A corrective invoice, and change receipt to the same wording", then, asked to
   clarify: "what i mean is that we should refer to them as corrective receipts and corrective
   invoices everywhere". For the build: «ticket rectificativo» / «factura rectificativa» in Spanish.
   The till's lines (the watcher's wording of the answer): "A corrective invoice for Acme Foods SL
   (−€10.00) is printing.", emailed "… has been emailed to accounts@acme.es.", and for a receipt "A
   corrective receipt (−€10.00) is printing." GIVE-MONEY-BACK PR 3 is to reword what is already on `main`
   (its Task 15c, committed on its branch on 2026-11-25, not landed) before this item's PR 2a; this item owns
   only the words it adds.
4. **A line given back in part:** "Blank those two columns (Recommended)", on corrective invoices
   and corrective receipts. For the build: no quantity and no unit price on such a line; a whole dish
   keeps −1 × price.

**After the plan's fresh read, 2026-11-25** (lane L's calls, cleared by the watcher at 15:52 with the changes noted;
the plan's sections 1, 5 and 6):

- A full invoice AEAT **refused** waits only while Waitron offers a fix for the refusal; any other keeps
  today's plain refund and the accountant's list. This narrows section 5's "every other refusal stays".
- On a press that names more than the cancelled dish, the paper shares the money by menu price, and the
  cancel is paid by no more than the corrective takes off its dish. _Changed 2026-11-25 15:52 by the
  watcher; before, the cancel read paid in full first._
- "In part" (answer 4) is one condition: the corrective row's amount differs from the line's.
- The end screen names the two kinds of corrective, so section 2's "Staff still never see the word
  'corrective'" no longer holds (answer 3).
- R1 for a dish that never came is built on lane L's best guess, before the adviser answers.
- Staff's delivery choice is stored when the give-back opens and cannot be changed after; a press that sends
  none goes out the way the original went.

## 7. Left out

- Cancelling a placed order or splitting a printed bill when its invoice is a full invoice: they
  stay refused as today (they credit an invoice nobody paid; the right type is a separate question).
- The dashboard's fix for a full invoice AEAT refused: unchanged (A1407's R4).

- A full invoice made later from tickets (AEAT's F3): no till route issues one today
  (`docs/backlog/fiscal.md`, A1e: "no route calls `recordSubstitution`").
- Changing a customer's details on an issued invoice: a different corrective (R4 by substitution),
  not money back.
- Tickets' cancelled-dish correctives (question 2): unchanged here. _2026-11-25: still so, by answer 2.
  Receipts' correctives do change in one way: the two blank columns of answer 4._

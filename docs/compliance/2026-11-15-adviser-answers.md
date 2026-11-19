# The tax adviser's answers of 15 November 2026: what they change

Written 15 November 2026 for the owner, to go through before the meeting with the adviser on
Thursday 19 November. Rewritten the same day so that each section can be read on its own. Updated
16 November with your decisions D1, D2, D6 and D12, and with corrections from a review; later that
day you widened D12 so that reductions go on the corrections report too (Part B13).

## About this document

**What arrived.** Marboré Tax & Legal sent a draft, "Veri\*Factu, invoicing and VAT in the
restaurant sector: answers to Waitron's questionnaire", dated 15 November 2026. It answers the
[shortened list](asesor-questions.md#the-shortened-list-2026-10-09) of questions we sent around
15 October. The adviser's numbers map onto ours one to one: answers 1.1 to 1.16 are our S1 to S16,
and answers 2.1 to 2.6 are our R1 to R6. The adviser did not answer S17 (selling by weight), S18 (a change of the company's
legal name) or S19 (holding back later records in a chain while an earlier one's answer is unknown).
The draft is marked "subject to review", and the adviser says its Spanish version prevails over the English
one we received.

**The PDF is not stored in the repository.** The repository is public and the document is the
adviser's draft. What follows restates the adviser's answers in our words, with the laws and rulings the adviser cites.

**How it is laid out.**

- Part A lists where Waitron already does what the adviser says.
- Part B takes each difference in turn. Every section explains the situation, gives the adviser's answer,
  shows what Waitron does today with a worked example, says what should change, and ends with the
  decision it needs from you.
- Part C lists what to remember when features not yet built are built.
- Part D is an index of your decisions.
- The follow-up questions for Thursday are in the
  [meeting sheet](2026-11-19-adviser-meeting.md), in English and Spanish.

**How "today" was established.** By reading the code, tests and backlog on `main` at `52aa441257`
(15 November); what was added on 16 November was read at `633447ed3c`. Nothing was run. The file
and line behind each claim are in the [evidence table](#evidence) at the end.

**Words used throughout.**

- A **ticket** is a simplified invoice (factura simplificada): the ordinary receipt that does not
  name the customer.
- A **full invoice** (factura completa) names the customer. AEAT's code for one is F1; a full
  invoice issued later in exchange for a ticket is an **F3**.
- A **corrective invoice** (factura rectificativa) changes an invoice already issued, usually by
  reducing it. It is a new invoice with its own number. AEAT calls a corrective of a ticket an
  **R5**, and correctives of full invoices **R1 to R4**.
- A **cancellation record** (registro de anulación) is not an invoice. It tells AEAT that an
  invoice should never have been issued.
- Every invoice also produces a **record** that Waitron sends to AEAT. The records of a venue form a
  **chain**: each carries a fingerprint of the one before.
- A **series** is a numbering sequence for invoices.

## Part A. Where Waitron already matches the adviser's answers

- **When the ticket is issued (answer 1.1).** The adviser says the ticket is due when the meal ends, during the
  same visit. Issuing it earlier, when the order is taken, is not forbidden but leads to more
  corrections. Waitron issues it at payment, in the same visit. (Part B1 covers the one problem:
  Waitron waits for the bill to be paid in full.)
- **A customer who walks out without paying (answer 1.6).** VAT on an unpaid bill can in principle be
  recovered, but only after a formal demand for payment, which is impossible when the customer is
  unknown. A tourist living abroad counts as "not established" in Spain, which rules recovery out
  too. If the customer pays later, the invoice is not changed. Waitron issues the walkout's ticket
  for the full amount and leaves it as it is.
- **Separate bills at one table (answer 1.9).** When each diner orders and pays for their own dishes,
  each is a separate sale and **must** get their own ticket; asking for a separate bill is enough. A
  table that ordered together may split the bill, but need not. Waitron lets a table have several
  bills, each with its own ticket.
- **A cancellation recorded in a later quarter (answer 1.12).** When an invoice cancelled today
  belonged to a quarter whose VAT return is already filed, the venue may either take the reduction
  in the current quarter's return or ask for the old return to be corrected. Waitron's VAT report
  counts the cancellation on the day it is made (your decision of 24 September), which is the first
  option. Your decision D12 (Part B13) changes this: a cancellation of an earlier quarter's invoice
  goes on the corrections report instead, and the accountant chooses between the two options.
- **Full invoices and their exchanges share a series (answer 1.14, first half).** Full invoices (F1)
  and full invoices issued in exchange for tickets (F3) may share a numbering series. In Waitron they
  do.
- **Restoring an old backup (answer 1.16).** If the venue's server is restored from an old backup, it
  might reuse invoice numbers already issued. Our approach (a new installation number and new series
  before trading again, keep every record and AEAT reply, cancel nothing automatically) is
  reasonable, and nothing needs to be reported to AEAT. Waitron does exactly this. (Part B10 covers
  one gap: rebuilding the lost invoice copies.)
- **The original and duplicates of a printed ticket (answer 2.1).** If the first print fails, the
  first print that works is the original; any print after the original was handed over says
  «duplicado». The adviser adds that failed print attempts should be logged. Waitron does both: each print
  job keeps its state, number of attempts and last error. Resending a job from the printer queue
  keeps its marking: an original whose every try failed prints as the original, an original that
  printed cannot be resent from there, and a copy prints as a copy. (A reprint from the list of
  past receipts is different: it is always a copy; Part B2.)
- **The card payment slip (answer 2.2).** The slip the card machine prints is not an invoice. As we
  have it.
- **"No tax (0%)" (answer 2.3).** The 0% VAT rate exists only for goods donated to non-profits. An
  amount outside the scope of VAT is recorded with AEAT's code N1 and its reason. This confirms the
  research behind the "No tax (0%)" backlog entry.
- **Invoices issued from another server, and foreign customers (answer 2.4).** An F3 or a corrective
  may be issued from another server of the same company. A tourist with no Spanish tax number is
  identified by passport (AEAT's document type 03); which codes AEAT accepts is set by AEAT's
  technical rules, not by law. As we have it.
- **New hardware, same database (answer 2.5).** Moving the same database and software to new hardware
  keeps the installation number; when in doubt, a new number is always safe. Nothing is reported to
  AEAT when a chain of records ends. A full invoice sent by email in exchange for a ticket is an
  original, not a duplicate, and resending an email that failed is still the original. As we have
  it. (Email consent is in Part B2.)
- **Purchases where only part of the VAT can be reclaimed (answer 2.6 (a)).** The VAT return declares
  the full amount before VAT and applies the percentage to the VAT only. Waitron's purchases report
  does this.
- **Tips (answer 1.5).** Change the customer leaves on purpose is a tip and is not part of the price.
  Waitron records tips apart from the invoice.
- **Accepting less as payment in full (answer 1.5).** If, before the ticket is issued, the venue
  accepts less than the bill as full payment, the difference is a discount and must appear on the
  ticket. In Waitron staff do this by applying a discount to the bill before payment; it is spread
  over the lines and shows on the ticket.

## Part B. Where Waitron differs

### B1. A table's ticket waits until the bill is fully paid

**The situation.** A table often pays in parts: one guest leaves early and pays something, or the
group splits the bill at the end. The question is when the ticket must be issued, since issuing it
also sends its record to AEAT.

**The adviser's answer (1.3, with 1.1 and 1.4).** There are two rules.

- Money paid *before the table has been fully served* is, for VAT, an **advance payment**. VAT is
  due on it the moment it is received (LIVA 75.Dos), so it needs a ticket of its own at that moment
  (RD 1619/2012 art. 2.1). This applies when what the money pays for is clearly identified (European
  Court of Justice, C‑419/02, BUPA). Whether "€30 towards the bill", or €1,000 put towards a
  tab, is identified enough is Thursday's question 15.
- Once the meal is over, several payments may share one ticket, but that ticket is due **when the
  meal ends**. In the adviser's words, "its issue cannot be made conditional on the bill being paid in
  full". If the table leaves with part unpaid, it still gets a ticket for everything it was served,
  and the unpaid part is a debt.

**What Waitron does today.** A part-payment is held on the bill with no ticket. The ticket is
issued only by the payment that leaves the bill fully paid, and only when no dish is still unsent
to the kitchen. A bill that holds any payment cannot be recorded as an unpaid departure (Waitron's
"left without paying" action, which issues the ticket for the whole bill).

- *Example 1: a payment during the meal.* A table of four has €120 on its bill and the main
  courses are still to come. At 21:30 Ana pays €30 by card and leaves. Waitron issues nothing. At
  23:00 the others pay €90 and Waitron issues one €120 ticket listing both payments. The adviser would say
  Ana's €30 needed its own ticket at 21:30, if the payment counts as identified.
- *Example 2: part paid, then a walkout.* After the meal two guests pay €80 of €120, and the third
  leaves without paying. Waitron issues no ticket at all. It also refuses "left without paying",
  because the bill holds a payment, so the bill stays open. The adviser would say a €120 ticket was due when
  the meal ended, with €40 owed.
- *Example 3: a dish never served.* The guests pay on Monday for what they ate. A dessert they
  ordered was never served and stays on the bill, so the payments fall short and no ticket is
  issued. On Wednesday staff remove the dessert, and only then is the ticket issued. The adviser would say
  the meal ended on Monday, so the ticket was due on Monday.

**What should change.**

1. Issue the ticket when the table's visit ends, for everything served, whether fully paid or not.
2. Let a part-paid bill be recorded as "left without paying", with the ticket for the whole amount.
3. Stop unserved dishes from holding the ticket back: leave them off, or settle them first.
4. If question 15 confirms that a payment towards the bill during the meal is an advance: give it
   its own ticket, and have the final ticket deduct it the way a deposit is deducted (Part C).

This is the biggest change in the adviser's answers. It also touches the "date of the sale" work (Part B11),
whose worked example 3 is Example 3 above and relies on the ticket waiting for full payment.

**Your decision (D1).** *Owner, 16 November: yes. The ticket is issued when the meal ends, even if
the bill is paid much later.* Changes 1 to 3 are designed now; change 4 waits for question 15. (You
have already decided, under D10, to tell lane L about the date-of-sale points after Thursday.)

### B2. A ticket can end up never delivered

**The situation.** The law requires a ticket to be issued *and delivered* to the customer. Waitron
lets staff choose, after payment, how the customer gets it.

**The adviser's answer (1.11, 2.5).** The customer cannot waive delivery (DGT rulings V0150-08 and
V1884-22). So:

- Printing the ticket only when the customer asks, or never, breaches the rule.
- Showing it on a screen is not delivery.
- Email, or a link or QR code to download it, is electronic delivery. That needs the customer's
  consent (RD 1619/2012 art. 9). The consent can be tacit, but only if the customer was first told
  how the ticket will arrive and that they can ask for paper instead.
- For a download link, the venue must also be able to show the customer downloaded it, and offer
  paper if they didn't.

**What Waitron does today.** After payment the till offers Receipt, Full invoice, Email or
**None**. A ticket prints only if staff tap Receipt; None closes the window and records nothing.
Email takes an address and nothing more: on 9 October you decided that "just giving us the email
address is sufficient", as a product decision, while the legal question stayed open as backlog item
A448. A reprint made later from the list of past receipts is always marked «DUPLICADO», even when
the customer never got an original.

- *Example: None.* A couple pay €42 by card and the waiter taps None. No paper ticket exists and
  nothing was emailed. By the adviser's answer, the ticket was never delivered.
- *Example: email.* A guest gives an email address. Nothing tells them the ticket will come only by
  email, or that they can have paper. By the adviser's answer, that is not informed consent.
- *Example: reprint.* After None, the customer comes back and asks for the ticket. Staff reprint it
  from the list of past receipts, and it says «DUPLICADO», though it is the first copy they receive.

**What should change.**

1. Print every ticket at payment, unless the customer chose email. Remove None. *You decided
   against this on 16 November (D2).*
2. In the email step, show a sentence such as "We'll email your ticket to this address. You can ask
   for a paper copy at any time.", and record that it was shown.
3. A reprint from the list of past receipts counts as the original when no original was delivered
   before. With None kept, this matters whenever a customer who had None comes back for the ticket.
   A first print that failed is already handled: resent from the printer queue, it prints as the
   original (Part A).
4. A QR code or link for the customer to download the ticket is not built. Build it only if you
   want it, with proof of download and a paper fallback.

_19 November 2026: the owner reversed D2 (question 3 of the [19 November sheet](2026-11-19-adviser-meeting.md)): "We must always print one unless we email it instead."; the till's None was removed (ADVISER-NO-NONE)._

**Your decision (D2).** *Owner, 16 November: keep None. Most customers don't want the ticket, and
printing every one wastes paper.* By the adviser's answer, a ticket the customer never receives
breaches the delivery rule, so this is a risk you are choosing to take. Thursday's question 16 asks
what it costs. You also take a ticket printed and left with the bill as delivered, even if the
customer leaves it behind. Changes 2 and 3 are not yet decided; change 2 reverses your 9 October
decision on email consent. *Recommended: make them.* The adviser's answer 1.11 already accepts
consent given this way, and you take sending the email as delivery (16 November).

### B3. Undoing a ticket when nothing was served or paid

**The situation.** Sometimes a ticket exists for a sale that should be undone: an order entered on
the wrong table, a takeaway invoiced and never collected, or a table recorded as "left without
paying" by mistake. There are two ways to undo a ticket: a corrective invoice (R5) that reduces it
to nothing, or a cancellation record that tells AEAT it should never have existed.

**The adviser's answer (1.7).** If a ticket was issued for an order that was neither served nor paid, send a
**cancellation record**, not a corrective. A cancellation is for an invoice issued in error, for a
sale that never happened (DGT V0611-11; AEAT's developer FAQ §17.2.d). A real sale that was paid
and then refunded gets a **corrective** instead, given to the customer and kept linked to the
evidence of the refund.

**What Waitron does today.** Waitron never sends a cancellation record: the code that writes one is
called only from a test. When an order whose ticket was issued, and which holds no money, is
cancelled, Waitron issues a corrective for the whole ticket. That was your decision C126 of
2 October, taken without the adviser. Since 11 November the till's Counter screen no longer offers
it, but the server still does it when a bill recorded as "left without paying" is cancelled
afterwards. I did not establish which screen asks for that today.

- *Example.* Table 7 is recorded as "left without paying" and a €56 ticket is issued. Later, staff
  cancel the bill. Waitron issues a −€56 corrective, which reduces the venue's VAT by €5.09.
  - If table 7 really ate and walked out, the adviser says the ticket stands and the VAT cannot be
    recovered (answer 1.6, in Part A). The corrective understates the VAT.
  - If the order had been entered on the wrong table and nobody ate, the adviser says to send a
    cancellation record, not a corrective.

**What should change.** When nothing was served and nothing paid, send a cancellation record. When
food was served and not paid, the ticket is not undone. A sale that was paid and refunded keeps its
corrective, as today.

**Your decision (D3).** Make that change, replacing decision C126? *Recommended: yes.*

### B4. A free item on a bill that mixes VAT rates

**The situation.** Staff can give an item free ("on the house") on a bill that is otherwise paid.
For VAT, the price paid has to be split between the VAT rates on the bill. Restaurants mostly have
one rate (everything eaten on the premises is 10%), but a deli or a shop mixes 4%, 10% and 21%.

**The adviser's answer (1.10).** A free item given with a paid sale is a discount on the whole sale (DGT
V0555-17). When the items carry different VAT rates, the price paid is shared across all of them,
the free one included, in proportion to their value (LIVA 79.Dos). The free item may not be left at
zero. The menu price is a fair measure of value for this.

**What Waitron does today.** The free item is priced at exactly €0, so its VAT rate receives
nothing. A discount on the whole bill is spread by each line's charged price, so a line already at
€0 still receives nothing. This is backlog item A445, which waits for this answer.

- *Example (a deli).* A bottle of wine, €12.00 at 21%, and a loaf, €2.00 at 4%, given free. The
  customer pays €12.00.
  - Today: the wine carries all €12.00 (€9.92 before VAT, €2.08 VAT); the bread carries nothing.
    Total VAT €2.08.
  - By the adviser's answer: the €12.00 is shared 12 to 2 by menu price. The wine carries €10.29 (€8.50 plus
    €1.79 VAT) and the bread €1.71 (€1.64 plus €0.07 VAT). Total VAT €1.86.

At a single rate both methods give the same VAT; the difference arises only where rates mix.

**Your decision (D4).** Build A445 now? *Recommended: yes. It is fiscal, so you land it.*

### B5. A whole table, or a staff meal, given free

**The situation.** Sometimes the venue charges a table nothing at all: the owner invites friends or
regulars, or staff eat a meal on the house. Waitron handles this as a 100% discount.

**The adviser's answer (1.10).** A table given everything free is not a 100% discount: nothing is paid, so
it is a supply for no payment. There are two treatments:

- **Risk-free:** treat it as a **self-supply** (autoconsumo), valued at what it **cost** the
  venue, not at the menu price (DGT V2347-24; LIVA 79.Cuatro). It needs an invoice and a record.
- **Defensible:** an invitation made for business reasons (rewarding a regular, promoting the
  venue) is outside VAT altogether (LIVA 12.3.º; DGT V1496-08, V2330-18 and V1443-21). But ruling
  V2347-24 goes the other way, and AEAT can be expected to follow it. The venue would also lose the
  right to reclaim the VAT on what went into the meal. An invitation for personal reasons (the
  owner's family) is a self-supply either way.

The adviser recommends recording each invitation's reason and who authorised it, and says each venue should
choose its treatment with its own adviser.

**What Waitron does today.** A bill discounted 100% closes as a €0.00 ticket. The discount's
reason, who asked for it and who approved it are recorded, on the discount rather than on the
ticket. "Staff meal" is one of the standard discount reasons (up to 50% off before approval is
needed). Waitron holds no figure for what a dish costs: recipes and stock are not built.

- *Example.* The owner invites a table of four regulars. On the menu the meal comes to €160; the
  ingredients cost about €48.
  - Today: a €0.00 ticket and no VAT.
  - Risk-free treatment: an invoice with €48 before VAT and €4.80 VAT, which the venue pays.
  - Defensible treatment: no VAT, as today, as long as the reason is a business one.

**What should change.** Let the venue mark each discount reason as either "self-supply at cost" or
"business invitation, outside VAT", and issue the matching document. Valuing at cost needs a cost
figure, which Waitron doesn't have. Thursday's question 17 asks what "cost" means, which document is
issued, and how staff meals are treated.

**Your decision (D5).** Let each venue choose per discount reason, built after Thursday? Or one
treatment for every venue? *Recommended: the per-reason choice, since the adviser leaves it to each venue
and its adviser.*

### B6. A drink sold at the wrong VAT rate

**The situation.** A product set up with the wrong VAT rate may sell for weeks before anyone
notices. For example, a bottle of wine sold to take away is set up at 10% when it should be 21%.
(Drinks served at the venue are part of the restaurant service, at 10%, so a cocktail served at a
table is right at 10%.)

**The adviser's answer (1.13).** Do not issue correctives to customers: the law forbids charging them the
difference afterwards (LIVA 89.Tres.1.º). The venue pays the difference itself, treating the price
it charged as already including the right rate (DGT V0824-25 and V0624-23).

- Found before that quarter's VAT return is filed: put it right in that return.
- Found after: file a complementary return for each quarter concerned, with any surcharge and
  interest.

**What Waitron does today.** Nothing exists for this. The backlog entry "Correct VAT without
returning money" is open with no design, and the VAT report cannot include an adjustment.

- *Example.* In the first quarter, 200 bottles of wine to take away at €8.00 were sold at 10%
  instead of 21%, €1,600 in all. VAT charged: €1,600 × 10/110 = €145.45. VAT due: €1,600 × 21/121 = €277.69. The venue
  pays €132.24 more. The customers' tickets stay as they are.

**What should change.** No documents for customers. Correct the product's rate for future sales.
Then either Waitron works out the difference for each quarter for the accountant, or the
accountant works it out outside Waitron.

**Your decision (D6).** *Owner, 16 November: Waitron produces a report of the corrections made
this quarter that belong to earlier quarters, here the affected sales and the difference for each
quarter, and the accountant files them as complementary returns. Waitron files nothing itself and
never changes a report already filed (Part B13).* This settles the "Correct VAT without returning
money" entry.

### B7. Spotting a supplier invoice entered twice

**The situation.** When staff enter a supplier's invoice into Waitron (for the purchases side of
the VAT return), Waitron refuses one that looks already entered, so the VAT isn't reclaimed twice.
The question is what counts as "the same invoice".

**The adviser's answer (2.6 (b), a correction to our proposal).** Don't use "same number within one year".
Use an invoice's full identity: the supplier's tax number, its series and number, and its date of
issue (RD 1619/2012 art. 6.1.a; AEAT's developer FAQ §6).

**What Waitron does today.** The same supplier and number are refused within one year of issue and
accepted, with a warning, in another year. That was your rule A981 of 21 October. There is no
separate series field, so a series can only be typed as part of the number.

- *Example: a wrong refusal.* A supplier has two series but doesn't print them as prefixes. It
  sends an invoice "15" dated 3 February and another "15" dated 9 June. Today Waitron refuses the
  second; by the adviser's key it is accepted.
- *Example: a miss.* The same invoice is entered twice, once dated 3 February and once with the
  date mistyped as 2 March. By the adviser's key alone, both are accepted.

**What should change.** Refuse when the supplier, number and date of issue all match. Warn, but
don't refuse, when the same supplier and number arrive with a different date: that catches a
mistyped date.

**Your decision (D7).** Make that change, replacing rule A981? *Recommended: yes.*

### B8. Correctives of full invoices need a series of their own

**The situation.** Correctives get their own numbering series, apart from ordinary invoices. The
question is whether correctives of tickets (R5) and of full invoices (R1 to R4) may share one.

**The adviser's answer (1.14, second half).** No. They are different types and must use separate series (RD
1619/2012 arts. 6.1.a and 7.1.a).

**What Waitron does today.** Every corrective goes in one corrective series. Correcting a full
invoice is refused, except for one case: a corrective for a full invoice whose date was wrong (an
R4), which is built but switched off. If it were switched on today, it would share the R5 series.

**What should change.** Give full-invoice correctives their own series before that feature is
switched on. You decided on 15 November that they will not share, so no decision is needed; this is
recorded so the fix isn't missed. Thursday's question 4 asks a narrower point: whether correctives
for a wrong date need a series apart from other ticket correctives.

### B9. A venue's own backup copy held outside the EU

**The situation.** Waitron keeps a continuous copy of the venue's data off the premises, in
"bucket" storage: either Waitron Cloud's, or a storage provider the venue chooses itself. The rules
on keeping invoices outside Spain might apply to that copy.

**The adviser's answer (1.15).** A copy held abroad, while the original stays on the venue's server in
Spain, is not in itself "keeping invoices outside Spain". But whoever holds the copy for the venue
is a **third party** under RD 1619/2012 art. 19.3. A third party established outside the EU (in a
country without an equivalent mutual-assistance agreement) must be notified to AEAT before storage
starts (art. 19.4), through AEAT's procedure GZ05. GZ05 still reads like an application for
permission, so the adviser recommends waiting for AEAT's reply. If the server in Spain were lost and the copy
abroad became the only one, that could count as keeping invoices outside Spain, so notifying the
copy in advance is a sensible precaution.

**What Waitron does today.** Waitron Cloud is designed but not live. Its copies would be with
Amazon Web Services, in Spain plus an encrypted second copy in Paris, both inside the EU. A venue's
own bucket can be with any provider in any country. Nothing warns about this or mentions GZ05.

**What should change.** For a venue's own bucket, either allow only providers established in the
EU, or warn that one established outside it must first be notified to AEAT.

**Your decision (D8).** *Owner, 16 November: Waitron Cloud uses EU data centres, so the question is
not put to the adviser. For a venue's own bucket: allow any provider, and warn that one established
outside the EU must first be notified to AEAT (procedure GZ05), because Waitron cannot tell where a
provider is established.*

### B10. Rebuilding invoice copies after a restore

**The situation.** If the venue's server is restored from an old backup, every invoice issued after
that backup was taken is missing from the server, although their records reached AEAT.

**The adviser's answer (1.16).** Retrieve those records from AEAT's record query service and use them to
rebuild the invoice copies. The venue does not have to keep the records it sent to AEAT, since AEAT
holds them, but it does have to keep **copies of its invoices** (RD 1619/2012 art. 19; AEAT's
developer FAQ §13.1).

**What Waitron does today.** Once a day Waitron asks AEAT which records it holds. For an invoice
AEAT has and the server doesn't, Waitron keeps only its number, its state and its fingerprint, as
evidence of a conflict. AEAT's reply can also carry each invoice's description, customer, VAT
breakdown and totals, but not its dishes. Waitron discards those.

- *Example.* A backup from Friday is restored on Sunday. Saturday's 140 tickets were sent to AEAT
  but are not on the server. Today Waitron can show their numbers and nothing more.

**What should change.** Keep everything AEAT's reply carries for those invoices, so that a copy can
be rebuilt and shown. Thursday's question 20 asks whether a copy without the dishes is acceptable.

**Your decision (D9).** Build this after Thursday? *Recommended: yes.*

### B11. The date of the sale, now being built

**The situation.** An invoice shows the date it was issued. When it is issued on a later day than
the sale, for example a meal on Monday paid on Thursday, it must also show the date of the sale.
Lane L (the campaign lane that builds fiscal features) is building this on the branch
`feat/later-sale-date`, open as PR #3398 and not landed.

**The adviser's answer (1.4).** A meal is one service, supplied when it ends, not dish by dish. A dinner that
runs past midnight is dated the day it ends. If the VAT rate changes, the rate on the day the meal
ends applies, except to advance payments, which keep the rate of the day they were paid (DGT
V0602-10). The issue date may stand as the date of the sale when the ticket is issued at the end of
the meal. An invoice issued on a later day (a late close, payment by bank transfer) must also state
the date of the sale.

**What Waitron does today.** On `main`, an invoice shows only its own date (your decision A444 of
12 November), and VAT is charged at the rates of the day the bill is fully paid. Lane L's branch
adds the date of the sale to a later invoice and charges that day's rates, which matches the
adviser's answer. Three points don't yet:

- *When the meal ends.* The branch takes the day the last dish was served, when that falls on an
  earlier trading day than the payment. With D1, the meal ends when staff close the table, which is
  also when the ticket is issued, so the ticket's own date is the date of the meal (owner,
  16 November). The branch's rule is then needed only as a fallback, for a table closed on a later
  trading day than its last dish, such as a bill left open overnight by mistake. In a venue whose
  trading day turns over at midnight, the fallback also catches a table served its last dish at
  23:40 that pays at 00:30, and gives it the day before as its date of sale; the adviser speaks of
  the day the meal *ends*, which would be the later day. Thursday's question 3 asks.
- *Example 3 in Part B1* (paid Monday, dessert removed Wednesday) is the branch's own example 3.
  It relies on the ticket waiting for full payment, which the adviser rejects and you have
  dropped (D1).
- *The VAT period.* The branch counts an invoice issued late in its meal's quarter, so that
  quarter's figures change after its return is filed. Your decision D12 puts that VAT on a separate
  corrections line instead (Part B13). With D1, an invoice issued late should be rare.

**Your decision (D10).** *Owner, 15 November: decide after Thursday's meeting; lane L is not told
before then.* Nothing on the branch can land before that, since fiscal changes are landed by you.

### B12. Money given back as goodwill after the ticket

**The situation.** A guest complains after paying and the manager gives some money back. The ticket
has already been issued for the full price.

**The adviser's answer (1.5).** A price reduction made after the ticket is issued "will, where applicable,
require" a corrective invoice (LIVA 80.Uno.2.º; DGT V1493-26).

**What Waitron does today.** "Refund a payment" can give money back after the ticket without any
corrective. The design for correcting paid invoices keeps it that way on purpose, for a goodwill
return on a dish that was served.

- *Example.* A guest complains after paying €62, and the manager gives €10 back. With no
  corrective, the venue goes on declaring VAT on €62: about €0.91 more than on €52.

**Your decision (D11).** None until Thursday's question 19 asks whether the corrective is required
or only allowed.

### B13. Changes to a quarter whose VAT return is already filed

**The situation.** Some changes reach back into a quarter whose VAT return has been filed: a
cancellation, a corrective for a wrong date, a wrong VAT rate found late, or an invoice issued after
its meal's quarter has ended.

**The adviser's answers.** For a cancellation (answer 1.12), the venue may take the reduction in the
current quarter's return or have the old return corrected. For a wrong VAT rate found after filing
(answer 1.13), a complementary return is filed for each quarter concerned, with any surcharge and
interest. A meal's VAT falls due when the meal ends (answer 1.4), so VAT on a meal belongs to the
quarter in which it ended. A corrective for a wrong date is not answered yet (question 7).

**What Waitron does today.** A cancellation counts on the day it is made. A corrective for a wrong
date moves the sale's VAT back to its real day, so an earlier quarter's figures change after its
return is filed. Lane L's branch does the same for an invoice issued late (Part B11).

- *Example.* The ticket for a meal on 28 March is dated 2 April because the clock was wrong. The
  first quarter's return is filed on 20 April, and the corrective is issued in May. Today Waitron's
  first-quarter report changes after it was filed. Under D12 it stays as filed; the second-quarter
  report, not yet filed in May, no longer counts the ticket, and a corrections line shows the
  ticket's VAT as owed for the first quarter.

**What should change.** A quarter's report counts that quarter's own invoices, with the
corrections made to them within the same quarter, and a report already filed never changes. A
correction made later to an earlier quarter's invoice is never counted in the current quarter,
whichever way it moves the VAT. It goes on a separate report of corrections, grouped by the quarter
of the original invoice and by VAT rate, with reductions and additions apart. The accountant files a
reduction in the current return or by having the earlier return corrected (answer 1.12), and an
addition as a complementary return (answer 1.13). Question 7 asks the adviser to confirm.

**Your decision (D12).** *Owner, 16 November: a filed report never changes; reductions in the
current quarter, additions on a corrections report. Widened by the owner later the same day: "we
use a corrections report instead of just adding the transaction to the current period", so
reductions go on the corrections report too, as above.*

## Part C. To remember when these are built

- **Deposits (answer 1.8). Not built; no backlog number yet.** A deposit for an identified booking
  (date, number of guests, menu or price) is an advance payment and gets its own ticket. A deposit
  that identifies nothing is not. The final ticket shows the meal's total, the deposit's amount
  before VAT and its VAT, and what is left to pay; the record sent to AEAT carries only what is
  left. *Example:* a €40 deposit (€36.36 plus €3.64 VAT) for a meal that comes to €160 (€145.45
  plus €14.55 VAT). The final ticket shows €160, minus the deposit, €120 to pay, and its record
  carries €109.09 plus €10.91 VAT. What happens to the deposit's VAT after a no-show is Thursday's
  question 18.
- **Cash rounding (answer 1.5). Not built.** Cents added by rounding a cash total up are part of the
  price (DGT V1919-18). Cents left off by rounding down are a discount and must be on the ticket,
  so the ticket never shows more than was collected. *Example:* €12.37 rounded down to €12.35 shows
  "Rounding −€0.02" and a €12.35 total; rounded up to €12.40, the €0.03 is part of the price.
- **The pre-bill (answer 1.2; backlog A446).** A pre-bill is the bill printed for the table to check
  before paying. The adviser confirms the strict reading our design follows: it is a preparatory document,
  produced by the same system, kept, and linked to the ticket that follows. Every later change to
  the order must be recorded, but the order need not be locked. A line saying it is not an invoice
  is advisable, not required; the design doesn't have one yet. The adviser's answer on when the ticket is
  issued (1.1) changes nothing in A446, so it can go ahead.
- **A full invoice in exchange for a ticket (F3; backlog A556). Not built.** When it is built, it
  shows the date of the sale when that differs from its own date (answer 1.4). Sent by email, it is an
  original, not a duplicate (answer 2.5).
- **A refund to a card when the customer isn't present (answer 1.7).** Issue the corrective anyway and
  keep it linked to the evidence of the refund; the risk of not having delivered it remains.
  Waitron's "Correct invoice" already makes the link.

## Part D. Index of your decisions

Each is explained in full in its section.

| Decision | About | Section | Recommendation |
| --- | --- | --- | --- |
| D1 | Issue the ticket when the meal ends, paid or not | B1 | Decided 16 November: yes; advance tickets after question 15 |
| D2 | Print every ticket; consent wording for email | B2 | Decided 16 November: keep None. Consent wording and reprint-as-original: recommended, not decided |
| D3 | Cancellation record instead of a corrective when nothing was served or paid | B3 | Yes |
| D4 | A free item takes its share of the price | B4 | Build A445 now |
| D5 | A whole table free: self-supply at cost, or outside VAT | B5 | Per discount reason, after question 17 |
| D6 | Wrong VAT rate: who works out the difference | B6 | Decided 16 November: a corrections report the accountant files |
| D7 | Supplier invoice duplicates: number and date | B7 | Yes |
| D8 | Own backup bucket outside the EU | B9 | Decided 16 November: Cloud in EU data centres; a venue's own bucket allows any provider, with a warning |
| D9 | Keep what AEAT returns, to rebuild copies | B10 | Yes, after question 20 |
| D10 | Date of the sale on lane L's branch | B11 | Decided: after Thursday |
| D11 | Goodwill refunds without a corrective | B12 | After question 19 |
| D12 | A filed report never changes; every later correction of an earlier quarter, reduction or addition, goes on a corrections report | B13 | Decided 16 November, widened the same day; question 7 asks the adviser to confirm |

## Evidence

Read on `main` at `52aa441257` unless stated; rows marked 16 November were read at `633447ed3c`.
Nothing was run.

| Claim | Where |
| --- | --- |
| The ticket waits for full payment, with nothing pending and nothing unsent | `apps/server/src/bill-payments.ts:745-781` (`issueWhenFullyPaid`) |
| A part-payment leaves the bill open with no invoice | `apps/server/src/bill-payments-api.test.ts:766` |
| "Left without paying" is refused while the bill holds a payment | `apps/server/src/unpaid-departure.ts:113-114` |
| Example 3 (paid Monday, dessert removed Wednesday) | `docs/superpowers/plans/2026-11-15-later-sale-date.md:110-139` |
| The branch takes the last dish served on an earlier trading day; the plan states the midnight cost | same plan, lines 83-98 |
| None closes the window and records nothing | `apps/till/src/widgets/settlement-document-dialog.ts:111-118` |
| Email has no consent step (owner, 9 October); A448 open | `docs/backlog/printers.md:713-717` |
| A reprint is always a duplicate | `apps/server/src/transaction-receipt-api.ts:288` and `apps/server/src/orders-reprint.ts:29` call `enqueueReceiptCopy`, which lays the receipt out as a copy unconditionally (`apps/server/src/receipt-print.ts:321`) |
| No cancellation record is sent; core's `recordVoid` is called from a test helper only (the `recordVoid` in `packages/payments` is a card void, a different function) | `apps/server/src/testing/order-venue.ts:229-234`; `docs/backlog/fiscal.md:147` |
| Cancelling an issued order credits it with a corrective (C126) | `apps/server/src/working-order.ts:7428-7435`; `docs/backlog/fiscal.md:748-762` |
| A free item is priced at €0 and its rate files nothing | `apps/server/src/adjustments-apply.ts:783-794`; `apps/server/src/full-comp.fiscal-identity.test.ts:263-292` |
| A bill discount is spread by charged value | `packages/adjustments/src/spread.ts:265-275` |
| A full comp closes as a €0.00 ticket | `apps/server/src/pay-owing-nothing.test.ts:379` |
| The discount records reason, requester and approver | `packages/db/src/schema/adjustments/adjustments.ts:61-76` |
| Staff meal is a discount reason, 50% without approval | `apps/server/src/guide/en/table-service.md:34-35` |
| No dish cost exists: `packages/recipes` holds no tracked file | `git ls-files packages/recipes` prints nothing |
| The VAT report has no adjustment for a wrong rate | `packages/reporting/src/modelo-303.ts:14-17, 93-95`; `docs/backlog/fiscal.md:915-920` |
| Partial deduction: full base, scaled VAT | `packages/reporting/src/input-vat.ts:33-36, 66-70`; `input-vat.test.ts:140-153` |
| Supplier invoices unique by supplier, number and issue year | `packages/db/src/schema/purchase-invoices.ts:51-55`; `packages/purchasing/src/supplier-year.test.ts:26-46` |
| One corrective series; the R4 for a wrong date uses it and is switched off | `packages/db/src/schema/series.ts:43`; `packages/fiscal-verifactu/src/record-remedy-replacement.ts:79` |
| A venue's own bucket has no country restriction | `apps/server/src/stream-host.ts:65-151` |
| Cloud's planned storage: AWS Spain plus Paris | `waitron-cloud/docs/cloud-data-processing-register.md:56-57, 88-90` (the Cloud repository) |
| A restore takes a new installation number and new series | `packages/fiscal-verifactu/src/allocation.ts:436-464` |
| The daily check keeps number, state and fingerprint only | `packages/fiscal-verifactu/src/reconcile-series.ts:61-110` |
| AEAT's query reply may carry description, recipients, VAT breakdown and totals | `schemas/RespuestaConsultaLR.xsd:121-146` in the `verifactu` library repository |
| A goodwill return after the ticket uses Refund with no corrective | `docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md:299-302` |
| Pre-bill, part-payment and free-item entries | `docs/backlog/fiscal.md:20-46` |
| A printed original cannot be resent from the printer queue; a failed one or a copy can (16 November) | `packages/printing/src/outbox.ts:72-76` |
| A resend keeps the job's original-or-copy marking (16 November) | `apps/server/src/print-job-reprint.ts:109, 122` |
| A wrong-date corrective moves the sale's VAT to its real day (16 November) | `packages/reporting/src/vat-return.ts:24-27` |

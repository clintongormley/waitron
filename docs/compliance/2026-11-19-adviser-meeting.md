# Adviser meeting, Thursday 19 November 2026

Written 15 November 2026 for the owner; last updated 18 November. Nothing here has been sent.

**How to use it.** Part 1 is in English, for you. Part 2 asks the same questions in Spanish, for the
tax adviser, and can be printed on its own. Each question can be read without the others. Questions
1 and 2 need the adviser's judgement, questions 3 to 14 are confirmations, questions 15 to 21 follow
up the adviser's answers of 15 November, questions 22 and 23 ask about what is still missing, questions 24 and 25, added on 17 November,
ask about duplicates and about separate tickets after a table's ticket, and question 26, added on 18 November, asks what a set menu's ticket and invoice must list.

**Where the questions come from.** The adviser answered S1 to S16 and R1 to R6 of the October
[shortened list](asesor-questions.md#the-shortened-list-2026-10-09) on 15 November; what those
answers change is in [2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md). The other
questions come from the [6 November list](2026-11-06-adviser-questions.md), whose T numbers are given
in brackets in Part 1, cut to what is still open. What was dropped, and why, is at the end.

**How the Spanish quotations were checked.** Each quotation of a law, ruling or FAQ was matched word
for word, by a script, against the official texts: those of questions 13 and 14 for the 6 November
list, the rest on 15 November 2026 (the BOE's consolidated texts, the DGT's PETETE database, and
AEAT's developer FAQ v1.3 in [sources/](sources/)). The downloads are not committed. Every other word
in « » is ours, and "where applicable" in question 19 is the adviser's own English. The annex is an
example printed by the declaration's own code, not a law. Question 24's two quotations come from
the BOE text of RD 1619/2012 art. 14 quoted in [verifactu-findings.md](verifactu-findings.md) §15.1,
fetched 12 September 2026, and were not run through the script. Question 26's quotations of RD 1619/2012
and LIVA were matched by a script against the BOE's consolidated texts on 18 November 2026; its quotation of
V0858-11 comes from the copy inside V0237-25 published by fiscal-impuestos.com, not from the DGT's database.

## Part 1: English (for the owner)

### Needs the adviser's judgement

**1. One price for a takeaway set menu (T17).**

*The situation.* A set menu eaten at the venue and served by its staff is one restaurant service,
taxed at 10% as a whole, drinks included (LIVA 91.Uno.2.2.º). Taken away or delivered, it is a sale
of goods instead, and each part takes its own rate: food 10%, a sugared soft drink 21% (LIVA
91.Uno.1.1.º; DGT V2949-16). So a takeaway set menu sold at one price has to be split between the
two rates.

*What Waitron proposes.* Split the price in proportion to what each part sells for on its own.
Example: a €12.00 takeaway menu of a burger (€9.50 on its own) and a cola (€3.00 on its own).
Shared by those prices, the burger carries €9.12 at 10% and the cola €2.88 at 21%. Until this is
answered, Waitron keeps set menus off takeaway orders.

*We ask:*

- (a) May the price be shared by each part's own price? Must the share be exact?
- (b) If the customer leaves out the cola and still pays €12.00, is it all food at 10%?
- (c) At the counter of a venue that also has tables or a bar: a cola rung up as drunk on the
  premises (10%), which the customer then carries out, does it stay at 10%? If the customer says
  nothing, may it be rung up as drunk on the premises?

Yes / No / Note: ____________________________________________

**2. Errors in the time alone (T5, T6).**

*The situation.* Each record sent to AEAT carries the exact date and time it was made (Orden
HAC/1177/2024 art. 7.e), but an invoice shows only its date (RD 1619/2012 arts. 6.1.b and 7.1.b),
and AEAT's developer FAQ says the time of issue is not part of the record. A server clock that was
wrong and is put right gives two cases:

- The server restarts, its clock is found to be 2 hours fast, and it is set back 2 hours. Invoice 5,
  made after the correction, carries an earlier time than invoice 4, made before it.
- A ticket is stamped 21:10 for a sale at 20:50 the same day.

*What Waitron does.* Neither is marked or corrected; the restaurant keeps a note of the incident. The
one rule requiring records in time order, art. 7.i of the Orden, does not apply to Veri\*Factu
systems (art. 3). An invoice is corrected only if the error moved it onto another day, for example a
sale at 23:30 stamped 01:30 the next day; it is then corrected as a wrong date (question 7). One
passage points the other way: the developer FAQ, §17 case 2.b, says an error in an internal field of
a record needs a correcting record.

*We ask:* Is that right, in both cases?

Yes / No / Note: ____________________________________________

### Confirmations: what is filed or signed from the first day

**3. When the meal ends (follows answers 1.1, 1.3 and 1.4).**

*The situation.* The adviser answered that a meal is one service, supplied when it ends, and that
the ticket is due then, not held back until the bill is fully paid.

*What Waitron proposes.* When a table asks for the bill, staff print it: the ticket is issued at
that moment, for everything on the bill, and the guests pay against it, in one payment or several.
Separate bills at one table are printed separately. Before printing, staff are shown any dish not
yet served, and may print anyway. A bill nobody printed is issued at its last payment, or when staff
record that the guests left with part unpaid. The ticket carries the date it is issued. A separate
date of the meal appears only when a bill is issued on a later trading day than its last dish was
served (the venue's trading day ends at the start-of-day time it sets), for example a bill left open
overnight by mistake; the date of the meal is then the day of its last dish.

*Example.* The last dish is served at 23:40 on the 1st. At 00:20 on the 2nd the guests ask for
the bill and staff print it; at 00:30 one pays half by card and the other the rest in cash. With a
05:00 start of day, all of it falls in the evening's service: the ticket is dated the 2nd, with no
separate date of the meal. With midnight, the ticket is dated the 2nd and shows the 1st as the date
of the meal. Both payments are recorded against that ticket.

*We ask:* Does the meal end when the bill is printed for the guests to pay, rather than when the
last dish is served or when the last payment is made? Is the trading-day rule acceptable for a
bill issued late?

Yes / No / Note: ____________________________________________

**4. A series for correctives of a wrong date (follows answer 1.14).**

*The situation.* The adviser confirmed that correctives of tickets (AEAT's type R5) and of full
invoices (R1 to R4) need separate series. A ticket with a wrong date, for example because the
server's clock was a day ahead, is put right with a corrective that states the real date and
changes no amount.

*What Waitron does.* Every ticket corrective, including one for a wrong date, goes in one series that
holds only ticket correctives. Ruling V2884-16 would even allow ticket correctives in the ticket
series, but rulings V1665-22, V0902-22, V1924-23 and V2611-24 say a corrective of a wrong issue date
must be in a series of its own.

*We ask:* Is one series of ticket correctives enough, or do correctives for a wrong date need a
series of their own?

Yes / No / Note: ____________________________________________

**5. The software declaration: what the system consists of (T14).**

*The situation.* The maker of invoicing software signs, for each version, a declaration that it
complies with the rules (the declaración responsable, Orden HAC/1177/2024 art. 15). Its item d)
lists the system's components and says briefly what the system does. None has been signed yet. The
annex at the end of Part 2 is the whole declaration as a first version would print it, made by the
declaration's own code.

*What Waitron proposes.* Today's draft of item d) with two additions, both in the annex: what the
print agent does, and that the terminals ask the server for invoices and display them. The
standby-server sentence and the words "or a server in the cloud" appear only in a version that can
do those things, so the annex leaves them out.

*We ask:* Is item d) sufficient?

Yes / No / Note: ____________________________________________

**6. The software declaration: several taxpayers (T15).**

*The situation.* Item f) of the same declaration asks whether the system can be used to invoice for
several taxpayers: S (yes) or N (no).

*What Waitron proposes.* Waitron answers N: each venue has its own installation, database and
certificate, on its own server or in Waitron Cloud. The Veri\*Factu library that Waitron uses is
declared separately, under its own system code WV, and answers S, because another program using it
could invoice for several taxpayers (owner, 14 November). A venue that moves between its own server
and Waitron Cloud keeps Waitron's system code, gets a new installation number and needs no new
declaration.

*We ask:*

- (a) Are those answers right? Does item f) look at one installation, or at the product as sold to
  many customers? We read it as one installation: almost every till system is sold to many
  businesses, so the number of customers would tell AEAT nothing.
- (b) In Waitron Cloud, Waitron runs a separate installation, database and certificate for each
  venue. Does that make Waitron one user supporting the invoicing of several taxpayers, in item
  f)'s words (*un mismo usuario para dar soporte a la facturación de varios obligados
  tributarios*), so that item f) must say S?

Yes / No / Note: ____________________________________________

### Confirmations: when the clock was wrong

**7. A wrong date on an invoice, and the VAT period of a correction (T7).**

*The situation.* If the server's clock was wrong, an invoice can carry the wrong day. Example: after
a power cut the clock runs a day ahead, and the ticket for a meal on 31 March is dated 1 April. The
first quarter's return is filed on 20 April; the error comes to light, and is corrected, in May.

*What Waitron does.* It issues a corrective, dated the day it is issued, stating the real date of the
sale and changing no amount (DGT V1665-22; V0305-24). One corrective may cover several invoices (RD
1619/2012 art. 15.4).

*What Waitron proposes for the VAT period.* A quarter's report counts that quarter's own invoices,
with the corrections made to them within the same quarter, and a report already filed never
changes. A correction made later to an earlier quarter's invoice is not counted in the current
quarter, whether it lowers the VAT or adds to it. It goes on a separate corrections report, grouped
by the quarter of the original invoice and by VAT rate, with reductions and additions shown apart.
The accountant then files each one as the law allows: a reduction in the current return (LIVA art.
89.Cinco.b, as answer 1.12 allows for a cancellation) or by having the earlier return corrected
(LGT art. 120.3); an addition in a complementary return for its quarter (LGT art. 122), in line with
answer 1.13 for a wrong VAT rate. A correction made before the earlier quarter's return is filed
goes on the same report, for the accountant to include in that return. In the example, the first
quarter stays as filed, the second-quarter report (not yet filed in May) no longer counts the
ticket, and the corrections report shows its VAT for the first quarter. The same applies to an invoice issued after its meal's quarter was filed, for example a
bill left open by mistake from 31 March to 25 April: its VAT fell due when the meal ended (LIVA
75.Uno.2.º; answer 1.4).

*We ask:*

- (a) Is a corrective the right way to correct a wrong date?
- (b) Is the proposal right for the VAT period, in both cases? Is it what LIVA art. 89.Cinco asks
  for?
- (c) Should the accountant's export list such an invoice by the date of the sale or by the date of
  issue?

Yes / No / Note: ____________________________________________

**8. Who receives the corrective (T1; follows answer 1.7).**

*The situation.* A corrective invoice is normally sent to the customer of the invoice it corrects.
But a ticket doesn't name its customer. Example: a ticket must be corrected because the server's
clock gave it the wrong date, and nobody knows who paid it.

*What Waitron does.* The restaurant issues the corrective, keeps it and sends its record to AEAT. The
corrective reaches the customer only when the restaurant knows who they are. For a card refund when
the customer is not present, the adviser answered (1.7) that the venue issues the corrective anyway
and keeps it linked to the evidence of the refund, and that the risk of not having delivered it
remains. A corrective for a wrong date differs in one way: it changes no amount.

*We ask:*

- (a) Does answer 1.7 apply here too: issue the corrective, keep it, and deliver it only to a
  customer the venue knows?
- (b) When the corrective changes nothing the customer paid, does not delivering it carry any risk?

Yes / No / Note: ____________________________________________

**9. Telling AEAT about a clock incident (T8).**

*The situation.* The server's clock was found to be wrong and the affected invoices were corrected,
or left as they were because only the time was wrong.

*What Waitron proposes.* Nothing is reported to AEAT. A text search of the invoicing systems
regulation (RD 1007/2023), the Orden, both AEAT FAQs and AEAT's technical documents found no duty or
channel to report one, and any corrective's record reaches AEAT anyway. Orden art. 16.4 covers
incidents that stop records being sent, which is a different case.

*We ask:* Is that right?

Yes / No / Note: ____________________________________________

### Confirmations: keeping records and giving access

**10. "Online access" without the internet (T4).**

*The situation.* Invoices kept electronically must be accessible to the tax authorities online (RD
1619/2012 arts. 21.2 and 23). A venue's Waitron server usually sits in the restaurant, on a private
network with no public address.

*What Waitron proposes.* That meets the rule if, when the tax office asks, the venue can without
unjustified delay let it see, search, copy or download, and print every invoice. No permanent
connection or public address is needed (Orden EHA/962/2007 art. 5.3; DGT 0289-04). If AEAT asks
from its own office, a copy of the period on a USB drive or through a temporary download link is
enough.

*How a copy looks.* On the inspector's Invoices page, each invoice downloads as a PDF stamped
"DUPLICADO": a full invoice in A4, a ticket at ticket width, laid out like the printed ticket. Like
a till reprint, a copy shows the issued sale's issuer, lines, totals and QR code with today's header
text and logo; a ticket copy also prints today's address when the till's ticket does. A cancelled or
replaced ticket carries no mark saying so; the list marks it "Cancelled", or shows the full invoice
that replaced it as "Replaces <ticket numbers>".

*We ask:* Is that right? And should the copy itself also say "Cancelled on <date>" or "Replaced by
invoice <number>"?

Yes / No / Note: ____________________________________________

**11. What a restaurant company keeps (T11).**

*The situation.* Waitron is designing how long it keeps each kind of record, and wants one list of
what a restaurant company must keep for tax and commercial law.

*What Waitron proposes.* Invoices issued, tickets included, and invoices received (RD 1619/2012 art.
19.1); books, correspondence and business papers (Código de Comercio art. 30.1); other evidence for
its taxes (LGT art. 29.2.e); records of payments and refunds; the software declaration of every
version used; proof of payment of sales of €1,000 or more, kept five years (Ley 7/2012 art.
7.Uno.4); and pro formas that never became invoices. All on one six-year schedule.

*We ask:* Is anything missing?

Yes / No / Note: ____________________________________________

**12. Records AEAT does not hold (T12).**

*The situation.* Normally every record reaches AEAT, which then holds it. Some never do: a record
still waiting to be sent, or one AEAT refused. In the developer FAQ's words, such a record would
never be in AEAT's systems, so the restaurant's copy is the only one.

*What Waitron proposes.* Keep such a record, with AEAT's reply, until it is settled, then on the
common six-year schedule for a restaurant's records. No source sets a period.

*We ask:* Is that right?

Yes / No / Note: ____________________________________________

### Confirmations: tips

Waitron can offer a tip when a guest pays, and keeps tips off the invoice. The card provider pays the
tip to the restaurant with the rest of the bill, and the restaurant passes it to staff.

**13. Suggested tip percentages and VAT (T9).**

*What Waitron proposes.* At payment the guest sees choices such as no tip, 5%, 10%, 15% or another
amount. The tip stays outside VAT if nothing is pre-selected, the guest can choose zero or any
amount, and the tip is not on the invoice. No ruling covers a suggested tip. The test in V1895-24,
V5110-26 and V2182-23 is that no fixed amount has been set and the amount is left to the giver.
V3298-20 taxed a donation of a fixed €50 or €100 because it was fixed and bought a discount. A list
the guest can ignore does neither, since the meal is owed whatever the guest tips. That last step
is our reading.

*We ask:* Is that right?

Yes / No / Note: ____________________________________________

**14. How card tips are booked (T10).**

*What Waitron proposes.* Card tips passed to staff are not the restaurant's income. They are a debt
to staff from the day they are collected, and paying them through payroll clears the debt, so there
is no income or expense and they do not count towards turnover. The accounting plan excludes
amounts received on behalf of others from income (PGC valuation rule 14.ª), and ruling 2174-03 calls
the business a mere intermediary. This holds only if staff, not the business, are entitled to the
tips. A contract paying wages out of the tips would change it.

*We ask:* Is that right?

Yes / No / Note: ____________________________________________

### Follow-ups on the adviser's answers of 15 November

**15. Money paid towards the bill before the meal ends (answers 1.3 and 1.8).**

*The situation.* Guests sometimes pay part of the bill before the meal is over without naming what
it pays for. The adviser answered that money paid before the table has been fully served is an
advance payment, with its own ticket (LIVA 75.Dos; RD 1619/2012 art. 2.1), provided what it pays for
is clearly identified (European Court of Justice, C‑419/02, BUPA). For deposits (answer 1.8), one
for an identified booking (date, number of guests, menu or price) is an advance, and one that
identifies nothing is not.

*Examples.*

- A table of four has €120 on its bill and has not ordered desserts. At 21:30 Ana pays €30
  "towards the bill" and leaves; the others pay the rest at 23:00.
- A group pays €1,000 towards its tab at the start of the evening, naming nothing.
- A company pays €1,000 for its dinner on the 14th: 40 guests, set menu.

*How we read the answers, and what Waitron proposes.* An amount that names no dishes and no booking
is not an advance, by the same line answer 1.8 draws for deposits. It gets no ticket of its own:
Waitron holds it against the bill, and the ticket issued when the meal ends covers everything
served and shows the amount as already paid. That covers Ana's €30 and the group's €1,000. The
company's €1,000 names a date, the guests and a menu, so it is an advance: it gets its own ticket
when paid, and the final ticket deducts it as answer 1.8 describes for a deposit. A separate ticket
for Ana alone is possible only if she pays for particular dishes, as a separate bill (answer 1.9).

*We ask:*

- (a) Have we read answers 1.3 and 1.8 correctly? Or is money paid towards this table's meal
  already "clearly identified", because it is for this meal at this table, even though it names no
  dishes and the table may still order more?
- (b) If it is an advance, what should its ticket describe when it names no dishes: "payment on
  account for the meal at table 7", at 10%? Or may it list the dishes ordered so far as paid on
  account? And may the final ticket show the total less the advance's amount before VAT and its
  VAT, as for a deposit (answer 1.8)?

Yes / No / Note: ____________________________________________

**16. A customer who wants no ticket (answer 1.11).**

*The situation.* The adviser answered that the ticket must be delivered and the customer cannot
waive it. Email needs the customer's consent, which may be tacit once they are told how the ticket
will arrive and that paper is available (RD 1619/2012 art. 9).

*What Waitron will do.* Staff ask "paper or email?". A ticket printed and left with the bill counts
as delivered, even if the customer leaves it behind. For email, the till shows "We'll email your
ticket to this address. You can ask for a paper copy at any time." and records that it was shown,
and sending the email counts as delivery. Waitron also keeps a "None" choice for a customer who
wants neither: most customers don't want the ticket, and printing every one wastes paper.

*We ask:* If the customer wants neither and staff choose None, what does the venue risk?

Yes / No / Note: ____________________________________________

**17. A whole table, or a staff meal, given free (answer 1.10).**

*The situation.* Sometimes a restaurant charges a table nothing: the owner invites regulars or
friends, or staff eat a meal on the house. The adviser answered that the risk-free treatment is a
self-supply (autoconsumo) valued at cost, not at the menu price (DGT V2347-24; LIVA 79.Cuatro), with
an invoice and a record. Treating a business invitation as outside VAT is defensible but goes
against V2347-24. Each venue chooses with its own adviser.

*Example.* The venue invites a table of four regulars. On the menu the meal comes to €160; the
ingredients cost €48. As a self-supply at cost, that is €48 before VAT and €4.80 VAT, which the venue
pays.

*We ask, for the self-supply treatment:*

- (a) What is the cost of a restaurant meal: the ingredients only, or a share of staff and overheads
  too? Without recipe costs, may the venue use a standard percentage of the menu price (say 30%)?
- (b) Which document is issued, to whom (the venue itself, or the table), and what record is sent
  to AEAT?
- (c) A meal given free to an employee during their shift: is it also a self-supply at cost, or
  outside VAT?

Yes / No / Note: ____________________________________________

**18. A deposit kept after a no-show (answers 1.7 and 1.8).**

*The situation.* The adviser answered that a deposit for an identified booking is an advance payment
with its own ticket (answer 1.8), and cited DGT V0839-20: money kept as compensation when a booking
is cancelled is outside VAT. To reduce the VAT already declared, though, LIVA 89.Cinco.b asks for
the VAT to be refunded to the customer.

*Example.* A €40 deposit for a booking gets its own ticket: €36.36 before VAT and €3.64 VAT at 10%.
The guests don't come, and the venue keeps the €40 as compensation.

*We ask:* Does the venue issue a corrective removing the €3.64, though it refunds nothing, or does
the deposit's ticket stand?

Yes / No / Note: ____________________________________________

**19. Money given back as goodwill after the ticket (answer 1.5).**

*The situation.* A guest complains after paying, and the manager gives some money back. The ticket
was already issued for the full price. The adviser answered that a price reduction after the ticket
"will, where applicable, require" a corrective invoice (LIVA 80.Uno.2.º; DGT V1493-26).

*Example.* A guest complains after paying €62 and the manager gives €10 back. Without a corrective,
the venue goes on declaring VAT on €62.

*We ask:* Is the corrective required, or may the venue give the money back without one and go on
declaring VAT on the full €62?

Yes / No / Note: ____________________________________________

**20. Invoice copies rebuilt from AEAT's records after a restore (answer 1.16).**

*The situation.* If the venue's server has to be restored from an old backup, the invoices issued
after that backup are missing from it, although their records reached AEAT. The adviser answered
that the venue should retrieve those records from AEAT's record query service to rebuild the
invoice copies, which it must keep (RD 1619/2012 art. 19).

*What AEAT returns.* As AEAT's technical documents describe the reply, it carries each record's
number, date, description, customer where there is one, VAT breakdown and totals, but not the
dishes.

*We ask:* Is a copy rebuilt from that acceptable, or must the venue hold the full invoice some other
way, such as its continuous backup copy?

Yes / No / Note: ____________________________________________

**21. VAT rates kept per product, and a wrong rate found later (follows answers 1.4 and 1.13).**

*The situation.* Today each product carries a VAT class (general, reduced, super-reduced or zero),
which is copied into the published menu and onto each order line; the class's percentage is looked
up on the day of the invoice. If a product's class changes while a table is still eating, the meal
keeps the old one.

*What Waitron proposes.*

- Each product keeps a dated history of two rates, one for eating at the venue and one for taking
  away (LIVA 91.Uno.2.2.º and 91.Dos), each chosen from a list Waitron maintains of the rates AEAT
  accepts (0, 2, 4, 5, 7.5, 10 and 21). A change can be scheduled ahead, for example from 1 April,
  and applied to many products at once.
- An invoice takes each product's rates on the day the meal ends (answer 1.4; LIVA 90.Dos). A dinner
  begun on 31 March that ends after midnight takes the rates of 1 April. A deposit keeps the rate of
  the day it was paid.
- A wrong rate found later is recorded on the product as a correction ("should have been 21% from
  1 February"), without rewriting what was charged. Customers' tickets stay as they are and nothing
  is sent to AEAT. For each earlier quarter, Waitron works out the VAT owed by treating the price
  charged as including the right rate, as answer 1.13 says, and puts it on the corrections report of
  question 7 for the accountant to file.

*Example.* 200 bottles of wine to take away at €8.00, sold in the first quarter at 10% instead of
21%: €1,600 × 21/121 − €1,600 × 10/110 = €277.69 − €145.45 = €132.24 owed for the first quarter, by
a complementary return.

*We ask:*

- (a) Is the proposal right?
- (b) Is the difference worked out on each invoice line, on each invoice, or on the quarter's total
  for the product? Rounding gives slightly different amounts.
- (c) A rate set too high, for example 21% charged where 10% was due: the venue paid too much VAT.
  Taking the reduction in the current return obliges it to pay the excess back to the customer
  (LIVA 89.Cinco.b), which it cannot do for a ticket that names nobody. Must it then ask for the
  earlier return to be corrected (LGT art. 120.3), or leave the VAT as declared?

Yes / No / Note: ____________________________________________

### What is still missing

**22. Two questions from October still awaited.** S18, a change of the company's legal name keeping
its tax number, and S19, holding back a chain's later records while an earlier one's answer is
unknown.

*We ask:* When can we expect the adviser's answers?

Note: ____________________________________________

**23. Other advisers we need.** Some of our questions are outside tax:

- **Legal metrology (S17, selling by weight).** A certified scale weighs the goods and either sends
  the weight, price per kilo and total to the till, or staff type the weight in. Does that meet the
  rules, does our software need certification, and who signs the declaration of conformity?
- **Labour and payroll:** card tips paid through payroll and social security (L1); overtime under a
  yearly total of hours (L2); a person's time record when a server is replaced (L3); tips on the
  payslip (L4); who withholds tax on a tip (L5); sharing tips when nothing has been agreed (L6);
  what Waitron gives the payroll office (L7); how long absences and rotas are kept (L8).
- **Privacy:** keeping allergy notes after the meal as evidence (P1); the legal basis for them during
  the meal (P2); what to remove early (P3); deleted data left in backups (P4); what assessment a
  single restaurant needs (P5); a former employee's details (P6); data the law requires us to keep
  (P7); Waitron's own role for bug reports (P8); recording what staff do at the till (P9);
  collecting a customer's details for an invoice (P10).

*We ask:* Whom do you recommend for each, and can you answer any of them yourself?

Note: ____________________________________________

The full labour and privacy questions are in the [6 November list](2026-11-06-adviser-questions.md).
P4 must be updated for A1404 (#2627, 9 November), which encrypts the bucket copy, before it is sent.

### Added 17 November

**24. Printing a duplicate when the customer asks, and what it shows (follows answer 2.1).**

*The situation.* Only one original of each invoice may be issued, and a duplicate «únicamente será
admisible» in two cases: several recipients of the same sale, or «pérdida del original» (RD
1619/2012 art. 14.1 and 14.2). The adviser's answer 2.1 says any print made after the original was
handed over says «duplicado». Today staff can reprint a ticket from the list of past receipts at any
time. Waitron marks it «DUPLICADO» and records who printed it and when, but asks no reason.

Following answer 1.3, a ticket will be issued when the meal ends, paid or not (the owner's
decision D1). Waitron will print on every ticket the payments known at the moment it is printed: each
payment, with the card's brand and last four digits, and the amount still owed, if any. A payment
made after the original was printed will get a payment slip with no invoice number, no QR code and
no amount owed. Answer 2.2 confirmed that such a slip, printed beside the ticket, is not an invoice;
this one may be printed hours or days after the ticket.

*Example.* A table's €60.00 ticket is issued at 22:00 and printed with «Pendiente: 60,00 €». The next
morning the customer pays €60.00 by card, gets the payment slip, and asks for a ticket that shows the
payment. Staff reprint it: marked «DUPLICADO», with the same number, lines, totals and QR code, plus
«Visa ****4034 60,00 €» and no amount owed.

*We ask:*

- (a) May a duplicate be printed whenever the customer asks, even though the original was not lost?
  If only when it was lost, must staff record that reason?
- (b) May a duplicate show payments made after the original was printed, when it differs from the
  original only in those payment lines?
- (c) Is a payment slip printed hours or days after the ticket still not an invoice? May it name the
  ticket number it pays, so the customer can match the two?

Yes / No / Note: ____________________________________________

**25. Two guests want their own tickets after the table's ticket was issued (follows answer 1.7).**

*The situation.* Following answer 1.3, a table's ticket will be issued when staff print the bill,
paid or not (the owner's decision D1). After a ticket is issued for a table, two guests each want
their own ticket. We propose a corrective invoice (R5) correcting the first ticket and new tickets
for each guest, never a cancellation record, because the sale happened (answer 1.7).

*We ask:* Is that right?

Yes / No / Note: ____________________________________________

**26. What a set menu's ticket and full invoice must list (follows answer 1.10).**

*The situation.* Waitron is adding set menus eaten at the venue. The menu has one price; the dishes
it covers go to the kitchen and are recorded at €0.00. A dish may carry a supplement, and a covered
dish may have a paid extra. The record sent to AEAT holds only totals per VAT rate, so it is the same
whichever lines are printed.

*What Waitron proposes.*

- The ticket and the full invoice list each menu with its price, and every supplement and paid
  extra. A covered dish with nothing to pay is not listed. A simplified invoice requires «La
  identificación del tipo de bienes entregados o de servicios prestados» (RD 1619/2012 art. 7.1.e).
  A full invoice requires «Descripción de las operaciones, consignándose todos los datos necesarios
  para la determinación de la base imponible» (art. 6.1.f), and the DGT asks for «una descripción
  genérica de los bienes o servicios que constituyan el objeto de cada operación» with enough detail
  to determine «su naturaleza, cuantía y tipo impositivo aplicable» (V0858-11). We found no ruling on
  set menus.
- A menu eaten at the venue is one restaurant service at one rate, drinks included: «el suministro
  de comidas y bebidas para consumir en el acto» (LIVA 91.Uno.2.2.º). A covered item therefore takes
  the menu's rate while it is covered.

*Example.* A €14.00 menu at 10% covers soup, sirloin and a glass of wine. The sirloin carries a €5.00
supplement and the soup a €1.50 portion of bread. The ticket shows the menu 14,00, Solomillo +5,00, and
Sopa with Pan 1,50 beneath it: €20.50 in all. The wine is not listed.

*We ask:*

- (a) May covered dishes be left off the simplified invoice?
- (b) May they be left off the full invoice? If not, is listing them under the menu without a price
  enough?
- (c) Answer 1.10 shares the price with a free item that carries another rate (LIVA 79.Dos). Does that
  apply inside a menu eaten at the venue, or is the proposal above right? And if a menu lets the guest
  choose something the venue really sells at another rate, for example a closed bottle to take home
  at 21%, must the menu's price then be shared between the two rates?

Yes / No / Note: ____________________________________________

## Part 2: Español (para el asesor fiscal)

Preguntas para la reunión del jueves 19 de noviembre de 2026. Waitron es un software de punto de
venta para restauración que funciona en modalidad VERI\*FACTU. Se ejecuta en un servidor, un equipo
en el propio local o en Waitron Cloud, cuyo reloj fecha las facturas. Cada pregunta puede leerse por
separado. Las preguntas 1 y 2 requieren su criterio; de la 3 a la 14 son confirmaciones; de la 15 a
la 21 parten de sus respuestas del 15 de noviembre a las S1 a S16 y R1 a R6 (sus apartados 1.1 a
1.16 y 2.1 a 2.6), que le agradecemos; la 22 y la 23 tratan lo que aún falta, y la 24 y la 25, añadidas el
17 de noviembre, tratan de los duplicados y de los tiques separados tras el tique de la mesa, y la 26, añadida el 18 de
noviembre, trata de lo que deben detallar el tique y la factura de un menú.

### Requieren su criterio

**1. Precio único de un menú para llevar.**

*Situación.* Consumido en el local y servido por su personal, un menú es un único servicio de
restauración al 10 %, bebida incluida (LIVA art. 91.Uno.2.2.º). Para llevar o a domicilio es una
entrega de bienes y cada parte tributa a su tipo: la comida al 10 % y un refresco azucarado al 21 %
(LIVA art. 91.Uno.1.1.º; DGT V2949-16). Un menú para llevar vendido a precio único debe, por tanto,
repartirse entre los dos tipos.

*Propuesta de Waitron.* Repartir el precio en proporción al precio de cada parte vendida por
separado. Ejemplo: un menú para llevar de 12,00 €, IVA incluido, con hamburguesa (9,50 € por
separado) y refresco (3,00 € por separado); repartido según esos precios, la hamburguesa lleva
9,12 € al 10 % y el refresco 2,88 € al 21 %. Mientras no tengamos su respuesta, Waitron no admite
menús en los pedidos para llevar.

*Preguntamos:*

- (a) ¿Puede repartirse el precio según el precio de cada parte vendida por separado? ¿Debe ser
  exacto el reparto?
- (b) Si el cliente prescinde del refresco y paga igualmente 12,00 €, ¿es todo comida al 10 %?
- (c) En la barra de un local que también tiene mesas: si se cobra un refresco para tomar aquí
  (10 %) y el cliente se lo lleva, ¿se mantiene el 10 %? Si el cliente no dice nada, ¿puede cobrarse
  como para tomar aquí?

Sí / No / Nota: ____________________________________________

**2. Errores solo en la hora.**

*Situación.* Cada registro debe incorporar «la fecha y hora exactas» de su generación (Orden
HAC/1177/2024, art. 7.e), pero la factura indica solo la fecha (RD 1619/2012, arts. 6.1.b y 7.1.b),
y las FAQ para desarrolladores dicen: «La hora de expedición e impresión material de la factura no
forma parte del RF». Si el reloj del servidor iba mal y se corrige, se dan dos casos:

- El servidor se reinicia, se descubre que su reloj iba 2 horas adelantado y se atrasa 2 horas. La
  factura 5, generada después de la corrección, lleva una hora anterior a la de la factura 4,
  generada antes.
- Un tique se fecha a las 21:10 por una venta de las 20:50 del mismo día.

*Lo que hace Waitron.* No marca ni corrige ninguno de los dos; el restaurante guarda constancia del
incidente. El art. 3 de la Orden excluye para VERI\*FACTU el art. 7.i), la única regla que exige el
orden temporal de los registros. Solo se rectifica una factura si el error la pasó a otro día, por
ejemplo una venta de las 23:30 fechada a la 01:30 del día siguiente; entonces se corrige como fecha
errónea (pregunta 7). En sentido contrario, el caso 2.b del apartado 17 de las FAQ pide un registro
de subsanación para un error en un campo interno.

*Preguntamos:* ¿Es correcto, en los dos casos?

Sí / No / Nota: ____________________________________________

### Confirmaciones: lo que se remite o se firma desde el primer día

**3. Cuándo termina la comida (a partir de sus respuestas 1.1, 1.3 y 1.4).**

*Situación.* Indica que una comida es un único servicio que se presta al terminar, y que el tique
se expide entonces, sin quedar condicionado al cobro total.

*Propuesta de Waitron.* Cuando la mesa pide la cuenta, el personal la imprime: el tique se expide en
ese momento, por todo lo que figura en la cuenta, y los clientes pagan con él, en uno o varios
pagos. Las cuentas separadas de una misma mesa se imprimen por separado. Antes de imprimir, el
personal ve los platos aún no servidos y puede imprimir igualmente. Una cuenta que nadie imprimió se
expide con su último pago, o cuando el personal registra que los clientes se han marchado sin
pagarlo todo. El tique lleva la fecha en que se expide. Solo se indica otra fecha de operación
cuando la cuenta se expide en una jornada comercial posterior a la de su último plato (la jornada
termina a la hora de inicio del día que fija el local), por ejemplo una cuenta que se dejó abierta
por error durante la noche; la fecha de operación es entonces el día de su último plato.

*Ejemplo.* El último plato se sirve a las 23:40 del día 1. A las 00:20 del día 2 piden la cuenta
y el personal la imprime; a las 00:30 uno paga la mitad con tarjeta y el otro el resto en
efectivo. Con el inicio del día a las 05:00, todo cae en el servicio de la noche: el tique se fecha
el día 2, sin otra fecha de operación. Con la medianoche, el tique se fecha el día 2 e indica el
día 1 como fecha de la operación. Los dos pagos se registran contra ese tique.

*Preguntamos:* ¿Termina la comida cuando se imprime la cuenta para que los clientes paguen, y no al
servirse el último plato ni con el último pago? ¿Es aceptable la regla de la jornada comercial para
una cuenta expedida tarde?

Sí / No / Nota: ____________________________________________

**4. Serie de las rectificativas por fecha errónea (a partir de su respuesta 1.14).**

*Situación.* Confirma que las rectificativas de tiques (R5) van en una serie distinta de las de
facturas completas (R1 a R4). Un tique con fecha errónea, por ejemplo porque el reloj del servidor
iba un día adelantado, se corrige con una rectificativa que indica la fecha real y no cambia ningún
importe.

*Lo que hace Waitron.* Pone todas las R5, también las que se expiden porque la fecha del tique era
errónea, en una serie que solo contiene R5. La V2884-16 permitiría incluso las R5 en la serie de
tiques: «las facturas simplificadas rectificativa podrán incluirse dentro de la misma serie con el
resto de facturas simplificadas». Pero las V1665-22, V0902-22, V1924-23 y V2611-24 dicen que la
rectificativa de una fecha de expedición errónea «deberá constar en serie específica de factura».

*Preguntamos:* ¿Basta una serie solo de R5, o deben ir las rectificativas por fecha en una serie
propia?

Sí / No / Nota: ____________________________________________

**5. Declaración responsable: componentes del sistema.**

*Situación.* El productor firma, para cada versión, una declaración responsable de que el sistema
cumple la norma (Orden HAC/1177/2024, art. 15). Su apartado d) recoge los componentes del sistema y
una breve descripción de lo que hace. Aún no se ha firmado ninguna. El
[anexo](#anexo-ejemplo-de-declaración-responsable) recoge la declaración completa tal como la
imprimiría una primera versión, generada por el propio código de la declaración.

*Propuesta de Waitron.* El texto actual del apartado d) con dos añadidos, ambos en el anexo: qué hace
el agente de impresión, y que los terminales solicitan las facturas al servidor y las muestran. La
frase sobre un servidor de reserva y las palabras «o un servidor en la nube» solo figurarán en una
versión que pueda hacer esas cosas, por lo que el anexo no las incluye.

*Preguntamos:* ¿Es suficiente el apartado d)?

Sí / No / Nota: ____________________________________________

**6. Declaración responsable: varios obligados tributarios.**

*Situación.* El apartado f) de la misma declaración pregunta si el sistema puede usarse para
facturar por varios obligados tributarios: S (sí) o N (no).

*Propuesta de Waitron.* Waitron responde N: cada local tiene su propia instalación, base de datos y
certificado, en su propio equipo o en Waitron Cloud. La biblioteca Veri\*Factu que usa Waitron tiene
declaración propia, con el código de sistema WV, y responde S, porque otro programa que la use
puede facturar por varios obligados. Un local que pasa de su propio equipo a Waitron Cloud, o al
revés, conserva el código de sistema de Waitron, recibe un nuevo número de instalación y no necesita
nueva declaración.

*Preguntamos:*

- (a) ¿Son correctas esas respuestas? ¿El apartado f) se refiere a una instalación, o al producto
  vendido a muchos clientes? Lo entendemos referido a una instalación: casi todos los sistemas de
  caja se venden a muchos negocios, de modo que el número de clientes no diría nada a la AEAT.
- (b) En Waitron Cloud, Waitron gestiona para cada local una instalación, una base de datos y un
  certificado propios. ¿Convierte eso a Waitron en un mismo usuario que da soporte a la facturación
  de varios obligados tributarios, en el sentido del apartado f), de modo que este deba decir S?

Sí / No / Nota: ____________________________________________

### Confirmaciones: cuando el reloj estaba mal

**7. Fecha errónea en una factura, y periodo del IVA de una corrección.**

*Situación.* Si el reloj del servidor estaba mal, una factura puede llevar un día equivocado.
Ejemplo: tras un corte de luz el reloj va un día adelantado, y el tique de una comida del 31 de marzo
sale fechado el 1 de abril. La autoliquidación del primer trimestre se presenta el 20 de abril; el
error se descubre, y se corrige, en mayo.

*Lo que hace Waitron.* Expide una rectificativa, fechada el día en que se expide, que indica la fecha
real de la operación y no cambia ningún importe (DGT V1665-22: «será necesaria la expedición de una
factura rectificativa»; V0305-24). Una rectificativa puede corregir varias facturas (RD 1619/2012,
art. 15.4).

*Propuesta de Waitron para el periodo del IVA.* El informe de un trimestre incluye las facturas de
ese trimestre, con las correcciones que se les hagan dentro del mismo trimestre, y un informe ya
presentado no cambia nunca. Una corrección hecha más tarde a una factura de un trimestre anterior no
se imputa al trimestre en curso, tanto si reduce el IVA como si lo aumenta. Se muestra en un informe
de correcciones aparte, agrupado por el trimestre de la factura original y por tipo de IVA, con las
reducciones y los aumentos por separado. El gestor presenta después cada una como permita la ley:
una reducción, en la autoliquidación en curso (art. 89.Cinco.b LIVA, como permite su respuesta 1.12
para una anulación) o mediante la rectificación de la autoliquidación anterior (art. 120.3 LGT); un
aumento, en una autoliquidación complementaria de su trimestre (LGT art. 122), en línea con su
respuesta 1.13 para un tipo de IVA erróneo. Una corrección hecha antes de presentar la
autoliquidación del trimestre anterior figura en el mismo informe, para que el gestor la incluya en
esa autoliquidación. En el ejemplo, el primer trimestre queda como se presentó, el informe del
segundo trimestre (aún sin presentar en mayo) deja de incluir el tique, y el informe de correcciones
muestra su IVA para el primer trimestre. Lo mismo vale para una factura expedida después de presentar el trimestre de su comida,
por ejemplo una cuenta que se dejó abierta por error del 31 de marzo al 25 de abril: su IVA se
devengó al terminar la comida (LIVA art. 75.Uno.2.º; su respuesta 1.4).

*Preguntamos:*

- (a) ¿Es la rectificativa la forma correcta de corregir una fecha errónea?
- (b) ¿Es correcta la propuesta para el periodo del IVA, en los dos casos? ¿Es lo que exige el art.
  89.Cinco LIVA?
- (c) ¿Debe la exportación para el gestor incluir esa factura por la fecha de la operación o por la
  fecha de expedición?

Sí / No / Nota: ____________________________________________

**8. A quién llega la rectificativa (a partir de su respuesta 1.7).**

*Situación.* La rectificativa se remite normalmente al destinatario de la factura que corrige. Pero
el tique no identifica al cliente. Ejemplo: hay que rectificar un tique porque el reloj del servidor
le dio una fecha errónea, y nadie sabe quién lo pagó.

*Lo que hace Waitron.* El restaurante expide la rectificativa, la conserva y remite su registro a la
AEAT; solo llega al cliente cuando el restaurante sabe quién es. Para una devolución con tarjeta sin
el cliente presente, indica (su respuesta 1.7) que el local expide igualmente la rectificativa y la
conserva vinculada al justificante de la devolución, y que subsiste el riesgo de no haberla
entregado. La rectificativa por fecha errónea se diferencia en una cosa: no cambia ningún importe.

*Preguntamos:*

- (a) ¿Vale aquí también su respuesta 1.7: expedir la rectificativa, conservarla y entregarla solo a
  un cliente que el local conozca?
- (b) Si la rectificativa no cambia nada de lo que pagó el cliente, ¿supone algún riesgo no
  entregarla?

Sí / No / Nota: ____________________________________________

**9. Comunicar a la AEAT un incidente de reloj.**

*Situación.* Se descubre que el reloj del servidor estaba mal, y las facturas afectadas se han
rectificado, o se han dejado como estaban porque solo era errónea la hora.

*Propuesta de Waitron.* No comunicar nada. Una búsqueda en el Reglamento (RD 1007/2023), la Orden,
las dos FAQ de la AEAT y sus documentos técnicos no encontró ni obligación ni cauce, y el registro de
cualquier rectificativa llega a la AEAT igualmente. El art. 16.4 de la Orden trata las incidencias
que impiden la remisión, que es otro caso.

*Preguntamos:* ¿Es correcto?

Sí / No / Nota: ____________________________________________

### Confirmaciones: conservación y acceso

**10. Acceso en línea sin internet.**

*Situación.* Las facturas conservadas por medios electrónicos deben permitir el acceso en línea de
la Administración (RD 1619/2012, arts. 21.2 y 23). El servidor de Waitron suele estar en el propio
restaurante, en una red privada y sin dirección pública.

*Propuesta de Waitron.* Se cumple si, cuando la Administración lo pide, el local permite sin demora
injustificada consultar, buscar, copiar o descargar e imprimir todas las facturas. No hace falta
conexión permanente ni dirección pública (Orden EHA/962/2007, art. 5.3; DGT 0289-04). Si la AEAT lo
pide desde su oficina, basta una copia del periodo en USB o un enlace temporal de descarga.

*Cómo es una copia.* En la página de Facturas del inspector, cada factura se descarga como un PDF con
la marca «DUPLICADO»: una factura completa en A4, un tique con el ancho del tique y la misma
disposición que el impreso en caja. Como una reimpresión en caja, la copia muestra el emisor, las
líneas, los totales y el código QR de la venta expedida, con el texto de cabecera y el logotipo
actuales; la copia de un tique imprime también la dirección actual si el tique de caja la imprime.
Un tique anulado o sustituido no lleva ninguna marca que lo indique; la lista lo marca como
«Anulada», o muestra la factura completa que lo sustituyó como «Sustituye a ‹números de tique›».

*Preguntamos:* ¿Es correcto? ¿Y debería la propia copia indicar también «Anulada el ‹fecha›» o
«Sustituida por la factura ‹número›»?

Sí / No / Nota: ____________________________________________

**11. Qué conserva una sociedad de restauración.**

*Situación.* Waitron está definiendo cuánto tiempo conserva cada tipo de registro, y quiere una
lista única de lo que una sociedad de restauración debe conservar por normativa fiscal y mercantil.

*Propuesta de Waitron.* Facturas expedidas, tiques incluidos, y recibidas (RD 1619/2012, art. 19.1);
libros, correspondencia y documentación (Código de Comercio, art. 30.1); demás justificantes
tributarios (LGT art. 29.2.e); registros de cobros y devoluciones; la declaración responsable de cada
versión utilizada; justificantes de pago de ventas de 1.000 € o más, cinco años (Ley 7/2012, art.
7.Uno.4); y proformas que no llegaron a factura. Todo con un calendario común de seis años.

*Preguntamos:* ¿Falta algo?

Sí / No / Nota: ____________________________________________

**12. Registros que la AEAT no tiene.**

*Situación.* Normalmente todo registro llega a la AEAT, que lo conserva. Algunos no llegan nunca: un
registro pendiente de envío, o uno rechazado. Ese registro «no figuraría jamás en los sistemas de la
AEAT (aunque constaría un rechazo)» (FAQ para desarrolladores), de modo que la copia del restaurante
es la única.

*Propuesta de Waitron.* Conservarlo con la respuesta de la AEAT hasta resolverse, y después según el
calendario común de seis años. No hemos encontrado plazo.

*Preguntamos:* ¿Es correcto?

Sí / No / Nota: ____________________________________________

### Confirmaciones: propinas

Waitron puede ofrecer una propina al cobrar, y la deja fuera de la factura. El proveedor de pagos
abona la propina al restaurante junto con el resto de la cuenta, y el restaurante la entrega al
personal.

**13. Porcentajes de propina sugeridos e IVA.**

*Propuesta de Waitron.* Al pagar, el cliente ve opciones como sin propina, 5 %, 10 %, 15 % u otro
importe. La propina queda fuera del IVA si no hay nada preseleccionado, el cliente puede elegir cero
o cualquier importe, y la propina no figura en la factura. Ninguna consulta trata una propina
sugerida. El criterio de las V1895-24, V5110-26 y V2182-23 es que «no se haya establecido una cuantía
fija» y que el importe quede «a la libre determinación» de quien lo da. La V3298-20 gravó un
donativo fijo de 50 € o 100 € porque era fijo y daba derecho a un descuento. Una lista que el cliente
puede ignorar no hace ninguna de las dos cosas, porque la comida se debe con o sin propina. Este
último paso es nuestra lectura.

*Preguntamos:* ¿Es correcto?

Sí / No / Nota: ____________________________________________

**14. Contabilización de las propinas cobradas con tarjeta.**

*Propuesta de Waitron.* Las propinas de tarjeta que se entregan al personal no son ingreso del
restaurante. Son una deuda con el personal desde el día en que se cobran, y su pago en nómina la
cancela, de modo que no hay ingreso ni gasto y no cuentan para la cifra de negocios. El Plan General
de Contabilidad excluye de los ingresos «las cantidades recibidas por cuenta de terceros» (norma de
registro y valoración 14.ª), y la consulta 2174-03 califica a la empresa de «mero intermediario».
Solo vale si el derecho a las propinas es del personal y no de la empresa; un contrato que pagase
salarios con las propinas lo cambiaría.

*Preguntamos:* ¿Es correcto?

Sí / No / Nota: ____________________________________________

### A partir de sus respuestas del 15 de noviembre

**15. Lo pagado a cuenta antes de terminar la comida (sus respuestas 1.3 y 1.8).**

*Situación.* A veces los clientes pagan parte de la cuenta antes de terminar la comida sin indicar
qué pagan. Indica que lo pagado antes de que la mesa esté servida del todo es un pago anticipado,
con su propia factura (LIVA art. 75.Dos; RD 1619/2012, art. 2.1), siempre que lo que se paga esté
claramente identificado (STJUE C-419/02, BUPA). Para las señales (su respuesta 1.8), la de una
reserva identificada (fecha, número de comensales, menú o precio) es un anticipo, y la que no
identifica nada no lo es.

*Ejemplos.*

- Una mesa de cuatro lleva 120 € consumidos y aún no ha pedido postres. A las 21:30 Ana paga 30 €
  «a cuenta» y se marcha; los demás pagan el resto a las 23:00.
- Un grupo deja 1.000 € a cuenta de su consumo al empezar la noche, sin indicar nada más.
- Una empresa paga 1.000 € por su cena del día 14: 40 comensales, menú cerrado.

*Cómo leemos sus respuestas, y propuesta de Waitron.* Un importe que no indica platos ni reserva no
es un anticipo, con el mismo criterio que su respuesta 1.8 aplica a las señales. No lleva tique
propio: Waitron lo anota en la cuenta, y el tique expedido al terminar la comida recoge todo lo
servido e indica el importe ya pagado. Así se tratan los 30 € de Ana y los 1.000 € del grupo. Los
1.000 € de la empresa indican fecha, comensales y menú, de modo que son un anticipo: llevan su propio
tique al cobrarse, y el tique final los descuenta como describe su respuesta 1.8 para una señal. Un
tique aparte solo para Ana es posible si paga platos concretos, como cuenta separada (su respuesta
1.9).

*Preguntamos:*

- (a) ¿Hemos leído bien sus respuestas 1.3 y 1.8? ¿O lo pagado a cuenta de la comida de esta mesa
  ya está «claramente identificado», por ser para esta comida y esta mesa, aunque no indique platos
  y la mesa aún pueda pedir más?
- (b) Si es un anticipo, ¿qué debe describir su tique cuando no indica platos: «pago a cuenta de la
  comida de la mesa 7», al 10 %? ¿O puede recoger como pagados a cuenta los platos pedidos hasta ese
  momento? ¿Y puede el tique final mostrar el total menos la base y la cuota del anticipo, como para
  una señal (su respuesta 1.8)?

Sí / No / Nota: ____________________________________________

**16. El cliente que no quiere el tique (su respuesta 1.11).**

*Situación.* Indica que el tique debe entregarse y que el cliente no puede renunciar a ello. El correo
electrónico exige el consentimiento del cliente, que puede ser tácito si se le informa de cómo lo
recibirá y de que puede pedirlo en papel (RD 1619/2012, art. 9).

*Lo que hará Waitron.* El empleado pregunta «¿en papel o por correo?». El tique impreso y dejado con
la cuenta se considera entregado, aunque el cliente lo deje en la mesa. Para el correo, la caja
muestra «Le enviaremos el tique a esta dirección. Puede pedir una copia en papel en cualquier
momento» y registra que se mostró, y el envío del correo se considera entrega. Waitron mantiene
además la opción «Ninguno», para el cliente que no quiere ni una cosa ni otra: la mayoría de los
clientes no quiere el tique, e imprimirlos todos malgasta papel.

*Preguntamos:* Si el cliente no quiere ninguna de las dos cosas y el empleado elige «Ninguno», ¿qué
riesgo asume el local?

Sí / No / Nota: ____________________________________________

**17. Una mesa invitada, o una comida de personal (su respuesta 1.10).**

*Situación.* A veces el restaurante no cobra nada a una mesa: el propietario invita a clientes
habituales o amigos, o el personal come a cargo de la casa. Indica que el tratamiento sin riesgo es
el autoconsumo valorado a coste, no al precio de carta (DGT V2347-24; LIVA art. 79.Cuatro), con
factura y registro. Tratar la invitación con fines empresariales como no sujeta es defendible, pero
contrario a la V2347-24, y cada local debe decidir con su asesor.

*Ejemplo.* El local invita a una mesa de cuatro clientes habituales. En carta la comida suma 160 €;
la materia prima cuesta 48 €. Como autoconsumo a coste: 48 € de base y 4,80 € de cuota, que paga el
local.

*Preguntamos, para el tratamiento como autoconsumo:*

- (a) ¿Qué es el coste de una comida de restaurante: solo la materia prima, o también una parte del
  personal y de los gastos generales? Sin escandallos, ¿puede usarse un porcentaje estándar sobre el
  precio de carta (por ejemplo, el 30 %)?
- (b) ¿Qué documento se expide, a quién (al propio local o a la mesa) y qué registro se remite a la
  AEAT?
- (c) La comida que se da gratis a un empleado durante su turno: ¿también autoconsumo a coste, o no
  sujeta?

Sí / No / Nota: ____________________________________________

**18. Señal retenida cuando el cliente no se presenta (sus respuestas 1.7 y 1.8).**

*Situación.* Indica que la señal de una reserva identificada es un pago anticipado con su propio
tique (su respuesta 1.8), y cita la V0839-20: lo que se retiene como indemnización si se cancela la
reserva no está sujeto. Pero, para minorar el IVA ya repercutido, el art. 89.Cinco.b LIVA exige
reintegrar la cuota al cliente.

*Ejemplo.* Una señal de 40 € por una reserva tiene su propio tique: 36,36 € de base y 3,64 € de
cuota al 10 %. Los clientes no se presentan y el local retiene los 40 € como indemnización.

*Preguntamos:* ¿Expide el local una rectificativa que anule los 3,64 €, aunque no devuelve nada, o se
mantiene el tique de la señal?

Sí / No / Nota: ____________________________________________

**19. Devolución de cortesía tras el tique (su respuesta 1.5).**

*Situación.* Un cliente se queja después de pagar y el encargado le devuelve parte del dinero; el
tique ya se expidió por el precio completo. Indica que una rebaja posterior al tique requiere, en su
caso, una rectificativa (LIVA art. 80.Uno.2.º; DGT V1493-26).

*Ejemplo.* Un cliente se queja después de pagar 62 € y el encargado le devuelve 10 €. Sin
rectificativa, el local sigue declarando el IVA sobre los 62 €.

*Preguntamos:* ¿Es obligatoria la rectificativa, o puede el local devolver el dinero sin ella y
seguir declarando el IVA sobre los 62 €?

Sí / No / Nota: ____________________________________________

**20. Copias reconstruidas con los registros de la AEAT tras una restauración (su respuesta
1.16).**

*Situación.* Si el servidor del local se restaura desde una copia antigua, le faltan las facturas
expedidas después de esa copia, aunque sus registros llegaron a la AEAT. Indica que el local debe
recuperar esos registros mediante el servicio de consulta de la AEAT para reconstruir las copias de
las facturas, que debe conservar (RD 1619/2012, art. 19).

*Lo que devuelve la AEAT.* Según sus documentos técnicos, la respuesta incluye de cada registro el
número, la fecha, la descripción, el destinatario si lo hay, el desglose de IVA y los importes
totales, pero no los platos.

*Preguntamos:* ¿Es aceptable una copia reconstruida así, o debe el local conservar la factura
completa por otra vía, como su copia de seguridad continua?

Sí / No / Nota: ____________________________________________

**21. Tipos de IVA por producto, y un tipo erróneo descubierto después (a partir de sus respuestas
1.4 y 1.13).**

*Situación.* Hoy cada producto tiene una clase de IVA (general, reducido, superreducido o cero), que
se copia en la carta publicada y en cada línea del pedido; el porcentaje de la clase se busca el día
de la factura. Si la clase de un producto cambia mientras una mesa aún está comiendo, la comida
conserva la anterior.

*Propuesta de Waitron.*

- Cada producto guarda un historial con fechas de dos tipos, uno para consumir en el local y otro
  para llevar (LIVA art. 91.Uno.2.2.º y 91.Dos), elegidos de una lista que mantiene Waitron con los
  tipos que admite la AEAT (0, 2, 4, 5, 7,5, 10 y 21). Un cambio puede programarse con antelación,
  por ejemplo desde el 1 de abril, y aplicarse a muchos productos a la vez.
- La factura aplica los tipos de cada producto del día en que termina la comida (su respuesta 1.4;
  LIVA art. 90.Dos: «El tipo impositivo aplicable a cada operación será el vigente en el momento del
  devengo»). Una cena empezada el 31 de marzo que termina pasada la medianoche lleva los tipos del 1
  de abril. Una señal conserva el tipo del día en que se pagó.
- Un tipo erróneo descubierto después se registra en el producto como corrección («debió ser el
  21 % desde el 1 de febrero»), sin reescribir lo cobrado. Los tiques de los clientes no cambian y no
  se remite nada a la AEAT. Para cada trimestre anterior, Waitron calcula el IVA debido considerando
  que el precio cobrado incluía el tipo correcto, como indica su respuesta 1.13, y lo incluye en el
  informe de correcciones de la pregunta 7 para que el gestor lo presente.

*Ejemplo.* 200 botellas de vino para llevar a 8,00 €, vendidas en el primer trimestre al 10 % en
lugar del 21 %: 1.600 € × 21/121 − 1.600 € × 10/110 = 277,69 € − 145,45 € = 132,24 € a ingresar por
el primer trimestre, mediante autoliquidación complementaria.

*Preguntamos:*

- (a) ¿Es correcta la propuesta?
- (b) ¿La diferencia se calcula por línea de factura, por factura o sobre el total del trimestre
  para el producto? El redondeo da importes algo distintos.
- (c) Un tipo demasiado alto, por ejemplo el 21 % cobrado cuando correspondía el 10 %: el local
  ingresó IVA de más. Si regulariza en la autoliquidación en curso, el art. 89.Cinco.b LIVA dispone
  que «estará obligado a reintegrar al destinatario de la operación el importe de las cuotas
  repercutidas en exceso», lo que no puede hacer con un tique sin destinatario identificado. ¿Debe
  entonces solicitar la rectificación de la autoliquidación anterior (art. 120.3 LGT), o dejar el IVA
  como se declaró?

Sí / No / Nota: ____________________________________________

### Lo que aún falta

**22. Dos preguntas de octubre aún pendientes.** La S18, cambio de denominación social con el mismo
NIF, y la S19, retener los registros posteriores de una cadena mientras se desconoce la respuesta a
uno anterior.

*Preguntamos:* ¿Cuándo podemos esperar su respuesta?

Nota: ____________________________________________

**23. Otros asesores que necesitamos.** Algunas de nuestras preguntas quedan fuera del ámbito
fiscal:

- **Metrología legal (S17, venta a peso).** Una balanza verificada pesa el producto y envía al TPV el
  peso, el precio por kilo y el importe, o el empleado teclea el peso en el TPV. ¿Cumple la
  normativa, necesita nuestro software una certificación, y quién firma la declaración de
  conformidad?
- **Laboral y nóminas:** cotización de las propinas de tarjeta abonadas en nómina (L1); horas
  extraordinarias con una jornada anual (L2); el registro de jornada de una persona al sustituir el
  servidor (L3); las propinas en la nómina (L4); quién retiene sobre una propina (L5); el reparto de
  propinas sin acuerdo (L6); qué entrega Waitron a la gestoría (L7); cuánto tiempo se conservan
  ausencias y cuadrantes (L8).
- **Protección de datos:** conservar las anotaciones de alergias después de la comida como prueba
  (P1); la base jurídica para tratarlas durante la comida (P2); qué suprimir antes (P3); datos
  suprimidos que quedan en las copias de seguridad (P4); qué evaluación necesita un solo restaurante
  (P5); los datos de un antiguo empleado (P6); los datos que la ley obliga a conservar (P7); el papel
  de Waitron en los informes de errores (P8); el registro de lo que hace el personal en la caja (P9);
  la recogida de los datos del cliente para una factura (P10).

*Preguntamos:* ¿A quién nos recomienda para cada ámbito? ¿Puede responder usted alguna de ellas?

Nota: ____________________________________________

### Añadida el 17 de noviembre

**24. Imprimir un duplicado a petición del cliente, y lo que muestra (a partir de su respuesta 2.1).**

*Situación.* Solo puede expedirse un original de cada factura, y la expedición de duplicados
«únicamente será admisible» en dos casos: varios destinatarios de una misma operación o la «pérdida
del original» (RD 1619/2012, art. 14.1 y 14.2). Según su respuesta 2.1, toda impresión posterior a la
entrega del original lleva «duplicado». Hoy el personal puede reimprimir un tique desde la lista de
tiques anteriores en cualquier momento; Waitron lo marca «DUPLICADO» y registra quién lo imprimió y
cuándo, pero no pide el motivo.

A partir de su respuesta 1.3, el tique se expedirá al terminar la comida, esté pagado o no. Waitron
imprimirá en cada tique los pagos que consten en el momento de imprimirlo: cada pago, con la marca y
las cuatro últimas cifras de la tarjeta, y el importe pendiente, si lo hay. Un pago posterior a la
impresión del original dará lugar a un justificante de pago sin número de factura, sin código QR y
sin importe pendiente. Su respuesta 2.2 confirmó que un justificante así, impreso junto al tique, no
es una factura; este puede imprimirse horas o días después del tique.

*Ejemplo.* El tique de 60,00 € de una mesa se expide a las 22:00 y se imprime con «Pendiente: 60,00
€». A la mañana siguiente el cliente paga 60,00 € con tarjeta, recibe el justificante de pago y pide
un tique en el que conste el pago. El personal lo reimprime: lleva «DUPLICADO», el mismo número, las
mismas líneas, los mismos importes y el mismo código QR, y además «Visa ****4034 60,00 €», sin
importe pendiente.

*Preguntamos:*

- (a) ¿Puede imprimirse un duplicado siempre que el cliente lo pida, aunque no haya perdido el
  original? Si solo cabe en caso de pérdida, ¿debe el personal registrar ese motivo?
- (b) ¿Puede un duplicado mostrar los pagos hechos después de imprimir el original, si solo difiere
  del original en esas líneas de pago?
- (c) Un justificante de pago impreso horas o días después del tique, ¿sigue sin ser una factura?
  ¿Puede indicar el número del tique que paga, para que el cliente pueda relacionarlos?

Sí / No / Nota: ____________________________________________

**25. Dos comensales quieren su propio tique cuando ya se expidió el de la mesa (a partir de su
respuesta 1.7).**

*Situación.* A partir de su respuesta 1.3, el tique de una mesa se expedirá cuando el personal imprima
la cuenta, esté pagado o no (decisión D1 del titular). Expedido el tique de una mesa, dos comensales
quieren cada uno su propio tique. Proponemos una factura rectificativa (R5) del primer tique y un
tique nuevo para cada comensal, nunca un registro de anulación, porque la venta se produjo (su
respuesta 1.7).

*Preguntamos:* ¿Es correcto?

Sí / No / Nota: ____________________________________________

**26. Qué deben detallar el tique y la factura completa de un menú (a partir de su respuesta 1.10).**

*Situación.* Waitron va a incorporar menús consumidos en el local. El menú tiene un precio único; los
platos que incluye se envían a cocina y se registran a 0,00 €. Un plato puede llevar un suplemento, y
un plato incluido puede tener un extra de pago. El registro que se remite a la AEAT solo contiene
totales por tipo de IVA, de modo que no cambia sean cuales sean las líneas impresas.

*Qué propone Waitron.*

- El tique y la factura completa detallan cada menú con su precio, y todos los suplementos y extras
  de pago. Un plato incluido sin nada que pagar no se detalla. La factura simplificada exige «La
  identificación del tipo de bienes entregados o de servicios prestados» (RD 1619/2012, art. 7.1.e).
  La factura completa exige «Descripción de las operaciones, consignándose todos los datos necesarios
  para la determinación de la base imponible» (art. 6.1.f), y la DGT pide «una descripción genérica
  de los bienes o servicios que constituyan el objeto de cada operación» con detalle suficiente para
  determinar «su naturaleza, cuantía y tipo impositivo aplicable» (V0858-11). No hemos encontrado
  ninguna consulta sobre menús.
- Un menú consumido en el local es un único servicio de restauración a un solo tipo, bebidas
  incluidas: «el suministro de comidas y bebidas para consumir en el acto» (LIVA 91.Uno.2.2.º). Por
  eso, mientras esté incluido, cada producto toma el tipo del menú.

*Ejemplo.* Un menú de 14,00 € al 10 % incluye sopa, solomillo y una copa de vino. El solomillo lleva
un suplemento de 5,00 € y la sopa una ración de pan de 1,50 €. El tique muestra el menú 14,00, Solomillo
+5,00, y Sopa con Pan 1,50 debajo: 20,50 € en total. El vino no se detalla.

*Preguntamos:*

- (a) ¿Pueden omitirse los platos incluidos en la factura simplificada?
- (b) ¿Pueden omitirse en la factura completa? Si no, ¿basta con detallarlos bajo el menú sin precio?
- (c) Su respuesta 1.10 reparte el precio con un artículo gratuito de otro tipo (LIVA 79.Dos). ¿Se
  aplica dentro de un menú consumido en el local, o es correcta la propuesta anterior? Y si el menú
  permite elegir algo que el local vende realmente a otro tipo, por ejemplo una botella cerrada para
  llevar al 21 %, ¿debe repartirse entonces el precio del menú entre ambos tipos?

Sí / No / Nota: ____________________________________________

### Anexo: ejemplo de declaración responsable

Generado el 16 de noviembre de 2026 por el propio código que produce la declaración
(`packages/fiscal-verifactu/src/declaration/`), a partir de la plantilla del repositorio
(`packages/fiscal-verifactu/declarations/template.md`) y de su lista de funcionalidades. Respecto a la
plantilla, el apartado d) lleva los dos añadidos de la pregunta 5, y omite «o un servidor en la nube»
y la frase sobre el servidor de reserva, porque una primera versión funciona solo en un equipo del
propio local. La versión (1.0.0) y la fecha son de ejemplo; los datos entre corchetes los rellena el
productor al firmar.

> DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN
>
> 1.a) Nombre del sistema informático a que se refiere esta declaración responsable: Waitron
>
> 1.b) Código identificador del sistema informático a que se refiere el apartado a) de esta declaración responsable: W1
>
> 1.c) Identificador completo de la versión concreta del sistema informático a que se refiere esta declaración responsable: 1.0.0
>
> 1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema informático y de sus principales funcionalidades:
>
> Waitron es un software de punto de venta para restaurantes y bares. Se ejecuta en un servidor —un equipo del propio establecimiento— con Linux y Docker, y los terminales del establecimiento (cajas, comanderos, pantallas de cocina y el panel de gestión) se conectan a él por la red mediante un navegador.
>
> Hardware: Waitron no incluye hardware propio; funciona en cualquier ordenador que cumpla lo anterior.
>
> Software: el servidor Waitron, que genera, encadena, conserva y remite los registros de facturación; la biblioteca @waitron/verifactu (versión 0.2.1), que construye cada registro, su huella y el contenido del código QR, y lo remite, y que cuenta con su propia declaración responsable; las aplicaciones de los terminales, que solicitan al servidor las facturas y las muestran, y no generan registros de facturación; el agente de impresión, que envía a las impresoras del establecimiento los documentos que prepara el servidor y no genera registros de facturación; y los componentes de terceros de los que nos hacemos responsables: Node.js, SQLite, Litestream, Linux y Docker (la lista completa se muestra en el propio sistema).
>
> Cada instalación lleva la facturación de un único obligado tributario y aplica una única modalidad de cumplimiento, determinada por el paquete de país instalado; esta versión solo funciona como VERI\*FACTU.
>
> Principales funcionalidades: toma de pedidos por mesa o en barra, cobro en efectivo y con tarjeta, expedición de facturas simplificadas, facturas rectificativas, consulta de las facturas emitidas e informes de ventas.
>
> 1.e) Indicación de si el sistema informático a que se refiere esta declaración responsable se ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda funcionar exclusivamente como «VERI\*FACTU»: S - Sí
>
> 1.f) Indicación de si el sistema informático a que se refiere la declaración responsable permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la facturación de varios obligados tributarios: N - No
>
> 1.g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso de que el sistema informático a que se refiere esta declaración responsable no sea utilizado como «VERI\*FACTU». Dado que se trata de un producto de facturación que solo puede ser utilizado exclusivamente en la modalidad de «VERI\*FACTU», no se realiza una firma electrónica expresa de los registros de facturación generados, ya que la normativa considera que quedan firmados al ser remitidos correctamente a los servicios electrónicos de la Agencia Tributaria con la debida autenticación mediante el adecuado certificado electrónico cualificado.
>
> 1.h) Nombre y apellidos de la persona productora del sistema informático a que se refiere esta declaración responsable: [nombre y apellidos del productor]
>
> 1.i) Número de identificación fiscal (NIF) español de la persona productora del sistema informático a que se refiere esta declaración responsable: [NIF del productor]
>
> 1.j) Dirección postal completa de contacto de la persona productora del sistema informático a que se refiere esta declaración responsable: [dirección postal del productor]
>
> 1.k) La persona productora del sistema informático a que se refiere esta declaración responsable hace constar que dicho sistema informático, en la versión indicada en ella, cumple con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General Tributaria, en el Reglamento que establece los requisitos que deben adoptar los sistemas y programas informáticos o electrónicos que soporten los procesos de facturación de empresarios y profesionales, y la estandarización de formatos de los registros de facturación, aprobado por el Real Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024, de 17 de octubre, y en la sede electrónica de la Agencia Estatal de Administración Tributaria para todo aquello que complete las especificaciones de dicha orden.
>
> 1.l)
>
> - Fecha en que la persona productora de este sistema informático suscribe esta declaración responsable del mismo: 1 de diciembre de 2026.
> - Lugar en que la persona productora de este sistema informático suscribe esta declaración responsable del mismo: [lugar de firma] – España.
>
> ANEXO
>
> 2.a) Otras formas de contacto con la persona productora del sistema informático a que se refiere esta declaración responsable: Correo electrónico: info@waitron.io
>
> 2.b) Direcciones de internet de la persona productora del sistema informático a que se refiere esta declaración responsable:
>
> - Histórico de declaraciones responsables de las versiones de este producto: https://github.com/clintongormley/waitron/releases

## Dropped since 6 November

| Item | Why it is not asked | Receipt |
| --- | --- | --- |
| T2, keeping a date that nothing shows to be wrong | Owner, 16 November: the explanation of how the clock is confirmed is not needed; question 2 asks about errors in the time alone | the owner's review of this sheet, 16 November |
| May a ticket wait until the bill is paid? | Answered: the adviser's answer 1.3 says issuing "cannot be made conditional on the bill being paid in full" | [2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md), Part B1 |
| Is the email step informed consent? | Answered: the adviser's answer 1.11 accepts tacit consent once the customer is told how the ticket will arrive and that paper is available, which the till's sentence does | [2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md), Part B2 |
| Is a ticket left with the bill, or a sent email, delivered? | Owner, 16 November: yes to both; question 16 states it | the owner's review of this sheet, 16 November |
| The adviser's answer 1.15: who is the third party for copies held outside Spain | Owner, 16 November: Waitron Cloud will keep its copies in EU data centres, so the question does not arise for it | the owner's review of this sheet, 16 November |
| The labour and privacy questions in full | Not for the tax adviser; question 23 lists them and asks whom to ask | [2026-11-06-adviser-questions.md](2026-11-06-adviser-questions.md) |
| T13, the long-term archive | Owner, 15 November: "Agree, no archive now" (A1531) | `~/waitron-campaign-l/questions.md:1783-1785`; [backlog.md:2235](../backlog.md) |
| T16, a change of producer | Owner, 11 November, "Later": A993 is built only once a change is scheduled. Its venue-move half is now in question 6 | commit `e59fac8c94`; [backlog.md:246-249](../backlog.md) |
| S14's second half: may R5 and R1 to R4 share one series? | Owner, 15 November: they will not share; the adviser agreed the same day (answer 1.14). Question 4 asks the narrower point | `~/waitron-campaign-shared/desk/done/20261115-1018-L-r5-series-date-rulings.md` |
| S4's last part: may the issue date stand as the date VAT falls due? | Owner, 12 and 15 November: one date when invoiced at the meal's end, the sale day when invoiced later. The adviser agreed on 15 November (answer 1.4); question 3 asks when the meal ends, and question 7 where an invoice issued after its meal's VAT period counts | [backlog/fiscal.md:1103-1116](../backlog/fiscal.md); `desk/done/20261115-0530-L-later-sale-date-rule.md`, `20261115-1113-L-later-sale-q1-open-bill.md`, `20261115-1113-L-later-sale-q2-vat-period.md` |
| The 6 November background on AEAT's time (decision 2b and "How a wrong clock is known") | Owner, 10 to 13 November: Waitron reads AEAT's time only to warn of drift, and a refusal for a future date no longer stops a box whose internet time is synchronised | [CLAUDE.md:958-967 and 995](../../CLAUDE.md) |

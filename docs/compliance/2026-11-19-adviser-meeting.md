# Adviser meeting, Thursday 19 November 2026

Written 15 November 2026 for the owner, and rewritten the same day so that each question can be
read on its own. Updated 16 November: questions 3 and 7 now carry the owner's decisions on when a
ticket is issued and on changes to a quarter already filed, and the Spanish question 12 now matches
the English. Nothing here has been sent.

**How to use it.** Part 1 is in English, for you. Part 2 asks the same questions in Spanish, for the
tax adviser, and can be printed on its own. Each question explains the situation, says what Waitron
does or proposes and why, and ends with what we ask, so it can be read without the others. Questions
1 and 2 need the adviser's judgement. Questions 3 to 14 are confirmations, ordered by what is filed
or signed from the first day of trading. Questions 15 to 22 follow up the adviser's answers of 15 November.

**What the adviser already has.** S1 to S19 and R1 to R6, the
[shortened list](asesor-questions.md#the-shortened-list-2026-10-09), went to the adviser around 15 October
(the owner's estimate). **The adviser answered S1 to S16 and R1 to R6 on 15 November**, in a draft whose
numbers 1.1 to 1.16 and 2.1 to 2.6 are ours. What the adviser's answers change is in
[2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md). Questions 3 and 4 were rewritten
that day as follow-ups to the adviser's answers, and questions 15 to 22 were added; question 22 chases S17 to
S19, which the adviser has not answered.

**Where the questions come from.** The [6 November list](2026-11-06-adviser-questions.md), whose
T numbers are given in brackets in Part 1, cut to what is still open on 15 November, plus the
questions the owner's decisions of 14 and 15 November call for, plus the follow-ups to the adviser's answers.
What was dropped, and why, is at the end. The reasoning and the full sources are in the 6 November
list, the research files it links, and the answers document above.

**How the Spanish quotations were checked.** Each quotation of a law, ruling or FAQ was matched word
for word, by a script, against text downloaded on 15 November 2026: the BOE's consolidated texts of
Ley 37/1992 (the VAT law, LIVA), RD 1619/2012 (the invoicing regulation) and Orden HAC/1177/2024;
DGT rulings V2884-16, V1665-22, V0902-22, V1924-23 and V2611-24 from the DGT's PETETE database; and
AEAT's developer FAQ v1.3, the PDF kept in [sources/](sources/). As a control, the date rulings'
phrase «deberá constar en serie específica de factura» was confirmed absent from V2884-16. The
downloads are not committed; fetch them again from those sites to re-check. The annex is copied
from the repository's declaration template, not from a law. The rewrite of 15 November kept those
quotations unchanged where they remain. One was added on
16 November and was not checked by the script: question 7's quotation of AEAT's web service
description v1.0.3 (§6.4, p. 30). Every other word in « » is ours, and "where applicable" in
question 19 is the adviser's own English.

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

**2. Keeping a date that nothing shows to be wrong (T2).**

*The situation.* Waitron runs on a server, a computer in the restaurant or in Waitron Cloud, and
that server's clock dates every invoice. After every start, the server records no sale until its
time has been confirmed: by internet time, by two of the venue's devices agreeing with it, or by a
person. That confirmation could itself be wrong, for example a person confirming a time an hour
off. For a cash sale nothing outside the server records the real time; a card payment at least
carries the card provider's own time.

*What Waitron proposes.* When nothing shows that the date stamped on an invoice is wrong, the
restaurant keeps it.

*We ask:* Is that right, and does the restaurant need anything more to rely on it?

Yes / No / Note: ____________________________________________

### Confirmations: what is filed or signed from the first day

**3. When the meal ends, a ticket issued before payment, and an invoice issued late (follows
answers 1.1, 1.3 and 1.4).**

*The situation.* A ticket (a simplified invoice) must be issued when the transaction is carried out
(RD 1619/2012 art. 11.1), and VAT on a meal falls due when the service is supplied (LIVA
75.Uno.2.º). In answers of 15 November the adviser said that a meal is one service, supplied when it
ends; that a ticket issued at the end of the meal, in the same visit, carries one date; that an
invoice issued on a later day must also show the date of the meal; and that the ticket is due when
the meal ends, not held back until the bill is fully paid.

*What Waitron proposes.* The ticket is issued when the meal ends, even if the bill is paid much
later: at the last payment, or when staff record that the table has left with part unpaid. It
carries the date of that moment.

*We ask:*

- (a) Does the meal end when the last dish is served, or when the guests finish and leave?
  Example: the last dish is served at 23:40 on the 1st; the guests have coffee, then pay and leave
  at 00:30 on the 2nd. Waitron decides by the venue's trading day, which ends at the start-of-day
  time the venue sets. With 05:00, the meal belongs to the evening's service: the ticket is dated
  the 2nd, with no separate date of the meal. With midnight, the ticket is dated the 2nd and shows
  the 1st as the date of the meal. Is dating by the venue's trading day acceptable, or is the date
  of the meal always the day the guests leave?
- (b) A regular eats on Monday and, by arrangement, pays on Thursday. Waitron issues the ticket on
  Monday, when the meal ends, still unpaid, and records Thursday's payment against it. Is that
  right? Answer 1.4 mentions invoices issued after payment by bank transfer; answer 1.3 says
  issuing cannot wait for full payment.
- (c) An invoice issued after its meal's VAT period has ended. With tickets issued when the meal
  ends this should be rare, for example a bill left open by mistake. Example: the bill for a meal
  on 28 March is left open by mistake and invoiced on 25 April, after the first quarter's return
  was filed on 20 April. The VAT fell due when the meal ended (LIVA 75.Uno.2.º; answer 1.4), so it
  belongs to the first quarter. Waitron proposes to leave the first quarter's report as filed and
  show the meal's VAT on a separate "correction for the first quarter" line, which the accountant
  files as a complementary return (LGT art. 122): way 3 of question 7. Is that right? And should
  the accountant's export list it by the date of the meal or by the date of issue?

Yes / No / Note: ____________________________________________

**4. A series for correctives of a wrong date (follows answer 1.14).**

*The situation.* Corrective invoices (facturas rectificativas) are numbered in series of their own.
The adviser confirmed on 15 November that correctives of tickets (AEAT's type R5) and correctives of full
invoices (R1 to R4) need separate series. A ticket can also carry the wrong date, for example when
the server's clock was a day ahead; it is put right with a corrective that states the real date and
changes no amount.

*What Waitron does.* Every ticket corrective, including one for a wrong date, goes in one series
that holds only ticket correctives. Ruling V2884-16 would even allow ticket correctives in the
ticket series. But rulings V1665-22, V0902-22, V1924-23 and V2611-24 say a corrective of a wrong
issue date must be in a series of its own.

*We ask:* Is one series of ticket correctives enough, or must correctives for a wrong date have a
series apart from the other ticket correctives?

Yes / No / Note: ____________________________________________

**5. The software declaration: what the system consists of (T14).**

*The situation.* The maker of invoicing software must sign, for each version, a declaration that it
complies with the rules (the declaración responsable, Orden HAC/1177/2024 art. 15). Its item d)
lists the system's hardware and software components and says briefly what the system does. None has
been signed yet. The current draft of item d) is copied in the annex at the end of Part 2.

*What Waitron proposes.* The draft names the third-party components (Node.js, SQLite, Litestream,
Linux and Docker) as part of the system, says the producer answers for them, and names the version
of the Veri\*Factu library used and what it does. We think it is enough with two additions: what the
print agent does (the program that sends documents to the venue's printers), and that the
terminals (tills, order-taking devices, kitchen screens) ask the server for invoices and display
them (the draft already says they produce no invoice records). The sentence about a standby server would appear
only in a version that can actually switch to one.

*We ask:* With those two additions, is item d) sufficient?

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

*We ask:* Are those answers right?

Yes / No / Note: ____________________________________________

### Confirmations: when the clock was wrong

**7. A wrong date on an invoice, and the VAT period of a correction (T7).**

*The situation.* The server dates every invoice from its own clock, which internet time keeps
right. If the clock was wrong, an invoice can carry the wrong day. Example: after a power cut the
clock runs a day ahead, and a ticket for a sale on 3 March is dated 4 March. AEAT refuses a record
dated in the future, which is one way such an error comes to light.

*What Waitron does.* It puts the error right with a corrective invoice, dated the day it is issued,
stating the real date of the sale and changing no amount (DGT V1665-22; V0305-24). The corrective is
numbered in a series that holds only ticket correctives. One corrective may cover several invoices
(RD 1619/2012 art. 15.4). This is built for a ticket that AEAT refused as dated in the future; the
version for full invoices is built but switched off.

*The VAT period: three ways.* Example: the ticket for a meal on 28 March is dated 2 April because
the clock was wrong; the first quarter's return is filed on 20 April; the error comes to light, and
the corrective is issued, in May.

1. Count the change in the period the corrective is issued, and never change a report already
   filed. In the example, the ticket's VAT stays in the second quarter,
   where its wrong date put it, and the first quarter stays as filed.
2. Count it in the period of the sale by changing that period's report: the VAT moves to the first
   quarter, which a complementary return corrects (LGT art. 122). This is what Waitron does today
   (LIVA 75.Uno.2.º).
3. Never change a filed report, and show the difference as a separate line, "correction for the
   first quarter", for the accountant to file as a complementary return (LGT art. 122).

AEAT lists filed records by the period of their operation date, or of their issue date when they
have none (service description v1.0.3, §6.4, p. 30). So under way 1, Waitron's figures for a
quarter can differ from what AEAT's records show for it, which is one reason not to propose it.

*What Waitron proposes.* A report already filed never changes. A change that lowers a quarter's VAT
counts in the current quarter, as answer 1.12 allows for a cancellation. A change that adds VAT to
a filed quarter is shown on a separate corrections line, as in way 3, for the accountant to file as
a complementary return, in line with answer 1.13 for a wrong VAT rate. In the example: the first
quarter stays as filed, the second-quarter report (not yet filed in May) no longer counts the
ticket, and a "correction for the first quarter" line shows its VAT.

*We ask:* Is a corrective the right way to correct a wrong date? Is the proposal right for its VAT:
reductions in the current quarter, additions on a separate corrections line? Is that what LIVA
art. 89.Cinco asks for?

Yes / No / Note: ____________________________________________

**8. Who receives the corrective (T1).**

*The situation.* A corrective invoice is normally sent to the customer of the invoice it corrects.
But most ticket customers are unknown: a ticket doesn't name its customer. Example: a ticket must be
corrected because the server's clock gave it the wrong date, and nobody knows who paid it.

*What Waitron does.* The restaurant issues the corrective, keeps it and sends its record to AEAT.
The corrective reaches the customer only when the restaurant knows who they are. Tickets are never
cancelled and issued again instead. We found no source covering this case.

*We ask:* Is that acceptable?

Yes / No / Note: ____________________________________________

**9. A record timed earlier than the one before (T5).**

*The situation.* Each record sent to AEAT carries the exact date and time it was made (Orden
HAC/1177/2024 art. 7.e). If the server's clock ran fast and is then set right, the next record
carries an earlier time than the last one. Example: invoices 2, 3 and 4 are stamped by a clock an
hour fast; once it is set right, invoice 5 carries an earlier time than invoice 4.

*What Waitron does.* It allows this and marks nothing. The one rule against it, art. 7.i of the
same Orden, does not apply to Veri\*Factu systems (art. 3). Invoices 2 to 4 are corrected only if
the wrong hour moved one of them onto another day; they are then corrected as a wrong date (a
corrective stating the real date).

*We ask:* Is that right?

Yes / No / Note: ____________________________________________

**10. Only the hour is wrong (T6).**

*The situation.* The server's clock was wrong by less than the time to midnight, so only the hour on
the ticket is wrong. Example: a ticket stamped 21:10 for a sale at 20:50 the same day.

*What Waitron does.* No corrective; the restaurant keeps a note of the incident. An invoice shows its
date, not its time (RD 1619/2012 arts. 6.1.b and 7.1.b), and AEAT's developer FAQ says the time of
issue is not part of the record. One passage points the other way: the developer FAQ, §17 case 2.b,
says an error in an internal field of a record needs a correcting record.

*We ask:* Is no corrective right?

Yes / No / Note: ____________________________________________

**11. Telling AEAT about a clock incident (T8).**

*The situation.* The server's clock was found to be wrong and the affected invoices were corrected,
or left as they were because only the hour was wrong.

*What Waitron proposes.* Nothing is reported to AEAT. A text search of the invoicing systems
regulation (RD 1007/2023), the Orden, both AEAT FAQs and AEAT's technical documents found no duty or
channel to report one, and any corrective's record reaches AEAT anyway. Orden art. 16.4 covers
incidents that stop records being sent, which is a different case.

*We ask:* Is that right?

Yes / No / Note: ____________________________________________

### Confirmations: keeping records and giving access

**12. "Online access" without the internet (T4).**

*The situation.* Invoices kept electronically must be accessible to the tax authorities online (RD
1619/2012 arts. 21.2 and 23). A venue's Waitron server usually sits in the restaurant, on a private
network with no public address.

*What Waitron proposes.* That meets the rule if, when the tax office asks, the venue can without
unjustified delay let it see, search, copy or download, and print every invoice. No permanent
connection or public address is needed (Orden EHA/962/2007 art. 5.3; DGT 0289-04). If AEAT asks
from its own office, a copy of the period on a USB drive or through a temporary download link is
enough.

*How a copy looks.* On the inspector's Invoices page, a full invoice downloads as its A4 PDF and a
ticket (simplified invoice) as a ticket-width PDF laid out like the printed till ticket, each
stamped "DUPLICADO". A cancelled ticket, or one later replaced by a full invoice, downloads exactly
as it was issued. The list marks a cancelled ticket "Cancelled", and shows a full invoice that
replaces tickets as "Replaces <ticket numbers>"; the replaced ticket's own row does not say which
invoice replaced it. The planned export takes the list's columns.

*We ask:* Is that right? And should the copy itself also say "Cancelled on <date>" or "Replaced by
invoice <number>"?

Yes / No / Note: ____________________________________________

**13. What a restaurant company keeps (T11).**

*The situation.* Waitron is designing how long it keeps each kind of record, and wants one list of
what a restaurant company must keep for tax and commercial law.

*What Waitron proposes.* Invoices issued, tickets included, and invoices received (RD 1619/2012 art.
19.1); books, correspondence and business papers (Código de Comercio art. 30.1); other evidence for
its taxes (LGT art. 29.2.e); records of payments and refunds; the software declaration of every
version used; proof of payment of sales of €1,000 or more, kept five years (Ley 7/2012 art.
7.Uno.4); and pro formas that never became invoices. All on one six-year schedule.

*We ask:* Is anything missing?

Yes / No / Note: ____________________________________________

**14. Records AEAT does not hold (T12).**

*The situation.* Normally every record reaches AEAT, which then holds it. Some never do: a record
still waiting to be sent, or one AEAT refused. In the developer FAQ's words, such a record would
never be in AEAT's systems, so the restaurant's copy is the only one.

*What Waitron proposes.* Keep such a record, with AEAT's reply, until it is settled, then on the
common six-year schedule for a restaurant's records. No source sets a period.

*We ask:* Is that right?

Yes / No / Note: ____________________________________________

### Follow-ups on the adviser's answers of 15 November

**15. A payment on account during the meal (answer 1.3).**

*The situation.* At a table, one guest sometimes pays part of the bill before the meal is over and
leaves. The adviser answered that money paid before the table has been fully served is an advance payment:
VAT is due on it at once, so it needs its own ticket (LIVA 75.Dos; RD 1619/2012 art. 2.1), provided
what it pays for is clearly identified (European Court of Justice, C‑419/02, BUPA).

*Example.* A table of four has €120 on its bill and has not ordered desserts. At 21:30 Ana pays
€30 "towards the bill" and leaves; the others pay the rest at 23:00.

*What Waitron would do, if Ana's €30 is an advance.* Issue Ana a ticket for €30 at 21:30, and show
on the final ticket the whole bill less Ana's advance, the way a deposit is deducted.

*We ask:*

- (a) Are Ana's €30 an advance payment, when they are an amount rather than particular dishes and
  the table may still order more?
- (b) If so, may her ticket list the dishes ordered so far as paid on account, and the final ticket
  show the total less the advance's amount before VAT and its VAT, as the adviser described for a deposit
  (answer 1.8)?

Yes / No / Note: ____________________________________________

**16. Delivering the ticket in practice (answer 1.11).**

*The situation.* The adviser answered that the ticket must be delivered and the customer cannot waive it.
Printing it only on request, or never, breaches the rule; showing it on a screen is not delivery;
email or a download link needs the customer's informed consent (RD 1619/2012 art. 9), given after
being told how the ticket will arrive and that paper is available.

*What Waitron will do.* Print every ticket at payment unless the customer chooses email. For email,
staff ask "paper or email?", and the till shows "We'll email your ticket to this address. You can
ask for a paper copy at any time." and records that it was shown.

*We ask:*

- (a) Is a ticket printed and left with the bill delivered, even if the customer leaves it on the
  table or says they don't want it?
- (b) Is the email step above informed consent, and is sending the email enough to show delivery,
  or must the customer open or download it?

Yes / No / Note: ____________________________________________

**17. A whole table, or a staff meal, given free (answer 1.10).**

*The situation.* Sometimes a restaurant charges a table nothing: the owner invites regulars or
friends, or staff eat a meal on the house. The adviser answered that the risk-free treatment is a
self-supply (autoconsumo) valued at cost, not at the menu price (DGT V2347-24; LIVA 79.Cuatro), with
an invoice and a record. The alternative, treating a business invitation as outside VAT, is
defensible but goes against V2347-24. Each venue chooses with its own adviser.

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

*The situation.* The adviser answered that a deposit for an identified booking is an advance payment with
its own ticket (answer 1.8), and cited DGT V0839-20: money kept as compensation when a booking is
cancelled is outside VAT. To reduce the VAT already declared, though, LIVA 89.Cinco.b asks for the
VAT to be refunded to the customer.

*Example.* A €40 deposit for a booking gets its own ticket: €36.36 before VAT and €3.64 VAT at 10%.
The guests don't come, and the venue keeps the €40 as compensation.

*We ask:* Does the venue issue a corrective removing the €3.64, though it refunds nothing, or does
the deposit's ticket stand?

Yes / No / Note: ____________________________________________

**19. Money given back as goodwill after the ticket (answer 1.5).**

*The situation.* A guest complains after paying, and the manager gives some money back. The ticket
was already issued for the full price. The adviser answered that a price reduction after the ticket "will,
where applicable, require" a corrective invoice (LIVA 80.Uno.2.º; DGT V1493-26).

*Example.* A guest complains after paying €62 and the manager gives €10 back. Without a corrective,
the venue goes on declaring VAT on €62.

*We ask:* Is the corrective required, or may the venue give the money back without one and go on
declaring VAT on the full €62?

Yes / No / Note: ____________________________________________

**20. Who is the third party for copies held outside Spain (answer 1.15).**

*The situation.* Waitron keeps a continuous copy of the venue's data away from the restaurant, as a
backup. The adviser answered that a copy abroad, while the original stays on the server in Spain, is not in
itself keeping invoices outside Spain; that whoever holds the copy for the venue is a third party
(RD 1619/2012 art. 19.3); and that a third party established outside the EU must be notified to
AEAT beforehand through procedure GZ05 (art. 19.4).

*The two set-ups.* Waitron Cloud plans to keep the copies with Amazon Web Services, a company with
an American parent, in data centres in Spain and France. Alternatively, a venue may send its copy to
a storage provider of its own choosing.

*We ask:*

- (a) Is the third party the company the venue contracts with (Waitron), the storage provider, or
  both?
- (b) Does art. 19.4 look at where the third party is established or at where the data is held? For
  example, a provider established outside the EU that stores the data in an EU data centre.

Yes / No / Note: ____________________________________________

**21. Invoice copies rebuilt from AEAT's records after a restore (answer 1.16).**

*The situation.* If the venue's server has to be restored from an old backup, the invoices issued
after that backup are missing from it, although their records reached AEAT. The adviser answered that the
venue should retrieve those records from AEAT's record query service to rebuild the invoice copies,
which it must keep (RD 1619/2012 art. 19).

*What AEAT returns.* As AEAT's technical documents describe the reply, it carries each record's
number, date, description, customer where there is one, VAT breakdown and totals, but not the
dishes.

*We ask:* Is a copy rebuilt from that acceptable, or must the venue hold the full invoice some other
way, such as its continuous backup copy?

Yes / No / Note: ____________________________________________

**22. Three questions from October still awaited.**

*The situation.* The adviser's answers of 15 November did not cover three questions of the October list:

- **S17, selling by weight.** A certified scale weighs the goods; either it sends weight, price per
  kilo and total to the till, or staff type the weight into the till, which prices it. Does that
  meet the legal metrology rules, does our software need certification, and who signs the
  declaration of conformity? If this is outside the adviser's field, whom should we ask?
- **S18, a change of the company's legal name, keeping its tax number.** Which name goes on a
  record written before the change but sent after it, and on a cancellation, written after the
  change, of an invoice issued before it?
- **S19, holding back records.** Each record carries a fingerprint of the one before. While AEAT's
  answer to an earlier record is unknown, or after three refusals in a row with the same code,
  Waitron holds back the later records and retries the first one every hour. AEAT's developer FAQ
  says no record may be left unsent. May Waitron hold them back, for how long, and what must it
  keep?

*We ask:* When can we expect the adviser's answers?

Note: ____________________________________________

### Appendix: labour and privacy (drop it if you wish)

These need a labour adviser and a privacy specialist, not yet found (owner's plan, 9 November, in
[action-plan.md](action-plan.md)). Only the three questions needing judgement are here. The
confirmations L3 to L8 and P2 to P10 stand as written in the 6 November list, except that P4 must
first be updated for A1404 (#2627, 9 November), which encrypts the bucket copy with a key derived
from the recovery key.

- **L1.** Card tips paid through payroll: do they attract social security contributions? We think
  yes, reported under code 0001. No ruling or TGSS statement covers a restaurant.
- **L2.** Under the agreement's 1,783 hours a year, is overtime what exceeds the person's published
  calendar for the day or the nine-hour limit? The Statute counts it against the maximum ordinary
  working day (ET arts. 34 and 35.1), not a calendar.
- **P1.** May a restaurant keep allergy notes after the meal as evidence, set aside (blocked), under
  GDPR art. 9(2)(f) before any claim exists? For one, three or five years?

## Part 2: Español (para el asesor fiscal)

Preguntas para la reunión del jueves 19 de noviembre de 2026. Waitron es un software de punto de
venta para restauración que funciona en modalidad VERI\*FACTU. Se ejecuta en un servidor, un equipo
en el propio local o en Waitron Cloud, cuyo reloj fecha las facturas. Cada pregunta explica la
situación, lo que hace o propone Waitron y por qué, y lo que preguntamos, de modo que puede leerse
por separado. Las preguntas 1 y 2 requieren su criterio; de la 3 a la 14 son confirmaciones; de la 15
a la 22 parten de sus respuestas del 15 de noviembre a las S1 a S16 y R1 a R6 (sus apartados 1.1 a
1.16 y 2.1 a 2.6), que le agradecemos.

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

**2. Mantener una fecha que nada indica que sea errónea.**

*Situación.* El reloj del servidor fecha cada factura. Tras cada arranque, el servidor no registra
ventas hasta confirmar su hora: por la hora de internet, por dos dispositivos del local que
coinciden con él o por una persona. Esa confirmación podría ser errónea; por ejemplo, una persona
que confirma una hora equivocada en una hora. En una venta en efectivo nada fuera del servidor
registra la hora real; un pago con tarjeta lleva al menos la hora del proveedor de pagos.

*Propuesta de Waitron.* Si nada indica que la fecha de una factura sea errónea, el restaurante la
mantiene.

*Preguntamos:* ¿Es correcto? ¿Necesita el restaurante algo más para sostenerla?

Sí / No / Nota: ____________________________________________

### Confirmaciones: lo que se remite o se firma desde el primer día

**3. Cuándo termina la comida, el tique expedido antes del cobro, y la factura expedida tarde (a
partir de sus respuestas 1.1, 1.3 y 1.4).**

*Situación.* La factura simplificada (el tique) se expide en el momento de realizarse la operación
(RD 1619/2012, art. 11.1), y el IVA de una comida se devenga «cuando se presten, ejecuten o efectúen
las operaciones gravadas» (LIVA art. 75.Uno.2.º). En sus respuestas del 15 de noviembre indica que
una comida es un único servicio que se presta al terminar; que el tique expedido al terminar, en la
misma visita, lleva una sola fecha; que la factura expedida un día posterior debe indicar además la
fecha de la operación; y que el tique se expide al terminar el servicio, sin quedar condicionado al
cobro total.

*Propuesta de Waitron.* El tique se expide al terminar la comida, aunque la cuenta se pague mucho
después: con el último pago, o cuando el personal registra que la mesa se ha marchado sin pagarlo
todo. Lleva la fecha de ese momento.

*Preguntamos:*

- (a) ¿Termina la comida al servirse el último plato, o cuando los clientes acaban y se marchan?
  Ejemplo: el último plato se sirve a las 23:40 del día 1; después toman café, y pagan y se marchan
  a las 00:30 del día 2. Waitron lo decide según la jornada comercial del local, que termina a la
  hora de inicio del día que el local fija. Con las 05:00, la comida pertenece al servicio de la
  noche: el tique se fecha el día 2, sin otra fecha de operación. Con la medianoche, el tique se
  fecha el día 2 e indica el día 1 como fecha de la operación. ¿Es aceptable fechar según la jornada
  comercial del local, o la fecha de la operación es siempre el día en que se marchan los clientes?
- (b) Un cliente habitual come el lunes y, por acuerdo, paga el jueves. Waitron expide el tique el
  lunes, al terminar la comida, aún sin cobrar, y registra sobre él el pago del jueves. ¿Es
  correcto? Su respuesta 1.4 menciona facturas expedidas tras un pago por transferencia; la 1.3, que
  la expedición no puede quedar condicionada al cobro total.
- (c) Una factura expedida después de terminar el periodo de liquidación de su comida. Si el tique
  se expide al terminar la comida, debería ser raro; por ejemplo, una cuenta que se dejó abierta por
  error. Ejemplo: la cuenta de una comida del 28 de marzo queda abierta por error y se factura el
  25 de abril, después de presentar el 20 de abril la autoliquidación del primer trimestre. El IVA se
  devengó al terminar la comida (LIVA art. 75.Uno.2.º; su respuesta 1.4), por lo que corresponde al
  primer trimestre. Waitron propone dejar el informe del primer trimestre como se presentó y mostrar
  el IVA de la comida en una línea aparte, «corrección del primer trimestre», para que el gestor
  presente una autoliquidación complementaria (LGT art. 122): la opción 3 de la pregunta 7. ¿Es
  correcto? ¿Y debe la exportación para el gestor incluirla por la fecha de la operación o por la
  fecha de expedición?

Sí / No / Nota: ____________________________________________

**4. Serie de las rectificativas por fecha errónea (a partir de su respuesta 1.14).**

*Situación.* Las facturas rectificativas se numeran en series propias. Confirma que las
rectificativas de tiques (R5) van en una serie distinta de las de facturas completas (R1 a R4). Un
tique puede llevar además una fecha errónea, por ejemplo si el reloj del servidor iba un día
adelantado; se corrige con una rectificativa que indica la fecha real y no cambia ningún importe.

*Lo que hace Waitron.* Pone todas las R5, también las que se expiden porque la fecha del tique era
errónea, en una serie que solo contiene R5. La V2884-16 permitiría incluso las R5 en la serie de
tiques: «las facturas simplificadas rectificativa podrán incluirse dentro de la misma serie con el
resto de facturas simplificadas». Pero las V1665-22, V0902-22, V1924-23 y V2611-24 dicen que la
rectificativa de una fecha de expedición errónea «deberá constar en serie específica de factura».

*Preguntamos:* ¿Basta una serie solo de R5, o deben ir las rectificativas por fecha en una serie
aparte de las demás R5?

Sí / No / Nota: ____________________________________________

**5. Declaración responsable: componentes del sistema.**

*Situación.* El productor de un sistema informático de facturación firma, para cada versión, una
declaración responsable de que cumple la norma (Orden HAC/1177/2024, art. 15). Su apartado d) recoge
los componentes de hardware y software y una breve descripción de lo que hace el sistema. Aún no se
ha firmado ninguna. El texto actual del apartado d) está en el
[anexo](#anexo-el-apartado-d-tal-como-está-hoy).

*Propuesta de Waitron.* El texto nombra los componentes de terceros (Node.js, SQLite, Litestream,
Linux y Docker) como parte del sistema, dice que el productor responde de ellos, e indica la versión
de la biblioteca Veri\*Factu que se usa y lo que hace. Creemos que basta con dos añadidos: qué hace el
agente de impresión (el programa que envía los documentos a las impresoras del local), y que los
terminales (cajas, comanderos y pantallas de cocina) solicitan las facturas al servidor y las
muestran (el texto ya dice que no generan registros de facturación). La frase sobre un servidor de reserva solo figurará
en una versión que pueda pasar a él.

*Preguntamos:* Con esos dos añadidos, ¿es suficiente el apartado d)?

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

*Preguntamos:* ¿Son correctas esas respuestas?

Sí / No / Nota: ____________________________________________

### Confirmaciones: cuando el reloj estaba mal

**7. Fecha errónea en una factura, y periodo del IVA de una corrección.**

*Situación.* El servidor fecha cada factura con su propio reloj, que mantiene en hora mediante
internet. Si el reloj estaba mal, una factura puede llevar un día equivocado. Ejemplo: tras un corte
de luz el reloj va un día adelantado y un tique de una venta del 3 de marzo sale fechado el 4. La
AEAT rechaza un registro con fecha futura, y es una de las formas en que sale a la luz el error.

*Lo que hace Waitron.* Lo corrige con una rectificativa fechada el día en que se expide, que indica
la fecha real de la operación y no cambia ningún importe (DGT V1665-22: «será necesaria la
expedición de una factura rectificativa»; V0305-24). La rectificativa va en una serie que solo
contiene rectificativas de tiques. Una rectificativa puede corregir varias facturas (RD 1619/2012,
art. 15.4). Ya funciona para un tique que la AEAT rechazó por fecha futura; la versión para facturas
completas está hecha pero desactivada.

*El periodo del IVA: tres opciones.* Ejemplo: el tique de una comida del 28 de marzo sale fechado
el 2 de abril porque el reloj estaba mal; la autoliquidación del primer trimestre se presenta el
20 de abril; el error se descubre, y la rectificativa se expide, en mayo.

1. Imputar el cambio al periodo en que se expide la rectificativa, sin modificar nunca una
   declaración ya presentada. En el ejemplo, el IVA del tique sigue
   en el segundo trimestre, donde lo llevó la fecha errónea, y el primer trimestre queda como se
   presentó.
2. Imputarlo al periodo de la operación modificando la declaración de ese periodo: el IVA pasa al
   primer trimestre, que se corrige con una autoliquidación complementaria (LGT art. 122). Es lo
   que hace hoy Waitron (LIVA art. 75.Uno.2.º).
3. No modificar nunca una declaración presentada, y mostrar la diferencia en una línea aparte,
   «corrección del primer trimestre», para que el gestor presente la complementaria (LGT art. 122).

La AEAT consulta los registros presentados por periodo: las consultas «se realizan por
ejercicio/periodo “de imputación”, dato obtenido a partir de la fecha de operación o en su defecto
de la fecha de expedición» (descripción del servicio web v1.0.3, §6.4, p. 30). Con la opción 1, las
cifras de Waitron para un trimestre pueden no coincidir con lo que los registros de la AEAT muestran
para ese trimestre, y es una de las razones para no proponerla.

*Propuesta de Waitron.* Un informe ya presentado no cambia nunca. Un cambio que reduce el IVA de un
trimestre se imputa al trimestre en curso, como permite su respuesta 1.12 para una anulación. Un
cambio que añade IVA a un trimestre ya presentado se muestra en una línea aparte, como en la
opción 3, para que el gestor presente la complementaria, en línea con su respuesta 1.13 para un tipo
de IVA erróneo. En el ejemplo: el primer trimestre queda como se presentó, el informe del segundo
trimestre (aún sin presentar en mayo) deja de incluir el tique, y una línea «corrección del primer
trimestre» muestra su IVA.

*Preguntamos:* ¿Es la rectificativa la forma correcta de corregir una fecha errónea? ¿Es correcta la
propuesta para su IVA: las reducciones en el trimestre en curso y los aumentos en una línea aparte?
¿Es lo que exige el art. 89.Cinco LIVA?

Sí / No / Nota: ____________________________________________

**8. A quién llega la rectificativa.**

*Situación.* La rectificativa se remite normalmente al destinatario de la factura que corrige. Pero
la mayoría de los clientes de tique son desconocidos: el tique no identifica al cliente. Ejemplo:
hay que rectificar un tique porque el reloj del servidor le dio una fecha errónea, y nadie sabe quién
lo pagó.

*Lo que hace Waitron.* El restaurante expide la rectificativa, la conserva y remite su registro a la
AEAT; solo llega al cliente cuando el restaurante sabe quién es. No se anulan ni se vuelven a expedir
tiques. No hemos encontrado norma sobre este caso.

*Preguntamos:* ¿Es aceptable?

Sí / No / Nota: ____________________________________________

**9. Un registro con hora anterior a la del anterior.**

*Situación.* Cada registro debe incorporar «la fecha y hora exactas» de su generación (Orden
HAC/1177/2024, art. 7.e). Si el reloj del servidor iba adelantado y se corrige, el siguiente registro
lleva una hora anterior a la del último. Ejemplo: las facturas 2, 3 y 4 se fechan con el reloj una
hora adelantado; corregido el reloj, la factura 5 lleva una hora anterior a la de la 4.

*Lo que hace Waitron.* Lo permite sin marcarlo: el art. 3 de la misma Orden excluye para VERI\*FACTU
el art. 7.i), que contiene la única regla en contra. Las facturas 2 a 4 solo se rectifican si la hora
errónea pasó alguna a otro día; entonces se corrigen como fecha errónea, con una rectificativa que
indica la fecha real.

*Preguntamos:* ¿Es correcto?

Sí / No / Nota: ____________________________________________

**10. Solo la hora es errónea.**

*Situación.* El reloj del servidor estaba mal, pero sin cambiar el día: solo la hora del tique es
errónea. Ejemplo: un tique fechado a las 21:10 por una venta de las 20:50 del mismo día.

*Lo que hace Waitron.* No expide rectificativa; el restaurante guarda constancia del incidente. La
factura indica la fecha, no la hora (RD 1619/2012, arts. 6.1.b y 7.1.b), y las FAQ para
desarrolladores dicen: «La hora de expedición e impresión material de la factura no forma parte del
RF». En sentido contrario, el caso 2.b de su apartado 17 pide un registro de subsanación para un
error en un campo interno.

*Preguntamos:* ¿Es correcto no rectificar?

Sí / No / Nota: ____________________________________________

**11. Comunicar a la AEAT un incidente de reloj.**

*Situación.* Se descubre que el reloj del servidor estaba mal, y las facturas afectadas se han
rectificado, o se han dejado como estaban porque solo era errónea la hora.

*Propuesta de Waitron.* No comunicar nada. Una búsqueda en el Reglamento (RD 1007/2023), la Orden,
las dos FAQ de la AEAT y sus documentos técnicos no encontró ni obligación ni cauce, y el registro de
cualquier rectificativa llega a la AEAT igualmente. El art. 16.4 de la Orden trata las incidencias
que impiden la remisión, que es otro caso.

*Preguntamos:* ¿Es correcto?

Sí / No / Nota: ____________________________________________

### Confirmaciones: conservación y acceso

**12. Acceso en línea sin internet.**

*Situación.* Las facturas conservadas por medios electrónicos deben permitir el acceso en línea de
la Administración (RD 1619/2012, arts. 21.2 y 23). El servidor de Waitron suele estar en el propio
restaurante, en una red privada y sin dirección pública.

*Propuesta de Waitron.* Se cumple si, cuando la Administración lo pide, el local permite sin demora
injustificada consultar, buscar, copiar o descargar e imprimir todas las facturas. No hace falta
conexión permanente ni dirección pública (Orden EHA/962/2007, art. 5.3; DGT 0289-04). Si la AEAT lo
pide desde su oficina, basta una copia del periodo en USB o un enlace temporal de descarga.

*Cómo es una copia.* En la página de Facturas del inspector, una factura completa se descarga como
su PDF en A4, y un tique (factura simplificada) como un PDF del ancho del tique, con la misma
disposición que el tique impreso en caja; ambos llevan la marca «DUPLICADO». Un tique anulado, o
sustituido después por una factura completa, se descarga exactamente como se expidió. La lista
marca un tique anulado como «Anulada» y muestra la factura completa que sustituye tiques como
«Sustituye a ‹números de tique›»; la fila del tique sustituido no indica qué factura lo sustituyó.
La exportación prevista recoge las columnas de la lista.

*Preguntamos:* ¿Es correcto? ¿Y debería la propia copia indicar también «Anulada el ‹fecha›» o
«Sustituida por la factura ‹número›»?

Sí / No / Nota: ____________________________________________

**13. Qué conserva una sociedad de restauración.**

*Situación.* Waitron está definiendo cuánto tiempo conserva cada tipo de registro, y quiere una
lista única de lo que una sociedad de restauración debe conservar por normativa fiscal y mercantil.

*Propuesta de Waitron.* Facturas expedidas, tiques incluidos, y recibidas (RD 1619/2012, art. 19.1);
libros, correspondencia y documentación (Código de Comercio, art. 30.1); demás justificantes
tributarios (LGT art. 29.2.e); registros de cobros y devoluciones; la declaración responsable de cada
versión utilizada; justificantes de pago de ventas de 1.000 € o más, cinco años (Ley 7/2012, art.
7.Uno.4); y proformas que no llegaron a factura. Todo con un calendario común de seis años.

*Preguntamos:* ¿Falta algo?

Sí / No / Nota: ____________________________________________

**14. Registros que la AEAT no tiene.**

*Situación.* Normalmente todo registro llega a la AEAT, que lo conserva. Algunos no llegan nunca: un
registro pendiente de envío, o uno rechazado. Ese registro «no figuraría jamás en los sistemas de la
AEAT (aunque constaría un rechazo)» (FAQ para desarrolladores), de modo que la copia del restaurante
es la única.

*Propuesta de Waitron.* Conservarlo con la respuesta de la AEAT hasta resolverse, y después según el
calendario común de seis años. No hemos encontrado plazo.

*Preguntamos:* ¿Es correcto?

Sí / No / Nota: ____________________________________________

### A partir de sus respuestas del 15 de noviembre

**15. Un pago a cuenta durante la comida (su respuesta 1.3).**

*Situación.* En una mesa, a veces un comensal paga parte de la cuenta antes de terminar la comida y
se marcha. Indica que lo pagado antes de que la mesa esté servida del todo es un pago anticipado: el
IVA se devenga al cobrarlo, y necesita su propia factura (LIVA art. 75.Dos; RD 1619/2012, art. 2.1),
siempre que lo que se paga esté claramente identificado (STJUE C-419/02, BUPA).

*Ejemplo.* Una mesa de cuatro lleva 120 € consumidos y aún no ha pedido postres. A las 21:30 Ana paga
30 € «a cuenta» y se marcha; los demás pagan el resto a las 23:00.

*Lo que haría Waitron si los 30 € de Ana son un anticipo.* Expedir a Ana un tique de 30 € a las 21:30,
y mostrar en el tique final el total de la cuenta menos el anticipo de Ana, como se descuenta una
señal.

*Preguntamos:*

- (a) ¿Son esos 30 € un pago anticipado, si son un importe y no platos concretos y la mesa aún puede
  pedir más?
- (b) Si lo son, ¿puede su tique recoger como pagados a cuenta los platos pedidos hasta ese momento,
  y el tique final mostrar el total menos la base y la cuota del anticipo, como indica para una señal
  (su respuesta 1.8)?

Sí / No / Nota: ____________________________________________

**16. La entrega del tique en la práctica (su respuesta 1.11).**

*Situación.* Indica que el tique debe entregarse y que el cliente no puede renunciar a ello. Imprimirlo
solo si se pide, o nunca, lo incumple; mostrarlo en pantalla no es entregarlo; el correo electrónico o
un enlace de descarga exigen el consentimiento informado del cliente (RD 1619/2012, art. 9), tras
informarle de cómo lo recibirá y de que puede pedirlo en papel.

*Lo que hará Waitron.* Imprimir todos los tiques al cobrar, salvo que el cliente elija el correo.
Para el correo, el empleado pregunta «¿en papel o por correo?»; la caja muestra «Le enviaremos el
tique a esta dirección. Puede pedir una copia en papel en cualquier momento» y registra que se
mostró.

*Preguntamos:*

- (a) ¿Se considera entregado el tique impreso y dejado con la cuenta, aunque el cliente lo deje en
  la mesa o diga que no lo quiere?
- (b) ¿Es consentimiento informado el paso del correo descrito, y basta el envío del correo como
  prueba de entrega, o hace falta que el cliente lo abra o lo descargue?

Sí / No / Nota: ____________________________________________

**17. Una mesa invitada, o una comida de personal (su respuesta 1.10).**

*Situación.* A veces el restaurante no cobra nada a una mesa: el propietario invita a clientes
habituales o amigos, o el personal come a cargo de la casa. Indica que el tratamiento sin riesgo es
el autoconsumo valorado a coste, no al precio de carta (DGT V2347-24; LIVA art. 79.Cuatro), con
factura y registro. La alternativa, tratar la invitación con fines empresariales como no sujeta, es
defendible, pero contraria a la V2347-24, y cada local debe decidir con su asesor.

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

**20. Quién es el tercero para las copias fuera de España (su respuesta 1.15).**

*Situación.* Waitron guarda, como copia de seguridad, una copia continua de los datos del local
fuera del restaurante. Indica que una copia en el extranjero, mientras el original sigue en el
servidor en España, no es por sí misma conservación fuera de España; que quien guarda la copia por
cuenta del local es un tercero (RD 1619/2012, art. 19.3); y que un tercero establecido fuera de la UE
requiere comunicación previa a la AEAT por el procedimiento GZ05 (art. 19.4).

*Las dos modalidades.* Waitron Cloud prevé guardar las copias en Amazon Web Services, empresa de
matriz estadounidense, en centros de datos de España y Francia. Un local puede, en cambio, enviar su
copia a un proveedor de almacenamiento de su elección.

*Preguntamos:*

- (a) ¿Es el tercero la empresa con la que contrata el local (Waitron), el proveedor de
  almacenamiento, o ambos?
- (b) ¿El art. 19.4 atiende al lugar de establecimiento del tercero o al lugar donde están los
  datos? Por ejemplo, un proveedor establecido fuera de la UE que guarda los datos en un centro de
  datos de la UE.

Sí / No / Nota: ____________________________________________

**21. Copias reconstruidas con los registros de la AEAT tras una restauración (su respuesta
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

**22. Tres preguntas de octubre aún pendientes.**

*Situación.* Sus respuestas del 15 de noviembre no tratan tres preguntas de la lista de octubre:

- **S17, venta a peso.** Una balanza verificada pesa el producto; o envía al TPV el peso, el precio
  por kilo y el importe, o el empleado teclea el peso en el TPV, que calcula el importe. ¿Cumple la
  normativa de metrología legal, necesita nuestro software una certificación, y quién firma la
  declaración de conformidad? Si queda fuera de su ámbito, ¿a quién nos recomienda consultar?
- **S18, cambio de denominación social con el mismo NIF.** ¿Qué nombre lleva un registro generado
  antes del cambio pero remitido después, y una anulación, generada después del cambio, de una
  factura expedida antes?
- **S19, retener registros.** Cada registro lleva la huella del anterior. Mientras se desconoce la
  respuesta de la AEAT a un registro anterior, o tras tres rechazos seguidos con el mismo código,
  Waitron retiene los registros posteriores y reintenta el primero cada hora. Las FAQ para
  desarrolladores dicen que no pueden quedar registros sin remitir. ¿Puede Waitron retenerlos,
  hasta cuándo, y qué debe conservar?

*Preguntamos:* ¿Cuándo podemos esperar su respuesta?

Nota: ____________________________________________

### Anexo: el apartado d), tal como está hoy

Texto de la plantilla de la declaración (`packages/fiscal-verifactu/declarations/template.md`, líneas 13 a 36). Los valores entre ‹ › los rellena cada versión.

> **1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere
> esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema
> informático y de sus principales funcionalidades:**
>
> Waitron es un software de punto de venta para restaurantes y bares. Se ejecuta en un servidor
> —un equipo del propio establecimiento o un servidor en la nube— con Linux y Docker, y los
> terminales del establecimiento (cajas, comanderos, pantallas de cocina y el panel de gestión) se
> conectan a él por la red mediante un navegador. Opcionalmente, un segundo servidor de reserva en
> el establecimiento mantiene una copia continua de los datos y puede sustituir al principal si este
> falla.
>
> Hardware: Waitron no incluye hardware propio; funciona en cualquier ordenador que cumpla lo
> anterior.
>
> Software: el servidor Waitron, que genera, encadena, conserva y remite los registros de
> facturación; la biblioteca @waitron/verifactu (versión ‹versión de @waitron/verifactu›), que
> construye cada registro, su huella y el contenido del código QR, y lo remite, y que cuenta con su propia declaración
> responsable; las aplicaciones de los terminales, que no generan registros de facturación; el
> agente de impresión; y los componentes de terceros de los que nos hacemos responsables: Node.js,
> SQLite, Litestream, Linux y Docker (la lista completa se muestra en el propio sistema).
>
> Cada instalación lleva la facturación de un único obligado tributario y aplica una única modalidad
> de cumplimiento, determinada por el paquete de país instalado; esta versión solo funciona como
> VERI*FACTU.

### Apéndice: laboral y privacidad (para otro asesor)

- **L1.** ¿Cotizan las propinas de tarjeta que se abonan en nómina? Proponemos que sí, con el código
  0001. No hemos encontrado criterio de la TGSS para un restaurante.
- **L2.** Con la jornada anual de 1.783 horas del convenio, ¿son horas extraordinarias las que superan
  el calendario publicado de la persona para ese día o el límite de nueve horas? El ET las cuenta
  sobre la jornada máxima ordinaria (arts. 34 y 35.1), no sobre un calendario.
- **P1.** ¿Puede el restaurante conservar, bloqueadas, las anotaciones de alergias después de la
  comida como prueba, con base en el art. 9.2.f RGPD antes de que exista reclamación? ¿Durante uno,
  tres o cinco años?

## Dropped since 6 November

| Item | Why it is not asked | Receipt |
| --- | --- | --- |
| T13, the long-term archive | Owner, 15 November: "Agree, no archive now" (A1531) | `~/waitron-campaign-l/questions.md:1783-1785`; [backlog.md:2235](../backlog.md) |
| T16, a change of producer | Owner, 11 November, "Later": A993 is built only once a change is scheduled. Its venue-move half is now in question 6 | commit `e59fac8c94`; [backlog.md:246-249](../backlog.md) |
| T9 and T10, tips | Held by the owner on 6 November until A793 is revived, and A793 is still not approved | [2026-11-06-adviser-questions.md:71-72](2026-11-06-adviser-questions.md); [backlog.md:1283-1286](../backlog.md) |
| S14's second half: may R5 and R1 to R4 share one series? | Owner, 15 November: they will not share; the adviser agreed the same day (answer 1.14). Question 4 asks the narrower point | `~/waitron-campaign-shared/desk/done/20261115-1018-L-r5-series-date-rulings.md` |
| S4's last part: may the issue date stand as the date VAT falls due? | Owner, 12 and 15 November: one date when invoiced at the meal's end, the sale day when invoiced later. The adviser agreed on 15 November (answer 1.4); question 3 now asks when the meal ends, whether the ticket may wait, and where an invoice issued after its meal's VAT period counts | [backlog/fiscal.md:1103-1116](../backlog/fiscal.md); `desk/done/20261115-0530-L-later-sale-date-rule.md`, `20261115-1113-L-later-sale-q1-open-bill.md`, `20261115-1113-L-later-sale-q2-vat-period.md` |
| The 6 November background on AEAT's time (decision 2b and "How a wrong clock is known") | Owner, 10 to 13 November: Waitron reads AEAT's time only to warn of drift, and a refusal for a future date no longer stops a box whose internet time is synchronised | [CLAUDE.md:958-967 and 995](../../CLAUDE.md) |

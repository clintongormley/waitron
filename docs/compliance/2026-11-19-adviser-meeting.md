# Adviser meeting, Thursday 19 November 2026

Internal copy, for the owner. Rewritten with the owner on 18 November 2026: the 26 questions of the
earlier version became 11, written to the adviser, with internal references removed. The shared
Google Doc "Waitron adviser meeting, 19 November 2026" holds the two parts below side by side,
English beside Spanish; this header and everything after Part 2 are not in it. Questions 12 and
13 were added to both parts after the meeting (see [Added after the meeting](#added-after-the-meeting)).

**Decisions taken while rewriting (owner, 18 November).**

- A bill still open when the venue's trading day ends is issued then (question 1). Nothing does
  this today; it is to be built after the meeting, depending on the answer. (2026-11-19: built on
  branch `feat/adviser-close-of-day-ticket`, the `bills.close_of_day` job.)
- The pre-bill (backlog A446) stays parked in favour of correctives when a table splits after
  printing; question 2 asks whether that is acceptable.
- When a set menu's items carry different VAT rates, the price is split between them in proportion
  to each item's own price (question 4), so that a future change to the single eat-in rate needs no
  new rule. The set-menu plans assume one rate per menu and refuse a dish at another rate
  (`docs/superpowers/plans/2026-11-18-a1515-set-menu-dashboard.md`, Task 3 of
  `docs/superpowers/plans/2026-11-18-a1515-set-menu-bill.md`); revisit them with the answer.
- Item d) of the declaration lists full invoices as well as simplified ones (question 9), as
  `packages/fiscal-verifactu/declarations/functions.md` now does.

**The owner's answers, 18 November.** These are the owner's own answers, not the adviser's; the
adviser will come back with more details. Each is quoted under its question's Note in Part 1;
Part 2 and the shared Google Doc are unchanged. Against the plans this sheet put forward:

- **Changed.** Money paid towards a meal before its ticket is issued is an advance, with its own
  invoice and VAT, which the final ticket deducts, even when it names no dishes; 10% is reasonable
  (question 1) (2026-11-19: since changed by the owner: a part payment during the meal is an advance only when its payer wants their own receipt; the final ticket still lists the dishes and takes the advance off; see question 12 and [the advances plan](../superpowers/plans/2026-11-19-adviser-advances.md)). The till's "None" choice cannot stay: a ticket is always printed unless it is
  emailed (question 3). A set menu is not split by its items' prices: a bundle takes the rate of
  its main item, so food with a drink takes the food's rate, eaten in or taken away, while items
  ordered separately to take away keep their own rates (question 4). That replaces the decision
  above to split by price, and supports the set-menu plans' one rate per menu.
- **New and unsettled.** Drinks served in the restaurant without food may take 21%, certainly once
  the kitchen has stopped serving; the adviser will come back on it (question 4).
- **Handed to the accountant, not decided by Waitron.** A rate set too low (worked out per invoice
  line) or too high (question 5); free meals, which are a self-supply only when given in exchange
  for services, not as marketing, goodwill or a staff meal (question 6); and every correction to an
  already-filed quarter (question 8). Each goes on a report for the accountant.
- **Confirmed.** When the meal ends (whichever comes first of printing the bill, the last payment
  or the end of the trading day), a ticket showing an amount owed, payment slips, duplicates at any
  time, a corrective or a cancellation when a table splits, no pre-bill, covered dishes left off the
  ticket, two dated rates per product, the counter at 10%, a corrective when a no-show's deposit is
  kept and when money is given back, ticket correctives in their own series, the wrong-day plan,
  access without the internet, no cancelled or replaced mark on a copy, and keeping records AEAT
  never received.
- **Not an issue.** A change of legal name (S18). Holding records back behind a stuck one (S19)
  seems unnecessary, since AEAT accepts later records when an earlier one is refused; the owner
  suggests confirming on AEAT's developer channel.
- **After lost data.** Rebuilding from AEAT's records is not the point: record every incident
  (hardware faults, a break-in, lost data) so the venue can explain what happened (question 10).
- **Still to be confirmed.** Tips (question 7); a wrong time on the right day (question 8); the
  declaration's item d) and item f), where the owner's view is N because each venue uses its own
  certificate (question 9); a copy carrying today's header and logo, and which records are kept ten
  years (question 10). The questions outside tax had no answer.

**The owner's decisions on the answers, 18 November** (from the follow-up questions the same day):

- A1420 D8 stands: a wrong date AEAT accepts is not corrected; only a sale AEAT refuses as dated
  in the future gets a corrective (question 8).
- A set menu carries its own two VAT rates, eaten in and taken away, set like any product's; any
  dish may be included and set menus may be taken away (question 4). A full invoice lists the menu
  and its supplements as the ticket does. In the watcher's follow-up on 18 November around 19:30,
  the owner answered "no" to whether a drink supplement keeps the drink's own VAT rate. The
  supplement takes the set menu's rate.
- Drinks served without food stay at the eat-in rate until the adviser comes back (question 4).
- Money given back as goodwill takes a corrective (question 6).
- Waitron issues the corrective for a no-show's kept deposit by itself, at every venue (question 6).
- A duplicate shows the payments made since the original and what is still owed (question 2).
- Staff marking a table as having left without paying issues its ticket at once (question 1).
- An advance's ticket reads «Pago a cuenta — consumo en mesa 7» at the eat-in rate. Waitron issues
  advances paid before the day too, on the booking; where the company can pay afterwards, the
  dinner is closed as a deferred payment instead (question 1).

**How the quotations were checked.** Every quotation of a law, ruling or FAQ comes from the earlier
version of this sheet (commit `fccbd09f1a`), whose quotations were matched by script against the
official texts on 15 and 18 November 2026, with two exceptions. «pérdida del original» (question 2)
comes from the BOE text of RD 1619/2012 art. 14 quoted in [verifactu-findings.md](verifactu-findings.md)
§15.1 and was not run through the script. «no pueden quedar RF generados sin remitir a la AEAT»
(question 11) was matched on 18 November against AEAT's developer FAQ v1.3
(`sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf`), where it sits in section 5. Every other word in
« » is ours.

## Part 1: English

**1. When the table's ticket is issued** (following your answers 1.1, 1.3, 1.4 and 1.8)

You said that a meal's ticket is due when the meal ends, even if the bill is not yet paid in full, and that money paid before then is an advance, with a ticket of its own, if what it pays for is clearly identified.

- **The meal ends when staff print the bill.** The ticket is issued at that moment, for everything on the bill, and the guests then pay against it in one payment or several. *Is printing the bill the right moment, rather than serving the last dish or taking the last payment?*
- **A bill that is never printed** is issued when it is fully paid, when staff record that the guests left without paying, or when the venue's trading day ends, whichever comes first. Each venue sets its day to end at a time when it is closed, such as 05:00. A ticket issued before it is paid shows the amount still owed. *Is that acceptable?*
- **Money paid towards the bill before the meal ends, naming no dishes,** is not an advance and gets no ticket of its own. For example, at 21:30 Ana pays €30 "towards the bill" of a table of four and leaves, and the others pay the rest at 23:00. Waitron records the €30 against the bill, and the ticket issued at the end covers everything served and shows the €30 as already paid. The same goes for a group that leaves €1,000 towards its tab at the start of the evening. We take this from your answer 1.8, where a deposit that identifies nothing is not an advance. By contrast, a company that pays €1,000 for its dinner on the 14th, for 40 guests on a set menu, has identified what it pays for: that is an advance, with its own ticket, which the final ticket deducts. *Have we read that correctly, or is money paid towards this table's meal already "clearly identified"? If it is an advance, what should its ticket describe when it names no dishes, for example "payment on account for the meal at table 7" at 10%?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- When the meal ends: "Whichever comes first: printing the bill; taking the last payment; close of trading day".
- A bill that is never printed: "yes".
- Money paid before the meal ends: "An advance needs to be genuinely not associated with the end purchase, so in all the examples listed here, these would be advances, not deposits, and an invoice should be issued and VAT should be payed. It would be reasonable to charge 10% for hospitality services/food."

Open: the "yes" covers the whole second point; it does not single out staff recording that the guests left without paying as one of the moments the ticket is issued.

**2. After the table's ticket has been issued** (following your answers 1.2, 1.7, 2.1 and 2.2)

Because a ticket may now be issued before it is paid, Waitron prints on each ticket the payments made so far, with each card's brand and last four digits, and any amount still owed.

- **A payment made after the ticket** prints a payment slip, with no invoice number, QR code or amount owed. You confirmed (2.2) that such a slip, printed beside the ticket, is not an invoice. *Is that still so when the slip is printed hours or days after the ticket? May the slip name the ticket number it pays?*
- **A reprint of the ticket** is marked «DUPLICADO» and has the same number, lines, totals and QR code, plus any payments made since the original. For example, a €60 ticket printed at 22:00 shows «Pendiente: 60,00 €». The customer pays by card the next morning and asks for a ticket that shows the payment, and staff reprint it with «Visa \*\*\*\*4034 60,00 €» and nothing owed. Staff can reprint at any time, but RD 1619/2012 art. 14 admits a duplicate only for several recipients of one sale or «pérdida del original». *May a duplicate be printed whenever the customer asks, and may it show payments made after the original? If only for a lost original, must staff record that reason?*
- **Guests who split the bill after it was printed.** Printing the bill issues the table's ticket, so if the guests then decide to pay for their own items, the table's ticket has to be undone and each guest given a ticket of their own. We plan a corrective invoice (R5) that takes the table's ticket back to zero, then a new ticket for each guest. You said (1.7) that a cancellation record is for an invoice issued in error, for a sale that never happened, and here the sale did happen. *Is a corrective right, or is this a cancellation, since the table's ticket was replaced before anyone paid it?*
- **No pre-bill.** You confirmed (1.2) that a pre-bill, printed for the table to check before paying, is allowed if it is kept and linked to the ticket that follows. We have set the pre-bill aside: printing the bill issues the ticket, and a table that splits afterwards is handled with a corrective, as above. Splits after printing will be common, so this means many correctives. *Is that acceptable, or should we print a pre-bill first and issue the ticket only once the table has decided how to pay?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- A payment made after the ticket: "Yes, but not required." Read as: the slip is still not an invoice when printed later, and it may name the ticket number but need not.
- A reprint: "Nobody is going to get upset about us printing duplicate receipts for other reasons than those listed, so it is ok for us to print duplicates whenever we want to."
- Splitting after the bill was printed: "Either a cancellation or correction is acceptable here."
- No pre-bill: "No pre-bill is fine, and saves us the hassle of having another system to track. If the bill changes after it is issued then we just issue a correction or cancellation."

Open: whether a duplicate may show payments made after the original.

**3. A customer who wants no ticket** (following your answer 1.11)

You said that the customer cannot waive the ticket, and that sending it by email needs their consent, which may be tacit. Staff ask "paper or email?". A printed ticket left with the bill counts as delivered, even if the customer leaves it behind. For email, the till tells the customer "We'll email your ticket to this address. You can ask for a paper copy at any time.", and sending the email counts as delivery. Waitron also keeps a "None" choice for a customer who wants neither, because most customers don't want the ticket and printing every one wastes paper.

*If staff choose "None", what does the venue risk?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

"It is required to deliver a ticket. We must always print one unless we email it instead."

**4. Set menus** (following your answer 1.10)

A set menu has one price. The dishes it covers go to the kitchen at €0.00. A dish may carry a supplement, and a covered dish may have a paid extra.

- **What the ticket lists.** The ticket and the full invoice list each menu with its price, and every supplement and paid extra, but not a covered dish with nothing to pay. For example, a €14.00 menu at 10% covers soup, sirloin and a glass of wine. The sirloin carries a €5.00 supplement and the soup a €1.50 portion of bread. The ticket shows the menu 14.00, Sirloin +5.00, and Soup with Bread 1.50: €20.50 in all. The wine is not listed. A ticket needs «La identificación del tipo de bienes entregados o de servicios prestados» (RD 1619/2012 art. 7.1.e), and a full invoice the description needed to work out the taxable base (art. 6.1.f). *May covered dishes be left off the ticket? May they be left off the full invoice, or must they be listed there, perhaps without a price?*
- **Splitting the price between VAT rates.** Each item a menu covers has its own VAT rate (question 5). When a menu's items carry different rates, we split the menu's price between them in proportion to what each item sells for on its own, as your answer 1.10 does for a free item (LIVA 79.Dos). Today that happens only when a menu is taken away, since everything eaten at the venue, drinks included, is restaurant service at 10% (LIVA 91.Uno.2.2.º). Taken away, a menu is a sale of goods and each part takes its own rate (LIVA 91.Uno.1.1.º; DGT V2949-16). For example, a €12.00 takeaway menu has a burger that sells for €9.50 on its own (food, 10%) and a cola that sells for €3.00 (a sugared soft drink, 21%). The menu is split into €9.12 at 10% and €2.88 at 21%. *Is that right? Must the split follow the separate prices exactly, or will a reasonable estimate do? If the customer leaves out the cola and still pays €12.00, is it all food at 10%?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- What the ticket lists: "It is fine to just list the "menu del dia" and any supplements. We don't need to list every dish that it includes."
- Splitting the price between VAT rates: "Actually things are both more and less complicated. The VAT rate of the major purchase item is applied. So if the customer buys food that is accompanied by a drink (either dine-in or as a bundle to take-away) then the VAT rate of the food applies. So if the customer buys a bundle consisting of a hamburger, a salad, and a small bottle of wine to take away, then that is 10%. However if the customer orders 1 x hamburger, 1 x salad, 1  x small bottle of wine separately to take away, then each item gets its own VAT rate. Also, in the restaurant, if a customer orders just alcohol without food then they should pay 21% instead of 10% (this is a grey area, but certainly if the restaurant no longer serves food, just drinks, then those drinks attract the 21%). This is definitely not something handled by Square today. I'm not quite sure how we should handle it. The adviser is going to come back to us with more info"

Open: whether covered dishes may also be left off a full invoice; drinks served without food, which the adviser will come back on.

**5. VAT rates per product, and a wrong rate found later** (following your answers 1.4 and 1.13)

- **Two rates per product.** Each product keeps a dated history of two VAT rates, one for eating at the venue and one for taking away, each chosen from the rates AEAT accepts (0, 2, 4, 5, 7.5, 10 and 21). A change can be scheduled ahead, for example from 1 April. An invoice takes each product's rates on the day the meal ends (LIVA 90.Dos; your answer 1.4), so a dinner that ends after midnight on 1 April takes 1 April's rates. A deposit keeps the rate of the day it was paid. *Is that right?*
- **Eating in or taking away at the counter.** At the counter of a venue that also has tables, staff ring up a cola as drunk on the premises (10%), and the customer then carries it out. *Does it stay at 10%? If the customer says nothing, may staff ring it up as drunk on the premises?*
- **A rate set too low, found later.** The product is corrected ("should have been 21% from 1 February") without rewriting what was charged: customers' tickets stay as they are and nothing is sent to AEAT. For each earlier quarter, Waitron works out the VAT owed by treating the price charged as including the right rate (your answer 1.13), and puts it on the corrections report described in question 8, for the accountant to file in a complementary return. For example, 200 bottles of wine sold to take away at €8.00 in the first quarter, at 10% instead of 21%: €1,600 × 21/121 − €1,600 × 10/110 = €277.69 − €145.45 = €132.24 owed. *Is that right? Is the difference worked out per invoice line, per invoice, or on the quarter's total for the product? Rounding gives slightly different amounts.*
- **A rate set too high.** For example, 21% charged where 10% was due, so the venue paid too much VAT. Reducing it in the current return obliges the venue to repay the excess to the customer (LIVA 89.Cinco.b), which it cannot do for a ticket that names nobody. *Must the venue then ask for the earlier return to be corrected (LGT art. 120.3), or leave the VAT as declared?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- Two rates per product: "correct".
- Eating in or taking away at the counter: "yes".
- A rate set too low: "it should be per invoice line. but we should just produce a corrections report which goes to the accountant"
- A rate set too high: "Again, we just produce a correction report which goes to the accountant"

**6. A meal given free, a deposit kept, money given back** (following your answers 1.5, 1.8 and 1.10)

- **A table given its meal free.** You said the safe treatment is a self-supply (autoconsumo) valued at cost, with an invoice and a record (DGT V2347-24; LIVA 79.Cuatro). For example, the owner invites four regulars to a meal that comes to €160 on the menu and €48 in ingredients: €48 taxable and €4.80 VAT, which the venue pays. *Is the cost the ingredients only, or a share of staff and overheads too? Without recipe costs, may the venue use a standard share of the menu price, such as 30%? Which document is issued, to whom (the venue itself or the table), and what record goes to AEAT? Is a free meal for an employee on shift also a self-supply at cost, or outside VAT?*
- **A deposit kept after a no-show.** A €40 deposit for a booking has its own ticket: €36.36 plus €3.64 VAT at 10%. The guests don't come and the venue keeps the €40 as compensation, which is outside VAT (DGT V0839-20). But reducing VAT already declared requires refunding it to the customer (LIVA 89.Cinco.b). *Does the venue issue a corrective removing the €3.64, though it refunds nothing, or does the deposit's ticket stand?*
- **Money given back as goodwill.** A guest complains after paying €62 and the manager gives €10 back. You said (1.5) that a price reduction after the ticket "will, where applicable, require" a corrective invoice (LIVA 80.Uno.2.º). *Is the corrective required here, or may the venue give the money back without one and go on declaring VAT on €62?*
- **Goodwill money back on a bill with two VAT rates** (added 21 November). If everything eaten in is at 10% (question 12), this happens only on a takeaway bill, such as a bottle of wine at €12.00 (21%) and a cheese at €8.00 (4%). The customer complains and the manager gives €5.00 back. We plan to split the €5.00 across the bill in proportion to the menu prices, as your answer 1.10 does for a free item: −€3.00 on the wine (−€2.48 base, −€0.52 VAT) and −€2.00 on the cheese (−€1.92 base, −€0.08 VAT). *If a corrective is required (the point above), is splitting by menu price right, or must the venue say which items the money comes off? And, to confirm the point above: is the corrective required at all, or may the venue give the money back without one, leaving VAT declared on the full price, and list the refund for its accountant?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- A table given its meal free: "The question is is it for autoconsumo. So you invite an instagrammer to eat for free, or you reward a loyal customer, or you give somebody a free meal because they had a bad experience, and all of that could be considered marketing, not autoconsumo, ie something that helps your business. Feeding your employee is also not autoconsumo. However, inviting somebody in exchange for services would be considered autoconsumo and would attract VAT. Saying that our margin is 30% so our cost is 70% gives you a basis for working out the VAT to invoice. However, if it isn't autoconsumo, then theoretically you shouldn't get the VAT back on the raw ingredients! This is way too complex for us to handle automatically in Waitron, instead this should be part of some report that we make available to the accountant to decide what to do."
- A deposit kept after a no-show: "yes we should issue the corrective. the customer could theoretically reclaim the VAT unless our website states that they lose the full amount should they fail to arrive. But this is an issue for the restaurants to figure out."
- Money given back as goodwill: "yes"

Open: the goodwill "yes" does not say which of the two choices it answers; read as: the corrective is required.

**The owner's answer, 21 November 2026**, to the summary "whether that split is right, and whether a correction is needed at all" (the point on goodwill money back on a bill with two VAT rates): "yes and yes". Read as: splitting by menu price is right, and a corrective is required, which settles the reading of 18 November above. The adviser is still to confirm.

**7. Tips**

Waitron can offer a tip when a guest pays, and keeps tips off the invoice. The card provider pays the tip to the restaurant with the rest of the bill, and the restaurant passes it to staff.

- **Suggested percentages.** The guest sees choices such as no tip, 5%, 10%, 15% or another amount, with nothing pre-selected. We treat the tip as outside VAT. The rulings' test is that no fixed amount is set and the amount is left to the giver (V1895-24, V5110-26, V2182-23), and a list the guest can ignore sets nothing, since the meal is owed whatever the guest tips. *Is that right?*
- **How card tips are booked.** Card tips passed to staff are not the restaurant's income. They are a debt to staff from the day they are collected, cleared when paid through payroll, so they don't count towards turnover (PGC valuation rule 14.ª; ruling 2174-03, which calls the business a «mero intermediario»). This holds only while staff, not the business, are entitled to the tips. *Is that right?*
- **Who withholds income tax on a tip.** It depends on who pays the worker (LIRPF art. 99.2; RIRPF art. 76.1; ruling 2174-03). Card tips, and cash tips put in the till and shared out at the close, are paid by the employer, so they go through payroll with withholding. Cash handed straight to a waiter and kept, or a tip jar staff run with the business taking no part, is paid by the guest: there is no withholding, and the waiter declares it. *Is that right?*
- **Social security on card tips.** We take it that card tips paid through payroll attract social security contributions, reported as ordinary pay (code 0001), since the social security system has no code for tips and no way to report one as excluded. STS 692/2021 put casino tips in the contribution base but said hospitality tips differ. *Is that right, or is this one for a payroll adviser?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

"to be confirmed"

**8. When the server's clock was wrong**

Each record sent to AEAT carries the time it was made, but the invoice shows only the date. When the server's clock turns out to have been wrong and is put right, we plan the following.

- **Wrong time, right day.** For example, a sale at 20:50 is stamped 21:10, or invoice 5 is timed before invoice 4 because the clock was set back. We correct nothing and keep a note of the fault. Art. 7.i of Orden HAC/1177/2024, which requires records in time order, does not apply to VERI\*FACTU (art. 3). *Is that right? AEAT's developer FAQ (§17, case 2.b) says that an error in an internal field of a record needs a correcting record. Does that cover a wrong time?*
- **Wrong day.** For example, a meal on 31 March is dated 1 April. We issue a corrective invoice that states the real date and changes no amount (DGT V1665-22). Like every ticket corrective, it goes in a series of its own, separate from the tickets: rulings V1665-22, V0902-22, V1924-23 and V2611-24 say a corrective for a wrong issue date «deberá constar en serie específica de factura», although V2884-16 would allow ticket correctives in the ticket series. *Is that right?*
- **VAT.** Waitron gives the accountant a VAT report for each quarter. Once a quarter's return has been filed, its report never changes, so a later correction cannot simply be added to it. Instead, any correction that affects an already-filed quarter goes on a separate corrections report, which shows, for each such quarter and each VAT rate, how much the taxable base and the VAT go up or down. The accountant uses it to correct those returns.

  In the example, the error is found in May. The ticket was counted in the second quarter, because it was dated 1 April, but the sale belongs to the first. The second quarter's return has not been filed yet, so its report simply stops counting the ticket. The first quarter's return was filed on 20 April, so the corrections report shows the ticket's base and VAT as an increase for the first quarter, and the accountant files a complementary return for it (LGT art. 122).

  *Is that right? And if the error is found only after the second quarter's return has also been filed, how should the accountant recover the VAT declared there: in the current return, or by asking for the second quarter's return to be corrected (LGT art. 120.3)?*
- **The customer.** A ticket names no customer, so the venue keeps the corrective and gives it only to a customer it knows, as you said (1.7) for a card refund made without the customer present. *Since a date correction changes nothing the customer paid, is there any risk in not delivering it?*
- **AEAT.** We report nothing beyond the corrective's own record, because we found no duty or channel to report a clock fault. *Is that right?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- Wrong time, right day: "yes probably, tbc"
- Wrong day: "always use a separate series for correctives"
- VAT: "yes"; and for an error found after the second quarter's return is also filed: "any correctives to the previous quarter should be reported in the correctives report."
- The customer: "no"
- AEAT: "yes"

**9. The software declaration**

For each version of the software, its producer signs a declaración responsable (Orden HAC/1177/2024 art. 15). We have not signed one yet.

- **Item d), what the system consists of.** It asks for the system's hardware and software components, «junto con una breve descripción de lo que hace dicho sistema informático y de sus principales funcionalidades». Our draft describes only the parts involved in invoicing:

  > Waitron is point-of-sale software for restaurants and bars. It runs on a server (a computer at the establishment) with Linux and Docker, and the establishment's terminals (tills, order-taking handsets, kitchen screens and the management dashboard) connect to it over the network through a web browser.
  >
  > Hardware: Waitron includes no hardware of its own; it runs on any computer that meets the above.
  >
  > Software: the Waitron server, which generates, chains, keeps and sends the invoicing records; the @waitron/verifactu library (version 0.2.1), which builds each record, its hash and the content of the QR code, and sends it, and which has its own declaración responsable; the terminal applications, which ask the server for invoices and display them, and generate no invoicing records; the print agent, which sends the documents the server prepares to the establishment's printers, and generates no invoicing records; and the third-party components we take responsibility for: Node.js, SQLite, Litestream, Linux and Docker (the full list is shown in the system itself).
  >
  > Each installation handles the invoicing of a single taxpayer and applies a single compliance mode, set by the installed country package; this version works only as VERI\*FACTU.
  >
  > Main functions: taking orders by table or at the bar, payment in cash and by card, issuing simplified and full invoices, corrective invoices, looking up issued invoices, and sales reports.

  Waitron also does a good deal that has nothing to do with invoicing, such as table bookings and staff working-time records. A later version will add a standby server: a second computer that takes over if the main server fails, and then files records under a new installation number. *Is it enough to describe the invoicing parts, or must item d) cover every function? When a version adds a standby server, must its declaration describe it?*
- **Item f), several taxpayers.** It asks whether the system «permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la facturación de varios obligados tributarios». We answer N: each venue has its own installation, database and certificate, on its own server or in Waitron Cloud. We read item f) as asking about one installation, not about the product being sold to many businesses. The VERI\*FACTU library Waitron uses has its own declaration, which answers S, because another program using it could invoice for several taxpayers. *Is N right for Waitron? In Waitron Cloud, Waitron runs a separate installation for each venue: does that make Waitron «un mismo usuario» supporting several taxpayers, so that the answer must be S?*
- **A venue that moves.** A venue that moves between its own server and Waitron Cloud keeps Waitron's system code, gets a new installation number, and needs no new declaration. *Is that right?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- Item d): "tbc".
- Item f): "i think because we're using a cert for each user, it should be N. we're not using our cert to report on many users (which would be S). tbc"
- A venue that moves: "why would this need a new declaration? anyway, the declaration is in the software, no? so they'd get the waitron cloud version."

**10. Keeping records and giving the tax office access**

- **Access without the internet.** Invoices kept electronically must be accessible online to the tax authorities (RD 1619/2012 arts. 21.2 and 23). A venue's server usually sits in the restaurant, on a private network with no public address. We take the rule to be met if, when the tax office asks, the venue can let it see, search, copy or download, and print every invoice without unjustified delay, with no permanent connection needed (Orden EHA/962/2007 art. 5.3; DGT 0289-04). If the request comes from AEAT's own office, a copy of the period on a USB drive or through a temporary download link will do. *Is that right?*
- **What a copy looks like.** Waitron has a sign-in for an inspector. Its Invoices page downloads each invoice as a PDF marked «DUPLICADO», laid out like the printed ticket or the A4 invoice, with the issuer, lines, totals and QR code of the sale as issued, but today's header text and logo. A cancelled or replaced ticket carries no mark on the copy: the list shows it as cancelled, or shows the full invoice that replaced it. *Is it acceptable for the copy to carry today's header and logo? Should the copy itself say "Cancelled on [date]" or "Replaced by invoice [number]"?*
- **What a restaurant company keeps.** We plan to keep, for six years: invoices issued, tickets included, and invoices received (RD 1619/2012 art. 19.1); books, correspondence and business papers (Código de Comercio art. 30.1); other evidence for its taxes (LGT art. 29.2.e); records of payments and refunds; the software declaration of every version used; proof of payment for sales of €1,000 or more, which the law asks to be kept five years (Ley 7/2012 art. 7.Uno.4); and pro formas that never became invoices. *Is anything missing?*
- **Records AEAT never received.** A record still waiting to be sent, or one AEAT refused, never reaches AEAT, so the restaurant's copy is the only one. We keep it, with AEAT's reply, until it is settled, and then for the same six years. *Is that right?*
- **Rebuilding invoices after a restore.** You said (1.16) that if the server is restored from an old backup, the venue should retrieve the missing invoices' records from AEAT's query service to rebuild its copies. AEAT's reply gives each record's number, date, description, customer where there is one, VAT breakdown and totals, but not the dishes. *Is a copy rebuilt from that acceptable, or must the venue keep the full invoice some other way, such as a continuous backup copy?*

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- Access without the internet: "yes"
- What a copy looks like: today's header and logo: "probably, tbc"; whether the copy says it was cancelled or replaced: "no"
- What a restaurant company keeps: "tbc. some things need to be kept for 10 years"
- Records AEAT never received: "we can keep them"
- Rebuilding invoices after a restore: "if the data is gone, how would we rebuild? the important thing is to record all issues eg hardware issues, being hacked, data loss, etc, so that we can explain what happened"

Open: which records need ten years.

**11. Two questions from October, and other advisers**

- **A change of legal name (S18).** Every record sent to AEAT carries the business's legal name. For example, a ticket is issued on Friday under the old name, Bar Pepe SL. The internet is down, so its record is only sent on Monday, by which time the company has become Pepe Restauración SL, with the same tax number, and AEAT's register already shows the new name. *Should the record carry the old name, as printed on the ticket, or the new one AEAT now holds? And if that Friday ticket is cancelled on Tuesday, which name does the cancellation carry?*
- **Holding back the records behind a stuck one (S19).** Each record includes a fingerprint of the one before it, so the records form a chain. Sometimes Waitron cannot tell whether AEAT received a record, because the connection dropped before AEAT answered, or AEAT keeps refusing it. Waitron then stops sending the records that follow, retries the stuck one every hour, and sends the rest once it goes through. For example, record 41 is sent at 21:00 and the connection drops before AEAT answers. Records 42 to 50 wait until record 41 is confirmed at 22:00. The rules say no record may be left unsent («no pueden quedar RF generados sin remitir a la AEAT», developer FAQ §5) and that sending must be retried at least every hour (Orden art. 16.4), and AEAT's own test service accepted records chained to one it had refused. *May we hold records 42 to 50 back until record 41 goes through, or must we send them straight away? If we may hold them, for how long?*
- **Questions outside tax.** *Whom do you recommend for each of these, and can you answer any of them yourself?*
  - **Legal metrology (S17, selling by weight).** A certified scale weighs the goods and either sends the weight, price per kilo and total to the till, or staff type the weight in. Does that meet the rules, does our software need certification, and who signs the declaration of conformity?
  - **Labour and payroll.** Overtime under a yearly total of hours; a person's time record when a server is replaced; tips on the payslip; sharing tips when nothing has been agreed; what Waitron gives the payroll office; how long absences and rotas are kept.
  - **Privacy.** Keeping allergy notes after the meal as evidence, and the legal basis for them during it; what to delete early; deleted data left in backups; what assessment a single restaurant needs; a former employee's details; data the law requires us to keep; Waitron's own role for bug reports; recording what staff do at the till; collecting a customer's details for an invoice.

**The owner's answers, 18 November 2026** (quoted as written; the adviser will come back with more details):

- A change of legal name (S18): "not an issue. the name doesn't matter"
- Holding back records (S19): "we should ask on the AEAT developer's channel, but given that they already accept invoices 2-999 when invoice 1 in the chain has been rejected, it seems that we don't need to hold anything back."
- Questions outside tax: no answer yet.

**12. Part payments during a meal, a company's advance worth more than its meal, a kept deposit's VAT, and the eat-in rate** (added 19 November, following the owner's decisions on questions 1, 4 and 6)

- **Part payments during the meal: confirming the owner's reading.** Your answer 1.3, as we recorded it, says that money paid before the table has been fully served is an advance payment, with a ticket of its own when received, when what it pays for is clearly identified. The owner reads this as covering money paid before the meal begins, such as a booking's deposit or a company paying before the day. Once the meal has begun, the guests may make several payments towards the final bill, and a payment gets its own ticket only if the payer wants one: in the owner's words, "there's no difference between Ana paying 30€ at the end and Ana paying 30€ and leaving an hour before the meal ends". When Ana does want one, she gets a ticket or a full invoice of its own for €30, «Pago a cuenta — consumo en mesa 7», at 10%, and the table's own ticket covers the rest only. We also read your answer 1.8, that a deposit that identifies nothing is not an advance, as describing a deposit that can be spent on anything at any time, like a voucher, not money paid towards this meal. *Can you confirm both readings?*
- **A company's advance worth more than its meal.** A company pays €1,000 (€909.09 plus €90.91 VAT, invoiced to it) for a dinner that comes to €800. As agreed with the company, the venue gives back €200, records the €200 as a tip, or keeps it as the agreed price. For a tip, we plan a corrective taking €200 off the advance's invoice (−€181.82, −€18.18), giving nothing back. For the agreed price, the advance's invoice stands and the final invoice takes off only the €800 the meal came to, so VAT stays declared on the whole €1,000. *Is each of those right? May an amount paid as an agreed advance become a tip outside VAT, when the customer did not leave it freely (question 7)?*
- **The VAT on a kept deposit.** After a no-show, we plan a corrective taking the €40 deposit's ticket to zero (−€36.36, −€3.64), as the owner has decided, and the venue keeps the €40 as compensation. The customer could ask for the €3.64 back, but often the venue does not know who the customer is, or the customer never asks. *May the venue keep the €3.64 when nobody reclaims it? Must it do anything else with it?* Waitron will show the kept deposit and the €3.64 to the accountant.
- **The rest of the bill's invoice.** In the example above, the table's own ticket at the end lists the dishes at their prices (€120), then takes off Ana's advance by its number, date and amount («Pago a cuenta n.º A/12, 19/11/2026», −€30.00), then comes to the €90 left, with the VAT table of what is left (10%: €81.82 base, €8.18 VAT). The owner chose this because the ticket must list what was ordered, so it has to name the advance to balance. Ana's own ticket shows her advance's base and VAT (€27.27 and €2.73); the table's ticket does not repeat them under the advance. We plan that the record sent to AEAT for the table's ticket carries only what is left, rate by rate (10%: €81.82 base, €8.18 VAT, total €90), as your answer 1.8 describes; the record has no field for the dishes or for the advance. *Is this the right way to show the advance on the table's ticket and on a full invoice? Are the advance's number, date and amount enough there, or must its base and VAT appear as well? Is its record right to carry only what is left?*
- **Rounding between the advance and the rest.** Waitron works out each dish's amount before VAT and rounds it to the cent, so a ticket's VAT is not always exactly its base times the rate. For the table's record we take off the advance's own base and VAT, so that the two tickets together declare exactly what one ticket for the whole meal would. For example, seven dishes at €1.05 with 10% VAT (€0.95 base and €0.10 VAT each, so €6.65 and €0.70 for the meal, €7.35 in all) and a €3.00 advance (€2.73 and €0.27): the table's record carries €3.92 and €0.43 (€4.35), and with the advance that makes €6.65 and €0.70, as for the whole meal. Worked out on its own, €4.35 would be €3.95 and €0.40, and the two tickets would declare €0.67 of VAT instead of €0.70. The two ways differ like this, by a few cents, in four to seven bills in ten in our tests. Where taking off the advance's figures would leave a VAT of €0.00 or of the opposite sign to the base, which AEAT refuses (in our tests only when less than €0.40 is left at that rate), we work out what is left on its own instead: a €30.05 meal and a €30.00 advance leave €0.04 base and €0.01 VAT. *Is taking off the advance's own base and VAT right? Is a VAT a few cents away from base times rate acceptable on the table's record, as it already is on a meal's own ticket today (€6.65 × 10% = €0.67, declared €0.70)?*
- **A ticket and a full invoice on one bill.** Each payer chooses a ticket or a full invoice: Luis may take a full invoice to his company for his €300 advance while the table's own invoice is a ticket, or the reverse. *May a full invoice take off an advance invoiced as a ticket, and may a ticket take off an advance invoiced as a full invoice?* We will build it as allowed and add a refusal if you say no.
- **A negative line at one rate.** Each advance is charged at 10%, as the owner has confirmed. A bill of €20 of food at 10% and €80 of wine at 21%, with a €50 advance at 10%, leaves a record for the rest with a negative 10% line (−€27.27 base, −€2.73 VAT) beside a positive 21% line (€66.12, €13.88), total €50. Waitron's copy of AEAT's checks accepts it, and we will send one to AEAT's test service before building on it. *May a record carry a negative line at one rate beside a positive line at another? Or may an advance paid during the meal instead be charged at the mix of VAT rates on the bill so far, so that this never happens?*
- **The eat-in rate.** *Is all dine-in consumption, drinks included, at 10%, with product rates applying only to takeaway?*

**13. Money given back after the table's ticket has taken off a part payment** (added 21 November, following the owner's decision on question 6 and the part payments of question 12)

- **Giving back more than the table's ticket holds.** A company pays €100 ahead, with its own ticket, A/12: €90.91 plus €9.09 VAT at 10%. The dinner comes to €120, so the table's ticket, A/45, lists the dishes, takes off A/12 (−€100.00) and comes to the €20 left (€18.18 plus €1.82 VAT). The venue then agrees to give €30 back. We plan two steps. First, a corrective of A/45 gives back the €20 paid on it, at the dishes' own VAT rates, and is filed with AEAT. Second, the €10 left over comes from the part payment, whose ticket cannot be corrected once A/45 has taken it off: staff give it back as a refund of the payment on A/12, and nothing is filed for it. Its VAT, €0.91 at 10% (€9.09 base), stays declared, and the accountant's export lists the refund with that VAT. This is the owner's choice: "let's use refund a payment, but add this approach to the adviser's list for confirmation". Waitron will refuse the refund on A/12 while A/45 still holds money its corrective could give back, so the corrective comes first; the amount given back on A/12 is the one staff enter, since Waitron cannot know how much is owed back. *Is this acceptable? If not, what must the venue issue or file for the €10, and may it leave the €0.91 declared for its accountant to deal with?*

## Part 2: Español

**1. Cuándo se expide el tique de la mesa** (a partir de sus respuestas 1.1, 1.3, 1.4 y 1.8)

Nos indicó que el tique de una comida se expide al terminar la comida, aunque la cuenta no esté pagada del todo, y que lo pagado antes es un pago anticipado, con su propio tique, si lo que se paga está claramente identificado.

- **La comida termina cuando el personal imprime la cuenta.** El tique se expide en ese momento, por todo lo que figura en la cuenta, y los clientes pagan con él, en uno o varios pagos. *¿Es imprimir la cuenta el momento adecuado, y no servir el último plato ni cobrar el último pago?*
- **Una cuenta que nunca se imprime** se expide cuando se paga del todo, cuando el personal registra que los clientes se han marchado sin pagar, o al terminar la jornada comercial del local, lo que ocurra primero. Cada local fija el fin de su jornada a una hora en que está cerrado, por ejemplo las 05:00. Un tique expedido antes de pagarse indica el importe pendiente. *¿Es aceptable?*
- **Lo pagado a cuenta antes de terminar la comida, sin indicar platos,** no es un anticipo y no lleva tique propio. Por ejemplo, a las 21:30 Ana paga 30 € «a cuenta» de la cuenta de una mesa de cuatro y se marcha, y los demás pagan el resto a las 23:00. Waitron anota los 30 € en la cuenta, y el tique expedido al final recoge todo lo servido e indica los 30 € como ya pagados. Lo mismo vale para un grupo que deja 1.000 € a cuenta de su consumo al empezar la noche. Lo deducimos de su respuesta 1.8, según la cual una señal que no identifica nada no es un anticipo. En cambio, una empresa que paga 1.000 € por su cena del día 14, para 40 comensales con menú cerrado, ha identificado lo que paga: es un anticipo, con su propio tique, que el tique final descuenta. *¿Lo hemos entendido bien, o lo pagado a cuenta de la comida de esta mesa ya está «claramente identificado»? Si es un anticipo, ¿qué debe describir su tique cuando no indica platos, por ejemplo «pago a cuenta de la comida de la mesa 7», al 10 %?*

Nota: ____

**2. Después de expedido el tique de la mesa** (a partir de sus respuestas 1.2, 1.7, 2.1 y 2.2)

Como el tique puede expedirse antes de pagarse, Waitron imprime en cada tique los pagos hechos hasta ese momento, con la marca y las cuatro últimas cifras de cada tarjeta, y el importe pendiente, si lo hay.

- **Un pago posterior al tique** imprime un justificante de pago, sin número de factura, código QR ni importe pendiente. Nos confirmó (2.2) que un justificante así, impreso junto al tique, no es una factura. *¿Sigue sin serlo si se imprime horas o días después del tique? ¿Puede indicar el número del tique que paga?*
- **Una reimpresión del tique** lleva «DUPLICADO» y el mismo número, las mismas líneas, los mismos importes y el mismo código QR, además de los pagos hechos desde el original. Por ejemplo, un tique de 60,00 € impreso a las 22:00 indica «Pendiente: 60,00 €». El cliente paga con tarjeta a la mañana siguiente y pide un tique en el que conste el pago, y el personal lo reimprime con «Visa \*\*\*\*4034 60,00 €» y sin importe pendiente. El personal puede reimprimir en cualquier momento, pero el art. 14 del RD 1619/2012 solo admite duplicados en caso de varios destinatarios de una misma operación o de «pérdida del original». *¿Puede imprimirse un duplicado siempre que el cliente lo pida, y puede mostrar pagos posteriores al original? Si solo cabe por pérdida del original, ¿debe el personal registrar ese motivo?*
- **Comensales que dividen la cuenta después de imprimirla.** Imprimir la cuenta expide el tique de la mesa, de modo que, si los comensales deciden después pagar cada uno lo suyo, hay que deshacer el tique de la mesa y dar a cada comensal su propio tique. Proponemos una factura rectificativa (R5) que deja a cero el tique de la mesa y, después, un tique nuevo para cada comensal. Nos indicó (1.7) que el registro de anulación es para una factura expedida por error, por una operación que no llegó a producirse, y aquí la operación sí se produjo. *¿Es correcta la rectificativa, o se trata de una anulación, ya que el tique de la mesa se sustituyó antes de que nadie lo pagara?*
- **Sin precuenta.** Nos confirmó (1.2) que se admite una precuenta, impresa para que la mesa la revise antes de pagar, si se conserva vinculada al tique posterior. Hemos dejado de lado la precuenta: imprimir la cuenta expide el tique, y una mesa que divide la cuenta después se resuelve con una rectificativa, como se indica arriba. Las divisiones después de imprimir serán frecuentes, por lo que habrá muchas rectificativas. *¿Es aceptable, o deberíamos imprimir primero una precuenta y expedir el tique solo cuando la mesa haya decidido cómo pagar?*

Nota: ____

**3. El cliente que no quiere el tique** (a partir de su respuesta 1.11)

Nos indicó que el cliente no puede renunciar al tique, y que enviarlo por correo electrónico exige su consentimiento, que puede ser tácito. El personal pregunta «¿en papel o por correo?». Un tique impreso y dejado con la cuenta se considera entregado, aunque el cliente lo deje en la mesa. Para el correo, la caja muestra al cliente «Le enviaremos el tique a esta dirección. Puede pedir una copia en papel en cualquier momento», y el envío del correo se considera entrega. Waitron mantiene además la opción «Ninguno» para el cliente que no quiere ni una cosa ni otra, porque la mayoría de los clientes no quiere el tique e imprimirlos todos malgasta papel.

*Si el personal elige «Ninguno», ¿qué riesgo asume el local?*

Nota: ____

**4. Menús** (a partir de su respuesta 1.10)

Un menú tiene un precio único. Los platos que incluye se envían a cocina a 0,00 €. Un plato puede llevar un suplemento, y un plato incluido puede tener un extra de pago.

- **Qué detalla el tique.** El tique y la factura completa detallan cada menú con su precio, y todos los suplementos y extras de pago, pero no los platos incluidos sin nada que pagar. Por ejemplo, un menú de 14,00 € al 10 % incluye sopa, solomillo y una copa de vino. El solomillo lleva un suplemento de 5,00 € y la sopa una ración de pan de 1,50 €. El tique muestra el menú 14,00, Solomillo +5,00 y Sopa con Pan 1,50: 20,50 € en total. El vino no se detalla. El tique exige «La identificación del tipo de bienes entregados o de servicios prestados» (RD 1619/2012, art. 7.1.e), y la factura completa la «Descripción de las operaciones, consignándose todos los datos necesarios para la determinación de la base imponible» (art. 6.1.f). *¿Pueden omitirse los platos incluidos en el tique? ¿Pueden omitirse en la factura completa, o deben detallarse en ella, quizá sin precio?*
- **Reparto del precio entre tipos de IVA.** Cada producto incluido en un menú tiene su propio tipo de IVA (pregunta 5). Cuando los productos de un menú tienen tipos distintos, repartimos el precio del menú entre ellos en proporción al precio de cada uno vendido por separado, como hace su respuesta 1.10 con un artículo gratuito (LIVA art. 79.Dos). Hoy eso solo ocurre con un menú para llevar, porque todo lo que se consume en el local, bebidas incluidas, es servicio de restauración al 10 % (LIVA art. 91.Uno.2.2.º). Para llevar, el menú es una entrega de bienes y cada parte tributa a su tipo (LIVA art. 91.Uno.1.1.º; DGT V2949-16). Por ejemplo, un menú para llevar de 12,00 € incluye una hamburguesa que se vende por 9,50 € (comida, 10 %) y un refresco que se vende por 3,00 € (refresco azucarado, 21 %). El menú se reparte en 9,12 € al 10 % y 2,88 € al 21 %. *¿Es correcto? ¿Debe el reparto seguir exactamente los precios por separado, o basta una estimación razonable? Si el cliente prescinde del refresco y paga igualmente 12,00 €, ¿es todo comida al 10 %?*

Nota: ____

**5. Tipos de IVA por producto, y un tipo erróneo descubierto después** (a partir de sus respuestas 1.4 y 1.13)

- **Dos tipos por producto.** Cada producto guarda un historial con fechas de dos tipos de IVA, uno para consumir en el local y otro para llevar, elegidos entre los tipos que admite la AEAT (0, 2, 4, 5, 7,5, 10 y 21). Un cambio puede programarse con antelación, por ejemplo desde el 1 de abril. La factura aplica los tipos de cada producto del día en que termina la comida (LIVA art. 90.Dos; su respuesta 1.4), de modo que una cena que termina pasada la medianoche del 1 de abril lleva los tipos del 1 de abril. Una señal conserva el tipo del día en que se pagó. *¿Es correcto?*
- **Para tomar aquí o para llevar, en la barra.** En la barra de un local que también tiene mesas, el personal cobra un refresco para tomar aquí (10 %), y el cliente se lo lleva. *¿Se mantiene el 10 %? Si el cliente no dice nada, ¿puede cobrarse como para tomar aquí?*
- **Un tipo demasiado bajo, descubierto después.** El producto se corrige («debió ser el 21 % desde el 1 de febrero») sin reescribir lo cobrado: los tiques de los clientes no cambian y no se remite nada a la AEAT. Para cada trimestre anterior, Waitron calcula el IVA debido considerando que el precio cobrado incluía el tipo correcto (su respuesta 1.13), y lo incluye en el informe de correcciones descrito en la pregunta 8, para que el gestor lo presente en una autoliquidación complementaria. Por ejemplo, 200 botellas de vino para llevar vendidas a 8,00 € en el primer trimestre, al 10 % en lugar del 21 %: 1.600 € × 21/121 − 1.600 € × 10/110 = 277,69 € − 145,45 € = 132,24 € a ingresar. *¿Es correcto? ¿La diferencia se calcula por línea de factura, por factura o sobre el total del trimestre para el producto? El redondeo da importes algo distintos.*
- **Un tipo demasiado alto.** Por ejemplo, el 21 % cobrado cuando correspondía el 10 %, de modo que el local ingresó IVA de más. Si regulariza en la autoliquidación en curso, el art. 89.Cinco.b LIVA dispone que «estará obligado a reintegrar al destinatario de la operación el importe de las cuotas repercutidas en exceso», lo que no puede hacer con un tique sin destinatario identificado. *¿Debe entonces solicitar la rectificación de la autoliquidación anterior (art. 120.3 LGT), o dejar el IVA como se declaró?*

Nota: ____

**6. Una mesa invitada, una señal retenida, una devolución de cortesía** (a partir de sus respuestas 1.5, 1.8 y 1.10)

- **Una mesa invitada.** Nos indicó que el tratamiento sin riesgo es el autoconsumo valorado a coste, con factura y registro (DGT V2347-24; LIVA art. 79.Cuatro). Por ejemplo, el propietario invita a cuatro clientes habituales a una comida que en carta suma 160 € y cuya materia prima cuesta 48 €: 48 € de base y 4,80 € de cuota, que paga el local. *¿El coste es solo la materia prima, o también una parte del personal y de los gastos generales? Sin escandallos, ¿puede usarse un porcentaje estándar sobre el precio de carta, por ejemplo el 30 %? ¿Qué documento se expide, a quién (al propio local o a la mesa) y qué registro se remite a la AEAT? La comida que se da gratis a un empleado durante su turno, ¿es también autoconsumo a coste, o no está sujeta?*
- **Una señal retenida cuando el cliente no se presenta.** Una señal de 40 € por una reserva tiene su propio tique: 36,36 € de base y 3,64 € de cuota al 10 %. Los clientes no se presentan y el local retiene los 40 € como indemnización, que no está sujeta (DGT V0839-20). Pero, para minorar el IVA ya repercutido, el art. 89.Cinco.b LIVA exige reintegrar la cuota al cliente. *¿Expide el local una rectificativa que anule los 3,64 €, aunque no devuelve nada, o se mantiene el tique de la señal?*
- **Una devolución de cortesía.** Un cliente se queja después de pagar 62 € y el encargado le devuelve 10 €. Nos indicó (1.5) que una rebaja posterior al tique requiere, en su caso, una factura rectificativa (LIVA art. 80.Uno.2.º). *¿Es obligatoria aquí la rectificativa, o puede el local devolver el dinero sin ella y seguir declarando el IVA sobre los 62 €?*
- **Una devolución de cortesía en una cuenta con dos tipos de IVA** (añadida el 21 de noviembre). Si todo lo que se consume en el local tributa al 10 % (pregunta 12), esto solo ocurre en una cuenta para llevar, por ejemplo una botella de vino de 12,00 € (21 %) y un queso de 8,00 € (4 %). El cliente se queja y el encargado le devuelve 5,00 €. Proponemos repartir los 5,00 € entre la cuenta en proporción a los precios de carta, como hace su respuesta 1.10 con un producto gratuito: −3,00 € en el vino (−2,48 € de base, −0,52 € de cuota) y −2,00 € en el queso (−1,92 € de base, −0,08 € de cuota). *Si la rectificativa es obligatoria (punto anterior), ¿es correcto repartir por precio de carta, o debe indicar el local qué productos se rebajan? Y, para confirmar el punto anterior: ¿es obligatoria la rectificativa, o puede el local devolver el dinero sin ella, manteniendo declarado el IVA sobre el precio completo, y anotar la devolución para su gestor?*

Nota: ____

**7. Propinas**

Waitron puede ofrecer una propina al cobrar, y la deja fuera de la factura. El proveedor de pagos abona la propina al restaurante junto con el resto de la cuenta, y el restaurante la entrega al personal.

- **Porcentajes sugeridos.** El cliente ve opciones como sin propina, 5 %, 10 %, 15 % u otro importe, sin ninguna preseleccionada. Consideramos que la propina queda fuera del IVA. El criterio de las V1895-24, V5110-26 y V2182-23 es que «no se haya establecido una cuantía fija» y que el importe quede «a la libre determinación» de quien lo da, y una lista que el cliente puede ignorar no fija nada, porque la comida se debe con o sin propina. *¿Es correcto?*
- **Contabilización de las propinas de tarjeta.** Las propinas de tarjeta que se entregan al personal no son ingreso del restaurante. Son una deuda con el personal desde el día en que se cobran, que su pago en nómina cancela, de modo que no cuentan para la cifra de negocios (el Plan General de Contabilidad excluye de los ingresos «las cantidades recibidas por cuenta de terceros», norma de registro y valoración 14.ª; la consulta 2174-03 califica a la empresa de «mero intermediario»). Solo vale si el derecho a las propinas es del personal y no de la empresa. *¿Es correcto?*
- **Quién retiene el IRPF de una propina.** Depende de quién paga al trabajador (LIRPF art. 99.2; RIRPF art. 76.1; consulta 2174-03). Las propinas de tarjeta, y las propinas en efectivo que se dejan en la caja y se reparten al cierre, las paga el empleador, de modo que van en nómina con retención. El efectivo que se entrega directamente al camarero y este conserva, o un bote que gestiona el personal sin intervención de la empresa, lo paga el cliente: no hay retención, y el camarero lo declara. *¿Es correcto?*
- **Cotización de las propinas de tarjeta.** Entendemos que las propinas de tarjeta abonadas en nómina cotizan a la Seguridad Social, comunicadas como retribución ordinaria (código 0001), porque la TGSS no tiene código para propinas ni forma de comunicar una como excluida. La STS 692/2021 incluyó en la base de cotización las propinas de un casino, pero dijo que las de hostelería son distintas. *¿Es correcto, o es una cuestión para un asesor laboral?*

Nota: ____

**8. Cuando el reloj del servidor iba mal**

Cada registro remitido a la AEAT lleva la hora en que se generó, pero la factura indica solo la fecha. Cuando se descubre que el reloj del servidor iba mal y se corrige, proponemos lo siguiente.

- **Hora errónea, día correcto.** Por ejemplo, una venta de las 20:50 se fecha a las 21:10, o la factura 5 lleva una hora anterior a la de la factura 4 porque el reloj se atrasó. No corregimos nada y guardamos constancia del incidente. El art. 7.i de la Orden HAC/1177/2024, que exige el orden temporal de los registros, no se aplica a VERI\*FACTU (art. 3). *¿Es correcto? El caso 2.b del apartado 17 de las FAQ para desarrolladores pide un registro de subsanación para un error en un campo interno de un registro. ¿Incluye eso una hora errónea?*
- **Día erróneo.** Por ejemplo, una comida del 31 de marzo se fecha el 1 de abril. Expedimos una factura rectificativa que indica la fecha real y no cambia ningún importe (DGT V1665-22). Como toda rectificativa de tique, va en una serie propia, distinta de la de los tiques: las V1665-22, V0902-22, V1924-23 y V2611-24 dicen que la rectificativa de una fecha de expedición errónea «deberá constar en serie específica de factura», aunque la V2884-16 permitiría incluir las rectificativas de tiques en la serie de tiques. *¿Es correcto?*
- **IVA.** Waitron entrega al gestor un informe de IVA por trimestre. Una vez presentada la autoliquidación de un trimestre, su informe ya no cambia, de modo que una corrección posterior no puede añadirse sin más. En su lugar, toda corrección que afecte a un trimestre ya presentado figura en un informe de correcciones aparte, que muestra, para cada uno de esos trimestres y cada tipo de IVA, cuánto suben o bajan la base imponible y la cuota. El gestor lo utiliza para corregir esas autoliquidaciones.

  En el ejemplo, el error se descubre en mayo. El tique se contó en el segundo trimestre, porque estaba fechado el 1 de abril, pero la venta pertenece al primero. La autoliquidación del segundo trimestre aún no se ha presentado, así que su informe simplemente deja de contar el tique. La del primer trimestre se presentó el 20 de abril, así que el informe de correcciones muestra la base y la cuota del tique como un aumento del primer trimestre, y el gestor presenta una autoliquidación complementaria (LGT art. 122).

  *¿Es correcto? Y si el error se descubre cuando ya se ha presentado también la autoliquidación del segundo trimestre, ¿cómo debe recuperar el gestor el IVA declarado en ella: en la autoliquidación en curso, o solicitando la rectificación de la del segundo trimestre (LGT art. 120.3)?*
- **El cliente.** El tique no identifica al cliente, de modo que el local conserva la rectificativa y solo la entrega a un cliente que conozca, como nos indicó (1.7) para una devolución con tarjeta sin el cliente presente. *Como una corrección de fecha no cambia nada de lo que pagó el cliente, ¿supone algún riesgo no entregarla?*
- **La AEAT.** No comunicamos nada más allá del propio registro de la rectificativa, porque no encontramos ni obligación ni cauce para comunicar un incidente de reloj. *¿Es correcto?*

Nota: ____

**9. La declaración responsable**

Para cada versión del software, el productor firma una declaración responsable (Orden HAC/1177/2024, art. 15). Aún no hemos firmado ninguna.

- **Apartado d), componentes del sistema.** Pide los componentes, hardware y software, del sistema, «junto con una breve descripción de lo que hace dicho sistema informático y de sus principales funcionalidades». Nuestro borrador describe solo las partes que intervienen en la facturación:

  > Waitron es un software de punto de venta para restaurantes y bares. Se ejecuta en un servidor —un equipo del propio establecimiento— con Linux y Docker, y los terminales del establecimiento (cajas, comanderos, pantallas de cocina y el panel de gestión) se conectan a él por la red mediante un navegador.
  >
  > Hardware: Waitron no incluye hardware propio; funciona en cualquier ordenador que cumpla lo anterior.
  >
  > Software: el servidor Waitron, que genera, encadena, conserva y remite los registros de facturación; la biblioteca @waitron/verifactu (versión 0.2.1), que construye cada registro, su huella y el contenido del código QR, y lo remite, y que cuenta con su propia declaración responsable; las aplicaciones de los terminales, que solicitan al servidor las facturas y las muestran, y no generan registros de facturación; el agente de impresión, que envía a las impresoras del establecimiento los documentos que prepara el servidor y no genera registros de facturación; y los componentes de terceros de los que nos hacemos responsables: Node.js, SQLite, Litestream, Linux y Docker (la lista completa se muestra en el propio sistema).
  >
  > Cada instalación lleva la facturación de un único obligado tributario y aplica una única modalidad de cumplimiento, determinada por el paquete de país instalado; esta versión solo funciona como VERI\*FACTU.
  >
  > Principales funcionalidades: toma de pedidos por mesa o en barra, cobro en efectivo y con tarjeta, expedición de facturas simplificadas y completas, facturas rectificativas, consulta de las facturas emitidas e informes de ventas.

  Waitron hace además muchas cosas que nada tienen que ver con la facturación, como las reservas de mesa y el registro de jornada del personal. Una versión posterior añadirá un servidor de reserva: un segundo equipo que asume el servicio si falla el principal, y que entonces remite los registros con un nuevo número de instalación. *¿Basta con describir las partes de facturación, o debe el apartado d) recoger todas las funciones? Cuando una versión añada un servidor de reserva, ¿debe describirlo su declaración?*
- **Apartado f), varios obligados tributarios.** Pregunta si el sistema «permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la facturación de varios obligados tributarios». Respondemos N: cada local tiene su propia instalación, base de datos y certificado, en su propio equipo o en Waitron Cloud. Entendemos que el apartado f) se refiere a una instalación, no a que el producto se venda a muchos negocios. La biblioteca VERI\*FACTU que usa Waitron tiene declaración propia, que responde S, porque otro programa que la use puede facturar por varios obligados. *¿Es correcta la N para Waitron? En Waitron Cloud, Waitron gestiona una instalación distinta para cada local: ¿convierte eso a Waitron en «un mismo usuario» que da soporte a varios obligados, de modo que la respuesta deba ser S?*
- **Un local que cambia de servidor.** Un local que pasa de su propio equipo a Waitron Cloud, o al revés, conserva el código de sistema de Waitron, recibe un nuevo número de instalación y no necesita nueva declaración. *¿Es correcto?*

Nota: ____

**10. Conservación y acceso de la Administración**

- **Acceso sin internet.** Las facturas conservadas por medios electrónicos deben permitir el acceso en línea de la Administración (RD 1619/2012, arts. 21.2 y 23). El servidor de un local suele estar en el propio restaurante, en una red privada y sin dirección pública. Entendemos que se cumple si, cuando la Administración lo pide, el local permite sin demora injustificada consultar, buscar, copiar o descargar e imprimir todas las facturas, sin necesidad de conexión permanente (Orden EHA/962/2007, art. 5.3; DGT 0289-04). Si la AEAT lo pide desde su propia oficina, basta una copia del periodo en USB o mediante un enlace temporal de descarga. *¿Es correcto?*
- **Cómo es una copia.** Waitron tiene un acceso para el inspector. Su página de Facturas descarga cada factura como un PDF con la marca «DUPLICADO», con la misma disposición que el tique impreso o la factura en A4, y con el emisor, las líneas, los importes y el código QR de la venta tal como se expidió, pero con el texto de cabecera y el logotipo actuales. Un tique anulado o sustituido no lleva ninguna marca en la copia: la lista lo indica como anulado, o muestra la factura completa que lo sustituyó. *¿Es aceptable que la copia lleve la cabecera y el logotipo actuales? ¿Debería la propia copia indicar «Anulada el [fecha]» o «Sustituida por la factura [número]»?*
- **Qué conserva una sociedad de restauración.** Proponemos conservar, durante seis años: las facturas expedidas, tiques incluidos, y las recibidas (RD 1619/2012, art. 19.1); libros, correspondencia y documentación (Código de Comercio, art. 30.1); los demás justificantes tributarios (LGT art. 29.2.e); los registros de cobros y devoluciones; la declaración responsable de cada versión utilizada; los justificantes de pago de ventas de 1.000 € o más, que la ley pide conservar cinco años (Ley 7/2012, art. 7.Uno.4); y las proformas que no llegaron a factura. *¿Falta algo?*
- **Registros que la AEAT nunca recibió.** Un registro pendiente de envío, o uno rechazado, nunca llega a la AEAT: «no figuraría jamás en los sistemas de la AEAT (aunque constaría un rechazo)» (FAQ para desarrolladores), de modo que la copia del restaurante es la única. Lo conservamos, con la respuesta de la AEAT, hasta que se resuelva, y después durante los mismos seis años. *¿Es correcto?*
- **Reconstruir facturas tras una restauración.** Nos indicó (1.16) que, si el servidor se restaura desde una copia antigua, el local debe recuperar los registros de las facturas que faltan mediante el servicio de consulta de la AEAT para reconstruir sus copias. Según los documentos técnicos de la AEAT, la respuesta incluye de cada registro el número, la fecha, la descripción, el destinatario si lo hay, el desglose de IVA y los importes totales, pero no los platos. *¿Es aceptable una copia reconstruida así, o debe el local conservar la factura completa por otra vía, como su copia de seguridad continua?*

Nota: ____

**11. Dos preguntas de octubre, y otros asesores**

- **Cambio de razón social (S18).** Cada registro remitido a la AEAT lleva la razón social del negocio. Por ejemplo, un tique se expide el viernes con la razón social antigua, Bar Pepe SL. No hay conexión, así que su registro solo se remite el lunes, cuando la sociedad ya se llama Pepe Restauración SL, con el mismo NIF, y el censo de la AEAT ya recoge el nuevo nombre. *¿Debe el registro llevar el nombre antiguo, el que figura en el tique, o el nuevo que ya tiene la AEAT? Y si ese tique del viernes se anula el martes, ¿qué nombre lleva la anulación?*
- **Retener los registros posteriores a uno bloqueado (S19).** Cada registro lleva la huella del anterior, de modo que los registros forman una cadena. A veces Waitron no sabe si la AEAT recibió un registro, porque la conexión se cortó antes de la respuesta, o porque la AEAT lo rechaza una y otra vez. Waitron deja entonces de remitir los registros siguientes, reintenta cada hora el bloqueado y remite los demás cuando este pasa. Por ejemplo, el registro 41 se remite a las 21:00 y la conexión se corta antes de la respuesta de la AEAT. Los registros 42 a 50 esperan hasta que el 41 se confirma a las 22:00. La norma dice que «no pueden quedar RF generados sin remitir a la AEAT» (FAQ para desarrolladores, §5) y que hay que reintentar el envío al menos cada hora (Orden, art. 16.4), y el entorno de pruebas de la AEAT aceptó registros encadenados a uno que había rechazado. *¿Podemos retener los registros 42 a 50 hasta que pase el 41, o debemos remitirlos de inmediato? Si podemos retenerlos, ¿hasta cuándo?*
- **Preguntas fuera del ámbito fiscal.** *¿A quién nos recomienda para cada una, y puede responder usted alguna de ellas?*
  - **Metrología legal (S17, venta a peso).** Una balanza verificada pesa el producto y envía al TPV el peso, el precio por kilo y el importe, o el empleado teclea el peso. ¿Cumple la normativa, necesita nuestro software una certificación, y quién firma la declaración de conformidad?
  - **Laboral y nóminas.** Las horas extraordinarias con una jornada anual; el registro de jornada de una persona al sustituir el servidor; las propinas en la nómina; el reparto de propinas sin acuerdo; qué entrega Waitron a la gestoría; cuánto tiempo se conservan las ausencias y los cuadrantes.
  - **Protección de datos.** Conservar las anotaciones de alergias después de la comida como prueba, y la base jurídica para tratarlas durante ella; qué suprimir antes; los datos suprimidos que quedan en las copias de seguridad; qué evaluación necesita un solo restaurante; los datos de un antiguo empleado; los datos que la ley obliga a conservar; el papel de Waitron en los informes de errores; el registro de lo que hace el personal en la caja; la recogida de los datos del cliente para una factura.

Nota: ____

**12. Pagos parciales durante la comida, un anticipo de empresa superior a su comida, el IVA de una señal retenida y el tipo para consumir en el local** (añadida el 19 de noviembre, a partir de las decisiones del propietario sobre las preguntas 1, 4 y 6)

- **Pagos parciales durante la comida: confirmación de la interpretación del propietario.** Según su respuesta 1.3, tal como la anotamos, lo pagado antes de que la mesa haya sido servida del todo es un pago anticipado, con su propio tique al recibirse, siempre que lo pagado esté claramente identificado. El propietario lo interpreta como referido a lo pagado antes de que empiece la comida, por ejemplo la señal de una reserva o lo que paga una empresa antes del día. Una vez empezada la comida, los comensales pueden hacer varios pagos a cuenta del total final, y un pago lleva su propio tique solo si quien paga lo quiere: según el propietario, no hay diferencia entre que Ana pague 30 € al final y que pague 30 € y se marche una hora antes de que termine la comida. Si Ana lo quiere, recibe un tique o una factura completa propios por 30 €, «Pago a cuenta — consumo en mesa 7», al 10 %, y el tique de la mesa recoge solo el resto. Entendemos además que su respuesta 1.8, según la cual una señal que no identifica nada no es un anticipo, se refiere a una señal que puede gastarse en cualquier cosa y en cualquier momento, como un vale, y no a lo pagado a cuenta de esta comida. *¿Puede confirmar ambas interpretaciones?*
- **Un anticipo de empresa superior a su comida.** Una empresa paga 1.000 € (909,09 € de base y 90,91 € de cuota, facturados a su nombre) por una cena que suma 800 €. Según lo acordado con la empresa, el local devuelve 200 €, los anota como propina o los retiene como precio acordado. Para la propina, proponemos una rectificativa que descuenta 200 € de la factura del anticipo (−181,82 €, −18,18 €) sin devolver nada. Para el precio acordado, la factura del anticipo se mantiene y la factura final descuenta solo los 800 € de la comida, de modo que el IVA queda declarado sobre los 1.000 €. *¿Es correcto en cada caso? ¿Puede convertirse en propina no sujeta un importe pagado como anticipo acordado, cuando el cliente no la ha dejado libremente (pregunta 7)?*
- **El IVA de una señal retenida.** Si el cliente no se presenta, proponemos una rectificativa que deja a cero el tique de la señal de 40 € (−36,36 €, −3,64 €), como ha decidido el propietario, y el local retiene los 40 € como indemnización. El cliente podría pedir la devolución de los 3,64 €, pero a menudo el local no sabe quién es, o el cliente nunca la pide. *¿Puede el local quedarse los 3,64 € si nadie los reclama? ¿Debe hacer algo más con ellos?* Waitron mostrará al gestor la señal retenida y los 3,64 €.
- **El tique del resto de la cuenta.** En el ejemplo anterior, el tique de la mesa al final detalla los platos a sus precios (120 €), descuenta el anticipo de Ana con su número, fecha e importe («Pago a cuenta n.º A/12, 19/11/2026», −30,00 €) y termina en los 90 € restantes, con el cuadro de IVA de lo restante (10 %: 81,82 € de base, 8,18 € de cuota). El propietario lo prefiere así porque el tique debe recoger lo consumido, y para cuadrar tiene que mencionar el anticipo. El tique propio de Ana muestra la base y la cuota de su anticipo (27,27 € y 2,73 €); el tique de la mesa no las repite bajo el anticipo. Proponemos que el registro remitido a la AEAT por el tique de la mesa recoja solo lo restante, por tipo (10 %: 81,82 € de base, 8,18 € de cuota, 90 € en total), como describe su respuesta 1.8; el registro no tiene campo para los platos ni para el anticipo. *¿Es esta la forma correcta de mostrar el anticipo en el tique de la mesa y en una factura completa? ¿Basta con el número, la fecha y el importe del anticipo, o deben figurar también su base y su cuota? ¿Es correcto que su registro recoja solo lo restante?*
- **El redondeo entre el anticipo y el resto.** Waitron calcula la base de cada plato y la redondea al céntimo, por lo que la cuota de un tique no siempre es exactamente su base por el tipo. Para el registro de la mesa descontamos la base y la cuota propias del anticipo, de modo que los dos tiques juntos declaren exactamente lo mismo que un solo tique por toda la comida. Por ejemplo, siete platos a 1,05 € al 10 % (0,95 € de base y 0,10 € de cuota cada uno, es decir, 6,65 € y 0,70 € la comida, 7,35 € en total) y un anticipo de 3,00 € (2,73 € y 0,27 €): el registro de la mesa recoge 3,92 € y 0,43 € (4,35 €), y con el anticipo suman 6,65 € y 0,70 €, como la comida entera. Calculados por sí solos, 4,35 € serían 3,95 € y 0,40 €, y los dos tiques declararían 0,67 € de cuota en lugar de 0,70 €. En nuestras pruebas, las dos formas difieren así, en unos céntimos, en entre cuatro y siete de cada diez cuentas. Cuando descontar las cifras del anticipo dejaría una cuota de 0,00 € o de signo contrario a la base, que la AEAT rechaza (en nuestras pruebas, solo cuando quedan menos de 0,40 € en ese tipo), calculamos lo restante por sí solo: una comida de 30,05 € y un anticipo de 30,00 € dejan 0,04 € de base y 0,01 € de cuota. *¿Es correcto descontar la base y la cuota propias del anticipo? ¿Es aceptable en el registro de la mesa una cuota que se aparta unos céntimos de la base por el tipo, como ya ocurre hoy en el tique de una comida (6,65 € × 10 % = 0,67 €, declarado 0,70 €)?*
- **Un tique y una factura completa en una misma cuenta.** Cada pagador elige tique o factura completa: Luis puede pedir una factura completa a nombre de su empresa por su anticipo de 300 € mientras la cuenta de la mesa se cierra con un tique, o al revés. *¿Puede una factura completa descontar un anticipo documentado con tique, y un tique descontar un anticipo documentado con factura completa?* Lo construiremos permitiéndolo y añadiremos un rechazo si nos dice que no.
- **Una línea negativa en un tipo.** Cada anticipo se cobra al 10 %, como ha confirmado el propietario. Una cuenta de 20 € de comida al 10 % y 80 € de vino al 21 %, con un anticipo de 50 € al 10 %, deja para el resto un registro con una línea negativa al 10 % (−27,27 € de base, −2,73 € de cuota) junto a una positiva al 21 % (66,12 €, 13,88 €), 50 € en total. La copia que tiene Waitron de las validaciones de la AEAT lo acepta, y remitiremos uno al entorno de pruebas de la AEAT antes de construir sobre ello. *¿Puede un registro llevar una línea negativa en un tipo junto a una positiva en otro? ¿O puede cobrarse un anticipo hecho durante la comida al reparto de tipos de IVA de la cuenta hasta ese momento, para que esto no ocurra nunca?*
- **El tipo para consumir en el local.** *¿Tributa al 10 % todo lo que se consume en el local, bebidas incluidas, y los tipos de cada producto solo se aplican a lo que se lleva?*

Nota: ____

**13. Una devolución después de que el tique de la mesa haya descontado un pago a cuenta** (añadida el 21 de noviembre, a partir de la decisión del propietario sobre la pregunta 6 y los pagos a cuenta de la pregunta 12)

- **Devolver más de lo que recoge el tique de la mesa.** Una empresa paga 100 € por adelantado, con su propio tique, A/12: 90,91 € de base y 9,09 € de cuota al 10 %. La cena suma 120 €, así que el tique de la mesa, A/45, detalla los platos, descuenta A/12 (−100,00 €) y termina en los 20 € restantes (18,18 € de base y 1,82 € de cuota). Después, el local acepta devolver 30 €. Proponemos dos pasos. Primero, una rectificativa de A/45 devuelve los 20 € pagados en él, a los tipos de IVA de los platos, y se remite a la AEAT. Segundo, los 10 € restantes salen del pago a cuenta, cuyo tique ya no puede rectificarse una vez que A/45 lo ha descontado: el personal los devuelve como devolución del pago de A/12, y no se remite nada por ella. Su cuota, 0,91 € al 10 % (9,09 € de base), queda declarada, y la exportación para el gestor recoge la devolución con esa cuota. El propietario lo ha decidido así; en sus palabras: "let's use refund a payment, but add this approach to the adviser's list for confirmation" («usemos la devolución de un pago, pero añadamos este enfoque a la lista del asesor para que lo confirme»). Waitron rechazará la devolución sobre A/12 mientras A/45 conserve dinero que su rectificativa pueda devolver, de modo que la rectificativa va primero; el importe que se devuelve sobre A/12 es el que introduce el personal, ya que Waitron no puede saber cuánto se debe devolver. *¿Es aceptable? Si no lo es, ¿qué debe expedir o remitir el local por los 10 €, y puede dejar declarados los 0,91 € para que su gestor decida?*

Nota: ____

## Old question numbers

Plans and queues written before 18 November cite the earlier numbers. Record each answer under both.

| Earlier | Now | Earlier | Now | Earlier | Now |
| --- | --- | --- | --- | --- | --- |
| 1 (a), (b) | 4 | 10 | 10 | 19 | 6 |
| 1 (c) | 5 | 11 | 10 | 20 | 10 |
| 2 | 8 | 12 | 10 | 21 | 5 |
| 3 | 1 | 13 | 7 | 22 | 11 |
| 4 | 8 | 14 | 7 | 23 (L1, L5) | 7 |
| 5 | 9 | 15 | 1 | 23 (the rest) | 11 |
| 6 | 9 | 16 | 3 | 24 | 2 |
| 7 | 8 | 17 | 6 | 25 | 2 |
| 8 | 8 | 18 | 6 | 26 | 4 |
| 9 | 8 | | | | |

## Not asked

| Item | Why it is not asked | Receipt |
| --- | --- | --- |
| Earlier 7 (c): does the accountant's export list a corrected invoice by sale date or issue date? | Covered by question 8's corrections report, which places it under the sale's quarter | owner's walk-through, 18 November |
| Earlier 15 (b), second half: may the final ticket deduct an advance's base and VAT? | Answered: answer 1.8 describes it for a deposit | [2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md) |
| Earlier 26's quotation of V0858-11 | Not needed for the question; it came from a third-party copy, not the DGT's database | owner's walk-through, 18 November |
| T2, keeping a date that nothing shows to be wrong | Owner, 16 November: the explanation of how the clock is confirmed is not needed; question 8 asks about errors in the time alone | the owner's review of this sheet, 16 November |
| May a ticket wait until the bill is paid? | Answered: the adviser's answer 1.3 says issuing "cannot be made conditional on the bill being paid in full" | [2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md), Part B1 |
| Is the email step informed consent? | Answered: the adviser's answer 1.11 accepts tacit consent once the customer is told how the ticket will arrive and that paper is available, which the till's sentence does | [2026-11-15-adviser-answers.md](2026-11-15-adviser-answers.md), Part B2 |
| Is a ticket left with the bill, or a sent email, delivered? | Owner, 16 November: yes to both; question 3 states it | the owner's review of this sheet, 16 November |
| The adviser's answer 1.15: who is the third party for copies held outside Spain | Owner, 16 November: Waitron Cloud will keep its copies in EU data centres, so the question does not arise for it | the owner's review of this sheet, 16 November |
| The labour and privacy questions in full | Not for the tax adviser; question 11 lists them and asks whom to ask. P4 must be updated for A1404 (#2627), which encrypts the bucket copy, before the full list is sent | [2026-11-06-adviser-questions.md](2026-11-06-adviser-questions.md) |
| T13, the long-term archive | Owner, 15 November: "Agree, no archive now" (A1531) | `~/waitron-campaign-l/questions.md:1783-1785`; [backlog.md](../backlog.md) |
| T16, a change of producer | Owner, 11 November, "Later": A993 is built only once a change is scheduled. Its venue-move half is in question 9 | commit `e59fac8c94` |
| S14's second half: may R5 and R1 to R4 share one series? | Owner, 15 November: they will not share; the adviser agreed the same day (answer 1.14). Question 8 asks the narrower point | `~/waitron-campaign-shared/desk/done/20261115-1018-L-r5-series-date-rulings.md` |
| S4's last part: may the issue date stand as the date VAT falls due? | Owner, 12 and 15 November; the adviser agreed on 15 November (answer 1.4). Question 1 asks when the meal ends, and question 8 where a late correction counts | [backlog/fiscal.md](../backlog/fiscal.md) |
| The 6 November background on AEAT's time | Owner, 10 to 13 November: Waitron reads AEAT's time only to warn of drift | [CLAUDE.md](../../CLAUDE.md) |

## Added after the meeting

Question 12, in both parts, was added in this copy on 19 November from the owner's decisions on the
advances plan ([2026-11-19-adviser-advances.md](../superpowers/plans/2026-11-19-adviser-advances.md),
Q1, Q2, Q4, Q6–Q10 and Q12; revised after the owner's answers of 21:00 the same day, and again
after the plan's third fresh read the same evening: the table's ticket no longer prints the
advance's base and VAT, and the plan's Q3, on rounding between the advance and the rest, was
added as its own point). Copy it into the shared Google Doc before sending.

AEAT's test service accepted the records question 12 describes (the advances plan's Task 1.0):
verifactu live run [44707265624](https://github.com/waitron-io/verifactu/actions/runs/44707265624),
mode `advance-rest`, verifactu `main` at `e5d065b40f`. All eight records, among them the negative
10% line beside a positive 21% line (Q2) and the rest whose VAT is not its base times the rate
(Q3), returned `EstadoEnvio` and `EstadoRegistro` `Correcto`. Their descriptions were test text;
the advance's own words, «Pago a cuenta — consumo en mesa 7», were not sent.

Question 6's last point, goodwill money back on a bill with two VAT rates, was added in both parts on
21 November (owner, 21 November, agreeing to put it to the adviser with the part-payment refund
question: "yes and yes").
Copy it into the shared Google Doc before sending.

Question 13, giving back a part payment by Refund a payment once the table's ticket has taken it
off, was added in both parts on 21 November (owner, 21 November 16:36: "let's use refund a payment,
but add this approach to the adviser's list for confirmation"; the refusal while the table's ticket
still holds money its corrective could give back is the watcher's decision of 16:54, not the
owner's; plan
[2026-11-21-advance-manual-route.md](../superpowers/plans/2026-11-21-advance-manual-route.md)).
Copy it into the shared Google Doc before sending.

# Table service

With the payment simulator, the counter payment controls and bill-payment window offer
**Approve**, **Decline** or **No answer** before you press **Card**. No real card is charged. **No answer** keeps the payment
blocked so you can practise recovery. In the dashboard's **Payments**, a manager chooses
**Check with provider** and confirms. This ends the practice attempt without recording a charge.

## Give a comp or discount {#comps-and-discounts}

Choose a reason when you make an item free or give a discount. With **Apply comps**, you can
apply it up to the reason's limits and the bill's comp limit. If you need approval, choose someone
with **Approve comps** and ask them to enter their PIN. They approve past those limits and can
apply their own comps without a second person's PIN. By default, all staff can apply within the
limits; supervisors, managers and administrators can approve.

When a comp brings the bill to zero, Waitron closes the bill and issues the invoice straight away. Give the guest that invoice.

In the dashboard's **Voids and comps**, set a limit to **0** when each comp needs approval.
New reasons start at 0; change the amount or clear it when you want to allow comps without a limit.
**Complaint**, **On the house** and **Discount** start at 0; **Staff meal** allows up to 50% off
an item before approval is needed.

## Share a Counter bill {#counter-part-payments}

Choose **Pay** to take all or part of a Counter bill. **Whole bill** starts selected;
you can instead enter an amount, split equally or choose items. Choose **Cash** or **Card**
for each payment. After a part payment, check **Still to pay** before taking the next payment.

Add an item before paying or sending an order.

If cash is refused while you pay an edited parked order, your edits stay in the basket.
Correct the payment amount and try again, or park the order to save the edits without paying.

## Record cash in or out {#drawer-cash-entry}

When you top up change or take cash out, open **More** and choose **Cash in or out** on a till
assigned to the drawer. Choose **Open drawer**, or use the key if the drawer stays shut.
Choose **Cash in** or **Cash out**, enter the amount and why you moved it, and choose **Save**.

## Close a cash drawer {#close-drawer}

On a till assigned to the drawer, open **More** and choose **Close drawer**. Open it with the key
if it stays shut. Count the cash and choose **Save count**. Waitron then shows any difference, and
you can choose **Recount** once to check it. If you leave after saving a count, choose **Close drawer**
again from any till assigned to it to pick up where you left off.

If Waitron asks you to recount after cash moved, choose **Recount** and enter what is in the
drawer now.

Enter the cash you want to leave and check **For the bank** before taking the rest out. Choose
**Finish close**. If you need another slip, you can reprint it from
[Sales](sales.md#drawer-close-history).

## Use another card machine {#outside-card}

Take the card payment on the separate machine first. In **Pay**, choose **Other card machine**.
If your venue has connected SumUp, **This SumUp account** starts selected. Choose **Paid outside
Waitron** if the machine uses another account or provider. Without a SumUp connection, Waitron
records the payment as **Paid outside Waitron**. You can also enter the operation number and
machine name to help match the payment later.

If the venue takes tips, enter the tip taken on that machine in **Tip**. A tip you entered
before choosing **Other card machine** stays there; check that the total matches the machine.

Record each payment as you take it while Waitron accepts payments. If Waitron refuses a payment,
follow the message before recording it again; do not charge the customer twice. If you have no
backup card machine, choose **Cash**.

You can check these details in **Sales & takings** when you select a single day. **Other card
machines** shows the current payment state and successful refunds, even if they changed later.
**Download for accountant (XLSX)** includes a separate sheet of these payments, selected by
calendar date rather than business-day cutover.

In **Check card payments** under Reporting, open **SumUp comparison** to check a calendar day in the venue’s
time zone. A match links one same-account entry to one SumUp charge with the same amount,
including tips, within 30 minutes. Check ambiguous or unmatched charges in SumUp before making
any correction. The comparison sends no refunds. If the comparison is incomplete, try again after
the final check, due at 01:00 UTC after the day ends.

The refund groups compare the saved SumUp check with your current refund records. Refresh after
recording an outcome. A confirmed match has the same refund ID and amount; an amount agreement is
unverified, so check it in SumUp before acting. Compare both dates and the provider checked times.
An incomplete comparison tells you which evidence is missing; it does not send money or record an
outcome. If a date or reference is unknown, check in SumUp; entries without a reference may describe
the same refund. Refunds on other providers, or backup payments without a unique link, appear separately.
If you refund an older payment in SumUp’s app, check it there too: this view finds it only if SumUp
lists it on the refund day. That path has not yet been tested with SumUp.

## Choose documents after paying {#settlement-document}

After the final payment, choose **Receipt** or **Full invoice**. An edit that finishes
paying the bill offers the same choice. To print, wait for **Print on {printer}** to name your
destination, then press it. A full invoice keeps its recorded customer.

When **Send by email** is offered, you can send a receipt or full invoice as a PDF. Enter the customer's
email address and press **Send**. Printing and email are separate actions. If the till says
**Check before trying again**, the document may already have been delivered: ask the customer or
look at the printer first. If sending fails, or the customer does not have it, use **Send the email
again** to retry the same address, or choose another address.

Press **Done** or close the window to carry on. Unless you emailed it, the receipt prints when you
close. If the printer is switched off or not working, it prints by itself when it is back; if it has
not printed by the next day, print it from the sale. If the device has no receipt printer, choose one
or send the email before closing; otherwise it prints if the device gets one within a day. You close the table separately.
After a bill is printed with **Print the bill**, the window after the last payment offers a copy
instead of the original, which printed with the bill; print the copy only if the guest asks for
another receipt.
For a document later, open the sale and choose **Print/Reprint**.

## Check a card before cancelling {#cancel-pending-card}

If cancelling an order says a card payment is pending, wait for the reader to finish, then choose
**Pay** to check that payment before cancelling again. If the card was charged, do not ask the
customer to pay a second time.

## Issue a full invoice {#full-invoice}

When a table customer needs an invoice in their name, choose **Full invoice** for the bill and
enter their identifier, legal name and complete address before the bill is printed or takes its final payment. The
saved choice lets the bill grow above the simplified-invoice limit. Paying the table bill in full
or printing it with **Print the bill** issues the invoice; recording an unpaid departure also issues
it, leaving the amount unpaid. A bill still open when the business day ends is issued then.

**Full invoice** is in the bill's payment area below the order, and in the **⋮** menu under the
bill's name; both open the same form for the bill on screen. Neither is offered once the bill is
paid or an invoice has been issued for it. Turning a paid bill into a full invoice would correct an
invoice already issued, and Waitron does not offer that correction yet. Once a customer is chosen,
their name and identifier show under the payment area's **Full invoice**. Merging bills, or
moving every dish to another bill, asks before a full invoice's customer would change.

Saved a full invoice by mistake? Open **Full invoice** again and choose **Simplified invoice
instead**. Once the bill is printed or has taken a payment, it stays a full invoice.

Choose **Spanish tax ID** for a NIF, NIE or CIF. For a passport or another accepted document,
choose its actual **Identifier type**, **Issuing country** and **Document number**. Enter the
number as written. A passport is accepted with a Spanish address too; the issuing country
belongs to the document, independently of where the customer lives. A full invoice needs an
identifier. **Cancel** returns without saving.

Choose the address country and enter the street and number and city. A Spanish address also
needs a valid five-digit postcode and province; those fields are optional for other countries.
For example, a French address can be **2 Main Street**, **Paris**, **France**, without a postcode
or province. Do not add the country name to the street. The printed invoice and till ticket name
it in the receipt language. Order details name it in your screen language.

At the counter, choose **Full invoice** before **Pay**. Paying the order in full issues the
invoice. Placing a counter order alone does not issue an invoice.

For a new full invoice, **Delivery** starts on A4 if your till has an A4 invoice printer. Choose
**Receipt printer** if you need the invoice on receipt paper.

When the form shows **Delivery**, **A4 on {printer}** or **Email** sends the original by itself
once the invoice is issued. With **Receipt printer**, the invoice prints when you choose **Print
the bill**; otherwise it prints when you close the window after payment.
If the form says **Email** isn't offered, add a contact email on the department's **Receipts** tab
in **Departments and zones**, in the dashboard.

Every full invoice prints your business's registered address. If it is wrong or incomplete,
correct it in **Venue settings → Venue details**: choose **Change registered address** on the
**Business** card. If you use **Same as the venue's address**, correct the venue's address
first. Invoices issued afterwards print the new address; invoices
already issued keep the one they were issued with.

## Choose a document and printer {#invoice-printer}

Open a sale in **Find a bill** to check its receipt in the 80 mm paper layout. The receipt uses
the language it was issued in. For a paper copy, choose **Print/Reprint**. For a full invoice, choose **Receipt** for the compact
version or **Invoice** for the invoice layout. A simplified invoice goes straight to its receipt
printers. Both versions of a full invoice keep the recorded customer details.

Choose a printer from your device’s list. **Use default** follows the profile’s default; another
choice is saved in **Equipment** for this device. If another device carries the receipt printer,
Waitron asks before you take it over.

Wait for **Print on {printer}** or **Print a copy on {printer}** to name your destination, then press
it. Choosing a document or printer, refreshing the list and going back print nothing. A copy still
asks for its language when more than one is available; cancelling prints nothing. After a failed
save, choose **Retry**; use **Refresh** if the list could not load.

For an older full invoice with no bill, open it from **Transactions** and choose **Invoice**.
Use **Receipt** for a compact copy once an original has completed. If printing fails, check the
destination named by **Retry original** or choose the named receipt printer instead.

If the till says the office printer is out of paper, add paper and wait for the invoice. The notice
can stay on the sign-in screen if the till locks. If the invoice may have printed, check the printer
before sending it again.

## Print from dashboard Orders {#dashboard-documents}

To find an older bill, choose **Any date** or set the date range. Search covers every matching bill,
including other pages. Use **Previous page** and **Next page** to move through 50 bills at a time.
Click **Opened**, **Invoice** or **Total** to sort; click the same heading again to reverse it.
A word search puts the closest matches first. Clear **Search** to put the column order first.

For a document later, open **Orders** in the dashboard and choose **Print / Reprint** on the bill.
For a full invoice, choose **Receipt** for receipt paper or **Invoice** for the mixed printer list;
both keep the recorded invoice and customer. A simplified invoice opens its receipt printers directly.
Wait for any queued original on A4 or by email to finish before choosing Receipt for a full invoice.

Choose your printer and press **Print on {printer}** or **Print a copy on {printer}**. **A4** marks an
office printer. This browser remembers the last accepted printer separately for Receipt and Invoice.
If that printer is unavailable, choose again. When you open the printer list, a sole available
printer starts selected.
Use **Refresh printers** when none are listed, or **Cancel** to leave without printing.

## Payment slips {#reader-slips}

If the payer wants a slip, choose **Print payment slip** after you take their payment by cash,
**Other card machine** or card reader. For a part payment, print it from the confirmation before
taking the next payment. After the final payment, use **Customer document**. The button appears
when your device has a payment slip printer. A reader set to print its own slip handles that payment.
A slip shows the payment and how it was made. For
**Other card machine**, it includes the machine and operation number you entered.

If your print request fails, you can press **Print payment slip** again. To replace a slip that
already printed, use **Reprint** in
[Print Queue](printers.md#print-queue).

If a card reader prints its own payment slip, open **Card payments** in the dashboard, edit that
reader and turn on **Prints its own slip automatically**, then choose **Save**. Waitron then leaves
that reader's payment slips to the reader. This setting describes the reader; it does not change
its printer's settings. It starts off for a new reader.

Adding a recognised reader again keeps your choice. See [Card readers](printers.md#card-readers)
to delete a reader or add it again. A configuration export carries payment policy, not card readers
or this setting.

## Trust the server before opening the till {#certificate-trust}

The till's **This device hasn't trusted the till yet** page follows your browser's preferred
supported language, with English as the fallback. Choose **Open the setup page for instructions**
to install the server's certificate on this device, then reopen the till.

## Refund all or part of a payment {#refund-payment}

When a bill's payment needs returning, start with that payment so you can see how much remains
available to refund.

In the bill's payment window, choose **Refund** beside the payment. The **Refund a payment**
window asks how much to refund and why. For **Part of it**, enter the **Amount to refund**. Choose
the **Reason** from the list. A reason that needs a note, such as **Other**, asks you to type one,
and the note is recorded as the reason. A payment for particular items is refunded in full, and
those items can then be paid for again.

While the bill has no invoice, **Refund** beside a payment that has a ticket of its own opens
**Correct invoice** on that ticket instead.

Choose **Refund** with the amount shown. If you cannot approve refunds yourself, a supervisor or
manager enters their PIN. For a cash refund, hand the money to the guest when the result tells you
to do so.

If a change to a bill would leave it owing less than it has already received, the refusal offers
**Refund** with the excess amount. Choose it to open the bill's payments. When only one payment
can be refunded, its refund window opens with the excess amount selected. If several payments
can be refunded, choose which one to refund. If the payments cannot be read, the window explains
the failure; close it and open it again before choosing a payment.

If the card provider cannot refund the payment yet, this attempt returned no money.
You can close the window and start a new refund later.

Once the refund is complete, choose **View acknowledgment** next to it in the bill’s payments.
After invoicing, you can open the refund from **Transactions** in **Find a bill**.
Choose **Print** for the first copy. You can reprint it from the dashboard’s **Print Queue** for seven days.

## Cancel a dish on a saved Counter bill {#counter-cancel-item}

Use × to remove a dish you have not sent. For a sent dish, × and **Cancel** open **Cancel item**.
Choose how many to cancel. If preparation has started, choose whether to keep its charge or remove
it, then choose a reason. Removing that charge may need a supervisor's PIN.

**Back** leaves the dish as it is. After you confirm, the basket refreshes from the saved bill.
If you choose **Discard** on a parked order with sent dishes, the till opens that order first.
Cancel its sent dishes before discarding it. If you keep a cancelled dish's charge, pay the bill.

## Move a parked order to a table {#move-parked-order}

In **Parked orders**, choose **Move to table** and pick a table. If an unsent order at that table
blocks the move, choose **Take over draft** for each bill listed. Close the message, then choose
the table again.

## Cancel a dish on a paid bill {#cancel-paid-dish}

When a table has paid for a dish that is not coming, cancel it so the station stops making it and
the guest can have the money back. Among the table's sent dishes, choose **Void…** from the dish's **More** menu.
On a paid bill, it is offered only for what has not been served yet.

The **Cancel item** window says **This bill is closed**. Choose **How many**, up to the number not
yet served. If the dish has gone to the station but nobody has marked it started, answer **Has
preparation started?**. Then choose a **Reason**.

Tick **Refund** to give the dish's money back. It starts ticked when preparation has not started,
and unticked when it has. The main button then reads **Cancel and refund** with the amount. Without
the tick it reads **Cancel**, and the bill keeps the charge. If you cannot give refunds yourself,
someone who can enters their PIN.

The tick appears only when this device can return the payment. When the guest paid in a way this
device does not take, the window says **Refund the payment at a till: choose Refund a payment on
the receipt.** After **Cancel and refund**, the receipt's refund opens filled in, as described
under **Refund a payment on a receipt**.

## Finish a paid table with food still to come {#finish-paid-table}

When you choose **Finish table** and a paid bill still has dishes nobody has served, a window
headed, for example, **2 dishes not served** lists them, and you either cancel them all or, when one has a station ticket, send the food to the
counter.

For a dish that has gone to the station but is not marked started, answer **Has preparation
started?**. For the others, the window shows the answer. Tick **Refund** beside each dish whose
money goes back; a dish starts ticked when preparation has not started. One **Reason** covers every
dish, and it starts on **Not served** when your venue keeps that reason.

Choose **Cancel and refund** with the ticked dishes' total, or **Cancel** when nothing is ticked.
**Back** leaves the table open. If you tick **Refund** and cannot give refunds yourself, someone who
can enters their PIN. When a payment was taken in a way this device does not take, the window tells
you to refund it at a till from the receipt.

Once the table is finished, a **Refund** window lists each receipt with ticked dishes. Choose one to
open its refund, filled in. When there is only one receipt, its refund opens straight away.

When the guests will wait and take their food from the counter, choose **They'll collect it at the
counter** instead. It is offered when at least one of the dishes has a station ticket. Nothing is
cancelled or refunded. Dishes held back go to the station now, each bill whose food still to come
has a station ticket becomes a paid order waiting at the counter, and the table finishes. The order
waits under **Waiting orders** on the **Counter** screen, marked **Paid, not handed over**, and
**Find a bill** lists it; choose **Hand over** when the guests collect it.

## Refund a payment on a receipt {#refund-receipt}

On a past receipt, choose **Refund a payment**. Pick the **Original payment**, check the **Payment
amount to return** and the **Tip to return**, and choose a **Reason**. A reason that needs a note,
such as **Other**, asks you to type one. Choose **Refund**. For cash, hand the money to the guest
once the refund is done.

After **Cancel and refund**, or **Finish table** with dishes ticked, the window opens filled in.
The payment is chosen when only one can be refunded on this device. The amount is the dishes'
total, the tip is 0.00, the reason is the one you gave for the cancel, and the dishes are listed
under it.

You do not need another PIN to refund up to the cancelled dishes' remaining value, with no tip.
If you raise the amount or add a tip, you need refund permission or a fresh approval PIN. The
refund still counts against the cancelled dishes, up to their value. A card keyed on a separate
terminal always asks for a fresh PIN to confirm that the terminal refund was done.

Keep this refund window open to use the cancellation's approval. If you close it before sending
a refund and open one from the receipt later, enter its amount and reason again and get approval
if asked.

When the chosen payment holds less than the dishes' total, the amount is what it holds, and a line
such as **€2.00 left to refund from another payment** says what remains. It counts from the amount
in the window, so it also appears, or grows, when you lower the amount. To refund the rest, choose
**Refund a payment** again and pick a payment. That window is not filled in: enter the amount
and reason yourself. If you cannot give refunds, it asks for the PIN, and the dishes' entries in the
report do not show that part. If that payment cannot be refunded on this device, the window tells
you to refund it at a till.

If the card provider cannot refund the payment yet, this attempt returned no money.
You can close the window and start a new refund later.

To print an acknowledgment for a receipt refund, find the completed refund on the **Transactions** tab
in **Find a bill** and choose **Print**. You can reprint it from the dashboard’s **Print Queue** for seven days.

## Correct an invoice {#correct-invoice}

When a paid bill charged too much, correct its invoice: the guest gets the difference back and
Waitron files a corrective invoice for it. On a past receipt, choose **Correct invoice**, beside
**Refund a payment**. The till cannot correct a full invoice naming a customer.

If the overcharge was on particular dishes, tick them under **Dishes to correct (optional)**;
otherwise leave them all unticked. Enter the **Money back, VAT included**, and check the VAT shown
for each rate. Choose a **Reason**, then **Correct and refund**. If you may not correct invoices,
someone who may enters their PIN.

When the bill was paid only in cash, the cash drawer opens and the corrective invoice is filed at
once: give the customer the amount the window shows. Otherwise the window shows what is left to
give back, with a cash step when part was paid in cash, and a **Refund to card** step for each
card. **Give back €6.05 in cash** opens the cash drawer. **Refund to card** opens **Refund a
payment** filled in for that card; refund the cards one at a time. While a card refund waits for the card company, choose
**Check again** to see its answer.

When a card refund finishes a correction later, its corrective receipt does not print by itself.
To give it to the customer, open it in **Find a bill**, on the **Transactions** tab, where its type
is **Correction**, and print it there.

If you close the window before the money is all back, the correction stays open. **Find a bill**
lists it under **Corrections under way**; choose it to carry on, then choose one of these:

- **Record correction** appears when everything is back but the corrective invoice was not filed
  by itself; it files it.
- **Finish now** files a corrective invoice for what has been given back so far, and gives no more
  back.
- **Discard** ends a correction that has given nothing back.
- **Close keeping the refunds** ends it without a corrective invoice, when the window says one
  cannot be filed. The money given back stays given back.

If the window says an earlier request got no answer, choose **Send again**.

## Refund a card payment on a separate terminal {#separate-terminal}

If the till says the server is out of disk space, wait until a manager clears the stop before refunding
on the terminal: Waitron cannot record the refund while the stop holds.

For a card payment keyed from a separate terminal, Waitron asks you to refund it on that terminal
first. Complete the terminal's refund before choosing **Refunded on the terminal**. A supervisor
or manager then approves recording it in Waitron with their PIN.

If a refund gets no answer, check the bill's payments before trying again. The first request may
already have succeeded.

## Clear a service step {#service-steps}

A service step reminds you to go back to a table at the right moment, such as **Take order** a
couple of minutes after **Set up** is done, or **Dessert?** five minutes after Mains are served.
A new venue starts with **Set up**, **Take order**, **Dessert?** and **Coffee or bill?**, which is
due five minutes after Desserts are served. If either preset course is missing, a new department
starts with the first two steps; add your own course-linked visits in Tables.
Each step starts at a moment like that and falls due a set number of minutes later. Your venue sets
them up under **Service steps** on the department's **Tables** tab in the dashboard. There you can
read the meal from seating to leaving, with its fixed moments, steps and courses. Choose **Fire now** or **Hold for later** on each course row there. A held course offers its
own reminder delay, including **At once** and **Off**. Choose **Save** to keep these choices with
the department’s other settings. Use **Courses** to change the shared course names and order.

Choose a step's start by name, such as **After Set up**, then set its delay. The list places it
beside that start. Renaming another step keeps the link; deleting it also removes steps that
start from it, so check those followers before you save.

When a step is due, the table's card shows its name, with a **Done** button if you may take orders.
On the map, unless something more urgent is showing, the table turns blue with a bell. Open its
details to read the step and use **Done** if you may take orders. A table shows one
step at a time: the one that fell due last.

A step waiting five minutes gets an amber outline unless a stronger warning takes priority. Open
the table’s details for the step and its wait; **5′** beside the map’s bell means five minutes.

Tap **Done** when you have been to the table and the guests want nothing. It clears the step on show
and any earlier step it was hiding. Often you don't need to tap it, because these clear a step too:

- An order sent once the step is due. This also clears an earlier step hidden behind it.
- The party's first order, which clears every step that started before it.
- The party leaving.

Until the first order is sent, no step shows while an order is being taken for the table.

A cleared step comes back when the moment it starts from happens again, such as more of a course
being served. A step that repeats every few minutes after the last order comes back with each
repeat: **Done** clears the one on show, and another order starts the count again.

## Each dish is its own line {#portions}

When you take an order of 2 × Burger with cheese, at a table or at the counter, the bill holds two
burgers, each with its own cheese, rather than one line of two. That way you can void one burger, or at a table serve or move it, and its cheese goes
with it, and the bill and the station agree on which burger is which.

While the dishes are the same you still see one row, **2 × Burger**, on the bill and in **Sent**. A
row parts as soon as one dish differs, for example once one burger is served or comped. Tapping a
row in **Sent** marks all of it served; **Mark served** in the row's details asks how many.
[**Move dishes…**](table-service.md#move-dishes) lets you choose how many of a row go to another bill, each with
its own extras. **Comp** and **Void** work on the row and let you choose how many of its dishes.
**Change dish**, in the row's details, changes every dish of the row and lets you increase its
count. To reduce the count, use **Void…**, which opens **Cancel item**.

Allergens and diet labels update from the live product while you keep the order open. You do not
need to publish the menu or save the order.

To check a sent dish's allergens and diet labels, open its details and read **Recorded when
sent**. A dish on hold still shows its current declaration until you release it.

A weighed dish is different, because each one is weighed on its own: adding the same weighed dish
twice gives two lines rather than one of double the weight, and a weighed dish moves to another bill
whole. At a table or at the counter you can add up to 99 of one dish at a time.

At the counter, an order you park and open again shows its 2 × Burger as one row while none of it
is paid.

## Get back to your tables with unsent dishes {#unsent-tables}

On a busy shift it is easy to start an order at one table, get called to another, and forget the
dishes you never sent. So on a phone or tablet the bar at the top shows **Floor**, then a button
such as **✎ T4**, by the table's short name, for each table where you have dishes not yet sent;
however many of your bills there hold unsent dishes, a table gets one button. Tap a button to go
back to that table. The table you are at is highlighted. Once nothing of yours is unsent there, for
example after you send everything, its button stays highlighted without the ✎ until you leave, and
then goes, while a table you leave with dishes still unsent keeps its ✎ button. If someone else takes over your bill, it stops counting as yours: at once at the
table you are at, and at any other table when the Floor next updates its tables. When there are
more buttons than fit, **Floor** stays where it is and the table buttons slide sideways beside it;
a faded edge shows there are more that way.

With a keyboard, Tab reaches the selected button. Left and Right open the previous or next tab,
wrapping between **Floor** and your tables. Home opens **Floor** and End opens the last table.

Tapping **Floor** after a table opens that table's zone, if this device shows it. Everything else is
in **More** (☰): your name, with your clock actions if you clock in on this device, when the bar
has no room for it, which on a phone is always; the screens your profile allows; **Zones on this
device**, **Equipment**, **Language**, **Theme** and, if this device has a touch screen and its
browser supports vibration, **Vibrate on button press**, under a **Settings** heading; **About
Waitron**; **Log out**; and, while the venue has a logo, **Powered by Waitron** under it.

## Take an order on a phone {#phone-order}

On a phone, or any table screen narrower than 720 px, **Menu** and **Order** at the top show one or
the other, and **Order** says how many dishes are in your **New order**, such as **Order · 3**. A
table opens on **Menu** until something has been sent on the bill on screen, then on **Order**.

On **Menu**, a number on a dish says how many of it are in your **New order**. While it holds
anything, a bar at the bottom says what, such as **New order · 3 items — 2 × Croquettes · 1 × Pork
shoulder**: tap **Send all** to send it and see **Order**, or tap the words to see it on **Order**.

On a handheld, **Order** keeps **Total**, **Still to pay at this table** and **Pay** at the bottom,
with **Send all** above them while you have dishes to send. After you send everything, a handheld
stays on the table until you tap **Floor**. On a screen 720 px wide or more, such as a tablet's, the
menu and the order sit side by side.

## Set menus {#set-menus}

Set the number of each set menu on the bill. Open its folder from the grid or type its name
in **Search** and tap the result. Then choose the dishes.
The folder shows which dishes are included and which cost extra. If the guests are taking
their food away, choose **Takeaway** on the bill before adding a set menu.

Open the set-menu summary on **Order** to see where dishes go and which places are free.
If a dish has no place, choose one of the options shown, or tap **Cancel** to keep the
order as it was. From the summary you can move a dish to another set menu on the same
bill or cancel an empty set menu.

To move a set menu to another bill, open **Move dishes** and select the set menu. Its
dishes move with it. If you choose a dish by itself, check its price on the other bill
before confirming.

At the **Counter**, choose **Take away**, set the number, then open the set-menu folder
and choose the dishes. You can **Park** a takeaway before adding any dishes. To add
dishes later, find the bill in **Parked orders** and choose **Retrieve**.

## Give a table a short name {#short-names}

A phone or tablet shows a table's short name in the bar's table buttons and the Ready bar, where
space is tight, and the cards on the [station screen](kitchen-service.md#kitchen-screen) and the
[pass](kitchen-service.md#pass-screen) name their table by it. In the dashboard's **Floor plan**,
each table has a **Short name** under its **Name**, filled in from the name: "T1" for "Terrace 1",
"Win" for "Window", and a name of four characters or fewer as it is. It follows the name until you
type your own, of up to five characters, which cannot contain "+" because the till uses it for
tables joined together. Two tables of the venue cannot share a short name, whatever the capitals: if
Save says "Terrace 1 already uses T1", type another, such as "Tb1". **Add tables** shows the short
names it will give, and lets you type them when you choose custom names; **Add joined table** asks
for one.

## Switch bills {#bill-switcher}

If a payment was partly returned before its invoice was recorded, do not charge again.
In **Check card payments** under Reporting, check the charged, refunded and still-held amounts. Choose **Retain on this
bill** to apply the remaining money to the bill. Check the bill amount, any excess kept as a tip,
and what staff still need to collect before confirming. For example, from €100 charged and €40
returned, you can keep €60 on the bill and collect only its remainder. Excess money can be kept
only when tips are enabled.

To return all the money instead, refund the remainder in SumUp, then choose **Confirm full refund**
in Waitron. This is also the route for a bill payment already marked failed. If SumUp cannot confirm
the amounts, check its refunds and try again. Once released, reopen the order to continue.
Review the other payments named by the shared refund
alert before marking it handled; later payments may not be listed there.

Guests often pay separately: two couples at one table, or one guest who pays for their own drinks.
Each of them gets a bill of their own at the table. The bill switcher, at the top of the table
screen, says which bill is on screen, such as **Bill 1 · €38.50**, or **Bill 2 · 3 bills · Clint
· €54.00** when the table has three. It is there even when the table has one bill, so a second bill is
always one tap away.

At the counter, use **Parked orders** to retrieve or discard a table's bill. Discarding its last
bill leaves a seated table with a fresh empty bill. To free the table, use **Finish table**.

Tap the switcher to list the table's bills in number order. Each row shows the bill's number and
name, what it still owes or **Paid ✓** (**Deferred payment** for a bill closed as a deferred
payment), and a line such as **Ana has an unsent order: 3 items** for each person with dishes on that bill not yet sent. When another bill holds dishes you have not
sent, the switcher says so, such as **✎ Bill 2 unsent**, and the list marks that bill **✎ Unsent**.
Choose a row to put that bill on screen. A paid
bill opens too, so you can name it or, when it has a receipt, print a copy, but it takes no new
dishes. **+ New bill** is always last in the list: it starts a new, empty bill at the table and puts
it on screen.

With a keyboard, press Enter to open the switcher, use Up and Down to reach a bill, then press
Enter to show it. Home and End reach the first and last choices. Escape closes the list.

Everything else you do at the table is in the **⋮** menu beside the switcher, in two parts. The
first, headed with the bill on screen, such as **Bill 2 · Clint**, acts on that bill alone: **Name
this bill**, **Move dishes…**, **Merge bills**, **Move this bill**, **Comp the bill**, **Record
unpaid departure**, **Full invoice**, **Print the bill**, **Receipt copy**, **Cancel and
credit** and **Reopen to split**, each when it applies. The second, **Whole table**, acts on everyone at the
table: **Allergies**, **Name the party**, **Guests**, **Mark bill requested for …** with the party's
name (once requested, **Cancel the bill request for …**), **Split a table** (when the party sits at
more than one table), **Join a table**, **Move guests** and **Finish table**. An action that needs a
choice, such as which bill to merge with, opens beside the order, and **Back** closes it.

Joining a table, or moving guests onto one, keeps every bill: the bills that arrive take the
receiving party's next numbers. To put two bills together, open the bill that should receive the
other and choose **Merge bills**. The receiving bill can have taken a part payment; the bill you
add must have no payments. If the bill you add is set for a full invoice to a customer the
receiving bill does not name, the till asks first: choose the customer the merged bill is invoiced
to, or **Do not merge**. If you move the table's last bill away, the till stays at the table with a
fresh empty bill.

If unsent orders block **Join a table**, **Move guests**, **Move this bill** or **Merge bills**,
choose **Take over draft** for the bills listed, then try the action again.

If another till merges the bill on your screen into another bill, or moves it to another table,
your screen switches to another of the table's bills and says so,
such as **Bill 2 is no longer at this table. Now showing Bill 1.** Dishes you had added to the bill
that went and not sent are not moved onto the bill now shown: they are listed under **Your changes
have not been saved.**, with **Discard changes** and **Update the order**. A bill paid on another
till stays on your screen, marked **Paid**.

Below the order, the foot shows this bill's **Total**, then **Still to pay at this table** for all
the table's bills, and **Pay**. The bill's **Full invoice** choice and receipt language sit beside
it when offered. A partly paid bill whose invoice is not yet issued also shows what has been
received and what remains. The foot has no **Park**: a table's bill already waits at its table. On a
handheld, when a bill is paid with a simplified invoice and others are not, **Back to the table**
opens the first unpaid bill.

Waitron takes no payment for a bill with dishes not yet sent. While the bill on screen has dishes in
your **New order**, or another person's unsent dishes for it are shown with their **Take over
draft** button, the buttons that start a payment look quiet. They still respond: a tap starts no
payment and says why, such as **Bill 1. Send or remove the unsent dishes before paying.** Send or
remove your own dishes. For someone else's, tap **Take over draft** first, then send or remove them.
Unsent dishes on another bill at the table do not hold this one back. If a payment of this bill was
sent and its result is unconfirmed, **Pay** still reopens
it, so you can find out whether it went through; that window takes no new payment while the dishes
are unsent.

If you choose **Finish table** while a bill is still unpaid, the till says **A bill for this table
is still unpaid. Take payment before finishing the table** above the foot. **Take payment** puts an
unpaid bill on screen so you can take its payment. **Print the bill**, when offered, puts that bill on
screen and prints it, or lists dishes not yet served.

If a guest leaves without paying, select their bill, open **⋮**, then choose **Record unpaid
departure** under that bill. Check its amount and give a reason. If approval is needed, choose a
supervisor or manager and ask them to enter their PIN.

Only that bill’s unserved food is stopped, with cancellation slips for the station. The other bills
keep their food, so you can still serve a paid guest’s dessert. What is still owed on the bill is
recorded as unpaid; any amount already paid is kept. When the guest comes back to pay, open the bill
from **Find a bill** and take the rest there. The table stays open while another bill needs closing
or paid food still needs serving. Serve the remaining food, then choose **Finish table** when
everyone has finished.

A bill still open when the business day ends gets its receipt then, without printing. Take its
payment with **Pay**, or record an unpaid departure. A bill with dishes held or not yet sent stays
open. A bill with an open correction of a payment that has its own ticket stays open until that
correction is finished or discarded.

To find a bill issued when the business day ended, choose the day it opened in **Sales & takings**.
For tax reporting, use [VAT return (modelo 303)](invoices.md#vat-return). The dates recorded on invoices can place a
bill in a different period.

If a payment is recorded as not taken, you can try it again. If its result is unconfirmed, choose
**Check again** to continue the same payment before taking another. If it was not recorded, this
may charge the card or record the cash payment.
If a payment stays pending, or the card was charged but the payment was not recorded, choose
**Check card payments / sign in**. Do not charge an already charged card again. Sign in there to check or
record the provider’s confirmed outcome under **Bill payments**. After recording it, reopen the
bill and collect only its outstanding balance.

If that check fails, follow [A card-payment check failed](table-service.md#card-check-failed) below.

If the reader took a different amount, compare the requested and taken figures in the warning.
Check the bill balance before taking another payment, so you collect only what is still owed.

## Print the bill {#print-bill}

When guests ask for their bill, put it on screen, open **⋮** and choose **Print the bill**. Its
receipt is issued now and prints on this device's receipt printer, and the till says **Bill
issued**. A full invoice set for A4 or email goes there instead. Each bill at the table is printed
on its own, so another bill's guests can carry on eating.

Choose **Full invoice** before printing: once the bill is printed, its invoice type cannot change.

Send or take off any dishes not yet sent first. If dishes on the bill are not marked served,
nothing prints yet: the till lists them under **Not served yet:**. If the guests have had them,
choose **Mark served** where it shows, then **Print the bill** again. Otherwise choose **Print
anyway**: a dish that then never comes is refunded after payment with
[Correct an invoice](table-service.md#correct-invoice). The till cannot correct a full invoice naming
a customer, so on one of those take off any dish that may not come before you print.

A printed bill takes no more dishes. If the guests order something else, put it on **+ New bill**.

If the guests then want to pay separately, open **⋮** and choose **Reopen to split**. The receipt
is credited and its dishes go onto a new bill, ready for [**Move dishes…**](table-service.md#move-dishes).
Once part of the bill is paid it cannot be split this way: the other guests pay the rest with
**Pay**.

When a guest has already paid part of the bill with
[a receipt of their own](table-service.md#pay-window), the bill lists the dishes, then that payment
taken off by its ticket number, date and amount.

Take payment with **Pay** as usual, in one go or in parts.

## A card-payment check failed {#card-check-failed}

For a payment listed under **Bill payments and refunds awaiting a card provider**,
choose **Check with provider** there. Once it is recorded, reopen the bill to see what remains
to pay. Waitron also retries these payments automatically. If recording keeps failing, keep
the order and payment details and do not charge again; this is a fault in Waitron or this box.

## Move dishes to another bill {#move-dishes}

When one guest decides to pay for their own drinks, move those dishes onto a bill of their own. Open
the **⋮** menu and choose **Move dishes…**. It is there for a table's bill that is still open, even
when part of it is paid.

The panel, headed with the bill, such as **Move dishes from Bill 1**, lists the bill's dishes, each
with its extras under its name, and a weighed dish with its weight, such as **Iberian ham ×0.32**.
Tick a dish to move it; its extras go with it. Identical dishes share one row, such as **Caña** with a
**4** beside it: ticking the row takes all of them, or as many as the bill's payments allow, and **−** and **+** then set how many, shown as
**2 of 4**, with the amount of those moving. A
weighed dish has a tick only, because it moves whole.

Some ticks are grey, with the reason under the dish:

- **Has a payment**: the dish has a payment in progress or received, so it stays on this bill.
  Wait for a payment in progress to finish; refund a received payment before moving its dish.
- **Payments keep €40.00 on this bill: move fewer dishes**: choose fewer dishes so the bill keeps
  enough for its payments, including any still in progress. The other dishes can still go.

Under **Move to**, choose where the dishes go: one of the table's other open bills, or **+ New
bill**. A bill that has already taken a payment simply owes more afterwards. **Move** stays quiet until you have ticked a dish and chosen where it goes.
After the move, a new bill is put on screen; moving onto another bill leaves this one on screen.
Each dish keeps its course and stays sent, fired or served as it was. Moving the last unpaid
dishes off a part-paid bill leaves it paid in full, and its invoice is issued.

If a bill is set for a full invoice and you move every dish to a bill that does not name the same
customer, the till asks first: choose the customer the dishes are invoiced to, or **Do not move**.

If someone pays a dish on another till while the panel is open, its row turns **Has a payment** when the
till next reads the bill, and that dish drops out of what you picked. If you tap **Move** before
then, the move is refused with the reason, such as **This item has already been paid for, so it
cannot be changed, moved or charged again. Refund its payment first**, and nothing moves. If the
move would leave the bill owing less than has been paid, the till says how much and offers a
**Refund** button for that amount. If the move is refused because a card payment or refund is
still going through on the bill you chose, or because that bill was presented or paid in the
meantime, the till names that bill before the reason, such as **Bill 2: This bill is closed**. If
someone else has unsent dishes on either bill, choose **Take over draft** in the message.
Choose **Review** to check your dishes and destination, then choose **Move** again.

## Split a table {#split-table}

When some of a party move to a table of their own, open the **⋮** menu, choose **Split a table** and
tap the table that leaves. Tick what goes with it: whole bills, or single dishes from any bill. Set
each table's guests, then choose **Split**.

## Move a bill or split a table with dishes on hold {#held-dishes-move}

A bill with dishes on hold can go to another table with **Move this bill** or **Split a table**.
The dishes stay on hold there. Each table then fires its own group: firing one sends none of the
other table's dishes.

## Transfer a Counter bill to another department {#department-transfers}

Open a saved bill on **Counter**, then choose **Transfers** in the top bar on a till, or under
**More** on a handheld. Choose **Request transfer**, select the **Destination department** and
choose **Save**. Your department remains
responsible until the receiving desk accepts. While the request is pending, you can choose
**Withdraw request**.

To receive a bill, open **Transfers** and choose **View current tab** beside the incoming request.
Check **Ordered items** and **Outstanding station work** before choosing **Accept transfer**.
Choose the **Destination zone** and, if needed, a **Destination table**, then **Save**. To refuse
it, choose **Decline transfer**, enter the **Reason for declining** and choose **Save**.

## Sell food eaten here or taken away {#eat-here-or-take-away}

Where takeaway food is charged a different VAT, a department's **Service** tab in the dashboard
asks **How it sells**: **Eaten in**, **Taken away** or **Chosen on the till**. With **Chosen on the
till**, staff choose for each order, and **Starts as** sets how a counter order begins; a table
order starts eaten here. Orders already open keep their way when you change this.

On the till, tap **Eat here** or **Take away** above the order before you send it to the kitchen
or take a payment; after that the order keeps its way.

## Name a bill {#bill-names}

A party's bills are numbered, and the till shows each one with its number and any name you give it,
such as **Bill 2 · Clint**, in some places with the party's name in front, such as **4 · Bill 2 ·
Clint**. To name the bill on screen, for example after the guest paying it, open the **⋮** menu,
choose **Name this bill**, type up to 40 characters and choose **Save**. Empty the field to remove
the name. **Name the party**, under **Whole table** in the same menu, names the whole party instead.
If someone else has unsent dishes on that bill, choose **Take over draft** before you name it.

To change the name the station sees, use **Name the party**. If station work is still outstanding,
its printers receive a [name-change slip](kitchen-service.md#party-names).

A bill keeps its number for as long as it stays with the party. Merging one bill into another leaves
a gap: merge Bill 2 into Bill 1 and Bills 1 and 3 remain. A bill that arrives from another table or
from the counter takes the party's next number, and so do the bills of a table you join. A table
split off with bills starts again at Bill 1, and so does a table seated again after its party
finishes. A bill keeps its name when it moves, including to the counter, where it has no number. You
can name a bill only at a table. The name is not printed on station tickets or receipts.

## See which tables have food ready {#ready-bar}

When the station has dishes ready, you want to know which tables to take them to without going to
look. On a phone or tablet, a bar at the foot of the **Floor** lists each table with food ready and
how many dishes are waiting, such as **Ready · T2 · 3**. Each table is shown by its short name, such
as T2 for Table 2, or by its full name while it has none; a table joined to another for today shows
both, such as T4+T5. While no food has waited too long, the table whose food has waited longest
comes first.

Food left at the pass goes cold, so the bar warns you when a dish has waited too long. Once a ready
dish has waited as long as its station's **Ready warning** time (3 minutes unless you change it
[in **Prep stations**](kitchen-service.md#service-lifetime)), the bar turns amber, its edge pulses
slowly, and it says how long the first table's food has waited, such as **Ready 4 min · T5 · 2 ·
T9 · 1**. Each station is judged by its own time, so a salad from a 6-minute station and a grilled
dish from a 3-minute one warn at different moments. Tables whose food has waited that long come
first, in amber, and the minutes keep counting while you watch. On a device set to reduce motion,
the bar stays amber without pulsing. Tap a table to open it, or tap **Open ›** to open the first
table listed. When more tables are ready than fit, slide the list sideways; a faded edge shows there
are more that way.

The bar lists only the tables in the zones this device shows, and it goes away once nothing is ready. A
till instead shows a **Ready** list above the tables, one line for each station. The list counts
ready food at tables in every zone the till's profile allows, not only the zones it shows.

## Show a zone as a map or a list {#floor-view}

Tap **List** or **Map** to switch how the zone on screen draws its tables. On a phone the switch is
in the zone's ⋮ menu. The device keeps your choice for each zone, so the zone opens the same way
next time, and switching one zone leaves the others as they were. A zone you have not switched
opens as a map when it has tables placed on its plan, and as a list when it has none.

## Join and split tables {#join-tables}

A saved joined table starts as its real tables together in a named group. To add a table, open its details on the map and choose **Join with…**. To separate tables, open the group, choose **Split tables…**, tick the tables to take out and confirm **Split**. Use **Join with…** to put a table back in the group.

When you join tables to seat guests, **Join with…** leaves out any table that needs clearing or moving until you mark it cleared or moved.

If an unsent order blocks a join from the map, choose **Take over draft** for each bill listed.
Close the message and drag again or use **Join with…** again.

## Reset a zone to today's plan {#zone-reset}

To undo today's changes to a zone, open its ⋮ menu, choose **Reset to … plan** for the plan named there, and confirm **Reset**.

After resetting, move the free tables to match the map.

Keep tables with food on the way where they are until you hand over the order. Before a reset can
join separate tables, finish any open delivery order at those tables.
When a table shows **Needs moving**, move it and choose **Mark moved**.

## Choose this device's equipment {#equipment}

On a till, choose **More**, **Settings**, then **Equipment**. On a handheld, choose **More**,
then **Equipment**. In each available list, choose the equipment you want this device to use,
or **Use default** to follow its profile's choice.

If the profile's card reader says **Free to choose**, select **Use default** on the device
that will take payments with it. If another device holds it, Equipment shows which one.

Where **Scan** is offered for a receipt printer, payment slip printer or card reader, use its
Waitron label instead of the list. Choosing equipment carried by another device from a list asks
you to confirm **Take it**; scanning takes it over without asking, so check which item you scan.

## Switch this device's profile {#device-profile}

When this device is approved for another profile you are allowed to use, **More** (☰) offers
**Profile**. Choose another **Device profile** and tap **Switch**.

Before switching, park or clear the order in progress. If a card payment is still in progress,
choose **Check card payments / sign in** to check its outcome, signing in there if asked.
Then try **Switch** again. **Cancel** keeps the current profile.
Other staff signed in on this device are signed out if the new profile does not allow them to sign in.
To choose which zones this device shows, see
[Choose the zones this device shows](table-service.md#device-zones).

## Choose the zones this device shows {#device-zones}

A device shows every zone its profile allows. If you only work the terrace, the other zones get in
the way, so you can choose which of them this device shows and which one it opens on. On a till,
open **More** (☰), then **Settings**, then **Zones on this device**. On a phone or tablet, open
**More** (☰) and choose **Zones on this device**, under **Settings**. Tick **Show** for each zone
you want, choose the one that **Opens first**, and tap **Save**.

The **Floor** then shows only the zones you chose, and with a single zone it shows no zone tabs at
all. A till shows its chosen table zones on the Floor and its chosen counter zones on the Counter. A
phone or tablet has no Counter, so its Floor shows every zone you chose. Until you save a choice, a
phone or tablet opens where it always has; after that it opens on your **Opens first** zone. After
you open a table, see [Get back to your tables with unsent dishes](table-service.md#unsent-tables).

The choice belongs to this device and the profile it is signed in on, so another device on the same
profile keeps its own, and switching profile brings back that profile's choice. If a manager
withdraws a profile's approval for this device, choose its zones again if that profile returns.
You can choose only from the zones the current profile allows. If a phone or tablet cannot read its choice when you sign
in, it says so and shows every zone its profile allows until it can.

A table in a zone this device does not show takes no new dishes here, and its unsent dishes cannot
be sent from this device. So Waitron will not hide the zone of the table you have open while it has
unsent dishes. If the zones change while you are at such a table, the change waits. You can still
send or remove the table's unsent dishes, but not add new ones, and the zone hides once they are
gone. If this device can no longer serve the table's zone, for example because a manager took it
off the profile, you cannot send or remove them either: the zone hides when you leave the table, and
its unsent dishes stay on it. Hiding a zone does not check the tables you are not at, so their
unsent dishes wait until you show the zone again.

## Fingerprint check failed {#fingerprint-check-failed}

If Waitron says the fingerprint check failed, ask a manager to arrange a repair before retrying
the invoice action. The refused action creates no invoice and does not use its invoice number;
invoices already stored stay unchanged.

If the card was already charged, do not charge it again. Keep the bill and payment details so the
manager can recover the payment after the fault is fixed.

## Take a whole or part payment {#pay-window}

To collect a bill, open **Pay** at the Counter or on the table's bill. On a table, send or remove
any unsent items first. The top of the window shows **Total**, **Paid so far**, **Card payment in progress**
and **Still to pay**. Start with what is still to pay, rather than the bill's original total.

**Choose what this guest pays.** Choose **Whole bill** to pay everything still due.
Choose **An amount** for a contribution, **Split equally** for one equal share, or **Items** for
particular dishes. For an equal share, enter how many people are still to pay, including this
guest. For items, choose the dishes and adjust the quantity when only some are being paid for.
A printed bill offers these choices for what it still owes. If the bill is presented for collection
and its invoice has yet to be issued, choose **Pay in parts** to see the same choices.

Choose the payment method, then press **Continue** to check it before taking any money. If the
bill changes before you confirm, check the revised figures before confirming again.

**A receipt of their own.** When a guest pays part of a bill that has no invoice yet and is set
for a receipt, not a full invoice, the confirmation asks whether they want their own receipt for that amount. **Yes** prints them a ticket
of its own, and the table's receipt takes it off. **No** lists it on the table's receipt.
To see which table's receipt took a part payment off, open its receipt in **Find a bill**.

**Cash and change.** Choose **Cash** and enter the actual **Cash handed over**. The confirmation
shows how much pays off the bill and the **Change to give**. If the venue takes tips, choose
whether to return all the change, leave all of it as a tip, or leave an amount. Check the change
again after choosing a tip, then press **Take payment** and give that change to the guest.

**Card and reader.** Choose **Card**. On a phone, check the named reader in **Reader and printer**;
use **Change** or scan its Waitron label if you are holding another one. At the Counter, choose
from the card readers when a list is offered. Check the reader and the total before confirming.
To use a separate machine, follow [Use another card machine](table-service.md#outside-card).

If the venue takes tips, enter **Tip on the card (optional)** before continuing. The confirmation
separates **Paid off the bill**, **Tip** and **Charged on the card**. An amount above what is
still due becomes a tip, so check the full card charge with the guest before sending it.
For example, a €50 card contribution towards €40 still due pays €40 off the bill and adds a €10
tip. If the venue does not take tips, use the amount the refusal says can be charged.

On a phone, the confirmation button names the amount and reader. Once you press it, the waiting
panel shows that same amount and reader, with elapsed waiting time. Complete the card step on
that reader and wait for the result. A spinning phone is not proof that the card failed.

If the guest changes their mind while the SumUp reader waits for their card, choose
**Cancel payment** in this window, at Counter or in Pay for a presented table bill. Wait for
the till to confirm no payment was taken before trying again. If the card was charged, the till
shows the payment as taken.

**Continue with the next guest.** After a part payment, check **Still to pay**. On a phone, press
**Take the next** to continue; an equal split also shows which share is next. Check the remaining
number of people if your group changes. After the final payment, choose the
[document to give the guest](table-service.md#settlement-document). Finishing a table is a
separate action after payment.

**Another phone is taking payment.** **Card payment in progress** is money already reserved for
that card, so it is taken off **Still to pay**. On a €70 bill with a €30 card out, another phone
can take the remaining €40. It cannot pay the reserved €30 again towards the bill. If no balance
is left outside that card, wait for its result. With tips enabled, entering more than €40 in
**An amount** charges the extra as a tip on this card; check that charge with the guest. If the
window asks whether to **Take another**, check with the other member of staff before doing so.
A phone that had an older amount open may be asked to confirm revised figures. Check both the
amount paid off the bill and any tip before confirming.

**Wi-Fi dropped or no result arrived.** Do not start a fresh payment just because the phone lost
its connection. Reconnect and look at the bill's payments. If **Payment not confirmed** remains,
use **Check again** to continue that same payment. This is not just a lookup: if the first
payment was not recorded, it may charge the card or record the cash payment. Keep the same cash
and reader details while you establish the result.

If the payment is shown as not taken, you can take it again. If it stays pending, or the card was
charged but the payment was not recorded, choose **Check card payments / sign in** and follow
[Check a card before cancelling](table-service.md#cancel-pending-card). Do not charge a card you
know has already been charged. If the check fails, follow
[A card-payment check failed](table-service.md#card-check-failed).

## Close a bill as a deferred payment {#deferred-payment}

Use this when the customer will pay the whole bill later, outside Waitron. Open **Pay** on the bill
and choose **Close as deferred payment** (where **Whole bill** is offered, choose it first).
Check the bill, the invoice and the total, then confirm. Waitron issues the invoice if it has not been issued yet and closes the bill for good. It
records no payment for the bill, now or later, and the bill shows **Deferred payment** from then on.

The button is there only on a bill with nothing paid yet. On a table's bill, every dish must be
served or cancelled first; at the Counter, the bill must have a simplified invoice. A manager
allows it for a device by switching on **Closes bills as deferred payments** in the device's
profile, under **Device profiles** on the dashboard.

Your accountant gets the list of these bills from **Export deferred payments (CSV)**, on the
dashboard's **Sales & takings** page.

## Practise with different devices in Demo {#demo-devices}

In an unpaired browser, open the till to choose a device. A paired browser starts as its
device; choose **Choose another device** on the sign-in screen to change it.
A kitchen display offers the same choice beside its language control.

Choose different devices in different tabs to sign in and sign out independently. Tabs that
choose the same device share its sign-in. Use **Pair another device** if you need to add one.

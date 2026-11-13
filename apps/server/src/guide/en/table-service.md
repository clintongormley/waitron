# Table service

In Demo or Preparation, the counter payment controls and bill-payment window offer
**Approve**, **Decline** or **No answer** before you press **Card**. No real card is charged. **No answer** keeps the payment
blocked so you can practise recovery. In the dashboard's **Payments**, a manager chooses
**Check with the card provider** for a whole-order payment, or **Check with provider** for a bill
contribution, and confirms. This ends the practice attempt without recording a charge.

## Take a set-lunch order {#set-lunch}

Add one lunch for each diner and choose the dishes they want now. **Choose later** marks a
course they have not picked yet. Each lunch stays separate so you can return to it later.

To hold chosen courses, send the order as held. In that lunch’s panel, use **Send to prep** for the
course you want to send now. Open **Lunch choices** when the diner chooses another course, save
it, then send that course. You can change a choice until it is sent; dishes already sent stay put.

If the diner skips coffee, use **Pay** as usual. Leaving that choice open keeps the lunch price
and sends nothing for it. Set lunches here are for service at the table.

The receipt keeps each diner’s lunch separate, with its base price and any premium supplement
priced beneath it. The chosen dishes are listed without separate prices.

## Give a comp or discount {#comps-and-discounts}

Choose a reason when you make an item free or give a discount. With **Apply comps**, you can
apply it up to the reason's limits and the bill's comp limit. If you need approval, choose someone
with **Approve comps** and ask them to enter their PIN. They approve past those limits and can
apply their own comps without a second person's PIN. By default, all staff can apply within the
limits; supervisors, managers and administrators can approve.

In the dashboard's **Voids and comps**, set a limit to **0** when each comp needs approval.
New reasons start at 0; change the amount or clear it when you want to allow comps without a limit.
**Complaint**, **On the house** and **Discount** start at 0; **Staff meal** allows up to 50% off
an item before approval is needed.

## Share a Counter bill {#counter-part-payments}

Choose **Pay** to take all or part of a Counter bill. **Whole bill** starts selected;
you can instead enter an amount, split equally or choose items. Choose **Cash** or **Card**
for each payment. After a part payment, check **Still to pay** before taking the next payment.

Add an item before paying or sending an order.

## Choose documents after paying {#settlement-document}

After the final payment, choose **Receipt**, **Full invoice** or **None**. An edit that finishes
paying the bill offers the same choice. To print, wait for **Print on {printer}** to name your
destination, then press it. A full invoice keeps its recorded customer.

When **Send by email** is offered, you can send a receipt or full invoice as a PDF. Enter the customer's
email address and press **Send**. Printing and email are separate actions; after either delivers
the original, the next delivery is a copy. If sending fails, use **Send the email again** to retry the
same address, or choose another address.

Choose **None** or close the window to carry on without printing. You close the table separately.
For a document later, open the sale and choose **Print/Reprint**.

## Check a card before cancelling {#cancel-pending-card}

If cancelling an order says a card payment is pending, wait for the reader to finish, then choose
**Pay** to check that payment before cancelling again. If the card was charged, do not ask the
customer to pay a second time.

## Issue a full invoice {#full-invoice}

When a table customer needs an invoice in their name, choose **Full invoice** for the bill and
enter their identifier, legal name and complete address before its final payment. The
saved choice lets the bill grow above the simplified-invoice limit. Paying the table bill in full
issues the invoice; recording an unpaid departure also issues it, leaving the amount unpaid.

**Full invoice** is in the bill's payment area below the order, and in the **⋮** menu under the
bill's name; both open the same form for the bill on screen. Neither is offered once the bill is
paid or an invoice has been issued for it. Turning a paid bill into a full invoice would correct an
invoice already issued, and Waitron does not offer that correction yet. Once a customer is chosen,
their name and identifier show under the payment area's **Full invoice**. Merging bills, or
moving every dish to another bill, asks before a full invoice's customer would change.

Choose **Spanish tax ID** for a NIF, NIE or CIF. For a passport or another accepted document,
choose its actual **Identifier type**, **Issuing country** and **Document number**. Enter the
number as written. A passport is accepted with a Spanish address too; the issuing country
belongs to the document, independently of where the customer lives. A full invoice needs an
identifier. **Cancel** returns without saving.

Choose the address country and enter the street and number and locality. A Spanish address also
needs a valid five-digit postcode and province; those fields are optional for other countries.
For example, a French address can be **2 Main Street**, **Paris**, **France**, without a postcode
or province. Do not add the country name to the street. The printed invoice and till ticket name
it in the receipt language. Order details name it in your screen language.

At the counter, choose **Full invoice** before **Pay**. Paying the order in full issues the
invoice. Placing a counter order alone does not issue an invoice.

When the form shows **Delivery**, **A4 on {printer}** or **Email** sends the original by itself
once the invoice is issued. With **Receipt printer: print after paying**, press **Print on
{printer}** in the window after payment.

## Choose a document and printer {#invoice-printer}

On a sale’s ticket, choose **Print/Reprint**. For a full invoice, choose **Receipt** for the compact
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

## Print from dashboard Orders {#dashboard-documents}

For a document later, open **Orders** in the dashboard and choose **Print / Reprint** on the bill.
For a full invoice, choose **Receipt** for receipt paper or **Invoice** for the mixed printer list;
both keep the recorded invoice and customer. A simplified invoice opens its receipt printers directly.
Wait for any queued original on A4 or by email to finish before choosing Receipt for a full invoice.

Choose your printer and press **Print on {printer}** or **Print a copy on {printer}**. **A4** marks an
office printer. This browser remembers the last accepted printer separately for Receipt and Invoice.
If that printer is unavailable, choose again. When you open the printer list, a sole available
printer starts selected.
Use **Refresh printers** when none are listed, or **Cancel** to leave without printing.

## Avoid duplicate card slips {#reader-slips}

Select **Print card slip** before taking the card if the payer wants one. It starts off for each payer and prints after the card is confirmed. If the reader answer is unclear or the box restarts before printing, use a copy instead.

To print a card payment again before the bill is fully paid, reopen **Pay** and choose **Print a copy** beside the received payment under **Payments on this bill**. The copy shows what remained when that card was taken.

If a card reader prints its own payment slip, open **Card payments** in the dashboard, edit that
reader and turn on **Prints its own slip automatically**, then choose **Save**. Waitron then leaves
that reader's payment slips to the reader. This setting describes the reader; it does not change
its printer's settings. It starts off for a new reader.

Adding a recognised reader again keeps your choice. See [Card readers](printers.md#card-readers)
to delete a reader or add it again. A configuration export carries payment policy, not card readers
or this setting.

When Waitron prints a card slip for a sale, its words, date and amounts follow that sale’s saved receipt language. Changing your screen language or the venue’s current receipt language keeps the earlier sale’s slip in its original language.

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

The refund acknowledgment uses the original sale’s receipt language by default, even when your screen uses another language.

## Cancel a dish on a saved Counter bill {#counter-cancel-item}

Use × to remove a dish you have not sent. For a sent dish, × and **Cancel** open **Cancel item**.
Choose how many to cancel. If preparation has started, choose whether to keep its charge or remove
it, then choose a reason. Removing that charge may need a supervisor's PIN.

**Back** leaves the dish as it is. After you confirm, the basket refreshes from the saved bill.
If you choose **Discard** on a parked order with sent dishes, the till opens that order first.
Cancel its sent dishes before discarding it. If you keep a cancelled dish's charge, pay the bill.

## Cancel a dish on a paid bill {#cancel-paid-dish}

When a table has paid for a dish that is not coming, cancel it so the kitchen stops making it and
the guest can have the money back. Among the table's sent dishes, choose **Void…** from the dish's **More** menu.
On a paid bill, it is offered only for what has not been served yet.

The **Cancel item** window says **This bill is closed**. Choose **How many**, up to the number not
yet served. If the dish has gone to the kitchen but nobody has marked it started, answer **Has
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
headed, for example, **2 dishes not served** lists them, and you either cancel them all or, when one has a kitchen ticket, send the food to the
counter.

For a dish that has gone to the kitchen but is not marked started, answer **Has preparation
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
counter** instead. It is offered when at least one of the dishes has a kitchen ticket. Nothing is
cancelled or refunded. Dishes held back go to the kitchen now, each bill whose food still to come
has a kitchen ticket becomes a paid order waiting at the counter, and the table finishes. The order
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

## Refund a card payment on a separate terminal {#separate-terminal}

For a card payment keyed from a separate terminal, Waitron asks you to refund it on that terminal
first. Complete the terminal's refund before choosing **Refunded on the terminal**. A supervisor
or manager then approves recording it in Waitron with their PIN.

If a refund gets no answer, check the bill's payments before trying again. The first request may
already have succeeded.

## Clear a service step {#service-steps}

A service step reminds you to go back to a table at the right moment, such as **Take order** a
couple of minutes after **Set up** is done, or **Anything else?** once every dish has been served.
Each step starts at a moment like that and falls due a set number of minutes later. Your venue sets
them up under **Service steps** on the department's **Service** tab in the dashboard.

When a step is due, the table's card shows its name, with a **Done** button if you may take orders.
On the map, unless something more urgent is showing, the table turns blue with a bell and the step's
name, and the table's details list the step, with **Done** if you may take orders. A table shows one
step at a time: the one that fell due last.

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
with it, and the bill and the kitchen agree on which burger is which.

While the dishes are the same you still see one row, **2 × Burger**, on the bill and in **Sent**. A
row parts as soon as one dish differs, for example once one burger is served or comped. Tapping a
row in **Sent** marks all of it served; **Mark served** in the row's details asks how many.
[**Move dishes…**](table-service.md#move-dishes) lets you choose how many of a row go to another bill, each with
its own extras. **Comp** and **Void** work on the row and let you choose how many of its dishes.
**Change dish**, in the row's details, changes every dish of the row and lets you increase its
count. To reduce the count, use **Void…**, which opens **Cancel item**.

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
device**, **Equipment**, **Language** and **Theme** under a **Settings** heading; **About
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

## Give a table a short name {#short-names}

A phone or tablet shows a table's short name in the bar's table buttons and the Ready bar, where
space is tight, and the cards on the [kitchen screen](kitchen-service.md#kitchen-screen) and the
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
The order stays held. In **Card payments**, check the charged, refunded and still-held amounts.
Refund the remainder in SumUp's dashboard, then choose **Confirm full refund** in Waitron.
Waitron checks SumUp's record before releasing this payment. If it cannot confirm the full refund,
check the refunds in SumUp and try again. Once released, reopen the order to continue.
Review the other payments named by the shared refund alert before marking that alert handled;
later payments may not be listed there.

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
this bill**, **Move dishes…**, **Merge bills**, **Move this bill**, **Comp the bill**, **Full
invoice**, **Receipt copy** and **Cancel and credit**, each when it applies to the bill. The second, **Whole table**, acts on everyone at the table: **Allergies**, **Name the party**,
**Guests**, **Mark bill requested for …** with the party's name (once requested, **Cancel the bill
request for …**), **Split a table** (when the party sits at more than one table), **Join a table**,
**Move guests** and **Finish table**. An action that needs a choice, such as which bill to merge
with, opens beside the order, and **Back** closes it.

Joining a table, or moving guests onto one, keeps every bill: the bills that arrive take the
receiving party's next numbers. To put two bills together, open the bill that should receive the
other and choose **Merge bills**. The receiving bill can have taken a part payment; the bill you
add must have no payments. If the bill you add is set for a full invoice to a customer the
receiving bill does not name, the till asks first: choose the customer the merged bill is invoiced
to, or **Do not merge**. If you move the table's last bill away, the till stays at the table with a
fresh empty bill.

If another till merges the bill on your screen into another bill, or moves it to another table,
your screen switches to another of the table's bills and says so,
such as **Bill 2 is no longer at this table. Now showing Bill 1.** Dishes you had added to the bill
that went and not sent are not moved onto the bill now shown: they are listed under **Your changes
have not been saved.**, with **Discard changes** and **Update the order**. A bill paid on another
till stays on your screen, marked **Paid**.

Below the order, the foot shows this bill's **Total**, then **Still to pay at this table** for all
the table's bills, and **Pay**. The bill's **Full invoice** choice and receipt language sit beside
it when offered. A partly paid bill also shows what has been received and what remains. The foot
has no **Park**: a table's bill already waits at its table. On a handheld, when a bill is paid with
a simplified invoice and others are not, **Back to the table** opens the first unpaid bill.

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
unpaid bill on screen so you can take its payment.

If a guest leaves without paying, select their bill, open **⋮**, then choose **Record unpaid
departure** under that bill. Check its amount and give a reason. If approval is needed, choose a
supervisor or manager and ask them to enter their PIN.

Only that bill’s unserved food is stopped, with cancellation slips for the kitchen. The other
bills keep their food, so you can still serve a paid guest’s dessert. The bill remains owed in full.
The table stays open while another bill needs closing or paid food still needs serving. Serve the
remaining food, then choose **Finish table** when everyone has finished.

If a payment is recorded as not taken, you can try it again. If its result is unconfirmed, choose
**Check again** to continue the same payment before taking another. If it was not recorded, this
may charge the card or record the cash payment.
If a payment stays pending, or the card was charged but the payment was not recorded, choose
**Card payments / sign in**. Do not charge an already charged card again. Sign in there to check or
record the provider’s confirmed outcome. Reopen the bill payment after it is recorded to see the
result. If Card payments says **Payment recorded. The rest is still due.**, reopen the bill and
collect only its outstanding balance.

If the reader took a different amount, compare the requested and taken figures in the warning.
Check the bill balance before taking another payment, so you collect only what is still owed.

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

- **Paid**: the dish is already paid, so it stays on this bill. Refund its payment first to move it.
- **€40.00 is already paid on this bill: move fewer dishes**: moving this dish, or one more of the row, would leave the
  bill owing less than has been paid on it. The other dishes can still go.

Under **Move to**, choose where the dishes go: one of the table's other open bills, or **+ New
bill**. A bill that has already taken a payment simply owes more afterwards. **Move** stays quiet until you have ticked a dish and chosen where it goes.
After the move, a new bill is put on screen; moving onto another bill leaves this one on screen.
Each dish keeps its course and stays sent, fired or served as it was. Moving the last unpaid
dishes off a part-paid bill leaves it paid in full, and its invoice is issued.

If a bill is set for a full invoice and you move every dish to a bill that does not name the same
customer, the till asks first: choose the customer the dishes are invoiced to, or **Do not move**.

If someone pays a dish on another till while the panel is open, its row turns **Paid** when the
till next reads the bill, and that dish drops out of what you picked. If you tap **Move** before
then, the move is refused with the reason, such as **This item has already been paid for, so it
cannot be changed, moved or charged again. Refund its payment first**, and nothing moves. If the
move would leave the bill owing less than has been paid, the till says how much and offers a
**Refund** button for that amount. If the move is refused because a card payment or refund is
still going through on the bill you chose, or because that bill was presented or paid in the
meantime, the till names that bill before the reason, such as **Bill 2: This bill is closed**. If
someone else has unsent dishes on either bill, take over their order first. Open **Move dishes…**
again to choose afresh.

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
Check **Ordered items** and **Outstanding kitchen work** before choosing **Accept transfer**.
Choose the **Destination zone** and, if needed, a **Destination table**, then **Save**. To refuse
it, choose **Decline transfer**, enter the **Reason for declining** and choose **Save**.

## Name a bill {#bill-names}

A party's bills are numbered, and the till shows each one with its number and any name you give it,
such as **Bill 2 · Clint**, in some places with the party's name in front, such as **4 · Bill 2 ·
Clint**. To name the bill on screen, for example after the guest paying it, open the **⋮** menu,
choose **Name this bill**, type up to 40 characters and choose **Save**. Empty the field to remove
the name. **Name the party**, under **Whole table** in the same menu, names the whole party instead.
If someone else has dishes on the bill that are not sent yet, take over their order first.

To change the name the kitchen sees, use **Name the party**. If kitchen work is still outstanding,
its printers receive a [name-change slip](kitchen-service.md#party-names).

A bill keeps its number for as long as it stays with the party. Merging one bill into another leaves
a gap: merge Bill 2 into Bill 1 and Bills 1 and 3 remain. A bill that arrives from another table or
from the counter takes the party's next number, and so do the bills of a table you join. A table
split off with bills starts again at Bill 1, and so does a table seated again after its party
finishes. A bill keeps its name when it moves, including to the counter, where it has no number. You
can name a bill only at a table. The name is not printed on kitchen tickets or receipts.

## See which tables have food ready {#ready-bar}

When the kitchen has dishes ready, you want to know which tables to take them to without going to
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

## Reset a zone to today's plan {#zone-reset}

To undo today's changes to a zone, open its ⋮ menu, choose **Reset to … plan** for the plan named there, and confirm **Reset**.

After resetting, move the free tables to match the map.

## Choose this device's equipment {#equipment}

On a till, choose **More**, **Settings**, then **Equipment**. On a handheld, choose **More**,
then **Equipment**. In each available list, choose the equipment you want this device to use,
or **Use default** to follow its profile's choice.

Where **Scan** is offered for a receipt printer, payment slip printer or card reader, use its
Waitron label instead of the list. Choosing equipment carried by another device from a list asks
you to confirm **Take it**; scanning takes it over without asking, so check which item you scan.

## Switch this device's profile {#device-profile}

When this device is approved for more than one profile, **More** (☰) offers **Profile**.
Choose another **Device profile** and tap **Switch**. You can only switch to a profile you are
allowed to use.

Before switching, park or clear the order in progress and wait for any payment in progress to finish.
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
profile keeps its own, and switching profile brings back that profile's choice. It never gives this
device a zone its profile does not allow. If a phone or tablet cannot read its choice when you sign
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

Open **Pay** on the table's bill. Choose **An amount**, **Split equally**, **Items**, or **Whole
bill**, selected at the right. For **Split equally**, enter how many people are still to pay.
Choose cash or card, check the amount, and confirm the payment. After a part payment, check what
remains and take the next guest's payment. On a phone, use **Take the next** to continue.

A bill already presented for collection offers the whole amount only. Finishing the table is a
separate action after payment.

## Close a bill as a deferred payment {#deferred-payment}

Use this when the customer will pay the whole bill later, outside Waitron. Open **Pay** on the bill
and choose **Close as deferred payment** (on a bill not yet presented, choose **Whole bill** first).
Check the bill, the invoice and the total, then confirm. Waitron issues the invoice if it has not been issued yet and closes the bill for good. It
records no payment for the bill, now or later, and the bill shows **Deferred payment** from then on.

The button is there only on a bill with nothing paid yet. On a table's bill, every dish must be
served or cancelled first; at the Counter, the bill must have a simplified invoice. A manager
allows it for a device by switching on **Closes bills as deferred payments** in the device's
profile, under **Device profiles** on the dashboard.

Your accountant gets the list of these bills from **Export deferred payments (CSV)**, on the
dashboard's **Sales & takings** page.

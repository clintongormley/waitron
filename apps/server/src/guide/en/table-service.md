# Table service

## Issue a full invoice {#full-invoice}

When a table customer needs an invoice in their name, choose **Full invoice** for the bill and
enter their identifier, legal name and complete address before its final payment. The
saved choice lets the bill grow above the simplified-invoice limit. Paying the table bill in full
issues the invoice; recording an unpaid departure also issues it, leaving the amount unpaid.

**Full invoice** is in the bill's payment area below the order, and in the **⋮** menu under the
bill's name; both open the same form for the bill on screen. Neither is offered once the bill is
paid or an invoice has been issued for it. Turning a paid bill into a full invoice would correct an
invoice already issued, and Waitron does not offer that correction yet. Once a customer is chosen,
their name and identifier show under the payment area's **Full invoice**.

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

Counter payment cannot issue a full invoice yet. Keep the customer's order on a table bill and
use that bill's payments. Placing a counter order alone does not issue an invoice.

## Avoid duplicate card slips {#reader-slips}

If a card reader prints its own payment slip, open **Card payments** in the dashboard, edit that
reader and turn on **Prints its own slip automatically**, then choose **Save**. Waitron then leaves
that reader's payment slips to the reader. This setting describes the reader; it does not change
its printer's settings. It starts off for a new reader.

Disabling and enabling the same reader keeps your choice, as does adding that retained reader
again. Deleting it and adding it as a new reader starts with the setting off. A configuration
export carries payment policy, not card readers or this setting.

When Waitron prints a card slip for a sale, its words, date and amounts follow that sale’s saved receipt language. Changing your screen language or the venue’s current receipt language keeps the earlier sale’s slip in its original language.

## Trust the box before opening the till {#certificate-trust}

The till's **This device hasn't trusted the till yet** page follows your browser's preferred
supported language, with English as the fallback. Choose **Open the setup page for instructions**
to install the box's certificate on this device, then reopen the till.

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

The refund acknowledgment uses the original sale’s receipt language by default, even when your screen uses another language.

## Cancel a dish on a paid bill {#cancel-paid-dish}

When a table has paid for a dish that is not coming, cancel it so the kitchen stops making it and
the guest can have the money back. Among the table's sent dishes, choose **Void…** from the dish's **More** menu.
On a paid bill, it is offered only for what has not been served yet.

The **Cancel item** window says **This bill is paid**. Choose **How many**, up to the number not
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

If someone entered their PIN for the cancel, it also covers this refund, once for each receipt, so
nobody types it again. That holds while you return no more than the dishes' total and no tip. Raise
the amount or add a tip and the PIN is asked for again, and the dishes' entries in the report then
do not show the refund. Closing the window without refunding also means the PIN is asked for next
time. A card keyed on a separate terminal always asks for the PIN, because there it confirms that
the terminal refund was done.

When the chosen payment holds less than the dishes' total, the amount is what it holds, and a line
such as **€2.00 left to refund from another payment** says what remains. It counts from the amount
in the window, so it also appears, or grows, when you lower the amount. To refund the rest, choose
**Refund a payment** again and pick a payment. That window is not filled in: enter the amount
and reason yourself. If you cannot give refunds, it asks for the PIN, and the dishes' entries in the
report do not show that part. If that payment cannot be refunded on this device, the window tells
you to refund it at a till.

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
back to that table. The table you are at is highlighted, and once nothing of yours is unsent there
its button loses the ✎ and goes when you leave, while a table you leave with dishes still unsent
keeps its ✎ button. If someone else takes over your bill, it stops counting as yours: at once at the
table you are at, and at any other table when the Floor next updates its tables. When there are
more buttons than fit, **Floor** stays where it is and the table buttons slide sideways beside it;
a faded edge shows there are more that way.

With a keyboard, Tab reaches the selected button. Left and Right open the previous or next tab,
wrapping between **Floor** and your tables. Home opens **Floor** and End opens the last table.

Tapping **Floor** after a table opens that table's zone, if this device shows it. Everything else is
in **More** (☰): your name and clock actions when the bar has no room for them, which on a phone is
always, the screens your profile allows, **Settings** (**Zones on this device**, **Equipment**,
**Language** and **Theme**) and **Log out** and, while the venue has a logo, **Powered by Waitron**
under it.

## Give a table a short name {#short-names}

A phone or tablet shows a table's short name in the bar's table buttons and the Ready bar, where
space is tight, and the cards on the [kitchen screen](kitchen-service.md#kitchen-screen) name their
table by it. In the dashboard's **Floor plan**, each table has a **Short name** under its
**Name**, filled in from the name: "T1" for "Terrace 1", "Win" for "Window", and a name of four
characters or fewer as it is. It follows the name until you type your own, of up to five characters,
which cannot contain "+" because the till uses it for tables joined together. Two tables of the
venue cannot share a short name, whatever the capitals: if Save says "Terrace 1 already uses T1",
type another, such as "Tb1". **Add tables** shows the short names it will give, and lets you type
them when you choose custom names; **Add joined table** asks for one.

## Switch bills {#bill-switcher}

Guests often pay separately: two couples at one table, or one guest who pays for their own drinks.
Each of them gets a bill of their own at the table. The bill switcher, at the top of the table
screen, says which bill is on screen, such as **Bill 1 · €38.50**, or **Bill 2 · 3 bills · Clint
· €54.00** when the table has three. It is there even when the table has one bill, so a second bill is
always one tap away.

Tap the switcher to list the table's bills in number order. Each row shows the bill's number and
name, what it still owes or **Paid ✓**, and a line such as **Ana has an unsent order: 3 items** for
each person with dishes on that bill not yet sent. Choose a row to put that bill on screen. A paid
bill opens too, so you can name it or, when it has a receipt, print a copy, but it takes no new
dishes. **+ New bill** is always last in the list: it starts a new, empty bill at the table and puts
it on screen.

Everything else you do at the table is in the **⋮** menu beside the switcher, in two parts. The
first, headed with the bill on screen, such as **Bill 2 · Clint**, acts on that bill alone: **Name
this bill**, **Move dishes…**, **Merge bills**, **Move this bill**, **Comp the bill**, **Full
invoice**, **Receipt copy** and **Cancel and credit**, each when it applies to the bill. The second, **Whole table**, acts on everyone at the table: **Allergies**, **Name the party**,
**Guests**, **Mark bill requested for …** with the party's name (once requested, **Cancel the bill
request for …**), **Split a table** (when the party sits at more than one table), **Join a table**,
**Move guests** and **Finish table**. An action that needs a choice, such as which bill to merge
with, opens beside the order, and **Back** closes it.

Joining a table, or moving guests onto one, keeps every bill: the bills that arrive take the
receiving party's next numbers. To put two bills together, use **Merge bills**. If another till
merges the bill on your screen into another bill, or moves it to another table, your screen
switches, within about 15 seconds, to another of the table's bills, when one is left, and says so,
such as **Bill 2 is no longer at this table. Now showing Bill 1.** Dishes you had added to the bill
that went and not sent are not moved onto the bill now shown: they are listed under **Your changes
have not been saved.**, with **Discard changes** and **Update the order**. A bill paid on another
till stays on your screen, marked **Paid**.

Below the order, the foot shows this bill's **Total**, then **Still to pay at this table** for all
of the table's bills, then the ways to pay this bill: **Cash** and **Card**, **Pay items**,
**Contribute** and **Split equally**, the bill's **Full invoice** and, when the venue offers more
than one receipt language, the language its receipt will print in. Once part of the bill is paid,
**Part of this bill is already paid: take the rest as a bill payment** takes the place of **Cash**
and **Card**. On a handheld, one **Pay** button takes the place of **Cash**, **Card** and the
ways to pay, except on a presented bill that is already partly paid. The foot has no **Park**: a
table's bill already waits at its table.

Waitron takes no payment for a bill with dishes not yet sent. While the bill on screen has dishes in
your **Unsent order**, or another person's unsent dishes for it are shown with their **Take over
draft** button, the buttons that start a payment look quiet. They still respond: a tap starts no
payment and says why, such as **Bill 1. Send or remove the unsent dishes before paying.** Send or
remove your own dishes. For someone else's, tap **Take over draft** first, then send or remove them.
Unsent dishes on another bill at the table do not hold this one back. If a payment of this bill was
sent and got no answer, the pay buttons other than **Cash** and **Card** still reopen it, so you can
find out whether it went through; that window takes no new payment while the dishes are unsent.

If you choose **Finish table** while a bill is still unpaid, the till says **A bill for this table
is still unpaid. Take payment before finishing the table** above the foot. **Take payment** puts an
unpaid bill on screen so you can take its payment, and **Record unpaid departure** records that the
guests left without paying.

## Move dishes to another bill {#move-dishes}

When one guest decides to pay for their own drinks, move those dishes onto a bill of their own. Open
the **⋮** menu and choose **Move dishes…**. It is there for a table's bill that is still open, even
when part of it is paid.

The panel, headed with the bill, such as **Move dishes from Bill 1**, lists the bill's dishes, each
with its extras under its name, and a weighed dish with its weight, such as **Iberian ham ×0.32**.
Tick a dish to move it; its extras go with it. Identical dishes share one row, such as **Caña** with a
**4** beside it: ticking the row takes all of them, or as many as the bill's payments allow, and **−** and **+** then set how many, shown as
**2 of 4**, with the amount of those moving. A
weighed dish has a tick only, because it moves whole. A dish someone is changing in an unsent order
is not listed.

Some ticks are grey, with the reason under the dish:

- **Paid**: the dish is already paid, so it stays on this bill. Refund its payment first to move it.
- **€40.00 is already paid on this bill: move fewer dishes**: moving this dish, or one more of the row, would leave the
  bill owing less than has been paid on it. The other dishes can still go.

Under **Move to**, choose where the dishes go: one of the table's other open bills, or **+ New
bill**. A bill that has already taken a payment simply owes more afterwards. **Move** stays quiet until you have ticked a dish and chosen where it goes.
After the move, a new bill is put on screen; moving onto another bill leaves this one on screen.
Each dish keeps its course and stays sent, fired or served as it was. If the till says **Send held
items to the kitchen before moving them to another bill**, send them first, or move them onto one of
the table's other bills instead. Moving the last unpaid dishes off a part-paid bill leaves it paid
in full, and its invoice is issued.

If someone pays a dish on another till while the panel is open, its row turns **Paid** when the
till next reads the bill, and that dish drops out of what you picked. If you tap **Move** before
then, the move is refused with the reason, such as **This item has already been paid for, so it
cannot be changed, moved or charged again. Refund its payment first**, and nothing moves. If the
move would leave the bill owing less than has been paid, the till says how much and offers a
**Refund** button for that amount. If someone else has
unsent dishes on either bill, take over their order first. Open **Move dishes…** again to choose
afresh.

## Name a bill {#bill-names}

A party's bills are numbered, and the till shows each one with its number and any name you give it,
such as **Bill 2 · Clint**, in some places with the party's name in front, such as **4 · Bill 2 ·
Clint**. To name the bill on screen, for example after the guest paying it, open the **⋮** menu,
choose **Name this bill**, type up to 40 characters and choose **Save**. Empty the field to remove
the name. **Name the party**, under **Whole table** in the same menu, names the whole party instead.
If someone else has dishes on the bill that are not sent yet, take over their order first.

A bill keeps its number for as long as it stays with the party. Merging one bill into another leaves
a gap: merge Bill 2 into Bill 1 and Bills 1 and 3 remain. A bill that arrives from another table or
from the counter takes the party's next number, and so do the bills of a table you join. A table
split off with a bill starts again at Bill 1, and so does a table seated again after its party
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
table listed.

The bar lists only the tables in the zones this device shows, and it goes away once nothing is ready. A
till instead shows a **Ready** list above the tables, one line for each station. The list counts
ready food at tables in every zone the till's profile allows, not only the zones it shows.

## Show a zone as a map or a list {#floor-view}

Tap **List** or **Map** to switch how the zone on screen draws its tables. On a phone the switch is
in the zone's ⋮ menu. The device keeps your choice for each zone, so the zone opens the same way
next time, and switching one zone leaves the others as they were. A zone you have not switched
opens as a map when it has tables placed on its plan, and as a list when it has none.

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

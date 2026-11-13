# Kitchen service

When a guest needs special care, you need to know which dish is theirs and what to avoid.
Record the guest and assign their dishes through the table's
[allergy window](products.md#table-allergies). The kitchen receives those instructions with its work.

In Demo or Preparation, the counter payment controls and bill-payment window offer
**Approve**, **Decline** or **No answer** before you press **Card**. No real card is charged. **No answer** keeps the payment
blocked so you can practise recovery. In the dashboard's **Payments**, a manager chooses
**Check with the card provider** for a whole-order payment, or **Check with provider** for a bill
contribution, and confirms. This ends the practice attempt without recording a charge.

For whole or part payments at a table, open **Pay** and use the [payment window](table-service.md#pay-window).

To split a Counter payment between guests, follow [Share a Counter bill](table-service.md#counter-part-payments).

After the final payment, follow [Choose documents after paying](table-service.md#settlement-document) to print or email a receipt, or keep serving without one.

## Retry a counter send after a lost reply {#counter-send-retry}

If the till cannot confirm a counter send, retry with the basket unchanged. When the first send
already reached the server, the retry returns its original result and moves the till on as placed.
It adds no second kitchen ticket or collection-number slip. While the server is out of disk space,
the retry is refused and the till says the order was not saved, even if the first send already
reached the server.

If you edit the basket after the first send, the till must save those edits before placing it.
When the order has already been placed, it keeps your edits on screen and shows an error instead
of pretending the kitchen received them. Check the placed order before continuing.

## Read the allergy copy with its dish {#allergy-copies}

An assigned dish carries the guest's name, the allergens they avoid and their kitchen note.
For example, Alex avoids Milk and asks for a separate pan. Alex's dish shows that block beneath it,
and its ticket or screen card has an allergy marker. A separately routed extra carries the same
guest's instructions to its own station.

If the dish or an active extra declares an allergen the guest avoids, the block also names that
clash and says it was sent anyway. A printed ticket lists the allergens each dish declares on a
**Contains** line beneath it. An extra made with the dish lists its own after the extra's name; an extra made at another
station lists them on that station's ticket. No **Contains** line, like missing
nutritional information, does not establish that a dish is suitable. Check it with the waiter
before preparing it.

The guest's block keeps the instructions the kitchen first received: later guest or catalogue
edits do not silently replace it on the dish card, the pass or a reprint. A dish's **Contains**
line shows what the dish declared when the ticket was made; a reprint reads it again.

## Read and acknowledge a correction {#corrections}

If the waiter changes instructions for a dish your station still has to prepare or hand over,
you receive an **Allergy changed** notice with the new block. Removing the assignment, deleting
its guest or choosing No allergies produces **Allergy removed** instead. Configured kitchen
printers receive a correction slip as well.

Adding or removing an extra can change a dish's clash warning too. If the warning changes for work
your station still holds, you receive a correction while the original copy stays with the dish.

Read the correction alongside the original dish before you acknowledge it. For example, changing
Alex's note to Fresh tools leaves Separate pan on the original card and puts Fresh tools in the
notice. Acknowledging dismisses the notice; it does not rewrite the original card. An unacknowledged
allergy notice remains available across a server restart or a new business day.

A correction covers only the quantity still to serve. Fully served or cancelled work receives no
new allergy notice. If a dish moves to another station, its original copy follows it, together
with a correction when its current instructions differ.

Changing or removing the order's kitchen note gives your station one notice listing every dish it
affects, and **Got it** clears it. Each kitchen printer prints one slip listing the dishes of the
stations it serves. A party with more than one affected bill gets one notice per station and one
slip per printer, listing those bill numbers. Read the list before acknowledging it.

## Match changed names to the original orders {#party-names}

Correction slips show the party's current name beside the order number. If staff name, rename or
clear the name of a party with kitchen work still outstanding, each affected printer receives a
**NAME CHANGED** slip. Match its order numbers to the original tickets and use the name shown after
**Now**. This slip changes the name; it does not ask you to cook the food again.

## Keep advance HOLD instructions with the work {#held-work}

A held dish can reach a station on an advance HOLD ticket. That station keeps the allergy copy
sent with that ticket and receives corrections while its work remains unserved. A station that
has received no advance ticket takes its first copy when the dish is fired.

A station set to **Print held groups in advance** when a group is held receives its HOLD ticket;
another station set so may start getting the group's HOLD paper later: a HOLD ticket when a held
dish is moved to it, or a HOLD CHANGED slip when a held dish is added to the group there. A station
that has the group's HOLD paper keeps getting it, its corrections and the ticket marked FIRE, even
if its switch is turned off. Any other station prints its part unmarked when the group is fired,
including on a shared printer: only the sections that already received HOLD paper are marked FIRE.

Firing held work at the same station does not duplicate an existing allergy correction.

## Read a group's heading on kitchen paper {#group-headings}

On kitchen paper, a group's heading names the courses of the dishes printed under it, in course
order: **GROUP 3 · STARTERS, MAINS**. A reprint shows them as they are when you reprint.

## Reprint the original, then check its notices {#reprints}

A reprint repeats the original allergy block. It does not issue another correction notice, so
check the station's outstanding notices separately. Splitting dishes between bills keeps the
copies with the resulting kitchen work; it does not replace the guest's instructions.

A reprint's heading shows when it was reprinted (`*** REPRINT 15:20 ***`). The time under the
order number stays the time the first of its dishes was sent. Read both times in your venue's
time zone.

## Keep food visible until service ends {#service-lifetime}

A paid bill can still have food waiting for its guests. The pass and its monitor keep that food
visible until you mark it served or finish the table's service; food a finished table sends to the
counter stays until the order is handed over (below). The pass has no separate Done or Away action. Ready dishes keep their Ready label and late flags while they wait to be served. If tables have joined another
party, their paid bills' food stays on the pass until the surviving party finishes.

On the table, a ready dish stays **Ready** in its detail window until you mark it served.
The Sent list keeps showing how long it has been ready so you can see what still needs serving.

Use each station’s ready chip on the floor to choose what to collect there. A weighed serving
counts as one dish: 150 g or 0.64 kg shows **1**, and three whole portions show **3**.
If a dish has parts at two stations, collect them from both; each station counts it once.
In **Sent**, wait for **Ready** to see when all its parts are ready.

When you serve one of two dishes on a line, the pass shows the one still to serve. Undo restores
the served quantity without restarting the kitchen's preparation or ready time. A cancelled
quantity no longer counts as food to serve, even when its charge stays on the bill.

A counter order stays visible after payment until you collect or close it. When a paid table
finishes with **They'll collect it at the counter**, its food still to come becomes such an order:
each station with a dish still to come on it is told it moved to the counter, and prints a **MOVED**
slip when its **Print a slip when sent dishes move table** setting is **Print**; the food stays
on the pass until the order is handed over. Each pass handles only the stations and service zones
assigned to it; another station's dish on one of its cards shows dimmed, unless the pass hides
other stations' dishes (see [Work the pass](kitchen-service.md#pass-screen)).

You choose when to request cooking from the till; there is no venue-wide firing mode. Each prep
station sets whether its kitchen screen moves preparation on one item at a time or a whole
ticket at once, under **Done on the screen** when you edit it in **Prep stations**. On the kitchen
screen, a card from a whole-ticket station shows **Whole ticket** while a tap can still move it
on, and a tap on one of its dishes moves the card's dishes at the same stage.
Each prep station sets
its own late flags, and a **Ready warning** time of 3 minutes unless you change it, when you add it
with **Add station**, and under **Late flags (minutes)** when you edit it in **Prep stations**. On a
phone or tablet, the Ready bar turns amber once a ready dish has waited that long: see
[See which tables have food ready](table-service.md#ready-bar). Each
prep station also sets how identical dishes print on its tickets,
whether it prints held groups in advance, and whether a dish already sent to it can be
changed, under **Identical dishes on a kitchen ticket**, **Print held groups in advance** and
**Changes after sending**: **Not allowed**, **While held**, or
**While held or waiting**. It also sets whether its dishes wait for the pass to fire them, under
**Waits for the pass**: see [Make a station wait for the pass](kitchen-service.md#station-waits).
**Close for today** starts with the station chosen under **When closed, send to**.
A dish the kitchen has started cannot be changed. A dish that went to no station, with no extra
that went to a station of its own, can be changed whatever the stations allow.

## Work the kitchen screen {#kitchen-screen}

The kitchen screen shows a card for each group of dishes a table sent, and one for each counter
order. A card names its table by the table's short name; a counter order with no table reads
**Counter #12**. A card sits in the column of its least advanced dish, **Waiting**, **Preparing** or
**Ready**, with the card that has waited longest first. Its minutes count from when its first dish
was sent to this station to be cooked, or moved here. Tap a column's heading, which shows how many
cards the column holds, to collapse it to a narrow strip that keeps its name and count
(**Ready · 3**); tap it again to open it. Tap a dish to move it on one step, or tap the card's
heading to move the card on: only the dishes holding it back move, so a dish already further on
stays where it is. On a **Whole ticket** card, a tap on a dish moves the card's dishes at the same
stage. A card's top edge turns from green to amber as it waits, then its whole border red, by the
station's late flags, and a forgotten card's border pulses; it holds still on a device set to
reduce motion.

A card whose dishes are all held is dashed and shows no minutes. It says **Held, not released**
until the waiter [requests cooking](kitchen-service.md#request-cooking), and **Waiting for the
pass** once the waiter has asked for every dish on it and the pass has not yet fired it. At first it
sits at the bottom of **Waiting**, under a **Held** heading that shows only while something is held;
if the screen shows the **Held** column, it sits there too.

The first column, **Overview**, lists each dish waiting or being made with how many, so you can see
at a glance how many of each to start. After a **+** it shows how many more are held
(**Pork shoulder 1 +2**). Dishes with something to make come first, and the heading shows how many
of them there are. Overview is a column like the others: tap its heading to collapse it, and move or
hide it in **Columns**.

Where the screen is too narrow for the columns switched on, it shows one column at a time, and the
columns become tabs in the same order (**Waiting · 2**). By default a held card takes no column of its own: its
**Held** heading sits inside **Waiting**. The first tab is chosen until you tap another. A hidden
column has no tab, and a collapsed column's tab still shows its cards. Opening a collapsed column
can leave the others too little room: the screen then turns to tabs and shows the column you opened.
To see the columns side by side again on that screen, hide columns in **Columns** until they fit. A
tab whose column holds a late card has a red bar under it; a collapsed column holding a late card
has one across its top.

A row above the columns shows how many dishes are still to make and how many cards are late, and
**Columns** at its end; above a single station's columns it also shows whether the station is open
today, and on a kitchen screen that nobody signs in on, the station's name (unless the station is no
longer available: then the line above its columns names it). Tap **Columns** to arrange the columns.
It lists **Overview**, **Waiting + Held**, **Waiting**, **Held**, **Preparing** and **Ready**: the
arrows move a column up or down the list, which is the order the screen shows them in, and **Show**
shows or hides it. At first the screen shows Overview, Waiting + Held (headed **Waiting** on the
screen), Preparing and Ready. A screen wide enough can show **Waiting** and **Held** as two columns
instead: switch both on and switch **Waiting + Held** off. While the screen has any card, a column
switched on is drawn even when it is empty. Two columns switched on that hold the same cards both
show them: with **Waiting + Held** and **Held** both on, a held card shows in both. Each change
shows at once; **Done** closes the window. This device keeps the order, the columns shown and the
collapsed ones, for each board, even after the screen restarts. A hidden column's cards still count
in the row. With every column hidden, the row and **Columns** stay, so you can bring a column back.

Each card carries its order's kitchen note and any printing problem. On a till, a card also offers
**Reprint**, and **Collect** once its order is paid and waiting to be collected; a kitchen screen
that nobody signs in on shows neither.

A dish leaves the kitchen screens as soon as the waiter marks it served; one served in part stays,
showing only what is left.

When a card has a dish that started without waiting for the pass, and its group has dishes for the
pass, the card shows, under its dishes, **Goes with** and the names of those dishes' stations, such
as **Goes with Grill and Pastry**
([Make a station wait for the pass](kitchen-service.md#station-waits)).

## Work the pass {#pass-screen}

The pass shows a card for each group of dishes a table sends, across all of its bills, and one for
each counter order. At first it shows the columns **To fire**, **In progress** and **Ready**, and a
card moves along them as its dishes do. A card whose dishes are all held sits at the bottom of
**To fire**, under a **Held** heading that shows only while something is held; if the pass shows the
**Held** column, it sits there too. A card is in **To fire** while it has dishes waiting for this
pass to fire them, in **In progress** while its dishes are at their stations, and in **Ready** once
every dish is ready. **Overview** is hidden until you show it in **Columns**, and then comes first.
It leaves out dimmed dishes and counts the rest as the kitchen screen's does, with dishes held or
waiting for the pass after the **+**.

A card's heading says what the waiter sent, **New order**, **Next course** or **Added** (a held card
says none of them), then its order number, table and group. It names a table by its [short
name](table-service.md#short-names), such as **T4**, or **T4+T5** for tables joined together. Its
minutes count from when the waiter sent it; a **Ready** card shows **Ready 3 min**, counted from
when its last dish was ready, and a held card shows none. The card's left edge takes the brand
colour, then turns red, as time passes since its dishes were sent, by their stations' late flags. A
ready dish keeps counting, so a **Ready** card turns red too. A dish sent too long ago says
**Forgotten**, and the row above the columns counts the red cards (**2 overdue**). Each dish shows
its state and station, such as **Preparing · Grill**; a held dish shows neither.

A dish whose [station waits for the pass](kitchen-service.md#station-waits) is not cooked until
the pass fires it. When the waiter
[requests cooking](kitchen-service.md#request-cooking), its card moves to **To fire** and the dish
says **Waiting for the pass · Grill**. Tap **Fire** on the card to send its dishes that wait for
this pass to their stations; the card then moves to **In progress**. If the table changed since the
screen last read it, nothing is sent and the screen says **The screen has been refreshed: check it
and press again.**

If a dish's station is closed, the dish says **Grill is closed: move the dish to another station
from the till, or open Grill for today**, and **Fire** stays off until one of those is done. An
extra going to a closed station of its own says **Grill is closed: Fire still sends it there**
instead, and **Fire** stays on.

Nothing this pass covers is dimmed until a station it covers waits for the pass, or one of its cards
holds a dish it covers that was sent to wait for the pass. While either is so, its dishes that wait
for this pass show in full, and the pass dims the dishes of its stations that do not wait and dishes
sent before their station began waiting: they say, for example, **Preparing · Already at Bar**. A
dish from a station or service zone this pass does not cover shows only on a card that also holds a
dish this pass covers, and is dimmed when drawn; while it waits for its own pass it says **Bar: waiting
for its pass**. Dimmed dishes are there for information only.

On a pass screen or a pass monitor, **Columns** also offers **Other stations' dishes**: **Use the
profile's setting**, **Show** or **Hide**. **Hide** takes the dimmed dishes off the cards; while
nothing this pass covers is dimmed, that is only dishes from stations and service zones it does not
cover. A card stays in its column with its buttons even when **Hide** leaves it no dish. **Hide**
changes only which dishes are drawn: a card's colour and the overdue count are the same as with
**Show**. The choice is this device's own and replaces the one a manager chose for the device in the
dashboard. There, under **Device profiles**, a profile's pass screen and pass monitor each have
**Show other stations' dishes on the pass**, on at first; under **Devices**, a device's **Edit**
window has the same setting for its pass screen or pass monitor, with **Use the profile's setting**,
**Show** and **Hide**.

On a card **In progress**, **Group ready** marks every sent dish of the table's group ready at every
station, not only the ones this pass shows, and on a counter order **Course ready**, followed by the
course's name, does the same for that course. Dishes not yet sent to be cooked, held or waiting for
the pass, stay as they are. **Fire** and these buttons show only on a device whose profile **Runs
the pass**. On a till, a card that is not held also offers **Reprint** for each of its bills.

A pass monitor shows the same board for watching, with no **Fire**, Ready or **Reprint** buttons. A
till whose device has no pass screen or pass monitor opens **Pass** on every station and service
zone, without **Fire**: only a pass screen fires.

Tap a column's heading to collapse it to a narrow strip that keeps its name and count; tap it again
to open it. **Columns**, at the end of the row above the columns, lists **Overview**, **Held + To
fire**, **Held**, **To fire**, **In progress** and **Ready**: the arrows move a column up or down the
list, which is the order the pass shows them in, **Show** shows or hides it, and **Done** closes the
window. **Held + To fire** is the column headed **To fire** on the board, with held cards at its
bottom. A screen wide enough can show **Held** and **To fire** as two columns instead: switch both on
and switch **Held + To fire** off. A column switched on is drawn even when it is empty. Two columns
switched on that hold the same cards both show them: with **Held + To fire** and **To fire** both
on, a card to fire shows in both. This device keeps the order, the columns
shown and the collapsed ones, for each board. Only when the columns switched on do not fit the
screen does the pass show them as sections of one list, in the same order; you collapse a section by
tapping its heading.

## Get help on a kitchen screen {#kitchen-help}

Tap **?** at the top right of a kitchen screen, before the theme and language buttons, to turn help
on. **?** marks then show on the first card and on **Columns** of each board, on **Changes to
orders** while there are changes to read, and on **Merged** or **Stacked** on a screen with more
than one station. On the pass they also show on the first **Course ready** or **Group ready**. Tap
a mark to read a short note
about that part; some notes link to this guide. The rest of the screen works as usual while help is
on.

Help goes off by itself two minutes after the screen was last touched, and a guide page opened from
a note closes with it. Tap **?** again to turn it off sooner. A till's **Kitchen** and **Pass**
screens show the same marks, apart from **Merged** and **Stacked**; there help goes off when the till
locks.

## Identical dishes share a row {#identical-dishes}

An order of 2 × Burger, from a table or the counter, reaches the kitchen as two dishes, so at a table the till can serve or move each
one on its own. The kitchen still reads them together: the station ticket, the kitchen screen and
the pass show them as one row of 2 while they are the same, and the ticket's **Also on this order** list and
correction slips such as **HOLD CHANGED** print them once. Dishes stay on separate rows when their
extras or notes differ, or when one is further along than the other. On the kitchen screen, tapping
a row, or moving it to another station, takes every dish in it. Weighed dishes always show and
print one by one, since each is weighed on its own.

## A dish sent after its period ended {#after-period}

On the till, an unsent dish whose period ended earlier the same business day shows a warning sign
and **Lunch ended**. When you send it from a table, or pay for, send or park the order at the
counter, the till first lists such dishes and asks you to check with the kitchen.
**Kitchen agreed — send** sends them, and **Remove them** takes them off the order. On a park the
button reads **Kitchen agreed — save**. The same window opens when the server finds such a dish before
the till has marked it.

If the till says a dish's period has ended without listing dishes, review the order and remove
dishes from ended periods before sending again.

A dish that the period now running also sells is not marked and is sent as usual. A dish left from
an earlier business day shows **Last orders have ended** and cannot be sent: at a table, **Remove**
takes it off and **Keep** leaves it in the order unsent, and at the counter you can take payment
only once it is removed.

A dish sent after its period ended earlier the same business day, once the kitchen agreed, carries a mark
with its period's name. On its kitchen ticket a line above it reads `** AFTER LUNCH — AGREED **`.
A divider ends that run before the next unmarked dish; a new group or station heading also ends it.
On the kitchen screen, the card shows **After Lunch — agreed** above it.

Each department sets whether sending such a dish needs a manager, or a manager's PIN, with
**Manager's PIN to send after a period ends** under **Courses and the kitchen** on its **Service**
tab in the dashboard. Off, anyone who can send confirms with the kitchen. When it is on and the
person sending is not a manager, the till asks for a manager's PIN after **Kitchen agreed**.

## Request cooking from the till {#request-cooking}

For a new venue in Spain, Sharing plates and Starters start without a hold; Mains and Desserts
start held for later. Choose the course on each product, then arrange the table’s dishes in **New order** before
sending them. At the counter, sending fires all the dishes together.

Request held food from the table's order screen. Station queues and the pass show held courses and groups
without a Fire button. On a station queue, held dishes stay dimmed and cannot be advanced by
tapping them; on the pass, a card whose dishes are all held sits under **Held** at the bottom of
**To fire**, or in **Held** if the pass shows that column. On the table's order screen, a dish says
**at the pass** while it, or one of its extras, waits for the pass to fire it.
Once released, a dish can move through preparation to Ready at its station. A dish whose [station
waits for the pass](kitchen-service.md#station-waits) goes to the pass's **To fire** column
instead: see
[Work the pass](kitchen-service.md#pass-screen).
While the server is out of disk space, moving a dish on is refused. The station says
**Not saved: the server is out of disk space. Tell a manager.** and the dish stays where it was.

Confirm allergy instructions in the table's allergy window before requesting cooking. At a
station or the pass, read the copy already attached to each dish. The kitchen screens do not open
the table's allergy editor. At the station, acknowledge any corrections.

A held group falls due a set number of minutes after the dishes fired before it have been
served. Set the delay under **Courses and the kitchen** on the department’s **Service** tab
in the dashboard. Choose **At once** to remind you as soon as those dishes are served, or **Off**
to turn the reminder off.

## Make a station wait for the pass {#station-waits}

To have the pass decide when a station's dishes are cooked, edit the station in **Prep stations**
and switch on **Waits for the pass**, under **Printers**. The stations table shows **Yes** or **No**
in its **Waits for the pass** column. When the waiter then requests cooking, the station's dishes go
to the pass's **To fire** column, and they wait on the station's screen until the pass fires them.
Switching it on or off decides only where dishes requested afterwards go; a dish already requested
stays where it is. A configuration export carries the setting.

A dish waiting for the pass that moves to a station that does not wait, by hand or when its station
closes for today, starts there at once, and its ticket says **From Grill**. Moved to another station
that waits, it keeps waiting.

A dish that does not wait for the pass starts at once. When its group also has dishes for the pass,
waiting for it or fired by it and not yet served, the dish's ticket and its card on the station's
screen say **Goes with** and the names of those dishes' stations, such as **Goes with Grill and
Pastry**: send it out with those dishes, not on its own. An advance HOLD
ticket never says it. A ticket says it as things stand when it prints; a reprint checks again.

Only a pass screen whose device can press **Fire** releases the dishes. For a station's dishes in a
service zone, that takes both of these:

- Under **Device profiles**, the device's profile offers a pass screen with the station and the zone
  in its lists: **Pass screen** in **Kitchen screens its devices may run** on a kitchen display,
  **Pass button** in **Screens it shows** on a till or handheld. It also has **Prepares orders** on
  in **What it can do**, and **Runs the pass** on in **Screens it shows**. On a till or handheld
  profile with a department, the zone must also be one it serves, under **Where it serves**.
- Under **Devices**, the device is enabled and its **Edit** window chooses the pass screen
  (**Screen** on a kitchen display, **Pass screen shows** on a till or handheld), with the station
  and the zone in its lists. A dish whose order has no service zone needs a pass screen on every
  zone.

You can save a station that waits even when no pass screen covers it. Until one does, **Prep
stations** says so above its tabs, zone by zone, for example: **Nothing fires dishes from Grill in
Terrace: no pass screen covers them there. Set one up under Devices.** When the venue has more than
one zone, a station no pass screen covers in any of them gets a single line: **No pass screen covers
Grill in any zone. Set one up under Devices.** The warning also names a station whose dishes are
already waiting for the pass with nothing to fire them, even once the station no longer waits. It
checks again when stations, zones, devices or profiles change, and every minute.

## Delete a prep station {#delete-prep-station}

Choose **Delete** from the station's row menu. The window shows **Checking what changes…**
while it reads the impact. Review **Work that ends** and **Settings that are removed**
when those sections appear, then decide whether to delete the station.

## Choose the language on kitchen paper {#paper-language}

To change the fixed words on kitchen tickets and collection-number slips, change the default
under **Settings**, then **Content languages**. A Spanish default prints Spanish headings; other
defaults use English until their kitchen wording is available. With no saved content language,
kitchen paper uses English. Your dashboard language and receipt language have their own choices.

The next new ticket, correction or kitchen reprint uses the saved default immediately. Changing
the default prints nothing by itself. Resending a failed job keeps its original words.
Dish names, table names and your notes stay as recorded. A reprint keeps the original allergy
instructions and selects their recorded English or Spanish wording to match its headings.

To print a card slip when taking payment, select **Print card slip** before Card. It starts off for each payer.

To recover a card slip before the bill is fully paid, use [Print a copy in Payments](table-service.md#reader-slips).

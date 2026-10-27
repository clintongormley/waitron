# Kitchen service

When a guest needs special care, you need to know which dish is theirs and what to avoid.
Record the guest and assign their dishes through the table's
[allergy window](products.md#table-allergies). The kitchen receives those instructions with its work.

## Retry a counter send after a lost reply {#counter-send-retry}

If the till cannot confirm a counter send, retry with the basket unchanged. When the first send
already reached the server, the retry returns its original result and moves the till on as placed.
It adds no second kitchen ticket or collection-number slip. While the box is out of disk space,
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
clash and says it was sent anyway. Missing nutritional information does not establish that a dish
is suitable. Check it with the waiter before preparing it.

The kitchen keeps the instructions it first received. Later guest or catalogue edits do not
silently replace the original block on the dish card, the pass or a reprint.

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
stations it serves. A table with more than one bill gets one notice and one slip for each bill.

## Keep advance HOLD instructions with the work {#held-work}

A held dish can reach a station on an advance HOLD ticket. That station keeps the allergy copy
sent with that ticket and receives corrections while its work remains unserved. A station that
has received no advance ticket takes its first copy when the dish is fired.

A station set to **Print held groups in advance** when a group is held receives its HOLD ticket;
another station set so may start getting the group's HOLD paper later: a HOLD ticket when a held
dish is moved to it, or a HOLD CHANGED slip when a held dish is added to the group there. A station
that has the group's HOLD paper keeps getting it, its corrections and the ticket marked FIRE, even
if its switch is turned off. Any other station prints its part unmarked when the group is fired,
unless it shares a printer with a station that has the group's HOLD paper: that printer's ticket
marked FIRE carries both.

Firing held work at the same station does not duplicate an existing allergy correction. Recalling
a dish into a draft ends its old kitchen work. Sending that draft again creates a new kitchen copy
from the instructions you confirm for that send.

## Reprint the original, then check its notices {#reprints}

A reprint repeats the original allergy block. It does not issue another correction notice, so
check the station's outstanding notices separately. Splitting dishes between bills keeps the
copies with the resulting kitchen work; it does not replace the guest's instructions.

A reprint's heading shows when it was reprinted (`*** REPRINT 15:20 ***`). The time under the
order number stays the time the first of its dishes was sent.

## Keep food visible until service ends {#service-lifetime}

A paid bill can still have food waiting for its guests. The pass and its monitor keep that food
visible until you mark it served or finish the table's service; food a finished table sends to the
counter stays until the order is handed over (below). The pass has no separate Done or Away action. Ready dishes keep their Ready label and late flags while they wait to be served. If tables have joined another
party, their paid bills stay visible until the surviving party finishes.

On the table, a ready dish stays **Ready** in its detail window until you mark it served.
The Sent list keeps showing how long it has been ready so you can see what still needs serving.

In a table's details on the floor, every unserved ready dish counts as ready. When the station
chips show those counts, the progress line leaves them out so you see each dish counted once.
The floor's table card also keeps every unserved ready dish in its ready count. A station's ready
chip replaces that count on the card, so you see it once while deciding what to serve.

When you serve one of two dishes on a line, the pass shows the one still to serve. Undo restores
the served quantity without restarting the kitchen's preparation or ready time. A cancelled
quantity no longer counts as food to serve, even when its charge stays on the bill.

A counter order stays visible after payment until you collect or close it. When a paid table
finishes with **They'll collect it at the counter**, its food still to come becomes such an order:
each station with a dish still to come on it is told it moved to the counter, and prints a **MOVED**
slip when its **Print a slip when sent dishes move table** setting is **Print**; the food stays
on the pass until the order is handed over. Each pass still shows only the stations and service
zones assigned to it.

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
whether it prints held groups in advance, and whether a dish already sent to it can be recalled or
changed, under **Identical dishes on a kitchen ticket**, **Print held groups in advance** and
**Changes after sending**: **Not allowed**, **While held**, or
**While held or waiting**. A dish the kitchen has started is never recalled. A dish that went to no
station, with no extra that went to a station of its own, can be recalled whatever the stations
allow.

## Work the kitchen screen {#kitchen-screen}

The kitchen screen shows a card for each group of dishes a table sent, and one for each counter
order. A card names its table by the table's short name; a counter order with no table reads
**Counter #12**. A card sits in the column of its least advanced dish, **Waiting**, **Preparing** or
**Ready**, with the card that has waited longest first. Tap a column's heading, which shows how
many cards the column holds, to collapse it to a narrow strip that keeps its name and count
(**Ready · 3**); tap it again to open it. The screen remembers which columns are collapsed, for each
station, even after it restarts. Tap a dish to move it on one step, or tap
the card's heading to move the card on: only the dishes holding it back move, so a dish already
further on stays where it is. The band along a card's top turns from green to amber to red as it
waits, by the station's late flags, and a forgotten card's band pulses; it holds still on a device
set to reduce motion. A card whose dishes are all held is dashed, shows no minutes and waits under
**Waiting** until the waiter [requests cooking](kitchen-service.md#request-cooking).

The first column, **Overview**, lists each dish waiting or being made with how many, so you can see
at a glance how many of each to start. After a **+** it shows how many more are held
(**Pork shoulder 1 +2**). Dishes with something to make come first, and the heading shows how many
of them there are. Overview is a column like the others: tap its heading to collapse it, and move or
hide it in **Columns**.

Where the screen is too narrow for its columns, it shows one column at a time, and the columns
become tabs in the same order (**Waiting · 2**). The first tab is chosen until you tap another. A
hidden column has no tab, and a collapsed column's tab still shows its cards. Opening a collapsed
column can leave the others too little room: the screen then turns to tabs and shows the column you
opened. To see the columns side by side again on that screen, hide columns in **Columns** until
they fit. A tab whose column holds a late card has a red bar under it; a collapsed column holding a
late card has one across its top.

A row above the columns shows how many dishes are still to make and how many cards are late, and
**Columns** at its end; above a single station's columns it also shows whether the station is open
today, and on a kitchen screen that nobody signs in on, the station's name (unless the station is
no longer available: then the line above its columns names it). Tap **Columns** to arrange the
columns: the arrows move a column up or down the list, which is the order the screen shows them in,
and **Show** hides or shows it. Each change shows at once and stays on this device; **Done** closes
the window. A hidden column's cards still count in the row. With every column hidden, the row and
**Columns** stay, so you can bring a column back.

Each card carries its order's kitchen note and any printing problem. On a till, a card also offers
**Reprint**, and **Collect** once its order is paid and waiting to be collected; a kitchen screen
that nobody signs in on shows neither.

## A dish sent after its period ended {#after-period}

On the till, an unsent dish whose period ended earlier the same business day shows a warning sign
and **Lunch ended**. When you send it from a table, or pay for, send or park the order at the
counter, the till first lists such dishes and asks you to check with the kitchen.
**Kitchen agreed — send** sends them, and **Remove them** takes them off the order. On a park the
button reads **Kitchen agreed — save**. The same window opens when the box finds such a dish before
the till has marked it.

A dish that the period now running also sells is not marked and is sent as usual. A dish left from
an earlier business day shows **Last orders have ended** and cannot be sent: at a table, **Remove**
takes it off and **Keep** leaves it in the order unsent, and at the counter you can take payment
only once it is removed.

A dish sent after its period ended earlier the same business day, once the kitchen agreed, carries a mark
with its period's name. On its kitchen ticket a line above it reads `** AFTER LUNCH — AGREED **`.
On the kitchen screen, the card shows **After Lunch — agreed** above it.

Each department sets whether sending such a dish needs a manager, or a manager's PIN, with
**Manager's PIN to send after a period ends** under **Courses and the kitchen** on its **Service**
tab in the dashboard. Off, anyone who can send confirms with the kitchen. When it is on and the
person sending is not a manager, the till asks for a manager's PIN after **Kitchen agreed**.

## Request cooking from the till {#request-cooking}

Request held food from the table's order screen. Station queues and the pass show held courses and groups
without a Fire button. Held dishes stay dimmed and cannot be advanced by tapping them.
Once released, a dish can move through preparation to Ready at its station.
While the box is out of disk space, moving a dish on is refused. The station says
**Not saved: the box is out of disk space. Tell a manager.** and the dish stays where it was.

Confirm allergy instructions in the table's allergy window before requesting cooking. At a
station or the pass, read the copy already attached to each dish. The kitchen screens do not open
the table's allergy editor. At the station, acknowledge any corrections.

A held group falls due a set number of minutes after the dishes fired before it have been
served. Each department sets those minutes, or turns the reminder off, under **Courses and the
kitchen** on its **Service** tab in the dashboard.

## Delete a prep station {#delete-prep-station}

Choose **Delete** from the station's row menu. The window shows **Checking what changes…**
while it reads the impact. Review **Work that ends** and **Settings that are removed**
when those sections appear, then decide whether to delete the station.

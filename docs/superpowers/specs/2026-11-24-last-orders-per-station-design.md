# Last orders per station: design

Status: approved by the owner in conversation, 24 November 2026 ("y"), after reading the list of the
writer's calls; those stay marked **my call** below. A1568.

Decisions marked **owner** were made by the owner in conversation on 24 November 2026 unless another
date is given. Decisions marked **my call** are the writer's, for the owner to check. Statements
about today's code cite `file:line` on `main` at `cc4fc8a1b7` and come from reading the code, not
from running it, unless a sentence says otherwise.

## Why

The owner, 24 November: Lunch runs 13:00–15:00. Cooked dishes stop when the kitchen does, desserts
can be ordered for an hour after Lunch, and after that only drinks until dinner. Today this takes
three periods and menus arranged around them, "rather clumsy, especially when the desserts form part
of the set menu which appears on the Lunch menu. I don't want users to have to hack our system to
make this function. It should feel natural and easy."

The owner's rule, the same day: "things that go to the kitchen (starters, mains, and desserts which
require cooking) need to be ordered by eg 15 minutes before the end, ie last orders"; "things that
can be served by the waiter (or dessert station) can be ordered up to eg 1 hour after lunch even
though it doesn't appear on a menu in the current period, but does appear on a menu that was started
during the lunch period"; "So each prep station has a time adjustment on the period. and we need
keep the menu available (but just show items that can be prepared now)".

Two gaps in today's till lie behind it:

- Once Lunch has ended, the till does not let a waiter tap an à la carte dessert unless the next
  period's menu sells it (`apps/till/src/screens/till-table-order-screen.ts:1869-1872`). The server
  would ask "Station agreed" for one that reached it (`apps/server/src/working-order.ts:821-824`).
- While some period is running, a table holding a set menu can order any dish from its recorded copy
  after Lunch, a cooked main included, with no question (`apps/server/src/working-order.ts:760`, `:808-817`).

## The model in one paragraph

A period keeps the hours the restaurant says: Lunch is 13:00–15:00. On the period, each prep station
has its **last orders**, a time before, at or after the period's end: Kitchen 15 minutes before, Bar
1 hour after. A dish can be ordered while the station that would receive it is still taking orders
for that period. After the period ends, only tables that ordered during it can go on ordering from
it, and the till's menu shows them only what can still be made.

## Goals

1. Lunch, with desserts for an hour afterwards, is one period and one menu (**owner**).
2. The set menu's dishes follow the same times as any other dish (**owner**, through "things that go
   to the kitchen" and "things that can be served by the waiter").
3. A table that ordered during a period can order from that period's menu until its stations stop,
   even though the running period's menu does not list those dishes (**owner**).
4. The till's menu shows only what can be prepared now (**owner**: "just show items that can be
   prepared now"). Two exceptions, both **owner**: a stopped dish stays on the menu, faded, until the
   period ends, and after that a table that ordered during the period can still find it by searching
   (section 4).
5. A waiter is told before a station stops, and what has stopped once it has (**owner**, from
   pictures).

A venue that sets nothing keeps every station **At the end**. What it sees that it does not see today:

- the warning and clocks in a period's last ten minutes;
- an open table's menu held when its period ends;
- a Lunch table finding stopped dishes by searching;
- no question when a held set-menu dish is fired late, or for a dish the running period sells only
  inside a set menu;
- a question for a set-menu dish ordered after its period (section 6; **owner**: "they should set last
  orders. nothing is live, we don't need bwc").

## Non-goals

- Hours of a station's own. The owner removed them on 7 October (A366: "one idea instead of three").
  Last orders belong to a period and move with its painted hours.
- Selling a period's dishes to new customers after it ends. The owner accepted on 24 November that a
  walk-in at 15:20 is refused a dessert Afternoon does not sell ("yes").
- Last orders per dish, category or course. A venue that wants rice to stop at 14:30 gives rice its
  own station.
- The online guest menu. It is a published copy of the default menu and does not follow periods
  today (`apps/server/src/guest-menu-page.ts` and `cloud-guest-menu.ts` read no period), so nothing
  there changes.
- Staffing needs. They are painted and are not moved by last orders. The station hours drawn behind
  them in the painter do follow (section 7).

## Anti-goals: what would make this a failure even if it worked

- A dessert vanishes at 14:45 and comes back at 15:00.
- A waiter cannot tell that a dish has stopped, or cannot find out why.
- A menu moves under a waiter's finger while they are taking an order.
- A dish the kitchen has agreed to make cannot be sent.
- An order is refused because a station has no setting.
- The bill's price for a dish already on it changes because a period ended.

## Approaches considered

The owner chose **4** on 24 November, having proposed it ("how does that sound?", then "yes that
looks great").

1. **Extra periods and menus (today's way).** Nothing to build. It is the clumsy arrangement the
   owner described, and it was the October design's own answer ("Lunch and Afternoon both include
   Desserts",
   [service times design](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md), section 4).
2. **One longer period, with categories that stop early.** Lunch is painted to 16:00 and Starters
   and Mains stop at 15:00. Needs desserts in categories of their own, makes Lunch's painted hours
   differ from what the restaurant says, and sells desserts to walk-ins.
3. **A whole-period offset.** Built as A432 and removed in A789 (owner, 17 October: "Lunch is when
   you can order lunch"). It stops every dish together, so it cannot let desserts outlast mains.
4. **Last orders per station, per period (chosen).** "Each prep station has a time adjustment on the
   period" (**owner**). Who makes a dish decides when it stops, so a hot dessert stops with the
   kitchen and a cold one does not. The cost: cold desserts now routed to the Kitchen must go to
   another station or to No preparation.

## The parts, as decided

### 1. Setting it up (dashboard)

The period form gets a **Last orders** section (**owner**, "yes", from a picture): the heading, one
**Prep stations** link beside it, one sentence, "After Lunch ends, its dishes stay on sale only for
tables that ordered during Lunch", with the period's own name, and one field per station.

- One field per station that can get orders from the period's menus, worked out from Prep stations.
  That includes a station that only gets them once another has stopped (section 2), and **No
  preparation** when some dish is sent there. Nobody adds stations to the list by hand.
- Each field is one list: 1 hour, 45, 30 and 15 minutes before the end; **At the end**; 15, 30 and
  45 minutes, 1 hour, 1½ hours and 2 hours after the end. Every station starts at **At the end**.
- Nothing else. No clock times, beside a field or in its list (**owner**: "showing the absolute
  times makes this confusing, stick to before/after"), and no description of what each station makes
  (**owner**: "not sure how feasible this is. also i find the sentences confusing"; where a dish goes
  varies by zone, dish and period). With the times gone, so is any warning that a day's block is
  shorter than the minutes chosen: on that day the station takes no orders for the period.
- No usual setting on the station for periods to follow (**owner**, "y" to leaving it out).
- A period's last orders follow each painted block, on each season and special day. Two blocks of one
  period that do not touch each have their own last orders; touching blocks are one, as today
  (`serviceRuns`, `packages/venue-service/src/menu-timetable.ts`).
- Last orders past the end of the business day stop at its end (**my call**).
- The settings travel in the configuration export, and deleting a station removes its settings
  (**my call**).

In Prep stations, the window's **Any other time** field is relabelled **Any other time, and after last
orders** (**owner**, "yes", told that it is not exact when another period starts the moment this one
ends). Nothing else there changes: a cell already takes a station per period and one for any other time
(`packages/venue-service/src/routing.ts:193-198`, `routing-cell-editor.ts`).

### 2. Is this dish on sale?

For one dish, one table and one moment, in this order; the first step that puts the dish on sale wins.
A period **sells** a dish when any of its menus does, its main menu or one waiters can switch to
(**owner**, "yes"), à la carte or inside a set menu (**my call**).

1. **The running period sells it.** Find the station that would receive it now: the routing for this
   zone, period and day, "Close for today" included (`chooseMaker`,
   `packages/venue-service/src/routing.ts:269`). Before that station's last orders for this period,
   the dish is on sale.
2. **That station has stopped, and the period is still running.** The dish goes wherever it would go
   once the period has ended: the next period's routing when one starts as this one ends, otherwise
   **Any other time**. If that station is still taking this period's orders, the dish is on sale and
   is sent there (**owner**, "the 14:45 rule"). This looks one step ahead only. If the next period
   starts as this one ends and sells the dish too, the dish also stays on sale, sent where that
   period sends it: a toast sold at Lunch and all afternoon does not stop for 15 minutes (**my
   call**). Otherwise go to step 3.
3. **An ended period.** If this table ordered during a period that ended today, and that period sold
   the dish, find the station that would receive it now (the running period's routing, or Any other
   time). Before that station's last orders for the ended period, the dish is on sale to this table.

A dish that no step puts on sale has **stopped** (section 4) when the running period sells it, or when
an ended period this table ordered during did. To any other table, a dish the running period does not
sell is not shown and cannot be found.

The worked example, with Desserts routed to Kitchen during Lunch and Bar at any other time, Kitchen
15 minutes before and Bar 1 hour after:

| Ordered at | Desserts | Mains |
|---|---|---|
| 14:30 | Kitchen | Kitchen |
| 14:50 | Bar | stopped: on the menu, faded |
| 15:20, table ordered during Lunch | Bar | stopped: search only |
| 15:20, new table | not on sale | not on sale |
| 16:00, table ordered during Lunch | stopped: search only | stopped: search only |

Other rules:

- **Whom a stopped dish asks.** Of the stations that take this dish for the period, the one that
  stopped last is the one named, asked, and sent the dish if it agrees (**owner**, "ok"). A main at
  14:50 is Kitchen's. Flan at 16:30 is Bar's, which took over from Kitchen. Flan at 14:50 is Kitchen's
  if Bar had stopped at 14:30.
- **Choosing a station by hand** changes where the dish goes, never whether it has stopped (**my
  call**: otherwise picking Bar for a late main would skip the question and the manager's PIN). Extras
  added to a sent dish are judged by the station that has the dish (**my call**).
- **No preparation** has its own last orders. A stopped dish of it fades and has the clock like any
  other, but there is nobody to ask, so it is sent without the question (**owner**, "y").
- **A station closed for the day.** A dish goes to the station standing in, and stops at that station's
  own last orders (**owner**, "yes"); a stand-in with no field for the period stops **At the end**. A
  dish with nowhere to fall back to is not made, as today.
- **Extras follow their dish** and never stop it or outlast it.
- **A dish both periods sell** stays on the ended period's menu too, at that period's price, for as
  long as step 3 holds (**owner**, "yes"). It counts towards a set menu whichever menu it came from.
- **No next period.** Step 3 works when the department has no running period, so a table can still
  have its dessert. With no running period the till draws no menu today
  (`till-table-order-screen.ts:4418-4425`, `till-counter-screen.ts`'s `#menu`), so this is new work on
  both screens. This includes the last period of the night, where it keeps existing tables ordering
  without opening new ones.
- **A closed zone** still refuses new dishes (`assertZoneTakesNewOrders`).
- **Keeping a period or zone open** from the till is unchanged; last orders follow whatever end time
  is in force.
- **When the venue's clock cannot be read**, every menu is orderable today
  (`departmentService`'s `moment === null` case, `menu-timetable.ts`), and last orders are not
  applied.
- **A bill moved to another department's zone** does not carry its period along: step 3 looks only
  at periods of the zone's own department (**my call**). A dish already on the bill is still judged
  by the department it was stored in, as today (`working-order.ts:2301-2314`), with that department's
  last orders.

### 3. "Ordered during"

- A table counts once its bill holds at least one dish ordered while the period ran, whatever the
  dish, a beer included (**owner** accepted: "the table ordered anything during Lunch").
- **Table** means the party: any of its bills, and a bill that a dish was moved or split onto, count
  alike. Parties joined together count if either did. A Counter or takeaway bill counts by itself,
  while it is open (**my call**).
- A dish on the bill counts whether it is sent or held. A dish cancelled since still counts
  (**my call**: the table did order).
- A first order typed at 14:58 and sent at 15:05 counts too (**owner**, "y"): its dishes are judged
  by section 2, step 3, so a main asks, a dessert the Bar makes goes to the Bar with no question, and
  the table can go on ordering from Lunch afterwards. Somebody who sat down at 14:55 and ordered at
  15:02 does not count (**owner**).
- The till enforces this rule: it does not show the ended menu to a table that does not count. The
  server does not refuse an ended period's dish because the table did not count, only because its
  station has stopped (**my call**). No line records today when it was added
  (`apps/server/src/working-order.ts:2285-2289`), so the server could not tell the first order above
  from a walk-in's. What the till shows still needs a stored fact; which, and where, is the
  builder's.

### 4. Before and after a station stops

The look is the **owner**'s, from pictures, except where marked.

**In the last ten minutes before a station stops:**

- The till's heading says "Kitchen last orders in 10 min", counting down, so nobody has to look at the
  clock.
- Each dish that will stop then has a clock and keeps its normal colour. A dish that stays on sale,
  because another station takes it over or the next period sells it, has no clock. A dish of a
  station that goes on after the period (Flan, Bar 1 hour after) has no clock either.
- A section's tile has the clock when everything in it has one.

**Once it has stopped, while the period runs:**

- The heading says "Kitchen closed". The dish keeps its clock and fades. It must not look sold out,
  because it can still be tapped. No tile moves.
- Tapping it adds it to the New order, with the warning sign a dish whose period has ended has today,
  worded "Kitchen closed" (**my call** on the wording).
- A long press opens the product window, which says "Kitchen closed".

**Several stations.** The heading lists every closed station that has faded dishes on the menu shown
("Kitchen and Grill closed"), and beside them the soonest one within its ten minutes ("Kitchen closed
· Bar last orders in 8 min"); stations stopping at the same minute are named together. A station is
named only for a dish on the menu shown that has stopped or will stop. No preparation is never named;
its dishes still have the clock and fade (**my call**). On a phone the words have a line of their own.

**When the period ends,** its stopped dishes leave the menu and "Kitchen closed" goes with them (but
section 5: an open table's menu stays put). A table that ordered during the period can still find a
stopped dish by searching (**owner**, "A"): it is under a heading with the period's name, faded, with
the clock, no words, and the same long press. Tapping it adds it.

**Sending asks**, in the existing window:

- Heading "Kitchen closed at 14:45", then "Check with Kitchen before sending:" and the dishes.
- **Cancel**; **Remove it**, as today: it takes them off the order and sends nothing; **Send the rest**,
  new: it sends the other dishes and leaves these in the New order; **Kitchen agreed — send all**. On a
  phone the buttons are stacked. Send the rest is offered only when sending a New order that also
  holds a dish that does not ask (**my call**).
- Late dishes of more than one station each have their own heading and list, and the button reads
  "Stations agreed — send all" (**my call**).
- A manager's PIN is asked for when the department requires it, as today. That setting's label
  becomes "Manager's PIN to send after last orders" (**my call**).
- An agreed dish goes to the station that agreed (section 2, "Whom a stopped dish asks"). Today a
  confirmed late dish goes to its period's own station (A1084, `late_period_id`), which is not enough
  when the takeover station stopped last.
- The window's other uses today keep their own words for the same choices: "Don't add them" for extras,
  "Don't send them" for stored dishes, "agreed — save" for parking.

"Last orders have ended" already means something else on the till: a dish that cannot be sent at all
(`menu.last_orders_ended`, `basket.blocked.period_ended`, `apps/till/src/i18n/strings.ts`, and the
kitchen guide). Those are reworded in this build. "Closed" also names a station closed for the day
(`pass.station_closed_dish`); the owner was told and chose "Kitchen closed" for its plain meaning,
closed to new orders.

**The existing late-dish checks change what they test, from "its period has ended" to "it has stopped
under section 2".** What each does about a late dish stays (**my call**):

- Sending from a table, parking, placing a parked order, paying for or sending a new Counter order,
  and adding extras to a sent dish **ask**.
- Paying a saved Counter bill and moving a bill **mark** the dish and ask nobody
  (`till-sale.ts`, `move-bill.ts:645`).
- Raising the quantity of a dish already on the bill is **refused** once its own period's stations have
  stopped, even if the running period sells it at a price of its own, as today (`STORED_RISE`,
  `working-order.ts:637-641`); the waiter can add it as a new dish.
- Firing a held dish asks nothing, in a set menu or not, since the station has had it since it was
  sent. Today a held set-menu dish asks and an ordinary one does not (`order-groups.ts:474-507`).

So a dessert parked at 14:50 and placed at 15:20 asks nothing, and a main added at 14:40 and sent at
14:50 asks.

- A dish agreed late is marked "After last orders — agreed" on the ticket and the station screen, in
  place of "After Lunch — agreed": one mark, before or after the period ends (**my call**).

### 5. The till's menus

**A dropdown replaces the row of menu buttons** (**owner**: "there's not much space on a handheld. i
think we should change to a dropdown"), from a picture:

- **Menu**, in the same row as Search and the filter, on every screen size, for tables and the
  Counter. Shown when there is more than one menu to choose, as the buttons are today.
- It lists every menu available in the current period, staff menus included (**owner**: "the waiter
  should be able to change menus to any menu that is available during the current period").
- The filter button becomes an icon (**owner**), keeping its name for screen readers and its count of
  filters in use.

**After a period ends:**

- A table that ordered during it also gets, for each of its menus with something still to order, an
  entry with that menu's name: **Lunch, until 16:00** (the closed field says "Lunch"), **Wine list,
  until 16:00** (**owner**, "yes"). The time is the latest at which anything on it can still be ordered
  under step 3. It holds every dish still on sale to that table under step 3, a drink the running
  period also sells included, in their usual sections and at that menu's prices; an empty section is
  not shown. The running period's menu opens first.
- With no running period, the ended period's menus are the only ones.
- A table that did not order during the period sees the running period's menus alone.
- Two ended periods can each be in the list at once.

**An open table keeps the menu it has** (**owner**, "yes"). When the period ends while a waiter has a
table open, no tile moves: the heading says "Lunch ended", and the new menus show when the table is
next opened or the waiter picks one in the dropdown, which is up to date. Only the layout is held
back. What has stopped, and what asks, follows the clock: the marks and the heading change on time
without a reload, through the same refresh that notices a period ending today, and a dish already in
the New order is never dropped. A Counter order keeps its menu until it is sent, paid or cleared
(**my call**). A table that did not order during the period and has nothing in its New order is the
exception: it goes to the new menus when the period ends, or it would be shown dishes it cannot order
(**owner**, "y"); so does a Counter order with nothing on it (**my call**).

### 6. Set menus

This changes one part of the
[set-menu design approved earlier on 24 November](2026-11-24-set-menus-automatic-grouping-design.md),
section 3.

- **Ordering a dish links set menus as it would have during the period.** A dish sold from an ended
  period links the set menus that period sells, so a first order agreed at 15:05 is still charged as
  the menú del día when that is cheapest (**my call**).
- A linked set menu still keeps its price and still groups dishes for as long as the bill is open.
  Linking decides the **price**; this design decides whether a dish can still be **ordered**.
- A dish from a linked set menu follows section 2 like any other (**owner**). A main at 17:00 needs
  the Kitchen's agreement.
- That design's example, a table that sat down at 15:30 having its desserts at 16:15, still works
  when the station that makes the desserts has last orders late enough. With every station left
  **At the end**, the table finds them by searching and the send asks, where today it asks nothing.
- Grouping never changes because a station has stopped.

### 7. Worked-out station hours

The station hours in the Calendar, and behind the staffing painter, are worked out from periods, menus
and routing (`packages/venue-service/src/station-service-times.ts`, `planned-service-guides.ts`). Last
orders after the period's end lengthen them: Bar shows until 16:00. Last orders before it do not
shorten them: Kitchen still shows until 15:00, "because they're still cooking and cleaning"
(**owner**). Staffing can be painted past them, and **Keep open** moves the end, as today; nothing more
is needed (**owner**, "it's enough"). Period blocks, floor plans and the department's open hours are
not changed.

### 8. Guides and demo

- The English and Spanish guides for opening hours, kitchen service (its "A dish sent after its
  period ended" section) and table service.
- The demo's Lunch gets last orders: Kitchen 30 minutes before, Bar 1 hour after, with Desserts sent
  to Bar at any other time (**my call**).

## Fiscal and data

No fiscal record, total or invoice number is touched. A dish added after its period uses its own
menu's price, as a late dish does today. No venue is live, so no data is carried forward.

## The pieces, for planning

1. **The menu dropdown and filter icon.** Needs nothing else here; it can be built first and land by
   itself.
2. **Settings and the period form:** storage, export and import, the form section, the Prep stations
   label, station hours in the Calendar.
3. **The server's rule:** "ordered during", section 2, the late checks, sending to the right station,
   set-menu dishes. It edits the same code as the set-menu rework's piece 3, so it goes after it.
4. **The till:** warnings, clocks and fading, search, the ended menus (with no running period too), the
   held menu, the window. After
   piece 3, and after the set-menu rework's piece 4.
5. **Guides and demo.** Each piece updates the guide for the screens it changes, as CLAUDE.md asks;
   this piece is the demo and what is left.

Piece 2 can start now but must not land before piece 3 can follow it: a setting that does nothing
misleads.

## Left to the builder

- Table and column names, and how the settings and "ordered during" are stored.
- How the till learns each dish's state: worked out on the server per table, or from times it is sent.
- Error codes, named for the domain (CLAUDE.md section 3).
- Screen layout details within what the owner saw, and Spanish wording.
- How the read stays cheap on the sale path (CLAUDE.md: shared menu data is resolved once before a
  basket's line loop).

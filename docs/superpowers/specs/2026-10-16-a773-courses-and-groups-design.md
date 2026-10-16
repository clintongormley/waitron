# A773. Courses, groups and the pass — design

Status: written 2026-10-16 from an owner brainstorm; **revised 2026-10-17** from a second owner
brainstorm on the table screen's order panel. Every decision in the revision is the owner's unless it
is marked "builder's call"; its wording awaits the owner's review. Built so far, on the unlanded
A773-1 branch: the course switch, the draft line's placement fields and a placement model.

It replaces three things in the service design
([2026-09-20-service-ordering-and-billing-design.md](2026-09-20-service-ordering-and-billing-design.md)
§3): the four draft actions, the later-addition destination choice and the venue-wide fire control.
It also changes A756's approved settings move. It resolves A738's open point on how a later addition
is grouped and sent.

**What the 2026-10-17 revision changed:**
- The table screen's right-hand panel is redesigned (section 3). Today's three lists (Current
  orders, To serve, Served) become one panel: a **Sent** box (Served, Fired, Held) above a **New
  order** box that empties when it is sent. The merged "already sent plus held groups" list of the
  first version goes.
- Sent dishes have no tick boxes. A sent dish is acted on through A738's line window, whose ⋯ More
  menu replaces the six buttons on every row (section 3.7).
- Give away and Discount become one **Discount…** window (section 3.8). Cancel becomes **Cancel
  item…** (section 3.9).
- **Recall brings a sent dish back into the New order** (section 3.10). Today it returns a fired
  dish to held.
- The later-addition placement rule is corrected (section 2).
- **Pay is refused while the bill has unsent dishes**; a paid bill's held dishes can still be fired
  and served (section 4).
- **Away goes.** The pass keeps a ready dish until it is served or the table is cleared (section 5).
- A773-1's six open points are answered (section 14).

## Mock-ups

Every screen, drawn with one story (Table 4; Starters not held, Mains and Desserts held; Bar does
not wait for the pass, Cold and Grill do), in
[`docs/backlog/mockups/a773-courses-and-groups/`](../../backlog/mockups/a773-courses-and-groups/):

1. [Table screen, first order](../../backlog/mockups/a773-courses-and-groups/01-first-order.png)
2. [Making a new group](../../backlog/mockups/a773-courses-and-groups/02-new-group.png)
3. [Table screen, adding later](../../backlog/mockups/a773-courses-and-groups/03-adding-later.png)
4. [Handheld at phone width](../../backlog/mockups/a773-courses-and-groups/04-handheld.png)
5. [A station that waits for the pass](../../backlog/mockups/a773-courses-and-groups/05-grill-station.png)
6. [Pass screen](../../backlog/mockups/a773-courses-and-groups/06-pass-screen.png)
7. [A station that does not wait for the pass](../../backlog/mockups/a773-courses-and-groups/07-bar-station.png)
8. [Printed tickets](../../backlog/mockups/a773-courses-and-groups/08-tickets.png)
9. [Courses page](../../backlog/mockups/a773-courses-and-groups/09-courses-page.png)
10. [A station's settings](../../backlog/mockups/a773-courses-and-groups/10-station-settings.png)
11. [Counter order](../../backlog/mockups/a773-courses-and-groups/11-counter-order.png)

Added by the 2026-10-17 revision, in
[`docs/backlog/mockups/a773-order-panel/`](../../backlog/mockups/a773-order-panel/):

12. [The order panel, collapsed and opened](../../backlog/mockups/a773-order-panel/01-order-panel.png)
13. [Sending empties the New order](../../backlog/mockups/a773-order-panel/02-sending-empties-the-new-order.png)
14. [The line window after sending, and Discount…](../../backlog/mockups/a773-order-panel/03-line-window-after-sending.png)

Pictures 1, 3 and 4 show the first version's merged list: their arrangement of Fire now and held
groups still holds inside the New order box, but where they show already-sent lines, pictures 12–14
replace them. Picture 6's Away goes (section 5).

Where a picture and this text disagree, the text wins. The pictures show layout, not exact
wording or colours: those follow the design system.

## Words used here

- **Group:** dishes of one table that are sent, held and fired together. Groups belong to the table
  (the party), not to a bill.
- **Held:** sent to the kitchen, but not to be cooked yet.
- **Fire:** "cook this now". Only the waiter fires.
- **Requested:** the waiter fired it, and it is waiting for the pass to release it to a station that
  waits for the pass.
- **Fired:** on the waiter's screen, everything fired and not yet served: requested, waiting,
  preparing and ready.
- **Ready:** the kitchen has cooked it; it is waiting to be taken to the table.
- **New order:** the waiter's unsent dishes for the bill on screen (the first version's "unsent
  list"). It empties when sent.
- **Recall:** bring a sent dish back into the New order.

The life of a dish:

```
not sent ──Send──► held ──Fire──► [requested ──pass Fire──►] waiting ──► preparing ──► ready ──► served
   ▲                 │                                         │
   └──── Recall ─────┴─────────────────────────────────────────┘   (only while not started)
any state ──Cancel item──► off the kitchen (charged or not: 3.9)            served ──Not served──► back to where it was
```

The waiter may mark a dish served from any fired state: a printer-only station never marks anything
preparing or ready. A dish that no station makes has no kitchen state; it goes from sent to served.

## 1. Courses

- **A course has one new setting, "Held until fired"** (yes or no). A new course starts as yes.
  Typical: Starters no, Mains yes, Desserts yes. It is shown as a column on A756's Courses page
  (picture 9). Until A756 lands it is a column on today's course list (section 14, point 5).
- **A dish with no course behaves like a course that is not held.** Drinks normally have no course.
- **Counter orders ignore courses entirely** (section 8).
- The course stays a label everywhere else: kitchen screens, A655's Course column and filter on
  Products, and the group headings below.

## 2. Where a new line lands in the New order

Each line is placed once, when it is added, by these rules. Nothing is re-sorted afterwards, and the
order in which lines are tapped in makes no difference.

1. **No course, or a course that is not held:** Fire now.
2. **A held course:**
   - if a group already holds that course (a new group in the New order, or a held group of the
     table), the line joins the first such group, in firing order;
   - otherwise, on a **first order**, a new held group for that course, placed in course order;
   - otherwise, on a **later addition**: if the course comes after every course the table still has
     held, a new held group placed after the table's held groups; otherwise the table is already past
     this course, and the line goes to **Fire now**. (Revised 2026-10-17: the first version made a
     new held group whenever the table still had one, which put a late main after held desserts.)

A first order means the table has no group yet. Changing a line's course re-applies these rules to
that line, and so does a refused send whose target group was fired meanwhile (section 10). Moving a
line by hand always wins.

| Table has | Adds | Lands in |
|---|---|---|
| nothing | drinks, starters, mains | Fire now: drinks, starters · new group: Mains |
| nothing | drinks, mains | Fire now: drinks · new group: Mains (the waiter ticks it and presses Fire) |
| everything sent, nothing held | starter, main, 2 desserts | all in Fire now |
| Mains held | solomillo | joins the held Mains |
| Mains held | starter | Fire now |
| Mains held | 2 desserts | new group: Desserts, after Mains |
| Mains fired, Desserts held | solomillo | Fire now |
| Mains fired, Desserts held | lemon pie | joins the held Desserts |

## 3. The table screen

Pictures 12–14. The right-hand panel shows the bill on screen, top to bottom:

1. the **Sent** box (3.1–3.4);
2. the **New order** box, when it holds anything (3.5);
3. the **total**, **Discount the bill**, and **Hold · Pay** (A739).

Every row in every list shows its price, in one column, so the rows add up to the total. Today's
Current orders, To serve and Served lists, and the six buttons on each row, go.

### 3.1 The Sent box

- Shown once anything on the bill has been sent.
- **Collapsed, it is one line of counts:** "2 ready · 2 firing · 3 held · 4 served". Collapsed, it
  is outlined and pulses gently while anything inside needs attention: a dish is ready, or a held
  group is due (3.4). Attention is never shown by colour alone, and the pulse is calmer when the
  device asks for reduced motion.
- **When the table is opened,** the box opens by itself if anything is ready or a held group is due;
  otherwise it starts collapsed. While the waiter is already on the table it never springs open (a
  list that jumps under a finger causes mis-taps); it pulses instead.
- **Opened, it holds three parts:** Served (folded), Fired (open), Held (folded).

### 3.2 Served

Folded to "Served · 4 · €11.50". Unfolded, the served dishes with their prices. A served dish's line
window offers **Not served** in its More menu, for a mistaken tap.

### 3.3 Fired

Everything fired and not yet served, in **one list with no groups**: groups are for holding.

- **Ready dishes first,** the one ready longest at the top, each showing "ready 6 min".
- **Then the rest,** the one fired longest ago at the top, each showing "fired 12 min". A dish
  waiting for the pass shows "at the pass".
- The status sits on the right of each row, before the price.
- **Tapping a dish marks the whole line served.** A short bar, "Bravas served · Undo", appears for a
  few seconds.
- **All served**, on the list's heading, marks every dish in the list served, ready or not.
- One part of a line ("1 of 2 out so far") is marked through the line window's **Mark served**, with
  − n +. The owner thinks this may prove tedious; it stays until tried on a real till (section 11).

### 3.4 Held

- **Folded to one line:** "Held · Mains (3) · Desserts (2)".
- **A held group is due** N minutes after every dish fired before it has been served: today's rule
  (`releaseReminder`, `apps/server/src/order-groups.ts`), with N the venue's reminder minutes and
  N = 0 meaning at once (owner, 2026-10-17). There is no second timer. While one is due, the line flashes and
  shows "Mains due · 21:15", **Snooze** and **Fire Mains**, so firing never needs the box opened.
  Clear snooze shows only while the group is snoozed.
- **Opened,** each held group with its heading ("Group 4 · Mains, Desserts", built as described
  below), its dishes and their prices, and **Fire** on the heading. A dish of another bill in the
  same group is shown dimmed, named by its bill, with no price (builder's call): the kitchen fires
  the group as one.
- **Sent dishes have no tick boxes.** One held dish is fired early, or recalled, through its line
  window (3.7).
- **Reordering held groups:** long-press a group heading to drag it. If the drag does not survive the
  real-till trial, a ⋯ on the group heading offers Move earlier and Move later (builder's call).
  Today's ↑ ↓ buttons go.

### 3.5 The New order

An outbox. What the waiter adds waits here; **Send all empties it**, which is the waiter's sign that
everything went (picture 13). Held groups never reopen into it.

**Its parts:** **Fire now**, then any **new groups**, then **"Joins Group N · Course"** for dishes
going into a held group of the table, placed by section 2. A "Joins" part shows only the new dishes,
not the group's sent ones.

**Group headings come from their contents:** "Group 3 · Mains", or "Group 4 · Desserts, Drinks" in
course order. A group's number is its position among all the table's groups, sent Fire now batches
included, given when it is first sent and never changed after: a printed HOLD ticket's `GROUP 3`
must keep matching the till, so reordering held groups changes their firing order, not their numbers
(builder's call). An unsent Fire now has no number.

**Inside every group:** lines with no course first, sorted by name. Then each course in course order,
with its lines sorted by name. A small course heading is drawn only when the group holds more than
one kind (no-course lines plus a course, or two courses). It is quieter than the group heading and
uses a different background shade. It has no tick box.

**Tick boxes, at two levels:** a group (on its heading) and a line. There is no "tick everything"
box: Send all already acts on everything, and ticks are for picking a few lines. To hold
everything, tick the Fire now heading, then Move to… → + New group. Only dishes in the New order have
tick boxes.

**Splitting a line:** a line of more than one whole unit has a chevron on its right. It is a
full-height button at least 44 points wide (the touch-target minimum). Tapping it opens the line
into single lines under a header row, and tapping the header folds them back. Folding is offered
only while all of them are still in the same group.

**Moving lines:**
- **Move to…** lists Fire now, every new group, every held group of the table (as "Joins Group N"),
  and **+ New group**. A new group goes straight after the group the lines came from; lines from
  several groups go after the last of them.
- **Long-press a line to drag it.** If it is ticked, every ticked line moves with it. Dropping
  between two groups makes a new group there. The owner wants that tried on a real till before
  it is kept; Move to… → + New group does the same job if it is dropped.
- There is no "+ Add group" button and no empty group.

**Buttons:**
- **Send all** sends every line, as arranged: Fire now is fired, each new group is held, and the
  "Joins" lines join their held groups.
- **Fire** fires only the ticked lines. The rest stay where they are.
- **Move to…** is described above.
- Move to… and Fire are drawn quiet and disabled until something is ticked, as design-system.md →
  Forms asks for a button that waits for a selection.

**Warnings in the list.** A line that cannot be sold now (sold out, period ended, not offered) and a
line with no open station to make it are marked in the list at once, with a warning colour **and** a
symbol, never colour alone. The detail, and today's choices (keep or remove; pick where it is made),
are in the line window (3.7). Neither kind is ever sent; both stay in the list.

**The "Check before sending" window goes.** Send all sends straight away. Its other jobs move:
- the bill choice is replaced by section 4;
- the warnings above appear in the list;
- the count summary is no longer needed.

**When sending,** identical lines that end up in the same group are combined into one. Identical means
the same dish, variant, options, extras, note, course and station, which is what an opened chevron
leaves behind.

### 3.6 Phone width

Everything above works on a handheld at phone width (picture 4's width), in both themes.

### 3.7 The line window

A738's line window (its board 2a), opened from a row's ⓘ or a long press, as A738 says. A tap on a
Fired row marks it served (3.3); a tap on a New order row does what A738 and the tick boxes say.

- **Not sent yet:** A738's editing window, plus a **Course** field. Changing the course re-places the
  line (section 2). It has no ⋯ menu: a discount is given once the dish is sent (builder's call), and
  taking the dish off the order stays the row's ×.
- **If A738 has not landed** when this is built, A773 builds what it needs (the sent view, ⋯ More,
  Mark served, the Course field) on today's modifiers window, and A738 adds its own sections later
  (builder's call).
- **Sent:** nothing is editable. The window shows the dish, its extras and note with their prices, and
  a pill saying where it is ("Bar · waiting · fired 2 min ago"). Its **⋯ More** lists only what
  applies right now:
  - **Fire now** — a held dish: it leaves its group and is fired; the rest stays held. Not gated by
    the station's "changes after sending".
  - **Recall** — section 3.10.
  - **Move to station…** — as today's button.
  - **Discount…** — section 3.8.
  - **Cancel item…** — section 3.9.
  - **Not served** — a served dish.
- A dish in Fired also gets **Mark served** as the window's main button, with − n + for part of the
  line.
- **The footer button reads Close**, so "Cancel" never means two things in one window.
- On a **paid bill**, the More menu holds only Fire now and Cancel item (section 4, 3.9).

Extras have no actions of their own: changing an extra is editing the dish, and a discount on one
extra is chosen inside Discount….

### 3.8 Discount…

One window replaces today's Give away and Discount buttons: every difference between them comes from
the adjustment reason (`AdjustmentReason`, `packages/adjustments/src/policy.ts`), which already says
which kinds it allows (`actions`), caps them, names who may apply and approve, and whether a note is
required.

- **Reason** (required). Each reason shows what it allows: "free", "% off, up to 10%", "free, % or €
  · manager's PIN".
- **What** — shown only when the dish has priced extras: the whole dish with its extras (the
  default), or one extra only. An extra is covered only whole, as the server already insists
  (`coveredQuantity`, `apps/server/src/adjustments-apply.ts`).
- **How much** — shown only when the reason allows more than one kind: Free, %, €.
- **How many** — − n +, from 1 to the line's quantity, starting at all of it. A weighed line, which
  has no "one of them", is covered whole, as today.
- **Note** — optional, required when the reason says so, as today.
- The button says what will happen: "Make 3 free", "Take 10% off 2".

The receipt keeps printing a free dish and a discount differently, as today
(`apps/server/src/receipt-adjustments.ts`). Discount the bill stays by the total.

### 3.9 Cancel item…

**Cancel item means "the guest no longer wants it"** (owner, 2026-10-17). Always the whole dish
(never one extra), with − n + for how many. The kitchen is always told, by slip and on its screens,
marked started where it was started. What happens to the money depends on where the dish is:

| Where the dish is | Cancel item offers |
|---|---|
| held, or fired and not started (unpaid bill) | **Cancel**: off the kitchen and off the bill, no question |
| being prepared or ready (unpaid bill) | **Cancel, still charge** (it stays on the bill) or **Cancel, don't charge** (it comes off the bill) |
| paid bill, any stage | **Cancel, keep the payment**, or **Cancel and refund** once A737 Part 2 exists |

- **"Don't charge" and "refund" take a reason and a note**, as today's cancel does, so a reason
  that needs a manager's PIN still asks for one. "Still charge" and "keep the payment" move no money
  and need no reason.
- **The window says which case it is** before the waiter confirms ("Already being prepared").
- **A cancelled dish that is still charged** moves into Served, tagged "cancelled, charged", so the
  rows still add up to the total (builder's call).
- **This changes today's behaviour:** today a cancel always takes the dish off the bill, started or
  not (`removeFromLine`, `apps/server/src/working-order.ts`), and its VOID slip marks it started.
  Off-the-bill keeps that path; "still charge" and "keep the payment" stop the kitchen without
  touching the bill.

### 3.10 Recall

**Recall brings a sent dish back into the New order**, where it can be changed, moved, fired or
removed, then sent again. A held dish comes back under "Joins Group N" for its own group; a fired
dish is placed by section 2.

- **When it is offered** depends on the dish's station (section 7): never; while held; or while held
  or waiting. Never once anyone has started the dish: the server refuses a started dish
  (`ticket.already_started`, as `recallLines` does today). Until A756 gives stations the setting,
  today's venue-wide `edit_sent_lines` decides: yes means while held or waiting, no means never.
- **The kitchen is told:** a recalled fired dish prints the RECALLED slip, as today. A recalled held
  dish whose HOLD ticket was already printed is told as a cancelled held dish is today (builder's
  call).
- **Server change:** today `recallLines` returns a fired dish to held and leaves it sent. Recall now
  takes the dish off the kitchen and shows it, arranged, in the person's New order for that bill.
- **A recalled dish keeps its bill line, its price and any discount already given**; sending it
  again does not re-check that it can still be sold, because the guest already ordered it
  (builder's call). Whether it stays a bill line marked unsent or moves into the draft is the plan's
  choice, so long as the money on the bill never changes by recalling.
- Not on a paid bill (section 4).

## 4. Bills

- **New lines go on the bill on screen.** To order for another bill, switch to it.
- **Each bill keeps its own New order.** Lines added for Bill 1 wait on Bill 1 while the waiter
  is on Bill 2.
- The "Send to" choice and the "New orders" tag on the main bill go. Before removing anything,
  trace every reader of `parties.main_bill_id` (`#sendToChoices`,
  `apps/till/src/screens/till-table-order-screen.ts`), because other paths read it too.
- Groups stay table-wide. A line on Bill 2 can join a held group that holds Bill 1's lines, and the
  kitchen sees one group.
- **Pay is refused while the bill has unsent dishes**, anyone's. The refusal names whose ("Ana has 2
  unsent dishes on Bill 1"), so the paying waiter can ask them or take the table over.
- **A paid bill's held dishes can still be fired and served.** Read, not run: `fireGroup`
  (`apps/server/src/order-groups.ts`) checks the party is open, not the bill, and `releaseHeld`
  (`apps/server/src/working-order.ts`) fires a placed order's held lines ("a placed order's held
  work is committed"). The plan pins it with a test. Recall and Discount are not offered
  on a paid bill: its invoice is issued, so money comes back only by refund (A737 Part 2, not
  built). Today `recallLines` already refuses a bill that is not open (`assertPartyBillOpen`).
- **Cancel item on a paid bill** stops the kitchen and keeps the payment; giving money back is a
  refund (3.9, A737 Part 2). Guests who paid and left are the usual case (section 10).

## 5. Firing and the pass

**Only the waiter fires**, by four means:
- Send all (the Fire now group);
- Fire on ticked lines in the New order;
- Fire on a held group's heading, or on the Held line when it is due, meaning "this table is ready
  for the next course";
- Fire now on one held dish, in its line window.

Station screens and the pass never decide when a table is ready.

**Each station gets a setting: "Waits for the pass"** (yes or no).
- **No:** fired lines appear on the station at once, as Waiting.
- **Yes:** fired lines become **Requested**. They appear on the station under **Coming up**, marked
  "Waiting for the pass" (picture 5). They reach Waiting only when the pass fires them.

**The pass** (picture 6):
- **Waiting for you to fire** lists one card per requested group, oldest first. Each card is labelled
  **New order** (a table's first send, or a counter order), **Next course** (a held group the waiter
  fired) or **Added** (a later addition's Fire now), and shows how long it has waited.
- **A pass's Fire releases the requested lines of that group that this pass sees** (owner,
  2026-10-17). A venue with one pass sees no difference. With a hot pass on Grill and a cold pass on
  Cold, a group holding both needs both Fires; each card lists the other part for information
  ("Cold: waiting for the cold pass"), as it lists lines at stations that do not wait ("already at
  the Bar").
- **In the kitchen** then shows the group's progress per line and station.
- **A ready dish stays on the pass, showing "ready 6 min", until the waiter marks it served or the
  table is cleared** (the party leaves and the table is reset). **The pass screen's Done mark goes**
  (owner, 2026-10-17; today's per-device Done in `apps/server/src/pass-board.ts`, `expo.done`), so
  nothing else takes a dish off the pass. Paying the bill does not clear it:
  a bill can be paid before the food is served. The kitchen can ignore a ready dish; it stays for
  reference, and a long "ready" time shows nobody has collected it. A counter order, which has no
  table, leaves the pass when it is collected or closed (builder's call). The pass monitor, which
  cannot fire, shows "Waiting for you to fire" read-only (builder's call).

**Away goes** (owner, 2026-10-17). In the trade "away" usually means "the table is ready for the next
course", which here is Fire; nobody uses it for "a runner has picked it up". There is no state
between Ready and Served. Today `away_at` is read by `pass-board.ts` (the pass monitor drops a
section once its dishes are away), `rest-of-order.ts`, `station-closing.ts`, `station-delete.ts`,
`station-outputs-down.ts`, `station-move.ts`, `kitchen-print.ts`, `order-groups.ts`,
`department-transfer-api.ts` and `working-order.ts` (all under `apps/server/src/`), and the till
shows it as "En route" (`table.group_away`); the pass's button is `expo.away`. The plan traces every
reader before removing it.

A pass screen covers **stations and zones**: it sees a dish whose station and zone are both in its
choice (`passSees`, `apps/server/src/pass-board.ts`; a dish in no zone only a pass on every zone).
So "the pass" for a line is a pass screen that sees it. (The first version of this spec said zones
only, as the fire check `assertPassScreenZone`, `packages/venue-service/src/kitchen-screens.ts`,
reads today.)

**One group, several stations.** When the waiter fires a group, each station's part follows that
station's own setting. A station that does not wait for the pass starts at once. Its ticket and
screen say "Goes with kitchen food" when the same group has lines at a station that waits for the
pass (pictures 7, 8). **A group reads ready only when every station's part of it is ready.**
Letting a station wait automatically for another station's part is left for later (section 11).

**Station screens lose every Fire button** (for groups and for courses). They keep Waiting →
Preparing → Ready as today. Their new **Coming up** column holds held and requested lines.

**What goes:**
- the venue-wide fire control (`locations.fire_control`: waiter, kitchen or expo), and A756's plan
  to move it to departments;
- `fireCourse` and its routes, with `fireHeldGroupsOfCourse`;
- the station screens' Fire;
- Away (above).

The pass's Fire is the only route that moves requested lines to Waiting. It is checked on the
server: the device must have a pass screen that sees each line it releases, station and zone; today
the device fire route (`apps/server/src/device-levers.ts`) checks the zone only.

**Safety net on the dashboard.** When a station waits for the pass and, in some zone, no pass screen
sees that station's dishes, the stations page warns. Example: "Grill and Cold wait for the pass, but no pass screen
covers the Terrace. Food ordered there for Grill or Cold would never be fired." It warns rather than
refuses, so a venue can set things up in either order.

**The reminder to fire the next course** stays the waiter's, with the department, as A756 planned.
On the table screen it is the Held line's due state (3.4).

## 6. Tickets

- A group's heading names its courses: `GROUP 3 · MAINS`.
- A station that waits for the pass prints a group's fire ticket when the pass fires, not when the
  waiter does.
- Held-ticket printing in advance stays a station setting (A756).

## 7. Settings — changes to A756

A756's mock-ups were approved on 2026-10-16. Four changes:

1. **No "Every station" card.** Every station setting is set on the station itself: late flags, done
   on the screen, identical dishes, held courses, MOVED slips, changes after sending and "Waits for
   the pass". A new station starts with sensible defaults. The stations table shows "Waits for the
   pass" as a column (picture 10).
2. **"Who fires held courses" goes** from the department dialog's Service tab. The reminder to fire
   the next course stays there.
3. **The Courses page gains "Held until fired"** (picture 9).
4. **"Changes after sending" has three values** (2026-10-17): no changes; while held; while held or
   waiting. It decides when Recall is offered (3.10). The middle value suits a printer-only station,
   where a fired ticket is already in the cook's hand; even a station with a screen may show a dish
   as waiting that the cook has already started, which is why the venue chooses per station.

## 8. Counter orders

- No courses and no groups. Send fires everything.
- Station screens show a counter order's dishes in the order they were taken, with no course
  sections.
- A station that waits for the pass still waits: the pass sees a counter order as one **New order**
  card.
- A customer who wants courses is seated at a table before ordering. Moving a counter order to a
  table already sends its unsent dishes at the move (A660).
- This replaces the course rule for bills with no party (`fireLines`,
  `apps/server/src/working-order.ts`).

## 9. What the stored data must carry

These are requirements; the plan picks the shapes.

- **The arrangement is saved with the New order on the server,** so a reload, another device or a
  take-over keeps it. Today a draft line stores its course but not its group (`order_draft_lines`,
  `packages/db/src/schema/order-drafts.ts`). Each draft line needs its place: Fire now, a new unsent
  group (with an order among the new groups), or an existing held group.
- **A draft belongs to a bill.** Today one person has one open draft per party (the partial unique
  index `order_drafts_open_owner_uq`). That becomes one per party and bill.
- **One submission can join several held groups.** Today a submission joins at most one
  (`joinGroupId`, `placeGroups`, `apps/server/src/order-groups.ts`).
- **A line can be requested.** A sent kitchen item today is held (`fired_at` null) or fired. A
  requested item needs its own marker, and a group needs a way to say it is waiting for the pass.
- **A recalled dish returns to a draft** (3.10), with its place.
- **Paying checks the bill's drafts** (section 4).
- **`away_at` and the pass's Done marks go**, and the pass's clearing moves to served or table
  cleared (section 5).
- **Courses gain `held_until_fired`; stations gain `waits_for_pass`; `locations.fire_control` goes.**
  We are before go-live, so nothing is carried forward (CLAUDE.md §3).

## 10. Edge cases

- **A held group is fired by someone else while new lines wait to join it.** Send all must not
  silently hold them in a group that is now cooking. The server refuses (`group.not_held`, as
  today), and nothing from that attempt is sent. The till re-reads and re-places those lines by
  section 2, which puts them in Fire now (the table is past that course), says so in one line, and
  the waiter sends again.
- **A refused submission keeps the whole New order**, arrangement included (D9 today).
- **A sold-out line, or one with nowhere to be made,** stays in the list and is never sent (section 3).
- **A requested group is changed** (a line cancelled, moved or recalled) before the pass fires it.
  These follow today's rules for held lines. The pass card updates.
- **Two waiters on one table:** each has their own New order per bill, as today per party.
  Another person's stays read-only.
- **A bill paid while dishes wait unsent** cannot happen: Pay is refused (section 4).
- **Finishing a table with held or requested dishes asks first** (owner, 2026-10-17): "2 dishes are
  still held: Entrecot ×2", with **Fire** or **Cancel item** (3.9); either answer lets the table
  finish.
  Today `finishTable` (`apps/server/src/parties.ts`) refuses only an unpaid bill or an open one with
  items, so a paid table could close with its mains held for ever.

## 11. Left for later (backlog)

- **A station waits automatically for another station's part of a group,** for example the bar
  pours the dessert wine when the kitchen marks the tarta ready.
- **Marking one dish served through the line window** may prove tedious. Revisit after it is used on
  a real till.
- **Dragging lines and groups** is kept only if it survives a real-till trial (section 3.4, 3.5).

## 12. Backlog entries this touches

- **A738:** its open point (how a later addition is grouped and sent) is answered here. Its line
  window gains the ⋯ More menu, the Course field and Mark served (3.7); its table-order clean-up
  includes this panel.
- **A739:** Hold · Pay at the bottom of the panel.
- **A737 Part 2:** a paid bill's dish is taken off by refund; the line window points there.
- **A756:** the four changes in section 7.
- **A757:** the floor's held-items mark should count requested lines as well as held ones.
- **A655:** the Course column and filter keep working; a dish with no course goes to Fire now.
- **From the service plan's open list:**
  - "hide Fire all now under kitchen/expo" goes (the setting is gone);
  - "Fire on the first held group only" goes (the waiter can fire any held group);
  - "remove `fireHeldGroupsOfCourse`" is done by section 5.

## 13. Testing

Each rule above gets a test that fails if the rule is removed. In particular:

- the placement table in section 2, row by row, including the two "Mains fired" rows;
- re-placement when a line's course changes;
- Send all sends exactly the arrangement shown, including joins to two held groups at once, and
  leaves the New order empty;
- Fire sends only the ticked lines; sent dishes have no tick boxes;
- identical lines combine at send only within one group;
- each bill's New order survives switching bills, a reload and a take-over;
- the Sent box opens by itself on opening a table with a ready dish or a due group, and not otherwise;
  it never opens by itself while the waiter stays on the table;
- Fired orders ready dishes by time ready, then the rest by time fired; a tap marks the line served
  and Undo restores it; All served marks every dish;
- a held group is due N minutes after every dish fired before it is served (at once with N = 0); Snooze
  quiets it;
- the line window offers only the actions that apply, by state, by the station's setting and on a
  paid bill;
- Recall brings a held dish and a waiting dish back into the New order, and is refused once started;
- Discount… asks What only with priced extras and How much only for a reason with more than one kind;
- Pay is refused while the bill has anyone's unsent dishes;
- a paid bill's held group can be fired;
- Cancel item offers, by the dish's state and the bill's, exactly the choices in 3.9's table, and
  only "don't charge" and "refund" change the money;
- finishing a table with held dishes asks Fire or Cancel item;
- a station that waits for the pass receives nothing until the pass fires, and one that does not
  wait receives it at once;
- a pass fires only the lines it sees, by station and zone, and two passes each fire their own part
  of one group;
- a ready dish stays on the pass until served or the table is cleared, and paying does not clear it;
- a group reads ready only when every station's part is ready;
- the fired-under-you case in section 10;
- counter orders send everything, with no course sections.

Browser tests open the real screens in both themes and at phone width (CLAUDE.md §4).

## 14. A773-1's six open points — answered 2026-10-17

The questions are in [`docs/backlog/mockups/a773-1-open-points/`](../../backlog/mockups/a773-1-open-points/README.md).

1. **Held groups in two places — neither.** The drawer's Current orders goes entirely; serving moves
   to Fired, reminders to the Held line.
2. **New and sent selections together — neither.** Sent dishes have no tick boxes (3.4).
3. **A bill paid before Send — neither.** Pay is refused while the bill has unsent dishes (section 4).
4. **Changes after sending — A.** Today's venue-wide `edit_sent_lines` governs Recall until A756
   (3.10).
5. **Where the course switch lives — A.** On today's course list, moved by A756 (section 1).
6. **A group fired by another waiter — A,** through the corrected section 2 rule (section 10).

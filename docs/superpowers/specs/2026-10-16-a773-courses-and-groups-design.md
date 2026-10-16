# A773. Courses, groups and the pass — design

Status: written 2026-10-16 from an owner brainstorm; **awaiting the owner's review**. Nothing here is
built.

It replaces three things in the service design
([2026-09-20-service-ordering-and-billing-design.md](2026-09-20-service-ordering-and-billing-design.md)
§3): the four draft actions, the later-addition destination choice and the venue-wide fire control.
It also changes A756's approved settings move. It resolves A738's open point on how a later addition
is grouped and sent.

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

Where a picture and this text disagree, the text wins. The pictures show layout, not exact
wording or colours: those follow the design system.

## Words used here

- **Group:** dishes of one table that are sent, held and fired together. Groups belong to the table
  (the party), not to a bill.
- **Held:** sent to the kitchen, but not to be cooked yet.
- **Fire:** "cook this now". Only the waiter fires.
- **Requested:** the waiter fired it, and it is waiting for the pass to release it to a station that
  waits for the pass.
- **Unsent list:** the waiter's draft for the bill on screen, before Send all.

## 1. Courses

- **A course has one new setting, "Held until fired"** (yes or no). A new course starts as yes.
  Typical: Starters no, Mains yes, Desserts yes. It is shown as a column on A756's Courses page
  (picture 9).
- **A dish with no course behaves like a course that is not held.** Drinks normally have no course.
- **Counter orders ignore courses entirely** (section 8).
- The course stays a label everywhere else: kitchen screens, A655's Course column and filter on
  Products, and the group headings below.

## 2. Where a new line lands in the unsent list

Each line is placed once, when it is added, by these rules. Nothing is re-sorted afterwards, and the
order in which lines are tapped in makes no difference.

1. **No course, or a course that is not held:** Fire now.
2. **A held course:**
   - if a group in the list already holds that course (an unsent group, or a held group of the
     table), the line joins the first such group, in firing order;
   - otherwise, on a **first order**, a new held group for that course, placed in course order;
   - otherwise, on a **later addition**, a new held group placed after the table's held groups if the
     table still has a held group, else Fire now.

A first order means the table has no group yet. Changing a line's course re-applies these rules to
that line. Moving a line by hand always wins.

| Table has | Adds | Lands in |
|---|---|---|
| nothing | drinks, starters, mains | Fire now: drinks, starters · new group: Mains |
| nothing | drinks, mains | Fire now: drinks · new group: Mains (the waiter ticks it and presses Fire) |
| everything sent, nothing held | starter, main, 2 desserts | all in Fire now |
| Mains held | solomillo | the held Mains |
| Mains held | starter | Fire now |
| Mains held | 2 desserts | new group: Desserts, after Mains |

## 3. The table screen

Pictures 1–4. One list for the bill on screen:

1. **"Already sent"**, folded every time the table is opened, shown only once something is sent.
   Its heading counts the items ("9 items · 2 on their way · 7 served"). Unfolded, it lists the sent
   lines under **On its way** (requested, waiting, preparing or ready) and **Served**. Each line names
   its state and station.
2. **Fire now**, then **every held group in firing order**, unsent and already-sent alike. A held
   group that is already sent shows its sent lines dimmed and its new lines highlighted, and has
   **Fire** on its heading.

**Group headings come from their contents:** "Group 3 · Mains", or "Group 4 · Desserts, Drinks" in
course order. A group's number is its position among the table's groups. Fire now has no number.

**Inside every group:** lines with no course first, sorted by name. Then each course in course order,
with its lines sorted by name. A small course heading is drawn only when the group holds more than
one kind (no-course lines plus a course, or two courses). It is quieter than the group heading and
uses a different background shade. It has no tick box.

**Tick boxes, at two levels:** a group (on its heading) and a line. There is no "tick everything"
box: Send all already acts on everything, and ticks are for picking a few lines. To hold
everything, tick the Fire now heading, then Move to… → + New group.

**A sent line in a held group is tickable only if its station accepts changes after sending**, a
station setting under A756. Today the setting is venue-wide: `edit_sent_lines`. Once ticked, such
a line can be moved to another held group, or fired on its own: it leaves its group and is fired,
and the rest of the group stays held. On a station that refuses changes, for example a printer-only
bar, sent lines have no tick box and go when their whole group is fired. A held line that no
station makes is always tickable.

**Splitting a line:** a line of more than one whole unit has a chevron on its right. It is a
full-height button at least 44 points wide (the touch-target minimum). Tapping it opens the line
into single lines under a header row, and tapping the header folds them back. Folding is offered
only while all of them are still in the same group.

**Moving lines:**
- **Move to…** lists Fire now, every group, and **+ New group**. A new group goes straight after
  the group the lines came from; lines from several groups go after the last of them.
- **Long-press a line to drag it.** If it is ticked, every ticked line moves with it. Dropping
  between two groups makes a new group there. The owner wants that tried on a real till before
  it is kept; Move to… → + New group does the same job if it is dropped. Long-press a group
  heading to drag the whole group.
- There is no "+ Add group" button and no empty group.

**Buttons:**
- **Send all** sends every unsent line, as arranged: Fire now is fired, each group is held, and new
  lines in an already-held group join it.
- **Fire** fires only the ticked lines (unsent ones, and sent held ones as described above). The
  rest stay where they are.
- **Move to…** is described above.
- Move to… and Fire are drawn quiet and disabled until something is ticked, as design-system.md →
  Forms asks for a button that waits for a selection.

**Warnings in the list.** A line that cannot be sold now (sold out, period ended, not offered) and a
line with no open station to make it are marked in the list at once, with a warning colour **and** a
symbol, never colour alone. The detail, and today's choices (keep or remove; pick where it is made),
are on the line's detail screen. Neither kind is ever sent; both stay in the list.

**The "Check before sending" window goes.** Send all sends straight away. Its other jobs move:
- the bill choice is replaced by section 4;
- the warnings above appear in the list;
- the count summary is no longer needed.

A sent dish can still be recalled while it is waiting, as today.

**When sending,** identical lines that end up in the same group are combined into one. Identical means
the same dish, variant, options, extras, note, course and station, which is what an opened chevron
leaves behind.

## 4. Bills

- **New lines go on the bill on screen.** To order for another bill, switch to it.
- **Each bill keeps its own unsent list.** Lines added for Bill 1 wait on Bill 1 while the waiter
  is on Bill 2.
- The "Send to" choice and the "New orders" tag on the main bill go. Before removing anything,
  trace every reader of `parties.main_bill_id` (`#sendToChoices`,
  `apps/till/src/screens/till-table-order-screen.ts`), because other paths read it too.
- Groups stay table-wide. A line on Bill 2 can join a held group that holds Bill 1's lines, and the
  kitchen sees one group.

## 5. Firing and the pass

**Only the waiter fires**, by three means:
- Send all (the Fire now group);
- Fire on ticked lines;
- Fire on a held group's heading, meaning "this table is ready for the next course".

Station screens and the pass never decide when a table is ready.

**Each station gets a setting: "Waits for the pass"** (yes or no).
- **No:** fired lines appear on the station at once, as Waiting.
- **Yes:** fired lines become **Requested**. They appear on the station under **Coming up**, marked
  "Waiting for the pass" (picture 5). They reach Waiting only when the pass fires them.

**The pass** (picture 6):
- **Waiting for you to fire** lists one card per requested group, oldest first. Each card is labelled
  **New order** (a table's first send, or a counter order), **Next course** (a held group the waiter
  fired) or **Added** (a later addition's Fire now), and shows how long it has waited.
- **One Fire releases every requested line of that group,** at every station that waits for the
  pass. Lines at other stations are listed for information ("already at the Bar").
- **In the kitchen** then shows the group's progress per line and station, with Away as today.

A pass screen covers **zones**, not stations (`assertPassScreenZone`,
`packages/venue-service/src/kitchen-screens.ts`). So "the pass" for a line is a pass screen covering
the zone of the line's order.

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
- the station screens' Fire.

The pass's Fire is the only route that moves requested lines to Waiting. It is checked on the
server: the device must have a pass screen covering the order's zone, as the device fire route
checks today (`apps/server/src/device-levers.ts`).

**Safety net on the dashboard.** When a station waits for the pass and some zone has no pass screen
covering it, the stations page warns. Example: "Grill and Cold wait for the pass, but no pass screen
covers the Terrace. Food ordered there for Grill or Cold would never be fired." It warns rather than
refuses, so a venue can set things up in either order.

**The reminder to fire the next course** stays the waiter's, with the department, as A756 planned.

## 6. Tickets

- A group's heading names its courses: `GROUP 3 · MAINS`.
- A station that waits for the pass prints a group's fire ticket when the pass fires, not when the
  waiter does.
- Held-ticket printing in advance stays a station setting (A756).

## 7. Settings — changes to A756

A756's mock-ups were approved on 2026-10-16. Three changes:

1. **No "Every station" card.** Every station setting is set on the station itself: late flags, done
   on the screen, identical dishes, held courses, MOVED slips, changes after sending and "Waits for
   the pass". A new station starts with sensible defaults. The stations table shows "Waits for the
   pass" as a column (picture 10).
2. **"Who fires held courses" goes** from the department dialog's Service tab. The reminder to fire
   the next course stays there.
3. **The Courses page gains "Held until fired"** (picture 9).

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

- **The arrangement is saved with the unsent order on the server,** so a reload, another device or a
  take-over keeps it. Today a draft line stores its course but not its group (`order_draft_lines`,
  `packages/db/src/schema/order-drafts.ts`). Each draft line needs its place: Fire now, a new unsent
  group (with an order among the new groups), or an existing held group.
- **A draft belongs to a bill.** Today one person has one open draft per party (the partial unique
  index `order_drafts_open_owner_uq`). That becomes one per party and bill.
- **One submission can join several held groups.** Today a submission joins at most one
  (`joinGroupId`, `placeGroups`, `apps/server/src/order-groups.ts`).
- **A line can be requested.** A sent kitchen item today is held (`fired_at` null) or fired. A
  requested item needs its own marker, and a group needs a way to say it is waiting for the pass.
- **Courses gain `held_until_fired`; stations gain `waits_for_pass`; `locations.fire_control` goes.**
  We are before go-live, so nothing is carried forward (CLAUDE.md §3).

## 10. Edge cases

- **A held group is fired by someone else while new lines sit in it unsent.** Send all must not
  silently hold them in a group that is now cooking. The server refuses (`group.not_held`, as
  today). The till then re-reads, moves those lines to Fire now and says so in one line. The waiter
  sends again.
- **A refused submission keeps the whole unsent list**, arrangement included (D9 today).
- **A sold-out line, or one with nowhere to be made,** stays in the list and is never sent (section 3).
- **A requested group is changed** (a line cancelled, moved or recalled) before the pass fires it.
  These follow today's rules for held lines. The pass card updates.
- **Two waiters on one table:** each has their own unsent list per bill, as today per party.
  Another person's list stays read-only.

## 11. Left for later (backlog)

- **A station waits automatically for another station's part of a group,** for example the bar
  pours the dessert wine when the kitchen marks the tarta ready.

## 12. Backlog entries this touches

- **A738:** its open point (how a later addition is grouped and sent) is answered here; that bullet
  points to this spec.
- **A756:** the three changes in section 7.
- **A757:** the floor's held-items mark should count requested lines as well as held ones.
- **A655:** the Course column and filter keep working; a dish with no course goes to Fire now.
- **From the service plan's open list:**
  - "hide Fire all now under kitchen/expo" goes (the setting is gone);
  - "Fire on the first held group only" goes (the waiter can fire any held group);
  - "remove `fireHeldGroupsOfCourse`" is done by section 5.

## 13. Testing

Each rule above gets a test that fails if the rule is removed. In particular:

- the placement table in section 2, row by row;
- re-placement when a line's course changes;
- Send all sends exactly the arrangement shown, including joins to two held groups at once;
- Fire sends only the ticked lines, and a sent held line is tickable only on a station that accepts
  changes after sending;
- identical lines combine at send only within one group;
- each bill's unsent list survives switching bills, a reload and a take-over;
- a station that waits for the pass receives nothing until the pass fires, and one that does not
  wait receives it at once;
- the pass fires only for its own zones;
- a group reads ready only when every station's part is ready;
- the fired-under-you case in section 10;
- counter orders send everything, with no course sections.

Browser tests open the real screens in both themes and at phone width (CLAUDE.md §4).

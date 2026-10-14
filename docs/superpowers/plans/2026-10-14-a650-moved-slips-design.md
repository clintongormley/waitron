# A650 — MOVED slips say which order moved, from where, to where (build plan)

Status: build plan, written 2026-10-14 after the owner's rulings (§0). The build is four pull
requests (§7); three small questions (§8) each carry the default the build proceeds on. Drawings: [`docs/backlog/mockups/a650-moved-slips/`](../../backlog/mockups/a650-moved-slips/)
— pictures 1 to 4 are the design as it stood before the rulings, pictures 5 to 7 are this plan.

2026-10-14: Part 1 landed in #1706, and Part 2 in #1714, which adds
`ticket_items.sent_order_number` (migration `0153_sent_order_number.sql`); §5's account of what is
stored describes the code before Part 2. Part 3 adds `service_settings.print_moved_slips`
(venue-service migration `0052_mute_groot.sql`) and ships the venue switch's hint without its last
sentence (§6).

The file keeps its old name (`…-design.md`) so the links to it from the backlog stay good.

## 0. Owner rulings, 2026-10-14

Given about 14:10–14:15, relayed by the campaign watcher. Each line says what it changes below.

1. **When a slip prints: option (b)** — when an order left a table, or a name on its kitchen paper
   is gone. García birthday (a group of four, Bar leaves) prints nothing; "Cumple Ana" ending
   prints "From: Cumple Ana / To: Mesa 6, 9"; renaming a seated group "Fiesta" to "Fiesta 2"
   prints "From: Fiesta / To: Fiesta 2". **Split a table prints**: "From: Mesa 51, 52 / To: Mesa
   51" for the bills that stay. _Changes:_ §3's rename row and split rows are settled as "prints".
2. **One slip per order per station**, as recommended. _Changes:_ nothing; §4 already said so.
3. **The party's own name shows** on the order line: "Order 5 · Ana" / "Pedido 5 · Ana" (the
   alternative drawn in picture 4). _Changes:_ §4's order line; the old "not printed" bullet is
   superseded.
4. **Only the order number changed (same table): a slip prints.** The owner's reason: "the cook
   finishes and says 'order 28 is ready', how does the waiter match it up with order 27?" The slip
   reads "Order 28 -> 27 / From: Mesa 91 / To: Mesa 91", **and the till shows the old number beside
   the order, "Order 27 (was 28)"**, so a cook still calling 28 is found. Reading taken: the till
   writes an order number as `#27` everywhere it shows one (§5), so the plan draws `#27 (was 28)`
   in the till's own style rather than adding the word "Order". _Changes:_ §3 gains a
   third reason to print (the dishes are now on an order with another number), which reverses the
   design's "no" for path 7's other bill and for path 16 (Merge bills, Transfer items, Split the
   bill); §5 is new and designs "(was 28)".
5. **Held dishes already on a HOLD ticket: option (a)** — listed on the same MOVED slip under
   `HOLD`, with the party's name per ruling 3. _Changes:_ §4's HOLD section; §7 task 1.6.
6. **New: printing MOVED slips is a setting** — a venue-wide default with a per-prep-station
   override. A station set to off prints no MOVED slip, and the till's "(was N)" still shows.
   _Changes:_ §6 is new; §7 Parts 3 and 4.

Wording is as drawn otherwise: `MOVIDO`, `Pedido`, `De:`/`A:`, `(mostrador)`.

## 1. Why

When the till moves food the kitchen has already been sent, the server prints a MOVED slip at each
kitchen printer. The owner saw one after sending Bar back to its saved place from a group of four
tables named "García birthday" for today:

```
*** MOVED ***
Grill
García birthday -> Bar, García birthday
1
13:23
1.000 x BURG
```

The owner's words (2026-10-14, in the watcher session): it "seems to indicate that the garcia
birthday is now on both tables? the info we should be sending them is that order X has moved from
table Y to table Z".

Nothing moved in that case: the guests sat at Bar and Counter 3, 4 and 5 before and after. Only the
name changed. Today the server prints a MOVED slip whenever the place name it would print for an
order changes, and for no other reason (`apps/server/src/kitchen-print.ts:1034` and `:1193` compare
the two label strings). Move this bill prints whatever the names read when the bill goes to the
counter or a counter order goes into a party: the `force` option at
`apps/server/src/move-bill.ts:153-155` is `source === null || result.partyId === null`, where
`source` is null for a bill that had no party.

## 2. What happens today, path by path (history: measured before the rulings)

This section records what the code did on 2026-10-14 and is kept as history; the build changes it.

Measured 2026-10-14 by a throwaway test driving the real till routes (`useVenueDb`, `mountTillApi`,
two stations: Grill on an 80 mm printer and Postres on a 58 mm one), decoding every queued print job
with `printedLines` (`apps/server/src/testing/decode-ticket.ts`). `unset AI_AGENT CLAUDECODE;
pnpm --filter @waitron/server exec vitest run src/a650-probe.test.ts` reported `Tests 11 passed
(11)`. The probe was not committed; its source and full output are kept outside the repository by
the lane that ran it. Every "today" slip below is copied from that output.

How an order's place is decided today:

- A party's bill goes to its party's tables; there is no table per bill
  (`packages/db/src/schema/orders.ts:107-108`). Its place name is the shown names of those tables
  joined (`orderTableLabels`, `packages/db/src/party-table-labels.ts:124-157`): a table's shown name
  is its group's name for today, else its own name for today, else its saved name, and a named
  group appears once. `Mesa 6` and `Mesa 9` print as `Mesa 6, 9` (`partyTablesName`,
  `packages/shared/src/party-name.ts`).
- A counter order prints the table it is delivered to, else its own label, else nothing.
- The kitchen ticket's header is: station, place name, order number, time fired, then `GROUP n`
  (`formatKitchenTicket`, `apps/server/src/kitchen-ticket.ts:178-235`). The order number is per
  bill. **The party's own name ("Name the party") never prints on kitchen paper**; a group's name for
  today does, as the place name. (2026-10-15: A683 prints it on every kitchen ticket.)
- A slip prints **one per sent line per printer**: three sent lines on two bills make three slips,
  and two burgers on one line make one `2.000 x BURG` slip. A station with no active printer and a
  dish made at the till get none (`printCorrectionSlips`, `apps/server/src/kitchen-print.ts:939-990`).

| # | Till action | What happens to the food | Prints today |
| --- | --- | --- | --- |
| 1 | **Back to saved place**, Bar leaves the named group of four (owner's case) | nothing: the party keeps all four tables | `García birthday -> Bar, García birthday`, one slip per line |
| 2 | **Back to saved place**, a named group of two ends | nothing moves; the name "Cumple Ana" is gone from the floor | `Cumple Ana -> Mesa 6, 9` |
| 3 | **Move guests** to a free table | every bill goes to the new table | `Mesa 11 -> Mesa 12` per line per bill |
| 4 | **Move guests** off a named group | every bill goes to the new table | `Boda -> Mesa 23` |
| 5 | **Move guests** onto another party's table, bills merge | the bill goes to that table and becomes the other party's order | `Mesa 31 -> Mesa 32` / `8 -> 9` |
| 6 | **Join a table** / push a free table on (Join with…) | nothing: the party gains a table | `Mesa 71 -> Mesa 71, 72` (nothing when a free table is pushed onto a named group) |
| 7 | **Join a table** held by another party, bills merge | the other party's food stays at its table, now part of this party; its order number changes | `Mesa 73 -> Mesa 73, 74` for the joining bill; `Mesa 74 -> Mesa 73, 74` / `25 -> 24` for the other |
| 8 | **Split a table** (no bill chosen) | the bills stay with the party, which loses the table split off | `Mesa 51, 52 -> Mesa 51` per line |
| 9 | **Split a table**, a bill chosen | the chosen bill goes to the split table; the rest stay | `Mesa 51, 52 -> Mesa 52` for it; `Mesa 51, 52 -> Mesa 51` for the rest |
| 10 | **Split tables…** on a seated group | the party loses the tables split off | `Mesa 61, 62 -> Mesa 61` |
| 11 | **Split tables…** on a joined table, down to one part | the party moves to the part left | `Barra larga -> Taburete 3` (nothing when two parts are left) |
| 12 | **Move this bill** to a free table, or onto another party | the bill goes there | `Mesa 41 -> Mesa 42`; `Mesa 42 -> Mesa 41` / `11 -> 10` |
| 13 | **Move this bill** to the counter | the bill leaves the table | `Mesa 43 -> Mesa 43`, or `Mesa 121 -> Ana` for a party named Ana |
| 14 | **Move this bill**, a counter order into a party | the order goes to the party's table | `- -> Mesa 101` |
| 15 | **Rename** a table or group for today | nothing moves; the name on the kitchen's paper is gone from the floor | nothing |
| 16 | **Merge bills**, **Transfer items**, **Split the bill** (one party) | nothing moves; sent dishes change order number | nothing |
| 17 | **Reset to saved plan**, **Reset table**, **Name the party** | nothing moves or no name the kitchen sees changes (2026-10-15: since A683 a rename changes the name later kitchen tickets print) | nothing (Reset table read, not run) |

Two more things the probe showed, outside the design's rule:

- A held dish already printed on a HOLD ticket gets no slip when its guests move (`readSentWork`
  and `readPartiesSentWork` read fired dishes only). Ruling 5 settles it: §4's HOLD section.
- Moving an OPEN counter order with nothing sent into a party printed an ordinary kitchen ticket for
  its dish. The cause was not traced. Backlog A660; not part of this build.

## 3. The rule

**A MOVED slip prints for an order when, comparing the moment before the action with the moment
after it, (a) the order left a table, (b) a place name on its kitchen paper is no longer one of its
place names, or (c) dishes the kitchen has for it are now on an order with another number** (owner
rulings 1 and 4). Read each order the kitchen has dishes for before the action: its tables, its
place names (the shown name of each of its tables or groups, as its tickets print them; "the
counter" for a counter order delivered to no table) and its number. Read them again after. If no
table was lost, no name was lost and every dish is still on an order with the same number, nothing
prints.

The table half (a) catches a move the names hide: a bill moved from Mesa 77 to Mesa 78 inside the
group "Terraza" reads "Terraza" before and after; the design review's probe run (2026-10-14, the
same harness as §2) did exactly that and today's code printed nothing. Such a party holds only part
of a group, which backlog A594 describes. The name half (b) catches the place the kitchen's paper
names disappearing from the floor while the guests stay put (a named group that ends, a rename).
The number half (c) is ruling 4: the cook's paper says 28 and the dish is now on 27.

The rule compares lists of tables and names, not the joined string, so `Mesa 6, 9` and `Mesa 9, 6`
are the same places. The "before" places are read when the action happens, as today; a dish fired
before an earlier rename was printed under the earlier name, and this plan does not change that.

What each path prints under the rule. "Dishes listed" means the dishes the kitchen has on paper at
that station: fired dishes, and held dishes already printed on a HOLD ticket (ruling 5).

| # | Path | Places before → after | Slip? | Order line | Dishes listed |
| --- | --- | --- | --- | --- | --- |
| 1 | Back to saved place, Bar leaves the group of four | García birthday → Bar, García birthday | no: no table or name lost | — | — |
| 2 | Back to saved place, a named group of two ends | Cumple Ana → Mesa 6, Mesa 9 | yes (b) | `Order 3` (`· name` when the party has one) | all the order's |
| 3, 4 | Move guests to a free table, or off a named group | Mesa 11 → Mesa 12 | yes (a) | `Order 5 · Ana` | all, each order its own slip |
| 5 | Move guests onto another party's table, bills merge | Mesa 31 → Mesa 32 | yes (a)(c) | `Order 8 -> 9 · Luis` | all of order 8's; order 9's own get none |
| 5' | the same, bills kept separate | Mesa 31 → Mesa 32 | yes (a) | `Order 8 · Luis` | all |
| 6 | Join a table, or push a free table on | Mesa 71 → Mesa 71, Mesa 72 | no | — | — |
| 6b | **A join that changes the party's shown names**: a joined table broken into its parts (Bar pushed onto "Long table", made of Counter 3, 4 and 5; the party ends at Bar and Counter 3, 4, 5, as `floor-today-flatten-api.test.ts:270-292` shows), or the party's own table taken into a named group | Long table → Bar, Counter 3, 4, 5 | yes (a)(b): Long table and its name are gone | `Order 1` | all |
| 6c | A free table pushed onto a named group the party sits at | Fiesta → Fiesta | no: the name stays | — | — |
| 7 | Join another party's table, the joining party's bills | Mesa 73 → Mesa 73, Mesa 74 | no | — | — |
| 7 | the same, the other party's bill **when bills merge** | Mesa 74 → Mesa 73, Mesa 74 | **yes (c)** — was "no" in the design | `Order 25 -> 24` | all of order 25's |
| 7' | the same, the other party's bill, bills kept separate | Mesa 74 → Mesa 73, Mesa 74 | no | — | — |
| 8, 10 | Split a table (no bill chosen), Split tables… on a seated group | Mesa 51, Mesa 52 → Mesa 51 | yes (a), ruling 1 | `Order 15` | all |
| 9 | Split a table, a bill chosen | the chosen bill: → Mesa 52; the rest: → Mesa 51 | yes (a), both | each its own | all |
| 11 | Split tables… on a joined table, down to one part | Barra larga → Taburete 3 | yes (a)(b) | `Order 21` | all |
| 11' | the same, two parts left | not re-derived; §7 task 1.4a pins it with a test | | | |
| 12 | Move this bill to a free table / onto another party | Mesa 41 → Mesa 42 | yes (a); (c) too when it merges into the main bill | `Order 11` / `Order 11 -> 10` | all |
| 12b | Move this bill between two tables of the group Terraza | Terraza (Mesa 77) → Terraza (Mesa 78) | yes (a) | `Order 40` | all |
| 13 | Move this bill to the counter | Mesa 43 → the counter | yes (a) | `Order 13 · Ana` (the party it left) | all |
| 14 | Move this bill, a counter order into a party | the counter → Mesa 101 | yes (b): "the counter" is gone; (c) too when it merges | `Order 31` / `Order 31 -> 30` | all |
| 15 | Rename a table or group for today | Fiesta → Fiesta 2 | yes (b), ruling 1 | `Order 26` | all |
| 16a | **Merge bills** (one party) | Mesa 91 → Mesa 91 | **yes (c)** — was "no" | `Order 28 -> 27` | all of order 28's; order 27's own get none |
| 16b | **Transfer items** (one party) | Mesa 91 → Mesa 91 | **yes (c)** — was "no" | `Order 28 -> 27` | only the dishes transferred, at the part moved; order 28's remaining dishes get none |
| 16c | **Split the bill** | Mesa 91 → Mesa 91 (a counter order: the counter → the counter) | **yes (c)** — was "no" | `Order 28 -> 29` (the new order) | only the dishes split off |
| 17 | Reset to saved plan, Reset table, Name the party | unchanged | no | — | — |
| 18 | **New:** a counter order delivered to a table whose shown name changes (that table's group ends, is renamed, or the table is split off) | e.g. Cumple Ana → Mesa 6 | yes (b) | `Order 44` | all |

"Only the order number changed" is rows 7 (other bill, bills merging), 16a, 16b and 16c: the
places read the same before and after, and From and To print the same text. The design's bracket
rule (each side adds its tables in brackets when the names read the same) applies only when the
**tables** differ (row 12b); when they are the same, no brackets are added.

Code facts behind the new rows, read, not run: Merge bills and every bill merge go through
`mergeCheckedBills` (`apps/server/src/bill-actions.ts:178-202`), which moves every line with
`moveOrderLines` and already calls `enqueueMovedSlips` unless its caller tells the kitchen itself
(`kitchenTold`). Transfer items reads the sent work and calls `enqueueMovedSlips` with the split map
(`apps/server/src/bill-actions.ts:208-230`). **Split the bill calls neither** (`splitBill`,
`apps/server/src/bill-actions.ts:131-155`), so it needs a new call. Today these paths print nothing
only because the two labels compare equal (`apps/server/src/kitchen-print.ts:1034`).

The kitchen display's `moved` notice follows the same rule and carries the same To text as the
slip, so the screen and the paper agree (§4, last bullets).

## 4. What the slip says

One slip **per order per station** (ruling 2), not one per kitchen line. Drawings: picture 5.

```
80 mm, English (42 columns)            58 mm, Spanish (30 columns)
*** MOVED ***                          *** MOVIDO ***
Grill                                  Grill
Order 28 -> 27 · Ana                   Pedido 28 -> 27 · Ana
From: Mesa 91                          De: Mesa 91
To:   Mesa 91                          A:  Mesa 91
13:24                                  13:24
1.000 x BURG                           1.000 x BURG
HOLD                                   HOLD
GROUP 2                                GROUP 2
1.000 x STEAK                          1.000 x STEAK
```

- **Order line**: `Order N` / `Pedido N`, N being the order's number before the action. When the
  dishes are now on an order with another number: `Order N -> M`. Then, when the order's party has
  its own name (Name the party, `parties.name`, `packages/db/src/schema/parties.ts:47`), ` · name`
  (ruling 3). The name is that of the party the order belongs to after the action; a bill moved to
  the counter belongs to none and takes the name of the party it left. No name, nothing added.
  **Stated default:** a counter order's own label (`working_orders.label`, the name typed at the
  counter, or the party name copied in by `counterLabel`, `apps/server/src/move-bill.ts:268-270`)
  is not printed on the order line; for a counter order delivered to no table it already reads in
  later tickets' place line. A
  long line wraps with its continuation under the text after `Order N · `. The middle dot is in the
  printer's glyph table (`packages/printing/src/glyphs.ts:136`, code point `0x00b7`), so
  `prepareText` keeps it (`packages/printing/src/text.ts:33-46`); read, not printed.
- **Superseded:** "The party's own name is not printed (question 3)" — ruling 3 reversed it. The
  party's name still does **not** print on ordinary kitchen tickets; §8 question B. (2026-10-15:
  A683 now prints it on every kitchen ticket.)
- **From**: the place names before the action, as tickets print them. **To**: the place names a
  ticket printed now would carry. When the two read the same but the tables differ (the Terraza
  case), each side adds its tables in brackets: `From: Terraza (Mesa 77)`, `To: Terraza (Mesa 78)`.
  When the tables are the same too (an order-number change), no brackets.
- **The counter** prints as `(counter)` / `(mostrador)`, in brackets so it cannot be read as a table
  called "Counter 3". Later tickets for a counter order still carry the order's own label (`Mesa 43`,
  or `Ana` for a party named Ana); this plan does not change that.
- A long name wraps under itself: `From: ` and `To:   ` are both six characters wide in English,
  `De: ` and `A:  ` both four in Spanish.
- **Dishes**: per §3's "Dishes listed" column, in line order, at the quantity the ticket asked for.
  Dishes made at the till are left out, as today.
- **HOLD section** (ruling 5): held dishes the kitchen has on a HOLD ticket (their group is still
  held and `order_groups.hold_printed_at` is set — the same test a Reprint uses,
  `readReprintParts`, `apps/server/src/kitchen-print.ts:1210-1260`) follow the fired dishes under a
  `HOLD` line, each group under `GROUP n`. A slip whose dishes are all held starts with `HOLD`.
  `HOLD` and `GROUP n` stay English, as on every kitchen paper today (`kitchen-ticket.ts` comment
  above `CorrectionSlip`, lines 256-267).
- **Time**: when the move happened, as today.
- **Language**: the kitchen's word language, `WAITRON_TILL_LOCALE`, default `es-ES`
  (`apps/server/src/till-config.ts:80-81`), read the way `kitchenWords` reads it
  (`apps/server/src/kitchen-ticket.ts:283-317`): Spanish for an `es` locale, else English. Words:
  `MOVED`/`MOVIDO`, `Order`/`Pedido`, `From:`/`De:`, `To:`/`A:`, `(counter)`/`(mostrador)`.
- **The kitchen display's notice**: each dish still gets a `moved` notice, one per dish as today
  (the station screen lists notices per dish). Today its `moved_to` is the destination's header
  label (`apps/server/src/kitchen-print.ts:1100-1107` passes `header.tableLabel`), which for a bill
  moved to the counter is the counter order's own label: `party-move-bill.test.ts:1222-1233` pins
  `moved_to: "Mesa aviso 2 A"`, and the screen shows "Moved to Mesa aviso 2 A"
  (`apps/till/src/widgets/station-queue.ts:841-848`). The build makes `moved_to` the slip's To text,
  which is the same as today's header label except in the bracket case and for the counter; for the
  counter it is stored empty and the till shows a new sentence, "Moved to the counter" / "Pasado al
  mostrador". That test changes (§7 task 1.8). When the number
  changed, the notice's order reads `#28 → #27` instead of `#27` (the label is built in
  `recordKitchenNotices`, `packages/venue-service/src/kitchen-notices.ts:142-144`).
- **A station set not to print MOVED slips** (§6) gets no slip; its notices are still recorded.

## 5. "(was N)" on the till (ruling 4)

Drawing: picture 6.

### Where an order number shows on the till today

Read, not run. The till shows an order's number as `#N` in these places, and nowhere on the table
screen:

| Screen | Code | Data it reads |
| --- | --- | --- |
| Pass screen and All stations (the expediter's cards) | `apps/till/src/screens/till-expo-screen.ts:866-870` | `ExpoOrder.orderNumber`, `apps/till/src/api/client.ts:1643-1659`, from `listExpoQueue` (`apps/server/src/working-order.ts:6899`) and, on a device's pass screen, `listPassScreen`/`listPassMonitor` (`apps/server/src/pass-board.ts:52`, `:104`) |
| A station's kitchen screen (its ticket rail) | `apps/till/src/widgets/station-queue.ts:880-889` | `StationQueueGroup.orderNumber`, `apps/till/src/api/client.ts:1377-1398`, from `listStationQueues` (`apps/server/src/working-order.ts:6636`) |
| The counter's Waiting list | `apps/till/src/widgets/counter-waiting.ts:94-101` | `CounterWaitingOrder`, from `listCounterWaiting` (`apps/server/src/working-order.ts:6128`) |
| The counter's Held orders | `apps/till/src/widgets/held-orders.ts:190-198` | `HeldOrderSummary`, from `listHeldOrders` (`apps/server/src/working-order.ts:4169`) |

The table screen names a party's bills by position, "Ana · Bill 1" (`billName`,
`apps/till/src/state/bill-state.ts:24-28`, string `table.bill_of`), and `PartyBill` carries no order
number (`apps/till/src/api/client.ts:1780-1805`). The Find bill window shows numbers of unpaid bills
of guests who left (`apps/till/src/widgets/find-bill-dialog.ts:354-375`), which the kitchen never
calls; it is left alone.

Other places show an order number too, each with a decision:

- **The kitchen screen's kanban cell** (`apps/till/src/widgets/station-queue.ts:1059-1064`, "a cell
  keeps the order number beside the dish"): **shows "(was N)"**, because the cook reads the number
  there as on the ticket head.
- **The unprinted-tickets banner** on the kitchen screen (`station-queue.ts:976-985`, "orders whose
  tickets have not printed"): **left alone**. It names orders to reprint, and a Reprint prints the
  current number.
- **The card name in a kitchen screen's message** (`apps/till/src/screens/till-station-screen.ts:701-706`,
  the card's label, else `#N`) and **the expediter's refusal message**
  (`apps/till/src/screens/till-expo-screen.ts:746-753`): **left alone**. They point at a card on the
  same screen, whose head already shows "(was N)".
- **Department transfers' "Tab {number}"** (`apps/till/src/widgets/department-transfers.ts:471`):
  **left alone**. A transfer between departments is not a call from the kitchen.

So **"(was N)" is shown in the four places of the table above, and in the kanban cell**: `#27 (was 28)` / `#27 (antes 28)`, the bracket
part in the muted text colour after the bold number. Several numbers read `#27 (was 28, 30)`,
lowest first. Whether the table screen should start showing order numbers at all is §8 question A.

### What it reads, and why it needs stored data

Nothing stored today says which number a dish was sent under once it moves. A merged bill is set
`abandoned` and its lines move to the other bill (`mergeCheckedBills`,
`apps/server/src/bill-actions.ts:191-200`); `working_orders` has no column naming the bill it went
into (`packages/db/src/schema/orders.ts:64-109`), and an abandoned bill could also be a cancelled
one. The dishes' kitchen items move with their lines (`moveOrderLines` updates
`ticket_items.working_order_id`, `apps/server/src/working-order.ts:3257-3266`), and `ticket_items`
records no number (`packages/db/src/schema/ticket-items.ts:32-72`). `kitchen_print_jobs` records
an order id, not a number, and its links are moved too (`moveKitchenPrintLinks`,
`apps/server/src/kitchen-print.ts:1543-1557`). So **"(was N)" needs a migration.**

**The stored fact: `ticket_items.sent_order_number`** — a new nullable whole-number column in the
core `@waitron/db` migration set (`ticket_items` lives in `packages/db/src/schema/ticket-items.ts`).
It is null while the dish never left the order it was sent on. When a dish the kitchen has seen
moves to another order, it is set to the number of the order it leaves, **unless it already holds
one**: the first number is the one on the dish's kitchen paper. "Seen" means fired (`fired_at`
set), or held in a group already printed on a HOLD ticket (`order_groups.hold_printed_at` set,
`packages/db/src/schema/order-groups.ts:33`). A held dish whose HOLD ticket never printed is left
null: its first ticket prints under the order it is on when it fires, so "(was 28)" would name a
number the kitchen never saw.
The write goes where kitchen items change order: `moveOrderLines`
(`apps/server/src/working-order.ts:3257-3266`) and the copy of a kitchen item that `carveLines`
makes when part of a line moves (`splitTicketItem`, `apps/server/src/working-order.ts:4027-4050`,
which copies every column of the original with `...ticket`; its callers record the copies in
`splitFrom` at `:3913` and `:3927`), only when the two orders differ — `carveLines` is also used
within one order (`working-order.ts:4004`, `:4017`), which must leave the column alone. Every path
that changes a dish's order goes through those two functions: Merge bills, Transfer items, Split the bill (`bill-actions.ts:149`, `:192`,
`:224`) and every merge (`mergeCheckedBills`, called from `move-bill.ts:138` and
`table-actions.ts:244`); `grep` found no other caller.

2026-10-14 (A687): an edit that replaces a sent dish's kitchen items (`applyLineEdits`) also writes
the column: each replacement — the dish's and each kept extra's — takes the number its own old item
held, unless the replacement is made here.

An existing row stays null, which shows nothing; no backfill (CLAUDE.md §3: no data-migration code
before production).

**Why per dish, not per bill**: it covers Transfer items and Split the bill, where both bills carry
on, and chains of merges, with one rule. A bill's "(was …)" list is the distinct
`sent_order_number` values of its kitchen items that differ from its own number.

### Which numbers, how long

- **Merge bills**: 27 shows `(was 28)`.
- **Two merges** (30 into 28, then 28 into 27): 27 shows `(was 28, 30)` — 30's dishes keep 30, 28's
  own dishes get 28.
- **Transfer items** (dishes from 28 to 27, both carry on): 27 shows `(was 28)` and 28 shows plain
  `#28`. **It applies**, because the moved dishes' paper says 28: a cook calling 28 can mean either
  card, and both show 28 (picture 6).
- **Split the bill** (dishes from 28 onto a new 29): 29 shows `(was 28)`. For a counter order, the
  same on the Waiting list.
- **Move guests / Move this bill without a merge**: the number does not change; nothing shows.
- **Stated default: the list is the whole bill's.** A station's kitchen screen shows "(was 28)" on
  order 27 even when that station never had one of the dishes that came from 28. A per-station list
  would need the reader to filter by station; the plan keeps one list per order.
- **How long**: as long as the order is on that screen. No timer and no clearing: an order leaves
  the station rail once abandoned or collected (`apps/till/src/api/client.ts:1382-1383`), and the
  other lists drop it when it is done. A Reprint does not clear it: the old paper may still be on
  the rail.
- **The setting does not touch it**: the column is written whatever any station prints, so a
  station set not to print MOVED slips still sees "(was 28)" on its screen, as ruling 6 asks.

The wire: each of `ExpoOrder` (and so `WatcherOrder`), `StationQueueGroup`, `CounterWaitingOrder`
and `HeldOrderSummary` gains `formerNumbers?: number[]`, **absent when empty**, the way
`printProblem?: true` is (`apps/till/src/api/client.ts:1387-1389`), so responses for orders that
never moved are unchanged.

## 6. The MOVED-slip setting (ruling 6)

Drawing: picture 7.

### The venue default

- **Where it is stored**: a new column `print_moved_slips` on `service_settings`, the venue's
  one-row service settings in the `@waitron/venue-service` migration set
  (`packages/venue-service/src/schema/settings.ts:10-33`), beside `print_held_work`. Declared
  `flag("print_moved_slips").notNull().default(true)`. `print_held_work` was added the same way, a
  plain `ALTER TABLE … ADD`
  (`packages/venue-service/drizzle/0007_print_held_work_notice_direction.sql:1`), so no table
  rebuild. `service_settings` is classified `state`
  (`packages/venue-service/src/classification.ts:35`) and is not in
  `scripts/write-path-tables.json`; adding a column changes neither.
- **Default for a new venue: on**, today's behaviour. Provisioning inserts the row with only
  `id: 1` (`packages/venue-service/src/provisioning.ts:180-183`), so the column default decides it,
  and an existing venue reads on after migrating too.
- **Configuration transfer**: `service_settings` is in the venue-service export list with no
  `omit` (`packages/venue-service/src/configuration-transfer.ts:672`), and the export copies each
  row whole except the declaration's `omit` columns (`apps/server/src/configuration-transfer.ts:319-327`;
  read, not run). **Decision:** the new column travels with a configuration transfer, as
  `print_held_work` does; no change needed. The same holds for the station column in §6's override:
  `kitchen_stations` is exported omitting only its three retired timing columns
  (`packages/db/src/configuration-transfer.ts:27-32`).
- **Reads and writes**: `readPrintMovedSlips` and `writePrintMovedSlips` beside
  `readPrintHeldWork`/`writePrintHeldWork` (`packages/venue-service/src/kitchen-notices.ts:307-321`),
  exported through the service the server calls (`VENUE_SERVICE`, as `readPrintHeldWork` is read at
  `apps/server/src/order-groups.ts:1312`); the dashboard reads it in the settings view and saves it
  through a route beside `printHeldWork`'s (the settings view at
  `packages/venue-service/src/routes.ts:703-708` and the save at `:760-768`).
- **Dashboard placement**: Venue settings → Kitchen tab, the "Changes after sending" section
  (`#kitchen`, `packages/venue-service/src/dashboard/service-settings-panel.ts:138-164`, mounted as
  the `venue-service-kitchen` settings panel, `packages/venue-service/src/dashboard/index.ts:92-108`),
  a switch after "Print held groups in advance" and before "Reminder to fire the next group".
  Label "Print MOVED slips" / "Imprimir avisos MOVIDO"; hint "When food the kitchen already has
  moves to another table or another order, each of its prep stations' printers prints a MOVED slip
  saying from where to where. A prep station can be set to differ." / "Cuando comida que ya tiene
  la cocina pasa a otra mesa u otro pedido, las impresoras de cada estación imprimen un aviso
  MOVIDO que dice de dónde a dónde. Cada estación puede configurarse aparte." It saves when flipped,
  like its neighbours (`#save` and `#switch`, `service-settings-panel.ts:97-137`). Part 3 ships the
  hint without its last sentence (the prep-station one); Part 4 adds it back with the station's choice.

### The prep station's override

- **Three states: as the venue, print, don't print.** "As the venue" follows a later change to the
  venue default; "print" lets one station print while the venue default is off, and "don't print"
  the reverse. Two states would force every station to copy the venue's choice by hand.
- **Where it is stored**: a new nullable column `print_moved_slips` on `kitchen_stations` (null = as
  the venue, true = print, false = don't print), in the core `@waitron/db` set
  (`packages/db/src/schema/kitchen-stations.ts:11-43`), beside `shows_rest_of_order`, which was added
  the same way: ``ALTER TABLE `kitchen_stations` ADD `shows_rest_of_order` integer DEFAULT false NOT
  NULL`` (`packages/db/drizzle/0062_rest_of_order_made_here.sql:9`). No CHECK: the table's own comment
  keeps retired columns "to avoid rebuilding this parent" (`kitchen-stations.ts:18`), and a rebuild of
  a parent table deletes cascading children's rows (CLAUDE.md §3).
- **The write**: the station update route already takes `showsRestOfOrder`
  (`apps/server/src/management-api.ts:1878-1910`); it takes `printMovedSlips: true | false | null`
  the same way, refusing anything else with `management.request_invalid` naming `printMovedSlips`.
- **Dashboard placement**: the Edit station window (`prep-station-editor`,
  `packages/venue-service/src/dashboard/station-editor.ts:455-561`), a `wt-combobox` named
  `printMovedSlips` after the "Show the rest of the order" switch. Label "MOVED slips" / "Avisos
  MOVIDO"; options "As the venue (print)" or "As the venue (don't print)" naming the venue's current
  choice, "Print", "Don't print" / "Como el local (imprimir)", "Como el local (no imprimir)",
  "Imprimir", "No imprimir". It is part of the window's draft, saved with its Save, which stays
  quiet and disabled until something changes (design-system.md → Forms; the window already uses
  `draftScopeFor`/`saveActionState`). The window learns the venue's choice from the routing view
  the prep stations screen already loads (`GET /management-api/venue-service/routing`,
  `packages/venue-service/src/routes.ts:639`, read by `PrepStationsApi.load`,
  `packages/venue-service/src/dashboard/routing-client.ts:73-81`), which gains the venue's value.
  The New station window keeps today's fields; a new station follows the venue.

### What it does

The rule in §3 decides as before; then, at print time, a station whose effective setting (its own,
else the venue's) is off gets **no MOVED slip**. Its kitchen-screen notices are still recorded (§8
question C), and "(was N)" still shows (§5). Other corrections (VOID, RECALLED, HOLD corrections,
MOVED TO a station) are not affected.

## 7. The build: four parts, one pull request each

Each part leaves `main` green and correct on its own. Order:

- **Part 1 and Part 2 are independent** and may run in parallel lanes (both touch
  `apps/till/src/i18n/strings.ts` and `apps/till/src/widgets/station-queue.ts`; whichever lands
  second rebases).
- **Part 3 after Part 1** (both change the MOVED printing in `kitchen-print.ts`).
- **Part 4 after Parts 2 and 3, and after lane A's `feat/a506-12-station-times` lands.** After Part
  2, so its test that a station set not to print still shows "(was 28)" (ruling 6) is unconditional.
  After lane A: `git diff --stat origin/main...feat/a506-12-station-times` (re-run 2026-10-14 after
  the review, branch tip `b02f96aa5`) reports 47 files, among them `prep-stations-screen.ts`,
  `prep-stations-screen.test.ts`, `prep-stations-screen.a11y.test.ts`, `station-table.ts`,
  `packages/venue-service/src/dashboard/strings.ts` and `packages/venue-service/src/routes.ts`; Part
  4 changes `prep-stations-screen.ts`, `strings.ts` and `routes.ts` (task 4.3). Part 3 adds strings
  and a route to the last two, so start it after that branch lands too, or expect a small rebase.
  **Whoever dispatches Part 3 or Part 4 re-runs that diff first**: the branch is still moving.

Every task is test-first: write the failing test, run it and see it fail for the stated reason,
then the code. Commands run from the worktree root. Package test runs:
`unset AI_AGENT CLAUDECODE; pnpm --filter <package> exec vitest run <file>` (read the `Tests`
count; CLAUDE.md §4). Root guards: `unset AI_AGENT CLAUDECODE; pnpm exec vitest run scripts/<name>`.
Every implementer also runs `pnpm format:check`.

**No fiscal code is touched by any part.** Every file named below is under `apps/server`,
`apps/till`, `packages/db`, `packages/venue-service` or `packages/printing` (read only); none is
under `packages/fiscal*`. `grep -l fiscal` over the main server files (`kitchen-print.ts`,
`kitchen-ticket.ts`, `bill-actions.ts`, `move-bill.ts`, `table-actions.ts`, the floor-today files,
`pass-board.ts`) found none; it found only a comment in `packages/db/src/schema/ticket-items.ts:27`.
Each PR states that the huella tests (`packages/fiscal-verifactu/src/*.huella.test.ts`) and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts` pass unedited.

**Changed test checks.** Each PR lists, under that heading, every existing assertion it changes and
every fixture it adds a field to; the owner's rulings are why they change. The lists below are what
reading the tests predicts; the implementer works out each case from the rule in §3 and lists what
actually changed.

### Part 1 — the new rule and the new slip (server, plus the notice sentence on the till)

Review path: **FULL** (it changes what every MOVED slip prints, and `recordKitchenNotices` is a
cross-package contract). No migration.

**Task 1.1 — the slip's layout (pure).** Files: `apps/server/src/kitchen-ticket.ts`,
`apps/server/src/kitchen-ticket.test.ts`. Replace the MOVED branch of `CorrectionSlip` and
`formatCorrectionSlip` (`kitchen-ticket.ts:256-367`) with a `formatMovedSlip` taking: station name,
from number, to number (absent when the same), party name (optional), from text, to text, time,
fired items, held groups (`{ group, items }[]`), locale. Failing tests first, decoded with the
existing helpers: (a) EN 80 mm, `Order 28 -> 27 · Ana` / `From: Mesa 91` / `To:   Mesa 91` /
`13:24` / `1.000 x BURG`, header `*** MOVED ***`; (b) ES 58 mm, `*** MOVIDO ***`, `Pedido 28 -> 27 ·
Ana`, `De: Mesa 91`, `A:  Mesa 91`; (c) no party name and the same number: `Order 26`; (d) From
`Cumpleaños de la abuela García` at 58 mm wraps with `      García` (EN) / `    García` (ES) under
the name; (e) the order line at 58 mm `Pedido 7 · Cumpleaños de la abuela` wraps with `abuela`
under `Cumpleaños`; (f) a HOLD group prints `HOLD`, `GROUP 2`, `1.000 x STEAK` after the fired
dishes; (g) the counter text is the caller's (`(counter)`). Replace the two existing MOVED cases
(`kitchen-ticket.test.ts:624` and `:651`). Run:
`pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts`.

**Task 1.2 — reading an order's places.** New file `apps/server/src/order-places.ts` with
`readOrderPlaces(tx, cfg, orderIds)` → per order: its table ids, its place names (as
`orderTableLabels` builds them, a named group once), each table's shown name (for the Terraza
brackets), its number, its party's own name. A party bill: the party's active `party_tables`, or,
when it holds none, those of the party at the end of its merge chain (`partySurvivors`, exported
from `@waitron/db`, `packages/db/src/index.ts:250`); a counter order: its `delivery_table_id`, else
"the counter". Failing tests (new `apps/server/src/order-places.test.ts`, `useVenueDb`): a party at
Mesa 6 and Mesa 9 in group "Cumple Ana" reads names `["Cumple Ana"]` and two table ids; a party
holding Mesa 77 of group Terraza reads names `["Terraza"]`, tables `[Mesa 77]`; a paid bill on a
party merged into another reads the survivor's tables; a counter order delivered to Mesa 6 reads
Mesa 6's shown name; an undelivered counter order reads the counter. Run that file.

**Task 1.3 — one slip per order per station, new layout, old decision.** Files:
`apps/server/src/kitchen-print.ts` (`SentWork`, `readSentWork`, `readPartiesSentWork`,
`notifyMoved`, a new `printMovedSlips` replacing the MOVED use of `printCorrectionSlips`). `SentWork`
gains the places from 1.2 and the party name. `notifyMoved` groups the moved items by station and
prints one 1.1 slip per station; notices stay one per dish. The decision is unchanged in this task.
Failing test first in `apps/server/src/move-merge.test.ts`: a party with orders 5 (Burger ×2, Chips
at Grill; Flan at Postres) and 6 (Burger at Grill) moving Mesa 11 → Mesa 12 queues three slips —
Grill `Order 5` with both dishes, Grill `Order 6`, Postres `Order 5` (today four). Changed checks
expected (text or count of slips): `today-names.test.ts` (the `${name} -> …` expectations at lines
260, 429, 445-446, 495, 527, 544, 559), `move-merge.test.ts:396-399`, `split-bill.test.ts:967` and
`:1051` (`movedSlip("T1 -> T2", …)`), `made-here.routes.test.ts:864` if its count changes,
`split-off-extras.split.test.ts:213-224` if its slip text is checked beyond `MOVED` and the dish.
Run each changed file.

**Task 1.4a — the new decision: tables and names lost.** Files: `kitchen-print.ts`
(`enqueueMovedSlips`, `enqueueMovedSlipsFor`). Print when a table was lost or a name was lost (§3);
brackets for the Terraza case only. Failing tests: the owner's group-of-four case prints nothing;
Cumple Ana prints `From: Cumple Ana` / `To: Mesa 6, 9`; a join of a free table prints nothing;
pushing Bar onto the joined table "Long table" prints, because Long table and its name are gone
(§3 row 6b); Split a table with no bill chosen prints exactly `From: Mesa 51, 52` / `To: Mesa 51`
for the bills that stay; the Terraza move prints the brackets; path 11 with two parts left — pin
whatever the rule gives, with the reason in the test name. Changed checks expected:
`today-names.test.ts:235` ("the same push onto an unnamed seated group prints one MOVED slip" —
now none) and `:547` ("Bar back … prints one MOVED slip from the name to Bar and the name" — now
none); `split-off-extras.split.test.ts:203-224` (joins a free table with bills kept separate and
expects one slip each at Grill and Fryer — now none); `party-bill-actions.test.ts:1061-1064` (the
helper's control expects a join that only gains a table to print — give the control a path that
still prints). Work out from the rule, and list, the join cases in `party-table-actions.test.ts`
(`:768`, `:1296`, `:1314`, `:1332`) and `move-merge.test.ts:355`. The five cases in
`floor-today-flatten-api.test.ts` (`:295`, `:367`, `:438`, `:463`, `:492`) all break up the joined
table "Long table" (the party ends at Bar and Counter 3, 4, 5, `:284-289`), so they are expected
to keep their notice. `floor-today-split.test.ts:519-532` and `floor-today-split-group.test.ts:878-892`
pin `moved_to` values that equal today's header label (`kitchen-print.ts:1100-1107` passes
`header.tableLabel`), which the To text keeps outside the bracket and counter cases, so they are
expected unchanged; run them. Run each file named.

**Task 1.4b — the new decision: number changes.** Files: `kitchen-print.ts`,
`apps/server/src/move-bill.ts` (drop `force`, `:153-155`). Print when dishes are now on an order
with another number; follow `mergedInto` to the end of its chain. Failing tests: a join of another
party's table with bills merging prints `Order 25 -> 24` / `From: Mesa 74` / `To: Mesa 73, 74` and
nothing for order 24; Merge bills at Mesa 91 prints `Order 28 -> 27` with From and To both `Mesa
91`; Transfer items prints only the dishes moved; a bill to the counter prints `To: (counter)`; a
counter order moved into a party prints `From: (counter)`. Changed checks expected:
`party-bill-actions.test.ts:1068` ("tells the kitchen nothing of a merge" — now a slip) and `:1080`
(part of a sent line transferred — now a slip). Run each file named.

**Task 1.5 — Split the bill tells the kitchen.** File: `apps/server/src/bill-actions.ts`
(`splitBill`, `:131-155`): read the sent work before `carveOffLines` and call
`enqueueMovedSlips` with its split map onto the new bill. Failing test (in
`apps/server/src/party-bill-actions.test.ts` or `split-bill.test.ts`): splitting a sent Flan off
order 28 queues one Postres slip `Order 28 -> 29` listing only the Flan; splitting an unsent dish
queues nothing; a counter order split prints `From: (counter)` / `To: (counter)`. Run the file.

**Task 1.6 — held dishes on a HOLD ticket (ruling 5).** Files: `kitchen-print.ts`
(`readSentWork`, `readPartiesSentWork`, `notifyMoved`). Read held dishes whose group is held with
`hold_printed_at` set, as `readReprintParts` does (`kitchen-print.ts:1229-1245`); list them under
HOLD; record their notices as for fired dishes. Failing tests: with print held work on, a party
with a fired Burger and a held group 2 Steak on a HOLD ticket moving Mesa 111 → 112 prints one Grill
slip listing both, Steak under `HOLD` / `GROUP 2`; a held group never printed adds nothing.
Changed check expected: `split-bill.test.ts:1013` ("… and none for held work"). Run the file.

**Task 1.7 — rename, and counter orders at touched tables.** Files:
`apps/server/src/floor-today-name.ts` (`nameToday`, `:20-55`), `apps/server/src/floor-today-api.ts:185`,
and `kitchen-print.ts` (`readPartiesSentWork` also reads the sent counter orders delivered to the
tables the action touches; today it reads party bills only, `kitchen-print.ts:1148-1152`). The
rename reads the sent work of the parties seated at the table or its group, and of counter orders
delivered there, before renaming, and calls `enqueueMovedSlipsFor` after. Failing tests (in
`apps/server/src/today-names.test.ts`): renaming the seated group Fiesta to Fiesta 2 prints `From:
Fiesta` / `To: Fiesta 2`; renaming a table nobody sits at prints nothing; a counter order delivered
to Mesa 6 prints `From: Cumple Ana` / `To: Mesa 6` when that group ends by Back to saved place.
Reword the A606 decision in `docs/backlog/till.md`, which says a rename prints nothing, in the same
PR. Run the file.

**Task 1.8 — the kitchen screen's notice.** Files:
`packages/venue-service/src/kitchen-notices.ts` (`recordKitchenNotices` takes an optional number
the dishes came from; the order label then reads `#28 → #27`), `kitchen-print.ts` (passes the To
text as `movedTo`, null for the counter), `apps/till/src/widgets/station-queue.ts:841-848` and
`apps/till/src/i18n/strings.ts` (new `station.notice.moved_to_counter`: "Moved to the counter" /
"Pasado al mostrador"). Failing tests: `packages/venue-service/src/kitchen-notices.test.ts` — a
moved notice recorded with a from number 28 on order 27 has `orderLabel` `#28 → #27`;
`apps/till/src/widgets/station-queue.test.ts` — a `moved` notice with `movedTo: null` shows "Moved
to the counter"; add that state to `station-queue.a11y.test.ts` and
`apps/till/src/screens/till-station-screen.a11y.test.ts` (whose moved notice, `:148`, carries
`movedTo: "Terraza 2"`). Changed check expected: `party-move-bill.test.ts:1222-1233` (a bill moved
to the counter pins `moved_to: "Mesa aviso 2 A"`, the counter order's label — now null); the other
notice cases there (`:1208`, `:1235`, `:1253`) pin table names that stay. `till-station-screen.test.ts`
has no `moved` notice (its notices are `kind: "void"`, e.g. `:1236-1247`), so it is expected
unchanged; run it. Run
`pnpm --filter @waitron/venue-service exec vitest run src/kitchen-notices.test.ts`,
`pnpm --filter @waitron/server exec vitest run src/party-move-bill.test.ts` and
`pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts
src/widgets/station-queue.a11y.test.ts src/screens/till-station-screen.test.ts
src/screens/till-station-screen.a11y.test.ts`.

Guards for Part 1: `scripts/english-only.test.ts` (Spanish words in `packages/`),
`scripts/errors-reachable.test.ts` (if any error code is added or dropped),
`scripts/style-token-names.test.ts` (task 1.8's till style, if any).

### Part 2 — "(was N)" on the till

Review path: **FULL** (a migration in the core set, and new fields on four till responses, a
server-to-till contract). Independent of Part 1.

**Task 2.1 — the column.** Files: `packages/db/src/schema/ticket-items.ts` (add
`sentOrderNumber: count("sent_order_number")`, nullable, with a one-line comment saying what it
holds), a generated migration (`pnpm --filter @waitron/db db:generate`). Check the generated SQL is
a single ``ALTER TABLE `ticket_items` ADD …`` and no rebuild. Failing test first:
`packages/db/src/schema/ticket-items.test.ts` inserting a kitchen item and reading
`sent_order_number` as null. Guards: `scripts/migrations-match-schema.test.ts`,
`scripts/schema-constraints.test.ts`, `scripts/journal-monotonic.test.ts`,
`scripts/migration-upgrade.test.ts`, `scripts/append-only-triggers.test.ts`,
`scripts/behavioural-triggers.test.ts`, `scripts/column-vocabulary.test.ts`,
`scripts/module-graph-honesty.test.ts`, `scripts/classification-complete.test.ts`. A rebase onto a
newer migration is fixed by regeneration (CLAUDE.md §3).

**Task 2.2 — writing it.** File: `apps/server/src/working-order.ts` (`moveOrderLines` around
`:3257-3266`, and `splitTicketItem`, `:4027-4050`). Written only for a kitchen item the kitchen
has seen: fired (`fired_at` set), or in a held group already printed on a HOLD ticket
(`order_groups.hold_printed_at` set, `packages/db/src/schema/order-groups.ts:33`). Failing tests
(new `apps/server/src/sent-order-number.test.ts`, `useVenueDb`): after Merge bills of 28 into 27,
28's sent Burger's kitchen item holds 28 and 27's own Paella holds null; after a second merge of 27
into 26, the Burger still holds 28 and the Paella holds 27; Transfer items of part of a sent line
gives the moved copy 28 and leaves the part kept on order 28 null; Split the bill gives the
split-off copy 28; a held dish whose group never printed stays null when it moves, and one whose
HOLD ticket printed gets 28; a carve within one order (`working-order.ts:4004`, `:4017`) leaves
null. Run the file.

**Task 2.3a — the kitchen-side reads.** Files: `apps/server/src/working-order.ts`
(`listStationQueues` `:6636`, `listExpoQueue` `:6899`), `apps/server/src/pass-board.ts` (if it
builds its own orders), one shared reader in a new `apps/server/src/former-numbers.ts`, and
`apps/till/src/api/client.ts` (`ExpoOrder`, `StationQueueGroup` gain `formerNumbers?: number[]`).
Failing tests in `apps/server/src/working-order-reads.sqlite.test.ts` (or one new file): after
Merge bills of 28 into 27 at Mesa 91, the expo queue's order 27 has `formerNumbers: [28]` and order
28 is gone; a station queue group likewise, including at a station that never had the moved dish
(the list is the whole bill's, §5); after two merges, `[28, 30]`; an order that never merged has no
`formerNumbers` key. Before finishing, run the server files that call these lists with whole-object
checks: `till-api.test.ts`, `made-here.test.ts`, `order-groups.test.ts`, `station-move.test.ts`,
`party-arriving-dishes.test.ts`, `table-signals.test.ts` (`grep -l
"listExpoQueue\|listStationQueue\|listCounterWaiting\|listHeldOrders"` found them).

**Task 2.3b — the counter reads.** Files: `apps/server/src/working-order.ts` (`listCounterWaiting`
`:6128`, `listHeldOrders` `:4169`), `apps/till/src/api/client.ts` (`CounterWaitingOrder`,
`HeldOrderSummary`). Failing tests: a counter order split with Split the bill (sent dishes from 40
onto 41) lists 41 with `formerNumbers: [40]` on the Waiting list; a held counter order that never
split has no key. Run the files task 2.3a names again.

**Task 2.4a — drawing it on the Pass and kitchen screens.** Files: a small helper in
`apps/till/src/widgets/` (for example `order-number.ts`) rendering `#27` plus a muted `(was 28,
30)`; `till-expo-screen.ts:868` (card head), `station-queue.ts:887` (ticket head) and
`station-queue.ts:1059-1064` (the kanban cell, which keeps the number beside each dish); strings
`order.was_numbers`: "(was {numbers})" / "(antes {numbers})". Failing tests:
`apps/till/src/screens/till-expo-screen.test.ts`, `apps/till/src/widgets/station-queue.test.ts` —
an order with `formerNumbers: [28]` shows `#27 (was 28)` in English and `#27 (antes 28)` in
Spanish, on the ticket head and on its kanban cells; `[28, 30]` shows `(was 28, 30)`; none shows
plain `#27`. Add the state to `till-expo-screen.a11y.test.ts` and `station-queue.a11y.test.ts` in
both themes. Guards: `scripts/style-token-names.test.ts`. Run each file.

**Task 2.4b — drawing it on the counter lists.** Files: `counter-waiting.ts:100`,
`held-orders.ts:197`, using 2.4a's helper. Failing tests: `counter-waiting.test.ts`,
`held-orders.test.ts` — `#41 (was 40)` / `#41 (antes 40)`, and plain `#41` with none. Add the state
to `counter-waiting.a11y.test.ts` and `held-orders.a11y.test.ts`. Run each file.

### Part 3 — the venue default

Review path: **FULL** (a migration in the venue-service set, and a new function on the service the
server calls, a cross-package contract). After Part 1; preferably after lane A's a506-12 (above).

**Task 3.1a — store and service.** Files: `packages/venue-service/src/schema/settings.ts`, a
generated migration (`pnpm --filter @waitron/venue-service db:generate`; check it is a single
`ALTER TABLE … ADD … DEFAULT true NOT NULL`), `packages/venue-service/src/kitchen-notices.ts`
(`readPrintMovedSlips`, `writePrintMovedSlips`), `packages/venue-service/src/service.ts` (export).
Failing tests in `packages/venue-service/src/kitchen-notices.test.ts`: a new venue reads `true`;
writing `false` reads `false`. Guards: the migration guards of task 2.1.

**Task 3.1b — route, view and fixtures.** Files: `packages/venue-service/src/routes.ts` (view field
and save route beside `printHeldWork`'s, `:703-708` and `:760-768`),
`packages/venue-service/src/dashboard/client.ts` (`VenueServiceModel` and
`VenueServiceSettingsView`, `:95-118`, gain a required `printMovedSlips: boolean` — the server
always sends it), and every fixture the type check then rejects. `grep -rl printHeldWork apps
packages --include='*.ts'` (run 2026-10-14) lists 33 files: 20 dashboard tests in
`packages/venue-service/src/dashboard/`, `apps/dashboard/src/dashboard-app.test.ts`,
`apps/dashboard/src/dashboard-app.receipt-dialog.test.ts`,
`packages/venue-service/test/service-delete-test-helpers.ts`,
`packages/venue-service/src/testing/department-zones-fixture.ts`, and the server and venue-service
files that read or write the setting. Find the ones that need the field with
`pnpm --filter @waitron/venue-service typecheck` and `pnpm --filter @waitron/dashboard typecheck`;
adding the field a fixture lacks is allowed, and each fixture is named in the PR. Failing tests in
`packages/venue-service/src/routes.test.ts`: the settings view carries `printMovedSlips: true`; the
save route stores `false`; it refuses a non-boolean with `management.request_invalid` naming
`printMovedSlips`. Guards: `scripts/live-subscriptions.test.ts` (the settings view is a live
query, `packages/venue-service/src/dashboard/live-queries.ts:81`).

**Task 3.2 — the server obeys it.** File: `apps/server/src/kitchen-print.ts` (Part 1's
`printMovedSlips`). Failing test (in `move-merge.test.ts` or a new
`apps/server/src/moved-slip-setting.test.ts`): with the venue default off, Move guests queues no
MOVED slip and still records the `moved` notices; with it on, the slip prints as in Part 1. Run the
file.

**Task 3.3 — the dashboard switch.** Files:
`packages/venue-service/src/dashboard/service-settings-panel.ts` (`Field` union, `#kitchen`),
`packages/venue-service/src/dashboard/client.ts` (`savePrintMovedSlips`),
`packages/venue-service/src/dashboard/strings.ts` (label and hint, §6). Failing tests in
`packages/venue-service/src/dashboard/service-settings-panel.test.ts`: the switch renders checked
from the view, flipping it calls `savePrintMovedSlips(false)`, a failed save shows the field's
error; read-only disables it. Add it to `service-settings-panel.a11y.test.ts`. Guards:
`scripts/native-form-fields.test.ts`, `scripts/english-only.test.ts`.

### Part 4 — the prep station's override

Review path: **FULL** (a migration in the core set). After Parts 2 and 3 and after lane A's
`feat/a506-12-station-times` has landed (above).

**Task 4.1 — store and write.** Files: `packages/db/src/schema/kitchen-stations.ts` (nullable
`printMovedSlips: flag("print_moved_slips")`, no default, no CHECK), a generated migration (check
it is a single ``ALTER TABLE `kitchen_stations` ADD …`` — a rebuild here would delete cascading
children's rows), `apps/server/src/kitchen.ts` (station read and update, `:131`, `:196`),
`apps/server/src/management-api.ts:1878-1910`. Failing tests: the station update accepts `true`,
`false` and `null` and reads them back; refuses `"yes"` with `management.request_invalid` naming
`printMovedSlips`; a new station reads null. Guards: the migration guards of task 2.1 (with
`scripts/classification-complete.test.ts`), plus `scripts/two-file-foreign-keys.test.ts`.

**Task 4.2 — the server obeys it.** File: `apps/server/src/kitchen-print.ts` (effective setting =
the station's, else the venue's, read with the stations it already reads, `readStations`,
`kitchen-print.ts:300-313`). Failing tests: venue on, Grill off, Postres following — Move guests
prints at Postres only and records notices at both; venue off, Grill on — prints at Grill only;
after Merge bills with every station off, no slip prints and the station queue still shows
`formerNumbers: [28]` (ruling 6; Part 2 has landed). Run the file.

**Task 4.3 — the Edit station window.** Files:
`packages/venue-service/src/routes.ts` (the routing view the prep stations screen loads,
`GET /management-api/venue-service/routing`, `:639`, also returns the venue's `printMovedSlips`, so
the window can name it), `packages/venue-service/src/dashboard/routing-client.ts` (`PrepStationsApi.load`,
`:73-81`, and the station type), `packages/venue-service/src/dashboard/station-editor.ts` (draft
field, the combobox after "Show the rest of the order", the changed-fields patch at `:366-368`'s
pattern), `prep-stations-screen.ts` (passes the station's value and the venue's in, `:889-897`),
`strings.ts`. Failing tests: `packages/venue-service/src/dashboard/station-editor.test.ts` — the
combobox shows "As the venue (print)" when the station is null and the venue on, "As the venue
(don't print)" when the venue is off; choosing "Don't print" enables Save and sends
`printMovedSlips: false`; choosing back the stored value disables Save again;
`station-editor.unsaved.test.ts` — a changed choice asks before closing;
`packages/venue-service/src/routes.test.ts` — the routing view carries the venue's value. Add the
combobox's states to `station-editor.a11y.test.ts`, and check `station-editor.save-state.test.ts`.
Guards: `scripts/native-form-fields.test.ts`, `scripts/english-only.test.ts`. Also add back the venue
switch's last hint sentence, "A prep station can be set to differ." / "Cada estación puede
configurarse aparte." (§6), which Part 3 left out, and its two pinned test strings.

## 8. Questions for the owner (the build proceeds on each default)

Drawings: picture 6 for A, picture 5 for B, picture 7 for C.

- **A. The table screen.** A party's bills are named "Ana · Bill 1" and show no order number, so
  "(was 28)" appears only where numbers already show (Pass screen, kitchen screens, the counter's
  Waiting and Held lists). Should a table's bill also show its number, "Ana · Bill 1 · #27 (was
  28)"? **Default: no** — a waiter answering a kitchen call looks at the Pass screen.
- **B. The party's name on ordinary kitchen tickets.** Ruling 3 puts "· Ana" on the MOVED slip; the
  first ticket for the order still prints no party name, so the cook meets the name first on a
  slip. Print it on every kitchen ticket too? **Default: slip only in this build**; a ticket change
  would be its own backlog entry. (2026-10-15: A683 prints it on every kitchen ticket.)
- **C. A station set not to print MOVED slips: its kitchen screen.** **Default: the moved notice
  still shows on that station's screen**, because the setting is about paper; say if "off" should
  silence the screen too.

The design's five questions (former §6) are answered by rulings 1 to 5 above.

## 9. Drawings

In [`docs/backlog/mockups/a650-moved-slips/`](../../backlog/mockups/a650-moved-slips/):

1. `1-owner-cases.png` — paths 1 and 2, today and as designed. Still right.
2. `2-whole-party-several-orders.png` — one slip per order per station. Still right, but drawn
   without the party's name (ruling 3).
3. `3-every-path.png` — every path as designed. **Superseded where the rulings differ**: path 7's
   other bill and path 16 now print (picture 5), and the order lines carry the party's name.
4. `4-question-variants.png` — the alternatives the questions offered; the rulings chose question
   1's proposed slip, question 3's alternative, question 4's alternative and question 5's proposal.
5. `5-slips-after-rulings.png` — the slips under this plan, English 80 mm and Spanish 58 mm.
6. `6-till-was-number.png` — "(was 28)" on the Pass screen, a kitchen screen and the counter list.
7. `7-moved-slip-setting.png` — the venue switch and the Edit station choice.

Pictures 1 to 4 come from `moved-slips-mockups.html`, 5 to 7 from `plan-mockups.html`, each section
rendered with the workspace's Playwright Chromium (a `locator('#s5').screenshot()` per section).

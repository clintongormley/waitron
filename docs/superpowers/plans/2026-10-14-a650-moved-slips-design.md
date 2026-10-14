# A650 — MOVED slips say which order moved, from where, to where (design, before the owner's answers)

Status: design only. Nothing is built until the owner answers the questions in §6. Drawings:
[`docs/backlog/mockups/a650-moved-slips/`](../../backlog/mockups/a650-moved-slips/).

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
the two label strings; moving a bill to the counter is the one path that prints whatever the names
read, the `force` option at `apps/server/src/move-bill.ts:154`).

## 2. What happens today, path by path

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
  today does, as the place name.
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
| 17 | **Reset to saved plan**, **Reset table**, **Name the party** | nothing moves or no name the kitchen sees changes | nothing (Reset table read, not run) |

Two more things the probe showed, outside this design's rule:

- A held dish already printed on a HOLD ticket gets no slip when its guests move (`readSentWork`
  and `readPartiesSentWork` read fired dishes only); question 5.
- Moving an OPEN counter order with nothing sent into a party printed an ordinary kitchen ticket for
  its dish. The cause was not traced. Backlog A660.

## 3. The proposed rule

**A MOVED slip prints for an order when it left a table, or when a place name on its kitchen paper
is no longer one of its place names.** Read each order the kitchen has dishes for before the action:
its tables, and its place names (the shown name of each of its tables or groups, as its tickets
print them; "the counter" for a counter order delivered to no table). Read them again after. Print
if a table it had is no longer one of its tables, or a name it had is no longer one of its names.
If both stayed the same or only grew, print nothing.

The table half catches a move the names hide: a bill moved from Mesa 77 to Mesa 78 inside the group
"Terraza" reads "Terraza" before and after; the design review's probe run (2026-10-14, the same
harness as §2) did exactly that and today's code printed nothing. Such a party holds only part of a group, which backlog A594 describes. The name half
catches the place the kitchen's paper names disappearing from the floor while the guests stay put
(a named group that ends).

| Case | Places before → after | Slip? |
| --- | --- | --- |
| Owner's group of four (path 1) | García birthday → Bar, García birthday | no: García birthday is still one of them |
| Named group of two ends (path 2) | Cumple Ana → Mesa 6, Mesa 9 | yes |
| Move guests (3, 4, 5), move a bill (12), split down to one part (11) | Mesa 11 → Mesa 12 | yes |
| Join or push a free table (6) | Mesa 71 → Mesa 71, Mesa 72 | no |
| Join another party's table (7), the other party's bill | Mesa 74 → Mesa 73, Mesa 74 | no: Mesa 74 is still one of them (question 4) |
| Split a table or tables (8, 9, 10), the bills that stay | Mesa 51, Mesa 52 → Mesa 51 | yes: Mesa 52 is no longer theirs (question 1) |
| To or from the counter (13, 14) | Mesa 43 → the counter | yes, whatever the bill's label says |
| Rename for today (15) | Fiesta → Fiesta 2 | yes under option (b) of question 1, no under (c) |
| Merge bills, Transfer items, Split the bill (16) | Mesa 91 → Mesa 91 | no (question 4) |
| A bill moved between two tables of the named group Terraza | Terraza (Mesa 77) → Terraza (Mesa 78) | yes: it left Mesa 77 |

The rule compares lists of tables and names, not the joined string, so `Mesa 6, 9` and `Mesa 9, 6`
are the same places. The "before" places are read when the action happens, as today; a dish fired
before an earlier rename was printed under the earlier name, and this design does not change that.

The kitchen display's `moved` notice ("Moved to {table}") follows the same rule and is given the
same To text as the slip, so the screen and the paper agree.

## 4. What the slip says

One slip **per order per station** (question 2), not one per kitchen line:

```
80 mm, English (42 columns)            58 mm, Spanish (30 columns)
*** MOVED ***                          *** MOVIDO ***
Grill                                  Postres
Order 5                                Pedido 5
From: Mesa 11                          De: Mesa 11
To:   Mesa 12                          A:  Mesa 12
13:24                                  13:24
2.000 x BURG                           1.000 x FLAN
1.000 x CHIPS
```

- **Order line**: the bill's number before the action. When the move also changes the number
  (bills merged): `Order 8 -> 9` / `Pedido 8 -> 9`. Limit, as today: a dish moved to another bill
  since its ticket printed (Split the bill, Transfer items) is listed under its bill's number now,
  which its ticket never showed. Recording each dish's ticket number would fix that; not proposed.
- **From**: the place names before the action, as tickets print them. **To**: the place names a
  ticket printed now would carry. When the two would read the same (the Terraza case), each side
  adds its tables in brackets: `From: Terraza (Mesa 77)`, `To: Terraza (Mesa 78)`.
- **The counter** prints as `(counter)` / `(mostrador)`, in brackets so it cannot be read as a table
  called "Counter 3". Later tickets for a counter order still carry the order's own label (`Mesa 43`,
  or `Ana` for a party named Ana); this design does not change that.
- A long name wraps under itself: `From: ` and `To:   ` are both six characters wide in English,
  `De: ` and `A:  ` both four in Spanish.
- **Dishes**: every line of that order at that station the kitchen has on paper, in order, at the
  quantity the ticket asked for. Dishes made at the till are left out, as today.
- **Time**: when the move happened, as today.
- **Language**: the same setting as the kitchen's other translated words (`WAITRON_TILL_LOCALE`,
  default `es-ES`). Today `MOVED` is never translated. Proposed Spanish: `MOVIDO`, `Pedido`, `De:`,
  `A:`, `(mostrador)`.
- The party's own name is not printed (question 3).

Drawings of every case, in English at 80 mm and Spanish at 58 mm, are in the mockups folder:

1. `1-owner-cases.png` — paths 1 and 2, today and proposed.
2. `2-whole-party-several-orders.png` — a party with two orders moves table; today's four slips and
   the proposed three.
3. `3-every-path.png` — every path in §2, what it prints today and what it would print.
4. `4-question-variants.png` — the alternatives the questions offer.

## 5. What a build changes (after the answers)

- `apps/server/src/kitchen-print.ts`: `SentWork` keeps the order's place list (and, under question
  5's (a), its held dishes on paper) as well as its label; `enqueueMovedSlips` and
  `enqueueMovedSlipsFor` decide by the rule in §3 instead of comparing strings; the `force` option
  goes, because the counter is a place of its own. `notifyMoved` prints one slip per order per
  station.
- `apps/server/src/kitchen-ticket.ts`: the MOVED slip takes a list of dishes, the order line and the
  From/To lines, translated.
- An order's place NAMES come from `billPartyTableLabels` (`packages/db/src/party-table-labels.ts`,
  exported from `@waitron/db`), which follows the merge chain of a party that holds no tables, such
  as the closed party a paid bill stays on, plus the delivery table's shown name for a counter
  order, read as `orderTableLabels` reads it. Not `partyTableLabels`: it returns an empty list for
  such a party, so a paid bill would read as having left its tables after a join.
- An order's TABLES need a reader of their own, because the name readers list a named group once
  and so cannot see the Terraza move: the table ids of the party's active `party_tables` rows,
  following the same merge chain when the party holds none, or the counter order's
  `delivery_table_id`.
- Under question 1's (b), the rename route (`nameToday`, `apps/server/src/floor-today-name.ts`) reads
  the parties' sent work before renaming and calls the same function.
- No path that changes a table's shown name or its party reads the counter orders delivered to that
  table: `readPartiesSentWork` reads party bills only (`apps/server/src/kitchen-print.ts:1149-1152`),
  and `readSentWork` reads one order, which only Move this bill hands a counter order, when that
  order itself moves (`apps/server/src/move-bill.ts:97`). Read, not run. For the name half of the
  rule to reach them, every path that changes a table's shown name (rename, join into a group, a
  group ending, Back to saved place, splits) must also read the counter orders delivered to the
  tables it touches. Without that, such an order gets no slip.
- Every existing check that pins today's slip text changes (the slip's lines and count); the PR lists
  each one. No fiscal code is touched. Review path: FULL (it changes what every MOVED slip prints).
  No migration.

## 6. Questions for the owner

Each has a recommended default. Drawings: `4-question-variants.png`.

1. **When does a slip print?**
   - (a) Only when the order left a table (the table half of §3). A group of two that ends prints
     nothing (this reverses your answer on A606 this morning), and so does a rename.
   - **(b) Recommended:** when it left a table or a name on its paper is gone (§3). Your group of
     four prints nothing; a group of two that ends prints "From: Cumple Ana / To: Mesa 6, 9", as
     your A606 answer asked; renaming a seated group with food sent prints "From: Fiesta / To:
     Fiesta 2" (today a rename prints nothing, the default you kept on 2026-10-14).
   - (c) As (b), but a rename prints nothing. Then a later slip's From can name a place the
     kitchen's paper never showed (the paper says "Fiesta", the slip "From: Fiesta 2").
   - Under every option, a party that loses a table it was sitting at (Split a table, Split tables…)
     gets a slip for the bills that stay with it: "From: Mesa 51, 52 / To: Mesa 51". Say if those
     should print nothing.
2. **One slip per order per station (recommended), or one slip per station for the whole move**
   listing every order? Example: a party with orders 5 and 6 moves; the Grill gets two slips under
   the recommendation, one with both orders under the other. Where two orders go to different
   places in one action (Split a table choosing a bill), the one slip gives each order its own
   From and To.
3. **The party's own name.** It never prints on kitchen tickets today, so the cook has nothing to
   match it with. Recommended: leave it off the slip. The alternative prints it after the order
   number ("Order 5 · Ana") — and would then be wanted on tickets too, which is a separate change.
4. **Only the order number changes** (Merge bills, Transfer items or Split the bill at one table, or
   a bill merged
   into the main bill of a party it joins without leaving its table). Recommended: nothing prints,
   because the food still goes to the same table. The alternative prints `Order 28 -> 27` with the
   same From and To. Today such a join prints `Mesa 74 -> Mesa 73, 74` / `25 -> 24`; under the
   recommendation it prints nothing.
5. **Held dishes already printed on a HOLD ticket** (venues that print held work in advance). When
   their guests move (Move guests, joins, splits), held groups travel whole with the bill and get no
   slip today, so the HOLD paper names the old table until the course is fired (measured: probe J1,
   Move guests). Move this bill and Split a table choosing a bill refuse a bill with a dish in a held
   group (`group.held_leaves_party`, `refuseHeldLeavingParty`, `apps/server/src/working-order.ts`;
   read, not run), so they never move one. Recommended: (a) list the held dishes on the same slip
   under `HOLD`, so the paper on the rail is right at once. (b) Leave them as today.

Wording (`MOVIDO`, `Pedido`, `De:`/`A:`, `(mostrador)`) is as drawn unless the owner says otherwise.

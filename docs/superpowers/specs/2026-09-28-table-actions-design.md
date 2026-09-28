# Tables, parties and bills: the till's table actions — design

**Status:** draft for review, revision 4 (2026-09-28). Section 4 holds the owner's decisions, made in
design sessions on 2026-09-28; everything else is this document's proposal and is open to review.
Section 13 lists the points the reviewers should look at hardest. Revision 2 folds in the first
outside review (payment identity, paid items, kitchen groups, the main bill's life, MOVED notices,
the service area of later orders) and the owner's answers to it. Revision 3 folds in the second
review: a presented bill keeps its invoice and its service area when it moves, its contents cannot
change in this build, the main bill may be absent, and paid bills do not move. Revision 4
corrects a factual slip in section 3 found by the third review, which found no further blockers.

## 1. Why

Today one till action, "Merge a bill", does two unrelated things at once: it combines two bills, and
it decides which tables the guests are sitting at (the table the merged-away bill sat on is freed).
Which tables end up free then depends on which table's screen the waiter happened to start from.
Other real situations cannot be done at all: guests from one table sitting down with a party at
another table while keeping their own bill, or two seated groups pushing their tables together.

The owner's model separates the two: **table actions** say what happened in the room, and **bill
actions** say who pays for what. Bills belong to the party, not to a table.

## 2. Words used here

- **Table** — a physical table, such as "Mesa 4".
- **Party** — a group of guests seated together. It holds one or more tables and one or more bills.
  The code calls it a *visit* today; decision 14 renames it.
- **Bill** — a list of items that is paid as one (the code calls it a *working order*, and a
  table's bill a *tab*). A bill is paid, and its invoice issued, on its own.
- **Main bill** — the party bill that new orders go to by default.
- **Presented bill** — a bill whose invoice has been issued before payment (today's *invoice-first*
  flow, where the ticket is handed over and paid afterwards; the bill's status is `placed`), or, once
  one exists, whose pre-bill has been printed. The till prints no pre-bill today (`docs/backlog.md`,
  the Q21 row).
- **Partly paid bill** — a bill that has received at least one payment and is not yet fully paid.
- **Deli order** — a bill taken at the counter, with no party and no table (a *counter order*).
- **Service area** — a part of the venue with its own service style (counter or table service) and
  its own menus, so the same dish can have a different price in each (the code calls it a *service
  zone*).
- **Kitchen group** — a set of dishes the kitchen releases and serves together (a course), which
  belongs to the party and can hold dishes from several of its bills.

## 3. How it works today

From a read of `main` at `cbd896f00` on 2026-09-28, with five server test files run
(`cd apps/server && pnpm exec vitest run src/move-merge.test.ts src/visits.test.ts
src/till-api.move-merge.test.ts src/till-api.visits.test.ts src/split-bill.test.ts`: 232 passed).
The first review also ran `visits.test.ts` and `bill-payments.test.ts` (128 passed) and a focused
kitchen-group run (10 passed). "Tested" below names a test that passed; everything else was read,
not run.

- **Tables point at bills.** Each table has one `tab_id`, the bill it shows
  (`packages/db/src/schema/dining-tables.ts:32-35`). A joined table is stored as two tables pointing at
  the same bill. A party's tables are listed in `visit_tables`, one active party per table
  (`packages/db/src/schema/visits.ts:67-92`).
- **The main bill is implicit.** Nothing stores it: `visitTab` returns the bill of the party's
  earliest-joined table (`apps/server/src/order-groups.ts:951-962`), and every new round goes there
  (`order-groups.ts:138-143`; drafts through `order-drafts.ts:296`). A new round uses the bill's
  stored service area (`apps/server/src/working-order.ts:1791`).
- **A bill no table points at is second-class** (a "check"): transfer refuses it in both directions
  (`working-order.ts:2875-2877`), it cannot be split from or take a new round (`:1783`, `:3221`), the
  till never offers it as a target (`apps/till/src/screens/till-table-order-screen.ts:2863`), and a
  kitchen slip names no table for it unless it has a label (`apps/server/src/kitchen-print.ts:268-273`).
- **Move and Join accept only a free table** (`table.occupied`, `working-order.ts:2487-2513`; tested:
  "refuses moving a party onto a table that needs clearing or belongs to another visit"). Move frees
  the old tables at once (`:2565`).
- **Merge is the only action between two parties, and it always combines the bills.** All lines move
  to the receiving bill and the other is abandoned (`working-order.ts:2747`, `:2789`). Between two
  parties the source party is absorbed: its kitchen groups and drafts move, its other open bills stay
  separate, and it closes with `merged_into_visit_id` set (`:2753-2804`; tested: "absorbs the other
  party: its open check follows, its settled bill stays, and it closes"). A merge refuses a source
  bill that already holds a payment (`bill.payments_received`, `apps/server/src/bill-payments.ts:422-432`).
- **A payment is fixed to its bill.** A database trigger freezes a payment's `working_order_id`
  (`packages/db/drizzle/0024_bill_payment_triggers.sql:22`), and a card payment retry finds the
  original request by bill and submission id (`apps/server/src/bill-payments.ts:904`).
- **The till's Merge always frees the tapped table** (`freeSourceTable: true`,
  `till-table-order-screen.ts:2903`). Since A111 (#804), inside one party that also takes the table out
  of the party, and a merge that would leave the party with no table is refused
  (`tab.merge_leaves_no_table`, `working-order.ts:2740-2743`; tested).
- **Transfer moves chosen items between two bills** that both have a table and the same service style
  (`working-order.ts:2875-2879`; `service_zone.mode_incompatible`, `:2198-2217`). Items already paid for
  are refused (`bill.line_paid`, `:3019-3027`). Dishes still held for the kitchen cannot leave their
  party (`group.held_leaves_visit`, `:3011-3017`, `:3118`); dishes already sent leave their kitchen
  group when they change party (`:3108-3113`).
- **Split puts chosen items on a new bill in the same party**, but only from a bill with a table
  (`splitOffCheck`, `working-order.ts:3206-3241`).
- **Unjoin** (take a table out of a party) exists on the server only, with no till button
  (`POST /api/tabs/:id/unjoin`, `working-order.ts:3248-3325`); with items it starts a new party.
- **An unpaid split bill is merged back automatically** when the waiter leaves it
  (`#returnSplitCheck` / `#mergeCheckBack`, `apps/till/src/till-app.ts:3458-3503`; the owner's
  ruling of 2026-09-26, "M7b3").
- **Paying and finishing already work per bill across a party.** `readVisitBills` lists every bill of
  the party and of any party merged into it (`apps/server/src/visits.ts:277-349`); Finish is refused
  while any of them is unpaid (`visit.bill_outstanding`, `visits.ts:373-416`; tested); a bill's invoice
  is issued when it is fully paid (`issueIfFullyPaid`, `bill-payments.ts:700-717`) or, in the
  invoice-first flow, before payment (`apps/server/src/till-sale.ts:207`, `:703-756`).
- **"Pay, then order dessert"** is settled by the service design: the new charge goes on a new bill of
  the same party with its own invoice (`docs/superpowers/specs/2026-09-20-service-ordering-and-billing-design.md:387-390`).
- **Nothing reopens a presented bill.** Fiscal voids and corrections (`packages/core/src/record-void.ts`,
  `packages/core/src/record-correction.ts`) record against the original invoice but do not reopen the
  original bill, and the bill status trigger refuses `placed → open`
  (`packages/db/drizzle/0001_behavioural_triggers.sql`, around line 318; the second review ran its
  eight transition-guard tests).
- **Collecting a bill picks its path from the service mode**: in invoice-first mode it settles the
  invoice already issued, otherwise it issues a sale (`collectOrder`, `apps/server/src/till-sale.ts:1504-1512`).

## 4. The owner's decisions (2026-09-28)

1. **Table actions and bill actions are separate.** Step 1 is a table action (join tables, or move
   guests to another table, including one that already has a party). Step 2 is a bill choice: merge
   the bills (**the default**) or keep them as separate bills in the one party.
2. **Bills belong to the party**, not to a table.
3. **A party has an optional name** ("Ana"). Without one it is named after its tables, for example
   "Mesa 4, 5, 7". A party split off onto a new table is named after that table.
4. **Merging bills works only inside one party.** Combining two parties is a table action.
5. **Only an untouched bill merges.** A bill that has been presented to the table for payment, or
   has received any payment, can no longer be merged with another bill, but it can still move, whole,
   to another party. A paid bill is done: it neither merges nor moves. (This replaces revision 1's
   "a partly paid bill can merge, taking its payments".)
6. **A table the guests have left needs cleaning before it is free.**
7. **After tables are joined, new orders go to the main bill by default**; the waiter can send them
   to another bill of the party.
8. **Two bills in one party** must each be paid, or be merged back before payment starts. There is
   no automatic putting-back.
9. **Kitchen slips name the party's tables together** ("Mesa 4 + 7"). Joined tables are in effect one
   big table; runners work out which.
10. **Splitting a table** becomes a till action and starts a new party. The bill is split first if
    needed; splitting the table then only chooses which bill goes with the new party.
11. **Items reach another party, or the deli, by splitting them onto a new bill and moving that
    bill**, not by moving single items across parties. (The owner may later add one-step shortcuts.)
12. **An item moved between the deli and a table keeps the price and VAT class it was ordered at.**
13. **Tables will later have a "reserved for a time" state** (reservations are a later project); the
    model must leave room for it.
14. **"Visit" is renamed "party"** in the code: the tables, the code names and the `visit.*` error
    codes.
15. **An open party has one main bill, or none until its next order.** If the main bill is paid,
    presented or moved away, the party's next order starts a new, empty main bill ("pay, then order
    dessert"). When parties combine and the receiving party's main bill can no longer take orders,
    the incoming main bill becomes the main bill instead of being merged, if it can take orders
    itself. (Wording revised in revision 3 so that "none until the next order" is stated; the owner
    approved the substance.)

## 5. The model

- **Party** (`visits`, renamed `parties` by decision 14) gains:
  - `name` — optional text set by staff.
  - `main_bill_id` — the party's main bill, replacing the "earliest-joined table's bill" rule.
    When set, it names an open bill that can take new orders: not presented, not paid (decision 15).
    It is empty when no bill of the party can take orders; the next order then creates a new main
    bill and sets it.
  - Its display name is `name`, or else its tables' names joined (proposal: tables sharing a first
    word are shortened — "Mesa 4, 5, 7"; otherwise listed in full — "Mesa 4, Terraza 2"), in the
    order they joined.
  - Kept: `merged_into_visit_id` and the "family" reading (`visitFamily`), so a combined party still
    lists the bills that were paid before the parties combined.
- **Table** (`dining_tables`) loses `tab_id`. A table is **free**, **held by a party** (an active
  membership row), or **needs cleaning**. "Needs cleaning" moves from the party (today's
  `needs_clearing` party state) to the table, because under decision 6 one table of a party can need
  cleaning while the party sits on elsewhere. The table state is written so that a later "reserved"
  state fits beside these three.
- **Bill** (`working_orders`) belongs to a party through its existing `visit_id`, or to none (a deli
  order). Nothing about a bill says which table it is on. A bill keeps its identity (its id) for its
  whole life, whichever party it moves to, so its payments, card retries, refunds and invoice never
  change hands. When a party has more than one open bill, the till shows them under the party's
  display name, numbered: "Ana · Bill 1", "Ana · Bill 2", and so on.
- Before go-live the schema changes drop and recreate, per `CLAUDE.md` §3; no data migration code.

## 6. Table actions

Every table action below runs in one transaction and checks the revision of every party it touches
(the service plan's decision D19), so two tills cannot act on the same party at once.

- **Seat** — as today: a new party, its main bill, and the table.
- **Move guests** — the party moves off ALL its tables to the chosen table. (To move only the guests
  at one of a party's tables, split that table off first.) The tables left behind need cleaning.
  - To a **free** table: the table joins the party.
  - To a table **held by another party**: the moving party is combined into that party. Its drafts
    and its kitchen groups move, as in today's two-party merge; its bills move across as separate
    bills; it closes, recorded as merged. The receiving party keeps its name and main bill. Then the
    bill choice (below).
  - To a table that **needs cleaning**: refused.
- **Join tables** — the chosen table is added to this party; both tables stay.
  - A **free** table: it joins the party.
  - A table **held by another party**: that party is combined into this one, as for Move guests, and
    all its tables stay with this party. Then the bill choice.
  - Tables in different service areas: refused, as today (`service_zone.join_mismatch`).
- **The bill choice after combining parties** — by default the incoming party's main bill is merged
  into the receiving party's main bill; the waiter can keep it separate. The merge happens only when
  both main bills are untouched (decision 5); otherwise they stay separate. The receiving party's main
  bill stays main if it can take orders; if not, the incoming main bill becomes main if IT can take
  orders; if neither can, the party has no main bill until its next order (decision 15). The incoming
  party's other open bills move across and stay separate; its paid bills stay recorded on the
  absorbed party and count through the family, as today.
- **Split a table** (today's unjoin, now on the till) — the table leaves the party and a new party
  starts on it, named after the table. The waiter chooses one of the party's open bills to go with
  the new party, other than the main bill; if they choose none, the new party starts with an empty
  main bill. Refused when it is the party's only table. To send only some items, the waiter splits
  the bill first (section 7). Kitchen groups follow the rule for Move a bill (section 7).
- **Finish** and **Cleared** — as today: Finish is refused while any of the party's bills is unpaid;
  afterwards the party's tables need cleaning, and Cleared makes each free.

## 7. Bill actions

- **Split a bill** — chosen items go onto a new bill in the same party. It no longer needs the bill
  to have a table. Items already paid for stay where they are. A presented bill cannot be split: its
  invoice is issued, and no workflow in this build reopens it (section 9).
- **Merge bills** — inside one party only, and only between two untouched bills: neither may be
  presented, partly paid or paid (decision 5). Every item moves to the bill merged into; the other bill
  is abandoned and files nothing, as today. No payment ever moves. If the merged-away bill was the main
  bill, the surviving bill becomes the main bill. Merge never frees, adds or removes a table.
- **Move a bill** — a whole open bill, including a presented or partly paid one, moves:
  - to **another party** (typically after Split a table, or to seat deli guests at a table);
  - to **the deli**, becoming a deli order with no party (a table item paid at the counter);
  - **from the deli into a party** ("I'll pay it with my meal"), where the receiving party then makes
    the bill choice, merge (default, only if both bills are untouched) or keep separate.
  The bill keeps its id, so its payments, a pending card payment's retry, refunds and its invoice are
  untouched by the move. A paid bill does not move (decision 5). A party's main bill cannot move away while the
  party holds other open bills (proposal; section 13); when it moves, decision 15 applies.
- **Kitchen groups when a bill leaves its party** (Move a bill, Split a table) — today's rule stays:
  a bill holding dishes that are still held for the kitchen cannot leave the party (refused, as
  `group.held_leaves_visit` is today); dishes already sent leave their kitchen group and keep their
  preparation and service state. Combining two parties keeps whole kitchen groups, as today.
- **Service area of a moved bill** — an unpresented bill takes the receiving side's service area
  (the party's, or the deli's) for everything added to it afterwards: menu, prices, preparation
  routing and service mode. A **presented** bill keeps its own service area when it moves: it takes no
  new orders, and its collection must settle the invoice it already has (section 9). Items already on it keep the price and VAT class they were ordered at (decision 12), so a move
  between a counter area and a table area is allowed (today refused as `service_zone.mode_incompatible`).
- **Transfer items** between two existing bills: kept **inside one party only** (proposal; it is a
  split followed by a merge in one step), between untouched bills only, like Merge. Across parties
  and to the deli, items go by Split a bill then Move a bill (decision 11).
- **Paid items** never move on their own (split or transfer), as today. They move only as part of a
  whole bill that moves; since only untouched bills merge, a merge never carries a paid item.
- **New orders** go to the main bill; the waiter can pick another open, unpresented bill of the party.
- **No automatic putting-back.** An unpaid split bill stays listed until it is paid or merged back.

## 8. Kitchen, pass and receipts

- Kitchen slips and the pass name the party's tables together (the owner's example: "Mesa 4 + 7";
  the exact form is the plan's to choose, ideally the same as the party's default name), read from
  the party, not from a table-to-bill pointer. A deli order delivered to a table keeps using its
  existing `delivery_table_id`.
- **MOVED notices** go out for sent dishes whose destination changes, whatever caused it: a table
  action that changes a party's tables, a bill moving to another party, a bill moving to or from the
  deli, and a deli order's delivery table changing. Only the dishes whose destination changed get a
  notice (today's `enqueueMovedSlips`).
- Kitchen print failures follow the dishes that moved: lane C's C31 (record which dishes each ticket
  carried) applies to split, merge, transfer and move of a bill.
- Receipts show the party's display name and tables.

## 9. Money and fiscal points

This touches money and fiscal records, so the build takes the full review path.

- **No payment ever moves between bills.** A merge is refused for any bill that is presented, partly
  paid or paid (decision 5), and a moved bill keeps its id (section 5), so a payment's frozen bill id,
  its card retries (found by bill and submission id) and its refunds stay valid.
- **A presented bill's contents do not change in this build.** It cannot be merged, split, have
  items transferred or take new orders. Nothing in the code reopens a presented bill today (section
  3): a fiscal void or rectificativa records a correction but does not make the original bill
  editable. A correction-and-replacement flow is out of scope (section 14). Moving a presented bill
  whole to another party changes no fiscal content.
- **Collection follows the bill's issuance history, not its current area.** A bill whose invoice was
  issued before payment is collected by settling that invoice, whichever party or area it has moved
  to: one invoice, one sale, one fiscal record. Keeping a presented bill's own service area on a move
  (section 7) keeps today's `collectOrder` choice correct; the plan must also make collection check
  for an already-issued invoice rather than rely on the mode alone.
- **Items keep their price and VAT class** when moved, split, merged or transferred. Since A68 (#726) a
  line keeps its VAT class and the invoice takes the rate of the day it is issued, so a deli item paid
  on a table bill is taxed by its own class.
- The golden fiscal tests (the huella test and `inmutabilidad`) must pass unedited.

## 10. Refusals and codes

Error codes may be renamed or deleted freely before go-live (`CLAUDE.md` §3); decision 14 renames the
`visit.*` codes to `party.*`. The plan lists every code that goes and every new one; at least:

- **Go:** `tab.merge_leaves_no_table`, `tab.visit_has_other_open_bill`, `tab.not_table_tab`,
  `table.occupied` on move and join, and `service_zone.mode_incompatible` on moving a bill.
- **Stay:** `bill.payments_received` (now for either side of a merge), `bill.line_paid`,
  `service_zone.join_mismatch`, and the held-dishes refusal (renamed with decision 14).
- **New, named by the plan:** merging bills of two parties; merging, splitting or transferring from a
  presented bill; merging a paid bill; moving a paid bill; moving a party's main bill away while it
  holds others; moving guests to a table that needs cleaning; splitting a party's only table.

## 11. What changes for work already landed

- **A111 (#804):** "Merge a bill" no longer frees or removes tables, so A111's rule and refusal go.
  The situations it served are now Move guests and Split a table.
- **M7b3** (the automatic merge-back of an unpaid split bill) goes.
- **Cross-party transfer and cross-party merge** go.
- The till's `freeSourceTable` option and every check built on "a bill with a table" versus "a check"
  go with `dining_tables.tab_id`.

## 12. Build order, and queued and planned work on the same code

- **First, the rename (decision 14)** as its own mechanical change: `visits` → `parties`,
  `visit_tables` → `party_tables`, the code names, and the `visit.*` error codes → `party.*`, with
  every copy moving in the same change (`CLAUDE.md` §3). No behaviour changes.
- **Then this design.**
- **Held until this spec is approved** (lane A): **A81** (move a deli order to a table) and **A82**
  (move a table's bill to the deli) become this spec's Move a bill; **A96** (dishes moved or merged
  into a party's bill get a kitchen group) is re-scoped to these actions. Proposal: A81 and A82 are
  folded into this build and retired.
- **Lane C's C31** (print failures per dish, a migration) is independent; whichever lands second
  rebases.
- **The service plan's remaining tasks** (`docs/superpowers/plans/2026-09-26-service-ordering-and-billing.md`)
  change the same code: B9 (served paths, the table list), B10 (the dashboard's signals over the party
  family), B11 (line splits for cancellations and discounts), B15 (the till's refusal to merge a bill
  holding money), B17 (unpaid departure). Proposal: the rename and this design are built after B9
  lands and before B10, so the later tasks build on the new model. B15's merge refusal is kept by
  decision 5 and widens to presented bills.

## 13. Points for reviewers

Section 4 is decided. These are this document's own proposals, and where a reviewer's view would
change the design most:

1. **Move guests moves the whole party**; moving only one table's guests is Split a table, then Move.
2. **"Needs cleaning" moves from the party to the table.**
3. **The default name** joins the tables' names with a shared first word shortened ("Mesa 4, 5, 7").
4. **When parties combine**, only the incoming main bill is merged by default; the incoming party's
   other bills stay separate.
5. **Split a table cannot take the main bill**, and a main bill cannot be moved away while its party
   holds other open bills.
6. **Transfer items stays**, inside one party and between untouched bills only.
7. **Moving a deli order into a party defaults to merging it** into the main bill (when both are
   untouched).
8. **Kitchen slips show only the tables**, not the party's name.
9. **An unpresented moved bill takes the receiving side's service area** for later additions; a
   presented one keeps its own.
10. **Build order:** the rename, then this design, after B9 and before B10.

## 14. Out of scope

- Reservations (decision 13 only asks that the table state leaves room).
- One-step shortcuts, such as moving chosen items straight to another party.
- Changing a presented bill's contents at all: a correction-and-replacement flow (void or rectify
  the issued invoice, then carry the items to a new bill) is a separate project.
- A printed pre-bill (it would count as presenting a bill once it exists).
- Recording which guest ordered which item (the owner's "later" item of 2026-09-20).

## 15. Testing

- For every action: a server test that reads back the tables, the party memberships, the parties
  (name, main bill, merged-into) and the bills (items, payments, status, service area) afterwards, not
  only the response.
- Every refusal asserts its own code, including each side of a merge being presented, partly paid or
  paid.
- Two tills acting on the same party at once: one succeeds, the other is refused by the revision
  check.
- Money: a partly paid bill moved to another party keeps its payments; a card payment retry after the
  move finds its original request, and a refund of an earlier payment runs, both through the same bill.
  One case uses a payment made for one specific item, not only a payment towards the total.
- The main bill: after paying the main bill, the next order starts a new main bill; after moving the
  main bill away, likewise; when a party whose main bill is presented absorbs another, the incoming
  main bill becomes main; when both parties' main bills are paid or presented, the combined party has
  no main bill and its next order creates one.
- A presented (invoice-first) bill moved to a party in a different service area and then paid:
  the same invoice is settled, with one sale and one fiscal record.
- A paid bill is refused by Move a bill, and stays on its original party when parties combine.
- Kitchen groups: a bill holding held dishes cannot leave its party; a bill whose dishes were sent
  leaves with them outside any group, keeping their preparation and service state.
- MOVED notices: after a bill move, a deli move and a table action, only the dishes whose destination
  changed get a notice.
- Service area: a deli bill moved into a table party keeps its existing item's price and VAT class,
  and a new item on it is priced from the table area's menu, with a fixture where the two areas price
  the dish differently.
- The till: each action opened and looked at in English and Spanish, light and dark, at 1280 and
  390 pixels wide.

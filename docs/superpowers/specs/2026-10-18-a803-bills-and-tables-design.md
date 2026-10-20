# A803: Bills and tables — one portion per line, one bill switcher, one picker

> **2026-10-20 A802 update:** the [partial paid-invoice correction proposal](2026-10-20-a802-partial-paid-invoice-correction-design.md)
> is ready for owner review. References below to A802 as still queued describe the earlier state.
> Its new policies are proposals; they do not amend this approved design before owner approval.

**Status: owner-approved design, 2026-10-18 (including section 6's calls). Nothing here is
built. Sequenced straight after A773-1 (owner, 2026-10-18); the plan is written when A773-1 lands.**

Mockups: [`docs/backlog/mockups/a803-bills-and-tables/`](../../backlog/mockups/a803-bills-and-tables/)
(boards 01–07 map today's behaviour and the gaps; 08–13 are the proposals).

## 1. Why

A big table is where the till is hardest to use today. Staff split bills, move dishes, join and
split tables and take part payments, and each of those has its own screen, its own words and its
own refusals:

- "Split the bill" means two different things that produce different paper: **Split by item** makes
  a new bill with its own invoice, while **Pay items** takes a part payment on one bill
  (board 05).
- A dish sent as "2 × Hamburguesa + queso" cannot have one burger moved: splitting a bill,
  transferring items and moving part of a dish to another group refuse it
  (`tab.transfer_modifier_line`, thrown in `carveLines`, `apps/server/src/working-order.ts`; the
  till says "Dishes with options must be moved in full").
- A table can split off with one whole bill or none, never two of three, and never a few dishes
  (board 03).
- Every bill and table action sits behind a **Tab** button whose side panel mixes bill actions,
  table actions, Pay and the list of bills; nothing on screen says which bill you are on, or that
  others exist (board 11).
- The "main bill" decides where new dishes and merges go, and nothing on screen shows it.

The owner's aim: the same few ideas everywhere, so staff learn them once, and the awkward cases at
a big table just work.

## 2. Today, briefly

Read from the code on 2026-10-17, not run:

- A table holds one **party** (`parties`, `party_tables`); a party holds any number of **bills**
  (`working_orders.party_id`); one is the main bill (`parties.main_bill_id`).
- One bill gets at most one simplified invoice, numbered only when the bill is fully paid
  (`sales.working_order_id` unique; `issueIfFullyPaid`, `apps/server/src/bill-payments.ts`).
- Part payments (`bill_payments.kind`: items, contribution, share) are money against one bill.
- Split by item, Transfer items, Merge bills and Move this bill live in
  `apps/server/src/bill-actions.ts` and `move-bill.ts`; join, move guests and split a table in
  `apps/server/src/table-actions.ts`.
- Quantity columns that a "part of a line" touches: `working_order_lines.quantity`,
  `.price_quantity`, `.served_quantity`; `ticket_items.quantity`; `bill_payment_lines.quantity`;
  the sale lines' `quantity` in `packages/db/src/schema/sales.ts`; order draft lines; the
  adjustments' `line_quantity` and `quantity`; `kitchen_notices.quantity`.
- The unsent order's **Split quantity** already turns "2 × X" into two lines of one before sending
  (`splitLine`, `apps/till/src/state/working-order.ts`).

## 3. What the owner decided

### 3.1 One portion per order line

- Every order line holds **one portion of one dish**, with that portion's own extras. "2 ×
  Hamburguesa" is two lines. "Burger with chips" and "burger with double chips" are two different
  lines, so the kitchen and the bill both know which is which.
- **Anything sold by the unit is one line per unit**: "12 × ostras" priced per piece is twelve
  lines, grouped on screen. A product that is itself a dozen ("Docena de ostras") is one portion.
- **A weighed item is one portion.** "100 g jamón" ordered twice is two lines; "200 g jamón"
  ordered once is one line and is never cut. Two guests sharing it each pay part of it as an amount
  (Contribute today, An amount in A739's Pay window), not by splitting the line.
- **"2 ×" is display only.** Screens, kitchen tickets and receipts group identical portions into
  one row. Portions that differ in extras, note, course, kitchen state or price show separately.
- Moving one of two sent burgers with extras **just works**: the portion moves with its own extras.
  The `tab.transfer_modifier_line` refusal for a partial move goes, because there is no partial
  move left.
- An extra row keeps its own count **per portion** (two limes on one drink stays "+ Lime × 2" under
  that one drink).

### 3.2 Kitchen tickets

- Each preparation station gets a setting with three choices: **grouped** ("2 × Hamburguesa"),
  **one line per portion** on one ticket, or **one ticket per portion**.
- On a grouped ticket, identical portions group **across bills** and list the bills' names:
  "2 × Solomillo (Clint, Ana)" (owner, 2026-10-18).

### 3.3 Named bills

- A bill can carry an optional name typed by the waiter: "Bill 2 · Clint".
- The name shows on the till, **on kitchen tickets and on the pass**, so identical plates on
  different bills reach the right person.

### 3.4 No main bill

- The owner found the main bill invisible. It goes: a table's bills are Bill 1, Bill 2… and all
  equal. A773 already removes its one visible role (new dishes go on the bill on screen; the "Send
  to" choice and the "New orders" tag go).
- **Joining two seated tables keeps every bill separate.** The "Merge the bills / Keep separate
  bills" question goes; staff merge afterwards if wanted.

### 3.5 The table screen: one bill switcher, two menus, no Tab button

- The **Tab** button and its side panel go.
- **Every device shows the same switcher**, "Bill 1 of 3 · €67.00 ▾", listing each bill with what
  it owes (or Paid ✓), its name, who is editing it (A773) and **+ New bill** (owner, 2026-10-18:
  one layout everywhere, so staff learn one; board 12 B). A table with one bill shows no switcher.
- The panel's foot: this bill's total, the table's remaining total beneath it, Hold · Pay (A739).
- **Bill ⋯** (the bill on screen): Move dishes…, Merge into…, Move to another table, Full invoice,
  Refund (board 13).
- **Table ⋯** (the whole table): Guests, Bill requested, Split a table, Join a table, Move guests,
  Finish table (board 13).

### 3.6 One picker for moving dishes

- **Move dishes…** replaces both Split by item and Transfer items: tick dishes **from the bill on
  screen** (identical ones as one row with a "2 of 4" count), then send them to another bill of the
  table or to a new bill. Split a table is the one that lists every bill.
- **Split a table** uses the same picker (3.7), so staff learn it once.
- Dishes still move only **between bills of the same party**; to reach another table, move the bill
  or split the table.

### 3.7 Split a table in one step

Boards 08–10.

- Table ⋯ → Split a table → the table leaving. The picker lists every bill and every dish. Ticking
  a bill takes all of it; unticking one of its dishes turns it back into single dishes.
- **Any bill can go and any can stay.** Loose dishes picked off a bill that stays go on **a new
  bill** at the leaving table (owner: "they can always be merged later"); there is no choice.
- **A dish waiting for its course can go.** The leaving table gets its own copy of that course,
  still waiting, and fires it separately. (Today a bill holding held dishes cannot leave its party;
  the block is the table-wide held group, `docs/superpowers/specs/2026-09-28-table-actions-design.md`
  around line 380.) The kitchen gets a MOVED notice for the dishes that changed table only.
- Guest counts for both tables are set in the same window.
- The four awkward cases (owner, 2026-10-18, "Yes"):
  1. **A part-paid bill** can go whole, payments and all. Its paid portions cannot be picked off on
     their own; its unpaid ones can.
  2. **Someone else has unsent dishes on a bill** (A773): take that bill over first, as A773 does
     for joins and moves.
  3. **Everything ticked:** offer **Move guests** instead; "Split anyway" leaves the staying table
     an empty bill.
  4. **Nothing ticked:** the leaving table starts with an empty bill.
- Both tables keep the party's allergy answer (A669's decision). Bill numbers: section 6.

### 3.8 Paying and merging

- **One payment pays one bill.** Separate bills mean separate payments and separate receipts; a
  guest paying for two bills has them merged first (owner, 2026-10-18).
- **A part-paid bill cannot be merged** (owner). Its **unpaid** dishes can be moved to another bill,
  existing or new. Today Transfer refuses any bill with a payment (`requireUntouchedPair`,
  `apps/server/src/bill-actions.ts`) while Split allows it; Move dishes… must allow unpaid dishes
  out of a part-paid bill into an existing bill too.

### 3.9 "La cuenta": the pre-bill

Subject to the asesor (S2, `docs/compliance/asesor-questions.md`); backlog A446 holds the storage
rule.

- **B with A always possible:** a printed pre-bill (items and total, no invoice number, no tax QR
  code), or nothing printed. The real invoice prints at payment.
- Every printed pre-bill is stored exactly as printed, recording **which portions** it listed.
  Later moves and splits never touch it; they are recorded against the portions. Because a portion
  keeps one identity for life (3.1), a pre-bill links to every invoice its portions ended on, and an
  invoice to every pre-bill that showed any of its portions.
- A bill changed since its last pre-bill shows **"Pre-bill printed 21:40 · changed since"** with
  **Reprint**. Nothing blocks payment (owner).
- Correcting a paid receipt afterwards must be easy (owner): that is A802, ready to queue.

### 3.10 Wording

- "Give back" becomes **"Refund"** throughout the till (`bill_refund.*`, `bill.refund_excess` in
  `apps/till/src/i18n/strings.ts`); check the Spanish strings.

## 4. Goals, non-goals, anti-goals

**Goals.** Any mix of bills and single portions can split off with a table in one step, and any
mix of the bill on screen's portions can move to another bill in one step; staff see
which bill they are on and what each owes; the same picker and the same switcher everywhere; a
dish's trail from order to invoice is never lost.

**Non-goals.**

- One payment across several bills, or picking dishes from several bills in one payment (owner:
  merge or move first).
- Recording which seat or guest had which dish beyond the bill's name (owner, 2026-09-20: later,
  including shared dishes).
- Guests seeing or paying the bill on their own phone (A508), paying at the table from a handheld
  (A796), tips (A793), the corrective invoice itself (A802).

**Anti-goals.** Anything that changes an issued invoice's amounts or numbers; a move that loses a
portion's identity; two layouts for the same job on different devices; a refusal for an awkward
but legitimate move that the old partial-line code needed and the new model does not.

## 5. Constraints

- **Fiscal invariants stay as they are:** one invoice per bill, numbered when the bill is fully
  paid; pre-production data may be reset, so no data migration is written (CLAUDE.md §3, "No
  backwards-compatibility or data-migration code until Waitron is in production").
- **A773 lands first.** A773-1 rewrites the same order lines; one-editor-per-bill rules (Take over,
  `bill.unsent_dishes`) apply to every move, merge and split here. A773's "Mark served" with
  "− n +" for part of a line becomes picking n portions.
- **Pending with the asesor, S2:** whether a pre-bill is a "factura simplificada proforma" (3.9),
  and whether a mid-meal part payment is an advance payment needing its own invoice (research
  `docs/compliance/research/2026-10-09-invoice-timing.md`, finding 2). If the latter is yes, "part
  payments make one invoice" changes; that is outside this design and would be its own item.
- Designs this must stay consistent with: A757 (a joined table shows its tables' highest state),
  A669 (allergy answers on join and split), A504 (floor plan sets), A739 (one Pay window), A666
  (seats asked before a floor join).

## 6. Claude's calls (not owner decisions; the owner may overrule)

- Moving a **whole bill** with waiting dishes to another table uses the same own-copy-of-the-course
  fix as 3.7.
- Moving a bill to a table with guests: the bill arrives as a separate bill, with no "merge into
  their main bill" question (follows 3.4).
- An unnamed bill adds nothing to a kitchen ticket. A grouped row mixing named and unnamed bills is
  the builder's to word.
- A bill renamed, or a dish moved to another bill, after its ticket printed: the pass screen shows
  the new name; no ticket reprints.
- With Split by item gone, "split" appears only in Split a table and the Pay window's Split
  equally, which ends the board 05 confusion.
- Each recorded join, split and move-bill defect in `docs/backlog.md` (A563–A604 and their
  neighbours) is checked against this design: an entry the redesign removes is deleted, the rest
  stay.

- **Bill numbers are stored and stable.** A bill keeps its number while it stays at its table; a
  number is never reused at that table, so a merged-away Bill 2 leaves Bill 1 and Bill 3; a bill
  arriving at a table (move, split, join) takes that table's next number. Today the number is
  worked out from position on each screen (`table.bill_of`), so it shifts when a bill goes. Board
  09's "was Bill 2" label is dropped; the bill's name (3.3) is what follows a guest.
- **A bill with money paid by amount** (Contribute, Split equally) has no dish marked paid. Its
  dishes may move out only while what stays on the bill is at least the money it has received —
  today's server rule (`bill.received_exceeds_total`). The picker greys out a tick that would break
  it and says why ("€40 is already paid on this bill"), instead of refusing after Move.
- **When one kitchen ticket holds several bills' dishes.** Today a kitchen print job belongs to one
  bill (`kitchen_print_jobs.working_order_id`). A single action that sends dishes from several
  bills to a station — firing a course held for the whole table — prints **one** ticket per
  station, grouped across bills with the names (3.2). Separate sends from separate bills are never
  batched into one ticket. A kitchen screen groups the same way as the paper.
- **Slices touching the pass and the station settings wait for A773-2**, whose spec rebuilds both;
  the storage, named-bill, switcher and picker slices follow A773-1 as the owner set.

## 7. Left to the builder

- Which identical portions a "2 of 4" count picks (for example unsent before sent, least
  progressed first).
- Whether sale lines are stored per portion or grouped, provided the printed receipt groups and
  the totals are unchanged.
- How per-portion discounts round, provided the receipt still adds up; check against how the
  receipt totals today.
- Whether a bill's name prints on the pre-bill or the receipt.
- The slicing. A natural order: (1) one portion per line, including tickets and the station
  setting; (2) named bills; (3) the switcher, the two menus and removing the main bill; (4) the
  shared picker for Move dishes and Split a table, including waiting courses; (5) the Refund
  wording, which can go any time; (6) the pre-bill, once the asesor answers S2.

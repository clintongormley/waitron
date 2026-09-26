# Service, ordering and billing workflows

**Status:** Revision 2, 2026-09-26, **approved by the owner** the same day. Revision 1 (2026-09-20)
recorded the product decisions from the workflow discussion. This revision folds in:

- the owner's decisions of 2026-09-26;
- a review of this spec against the code on `main` at `17dd4b147` and lane C's unlanded
  order-editing branch (`feat/menus-order-edits` at `1996d4ce7`), by reading, not running;
- what the [menus design](2026-09-20-menus-categories-and-home-layouts-design.md) §10–§11 has since
  decided, which this spec now follows.

The planning session proposed several rules to close gaps the review found; the owner accepted them
on 2026-09-26, and changed three (who an item is credited to, §2; discounts on weighed items, §7;
and whose sales an adjustment rate is measured against, §7). Every such rule is marked **Owner, 2026-09-26**. §14 lists every change from Revision 1.
Revision 1's text is in git history.

You should be able to take orders quickly, see what needs attention, control when food reaches the
kitchen, and collect payments without losing track of the table. The same service model must work
on a handheld or till, with a kitchen using paper, screens, or both.

This is intended behaviour, not a description of verified application features. It builds on the
order, kitchen and menu rules the menus work (lane C) is landing — saved-order editing, kitchen
notices, the recorded "sent" mark, selling from the published menu, and the till's home page — so
most of it is built after those land. The
[implementation plan](../plans/2026-09-26-service-ordering-and-billing.md) orders the work and names
each dependency. Inventory, guest cloud access and the other later features below are not
prerequisites for the staff workflow.

This spec complements the [menu, category and home-layout design](2026-09-20-menus-categories-and-home-layouts-design.md).
It replaces the earlier ideas of permanent named course buckets, automatic matching of later
additions to those names, and a special initial-meal-ordering phase.

**Terms.**

- A **visit** is one seated party, from seating until the table is finished. A party at joined
  tables is one visit across all of them. It holds
  the party's tab, every bill split from it, anything ordered after a payment, and the sequence of
  groups sent to the kitchen. **Owner, 2026-09-26:** the visit is a record of its own; it is the
  one new entity this spec chooses.
- A **tab** holds the visit's shared orders.
- A **bill** is a collection of charges you can pay separately.
- An **invoice** is an issued fiscal document.
- A **group** is a set of submitted items meant to reach the kitchen together, identified by its
  position in the visit's sequence and its contents, never by a name.
- A **draft** is one staff member's unsent items.

Splitting bills must not fragment the kitchen's view of the visit.

## 1. Start with the service dashboard

For table service, you start on a floor plan or flat table list. For counter service, you can start
on a flat list of tabs, including tabs without a table, identified by a name or order number.

The dashboard distinguishes unoccupied tables from occupied ones and highlights work needing
attention. Several signals can coexist on one table; payment and kitchen progress are not one
mutually exclusive status. **Owner, 2026-09-26:** the signals are:

- take an order (seated, nothing ordered or drafted yet);
- an unsent draft, naming whose;
- food or drinks ready to deliver, per station;
- a long wait, using the station's configured waiting bands;
- a held group due for release (§4);
- a held item that has become unavailable (§10);
- bill requested — a fact on the visit, set by a Bill requested action and cleared when every bill
  is paid, not one of the venue's manual table statuses;
- needs clearing (§8).

Exact priority, thresholds and landing-view configuration remain interaction-design work. The
venue's own manual table statuses stay alongside these.

Stations appear here too. The bar can show drinks waiting for Tables 2 and 8, while those tables
also show the corresponding readiness. Open the station to see the actual items and destinations.
These are two views of the same work, not separate notifications to clear independently.

Tap an occupied table to open its tab on **Ordering**, with **Current orders** as a second view.
Tap an empty table to seat guests: this opens a visit, records the guest count (optional) and opens
a tab. Joining a table to a seated party adds it to that party's visit; moving the party moves the
visit; unjoining a table that takes some items with it starts a separate visit there. A table
belongs to at most one open visit at a time, whether it was the first table seated or one joined
later. All bills split from the visit remain attached to it. You can see each bill's paid and
outstanding amounts, the table's total outstanding balance, and settled bills when you need their
receipts. **Paying does not free the table** (§8).

Staff-to-table assignments are deferred. The dashboard must be usable without them.

## 2. Take an order without submitting it accidentally

The ordering home is the till's home page from the menus work: the published menu's search,
shortcut grid and section structure. A plain product tap adds one unit to your unsent draft. Three
taps on Beer produce Beer ×3. An item with extras or options opens its customisation screen first;
confirming adds the configured item.

**Combining identical items. Owner, 2026-09-26:** within the same draft group, two lines combine
(quantities add) when they have the same product and variant, the same set of option values
(compared as values, never by the order you picked them), the same extras (each counted as which
product, from which extras list), and the same note. Anything different stays separate. A draft
line never combines with work already submitted, even if the dish is identical.

The last-added item stays visible at the bottom, with its distinguishing selections and +1/−1
controls. On a handheld, open a separate **Review** screen for the whole draft; do not squeeze a
full basket beside browsing. Returning preserves the draft and browsing position. A wider till
can show browsing and the draft together.

Use **Split quantity** to turn Burger ×3 into three individual rows before moving one elsewhere.
Rows you split stay separate; do not regroup them and undo the separation you just requested.

**Prices in a draft. Owner, 2026-09-26:** a draft is priced like an unsaved basket in the menus design
(§11.2 there). It follows the live published menu until it is submitted, and staff confirm any
price change the till shows. Its prices lock at submission, when its items join the tab; from then
on the menus design's saved-order rules apply (a line keeps the price it was given; an edit prices
only what it adds).

### Separate drafts, shared submitted orders

Each waiter has their own draft, so one can take drinks while another takes food. **Owner, 2026-09-26:** a
draft belongs to the signed-in operator (the till's PIN lock screen identifies who that is) and to
the visit, not the tab, so it survives "pay, then order dessert" opening a new tab. A person has at
most one open draft per visit. Drafts are saved on the server, so leaving the ordering screen, a
reload or a change of device retains them, and the table shows an unsent-items indication. Other
staff can see "Alex has an unsent order" and open its contents.

To edit or submit another waiter's draft, explicitly **Take over draft**. Ownership transfers;
Alex sees who took over and can no longer edit or submit that draft. Concurrent takeover or a stale
screen must not allow the same draft to be submitted twice, and a retried submission (a lost reply)
must not submit it twice either.

**Who an item is credited to. Owner, 2026-09-26:** every item in a draft is credited to whoever owns
the draft when it is submitted, and only the owner can submit. A takeover therefore moves the credit
for everything in the draft to the new owner; the history records the takeover (who took it from
whom, and when), not a separate author per item. This credit is what the adjustment reports count
as a person's sales (§7). Work added outside a draft — the till's Change action, a counter sale — is
credited to the person who made it.

The counter's basket is unchanged: it belongs to the till device, and the counter's "hold" keeps
its meaning of parking an order. In this spec, "held" always means submitted to the tab but not
released to the kitchen.

Guests have separate private baskets. Staff cannot inspect or take over those baskets before
submission. Once staff or guests submit, the order becomes shared tab information. (Guest ordering
itself is later work, §5.)

## 3. Turn the draft into a sequence of groups

**Owner, 2026-09-26: groups replace courses.** Today the kitchen works in named courses; from this
spec on, a group is the kitchen's unit of hold and release. Course names (Drinks, Starters, Mains,
…) survive only as product defaults that pre-sort a draft. Names and their order belong to the
venue, not a fixed restaurant template. Bulk assignment through categories is a useful setup
direction; inheritance and precedence are not decided here. A venue need not use named defaults to
select and submit groups.

These names help you assemble the draft. They do not create permanent named containers on the tab.
After submission, a group is identified by its contents, position in the sequence and status.
You do not have to create or name a course before submitting a selection.

**Held** means submitted but not released for preparation. **Fire** means release the group to
the kitchen as work intended to arrive together. It does not mean every cook starts every dish at
the same instant, or that preparation has been observed to start. Kitchen staff coordinate timing;
automatic preparation-time scheduling is outside this design.

**Who may release a held group** stays a venue setting, as it is for courses today: the waiter's
screen, the kitchen screen or the expo (pass) screen offers Fire (**Owner, 2026-09-26**). The
pass's "ready" and "away" steps work per group instead of per course.

| Draft action | Result |
| --- | --- |
| Send all | Submit the remaining displayed groups, preserving their grouping and order, as held work. |
| Send selected | Combine the checked items into one new held group. Leave unchecked items in the draft. |
| Fire all now | Combine the whole remaining draft into one immediately released group. |
| Fire selected now | Combine the checked items into one immediately released group. Leave the rest in the draft. |

The interface can show All or Selected actions according to selection. Show the scope and result
before submission. "All" refers to your current draft, not another waiter's draft or groups already
held on the tab. Explicit submission is required; navigating away does not send anything.

For example, select drinks and Fire selected now. Select four cold starters and Fire selected now.
Select four warm starters and Send selected. Finally Send all: the remaining mains stay one held
group, followed by the remaining desserts as another. No retained Starter label is needed to
distinguish the two starter groups.

After a complete submission, return to the service dashboard with a confirmation of what fired
and what remains held. A partial submission leaves you able to continue with the remaining draft.

### Later additions have an explicit destination

Later additions default to **Fire now**. Review also offers:

- **Add to held group…**: choose an existing held group by position and contents, such as
  "Next: 2 steaks, 1 fish".
- **Add as new group**: append a new held group to the sequence.

There is no automatic matching against a remembered Main or Dessert label. Adding to a held group
keeps its sequence position and reminder timer. Already fired work is never expanded.

### Held groups remain editable

You can reorder held groups, move items between them, split quantities, or edit their quantities,
extras, options and notes. A group left empty drops out of the sequence. Record every change in
the history, with who made it. Fired groups keep their recorded history; changing a held group is
not a way to undo a fire.

Items in a held group have not been sent, so editing them is free. **Editing work already sent** is
governed by the menus design (§10.3, §11.5, §11.6 there): a sent item the kitchen has not started
can be changed from the till's Change action, and the kitchen receives a recall and a new ticket;
an item the kitchen has started cannot be changed, only cancelled and re-ordered; every correction
reaches a kitchen screen as a notice as well as a printed slip; and a venue with a paper-only
kitchen can switch off changes to sent items, leaving only cancellation. A line's price follows
the menus design's saved-order rules: it keeps the price it was given, and an edit prices only what
it adds.

**Groups and bills. Owner, 2026-09-26:** a group belongs to the visit, not to one bill. Splitting items onto
another bill of the same visit keeps them in their group, held or fired, so the kitchen's view does
not change. Moving items to a DIFFERENT visit (another table's tab): an item in a held group cannot
move until it is fired or taken out of the group; an item already fired moves, leaves its group,
and the kitchen gets the "moved to table X" slip the menus work builds.

## 4. Show what is known, including in a paper kitchen

Current orders shows the groups, their items and each row's known state, including partial
quantities. Keep held work, released work and subsequent additions distinguishable.

A paper kitchen may provide no preparation or readiness feedback. Sending a job to a printer is
not proof that paper emerged, somebody read it, or cooking began. Show preparation or readiness
only when there is an observation to support it. "Fired 20 minutes ago" is different from a claim
that the food is ready. A waiting-time warning can use a configured threshold without inventing
kitchen progress. Mixed paper and screen stations must retain these distinctions.

Mark items **Served** from inside Current orders, where you can inspect what you are claiming to
have delivered. Select items and quantities, or the visible group; undo is available. Do not put a
blind Mark served action on the floor dashboard. Paper workflows can go directly from fired to
served. **Owner, 2026-09-26:** serving can be recorded on a bill that has already been paid, because a
guest may pay before the food arrives; serving is an operational fact, not billing.

There is no separate **Collected** state. Ready work stays visible until served, accepting that
some of it may briefly be in transit.

### Remind staff to release the next group

Staff control the release of held groups, not guests. **Owner, 2026-09-26:**

- The group needing release is the first held group in the visit's sequence.
- Its reminder is due a configurable interval (default 10 minutes; the venue can switch reminders
  off) after every fired group before it has been fully marked served, counted from the latest of
  those served times.
- If a fired group before it is not fully served, or its service was never recorded, there is no
  timer: show the held group without inventing a served time.
- **Snooze** (for example five more minutes) moves the next reminder time; it never changes a
  served time.
- Firing, emptying or cancelling the group clears its reminder, and the next held group becomes the
  one waiting. Reordering moves the reminder to whichever group is now first.

Show the reminder on the table or tab and in its details. You can fire the group or snooze it.

### Print at fire time by default

By default, print preparation tickets only when their groups fire. A configurable alternative
(off by default) prints advance order information clearly marked HOLD, followed by an explicit FIRE
instruction. If held work already appeared on an advance ticket, edits and cancellations print
clear HOLD corrections, also shown on kitchen screens as notices; otherwise the eventual preparation
ticket simply contains the updated group.

**Owner, 2026-09-26:** kitchen output presents identical items as one entry ×N (the default) or as N
entries, a venue setting independent of billing and draft grouping.

Detected printing problems stay visible on the affected table and station, with Reprint, and
alert configurable recipients (kitchen, manager, waiter). The waiter can continue taking orders. Do
not describe an accepted order as missing merely because printing failed. Alert channels beyond
the table and station, their defaults, and how an issue is resolved remain to be designed.

For detected or undetected failures, staff can **Reprint kitchen ticket**. The ticket is clearly
marked REPRINT to help avoid duplicate preparation; a reprint creates no new order or fire event.
Fiscal invoice duplicates are a separate document workflow governed by the receipt spec below.

## 5. Guest access and counter service

**Guest access is later work** and needs its own security and interaction design before it is
built (link lifetime, bill selection, access after closure). The intended direction stays as
Revision 1 recorded it:

- When cloud connectivity is available, seating can offer a printed, visit-specific QR link. A
  venue can expose the menu, ordering, a simplified view of known order status, and payment.
  Seating and local staff service must not depend on obtaining that link.
- If guest ordering is enabled, a submitted guest order is processed without a staff approval gate.
  Otherwise offer a menu-only experience or no ordering link. Guests see the same grouping concepts
  in a simpler form and cannot release held groups.
- Guest edits are limited to held items, including items already shown on an advance HOLD ticket.
  Whether guests may cancel held items is configurable, and decreasing quantity follows the same
  rule. Fired items cannot be edited normally. A venue may allow a cancellation request after
  firing while keeping the charge, with an explicit warning; it is not an automatic refund or a
  guarantee that preparation stops.
- The link follows the visit, not the physical table. Closing the visit stops new guest orders and
  must not expose the next party's tab.

**Counter service.** Pay is the primary action; Send without payment is a venue-enabled
alternative. The pay-first path releases new preparation work after successful payment. Paying
work already sent must not fire it again. Paid but unfulfilled orders remain listed until handed
over; payment and handover can happen in either order. Completion keeps their history accessible.

## 6. Take contributions without consuming somebody else's tip

**Owner, 2026-09-26: a bill's invoice is issued when the bill is fully paid, and paying is
flexible.** Several payments can be taken against one bill before its invoice exists. The venue
may alternatively want the invoice printed at the start, before anyone pays, with a correction if
the table later splits; that option waits for the advisor (Q27, below).

At any point you can pay for selected items, contribute a fixed amount, or divide the outstanding
balance equally. Show the remaining balance after every successful payment. Equal shares must sum
to the exact remaining amount. **Owner, 2026-09-26:** each share is the amount divided equally in whole
cents, and the first shares take one extra cent each until the total is exact (€100.01 across three
is €33.34, €33.34, €33.33).

Keep the amount applied to the bill, the tendered amount, change and tip distinct:

- Selected items cost €40 and you hand over €50 cash: €40 pays the bill and €10 is change unless
  you explicitly leave it as a tip.
- Selected items cost €40 and you confirm €50 by card: €40 pays the bill and €10 is a tip. Show that
  allocation before payment confirmation, even if other guests still owe money.
- You choose to contribute €50 without selecting items: €50 pays down the bill, provided at
  least that much is outstanding. Any excess follows the cash-change/electronic-tip rule.

A tip is outside the invoice: a voluntary tip is not part of the taxable amount and does not appear
on the invoice (advisor Q13, closed). Bizum is not available today — no connected payment provider
offers it — so the electronic case means card until one does.

A general contribution is a pool against the bill, not a proportional discount spread over each
item. If somebody later chooses their €25 steak, they pay €25 while at least that much remains
owing. If only €15 remains, offer two explicit choices: pay €25 with €10 tip, or pay the remaining
€15 using €10 of the earlier contribution toward the steak. Earlier tips are never consumed.

Distinguish item-specific payments from general contributions so an item already paid for cannot
be charged again unnoticed. All devices need the current shared balance. **A separate payment
design** (plan Task 0) decides how payments against an un-invoiced bill are recorded, what happens
when two devices take payments on one bill at once (today one card payment in progress locks the
whole order, menus design §11.4), pending provider outcomes, retries, refunds, and what happens to
money already received when a later comp or discount leaves the bill owing less than was paid —
which is never silently turned into a tip. The owner approves that design before it is built.

### Split whole items into bills; split money within a bill

If someone leaving early wants their own invoice, select their items and quantities and split them
into a separate bill. The remainder stays open. Billing separation does not cancel, resend or reset
the progress of kitchen work (the menus work moves a split item's kitchen ticket with it, and a
group spans the visit's bills, §3).

**Owner, 2026-09-26:** this works after money has been taken too. After one guest contributes €50
"towards the bill", another can still ask for their own invoice: staff move those items to a
separate bill, take its payment and print its invoice, then return to the original bill, which
keeps the €50. The original bill's invoice is issued when it is fully paid, for what remains on it.

Do not split fractions of a discrete item off the main bill. For a €30 bottle shared three ways,
move the whole bottle to a separate bill and take three €10 contributions. The others can pay
later. This is one bottle on one bill, not three fractional wine items or three personal invoices.
Splitting two units out of Beer ×3 remains a whole-unit split; this rule does not change the
catalogue's normal measured-product units.

All related bills remain visible under the same visit, including paid ones. A table must not appear
fully paid while one of its related bills is outstanding. How a standalone counter tab presents its
related bills is a later interaction detail.

### Fiscal questions remain explicit

The [receipt design](2026-09-12-receipts-payment-slips-and-duplicates-design.md) records item-based
splitting for separate invoices and defers per-person VAT duplicates pending
[advisor question Q19](../../compliance/asesor-questions.md#q19-several-guests-one-table--separate-facturas-or-one-factura-with-duplicados-added-2026-09-12).
This workflow does not resolve Q19 or authorise building the deferred route. A payment
confirmation is not a substitute for an individual tax invoice.

Four more advisor questions bear on this section and stay open:

- [Q27](../../compliance/asesor-questions.md#q27-money-taken-against-a-bill-before-its-invoice-exists-then-a-split-added-2026-09-26):
  money taken against a bill before its invoice exists, then a split; and printing the invoice
  first.
- [Q21](../../compliance/asesor-questions.md#q21-when-a-table-asks-for-the-bill--pre-bill-first-or-the-invoice-straight-away-added-2026-09-23):
  a pre-bill first, or the invoice when the table asks for the bill.
- [Q14](../../compliance/asesor-questions.md#q14-is-a-restaurant-precuenta-a-prefactura-for-art-292j-lgt-added-2026-07-31):
  whether a pre-bill is a *prefactura*.
- [Q28](../../compliance/asesor-questions.md#q28-a-table-leaves-without-paying--is-the-invoice-still-owed-added-2026-09-26):
  whether an invoice is still owed when a table leaves without paying (§8).

Issuing an invoice and closing the visit are separate events. Guests can pay and then order dessert:
the new charge goes on a new bill of the same visit with its own invoice, and it never rewrites
earlier payments, tips or issued fiscal records. Corrections to an issued invoice go through the
fiscal correction workflow. Printing a pre-bill, when one exists, never sends anything to the
kitchen or fires held food (menus design §10.3).

## 7. Resolve complaints without erasing what happened

Provide configurable reasons and permissions for cancelling items, making selected lines
complimentary, and applying euro or percentage discounts to lines or a bill. Reasons are policies,
not just free text: they say which actions apply, the amounts or percentages allowed, who can apply
them, when approval is required and whether a note is mandatory.

**Limits add up. Owner, 2026-09-26:** a reason's euro limit caps the total that reason takes off one bill,
percentage discounts included; its percentage limit caps the combined percentage it takes off one
line. Asking above a limit is refused; the owner raises the policy to allow more. Someone below the
reason's applying role needs approval from someone at or above its approving role.

Examples supplied by the owner include entry error, changed mind, unavailable item, complaint,
friends and family, employee discount and manager special. They are examples, not a mandatory
reason list. "Already paid" and "Paid separately" need payment reconciliation, not an automatic
discount. "Customer left without paying" is an unpaid departure (§8), not a comp. Training belongs
to the separate training environment, not a reason to erase a live transaction.

**Owner, 2026-09-26: discounts and comps reduce the line.** A line discount lowers that line's
price. A whole-bill discount is spread across the bill's lines in proportion to their amounts, so
each VAT rate's taxable amount drops correctly. A comp is the line at 100% off, shown on the invoice
with its original price and €0.00. This rests on the advisor finding that a reduction agreed before
the invoice is issued is a *descuento* (Q15, closed). **Details, Owner, 2026-09-26:**

- A line always keeps a whole number of cents per unit, because the invoice is built from unit
  price × quantity. Comping or discounting part of a line (1 of Steak ×2) first splits that part
  into its own line; a reduced total that does not divide into whole-cent units becomes at most two
  lines (Croquetas ×3 at €3.33 with 10% off: 2 × €3.00 and 1 × €2.99).
- A whole-bill discount is shared out in whole cents, rounded down, and the cents left over go to
  the lines with the largest remainders, earlier lines first on a tie, so the shares sum exactly.
- **A weighed item (sold by weight) can take a discount (Owner, 2026-09-26)** by lowering its
  per-kilo price to the whole-cent price whose line total comes nearest the discounted amount. Up
  to 1 kg that is exact; on a heavier item the amount actually taken off can differ from the amount
  asked by up to half the weight in cents: up to 2 cents at 3.2–5 kg, 5 cents at 10 kg, 12 cents at
  25 kg (one cent of per-kilo price moves a 2.5 kg line by 2.5 cents). Staff
  see the exact amount before confirming, and the adjustment records the amount actually taken off.
  A whole-bill discount shares out over every line, weighed ones included, and any cent a weighed
  line could not take goes to the other lines, so the bill drops by exactly what was asked
  wherever the bill has a line that is not weighed. A comp (100% off) is always exact. How this
  appears on the invoice is put to the advisor as
  [Q29](../../compliance/asesor-questions.md#q29-how-a-discount-or-comp-appears-on-a-simplified-invoice-added-2026-09-26).
- A discount larger than what it applies to (the line, or the bill) is refused, never silently
  reduced.
- A comp or discount on a bill that is already paid is refused; the invoice is corrected through
  the fiscal correction workflow instead.

Preparation cancellation, a reduced charge, payment refund and unpaid debt are distinct outcomes.
Keep the order history and actual preparation/service facts. A comp does not pretend the food was
never made, and it sends nothing to the kitchen. **Cancelling** follows the menus design (§11.5
there): it takes the item off the bill at once and the kitchen receives a VOID notice; an item the
kitchen made anyway is re-added with a note so it is billed. The adjustment record keeps what
happened in the kitchen and what happened to the charge as separate facts. A post-payment reduction
must not silently turn the difference into a tip.

There is no separate replacement-item action. Order the replacement normally, usually Fire now,
and comp the original or new item with the appropriate reason. Both remain in the history.

When approval is needed, a manager can authorise on the waiter's device, with their PIN, without
logging the waiter out. Record requester and approver separately, along with the reason,
before/after values and time.

### Make adjustments reviewable

Provide overall and per-waiter reports for comps, cancellations and discounts, with counts, values,
reasons and drill-down to the underlying history. Distinguish actions before firing, after firing
and after serving, and show who requested and approved them. Attribute an adjustment to its actual
actor, not automatically to the original order taker or whoever later owns the table. Guest
cancellations have separate attribution.

Show rates alongside totals so staff handling more sales can be compared sensibly. **Owner,
2026-09-26:** a person's sales, for the rate, are the items credited to them (§2), each at its
price before any adjustment; comped and cancelled items still count at their original price, so an
item that appears in the adjustments also appears in the sales it is measured against. Who took
the payment or issued the invoice plays no part. Keep the
nominal value of cancelled items distinct from the financial reduction and any recorded stock
loss. Do not count the same reduction twice because an item was first comped and then cancelled.
Reports support investigation; a high total alone is not a conclusion about misconduct.
Operational cancellation reporting must not treat a kitchen cancellation as automatically voiding
an issued fiscal record.

## 8. Finish the visit without hiding outstanding bills

Paying does not by itself free an occupied table. By default, **Finish table** closes the visit
and makes the table available (every table of a joined party). An optional clearing workflow, off by default, instead closes the
visit into **Needs clearing**, followed by **Mark cleared** when ready for the next party. The next
party's visit starts empty: it never shows the previous visit's bills.

An outstanding related bill blocks ordinary closure. Offer Take payment or a permission-controlled
**Record unpaid departure**, with a reason. The latter releases the table while retaining the
unpaid amount and the staff member who recorded it. Collection of that debt later is not specified
here. Settled bills and the visit's history remain accessible after closure.

**Unpaid departure waits for advisor Q28.** In a venue that issues the invoice at payment, no
invoice exists when the table leaves, although the food was served. The working assumption is that
the invoice is issued anyway, for the full amount, and recorded as unpaid; unpaid departure is not
built until Q28 is answered or the owner decides without it.

## 9. Keep menu access separate from product use

Replace the standalone-sale yes/no setting with a three-way **Standalone ordering** setting:

| Value | Who can order the product on its own |
| --- | --- |
| Public | Staff and guests, through an applicable menu. |
| Staff only | Staff, through an applicable menu; hidden from guest ordering. |
| Not sold separately | Neither staff nor guests. |

An ingredient is not necessarily an extra. Whether a product is used as an ingredient, an extra,
or both is independent of this setting. Extras remain products; options remain text selections.

Menu membership still controls what staff can find and order. Do not expose the entire catalogue
through staff search. One shared menu can contain a staff-only bacon product without showing it
to guests, avoiding a second menu maintained solely for such additions. Once ordered, that bacon
is visible on the guest's tab and bill; staff-only is ordering permission, not hidden billing.

If a guest wants bacon after their burger has fired, order bacon as a separate product at its
standalone price, normally Fire now. There is no special retrospective Add extra action or required
link to the burger. The restaurant must make bacon sellable to staff and include it in the menu.

**Owner, 2026-09-26:**

- The published menu carries the setting, so changing it marks the menu as changed until it is
  published again (the menus design's publishing rules).
- The server refuses a standalone order for a product that is not sold separately; hiding a tile
  is never the only protection.
- Until guest ordering exists, Staff only behaves exactly like Public.
- Upgrading a venue sets every product to Public, because no data is carried across before
  production. A venue must reset any product it had marked as not sold on its own.

## 10. Availability now; inventory integration later

Marking a product unavailable prevents new orders and alerts staff to affected held items (the
held-unavailable signal, §1). Do not automatically cancel or substitute existing work. Preserve
affected unsent drafts, flag their unavailable lines and prevent submission of those lines; let
staff explicitly send unaffected items. A held group containing an unavailable item cannot be fired
until staff remove or replace it (the menus design's rule that an unsent line whose product became
unavailable cannot be sent or paid for, §11.3 there). An item already sent stays payable.
Restoring availability permits ordering again without rewriting existing orders.

When inventory counts are introduced, commit stock at submission to the tab, including held
groups, not while an item is only in a draft. Firing a held group does not deduct it again. At zero
available stock, the product becomes unavailable. Concurrent orders must not both claim the last
portion. The stock reservation and physical-consumption model belongs to the later inventory spec.
Reaching zero through valid reservations must not invalidate those same held orders; distinguish
stock already committed to them from stock available for new orders.

Cancelling an unfired item releases its stock. Cancelling a fired item leaves it consumed unless
staff explicitly record it as recoverable. A comp changes the charge, not stock. Moving or splitting
existing work between groups or bills must not consume stock a second time.

There is no out-of-stock ordering override. Someone with permission must correct the stock count
first. If a draft asks for three portions but only two remain, retain the request, explain the
shortage and offer Change to two. Do not silently reduce quantities or submit the rest as a side
effect of that choice.

Recipes, ingredient conversion, extras consumption, wastage, recoverable-stock permissions and
the interaction between manually unavailable and stock-unavailable states remain for that later
spec. This document does not require inventory control to ship with the service screens.

## 11. Screen reuse and deferred work

Prefer well-designed built-in screens over a general customer-facing grid canvas editor. Technical
customisation should eventually use source-coded pluggable screen implementations. Reuse shared
UI primitives/tokens, menu tiles, order controls, state/actions, navigation and device configuration
where their contracts fit. A responsive grid is a layout tool, not a reason to retain a general
drag-and-resize screen designer.

The plugin interface and exact reusable component boundaries are not approved by this workflow
spec. Design them after the built-in workflows clarify what they need. Menu shortcut arrangement,
receipt configuration and an operational floor-plan editor are separate concerns, not reasons to
reintroduce general screen editing.

Deferred features:

- Optional item assignment to seats or guests, including shared items. For now, ordering is at
  table/tab level and bill splitting uses manual item selection.
- Staff-to-table assignment and handover of that responsibility.
- Daily working floor layouts: join/split tables, change chair counts, move tabs or selected items,
  add/remove tables, and start each service day from a saved default. Resolve open tabs across the
  day boundary; preserve kitchen progress when moving items.
- Guest access (§5), full inventory and stock ordering, the source-code screen plugin contract, a
  Bizum tender, and printing the invoice before payment (§6, Q27).

## 12. Checks to turn into acceptance tests

These are future acceptance requirements, not tests run while writing this document:

1. Two staff take separate drafts on one visit; takeover makes the former owner read-only and only
   one submission succeeds, in either order of events, and a retried submission creates nothing
   twice. After a takeover, every item in the draft is credited to the new owner and the history
   shows the takeover. Guests' unsubmitted baskets stay private.
2. Three Beer taps group; different options, notes or extras lists do not; the same options picked
   in a different order do. Split quantity stays split for moving items. Partial submission
   preserves all unselected items.
3. The drinks/cold starters/warm starters/mains/desserts example produces the specified released
   and held groups. Send all preserves grouping; Fire all now combines the current draft only.
4. A later main defaults to Fire now, can explicitly join a held group, and never gets silently
   matched to a historical course label. Editing, reordering and empty-group removal preserve
   history. A fired group can never be joined.
5. A paper-only station shows no invented Ready state. Mark served uses visible quantities, and
   works on a bill already paid. Snoozing a held-group reminder leaves its source served time
   intact.
6. Advance HOLD edits produce corrections; print-on-fire emits the current contents. A detected
   print failure shows on the table and station without blocking orders. Reprint is marked
   REPRINT and produces no new order or fire event.
7. €50 paid for €40 of items yields €10 cash change or a confirmed €10 card tip. Later payments
   cannot consume the tip. A general contribution does not discount each item.
8. A €25 steak with €15 still owing offers the two agreed allocations. A whole shared bottle moves
   onto one related bill; separate contributions settle it without fractional bottle lines. After
   a €50 contribution on €120, two items (€30) split to their own bill are paid and invoiced there,
   and the original bill's invoice, issued at full payment, is for €90 with the €50 applied.
9. A table with one bill paid and another outstanding never reads as paid, and Finish table is
   refused. Tables 4 and 5 joined are one visit: neither can be seated again, paying leaves both
   occupied, dessert opens a new bill on the same visit, Finish frees both, and unjoining Table 5
   with items starts exactly one separate visit. After Finish, the next party sees none of the previous visit's bills. Needs clearing is
   optional and off by default. Unpaid departure preserves debt and attribution (after Q28).
10. A manager approves with their PIN without replacing the waiter session. A comp of a served dish
    sends nothing to the kitchen. A discount on Croquetas ×3 leaves whole cents per unit; a discount on a 2.5 kg weighed item
    shows and records the amount actually taken off; a discount larger than its line or bill is
    refused. A rate counts a waiter's credited items at their original prices, whoever took the
    payment. Reports
    distinguish requester, approver, guest actions, nominal value and actual financial reductions
    without double-counting them.
11. Staff-only bacon is searchable within its menu, absent from guest ordering, but visible on the
    guest's bill once ordered. Not sold separately is refused by the server as a standalone order,
    and still sells as an extra.
12. With inventory enabled, simultaneous submissions cannot oversell the last portion; held
    cancellation releases stock, firing does not deduct twice, and a comp does not restore stock.
13. Guest edits, submission retries, takeover, firing, adjustments and payment races are checked at
    the write boundary, not only through disabled controls. No stale edit silently undoes a fire.
14. Render the workflows in both themes at handheld and till sizes. Use the
    [design system](../../developers/design-system.md), audience-appropriate product names,
    visible action scope, accessible touch targets and alternatives to drag-only reordering.

## 13. What remains open

- **The payment design** (plan Task 0): the questions §6 hands it. The owner approves it before
  multi-payment bills are built.
- **Advisor questions:** Q19 (duplicates per guest), Q21 and Q14 (pre-bill versus invoice at the
  table), Q27 (money before the invoice, and printing the invoice first), Q28 (unpaid departure),
  Q29 (how a discount or comp appears on the invoice).
- **Guest access:** its security and interaction design (§5).
- **Interaction design:** signal priority and landing views (§1), alert channels for print problems
  (§4), and how a counter tab presents related bills (§6).
- **Later specs:** inventory (§10), kitchen routing rules (menus design §10.5), floor layouts
  during service, seat assignment, staff assignment.

## 14. Changes from Revision 1

**Owner decisions, 2026-09-26:**

1. Groups replace named courses; who may release a held group stays a venue setting (§3).
2. A visit record ties one party's orders and bills and keeps the table occupied until Finish
   table (terms, §1, §8).
3. A bill's invoice is issued when it is fully paid; several payments may come before it; items can
   still be split to their own bill after a contribution; printing the invoice first waits for Q27
   (§6).
4. Discounts and comps reduce the line; comps show at €0.00 with the original price (§7).

**Now governed by the menus design** (§10.3, §11.2–§11.6 there, and the owner's answers while lane
C built them): prices on saved orders and edits to them; editing sent work (Change, recall, the
paper-only-kitchen setting, kitchen notices); unavailable items at send and pay; a split item's
kitchen ticket and the "moved to table X" slip; the one-card-payment-at-a-time lock; VAT recorded
on the line from the published menu (lane C's item M7v). Revision 1's §3 "price treatment not
settled", §3 and §4's correction wording, and §10's held-work availability now defer to it.

**Proposed by the planning session and accepted by the owner, 2026-09-26:**

- the dashboard's list of signals, with Bill requested as a visit fact (§1);
- when identical items combine in a draft (§2);
- a draft is priced like an unsaved basket and locks at submission (§2);
- a draft belongs to the signed-in operator and the visit, and is saved on the server (§2);
- a group belongs to the visit, so bill splits keep it; moving held items to another visit is
  refused (§3);
- serving can be recorded on a paid bill (§4);
- the release-reminder rules, default 10 minutes (§4);
- kitchen tickets as ×N or N entries, a venue setting (§4);
- equal shares in whole cents, first shares taking the extra cent (§6);
- how adjustment limits add up, and approval by role (§7);
- whole cents per unit on a reduced line, how a bill discount is shared, no adjustments on a paid
  bill (§7);
- a comp sends nothing to the kitchen (§7);
- the Standalone ordering details, including every product starting Public on upgrade (§9);
- a held group with an unavailable item cannot fire (§10).

**Changed by the owner, 2026-09-26, from what was proposed:**

- items are credited to whoever owns the draft when it is submitted, not to a separate author per
  item (§2);
- weighed items CAN take discounts, to the nearest cent, instead of being excluded (§7);
- a person's sales for adjustment rates are the items credited to them, at their original prices
  (§7).

**Added after a second review, 2026-09-26:** a party at joined tables is one visit across all of
them (terms, §1, §8), because joining tables already exists and a visit keyed to one table would
not stop the other tables being seated twice.

**What the review of the code found, which shaped the above:** much of §3–§4 already exists
(courses with hold and fire, per-line send and recall, kitchen screen states, void and recall slips,
reprint, waiting bands), as do a pay-first counter mode, whole-item bill splitting with an invoice
per bill, table moves and joins, and a manager PIN override that keeps the waiter signed in. Missing
today: paying frees the table; a split bill has no link to its table; every bill is paid in one go
at the moment its invoice is issued; the counter basket belongs to the device and the table's round
lives only on screen; cancelling a line records no reason or actor; a reprint is not marked; served
is whole-line only; sending a round takes no protection against a retried request.

**Removed from Revision 1:** the paragraph deferring implementation until the PostgreSQL-to-SQLite
work, dependency upgrades and variants/extras-as-products land. The dependency upgrades and
variants/extras-as-products have landed (#480, #556). SQLite slice 2 is still landing in lane A, but
the owner decided on 2026-09-25 that the menus work does not wait for it (menus plan,
"Prerequisites"), and this work follows the menus work. Also removed: the §13 list of
questions to resolve before planning, now answered above or listed in the new §13; Bizum as a
current payment example.

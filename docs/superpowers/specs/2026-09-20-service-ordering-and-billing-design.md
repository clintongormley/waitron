# Service, ordering and billing workflows

**Status:** product decisions agreed with the owner on 2026-09-20; implementation deferred.

You should be able to take orders quickly, see what needs attention, control when food reaches the
kitchen, and collect payments without losing track of the table. The same service model must work
on a handheld or till, with a kitchen using paper, screens, or both.

This is intended behaviour, not a description of verified application features. Implementation
waits for the PostgreSQL-to-SQLite work, dependency upgrades, and variants/extras-as-products
changes to land. Inspect their landed contracts before making an implementation plan. Inventory,
guest cloud access and the other later features below are not prerequisites for the staff workflow.

This spec complements the [menu, category and home-layout design](2026-09-20-menus-categories-and-home-layouts-design.md).
It records the final decisions from the workflow discussion. In particular, it replaces the earlier
ideas of permanent named course buckets, automatic matching of later additions to those names,
and a special initial-meal-ordering phase.

Here, a **tab** holds the visit's shared orders, a **bill** is a collection of charges you can pay
separately, and an **invoice** is an issued fiscal document. These are workflow distinctions, not
new database entities chosen by this spec. Splitting bills must not fragment the kitchen's view
of the visit.

## 1. Start with the service dashboard

For table service, you start on a floor plan or flat table list. For counter service, you can start
on a flat list of tabs, including tabs without a table, identified by a name or order number.

The dashboard distinguishes unoccupied tables from occupied ones and highlights work needing
attention: taking an order, food or drinks ready to deliver, a long wait, a held group needing
release, or a requested bill. Several signals can coexist; payment and kitchen progress are not
one mutually exclusive status. Exact priority, thresholds and landing-view configuration remain
interaction-design work.

Stations appear here too. The bar can show drinks waiting for Tables 2 and 8, while those tables
also show the corresponding readiness. Open the station to see the actual items and destinations.
These are two views of the same work, not separate notifications to clear independently.

Tap an occupied table to open its tab on **Ordering**, with **Current orders** as a second view.
Tap an empty table to seat guests, record the guest count and open a tab. All bills split from the
visit remain attached to that table. You can see each bill's paid and outstanding amounts, the
table's total outstanding balance, and settled bills when you need their receipts.

Staff-to-table assignments are deferred. The dashboard must be usable without them.

## 2. Take an order without submitting it accidentally

The ordering home uses the published menu's search, shortcut grid and category structure. A plain
product tap adds one unit to your unsent draft. Three taps on Beer produce Beer ×3. An item with
extras or options opens its customisation screen first; confirming adds the configured item.

Combine identical products and selections within the same draft group. Compare selection values,
not the order in which you picked them. Different notes or customisations stay separate. Do not
merge a new addition into previously fired work merely because the dish is identical.

The last-added item stays visible at the bottom, with its distinguishing selections and +1/−1
controls. On a handheld, open a separate **Review** screen for the whole draft; do not squeeze a
full basket beside browsing. Returning preserves the draft and browsing position. A wider till
can show browsing and the draft together.

Use **Split quantity** to turn Burger ×3 into three individual rows before moving one elsewhere.
Do not immediately regroup those rows and undo the separation you just requested.

### Separate drafts, shared submitted orders

Each waiter has their own draft, so one can take drinks while another takes food. Leaving the
ordering screen retains the draft and shows an unsent-items indication at the table. Other staff
can see “Alex has an unsent order” and open its contents.

To edit or submit another waiter's draft, explicitly **Take over draft**. Ownership transfers;
Alex sees who took over and can no longer edit or submit that draft. Keep the identity of each
item's author and the person who submits it. Concurrent takeover or a stale screen must not allow
the same draft to be submitted twice. The persistence and conflict mechanism belongs in the plan.

Guests have separate private baskets. Staff cannot inspect or take over those baskets before
submission. Once staff or guests submit, the order becomes shared tab information.

## 3. Turn the draft into a sequence of groups

Product defaults initially organise items under configurable course names, such as Drinks,
Starters or Mains. Names and their order belong to the venue, not a fixed restaurant template.
Bulk assignment through categories is a useful setup direction; inheritance and precedence are
not decided here. A venue need not use named defaults to select and submit groups.

These names help you assemble the draft. They do not create permanent named containers on the tab.
After submission, a group is identified by its contents, position in the sequence and status.
You do not have to create or name a course before submitting a selection.

**Held** means submitted but not released for preparation. **Fire** means release the group to
the kitchen as work intended to arrive together. It does not mean every cook starts every dish at
the same instant, or that preparation has been observed to start. Kitchen staff coordinate timing;
automatic preparation-time scheduling is outside this design.

| Draft action | Result |
| --- | --- |
| Send all | Submit the remaining displayed groups, preserving their grouping and order, as held work. |
| Send selected | Combine the checked items into one new held group. Leave unchecked items in the draft. |
| Fire all now | Combine the whole remaining draft into one immediately released group. |
| Fire selected now | Combine the checked items into one immediately released group. Leave the rest in the draft. |

The interface can show All or Selected actions according to selection. Show the scope and result
before submission. “All” refers to your current draft, not another waiter's draft or groups already
held on the tab. Explicit submission is required; navigating away does not send anything.

For example, select drinks and Fire selected now. Select four cold starters and Fire selected now.
Select four warm starters and Send selected. Finally Send all: the remaining mains stay one held
group, followed by the remaining desserts as another. No retained Starter label is needed to
distinguish the two starter groups.

After a complete submission, return to the service dashboard with a confirmation of what fired
and what remains held. A partial submission leaves you able to continue with the remaining draft.

### Later additions have an explicit destination

Later additions default to **Fire now**. Review also offers:

- **Add to held course…**: choose an existing held group by position and contents, such as
  “Next: 2 steaks, 1 fish”.
- **Add as new course**: append a new held group to the sequence.

There is no automatic matching against a remembered Main or Dessert label. Adding to a held group
keeps its sequence position and reminder timer. Already fired work is not silently expanded.

### Held groups remain editable

You can reorder held groups, move items between them, split quantities, or edit their quantities,
extras, options and notes. Remove a group from the pending sequence when it becomes empty. Record
changes in the history. Fired groups retain their recorded history; changing a held group is not
a way to undo a fire.

Cancelling an already fired item sends a correction to the kitchen. It cannot guarantee that
preparation stops. Cancelling preparation and removing the charge are separate decisions.

The exact price treatment when editing held customisations was not settled. Do not infer blanket
repricing or silently rewrite unchanged prices from this permission to edit; resolve it against
the landed order and menu snapshot contracts before implementation.

## 4. Show what is known, including in a paper kitchen

Current orders shows the groups, their items and each row's known state, including partial
quantities. Keep held work, released work and subsequent additions distinguishable.

A paper kitchen may provide no preparation or readiness feedback. Sending a job to a printer is
not proof that paper emerged, somebody read it, or cooking began. Show preparation or readiness
only when there is an observation to support it. “Fired 20 minutes ago” is different from a claim
that the food is ready. A waiting-time warning can use a configured threshold without inventing
kitchen progress. Mixed paper and screen stations must retain these distinctions.

Mark items **Served** from inside Current orders, where you can inspect what you are claiming to
have delivered. Select items/quantities or the visible group. Do not put a blind Mark served action
on the floor dashboard. Paper workflows can go directly from fired to served.

There is no separate **Collected** state. Ready work stays visible until served, accepting that
some of it may briefly be in transit.

### Remind staff to release the next group

Staff control the release of held groups, not guests. Remind staff when a configurable interval
has passed since the preceding group was fully marked served. Show the reminder on the table or
tab and in its details. If service has not been recorded, show the held group without inventing a
served timestamp or a timer based on one.

You can fire the group or snooze the reminder, for example for another five minutes. Snoozing
changes the next reminder time, not the actual served time. Firing or cancelling the pending group
clears its reminder. Reminder behaviour after reordering, deletion or overlapping fires needs
precise rules in the later interaction design.

### Print at fire time by default

By default, print preparation tickets only when their groups fire. A configurable alternative
prints advance order information clearly marked HOLD, followed by an explicit FIRE instruction.
If held work already appeared on an advance ticket, edits and cancellations need clear correction
tickets; otherwise the eventual preparation ticket simply contains the updated group.

Kitchen output can present identical items as one entry ×N or N entries, independently of billing
and draft grouping.

Detected printing problems alert configurable recipients, including the kitchen, manager and
waiter. Keep the problem visible, but allow the waiter to continue taking orders. Do not describe
an accepted order as missing merely because printing failed. Alert channels, defaults and how an
issue is resolved remain to be designed.

For detected or undetected failures, staff can **Reprint kitchen ticket**. Clearly mark the ticket
REPRINT to help avoid duplicate preparation; do not create another order or fire event. Fiscal
invoice duplicates are a separate document workflow governed by the receipt spec below.

## 5. Guest access and counter service

When cloud connectivity is available, seating can offer a printed, visit-specific QR link. A
venue can expose the menu, ordering, a simplified view of known order status, and payment. Seating
and local staff service must not depend on obtaining that cloud link.

If guest ordering is enabled, a submitted guest order is processed without a staff approval gate.
Otherwise offer a menu-only experience or do not issue an ordering link. Present the same grouping
concepts in a simpler form, using the venue's configured defaults. Guests cannot release already
held groups. The exact initial guest grouping controls still need interaction design.

Guest edits are limited to held items, including items already shown on an advance HOLD ticket.
Whether guests may cancel held items is configurable; decreasing quantity must respect that same
rule. Fired items cannot be edited normally. A venue may optionally allow a cancellation request
after firing while retaining the charge, with an explicit warning before confirmation. This is
not an automatic refund or a guarantee that preparation can be stopped.

The guest link follows the visit rather than granting permanent access to a physical table.
Closing the visit stops new guest orders and must not expose the next party's tab. Link lifetime,
bill selection and access after closure need a security and interaction design before this feature
is built.

At a counter, Pay is the primary action; Send without payment is a venue-enabled alternative.
The pay-first path releases new preparation work after successful payment. Paying work already
sent must not fire it again. Paid but unfulfilled tabs remain on the dashboard until handed over;
payment and handover can happen in either order. Completion keeps their history accessible.

## 6. Take contributions without consuming somebody else's tip

At any point you can pay for selected items, contribute a fixed amount, or divide the outstanding
balance equally. Show the remaining balance after every successful payment. Equal shares must
sum to the exact remaining amount, with a deterministic allocation of rounding cents.

Keep the amount applied to the bill, the tendered amount, change and tip distinct:

- Selected items cost €40 and you hand over €50 cash: €40 pays the bill and €10 is change unless
  you explicitly leave it as a tip.
- Selected items cost €40 and you confirm €50 by card or Bizum: €40 pays the bill and €10 is a
  tip. Show that allocation before payment confirmation, even if other guests still owe money.
- You choose to contribute €50 without selecting items: €50 pays down the bill, provided at
  least that much is outstanding. Any excess follows the cash-change/electronic-tip rule.

A general contribution is a pool against the bill, not a proportional discount spread over each
item. If somebody later chooses their €25 steak, they pay €25 while at least that much remains
owing. If only €15 remains, offer two explicit choices: pay €25 with €10 tip, or pay the remaining
€15 using €10 of the earlier contribution toward the steak. Earlier tips are never consumed.

Distinguish item-specific payments from general contributions so an item already paid for cannot
be charged again unnoticed. All devices need the current shared balance; simultaneous payment
attempts, pending provider outcomes and retries require a separate payment design before building.

### Split whole items into bills; split money within a bill

If someone leaving early wants their own invoice, the chosen workflow is to select their items
and quantities and split them into a separate bill. The remainder stays open. Billing separation
does not cancel, resend or reset the progress of kitchen work.

Do not split fractions of a discrete item off the main bill. For a €30 bottle shared three ways,
move the whole bottle to a separate bill and take three €10 contributions. The others can pay
later. This is one bottle on one bill, not three fractional wine items or three personal invoices.
Splitting two units out of Beer ×3 remains a whole-unit split; this rule does not change the
catalogue's normal measured-product units.

All related bills remain visible under the same table and visit, including paid ones. A table
must not appear fully paid while one of its related bills is outstanding. How a standalone
counter tab presents its related bills is a later interaction detail.

### Fiscal questions remain explicit

The [receipt design](2026-09-12-receipts-payment-slips-and-duplicates-design.md) records item-based
splitting for separate invoices and defers per-person VAT duplicates pending
[advisor question Q19](../../compliance/asesor-questions.md#q19-several-guests-one-table--separate-facturas-or-one-factura-with-duplicados-added-2026-09-12).
This workflow discussion does not resolve that question or authorise building the deferred route.

The recorded alternatives are one invoice, or an original and marked duplicates showing each
recipient's share of taxable base and VAT. Their applicability to restaurant simplified invoices
remains open in Q19. A payment confirmation is not a substitute for an individual tax invoice.

Issuing an invoice and closing the visit are separate events. Guests can pay and subsequently
order dessert; the new charge must not rewrite earlier payments, tips or issued fiscal records.
The intended direction is another invoice for genuinely new consumption, with corrections handled
through the fiscal correction workflow where applicable. Before implementation, resolve issuance
timing for contributions, partial payments, post-payment additions, adjustments and refunds with
the fiscal design and advisor. Do not assume waiting for the last payer is always valid, or that
this document settles the legal treatment of every split.

## 7. Resolve complaints without erasing what happened

Provide configurable reasons and permissions for cancelling items, making selected lines
complimentary, and applying euro or percentage discounts to lines or a bill. Reasons are policies,
not just free text: specify applicable actions, amounts or percentages allowed, who can apply them,
when approval is required and whether a note is mandatory. Apply limits cumulatively so several
small adjustments do not bypass a cap.

Examples supplied by the owner include entry error, changed mind, unavailable item, complaint,
friends and family, employee discount and manager special. They are examples, not a mandatory
reason list. “Already paid” and “Paid separately” need payment reconciliation, not an automatic
discount. “Customer left without paying” is an unpaid departure, not a comp. Training belongs to
the separate training environment, not a reason to erase a live transaction.

Preparation cancellation, a reduced charge, payment refund and unpaid debt are distinct outcomes.
Keep the order history and actual preparation/service facts. A comp does not pretend the food
was never made. A post-payment reduction must not silently turn the difference into a tip.
Issued invoice adjustments follow the fiscal workflow, not edits to an issued record.

There is no separate replacement-item action. Order the replacement normally, usually Fire now,
and comp the original or new item with the appropriate reason. Both remain in the history.

When approval is needed, a manager can authorise on the waiter's device without logging the waiter
out. Record requester and approver separately, along with the reason, before/after values and time.
The authentication mechanism and permission vocabulary are later implementation decisions.

### Make adjustments reviewable

Provide overall and per-waiter reports for comps, voids/cancellations and discounts, with counts,
values, reasons and drill-down to the underlying history. Distinguish actions before and after
firing or service, and show who requested and approved them. Attribute an adjustment to its actual
actor, not automatically to the original order taker or whoever later owns the table. Guest
cancellations have separate attribution.

Show rates alongside totals so staff handling more sales can be compared sensibly. Keep the
nominal value of cancelled items distinct from the financial reduction and any recorded stock
loss. Do not count the same reduction twice because an item was first comped and then cancelled.
Reports support investigation; a high total alone is not a conclusion about misconduct.
Operational cancellation reporting must not treat a kitchen cancellation as automatically voiding
an issued fiscal record.

## 8. Finish the visit without hiding outstanding bills

Paying does not by itself free an occupied table. By default, **Finish table** closes the visit
and makes the table available. An optional clearing workflow, off by default, instead closes the
visit into **Needs clearing**, followed by **Mark cleared** when ready for the next party.

An outstanding related bill blocks ordinary closure. Offer Take payment or a permission-controlled
**Record unpaid departure**, with a reason. The latter releases the table while retaining the
unpaid amount and the staff member who recorded it. Collection of that debt later is not specified
here. Settled bills and the visit's history remain accessible after closure.

## 9. Keep menu access separate from product use

Replace the standalone-sale boolean with a three-way **Standalone ordering** setting:

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

Snapshot behaviour for this setting, guest filtering of category/home shortcuts, menu overrides
versus extra prices, and server enforcement must be reconciled with the menu publication design.
This permission must never depend solely on hiding a tile.

## 10. Availability now; inventory integration later

Marking a product unavailable prevents new orders and alerts staff to affected held items. Do not
automatically cancel or substitute existing work. Preserve affected unsent drafts, flag their
unavailable lines and prevent submission of those lines; let staff explicitly send unaffected
items. Restoring availability permits ordering again without rewriting existing orders.

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
- Full inventory and stock ordering, cloud guest access, and the source-code screen plugin contract.

## 12. Checks to turn into acceptance tests

These are future acceptance requirements, not tests run while writing this document:

1. Two staff take separate drafts on one tab; takeover makes the former owner read-only and only
   one submission succeeds. Guests' unsubmitted baskets stay private.
2. Three Beer taps group; different options do not. Split quantity stays split for moving items.
   Partial submission preserves all unselected items.
3. The drinks/cold starters/warm starters/mains/desserts example produces the specified released
   and held groups. Send all preserves grouping; Fire all now combines the current draft only.
4. A later main defaults to Fire now, can explicitly join a held group, and never gets silently
   matched to a historical course label. Editing, reordering and empty-group removal preserve history.
5. A paper-only station shows no invented Ready state. Mark served uses visible quantities;
   snoozing a held-group reminder leaves its source served timestamp intact.
6. Advance HOLD edits produce corrections; print-on-fire emits the current contents. A detected
   print failure alerts without blocking orders. Reprint produces no new order or fire event.
7. €50 paid for €40 of items yields €10 cash change or a confirmed €10 electronic tip. Later
   payments cannot consume the tip. A general contribution does not discount each item.
8. A €25 steak with €15 still owing offers the two agreed allocations. A whole shared bottle moves
   onto one related bill; asynchronous contributions settle it without fractional bottle lines.
9. An outstanding related bill blocks ordinary Finish table. Unpaid departure preserves debt and
   attribution. Needs clearing is optional and off by default.
10. A manager approves without replacing the waiter session. Reports distinguish requester,
    approver, guest actions and actual financial reductions without double-counting them.
11. Staff-only bacon is searchable within its menu, absent from guest ordering, but visible on the
    guest's bill once ordered. Not sold separately does not mean Extra only.
12. With inventory enabled, simultaneous submissions cannot oversell the last portion; held
    cancellation releases stock, firing does not deduct twice, and a comp does not restore stock.
13. Guest edits, submission retries, takeover, firing and payment races are checked at the write
    boundary, not only through disabled controls. No stale edit silently undoes a fire.
14. Render the workflows in both themes at handheld and till sizes. Use the
    [design system](../../developers/design-system.md), audience-appropriate product names,
    visible action scope, accessible touch targets and alternatives to drag-only reordering.

## 13. Before implementation

Reconcile this document with the landed order, product, payment, printing and fiscal contracts.
Audit existing behaviour rather than assuming every requirement needs new code. Then resolve:

- Draft persistence/recovery, takeover races, guest identity, connection-loss behaviour and
  idempotent submission, firing, printing and payment commands.
- Default course assignment, initial guest grouping, reminder semantics after structural edits,
  operational alert delivery and authority to release groups.
- Menu version changes during drafts/held edits, locked-price treatment, access-setting publication
  and manual availability versus future stock exhaustion.
- Payment allocations across related bills, pending captures, refunds, issuance timing and Q19.

Write implementation slices only after those dependencies and questions are addressed. This change
adds no schema, API, runtime behaviour or production tests.

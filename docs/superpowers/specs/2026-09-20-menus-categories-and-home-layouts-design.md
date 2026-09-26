# Menus, reusable categories and service home layouts

**Status:** product decisions agreed with the owner on 2026-09-20; implementation deferred.
Further owner decisions, 2026-09-25, are in §9, §10 and §11; a later section wins over an earlier one where they differ (§11, after the second outside review, wins over all).
**2026-09-25:** the owner lifted the wait on SQLite slice 2 and the dependency upgrades (the latter
are finished); the implementation plan is
[2026-09-25-menus-categories-home-layouts.md](../plans/2026-09-25-menus-categories-home-layouts.md).

**Related decisions, 2026-09-20:** the [service workflow spec](2026-09-20-service-ordering-and-billing-design.md)
adds a public/staff-only/not sold separately setting for standalone ordering. Menu membership
still controls what staff can order; one menu can serve staff and guests without exposing its
staff-only products to guest ordering. Its snapshot and filtering integration remains to be planned.

You should be able to assemble menus from your existing products and categories, adjust prices,
and arrange the products staff need most often without maintaining several copies of the same
catalogue. Publishing gives you control over when those shared edits reach each live menu.

The model is one shared, editable catalogue with independently published menus. A published menu
is an immutable snapshot. Availability remains live alongside that snapshot.

This document specifies intended behaviour, not features verified in the running application.
Do not begin implementation until the PostgreSQL-to-SQLite work, the dependency upgrades, and the
changes making variants and extras into products have landed. Reconcile this design with those
landed contracts before writing an implementation plan. The owner explicitly wants to continue
specifying other work during that wait.

## 1. Start with shared categories

You create Drinks once and include it in Lunch Menu and Dinner Menu. Drinks contains Lemonade,
Sparkling water and a nested Beer category. Adding a product to Drinks updates the editable
contents of both menus. It leaves both published menus unchanged.

When Lunch Menu is ready, you preview and publish its complete current contents. Dinner Menu
continues serving its previous snapshot and shows that it has unpublished changes. You choose
when to publish Dinner Menu independently.

If you want different contents for lunch, duplicate Drinks and replace it in Lunch Menu. The new
category has an independent immediate member list, while its products and nested categories
remain references to the same objects.

## 2. A category is an ordered collection

A category has a required internal name, optional translated customer-facing names, an optional
image and colour, and an optional organisational group. Internal names distinguish categories
such as Lunch drinks and Evening drinks even when both display as Drinks to customers. Customer
names fall back from the requested language to the venue's default content language, then to the
internal name.

Each member references either a product or another category and has a position in the containing
list. Products can belong to several categories. Categories can appear inside several categories
and menus, so there is no single parent field or canonical path.

Including a category includes its nested contents. This traversal does not create additional
direct memberships: a product inside Beer is reachable through Drinks without being a directly
assigned member of Drinks.

The same object cannot appear twice directly in one member list. A product may nevertheless appear
through different paths. Lemonade can appear under both Favourites and Drinks on the same menu;
both placements remain visible. Search and the menu price table each show that product once.

Order belongs to each containing list. Drinks can be first on Lunch Menu and last on Dinner Menu,
while the order inside the shared Drinks category is the same in both editable menus. You can
drag members to reorder them, with an equivalent keyboard-accessible move action.

Circular containment is forbidden, including self-containment and indirect cycles. The picker
excludes invalid choices, and the write path enforces the same rule under concurrent edits.
The SQLite implementation mechanism is deliberately left to the later plan.

### Groups organise categories without giving them different behaviour

Each category can belong to one optional, user-defined group, such as Reporting, Menus or Kitchen.
You choose a group through a searchable picker and can create one there. Leaving it empty is valid.
Groups are separate data, rather than prefixes embedded in category names.

A group never restricts where you can use a category. A category filed under Reporting can appear
on a menu. Moving it to Kitchen does not assign a station or change reporting. Routing and reporting
assignments remain explicit concerns; menu nesting must not introduce extra tickets or count a sale
again.

The category library supports filtering by group and by actual use. “Group: Menus” means where
you filed the category; “Used in a menu” means it is included directly or through nested categories.

### Copy membership when you want independent collections

Duplicate category copies its details and ordered immediate member list into a new category,
with a chance to choose its internal name and deselect members. It does not copy the products or
recursively duplicate nested categories.

For example, duplicating Lunch leaves both copies referencing Drinks. Removing Drinks from the
copy does not affect Lunch. Editing Drinks still affects both working collections. Duplicate
Drinks separately when its contents should diverge.

You can also select all, almost all or some products in a category and add them to another category,
creating the destination in that flow if needed. This is a one-time membership copy, with no
ongoing synchronisation between the source and destination. Existing destination membership is
not duplicated. Selection must make direct members and products reached through nested categories
distinguishable; the exact bulk-selection presentation remains for the interaction design.

## 3. Menus compose categories and products

A menu has an ordered top-level list of category and product references. You can create and edit
categories while assembling it, without leaving the menu editor. Products can appear at the top
level as well as within categories.

Shared edits update every working menu that uses the category. The editor shows where else it is
used so you can decide whether to edit it or duplicate it. A contextual breadcrumb describes the
path you followed; “Used in” replaces the idea that each category has one parent.

“Remove from this list” removes only that membership. Deleting a category is a separate library
operation whose consequences must be shown. Neither operation rewrites a published snapshot.
Source deletion, reference retention and deletion confirmation details need reconciliation with
the post-migration storage model before implementation.

### Prices belong to the menu and product, not to a category membership

A product's price is the default wherever it appears. A menu can override that price for a product
independently of the path by which it reaches the menu.

| Product | Appears under in Lunch Menu | Product price | Menu override | Effective price |
| --- | --- | --- | --- | --- |
| Lemonade | Favourites, Drinks | €3.00 | €2.50 | €2.50 |
| Burger | Favourites | €12.00 | None | €12.00 |
| Sparkling water | Drinks | €2.00 | None | €2.00 |

Lemonade costs €2.50 at both of its Lunch Menu placements. Dinner Menu without an override uses
the product price. Adding a new product to Drinks makes it appear in both working menus, using its
product price unless that menu has an override.

An absent override follows future product-price changes in the working menu. An explicit override
stays fixed until changed or cleared, even when its value equals the product price. “Use product
price” clears the override. Published effective prices change only when that menu is republished.

The Prices tab is a flat, searchable list with one row per distinct product, columns as above, and
filters for category and overridden prices. Placements describe this menu only, including nested
paths and a Top level label. Categories unrelated to the menu do not appear in that column.
*(2026-09-26, owner decisions: each product's Active variants are rows under it, a product sold
only as its variants shows price ranges, and "Variant overrides" when only its variants have menu
prices, and the manager chooses which columns are shown, including #541's struck-out single price
column, hidden by default.)*

## 4. Publish the menu as one complete snapshot

Saving changes the shared working catalogue or the menu's working configuration. It does not publish
anything. Categories and products have no independent publish operation in this workflow.

Publishing captures the whole menu's current structure, member order, display content, effective
prices and home layouts. Published rendering and pricing must use that captured content rather
than resolving editable source values on each read. Image references must keep the corresponding
published image available. Exact product fields, including variants, extras, options and tax
inputs, must be specified against their landed contracts before implementation.

A publish makes one complete version live. It must not expose a mixture of old and new content,
or capture an internally inconsistent mix of concurrent source edits. A failed publish leaves
the previous version live. The implementation plan must define how the preview and publish
handle edits made after the preview was opened.

You cannot publish just one category's changes. Republishing takes the latest source content for
the whole menu. Preview shows the proposed result and the changes from the live version before
you publish.

The menu list and editor distinguish:

- Unpublished: the menu has no live version.
- Published and current: its working content matches the live version.
- Published with unpublished changes: the working content would produce a different version.

Show the live version and publication time separately from pending changes. Explain those changes
in terms such as “Lemonade added under Drinks” or “Burger price changed from €12 to €13”.
There is one shared working catalogue, not a private category draft for each menu.

Change detection follows what publishing would change, including nested dependencies. Renaming an
organisational group does not by itself make a menu out of date. *(2026-09-25: groups are dropped, §10.1.)* A product-price edit does not
change an overridden effective price. A relevant category or product edit flags every affected menu,
but publishing one clears only that menu's difference.

Availability is live operational state alongside the immutable snapshot. Marking a published
product unavailable takes effect without republishing; restoring availability does not change its
saved name, price or placement. Its scope, such as venue-wide versus menu-specific, and the
presentation of unavailable products remain integration decisions. Availability must be respected
consistently in browsing, search, home tiles and new ordering.

Publishing or editing source data must not rewrite facts already recorded on orders or receipts.
The precise handling of an in-progress basket across publication is an open integration question,
not permission to reprice it silently.

## 5. Home layouts help staff order quickly

The handheld and till menu home page presents search first, an ordered shortcut grid next, and
the full menu structure below it. Search covers the whole published menu, regardless of the
category being viewed, and returns each product once. The ordering interaction, published price
and availability agree across search, home and category browsing.

The grid can contain products and categories. Product tiles open the product's ordering interaction;
category tiles open that category. Their appearance must make the two actions distinguishable.
You choose and order the contents manually. Automatic popularity-based rearrangement is outside
this design so buttons remain in predictable positions during service.

### A home layout is a menu-owned category

Use the category membership model and editing interaction for the home grid. Its category belongs
to one menu and is hidden from the shared category library and ordinary menu structure. “Hidden”
describes its management role; its contents are visible on the home page.

Home members reference products or ordinary categories already reachable through that menu's normal
structure. They do not add catalogue memberships, menu offers or prices. Removing a home member
removes only the shortcut. A home category cannot be nested into the normal menu/category structure
or reused by another menu. The treatment of a shortcut whose target leaves the working menu must
be settled before implementation.

Each menu starts with one automatically created default home layout. You can add named alternatives
or duplicate a layout, then edit their immediate member lists independently. “Table service” and
“Counter” describe workflows; layouts are not tied to hardware types.

The device configuration selects a home layout for the menu, using the menu's default when no
alternative is selected. All layouts use the same menu, prices, availability and full-menu search.
The published version includes the layouts, their contents and ordering, and the default choice.

Handheld and till rendering can use different column counts while preserving item order. Preview
both sizes. A venue can keep one shared layout or choose alternatives for different jobs without
maintaining separate menus merely to change shortcuts.

## 6. The management screens

The menu editor has four views:

| View | What you do |
| --- | --- |
| Structure | Add products and categories, edit categories in place, duplicate them, and reorder members. |
| Prices | Review each distinct product and set or clear its menu price override. |
| Home page | Manage the default and alternative layouts, arrange tiles, and preview device sizes. |
| Preview | Review the proposed menu and its differences from the published version, then publish. |

The standalone Categories screen remains the reusable library: organise groups, find usages,
edit shared collections, copy memberships and manage category deletion. A category can occur in
several branches of a displayed hierarchy; those occurrences refer to the same category.

Use the [design system](../../developers/design-system.md), including shared forms, tabs, tokens,
touch targets and keyboard navigation. Reordering must work without dragging. Shared-content
editing must show its wider use, while publishing clearly names the single menu going live.
Empty, loading and error states must retain the distinction between saved source edits and a
successful publication.

## 7. Acceptance examples for the later build

These are required future checks, not tests run as part of writing this specification.

1. Drinks appears in two menus and inside another category. Adding Lemonade changes all applicable
   working views, but none of their published views until the respective menu is published.
2. Direct, indirect and concurrent attempts to create a category cycle are rejected. Reusing the
   same child under independent parents succeeds.
3. Reordering Drinks on Lunch Menu leaves its Dinner Menu position unchanged. Reordering inside
   Drinks changes both working menus, with each published order retained until republishing.
4. Duplicate Lunch and remove its Drinks member: the original retains Drinks. Change Drinks itself:
   both copies containing it see the working change. Products are never duplicated by these actions.
5. Lemonade appears under Favourites and Drinks, once in search, and once in Prices. Its menu
   override applies at both placements. Directly adding it twice to Drinks is refused.
6. Clear a price override and change the product price: the working effective price follows it.
   Keep an explicit override equal to the former product price: it remains fixed. Both live prices
   stay unchanged until publication.
7. Publish Lunch while Dinner has pending shared changes. Lunch adopts the complete reviewed
   version; Dinner retains its old version and pending-change indication. Failure during publication
   leaves the previous complete version live.
8. *(2026-09-25: groups are dropped, §10.1; read "a reporting-category or label edit".)* Group-only edits do not flag a content change. Relevant nested content and home-layout edits do.
   Availability changes take effect without altering the published snapshot.
9. A default home layout works at handheld and till widths in the same item order. A device can use
   an alternative for the same menu without changing prices, search or the full menu underneath.
10. The rendered editor and service views work in both themes and at handheld and till sizes.
    Keyboard reordering and non-colour distinctions between product and category tiles are exercised.

## 8. Resume after the foundations land

Implementation is explicitly deferred until all three workstreams named at the top have landed.
The [SQLite storage design](2026-09-16-sqlite-slice1-storage-swap-design.md) is background for that
dependency, not a source of schema choices for this spec.

At that point, inspect the landed code and resolve these integration details before planning.
The owner settled several of them on 2026-09-25; the answers are in §9, and the list below is
left as it was written:

- Which variant products, extras and option selections enter the menu's sellable set and snapshot,
  how menu overrides apply to those products, and how reporting and station assignments remain
  explicit when categories are reused. Do not revive separate product-like variant or extra types.
- Which operational fields remain live, the scope of availability, and what happens to open baskets
  and held orders when a new version is published.
- How source deletion and media retention preserve live snapshots; whether menu price overrides
  survive removal and later re-addition of a product.
- How invalid home shortcuts are resolved and how device selections behave when a selected layout
  is removed or renamed, including devices switching between menus.
- How preview detects concurrent source edits, publication stays consistent, devices adopt a whole
  new version, and content comparison identifies affected menus without false change flags.

The product decisions above replace the single-parent category and separate menu-section direction
for this future work. *(2026-09-25: §10.1 reverses this for REPORTING — reporting categories keep a single parent; the
reusable lists above are menu sections.)* Earlier specifications remain historical records. The
[category integration guide](../../developers/product-categories.md) describes the existing
implementation and must be audited when implementation begins.

This spec does not choose tables, migrations, API shapes or tasks against the changing storage and
product code. Automatic popularity ranking, inventory control, scheduled publication and a rollback
interface are outside its agreed scope. No implementation or test changes accompany this document.

## 9. Owner decisions, 2026-09-25

The owner settled these §8 questions before planning began. Each "today" below describes the code
on `main` at `db23651f7`.

**Availability is per product, for the whole venue.** Marking a product unavailable makes it
unavailable on every menu at once; how an unavailable product is presented stays with the plan.
There is no per-menu availability in this work. Today this is the product's own `available` flag
(`packages/db/src/schema/catalogue.ts`); the plan keeps that as the live field beside the
published snapshot.

**Publishing never changes what is already in a basket or a held order.** *(2026-09-25, §11.2: for an UNSAVED basket this is reversed — the basket follows the live menu with a confirmation; a saved order keeps its facts.)* A line already in an open
basket, or in a held order sent to the kitchen but not yet paid, keeps the name, price and choices
it was added with when a new version is published. A line added after the device has picked up the
new version comes from the new version. The same rule covers baskets and held orders.

**A product added back to a menu starts fresh.** Removing a product from a menu forgets everything
that menu said about it: its menu price, its variant overrides and its extras overrides. Adding it
again later starts from the product's own values, as if it had never been on that menu.

**A shortcut whose target has gone shows "not found" and refreshes the home screen.** When staff
tap a home tile whose product or category is no longer in the version the device should be showing,
the device says the item was not found and reloads the home screen. How the editor and preview
treat a shortcut whose target has left the working menu is not decided here and stays with the plan.

**A device whose home layout is deleted falls back to the menu's default layout, with a warning
first.** The device shows a warning notification, then switches to that menu's default layout.
What a rename does, and what happens when a device switches to another menu, stay with the plan.

**Today's per-menu overrides stay.** A menu can still change, for each product it offers, a
variant's price or switch that variant off there (`menu_item_variant_overrides`), which extras
lists it offers and each extra's price and availability there (`menu_item_extra_lists`,
`menu_item_extra_items`), and whether the product is switched on for that menu (`menu_items`'s
`active`). They belong to the menu and the product, like the menu price in §3, not to the path by
which the product reaches the menu, and publishing captures them with the rest of the menu.

Still open for the plan: which variant products, extras and option selections enter the sellable
set and snapshot; how reporting and station assignments stay explicit when categories are reused;
how the service spec's public, staff-only and not-sold-separately setting enters the snapshot and
its filtering; how source deletion and media retention keep live snapshots whole; and the
concurrency, publication and device-adoption questions in §8's last item.

## 10. Owner decisions after outside review, 2026-09-25

The implementation plan written earlier on 2026-09-25 was put to outside review at the owner's
request. The review brief, the discussion before it and the review's consolidated feedback are
summarised in `docs/handoffs/2026-09-25-menus-categories-model-review-brief.md`, which is not
committed. The owner then decided what follows. **Where this section disagrees with §1–§9, this
section wins.**

### 10.1 Three separate relationships

Menus, reporting and the kitchen were being asked to share one "category". They now use three
separate relationships:

- **Reporting categories** form a strict tree. Each reporting category has at most one parent, and
  each product has at most one *main reporting category*. Reports roll up along this tree, so a
  parent's total is exactly the sum of its children. This is today's category model (a single
  parent, plus the product's primary category) with the rule made explicit. The rules for
  classifying a sale, and the category reports, are specified in
  `2026-09-25-sales-classification-and-category-reports-design.md`.
- **Menu sections** are what §1–§7 call "categories": ordered, reusable, nestable lists that
  menus and home layouts are built from, with no cycles. **Read "category" in §1–§7 as "section".**
  Sections are menu arrangement only. Adding, moving or removing a product or section on a menu
  never changes its reporting classification or its kitchen routing. A menu's top level and its home
  layouts remain lists the menu owns (§5). Sections are not recorded as classification on a sale.
  Instead, the sale line records which menu and menu version it was sold from (the sales
  classification spec, §3).
- **Labels** are flat tags. A product can carry any number of them, for example "Happy hour
  drinks" or "Alcoholic". They cannot nest, so they cannot form cycles, and any depth comes from the
  reporting tree. Labels slice reports and will feed kitchen routing rules (§10.5). They are
  specified with the sales classification.

The spec's organisational **groups** (§2, "Groups organise categories …") are dropped; the three
relationships above do the job groups were standing in for. A section and a label may share a name
("Happy hour drinks"), but they are separate things with separate membership.

### 10.2 Building sections without duplicate work

- A section's **Add products** flow can filter by reporting category, including everything below it
  in the tree, and select several products at once.
- It marks which products are already on this menu and which are already in this section, as two
  different marks.
- **Creating a product** offers an optional "Add to menus…" step, which places it in chosen
  sections. These are explicit placements. Like every other menu change, they become visible on a
  till only when that menu is published.
- There is **no automatic synchronisation** between reporting categories and sections for now. A
  later refinement could let a section remember a reporting-category filter and suggest newly
  created products that match it.

### 10.3 Open orders: a line's price never changes after it is added

This confirms §9's basket rule and extends it. An interim idea from the same day — to update unsent
lines to a newly published price, with a warning — was considered and **withdrawn by the owner**.

- **A line keeps the price and names it was given when it was added to an order**, whether the
  order is a till's unsaved basket, a held order or a tab, and whether or not the kitchen has it.
  *(2026-09-25, §11.2: an UNSAVED basket no longer keeps them — it is refreshed against a newly
  published version, with confirmation; the rule stands for every saved order.)*
  Publishing a new version never changes a line already in an order, and nothing re-prices it later.
  VAT is different: see §10.4.
- **Editing prices only what the edit adds.**
  - A line whose product (or variant) is changed is a new item, priced from the version the till is
    showing.
  - An extra added to a line is priced from that version.
  - Extras already on the line keep their price.
  - A note or an option carries no price.
- **Editing work the kitchen already has** (owner, 2026-09-25): an order can in principle be changed
  until the kitchen starts preparing it.
  - **Not yet sent to the kitchen:** edit freely. That covers a line in a held course not yet fired,
    a line recalled from the kitchen, a line with no preparation route (no kitchen work exists), and
    a parked counter order.
  - **Sent, and the kitchen has not started it:** the edit is allowed and is **never silent**. The
    kitchen receives a recall for the old line and a new ticket for the changed one, on its screen or
    as a printed slip. More of an item already sent goes to the kitchen as new work, never as a silent
    change to the ticket it already has.
  - **Started:** only a kitchen screen can report this. The edit is refused. Staff void the line, the
    kitchen gets a VOID notice, and they add a new line, so the waste is visible.
  - **A paper-only kitchen** never reports "started", so edits stay possible, always with the slip.
    Checking with the kitchen is up to the staff.
  - **The venue setting "Allow changes to items already sent to the kitchen"** is on by default. When
    it is off, an item already sent can only be voided (with its VOID notice) and re-added. *(Owner,
    2026-09-25, §11.5: the setting is for a PAPER-ONLY kitchen, which never reports "started", so a
    recall slip cannot be trusted any more than a change can — with the setting off the till offers
    neither Change nor Recall on a sent line, only Cancel. The void removes the price from the bill
    at once and prints the VOID slip; staff tell the kitchen directly. A line the kitchen had
    already made is added again, with a note, so it is billed.)*
  - Extras lines follow their dish.
- **Printing a pre-bill** (the bill before payment) never sends anything to the kitchen and never
  fires held food. There is no pre-bill in the product today (asesor Q21 and Q14 are open); this is
  the rule for when one is built.
- **Availability:** a line not yet sent whose product has become unavailable cannot be sent or paid
  for. Staff remove it, or replace it with something available. A sent line stays collectible
  however its product's availability changes, because the work is committed. Where the venue splits
  a bill, staff can pay the eligible lines and resolve the rest.
- *(2026-09-25: the grace window is withdrawn by §11.2 — there is no window and no expiry; a basket
  is refreshed whenever its menu is published again.)* **A basket older than the menu's grace window:** a till's unsaved basket names the menu version
  it was built from. If that version was replaced more than the grace window ago (the plan sets 12
  hours), the till reloads the menu, shows which lines changed price, and staff confirm before paying.
  That is the one case where a line's price changes, and it is shown, never silent.
- **Later, with inventory:** adding a line to an order will reserve stock. A line already in an
  order then stays payable even when the count reaches zero.

### 10.4 Each field has its own lifetime

No single "frozen" rule covers everything:

| Field | Lifetime |
| --- | --- |
| Gross price (dish, variant, extras) | Fixed when the line is added (§10.3). |
| Names on the line (staff, customer, kitchen) | Fixed when the line is added, as they are recorded today. |
| VAT | **Taken when the invoice record is issued** (§11.4 sharpens the 2026-09-25 "at payment" wording: issuance is at payment on most paths, at placing for invoice-first, and in the pricing pass before the provider is contacted for a card payment), from each product's current VAT class, for every line — walk-up, held order or tab. The customer pays the same gross price either way; only the VAT split, and so what is owed to the tax agency, follows the rate in force when the invoice is issued. Today a held order's lines are filed at the VAT stored when they were added (`priceStoredOrder`, `apps/server/src/working-order.ts`), so this is a change to the filing path. |
| Allergens and diet | *(Superseded 2026-09-25 by §11.1: they are part of the published snapshot, and a line records the published values it was added with.)* ~~Always current wherever they are shown~~. |
| Availability | Always current, refreshed by the till on its own (§11.1). It governs whether an unsent line can be sent or paid for (§10.3, §11.3). |
| Preparation destination | Decided by routing and recorded when the line is sent, as today (the ticket item's station). |

_2026-09-26: menus plan Task 7a built this rule (`priceStoredOrderForIssuance`,
`apps/server/src/working-order.ts`), so the VAT row's "Today" sentence describes the code before it._

Asesor question Q26 (`docs/compliance/asesor-questions.md`) asks the venue's tax adviser to confirm
that the rate in force when the invoice is issued is the right one, including across a legal rate
change while a table is open (§11.4 states the issuance moment per path).

### 10.5 Kitchen routing becomes ordered rules — a later spec

Routing will become an ordered, first-match list of rules. It is **not part of the menus work**,
and it gets its own spec. What that spec must contain:

- **Conditions:** a product, a reporting category (with everything below it), a label, the zone, and
  the service mode where required. Time-of-day and device conditions wait for a concrete workflow.
- **Outcome:** exactly one preparation station, or an explicit "no preparation", plus a clear
  default.
- **Safety:**
  - a product-by-zone preview;
  - warnings for rules that an earlier rule shadows;
  - validation of each destination;
  - a list of the products a change would reroute, shown before it is applied. A note in a category
    editor is not enough protection against rerouting tonight's orders.
- **Unchanged principles:** menu arrangement never alters routing, and the destination is recorded
  when the work is sent.
- **Separate concerns:** printer copies, and preparing one line at several stations. Check
  fixed-price set menus early, including components prepared at different stations.

### 10.6 What the first release leaves out

- **Category analysis stays out of the frozen daily close (the Z report).** It is its own report,
  with an option to print it alongside the close.
- Elasticsearch or any other cloud analytics design, automatic menu synchronisation (§10.2) and any
  classification cache all wait until they are needed.
- **Historical classification snapshots are kept from the start**, because what they record cannot
  be reconstructed later (the sales classification spec).

### 10.7 Acceptance examples added after outside review

These add to §7.

1. *(Superseded by §11.2: the basket is refreshed and confirmed, and the sale files €2.50 + €2.50.)* **A basket across a publish:** a Lemonade is added at €3.00, the menu is republished at €2.50,
   and a second Lemonade is added. ~~The sale files €3.00 + €2.50.~~
2. **Concurrent changes to one order:** two tills open the same held order, and each changes it and
   saves. The second save, made from a copy the first save has since changed, is refused as out of
   date, and that till reloads the order. Nothing is lost or re-priced silently, and no line either
   till did not touch is deleted or re-inserted.
3. **An edit to work the kitchen has** (done from the till's own Change action, §11.6)**:** a burger already sent is changed to "no onions" before the
   kitchen starts it. The kitchen gets a recall and a new ticket, and the price is unchanged. Once a
   kitchen screen marks it started, the edit is refused and staff must void and re-add. With the
   venue setting off, it is refused from the start.
4. **Held courses and a pre-bill** (when pre-bills exist): printing the bill while the mains are
   held neither fires the mains nor marks them sent.
5. **A partial payment:** a tab with one unsent line whose product became unavailable is split. The
   other lines are paid, and the unavailable line must be removed before its part can be paid.
6. **VAT at payment:** a held order's drink was added at 10%, and its VAT class is corrected to 21%
   before payment. The invoice files it at 21%, and the customer pays the same gross price.

## 11. Owner decisions after the second outside review, 2026-09-25

The revision-2 plan was put to outside review again, and the owner confirmed the decisions below.
**Where this section disagrees with §1–§10, this section wins.** The "today" facts come from
reading `main` at `9e7beee9d` on 2026-09-25 with each file named; they are reads, not
measurements, and the plan re-checks the ones it builds on.

### 11.1 A published menu snapshot, plus live availability

- **The snapshot holds everything a till shows and charges:** prices, names, structure, images,
  variants, extras and options, and the **allergens and diet** declared for each of them. A change
  to any of those reaches a till only when someone publishes that menu. This retires §10.4's row
  "Allergens and diet: always current wherever they are shown", and D6's list of live fields
  shrinks to availability alone. The owner manages the distinction between a recipe change and a
  correction to allergen information; the product builds no special handling for it.
- **A menu with changes not yet published shows "Unpublished changes"**, and its comparison page
  lists what publishing would change, **including changes inherited from a shared product or
  section** (a product's allergens or price, a section another menu also uses). The comparison
  names the source of each change, so an owner can see that a product edit is what flagged three
  menus.
- **Availability is live and independent of publication.** Marking a product sold out reaches
  every till without a publish and flags no menu. **A till refreshes availability even when the
  published version has not changed.** Today a till loads offers at login, on a counter zone
  change and when a table is opened, and never again (`apps/till/src/till-app.ts:632, 902, 1481`);
  the plan adds the refresh (D11).
- **VAT and reporting classification are not menu content.** Neither is in the snapshot, neither is
  read from it, and a change to either flags no menu. VAT is resolved when the invoice record is
  issued (§11.4) and the classification is recorded at the same moment (the sales classification
  spec §3).

### 11.2 An unsaved basket follows the live menu; a saved order keeps its facts

**Repricing applies only to a browser-only, unsaved basket.** This replaces §10.3's first bullet
for baskets, and §9's "publishing never changes what is already in a basket", and it removes the
grace window (§10.3's "a basket older than the menu's grace window") entirely: there is no
12-hour window, no expiry and no `menu.version_expired`.

When a menu the basket was built from is published again:

- the till refreshes the basket against the new version;
- it shows every line whose price changed ("Lemonade €3.00 → €2.50") and requires confirmation
  before staff go on;
- a line whose product, variant or extras pick is no longer offered, or is now unavailable, must be
  resolved (removed or replaced) before the basket can be paid;
- **when nothing relevant to the basket changed, staff are not interrupted**: the till adopts the
  new version silently.

The server prices an unsaved basket from the live version only. The till tells the server which
version it priced against, and a mismatch is refused, never silently re-priced (D9 in the plan).

**A saved order — a held order, a parked counter order, a tab — keeps its recorded prices, names,
allergens and diet, whether or not its lines have been sent.** Publishing never changes them.
Editing prices only what the edit adds: a new line, or an extra added to a line. Changing a line's
product or variant makes it a new item, priced from the version the till is showing. This keeps
§10.3's rules for saved orders.

**Acceptance example §10.7(1) is superseded:** a Lemonade added at €3.00, the menu republished at
€2.50, and a second Lemonade added. The till shows "Lemonade €3.00 → €2.50" for the first line and
asks for confirmation; after it, the sale files €2.50 + €2.50. It never files €3.00 + €2.50.

### 11.3 Availability governs fulfilment, and "sent" is recorded on the line

- An unsent line whose product became unavailable **cannot be sent or paid for**. Staff remove it
  or replace it. The server enforces this at send and at pay, not only the till.
- A sent line **stays payable** however its product's availability changes: the work, or the
  drink, is committed.
- **"Sent" is a fact recorded on the order line itself**, not derived from the kitchen ticket.
  Today nothing on `working_order_lines` says a line was sent: only the ticket row's `fired_at`
  does (`packages/db/src/schema/ticket-items.ts:50-51`), a line with a "no preparation" route gets
  no ticket row at all (`apps/server/src/working-order.ts:883, 911`), and a partial bill split
  creates a new line row with no ticket (`carveOffLines`, `working-order.ts:1848-1873`). So a
  split-off portion of a sent, now-unavailable dish would be unpayable, and a served bottle with
  no route would look unsent. The rule:
  - a line is marked sent when it is fired to a station, and a line with a "no preparation" route is
    marked sent at the same moment its order's other lines would be fired — when a tab round is
    sent, an order is placed, or an order is sent to preparation. A parked counter order marks
    nothing;
  - a split or transfer copies the mark to the new row, and copies the line's course, note and
    served state with it; a partial split of a line the kitchen has STARTED is refused, because the
    split-off row would have no kitchen work of its own to guard it;
    **(2026-09-26, the owner's answer, overturning the refusal:** the split-off part gets its own
    kitchen ticket row, copied from the original, and the original's quantity drops by the part
    moved; a started line may be split, while edits of it stay refused; the split tells the kitchen
    nothing.)
  - a line with no preparation route under a held course is marked sent when that course fires,
    not before;
  - "sent" governs payment; whether a line can be SENT reads the kitchen state, so a recalled line
    whose product has gone unavailable is refused when staff send it again;
  - a sent line with no preparation route is payable, and it is also freely editable (no kitchen
    work exists to correct); the two properties are separate.

### 11.4 VAT and classification are taken when the invoice record is issued

§10.4 said "at payment". The precise rule is **when the invoice record is issued**, which is the
pricing pass that produces the filed figures. That pass resolves each line's VAT rate from its
product's current VAT class and records the reporting classification, once per sale. The paths
today (`apps/server/src/till-sale.ts`, `working-order.ts`):

| Path | When the record is issued | What the rule means there |
| --- | --- | --- |
| Cash or manual card (`POST /api/sales`) | At payment | Resolve at payment. |
| Held order, tab or split check paid the same way | At payment | Resolve at payment, for every line however old. |
| Integrated card (`POST /api/pay`) | The order is priced BEFORE the provider is contacted (P1, `till-sale.ts:700-709`) and filed from that pricing after capture (P3, `:748-757`) | Resolve in P1; P3 files P1's figures unchanged. The amount charged is the gross total, which VAT does not change. |
| Card recovery (a captured payment with no sale) | A fresh pricing pass at recovery (`finalizeRecovery`, `:900`) | That pass is the issuance: resolve then. |
| Invoice-first (`POST /api/working-orders/:id/place`) | At PLACING, before payment (`placeOrder`, `working-order.ts:2529-2547`) | Resolve at placing. Collecting the payment later reads the issued sale's total and never re-prices (`collectOrder`, `till-sale.ts:1225-1279`). |
| Ticket-then-pay collect (`POST /api/working-orders/:id/collect`) | At collect | Resolve at collect. |

- **The resolved rate is written back onto the stored line before the record is filed.** A reprint
  or replay rebuilds receipt lines from the stored lines, not from `sale_lines`
  (`readSettledTicket`, `till-sale.ts:434-436`), so a rate resolved only in memory would print a
  receipt that disagrees with the filed sale.
- **Collection and replay of an issued sale retain its recorded facts.** Nothing re-resolves VAT or
  classification after issuance.
- **Prices stop changing when the order is committed, and a payment never overlaps an edit**
  (owner, 2026-09-25, correcting an earlier draft that described a lock): a line's price is locked
  when the waiter adds it (§11.2, saved orders); an unsaved basket is refreshed against a newly
  published version with a warning the waiter must acknowledge (§11.2); and **from the moment the
  bill is printed, the order is sent or placed, or Pay is pressed, those prices no longer change**
  — no refresh is offered after that point, and the till offers no edits on an order it is paying.
  There is no table lock and nothing waits on a card terminal: pressing Pay starts a payment on
  what the order holds at that moment. The one residual case is a publish landing in the seconds
  between the waiter's last look and the Pay press: the server refuses the pay request before any
  charge (`menu.version_changed`), and the till shows the change for acknowledgement, so the
  amount charged is always one the waiter saw. The server keeps one guard so that a SECOND device
  cannot change the order while the first is paying it — a line write on an order whose card
  payment is between pricing and filing is refused (`order.payment_in_flight`, D22) — and the
  payment's own outcome, settle or fail, releases it within the provider's own timeout. It
  enforces "no overlap"; it is not a step in the workflow.
- Asesor question Q26 asks the adviser to confirm the rule, and its wording now says "when the
  invoice is issued" and names the invoice-first case.

_2026-09-26: as built, the write-back happens only while the order is open, because
`working_order_lines_require_open_parent_update` refuses an update of a line whose order is not
open. An order issued while placed keeps its stored rate on the line, and the filed record
carries the issued rate; a rebuilt ticket takes its VAT breakdown from the filed record
(`readSettledTicket`, `apps/server/src/till-sale.ts`)._

### 11.5 Kitchen screens receive corrections, not only printers

Today a recall or a void produces a printed slip only where the station has an active printer
(`enqueueCorrectionSlips`, `apps/server/src/kitchen-print.ts:354-356, 380-381`), and it writes
nothing a kitchen screen can read. A void deletes the line and its ticket row
(`voidTabLine`, `working-order.ts:1211-1218`), so on a kitchen screen the item simply vanishes at
its next reload, whether or not the cook had started it. The kitchen screen is the till app on a
device enrolled as `kds` (`apps/till/src/screens/till-station-screen.ts`), and it reloads only when
opened or after its own actions.

- **Every correction is recorded as a kitchen notice in the same transaction**, whether or not a
  printer exists: RECALLED, VOID, or CHANGED (an edit to a sent, not-started line), with the line as
  it was, the quantity affected and the station. A printer, where mapped, prints the slip as today.
- **A kitchen screen shows its station's notices until a cook acknowledges each one.** A VOID of an
  item already started stays on the screen as a notice marked "started", so the waste is visible.
- **Partial quantities are corrections too:** dropping 2 to 1 is a VOID of 1, and the notice says so.
- **With the venue setting off (a paper-only kitchen)** the only correction is a void, because
  nothing reports whether the kitchen has started: no Change, no Recall. The void takes the line
  off the bill immediately; a line the kitchen made anyway is re-added with a note to bill it.
  Held courses on such a kitchen are held by not sending them, never by recalling.
- **The kitchen screen refreshes on its own** (a poll, D11's interval), so a notice appears without
  a cook touching the screen.

_2026-09-26, the owner's answer to menus Task 7b item 4 (lane C questions): moving sent work to
another table is allowed and is a correction too, a fourth kind, MOVED. A line transfer (whole or
part), an unjoin, moving a tab, merging tabs and moving a tab's lines each record a MOVED notice in
the same transaction, naming the table the work now belongs to, and print a MOVED slip where the
station has a printer. The table compared is the one a correction slip names for the order, read
before the move and after it; a split onto a check keeps it and records nothing, and held work
records nothing, because the kitchen has not been sent it. An unjoin that takes sent work always
records one, because a joined tab's slips name its lowest-id table, which need not be the one its
tickets printed._

### 11.6 Staff edit a sent line from the till, not through an API call

The table order screen offers Send, Recall and Cancel per line and nothing that changes a sent
line (`till-table-order-screen.ts:568-609`). §10.7's example 3 ("a burger already sent is changed to
'no onions'") therefore needs a staff-facing interaction, and the plan adds one: a **Change** action
on a sent, not-started line that opens the line's note, options and extras for editing and saves
through a per-line route applying §10.3's rules. The acceptance example is met by a browser test
of that interaction, not by a direct API call.

### 11.7 Acceptance examples added after the second review

These add to §7 and §10.7; §10.7(1) is replaced by §11.2's version.

1. **Nothing relevant changed:** Lunch is republished with a Dinner-only section renamed. A till
   with two Lunch lines in its basket adopts the new version with no dialog.
2. **A sold-out dish reaches the tills without a publish:** Burger is marked unavailable on the
   dashboard. Within the refresh interval every signed-in till greys it, and Lunch still shows
   "Published" with no unpublished changes. The server refuses a new line for it meanwhile.
3. **An allergen change waits for publication:** sulphites are added to Lemonade after Lunch was
   published. The till keeps showing the published allergens; Lunch shows "Unpublished changes",
   and its comparison page says "Lemonade: allergens (shared product)". After publishing, the till
   shows sulphites.
4. **A split portion of a sent, sold-out dish is payable:** a tab has two fired Burgers; Burger
   is then marked unavailable; one Burger is split to a new check. Both checks pay.
5. **A served bottle with no route:** a tab round with a bottled beer is sent; the beer is marked
   unavailable; the tab pays, beer included.
6. **A void on a kitchen screen:** a cook has started a Burger; the waiter cancels it. The kitchen
   screen shows "VOID — Burger ×1 — started" until the cook acknowledges it; where the station has a
   printer, a VOID slip prints too.
7. **The same extra from two lists:** Extra cheese is offered by "Toppings" at €1.00 and "Premium
   toppings" at €1.50. A tab line took it from Premium toppings. A later edit that changes the note
   keeps the cheese at €1.50. If Premium toppings then stops offering cheese, the line still keeps
   €1.50, and only a NEW pick prices from the list it is picked from.
8. **Duplicate and use the copy here keeps the menu's prices:** Lunch reaches Lemonade only through
   Drinks, with a Lunch price override. "Duplicate Drinks and use the copy here" leaves the override
   in place.
9. **A second device cannot change an order another device is paying:** while a card payment for
   a tab is between pricing and filing on one till, a new round for that tab from another till is
   refused, and succeeds once the payment settles or fails. The paying till itself offers no edit.
10. **Prices are final from Pay:** a basket's menu is republished after the waiter pressed Pay on a
    cash sale; the sale files at the prices the waiter saw.
11. **A paper-only kitchen (the setting off):** a sent Burger's line offers neither Change nor
    Recall, only Cancel. Cancelling prints a VOID slip and removes the Burger from the bill at
    once. If the kitchen says it was already made, the waiter adds a Burger again with the note
    "already made", which bills it and prints a ticket marked so.

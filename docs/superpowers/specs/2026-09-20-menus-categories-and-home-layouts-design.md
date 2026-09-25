# Menus, reusable categories and service home layouts

**Status:** product decisions agreed with the owner on 2026-09-20; implementation deferred.
Further owner decisions, 2026-09-25, are in §9.
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
organisational group does not by itself make a menu out of date. A product-price edit does not
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
8. Group-only edits do not flag a content change. Relevant nested content and home-layout edits do.
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
for this future work. Earlier specifications remain historical records. The
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

**Publishing never changes what is already in a basket or a held order.** A line already in an open
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

# Menus, reusable sections and home layouts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a venue build menus out of shared, ordered, nestable menu sections. Each menu gets its
own price overrides and a published version that the tills sell from, until the owner publishes the
menu again. Handhelds and tills get a home page: search, a shortcut grid chosen per device, and the
full menu below. A line added to a saved order keeps its price from then on; an unsaved basket
follows the live menu, with staff confirming any change that touches it.

**Architecture:**
- **One ordered membership table** (`section_members`) holds every menu list: a section's members,
  a menu's top level and each home layout. A member is a product or a section. A menu's top level
  and its home layouts are sections the menu owns and nothing else can use.
- **Menu arrangement only.** Sections never feed reporting or kitchen routing. Reporting categories
  are a separate strict tree that this plan leaves alone; the sales classification plan changes
  them.
- **Publishing** freezes one self-contained JSON document per menu version.
- **Tills** read that document, with ONE live overlay read from the current rows: availability.
  Allergens, diet, names and prices are in the document (spec §11.1). VAT class and reporting
  classification are not menu content at all: they are resolved when the invoice record is issued
  (Task 7a, the classification plan).
- **Change detection:** a menu is flagged as changed by comparing a hash of the document it would
  publish now with the live version's hash.
**Tech Stack:** TypeScript, Drizzle ORM on SQLite (`drizzle-orm/sqlite-core`, `node:sqlite`), Hono
routes, Lit web components (dashboard, venue-service dashboard, till), Vitest (`useVenueDb` real
SQLite databases; real Chromium for the front-ends).

**Spec:** `docs/superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md`. **Read
§11 first** (the owner's decisions after the second outside review, 2026-09-25): it wins over
everything earlier. Then §10, then §9, then §1–§8, **reading "category" in §1–§7 as "section"** (§10.1). The sales
classification spec (`2026-09-25-sales-classification-and-category-reports-design.md`) is the other
half of §10's split, with its own plan; this plan only records the menu and version provenance it
needs (Task 7). The
service spec (`2026-09-20-service-ordering-and-billing-design.md`) is background only; its
public, staff-only and not-sold-separately setting (§9 there) is out of scope here.

**Prerequisites (owner, 2026-09-25):** the dependency upgrades are finished and variants and extras
as products have landed (#480, #556). The owner decided this work does NOT wait for SQLite slice 2.
Slice 2 is still landing in lane A (tasks A23–A26), and it touches backup, restore and boot files,
not the catalogue. If you meet one of its files, the §2 overlap rule below applies.

**Revision history.** First written 2026-09-25 from three read-only maps of `main` at `9f14900ab`
(the catalogue model, the till and sale path, the dashboard screens). Every "today" fact below comes
from those reads plus the planner's own greps. It is a claim about `main` at that commit, not a
measurement. Task 1 re-checks the ones it depends on before building.
**Revision 2, 2026-09-25, after outside review and the owner's decisions (spec §10):**
- menu lists become SECTIONS in their own tables, and reporting categories and `product_categories`
  are left untouched (Tasks 1–2 rewritten, other tasks renamed; D1–D4 and D15 rewritten);
- a line's price never changes after it is added (D9 reinstated, D10 rewritten, Task 7);
- a sent line is never replaced or silently expanded (D10, Task 7);
- the section "Add products" flow and the product editor's "Add to menus…" step are added (Tasks 2
  and 4);
- VAT's lifetime is stated (D6, and asesor question Q26).
- The first review's measured findings are kept wherever they still apply. Task 1's category
  migration recipe and its upgrade failure are GONE, because Task 1 no longer changes
  `category_details`.
**Revision 3, 2026-09-25, after the second outside review (spec §11):**
- allergens and diet move INTO the published document; the live overlay is availability alone
  (D6);
- an UNSAVED basket follows the live version, refreshed with a confirmation, and the 12-hour grace
  window and `menu.version_expired` are gone (D9, Task 7); saved orders keep their facts (D10);
- the till refreshes availability on its own, independently of the version (D11, Task 7);
- a child extras line records the list it came from (D10, Task 7b);
- "sent" is recorded on the line and survives a split (D10, Task 7b);
- corrections reach kitchen screens as notices, not only printers (D10, Tasks 7b and 7c);
- staff change a sent line from the till's own Change action (new Task 7c);
- "Duplicate and use the copy here" is one transaction (D23, Tasks 1 and 4);
- VAT is resolved when the record is issued, on every filing path, and written back to the line
  (Task 7a);
- edits are refused while a card payment is in flight on the order (D22, Task 7b).
Reviewed the same day by a fresh-context seat that ran experiments in a throwaway checkout at
`9c8bcfa90`: it generated Task 1's and Task 3's migrations, applied them to fresh and to
`main`-migrated databases, tried the new CHECK and unique indexes on `node:sqlite`, and counted the
prepared queries on the line-context path. It found five blockers — the one-generation schema,
the upgrade failing on every venue, extras' VAT and allergens frozen, the golden-gate file's menu
fixture, and the cross-package offer type — and fifteen smaller findings. All are folded in: D5,
D6, D9, D10, D11, D14 and D21, Task 1 Step 4, and Tasks 3, 6, 7, 8 and 9.

---

## What the code is today (read before Task 1)

- **A menu is a `catalogues` row** (`packages/db/src/schema/catalogue.ts:14`). Code and routes call it
  a menu (`menu_id` references `catalogues.id`; routes are `/management-api/catalogues/:id/...`).
  `catalogues.version` exists and nothing increments it.
- **Categories today:**
  - Core `categories` (`catalogue.ts:25`): `id`, a translated `name` map (NOT NULL), `station_id`.
  - Catalogue-owned `category_details` (`packages/catalogue/src/schema/categories.ts:4`): ONE
    `parent_id`, `image`, `color`.
  - `product_categories`: unordered many-to-many membership.
  - `products.category_id`: the product's reporting ("primary") category, which must be one of its
    memberships (`replaceProductCategories`, `packages/catalogue/src/categories.ts:240`).
  - Cycle check: `validateParent` (`categories.ts:75-82`).
  - Deleting a category is a hard delete that moves its children up to its parent
    (`deleteCategory`, `categories.ts:156`).
- **Menus today are sections plus items:**
  - `menu_sections` (menu-owned headings).
  - `menu_items`: one row per (menu, product), unique `menu_items_menu_product_key`, with
    `section_id`, a nullable `gross_price`, `display_order` and `active`.
  - `active=false` is how "remove from menu" works (`deactivateMenuItem`, `operations.ts:417`), and
    `createMenuItem`'s upsert brings the old row back: its price comes from the new request, but
    the variant and extras override rows survive (`operations.ts:370-380`). `updateMenuItem` matches
    active rows only (`:395`).
  - Rows that hang off a menu item:
    - `menu_item_variant_overrides` (cascade; per-variant price and `offered`);
    - `menu_item_extra_lists` and `menu_item_extra_items` (cascade; per-offer extras). These have
      **no HTTP route and no screen**; only `apps/server/src/testing/zone-offers.ts:90` calls
      `setMenuItemExtraLists`.
  - `working_line_contexts.menu_item_id` references `menu_items` with **no delete rule**, so a
    menu-item row referenced by an order line cannot be deleted.
  - No function reorders or deletes a section.
- **The menu editor is in the venue-service module**, the Menus tab of
  `dashboard-venue-operations-screen` (`packages/venue-service/src/dashboard/venue-operations-screen.ts:558-693`,
  offer editor `:947-1143`, per-variant overrides `:854-1027`, client `client.ts:140-330`).
  `apps/dashboard` has no menu screen.
- **How a till gets its menu:**
  - At login it calls `GET /api/default-service-zone/offers` (`apps/server/src/till-api.ts:614`).
  - When the counter zone changes or a table opens, it calls `GET /api/service-zones/:zoneId/offers`
    (`:637`).
  - The server builds the answer with `VENUE_SERVICE.listZoneOffers`
    (`packages/venue-service/src/operations.ts:460`), which calls `listMenuOffers`
    (`packages/catalogue/src/operations.ts:506`). That returns `MenuOffer[]`
    (`packages/catalogue/src/menu-types.ts:30`), with prices resolved by `resolveOfferPrice`
    (`offer-price.ts:21`).
  - Unavailable products are filtered OUT (`operations.ts:539-546`).
  - **The till never refreshes offers by itself**: there is no polling and no version check.
  - It has no search, no home or shortcut grid and no section grouping. `menuOfferToTillProduct`
    (`apps/till/src/api/client.ts:362`) drops the section.
- **How a sale is priced:**
  - `priceOrderLines` (`apps/server/src/working-order.ts:217`) reads ONE zone snapshot before its
    line loop and ignores any price the browser sends (test "ignores a browser-sent price",
    `till-sale.test.ts:596`).
  - A walk-up basket is priced **when it is paid**, from the current offers
    (`till-sale.ts:352-362`).
  - Parked orders, tabs and held orders are billed at the price stored on each line when it was
    added (`priceStoredOrder`, `working-order.ts:518`). Tests pin this, for example
    `working-order.pay-and-dispatch.test.ts:724`.
  - Editing a held order keeps stored prices only for a quantity-only edit. **Any other edit deletes
    and re-prices every line from the current offers** (`updateHeldOrder`,
    `working-order.ts:2408-2459`).
  - `recordWorkingLineContexts` calls `resolveZoneOffer` once per distinct menu item
    (`packages/venue-service/src/operations.ts:725-732`), and each call re-runs `listZoneOffers`.
    That breaks CLAUDE.md §3's "resolve shared catalogue data once" rule on that path for a basket
    with several different offers; the existing spy test cannot see it because the call is internal
    to the package.
  - The fiscal record takes the total and VAT breakdown only (`packages/core/src/record-sale.ts:269-283`).
  - **Five paths file a sale**, and every one files the VAT rate stored on the line at add time
    (`working_order_lines.vat_rate`, read by `readLockedLines`, `working-order.ts:476`): cash or
    manual card (`POST /api/sales` → `payWorkingOrder` → `fileImmediateSale`, `till-sale.ts:313-522`);
    integrated card (`POST /api/pay` → `payWorkingOrderIntegrated`: priced in P1 at `till-sale.ts:700-709`,
    provider called in P2, filed from P1's pricing in P3 at `:748-757`); card recovery
    (`finalizeRecovery`, `:878-938`, which re-prices from the stored lines at `:900`); invoice-first
    (`POST /api/working-orders/:id/place` → `placeOrder`, `working-order.ts:2529-2547`, filed at
    placing with deferred settlement; `collectOrder` later reads `sales.total` and never re-prices);
    and ticket-then-pay collect (`collectOrder` → `fileImmediateSale`, `till-sale.ts:1282`). A
    reprint rebuilds its lines by re-running `priceStoredOrder` on the stored lines
    (`readSettledTicket`, `:434-436`). Nothing stops an edit or a new round between P1 and P3
    (no in-flight guard was found in `working-order.ts`).
- **Order lines, extras and the kitchen:**
  - A child extras line records the picked product and its price but NOT the list it came from
    (`packages/db/src/schema/orders.ts:125-127`; `apps/server/src/modifier-selection.ts:146-147`
    says why that is a gap). The wire shape does carry it: `ExtraSelection { listId, picks }`
    (`packages/shared/src/extra-selection.ts:8-11`). `matchExtraChildren`
    (`modifier-selection.ts:150-176`) refuses the pairing when two active lists offer the product,
    which sends the order down the delete-and-re-insert path. The till re-derives a list for a
    retrieved pick from the dish's first offered list that carries it (`apps/till/src/state/held-extras.ts:15-26`).
  - Nothing on `working_order_lines` records that a line was sent: only `ticket_items.fired_at`
    does (`packages/db/src/schema/ticket-items.ts:50-51`; states are `queued`, `preparing`, `ready`,
    `:12`; `preparing` is "started"). A `no_preparation` line gets no ticket row (`fireLines`,
    `working-order.ts:883, 911`), and neither does a child line (`:769`). `served_at` IS on the line
    (`orders.ts:146`).
  - A partial split (`carveOffLines`, `working-order.ts:1856-1880`) inserts a new line row with no
    ticket item and without the source's course, note or served state; a whole-line move keeps the
    row and repoints its ticket (`:1396-1412`). A partial split of a dish with extras is refused
    (`tab.transfer_modifier_line`, `:1820-1824`). `ticket_items` has no quantity of its own: the
    kitchen screen reads the line's CURRENT quantity (`listStationQueue`, `:2966`).
  - `voidTabLine` (`:1183-1219`) prints a VOID slip only where the station has an active printer,
    then deletes the line, its children and (by cascade) its ticket row; it checks no state, so a
    started item vanishes from the kitchen screen at its next reload. `recallLines` (`:1021-1074`)
    refuses if any item has started and un-fires the queued ones. `enqueueCorrectionSlips`
    (`kitchen-print.ts:345-400`) writes only print jobs, nothing a screen can read, and returns
    silently with no printer (`:354-356, 380-381`).
  - **The kitchen screen is the till app on a `kds` device** (`apps/till/src/screens/till-station-screen.ts`,
    `widgets/station-queue.ts`; routes `GET /api/stations/:id/queue`, `POST /api/ticket-items/:id/advance`
    and the device-cookie twins in `device-api.ts`). It reloads only when opened and after its own
    advance actions (`till-station-screen.ts:157-163, 242-249`); the till app has no `EventSource`,
    `WebSocket` or offers timer.
  - **The till's table screen** offers per line: Send (held), Recall (fired, queued), Cancel (started,
    behind a confirm) and Serve; nothing changes a sent line's note, options, extras or quantity
    (`till-table-order-screen.ts:568-609`). New lines go in as a round (`addTabRound`). The counter
    basket saves a held order through `PUT /api/working-orders/:id` just before pay, place or park
    (`till-app.ts:1029-1036`).
  - Only the dashboard writes `products.available` (`PATCH /management-api/products/:id`,
    `catalogue-api.ts:1133-1137`, and the product editor); the till cannot. The dashboard's live
    channel is SSE on `/management-api/events` (`apps/server/src/live-api.ts:95`), which accepts the
    MANAGEMENT cookie only (`:97-104`), and the change feed already announces `products`,
    `option_labels` and `menu_item_extra_items` rows. `catalogues.version` exists and nothing bumps
    it (`packages/catalogue/src/operations.ts:85-86`).
- **Routing and reporting:**
  - Kitchen routing is by preparation route (zone + product, zone + category, venue + product,
    venue + category), falling back to product or category `station_id`
    (`packages/venue-service/src/operations.ts:943-1087`, `working-order.ts:803-887`).
  - Parent categories and non-primary memberships add nothing to routing
    (`docs/developers/product-categories.md`).
  - No report reads categories. `sale_lines.category` and `working_order_lines.category` are
    stored text labels.
- **Media:**
  - Product and category images are guarded by eight triggers in
    `packages/media/drizzle/0001_image_references.sql` (`image-references.test.ts:84-91` pins the
    names).
  - Deleting an image is refused while `listImageUsages` (`packages/media/src/images.ts:137`)
    finds a user.
- **Content languages:** `listContentTranslationGaps` (`packages/catalogue/src/content-languages.ts:53`)
  treats a category name and a section name as required text. A product's customer name is
  optional, and an absent map (`null` or `{}`) is not a gap.
- **Readiness:** `VenueReadinessIssue` (`packages/venue-service/src/operations.ts:243`) already has
  `zone.menu_missing` and `zone.menu_empty`.
- **Device profiles** (`packages/db/src/schema/device-profiles.ts`) carry no menu or layout. A till
  reads its configuration only from `GET /api/till` at boot (`till-api.ts:470`), and nothing is
  pushed to it.
- **Browser mode:** `apps/dashboard`, `apps/till`, `packages/ui`, `packages/ui-core` and
  `packages/venue-service`'s `browser` project run in real Chromium. `packages/ui` and
  `packages/ui-core` also carry Stryker configs with a mutation floor of 90 (CLAUDE.md §2).

## Task 3 wipes existing venues; every migrating task measures

Task 3 rebuilds `menu_items` and drops the old `menu_sections`, which other rows point at. The variants plan measured the
same kind of rebuild in the same tree (`docs/superpowers/plans/2026-09-23-variants-as-products.md`,
"Task 1 cannot upgrade an existing venue"): a drizzle rebuild runs with foreign keys ON inside the
migrator's transaction. That empties cascading children silently, and it fails outright on a child
with no delete rule that holds rows. A media trigger naming the rebuilt table also aborts the rename.

So Task 3 **measures its own upgrade** on a scratch venue that `main` has migrated and seeded, and
states the result in its PR and in a `docs/backlog.md` line: what is emptied, and what fails. Tasks
1, 6, 7, 7b and 8 only ADD tables, columns and triggers (7b adds three core columns and one
venue-service table); each still applies its migrations to a `main`-migrated,
seeded scratch venue, and states that it upgraded cleanly (a claim, so measured, never assumed). Every dev venue then needs `wa-wt reset demo <name>`. This sits within CLAUDE.md §3's "no
data-migration code until production" rule. **Advice for the owner's box: do not upgrade it
mid-plan; wipe it once after Task 7 lands.** (Revision 1's Task 1 wiped every venue; Revision 2's
Task 1 does not touch `category_details`.)

---

## The decisions this plan makes

The spec left integration details to the plan (§8 and §9's "stays with the plan"). The planner made
these; the owner can overturn any of them before the task that builds it starts. **D6, D9, D10, D11,
D12, D13 and D22 are the ones most worth the owner's eye.**

- **D1. One ordered membership table for menu lists.** `section_members` holds every list. A member
  is exactly one of a product or a section, and it has a `position` in that list. A unique index per
  (list, product) and per (list, child section) refuses the same object twice in one list (spec §2).
  Positions are rewritten 0..n-1 on every reorder and are NOT unique. That avoids CLAUDE.md §3's
  "rewriting rows one at a time breaks a unique index the final state satisfies"; ties sort by `id`.
- **D2. A menu's top level and each home layout are sections the menu owns.**
  - `sections.role` is `library`, `menu_root` or `home_layout`, and `owner_menu_id` is NULL exactly
    when the role is `library`.
  - A menu-owned section is hidden from the sections library and the translation-gap report, and it
    can never be a member of another list.
  - One editing interaction and one reorder API serve all three kinds of list (spec §5).
- **D3. Section names.** `sections.internal_name` is required plain text; `sections.names` is the
  optional customer-facing map (`{}` allowed). The till and the dashboard's customer previews show
  the customer name in the viewer's language, then the venue's default content language, then the
  internal name (spec §2). Reporting categories keep their existing name map and are not shown as
  menu structure.
- **D4. Reporting and routing do not change in this plan** (spec §10.1).
  - This plan does not touch reporting categories: `products.category_id` (the main reporting
    category) and `category_details.parent_id`. The sales classification plan's Tasks 1–2 run
    BEFORE this plan in the same lane (owner, 2026-09-25). By Task 1 here, `product_categories` has
    already been replaced by labels. Where "What the code is today" mentions it, that describes the
    tree before that plan.
  - Kitchen routing still reads preparation routes and stations. The ordered routing rules are a
    later spec (§10.5).
  - Adding, moving or removing anything on a menu never changes a product's reporting category or
    its route.
- **D5. `menu_items` stays, as one settings row per product a menu's working structure reaches.**
  - `syncMenuOffers(tx, menuIds)` runs after every structure write, in the same transaction.
    Reachability is by MEMBERSHIP alone: every top-level product the menu's root reaches, active or
    not. So deleting a product (`active=false`) and restoring it keeps its menu prices; only a
    structure change resets anything.
  - It inserts a row for each newly reachable product (`on conflict (menu_id, product_id) do
    nothing`, named target).
  - It **resets** the row of every product no longer reachable: `gross_price` null, `active` true,
    and its variant overrides and per-offer extras rows deleted. That is §9's "added back starts
    fresh".
  - Rows are reset, never deleted, because `working_line_contexts.menu_item_id` holds keys into the
    table with no delete rule.
  - A write that REMOVES links — removing a member, deleting a section — works out the affected
    menus (`menusContaining`) BEFORE the delete, because the cascade takes the links away.
  - `menu_items.active` keeps its §9 meaning, a per-menu on/off switch for a product the structure
    reaches. `updateMenuItem`'s `active = true` filter (`operations.ts:395`) goes, so the switch can
    be turned back on. `section_id` and `display_order` are dropped; placement now lives in the
    structure.
- **D6. A published version is one self-contained JSON document, with a fixed list of LIVE fields.**
  - `menu_versions` rows are append-only (`appendOnly()`, class `state`).
  - `menu_publications` points each menu at its live version.
  - The document holds:
    - the structure tree, with display content (names, image, colour);
    - one frozen offer per distinct product (today's `MenuOffer` shape, minus the live fields);
    - the home layouts.
  - Every extras item and every option label is included, available or not, so live availability
    can bring back one that was unavailable at publish. Today `OfferedOptionsList.labels` holds only
    the available ones.
  - **The ONE live overlay, read from the current rows whenever a document is served or priced,
    is availability** (spec §11.1, owner 2026-09-25):
    - the product's and each variant's `products.active` and `products.available`. NOT the per-menu
      switch `menu_items.active`, which is a menu setting and frozen;
    - an extra item's product `active` and `available`, its per-offer `menu_item_extra_items.available`,
      and an option label's `available`.
  - **Allergens and diet are IN the document** — on the dish, each variant and each extras item
    (`allergens` / `addAllergens`, `diet`, `dietDerivation`, `dietOverride`, `dietaryDeclarations` /
    `suitableFor`, `menu-types.ts:158-171` for the extras item's names). A change to them flags the
    menu and reaches a till when the owner publishes. Revision 2 kept them live because a declaration
    is a legal duty; the owner decided (spec §11.1) that they manage that with a publish, and that
    the product builds no distinction between a recipe change and a correction. A line added to an
    order records the published values it was added with, as `working_line_contexts` does today.
  - **Not menu content, so neither in the document nor in the overlay:** the VAT class, the
    reporting classification and the kitchen route. VAT is resolved when the invoice record is
    issued (Task 7a; spec §11.4; asesor Q26), classification is recorded at the same moment (the
    classification plan), and the route is decided when the line is sent, as today. A change to any
    of them flags no menu. The served offer still carries `vatClass`, `courseId` and the reporting
    `category` label read from the current rows, because `recordWorkingLineContexts` and the till's
    held-order view read them off the offer today (`packages/venue-service/src/operations.ts:749`);
    they are informational there, and filing never reads them.
  - Everything else the till shows or charges is frozen: names, descriptions, images, prices
    (dish, variant and extras item), units, variants offered, extras lists offered with their picks
    rules, option lists offered with their labels' text, allergens, diet, structure, order, and
    layouts.
- **D7. Change detection by hash; the diff is structural.**
  - `buildMenuDocument` produces the document the working state would publish, with live fields
    excluded.
  - `menuDocumentHash` is SHA-256 over canonical JSON (keys sorted, arrays in order).
  - A menu is *published and current* when that hash equals the live version's `content_hash`.
  - This makes spec §4's rules hold by construction: a reporting-category change is not in the
    document, and a
    product-price edit under an override leaves the effective price the same.
  - `diffMenuDocuments(live, proposed)` returns typed changes, which the Preview tab words as
    "Lemonade added under Drinks". **Each change names its source** (spec §11.1): `this_menu` for a
    change made on this menu's own lists or prices, `shared_product` for a product field (price,
    allergens, names, image, variants, extras, options) and `shared_section` for a section another
    menu also uses, so the comparison page can say "Lemonade: allergens (shared product)" and
    "Drinks renamed (shared section, also on Dinner Menu)".
- **D8. Publish is one write transaction that rebuilds the document inside it.**
  - The request carries the hash the preview showed. If the rebuilt document hashes differently, it
    refuses with `menu.changed_since_preview` (409) and writes nothing, and the screen re-previews.
  - A failure anywhere rolls the whole transaction back, so the previous version stays live
    (spec §4). Writes are serialised (`withTransaction` IS `withWriteLock`, CLAUDE.md §3).
- **D9. An unsaved basket follows the live version, with confirmation; the server prices it from
  the live version only** (spec §11.2, owner 2026-09-25; this replaces revision 2's per-line
  version and its 12-hour grace window, which are gone).
  - A till's unsaved basket exists only on the till until it is paid. The till prices what it shows
    from the version it loaded, and it sends that version id with each line as **an assertion of
    what staff saw**, not as a request for that version's prices. An absent `menuVersionId` means
    the live version, so existing request bodies stay valid.
  - The server prices every unsaved line — dish, variant, extras, options — from the menu's LIVE
    document, with the availability overlay applied (D6). Today's live-row extras pricing
    (`resolveBasketModifiers`, `working-order.ts:142-190`) moves onto the document. If any line's
    asserted version is not the live version, the request is refused with `menu.version_changed`
    (409), carrying each affected menu's live version id, and nothing is priced or written. There is
    no grace window and no `menu.version_expired`.
  - **The till's refresh flow**, run when the poll (D11) reports a new version and on
    `menu.version_changed`: reload that menu's offers; for each basket line from it, compare the
    line's price (dish, variant, each extra) and whether its product, variant, extras picks and
    option labels are still offered and available. If nothing relevant changed, adopt the version
    silently and, on a refusal, retry the request once. Otherwise show one dialog listing each
    changed line ("Lemonade €3.00 → €2.50") and each line that must be resolved (removed or
    replaced: "Burger is no longer on this menu", "Extra cheese is not available"), and go on only
    after staff confirm. The dialog never re-prices silently and never lets a blocked line through.
  - **Every SAVED line still records its version** where it is stored: `working_line_contexts` gains
    `menu_version_id` (Task 7), so a held or tab line filed hours later knows its provenance (for
    `sale_lines.menu_version_id`, the classification plan). Saved lines are never re-priced (D10).
  - **Owner decision flagged:** a basket is interrupted only when something IN IT changed; a Lunch
    republish that touched only lines the basket does not hold shows nothing.
- **D10. Editing a saved order** (spec §10.3, §11.2, §11.3, §11.5, §11.6; the server side is Task 7b,
  the till and kitchen-screen side Task 7c).
  - **A saved order keeps its facts.** Its lines are never re-priced by a publish or an edit, and
    their names, allergens and diet stay what the line was added with (`working_line_contexts`).
  - **What an edit prices:**
    - a line whose menu item or variant changes is a NEW item, priced from the live version;
    - an extra added to a line is priced from the live version;
    - extras already on the line keep their stored price, matched by value — **list, product and
      quantity** (CLAUDE.md §3's which-list rule). Today a child line does not record its list, so
      `working_order_lines` gains `extra_list_id` (a plain id, nullable, set on child lines only;
      no key, because a list may be deleted while orders that took from it are open — the column
      says so). `buildLineExtras` writes it from the pick's `listId`; `carveOffLines` copies it;
      `matchExtraChildren` matches on it and no longer refuses a product two lists offer; the till's
      `HeldExtra` carries `listId` and `held-extras.ts` stops guessing;
    - notes and options carry no price.
    - A line that is re-inserted by the edit path copies its stored gross price, names, descriptions,
      category text, line context, `extra_list_id`, `sent_at` and served state.
  - **"Sent" is recorded on the line: `working_order_lines.sent_at`** (spec §11.3).
    - It is stamped when the line is fired to a station (`fireLines` with a fired item, `sendLines`,
      `fireCourse`), and, for a line whose route is `no_preparation`, in the same `fireLines` call
      that skips it — a tab round, a placing, a send-to-prep. `parkOrder` and `createOpenOrder`
      stamp nothing; a held course (`hold: true`) is not sent until it fires; a recalled line stays
      stamped (it was sent, and its recall notice says so).
    - `carveOffLines` copies `sent_at`, `served_at`, `course_id` and `note` to the split row. The
      ticket row stays with the source line; **`ticket_items` gains `quantity`, the quantity fired**,
      so the kitchen screen keeps showing what it was asked to make after a split reduces the
      source line's quantity (`listStationQueue` reads the line's current quantity today).
      **Overturned 2026-09-26 (the owner's answer):** a partial split gives the split row its own
      ticket row, copied from the source's, at the quantity moved, and the source's `quantity`
      drops by that much. A split onto a new check refuses a line whose ticket is still held
      (`tab.split_held_line`), because a check cannot be sent.
    - **A no-route line under a HELD course** is not stamped when `fireLines` skips it, because its
      course has not fired. `fireCourse` and `sendLines` today act on `ticket_items` alone
      (`working-order.ts:942-1020`), so they gain a lookup of the course's no-route LINES and stamp
      those when the course fires. A no-route line with no course, or in a round with nothing held,
      is stamped at the round.
    - `sent_at` decides collectibility, and TWO different checks read two different facts:
      - **at pay**, a line with `sent_at` set is payable whatever its availability, and an unsent
        unavailable line blocks;
      - **at send** (`sendLines`, `placeOrder`, the round path), the check reads the KITCHEN state:
        a line with no fired ticket row — never fired, held, or recalled — is refused
        `product.unavailable` when its product is unavailable, even if `sent_at` is set from an
        earlier send. A recalled sold-out dish is never sent again.
    - Kitchen editability reads the ticket row: no ticket (no route) or `fired_at` null → free;
      fired and `queued` → allowed, never silent; `preparing` or `ready` → refused.
    - **A partial split of a STARTED line is refused** (`ticket.already_started`): the split row
      has no ticket row of its own, so it would read as freely editable while the cook has the
      work. `carveOffLines` reads the source's ticket state before splitting; a whole-line move
      keeps the row and its ticket and is unaffected.
    - **Overturned 2026-09-26 (the owner's answer to the split question):** the moved part gets its
      own ticket row, copied from the original, and the original's quantity drops by the part
      moved; a started line may be split, while edits of it stay refused; the split tells the
      kitchen nothing.
      _2026-09-26, the owner's answer to item 4: a split onto a check still tells the kitchen
      nothing, but sent work moved to another table records a MOVED notice and prints a MOVED
      slip — spec §11.5's dated note._
    - **With the venue setting off** (owner, 2026-09-25: the setting is for a paper-only kitchen,
      which never reports "started", so a recall slip cannot be trusted either), a line that was
      ever sent to a station (`sent_at` set AND a ticket row exists) is refused `ticket.already_fired`
      on every edit AND on `recallLines`. The only correction is a void: `voidTabLine` prints the
      VOID slip, records the notice and removes the line from the bill at once. Task 7c hides both
      Change and Recall in that state and offers Cancel on a queued line. A line the kitchen made
      anyway is re-added by staff with a note (the new ticket slip carries it). Held courses on
      such a kitchen are held by not sending them (`hold: true`), never by recalling.
  - **What the kitchen sees** — the kitchen state comes from `ticket_items` (`fired_at`, and `state`:
    queued, preparing, ready):
    - **Not sent** means no ticket item, or one whose `fired_at` is null (a held course, or a line
      recalled by `recallLines`). A line with no preparation route never has kitchen work. The edit
      is free.
    - **Sent, not started** (fired, `state = 'queued'`): the edit is allowed and never silent. The
      old ticket item is recalled, a **RECALLED kitchen notice** is recorded and the existing slip
      printed where a printer is mapped (`enqueueCorrectionSlips`, `kitchen-print.ts:345`), and the
      changed line fires as a new ticket item.
    - **Started** (`preparing` or `ready`): refused with the existing `ticket.already_started`.
      Staff void the line — `voidTabLine`'s path, which now records a **VOID notice marked
      started** before the delete — and add a new one.
    - A quantity RISE on a sent line adds a new line for the difference, priced from the live
      version, with its extras picks copied and priced from that version. It fires only where the
      order has already fired work: `updateHeldOrder` fires nothing today, and `addTabRound` does.
    - A quantity DROP on a sent line is a partial void: a VOID notice and slip for the removed
      quantity, and `ticket_items.quantity` reduced with it.
    - Extras lines follow their dish.
  - **Kitchen notices** (spec §11.5) live in a new venue-service table `kitchen_notices`
    (`state`): `id`, `station_id`, `working_order_id`, `order_label`, `kind` (`recalled`, `void`,
    `changed`), `line_name`, `quantity`, `note`, `was_started` (flag), `created_at`,
    `acknowledged_at`. `recordKitchenNotices(tx, cfg, orderId, items, kind)` is called beside
    `enqueueCorrectionSlips` by every path that corrects sent work — `recallLines`, `voidTabLine`,
    the edit path and the partial void — in the same transaction, whether or not a printer exists.
    A station's queue route returns its unacknowledged notices — the newest fifty, and none older
    than the venue's business day, so a station with neither screen nor printer never accumulates
    months of them; `POST /api/kitchen-notices/:id/acknowledge` (and its device-cookie twin) clears
    one. Task 7c shows them.
  - **The venue setting** "Allow changes to items already sent to the kitchen" (on by default) lives
    in a new one-row `service_settings` table in venue-service, following `content_languages`'
    one-row pattern. When it is off, a sent line can only be voided and re-added (`ticket.already_fired`,
    the existing code).
  - **Line numbering:** re-inserted and new lines are appended after the order's highest `line_no`,
    as `addTabRound` does (`working-order.ts:1150-1156`). `priceRows` numbering from 1 would collide
    with kept lines on `working_order_lines_line_no_key`.
  - **Out-of-date saves:** `working_orders` gains a `revision` counter. Every write to an order
    increments it, and `PUT /api/working-orders/:id` and the per-line route carry the revision their
    copy came from. A mismatch is refused (409, a code named for the concept — grep the
    working-order codes first), and the till reloads the order (spec §10.7 example 2). No revision
    exists today. _(2026-09-26: a save or line edit that changes nothing leaves the revision unchanged; see the
    Task 7c correction below.)_
  - **A per-line edit route for sent lines:** `PUT /api/working-orders/:id/lines/:lineNo`
    `{quantity, note, options, extras, revision}` applies the rules above to ONE line, so the till's
    Change action (Task 7c) never sends the whole order. `PUT /api/working-orders/:id` (the counter
    basket's save) keeps serving unsent lines, and it must never again delete a sent line's ticket:
    a sent line it does not preserve goes through the same recall-or-refuse rules.
  - **Unavailable:** an unsent line whose product became unavailable cannot be sent or paid
    (`product.unavailable`), checked on the SERVER at send (`sendLines`, `placeOrder`, `addTabRound`
    when it fires) and at pay (every path in Task 7a's table); the till offers remove or replace.
    A line with `sent_at` stays payable. Split bills (`splitOffCheck`) let staff pay the rest.
  - **Allergens on a retrieved held order are what the line was added with** (spec §11.1):
    `getHeldOrder` (`working-order.ts:2202`) keeps building the till's product from the add-time
    `context.allergens`. Revision 2's change to read the current row is withdrawn.
  - **Pre-bills do not exist yet** (asesor Q21 and Q14). The rule for when they are built: printing a
    pre-bill never fires held food and never marks a line sent. A `docs/backlog.md` note goes beside
    Q21.
  - This answers the owner's question on PR #623's finding: an edit can no longer silently delete a
    fired line's ticket item.
- **D11. Tills adopt a new version, and refresh availability, by polling** (spec §11.1).
  - `GET /api/menu-state?zoneId=` is session-gated like the offers routes. It returns
    `{ menus: [{ menuId, versionId }], unavailable: { products: string[], optionLabels: string[],
    extraItems: { menuItemId, productId }[] } }` — the ids of every product or variant that is
    inactive or unavailable, every option label that is unavailable, and every per-offer extras item
    switched off, across the zone's menus. Task 9 adds the layout fields (D14).
  - **Why the list and not a counter or a push:** nothing in the tree bumps on an availability
    write (`catalogues.version` is never incremented; `change_log` rows are deleted in the writing
    transaction), and the dashboard's SSE route accepts the management cookie only. The
    unavailable set is small (what is sold out right now), one query per table, and the till can
    apply it to its loaded offers without reloading them. A till-session branch on the SSE route is
    a later refinement, recorded in `docs/backlog.md` by Task 7.
  - The till polls **every 15 seconds** while an operator is signed in, stops on sign-out, and
    treats `session.required` like any other signed-out answer. It applies the unavailable set at
    once (greying tiles, D12, and blocking the basket's affected lines per D9's refresh flow), and
    a changed `versionId` runs D9's refresh flow for that menu.
  - A poll cannot keep a till signed in: inactivity is measured in the browser from pointer and key
    presses (`apps/till/src/till-app.ts:255-276`), and `requireSession`
    (`apps/server/src/till-session.ts:56-71`) reads a session without extending it (the plan
    review read both).
  - It also checks at every offers load.
  - **The kitchen screen polls too:** `till-station-screen` reloads its station's queue and notices
    on the same 15-second interval (Task 7c), so a notice appears without a cook touching the screen.
- **D12. An unavailable product stays where it is, greyed out and not orderable.** That applies in
  search, home tiles and section views. Spec §5 wants buttons in predictable positions during
  service. Today the server filters unavailable products out; from Task 7 it serves them marked.
- **D13. Shortcuts and their targets.**
  - A shortcut may only be added for a product or library section the menu's working structure
    reaches (`menu.shortcut_unreachable`).
  - If its target later leaves the working menu, the Home page tab marks the tile "Not on this menu",
    Preview lists it as a warning, and publishing LEAVES IT OUT of the published layout. It never
    blocks a publish.
  - The till's side is §9: a tap on a tile whose target is missing from the version it should be
    showing says "not found" and reloads home.
- **D14. A device's layout choice is per (device profile, menu), resolved against the LIVE version.**
  - It is stored in `device_profile_home_layouts` (catalogue-owned; keys to `device_profiles` and
    `catalogues`). No row means the menu's default layout.
  - `layout_id` deliberately carries NO key. Deleting a layout must not silently remove the
    selection, or the server could not tell "deleted" from "never chosen". The column says so, as
    CLAUDE.md §3 asks for a key that cannot be declared.
  - The server resolves each selection against the menu's LIVE document:
    - the selected layout is in it → that layout, reason `null`;
    - it is not (deleted and republished, or never published yet) → the live default, with reason
      `layout_removed` if the working state no longer has that layout, else `layout_unpublished`.
  - `/api/menu-state` returns `homeLayoutId` and `layoutFallback: null | "layout_removed" |
    "layout_unpublished"` per menu.
  - So a deleted layout keeps showing until the menu is republished, like every other menu change.
    Then the till shows §9's warning for `layout_removed`, and switches silently for
    `layout_unpublished` or when a manager simply picked another layout.
  - The device-profile screen shows a removed selection as "(removed)" and can reset it. Renaming a
    layout changes nothing on a device. A device that switches to another menu uses that menu's own
    selection or its default.
- **D15. Deleting.**
  - Deleting a library section removes it from every list containing it (the `child_section_id` key
    cascades). The confirm dialog names every menu and section that uses it.
  - No reporting category, route or product changes, and published versions are never touched; they
    are self-contained.
  - A product is deleted by `active=false`, as today. The live overlay hides it on tills at once, and
    the working document omits it, so every menu that had it is flagged.
  - Deleting a REPORTING category is the sales classification plan's business.
- **D16. Section images and published images stay available.** A section's own image is guarded by
  four media triggers like `category_details`' (Task 1).
  - Publishing writes `menu_version_images(version_id, filename)`.
  - Media refuses to delete or rename an image that any LIVE version references: two triggers in a
    new media migration, plus `listImageUsages` and `countUsages`.
- **D17. Provisioning, readiness and the demo seed.**
  - A new menu gets its root and default layout at creation, and no version.
  - Readiness gains `zone.menu_unpublished` for a zone whose menu has no live version: a zone with
    only unpublished menus sells nothing.
  - The demo seed publishes its menus.
- **D18. The menu editor moves to `apps/dashboard`**, as a core screen in the "Products and recipes"
  navigation group. The venue-operations Menus tab is deleted in Task 5. Assigning menus to zones
  stays in its Zones tab.
- **D19. Per-offer extras overrides keep their storage and get no UI.** They are reset by D5 and
  frozen in the document (D6), exactly as the code holds them today.
- **D21. Configuration transfer leaves publication out.**
  - The import deletes and re-inserts every declared table and remaps only ids held in top-level
    columns (`apps/server/src/configuration-transfer.ts`, around 440-480). An append-only
    `menu_versions` refuses the delete, and the ids inside a document would not be remapped.
  - So `menu_versions`, `menu_publications` and `menu_version_images` are NOT declared for transfer.
  - An imported venue arrives with every menu unpublished and reports `zone.menu_unpublished` until
    the owner publishes. Every other new table IS declared, and is checked against the transfer
    tests.
- **D22. A second device cannot change an order another device is paying** (spec §11.4; the owner
  corrected an earlier draft that read as a table lock: prices are final from bill print, send,
  place or Pay, and the paying till offers no edit, so there is no workflow overlap to lock
  against). What remains is a guard for TWO devices: between pricing (P1) and filing (P3) of an
  integrated card payment nothing today refuses a round from another till on the same order, so P3
  could file P1's figures for lines that no longer match. **The in-flight fact is recorded on the
  ORDER, in P1's own transaction:** `working_orders.payment_attempt_at` (nullable timestamp) is
  set in P1, cleared in P3, on a failed attempt, and by the SumUp sweep that resolves a stale
  attempt. Every line write on an order (`updateHeldOrder`, the per-line route, `addTabRound`,
  `voidTabLine`, `recallLines`, `sendLines`, the split and transfer paths) refuses with
  `order.payment_in_flight` (409) while it is set. It is NOT read from the payments store: the
  plan review found that the simulator writes no `attempting` row at all
  (`packages/payments/src/simulator.ts:38-39`), Stripe and SumUp write theirs in the provider's own
  transaction AFTER P1 has committed (`packages/payments-stripe/src/provider.ts:58-82`), and the
  integrated suite's canned provider writes no payment rows, so a guard on that row would be
  proven only against a fixture made to satisfy it. A server that dies between P1 and P3 leaves the
  mark set: the recovery branch of `POST /api/pay` clears it when it files or fails, and boot's
  reconcile clears any mark older than the provider timeout. It never outlives the payment
  attempt, whose own timeout bounds it. Built in Task 7b.
  - **2026-09-26, after review:** no mark is released by its age. An attempt still running in this
    process keeps its mark however long the reader waits, and so does an order with a payment still
    `attempting` or a capture no sale records; after each pass the server's loop clears any other
    mark on an open order (`releaseStalePaymentAttempts`, `apps/server/src/till-sale.ts`). A card
    Pay over a mark is refused `order.payment_in_flight` on the same two conditions, after the
    recovery branch has had its turn.
- **D23. "Duplicate and use the copy here" is one transaction** (spec §11.7 example 8). Two requests
  — remove Drinks, then add the copy — leave a moment in which Lunch reaches Lemonade through
  nothing, and D5's sync then resets its price and deletes its overrides. Task 1 adds
  `replaceMember(tx, sectionId, memberId, ref)`, which swaps the member at the same position and
  runs `syncMenuOffers` once against the FINAL structure, and `POST …/members/:memberId/replace`.
  `duplicateSection` takes an optional `replaceIn: { sectionId, memberId }` so duplicate-and-replace
  is one route and one transaction. Task 4's screen calls that.
- **D20. Out of scope:** the service spec's public, staff-only and not-sold-separately setting;
  guest ordering; popularity ranking, inventory, scheduled publication and a rollback interface
  (spec §8); a legacy location's menus (`locations.catalogue_id`, `location_catalogues`) and
  `GET /api/products`, which the till does not use; reporting categories, labels, sale-line
  classification and category reports (the sales classification plan); ordered kitchen routing rules
  (a later spec, menus spec §10.5); pre-bills (D10 states only the rule for when they come).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Read `CLAUDE.md` first.** §1 (writing claims), §2 (the gate), §3 (conventions), §4 (testing) and
  §5 (fiscal invariants) apply to every task.
- **Worktree, never `main`.** Each task is its own branch and worktree, created with
  `python3 ~/workspace/tools/worktree.py new waitron feat/menus-<slug>`; the slug is in each task's
  heading. One pull request per task, landed before the next starts.
- **Every commit needs `git commit -s`.** Plain English in commit messages and PR text. Exact file,
  function and error-code names appear once as pointers, and a command that was run goes in
  verbatim.
- **TDD, always.** Write the failing test first, watch it fail for the right reason, then write the
  minimal code. Fixtures give the three product names three DIFFERENT texts, and give a category's
  internal and customer names different texts, so a reader of the wrong one fails
  (`docs/developers/products.md`).
- **Test databases come from `useVenueDb`.** In the catalogue package that is `useCatalogueDb`
  (`packages/catalogue/test/fixtures.ts:142`), and the concurrency harness is `racePair` there.
  Rejected writes assert the domain error CODE, never `toBeInstanceOf(Error)`.
- **An owner-decided behaviour change changes the tests that pinned the old behaviour.** Each such
  change is named in the task and in its PR. Every other behavioural assertion is preserved; a test
  rewritten to match new code hides the regression it was there to catch.
- **Migrations:**
  - Generate with `pnpm --filter @waitron/<pkg> db:generate`; never hand-edit a snapshot or
    `_journal.json`.
  - **Never drop one table and create another in the same generation.** Drizzle-kit stops to ask
    about a rename and fails without a terminal (measured by the variants plan's review). Drop in
    one generation and create in the next.
  - READ every generated SQL file. A table rebuild is expected wherever a column with a key is
    dropped, because SQLite's `DROP COLUMN` refuses a column used in a foreign key or an index.
  - Run `scripts/schema-constraints.test.ts`, `scripts/migrations-match-schema.test.ts`,
    `scripts/append-only-triggers.test.ts`, `scripts/classification-complete.test.ts`,
    `scripts/two-file-foreign-keys.test.ts`, `scripts/module-graph-honesty.test.ts`, and the package's
    own `src/migrations.test.ts` and `schema-conformance.test.ts`.
  - Measure the upgrade (see "Task 3 wipes existing venues; every migrating task measures").
- **Every foreign key and unique index is declared in TypeScript** (CLAUDE.md §3). A new table is
  classified in its module's `*_CLASSIFICATION` list, and `menu_versions` and `menu_version_images`
  are declared with `appendOnly()`.
- **Do NOT edit `packages/fiscal-verifactu/src/privileges.expected.ts`.** It is a frozen record of
  the grants before the storage switch, read only by `scripts/write-path-tables.test.ts:246`.
- **When you add, rename or drop a table, grep the whole tree for its name**, not only `src/`. Known
  hand lists that name catalogue tables:
  - `packages/catalogue/src/classification.ts`
  - `packages/catalogue/src/configuration-transfer.ts` (and media's `before:` in
    `packages/media/src/module.ts:19`)
  - `packages/catalogue/src/content-languages.ts`
  - `scripts/schema-constraints.test.ts` and `packages/catalogue/src/migrations.test.ts` (both pin
    key and index lists)
  - `packages/media/src/images.ts` (`listImageUsages`, `countUsages`, `ImageUsage`) and
    `packages/media/src/image-references.test.ts` (the pinned trigger names)
  - `apps/dashboard/src/api/live-queries.ts` and `packages/venue-service/src/dashboard/live-queries.ts`
    (guard `scripts/live-subscriptions.test.ts`)
  - `apps/server/src/live-resources.ts`
  - `apps/server/scripts/demo-seed/`
  - `docs/developers/product-categories.md`
- **Error codes name the domain concept and are never renamed** (CLAUDE.md §3). New ones in this
  plan: `menu_section.member_cycle`, `menu_section.member_duplicate`, `menu_section.not_library`,
  `menu_section.invalid` (with `params.field`), `menu_section.membership_invalid`,
  `menu.changed_since_preview`, `menu.version_changed`, `menu.shortcut_unreachable`,
  `menu.default_layout_required`, `menu.layout_not_found`, `order.payment_in_flight`,
  `kitchen_notice.not_found`, and the readiness code `zone.menu_unpublished`. (Revision 2's
  `menu.version_expired` was never shipped and is not minted.)
  - Reuse the shipped siblings instead of minting duplicates (the plan review grepped the
    registries): a missing menu is `catalogue.not_found` (thrown today at `operations.ts:314` and
    `venue-service/src/operations.ts:395`), and a missing section is the already-registered
    `menu_section.not_found`, which now names the reusable section (the concept, a menu section,
    is unchanged).
  - A sent line refused by an edit (D10) uses a code named for the concept. Grep `apps/server`'s
    error registry for the order and line siblings before choosing its name.
  - Every file that throws a code imports its registry (`packages/catalogue/src/errors.ts`).
  - Each code gets a `STATUS` entry in `apps/server/src/catalogue-api.ts:130-186`, and English and
    Spanish text in `apps/dashboard/src/i18n/codes.ts` (and the till's `apps/till/src/i18n/codes.ts`
    where the till can meet it).
  - `scripts/alert-codes.test.ts` applies if a code is recorded as an incident; none here is.
- **Engine neutrality:** no advisory lock, no JSON containment operator, no new enum type. A
  closed vocabulary column uses the house `enumType` (or `enumText`) and `enumCheck` helpers from
  `packages/db/src/schema/columns.ts`, as workforce, bookings, identity and payments do. Add each new catalogue file to
  `scripts/catalogue-engine-neutral.test.ts`'s `CATALOGUE_FILES`.
- **Queries on one transaction are awaited in turn, never `Promise.all`** (CLAUDE.md §3).
- **The fiscal fingerprint is unrecoverable** (CLAUDE.md §5). The golden huella gate
  (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`, the byte-identical fingerprint describe)
  and `inmutabilidad` pass UNEDITED in every task. If they cannot, STOP: do not edit the golden
  literals; record it and mark the task blocked.
- **Screens:**
  - Every new or changed screen follows `docs/developers/design-system.md`: Forms, tabbed management
    pages, `wt-*` primitives, `--wt-*` tokens only, `wt-data-table` cells styled with `part=` and
    `::part()`, and every tab recorded in the URL.
  - Reordering works without dragging: `ReorderController`'s ArrowUp and ArrowDown
    (`apps/dashboard/src/widgets/reorder-table.ts`).
  - A new `wt-*` primitive, if any, needs a token-painting test and a sibling `*.a11y.test.ts`.
  - Every screen is opened and LOOKED at in both themes and at phone width (390px) before the PR
    (CLAUDE.md §4).
- **Strings:** every new dashboard string goes in both `en` and `es` of
  `apps/dashboard/src/i18n/strings.ts`, and every till string in `apps/till/src/i18n/strings.ts`.
  `es` is typed from `en`, so a missing Spanish key fails typecheck.
- **The gate per task:** focused behavioural tests while implementing, then `/finish-branch`, which
  lets the pre-push hook run once and watches CI. There is no whole-workspace local run just to
  finish (CLAUDE.md §2). Every task touches a risk trigger (a migration, a cross-package contract,
  the sale path or concurrency), so **every task takes the FULL review wave**.
- **Update `docs/backlog.md` in the same change that makes it stale**, and
  `docs/developers/product-categories.md` wherever a task changes what it describes. The last task
  also sweeps the spec's §8 list against what landed.

## Review Focus

These are the inputs and conditions most likely to bite a person that the spec implies but does not
test. Each has its test in the named task.

1. **Each fact reaches the till at its own moment: availability at once, allergens at publish, VAT
   at issuance — and only the allergen change flags the menu.**
   - Publish Lunch, then: mark Lemonade unavailable; add `sulphites` to Lemonade's allergens and to
     the extra "Extra lemon" that its extras list offers; change both VAT classes `reduced` →
     `general`.
   - Without republishing: within one poll the till greys Lemonade and the server refuses a new
     line for it; the till still shows the PUBLISHED allergens on the dish and the extra; a sale of
     a Lemonade line already in a tab files BOTH at 21% (Task 7a); and Lunch shows "Unpublished
     changes" whose comparison lists "Lemonade: allergens (shared product)" and "Extra lemon:
     allergens (shared product)" and nothing about VAT or availability.
   - After republishing: the till shows sulphites on both.
   - (Task 6 for the document and the diff; Task 7 for the served offer and the poll; Task 7a for
     the filed VAT.)
2. **A basket that spans a publish is refreshed and confirmed, never silently re-priced and never
   interrupted for nothing.**
   - Lemonade €3.00 on Lunch v1. The till adds one Lemonade, the owner publishes v2 at €2.50, the
     till polls and runs the refresh flow: it shows "Lemonade €3.00 → €2.50" and waits. After
     confirmation a second Lemonade is added and paying files 2.50 + 2.50 = 5.00 in one sale.
   - A pay request sent with v1 asserted after v2 is live is refused `menu.version_changed` and
     nothing is written; the till then runs the same flow.
   - Publishing v3 that changes only a section the basket holds nothing from shows no dialog, and
     the next pay request succeeds with v3 asserted.
   - Publishing v4 that removes Lemonade from Lunch blocks payment until the line is removed.
   - (Task 7.)
3. **Shared edits flag exactly the menus they change.**
   - Fixture: section Drinks in Lunch and Dinner; section Beer nested in Drinks; Burger only in a
     section Dinner alone uses; Lemonade with a Lunch override.
   - Rename Beer: both flagged. Publish Lunch: Lunch current, Dinner still flagged.
   - Change Lemonade's REPORTING category or VAT class (not menu content, D6): neither flagged.
     Change Lemonade's product price: Dinner flagged, Lunch not. Change Burger's price: only Dinner.
   - Change Lemonade's allergens: BOTH flagged, each naming the shared product as the source.
   - Mark Lemonade unavailable: neither flagged.
   - (Task 6.)
4. **"Starts fresh" holds whichever way a product leaves a menu.**
   - Lemonade is under Favourites and Drinks on Lunch, with a Lunch price override and a variant
     override.
   - Remove it from Favourites: it is still reachable, and the overrides stay.
   - Then, each from a fresh fixture:
     - remove it from Drinks;
     - remove Drinks from Lunch;
     - delete the Drinks section;
     - delete the Favourites section, after removing Lemonade from Drinks.
   - Each time the overrides are gone, and re-adding Lemonade anywhere on Lunch shows the product's
     own price and no variant override.
   - (Task 3.)
5. **An unavailable product keeps its place and cannot be ordered, in all three places.**
   - A home grid of four tiles, the second unavailable: it stays second, greyed, and a tap does
     nothing.
   - Search lists it once, greyed. Its section view shows it greyed in order.
   - The server refuses a line for it with `product.unavailable`.
   - (Task 7 for the server; Task 9 for the till.)
6. **A sent line is payable however availability changes, through a split and with no route; an
   unsent one is not.**
   - A tab has two fired Burgers and an unsent (held-course) Burger; Burger goes unavailable. One
     fired Burger is split to a new check. Both checks pay their fired Burgers; the held one blocks
     its check until removed. The kitchen screen still shows the original ticket as 2 Burgers.
   - A bottled beer with a `no_preparation` route sent in a round, then marked unavailable, pays.
   - A partial split of a Burger the cook has started is refused; a whole-line move of it keeps
     its ticket. A recalled Burger whose product went unavailable cannot be sent again.
   - **Restated 2026-09-26 (the owner's answer):** the kitchen shows the two Burgers, one on each
     check; the split moves a ticket row of its own with the Burger, takes it off the original's
     quantity, and tells the kitchen nothing. A started Burger may now be split; editing it stays
     refused.
   - (Task 7b.)
7. **Every correction reaches the kitchen screen, printer or not.**
   - A station with no printer: a recall, a void of a started item and a change to a queued line
     each put a notice on that station's screen within one poll, and the void's notice reads
     "started". Acknowledging clears it. With a printer mapped, the slip prints too.
   - (Tasks 7b and 7c.)

---

## File Structure

**New (catalogue):**
- `packages/catalogue/src/section-graph.ts` + test: the section graph in memory (load once per
  operation) — `loadSectionGraph`, `reachableProducts`, `wouldCreateCycle`, `menusContaining`,
  `placements`.
- `packages/catalogue/src/section-types.ts` and `sections.ts` + tests: browser-safe wire types, and
  the section CRUD and member writes.
- `packages/catalogue/src/menu-structure.ts` + test: `createMenuShell`, `syncMenuOffers`,
  `readMenuStructure`, `menuPrices`.
- `packages/catalogue/src/menu-document.ts` + test: `MenuDocument` types, `buildMenuDocument`,
  `menuDocumentHash`, `applyLiveFields`, `diffMenuDocuments`.
- `packages/catalogue/src/menu-publication.ts` + test: `publishMenu`, `menuStatus`,
  `previewMenu`, `readLiveDocuments`, `assertLiveVersions`.
- `packages/catalogue/src/home-layouts.ts` + test: layout CRUD, shortcut validation, device
  selections.
- Schema: new `schema/sections.ts`; additions in `schema/menu.ts`; new `schema/publication.ts`
  and `schema/home-layouts.ts`.
- Catalogue migrations `0005_*` onward, generated; the numbers are indicative, so let
  `drizzle-kit generate` assign them. Media migrations: section image triggers (Task 1) and published-image triggers (Task 6).

**New (dashboard):** `apps/dashboard/src/screens/menus-screen.ts` (the list and the editor's four
tabs); `widgets/member-list-editor.ts` (one ordered list: add, remove, reorder, used-in note — shared
by the sections library, the Structure tab and the Home page tab); `screens/sections-screen.ts`; `widgets/section-add-products.ts`; `widgets/menu-structure-tree.ts`;
`widgets/menu-prices-table.ts`; `widgets/menu-preview.ts`; `widgets/home-layout-editor.ts`, each
with a `.test.ts` and an `.a11y.test.ts`.

**New (till):** `apps/till/src/widgets/menu-browser.ts` (search, shortcut grid, structure,
section drill-in with a breadcrumb), `apps/till/src/state/menu-state-poll.ts`,
`apps/till/src/widgets/basket-refresh-dialog.ts` (D9's confirmation), each with a test and an a11y
test. **New (venue-service):** `packages/venue-service/src/kitchen-notices.ts` and its schema (D10).

**Modified, by task:** listed in each task's **Files** block.

---

## Task 1: Menu sections — ordered, reusable lists — slug `sections`

Spec §1 and §2, read with §10.1 ("category" in §1–§7 means SECTION), plus D1, D2, D3 and D15.
**Reporting categories and labels are not touched**: `categories`, `category_details` (with its
single `parent_id`), `products.category_id` and the classification plan's labels stay exactly as
that plan left them. There are no menu changes yet; menus still use the old per-menu
`menu_sections` headings until Task 3.

**Naming:**
- the new tables are `sections` and `section_members`;
- error codes use the existing `menu_section.*` prefix (the concept is still a menu section, now
  reusable; `menu_section.not_found` is already registered — CLAUDE.md §3: extend with siblings,
  never rename);
- the dashboard says "Sections".
- The old per-menu table `menu_sections` is dropped in Task 3, in its own generation.

**Files:**
- Create:
  - `packages/catalogue/src/schema/sections.ts` (`sections`, `sectionMembers`), with one generated
    catalogue migration;
  - `packages/catalogue/src/section-graph.ts`, `section-types.ts`, `sections.ts` + tests;
  - one `--custom` media migration with the four image-reference triggers for `sections.image`,
    mirroring `category_details`' four in `packages/media/drizzle/0001_image_references.sql`.
- Modify:
  - `packages/catalogue/src/errors.ts`, `classification.ts`, `configuration-transfer.ts` (and media's
    `before:` list in `packages/media/src/module.ts`), `content-languages.ts` (a section's customer
    names are optional, so an absent map is no gap), `index.ts`;
  - `packages/media/src/images.ts` (`listImageUsages`, `countUsages` and the `ImageUsage` union gain a
    `section` usage) and `image-references.test.ts` (four more pinned names).
- Modify: `apps/server/src/catalogue-api.ts` (section, member, duplicate, copy and usages routes;
  `STATUS`), and `apps/server/src/live-resources.ts`.
- Modify: `docs/developers/product-categories.md` (a short "Categories are not sections" note with a
  pointer), and `docs/backlog.md`.
- Test: `section-graph.test.ts`, `sections.test.ts`, `sections.db.test.ts`, the content-languages
  tests, `apps/server/src/catalogue-api.test.ts`, `packages/media/src/image-references.test.ts`, and
  `scripts/catalogue-engine-neutral.test.ts` (add the new files to `CATALOGUE_FILES`).

**Interfaces:**
- Produces:
  ```ts
  // section-types.ts (browser-safe)
  export const SECTION_ROLES = ["library", "menu_root", "home_layout"] as const;
  export type SectionRole = (typeof SECTION_ROLES)[number];
  export type MemberRef = { kind: "product"; productId: string } | { kind: "section"; sectionId: string };
  export interface SectionMember { id: string; position: number; ref: MemberRef }
  export interface LibrarySection {
    id: string; internalName: string; names: Record<string, string>; // customer names, may be {}
    image: string | null; color: string | null; members: SectionMember[];
  }
  export interface SectionUsages { menus: { id: string; name: string }[]; sections: { id: string; internalName: string }[] }
  // section-graph.ts — the whole graph in memory, loaded once per operation
  export interface SectionGraph { /* children(sectionId), parents(sectionId), role(sectionId), ownerMenu(sectionId) */ }
  export async function loadSectionGraph(tx: Transaction): Promise<SectionGraph>;
  export function wouldCreateCycle(g: SectionGraph, parentId: string, childId: string): boolean;
  export function reachableProducts(g: SectionGraph, rootId: string): string[]; // first-occurrence order, depth first
  export function menusContaining(g: SectionGraph, sectionId: string): string[]; // menu ids whose root reaches it
  export function placements(g: SectionGraph, rootId: string, productId: string): string[][]; // section-id paths from the root
  // sections.ts
  export async function listSections(tx): Promise<LibrarySection[]>;           // role = library only
  export async function readSection(tx, id: string): Promise<LibrarySection>;
  export async function createSection(tx, input: { internalName: string; names?: Record<string, string>; image?: string | null; color?: string | null }): Promise<LibrarySection>;
  export async function updateSection(tx, id: string, patch: Partial<{ internalName: string; names: Record<string, string>; image: string | null; color: string | null }>): Promise<LibrarySection>;
  export async function deleteSection(tx, id: string): Promise<void>;
  export async function addMember(tx, sectionId: string, ref: MemberRef, position?: number): Promise<SectionMember>;
  export async function addProducts(tx, sectionId: string, productIds: string[]): Promise<{ added: number }>; // multi-select add, spec §10.2
  export async function removeMember(tx, sectionId: string, memberId: string): Promise<void>;
  export async function moveMember(tx, sectionId: string, memberId: string, to: number): Promise<SectionMember[]>;
  export async function replaceMember(tx, sectionId: string, memberId: string, ref: MemberRef): Promise<SectionMember>; // same position; ONE sync against the final structure (D23)
  export async function duplicateSection(tx, sourceId: string, input: { internalName: string; memberIds: string[]; replaceIn?: { sectionId: string; memberId: string } }): Promise<LibrarySection>; // with replaceIn: duplicate AND replace in one transaction (D23)
  export async function sectionUsages(tx, sectionId: string): Promise<SectionUsages>;
  ```
  _2026-09-25: as built, `SECTION_ROLES` is a private, unexported constant in
  `packages/catalogue/src/schema/sections.ts`; `SectionRole` is written out by hand in
  `section-types.ts`, and `schema/sections.ts` checks the two against each other at compile time._
- A **structure-change hook**: every member write calls `onStructureChanged(tx, menuIds)`. It is a
  no-op in this task; Task 3 makes it call `syncMenuOffers`. A write that REMOVES links works out
  the affected menus (`menusContaining`) BEFORE the delete, because the cascade removes the links it
  would walk. Put the one call site in `sections.ts` now, so Task 3 changes one function.

- [ ] **Step 1: Write the failing tests for the graph** (`section-graph.test.ts`, a pure in-memory
  graph):
  - `wouldCreateCycle` is true for self-containment, for a direct back edge (A∋B, adding B∋A) and for
    an indirect one (A∋B∋C, adding C∋A).
  - It is false for reusing one child under two unrelated parents (Drinks under Lunch-root and
    Favourites).
  - `reachableProducts` returns first-occurrence order: root [Favourites[Lemonade], Drinks[Lemonade,
    Water, Beer[Lager]]] gives Lemonade, Water, Lager.
  - `placements` for Lemonade returns two paths.
  - `menusContaining(Beer)` returns every menu whose root reaches Beer through Drinks.
  - Run `pnpm --filter @waitron/catalogue exec vitest run src/section-graph.test.ts`: it FAILS
    (module missing).

- [ ] **Step 2: Write the failing database tests** (`sections.db.test.ts`, `sections.test.ts`):
  - **Membership and order:**
    - adding a product twice to one list is refused `menu_section.member_duplicate`; so is a
      section twice;
    - `addProducts` with some already present adds only the new ones, `{added}` counts them, and an
      unknown product id refuses the whole batch with `menu_section.membership_invalid`;
    - `moveMember` to position 0 reorders the list, and another list containing the same section
      keeps its own order;
    - a nested section adds no direct membership of its products.
  - **Cycles:** direct, indirect and self-containment are each refused `menu_section.member_cycle`.
    `racePair` runs A∋B and B∋A concurrently: exactly one lands, the other is refused with the code,
    and the graph has no cycle afterwards.
  - **Roles:**
    - a `menu_root` or `home_layout` section cannot be a member (`menu_section.not_library`);
    - the generic member routes refuse EVERY write into a `home_layout` list — add, remove and
      move (`menu_section.not_library`). A layout's tiles are written only through Task 8's shortcut
      routes, which check reachability, so no unchecked tile can exist between Tasks 3 and 8.
    - Menu-owned rows are made with a raw insert in this task, since Task 3 creates them properly.
  - **Names:** an empty internal name is refused `menu_section.invalid`
    (`params.field = "internalName"`). Customer names `{}` are accepted.
    `listContentTranslationGaps` reports a section with `{}` as no gap, and one with only `es` set
    while `en` is enabled as a gap.
  - **Duplicate:** it copies details and the chosen immediate members, in order, under the new
    internal name. Nested sections stay shared references, and no product is created.
  - **Replace (D23):** `replaceMember` puts the new ref at the old member's position, refuses a
    cycle and a duplicate with the same codes as `addMember`, and calls `onStructureChanged` ONCE
    with the menus computed from the final structure. `duplicateSection` with `replaceIn` does the
    copy and the replace in the caller's one transaction; a failure in either leaves both undone.
    The overrides test that proves it atomic is Task 3's (Review Focus 4's sibling there), because
    `syncMenuOffers` does not exist yet; here assert only that one call to the hook is made.
  - **Delete:** deleting Drinks removes it from every list containing it, and its child sections
    still exist. `sectionUsages` before the delete names every list. **No reporting category, route
    or product changes** (assert `products.category_id` and `preparation_routes` unchanged).
  - **Images:** a section's image must exist in media, and an image a section uses cannot be deleted
    or renamed. Give each of the four triggers a refusing case and an accepting control.
  - Run them: they FAIL.

- [ ] **Step 3: Implement the schema** in `schema/sections.ts`:
  ```ts
  const sectionRole = enumType(SECTION_ROLES);
  export const sections = table("sections", {
    id: id("id").primaryKey().$defaultFn(newId),
    internalName: label("internal_name").notNull(),
    names: json<Record<string, string>>("names").notNull().default({}),
    role: sectionRole("role").notNull().default("library"),
    ownerMenuId: id("owner_menu_id"),
    image: label("image"),
    color: label("color"),
  }, (t) => [
    foreignKey({ columns: [t.ownerMenuId], foreignColumns: [catalogues.id], name: "sections_owner_menu_fk" }),
    check("sections_role_ck", enumCheck(t.role)),
    check("sections_owner_ck", sql`(${t.role} = 'library') = (${t.ownerMenuId} is null)`),
    index("sections_owner_menu_idx").on(t.ownerMenuId),
  ]);
  export const sectionMembers = table("section_members", {
    id: id("id").primaryKey().$defaultFn(newId),
    sectionId: id("section_id").notNull(),
    position: count("position").notNull(),
    productId: id("product_id"),
    childSectionId: id("child_section_id"),
  }, (t) => [
    foreignKey({ columns: [t.sectionId], foreignColumns: [sections.id], name: "section_members_section_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.productId], foreignColumns: [products.id], name: "section_members_product_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.childSectionId], foreignColumns: [sections.id], name: "section_members_child_fk" }).onDelete("cascade"),
    check("section_members_one_ref_ck", sql`(${t.productId} is null) <> (${t.childSectionId} is null)`),
    uniqueIndex("section_members_product_uq").on(t.sectionId, t.productId),
    uniqueIndex("section_members_child_uq").on(t.sectionId, t.childSectionId),
    index("section_members_order_idx").on(t.sectionId, t.position),
    index("section_members_child_idx").on(t.childSectionId),
    index("section_members_product_idx").on(t.productId),
  ]);
  ```
  - Both tables are NEW, so one generation creates them, with no rebuild and no prompt. READ the
    SQL.
  - The plan review ran the same CHECK and unique-index shapes on `node:sqlite` (2026-09-25, on
    `category_details` and `category_members`):
    - the owner check accepted library with no owner and menu_root or home_layout with an owner, and
      refused the other two combinations (errcode 275);
    - the unique indexes allowed many rows with `product_id` null and refused a real duplicate
      (errcode 2067).
    - Re-run both on these tables.
  - Classify both tables `state`. **No existing venue is wiped by this task:** it only adds tables
    and triggers. State that measured, not assumed: apply it to a `main`-migrated, seeded scratch
    venue through `applyMigrations`.
  - The media migration's triggers go beside `0001`'s. Media already `requires` catalogue, and
    `scripts/module-graph-honesty.test.ts` cannot see a trigger's body (CLAUDE.md §3).

- [ ] **Step 4: Implement `section-graph.ts`, then `sections.ts`.**
  - Load the graph ONCE per operation and walk it in JavaScript. It is small, it keeps the SQL
    engine-neutral, and the write lock makes check-then-insert safe (CLAUDE.md §3,
    `withTransaction` IS `withWriteLock`).
  - `addMember` appends at `max(position) + 1` unless given a position, then renumbers.
  - `moveMember` renumbers the whole list 0..n-1 in one pass.
  - Positions are not unique; ties sort by `id`.

- [ ] **Step 5: Routes.** Under `/management-api/sections`:
  - list, create, read, update and delete;
  - `GET/POST /:id/members`, `POST /:id/members/products {productIds}`, `DELETE /:id/members/:memberId`,
    and `PUT /:id/members/:memberId/position {to}`;
  - `POST /:id/duplicate {internalName, memberIds, replaceIn?}`, `POST /:id/members/:memberId/replace {ref}`
    and `GET /:id/usages`.
  - Each route is one `withTransaction`, behind the same `person.manage` gate as the catalogue
    routes. Add the live-query source names (`scripts/live-subscriptions.test.ts`).

- [ ] **Step 6: Run the focused tests and the Global Constraints' migration guards. Commit.**

---

## Task 2: The sections library screen — slug `section-library`

Spec §2 ("Copy membership", read as sections), §6 ("the standalone … library"), and §10.2's "Add
products" flow. Dashboard only; the API is Task 1's. **The existing Categories screen is the
reporting-category screen and is not changed here.**

**Files:**
- Create:
  - `apps/dashboard/src/screens/sections-screen.ts`;
  - `widgets/member-list-editor.ts`;
  - `widgets/section-add-products.ts`;
  - each with a `.test.ts` and an `.a11y.test.ts`.
- Modify: `apps/dashboard/src/dashboard-app.ts` (import, `CoreScreen`, the `NAV_GROUPS` "menu" group,
  `#renderScreen`), `api/client.ts`, `api/live-queries.ts`, `i18n/strings.ts`, `i18n/codes.ts`,
  `dashboard-app.test.ts` (`NAV_SCREENS`).

**Interfaces:**
- Consumes: Task 1's routes and `section-types.ts`, and the existing `listCategories` (reporting
  categories, with their single `parentId`).
- Produces two widgets that Tasks 4 and 8 reuse.
- **`dashboard-member-list-editor`:**
  - props: `members: SectionMember[]`, `products: {id, name}[]`, `sections: {id, internalName}[]`,
    `excludeSectionIds: string[]` (the picker hides invalid choices; the server still refuses),
    `busy`, `label`;
  - events: `wt-member-add {ref}`, `wt-member-remove {memberId}`, `wt-member-move {memberId, to}`,
    `wt-member-open {sectionId}`;
  - it uses `ReorderController` (`widgets/reorder-table.ts`) for drag and ArrowUp/ArrowDown.
  - Each row names its kind (product or section) in text, never by colour alone.
- **`dashboard-section-add-products`**, the §10.2 flow:
  - props:
    - `products` (id, name, reporting category id);
    - `categories` (the reporting tree);
    - `inSection: string[]`;
    - `onMenu: string[] | null` (null outside a menu context);
    - `busy`;
  - it offers a reporting-category filter that includes everything below the chosen category, a
    search, and multi-select;
  - it marks "In this section" and "On this menu" as two DIFFERENT text marks;
  - it emits `wt-add-products {productIds}`.

- [ ] **Step 1: Write the failing widget tests** (real Chromium):
  - **Member list editor:** ArrowDown on the first row emits `wt-member-move {to: 1}`, and focus
    stays on the moved row. The add picker lists products and sections under separate headings and
    omits `excludeSectionIds`.
  - **Add products:**
    - choosing reporting category "Drinks" also lists products whose main category is "Beer" (a
      child of Drinks), and not "Mains";
    - selecting three and confirming emits one `wt-add-products` with the three ids;
    - a product already in the section shows "In this section"; one on the menu shows "On this menu";
      each can still be added, since a product may appear in several sections.
  - The a11y tests cover empty, populated, filtered and busy states, in both themes.
- [ ] **Step 2: Write the failing screen tests** (`sections-screen.test.ts`):
  - **The list:** searchable, with a "Used in" filter (`Any`, `Used in a menu` — including through
    nesting — and `Not used`).
  - **The editor modal:** internal name (required, marked, `name="internalName"`), optional customer
    names per language, image, colour, and the member list. It shows "Used in: Lunch Menu, Dinner
    Menu, Favourites" (`GET …/usages`) above the members, so a shared edit shows its wider use
    (spec §6).
  - **Refusals:** a server refusal of `menu_section.member_cycle` shows beside the member list and in
    the form's error summary.
  - **Duplicate:** it prefills "<name> (copy)" with every immediate member ticked; unticking one and
    saving calls `duplicate` with the rest.
  - **Delete:** the dialog lists the menus and sections it is used in.
  - **Tree view:** it shows occurrences by PATH, so Drinks nested under Favourites and at the top
    level appears twice, keyed by path; editing either opens the same section.
- [ ] **Step 3: Run to verify they fail. Step 4: Implement**, following the design system's Forms and
  "Tabbed management pages" rules, with one `wt-modal` editor and `wt-form-actions`. **Step 5: Run to
  verify they pass. LOOK in both themes and at 390px, English and Spanish. Commit.**

---

## Task 3: Menus are built from sections — storage and API — slug `menu-structure`

Spec §3's model, plus D2, D5 and D17. The till still reads the working state (publishing is Task 6);
this task changes WHAT the offers are, not when they are captured.

**Files:**
- Modify: `packages/catalogue/src/schema/menu.ts`:
  - drop `menuSections`, and drop `menuItems.sectionId` and `displayOrder`;
  - add `menuDetails`.
  - Create (generated): two catalogue migrations.
- Create: `packages/catalogue/src/menu-structure.ts` + test.
- Modify:
  - `packages/catalogue/src/operations.ts`: `createCatalogue` calls `createMenuShell`;
    `listMenuOffers` builds from the structure; `createMenuItem`, `updateMenuItem` and
    `deactivateMenuItem` are adapted.
  - `sections.ts` (`onStructureChanged` now syncs), `provisioning.ts`, `menu-types.ts`,
    `content-languages.ts` (the `section` kind goes), `classification.ts`,
    `configuration-transfer.ts`, `errors.ts`, and `migrations.test.ts`.
- Modify:
  - `packages/venue-service/src/provisioning.ts`, `operations.ts` (`zone.menu_empty` reads
    reachability), `dashboard/venue-operations-screen.ts` and `client.ts` (the Menus tab loses
    sections; "Add product to menu" adds to the menu's top level; price and variant editing stay
    until Task 5), `dashboard/live-queries.ts`.
- Modify: `apps/server/src/catalogue-api.ts`, `apps/server/src/testing/zone-offers.ts`,
  `apps/server/scripts/demo-seed/seed-catalogue.ts`, `apps/till/src/api/client.ts` (the offer type
  loses `sectionId`, `sectionName` and `displayOrder`), and `docs/backlog.md`.
- Modify: `packages/module/src/module.ts:86-98` (`ZoneMenuOffer`, the cross-package offer shape, also
  declares `sectionId`, `displayOrder` and `sectionName`).
- Modify: `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, the **`wineOffer` fixture ONLY**
  (it calls `createMenuSection` and `createMenuItem({ sectionId })` around lines 732 and 767, in the
  "variant line … effective VAT rate" block). Rebuild that fixture through members. The golden block
  (around line 597), its literals and every assertion stay byte-for-byte unchanged. The PR says
  exactly this, so nobody reads the edit as touching the golden gate.
- Modify: every suite that calls `createMenuSection` or `createMenuItem({ sectionId })` — about 18
  files by the plan review's count, among them `till-api`, `till-sale`, `tabs`, `served-at-huella`,
  the receipt and fiscal-sale-path suites, `configuration-transfer.test`, eight catalogue suites and
  `venue-service/client.test`. Find them with
  `grep -rln "createMenuSection\|sectionId" apps packages --include='*.ts'` and rebuild each fixture
  through section members, keeping every assertion.
- Test: `menu-structure.test.ts`, `operations.test.ts`, `menu-sections.test.ts` (deleted with its
  subject — say so in the PR), `catalogue-api.test.ts`, `testing-zone-offers.test.ts`,
  `packages/venue-service/src/operations.test.ts`, `venue-operations-screen.test.ts`.

**Interfaces:**
- Consumes: Task 1's graph and member writes.
- Produces:
  ```ts
  // schema/menu.ts
  export const menuDetails = table("menu_details", {
    menuId: id("menu_id").primaryKey(),
    rootSectionId: id("root_section_id").notNull(),
    defaultHomeLayoutId: id("default_home_layout_id").notNull(),
  }, (t) => [
    foreignKey({ columns: [t.menuId], foreignColumns: [catalogues.id], name: "menu_details_menu_fk" }),
    foreignKey({ columns: [t.rootSectionId], foreignColumns: [sections.id], name: "menu_details_root_fk" }),
    foreignKey({ columns: [t.defaultHomeLayoutId], foreignColumns: [sections.id], name: "menu_details_default_layout_fk" }),
    uniqueIndex("menu_details_root_uq").on(t.rootSectionId),
  ]);
  // menu-structure.ts
  export async function createMenuShell(tx: Transaction, menuId: string, menuName: string): Promise<{ rootSectionId: string; defaultHomeLayoutId: string }>;
  export async function syncMenuOffers(tx: Transaction, menuIds: readonly string[]): Promise<void>;
  export interface MenuStructureNode { memberId: string; ref: MemberRef; children?: MenuStructureNode[] } // children present for a section
  export async function readMenuStructure(tx: Transaction, menuId: string): Promise<{ rootSectionId: string; nodes: MenuStructureNode[] }>;
  ```
  - `MenuItem` (in `menu-types.ts`) loses `sectionId` and `displayOrder`. `MenuOffer` loses
    `sectionName`, and it gains `placements: string[][]`: section-id paths from the root, with `[]`
    for the top level.
  - Offer order is `reachableProducts` order.

- [ ] **Step 1: Write the failing tests** (`menu-structure.test.ts`, `operations.test.ts`):
  - **Creating a menu** makes a `menu_root` and a `home_layout` section, both owned by the menu, and
    a `menu_details` row.
  - **The root and the layout never show up elsewhere:** not in `listSections`, not as a member
    choice, and not in `listContentTranslationGaps`.
  - **Adding Drinks to Lunch's root:** `listMenuOffers([lunch])` returns Drinks' products in order,
    and each has a `menu_items` row. Adding a product to Drinks later offers it on Lunch AND Dinner
    at its product price (spec §1, acceptance 1's working half).
  - **Reordering:** reordering Lunch's root leaves Dinner's order unchanged (acceptance 3's working
    half).
  - **Review Focus 4, all five paths**, including deleting a section and removing a nested one.
    Also assert that the row's id is the SAME after a reset: `working_line_contexts` points at it.
  - **D23, the other direction:** Lunch reaches Lemonade only through Drinks, with a price override
    and a variant override. `duplicateSection(Drinks, { replaceIn: { sectionId: lunchRoot, memberId } })`
    leaves both overrides in place and Lunch reaching Lemonade through the copy at the same
    position. **Control:** `removeMember` then `addMember` as two transactions resets them, which
    is the hole D23 closes.
  - **The per-menu switch:** `menu_items.active = false` hides a reachable product on that menu only
    (D5).
  - **Readiness:** a zone whose menu's root is empty reports `zone.menu_empty`, and a nested product
    counts as not empty.
  - **Existing coverage stays green with fixtures moved from sections to structure:**
    `operations.test.ts`'s "offers one product on two menus", the variant and extras cases, and the
    price chain in `offer-price.test.ts`.
  - **A shared section's change syncs every menu containing it:** assert rows on both, in one
    transaction.
  - Run them: they FAIL.

- [ ] **Step 2: Implement the schema.**
  - First generation: `menuDetails`, and `menu_items` without `section_id` and `display_order`.
    Expect a `menu_items` REBUILD, because its section key is dropped.
  - Second generation: drop `menu_sections`.
  - Classify `menu_details` `state`, and remove `menu_sections` from every hand list.
  - **Measure the upgrade:** the variants plan measured that a `menu_items` rebuild silently empties
    `menu_item_variant_overrides` and `menu_item_extra_lists`, and fails with an open order line
    (Task 4 of that plan). Re-measure here and record it.

- [ ] **Step 3: Implement `menu-structure.ts` and the operation changes.**
  - `syncMenuOffers`:
    - load the graph once;
    - for each menu, take `reachableProducts(root)` over every TOP-LEVEL product member, active or
      not (D5: reachability is membership; variants follow their parent, as today);
    - insert missing rows with a NAMED conflict target (`menu_items_menu_product_key`, CLAUDE.md
      §3's untargeted-conflict rule);
    - reset every other row of the menu in one statement per table: delete its
      `menu_item_variant_overrides`, `menu_item_extra_items` and `menu_item_extra_lists`, then
      `update menu_items set gross_price = null, active = 1`.
  - `onStructureChanged` calls `syncMenuOffers(tx, menusContaining(...))`. For a write that
    REMOVES links (`removeMember`, `deleteSection`), compute `menusContaining` from the graph BEFORE
    the delete and pass that list, because the cascade removes the links it would walk.
  - `listMenuOffers` keeps its filters, availability included; that changes in Task 7.
  - `createMenuItem` is replaced by "add a member to the menu's root" plus `updateMenuItem` for
    price and switch. Remove the section argument everywhere.
  - Provisioning's initial catalogue gets `createMenuShell`.

- [ ] **Step 4: Routes and the venue-operations tab.**
  - `GET /management-api/catalogues/:id/structure` returns `readMenuStructure`. Members of the root
    use Task 1's member routes with the root id.
  - `POST /management-api/catalogues` creates the shell in the same transaction.
  - The venue-operations Menus tab:
    - drop the sections table and the section field in the offer editor;
    - "Add product to menu" adds to the root;
    - keep price and variant editing, which moves in Task 5.
  - `apps/server/src/testing/zone-offers.ts` builds through members.

- [ ] **Step 5: The demo seed** builds each menu's root from shared sections named after today's seed categories (Casa Delgado:
  Tapas, Sharing plates, Mains, Desserts, Drinks; Menú del Día: Starters, Mains; Deli: Charcuterie,
  Cheeses, Conserves). Negroni's €9.00 on Menú del Día becomes a price override on a product added
  at that menu's top level.

- [ ] **Step 6: Run the focused tests, and run `apps/server`'s `test:coverage` locally.** This task
  changes a fixture helper that many server suites use (CLAUDE.md §2 allows a package run when a
  value several suites assert changes). **LOOK at venue operations. Commit.**

---

## Task 4: The Menus screen — list and Structure tab — slug `menu-editor`

Spec §3 and §6's Structure view, plus D18. There is no Prices, Home page or Preview tab yet; the tab
strip holds Structure only, and Task 5 adds its neighbours.

**Files:**
- Create: `apps/dashboard/src/screens/menus-screen.ts` and `widgets/menu-structure-tree.ts`, each
  with a test and an a11y test. Modify: `widgets/product-editor.ts` and
  `screens/catalogue-screen.ts` (the "Add to menus…" step).
- Modify: `apps/dashboard/src/dashboard-app.ts` (the import, `CoreScreen`, the `NAV_GROUPS` "menu"
  group, the `#renderScreen` case), `navigation.ts` (the children `menu` and `view`), `api/client.ts`,
  `api/live-queries.ts`, `i18n/strings.ts`, `dashboard-app.test.ts` (`NAV_SCREENS`).

**Interfaces:**
- Consumes: Task 3's `GET …/structure`, Task 1's member routes and usages, and Task 2's
  `dashboard-member-list-editor`.
- Produces: the route `/manage/menus`, and `/manage/menus/menu/<id>/view/structure`.

- [ ] **Step 1: Write the failing tests** (`menus-screen.test.ts`, `menu-structure-tree.test.ts`):
  - **Menus list:** create a menu (the name is required; the refusal shows beside the field) and
    rename one.
  - **Structure tree:** it shows the root's members; expanding Drinks shows its members inline.
  - **Shared editing:** editing inside Drinks shows "Shared: also in Dinner Menu, Favourites" and
    offers "Duplicate and use the copy here". That is ONE request, `POST …/duplicate` with
    `replaceIn` naming this list and the Drinks member (D23), and the tree shows the copy at the
    same position afterwards. Never two requests: a remove followed by an add resets the menu's
    prices for everything reached only through Drinks.
  - **Creating a section** without leaving the editor adds it where it was created.
  - **Remove:** "Remove from this list" names the list it removes from, and a section delete is not
    offered here (spec §3).
  - **Reordering:** ArrowUp and ArrowDown reorder, and focus stays.
  - **Breadcrumb:** a text breadcrumb shows the path followed (Lunch Menu › Drinks › Beer), and it is
    this screen's own markup: there is no breadcrumb primitive (design-system table).
  - **Navigation:** the tab and the chosen menu are in the URL (the design system's Navigation rule).
  - **Adding products to a section** uses Task 2's `dashboard-section-add-products` with `onMenu` set
    to this menu's reachable products, so "On this menu" and "In this section" both show (spec
    §10.2).
  - **"Add to menus…" when creating a product** (spec §10.2): the product editor's create flow ends
    with an optional step listing menus and their sections. Choosing sections calls `addProducts`
    once per section, after the product is saved. A failure there is a separate, stated error that
    does not undo the saved product (CLAUDE.md §3's write-then-load rule). Skipping it changes
    nothing.
  - **The a11y test** covers the empty menu, the populated tree, an expanded shared section, the
    add-products picker and the "Add to menus…" step, and loading and failed states, in both themes.

- [ ] **Step 2: Run to verify they fail. Step 3: Implement**, with live data through
  `DashboardQueries` (passive re-reads), and writes followed by a refresh. A successful write
  followed by a failed refresh is a load failure (CLAUDE.md §3). **Step 4: Run to verify they pass.
  LOOK in both themes and at 390px, English and Spanish. Commit.**

---

## Task 5: Menu prices, and the old Menus tab goes — slug `menu-prices`

Spec §3's price rules, plus §9's "overrides stay" and D18.

**Files:**
- Modify: `packages/catalogue/src/menu-structure.ts` (`menuPrices`) + test, and
  `apps/server/src/catalogue-api.ts` (`GET …/prices`; `PATCH …/items/:itemId` takes
  `{grossPrice: string|null, active: boolean}`).
- Create: `apps/dashboard/src/widgets/menu-prices-table.ts` (+ tests), and the offer-settings modal
  inside it, carrying the per-variant overrides moved from venue operations.
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (the Prices tab).
- Delete: the venue-operations Menus tab (`venue-operations-screen.ts:558-693` and `:854-1143`), its
  client methods, strings and tests, keeping the Zones tab's menu assignment. Say in the PR which
  tests go with their subject.

**Interfaces:**
- Produces:
  ```ts
  export interface MenuPriceRow {
    menuItemId: string; productId: string; name: string;
    placements: string[][];            // section-id paths, [] = top level
    productPrice: string | null;       // the product's own effective price
    override: string | null;           // menu_items.gross_price
    effectivePrice: string;            // resolveOfferPrice
    active: boolean;                   // on this menu
    variants: MenuVariant[];           // today's shape, from listMenuVariants
  }
  export async function menuPrices(tx: Transaction, menuId: string): Promise<MenuPriceRow[]>;
  ```

- [ ] **Step 1: Write the failing tests:**
  - **`menuPrices`:**
    - one row per DISTINCT reachable product;
    - Lemonade under Favourites and Drinks is one row with two placements;
    - a section unrelated to the menu appears in no placement (spec §3's table).
  - **Overrides:**
    - An explicit override equal to the product price stays fixed when the product price changes.
    - A cleared override follows it.
    - "Use product price" sends `grossPrice: null` (acceptance 6's working half).
  - **Screen:**
    - search, a section filter, a reporting-category filter and an "Overridden only" filter;
    - the placements column says "Top level" for `[]` and uses the sections' internal names;
    - the offer-settings modal edits the override (the product price is shown as the empty field's
      hint, per the design system's fallback-field rule), the per-menu switch and each variant's
      price and offered flag;
    - saving sends one `PATCH` and one `PUT …/variants`. (2026-09-26: a save now sends only the
      request whose settings changed, and nothing when none did — finish-branch review.)
  - **Venue operations:** its tests no longer find a Menus tab, and its Zones tab still assigns
    menus.
  - Run them: they FAIL.

- [ ] **Step 2: Implement. Step 3: Run to verify they pass. LOOK in both themes and at 390px.
  Commit.**

---

## Task 6: Publishing — slug `publish`

Spec §4, plus D6, D7, D8, D13's publish side and D16. After this task a menu can be published and
its status shows, but **tills still read the working state**: Task 7 switches them. That keeps the
sale-path change in one reviewable task.

**Files:**
- Create: `packages/catalogue/src/schema/publication.ts` (`menuVersions`, `menuPublications`,
  `menuVersionImages`), one catalogue migration, and `packages/media/drizzle/000N_*` (two triggers:
  refuse deleting or renaming an image that a live version references).
- Create: `packages/catalogue/src/menu-document.ts` and `menu-publication.ts` + tests.
- Modify:
  - `packages/catalogue/src/classification.ts` (`appendOnly("menu_versions", "state", …)`,
    `appendOnly("menu_version_images", "state", …)`, `classify("menu_publications", "state", …)`).
    The three are NOT added to `configuration-transfer.ts` (D21); a transfer test asserts an
    imported venue's menus arrive unpublished;
  - `packages/media/src/images.ts` (`listImageUsages`, `countUsages` and the `ImageUsage` union gain
    a `menu_version` usage) and `image-references.test.ts` (two more pinned names).
- Modify:
  - `apps/server/src/catalogue-api.ts`: `GET /management-api/catalogues/:id/status`,
    `GET …/preview`, and `POST …/publish {expectedHash}`;
  - `apps/dashboard/src/screens/menus-screen.ts` (a status column on the list; the Preview tab),
    `widgets/menu-preview.ts`, and the strings.

**Interfaces:**
- Produces:
  ```ts
  // menu-document.ts
  export const MENU_DOCUMENT_FORMAT = 1;
  export interface MenuDocument {
    format: typeof MENU_DOCUMENT_FORMAT;
    menuId: string; menuName: string;
    root: DocumentList;                       // the menu's top level
    offers: Record<string, FrozenOffer>;      // keyed by menuItemId; one per distinct product with active menu_items row
    homeLayouts: DocumentLayout[];            // default first; published tiles only (D13)
    defaultHomeLayoutId: string;
  }
  export type DocumentMember =
    | { kind: "product"; menuItemId: string; productId: string }
    | { kind: "section"; sectionId: string; internalName: string; names: Record<string, string>; image: string | null; color: string | null; members: DocumentMember[] };
  export interface DocumentList { members: DocumentMember[] }
  export interface DocumentLayout { id: string; name: string; tiles: ({ kind: "product"; productId: string } | { kind: "section"; sectionId: string })[] }
  // Stripped from the document (D6): availability, and the three fields that are not menu content.
  export type OverlayOfferField = "available" | "vatClass" | "courseId" | "category";
  export type OverlayExtraItemField = "available" | "vatClass"; // `OfferedExtraItem` has NO `available` today — the served offer adds it
  // Allergens and diet are IN the document, on the dish, each variant and each extras item.
  // offeredModifiers keeps every extras item and option label, with the overlay fields stripped:
  export type FrozenOffer = Omit<MenuOffer, OverlayOfferField | "placements" | "offeredModifiers"> & {
    variants: Omit<MenuOfferVariant, OverlayOfferField>[];
    placements: string[][];
    offeredModifiers: FrozenOfferedModifier[]; // extras items without OverlayExtraItemField; option labels without `available`
  };
  export interface LiveOffer extends MenuOffer { available: boolean } // document + overlay
  export async function buildMenuDocument(tx: Transaction, menuId: string): Promise<{ document: MenuDocument; omittedShortcuts: { layoutId: string; ref: MemberRef }[] }>;
  export function menuDocumentHash(document: MenuDocument): string;   // sha256 hex of canonical JSON
  export async function applyLiveFields(tx: Transaction, documents: readonly MenuDocument[]): Promise<Map<string, LiveOffer[]>>; // ONE query per live table for all documents
  export type ChangeSource = "this_menu" | "shared_product" | "shared_section"; // spec §11.1: the comparison names where a change came from
  export type MenuChange = { source: ChangeSource; alsoOn?: string[] } & (   // alsoOn: other menus a shared change flags
    | { kind: "product_added" | "product_removed"; productId: string; name: string; under: string[] }  // internal names of the path
    | { kind: "product_moved"; productId: string; name: string; from: string[][]; to: string[][] }
    | { kind: "price_changed"; productId: string; name: string; from: string; to: string }
    | { kind: "product_changed"; productId: string; name: string; fields: string[] }  // names, description, image, variants, extras, options
    | { kind: "section_added" | "section_removed"; sectionId: string; name: string; under: string[] }
    | { kind: "section_changed"; sectionId: string; name: string; fields: string[] }
    | { kind: "order_changed"; list: string[] }
    | { kind: "layout_changed"; layoutId: string; name: string }
    | { kind: "default_layout_changed"; from: string; to: string });
  export function diffMenuDocuments(live: MenuDocument | null, proposed: MenuDocument): MenuChange[];
  // `product_changed.fields` includes "allergens" and "diet" now that they are in the document.
  // menu-publication.ts
  export type MenuStatus = { state: "unpublished" } | { state: "current" | "changed"; version: number; publishedAt: string; hash: string };
  export async function menuStatus(tx: Transaction, menuIds: readonly string[]): Promise<Map<string, MenuStatus>>; // builds every menu's document in ONE pass: one graph load and one offers read for all menuIds, not one per menu — the list re-reads on every live change
  export async function previewMenu(tx: Transaction, menuId: string): Promise<{ hash: string; changes: MenuChange[]; warnings: { kind: "shortcut_omitted"; layoutName: string; name: string }[] }>;
  export async function publishMenu(tx: Transaction, menuId: string, expectedHash: string, personId: string): Promise<{ versionId: string; number: number }>;
  export async function readLiveDocuments(tx: Transaction, menuIds: readonly string[]): Promise<Map<string, { versionId: string; document: MenuDocument }>>;
  ```
  - Tables:
    - `menu_versions`: `id`, `menu_id`, `number` (unique per menu), `document` (json),
      `content_hash`, `published_at`, `published_by`. `published_by` is the management session's
      person id as plain text with NO key: persons are the identity module's, and catalogue does not
      require it. Say so at the column.
    - `menu_publications`: `menu_id` (primary key), `version_id`, `published_at`.
    - `menu_version_images`: `(version_id, filename)` primary key.
  - `superseded_at` is not stored: nothing reads it since the grace window went (D9).

- [ ] **Step 1: Write the failing tests** (`menu-document.test.ts`, `menu-publication.test.ts`):
  - **Canonical hash:** the same working state built twice hashes identically, and a hash computed
    from a JSON round trip with keys shuffled equals the original.
  - **Review Focus 3**, in full.
  - **Every extras item and option label is in the document**, available or not: a label unavailable
    at publish and made available afterwards is offered without a republish.
  - **Review Focus 1's document half:** changing VAT class, availability, course or reporting
    category leaves the hash unchanged, while a name, price, image, **allergens, diet**,
    variant-offered or extras-price change moves it — on the dish, a variant AND an extras item.
  - **Diff:** Lemonade added under Drinks gives `product_added` with `under: ["Drinks"]` and
    `source: "this_menu"`; Burger €12 → €13 gives `price_changed` with `source: "shared_product"`
    and `alsoOn: ["Dinner Menu"]`; sulphites added to Lemonade gives `product_changed` with
    `fields: ["allergens"]` and `source: "shared_product"`; renaming Drinks gives `section_changed`
    with `source: "shared_section"`; reordering Lunch's root gives `order_changed`; a new menu
    diffed against `null` lists everything as added.
  - **Publish:**
    - it writes version 1 and points the publication at it;
    - a second publish writes version 2;
    - version 1's row is untouched, and updating or deleting it is refused by the append-only
      trigger (assert the refusal CODE path the store reports).
  - **Stale preview:** an edit between preview and publish refuses `menu.changed_since_preview`, and
    nothing is written (the version count is unchanged).
  - **Failed publish:** a failure injected after the version insert (a stub that throws in the image
    step) leaves the previous version live and no new row (acceptance 7).
  - **Independent menus:** publishing Lunch while Dinner has pending shared changes leaves Dinner
    `changed` and on its old version (acceptance 7).
  - **Images:** an image used only by the live version cannot be deleted (`media` refuses with its
    existing in-use shape), and after a republish without it, it can.
  - **D13 at publish:** a shortcut whose target left the working menu is omitted from the published
    layout and listed in `previewMenu`'s warnings. It never blocks the publish.
  - **Screen:**
    - the list shows Unpublished, Published or "Unpublished changes" with version and time;
    - Preview lists the changes in words, each with its source ("Lemonade: allergens — shared
      product, also on Dinner Menu"), and a "Publish Lunch Menu" button (naming the single menu,
      spec §6);
    - a 409 re-previews and says the menu changed;
    - an error keeps "saved" distinct from "published" (spec §6).
  - Run them: they FAIL.

- [ ] **Step 2: Implement.**
  - `buildMenuDocument` reuses `listMenuOffers(…, {includeUnavailable: true})` and the extras and
    options readers with every item included, then strips the overlay fields. Availability must not
    change the document; allergens and diet must.
  - Build the tree from `readMenuStructure`.
  - Canonical JSON is a small recursive serialiser that sorts object keys; do not rely on insertion
    order.
  - `publishMenu` does all of its work inside the caller's ONE transaction: build, hash-check,
    insert the version, insert its images, then upsert the publication with a named target.
  - The media migration's two triggers go in a `--custom` media migration beside `0001`'s. Pin the
    names in `image-references.test.ts`, with a refusing case and an accepting control for each.
  - `scripts/module-graph-honesty.test.ts` cannot see a trigger's body (CLAUDE.md §3); media
    already `requires` catalogue.

- [ ] **Step 3: Run to verify they pass. LOOK at the list and Preview in both themes and at 390px.
  Commit.**

**What landed differently (2026-09-26).** Media's
`packages/media/drizzle/0003_published_image_references.sql` has three triggers, not two: an insert
check on `menu_version_images` as well as the delete and rename triggers on `media_images`.
`menuStatus(tx, menuIds?)` treats a missing id list as every menu. `previewMenu` also returns
`status`, the menu's `MenuStatus`. On the Preview tab the dashboard takes the menu's state from it
and runs no separate status query (`#followStatus` and `#watchPreview`,
`apps/dashboard/src/screens/menus-screen.ts`).

---

## Task 7a: VAT is resolved when the invoice record is issued — slug `vat-at-issuance`

Spec §11.4 (which sharpens §10.4's "at payment") and D6. **Fiscal-adjacent: it changes the VAT rate
filed for a held order, a tab, an invoice-first order and a card payment. The golden huella and
`inmutabilidad` pass unedited.** It does not depend on Tasks 1–6 and could land at any point before
Task 7. The classification plan's Task 2 takes its snapshot in the SAME pass this task defines, so
whichever lands second reuses the other's seam.

**The rule, per filing path** (from "What the code is today"; re-check each line before building):

| Path | Where the rate is resolved | Test |
| --- | --- | --- |
| `POST /api/sales`, walk-up | `createOpenOrder` → `priceOrderLines` in the paying request: already current | Control only: files exactly as before. |
| `POST /api/sales`, held order / tab / split check | `priceStoredOrder` in `payWorkingOrder` (`till-sale.ts:364`) | Spec §10.7(6): added at 10%, corrected to 21%, files at 21%, gross unchanged. |
| `POST /api/pay`, P1 | `priceStoredOrder` / `createOpenOrder` at `till-sale.ts:700-709`; P3 files P1's result | The class changes between P1 and P3 (a stub provider): the sale files P1's rate, and the receipt's lines match the sale. |
| `POST /api/pay`, recovery | `priceStoredOrder` in `finalizeRecovery` (`:900`) | A captured payment with no sale, the class changed since: recovery files the CURRENT rate; the gross equals the captured amount less the tip. |
| `POST /api/working-orders/:id/place` (invoice-first) | `priceStoredOrder` in `placeOrder` (`working-order.ts:2530`) | Placed at 10%, class corrected, collected: the sale keeps 10%, and `collectOrder` reads `sales.total` and re-prices nothing. |
| `POST /api/working-orders/:id/collect` (ticket-then-pay) | `priceStoredOrder` in `collectOrder` (`till-sale.ts:1282`) | Added at 10%, corrected before collect, files at 21%. |

_2026-09-25: the till's filing sites in this table now call `priceStoredOrderForIssuance` and then
`issuancePass` (`apps/server/src/issuance-pass.ts`); `priceStoredOrder` is now only the wrapper
`readSettledTicket` uses to rebuild a filed ticket. The VAT rate change belongs in `readLockedLines`
and the pricing it feeds, or in the issuance pass, not in the `priceStoredOrder` wrapper._

**Files:**
- Modify: `apps/server/src/working-order.ts` (`priceStoredOrder` / `readLockedLines`, around
  `:465-523`): the pass resolves each line's VAT class from its product's CURRENT effective VAT
  class — variant fallback included, extras by their own product — once per sale, never per line,
  **and writes the resolved rate back onto `working_order_lines.vat_rate` in the same transaction
  before the record is filed**, so `readSettledTicket`'s reprint (`till-sale.ts:434-436`), which
  re-runs `priceStoredOrder`, prints the rate that was filed. After filing, the order is settled or
  placed, and no path prices it again. `packages/catalogue/src/pricing.ts` (`priceLockedLines`,
  `:215`) takes the resolved rates.
  - The stored `unit_price_gross` stays the price.
  - The stored `vat_rate` on `working_order_lines` is what the till displayed before issuance, and
    the issued rate after it. Say so at the column (`packages/db/src/schema/orders.ts`).
- Modify: `docs/developers/products.md` or the pricing doc that states when VAT is fixed (grep
  "vat_rate"), and `docs/backlog.md` (asesor Q26 is the open check).
- Test: `working-order.pay-and-dispatch.test.ts`, `tabs.test.ts`, `till-sale.test.ts`, the
  invoice-first and collect suites (grep `placeOrder\|collectOrder` under `apps/server/src/*.test.ts`),
  the integrated-payment suite with the stub provider, and the golden and `inmutabilidad` suites
  (unedited).

_2026-09-26: as built, the write-back happens only while the order is open, because
`working_order_lines_require_open_parent_update` refuses an update of a line whose order is not
open. An order issued while placed (a ticket-then-pay collect) is priced at collect and keeps its
stored rate on the line, while the filed record carries the issued rate; a rebuilt ticket takes its
VAT breakdown from the filed record (`readSettledTicket`, `apps/server/src/till-sale.ts`). The rate
resolution reads the VAT class in the same query as the lines, not through a separate catalogue
reader._

- [ ] **Step 1: Write the failing tests:** the table's six cases, plus:
  - the same for a tab line and for an extras child line whose own product's VAT class changed;
  - a variant with no VAT class of its own follows its parent's CURRENT class;
  - **write-back:** after filing, `working_order_lines.vat_rate` equals the filed rate, and the
    reprint's lines equal the receipt's;
  - **one read per sale:** count prepared queries for a five-line order; the number does not grow
    with the lines;
  - **no existing test changes a VAT class between add and pay** (the plan review ran
    `grep -rn "vat_rate\|vatRate"` over `pay-and-dispatch` and `tabs` suites: no hits; the ten
    case-insensitive `vat` hits are fixture fields and breakdown assertions whose class never
    changes). What those suites pin is the add-time PRICE, which stays: leave them unedited and
    write the new cases. If a suite does turn out to pin add-time VAT, it is an owner-decided
    change — name it in the PR (Global Constraints).
  - Run them: they FAIL.
- [ ] **Step 2: Implement. Step 3: Run the focused tests, `apps/server`'s `test:coverage`, and the
  golden and `inmutabilidad` suites unedited. Commit.**

---

## Task 7b: Editing a saved order — the server rules — slug `order-edits`

Spec §10.3, §11.3, §11.4 (D22), §11.5, §10.7 examples 2, 3 and 5, §11.7 examples 4, 5, 7 and 9, and
D10. **It touches the order path, the kitchen and the payment path, so it takes the full review
wave.** It needs no published menus: until Task 7, an edit prices new and changed lines from the
current offers, as today, and Task 7 switches that to the live document. The staff-facing Change
action and the kitchen screen's notices are Task 7c; this task delivers the routes and rules they
call, and its tests drive them directly.

**Files:**
- Modify: `packages/db/src/schema/orders.ts` — `working_orders.revision` (default 0),
  `working_orders.payment_attempt_at` (nullable timestamp, D22), `working_order_lines.sent_at`
  (nullable timestamp) and `working_order_lines.extra_list_id` (a
  plain id, nullable, child lines only, NO key: say at the column that a list can be deleted while
  an order that took from it is open, and that `validateExtraSelections` is what established the
  list existed); `packages/db/src/schema/ticket-items.ts` — `ticket_items.quantity` (the quantity
  fired). One generated core migration. Measure it on a seeded scratch venue: it must be
  `ADD COLUMN` only, and if it is a rebuild, STOP and record it. (The plan review generated
  `sent_at` and `ticket_items.quantity` in a throwaway checkout at `9e7beee9d` and got two plain
  `ALTER TABLE … ADD` statements; the other two columns are the same shape, so a rebuild would be
  news.)
- Create: `packages/venue-service/src/schema/settings.ts` (`service_settings`: one row, `id` pinned to
  1 by a check like `content_languages_singleton_ck`, and `edit_sent_lines` a flag defaulting to on)
  and `packages/venue-service/src/schema/kitchen-notices.ts` (`kitchen_notices`, D10's columns),
  with one generated venue-service migration, classification entries (both `state`) and
  configuration transfer for `service_settings` (notices are operational rows, NOT transferred —
  say so in the transfer test).
- Create: `packages/venue-service/src/kitchen-notices.ts` + test (`recordKitchenNotices`,
  `listStationNotices`, `acknowledgeKitchenNotice`).
- Modify:
  - `apps/server/src/working-order.ts`: `updateHeldOrder` gets the pricing rules, the kitchen-state
    rules, line numbering after the highest `line_no`, the revision check, the unavailable refusal
    and the in-flight refusal (D22); a new `updateOrderLine` for the per-line route; `fireLines`,
    `sendLines` and `fireCourse` stamp `sent_at` (no-route lines included) and write
    `ticket_items.quantity`; `carveOffLines` copies `sent_at`, `served_at`, `course_id`, `note` and
    `extra_list_id` and refuses a partial split of a started line; `fireCourse` and `sendLines`
    stamp a course's no-route lines; `voidTabLine` gains a quantity and records the notice (started
    or not) before the delete; `recallLines` records notices; the send path refuses an unavailable
    line with no fired ticket and the pay path refuses an unavailable line without `sent_at`; every
    line write checks D22's mark, and P1, P3, the failure path and the recovery branch of
    `payWorkingOrderIntegrated` (`till-sale.ts`) set and clear it.
  - `apps/server/src/modifier-selection.ts` (`ExtraChild` and `matchExtraChildren` carry and match
    `listId`), `apps/server/src/kitchen-print.ts` (its correction path calls the notice recorder
    beside the slips), `apps/server/src/till-api.ts` (the per-line route, the quantity on the void
    route, the notice routes, and the station queue route returning notices), `device-api.ts` (the
    device-cookie twins), `apps/server/src/live-resources.ts`.
  - The venue-service dashboard (a switch "Allow changes to items already sent to the kitchen" on
    the venue settings, with EN and ES strings); `apps/till/src/api/client.ts` (`HeldExtra.listId`,
    the revision on `updateWorkingOrder`, `updateOrderLine`, `voidLine(quantity)`, the notice
    calls), `apps/till/src/state/held-extras.ts` (reads `listId` instead of guessing) and
    `till-app.ts` (send the revision; on the out-of-date refusal, reload the order and say so); the
    i18n codes.
- Test: `working-order.test.ts`, `tabs.test.ts`, `kitchen-print.test.ts`, `modifier-selection.test.ts`,
  the split and transfer suites, the integrated-payment suite (D22 with the stub provider), the
  till app tests, and the venue-service dashboard tests.

**Interfaces:**
- Produces:
  ```ts
  // working-order.ts
  export async function updateOrderLine(tx, cfg, orderId: string, lineNo: number, patch: { quantity?: number; note?: string | null; options?: OptionSelection[]; extras?: ExtraSelection[] }, revision: number): Promise<void>;
  export async function voidTabLine(tx, cfg, tabId: string, lineNo: number, quantity?: number): Promise<void>; // absent = the whole line
  // kitchen-notices.ts
  export type KitchenNoticeKind = "recalled" | "void" | "changed";
  export interface KitchenNotice { id: string; stationId: string; workingOrderId: string; orderLabel: string; kind: KitchenNoticeKind; lineName: string; quantity: number; note: string | null; wasStarted: boolean; createdAt: string }
  export async function recordKitchenNotices(tx, cfg, orderId: string, items: { workingOrderLineId: string; stationId: string; quantity: number; wasStarted: boolean }[], kind: KitchenNoticeKind): Promise<void>;
  export async function listStationNotices(tx, cfg, stationId: string): Promise<KitchenNotice[]>; // unacknowledged, oldest first
  export async function acknowledgeKitchenNotice(tx, cfg, id: string): Promise<void>; // kitchen_notice.not_found
  // wire
  // PUT /api/working-orders/:id/lines/:lineNo  { quantity?, note?, options?, extras?, revision }
  // DELETE /api/working-orders/:id/lines/:lineNo?quantity=1
  // GET /api/stations/:id/queue → { items, notices: KitchenNotice[] }; POST /api/kitchen-notices/:id/acknowledge; device twins under /api/device/…
  // HeldExtra gains listId: string
  ```

  _Corrected 2026-09-26, against the code on `feat/menus-order-edits` (Task 7c is built from what
  follows, not the block above):_
  - _The notice functions live in `packages/venue-service/src/kitchen-notices.ts`, reached through
    `VENUE_SERVICE`. `KitchenNoticeKind` is `"recalled" | "void" | "changed" | "moved"`;
    `KitchenNotice` also carries `movedTo: string | null`, and its `quantity` is a `Decimal` (a
    decimal string). `recordKitchenNotices` takes a last `movedTo: string | null = null` argument,
    for a `moved` notice only, and each item's `quantity` is a `Decimal`._
  - _`updateOrderLine`'s `patch.quantity` and `voidTabLine`'s `quantity` are decimal strings, not
    numbers. `updateOrderLine` resolves the order's new revision (`Promise<number>`)._
  - _`PUT /api/working-orders/:id` and `PUT /api/working-orders/:id/lines/:lineNo` answer
    `{ revision }`, and `GET /api/working-orders/:id/lines` answers `{ lines, revision }`. The till
    stores the revision `GET /api/working-orders/:id` answers when it loads an order and the one
    `PUT /api/working-orders/:id` answers; nothing in the till reads the revision the per-line
    `PUT` or `GET /api/working-orders/:id/lines` answers yet.
    `DELETE /api/working-orders/:id/lines/:lineNo` answers an empty body._
  - _A save or a line edit that changes nothing answers the revision unchanged (`countEdit` in
    `apps/server/src/working-order.ts`)._
  - _`HeldExtra.listId` is `string | null`._

- [ ] **Step 1: Write the failing tests:**
  - **Pricing:**
    - a held order with L1 (Lemonade €3.00), L2 (Water €2.00) and L3 (Burger €12.00 with Extra cheese
      €1.00);
    - the product prices then change to Lemonade €2.50, Water €1.80, Burger €13.00, cheese €1.20,
      Bacon €1.50;
    - an edit changes Water's NOTE, adds Bacon to the Burger and adds a Coffee;
    - L1 stays €3.00, L2 stays €2.00, the Burger stays €12.00 with its cheese at €1.00, and the new
      Bacon (€1.50) and Coffee are priced now;
    - every re-inserted line keeps its stored names, descriptions, category text, `extra_list_id`,
      `sent_at` and served state, and new lines are numbered after the highest `line_no`.
    - Changing L1 to its "Large" variant makes it a new item at the current price.
    - **Extras-list identity** (spec §11.7 example 7): Extra cheese offered by "Toppings" at €1.00
      and "Premium toppings" at €1.50; a line took it from Premium toppings; a note edit keeps
      €1.50 and `extra_list_id` = Premium toppings. Premium toppings' price rises to €1.80: the
      line still keeps €1.50. Premium toppings stops offering cheese: the line keeps €1.50, and a
      NEW cheese pick prices from Toppings. A pick that differs only in which list it came from is
      a new pick. **Control:** before this task, `matchExtraChildren` refused the two-list case and
      the whole order was re-priced — watch that fail first.
    - The existing quantity-only guard case stays unchanged.
  - **`sent_at`:**
    - a tab round with a Burger (routed) and a bottled beer (`no_preparation`): both lines get
      `sent_at`; the Burger has a ticket with `quantity = 1`, the beer has none;
    - a held-course line (`hold: true`) has no `sent_at` until it fires — a ROUTED one and a
      no-route bottle under the same held course; when the course fires, both are stamped;
    - a parked counter order stamps nothing; placing it stamps every line;
    - a recalled line keeps its `sent_at`.
  - **Splits** (Review Focus 6): a partial split of a fired line copies `sent_at`, `served_at`,
    `course_id` and `note` to the new row; the ticket stays on the source with `quantity`
    unchanged, and `listStationQueue` still reports the fired quantity; both checks pay after the
    product goes unavailable. The refusal of a partial split of a dish with extras stays, and a
    partial split of a `preparing` line is refused `ticket.already_started` while a whole-line move
    of it succeeds and keeps its ticket.
    **Overturned 2026-09-26 (the owner's answer):** the split row gets its own ticket row, copied
    from the original, at the quantity moved, and the source's ticket drops by that quantity; a
    partial split of a `preparing` or `ready` line succeeds, edits of either row stay refused
    `ticket.already_started`, and the split writes no notice and no print job.
    **Changed 2026-09-26 (the owner's answer to item 4):** a split onto a check still writes
    neither; a transfer or unjoin that takes sent work to another table writes a MOVED notice and
    slip (below).
  - **Kitchen, sent and not started:**
    - a fired tab line (`state = 'queued'`) changed to "no onions" through
      `PUT /api/working-orders/:id/lines/:lineNo` gets a RECALLED notice AND slip for the old ticket
      item and a new ticket item for the changed line; the price is unchanged;
    - the same through `PUT /api/working-orders/:id` (the counter basket's save) — never a silent
      cascade delete (the regression from #623's finding);
    - a quantity rise from 1 to 2 leaves the fired item at 1 and adds a new line of 1, fired as new
      work where the order has fired work;
    - a drop from 2 to 1 records a VOID notice and slip for 1, and the ticket's `quantity` reads 1.
  - **Kitchen, started and setting off:**
    - a started item is refused with `ticket.already_started`, and nothing changes;
    - voiding a started item records a VOID notice with `wasStarted: true` before the delete;
    - `voidTabLine` with `quantity` less than the line's voids that part only;
    - with `service_settings.edit_sent_lines` off, a fired, queued item is refused with
      `ticket.already_fired` on edit AND on recall (`recallLines` refuses it too); voiding it
      prints the VOID slip, records the notice and removes it from the bill; with the setting on,
      a recalled line edits freely;
    - **recall, sold out, send again:** a queued line is recalled, its product goes unavailable,
      and Send is refused `product.unavailable`; the same line pays if it had `sent_at` and was
      not recalled;
    - the no-route line, the held-course line (`fired_at` null) and the recalled line stay freely
      editable in every case.
  - **Notices without a printer** (Review Focus 7): a station with no `station_printers` row: a
    recall, a void and a change each leave a notice `listStationNotices` returns, and
    `enqueuePrintJob` is never called. With a printer: notice AND slip. Acknowledging removes it;
    an unknown id is `kitchen_notice.not_found`.
  - **Moved** (added 2026-09-26, the owner's answer to item 4, spec §11.5's dated note): sent work
    that `transferLines` (whole or part), `unjoinTable`, `moveTab`, `mergeTabs` or `moveTabLines`
    takes to another table records a `moved` notice, with `movedTo` the table it now belongs to,
    at the quantity its ticket asks for, and prints a MOVED slip naming both tables, and both order
    numbers where they differ; held work and a move that keeps the table (a split onto a check, a
    check merged back into its tab) record nothing.
  - **Revision:** two edits made from the same revision — the first lands and the second is refused
    as out of date, with nothing changed. The till reloads the order and shows a message (spec §10.7
    example 2).
  - **D22:** with the SIMULATOR provider paused in P2 (it writes no `attempting` row, so this is
    the control that the guard does not read the payments store), a new round, a line edit and a
    void on that order are each refused `order.payment_in_flight`; after the attempt settles, and
    separately after it fails, each succeeds, and `payment_attempt_at` is null again. A different
    order is never blocked. A mark left by a crash is cleared by the recovery branch.
  - **Unavailable:** an unsent line whose product became unavailable is refused at send and at pay
    with `product.unavailable`. After it is removed, the order pays. A line with `sent_at` of an
    unavailable product still pays, with and without a route. A split (`splitOffCheck`) pays the
    eligible lines (spec §10.7 example 5).
  - **Allergens:** a retrieved held order shows the allergens the line was added with, not the
    product's current ones (spec §11.1; revision 2's test read the other way).
  - Run them: they FAIL.
- [ ] **Step 2: Implement. Step 3: Run the focused tests and `apps/server`'s and `apps/till`'s
  `test:coverage` locally. LOOK at the till's reload message and the settings switch, in both themes.
  Commit.**

---

## Task 7c: Changing a sent line from the till, and notices on the kitchen screen — slug `order-edits-ui`

Spec §11.5, §11.6 and §10.7 example 3, the staff-facing half of D10 and D11's kitchen-screen poll.
Browser tests in real Chromium. It depends on Task 7b's routes and needs no published menus.

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (a **Change** action on a sent,
  not-started line beside Recall, and on a no-route line; it opens the line's note, options and
  extras in the existing modifier and note editors, prefilled from the held line, and saves through
  `updateOrderLine` with the order's revision; a started line keeps Cancel only, and Cancel now asks
  "Cancel 1 of 2?" for a multi-quantity line), `till-app.ts` (the handlers, the out-of-date reload
  message, the `ticket.already_started` and `ticket.already_fired` messages), `widgets/basket.ts`
  if the editors live there, `i18n/strings.ts` and `i18n/codes.ts`.
- Modify: `apps/till/src/screens/till-station-screen.ts` and `widgets/station-queue.ts` (a notices
  strip above the queue: kind, line, quantity, order label, "started" where set, and an Acknowledge
  button; the screen polls its queue and notices every 15 seconds, D11), `api/client.ts`.
- Test: `till-table-order-screen.test.ts`, `till-station-screen.test.ts`, `station-queue.test.ts`,
  their a11y tests, and `till-app.test.ts`.

- [ ] **Step 1: Write the failing tests** (real Chromium):
  - **Change on a queued line** (spec §10.7 example 3, the acceptance example itself): a table with
    a fired Burger; tapping Change opens the note editor; typing "no onions" and saving calls
    `PUT /api/working-orders/:id/lines/:lineNo` with the note and the revision; the line shows the
    note and the same price afterwards. A stubbed `ticket.already_started` answer shows the
    localised message and offers Cancel. A stubbed out-of-date answer reloads the order and says
    so.
  - **Change is offered for:** a queued fired line, a recalled line and a no-route line; **not
    for:** a preparing or ready line (Cancel only), an extras child row, or any line that was ever
    sent when the venue setting is off. **With the setting off, Recall is hidden too** (the screen
    reads the setting from the order payload; the server refuses both anyway), so a sent line
    shows Cancel alone. **Cancel is now offered on a queued line too**, beside Recall when the
    setting is on, so that "can only be voided" always has a button.
  - **Partial cancel:** a fired line of 2 offers "Cancel 1" and "Cancel all"; "Cancel 1" calls the
    void route with `quantity=1`.
  - **Kitchen screen notices:** a stubbed queue answer with two notices renders them above the
    items in order, the void of a started item reads "started", text and an icon distinguish the
    three kinds (never colour alone; 2026-09-26: four, with `moved`, which names its `movedTo`
    table — Task 7b's Moved step), Acknowledge calls the route and removes the row, and the
    screen re-fetches on the 15-second timer (fake timers, advanced past an awaited frame per
    CLAUDE.md §4).
  - **The a11y tests** cover the Change editor, the partial-cancel dialog, and the notices strip
    with each kind, in both themes.
  - Run them: they FAIL.
- [ ] **Step 2: Implement. Step 3: Run `apps/till`'s `test:coverage` locally. LOOK at the table
  screen and the kitchen screen at till and phone widths, in both themes and both languages.
  Commit.**

---

## Task 7: Tills sell from the published version — slug `sell-published`

Spec §4's "published rendering and pricing must use that captured content", §11.1's live
availability, §11.2's basket refresh, D9, D11, D12's server half and D17 (the order-editing rules of
D10 are Tasks 7b and 7c; VAT at issuance is Task 7a). **This is the sale path. It is fiscal-adjacent:
the golden huella and `inmutabilidad` pass unedited.**

**Files:**
- Modify:
  - `packages/venue-service/src/operations.ts`: `listZoneOffers` serves live documents through
    `applyLiveFields` (the availability overlay, D6); `recordWorkingLineContexts` takes the
    already-resolved offers and makes no per-line read; readiness gains `zone.menu_unpublished`;
    a new `unavailableSet(tx, zoneId)` behind `/api/menu-state`.
  - `packages/catalogue/src/menu-publication.ts` (`assertLiveVersions`).
- Modify: `apps/server/src/working-order.ts` (`priceOrderLines` prices each unsaved line — dish,
  variant, extras, options — from the LIVE document, replacing `resolveBasketModifiers`' live-row
  extras pricing at `:142-190`, after `assertLiveVersions` has checked every asserted version;
  Task 7b's edit paths price new and changed lines the same way), `till-sale.ts`, `till-api.ts`
  (`GET /api/menu-state`, session-gated; the offers responses carry `versionId` per menu).
- Modify: `apps/till/src/api/client.ts` (each unsaved line sends the `menuVersionId` it was priced
  against), `till-app.ts` (the refresh flow, D9 — note `#onCounterZoneSelected` DISCARDS an offers
  reload when the basket has lines, `till-app.ts:903`; the refresh flow must not go through that
  guard), `state/order-line.ts`, `state/working-order.ts`;
  create `apps/till/src/state/menu-state-poll.ts` and `widgets/basket-refresh-dialog.ts` (+ test +
  a11y test). Unavailable offers arrive marked; grey them in the existing `widgets/product-grid.ts`
  for now (Task 9 replaces the grid), and apply the poll's unavailable set to loaded offers without
  a reload.
- Modify:
  - `packages/venue-service/src/schema/service.ts`: `working_line_contexts` gains
    `menu_version_id` (plain id, nullable for lines added before this task; a generated migration,
    measured on a seeded scratch venue). `recordWorkingLineContexts` writes it for every new line;
  - `apps/server/src/testing/zone-offers.ts` (fixtures publish); the demo seed publishes;
  - **every suite that builds its own menu and sells publishes it** (an absent `menuVersionId` then
    means the live version, D9, so the request bodies stay as they are). The plan review found about
    eight that build menus directly rather than through the helper: `working-order.test.ts`,
    `till-api.test.ts`, `served-at-huella`, `tabs`, `till-sale`, `till-api.receipt`,
    `till-api.fiscal-sale-paths` and `sale-till-source.receipt`. Find the full set with
    `grep -rln "createMenuItem\|addMember\|zone-offers" apps packages --include='*.test.ts'`.
    `packages/fiscal-verifactu/src/write-path.e2e.test.ts` is NOT touched here: its `wineOffer`
    fixture prices through `listMenuOffers` and `priceBasket` directly (`:730-790`), so it needs no
    publish (its section edit is Task 3's);
  - `packages/module/src/module.ts` (the `ZoneMenuOffer` wire shape gains `available` and the menu's
    `versionId`);
  - `sale_lines.menu_version_id`: the sales classification plan's Task 2 runs BEFORE this plan
    (one lane, owner 2026-09-25) and leaves the column null. This task fills it at issuance from
    `working_line_contexts.menu_version_id`;
  - `apps/server/src/till-api.ts:791`'s comment "the till re-prices on retrieve" is contradicted by
    `apps/till/src/till-app.ts:1025`; correct it while here;
  - `apps/till/src/i18n/codes.ts` (`menu.version_changed`), and
    `packages/venue-service/src/dashboard/strings.ts` (the readiness wording for
    `zone.menu_unpublished`, in English and Spanish, beside `zone.menu_empty`'s);
  - `docs/backlog.md` (and a line there for the later till-session branch on the SSE route, D11).
- Test: `working-order.test.ts`, `till-sale.test.ts`, `working-order.pay-and-dispatch.test.ts`,
  `tabs.test.ts`, `till-api.test.ts`, `packages/venue-service/src/operations.test.ts`, and the till's
  client, state, dialog and app tests; the golden and `inmutabilidad` suites run unedited.

**Interfaces:**
- Consumes: Task 6's `readLiveDocuments` and `applyLiveFields`.
- Produces:
  ```ts
  export async function assertLiveVersions(tx: Transaction, allowedMenuIds: readonly string[], asserted: readonly { menuId: string; versionId: string }[]): Promise<Map<string, { versionId: string; document: MenuDocument }>>; // throws menu.version_changed with params { menus: [{ menuId, liveVersionId }] }
  // wire: every UNSAVED order line the till sends gains `menuVersionId?: string` — the version it was priced against; absent means the live version (D9)
  // GET /api/menu-state?zoneId= → { menus: { menuId: string; versionId: string }[], unavailable: { products: string[]; optionLabels: string[]; extraItems: { menuItemId: string; productId: string }[] } }
  // till: `basket-refresh-dialog` takes { changed: { lineNo, name, from, to }[], blocked: { lineNo, name, reason: "removed" | "unavailable" | "variant_removed" | "extra_removed" | "extra_unavailable" }[] } and emits wt-basket-refresh-confirmed / wt-basket-refresh-cancelled
  ```

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 2**, in full, through `POST /api/sales` and the till.
  - **Review Focus 1's till half:** after the allergen and VAT changes without a republish, the
    served offer still carries the PUBLISHED allergens on the dish and the extra; after a republish
    it carries the new ones. The filed VAT is Task 7a's. The golden fingerprint is unaffected because
    its fixture changes nothing.
  - **Provenance:** a held line and a tab line record `working_line_contexts.menu_version_id` when
    added. Paying them hours later, after another publish, files `sale_lines.menu_version_id` = the
    version each line came from, not the live one, and their prices are unchanged (D10).
  - **The refresh flow's three outcomes** on the till, with stubbed answers: silent adoption when
    only an unrelated section changed; the dialog with a price change ("Lemonade €3.00 → €2.50"),
    confirmation, and the next request asserting the new version; and a blocked line (removed, or
    its extra unavailable) that keeps Pay disabled until the line is removed or replaced. Cancelling
    the dialog keeps the basket as it was and Pay disabled.
  - **Extras price from the document:** an extra whose list price changes after publish is charged
    at the PUBLISHED price, and an extras item made unavailable after publish is refused.
  - **Review Focus 5's server half:** an unavailable product is served with `available: false` in
    its place, and a line for it is refused `product.unavailable`.
  - **The unavailable set** (spec §11.7 example 2): mark Burger unavailable on the dashboard; the
    next `/api/menu-state` lists it, `versionId` is unchanged, and Lunch's status is still
    `current`. The till greys Burger within one poll without reloading offers (count the offers
    requests), and a Burger already in the basket is flagged as blocked. Making it available again
    clears both. The same for an option label and a per-offer extras item.
  - **One snapshot per version:** a basket with three different offers from two versions reads each
    document once and makes no per-line catalogue read.
    - Count PREPARED QUERIES, as `packages/venue-service/src/operations.test.ts`'s "resolves a menu item once however many lines of the round share it" case (around line 1424) already does. A
      spy on `VENUE_SERVICE.listZoneOffers` cannot see the package-internal `resolveZoneOffer` call.
    - The plan review measured today's cost with that counter: two lines of one item took 10
      queries, and two different items took 17.
    - The test asserts the count does NOT grow with the number of distinct offers. Write it first
      and watch it fail on today's code.
  - **Unpublished menus:** a zone whose only menu is unpublished serves no offers and reports
    `zone.menu_unpublished`.
  - **Park, tab round, pay:** unchanged behaviour for stored lines. The existing tests (for example
    `working-order.pay-and-dispatch.test.ts:724`) stay unedited.
  - **The till:**
    - `menu-state-poll` fires every 15 s only while signed in, stops on sign-out, and treats
      `session.required` as signed out;
    - `/api/menu-state` refuses a request without a till session;
    - a changed `versionId` runs the refresh flow while keeping the basket's lines;
    - `menu.version_changed` on pay runs the refresh flow, and a silent adoption retries the pay
      once.
  - Run them: they FAIL.

- [ ] **Step 2: Implement.**
  - In `priceOrderLines`, collect the asserted versions per menu, call `assertLiveVersions` ONCE
    before the loop, apply the overlay once, and price each line, extras and options included, from
    the live document.
  - A line whose `menuItemId` is not in the live document is refused `service_zone.offer_not_allowed`,
    the existing code.
  - Keep "ignores a browser-sent price".
  - Walk-up, park and tab rounds all go through it. `priceStoredOrder` is unchanged.
  - The unavailable set is one query per table (products, option labels, per-offer extras items),
    restricted to the zone's live documents' ids.
  - `/api/menu-state` is a READ polled by every till every 15 s. `requireSession` runs inside
    `withTransaction`, which IS the write lock (`till-session.ts:62`; CLAUDE.md §3). Grep how the
    other GET routes on `till-api.ts` read; if a read-only path exists, use it, and if none does,
    say so in the PR and leave the interval at 15 s rather than inventing one here.

- [ ] **Step 3: Run the focused tests, then `apps/server`'s and `apps/till`'s `test:coverage`
  locally** (this task changes values many suites assert), then the golden and `inmutabilidad`
  suites unedited. **LOOK at the till** (greyed tile, the refresh dialog, adoption) **in both
  themes. Commit.**

---

## Task 8: Home layouts — the editor and device selection — slug `home-layouts`

Spec §5 ("A home layout is a menu-owned category", read as a menu-owned section), §6's Home page view, and D13 and D14.

**Files:**
- Create: `packages/catalogue/src/schema/home-layouts.ts` (`deviceProfileHomeLayouts`), one
  catalogue migration, and `packages/catalogue/src/home-layouts.ts` + test.
- Modify: `apps/server/src/catalogue-api.ts` (layout routes: create, duplicate, rename, delete,
  set default; tiles have their OWN routes — add, remove and move — which check reachability; the
  generic member routes refuse every write into a home layout, as Task 1 set),
  `apps/server/src/management-api.ts` (device-profile layout selections).
- Create: `apps/dashboard/src/widgets/home-layout-editor.ts` (+ tests).
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (the Home page tab),
  `screens/device-profiles-screen.ts` (a "Home layouts" section: one picker per menu that has more
  than one layout — Default or a named layout), and the strings.

**Interfaces:**
- Produces:
  ```ts
  export const deviceProfileHomeLayouts = table("device_profile_home_layouts", {
    deviceProfileId: id("device_profile_id").notNull(),
    menuId: id("menu_id").notNull(),
    layoutId: id("layout_id").notNull(),
  }, (t) => [
    primaryKey({ columns: [t.deviceProfileId, t.menuId] }),
    foreignKey({ columns: [t.deviceProfileId], foreignColumns: [deviceProfiles.id], name: "device_profile_home_layouts_profile_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.menuId], foreignColumns: [catalogues.id], name: "device_profile_home_layouts_menu_fk" }),
    // layout_id carries NO key on purpose (D14): a deleted layout must leave the selection in
    // place so the server can report `layout_removed` instead of silently showing the default.
    // What establishes the target exists: setDeviceHomeLayout checks it; afterwards, nothing does.
  ]);
  export async function createHomeLayout(tx, menuId: string, name: string): Promise<{ id: string }>;
  export async function duplicateHomeLayout(tx, layoutId: string, name: string): Promise<{ id: string }>;
  export async function deleteHomeLayout(tx, layoutId: string): Promise<void>; // refuses the default: menu.default_layout_required
  export async function setDefaultHomeLayout(tx, menuId: string, layoutId: string): Promise<void>;
  export async function addShortcut(tx, layoutId: string, ref: MemberRef): Promise<SectionMember>; // menu.shortcut_unreachable
  export async function setDeviceHomeLayout(tx, deviceProfileId: string, menuId: string, layoutId: string | null): Promise<void>;
  export async function deviceHomeLayouts(tx, deviceProfileId: string): Promise<Record<string, string>>; // menuId → layoutId
  ```
  - Classify `device_profile_home_layouts` as `state`. It is venue configuration, NOT `local`: a
    profile is venue-wide. Check it against `scripts/two-file-foreign-keys.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - **Layouts:**
    - create, duplicate (it copies the tiles in order), rename and delete;
    - deleting the default is refused `menu.default_layout_required`;
    - deleting a layout a profile selected leaves the selection row in place (D14), and the
      device-profile screen shows it as "(removed)" with a reset action.
  - **Tiles:**
    - a tile for a product or library section the menu reaches is accepted;
    - an unreachable one is refused `menu.shortcut_unreachable`;
    - a menu-owned section as a tile is refused `menu_section.not_library`.
  - **A home tile adds nothing to the menu:** it adds no `menu_items` row and no offer, and removing
    it removes only the tile (spec §5).
  - **Home page tab:**
    - a layout list with the default marked, and add, duplicate, rename, delete and "make default";
    - the tile editor is Task 2's member-list editor, restricted to reachable choices;
    - tiles show product and section differently in text and shape, never colour alone;
    - a tile whose target left the menu is marked "Not on this menu";
    - a preview at handheld width (3 columns) and till width (6 columns) keeps the same order.
  - **Device profiles:** the Home layouts section saves a selection, and "Default" clears it.
  - **Publishing** now includes the layouts (Task 6's document already carries them), and a tile edit
    flags the menu `changed` (acceptance 8).
  - Run them: they FAIL.

- [ ] **Step 2: Implement. Step 3: Run to verify they pass. LOOK in both themes and at 390px.
  Commit.**

---

## Task 9: The till's home page — slug `till-home`

Spec §5, plus §9's shortcut and deleted-layout behaviour, and D11, D12 and D14's till half.

**Files:**
- Create: `apps/till/src/widgets/menu-browser.ts` (+ test + a11y test).
- Modify:
  - `apps/till/src/widgets/card-grid.ts` (the `product-grid` card renders `till-menu-browser`),
    `screens/till-counter-screen.ts`, `screens/till-table-order-screen.ts`;
  - `api/client.ts` (the offers payload carries each menu's `structure`, `homeLayouts`, and the
    device's chosen layout);
  - `state/menu-state-poll.ts` (the poll now returns `homeLayoutId`), `till-app.ts`, and the i18n
    strings.
- Modify: `apps/server/src/till-api.ts` (`/api/menu-state` resolves the profile's selection per menu
  against the LIVE document, D14, returning `homeLayoutId` and `layoutFallback`),
  `packages/venue-service/src/operations.ts` (the served document carries structure and layouts).
- Delete or retire: `widgets/product-grid.ts` if nothing else renders it; grep first.

**Interfaces:**
- Consumes: the Task 6 document (structure, layouts) served by Task 7, and Task 8's selections.
- Produces `till-menu-browser`:
  - props: `menu: {versionId, root, offers, homeLayouts, homeLayoutId, layoutFallback}`, `locale`,
    `columns` (from the form factor);
  - it emits `till-offer-selected {menuItemId, menuVersionId}` (the existing add-to-basket path
    consumes it).

- [ ] **Step 1: Write the failing tests** (real Chromium):
  - **Layout:** search first, then the shortcut grid, then the full structure (spec §5).
  - **Search** covers the whole published menu whatever section is open, and lists each product
    once (acceptance 5's till half).
  - **Product tiles** open the ordering interaction (variants and modifiers, as today). **Section
    tiles** open the section with a breadcrumb, and are distinguishable by text and an icon.
  - **Review Focus 5's till half**, all three places.
  - **Order is kept** at handheld and till column counts (acceptance 9).
  - **§9 not found:** tapping a tile whose target is missing from the version the device should show
    (the document lacks it) shows "Not found" and reloads the home screen.
  - **§9 deleted layout (D14):**
    - server side: the selected layout is deleted in the working state, and the live document
      still has it, so `/api/menu-state` keeps returning it. After a republish without it,
      `/api/menu-state` returns the default with `layoutFallback: "layout_removed"`;
    - a selection naming a layout that was never published returns the default with
      `layout_unpublished`;
    - the till shows a warning naming the old layout ("The home layout "Counter" was removed —
      showing the default") ONLY for `layout_removed`, then shows the default. It switches silently
      for `layout_unpublished`, and when a manager chose a different layout;
    - a rename changes nothing (D14);
    - switching menus uses that menu's own selection.
  - **Section names:** customer name in the till's language, then the default language, then the
    internal name (D3).
  - **Switched-off products:** a structure member whose offer is absent from the document (switched
    off on this menu, D5) is not shown in the structure, in search or as a tile.
  - **The a11y test** covers home, search results, a section view, an unavailable tile and the
    warning, in both themes.
  - Run them: they FAIL.

- [ ] **Step 2: Implement. Step 3: Run `apps/till`'s `test:coverage` locally. LOOK at the till and
  the handheld at both widths, in both themes and in English and Spanish. Commit.**

- [ ] **Step 4: The closing sweep.**
  - Read the spec's §7 acceptance list and §8's open items against what landed, and write any gap
    into `docs/backlog.md`.
  - Mark the spec's status line with a dated pointer to this plan and its PRs.
  - Update the backlog's Track A entry.
  - Sweep every doc that describes menus or the old per-menu sections (grep `menu_sections`,
    `section`, `parent_id`, `parentId` in `docs/`, READMEs and `CLAUDE.md`). CLAUDE.md §1 says a
    behaviour change retires every receipt about the old behaviour.

---

## Finish (every task)

Each task ends with `/finish-branch` in its worktree (full review wave, Codex in the run-it seat),
then `/land-branch`. The next task starts from a freshly synced `main`. Update `docs/backlog.md` in
the task's own PR wherever the task makes it stale.

## Self-Review notes

- **Spec coverage:**
  - §11 (wins over all): the snapshot plus live availability (§11.1) → D6, D11, Tasks 6 and 7;
    the basket refresh and saved orders (§11.2) → D9, D10, Tasks 7 and 7b; availability and the
    recorded sent state (§11.3) → D10, Task 7b; VAT and classification at issuance (§11.4) → Task
    7a, D22 and the classification plan; kitchen notices (§11.5) → D10, Tasks 7b and 7c; the till's
    Change action (§11.6) → Task 7c; §11.7's examples → 1, 2, 3 (Tasks 6, 7), 4, 5, 7, 9 (Task 7b),
    6 (Tasks 7b, 7c), 8 (Tasks 1, 3, 4; D23).
  - §10: the split and sections → Tasks 1–4 (D1–D4); the add-products flow and "Add to menus…" →
    Tasks 2 and 4; open orders (§10.3) → D9, D10 and Tasks 7, 7b; field lifetimes (§10.4, as §11.1
    and §11.4 amend it) → D6, Task 7a; routing (§10.5) and category reports (§10.6) → out of scope
    here (D20).
  - §1 → Tasks 1, 3 and 6. §2 (read as sections): ordered members, cycles and duplicates → Task 1;
    usages, duplicate and copy → Tasks 1–2; groups are dropped (§10.1).
  - §3: menus and structure → Tasks 3–4; prices → Task 5.
  - §4: publish, status, diff, consistency and images → Task 6; sell from the snapshot, availability
    and baskets → Task 7.
  - §5: home layouts → Task 8; the till home → Task 9. §6: the four views → Tasks 4, 5, 6 and 8;
    the library → Task 2.
  - §7 acceptance: 1 → Tasks 3 and 6; 2 → Task 1; 3 → Tasks 3 and 6; 4 → Task 1; 5 → Tasks 5 and
    9; 6 → Tasks 5 and 6; 7 → Task 6; 8 → Tasks 6 and 8; 9 → Tasks 8 and 9; 10 → every screen task.
  - §8's open items are all answered by D1–D20. §9 → D5 (re-add), D9 and D10 (baskets and held
    orders), D6 (availability), D13 and D14 (shortcuts and layouts), D5 and D19 (overrides).
- **Deliberately not in this plan:** see D20. Also no UI for the per-offer extras overrides (D19),
  and no change to the canvas editor or its cards beyond the `product-grid` card's content.
- **Type consistency:**
  - `MemberRef` and `SectionMember` (Task 1) are used by Tasks 2, 3, 4 and 8.
  - `MenuOffer.placements` (Task 3) is carried by `FrozenOffer` (Task 6).
  - `MenuDocument` (Task 6) is served by Task 7 and rendered by Task 9.
  - `menuVersionId` on the wire comes in Task 7 and is emitted by `till-menu-browser` in Task 9.
  - `extra_list_id`, `sent_at` and `ticket_items.quantity` (Task 7b) are read by Task 7c's screens
    and by the classification plan's Task 2 (`extra_list_id` is not recorded on `sale_lines`; the
    sale line's `product_id` and `parent_line_id` are enough for the reports).
  - `KitchenNotice` (Task 7b) is rendered by Task 7c.
  - `assertLiveVersions` (Task 7) replaces revision 2's `resolveLineVersion`; nothing else named it.
  - `homeLayoutId` joins `/api/menu-state` in Task 9.
- **Owner-facing choices to confirm before the task that builds each:**
  - D6's overlay being availability alone, with allergens waiting for a publish (Task 6);
  - D9's basket refresh: interrupted only when something in the basket changed (Task 7);
  - D10's edit rules, the "Allow changes to items already sent" setting defaulting to ON, and
    the kitchen notices table (Task 7b);
  - D11's 15-second poll and the unavailable set (Task 7);
  - D22's guard against a second device changing an order being paid (Task 7b);
  - VAT at issuance, pending asesor Q26 (Task 7a);
  - D17: a freshly provisioned or imported venue sells nothing until someone publishes a menu
    (Task 7);
  - D12's greyed tiles (Tasks 7 and 9);
  - D13's omit-on-publish (Task 6);
  - D14's "a deleted layout keeps showing until republish" (Tasks 8 and 9);
  - D21's "an imported venue arrives unpublished" (Task 6);
  - D3's "till shows the customer name for a section" (Task 9);
  - D20's deferral of the public, staff-only and not-sold-separately setting.

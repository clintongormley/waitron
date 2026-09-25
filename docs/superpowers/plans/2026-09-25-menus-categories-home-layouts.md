# Menus, reusable sections and home layouts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a venue build menus out of shared, ordered, nestable menu sections. Each menu gets its
own price overrides and a published version that the tills sell from, until the owner publishes the
menu again. Handhelds and tills get a home page: search, a shortcut grid chosen per device, and the
full menu below. A line added to an order keeps its price from then on.

**Architecture:**
- **One ordered membership table** (`section_members`) holds every menu list: a section's members,
  a menu's top level and each home layout. A member is a product or a section. A menu's top level
  and its home layouts are sections the menu owns and nothing else can use.
- **Menu arrangement only.** Sections never feed reporting or kitchen routing. Reporting categories
  are a separate strict tree that this plan leaves alone; the sales classification plan changes
  them.
- **Publishing** freezes one self-contained JSON document per menu version.
- **Tills** read that document, with a short fixed list of fields (availability, allergens, diet,
  VAT class and a few others) read from the current rows instead.
- **Change detection:** a menu is flagged as changed by comparing a hash of the document it would
  publish now with the live version's hash.
**Tech Stack:** TypeScript, Drizzle ORM on SQLite (`drizzle-orm/sqlite-core`, `node:sqlite`), Hono
routes, Lit web components (dashboard, venue-service dashboard, till), Vitest (`useVenueDb` real
SQLite databases; real Chromium for the front-ends).

**Spec:** `docs/superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md`. **Read
§10 first** (the owner's decisions after outside review, 2026-09-25): it wins over everything
earlier. Then read §9, then §1–§8, **reading "category" in §1–§7 as "section"** (§10.1). The sales
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
1, 6, 7, 7b and 8 only ADD tables, columns and triggers; each still applies its migrations to a `main`-migrated,
seeded scratch venue, and states that it upgraded cleanly (a claim, so measured, never assumed). Every dev venue then needs `wa-wt reset demo <name>`. This sits within CLAUDE.md §3's "no
data-migration code until production" rule. **Advice for the owner's box: do not upgrade it
mid-plan; wipe it once after Task 7 lands.** (Revision 1's Task 1 wiped every venue; Revision 2's
Task 1 does not touch `category_details`.)

---

## The decisions this plan makes

The spec left integration details to the plan (§8 and §9's "stays with the plan"). The planner made
these; the owner can overturn any of them before the task that builds it starts. **D6, D9, D10, D12 and
D13 are the ones most worth the owner's eye.**

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
  - **Live fields, never frozen, read from the current rows whenever a document is served or
    priced:**
    - the product's and each variant's `products.active` and `products.available`. NOT the per-menu
      switch `menu_items.active`, which is a menu setting and frozen;
    - an extra item's product `active` and `available`, and an option label's `available`;
    - on the dish, each variant AND each extras item: `vatClass`, `allergens` / `addAllergens`,
      `diet`, `dietDerivation`, `dietOverride`, `dietaryDeclarations` / `suitableFor`
      (`menu-types.ts:158-171` for the extras item's names);
    - on the dish and each variant: `courseId`, and the reporting `category` label.
  - Why these: an allergen declaration is a legal duty (EU 1169/2011), and a wrong VAT on a filed
    invoice cannot be repaired (CLAUDE.md §5). Neither may wait for somebody to remember to
    republish, whether it sits on a dish or on an extra. Availability is live by the spec (§4);
    course and category are routing and reporting, which the spec keeps out of the menu (§2).
  - **VAT's lifetime (spec §10.4, owner 2026-09-25): taken at payment**, for every line, from each
    product's current VAT class. The served offer's VAT is what the till displays; the filing path
    re-reads the VAT class when the invoice is issued (Task 7a). The customer's gross price never
    changes; only the VAT split does. Asesor question Q26 asks the tax adviser to confirm the rule.
  - Everything else the till shows or charges is frozen: names, descriptions, images, prices
    (dish, variant and extras item), units, variants offered, extras lists offered with their picks
    rules, option lists offered with their labels' text, structure, order, and layouts.
- **D7. Change detection by hash; the diff is structural.**
  - `buildMenuDocument` produces the document the working state would publish, with live fields
    excluded.
  - `menuDocumentHash` is SHA-256 over canonical JSON (keys sorted, arrays in order).
  - A menu is *published and current* when that hash equals the live version's `content_hash`.
  - This makes spec §4's rules hold by construction: a reporting-category change is not in the
    document, and a
    product-price edit under an override leaves the effective price the same.
  - `diffMenuDocuments(live, proposed)` returns typed changes, which the Preview tab words as
    "Lemonade added under Drinks".
- **D8. Publish is one write transaction that rebuilds the document inside it.**
  - The request carries the hash the preview showed. If the rebuilt document hashes differently, it
    refuses with `menu.changed_since_preview` (409) and writes nothing, and the screen re-previews.
  - A failure anywhere rolls the whole transaction back, so the previous version stays live
    (spec §4). Writes are serialised (`withTransaction` IS `withWriteLock`, CLAUDE.md §3).
- **D9. A line's price is fixed when it is added; a basket line names the version it came from.**
  - Spec §10.3: a line keeps the price and names it was given when it was added, whether or not the
    kitchen has it, and publishing never changes them. VAT is separate: it is taken at payment (D6,
    Task 7a).
  - Held orders and tabs already store their prices (`priceStoredOrder`). A till's unsaved basket
    exists only on the till until it is paid, so the till sends `menuVersionId` with each line, and
    the server prices that line — dish, variant, extras, options — from that version's document, with
    live fields applied (D6). Today's live-row extras pricing (`resolveBasketModifiers`,
    `working-order.ts:142-190`) moves onto the document.
  - The server accepts the version only if it belongs to a menu the zone serves AND it is live or
    was superseded less than `SUPERSEDED_VERSION_GRACE_MS` = **12 hours** ago. Otherwise it refuses
    with `menu.version_expired` (409).
  - **After `menu.version_expired`, the till never re-prices silently** (spec §10.3, owner
    2026-09-25). It reloads the menu, shows each basket line whose price changed ("Lemonade €3.00 →
    €2.50"), and pays only after staff confirm. A line whose product left the menu must be removed.
  - **An absent `menuVersionId` means the menu's live version**, so existing request bodies stay
    valid.
  - **Every line records its version** where it is stored: `working_line_contexts` gains
    `menu_version_id` (Task 7), so a held or tab line filed hours later still knows its version (for
    `sale_lines.menu_version_id`, the classification plan).
  - **Owner decision flagged:** the grace window lets a signed-in till name any version superseded
    in the last 12 hours, and so its older prices. The server still never takes a price from the
    browser.
- **D10. Editing an open order** (spec §10.3; built in Task 7b).
  - **What an edit prices:**
    - a line whose menu item or variant changes is a NEW item, priced from the version the till sent;
    - an extra added to a line is priced from that version;
    - extras already on the line keep their stored price, matched by value (list, product, quantity
      — CLAUDE.md §3's which-list rule);
    - notes and options carry no price.
    - A line that is re-inserted by the edit path copies its stored gross price, names, descriptions,
      category text and line context. Its VAT is re-read at payment anyway (D6).
  - **What the kitchen sees** — the kitchen state comes from `ticket_items` (`fired_at`, and `state`:
    queued, started, ready):
    - **Not sent** means no ticket item, or one whose `fired_at` is null (a held course, or a line
      recalled by `recallLines`). A line with no preparation route never has kitchen work. The edit
      is free.
    - **Sent, not started** (fired, `state = 'queued'`): the edit is allowed and never silent. The
      old ticket item is recalled with the existing RECALLED slip (`enqueueCorrectionSlips`,
      `apps/server/src/kitchen-print.ts:345`), and the changed line fires as a new ticket item.
    - **Started** (`state` past queued): refused with the existing `ticket.already_started`. Staff
      void the line — `voidTabLine`'s VOID slip path — and add a new one.
    - A quantity RISE on a sent line adds a new line for the difference, priced from the till's
      version, with its extras picks copied and priced from that version. It fires only where the
      order has already fired work: `updateHeldOrder` fires nothing today, and `addTabRound` does.
    - A quantity DROP on a sent line is a partial void: a VOID slip for the removed quantity.
    - Extras lines follow their dish.
  - **The venue setting** "Allow changes to items already sent to the kitchen" (on by default) lives
    in a new one-row `service_settings` table in venue-service, following `content_languages`'
    one-row pattern. When it is off, a sent line can only be voided and re-added (`ticket.already_fired`,
    the existing code).
  - **Line numbering:** re-inserted and new lines are appended after the order's highest `line_no`,
    as `addTabRound` does (`working-order.ts:1150-1156`). `priceRows` numbering from 1 would collide
    with kept lines on `working_order_lines_line_no_key`.
  - **Out-of-date saves:** `working_orders` gains a `revision` counter. Every write to an order
    increments it, and `PUT /api/working-orders/:id` carries the revision its copy came from. A
    mismatch is refused (409, a code named for the concept — grep the working-order codes first),
    and the till reloads the order (spec §10.7 example 2). No revision exists today.
  - **Unavailable:** an unsent line whose product became unavailable cannot be sent or paid
    (`product.unavailable`); the till offers remove or replace. A sent line stays payable. Split
    bills (`splitOffCheck`) let staff pay the rest.
  - **Allergens on a retrieved held order are current:** `getHeldOrder` (`working-order.ts:2202`)
    today builds the till's product from the add-time `context.allergens`; it reads the product's
    current allergens instead (spec §10.4).
  - **The till edits tabs through rounds and voids, not `PUT /api/working-orders/:id`**
    (`till-app.ts:1543-1546` skips the save for tabs). The server path is still guarded, and its
    tests exercise it directly.
  - **Pre-bills do not exist yet** (asesor Q21 and Q14). The rule for when they are built: printing a
    pre-bill never fires held food and never marks a line sent. A `docs/backlog.md` note goes beside
    Q21.
  - This answers the owner's question on PR #623's finding: an edit can no longer silently delete a
    fired line's ticket item.
- **D11. Tills adopt a new version by polling.**
  - `GET /api/menu-state?zoneId=` is session-gated like the offers routes. It returns
    `{ menus: [{ menuId, versionId }] }`, and Task 9 adds the layout fields (D14).
  - The till polls it every 60 s while an operator is signed in, stops on sign-out, and treats
    `session.required` like any other signed-out answer.
  - A poll cannot keep a till signed in: inactivity is measured in the browser from pointer and key
    presses (`apps/till/src/till-app.ts:218, 236-237`), and `requireSession`
    (`apps/server/src/till-session.ts:56-71`) reads a session without extending it (the plan
    review read both).
  - It also checks at every offers load. A changed version reloads that menu's offers at once, and
    lines already in the basket keep their own version (D9).
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
  `menu.changed_since_preview`, `menu.version_expired`, `menu.shortcut_unreachable`,
  `menu.default_layout_required`, `menu.layout_not_found`, and the readiness code
  `zone.menu_unpublished`.
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

1. **A safety or tax fact changed after publishing reaches the till without a republish, and does
   not flag the menu.**
   - Publish Lunch, then change Lemonade's allergens (add `sulphites`) and its VAT class
     (`reduced` → `general`), and the same two facts on the extra "Extra lemon" that Lemonade's extras
     list offers.
   - Without republishing: the till's served offer shows sulphites on the dish AND the extra, a sale
     of Lemonade with Extra lemon files BOTH at 21%, and Lunch is still *published and current*.
   - (Task 6 for the document excluding live fields; Task 7 for the served offer and the filed sale.)
2. **A basket that spans a publish keeps both prices.**
   - Lemonade €3.00 on Lunch v1. The till adds one Lemonade, the owner publishes v2 at €2.50, the
     till polls and adopts v2, and adds a second Lemonade.
   - Paying files 3.00 + 2.50 = 5.50 in one sale.
   - With the clock moved 13 hours past v1's supersession, the first line is refused
     `menu.version_expired`.
   - (Task 7.)
3. **Shared edits flag exactly the menus they change.**
   - Fixture: section Drinks in Lunch and Dinner; section Beer nested in Drinks; Burger only in a
     section Dinner alone uses; Lemonade with a Lunch override.
   - Rename Beer: both flagged. Publish Lunch: Lunch current, Dinner still flagged.
   - Change Lemonade's REPORTING category (a live field, D6): neither flagged. Change Lemonade's product price: Dinner flagged, Lunch
     not. Change Burger's price: only Dinner.
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
  `previewMenu`, `readLiveDocuments`, `resolveLineVersion`.
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
section drill-in with a breadcrumb), `apps/till/src/state/menu-state-poll.ts`, each with a test and
an a11y test.

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
  export async function duplicateSection(tx, sourceId: string, input: { internalName: string; memberIds: string[] }): Promise<LibrarySection>;
  export async function sectionUsages(tx, sectionId: string): Promise<SectionUsages>;
  ```
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
  - `POST /:id/duplicate {internalName, memberIds}` and `GET /:id/usages`.
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
    offers "Duplicate and use the copy here". That calls `duplicate`, then replaces Drinks in THIS
    list at the same position (remove plus add at the position, one request each — no batch route is
    needed).
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
    - saving sends one `PATCH` and one `PUT …/variants`.
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
  export type LiveOfferField = "available" | "allergens" | "diet" | "dietDerivation" | "dietOverride" | "dietaryDeclarations" | "vatClass" | "courseId" | "category";
  export type LiveExtraItemField = "available" | "vatClass" | "addAllergens" | "suitableFor"; // names at menu-types.ts:158-170; `OfferedExtraItem` has NO `available` today — the document adds it
  // offeredModifiers keeps every extras item and option label, with their live fields stripped:
  export type FrozenOffer = Omit<MenuOffer, LiveOfferField | "placements" | "offeredModifiers"> & {
    variants: Omit<MenuOfferVariant, LiveOfferField>[];
    placements: string[][];
    offeredModifiers: FrozenOfferedModifier[]; // extras items without LiveExtraItemField; option labels without `available`
  };
  export interface LiveOffer extends MenuOffer { available: boolean }
  export async function buildMenuDocument(tx: Transaction, menuId: string): Promise<{ document: MenuDocument; omittedShortcuts: { layoutId: string; ref: MemberRef }[] }>;
  export function menuDocumentHash(document: MenuDocument): string;   // sha256 hex of canonical JSON
  export async function applyLiveFields(tx: Transaction, documents: readonly MenuDocument[]): Promise<Map<string, LiveOffer[]>>; // ONE query per live table for all documents
  export type MenuChange =
    | { kind: "product_added" | "product_removed"; productId: string; name: string; under: string[] }  // internal names of the path
    | { kind: "product_moved"; productId: string; name: string; from: string[][]; to: string[][] }
    | { kind: "price_changed"; productId: string; name: string; from: string; to: string }
    | { kind: "product_changed"; productId: string; name: string; fields: string[] }  // names, description, image, variants, extras, options
    | { kind: "section_added" | "section_removed"; sectionId: string; name: string; under: string[] }
    | { kind: "section_changed"; sectionId: string; name: string; fields: string[] }
    | { kind: "order_changed"; list: string[] }
    | { kind: "layout_changed"; layoutId: string; name: string }
    | { kind: "default_layout_changed"; from: string; to: string };
  export function diffMenuDocuments(live: MenuDocument | null, proposed: MenuDocument): MenuChange[];
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
  - `superseded_at` is not stored; it is the next version's `published_at`, which D9 reads in
    Task 7.

- [ ] **Step 1: Write the failing tests** (`menu-document.test.ts`, `menu-publication.test.ts`):
  - **Canonical hash:** the same working state built twice hashes identically, and a hash computed
    from a JSON round trip with keys shuffled equals the original.
  - **Review Focus 3**, in full.
  - **Every extras item and option label is in the document**, available or not: a label unavailable
    at publish and made available afterwards is offered without a republish.
  - **Review Focus 1's document half:** changing allergens, VAT class, availability, course or
    reporting category leaves the hash unchanged, while a name, price, image, variant-offered or
    extras-price change moves it.
  - **Diff:** Lemonade added under Drinks gives `product_added` with `under: ["Drinks"]`; Burger
    €12 → €13 gives `price_changed`; reordering Lunch's root gives `order_changed`; a new menu diffed
    against `null` lists everything as added.
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
    - Preview lists the changes in words and a "Publish Lunch Menu" button (naming the single menu,
      spec §6);
    - a 409 re-previews and says the menu changed;
    - an error keeps "saved" distinct from "published" (spec §6).
  - Run them: they FAIL.

- [ ] **Step 2: Implement.**
  - `buildMenuDocument` reuses `listMenuOffers(…, {includeUnavailable: true})` and the extras and
    options readers with every item included, then strips the live fields. Availability must not
    change the document.
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

---

## Task 7a: VAT is taken at payment — slug `vat-at-payment`

Spec §10.4 (owner, 2026-09-25) and D6. **Fiscal-adjacent: it changes the VAT rate filed for a held
order or tab. The golden huella and `inmutabilidad` pass unedited.** It does not depend on
Tasks 1–6 and could land at any point before Task 7.

**Files:**
- Modify: `apps/server/src/working-order.ts` (`priceStoredOrder` / `readLockedLines`, around
  `:465-523`; each line's VAT class is resolved from its product's CURRENT effective VAT class —
  variant fallback included, extras by their own product — once per sale, never per line), and
  `packages/catalogue/src/pricing.ts` (`priceLockedLines`, `:215`).
  - The stored `unit_price_gross` stays the price.
  - The stored `vat_rate` on `working_order_lines` becomes what the till displayed before payment.
    Say so at the column (`packages/db/src/schema/orders.ts`).
- Modify: `docs/developers/products.md` or the pricing doc that states when VAT is fixed (grep
  "vat_rate"), and `docs/backlog.md` (asesor Q26 is the open check).
- Test: `working-order.pay-and-dispatch.test.ts`, `tabs.test.ts`, `till-sale.test.ts`, and the golden
  and `inmutabilidad` suites (unedited).

- [ ] **Step 1: Write the failing tests:**
  - Spec §10.7 example 6: a held order's drink added at `reduced` (10%) has its VAT class corrected
    to `general` before payment. The filed sale's `vatBreakdown` shows it at 21%, and `sales.total`
    (the gross) is unchanged.
  - The same for a tab line and for an extras child line whose own product's VAT class changed.
  - A variant with no VAT class of its own follows its parent's CURRENT class.
  - **Control:** a line whose VAT class did not change files exactly as before (compare the rows).
  - **One read per sale:** count prepared queries for a five-line order; the number does not grow
    with the lines.
  - **Existing tests that pinned add-time VAT on stored orders:** find them
    (`grep -rn "vat" apps/server/src/*pay-and-dispatch*.test.ts apps/server/src/tabs.test.ts`). Each
    one is an owner-decided behaviour change, so change it and name it in the PR (Global Constraints).
  - Run them: they FAIL.
- [ ] **Step 2: Implement. Step 3: Run the focused tests, `apps/server`'s `test:coverage`, and the
  golden and `inmutabilidad` suites unedited. Commit.**

---

## Task 7b: Editing an open order — slug `order-edits`

Spec §10.3, §10.7 examples 2, 3 and 5, and D10. **It touches the order path and the kitchen, so it
takes the full review wave.** It needs no published menus: until Task 7, an edit prices new and
changed lines from the current offers, as today, and Task 7 switches that to the version the till
sent.

**Files:**
- Modify:
  - `apps/server/src/working-order.ts`: `updateHeldOrder` gets the pricing rules, the kitchen-state
    rules, line numbering after the highest `line_no`, the revision check and the unavailable
    refusal; `getHeldOrder` reads current allergens.
  - `apps/server/src/kitchen-print.ts` (it reuses `enqueueCorrectionSlips` for RECALLED and VOID).
- Modify: `packages/db/src/schema/orders.ts` (`working_orders.revision`, default 0) with a generated
  core migration. Measure it on a seeded scratch venue: it must be `ADD COLUMN` only, and if it is a
  rebuild, STOP and record it.
- Create: `packages/venue-service/src/schema/settings.ts` (`service_settings`: one row, `id` pinned to
  1 by a check like `content_languages_singleton_ck`, and `edit_sent_lines` a flag defaulting to on),
  with a generated venue-service migration, a classification entry (`state`), and configuration
  transfer.
- Modify: the venue-service dashboard (a switch "Allow changes to items already sent to the kitchen"
  on the venue settings, with EN and ES strings); `apps/till/src/api/client.ts` and `till-app.ts`
  (send the revision; on the out-of-date refusal, reload the order and say so); the i18n codes.
- Test: `working-order.test.ts`, `tabs.test.ts`, `kitchen-print.test.ts`, the till app tests, and the
  venue-service dashboard tests.

- [ ] **Step 1: Write the failing tests:**
  - **Pricing:**
    - a held order with L1 (Lemonade €3.00), L2 (Water €2.00) and L3 (Burger €12.00 with Extra cheese
      €1.00);
    - the product prices then change to Lemonade €2.50, Water €1.80, Burger €13.00, cheese €1.20,
      Bacon €1.50;
    - an edit changes Water's NOTE, adds Bacon to the Burger and adds a Coffee;
    - L1 stays €3.00, L2 stays €2.00, the Burger stays €12.00 with its cheese at €1.00, and the new
      Bacon (€1.50) and Coffee are priced now;
    - every re-inserted line keeps its stored names, descriptions and category text, and new lines
      are numbered after the highest `line_no`.
    - Changing L1 to its "Large" variant makes it a new item at the current price.
    - A pick that differs only in which extras LIST it came from is a new pick.
    - The existing quantity-only guard case stays unchanged.
  - **Kitchen, sent and not started:**
    - a fired tab line (`state = 'queued'`) changed to "no onions" through
      `PUT /api/working-orders/:id` gets a RECALLED slip for the old ticket item and a new ticket item
      for the changed line (the till does not edit tabs this way — the test drives the server path
      directly);
    - a quantity rise from 1 to 2 leaves the fired item at 1 and adds a new line of 1, fired as new
      work where the order has fired work;
    - a drop from 2 to 1 sends a VOID slip for 1.
  - **Kitchen, started and setting off:**
    - a started item is refused with `ticket.already_started`, and nothing changes;
    - with `service_settings.edit_sent_lines` off, a fired, queued item is refused with
      `ticket.already_fired`;
    - the no-route line, the held-course line (`fired_at` null) and the recalled line stay freely
      editable in every case.
  - **Revision:** two edits made from the same revision — the first lands and the second is refused
    as out of date, with nothing changed. The till reloads the order and shows a message (spec §10.7
    example 2).
  - **Unavailable:** an unsent line whose product became unavailable is refused at send and at pay
    with `product.unavailable`. After it is removed, the order pays. A fired line of an unavailable
    product still pays. A split (`splitOffCheck`) pays the eligible lines (spec §10.7 example 5).
  - **Allergens:** a retrieved held order shows the product's CURRENT allergens after a change.
  - **The regression from #623's finding:** a non-quantity edit never deletes a fired line's ticket
    item without a slip.
  - Run them: they FAIL.
- [ ] **Step 2: Implement. Step 3: Run the focused tests and `apps/server`'s and `apps/till`'s
  `test:coverage` locally. LOOK at the till's reload message and the settings switch, in both themes.
  Commit.**

---

## Task 7: Tills sell from the published version — slug `sell-published`

Spec §4's "published rendering and pricing must use that captured content", plus §9's baskets and
held orders, D9, D11, D12's server half and D17 (the order-editing rules of D10 are Task 7b; VAT at
payment is Task 7a). **This is the sale path. It is fiscal-adjacent: the golden huella and
`inmutabilidad` pass unedited.**

**Files:**
- Modify:
  - `packages/venue-service/src/operations.ts`: `listZoneOffers` serves live documents through
    `applyLiveFields`; `recordWorkingLineContexts` takes the already-resolved offers and makes no
    per-line read; readiness gains `zone.menu_unpublished`.
  - `packages/catalogue/src/menu-publication.ts` (`resolveLineVersion`, `SUPERSEDED_VERSION_GRACE_MS`).
- Modify: `apps/server/src/working-order.ts` (`priceOrderLines` prices each line — dish, variant,
  extras, options — from its version, replacing `resolveBasketModifiers`' live-row extras pricing
  at `:142-190`; Task 7b's edit path prices new and changed lines from the version the till sent),
  `till-sale.ts`, `till-api.ts` (`GET /api/menu-state`, session-gated; the offers responses carry
  `versionId` per menu).
- Modify: `apps/till/src/api/client.ts` (each line sends `menuVersionId`), `till-app.ts` (adopt on
  poll), `state/order-line.ts`, `state/working-order.ts`; create `apps/till/src/state/menu-state-poll.ts`.
  Unavailable offers arrive marked; grey them in the existing `widgets/product-grid.ts` for now
  (Task 9 replaces the grid).
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
    (one lane, owner 2026-09-25) and leaves the column null. This task fills it at filing from
    `working_line_contexts.menu_version_id`;
  - `apps/server/src/till-api.ts:791`'s comment "the till re-prices on retrieve" is contradicted by
    `apps/till/src/till-app.ts:1025`; correct it while here;
  - `apps/till/src/i18n/codes.ts` (`menu.version_expired`), and
    `packages/venue-service/src/dashboard/strings.ts` (the readiness wording for
    `zone.menu_unpublished`, in English and Spanish, beside `zone.menu_empty`'s);
  - `docs/backlog.md`.
- Test: `working-order.test.ts`, `till-sale.test.ts`, `working-order.pay-and-dispatch.test.ts`,
  `tabs.test.ts`, `till-api.test.ts`, `packages/venue-service/src/operations.test.ts`, and the till's
  client, state and app tests; the golden and `inmutabilidad` suites run unedited.

**Interfaces:**
- Consumes: Task 6's `readLiveDocuments` and `applyLiveFields`.
- Produces:
  ```ts
  export const SUPERSEDED_VERSION_GRACE_MS = 12 * 60 * 60 * 1000;
  export async function resolveLineVersion(tx: Transaction, allowedMenuIds: readonly string[], versionId: string, now: Date): Promise<{ versionId: string; document: MenuDocument }>; // throws menu.version_expired
  // wire: every order line the till sends gains `menuVersionId?: string` — absent means the menu's live version (D9)
  // GET /api/menu-state?zoneId= → { menus: { menuId: string; versionId: string }[] }
  ```

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 2**, in full, through `POST /api/sales`. Use the server's clock seam for the
    13-hour case; if there is none on this path, add one as a parameter, never a global patch.
  - **Review Focus 1's till half:** the served offer carries the new allergens on the dish and the
    extra, and a NEW sale's `vatBreakdown` shows both at 21% (Task 7a already made filing read the
    current VAT class). The golden fingerprint is unaffected because its fixture changes nothing.
  - **Provenance:** a held line and a tab line record `working_line_contexts.menu_version_id` when
    added. Paying them hours later, after another publish, files `sale_lines.menu_version_id` = the
    version each line came from, not the live one.
  - **An expired basket:** after `menu.version_expired`, the till shows each changed line's old and
    new price and pays only after confirmation. A line whose product left the menu blocks payment
    until it is removed.
  - **Extras price from the document:** an extra whose list price changes after publish is charged
    at the PUBLISHED price, and an extras item made unavailable after publish is refused.
  - **Review Focus 5's server half:** an unavailable product is served with `available: false` in
    its place, and a line for it is refused `product.unavailable`.
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
    - `menu-state-poll` fires every 60 s only while signed in, stops on sign-out, and treats
      `session.required` as signed out;
    - `/api/menu-state` refuses a request without a till session;
    - a changed `versionId` reloads offers while keeping the basket's lines and their versions;
    - `menu.version_expired` on pay shows the localised message and reloads.
  - Run them: they FAIL.

- [ ] **Step 2: Implement.**
  - In `priceOrderLines`, collect the distinct `menuVersionId`s (an absent one is the live version),
    resolve each ONCE before the loop, apply live fields once, and price each line, extras and
    options included, from its version's offer.
  - A line whose `menuItemId` is not in its version is refused `service_zone.offer_not_allowed`, the
    existing code.
  - Keep "ignores a browser-sent price".
  - Walk-up, park and tab rounds all go through it. `priceStoredOrder` is unchanged.

- [ ] **Step 3: Run the focused tests, then `apps/server`'s and `apps/till`'s `test:coverage`
  locally** (this task changes values many suites assert), then the golden and `inmutabilidad`
  suites unedited. **LOOK at the till** (greyed tile, adoption) **in both themes. Commit.**

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
  - §10: the split and sections → Tasks 1–4 (D1–D4); the add-products flow and "Add to menus…" →
    Tasks 2 and 4; open orders (§10.3) → D9, D10 and Task 7; field lifetimes (§10.4) → D6 and D9;
    routing (§10.5) and category reports (§10.6) → out of scope here (D20).
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
  - `homeLayoutId` joins `/api/menu-state` in Task 9.
- **Owner-facing choices to confirm before the task that builds each:**
  - D6's live-field list (Task 6);
  - D9's 12-hour grace, which lets a till choose a recent older price, and the confirm-on-expiry
    step (Task 7);
  - D10's edit rules and the "Allow changes to items already sent" setting defaulting to ON
    (Task 7b);
  - VAT at payment, pending asesor Q26 (Task 7a);
  - D17: a freshly provisioned or imported venue sells nothing until someone publishes a menu
    (Task 7);
  - D12's greyed tiles (Tasks 7 and 9);
  - D13's omit-on-publish (Task 6);
  - D14's "a deleted layout keeps showing until republish" (Tasks 8 and 9);
  - D21's "an imported venue arrives unpublished" (Task 6);
  - D3's "till shows the customer name for a section" (Task 9);
  - D20's deferral of the public, staff-only and not-sold-separately setting.

# Menus, reusable categories and home layouts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a venue build menus out of shared, ordered, nestable categories. Each menu gets its own
price overrides and a published version that the tills sell from, until the owner publishes the menu
again. Handhelds and tills get a home page: search, a shortcut grid chosen per device, and the full
menu below.

**Architecture:** One ordered membership table holds every list: a category's members, a menu's
top level and each home layout. A member is a product or a category. A menu's top level and its home
layouts are categories that the menu owns and nothing else can use. Publishing freezes one
self-contained JSON document per menu version. Tills read that document, with a short fixed list of
fields (availability, allergens, diet, VAT class and a few others) read from the current rows
instead. A menu is flagged as changed by comparing a hash of the document it would publish now with
the live version's hash.

**Tech Stack:** TypeScript, Drizzle ORM on SQLite (`drizzle-orm/sqlite-core`, `node:sqlite`), Hono
routes, Lit web components (dashboard, venue-service dashboard, till), Vitest (`useVenueDb` real
SQLite databases; real Chromium for the front-ends).

**Spec:** `docs/superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md`. **§9 (the
owner's decisions of 2026-09-25) comes first and wins over earlier text.** Then read §1–§8. The
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

## Tasks 1, 3 and 6 wipe existing venues

Tasks 1, 3 and 6 rebuild or drop tables that other rows point at. The variants plan measured the
same kind of rebuild in the same tree (`docs/superpowers/plans/2026-09-23-variants-as-products.md`,
"Task 1 cannot upgrade an existing venue"): a drizzle rebuild runs with foreign keys ON inside the
migrator's transaction. That empties cascading children silently, and it fails outright on a child
with no delete rule that holds rows. A media trigger naming the rebuilt table also aborts the rename.

So every such task **measures its own upgrade** on a scratch venue that `main` has migrated and
seeded, and states the result in its PR and in a `docs/backlog.md` line: what is emptied, what
fails. Every dev venue then needs `wa-wt reset demo <name>`. This sits within CLAUDE.md §3's "no
data-migration code until production" rule. **Advice for the owner's box: do not upgrade it
mid-plan; wipe it once after Task 7 lands.**

---

## The decisions this plan makes

The spec left integration details to the plan (§8 and §9's "stays with the plan"). The planner made
these; the owner can overturn any of them before the task that builds it starts. **D6, D9, D10, D12 and
D13 are the ones most worth the owner's eye.**

- **D1. One ordered membership table.** `category_members` holds every list. A member is exactly one
  of a product or a category, and it has a `position` in that list. It replaces `product_categories`
  and `category_details.parent_id`. A unique index per (list, product) and per (list, child category)
  refuses the same object twice in one list (spec §2). Positions are rewritten 0..n-1 on every
  reorder and are NOT unique. That avoids CLAUDE.md §3's "rewriting rows one at a time breaks a unique
  index the final state satisfies"; ties sort by `id`.
- **D2. A menu's top level and each home layout are categories the menu owns.**
  - `category_details` gains a `role` (`library`, `menu_root` or `home_layout`) and an
    `owner_menu_id` (NULL exactly when the role is `library`).
  - A menu-owned category is hidden from the category library, the product editor's category picker,
    the preparation-route pickers and the translation-gap report.
  - It can never be a member of another list.
  - One editing interaction and one reorder API serve all three kinds of list (spec §5, "Use the
    category membership model").
- **D3. Category names.**
  - `category_details.internal_name` is required plain text.
  - Core `categories.name` becomes the OPTIONAL customer-facing map: `{}` is allowed, so the core
    table needs no rebuild.
  - The till and the dashboard's customer previews show the customer name in the viewer's language,
    then the venue's default content language, then the internal name (spec §2).
  - Reporting labels — `working_order_lines.category`, `sale_lines.category` and
    `working_line_contexts.category_name` — record the **internal** name, because reports are
    internal.
  - `listContentTranslationGaps` moves `category` into the optional kinds (only a partly filled map
    is a gap).
- **D4. Reporting and routing do not change.**
  - `products.category_id` is still the reporting category, and still one of the product's direct
    LIBRARY categories or none.
  - Routing still reads a category's station and its preparation routes.
  - Nesting a category in another category or in a menu adds no route, no ticket and no report line
    (spec §2, "Groups organise …").
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
  - A write that REMOVES links — removing a member, deleting a category — works out the affected
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
  - Everything else the till shows or charges is frozen: names, descriptions, images, prices
    (dish, variant and extras item), units, variants offered, extras lists offered with their picks
    rules, option lists offered with their labels' text, structure, order, and layouts.
- **D7. Change detection by hash; the diff is structural.**
  - `buildMenuDocument` produces the document the working state would publish, with live fields
    excluded.
  - `menuDocumentHash` is SHA-256 over canonical JSON (keys sorted, arrays in order).
  - A menu is *published and current* when that hash equals the live version's `content_hash`.
  - This makes spec §4's rules hold by construction: a group rename is not in the document, and a
    product-price edit under an override leaves the effective price the same.
  - `diffMenuDocuments(live, proposed)` returns typed changes, which the Preview tab words as
    "Lemonade added under Drinks".
- **D8. Publish is one write transaction that rebuilds the document inside it.**
  - The request carries the hash the preview showed. If the rebuilt document hashes differently, it
    refuses with `menu.changed_since_preview` (409) and writes nothing, and the screen re-previews.
  - A failure anywhere rolls the whole transaction back, so the previous version stays live
    (spec §4). Writes are serialised (`withTransaction` IS `withWriteLock`, CLAUDE.md §3).
- **D9. A basket line names the version it was added from.**
  - The till sends `menuVersionId` with each line.
  - The server prices that line — dish, variant, extras and options — from that version's document,
    with live fields applied (D6). Today's live-row extras pricing (`resolveBasketModifiers`,
    `working-order.ts:142-190`) moves onto the document.
  - It accepts the version only if it belongs to a menu the zone serves AND it is live or was
    superseded less than `SUPERSEDED_VERSION_GRACE_MS` = **12 hours** ago. Otherwise it refuses with
    `menu.version_expired` (409), and the till reloads its offers.
  - **An absent `menuVersionId` means the menu's live version**, which is today's "current offers"
    behaviour. So existing request bodies stay valid, and suites that do not care about versions
    need no change beyond publishing their menu.
  - This is how §9's "a line already in an open basket keeps the name, price and choices it was
    added with" survives a publish, while a line added after the device adopts the new version is
    priced from the new one.
  - **Owner decision flagged:** the grace window lets a signed-in till name any version superseded
    in the last 12 hours, and so its older prices. The server still never takes a price from the
    browser, but the till chooses which published price applies. The 12 hours is the planner's
    choice, covering a service day.
- **D10. Editing a held order keeps the stored price and names of every unchanged line.**
  - Today a non-quantity edit re-prices EVERY line from the current offers
    (`updateHeldOrder`, `working-order.ts:2233`; the replace path deletes and re-inserts all lines).
    After a publish that changes prices a customer already agreed to, which breaks §9.
  - The change is deliberately narrow:
    - the replace path still deletes and re-inserts, so today's line numbering
      (`working_order_lines_line_no_key`) is untouched;
    - each requested line is first matched against the stored lines by VALUE (menu item, variant,
      extras picks with their list and quantities, options, note — CLAUDE.md §3's rule). The matching
      is a multiset, so two identical lines match two stored ones;
    - a matched line is re-inserted with the matched stored line's unit prices and names, and only
      its quantity is taken from the request;
    - unmatched lines are priced from the version the till sent, which is the version its loaded
      offers came from when it recalled the order.
  - Keeping fired lines' ROWS in place, so their kitchen ticket items survive, is option (b) of the
    owner's open question on PR #623's finding (lane C `questions.md`, 2026-09-25; lane C recommends
    (a)). This plan does NOT decide it. Follow the owner's answer if there is one by Task 7;
    otherwise leave that behaviour exactly as it is and say so in the PR.
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
  search, home tiles and category views. Spec §5 wants buttons in predictable positions during
  service. Today the server filters unavailable products out; from Task 7 it serves them marked.
- **D13. Shortcuts and their targets.**
  - A shortcut may only be added for a product or library category the menu's working structure
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
  - A library category is still a hard delete. It is removed from every list containing it (the
    `child_category_id` key cascades), the reporting category is cleared on its products, and its
    preparation routes are dropped, as today.
  - The confirm dialog names every menu and category that uses it. Published versions are never
    touched; they are self-contained.
  - A product is deleted by `active=false`, as today. The live overlay hides it on tills at once, and
    the working document omits it, so every menu that had it is flagged.
- **D16. Published images stay available.**
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
  `GET /api/products`, which the till does not use.

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
  - Measure the upgrade (see "Tasks 1, 3 and 6 wipe existing venues").
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
  - `scripts/schema-constraints.test.ts` (it pins `category_details(parent_id)->categories`) and
    `packages/catalogue/src/migrations.test.ts` (it pins the key and index lists)
  - `packages/media/src/images.ts:161` (the category image-usage label is built from
    `categories.name`, which may now be `{}`; use the internal name)
  - `apps/dashboard/src/api/live-queries.ts` and `packages/venue-service/src/dashboard/live-queries.ts`
    (guard `scripts/live-subscriptions.test.ts`)
  - `apps/server/src/live-resources.ts`
  - `apps/server/scripts/demo-seed/`
  - `docs/developers/product-categories.md`
- **Error codes name the domain concept and are never renamed** (CLAUDE.md §3). New ones in this
  plan: `category.member_cycle`, `category.member_duplicate`, `category.not_library`,
  `category.invalid` (with `params.field`), `category_group.not_found`, `category_group.invalid`,
  `menu.changed_since_preview`, `menu.version_expired`, `menu.shortcut_unreachable`,
  `menu.default_layout_required`, `menu.layout_not_found`, and the readiness code
  `zone.menu_unpublished`.
  - Reuse the shipped siblings instead of minting duplicates (the plan review grepped the
    registries): a missing menu is `catalogue.not_found` (thrown today at `operations.ts:314` and
    `venue-service/src/operations.ts:395`), and an unknown or repeated product or member id in a
    membership write is `category.membership_invalid` (thrown today by `addProductsToCategory`,
    `categories.ts:302`).
  - Retired codes stay registered and unthrown: `category.parent_cycle` (replaced by
    `category.member_cycle`) and `menu_section.not_found`.
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
   - Fixture: Drinks in Lunch and Dinner; Beer nested in Drinks; Burger only in a category Dinner
     alone uses; Lemonade with a Lunch override.
   - Rename Beer: both flagged. Publish Lunch: Lunch current, Dinner still flagged.
   - Rename Drinks' GROUP: neither flagged. Change Lemonade's product price: Dinner flagged, Lunch
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
     - delete the Drinks category;
     - delete Favourites after removing it from Drinks.
   - Each time the overrides are gone, and re-adding Lemonade anywhere on Lunch shows the product's
     own price and no variant override.
   - (Task 3.)
5. **An unavailable product keeps its place and cannot be ordered, in all three places.**
   - A home grid of four tiles, the second unavailable: it stays second, greyed, and a tap does
     nothing.
   - Search lists it once, greyed. Its category view shows it greyed in order.
   - The server refuses a line for it with `product.unavailable`.
   - (Task 7 for the server; Task 9 for the till.)

---

## File Structure

**New (catalogue):**
- `packages/catalogue/src/category-graph.ts` + test: the membership graph in memory (load once per
  transaction) — `loadMembershipGraph`, `reachableProducts`, `wouldCreateCycle`, `menusContaining`,
  `placements`.
- `packages/catalogue/src/category-types.ts`: browser-safe wire types for categories, members,
  groups and usages.
- `packages/catalogue/src/menu-structure.ts` + test: `createMenuShell`, `syncMenuOffers`,
  `readMenuStructure`, `menuPrices`.
- `packages/catalogue/src/menu-document.ts` + test: `MenuDocument` types, `buildMenuDocument`,
  `menuDocumentHash`, `applyLiveFields`, `diffMenuDocuments`.
- `packages/catalogue/src/menu-publication.ts` + test: `publishMenu`, `menuStatus`,
  `previewMenu`, `readLiveDocuments`, `resolveLineVersion`.
- `packages/catalogue/src/home-layouts.ts` + test: layout CRUD, shortcut validation, device
  selections.
- Schema: additions in `schema/categories.ts` and `schema/menu.ts`; new `schema/publication.ts`
  and `schema/home-layouts.ts`.
- Catalogue migrations `0005_*` onward, generated; the numbers are indicative, so let
  `drizzle-kit generate` assign them. One media migration (Task 6).

**New (dashboard):** `apps/dashboard/src/screens/menus-screen.ts` (the list and the editor's four
tabs); `widgets/member-list-editor.ts` (one ordered list: add, remove, reorder, used-in note — shared
by the category library, the Structure tab and the Home page tab); `widgets/menu-structure-tree.ts`;
`widgets/menu-prices-table.ts`; `widgets/menu-preview.ts`; `widgets/home-layout-editor.ts`, each
with a `.test.ts` and an `.a11y.test.ts`.

**New (till):** `apps/till/src/widgets/menu-browser.ts` (search, shortcut grid, structure,
category drill-in with a breadcrumb), `apps/till/src/state/menu-state-poll.ts`, each with a test and
an a11y test.

**Modified, by task:** listed in each task's **Files** block.

---

## Task 1: Categories become ordered collections — slug `categories`

Spec §1 and §2, plus D1, D3, D4 and D15. There are no menu changes yet; menus still use sections.

**Files:**
- Modify: `packages/catalogue/src/schema/categories.ts` (the new `category_details` columns, and
  `categoryGroups` and `categoryMembers`; drop `productCategories` in a second generation). Create
  (generated): two catalogue migrations.
- Create: `packages/catalogue/src/category-graph.ts`, `category-types.ts` + tests.
- Modify:
  - `packages/catalogue/src/categories.ts` (rewrite), `errors.ts`, `classification.ts`,
    `configuration-transfer.ts`, `content-languages.ts`, `index.ts`;
  - `operations.ts` (the reporting `category` label reads `internal_name`);
  - `variant-fallback.ts` (`categoryOwnerJoin`), `product-editor.ts`, `migrations.test.ts`;
  - `packages/media/src/images.ts` (the category usage label uses the internal name);
  - `scripts/schema-constraints.test.ts` (its pinned `category_details` key list).
- Modify:
  - `apps/server/src/catalogue-api.ts` (category, member and group routes, `STATUS`),
    `apps/server/src/live-resources.ts`, `apps/server/scripts/demo-seed/seed-catalogue.ts` and
    `menu.ts`;
  - `packages/venue-service/src/dashboard/*` (the route pickers list library categories by internal
    name).
- Modify:
  - `apps/dashboard/src/api/client.ts` and `live-queries.ts`;
  - `apps/dashboard/src/screens/categories-screen.ts` and `widgets/category-form.ts`, adapted only as
    far as needed to keep working. The full library screen is Task 2.
  - `widgets/category-membership-picker.ts`, `widgets/product-editor.ts`.
- Modify: `docs/developers/product-categories.md`, `docs/backlog.md`.
- Test: `category-graph.test.ts`, `categories.test.ts`, `categories.db.test.ts`,
  `content-languages` tests, `apps/server/src/catalogue-api.test.ts`, the dashboard screen and widget
  tests, `packages/media/src/image-references.test.ts` (unchanged names).

**Interfaces:**
- Produces:
  ```ts
  // category-types.ts (browser-safe)
  export type CategoryRole = "library" | "menu_root" | "home_layout";
  export type MemberRef = { kind: "product"; productId: string } | { kind: "category"; categoryId: string };
  export interface CategoryMember { id: string; position: number; ref: MemberRef }
  export interface CategoryGroup { id: string; name: string }
  export interface LibraryCategory {
    id: string; internalName: string; names: Record<string, string>; // customer names, may be {}
    groupId: string | null; image: string | null; color: string | null;
    members: CategoryMember[];
  }
  export interface CategoryUsages { menus: { id: string; name: string }[]; categories: { id: string; internalName: string }[] }
  // category-graph.ts
  export interface MembershipGraph { /* children(categoryId), parents(categoryId), role(categoryId), ownerMenu(categoryId) */ }
  export async function loadMembershipGraph(tx: Transaction): Promise<MembershipGraph>;
  export function wouldCreateCycle(g: MembershipGraph, parentId: string, childId: string): boolean;
  export function reachableProducts(g: MembershipGraph, rootId: string): string[]; // first-occurrence order, depth first
  export function menusContaining(g: MembershipGraph, categoryId: string): string[]; // menu ids whose root reaches it
  export function placements(g: MembershipGraph, rootId: string, productId: string): string[][]; // category-id paths from the root
  // categories.ts
  export async function addMember(tx, categoryId: string, ref: MemberRef, position?: number): Promise<CategoryMember>;
  export async function removeMember(tx, categoryId: string, memberId: string): Promise<void>;
  export async function moveMember(tx, categoryId: string, memberId: string, to: number): Promise<CategoryMember[]>;
  export async function duplicateCategory(tx, sourceId: string, input: { internalName: string; memberIds: string[] }): Promise<LibraryCategory>;
  export async function copyProductsToCategory(tx, targetId: string, productIds: string[]): Promise<{ added: number }>;
  export async function categoryUsages(tx, categoryId: string): Promise<CategoryUsages>;
  // plus listCategories / readCategory / createCategory / updateCategory / deleteCategory / listCategoryGroups / createCategoryGroup / renameCategoryGroup / deleteCategoryGroup
  ```
- A **structure-change hook**: every member write calls `onStructureChanged(tx, categoryIds)`. It is
  a no-op in this task; Task 3 makes it call `syncMenuOffers` for `menusContaining`. Put the one call
  site in `categories.ts` now so that Task 3 changes one function, not every writer.

- [ ] **Step 1: Re-check the "today" facts this task rests on.** Grep for `product_categories`,
  `productCategories`, `parent_id`, `parentId` and `category_details` across `packages`, `apps`,
  `scripts` and `docs`. List every reader in the PR description before changing any.

- [ ] **Step 2: Write the failing tests for the graph** (`category-graph.test.ts`, a pure in-memory
  graph):
  - `wouldCreateCycle` is true for self-containment, for a direct back edge (A∋B, adding B∋A) and for
    an indirect one (A∋B∋C, adding C∋A).
  - It is false for reusing one child under two unrelated parents (Drinks under Lunch-root and
    Favourites).
  - `reachableProducts` returns first-occurrence order: root [Favourites[Lemonade], Drinks[Lemonade,
    Water, Beer[Lager]]] gives Lemonade, Water, Lager.
  - `placements` for Lemonade returns two paths.
  - `menusContaining(Lager's parent Beer)` returns every menu whose root reaches Beer through
    Drinks.
  - Run `pnpm --filter @waitron/catalogue exec vitest run src/category-graph.test.ts`: it FAILS
    (module missing).

- [ ] **Step 3: Write the failing database tests** (`categories.db.test.ts` and `categories.test.ts`;
  extend them, and keep every existing case whose behaviour survives):
  - **Membership and order:**
    - Adding a product twice to one list is refused `category.member_duplicate`; so is a category
      twice.
    - `moveMember` to position 0 reorders the list, and a second list containing the same category
      keeps its own order.
    - A member of a category can itself be a category, and including it adds no direct membership
      of its products.
  - **Cycles:** direct, indirect and self-containment are each refused `category.member_cycle`.
    `racePair` runs A∋B and B∋A concurrently: exactly one lands, the other is refused with the code,
    and the graph has no cycle afterwards.
  - **Roles:**
    - a `menu_root` or `home_layout` category cannot be a member (`category.not_library`);
    - the generic member routes also refuse to WRITE INTO a `home_layout` list
      (`category.not_library`). A layout's tiles are written only through Task 8's shortcut routes,
      which check reachability, so no unchecked tile can exist between Tasks 3 and 8.
    - Menu-owned rows are made with a raw insert in this task, since Task 3 creates them properly.
  - **Names:**
    - `createCategory` with an empty internal name is refused `category.invalid`
      (`params.field = "internalName"`).
    - Customer names `{}` are accepted. `listContentTranslationGaps` reports a category with `{}`
      as no gap, and a category with only `es` set, while `en` is enabled, as a gap.
  - **Groups:** create, rename and delete (a deleted group leaves its categories with
    `groupId = null`); an unknown `groupId` is refused `category_group.not_found`.
  - **Reporting (D4):**
    - `replaceProductCategories` still refuses a primary outside the set; the existing tests stay.
    - A menu-owned category is never a valid primary (`category.not_library`).
    - The reporting label written on an order line is the category's internal name: a fixture with
      internal "Evening drinks" and customer `{en: "Drinks"}` asserts `working_order_lines.category
      = "Evening drinks"` through one walk-up sale.
  - **Duplicate:** it copies details and the chosen immediate members, in order, under the new
    internal name. Nested categories stay shared references, and no product row is created.
  - **Copy products:** existing destination members are not duplicated, `{added}` counts only the
    new ones, and an unknown id refuses the whole batch with `category.membership_invalid`, the code
    `addProductsToCategory` already throws.
  - **Delete:** deleting Drinks removes it from Lunch-root's and Favourites' lists; the membership
    of its own children goes with it, and its child categories still exist. The products' reporting
    category clears where it was Drinks, and its preparation routes are dropped (existing case
    kept). `categoryUsages` before the delete names both lists.
  - Run them: they FAIL.

- [ ] **Step 4: Implement the schema.** In `schema/categories.ts`:
  ```ts
  export const categoryGroups = table("category_groups", {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
  }, (t) => [uniqueIndex("category_groups_name_uq").on(t.name)]);

  export const CATEGORY_ROLES = ["library", "menu_root", "home_layout"] as const;
  const categoryRole = enumType(CATEGORY_ROLES);

  // FINAL shape (generation A2 below). `parent_id` is gone and `internal_name` is NOT NULL.
  export const categoryDetails = table("category_details", {
    categoryId: id("category_id").notNull(),
    internalName: label("internal_name").notNull(),
    role: categoryRole("role").notNull().default("library"),
    ownerMenuId: id("owner_menu_id"),
    groupId: id("group_id"),
    image: label("image"),
    color: label("color"),
  }, (t) => [
    primaryKey({ columns: [t.categoryId] }),
    foreignKey({ columns: [t.categoryId], foreignColumns: [categories.id], name: "category_details_category_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.ownerMenuId], foreignColumns: [catalogues.id], name: "category_details_owner_menu_fk" }),
    foreignKey({ columns: [t.groupId], foreignColumns: [categoryGroups.id], name: "category_details_group_fk" }).onDelete("set null"),
    check("category_details_role_ck", enumCheck(t.role)),
    check("category_details_owner_ck", sql`(${t.role} = 'library') = (${t.ownerMenuId} is null)`),
    index("category_details_owner_menu_idx").on(t.ownerMenuId),
    index("category_details_group_idx").on(t.groupId),
  ]);

  export const categoryMembers = table("category_members", {
    id: id("id").primaryKey().$defaultFn(newId),
    categoryId: id("category_id").notNull(),
    position: count("position").notNull(),
    productId: id("product_id"),
    childCategoryId: id("child_category_id"),
  }, (t) => [
    foreignKey({ columns: [t.categoryId], foreignColumns: [categories.id], name: "category_members_category_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.productId], foreignColumns: [products.id], name: "category_members_product_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.childCategoryId], foreignColumns: [categories.id], name: "category_members_child_fk" }).onDelete("cascade"),
    check("category_members_one_ref_ck", sql`(${t.productId} is null) <> (${t.childCategoryId} is null)`),
    uniqueIndex("category_members_product_uq").on(t.categoryId, t.productId),
    uniqueIndex("category_members_child_uq").on(t.categoryId, t.childCategoryId),
    index("category_members_order_idx").on(t.categoryId, t.position),
    index("category_members_child_idx").on(t.childCategoryId),
    index("category_members_product_idx").on(t.productId),
  ]);
  ```
  - **Generate in THREE generations** — the plan review ran each of these on 2026-09-25
    (drizzle-kit 0.31.10), and the one-generation form fails:
    - Doing it in ONE generation, drizzle-kit stops with `Error: Interactive prompts require a TTY
      terminal … promptColumnsConflicts`. It asks whether `internal_name` is `parent_id` renamed.
    - Keeping `parent_id` to dodge the prompt produces a rebuild whose copy reads the columns being
      added (`INSERT INTO __new_category_details(… "internal_name","role" …) SELECT …
      "internal_name","role" … FROM category_details`). Every fresh database then fails with
      `no such column: "internal_name"` (drizzle-kit copies every column of the new shape).
    - **A1:**
      - add `internal_name` as NULLABLE, `role` with its default, `owner_menu_id` and `group_id`;
      - create `category_groups` and `category_members`;
      - no new checks or keys on `category_details`, and keep `parent_id`.
      - Expect plain `ALTER TABLE … ADD` lines and no rebuild.
    - **A2:** the final shape above (`internal_name` NOT NULL, both checks, both keys, `parent_id`
      dropped). Expect ONE rebuild, whose copy reads only existing columns, and no prompt.
    - **B:** remove `productCategories`. Expect only `DROP TABLE`.
    - The review applied A1, A2 and B to a fresh database through `applyMigrations`: the checks
      refuse bad rows (errcode 275), both media triggers on `category_details` exist, and
      `scripts/migrations-match-schema.test.ts` passes.
  - Classify both new tables `state`, and remove `product_categories` from every hand list (Global
    Constraints).
  - **Between B and the end of Step 5 the root guard suites CRASH on load**
    (`Cannot create proxy with a non-object as target or handler`) while code still imports
    `productCategories`. That is not a guard result; re-run them after Step 5.
  - **The upgrade — measured by the plan review, re-measure and record it:** on a venue `main` has
    migrated, the new set fails EVERY time:
    - with no category rows, at the rename (`error in trigger
      category_details_media_image_fk_parent_delete: no such table: main.category_details`);
    - with any category row, earlier (`NOT NULL constraint failed:
      __new_category_details.internal_name`).
    - So **every existing venue fails to boot, an empty one included**, until
      `wa-wt reset demo <name>` (or a box wipe). Say it in those words in the PR and in
      `docs/backlog.md`.

- [ ] **Step 5: Implement `category-graph.ts`, then `categories.ts`.**
  - Load the graph ONCE per operation (`select category_id, product_id, child_category_id, position,
    id from category_members` and the `category_details` roles) and walk it in JavaScript. It is
    small, it keeps the SQL engine-neutral, and the write lock makes the check-then-insert safe.
  - `addMember` appends at `max(position) + 1` unless given a position, then renumbers.
  - `moveMember` renumbers the whole list 0..n-1 in one pass.
  - `onStructureChanged(tx, [categoryId])` is called after every member write.
  - `replaceProductCategories`, `readProductCategories`, `addProductsToCategory` and
    `listCategoryProducts` keep their route contracts, but read and write `category_members`
    product rows in LIBRARY categories only. A newly added membership goes at the end of the list.

- [ ] **Step 6: Routes and the dashboard, kept working.**
  - `apps/server/src/catalogue-api.ts`:
    - the category bodies change from `parentId` to `internalName`, `names`, `groupId`;
    - new member routes: `GET/POST /management-api/categories/:id/members`,
      `DELETE …/members/:memberId`, `PUT …/members/:memberId/position {to}`;
    - `POST …/:id/duplicate {internalName, memberIds}`, `POST …/:id/copy-products {productIds}`,
      `GET …/:id/usages`;
    - group routes under `/management-api/category-groups`.
    - Each route is one `withTransaction`, with the same `person.manage` gate as the other category
      routes.
  - `categories-screen.ts` and `category-form.ts`:
    - drop the parent field and the tree mode (the full library is Task 2);
    - add the internal name (required, marked, `name="internalName"`) above the optional customer
      names;
    - the table shows the internal name and the customer name in the dashboard language.
  - The product editor's category lozenges show the internal name.
  - Live-query names change from `product_categories` to `category_members`, and `category_groups`
    is added (`scripts/live-subscriptions.test.ts`).

- [ ] **Step 7: The demo seed.** One shared category per name (a single "Drinks", "Mains" …), each
  holding its products in seed order. The `menu_sections` it builds stay until Task 3. Coffee in
  both Drinks and Hot drinks stays, as a real two-list membership.

- [ ] **Step 8: Docs.** Rewrite `docs/developers/product-categories.md` for the new model: ordered
  members, internal and customer names, groups, roles, no parent, delete behaviour, routes, and
  storage. Add the backlog line with the measured upgrade result.

- [ ] **Step 9: Run the focused tests, then LOOK at the categories screen in both themes and at
  390px. Commit.**

---

## Task 2: The category library screen — slug `category-library`

Spec §2 ("Groups", "Copy membership") and §6 ("The standalone Categories screen …"). Dashboard only;
the API is Task 1's.

**Files:**
- Create: `apps/dashboard/src/widgets/member-list-editor.ts` + `.test.ts` + `.a11y.test.ts`.
- Modify: `apps/dashboard/src/screens/categories-screen.ts` (+ tests),
  `widgets/category-form.ts` (+ tests), `api/client.ts`, `i18n/strings.ts`, `i18n/codes.ts`.

**Interfaces:**
- Consumes: Task 1's routes and `category-types.ts`.
- Produces `dashboard-member-list-editor`, which Task 4 and Task 8 reuse:
  - props:
    - `members: CategoryMember[]`
    - `products: {id, name}[]`
    - `categories: {id, internalName}[]`
    - `excludeCategoryIds: string[]` (the picker hides invalid choices; the server still refuses)
    - `busy`
    - `label`
  - events: `wt-member-add {ref}`, `wt-member-remove {memberId}`, `wt-member-move {memberId, to}`,
    and `wt-member-open {categoryId}`;
  - it uses `ReorderController` for drag and ArrowUp/ArrowDown, with each row labelled by kind
    (product or category) in text, never colour alone.

- [ ] **Step 1: Write the failing widget tests** (`member-list-editor.test.ts`, real Chromium):
  - ArrowDown on the first row emits `wt-member-move {to: 1}`, and focus stays on the moved row.
  - The add picker lists products and categories under separate headings, and omits
    `excludeCategoryIds`.
  - A category row has a visible "Category" marker and an "Open" button.
  - The a11y test covers the empty, populated and busy states in both themes.

- [ ] **Step 2: Write the failing screen tests** (`categories-screen.test.ts`; keep every existing
  case that still applies — delete preview, products modal, deep link):
  - **Filters:**
    - a Group filter and a "Used in" filter (`Any`, `Used in a menu`, `Not used`);
    - "Used in a menu" includes a category reached only through nesting.
    - A group filed under "Reporting" still appears when the used-in filter is "Used in a menu"
      (spec §2: a group never restricts use).
  - **Group picker:** a `wt-combobox` with `allowAdd`. Its `wt-combobox-add` creates a group and
    selects it; a refusal is shown beside the field with `name="group"`.
  - **Editing members:** the editor modal shows the member list editor. Adding a category that would
    create a cycle is not offered, and a server refusal of `category.member_cycle` appears beside the
    member list and in the form's error summary.
  - **Used in:** the editor shows "Used in: Lunch Menu, Dinner Menu, Favourites"
    (`GET …/usages`) above the members, so a shared edit shows its wider use (spec §6).
  - **Duplicate:** a row action opens a modal with the new internal name prefilled as
    "<name> (copy)" and every immediate member ticked. Unticking Beer and saving calls `duplicate`
    with the remaining ids.
  - **Copy to category:**
    - in the category's products modal, select several and choose "Add to category…";
    - the destination picker can create a category;
    - rows reached through a nested category show "via Beer" and are selectable separately from
      direct members (spec §2's "distinguishable").
  - **Tree view:** it shows occurrences by PATH, so Drinks nested under Favourites and at the top
    level appears twice. Each row is keyed by its path, and editing either opens the same category.
  - **Delete dialog:** it lists "Used in" menus and categories (from `usages`) as well as the
    affected products.

- [ ] **Step 3: Run them to verify they fail. Step 4: Implement.** Keep one `wt-modal` editor per
  screen with `wt-form-actions`, as the screen does now, and follow the design system's "Tabbed
  management pages" and Forms rules. **Step 5: Run to verify they pass. LOOK in both themes and at
  390px, in English and Spanish. Commit.**

---

## Task 3: Menus are built from categories — storage and API — slug `menu-structure`

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
  - `categories.ts` (`onStructureChanged` now syncs), `provisioning.ts`, `menu-types.ts`,
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
    rootCategoryId: id("root_category_id").notNull(),
    defaultHomeLayoutId: id("default_home_layout_id").notNull(),
  }, (t) => [
    foreignKey({ columns: [t.menuId], foreignColumns: [catalogues.id], name: "menu_details_menu_fk" }),
    foreignKey({ columns: [t.rootCategoryId], foreignColumns: [categories.id], name: "menu_details_root_fk" }),
    foreignKey({ columns: [t.defaultHomeLayoutId], foreignColumns: [categories.id], name: "menu_details_default_layout_fk" }),
    uniqueIndex("menu_details_root_uq").on(t.rootCategoryId),
  ]);
  // menu-structure.ts
  export async function createMenuShell(tx: Transaction, menuId: string, menuName: string): Promise<{ rootCategoryId: string; defaultHomeLayoutId: string }>;
  export async function syncMenuOffers(tx: Transaction, menuIds: readonly string[]): Promise<void>;
  export interface MenuStructureNode { memberId: string; ref: MemberRef; children?: MenuStructureNode[] } // children present for a category
  export async function readMenuStructure(tx: Transaction, menuId: string): Promise<{ rootCategoryId: string; nodes: MenuStructureNode[] }>;
  ```
  - `MenuItem` (in `menu-types.ts`) loses `sectionId` and `displayOrder`. `MenuOffer` loses
    `sectionName`, and it gains `placements: string[][]`: category-id paths from the root, with `[]`
    for the top level.
  - Offer order is `reachableProducts` order.

- [ ] **Step 1: Write the failing tests** (`menu-structure.test.ts`, `operations.test.ts`):
  - **Creating a menu** makes a `menu_root` and a `home_layout` category, both owned by the menu, and
    a `menu_details` row.
  - **The root and the layout never show up elsewhere:** not in `listCategories`, not as a member
    choice, and not in `listContentTranslationGaps`.
  - **Adding Drinks to Lunch's root:** `listMenuOffers([lunch])` returns Drinks' products in order,
    and each has a `menu_items` row. Adding a product to Drinks later offers it on Lunch AND Dinner
    at its product price (spec §1, acceptance 1's working half).
  - **Reordering:** reordering Lunch's root leaves Dinner's order unchanged (acceptance 3's working
    half).
  - **Review Focus 4, all five paths**, including deleting a category and removing a nested one.
    Also assert that the row's id is the SAME after a reset: `working_line_contexts` points at it.
  - **The per-menu switch:** `menu_items.active = false` hides a reachable product on that menu only
    (D5).
  - **Readiness:** a zone whose menu's root is empty reports `zone.menu_empty`, and a nested product
    counts as not empty.
  - **Existing coverage stays green with fixtures moved from sections to structure:**
    `operations.test.ts`'s "offers one product on two menus", the variant and extras cases, and the
    price chain in `offer-price.test.ts`.
  - **A shared category's change syncs every menu containing it:** assert rows on both, in one
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
    REMOVES links (`removeMember`, `deleteCategory`), compute `menusContaining` from the graph BEFORE
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

- [ ] **Step 5: The demo seed** builds each menu's root from the shared categories (Casa Delgado:
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
  with a test and an a11y test.
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
  - **Creating a category** without leaving the editor adds it where it was created.
  - **Remove:** "Remove from this list" names the list it removes from, and a category delete is not
    offered here (spec §3).
  - **Reordering:** ArrowUp and ArrowDown reorder, and focus stays.
  - **Breadcrumb:** a text breadcrumb shows the path followed (Lunch Menu › Drinks › Beer), and it is
    this screen's own markup: there is no breadcrumb primitive (design-system table).
  - **Navigation:** the tab and the chosen menu are in the URL (the design system's Navigation rule).
  - **The a11y test** covers the empty menu, the populated tree, an expanded shared category, and
    loading and failed states, in both themes.

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
    placements: string[][];            // category-id paths, [] = top level
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
    - a category unrelated to the menu appears in no placement (spec §3's table).
  - **Overrides:**
    - An explicit override equal to the product price stays fixed when the product price changes.
    - A cleared override follows it.
    - "Use product price" sends `grossPrice: null` (acceptance 6's working half).
  - **Screen:**
    - search, a category filter and an "Overridden only" filter;
    - the placements column says "Top level" for `[]` and uses the category internal names;
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
    | { kind: "category"; categoryId: string; internalName: string; names: Record<string, string>; image: string | null; color: string | null; members: DocumentMember[] };
  export interface DocumentList { members: DocumentMember[] }
  export interface DocumentLayout { id: string; name: string; tiles: ({ kind: "product"; productId: string } | { kind: "category"; categoryId: string })[] }
  export type LiveOfferField = "available" | "allergens" | "diet" | "dietDerivation" | "dietOverride" | "dietaryDeclarations" | "vatClass" | "courseId" | "category";
  export type LiveExtraItemField = "available" | "vatClass" | "addAllergens" | "suitableFor"; // check the exact names at menu-types.ts:158-171
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
    | { kind: "category_added" | "category_removed"; categoryId: string; name: string; under: string[] }
    | { kind: "category_changed"; categoryId: string; name: string; fields: string[] }
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

## Task 7: Tills sell from the published version — slug `sell-published`

Spec §4's "published rendering and pricing must use that captured content", plus §9's baskets and
held orders, D9, D10, D11, D12's server half and D17. **This is the sale path. It is fiscal-adjacent:
the golden huella and `inmutabilidad` pass unedited.**

**Files:**
- Modify:
  - `packages/venue-service/src/operations.ts`: `listZoneOffers` serves live documents through
    `applyLiveFields`; `recordWorkingLineContexts` takes the already-resolved offers and makes no
    per-line read; readiness gains `zone.menu_unpublished`.
  - `packages/catalogue/src/menu-publication.ts` (`resolveLineVersion`, `SUPERSEDED_VERSION_GRACE_MS`).
- Modify: `apps/server/src/working-order.ts` (`priceOrderLines` prices each line — dish, variant,
  extras, options — from its version, replacing `resolveBasketModifiers`' live-row extras pricing
  at `:142-190`; `updateHeldOrder` keeps the stored price and names of every unchanged line, D10),
  `till-sale.ts`, `till-api.ts` (`GET /api/menu-state`, session-gated; the offers responses carry
  `versionId` per menu).
- Modify: `apps/till/src/api/client.ts` (each line sends `menuVersionId`), `till-app.ts` (adopt on
  poll), `state/order-line.ts`, `state/working-order.ts`; create `apps/till/src/state/menu-state-poll.ts`.
  Unavailable offers arrive marked; grey them in the existing `widgets/product-grid.ts` for now
  (Task 9 replaces the grid).
- Modify:
  - `apps/server/src/testing/zone-offers.ts` (fixtures publish); the demo seed publishes;
  - **every suite that builds its own menu and sells publishes it** (an absent `menuVersionId` then
    means the live version, D9, so the request bodies stay as they are). The plan review found about
    eight that build menus directly rather than through the helper: `working-order.test.ts`,
    `till-api.test.ts`, `served-at-huella`, `tabs`, `till-sale`, `till-api.receipt`,
    `till-api.fiscal-sale-paths`, `sale-till-source.receipt`, plus
    `packages/fiscal-verifactu/src/write-path.e2e.test.ts`'s `wineOffer` fixture. Find the full set
    with `grep -rln "createMenuItem\|addMember\|zone-offers" apps packages --include='*.test.ts'`. The
    golden block and its literals stay unedited;
  - `packages/module/src/module.ts` (the `ZoneMenuOffer` wire shape gains `available` and the menu's
    `versionId`);
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
    extra, and the filed sale's `vatBreakdown` shows both at 21%. The golden fingerprint is
    unaffected because its fixture changes nothing.
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
  - **Held edit (D10):**
    - a held order with lines L1 (Lemonade at v1's €3.00) and L2 (Water at v1's €2.00);
    - publish v2 with Lemonade at €2.50 and Water at €1.80;
    - the till, holding v2, edits the order by changing Water's note and adding a Coffee;
    - L1 is re-inserted at €3.00 with its stored names, L2 (changed) is priced from v2 at €1.80, and
      Coffee from v2.
    - A second case: two identical Lemonade lines plus a third that differs only in its extras LIST
      match two, not three (CLAUDE.md §3's which-list rule).
    - Keep the existing quantity-only guard case in `working-order.test.ts` unchanged.
    - Do NOT add a fired-line assertion: that behaviour is the owner's open question (D10).
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

Spec §5 ("A home layout is a menu-owned category"), §6's Home page view, and D13 and D14.

**Files:**
- Create: `packages/catalogue/src/schema/home-layouts.ts` (`deviceProfileHomeLayouts`), one
  catalogue migration, and `packages/catalogue/src/home-layouts.ts` + test.
- Modify: `apps/server/src/catalogue-api.ts` (layout routes: create, duplicate, rename, delete,
  set default; tiles reuse the member routes with the layout id plus the reachability check),
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
  export async function addShortcut(tx, layoutId: string, ref: MemberRef): Promise<CategoryMember>; // menu.shortcut_unreachable
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
    - a tile for a product or library category the menu reaches is accepted;
    - an unreachable one is refused `menu.shortcut_unreachable`;
    - a menu-owned category as a tile is refused `category.not_library`.
  - **A home tile adds nothing to the menu:** it adds no `menu_items` row and no offer, and removing
    it removes only the tile (spec §5).
  - **Home page tab:**
    - a layout list with the default marked, and add, duplicate, rename, delete and "make default";
    - the tile editor is Task 2's member-list editor, restricted to reachable choices;
    - tiles show product and category differently in text and shape, never colour alone;
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
  - **Search** covers the whole published menu whatever category is open, and lists each product
    once (acceptance 5's till half).
  - **Product tiles** open the ordering interaction (variants and modifiers, as today). **Category
    tiles** open the category with a breadcrumb, and are distinguishable by text and an icon.
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
  - **Category names:** customer name in the till's language, then the default language, then the
    internal name (D3).
  - **Switched-off products:** a structure member whose offer is absent from the document (switched
    off on this menu, D5) is not shown in the structure, in search or as a tile.
  - **The a11y test** covers home, search results, a category view, an unavailable tile and the
    warning, in both themes.
  - Run them: they FAIL.

- [ ] **Step 2: Implement. Step 3: Run `apps/till`'s `test:coverage` locally. LOOK at the till and
  the handheld at both widths, in both themes and in English and Spanish. Commit.**

- [ ] **Step 4: The closing sweep.**
  - Read the spec's §7 acceptance list and §8's open items against what landed, and write any gap
    into `docs/backlog.md`.
  - Mark the spec's status line with a dated pointer to this plan and its PRs.
  - Update the backlog's Track A entry.
  - Sweep every doc that describes menus, sections or category parents (grep `menu_sections`,
    `section`, `parent_id`, `parentId` in `docs/`, READMEs and `CLAUDE.md`). CLAUDE.md §1 says a
    behaviour change retires every receipt about the old behaviour.

---

## Finish (every task)

Each task ends with `/finish-branch` in its worktree (full review wave, Codex in the run-it seat),
then `/land-branch`. The next task starts from a freshly synced `main`. Update `docs/backlog.md` in
the task's own PR wherever the task makes it stale.

## Self-Review notes

- **Spec coverage:**
  - §1 → Tasks 1, 3 and 6. §2: ordered members, cycles and duplicates → Task 1; groups, usages,
    duplicate and copy → Tasks 1–2.
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
  - `MemberRef` and `CategoryMember` (Task 1) are used by Tasks 2, 3, 4 and 8.
  - `MenuOffer.placements` (Task 3) is carried by `FrozenOffer` (Task 6).
  - `MenuDocument` (Task 6) is served by Task 7 and rendered by Task 9.
  - `menuVersionId` on the wire comes in Task 7 and is emitted by `till-menu-browser` in Task 9.
  - `homeLayoutId` joins `/api/menu-state` in Task 9.
- **Owner-facing choices to confirm before the task that builds each:**
  - D6's live-field list (Task 6);
  - D9's 12-hour grace, which lets a till choose a recent older price (Task 7);
  - D10's narrow held-edit change, and the separate open question on fired lines (Task 7);
  - D12's greyed tiles (Tasks 7 and 9);
  - D13's omit-on-publish (Task 6);
  - D14's "a deleted layout keeps showing until republish" (Tasks 8 and 9);
  - D21's "an imported venue arrives unpublished" (Task 6);
  - D3's "till shows the customer name for a category" (Task 9);
  - D20's deferral of the public, staff-only and not-sold-separately setting.

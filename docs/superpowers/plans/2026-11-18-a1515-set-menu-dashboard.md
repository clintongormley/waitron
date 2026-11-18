# Set menus, piece 1: the set-menu kind, its editor, placing and publishing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager can create a set menu on the dashboard, give it a price, its dishes with
surcharges, and what one set menu includes, place it in a full menu, and publish that full menu;
the full menu's published version then holds a copy of the set menu, and the till's offers read
carries it, for piece 2 to draw.

**Architecture:** A set menu is a `menus` row with `kind = 'set_menu'`, a price and an eat-in VAT
class. Its dishes are the products in its root list, so `menu_items` and the whole offer pipeline
(`listMenuOffers` → `freezeOffer`) build each dish's full offer, options, extras and variants
included, unchanged. On a set menu, `menu_items.gross_price` holds the dish's surcharge (null:
included). What one set menu includes is two new tables of lines and their courses; the variants it
leaves out are a third. Placing a set menu in a full menu stores a `section_members` row pointing at
its root, exactly as an include does, but the section graph reports that member as
`{ kind: "set_menu" }`, so nothing that walks included menus (offer sync, price combining, clashes,
the document's tree) treats it as one for prices. A set menu has no published versions of its
own: publishing a full menu copies each set menu it holds, as it stands, into the full menu's
format-4 `MenuDocument` (a `{ kind: "set_menu", menuId }` member in the tree, and the copy in a new
`setMenus` block), and the zone offers read serves those copies beside the ordinary offers.

**Tech Stack:** TypeScript 7, drizzle (core migration set, `migration-baseline rebuild`), Hono routes
in `apps/server`, Lit screens in `apps/dashboard`, Vitest 4 (browser mode for the dashboard).

**Spec:** [docs/superpowers/specs/2026-11-17-set-menus-design.md](../specs/2026-11-17-set-menus-design.md),
section 1 "Setting up a set menu" and the first piece of "The pieces, for planning". Read section 1,
section 6 (courses) and "Left to the builder" before Task 1. A code map of the area, read at
`18fe6c2661`, is in the owner's checkout at `docs/handoffs/2026-11-17-set-menus-code-map.md`
(gitignored); line numbers below are from `ed2ac2ea00`.

**Pull-request boundaries:** see the [Lane D scope check](2026-11-18-a1515-set-menu-dashboard-scope.md).

**Order:** after A1515-REMOVE (lane D), which deletes `products.set_lunch` and the `setLunch` fields
this plan's files sit beside. Both rebuild the core baseline: on a rebase conflict in
`packages/db/drizzle/`, take main's copy and rerun the rebuild (CLAUDE.md §3). Piece 3 (the fit)
can run alongside; pieces 2 and 4 build on this one's types.

**Review:** read once against the spec by a fresh-context reviewer on 18 November 2026, which
checked the code claims by reading and grep only. Its findings are applied: the till's
menu-state check (decision 3, Task 6), one classification for members (Task 3a), exclusions
cleared on re-adding a dish, the transfer and table registrations, choosing variants when adding,
names in the published terms, no set-menu read on every sale, the missed price readers, the
splits of Tasks 3 and 8, and the naming. It also found that freezing counts-as at publish
departed from the spec, and the plan briefly followed the spec instead.

**Owner's correction, 18 November 2026** (after the review): "The menu should freeze the
definition - we shouldn't read courses from the live product list", and "The set menu should be
copied in at the time it is published", answered in a picker as "Full menu publish, draft": a set
menu works exactly like an included menu. Decisions 3 and 4, Tasks 4, 5, 6, 7, 8a and 11, and the
spec's sections 1 to 3 were rewritten for it; the menu-state change the review asked for is no
longer needed, since publishing the full menu changes its version.

**Second amendment, 18 November 2026.** The owner changed the design (set menus are added to a bill
by type, and a dish stays where it is placed; spec commit `7eb3b8eef2`) and answered three of this
plan's questions (ledger `docs/handoffs/2026-11-17-set-lunch-owner-review.md`, "Owner's answers on
the 'my call' decisions", items 3, 8 and 9): each set menu decides what a dish counts as (decision
4, decision 9), a bill takes one copy of each set menu (decision 10, Task 6b), and the editor
refuses a product at another VAT rate (decision 11, Tasks 4b and 9). Lane M's Fable read of the
plans (`~/waitron-campaign-m/reports/sm.md`) is applied where it survives the change, each
Important finding checked in the code first: F5 (decision 13), F6 (decision 12), F7 (Tasks 6a and
6b), M4 (decision 14), M7 (Tasks 6a and 7) and M8 (Tasks 3b, 3c, 5a to 5c, 6a and 6b). F2, M1 and
M2 are answered by decisions 4 and 10. Nothing in this piece chose set-menu types for a bill; the
one sentence that had a bill use every copy on sale (Task 6) is replaced by decision 10. A fresh
reader then found four more points, applied the same day: the Madrid baseline test (Task 1, Step
4b), a live correction defeating "newest" (decision 10's stamp), a live VAT correction getting
round decision 11 (Task 5c), and three tasks too large for one implementer (Tasks 3b, 4c, 5b).

## Decisions this plan makes (the builder's, for the plan review and the owner)

The spec leaves table names, where the price and VAT live, and error codes to the builder. These go
further than that and are marked **my call** where they first appear in a task; those added in the
second amendment are marked **my call (plan writer)**:

1. **Price, VAT class and names live on the menu, not on a hidden product.** Order and sale lines do
   not need a product (`working_order_lines.product_id` and `sale_lines.product_id` are nullable,
   `packages/db/src/schema/orders.ts:179`, `sales.ts:217`) and snapshot names, VAT class and
   classification by value. A hidden product would appear in every product list, picker, archive
   check and report that reads `products`. Customer-facing names in each language are the set
   menu's root section `names`, as for any menu. Category for reports is left to piece 4.
2. **A set menu's dishes are its root list's products, and `menu_items.gross_price` is the
   surcharge.** This changes what a blank price means for set-menu rows only. Task 4 traces every
   reader of that column; the Prices tab and its route refuse a set menu.
3. **A set menu is copied into each full menu that holds it when that full menu is published, as
   an included menu is** (**owner**, 18 November 2026). The copy is taken from the set menu's
   working state (`buildMenuDocuments` already builds an included menu's offers and structure in
   the same pass, `packages/menu/src/menu-document.ts:240-336`). A set menu has no Publish of its
   own and no `menu_versions` rows: publishing or queueing one is refused `set_menu.wrong_place`.
   Changing a set menu marks every full menu holding it as changed, because the copy is part of the
   full menu's document and so of its working hash. Publishing (now or queued) a full menu refuses
   when a set menu it holds has a problem. What the till serves and what a bill records are a full
   menu's version and the set menu's id in it (Tasks 6a and 6b), one copy of each set menu per
   bill (decision 10).
4. **What a dish counts as belongs to the set menu, fixed in the copy** (**owner**, 18 November
   2026: "The menu should freeze the definition", and "each set menu decides", ledger item 8). The
   copy records, for each dish and each kept variant, the course it counts as IN THAT SET MENU
   (`countsAsCourseId`): the set menu's own course for the dish (decision 9), else the product's
   course (a variant's own, else its parent's), as they stood when the full menu was published. A
   dish placed in a set menu counts as that set menu's course for it, whichever folder it was
   tapped in; piece 3's calculation reads it from each set menu's listed dish
   (`SetMenuOfferDish.countsAsCourseId`, [piece 3 follow-up](2026-11-18-a1515-set-menu-fit-counts-as.md)).
   A product moved to another course on the dashboard still counts as its old course on the tills
   until a full menu holding the set menu is published again. The folder the dish was tapped in
   decides only when it is sent: its served `courseId` is that set menu's own course for the dish
   while that course exists (decision 9, Task 6a), else the product's live course, as for every dish
   (`OverlayOfferField`, `menu-document-types.ts:19-20`).
5. **Adding dishes adds lines, and says so.** Adding a dish whose course no line accepts appends a
   line "1 × that course", and the editor shows "Added a line: 1 × Coffee" so the person sees it.
   This is how "it starts as one line per course present" is kept true without a separate
   first-save step. A line that no listed dish can fill ("1 × Coffee" with no coffee dish) is a
   problem that stops publishing (**owner**, 18 November 2026, ledger item 1: "keep both"; the
   reason given was that the diner would pay for a place nobody can fill).
6. **Variants a set menu leaves out are stored; included ones are not.** All variants start
   included (spec); a row in `set_menu_variant_exclusions` leaves one out. An included variant's own
   surcharge reuses `menu_item_variant_overrides.price`.
7. **The document format stays 4.** The change is additive: every stored format-4 document is still
   valid, so no `menu.reset_required`. The `setMenus` block is optional on `MenuDocument`.
8. **The set-up guide section and the editor's help bubble land with the screen** (CLAUDE.md §3: a
   screen change updates its guide in English and Spanish). Piece 2 takes the table-service guide
   and the help bubble on the order panel's count, for the same reason; piece 5 keeps the demo.
9. **A set menu can give a dish another course** (**owner**, 18 November 2026: "after adding
   products to the set menu, we should be able to change the course they belong to from the
   default course. for instance we could treat a tapa as a starter"; asked whether that course
   should also decide when the dish is sent, answered "both").
   - A row in `set_menu_dish_courses` gives the dish, in that set menu only, a course of its own.
     Placed in this set menu, the dish and every kept variant of it count as that course, whichever
     folder they were tapped in; tapped in this set menu's folder, they are sent with it. Without a
     row, the dish counts as its product's course (or each variant's own) and is sent as today.
   - Like the rest of the set menu, the chosen course reaches the tills in the copy, when a full
     menu holding the set menu is published (decision 4). In the copy it is the dish's
     `countsAsCourseId` and its `courseOverrideId`; serving turns the override into the dish's
     `courseId` while that course exists (Task 6a).
   - Choosing the product's own course again clears the row, so the dish follows its product later
     (**owner**, 18 November 2026, ledger item 2: "follow the product"). The same product à la
     carte is never affected.
10. **A bill takes one copy of each set menu: the newest on sale in its zone when that set menu is
    first added** (**owner**, 18 November 2026, "ok", ledger item 9, after Fable's M1 showed that a
    bill using every copy on sale let an older, cheaper price win). Serving marks that copy
    `newestOnSale` (Task 6b); piece 2 records it on the bill and keeps it. "Newest" is the copy of
    the set menu as the manager changed it last: each copy carries `changedAt`, the set menu's
    `menus.updated_at` (`packages/db/src/schema/menus.ts:41`) when the copy was taken, and every
    write that changes a set menu moves that stamp (`touchSetMenu`, Tasks 4 and 4c). The newest
    copy is the orderable one with the latest `changedAt`, ties going to the smaller `key` in code
    units (**my call (plan writer)**). Not the version's `menu_versions.created_at`: a live correction writes a new
    version with `createdAt: at` (`packages/menu/src/menu-publication.ts:770-777`) that carries the
    full menu's OLD copy unchanged, which would make an older price newest again. The stamp is part
    of the copy, so a working hash changes only when the set menu does, and a correction carries it
    over unchanged. A tie happens only when two copies differ by something changed on a product's
    own page (a name, a course), never by a price or surcharge, which are the set menu's own
    writes.
    Serving also reads a copy from a version that is no longer live (Task 6b), so piece 2 can draw
    and price a bill's recorded copy after a republish.
11. **The editor refuses a product whose eat-in VAT class differs from the set menu's, until
    adviser question 26(c) is answered** (**owner**, 18 November 2026, "refuse until answered",
    ledger item 3; spec section 1). The eat-in class is the product's effective `vatClass`, a
    variant's own or else its parent's (`effectiveProductColumns`,
    `packages/menu/src/variant-fallback.ts:65-67`). Refused `set_menu.vat_class_differs` when a dish
    or a kept variant is added, copied or included again, and when the set menu's own class is
    changed while it holds a dish at another one. A product whose class is changed afterwards on
    its own page is not refused there: the set menu shows the problem `dish_vat_class_differs`,
    which stops publishing (**my call (plan writer)**: refusing on the product page would reach
    into every product save for a rule that lasts only until the adviser answers).
12. **A product sold by measure cannot be in a set menu** (**my call (plan writer)**; Fable's
    proposal P2, which the owner has not yet answered). A set-menu dish is stored one unit per line
    (spec section 3, "What is stored"), and a dish sold by weight has a fraction for its quantity.
    Lane M's run behind F6: a stored line of unit price 5.00 and quantity 0.300 files 1.50, so a
    +€5.00 surcharge on 0.300 kg would be billed as €1.50 (`packages/menu/src/pricing.ts:144-169`,
    their citation). A product whose unit measures an amount (`units.measure`,
    `packages/db/src/schema/menu/units.ts:19-20`) is refused `set_menu.dish_sold_by_measure`; one
    whose unit is changed afterwards is the problem `dish_sold_by_measure`.
13. **A set menu's price and every surcharge stay within the calculation's limit**,
    `MAX_SET_MENU_AMOUNT_CENTS`, €10,000.00 (`packages/shared/src/set-menu-fit.ts:10`), refused
    `set_menu.invalid` with `field` `setPrice` or `surcharge` (**my call (plan writer)**, Fable's
    F5). Today's price check allows ten whole digits (`isProductPrice`,
    `packages/menu/src/modifier-limits.ts:12-13`), so a mistyped price would publish and the
    calculation would then refuse every bill holding that set menu. Run on `b31ec62e37` (scratch
    Vitest file importing `set-menu-fit.ts`): a bill handed a set menu at 1,400,000 cents threw
    `set_menu.fit_invalid_input` `{ reason: "invalid_amount" }`; without it the bill fitted, and at
    exactly 1,000,000 it fitted.
14. **Giving a dish another course removes the line that change emptied**: a line of count 1 that
    accepts only the dish's old course and that no listed dish can fill any more. The editor says
    so ("Removed a line: 1 × Sharing plates"), as decision 5 says "Added a line" (**my call (plan
    writer)**, Fable's M4: the owner's own example, a tapa made a starter, otherwise leaves a line
    that stops publishing).

## Global Constraints

- **Money:** whole cents in the database (`money` columns), decimal strings with two places in
  documents and API bodies, exactly as `MenuOffer.unitPrice` is (`menu-types.ts:24`). Convert with
  `decimalToCents` / `centsToDecimal`; validate a price's shape with `isProductPrice`
  (`packages/menu/src/modifier-limits.ts:12-13`), and a set menu's price and surcharges against the
  limit too (decision 13). There is no exported `validatePrice`: the one in
  `packages/menu/src/variants.ts:59` is private and throws `product.variant_invalid`.
- **Schema:** change the TypeScript schema under `packages/db/src/schema/`, put any hand-written SQL
  only in `packages/db/triggers/core.sql`, then run `pnpm --filter @waitron/db db:generate` (the
  `migration-baseline rebuild --set core` script). No new migration file, no hand edit. Classify
  each new table in `packages/db/src/classification.ts` as `state`, beside the menu tables
  (`MENU_STATE`). Declare types through `packages/db/src/schema/columns.ts` only. Verify by RUNNING
  `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/starting-migrations.test.ts`,
  `scripts/classification-complete.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- **Errors:** `AppError` with codes named for the domain, declared in
  `packages/menu/src/errors.ts`, mapped to an HTTP status in `apps/server/src/menu-api.ts`'s map
  (`:320-380`), and worded in English and Spanish in `apps/dashboard/src/i18n/codes.ts`. Every
  refusal says what happened and what each choice does (CLAUDE.md §3). The codes, all **my call**:

  | Code                       | Params            | When                                                                                            |
  | -------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
  | `set_menu.invalid`         | `{ field }`       | a bad price or surcharge (including one above the limit, decision 13), VAT class, line count, line course or variant choice |
  | `set_menu.not_found`       | `{ menuId }`      | a set-menu operation names a menu that is missing, inactive or not a set menu                   |
  | `set_menu.wrong_place`     | `{ menuId }`      | a set menu named where only an ordinary menu fits: default menu, a period, an include, Prices, publishing it |
  | `set_menu.dishes_only`     | `{ menuId }`      | a section, an included menu or a set menu added to a set menu's list                            |
  | `set_menu.not_publishable` | `{ menuId, count }` | publishing (now or queued) a full menu holding a set menu that has problems (Task 5a)         |
  | `set_menu.vat_class_differs` | `{ productId, productVatClass, setMenuVatClass }`, plus `field: "setVatClass"` and `requestedVatClass` for a class change | a dish or kept variant at another eat-in VAT class than the set menu's, or the set menu's class changed under its dishes, or a live correction that would do either (decision 11, Task 5c) |
  | `set_menu.dish_sold_by_measure` | `{ productId }` | a product sold by measure added to a set menu (decision 12)                                 |

- **Forms:** new or changed forms follow `docs/developers/design-system.md` → Forms and
  `conventions-ui.md`: required fields marked, inline errors, one bottom message, saves quiet until
  the draft changes (`draftScopeFor`, `saveActionState`), and each new dialog or page holding staged
  input gets a `*.unsaved.test.ts`. A screen draws no native field: use the `wt-*` field primitives
  (`scripts/native-form-fields.test.ts`). Every colour and spacing reads a `--wt-*` token. A
  `wt-data-table` row menu column is keyed `actions` and pinned `"end"`.
- **English only** in code, identifiers, tests and fixtures ("Daily menu", never "Menú del día");
  Spanish only in `apps/dashboard/src/i18n/strings.ts`/`codes.ts` translations and the Spanish guide.
- **Write paths:** `scripts/write-path-tables.json` lists none of the tables this plan writes at
  `ed2ac2ea00`; if it does by the time a task starts, write those only from the files it names.
- **Running tests:** `pnpm --filter <pkg> exec vitest run <files>`; read the `Tests` count, never the
  exit status alone (CLAUDE.md §2, §4). Dashboard tests run in headless Chromium: check
  `memory_pressure | grep free` first.
- **Commits:** `git commit -s` for every commit.

## Review Focus

1. **A dish sold à la carte at €18 and +€5 in a set menu placed in the same full menu.** Publishing
   the full menu shows no clash, its offer stays at €18, and its Prices tab never lists the set
   menu's surcharge. Pinned in Task 3a.
2. **A variant with a course of its own.** A glass of wine whose variant "Bottle" sits in another
   course: the served course is per variant, the problems check runs per included variant, and the editor
   lists the dish under the parent's course with the variant's course shown. Pinned in Tasks 4 and 5a.
3. **A course deleted while a set-menu line names it.** The deletion's impact names the set-menu
   lines it changes; the line loses that course; a line left with no course is a publishing problem.
   Pinned in Task 1.
4. **A set menu placed in a full menu and then deleted (made inactive), or placed in two served
   full menus published at different times.** An inactive one leaves no copy and the full menu
   still publishes. Two different copies are served side by side, each with its own key, and only
   the one whose set menu was changed last is `newestOnSale`, even after a live correction; a copy held only by a full menu not selling now is served
   as not orderable and never as `newestOnSale`, so piece 2 never starts a set menu from it. Pinned
   in Tasks 5a, 6a and 6b.
5. **A till on this piece's code receiving a full menu that holds a set menu.** It draws every
   other member and does not fail on the new member kind; nothing on the till offers a set-menu dish
   until piece 2. Pinned in Task 3b, in the till's own `menu-browser` tests.
6. **A set menu changed on the dashboard but its full menu not yet published, or one of its dishes
   sold out, while tills are open.** The tills keep the old copy until the full menu is published;
   a sold-out dish is unavailable in the copy at once, because the zone's menu state reads the
   copy's dishes too. Pinned in Task 6a.
7. **A dish moved to another course after the full menu was published.** It is still served in the
   set menu, still counts as its old course, and is sent with its new course. The full menu shows as
   changed; publishing it again fixes the new course, or refuses if no line accepts it. Pinned in
   Tasks 5a and 6a.
8. **A course deleted while a published copy gives a dish that course** (Fable's F7). The tills
   keep selling the dish from that set menu's folder, sent with its product's course, until the
   full menu is published again; deleting the course changes the zone's fingerprint, so open tills
   reload. Pinned in Tasks 6a and 6b (the zone read and a recorded copy).
9. **A product at another VAT class, by any route into the set menu.** Add products, the existing
   member route, Copy dishes, including a variant again, and changing the set menu's own class are
   all refused naming both classes; a product whose class changes afterwards shows as a problem and
   stops publishing. Pinned in Task 4b.
10. **A price typed in cents** (14000 for €14.00): refused above €10,000.00 on the set menu's price,
    a dish's surcharge and a variant's, and still accepted on an ordinary menu's price. Pinned in
    Tasks 2 and 4b.

---

### Task 1: Schema — the set-menu kind, its lines and its left-out variants

**Files:**
- Modify: `packages/db/src/schema/menus.ts` (the `menus` table, `:33-66`)
- Create: `packages/db/src/schema/menu/set-menus.ts`; export it from `schema/menu/index.ts`
- Modify: `packages/db/src/classification.ts` (menu state list, `:311-330`)
- Modify: `packages/menu/src/classification.ts` (`MENU_TABLES`, which drives live-update sources and
  backup verification, `backup-verification.ts:17`) and `packages/menu/src/configuration-transfer.ts`
  (`MENU_CONFIGURATION_TRANSFER`, `:215-227`, beside `menu_item_variant_overrides`), so an exported
  set menu imports with its lines and left-out variants.
  The watcher cleared the PR 1 review correction at 14:17 on 18 November: the menu validator
  refuses out-of-range prices and set-menu rows owned by an ordinary menu. The venue-service
  configuration validator checks that both kinds of service-period choice point to ordinary menus.
  Each refusal names its bundle field.
- Regenerate: `packages/db/drizzle/0000_baseline.sql` and its snapshot (never by hand)
- Modify: `apps/server/src/course-delete.ts`, `apps/server/src/kitchen.ts` (wherever
  `COURSE_REFERENCES` is exported from; the test imports it from `./kitchen.js`)
- Modify: `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`ADDED_TABLES` `:297-320`,
  and the column splices beside `takeaway_vat_class`'s, `:1052-1058`)
- Test: `packages/db/src/schema/menu/set-menus.test.ts`, `apps/server/src/course-delete.test.ts`

**Interfaces:**
- Produces, on `menus`: `kind` (`enumType(["menu","set_menu"])`, not null, default `"menu"`),
  `setPrice` (`money`, nullable), `setVatClass` (`label`, nullable). CHECKs:
  Use `enumCheck(t.kind)` for `menus_kind_ck`. In `menus_set_terms_ck`, accept either
  `(kind = 'set_menu' and set_price is not null and set_vat_class is not null)` or
  `(kind = 'menu' and set_price is null and set_vat_class is null)`.
  The price check is `set_price is null or set_price >= 0`. Reuse the four classes from
  `products_vat_class_ck` in `menus_set_vat_class_ck`. Use
  `kind = 'menu' or is_default = 0` for `menus_set_not_default_ck`.
- Produces `setMenuLines` (`set_menu_lines`): `id`, `menuId` → `menus.id` on delete cascade,
  `position` (`count`), `count` (`count`, CHECK `between 1 and 99`), index on `(menu_id, position)`.
- Produces `setMenuLineCourses` (`set_menu_line_courses`): `lineId` → `set_menu_lines.id` cascade,
  `courseId` → `kitchen_courses.id`; primary key `(line_id, course_id)`.
- Produces `setMenuVariantExclusions` (`set_menu_variant_exclusions`): `menuItemId`, `productId`,
  `variantId`; primary key `(menu_item_id, variant_id)`; foreign keys copied from
  `menu_item_variant_overrides` (`schema/menu/variant-overrides.ts:21-31`): `(menu_item_id,
  product_id)` → `menu_items (id, product_id)` cascade, `(product_id, variant_id)` →
  `products (parent_id, id)` restrict.
- Produces `setMenuDishCourses` (`set_menu_dish_courses`, decision 9): `menuItemId` → `menu_items.id`
  on delete cascade, the primary key; `courseId` → `kitchen_courses.id`.
- Nothing in the database checks that these rows belong to a set menu; the menu package's writers
  (Task 4) are the only writers. Say so in one line at the table.

- [ ] **Step 1: Write the failing database tests** in `set-menus.test.ts`, with
  `useVenueDb({ migrations: [CORE_MIGRATIONS] })` as `schema/menu/migrations.test.ts:30-33` does:
  - `"a set menu needs a price and a VAT class, and an ordinary menu holds neither"`: inserting
    `kind: "set_menu"` without `setPrice` is refused naming `menus_set_terms_ck`; an ordinary menu
    with `setPrice: 1400` alone or `setVatClass: "reduced"` alone is refused the same way.
    An ordinary menu with neither and a set menu with both are accepted.
  - `"a set menu cannot be the venue's default menu"`: `is_default = 1` on a set menu is refused
    naming `menus_set_not_default_ck`.
  - `"a line takes 1 to 99"`: 0 and 100 refused, 1 and 99 accepted.
  - `"deleting a set menu deletes its lines and their courses"` (a hard delete of the `menus` row
    in the test, cascade checked by counting rows).
  - `"a left-out variant must be a variant of the offer's product"`: an exclusion naming another
    product's variant is refused by the foreign key.
- [ ] **Step 2: Write the failing course test** in `course-delete.test.ts`:
  `"deleting a course takes it off set-menu lines and says how many"`: a set menu with lines
  "1 × Starters" and "1 × Mains or Starters"; `readCourseDeleteImpact(Starters)` lists
  `{ key: "course_set_menu_lines", count: 2 }` in `removes`; after `deleteCourse`, the second line
  keeps Mains, the first holds no course, and both lines still exist. In the same test, a dish
  given Starters in the set menu (decision 9) loses that row, counts again as its product's
  course, and the impact lists `{ key: "course_set_menu_dishes", count: 1 }`.
- [ ] **Step 3: Run both; they fail** (`no such column: kind`, unknown table).
- [ ] **Step 4: Add the columns and tables, classify the four tables `state`, run
  `pnpm --filter @waitron/db db:generate`.** Add `setMenuLineCourses.courseId` and
  `setMenuDishCourses.courseId` to `COURSE_REFERENCES` (the guard
  `apps/server/src/in-use-references.test.ts` requires every foreign key into `kitchen_courses`
  there), delete their rows for the course in `deleteCourse`, and add the `course_set_menu_lines`
  removal (count of distinct lines) and the `course_set_menu_dishes` removal to
  `courseDeleteRules`' impact. Add its
  English and Spanish impact wording wherever the existing `course_products` key is worded on the
  dashboard (grep `course_products`).
- [ ] **Step 4b: Tell the Madrid baseline about the new tables and columns.** The test compares
  the seeded demo with a frozen copy and refuses any table or column it is not told about; #3703,
  #3741 and #3757 each edited it the same way. Add `set_menu_lines`, `set_menu_line_courses`,
  `set_menu_variant_exclusions` and `set_menu_dish_courses` to `ADDED_TABLES` (the seed writes no
  row to them until piece 5). Splice `kind` (TEXT, not null, default `'menu'`), `set_price` and
  `set_vat_class` (both nullable) into the frozen copy's menus table after the column they follow
  in the generated baseline, as `takeaway_vat_class` is spliced into `products` at `:1052-1058`,
  with the cells `"menu"`, `null` and `null` on every row. The menus table is named `catalogues`
  at some points of the copy's chain (`:516`); splice it where the test reaches it, and let the
  refusal name the place. Run
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts`;
  it runs both seed languages, and must pass in both. Piece 5 Task 5b builds on this.
- [ ] **Step 5: Run both test files, then the schema verification list in Global Constraints,
  `apps/server/src/in-use-references.test.ts`, `packages/composition/src/composition.test.ts`
  (it compares `MENU_TABLES` with the classification, `:176-185`) and the configuration-transfer
  tests (grep `MENU_CONFIGURATION_TRANSFER` for them), with one added case there: `"a set menu
  exports and imports with its lines, their courses, its dishes' own courses and its left-out
  variants"`.** All pass; read
  each `Tests` count.
- [ ] **Step 6: Commit** — "Set menus: the set-menu kind of menu, its lines and its left-out variants".

### Task 2: Shared types and the menu package's set-menu details

**Files:**
- Create: `packages/shared/src/menu-document/set-menu-types.ts`; export from the shared index the
  way `menu-types.ts` is
- Create: `packages/menu/src/set-menus.ts`
- Modify: `packages/menu/src/operations.ts` (`Menu`/`MenuSummary` from `:103`: add `kind`,
  `setPrice`, `setVatClass`, and the dashboard client's copies of those types; `insertMenu`
  `:342-346`, which must write kind, price and class in its one insert or the Task 1 check refuses
  it; `createMenu` `:321-339`, `updateMenuDetails`
  `:824-863`, `setVenueDefaultMenu` `:1160`, `menuPrices` `:727`), `packages/menu/src/errors.ts`
- Modify: `packages/venue-service/src/menu-timetable.ts` (`:365-371`)
- Test: `packages/menu/src/set-menus.test.ts`, `packages/venue-service/src/menu-timetable.test.ts`

**Interfaces:**
- Produces in `set-menu-types.ts`:

```ts
export type MenuKind = "menu" | "set_menu";

/** What one set menu includes: "N × course", where a line may accept several courses. `count` is
 * piece 3's `SetMenuOfferLine.count`. */
export interface SetMenuLine {
  id: string;
  count: number;
  /** Active courses, in course display order. */
  courseIds: string[];
}

/** Why a set menu cannot be published yet; the editor lists these, publishing refuses on any. */
export type SetMenuProblem =
  | { kind: "no_dishes" }
  | { kind: "no_lines" }
  | { kind: "line_without_course"; lineId: string }
  /** No listed dish (or included variant) counts as any of the line's courses. */
  | { kind: "line_unfillable"; lineId: string }
  | { kind: "dish_without_course"; productId: string; name: string; parentName: string | null }
  | {
      kind: "dish_not_included";
      productId: string;
      name: string;
      parentName: string | null;
      courseId: string;
      courseName: string;
    }
  /** Decision 11: the product's class was changed on its own page after it was added. */
  | {
      kind: "dish_vat_class_differs";
      productId: string;
      name: string;
      parentName: string | null;
      vatClass: VatClass;
    }
  /** Decision 12: the product's unit was changed to one that measures an amount. */
  | { kind: "dish_sold_by_measure"; productId: string; name: string };

/** A set menu's price, VAT class, names and lines, as a full menu's copy of it holds them. */
export interface SetMenuTerms {
  /** Gross, per set menu, as a two-place decimal string. */
  price: string;
  vatClass: VatClass;
  /** Customer-facing names by language, frozen at publish, for receipts printed from a recorded
   * version (piece 4); `{}` when the set menu has none. */
  names: Record<string, string>;
  lines: SetMenuLine[];
}
```

  What a dish counts as is not in the terms: it is each copied offer's `countsAsCourseId`
  (decision 4, Task 5a).

- Produces in `packages/menu/src/set-menus.ts`:
  `requireSetMenu(tx, menuId): Promise<void>` (throws `set_menu.not_found`) and
  `refuseSetMenu(tx, menuId): Promise<void>` (throws `set_menu.wrong_place` when `menuId` is a set
  menu) — the two guards every later task calls.
- `createMenu`'s input gains `kind?: MenuKind`, `setPrice?: string | null`,
  `setVatClass?: VatClass | null`; `updateMenuDetails`'s gains `setPrice` and `setVatClass`
  (refused with `set_menu.not_found` on an ordinary menu). A set menu's price must pass
  `isProductPrice` and be at most `MAX_SET_MENU_AMOUNT_CENTS` (decision 13; `set_menu.invalid`,
  `field: "setPrice"`), and its class must be one of the four (`field: "setVatClass"`). Refusing a
  class change while the set menu holds dishes at the old class is Task 4b's.

- [ ] **Step 1: Write the failing tests** in `set-menus.test.ts`:
  - `"creates a set menu with its price and class, and a root and home like any menu"`:
    `createMenu(tx, { name: "Daily menu", kind: "set_menu", setPrice: "14.00", setVatClass: "reduced" })`
    returns `kind: "set_menu"`, `setPrice: "14.00"`; `menuRoot(tx, id)` is defined.
  - `"refuses a set menu without a valid price or class"`: `setPrice: "-1"` →
    `set_menu.invalid` `{ field: "setPrice" }`; `setVatClass: "luxury"` → `{ field: "setVatClass" }`.
  - `"refuses a set-menu price above 10,000.00"`: `setPrice: "10000.01"` and `"14000.00"` →
    `set_menu.invalid` `{ field: "setPrice" }`, on create and on change; `"10000.00"` is accepted.
    The limit is the set menu's only: no ordinary price check changes.
  - `"changes a set menu's price and refuses a price on an ordinary menu"`.
  - `"a set menu cannot be the default menu"`: `setVenueDefaultMenu` → `set_menu.wrong_place`.
  - `"the Prices read refuses a set menu"`: `menuPrices` → `set_menu.wrong_place`.
- [ ] **Step 2: Write the failing period test** in `menu-timetable.test.ts`:
  `"a period cannot sell a set menu as its customer menu or a staff menu"`: both refused with
  `set_menu.wrong_place` `{ menuId }`; a set menu is sold only by being placed in a menu the period
  sells. Call `refuseSetMenu` beside the existing period write check. Add a read case for the
  timetable management model, which supplies both period pickers, and filter its menu query
  by `kind = "menu"`.
- [ ] **Step 3: Run; they fail.**
- [ ] **Step 4: Implement.** `listMenus`/`MenuSummary` carry `kind` and `setPrice` so the list
  (Task 8a) can show them; grep every `MENU_COLUMNS` reader to keep the type complete.
- [ ] **Step 5: Run both files; all pass.** Then `pnpm --filter @waitron/menu exec tsc --noEmit`
  and the same for `@waitron/venue-service`.
- [ ] **Step 6: Commit** — "Set menus: create one with a price and VAT class; keep it out of periods and the default menu".

### Task 3a: A set menu as a member of a full menu — the graph and the member writes

**Files:**
- Modify: `packages/shared/src/menu-document/section-types.ts` (`MemberRef`, `:6-7`)
- Modify: `packages/menu/src/section-graph.ts` (`toSectionMember`, `buildSectionGraph`,
  `loadSectionGraph`, `SectionGraph.menu`), `packages/menu/src/section-members.ts` (`membersOf`
  `:19-29`, `checkRef` `:83-91`, the member writes), `packages/menu/src/sections.ts`,
  `packages/menu/src/include-folder.ts` (the folder-settings write and the import check
  `:186-191`), `packages/menu/src/menu-inclusion.ts` (`includableMenus`),
  `packages/menu/src/menu-structure.ts` (`readMenuStructure`: add `placeableSetMenus`)
- Test: `packages/menu/src/set-menu-placement.test.ts`

**Interfaces:**
- `MemberRef` gains `{ kind: "set_menu"; menuId: string }`. Storage is unchanged: the row's
  `child_section_id` is the set menu's root. The classification happens in ONE place:
  `toSectionMember(row, setMenuRoots: ReadonlyMap<string, string>)` (root section id → set menu id)
  returns this ref for a child that is a set menu's root. `buildSectionGraph` and `membersOf` both
  pass the map, so the graph and the member reads always agree. `loadSectionGraph` reads
  `menus.kind`; `SectionGraph.menu()` returns `{ name, active, kind }`.
- Adding a member accepts `{ kind: "set_menu", menuId }` (resolved to the set menu's root). It is
  refused with `set_menu.wrong_place` when written as `{ kind: "section", sectionId: <a set menu's
  root> }`, including as a Home page shortcut. A Home page shortcut also refuses a direct
  `set_menu` ref with `set_menu.wrong_place`. A set menu's list takes only products. A section, an
  include or a set menu is refused with `set_menu.dishes_only`. Folder settings
  (`PUT .../members/:memberId/folder`) on a set-menu member are refused with
  `set_menu.wrong_place`.
- `includableMenus` leaves set menus out; `readMenuStructure` adds
  `placeableSetMenus: { id: string; name: string }[]` (active set menus not already in this list).

- [ ] **Step 1: Write the failing tests** in `set-menu-placement.test.ts`:
  - `"a set menu placed in a full menu adds none of its dishes to the full menu's offers"`: Sirloin
    on the full menu at its €18 product price; a set menu listing Sirloin with surcharge "5.00" is
    placed in the full menu's root; `listMenuOffers` for the full menu has one Sirloin offer at
    `"18.00"`, and the full menu has no `menu_items` row for any dish only the set menu lists.
  - `"publishing the full menu shows no clash for a dish both list at different prices"`:
    `buildMenuDocument(fullMenu).clashes` is `[]`, and `menuPrices(fullMenu)` lists Sirloin at
    `"18.00"` with no row from the set menu.
  - `"the graph and the member read agree that it is a set menu"`: `loadSectionGraph` children and
    `membersOf` for the full menu's root both give `{ kind: "set_menu", menuId }`.
  - `"a set menu's list takes only products"`: adding a new section, an include and another set
    menu to it are each refused `set_menu.dishes_only`.
  - `"a set menu is placed only as a set menu"`: the section ref to its root, as a member and as a
    Home shortcut, is refused `set_menu.wrong_place`. A direct set-menu ref is also refused as a
    Home shortcut. Folder settings on the placed member are refused with `set_menu.wrong_place`.
    `includableMenus` and `readMenuStructure(fullMenu).includable` omit it.
    `placeableSetMenus` lists it until placed.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Run `pnpm --filter @waitron/menu typecheck` and fix the sites in the
  files this task lists. Sites the new ref kind breaks in other packages are Task 3b's: 3a and 3b
  ship on the same branch, in that order, and 3a's commit message lists the packages whose
  typecheck it leaves failing for 3b.
- [ ] **Step 4: Run the test file and `packages/menu`'s suite** (`exec vitest run`; read the count).
- [ ] **Step 5: Commit** — "Set menus: place a set menu in a full menu without combining its prices".

### Task 3b: The full menu's set-menu member, and every reader of a menu's tree

**Hand over if it runs long** (the typecheck sweep reaches seven packages). If this task passes
about 150 tool calls unfinished, stop at a point where the packages done so far typecheck, commit,
and return a handover: the packages done, those left, the sites and choices so far, and each
check's state. A fresh implementer continues from it.

**Files:**
- Modify: `packages/shared/src/menu-document/menu-document-types.ts` (`DocumentMember`, `:54-70`),
  `packages/menu/src/menu-document.ts` (`listOf`, `:258-292`),
  `packages/shared/src/menu-document/device-home.ts` (`indexDocument`, `shownMembers`)
- Modify: every site the typecheck names, and no others (the readers the compiler does not name
  are Task 3c's, so this task ends when every package typechecks; Fable's M8)
- Test: `packages/menu/src/set-menu-placement.test.ts` (more cases),
  `packages/shared/src/menu-document/device-home.test.ts`, `apps/till/src/widgets/menu-browser.test.ts`

**Interfaces:**
- Consumes the `set_menu` `MemberRef` (Task 3a).
- `DocumentMember` gains `{ kind: "set_menu"; menuId: string; name: string }`. `listOf` emits it for
  an active set menu and nothing for an inactive one, as it does for an included menu (`:270`).

- [ ] **Step 1: Write the failing tests:**
  - in `set-menu-placement.test.ts`: `"the full menu's document holds the set menu as a set_menu
    member"` (its root members include `{ kind: "set_menu", menuId, name: "Daily menu" }` and no
    section for the set menu's root); `"an inactive set menu leaves no member"`.
  - in `device-home.test.ts`: `"a set_menu member is skipped and the rest of the document is
    indexed"`: a document whose root holds a product, a section and a `set_menu` member indexes the
    product and the section, and `shownMembers` returns the other two members.
  - in the till's `menu-browser.test.ts`: `"a menu holding a set menu draws its other tiles"`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement, then run the `typecheck` script of each package and app that imports
  `MemberRef` or `DocumentMember`** (grep the two names; at least `menu`, `shared`, `venue-service`,
  `media`, `apps/server`, `apps/till`, `apps/dashboard`). Narrowing on `ref.kind`/`member.kind`
  makes the compiler name every site that reads `.sectionId` or `.members` after excluding
  `"product"`. At each site decide one of: skip the member (`reachableFrom`, `placementsByProduct`,
  `wouldCreateCycle`, the till's `menu-browser.ts`, the guest menu, `menu-navigation.ts`, the
  diff's `shapeOf`), or handle it (`listOf`). Record the sites and the choice in the commit message.
- [ ] **Step 4: Run the three test files, `packages/menu`'s and `packages/shared`'s suites, and the
  till's `menu-browser` and `device-home` tests.**
- [ ] **Step 5: Commit** — "Set menus: a full menu's document names its set menus, and every typed tree reader skips them".

### Task 3c: The tree readers the compiler does not name

**Files:**
- Modify, as the tests require: `packages/menu/src/section-graph.ts` (`menusContaining` `:205`,
  `sectionPathName` `:221`, `parents`), `packages/menu/src/menu-structure.ts`
  (`readMenuStructure`'s `includedBy`, `:130-165`), and the raw-SQL readers that treat any child that is a
  menu's root as an included menu: `packages/menu/src/content-translation-candidates.ts:92-98`
  (the translation gap report's `included_menu` rows) and `packages/media/src/images.ts:225`
- Test: `packages/menu/src/set-menu-placement.test.ts` (more cases), `packages/media/src/images.test.ts`

**Interfaces:**
- Consumes the `set_menu` member (Tasks 3a, 3b). Produces nothing new: each reader keeps its
  signature.

- [ ] **Step 1: Write one failing test per reader whose answer a placed set menu changes**:
  `"menusContaining names the full menu that holds a set menu"`, `"the translation gap report does
  not list a placed set menu as an included menu"`, and one for each of `parents`,
  `sectionPathName`, `includedBy` and the media reader at `images.ts:225` whose answer differs
  when a set menu is placed. Read each reader first; a reader whose answer the set menu cannot
  change gets no test, and the commit message says why. (A set-menu change marks the full menu as
  changed through Task 5a's copy in the document, not through these readers.)
- [ ] **Step 2: Run; they fail.** `pnpm --filter @waitron/menu exec vitest run src/set-menu-placement.test.ts`
  and `pnpm --filter @waitron/media exec vitest run src/images.test.ts`.
- [ ] **Step 3: Implement** each reader so it reports the full menu as holding the set menu, as
  a set menu and never as an included menu.
- [ ] **Step 4: Run the files, then `packages/menu`'s and `packages/media`'s suites.**
- [ ] **Step 5: Commit** — "Set menus: the untyped tree readers see a placed set menu as one".

### Task 4: A set menu's dishes, variants and lines

**Files:**
- Modify: `packages/menu/src/set-menus.ts`
- Modify: `packages/menu/src/menu-copy.ts` (`duplicateMenu`), `packages/menu/src/variants.ts`
  (only if a helper is shared); for `touchSetMenu`'s callers, `packages/menu/src/operations.ts`
  (`updateMenuItem` `:390`, `updateMenuDetails` `:819`), `packages/menu/src/section-members.ts`
  (the member writes) and `packages/menu/src/menu-structure.ts` (`syncMenuOffers`' reset)
- Test: `packages/menu/src/set-menus.dishes.test.ts`

**Interfaces:**
- Consumes: `requireSetMenu` (Task 2); `menu_items` rows made by `syncMenuOffers` when products are
  added to the set menu's root through the existing member writes (Task 3a keeps those to products).
- Produces:

```ts
export interface SetMenuDishSetting {
  menuItemId: string;
  productId: string;
  name: string;
  /** null: included. */
  surcharge: string | null;
  /** The course the dish counts as and is sent with here: `courseOverrideId` when set, else the
   * product's effective course; null when it has none or it is inactive. */
  courseId: string | null;
  /** The product's own effective course, shown as the default. */
  productCourseId: string | null;
  /** The course this set menu gives the dish (decision 9); null: the product's. */
  courseOverrideId: string | null;
  /** The product's effective eat-in class (decision 11). */
  vatClass: VatClass;
  /** Its unit measures an amount (`units.measure`, decision 12). */
  soldByMeasure: boolean;
  variants: {
    id: string;
    name: string;
    included: boolean;
    /** null: the dish's surcharge. */
    surcharge: string | null;
    /** The dish's `courseOverrideId` when set, else the variant's own effective course. */
    courseId: string | null;
    /** The variant's effective eat-in class: its own, else its parent's. */
    vatClass: VatClass;
  }[];
}

export interface SetMenuDetails {
  id: string;
  name: string;
  names: Record<string, string>;
  price: string;
  vatClass: VatClass;
  /** In the root list's member order. */
  dishes: SetMenuDishSetting[];
  lines: SetMenuLine[];
  /** Active courses in display order, for the editor's grouping and line choices. */
  courses: { id: string; name: string }[];
  problems: SetMenuProblem[];
  /** Full menus holding this draft, with names for the editor links. */
  heldBy: { id: string; name: string }[];
}

export function readSetMenu(tx: Transaction, menuId: string): Promise<SetMenuDetails>;
export function saveSetMenuLines(
  tx: Transaction,
  menuId: string,
  lines: readonly { count: number; courseIds: readonly string[] }[],
): Promise<SetMenuLine[]>;
export function saveSetMenuVariantChoices(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  variants: readonly { variantId: string; included: boolean; surcharge: string | null }[],
): Promise<void>;
/** Adds products to the set menu's list, each with the variants it leaves out, in one go; answers
 * the lines `addLinesForCourses` added. */
export function addSetMenuDishes(
  tx: Transaction,
  menuId: string,
  dishes: readonly { productId: string; excludedVariantIds: readonly string[] }[],
): Promise<SetMenuLine[]>;
export function copySetMenuDishes(tx: Transaction, menuId: string, fromMenuId: string): Promise<SetMenuLine[]>;
/** Sets the set menu's `menus.updated_at` to now: the stamp its copy carries (decision 10). */
export function touchSetMenu(tx: Transaction, menuId: string): Promise<void>;
/** Appends "1 × course" for each course among these dishes that no line accepts; answers the
 * lines it added, for the editor's "Added a line" note. */
export function addLinesForCourses(
  tx: Transaction,
  menuId: string,
  productIds: readonly string[],
): Promise<SetMenuLine[]>;
export function setMenuProblems(details: Omit<SetMenuDetails, "problems">): SetMenuProblem[];
```

- `saveSetMenuLines` replaces the set menu's lines in the order given (delete then insert; nothing
  outside these two tables refers to a line, so the replacement is safe — check `REFERENCES` first,
  CLAUDE.md §3). Refusals, all `set_menu.invalid`: more than 20 lines (`field: "lines"`), a count
  outside 1–99 (`"count"`), a line with no course, a repeated course within a line, or an
  inactive or unknown course (`"courseIds"`).
- The surcharge reuses the existing `updateMenuItem` (`operations.ts:393-402`); on a set menu its
  `grossPrice` is the surcharge (**my call**, decision 2). Write that meaning in one line at
  `menu_items.gross_price` (`schema/menu/menu.ts:6-7`).
- `saveSetMenuVariantChoices` takes every Active variant of the dish: `included: false` stores an
  exclusion and deletes any override; `included: true` deletes any exclusion and stores the
  surcharge as `menu_item_variant_overrides.price`, or deletes it when null. A variant not of this
  dish → `product.variant_not_found`, as `setMenuVariants` does (`variants.ts:403-406`).
- `readSetMenu` uses `menusContaining` from Task 3c for `heldBy`. Assert the parent id and name
  in the details read of a placed set menu. Filter to full menus so the set menu itself is
  omitted. Reuse the graph already loaded for a batch document build.
- `readSetMenu` reads `set_menu_dish_courses` for `courseOverrideId` (null until Task 4c writes
  any); the write is Task 4c's.
- **Every write that changes a set menu calls `touchSetMenu`** in the same transaction (decision
  10): the member writes that add, remove or move products in its root, `updateMenuItem` on its
  menu item, `saveSetMenuVariantChoices`, `saveSetMenuLines`, `addSetMenuDishes`,
  `copySetMenuDishes`, `syncMenuOffers`' reset of one of its rows, and Task 2's
  `updateMenuDetails` (name, names, price, class). Task 4c adds `saveSetMenuDishCourse`.
- `copySetMenuDishes` adds, in the source's order, every dish the source lists that this set menu
  does not, with the source's surcharge, course, variant exclusions and variant surcharges; dishes already
  here keep theirs (**my call**). Both menus must be set menus. It calls `addLinesForCourses` for the
  dishes it added.
- The member write that adds products to a set menu's root calls `addLinesForCourses` in the same
  transaction (find it through `onStructureChanged`, `section-structure.ts:11-15`), and its route
  answer carries `addedLines` (Task 7).
- `syncMenuOffers`' reset of a row the menu no longer reaches (`menu-structure.ts:225-232`) also
  deletes that row's `set_menu_variant_exclusions` and its `set_menu_dish_courses` row, so a dish
  removed and added again starts with every variant included and its product's course, as the spec
  says new dishes do. (The reset keeps the row, so the
  exclusion's cascade never fires.)
- `duplicateMenu` of a set menu copies its kind, price, class, lines with their courses, its
  dishes' own courses, and exclusions (it already copies `menu_items` and overrides; check that it does).
- Problems (pure, from the details): `no_dishes`; `no_lines`; `line_without_course`;
  `dish_without_course` for an included product with no Active variant and no course, and for each
  included variant with no course (`parentName` set); `dish_not_included` when no line accepts that
  course; `line_unfillable` when no included dish or variant counts as any of the line's courses
  (decision 5). Every problem reads the course the dish has in this set menu (`courseId` above), so
  a product with no course stops being a problem once the set menu gives it one. Courses here are
  the dishes' current ones: the copy takes them when a full menu
  holding the set menu is published (decision 4). A dish whose variants are all left out is a problem of kind `no_dishes`
  only if it was the last dish; otherwise it is simply not offered (**my call**).

- [ ] **Step 1: Write the failing tests** in `set-menus.dishes.test.ts`, with courses Starters,
  Mains, Desserts and Coffee:
  - `"adding dishes adds a line for each course no line accepts"`: add Soup (Starters) and Hake
    (Mains) → lines `[1 × Starters, 1 × Mains]` and both are answered as added; add Salad
    (Starters) → unchanged, nothing answered.
  - `"adding a dish can leave variants out from the start"`: `addSetMenuDishes` with Wine and
    `excludedVariantIds: [bottle]` → Bottle `included: false`; an id that is not Wine's variant →
    `product.variant_not_found` and nothing is added.
  - `"a dish removed and added again has every variant included"`: leave Wine's Bottle out, remove
    Wine, add it again → Bottle is included and no exclusion row remains.
  - `"a line no dish can fill is a problem"`: `1 × Coffee` with no coffee dish →
    `line_unfillable`.
  - `"lines replace in the order given and refuse bad input"`: save
    `[{1,[Starters]}, {1,[Mains, Starters]}, {1,[Desserts, Coffee]}]`, read it back in that order,
    each line's courses in display order; then each refusal above with its `field`.
  - `"a surcharge is the menu item's price on a set menu"`: `updateMenuItem(Sirloin, "5.00")` →
    `readSetMenu` shows `surcharge: "5.00"`; null shows included.
  - `"a variant can be left out or given its own surcharge"`: Wine with Glass and Bottle; leave
    Bottle out, give Glass "1.50" → read back `{Glass: included, "1.50"}, {Bottle: included: false}`;
    include Bottle again → no exclusion row remains.
  - `"every write to a set menu moves its updated_at, and a read does not"`: one case per writer
    listed above, each comparing `menus.updated_at` before and after with the clock advanced (fake
    timers or an injected time, as the neighbouring menu tests do); `readSetMenu` leaves it alone.
  - `"a variant's own course is reported and checked"`: Bottle's own course is Desserts and no line
    accepts Desserts → `problems` holds `dish_not_included` with `parentName: "Wine"`.
  - `"problems name every reason publishing would refuse"`: one case per problem kind.
  - `"copying dishes adds the other set menu's missing dishes with their surcharges and keeps ours"`.
  - `"duplicating a set menu copies its terms, lines and left-out variants"`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Trace every reader of `menu_items.gross_price`** (grep `grossPrice` and
  `gross_price` under `packages/menu/src`, `apps/server/src`): `resolveOfferPrice` and the variant
  price chain (`offer-price.ts:20-30`, `operations.ts:773`, which ranks a variant's own à la carte
  price above the dish's menu price, so `listMenuOffers` alone prices a set menu's variants à la
  carte until Task 5a's `freezeSetMenu` replaces them), `combineOffer`'s `own()`, `menuPrices`,
  `updateMenuItem`, `syncMenuOffers`' reset, `duplicateMenu`, the preview's undo
  (`menu-undo.ts:194,216`) and `inheritedPrice` (`menu-document.ts:1185-1194`), fixed in Tasks 5b
  and 5a, and the live patch (`menu-patch.ts:177`): a set menu has no live version to patch, and a full
  menu's live price correction changes only the full menu's own offer, never a copy's surcharge
  (Task 5c's test covers both). For each, state in the commit message whether it can
  reach a set menu's row and, if it can, why the surcharge reading is right there or how it is
  refused. `menuPrices` is refused (Task 2).
- [ ] **Step 5: Run the file and `packages/menu`'s suite; all pass.**
- [ ] **Step 6: Commit** — "Set menus: dishes with surcharges, variants left out, and what one set menu includes".

### Task 4b: What a set menu may hold — its VAT class, nothing sold by measure, and the amount limit

**Files:**
- Modify: `packages/menu/src/set-menus.ts`, `packages/menu/src/errors.ts`,
  `packages/menu/src/operations.ts` (`updateMenuDetails`, `:819` at `b31ec62e37`, for the class change;
  `updateMenuItem` `:390-399` for a set menu's surcharge), `packages/menu/src/variants.ts` only if
  the variant surcharge write is shared with `setMenuVariantPrice` (`:444-470`)
- Test: `packages/menu/src/set-menus.refusals.test.ts`

**Interfaces:**
- Consumes `readSetMenu`'s `vatClass`, `soldByMeasure` and variant `vatClass` (Task 4).
- Produces, in `set-menus.ts`:
  `refuseDishesSetMenuCannotHold(tx: Transaction, menuId: string, dishes: readonly { productId: string; keptVariantIds: readonly string[] }[]): Promise<void>`,
  which throws `set_menu.vat_class_differs` `{ productId, productVatClass, setMenuVatClass }` for
  the first product or kept variant (in the order given) whose effective eat-in class is not the
  set menu's, and `set_menu.dish_sold_by_measure` `{ productId }` for the first product whose unit
  has `measure` set. Called, before anything is written, by `addSetMenuDishes`,
  `copySetMenuDishes`, the member write that adds products to a set menu's root (the same site
  that calls `addLinesForCourses`, Task 4), and `saveSetMenuVariantChoices` for each variant it
  includes. Decisions 11 and 12; both codes are declared in `errors.ts` with these params.
- `updateMenuDetails` refuses a new `setVatClass` with `set_menu.vat_class_differs` naming the
  first included dish or variant still at another class. The refusal carries
  `{ productId, productVatClass, setMenuVatClass, field: "setVatClass", requestedVatClass }`
  so the editor can explain the attempted change next to the field.
- On a set menu's menu item, `updateMenuItem` refuses a surcharge above
  `MAX_SET_MENU_AMOUNT_CENTS` with `set_menu.invalid` `{ field: "surcharge" }`, and
  `saveSetMenuVariantChoices` does the same for a variant's surcharge (decision 13). Import the
  limit from `@waitron/shared` (`packages/shared/src/index.ts:573`); never copy the number.
- `setMenuProblems` adds `dish_vat_class_differs` for each included dish or variant whose class is
  not the set menu's, and `dish_sold_by_measure` for each dish sold by measure: the two ways a
  product changed on its own page can break the rule after it was added.

- [ ] **Step 1: Write the failing tests** in `set-menus.refusals.test.ts`, on a Daily menu at
  `reduced`:
  - `"a product at another eat-in class is refused, by every way in"`: Sirloin at `general` →
    `addSetMenuDishes`, the existing add-products member write and `copySetMenuDishes` (from a
    set menu that lists Sirloin) each throw `set_menu.vat_class_differs`
    `{ productId: sirloin, productVatClass: "general", setMenuVatClass: "reduced" }`, and the set
    menu's dishes are unchanged after each.
  - `"a variant at another class is refused only while it is kept"`: Wine at `reduced` whose
    Bottle variant is `general`: adding Wine with nothing left out is refused naming Bottle;
    adding it with Bottle left out is accepted; including Bottle later through
    `saveSetMenuVariantChoices` is refused.
  - `"a product's takeaway class does not matter"`: Soup at `reduced` with takeaway class
    `general` is accepted.
  - `"the set menu's class cannot change under its dishes"`: `updateMenuDetails(daily, { setVatClass: "general" })`
    with Soup listed is refused naming Soup; a set menu with no dishes changes class.
  - `"a class changed on the product afterwards is a problem"`: Soup listed, then its class set
    to `general` on the product → `readSetMenu(daily).problems` holds `dish_vat_class_differs`
    `{ productId: soup, vatClass: "general" }`.
  - `"a product sold by measure is refused, and one changed to it afterwards is a problem"`:
    Turbot in a unit with `measure: true` → `set_menu.dish_sold_by_measure` `{ productId: turbot }`;
    Hake listed, then its unit changed to that unit → `dish_sold_by_measure` in `problems`.
  - `"a surcharge above 10,000.00 is refused on a set menu only"`: `updateMenuItem` on Daily's
    Sirloin with `"10000.01"` → `set_menu.invalid` `{ field: "surcharge" }`, `"10000.00"` accepted;
    a variant surcharge of `"10000.01"` refused the same way; the same `"10000.01"` on an ordinary
    menu's item is accepted.
- [ ] **Step 2: Run; they fail.**
  `pnpm --filter @waitron/menu exec vitest run src/set-menus.refusals.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file, `src/set-menus.dishes.test.ts`, and `packages/menu`'s suite; all pass.**
- [ ] **Step 5: Commit** — "Set menus: hold only dishes at the set menu's VAT class, none sold by measure, within the amount limit".

### Task 4c: Giving a dish another course in the set menu

**Files:**
- Modify: `packages/menu/src/set-menus.ts`
- Test: `packages/menu/src/set-menus.dish-course.test.ts`

**Interfaces:**
- Consumes `readSetMenu`, `addLinesForCourses`, `touchSetMenu` (Task 4).
- Produces:

```ts
/** Gives the dish a course in this set menu (decision 9), or clears it with null; answers the
 * lines `addLinesForCourses` added for the new course and the line the change emptied
 * (decision 14). */
export function saveSetMenuDishCourse(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  courseId: string | null,
): Promise<{ addedLines: SetMenuLine[]; removedLines: SetMenuLine[] }>;
```

- It refuses an inactive or unknown course with `set_menu.invalid` `{ field: "courseId" }`, and a
  menu item not on this set menu with `set_menu.not_found`. A course equal to the product's own
  effective course is stored as no row (decision 9, **owner**, ledger item 2: "follow the
  product"). When no line accepts the new course, it appends one through `addLinesForCourses`, as
  adding a dish does (decision 5). It then removes the dish's old-course line when that line has
  count 1, accepts the old course alone, and no listed dish or included variant still counts as it
  (decision 14, **my call (plan writer)**); a line with more courses, a larger count, or another
  dish to fill it stays. It calls `touchSetMenu`.

- [ ] **Step 1: Write the failing tests** in `set-menus.dish-course.test.ts`, with courses
  Starters, Sharing plates and Desserts:
  - `"a set menu can give a dish another course"`: Soup (Starters) and Bravas (Sharing plates) are
    added, which appends `1 × Starters` and `1 × Sharing plates`;
    `saveSetMenuDishCourse(Bravas, Starters)` answers `removedLines: [1 × Sharing plates]` and no
    added lines, and `readSetMenu` shows lines `[1 × Starters]`, Bravas with `courseId: Starters`,
    `productCourseId: Sharing plates`, `courseOverrideId: Starters`, and its variants' `courseId`
    Starters, with no `line_unfillable` problem. Saving Sharing plates again stores no row and
    answers `addedLines: [1 × Sharing plates]`. Bravas sold à la carte keeps Sharing plates. An
    inactive course → `set_menu.invalid` `{ field: "courseId" }`.
  - `"a course change keeps a line that is not left empty"`: three runs, each giving Bravas
    Starters, with the Sharing plates line made `2 ×`, then `1 × Sharing plates or Desserts`, then
    left `1 ×` with Croquetas (Sharing plates) also listed. Each answers `removedLines: []` and the
    line is still there.
  - `"a dish with no course stops being a problem once the set menu gives it one"`.
  - `"a course change moves the set menu's updated_at"`.
  - `"copying and duplicating carry a dish's own course"`: extend Task 4's copy and duplicate
    cases with Bravas given Starters.
- [ ] **Step 2: Run; they fail.**
  `pnpm --filter @waitron/menu exec vitest run src/set-menus.dish-course.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file, `src/set-menus.dishes.test.ts` and `packages/menu`'s suite; all pass.**
- [ ] **Step 5: Commit** — "Set menus: give a dish another course in one set menu".

### Task 5a: The set menu's copy in a full menu's published document, and refusing to publish an unpublishable one

**Files:**
- Create: `packages/menu/src/set-menu-document.ts`
- Modify: `packages/menu/src/menu-document.ts` (`buildMenuDocuments` `:147-341`, `BuiltMenu`
  `:104-112`), `packages/shared/src/menu-document/menu-document-types.ts` (`MenuDocument`)
- Modify: `packages/menu/src/menu-publication.ts` (`publishMenu` `:660-689`, `patchLiveMenu`
  `:734`)
- Test: `packages/menu/src/set-menu-document.test.ts`

**Interfaces:**
- Consumes: `readSetMenu`, `setMenuProblems` (Tasks 4, 4b); the `set_menu` `DocumentMember` (Task 3b).
- Produces, in `menu-document-types.ts`:

```ts
export type SetMenuOfferVariant = FrozenOfferVariant & {
  /** What this variant counts as when placed in this set menu (decision 4). */
  countsAsCourseId: string;
};
export type SetMenuFrozenOffer = Omit<FrozenOffer, "variants"> & {
  /** What this dish counts as when placed in this set menu, whichever folder it was tapped in:
   * the set menu's own course for it, else the product's, fixed when the full menu is published
   * (decision 4). null only for a dish whose variants each carry their own. */
  countsAsCourseId: string | null;
  /** The course this set menu gives the dish (decision 9); serving sends a dish tapped in this
   * folder, and every kept variant, with it while the course exists (Task 6a). null: none. */
  courseOverrideId: string | null;
  variants: SetMenuOfferVariant[];
};
/** A set menu as a full menu's published version holds it. */
export interface PublishedSetMenu {
  name: string;
  terms: SetMenuTerms;
  /** The set menu's root list: product members only. */
  root: DocumentList;
  /** Keyed by the set menu's own menu-item ids; never merged into the document's `offers`. */
  offers: Record<string, SetMenuFrozenOffer>;
  /** The set menu's `menus.updated_at` when this copy was taken (decision 10); a live correction
   * carries it over unchanged. */
  changedAt: string;
}
```

  `MenuDocument` gains optional `setMenus?: Record<string, PublishedSetMenu>`, keyed by set menu
  id.
- Produces `freezeSetMenu(offers: FrozenOffer[], root: DocumentList, details: SetMenuDetails): PublishedSetMenu`
  in `set-menu-document.ts`. In the copy:
  - each offer's `unitPrice` is the dish's surcharge, `"0.00"` when included; each variant left out
    is removed from `variants`; each kept variant's `unitPrice` and `menuPrice` are its surcharge
    (its own, else the dish's, else `"0.00"`). An offer whose variants are all left out is dropped,
    with its product member.
  - `countsAsCourseId` is the course `readSetMenu` reports for the dish and for each kept variant,
    which is the set menu's own course for the dish when it gives one; `courseOverrideId` is
    `readSetMenu`'s `courseOverrideId`.
  - `terms` is `{ price, vatClass, names, lines }`, `names` from the set menu's root section.
- Produces `documentSetMenuOffers(document: MenuDocument): SetMenuFrozenOffer[]` in
  `menu-document.ts`, beside `documentOffers` (`:496`): every copy's offers, copy by copy in set
  menu id order and each in its root's order, `[]` for a document without `setMenus`. It is how
  every later reader reaches the copies' dishes (Tasks 5c, 6a); `documentOffers` never returns
  them.
- `buildMenuDocuments` adds a set menu to the menus it builds whenever a requested menu's tree, or
  the tree of a menu it includes, holds it as an active `set_menu` member (as `visit` does for
  includes, `:189-197`), so its offers come from the same `listMenuOffers` call. The full menu's
  document gets `setMenus[id] = freezeSetMenu(...)` for each such set menu, including one placed
  inside an included menu's list. The copy never enters `combined` or `clashes`.
- **How the copy is built.** `order()` (`menu-document.ts:241-249`) puts a held set menu before the
  full menu, as it does an included menu; the set menu's own pass builds its root and frozen offers,
  and the full menu reuses them through `freezeSetMenu`. `buildMenuDocuments` reads the set-menu
  details (`readSetMenu`'s lines, exclusions, variant surcharges, courses, classes and units) for
  every set menu it builds in ONE batched read, never one call per set menu: `menuStatus` builds
  every menu on each live change (`menu-publication.ts:216-227`).
- `BuiltMenu` gains `setMenuProblems: { menuId: string; name: string; problems: SetMenuProblem[] }[]`:
  on a full menu, one entry per held set menu that has problems; on a set menu, `[]` (the editor
  reads its problems from `readSetMenu`). Task 5b shows it in the Preview.
- Refusals, at the point that refuses clashes (`menu-publication.ts:670-671`): publishing a set
  menu itself → `set_menu.wrong_place` `{ menuId }`; a full menu whose `setMenuProblems` is not
  empty → `set_menu.not_publishable`
  `{ menuId: <the first set menu with problems>, count: <its problems> }`. `patchLiveMenu` on a set
  menu → `set_menu.wrong_place` (a full menu's live correction of its copies is Task 5c's).
  Queueing and the Preview are Task 5b's.
- Keep `MENU_DOCUMENT_FORMAT` at 4 (decision 7); a stored format-4 document without `setMenus`
  reads as before.

- [ ] **Step 1: Write the failing tests** in `set-menu-document.test.ts`, built on Task 4's
  fixture (Daily menu €14: Soup included, Sirloin +€5, Wine with Glass +€1.50 and Bottle left out),
  placed in a full menu "Lunch" that sells Sirloin at €18:
  - `"Lunch's document holds a copy of the set menu with surcharges, not à la carte prices"`: in
    `buildMenuDocument(Lunch).document.setMenus[dailyMenu]`, Soup `unitPrice "0.00"`, Sirloin
    `"5.00"`, Wine's variants only Glass at `"1.50"`; Sirloin's `offeredModifiers` equal those of
    Lunch's own Sirloin offer; Lunch's own Sirloin offer stays `"18.00"`.
  - `"the copy carries the terms and what each dish counts as in this set menu"`: `terms` equals
    `{ price: "14.00", vatClass: "reduced", names: { en: "Daily menu" }, lines: [...] }`; Soup's
    `countsAsCourseId` is Starters; Glass's is its own course.
  - `"two set menus' copies give one product different courses"`: Bravas listed in Daily menu
    with no course of its own and in Special menu given Starters, both placed in Lunch → Daily's
    copy has Bravas `countsAsCourseId` Sharing plates and `courseOverrideId` null; Special's has
    Starters and Starters; Lunch's own Bravas offer keeps Sharing plates and no override.
  - `"changing the set menu changes Lunch's working hash, and nothing reaches the live version
    until Lunch is published"`: publish Lunch; change Sirloin to +€6 → Lunch's `workingHash`
    differs from its live hash and the live document still says `"5.00"`; publish Lunch → `"6.00"`.
  - `"a dish moved to another course keeps its counts-as until Lunch is published again"`: publish;
    move Soup to Mains (accepted by a line) → the live copy still says Starters; publish → Mains.
  - `"a dish moved to a course no line accepts stops Lunch's next publish"`: give Soup a course no
    line includes → `buildMenuDocument(Lunch).setMenuProblems` names Daily menu with
    `dish_not_included`, and `publishMenu(Lunch)` refuses `set_menu.not_publishable`
    `{ menuId: dailyMenu, count: 1 }`.
  - `"the copy carries the set menu's change stamp, and it moves only when the set menu changes"`:
    `changedAt` equals Daily menu's `updated_at`; building Lunch twice gives the same working hash;
    a surcharge change moves `changedAt` and the working hash.
  - `"a product's class changed afterwards stops Lunch's next publish"`: Soup's class set to
    `general` on the product → `publishMenu(Lunch)` refuses `set_menu.not_publishable` (decision 11).
  - `"a set menu has no Publish of its own"`: `publishMenu(dailyMenu)` and
    `patchLiveMenu(dailyMenu)` refuse `set_menu.wrong_place`.
  - `"building every menu reads set-menu details once"`: count statements (or spy) while
    `buildMenuDocuments` builds two full menus holding three set menus.
  - `"a set menu placed inside an included menu is copied into the including menu"`: Lunch includes
    "Specials", which holds Daily menu → `setMenus[dailyMenu]` is in Lunch's document.
  - `"an inactive set menu leaves no copy and Lunch still publishes"`.
- [ ] **Step 2: Run; they fail.** `pnpm --filter @waitron/menu exec vitest run src/set-menu-document.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file, then `menu-publication.test.ts` and `menu-document.test.ts` (grep
  for the publication tests if named otherwise).**
- [ ] **Step 5: Commit** — "Set menus: copy a set menu into each full menu when it is published, and refuse one that cannot be covered".

### Task 5b: Queueing, and the set menu in a full menu's Preview

**Files:**
- Modify: `packages/menu/src/menu-schedule.ts` (`queueMenuPublication` `:37-60`, which builds and
  stores the document when queued, so the copy is taken then), `packages/menu/src/menu-publication.ts`
  (`previewMenu`), `packages/menu/src/menu-document.ts` (`diffEntries`),
  `packages/shared/src/menu-document/menu-document-types.ts` (`MenuPreview`, `MenuChangeBody`,
  `MenuChangeSource`), `packages/menu/src/menu-navigation.ts`, `packages/menu/src/menu-undo.ts`,
  `apps/dashboard/src/widgets/menu-preview.ts` and `apps/dashboard/src/i18n/strings.ts`
- Test: `packages/menu/src/set-menu-document.changes.test.ts`,
  `apps/dashboard/src/widgets/menu-preview-tree.test.ts`

**Interfaces:**
- Consumes the copy and `BuiltMenu.setMenuProblems` (Task 5a).
- Queueing refuses as publishing does, at `menu-schedule.ts:48-49`: a set menu itself →
  `set_menu.wrong_place`; a full menu with `setMenuProblems` → `set_menu.not_publishable`.
- `MenuPreview` gains `setMenuProblems` with `BuiltMenu`'s shape; `previewMenu` on a set menu
  refuses `set_menu.wrong_place`.
- `MenuChangeBody` gains
  `{ kind: "set_menu_changed"; setMenu: { id: string; name: string }; fields: ("price" | "vat" | "names" | "lines" | "dishes")[] }`;
  `MenuChangeSource` gains `"set_menu"`.
- `diffEntries` emits one `set_menu_changed` per set menu whose copy differs between the live and
  proposed documents, naming the fields that differ (`"dishes"` covers dishes added, removed,
  re-priced, re-coursed or with variants changed). The change carries `source: "set_menu"`,
  `setMenu: { id, name }`, `alsoOn` naming the other published full menus that hold the set menu,
  and the target `navigateMenuChanges` (`menu-navigation.ts`) gives the set-menu member. It has no
  undo: `menu-undo.ts` treats it as not undoable, and the preview links to the set menu's page
  instead (**my call**: the change is made there). Placing or removing a set menu shows as the
  member change it already is. The dashboard's `widgets/menu-preview.ts` and `strings.ts` word the
  new kind and source in the same change as the shared types. Check the change words, editor
  link and absence of an undo in the Preview test.

- [ ] **Step 1: Write the failing tests** in `set-menu-document.changes.test.ts`, on Task 5a's
  fixture with Lunch published:
  - `"queueing refuses what publishing refuses"`: `queueMenuPublication(dailyMenu)` →
    `set_menu.wrong_place`; with Soup given a course no line includes,
    `queueMenuPublication(Lunch)` → `set_menu.not_publishable` `{ menuId: dailyMenu, count: 1 }`
    and `previewMenu(Lunch).setMenuProblems` names Daily menu with `dish_not_included`.
  - `"a queued version takes its copy when it is queued"`: queue Lunch, then change a surcharge →
    the queued document still has the old surcharge and the old `changedAt`.
  - `"a set menu has no preview"`: `previewMenu(dailyMenu)` refuses `set_menu.wrong_place`.
  - `"a surcharge change shows as set_menu_changed with fields dishes"`: Sirloin +€5 → +€6 →
    `previewMenu(Lunch)` has exactly one `set_menu_changed` naming Daily menu with
    `fields: ["dishes"]`.
  - `"a price change shows as set_menu_changed with fields price"`: €14 → €15.
  - `"the change names the other menus that hold the set menu"`: Daily menu also placed in a
    published "Weekend" menu → `alsoOn` names Weekend.
  - `"the change leads to the set-menu member and cannot be undone"`: `navigateMenuChanges` gives
    the member's target, and the undo read reports it as not undoable.
  - `"placing a set menu shows as a member change only"`: no `set_menu_changed` for a set menu
    newly placed in Lunch.
- [ ] **Step 2: Run; they fail.** `pnpm --filter @waitron/menu exec vitest run src/set-menu-document.changes.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file, `menu-schedule.test.ts`, `menu-document.test.ts`, the navigation and
  undo tests (grep `menu-navigation` and `menu-undo` for them), and `packages/menu`'s suite.**
- [ ] **Step 5: Commit** — "Set menus: queueing refuses an unpublishable set menu, and the Preview lists what changed in set menus".

### Task 5c: Live corrections, and the other readers of a published document

**Files:**
- Modify: `packages/menu/src/menu-patch.ts` (the correction walk, `:160-200`),
  `packages/menu/src/menu-publication.ts` (`patchLiveMenu` `:734`), and the readers named below
- Test: `packages/menu/src/set-menu-document.readers.test.ts`, plus one case each in the
  `routing-store` and `extra-usage` test files (grep their names)

**Interfaces:**
- On a full menu, a live correction applies to the copies' dishes exactly as to the document's
  own offers (wording, VAT class, an extra's or option's correction), except a correction of a
  dish's own price, which changes only the full menu's own offer: in a copy that price is a
  surcharge, changed on the set menu's page (**my call**). Apply the walk `menu-patch.ts:160-200`
  uses for `offers` to `setMenus[*].offers` too. Every copy keeps its `changedAt` unchanged.
- **A correction cannot break decision 11.** A correction may change a dish's `vatClass`
  (`menu-patch.ts:101-103` admits `vatClass` and `takeawayVatClass`). After applying it,
  `patchLiveMenu` refuses `set_menu.vat_class_differs`
  `{ productId, productVatClass, setMenuVatClass }` when any copy's dish or kept variant would then
  carry a `vatClass` other than its copy's `terms.vatClass`, and writes nothing (**my call (plan
  writer)**: refusing keeps one rule everywhere, where leaving VAT out of copy corrections would
  leave a copy's surcharge taxed at a class the product no longer has). A `takeawayVatClass`
  correction is applied to copies freely: set menus are eat-in only.
- **Other readers of a published document's offers** do not see the copies unless changed. Decide
  each and record it in the commit message: `documentProductIds`/`assertOffPublishedMenus`
  (`archive.ts:77`) and `documentImages` (`menu-document.ts:472`) read the copies;
  `routing-store.ts:742-768` (which extras a dish offers per zone) and `extra-usage.ts:32-45`
  (where an extras list is in use) read them through Task 5a's `documentSetMenuOffers`, never
  through `documentOffers`; `productsOfferedIn` and `guest-menu.ts` skip them (a set menu is not
  shown to guests in this piece); `party-allergy.ts:121` and `till-api.ts:1614,1648`, which read
  `listZoneOffers`' `offers`, are left to piece 2, which orders set-menu dishes.

- [ ] **Step 1: Write the failing tests:**
  - `"a live price correction of Lunch's Sirloin leaves the copy's surcharge alone, and a live
    wording correction reaches the copy and keeps its changedAt"`.
  - `"a live VAT correction that would put a copy's dish at another class is refused"`: Daily menu
    at `reduced` in Lunch; a correction setting Soup's `vatClass` to `general` →
    `set_menu.vat_class_differs` and Lunch's live version is unchanged. Control: the same
    correction of a dish only Lunch's own offers hold is applied, and a `takeawayVatClass`
    correction of Soup is applied to the copy.
  - `"a published copy protects its dishes from being archived"`: `assertOffPublishedMenus`
    refuses archiving a dish only the set menu lists while Lunch is live.
  - `"the copy's dish images are kept"`: `documentImages` of Lunch's document lists the image of a
    dish only the set menu lists.
  - In the routing-store test: a dish only the set menu lists offers its extras in the zone; in
    the extra-usage test: an extras list used only by a set-menu dish is reported in use.
- [ ] **Step 2: Run; they fail.** `pnpm --filter @waitron/menu exec vitest run src/set-menu-document.readers.test.ts`
  and the two other files under their packages.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the files, `menu-patch.test.ts` (grep if named otherwise) and `packages/menu`'s suite.**
- [ ] **Step 5: Commit** — "Set menus: live corrections and the document's other readers see a full menu's set menus".

### Task 6a: Serving the copies with the zone's offers

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`ServiceZoneOffers` `:827`, `listZoneOffers`
  `:835-896`, `menuState` `:934-987`), `packages/menu/src/menu-document.ts` (`readLiveState`
  `:624`, `applyLiveFields` `:663`, a new `setMenuCopyHash` beside `menuDocumentHash` `:468`)
- Modify: `packages/shared/src/menu-document/menu-document-types.ts` (`ServedSetMenuCopy`,
  `ServedSetMenu`)
- Modify: `apps/till/src/api/client.ts` (`ZoneOffers`, `:446-461`: add the field, read nothing yet)
- Test: `packages/venue-service/src/zone-offers.set-menus.test.ts`

**Interfaces:**
- Consumes `documentSetMenuOffers`, `PublishedSetMenu` and `SetMenuFrozenOffer` (Task 5a).
- Produces:

```ts
export type ServedSetMenuOffer = LiveOffer & {
  /** What the dish counts as when placed in this set menu (decision 4). Piece 2 hands it to the
   * calculation as `SetMenuOfferDish.countsAsCourseId`. */
  countsAsCourseId: string | null;
  /** Each kept variant's counts-as course in this set menu, by variant id. */
  variantCountsAs: Record<string, string>;
};
/** One set menu's copy, with live fields applied. */
export interface ServedSetMenuCopy {
  /** `${menuId}:${setMenuCopyHash(copy)}`, so the same copy has the same key whichever versions
   * hold it. Piece 2 uses it as the calculation's `SetMenuOffer.id`. */
  key: string;
  menuId: string;
  name: string;
  terms: SetMenuTerms;
  /** The copy's root members, for drawing its folder. */
  structure: DocumentList;
  offers: ServedSetMenuOffer[];
}
export interface ServedSetMenu extends ServedSetMenuCopy {
  /** The live versions of the served full menus holding this same copy, by code units. */
  versionIds: string[];
  /** True when a full menu holding this copy is orderable in the zone now. */
  orderable: boolean;
}
```

  and `ServiceZoneOffers.setMenus: readonly ServedSetMenu[]`: the `setMenus` copies of the zone's
  served documents, each offer passed through `applyLiveFields` like any offer, so `available` and
  the served `courseId` (which decides sending) are live while `countsAsCourseId` stays as copied.
- **The set menu's own course for a dish, while it exists** (decision 9, Fable's F7). An offer
  whose copy has a `courseOverrideId` naming an active course is served with that as its
  `courseId`, and so is each of its variants. One whose override names a course that has since
  been deleted is served with its product's live course: the server refuses a new line naming a
  course that is not active (`requireLiveCourse`, `apps/server/src/kitchen.ts:262-270`, called at
  `apps/server/src/order-drafts.ts:1077` and `apps/server/src/working-order.ts:975`), so serving
  the deleted course would refuse the dish on every tap until the full menu is published again.
  Read the override courses' `kitchen_courses.active` in the same batched read as the live rows,
  treating a course with no row as inactive (a course nothing else refers to is deleted outright,
  `apps/server/src/course-delete.ts:78-82`), and put each override's id and active flag into the
  live-fields digest, so deleting it changes
  the fingerprint and open tills reload: deleting a course clears `products.course_id`
  (`apps/server/src/course-delete.ts:75`) but no product row changes when only an override named
  it. `countsAsCourseId` is never changed by this: it is compared as a plain value with the copy's
  own lines.
- **The key hashes the frozen copy** (Fable's M7). `menuDocumentHash` takes a whole `MenuDocument`
  (`menu-document.ts:468`); add `setMenuCopyHash(copy: PublishedSetMenu): string`, the same SHA-256
  of `canonicalJson` (`:457`) over the copy as published, before live fields are applied, so the
  key does not change when a dish sells out.
- Copies that are equal (same `setMenuCopyHash`) are served once, with every version that holds
  them in `versionIds`; different copies of one set menu, from two served full menus published at
  different times, are served one each (**my call**: each is what its full menu was published
  with; which one a new bill takes is decision 10, Task 6b). `listZoneOffers` serves the live
  documents of every period's menus and marks each `orderable` (`:835-896`), so at lunch Dinner's
  copy is served too, with `orderable: false` unless an orderable menu holds the same copy.
- **One fingerprint for both reads.** The till reloads when `menuState`'s fingerprint differs from
  the offers read's (`apps/till/src/till-app.ts:6847,6873` at `b31ec62e37`). `readLiveState` and `applyLiveFields`
  take whole documents and read offers through `documentOffers`, keyed by `document.menuId`.
  Leave `documentOffers` as it is: its other callers (`productsOfferedIn` and the empty-menu check,
  `operations.ts:347,923`; `routing-store.ts:764`; `shapeOf`'s diff, `menu-document.ts:816`) must
  not see set-menu dishes, or a surcharge would stand in for the full menu's price. Add an option
  on `readLiveState` and `applyLiveFields` only, under which both also read those offers, keyed by
  menu-item id. Both reads then fold the copies' dishes into the same fingerprint. Never wrap a copy
  as a document of its own: two copies of one set menu would overwrite each other. A dish only a
  set menu lists then changes the state when it sells out. A changed copy reaches the till as a new
  full-menu version, which the state already carries.
- When `listZoneOffers` is called with `menuItemIds` (every draft and line write does,
  `order-drafts.ts:1434`, `working-order.ts:558,570`), it serves no copies and answers
  `setMenus: []`; piece 2 reads a bill's copies through Task 6b's `serveRecordedSetMenus`.
- The copies' offers stay out of `offers`, so the server's re-pricing by menu-item id
  (`offersFor`, `apps/server/src/order-drafts.ts:1429-1442`) refuses a set-menu dish until piece 2.

- [ ] **Step 1: Write the failing tests:**
  - `"a zone selling Lunch serves its copy of Daily menu"`: `setMenus` has one entry with
    `versionIds` `[Lunch's live version]`, `key` `${dailyMenu}:${setMenuCopyHash(copy)}`,
    `orderable: true`, `terms.price "14.00"`, Soup's offer at `"0.00"` counting as Starters;
    `offers` holds no set-menu menu-item id.
  - `"a copy held only by a menu not selling now is served as not orderable"`.
  - `"the menu state's fingerprint equals the offers read's while a copy is served"`, and both
    change when a dish only the set menu lists sells out.
  - `"productsOfferedIn and the full menu's diff never see a set-menu dish"`: a dish only the set
    menu lists is not offered by the zone's ordinary products, and Lunch's diff keeps Sirloin at
    `"18.00"`.
  - `"a set menu changed but not yet published in Lunch is served as it was"`: change €14 → €15 →
    still `"14.00"`; publish Lunch → `"15.00"` with Lunch's new version in `versionIds`.
  - `"one copy held by two served menus is served once with both versions, and two different
    copies twice"`.
  - `"a sold-out dish is unavailable in the copy, and the key does not change"`.
  - `"a dish moved to another course after publishing is served with its new course and counts as
    its old one"`.
  - `"a dish the set menu gives Starters is served with Starters, and its product's course change
    does not move it"`.
  - `"a dish whose set-menu course was deleted is served with its product's course"`: Special's
    Bravas given Starters, Lunch published, then Starters deleted (`deleteCourse`) → Bravas served
    with Sharing plates, `countsAsCourseId` still the deleted course's id, and both fingerprints
    differ from before the deletion. Control: with the course kept, Bravas is served with Starters.
  - `"a read for named menu items serves no copies"`: with `menuItemIds` given, `setMenus` is `[]`.
- [ ] **Step 2: Run; they fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/zone-offers.set-menus.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file, `packages/venue-service`'s suite, and `apps/server`'s till offers
  route tests (grep `default-service-zone/offers` under `apps/server/src/*.test.ts`).**
- [ ] **Step 5: Commit** — "Set menus: serve each full menu's set-menu copies with the zone's offers".

### Task 6b: One copy per set menu on a bill — the newest on sale, and reading a recorded copy

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`listZoneOffers`)
- Create: `packages/venue-service/src/set-menu-copies.ts`
- Modify: `packages/shared/src/menu-document/menu-document-types.ts` (`ServedSetMenu`)
- Test: `packages/venue-service/src/zone-offers.set-menus.test.ts` (more cases),
  `packages/venue-service/src/set-menu-copies.test.ts`

**Interfaces:**
- Consumes `ServedSetMenuCopy`, `ServedSetMenu`, `documentSetMenuOffers` and the live-field option
  (Task 6a).
- `ServedSetMenu` gains `newestOnSale: boolean`: true for exactly one copy of each set menu among
  those with `orderable: true`, the one with the latest `changedAt` (Task 5a), ties going to the
  smaller `key` in code units; false for every other copy, and for every copy of a set menu nothing orderable
  holds (decision 10). `ServedSetMenuCopy` carries `changedAt` so piece 2 and the tests can see
  it. Piece 2 takes this copy when a set menu is first added to
  a bill, records its `key` and one of its `versionIds`, and refuses to add a set menu that has no
  such copy.
- Produces, in `set-menu-copies.ts`:
  `serveRecordedSetMenus(tx: Transaction, copies: readonly { versionId: string; menuId: string }[]): Promise<ServedSetMenuCopy[]>`,
  in the order given: each named version's `setMenus[menuId]`, read through `readRecordedDocuments`
  (`packages/menu/src/menu-publication.ts:325`, which also reads versions that are no longer live)
  and served with exactly Task 6a's live fields, set-menu course rule and key. A version that does
  not hold that set menu throws `set_menu.not_found` `{ menuId }`. `listZoneOffers` builds its
  `setMenus` through the same function's inner step, so the zone read and a bill's recorded copies
  can never be served differently (Fable's F7 note on the server's second path, and its
  "Duplication" note on reading copies).

- [ ] **Step 1: Write the failing tests:**
  - in `zone-offers.set-menus.test.ts`: `"two orderable menus holding different copies mark only
    the copy taken last as newestOnSale"`: Daily menu in Lunch and in Brunch, both orderable; publish
    Lunch, raise Daily to €15, publish Brunch → Brunch's copy (`"15.00"`) is `newestOnSale`,
    Lunch's (`"14.00"`) is not. Then publish Lunch again → one copy, held by both versions,
    `newestOnSale`.
  - `"a live correction of Lunch does not make its older copy newest"`: as above up to Brunch's
    publish, then a wording correction on Lunch (`patchLiveMenu`) → Brunch's `"15.00"` copy is
    still `newestOnSale`, and Lunch's copy keeps its `changedAt`.
  - `"setting the price back makes that copy newest"`: after Brunch's publish, set Daily back to
    €14 and publish Lunch → Lunch's new `"14.00"` copy is `newestOnSale`.
  - `"copies with the same stamp are ranked by key"`: two orderable copies of Daily menu that
    differ only by a product's name changed on its own page between the two publishes (so their
    `changedAt` is equal) → the one whose `key` sorts first in code units is `newestOnSale`, and
    the other is not.
  - `"a copy held only by a menu not selling now is never newestOnSale"`: at dinner, with Daily menu
    held only by Lunch, its copy is `orderable: false` and `newestOnSale: false`.
  - in `set-menu-copies.test.ts`: `"a recorded copy is served after its full menu is published
    again"`: publish Lunch (version v1), change Daily to €15 and publish (v2) →
    `serveRecordedSetMenus([{ versionId: v1, menuId: dailyMenu }])` serves `"14.00"` with the same
    `key` the zone read served for v1's copy.
  - `"a recorded copy takes live availability and the set menu's course for a dish"`: a sold-out
    dish is unavailable; Bravas given Starters is served with Starters, and with its product's
    course once Starters is deleted.
  - `"a version that does not hold the set menu is refused"`: `set_menu.not_found`.
- [ ] **Step 2: Run; they fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/zone-offers.set-menus.test.ts src/set-menu-copies.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the files, `packages/venue-service`'s suite and `packages/menu`'s
  `menu-publication` tests.**
- [ ] **Step 5: Commit** — "Set menus: mark the copy a new bill takes, and serve a bill's recorded copy".

### Task 7: Server routes and the dashboard's API client

**Files:**
- Modify: `apps/server/src/menu-api.ts` (menu routes `:962-1280`, status map `:320-380`)
- Modify: `apps/dashboard/src/api/client.ts` (menu calls `:3249-3541`), `apps/dashboard/src/i18n/codes.ts`,
  `apps/dashboard/src/api/live-queries.ts`, `packages/menu/src/menu-publication.ts` (`menuStatus`)
- Test: `apps/server/src/menu-api.set-menus.test.ts`, `apps/dashboard/src/api/client.test.ts` (if
  menu calls are tested there; otherwise in the screen tests of Task 8a)

**Interfaces:**
- `POST /management-api/menus` accepts `kind`, `setPrice`, `setVatClass`; `PATCH .../menus/:id`
  accepts `setPrice`, `setVatClass`.
- `GET /management-api/menus/:id/set-menu` → `SetMenuDetails`.
- `PUT /management-api/menus/:id/set-menu/lines` body `{ lines: { count, courseIds }[] }` →
  `{ lines: SetMenuLine[] }`.
- `PUT /management-api/menus/:id/set-menu/items/:itemId/course` body `{ courseId: string | null }`
  → `{ details: SetMenuDetails; addedLines: SetMenuLine[]; removedLines: SetMenuLine[] }`.
- `PUT /management-api/menus/:id/set-menu/items/:itemId/variants` body
  `{ variants: { variantId, included, surcharge }[] }` → `SetMenuDetails`.
- `POST /management-api/menus/:id/set-menu/dishes` body
  `{ dishes: { productId, excludedVariantIds }[] }` → `{ details: SetMenuDetails; addedLines: SetMenuLine[] }`.
- `POST /management-api/menus/:id/set-menu/copy-dishes` body `{ fromMenuId }` →
  `{ details: SetMenuDetails; addedLines: SetMenuLine[] }`.
- Removing a dish and setting a surcharge use the existing section-member and
  `PATCH .../items/:itemId` routes; the existing add-products member route still works on a set
  menu's list (all variants included) and answers `addedLines` too. Placing a set menu uses the existing
  `POST /management-api/sections/:id/members` with the `set_menu` ref. Extend the existing
  `memberRef` parser with a validated `menuId`. Test member add and replace and the refusal
  from both Home shortcut routes that share the parser.
- **Dashboard refresh.** Add `set_menu_lines`, `set_menu_line_courses`, `set_menu_dish_courses`
  and `set_menu_variant_exclusions` to `MENU_PUBLICATION_READS` (`apps/dashboard/src/api/live-queries.ts:4-22`),
  so a change to a set menu refreshes the status and Preview of the full menus holding it; no guard
  catches a missing table here. `menuStatus` (`menu-publication.ts:216-227`) leaves set menus out,
  and the menus list shows no publication status for one (Task 8a).
- Status: `set_menu.not_found` 404; `set_menu.invalid`, `set_menu.dishes_only` 400 (or whatever
  status the map gives the nearest `menu_section.*` code); `set_menu.wrong_place`,
  `set_menu.not_publishable`, `set_menu.vat_class_differs`, `set_menu.dish_sold_by_measure` 409.
- Client methods: `createMenu` (extended), `readSetMenu(menuId)`, `addSetMenuDishes(menuId, dishes)`,
  `saveSetMenuLines(menuId, lines)`, `saveSetMenuDishCourse(menuId, itemId, courseId)` (Fable's
  M7: Task 9 calls it),
  `saveSetMenuVariantChoices(menuId, itemId, variants)`, `copySetMenuDishes(menuId, fromMenuId)`,
  `placeSetMenu(sectionId, menuId)`.

- [ ] **Step 1: Write the failing route tests**, one per route: the answer's shape on success, and
  one refusal each with its status and code (the dishes route's is `409 set_menu.vat_class_differs`
  for a product at another class); plus `"publishing a full menu holding a set menu with a
  problem answers 409 set_menu.not_publishable"` and `"publishing a set menu itself answers 409
  set_menu.wrong_place"`, `"a change to a set menu's lines marks the full menu holding it as
  changed in menu status"`, and `"menu status lists no set menu"`. In the dashboard, one live-query
  test that a set-menu line change refreshes the full menu's Preview.
  Every route here carries the dashboard's cookie, so keep it behind
  `requireManagementChangeFromOwnPage` like its neighbours (CLAUDE.md §3); the sweep in
  `apps/server/src/boot.management-origin.test.ts` must still pass.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement the routes, the status entries, the client methods, and the English and
  Spanish wording in `codes.ts` for the codes below.** Task 8b words the class-change refusal. Task 9 words the two refusals
  when adding dishes (`set_menu.vat_class_differs` and `set_menu.dish_sold_by_measure`). Wording, **my call**, each saying what to do:
  - `set_menu.wrong_place`: "A set menu is sold by placing it in a menu. Open that menu's
    Structure and add the set menu there." / «Un menú a precio fijo se vende colocándolo dentro de
    un menú. Abre la Estructura de ese menú y añádelo allí.»
  - `set_menu.dishes_only`: "A set menu lists dishes only. Add products to it; to group them, set
    each product's course." / «Un menú a precio fijo solo lista platos. Añade productos; para
    agruparlos, asigna un curso a cada producto.» (the dashboard's Spanish for "course" is
    «curso», `strings.ts:5847`)
  - `set_menu.not_publishable`: "This menu can't be published yet: its set menu {name} has
    {count} problems, listed on the set menu's page. Fix them, then publish this menu." /
    «Este menú aún no se puede publicar: su menú a precio fijo {name} tiene {count} problemas,
    indicados en su página. Corrígelos y publica este menú.» (`{name}` looked up from `menuId`)
  - `set_menu.invalid` by field, and `set_menu.not_found`, in the style of the neighbouring
    `menu_section.*` entries. For `setPrice` and `surcharge` the words name the limit: "A set
    menu's price (or a surcharge) can be from 0.00 to 10,000.00." / «El precio de un menú (o un
    suplemento) puede ir de 0,00 a 10.000,00.» (**my call (plan writer)**, decision 13).
  Use the dashboard's existing Spanish words for "course" and "set menu" if `strings.ts` already
  has them (grep `course` and `menú`); the Spanish above is a starting point, not a fixed text.
- [ ] **Step 4: Run the route file, `apps/server/src/menu-api.test.ts` and the management-origin sweep.**
- [ ] **Step 5: Commit** — "Set menus: management routes and the dashboard's client".

### Task 8a: Dashboard — adding a set menu, the list, and the editor's shell

**Files:**
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (`TABS` `:92`, list columns,
  `#renderEditor` `:3910-3965`)
- Create: `apps/dashboard/src/widgets/set-menu-editor.ts` (the one page: Task 8b draws its terms,
  Task 9 its dishes, Task 10 its lines)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/menus-screen.set-menu.test.ts`, `set-menu-editor.a11y.test.ts`

**Interfaces:**
- Land the list and editor with Task 8b. Task 11 connects Add menu to the finished editor.
- The menus list shows a **Kind** column ("Menu" / "Set menu") and, for a set menu, its price and
  no publication status.
- A set menu's editor has one tab, **Set menu** (`set-menu`, drawing `dashboard-set-menu-editor`),
  and no Publish (decision 3). Structure, Prices, Home page and Preview are not shown; a stored
  address naming one of those for a set menu opens **Set menu**. Under its heading the editor says
  where its changes go: "Changes reach the tills when you publish a menu that holds this set menu:
  Lunch, Dinner", each name linking to that menu's Preview, or "Place it in a menu to sell it" when
  no menu holds it (from `SetMenuDetails.heldBy`; **my call** on wording).

- [ ] **Step 1: Write the failing tests** in `menus-screen.set-menu.test.ts`:
  `"the list shows a set menu's kind and price"`;
  `"a set menu's editor has no Structure, Prices, Home page or Preview tab, and an old address for
  one opens Set menu"`; `"a set menu's editor names the menus that publish it, linking to each"`;
  `"a full menu's Preview lists its set menus' problems and links to their editors"`. Run axe
  on the editor shell in both themes.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.**
- [ ] **Step 4: Run the new tests and `menus-screen.test.ts`, `menus-screen.a11y.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: offer a set menu on the menus list and give it its own editor".

### Task 8b: Dashboard — a set menu's name, price and VAT class

**Files:**
- Create: `apps/dashboard/src/widgets/set-menu-terms-form.ts`
- Modify: `apps/dashboard/src/widgets/set-menu-editor.ts`, `apps/dashboard/src/i18n/strings.ts`,
  `apps/dashboard/src/i18n/domain.ts` and `apps/dashboard/src/screens/venue-defaults-panel.ts`
- Test: `apps/dashboard/src/widgets/set-menu-terms-form.{test,a11y.test,unsaved.test}.ts`

**Interfaces:**
- The form: **Name** (required), customer names by language as the section form takes them (reuse
  `dashboard-section-details-form`'s name fields if it can be composed, rather than copying them),
  **Price per set menu** (required, `wt-price-input`, gross), **VAT class** (required; the same
  field and default the product editor gives a new product — read
  `product-editor.vat-default.test.ts` for how the default is chosen). It creates from the Task 11
  dialog or saves at the top of the editor and emits `set-menu-terms-saved`. Saves quiet until
  the draft changes. Use the refusal's `field` and `requestedVatClass` for the class change, and
  find the dish or variant in the loaded details. For example, "This set menu holds Soup at
  Reduced (10%), so its class can't change to General (21%). Remove those dishes first, or keep
  Reduced." Move the shared `vatClassLabel` to `i18n/domain.ts` here and use it in Task 9 too.

- [ ] **Step 1: Write the failing form tests:** required marks; `"a negative or blank price shows its error
  under the field and disables Save"`; `"Save stays quiet until something changes"`; a refused save
  puts `set_menu.invalid` `{ field: "setPrice" }` under the price field; a refused class change
  puts the class-change wording for `set_menu.vat_class_differs` under the VAT class field. The a11y file: axe in both
  themes for the empty, filled and refused states. The unsaved file: leaving with a changed price
  asks, as the other `*.unsaved` tests do.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them.**
- [ ] **Step 5: Look at it.** Open a fixture draft and check the list and editor in both themes and
  at phone width. Task 11 checks creation through Add menu on the dev stack.
- [ ] **Step 6: Commit** — "Set menus: create a set menu and change its price on the dashboard".

### Task 9: Dashboard — the dishes it covers

**Files:**
- Create: `apps/dashboard/src/widgets/set-menu-dishes.ts`, `apps/dashboard/src/widgets/set-menu-copy-dishes.ts`
- Modify: `apps/dashboard/src/widgets/set-menu-editor.ts`, `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/widgets/set-menu-dishes.{test,a11y.test,unsaved.test}.ts`,
  `set-menu-copy-dishes.{test,a11y.test}.ts`

**Interfaces:**
- Consumes `readSetMenu`, `addSetMenuDishes`, the existing product picker of
  `widgets/section-add-products.ts` (reused for choosing products, not for saving), member removal,
  `PATCH .../items/:itemId`, `saveSetMenuVariantChoices`, `copySetMenuDishes`.
- **Add products** picks products as the existing dialog does, then, for each picked product with
  variants, shows its Active variants, all ticked, so the person can untick any before saving
  (spec section 1, owner: "add or exclude variants"). One save calls `addSetMenuDishes`.
- After adding, copying or changing a dish's course, any `addedLines` show once as a note above
  the lines: "Added a line: 1 × Coffee" (decision 5), and any `removedLines` as "Removed a line:
  1 × Sharing plates" (decision 14).
- **The two dish refusals** (decisions 11 and 12) show in the dialog that caused them (Add
  products, Copy dishes, Variants…), naming the product, and the dialog stays open with nothing
  saved. Their wording in `codes.ts`, **my call (plan writer)** (the owner's example in the spec,
  section 1: "This product is taxed at 21%, the set menu at 10%"), with each class through
  `vatClassLabel` in `i18n/domain.ts` (moved in Task 8b):
  - `set_menu.vat_class_differs`: "{product} is taxed at {productClass}, and this set menu at
    {setMenuClass}. Until the tax treatment of a set menu with dishes at another rate is confirmed,
    a set menu can only hold products at its own rate. Leave {product} out, or correct its VAT
    class on the product if it is wrong." / «{product} lleva el IVA {productClass} y este menú,
    {setMenuClass}. Hasta que se confirme cómo tributa un menú con platos a otro tipo, un menú solo
    puede incluir productos a su mismo tipo. Deja fuera {product} o corrige su tipo de IVA en el
    producto si es erróneo.»
  - `set_menu.dish_sold_by_measure`: "{product} is sold by weight or measure, and a set menu
    covers one portion of each dish. Sell it à la carte, or sell it by the portion on the
    product." / «{product} se vende al peso o por medida, y un menú cubre una ración de cada plato.
    Véndelo a la carta, o por ración en el producto.»
  `{product}` is the picked product's name, looked up from `productId`.
- One `wt-data-table` per course, in course order, headed by the course name, then **No course**
  last with "Choose a course for it here, or give it one on the product" and a link to each
  product's editor. A dish sits under the course it has in this set menu.
  Columns: dish, **Course** (a select from the field primitives listing the active courses, its
  first choice "{product's course} (from the product)", or "No course (from the product)"; saved
  on change through `saveSetMenuDishCourse`, decision 9), **Surcharge** (a `wt-price-input`, blank shown as "Included"), and an `actions`
  column pinned `"end"` with **Variants…** (only for a dish with variants) and **Remove**. A variant
  with a course other than its dish's shows that course beside its name in the variants dialog.
- **Variants…** opens a dialog listing every Active variant with an **Included** switch and its own
  surcharge field (blank: the dish's), saved together.
- **Add products** and **Copy dishes from another set menu** sit above the tables. Copy lists the
  other set menus; after copying, the page shows the answered details.
- A surcharge saves when the field is committed (blur or Enter), as the Prices tab's inline prices
  do (`widgets/menu-prices-table.ts`); follow that table's save and error pattern exactly.

- [ ] **Step 1: Write the failing tests:** `"adding Wine lets Bottle be unticked before saving"`;
  `"adding a coffee dish shows Added a line: 1 × Coffee"`; `"dishes are grouped by course in
  course order, with No course last"`; `"a blank surcharge reads Included and an amount saves on commit"`;
  `"a refused surcharge shows its error on that row"`; `"Variants… leaves a variant out and gives
  another its own surcharge"`; `"a dish with no course links to its product"`; `"choosing Starters for Bravas moves it under
  Starters and saves, and choosing its product's course again moves it back"`; `"a course that no
  line accepts shows Added a line"`; `"copying dishes from
  another set menu adds them and keeps this one's surcharges"`; `"adding Sirloin at General to a
  Reduced set menu says why, naming both classes, and adds nothing"`; `"a product sold by weight is
  refused with what to do"`; `"giving Bravas Starters removes the Sharing plates line and says
  Removed a line"`; a11y for each table state and the
  two dialogs in both themes; unsaved for the variants dialog.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them.**
- [ ] **Step 5: Look at it** on Claude's stack, both themes and phone width.
- [ ] **Step 6: Commit** — "Set menus: choose a set menu's dishes, surcharges and variants".

### Task 10: Dashboard — what one set menu includes, and the problems list

**Files:**
- Create: `apps/dashboard/src/widgets/set-menu-lines-form.ts`
- Modify: `apps/dashboard/src/widgets/set-menu-editor.ts`, `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/widgets/set-menu-lines-form.{test,a11y.test,unsaved.test}.ts`,
  `set-menu-editor.test.ts`

**Interfaces:**
- Consumes `saveSetMenuLines`, `SetMenuDetails.lines/courses/problems`.
- Each line reads "[N] × [course] or [course] …": a `wt-*` number field for N (1–99), the line's
  courses as removable chips, and an **or…** control offering the courses not yet on the line; a
  **Remove line** action; **Add a line** at the end. Lines save together with one Save, quiet until
  the draft changes. Errors follow the refusal's `field`.
- Under the lines, the editor lists `problems` in plain words ("Bottle (Wine) counts as Desserts,
  which no line includes. Add Desserts to a line, or leave Bottle out."), each with the control
  that fixes it where there is one (a link to the product). Task 9 adds and tests the Variants
  control. The two kinds a
  product's own page can cause (Task 4b): "Sirloin is now taxed at General (21%), and this set menu
  at Reduced (10%). Leave it out, or correct its VAT class on the product." and "Turbot is now sold
  by weight. Leave it out, or sell it by the portion on the product.", each linking to the product
  (**my call (plan writer)**).

- [ ] **Step 1: Write the failing tests:** `"lines show as N × courses joined by or"`;
  `"joining a course onto a line and saving sends both courses"`; `"a count outside 1–99 shows
  its error and disables Save"`; `"each problem is listed with what to do"` (one per kind);
  `"saving lines that fix a problem removes it from the list"`; a11y and unsaved.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them.**
- [ ] **Step 5: Look at it** on Claude's stack.
- [ ] **Step 6: Commit** — "Set menus: say what one set menu includes, and list what stops it publishing".

### Task 11: Dashboard — placing a set menu, keeping it out of the wrong pickers, and the guide

**Files:**
- Modify: `apps/dashboard/src/widgets/menu-structure-table.ts` (`StructureAddAction` `:119-123`,
  member rows), `apps/dashboard/src/screens/menus-screen.ts` (Add menu and Structure) and
  `apps/dashboard/src/help-guide.ts`
- Modify: `apps/server/src/guide/en/products.md`, `apps/server/src/guide/es/products.md`
- Test: `apps/dashboard/src/widgets/menu-structure-table.set-menu.test.ts` and
  `apps/dashboard/src/screens/menus-screen.set-menu.test.ts`

**Interfaces:**
- The Structure tab's **Add** gains **Set menu…** (`"add-set-menu"`), listing
  `placeableSetMenus`; choosing one places it in the list being viewed. A placed set menu's row
  shows its name, "Set menu" and its price, opens the set menu's editor when clicked, and offers
  Move and Remove like an include. It has no folder settings in this piece.
- **Add menu** offers **Menu** or **Set menu** using the existing `wt-*` controls. Menu opens
  today's form. Set menu opens the terms form in a dialog and opens the new draft's editor.
- The editor heading's `wt-help-tooltip` uses `mode="help-mode"`. Explain the price, surcharges
  and placing the set menu. Link to `{#set-menus}` through the dashboard's guide links.
- The include and period choices already omit set menus through the reads in Tasks 3a and 2.
  The default-menu write refuses one through Task 2.
- Guide: a `## Set menus {#set-menus}` section in both languages, written from the code as built:
  what a set menu is, creating one, its dishes and surcharges, giving a dish another course in
  the set menu (on a bill it counts as that course in this set menu, and a dish ordered from this
  set menu's folder is sent with it), variants, that a set menu holds only products at its own VAT
  rate and none sold by weight, what one set menu includes, placing it in a menu, and that its
  changes reach the tills only when a menu that holds it is published. Remove any "set lunch" wording A1515-REMOVE left behind in these two files.
  Short; a sentence earns its place by changing what staff do (CLAUDE.md §3).

- [ ] **Step 1: Write the failing tests:** `"Add offers Set menu and places the chosen one"`;
  `"a placed set menu's row shows its price and opens its editor"`; `"the include picker leaves set
  menus out"`; `"Add menu offers Menu and Set menu"`; `"creating a set menu opens its editor on the Set menu
  tab"`; `"the editor's help bubble shows only in help mode and links to the guide"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them, and
  `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.**
- [ ] **Step 5: Look at it end to end** on Claude's stack: create Daily menu (€14) with Soup, Hake
  and Sirloin (+€5), place it in the full menu, publish the full menu, then read
  `GET /api/default-service-zone/offers` on the till's port and check `setMenus[0]` has
  `terms.price "14.00"`, `newestOnSale: true` and Sirloin at `"5.00"`; change Sirloin to +€6 and check the read still
  says `"5.00"` until the full menu is published again. Record the request and the fields in the PR.
- [ ] **Step 6: Update `docs/backlog/menu.md`'s A1515 entry** to say piece 1 has landed and what is
  next, in the same commit.
- [ ] **Step 7: Commit** — "Set menus: place a set menu in a menu, and the set-up guide".

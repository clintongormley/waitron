# Set menus, piece 1: the set-menu kind, its editor, placing and publishing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager can create a set menu on the dashboard, give it a price, its dishes with
surcharges, and what one set menu includes, place it in a full menu, and publish it; the till's
offers read then carries each placed set menu's live version, for piece 2 to draw.

**Architecture:** A set menu is a `menus` row with `kind = 'set_menu'`, a price and an eat-in VAT
class. Its dishes are the products in its root list, so `menu_items` and the whole offer pipeline
(`listMenuOffers` → `freezeOffer`) build each dish's full offer, options, extras and variants
included, unchanged. On a set menu, `menu_items.gross_price` holds the dish's surcharge (null:
included). What one set menu includes is two new tables of lines and their courses; the variants it
leaves out are a third. Placing a set menu in a full menu stores a `section_members` row pointing at
its root, exactly as an include does, but the section graph reports that member as
`{ kind: "set_menu" }`, so nothing that walks included menus (offer sync, price combining, clashes,
the document's tree) treats it as one. A set menu publishes into `menu_versions` as a format-4
`MenuDocument` with an added `setMenu` block; the full menu's document holds only a
`{ kind: "set_menu", menuId }` member, and the zone offers read serves each such set menu's own live
version beside the full menu.

**Tech Stack:** TypeScript 7, drizzle (core migration set, `migration-baseline rebuild`), Hono routes
in `apps/server`, Lit screens in `apps/dashboard`, Vitest 4 (browser mode for the dashboard).

**Spec:** [docs/superpowers/specs/2026-11-17-set-menus-design.md](../specs/2026-11-17-set-menus-design.md),
section 1 "Setting up a set menu" and the first piece of "The pieces, for planning". Read section 1,
section 6 (courses) and "Left to the builder" before Task 1. A code map of the area, read at
`18fe6c2661`, is in the owner's checkout at `docs/handoffs/2026-11-17-set-menus-code-map.md`
(gitignored); line numbers below are from `ed2ac2ea00`.

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
departed from the spec; decision 4 now follows the spec instead.

## Decisions this plan makes (the builder's, for the plan review and the owner)

The spec leaves table names, where the price and VAT live, and error codes to the builder. These go
further than that and are marked **my call** where they first appear in a task:

1. **Price, VAT class and names live on the menu, not on a hidden product.** Order and sale lines do
   not need a product (`working_order_lines.product_id` and `sale_lines.product_id` are nullable,
   `packages/db/src/schema/orders.ts:179`, `sales.ts:217`) and snapshot names, VAT class and
   classification by value. A hidden product would appear in every product list, picker, archive
   check and report that reads `products`. Customer-facing names in each language are the set
   menu's root section `names`, as for any menu. Category for reports is left to piece 4.
2. **A set menu's dishes are its root list's products, and `menu_items.gross_price` is the
   surcharge.** This changes what a blank price means for set-menu rows only. Task 4 traces every
   reader of that column; the Prices tab and its route refuse a set menu.
3. **The till gets the set menu's live version when the full menu is served, not a copy taken when
   the full menu was published.** The spec says the full menu "shows the set menu's live version,
   as it does for an included menu"; the second half is not how included menus work: an included
   menu is copied from its working structure when the full menu is published
   (`packages/menu/src/menu-document.ts:258-292`, tracked by `includedMenuHashes`). This plan
   follows the first half. Publishing a set menu then reaches every full menu holding it without
   republishing them (the trap the owner hit on the demo stack on 17 November), and the bill can
   record each set menu's own version (spec section 3). For the till to notice, the zone's menu
   state (`menuState`, `packages/venue-service/src/operations.ts:935-987`) also carries each served
   set menu's version (Task 6). The spec's sentence is corrected in the same commit as this plan.
4. **What a dish counts as is its live course, as the spec says** ("its product's course at the
   moment it was ordered"). A course is served live today (`OverlayOfferField`,
   `menu-document-types.ts:19-20`), so a product moved to another course on the dashboard counts as
   the new course at once. Publishing refuses a set menu holding a dish no line accepts; because
   the course can change after publishing, the served set menu also leaves out any dish (or
   variant) whose live course no line accepts, so the till is never offered a dish the bill cannot
   cover (Task 6). Piece 2 records the served course on the order line.
5. **Adding dishes adds lines, and says so.** Adding a dish whose course no line accepts appends a
   line "1 × that course", and the editor shows "Added a line: 1 × Coffee" so the person sees it.
   This is how "it starts as one line per course present" is kept true without a separate
   first-save step. A line that no listed dish can fill ("1 × Coffee" with no coffee dish) is a
   problem that stops publishing (**my call**: the diner would pay for a place nobody can fill).
6. **Variants a set menu leaves out are stored; included ones are not.** All variants start
   included (spec); a row in `set_menu_variant_exclusions` leaves one out. An included variant's own
   surcharge reuses `menu_item_variant_overrides.price`.
7. **The document format stays 4.** The change is additive: every stored format-4 document is still
   valid, so no `menu.reset_required`. The `setMenu` block is optional on `MenuDocument`.
8. **The set-up guide section and the editor's help bubble land with the screen** (CLAUDE.md §3: a
   screen change updates its guide in English and Spanish). Piece 5 keeps the table-service guide,
   the help bubble on the order panel and the demo.

## Global Constraints

- **Money:** whole cents in the database (`money` columns), decimal strings with two places in
  documents and API bodies, exactly as `MenuOffer.unitPrice` is (`menu-types.ts:24`). Convert with
  `decimalToCents` / `centsToDecimal`; validate input with `validatePrice` (`packages/menu/src/pricing.ts`).
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
  | `set_menu.invalid`         | `{ field }`       | a bad price, VAT class, line count, line course or variant choice                            |
  | `set_menu.not_found`       | `{ menuId }`      | a set-menu operation names a menu that is missing, inactive or not a set menu                   |
  | `set_menu.wrong_place`     | `{ menuId }`      | a set menu named where only an ordinary menu fits: default menu, a period, an include, Prices   |
  | `set_menu.dishes_only`     | `{ menuId }`      | a section, an included menu or a set menu added to a set menu's list                            |
  | `set_menu.not_publishable` | `{ menuId, count }` | publishing (now or queued) a set menu that has problems (Task 5)                              |

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
   lists the dish under the parent's course with the variant's course shown. Pinned in Tasks 4 and 5.
3. **A course deleted while a set-menu line names it.** The deletion's impact names the set-menu
   lines it changes; the line loses that course; a line left with no course is a publishing problem.
   Pinned in Task 1.
4. **A set menu placed in a full menu but unpublished, or deleted (made inactive).** The full menu
   still publishes and serves; the set menu is simply absent from the served `setMenus`. Pinned in
   Task 6.
5. **A till on this piece's code receiving a full menu that holds a set menu.** It draws every
   other member and does not fail on the new member kind; nothing on the till offers a set-menu dish
   until piece 2. Pinned in Task 3b, in the till's own `menu-browser` tests.
6. **A set menu republished, or one of its dishes sold out, while tills are open.** The zone's menu
   state changes, so tills read the offers again. Pinned in Task 6.

---

### Task 1: Schema — the set-menu kind, its lines and its left-out variants

**Files:**
- Modify: `packages/db/src/schema/menus.ts` (the `menus` table, `:33-66`)
- Create: `packages/db/src/schema/menu/set-menus.ts`; export it from `schema/menu/index.ts`
- Modify: `packages/db/src/classification.ts` (menu state list, `:311-330`)
- Modify: `packages/menu/src/classification.ts` (`MENU_TABLES`, which drives live-update sources and
  backup verification, `backup-verification.ts:17`) and `packages/menu/src/configuration-transfer.ts`
  (`MENU_CONFIGURATION_TRANSFER`, `:215-227`, beside `menu_item_variant_overrides`), so an exported
  set menu imports with its lines and left-out variants
- Regenerate: `packages/db/drizzle/0000_baseline.sql` and its snapshot (never by hand)
- Modify: `apps/server/src/course-delete.ts`, `apps/server/src/kitchen.ts` (wherever
  `COURSE_REFERENCES` is exported from; the test imports it from `./kitchen.js`)
- Test: `packages/db/src/schema/menu/set-menus.test.ts`, `apps/server/src/course-delete.test.ts`

**Interfaces:**
- Produces, on `menus`: `kind` (`enumType(["menu","set_menu"])`, not null, default `"menu"`),
  `setPrice` (`money`, nullable), `setVatClass` (`label`, nullable). CHECKs:
  `menus_set_terms_ck`: `(kind = 'set_menu') = (set_price is not null and set_vat_class is not null)`;
  `menus_set_price_ck`: `set_price is null or set_price >= 0`;
  `menus_set_vat_class_ck`: the same four classes as `products_vat_class_ck` (`menus.ts:175-176`);
  and a set menu is never the default: `menus_set_not_default_ck`: `kind = 'menu' or is_default = 0`.
- Produces `setMenuLines` (`set_menu_lines`): `id`, `menuId` → `menus.id` on delete cascade,
  `position` (`count`), `count` (`count`, CHECK `between 1 and 99`), index on `(menu_id, position)`.
- Produces `setMenuLineCourses` (`set_menu_line_courses`): `lineId` → `set_menu_lines.id` cascade,
  `courseId` → `kitchen_courses.id`; primary key `(line_id, course_id)`.
- Produces `setMenuVariantExclusions` (`set_menu_variant_exclusions`): `menuItemId`, `productId`,
  `variantId`; primary key `(menu_item_id, variant_id)`; foreign keys copied from
  `menu_item_variant_overrides` (`schema/menu/variant-overrides.ts:21-31`): `(menu_item_id,
  product_id)` → `menu_items (id, product_id)` cascade, `(product_id, variant_id)` →
  `products (parent_id, id)` restrict.
- Nothing in the database checks that these rows belong to a set menu; the menu package's writers
  (Task 4) are the only writers. Say so in one line at the table.

- [ ] **Step 1: Write the failing database tests** in `set-menus.test.ts`, with
  `useVenueDb({ migrations: [CORE_MIGRATIONS] })` as `schema/menu/migrations.test.ts:30-33` does:
  - `"a set menu needs a price and a VAT class, and an ordinary menu holds neither"`: inserting
    `kind: "set_menu"` without `setPrice` is refused naming `menus_set_terms_ck`; an ordinary menu
    with `setPrice: 1400` is refused the same way; a set menu with both is accepted.
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
  keeps Mains, the first holds no course, and both lines still exist.
- [ ] **Step 3: Run both; they fail** (`no such column: kind`, unknown table).
- [ ] **Step 4: Add the columns and tables, classify the three tables `state`, run
  `pnpm --filter @waitron/db db:generate`.** Add `setMenuLineCourses.courseId` to
  `COURSE_REFERENCES` (the guard `apps/server/src/in-use-references.test.ts` requires every foreign
  key into `kitchen_courses` there), delete its rows for the course in `deleteCourse`, and add the
  `course_set_menu_lines` removal (count of distinct lines) to `courseDeleteRules`' impact. Add its
  English and Spanish impact wording wherever the existing `course_products` key is worded on the
  dashboard (grep `course_products`).
- [ ] **Step 5: Run both test files, then the schema verification list in Global Constraints,
  `apps/server/src/in-use-references.test.ts`, `packages/composition/src/composition.test.ts`
  (it compares `MENU_TABLES` with the classification, `:176-185`) and the configuration-transfer
  tests (grep `MENU_CONFIGURATION_TRANSFER` for them), with one added case there: `"a set menu
  exports and imports with its lines, their courses and its left-out variants"`.** All pass; read
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
    };

/** The set-menu block of a published set menu's document. */
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

  What a dish counts as is not in the terms: it is the dish's served (live) `courseId`, decision 4.

- Produces in `packages/menu/src/set-menus.ts`:
  `requireSetMenu(tx, menuId): Promise<void>` (throws `set_menu.not_found`) and
  `refuseSetMenu(tx, menuId): Promise<void>` (throws `set_menu.wrong_place` when `menuId` is a set
  menu) — the two guards every later task calls.
- `createMenu`'s input gains `kind?: MenuKind`, `setPrice?: string | null`,
  `setVatClass?: VatClass | null`; `updateMenuDetails`'s gains `setPrice` and `setVatClass`
  (refused with `set_menu.not_found` on an ordinary menu). A set menu's price goes through
  `validatePrice` (`set_menu.invalid`, `field: "setPrice"`), its class must be one of the four
  (`field: "setVatClass"`).

- [ ] **Step 1: Write the failing tests** in `set-menus.test.ts`:
  - `"creates a set menu with its price and class, and a root and home like any menu"`:
    `createMenu(tx, { name: "Daily menu", kind: "set_menu", setPrice: "14.00", setVatClass: "reduced" })`
    returns `kind: "set_menu"`, `setPrice: "14.00"`; `menuRoot(tx, id)` is defined.
  - `"refuses a set menu without a valid price or class"`: `setPrice: "-1"` →
    `set_menu.invalid` `{ field: "setPrice" }`; `setVatClass: "luxury"` → `{ field: "setVatClass" }`.
  - `"changes a set menu's price and refuses a price on an ordinary menu"`.
  - `"a set menu cannot be the default menu"`: `setVenueDefaultMenu` → `set_menu.wrong_place`.
  - `"the Prices read refuses a set menu"`: `menuPrices` → `set_menu.wrong_place`.
- [ ] **Step 2: Write the failing period test** in `menu-timetable.test.ts`:
  `"a period cannot sell a set menu as its customer menu or a staff menu"`: both refused with
  `set_menu.wrong_place` `{ menuId }`; a set menu is sold only by being placed in a menu the period
  sells. venue-service already depends on `@waitron/menu` (`packages/venue-service/package.json:37`),
  so call `refuseSetMenu` beside the existing check at `:365-371`.
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
  root> }`, including as a Home page shortcut (`checkRef` lets a shortcut name a menu's root
  today), and with `set_menu.dishes_only` when the target list belongs to a set menu. A set menu's
  own list takes only products: a section, an include or a set menu is refused
  `set_menu.dishes_only`. Folder settings (`PUT .../members/:memberId/folder`) on a set-menu member
  are refused `set_menu.wrong_place`: it has none in this piece.
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
    Home shortcut, is refused `set_menu.wrong_place`; folder settings on the placed member are
    refused the same way; `includableMenus` and `readMenuStructure(fullMenu).includable` leave it
    out; `placeableSetMenus` lists it until placed.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Run `pnpm --filter @waitron/menu typecheck` and fix the sites in the
  files this task lists. Sites the new ref kind breaks in other packages are Task 3b's: 3a and 3b
  ship on the same branch, in that order, and 3a's commit message lists the packages whose
  typecheck it leaves failing for 3b.
- [ ] **Step 4: Run the test file and `packages/menu`'s suite** (`exec vitest run`; read the count).
- [ ] **Step 5: Commit** — "Set menus: place a set menu in a full menu without combining its prices".

### Task 3b: The full menu's set-menu member, and every reader of a menu's tree

**Files:**
- Modify: `packages/shared/src/menu-document/menu-document-types.ts` (`DocumentMember`, `:54-70`),
  `packages/menu/src/menu-document.ts` (`listOf`, `:258-292`),
  `packages/shared/src/menu-document/device-home.ts` (`indexDocument`, `shownMembers`)
- Modify: every site the typecheck names, and the raw-SQL readers that treat any child that is a
  menu's root as an included menu: `packages/menu/src/content-translation-candidates.ts:92-98`
  (the translation gap report's `included_menu` rows) and `packages/media/src/images.ts:225`
- Test: `packages/menu/src/set-menu-placement.test.ts` (more cases),
  `packages/shared/src/menu-document/device-home.test.ts`, `apps/till/src/widgets/menu-browser.test.ts`

**Interfaces:**
- Consumes the `set_menu` `MemberRef` (Task 3a).
- `DocumentMember` gains `{ kind: "set_menu"; menuId: string; name: string }`. `listOf` emits it for
  an active set menu and nothing for an inactive one, as it does for an included menu (`:270`).

- [ ] **Step 1: Write the failing tests:**
  - in `set-menu-placement.test.ts`: `"the full menu's document holds the set menu as a set_menu
    member"` (its root members include `{ kind: "set_menu", menuId, name: "Daily menu" }` and no
    section for the set menu's root); `"an inactive set menu leaves no member"`; `"the translation
    gap report does not list a placed set menu as an included menu"`.
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
- [ ] **Step 4: Trace the readers the compiler does not name**: `menusContaining`, `parents`,
  `sectionPathName`, `readMenuStructure`'s `includedBy`, and the two raw-SQL readers above. Each
  must report the full menu as holding the set menu, and none may make a set-menu change mark the
  full menu as changed (the full menu's document holds only the member's id and name). Add one test
  per reader whose answer the set menu changes, and say in the commit message which needed none.
- [ ] **Step 5: Run the three test files, `packages/menu`'s and `packages/shared`'s suites, and the
  till's `menu-browser` and `device-home` tests.**
- [ ] **Step 6: Commit** — "Set menus: a full menu's document names its set menus, and every tree reader skips them".

### Task 4: A set menu's dishes, variants and lines

**Files:**
- Modify: `packages/menu/src/set-menus.ts`
- Modify: `packages/menu/src/menu-copy.ts` (`duplicateMenu`), `packages/menu/src/variants.ts`
  (only if a helper is shared)
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
  /** The dish's effective course; null when it has none or it is inactive. */
  courseId: string | null;
  variants: {
    id: string;
    name: string;
    included: boolean;
    /** null: the dish's surcharge. */
    surcharge: string | null;
    courseId: string | null;
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
- `copySetMenuDishes` adds, in the source's order, every dish the source lists that this set menu
  does not, with the source's surcharge, variant exclusions and variant surcharges; dishes already
  here keep theirs (**my call**). Both menus must be set menus. It calls `addLinesForCourses` for the
  dishes it added.
- The member write that adds products to a set menu's root calls `addLinesForCourses` in the same
  transaction (find it through `onStructureChanged`, `section-structure.ts:11-15`), and its route
  answer carries `addedLines` (Task 7).
- `syncMenuOffers`' reset of a row the menu no longer reaches (`menu-structure.ts:225-232`) also
  deletes that row's `set_menu_variant_exclusions`, so a dish removed and added again starts with
  every variant included, as the spec says new dishes do. (The reset keeps the row, so the
  exclusion's cascade never fires.)
- `duplicateMenu` of a set menu copies its kind, price, class, lines with their courses, and
  exclusions (it already copies `menu_items` and overrides; check that it does).
- Problems (pure, from the details): `no_dishes`; `no_lines`; `line_without_course`;
  `dish_without_course` for an included product with no Active variant and no course, and for each
  included variant with no course (`parentName` set); `dish_not_included` when no line accepts that
  course; `line_unfillable` when no included dish or variant counts as any of the line's courses
  (decision 5). Courses here are the dishes' current ones, as the live course decides what a dish
  counts as (decision 4). A dish whose variants are all left out is a problem of kind `no_dishes`
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
  carte until Task 5's `freezeSetMenu` replaces them), `combineOffer`'s `own()`, `menuPrices`,
  `updateMenuItem`, `syncMenuOffers`' reset, `duplicateMenu`, the preview's undo
  (`menu-undo.ts:194,216`) and `inheritedPrice` (`menu-document.ts:1185-1194`), both fixed in Task
  5, and the live patch (`menu-patch.ts:177`, which can rewrite a live set menu's surcharge: allowed,
  as on any menu, and Task 5's test covers it). For each, state in the commit message whether it can
  reach a set menu's row and, if it can, why the surcharge reading is right there or how it is
  refused. `menuPrices` is refused (Task 2).
- [ ] **Step 5: Run the file and `packages/menu`'s suite; all pass.**
- [ ] **Step 6: Commit** — "Set menus: dishes with surcharges, variants left out, and what one set menu includes".

### Task 5: A set menu's published document, and refusing an unpublishable one

**Files:**
- Create: `packages/menu/src/set-menu-document.ts`
- Modify: `packages/menu/src/menu-document.ts` (`buildMenuDocuments`, `BuiltMenu`; `diffEntries`),
  `packages/shared/src/menu-document/menu-document-types.ts` (`MenuDocument`: optional
  `setMenu?: SetMenuTerms`; `MenuPreview`: `setMenuProblems: SetMenuProblem[]`; `MenuChangeBody`:
  `{ kind: "set_menu_changed"; fields: ("price" | "vat" | "names" | "lines")[] }`)
- Modify: `packages/menu/src/menu-publication.ts` (`previewMenu`, `publishMenu` `:660-689`),
  `packages/menu/src/menu-schedule.ts` (`queueMenuPublication` `:37-60`)
- Test: `packages/menu/src/set-menu-document.test.ts`

**Interfaces:**
- Consumes: `readSetMenu`, `setMenuProblems` (Task 4).
- Produces `freezeSetMenu(offers: FrozenOffer[], details: SetMenuDetails): { offers: FrozenOffer[]; terms: SetMenuTerms }`
  in `set-menu-document.ts`, called from `buildMenuDocuments` for a set menu's row after
  `freezeOffer`. In a set menu's document:
  - each offer's `unitPrice` is the dish's surcharge, `"0.00"` when included; each variant left out
    is removed from `variants`; each kept variant's `unitPrice` and `menuPrice` are its surcharge
    (its own, else the dish's, else `"0.00"`). An offer whose variants are all left out is dropped,
    with its product member.
  - `root` is the root list's product members, as today; `home` is the empty home the shell made.
  - `setMenu` is `{ price, vatClass, names, lines }`, `names` from the set menu's root section.
  - `clashes` is `[]` and `combined` is not consulted.
- `BuiltMenu` gains `setMenuProblems: SetMenuProblem[]` (`[]` for an ordinary menu); `previewMenu`
  returns them; `publishMenu` and `queueMenuPublication` refuse a set menu with any, with
  `set_menu.not_publishable` `{ menuId, count }`, at the same point they refuse clashes
  (`menu-publication.ts:670-671`, `menu-schedule.ts:48-49`).
- `diffEntries` emits one `set_menu_changed` entry naming the fields that differ between the live
  and proposed `setMenu` (`names` counts as `"names"`; add it to the field list); a surcharge change
  already shows as `price_changed` on its dish. On a set menu, `price_changed` carries no
  `inheritedPrice` (what the dish "would otherwise cost" is its à la carte price, which means
  nothing here), and its undo (`menu-undo.ts:194`) always puts back the live surcharge, blank
  meaning included.

- [ ] **Step 1: Write the failing tests** in `set-menu-document.test.ts`, built on Task 4's
  fixture (Daily menu €14: Soup included, Sirloin +€5, Wine with Glass +€1.50 and Bottle left out):
  - `"a set menu's offers carry surcharges, not à la carte prices"`: Soup `unitPrice "0.00"`,
    Sirloin `"5.00"`, Wine's variants are only Glass at `"1.50"`; Sirloin's options and extras are
    the same as in the full menu's document (compare `offeredModifiers`).
  - `"the document carries the set menu's terms"`: `setMenu` equals
    `{ price: "14.00", vatClass: "reduced", names: { en: "Daily menu" }, lines: [...] }`.
  - `"a dish moved to a course no line accepts stops the next publish"`: publish; give Soup a
    course no line includes; `previewMenu` lists `dish_not_included` for Soup and `publishMenu`
    refuses.
  - `"undoing a surcharge on a set menu puts back Included"`: live Sirloin included, now +€5 → the
    preview's `price_changed` has no `inheritedPrice` and its undo writes `grossPrice: null`.
  - `"a live patch can change a set menu's surcharge"`: `patchLiveMenu` sets Sirloin to "6.00" →
    the live document's Sirloin `unitPrice` is `"6.00"`.
  - `"publishing refuses a set menu with a problem, now or queued"`: a dish with no course →
    `publishMenu` and `queueMenuPublication` refuse `set_menu.not_publishable` `{ count: 1 }`;
    `previewMenu` returns the problem and does not throw.
  - `"a price change shows in the preview"`: change €14 → €15 → one `set_menu_changed` with
    `fields: ["price"]`.
  - `"a published set menu protects its dishes from being archived"`: `assertOffPublishedMenus`
    (`archive.ts:77`) refuses archiving Soup while the set menu is live (existing behaviour,
    since the dishes are product members of its root).
  - `"its dish images are kept"`: `documentImages` of the set menu's document lists Soup's image.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Keep `MENU_DOCUMENT_FORMAT` at 4 (decision 7); a stored format-4
  document without `setMenu` reads as before.
- [ ] **Step 4: Run the file, then `menu-publication.test.ts`, `menu-document.test.ts` and
  `packages/menu`'s suite.**
- [ ] **Step 5: Commit** — "Set menus: publish a set menu with its terms and surcharges, and refuse one that cannot be covered".

### Task 6: Serving placed set menus with the zone's offers

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`ServiceZoneOffers` `:826`, `listZoneOffers`
  `:834-896`, `menuState` and `ZoneMenuState` `:935-987`)
- Modify: `packages/shared/src/menu-document/menu-document-types.ts` (`ServedSetMenu`)
- Modify: `apps/till/src/api/client.ts` (`ZoneOffers`, `:446-461`: add the field, read nothing yet)
- Test: `packages/venue-service/src/zone-offers.set-menus.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ServedSetMenu {
  id: string;
  name: string;
  versionId: string;
  terms: SetMenuTerms;
  /** The set menu's root members, for drawing its folder. */
  structure: DocumentList;
  /** Keyed by the set menu's own menu-item ids; never merged into the zone's `offers`. */
  offers: LiveOffer[];
}
```

  and `ServiceZoneOffers.setMenus: readonly ServedSetMenu[]`, one per distinct active set menu
  that a served menu's document holds as a `set_menu` member and that has a live version, read with
  `readLiveDocuments` and passed through `applyLiveFields` like any menu's. After the live fields
  are applied, an offer whose served `courseId` no line accepts is left out, and so is a variant
  whose own served course no line accepts (decision 4); the member for a left-out offer is dropped
  from `structure` too.
- `ZoneMenuState` gains `setMenus: { menuId: string; versionId: string }[]`, and `menuState` passes
  the served set menus' documents to `readLiveState` with the zone's own, so a republished set menu,
  a dish sold out and a course change all change the state the till compares
  (`apps/till/src/till-app.ts:6883,6909`) and the till reads the offers again. Piece 2 uses the
  same versions when it asserts them (`assertLiveVersions`).
- When `listZoneOffers` is called with `menuItemIds` (every draft and line write does,
  `order-drafts.ts:1437`, `working-order.ts:564,576`), it reads no set menu at all and answers
  `setMenus: []`: nothing in this piece prices a set-menu dish, and piece 2 adds its own filtered
  read.
- The set menus' offers stay out of `offers`, so the server's re-pricing by menu-item id
  (`offersFor`, `apps/server/src/order-drafts.ts:1429-1442`) refuses a set-menu dish until piece 2
  decides how it is ordered.

- [ ] **Step 1: Write the failing tests:**
  - `"a zone selling a full menu that holds a published set menu serves it"`: `setMenus` has one
    entry with the live `versionId`, `terms.price "14.00"` and Soup's offer at `"0.00"`; `offers`
    holds no set-menu menu-item id.
  - `"publishing the set menu again reaches the zone without publishing the full menu"`: republish
    at €15 → `setMenus[0].terms.price "15.00"`, full menu's `versionId` unchanged.
  - `"an unpublished or inactive set menu is not served, and the full menu still is"`.
  - `"a set menu placed in two served menus is served once"`.
  - `"a sold-out dish is unavailable in the set menu too"`: Soup `available = false` → its served
    set-menu offer says `available: false`.
  - `"a dish whose course no line accepts is not served"`: after publishing, give Soup a course no
    line includes → Soup is absent from `offers` and `structure`; Hake is still served.
  - `"republishing a set menu, or selling out its dish, changes the zone's menu state"`: compare
    `menuState` before and after each.
  - `"a read for named menu items reads no set menu"`: with `menuItemIds` given, `setMenus` is `[]`
    and no set-menu version is read (spy on `readLiveDocuments`, or count statements).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Walk each served document's tree for `set_menu` members (one shared
  helper beside `indexDocument` in `device-home.ts`, `setMenuIdsIn(members)`), read their live
  documents in one call, skip any whose `setMenu` is missing.
- [ ] **Step 4: Run the file, `packages/venue-service`'s suite, and `apps/server`'s till offers
  route tests (grep `default-service-zone/offers` under `apps/server/src/*.test.ts`).**
- [ ] **Step 5: Commit** — "Set menus: serve each placed set menu's live version with the zone's offers".

### Task 7: Server routes and the dashboard's API client

**Files:**
- Modify: `apps/server/src/menu-api.ts` (menu routes `:962-1280`, status map `:320-380`)
- Modify: `apps/dashboard/src/api/client.ts` (menu calls `:3249-3541`), `apps/dashboard/src/i18n/codes.ts`
- Test: `apps/server/src/menu-api.set-menus.test.ts`, `apps/dashboard/src/api/client.test.ts` (if
  menu calls are tested there; otherwise in the screen tests of Task 8a)

**Interfaces:**
- `POST /management-api/menus` accepts `kind`, `setPrice`, `setVatClass`; `PATCH .../menus/:id`
  accepts `setPrice`, `setVatClass`.
- `GET /management-api/menus/:id/set-menu` → `SetMenuDetails`.
- `PUT /management-api/menus/:id/set-menu/lines` body `{ lines: { count, courseIds }[] }` →
  `{ lines: SetMenuLine[] }`.
- `PUT /management-api/menus/:id/set-menu/items/:itemId/variants` body
  `{ variants: { variantId, included, surcharge }[] }` → `SetMenuDetails`.
- `POST /management-api/menus/:id/set-menu/dishes` body
  `{ dishes: { productId, excludedVariantIds }[] }` → `{ details: SetMenuDetails; addedLines: SetMenuLine[] }`.
- `POST /management-api/menus/:id/set-menu/copy-dishes` body `{ fromMenuId }` →
  `{ details: SetMenuDetails; addedLines: SetMenuLine[] }`.
- Removing a dish and setting a surcharge use the existing section-member and
  `PATCH .../items/:itemId` routes; the existing add-products member route still works on a set
  menu's list (all variants included) and answers `addedLines` too. Placing a set menu uses the existing
  `POST /management-api/sections/:id/members` with the `set_menu` ref.
- Status: `set_menu.not_found` 404; `set_menu.invalid`, `set_menu.dishes_only` 400 (or whatever
  status the map gives the nearest `menu_section.*` code); `set_menu.wrong_place`,
  `set_menu.not_publishable` 409.
- Client methods: `createMenu` (extended), `readSetMenu(menuId)`, `addSetMenuDishes(menuId, dishes)`,
  `saveSetMenuLines(menuId, lines)`,
  `saveSetMenuVariantChoices(menuId, itemId, variants)`, `copySetMenuDishes(menuId, fromMenuId)`,
  `placeSetMenu(sectionId, menuId)`.

- [ ] **Step 1: Write the failing route tests**, one per route: the answer's shape on success, and
  one refusal each with its status and code; plus `"publishing a set menu with a problem answers 409 set_menu.not_publishable"`.
  Every route here carries the dashboard's cookie, so keep it behind
  `requireManagementChangeFromOwnPage` like its neighbours (CLAUDE.md §3); the sweep in
  `apps/server/src/boot.management-origin.test.ts` must still pass.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement the routes, the status entries, the client methods, and the English and
  Spanish wording for the five codes in `codes.ts`.** Wording, **my call**, each saying what to do:
  - `set_menu.wrong_place`: "A set menu is sold by placing it in a menu. Open that menu's
    Structure and add the set menu there." / «Un menú a precio fijo se vende colocándolo dentro de
    un menú. Abre la Estructura de ese menú y añádelo allí.»
  - `set_menu.dishes_only`: "A set menu lists dishes only. Add products to it; to group them, set
    each product's course." / «Un menú a precio fijo solo lista platos. Añade productos; para
    agruparlos, asigna un curso a cada producto.» (the dashboard's Spanish for "course" is
    «curso», `strings.ts:5847`)
  - `set_menu.not_publishable`: "This set menu can't be published yet: {count} problems are listed
    on its page. Fix them, then publish." / «Este menú a precio fijo aún no se puede publicar: hay
    {count} problemas en su página. Corrígelos y publica.»
  - `set_menu.invalid` by field, and `set_menu.not_found`, in the style of the neighbouring
    `menu_section.*` entries.
  Use the dashboard's existing Spanish words for "course" and "set menu" if `strings.ts` already
  has them (grep `course` and `menú`); the Spanish above is a starting point, not a fixed text.
- [ ] **Step 4: Run the route file, `apps/server/src/menu-api.test.ts` and the management-origin sweep.**
- [ ] **Step 5: Commit** — "Set menus: management routes and the dashboard's client".

### Task 8a: Dashboard — adding a set menu, the list, and the editor's shell

**Files:**
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (`TABS` `:92`, `#renderAddMenu`
  `:2551-2562`, list columns, `#renderEditor` `:3910-3965`, the Preview tab)
- Create: `apps/dashboard/src/widgets/set-menu-editor.ts` (the one page: Task 8b draws its terms,
  Task 9 its dishes, Task 10 its lines)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/menus-screen.set-menu.test.ts`, `set-menu-editor.a11y.test.ts`

**Interfaces:**
- **Add menu** becomes a choice of **Menu** or **Set menu** (a `wt-*` menu button, or two buttons
  if no menu-button primitive exists; check `packages/ui` first and never draw a native one). Menu
  opens today's form; Set menu opens Task 8b's form in a modal, which creates the set menu and opens
  its editor. Until 8b lands, the Set menu choice opens nothing: land 8a and 8b on the same branch.
- The menus list shows a **Kind** column ("Menu" / "Set menu") and, for a set menu, its price.
- A set menu's editor has two tabs, **Set menu** (`set-menu`, drawing `dashboard-set-menu-editor`)
  and **Preview** (`preview`, today's publishing tab, which also lists `setMenuProblems` above the
  publish button). Structure, Prices and Home page are not shown; a stored address naming one of
  those for a set menu opens **Set menu**.
- The editor's heading carries a `wt-help-tooltip` with `mode="help-mode"` (CLAUDE.md §3) that
  orients in a few sentences — a set menu is a fixed price for one of each of its lines; dishes
  with a surcharge cost that on top; place it in a menu to sell it — and links to the guide's
  `{#set-menus}` section (Task 11). Write it from the code as built.

- [ ] **Step 1: Write the failing tests** in `menus-screen.set-menu.test.ts`:
  `"Add menu offers Menu and Set menu"`; `"the list shows a set menu's kind and price"`;
  `"a set menu's editor has no Structure, Prices or Home page tab, and an old address for one opens
  Set menu"`; `"Preview lists the set menu's problems and publishing them answers the refusal"`;
  `"the editor's help bubble shows only in help mode and links to the guide"`. The a11y file: axe on
  the editor shell in both themes.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.**
- [ ] **Step 4: Run the new tests and `menus-screen.test.ts`, `menus-screen.a11y.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: offer a set menu on the menus list and give it its own editor".

### Task 8b: Dashboard — a set menu's name, price and VAT class

**Files:**
- Create: `apps/dashboard/src/widgets/set-menu-terms-form.ts`
- Modify: `apps/dashboard/src/widgets/set-menu-editor.ts`, `apps/dashboard/src/screens/menus-screen.ts`
  (the Set menu choice from 8a), `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/widgets/set-menu-terms-form.{test,a11y.test,unsaved.test}.ts`,
  `menus-screen.set-menu.test.ts` (one more case)

**Interfaces:**
- The form: **Name** (required), customer names by language as the section form takes them (reuse
  `dashboard-section-details-form`'s name fields if it can be composed, rather than copying them),
  **Price per set menu** (required, `wt-price-input`, gross), **VAT class** (required; the same
  field and default the product editor gives a new product — read
  `product-editor.vat-default.test.ts` for how the default is chosen). It creates (from Add menu) or
  saves (at the top of the editor) and emits `set-menu-terms-saved`. Saves quiet until the draft
  changes.

- [ ] **Step 1: Write the failing tests:** `"creating a set menu opens its editor on the Set menu
  tab"` (screen); in the form test: required marks; `"a negative or blank price shows its error
  under the field and disables Save"`; `"Save stays quiet until something changes"`; a refused save
  puts `set_menu.invalid` `{ field: "setPrice" }` under the price field. The a11y file: axe in both
  themes for the empty, filled and refused states. The unsaved file: leaving with a changed price
  asks, as the other `*.unsaved` tests do.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them.**
- [ ] **Step 5: Look at it.** Start Claude's own stack (`wa-wt demo <worktree>`, never slot 1,
  CLAUDE.md §6), create a set menu, and check the list and editor in both themes and at phone width.
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
- After adding or copying, any `addedLines` show once as a note above the lines: "Added a line:
  1 × Coffee" (decision 5).
- One `wt-data-table` per course, in course order, headed by the course name, then **No course**
  last with "Give it a course on the product to use it here" and a link to each product's editor.
  Columns: dish, **Surcharge** (a `wt-price-input`, blank shown as "Included"), and an `actions`
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
  another its own surcharge"`; `"a dish with no course links to its product"`; `"copying dishes from
  another set menu adds them and keeps this one's surcharges"`; a11y for each table state and the
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
  that fixes it where there is one (a link to the product, the variants dialog).

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
  member rows), `apps/dashboard/src/screens/menus-screen.ts` (the include dialog `:3598-3690`)
- Modify: `packages/venue-service/src/dashboard/period-dialog.ts` (`:49-59`, `:174-175`) and the
  default-menu choice (grep `default-menu` under `apps/dashboard/src`)
- Modify: `apps/server/src/guide/en/products.md`, `apps/server/src/guide/es/products.md`
- Test: `apps/dashboard/src/widgets/menu-structure-table.set-menu.test.ts`,
  `packages/venue-service/src/dashboard/period-dialog.test.ts`

**Interfaces:**
- The Structure tab's **Add** gains **Set menu…** (`"add-set-menu"`), listing
  `placeableSetMenus`; choosing one places it in the list being viewed. A placed set menu's row
  shows its name, "Set menu" and its price, opens the set menu's editor when clicked, and offers
  Move and Remove like an include. It has no folder settings in this piece.
- The include picker, the period dialog's customer and staff menu choices, and the default-menu
  choice list ordinary menus only (`kind === "menu"`).
- Guide: a `## Set menus {#set-menus}` section in both languages, written from the code as built:
  what a set menu is, creating one, its dishes and surcharges, variants, what one set menu
  includes, placing it in a menu, publishing (and that publishing the set menu is enough to change
  it on the tills). Remove any "set lunch" wording A1515-REMOVE left behind in these two files.
  Short; a sentence earns its place by changing what staff do (CLAUDE.md §3).

- [ ] **Step 1: Write the failing tests:** `"Add offers Set menu and places the chosen one"`;
  `"a placed set menu's row shows its price and opens its editor"`; `"the include picker leaves set
  menus out"`; `"the period dialog offers no set menu as a customer or staff menu"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them, and
  `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.**
- [ ] **Step 5: Look at it end to end** on Claude's stack: create Daily menu (€14) with Soup, Hake
  and Sirloin (+€5), place it in the full menu, publish the set menu, then read
  `GET /api/default-service-zone/offers` on the till's port and check `setMenus[0]` has
  `terms.price "14.00"` and Sirloin at `"5.00"`. Record the request and the fields in the PR.
- [ ] **Step 6: Update `docs/backlog/menu.md`'s A1515 entry** to say piece 1 has landed and what is
  next, in the same commit.
- [ ] **Step 7: Commit** — "Set menus: place a set menu in a menu, and the set-up guide".

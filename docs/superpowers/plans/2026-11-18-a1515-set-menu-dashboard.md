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
3. **A set menu is copied into each full menu that holds it when that full menu is published, as
   an included menu is** (**owner**, 18 November 2026). The copy is taken from the set menu's
   working state (`buildMenuDocuments` already builds an included menu's offers and structure in
   the same pass, `packages/menu/src/menu-document.ts:240-336`). A set menu has no Publish of its
   own and no `menu_versions` rows: publishing or queueing one is refused `set_menu.wrong_place`.
   Changing a set menu marks every full menu holding it as changed, because the copy is part of the
   full menu's document and so of its working hash. Publishing (now or queued) a full menu refuses
   when a set menu it holds has a problem. What the till serves and what a bill records are a full
   menu's version and the set menu's id in it (Task 6).
4. **What a dish counts as is fixed in the copy** (**owner**, 18 November 2026: "The menu should
   freeze the definition"). The copy records each dish's course, and each kept variant's own course,
   as `countsAsCourseId` when the full menu is published. A product moved to another course on the
   dashboard still counts as its old course on the tills until a full menu holding the set menu is
   published again. The dish's served `courseId`, which decides when it is sent, stays live as for
   every dish (`OverlayOfferField`, `menu-document-types.ts:19-20`), and is kept apart from what it
   counts as. Piece 2 records `countsAsCourseId` on the order line. The spec's "its product's course
   at the moment it was ordered" is corrected to match in the same commit. Decision 9 adds a course
   chosen in the set menu, which takes the product's place in both.
5. **Adding dishes adds lines, and says so.** Adding a dish whose course no line accepts appends a
   line "1 × that course", and the editor shows "Added a line: 1 × Coffee" so the person sees it.
   This is how "it starts as one line per course present" is kept true without a separate
   first-save step. A line that no listed dish can fill ("1 × Coffee" with no coffee dish) is a
   problem that stops publishing (**my call**: the diner would pay for a place nobody can fill).
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
     The dish and every kept variant of it then count as that course and are sent with it. Without
     a row, the dish counts as its product's course (or each variant's own) and is sent as today.
   - Like the rest of the set menu, the chosen course reaches the tills in the copy, when a full
     menu holding the set menu is published (decision 4). In the copy it is `courseOverrideId`,
     which piece 2's tills use as the line's course.
   - Choosing the product's own course again clears the row, so the dish follows its product later
     (**my call**). The same product à la carte is never affected.

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
  | `set_menu.wrong_place`     | `{ menuId }`      | a set menu named where only an ordinary menu fits: default menu, a period, an include, Prices, publishing it |
  | `set_menu.dishes_only`     | `{ menuId }`      | a section, an included menu or a set menu added to a set menu's list                            |
  | `set_menu.not_publishable` | `{ menuId, count }` | publishing (now or queued) a full menu holding a set menu that has problems (Task 5)          |

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
4. **A set menu placed in a full menu and then deleted (made inactive), or placed in two served
   full menus published at different times.** An inactive one leaves no copy and the full menu
   still publishes. Two different copies are served side by side, each with its own key; a copy
   held only by a full menu not selling now is served as not orderable, so piece 2 never starts a
   set menu from it. Pinned in Tasks 5 and 6.
5. **A till on this piece's code receiving a full menu that holds a set menu.** It draws every
   other member and does not fail on the new member kind; nothing on the till offers a set-menu dish
   until piece 2. Pinned in Task 3b, in the till's own `menu-browser` tests.
6. **A set menu changed on the dashboard but its full menu not yet published, or one of its dishes
   sold out, while tills are open.** The tills keep the old copy until the full menu is published;
   a sold-out dish is unavailable in the copy at once, because the zone's menu state reads the
   copy's dishes too. Pinned in Task 6.
7. **A dish moved to another course after the full menu was published.** It is still served in the
   set menu, still counts as its old course, and is sent with its new course. The full menu shows as
   changed; publishing it again fixes the new course, or refuses if no line accepts it. Pinned in
   Tasks 5 and 6.

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
- Produces `setMenuDishCourses` (`set_menu_dish_courses`, decision 9): `menuItemId` → `menu_items.id`
  on delete cascade, the primary key; `courseId` → `kitchen_courses.id`.
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
    };

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
  (decision 4, Task 5).

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
  must report the full menu as holding the set menu. (A set-menu change does mark the full menu as
  changed, but through Task 5's copy in the document, not through these readers.) Add one test
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
  /** The course the dish counts as and is sent with here: `courseOverrideId` when set, else the
   * product's effective course; null when it has none or it is inactive. */
  courseId: string | null;
  /** The product's own effective course, shown as the default. */
  productCourseId: string | null;
  /** The course this set menu gives the dish (decision 9); null: the product's. */
  courseOverrideId: string | null;
  variants: {
    id: string;
    name: string;
    included: boolean;
    /** null: the dish's surcharge. */
    surcharge: string | null;
    /** The dish's `courseOverrideId` when set, else the variant's own effective course. */
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
/** Gives the dish a course in this set menu (decision 9), or clears it with null; answers the
 * lines `addLinesForCourses` added for the new course. */
export function saveSetMenuDishCourse(
  tx: Transaction,
  menuId: string,
  menuItemId: string,
  courseId: string | null,
): Promise<SetMenuLine[]>;
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
- `saveSetMenuDishCourse` refuses an inactive or unknown course with `set_menu.invalid`
  `{ field: "courseId" }`, and a menu item not on this set menu with `set_menu.not_found`. A course
  equal to the product's own effective course is stored as no row (decision 9, **my call**). When
  no line accepts the new course, it appends one through `addLinesForCourses`, as adding a dish
  does (decision 5).
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
  - `"a set menu can give a dish another course"`: Bravas (Sharing plates) is added, which appends
    `1 × Sharing plates`; `saveSetMenuDishCourse(Bravas, Starters)` → `readSetMenu` shows
    `courseId: Starters`, `productCourseId: Sharing plates`, `courseOverrideId: Starters`, and its
    variants' `courseId` is Starters. Saving Sharing plates again stores no row. Bravas sold à la
    carte keeps Sharing plates. An inactive course → `set_menu.invalid` `{ field: "courseId" }`.
  - `"a dish with no course stops being a problem once the set menu gives it one"`.
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
  5, and the live patch (`menu-patch.ts:177`): a set menu has no live version to patch, and a full
  menu's live price correction changes only the full menu's own offer, never a copy's surcharge
  (Task 5's test covers both). For each, state in the commit message whether it can
  reach a set menu's row and, if it can, why the surcharge reading is right there or how it is
  refused. `menuPrices` is refused (Task 2).
- [ ] **Step 5: Run the file and `packages/menu`'s suite; all pass.**
- [ ] **Step 6: Commit** — "Set menus: dishes with surcharges, variants left out, and what one set menu includes".

### Task 5: The set menu's copy in a full menu's published document, and refusing an unpublishable one

**Files:**
- Create: `packages/menu/src/set-menu-document.ts`
- Modify: `packages/menu/src/menu-document.ts` (`buildMenuDocuments` `:147-341`, `BuiltMenu`
  `:104-112`, `diffEntries`), `packages/shared/src/menu-document/menu-document-types.ts`
  (`MenuDocument`, `MenuPreview`, `MenuChangeBody`, `MenuChangeSource`),
  `packages/menu/src/menu-navigation.ts`, `packages/menu/src/menu-undo.ts`,
  `packages/menu/src/menu-patch.ts`, and the readers named under "Other readers" below
- Modify: `packages/menu/src/menu-publication.ts` (`previewMenu`, `publishMenu` `:660-689`,
  `patchLiveMenu` `:734`), `packages/menu/src/menu-schedule.ts` (`queueMenuPublication` `:37-60`,
  which builds and stores the document when queued, so the copy is taken then)
- Test: `packages/menu/src/set-menu-document.test.ts`

**Interfaces:**
- Consumes: `readSetMenu`, `setMenuProblems` (Task 4); the `set_menu` `DocumentMember` (Task 3b).
- Produces, in `menu-document-types.ts`:

```ts
export type SetMenuOfferVariant = FrozenOfferVariant & { countsAsCourseId: string };
export type SetMenuFrozenOffer = Omit<FrozenOffer, "variants"> & {
  /** Fixed when the full menu is published (decision 4); null only for a dish whose variants
   * each carry their own. */
  countsAsCourseId: string | null;
  /** The course this set menu gives the dish (decision 9); the tills send the dish, and every
   * kept variant, with it instead of the live course. null: none. */
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
}
```

  `MenuDocument` gains optional `setMenus?: Record<string, PublishedSetMenu>`, keyed by set menu
  id; `MenuPreview` gains `setMenuProblems: { menuId: string; name: string; problems: SetMenuProblem[] }[]`;
  `MenuChangeBody` gains
  `{ kind: "set_menu_changed"; setMenu: { id: string; name: string }; fields: ("price" | "vat" | "names" | "lines" | "dishes")[] }`.
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
- `buildMenuDocuments` adds a set menu to the menus it builds whenever a requested menu's tree, or
  the tree of a menu it includes, holds it as an active `set_menu` member (as `visit` does for
  includes, `:189-197`), so its offers come from the same `listMenuOffers` call. The full menu's
  document gets `setMenus[id] = freezeSetMenu(...)` for each such set menu, including one placed
  inside an included menu's list. The copy never enters `combined` or `clashes`.
- **How the copy is built.** `order()` (`menu-document.ts:241-249`) puts a held set menu before the
  full menu, as it does an included menu; the set menu's own pass builds its root and frozen offers,
  and the full menu reuses them through `freezeSetMenu`. `buildMenuDocuments` reads the set-menu
  details (`readSetMenu`'s lines, exclusions, variant surcharges and courses) for every set menu it
  builds in ONE batched read, never one call per set menu: `menuStatus` builds every menu on each
  live change (`menu-publication.ts:216-227`).
- `BuiltMenu` gains `setMenuProblems` with `MenuPreview`'s shape: on a full menu, one entry per held
  set menu that has problems; on a set menu, `[]` (the editor reads its problems from
  `readSetMenu`). `previewMenu` on a set menu refuses `set_menu.wrong_place`.
- Refusals, at the point that refuses clashes (`menu-publication.ts:670-671`,
  `menu-schedule.ts:48-49`): publishing or queueing a set menu itself →
  `set_menu.wrong_place` `{ menuId }`; a full menu whose `setMenuProblems` is not empty →
  `set_menu.not_publishable` `{ menuId: <the first set menu with problems>, count: <its problems> }`.
  `patchLiveMenu` on a set menu → `set_menu.wrong_place`. On a full menu, a live correction applies
  to the copies' dishes exactly as to the document's own offers (wording, VAT class, an extra's or
  option's correction), except a correction of a dish's own price, which changes only the full
  menu's own offer: in a copy that price is a surcharge, changed on the set menu's page (**my
  call**). Read `menu-patch.ts:160-200` for how each correction walks the offers and apply the same
  walk to `setMenus[*].offers`.
- `diffEntries` emits one `set_menu_changed` per set menu whose copy differs between the live and
  proposed documents, naming the fields that differ (`"dishes"` covers dishes added, removed,
  re-priced, re-coursed or with variants changed). `MenuChangeSource` gains `"set_menu"`; the change
  carries `source: "set_menu"`, `setMenu: { id, name }`, `alsoOn` naming the other published full
  menus that hold the set menu, and the target `navigateMenuChanges` (`menu-navigation.ts`) gives
  the set-menu member. It has no undo: `menu-undo.ts` treats it as not undoable, and the preview
  links to the set menu's page instead (**my call**: the change is made there). Placing or removing
  a set menu shows as the member change it already is. The dashboard's `widgets/menu-preview.ts`
  and `strings.ts` word the new kind and source (Task 8a).
- **Other readers of a published document's offers** do not see the copies unless changed. Decide
  each in Step 4 and record it in the commit message: `documentProductIds`/`assertOffPublishedMenus`
  and `documentImages` read the copies; `routing-store.ts:742-768` (which extras a dish offers per
  zone) and `extra-usage.ts:32-45` (where an extras list is in use) read them; `productsOfferedIn`
  and `guest-menu.ts` skip them (a set menu is not shown to guests in this piece); `party-allergy.ts:121`
  and `till-api.ts:1614,1648`, which read `listZoneOffers`' `offers`, are left to piece 2, which
  orders set-menu dishes.

- [ ] **Step 1: Write the failing tests** in `set-menu-document.test.ts`, built on Task 4's
  fixture (Daily menu €14: Soup included, Sirloin +€5, Wine with Glass +€1.50 and Bottle left out),
  placed in a full menu "Lunch" that sells Sirloin at €18:
  - `"Lunch's document holds a copy of the set menu with surcharges, not à la carte prices"`: in
    `buildMenuDocument(Lunch).document.setMenus[dailyMenu]`, Soup `unitPrice "0.00"`, Sirloin
    `"5.00"`, Wine's variants only Glass at `"1.50"`; Sirloin's `offeredModifiers` equal those of
    Lunch's own Sirloin offer; Lunch's own Sirloin offer stays `"18.00"`.
  - `"the copy carries the terms and what each dish counts as"`: `terms` equals
    `{ price: "14.00", vatClass: "reduced", names: { en: "Daily menu" }, lines: [...] }`; Soup's
    `countsAsCourseId` is Starters; Glass's is its own course.
  - `"a dish given another course in the set menu carries it in the copy"`: Bravas given Starters
    → its offer's `countsAsCourseId` and `courseOverrideId` are Starters; Lunch's own Bravas offer
    keeps Sharing plates and no override.
  - `"changing the set menu changes Lunch's working hash, and nothing reaches the live version
    until Lunch is published"`: publish Lunch; change Sirloin to +€6 → Lunch's `workingHash`
    differs from its live hash, `previewMenu(Lunch)` has one `set_menu_changed` with
    `fields: ["dishes"]`, the live document still says `"5.00"`; publish Lunch → `"6.00"`.
  - `"a dish moved to another course keeps its counts-as until Lunch is published again"`: publish;
    move Soup to Mains (accepted by a line) → the live copy still says Starters; publish → Mains.
  - `"a dish moved to a course no line accepts stops Lunch's next publish"`: give Soup a course no
    line includes → `previewMenu(Lunch).setMenuProblems` names Daily menu with
    `dish_not_included`, and `publishMenu(Lunch)` and `queueMenuPublication(Lunch)` refuse
    `set_menu.not_publishable` `{ menuId: dailyMenu, count: 1 }`.
  - `"a set menu has no Publish of its own"`: `publishMenu(dailyMenu)`,
    `queueMenuPublication(dailyMenu)` and `patchLiveMenu(dailyMenu)` refuse `set_menu.wrong_place`.
  - `"a live price correction of Lunch's Sirloin leaves the copy's surcharge alone, and a live
    wording correction reaches the copy"`.
  - `"a set menu has no preview"`: `previewMenu(dailyMenu)` refuses `set_menu.wrong_place`.
  - `"building every menu reads set-menu details once"`: count statements (or spy) while
    `buildMenuDocuments` builds two full menus holding three set menus.
  - `"a set menu placed inside an included menu is copied into the including menu"`: Lunch includes
    "Specials", which holds Daily menu → `setMenus[dailyMenu]` is in Lunch's document.
  - `"an inactive set menu leaves no copy and Lunch still publishes"`.
  - `"a price change shows as set_menu_changed with fields price"`: €14 → €15.
  - `"a published copy protects its dishes from being archived"`: `assertOffPublishedMenus`
    (`archive.ts:77`) refuses archiving a dish only the set menu lists while Lunch is live; read
    how it finds published dishes first and extend it to `setMenus` copies if it reads only
    `offers`.
  - `"the copy's dish images are kept"`: `documentImages` of Lunch's document lists the image of a
    dish only the set menu lists; extend it to `setMenus` the same way if needed.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Keep `MENU_DOCUMENT_FORMAT` at 4 (decision 7); a stored format-4
  document without `setMenus` reads as before.
- [ ] **Step 4: Trace the other readers listed above**, add a test for each that reads the copies
  (`routing-store`, `extra-usage`), and record the decisions in the commit message.
- [ ] **Step 5: Run the file, then `menu-publication.test.ts`, `menu-document.test.ts`,
  `menu-schedule.test.ts`, `menu-patch.test.ts` (grep for its tests if named otherwise) and
  `packages/menu`'s suite.**
- [ ] **Step 6: Commit** — "Set menus: copy a set menu into each full menu when it is published, and refuse one that cannot be covered".

### Task 6: Serving the copies with the zone's offers

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`ServiceZoneOffers` `:827`, `listZoneOffers`
  `:835-896`, `menuState` `:937-987`), `packages/menu/src/menu-document.ts` (`readLiveState`,
  `applyLiveFields`, a new `documentSetMenuOffers` beside `documentOffers` `:496`, `:624-760`)
- Modify: `packages/shared/src/menu-document/menu-document-types.ts` (`ServedSetMenu`)
- Modify: `apps/till/src/api/client.ts` (`ZoneOffers`, `:446-461`: add the field, read nothing yet)
- Test: `packages/venue-service/src/zone-offers.set-menus.test.ts`

**Interfaces:**
- Produces:

```ts
export type ServedSetMenuOffer = LiveOffer & {
  countsAsCourseId: string | null;
  /** Each kept variant's counts-as course, by variant id. */
  variantCountsAs: Record<string, string>;
};
export interface ServedSetMenu {
  /** `${menuId}:${hash}`, `hash` the `menuDocumentHash` of the `PublishedSetMenu`, so the same
   * copy has the same key whichever versions hold it; piece 2 uses it as the fit's
   * `SetMenuOffer.id` and stores it on the bill. */
  key: string;
  menuId: string;
  /** The live versions of the served full menus holding this same copy, by code units. */
  versionIds: string[];
  /** True when a full menu holding this copy is orderable in the zone now. Piece 2 offers a new
   * set menu only from an orderable copy. */
  orderable: boolean;
  name: string;
  terms: SetMenuTerms;
  /** The copy's root members, for drawing its folder. */
  structure: DocumentList;
  offers: ServedSetMenuOffer[];
}
```

  and `ServiceZoneOffers.setMenus: readonly ServedSetMenu[]`: the `setMenus` copies of the zone's
  served documents, each offer passed through `applyLiveFields` like any offer, so `available` and
  the served `courseId` (which decides sending) are live while `countsAsCourseId` stays as copied.
  An offer whose copy has a `courseOverrideId` is served with that as its `courseId`, and so is
  each of its variants, over the live course (decision 9). Test it in `zone-offers.set-menus.test.ts`:
  `"a dish the set menu gives Starters is served with Starters, and its product's course change
  does not move it"`.
  Copies that are equal (same `menuDocumentHash` of the `PublishedSetMenu`) are served once, with
  every version that holds them in `versionIds`; different copies of one set menu, from two served
  full menus published at different times, are served one each (**my call**: each is what its full
  menu was published with). `listZoneOffers` serves the live documents of every period's menus
  and marks each `orderable` (`:835-896`), so at lunch Dinner's copy is served too, with
  `orderable: false` unless an orderable menu holds the same copy.
- **One fingerprint for both reads.** The till reloads when `menuState`'s fingerprint differs from
  the offers read's (`apps/till/src/till-app.ts:6883,6909`). `readLiveState` and `applyLiveFields`
  take whole documents and read offers through `documentOffers`, keyed by `document.menuId`.
  Leave `documentOffers` as it is: its other callers (`productsOfferedIn` and the empty-menu check,
  `operations.ts:349,925`; `routing-store.ts:764`; `shapeOf`'s diff, `menu-document.ts:816`) must
  not see set-menu dishes, or a surcharge would stand in for the full menu's price. Add
  `documentSetMenuOffers(document): SetMenuFrozenOffer[]` beside it, and an option on
  `readLiveState` and `applyLiveFields` only, under which both also read those offers, keyed by
  menu-item id. Both reads then fold the copies' dishes into the same fingerprint. Never wrap a copy
  as a document of its own: two copies of one set menu would overwrite each other. (Task 5's
  `routing-store` reader reads the copies through `documentSetMenuOffers`, not through
  `documentOffers`.) A dish
  only a set menu lists then changes the state when it sells out. A changed copy reaches the till
  as a new full-menu version, which the state already carries.
- When `listZoneOffers` is called with `menuItemIds` (every draft and line write does,
  `order-drafts.ts:1437`, `working-order.ts:564,576`), it serves no copies and answers
  `setMenus: []`; piece 2 adds its own read for set-menu dishes.
- The copies' offers stay out of `offers`, so the server's re-pricing by menu-item id
  (`offersFor`, `apps/server/src/order-drafts.ts:1429-1442`) refuses a set-menu dish until piece 2.

- [ ] **Step 1: Write the failing tests:**
  - `"a zone selling Lunch serves its copy of Daily menu"`: `setMenus` has one entry with
    `versionIds` `[Lunch's live version]`, `key` `${dailyMenu}:${hash of the copy}`, `orderable: true`,
    `terms.price "14.00"`, Soup's offer at `"0.00"` counting as Starters; `offers` holds no set-menu
    menu-item id.
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
  - `"a sold-out dish is unavailable in the copy"`.
  - `"a dish moved to another course after publishing is served with its new course and counts as
    its old one"`.
  - `"a read for named menu items serves no copies"`: with `menuItemIds` given, `setMenus` is `[]`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file, `packages/venue-service`'s suite, and `apps/server`'s till offers
  route tests (grep `default-service-zone/offers` under `apps/server/src/*.test.ts`).**
- [ ] **Step 5: Commit** — "Set menus: serve each full menu's set-menu copies with the zone's offers".

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
  → `{ details: SetMenuDetails; addedLines: SetMenuLine[] }`.
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
- **Dashboard refresh.** Add `set_menu_lines`, `set_menu_line_courses`, `set_menu_dish_courses`
  and `set_menu_variant_exclusions` to `MENU_PUBLICATION_READS` (`apps/dashboard/src/api/live-queries.ts:4-22`),
  so a change to a set menu refreshes the status and Preview of the full menus holding it; no guard
  catches a missing table here. `menuStatus` (`menu-publication.ts:216-227`) leaves set menus out,
  and the menus list shows no publication status for one (Task 8a).
- Status: `set_menu.not_found` 404; `set_menu.invalid`, `set_menu.dishes_only` 400 (or whatever
  status the map gives the nearest `menu_section.*` code); `set_menu.wrong_place`,
  `set_menu.not_publishable` 409.
- Client methods: `createMenu` (extended), `readSetMenu(menuId)`, `addSetMenuDishes(menuId, dishes)`,
  `saveSetMenuLines(menuId, lines)`,
  `saveSetMenuVariantChoices(menuId, itemId, variants)`, `copySetMenuDishes(menuId, fromMenuId)`,
  `placeSetMenu(sectionId, menuId)`.

- [ ] **Step 1: Write the failing route tests**, one per route: the answer's shape on success, and
  one refusal each with its status and code; plus `"publishing a full menu holding a set menu with a
  problem answers 409 set_menu.not_publishable"` and `"publishing a set menu itself answers 409
  set_menu.wrong_place"`, `"a change to a set menu's lines marks the full menu holding it as
  changed in menu status"`, and `"menu status lists no set menu"`. In the dashboard, one live-query
  test that a set-menu line change refreshes the full menu's Preview.
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
  - `set_menu.not_publishable`: "This menu can't be published yet: its set menu {name} has
    {count} problems, listed on the set menu's page. Fix them, then publish this menu." /
    «Este menú aún no se puede publicar: su menú a precio fijo {name} tiene {count} problemas,
    indicados en su página. Corrígelos y publica este menú.» (`{name}` looked up from `menuId`)
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
- The menus list shows a **Kind** column ("Menu" / "Set menu") and, for a set menu, its price and
  no publication status.
- `widgets/menu-preview.ts` and `strings.ts` word the `set_menu_changed` change and the
  `"set_menu"` source ("Daily menu (set menu): price changed", linking to its page).
- A set menu's editor has one tab, **Set menu** (`set-menu`, drawing `dashboard-set-menu-editor`),
  and no Publish (decision 3). Structure, Prices, Home page and Preview are not shown; a stored
  address naming one of those for a set menu opens **Set menu**. Under its heading the editor says
  where its changes go: "Changes reach the tills when you publish a menu that holds this set menu:
  Lunch, Dinner", each name linking to that menu's Preview, or "Place it in a menu to sell it" when
  no menu holds it (`menusContaining`, Task 3b; **my call** on wording).
- A full menu's **Preview** lists `setMenuProblems` above the publish button, each set menu's name
  linking to its page, and shows each `set_menu_changed` entry with that link instead of an undo.
- The editor's heading carries a `wt-help-tooltip` with `mode="help-mode"` (CLAUDE.md §3) that
  orients in a few sentences — a set menu is a fixed price for one of each of its lines; dishes
  with a surcharge cost that on top; place it in a menu to sell it — and links to the guide's
  `{#set-menus}` section (Task 11). Write it from the code as built.

- [ ] **Step 1: Write the failing tests** in `menus-screen.set-menu.test.ts`:
  `"Add menu offers Menu and Set menu"`; `"the list shows a set menu's kind and price"`;
  `"a set menu's editor has no Structure, Prices, Home page or Preview tab, and an old address for
  one opens Set menu"`; `"a set menu's editor names the menus that publish it, linking to each"`;
  `"a full menu's Preview lists its set menus' problems and a set-menu change links to the set
  menu"`;
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
  what a set menu is, creating one, its dishes and surcharges, giving a dish another course in
  the set menu (it counts as that course and is sent with it), variants, what one set menu
  includes, placing it in a menu, and that its changes reach the tills only when a menu that holds
  it is published. Remove any "set lunch" wording A1515-REMOVE left behind in these two files.
  Short; a sentence earns its place by changing what staff do (CLAUDE.md §3).

- [ ] **Step 1: Write the failing tests:** `"Add offers Set menu and places the chosen one"`;
  `"a placed set menu's row shows its price and opens its editor"`; `"the include picker leaves set
  menus out"`; `"the period dialog offers no set menu as a customer or staff menu"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them, and
  `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.**
- [ ] **Step 5: Look at it end to end** on Claude's stack: create Daily menu (€14) with Soup, Hake
  and Sirloin (+€5), place it in the full menu, publish the full menu, then read
  `GET /api/default-service-zone/offers` on the till's port and check `setMenus[0]` has
  `terms.price "14.00"` and Sirloin at `"5.00"`; change Sirloin to +€6 and check the read still
  says `"5.00"` until the full menu is published again. Record the request and the fields in the PR.
- [ ] **Step 6: Update `docs/backlog/menu.md`'s A1515 entry** to say piece 1 has landed and what is
  next, in the same commit.
- [ ] **Step 7: Commit** — "Set menus: place a set menu in a menu, and the set-up guide".

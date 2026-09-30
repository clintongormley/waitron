# Menus that include menus (slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every menu section belongs to one menu; a menu shares with another only by INCLUDING it,
as one folder. One rule settles each price and on/off switch across a combined menu, and a
disagreement blocks publishing until the menu decides. A home tile whose target has gone keeps
its place as an empty slot. The Sections screen, library sections and per-menu extras go.

**Architecture:** Server first, screens last. Per-menu extras come out first (they shrink what the
price rule must cover). On/off becomes three-state (on, off, or no setting of this menu's own).
Then the section schema is rebuilt so that every section has an owning menu, and a menu includes
another by placing the other menu's ROOT section in one of its own lists — the included menu's
root section already carries a customer name, image and colour, which become the folder's. A new
pure function combines a menu's own settings with those of the menus it includes and says where
each value came from; the published document freezes its result, so the till and the sale path
read the same fields as today. Home tiles learn an empty kind. The dashboard's menu editor absorbs
what the Sections screen did and shows where every price comes from.

**Tech Stack:** TypeScript, Hono (server routes), drizzle-orm + drizzle-kit on `node:sqlite`
(schema and migrations), Lit web components (dashboard and till), Vitest (node projects for
packages and server, real headless Chromium for the dashboard, the till and `packages/ui`).

**Spec:** [docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md](../specs/2026-09-30-catalogue-menus-routing-design.md),
§4, §6 "Slice 2" and §7 items 2 and 3 — with two owner decisions made while this plan was written
(2026-09-30):

- **Per-menu extras are dropped.** A menu offer carries every extras list its product carries, at
  the list's own item prices, exactly as options lists already travel. §7 item 2's "an extra's
  price on the menu" is therefore gone; the combined rule covers a product's price and each
  variant's price. (Before this, nothing outside tests could give a menu offer an extras list:
  `setMenuItemExtraLists` had no route, `docs/backlog.md` "A menu item created today offers its
  product's options lists and none of its extras lists".)
- **Every price the Prices tab shows says where it comes from**, in a tooltip, even when the menu
  overrides it: then the tooltip also says what the price would otherwise be.

Slices 1 (products and folders) and 3 (routing) are NOT in this plan.

## Decisions this plan takes (for the owner's approval)

The design left these to planning (§8) or did not reach them. Each is stated where it applies too.

- **P1. A menu includes another by placing the other menu's root section as a member of one of its
  own lists.** No new table. The folder shows the root section's customer name, image and colour,
  which become the MENU's customer-facing fields (edited with the menu's name). §7 item 3 falls
  out: the including menu cannot rename it.
- **P2. A section sits in exactly one place in its menu.** It is created in place ("New section
  here") and deleted in place; there is no picker of existing sections any more. Deleting a section
  deletes the sections inside it too (their products are placements, not deleted products).
- **P3. What counts as a "place" for the price rule.** A product found in the menu's own sections
  is one source; each menu this menu includes DIRECTLY and whose combined menu reaches the product
  is one source, carrying that menu's own combined answer. Menus included further down are that
  menu's business, so a chain Evening → Drinks → Wines asks Drinks, which asks Wines.
- **P4. A price set for a specific size beats a price set for the whole product, wherever each was
  set** (owner, 2026-10-01: "Variants are seldom the same price so we should respect the price of
  the variant"). It extends today's single-menu chain, where a variant's own catalogue price
  already beats the menu's price for its product. A size's price on a menu is: this menu's own
  price for the size; else the size-specific prices from the places it comes from (its own
  catalogue price, or an included menu's price for the size), which must agree or clash; else —
  nobody priced the size — it follows its product's price on this menu. So if Evening sets Lager
  to €4 and the Drinks menu it includes sets the pint (a size with no price of its own) to €3.80,
  Evening's pint is €3.80, no clash; and a menu whose own sections hold Lager (pint unpriced) and
  which includes that Drinks sells the pint at €3.80 too, no clash.
- **P5. A clash matters only for what the menu sells.** A price clash on an item the menu resolves
  to "switched off" is not reported and does not block publishing. An on/off clash always is. A
  product with sizes (variants) is never sold as itself, so its price clashes are reported per
  size only — one clash per size whose product AND size are decided "on" — never also for the
  product.
- **P6. A clash in an included menu is a clash in every menu that relies on it**, until the
  including menu sets its own value (the included menu's source is "undecided").
- **P7. The included menu's editor lists the menus that include it**, each with its number of
  clashes, linking to it (§8's last open point). Every menu's row in the menus list shows its
  clash count.
- **P8. An empty home slot is stored.** A tile row may hold no target, only the text to show the
  manager ("Missing: Drinks › Beer"). Deleting a section turns every tile pointing at it — in any
  menu's layouts — into such a row instead of deleting the tile, so no later tile moves.
- **P9. The published document keeps `format: 2`.** Code reading an older version still reads it,
  and a version is never rewritten. Most changes are additive (a new tile kind; prices whose
  meaning is unchanged — the price to charge). Two are not, and the pre-live rule (no
  backwards-compatibility code) applies to both: a frozen offer's `active` key becomes `offered`
  (nothing reads the frozen `active` today — the till never does), and the menu-state answer loses
  `extraItems` (Task 1). A till still running the older build must be reloaded after the update;
  the PR body says so.
- **P10. A deactivated menu includes nothing.** `offerRowsOn` already leaves a deactivated menu out
  (`packages/catalogue/src/operations.ts:523`). An inactive menu is not offered for inclusion, and
  an included menu that is inactive contributes no places: a product only it reached is not on the
  including menu. (`deactivateCatalogue` has no caller outside tests today, `operations.ts:739`.)

## Global Constraints

- Waitron is not live: no data migration and no backwards-compatibility code (CLAUDE.md §3). After
  this branch lands, every dev venue needs `wa-wt reset demo <worktree-name>` — library sections are
  deleted by the migration and menus lose what they held through them. Say so in the PR body. The
  one exception is deliberate and stated at its site (Task 3): the `sections` rebuild carries its
  child rows across by hand, because a plain rebuild FAILS on any venue with a menu (measured,
  Task 3), and a failed migration stops the box booting.
- **Slice 1 is being built at the same time**, on `feature/product-folders` (campaign lane D, item
  PF1). It adds catalogue migrations `0012`–`0014` and media `0004`, moves `isHexColor` and
  `mediaImageExists` from `categories.ts` into `sections.ts`, and edits `menu-document.ts`,
  `configuration-transfer.ts`, `menu-prices-table.ts`, `section-add-products.ts`,
  `apps/dashboard/src/api/live-queries.ts` and `scripts/schema-constraints.test.ts`. Whichever
  branch lands SECOND rebases and fixes the migration-number collision by regeneration, never by
  hand-editing snapshots or `_journal.json` (CLAUDE.md §3): reset each migrations folder to
  `main`'s state, re-run every `db:generate` and `db:generate:custom` of this plan in order, paste
  the custom SQL back, then run the five checks that rule names.
- Every commit: `git commit -s`, message in plain English (owner rule; name files and error codes
  once as pointers).
- Coverage `98/98/98/95` in every package touched; never close a gap with an exclude or ignore
  comment. The mutation-tested packages are `ui`, `ui-core`, `shared`, `fiscal` and `db`
  (`ls packages/*/stryker.config.json`); this plan touches none of their source except possibly
  `packages/ui` (no planned change), and `catalogue` has no mutation run.
- Every colour, spacing, radius and font reads a `--wt-*` token. Markup handed to `wt-data-table`
  as a cell is styled with `part=` / `::part()`, never a CSS class.
- Forms follow `docs/developers/design-system.md` → Forms: required fields visibly marked, a
  field's problem beside the field, a hint as the field's placeholder, and the form's refusal
  message at the BOTTOM of the form, left-aligned on its own line, never beside the buttons or in a
  dialog's pinned button bar (owner decision 2026-09-30).
- Error codes name the domain concept (`menu.*`, `menu_section.*`); before go-live a code may be
  renamed or deleted freely, and every copy in the tree moves in the same change (CLAUDE.md §3).
  Every file that throws a code imports its registry (`packages/catalogue/src/errors.ts`); HTTP
  statuses are in `apps/server/src/catalogue-api.ts` (`:254-266`); dashboard wording in
  `apps/dashboard/src/i18n/codes.ts`.
- Migrations: never edit a shipped migration file. Generate with
  `pnpm --filter <pkg> db:generate --name <name>`; hand-written SQL with
  `pnpm --filter <pkg> db:generate:custom --name <name>` (copy the breakpoint syntax from
  `packages/db/drizzle/0043_drop_triggers_before_rebuild.sql`). A custom file's LAST statement must
  not end in `--> statement-breakpoint`: the empty statement after it fails with
  `statement has been finalized` (hit by this plan's review). A drizzle-kit generate that sees one
  column removed and another added in the same table asks interactively whether it is a rename and
  crashes with stdin closed — split such a change into two generates. If a generated migration proposes a
  table rebuild (`__new_<table>`) the task did not predict, STOP: a rebuild's `DROP TABLE` deletes
  cascading children's rows and fails on a `no action` child holding rows (CLAUDE.md §3).
- Money: prices are compared by value with `compareDecimal` (`packages/shared/src/money.ts`), never
  as strings; stored as cents at the row (`packages/shared/src/cents.ts`).
- The published document type (`packages/catalogue/src/menu-document-types.ts`) and the menu-state
  answer are cross-package contracts: the till and `apps/dashboard` import the file by path, and
  `scripts/dashboard-browser-purity.test.ts` keeps it type-only. Keep it browser-safe. The home
  layout type is ALSO restated in `packages/module/src/module.ts:195-201` (`ZoneHomeLayout`, filled
  by `packages/venue-service/src/operations.ts:571`); change both together.
- A route whose answer gains data from another table adds that table to the route's entry in
  `apps/dashboard/src/api/live-queries.ts`, or the screen never refreshes when it changes; run
  `scripts/live-subscriptions.test.ts` and `apps/dashboard/src/api/live-queries.test.ts` in any task
  that changes a route's answer.
- Browser suites: check `memory_pressure | grep free` before a browser run; do not start one beside
  a whole-workspace `pnpm -r test:coverage`.
- Run focused tests while implementing; CI runs the package suites. Do not hand-run the pre-push
  checks before pushing.

## Review Focus

These inputs are the likeliest to hurt a manager and are pinned by tests in the tasks named:

1. **A cycle of inclusions** — A includes B which includes A; a menu including itself; A including
   B from a section nested three levels down while B already includes A. Refused with
   `menu_section.member_cycle` whatever the screen sends; the screen never offers a menu that would
   make one. (Tasks 3, 7)
2. **The design's worked example, and the variant rule (P4).** Drinks sets Lager to €3.50;
   Afternoon includes Drinks and places Lager in its own Specials at the product's €3.00 → a clash
   naming both; Evening includes only Drinks → €3.50, no clash; Afternoon then sets €3.50 → no
   clash on Lager or on its variant with no price of its own. An override EQUAL to an included
   price still counts as the menu's own decision. (Task 4)
3. **An edit in one menu creating a clash in another.** Changing Drinks' price creates a clash in
   Afternoon: Afternoon's status shows it, publishing Afternoon is refused with
   `menu.clashes_unresolved`, Drinks still publishes, and Drinks' editor lists Afternoon with 1
   clash. (Tasks 4, 7, 8)
4. **A section deleted while another menu's home tile points at it.** Drinks deletes Beer;
   Evening's Counter layout had a Beer tile in position 2 of 4 → after publishing Evening, the till
   draws positions 1, blank, 3, 4, and the editor shows "Missing: Drinks › Beer". (Tasks 5, 6, 9)
5. **Upgrading a venue that already has menus.** Every member row and every `menu_details` row
   outside a library section survives the `sections` rebuild, library sections are gone, media's
   four section-image triggers exist afterwards, and a menu still publishes. (Task 3)
6. **A product reached only through an included menu is sold at the combined price** through the
   real sale path (`till-api.sell-published.test.ts`), not only in the document. (Task 4)

---

## File structure

**Created**

- `packages/catalogue/drizzle/00NN_drop_menu_extras.sql` (generated) — drops
  `menu_item_extra_items`, `menu_item_extra_lists`.
- `packages/catalogue/drizzle/00NN_menu_offered_three_state.sql` (generated) — adds
  `menu_items.offered`; rebuilds the leaf `menu_item_variant_overrides` with a nullable `offered`.
- `packages/catalogue/drizzle/00NN_drop_menu_items_active.sql` (generated) — drops
  `menu_items.active`.
- `packages/catalogue/drizzle/00NN_sections_owned_prepare.sql` (custom),
  `00NN_section_members_missing_name.sql` and `00NN_sections_owned.sql` (generated),
  `00NN_sections_owned_restore.sql` (custom) — the `sections` / `section_members` rebuild and the
  rows carried across it.
- `packages/media/drizzle/00NN_recreate_section_image_triggers.sql` (custom).
- `packages/catalogue/src/menu-combine-types.ts` (types only) and `menu-combine.ts` +
  `menu-combine.test.ts` — the pure combined rule.
- `packages/catalogue/src/menu-inclusion.ts` + `.test.ts` — which menus a menu includes directly,
  which places hold a product, which menus may be included without a cycle.
- `scripts/menu-sections-upgrade.test.ts` — the `sections` rebuild on a venue that has rows.
- `apps/dashboard/src/widgets/section-details-form.ts` + `.test.ts` + `.a11y.test.ts` — internal
  name, customer names per language, image, colour; used for a section and for a menu.
- `apps/dashboard/src/widgets/price-source.ts` + `.test.ts` — the tooltip wording for where a price
  comes from.

**Deleted**

- `apps/dashboard/src/screens/sections-screen.ts` and its tests.
- `packages/catalogue/src/extra-contract.ts`'s `MenuExtraPublication` / `parseMenuExtraPublications`;
  `extras.ts`'s `setMenuItemExtraLists`, `dropStaleMenuOverrides` and their helpers;
  `extra-projection.ts`'s `readMenuExtras`.
- `packages/catalogue/src/sections.ts`'s `listSections`, `duplicateSection`, `sectionUsages`,
  `librarySectionUsages` (and routes); `section-members.ts`'s `requireLibrary`.

**Modified (main ones)** — each task lists its own exactly.

- `packages/catalogue/src/schema/{sections,menu,variant-overrides,extras}.ts`, `section-types.ts`,
  `sections.ts`, `section-members.ts`, `section-graph.ts`, `menu-structure.ts`, `operations.ts`,
  `variants.ts`, `offered-modifiers.ts`, `menu-document.ts`, `menu-document-types.ts`,
  `menu-types.ts`, `menu-publication.ts`, `home-layouts.ts`, `errors.ts`,
  `configuration-transfer.ts`, `classification.ts`, `test/menus-fixture.ts`
- `apps/server/src/catalogue-api.ts`, `apps/server/src/testing/zone-offers.ts`,
  `apps/server/scripts/demo-seed/seed-catalogue.ts`
- `packages/media/src/images.ts`, `packages/media/src/dashboard/image-library.ts`
- `apps/till/src/widgets/menu-browser.ts`, `apps/till/src/state/menu-refresh.ts`, `till-app.ts`
- `apps/dashboard/src/screens/menus-screen.ts`, `widgets/{member-list-editor,menu-structure-tree,menu-prices-table,home-layout-editor,menu-preview,add-to-menus}.ts`,
  `screens/catalogue-screen.ts`, `screens/modifiers-screen.ts`, `dashboard-app.ts`,
  `navigation.ts`, `api/client.ts`, `api/live-queries.ts`, `i18n/strings.ts`, `i18n/codes.ts`

---

### Task 1: A menu offer carries its product's extras lists

Per-menu extras are dropped (owner decision above). An offer's extras lists become the product's
own, at `extra_list_items.price`, else the extra product's own price — the path an offer without a
menu already takes (`readProductExtras`, `packages/catalogue/src/extra-projection.ts:148-191`).

**Files:**
- Modify: `packages/catalogue/src/schema/extras.ts` (delete `menuItemExtraLists`,
  `menuItemExtraItems` :78-143 and their comments :36-39, :72-77, :104-114)
- Modify: `packages/catalogue/src/extras.ts` (`resolveExtraPrice` :32-38 loses `menuPrice`;
  `listExtraLists` :102-110 loses `usage.menus`; delete `dropStaleMenuOverrides` :284-298 and its
  call :332; delete `setMenuItemExtraLists` :426-462 with `assertPublishedListsExist`,
  `assertProductCarries`, `offeredKey`, `assertProductsOffered` :348-416; `extraListDependants`
  :475-496 loses its `menus` half; the comments at :228-231 and :338)
- Modify: `packages/catalogue/src/extra-contract.ts:80-139` (delete the menu publication parser;
  keep `extraPrice`)
- Modify: `packages/catalogue/src/extra-projection.ts` (delete `readMenuExtras` :90-146, `key`
  :20-21, `menuPrice` in `Candidate` / `borrowedUnitPrices` / `priceItems` :23-66)
- Modify: `packages/catalogue/src/offered-modifiers.ts` (`walkAttachedModifiers` :41-90 reads
  `readProductExtras` for every dish, keyed by product, as `optionsByProduct` already is; comments
  :32-37, :155-171)
- Modify: `packages/catalogue/src/menu-document.ts` (import :9; `LiveRows.withdrawn` and `itemKey`
  :354-358; `readLiveRows`' withdrawn query :371-421; `readUnavailable`'s `extraItems` :437-466;
  `applyLiveFields` :546-548)
- Modify: `packages/catalogue/src/menu-document-types.ts:193-194` and
  `packages/module/src/module.ts:242-247` (delete `extraItems` from `MenuUnavailable` and
  `ZoneUnavailable` — a field that could only ever be empty); `apps/till/src/till-app.ts:732-734`,
  `apps/till/src/state/menu-refresh.ts:63-67`
- Modify: `packages/catalogue/src/menu-structure.ts:6,163-164` (the reset no longer deletes extras
  rows); `modifier-list-types.ts:76-80,90-94`; `classification.ts:20-21`;
  `configuration-transfer.ts:17-18`
- Modify: `apps/server/src/testing/zone-offers.ts:7,12,85-104`
- Modify: `apps/dashboard/src/api/live-queries.ts:10-11,156-159`,
  `apps/dashboard/src/screens/modifiers-screen.ts:341-345,530` and its "menu items" strings in
  `i18n/strings.ts` (English and Spanish): Used by lists products only
- Modify (guards): `scripts/schema-constraints.test.ts:100-103,410`
- Modify (docs): `docs/modifiers.md:64-67,72-82`, `docs/products.md:158`,
  `docs/developers/modifiers.md:97-113,229,301-304,444`, `docs/developers/products.md:273-274`;
  `docs/backlog.md` — close "A menu item created today offers its product's options lists and none
  of its extras lists" and "Are per-menu extras worth keeping at all?" with a dated note (owner:
  drop, 2026-09-30), and re-read :1124, :1624-1628, :1657-1690, :1728, :1776-1810 for claims the
  drop retires
- Create (generated): `packages/catalogue/drizzle/00NN_drop_menu_extras.sql`
- Tests: see Steps 1 and 4.

**Interfaces:**
- Produces: `resolveExtraPrice(item, product)`; `MenuUnavailable` / `ZoneUnavailable` without
  `extraItems`; `ExtraListRow.usage` and `ExtraListDependants` without `menus`.

- [ ] **Step 1: Write the failing tests**

In `packages/catalogue/src/offered-modifiers.test.ts`, turn :362 ("omits an extras list the offer
does not publish, and keeps the options list") into its opposite:

```ts
it("offers every extras list the product carries, at the list's prices, beside its options", async () => {
  // A product carrying an extras list (item price 0.40 over a 0.50 product) and an options list,
  // placed on a menu with no further setup.
  const offer = (await listMenuOffers(tx, [menuId])).find((o) => o.productId === lemonade)!;
  expect(offer.offeredModifiers.map((m) => m.kind)).toEqual(["extras", "options"]);
  const extras = offer.offeredModifiers.find((m) => m.kind === "extras")!;
  expect(extras.items.map((i) => [i.productId, i.price])).toEqual([[extraLemon, "0.40"]]);
});
```

(Use the file's own fixture and helper names — read its top; the names above stand for them. The
order must be the product's `product_modifiers.sort` order.)

In `packages/catalogue/src/migrations.test.ts`, assert neither table exists:

```ts
it("has no per-menu extras tables", async () => {
  const rows = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name in ('menu_item_extra_lists', 'menu_item_extra_items')`,
  );
  expect(rows.rows).toEqual([]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/offered-modifiers.test.ts src/migrations.test.ts`
Expected: FAIL — the offer carries no extras list, and both tables exist.

- [ ] **Step 3: Remove per-menu extras**

Delete the two tables from `schema/extras.ts`, then:

```bash
pnpm --filter @waitron/catalogue db:generate --name drop_menu_extras
```

Expected: two `DROP TABLE` statements and nothing else. Nothing outside the two tables points a key
at them, and no trigger names them (grep `drizzle/*.sql` for both names to confirm before
committing).

Make the code changes listed under Files. `walkAttachedModifiers` calls `readProductExtras(tx,
productIds, attachments)` once for every dish; `readOfferedModifiers` looks extras up by
`productId`, like options. `resolveExtraPrice` is `item.price ?? product?.unitPrice`.

- [ ] **Step 4: Fix the remaining tests and run them**

Delete the tests that only exercised per-menu extras and rewrite the ones that keep an assertion
(the research list, all on `main` as of 2026-09-30):

- Delete: `extra-projection.test.ts` `readMenuExtras` cases (:131, :154, :177, :205, :236, :245,
  :265, :280, :372), every `setMenuItemExtraLists` refusal (:436-644), the stale-override cases
  (:664, :687, :715), :745, :761, :793, :806; `offered-modifiers.test.ts:335`;
  `extra-contract.test.ts` `parseMenuExtraPublications` (:535), and reduce the `resolveExtraPrice`
  cases (:508-531) to two arguments; `migrations.test.ts:656,669` (and their entries at :104,
  :254); `menu-document.test.ts`'s withdrawn rows (:179, the :295 hash table, :505-507);
  `venue-service/src/operations.test.ts:2309` and the extras part of :2156.
- **Rewrite, keeping what it asserts:** `apps/server/src/working-order.test.ts:1631` "keeps extras
  rows and customisation on a quantity-only edit" is the guard CLAUDE.md §3 names — replace
  `update menu_item_extra_items set price = 400` (:1674) with a raise of `extra_list_items.price`,
  and the same in `parkWithExtra` (:1750), :1412, :2739, :5873; `working-order.test.ts:5910`
  (rewrite with an Unavailable extra product, or delete if it then repeats another case);
  `till-api.test.ts:3555` (a list price, not a menu price, of 0.35) and :3644 (a list the product
  carries is now on offer); `menu-structure.test.ts:354` block (`expectFresh` :446-448 now expects
  the product's lists; `settingsOf` :140-147 loses `extraLists`/`extraItems`);
  `apps/server/src/configuration-transfer.test.ts:612` (:697-733); `testing-zone-offers.test.ts:150,184`;
  `till-api.sell-published.test.ts:525,891` (drop the "withdrawn from the offer" halves);
  `extras.test.ts:360,369,403`; the dashboard `modifiers-screen.test.ts` menu-row cases (:608, :951,
  :980, :1072, :1131, :1504, :1524) and `live-queries.test.ts:75`; the till fixtures spelling
  `extraItems: []`.
- Keep, dropping only the setup call: `till-api.sell-published.test.ts:493,630`,
  `served-at-huella.test.ts:594`, `till-api.fiscal-sale-paths.test.ts:2195`,
  `media/src/images.test.ts:930`, `extras.concurrency.test.ts:189` (read through
  `readProductExtras`), `menu-publication.test.ts:769`, `menu-document.test.ts:883`,
  `venue-service` :1809, `catalogue/test/menus-fixture.ts:163`.

Run: `pnpm --filter @waitron/catalogue --filter @waitron/venue-service exec vitest run`
Run: `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/till-api.test.ts src/till-api.sell-published.test.ts src/configuration-transfer.test.ts src/testing`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/modifiers-screen src/api/live-queries`
Run: `pnpm --filter @waitron/till exec vitest run src/state src/till-app`
Run: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/errors-reachable.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts`
Run: `pnpm -r --filter @waitron/catalogue --filter @waitron/module --filter @waitron/venue-service --filter @waitron/server --filter @waitron/dashboard --filter @waitron/till typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A packages apps scripts docs/modifiers.md docs/products.md docs/developers docs/backlog.md
git commit -s -m "A menu offer carries its product's extras lists; per-menu extras are dropped"
```

---

### Task 2: A menu's on/off has three states

Today `menu_items.active` is on or off, defaulting to on, so "this menu has no setting of its own"
cannot be told from "this menu says on". The combined rule (Task 4) needs the difference: a menu
that includes Drinks follows Drinks unless it says otherwise. The same holds for a variant's
`offered` in `menu_item_variant_overrides`.

`menu_items` must NOT be rebuilt: it has cascading children (`menu_item_variant_overrides`) and a
`no action` key from `working_line_contexts.menu_item_id` (`packages/venue-service/src/schema/service.ts:284,314-318`),
so a rebuild empties the one and fails on any venue that has sold (CLAUDE.md §3). `flag` columns
carry no CHECK (`packages/db/src/schema/columns.ts:146`), so a new nullable column can be added and
the old one dropped with `ALTER TABLE`. `menu_item_variant_overrides` is a leaf (nothing points a
key at it, no trigger names it — confirm by grep), so its generated rebuild carries its own rows.

**Files:**
- Modify: `packages/catalogue/src/schema/menu.ts:73-98` (`offered: flag("offered")`, nullable, then
  delete `active`)
- Modify: `packages/catalogue/src/schema/variant-overrides.ts:11-43` (`offered` nullable, no
  default; check `price is not null or offered is not null`)
- Create (generated): `00NN_menu_offered_three_state.sql`, `00NN_drop_menu_items_active.sql`
- Modify: `packages/catalogue/src/menu-types.ts` (`MenuItem.active: boolean` →
  `offered: boolean | null`; `MenuOfferVariant.offered` stays the RESOLVED boolean, plus
  `ownOffered: boolean | null`)
- Modify: `packages/catalogue/src/operations.ts` (`offerRowsOn` :524 filter becomes
  `offered is not false`; `updateMenuItem` / `writeMenuItemSettings` :342-369 take
  `offered: boolean | null`; `readOfferVariants` :650-712 `row.offered ?? true` stays the resolved
  value and `ownOffered` is the raw one); `packages/catalogue/src/variants.ts:321-375`
  (`setMenuVariants` accepts `offered: boolean | null`; a row is written only while it sets a price
  or an `offered`)
- Modify: `packages/catalogue/src/menu-structure.ts:159-173` (the reset writes `offered: null`)
- Modify: `apps/server/src/catalogue-api.ts:965-1015` (`PATCH …/items/:itemId` body
  `{ grossPrice?: string | null, offered?: boolean | null }` — `active` is refused as a retired field
  with `management.request_invalid {field: "active"}`; the variants body's `offered` may be null)
- Modify: `apps/dashboard/src/api/client.ts:1658-1682` and `widgets/menu-prices-table.ts`
  (:590-592 sends `active` on EVERY save) + `screens/menus-screen.ts:1428-1450` — send `offered`
  only when the manager changed the switch, for the product and for each variant; an unchanged
  switch sends nothing, so a save never turns "no setting" into an explicit "on" (Task 8 adds the
  visible "no setting" choice)
- Tests: `packages/catalogue/src/menu-structure.test.ts` (:565+ "a menu's own switch"),
  `variants.db.test.ts:515-672`, `variants.test.ts`, `migrations.test.ts`,
  `apps/server/src/catalogue-api.test.ts:1475,3587,3645,4095,4114`, the dashboard
  `menu-prices-table` and `menus-screen` suites

**Interfaces:**
- Produces: `menu_items.offered` (null = no setting of this menu's own); `MenuItem.offered`;
  `updateMenuItem(tx, menuId, itemId, { grossPrice?, offered? })`; variant override `offered:
  boolean | null`.

- [ ] **Step 1: Write the failing tests**

`packages/catalogue/src/menu-structure.test.ts`, in "a menu's own switch for a product":

```ts
it("records no setting of its own until the menu makes one, and can clear it again", async () => {
  // `itemOf` (:700) returns the menu item's ID; read the row itself.
  const itemId = await itemOf(fx.lunch, fx.lemonade);
  const offered = async () =>
    (await fx.db.select({ offered: menuItems.offered }).from(menuItems).where(eq(menuItems.id, itemId)))[0].offered;
  expect(await offered()).toBeNull();
  await app((tx) => updateMenuItem(tx, fx.lunch, itemId, { offered: false }));
  expect(await offered()).toBe(false);
  await app((tx) => updateMenuItem(tx, fx.lunch, itemId, { offered: null }));
  expect(await offered()).toBeNull();
  // No setting of its own still sells: the offer is listed.
  expect((await app((tx) => listMenuOffers(tx, [fx.lunch]))).map((o) => o.productId)).toContain(fx.lemonade);
});
```

`packages/catalogue/src/variants.db.test.ts`: a variant row holding `price = null, offered = null`
is refused by the check; `offered = null` with a price is accepted.

`packages/catalogue/src/migrations.test.ts`: `pragma_table_info('menu_items')` names `offered` and
not `active`, and `offered`'s `notnull` is 0.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/menu-structure.test.ts src/variants.db.test.ts src/migrations.test.ts`
Expected: FAIL — `item.offered` is undefined and the column is `active`.

- [ ] **Step 3: Migrate in two generated steps, then change the code**

Add `offered` to `menu_items` (keep `active` for now) and make the variant override's `offered`
nullable with the new check, then:

```bash
pnpm --filter @waitron/catalogue db:generate --name menu_offered_three_state
```

Expected: `ALTER TABLE menu_items ADD offered integer;` and one rebuild, of
`menu_item_variant_overrides` ONLY. If `menu_items` is rebuilt, stop (see the task header). Delete
`active` from the schema, then:

```bash
pnpm --filter @waitron/catalogue db:generate --name drop_menu_items_active
```

Expected: `ALTER TABLE menu_items DROP COLUMN active;` and nothing else. (Two steps, because
drizzle-kit asks interactively whether a removed and an added column in one step are a rename.)

Change the code under Files. Until Task 4, `offered: null` behaves as on. A variant override row
that holds a price keeps `offered = 1` through the rebuild (measured by this plan's review), which
now reads as an explicit "on"; with no data migration (pre-live), the PR's `wa-wt reset demo` note
covers it, as it covers `menu_items.active = 0` rows becoming `offered = null` (sold).

- [ ] **Step 4: Fix the remaining tests and run them**

Run: `pnpm --filter @waitron/catalogue exec vitest run`
Run: `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/till-api.sell-published.test.ts`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-prices-table src/screens/menus-screen`
Run: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts`
Run: `pnpm -r --filter @waitron/catalogue --filter @waitron/server --filter @waitron/dashboard typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A packages/catalogue apps/server apps/dashboard scripts
git commit -s -m "A menu's on/off for a product or variant can be left unset, so an included menu can decide it"
```

---

### Task 3: Every section belongs to one menu, and a menu can include another

Library sections go (`sections.role = 'library'`, `packages/catalogue/src/schema/sections.ts:19-27`).
Every section has an owning menu (P2), and a menu includes another by placing the other menu's
root section in one of its own lists (P1). The root section's customer names, image and colour
become the menu's customer-facing fields.

**Why the rebuild carries rows across by hand** (measured 2026-09-30 on `node:sqlite`, Node
v26.7.0, inside `BEGIN … COMMIT` with `foreign_keys` on, the create-copy-drop-rename sequence
drizzle generates, on a copy of `0007`/`0008`'s tables holding a menu, its root, its layout, an
owned list and a library section): with library rows deleted first, the plain rebuild failed
`FOREIGN KEY constraint failed` (the `no action` key `menu_details.root_section_id`); with
`menu_details` also emptied it succeeded and left `section_members` with 0 of its 5 rows, raising
nothing; a trigger on another table whose BODY reads the rebuilt table failed the rename with
`no such table: main.<table>` — media's `sections_media_image_fk_parent_delete` and
`_parent_rename` are that shape. Copying `section_members` and `menu_details` aside, emptying them,
rebuilding, and restoring kept every non-library row, and `PRAGMA foreign_key_check` returned
nothing. This plan's review then ran the whole sequence below through the repository's own
`applyMigrations` on a venue holding two menus, a library section with an image, members, a layout
tile and a variant override (Node v26.7.0, SQLite 3.53.4): library rows went, every other member
row and both `menu_details` rows survived, media's four triggers were back, `foreign_key_check`
was empty and no `__keep_*` table remained; the control without the carry failed
`FOREIGN KEY constraint failed` and rolled the whole set back. Pre-live rules forbid data
MIGRATION; this carries rows across a rebuild so the migration does not fail, and says so at its
site.

**Files:**
- Modify: `packages/catalogue/src/schema/sections.ts` (`role` enum
  `["section","menu_root","home_layout"]`, default `'section'`; `owner_menu_id` not null; drop
  `sections_owner_ck`; `section_members` gains `missing_name: label("missing_name")` and its
  `one_ref_ck` becomes: at most one of `product_id` / `child_section_id`, and
  `(product_id is null and child_section_id is null) = (missing_name is not null)` — the empty
  home tile of Task 5)
- Create (custom): `packages/catalogue/drizzle/00NN_sections_owned_prepare.sql`; (generated)
  `00NN_section_members_missing_name.sql` and `00NN_sections_owned.sql`; (custom)
  `00NN_sections_owned_restore.sql` — in that order
- Create (custom): `packages/media/drizzle/00NN_recreate_section_image_triggers.sql`
- Create: `scripts/menu-sections-upgrade.test.ts`
- Create: `packages/catalogue/src/menu-inclusion.ts` + `.test.ts`
- Modify: `packages/catalogue/src/section-types.ts:1-45` (`SectionRole`; `LibrarySection` is
  renamed `SectionDetails` — what `readSection`, `updateSection` and `createSectionIn` return — and
  `LibrarySection` stays exported as an alias of it, with `SectionUsages`, until Task 7 deletes both
  with their dashboard users: the dashboard imports them and must keep typechecking)
- Modify: `packages/catalogue/src/sections.ts` (delete `listSections` :123, `duplicateSection` :307,
  `sectionUsages` :382, `librarySectionUsages` :410; `createSection` :161 becomes
  `createSectionIn(tx, listId, input, position?)` — creates a `section` owned by the list's menu and
  places it, in one transaction; `updateSection` :178 edits a `section` only; `deleteSection` :202
  deletes the section and every `section` below it — Task 5 adds the tile conversion; `addMember`
  :218 and `replaceMember` :287 with `kind: "section"` accept ONLY a `menu_root` (an inclusion);
  `replaceMember` and `removeMember` refuse the row of an owned `section`, which would leave it with
  no place — delete the section instead)
- Modify: `packages/catalogue/src/section-members.ts` (`requireLibrary` :40 deleted. `checkRef`
  :69-83 is shared by structure lists AND by `addShortcut` (`home-layouts.ts:238`), so the new
  rules are split: `checkListRef` in `sections.ts:107-120` (a root or a `section` list) accepts a
  section ref only when it is a `menu_root`, then runs `wouldCreateCycle` — so a menu's OWN root is
  refused by the cycle check with `menu_section.member_cycle`, not by a role check; `checkRef` for a
  home layout accepts a `section` or a `menu_root` and refuses a `home_layout`, reach staying with
  `structuralReach`. Rewrite `checkRef`'s header comment, which argues layouts need no cycle check
  because only library sections can be tiles)
- Modify: `packages/catalogue/src/section-graph.ts` (keep `wouldCreateCycle` :92-103,
  `menusContaining` :153-166 — both already walk through a root placed as a child, read by this
  plan's review; `toSectionMember` :30-38 is changed in Task 5)
- Modify: `packages/catalogue/src/menu-structure.ts` (`createMenuShell` :23-39 takes the menu's
  customer names/image/colour; `readMenuStructure` :83 returns each section node's
  `internalName, names, image, color, ownerMenuId` and, for an included menu, `includedMenuId`; the
  structure also returns `includable: {id, name}[]` — active menus other than this one whose
  inclusion would make no cycle (P10) — and `includedBy: {id, name}[]`, the menus that include
  this one directly)
- Modify: `packages/catalogue/src/operations.ts` (`createCatalogue` :285 and `renameCatalogue`
  :722-737 → `updateMenuDetails(tx, menuId, {name?, names?, image?, color?})` writing
  `catalogues.name` and the root section)
- Modify: `packages/catalogue/src/content-languages.ts:73-78,104-105` (the comment says only
  library sections are reported — rewrite it too; the translation gap report reads
  `from sections where role = 'library'` as kind `library_section`, which would match nothing: read
  `role in ('section', 'menu_root')`, and rename the kind `menu_section`; a menu's customer names
  are its root's) and `docs/developers/products.md:202-204`, which describes it
- Modify: `packages/catalogue/src/errors.ts:115-127` (`menu_section.not_library` →
  `menu_section.wrong_role` {sectionId, role}, keeping `sectionId` as its siblings do);
  `apps/server/src/catalogue-api.ts:254-266`, `apps/dashboard/src/i18n/codes.ts:70-106`
- Modify: `apps/server/src/catalogue-api.ts` (`mountSectionRoutes` :491-615: delete `GET /sections`,
  `GET /sections/usages`, `POST /sections`, `POST /sections/:id/duplicate`,
  `GET /sections/:id/usages`; add `POST /management-api/sections/:listId/sections` body
  `{internalName, names?, image?, color?, position?}` → 201 `{id}`; `PATCH /catalogues/:id` and
  `POST /catalogues` take `{name, names?, image?, color?}`, checked like `sectionInput` :180-205)
- Modify: `apps/dashboard/src/api/live-queries.ts:109` (`getMenuStructure` gains `catalogues`: its
  answer now names menus in `includable` / `includedBy`)
- Modify: `packages/media/src/images.ts:49,187-191,610-612` (a section usage carries its
  `ownerMenuId`); `packages/media/src/dashboard/image-library.ts:28-33` (link
  `/manage/menus/menu/<ownerMenuId>/view/structure`; a root section's photo is the menu's) and its
  test (:736)
- Modify: `packages/catalogue/test/menus-fixture.ts` — Drinks becomes its own MENU, "Drinks",
  whose root holds Lemonade and an owned Beer section holding Lager; Lunch and Dinner each include
  Drinks; Mains is Dinner's own section. Keep every name distinct, as the fixture's header asks.
- Modify: `apps/server/src/configuration-transfer.test.ts:789-883` (the catalogue list itself is
  unchanged)
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts:104-193` and `menu.ts:50-52` (each
  category's section is created in place with `createSectionIn`; `sectionName` exists only for
  library-unique names — drop it if nothing else needs it) and `seed-catalogue.test.ts:78-115`
- Modify (guards): `scripts/schema-constraints.test.ts:491` (remove `sections_owner_ck`);
  `scripts/behavioural-triggers.test.ts:106-109` (the four section trigger names stay; confirm)
- Tests: `sections.test.ts`, `sections.db.test.ts`, `section-graph.test.ts`,
  `menu-structure.test.ts`, `home-layouts.test.ts`, `menu-document.test.ts`,
  `menu-publication.test.ts` (the shared-edit group :542-690 becomes an included-menu group),
  `content-languages.test.ts`, `migrations.test.ts`, `operations.test.ts:52,1208` (calls
  `renameCatalogue`), `apps/server/src/catalogue-api.test.ts` (:3537, :4314-4740), and the suites
  outside catalogue that call `createSection`: `packages/venue-service/src/operations.test.ts:17,196,2367`,
  `apps/server/src/till-api.sell-published.test.ts:29,232`,
  `packages/media/src/image-references.test.ts:17,247,254` and `packages/media/src/images.test.ts:789-797`.
  `home-layouts.test.ts:297-309` today expects `not_library` for
  `[lunchRoot, counter, dinnerRoot, dinnerHome]`; under the split `checkRef` the two top-level
  lists pass the role check and are refused `menu.shortcut_unreachable`, and the two layouts
  `menu_section.wrong_role` — rewrite it to exactly that

**Interfaces:**
- Produces: `SectionRole = "section" | "menu_root" | "home_layout"`; `SectionDetails`;
  `createSectionIn(tx, listId, {internalName, names?, image?, color?}, position?) → SectionDetails`;
  in `menu-inclusion.ts`, over the loaded `SectionGraph` — which today holds no menu name or
  active flag (`section-graph.ts:5-27`, `loadSectionGraph` :69-83), so `loadSectionGraph` also
  reads `catalogues(id, name, active)` and `SectionGraph` gains `menu(menuId) → {name, active} |
  undefined`: `includedMenus(graph, menuId) → string[]`
  (DIRECT inclusions of ACTIVE menus, in the order a depth-first walk of the menu's own lists in
  member order first reaches them — the walk `placementsByProduct` does); `placesOf(graph, menuId,
  productId) → { own: boolean; via: string[] }` (whether the menu's own sections hold it, and which
  directly included menus reach it, same order); `includableMenus(graph, menuId) → string[]`;
  `updateMenuDetails`; structure nodes with `includedMenuId`.
- Consumes: nothing from Tasks 1-2 beyond the schema they leave.

- [ ] **Step 1: Write the failing tests**

`scripts/menu-sections-upgrade.test.ts` (root project; mirror `scripts/migration-upgrade.test.ts`'s
staging — copy each set's migrations folder with its `_journal.json` cut short):

```ts
it("keeps a menu's lists, members and layout across the sections rebuild, and drops the library", async () => {
  // Stage every set's migrations up to the entry BEFORE catalogue's `*_sections_owned_prepare`
  // AND media's up to the entry before `*_recreate_section_image_triggers` — left in, media's
  // file runs as a no-op on the first pass, is recorded as done, and the triggers catalogue then
  // drops never come back (run by this plan's second review: `triggers []`, no error). Apply
  // them, then insert: a menu with its root and home layout (as createMenuShell writes
  // them), a root member holding a product (Soup), a library section placed in the root, a media
  // image and a library section using it. Then apply every set's full folder.
  expect(membersOfRoot).toEqual([{ productId: soup }]); // the library placement is gone
  expect(await count("menu_details")).toBe(1);
  expect(await rolesOf("sections")).toEqual(["home_layout", "menu_root"]);
  expect(await triggerNames("sections_media_image_fk_%")).toEqual([
    "sections_media_image_fk_insert",
    "sections_media_image_fk_parent_delete",
    "sections_media_image_fk_parent_rename",
    "sections_media_image_fk_update",
  ]);
  expect(await foreignKeyCheck()).toEqual([]);
  // The recreated triggers still refuse: a section naming an image the library does not hold.
  await expect(insertSectionWithImage("nowhere.jpg")).rejects.toThrow(/sections_media_image_fk/);
  // And the menu still publishes.
  await expect(publishThroughCatalogue(menuId)).resolves.toMatchObject({ number: 1 });
});

it("fails without carrying the rows across (the control)", async () => {
  // The same staging and rows, with a copy of the catalogue folder whose prepare file omits the
  // four `__keep`/`DELETE` statements (two `CREATE TABLE __keep_*`, two `DELETE`): applyMigrations refuses, naming a foreign key failure, and
  // the catalogue journal is unchanged.
});
```

State in its header, as CLAUDE.md §7 asks for a guard weaker than its name: it checks one venue
shape; it does not check that a LATER rebuild of `sections` carries its rows.

`packages/catalogue/src/menu-inclusion.test.ts` — Review Focus 1 (load the graph with the file's
own helper; `includable` below stands for `includableMenus(await loadSectionGraph(tx), id)`):

```ts
it("refuses every inclusion that would make a menu include itself", async () => {
  await app((tx) => addMember(tx, lunchRoot, section(drinksRoot))); // Lunch includes Drinks
  const deep = await app(async (tx) => {
    const a = (await createSectionIn(tx, drinksRoot, { internalName: "A" })).id;
    const b = (await createSectionIn(tx, a, { internalName: "B" })).id;
    return (await createSectionIn(tx, b, { internalName: "C" })).id;
  });
  await expect(app((tx) => addMember(tx, deep, section(lunchRoot)))).rejects.toMatchObject({
    code: "menu_section.member_cycle",
  });
  await expect(app((tx) => addMember(tx, drinksRoot, section(drinksRoot)))).rejects.toMatchObject({
    code: "menu_section.member_cycle",
  });
  expect(await includable(drinks)).not.toContain(lunch);
  expect(await includable(drinks)).not.toContain(drinks);
});

it("accepts only another menu's top level as a section member", async () => {
  const own = (await app((tx) => createSectionIn(tx, lunchRoot, { internalName: "Mine" }))).id;
  await expect(app((tx) => addMember(tx, dinnerRoot, section(own)))).rejects.toMatchObject({
    code: "menu_section.wrong_role",
  });
  const layout = await defaultLayoutOf(dinner);
  await expect(app((tx) => addMember(tx, lunchRoot, section(layout)))).rejects.toMatchObject({
    code: "menu_section.wrong_role",
  });
});

it("still accepts a home tile for the menu's own section", async () => {
  const own = (await app((tx) => createSectionIn(tx, lunchRoot, { internalName: "Mine" }))).id;
  await app((tx) => addShortcut(tx, await defaultLayoutOf(lunch), section(own)));
});

it("tells the menu's own placements apart from each directly included menu's", async () => {
  // Evening includes Drinks, Drinks includes Wines; Evening's own Specials also holds Lager.
  expect(placesOf(graph, evening, lager)).toEqual({ own: true, via: [drinks] });
  expect(placesOf(graph, evening, merlot)).toEqual({ own: false, via: [drinks] }); // not Wines
});
```

`packages/catalogue/src/sections.test.ts`: `createSectionIn` makes a `section` owned by the list's
menu, placed at the given position; deleting a section deletes the sections below it and leaves its
products existing; `removeMember` and `replaceMember` on an owned section's row are refused with
`menu_section.wrong_role`; `updateSection` on a root is refused with `menu_section.wrong_role`.

`packages/catalogue/src/content-languages.test.ts`: a `section` with an English customer name and
no Spanish one appears in the gap report, and so does a menu (its root) missing a language.

`packages/catalogue/src/menu-structure.test.ts`: when Drinks gains a product, Lunch (which
includes Drinks) gets a `menu_items` row for it and its status turns `changed`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run scripts/menu-sections-upgrade.test.ts`
Run: `pnpm --filter @waitron/catalogue exec vitest run src/menu-inclusion.test.ts src/sections.test.ts src/content-languages.test.ts`
Expected: FAIL — no `*_sections_owned_prepare` entry to stage before; `createSectionIn` and
`placesOf` do not exist; the gap report skips owned sections.

- [ ] **Step 3: Write the migrations, in this order**

```bash
pnpm --filter @waitron/catalogue db:generate:custom --name sections_owned_prepare
```

```sql
-- The sections rebuild below would empty section_members (it cascades) and fail on menu_details
-- (no action). Both are carried across by hand; library sections are dropped, not converted.
-- Media's triggers read sections in their BODY, which fails the rebuild's rename; media
-- recreates them after this set. IF EXISTS: on a fresh database media has not run yet.
DROP TRIGGER IF EXISTS sections_media_image_fk_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS sections_media_image_fk_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS sections_media_image_fk_parent_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS sections_media_image_fk_parent_rename;--> statement-breakpoint
DELETE FROM sections WHERE role = 'library';--> statement-breakpoint
CREATE TABLE __keep_section_members AS SELECT id, section_id, position, product_id, child_section_id FROM section_members;--> statement-breakpoint
CREATE TABLE __keep_menu_details AS SELECT menu_id, root_section_id, default_home_layout_id FROM menu_details;--> statement-breakpoint
DELETE FROM menu_details;--> statement-breakpoint
DELETE FROM section_members;
```

Before running it, grep every `drizzle/*.sql` for trigger BODIES naming `sections` or
`section_members` beyond media's four (this plan's review found none); each one found must be
dropped here and recreated after.

Then TWO generated steps — drizzle-kit's rebuild of `section_members` copies every column of the
NEW table from the OLD one, so a rebuild that adds `missing_name` in the same step reads a column
that does not exist yet and fails with `no such column: "missing_name"` on every database,
fresh ones included (run by this plan's review):

1. Add only `missingName` to `section_members` in the schema, then
   `pnpm --filter @waitron/catalogue db:generate --name section_members_missing_name`.
   Expected: `ALTER TABLE section_members ADD missing_name text;` and nothing else.
2. Make the role, owner and check changes, then
   `pnpm --filter @waitron/catalogue db:generate --name sections_owned`.
   Expected: rebuilds of `sections` and `section_members` (both `__new_…`), nothing else. At that
   point `section_members` and `menu_details` are empty and `sections` holds only roots and
   layouts, all owned, so the copy satisfies `owner_menu_id not null`.

```bash
pnpm --filter @waitron/catalogue db:generate:custom --name sections_owned_restore
```

```sql
INSERT INTO section_members (id, section_id, position, product_id, child_section_id)
  SELECT id, section_id, position, product_id, child_section_id FROM __keep_section_members;--> statement-breakpoint
INSERT INTO menu_details (menu_id, root_section_id, default_home_layout_id)
  SELECT menu_id, root_section_id, default_home_layout_id FROM __keep_menu_details;--> statement-breakpoint
DROP TABLE __keep_section_members;--> statement-breakpoint
DROP TABLE __keep_menu_details;
```

```bash
pnpm --filter @waitron/media db:generate:custom --name recreate_section_image_triggers
```

with media `0002_section_image_references.sql`'s four `CREATE TRIGGER` statements, each written
`CREATE TRIGGER IF NOT EXISTS` (on a fresh database `0002` has just created them). No custom file
ends its last statement with a breakpoint (Global Constraints).

- [ ] **Step 4: Change the code, then run**

Make the code changes under Files. `menusContaining` already walks up through an included root to
every menu that includes it, so `onStructureChanged` (`section-structure.ts:10-14`) re-syncs
including menus with no change — the `menu-structure.test.ts` case in Step 1 pins it.

Rewrite `menus-fixture.ts` and every test the retired library functions break. A test that
exercised "a section shared by two menus" becomes "a menu included by two menus" and keeps its
assertion.

Run: `pnpm --filter @waitron/catalogue --filter @waitron/media --filter @waitron/venue-service exec vitest run`
Run: `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/configuration-transfer.test.ts src/till-api.sell-published.test.ts scripts/demo-seed`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries`
Run: `pnpm exec vitest run scripts/menu-sections-upgrade.test.ts scripts/migration-upgrade.test.ts scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts scripts/errors-reachable.test.ts scripts/two-file-foreign-keys.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts`
Run: `pnpm -r --filter @waitron/catalogue --filter @waitron/media --filter @waitron/venue-service --filter @waitron/server --filter @waitron/dashboard typecheck`
Expected: PASS. (The dashboard still calls the removed routes at run time; Task 7 replaces them.
Its suites mock the network, so they stay green.)

- [ ] **Step 5: Commit**

```bash
git add -A packages apps/server apps/dashboard/src/api/live-queries.ts docs/developers/products.md scripts
git commit -s -m "Every menu section belongs to one menu, and a menu can include another as one folder"
```

---

### Task 4: One price and one on/off per product across a combined menu

The design's §4.3 rule, as a pure function with the provenance the owner asked for, wired into
everything that reads a menu's offers: the published document (so the till sells at it), the
dashboard's prices view, the status and preview, and publishing.

**Files:**
- Create: `packages/catalogue/src/menu-combine-types.ts` — TYPES ONLY (the dashboard imports them
  by path); add it to the `LEAVES` list in `scripts/dashboard-browser-purity.test.ts`
- Create: `packages/catalogue/src/menu-combine.ts` + `menu-combine.test.ts` — the functions
- Modify: `packages/catalogue/src/operations.ts` (`listMenuOffers` / `offersOn` :445-613 and
  `menuPrices` :611-641 load the inclusion closure of the menus asked for, build each menu's raw
  offers with `includeSwitchedOff`, and combine included menus first; `offerPrices` :551-561 and
  `readOfferVariants` :650-712 feed the function its inputs)
- Modify: `packages/catalogue/src/menu-types.ts` (`MenuOffer.unitPrice` is the combined price;
  `grossPrice` stays this menu's own override; add `combined: CombinedOffer` — and add
  `"combined"` to the keys `FrozenOffer` (`menu-document-types.ts:34-37`) and `LiveOffer` (:112)
  omit, or freezing and serving offers fail to typecheck)
- Modify: `packages/catalogue/src/menu-document-types.ts` (`MenuStatus` :166-168 — every state,
  `unpublished` included, carries `clashes: number`; `MenuPreview` :171-179 gains
  `clashes: MenuClash[]`; `MenuChangeSource` :120 becomes
  `"this_menu" | "shared_product" | "included_menu"` — `shared_section` is retired with library
  sections — and `MenuChange` gains `includedMenu?: {id: string; name: string}` for
  `included_menu`; a `DocumentMember` of kind `section` that is an included menu's top level gains
  `includedMenu?: {id: string; name: string}` — additive under format 2, and what lets a diff of
  two documents tell an included menu's folder from the menu's own section)
- Modify: `packages/catalogue/src/menu-document.ts` (`freezeOffer` :256-285 freezes the combined
  price into `unitPrice` and each variant's `unitPrice` / `offered`, drops `combined`; the change
  attribution — `listSource` :629-634, `DiffEntry.section`, `section_changed` :803-810 (which
  hardcodes `shared_section` today), the placement change :845, the price change :850-857, order
  changes :920 — names `included_menu` with the DIRECTLY included menu when the changed list,
  placement or price arrived through one, and `this_menu` for a change in the menu's own sections.
  A diff sees only the two documents, so: `listSource(path)` takes the FIRST section on the path
  carrying `includedMenu`, in the live and in the proposed document; and `diffEntries` takes a
  second argument, a lookup from the working combined offers giving each product's and variant's
  price `ValueSource`, so a price change whose source is `menu` names that menu)
- Modify: `packages/catalogue/src/menu-publication.ts` (`menuStatus` :83-94 counts clashes;
  `previewMenu` :258-387 returns them and uses the new sources — `refine` (:~318-333) and the loop
  that skips `this_menu` entries when filling `alsoOn` (:~368) change so that `alsoOn` lists the
  menus that include this one for a change in its own sections;
  `publishMenu` :418-448 refuses with `menu.clashes_unresolved {menuId, count}` before writing)
- Modify: `packages/catalogue/src/errors.ts` (`menu.clashes_unresolved`, 409 in
  `apps/server/src/catalogue-api.ts`, wording in `apps/dashboard/src/i18n/codes.ts`)
- Modify: `apps/dashboard/src/widgets/menu-preview.ts:46-50` (`SOURCES` is a
  `Record<MenuChange["source"], StringKey>`, so it must change in THIS task: `included_menu` in,
  `shared_section` out) and `strings.ts` (`menu_preview.source_*`, English :1895-1897 and Spanish :3841-3843)
- Modify: `apps/server/src/catalogue-api.ts:925` (`GET …/prices` returns each item's `combined`)
- Tests: `menu-combine.test.ts`, `operations.test.ts`, `menu-document.test.ts`,
  `menu-publication.test.ts`, `apps/server/src/till-api.sell-published.test.ts`,
  `apps/server/src/catalogue-api.test.ts`, `apps/dashboard/src/widgets/menu-preview.test.ts`

**Interfaces:**
- Produces (`menu-combine-types.ts`):

```ts
/** Where a value came from. `menu` nests: Evening's price came from Drinks, which took it from … */
export type ValueSource =
  | { kind: "own" }                          // this menu's own setting
  | { kind: "product" }                      // the product's (or variant's) own catalogue price; for on/off, "placed here"
  | { kind: "parent" }                       // P4: a variant with no price follows its product's price on this menu
  | { kind: "menu"; menuId: string; menuName: string; from: ValueSource };

export type Place = { kind: "own_sections" } | { kind: "menu"; menuId: string; menuName: string };
export type Candidate<T> =
  | { place: Place; value: T; source: ValueSource }
  | { place: Place; undecided: true };      // P6: that menu has a clash of its own here

export type Setting<T> =
  | { state: "decided"; value: T; source: ValueSource;
      /** Only when `source.kind` is `"own"` or `"parent"`: what the sources say without this
       * menu's setting (for `parent`, without its setting of the product's price). */
      otherwise: Setting<T> | null }
  | { state: "clash"; candidates: Candidate<T>[] };

export interface CombinedOffer {
  productId: string;
  offered: Setting<boolean>;
  price: Setting<Decimal>;
  /** `level` (P4): `size` when the price was set for this size somewhere — this menu's override, the
   * size's catalogue price, or an included menu whose own price is `size`-level — and `product`
   * when the size follows its product's price on this menu. */
  variants: { variantId: string; offered: Setting<boolean>;
              price: Setting<Decimal> & { level: "size" | "product" } }[];
}

export interface CombineInput {
  productId: string;
  catalogue: { price: Decimal; variants: { variantId: string; price: Decimal | null }[] };
  own: { price: Decimal | null; offered: boolean | null;
         variants: { variantId: string; price: Decimal | null; offered: boolean | null }[] };
  placedInOwnSections: boolean;
  /** DIRECT inclusions reaching the product, in `includedMenus` order. */
  included: { menuId: string; menuName: string; offer: CombinedOffer }[];
}

export interface MenuClash { productId: string; variantId: string | null; field: "price" | "offered";
                             candidates: Candidate<Decimal | boolean>[] }
```

- Produces (`menu-combine.ts`): `combineOffer(input: CombineInput): CombinedOffer`;
  `clashesOf(offer: CombinedOffer): MenuClash[]`.

The rule, precisely:

- **Places.** A product is reached by at least one place, or the menu has no offer for it:
  `placedInOwnSections` false AND `included` empty is a programming error, and `combineOffer`
  throws. (Inactive included menus contribute no place, P10.)
- **Own.** A setting is `own` if this menu set it (`gross_price` / `offered` / a variant override
  not null), with `otherwise` = the result of the next step. An own value EQUAL to a source's still
  counts as own (pinned already: "keeps an override equal to the product's price when that price
  changes", `menu-structure.test.ts`).
- **Candidates.** One per place, own sections first, then each included menu in `included` order:
  own sections give the catalogue price with source `product`, and on/off `true` with source
  `product` (for a variant's PRICE see P4 below); an included menu gives its
  `CombinedOffer`'s value, wrapped as `{kind: "menu", menuId, menuName, from: <its source>}`, or
  `undecided` if that value is a clash there. All decided and equal by value
  (`compareDecimal(a, b) === 0`; booleans `===`) → `decided` with the FIRST candidate's source;
  otherwise `clash` listing every candidate.
- **P4**, for a variant's price, in order:
  1. this menu's own variant override → `own`, level `size`;
  2. else the SIZE-LEVEL candidates only: own sections give one if the variant has its own
     catalogue price (source `product`); each included menu gives one if its price for the variant
     has level `size` (wrapped as `menu`), or `undecided` if it is a clash at level `size`. If there
     is at least one: agree → decided, else clash; level `size`. Product-level places take no part
     — a size-specific price beats them;
  3. else (no place priced the size) the variant follows this menu's price for its product: the
     same value, or the same clash, with source `parent`, level `product`. When this menu set that
     product price itself, `otherwise` = what the size would cost without it.
- **`clashesOf` (P5).** An on/off clash always (the product's, and each variant's). A price clash
  only where the product's `offered` is decided `true` — and for a product with variants, only
  each variant's price clash where that variant's `offered` is decided `true`; the product's own
  price clash is then not reported.
- **The document with a clash in it** (built for status, preview and hashing, never published): a
  clashing price freezes the catalogue price (for a variant, its own, else its product's); an
  on/off clash freezes "on". Publishing is refused while any clash exists, so neither reaches a
  till.

- [ ] **Step 1: Write the failing tests**

`packages/catalogue/src/menu-combine.test.ts` — pure, no database. Review Focus 2:

```ts
const d = (s: string) => s as Decimal;
const lager = (own: Partial<CombineInput["own"]> = {}, rest: Partial<CombineInput> = {}): CombineInput => ({
  productId: "lager",
  catalogue: { price: d("3.00"), variants: [{ variantId: "pint", price: null }] },
  own: { price: null, offered: null, variants: [], ...own },
  placedInOwnSections: false,
  included: [],
  ...rest,
});
// Drinks places Lager in its own sections and sets its price.
const drinks = combineOffer(lager({ price: d("3.50") }, { placedInOwnSections: true }));

it("gives Evening, which includes only Drinks, Drinks' price, and says so", () => {
  const evening = combineOffer(lager({}, { included: [{ menuId: "drinks", menuName: "Drinks", offer: drinks }] }));
  expect(evening.price).toEqual({
    state: "decided", value: "3.50", otherwise: null,
    source: { kind: "menu", menuId: "drinks", menuName: "Drinks", from: { kind: "own" } },
  });
  expect(evening.offered).toMatchObject({ state: "decided", value: true });
  expect(clashesOf(evening)).toEqual([]);
});

it("reports a clash in Afternoon, which also places Lager in its own sections — once, on the pint", () => {
  const afternoon = combineOffer(lager({}, {
    placedInOwnSections: true,
    included: [{ menuId: "drinks", menuName: "Drinks", offer: drinks }],
  }));
  expect(afternoon.price).toEqual({ state: "clash", candidates: [
    { place: { kind: "own_sections" }, value: "3.00", source: { kind: "product" } },
    { place: { kind: "menu", menuId: "drinks", menuName: "Drinks" }, value: "3.50",
      source: { kind: "menu", menuId: "drinks", menuName: "Drinks", from: { kind: "own" } } },
  ] });
  // Lager has a variant, so it is never sold as itself: one clash, on the pint (P5).
  expect(clashesOf(afternoon).map((c) => [c.field, c.variantId])).toEqual([["price", "pint"]]);
});

it("clears the clash once Afternoon sets its own price, keeping what it would otherwise be", () => {
  const afternoon = combineOffer(lager({ price: d("3.50") }, {
    placedInOwnSections: true,
    included: [{ menuId: "drinks", menuName: "Drinks", offer: drinks }],
  }));
  expect(clashesOf(afternoon)).toEqual([]);
  expect(afternoon.price).toMatchObject({ state: "decided", value: "3.50", source: { kind: "own" },
    otherwise: { state: "clash" } });
  expect(afternoon.variants[0].price).toMatchObject({ state: "decided", value: "3.50", source: { kind: "parent" } });
});

it("refuses a product that no place reaches", () => {
  expect(() => combineOffer(lager())).toThrow();
});
```

Add cases for: on/off (Evening switches Lemonade off without touching Drinks; own sections on +
Drinks off → an on/off clash, always reported); a price clash on an item resolved off is not
reported (P5); an included menu's own clash makes the including menu's candidate `undecided`
(P6); a three-level chain Evening → Drinks → Wines gives the nested `from`; a menu including two
menus that both include a third gets two candidates that agree, source = the first in `included`
order; P4's two owner cases — Evening sets Lager €4, the Drinks it includes sets the pint (no
catalogue price) €3.80 → Evening's pint €3.80, source `menu` Drinks, level `size`, no clash; a menu
whose own sections hold Lager (pint unpriced) and that includes the same Drinks → pint €3.80, no
clash; with Drinks setting only LAGER €3.50 (no pint price), Evening's pint follows Evening's
Lager price, source `parent`, level `product`; a variant WITH its own catalogue price €5 and an
included menu's price for it €6 → a clash on that variant, level `size`; `0.00` is a price, not a blank;
`"3.5"` and `"3.50"` agree (compared by value).

`apps/server/src/till-api.sell-published.test.ts` — Review Focus 6: a product placed only in an
included menu that sets its price is sold through the till route at that price, and the line's
`unit_price_gross` is it.

`packages/catalogue/src/menu-publication.test.ts` — Review Focus 3 (on a product WITHOUT
variants): after changing Drinks' price so that Afternoon clashes, `menuStatus` gives Afternoon
`clashes: 1`; `publishMenu(Afternoon)` is refused with `menu.clashes_unresolved` and writes no
version; `publishMenu(Drinks)` succeeds. And `previewMenu(Evening)` — which includes only Drinks,
so its price for the product moves from 3.00 to 3.50 — lists that price change with source
`included_menu` naming Drinks, not `this_menu`. (Afternoon's preview has no price change to name:
its own sections keep offering the catalogue price, and a clash freezes the catalogue price.)

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/menu-combine.test.ts src/menu-publication.test.ts`
Run: `pnpm --filter @waitron/server exec vitest run src/till-api.sell-published.test.ts`
Expected: FAIL — `menu-combine.ts` does not exist; the included product sells at the product price.

- [ ] **Step 3: Write `combineOffer` and `clashesOf`**

Implement the rule above. No database access; import `compareDecimal` from `@waitron/shared`.

- [ ] **Step 4: Wire it in**

`listMenuOffers` / `menuPrices` work out, for the menus asked for, the closure of menus they
include (`includedMenus`, Task 3), build every menu's raw offers once (`includeSwitchedOff: true`),
and combine each menu after the menus it includes. `placesOf` (Task 3) gives each product's
`placedInOwnSections` and `included`. `placementsByProduct` and `syncMenuOffers` still walk
through an INACTIVE included menu (P10), so a product only such a menu reaches can hold an offer
row while `placesOf` gives it no place: leave every offer with no place out BEFORE combining, and
leave the inactive menu's folder out of the document. An offer whose `offered` is decided false is left out of
`listMenuOffers` as today; one with a clash stays in the prices view and preview, flagged. The
document freezes the combined price (`unitPrice`, each variant's `unitPrice`) and on/off
(`offered`), so `selectMenuVariant` (`variants.ts:407`) and `priceOrderLines`
(`apps/server/src/working-order.ts:364+`) need no change (read by this plan's review:
`applyLiveFields` uses the frozen `variant.offered`).

Run: `pnpm --filter @waitron/catalogue exec vitest run`
Run: `pnpm --filter @waitron/server exec vitest run src/till-api.sell-published.test.ts src/catalogue-api.test.ts src/working-order.test.ts`
Run: `pnpm --filter @waitron/venue-service exec vitest run`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview`
Run: `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/dashboard-browser-purity.test.ts scripts/catalogue-engine-neutral.test.ts scripts/live-subscriptions.test.ts`
Run: `pnpm -r --filter @waitron/catalogue --filter @waitron/venue-service --filter @waitron/server --filter @waitron/dashboard typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A packages/catalogue apps/server apps/dashboard scripts/dashboard-browser-purity.test.ts
git commit -s -m "A combined menu has one price and one on/off per product, and a disagreement blocks publishing"
```

---

### Task 5: Home tiles reach into included menus, and a lost target leaves an empty slot

Replaces plan decision D13 (publishing LEAVES OUT a tile whose target is not in the menu,
`menu-document.ts:181-187`), per the design's §4.5.

**Files:**
- Modify: `packages/catalogue/src/section-graph.ts:30-38` (`toSectionMember` maps a row with both
  refs null to a `TileRef` `{kind: "missing", name: missing_name}`, never to a product with a null
  id) and
  every reader of a layout's members: `loadSectionGraph`, `membersOf`, `listHomeLayouts`' name
  lookup, `removeShortcut` / `moveShortcut`, the document's tile loop. A structure walk
  (`reachableFrom`, `placementsByProduct`, `syncMenuOffers`) never meets one, because only a
  `home_layout` list holds one — pin that with a `section-graph.test.ts` case.
- Modify: `packages/catalogue/src/home-layouts.ts` (`addShortcut` :228-241 accepts any section or
  top-level product the combined menu reaches structurally — an included menu's root and every
  section below it (Task 3 made `checkRef` accept them); `listHomeLayouts` :88-155 returns
  `HomeTile.ref` as a product, a section, or `{kind: "missing"}`, and `HomeTile.missingName`: the
  stored name for a missing row; for an unreachable EXISTING section "<owner menu name> › <section
  path>" (for example "Drinks › Beer"); for an unreachable product its staff name; new
  `replaceShortcut(tx, layoutId, memberId, ref)` keeping the position)
- Modify: `packages/catalogue/src/sections.ts` (`deleteSection`: before deleting, every tile row in
  ANY menu's `home_layout` whose target is the section or one below it becomes
  `{product_id: null, child_section_id: null, missing_name: <its "<menu> › <path>" name>}`, in the
  same transaction — P8)
- Modify: `packages/catalogue/src/menu-document-types.ts` (`DocumentTile` gains
  `{ kind: "empty" }`; the `homeLayouts` comment's D13 sentence becomes "a shortcut whose target is
  not in the document is an empty slot"; `MenuPreview.warnings` :174 kind `shortcut_omitted` →
  `shortcut_missing {layoutName, name}`) and `menu-document.ts:175-189` (an unreached or missing
  tile becomes `{kind: "empty"}` in place); `menu-publication.ts:383,390-411`
- Modify: `packages/module/src/module.ts:195-201` (`ZoneHomeLayout.tiles` restates the tile type —
  add `{kind: "empty"}`), filled by `packages/venue-service/src/operations.ts:571`
- Modify: `apps/till/src/widgets/menu-browser.ts:349-360` — the MINIMUM to typecheck: `#tile`
  returns `nothing` for `kind === "empty"` before it reads `productId`. Task 6 draws the slot.
- Modify: `packages/catalogue/src/section-types.ts:37-45` (`HomeTile`; `MemberRef` stays as it is —
  a new `TileRef = MemberRef | {kind: "missing"; name: string}` is used ONLY by `HomeTile.ref` and
  the layout readers, because every `ref.kind === "product" ? … : ref.sectionId` in the catalogue
  (`sameRef`, `refColumns`, `reachableFrom`, `placementsByProduct`, `childSections`,
  `structuralReach`, the document's list walk) and in the dashboard (`menus-screen.ts:120-123`,
  `member-list-editor.ts:25,30`) would break on a third kind)
- Modify: `apps/server/src/catalogue-api.ts:619-710` (`POST /management-api/home-layouts/:layoutId/tiles/:memberId/replace`
  body `{ref}` → `replaceShortcut`, 200 with the `SectionMember` — the shape of its sibling
  `POST …/members/:memberId/replace` (:584-591); refused `menu.shortcut_unreachable`)
- Modify: `apps/dashboard/src/api/live-queries.ts:129` (`listHomeLayouts` gains `catalogues`: a
  missing tile's name names the owning menu) — and the dashboard's use of `shortcut_omitted`
  (`menu-preview.ts:428`, `strings.ts` :1903 / :3849), renamed here so the dashboard typechecks;
  Task 9 rewrites the wording
- Tests: `home-layouts.test.ts` (:219-409; the D13 cases :250-295 become empty-slot cases),
  `section-graph.test.ts`, `menu-document.test.ts:259`, `menu-publication.test.ts:213`,
  `apps/server/src/catalogue-api.test.ts:3841,4742-5000`, `apps/till/src/widgets/menu-browser.test.ts`

**Interfaces:**
- Produces: `DocumentTile = {kind:"product"; productId} | {kind:"section"; sectionId} | {kind:"empty"}`
  (and the same in `ZoneHomeLayout`); `TileRef`; `HomeTile.ref: TileRef`,
  `HomeTile.missingName: string | null`; warning `shortcut_missing`; `replaceShortcut`.

- [ ] **Step 1: Write the failing tests**

`packages/catalogue/src/home-layouts.test.ts` — Review Focus 4:

```ts
it("keeps a deleted section's tile in its place, in another menu's layout, as a missing slot", async () => {
  // Evening includes Drinks and holds Burger and Soup in its own sections; Evening's layout:
  // Lemonade (Drinks' top level), Beer (a Drinks section, holding Lager), Burger, Soup. Deleting
  // Beer also takes Lager off Evening, which is why tile 0 is Lemonade.
  await app((tx) => deleteSection(tx, beer));
  const [layout] = await app((tx) => listHomeLayouts(tx, evening));
  expect(layout.tiles.map((t) => [t.position, t.ref.kind, t.missingName])).toEqual([
    [0, "product", null], [1, "missing", "Drinks › Beer"], [2, "product", null], [3, "product", null],
  ]);
  const document = await app((tx) => buildMenuDocument(tx, evening));
  expect(document.homeLayouts[0].tiles).toEqual([
    { kind: "product", productId: lemonade }, { kind: "empty" },
    { kind: "product", productId: burger }, { kind: "product", productId: soup },
  ]);
});

it("accepts a tile for a section inside an included menu", async () => {
  await app((tx) => addShortcut(tx, eveningLayout, section(beer)));
});

it("replaces a missing tile in place", async () => {
  // after the deletion above
  await app((tx) => replaceShortcut(tx, eveningLayout, missingTileId, section(wines)));
  const [layout] = await app((tx) => listHomeLayouts(tx, evening));
  expect(layout.tiles[1]).toMatchObject({ position: 1, ref: { kind: "section", sectionId: wines }, missingName: null });
});
```

Rewrite `menu-document.test.ts:259` and `menu-publication.test.ts:213`: the unreachable tile is
`{kind: "empty"}` in place (not left out), and the preview warns `shortcut_missing`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/home-layouts.test.ts src/menu-document.test.ts src/menu-publication.test.ts`
Expected: FAIL — the tile row is deleted with the section, and the document leaves tiles out.

- [ ] **Step 3: Implement, then run**

Make the changes under Files. The empty-tile row is valid only inside a `home_layout` list:
`insertMember` / `checkRef` never write one, and `deleteSection` is the only writer.

Run: `pnpm --filter @waitron/catalogue --filter @waitron/venue-service exec vitest run`
Run: `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`
Run: `pnpm --filter @waitron/till exec vitest run src/widgets/menu-browser`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview src/api/live-queries`
Run: `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/dashboard-browser-purity.test.ts`
Run: `pnpm -r --filter @waitron/catalogue --filter @waitron/module --filter @waitron/venue-service --filter @waitron/server --filter @waitron/till --filter @waitron/dashboard typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A packages/catalogue packages/module packages/venue-service apps/server apps/till apps/dashboard
git commit -s -m "A home tile whose target has gone keeps its place as an empty slot, and tiles can point into included menus"
```

---

### Task 6: The till keeps every home tile in its place

Staff tap by position. Today `#tile` (`apps/till/src/widgets/menu-browser.ts:349-360`) returns
`nothing` for a target it cannot draw (`:352-353`, `:357-358`), and the grid (`:109-122`) closes up
behind it. On the HOME grid only, every tile that cannot be drawn — the new `{kind: "empty"}`, a
product with no offer or not sold separately, a section with nothing orderable beneath it — takes
its cell as a blank that cannot be tapped. The structure lists (`#members`, `:363-365`) keep
leaving such members out. An unavailable product keeps its disabled tile, as today (D12).

**Files:**
- Modify: `apps/till/src/widgets/menu-browser.ts` (`#home` :367-380 draws `#homeTile`, which returns
  a `<span class="slot" aria-hidden="true"></span>` where `#tile` would return `nothing`; `.slot`
  CSS sized like `.tile` :124-132 from tokens)
- Tests: `apps/till/src/widgets/menu-browser.test.ts` (:288, :338, :846, :864 — the last two now
  expect a slot in place on the home grid and still no member in the structure),
  `menu-browser.a11y.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("draws a blank, untappable cell for an empty tile and keeps later tiles in their positions", async () => {
  const el = await mount(menuWithTiles([
    { kind: "product", productId: lager }, { kind: "empty" }, { kind: "product", productId: burger },
  ]));
  const cells = [...el.shadowRoot!.querySelectorAll(".shortcuts > *")];
  expect(cells.map((c) => c.localName)).toEqual(["wt-button", "span", "wt-button"]);
  expect(cells[1].getAttribute("aria-hidden")).toBe("true");
  expect(cells[1].querySelector("button, wt-button")).toBeNull();
});
```

(Use the file's own mount and fixture helpers and its real grid selector — read `:288`.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/till exec vitest run src/widgets/menu-browser.test.ts`
Expected: FAIL — two cells, the empty tile drawn as nothing.

- [ ] **Step 3: Implement, run, and look**

Run: `pnpm --filter @waitron/till exec vitest run src/widgets/menu-browser`
Expected: PASS. Then open the till's home grid with an empty slot, at handheld (3) and till (6)
columns, light and dark, and look: the gap is a visible space the size of a tile and nothing moves.

- [ ] **Step 4: Commit**

```bash
git add -A apps/till
git commit -s -m "The till keeps every home tile in its place, drawing a blank where a target has gone"
```

---

### Task 7: The menu editor edits sections and includes menus; the Sections screen goes

**Files:**
- Delete: `apps/dashboard/src/screens/sections-screen.ts` and its tests
- Create: `apps/dashboard/src/widgets/section-details-form.ts` (+ `.test.ts`, `.a11y.test.ts`) —
  lifted from `sections-screen.ts` `#renderDetails` :835-907 and `#save`'s error mapping
  :453-498: internal name (required), customer names per content language
  (`optionalTextFields`), colour (`colorField`), image (`dashboard-image-upload`); events
  `wt-submit {internalName, names, image, color}` / `wt-cancel`; a refusal naming a field sits under
  it, the rest at the bottom of the form (Global Constraints → Forms)
- Modify: `apps/dashboard/src/screens/menus-screen.ts`:
  - drop `this.sections` (:346) and `listSections` / `listSectionUsages` (:668-706); every section
    name and detail comes from the structure's nodes (Task 3), so `#sectionNames` / `#parents`
    (:550-553) read the nodes;
  - delete `#renderShared` (:1744-1780), Duplicate here (:1126-1172, :2102-2141) and the `usages`,
    `duplicating` state; `placesOf` / `withOrder` (:155-202) shrink to one place per section;
  - "New section here" (:1174-1225, :2143-2177) opens `section-details-form` and posts
    `POST /management-api/sections/:listId/sections` once;
  - a section row gets Edit (the same form, `PATCH /sections/:id`) and Delete (a confirmation
    naming how many sections below it go too, and that its products stay);
  - "Include a menu" beside "New section here": a picker of the structure's `includable` menus,
    posting `addSectionMember(listId, {kind: "section", sectionId: <that menu's root>})`; an
    included menu's row reads "Menu: Drinks", its contents show in the tree read-only with
    "Edit Drinks" linking to `/manage/menus/menu/<id>/view/structure`, and its row action is
    "Remove from this menu";
  - the menu create/rename form (:937-998, :1607-1644) becomes `section-details-form` over the
    menu: name, customer names, image, colour (`PATCH /catalogues/:id`);
  - P7: when the structure's `includedBy` is not empty, a notice above the tree: "Included in:
    Evening, Afternoon (1 clash)", each linking to that menu, with its clash count from
    `getMenuStatuses`.
- Modify: `apps/dashboard/src/widgets/member-list-editor.ts` (`sections` → nodes; the add-picker
  offers products only; `#row` :281-314 shows an included menu as "Menu: <name>"),
  `menu-structure-tree.ts` (an included menu's node shows its name and is not an edit target),
  `add-to-menus.ts` (:15-81 names from the structure; `sharedWith` becomes "also on <menus that
  include this one>"; `catalogue-screen.ts:394-446` drops `listSections`)
- Modify: `apps/dashboard/src/dashboard-app.ts` (:47-48, :98-99, :165, :1630-1633 — the `sections`
  screen and `nav.section_library` go), `navigation.ts`, `api/client.ts` (delete `listSections` :1916,
  `listSectionUsages` :1920, `createSection` :1923, `duplicateSection` :1954-1963 and
  `getSectionUsages` :1964 — `updateSection`, `deleteSection` and the member methods in the same
  range stay; add `createSectionIn`, `updateMenuDetails`), `api/live-queries.ts:136-138`
- Modify: `packages/catalogue/src/section-types.ts` (delete the `LibrarySection` alias and
  `SectionUsages`; the dashboard uses `SectionDetails`, Task 3)
- Modify: `apps/dashboard/src/i18n/strings.ts` (English and Spanish: delete `nav.section_library`,
  `menus.shared`, `shared_note`, `not_shared`, `duplicate_*` and the Sections-screen-only
  `sections.*` keys; add the keys the new controls need)
- Modify: `docs/backlog.md` — close :264-280, :282-296 (the image-library link), :297-311 ("New
  section here asks only for the internal name"), :682-685 with dated notes; re-point :687-696
  (its next action named the Sections screen)
- Tests: `menus-screen*.test.ts`, `member-list-editor*`, `menu-structure-tree*`, `add-to-menus*`,
  `catalogue-screen.test.ts`, `dashboard-app.test.ts:288-311,1672,4142-4144` (the address
  `/manage/sections` now lands on the dashboard's not-found handling — assert what it does today
  for an unknown screen), `api/client-routes.test.ts`, `api/live-queries.test.ts:84-108`

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/src/screens/menus-screen.test.ts`:

```ts
it("creates a section with its customer name, image and colour in one request", async () => {
  // Open Structure, New section here, fill internal name "Starters", English "To begin",
  // Spanish "Para empezar", colour, Save.
  expect(api.createSectionIn).toHaveBeenCalledWith(rootId, {
    internalName: "Starters", names: { en: "To begin", es: "Para empezar" }, image: null, color: "#aa3300",
  });
  expect(api.addSectionMember).not.toHaveBeenCalled();
});

it("offers only menus that can be included, and includes one as a folder", async () => {
  // structure.includable = [drinks]; Lunch is not offered (it would include itself).
  expect(optionLabels(picker)).toEqual(["Drinks"]);
  // choose Drinks
  expect(api.addSectionMember).toHaveBeenCalledWith(rootId, { kind: "section", sectionId: drinksRoot });
});

it("lists the menus that include this one, with their clashes", async () => {
  // structure.includedBy = [evening, afternoon]; statuses: afternoon clashes 1
  expect(notice.textContent).toContain("Included in");
  expect(links.map((a) => [a.textContent?.trim(), a.getAttribute("href")])).toEqual([
    ["Evening", "/manage/menus/menu/evening/view/structure"],
    ["Afternoon (1 clash)", "/manage/menus/menu/afternoon/view/structure"],
  ]);
});
```

`section-details-form.test.ts`: the internal name is required and marked; the refusal the server
actually sends for a missing translation — `menu_section.translation_required {field: "names",
language: "es"}` (`sections.ts` `namesOf`, :63-79) — sits under the Spanish field (CLAUDE.md §3:
place a refusal by what the error carries); a refusal naming no field sits at the bottom
of the form, not in the button bar.

`dashboard-app.test.ts`: the navigation has no Sections entry.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen src/widgets/section-details-form src/dashboard-app.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement, run, and look**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen src/screens/catalogue-screen src/widgets src/dashboard-app.test.ts src/api`
Run: `pnpm --filter @waitron/media exec vitest run src/dashboard`
Run: `pnpm -r --filter @waitron/catalogue --filter @waitron/dashboard --filter @waitron/media typecheck`
Expected: PASS. Open the menu editor (a menu that includes another, New section here, Edit, Delete,
Include a menu, the Included-in notice) in English and Spanish, light and dark, at phone and
desktop width, and look.

- [ ] **Step 4: Commit**

```bash
git add -A apps/dashboard packages/catalogue/src/section-types.ts docs/backlog.md
git commit -s -m "The menu editor edits every section field and includes other menus; the Sections screen goes"
```

---

### Task 8: The Prices tab says where every price comes from

**Files:**
- Create: `apps/dashboard/src/widgets/price-source.ts` + `.test.ts` — `describeSetting(setting,
  names, t)`: the tooltip text for a `Setting<Decimal>` (Task 4), for example
  - `source: product` → "The product's own price."
  - `source: parent` → "Follows Lager's price on this menu."
  - `source: menu Drinks, from own` → "From Drinks, which sets its own price."
  - `source: menu Drinks, from menu Wines, from product` → "From Drinks, which takes it from Wines,
    which uses the product's own price."
  - `source: own`, `otherwise` decided → "This menu sets €4.00. Without it: €3.50, from Drinks,
    which sets its own price."
  - `source: own`, `otherwise` a clash → "This menu sets €3.50. Without it the places disagree:
    €3.00 in this menu's sections, €3.50 in Drinks."
  - a clash → "The places disagree: €3.00 in this menu's sections, €3.50 in Drinks."
  Every string in both languages.
- Modify: `apps/dashboard/src/widgets/menu-prices-table.ts`:
  - rows are every product the combined menu reaches (the prices route, Task 4), variants as child
    rows;
  - the table has four price columns today (`menu-prices-table.ts:468-507`): `product-price` (the
    catalogue price), `menu-price` (this menu's own override), `effective-price` (what the menu
    charges) and the hidden `price-on-menu`. `product-price` becomes "Before this menu" — the
    combined price WITHOUT this menu's own setting (`otherwise`, else the decided value; "Clash"
    when that is a clash), since in a combined menu that is no longer the catalogue price. For
    this, `combineOffer` (Task 4) fills `otherwise` for source `parent` too — what the variant would
    cost if this menu did not set its product's price; `menu-price` and `effective-price` stay;
    `price-on-menu` stays as it is. Each shown price cell of every row — product rows and variant
    rows, overridden or not — carries a `wt-help-tooltip` (`packages/ui`, design-system.md "Use
    `wt-help-tooltip` for short explanations") whose localized `aria-label` names the product and
    the column, and whose text is `describeSetting` (owner requirement: every price says where it
    comes from). A product with variants shows a price range in its own row; that range's tooltip
    lists each variant's price and source. Cell markup is styled by `part=` only;
  - a "From" column: "This menu", "Product", "Drinks", or "Clash";
  - a clash row shows a "Clash" badge and a Resolve action offering each candidate's value as one
    step ("Use €3.50 (Drinks)") plus "Set a price…" — each writes this menu's own override;
  - an on/off clash offers "Sell it" / "Switch it off";
  - the editor's on/off becomes a three-way select, `name="offered"`: "As the menus it comes from
    (Sold)" / "Sold" / "Switched off" (the first names what the sources decide, or "they
    disagree"), and each variant's switch in the same editor becomes the same three-way select
    (`name="offered-<variantId>"`), so a size can follow an included menu too; a save sends only
    what the manager changed (Task 2); "Use product price" (:619-641) becomes "Use the inherited price" and clears the
    override; the client copy of the server chain (:275-285) goes — the server sends the answer;
  - above the table, a summary per included menu: "This menu sets its own price for 2 items and
    switches off 1 item from Drinks", and "Sets its own price for N of its own items".
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (`#renderPrices` :1879-1920, `#saveOffer`
  :1400-1454 sends `offered: true | false | null`; the menus list :77 shows each menu's clash count
  from `getMenuStatuses`), `widgets/menu-preview.ts` (the clash list above Publish, Publish disabled
  while any, with the count; `SOURCES` :46-50 gains `included_menu`), `api/client.ts` (types from
  `@waitron/catalogue/src/menu-combine.js` — keep that import type-only)
- Modify: `apps/dashboard/src/i18n/strings.ts` (`menu_prices.*`, `menu_preview.*`, English and
  Spanish)
- Tests: `price-source.test.ts`, `menu-prices-table.test.ts` + `.a11y.test.ts`,
  `menu-preview.test.ts`, `menus-screen.test.ts`

- [ ] **Step 1: Write the failing tests**

`price-source.test.ts`: one case per example above, English and Spanish, asserting the exact text.

`menu-prices-table.test.ts`:

```ts
it("puts a where-from tooltip on every shown price, overridden ones included", async () => {
  // rows, none with variants: Lager (from Drinks), Soup (product price),
  // Burger (this menu's own €14, otherwise the product's €12)
  const burger = rowOf(table, "Burger");
  const tips = [...burger.querySelectorAll("wt-help-tooltip")];
  expect(tips.map((t) => t.getAttribute("aria-label"))).toEqual([
    "Where Burger's price before this menu comes from",
    "Where Burger's price on this menu comes from",
    "Where Burger's charged price comes from",
  ]);
  await open(tips[2]);
  expect(text(tips[2])).toBe("This menu sets €14.00. Without it: €12.00, the product's own price.");
});

it("resolves a clash in one step with a source's price", async () => {
  // Lager clashes: €3.00 own sections, €3.50 Drinks. The widget holds no API; it emits.
  await click(resolveOption("Use €3.50 (Drinks)"));
  expect(events.at(-1)).toEqual({ type: "wt-offer-save",
    detail: { menuItemId: lagerItem, name: "Lager", item: { grossPrice: "3.50" }, variants: [] } });
});
```

(The event is `wt-offer-save`, `menu-prices-table.ts:586-593`, with the detail `OfferSave`
(:36-42) — `{menuItemId, name, item, variants}`, `item` carrying only what the manager changed
after Task 2; assert the whole detail with `toEqual`. The screen's `#saveOffer` makes the call,
pinned in `menus-screen.test.ts`. Keep the `aria-label`
wording above in both languages; the test pins the English.)

`menu-preview.test.ts`: with one clash, Publish is disabled and the clash is listed.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/price-source src/widgets/menu-prices-table src/widgets/menu-preview`
Expected: FAIL.

- [ ] **Step 3: Implement, run, and look**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets src/screens/menus-screen`
Run: `pnpm --filter @waitron/dashboard typecheck`
Expected: PASS. Open the Prices tab of a menu with an included menu, an override and a clash; open
a tooltip with the mouse, with the keyboard, and at phone width; English and Spanish, light and
dark. Look.

- [ ] **Step 4: Commit**

```bash
git add -A apps/dashboard
git commit -s -m "The Prices tab says where every price comes from and resolves a clash in one step"
```

---

### Task 9: The Home tab reaches into included menus and shows missing tiles

**Files:**
- Modify: `apps/dashboard/src/widgets/home-layout-editor.ts` (the tile picker offers every section
  and product the combined menu reaches, grouped by where it lives — "Drinks › Beer"; a missing or
  unreachable tile reads "Missing: <missingName>" with Remove and Replace, instead of
  `home.not_on_menu` :196-200, :292-306; Replace opens the picker and calls
  `POST …/tiles/:memberId/replace`; the preview grid :310-330 draws a missing tile as an empty cell in
  place)
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (`#renderHome` :1942-2017 and
  `#tileProducts` / `#tileSections` :572-581 from the structure's nodes, included menus included;
  a `wt-tile-replace` event), `api/client.ts` (`replaceHomeTile`)
- Modify: `apps/dashboard/src/widgets/menu-preview.ts:428` and `strings.ts` `shortcut_missing` (renamed
  from `shortcut_omitted` in Task 5; :1903 / :3849): "2 shortcuts on Evening's Counter layout point at
  things no longer in this menu. They stay as empty spaces until you remove or replace them."; the
  Publish confirmation repeats it, and the published result shows it again (§4.5: before and after
  publishing)
- Modify: `home.tiles_help` (:1826/:3771) to say tiles may point into included menus
- Tests: `home-layout-editor.test.ts` + `.a11y.test.ts`, `menu-preview.test.ts:474`,
  `menus-screen.test.ts:344`, `api/client-routes.test.ts:693`

- [ ] **Step 1: Write the failing tests**

```ts
it("shows a missing tile in its place with Remove and Replace", async () => {
  // tiles: Lager, {missing, "Drinks › Beer"}, Burger
  const rows = tileRows(editor);
  expect(rows.map((r) => r.name)).toEqual(["Lager", "Missing: Drinks › Beer", "Burger"]);
  await click(rows[1].action("Replace"));
  await choose(picker, "Drinks › Wines");
  expect(events.at(-1)).toEqual({ type: "wt-tile-replace", detail: { layoutId, memberId: rows[1].id, ref: { kind: "section", sectionId: wines } } });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/home-layout-editor src/widgets/menu-preview`
Expected: FAIL.

- [ ] **Step 3: Implement, run, and look**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets src/screens/menus-screen src/api`
Expected: PASS. Look at the Home tab with a missing tile at both column counts, English and Spanish,
light and dark, phone and desktop.

- [ ] **Step 4: Commit**

```bash
git add -A apps/dashboard
git commit -s -m "The Home tab offers tiles inside included menus and keeps a missing tile in place with Remove and Replace"
```

---

### Task 10: The demo venue includes a menu, and the documents catch up

**Files:**
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` (a "Drinks" menu holding the drinks
  sections; Casa Delgado and Menú del Día include it; one Drinks price override so the demo shows a
  price from an included menu) and `seed-catalogue.test.ts`, `seed.integration.test.ts:113`
- Modify (docs):
  - `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md` — a dated pointer at §7
    item 2 (per-menu extras dropped, owner 2026-09-30) and at §4.5 "the empty slot is a new kind of
    tile" (built, this plan); leave the rest (a spec records what was decided)
  - `docs/superpowers/plans/2026-09-25-menus-categories-home-layouts.md` — dated pointers at D5
    (:296-299), D13 (:543-550), D19 (:590-591)
  - `docs/superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md:350-353`
  - `docs/developers/product-categories.md:64-80` (the library routes and `not_library`)
  - `docs/developers/design-system.md` and `docs/products.md` wherever they describe library
    sections, the Sections screen or D13 (grep `library`, `Sections screen`, `left out`)
  - `docs/backlog.md` — mark slice 2 landed in its Track A entry (:186-195) and close the Menus
    Task 8 D13 note (:611-636)
- Sweep: CLAUDE.md §1 "A behaviour change retires every receipt about the old behaviour" — grep the
  WHOLE tree, not only `packages/` and `apps/`, for `library`, `shared section`, `D13`,
  `menu_item_extra`, `setMenuItemExtraLists`, `not_library`, `shortcut_omitted`, and read each hit.

- [ ] **Step 1: Write the failing test**

`seed-catalogue.test.ts`: Casa Delgado's structure includes the Drinks menu as a folder, and a
drink's price on Casa Delgado is Drinks' override, from `menuPrices` with source `menu`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed`
Expected: FAIL.

- [ ] **Step 3: Implement, run, then sweep**

Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed`
Expected: PASS. Then run the sweep above and fix each stale claim (prefer deleting to rewording;
historical documents get a dated pointer, not a rewrite).

- [ ] **Step 4: Commit**

```bash
git add -A apps/server/scripts docs
git commit -s -m "The demo venue's menus include a Drinks menu; documents describe menus that include menus"
```

---

## After the last task

Run `/finish-branch <worktree>` (full review wave: migrations, a table rebuild and the published
document contract are risk triggers). The PR body says, in plain English: every dev venue needs
`wa-wt reset demo <name>` after this lands (library sections are deleted and menus lose what they
held through them, a menu's "switched off" settings are cleared, and a size's stored setting reads
as an explicit "on"); per-menu extras are gone and every menu now offers its products' extras lists;
a till running the older build must be reloaded (P9);
and whether slice 1 landed first (and so which branch regenerated its migrations).

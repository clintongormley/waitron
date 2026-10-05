# One editable price override per menu row (W89) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans`. Each task is test-first: write the failing test,
> run it and watch it fail for the reason you expect, then write the least code that passes. Steps
> use checkbox (`- [ ]`) syntax. The branch changes a cross-package contract (`MenuPriceRow` in
> `@waitron/catalogue`, read by the dashboard) and adds a management route, so it takes the FULL
> path: a per-task reviewer, then `/finish-branch` with two Codex run-it reviews.

**Goal.** A menu's Prices tab becomes "Price overrides": one clearly labelled price field per product
and per size (variant), typed into directly in its row. A blank field shows what the row inherits;
a saved override shows its own price; emptying the field gives the inheritance back. The diagnostic
price columns go; a Status column says whether each row is Active, and links to its product page.

**Spec.** The owner's queue item W89 (lane B `queue.md`, 2026-10-04, copied to
`/Users/clintongormley/waitron-campaign-b/w89-brief.md`) and the test-check rule of 2026-10-05
~00:05 in the same file. There is no separate design document: the design is the next section.

**Tech stack.** Lit 3 web components in `apps/dashboard` (Vitest 4 in real headless Chromium),
`@waitron/ui`'s `wt-data-table` and `wt-price-input`, Hono routes in `apps/server`, drizzle over
SQLite in `packages/catalogue`.

**Running tests.** Focused runs only (CLAUDE.md §2); CI owns package suites. Before a browser run
check free memory (`memory_pressure | /usr/bin/grep free`). Read the `Tests` count, never the exit
status of a pipe. Commands, from the worktree root
`/Users/clintongormley/workspace/worktrees/waitron-feat-menus-price-overrides`:

- catalogue: `pnpm --filter @waitron/catalogue exec vitest run src/<file>`
- server: `pnpm --filter @waitron/server exec vitest run src/<file>`
- dashboard: `pnpm --filter @waitron/dashboard exec vitest run src/<path>`

---

## Design

### What changes

1. **The management read includes Inactive items** (`menuPrices`,
   `packages/catalogue/src/operations.ts:679`–`707`). Today it leaves out an Inactive product
   (`offerRowsOn` filters `eq(products.active, true)`, `operations.ts:520`) and an Inactive size
   (`readOfferVariants`, `operations.ts:743`; `menuVariantsOfItems`, `variants.ts:326`). After W89 a
   private `includeInactive` argument of the module-internal `offerRowsOn`, `readOfferVariants` and
   `offersOn` drops those two filters for `menuPrices` alone; it is not added to the `OfferOptions`
   that `listMenuOffers` exports, so no outside caller can ask a till's offers for an Inactive item.
   Each row gains `active` (the product's own Active), and each entry of `variants` gains `active`
   (the size's own Active). Every other caller leaves the argument at its `false` default, so the
   offers a till sells, publishing, the preview and the clash count read exactly what they read
   today.
2. **A new write sets one size's price on one menu**:
   `PATCH /management-api/catalogues/:id/items/:itemId/variants/:variantId` with
   `{ price: string | null }`, answering 204, backed by a new `setMenuVariantPrice` in
   `packages/catalogue/src/variants.ts`. It accepts any size of the offer's product, Active or not,
   and touches only that size's row. The whole-list `PUT …/variants` stays as it is.
3. **The Prices tab is renamed "Price overrides"** ("Precios propios" in Spanish). The address keeps
   its `view/prices` segment.
4. **The table's columns become** Product, Appears under, Main category, Status, Price override and
   the pinned Resolve column. Before this menu (`product-price`), Menu price (`menu-price`),
   Effective price (`effective-price`), Price on this menu (`price-on-menu`) and From (`from`) go
   from the table and the column chooser (`menu-prices-table.ts:583`–`662`). W90 already removed On
   this menu (#1216); its absence check stays.
5. **Status** shows Active or Inactive as a link to `/manage/catalogue/product/<id>`, the size's own
   id for a size row (the catalogue screen opens a size by its own id:
   `apps/dashboard/src/screens/catalogue-screen.ts:322`–`331`, test
   `catalogue-screen.test.ts:2268`). A size reads Inactive when it or its product is Inactive; an
   Active size of an Inactive product adds a muted "its product is Inactive". A plain left click
   sends `wt-edit-product`, which `dashboard-app.ts:1334` and `:1474`–`1484` already turn into the
   catalogue screen with that product open, as the translation gap report does
   (`content-languages-screen.ts:453`–`484`); a modified click opens the link the browser's way.
6. **Price override** is a `wt-price-input` in every row, product and size alike, with a hidden
   label ("Price override for Lemonade — Large"), the raw inherited amount (or range) as its
   placeholder, and a sentence for screen readers as its hint (a placeholder wins over a hint for the
   visible text: `wt-price-input.ts:264`). Typing changes nothing until Enter or leaving the field;
   then the field's own check runs (`isProductPrice`, the rule the window uses today,
   `menu-prices-table.ts:680`–`691`), and a valid change is sent. Escape puts back the stored value.
   The window behind the product name (`menu-prices-table.ts:747`–`872`) and the name's button
   (`:531`–`549`) go. The field is widened in this table only, through a new token
   `--wt-price-range-field-width` (declared in `packages/ui-core/src/tokens/structure.css` beside
   `--wt-price-field-width: 96px`, `:96`) set on the field's `override-field` part, so a range
   placeholder such as "1000.00 – 9999.99" fits whole rather than clipping into what reads as one
   price. A token rather than text beside the field because the owner's rule is that a field's hint
   is its placeholder (CLAUDE.md §3, owner 2026-09-30), and text beside it would cost a second line
   at 390 px in every row.
7. **What a blank field inherits** (a new pure module, `menu-price-inheritance.ts`):
   - a product without sizes: its combined price without this menu's own decision;
   - a size: its combined price without its own override; where that follows its product, the
     product's price on this menu as its field reads now (typed, saved, or — when emptied — the
     product's inherited one), which is what the window did (`menu-prices-table.ts:802`–`813`);
   - a product sold as its sizes: the range of what each Active size would charge with no product
     price from this menu — a size's own override counted, an Inactive size left out, and the
     product's own inherited price when it has no Active size;
   - any undecided setting on the way makes it a clash. A clash in the row's own price (a product's
     `combined.price`, or a size's own setting) shows "Set a price" as its placeholder and a red
     "Clash" beside it, and the Resolve menu offers each candidate price and "Set a price…", which
     now focuses the row's field. A product row whose own price is decided but one of whose Active
     sizes clashes at size level (the size candidates of `menu-combine.ts:57`–`67`, which a product
     price does not settle) shows no "Set a price": its placeholder is "—" and beside it, in red,
     "A size's sources disagree — set that size's price", because setting the product's price would
     not resolve it. An Inactive size's clash shows on that size's own row only. A single false
     price is never shown for a range or a clash.
8. **Saving.** The screen writes one field per request, one request at a time in the order made
   (the existing `ListWriteQueue`, `apps/dashboard/src/widgets/section-writes.ts:17`–`44`): a
   product's price through the existing `updateMenuItem`, a size's through the new route. Every
   field stays editable while a save is out; the saving one says "Saving…". A refusal that names
   the price — `product.variant_invalid` with `field: "price"`, `management.request_invalid` with
   `field` `grossPrice` or `price`, or `product.variant_not_found` for a size — goes under its
   field, keeps the typed text, and moves focus to that field, as the course list does for a
   refusal naming the name (`apps/dashboard/src/widgets/course-list.ts:28`–`31`, `:281`–`282`). Any
   other refusal (`connection.failed`, `menu_item.not_found`, …) goes under no field: it is said in
   the status line. Every refusal is also said in the status line, which sits at the bottom of the
   tab's view and stays in view while the rows scroll (`position: sticky`), so a save made far down
   the list is still heard and seen. A success re-reads the prices, then the status line says what
   was saved, with an Undo button that writes the previous value back. Once the person has left
   the menu or the tab, a refusal is reported beside the list (`memberError`), as today.

### Decisions, with reasons (the owner may want to revisit those marked ★)

- ★ **D1. A single-size write instead of the whole-list PUT.** The PUT replaces the row of every
  Active size and deletes the rows it is not sent (`setMenuVariants`, `variants.ts:338`–`391`), so a
  per-field save would have to send sibling prices it did not edit. Any sibling read before another
  save or another person's write landed would be written back over it. One row per request has no
  such window. The PUT and its client method stay, unchanged, for any other caller.
- ★ **D2. Inactive rows are editable.** A reached Inactive product's price is already writable
  (`updateMenuItem` checks reachability only, `operations.ts:349`–`358`;
  `reachableMenuItem`, `menu-structure.ts:137`–`156`; a reached product gets a menu row "active or
  not", `menu-structure.ts:158`–`160`). The new size route accepts an Inactive size for the same
  reason: the price is kept for when it is made Active again, as the PUT already keeps an Inactive
  size's row (`variants.ts:338`–`342`).
- **D3. An Inactive row's clash shows on the tab but does not block publishing.** Offers leave
  Inactive items out, so publishing and the preview never meet it. The tab shows it so the owner
  sees it before making the row Active again.
- ★ **D4. Status shows Active or Inactive only.** Available (sold out) is not in the read and stays
  on the product page, keeping the two words apart as `design-system.md:2273`–`2283` asks. The
  column reuses the Products list's words (`product.status`, `product.active_badge`,
  `product.inactive_badge`).
- **D5. The product row's range counts a size's own override** (point 7): it is what the product
  charges on this menu if the field is left blank.
- **D6. One where-from tooltip per row** ("Where Lemonade's inherited price comes from"), built
  from the same `describeSetting` (`price-source.ts`) the three per-column tooltips use today. A
  size following its product adds the product's own source, so a price that comes from an included
  menu still names that menu (today the From column does).
- **D7. The column memory takes a new key**, `viewKey="waitron.menus.price-overrides"` (today
  `"waitron.menus.prices"`, `menu-prices-table.ts:922`), so Main category (`choosable: "shown"`,
  `:572`, unchanged) is shown for everyone on first sight of the new tab, whatever an earlier
  layout's choice hid. This follows W87's precedent for the Menus list, which took a new key when
  its columns changed (`docs/backlog.md:3094`–`3096`). The old key's stored choice is left unread.
- **D8. The address keeps `view/prices`**; only the tab's words change.
- ★ **D9. Spanish "Precios propios"** for the tab and "Precio propio" for the column, the wording
  already used for "Variant overrides" ("Precios propios en las variantes") and "sets its own price"
  ("fija su propio precio"). **One verb form in the new and changed Spanish:** every verb addressed
  to the person is an infinitive, as the existing controls are ("Usar {price} ({place})", "Fijar un
  precio…", "Filtrar por sección"); a sentence describing what happens uses the impersonal
  indicative ("Si está vacío, se usa el precio heredado, {price}."). So the changed
  `menu_prices.override_help` drops its "Déjalo".
- **D10. A refusal that names the price moves focus to its field** (owner rule; the window does so
  today, `menu-prices-table.ts:249`–`252`), even when the person has moved on to another row. A
  refusal that names no price moves nothing.
- ★ **D11. Undo is one step**: the status line after a successful save offers Undo, which writes
  the previous value of that one field; the Undo's own success offers no second Undo. It goes when
  the next save is made, or the menu or tab changes.
- ★ **D12. An inline field has no bottom-of-form message and no Save button to disable.** The Forms
  contract (`design-system.md:1155`–`1215`) is written for a form with a primary action. Each
  override field is its own one-field edit, the pattern the course list already uses
  (`apps/dashboard/src/widgets/course-list.ts`: each change saved as it is made, on Enter or on
  leaving the field, through a `ListWriteQueue`; a refusal naming the field marked on it, any other
  shown for the list). `design-system.md:1794`–`1807` lists the owner-approved exceptions to "every
  edit opens a `wt-modal`" — Content languages (C111) and the course list (A212); Task 8 adds W89's
  Price overrides tab as the third, and writes the pattern into the Forms section.
- **D15. Fields stay editable while a save is out**, where the course list makes its one field
  `readonly` while saving (`course-list.ts:309`). `wt-price-input` has no `readonly` property, so
  following the course list would mean changing a shared primitive and its accessibility suite; and
  here many fields are in view at once, so a slow save would otherwise freeze the field the person
  wants to correct. Order is kept by the queue, and a second commit of the same text sends nothing
  (Review focus 1).
- **D16. What the summary and the tooltips count.** The summary paragraphs
  (`menu-prices-table.ts:874`–`914`) count a product when it, or any of its sizes, Active or not,
  has a price of this menu's own; an Inactive product counts too. They describe what the menu
  stores, and so agree with the "Overridden only" filter, which does the same (`:611`–`612`). A
  product row's range, its clash marker and its tooltip count its Active sizes only, because they
  describe what the product charges.
- **D17. The dashboard client's `setMenuVariants` goes** once the screen stops calling it (Task 5):
  `grep` finds no other caller in `apps/dashboard` (only `menus-screen.ts:1551` and tests). The
  server's `PUT …/variants` route and the catalogue's `setMenuVariants` stay, with their own tests.
- **D18. Between Tasks 1 and 5 the old window must not send an Inactive size.** Task 1 puts
  Inactive sizes into `row.variants`, and the window's whole-list save would then send one, which
  `setMenuVariants` refuses (`product.variant_not_found`, `variants.ts:355`–`357`). Task 1 makes the
  window seed and send Active sizes only (one filter, deleted with the window in Task 5), so every
  task is green on its own.
- **D13. "Overridden only" stays**, as the Price override column's filter (today it is the Menu
  price column's, `menu-prices-table.ts:608`–`614`), and the muted "Variant overrides" note stays
  under a product with no override of its own whose sizes have one.
- **D14. The where-from explanation, the summary paragraphs and the Resolve menu are kept as they
  are** (`menu-prices-table.ts:344`–`427`, `:874`–`914`).

### What is deliberately unchanged

- How a price is decided (`combineOffer`, `packages/catalogue/src/menu-combine.ts`), and every
  reader of offers: `listMenuOffers`, publishing (`menu-document.ts`, `menu-publication.ts`), the
  preview and its clash list, the till. Task 1 pins that the combined decisions of an Active row are
  the same as `listMenuOffers` gives.
- `PATCH …/items/:itemId` and `PUT …/items/:itemId/variants`, their bodies and their refusals.
- The section and category filters, search, the tree of sizes under their product, the summary.

### Migration: none

No schema file changes. The read adds `products.active`, a column that exists, and drops two
filters; the new write stores into `menu_item_variant_overrides` exactly the four columns it has
after W90 (`menu_item_id`, `product_id`, `variant_id`, `price`, with `price is not null`:
`packages/catalogue/src/schema/variant-overrides.ts:7`–`34`), as `setMenuVariants` already does
(`variants.ts:360`–`387`). Read, not run: so `drizzle-kit generate` has nothing to emit. Task 8
runs `scripts/migrations-match-schema.test.ts` as the check.

### Server change: yes

`menuPrices` (catalogue), a new `setMenuVariantPrice` (catalogue), and one new route in
`apps/server/src/catalogue-api.ts`. An error code with no entry in that file's `STATUS` table
answers 400 (`packages/server-kit/src/error-boundary.ts:33`), so the new route's
`product.variant_not_found` answers 400, as the PUT's does today.

---

## Global constraints

- Every visible word goes through `t()` with English and Spanish in
  `apps/dashboard/src/i18n/strings.ts`; delete a retired key from both languages in one change.
  In the new and changed Spanish, a verb addressed to the person is an infinitive and a sentence
  describing what happens is impersonal (D9).
- Every colour, spacing, radius and font reads a `--wt-*` token (CLAUDE.md §3).
- Every input has a semantic `name` (`price-override`), never a generated id.
- A shared component's custom event is `bubbles: true, composed: true`, the triggering click
  stopped first (CLAUDE.md §3). App widgets may name events plainly; keep the `wt-` prefix used here.
- Money as decimal strings; validation with `isProductPrice`
  (`packages/catalogue/src/modifier-limits.ts:12`), comparison by amount with `stringToCents`.
- Comments only for an invariant or a non-obvious why (CLAUDE.md §1); cut the window's comments as
  the window goes.
- `git commit -s` for every commit; plain-English messages.

## Review focus

The five inputs most likely to bite, each pinned by a test in the task that owns the code:

1. **Enter, then leaving the field** must send one save, not two (Task 5).
2. **A save refused for a row no longer listed** (taken off the menu meanwhile) is reported beside
   the list, naming the product, not lost under a field that is gone (Task 5).
3. **A Spanish decimal comma**, "2,50", is refused beside the field, never stored as 2.50 or 250
   (Task 5).
4. **A live re-read arriving while a save is out** must not flash the old stored value into the
   field (Task 5).
5. **An Inactive size does not widen its product's range**, and a product whose sizes are all
   Inactive shows its own inherited price (Task 3).

---

## Task 0 — Ledger

- [ ] Create `docs/handoffs/2026-10-05-w89-price-overrides.md` (gitignored), opening
  `Status: in progress`, naming the worktree, branch `feat/menus-price-overrides` and this plan.
  Update it at the end of every task.

## Task 1 — The management read lists Inactive items, each with its Active state

**Files.**
- Modify: `packages/catalogue/src/menu-types.ts` (`MenuPriceRow`, new `MenuPriceVariant`),
  `packages/catalogue/src/operations.ts` (`OfferOptions`, `offerRowsOn`, `readOfferVariants`,
  `offersOn`, `menuPrices`, the type re-exports at `:73`/`:81`),
  `packages/catalogue/src/variants.ts` (new `menuPriceVariantsOfItems`),
  `packages/catalogue/src/index.ts:45` (export `MenuPriceVariant`),
  `apps/dashboard/src/api/client.ts:77`–`78` (re-export `MenuPriceVariant`),
  `apps/dashboard/src/widgets/menu-prices-table.ts` (D18: the window's `#seed`, `:462`–`465`, and
  `#save`, `:726`–`733`, read `row.variants.filter((v) => v.active)`; `#readLines`, `:285`, lists
  Active sizes only until Task 4 draws a Status column).
- Test: `packages/catalogue/src/menu-structure.test.ts`, `packages/catalogue/src/menu-publication.test.ts`,
  `apps/server/src/catalogue-api.test.ts`.
- Fixtures only (typecheck finds them): every `MenuPriceRow` literal in
  `apps/dashboard/src/widgets/menu-prices-table.test.ts`, `menu-prices-table.a11y.test.ts`,
  `apps/dashboard/src/screens/menus-screen.test.ts` (`lunchPrices`, `:220`) and
  `menus-screen.a11y.test.ts:201` gains `active: true`, and each `variants` entry `active: true`.

**Interfaces.**
- Produces:
  ```ts
  /** One size's price setting on one menu, with its own Active state. */
  export interface MenuPriceVariant extends MenuVariant {
    active: boolean;
  }
  export interface MenuPriceRow {
    // …existing fields…
    /** The product's own Active state. A size's is on its `variants` entry. */
    active: boolean;
    /** Every size, Inactive ones too, in variant order. */
    variants: MenuPriceVariant[];
  }
  ```
  `row.combined.variants` lists every size too, Inactive ones included.

- [ ] **Step 1: failing tests** in `menu-structure.test.ts`, `describe("a menu's prices")`:

  ```ts
  it("lists a sold-out and an inactive product, each with its own Active state", async () => {
    const f = await fixture();
    await app(async (tx) => {
      for (const productId of [f.lemonade, f.water, f.burger, f.juice])
        await addMember(tx, f.lunchRoot, product(productId));
    });
    await app(async (tx) => {
      await updateProduct(tx, f.water, { available: false });
      await deactivateProduct(tx, f.burger);
    });
    const rows = await app((tx) => menuPrices(tx, f.lunch));
    expect(rows.map(({ name, active }) => [name, active])).toEqual([
      ["Lemonade (staff)", true],
      ["Water (staff)", true],
      ["Burger (staff)", false],
      ["Juice (staff)", true],
    ]);
    // A till's offers still leave the inactive product out.
    expect(
      (await app((tx) => listMenuOffers(tx, [f.lunch]))).map(({ productId }) => productId),
    ).toEqual([f.lemonade, f.water, f.juice]);
  });
  ```

  Rewrite `:776` ("carries each Active variant…") as "carries every variant, an Inactive one
  marked, and the Active ones as the variants read gives them": the same setup (Large 3.50, Small
  2.50, Jug 9.00 sent `active: false`), then

  ```ts
  expect(lunchRow!.variants).toEqual([
    { variantId: f.large, price: "3.25", active: true },
    { variantId: small, price: null, active: true },
    { variantId: jug, price: null, active: false },
  ]);
  expect(
    lunchRow!.variants.filter(({ active }) => active).map(({ variantId, price }) => ({ variantId, price })),
  ).toEqual(await app((tx) => listMenuVariants(tx, lunchItem)));
  expect(lunchRow!.combined.variants.map(({ variantId }) => variantId)).toEqual([f.large, small, jug]);
  // Dinner sets nothing for any size, the Inactive Jug included.
  expect(dinnerRow!.variants).toEqual([
    { variantId: f.large, price: null, active: true },
    { variantId: small, price: null, active: true },
    { variantId: jug, price: null, active: false },
  ]);
  ```

  (take `jug` from the `setProductVariants` result as `small` is taken). Add:

  ```ts
  it("marks an Active variant of an Inactive product by each one's own state", async () => {
    const f = await fixture();
    await app((tx) => addMember(tx, f.lunchRoot, product(f.lemonade)));
    await app((tx) => deactivateProduct(tx, f.lemonade));
    const [row] = await app((tx) => menuPrices(tx, f.lunch));
    expect(row).toMatchObject({ productId: f.lemonade, active: false });
    expect(row!.variants).toEqual([{ variantId: f.large, price: null, active: true }]);
  });
  ```

  In `menu-publication.test.ts` (fixture `menusFixture`: Dinner includes Drinks, which holds
  Lemonade with its Large and, in Beer, Lager; Dinner's own Mains holds Burger):

  ```ts
  it("gives an Active row of the management prices the combined decisions a till's offer has", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
        grossPrice: "5.00",
      });
      await setProductVariants(tx, f.lemonade, [
        { id: f.large, name: "Large", customerName: null, kitchenName: null, image: null,
          unitPrice: "3.50", available: true },
        { name: "Jug", customerName: null, kitchenName: null, image: null, unitPrice: "9.00",
          available: true, active: false },
      ], "en");
    });
    const prices = await app((tx) => operations.menuPrices(tx, f.dinner));
    const offers = await app((tx) => operations.listMenuOffers(tx, [f.dinner]));
    for (const offer of offers) {
      const row = prices.find(({ productId }) => productId === offer.productId)!;
      const active = new Set(row.variants.filter((v) => v.active).map((v) => v.variantId));
      expect({
        ...row.combined,
        variants: row.combined.variants.filter((v) => active.has(v.variantId)),
      }).toEqual(offer.combined);
    }
  });

  it("lists an inactive product an included menu prices, with that menu as its source, and its clash without blocking publication", async () => {
    const f = await menusFixture(fx.db);
    await app(async (tx) => {
      await updateMenuItem(tx, f.drinksMenu, await offerOf(tx, f.drinksMenu, f.lager), {
        grossPrice: "5.00",
      });
      // Dinner also places Lager itself, at its own 4.00: a clash with Drinks' 5.00.
      await addMember(tx, f.dinnerRoot, product(f.lager));
      await deactivateProduct(tx, f.lager);
    });
    const lager = (await app((tx) => operations.menuPrices(tx, f.dinner))).find(
      ({ productId }) => productId === f.lager,
    )!;
    expect(lager.active).toBe(false);
    expect(lager.combined.price).toMatchObject({ state: "clash" });
    const preview = await app((tx) => previewMenu(tx, f.dinner));
    expect(preview.clashes.filter(({ productId }) => productId === f.lager)).toEqual([]);
    expect((await app((tx) => menuStatus(tx, [f.dinner]))).get(f.dinner)!.clashes).toBe(0);
  });
  ```

  In `menu-prices-table.test.ts`, an interim case for D18 (deleted with the window in Task 5): a
  lemonade row whose Large is `active: false`, opened in the window, with the Small's price changed
  and saved, emits `variants: [{ variantId: "v-small", price: "1.20" }]` — the Inactive Large is
  neither shown as a field nor sent.

  Use the imports and helpers the file already has (`offerOf`, `previewMenu`, `menuStatus`,
  `addMember`, `product`, `deactivateProduct`); add any it lacks from `./operations.js`,
  `./menu-publication.js` and `./variants.js`. If `menuStatus` counts clashes under another key, read
  `MenuStatus` in `menu-publication.ts` and assert on that key — the check is "zero clashes".

  Run: `pnpm --filter @waitron/catalogue exec vitest run src/menu-structure.test.ts src/menu-publication.test.ts`
  Expected: FAIL — the inactive rows are missing and `active` is undefined.

- [ ] **Step 2: implement.**
  - `menu-types.ts`: add `MenuPriceVariant` and the two `MenuPriceRow` fields above.
  - `operations.ts`: `OfferOptions` (exported through `listMenuOffers`' signature) is NOT changed.
    The three module-internal readers take a private last argument instead:
    `offerRowsOn(tx, roots, graph, includeInactive = false)` selects `active: products.active` and
    keeps `eq(products.active, true)` only when `!includeInactive`;
    `readOfferVariants(tx, ids, includeInactive = false)` likewise for its `eq(products.active, true)`
    (`:743`); `offersOn(tx, roots, graph, options, includeInactive = false)` passes it to both. One
    comment at `offersOn`'s parameter: "Inactive products and variants too: the management prices
    read alone; a till's offer never lists one." `menuPrices` calls
    `offersOn(tx, roots, graph, {}, true)` and `offerRowsOn(…, true)`, takes `active: row.active`,
    and reads sizes with `menuPriceVariantsOfItems`.
  - `variants.ts`:
    ```ts
    /** This menu's price for every variant of each menu item's product, Inactive ones too, with each
     * one's Active state, keyed by menu-item id, in variant order. For the management prices read. */
    export async function menuPriceVariantsOfItems(
      tx: Transaction,
      menuItemIds: readonly string[],
    ): Promise<Map<string, MenuPriceVariant[]>> {
      const grouped = new Map<string, MenuPriceVariant[]>();
      for (const batch of batches(menuItemIds))
        for (const row of await tx
          .select({
            menuItemId: menuItems.id,
            variantId: products.id,
            price: menuItemVariantOverrides.price,
            active: products.active,
          })
          .from(menuItems)
          .innerJoin(products, eq(products.parentId, menuItems.productId))
          .leftJoin(
            menuItemVariantOverrides,
            and(
              eq(menuItemVariantOverrides.menuItemId, menuItems.id),
              eq(menuItemVariantOverrides.variantId, products.id),
            ),
          )
          .where(inArray(menuItems.id, batch))
          .orderBy(menuItems.id, products.variantOrder, products.id)) {
          const held = grouped.get(row.menuItemId) ?? [];
          held.push({ variantId: row.variantId, price: priceOrNull(row.price), active: row.active });
          grouped.set(row.menuItemId, held);
        }
      return grouped;
    }
    ```
    `menuVariantsOfItems` (Active only) stays for `listMenuVariants` and `setMenuVariants`.
  - Fix the `menuPrices` doc comment (`:675`–`678`): "Every product the menu reaches, Active or not,
    once each in `listMenuOffers`' order… Sold-out and Inactive ones are listed."
- [ ] **Step 3: fixtures and the changed checks of this task.** Add `active: true` to the expected
  rows of `menu-structure.test.ts:685` and `catalogue-api.test.ts:4105` (and `active: true` on each
  expected `variants` entry), replace `menu-structure.test.ts:758` with the new case above, and add
  `active: true` to the dashboard fixtures listed under Files.
- [ ] **Step 4: run.**
  `pnpm --filter @waitron/catalogue exec vitest run src/menu-structure.test.ts src/menu-publication.test.ts src/variants.db.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-prices-table.test.ts src/screens/menus-screen.test.ts`;
  typecheck `@waitron/catalogue`, `@waitron/server`, `@waitron/dashboard`
  (`pnpm --filter <pkg> typecheck`), `pnpm format:check`. Expected: all pass.
- [ ] **Step 5: commit.** "Menus: the prices read lists Inactive products and sizes, each with its
  Active state".

## Task 2 — One size's price on one menu, written alone

**Files.**
- Modify: `packages/catalogue/src/variants.ts` (new `setMenuVariantPrice`),
  `packages/catalogue/src/index.ts:114`–`121` (export it), `packages/catalogue/src/errors.ts:89`–`91`
  (the comment: "…or, in a menu's whole-list size prices, not an Active one"),
  `apps/server/src/catalogue-api.ts` (route after `:1025`), `apps/dashboard/src/api/client.ts`
  (method after `setMenuVariants`, `:1888`).
- Test: `packages/catalogue/src/variants.db.test.ts` (in `describe("a variant's per-menu settings")`),
  `apps/server/src/catalogue-api.test.ts` (a new `it` of its own), `apps/dashboard/src/api/client-routes.test.ts:770`.

**Interfaces.**
- Produces (catalogue):
  `setMenuVariantPrice(tx: Transaction, menuItemId: string, variantId: string, price: string | null, menuId?: string): Promise<void>`
- Produces (route): `PATCH /management-api/catalogues/:id/items/:itemId/variants/:variantId`,
  body `{ price: string | null }`, 204.
- Produces (client): `setMenuVariantPrice(menuId: string, menuItemId: string, variantId: string, price: string | null): Promise<void>`

- [ ] **Step 1: failing tests** — `variants.db.test.ts`:

  ```ts
  it("sets or clears one variant's price and leaves its siblings' rows alone", async () => {
    const f = await fixture();
    const [w125, w175] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    await app((tx) => setMenuVariants(tx, f.offerId, [{ variantId: w175!.id, price: "6.00" }]));
    await app((tx) => setMenuVariantPrice(tx, f.offerId, w125!.id, "4.20", f.catalogueId));
    expect(await app((tx) => listMenuVariants(tx, f.offerId, f.catalogueId))).toEqual([
      { variantId: w125!.id, price: "4.20" },
      { variantId: w175!.id, price: "6.00" },
    ]);
    await app((tx) => setMenuVariantPrice(tx, f.offerId, w125!.id, "4.30"));
    await app((tx) => setMenuVariantPrice(tx, f.offerId, w175!.id, null));
    expect(
      await suite.db
        .select({ variantId: menuItemVariantOverrides.variantId, price: menuItemVariantOverrides.price })
        .from(menuItemVariantOverrides),
    ).toEqual([{ variantId: w125!.id, price: 430 }]);
  });

  it("sets an Inactive variant's price, kept for when it is Active again", async () => {
    const f = await fixture();
    const [w125, w175] = await app((tx) =>
      setProductVariants(tx, f.parentId, [wine("Wine 125", null), wine("Wine 175", "5.50")], "en"),
    );
    await app((tx) => setProductVariants(tx, f.parentId, [w125!], "en"));
    await app((tx) => setMenuVariantPrice(tx, f.offerId, w175!.id, "6.50"));
    await app((tx) => setProductVariants(tx, f.parentId, [w125!, { ...w175!, active: true }], "en"));
    expect(await app((tx) => listMenuVariants(tx, f.offerId))).toContainEqual({
      variantId: w175!.id,
      price: "6.50",
    });
  });

  it.each([["-1.00"], ["1.001"], ["2,50"]])(
    "refuses the price %s, naming price, and writes nothing",
    async (price) => {
      const f = await fixture();
      const [w125] = await app((tx) => setProductVariants(tx, f.parentId, [wine("Wine 125", null)], "en"));
      await expect(
        app((tx) => setMenuVariantPrice(tx, f.offerId, w125!.id, price)),
      ).rejects.toMatchObject({ code: "product.variant_invalid", params: { field: "price" } });
      expect(await suite.db.select().from(menuItemVariantOverrides)).toEqual([]);
    },
  );

  it("refuses a variant of another product, and an offer on another menu", async () => {
    const f = await fixture();
    const [foreign] = await app((tx) =>
      setProductVariants(tx, f.otherId, [wine("Cider pint", "4.00")], "en"),
    );
    const [w125] = await app((tx) => setProductVariants(tx, f.parentId, [wine("Wine 125", null)], "en"));
    await expect(
      app((tx) => setMenuVariantPrice(tx, f.offerId, foreign!.id, "1.00")),
    ).rejects.toMatchObject({ code: "product.variant_not_found", params: { variantId: foreign!.id } });
    await expect(
      app((tx) => setMenuVariantPrice(tx, f.offerId, w125!.id, "1.00", f.terraceId)),
    ).rejects.toMatchObject({ code: "menu_item.not_found", params: { menuItemId: f.offerId } });
    expect(await suite.db.select().from(menuItemVariantOverrides)).toEqual([]);
  });
  ```

  `catalogue-api.test.ts`, a new case of its own, "sets or clears one size's price on a menu
  alone", placed after the case holding the PUT at `:1530`–`1560`: create a product with two sizes
  through the product editor and put it on a new menu (as that case does, with `offerVia`), PUT the
  first size's price `4.10`, then PATCH `…/variants/<second size>` with `{ price: "2.20" }` → 204,
  and a GET of `…/variants` reads `[{ first, "4.10" }, { second, "2.20" }]` (the PUT's 4.10 is
  kept); `{ price: null }` → 204 and `price: null` back; `{ price: 2.2 }`, `{}` and `{ price: true }`
  → 400 `management.request_invalid`, `params: { field: "price" }`; `{ price: "2.20", offered: false }`
  and `{ price: "2.20", variantId: "…" }` → 400 `management.request_invalid` naming the extra field
  (`offered`, `variantId`), nothing written; `{ price: "-1.00" }` → 400 `product.variant_invalid`,
  field `price`; a random UUID size → 400 `product.variant_not_found`; `bad-id` as the size → 400
  `shared.invalid_id`; no cookie → 401; the staff cookie → 403.

  `client-routes.test.ts:770`: add `await expect(api.setMenuVariantPrice("c1", "mi1", "v1", "2.20")).resolves.toBeUndefined();`
  with a fourth `emptyResponse()` and the expected call
  `["/management-api/catalogues/c1/items/mi1/variants/v1", "PATCH", { price: "2.20" }]`. (The
  `setMenuVariants` call in the same case stays until Task 5 deletes that client method, D17.)

  Run the three files. Expected: FAIL — `setMenuVariantPrice` is not exported; the route answers 404.

- [ ] **Step 2: implement.**
  ```ts
  /**
   * Sets or clears this menu's price for one variant of the offer's product, Active or not, and
   * leaves every other variant's row as it is.
   */
  export async function setMenuVariantPrice(
    tx: Transaction,
    menuItemId: string,
    variantId: string,
    price: string | null,
    menuId?: string,
  ): Promise<void> {
    const productId = await offerProduct(tx, menuItemId, menuId);
    if (!(await listProductVariants(tx, productId)).some(({ id }) => id === variantId))
      throw new AppError("product.variant_not_found", { variantId });
    const value = validatePrice(price, "price");
    const row = and(
      eq(menuItemVariantOverrides.menuItemId, menuItemId),
      eq(menuItemVariantOverrides.variantId, variantId),
    );
    if (value === null) {
      await tx.delete(menuItemVariantOverrides).where(row);
      return;
    }
    const cents = decimalToCents(value);
    await tx
      .insert(menuItemVariantOverrides)
      .values({ menuItemId, productId, variantId, price: cents })
      .onConflictDoUpdate({
        target: [menuItemVariantOverrides.menuItemId, menuItemVariantOverrides.variantId],
        set: { price: cents },
      });
  }
  ```
  Route, after the PUT (`catalogue-api.ts:1013`–`1025`):
  ```ts
  app.patch("/management-api/catalogues/:id/items/:itemId/variants/:variantId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const menuItemId = requireUuidParam(c.req.param("itemId"), "MenuItemId");
      const variantId = requireUuidParam(c.req.param("variantId"), "ProductVariantId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const extra = Object.keys(body).find((key) => key !== "price");
      if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
      if (!Object.hasOwn(body, "price") || (body.price !== null && typeof body.price !== "string"))
        throw new AppError("management.request_invalid", { field: "price" });
      const price = body.price as string | null;
      await gated(sessionId, (tx) => setMenuVariantPrice(tx, menuItemId, variantId, price, menuId));
      return c.body(null, 204);
    }),
  );
  ```
  Client:
  ```ts
  /** A null `price` clears this menu's price for the variant, so it inherits again. */
  setMenuVariantPrice(menuId: string, menuItemId: string, variantId: string, price: string | null): Promise<void> {
    return this.#request<void>(
      `/management-api/catalogues/${menuId}/items/${menuItemId}/variants/${variantId}`,
      "PATCH",
      { price },
    );
  }
  ```
- [ ] **Step 3: run** the three files again, then
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts` from the
  root (a new thrower of an existing code; a new write of an existing table). Typecheck
  `@waitron/catalogue`, `@waitron/server`, `@waitron/dashboard`; `pnpm format:check`.
  Expected: all pass.
- [ ] **Step 4: commit.** "Menus: a size's price on a menu can be set or cleared on its own".

## Task 3 — What a blank override field inherits

**Files.**
- Create: `apps/dashboard/src/widgets/menu-price-inheritance.ts`,
  `apps/dashboard/src/widgets/menu-price-inheritance.test.ts`.

**Interfaces.**
- Consumes: `MenuPriceRow`, `MenuPriceVariant` (Task 1), `Setting`, `combinedFixture`
  (`apps/dashboard/src/widgets/test-helpers.ts:329`).
- Produces:
  ```ts
  export type Inherited = { state: "price"; low: string; high: string } | { state: "clash" };
  /** The product's price as its field reads now: undefined while untouched or holding text that is
   * not a price (no draft), null once emptied, else the price typed. */
  export type ParentPrice = string | null | undefined;
  export function withoutOwn(setting: Setting<Decimal>): Setting<Decimal>;
  export function productInherited(row: MenuPriceRow): Inherited;
  export function variantInherited(row: MenuPriceRow, variantId: string, parent: ParentPrice): Inherited;
  export function sizeClash(row: MenuPriceRow): boolean;
  ```

- [ ] **Step 1: failing tests.** In the test file, build the rows with `combinedFixture` exactly as
  `menu-prices-table.test.ts:83`–`107` (lemonade) and `:1034`–`1151` (wine, juice, tea, cider,
  steak) do, each with `active: true` and `active: true` sizes. Cases, with the expected values
  worked out from `combinedFixture`:

  | Row | Call | Expected |
  | --- | --- | --- |
  | burger (12.00, no override) | `productInherited` | `price 12.00–12.00` |
  | steak (own 18.00 over 20.00) | `productInherited` | `price 20.00–20.00` |
  | lemonade (own 2.50 over 3.00; small follows, large own 3.75 over 3.40) | `productInherited` | `price 3.00–3.75` |
  | lemonade | `variantInherited(row, "v-small", undefined)` | `2.50` (its product's saved menu price) |
  | lemonade | `variantInherited(row, "v-small", "2.80")` | `2.80` |
  | lemonade | `variantInherited(row, "v-small", null)` | `3.00` |
  | lemonade | `variantInherited(row, "v-large", undefined)` | `3.40` |
  | wine (own 13.00 over 10.00; glass own 7.00 over 6.00, bottle follows, carafe own 15.00 over 14.00) | `productInherited` | `7.00–15.00` |
  | juice (no override; small own 3.50 over 3.00, large size 5.00) | `productInherited` | `3.50–5.00` |
  | cider (pint size 4.50, half follows 4.00) | `productInherited` | `4.00–4.50` |
  | lemonade with `v-large` `active: false` | `productInherited` | `3.00–3.00` (Review focus 5) |
  | lemonade with both sizes `active: false` | `productInherited` | `3.00–3.00`, from `withoutOwn(combined.price)` — and with the parent's own 2.50 removed from `combined.price` too, still `3.00` |
  | lager with `combined.price` the clash of `menu-prices-table.test.ts:1700`–`1710` | `productInherited` | `{ state: "clash" }` |
  | lemonade whose `v-small` price is that clash with `level: "size"` | `productInherited` and `variantInherited(row, "v-small", undefined)` | both `{ state: "clash" }` |
  | lemonade whose `combined.price` is that clash | `variantInherited(row, "v-small", undefined)` | `{ state: "clash" }`; with `"2.80"` → `2.80` |
  | lemonade whose `v-large` clashes at size level and is `active: false` | `productInherited`; `variantInherited(row, "v-large", undefined)` | `price 3.00–3.00` (an Inactive size's clash stays off the product, M4); `{ state: "clash" }` on the size itself |

  Also export, and test, `sizeClash(row: MenuPriceRow): boolean` — true when an Active size's own
  setting is a clash while `combined.price` is decided (I1's case): true for lemonade with
  `v-small` the size-level clash; false when the clash is `combined.price`'s; false when the
  clashing size is Inactive.

  Also: `withoutOwn` returns the `otherwise` of an `own` setting, the setting itself for any other
  source (a size following its product keeps its product's saved price), and a clash unchanged.

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-price-inheritance.test.ts`
  Expected: FAIL — the module does not exist.

- [ ] **Step 2: implement.**
  ```ts
  import { stringToCents, type Decimal } from "@waitron/shared";
  import type { MenuPriceRow, Setting } from "../api/client.js";

  export type Inherited = { state: "price"; low: string; high: string } | { state: "clash" };
  export type ParentPrice = string | null | undefined;

  const CLASH: Inherited = { state: "clash" };
  const price = (value: string): Inherited => ({ state: "price", low: value, high: value });
  const single = (setting: Setting<Decimal>): Inherited =>
    setting.state === "decided" ? price(setting.value) : CLASH;

  /** The setting without this menu's own decision on it. */
  export function withoutOwn(setting: Setting<Decimal>): Setting<Decimal> {
    return setting.state === "decided" && setting.source.kind === "own"
      ? (setting.otherwise ?? setting)
      : setting;
  }

  function span(values: readonly Inherited[]): Inherited {
    let low: string | null = null;
    let high: string | null = null;
    for (const value of values) {
      if (value.state === "clash") return CLASH;
      if (low === null || stringToCents(value.low) < stringToCents(low)) low = value.low;
      if (high === null || stringToCents(value.high) > stringToCents(high)) high = value.high;
    }
    return low === null ? CLASH : { state: "price", low, high: high! };
  }

  function parentPrice(row: MenuPriceRow, parent: ParentPrice): Inherited {
    if (parent === undefined) return single(row.combined.price);
    return parent === null ? single(withoutOwn(row.combined.price)) : price(parent);
  }

  const sizeSetting = (row: MenuPriceRow, variantId: string) =>
    row.combined.variants.find((v) => v.variantId === variantId)!.price;

  export function variantInherited(row: MenuPriceRow, variantId: string, parent: ParentPrice): Inherited {
    const setting = withoutOwn(sizeSetting(row, variantId));
    return setting.state === "decided" && setting.source.kind === "parent"
      ? parentPrice(row, parent)
      : single(setting);
  }

  export function sizeClash(row: MenuPriceRow): boolean {
    return (
      row.combined.price.state === "decided" &&
      row.variants.some((v) => v.active && sizeSetting(row, v.variantId).state === "clash")
    );
  }

  export function productInherited(row: MenuPriceRow): Inherited {
    const active = row.variants.filter((v) => v.active);
    if (active.length === 0) return single(withoutOwn(row.combined.price));
    return span(
      active.map(({ variantId }) => {
        const setting = sizeSetting(row, variantId);
        return setting.state === "decided" && setting.source.kind === "own"
          ? price(setting.value)
          : variantInherited(row, variantId, null);
      }),
    );
  }
  ```
  **Amended during implementation (review finding).** `combineOffer` gives a size with no override
  on this menu and no size price from any source its product's setting at `level: "product"`, and
  when the product's price is a clash it is a copy of that clash with `level: "product"`, not a
  decided `parent` setting (`parent`, `packages/catalogue/src/menu-combine.ts:48`–`54`; the copy,
  `:75`–`81`). So a size follows its product, and
  `variantInherited` returns `parentPrice(row, parent)`, when its setting's `level` is `"product"`
  OR `withoutOwn(setting)` is decided with `source.kind === "parent"`. A size with its own price
  over a clash stays a clash whatever the product's field holds. The tests build every clash row with
  the real `combineOffer`.
- [ ] **Step 3: run** the test file; typecheck `@waitron/dashboard`; `pnpm format:check`. Expected:
  pass.
- [ ] **Step 4: commit.** "Menus: work out what a blank price override inherits".

## Task 4 — The Price overrides table: columns, Status and the override field drawn

The window stays in this task so the screen's saves keep working; Task 5 replaces it.

**Files.**
- Modify: `apps/dashboard/src/widgets/menu-prices-table.ts`, `apps/dashboard/src/i18n/strings.ts`,
  `apps/dashboard/src/screens/menus-screen.ts:221`–`226` (comment),
  `packages/ui-core/src/tokens/structure.css` (new token).
- Test: `apps/dashboard/src/widgets/menu-prices-table.test.ts`,
  `apps/dashboard/src/widgets/menu-prices-table.a11y.test.ts`,
  `apps/dashboard/src/screens/menus-screen.test.ts` (tab label only).

**Interfaces.**
- Consumes: `productInherited`, `variantInherited`, `withoutOwn` (Task 3); `MenuPriceRow.active`,
  `MenuPriceVariant.active` (Task 1).
- Produces: column keys `name`, `placements`, `category`, `status`, `override`, `actions`; each
  row's field is `wt-price-input[name="price-override"][data-row="<row key>"]`, the row key being
  `menuItemId` or `menuItemId:variantId` (`menu-prices-table.ts:941`–`942`); the status link is
  `a[part~="status-link"]`; the event `wt-edit-product` with `{ productId }`.

- [ ] **Step 1: strings** (English, then Spanish; same keys in both):

  | Key | English | Spanish |
  | --- | --- | --- |
  | `menus.tab_prices` (changed) | Price overrides | Precios propios |
  | `menu_prices.label` (changed) | Price overrides on {menu} | Precios propios en {menu} |
  | `menu_prices.override_column` | Price override | Precio propio |
  | `menu_prices.override_label` | Price override for {name} | Precio propio de {name} |
  | `menu_prices.override_help` (Spanish changed, D9) | Leave it empty to use the inherited price, {price}. | Si está vacío, se usa el precio heredado, {price}. |
  | `menu_prices.override_help_range` | Leave it empty to use the inherited prices, {range}. | Si está vacío, se usan los precios heredados, {range}. |
  | `menu_prices.override_help_clash` | Left empty, its sources disagree. Set a price to resolve it. | Si está vacío, sus orígenes discrepan; fijar un precio lo resuelve. |
  | `menu_prices.clash_placeholder` | Set a price | Fijar un precio |
  | `menu_prices.size_clash` | A size's sources disagree — set that size's price | Los orígenes de una variante discrepan: fijar el precio de esa variante |
  | `menu_prices.tip_inherited` | Where {name}'s inherited price comes from | De dónde viene el precio heredado de {name} |
  | `menu_prices.open_product` | open {name}'s product page | abrir la página del producto {name} |
  | `menu_prices.status_parent_inactive` | its product is Inactive | su producto está inactivo |
  | `menu_prices.price_filter` (changed) | Filter by price override | Filtrar por precio propio |
  | `menu_prices.overridden_only` (changed) | Overridden only | Solo con precio propio |

  `menu_prices.size_clash` goes on the visible marker and, for screen readers, as the field's hint;
  that field's placeholder is "—" (not translated). Every Spanish verb above addressed to the
  person is an infinitive, every description impersonal (D9).

  Also in this task: the column memory key becomes `viewKey="waitron.menus.price-overrides"` (D7);
  the screen's class comment (`menus-screen.ts:221`–`226`, "Its Prices tab lists each product the
  menu reaches and edits what the menu charges for it.") becomes "Its Price overrides tab lists
  every product the menu reaches, Active or not, and edits the price this menu sets for each product
  and size."; and the new token `--wt-price-range-field-width` is declared in
  `packages/ui-core/src/tokens/structure.css` beside `--wt-price-field-width` (`:96`), its value
  the smallest whole-pixel width that passes the measuring case below for "1000.00 – 9999.99" in
  both languages (start from 168px and adjust by measurement, not by eye).

  Delete, in both languages, once a grep of `apps/dashboard/src` finds no reader:
  `menu_prices.product_price`, `effective_price`, `price_on_menu`, `price_was`, `price_inherited`,
  `from`, `this_menu`, `tip_before`, `tip_menu`, `tip_charged`, `no_override`. Keep
  `menu_prices.menu_price` (read by `menu-preview.ts`).

- [ ] **Step 2: failing tests** in `menu-prices-table.test.ts` (new cases), plus the rewrites marked
  Task 4 in _Changed test checks_ below. Helpers to add beside `field` (`:214`):

  ```ts
  function override(el: MenuPricesTable, rowKey: string) {
    return table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
      `wt-price-input[data-row="${rowKey}"]`,
    )!;
  }
  const hintOf = (input: HTMLElement) =>
    text(input.shadowRoot!.querySelector("[data-hint]"));
  ```

  New cases:

  ```ts
  it("offers one labelled price override field per product and per size, the inherited price as a blank one's placeholder", async () => {
    setLocale("en-GB");
    try {
      const el = await mount();
      toggleOf(el, "mi-lemonade").click(); // the tree toggle, as `:1157` reads it
      await table(el).updateComplete;
      const want = [
        ["mi-burger", "Price override for Burger", "", "12.00"],
        ["mi-lemonade", "Price override for Lemonade", "2.50", "3.00 – 3.75"],
        ["mi-lemonade:v-small", "Price override for Lemonade — Small", "", "2.50"],
        ["mi-lemonade:v-large", "Price override for Lemonade — Large", "3.75", "3.40"],
        ["mi-lager", "Price override for Lager", "", "2.00"],
      ];
      for (const [key, label, value, placeholder] of want) {
        const input = override(el, key!);
        expect([input.label, input.hideLabel, input.name, input.value, input.placeholder], key).toEqual([
          label, true, "price-override", value, placeholder,
        ]);
        expect(input.required, key).toBe(false);
      }
      expect(hintOf(override(el, "mi-burger"))).toBe("Leave it empty to use the inherited price, €12.00.");
      expect(hintOf(override(el, "mi-lemonade"))).toBe(
        "Leave it empty to use the inherited prices, €3.00 – €3.75.",
      );
    } finally {
      setLocale("es-ES");
    }
  });

  it("shows a clash honestly: no price in the field, a red Clash beside it, the reason in its hint", async () => {
    setLocale("en-GB");
    try {
      const el = await mount({ rows: [clashRow(lager)] });
      const input = override(el, "mi-lager");
      expect([input.value, input.placeholder]).toEqual(["", "Set a price"]);
      expect(hintOf(input)).toBe("Left empty, its sources disagree. Set a price to resolve it.");
      const marker = cell(el, "override", "mi-lager").querySelector("[part~=clash]")!;
      expect(text(marker)).toBe("Clash");
      // Painted in the danger colour, through the table's part.
      const probe = document.createElement("span");
      probe.style.color = "var(--wt-color-danger)";
      el.parentElement!.appendChild(probe);
      expect(getComputedStyle(marker).color).toBe(getComputedStyle(probe).color);
    } finally {
      setLocale("es-ES");
    }
  });

  it.each([
    ["en-GB", "A size's sources disagree — set that size's price"],
    ["es-ES", "Los orígenes de una variante discrepan: fijar el precio de esa variante"],
  ])("sends a product row whose only clash is a size's to that size, offering no price of its own (%s)", async (locale, words) => {
    setLocale(locale);
    try {
      const el = await mount({ rows: [variantClashRow()] }); // lemonade whose v-small is clashPrice at size level, as `:1794`–`1802` builds it
      const input = override(el, "mi-lemonade");
      expect(input.placeholder).toBe("—");
      expect(input.placeholder).not.toBe(t("menu_prices.clash_placeholder"));
      expect(hintOf(input)).toBe(words);
      expect(text(cell(el, "override", "mi-lemonade").querySelector("[part~=clash]"))).toBe(words);
      toggleOf(el, "mi-lemonade").click();
      await table(el).updateComplete;
      // The size itself is the one offered a price.
      expect(override(el, "mi-lemonade:v-small").placeholder).toBe(t("menu_prices.clash_placeholder"));
    } finally {
      setLocale("es-ES");
    }
  });

  it("keeps an Inactive size's clash on its own row, off its product's", async () => {
    const row = variantClashRow();
    const el = await mount({
      rows: [{ ...row, variants: row.variants.map((v) => (v.variantId === "v-small" ? { ...v, active: false } : v)) }],
    });
    expect(cell(el, "override", "mi-lemonade").querySelector("[part~=clash]")).toBeNull();
    expect(override(el, "mi-lemonade").placeholder).toBe("3.75");
    toggleOf(el, "mi-lemonade").click();
    await table(el).updateComplete;
    expect(cell(el, "override", "mi-lemonade:v-small").querySelector("[part~=clash]")).not.toBeNull();
  });

  it("counts Active sizes only in a product's tooltip, and every stored price in the summary", async () => {
    setLocale("en-GB");
    try {
      const inactiveLarge = {
        ...lemonade,
        override: null,
        variants: [lemonade.variants[0]!, { ...lemonade.variants[1]!, active: false }],
      };
      const el = await mount({
        rows: [inactiveLarge, { ...lager, active: false, override: "4.00" }],
        nodes: [
          { memberId: "a", ref: { kind: "product", productId: "p-lemonade" } },
          { memberId: "b", ref: { kind: "product", productId: "p-lager" } },
        ],
      } as Partial<MenuPricesTable>);
      const tip = cell(el, "override", "mi-lemonade").querySelector("wt-help-tooltip")!;
      expect(tip.textContent).toContain("Small");
      expect(tip.textContent).not.toContain("Large");
      // Lemonade's only own price is on its Inactive Large; Lager is Inactive with its own price.
      expect(text(el.shadowRoot!.querySelector('[data-test="price-summary"] p:last-child'))).toBe(
        "Sets its own price for 2 of its own items",
      );
    } finally {
      setLocale("es-ES");
    }
  });

  it.each(["en-GB", "es-ES"])("fits the longest range placeholder whole inside the field (%s)", async (locale) => {
    setLocale(locale);
    try {
      const wide = {
        ...juice, // from the variants describe: no override, two sizes
        combined: combinedFixture("p-juice", "4.00",
          [{ variantId: "v-juice-small", price: "1000.00" }, { variantId: "v-juice-large", price: "9999.99" }],
          null, "4.00", { "v-juice-small": "3.00", "v-juice-large": "5.00" }),
        variants: [
          { variantId: "v-juice-small", price: "1000.00", active: true },
          { variantId: "v-juice-large", price: "9999.99", active: true },
        ],
      };
      const el = await mount({ rows: [wide], products });
      const input = override(el, "mi-juice").shadowRoot!.querySelector("input")!;
      expect(input.placeholder).toBe("1000.00 – 9999.99");
      const style = getComputedStyle(input);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = style.font;
      const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      expect(context.measureText(input.placeholder).width).toBeLessThanOrEqual(room);
    } finally {
      setLocale("es-ES");
    }
  });

  it("shows each row's own Active state as a link to its product page, a size by its own id", async () => {
    setLocale("en-GB");
    try {
      const el = await mount({
        rows: [
          burger,
          { ...lemonade, active: false },
          { ...lager, active: true },
        ],
      });
      toggleOf(el, "mi-lemonade").click();
      await table(el).updateComplete;
      const link = (key: string) => cell(el, "status", key).querySelector<HTMLAnchorElement>("a[part~=status-link]")!;
      expect([text(link("mi-burger")), link("mi-burger").getAttribute("href")]).toEqual([
        "Active", "/manage/catalogue/product/p-burger",
      ]);
      expect(link("mi-burger").getAttribute("aria-label")).toBe("Active: open Burger's product page");
      expect(text(link("mi-lemonade"))).toBe("Inactive");
      // An Active size of an Inactive product is Inactive, and says why.
      expect(text(link("mi-lemonade:v-small"))).toBe("Inactive");
      expect(link("mi-lemonade:v-small").getAttribute("href")).toBe("/manage/catalogue/product/v-small");
      expect(visibleText(cell(el, "status", "mi-lemonade:v-small"))).toBe("Inactive its product is Inactive");
    } finally {
      setLocale("es-ES");
    }
  });

  it("reads an Inactive size as Inactive under an Active product, and keeps it out of the product's range", async () => {
    const el = await mount({
      rows: [{ ...lemonade, variants: [lemonade.variants[0]!, { ...lemonade.variants[1]!, active: false }] }],
    });
    toggleOf(el, "mi-lemonade").click();
    await table(el).updateComplete;
    expect(text(cell(el, "status", "mi-lemonade:v-large").querySelector("a"))).toBe(t("product.inactive_badge"));
    expect(override(el, "mi-lemonade").placeholder).toBe("3.00");
  });

  it("opens the product page in the dashboard on a plain click, and leaves a modified click to the browser", async () => {
    const el = await mount();
    const heard = vi.fn();
    document.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
    const link = cell(el, "status", "mi-burger").querySelector<HTMLAnchorElement>("a")!;
    const plain = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, button: 0 });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "p-burger" });
    const modified = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, button: 0, metaKey: true });
    // Stop the browser following it inside the test page.
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    link.dispatchEvent(modified);
    expect(heard).toHaveBeenCalledOnce();
  });

  it("keeps Active apart from Available: a sold-out Active product reads Active", async () => {
    // `MenuPriceRow` carries no Available; the read lists a sold-out product as Active (Task 1).
    const el = await mount({ rows: [{ ...burger, active: true }] });
    expect(text(cell(el, "status", "mi-burger").querySelector("a"))).toBe(t("product.active_badge"));
    expect(text(cell(el, "status", "mi-burger"))).not.toContain(t("product.unavailable_badge"));
  });
  ```

  (`toggleOf(el, key)` is the `toggle` helper of `:1157`, moved to file scope. `variantClashRow()` is
  the row `:1794`–`1802` builds; move it to file scope beside `clashRow`.)

  In `menus-screen.test.ts`, extend `:3829`: the tab's label is `t("menus.tab_prices")`, and
  `t("menus.tab_prices", "en")`/`("es-ES")` read "Price overrides"/"Precios propios" (check the
  `t` signature in `apps/dashboard/src/i18n/t.ts` for how a test names a locale; `t.test.ts:55`
  shows the pattern).

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-prices-table.test.ts src/screens/menus-screen.test.ts`
  Expected: FAIL — no `status` or `override` column.

- [ ] **Step 3: implement** in `menu-prices-table.ts`:
  - Delete the `product-price`, `menu-price`, `effective-price`, `price-on-menu` and `from` columns
    (`:583`–`662`), `#chargedHere`, `LinePrices`/`priced`/`#prices`/`#readLines`' price work
    (keep the line list), and `menuPrice`/`variantPriced` helpers that only those used.
  - Add, after `category`:
    ```ts
    {
      key: "status",
      label: t("product.status"),
      choosable: "shown",
      sortValue: (line) => (this.#active(line) ? 0 : 1),
      searchValue: (line) => t(this.#active(line) ? "product.active_badge" : "product.inactive_badge"),
      cell: (line) => this.#status(line),
    },
    {
      key: "override",
      label: t("menu_prices.override_column"),
      align: "end",
      sortValue: (line) => {
        const shown = this.#shown(line);
        return shown.state === "price" ? stringToCents(shown.low) : null;
      },
      searchValue: (line) => {
        const shown = this.#shown(line);
        return shown.state === "price"
          ? priceSearchText(spanText(shown), [shown.low, shown.high])
          : "";
      },
      cell: (line) => this.#overrideCell(line),
      filter: {
        label: t("menu_prices.price_filter"),
        allLabel: t("menu_prices.all_prices"),
        value: (line) => (this.#overridden(line) ? "overridden" : "product"),
        options: [{ value: "overridden", label: t("menu_prices.overridden_only") }],
      },
    },
    ```
    where `#active(line)` is `line.item.active && (line.variant?.active ?? true)`;
    `#stored(line)` is `line.variant ? line.variant.price : line.item.override`;
    `#overridden(line)` is `#stored(line) !== null || (line.variant === null && line.item.variants.some((v) => v.price !== null))`
    (the filter of `:611`–`612`);
    `#inherited(line)` is `line.variant ? variantInherited(line.item, line.variant.variantId, this.#parentPrice(line.item)) : productInherited(line.item)`,
    with `#parentPrice` returning `undefined` in this task (Task 5 reads the product's draft);
    `#shown(line)` is the stored price as a one-price `Inherited` when set, else `#inherited(line)`;
    `spanText` is the existing one (`:95`–`98`) taking `{ low, high }` and comparing by
    `stringToCents`.
  - `#status(line)` draws
    ```ts
    html`<a
        part="status-link"
        data-active=${active ? "true" : "false"}
        href=${`/manage/catalogue/product/${encodeURIComponent(id)}`}
        aria-label=${`${word}: ${t("menu_prices.open_product").replace("{name}", this.#lineName(line))}`}
        @click=${(event: MouseEvent) => this.#openProduct(event, id)}
        >${word}</a
      >${viaParent ? html` <span part="muted status-note">${t("menu_prices.status_parent_inactive")}</span>` : nothing}`
    ```
    with `id = line.variant?.variantId ?? line.item.productId`, `viaParent` true for an Active size of
    an Inactive product, and `#openProduct` returning early on `event.button !== 0` or any of
    `ctrlKey`/`metaKey`/`shiftKey`/`altKey`, else `preventDefault()` and
    `this.#emit("wt-edit-product", { productId: id })` (the pattern of
    `content-languages-screen.ts:472`–`484`). `#lineName(line)` is the product's name, or
    `"<product> — <size>"`, as `#tip` builds it (`:363`–`365`).
  - `#overrideCell(line)` draws a `wt-price-input` with `name="price-override"`,
    `data-row=${rowKey}`, `hide-label`, `fixed-unit`, `locale=${currentLocale()}`,
    `label=${t("menu_prices.override_label").replace("{name}", this.#lineName(line))}`,
    `.value=${this.#stored(line) ?? ""}`, the placeholder (the raw amounts, `low` alone or
    `t("menu_prices.range")` over the raw `low`/`high`; `t("menu_prices.clash_placeholder")` for a
    clash), and the hint (`override_help` with `priceText(low)`, `override_help_range` with
    `spanText`, or `override_help_clash`); then the row's tooltip; then the clash marker; then, on a
    product row with no override whose sizes set one,
    `<span part="note muted">${t("menu_prices.variant_overrides")}</span>`. The field carries
    `part="override-field"`. The clash marker and placeholder by case:
    a product row where `sizeClash(row)` (Task 3) — placeholder "—", hint and marker
    `t("menu_prices.size_clash")`; any other row whose own setting is a clash (`#priceSetting(line)`,
    `:270`–`274`) or whose inherited state is a clash — placeholder
    `t("menu_prices.clash_placeholder")`, marker `t("menu_prices.clash")`. `#isClash` (`:337`–`342`)
    counts Active sizes only on a product row (M4).
  - The summary (`:874`–`914`) is unchanged: it already counts a product when it or any size has
    a price of this menu's own (`:897`–`898`), and now that the read lists Inactive items they count
    too (D16).
  - The tooltip: replace the three `#tip` keys with one, labelled
    `t("menu_prices.tip_inherited")`. Its text: for a product without sizes,
    `describeSetting(withoutOwn(combined.price), …)`; for a product with sizes, per Active size,
    `"<size>: <price or Clash>. <describeSetting(the size's own setting if own, else withoutOwn of it)>"`
    (today's `#tip` loop, `:354`–`362`), over Active sizes only (D16); for a size, `describeSetting(withoutOwn(setting))`, and when
    that setting's source is `parent`, followed by `describeSetting(withoutOwn(combined.price))` — so a
    size following its product still names an included menu.
  - CSS (tokens only): `wt-data-table::part(status-link)` as `content-languages-screen.ts:176`–`181`
    (`display: inline-flex; align-items: center; min-height: var(--wt-tap-min); color: var(--wt-color-primary)`);
    `wt-data-table::part(status-note)` `font-size: var(--wt-font-size-sm)`; a `price-cell` that wraps
    (`flex-wrap: wrap; justify-content: flex-end`);
    `wt-data-table::part(override-field) { --wt-price-field-width: var(--wt-price-range-field-width); }`
    (a custom property set on the field's host reaches the `width` its shadow styles read,
    `wt-price-input.ts:47`, `:55`).
- [ ] **Step 4: the Task 4 rewrites** in _Changed test checks_ (all in `menu-prices-table.test.ts`
  and `menu-prices-table.a11y.test.ts`). The a11y case `:88` becomes "accessible table with a
  product's sizes open, an Inactive row and a clash": mount with `rows` `[{ ...rows[0], active: false }, rows[1]]`,
  open lemonade, and assert a status link, an override field per shown row and a muted status note
  are drawn before `expectNoA11yViolations(host)`.
- [ ] **Step 5: run** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-prices-table.test.ts src/widgets/menu-prices-table.a11y.test.ts src/screens/menus-screen.test.ts src/screens/menus-screen.a11y.test.ts src/i18n/codes.test.ts src/i18n/t.test.ts`;
  `pnpm --filter @waitron/dashboard typecheck`; `pnpm --filter @waitron/dashboard lint`; from the
  root `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/pinned-actions-column.test.ts`;
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens` (the new token);
  `pnpm format:check`. Expected: all pass. (The measuring case and the tooltip/summary case use the
  `variants` describe's `juice` and `products`, so they go inside that describe.)
- [ ] **Step 6: commit.** "Menus: the Price overrides tab shows one price field and an Active
  status per row".

## Task 5 — Saving from the row: Enter or leaving the field, one request each, in order

**Files.**
- Modify: `apps/dashboard/src/widgets/menu-prices-table.ts`,
  `apps/dashboard/src/screens/menus-screen.ts` (`:454`–`459` state, `:927`–`938` and `:965`–`967`
  resets, `:1510`–`1569` `#saveOffer`, `:1986`–`2028` `#renderPrices`),
  `apps/dashboard/src/i18n/strings.ts`.
- Test: `apps/dashboard/src/widgets/menu-prices-table.test.ts`,
  `apps/dashboard/src/widgets/menu-prices-table.a11y.test.ts`,
  `apps/dashboard/src/screens/menus-screen.test.ts`.

**Interfaces.**
- Consumes: `setMenuVariantPrice` (Task 2), `updateMenuItem`, `ListWriteQueue`
  (`section-writes.ts:17`), the Task 4 field and row keys.
- Produces (widget):
  ```ts
  /** One field's value to write. `previous` is the stored value it replaces, for Undo. */
  export interface PriceSave {
    key: string;
    menuItemId: string;
    variantId: string | null;
    /** The product's staff name, or "<product> — <size>", for a message away from the field. */
    name: string;
    price: string | null;
    previous: string | null;
    undo?: boolean;
  }
  ```
  Properties `saving: ReadonlySet<string>` (row keys with a save queued or out),
  `refusals: Readonly<Record<string, string>>` (row key → message, for refusals that name the price
  only) and
  ```ts
  /** What the status line says. Task 6 adds `{ kind: "saved"; save: PriceSave }`. */
  export type PriceOutcome = { kind: "refused"; save: PriceSave; reason: string };
  @property({ attribute: false }) outcome: PriceOutcome | null = null;
  ```
  Event `wt-price-save` with a `PriceSave`. Removed: `editing`, `busy`, `refusal`, `OfferSave`,
  `wt-offer-edit`, `wt-offer-save`, `wt-offer-cancel`.
- Produces (screen): `#savePrice(save: PriceSave): void`; `namesThePrice(error: unknown, save: PriceSave): boolean`
  (module-level, beside the screen's other helpers).
- Removes (client, D17): `DashboardApi.setMenuVariants` (`client.ts:1888`–`1899`).

- [ ] **Step 1: strings.** Add `menu_prices.saving`: "Saving…" / "Guardando…". Delete, both
  languages, after grepping: `menu_prices.edit_heading`, `override`, `use_product_price`,
  `variants`, `variants_help`, `variants_not_saved`.
- [ ] **Step 2: failing widget tests** (the Task 5 rewrites of _Changed test checks_, written
  against these helpers, plus the new cases):

  ```ts
  async function typeIn(el: MenuPricesTable, key: string, value: string) {
    override(el, key).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  }
  async function press(el: MenuPricesTable, key: string, name: "Enter" | "Escape") {
    override(el, key).shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, composed: true, cancelable: true }),
    );
    await el.updateComplete;
  }
  async function leave(el: MenuPricesTable, key: string) {
    override(el, key).dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    await el.updateComplete;
  }
  function priceSaves(el: MenuPricesTable) {
    const heard = vi.fn<(detail: PriceSave) => void>();
    el.addEventListener("wt-price-save", (event) => heard((event as CustomEvent<PriceSave>).detail));
    return heard;
  }
  ```

  New cases (besides the rewrites):

  ```ts
  it("sends one save for Enter followed by leaving the field", async () => {
    const el = await mount();
    const heard = priceSaves(el);
    await typeIn(el, "mi-burger", "11.00");
    await press(el, "mi-burger", "Enter");
    el.saving = new Set(["mi-burger"]);
    await el.updateComplete;
    await leave(el, "mi-burger");
    expect(heard).toHaveBeenCalledExactlyOnceWith({
      key: "mi-burger", menuItemId: "mi-burger", variantId: null, name: "Burger",
      price: "11.00", previous: null,
    });
  });

  it("refuses a decimal comma beside the field and sends nothing", async () => {
    const el = await mount();
    const heard = priceSaves(el);
    await typeIn(el, "mi-burger", "2,50");
    await press(el, "mi-burger", "Enter");
    expect(heard).not.toHaveBeenCalled();
    expect(override(el, "mi-burger").error).toBe(t("editor.price_invalid"));
    expect(override(el, "mi-burger").value).toBe("2,50");
  });

  it("keeps the sent price in the field while its save is out, whatever a re-read says, and lets it go once saved", async () => {
    const el = await mount();
    await typeIn(el, "mi-burger", "11.00");
    await press(el, "mi-burger", "Enter");
    el.saving = new Set(["mi-burger"]);
    el.rows = [burger, lemonade, lager]; // a live re-read from before the write landed
    await el.updateComplete;
    expect(override(el, "mi-burger").value).toBe("11.00");
    el.rows = [{ ...burger, override: "11.00" }, lemonade, lager];
    el.saving = new Set();
    await el.updateComplete;
    expect(override(el, "mi-burger").value).toBe("11.00");
    el.rows = [{ ...burger, override: "10.00" }, lemonade, lager]; // a later change from elsewhere
    await el.updateComplete;
    expect(override(el, "mi-burger").value).toBe("10.00");
  });

  it("saves a size's field alone, and a size following its product hints the product's typed price", async () => {
    const el = await mount();
    toggleOf(el, "mi-lemonade").click();
    await table(el).updateComplete;
    await typeIn(el, "mi-lemonade", "2.80");
    expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.80");
    await typeIn(el, "mi-lemonade", "");
    expect(override(el, "mi-lemonade:v-small").placeholder).toBe("3.00");
    const heard = priceSaves(el);
    await typeIn(el, "mi-lemonade:v-small", "1.90");
    await press(el, "mi-lemonade:v-small", "Enter");
    expect(heard).toHaveBeenCalledExactlyOnceWith({
      key: "mi-lemonade:v-small", menuItemId: "mi-lemonade", variantId: "v-small",
      name: "Lemonade — Small", price: "1.90", previous: null,
    });
  });

  it("puts a refusal under the field whose save it answers, and nowhere else, and moves focus to it", async () => {
    const el = await mount();
    const other = override(el, "mi-lager");
    other.focus();
    el.refusals = { "mi-burger": "Refused here" };
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    const refused = override(el, "mi-burger");
    expect(refused.error).toBe("Refused here");
    expect(other.error).toBe("");
    expect(refused.shadowRoot!.activeElement).toBe(refused.shadowRoot!.querySelector("input"));
  });

  it("says a refusal in the status line, and moves no focus for one that names no field", async () => {
    setLocale("en-GB");
    try {
      const el = await mount();
      const other = override(el, "mi-lager");
      other.focus();
      const save = { key: "mi-burger", menuItemId: "mi-burger", variantId: null, name: "Burger", price: "11.00", previous: null };
      el.outcome = { kind: "refused", save, reason: "The server could not be reached." };
      await el.updateComplete;
      const line = el.shadowRoot!.querySelector('[data-test="price-outcome"]')!;
      expect(line.getAttribute("role")).toBe("status");
      expect(text(line)).toBe("Your change to Burger was not saved. The server could not be reached.");
      expect(override(el, "mi-burger").error).toBe("");
      expect(other.matches(":focus-within")).toBe(true);
    } finally {
      setLocale("es-ES");
    }
  });

  it("does not resend a refused price on leaving the field unchanged, and resends it on Enter", async () => {
    const el = await mount();
    const heard = priceSaves(el);
    await typeIn(el, "mi-burger", "11.00");
    await press(el, "mi-burger", "Enter");
    el.saving = new Set(["mi-burger"]);
    await el.updateComplete;
    el.saving = new Set();
    el.refusals = { "mi-burger": "Refused here" };
    await el.updateComplete;
    await leave(el, "mi-burger");
    expect(heard).toHaveBeenCalledOnce();
    await press(el, "mi-burger", "Enter");
    expect(heard).toHaveBeenCalledTimes(2);
    await typeIn(el, "mi-burger", "11.50");
    await leave(el, "mi-burger");
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("treats an unfinished product price as no change for its sizes' hints", async () => {
    const el = await mount();
    toggleOf(el, "mi-lemonade").click();
    await table(el).updateComplete;
    await typeIn(el, "mi-lemonade", "2.");
    expect(override(el, "mi-lemonade:v-small").placeholder).toBe("2.50");
  });

  it("restores the stored price on Escape, and sends nothing", async () => {
    const el = await mount();
    const heard = priceSaves(el);
    await typeIn(el, "mi-lemonade", "9.99");
    await press(el, "mi-lemonade", "Escape");
    expect(override(el, "mi-lemonade").value).toBe("2.50");
    await leave(el, "mi-lemonade");
    expect(heard).not.toHaveBeenCalled();
  });

  it("draws a product's name as plain text, with no window behind it", async () => {
    const el = await mount();
    expect(cell(el, "name", "mi-lemonade").querySelector("wt-button")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(visibleText(cell(el, "name", "mi-lemonade"))).toBe(`Lemonade ${t("menu_prices.has_variants")}`);
  });

  it("keeps every field editable while a save is out, the saving one marked", async () => {
    const el = await mount({ saving: new Set(["mi-burger"]) });
    expect(override(el, "mi-burger").disabled).toBe(false);
    expect(override(el, "mi-lager").disabled).toBe(false);
    expect(text(cell(el, "override", "mi-burger").querySelector("[part~=saving]"))).toBe(t("menu_prices.saving"));
    expect(cell(el, "override", "mi-lager").querySelector("[part~=saving]")).toBeNull();
  });

  it("'Set a price…' in Resolve focuses the row's field", async () => {
    const el = await mount({ rows: [clashRow(lager)] });
    const actions = row(el, "mi-lager")!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>("wt-row-actions")!;
    await actions.updateComplete;
    actions.show();
    [...actions.querySelectorAll<HTMLElement>("wt-button")].at(-1)!.click();
    await el.updateComplete;
    const input = override(el, "mi-lager");
    expect(input.shadowRoot!.activeElement).toBe(input.shadowRoot!.querySelector("input"));
  });
  ```

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-prices-table.test.ts`
  Expected: FAIL.

- [ ] **Step 3: implement the widget.**
  - Delete the window: `Draft`, `OfferSave`, `#opened`, `#seed`, `#row`, `#edit`, `#editVariant`,
    `#validate`'s form shape, `#fieldKeys`, `#save`, `#cancel`, `#renderForm`, `#renderModal`, the
    `wt-modal`/`wt-form-actions` imports and styles (`.fields`, `.help`, `fieldset`, `legend`, `h3`),
    and the name button (`:534`–`544`): the name becomes `<span part="name">${item.name}</span>`.
  - State:
    ```ts
    @property({ attribute: false }) saving: ReadonlySet<string> = new Set();
    @property({ attribute: false }) refusals: Readonly<Record<string, string>> = {};
    /** Text typed into a field and not yet settled: unsent, sent and waiting, or refused. */
    @state() private drafts: ReadonlyMap<string, string> = new Map();
    /** Fields whose last Enter or leaving failed the field's own check. */
    @state() private invalid: ReadonlySet<string> = new Set();
    /** The text each field last sent, so a second commit of it sends nothing. */
    #sent = new Map<string, string>();
    /** Host refusals hidden since their field changed. */
    @state() private hidden: ReadonlySet<string> = new Set();
    ```
  - `willUpdate`: when `refusals` changes, `hidden = new Set()`. When `saving` changes, for each key
    in the old set and not the new one, with no refusal: if `drafts.get(key) === #sent.get(key)`,
    drop the draft and `#sent` entry (the re-read that finished the save already holds the stored
    value).
  - Field value: `drafts.get(key) ?? stored ?? ""`. Error: `invalid.has(key) ? t("editor.price_invalid") : hidden.has(key) ? "" : refusals[key] ?? ""`.
  - `wt-change` (stop it): set the draft; add `key` to `hidden`; if `invalid.has(key)`, re-check and
    drop it from `invalid` when the text is now blank or `isProductPrice`.
  - `#commit(line, via: "enter" | "leave")`, on Enter (keep focus) and on `focusout`:
    ```ts
    const key = rowKey(line);
    const text = this.drafts.get(key);
    if (text === undefined) return;
    // A refused price is sent again only on Enter, or once the field has changed (M7).
    if (via === "leave" && key in this.refusals && !this.hidden.has(key)) return;
    const price = blankToNull(text);
    if (price !== null && !isProductPrice(price)) {
      this.invalid = new Set([...this.invalid, key]);
      return;
    }
    const waiting = this.saving.has(key);
    const baseline = waiting ? blankToNull(this.#sent.get(key) ?? "") : this.#stored(line);
    if (samePrice(price, baseline)) {
      if (!waiting) this.#forget(key);
      return;
    }
    this.#sent.set(key, text);
    this.#emit("wt-price-save", {
      key, menuItemId: line.item.menuItemId, variantId: line.variant?.variantId ?? null,
      name: this.#lineName(line), price, previous: this.#stored(line),
    } satisfies PriceSave);
    ```
  - Escape: if `saving.has(key)` set the draft back to `#sent.get(key)`, else `#forget(key)` (drop
    draft, `invalid`, `#sent`).
  - `#parentPrice(row)`: the product field's draft — `undefined` when there is none or its trimmed
    text is not a price (an unfinished "2." is treated as no draft, so the sizes keep the saved
    price as their hint), `null` when it is blank, else the trimmed price. A case in Step 2 pins it:
    typing "2." in Lemonade's field leaves the Small's placeholder at "2.50".
  - Resolve: a candidate button emits `wt-price-save` with that price (`previous` the stored value);
    "Set a price…" calls `.focus()` on `wt-price-input[data-row=<key>]` after `hide()`.
  - Saving marker: `<span part="muted saving">${t("menu_prices.saving")}</span>` in the override
    cell while `saving.has(key)`.
  - Focus on a refusal (D10): in `updated`, when `refusals` changed, take the first key in it that
    was not in the previous value and whose row is drawn, and `.focus()` its
    `wt-price-input[data-row=<key>]` (as `#focusInvalid` does for the window today, `:249`–`256`).
    If the row is a size under a collapsed product, the field is not drawn; open nothing and leave
    focus — the status line still says it (a case pins that nothing throws).
  - The status line, below the table:
    ```ts
    html`<div class="outcome">
      <p role="status" data-test="price-outcome">${this.#outcomeText()}</p>
    </div>`
    ```
    always rendered (empty while `outcome` is null) so a screen reader hears what lands in it;
    `.outcome { position: sticky; bottom: 0; padding-block: var(--wt-space-2); background: var(--wt-color-bg); }`
    so it stays in view at the bottom of the window while the rows scroll (M9). `#outcomeText` for a
    refused outcome is `t("menus.change_not_saved")` with `{name}` and `{reason}`.
- [ ] **Step 4: failing screen tests** (the Task 5 rewrites of _Changed test checks_ in
  `menus-screen.test.ts`), with helpers replacing `pricesModal`/`openOffer`/`inOffer`/`offerField`/
  `reprice` (`:3801`–`3827`):

  ```ts
  function priceField(el: MenusScreen, key: string) {
    const table = prices(el).shadowRoot!.querySelector<Table>("wt-data-table")!;
    return table.shadowRoot.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
      `wt-price-input[data-row="${key}"]`,
    )!;
  }
  async function commitPrice(el: MenusScreen, key: string, value: string) {
    type(priceField(el, key), value);
    await el.updateComplete;
    priceField(el, key).shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    await el.updateComplete;
  }
  ```

  In `WRITES` (`:300`–`312`) replace `"setMenuVariants"` with `"setMenuVariantPrice"`, and in
  `api()` (`:515`) replace the `setMenuVariants` mock with
  `setMenuVariantPrice: vi.fn().mockResolvedValue(undefined)` (D17: the client method goes). New
  cases:

  ```ts
  it("says a connection failure in the status line, under no field", async () => {
    const client = api({ updateMenuItem: vi.fn().mockRejectedValue({ code: "connection.failed" }) });
    const el = await mountPrices(client);
    await commitPrice(el, "mi-burger", "11.00");
    await vi.waitFor(() =>
      expect(prices(el).outcome).toMatchObject({ kind: "refused", reason: codeMessage("connection.failed") }),
    );
    expect(prices(el).refusals).toEqual({});
    expect(priceField(el, "mi-burger").error).toBe("");
    expect(priceField(el, "mi-burger").value).toBe("11.00");
    expect(q(el, '[data-test="member-error"]')).toBeNull();
  });

  it.each([
    ["mi-burger", { code: "management.request_invalid", params: { field: "grossPrice" } }],
    ["mi-lemonade:v-small", { code: "product.variant_invalid", params: { field: "price" } }],
    ["mi-lemonade:v-small", { code: "product.variant_not_found", params: { variantId: "v-small" } }],
  ])("puts a refusal naming %s's price under its field, and focuses it", async (key, refusal) => {
    const client = api({
      listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
      updateMenuItem: vi.fn().mockRejectedValue(refusal),
      setMenuVariantPrice: vi.fn().mockRejectedValue(refusal),
    });
    const el = await mountPrices(client);
    await expandPrices(el, "mi-lemonade");
    await commitPrice(el, key, "1.90");
    await vi.waitFor(() => expect(priceField(el, key).error).toBe(codeMessage(refusal.code)));
    const input = priceField(el, key);
    await vi.waitFor(() => expect(input.shadowRoot!.activeElement).toBe(input.shadowRoot!.querySelector("input")));
  });

  it("passes a product-only resolve through as one product write", async () => {
    const client = api();
    const el = await mountPrices(client);
    emit(prices(el), "wt-price-save", {
      key: "mi-lemonade", menuItemId: "mi-lemonade", variantId: null, name: "Lemonade",
      price: "3.50", previous: "2.50",
    });
    await vi.waitFor(() =>
      expect(client.updateMenuItem).toHaveBeenCalledExactlyOnceWith("menu-lunch", "mi-lemonade", { grossPrice: "3.50" }),
    );
    expect(client.setMenuVariantPrice).not.toHaveBeenCalled();
  });
  ```

  (The last replaces `:6520`, I4.) Further new cases:

  ```ts
  it("writes two fields one after the other, the second waiting for the first's answer", async () => {
    const first = deferred<void>();
    const client = api({
      listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
      updateMenuItem: vi.fn(() => first.promise),
    });
    const el = await mountPrices(client);
    await expandPrices(el, "mi-lemonade"); // clicks the row's tree toggle
    await commitPrice(el, "mi-burger", "11.00");
    await commitPrice(el, "mi-lemonade:v-small", "1.90");
    expect(client.updateMenuItem).toHaveBeenCalledOnce();
    expect(client.setMenuVariantPrice).not.toHaveBeenCalled();
    expect([...prices(el).saving].sort()).toEqual(["mi-burger", "mi-lemonade:v-small"]);
    first.resolve();
    await vi.waitFor(() =>
      expect(client.setMenuVariantPrice).toHaveBeenCalledExactlyOnceWith("menu-lunch", "mi-lemonade", "v-small", "1.90"),
    );
    await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
    expect(writeCalls(client)).toEqual(["updateMenuItem", "setMenuVariantPrice"]);
  });

  it("still sends a queued save after the one before it is refused", async () => {
    const client = api({
      updateMenuItem: vi.fn()
        .mockRejectedValueOnce({ code: "management.request_invalid", params: { field: "grossPrice" } })
        .mockResolvedValue(undefined),
    });
    const el = await mountPrices(client);
    await commitPrice(el, "mi-burger", "11.00");
    await commitPrice(el, "mi-lager", "2.10");
    await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(priceField(el, "mi-burger").error).toBe(codeMessage("management.request_invalid")));
    expect(priceField(el, "mi-burger").value).toBe("11.00");
  });

  it("reports beside the list, naming the product, a refusal for a row the menu no longer lists", async () => {
    const pending = deferred<void>();
    const live = new LiveData();
    const client = api({ liveData: live, updateMenuItem: vi.fn(() => pending.promise) });
    const el = await mountPrices(client);
    await commitPrice(el, "mi-burger", "11.00");
    client.getMenuPrices.mockResolvedValue(lunchPrices().filter((r) => r.menuItemId !== "mi-burger"));
    live.invalidate([{ type: "menu_items" }]);
    await vi.waitFor(() => expect(prices(el).rows.map((r) => r.menuItemId)).not.toContain("mi-burger"));
    pending.reject({ code: "menu_item.not_found" });
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="member-error"]'))).toBe(
        t("menus.change_not_saved").replace("{name}", "Burger").replace("{reason}", codeMessage("menu_item.not_found")),
      ),
    );
  });

  it("saves an edit left by choosing another tab", async () => {
    const client = api();
    const el = await mountPrices(client);
    type(priceField(el, "mi-burger"), "11.00");
    await el.updateComplete;
    priceField(el, "mi-burger").dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    await chooseTab(el, "structure");
    await vi.waitFor(() =>
      expect(client.updateMenuItem).toHaveBeenCalledExactlyOnceWith("menu-lunch", "mi-burger", { grossPrice: "11.00" }),
    );
  });
  ```

  (`LiveData` and its `invalidate` are used as `:4131`–`4152` use them; `expandPrices` clicks `tr[data-row-key=<key>] button.tree-toggle` in the table's
  shadow root and awaits its `updateComplete`.)

  Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts`.
  Expected: FAIL.
- [ ] **Step 5: implement the screen.**
  ```ts
  /** Whether a refusal is about the price typed, so it belongs under that field
   * (as `course-list.ts:28`–`31` decides for a course's name). */
  function namesThePrice(error: unknown, save: PriceSave): boolean {
    const code = codeOf(error);
    const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
    return (
      (code === "product.variant_invalid" && field === "price") ||
      (code === "management.request_invalid" && (field === "grossPrice" || field === "price")) ||
      (code === "product.variant_not_found" && save.variantId !== null)
    );
  }

  readonly #priceWrites = new ListWriteQueue();
  readonly #pendingPrices = new Map<string, number>();
  @state() private savingPrices: ReadonlySet<string> = new Set();
  @state() private priceRefusals: Readonly<Record<string, string>> = {};
  @state() private priceOutcome: PriceOutcome | null = null;

  #countPending(key: string, by: 1 | -1): void {
    const left = (this.#pendingPrices.get(key) ?? 0) + by;
    if (left === 0) this.#pendingPrices.delete(key);
    else this.#pendingPrices.set(key, left);
    this.savingPrices = new Set(this.#pendingPrices.keys());
  }

  /** One field per request, in the order made; each field stays editable meanwhile. */
  #savePrice(save: PriceSave): void {
    const menuId = this.menuId;
    if (menuId === null) return;
    const { [save.key]: _dropped, ...others } = this.priceRefusals;
    this.priceRefusals = others;
    this.priceOutcome = null;
    this.#countPending(save.key, 1);
    this.#priceWrites.run(save.key, async () => {
      try {
        if (save.variantId === null)
          await this.api.updateMenuItem(menuId, save.menuItemId, { grossPrice: save.price });
        else
          await this.api.setMenuVariantPrice(menuId, save.menuItemId, save.variantId, save.price);
      } catch (error) {
        const reason = codeMessage(codeOf(error));
        const shown =
          this.menuId === menuId &&
          this.view === "prices" &&
          (this.prices ?? []).some(({ menuItemId }) => menuItemId === save.menuItemId);
        if (shown) {
          if (namesThePrice(error, save))
            this.priceRefusals = { ...this.priceRefusals, [save.key]: reason };
          this.priceOutcome = { kind: "refused", save, reason };
        } else
          this.memberError = t("menus.change_not_saved")
            .replace("{name}", save.name)
            .replace("{reason}", reason);
        this.#countPending(save.key, -1);
        return;
      }
      if (this.menuId === menuId && this.view === "prices") await this.#watchPrices(menuId);
      this.#countPending(save.key, -1);
    });
  }
  ```
  Remove `editingOffer`, `savingOffer`, `offerRefusal`, `#saveOffer`, and their resets
  (`:933`–`934`, `:966`–`967`); reset `priceRefusals = {}` and `priceOutcome = null` where those
  were reset, and cut the comment at `:927`–`928` about the window. `#renderPrices` binds
  `.saving=${this.savingPrices}`, `.refusals=${this.priceRefusals}`, `.outcome=${this.priceOutcome}`
  and `@wt-price-save` (stop it, then `#savePrice`), and drops `.editing`, `.busy`, `.refusal` and
  the three `wt-offer-*` listeners. Delete `DashboardApi.setMenuVariants` (`client.ts:1888`–`1899`)
  once `grep -rn setMenuVariants apps/dashboard/src` finds only tests, and drop its call and
  expected route from `client-routes.test.ts:770` (the server route keeps its own tests,
  `catalogue-api.test.ts:1530`–`1560`, `:4755`–`4768`).
- [ ] **Step 6: a11y.** In `menu-prices-table.a11y.test.ts` replace the window cases (`:105`,
  `:112`) with: "accessible fields, one refused and one saving" (mount with
  `refusals: { "mi-lemonade": "Refused" }`, `saving: new Set(["mi-burger"])`, lemonade open) and
  "accessible field refusing a malformed price" (type `-1`, press Enter, assert
  `error === t("editor.price_invalid")`), each in both themes.
- [ ] **Step 7: run** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-prices-table.test.ts src/widgets/menu-prices-table.a11y.test.ts src/screens/menus-screen.test.ts src/screens/menus-screen.a11y.test.ts src/api/client-routes.test.ts`;
  `pnpm --filter @waitron/dashboard typecheck`; lint; `pnpm format:check`. Expected: all pass.
- [ ] **Step 8: commit.** "Menus: a price override is saved from its own row, on Enter or on
  leaving the field".

## Task 6 — Saved, not saved, and Undo

**Files.** `apps/dashboard/src/widgets/menu-prices-table.ts`,
`apps/dashboard/src/screens/menus-screen.ts`, `apps/dashboard/src/i18n/strings.ts`; tests
`menu-prices-table.test.ts`, `menu-prices-table.a11y.test.ts`, `menus-screen.test.ts`.

**Interfaces.**
- Consumes: the status line, `outcome` and the refused `PriceOutcome` of Task 5.
- Produces: the second kind of the widget's `PriceOutcome`:
  ```ts
  export type PriceOutcome =
    | { kind: "saved"; save: PriceSave }
    | { kind: "refused"; save: PriceSave; reason: string };
  ```

- [ ] **Step 1: strings.**

  | Key | English | Spanish |
  | --- | --- | --- |
  | `menu_prices.saved` | Saved {name}'s price override: {price}. | Guardado el precio propio de {name}: {price}. |
  | `menu_prices.cleared` | {name} now uses the inherited price. | {name} usa ahora el precio heredado. |
  | `menu_prices.undo` | Undo | Deshacer |

  A refused outcome reuses `menus.change_not_saved`.
- [ ] **Step 2: failing tests.**
  - widget: a saved outcome reads `Saved Burger's price override: €11.00.` (en-GB) in the status
    line, with an Undo button `[data-test="price-undo"]` beside it, outside the `role="status"`
    element; Undo emits `wt-price-save` with `price` and `previous` swapped and `undo: true`, and
    its click does not reach a listener on the widget's parent; a saved outcome with `undo: true`
    draws no Undo; a cleared one reads `Burger now uses the inherited price.`; a refused one still
    draws no Undo.
  - screen: after a successful commit, `prices(el).outcome` is `{ kind: "saved", save }` once the
    re-read has finished; clicking Undo calls `updateMenuItem("menu-lunch", "mi-burger", { grossPrice: null })`;
    opening another menu or tab clears the outcome; and (M6) a save that finishes after the person
    has gone to another menu, or to the Structure tab, sets no saved outcome — extend `:4111` and
    `:4201` to assert `prices(el).outcome` is null after the save resolves.
  - a11y: axe on a saved outcome with its Undo, both themes.

  Run the three files. Expected: FAIL.
- [ ] **Step 3: implement.** Screen: in `#savePrice`, after a successful write, the re-read and the
  saved outcome sit under one guard (M6):
  ```ts
  if (this.menuId === menuId && this.view === "prices") {
    await this.#watchPrices(menuId);
    if (this.menuId === menuId && this.view === "prices") this.priceOutcome = { kind: "saved", save };
  }
  ```
  Widget: the Task 5 status line gains the Undo button
  ```ts
  ${this.outcome?.kind === "saved" && !this.outcome.save.undo
    ? html`<wt-button variant="secondary" data-test="price-undo"
        @click=${(event: Event) => { event.stopPropagation(); this.#undo(); }}
        >${t("menu_prices.undo")}</wt-button>`
    : nothing}
  ```
  after the `role="status"` paragraph, the `.outcome` box laid out with
  `display: flex; flex-wrap: wrap; align-items: center; gap: var(--wt-space-2)`.
- [ ] **Step 4: run** the three files, typecheck, lint, `pnpm format:check`. Expected: pass.
- [ ] **Step 5: commit.** "Menus: say what a price override save did, with Undo".

## Task 7 — Look at it in real Chromium

The dashboard's tests run in headless Chromium with the real theme tokens
(`mountWidget(tag, props, theme)` sets `data-theme`, `apps/dashboard/src/widgets/test-helpers.ts:42`–`60`),
and Vitest's `page.screenshot` saves a PNG under the test file's `__screenshots__/` folder, which
`.gitignore:20` ignores.

- [ ] **Step 1.** Write a throwaway `apps/dashboard/src/widgets/menu-prices-table.look.test.ts`
  (never committed) that, for each theme (`light`, `dark`) and each width (`page.viewport(1280, 900)`
  and `page.viewport(390, 844)`), mounts the table with the `variants` describe's rows
  (`menu-prices-table.test.ts:1034`–`1151`) plus `clashRow(lager)`, `{ ...burger, active: false }`
  and a lemonade whose Large is `active: false`, opens Wine and Lemonade, sets
  `refusals: { "mi-wine:v-glass": "Refused here" }`, `saving: new Set(["mi-juice"])` and a saved
  `outcome`, and calls `await page.screenshot({ path: \`prices-${theme}-${width}.png\` })`. Run it
  in English and in Spanish (`setLocale("en-GB")`, `setLocale("es-ES")`), and add the measuring
  row of Task 4 (a range of "1000.00 – 9999.99"), so each screenshot shows the widest range
  placeholder at 390 px in both languages. For the status line, mount 30 rows (copies of burger
  with distinct `menuItemId`s) in a box of the window's height, scroll the last row's field into
  view, type into it, set a saved `outcome`, and screenshot again.
  Run it with `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-prices-table.look.test.ts`.
- [ ] **Step 2.** Open each PNG (the Read tool shows images) and check: the field, its placeholder
  and the euro sign are readable in both themes; the Clash marker, the refusal under the glass's
  field and "Saving…" are visible; the Status link reads as a link; at 390 px the page does not
  scroll sideways and the table scrolls inside its box with Resolve pinned; the size rows sit under
  their product, indented; the "1000.00 – 9999.99" placeholder shows whole, both ends, in both
  languages at 390 px; "A size's sources disagree — set that size's price" wraps rather than
  widening the cell past the screen; and with the last of 30 rows being edited, the status line
  with its Undo is in view at the bottom of the window. Note anything wrong in the ledger and fix it in the task that owns it.
- [ ] **Step 3.** Also through the dev stack, for what a mounted widget cannot show (the Products
  page opening from Status, a real save and its re-read): `wa-wt demo waitron-feat-menus-price-overrides`,
  sign in, open a menu that includes Drinks, then its Price overrides tab; set and clear a price on a
  product and on a size, use Undo, make a product Inactive on its Products page and come back, and
  press its Status link. Both themes, 1280 and 390 px wide. `wa-wt down waitron-feat-menus-price-overrides`
  after.
- [ ] **Step 4.** Delete the throwaway file and `apps/dashboard/src/widgets/__screenshots__/menu-prices-table.look.test.ts/`.
  Record what was looked at, and what was not, in the ledger; it goes into the PR description.

## Task 8 — Documentation and backlog (docs only; same branch)

- [ ] **`docs/developers/products.md`**, _Price_ (`:307`–`330`): "the menu screen shows that price as
  the empty field's hint" becomes "a menu's Price overrides tab shows the price a blank field
  inherits as its placeholder: one amount, the range across a product's Active sizes, or a clash";
  add that saving a size's price on a menu writes that size's row alone (`setMenuVariantPrice`,
  `packages/catalogue/src/variants.ts`), Active or Inactive, while `setMenuVariants` replaces every
  Active size's row. In _Active and Available_ (`:331`–`354`), add: the Price overrides tab lists
  every product the menu's structure reaches, Inactive ones and their sizes too, with a Status column
  (a size reads Inactive when it or its product is); offers, publishing and the till still leave
  Inactive items out (`menuPrices` versus `listMenuOffers`, `packages/catalogue/src/operations.ts`).
- [ ] **`docs/developers/product-categories.md`** `:118`–`136`: rows include Inactive products, each
  with `active`, and `variants` lists every size as `{ variantId, price, active }`, Inactive ones
  included, while `combined.variants` explains each; add the new route after the PATCH paragraph
  (`:112`–`116`): body `{ price }`, 204, `management.request_invalid` for a missing or non-string
  non-null `price`, `product.variant_invalid` for a malformed one, `product.variant_not_found` (400)
  for a size not of the product, `menu_item.not_found` (404) for an item the menu no longer reaches.
- [ ] **`docs/developers/design-system.md`**:
  - `:852`–`855`: the menu Prices tab no longer hides a column by default; name the adjustments
    report's two hidden columns instead (`packages/adjustments/src/dashboard/adjustment-report-screen.ts:578`, `:671`).
  - `:1794`–`1807`: after the course list (A212), add W89 as the third owner-approved exception to
    "every edit opens a `wt-modal`": a menu's Price overrides tab sets each product's and size's
    price in its own row, saving each change as it is made (owner 2026-10-04).
  - Under _Forms_, a short subsection "A value saved from its own table row" stating the pattern
    (decisions D10, D12, D15), citing `apps/dashboard/src/widgets/course-list.ts` as the first user
    and `apps/dashboard/src/widgets/menu-prices-table.ts` as the second: a field with `hide-label`
    and a label naming its row; saved on Enter or on leaving the field, Escape restores; the
    field's own check under it; a refusal that names the field under it, with focus moved there,
    and any other refusal said for the list; no bottom message and no Save button. Say where the
    two differ and why: the course list makes its one field read-only while a save is out; the
    price table keeps every field editable (D15), runs saves one at a time, and says each outcome in
    a status line that stays in view, with Undo.
  - `:210` (the structure tokens list): add `--wt-price-range-field-width`, and in the
    `wt-price-input` row (`:421`) one sentence: a table that shows a range as a placeholder widens
    the amount by setting `--wt-price-field-width` to it on the field's host.
  - _Products: Active and Available_ (`:2273`–`2283`): the menu Price overrides tab shows Active or
    Inactive as a link to the product page and never shows Available.
- [ ] **`docs/backlog.md`**: add, right after the W90 entry (`:3165`–`3190`):

  > **A menu's prices are one editable Price overrides field per row — DONE (W89, this PR,
  > 2026-10-05; owner 2026-10-04).** The menu editor's Prices tab is now "Price overrides"
  > ("Precios propios"). Each product and each size has one price field in its row: blank, it shows
  > the price it inherits as its placeholder — one amount, the range across a product's Active sizes,
  > or "Set a price" beside a red Clash when its sources disagree (a product whose only clash is in
  > one of its sizes says so and points at that size); with an override, it shows that price. Enter
  > or leaving the field saves it, Escape puts the stored price back, and emptying it gives the
  > inheritance back. A refusal about the price goes under its field and takes focus there; any
  > other is said in a status line that stays in view, which also says what was saved, with Undo.
  > The window behind the product name, and the Before this menu, Menu price, Effective price,
  > Price on this menu and From columns, are gone. Main category starts shown and keeps its filter;
  > the table keeps its column choices under a new key, so a choice saved for the old columns is
  > not read (as W87 did for the Menus list). A Status column
  > says Active or Inactive and links to the product's page; the tab now lists Inactive products and
  > sizes (the management prices read includes them, each with `active`), while offers, publishing
  > and tills still leave them out. A new route,
  > `PATCH /management-api/catalogues/:id/items/:itemId/variants/:variantId`, sets one size's price
  > alone. No migration. The test checks this change rewrote or deleted are in the PR's "Changed test
  > checks" and in the plan (`docs/superpowers/plans/2026-10-05-w89-menu-price-overrides.md`). Not
  > checked: <what Task 7 did not look at>.

  Edit what it makes stale: `:369`–`376` (the window's `menu_prices.variants_help` paragraph no
  longer exists; the tab is "Price overrides"), and `:905` ("the menu prices table on a menu's
  Prices tab" → "Price overrides tab").
- [ ] **Sweep**: `/usr/bin/grep -rn -i "prices tab\|menu price window\|price window\|Before this menu\|Effective price\|Price on this menu" docs/developers docs/backlog.md README.md apps/*/README.md packages/*/README.md`;
  fix what describes the old tab (history entries in the backlog that describe a past change stay).
- [ ] From the root, `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/migrations-match-schema.test.ts`.
  Expected: pass.
- [ ] Commit: "Docs: the menu Price overrides tab, its Status column and the single-size price
  route".

Then `/finish-branch` with this plan and the ledger named. The PR description carries "Changed
test checks" (the table below) and Task 7's look; add the FYI entry to
`/Users/clintongormley/waitron-campaign-b/questions.md` headed
`W89 (#PR) — changed test checks, FYI, no answer needed`, pointing at the PR section.

---

## Coverage: brief → task

| Brief requirement | Task |
| --- | --- |
| Rename Prices to "Price overrides", both languages | 4 |
| Main category shown by default, its filter kept, a working saved column preference | 4 (new column-memory key, D7; `:1466` rewrite: shown on first sight, hide, remount, Restore) |
| Remove Before this menu, Menu price, Effective price, Price on this menu, From from the table and chooser (On this menu: W90) | 4 |
| Keep Product and location context | 4 (Appears under, Main category unchanged) |
| One clearly labelled, directly editable override field per product or variant | 4 (drawn), 5 (saved) |
| Blank shows the inherited price as its hint; a saved override shows its own price | 3, 4 |
| Clearing the field restores inheritance | 5 (`:753`, `:3979` rewrites) |
| Exact money validation, visible refusal, save/undo feedback, keyboard use | 5 (validation incl. the decimal comma; a price refusal under its field with focus moved there, any other in the status line; Enter/Escape/leaving; no resend on leaving a refused field unchanged), 6 (saved, Undo), 7 (status line in view while editing far down) |
| The editor behind the product name goes | 5 |
| Inherited hint follows product/variant/menu precedence, included menus too | 3, 4 (`:1958`, `:1993` rewrites), 1 (included Inactive) |
| A parent with variants shows a range; two included sources may clash; no false single price | 3, 4 (range placeholder measured whole in the widened field; a size-only clash points at the size), 7 (390 px, both languages) |
| A clear clash state, and a way to set a resolving price | 4 (marker, hint), 5 (Resolve emits a save; Set a price focuses the field) |
| Price source calculations for publishing and tills preserved | 1 (combined equality, offers exclude Inactive, preview and status unchanged) |
| Active status column from global Active, with an accessible link to `/manage/catalogue/product/:id` | 4 |
| The management read includes Inactive items; sellable offers still exclude them | 1 |
| A variant's effective status accounts for its parent | 1 (data), 4 (display) |
| Active kept distinct from Available | 4 (decision D4, test) |
| No per-menu Sold column or hide/show action | W90; 4 keeps `:2126` |
| Tests for each named behaviour; failed and concurrent saves | 1–6 |
| Both themes, desktop and phone, an expanded variant | 7 |
| `products.md`, `design-system.md`, `backlog.md` | 8 (plus `product-categories.md`) |

## Changed test checks

Under the owner's rule of 2026-10-05 ~00:05. **Reasons:** **R1** brief bullet 1 (the diagnostic
columns go; one override field per row; the window behind the name goes); **R2** bullet 2 (inherited
hint, range, clash); **R3** bullet 3 (Inactive rows and Status). Line numbers are at `b88493278`, the
`it(` line. **Fixture** rows add a field the new type requires and assert nothing new. **DELETE**
rows lose a check whose behaviour the brief removes; each names the new check that covers the new
behaviour. Nothing here is a golden huella, `inmutabilidad`, filing, money-total, VAT, login,
permission or cash-drawer test, and no guard under `scripts/` changes.

**Worth the owner's look** (not, I think, controversial under the rule, because the brief removes
the window, but each loses a kind of check): `:764`, `:782`, `:827`, `:837` (no bottom-of-form
message and no Save button to disable, D12); `:923`, `:984` (window-only behaviours with no inline
counterpart); `client-routes.test.ts:770`'s `setMenuVariants` call (the client method goes, D17; the
server route keeps its own tests). `:871` is no longer on this list: focus still moves to a refused
field (D10), now checked against the inline field. The interim D18 case Task 1 adds to
`menu-prices-table.test.ts` is deleted with the window in Task 5; it is this branch's own, not an
existing check.

| Task | file:line | Before | After | Why |
| --- | --- | --- | --- | --- |
| 1 | `packages/catalogue/src/menu-structure.test.ts:685` | expected rows without `active` | the same rows with `active: true` and `active: true` sizes | Fixture |
| 1 | `…menu-structure.test.ts:758` | lists sold-out Water, leaves inactive Burger out | lists both, Burger `active: false`; `listMenuOffers` still leaves Burger out | R3 |
| 1 | `…menu-structure.test.ts:776` | lists Active sizes only, equal to `listMenuVariants` | lists the Inactive Jug too, `active: false`; the Active ones still equal `listMenuVariants` | R3 |
| 1 | `apps/server/src/catalogue-api.test.ts:4105` | expected row without `active` | with `active: true` | Fixture |
| 1 | dashboard `MenuPriceRow` literals (`menu-prices-table.test.ts`, `.a11y.test.ts`, `menus-screen.test.ts:220`, `menus-screen.a11y.test.ts:201`) | no `active` | `active: true` on rows and sizes | Fixture |
| 1 | `apps/server/src/catalogue-api.test.ts:2311` | keeps an Unavailable product on the prices list, hides an Inactive one (`[]` after the Inactive save) | keeps both, each with its Active state: `[[offerId, true]]` after the sold-out save, `[[offerId, false]]` after the Inactive save; renamed, its comment deleted | R3 (missed by the plan; controller ruling) |
| 2 | `apps/dashboard/src/api/client-routes.test.ts:770` | three calls | a fourth: `setMenuVariantPrice` → `PATCH …/variants/v1 { price }` | Added check |
| 2 | `packages/catalogue/src/menu-publication.test.ts:1672` | clash state only | the whole clash: Dinner's own 4.00 and Drinks' 5.00 with Drinks as its source | Added check (controller, from Task 1 review) |
| 5 | `apps/dashboard/src/api/client-routes.test.ts:770` (`:793`, `:798`) | `setMenuVariants` resolves to the sizes; `PUT …/variants { variants }` sent | **DELETE** those two lines — the client method goes (D17); the PUT route keeps its server tests (`catalogue-api.test.ts:1530`–`1560`, `:4755`–`4768`) | D17 |
| 4 | `apps/dashboard/src/widgets/menu-prices-table.test.ts:249` | Before/Menu/Effective cells in each locale's money format | each field's `locale`, and burger's and lemonade's hints in each locale's format (`€12.00`; `€3.00 – €3.75`) | R1 |
| 4 | `…:302` | product-price, menu-price, effective-price columns | override values `["", "2.50", ""]`, placeholders `["12.00", "3.00 – 3.75", "2.00"]`; names, placements, categories unchanged | R1 |
| 4 | `…:337` | burger's muted "None" | the muted "Variant overrides" note of a lemonade with no own override; the placement and note checks unchanged | R1 |
| 4 | `…:380` (case `3,40`) | lemonade found by its Large's price before this menu | `3,75` (Large's override) finds `["mi-lemonade", "mi-lemonade:v-large"]`; the other cases unchanged | R1 |
| 4 | `…:451`, `:457` | filter on `menu-price` | the same filter on `override`; same rows | R1 |
| 4 | `…:480` | sorted by `product-price` | sorted by `override` (inherited 9.50, 10.00); same order | R1 |
| 4 | `…:502` | sorts by product price, charged price and menu price | sorts by `override`: lager (4.00) before burger (9.00) and back; the product prices still order the other way, so a sort by them fails | R1 |
| 4 | `…:1235` | each size's own, menu and charged price; the bottle's muted "None" | each size's field: values `["7.00", "", "15.00"]`, placeholders `["6.00", "13.00", "14.00"]`; placements and categories blank | R1 |
| 4 | `…:1275` | the glass's 6.00 and the carafe's charged 15.00 from the server | the glass's placeholder `6.00`, the carafe's value `15.00` | R1 |
| 4 | `…:1297` | Before and Effective ranges | placeholders: wine's range when its own is cleared is Task 5's; here juice `3.50 – 5.00`, tea `2.40`, burger `12.00`, wine's value `13.00` | R2 |
| 4 | `…:1313` | effective `5.0` | juice placeholder `5.0` (one amount, not a range) | R2 |
| 4 | `…:1339` | sort by product-price low end: tea, juice, wine, burger | sort by `override` with cider added (4.00 – 4.50, whose high end is below juice's 5.00, so a sort by the high end fails): tea (2.40), juice (3.50), cider (4.00), burger (12.00), wine (13.00); descending reversed | R1 (cider added by the Task 4 implementer: without it the five rows sort the same by either end) |
| 4 | `…:1350` | sort sizes by `effective-price` | sort by `override`; same orders | R1 |
| 4 | `…:1376` | Menu price column: `13.00`, "Variant overrides" ×2, "None" | override cells' text: `""`, note, note, `""` | R1 |
| 4 | `…:1386`, `:1397` | `menu-price` filter and "None" cells | `override` filter; unmarked rows are those with no value and no note: cider, burger | R1 |
| 4 | `…:1441` | "10.00" (the bottle's price before this menu) finds the bottle | "7.00" finds `["mi-wine", "mi-wine:v-glass"]`, "700" nothing, "13.00" `["mi-wine"]` | R1 |
| 4 | `…:1466` | chooser offers six columns, Price on this menu hidden, its choice stored under `waitron.menus.prices:columns` | chooser offers placements, category, status, all shown; headers `name, placements, category, status, override, ""`; a choice stored under the old key `waitron.menus.prices:columns` hiding category is not read (category shown); hiding category stores `{ category: false }` under `waitron.menus.price-overrides:columns`, a remount keeps it hidden, Restore defaults shows it | R1, D7 |
| 4 | `…:1511`, `:1530`, `:1564`, `:1579`, `:1598`, `:1606`, `:1634`, `:1643`, `:1661` | the Price on this menu column: muted no-menu-price text, struck "was" price, sort | **DELETE** — the column goes; the hint and placeholder cases of Task 3 and Task 4's field case cover what a row inherits and shows | R1 |
| 4 | `…:1714` | three tooltips per row, the charged one explained | one tooltip, "Where Burger's inherited price comes from", reading "The product's own price." | R1 |
| 4 | `…:1764` | the small's Before and Effective cells `8.00` | the small's placeholder `8.00` | R2 |
| 4 | `…:1889` | three localized tooltips on the Large; the range tip on the product | one on the Large ("De dónde viene el precio heredado de Lemonade — Large", "El precio propio del producto."); the small's own tip names this menu's 2.50 it follows; the product's tip lists each Active size at the price its placeholder counts: "Small: 3,00 €. Sigue el precio de Lemonade en esta carta. El precio propio del producto. Large: 3,75 €. Esta carta fija 3,75 €. …" (Small as today; Large now its own 3.75, D5) | R1 (fix round 1: the tooltip reads the settings the placeholder is computed from) |
| 4 | `…menu-prices-table.test.ts` (new, beside the status-link case) | — | a plain click on `mi-lemonade:v-small`'s status link sends `{ productId: "v-small" }` | Added check (fix round 1) |
| 4 | `…menu-price-inheritance.test.ts` (new) | — | `variantInheritedFrom` and `sizesInheritedFrom`, the settings the placeholder and the tooltip share | Added check (fix round 1) |
| 4 | `…:1958` | the From cell of the small reads "Drinks" | the small's tooltip names Drinks (its product's source added) | R2 |
| 4 | `…:1993` | Before shows Drinks' 3.50 while the hidden column compares with 2.00 | the field's value is 4.00 and its hint names `€3.50`, not `€2.00` | R2 |
| 4 | `…:2036` (both locales) | the Menu price cell's value and its tooltip; the aggregate cell "Variant overrides" | the field's value `4.00`; the tooltip lists each size as the aggregate did; a no-override lemonade shows the note with the same tooltip | R1 |
| 4 | `…:2126` | chooser contains `from`, not `active` | contains `status`, not `active` | R1 |
| 4 | `…:2157` | effective range `2.50 – 3.75` counts every size | lemonade's hint names `€3.00 – €3.75`: the Large's override counts | R2 |
| 4 | `…menu-prices-table.a11y.test.ts:88` | sizes open and the combined column shown | sizes open, an Inactive row and a clash drawn; axe. Rows: burger Active with a product clash, lemonade Inactive (the brief's `[{ ...rows[0], active: false }, rows[1]]` draws no clash and no status note, which needs an Active size under an Inactive product) | R1, R3 |
| 4 | `packages/ui-core/src/tokens/structure.test.ts:22` | the structural contract's names | also `--wt-price-range-field-width` | Added check |
| 4 | `…menu-prices-table.test.ts` (new, beside `:1791`) | — | resolving an Active size's clash sends the Active sizes and the resolved one, never an Inactive sibling (`setMenuVariants` refuses one it is sent, `variants.ts:389`–`390`) | Added check (Task 1 put Inactive sizes into `row.variants` without filtering `#resolve`, D18) |
| 4 | `apps/dashboard/src/screens/menus-screen.test.ts:3829` | path and tab key | also the tab's label, "Price overrides" / "Precios propios" | Added check |
| 5 | `…menu-prices-table.test.ts:280` (both locales) | the window's fields carry the locale; the hint names the product price | each row's field carries the locale; lemonade's hint names its range | R1 |
| 5 | `…:549` | pressing the name asks for the window | **DELETE** — no window; "draws a product's name as plain text, with no window behind it" | R1 |
| 5 | `…:557` | no window while a save is out | **DELETE** — "keeps every field editable while a save is out, the saving one marked" | R1 |
| 5 | `…:610` | window fields, placeholders, the small following the typed product price, one save of both | row fields, the same values and placeholders, the small's placeholder following the product's typed price; each Enter sends one field | R1 |
| 5 | `…:648` | the burger window: placeholder, hint, `aria-describedby`, Save sends `{ grossPrice: "11.00" }, variants: null` | the burger field: the same placeholder, hint and `aria-describedby`; Enter sends `{ key: "mi-burger", variantId: null, price: "11.00", previous: null }` | R1 |
| 5 | `…:674` | Save with nothing changed emits an empty save | Enter on an unchanged field emits nothing | R1 |
| 5 | `…:686` | "2.5" over "2.50", sizes read back in another order, is no change | "2.5" typed over "2.50" and Enter emits nothing; sizes read back reversed keep each field on its own size | R1 |
| 5 | `…:702` | a change read in while the window is open is not written back | a save sends only the field committed, whatever else was read in meanwhile | R1 |
| 5 | `…:727`, `:740`, `:1677` | the item alone, the variants alone, both | each Enter sends its own field: `variantId: null` for the product, the size's id for a size | R1 |
| 5 | `…:753` | Use the inherited price empties the field; save sends `grossPrice: null` | emptying the field and pressing Enter sends `price: null`; the button is gone | R1 |
| 5 | `…:764` (4 cases), `:782` | malformed price: error beside the field and the bottom sentence; an unreadable product price makes the small's placeholder `3.00` | error beside the field, nothing sent, the text kept, fixing clears it; **no bottom sentence** (no form footer); an unreadable product price is no draft, so the small's placeholder stays the saved `2.50` | R1, D12, M5 |
| 5 | `…:793`, `:802` (5 cases) | a refusal beside the price field or in the bottom message, by the field it names | a refusal the screen passes for a field shows under that field and no other; the screen passes only one naming the price (`grossPrice`/`price`, or `product.variant_not_found` for a size); `_form`, `variants`, `variantId` and any other go to the status line under no field (the new screen cases "puts a refusal naming … under its field" and "says a connection failure in the status line, under no field") | R1, I2 |
| 5 | `…:819` | no error before Save | no error while typing, before Enter or leaving | R1 |
| 5 | `…:827` | an invalid Save focuses the field and disables Save | an invalid Enter keeps focus in the field; **no Save button** to disable | R1, D12 |
| 5 | `…:837` | re-checks every change after a failed Save; Save works again | after a failed Enter each change re-checks: the error goes when fixed, comes back when broken | R1 |
| 5 | `…:857`, `:880` | a refusal clears when its field changes, or Save is pressed again | a refusal hides when its field changes; another field's change keeps it | R1 |
| 5 | `…:871` | a refusal arriving focuses the window's price field | a refusal arriving focuses the inline field it names, even with focus on another row's field; one naming no field moves nothing | R1, D10 |
| 5 | `…:892`, `:913` | reopening the window starts again from stored | Escape restores the stored price; a re-read while not editing shows the new stored price | R1 |
| 5 | `…:905` | typed text survives a re-read in the window | typed text survives a re-read in the row | R1 |
| 5 | `…:923` | the window waits for its row | **DELETE** — no window; the nearest new check is "reports beside the list a refusal for a row the menu no longer lists" | R1 |
| 5 | `…:932` | the window names a missing size as missing | the size row's name and field label say missing; placeholder `3.40` | R1 |
| 5 | `…:939`, `:972`, `:984` | Cancel, Escape and dismissal of the window, held while saving | **DELETE** `:939` and `:984` — no window; `:972` becomes "Escape on a field whose save is out keeps the sent text" | R1 |
| 5 | `…:958` | Save and Cancel clicks stopped | Resolve and Undo clicks stopped (Undo in Task 6) | R1 |
| 5 | `…:992` | Enter saves the window | Enter in a field saves that field | R1 |
| 5 | `…:1235`, `:1259` (name part) | the product name is the window's button; the size's indent measured from it | the product name is plain text; the indent measured from `[part~=name]` | R1 |
| 5 | `…:1736`, `:1791` | resolving emits an item or a whole size list | resolving emits one field's save with the chosen price | R1 |
| 5 | `…:2136` | the window edits only prices | rows have no chooser; a commit sends a price only | R1 |
| 5 | `…menu-prices-table.a11y.test.ts:107`, `:112` | axe on the window, and on the window refusing a price | **DELETE** `:107` — axe on fields "one refused and one saving"; `:112` → axe on a field refusing `-1` | R1 |
| 5 | `…menus-screen.test.ts:3891`, `:3920`, `:3933`, `:3946` | one PATCH and/or one PUT of the size list from the window | one `updateMenuItem` per product field, one `setMenuVariantPrice` per size field, in order, prices re-read after each | R1 |
| 5 | `…:3969` | Save with nothing changed closes the window, writes nothing | Enter on an unchanged field writes nothing and marks nothing as saving | R1 |
| 5 | `…:3979` | Use product price sends `grossPrice: null` | emptying the field and Enter sends `grossPrice: null` | R1 |
| 5 | `…:3990`, `:4016` | the window keeps a refusal or a malformed price, sending no sizes | the field keeps the refusal or check error and its text, editable; nothing else written | R1 |
| 5 | `…:4027` | one save at a time; the window holds | a second field's save waits for the first's answer, then goes | R1 |
| 5 | `…:4053`, `:4077`, `:4111`, `:4201`, `:4239` | started from the window | the same assertions, started by Enter in the burger's field | R1 |
| 5 | `…:4221` | Back closes the window and frees Structure | **DELETE** — no window; "saves an edit left by choosing another tab" | R1 |
| 5 | `…:4262`, `:4289` | price saved, sizes refused, in one save | **DELETE** — a save is one field; "still sends a queued save after the one before it is refused" | R1 |
| 5 | `…:4316`, `:4340` | a size-list refusal in the window, or beside the list after leaving | a size field's refusal under that field; after leaving the menu, beside the list naming "Lemonade — Small" | R1 |
| 5 | `…:4368` | no window opens while a save is out | **DELETE** — no window; covered by "writes two fields one after the other…" | R1 |
| 5 | `…menus-screen.test.ts:6520` | a product-only `wt-offer-save` resolve calls `updateMenuItem` once and never `setMenuVariants` | a product-only `wt-price-save` (no size) calls `updateMenuItem` once with `{ grossPrice: "3.50" }` and never `setMenuVariantPrice` | R1, I4 |
| 5 | `…menus-screen.test.ts:300`–`312`, `:515` | `WRITES` and the `api()` mock name `setMenuVariants` | they name `setMenuVariantPrice` | Fixture (D17) |
| 6 | `…menus-screen.test.ts:4111`, `:4201` | a save finishing after leaving the menu or tab reads no prices | also sets no "saved" outcome | Added check (M6) |

---

## Self-review notes

- Every brief bullet maps to a task (coverage table). Review focus items 1–4 sit in Task 5, item 5
  in Task 3.
- Names used across tasks: `MenuPriceVariant`, `menuPriceVariantsOfItems`, `includeInactive`
  (Task 1); `setMenuVariantPrice` (Task 2, catalogue and client); `productInherited`,
  `variantInherited`, `withoutOwn`, `sizeClash`, `Inherited`, `ParentPrice` (Task 3); column keys
  `status`, `override`; `wt-price-input[name="price-override"][data-row][part="override-field"]`;
  `--wt-price-range-field-width`; `viewKey="waitron.menus.price-overrides"`; `wt-edit-product`
  (Task 4); `PriceSave`, `wt-price-save`, `saving`, `refusals`, `outcome` with the refused
  `PriceOutcome`, `#savePrice`, `namesThePrice` (Task 5); the saved `PriceOutcome` and Undo
  (Task 6).
- Amended 2026-10-05 after a fresh-context review: I1 (size-only clash wording), I2 (refusal
  routing), I3 (third modal exception; course-list cited; D15), I4 (`:6520`, a11y `:107`), I5 (focus
  kept, D10), I6 (range width token and measuring case), M1–M11 (D7 new key, D9 verb form, D16,
  D17, D18, sticky status line, private `includeInactive`, own route test, other body fields
  refused, no resend on leaving a refused field unchanged, saved outcome guarded).
- Claims about today's behaviour cite `file:line` at `b88493278`; the expected values in Task 3's
  table were worked out by hand from `combinedFixture` (`test-helpers.ts:329`–`366`), not run —
  Task 3's run is the check.

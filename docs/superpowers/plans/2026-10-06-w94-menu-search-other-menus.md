# Search the current menu first, then the device's other menus (W94) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Every task is test-first: write the failing test, run it and watch it
> fail for the reason you expect, then write the least code that passes. The branch adds no
> migration, changes no route, wire body, fiscal code or permission, so it takes the **LIGHT review
> path**: no per-task reviewer; `/finish-branch` runs its plan-vs-spec read and the Codex run-it
> seat.

**Goal:** the live device's menu search lists the shown menu's matches first, then a group for
each other menu the device is served in its zone, labelled by menu, each tile that menu's own
offer and price.

**Architecture:** `till-menu-browser` gains `menus` (every served menu, zone order) and
`servedProducts` (every served offer, diet lens applied). Its search indexes each other menu with
the same `indexMenu` it uses for the shown one and draws one group per menu. The two screens that
render the browser pass the two properties from what they already hold. The server, the wire and
the dashboard preview do not change.

**Tech stack:** TypeScript, Lit, Vitest 4 browser mode (`@waitron/till`).

**Spec:** `docs/superpowers/specs/2026-10-06-w94-menu-search-other-menus-design.md`. Its "What is
already true" section holds the traced facts this plan relies on; re-read each `file:line` before
editing, since other lanes change these files.

**Base.** `main` at 53c8f1e6d or later. Lane C's #1288 (A261-8) changes
`apps/till/src/api/client.ts` and till-app tests, not the files this plan edits; whoever lands
second rebases (owner, 2026-10-01).

## Global constraints

- `products` keeps its meaning (the shown menu's products, diet lens applied) and the home and
  section views must not change. Every existing case in `menu-browser.test.ts`,
  `menu-browser.a11y.test.ts`, `card-grid.test.ts` and the table-order screen suites passes
  unedited. A test whose stub or fixture lacks the new properties may gain them (owner rule,
  2026-09-27); no existing assertion changes.
- With `menus` holding one menu or none, the results are drawn exactly as today.
- No server change and no server test (spec: the non-default menu's price is already pinned by
  `apps/server/src/working-order.test.ts`, "prices the selected menu offer…").
- Strings go in both `en` and `es` of `apps/till/src/i18n/strings.ts`; a parameter is replaced the
  way the file's siblings do (`t(key).replace("{menu}", () => name)`).
- Every new tile reads `--wt-*` tokens only; reuse the browser's existing classes (`.grid`,
  `.empty`). The `h3` gets a rule written the way the `h2` rule is (`menu-browser.ts`, the `h2`
  block near line 104), with `--wt-*` tokens only.

## Task 1 — The browser groups its search results by menu

**Files:** `apps/till/src/widgets/menu-browser.ts`, `apps/till/src/widgets/menu-browser.test.ts`,
`apps/till/src/i18n/strings.ts`.

- [ ] **Step 1: fixtures.** In `menu-browser.test.ts` add a second and third served menu built the
  way `lunch()` is: `drinksMenu()` (id `menu-drinks`, name `Drinks`, `isDefault: false`,
  `versionId: "v-drinks"`) whose structure holds its own products, and `brunchMenu()` (id
  `menu-brunch`, name `Brunch`). Their products are made with `product()` but carry their own
  `menuItemId` (`mi-drinks-<key>`), `menuVersionId` and `catalogueId`. Include `cola` again as
  `colaOnDrinks` — the same `productId` `p-cola` at a different `unitPrice` (`"2.20"`) and
  `menuItemId` `mi-drinks-cola` — a product with variants or offered modifiers (copy the shape the
  file's modifier cases already use), a sold-out one, and one with
  `ordering: "not_sold_separately"`. A `served(...)` helper mounts with `menus: [lunch(),
  drinksMenu(), brunchMenu()]` and `servedProducts` = `PRODUCTS` plus the other menus' products.
  Helpers to read groups: `groups(el)` returns, per `[data-region="results"] section[data-menu]`,
  `{ menu: dataset.menu, heading: h3 text, names: tile names, empty: .empty text or null }`.

- [ ] **Step 2: failing tests** (spec Tests 1–10), in a new `describe("search across the served
  menus")`:
  1. "lists the shown menu's matches first, then each other served menu's, labelled by menu":
     query `"co"` → groups `[{menu:"menu-lunch", heading:"Lunch (this menu)", names:["Cola"]},
     {menu:"menu-drinks", heading:"Drinks", names:[...Drinks' matches]}]`.
  2. "keeps the zone's order and draws no group for a menu without a match": a query matching only
     a Brunch product → `[{menu:"menu-lunch", empty:"No products match in this menu"},
     {menu:"menu-brunch", …}]`, no `menu-drinks` group.
  3. "says no menu has a match when none does": query `"zzz"` → no groups; the results region's
     text contains "No products match in any menu".
  4. (regression guard — passes before the change) "draws one menu's results as before": mount with `menus: [lunch()]` and the same
     `servedProducts`; `"co"` → no `section[data-menu]`, `names(entries(el, "results"))` is
     `["Cola"]`, heading "Search results"; `"zzz"` → "No products match".
  5. (regression guard) "searches only the menus it is served": a product in `servedProducts`
     whose `catalogueId` and `menuItemId` belong to a menu absent from `menus` is never a result;
     positive control in the same case: with that menu added to `menus`, it is one.
  6. "shows a product on two menus once in each, at each menu's price, and rings up the tapped
     menu's offer": `"cola"` → Lunch group tile price `1,50` and Drinks group tile price `2,20`
     (read the tile's price text the way the file's price cases do); tap the Drinks tile → the
     store's one line has `product.menuItemId === "mi-drinks-cola"`,
     `product.menuVersionId === "v-drinks"`, `product.unitPrice === "2.20"`.
  7. "opens another menu's product with that menu's choices": tap the Drinks product with variants
     or modifiers → the `till-modifier-picker` is shown with `.product` being that Drinks product;
     confirming adds a line for it.
  8. "keeps a sold-out product greyed in its group and leaves out one not sold separately".
  9. "follows a change of served menus or products": after a search, set `el.menus` to `[lunch(),
     brunchMenu()]` → the Drinks group goes; set `el.servedProducts` to a copy where a Brunch match
     is `available: false` → its tile is disabled.
  9b. "puts the newly selected menu first": after a search, set `el.menu = drinksMenu()` and
     `el.products` to Drinks' products → the first group is `menu-drinks` headed "Drinks (this
     menu)", and Lunch follows as another group headed "Lunch".
  10. "groups the results while a section is open, and goes back to it when cleared".

  Run `pnpm --filter @waitron/till exec vitest run src/widgets/menu-browser.test.ts` and watch the
  new cases fail (no `menus` property, no groups) — except the two regression guards, 4 and 5 —
  while every existing case still passes.

- [ ] **Step 3: strings.** Add `menu.results_this_menu` (`{menu} (this menu)` / `{menu} (esta
  carta)`), `menu.no_results_this_menu` (`No products match in this menu` / `Ningún producto
  coincide en esta carta`) and `menu.no_results_any_menu` (`No products match in any menu` /
  `Ningún producto coincide en ninguna carta`) beside `menu.no_results`, in both languages.

- [ ] **Step 4: implement.** In `menu-browser.ts`:
  - Add `@property({ attribute: false }) menus: readonly TillZoneMenu[] = [];` and
    `@property({ attribute: false }) servedProducts: TillProduct[] = [];`, each with a one-line
    comment saying what it holds (spec, "The browser learns the device's other menus").
  - Cache each other menu's index by menu object and `servedProducts` array (a `WeakMap` keyed by
    the menu, holding `{ products, index }`), and the folded names per index (a `WeakMap<MenuIndex,
    …>`, replacing the single-slot `#searchable` cache, so the existing fold-count case — which
    counts `String.prototype.normalize` calls — still sees each menu's names folded once).
  - `#results`: compute the shown menu's matches as today. `others` = `this.menus` minus the one
    whose `id` is the shown menu's, each with its matches. If `others` is empty, render exactly
    today's markup. Otherwise render the `h2`, then — if no group has a match — only
    `<p class="empty">` "No products match in any menu"; else the shown group
    (`<section data-menu=${menu.id}><h3>` "…(this menu)", then its grid or `<p class="empty">`
    "No products match in this menu") and one such section per other menu with matches, headed
    with `menu.name`. No `aria-labelledby` on the group sections (spec: two menus may share a
    name, and same-named regions break axe's `landmark-unique`).
  - Tiles use `#productButton(product, display.tiles, () => this.#pick(product))` with the shown
    menu's `display`, exactly as today's results.

- [ ] **Step 5:** run the file again; all cases pass. Prove by deletion, restoring after each:
  make `others` always empty and confirm cases 1, 2 and 6 fail; make the per-menu index read
  `this.products` instead of `servedProducts` and confirm case 6 fails; key the other-menu cache
  by the menu object alone (ignoring `servedProducts`) and confirm case 9's sold-out half fails;
  exclude the other group by a stale shown-menu id (compare against the first-mounted menu's id
  instead of `this.menu.id`) and confirm 9b fails.

- [ ] **Step 6:** `pnpm --filter @waitron/till exec tsc --noEmit -p .` (or the package's
  `typecheck` script) and `pnpm exec eslint apps/till/src/widgets/menu-browser.ts`; commit
  `git commit -s` — "Menu search lists the shown menu first, then each other served menu".

## Task 2 — Accessibility of the grouped results

**Files:** `apps/till/src/widgets/menu-browser.a11y.test.ts`.

- [ ] **Step 1:** add cases, in both themes the way the file's existing cases run them, for the
  grouped results (shown menu with matches plus another menu's group), for the "no match in this
  menu" group followed by another menu's group, and for two other served menus sharing one name.
  Use the file's own fixtures plus served menus built as in Task 1.
- [ ] **Step 2:** run `pnpm --filter @waitron/till exec vitest run
  src/widgets/menu-browser.a11y.test.ts`. These cases pass on first run (Task 1 built the markup).
  Control, measured by the plan review with axe-core 4.13.0: turning the group heading into an
  `h4` makes axe report `heading-order`; do that, confirm the case fails naming that rule, restore.
  (A missing `aria-labelledby` target or a duplicate id is only an "incomplete" result, which
  `expectNoA11yViolations` ignores, so neither is a control.)
- [ ] **Step 3:** commit `git commit -s`.

## Task 3 — The two screens pass the served menus

**Files:** `apps/till/src/screens/till-table-order-screen.ts` (`#menuBrowser`),
`apps/till/src/widgets/card-grid.ts` (the `product-grid` case), their tests
(`till-table-order-screen.test.ts` or the nearest suite that already searches or taps the
browser through the screen, and `card-grid.test.ts`).

- [ ] **Step 1: failing tests.** In each suite, with `menus` holding two served menus (build them
  with `servedMenus` from `apps/till/src/widgets/test-helpers.ts`) and products on both:
  - searching through the screen's browser shows the other menu's group with its product;
  - with a diet lens selected (`selectedDiet: "vegan"`), a product on the other menu that fails the
    lens is not in its group while one that passes is.
  Watch them fail (the browser receives no `menus`).
- [ ] **Step 2: implement.** In both places add a second memo,
  `readonly #searchProducts = memoVisibleProducts();`, and pass
  `.menus=${this.menus}` and `.servedProducts=${this.#searchProducts(this.products, "",
  this.selectedDiet)}` to `till-menu-browser`. Update the table-order screen's `#menuBrowser`
  comment only if it now says something false.
- [ ] **Step 3:** run both suites plus `src/widgets/menu-browser.test.ts`; all pass. Prove by
  deletion, restoring after each: drop `.menus=` from one caller and watch its group case fail;
  pass `this.products` (no diet lens) as `servedProducts` and watch its diet case fail.
- [ ] **Step 4: zone change through the app** (spec Test 14). Several till-app suites already mock
  `listZoneOffers` (`till-app-boot-and-counter.test.ts`, `till-app-menu-refresh.test.ts`); the
  counter replaces `menus` when it loads a zone (`till-app.ts`, `#showCounterOffers`). In the one
  that already switches the counter's zone, add a case: zone A serves Lunch and Drinks, zone B
  serves Lunch and Brunch; after switching to zone B, a search shows a Brunch group and no Drinks
  group. Write it before Step 2 if you can, so it fails first; if written after, show it would
  fail by temporarily passing an empty `menus` from `card-grid.ts`, and restore.
- [ ] **Step 5: server pin (no code).** Cite `apps/server/src/working-order.test.ts`, "prices the
  selected menu offer…" (it sells `premiumCafeOfferId` from "Carta premium", not the zone's
  default menu, and asserts its price) in the PR as the evidence that a line from another served
  menu is priced from that menu. Re-read it first to confirm.
- [ ] **Step 6:** typecheck the till, lint the changed files, commit `git commit -s`.

## Task 4 — Look at it

- [ ] Start the dev stack from the worktree (`wa-wt demo <worktree-name>`; before any reset, check
  who holds the venue folder — `lsof` on it and port 8080). Make sure the demo zone serves at least
  two published menus with a product on both at different prices (add one in the dashboard and
  publish if the seed has none).
- [ ] On the till, at till width and at a 390 px handheld width, in light and dark themes: search
  from home and from inside a section; see the shown menu's group first, the other menu's group
  labelled, the "no match in this menu" and "no match in any menu" states; tap another menu's
  product and check the basket line's price is that menu's. Use the keyboard alone once (Tab into
  search, type, Tab to a result, Enter) and touch emulation once.
- [ ] Save screenshots outside the worktree and note what was checked in the ledger. Fix what the
  look finds, test-first where it is behaviour.

## Task 5 — Docs and backlog

- [ ] `docs/developers/design-system.md`, in the "A menu's Device Home Page…" paragraph or right
  after it: the search sits above both blocks on home and in a section; its results list the shown
  menu first, headed "<menu> (this menu)", then each other menu the device is served with a match,
  headed with its name, as `h3`s under the results' `h2`; the two empty states; one menu served
  draws one ungrouped list; the dashboard preview searches its one menu and says so.
- [ ] `docs/backlog.md` has no W94 entry. Add one built line beside W93's ("Each menu has one
  Device Home Page… — DONE (W93, #1287…)", near line 1873): "Menu search lists the shown menu
  first, then each other menu the device is served — DONE (W94, #<PR>, <date>)", in the file's
  one-line style (its top says landed work is one line with its PR number). `/land-branch` fills
  the PR number.
- [ ] Commit `git commit -s`.

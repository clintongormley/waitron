# Set menus worked out by the bill, piece 3: the server (A1515-3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server works out and saves a bill's set menus on every change, using the shared
calculation piece 2 landed (`groupSetMenus`, `packages/shared/src/set-menu-grouping.ts`, #4224), so
the waiter only adds dishes and the customer pays the cheapest way the bill's dishes can be charged.

**Architecture:** Every change to a bill's dishes ends with one call, in the same transaction, that
reads the bill's dishes, its linked set-menu copies and its saved grouping, runs `groupSetMenus`, and
rewrites the bill's set-menu lines and each dish's place and charged price. Set-menu lines stay rows
of `working_order_lines` with `set_menu_role = 'set_menu'`, so the bill total, the ticket, the
invoice and the reports keep reading stored line prices as today (`storedOrderTotal`,
`apps/server/src/working-order.ts:1396`). The calculation needs a dish's à la carte price, which the
server does not store today for a dish tapped in a set-menu folder; PR 1 stores it.

**Tech Stack:** Hono routes in `apps/server`, Drizzle on SQLite (`node:sqlite`), shared calculation
in `@waitron/shared`, new order code in `packages/orders-sales` where it needs no server file (owner,
24 November, lane B questions.md "WATCHER 2026-11-24 14:18").

**Spec:** `docs/superpowers/specs/2026-11-24-set-menus-automatic-grouping-design.md` (approved by the
owner in conversation, 24 November 2026, "y"; recorded in the spec's Status line, commit
8dc86752ba). This piece is its "The pieces, for planning", item 3, and sections 2, 3, 5, 6 and 7
("Moving dishes"). Owner decisions this plan keeps: one discount per set menu, a new one replaces the
old and the till says so, and two discounted menus that become one keep the larger saving (watcher
note relaying the owner, 24 November 11:21, quoted in the spec's section 6); a dish with its own
discount is charged à la carte ("An individual dish with a discount gets treated as a la carte"); a
set-menu discount does not lock its dishes. Code facts below were read at main `e8df6f7699`, not run,
unless a step says it runs them.

## The split: four pull requests

Every one changes what a bill charges, so each takes the full review wave (two Codex angles), and
the OWNER lands it. Each leaves `main` working on its own.

| PR | What a person can do when it lands | Depends on |
| --- | --- | --- |
| 1. À la carte price and links (`feat/a1515-3-a-la-carte-price`) | Every dish on a bill stores the price it would cost à la carte, also when tapped in a set-menu folder (lane L's VAT piece B reads it, its decision S2). Ordering any dish records on the bill every set menu on sale that lists it, and a moved dish brings those records. What staff see change (D8): once a dish is ordered, the till keeps offering that set menu's folder after its period ends, and its dishes are not refused as out of period, as the spec's section 3 says ("A linked set menu stays usable"); today that starts only when a waiter sets a count. | — |
| 2. The bill works out its set menus (`feat/a1515-3-regroup`) | A waiter adds dishes from anywhere; the bill forms the cheapest set menus by itself on every send, add, edit, cancel, split and move, and every till shows the same answer. No counts, no "No place for this dish" question. Anything already comped, discounted or paid for by item stays as it was saved (D2). | 1 |
| 3. Comps and discounts (`feat/a1515-3-adjustments`) | A dish with its own comp or discount is charged à la carte less it, and the rest regroups; a set menu's discount takes off that menu's price and supplements, one per menu, and falls away with a notice when the bill has no menu of that type left; a whole-bill discount stays its percentage or its amount as the bill regroups. | 2 |
| 4. Moving dishes with their discounts (`feat/a1515-3-moves`) | A discounted dish moves to another bill alone, with its discount; both bills regroup; moving "a set menu with its dishes" is gone. | 3 |

PR 1 is written out task by task below. PRs 2–4 are given as scope, decisions and files; each gets
its task steps on this page, against `main` as the previous PR left it, before its build starts, and
the watcher clears each addition. Lane H is splitting `apps/server/src/working-order.ts` by script
(watcher, 24 November 16:17): if that has landed when a PR starts, its file references are re-pointed
to the new files before building; if not, the branch runs lane H's script after rebasing.

## Decisions for the watcher

- **D1 (PR 2, crosses into lane C's piece 4). The switch PR also makes the till's minimal change.**
  Today the till asks "No place for this dish" whenever its own preview finds no free place, and
  offers **Add a set menu** (the count route) or moves between set menus
  (`apps/till/src/widgets/menu-browser.ts:678-830`). Once the server forms set menus itself, an empty
  bill has none until a dish is sent, so a dish only on a set-menu folder could not be added at all.
  Recommended: PR 2 also (a) adds a dish tapped in a set-menu folder without that question; (b)
  hides the count − and +, **Add a set menu**, remove-a-set-menu and in-bill move controls; and (c)
  drops the till's own refusal to move a set-menu dish to a bill with no free place
  (`set_menu.no_place_on_target`, `apps/till/src/screens/till-table-order-screen.ts:7349-7380`),
  since the server regroups both bills. Deletion and one branch in `#pickSetMenu`; the summary, tags,
  preview and pay list stay piece 4's. Lane C agrees the files before PR 2 starts. Alternative: land
  PR 2 and piece 4 together, which breaks "each PR leaves main working".
- **D2 (PR 2). Until PR 3, anything already reduced, and until piece 1 removes paying by item,
  anything paid for by item, stays as it was saved.** Today a comp or discount writes the line's
  price itself (`reprice`/`setPrice`, `apps/server/src/adjustments-apply.ts:1253-1350`), a whole-bill
  discount spreads over every row, set-menu rows included (`:462-510`), and nothing restores a price
  afterwards (no path removes an adjustment). Paying for items records per-line payments the
  set-menu code reads today (`set-menu-bill.ts:310-316`, `refusePaidLines`) until lane C's piece 1
  PR 3 removes them. A regrouping that rewrote those rows would silently drop a discount, or change
  the price of a dish already paid. So in PR 2 a dish is **frozen** when it or one of its extras is
  named by any comp or discount (`adjustments.line_id`, or an `adjustment_lines` row: a comp on an
  included dish takes 0 off and writes no `adjustment_lines` row, so `adjustedDishIds`,
  `set-menu-bill.ts:262-290`, alone misses it) or has a part paid by item; a set-menu line is frozen
  when it carries any comp or discount or holds a frozen dish; and every dish in a frozen set menu is
  frozen with it. The regrouping leaves frozen rows untouched and groups the rest. PR 3 lifts the
  freeze for comps and discounts; piece 1's PR 3 makes the paid case impossible. Between, a comp on a
  set menu keeps its dishes in it, and lines lowered by a bill discount keep their prices. The other
  way, making PR 2 wait for piece 1's PR 3, holds the critical path for lanes C, D and F.
- **D3 (PR 1). One new column, `working_order_lines.a_la_carte_unit_price`**, money, written once when
  the dish is added, on every top-level dish line (null on an extra and on a set-menu line). For an à
  la carte dish it equals the unit price it was priced at; for a dish tapped in a set-menu folder it
  is the dish's à la carte price (Task 2; options never change a unit price, `packages/menu/src/pricing.ts:406`,
  read). Split and moved rows keep it. Nothing reads it in PR 1 except tests and, once it lands, lane
  L's piece B.
- **D4 (PR 1). Line details stay the copy's unless a probe shows they differ.** The spec (section 1)
  says a dish's line details come from the full menu holding the set menu. Task 2 step 1 checks
  whether a set-menu copy's offer of a product already carries the same department, category and VAT
  class as the holding menu's ordinary offer; if it does, nothing else changes; if not, the task copies
  them from the ordinary offer and says so in the PR.
- **D5 (PR 2). A set menu's id survives regrouping.** The calculation keeps a saved menu's id when the
  menu survives and names new ones `new-menu-N` (`set-menu-grouping.ts:245-246`). The writer updates a
  surviving set-menu line in place, inserts a row for each new one and deletes one that is gone, so a
  comp or discount pointing at a surviving set-menu line keeps pointing at it.
- **D6 (PR 2). Credit:** a set-menu line is credited to whoever is credited with its earliest-added
  dish (spec section 5, the writer's call); today it is whoever pressed + (`set-menu-count.ts:93`).
- **D7 (PR 2). The course a dish counts as is its product's course** (spec section 1); the
  calculation matches a dish's `courseId` against a set-menu line's courses
  (`set-menu-grouping.ts:225`) and ignores the copy's per-dish course, which piece 5 removes.
- **D8 (PR 1). Linking on every order switches on the "linked set menu stays usable" behaviour
  earlier.** A recorded copy keeps its folder on the till (`apps/till/src/state/set-menus.ts:30-34`)
  and its dishes skip the out-of-period refusal (`working-order.ts:765,824-833`); today a copy is
  recorded only when a waiter sets a count. This is the spec's section 3. The last-orders design's
  section 6 later makes such a dish follow its station's last orders; lane F's A1568-3 carries that,
  after this piece. A bill read also loads the set-menu answer whenever the bill has a recorded copy
  (`hasSetMenus`, an `exists` on `bill_set_menu_copies`, `working-order.ts:5584-5589,5771`, read), so
  after PR 1 that load runs on every bill holding a dish some set menu lists. Task 4 measures one such
  read before and after and records it in the PR.
- **D9 (PR 1). Linking reads only the zone's set menus.** `listZoneOffers` filtered by dish returns
  no set menus (`packages/venue-service/src/operations.ts:895`, read), and unfiltered it prepares
  every offer in the zone. PR 1 adds a read of just the zone's set-menu copies, so a send does not
  prepare the whole zone.

## Global Constraints

- Every commit `git commit -s`; feature work in a `worktree.py new --headless` worktree.
- Money columns hold whole cents (`decimalToCents`/`centsToDecimal`); quantities whole thousandths.
- Multi-table writes share ONE transaction; write-path functions take `tx: Transaction`; queries on
  one transaction are awaited in turn, never `Promise.all`.
- A schema change edits the TypeScript schema and runs `migration-baseline rebuild --set core`; never
  a new migration (pre-live rule). Stored set-menu data is reset, not migrated (spec, last section).
- New code goes in new files under 1,000 lines (guard `scripts/product-file-size.test.ts`); new order
  code that needs no server file goes in `packages/orders-sales`.
- Error codes name the domain (`set_menu.*`), live in `apps/server/src/errors.ts`, map to an HTTP
  status in `apps/server/src/till-api.ts` and get English and Spanish till text in
  `apps/till/src/i18n/codes.ts`.
- The golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad`
  pass UNEDITED.
- Never block a sale because of set menus (spec anti-goals): a dish that fits no set menu is charged à
  la carte.

## Review Focus

1. **A dish tapped in a set-menu folder whose full menu also sells it à la carte at a different
   price** (croquetas 8.00 à la carte, included in the menu): the stored à la carte price is 8.00,
   never the supplement. Test in Task 2.
2. **A variant with no price of its own** (a product's variant whose `unit_price` is null,
   `packages/db/src/schema/menus.ts:133,184`): the à la carte price falls back to its dish's price.
   Test in Task 2.
3. **A dish split within its bill** (a comp carving one of three, `splitLinesWithinOrder`) or **split
   after print**: each new row keeps the à la carte price. Test in Task 3.
4. **A dish listed by two set menus on sale**: ordering it links both, once each; ordering a second
   such dish adds no duplicate; a set menu already recorded on the bill keeps its recorded copy even
   after a newer one is published. Test in Task 4.
5. **A bill that is not a set-menu bill** (a counter eat-in order, `refuseUnlessSetMenuBill`,
   `apps/server/src/set-menu-bill.ts:93`): ordering links nothing and nothing is refused. Test in
   Task 4.

---

## PR 1 — À la carte price and links (`feat/a1515-3-a-la-carte-price`)

_2026-11-24, after review: the price helper lives in `packages/orders-sales/src/a-la-carte-price.ts`, and a raised quantity also links (a review ruling, not a spec line)._

### Task 1: The column

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (beside `listUnitPriceGross`, `:267`)
- Regenerate: `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/*` (by the rebuild)
- Test: `packages/db/src/schema/orders.test.ts`

**Interfaces:**
- Produces: `workingOrderLines.aLaCarteUnitPrice` (`money("a_la_carte_unit_price")`, nullable), with
  check `working_order_lines_a_la_carte_price_ck`: `a_la_carte_unit_price is null or
  a_la_carte_unit_price >= 0`.

- [ ] **Step 1: Write the failing test** in `orders.test.ts`: inserting a line with
  `aLaCarteUnitPrice: -1` is refused naming `working_order_lines_a_la_carte_price_ck`; `0` and `800`
  are stored and read back.
- [ ] **Step 2: Run it and see it fail:** `pnpm --filter @waitron/db exec vitest run src/schema/orders.test.ts`
  — fails on the unknown property.
- [ ] **Step 3: Add the column and check**, with a one-line comment: "What the dish costs à la
  carte, written when it is added; a set menu's grouping charges it when the dish is not covered."
  Run `pnpm --filter @waitron/db db:generate` (it runs the server's `migration-baseline rebuild --set
  core`, `packages/db/package.json:31`).
- [ ] **Step 4: Run the test and the schema guards:** the Step 2 command, then from the root
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` — all pass.
- [ ] **Step 5: Commit** `git commit -s -m "Store each dish's à la carte price on its bill line"`.

### Task 2: Writing the price when a dish is added

**Files:**
- Create: `apps/server/src/a-la-carte-price.ts`
- Modify: `apps/server/src/working-order.ts` (`priceOrderLines`, `:654`; the row it builds for a line)
- Modify: `apps/server/src/set-menu-offers.ts` (`offerFor` also answers the holding full menu's
  document, which `setMenuOfferLookup` already reads, `:47-50`; it already answers the menu's id,
  `:95`)
- Test: `apps/server/src/a-la-carte-price.test.ts`

**Interfaces:**
- Consumes: `aLaCarteUnitPrice` (Task 1); `readRecordedDocuments` (`packages/menu/src/menu-publication.ts:325`),
  whose `MenuDocument.offers` holds the holding menu's ordinary offers keyed by menu-item id
  (`packages/shared/src/menu-document/menu-document-types.ts:129`).
- Produces: `aLaCarteUnitCents(document: MenuDocument, product: { productId: string; variantId:
  string | null }, own: { dishCents: number; variantCents: number | null }): number` — the holding
  menu's ordinary offer of the product (its variant's price where the variant is listed), else the
  variant's own price, else the dish's own price. Every top-level dish row `priceOrderLines` builds
  carries `aLaCarteUnitPrice`.

- [ ] **Step 1: Probe D4.** In a test using `useVenueDb` and the existing set-menu seed helpers
  (search `apps/server/src/set-menu-*.test.ts` for the one that publishes a full menu holding a set
  menu), read the set-menu copy's offer and the holding menu's ordinary offer of the same product and
  compare department, category and VAT class. Record the result in the task's commit message. If any
  differs, add copying them from the ordinary offer to Step 4 and a test of it to Step 2.
- [ ] **Step 2: Write the failing tests** in `a-la-carte-price.test.ts`:
  - `aLaCarteUnitCents` answers 800 for a product the holding menu sells at 8.00; the listed
    variant's menu price for a variant; the variant's own price when the menu does not list the
    product; the dish's own price when the variant has none.
  - Sending a draft with an à la carte croquetas line at 8.00 stores `unitPriceGross 800,
    aLaCarteUnitPrice 800`.
  - Sending a draft with croquetas tapped in a set-menu folder (included, holding menu sells it at
    8.00) on a bill with one set menu stores `unitPriceGross 0` (today's placement, unchanged) and
    `aLaCarteUnitPrice 800`; with a 2.50 supplement, `unitPriceGross 250` and `aLaCarteUnitPrice 800`.
  - The same through the counter path (`PUT /api/working-orders/:id`, a takeaway bill) and through
    creating an order with dishes (`POST /api/working-orders`, `createOpenOrder`,
    `working-order.ts:1548`, its insert at `:1716`).
  - An extras child row and a set-menu row carry `aLaCarteUnitPrice null`.
- [ ] **Step 3: Run them and see them fail:** `pnpm --filter @waitron/server exec vitest run src/a-la-carte-price.test.ts`.
- [ ] **Step 4: Implement.** `aLaCarteUnitCents` in `a-la-carte-price.ts`. In `priceOrderLines`, for
  a set-menu line (`isSetMenu`, `working-order.ts:801-804`) read the holding menu's document by the
  version the line names (`setMenuOfferLookup` already reads it, `set-menu-offers.ts:47-50`; expose its
  id rather than reading twice) and the product's own prices (one read for the whole basket, before
  the line loop: CLAUDE.md §3 "Resolve shared menu data once before a basket's line loop"); the row's
  `aLaCarteUnitPrice` is `aLaCarteUnitCents`. For an à la carte line it is its priced unit price.
- [ ] **Step 5: Run the Step 3 command, then the set-menu suites:** `pnpm --filter @waitron/server
  exec vitest run src/set-menu-send.test.ts src/set-menu-drafts.test.ts src/set-menu-money.test.ts
  src/working-order.test.ts` — all pass with no assertion changed.
- [ ] **Step 6: Commit** `git commit -s -m "Write each dish's à la carte price when it is added"`.

### Task 3: Split and copied rows keep the price

**Files:**
- Modify: `apps/server/src/working-order.ts` (`carveLines`'s `context`, `:4983-4989`, which its one
  insert at `:5154` copies)
- Test: `apps/server/src/a-la-carte-price.test.ts`

- [ ] **Step 1: Write the failing test:** a comp on one of three croquetas (carving a row through
  `splitLinesWithinOrder`) leaves both rows with `aLaCarteUnitPrice 800`. Two cases that already pass
  and pin it against regressions: Reopen to split keeps it on the new bill's dishes
  (`copyBillDishes` copies whole rows, `split-after-print.ts:149-153,165`); a dish moved with Move
  dishes keeps it (rows moved in place, `working-order.ts:4398-4406`).
- [ ] **Step 2: Run and see the carve case fail** (Task 2's command).
- [ ] **Step 3: Add the column to `carveLines`'s `context`.**
- [ ] **Step 4: Run** Task 2's command and `src/set-menu-bill-split.test.ts src/split-after-print.test.ts` — pass.
- [ ] **Step 5: Commit** `git commit -s -m "Keep the à la carte price on split and copied dishes"`.

### Task 4: Ordering a dish links the set menus that list it; a moved dish brings them

**Files:**
- Create: `apps/server/src/set-menu-links.ts`
- Modify: `packages/venue-service/src/operations.ts` and its module seat in
  `packages/module/src/module.ts` (`listZoneSetMenus`, D9); `apps/server/src/working-order.ts`
  (`insertTabRound`, `:3276`; `createOpenOrder`'s insert, `:1716`; the insert in `applyLineEdits`,
  near `:7051`; `moveOrderLines`'s carry, `:4382-4389`); `apps/server/src/set-menu-bill.ts` (a
  non-throwing `isSetMenuBill` beside `refuseUnlessSetMenuBill`, which then calls it)
- Test: `apps/server/src/set-menu-links.test.ts`, `apps/server/src/set-menu-period.test.ts`

**Interfaces:**
- Consumes: `VENUE_SERVICE.findOrderContext`; `setMenuOfferOf` and `copiesListing`
  (`packages/shared/src/set-menu-bill.ts:19,66`).
- Produces: `VENUE_SERVICE.listZoneSetMenus(tx, zoneId)` — the same set-menu copies, with
  `newestOnSale` and `versionIds`, that unfiltered `listZoneOffers` answers today, without preparing
  the zone's other offers. `linkSetMenusFor(tx: Transaction, billId: string, dishes: readonly {
  productId: string; variantId: string | null }[]): Promise<void>` — `dishes` named as set-menu
  listings name them (a variant dish row stores the variant's id as `productId`; listings use the
  parent's id plus the variant's, as `set-menu-moves.ts:102-105` maps them); on a set-menu bill,
  records in `bill_set_menu_copies` the newest copy on sale in the bill's zone of every set menu
  listing one of `dishes`, choosing the version as `firstCopyOnSale` does (`set-menu-count.ts:107-124`),
  `onConflictDoNothing` on `(working_order_id, set_menu_id)`; on any other bill it does nothing.
  `firstCopyOnSale` is rebuilt on the shared choice so the two never differ. A move carries, besides
  today's carry for moved set-menu lines, the source bill's recorded copy of every set menu listing a
  moved dish (spec section 3, "A dish moved to another bill brings its links").

- [ ] **Step 1: Write the failing tests:** Review Focus 4 and 5, each as its own case: a dish on two
  set menus links both; a second such dish adds no row; a recorded copy is kept after a newer
  version is published; a variant dish links the set menus listing that variant; a dish on no set
  menu links nothing; a counter eat-in bill links nothing and its add succeeds; a dish tapped in an à
  la carte folder links the set menus that list it too; a takeaway order created with dishes links
  them; a dish moved with Move dishes to a bill without links arrives with its set menus recorded at
  the source's version. In `set-menu-period.test.ts`: after a dish of the lunch set menu is ordered
  at 15:30, a second dish of that set menu sent at 16:15 (period ended) is accepted (D8).
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/server exec vitest run src/set-menu-links.test.ts src/set-menu-period.test.ts`.
- [ ] **Step 3: Implement** `listZoneSetMenus`, `linkSetMenusFor` (called once per round with the
  round's new dish rows, after they are inserted) and the move's carry.
- [ ] **Step 4: Run** Step 2's command and `src/set-menu-count.test.ts src/set-menu-send.test.ts
  src/set-menu-bill-moves.test.ts src/working-order.test.ts src/order-drafts.test.ts`, and
  `pnpm --filter @waitron/venue-service exec vitest run` — pass. A changed assertion is listed under
  "Changed test checks" with the spec line that changed it (spec section 3). Time one bill read
  (`GET` of a table's bill holding one linked dish) before and after the branch, and put both figures
  in the PR (D8).
- [ ] **Step 5: Commit** `git commit -s -m "Link every set menu on sale that lists a dish when it is ordered or moved"`.

### Task 5: Backlog and the record

- [ ] Update `docs/backlog/menu.md`'s A1515 entry: piece 3 PR 1 done (price and links), PRs 2–4 left.
  Add a dated pointer in the spec's section 5 ("keeps on each dish its à la carte price") naming the
  column. Commit `-s`.

---

## PR 2 — The bill works out its set menus (`feat/a1515-3-regroup`)

Scope, to be written as tasks on this page before building:

- `saveBillGrouping` in `packages/orders-sales/src/set-menu-grouping-save.ts`: given a bill, its
  offers and the dishes eligible under D2, runs `groupSetMenus` with the saved grouping as
  `previous`, then writes set-menu lines per D5 and D6 and each dish's `set_menu_id`,
  `set_menu_line_id`, `set_menu_place` and charged price (0, its supplement, or
  `a_la_carte_unit_price`; paid extras unchanged). A server wrapper `regroupBills(tx, billIds)` in
  `apps/server/src/set-menu-regroup.ts` reads the linked copies (`serveRecordedSetMenus`) and calls it.
  A bill whose calculation is not exact still saves its answer (spec section 4, "never block a sale").
- Called last in every path the code map lists as changing a bill's dishes: draft send
  (`submitDraft` → `placeGroups`), counter add and edit (`applyLineEdits`), `createOpenOrder`,
  cancel (`cancelItem`, `removeFromLine`, `removePortions`), splits (`carveLines` callers,
  `splitAfterPrint`), moves (`moveOrderLines` for both bills, `moveBill`), `mergeBills`,
  `splitTable`, and lane C's pay-for-items move, split and put-back if #4238 has landed
  (`pay-for-items.ts`, `movedItemsBack`). One test per path asserts the saved grouping after it.
- Frozen rows per D2 are left out of the calculation and not written.
- Removed: `placeSetMenuRows` and placing at send, `set_menu.no_place`, the count and remove routes
  (`till-api.ts:3350,3372`, `set-menu-count.ts`), the in-bill move route (`till-api.ts:4304`,
  `moveSetMenuDishes`), the placing in `replaceMovedDishes` (`set-menu-moves.ts:65`, called at
  `working-order.ts:4410`), draft reservations (`order_draft_lines.set_menu_reserved_line_id`,
  `set_menu_reserved_place`, `refuseDraftLosingSetMenuPlace`, `set_menu.needed_by_draft`), and
  `set_menu_counts_as_course_id` with the dish clause of `working_order_lines_set_menu_ck` that
  requires it (`orders.ts:405-408`), with their tests and till text. `set_menu.move_adjusted` stays
  until PR 4. `GET /api/bills/:id/set-menus` keeps its answer's shape for the till until piece 4.
- A set-menu line is written only by the regrouping (spec section 5): it is sent and served when
  written, as `set-menu-count.ts:86-88` does today; cancel and adjustment-cancel already refuse it
  (`line-cancel.ts:211`, `adjustments-apply.ts:874-875`); the page names how the counter basket edit
  (`applyLineEdits`) treats one and tests it.
- D1's till change.
- The open question with the owner (a very large party paying a few euros over the cheapest) does
  not hold this PR: the calculation's `exact: false` is passed through for piece 4's summary.

## PR 3 — Comps and discounts (`feat/a1515-3-adjustments`)

- A dish's own comp or discount: before it is written, the dish is repriced at its à la carte price,
  then reduced, and leaves the grouping; the rest regroups. A preview route answers the bill's new
  total for piece 4's warning (spec section 6).
- A set menu's comp or discount: stored as today's adjustment on the set-menu line, and passed to
  `groupSetMenus` as its discount (`SetMenuGroupingDiscount`, keyed by the adjustment id); a new one
  replaces the old (`replacesDiscountId`) and the answer's `unusedDiscountIds` are reported back to
  the till with a `set_menu.discount_dropped` notice. It covers the menu's price and its dishes'
  supplements, not paid extras.
- A whole-bill discount: no longer counts as a dish's own (`adjustedDishIds` and `reducedLineIds`
  stop counting it, spec section 6); after each regrouping it is spread again, a percentage as that
  percentage, an amount as that amount. How the per-line reductions are stored, given
  `adjustment_lines` is append-only (`packages/db/src/schema/adjustments/adjustment-lines.ts:5-10`),
  is decided on this page with every reader of `adjustment_lines` traced first.
- D2's freeze is removed for comps and discounts (the item-paid part stays until piece 1's PR 3).
- The spec reruns the grouping when a comp or discount is "removed"; no path removes one today
  (nothing outside tests updates or deletes `adjustments` or `adjustment_lines`), so this PR adds
  none.

## PR 4 — Moving dishes with their discounts (`feat/a1515-3-moves`)

- `set_menu.move_adjusted` (`set-menu-moves.ts:96-99`) and moving "a set menu with its dishes"
  (`resolveMoveLines`, `bill-actions.ts:231-247`) go; dishes move one by one with their own comps and
  discounts; a set menu's discount stays on its bill.
- Both bills regroup (PR 2's call already does); a test per move path (`moveDishes`, `mergeBills`,
  `splitTable`, pay-for-items) shows a discounted dish arriving discounted and both totals.

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
set-menu discount does not lock its dishes. _2026-11-26: the owner's rule C (D45) replaces
the two set-menu discount rules above: D52 recommends that a second discount on a set menu still
replaces the first, but two discounted set menus never become one, since a set menu that breaks up loses its
discount._ Code facts below were read at main `e8df6f7699`, not run,
unless a step says it runs them. PR 3b, PR 3c and decisions D45–D59 cite 3a's head after its
rebase, `fa3d08f2f5` (#4361); the sections in between say which commit theirs are on.

## The split: four pull requests

Every one changes what a bill charges, so each takes the full review wave (two Codex angles), and
the OWNER lands it. Each leaves `main` working on its own.

| PR | What a person can do when it lands | Depends on |
| --- | --- | --- |
| 1. À la carte price and links (`feat/a1515-3-a-la-carte-price`) | Every dish on a bill stores the price it would cost à la carte, also when tapped in a set-menu folder (lane L's VAT piece B reads it, its decision S2). Ordering any dish records on the bill every set menu on sale that lists it, and a moved dish brings those records. What staff see change (D8): once a dish is ordered, the till keeps offering that set menu's folder after its period ends, and its dishes are not refused as out of period, as the spec's section 3 says ("A linked set menu stays usable"); today that starts only when a waiter sets a count. | — |
| 2. The bill works out its set menus (`feat/a1515-3-regroup`) | A waiter adds dishes from anywhere; the bill forms the cheapest set menus by itself on every send, add, edit, cancel, split and move, and every till shows the same answer. No counts, no "No place for this dish" question. Anything already comped, discounted or paid for by item stays as it was saved (D2). Built as 2a, 2b and 2c (see its section). | 1 |
| 3. Comps and discounts (3a, 3b and 3c, see its section) | A dish with its own comp or discount is charged à la carte less it, and the rest regroups; a set menu's discount takes off that menu's price and supplements, one per menu, and falls away with a notice when the bill has no menu of that type left; a whole-bill discount stays its percentage or its amount as the bill regroups. | 2 |
| 4. Moving dishes with their discounts (`feat/a1515-3-moves`) | A discounted dish moves to another bill alone, with its discount; both bills regroup; moving "a set menu with its dishes" is gone. | 3 |

_2026-11-26: rows 3 and 4 are replaced by the owner's rule C (D45): discounts are amounts on the
whole bill, a dish or a set menu, and PR 4 is no longer needed (D57); PR 3's section has the split._

PRs 1 and 2 are written out task by task below. PRs 3–4 are given as scope, decisions and files; each gets
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

Written 24 November against `main` at `01ec75f7e0`, where PR 1 (#4258) landed, and re-pointed to
`c5e7ee3924` after #4264 split `order-groups.ts` (its other files moved by two lines at most in
`till-api.ts` and `working-order-line-edits.ts`, re-read). PR 1's head
`9b808afbc8` holds the same server order, set-menu and payment files and the same database schema
(`git diff --stat 9b808afbc8 01ec75f7e0` touches none of them; in `errors.ts` it changes only
promotion entries). Its till files differ (`till-app.ts`, `menu-browser.ts`), so till lines are main's.
Every `file:line` below is on `c5e7ee3924` and was read, not run, unless a step runs it.

**Should this exist?** The need is the owner's: "A product should be a product. So it doesn't
matter how you order it, you get the same meal", and the waiter "only adds dishes" while the bill
charges "the most economic solution" (spec, Why and Goals 1–2). Once 2a–2c land, a waiter adds dishes
from any folder and every till, bill, receipt and invoice shows the cheapest grouping the server
saved; there is no count and no "No place for this dish" question. Still unavailable afterwards: the
till's summary, tags and preview (piece 4), comps and discounts that regroup (PR 3), moving discounted
dishes (PR 4), set menus on takeaway (D14, until VAT piece B; dropped 2026-11-25 in Task 2b.8) and at
the counter eaten in (piece 6).
The simplest alternative, working the grouping out only when someone looks, is the spec's approach 2,
which the owner rejected (two tills could disagree, a filed bill could change). What PR 2 adds beyond
the need: 2a lands a writer nothing calls until 2b (a reviewer reads it without its callers), and one
stored flag for "may not be the cheapest" (D16), one stored record of the grouping's last input
(D28) and one recorded course per dish (D12). **True size:** the table under "The split". **Who approved
what:** the spec is the owner's (its Status line, commit `8dc86752ba`); D1 and D2 are the watcher's
(`~/waitron-campaign-b/questions.md:551-557`, 24 November 16:45); the "may not be the cheapest" note
is the owner's ("Accept it", `questions.md:563-565`); D10–D28 below are this plan's, not yet cleared:
D14 and D24–D27 are for the owner, the rest for the watcher.

### For lane C (agree before 2b starts)

2b changes these till files and functions, and nothing else on the till:

- `apps/till/src/widgets/menu-browser.ts` — `#pickSetMenu` (`:716-760`): the branch that opens the
  place question (`:735-745`) goes, with the draft read only it uses (`:721`), so a dish tapped in
  a set-menu folder is added with no question and no reservation; the render's `@add-set-menu`
  listener (`:1259`) goes with the folder's button.
- `apps/till/src/widgets/set-menu-folder.ts` — the "Add a {name}" button (`:69-81`) goes.
- `apps/till/src/widgets/set-menu-summary.ts` — the Cancel button on a set menu (`:224-240`) is drawn
  only when `removeMenu` is given (move options already need `moveDish`, `:156`); one line "These set
  menus may not be the cheapest for this bill." is drawn when the bill's answer says `exact: false`
  (the owner, `~/waitron-campaign-b/questions.md:563-565`).
- `apps/till/src/i18n/strings.ts` — that line's English and Spanish text (`set_menu.not_cheapest`).
- `apps/till/src/screens/till-table-order-screen.ts` — `#setMenuControls` (`:1894-1928`) draws no
  `till-set-menu-counts` (the help badge stays, in its own `help-anchor` span; the selector at
  `:1141`) and gives the summary no `removeMenu` or `moveDish`; `#addSetMenu` (`:1934-1941`) goes;
  the menu browser gets no `addSetMenu` or `moveSetMenuDishes` (`:3094-3095`); in `#moveDishPrices`
  (`:7319-7400`) the `set_menu.no_place_on_target` refusal (`:7381-7387`) and the target price lines
  for loose set-menu dishes (`:7389-7398`) go (D23); the cancelled-dish refusal (`:7328-7337`) stays.
- `apps/till/src/till-app.ts` — `#tabBody`'s counter branch (`:24440-24450`) passes the counter no
  set-menu copies (D14).
- `apps/till/src/i18n/codes.ts` — `set_menu.remove_from_summary` (`:48-51`) is reworded in English and
  Spanish: it can no longer point at a Cancel in the summary (spec section 5).

Left unreachable for piece 4 to delete (D22): the place question in `menu-browser.ts` (`placeRequest`,
`#placeChoices`, `openSetMenuPlace`), `widgets/set-menu-counts.ts`, the screens' `changeSetMenu`,
`saveSetMenuCount` and `moveSetMenuDishes` properties, `till-app.ts`'s `#changeSetMenu`,
`#saveCounterSetMenuCount`, `#moveCounterSetMenuDishes` and its `set_menu.no_place` follow-up
(`:737`, `:15538-15546`, `:15926`), the client's `setSetMenuCount`, `removeSetMenu`,
`moveSetMenuDishes` (`api/client.ts:5504-5540`) and `firstSetMenuId` (`:3584`), the texts of the
codes 2b stops sending, and the drafts' `setMenuReserved` fields with the server's draft-reservation
columns. Lane C's in-flight PR 2 (`feat/a1515-1-pay-items-till`) changes `till-table-order-screen.ts`
in `#orderSummary`, `#footFixed`, `#takesPayment` and `#billMoneyNotices`, and `till-app.ts`, `codes.ts`
and `strings.ts` elsewhere (read from its branch diff); none of the functions above. 2c changes
`apps/server/src/pay-for-items.ts` (`readPicks`, `priceItemPicks`), which lane C's PR 4 also edits.

### The split: three pull requests

Every one changes what a bill charges, so each takes the full review wave and the OWNER lands it.

| PR | What it does; how main works after it | Depends on |
| --- | --- | --- |
| 2a. The grouping writer (`feat/a1515-3-regroup-writer`) | Adds the code that works out and saves a bill's grouping, the schema it needs, the course each dish counts as (recorded when added) and the `exact` answer field; nothing calls the writer yet, so counts, placing at send and the no-place question work as today. Resets venues (schema). | 1 |
| 2b. The switch (`feat/a1515-3-regroup`) | Every path that changes a bill's dishes regroups; counts, the remove and in-bill move routes, placing at send and the no-place refusals go; the till stops offering them (D1). Resets venues (D26: the copies' key gains the version). | 2a |
| 2c. Pay for items and clean-up (`feat/a1515-3-regroup-tidy`) | Pay for items prices chosen items as their own bill would group them and takes a set-menu dish alone; `set_menu_counts_as_course_id` goes. Resets venues. | 2b |

**Why not one pull request, and why 2b cannot be split further.** As scoped, PR 2 is roughly 2a + 2b +
2c: well over three hours. 2a can land alone because it changes no path. 2b cannot be cut: a path left
not regrouping writes stale prices (a dish moved out of a set menu keeps its 0 on the other bill); the
count route left in place lets a stale till add a set menu the next regroup removes, so a bill paid in
between pays for it; and the till must lose the no-place question in the same change, or it keeps asking
"No place for this dish" and, for a dish no à la carte menu sells, its only way on (**Add a set
menu**, `menu-browser.ts:794-830`) calls a route that is gone. 2c can follow because 2b keeps Pay for
items' refusal of a set-menu dish chosen alone (D21), and the column it drops is still written
correctly in between.

**Size** (estimates from reading, not measured; generated files are the core starting migration,
`packages/db/drizzle/0000_baseline.sql` and its snapshot):

| PR | Product lines | Test lines | Generated | Implementer time | Tasks |
| --- | --- | --- | --- | --- | --- |
| 2a | about +620 | about +650 | baseline rebuilt | about 3 hours | 5 |
| 2b | about +190, −670 | about +600, −900; about 30 cases changed | none | about 4½–5½ hours | 7 |
| 2c | about +120, −60 | about +200 | baseline rebuilt | about 1½ hours | 2 |

**2b is over the three-hour budget, and this is the accepted exception for the watcher to clear:** it
cannot be split further for the reasons above. Each of its seven tasks ends green and stays well under
100 tool calls.

### Where the scope's references now are

`working-order.ts` was split by #4249; these replace the scope's line numbers.

| Scope named | Now |
| --- | --- |
| `serveRecordedSetMenus` | `packages/venue-service/src/set-menu-copies.ts:52` |
| draft send `submitDraft` → `placeGroups` | `order-drafts.ts:778` → `placeGroups` (`order-group-submission.ts:152`, its call at `order-drafts.ts:868`) → `insertTabRound` (`working-order-open.ts:479`, placing at `:493-497`, link `:510`, limit `:511`) |
| counter add and edit `applyLineEdits` | `working-order-line-edits.ts:145` (placing `:988-996`, link `:1001`, deletes `:1135-1149`, `assertLinesKeptExcess` `:1150`, limit `:1151`) |
| `createOpenOrder` | `working-order-open.ts:101` (insert `:267-272`, link `:274`, `selectOrderInvoice` `:276`) |
| cancel `cancelItem`, `removeFromLine`, `removePortions` | `line-cancel.ts:120` (calls `:325-342`); `working-order-removal.ts:107` (delete `:182-188`, then `assertBillInvariant` `:190`; reduce, then `:210`) and `:217` (delete `:269-275`, then `:276`); also from `adjustments-apply.ts:1388-1407` |
| splits (`carveLines` callers), `splitAfterPrint` | `carveLines` `working-order-transfer.ts:376` via `carveOffLines` `:365`, `splitLinesWithinOrder` `:689`, `splitUnitsWithinOrder` `:702`; `splitAfterPrint` `split-after-print.ts:50`, `copyBillDishes` `:144` |
| `moveOrderLines` (both bills), `moveBill` | `working-order-transfer.ts:79` (draft check `:151-158`, carry `:160-168`, move loop `:178-186`, `replaceMovedDishes` `:189-194`, limit `:206`); `move-bill.ts:134` |
| `mergeBills`, `splitTable` | `bill-actions.ts:116` → `mergeCheckedBills` `:157` → `moveOrderLines` `:174`; `table-actions.ts:345` → `moveCheckedDishes` `:427` → `carveOffLines` (`bill-actions.ts:387`) |
| pay-for-items move, split, put-back | `moveItemsToNewBill` `pay-for-items.ts:225` (split `:250`, `moveDishes` `:254`); `movedItemsBack` `bill-payments.ts:2627` (`moveOrderLines` `:2643`) |
| `placeSetMenuRows`, `set_menu.no_place` | `set-menu-bill.ts:485`, `:508` |
| count and remove routes | `till-api.ts:3358` (PUT) and `:3380` (DELETE), helper `changeSetMenus` `:3337`; `set-menu-count.ts` |
| in-bill move route | `till-api.ts:4312`, `requireSetMenuMoves` `:1066`; `moveSetMenuDishes` `set-menu-moves.ts:20` |
| placing in `replaceMovedDishes` | `set-menu-moves.ts:61` (called at `working-order-transfer.ts:190`) |
| draft reservations | `order_draft_lines` columns `packages/db/src/schema/order-drafts.ts:88-89`, check `:128-131`; `readSetMenuReservations` `set-menu-bill.ts:398`; `refuseDraftLosingSetMenuPlace` `:425`; `set_menu.needed_by_draft` `:479` |
| `set_menu_counts_as_course_id` and its clause | `packages/db/src/schema/orders.ts:312`, check `:408-424`; trigger lines `packages/db/triggers/core.sql:403,478,572` |
| set-menu line sent and served when written | `set-menu-count.ts:83-85` |
| cancel refuses a set-menu line | `line-cancel.ts:208`, `adjustments-apply.ts:871-872` |
| `GET /api/bills/:id/set-menus` | `till-api.ts:3319` |

### Decisions for the watcher (new in PR 2)

- **D10. A dish tapped in a set-menu folder is priced at its à la carte price when it is added; only
  the regrouping lowers it.** Today it is priced at the copy's supplement (`priceOrderLines` takes
  `selection.unitPrice` from the copy's offer, `working-order-pricing.ts:582`, and placing
  overwrites it, `set-menu-bill.ts:388-395`). So a path that failed to regroup would overcharge,
  never undercharge. On the till nothing changes before sending: an unsent dish tapped in a set-menu
  folder shows the folder's price, "included" or its supplement, because the till builds it from the
  copy's offer (`setMenuProduct`, `apps/till/src/widgets/product-pick.ts:38-49`). Once sent, the bill
  shows the saved grouping: 0 or the supplement in a set menu, otherwise the à la carte price. 2b's
  PR body says so in one line. Alternative: keep the supplement and let the writer correct it.
- **D11. A dish row's `set_menu_id` stays where its menu item came from; the grouping writes the
  rest.** The edit path finds a stored set-menu dish's offer again by `set_menu_id`, version and menu
  item (`working-order-line-edits.ts:260-281`), and the held-order read hands the same to the till
  (`working-order-held-read.ts:386-390`). Receipts read `set_menu_role = 'dish'` as "covered by a set
  menu" (`packages/orders-sales/src/receipt-lines.ts:228,233`). So the regrouping writes
  `set_menu_role` (`'dish'` in a set menu, null otherwise), `set_menu_line_id`, `set_menu_place`,
  `set_menu_counts_as_course_id` (until 2c), `unit_price_gross` and `line_total`, never `set_menu_id`.
  The check `working_order_lines_set_menu_ck` then lets a row with no role keep a `set_menu_id`, and
  lets a `'dish'` row have none (a dish tapped à la carte, grouped). Alternative: a new column for the
  origin.
- **D12. The course a dish counts as is recorded on its line when it is added**, in a new column
  `working_order_lines.counts_as_course_id`: its product's `course_id`, a variant's own else its
  parent's (`packages/shared/src/menu-document/product-types.ts:75`). No column holds it today: the
  line's `course_id` is the waiter's choice (spec section 1), and `set_menu_counts_as_course_id` is set
  only on a placed dish, from the copy (`set-menu-bill.ts:388-395`). Reading the product live at each
  regroup would let a dashboard edit change an open bill's grouping, against the spec's "Nothing else
  changes the saved answer". A menu item's course override (`packages/menu/src/menu-document.ts:878`)
  is not used. Splits copy it (the carve context, `working-order-transfer.ts:445`) and Reopen to split
  copies whole rows (`split-after-print.ts:162-170`). 2a adds it, since 2a already resets venues.
- **D13. Only a dish row holding exactly one whole portion takes part, unless its product is sold
  by measure** (`quantity` 1000, and the row's unit not a measure: the flag `assertSetMenuPortion`
  refuses on, `set-menu-offers.ts:126`). Table sends write one row per portion (`expandPortionRows`,
  `order-portions.ts:55`, from `order-group-submission.ts:219-225`), so do new counter lines
  (`expand: true`, `working-order-line-edits.ts:351-355`). Any other row is charged as stored.

  _2026-11-25, corrected in 2b Task 2b.2: this said "and `count_as_portions`", which left out a whole
  portion of a dish whose unit takes fractions; the spec's Goal 2 groups it._

  _2026-11-25, corrected in 2b review: "charged as stored" left a dish at its set-menu price once a
  line edit raised it past one portion, or its unit became a measure, while its set menu was
  deleted. An unfrozen dish row left out keeps its stored charge only when it holds no set-menu
  place and costs its à la carte price; otherwise the grouping writes it à la carte (place cleared,
  unit price its `a_la_carte_unit_price`, line total that times its quantity). The measure flag is
  still read live from `units`: the line records no copy of it (`count_as_portions` also folds in
  the unit's decimals)._

  _2026-11-25, corrected again in 2b's run-it review: reading it live let a unit made a measure
  after Hake was ordered take Hake out of its Daily when Water was cancelled, raising the bill to
  22.00, and the cancel failed `adjustments_amounts_ck`. The flag is now the unit of the offer the
  line was ordered from, in the menu version the line records (`menu_version_id`, `menu_item_id`;
  `orderedByMeasure` in `apps/server/src/set-menu-regroup.ts`), so a unit setting changed later
  moves no dish already on the bill._
- **D14. FOR THE OWNER. A takeaway or delivery bill is grouped with no set menus until VAT piece B.** Grouping one
  would make it unpayable: payment refuses a takeaway bill holding a set-menu row
  (`refuseTakeawaySetMenuMoney`, `set-menu-bill.ts:66-90`, from `bill-payments.ts:1759`), and PR 1
  links set menus on takeaway bills (`isSetMenuBill`, `set-menu-bill.ts:92-105`). So the regrouping
  passes such a bill no offers (every dish charged à la carte, any set-menu line removed), and the
  counter offers no set-menu folders (today they show only for takeaway,
  `till-counter-screen.ts:304-307`). No dining switch can change a grouping (2b Task 2b.3's note).
  Piece B lifts it in one line. **FOR THE OWNER:** spec section 8 keeps set menus for takeaway and
  delivery; this takes them away from the counter until piece B. Alternatives: group takeaway and
  accept that such orders cannot be paid (breaks "never block a sale"), or hold 2b until piece B.
  _Owner's answer (watcher 2026-11-24 22:30): "Accept for now"._
  _Dropped in 2b.8: B1 (#4275) landed first; watcher ruling 2026-11-24 23:40._
- **D15. What freezes a row (D2), as read:** an `adjustments` row naming it whose action is not
  `cancel`; any `adjustment_lines` row naming it; a `cancel` with `charge_kept` naming it, or a
  `line_service_cancellations` row (today's not-movable set, `set-menu-bill.ts:323-339,352`); any
  `bill_payment_lines` row naming it, in any state, as today (`set-menu-bill.ts:318-322`); and a set
  `list_unit_price_gross`. That last one carries D2 to copies and splits: a comp that took 0 off
  writes no `adjustment_lines` row (`adjustments-apply.ts:1341`), so `carryLineReductions`
  (`order-portions.ts:143-167`) carries nothing for it, and the copy's new id is named by no
  `adjustments` row; but `reprice` stamps `list_unit_price_gross` on every row a comp or discount
  touches, before it splits (`adjustments-apply.ts:1284-1290`), splits copy it
  (`working-order-transfer.ts:417,581`) and Reopen to split copies whole rows
  (`split-after-print.ts:162-170`). Read, not run: 2b Task 2b.4's carried-comp case checks it. Rows are
  named by line id, not by bill, because a comp stays on its bill while its line moves
  (`set-menu-bill.ts:285-287`). The charge-kept cancel is beyond D2's words; alternative: regroup it.
- **D16. `exact` is stored on the bill** as `working_orders.set_menus_exact` (true by default),
  written by every regrouping, and served as `exact` on the set-menu answer
  (`BillSetMenuState.exact?: boolean`, absent read as true, so the till's own states need no
  change). Alternative: rerun the calculation on every read.
- **D17. No regrouping where no dish changes:** splitting a row within its bill
  (`carveLines` with `from === to`), `copyBillDishes` (an exact copy of the saved grouping) and
  `moveBill` (lines and links unchanged). A comp's `reprice` (`adjustments-apply.ts:1276`) carves
  its row (`:1293-1320`), then writes the prices `planAdjustment` (`:804`) worked out before the carve
  (`:1409-1414`); a regrouping inside the carve would change prices under it. Each gets a test that
  the saved grouping is unchanged.
- **D18. Moving a dish alone out of its set menu** (a "loose dish", `working-order-transfer.ts:144-147`)
  is refused `set_menu.move_adjusted` when its own comp or discount freezes it (D15's comp and
  discount sources and the stamped list price, wider than today's `reduction > 0`,
  `set-menu-bill.ts:264-301`), and
  `set_menu.no_place_on_target` when a cancel kept its charge (as today, `set-menu-moves.ts:89-91`).
  Otherwise it moves and both bills regroup. Without the widening, a dish comped while included (0
  off) would arrive at 0 on a bill whose regrouping must leave it frozen.
  _2026-11-26: for a dish of a set menu holding its own comp or discount, replaced by rule C: the
  discount comes off and the dish moves (D50)._
- **D19. A set-menu line's credit** (D6) is recomputed at every write: whoever is credited with its
  dish of lowest `line_no` (line numbers grow as dishes are added, `working-order-open.ts:453-472`; a
  moved dish takes the next numbers on its new bill, `working-order-transfer.ts:173-186`).
- **D20. The pure planning goes in `packages/orders-sales`; reading and writing go in
  `apps/server`.** The only fixtures that publish set menus and send dishes are the server's
  (`apps/server/src/testing/set-menu-spec-fixture.ts:79`), and `orders-sales` must reach 98% coverage
  from its own tests. Alternative: seed raw rows in `orders-sales` tests.
- **D21. Pay for items keeps refusing a set-menu dish chosen without its set menu until 2c**
  (`pay-for-items.ts:155-161`). While it stands, the preview (`priceItemPicks`, `:198`) prices a set
  menu with its dishes at their stored prices. That equals what their own bill regroups to whenever
  the saved grouping was exact, by reasoning, not test: were those dishes cheaper grouped another way
  on their own, the whole bill would have been too. That fails when the source's saved grouping is
  not the cheapest (a large party, `exact: false`, or a frozen set menu): the preview then differs from
  the new bill's total. Recommended: keep 2c.1 in 2c and pin in 2b Task 2b.4 that such a payment is
  refused by the allocation check (`bill-payments.ts:1915`) rather than taking the wrong amount.
  Alternative: bring 2c.1 into 2b, which is already over budget. 2c prices picks with the grouping and
  lifts the refusal.
- **D22. The till code 2b leaves unreachable, and the draft-reservation storage, go with piece 4**
  (lane C), which rewrites the same widgets and the till's drafting. 2b stops reading reservations;
  `order-drafts.ts` keeps storing what the till sends. Alternative: 2c deletes them.
- **D23. Move dishes no longer previews prices for loose set-menu dishes** (`#moveDishPrices`'s
  price lines, which come from the till's old placement); piece 4 brings the new preview.
  Alternative: keep the lines until piece 4.
- **D24. FOR THE OWNER. What a cancel records when the bill regroups.** Cancelling Sirloin (+5.00)
  from a Daily of Soup and Sirloin takes the bill from 19.00 to 6.00; the cancel's recorded reduction
  (`planAdjustment`, `adjustments-apply.ts:900-907`) is the cancelled dish's own charge, 5.00, and the
  adjustments report sums it (`packages/adjustments/src/reports.ts:191-193`). Recommended: keep
  recording the dish's own charge (5.00); the other 8.00 is the set menu breaking up, which no
  adjustment names, so the report's cancels no longer add up to the bill's drop. Alternative: record
  the bill's whole drop (13.00), which matches the bill but counts a set menu falling apart as part of
  the cancellation. 2b Task 2b.3 pins the chosen figure.
  _Owner's answer (watcher 2026-11-24 22:30): "13", the bill's whole drop._
- **D25. FOR THE OWNER. A cancel on a part-paid bill can now be refused.** When the regrouped total
  drops below what was received, the cancel is refused `bill.received_exceeds_total`
  (`assertBillInvariant`, `bill-payments.ts:568`), as it is today for any line whose removal does
  that. New: a dish at 0 inside a set menu can now cause it (Daily of Soup and Hake, 14.00 received:
  cancelling Hake leaves Soup at 6.00). Today that cancel is accepted. Recommended: accept the refusal,
  as for any other line today. Alternative: allow the cancel and leave the bill overpaid.
  _Owner's answer (watcher 2026-11-24 22:30): keep the refusal until the overpaid-bills work lands._
- **D26. Settled by the owner (watcher 2026-11-24 22:32): a bill keeps both versions.** "this should
  never happen. but it may not be just the price that changed, it could be the contents. should we
  not keep both?" A set menu moved with its dishes (or a dish moved alone whose set menu the source
  records) brings the source's recorded copy even when the target records another version of the same
  set menu; the bill then records both, and the grouping treats them as two set menus, cheapest over
  all the bill's dishes. A refusal is not wanted. _2026-11-25: since #4308 a set menu's published
  dishes carry their allergens and diet, so an allergen correction alone gives a new copy, and a move
  or merge after one leaves a bill holding two copies with the same terms; `set-menu-two-versions.test.ts`
  checks that grouping, total, `exact` and the till's summary match a bill holding one._ Cost, counted 2026-11-25 against 2a's head
  `c7a0b651b0` (about 25–35 production lines, under the watcher's 60), built in 2b Task 2b.4:
  - `bill_set_menu_copies`' primary key gains `menu_version_id`
    (`packages/db/src/schema/set-menu-copies.ts:15-18`); core's starting migration is rebuilt, so
    **2b resets venues**.
  - `carryBillSetMenuCopies` (`set-menu-bill.ts:131-162`) conflicts on all three columns, so a moved
    or merged copy is added beside the target's.
  - `linkSetMenusFor` (`set-menu-links.ts:87-110`) keeps PR 1's rule that a set menu the bill already
    records keeps its copy: it leaves out set menus the bill records before inserting, since the
    three-column conflict would otherwise add the newest version on every order after a republish.
  - `readBillSetMenuVersions` (`set-menu-bill.ts:120-129`) returns every recorded pair, not one per
    set menu; its three callers change with it: `readGroupingCopies` (`set-menu-regroup.ts:31-39`),
    `recordedSetMenusListing` (`set-menu-links.ts:113-127`) and `setMenuOfferLookup`
    (`set-menu-offers.ts:49-75`), which accepts a dish under any version the bill records.
  - The planner passes the calculation one offer per distinct copy key
    (`set-menu-grouping-plan.ts:147`): a menu version id belongs to the whole published menu
    (`set-menu-offers.ts:58-60`), so two recorded versions can hold the same set-menu copy, and so
    the same key.
  - The till's folder shows the newest only with no till change: `orderingCopies`
    (`apps/till/src/state/set-menus.ts:28-35`) offers only the version `recorded` names per set menu,
    so `readBillsSetMenus` (`set-menu-bill.ts:176-272`) fills `recorded` with the newest
    of the bill's versions of each set menu: the copy changed last (`changedAt`, as a new bill
    picks), publish order breaking a tie. A set-menu row of the older version is
    still drawn from its own copy, which `setMenuCopies` already serves.
- **D27. FOR THE OWNER. An existing money-total test changes:** the spec fixture's bill
  (`testing/set-menu-spec-fixture.ts:248`) totals 72.00 instead of 73.00, because 3 Daily and 1
  Special is cheaper than the 2 and 2 a waiter counted (Goal 2). Lane rules make a changed money total
  a stop; 2b Task 2b.1 lists every total that moves.
- **D28. The calculation is skipped when no grouping dish changed.** Each regrouping stores its input,
  less the saved places (offer keys and, per unfrozen dish, id, listing, course, à la carte price,
  extras, eligibility), as `working_orders.set_menus_input`; when the next input is the same, nothing is
  calculated or written. Freezing a row takes it out of the input, so it counts as a change. Stored
  whole, not hashed, so a match cannot be a collision. Alternative: callers pass the changed line ids.

  _2026-11-24, dropped: the watcher asked for a measurement first (lane B questions.md, 22:05). `groupSetMenus` alone, without the bill's reads and writes, took 0.4–1.6 ms median for four diners and 65–135 ms for sixteen (30 runs each of the shared test's three bill shapes, on the lane's Mac, from a scratch test not committed; lane B progress.log, 22:32), so 2a stores no input and calculates on every regrouping. The D28 steps below (`set_menus_input`, `setMenusInput`, `stored.input`, `skipped`, the `calculate` spy not called) were not built; 2b's tests do not assert a skip._

### Global constraints for PR 2

- Every regrouping runs in the path's own transaction, after its last line write and before its own
  total checks (`refuseOrderOverSimplifiedLimit`, `assertBillInvariant`, `assertLinesKeptExcess`,
  `selectOrderInvoice`), so they read the regrouped total.
- The regrouping writes only open bills (the line triggers refuse anything else,
  `packages/db/triggers/core.sql:116-134,380`), never a frozen row, never an extras row, and never
  `set_menu_id` on a dish (D11).
- Writes are awaited in turn: new set-menu rows, then dishes, then surviving set-menu rows, then
  deletes (no dish may point at a deleted row: `working_order_lines_set_menu_line_fk` sets null,
  `orders.ts:399-403`).
- No discounts are passed to `groupSetMenus` in PR 2 (PR 3); a test pins `discounts: []`.
- A set-menu row is written only by the regrouping (spec section 5). A basket edit never edits or
  removes one: `applyLineEdits` takes only rows without the `'set_menu'` role as editable
  (`working-order-edit-state.ts:374-375`), and its closing regroup keeps or deletes the row (2b Task
  2b.2's held-order save case); cancel and adjustment-cancel keep refusing it (`line-cancel.ts:208`,
  `adjustments-apply.ts:871-872`; 2b Task 2b.5).
- The golden huella test and `inmutabilidad` pass UNEDITED; 2a, 2b (D26) and 2c say "Resets venues" in
  the PR's first line; 2b's body carries a `Sale-path read changed:` line (CLAUDE.md §4) and one line on D2:
  "A comped or discounted set menu, and every dish in it, keeps its saved place and price until PR 3,
  and keeps any empty place, so a dish added later is charged à la carte or in another set menu
  rather than filling it."

### Review focus (PR 2)

1. **A set menu that disappears must not leave a dish at 0 or at its supplement.** Every unfrozen
   dish is rewritten to its charge; a dish no longer in a set menu gets its à la carte price (2a Task
   2a.2; 2b Task 2b.3's two-Daily cancel).
2. **The freeze boundary:** a comp of 0 on an included dish freezes it and its set menu; moving it
   alone is refused, and the freeze survives Reopen to split (D15, D18; 2a Task 2a.3, 2b Task 2b.4).
3. **A path that changes dishes without regrouping** charges stale prices. Check the call list against
   `rg -n "insert\(workingOrderLines\)|delete\(workingOrderLines\)|insertInChunks\(tx, workingOrderLines|workingOrderId: toTabId"`.
4. **Order of checks:** the invoice-limit and payment invariants read the regrouped total; a cancel on
   a part-paid bill can now lower the total by more than the cancelled dish (D25; 2b Task 2b.3).
5. **Takeaway stays payable:** a takeaway bill never holds a set-menu row (D14; 2a Task 2a.3).
   _2026-11-25: D14 was dropped in Task 2b.8 (VAT-RATES B1 landed first): takeaway bills are grouped and the Counter shows set-menu folders._
6. **A set menu moved with its dishes to a bill recording another version of it** brings its own
   copy: the target records both versions and groups over both (D26; 2b Task 2b.4).

---

### PR 2a — The grouping writer (`feat/a1515-3-regroup-writer`)

_2026-11-24, as built: D28 was dropped (see D28). The set-menu line check lets a line with no role keep a `set_menu_id` only when it is a top-level line with a menu item; an extras pick, or a line with no menu item, has none. `BillSetMenuState.exact` is required, not optional as D16 and Task 2a.3 say; the till's own empty states set it to true._

#### Task 2a.1: The schema

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`workingOrders`, `:67-165`; `workingOrderLines` beside
  `aLaCarteUnitPrice`, `:278`; `working_order_lines_set_menu_ck`, `:408-424`);
  `packages/db/triggers/core.sql` (the three column lists of `working_order_lines_require_open_parent_update`
  that name `a_la_carte_unit_price`, `:380-600`, gain `counts_as_course_id`, as PR 1 added its column)
- Regenerate: `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/*`
- Test: `packages/db/src/schema/orders.test.ts`

**Interfaces:**
- Produces: `workingOrders.setMenusExact` (`flag("set_menus_exact").notNull().default(true)`), comment:
  "Whether the bill's saved set menus were proven the cheapest; false when the calculation stopped at
  its search limit."; `workingOrders.setMenusInput` (`json`, nullable; D28), comment: "The last
  grouping's input, without saved places; the same input is not calculated again.";
  `workingOrderLines.countsAsCourseId` (`id("counts_as_course_id")`, no foreign key, as
  `set_menu_counts_as_course_id` keeps a deleted course, `orders.ts:311`), comment: "The course the dish
  counts as in a set menu, its product's when it was added (D12); null on an extras pick and a set
  menu's own row." The check becomes: no role → `set_menu_version_id`, `set_menu_line_id`,
  `set_menu_place`, `set_menu_counts_as_course_id` null (`set_menu_id` free, D11); `'set_menu'` as
  today; `'dish'` → `menu_item_id`, `set_menu_place`, `set_menu_counts_as_course_id` not null,
  `parent_line_id` and `set_menu_version_id` null (`set_menu_id` free).

- [ ] **Step 1: Write the failing tests** in `orders.test.ts`: a top-level line with no role and a
  `set_menu_id` is stored; a `'dish'` row with no `set_menu_id` is stored; a row with no role and a
  `set_menu_line_id` is refused naming `working_order_lines_set_menu_ck`; a new working order reads
  `setMenusExact true` and `setMenusInput null`; `countsAsCourseId` is stored and read back, and on a
  placed order the update guard refuses changing it.
- [ ] **Step 2: Run them and see them fail:** `pnpm --filter @waitron/db exec vitest run src/schema/orders.test.ts`.
- [ ] **Step 3: Change the schema; run `pnpm --filter @waitron/db db:generate`** (`packages/db/package.json:31`).
- [ ] **Step 4: Run** Step 2's command, then from the root `pnpm exec vitest run
  scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`, and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  — all pass, the last two unedited.
- [ ] **Step 5: Commit** `git commit -s -m "Let a dish line keep where it was ordered from, and store whether a bill's set menus are proven cheapest"`.

#### Task 2a.1b: Recording the course a dish counts as (D12)

**Files:**
- Modify: `apps/server/src/working-order-pricing.ts` (`priceOrderLines`' row, `:740-790`, beside
  `aLaCarteUnitPrice` `:764`); `apps/server/src/working-order-transfer.ts` (the carve context, `:445`)
- Test: `apps/server/src/a-la-carte-price.test.ts`

- [ ] **Step 1: Write the failing tests:** an à la carte Soup stores `countsAsCourseId` = Starter; a
  variant with no course of its own stores its parent's; a dish sent with the waiter's other course
  (`courseId` Main on a Starter) still stores Starter; a dish tapped in a set-menu folder stores its
  product's course, not the copy's; an extras row and a set-menu row store null; a comp carving one of
  three Soups (`splitLinesWithinOrder`) and Reopen to split keep it.
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/server exec vitest run src/a-la-carte-price.test.ts`.
- [ ] **Step 3: Implement.** Read the basket's products' courses (and their parents') in one query
  before the line loop, beside `setMenuALaCartePrices` (`:484-491`) (CLAUDE.md §3 "Resolve shared
  menu data once before a basket's line loop"); add the column to the carve context.
- [ ] **Step 4: Run** Step 2's command and `src/working-order-pricing.test.ts src/split-after-print.test.ts src/set-menu-send.test.ts src/working-order.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "Record the course each dish counts as when it is added"`.

#### Task 2a.2: Planning a bill's grouping (pure)

**Files:**
- Create: `packages/orders-sales/src/set-menu-grouping-plan.ts`; add `"./set-menu-grouping-plan.js"` to `packages/orders-sales/package.json` `exports`
- Test: `packages/orders-sales/src/set-menu-grouping-plan.test.ts`

**Interfaces:**
- Consumes: `groupSetMenus`, `SetMenuGroupingInput`, `SetMenuGrouping` (`packages/shared/src/set-menu-grouping.ts:10-65,177`); `setMenuOfferOf` (`packages/shared/src/set-menu-bill.ts:19`); `ServedSetMenuCopy`.
- Produces:

```ts
export interface GroupingLine {
  id: string; lineNo: number; parentLineId: string | null;
  /** As a set menu lists it: a variant by its parent's id and its own (set-menu-bill.ts:346-347). */
  listedProductId: string | null; listedVariantId: string | null;
  countsAsCourseId: string | null; // D12, recorded on the line
  menuItemId: string | null; quantity: number; countAsPortions: boolean;
  listUnitPriceGross: number | null; // D15: stamped by any comp or discount
  unitPriceGross: number; lineTotal: number; aLaCarteUnitPrice: number | null;
  creditedTo: string | null;
  setMenuRole: "set_menu" | "dish" | null; setMenuId: string | null; setMenuVersionId: string | null;
  setMenuLineId: string | null; setMenuPlace: number | null; setMenuCountsAsCourseId: string | null;
}
export interface GroupingCopy { copy: ServedSetMenuCopy; versionId: string }
export interface GroupingPlan {
  input: SetMenuGroupingInput;
  /** D28: the input less saved places, as stored in `set_menus_input`. */
  inputRecord: unknown;
  /** True when `inputRecord` equals the stored one: nothing was calculated and nothing is planned. */
  skipped: boolean;
  exact: boolean;
  inserts: { id: string; lineNo: number; copy: GroupingCopy; priceCents: number; creditedTo: string | null }[];
  menuUpdates: { id: string; priceCents: number; creditedTo: string | null }[];
  dishUpdates: {
    id: string; setMenuRole: "dish" | null; setMenuLineId: string | null; setMenuPlace: number | null;
    setMenuCountsAsCourseId: string | null; unitPriceGross: number; lineTotal: number;
  }[];
  deletes: string[];
}
/** D2/D15 spread: a dish frozen by one of its extras, a set-menu row by one of its dishes, and every dish of a frozen set-menu row. */
export function frozenLinesOf(lines: readonly GroupingLine[], named: ReadonlySet<string>): Set<string>;
export function planBillGrouping(
  lines: readonly GroupingLine[],
  frozen: ReadonlySet<string>,
  copies: readonly GroupingCopy[],
  stored: { input: unknown; exact: boolean },
  newId: () => string,
  calculate?: (input: SetMenuGroupingInput) => SetMenuGrouping, // default groupSetMenus
): GroupingPlan;
```

  Rules the tests pin: a grouping dish is an unfrozen top-level row with no `'set_menu'` role, a
  `listedProductId`, an `aLaCarteUnitPrice` and one whole portion (D13); `eligible` when it has a
  `countsAsCourseId` and a `menuItemId`; `extrasCents` is the sum of its extras' `lineTotal`. Offers are
  `setMenuOfferOf(copy)` (id `copy.key`). `previous` holds every unfrozen `'set_menu'` row as a saved
  menu (offer id: the key of the copy with its set menu and version, or `"unrecorded:<version>:<menu>"`
  when the bill records no such copy) and every grouping dish with its saved place; it is null when
  the bill has neither. The calculation's dishes come back sorted by id (`set-menu-grouping.ts:178`),
  so results are matched by id. A result menu whose id is a saved row's is updated in place (D5);
  `new-menu-N` (`set-menu-grouping.ts:244-248`) becomes an insert with `newId()` and the next
  `lineNo`s after the bill's highest; a saved row absent from the result is deleted. A placed dish
  gets role `'dish'`, the result menu's row id, `lineIndex` as place, its course as counts-as course
  and `chargeCents` as unit price and line total; an unplaced one gets role null, nulls and
  `chargeCents` (its à la carte price). Credit is D19. Only changed values are planned.

- [ ] **Step 1: Write the failing tests** in `set-menu-grouping-plan.test.ts`, with hand-built lines
  and a hand-built copy (Daily: 14.00, "1 × Starter, 1 × Main", Soup and Hake included, Sirloin +5.00):
  - Soup and Hake, unplaced at 6.00 and 16.00, plan one insert at 1400 and two dish updates at 0, places 0 and 1.
  - Hake alone plans nothing (it stays at 16.00). _2026-11-25: 14.00; a lone Hake
    is a Daily (see 2c)._
  - Planning again from the planned state plans nothing (no shuffling, spec anti-goals).
  - D5: a saved menu that keeps a dish keeps its id (update, no insert); a saved menu left empty is deleted, and its dish updates come first in the plan.
  - A placed dish whose menu goes is planned à la carte, role null.
  - D19: the insert's credit is the credit of the dish with the lowest `lineNo`; a surviving menu whose lowest dish changed plans a credit update.
  - Frozen rows (D2): a frozen dish and a frozen set-menu row appear in no update and no delete and are left out of `input`; `frozenLinesOf` spreads from an extra to its dish, from a dish to its set-menu row and from that row to its other dishes.
  - D13: a row of two portions is left out; D12: a dish with no course is passed `eligible: false` and, if placed, planned à la carte.
  - A variant dish is passed as its parent's id plus its own.
  - A saved row whose copy the bill does not record dissolves and its dishes regroup under the recorded copy.
  - `exact`: with a `calculate` that answers `exact: false`, the plan still holds its writes and `exact: false`.
  - `input.discounts` is `[]`; extras add to the total but are never planned.
  - D28: with `stored.input` equal to this input, `skipped` is true, `calculate` is not called and
    nothing is planned; a changed à la carte price, a new dish or a newly frozen dish each recalculate.
  - D15: `frozenLinesOf` treats a row with a `listUnitPriceGross`, or with an extra that has one, as named.
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/orders-sales exec vitest run src/set-menu-grouping-plan.test.ts`.
- [ ] **Step 3: Implement** `set-menu-grouping-plan.ts` (under 1,000 lines).
- [ ] **Step 4: Run** Step 2's command, `pnpm --filter @waitron/orders-sales typecheck`, and
  `pnpm exec prettier --check packages/orders-sales/src/set-menu-grouping-plan*.ts packages/orders-sales/package.json`.
- [ ] **Step 5: Commit** `git commit -s -m "Plan the writes that save a bill's cheapest set menus"`.

#### Task 2a.3: Reading, freezing and saving on the server; the `exact` answer

**Files:**
- Create: `apps/server/src/set-menu-regroup.ts`, `apps/server/src/set-menu-freeze.ts`
- Modify: `apps/server/src/set-menu-bill.ts` (`readBillsSetMenus`, `:170-260`: `exact` per bill);
  `packages/shared/src/set-menu-bill.ts` (`BillSetMenuState`, `:105-110`: `exact?: boolean`)
- Test: `apps/server/src/set-menu-regroup.test.ts`

**Interfaces:**
- Consumes: `planBillGrouping`, `frozenLinesOf` (Task 2a.2); `readBillSetMenuVersions`
  (`set-menu-bill.ts:114`), `serveRecordedSetMenus`, `isSetMenuBill` (`:92`), `hasBillSetMenuLines`
  (`:38`), `setMenuLineDescriptions` (`:357`), `readInvoiceLocales` (`@waitron/menu`), `newId` (`@waitron/db`).
- Produces:
  - `namedFrozenLineIds(tx: Transaction, lineIds: readonly string[]): Promise<Set<string>>` in
    `set-menu-freeze.ts` — D15's sources, `json_each` over the ids as `set-menu-bill.ts:295` does.
  - `readGroupingLines(tx: Transaction, billId: string): Promise<GroupingLine[]>` — one read joining
    `products` for `listed*` (the course is the line's own, D12).
  - `saveBillGrouping(tx: Transaction, billId: string, copies: readonly GroupingCopy[], calculate?):
    Promise<{ changed: boolean; exact: boolean }>` — reads, plans, writes in the order of the global
    constraints; a new set-menu row is written as `set-menu-count.ts:75-94` writes one (sent and served
    now, quantity 1000, the copy's name, descriptions, price and VAT classes, `set_menu_id` and
    version), credited per the plan; `set_menus_exact` and `set_menus_input` are updated when they
    change; a skipped plan (D28) writes nothing.
  - `regroupBills(tx: Transaction, billIds: readonly string[]): Promise<ReadonlySet<string>>` — for
    each distinct open bill, in turn: copies from its recorded versions, or none when it is not a
    set-menu bill or is taken away (D14); skips a bill with no copies and no set-menu role
    (`hasBillSetMenuLines`); answers the bills whose lines changed.

- [ ] **Step 1: Write the failing tests** in `set-menu-regroup.test.ts`, on
  `setupSetMenuSpecVenue` (`testing/set-menu-spec-fixture.ts:79`: Daily 14.00 and Special 20.00,
  Soup 6.00, Hake 16.00, Sea bass 19.00, Sirloin 24.00), sending dishes from the ordinary menu (no
  count; PR 1 links the set menus) and then calling `regroupBills` directly:
  - Soup and Hake: one Daily row at 1400, both dishes `'dish'` at 0 in places 0 and 1, the bill's
    stored total 14.00, `setMenusExact` true, and `GET /api/bills/:id/set-menus` answers that menu
    with `exact: true`.
  - Soup and Sirloin: a Daily with Sirloin at 500 (19.00, cheaper than Special's 20.00).
  - Hake alone: stays 16.00, no set-menu row. _2026-11-25: 14.00; a lone Hake
    is a Daily (see 2c)._
  - D5: Soup and Hake grouped, then a second Soup and Sea bass sent and regrouped: the Daily row keeps
    its id and its two dishes, and a Special row is inserted for the new pair; then the first Hake is
    cancelled (`cancelItem`) and the bill regrouped: the Daily row is deleted (Soup alone at 6.00 beats
    14.00) and that Soup is 6.00, while the Special row keeps its id.
  - D6/D19: Soup credited to waiter A, Hake to waiter B, Soup sent first: the Daily row is credited to
    A; sent the other way round, to B.
  - D2 frozen, each its own case, asserting every frozen row's id, place and price unchanged and the
    new dishes grouped among themselves: a comp on Soup while included (0 off; no `adjustment_lines`
    row); a discount on Soup's paid extra (Bread); a comp on the Daily row; a whole-bill discount
    (every row frozen: the regrouping writes nothing); an "items" payment of Hake (today's kind,
    until lane C's PR 3); a cancel of Soup with its charge kept (D15).
  - Not exact still saves: `saveBillGrouping` with a `calculate` answering the real result with
    `exact: false` writes the grouping, sets `setMenusExact` false, and the GET answers `exact: false`.
  - D14: a counter takeaway bill holding a counted Daily (made with today's count route, which 2a
    keeps) and a placed Hake: `regroupBills` removes the Daily row and charges Hake 16.00.
  - A placed bill (not open) and a counter eat-in bill: `regroupBills` writes nothing and does not throw.
  - Regrouping a bill a second time with nothing changed answers `changed: false`, does not call
    `calculate` (D28) and leaves every row as it was.
  - D15: a row that no `adjustments` or `adjustment_lines` row names but whose
    `list_unit_price_gross` is set (as on a copy of a dish comped for 0) is frozen with its Daily, and
    stays at 0 after a new dish is sent and the bill regrouped. The real copy is 2b Task 2b.4's case.
  - Seeding hook for 2b's D17 and D21 cases: `saveBillGrouping` with a `calculate` that answers Soup
    and Hake as a Special (20.00) saves that grouping as given (a valid, not cheapest, answer).
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/server exec vitest run src/set-menu-regroup.test.ts`.
- [ ] **Step 3: Implement** both files and the `exact` field.
- [ ] **Step 4: Run** Step 2's command and `src/set-menu-bill.test.ts src/till-api.set-menus.test.ts
  src/parties.test.ts src/working-order-held-read.test.ts` (the answer gains `exact`; a whole-shape
  assertion gains the key and nothing else, listed in the PR), `pnpm --filter @waitron/server
  typecheck`, `pnpm --filter @waitron/shared typecheck`, `pnpm --filter @waitron/till typecheck`, and
  prettier on the changed files.
- [ ] **Step 5: Commit** `git commit -s -m "Save a bill's cheapest set menus, leaving anything comped, discounted or paid for by item as it is"`.

#### Task 2a.4: Backlog

- [ ] `docs/backlog/menu.md`'s A1515 entry: piece 3 PR 2a done (the writer), 2b, 2c, 3 and 4 left.
  Commit `-s`. PR body: first line "Resets venues: …"; the "Should this exist?" paragraph above; that
  nothing calls the writer until 2b.

---

### PR 2b — The switch (`feat/a1515-3-regroup`)

Every task ends with all its named suites passing: each changed test sits in the task whose change
breaks it, listed with before, after and the spec line in the PR's "Changed test checks". Spec lines
used below: §2 "Gone from the till: the count per set-menu type …, the 'No place for this dish'
question with its suggested moves, and removing an empty set menu"; §5 "The set-menu lines are
written by the calculation alone and cannot be cancelled or edited by hand"; Goal 2 "The customer
always pays the cheapest way"; §5 credit "to whoever rang the earliest-added dish". The lists come
from test names and `rg -l "setSetMenuCount|setSpecCount|/set-menus/|set-menu-moves|set-menu-lines/|firstSetMenu"`;
running confirms each. A case marked **pin** passes before the change: it holds today's behaviour
and is not a failing test.

#### Task 2b.1: Sends and new bills regroup; a set-menu-folder dish starts à la carte

**Files:**
- Modify: `apps/server/src/working-order-pricing.ts` (`priceOrderLines`, `:263-805`: D10);
  `apps/server/src/working-order-open.ts` (`insertTabRound` `:479-513`; `createOpenOrder` `:267-276`;
  `parkOrder`'s `firstSetMenu`, `:85,286,302-305,331-333`); `apps/server/src/till-api.ts`
  (`firstSetMenuId`, `:1884,1892-1900,1922`); `apps/server/src/errors.ts` (`set_menu.no_place`, `:33`)
  and its status, `till-api.ts:449`; `apps/server/src/testing/set-menu-spec-fixture.ts` (`setSpecCount`, `:180`, goes)
- Test: `apps/server/src/set-menu-regroup-paths.test.ts`

**Interfaces:**
- Consumes: `regroupBills` (2a). `insertTabRound` and `createOpenOrder` keep their signatures;
  `createOpenOrder` passes `storedOrderTotal` (`stored-order-lines.ts:247`) to `selectOrderInvoice`
  when the regroup changed the bill, else `gross.total`. `placeSetMenuRows` stays for
  `applyLineEdits` until Task 2b.2.

- [ ] **Step 1: Write the failing tests** in `set-menu-regroup-paths.test.ts` (spec venue, no counts),
  each asserting the saved grouping after it (set-menu rows, each dish's role, place and price, the
  bill total):
  - Draft send (`submitDraft`): Soup and Hake from the à la carte folders form a Daily at 14.00.
  - D10: Hake tapped in the Daily folder on a bill with nothing else is stored at 16.00, role null,
    `set_menu_id` the Daily's (D11); then Soup sent: the Daily forms, Hake 0. _2026-11-25: 14.00; a lone Hake
    is a Daily (see 2c)._
  - Held send (`placeGroups` with `release: "hold"`) and a second round joining a held group group the same way.
  - `openTab` with lines (`createOpenOrder`): Soup and Hake on opening form a Daily at 14.00; given an
    invoice choice, `selectOrderInvoice` receives 14.00, not the à la carte 22.00.
  - The simplified-invoice limit reads the grouped total: a send whose à la carte prices cross the
    limit but whose grouped total does not is accepted.
  - **Pin:** a send that adds no listed dish to a bill with set menus changes no set-menu row (its id,
    price and credit stay), and D28 skips the calculation (a `calculate` spy is not called).
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/server exec vitest run src/set-menu-regroup-paths.test.ts`.
- [ ] **Step 3: Implement.** In `priceOrderLines`, a line with `setMenuOffer` takes its à la carte price
  (`aLaCarte[index]`, `:484-491`) as `product.unitPrice`. `insertTabRound`: insert `withContexts`
  directly, then link, then `regroupBills(tx, [round.tabId])`, then the limit. `createOpenOrder`:
  `regroupBills` after linking. Remove `firstSetMenu` from `parkOrder` and the route.
- [ ] **Step 4: Changed test checks this task breaks**, then run them with Step 2's command and
  `src/a-la-carte-price.test.ts src/set-menu-links.test.ts src/set-menu-period.test.ts
  src/working-order-open.test.ts src/working-order-pricing.test.ts src/order-drafts.test.ts
  src/working-order.test.ts src/set-menu-send.test.ts src/till-api.set-menu-send.test.ts
  src/till-api.set-menus.test.ts src/set-menu-ticket.test.ts src/receipt-document.set-menus.test.ts
  src/invoice-document.set-menus.test.ts src/set-menu-money.test.ts src/set-menu-adjustments.test.ts
  src/split-after-print.set-menus.test.ts src/staff-sales.set-menus.test.ts`:
  - Deleted: `set-menu-send.test.ts:169,187,204,243,260` (reservations, placing order, no place);
    `till-api.set-menu-send.test.ts:87,97` (`no_place`); `till-api.set-menus.test.ts:307,337,358,537`
    (`firstSetMenuId`).
  - Rewritten as strictly: `set-menu-send.test.ts:125,221` (the grouping's price);
    `till-api.set-menus.test.ts:391` (D10: stored at the à la carte price until grouped);
    `a-la-carte-price.test.ts`'s set-menu-folder cases (0 and 2.50 now the grouping's answer, not
    placing's); `staff-sales.set-menus.test.ts` (D6: the earliest dish's waiter, not whoever pressed +).
  - Setup only (the count call goes; the bill groups the sent dishes): every `setSpecCount` user
    above, `set-menu-period.test.ts`, `till-api.set-menus.test.ts:475,513`. **D27 (owner):** `specBill`
    (`:248`) totals 72.00 instead of 73.00 — 3 Daily (Soup+Hake 14.00, two Soup+Sirloin 19.00) and 1
    Special (Soup+Sea bass 20.00) beat the counted 2 Daily and 2 Special (by hand from `:65-78`; the run
    confirms); each money total that moves is listed.
- [ ] **Step 5: Commit** `git commit -s -m "Work out a bill's set menus whenever dishes are sent or a bill opens with them"`.

#### Task 2b.2: Basket and line edits regroup

**Files:**
- Modify: `apps/server/src/working-order-line-edits.ts` (`setMenuPlacements` `:702,917-932`, placing
  `:988-996`, `regroupBills` before `assertLinesKeptExcess` `:1150`, `chargesUnchanged`);
  `apps/server/src/working-order-held-write.ts` (the set-menu clause of the empty-basket check, `:119`:
  a set menu no longer exists without dishes); `apps/server/src/set-menu-bill.ts` (delete
  `placeSetMenuRows` `:485-528`, `SetMenuPlacement` `:381-386`)
- Test: `apps/server/src/set-menu-regroup-paths.test.ts`

**Interfaces:** `applyLineEdits` answers `chargesUnchanged: false` whenever `regroupBills` changed the bill.

- [ ] **Step 1: Write the failing tests:**
  - Line edit (`updateOrderLine`, `working-order-held-write.ts:197` → `applyLineEdits`) on a seated
    bill holding a Daily (Soup, Hake) and Sea bass at 19.00: raising Soup to two adds a portion that
    forms a Special with Sea bass (20.00 beats 25.00); lowering it back removes the Special and Sea bass
    returns to 19.00.
  - Held-order save (`saveHeldOrderIn`, `working-order-held-write.ts:105`) on a seated bill: removing
    Hake leaves Soup at 6.00 and the Daily row is deleted; the save names no set-menu row, and the
    closing regroup is what deletes it.
- [ ] **Step 2: Run and see them fail:** Task 2b.1's command.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Changed test checks**, then run Step 2's command and `src/set-menu-edits.test.ts
  src/working-order-held-write.test.ts src/till-api.set-menus.test.ts src/split-off-extras.edit.test.ts`:
  deleted `set-menu-edits.test.ts:236` (no place) and `till-api.set-menus.test.ts:491` (a parked order
  holding only a set menu); rewritten `set-menu-edits.test.ts:206` (added portions group, not placed).
- [ ] **Step 5: Commit** `git commit -s -m "Work out a bill's set menus again when its dishes are edited"`.

#### Task 2b.3: Cancels regroup

**Files:**
- Modify: `apps/server/src/working-order-removal.ts` (`removeFromLine` before `:190` and `:210`;
  `removePortions` before `:276`)
- Test: `apps/server/src/set-menu-regroup-paths.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `cancelItem` with `remove_charge` of Hake from a Daily (Soup, Hake): Soup returns to 6.00 and the Daily goes.
  - Two Dailies (Soup, Hake; Soup, Sirloin +5.00), cancel Hake and Sirloin: both Daily rows go and the
    two Soups are 6.00 each (12.00 beats 28.00); no dish is left at 0 or 5.00 outside a set menu.
  - `cancelItem` over a group of portions (`lineIds`, `removePortions`) and the adjustment cancel
    (`adjustments-apply.ts:1388`) each regroup.
  - **D24 (owner):** cancelling Sirloin (+5.00) from a Daily of Soup and Sirloin takes the bill from
    19.00 to 6.00; the cancel's recorded reduction (`planAdjustment`, `adjustments-apply.ts:900-907`)
    is 13.00, the bill's whole drop, and the adjustments report (`packages/adjustments/src/reports.ts:191-193`) counts 13.00.
  - **D25 (owner):** a part-paid bill (Daily of Soup and Hake, 14.00 received as an amount):
    cancelling Soup keeps the Daily (14.00 beats Hake's 16.00) and is accepted; cancelling Hake leaves
    Soup at 6.00, below what was received, and is refused `bill.received_exceeds_total`. Today that
    second cancel is accepted (the Daily stays at 14.00 with an empty place).
  - **Pin:** `cancelItem` with `keep_charge` freezes the dish (D15) and changes nothing else.
- [ ] **Step 2: Run and see them fail:** Task 2b.1's command.
- [ ] **Step 3: Implement** the calls.
- [ ] **Step 4: Run** Step 2's command and `src/line-cancel.test.ts src/working-order-removal.test.ts
  src/adjustments-apply.test.ts src/adjustments-report.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "Work out a bill's set menus again when a dish is cancelled"`.

No dining-switch path: `orderDiningLocked` refuses any order holding a sent line
(`packages/db/src/order-dining.ts:30-36`), and every grouped dish is sent; an order with only unsent
lines is a counter order, either eaten in (not a set-menu bill) or taken away (no set menus, D14), so a
switch never changes a grouping.

_2026-11-25: D14 was dropped in Task 2b.8 (VAT-RATES B1 landed first): takeaway bills are grouped and the Counter shows set-menu folders. A switch to takeaway, or a Counter order seated at a table, now links and regroups the bill only when it could not hold set menus before (an eat-in Counter order); a switch or move that would leave set menus on an eat-in Counter bill is refused `set_menu.bill_holds_set_menus`. The codes `set_menu.no_place_on_target` and `set_menu.remove_from_summary` named in this plan were renamed `set_menu.moves_with_set_menu` and `set_menu.worked_out_by_bill` in 2b's review._

#### Task 2b.4: Moves, merges, table splits and Pay for items regroup both bills

**Files:**
- Modify: `apps/server/src/working-order-transfer.ts` (`moveOrderLines`: drop the draft check
  `:151-158`; refuse before the move loop; `regroupBills(tx, [fromTabId, toTabId])` before `:206`);
  `apps/server/src/set-menu-moves.ts` (`replaceMovedDishes` `:61-122` becomes `refuseMovingFrozenDishes`)
- Test: `apps/server/src/set-menu-regroup-moves.test.ts`

**Interfaces:**
- Produces: `refuseMovingFrozenDishes(tx: Transaction, lineIds: readonly string[]): Promise<void>` —
  D18, using `namedFrozenLineIds`.

- [ ] **Step 1: Write the failing tests** in `set-menu-regroup-moves.test.ts`, each asserting both
  bills' saved grouping after it:
  - `moveDishes` of Hake alone from a Daily (Soup, Hake) to another bill of the party: the source's
    Soup returns to 6.00; on the target Hake is 16.00, or joins a Soup there in a Daily. _2026-11-25: 14.00; a lone Hake
    is a Daily (see 2c)._
  - **D26 (owner):** `moveDishes` of the Daily row with its dishes (`resolveMoveLines`,
    `bill-actions.ts:198-247`): the target keeps that row's id when it still groups. To a bill
    recording another version of Daily whose contents differ (another price and another dish), the
    target then records both versions, the moved row keeps its own version and price, and a Daily
    rung on the target afterwards takes whichever version is cheaper for its dishes; the till's
    answer for the target names the newer version in `recorded`. A dish ordered on that bill after
    a republish adds no third version.
  - D18: Soup comped while included (0 off) is refused `set_menu.move_adjusted` alone; a dish whose
    cancel kept its charge is refused `set_menu.no_place_on_target`; a dish of a comped Daily that has
    no comp of its own moves and is charged on the target, the comped Daily staying on its bill.
  - D15 carried: Soup comped while included (0 off), the bill printed and reopened (`splitAfterPrint`);
    on the new bill, after Sea bass is sent, the copied Soup and its Daily keep their places and prices.
  - `mergeBills`: Soup on one bill and Hake on the other merge into one Daily.
  - `splitTable` moving Hake's guest to a new table: both bills regroup.
  - Pay for items (`payForItems`, cash) of a Daily with its dishes: the new bill is 14.00, paid; the
    source regroups. A declined reader card (`movedItemsBack`): both bills return to the first grouping.
  - D21: a source whose saved grouping is valid but not the cheapest (seeded through 2a's `calculate`
    hook: Soup and Hake as a Special at 20.00): Pay for items of that Special with its dishes previews
    20.00, the new bill regroups to 14.00, and the payment is refused by the allocation check
    (`bill-payments.ts:1915`) rather than taking 20.00 for a 14.00 bill.
  - D17, each on a bill seeded through the `calculate` hook with that not-cheapest Special and its
    `set_menus_input` cleared, so a wrongly added regroup would change it to a Daily at 14.00:
    `moveBill` to another table, `splitAfterPrint` (the copy) and a group split
    (`splitUnitsWithinOrder`, `order-group-edits.ts:348`) leave the Special row for row.
  - **Pin:** to a counter eat-in target, a placed dish is refused `set_menu.not_seated`
    (`working-order-transfer.ts:146-147`); one charged à la carte moves.
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/server exec vitest run src/set-menu-regroup-moves.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Changed test checks**, then run Step 2's command and `src/set-menu-bill-moves.test.ts
  src/set-menu-bill-split.test.ts src/move-dishes.test.ts src/move-merge.test.ts
  src/split-table.fiscal.test.ts src/pay-for-items.test.ts src/pay-for-items.move.test.ts
  src/pay-for-items.card.test.ts src/split-after-print.test.ts src/move-bill.dining.test.ts`: deleted
  `set-menu-bill-moves.test.ts:135,145` and `set-menu-bill-split.test.ts:115` (draft reservations);
  rewritten `set-menu-bill-moves.test.ts:194,218` (a loose dish moves and regroups) and
  `set-menu-bill-split.test.ts:83`; `set-menu-moves.test.ts:326` becomes the D18 cancelled case above.
- [ ] **Step 5: Commit** `git commit -s -m "Work out both bills' set menus when dishes move between them"`.

#### Task 2b.5: The count, remove and in-bill move routes go

**Files:**
- Delete: `apps/server/src/set-menu-count.ts`, `apps/server/src/set-menu-count.test.ts`
- Modify: `apps/server/src/till-api.ts` (PUT `:3358-3378`, DELETE `:3380-3397`, `changeSetMenus`
  `:3337-3356`, POST `/set-menu-moves` `:4312-4341`, `requireSetMenuMoves` `:1066`, statuses
  `:446-451` for the removed codes); `apps/server/src/set-menu-moves.ts` (`moveSetMenuDishes` `:20-59`);
  `apps/server/src/set-menu-bill.ts` (`setMenuDishColumns` `:388-396`, `readSetMenuReservations`
  `:398-423`, `refuseDraftLosingSetMenuPlace` `:425-483`, now unused); `apps/server/src/errors.ts`
  (`set_menu.holds_dishes`, `not_selling`, `needed_by_draft`, `place_taken`, `:30-32,35`);
  `apps/server/src/till-api.profile-actions.test.ts` (`:425-427`), `till-api.profile-zones.test.ts`
  (`:216-218` and their cases)

- [ ] **Step 1: Write the failing test** (in `set-menu-regroup-paths.test.ts`): `PUT
  /api/bills/:id/set-menus/:setMenuId`, `DELETE /api/bills/:id/set-menu-lines/:lineId` and `POST
  /api/bills/:id/set-menu-moves` answer 404; **pin:** cancelling a set-menu row is still refused
  `set_menu.remove_from_summary` (`line-cancel.ts:208`).
- [ ] **Step 2: Run and see it fail:** Task 2b.1's command.
- [ ] **Step 3: Delete** the routes and code; `rg -n "set_menu\.(holds_dishes|not_selling|needed_by_draft|no_place\b|place_taken)" apps packages`
  finds nothing outside the till's texts (D22).
- [ ] **Step 4: Changed test checks**, then run Step 2's command, `src/set-menu-moves.test.ts
  src/till-api.set-menus.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts`
  and `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts` (if it pins the server's
  codes, remove the five texts here instead of in piece 4 and say so): deleted `set-menu-count.test.ts`
  (whole file), `set-menu-moves.test.ts:113,135,165,229,257,303` (in-bill moves),
  `till-api.set-menus.test.ts:74,117,149,180,224` (count and remove routes), the removed routes'
  inventory rows.
- [ ] **Step 5: Commit** `git commit -s -m "Retire setting set-menu counts, removing set menus and moving dishes between them by hand"`.

#### Task 2b.6: The till's change (D1, D14) and the "may not be the cheapest" note

_2026-11-25: D14 was dropped in Task 2b.8 (VAT-RATES B1 landed first): takeaway bills are grouped and the Counter shows set-menu folders._

**Files:** the "For lane C" list above; `apps/till/src/i18n/strings.ts` (`set_menu.not_cheapest`, English and Spanish).

- [ ] **Step 1: Write the failing till tests:** in `widgets/menu-browser.test.ts`, tapping Hake in the
  Daily folder on a bill whose set menus have no free place adds it to the draft with no question; in
  `widgets/set-menu-folder.test.ts`, the folder draws no "Add a" button; in
  `widgets/set-menu-summary.test.ts`, a bill answered with `exact: false` draws one line "These set
  menus may not be the cheapest for this bill." ("Puede que estos menús no sean lo más barato para
  esta cuenta."), and none when `exact` is true; in
  `screens/till-table-order-screen.set-menus.test.ts`, no count stepper and no Cancel on a set menu,
  the help badge still drawn; in `till-app-move-dishes.test.ts`, a loose set-menu dish can be moved to
  a bill with no place; in `till-app-set-menus.test.ts`, the counter shows no set-menu folder on a
  takeaway order.
- [ ] **Step 2: Run and see them fail** (check `memory_pressure | grep free` first; real Chromium):
  `pnpm --filter @waitron/till exec vitest run src/widgets/menu-browser.test.ts src/widgets/set-menu-folder.test.ts src/widgets/set-menu-summary.test.ts src/screens/till-table-order-screen.set-menus.test.ts src/till-app-move-dishes.test.ts src/till-app-set-menus.test.ts src/till-app-menu-refresh.test.ts src/i18n/strings.test.ts`.
- [ ] **Step 3: Implement** the till list; reword `set_menu.remove_from_summary` (English: "This is a
  set menu the bill works out by itself. Cancel or move its dishes instead."; Spanish: "Este es un menú
  que la cuenta calcula sola. Anula o mueve sus platos."). Delete only what the compiler then reports
  unused.
- [ ] **Step 4: Changed test checks**, then Step 2's command and `pnpm --filter @waitron/till
  typecheck`: deleted `widgets/menu-browser.test.ts:362,541,597,661`,
  `till-app-set-menus.test.ts:37,152,472,500,626,640,652` and `:279` (D14),
  `till-app-menu-refresh.test.ts:3508`, `widgets/set-menu-folder.test.ts`'s Add case; rewritten
  `till-app-move-dishes.test.ts:274,328` (D23, D1), `screens/till-table-order-screen.set-menus.test.ts:13`,
  `widgets/set-menu-summary.test.ts`'s remove case.
- [ ] **Step 5: Commit** `git commit -s -m "Let the till add any dish, leave the set menus to the bill and say when they may not be the cheapest"`.

#### Task 2b.7: Measure, caps, backlog and the PR body

- [ ] **Step 1: Measure** inside the transaction, before and after the branch (a throwaway worktree of
  the base, CLAUDE.md §4): a send to a 20-diner and a 40-diner table (three dishes a diner, two set
  menus linked) and a move of one diner's dishes between two such bills; report the median and worst of
  ten each, and the regroup's share. The figures go in the PR beside its `Sale-path read changed:` line.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/product-file-size.test.ts` (lower a cap it names,
  `till-api.ts` likely), `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
  src/write-path.e2e.test.ts` (unedited), the typechecks of `@waitron/server`, `@waitron/till`,
  `@waitron/shared`, and prettier on the changed files.
- [ ] **Step 3: Backlog and PR body.** `docs/backlog/menu.md`: 2b done, 2c, 3, 4 left; piece 4
  inherits D22's list. PR body: first line "Resets venues: …" (D26 changes the copies' key); the D2 line; the D10 line; the owner
  items D14, D24–D27; the measurement. `git commit -s -m "Record what the set-menu switch leaves for later"`.

---

### PR 2c — Pay for items and clean-up (`feat/a1515-3-regroup-tidy`)

#### Task 2c.1: Pay for items prices chosen items as their own bill groups them

**Files:**
- Modify: `apps/server/src/pay-for-items.ts` (`readPicks` `:81-173`: the refusal at `:155-161` goes;
  `priceItemPicks` `:198-205`)
- Test: `apps/server/src/pay-for-items.set-menus.test.ts`

**Interfaces:**
- `priceItemPicks(tx, fromBillId, picks)` keeps its signature and answers `planBillGrouping` over
  the chosen rows (a part as a row of that quantity, D13) with the source's recorded copies listing
  them (as the move carries them, `working-order-transfer.ts:160-168`), frozen rows at their stored
  totals, plus extras.

- [ ] **Step 1: Write the failing tests:** for each, the preview's `total` equals the new bill's
  stored total after `payForItems`: Hake alone from a Daily (14.00; the source's Soup becomes 6.00);
  Soup and Hake from two different Dailies (14.00); a Daily with its dishes (14.00); Sirloin chosen
  with Soup (19.00); a comped dish of its own (its stored price).

  _2026-11-25, corrected in 2c: this said 16.00 for Hake alone. The new bill groups a lone Hake as a
  Daily, at 14.00 (`apps/server/src/pay-for-items.set-menus.test.ts`)._
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/server exec vitest run src/pay-for-items.set-menus.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2's command and `src/pay-for-items.test.ts src/pay-for-items.move.test.ts src/pay-for-items.card.test.ts`; the case pinning the old refusal changes (spec §7: "Paying for some items … Both bills are grouped again").
- [ ] **Step 5: Commit** `git commit -s -m "Price items paid for on their own bill as that bill groups them"`.

#### Task 2c.2: `set_menu_counts_as_course_id` goes

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`:312`, the check); `packages/db/triggers/core.sql`
  (`:403,478,572`); `apps/server/src/set-menu-bill.ts` (`readBillsSetMenus` `:186`: `countsAsCourseId`
  reads the line's `counts_as_course_id`, D12); `apps/server/src/working-order-transfer.ts:424`;
  `apps/server/src/testing/set-menu-readers-fixture.ts:35`; `packages/orders-sales/src/set-menu-grouping-plan.ts`
  (stops planning it)
- Regenerate: the core baseline
- Test: `packages/db/src/schema/orders.test.ts`, `apps/server/src/set-menu-bill.test.ts`

- [ ] **Step 1: Write the failing tests:** the column is gone (inserting it fails to typecheck, so the
  test reads `pragma table_info`); the set-menu answer gives a placed dish the course recorded on its
  line.
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/db exec vitest run src/schema/orders.test.ts` and `pnpm --filter @waitron/server exec vitest run src/set-menu-bill.test.ts`.
- [ ] **Step 3: Implement; `pnpm --filter @waitron/db db:generate`.**
- [ ] **Step 4: Run** Task 2a.1's guard commands, Step 2's commands, `src/set-menu-regroup.test.ts src/split-off-extras.split.test.ts`, `pnpm --filter @waitron/orders-sales exec vitest run src/set-menu-grouping-plan.test.ts`, typechecks and prettier.
- [ ] **Step 5: Commit** `git commit -s -m "Stop storing a course per set-menu dish"`; backlog: PR 2 done. PR body first line "Resets venues: …".

## PR 3 — Comps and discounts (`feat/a1515-3-dish-adjustments`, then 3b and 3c)

Written 25 November against `main` at `5e8d24f285`, where PR 2c (#4332) landed. Every `file:line`
below is on that commit and was read, not run, unless a step runs it; D45–D59, 3b and 3c are on
`fa3d08f2f5` instead.

**Should this exist?** The spec's section 6, approved by the owner on 24 November ("y", commit
8dc86752ba): "An individual dish with a discount gets treated as a la carte" and "you would apply it
to the menu, not to the individual dishes". Today, after 2b, a dish given away while it sits in a
set menu keeps its place and freezes that set menu and every other dish in it; comping a dish that
costs 0.00 inside its set menu is refused (`adjustment.no_reduction`). The simplest alternative,
leaving the freeze, breaks both owner sentences, and a discounted dish could still not move or be
paid for on its own. The owner's approvals of the discount rules are quoted in the spec; the
decisions below are this lane's unless marked.

### The split: four pull requests (rule C, D58)

_2026-11-26: the owner's rule C (D45) replaced the five-PR split of 25 and 26 November: 3b0 is
dropped, 3b is rewritten as 3b1 and 3b2, 3c is one pull request, and PR 4 is no longer needed (D57)._

| PR | What a person can do when it lands | Depends on |
| --- | --- | --- |
| 3a. A dish's own comp or discount (`feat/a1515-3-dish-adjustments`) | Comping or discounting a dish of a set menu takes it out of the set menu, charges it à la carte less the comp or discount, and works out the rest again. Before saving, the till shows what the bill goes to. A discounted dish moves and is paid for on its own, with its discount. An extra given away leaves its dish in its set menu. No schema change, no venue reset. | 2c; D32 answered by the owner before it lands |
| 3b1. A set menu's comp or discount (`feat/a1515-3-menu-adjustments`) | A comp or discount on a set menu takes off its price and its supplements, and the set menu stays as it is while it holds it; a second one replaces the first; some of its dishes cancelled, moved or paid for alone take the discount off; the whole set menu moved or paid for, by its row or by choosing every one of its dishes, keeps it; previews say so and write nothing; a free takeaway set menu can be refunded. Resets venues. | 3a |
| 3b2. Saying when a discount came off (`feat/a1515-3-discount-notices`) | Changing a discounted dish's extras, or its variant in a held order's save, takes its discount off; every bill answers a notice for each discount that came off, with what to give it again on (drawn by the till in A1515-4); the report leaves out a discount that came off. Resets venues: _2026-11-26, at finish review, an index on `adjustment_endings(working_order_id)` was added for the notice read (watcher, "WATCHER 2026-11-26 21:42")._ | 3b1 |
| 3c. A whole-bill discount as the set menus change (`feat/a1515-3-bill-discounts`) | A bill discounted as a whole keeps working out its set menus; each dish keeps its own part; a dish ordered later pays full price. | 3b2 |

3a, 3b1 and 3b2 are written out below; 3c is one page, given its task steps against `main` as 3b2
leaves it, and the watcher clears them.

**Size of 3a** (estimates from reading): product about +200, −60, with about 350 lines moved to a new file unchanged; tests about +550,
with about 35 cases changed (14 are whole-shape checks gaining one key); generated files none; five
tasks, about 3 hours. A fresh reader built tasks 3a.1 and 3a.2 in a throwaway worktree on 25
November and ran them; its numbers and findings are folded in below.

**Still unavailable after 3a:** typing an amount (not a percentage or Free) for a dish that shows
0.00 inside its set menu, because the till's Comp window limits the amount to the price it shows
(`adjust.amount_too_large`, `apps/till/src/widgets/adjustment-dialog.ts:419`); the till's tags and
its list for piece 4; 3b's and 3c's subjects, which stay frozen as 2b left them.

### Decisions for the watcher (new in PR 3)

- **D29. The split above.** The alternative, one pull request, is well past three hours, and 3c
  waits for an owner answer 3a and 3b do not need.
  _2026-11-26: superseded by D58 (the split under rule C)._
- **D30 (3a). What freezes a row changes, for comps and discounts only.** A dish or set-menu row is
  frozen when an `adjustment_lines` row with a reduction above 0 names it, or its price is below its
  stamped list price. Three things stop freezing:
  - `adjustments.line_id` on a comp or discount: it names the first portion of the till's row, not
    the portion taken (`takenPortions`, `adjustments-apply.ts:540`, plan D32 there), so today it
    freezes a dish nothing was taken off (pinned at `set-menu-regroup-moves.test.ts:243`);
  - a stamped list price equal to the price: `reprice` stamps every portion of the row, taken or
    not (`stamped`, `adjustments-apply.ts:988`); the grouping clears the stamp on each dish it
    writes, or a dish it lowers to 0.00 would print as discounted;
  - an extra's comp or discount no longer freezes its dish (D34).

  A cancel that kept its charge, a service cancellation and an item payment freeze as today, from an
  extra too. D15's carried case (a comp of 0.00 copied by Reopen bill with only its stamp) cannot
  arise any more from a dish in a set menu: such a dish now leaves the set menu and is reduced from
  its à la carte price.
- **D31 (3a). How a dish leaves.** Before a comp's or discount's amounts are worked out, each dish
  it acts on that is in a set menu is read at its à la carte price
  (`working_order_lines.a_la_carte_unit_price`); when it is applied, each dish row whose price
  changes is first written à la carte (place cleared), then reduced and stamped as any other dish
  is, then the bill is regrouped, before the paid-more-than-total check. Only the portions taken
  leave. A dish in a set menu that is itself frozen (3b's and 3c's discounts, a kept-charge cancel)
  keeps today's behaviour until 3b and 3c, or the set menu would stay charged with its dishes gone.
  A till row of several dishes is mapped only when every one of them in a set menu can leave it and
  all share one à la carte price; otherwise none is mapped, which is today's behaviour. `standInRow`
  prices a whole row from its first portion and compares stored prices, so two Hakes at 0.00, one in
  a comped Daily, pass as one row: run without this rule, 10% off the two charged the Hake inside
  the comped Daily 14.40 and recorded −14.40 on it.
- **D32 (3a). FOR THE OWNER. What a dish's comp records.** Two Dailies of Soup and Hake (28.00): one
  Hake given away leaves 14.00 + 6.00 + 0.00 = 20.00, so the bill drops 8.00, and the dish's own
  price is 16.00. Recommended: record and print 16.00, the dish's own price taken off: the receipt's
  lines (Hake 16.00, Free −16.00) add up only that way, the reason's limits are about the dish, and
  for a discount the bill can RISE (Soup and Hake, 10% off the Hake: 14.00 to 20.40), which the
  record's check refuses (`adjustments_amounts_ck`, `packages/db/src/schema/adjustments/adjustments.ts:110`).
  The adjustments report then shows 16.00 given away. The commonest comp changes
  nothing on the bill: the Soup of a Soup and Hake Daily given away leaves the bill at 14.00 (a lone
  Hake is still a Daily), and 6.00 is recorded. Alternatives: the bill's drop, as the owner chose for
  cancels (D24, "13"), 8.00 and 0.00 here, which works only for a comp; or the dish's own price with
  the bill's change shown beside it in the report (a new recorded column).
- **D33 (3a). The preview answers the bill's total before and after** (`billTotal`), worked out the
  same way the apply will, and the till shows "The bill goes from 14.00 to 20.40" instead of "Takes
  1.60 off the bill" when the bill's change is not the reduction, or "The bill stays at 14.00" when it does not
  change. The spec asks for the new total before every dish discount and gives that to piece 4; from
  3a today's sentence would be false in these cases, so this line comes with 3a and piece 4 restyles
  it. Alternative: the server field alone, and a false sentence until piece 4.
- **D34 (3a). An extra's own comp or discount leaves its dish in its set menu.** The spec says "paid
  extras on a dish are charged as usual whether or not the dish is in a set menu"; giving away the
  Bread must not charge the Soup 6.00. Comping the dish still takes its extras with it, as today.
  `adjustedDishIds` (`set-menu-bill.ts:341`) follows: an extra's comp no longer makes its dish not
  movable.
- **D35 (3b).** _Withdrawn 2026-11-26 by rule C (D45): no column holds a set menu's discount; it
  stays on the rows it was given on and comes off when the set menu breaks up (D49, D50). Full
  text at `bbe95ebd14`._
- **D36 (3b).** _Withdrawn 2026-11-26 by rule C, except that a set menu's comp or discount still
  covers its supplements (spec section 6), written with today's spread (D49). Full text at
  `bbe95ebd14`._
- **D37 (3b).** _Withdrawn 2026-11-26 by rule C: a discount that comes off is recorded when it does
  (D47), and the notice is read from that (D54). Full text at `bbe95ebd14`._
- **D38 (3c). FOR THE OWNER, answered: what a whole-bill discount covers after it is given.** Owner,
  2026-11-25 20:51: "Build it" (3c-1 and 3c-2, lane B's `questions.md` 20:20); a fixed amount does
  not grow with later dishes; and at 20:02 a dish cancelled, moved or paid for alone takes its part
  ("this does seem fairer", "this too"). What stands: the discount stays with the dishes on the bill
  when it was given; a dish ordered later pays full price; a guest paying for their own dishes keeps
  their part. _2026-11-26: 3c-2 (a percentage reaching dishes ordered later, moved in or copied)
  withdrawn by rule C; the rest is 3c's page and D56. Full text at `bbe95ebd14`._
- **D39 (3b).** _Replaced 2026-11-26 by D55, which keeps its reason: counting both a discount and
  the cancel that ended it says more was lost than the bill lost. Full text at `bbe95ebd14`._
- **D40 (3b).** _Superseded 2026-11-26 by D58 (3b is two pull requests, of other shapes). Full text
  at `bbe95ebd14`._
- **D41 (3b). DECIDED BY THE OWNER** (26 November 00:04): Free pressed on the Hake Daily stays on
  the Hake Daily, not on a Sirloin Daily beside it. _2026-11-26: rule C (D45) keeps that and
  withdraws the rest: a set menu's discount never moves to another set menu. Full text at
  `bbe95ebd14`._
- **D42 (3b0).** _Withdrawn 2026-11-26 by rule C (D45), with 3b0. Full text at `bbe95ebd14`._
- **D43 (3b1).** _Withdrawn 2026-11-26 by rule C (D45): a new discount replaces only what its own
  set menu holds (D52). Full text at `bbe95ebd14`._
- **D44 (3b0).** _Withdrawn 2026-11-26 by rule C (D45), unanswered. It was asked in lane B's
  `questions.md` at 08:05 and built only on 3b0's branch (`eb8c8f6d25`), so `bbe95ebd14` does not
  hold it._

#### Rule C and what it leaves open (26 November)

- **D45. DECIDED BY THE OWNER: rule C** (26 November 07:58–08:09, relayed by the watcher in lane B's
  `questions.md`, "WATCHER 2026-11-26 08:08" and "08:09"). The owner: "These discount scenarios are
  very much not real world, and they're causing masses of complexity. How can we simplify them. The
  typical thing is that discounts are applied just before payment. What if we were to remove
  percentage discounts. If somebody wants to give 50% off then it is calculated in the moment and
  applied as an amount instead. And it should either be attached to the whole meal or to a
  particular dish or set meal." Asked what can change a single dish, the owner chose "C": every
  discount is an amount, a percentage being turned into one when it is given, and Free stays its own
  kind (the whole price); it is on the whole bill, one dish or one set menu; cancelled, the discount
  goes with it; moved (another table or bill, Pay for items), it goes with the dish or set menu;
  fewer of it, the amount was split per item when given, so cancelling one removes that item's
  share; a price change (variant, extras) takes it off, with a notice on the bill saying so and why;
  a set menu broken up (a dish cancelled from it, for one) loses its discount, with a notice. Added
  at 08:09: "With the notice allowing the waiter to reapply at the new price". It replaces D41–D44,
  drops 3b0, and withdraws 3c-2 from the owner's "Build it" of 25 November 20:51 (D38). D46–D59 are
  what it leaves open.
- **D46. A percentage stays a way of asking.** The comp window still sends `discount_percent`; the
  server turns it into an amount at that moment, as today (`requestedDiscount`,
  `adjustments-apply.ts:262-283`), and records the percentage beside it. Recommended: keep it. The
  reason's percentage limit (`reason.maxPercentBp`, `packages/adjustments/src/policy.ts:172`) and
  the receipt's "10%" keep working, and the notice needs the percentage to work it out again on the
  new price (the owner's 08:09 addition).
  Alternative: drop `discount_percent` and have the till send the amount; the reason's percentage
  limit, the report's percentage and every test that sends a percentage then change, and a notice
  could offer only the old amount.
- **D47. What "comes off" writes, and on which bill.** One row in a new append-only table,
  `adjustment_endings` (the adjustment; the bill; why; the dish that left or changed, by name; the
  line a notice offers it again on, for a change of extras or variant; when), in core's migration
  set, so 3b1 resets venues. The adjustment's rows on that bill get back what its `adjustment_lines`
  say it took. An ending belongs to the bill the adjustment's rows are on when it ends, which after a
  whole set menu moved (D51) is not the bill it was given on: a comp's record stays on the bill it
  was given on while its rows move (`apps/server/src/set-menu-freeze.ts:49-51`), and
  `readBillAdjustments` reads by that bill (`packages/adjustments/src/record.ts:162`; until the
  2026-11-26 note below). _2026-11-26,
  after review:_ what an ending gave back is kept per row, in a second append-only table,
  `adjustment_ending_lines` (the ending, and the `adjustment_lines` row it gave back, each such row
  at most once), because a move keeps a line's id: keyed by the bill alone, a discount ended on one
  bill came back once its rows reached another, and could be given back there a second time. So a
  3a dish discount whose portions were split over two bills ends only on the bill whose dish
  changed, and only for the rows there; an ending that would give nothing back is refused
  (`adjustment.not_standing`); and a copy or split of a row (`carryLineReductions`) does not carry
  a reduction that was given back, since the copy has the price it was given back at. Every
  reader of standing discounts leaves out an `adjustment_lines` row that an ending gave back,
  wherever its line is now: the freeze (`reducedLineIds`, `set-menu-freeze.ts:45-65`, which
  also gives a set-menu dish's `movable`, `apps/server/src/set-menu-bill.ts:357`, and through
  `frozenLineIdSources` feeds `refuseMovingFrozenDishes` and the grouping); the reason's standing on
  the bill (`readReasonStanding`, `record.ts:98`, which also takes a preview's ending); the receipt
  (`readBillAdjustments`, `record.ts:145`); the corrections report's free items
  (`listFreeItems`, `apps/server/src/free-items.ts:119`, read at `report-api.ts:342`); and the
  adjustments report (D55). Without that, its `adjustment_lines` would freeze the set menu for good
  (D30), and the receipt would print per dish, since its records would no longer add up
  (`receipt-adjustments.ts:282`). The venue's most-off-one-bill check needs nothing: it compares
  each row's list price with its price (`judgeComp`, `adjustments-apply.ts:805-810`). **Why a table
  rather than working it out from what the bill holds:** `adjustments` and `adjustment_lines` never
  change (`appendOnly`), so they still say the rows were reduced once their prices are back, and
  nothing else records which dish's change ended it, which the notice names. Alternative: work out
  on every read which discounts no row holds (the old D37); every reader repeats it, and why it came
  off is lost. _2026-11-26, after the second review:_ the receipt's read
  (`readBillAdjustments`) no longer goes by the bill a discount was given on or ended on: it shows
  each discount that still takes something off a row now on the bill being printed, and one given
  on that bill only while none of its rows has left or been given back. So a set menu moved whole
  prints its discount once, on its new bill and not on the old one, and a discount ended on one
  bill is still read for another whose rows still carry it (a package test only; no path in this
  branch reaches it).
- **D48. A cancel that breaks a discounted set menu ends the discount first, then is worked out and
  recorded from there (D24).** In the comp window's apply the ending runs before the cancel is
  planned (`planAdjustment`, `adjustments-apply.ts:1097`), so the cancelled row's own price and the
  bill's further drop (`regrouped`, `:1106-1127`, what `removeFromLine` answers "beyond the removed
  part's own charge", `working-order-removal.ts:104-106`) are both read with the discount gone. Free
  on a Soup and Hake Daily (0.00), the Hake cancelled: the Free ends (14.00), the cancel records
  8.00, the bill is 6.00, and the notice offers Free on the Soup (_2026-11-26: superseded by D54's 20:07 note: a set menu's notice names no place and stays until the bill closes._). Free on a Soup and Sirloin Daily
  (0.00), the Sirloin cancelled: the Free ends (Daily 14.00, Sirloin 5.00), the cancel records 13.00
  and the bill is 6.00; planned before the ending it would record 8.00 and lose the Sirloin's 5.00
  (worked out by hand). Worked the other way round, the cancel's drop would be −6.00, which
  `adjustments_amounts_ck` refuses (`packages/db/src/schema/adjustments/adjustments.ts:110`). **The
  paths that remove a dish, and so end a set menu's discount before they remove:** the comp
  window's cancel (`applyAdjustment`'s cancel branch, `adjustments-apply.ts:1106-1127`, and its
  preview, D59); Cancel item taking off an unstarted dish with no reason recorded
  (`apps/server/src/line-cancel.ts:317`, `:327`); Reopen to split taking a stopped dish off its copy
  (`takeOffCopies`, `apps/server/src/split-after-print.ts:274`, the ending recorded on the reopened
  bill); and a basket save dropping an unsent dish (`applyLineEdits`,
  `working-order-line-edits.ts:1159-1173`). Only the first records an amount. `removeFromLine` and
  `removePortions` themselves end nothing, since the comp window must end before it plans.
  Alternative: the cancel records 0.00, and the report then never shows the 8.00 by which the bill's
  charge fell below its list prices.
- **D49. A set menu's comp or discount is written as any comp is, over its row and the dishes in it
  that carry a supplement,** so 2b's freeze keeps that set menu as it is (D30). Spec section 6 says
  it covers "the set menu's price and the supplements of the dishes in it … not the paid extras";
  today's spread shares it by price and writes `adjustment_lines` on each row
  (`adjustments-apply.ts:331-345`, `:1177-1187`), and nothing is handed to the calculation.
  Alternative: the old D35–D36, a holder column and the calculation working the discount in
  (`5e90544ac4`), which rule C no longer needs.
- **D50. Some but not all of a discounted set menu's dishes leaving (Move dishes, a table split's
  loose dishes, Pay for items) breaks it, as a cancel does:** the discount comes off with a notice
  and those dishes leave at their own price; every dish leaving moves it whole (D51). A merge moves
  every line (`moveOrderLines` with no line numbers, `bill-actions.ts:184`), so it never breaks one.
  Today the comped Daily stays behind, frozen (D18). A declined card puts the dishes back
  (`putItemsBack`, `bill-payments.ts:2343`, which moves every line back) but not the discount; the
  notice offers it again. Recommended: it is rule C's "broken up", and needs no refusal.
  Alternative: refuse a dish alone (`set_menu.move_adjusted`); staff move the whole set menu or give
  the discount again afterwards, and nothing comes off on a move.
- **D51. A discounted set menu moves whole, keeping its discount, when its own row is chosen or when
  every one of its dishes is.** The till's Move dishes and Pay for items screens choose dishes, not
  set menus (spec section 7: "The pay screen lists dishes, not set menus"; the till's
  `setMenusThatGo`, `apps/till/src/state/split-selection.ts:107-120`), so paying for a discounted
  set menu dish by dish must not lose its discount, which "goes with the dish or set menu". The
  server counts a set menu whose row a standing comp or discount reduced (its own; before 3c also
  its part of a whole-bill one) as chosen once every dish placed in it is chosen whole: in
  `resolveMoveLines` (`apps/server/src/bill-actions.ts:208`, which serves Move dishes, a table
  split's loose dishes and Pay for items' move) and in Pay for items' reading of its picks
  (`readPicks`, `apps/server/src/pay-for-items.ts:85-188`, which its preview prices). Its rows keep
  their ids when they move (`working-order-transfer.ts:178-187`), so their `adjustment_lines` still
  name them and they stay frozen on the other bill (D30); it is not worked out again with that
  bill's dishes, and its comp's record stays on the bill it was given on (D47). Any other set menu
  is worked out again on both bills as today, and one frozen by a kept-charge cancel still refuses
  its dish alone (D18). **For A1515-4 (the till):** `setMenusThatGo` keeps a set menu that is below
  its list price, or holding a dish that is, when all its dishes are chosen; it must count it as going with its last dish, as
  the server now does, and say before saving that choosing only some of its dishes takes its
  discount off (D50). The server needs no set-menu row from the till. Alternative: only a chosen row
  moves a set menu (today's `resolveMoveLines`), and the till sends the row's id when every dish is
  chosen; a choice dish by dish from anything else then loses the discount. _2026-11-26, after
  the second review:_ a set menu priced 0.00 takes its whole discount off its supplements, so its
  own discount is found by what it still takes off the set-menu row or any dish in it
  (`ownStanding`, `apps/server/src/set-menu-discount-ending.ts`), and such a set menu counts as
  chosen too; replacement (D52), break-up (D48, D50) and Pay for items read the same answer.
- **D52. A second comp or discount on a set menu replaces the one it holds; on a dish they still add
  up.** For a set menu this is the owner's 24 November rule (spec section 6: "A new discount
  replaces the old one and the till says so"): the old one ends (`replaced`, no notice) and the
  preview answers `replaces`, working the old one's ending out without writing it (D59). On a dish,
  today's rule stays: a second is taken off what the dish costs then
  (`~/waitron-campaign-shared/discount-review-2026-10-28.md:32`). Alternative: replace on a dish
  too, which changes 3a's and today's rule.
- **D53. A price change is a change of extras, or of variant in a held order's save.** An edit of a
  stored dish carries a quantity, a note, options and extras (`LineIntent`,
  `working-order-edit-state.ts:168-174`), keeps its stored variant (`variantOf`,
  `working-order-line-edits.ts:259-260`), and prices no options answer (`:114-116`); so on a table
  bill a dish changes variant only by Cancel item and a new dish, and its discount goes with the
  cancel. A held order's save (`saveHeldOrderIn`, `apps/server/src/working-order-held-write.ts:109`)
  differs: the till keeps each line's `workingOrderLineId` (`apps/till/src/state/working-order.ts:79`),
  and a line naming a stored line of the same menu item with another variant is not taken as an
  edit of it (`sameItem`, `:138-148`): it is added as a new line and the stored line is removed
  (`:167`). 3b2 reads that pair as a change of variant: the stored line's own comp or discount ends
  `variant_changed`, with a notice offering it again on the new line; a dish of a discounted set
  menu so changed ends the set menu's discount the same way, offered as for a set menu broken up
  (D54). A stored line removed with no such successor is a cancel (rule C: the discount goes with
  it, no notice). Recommended: the owner named the variant ("Or it changes variant which could be
  more or less expensive"). Alternatives: no notice for a swap (this plan's earlier recommendation);
  or let an edit change a variant, a piece of work of its own.
- **D54. The notice.** Answered on each open bill for each ending recorded on that bill (D47) caused
  by a change (`extras_changed`, `variant_changed`, `dish_cancelled`, `dish_moved`,
  `dish_paid_alone`) that no later comp or discount on that bill gives again
  (`adjustments.reapplies_adjustment_id`); not for one replaced or a set menu cancelled whole (rule
  C: "Cancelled: the discount goes with it"), and not once nothing it covered is left on the bill (a
  set menu whose dishes are then cancelled one by one ends as one cancelled whole; _2026-11-26: superseded by D54's 20:07 note: a set menu's notice names no place and stays until the bill closes._). It says what came
  off (kind, percentage, amount, reason), where (the dish or set menu) and why (which dish, and what
  happened), and what to give it again on: the dish, for a change of extras; the new line, for a
  change of variant; for a set menu, the set menu its remaining dishes now share, else the one dish
  left, else nothing, and staff use the comp window (_2026-11-26: superseded by D54's 20:07 note: a set menu's notice names no place and stays until the bill closes._). The amount on the new price is what the comp
  window's preview answers for the same terms there (3a's preview, D33). No Dismiss: it goes when
  the bill closes. Recommended. Alternatives: a Dismiss (a column that changes, on an otherwise
  append-only record); or offering it again on the whole bill when the dishes are spread over
  several places. _2026-11-26, while building 3b2:_ nothing records which dishes were in a set menu
  once its discount ends, so a set menu's notice offers no place (`reapplyOn` null; staff pick it in
  the comp window) and stays until the bill closes, even once its other dishes are gone (the
  watcher, lane B `questions.md`, "WATCHER 2026-11-26 20:07"). A notice also goes once its bill is
  paid or abandoned, and a dish's notice once its line leaves the bill. _2026-11-26, after the second
  finish review:_ a dish's ending stays on its notice until a comp or discount naming it takes
  something off that dish or its extras, so giving it again on one dish leaves the others' shares on
  the notice; a set menu's goes once any one names it.
- **D55. The adjustments report leaves out a discount that came off.** Its total is "What the bills
  actually lost" (`AdjustmentTally.reduction`, `packages/adjustments/src/reports.ts:45-46`): a 50%
  Daily (7.00) whose Hake is then cancelled counts the cancel's 8.00 (D48), the difference between
  the Daily's 14.00 and the Soup's 6.00; counting both says 15.00. The drill-down still lists it.
  Alternative: count every one as recorded, as today. _2026-11-26, at finish review:_ a change of
  extras or variant ends only the changed dish's share of its own comp or discount, so its other
  portions keep theirs; a notice's amount is what came off that bill; a dish's notice is given
  again only on that dish; and the report counts what still stands of a discount partly ended,
  leaving out only one ended whole. _2026-11-26, after the second finish review:_ removing an extra
  ends the dish's own discount over the extra too, though the edit has already deleted its row, so a
  Soup with Bread at 50% (3.75) whose Bread is removed counts nothing in the report and its notice
  says 3.75 came off; a comp given on the removed extra alone ends nothing and stays counted, as a
  cancelled dish's comp does. _2026-11-26, after the third finish review:_ one edit over several
  portions records an ending for each changed dish, with only that dish's rows and removed extras,
  so giving it again on one portion leaves the notice for the others, offered on the one with the
  lowest line number.
- **D56 (3c). A dish's part of a whole-bill discount stays through a change of its extras,** with
  no notice: it is the bill's discount, not the dish's; the dish keeps its price and the new extra
  pays full price, as today (`working-order-line-edits.ts:443-446`). A cancelled, moved or
  separately paid dish takes its part, as the owner chose on 25 November 20:02 (D38: "this does seem
  fairer", "this too"). Alternative: end the dish's part with a notice, as for its own discount.
- **D57. PR 4 is no longer needed** (its section says where each part went). Alternative: keep it
  as a pull request of tests only.
- **D58. The split: 3b1 (set menus, resets venues), then 3b2 (dishes and the notice), then 3c.**
  3b1 comes first because it holds the schema both need and the refund fix the watcher put there
  (00:20). Between 3b1 and 3b2 a set menu's discount can come off with no notice in any answer;
  the till draws none until A1515-4 either way. Between 3b1 and 3b2 the adjustments report also
  counts a discount that came off, so it can show more taken off than the bill lost (D55).
  Alternative: one pull request of about 7 hours.
- **D59. A preview works an ending out without writing it.** Both previews that can end a discount
  run in a transaction that saves what it writes (`previewPayForItems`, `pay-for-items.ts:564-573`,
  through `readPicks`, which Pay for items' apply runs too; `previewAdjustment`,
  `adjustments-apply.ts:898`, called in `withTransaction` at `adjustments-api.ts:270-272`), so an
  ending written there would stand for good. Only the paths that change the bill end one: D48's
  removals, `moveOrderLines`'s loose dishes (D50), `applyAdjustment` replacing a set menu's discount
  (D52) and 3b2's edits. A preview asks `endingRestores(tx, { workingOrderId, adjustmentIds })`,
  which reads what `endAdjustment` would write (each row its price back, its stamp cleared), and
  hands it as `ending` to the readers it uses: `readRows`
  (`apps/server/src/adjustment-rows.ts:71`, for `planAdjustment`), `totalAfterAdjusting` and
  `regroupDropAfter` (`set-menu-regroup.ts:341`, `:282`, which lay the restored rows over the read
  ones) and `frozenLineIdSources` (`set-menu-freeze.ts:16`, which leaves those adjustments' rows
  out). `endAdjustment` writes exactly what `endingRestores` answers, so a preview cannot differ
  from its apply in how it ends one, and each such preview has a test that it equals its apply,
  ending included, and writes nothing. Alternative: a savepoint the preview rolls back
  (`tx.transaction`, as `apps/server/src/alerts.ts:127` uses one): less code, but every such preview
  then writes, and stays a preview only through the rollback.

### Global constraints for PR 3

- Every price a comp or discount writes goes through the path's own transaction, and the regrouping
  runs after its last line write and before `assertBillInvariant`.
- A regrouping never writes a reduced row, an extra, or `set_menu_id` on a dish (D11).
- A discount can now raise a bill, so the simplified-invoice limit is checked as other raising edits
  check it (`totalBeforeEdit`, `refuseOrderOverSimplifiedLimit`, `stored-order-lines.ts:289`).
- The golden huella test and `inmutabilidad` pass UNEDITED. 3a has no schema change. The owner lands
  each PR.

### Review focus (3a)

1. **Only the portions taken leave the set menu**, and a portion of the same row left behind can
   still be grouped and prints no discount (Task 3a.1, 3a.2).
2. **The preview equals the apply**, in every case of Task 3a.2, and writes nothing (3a.3).
3. **A set menu frozen by another discount keeps its dishes** (D31; Task 3a.2's pins): nothing is
   charged for a set menu whose dishes have left, and a till row mixing a frozen set menu's dish with
   another is not half mapped.
4. **Every figure adds up on the receipt and the filed lines**, takeaway at mixed rates included
   (Task 3a.4).
5. **An ordinary bill is unchanged:** `adjustments-apply.test.ts`, `order-portions.adjustments.test.ts`
   and `receipt-adjustments.test.ts` pass with no assertion changed except a whole preview shape
   gaining `billTotal`.

### PR 3a — A dish's own comp or discount (`feat/a1515-3-dish-adjustments`)

#### Task 3a.0: Room in `adjustments-apply.ts`

`adjustments-apply.ts` is 1,495 lines with a cap of 1,500 (`scripts/product-file-size-limits.json`);
run, 3a.2 alone took it to 1,516.

**Files:**
- Create: `apps/server/src/adjustment-rows.ts` (`Row`, `readRows`, `gross`, `listValue`, `stageOf`,
  `StandIn`, `standInRow` and the helpers only it uses, moved unchanged)
- Modify: `apps/server/src/adjustments-apply.ts`; `scripts/product-file-size-limits.json` (its cap
  comes down)

- [ ] **Step 1: Move**, changing nothing but imports and exports.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/adjustments-apply.test.ts src/order-portions.adjustments.test.ts src/adjustments-api.test.ts`, `pnpm exec vitest run scripts/product-file-size.test.ts`, `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 3: Commit** `git commit -s -m "Move how an adjustment reads a bill's rows to its own file"`.

#### Task 3a.1: Freeze rules and the stamp (D30, D34)

**Files:**
- Modify: `packages/orders-sales/src/set-menu-grouping-plan.ts` (`frozenLinesOf` `:73-96`,
  `GroupingDishUpdate` `:46-53`, `aLaCarteUpdate` `:114-128`, `sameDish`, the dish updates);
  `apps/server/src/set-menu-freeze.ts` (`namedFrozenLineIds`); `apps/server/src/set-menu-regroup.ts`
  (`planGrouping`); `apps/server/src/set-menu-moves.ts` (`refuseMovingFrozenDishes`: an extra's comp
  or discount no longer refuses its dish); `apps/server/src/bill-actions.ts:270-290`
  (`takesEveryDish`, which uses both functions and must select `unitPriceGross`);
  `apps/server/src/set-menu-bill.ts:341` (`adjustedDishIds`, D34);
  `apps/server/src/testing/set-menu-bill-fixture.ts:75` (`freezeBillLine` stamps a list price equal
  to the price, which D30 retires: it stamps one above it)
- Test: `packages/orders-sales/src/set-menu-grouping-plan.test.ts`, `apps/server/src/set-menu-regroup.test.ts`

**Interfaces:**
- `frozenLineIdSources(tx, lineIds): Promise<{ reduced: Set<string>; held: Set<string> }>` in
  `set-menu-freeze.ts`, replacing `namedFrozenLineIds`: `reduced` = `adjustment_lines` with
  `reduction > 0`; `held` = kept-charge cancels, service cancellations, item payments (the last goes
  if A1515-1 PR 3 has landed).
- `frozenLinesOf(lines, { reduced, held })`: a `held` extra freezes its dish; a `reduced` one does
  not; a line with `unitPriceGross < listUnitPriceGross` counts as reduced; a dish's set menu and
  that set menu's other dishes follow as today.
- `GroupingDishUpdate` gains `listUnitPriceGross: null`, written on every dish the grouping writes;
  `sameDish` compares it, so a stamp equal to the price is cleared.

- [ ] **Step 1: Write the failing tests.** In `set-menu-grouping-plan.test.ts`: a stamp equal to the
  price freezes nothing and the plan clears it; a stamp above the price freezes the dish, its set
  menu and that set menu's dishes; a reduced extra freezes neither its dish nor its set menu; a held
  extra does. In `set-menu-regroup.test.ts`: Soup with Bread and Hake, Bread discounted 10%, then
  Soup and Hake sent, then the first Hake cancelled: one Daily, a Soup at 6.00 and Bread 1.35 (two
  intact Dailies look the same frozen or not, so the cancel is what fails today); one of three
  Sirloins in Dailies comped as a row: the two left carry no stamp after the next regrouping.
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/orders-sales exec vitest run src/set-menu-grouping-plan.test.ts` and `pnpm --filter @waitron/server exec vitest run src/set-menu-regroup.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Changed test checks**, then Step 2's commands and `src/set-menu-regroup-moves.test.ts
  src/set-menu-adjustments.test.ts src/pay-for-items.set-menus.test.ts src/set-menu-bill.test.ts
  src/set-menu-bill-moves.test.ts src/a-la-carte-price.test.ts src/move-dishes.test.ts`:
  `set-menu-grouping-plan.test.ts:692` (extra to dish: now held only), `:710,717` (stamp equal to the
  price), `:555`, and every `dishUpdates` shape gaining `listUnitPriceGross: null` (14 cases in all);
  `set-menu-regroup.test.ts:482` (a comp of 0.00), `:509` and `:673` (rewritten with the cancel above,
  since both pass either way as they stand); `set-menu-regroup-moves.test.ts:243` (the untaken
  portion, and its import of `namedFrozenLineIds`); the `freezeBillLine` users
  (`set-menu-bill-moves.test.ts:122,209`, `a-la-carte-price.test.ts:434`: fixture only, no total
  moves); `set-menu-adjustments.test.ts` "a dish whose extra is comped moves only with its set menu" (it now
  moves, the Bread arriving at 0.00).
- [ ] **Step 5: Commit** `git commit -s -m "Freeze only the dishes a comp or discount took money off"`.

#### Task 3a.2: A comped or discounted dish leaves its set menu (D31, D32)

**Files:**
- Modify: `apps/server/src/adjustments-apply.ts` (`Row` gains `aLaCarte`, `setMenuLineId`;
  `planAdjustment` `:804`; `Plan.released`; `applyAdjustment`'s comp branch)
- Create: `apps/server/src/set-menu-dish-release.ts`; `apps/server/src/set-menu-dish-adjustments.test.ts`

**Interfaces:**
- `releasableDishIds(tx, orderId, dishIds): Promise<Set<string>>` — the dishes among `dishIds` that
  sit in a set menu that is not frozen.
- `releaseDishes(tx, dishIds): Promise<void>` — writes each à la carte: role, set menu, place and
  list price null, unit price `a_la_carte_unit_price`, line total that times its quantity.
- In `planAdjustment`, for a comp or discount on a dish (never an extra, never `lineId` null), the
  rows read are mapped once: a releasable dish has `unit = aLaCarte`, `list = null`. `Plan.released`
  is the ids of the dish rows among `writes` that were mapped. `applyAdjustment` releases them, then
  `reprice`, then `bumpRevision`, then `regroupBills(tx, [orderId])`, then
  `assertBillInvariant` and `refuseOrderOverSimplifiedLimit`. For a till row (`lineIds`), the
  mapping is all or none (D31).

Prices in the fixture: Daily 14.00 (Soup, Hake, Sirloin +5.00), Special 20.00; à la carte Soup 6.00,
Hake 16.00, Sea bass 19.00, Sirloin 24.00.

- [ ] **Step 1: Write the failing tests** in `set-menu-dish-adjustments.test.ts`; each asserts the
  bill's rows, its total, and the recorded before, after and reduction:
  - Soup, Soup, Hake, Hake (28.00); one Hake comped: 20.00, that Hake à la carte with list 16.00 and
    price 0.00, the other Daily keeps its id, Soup 6.00; recorded 16.00, 0.00, 16.00.
  - Soup and Hake (14.00), 10% off the Hake: 20.40; recorded 16.00, 14.40, 1.60.
  - Soup and Sirloin (19.00), 4.00 off the Sirloin: 26.00.
  - Soup, Soup, Hake (20.00: a Daily and a Soup), 50% off the à la carte Soup: 17.00 and the Daily
    unchanged row for row; the same on the Soup inside the Daily: 17.00, the other Soup taking its
    place. (The spec's example needs a dessert to leave a Hake à la carte: in this fixture a lone Hake
    is a Daily.)
  - The Soup of a Soup and Hake Daily comped: the bill stays 14.00; recorded 6.00.
  - A till row of two Hakes, each in its Daily, the second's Daily comped, then 10% off the row: no
    dish leaves and nothing is recorded (`adjustment.no_reduction`); the same with the first's Daily
    comped, and with a kept-charge cancel in one of the two set menus; two Hakes whose à la carte
    prices differ (the menu republished at 18.00 between them): not mapped.
  - Two Hakes of one till row, both in Dailies (`lineIds`, quantity 1): only the last leaves; the one
    left carries no list price; a Hake sent afterwards joins the loose Soup: 28.00.
  - After 10% off the Hake, another Hake sent joins the Soup in a Daily: 28.40.
  - Soup with Bread and Hake (15.50), Soup comped: Soup and Bread 0.00, Hake alone a Daily at 14.00.
  - A reason limited to 10.00: comping that Hake needs the approver, as 16.00 à la carte does.
  - Soup and Hake (14.00), 10.00 received, the Hake comped: refused `bill.received_exceeds_total`.
  - With the simplified limit at 20.00, 10% off the Hake of a Soup and Hake Daily (20.40): refused as
    other edits over the limit are.
  - **Pins:** a dish of a comped Daily, and of a Daily on a bill discounted 10% as a whole, is still
    refused `adjustment.no_reduction`, and no row changes (D31); a dish whose set menu holds a
    kept-charge cancel likewise; a cancel of a dish is unchanged (D24).
- [ ] **Step 2: Run and see them fail:** `pnpm --filter @waitron/server exec vitest run src/set-menu-dish-adjustments.test.ts`.
- [ ] **Step 3: Implement.** Delete the `releasableDishIds` frozen check once and see the pins fail;
  restore it; record the result in the PR.
- [ ] **Step 4: Changed test checks**, then Step 2's command and `src/set-menu-adjustments.test.ts
  src/set-menu-regroup.test.ts src/set-menu-regroup-moves.test.ts src/set-menu-regroup-paths.test.ts
  src/set-menu-money.test.ts src/pay-for-items.set-menus.test.ts src/split-after-print.set-menus.test.ts
  src/adjustments-apply.test.ts src/order-portions.adjustments.test.ts src/adjustments-api.test.ts
  src/receipt-adjustments.test.ts src/receipt-document.set-menus.test.ts src/move-dishes.test.ts
  src/free-items.test.ts`. Expected to change, each new total worked
  out by hand from the rule above and listed in the PR: `set-menu-adjustments.test.ts` "a discount on
  a surcharge", "the offered move never names a comped, discounted or item-paid dish" (its comp and
  discount cases), "a discounted set-menu dish moves only with its set menu" and "the same dish moves
  with its set menu" (the dish now moves alone, with its discount); `set-menu-regroup-moves.test.ts:226,243,318`;
  `pay-for-items.set-menus.test.ts:410,421,554` (a comped dish can be chosen alone);
  `split-after-print.set-menus.test.ts:146`; `move-dishes.test.ts:1378`;
  `receipt-document.set-menus.test.ts:353` (the printed comp goes from 5.00 to 24.00, as D32 says) and
  `:390` (its hand-made empty set menus go when a comp regroups). Anything else that breaks is a stop.
- [ ] **Step 5: Commit** `git commit -s -m "Charge a comped or discounted dish a la carte and work out the rest"`.

#### Task 3a.3: The preview says what the bill goes to (D33)

**Files:**
- Modify: `apps/server/src/set-menu-regroup.ts` (a sibling of `totalLeftBehind`),
  `apps/server/src/adjustments-apply.ts` (`AdjustmentPreview`, `previewAdjustment` `:1190`),
  `apps/till/src/api/client.ts:998`, `apps/till/src/widgets/adjustment-dialog.ts:1001`,
  `apps/till/src/i18n/strings.ts`, `apps/till/src/widgets/test-helpers.ts:667`
- Test: `apps/server/src/set-menu-dish-adjustments.test.ts`, `apps/till/src/widgets/adjustment-dialog.test.ts`

**Interfaces:**
- `totalAfterAdjusting(tx, billId, rowsAfter: (line: GroupingLine) => GroupingLine[]): Promise<number>`
  in cents: the bill's rows as they will be once written — a released dish à la carte, a reduced one
  at its price and list price, a row an action splits as its two rows — then grouped, writing
  nothing. (Run: Soup and one row of two Hakes, 38.00, 10% off one Hake: the apply gives 28.40,
  because the Hake left is then one portion and joins the Soup; freezing the whole row says 36.40.)
- `AdjustmentPreview.billTotal: { before: string; after: string }`, for every action.

- [ ] **Step 1: Write the failing tests.** For each comp and discount case of Task 3a.2, and for a
  cancel, a whole-bill discount, one of a row of two Hakes beside a Soup (28.40) and an ordinary bill:
  `previewAdjustment`'s `billTotal.after` equals the bill's total after `applyAdjustment`, and the
  preview changes no row. In `adjustment-dialog.test.ts`: `billTotal` 14.00 to 20.40 with reduction
  1.60 draws "The bill goes from €14.00 to €20.40" and no "Takes … off"; 28.00 to 26.40 with 1.60
  draws today's line; 14.00 to 14.00 draws "The bill stays at €14.00" ("La cuenta sigue en …"); the
  first in Spanish ("La cuenta pasa de … a …").
- [ ] **Step 2: Run and see them fail:** Task 3a.2's command and `pnpm --filter @waitron/till exec vitest run src/widgets/adjustment-dialog.test.ts src/i18n/strings.test.ts` (check `memory_pressure | grep free` first; real Chromium).
- [ ] **Step 3: Implement**; open the dialog in both themes at phone width and look.
- [ ] **Step 4: Run** Step 2's commands, `src/adjustments-api.test.ts src/order-portions.adjustments.test.ts src/bill-editing.adjustments.test.ts src/line-cancel.test.ts` (whole preview shapes gain `billTotal`), the till's `adjustment-dialog*.test.ts`, `till-app-adjustments*.test.ts`, `till-app-counter-adjustments*.test.ts` and `api/client.test.ts` (their preview objects gain it) and both packages' typechecks.
- [ ] **Step 5: Commit** `git commit -s -m "Say what a comp or discount takes the bill to when its set menus change"`.

#### Task 3a.4: The other paths, the receipt and the paperwork

- [ ] **Step 1: Write the tests** in `set-menu-dish-adjustments.test.ts` (expected to pass; a failure
  is a defect): 10% off the Hake of a Daily, then that Hake moved to another bill of the party: it
  arrives at 14.40 with its list price, joins no set menu beside a Soup there, and the source's Soup
  is 6.00; the same through `mergeBills`, `splitTable` and Pay for items (preview and payment 14.40);
  printed and reopened (`splitAfterPrint`), it stays out of a Daily after a Soup is sent; the receipt
  of the first Task 3a.2 bill prints Daily 14.00, Soup 6.00, Hake 16.00 with Free −16.00, no other
  discount; a takeaway Lunch (`addSpecLunch`) with 50% off the Lemonade: the filed lines and VAT
  match the stored lines (run: Lemonade 1.75 at 21%, Lunch 14.00 at 10%); the Lemonade comped
  instead (run: 2.80 at 21% and 11.20 at 10%, the free item's share).
- [ ] **Step 2: Run** Task 3a.2's command and `src/receipt-adjustments.test.ts src/set-menu-ticket.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  (unedited); `pnpm exec vitest run scripts/product-file-size.test.ts scripts/errors-reachable.test.ts`.
- [ ] **Step 3: Measure** (CLAUDE.md §4, a throwaway worktree of the base): a comp on a 20-diner
  bill's dish, median and worst of ten, before and after; in the PR.
- [ ] **Step 4: Guides and backlog.** `rg -n -i "set menu|menú" apps/server/src/guide` for a sentence saying a set-menu dish cannot be comped or moves
  only with its set menu; change it in English and Spanish; and add to
  `table-service.md`'s Set menus section (both languages) one sentence: "A dish you comp or discount
  leaves its set menu and is charged à la carte, less what you take off." `docs/backlog/menu.md`
  A1515: 3a done, 3b, 3c and 4 left. `docs/developers/conventions-data.md` if it states the freeze.
- [ ] **Step 5: Commit** `git commit -s -m "Check discounted set-menu dishes on every path; record what is left"`.

### PR 3b0 — dropped

_2026-11-26: dropped by the owner's rule C (D45) before it was pushed. It made the shared
calculation keep a set menu's discount on the set menu it was given on (D41–D44); under rule C the
calculation is never handed a discount. Its last commit is `518ccd12f8`; the section as it was
written is in this file at `bbe95ebd14`._

### PR 3b — A set menu's comp or discount, and saying when a discount comes off (rule C)

Written 26 November against 3a's head (#4361, not yet on `main`). Its `file:line` citations were
moved the same day to that head after its rebase, `fa3d08f2f5`, and were read there, not run,
unless it says run; each is checked again once 3a lands. The rules are D45–D59. Prices are the spec
fixture's (`apps/server/src/testing/set-menu-spec-fixture.ts:78-92`): Daily 14.00 (Soup, Hake,
Sirloin +5.00), Special 20.00; à la carte Soup 6.00, Hake 16.00, Sea bass 19.00, Sirloin 24.00;
Bread 1.50 on the Soup. A lone Hake is a Daily at 14.00; a lone Soup is 6.00.

**How:** a set menu's discount is written as any comp is, so 2b's freeze keeps the set menu as it
is and the calculation never sees a discount (D49); what takes one off writes an ending on the bill
its rows are on (D47); a preview works an ending out without writing it (D59).

**What 3a does today against rule C:**

- Already rule C: a percentage is recorded (`adjustments.percent_bp`, `adjustments-apply.ts:1167`)
  but charged as an amount worked out when given (`requestedDiscount`, `:262-283`), and more of the
  dish goes on a new line at full price (`working-order-line-edits.ts:453-455`); a discounted dish
  moves and is paid for alone with its discount (Task 3a.4); fewer of it takes only that portion's
  share, which sits in its unit price (`spread`, `adjustments-apply.ts:331-345`).
- **Changed by 3b2:** changing a discounted dish's extras keeps its discount, since a stored line
  keeps its unit price (`working-order-line-edits.ts:114-116`, `:433-446`); a held order's save
  that changes a discounted dish's variant drops the stored line, discount and all, with no notice
  (D53).
- **Changed by 3b1:** a set menu's comp covers only its row, because its subjects are the row and
  its extras (`family`, `adjustments-apply.ts:597`) while its dishes are linked by
  `set_menu_line_id`, so Free on a Soup and Sirloin Daily leaves the +5.00 charged; and a dish
  leaving a comped Daily leaves the Daily behind, frozen and comped (D18), as does choosing every
  one of its dishes (D51).

**Size** (estimates from reading):

| PR | Product | Tests | Generated files | Tasks | Building |
| --- | --- | --- | --- | --- | --- |
| 3b1 | about +450, −40 | about +850; 5 behaviour checks change, and the pinned lists of tables | core's starting migration and `scripts/migration-baseline-epoch.json` | 7 | about 4 hours |
| 3b2 | about +250 | about +450; none changes (the new answer key is absent when empty) | none | 4 | about 3 hours |

**From `feat/a1515-3-menu-adjustments`** (on 3a at `b42f85de31`, never pushed; closed when 3b1
starts from `main`): `8234a633ec` (the holder columns), `1cd4d825c1`, `fcbe4edde9` and
`b42f85de31` (carrying a held discount through regroupings and back from a declined card, with
`left_set_menu_adjustment_id`) are dropped. Of `5e90544ac4`, only
`packages/orders-sales/src/set-menu-discount-shares.ts` and its test (about 50 lines) are kept, for
3c. Of `81ac849617`, only its three preview cases are kept, as tests in Task 3b1.2.

**Still unavailable after 3b:** typing an amount larger than what the till's comp window shows for
a set menu (`adjust.amount_too_large`, `apps/till/src/widgets/adjustment-dialog.ts:439`; A1515-4's
window), though Free and a percentage reach the supplements; a comp or discount on one dish of a
set menu that holds its own (3a's refusal, kept); changing the variant of a table bill's dish other
than by Cancel item and a new dish (D53); and every notice and choice drawn on the till (A1515-4).

**Fiscal gates, both PRs:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
src/write-path.e2e.test.ts` passes unedited. Neither PR changes how a filed line is built (from
reading: a discount is already filed as the amount on its lines).

### PR 3b1 — A set menu's comp or discount (`feat/a1515-3-menu-adjustments`, a new branch from `main`)

**What a person can do once it lands.** Comp or discount a set menu: it takes off the set menu's
price and its dishes' supplements, not their paid extras, and the set menu stays as it is while it
holds it; the receipt prints it under the set menu. A second one on the same set menu replaces the
first, and the preview says so (D52). Cancelling, moving or paying alone for some of its dishes
takes the discount off and works the bill out again (D48, D50); moving or paying for the whole set
menu, by its row or by choosing every one of its dishes, takes the discount with it (D51). Every
preview says what saving will do, the discount coming off included, and writes nothing (D59). A
free set menu on a takeaway ticket can be refunded. **Resets venues.** The server answers no notice
yet (3b2), and the till draws none until A1515-4.

`adjustments-apply.ts` is 1,206 lines against a cap of 1,250 (`scripts/product-file-size-limits.json:25`),
so new code goes in new files.

**Task sizes**, in tool calls (estimates from reading; each well under 100): 3b1.1a about 60, 3b1.1b
about 60, 3b1.2 about 50, 3b1.3a about 65, 3b1.3b about 75, 3b1.4 about 25, 3b1.5 about 50.

#### Task 3b1.1a: The record of a discount that came off (D47)

**Files:** Create `packages/db/src/schema/adjustments/adjustment-endings.ts` (`adjustment_endings`:
`id`; `adjustment_id`, a foreign key to `adjustments.id`; `working_order_id`, a foreign key, the
bill the adjustment's rows were on when it ended (D47); an index on those two; `why`:
`extras_changed`, `variant_changed`, `dish_cancelled`, `dish_moved`, `dish_paid_alone`,
`replaced` or `set_menu_cancelled`; `dish_name`, the dish that left or changed; `line_id`, the line
a notice offers it again on, for `extras_changed` and `variant_changed`, else null, with no key, as
`adjustment_lines.line_id` has none, for the reason stated at
`packages/db/src/schema/adjustments/adjustment-lines.ts:5-9`; `ended_at`) and
`adjustment_ending_lines` (`ending_id`, a foreign key to `adjustment_endings.id`;
`adjustment_line_id`, a foreign key to `adjustment_lines.id`, unique: each row given back once,
wherever it moves, since a move keeps line ids; D47 as revised after review), exported beside the
other adjustments tables. Create `packages/adjustments/src/endings.ts`: `endingRestores(tx, {
workingOrderId, adjustmentIds })`, which writes nothing and answers, for each row now on that bill
that those adjustments' `adjustment_lines` took something off, its unit price, line total and list
price once that is given back (the list price cleared once the price is back at it); and
`endAdjustment(tx, { adjustmentId, workingOrderId, why, dishName, lineId? })`, which records the
ending and the rows it gives back, then writes exactly what `endingRestores` answers, and refuses
`adjustment.not_standing` when it would give nothing back. Modify
`packages/db/src/schema/adjustments/adjustments.ts` (`reapplies_adjustment_id`, a foreign key to
its own `id`, for 3b2, so only 3b1 resets venues). _2026-11-26: 3b2 resets venues too, for the index its finish review added._

The new append-only table goes everywhere `adjustment_lines` is named (CLAUDE.md §3: a new
append-only table travels in its set's migration descriptor and the manifest):
`packages/db/src/classification.ts` (`appendOnly(..., "ledger", ...)` after `adjustment_lines`,
`:398-402`; `CORE_MIGRATIONS` derives its list from it, `packages/db/src/migrations.ts:16-20`);
`packages/migrations/migrations.manifest.json` (core's `appendOnlyTables`, `:28-30`);
`ADJUSTMENTS_TABLES` (`packages/adjustments/src/classification.ts:4-9`) and its pins
(`packages/adjustments/src/classification.test.ts:18`, `:28`, `:36`;
`packages/composition/src/composition.test.ts:396-401`); `FOLDED_APPEND_ONLY` and its `ROWS`
(`packages/db/src/classification.test.ts:105-156`); `immutableTables`
(`packages/adjustments/src/backup-verification.ts:10`, pinned at `backup-verification.test.ts:147`);
`EXPECTED` (`scripts/append-only-triggers.test.ts:34-37`); and `scripts/schema-constraints.test.ts`
(`EXPECTED_FOREIGN_KEYS`, `:51`, and the unique indexes, `:325`). Generated by `pnpm --filter
@waitron/server migration-baseline rebuild --set core`.

- [ ] **Tests first** (`packages/adjustments/src/endings.test.ts` and the pins above): 10% on an à
  la carte Hake (14.40) ended: 16.00, no list price, one ending on that bill, and `endingRestores`
  answered the same beforehand and wrote nothing; a row of two à la carte Hakes at 10%, one moved to
  another bill of the party: ending it there gives back only that Hake, ending it there again is
  refused `adjustment.not_standing`, and ending it on the first bill is accepted; the new foreign keys in
  `EXPECTED_FOREIGN_KEYS`; the table in each pinned list.
- [ ] **Run them failing**, implement, rebuild, then `pnpm exec vitest run
  scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts
  scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts`; `pnpm --filter
  @waitron/adjustments exec vitest run src/endings.test.ts src/classification.test.ts
  src/backup-verification.test.ts`; `pnpm --filter @waitron/db exec vitest run
  src/classification.test.ts`; `pnpm --filter @waitron/composition exec vitest run
  src/composition.test.ts`; `pnpm --filter @waitron/migrations exec vitest run
  src/apply-append-only.test.ts`; `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (if it
  names the table as missing, add it to `ADDED_TABLES`, `:484-491`); the fiscal gates; and `pnpm
  --filter @waitron/db typecheck`. If backup verification refuses the new column, add
  `reapplies_adjustment_id: null` to `addedAdjustmentColumns` (`backup-verification.ts:11-16`).
  Commit `git commit -s -m "Record when a comp or discount comes off a bill (A1515-3 3b1)"`.

#### Task 3b1.1b: Readers leave an ended discount out, and a preview can work one out (D47, D59)

**Files:** `apps/server/src/set-menu-freeze.ts` (`reducedLineIds`, `:45-65`: leaves out a row whose
adjustment has an ending on the bill its line is on now; `frozenLineIdSources`, `:16`, takes
`ending?` and leaves those adjustments' rows out as well); `packages/adjustments/src/record.ts`
(`readReasonStanding`, `:98`, the same rule; `readBillAdjustments`, `:145`, see D47's
2026-11-26 note); `apps/server/src/free-items.ts` (`listFreeItems`, `:119`:
its reduced rows, `:149-182`, the same rule); `apps/server/src/adjustment-rows.ts` (`readRows`,
`:71`, takes `ending?` and lays `endingRestores`' rows over what it reads);
`apps/server/src/set-menu-regroup.ts` (`totalAfterAdjusting`, `:341`, and `regroupDropAfter`,
`:282`, take `ending?`, lay the rows over the read ones and hand it to `planGrouping`'s freeze,
`:122-133`); `apps/server/src/adjustments-apply.ts` (`planAdjustment`, `:527`, passes `ending?` to
`readRows`, nothing else). Test: `apps/server/src/set-menu-discount-ending.test.ts` (new).

- [ ] **Tests first:** Free on a Soup and Hake Daily, ended: the freeze no longer names the Daily
  (a Soup sent next still finds the Daily formed, at 14.00), the reason's standing on the bill is
  0.00, `readBillAdjustments` leaves it out and the corrections report's free items leave it out;
  the same Daily not ended but read with `ending` naming the Free: `totalAfterAdjusting` answers
  14.00, the freeze leaves the Free's rows out, and every row and `adjustment_endings` are as they
  were; an ending on a bill holding none of its rows is refused, leaving this bill's readers as
  they were.
- [ ] **Run them failing**; implement; drop the ending rule from `reducedLineIds` and see the
  freeze case fail; restore. Run `pnpm --filter @waitron/server exec vitest run
  src/set-menu-discount-ending.test.ts src/set-menu-regroup.test.ts src/set-menu-adjustments.test.ts
  src/set-menu-dish-adjustments.test.ts src/free-items.test.ts src/adjustments-apply.test.ts`, `pnpm
  --filter @waitron/adjustments exec vitest run src/record.test.ts`, both typechecks. Commit `git
  commit -s -m "Leave a discount that came off out of what reads a bill's discounts"`.

#### Task 3b1.2: A set menu's comp or discount covers its supplements; a second one replaces it (D49, D52)

**Files:** Create `apps/server/src/set-menu-adjustment.ts` (the set menu's rows; the replacement)
and `apps/server/src/set-menu-discount-apply.test.ts`. Modify `apps/server/src/adjustments-apply.ts`
(`family`, `:597`: for a set-menu row, the row and the dishes placed in it charged above 0.00; a set
menu holding a standing comp or discount has it ended, `replaced`, in the apply's transaction before
the new one is worked out; `previewAdjustment`, `:898`, plans with `ending` naming it instead,
writing nothing (D59), and answers `replaces?: { action, percentBp, amount }`, absent otherwise, so
no whole preview shape changes); `apps/till/src/api/client.ts` (`AdjustmentPreview` gains
`replaces?`, the type only).

- [ ] **Tests first**, each asserting the rows, the total, the recorded before, after and
  reduction, and that the preview's `billTotal.after` equals the apply's total:
  - A Soup and Sirloin Daily (19.00): Free gives 0.00 (row 0.00 with list 14.00, Sirloin 0.00 with
    list 5.00), recorded 19.00, 0.00, 19.00; 10% gives 17.10 (12.60 and 4.50); 18.00 off gives
    1.00 (0.74 and 0.26: by hand, 18.00 × 14/19 = 13.26 and 18.00 × 5/19 = 4.74).
  - A Soup with Bread and a Hake, 10% on their Daily: the Bread stays 1.50, 14.10.
  - 10% then 20% on one Soup and Hake Daily: 11.20; the 10% ended `replaced`; the second preview
    answers `replaces` with amount "1.40" and leaves the 10% standing (no ending written).
  - The receipt of the Free case prints Free −19.00 under the Daily and its lines add up with no
    per-dish fallback (`receipt-adjustments.ts:270-285`). Expected to pass.
  - A takeaway Lunch (`addSpecLunch`) with 50% on the Lunch: the filed lines and VAT match the
    stored lines. Expected to pass.
  - `81ac849617`'s cases: 10%, 100% and 2.00 off the whole of a bill whose Daily holds 10%: the
    preview answers what the apply leaves.
- [ ] **Run them failing**; implement; take the dishes out of `family` again and see the Sirloin
  case fail; restore. Run `src/adjustments-apply.test.ts src/order-portions.adjustments.test.ts
  src/adjustments-api.test.ts src/set-menu-adjustments.test.ts src/set-menu-dish-adjustments.test.ts`.
  Commit `git commit -s -m "Take a set menu's comp or discount off its supplements too"`.

#### Task 3b1.3a: A cancel that breaks a discounted set menu takes the discount off (D48)

**Files:** Create `apps/server/src/set-menu-discount-ending.ts`: `setMenuDiscountsLeftBy(tx, billId,
dishIds)`, which writes nothing and answers `broken`, the standing comp or discount of each set menu
(an adjustment whose `line_id` is that set-menu row) that some but not all of its dishes leave by
`dishIds`, and `whole`, each set menu whose row a standing comp or discount reduced and whose every
dish is among `dishIds` (D51, used by 3b1.3b); and `endSetMenuDiscounts(tx, billId, broken, why)`,
which ends each with `endAdjustment` (`set_menu_cancelled` when a cancel takes its last dish).
Called before the removal on each path D48 names, and on no other:

- the comp window's cancel (`applyAdjustment`, `adjustments-apply.ts:1097-1127`): ended before
  `planAdjustment` runs, so the plan and `regrouped` are read after the ending;
- its preview (`previewAdjustment`, `:898-913`): planned, and `regroupDropOfRemoval`
  (`working-order-removal.ts:414`, which reaches `regroupDropAfter`) and `billTotalOf`
  (`adjustment-bill-total.ts:36`) worked out, with `ending` naming them, writing nothing (D59);
- Cancel item's unrecorded removal (`line-cancel.ts:317`, `:327`);
- Reopen to split's `takeOffCopies` (`split-after-print.ts:274`), the ending on the reopened bill;
- a held order's save that drops an unsent dish (`applyLineEdits`, `working-order-line-edits.ts:1159-1173`;
  only `saveHeldOrderIn` removes through it, `working-order-held-write.ts:160-167`); if the comp
  window cannot give a set menu on a held order a discount, the PR says so and this call is left
  out.

- [ ] **Tests first** (`set-menu-discount-ending.test.ts`):
  - A Soup and Hake Daily at 50% (7.00), the Hake cancelled in the comp window: the 50% ended
    (`dish_cancelled`, "Hake"), the Soup 6.00, the cancel records 8.00.
  - Free on a Soup and Sirloin Daily (0.00), the Sirloin cancelled: the Free ended, the cancel
    records 13.00 (19.00 − 6.00), the bill 6.00 (D48).
  - Free on a Soup and Hake Daily (0.00), the Hake cancelled: the cancel's 8.00 accepted by
    `adjustments_amounts_ck`; then the Soup cancelled too: 6.00 recorded, nothing more ended.
  - A lone Hake Daily at 10% (12.60), the Hake cancelled: ended `set_menu_cancelled`.
  - For each of those four: the preview answers the reduction and the `billTotal.after` the apply
    then gives, and leaves every row and `adjustment_endings` as they were.
  - The 50% case through Cancel item with no reason (an unstarted Hake): ended the same.
  - A printed bill with that 50% Daily, its Hake unserved, reopened stopping unserved dishes: the
    ending is on the reopened bill, whose Soup is 6.00.
  - A held counter order holding a 50% Daily, saved without its Hake: ended, the Soup 6.00.
  - **Pins:** a dish's own cancel (3a) and an ordinary bill's cancel, preview and apply, unchanged
    (D24).
- [ ] **Run them failing**; implement; drop the comp window's call and see the 50% case keep the
  Soup in a frozen Daily; move it after `planAdjustment` and see the Sirloin case record 8.00;
  restore. Run `src/set-menu-discount-ending.test.ts src/line-cancel.test.ts
  src/split-after-print.set-menus.test.ts src/working-order-held-write.test.ts
  src/adjustments-apply.test.ts src/set-menu-dish-adjustments.test.ts`. Commit `git commit -s -m
  "Take a set menu's discount off when one of its dishes is cancelled"`.

#### Task 3b1.3b: Moving or paying for some, or every one, of a discounted set menu's dishes (D50, D51)

**Files:** `apps/server/src/set-menu-discount-ending.ts` (from 3b1.3a). Modify:

- `resolveMoveLines` (`bill-actions.ts:208-261`): adds each set menu `setMenuDiscountsLeftBy`
  answers in `whole` as if its row were named, so its dishes go with it (D51); `takesEveryDish`
  (`:266-293`) then sees it gone.
- `moveOrderLines` (`working-order-transfer.ts:84`): before its loose dishes' refusal (`:144-155`)
  and before any row moves, ends each set-menu discount its loose dishes break, `dish_moved`, or
  `dish_paid_alone` when Pay for items' move says so through `moveDishes`' options
  (`bill-actions.ts:336`; `pay-for-items.ts:246`). This serves Move dishes, a table split's loose
  dishes (`table-actions.ts:383`, `:430`) and Pay for items (`moveItemsToNewBill`,
  `pay-for-items.ts:220`). A merge moves every line, so nothing ends.
- `readPicks` (`pay-for-items.ts:85-188`), writing nothing: counts a `whole` set menu as picked (in
  `ids`, so `taken` and the all-items check, `:164-171`, see it go), and hands `broken` as `ending`
  to `priceItemPicks`' `totalOnOwnBill` and `totalLeftBehind` (`:199-210`; `set-menu-regroup.ts:309-334`).
- `refuseMovingFrozenDishes` (`set-menu-moves.ts:19-66`) and a set-menu dish's `movable`
  (`placedSetMenuDishes`, `set-menu-bill.ts:337-383`) stop counting a reduction made by a set
  menu's own standing comp or discount, so a Sirloin whose supplement it took moves alone.

- [ ] **Tests first** (`set-menu-discount-ending.test.ts`):
  - The Sirloin of a 10% Soup and Sirloin Daily (17.10) moved alone to another bill of the party:
    not refused; ended `dish_moved` on the source; the source's Soup 6.00; the Sirloin a Daily of
    its own there at 19.00. The same through `splitTable`'s loose dishes.
  - That Daily moved whole, by its row; by naming both its dishes; and in `mergeBills`: it arrives
    holding its 10% at 17.10, nothing ended; a Soup and a Hake sent there make their own Daily at
    14.00 (D51).
  - Pay for items, the Sirloin alone: the preview prices it at 19.00 and leaves 6.00, writing no
    ending; paid in cash, the same figures and ended `dish_paid_alone`; by card and declined, the
    Sirloin comes back and the discount stays ended: 19.00 (D50).
  - Pay for items, both dishes of that Daily with a Water left behind: preview and payment 17.10,
    nothing ended; by card and declined, the Daily comes back holding its 10%.
  - A Daily on a bill discounted 10% as a whole, both its dishes moved: it moves whole with its part
    of the discount (D51, until 3c).
  - **Pins:** a Daily frozen by a kept-charge cancel still refuses moving its dish alone, and its
    every dish named (`set_menu.moves_with_set_menu`); 3a's pin "still takes nothing off a dish of
    a comped Daily" (`set-menu-dish-adjustments.test.ts:660`) passes unchanged.
- [ ] **Run them failing**; implement; take `whole` out of `resolveMoveLines` and see the
  both-dishes Move dishes case end the 10%; restore. Run `src/set-menu-discount-ending.test.ts
  src/set-menu-regroup-moves.test.ts src/pay-for-items.set-menus.test.ts src/move-dishes.test.ts
  src/set-menu-bill.test.ts src/set-menu-bill-moves.test.ts src/split-table.fiscal.test.ts
  src/party-table-actions.test.ts`; the Task 3b1.5 checks are expected to fail here, as listed
  there. Commit `git commit -s -m "Take a set menu's discount off when some of its dishes leave, and
  along when all do"`.

#### Task 3b1.4: A free set menu on a takeaway ticket can be refunded (watcher, 26 November 00:20)

Found by lane B (questions.md, "LANE B 2026-11-26 00:45"; run in a scratch test on
`b42f85de31`): on a settled takeaway ticket with a Free Daily (Soup and Sirloin) and a Water at
21%, Cancel and refund of the Water is refused `tab.free_item_with_dish` (`served`). The grouping
writes every set-menu row as served (`servedQuantity: 1000`, `apps/server/src/set-menu-regroup.ts:162`),
and the free-item check refuses a free item that has been served (`freeItemsComingBack`,
`apps/server/src/line-cancel.ts:618`). On `main` the same follows from a comp on the set menu's own
row (lane B's reading, not run). Eat-in bills are not affected. The watcher: fix it here, with a
test of that ticket.

**Files:** `apps/server/src/line-cancel.ts` (`freeItemsComingBack`, `:605-629`: a set-menu row is
not counted as a served free item; its dishes' own served state counts, as any dish's does). Test:
`apps/server/src/free-item-cancel.test.ts`.

- [ ] **Test first:** that ticket: the Water's refund goes through and brings the free Daily back
  with it, the amounts as its filed lines give them; the Sirloin's own refund is still refused
  `free_item`; an eat-in bill's case passes unchanged.
- [ ] **Run it failing**, implement, run `src/free-item-cancel.test.ts src/finish-party-service.test.ts`.
  Commit `git commit -s -m "Let a free set menu on a takeaway ticket come back with its paid dish"`.

#### Task 3b1.5: The tests whose checks change, the guide, the backlog and the PR

Expected to change, read at `fa3d08f2f5`; each new figure is worked out by hand and listed in the
PR, and a failure the rules do not explain is a stop:

- `set-menu-regroup-moves.test.ts:328` "moves a dish with no comp of its own out of a comped Daily,
  which stays on its bill (D18)": the Hake moved alone ends the comp (`dish_moved`); the source is
  the Soup at 6.00; the target's Hake Daily is unchanged.
- `pay-for-items.set-menus.test.ts:381` ("… out of a comped Daily, which stays"): still priced and
  paid at 14.00; the source is left the Soup at 6.00, not a comped Daily.
- `pay-for-items.set-menus.test.ts:680` ("… a comped Daily whose own dishes have left, which
  stays"): the move of both dishes now takes the Daily with them (D51), so the Water is all the bill
  holds and paying for it is refused `bill.all_items_chosen`; rewritten to pin that, the other bill
  holding the Daily at 0.00.
- `pay-for-items.set-menus.test.ts:755` ("counts what a comped Daily keeps of its dishes at
  0.00"): the Hake and a Water chosen now break the Daily, so the bill keeps the Soup at 6.00 and a
  Water: accepted, priced 16.00, the bill left 8.00 against advances of 3.00.
- `move-dishes.test.ts:1283` ("… every dish leaves a comped set menu, whose row stays …"): the
  Daily now goes with its dishes, so the move empties the bill and asks the invoice question:
  refused `bill.merge_invoice_choice_required` without a choice and moved with one, the other bill
  holding the comped Daily.
- Passing unchanged, as pins of D51: `pay-for-items.set-menus.test.ts:666` (every dish of a comped
  Daily that is the whole bill is still `bill.all_items_chosen`) and `:397` (the comped Daily
  chosen by its row).
- Whole `adjustments` row shapes gain `reappliesAdjustmentId`.

- [ ] **Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-adjustments.test.ts
  src/set-menu-regroup.test.ts src/set-menu-regroup-moves.test.ts src/pay-for-items.set-menus.test.ts
  src/move-dishes.test.ts src/split-after-print.set-menus.test.ts src/set-menu-dish-adjustments.test.ts
  src/receipt-document.set-menus.test.ts src/receipt-adjustments.test.ts`; change what fails as listed.
- [ ] **Guide**, in the Set menus section of `apps/server/src/guide/en/table-service.md` and its
  Spanish twin: "A comp or discount on a set menu covers its price and its supplements, not paid
  extras. If some of its dishes are cancelled, moved or paid for on their own, the discount comes
  off; moving or paying for all of them takes it along." / "Una invitación o un descuento en un menú cubre su precio
  y sus suplementos, no los extras de pago. Si se anulan, se mueven o se pagan aparte algunos de sus
  platos, el descuento se quita; si mueves o pagas todos, se va con ellos." Run
  `src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts
  scripts/product-file-size.test.ts scripts/errors-reachable.test.ts`.
- [ ] **Backlog** (`docs/backlog/menu.md`, A1515): 3b1 done in one sentence; left 3b2, 3c and piece
  4, whose till counts a discounted set menu as going with its last chosen dish (D51).
- [ ] **PR body**, first line: "Resets venues: core's starting migration is rebuilt
  (`adjustment_endings` and `adjustments.reapplies_adjustment_id` are new), so every box must be set
  up again." Then D45–D52, D58 and D59, the changed tests with old and new figures, and the deletion
  results. Commit `git commit -s -m "Say how a set menu's comp or discount works; record what is left"`.

### PR 3b2 — Saying when a discount came off (`feat/a1515-3-discount-notices`)

**What a person can do once it lands.** Changing the extras of a dish that has its own comp or
discount, or its variant in a held order's save, takes the discount off, and the dish is worked out
with the bill again (D53). Every bill answers a notice for each discount that came off this way or
when its set menu broke up: what it was, where, why, and what to give it again on; giving it again
through the comp window names the notice and clears it (D54). The adjustments report leaves out a
discount that came off (D55). The till draws the notice in A1515-4 (another lane); this PR is what
it reads. _2026-11-26, at finish review: an index on `adjustment_endings(working_order_id)` was added
for the notice read, so 3b2 resets venues (watcher, "WATCHER 2026-11-26 21:42")._

_2026-11-26, at finish review: only the changed dish's share of the discount comes off, and another
portion it covers keeps its share; a notice's amount is what came off that bill, not what the
discount took off when given; a dish's notice is given again only on a line it came off; and the
report counts what still stands of a partly ended discount, leaving out only one wholly given
back._

**What the server provides for A1515-4:** on every bill in the party read (`parties.ts:650`) and the
counter order read (`working-order-held-read.ts:497`), `discountNotices?: { adjustmentId; why;
dishName; on: string; action: "comp" | "discount_percent" | "discount_amount"; percentBp: number |
null; amount: string; reasonId: string; reapplyOn: { lineId: string } | null }[]`, absent when there
is none; the comp window's preview for those terms on `reapplyOn`, which works the amount out on the
new price (a percentage of it, Free the whole of it; an amount the waiter types); and `reapplies`
on the apply and preview routes.

#### Task 3b2.1: Changing a discounted dish's extras or variant takes its discount off (D53, D56)

**Files:** `apps/server/src/working-order-line-edits.ts` (`applyLineEdits`, where `extrasChanged` is
worked out, `:433-446`: a dish whose own comp or discount stands, on the dish or on one of its
extras, has it ended, `extras_changed`, with `line_id` the dish; a part of a whole-bill discount is
kept, D56; and each variant swap it is handed is ended `variant_changed`, with `line_id` the new
line, once that line is written and before the bill is regrouped, `:1174`);
`apps/server/src/working-order-held-write.ts` (`saveHeldOrderIn`, `:128-148`: hands `applyLineEdits`
each new line that names a stored line of the same menu item with another variant, D53). The edits
file is 1,187 lines against 1,250 (`scripts/product-file-size-limits.json:39`), so the checks go in
`apps/server/src/dish-discount-ending.ts`. Test: `apps/server/src/dish-discount-ending.test.ts`.

- [ ] **Tests first:**
  - An à la carte Soup at 50% (3.00) given Bread: ended, the Soup 6.00 and the Bread 1.50.
  - A Soup with Bread comped (both 0.00), the Bread removed: ended, the Soup 6.00.
  - A Soup taken out of its Daily by 50% (3a), beside a lone Hake Daily, given Bread: ended, and the
    Soup rejoins the Hake's Daily: 15.50.
  - A note or an options answer changed: kept. A quantity raised: kept, the new unit at full price
    (R12, as today).
  - A Soup on a bill discounted 10% as a whole given Bread: its part kept, the Bread 1.50 (D56).
  - A held counter order's dish at 10%, saved naming it with the same menu item at another variant
    (a menu item with two variants, as the tests under `working-order-held-write.test.ts:1733-1737`
    build one): ended `variant_changed`, its `line_id` the new line, which is at its own full price;
    the same save naming another menu item instead: no ending row, the discount gone with the
    removed line (rule C's cancel). A dish of a held order's 50% Daily swapped the same way: the
    Daily's discount ended `variant_changed`.
  - Fewer of it: a row of three Sea bass (à la carte, 19.00 each; a lone one costs more in a
    Special) with 5.00 off, one cancelled: the cancel takes only that portion's share, as recorded on
    its row. Expected to pass.
- [ ] **Run them failing**, implement, run `src/working-order-line-edits*.test.ts
  src/working-order-held-write.test.ts src/set-menu-dish-adjustments.test.ts`. Commit `git commit
  -s -m "Take a dish's own discount off when its extras or variant change"`.

#### Task 3b2.2: The bill answers its notices; giving a discount again clears one (D54)

**Files:** `packages/adjustments/src/endings.ts` (`readDiscountNotices(tx, billIds)`: each ending
recorded on one of those bills (`adjustment_endings.working_order_id`, D47) whose `why` is
`extras_changed`, `variant_changed`, `dish_cancelled`, `dish_moved` or `dish_paid_alone` and that
no adjustment on that bill names in `reapplies_adjustment_id`, with the ended adjustment's action,
percentage, recorded reduction, reason and line name); `apps/server/src/discount-notices.ts`
(`reapplyOn`: the ending's `line_id` for a change of extras or variant; for a set menu, the set-menu
row its dishes still on the bill now share, else the one dish left, else null; and no notice at
all once nothing it covered is left on the bill; _2026-11-26: superseded by D54's 20:07 note: a set menu's notice names no place and stays until the bill closes._); `parties.ts:650` and
`working-order-held-read.ts:497` (answer it); `apps/server/src/adjustments-api.ts` (`parseAsk`,
`:52-90`, takes `reapplies`: an adjustment with an ending recorded on this bill whose notice is
open, else `management.request_invalid`; `applyAdjustment` records it); `apps/till/src/api/client.ts`
and `packages/shared` (the types only).

- [ ] **Tests first** (`apps/server/src/discount-notices.test.ts`): after Task 3b1.3a's 50% case, one
  notice (`dish_cancelled`, "Hake", on "Daily menu", 50%, 7.00, `reapplyOn` the Soup; _2026-11-26: superseded by D54's 20:07 note: a set menu's notice names no place and stays until the bill closes._), and the
  preview of 50% on the Soup answers 3.00 off; applied with `reapplies`, the notice is gone. After
  Task 3b2.1's first case: `extras_changed` on the Soup, and 50% previews 3.75 off 7.50; after its
  variant case, `variant_changed` with `reapplyOn` the new line. Free on a Soup and Hake Daily, the
  Hake cancelled (a notice offering Free on the Soup), then the Soup cancelled: no notice (_2026-11-26: superseded by D54's 20:07 note: a set menu's notice names no place and stays until the bill closes._). The
  Sirloin of a 10% Daily moved alone to another bill: the notice is on the source, not on the bill
  it went to; the whole Daily moved, then its Sirloin cancelled there: the notice is on that bill,
  and `reapplies` naming it is accepted there and refused on the bill it was given on. A
  replacement, a set menu cancelled whole and a dish's own cancel give none. `reapplies` naming a
  standing adjustment, one ended only on another bill, or one already given again is refused. A
  bill with no notice answers no key.
- [ ] **Run them failing**, implement, run `src/parties*.test.ts src/working-order-held-read*.test.ts
  src/adjustments-api.test.ts` and the till's `api/client.test.ts`, with both typechecks. Commit
  `git commit -s -m "Say on each bill which discounts came off and offer to give them again"`.

#### Task 3b2.3: The report leaves out a discount that came off (D55)

**Files:** `packages/adjustments/src/reports.ts` (`readReportRows`, `:292-317`, leaves out an
adjustment with an ending; `readEntryRows`, `:323`, still lists it). Test:
`packages/adjustments/src/reports.test.ts`.

- [ ] **Tests first:** 10% then 20% on one Daily counts 2.80; a 50% Daily whose Hake is cancelled
  counts the cancel's 8.00 and not the 7.00; the drill-down still lists all four entries: the 10%
  and the 20% on the first bill, the 50% and the cancel on the second.
- [ ] **Run them failing**, implement, run the package's tests and typecheck. Commit
  `git commit -s -m "Leave a discount that came off out of the adjustments report"`.

#### Task 3b2.4: The backlog and the PR

- [ ] `docs/backlog/menu.md`, A1515: 3b done; left 3c and piece 4, whose till draws the notice
  (A1515-4). The guide's Set menus sentence from Task 3b1.5 gains, in both languages: "If you change
  a discounted dish's extras or variant, its discount comes off." / "Si cambias los extras o la
  variante de un plato con descuento, el descuento se quita." _2026-11-26, at finish review:_ the
  sentence went in the comps section instead, covering comps and a variant changed in a parked
  order, and saying it comes off that dish; the till does not show the notice until A1515-4.
- [ ] PR body: first line "Resets venues: …" (the finish-review index); D53–D56 as cleared; what A1515-4 reads. Commit
  `git commit -s -m "Record what is left of A1515-3 after 3b"`.

### PR 3c — A whole-bill discount as the set menus change (`feat/a1515-3-bill-discounts`)

Written 26 November; replaces the 3c-1 and 3c-2 scope the owner cleared on 25 November (D38), of
which rule C withdraws 3c-2. It gets its task steps on this page against `main` as 3b2 leaves it,
and the watcher clears them.

**What a person can do once it lands.** A comp or discount on the whole of a bill with set menus no
longer stops its set menus being worked out: each dish keeps its own part through them, a dish
cancelled, moved or paid for alone takes its part (the owner's answers of 25 November 20:02, D38),
and a dish ordered later pays full price (rule C). Plain bills are unchanged.

**Today** (read, not run, at `fa3d08f2f5`): a whole-bill discount is an amount when it is given, a
percentage being taken off the bill as it stands (`requestedDiscount`,
`adjustments-apply.ts:262-283`); it is shared over the bill's rows in proportion to what each costs
then (`spreadReaching`, `:313-330`; `~/waitron-campaign-shared/discount-review-2026-10-28.md:34`)
and written per row in `adjustment_lines` (`:1177-1187`), which keep naming a moved row, since it
keeps its id (`working-order-transfer.ts:178-187`), and are copied to a split's new rows
(`carryLineReductions`, `order-portions.ts:143-167`). On a bill with set menus each part freezes the
set menu it lands on (D2; `set-menu-regroup.test.ts:619`, "writes nothing on a bill discounted as a
whole").

**How:** when given, a set menu's part is shared between its dishes by their à la carte prices and
written on each dish, a dish charged 0.00 included (lane B's example and prices, `questions.md`
25 November 20:20: 5.00 off a Soup and Hake Daily and a Wine at 8.00 gives the Soup 0.87, the Hake 2.31 and the
Wine 1.82). The freeze stops counting a part of a whole-bill discount. Each regrouping takes the
parts a set menu's dishes carry off that set menu, shared over its row and its supplements
(`set-menu-discount-shares.ts`, reused from `5e90544ac4`), and an à la carte dish's part off
itself; a set menu never goes below 0.00 (the 20:20 note's one edge, left unbuilt). A set menu with
its own discount stays frozen as 3b1 left it. A dish's part stays through a change of its extras
(D56).

**What a row of `adjustment_lines` then means, and the readers that assume the old meaning.**
Today a row says what a comp or discount took off that line's own price. After 3c, a whole-bill
discount's row on a dish in a set menu is that dish's part, which each regrouping takes off the set
menu's row, not off the dish. 3c's task steps change or pin each of these (read, not run):

- **The freeze** (`reducedLineIds`, `apps/server/src/set-menu-freeze.ts:45-65`, which also gives a
  set-menu dish's `movable`, `set-menu-bill.ts:357`, and feeds `refuseMovingFrozenDishes` and the
  grouping): it freezes any line with a row above 0.00, so every dish holding a part would freeze its
  set menu. 3c leaves out the rows of an adjustment on the whole bill (`adjustments.line_id` null),
  and a set menu row the grouping lowers by parts must not freeze by its price either
  (`frozenLinesOf`'s below-the-list-price rule, `packages/orders-sales/src/set-menu-grouping-plan.ts:83`,
  `belowListPrice`, `:104`).
- **The reason's standing on the bill** (`readReasonStanding`, `packages/adjustments/src/record.ts:98`,
  read by `judgeComp` at `adjustments-apply.ts:803`): it sums the reason's rows on lines now on the
  bill, scaled by quantity now over quantity then (`standingOff`, `packages/adjustments/src/policy.ts:255`).
  Unchanged: that is what the reason still has standing on the bill once a dish takes its part
  away. Test: 5.00 off the 20:20 bill, the Hake moved away: 2.69 standing.
- **The receipt's add-up check** (`receipt-adjustments.ts:242-282`): it takes the bill's list prices
  less each standing record's recorded reduction and prints the records only when that equals what
  the bill charges. Once a part leaves with its dish, or sits on a dish while the set menu's row
  carries it, the two differ and the receipt falls back to per dish. 3c counts a whole-bill record
  as the parts its rows on this bill hold, and the grouping stamps a set menu row it lowers by parts
  with its price before them as list price, so the check sees it. Test: the 20:20 bill's receipt
  prints 5.00 off the bill, and 2.69 once the Hake has moved away, with no per-dish fallback.
- **The corrections report's free items** (`listFreeItems`, `apps/server/src/free-items.ts:119`):
  it values each row of a Free at its line's price and rates, a takeaway set-menu row at its set
  menu's highest rate and its dishes apart (`:183-210`). A whole-bill Free's part on a dish in a
  takeaway set menu would then be valued at the dish's own rate; 3c values it at the rate of the set
  menu row it is taken off. Test: a whole-bill Free on a takeaway Lunch, against its filed lines.
- **Copies and splits** (`carryLineReductions`, `order-portions.ts:143-167`): it copies every row
  of a line to its copy or split part, its quantity then unchanged. Unchanged; the regrouping reads
  a part as its reduction times quantity now over quantity then, as `standingOff` does, so a split
  dish's two rows do not count it twice. Test: a row of two Soups holding a part, one paid for alone.

**Tasks:** 3c.1, the parts written per dish when given (the 20:20 example as its test); 3c.2, the
grouping takes the parts off set menus and the freeze stops counting them (tests: the Hake of that
bill moved away, 11.69 there and 11.31 left, as the 20:20 note works out; the Soup cancelled; a
dish sent afterwards at full price; and the readers' tests above); 3c.3, the existing checks that pin a frozen set menu under a
whole-bill discount (`set-menu-regroup.test.ts:619`, `set-menu-adjustments.test.ts:144`,
`set-menu-regroup.test.ts:683` and those `rg "discounted as a whole|whole-bill"` finds), the guide,
the backlog and the PR. **Size:** about +300 product and +500 tests, about 18 existing checks
changing (lane B's estimate of 25 November less the 12 plain-bill checks only 3c-2 would have
changed), about 3½ hours with the receipt's and the free items' changes; no schema change, believed from reading (the parts live in
`adjustment_lines`). The fiscal gates as for 3b.

## PR 4 — no longer needed (2026-11-26, D57)

_2026-11-26: what PR 4 was to do is done elsewhere or no longer wanted:_

- _A discounted dish moves alone with its discount: 3a (Task 3a.4's cases)._
- _Both bills are worked out again on every move path, with a test per path: 2b (Task 2b.4)._
- _`set_menu.move_adjusted` goes: after 3b1 it no longer refuses a dish of a set menu holding its
  own discount (the discount comes off, D50), and after 3c a part of a whole-bill discount freezes
  nothing; what is left of it refuses a dish whose extra was cancelled keeping its charge or had its
  service cancelled (`set-menu-moves.ts:56-65`), which is not a discount._
- _Moving "a set menu with its dishes" stays (`resolveMoveLines`, `bill-actions.ts:208`), and
  choosing every one of its dishes now does the same for a discounted one: rule C moves a set
  menu's discount with it (D51), against the spec's section 7, which kept it on its bill._

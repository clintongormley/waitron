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
| 2. The bill works out its set menus (`feat/a1515-3-regroup`) | A waiter adds dishes from anywhere; the bill forms the cheapest set menus by itself on every send, add, edit, cancel, split and move, and every till shows the same answer. No counts, no "No place for this dish" question. Anything already comped, discounted or paid for by item stays as it was saved (D2). Built as 2a, 2b and 2c (see its section). | 1 |
| 3. Comps and discounts (`feat/a1515-3-adjustments`) | A dish with its own comp or discount is charged à la carte less it, and the rest regroups; a set menu's discount takes off that menu's price and supplements, one per menu, and falls away with a notice when the bill has no menu of that type left; a whole-bill discount stays its percentage or its amount as the bill regroups. | 2 |
| 4. Moving dishes with their discounts (`feat/a1515-3-moves`) | A discounted dish moves to another bill alone, with its discount; both bills regroup; moving "a set menu with its dishes" is gone. | 3 |

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
dishes (PR 4), set menus on takeaway (D14, until VAT piece B) and at the counter eaten in (piece 6).
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
| 2b. The switch (`feat/a1515-3-regroup`) | Every path that changes a bill's dishes regroups; counts, the remove and in-bill move routes, placing at send and the no-place refusals go; the till stops offering them (D1). No schema change, no reset. | 2a |
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
- **D13. Only a dish row holding exactly one whole portion takes part** (`quantity` 1000 and
  `count_as_portions`). Table sends write one row per portion (`expandPortionRows`,
  `order-portions.ts:55`, from `order-group-submission.ts:219-225`), so do new counter lines
  (`expand: true`, `working-order-line-edits.ts:351-355`); a set-menu dish is never sold by measure
  (`assertSetMenuPortion`, `set-menu-offers.ts:126`). Any other row is charged as stored.
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
- **D25. FOR THE OWNER. A cancel on a part-paid bill can now be refused.** When the regrouped total
  drops below what was received, the cancel is refused `bill.received_exceeds_total`
  (`assertBillInvariant`, `bill-payments.ts:568`), as it is today for any line whose removal does
  that. New: a dish at 0 inside a set menu can now cause it (Daily of Soup and Hake, 14.00 received:
  cancelling Hake leaves Soup at 6.00). Today that cancel is accepted. Recommended: accept the refusal,
  as for any other line today. Alternative: allow the cancel and leave the bill overpaid.
- **D26. FOR THE OWNER. A set menu moved with its dishes to a bill holding another version of it is
  charged at the target's version.** The move carries only copies the target lacks
  (`carryBillSetMenuCopies`'s `onConflictDoNothing`, `set-menu-bill.ts:153-155`), and the regroup groups
  by the target's recorded copy, so the moved menu's price can change. Recommended: accept (one recorded
  copy per set menu per bill). Alternative: refuse the move while the versions differ.
- **D27. FOR THE OWNER. An existing money-total test changes:** the spec fixture's bill
  (`testing/set-menu-spec-fixture.ts:248`) totals 72.00 instead of 73.00, because 3 Daily and 1
  Special is cheaper than the 2 and 2 a waiter counted (Goal 2). Lane rules make a changed money total
  a stop; 2b Task 2b.1 lists every total that moves.
- **D28. The calculation is skipped when no grouping dish changed.** Each regrouping stores its input,
  less the saved places (offer keys and, per unfrozen dish, id, listing, course, à la carte price,
  extras, eligibility), as `working_orders.set_menus_input`; when the next input is the same, nothing is
  calculated or written. Freezing a row takes it out of the input, so it counts as a change. Stored
  whole, not hashed, so a match cannot be a collision. Alternative: callers pass the changed line ids.

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
- The golden huella test and `inmutabilidad` pass UNEDITED; 2a and 2c say "Resets venues" in the PR's
  first line; 2b's body carries a `Sale-path read changed:` line (CLAUDE.md §4) and one line on D2:
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
6. **A set menu moved with its dishes to a bill recording another version of it** is dissolved and
   regrouped under the target's recorded copy (D26; 2b Task 2b.4).

---

### PR 2a — The grouping writer (`feat/a1515-3-regroup-writer`)

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
  - Hake alone plans nothing (it stays at 16.00).
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
  - Hake alone: stays 16.00, no set-menu row.
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
    `set_menu_id` the Daily's (D11); then Soup sent: the Daily forms, Hake 0.
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
    is 5.00, and the adjustments report (`packages/adjustments/src/reports.ts:191-193`) counts 5.00.
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
    Soup returns to 6.00; on the target Hake is 16.00, or joins a Soup there in a Daily.
  - **D26 (owner):** `moveDishes` of the Daily row with its dishes (`resolveMoveLines`,
    `bill-actions.ts:198-247`): the target keeps that row's id when it still groups; to a bill
    recording another version of Daily at another price, the moved row dissolves and its dishes are
    charged at the target's version.
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

**Files:** the "For lane C" list above; `apps/till/src/i18n/strings.ts` (`set_menu.not_cheapest`, English and Spanish).

- [ ] **Step 1: Write the failing till tests:** in `widgets/menu-browser.test.ts`, tapping Hake in the
  Daily folder on a bill whose set menus have no free place adds it to the draft with no question; in
  `widgets/set-menu-folder.test.ts`, the folder draws no "Add a" button; in
  `widgets/set-menu-summary.test.ts`, a bill answered with `exact: false` draws one line "These set
  menus may not be the cheapest for this bill." ("Puede que estos menús no sean lo más barato para
  esta cuenta."), and none when `exact` is true or absent; in
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
  inherits D22's list. PR body: no reset (no schema change); the D2 line; the D10 line; the owner
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
  stored total after `payForItems`: Hake alone from a Daily (16.00; the source's Soup becomes 6.00);
  Soup and Hake from two different Dailies (14.00); a Daily with its dishes (14.00); Sirloin chosen
  with Soup (19.00); a comped dish of its own (its stored price).
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

- `set_menu.move_adjusted` (`refuseMovingFrozenDishes` in `set-menu-moves.ts`, as PR 2b leaves it, D18) and moving "a set menu with its dishes"
  (`resolveMoveLines`, `bill-actions.ts:231-247`) go; dishes move one by one with their own comps and
  discounts; a set menu's discount stays on its bill.
- Both bills regroup (PR 2's call already does); a test per move path (`moveDishes`, `mergeBills`,
  `splitTable`, pay-for-items) shows a discounted dish arriving discounted and both totals.

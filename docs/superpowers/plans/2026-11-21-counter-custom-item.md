# Counter custom item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as
> `subagent_type: "implementer"`.

> **Refreshed 2026-11-24** on `main` at `10fe2d01c4`, against VAT rates piece A (#4047, #4091,
> #4133, #4138), then revised after its first fresh read:
> [Changed on 2026-11-24](#changed-on-2026-11-24), [Changed after read 1](#changed-after-read-1).

**Goal:** Staff on the Counter can ring up something that is not on the menu — typed name, typed
VAT-inclusive price, a takeaway VAT rate when the order is taken away, and a kitchen station or
none — gated by a new permission that can be assigned to anyone.

**Architecture:** Each custom line points at one of a few hidden products that Waitron finds or
creates on first use: one per takeaway rate, plus one for "eaten in, rate not asked". The line files
like any other: eaten here at the area's dine-in rate, taken away at its product's row in
`product_takeaway_vat_rates`. **A takeaway order never holds an item whose rate nobody chose**: that
is held where such an item is added, where an order is switched, and where a move makes an order
takeaway (Decision 1). The server learns a second line shape on the order wire (`custom`),
priced from the request when the line is new and never again. A person without the permission gets
a supervisor's PIN once per request. Reports show these lines under their own "Custom items" row.

**Spec:** `docs/superpowers/specs/2026-11-21-counter-custom-item-design.md`. Read it before any task.

## Should this exist?

- **Need**, in the owner's words (spec, "Why", 21 November): the escape hatch for a **rare one-off**,
  "not a routine way to sell". Today an order line can come only from a published menu. After PR 3
  lands, staff on the Counter can ring one up. Tables cannot add one (a spec non-goal).
- **Simplest alternative:** nothing in code: a manager adds an ordinary product when one is needed.
  It gives no typed price, and staff wait for a manager and a publish. The spec weighed two smaller
  models and the owner chose the hidden products. Beyond the bare need this builds the PIN (spec
  item 5), the category row (item 3) and the question at a takeaway switch (item 4), all asked for.
- **Cost to keep:** one nullable column, one permission, one error code, one activity kind, one
  second line shape in `priceOrderLines`, `applyLineEdits` and `readBasketOrder`. Size, estimated
  and not built: production about +1,250 lines, tests about +1,900, and four generated files (the
  core set's SQL, snapshot and journal, and the epoch file).
- **Approval:** the design is approved by the owner, 21 November (recorded in the spec's status line,
  `c6efa1acbb`). Nobody has approved this plan. Fresh reads: one on 21 November, and one of the refresh
  on 24 November ("fix first"; this is the fix).

## Pull requests

| PR | Tasks | Migration | Notes |
| --- | --- | --- | --- |
| **1. Data and reports** | 1, 2, 3 | **core rebuild** | First line: "Reset test venues: a custom item column on products (A1564)". The body says the dashboard's permission list gains "Add custom items", which nothing uses until PR 3. |
| **2. Server** | 4a, 4b, 5, 6a, 6b, 7a, 7b | none | One PR: until 6a, a stored custom line makes its parked order unreadable. No sale-path read changes. |
| **3. Till** | 8, 9a, 9b, 9c, 10a, 10b | none | A1563 has landed (#3986), so this PR waits on nothing but PR 2. |

Stacked in that order. All three are FULL review (PR 1 a migration and a permission, PR 2 the filed
line and authorisation, PR 3 the cross-package wire). PR 2 decides the rate a ticket files at, so the
watcher says who lands it.

**Against VAT rates piece B** (its plan is cleared and not built; B5 drops the label columns). The
plan names a label in one place only, marked below.

| Task | Before B3 | After B3, before B5 | After B5 |
| --- | --- | --- | --- |
| 1 | works: `createProductSkippingNameCheck` fills the label itself | works | works |
| 4a | the custom line's metadata **must** carry `vatClass: "reduced", takeawayVatClass: "reduced"`: both columns are NOT NULL with no default | leave both out: B3.1 deletes the fields and D8 fills the columns | works, nothing to change |
| every other task | works, names no label | works | works |

Whichever lands second fixes Task 4a's two keys (a compile error names them). PR 1 and B5 both rebuild
core: the second takes `main`'s copy and reruns the rebuild. Lane L's rule that no migration PR starts
while a lane L PR is parked applies to PR 1.

## Decisions (recommended defaults; ★ needs the owner)

1. **A takeaway order never holds a "rate not asked" item.** Held at three points: adding one to a
   takeaway order needs a rate (4a); the switch needs a rate for each such item (7b); and
   `applyDepartmentDining` (`packages/venue-service/src/dining.ts:125`) refuses before it writes `dining`
   (7b). No other code was found that writes `dining` or moves a line between orders sold differently
   (Evidence, with its limits). Rates
   may be chosen while the order is still eaten in, which changes nothing it files (ran). As a belt, that
   product has no takeaway rate row, so a missed path would refuse `vat_rate.unavailable` rather than
   file a rate nobody chose.
2. **★ An eat-in order moved to a takeaway-only department** becomes takeaway without anybody switching
   it; the design covers only staff switching one. Example: a €12.00 bottle is rung up eaten in on the
   Counter, and the order is moved to a table of, or handed to, the Takeaway department.
   - **(a) Ask as it is moved (recommended).** "Choose the VAT: 21%, 10%, 4% or 0%" appears when somebody
     moves the order, or accepts it when it was handed over, and the move then goes through. Costs one
     question in those two windows; the person accepting may not know what the bottle is.
   - **(b) Let it move and ask at payment.** Nobody is stopped at the move; the till asks at Pay, Send or
     Print. Costs a check on every way a bill is issued, and leaves bills that cannot be invoiced until
     somebody answers (read 1 found a paid-in-part one nobody could finish).
   - **(c) Refuse the move.** "Switch the order to take away first". Costs the least code, but in a
     department that sells only eaten in nobody can switch it, so the bottle must come off the order.
3. **The activity entry leaves the typed name out**: the line's id, the price and the approver's id.
   `activity_log` rows may hold no person's name and cannot be changed (`packages/db/src/activity-kinds.ts:1-13`), and
   staff can type "Cake for María Pérez". The name stays on the order line and the ticket. No screen shows
   this kind today, so what the design's "recorded" gives the owner is a record, not a list.
4. **The typed name is at most 60 characters.** Product names have no limit to copy (read:
   `insertProduct` refuses only a blank one). Example: "Bottle of Albariño, brought up from the
   cellar" fits; a pasted paragraph is refused under the field. Spaces are collapsed, and line breaks
   and control characters refused, because the name goes to kitchen and receipt printers.
5. **The PIN is checked before, not inside, the late-dish check.** Two PIN checks for one person, one
   inside the other, never finish (ran: `inTurn` re-entered with the same key was still waiting after
   2 s). Task 5 checks the custom item's PIN, then the ordinary request runs.
6. **The till's rate list comes from its start read** (`takeawayVatRates`, the pack's pickable rates;
   empty where the area charges no takeaway VAT), not from a copy of the pack in the till, so
   it refreshes through `setupRevision` like `takeawayVat`.
7. **On a table's bill** a custom item that arrived with a moved order is an ordinary line; a NEW
   one is refused there, whoever asks (Counter only).
8. **Choosing a rate needs no `order.custom_item`**: anyone who may switch, move or accept the order.
9. **A deleted station.** The delete screen says unsent lines "return to normal routing"; for a custom line
   an empty station means Nowhere. So the delete leaves a custom line's station as it is: `fireLines` takes
   an inactive station as no choice, and the line follows normal routing (ran: it went to the default
   station; on a venue with none it is refused `station.no_default`, as any dish is).
10. **The rate a takeaway order was given is the one it files**, even if the law changes before it is paid:
    a hidden product's rate is its key.

## Global Constraints

- **Line numbers are from `main` at `10fe2d01c4`**, read there (`wo` =
  `apps/server/src/working-order.ts`). They drift; find the code by the function names. The moves into
  `packages/orders-sales` (#4197, #4203, #4207) and the series split (#4011, #4118) moved no function
  this plan edits. `invalid` and `MONEY` are still imported from `./bill-allocation.js`.
- **No price, name or rate from the till is ever trusted on a line already stored.** Only a NEW
  custom line takes them from the request.
- **`priceOrderLines` (`wo` 653) refuses a new custom line unless its caller passes `customItems: {
  dining, confirmation }`.** It cannot read the way itself: a new order's row is inserted after pricing.
  `createOpenOrder` passes the way it resolved, `applyLineEdits` `storedOrderDining`. Only the Counter's
  routes pass one: park (`POST /api/working-orders`), save (`PUT
  /api/working-orders/:id`, refused when the order has a party) and the Counter payment
  (`apps/server/src/bill-payments-api.ts:255`). Table rounds (`priceTabRound`, `wo` 3237) refuse it
  with `management.request_invalid` `{ field: "lines" }`.
- **The permission is `order.custom_item`**, a core permission, default holders
  `["supervisor", "manager"]` (admin holds every permission).
- **Hidden products are keyed by `products.custom_item_key`**: `"unchosen"`, or the takeaway rate in
  basis points as a decimal string (`"2100"`, `"1000"` …). Ordinary products hold `NULL`. Each is made
  by `createProductSkippingNameCheck` (`packages/menu/src/operations.ts:985`) with `name: "Custom
  item"`, `unitPrice: "0.00"`, no category, no unit; a rate one gets its one row in
  `product_takeaway_vat_rates` from that call, `"unchosen"` has none.
- **Never read or write a VAT label** (`vat_class`, `takeaway_vat_class`) except Task 4a's two keys.
  Rates come only from `readVenueVatRates(tx)` (`packages/menu/src/takeaway-vat-rates.ts:28`), and
  `product_takeaway_vat_rates` is written only in that file (`scripts/write-path-tables.json`).
- **The wire carries the takeaway rate as basis points (`takeawayRateBp`), never a label.** The till
  shows bare percentages (owner, 2026-11-21).
- **Asked only on a takeaway order.** On an eat-in order `takeawayRateBp` is `null`.
- **"Send to: Nowhere" is a custom line with no `makeAtStationId`.** It is stamped sent with no
  ticket when fired; it never follows routing. A station that is no longer active is kept (Decision 9).
- **A custom line is a whole portion sold each:** a quantity of 3 is stored as 3 dish rows in one
  cohort (`expandPortionRows`, `apps/server/src/order-portions.ts:32`), and it names no menu item.
- **`descriptions` holds the typed name under each invoice language** (the trigger
  `working_order_lines_check_locales_insert`, `packages/db/triggers/core.sql:143`).
- **Every new word, guide sentences included, is in English and Spanish.**
- **Fiscal gate, unedited and passing in PR 1 and PR 2:** `pnpm --filter @waitron/fiscal-verifactu exec
  vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`.
- **Test commands:** `pnpm --filter <pkg> exec vitest run <file>`; read the `Tests` count. Each task
  ends with `pnpm exec prettier --check <changed files>`, the changed packages' `typecheck`, and a
  `git commit -s`. Before a browser suite, `memory_pressure | grep free`.

## Review Focus

1. **A re-sent custom line whose name or price the till altered** is refused and nothing changes (6a).
2. **A stored custom line sent back without its id** is a NEW line: it needs the permission or a PIN
   again (6a).
3. **Raising a comped custom line** prices the new units at the price before the comp (6b).
4. **Two different custom items on one hidden product are never treated as one dish** (6b): a Sent
   row's check (`sameDishKey`, `wo` 7602) compares product, offer and note, not name or price.
5. **An eat-in order moved to a takeaway-only department** is refused whole, and the move succeeds once
   rates come with it (7b, 10a).
6. **The till's way changes without a switch**: a menu poll follows the department, or a saved order is
   switched with an unsaved custom line beside it (10a).
7. **A declined card, or another person signing in, while a custom line is still unsaved** (9c).
8. **A request carrying both a late-dish PIN and a custom-item PIN of the same person** finishes (5).

---

### Task 1: The permission and the hidden products

**Files:** `packages/identity/src/permissions.ts` (`CORE_PERMISSIONS`),
`apps/dashboard/src/i18n/permissions.ts`, `apps/dashboard/src/i18n/strings.ts`,
`packages/db/src/schema/menus.ts` (`products`), the core set's starting migration,
`packages/menu/src/takeaway-vat-rates.ts`, `packages/menu/src/custom-item-products.ts` (new) and its
test, `packages/menu/src/index.ts`; changed checks below.

**Produces:**
- `customItemProduct(tx: Transaction, takeawayRateBp: number | null): Promise<string>` — the hidden
  product's id, found by key or created. It refuses `management.request_invalid`
  `{ field: "takeawayRateBp" }` for a rate not in `readVenueVatRates(tx).pickable` (compared through
  `basisPointsToDecimal`).
- `clearTakeawayVatRates(tx, productId)` in `takeaway-vat-rates.ts`, used for `"unchosen"` only.
- `notCustomItem: SQL` — `products.custom_item_key is null`; `unchosenCustomLines(tx, workingOrderId):
  Promise<string[]>` — the order's line ids on `"unchosen"` (used in 7b).

- [ ] **Failing tests** (`custom-item-products.test.ts`, `useVenueDb`, a Spanish venue seeded as in
  `takeaway-vat-rates.test.ts`): "creates the hidden product once and finds it after" (two calls with
  `2100`: one id, one row, key `"2100"`, its one rate row `{startsOn: null, rate: 2100}`, `unit_price`
  0, `allergens` null, active); "a second rate makes a second product of the same name"; "the unchosen
  product has no takeaway rate"; "a rate the area does not pick refuses" (`750`, `management.request_invalid`);
  "an ordinary product has no key". In `permissions.test.ts`: staff lack `order.custom_item`;
  supervisor, manager and admin have it.
- [ ] Run `pnpm --filter @waitron/menu exec vitest run src/custom-item-products.test.ts`; FAIL (module
  missing).
- [ ] Implement: `customItemKey: label("custom_item_key")`, `uniqueIndex("products_custom_item_key")`,
  a one-line comment pointing at the spec; `pnpm --filter @waitron/server migration-baseline rebuild
  --set core`. One transaction writes at a time, so find-then-create needs no conflict clause. Not
  `createProduct`: its name check refuses the second hidden product (`product.name_taken`, ran).
  Permission area `"sales"`; label "Add custom items" / "Añadir artículos libres"; help "Ring up
  something that is not on the menu, with a name and price typed at the till. Without this, a person
  who has it can enter their PIN." and its Spanish.
- [ ] Run the file; `pnpm --filter @waitron/identity exec vitest run`; from the root `pnpm exec vitest run
  scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
  scripts/starting-migrations.test.ts scripts/column-vocabulary.test.ts scripts/classification-complete.test.ts
  scripts/id-columns-are-references.test.ts scripts/write-path-tables.test.ts scripts/english-only.test.ts
  scripts/access-role-permissions.test.ts`; `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts`; the
  fiscal gate. Commit `Custom item: its permission and hidden products`.

### Task 2: Hidden products stay off lists and out of exports

"A manager cannot edit, place or delete them" is met by never offering their id. Only the readers
that list every product need the filter; the others read by id, by category or by unit, and a hidden
product has neither (read). `listProducts` **throws** `vat_rate.schedule_invalid` with an unchosen
product in it (ran), so this lands with Task 1.

**Files:** `packages/menu/src/operations.ts` (`listProducts` 1066, `listAvailableProducts` 1300),
`packages/menu/src/product-names.ts` (`assertProductNamesFree` 37),
`packages/menu/src/content-translation-candidates.ts:72` (raw SQL, the `product` branch),
`packages/venue-service/src/routing-store.ts` (`activeProducts` 272, `gridProducts` 1058 — not
`productFacts` 900, which the kitchen uses), `packages/db/src/configuration-transfer.ts:201`
(`leaveBehindWhenSet: "custom_item_key"`).

- [ ] **Failing tests**, in each reader's suite (`operations.test.ts`, `product-names.db.test.ts`,
  `content-translation-gaps.test.ts`, `routing-store.test.ts`, `apps/server/src/configuration-transfer.test.ts`),
  after `customItemProduct(tx, 2100)` and `customItemProduct(tx, null)`: the two lists and the routing
  grid leave them out; a manager can create a product named "Custom item"; the gap report does not list
  them; a default-row routing preview does not count them; an export holds no hidden product and no
  rate row of one, and importing it succeeds.
- [ ] Run; FAIL (without the export line the import is refused `setup.request_invalid`
  `product_takeaway_vat_rates.product_id`, ran). Implement; run the touched suites; PASS. Commit
  `Custom item: hidden products stay off lists and out of exports`.

### Task 3: Reports show a "Custom items" row

**Files:** `packages/shared/src/sale-line-classification.ts`, `packages/menu/src/sale-classification.ts`
(`loadClassification` 19, `classifyLine` 50), `packages/reporting/src/category-sales.ts`
(`CategoryTotal.kind` 34, `pathOf` 127, `KIND_ORDER` 153), `apps/server/src/category-sales-page.ts`
(`nameOf` 39) and `apps/server/src/i18n/category-sales-page.ts` (the printed page),
`apps/dashboard/src/api/client.ts` (`CategoryTotalDto` 1702),
`apps/dashboard/src/screens/dashboard-sales-screen.ts` (`#categoryName` 674),
`apps/dashboard/src/i18n/strings.ts`.

**Produces:** `CUSTOM_ITEMS_CLASSIFICATION_ID = "custom_items"` in `@waitron/shared`; a product with a
`custom_item_key` classifies as `{ reporting: [{ id: "custom_items", name: "" }] }`, returned by
`classifyLine` before `validateSnapshot` (which refuses an empty name); `CategoryTotal.kind` gains
`"custom_items"`, after `set_menus` and before `uncategorised`.

- [ ] **Failing tests:** `sale-classification.test.ts` (a hidden product's snapshot, and an ordinary
  Uncategorised product's unchanged); `category-sales.test.ts` and `category-sales-current.test.ts`
  (one node of kind and id `"custom_items"`, name `""`, in both modes); `category-sales-page.test.ts`
  and `dashboard-sales-screen.categories.test.ts` (named "Custom items" / "Artículos libres").
- [ ] Run; FAIL; implement; run the five files; PASS. Commit `Custom item: its own row in the category
  report`; `pnpm -r typecheck`; `/finish-branch` for PR 1.

### Task 4a: Park adds a custom line (operator holds the permission)

**Files:** `apps/server/src/custom-item.ts` (new) and its test; `wo` — `priceOrderLines` 653-1166,
`createOpenOrder` 1547, `ParkOrderRequest` 1516, `parkOrder` 1725; `till-api.ts` `POST /api/working-orders`
1858; `packages/module/src/module.ts:738` and `packages/venue-service/src/operations.ts`
`lineContextColumns` 1366; `packages/db/src/activity-kinds.ts`.

**Produces:**
- Wire, a NEW custom line: `{ custom: { name: string; unitPriceGross: string; takeawayRateBp: number |
  null }; quantity: string; makeAt?: string | null; note?: string }` — no `menuItemId`; `makeAt`
  absent or `null` means Nowhere; `extras`, `options`, `courseId`, `variantId` or `menuVersionId` on
  one refuses `{ field: "lines" }`.
- `CustomItemConfirmation`: `{ confirm(tx): Promise<string | null> }` — the approver's person id, or
  `null` when the operator holds the permission; otherwise `authorization.not_permitted`
  `{ permission: "order.custom_item" }`. Here it checks the operator only (`holds` over
  `readPersonAuthority`); Task 5 adds the approver.
- `LineContextInput.custom?: true`: `lineContextColumns` skips the line, so every context column stays
  null (`working_order_lines_context_ck`).
- Activity kind `"order.custom_item_added"`, subject `"working_order"`, data `{ lineId: string;
  unitPriceGross: string; authorizedBy: string | null }`, its privacy rule stated at the kind (Decision 3;
  `authorizedBy` as in `zone.kept_open`), one per request line, the operator as `personId`.

- [ ] **Failing tests** (`custom-item.test.ts`, through the route; `counterVenue()` in
  `takeaway-vat-rate-at-issue.test.ts` shows a till-choice Counter):
  - "a supervisor adds a custom line": the typed `name`, spaces collapsed; `descriptions` under each
    invoice language; `unit_price_gross`, `line_total`; `unit_name` null, `unit_precision` 0; `product_id` of
    the `"unchosen"` product; `menu_item_id`, `offer_*`, `sold_in_each` and `make_at_station_id` null; the
    `custom_items` classification; one activity row. Its kitchen ticket and its receipt say the quantity
    with no unit word (`sold_in_each` is null, so a stored "each" would print "2 each").
  - "three of one custom item are three portions of one cohort"; 100 refuses `tab.portions_too_many`.
  - "a takeaway custom line lands on its rate's product" (`2100`); `null` on a takeaway order and a rate
    on an eat-in one each refuse `{ field: "takeawayRateBp" }`.
  - "a custom line and a menu dish in one basket": the dish priced as before, context columns on it only.
  - "staff without the permission refuses"; nothing stored. "a table round refuses" (`{ field: "lines" }`).
  - "bad fields refuse": a blank name, 61 characters, a line break, a price of `0`, `-1`, `1.234`, `abc`, a
    fractional quantity — `management.request_invalid` naming `name`, `unitPriceGross` or `quantity`; a
    `makeAt` that is no station. Price parsed with `MONEY`.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/custom-item.test.ts`; FAIL.
- [ ] Implement. The custom branch skips every offer, version, period, availability and modifier step;
  a basket of custom lines alone still runs `assertZoneTakesNewOrders`. Its metadata carries the two
  label keys until B3 (table above). `readBasketOffers` gets only the menu lines' ids.
- [ ] Run the file, `working-order.test.ts`, `@waitron/venue-service`'s `operations.test.ts`; PASS. Commit
  `Custom item: park adds a custom line`.

### Task 4b: Save and the Counter's payment add one

**Files:** `wo` `UpdateHeldOrderRequest` 5781, `applyLineEdits` 6208, `saveHeldOrderIn` 7418 (pass it on;
refuse one when the order has a party); `till-api.ts` `PUT /api/working-orders/:id` 1952;
`apps/server/src/bill-payments.ts` `CounterPaymentBasket` 198, `CounterPayment` 208, `saveCounterBasket`
1735; `apps/server/src/bill-payments-api.ts:285-369`.

- [ ] **Failing tests:** "saving a parked order adds one"; "saving one onto a party's bill refuses" (`{ field:
  "lines" }`); "the Counter's pay files it": `sale_lines` has the typed name, price, hidden product and rate —
  1000 eaten here; taken away at 2100 and, beside a 10% dish, two VAT rows; "a custom line naming a
  station that is no longer active is kept and follows normal routing" (the payment's `invalidMakeAt:
  "ignore"` must not turn it into Nowhere).
- [ ] Run; FAIL; implement; run the file, `working-order.test.ts`, `counter-bill-payments.test.ts`,
  `takeaway-vat-rate-at-issue.test.ts`, `dine-in-vat-rate.test.ts`; PASS. Commit `Custom item: save and
  the Counter's payment`.

### Task 5: A supervisor's PIN for someone without the permission

**Files:** `custom-item.ts` (`parseCustomItemApproval` through `parseOverrideField`, `till-api.ts:792`;
`checkCustomItemApproval`); the three routes of Tasks 4a and 4b; `bill-payments.ts:1828` (the retry fingerprint
also leaves the confirmation out, as `lateSend: undefined`); `apps/server/src/adjustments-api.ts`
`requireApproverPermission` 102; the new route's rows in `till-api.profile-actions.test.ts` (action
`take-orders`), `till-api.session-person.test.ts` (`BODIES`) and `till-api.profile-zones.test.ts` ("none: it
names no order").

**Produces:**
- `customItemApproval?: { override: { personId: string; pin: string } }` — at the top of the park and
  save bodies, inside `basket` on the payment body (beside `lateSend`). One per request, covering every
  new custom line in it.
- `POST /api/custom-item-approval` `{ personId, pin }` → `204`, or `pin.invalid`, `pin.throttled`,
  `authorization.not_permitted`. Same throttle slot as other override PINs (`overridePinAttempts`).
- `checkCustomItemApproval(db, session, pinThrottle, parsed)` — through `withPinCheckAhead` and
  `authorizeByPin` (`packages/identity/src/authorize.ts:70`) in a short transaction of its own, finished
  before the late-dish check begins (Decision 5); skipped when the operator holds the permission. Inside
  the write, `confirm(tx)` asks `authorizeApproval(tx, …)` (`authorize.ts:86`), which refuses an approver
  who lost the permission meanwhile. A read and a write in two transactions is the stated choice here.

- [ ] **Failing tests:** "staff with a supervisor's PIN adds it" (activity `authorizedBy`); "a wrong PIN
  refuses, nothing stored, and counts towards the limit"; "one approval covers two custom lines in one
  save"; "an approver without the permission refuses"; "a late dish and a custom item approved by the
  same manager in one park" (Review Focus 6: a test time limit proves it finishes); "the approval is
  not part of the payment fingerprint"; "the approval route" (204, `pin.invalid`, `authorization.not_permitted`);
  `GET /api/adjustment-approvers?permission=order.custom_item` lists supervisors and managers.
- [ ] Run; FAIL; implement; run the file, `late-send.test.ts`, `adjustments-api.test.ts` and the three
  inventories; PASS. Commit `Custom item: a supervisor's PIN`.

### Task 6a: Reopening and saving again never re-price

**Files:** `wo` — `HeldOrder` 5393, `readBasketOrder` 5563 (the `order.service_context_missing` at
5676 is what a custom line hits today, read), `readEditableOrder` 6034 (`EditableParent` gains `custom:
boolean`, `EditableLine` the list price), `saveHeldOrderIn` 7418 (the match at 7438-7470); the till-api
`PUT` type.

**Produces:**
- Re-sent: `{ workingOrderLineId: string; custom: true; quantity: string; makeAt?: string | null; note?:
  string }`.
- `getHeldOrder` and `getPlacedCounterOrder` answer `{ workingOrderLineId, custom: true, productId, name,
  unitPriceGross, quantity, makeAt, note }` with no `menuItemId` and no `product`.

- [ ] **Failing tests:** "a parked order with a custom line reopens" (and one sent unpaid, `/placed`);
  "re-sent with the new-line shape beside its id refuses" (`{ field: "lines" }`, row unchanged); "without
  its id it is new and needs the permission"; "`custom: true` naming a menu dish's id, or a menu line
  naming a custom line's id, refuses"; "a note and a station change save"; "leaving it out removes it";
  "an unchanged save writes nothing" (revision kept).
- [ ] Run; FAIL; implement: `custom: true` matches only by id to a stored line whose product has a key; a
  `LineIntent` with `options: null, extras: null`. Run the file and `working-order.test.ts`; PASS. Commit
  `Custom item: reopening and saving keep its price`.

### Task 6b: Raising, lowering and adjusting a stored custom line

**Files:** `wo` — `applyLineEdits` 6208 (`menuItemOf` 6297 must not be asked; the three places that price
more: `raise`/`change`/`addedApart` at 6473, the `raised` check at 6493, `copies`), `sameDishKey` 7602,
`updateOrderLine` 7511; `priceOrderLines` gains an internal symbol line (as `STORED_RISE`) carrying the
stored product, name and price, which no JSON body can set and which needs no confirmation; the
dead-ends routes `till-api.ts` 1740 (`/sale`) and 3999 (`/order`).

- [ ] **Failing tests:** "raising an unsent custom line adds portions at the stored price"; "raising a
  sent one adds a line at the stored price, no permission needed"; "raising a comped one charges the
  extra units in full" (`list_unit_price_gross`); "a Sent row of two different custom items is refused"
  (`portionLineNos`, Review Focus 4); "options or extras on `PUT …/lines/:lineNo` refuse"; "Cancel item,
  a comp and a discount work" through their routes; "the kitchen checks skip custom lines": `/sale` with a
  NEW and a stored one answers for the other lines under their own keys (the till sends the whole basket,
  `till-app.ts:8355`), `/order` likewise. (`/api/dead-ends/draft` cannot hold one.)
- [ ] Run; FAIL; implement; run the file, `working-order.test.ts`, `dead-ends.test.ts`,
  `adjustments-api.test.ts`; PASS. Commit `Custom item: quantity changes and adjustments`.

### Task 7a: The kitchen

**Files:** `wo` `makersByLine` 1907 and its callers `fireLines` 2394 (2462) and `heldNoRouteLines` 2782
(2827): a line whose product has a key and no `makeAtStationId` answers `{ kind: "made", route: { kind:
"no_preparation" } }` and is not asked of the resolver. The third caller, `station-move.ts:143`, moves
only lines that have tickets, which a Nowhere line never has (read). `apps/server/src/station-delete.ts:172`
leaves custom lines' station alone (Decision 9).

- [ ] **Failing tests:** "Nowhere prints no ticket" (`sent_at` set, no ticket item, no
  `station.no_default` on a venue with no default station); "sent to the bar goes to the bar, under the
  typed name"; "a deleted bar": its unsent custom line fires by normal routing, its menu line as today;
  "a Nowhere line on an order moved to a table is stamped sent"; "a bill whose only line is a Nowhere one
  can be paid" (`assertBillHasNoUnsent`).
- [ ] Run; FAIL; implement; run the file, `working-order.pay-and-dispatch.test.ts`,
  `move-bill.dining.test.ts` and `station-delete`'s suite; PASS. Commit `Custom item: the kitchen`.

### Task 7b: An order becomes takeaway only with its rates

**Files:** `packages/venue-service/src/dining.ts` `applyDepartmentDining` 125 (through
`unchosenCustomLines`, before the write at 140); `custom-item.ts` `chooseCustomItemRates`;
`apps/server/src/order-dining.ts` `switchOrderDining` 93; `till-api.ts` `PUT /api/working-orders/:id/dining`
2070 and `POST /api/bills/:id/move` 4458; `apps/server/src/department-transfer-api.ts:252` (accept);
`packages/venue-service/src/errors.ts` and `apps/server/src/errors.ts` (both, as
`order.service_context_missing` is), STATUS (`till-api.ts:517`), `apps/till/src/i18n/codes.ts`.

**Produces:**
- `order.custom_item_rate_required` `{ workingOrderId: string; lineIds: string[] }`, 409, thrown by the
  switch to takeaway and by `applyDepartmentDining`. Words: "Choose the takeaway VAT of the custom items on
  this order." and its Spanish.
- `customItemRates?: { lineId: string; takeawayRateBp: number }[]` in the bodies of the switch, the move and
  accept, applied by `chooseCustomItemRates(tx, workingOrderId, rates)` first, in the command's own
  transaction: it repoints `product_id` and nothing else, only lines of that order on `"unchosen"`, only
  while the order is open, and moves no revision (the command does). Accept resolves the order through
  `readIncomingDepartmentTransfer`, which checks the receiver; its receiver may not hold the order's zone,
  so the rates cannot come by a route of their own.

- [ ] **Failing tests:**
  - "switching asks for the unchosen items": refused naming them, nothing changed; with `2100` they are on
    `"2100"` and the order is takeaway; a rate for a menu line, another order's line, a line already chosen
    or an unpickable rate refuses `{ field: "customItemRates" }` and nothing changes; an order with no
    custom items switches as today; back and forth asks once.
  - "a move to a table of a takeaway-only department": `POST /api/bills/:id/move` refused 409, the order's
    way, party and revision unchanged; with rates it moves, is takeaway, and files 2100.
  - "a hand-over accepted by a takeaway-only department": the same through accept, by a person whose profile
    holds only the destination's zones; a wrong `revision` still refuses.
  - "a chosen rate on an order still eaten in files the dine-in rate".
  - "an item nobody chose cannot join a takeaway bill holding a part payment" (`order.dining_differs`).
- [ ] Run; FAIL; implement; run the file, `order-dining.switch.test.ts`, `move-bill.dining.test.ts`,
  `table-actions.dining.test.ts`, `department-transfer-api.test.ts`, the fiscal gate, and from the root
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`; PASS. Commit
  `Custom item: an order becomes takeaway only with its rates`; `pnpm -r typecheck`; `/finish-branch` for PR 2.

### Task 8: The till's custom item window

**Files:** `apps/till/src/widgets/custom-item-dialog.ts` with `.test.ts`, `.a11y.test.ts`,
`.unsaved.test.ts` (new); `apps/till/src/i18n/strings.ts`; `apps/server/src/till-setup.ts` (`readSetupFields`)
and `apps/till/src/api/client.ts` (`TillInfo`, optional there so no fixture changes): `takeawayVatRates:
string[]`, `vatRatesFor(country, territory)?.pickable ?? []` where `takeawayVat`, else `[]` — never
`readVenueVatRates`, which refuses an area without rates and would stop the till starting.

**Produces:** `<till-custom-item-dialog>` with `takeaway: boolean`, `stations`, `rates: string[]`; emits
`custom-item-add` `{ name, unitPriceGross, takeawayRateBp: number | null, makeAt: string | null }` and
`custom-item-cancel`.

- [ ] **Failing tests:** Name (required, a field primitive, 60 characters); Price on `till-numeric-pad`;
  Send to (Nowhere first and selected, then each station); the rate choice only when `takeaway`, highest
  first (`21%`, `10%`, `4%`, `0%`; Spanish `21 %`), no other words; Add disabled until name, a price above
  zero and (takeaway) a rate are given; inline errors per the Forms contract. Keyboard: with Name focused,
  digits go into the name (`routeKey` leaves text fields alone, `pad-keys.ts`); Enter in Name moves to the
  pad, and then digits and Enter drive the pad. Add emits `takeawayRateBp: null` when eaten in. a11y in
  both themes: empty, filled, takeaway with a rate. unsaved: closing with a typed name asks (`draftScopeFor`).
  Server: `GET /api/till` (changed check), and `[]` for an area without takeaway VAT.
- [ ] Run; FAIL; implement; run the files and `till-api.test.ts`; open the window in both themes and at
  phone width. Commit `Custom item: the till's window`.

### Task 9a: The Counter tile and the basket (operator holds the permission)

**Files:** `apps/till/src/widgets/menu-browser.ts` (a dashed tile, drawn only when asked),
`apps/till/src/screens/till-counter-screen.ts:339`; `apps/till/src/state/working-order.ts` (`OrderLine`
68), `apps/till/src/state/order-line.ts` (`toWireProductIdentity` 121 is not called for a custom line);
`apps/till/src/till-app.ts` (`#currentSaleLines` 8305); `apps/till/src/api/client.ts` (`SaleLine` 559); `apps/till/src/till-app-counter-custom-item.test.ts` (new).

- `OrderLine.custom?: { name; unitPriceGross; takeawayRateBp } | true` beside a stand-in
  `product: TillProduct` (the typed name and price, the Each unit, no `menuItemId`, so nothing merges into
  it: `mergeTarget`, `working-order.ts:162`).

- [ ] **Failing tests:** the tile on the Counter, not on the table-order screen; a holder fills it in and
  the basket shows name and price; Pay and Park send Task 4a's shape; nothing merges into the line; it
  shows "allergens not recorded", never "contains none".
- [ ] Run; FAIL; implement; run the file, `working-order.test.ts`, `order-line.test.ts`,
  `menu-browser.test.ts`. Commit `Custom item: the Counter tile and basket`.

### Task 9b: Reopening, folding and the kitchen question at the till

**Files:** `till-app.ts` (`#basketLinesOf` 10856, `#askCounterDeadEnds` 8345), `api/client.ts` (`HeldOrder`
1518), `apps/till/src/state/counter-portion-rows.ts` (read; its key already holds name and price).

- [ ] **Failing tests:** a parked order reopens with the line shown, not marked "not offered", and a change
  sends Task 6a's shape; three retrieved portions fold into one row and two different custom items do not;
  the sale question (`/api/dead-ends/sale`) is answered for the basket's other lines; a custom line whose
  station is no longer offered keeps it (`clearInactiveChoices` would make it Nowhere).
- [ ] Run; FAIL; implement; run the file and `till-app-boot-and-counter.test.ts`. Commit `Custom item:
  reopening at the till`.

### Task 9c: The approval at the till

**Files:** `till-app.ts`, `api/client.ts` (`approveCustomItem(personId, pin)`; `listApprovers` 5140 gains
the permission), `apps/till/src/i18n/*`.

- [ ] **Failing tests:** a person without the permission who taps the tile is told why and gets
  `till-supervisor-override-dialog` (authorizers from `listApprovers("order.custom_item")`); a right PIN
  opens the window, and every park, save or payment sends the approval while a custom line of the basket
  has no id, the late-dish retry included; a wrong PIN shows the dialog's error, a throttled one its
  countdown, and nothing opens. The PIN is dropped once every custom line has an id, the basket is cleared
  or the operator changes. **A send refused `authorization.not_permitted` for `order.custom_item` opens the
  dialog and repeats the send** (as `lateSendApprovalAsked` does): after an operator change, and after the
  permission was taken away mid-shift. **After a declined reader payment that stored the order**, the basket
  is read again (`#reloadCounterOrder`, as the edited case does at 8186) so the custom line has its id: a
  second Pay sends no new line and writes no second activity entry.
- [ ] Run; FAIL; implement; run both files and `till-app-counter-payment-window.test.ts`. Commit `Custom
  item: the approval at the till`.

### Task 10a: The till asks for the takeaway rate

**Files:** `till-app.ts` (`#currentSaleLines` 8305, `#switchCounterDining` 10159, `#switchTableDining` 10197,
the two `moveBill` calls 18590 and 18783), `apps/till/src/widgets/department-transfers.ts:317` (accept),
`api/client.ts` (`switchDining` 3727, `moveBill` 5264, `acceptDepartmentTransfer` 2968); a small
`custom-item-rates-dialog.ts` with `.test.ts`, `.a11y.test.ts` and `.unsaved.test.ts`.

Two rules. **At send:** an eat-in basket sends `takeawayRateBp: null` whatever a line remembers; a takeaway
one with an unsaved custom line that has no rate opens the window first (park, save, Pay, Place). **After a
refusal** `order.custom_item_rate_required`: one helper opens the window for the named lines (names from the
order's lines, or the transfer's detail on accept) and repeats the command with the rates; Cancel leaves
everything as it was.

- [ ] **Failing tests:** an unsaved basket turned takeaway by the switch, and by a menu poll
  (`setDiningStart`), asks before Pay and sends `2100`; one rated 21%, then eaten in, sends `null`; a saved
  order with an unsaved custom line beside a stored one asks for both at the switch and the next save; a
  saved order's switch, a move of a parked order to a table (with and without the allergy window) and an
  accepted hand-over each ask, repeat and succeed; Cancel; a basket with no custom items as today.
- [ ] Run; FAIL; implement; run the files; look in both themes and at phone width. Commit `Custom item:
  the till asks for the takeaway rate`.

### Task 10b: The guide and the backlog

**Files:** `apps/server/src/guide/{en,es}/table-service.md`: a short section `## Ring up something not on
the menu {#counter-custom-item}` / Spanish after the "Share a Counter bill" section (there is no
Counter page) — what it is for, the permission or a PIN, the takeaway VAT; `guide/{en,es}/products.md` only if it names
who can sell; `docs/backlog/till.md` — delete "Custom item on the Counter (A738 residual)" (2248) and fix
316-318 (a link to it), 1519-1520 and 2213 ("undecided"), leaving A738's dated boards as they are;
`docs/backlog.md:661` — delete the bullet.

- [ ] Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the root,
  `scripts/guide-links.test.ts`. Commit `Custom item: guide and backlog`; `pnpm -r typecheck`;
  `/finish-branch` for PR 3.

## Changed test checks

Only these existing assertions change; every other edit adds cases. The golden huella case
(`write-path.e2e.test.ts:573-695`), `inmutabilidad.test.ts`, the Spanish practice-sales golden and every
`vat-*`, `takeaway-vat-*` and `order-dining.*` assertion stay unedited.

| Task | Where | Before → after | Why |
| --- | --- | --- | --- |
| 1 | `packages/identity/src/permissions.test.ts`, "declares each core permission's default holders" | 22 permissions → 23 | spec item 5; ran: the only one of 903 cases to fail |
| 1 | `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`, "preserves every Madrid seed row" (en, es) | `products` gains `custom_item_key` (null in every row); the supervisor and manager lists (1261, 1266) gain the permission | a column and a permission; ran: the column fails both, the lists are read |
| 8 | `apps/server/src/till-api.test.ts`, "GET /api/till returns locale + issuer identity …" | the exact body gains `takeawayVatRates: ["0.00","4.00","10.00","21.00"]` | Decision 6; read |
| 5 | `till-api.profile-actions.test.ts`, `till-api.session-person.test.ts`, `till-api.profile-zones.test.ts` | their route lists gain the new route | the inventory rule |

The till's codes test and `access-role-permissions` pass once the new words exist; they change no
assertion. If another existing assertion must change, the implementer stops and reports.

## Evidence

**Run on 24 November**, in a throwaway worktree of `10fe2d01c4` (removed afterwards) holding Task 1's
column, rebuild, permission and `customItemProduct`, and Task 2's export line:

- A parked line repointed to a hidden product, all context columns null, paid in cash: unchosen eaten here
  files 1000; `2100` taken away files 2100; unchosen taken away is refused `400 vat_rate.unavailable` with
  no payment row, and repointed to `400` then files 400. `sale_lines` keeps the typed name and the
  `custom_items` classification.
- `product_id` can be changed on a sent line while the order is open; on a placed order the trigger refuses.
- The move in Decision 2 with nothing built: after `VENUE_SERVICE.retargetOrderContext` the order reads
  `takeaway`, cash is refused `vat_rate.unavailable`, switching back is refused `order.dining_fixed`.
- Export: no hidden product or rate row with the line, and the import works; without it three products and
  two rate rows travel and the import is refused.
- `listProducts` with an unchosen product throws `vat_rate.schedule_invalid`; `750` is refused.
- Passing with the change in place: `schema-constraints`, `append-only-triggers`, `behavioural-triggers`,
  `starting-migrations`, `column-vocabulary`, `classification-complete`, `id-columns-are-references`,
  `write-path-tables`, `english-only`, `errors-reachable`, `personal-log-params`, `inmutabilidad`,
  `@waitron/composition`, db `configuration-transfer`, server `configuration-transfer`, `menu-api*`,
  `me-api`, `adjustments-api`, `till-api`, `access-roles-api`, `live-api`, `seed.regional`.
- `inTurn` re-entered with one key waits for ever (2 s limit); with two keys it runs.

**Run after read 1**, on `main` at `8ce59dc1ce`, in two throwaway worktrees (removed):

- *Who writes `dining`.* With a trigger refusing every change of it and the two product writes
  (`order-dining.ts:134`, `dining.ts:140`) stubbed out, eight suites (the five `order-dining` start, read,
  switch, walk-up and filing ones, `move-bill.dining`, `table-actions.dining`, `department-transfer-api`) hit the
  trigger only from their own fixtures; with the writes in place it also fired through `applyDepartmentDining`, and
  nine route calls answered 500. A second trigger, refusing a line crossing between orders sold differently, never fired
  there or in `party-move-bill`, `party-bill-actions`, `split-after-print` and `joined-parts` (189 passed). A wider
  run of the server's suites was not permitted, so the rest is by reading: every `update(workingOrders)`, every
  insert, the triggers, the demo seed (writes each order's way once, at insert), the configuration transfer
  (no orders) and `copyBillDishes` (its new bill copies the way). Restores and twin copies take whole files.
- *The guard.* With `applyDepartmentDining` refusing: a retarget and `POST /api/bills/:id/move` to a takeaway
  department are refused and the order stays `eat_in`; repointed to `2100` both go through, and cash files 2100.
  Read 1's C1 starts with a move that is now refused; moving the line straight to a takeaway bill is refused
  `order.dining_differs`.
- *Harmless:* an eat-in line on `2100` files 1000. A Counter order moved to a table of its own department has its
  line sent with a ticket, so its way can no longer change (so, by reading, an unsent custom item meets
  `applyDepartmentDining` only when leaving the Counter; elsewhere the guard still refuses). A line at an inactive station fired at the default one. `@waitron/venue-service` typechecks
  with the import.

**Read, not run:** every other statement about today's code, including the reader list in Task 2, the
callers of `makersByLine`, the till's merge and fold keys and the three kitchen checks.

## Changed on 2026-11-24

- **VAT labels out (Tasks 1, 4, 7).** Hidden products are made by `createProductSkippingNameCheck`, which
  writes the takeaway rate row; `customItemProduct` takes no date and returns an id; the rate list is
  `readVenueVatRates(tx).pickable`; `customItemRatesOn` is gone. Task 4a names the label columns only while
  they are NOT NULL; Task 7b repoints `product_id` alone.
- **The unchosen product** rested on a blank takeaway label meaning "same as eaten in". It now has no rate
  row (Decision 1).
- **A dead end found** (Decision 2): a move or hand-over can make an order takeaway with no switch, which the
  old plan could not answer.
- **The PIN** (Decision 5, Task 5): the old "wrap as `withLateSendCheck` does" would have hung a request
  carrying both PINs of one person. In a payment it travels inside `basket`, where `lateSend` is.
- **Exports** also leave out the hidden products' rate rows; **Task 2's file list** is cut from nine
  readers to the five that list every product, plus the export; the printed category page joins Task 3.
- **The sale kitchen check** receives every basket line, so it must skip NEW custom lines as well as stored
  ones (6b); the old plan had it refuse them.
- **Portions**: custom lines are stored one row per portion like any dish, and two custom items must not
  count as one dish (6b).
- **The activity entry** no longer holds the typed name (Decision 3); a 60-character limit (Decision 4).
- **Till:** the rate list comes from the start read (Decision 6); A1563 landed as #3986, and what its pad
  does with a text field focused is now tested (8); the guide section is in `table-service.md`.
- **Tasks 4, 6, 7 and 10 split in two, and 9 in three** to keep each under 100 tool calls; the PR split, the reset line,
  the piece B table, Decisions, Changed test checks and Evidence are new; every line number was re-read.

## Changed after read 1

Report: `~/waitron-campaign-l/receipts/a1564-plan-read-1.md`.

- **C1, I2, I3 (gone with I1).** The state they need cannot arise: see Evidence.
- **I1 (adopted).** The invariant in Decision 1; the rate checks at payment, Place and issue, the sale-path
  column and the Pay/Place/Print windows are removed. Narrower than suggested: rates travel in the switch, move
  and accept bodies, in the command's own transaction, so there is no route that chooses rates alone and no
  extra revision. No trigger.
- **I4 (adopted).** The at-send rule and its three tests (10a).
- **I5 (adopted).** The PIN lasts until every custom line has an id, a refused send asks again, and a declined
  reader payment re-reads the basket (9c).
- **I6 (adopted, as Decision 9).** A custom line keeps the deleted station and follows normal routing; the same
  rule covers the payment's "ignore" and the till's clearing of inactive choices (4b, 9b).
- **I7 (adopted).** 4a/4b, 9a/9b/9c; `priceOrderLines` is given `dining`.
- **M1** (5, checks table), **M2** and **M3** (4a, Decision 4), **M5** (Decision 3, 4a), **M6** (Decision 10), **M7**
  (Decision 8), **M8** (Task 1, 7b): applied. **M4:** said in PR 1's body; moving the permission to PR 2 would leave
  it just as unused until PR 3. **M9:** nothing to change here.
- **★** rewritten with three choices.

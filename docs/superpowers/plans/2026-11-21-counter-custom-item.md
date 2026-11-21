# Counter custom item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as
> `subagent_type: "implementer"`.

**Goal:** Staff on the Counter can ring up something that is not on the menu — typed name, typed
VAT-inclusive price, a takeaway VAT rate when the order is taken away, and a kitchen station or
none — gated by a new permission that can be assigned to anyone.

**Architecture:** Each custom line points at one of a few hidden products that Waitron finds or
creates on first use, one per takeaway rate plus one for "eaten in, rate not asked"; the product
gives the line its VAT, so the VAT model is unchanged. The server learns a second line shape on the
order wire (`custom`), priced from the request when the line is new and never again after that. A
person without the permission gets a supervisor's PIN once per request, carried and checked the way
the late-send confirmation is. Reports show these lines under their own "Custom items" row.

**Tech Stack:** TypeScript, Hono (server), Drizzle on `node:sqlite`, Lit (till, dashboard),
Vitest (node and browser projects).

**Spec:** `docs/superpowers/specs/2026-11-21-counter-custom-item-design.md` (approved by the owner,
2026-11-21). Read it before any task. Related: the VAT rates design
`docs/superpowers/specs/2026-11-21-vat-rates-design.md` (approved, not yet planned or built).

**Plan review:** one fresh-context read on 2026-11-21 before dispatch; its findings are folded in
(export clash, comp on raised units, unsaved-basket switch, the PIN's channel, the reader list,
the products CHECK, the VAT-redesign touch points, the payment check's place, untested ordinary
behaviours, task sizes).

## Global Constraints

- **Line numbers below are from `main` at `c6efa1acbb`** (`wo` = `apps/server/src/working-order.ts`).
  They come from reading, and drift; find the code by the function names given.
- **No price, name or rate from the till is ever trusted on a line already stored.** Only a NEW
  custom line takes them from the request.
- **`priceOrderLines` refuses a custom line unless its caller passes a custom-item confirmation**
  (Task 5). Only the Counter's routes pass one: park/save (`POST`/`PUT /api/working-orders`) and the
  Counter's pay-straight-away route (`apps/server/src/bill-payments-api.ts`). Every other caller —
  table rounds (`priceTabRound`, `apps/server/src/order-groups.ts:335`), the dead-ends checks —
  refuses a NEW custom line with `management.request_invalid` `{ field: "lines" }`.
- **The permission is `order.custom_item`**, a core permission, default holders
  `["supervisor", "manager"]` (admin holds every permission already).
- **Hidden products are keyed by `products.custom_item_key`**: `"unchosen"`, or the takeaway rate in
  basis points as a decimal string (`"2100"`, `"1000"` …). Ordinary products hold `NULL`. Every
  hidden product has `vat_class = 'reduced'` (the one eat-in rate, VAT rates design "What the owner
  decided"), `unit_price = 0` and `dietary_declarations = []` (the `products_top_level_owns_ck` CHECK
  requires them on a top-level product), `name = 'Custom item'`, `allergens = NULL`. The
  `"unchosen"` one has `takeaway_vat_class = NULL` (blank, "same as eaten in"); each rate one has the
  class whose rate today is that rate.
- **The wire carries the takeaway rate as basis points (`takeawayRateBp`), never a VAT label.** The
  till shows bare percentages (`21%`, `10%` …) and never a label (owner, 2026-11-21).
- **When the VAT rates design's piece A lands, it revisits these, and Task 10 writes this list into
  its backlog entry:** `customItemProduct` and `customItemRatesOn` (Task 1), the till's
  `customItemRates` (Task 8), the custom branch writing both VAT columns on the line (Task 4), the
  repoint at the takeaway switch writing `takeaway_vat_class` (Task 7), and the `"unchosen"` product,
  which rests on a blank takeaway class meaning "same as eaten in".
- **Asked only on a takeaway order.** A custom line added to an eat-in order carries
  `takeawayRateBp: null` and lands on the `"unchosen"` product.
- **"Send to: Nowhere" is a custom line with no `makeAtStationId`.** It is stamped sent with no
  ticket when fired; it never follows routing.
- **A custom line's `descriptions` holds the typed name under each of the venue's invoice
  languages** (the trigger at `packages/db/triggers/core.sql:143-160` requires exactly those keys).
- English and Spanish for every new word on the till and the dashboard; the till guide's Counter
  section in both (`CLAUDE.md` §3, guide rule).
- Pre-live: the schema change rebuilds the core set's starting migration
  (`migration-baseline rebuild --set core`), never a new migration (`CLAUDE.md` §3).
- Every commit `git commit -s`. Each implementer's verify step includes `pnpm format:check` on the
  changed files.

## Review Focus

1. **A re-sent custom line whose name or price the till altered** is refused and nothing changes
   (Task 6 test "re-sent custom line with a changed price refuses").
2. **A stored custom line sent back without its `workingOrderLineId`** is a NEW custom line: it
   needs the permission or a confirmation again and is recorded again (Task 6 test "custom line
   without its id is new and needs the permission").
3. **Raising the quantity of a comped or discounted custom line** prices the new units at the price
   before the adjustment, never the reduced one (Task 6 test "raising a comped custom line charges
   the extra units in full").
4. **A takeaway order paid while a line still sits on the `"unchosen"` product** is refused before
   any card is charged, even if a till skipped the prompt (Task 7 test).
5. **Switching an unsaved Counter basket to takeaway** asks for each custom item's rate on the till
   (Task 10 test).

---

### Task 1: The permission and the hidden products

**Files:**
- Modify: `packages/identity/src/permissions.ts` (`CORE_PERMISSIONS`)
- Modify: `apps/dashboard/src/i18n/permissions.ts`, `apps/dashboard/src/i18n/strings.ts` (EN + ES)
- Modify: `packages/db/src/schema/menus.ts` (`products`)
- Regenerate: core set's starting migration (`migration-baseline rebuild --set core`)
- Create: `packages/menu/src/custom-item-products.ts`, `packages/menu/src/custom-item-products.test.ts`
- Modify: `packages/menu/src/index.ts` (exports)

**Interfaces:**
- Produces: `customItemProduct(tx: Transaction, takeawayRateBp: number | null, today: string):
  Promise<{ productId: string; vatClass: VatClass; takeawayVatClass: VatClass }>` — finds or creates
  the hidden product (`null` → `"unchosen"`; `takeawayVatClass` returned resolved, `'reduced'` for
  `"unchosen"`), refusing `management.request_invalid` `{ field: "takeawayRateBp" }` for a rate no
  class has on `today`; `customItemRatesOn(today: string): number[]` — the distinct takeaway rates
  in basis points, highest first; `notCustomItem: SQL` — `products.custom_item_key is null`.

- [ ] **Step 1: Failing tests** in `custom-item-products.test.ts` (with `useVenueDb`):
  - "creates the hidden product once and finds it after": two calls with `2100` return the same
    `productId`; one `products` row with `custom_item_key = '2100'` and the column values in Global
    Constraints, `takeaway_vat_class = 'general'`.
  - "null rate lands on the unchosen product": `custom_item_key = 'unchosen'`,
    `takeaway_vat_class` null; returned `takeawayVatClass` is `'reduced'`.
  - "a rate no class has today refuses": `750` → `management.request_invalid` with
    `field: "takeawayRateBp"` (assert the code). This value becomes valid under piece A; its plan
    rewrites the test.
  - "customItemRatesOn lists today's rates highest first": `[2100, 1000, 400, 0]`.
  - In `packages/identity/src/permissions.test.ts`: `roleHasPermission("staff",
    "order.custom_item")` false; supervisor and manager true.
- [ ] **Step 2:** Run `pnpm --filter @waitron/menu exec vitest run src/custom-item-products.test.ts`;
  expect FAIL (module missing).
- [ ] **Step 3: Implement.**
  - `products.custom_item_key`: `label("custom_item_key")`, nullable, unique index
    `products_custom_item_key` (NULLs do not collide). One-line comment at the column pointing at
    the spec.
  - Rebuild the core starting migration; run the five checks `CLAUDE.md` §3 names after a rebuild.
  - `customItemProduct`: insert with `.onConflictDoNothing({ target: products.customItemKey })`,
    then read back by key (the target is named: `products` has other unique constraints). The plan
    review ran this shape in `node:sqlite`: a second insert with the same key left one row.
  - The permission: dashboard area `"sales"`; label "Add custom items" / "Añadir artículos libres";
    help "Ring up something that is not on the menu, with a name and price typed at the till.
    Without this, ask someone who has it for their PIN." and its Spanish. Wording is the builder's
    within that sense.
- [ ] **Step 4:** Run the menu test file, the identity permissions tests, and every test that pins
  the permission list (`/usr/bin/grep -rln '"cash.drawer"' --include='*.test.ts' apps packages
  scripts` lists candidates; run each). Expect PASS.
- [ ] **Step 5: Commit** `Custom item: its permission and hidden products`.

### Task 2: Hidden products stay off lists and out of exports

The spec's "a manager cannot edit, place or delete them" is met by never listing them: no screen
offers their id. No by-id refusals and no text guard (plan review: a standing cost for little gain).

**Files:**
- Modify (add `notCustomItem` to the listing reads only): `packages/menu/src/product-items.ts`,
  `packages/menu/src/operations.ts` (`listProducts`), `packages/menu/src/product-names.ts`
  (`:36-61`, the name-taken check), `packages/menu/src/content-translation-candidates.ts` (raw SQL
  `from products p`, `:72-76` — add `p.custom_item_key is null`),
  `packages/menu/src/content-suggestion-collect.ts`, `packages/menu/src/categories.ts` (product
  counts), `packages/menu/src/set-menus.ts`, `packages/menu/src/extras.ts` (pickers),
  `packages/venue-service/src/routing-store.ts` (the manager-facing product list for routing rules
  only — NOT `productFacts` at `:888-917`, which the kitchen send uses)
- Modify: the `products` export declaration in `packages/db/src/configuration-transfer.ts` (`:180`)
  gains `leaveBehindWhenSet: "custom_item_key"`

- [ ] **Step 1: Failing tests**, each in the reader's existing suite, after
  `customItemProduct(tx, 2100, today)` and `customItemProduct(tx, null, today)`:
  - the dashboard product list and `listProducts` do not contain them;
  - a manager creating a product named "Custom item" succeeds;
  - the translation-gap report and translation candidates do not list them;
  - category product counts, set-menu and extras pickers and the routing rule product list do not
    include them;
  - exporting the configuration leaves both out, and importing that export succeeds (the plan
    review ran `validateMenuConfiguration` on two such rows: it refused `product.name_taken`).
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run the touched suites; PASS.
- [ ] **Step 5: Commit** `Custom item: hidden products stay off lists and out of exports`.

### Task 3: Reports show a "Custom items" row

**Files:**
- Modify: `packages/menu/src/sale-classification.ts` (`loadClassification`, `classifyLine`)
- Modify: `packages/reporting/src/category-sales.ts` (`CategoryTotal.kind`, `pathOf`)
- Modify: `apps/dashboard/src/api/client.ts` (node kind), `apps/dashboard/src/screens/dashboard-sales-screen.ts`
  (label beside `sales.uncategorised`, ~661), `apps/dashboard/src/i18n/strings.ts`
- Modify: `packages/shared/src/sale-line-classification.ts`

**Interfaces:**
- Produces: `CUSTOM_ITEMS_CLASSIFICATION_ID = "custom_items"` in `@waitron/shared`; a line whose
  product has a `custom_item_key` classifies as `{ reporting: [{ id: "custom_items", name: "" }] }`,
  returned by `classifyLine` BEFORE `validateSnapshot` (`:68-80`, which refuses empty names);
  `CategoryTotal.kind` gains `"custom_items"`.

- [ ] **Step 1: Failing tests:** `classifyLine` for a hidden product returns that snapshot;
  `category-sales` in both `at_time_of_sale` and `current` modes puts such a line under one node of
  kind `"custom_items"`, id `"custom_items"`, name `""`; the dashboard sales screen names it
  "Custom items" / "Artículos libres".
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement (`loadClassification` reads `custom_item_key`
  beside `categoryId`; `pathOf` maps the id before the `category` branch). **Step 4:** Run the three
  suites; PASS. **Step 5:** Commit `Custom item: its own row in the category report`.

### Task 4: The server adds a custom line (operator holds the permission)

**Files:**
- Modify: `wo` — `priceOrderLines` (~657-1170) gains a custom branch; the request line types
  (~5714-5735); `apps/server/src/till-api.ts` body types for `POST /api/working-orders` (~1859) and
  `PUT /api/working-orders/:id` (~1955); `apps/server/src/bill-payments.ts` (~193, ~1747) and
  `apps/server/src/bill-payments-api.ts` (the Counter payment route)
- Modify: `packages/venue-service/src/operations.ts` `lineContextColumns` (~1353): a custom line has
  no menu context (all context columns null, satisfying `working_order_lines_context_ck`)
- Modify: `packages/db/src/activity-kinds.ts` (new kind)
- Create: `apps/server/src/custom-item.ts`, `apps/server/src/custom-item.test.ts`

**Interfaces:**
- Wire (till → server), a NEW custom line in `lines`:
  `{ custom: { name: string; unitPriceGross: string; takeawayRateBp: number | null };
  quantity: string; makeAt?: string | null; note?: string }` — no `menuItemId`; `makeAt` absent or
  `null` means Nowhere. No PIN travels in `lines` (Task 5).
- `CustomItemConfirmation` (in `custom-item.ts`): `{ confirm(tx: Transaction): Promise<string |
  null> }` — resolves to the approver's person id, or `null` when the operator holds the permission;
  throws `authorization.not_permitted` `{ permission: "order.custom_item" }` otherwise. In this task
  it only checks the operator; Task 5 adds the approver.
- `priceOrderLines` takes an optional `customItems?: CustomItemConfirmation`; a new custom line
  without it refuses `management.request_invalid` `{ field: "lines" }`.
- Activity kind `"order.custom_item_added"`, subject `"working_order"`, data
  `{ lineId: string; itemName: string; unitPriceGross: string; approvedBy: string | null }`;
  `personId` is the operator.

- [ ] **Step 1: Failing tests** in `custom-item.test.ts`, through the real routes:
  - "a supervisor adds a custom line": stored row has the typed `name`, `descriptions` holding the
    name under each invoice language, `unit_price_gross`, `line_total` = price × quantity,
    `product_id` of the `"unchosen"` hidden product on an eat-in order, `vat_class` and
    `takeaway_vat_class` `'reduced'`, `menu_item_id` null, `make_at_station_id` null,
    `classification` `{ reporting: [{ id: "custom_items", name: "" }] }`; one
    `order.custom_item_added` activity row with `approvedBy: null`.
  - The same on the Counter's pay-straight-away route: the sale is filed with the typed name.
  - "a takeaway custom line lands on its rate's product": `takeawayRateBp: 2100` on a takeaway
    order → the `"2100"` product, `takeaway_vat_class` `'general'`.
  - "a takeaway custom line with no rate refuses": `management.request_invalid`
    `{ field: "takeawayRateBp" }`.
  - "staff without the permission refuses": `authorization.not_permitted`
    `{ permission: "order.custom_item" }`; nothing stored.
  - "a table round refuses a custom line": `management.request_invalid` `{ field: "lines" }`.
  - "bad fields refuse": a blank name, a price of `0`, `-1`, `1.234`, `abc` or one beyond the money
    column's range, a fractional quantity, an inactive station — each `management.request_invalid`
    naming `name`, `unitPriceGross`, `quantity` or `makeAt` (the station as the existing `makeAt`
    path refuses it). Parse the price with the parser `bill-payments-api.ts` uses for money
    (`moneyField`) or one of the same strictness.
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/custom-item.test.ts`; FAIL.
- [ ] **Step 3: Implement** the branch: it skips every offer, period, version, availability and
  modifier step; `name` trimmed with the length limit product names use; VAT classes and
  `productId` from `customItemProduct(tx, takeawayRateBp, <venue's local date>)`;
  `recordActivity` in the same transaction as the insert.
- [ ] **Step 4:** Run the file and the existing `priceOrderLines` suites. PASS.
- [ ] **Step 5: Commit** `Custom item: the server adds a custom line`.

### Task 5: A supervisor's PIN for someone without the permission

**Files:**
- Modify: `apps/server/src/custom-item.ts` — `parseCustomItemApproval`, `withCustomItemCheck`,
  modelled on `parseLateSend` / `withLateSendCheck` (`apps/server/src/late-send.ts:28-83`): the PIN
  is checked by `withPinCheckAhead` BEFORE the write transaction opens, throttled per device
- Modify: the three Counter routes of Task 4 read a top-level `customItemApproval` from the body
  and wrap their call as `withLateSendCheck` does (`till-api.ts` ~1889; `bill-payments-api.ts` 325,
  341)
- Modify: `apps/server/src/bill-payments.ts` (~1792-1800): `customItemApproval` is left out of the
  payment's retry fingerprint, as `lateSend` is (`:1799`)
- Add a route `POST /api/custom-item-approval` and its rows in
  `apps/server/src/till-api.profile-actions.test.ts` (action `take-orders`) and
  `till-api.session-person.test.ts` (`BODIES`)
- Modify: `apps/server/src/adjustments-api.ts` `requireApproverPermission` (accept
  `"order.custom_item"`)

**Interfaces:**
- Body field `customItemApproval?: { override: { personId: string; pin: string } }` — one per
  request, covering every new custom line in it.
- `POST /api/custom-item-approval` `{ personId, pin }` → `204` when the PIN is right and the person
  holds `order.custom_item`; `pin.invalid`, `pin.throttled` or `authorization.not_permitted`
  otherwise; same throttle.

- [ ] **Step 1: Failing tests:**
  - "staff with a supervisor's PIN adds it": stored; activity `approvedBy` = the supervisor's id.
  - "a wrong approver PIN refuses": `pin.invalid`; nothing stored.
  - "one approval covers two custom lines in one save".
  - "the approval is not part of the payment fingerprint": a retried Counter payment with the same
    lines and a different `customItemApproval` is the same payment.
  - "the approval route": `204` for a supervisor's right PIN; `pin.invalid` for a wrong one;
    `authorization.not_permitted` for a staff member's right PIN.
  - `listApprovers` for `order.custom_item` answers the supervisors and managers.
- [ ] **Step 2–4:** FAIL, implement, PASS (the file, both inventory tests).
- [ ] **Step 5: Commit** `Custom item: a supervisor's PIN`.

### Task 6: Reopening and saving again never re-price

**Files:**
- Modify: `wo` — `readBasketOrder` (~5498-5707, the throw at ~5608-5611), `saveHeldOrderIn`
  (~7352-7411, the match at ~7372-7387), `applyLineEdits` (~6141; `offerOf`/`menuItemOf` at
  ~6230-6303, ~6357-6534, including the three quantity-raise paths at ~6432, ~6468-6491, ~6492)
- Modify: the single-line edit route `PUT /api/working-orders/:id/lines/:lineNo` (`till-api.ts`
  ~4180): options or extras on a custom line refuse `management.request_invalid`
- Modify: the dead-ends routes `/api/dead-ends/sale` (~1809), `/order` (~3991) and `/draft`
  (~3881): stored custom lines are skipped (their destination is explicit)
- Test: `apps/server/src/custom-item.test.ts`

**Interfaces:**
- Wire, a STORED custom line re-sent: `{ workingOrderLineId: string; custom: true;
  quantity: string; makeAt?: string | null; note?: string }`.
- `getHeldOrder` returns a custom line as `{ workingOrderLineId, custom: true, name,
  unitPriceGross, takeawayRateChosen: boolean, quantity, makeAt, note }` (no `menuItemId`).

- [ ] **Step 1: Failing tests:**
  - "a held order with a custom line reopens": `GET /api/working-orders/:id` answers 200 with the
    line as above.
  - "re-sent custom line with a changed price refuses": re-sending the stored line's id with a
    `custom` object (new-line shape) → `management.request_invalid` `{ field: "lines" }`; stored
    row unchanged.
  - "custom line without its id is new and needs the permission": a staff member re-sending the
    stored line's fields with no `workingOrderLineId` and no approval →
    `authorization.not_permitted`.
  - "raising an unsent custom line": quantity and `line_total` follow the stored price.
  - "raising a sent custom line prices the extra units at the stored price": a new line, same
    product, no permission needed.
  - "raising a comped custom line charges the extra units in full": after a comp, the added units'
    `unit_price_gross` is the line's `list_unit_price_gross`, not the reduced price.
  - "a note and a station change save".
  - "cancel item, a comp and a discount work on a custom line" (spec item 6): each through its
    existing route; the stored results as for a menu dish.
  - "the kitchen checks skip custom lines": all three dead-ends routes answer as they do without
    the custom line.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement: match a re-sent `custom: true` line only by
  `workingOrderLineId` to a stored line whose product has a `custom_item_key`; its edits are
  quantity, note and `makeAt`; every raise prices from `list_unit_price_gross` when set, else
  `unit_price_gross`. **Step 4:** Run the file and `working-order.test.ts`. PASS.
- [ ] **Step 5: Commit** `Custom item: reopening and saving keep its price`.

### Task 7: Kitchen, takeaway switch and the payment check

**Files:**
- Modify: `wo` `fireLines` (~2334-2535): a line whose product has a `custom_item_key` and no
  `makeAtStationId` is stamped sent with no ticket, as the no-preparation branch does (~2527), and
  this is decided BEFORE the "no default station" refusal (~2441-2470)
- Modify: `apps/server/src/order-dining.ts` `switchOrderDining` (~96-145) and the
  `PUT /api/working-orders/:id/dining` body (`till-api.ts` ~2066)
- Modify: `apps/server/src/bill-payments.ts` `requireReadyForPayment` (~1593-1608), beside the
  set-menu refusal, and issuance (`wo` ~1269)
- Modify: the till API's error status table (`till-api.ts` ~436) for the new code
- Test: `apps/server/src/custom-item.test.ts`

**Interfaces:**
- Dining body gains `customItemRates?: { lineId: string; takeawayRateBp: number }[]`.
- New error `order.custom_item_rate_required` `{ lineIds: string[] }` (stored lines only), status
  409, registered in the server's error registry, worded in English and Spanish for the till.

- [ ] **Step 1: Failing tests:**
  - "a custom line sent nowhere prints no ticket": firing stamps `sent_at`, makes no ticket, and
    does not refuse `station.no_default` on a venue with no default station.
  - "a custom line sent to the bar goes to the bar".
  - "switching to takeaway asks for unchosen custom lines": without `customItemRates` →
    `order.custom_item_rate_required` with that line's id; with `2100` → the line points at the
    `"2100"` product with `takeaway_vat_class` `'general'`, and the order is switched in the same
    transaction (the plan review ran the freeze trigger: this update is allowed while the order is
    open).
  - "switching back to eat-in leaves custom lines as they are".
  - "paying a takeaway order with an unchosen custom line refuses before charging": the row
    written directly, as a till that skipped the prompt would leave it; refused by
    `requireReadyForPayment`, no payment row.
  - "paying a custom line files it": `sale_lines` has the typed name, the price, the rate for the
    order's way of eating, and the hidden product's id.
- [ ] **Step 2–4:** FAIL, implement, PASS (the file plus the existing dining and firing suites).
- [ ] **Step 5: Commit** `Custom item: kitchen, takeaway switch and payment`.

### Task 8: The till's custom item window

**Files:**
- Create: `apps/till/src/widgets/custom-item-dialog.ts`, `.test.ts`, `.a11y.test.ts`,
  `.unsaved.test.ts`
- Create: `apps/till/src/state/custom-item.ts` (`customItemRates`)
- Modify: `apps/till/src/i18n/*` (EN + ES)

**Interfaces:**
- Produces: `<till-custom-item-dialog>` with `takeaway: boolean`, `stations: Station[]`,
  `rates: number[]`; emits `custom-item-add` with `detail: { name: string; unitPriceGross: string;
  takeawayRateBp: number | null; makeAt: string | null }`, and `custom-item-cancel`.
- `customItemRates(today: string): number[]` — the same rule as the server's `customItemRatesOn`.

- [ ] **Step 1: Failing tests:**
  - Name (required, a field primitive); Price on the till's money number pad
    (`apps/till/src/widgets/numeric-pad.ts`, which a physical keyboard already drives); Send to (Nowhere first and selected,
    then each station by name); the rate choice only when `takeaway`, showing `21%`, `10%`, `4%`,
    `0%` and no other words; Add disabled until name, a price above zero and (on takeaway) a rate
    are given; inline field errors per the Forms contract (`docs/developers/design-system.md` →
    Forms).
  - Add emits `takeawayRateBp: null` when not takeaway.
  - a11y in both themes: empty, filled, takeaway with a rate chosen.
  - unsaved: closing with a typed name asks before discarding (`draftScopeFor`).
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5:** Commit `Custom item: the till's window`.

### Task 9: The Counter tile, the basket and the approval

**Files:**
- Modify: `apps/till/src/widgets/menu-browser.ts` (the dashed "+ Custom item" tile, shown only when
  the screen asks for it), `apps/till/src/screens/till-counter-screen.ts`
- Modify: `apps/till/src/state/working-order.ts` (`OrderLine` gains
  `custom?: { name: string; unitPriceGross: string; takeawayRateBp: number | null } | true`; the
  store holds one `customItemApproval` for the basket), `apps/till/src/state/order-line.ts`
  (`toWireProductIdentity` is not called for a custom line), `apps/till/src/till-app.ts`
  (`#currentSaleLines` ~8176-8197, `#basketLinesOf` ~10705-10780)
- Modify: `apps/till/src/api/client.ts` (wire types, `approveCustomItem(personId, pin)`,
  `listApprovers` type)
- Test: `apps/till/src/till-app-counter-custom-item.test.ts`

- [ ] **Step 1: Failing tests:**
  - The tile shows on the Counter, not on the table-order screen.
  - A person holding `order.custom_item` (session `permissions`) taps it, fills the window, and the
    basket shows the line with its typed name and price; Pay sends Task 4's new-line shape and no
    `customItemApproval`.
  - A person without it who TAPS the tile (spec item 5) is told why and gets the generic
    `till-supervisor-override-dialog` (authorizers from `listApprovers("order.custom_item")`); a
    right PIN (`approveCustomItem` answers 204) opens the window, and the next save carries
    `customItemApproval`; a wrong PIN shows the dialog's error and opens nothing.
  - The PIN is held only in memory until the save that stores the line, then dropped; a later save
    of the stored line sends Task 6's shape and no approval.
  - A parked order with a custom line reopens with the line shown and not marked "not offered".
  - The line shows the till's existing "allergens not recorded" mark, never "contains none".
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5:** Commit
  `Custom item: the Counter tile and approval`.

### Task 10: The till's takeaway switch, the guide and the backlog

**Files:**
- Modify: the till's dining switch — `#switchCounterDining` (`till-app.ts` ~10014-10019) for an
  unsaved basket, and the saved-order path that calls `PUT …/dining`. Switching to takeaway with
  custom lines whose rate was never asked opens a small window listing each by name with the rate
  choice; on an unsaved basket the choice is stored on the line in the till, on a saved order it is
  sent as `customItemRates`
- Modify: the till guide's Counter section, English and Spanish (`apps/till/src/help-guide.ts`
  names the files): one short paragraph — what Custom item is for, that it needs the permission or
  a supervisor's PIN, and that on takeaway it asks the VAT rate
- Modify: `docs/backlog/till.md` — delete "Custom item on the Counter (A738 residual)"; fix the
  references to it at ~449-450 (link to the deleted heading), ~1785 and ~2467 ("undecided"), and in
  A738's entry; `docs/backlog.md` — delete its summary bullet and fix ~659; `docs/backlog/fiscal.md`
  — add to the VAT rates entry the list of places piece A revisits (Global Constraints)
- Test: `apps/till/src/till-app-counter-custom-item.test.ts`

- [ ] **Step 1: Failing tests:** on an unsaved basket, switching to takeaway opens the rate window
  and the next Pay sends that line with `takeawayRateBp: 2100`; on a saved order, choosing `21%`
  sends `customItemRates: [{ lineId, takeawayRateBp: 2100 }]`; Cancel leaves the order eaten in; an
  order with no custom lines switches as today.
- [ ] **Step 2–4:** FAIL, implement, PASS; run `apps/server/src/guide-content.test.ts` and
  `scripts/guide-links.test.ts`. **Step 5:** Commit
  `Custom item: takeaway switch, guide and backlog`.

# A1522: one product, the right VAT eaten here or taken away — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** each product carries a served-here VAT class and an optional taken-away class; each order records whether it is eaten here or taken away, set from its department and switchable at a counter until it is first sent or paid; the till, the printed bill and the filed record all use the class that matches.

**Architecture:** the order line stores BOTH classes, frozen from the published menu when the line is added. The order stores its way of selling (`dining`). The class that applies is chosen in two places only: `priceOrderLines` (the gross a new order is priced and, for a walk-up sale, filed from) and `readLockedLines` (which every later bill, payment and filing reads). Switching an order, or moving it to another department, changes one column on the order and never rewrites a line. A database trigger refuses a change of `dining` once anything has reached the kitchen or been paid, so a code path that forgets the rule cannot file a payment and its invoice at different rates.

**Tech stack:** TypeScript, SQLite through drizzle, Hono routes, Lit (dashboard, till), Vitest (database tests through `useVenueDb`, browser tests in Chromium).

**Spec:** [`docs/superpowers/specs/2026-11-14-eat-in-takeaway-vat-design.md`](../specs/2026-11-14-eat-in-takeaway-vat-design.md). Read it first; this plan argues from it and does not repeat its reasons.

**Who lands it:** fiscal work. Full review path, per-task reviews, and the owner lands each PR.

**Reviews so far:** a fresh-context review against the spec and the code (14 November) found 13 points; all are folded in below. The two that would have filed a takeaway sale at the wrong rate were the walk-up sale's in-memory gross and bill merges moving lines outside `carveLines`.

## Global constraints

- Names in code: the order's way of selling is `dining`, values `"eat_in" | "takeaway"`. The department's setting is `dining`, values `"eat_in" | "takeaway" | "till_choice"`, plus `diningStartsAs`, values `"eat_in" | "takeaway"`. The product's second class is `takeawayVatClass` (`takeaway_vat_class`). The region flag is `takeawayVat`.
- Staff never see class names or percentages for this choice. The till's words are **Eat here** and **Take away** (Spanish: **Para tomar aquí** and **Para llevar**; the implementer may improve the Spanish, keeping it short).
- The existing VAT model holds: the published menu freezes classes, a line stores classes and never a percentage, the percentage is looked up at payment (`rateLines`, `packages/catalogue/src/pricing.ts:179`). Do not touch `VAT_CLASSES` or `VAT_RATE_TABLE`.
- Pre-live: schema changes edit the TypeScript schema (hand SQL only in `packages/db/triggers/core.sql`) and rebuild the starting migration with `pnpm --filter @waitron/db db:generate`; never a new migration. Every table touched here is in the `core` set. On a rebase conflict in `packages/db/drizzle/`, take main's copy and rerun the rebuild.
- The menu document format goes from 3 to 4 (`MENU_DOCUMENT_FORMAT`, `packages/catalogue/src/menu-document.ts:93`); a venue holding format 3 resets (`menu.reset_required`). Say so in PR 1's description.
- Every new refusal is an error code naming the domain concept, declared in the registry the throwing file imports, and worded in English and Spanish by the till (`codeMessage`) or the dashboard.
- Every new or changed form follows `docs/developers/design-system.md` → Forms. A screen change updates its guide in English and Spanish.
- Every commit `git commit -s`; plain-English messages. Each implementer runs `pnpm exec prettier --check` on the files it changed before committing.
- A department defaults to `dining = "eat_in"`, `diningStartsAs = "eat_in"` (spec, "my call"). A region without `takeawayVat` never produces a takeaway order, whatever a department says.
- PR CI tests only changed packages. A task that changes a shared table or type runs the tests of every package it touched locally, as listed in its steps.

## Decisions this plan makes that the spec left open

1. **Lines hold both classes; the order holds `dining`.** (Spec: "left to the builder".) `working_order_lines.vat_class` keeps its name and becomes the served-here class; `takeaway_vat_class` is added beside it, NOT NULL, already resolved (a product with no takeaway class stores its served class there). Nothing rewrites a line when an order switches. `working_line_contexts.vat_class` is left as it is: it feeds only the held-order read's product shape (`working-order.ts:5272`), which no rating or filing path reads.
2. **`dining` lives on `working_orders`**, NOT NULL with no database default, so every insert must name it.
3. **Table orders start eaten here** (owner confirmed, 14 November 2026). In a `till_choice` department an order opened at a table (service mode `table_tab`) starts `eat_in` whatever `diningStartsAs` says; counter orders start as `diningStartsAs`.
4. **"Sent" means the kitchen has it**: a line with `sent_at`, or any `ticket_items` row for the order's lines (a later course's dishes get ticket items without `sent_at`; `till-api.ts:1733-1743` already treats either as sent).
5. **Moving lines between two orders whose `dining` differs is refused** (`order.dining_differs`): lines follow their order, so a move would silently change a sent line's rate. The check sits in `moveOrderLines` (`working-order.ts:3986`, used by merges and whole-line moves) and in `carveLines`'s partial-split path.
6. **One rule for any department change**, applied wherever an existing order's department changes: `retargetOrderServiceContext` and `move-bill.ts` `adoptZone`'s new-context branch (`:606-607`). A whole-table move that would change a locked bill's way is refused for the whole table.
7. **The live menu patch keeps VAT and edits both classes as plain values.** A published menu holds each takeaway class already resolved, so the patch window shows both classes as the values the live menu holds, with no "same as served here" choice, and changing one never changes the other. The patch exists to correct a wrong VAT class at once without publishing unfinished product work (A1151).
8. **The department setting is saved through the dashboard only from PR 3**, together with the till's label and switch, so no screen-reachable takeaway sale exists while the till cannot show it. PR 2's tests set the policy with `setDepartmentSalePolicyField`.
9. **The demo's restaurant drinks take away at 21%.** The restaurant's cola, cola zero and bottled beer gain `takeawayVatClass: "general"`, and the deli menu lists those same products, as the spec's Demo section says.

## Review focus

The inputs the spec implies that no happy-path test meets. Each has its test in the named task.

1. **A walk-up counter sale filed in one request**, cash (`POST /api/sales`) and card (`POST /api/pay` with no parked order): filed from the in-memory gross. Expect a takeaway Coca-Cola to file at 21%. Test in Task 12.
2. **An order paid in parts.** The first payment fixes the way; the second payment and the final invoice use the same rate. Test in Task 15.
3. **A variant that overrides only its served-here class**, in a product that has a takeaway class. Expect the variant's takeaway class to be its own served class (spec, "my call"), and the editor's hint to say so. Tests in Tasks 3 and 6.
4. **A region without the distinction** (`GB-vat`) whose department row says takeaway (API or imported configuration). Expect every order `eat_in` and a request for `takeaway` refused. Test in Task 11.
5. **The menu republished between adding a line and switching the order.** Expect the switch to use the classes frozen on the line. Test in Task 13.
6. **A table round that is all later-course dishes.** Ticket items exist, `sent_at` does not; expect the way to be fixed. Test in Task 9.

---

## PR 1 — products carry a takeaway class (no sale changes yet)

### Task 1: confirm the Veri*Factu record needs no goods-or-service marker

Research, not code. It gates PR 2.

**Files:** create `docs/compliance/research/2026-11-14-takeaway-verifactu-record.md`.

- [ ] **Step 1:** read the AEAT Veri*Factu schema for `RegistroAlta` → `Desglose` → `DetalleDesglose` (find the XSD and the technical specification the repo cites with `/usr/bin/grep -rln "DetalleDesglose" packages/fiscal-verifactu docs/compliance`). Record, quoting the source, every field of `DetalleDesglose` and whether any distinguishes goods from services. Today Waitron sends `ClaveRegimen "01"`, `CalificacionOperacion "S1"`, base, rate and tax (`packages/fiscal-verifactu/src/backend.ts:150-158`).
- [ ] **Step 2:** record whether `DescripcionOperacion` (from `apps/server/src/sale-operation-description.ts`) has any rule a takeaway sale would break. Note it reads the zone's CURRENT department (`resolveSalePolicy(tx, context.zoneId)`), not the order's stored one.
- [ ] **Step 3:** if either answer is "a marker is needed" or "unclear", stop and tell the driver: PR 2 waits for the owner. Otherwise write the note (a provenance row per source, quote then paraphrase) and commit: "docs: check that a takeaway sale needs no extra marker in the Veri*Factu record (A1522)".

### Task 2: each fiscal region says whether it charges takeaway differently

**Files:**
- Modify: `packages/country/src/country.ts:50-55`, `packages/country-es/src/spain.ts:335-345`, `packages/country-packs/src/registry.ts`
- Create: `packages/shared/src/dining.ts` (exported from `@waitron/shared`)
- Test: `packages/country-packs/src/registry.test.ts`, `packages/country-es/src/spain.test.ts`, `packages/shared/src/dining.test.ts`

**Interfaces — produces:**
- `FiscalJurisdiction.takeawayVat?: true`, set on `ES-common` only.
- `chargesTakeawayVat(country: string, territory: string): boolean` in `registry.ts`; false for an unknown country or territory.
- In `dining.ts`: `DININGS = ["eat_in", "takeaway"] as const`, `type Dining`; `DINING_POLICIES = ["eat_in", "takeaway", "till_choice"] as const`, `type DiningPolicy`; `appliedVatClass(dining: Dining, line: { vatClass: VatClass; takeawayVatClass: VatClass }): VatClass`.

- [ ] **Step 1: failing tests.** `chargesTakeawayVat("ES", "ES-common")` true; `("ES", "ES-canary")`, `("GB", "GB-vat")`, `("XX", "ES-common")` false. Only `ES-common` carries the flag. `appliedVatClass("takeaway", { vatClass: "reduced", takeawayVatClass: "general" })` is `"general"`; `"eat_in"` gives `"reduced"`.
- [ ] **Step 2:** run each file (`pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts`, likewise `@waitron/country-es`, `@waitron/shared`); expect failures on the missing exports.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass; typecheck the three packages.
- [ ] **Step 5:** commit: "Say which fiscal regions charge food and drink taken away at a different VAT rate (A1522)".

### Task 3: store and resolve the takeaway class (schema and catalogue reads)

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts:75,132-135`, then rebuild the baseline
- Modify: `packages/catalogue/src/variant-fallback.ts:102,117`, `variants.ts:487-561`, `operations.ts` (`PRODUCT_BASE_COLUMNS`, `RawProduct`, `toProduct`, `offerLineColumns`/`offerLineValues`, `listedVariantsOfProducts`, `listAvailableProducts`), `offered-modifiers.ts:122,153`
- Modify: `packages/shared/src/menu-document/product-types.ts` (`Product`, `ListedVariant.effective`), `menu-types.ts` (`MenuOffer`, `MenuOfferVariant`, `AvailableProduct`, `OfferedExtraItem`)
- Test: `packages/catalogue/src/variant-fallback.test.ts`, `packages/db/src/schema/catalogue.test.ts`

**Interfaces — produces:**
- `products.takeaway_vat_class` nullable, CHECK `products_takeaway_vat_class_ck` in the same form as `products_vat_class_ck`; not part of `products_top_level_owns_ck`.
- `effectiveProductColumns.takeawayVatClass` = `coalesce(own.takeaway_vat_class, own.vat_class, parent.takeaway_vat_class, parent.vat_class)`, typed `VatClass`.
- `Product.takeawayVatClass: VatClass | null` (stored). Effective `takeawayVatClass: VatClass` on `MenuOffer`, `MenuOfferVariant`, `AvailableProduct`, `OfferedExtraItem`, `ListedVariant.effective`. `SellingValues` and `selectMenuVariant` return it beside `vatClass`.

- [ ] **Step 1: failing tests.** `variant-fallback.test.ts`: product `{ vatClass: "reduced", takeawayVatClass: "general" }` with variants: nothing set → effective takeaway `"general"`; only `vatClass: "super_reduced"` → `"super_reduced"` (Review focus 3); `takeawayVatClass: "zero"` → `"zero"`. A product with no takeaway class → its `vatClass`. `catalogue.test.ts`: `takeaway_vat_class = 'nope'` refused by the new CHECK.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement; `pnpm --filter @waitron/db db:generate`.
- [ ] **Step 4:** pass; root guards `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts`; typecheck `@waitron/catalogue`, `@waitron/server`, `@waitron/till`, `@waitron/dashboard`.
- [ ] **Step 5:** commit: "Store a VAT class for when a product is taken away, and work out a variant's (A1522)".

### Task 4: the product editor input, save and API accept the takeaway class

**Files:**
- Modify: `packages/catalogue/src/product-editor-input.ts:103-114,163,211`, `product-editor.ts:37,58,77,192,210`, `operations.ts` (`insertProduct`, `patchProduct`, `CreateProductInput`, `UpdateProductInput`)
- Modify: `packages/shared/src/menu-document/product-types.ts` (`ProductEditorInput`, `InheritedValues`)
- Modify: `apps/server/src/catalogue-api.ts:1481-1509`; `packages/module/src/module.ts:234,289,432,1183`
- Test: `packages/catalogue/src/product-editor-input.test.ts`, `product-editor.test.ts`, `apps/server/src/catalogue-api.test.ts`

**Interfaces — produces:** `ProductEditorInput.takeawayVatClass: VatClass | null` (null = empty, on a product or a variant); `InheritedValues.takeawayVatClass: VatClass` (the parent's effective takeaway class).

- [ ] **Step 1: failing tests.** `"nope"` refused `product.invalid { field: "takeawayVatClass" }`; `null` accepted on a top-level product; save then read returns the stored value; a variant's `inherited.takeawayVatClass` is the parent's effective one; `POST /management-api/products` with `takeawayVatClass: "general"` stores it.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass; typecheck `@waitron/catalogue`, `@waitron/server`, `@waitron/module`.
- [ ] **Step 5:** commit: "Let the product editor save a takeaway VAT class (A1522)".

### Task 5: publishing freezes both classes; live patches and change lists know the new field

**Files:**
- Modify: `packages/catalogue/src/menu-document.ts:93` (format 4), `PRODUCT_FACTS` (`:803`: the `"vat"` fact reads `["vatClass", "takeawayVatClass"]`), `EXTRA_FACTS` (`:811`), `productFields` (`:879`); `packages/shared/src/menu-document/menu-document-types.ts:95` (`format: 4`)
- Modify: `packages/catalogue/src/menu-patch-types.ts:20-27` (`"takeawayVatClass"` for `offer`, `variant`, `extra`), `menu-patch.ts:101-103`, `menu-navigation.ts:176,252,357`
- Modify: `apps/till/src/api/client.ts:354,389,404,488`, `apps/dashboard/src/api/client.ts:526`
- Test: `packages/catalogue/src/menu-document.test.ts`, `menu-publication.test.ts`, `menu-patch.test.ts`

- [ ] **Step 1: failing tests.** A published offer, each variant and each extras item carry the effective `takeawayVatClass`; changing only a product's takeaway class lists it with `"vat"` changed; a stored format-3 document is refused `menu.reset_required`. Patching an offer's `takeawayVatClass` to `"general"` changes that copy only; `"nope"` refused `menu_patch.invalid`; patching only `vatClass` leaves the copy's `takeawayVatClass` as it was (Decision 7).
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass; typecheck `@waitron/catalogue`, `@waitron/till`, `@waitron/dashboard`.
- [ ] **Step 5:** commit: "Freeze the takeaway VAT class when a menu is published, and let a live patch correct it (A1522)".

### Task 6: the product editor shows the takeaway class where the region has it

**Files:**
- Modify: `apps/server/src/venue-settings-api.ts:111-134` (venue defaults read gains `takeawayVat: boolean` from `chargesTakeawayVat(readTenant(tx).country, readVenue(tx).fiscalTerritory)`)
- Modify: `apps/dashboard/src/widgets/product-editor.ts` (`renderTax` `:1413-1440`, `SERVER_FIELDS`, `DRAFT_ERROR_KEYS`, `emptyDraft`, `validate`, `pricingSummary`), `product-editor-model.ts:22-27`, `apps/dashboard/src/screens/catalogue-screen.ts:772`, `apps/dashboard/src/i18n/strings.ts`
- Modify: `apps/server/src/guide/en/products.md` and `es/products.md`, section `{#vat}`
- Test: `apps/dashboard/src/widgets/product-editor.test.ts`, `product-editor.unsaved.test.ts`, `apps/server/src/venue-settings-api.test.ts`

**Produces:** `product-editor` property `takeawayVat: boolean`; a `wt-combobox name="takeawayTax"` labelled "VAT when taken away".

- [ ] **Step 1: failing tests.** With `takeawayVat` true: the field is drawn; its empty choice reads "Same as served here — <class and rate>" on a product, and on a variant names the class the spec's rule gives (own served class if set, else the product's takeaway class). Empty saves `null`; General saves `"general"`. Changing only this field enables Save and leaving asks about unsaved changes. With `takeawayVat` false: no field, and a save sends the stored value unchanged. `venue-settings-api.test.ts`: `ES-common` reads `takeawayVat: true`, `GB-vat` `false`.
- [ ] **Step 2:** run (`pnpm --filter @waitron/dashboard exec vitest run <file>`; browser mode, check `memory_pressure | grep free` first); expect failures.
- [ ] **Step 3:** implement. The hint is the placeholder. Update `{#vat}` in English and Spanish: one or two sentences on what the second field is for and that empty means the same as served here.
- [ ] **Step 4:** pass; `apps/server/src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`. Look at the editor in both themes and at phone width.
- [ ] **Step 5:** commit: "Show the takeaway VAT class in the product editor where the region charges it (A1522)".

### Task 7: the product list, details and live patch window show the takeaway class

**Files:**
- Modify: `apps/dashboard/src/widgets/product-details.ts:107-126`, `product-list.ts:1095-1105` (the `vat-note` also shows when a variant's effective takeaway class differs from the product's), `menu-patch-dialog.ts` (`:85`, `:813-817`, `:903-914`, `:1262-1277`), `menu-patch-review.ts:21`
- Test: `product-details.test.ts`, `product-list.test.ts`, `menu-patch-dialog.test.ts`, `menu-patch-review.test.ts`

- [ ] **Step 1: failing tests.** With `takeawayVat` true: details show both classes; the patch window shows two class fields for an offer holding the live menu's two values, with no "same as served here" choice; changing only the served class sends one change for `vatClass` and none for `takeawayVatClass`; the review lists each changed class under its own label. With `takeawayVat` false: one class field, as today.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass. Look at the patch window in both themes and at phone width.
- [ ] **Step 5:** commit: "Show and patch the takeaway VAT class in the product list and the live menu (A1522)".

**End of PR 1.** `/finish-branch`. First line of the PR description: "Resets every venue: the menu document format moves to 4."

---

## PR 2 — orders are eaten here or taken away, and file at the matching rate

Starts only once Task 1's note says no marker is needed.

### Task 8: each department stores how it sells (server, no save route yet)

**Files:**
- Modify: `packages/db/src/schema/venue-service/service.ts:49-68`, `packages/db/src/schema/sale-rule-types.ts`
- Modify: `packages/venue-service/src/operations.ts` (`createDepartment` `:170`, `EffectiveSalePolicy`/`resolveSalePolicy` `:500-544`, `listSalePolicies` `:582`, `setDepartmentSalePolicyField` `:624`), `provisioning.ts:82`, `configuration-transfer.ts:552-670`, `routes.ts` `readModel` (`:481-484`, gains `takeawayVat: boolean`)
- Create: `packages/venue-service/src/dining.ts`
- Test: `packages/venue-service/src/dining.test.ts`, `packages/venue-service/src/routes.test.ts`, `packages/db/src/schema/venue-service/migrations.test.ts`

**Produces:**
- Columns `dining` (enum `DINING_POLICIES`, NOT NULL, default `"eat_in"`) and `dining_starts_as` (enum `DININGS`, NOT NULL, default `"eat_in"`), CHECKs by `enumCheck`.
- In `dining.ts`: `venueChargesTakeawayVat(tx: Transaction): Promise<boolean>`; `departmentDining(tx: Transaction, departmentId: string): Promise<{ dining: DiningPolicy; startsAs: Dining }>`.

- [ ] **Step 1: failing tests.** A new department reads `eat_in` / `eat_in`; `setDepartmentSalePolicyField(tx, id, "dining", "till_choice")` then `departmentDining` reads it; `venueChargesTakeawayVat` is false for a `GB-vat` venue; `readModel.takeawayVat` true for `ES-common`; a configuration export then import keeps both values.
- [ ] **Step 2:** run (`pnpm --filter @waitron/venue-service exec vitest run <file>`); expect failures.
- [ ] **Step 3:** implement; `pnpm --filter @waitron/db db:generate`.
- [ ] **Step 4:** pass; root guards `scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts`.
- [ ] **Step 5:** commit: "Store whether each department sells to eat in, to take away, or lets the till choose (A1522)".

### Task 9: the order records its way, and the database fixes it once the kitchen has it or money is taken

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`working_orders.dining`; `working_order_lines.takeaway_vat_class` with CHECK `working_order_lines_takeaway_vat_class_ck`; the doc comment at `:61-62`)
- Modify: `packages/db/triggers/core.sql`: `dining` joins the unchanged columns of `working_orders_enforce_transition` (`:543`) for `placed → placed` and `placed → settled/abandoned`; `takeaway_vat_class` joins `vat_class` in every branch of `working_order_lines_require_open_parent_update` (`:375-478`); new trigger `working_orders_dining_fixed`
- Modify: `packages/db/src/trigger-refusals.ts`
- Create: `packages/db/src/order-dining.ts`, added to `@waitron/db`'s enumerated `exports`
- Test: `packages/db/src/order-dining.test.ts`

**Produces:**
- `working_orders.dining` enum `DININGS`, NOT NULL, no default. `working_order_lines.takeaway_vat_class` NOT NULL.
- Trigger `working_orders_dining_fixed`: BEFORE UPDATE OF `dining` ON `working_orders`, when `new.dining IS NOT old.dining` and any of: `old.status <> 'open'`; `old.payment_attempt_at IS NOT NULL`; a line of the order with `sent_at IS NOT NULL`; a `ticket_items` row for a line of the order (Decision 4); a `bill_payments` row for the order in state `pending` or `received`; a `sales` row for the order.
- `orderDiningLocked(tx: Transaction, workingOrderId: string): Promise<"sent" | "paid" | null>`: the same conditions; `"sent"` for status, `sent_at` and ticket items, `"paid"` for the money ones.

- [ ] **Step 1: failing test** in `order-dining.test.ts`, ONE table of set-ups each run against both the trigger (update `dining`, expect refusal text or success) and `orderDiningLocked` (expect `null`/`"sent"`/`"paid"`): fresh open order (allowed, null); one line `sent_at` stamped ("sent"); one `ticket_items` row and no `sent_at` — a round of later-course dishes (Review focus 6, "sent"); `payment_attempt_at` set ("paid"); a `received` payment ("paid"); a `failed` payment (allowed, null); a `sales` row ("paid"); a placed order ("sent"). Also: changing `takeaway_vat_class` on a placed order's line is refused like `vat_class`.
- [ ] **Step 2:** this task leaves inserts elsewhere broken until Task 10; run only `pnpm --filter @waitron/db exec vitest run src/order-dining.test.ts src/schema/orders.transition.test.ts`, adding `dining`/`takeaway_vat_class` to the inserts in those two files; expect failures.
- [ ] **Step 3:** implement; `pnpm --filter @waitron/db db:generate`.
- [ ] **Step 4:** pass; root guards `scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`.
- [ ] **Step 5:** commit: "Record on each order whether it is eaten here or taken away, fixed once the kitchen has it or money is taken (A1522)". Tasks 9 and 10 go to review together.

### Task 10: every writer of orders and lines names the new columns

**Files:** every insert of `working_orders` or `working_order_lines`, found with
`/usr/bin/grep -rlE "insert\((workingOrders|workingOrderLines)\)|insert into (working_orders|working_order_lines)" --include='*.ts' packages apps scripts bench` (the raw-SQL inserts are invisible to the typecheck). Includes `apps/server/src/working-order.ts:1525,1551,2935,4767,6561`, `packages/bookings/src/testing/fake-core.ts:71`, `packages/db/src/testing/seed.ts:245`, `packages/reporting/test/fixtures.ts:433,473`, `packages/payments/src/reconcile.test.ts`, `packages/venue-service/src/menu-timetable.test.ts`, and the `apps/server/src/testing/*` helpers.

- [ ] **Step 1:** in production code, pass `dining: "eat_in"` and `takeawayVatClass: <the row's vatClass>` for now; Tasks 11 and 12 replace them. In tests and helpers, give a helper a `dining` option defaulting to `"eat_in"`.
- [ ] **Step 2:** typecheck every package the grep named, then run each of those packages' tests locally (`pnpm --filter <pkg> test`; check free memory first). Expected: all pass, no behaviour changed.
- [ ] **Step 3:** commit: "Name the order's way of selling wherever orders and lines are written (A1522)".

### Task 11: a new order takes its way from its department

**Files:**
- Modify: `packages/venue-service/src/dining.ts` (`resolveOrderDining`), the port (`packages/venue-service/src/service.ts:173,241`; `packages/module/src/module.ts:983,1142,1220`), `packages/venue-service/src/errors.ts`
- Modify: `apps/server/src/working-order.ts` `createOpenOrder` (`:1412-1562`, writes `dining`; a split or check order copied from another copies the source's `dining`)
- Modify: `apps/server/src/till-sale.ts:773,1331`, `parties.ts:173`, `bill-actions.ts:310`, `order-drafts.ts:168`; `apps/server/src/till-api.ts` (`POST /api/sales` `:1786`, `POST /api/pay` `:1846`, `POST /api/working-orders` `:1917` accept optional `dining`)
- Test: `packages/venue-service/src/dining.test.ts`; create `apps/server/src/order-dining.start.test.ts`

**Produces:** `resolveOrderDining(tx: Transaction, zoneId: string, requested: Dining | undefined): Promise<Dining>`, on the port. Region without `takeawayVat` → `"eat_in"`; a requested `"takeaway"` refused `order.dining_fixed { dining: "eat_in" }`. Department `eat_in`/`takeaway` → that; a different request refused `order.dining_fixed { dining }`. `till_choice` → the request if given; else `"eat_in"` for a `table_tab` zone (Decision 3), else `startsAs`.

- [ ] **Step 1: failing tests.** Each rule above, including Review focus 4 (a `GB-vat` venue whose department row says `takeaway`). Through the routes: in a takeaway department a parked order has `dining = "takeaway"`; in a `till_choice` department a walk-up `POST /api/sales` with `dining: "takeaway"` creates a takeaway order, and without `dining` one as `startsAs`; a table order there starts `eat_in` with `startsAs = "takeaway"`.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement; replace Task 10's placeholder `dining`.
- [ ] **Step 4:** pass; also `src/working-order.test.ts`, `src/till-api.fiscal-sale-paths.test.ts`.
- [ ] **Step 5:** commit: "Start each order eaten here or taken away from its department (A1522)".

### Task 12: lines store both classes, and a new order is priced at the class that applies

**Files:**
- Modify: `apps/server/src/working-order.ts` `priceOrderLines` (`:598-1074`): takes `dining: Dining`; stored rows carry `vatClass` and `takeawayVatClass` from the per-line data (dish: the selection's two effective classes; extras child: the extra product's two; set-lunch child: the dish's `vatClass` for both, as `:936` does today); the gross it returns is built with `appliedVatClass(dining, line)` (so `createOpenOrder`'s returned gross, filed directly by walk-up cash `till-sale.ts:767-799` → `fileImmediateSale` and walk-up card `:1329-1376` → `finalizeCapture`, carries the right class); refuses a set lunch when `dining` is `"takeaway"`. `priceTabRound` (`:2886`) and `applyLineEdits` (`:6146`) pass the order's stored `dining`
- Modify: `apps/server/src/modifier-selection.ts` (`ExtraProductFacts`, `ExtraChild`, `buildLineExtras`, `editLineExtras`)
- Modify: `apps/server/src/errors.ts`
- Test: `apps/server/src/order-dining.start.test.ts`; create `apps/server/src/order-dining.walk-up.test.ts`

**Produces:** `order.set_lunch_takeaway { canSwitch: boolean }`; `canSwitch` is true only when the department is `till_choice`, the region has the distinction, and `orderDiningLocked` is null.

- [ ] **Step 1: failing tests.** A takeaway order's Coca-Cola line stores `vat_class = "reduced"`, `takeaway_vat_class = "general"`; a cheese line stores its `super_reduced`; an extra on a takeaway dish stores the extra product's own two classes. Review focus 1 in `order-dining.walk-up.test.ts`: walk-up cash `POST /api/sales` and walk-up card `POST /api/pay`, each `dining: "takeaway"` with a €1.80 Coca-Cola, file `sale_lines.vat_rate = 2100` and base €1.49; the same eat-in file 1000 and €1.64. A set lunch on a takeaway order is refused `order.set_lunch_takeaway`, with `canSwitch` true in an open `till_choice` order and false in a takeaway department; on an eat-in order it is accepted.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement; replace Task 10's placeholder `takeawayVatClass`.
- [ ] **Step 4:** pass; also `src/vat-class-at-line-add.test.ts`, `src/working-order.test.ts`, `src/lunch-*.test.ts` unchanged.
- [ ] **Step 5:** commit: "Keep both VAT classes on each line and price a new order for how it is sold (A1522)".

### Task 13: every later bill, payment and filing rates a line by its order's way

**Files:**
- Modify: `apps/server/src/working-order.ts:1099-1232`: `storedLineColumns.vatClass` becomes `case when working_orders.dining = 'takeaway' then working_order_lines.takeaway_vat_class else working_order_lines.vat_class end`; `readLockedLines` (`:1134`) and `readLockedLinesForIssuance` (`:1150`) join `working_orders` on the line's own order
- Test: create `apps/server/src/order-dining.filing.test.ts`; extend `apps/server/src/vat-rate-at-issue.test.ts`

- [ ] **Step 1: failing tests.** A €1.80 Coca-Cola (`reduced`/`general`) and cheese (`reduced`/`super_reduced`): a parked takeaway order paid whole files 2100 and 400, the backend's `vatBreakdown` has 21% and 4% bands; a takeaway bill paid in two `items` payments — both previews and the final invoice use 21% (Review focus 2); a takeaway tab closed by deferred close (`issueUnpaidInvoice`) files 21%. Review focus 5: add the cola, republish with its takeaway class changed to `zero`, switch the open order to takeaway by a direct update, pay: files 21%.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement. Read the emitted SQL with `.toSQL()` once.
- [ ] **Step 4:** pass; also `src/bill-payments.test.ts`, `src/till-api.split-bill.test.ts`, `src/working-order.pay-and-dispatch.test.ts`, `src/adjustments*.test.ts`.
- [ ] **Step 5:** commit: "File each line at the VAT rate for how its order was sold (A1522)".

### Task 14: the till's order read says how the order is sold and whether it can switch

**Files:**
- Modify: the order reads the till gets (`GET /api/working-orders/:id`, `/placed`, and the party/tab reads that carry `serviceMode`, in `apps/server/src/till-api.ts` and the functions they call) gain `dining: Dining` and `diningChoice: "none" | "open" | "locked"`
- Test: create `apps/server/src/order-dining.read.test.ts`

**Produces:** `diningChoice`: `"none"` when the department is fixed or the region has no distinction; `"open"` when `till_choice` and `orderDiningLocked` is null; `"locked"` when `till_choice` and locked.

- [ ] **Step 1: failing tests.** The three values in the three set-ups; `"open"` turns `"locked"` after `POST .../lines/send`.
- [ ] **Step 2–4:** run (fail), implement, pass.
- [ ] **Step 5:** commit: "Tell the till how each order is sold and whether it can still switch (A1522)".

### Task 15: switching an order, and moving lines between orders

**Files:**
- Create: `apps/server/src/order-dining.ts` (`switchOrderDining`)
- Modify: `apps/server/src/till-api.ts` — `PUT /api/working-orders/:id/dining`
- Modify: `apps/server/src/working-order.ts` — `moveOrderLines` (`:3986`) refuses `order.dining_differs` when the two orders' `dining` differ; `carveLines` (`:4584`) copies `takeawayVatClass` (`:4605`, `:4779`) and does the same check on its partial-split path
- Modify: `apps/server/src/errors.ts`
- Test: create `apps/server/src/order-dining.switch.test.ts`; rows in `till-api.profile-actions.test.ts` (refusing case and inventory row), `till-api.profile-zones.test.ts`, and `till-api.session-person.test.ts` (`BODIES`)

**Produces:** `switchOrderDining(tx: Transaction, cfg: TradingContext, workingOrderId: string, dining: Dining, revision: number): Promise<void>`. In order: unknown order → the existing not-found code; not open or wrong revision → `working_order.out_of_date`; department not `till_choice`, or no regional distinction → `order.dining_fixed { dining }`; locked → `order.dining_locked { reason }`; to takeaway with a set-lunch line → `order.set_lunch_takeaway { canSwitch: false }`; else set `dining` and `revision + 1`. `order.dining_differs { fromOrderId, toOrderId }`.

- [ ] **Step 1: failing tests.** Switch eat-in → takeaway on a fresh counter order succeeds and bumps the revision; stale revision refused; after sending, `order.dining_locked { reason: "sent" }`; after one received payment, `{ reason: "paid" }`; in an `eat_in` department, `order.dining_fixed`; with a set lunch, `order.set_lunch_takeaway`. `POST /api/bills/:id/merge` of a takeaway bill into an eat-in bill refused `order.dining_differs`; `POST /api/bills/:id/move-dishes` likewise, including a partial quantity; between two takeaway bills both work and the moved lines keep both classes.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass, with the three guards above and `src/till-api.split-bill.test.ts`, `src/bill-actions*.test.ts`.
- [ ] **Step 5:** commit: "Let staff switch a counter order until it is sent or paid, and keep moved dishes at their order's rate (A1522)".

### Task 16: moving an order to another department

**Files:**
- Modify: `packages/venue-service/src/dining.ts` (`applyDepartmentDining`), `operations.ts` `retargetOrderServiceContext` (`:1049-1070`) calls it when the department changes; `apps/server/src/move-bill.ts` `adoptZone` (`:596-612`) calls it in its new-context branch; `packages/venue-service/src/errors.ts`
- Test: `packages/venue-service/src/department-transfers.test.ts`, `apps/server/src/department-transfer-api.test.ts`, `apps/server/src/table-actions*.test.ts` (whole-table move)

**Produces:** `applyDepartmentDining(tx: Transaction, workingOrderId: string, departmentId: string, zoneId: string): Promise<void>`, on the port. No regional distinction: nothing. Not locked: `dining` becomes the department's fixed way, or for `till_choice` its `startsAs` (`eat_in` for a table zone); becoming takeaway with a set lunch refused `order.set_lunch_takeaway { canSwitch: false }`. Locked: kept; a department fixed the other way refused `order.department_dining_differs { dining, departmentDining }`.

- [ ] **Step 1: failing tests.** An unsent counter order from a takeaway department accepted into an eat-in department becomes `eat_in`; a sent takeaway order into an eat-in department refused `order.department_dining_differs`, also through the route; a sent takeaway order into a `till_choice` department keeps `takeaway`. A whole-table move holding one locked takeaway bill into an eat-in department's zone is refused for the whole table, and the refusal names that bill.
- [ ] **Step 2–4:** run (fail), implement, pass; also `apps/server/src/move-bill*.test.ts`.
- [ ] **Step 5:** commit: "Keep an order's way of selling right when it moves to another department (A1522)".

**End of PR 2.** `/finish-branch`, full wave (fiscal risk trigger: two Codex run-it seats).

---

## PR 3 — the dashboard, the till, printing and the demo

### Task 17: the department settings show "How it sells"

**Files:**
- Modify: `packages/venue-service/src/routes.ts` (`requireSalePolicyField` `:151-165`; `PUT .../departments/:departmentId/settings` `:730-794` accepts `dining` and `diningStartsAs`), `operations.ts` (`DepartmentEditInput` `:659-670`, `saveDepartmentEditSettings` `:672-705`)
- Modify: `packages/venue-service/src/dashboard/service-settings-fields.ts` (two `wt-combobox search="never"`: **How it sells** — Eaten in / Taken away / Chosen on the till; **Starts as** — Eaten here / Taken away, only for Chosen on the till), `department-settings.ts` (`fieldTab`, `equal()`, draft, `fieldRefusal`, `save()`), `client.ts:27-52,305-314`, `strings.ts`
- Modify: `apps/server/src/guide/en/table-service.md` and `es/table-service.md`: new section `{#eat-here-or-take-away}` (shared id), written from the code
- Test: `routes.test.ts`, `service-settings-fields.test.ts`, `service-settings-fields.a11y.test.ts`, `department-settings.test.ts`, `department-settings.unsaved.test.ts`

- [ ] **Step 1: failing tests.** The route saves `{ dining: "till_choice", diningStartsAs: "takeaway" }` and refuses `dining: "sometimes"` naming the field. With `takeawayVat` true the Service tab shows How it sells (Eaten in for a new department); Chosen on the till reveals Starts as; changing only these enables Save; leaving asks about unsaved changes. With `takeawayVat` false neither is drawn. Axe passes in both themes with Starts as shown.
- [ ] **Step 2–4:** run (browser mode; check free memory), implement, pass; plus `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`. Look at the dialog in both themes and at phone width.
- [ ] **Step 5:** commit: "Show and save how each department sells (A1522)".

### Task 18: the till holds each order's way and sends it

**Files:**
- Modify: `apps/server/src/till-setup.ts:35-117` (`readSetupFields` gains `takeawayVat: boolean`, so it refreshes through `setupRevision`)
- Modify: the zone catalogue read that builds `ZoneOfferCatalogue.context` (from `apps/server/src/till-api.ts`), gaining `dining: { policy: DiningPolicy; startsAs: Dining } | null` (null without the regional distinction). It refreshes when a department changes: `department_sale_policies` is in the till's live `menu` group (`apps/till/src/api/live-connection.ts:141-158`); the test pins it.
- Modify: `apps/till/src/api/client.ts` (context and order types; `switchDining(orderId, dining, revision)`; the sale, park and pay bodies send `dining` only when the context's policy is `till_choice`), `apps/till/src/state/working-order.ts` (`dining`, `setDining`)
- Test: `apps/till/src/state/working-order.test.ts`, the client test that pins request bodies, `apps/server/src/till-setup.test.ts`

**Produces:** `WorkingOrder.dining: Dining`; `WorkingOrder.setDining(dining: Dining): void` for an unsaved draft (a saved order switches through `switchDining`). No till-side VAT pricing change: the till's `vatBreakdown` is shown on no screen.

- [ ] **Step 1: failing tests.** A draft in a takeaway department starts `takeaway`; in `till_choice` starts as `startsAs` (`eat_in` at a table); the sale body carries `dining` in `till_choice` and omits it in a fixed department; a change of the department's policy arrives through the live `menu` group and updates the next draft; `takeawayVat` changes `setupRevision`.
- [ ] **Step 2–4:** run (fail), implement, pass.
- [ ] **Step 5:** commit: "Let the till hold and send how each order is sold (A1522)".

### Task 19: the Eat here / Take away switch on the order screens

**Files:**
- Modify: `apps/till/src/screens/till-counter-screen.ts` (`#gridBody` `:391-446`), `till-table-order-screen.ts` (beside `#viewSwitch` `:3092-3120`): a `wt-segmented-control` **Eat here** / **Take away** when `diningChoice` is `"open"` or for a draft in a `till_choice` department; a label of the current way when `"locked"`; the label **Take away** in a takeaway department; nothing in an eat-in department
- Test: `apps/till/src/screens/till-counter-screen.test.ts`, `till-table-order-screen.test.ts`

- [ ] **Step 1: failing tests.** Each of the four displays; choosing Take away emits the screen's change event with `"takeaway"`.
- [ ] **Step 2–4:** run (browser mode), implement, pass. Look at both screens in both themes and at phone width.
- [ ] **Step 5:** commit: "Show Eat here or Take away on the till's order screens (A1522)".

### Task 20: the till app wires the switch and the refusals

**Files:**
- Modify: `apps/till/src/till-app.ts`: the screen's change calls `setDining` (draft) or `switchDining` (saved order); `order.set_lunch_takeaway` shows that set lunches are served at the table for now and, when `canSwitch`, offers **Switch to eat here** (switch, then add the set lunch again)
- Modify: the till's `codeMessage` wording for `order.dining_fixed`, `order.dining_locked`, `order.dining_differs`, `order.department_dining_differs`, `order.set_lunch_takeaway`, English and Spanish
- Modify: `apps/server/src/guide/en/table-service.md`, `es/` `{#eat-here-or-take-away}`: one or two sentences on the till side
- Test: create `apps/till/src/till-app-dining.test.ts`

- [ ] **Step 1: failing tests.** Tapping Take away on a saved order sends `PUT /api/working-orders/:id/dining` with the order's revision and shows the label the server returns; on a draft it sends nothing until the sale, whose body carries `takeaway`. A set lunch on a takeaway order shows the refusal with Switch to eat here; choosing it leaves the order eat-in with the set lunch added; with `canSwitch` false the action is absent. Each new code renders its own sentence, not "The server needs attention". Use `userEvent.click`.
- [ ] **Step 2–4:** run (browser mode), implement, pass.
- [ ] **Step 5:** commit: "Switch an order between eat here and take away from the till (A1522)".

### Task 21: the kitchen ticket and the customer's documents say Take away

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` / `kitchen-ticket.ts` (a **TAKE AWAY** line at the top of a takeaway order's ticket, in the ticket's language)
- Modify: `packages/country/src/country.ts` `RECEIPT_LABEL_KEYS` and every country pack's receipt label sets (`packages/country-es/src/spain.ts`, `packages/country-gb/src/united-kingdom.ts`) — a `takeAway` label
- Modify: `apps/server/src/receipt-document.ts:140` (a **Take away** line on a takeaway sale, the order read through `sales.working_order_id`), `apps/till/src/screens/till-ticket-view.ts` (the on-screen receipt), `apps/server/src/invoice-document.ts` and `invoice-email.ts` (the A4 and emailed invoice)
- Test: `apps/server/src/kitchen-ticket.test.ts`, `receipt-document.test.ts`, `receipt-ticket.test.ts`, `invoice-document.test.ts`, `apps/till/src/screens/till-ticket-view*.test.ts`

- [ ] **Step 1: failing tests.** A takeaway order's kitchen ticket has the takeaway line and an eat-in one does not; a takeaway sale's receipt, on-screen receipt and A4 invoice say "Take away" in English and "Para llevar" in Spanish, an eat-in one neither; the per-line rate column is unchanged.
- [ ] **Step 2–4:** run (fail), implement, pass; also `src/lunch-receipt.test.ts`. Render one printed receipt to a file and open it with the workspace's Playwright Chromium to look at it.
- [ ] **Step 5:** commit: "Print Take away on a takeaway order's kitchen ticket, receipt and invoice (A1522)".

### Task 22: the demo deli sells the ordinary drinks to take away

**Files:**
- Modify: `packages/country-es/src/demo/menu.ts` (delete the three drinks of "Drinks to take away" in `DELI_TAKEAWAY` `:1414-1510`; the restaurant's cola, cola zero and bottled beer `~:1200-1230` gain `takeawayVatClass: "general"`; the deli menu lists those same products under Drinks), `packages/country/src/demo.ts`, `packages/country-es/src/demo/casa-delgado-{ca,gl,valencia}.ts`, `test-fixtures/demo/*.json` as the tests require
- Modify: `apps/server/scripts/demo-seed/seed-floor.ts:73-75` (deli `dining: "takeaway"`), `seed-catalogue.ts`, `seed-sales.ts:226-255` (seeded deli sales rated at the takeaway class)
- Test: `packages/country-es/src/demo/data.test.ts:334-363`, `apps/server/scripts/demo-seed/seed-floor.test.ts`, `seed.madrid-baseline.test.ts`, `seed-sales` tests

- [ ] **Step 1: failing tests.** No deli-only Coca-Cola, Coca-Cola Zero or beer product; the restaurant's three carry `reduced` / `general`; the deli menu offers them; the deli department is `takeaway`, the restaurant `eat_in`; a seeded deli Coca-Cola sale has `vat_rate = 2100`.
- [ ] **Step 2–4:** run (fail), implement, pass. Then `wa-wt reset demo <worktree>` and `wa-wt demo <worktree>`: sell a Coca-Cola in the deli (21% on the receipt) and in the restaurant (10%).
- [ ] **Step 5:** commit: "Sell the ordinary drinks to take away in the demo deli (A1522)".

### Task 23: docs and backlog

**Files:** `docs/developers/products.md:153-172` (two classes, `dining`, the two places the class is chosen, the lock), `docs/backlog.md` (delete A1522; add to A1513 that a delivery-app order is always taken away), `docs/backlog/catalogue.md` A1515 (a set lunch cannot be taken away until T17 is answered).

- [ ] **Step 1:** edit; run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` if a pointer moved.
- [ ] **Step 2:** commit: "docs: record how eat-here and take-away VAT works (A1522)".

**End of PR 3.** `/finish-branch`, full wave.

# A1522: one product, the right VAT eaten here or taken away — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** each product carries a served-here VAT class and an optional taken-away class; each order records whether it is eaten here or taken away, set from its department and switchable at a counter until it is first sent or paid; the till, the printed bill and the filed record all use the class that matches.

**Architecture:** the order line stores BOTH classes, frozen from the published menu when the line is added. The order stores its way of selling (`dining`). The class that applies is worked out from the two only where lines are rated: one SQL expression on the server (`readLockedLines`, which every bill, payment and filing path reads) and one shared function in the till. Switching an order, or moving it to another department, changes one column on the order and never rewrites a line. A database trigger refuses a change of `dining` once anything has been sent or paid, so a code path that forgets the rule cannot file a payment and its invoice at different rates.

**Tech stack:** TypeScript, SQLite through drizzle, Hono routes, Lit (dashboard, till), Vitest (database tests through `useVenueDb`, browser tests in Chromium).

**Spec:** [`docs/superpowers/specs/2026-11-14-eat-in-takeaway-vat-design.md`](../specs/2026-11-14-eat-in-takeaway-vat-design.md). Read it first; this plan argues from it and does not repeat its reasons.

**Who lands it:** this is fiscal work. Full review path, per-task reviews, and the owner lands each PR.

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

## Decisions this plan makes that the spec left open

1. **Lines hold both classes; the order holds `dining`.** (Spec: "left to the builder".) The existing `working_order_lines.vat_class` keeps its name and becomes the served-here class; `takeaway_vat_class` is added beside it, NOT NULL, already resolved (a product with no takeaway class stores its served class there). Nothing rewrites a line when an order switches.
2. **`dining` lives on `working_orders`**, NOT NULL with no database default, so every insert must name it and the typecheck finds every site.
3. **Table orders start eaten here.** In a `till_choice` department, an order opened at a table (service mode `table_tab`) starts `eat_in` whatever `diningStartsAs` says; counter orders start as `diningStartsAs`. This follows the owner's words in the spec ("its table orders still start as eaten here"). Flag it to the owner when the plan is shown.
4. **Moving lines between two orders whose `dining` differs is refused** (`order.dining_differs`). Lines follow their order, so a move would silently change a sent line's rate. A move between two orders of the same way is unchanged.
5. **One rule for any department change**, not only `acceptDepartmentTransfer`: it sits in `retargetOrderServiceContext`, which every department change already goes through (department transfer, `move-bill.ts` `adoptZone`).
6. **The demo's restaurant drinks take away at 21%.** The restaurant's own cola, cola zero and bottled beer gain `takeawayVatClass: "general"`, and the deli menu lists those same products, as the spec's Demo section says.

## Review focus

The inputs the spec implies that no happy-path test meets. Each has its test in the named task.

1. **A walk-up counter sale filed in one request** (`POST /api/sales`, no parked order): the till's chosen way must reach the filing. Expect: a takeaway Coca-Cola files at 21% and the receipt says Take away. Test in Task 8.
2. **An order paid in parts.** The first payment fixes the way; the second payment and the final invoice use the same rate. Test in Task 10 (switch refused after one `bill_payments` row).
3. **A variant that overrides only its served-here class**, in a product that has a takeaway class. Expect: the variant's takeaway class is its own served class (spec, "my call"), and the editor's hint says so. Test in Task 3.
4. **A region without the distinction** (`GB-vat`) whose department was set to takeaway through the API or an imported configuration. Expect: every order is `eat_in` and a request for `takeaway` is refused. Test in Task 7.
5. **The menu republished between adding a line and switching the order.** Expect: switching uses the classes frozen on the line, never the new menu. Test in Task 9.

---

## PR 1 — products carry a takeaway class (no sale changes yet)

### Task 1: confirm the Veri*Factu record needs no goods-or-service marker

The spec's "Left to the builder" asks for this check before anything files at a takeaway rate. It is research, not code, and it gates PR 2.

**Files:**
- Create: `docs/compliance/research/2026-11-14-takeaway-verifactu-record.md`

- [ ] **Step 1:** Read the AEAT Veri*Factu schema for `RegistroAlta` → `Desglose` → `DetalleDesglose` (the XSD files and the AEAT technical specification the repo already cites; find them with `/usr/bin/grep -rln "DetalleDesglose" packages/fiscal-verifactu docs/compliance`). Record, with the source's own words quoted, every field of `DetalleDesglose` and whether any of them says goods against services. Today Waitron sends `ClaveRegimen "01"`, `CalificacionOperacion "S1"`, base, rate and tax (`packages/fiscal-verifactu/src/backend.ts:150-158`).
- [ ] **Step 2:** Record whether `DescripcionOperacion` (filled from `apps/server/src/sale-operation-description.ts`) has any rule that a takeaway sale would break. Note that it reads the zone's CURRENT department (`resolveSalePolicy(tx, context.zoneId)`), not the order's stored one.
- [ ] **Step 3:** If either answer is "a marker is needed" or "unclear", stop and tell the driver: PR 2 waits for the owner. If both are "no", write the note (provenance row per source, quote then paraphrase) and commit it.

```bash
git add docs/compliance/research/2026-11-14-takeaway-verifactu-record.md
git commit -s -m "docs: check that a takeaway sale needs no extra marker in the Veri*Factu record (A1522)"
```

### Task 2: each fiscal region says whether it charges takeaway differently

**Files:**
- Modify: `packages/country/src/country.ts:50-55` (`FiscalJurisdiction`)
- Modify: `packages/country-es/src/spain.ts:335-345` (`ES-common`)
- Modify: `packages/country-packs/src/registry.ts`
- Create: `packages/shared/src/dining.ts` (exported from `@waitron/shared`)
- Test: `packages/country-packs/src/registry.test.ts`, `packages/country-es/src/spain.test.ts`, `packages/shared/src/dining.test.ts`

**Interfaces — produces:**
- `FiscalJurisdiction.takeawayVat?: true` — present only where food and drink taken away are charged at goods rates.
- `chargesTakeawayVat(country: string, territory: string): boolean` in `packages/country-packs/src/registry.ts` — false for an unknown country or territory.
- In `packages/shared/src/dining.ts`:
  - `DININGS = ["eat_in", "takeaway"] as const`, `type Dining`
  - `DINING_POLICIES = ["eat_in", "takeaway", "till_choice"] as const`, `type DiningPolicy`
  - `appliedVatClass(dining: Dining, line: { vatClass: VatClass; takeawayVatClass: VatClass }): VatClass`

- [ ] **Step 1: failing tests.** In `registry.test.ts`: `expect(chargesTakeawayVat("ES", "ES-common")).toBe(true)`; `"ES", "ES-canary"` → false; `"GB", "GB-vat"` → false; `"XX", "ES-common"` → false. In `spain.test.ts`: only `ES-common` carries `takeawayVat`. In `dining.test.ts`: `appliedVatClass("takeaway", { vatClass: "reduced", takeawayVatClass: "general" })` is `"general"`, and `"eat_in"` gives `"reduced"`.
- [ ] **Step 2:** run `pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts` and the other two; expect failures naming the missing exports.
- [ ] **Step 3:** implement. `GB-vat` stays without the flag.
- [ ] **Step 4:** the three runs pass; `pnpm --filter @waitron/country-packs typecheck` passes.
- [ ] **Step 5:** commit: "Say which fiscal regions charge food and drink taken away at a different VAT rate (A1522)".

### Task 3: store and resolve the takeaway class on products and variants (server)

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts:75,132-135` (column and CHECK), then rebuild the baseline
- Modify: `packages/catalogue/src/variant-fallback.ts:102,117`, `variants.ts:487-561`, `operations.ts` (`PRODUCT_BASE_COLUMNS`, `RawProduct`, `toProduct`, `offerLineColumns`/`offerLineValues`, `insertProduct`, `patchProduct`, `listedVariantsOfProducts`, `listAvailableProducts`), `product-editor-input.ts:103-114,163,211`, `product-editor.ts:37,58,77,192,210`, `offered-modifiers.ts:122,153`
- Modify: `packages/shared/src/menu-document/product-types.ts` (`Product`, `ProductEditorInput`, `InheritedValues`, `ListedVariant.effective`), `menu-types.ts` (`MenuOffer`, `MenuOfferVariant`, `AvailableProduct`, `OfferedExtraItem`)
- Modify: `apps/server/src/catalogue-api.ts:1481-1509` (`POST /management-api/products` accepts `takeawayVatClass`)
- Modify: `packages/module/src/module.ts` where `vatClass` is typed on offers (`:234`, `:289`, `:432`, `:1183`)
- Test: `packages/catalogue/src/variant-fallback.test.ts`, `product-editor-input.test.ts`, `product-editor.test.ts`, `packages/db/src/schema/catalogue.test.ts`, `apps/server/src/catalogue-api.test.ts`

**Interfaces — produces:**
- `products.takeaway_vat_class` nullable text, CHECK `products_takeaway_vat_class_ck` naming the four classes (same form as `products_vat_class_ck`). Not part of `products_top_level_owns_ck`: empty is allowed everywhere.
- `effectiveProductColumns.takeawayVatClass` = SQL `coalesce(own.takeaway_vat_class, own.vat_class, parent.takeaway_vat_class, parent.vat_class)`, typed `VatClass` (never null). For a top-level product the parent terms are null, so it is `coalesce(takeaway, vat_class)`.
- `Product.takeawayVatClass: VatClass | null` (stored, raw); `MenuOffer.takeawayVatClass`, `MenuOfferVariant.takeawayVatClass`, `AvailableProduct.takeawayVatClass`, `OfferedExtraItem.takeawayVatClass`, `ListedVariant.effective.takeawayVatClass`: all `VatClass`, effective.
- `ProductEditorInput.takeawayVatClass: VatClass | null` (null = empty, on a product or a variant). `InheritedValues.takeawayVatClass: VatClass` (the parent's effective takeaway class).
- `SellingValues` and `selectMenuVariant` return `takeawayVatClass` beside `vatClass`.

- [ ] **Step 1: failing tests.**
  - `variant-fallback.test.ts`: a product `{ vatClass: "reduced", takeawayVatClass: "general" }` with three variants: one with nothing set → effective takeaway `"general"`; one with only `vatClass: "super_reduced"` → effective takeaway `"super_reduced"` (Review focus 3); one with `takeawayVatClass: "zero"` → `"zero"`. A product with no takeaway class → effective takeaway equals its `vatClass`.
  - `product-editor-input.test.ts`: `takeawayVatClass: "nope"` refused with `product.invalid { field: "takeawayVatClass" }`; `null` accepted on a top-level product.
  - `product-editor.test.ts`: save then read returns the stored `takeawayVatClass`, and a variant's `inherited.takeawayVatClass` is the parent's effective one.
  - `catalogue.test.ts`: inserting `takeaway_vat_class = 'nope'` is refused by `products_takeaway_vat_class_ck`.
- [ ] **Step 2:** run each file with `pnpm --filter @waitron/catalogue exec vitest run <file>` (and `@waitron/db`); expect failures on the missing column/field.
- [ ] **Step 3:** implement; then `pnpm --filter @waitron/db db:generate` to rebuild the baseline. Do not edit `packages/db/drizzle/` by hand.
- [ ] **Step 4:** the files pass; then run `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts` (root guards) and `pnpm --filter @waitron/catalogue typecheck`, `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 5:** commit: "Let a product and its variants carry a VAT class for when it is taken away (A1522)".

### Task 4: publishing freezes both classes; live patches and change lists know the new field

**Files:**
- Modify: `packages/catalogue/src/menu-document.ts:93` (format 4), `PRODUCT_FACTS` (`:803`, the `"vat"` fact reads `["vatClass", "takeawayVatClass"]`), `EXTRA_FACTS` (`:811`), `productFields` (`:879`)
- Modify: `packages/shared/src/menu-document/menu-document-types.ts:95` (`format: 4`)
- Modify: `packages/catalogue/src/menu-patch-types.ts:20-27` (`PATCH_FIELDS` gain `"takeawayVatClass"` for `offer`, `variant`, `extra`), `menu-patch.ts:101-103` (validated against `VAT_CLASSES`)
- Modify: `packages/catalogue/src/menu-navigation.ts:176,252,357`
- Modify: `apps/till/src/api/client.ts:354,389,404,488` and `apps/dashboard/src/api/client.ts:526` (types carry `takeawayVatClass`)
- Test: `packages/catalogue/src/menu-document.test.ts`, `menu-publication.test.ts`, `menu-patch.test.ts`

**Interfaces — consumes:** Task 3's effective `takeawayVatClass` on `MenuOffer`, its variants and extras.

- [ ] **Step 1: failing tests.** `menu-document.test.ts`: a published document's offer, each variant and each extras item carry `takeawayVatClass` equal to the effective value; changing only a product's takeaway class lists that product with the `"vat"` field changed. `menu-publication.test.ts`: a stored format-3 document is refused with `menu.reset_required`. `menu-patch.test.ts`: patching an offer's `takeawayVatClass` to `"general"` changes that copy only; `"nope"` is refused with `menu_patch.invalid`.
- [ ] **Step 2:** run them; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass; `pnpm --filter @waitron/catalogue typecheck`, `@waitron/till typecheck`, `@waitron/dashboard typecheck`.
- [ ] **Step 5:** commit: "Freeze the takeaway VAT class when a menu is published (A1522)".

### Task 5: the product editor shows the takeaway class where the region has it

**Files:**
- Modify: `apps/server/src/venue-settings-api.ts:111-134` (venue defaults read gains `takeawayVat: boolean`, from `chargesTakeawayVat(readTenant(tx).country, readVenue(tx).fiscalTerritory)`)
- Modify: `apps/dashboard/src/widgets/product-editor.ts` (`renderTax` `:1413-1440`, `SERVER_FIELDS`, `DRAFT_ERROR_KEYS`, `emptyDraft`, `validate`, `pricingSummary`), `product-editor-model.ts:22-27`, `apps/dashboard/src/screens/catalogue-screen.ts:772` (feeds `takeawayVat`), `product-details.ts:107-126`, `product-list.ts:1095-1105` (the `vat-note` also shows when the variant's effective takeaway class differs), `menu-patch-dialog.ts:1262-1277`, `menu-patch-review.ts:21`, `apps/dashboard/src/i18n/strings.ts`
- Modify: `apps/server/src/guide/en/products.md` and `es/products.md`, section `{#vat}`
- Test: `apps/dashboard/src/widgets/product-editor.test.ts`, `product-editor.unsaved.test.ts` (existing), `product-details.test.ts`, `menu-patch-dialog.test.ts`, `apps/server/src/venue-settings-api.test.ts`

**Interfaces — consumes:** `ProductEditorInput.takeawayVatClass`, `InheritedValues.takeawayVatClass` (Task 3); `chargesTakeawayVat` (Task 2).
**Produces:** `product-editor` property `takeawayVat: boolean`; a second `wt-combobox name="takeawayTax"`.

- [ ] **Step 1: failing tests.**
  - With `takeawayVat = true`: the editor draws a field labelled "VAT when taken away" whose empty choice reads "Same as served here — <class name and rate>" for a product, and for a variant names the class the spec's rule gives (own served class if set, else the product's takeaway class). Saving with it empty sends `takeawayVatClass: null`; choosing General sends `"general"`. Changing only this field enables Save (draft scope) and leaving asks about unsaved changes.
  - With `takeawayVat = false`: no `takeawayTax` field is drawn, and a save sends the stored value unchanged.
  - `venue-settings-api.test.ts`: an `ES-common` venue reads `takeawayVat: true`; a `GB-vat` venue reads `false`.
  - `menu-patch-dialog.test.ts`: the patch dialog offers the takeaway class for an offer, and not when `takeawayVat` is false.
- [ ] **Step 2:** run them (`pnpm --filter @waitron/dashboard exec vitest run <file>`; browser mode, check `memory_pressure | grep free` first); expect failures.
- [ ] **Step 3:** implement. The hint is the field's placeholder; no "?" button. Update the `{#vat}` guide section in English and Spanish: one or two sentences saying what the second field is for and that empty means the same as served here.
- [ ] **Step 4:** pass; also `apps/server/src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`. Open the editor in both themes and at phone width and look.
- [ ] **Step 5:** commit: "Show the takeaway VAT class in the product editor where the region charges it (A1522)".

**End of PR 1.** Run `/finish-branch`. PR description's first line: "Resets every venue: the menu document format moves to 4."

---

## PR 2 — orders are eaten here or taken away, and file at the matching rate

PR 2 does not start until Task 1's note says no marker is needed.

### Task 6: each department says how it sells (server)

**Files:**
- Modify: `packages/db/src/schema/venue-service/service.ts:49-68` (`department_sale_policies` gains `dining` and `dining_starts_as`), `packages/db/src/schema/sale-rule-types.ts` (enum types from `DINING_POLICIES` and `DININGS`)
- Modify: `packages/venue-service/src/operations.ts` (`createDepartment` `:170`, `EffectiveSalePolicy`/`resolveSalePolicy` `:500-544`, `listSalePolicies` `:582`, `DepartmentEditInput` `:659-670`, `saveDepartmentEditSettings` `:672-705`), `provisioning.ts:82`, `configuration-transfer.ts:552-670`
- Modify: `packages/venue-service/src/routes.ts` (`requireSalePolicyField` `:151-165`; `PUT .../departments/:departmentId/settings` `:730-794` accepts both fields; `readModel` `:481-484` gains `takeawayVat: boolean`)
- Create: `packages/venue-service/src/dining.ts`
- Test: `packages/venue-service/src/routes.test.ts`, `packages/venue-service/src/dining.test.ts`, `packages/db/src/schema/venue-service/migrations.test.ts`

**Interfaces — produces (in `dining.ts`):**
- `venueChargesTakeawayVat(tx: Transaction): Promise<boolean>`
- `departmentDining(tx: Transaction, departmentId: string): Promise<{ dining: DiningPolicy; startsAs: Dining }>`
- Columns: `dining` enum `DINING_POLICIES` NOT NULL default `"eat_in"`; `dining_starts_as` enum `DININGS` NOT NULL default `"eat_in"`; CHECKs built with `enumCheck`.

- [ ] **Step 1: failing tests.** `routes.test.ts`: saving `{ dining: "till_choice", diningStartsAs: "takeaway" }` reads back the same; `dining: "sometimes"` is refused with the existing field refusal naming `dining`; a new department reads `eat_in` / `eat_in`; `readModel.takeawayVat` is true for `ES-common`. `dining.test.ts`: `venueChargesTakeawayVat` is false for a `GB-vat` venue. A configuration export then import keeps both values.
- [ ] **Step 2:** run (`pnpm --filter @waitron/venue-service exec vitest run <file>`); expect failures.
- [ ] **Step 3:** implement; `pnpm --filter @waitron/db db:generate`.
- [ ] **Step 4:** pass; root guards `scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts`.
- [ ] **Step 5:** commit: "Let each department say whether it sells to eat in, to take away, or lets the till choose (A1522)".

### Task 7: the order records its way of selling, and the database fixes it once sent or paid

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`working_orders` gains `dining`; `working_order_lines` gains `takeaway_vat_class` with CHECK `working_order_lines_takeaway_vat_class_ck`; update the doc comment at `:61-62`)
- Modify: `packages/db/triggers/core.sql`: add `dining` to the columns `working_orders_enforce_transition` (`:543`) holds unchanged for `placed → placed` and `placed → settled/abandoned`; add `takeaway_vat_class` beside `vat_class` in every branch of `working_order_lines_require_open_parent_update` (`:375-478`); add trigger `working_orders_dining_fixed`
- Modify: `packages/db/src/trigger-refusals.ts` (refusal text for the new trigger), `packages/db/src/constraint-target.ts` if a matcher is needed
- Create: `packages/db/src/order-dining.ts`, add it to `@waitron/db`'s enumerated `exports` map
- Modify: every insert of `working_orders` / `working_order_lines` the typecheck then names (`apps/server/src/working-order.ts:1525`, the line rows from `priceOrderLines`, `packages/reporting/test/fixtures.ts:433,473`, the `apps/server/src/testing/*` helpers). For this task only, pass `dining: "eat_in"` and `takeawayVatClass: <the line's vatClass>`; Task 8 replaces them with the real values.
- Test: `packages/db/src/schema/orders.transition.test.ts`, `packages/db/src/order-dining.test.ts`

**Interfaces — produces:**
- `working_orders.dining` enum `DININGS`, NOT NULL, no default.
- `working_order_lines.takeaway_vat_class` NOT NULL.
- Trigger `working_orders_dining_fixed`: BEFORE UPDATE OF `dining` ON `working_orders`, when `new.dining IS NOT old.dining` and any of: `old.status <> 'open'`; `old.payment_attempt_at IS NOT NULL`; a line of the order with `sent_at IS NOT NULL`; a `bill_payments` row for the order in state `pending` or `received`; a `sales` row for the order. Raises the refusal text from `trigger-refusals.ts`.
- `orderDiningLocked(tx: Transaction, workingOrderId: string): Promise<"sent" | "paid" | null>` in `packages/db/src/order-dining.ts`: the same conditions as the trigger, `"sent"` for the status/`sent_at` ones and `"paid"` for the money ones, null when the order may still switch.

- [ ] **Step 1: failing tests.** In `orders.transition.test.ts`: on an open order with no sent line and no payment, updating `dining` succeeds; after stamping one line's `sent_at`, it is refused with the trigger's text; after inserting one `bill_payments` row in state `received`, refused; in state `failed`, allowed; on a placed order, refused. Changing `takeaway_vat_class` on a line of a placed order is refused like `vat_class`. In `order-dining.test.ts`: `orderDiningLocked` returns null, `"sent"` and `"paid"` for the same three set-ups.
- [ ] **Step 2:** run (`pnpm --filter @waitron/db exec vitest run <file>`); expect failures.
- [ ] **Step 3:** implement; `pnpm --filter @waitron/db db:generate`.
- [ ] **Step 4:** pass; root guards `scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts`; `pnpm --filter @waitron/server typecheck`, `@waitron/reporting typecheck`.
- [ ] **Step 5:** commit: "Record on each order whether it is eaten here or taken away, fixed once sent or paid (A1522)".

### Task 8: a new order takes its way from its department; lines store both classes

**Files:**
- Modify: `packages/venue-service/src/dining.ts` (add `resolveOrderDining`), the `VENUE_SERVICE` port (`packages/venue-service/src/service.ts:173,241`, `packages/module/src/module.ts:983,1142,1220`), `packages/venue-service/src/errors.ts`
- Modify: `apps/server/src/working-order.ts`: `createOpenOrder` (`:1412-1562`, writes `dining`); `priceOrderLines` (`:598-1074`) takes `dining: Dining`, writes `takeawayVatClass` on every row (dish: the selection's effective takeaway class; extras child: the extra product's takeaway class; set lunch child: the dish's `vatClass`, as `vatClass` is today at `:936`), and refuses a set lunch when `dining` is `"takeaway"`; `priceTabRound` (`:2886`) and `applyLineEdits` (`:6146`) pass the order's stored `dining`
- Modify: `apps/server/src/modifier-selection.ts` (`ExtraProductFacts`, `ExtraChild`, `buildLineExtras`, `editLineExtras` carry `takeawayVatClass`)
- Modify: `apps/server/src/till-sale.ts:773,1331`, `parties.ts:173`, `bill-actions.ts:310`, `order-drafts.ts:168` (pass the requested `dining` or none)
- Modify: `apps/server/src/till-api.ts` (`POST /api/sales` `:1786`, `POST /api/working-orders` `:1917`, `POST /api/pay` `:1846` accept optional `dining`)
- Modify: `apps/server/src/errors.ts`
- Test: `packages/venue-service/src/dining.test.ts`, create `apps/server/src/order-dining.start.test.ts`

**Interfaces — consumes:** `departmentDining`, `venueChargesTakeawayVat` (Task 6).
**Produces:**
- `resolveOrderDining(tx: Transaction, zoneId: string, requested: Dining | undefined): Promise<Dining>`, on the port as `VENUE_SERVICE.resolveOrderDining`. Rules: region without `takeawayVat` → `"eat_in"`, and a requested `"takeaway"` is refused `order.dining_fixed { dining: "eat_in" }`. Department `eat_in`/`takeaway` → that value; a different request is refused `order.dining_fixed { dining }`. `till_choice` → the request if given; otherwise `"eat_in"` when the zone's service mode is `table_tab` (Decision 3), else `startsAs`.
- `order.set_lunch_takeaway { canSwitch: boolean }` — `canSwitch` is true when the order's department is `till_choice`.
- A split or check order copied from another (`copyOrderContext` path) copies the source's `dining`.

- [ ] **Step 1: failing tests.** `dining.test.ts` covers each rule above, including Review focus 4: a `GB-vat` venue whose department row says `takeaway` resolves `"eat_in"`, and a request for `"takeaway"` is refused. `order-dining.start.test.ts` (use `provisionBillVenue` or `provisionOrderVenue`): in a takeaway department, a parked order has `dining = "takeaway"` and its Coca-Cola line stores `vat_class = "reduced"`, `takeaway_vat_class = "general"`; a cheese line with takeaway `super_reduced` stores that; an extra on a takeaway dish stores the extra product's own takeaway class. A walk-up `POST /api/sales` with `dining: "takeaway"` in a `till_choice` department creates an order with `dining = "takeaway"` (Review focus 1; the filed rate is asserted in Task 9). Adding a set lunch to a takeaway order is refused `order.set_lunch_takeaway`; to an eat-in order it is accepted.
- [ ] **Step 2:** run (`pnpm --filter @waitron/venue-service exec vitest run src/dining.test.ts`, `pnpm --filter @waitron/server exec vitest run src/order-dining.start.test.ts`); expect failures.
- [ ] **Step 3:** implement. Replace Task 7's placeholder values.
- [ ] **Step 4:** pass; then `src/vat-class-at-line-add.test.ts` and `src/working-order.test.ts` still pass unchanged (every existing venue is eat-in).
- [ ] **Step 5:** commit: "Start each order eaten here or taken away from its department, and keep both VAT classes on its lines (A1522)".

### Task 9: every bill, payment and filing rates a line by its order's way

**Files:**
- Modify: `apps/server/src/working-order.ts:1099-1232` — `storedLineColumns.vatClass` becomes the SQL expression `case when working_orders.dining = 'takeaway' then working_order_lines.takeaway_vat_class else working_order_lines.vat_class end`; `readLockedLines` (`:1134`) and `readLockedLinesForIssuance` (`:1150`) join `working_orders`
- Test: extend `apps/server/src/vat-rate-at-issue.test.ts`; create `apps/server/src/order-dining.filing.test.ts`

**Interfaces — consumes:** Task 8's stored classes. Nothing outside `working-order.ts` changes: `adjustments-apply.ts`, `bill-payments.ts`, `issuance-pass.ts` and every `issueMoment` caller read through `readLockedLines`.

- [ ] **Step 1: failing tests.** `order-dining.filing.test.ts`, one venue, a €1.80 Coca-Cola (`reduced` / `general`) and cheese (`reduced` / `super_reduced`):
  - takeaway order paid whole: `sale_lines.vat_rate` is 2100 for the cola and 400 for the cheese; the fiscal backend's `vatBreakdown` has 21% and 4% bands; the cola's base is €1.49.
  - eat-in order: both 1000; the cola's base is €1.64.
  - the walk-up `POST /api/sales` with `dining: "takeaway"` from Task 8 files 21% (Review focus 1).
  - a takeaway bill paid in two `items` payments: both payments' previews and the final invoice use 21% for the cola.
  - Review focus 5: add the cola, republish the menu with its takeaway class changed to `zero`, switch the open order to takeaway (direct update; Task 10 adds the route), pay: files 21%, the class frozen on the line.
- [ ] **Step 2:** run (`pnpm --filter @waitron/server exec vitest run src/order-dining.filing.test.ts src/vat-rate-at-issue.test.ts`); expect failures.
- [ ] **Step 3:** implement. Read the emitted SQL with `.toSQL()` once to check the join is on the line's own order.
- [ ] **Step 4:** pass; also `src/bill-payments.test.ts`, `src/till-api.fiscal-sale-paths.test.ts`, `src/till-api.split-bill.test.ts`, `src/working-order.pay-and-dispatch.test.ts`.
- [ ] **Step 5:** commit: "File each line at the VAT rate for how its order was sold (A1522)".

### Task 10: switching an order at the counter, and moving lines between orders

**Files:**
- Create: `apps/server/src/order-dining.ts` (`switchOrderDining`)
- Modify: `apps/server/src/till-api.ts` — `PUT /api/working-orders/:id/dining`
- Modify: `apps/server/src/working-order.ts` — `carveLines` (`:4584`) reads and copies `takeawayVatClass` (`:4605`, `:4779`) and refuses when the two orders' `dining` differ
- Modify: the order read the till gets (`GET /api/working-orders/:id`, `/placed`, and the party/tab reads that carry `serviceMode`) gains `dining: Dining` and `diningChoice: "none" | "open" | "locked"`
- Modify: `apps/server/src/errors.ts`
- Test: create `apps/server/src/order-dining.switch.test.ts`; add rows to `apps/server/src/till-api.profile-actions.test.ts` (refusing case and inventory row), `till-api.profile-zones.test.ts` (zone row) and, if the route needs it, `till-api.session-person.test.ts` (`BODIES`)

**Interfaces — consumes:** `orderDiningLocked` (Task 7), `departmentDining` (Task 6).
**Produces:**
- `switchOrderDining(tx: Transaction, cfg: TradingContext, workingOrderId: string, dining: Dining, revision: number): Promise<void>`. In order: unknown order → existing not-found code; not open or wrong revision → `working_order.out_of_date`; department not `till_choice`, or region without `takeawayVat` → `order.dining_fixed { dining }`; `orderDiningLocked` non-null → `order.dining_locked { reason }`; switching to takeaway with a set lunch line → `order.set_lunch_takeaway { canSwitch: false }`; else set `dining` and `revision + 1`.
- `diningChoice`: `"none"` when the department is fixed or the region has no distinction; `"open"` when `till_choice` and not locked; `"locked"` when `till_choice` and locked.
- `order.dining_differs { fromOrderId, toOrderId }` from `carveLines`.

- [ ] **Step 1: failing tests** in `order-dining.switch.test.ts`: switch eat-in → takeaway on a fresh counter order succeeds and bumps the revision; a stale revision is refused; after `POST .../lines/send` it is refused `order.dining_locked { reason: "sent" }`; after one received payment, `{ reason: "paid" }` (Review focus 2); in an `eat_in` department, `order.dining_fixed`; with a set lunch line, `order.set_lunch_takeaway`. Moving a dish from a takeaway bill to an eat-in bill (`POST /api/bills/:id/move-dishes`) is refused `order.dining_differs`; between two takeaway bills it works and the moved line keeps both classes. The order read shows `diningChoice: "open"`, then `"locked"` after sending.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass, plus the profile-action, profile-zone and session-person guards above, and `src/till-api.split-bill.test.ts`.
- [ ] **Step 5:** commit: "Let staff switch a counter order between eat here and take away until it is sent or paid (A1522)".

### Task 11: moving an order to another department

**Files:**
- Modify: `packages/venue-service/src/operations.ts` — `retargetOrderServiceContext` (`:1049-1070`): when the department changes, apply the dining rule below
- Modify: `packages/venue-service/src/errors.ts`
- Test: `packages/venue-service/src/department-transfers.test.ts`, `apps/server/src/department-transfer-api.test.ts`

**Interfaces — consumes:** `orderDiningLocked`, `departmentDining`, `venueChargesTakeawayVat`.
**Produces:** the rule, applied inside the existing transaction:
- region without the distinction: nothing changes.
- order not locked: `dining` becomes the new department's fixed way, or for `till_choice` its `startsAs` (`eat_in` if the destination zone is a table zone, Decision 3). Becoming takeaway with a set lunch line is refused `order.set_lunch_takeaway { canSwitch: false }`.
- order locked: `dining` is kept; a destination department fixed the other way is refused `order.department_dining_differs { dining, departmentDining }`.

- [ ] **Step 1: failing tests** in `department-transfers.test.ts`: an unsent counter order in a takeaway department accepted into an eat-in department becomes `eat_in`; a sent takeaway order accepted into an eat-in department is refused `order.department_dining_differs`; a sent takeaway order into a `till_choice` department keeps `takeaway`. One case in `department-transfer-api.test.ts` shows the refusal through the route.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass; also `apps/server/src/move-bill*.test.ts`.
- [ ] **Step 5:** commit: "Keep an order's way of selling right when it moves to another department (A1522)".

**End of PR 2.** No screen offers a takeaway department yet (the department field arrives in PR 3), so no venue can sell takeaway between PR 2 and PR 3 except through the API. `/finish-branch` with the full wave (fiscal risk trigger: two Codex run-it seats).

---

## PR 3 — the dashboard, the till, printing and the demo

### Task 12: the department settings show "How it sells"

**Files:**
- Modify: `packages/venue-service/src/dashboard/service-settings-fields.ts` (two `wt-combobox search="never"` fields: **How it sells** — Eaten in / Taken away / Chosen on the till; **Starts as** — Eaten here / Taken away, shown only for Chosen on the till), `department-settings.ts` (`fieldTab`, `equal()`, draft, `fieldRefusal`, `save()`), `client.ts:27-52,305-314`, `strings.ts`
- Modify: `apps/server/src/guide/en/table-service.md` and `es/table-service.md` — a new section `{#eat-here-or-take-away}` (shared id in both): what each setting does, and that a counter order can be switched until it is sent or paid
- Test: `service-settings-fields.test.ts`, `service-settings-fields.a11y.test.ts`, `department-settings.test.ts`, `department-settings.unsaved.test.ts`

- [ ] **Step 1: failing tests:** with `takeawayVat` true, the Service tab shows How it sells with Eaten in selected for a new department; choosing Chosen on the till reveals Starts as (Eaten here); saving sends `{ dining: "till_choice", diningStartsAs: "eat_in" }`; changing only these fields enables Save, and leaving asks about unsaved changes. With `takeawayVat` false neither field is drawn. Axe passes in both themes with Starts as shown.
- [ ] **Step 2:** run (browser mode; check free memory first); expect failures.
- [ ] **Step 3:** implement; write the guide section from the code.
- [ ] **Step 4:** pass; `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`. Look at the dialog in both themes and at phone width.
- [ ] **Step 5:** commit: "Show how each department sells in its settings (A1522)".

### Task 13: the till knows each order's way and prices it to match

**Files:**
- Modify: `apps/server/src/till-setup.ts:35-117` (`readSetupFields` gains `takeawayVat: boolean`; it refreshes through `setupRevision`)
- Modify: `apps/till/src/api/client.ts` — `ZoneOfferCatalogue.context` (`:424-437`) gains `dining: { policy: DiningPolicy; startsAs: Dining } | null` (null when the region has no distinction); order types gain `dining` and `diningChoice`; `switchDining(orderId, dining, revision)` calls `PUT /api/working-orders/:id/dining`; sale, park and pay bodies send `dining`
- Modify: `apps/till/src/state/working-order.ts` (holds the order's `dining`; `#pricedOrder` passes `appliedVatClass(dining, offer)` as each line's class to `priceBasket`), `apps/till/src/state/draft-lines.ts:173` (`takeawayVatClass`)
- Modify: the server's zone catalogue read that builds `context` (find it from `ZoneOfferCatalogue` in `apps/server/src/till-api.ts`)
- Test: `apps/till/src/state/working-order.test.ts`, `apps/till/src/api/client.test.ts` (or the file that pins request bodies), `apps/server/src/till-setup.test.ts`

**Interfaces — consumes:** `appliedVatClass` (Task 2), the order read (Task 10).
**Produces:** `WorkingOrder.dining: Dining`, `WorkingOrder.setDining(dining: Dining): void` (drafts only; a saved order switches through the API), and `vatBreakdown` that follows `dining`.

- [ ] **Step 1: failing tests:** a draft with a Coca-Cola (`reduced` / `general`) at €1.80 shows a 10% band; after `setDining("takeaway")`, a 21% band with base €1.49. A draft in a takeaway department starts `takeaway`; in a `till_choice` department starts as `startsAs`. The sale body carries `dining`. `till-setup.test.ts`: `takeawayVat` is in the setup read, so a change moves `setupRevision`.
- [ ] **Step 2:** run (`pnpm --filter @waitron/till exec vitest run <file>`); expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass.
- [ ] **Step 5:** commit: "Price each till order for how it is sold (A1522)".

### Task 14: the till's Eat here / Take away switch

**Files:**
- Modify: `apps/till/src/screens/till-counter-screen.ts` (`#gridBody` `:391-446`) and `till-table-order-screen.ts` (beside `#viewSwitch` `:3092-3120`): a `wt-segmented-control` with **Eat here** / **Take away** when `diningChoice` is `"open"` (or a draft in a `till_choice` department); a plain label of the current way when `"locked"`; the label **Take away** in a takeaway department; nothing in an eat-in department
- Modify: `apps/till/src/till-app.ts` — the switch calls `switchDining`; the set-lunch refusal (`order.set_lunch_takeaway`) says set lunches are served at the table for now and, when `canSwitch`, offers **Switch to eat here** (which switches, then adds the set lunch again)
- Modify: the till's `codeMessage` wording for `order.dining_fixed`, `order.dining_locked`, `order.dining_differs`, `order.department_dining_differs`, `order.set_lunch_takeaway`, English and Spanish
- Modify: `apps/server/src/guide/en/table-service.md` / `es/` section `{#eat-here-or-take-away}` (from Task 12): one or two sentences on the till side; `apps/till/src/help-guide.ts` link if the screen gets a help bubble
- Test: `apps/till/src/screens/till-counter-screen.test.ts`, `till-table-order-screen.test.ts`, a new `apps/till/src/till-app-dining.test.ts`

- [ ] **Step 1: failing tests:** the counter screen in a `till_choice` department shows the switch with Eat here pressed; tapping Take away calls `switchDining` for a saved order (or `setDining` for a draft) and the total's VAT line changes; after sending, the switch is replaced by the label; a takeaway department shows the Take away label and no switch; an eat-in department shows neither. Adding a set lunch to a takeaway order shows the refusal with **Switch to eat here**, and choosing it leaves the order eat-in with the set lunch added. Each new code renders its own sentence, not "The server needs attention".
- [ ] **Step 2:** run (browser mode; check free memory); expect failures.
- [ ] **Step 3:** implement. Use `userEvent.click` where the outcome depends on update order.
- [ ] **Step 4:** pass. Look at both screens in both themes and at phone width.
- [ ] **Step 5:** commit: "Show Eat here or Take away on the till and let staff switch it (A1522)".

### Task 15: the kitchen ticket and the customer's bill say Take away

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` / `kitchen-ticket.ts` (a **TAKE AWAY** line at the top of a takeaway order's ticket, in the station's ticket language)
- Modify: `apps/server/src/receipt-document.ts:140` and the presented bill's document (find where a bill before payment is laid out from an order): a **Take away** line in the receipt language on a takeaway order's bill and receipt. The order's `dining` is read through `sales.working_order_id` for a receipt
- Test: `apps/server/src/kitchen-ticket.test.ts`, `receipt-document.test.ts`, `receipt-ticket.test.ts`

- [ ] **Step 1: failing tests:** a takeaway order's kitchen ticket contains the takeaway line and an eat-in one does not; a takeaway sale's receipt document contains "Take away" (English) and "Para llevar" (Spanish receipt language), and an eat-in one contains neither; the per-line rate column is unchanged.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement. Render one printed receipt to a file and open it with the workspace's Playwright Chromium to look at it.
- [ ] **Step 4:** pass; also `src/lunch-receipt.test.ts`.
- [ ] **Step 5:** commit: "Print Take away on the kitchen ticket and the bill of a takeaway order (A1522)".

### Task 16: the demo deli sells the ordinary drinks to take away

**Files:**
- Modify: `packages/country-es/src/demo/menu.ts` — delete the three drinks of "Drinks to take away" in `DELI_TAKEAWAY` (`:1414-1510`); the restaurant's cola, cola zero and bottled beer (`~:1200-1230`) gain `takeawayVatClass: "general"`; the deli menu lists those same products under a Drinks category
- Modify: `apps/server/scripts/demo-seed/seed-floor.ts:73-75` (deli policy gains `dining: "takeaway"`), `seed-catalogue.ts` (writes `takeawayVatClass`), `packages/country/src/demo.ts` (the demo product type carries `takeawayVatClass`)
- Modify: `packages/country-es/src/demo/casa-delgado-{ca,gl,valencia}.ts` and `test-fixtures/demo/*.json` as the tests require
- Test: `packages/country-es/src/demo/data.test.ts:334-363`, `apps/server/scripts/demo-seed/seed-floor.test.ts`, `seed.madrid-baseline.test.ts`

- [ ] **Step 1: failing tests:** `data.test.ts` — no deli-only Coca-Cola, Coca-Cola Zero or beer product exists; the restaurant's three carry `vatClass: "reduced"`, `takeawayVatClass: "general"`; the deli menu offers them. `seed-floor.test.ts` — the deli department's policy is `dining: "takeaway"`, the restaurant's `eat_in`.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass; `wa-wt reset demo <worktree>` then `wa-wt demo <worktree>`, sell a Coca-Cola in the deli and see 21% on the till and the receipt, and 10% in the restaurant.
- [ ] **Step 5:** commit: "Sell the ordinary drinks to take away in the demo deli (A1522)".

### Task 17: docs and backlog

**Files:** `docs/developers/products.md:153-172` (the VAT flow: two classes, `dining`, where the class is chosen), `docs/backlog.md` (delete A1522; add to A1513 that a delivery-app order is always taken away), `docs/backlog/catalogue.md` A1515 (a set lunch cannot be taken away until T17 is answered)

- [ ] **Step 1:** edit; `pnpm exec prettier --file-info` is not needed (`docs/` is ignored); `pnpm exec vitest run scripts/claude-md-pointers.test.ts` if a pointer moved.
- [ ] **Step 2:** commit: "docs: record how eat-here and take-away VAT works (A1522)".

**End of PR 3.** `/finish-branch`, full wave.

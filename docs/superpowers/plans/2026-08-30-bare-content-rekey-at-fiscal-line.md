# Bare-`es` catalogue content, re-keyed to full-tag invoice locales at the fiscal line (feature B)

> Implements the owner's choice "B": venues (and the demo seed) author product/menu content under the
> BARE language tag (`es` = "our Spanish"); a write-side transform re-keys it to the location's full-tag
> `invoice_locales` (`es-ES`) at the single point content enters a fiscal line, so the
> `working_order_lines_check_locales` trigger (exact key == `invoice_locales`) still passes.
> Complementary to #167's settled READ-side model (`docs/.../2026-08-30-localization-fallback-negotiation-design.md`),
> not a re-litigation of it. Non-fiscal: AEAT's `DescripcionOperacion` is one string; the per-line
> `descriptions` map is our customer-receipt construct and the trigger is our receipt-completeness guard.

**Constraints:** `git commit -s`; TDD; no touching the immutable fiscal chain; **§5 "nothing may block a
sale"** — the re-key must never throw on the sale path. Coverage gates per package.

## Design (from the 2026-08-30 trace)

- **Choke point:** `apps/server/src/working-order.ts` `priceOrderLines` (~:138), right after
  `const priced = priceBasket(items)`, before `lineRows` is built (:144). Mutate `priced.lines[i].descriptions`
  in place → propagates to `working_order_lines` (:144) AND to `sale_lines` (the same `priced` is returned
  and later fed to `recordSale`). The inherited paths (`priceLockedLines`, move/transfer at ~1114/1680) already
  carry full tags — DO NOT re-key them.
- **Locale source:** read `locations.invoice_locales` FRESH from the DB inside `priceOrderLines` (join via
  `cfg.locationId`), NOT `cfg.invoiceLocales` (env-derived, can drift from what the trigger checks). Closes a
  pre-existing latent bug.
- **Graceful-fill semantics:** produce EXACTLY the `invoice_locales` keys; never throw.

---

### Task 1 — the re-key transform (`@waitron/catalogue`)

**Files:** create `packages/catalogue/src/invoice-descriptions.ts` + `.test.ts`; export from `packages/catalogue/src/index.ts`.

**Interface:**
```ts
// Produce a descriptions map keyed by EXACTLY `invoiceLocales` (full tags), from bare-language catalogue
// content. For each full tag, region-strip to its language and use the catalogue's text for that language;
// if absent, fall back to the primary (first) catalogue value — NEVER throw (§5: nothing blocks a sale).
export function toInvoiceLineDescriptions(
  catalogue: Record<string, string>,
  invoiceLocales: string[],
): Record<string, string>;
```
- For `fullTag` in `invoiceLocales`: `lang = fullTag.replace(/-.*$/, "")`; value =
  `catalogue[fullTag] ?? catalogue[lang] ?? catalogue[<first key whose region-strip === lang>] ?? Object.values(catalogue)[0] ?? ""`.
- Result has exactly `invoiceLocales.length` keys, one per tag (deduate if `invoiceLocales` has dups — it won't).

**Tests (TDD, prove each):**
- `{ es: "Café" }` + `["es-ES"]` → `{ "es-ES": "Café" }` (region-strip match).
- `{ es: "Café", ca: "Cafè" }` + `["es-ES","ca-ES"]` → `{ "es-ES": "Café", "ca-ES": "Cafè" }`.
- Missing language graceful-fill: `{ es: "Café" }` + `["es-ES","ca-ES"]` → `{ "es-ES": "Café", "ca-ES": "Café" }` (fills ca-ES from primary; never throws).
- Extra catalogue languages dropped: `{ es: "Café", en: "Coffee" }` + `["es-ES"]` → `{ "es-ES": "Café" }`.
- Already-full-tag catalogue tolerated: `{ "es-ES": "Café" }` + `["es-ES"]` → `{ "es-ES": "Café" }` (exact-tag arm).
- Empty catalogue → every tag maps to `""` (no throw).

- [ ] failing test → run (fail) → implement → run (pass) → `pnpm --filter @waitron/catalogue test:coverage` → commit `-s`.

---

### Task 2 — wire the re-key into `priceOrderLines` (read invoice_locales fresh)

**Files:** modify `apps/server/src/working-order.ts` (`priceOrderLines` ~:96-179); tests in the existing
`apps/server/src/till-sale*.test.ts` / `working-order`-exercising suites (or a focused new one).

**Steps:**
- [ ] In `priceOrderLines`, after `const priced = priceBasket(items)`: read the location's invoice locales
  from the DB — `select invoice_locales from locations where id = ${cfg.locationId}` (mirror how the trigger
  joins; `cfg.locationId` is in scope). Then `priced.lines[i].descriptions = toInvoiceLineDescriptions(priced.lines[i].descriptions, invoiceLocales)` for each line.
- [ ] TDD: a real-PG test that adds a bare-`es` catalogue product to an order and asserts the resulting
  `working_order_lines.descriptions` is `{ "es-ES": … }` and the trigger PASSES (it would reject bare `es`).
  Prove by deletion: without the re-key, the insert raises the trigger's `descriptions must carry exactly …`.
- [ ] Confirm a filed sale's `sale_lines.descriptions` is likewise `es-ES` (inherited from the re-keyed `priced`).
- [ ] `pnpm --filter @waitron/server test:coverage` (real-PG; `TESTCONTAINERS_RYUK_DISABLED=true`).
- [ ] commit `-s`.

---

### Task 3 — normalize CATALOGUE-side content to bare `es` (seed + catalogue-typed fixtures)

Now that bare catalogue content is re-keyed on the fiscal path, convert catalogue-authored content to bare.
**Use the trace's TYPE-based classification — never a blanket file rename.**

**Convert to bare (`es`/`en`/`ca`):**
- **Seed:** `apps/server/scripts/demo-seed/menu.ts` (`SeedLocale` incl.), `apps/server/scripts/demo-seed/seed-catalogue.ts`.
- **Server catalogue fixtures** (via `createProduct`/`AvailableProduct`): `recipe-api*.test.ts`,
  `till-api*.test.ts` (courses/reprint/rls/tables/transfer/base), `catalogue-api.test.ts`,
  `packages/catalogue/src/operations.test.ts`.
- **Till client `TillProduct` fixtures:** `basket`, `product-grid`, `total`, `tender-pay`,
  `till-allergen-screen`, `working-order.test.ts`, `menu-filter`, `till-table-order-screen`, and the
  `TillProduct` blocks in the MIXED files (`client.test.ts`, `till-app.test.ts`, `till-counter-screen.test.ts`).

**Leave full-tag `es-ES` (fiscal-line-typed — they simulate post-re-key data):**
- `packages/core/*` (`record-sale/correction/substitution/void/incidents`), `fiscal-verifactu/test/write-path-fixtures.ts`,
  `provisioning/venue-apply.e2e.test.ts`, `receipt-ticket.test.ts`, `report-api.overview/reports.test.ts`,
  `till-sale-integrated.test.ts`, all `station-queue`/`till-station`/`till-expo`/`till-ticket-view` fixtures,
  `dashboard-overview-screen.test.ts` TopSeller rows, and the fiscal-line blocks in the MIXED files.

**Update assertions where re-key changes the OUTPUT:** a server integration test that feeds a bare-`es`
catalogue product and asserts the resulting sale/line/receipt description must now expect `es-ES` (the
re-keyed value), not `es`. Do NOT weaken an assertion — update it to the new correct value.

- [ ] Convert file-by-file / block-by-block per the classification. After each cluster run the affected
  package's tests. Then the whole gate: `pnpm typecheck && pnpm lint && pnpm format:check`, and
  `test:coverage` for `@waitron/server`, `@waitron/till`, `@waitron/catalogue`, `@waitron/core`,
  `@waitron/dashboard`. commit `-s` (may split into a couple of commits).

---

### Task 4 — docs (spec + backlog)

- [ ] Add a "Write-side: fiscal-line re-key (feature B)" section to
  `docs/superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md`: catalogue authored bare;
  `toInvoiceLineDescriptions` at `priceOrderLines`; reads `locations.invoice_locales`; graceful-fill (§5);
  the trigger is our receipt-completeness guard (AEAT gets one `DescripcionOperacion` string — verified vs
  the FAQ + `packages/verifactu` on 2026-08-30). Note authoring-time locale-completeness validation is a
  deferred follow-up (graceful-fill covers the sale path).
- [ ] Backlog: add the deferred follow-up (authoring-time validation that a product carries every venue
  invoice-locale's translation, so the receipt is complete rather than graceful-filled).
- [ ] commit `-s`.

## Self-review

Covers: re-key helper (T1) · wired at the one choke point reading fresh invoice_locales (T2) · catalogue
content + seed to bare with the type-split (T3) · docs (T4). §5 honoured via graceful-fill (no sale-path
throw). Inherited/locked paths untouched. Downstream readers improve to exact-hit (per trace §4), no
resolver change needed.

# Units abbreviation + units-screen rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a unit a translatable `abbreviation` alongside its `name`, freeze the abbreviation (not the name) onto every sold line so receipts and the till print the short form, and rebuild the dashboard units screen to match the categories screen.

**Architecture:** A unit's `name` today is shown in the dashboard AND frozen onto sold lines. We split those roles: `name` (full word) for the dashboard, a new `abbreviation` (short form) frozen onto lines and shown wherever a quantity appears. The freeze happens at one point in `packages/catalogue/src/pricing.ts`; everything downstream reads the frozen `working_order_lines.unit_name` column and needs no change. The units screen is rebuilt onto the shared `wt-data-table` conventions the categories screen already uses.

**Tech Stack:** TypeScript, drizzle-orm + drizzle-kit (one config/migration folder per package), Lit + `@waitron/ui` web components, Vitest, PGlite and Testcontainers (real PostgreSQL 18), pnpm workspaces, Hono.

**Spec:** `docs/superpowers/specs/2026-09-14-units-screen-and-abbreviation-design.md` — read it first; this plan argues from it.

## Global Constraints

- **One tenant per database** (owner 2026-09-05). Every catalogue read still scopes `eq(units.tenantId, tenantId)`; a by-id read scopes to the tenant too (`CLAUDE.md` §3). This plan adds no cross-tenant support.
- **Pre-production: schema changes drop and recreate; no data-migration or backwards-compat code** (`CLAUDE.md` §3, §5). The new column is `notNull` with no default; there is no deployed database to preserve.
- **Never hand-edit drizzle snapshots or `_journal.json`; regenerate** (`CLAUDE.md` §3). `scripts/journal-monotonic.test.ts` stays green. A rebase migration-number collision is fixed by regeneration.
- **Grants are read back, not trusted by exit code** (`CLAUDE.md` §3). If a grant assertion is touched, run it as `app_user` with `rolsuper = f` via `asAppUser(tx)`.
- **Error codes name the domain concept and are never renamed once shipped** (`CLAUDE.md` §3). Reuse existing unit codes (`unit.precision_invalid`, `unit.not_found`, `unit.in_use`, `content.translation_required`, `content.translation_invalid`); add none.
- **A grant/content-language assertion on PGlite must call `asAppUser(tx)` before the query under test** (`CLAUDE.md` §4). PGlite arrives as superuser.
- **Every colour/spacing/radius/font in UI reads a `--wt-*` token; no hex, named colours, or `rem`/`em`** (`CLAUDE.md` §3). The rebuilt screen adds no hard-coded chrome.
- **A Lit `<select>` whose options come from a `${…}` expression marks the chosen option with `.selected`** (`CLAUDE.md` §3), never `.value` alone.
- **Custom events are `wt-*`, carry `detail`, dispatched `bubbles: true, composed: true`, and the triggering event is stopped with `stopPropagation()` before re-emitting** (`CLAUDE.md` §3).
- **Coordination:** the `feat/drop-tenant-id` worktree edits `apps/server/src/units-api.ts`, `packages/catalogue/src/operations.ts` and the catalogue unit tests (it renames `withTenant`→`withTransaction`), and when it reaches its Phase B it regenerates the catalogue migration. Whichever branch lands second rebases and regenerates. Do not hand-write the catalogue migration; coordinate land order.
- **Plain English in commit messages and PR text** (`CLAUDE.md`, global). Exact identifiers appear once as pointers; commands go in verbatim.

---

## File Structure

- `packages/catalogue/src/schema/units.ts` — add `abbreviation` jsonb column.
- `packages/catalogue/src/units.ts` — `Unit`/`CreateUnitInput`/`UpdateUnitInput` + `abbreviation`; select it; validate it.
- `packages/catalogue/src/pricing.ts` — `UnitSnapshot`/`PriceableProduct` carry `abbreviation`; freeze `unitName` = abbreviation.
- `packages/catalogue/src/operations.ts` — `SellableUnit`/`sellableUnit`/product-join carry `abbreviation`.
- `packages/catalogue/src/provisioning.ts` — seed full names + abbreviations.
- `packages/catalogue/test/fixtures.ts`, `apps/server/src/testing/seed-units.ts` — test seeds gain `abbreviation`.
- `packages/catalogue/drizzle/*` — regenerated (generated, never written).
- `apps/server/src/units-api.ts` — accept + validate `abbreviation` on POST/PATCH.
- `packages/db/src/schema/{orders,sales}.ts` — comment on the `unit_name` column (no `working-order.ts` source change; see Task 5).
- `apps/till/src/api/client.ts` — `TillProduct["unit"]` gains `abbreviation`.
- `apps/till/src/widgets/product-name.ts` — `unitName()` returns the abbreviation; fallback gains one.
- `apps/dashboard/src/api/client.ts` — `Unit`/`UnitInput`/`UnitPatch` gain `abbreviation`.
- `apps/dashboard/src/widgets/product-editor.ts` + `product-editor-model.ts` — unit option label `Name (abbr)`.
- `apps/dashboard/src/widgets/unit-form.ts` — per-language abbreviation field.
- `apps/dashboard/src/screens/units-screen.ts` — rebuilt to the categories pattern.
- `apps/dashboard/src/i18n/strings.ts` — new strings; "Decimal places" → "Precision".

---

## Task 1: The `abbreviation` column, catalogue types, validation and seeds

**Files:**
- Modify: `packages/catalogue/src/schema/units.ts`
- Modify: `packages/catalogue/src/units.ts`
- Modify: `packages/catalogue/src/provisioning.ts` (`UNIT_NAMES` + insert)
- Modify: `packages/catalogue/test/fixtures.ts`, `apps/server/src/testing/seed-units.ts`
- Regenerate: `packages/catalogue/drizzle/*`
- Test: `packages/catalogue/src/units.operations.test.ts` (or the existing catalogue unit test file)

**Interfaces:**
- Produces: `Unit = { id: string; name: Record<string,string>; precision: number; abbreviation: Record<string,string> }`; `CreateUnitInput = { name; precision; abbreviation }`; `UpdateUnitInput = { name?; precision?; abbreviation? }`. `UNIT_COLUMNS` and `SELLABLE_UNIT_COLUMNS` include `abbreviation: units.abbreviation`.

- [ ] **Step 1: Write the failing test** — a create without an abbreviation in the default language is rejected, and one with it round-trips.

```ts
// in packages/catalogue/src/units.operations.test.ts (PGlite target)
it("requires an abbreviation in the default language", async () => {
  await expect(
    createUnit(tx, tenantId, { name: { en: "Litre" }, precision: 3, abbreviation: {} }, "en"),
  ).rejects.toMatchObject({ code: "content.translation_required" });
});

it("stores and returns the abbreviation", async () => {
  const unit = await createUnit(
    tx, tenantId,
    { name: { en: "Litre" }, precision: 3, abbreviation: { en: "l" } }, "en",
  );
  expect(unit.abbreviation).toEqual({ en: "l" });
  const [listed] = await listUnits(tx, tenantId);
  expect(listed!.abbreviation).toEqual({ en: "l" });
});
```

- [ ] **Step 2: Run it, expect a compile/type failure then a red test**

Run: `pnpm --filter @waitron/catalogue test -- units.operations`
Expected: FAIL — `abbreviation` is not a property of the input / not returned.

- [ ] **Step 3: Add the column** in `schema/units.ts` beside `name`:

```ts
abbreviation: jsonb("abbreviation").$type<Record<string, string>>().notNull(),
```

- [ ] **Step 4: Extend the catalogue types + columns + validation** in `units.ts`:

```ts
export interface Unit { id: string; name: Record<string, string>; precision: number; abbreviation: Record<string, string>; }
export interface CreateUnitInput { name: Record<string, string>; precision: number; abbreviation: Record<string, string>; }
export interface UpdateUnitInput { name?: Record<string, string>; precision?: number; abbreviation?: Record<string, string>; }

const UNIT_COLUMNS = { id: units.id, name: units.name, precision: units.precision, abbreviation: units.abbreviation };
const SELLABLE_UNIT_COLUMNS = { ...UNIT_COLUMNS, hardwareUnit: units.hardwareUnit };
```

In `createUnit`, after the existing `validateContentTranslations(tx, tenantId, input.name, fallbackLanguage)`, add the same call for `input.abbreviation`, and include `abbreviation: input.abbreviation` in the `.values({...})`. In `updateUnit`, when `patch.abbreviation !== undefined` call `validateContentTranslations` on it, add it to the "nothing to change" guard, and let the `.set(patch)` carry it (drizzle maps the field). `SellableUnit` gains `abbreviation` automatically via `Unit`; update `toSellableUnit`'s row param to include `abbreviation: Record<string,string>`.

- [ ] **Step 5: Update the seeds.** In `provisioning.ts`, replace `UNIT_NAMES` with full names and add an `abbreviation` to each seeded row:

```ts
// Full display name shown in the dashboard; the short abbreviation is frozen onto sold lines.
const UNIT_NAMES = {
  each: { en: "Each", es: "Unidad", ca: "Unitat", gl: "Unidade", eu: "Unitatea" },
  g: { en: "Gram", es: "Gramo", ca: "Gram", gl: "Gramo", eu: "Gramo" },
  kg: { en: "Kilogram", es: "Kilogramo", ca: "Quilogram", gl: "Quilogramo", eu: "Kilogramo" },
  mg: { en: "Milligram", es: "Miligramo", ca: "Mil·ligram", gl: "Miligramo", eu: "Miligramo" },
  ml: { en: "Millilitre", es: "Mililitro", ca: "Mil·lilitre", gl: "Mililitro", eu: "Mililitro" },
  l: { en: "Litre", es: "Litro", ca: "Litre", gl: "Litro", eu: "Litro" },
} as const;
const UNIT_ABBR = {
  each: { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" },
  g: { en: "g", es: "g", ca: "g", gl: "g", eu: "g" },
  kg: { en: "kg", es: "kg", ca: "kg", gl: "kg", eu: "kg" },
  mg: { en: "mg", es: "mg", ca: "mg", gl: "mg", eu: "mg" },
  ml: { en: "ml", es: "ml", ca: "ml", gl: "ml", eu: "ml" },
  l: { en: "l", es: "l", ca: "l", gl: "l", eu: "l" },
} as const;
```

> **OWNER-CONFIRM before land:** the `ca`/`gl`/`eu` full names above and the `each` abbreviations (`ea`/`ud`/`u`) are drafts. Flag them to the owner in the PR description and correct before merge — do not silently ship a guess (`CLAUDE.md` §1, external/other-language claims need a source).

Extend the `insert into units (...) values` list to include the `abbreviation` column with `${JSON.stringify(UNIT_ABBR.each)}::jsonb` etc. In `test/fixtures.ts` and `apps/server/src/testing/seed-units.ts`, add `abbreviation` to the `insert into units (...)` column list and give each legacy stub an abbreviation equal to today's short-form name (`{"en":"each",...}` → abbreviation `{"en":"ea",...}` or keep `"each"`/`"kg"` — a bare value is fine in a test seed).

- [ ] **Step 6: Regenerate the migration.** Run the catalogue drizzle generate command (see `docs/developers/conventions-data.md`; a drizzle bump starts with `grep -rn 'dialect.js'`). Do NOT hand-edit snapshots or `_journal.json`. Verify `scripts/journal-monotonic.test.ts` and the grant/`inmutabilidad` assertions stay green.

Run: `pnpm --filter @waitron/catalogue test -- units.operations` and `pnpm --filter @waitron/catalogue test:coverage` (investigate any coverage gap on the new lines).
Expected: PASS.

> **Typecheck note (do not run `typecheck` between Task 1 and Task 2):** making `abbreviation`
> a required field on `Unit` leaves the `sellableUnit(...)` object literal in `operations.ts`
> (`{ id, name, precision, hardwareUnit }`) missing a property, so `pnpm --filter @waitron/catalogue
> typecheck` is RED until Task 2 adds it. Vitest transpiles without a typecheck, so the tests above
> still pass. Tasks 1 and 2 form one typecheck unit; run the catalogue typecheck only at the end of
> Task 2.

- [ ] **Step 7: Commit**

```bash
git add packages/catalogue apps/server/src/testing/seed-units.ts
git commit -s -m "Add a translatable abbreviation to a unit"
```

---

## Task 2: Freeze the abbreviation onto a sold line

> **Sibling fixtures:** this task makes `UnitSnapshot.abbreviation` required. Fix every test
> fixture in `packages/catalogue` that builds a `UnitSnapshot`/`PriceableProduct.unit` literal so
> the catalogue suite stays green (the excess/missing-property errors will point you at them).

**Files:**
- Modify: `packages/catalogue/src/pricing.ts` (`UnitSnapshot`, `priceBasket`, `priceBasketWithOptions`)
- Modify: `packages/catalogue/src/operations.ts` (`sellableUnit`, `PRODUCT_UNIT` select cols, `RawProduct`)
- Test: `packages/catalogue/src/pricing.test.ts` (or the existing pricing test file)

**Interfaces:**
- Consumes: `Unit.abbreviation`, `SellableUnit.abbreviation` from Task 1.
- Produces: `UnitSnapshot = { name: Record<string,string>; precision: number; abbreviation: Record<string,string> }`. `priceBasket`/`priceBasketWithOptions` freeze `unitName` = `item.product.unit.abbreviation`.

- [ ] **Step 1: Write the failing test** — a priced line freezes the abbreviation, not the name.

```ts
it("freezes the unit's abbreviation as the printed label", () => {
  const priced = priceBasket([
    { product: {
        descriptions: { en: "Olives" },
        unit: { name: { en: "Kilogram" }, precision: 3, abbreviation: { en: "kg" } },
        unitPrice: "10.00", vatClass: "general", category: null,
      }, quantity: "1.500" },
  ]);
  expect(priced.lines[0]!.unitName).toEqual({ en: "kg" });
});
```

- [ ] **Step 2: Run it, expect red**

Run: `pnpm --filter @waitron/catalogue test -- pricing`
Expected: FAIL — `abbreviation` missing on `UnitSnapshot`, and `unitName` still equals the name.

- [ ] **Step 3: Extend `UnitSnapshot`** in `pricing.ts`:

```ts
export interface UnitSnapshot { name: Record<string, string>; precision: number; abbreviation: Record<string, string>; }
```

- [ ] **Step 4: Freeze the abbreviation.** In `priceBasket` and `priceBasketWithOptions`, change the parent row's `unitName: item.product.unit.name` to `unitName: item.product.unit.abbreviation`. (The child-option rows keep `unitName: null`.) Add a one-line comment: `// The printed label is the unit's abbreviation, frozen here onto working_order_lines.unit_name.`

- [ ] **Step 5: Carry `abbreviation` through the product read — ALL THREE paths.** `operations.ts`
  has **three** unit-column select blocks feeding **three** `sellableUnit(...)` calls, and the two
  inline ones are what the add-time freeze reads from (the menu read and the live-offer read), so
  all three must carry the abbreviation or the freeze captures `undefined` and receipts/till show a
  blank unit. Do all of:
  1. Extend `sellableUnit`'s signature with a trailing param `abbreviation: Record<string, string> | null`
     and set `abbreviation: abbreviation ?? {}` on the returned object (the only object `sellableUnit`
     builds).
  2. Add `unitAbbreviation: units.abbreviation` to **each** of the three select blocks:
     - the `PRODUCT_*` select at ~line 342 (feeds `RawProduct` → `toProduct`, call site ~390)
     - the menu-items select at ~line 819 (direct call site ~1007)
     - the available-products select at ~line 1620 (direct call site ~1754)
  3. Add `unitAbbreviation: Record<string, string>` to `RawProduct` (destructure it in `toProduct`).
  4. Add the trailing `abbreviation` argument to **all three** call sites:
     - `toProduct` (~390): `sellableUnit(row.unitId, unitName, unitPrecision, row.pricingUnit, hardwareUnit, unitAbbreviation)`
     - the menu-items caller (~1007): append `, row.unitAbbreviation`
     - the available-products caller (~1754): append `, row.unitAbbreviation`

  (There is no "compiles automatically" path — the two inline callers pass positional args from their
  own selects, not `SELLABLE_UNIT_COLUMNS`.)

- [ ] **Step 6: Update fixtures that assert a frozen name.** Existing pricing/receipt tests that assert `unitName` equals the full name now assert the abbreviation — update the fixture's `abbreviation` and the expected value together, preserving the assertion's intent (the frozen label is the unit's printed short form), never deleting the assertion (`CLAUDE.md`, preserve behavioural assertions).

Run: `pnpm --filter @waitron/catalogue test:coverage` **and** `pnpm --filter @waitron/catalogue typecheck`
(this is the first typecheck since Task 1 — see Task 1's typecheck note; it must be green now).
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/catalogue
git commit -s -m "Freeze a unit's abbreviation, not its name, onto a sold line"
```

---

## Task 3: Confirm the frozen label never reaches the fiscal hash

**Files:**
- Test: `packages/verifactu/src/huella.test.ts` (add a case) — plus run the conformance vectors.

**Interfaces:** none produced; this is a verification gate (`CLAUDE.md` §1: reading is not verification — run it).

- [ ] **Step 1: Write a test** proving two records differing only in the unit label hash identically. Build two `alta` inputs whose sale lines differ only in `unitName`, compute the huella for each with `buildCadenaAlta`/`computeHuella`, and assert they are equal. Model it on the existing `huella.test.ts` vectors.

- [ ] **Step 2: Run the new test and the conformance vectors**

Run: `pnpm --filter @waitron/verifactu test:coverage`
Expected: PASS — the conformance vectors (`conformance.test.ts`) stay green, and the new equality test passes, confirming the label is presentation-only.

If the equality test FAILS (the label reaches the hash), STOP — the design's fiscal-neutrality claim is wrong and freezing a different string would be a fiscal change; escalate before proceeding.

- [ ] **Step 3: Commit**

```bash
git add packages/verifactu
git commit -s -m "Prove the frozen unit label is not part of the fiscal hash"
```

---

## Task 4: The units API accepts and validates the abbreviation

> **Sibling fixtures:** update `apps/server/src/units-api.test.ts`'s POST/PATCH bodies and its
> `toEqual({...})` assertions to include `abbreviation`. After this task `apps/server` should
> typecheck and its suite pass (Task 1b already fixed the demo-seed/recipe-api server fixtures).

**Files:**
- Modify: `apps/server/src/units-api.ts` (POST + PATCH bodies)
- Test: `apps/server/src/units-api.test.ts`

**Interfaces:**
- Consumes: `createUnit`/`updateUnit` with `abbreviation` (Task 1).

- [ ] **Step 1: Write the failing test** — POST without an abbreviation is a 400/`management.request_invalid`; POST with one returns it.

```ts
it("rejects a create with no abbreviation object", async () => {
  const res = await post("/management-api/units", { name: { en: "Litre" }, precision: 3 });
  expect(res.status).toBe(400);
});
it("accepts and returns the abbreviation", async () => {
  const res = await post("/management-api/units", { name: { en: "Litre" }, precision: 3, abbreviation: { en: "l" } });
  expect(res.status).toBe(201);
  expect((await res.json()).abbreviation).toEqual({ en: "l" });
});
```

- [ ] **Step 2: Run it, expect red**

Run: `pnpm --filter @waitron/server test -- units-api`
Expected: FAIL — abbreviation ignored.

- [ ] **Step 3: Validate + pass through.** Add a **sibling** validator, not a reuse of `screenName`
  — `screenName` throws `management.request_invalid` with `field: "name"` hard-coded, so a bad
  abbreviation would report the wrong field. Add `screenAbbreviation(value): asserts value is
  Record<string,string>` throwing `{ field: "abbreviation" }`. Assert `body.abbreviation` is a plain
  object in POST and, when present, in PATCH; pass `abbreviation` into `createUnit`'s input and set
  `patch.abbreviation` in PATCH. Widen the `readJsonBody<...>` generic to include
  `abbreviation?: unknown`.

Run: `pnpm --filter @waitron/server test -- units-api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/units-api.ts apps/server/src/units-api.test.ts
git commit -s -m "Accept and validate a unit's abbreviation at the units API"
```

---

## Task 5: End-to-end proof of the frozen label, and the column comment

> **Sibling fixtures:** if `apps/server/src/working-order.test.ts` builds a unit fixture that feeds
> the pricing freeze (a `UnitSnapshot`/`PriceableProduct.unit`), add `abbreviation` to it. A fixture
> that only builds the working-order DISPLAY literal (`{id,name,precision,hardwareUnit}`, the shape
> at working-order.ts:2851) does NOT need it — that literal is unchanged (see the scope note above).

**Files:**
- Modify: `packages/db/src/schema/orders.ts`, `packages/db/src/schema/sales.ts` (comment on `unit_name`)
- Test: `apps/server/src/working-order.test.ts` (or the relevant server order test)

**Interfaces:**
- Consumes: the add-time freeze from Task 2 (via the three `operations.ts` paths).

**Scope note (why no `working-order.ts` source change).** The inline `unit: {...}` context literal in
`working-order.ts` (~line 2851) is a **bespoke display shape** — it does NOT extend `UnitSnapshot`
or `SellableUnit`, so Task 2's type change does not force it to gain `abbreviation`, and it compiles
unchanged. The freeze that decides what receipts/till print happens at **add-time** in `pricing.ts`
(Task 2), sourced from the live offer's `unit.abbreviation` (via `operations.ts` ~1754/~1007, fixed in
Task 2). A **retrieved** parked order re-prices from `productId` through that same live-offer path
(client.ts documents `HeldOrder.lines` as "productId + quantity only, for a basket rebuild that
RE-prices"), and a **locked** re-file preserves the already-frozen `working_order_lines.unit_name`
via `priceLockedLines`. So the abbreviation reaches every filed line without touching
`working-order.ts` or the `working_line_contexts` table.

**Deliberately out of scope:** threading `abbreviation` through the held-order *display* context
(`packages/venue-service/src/{operations.ts,schema/service.ts}`, `packages/module/src/module.ts`'s
`listLineContexts` contract, and a venue-service migration). That table feeds only the on-screen view
of a parked order whose live offer is gone; the feature does not need it. If a future change wants
the abbreviation shown there, it names those files explicitly and regenerates the venue-service
migration.

- [ ] **Step 1: Write the failing test** — a line added then filed carries its unit's abbreviation as the frozen `unitName`.

```ts
it("files a line with the unit's abbreviation as the frozen label", async () => {
  // add a product on a kg unit (name Kilogram, abbreviation kg), file the order,
  // assert the persisted working_order_lines / sale line unitName === { ...: "kg" }.
});
```

- [ ] **Step 2: Run it, expect red until Task 2 is in place; green after**

Run: `pnpm --filter @waitron/server test -- working-order`
Expected: with Task 2 landed, PASS (this test guards the end-to-end outcome of the Task 2 freeze). If it fails, the freeze or one of the three `operations.ts` paths is wrong — fix there, not here.

- [ ] **Step 3: Add the column comment** on `unit_name` in `orders.ts` and `sales.ts`:
`// Holds the printed unit label (the unit's abbreviation), frozen at add-time — presentation only, not part of the fiscal hash.`

Run: `pnpm --filter @waitron/server test:coverage` (investigate any gap).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/orders.ts packages/db/src/schema/sales.ts apps/server/src/working-order.test.ts
git commit -s -m "Prove a filed line freezes the unit abbreviation, and note it on the column"
```

---

## Task 6: The till shows the abbreviation

> **Sibling fixtures:** this task makes `TillProduct["unit"].abbreviation` required. Add
> `abbreviation` to the till test fixtures that build a `TillProduct.unit` literal — at least
> `apps/till/src/state/order-line.test.ts` and `apps/till/src/widgets/tender-pay.test.ts` — so the
> till suite stays green.

**Files:**
- Modify: `apps/till/src/api/client.ts` (`TillProduct["unit"]` type)
- Modify: `apps/till/src/widgets/product-name.ts`
- Test: `apps/till/src/widgets/product-name.test.ts`

**Interfaces:**
- Consumes: the server product payload's `unit.abbreviation`.
- Produces: `unitName(product)` returns the abbreviation.

- [ ] **Step 1: Write the failing test**

```ts
it("labels a product with its unit's abbreviation", () => {
  const product = { id: "p", descriptions: {}, unit: { id: "u", name: { en: "Kilogram" }, precision: 3, abbreviation: { en: "kg" }, hardwareUnit: "kg" } } as TillProduct;
  expect(unitName(product)).toBe("kg");
});
```

- [ ] **Step 2: Run it, expect red**

Run: `pnpm --filter @waitron/till test -- product-name`
Expected: FAIL — `unitName` resolves `unit.name` ("Kilogram").

- [ ] **Step 3: Add `abbreviation` to the till unit type** in `client.ts` — there is one
  `TillProduct["unit"]` object literal (~line 398); the `unit?: TillProduct["unit"]` reuse (~line 493)
  inherits it, so only the literal is edited. Then in `product-name.ts` change `unitName` to resolve
  `unit.abbreviation`:

```ts
export function unitName(product: TillProduct, locale: string = currentLocale()): string {
  const unit = productUnit(product);
  return descriptionFor(unit.abbreviation, unit.id, locale);
}
```

and give the two `productUnit` fallbacks an `abbreviation`: `{ en: "kg" }` for the weight fallback
(matching its synthesised `name`), and `{ en: "ea" }` for the each fallback (the short form of its
synthesised name `{ en: "each" }`).

Run: `pnpm --filter @waitron/till test:coverage`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/till/src/api/client.ts apps/till/src/widgets/product-name.ts apps/till/src/widgets/product-name.test.ts
git commit -s -m "Show a unit's abbreviation on the till"
```

---

## Task 7: Dashboard types + the product editor's unit label

> **Sibling fixtures:** this task makes the dashboard `UnitInput`/`Unit` carry `abbreviation`. Fix
> the dashboard fixtures that build those without it — at least `apps/dashboard/src/api/client.test.ts`
> (the `api.createUnit({...})` call and its `toEqual` assertion) — plus any others the dashboard
> suite flags.

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`Unit`, `UnitInput`, `UnitPatch`)
- Modify: `apps/dashboard/src/widgets/product-editor-model.ts` (a `UnitChoice`) and `product-editor.ts` (the unit option label)
- Test: `apps/dashboard/src/widgets/product-editor.test.ts`

**Interfaces:**
- Produces: dashboard `Unit`/`UnitInput`/`UnitPatch` gain `abbreviation: Record<string,string>` (`UnitPatch.abbreviation?`). A `unitLabel(unit)` renders `Name (abbr)`.

- [ ] **Step 1: Write the failing test** — the unit dropdown option reads `Name (abbr)`.

```ts
it("labels a unit option as name then abbreviation", async () => {
  // mount the editor with units: [{ id: "u", name: { en: "Kilogram" }, abbreviation: { en: "kg" } }]
  // assert the <option> text is "Kilogram (kg)".
});
```

- [ ] **Step 2: Run it, expect red**

Run: `pnpm --filter @waitron/dashboard test -- product-editor`
Expected: FAIL — the option shows only the name.

- [ ] **Step 3: Extend the types and the label.** In `client.ts` add `abbreviation` to `Unit`/`UnitInput` and optional to `UnitPatch`. In `product-editor-model.ts` add `export interface UnitChoice extends EditorChoice { abbreviation: LocalizedText }`. In `product-editor.ts` change the `units` prop type to `UnitChoice[]` and add:

```ts
private unitLabel(unit: UnitChoice) {
  const name = resolveContentText(unit.name, this.locales[0] ?? "en", this.locales[0] ?? "en");
  const abbr = resolveContentText(unit.abbreviation, this.locales[0] ?? "en", this.locales[0] ?? "en");
  return abbr ? `${name} (${abbr})` : name;
}
```

and use `${this.unitLabel(unit)}` in the unit `<option>` map (keep the existing `.selected=${unit.id === this.draft.unitId}`). `catalogue-screen.ts` passes `Unit[]`, which satisfies `UnitChoice[]`.

Run: `pnpm --filter @waitron/dashboard test:coverage` (investigate any gap).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/widgets/product-editor-model.ts apps/dashboard/src/widgets/product-editor.ts apps/dashboard/src/widgets/product-editor.test.ts
git commit -s -m "Show a unit's name and abbreviation in the product editor dropdown"
```

---

## Task 8: The abbreviation field in the unit form

**Files:**
- Modify: `apps/dashboard/src/widgets/unit-form.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (`units.abbreviation`, `units.abbreviation_required`, en + es)
- Test: `apps/dashboard/src/widgets/unit-form.test.ts`, `apps/dashboard/src/widgets/unit-form.a11y.test.ts`

**Interfaces:**
- Consumes: dashboard `Unit`/`UnitInput` with `abbreviation` (Task 7).
- Produces: `wt-submit` detail `{ value: UnitInput }` includes `abbreviation`.

- [ ] **Step 1: Write the failing tests** — an abbreviation field appears per locale, is required in the default language, and is emitted.

```ts
it("emits the abbreviation with the submitted unit", async () => {
  // fill name-en, abbreviation-en, precision; submit; assert wt-submit detail.value.abbreviation.en
});
it("blocks submit with a blank default-language abbreviation", async () => {
  // fill name-en only, submit; assert no wt-submit and an error shown
});
```

- [ ] **Step 2: Run them, expect red**

Run: `pnpm --filter @waitron/dashboard test -- unit-form`
Expected: FAIL — no abbreviation field.

- [ ] **Step 3: Add the field.** Mirror the existing `names`/`name` handling: add `type UnitField = "name" | "precision" | "abbreviation"`, `@state() private abbreviations: Record<string,string> = {}`, seed it in `willUpdate` from `this.value?.abbreviation`, a `#changeAbbreviation(locale, event)` handler, a per-locale `<wt-input data-test=abbreviation-${locale} name=abbreviation-${locale}>` beneath each name field (required + error on index 0), the same trim/prune loop building the emitted `abbreviation`, and a submit validation `if (!defaultLocale || this.abbreviations[defaultLocale]?.trim() === "") errors.abbreviation = t("units.abbreviation_required")`. Add the two strings in both languages (`units.abbreviation` = "Abbreviation"/"Abreviatura", `units.abbreviation_required` mirrors `units.name_required`).

Run: `pnpm --filter @waitron/dashboard test -- unit-form` and the a11y file.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/widgets/unit-form.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/widgets/unit-form.test.ts apps/dashboard/src/widgets/unit-form.a11y.test.ts
git commit -s -m "Add a per-language abbreviation field to the unit form"
```

---

## Task 9: Rebuild the units screen to the categories pattern

**Files:**
- Modify: `apps/dashboard/src/screens/units-screen.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (`units.abbreviation` column reuse; `units.filter_precision_all`; rename `units.precision` label to "Precision"/"Precisión")
- Test: `apps/dashboard/src/screens/units-screen.test.ts`, `units-screen.a11y.test.ts`

**Interfaces:**
- Consumes: dashboard `Unit` with `abbreviation` (Task 7); `wt-data-table`'s `searchable`, `viewKey`, `sortKey`/`sortDirection`, and column `filter` (unchanged primitive).

- [ ] **Step 1: Write the failing tests.** Cover: (a) the create button is inside the header (`.heading`/`.header-actions`), not a `.toolbar`; (b) the table is `searchable`; (c) an Abbreviation column renders a unit's abbreviation; (d) the Precision cell shows `,000` under es and `.000` under en for precision 3, and `0` for precision 0; (e) the precision filter narrows rows; (f) first visit sorts by Name ascending (`sortKey="name"`); (g) a stored sort/filter is restored from `sessionStorage` under `waitron.units.table` (set it in the test, `sessionStorage.clear()` in setup, as `categories-screen.test.ts` does); (h) row-action buttons carry `align="start"`.

```ts
// precision marker example
it("renders precision as the locale decimal marker plus zeroes", async () => {
  setLocale("es");
  const el = await mount([{ id: "u", name: { es: "Litro" }, abbreviation: { es: "l" }, precision: 3 }]);
  expect(precisionCellText(el, "u")).toBe(",000");
  setLocale("en");
  expect(precisionCellText(await mount([{ id: "u", name: { en: "Litre" }, abbreviation: { en: "l" }, precision: 0 }]), "u")).toBe("0");
});
```

- [ ] **Step 2: Run them, expect red**

Run: `pnpm --filter @waitron/dashboard test -- units-screen`
Expected: FAIL.

- [ ] **Step 3: Rebuild the render.** Replace the `.toolbar` block and hand-built search with the categories pattern:
  - A `.heading` flex row: `<h1>${t("units.title")}</h1>` on the left, `<div class="header-actions">` on the right holding the existing `data-test="create"` button (label `units.create`).
  - Drop the screen-level `this.search`/`needle` filtering and the `<wt-input class="search">`; pass the full `this.units` as `.rows` and set on `<wt-data-table>`: `searchable`, `searchLabel=${t("units.search")}`, `viewKey="waitron.units.table"`, `sortKey="name"`, `sortDirection="ascending"`, `noMatchesMessage` (add `units.no_matches`).
  - `#columns()`: Name (search/sort on localized name), a new **Abbreviation** column (search/sort on localized abbreviation, label `t("units.abbreviation")`), **Precision** (sortValue = numeric `unit.precision`; cell = `this.#precisionLabel(unit.precision)`; `filter` with `label`, `allLabel: t("units.filter_precision_all")`, `value: (u) => String(u.precision)`, `options` = the distinct precisions in use as `{ value, label }` with the same marker text), and Actions with `align="start"` on the Edit/Delete `wt-button`s.
  - Add `#precisionLabel(precision: number): string`:

```ts
#precisionLabel(precision: number): string {
  if (precision === 0) return "0";
  const marker = new Intl.NumberFormat(currentLocale()).formatToParts(1.1)
    .find((p) => p.type === "decimal")?.value ?? ".";
  return marker + "0".repeat(precision);
}
```

  (import `currentLocale` from `../i18n/t.js`.) Rename the `units.precision` string value to "Precision"/"Precisión"; add `units.filter_precision_all` and `units.no_matches` in both languages.

Run: `pnpm --filter @waitron/dashboard test:coverage` (investigate any gap; browser-mode package runs in real Chromium — check headroom before a heavy run, `CLAUDE.md` §2).
Expected: PASS.

- [ ] **Step 4: Open it and look.** Start the dev stack from this worktree (`wa-wt demo waitron-units-overhaul`), open the units screen in both themes at phone width, confirm the header button, search bar, precision column and filter render and read correctly (`CLAUDE.md` §4 — a string assertion cannot catch a screen that renders an unreadable value).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/units-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/units-screen.test.ts apps/dashboard/src/screens/units-screen.a11y.test.ts
git commit -s -m "Rebuild the units screen onto the shared table conventions"
```

---

## Task 10: Whole-branch verification and finish

**Files:** none (verification + docs).

- [ ] **Step 1: Update the backlog** if any entry names the old units screen or the "decimal places" label, in this same change (`CLAUDE.md` §7, backlog stays current).
- [ ] **Step 2: Focused cross-package checks.** Run the changed packages' `test:coverage` (catalogue, server, till, dashboard, verifactu) scaled to measured memory headroom (`CLAUDE.md` §2). Confirm the demo seed still builds a menu (`seed-catalogue.test.ts`).
- [ ] **Step 3: Announce readiness.** Tell the owner the branch and its validation are complete and you are ready to run `/finish-branch` (owner workflow rule). Do not open the PR until then; `/finish-branch` runs the review wave, and land order is coordinated with `feat/drop-tenant-id`.

---

## Self-review notes (author)

- **Spec coverage:** abbreviation column/types/validation (T1), seeds (T1), freeze-abbreviation (T2), fiscal neutrality (T3), API (T4), working-order label (T5), till label (T6), dashboard types + editor label (T7), form field (T8), screen rebuild incl. header button, search, precision marker + filter, remembered sort, left-aligned actions (T9), strings + "Precision" rename (T8/T9), backlog + finish (T10). All spec sections map to a task.
- **Type consistency:** `abbreviation: Record<string,string>` is the shape everywhere; dashboard mirrors it as `LocalizedText` (its alias for the same). `unitLabel`/`unitName`/`#precisionLabel` are each defined where used. `UnitChoice extends EditorChoice` reconciles the product-editor prop with the abbreviation read.
- **No placeholders:** every code step carries real code or an exact edit; the two owner-confirm items (minority-language names, `each` abbreviation) are flagged decisions with concrete drafts, not gaps.

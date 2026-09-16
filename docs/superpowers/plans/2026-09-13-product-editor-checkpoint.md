# Products implementation checkpoint

> **Partly superseded, 2026-09-16** (branch `feat/product-editor-rework`). This records where the
> work stood on 2026-09-13; two statements under "Implemented behavior" would now mislead anyone
> acting on them, so read them as history rather than as instructions. A product no longer has
> "distinct translated names and optional descriptions": its Name is plain staff-facing text, a
> translated customer-facing name is a separate optional field, and the `descriptions` column is
> gone. And station and course are no longer separate controls that "remain available after a
> product exists": they save inside the product's own transaction, so a product can be routed as it
> is created. The current account is
> [docs/developers/products.md](../../developers/products.md).

The `products-editor` branch is rebased on current `origin/main` at `89b57526`, which includes the
three landed supporting builds. Units, Categories and Modifiers now use their real operations and
forms in the replacement Products screen.
The Products work is implemented and its focused integration checks pass. The owner confirmed that
the existing zero-rate VAT class is the intended **No tax** choice; whether a future real operation
instead needs an `N1` or `N2` cause is recorded as asesor question Q20.

## Implemented behavior

- Products have distinct translated names and optional descriptions, a kitchen name, direct dietary
  declarations, ordered stable variants, a unit, categories, a Reporting Category and ordered reusable
  modifiers. One transaction saves the aggregate.
- The tax selector labels the existing `zero` VAT class **No tax (0%)**. Missing and invalid choices
  remain errors; pricing and the current `S1` Veri*Factu treatment both retain the explicit zero rate.
- The dashboard has one Products list and editor. Nested Unit, Category and Modifier forms retain the
  parent draft across cancel, rejection, refresh failure and late responses. Existing station and
  course controls remain available after a product exists.
- Allergen and dietary pickers author direct declarations without origins or source fields. Modifier
  choices carry explicit allergen changes and dietary invalidations. Till, station and expo displays
  use those direct values. Recipe navigation and the production authoring route are withdrawn while
  purchasing and historical snapshots remain.
- Menus publish variants explicitly and can override each variant price and availability. The till
  selects a variant and the server resolves its authoritative menu price. Working and sale lines keep
  product, variant and kitchen presentation facts for held orders, kitchen output, receipts and
  reprints.
- The demo has two content languages and shows the new fields on Coffee: two categories with Drinks
  as its Reporting Category, a custom precision-2 unit on another product, translated description,
  kitchen name, two differently priced variants, direct dietary declarations and all four modifier
  types. Extra-shot and variant prices differ between product definitions and the menu; marshmallows
  invalidate meat-free suitability; one extra is unavailable.

## Verification receipts

All commands below ran after the rebase. These are focused checks; CI still owns current-head package
coverage after `finish-branch` pushes the branch.

```sh
pnpm --filter @waitron/catalogue test -- src/product-editor.test.ts src/product-editor-input.test.ts src/product-presentation.test.ts src/dietary-declarations.test.ts src/variants.test.ts src/variants.pg.test.ts src/pricing.test.ts src/modifier-contract.test.ts
pnpm --filter @waitron/server test -- src/catalogue-api.test.ts src/boot.test.ts
pnpm --filter @waitron/server test -- src/working-order.test.ts -t "direct vegan|no direct declarations|nonprice option dietary"
pnpm --filter @waitron/server test -- src/till-sale.test.ts -t "keeps distinct variants"
pnpm --filter @waitron/server test -- scripts/demo-seed/seed-catalogue.test.ts scripts/demo-seed/seed-options.test.ts
pnpm --filter @waitron/dashboard test -- src/screens/catalogue-screen.test.ts src/screens/catalogue-screen.a11y.test.ts src/widgets/product-editor.test.ts src/widgets/product-editor.a11y.test.ts src/widgets/modifier-form.test.ts src/widgets/modifier-form.a11y.test.ts src/widgets/allergen-picker.test.ts src/widgets/allergen-picker.compact.test.ts src/widgets/allergen-picker.a11y.test.ts src/state/product-child-create.test.ts
pnpm exec vitest run scripts/classification-complete.test.ts scripts/append-only-enable-always.test.ts scripts/module-graph-honesty.test.ts scripts/module-seams.test.ts scripts/journal-monotonic.test.ts scripts/errors-reachable.test.ts scripts/live-subscriptions.test.ts
pnpm --filter @waitron/fiscal-verifactu test -- src/privileges.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/fiscal-verifactu test -- src/backend.test.ts -t "zero-rate product"
```

The catalogue selection passed 188 tests; the API and production-boot selection passed 183. The
direct dietary selection passed four tests, the parked-variant regression passed, and the two demo
seed tests passed against real PostgreSQL. The Products dashboard selection passed 82 browser tests,
including both-theme accessibility. The seven root guard files passed 1,447 assertions and the
fiscal privilege/immutability selection passed 11. Dashboard, catalogue, server, till, venue-service
and database typechecks passed.

The No tax label selection passed 32 browser assertions. The real Veri*Factu backend accepted the
controlled zero-rate sale through its record validator and stored `S1`, rate `0.00`, base `5.00` and
tax `0.00` exactly.

The parked-order test initially found `variant_id`, `variant_name` and `kitchen_name` missing when a
working order became a sale. The locked-line query selected those fields but dropped them from its
return value. Returning them made the same real-PostgreSQL test pass while keeping the original price
and names after live catalogue edits.

## No tax decision and asesor follow-up

Owner clarification, 2026-09-13: **No tax** is the existing zero-rate VAT class. The selector changes
its display name and keeps its stored `zero` identifier, `0.00` rate and current `S1` filing treatment.
It is distinct from an omitted tax choice.

AEAT separately requires a non-subject amount and its cause. Its allowed classifications distinguish
`N1`, for Articles 7, 14 or other causes, from `N2`, for place-of-supply rules. The product meaning
already agreed with the owner does not establish that any product is legally non-subject. Q20 in
`docs/compliance/asesor-questions.md` asks whether the venue's intended cases correctly use the
zero-rate `S1` treatment or instead need `N1`/`N2`, and whether the label should change before live use.

| Primary source, retrieved 2026-09-13 | Scope |
| --- | --- |
| [AEAT: Contenido del Registro de facturación de alta](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/cuestiones-generales/contenido-registro-facturacion-alta_.html) | A non-subject operation records both its amount and the cause of non-subjection. |
| [AEAT invoice schema](https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd), `CalificacionOperacionType` | The schema defines distinct `N1` and `N2` values; it does not select one for a product. |

The question is non-blocking for this pre-production build. A future asesor answer that identifies a
non-subject operation will require an explicit classification through sale facts, reporting and every
Veri*Factu sale/correction/substitution path rather than silently changing what `zero` means.

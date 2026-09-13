# Build Units

Branch: `products-units`. Read the [spec](../specs/2026-09-12-product-units-design.md) and
[shared contract](../specs/2026-09-12-products-overhaul-design.md). Implementation is not started.

## 1. Trace and pin the behavior

Read the repository's data, UI, testing and migration conventions. Run
`rg -n 'pricingUnit|pricing_unit|"weight"|"each"' packages apps scripts docs` and distinguish live
unit consumers from unrelated each/weight words. Record the affected paths before changing the
sentinel. Start with `packages/catalogue/src/operations.ts`, `pricing.ts`,
`apps/server/src/working-order.ts`, till quantity controls, `packages/module/src/module.ts`,
`packages/venue-service/src/schema/service.ts`, printing and receipt assembly.

Add failing tests for unit validation and precise quantity acceptance/rejection. Include a negative
control where the database would otherwise round the invalid quantity. Run the test file and
record the expected failure before implementation.

## 2. Persist definitions and assignments

Add catalogue-owned unit schema and product assignment, exported through the catalogue schema
entry used by drizzle. Generate the migration with `pnpm --filter @waitron/catalogue db:generate`;
add grants, classification, change sources, transfer ordering and idempotent provisioning. New
tables do not enter core. Extend default-language validation and gap scans for unit names.

Implement transaction-taking list/read/create/update/delete/assignment operations in section-owned
files such as `packages/catalogue/src/units.ts`. Add real-PostgreSQL tests running as `app_user`
for grants and a two-connection assignment/delete race. Test repeat provisioning, edited seeds and
deleted seeds. Test tenant isolation and rollback rather than only happy-path CRUD.

## 3. Routes and reusable editor

Add section-owned server routes and their registration, browser-local client types/methods,
live-query dependencies, `units-screen.ts`, and `unit-form.ts`. Use the shared `wt-submit`/`wt-cancel`
contract. Add the Units navigation entry without replacing the combined catalogue page. Return the
canonical object after writes, and expose referencing product names when deletion is refused.

Write failing request/response and browser tests before handlers/UI. Cover validation, translation,
duplicate submission, failed write, successful write followed by failed refresh, passive refresh,
focus restoration and accessibility in both themes. Product-form nesting is integrated by Products;
provide a small browser harness proving your form can return an object without changing its host draft.

## 4. Make quantities work through selling

Replace each/weight assumptions with the selected unit's precision and explicit hardware mapping.
Thread snapshots through order and venue-service context, sale presentation, kitchen and printing.
Keep money arithmetic in the existing shared pricing path. Units owns quantity validity; Modifiers
owns modifier validity, including the old gate in `working-order.ts`. Isolate these helpers to keep
the branches' changes composable.

Test a custom unit and a fractional kg sale through the real route/pricer, then park, change the live
unit and resume. Assert exact stored quantity, gross amount and rendered unit label. Keep existing
refund and locked-price assertions. Do not silently convert prices or reinterpret recorded weights.

## 5. Verify and hand off

Run focused catalogue unit/quantity tests, real-PG race/grant tests, affected server sale/order tests
and the changed browser suites. Select explicit files after locating their names; an empty package
filter or a test name matching nothing is not evidence. Use `TESTCONTAINERS_RYUK_DISABLED=true` for
local PG tests and coordinate the single browser-testing turn with sibling sessions.

Run root guards for `classification-complete`, `append-only-enable-always`, `module-graph-honesty`,
`journal-monotonic` and `live-subscriptions` when their areas change. Record commands/results,
canonical contracts and any migration ownership changes in the branch handoff. Update relevant docs
and announce readiness for `finish-branch`. Products owns the combined acceptance journey.

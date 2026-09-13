# Build Modifiers

Branch: `products-modifiers`. Read the [spec](../specs/2026-09-12-product-modifiers-design.md) and
[shared contract](../specs/2026-09-12-products-overhaul-design.md). Implemented with focused local
validation. Branch finishing, its review, push hook and current-head CI remain separate steps.

Products integration: [types, form, API examples and migration](../../developers/modifiers.md).
Operator guide: [reusable modifiers](../../modifiers.md).

## 1. Preserve the current behavioral contract

Read data, UI and testing conventions and the existing ordering-modifier, modifier-allergen and
dietary designs. Trace `optionGroups`, `optionGroupItems`, `productOptionGroups`, `SelectedOption`,
`minSelect`, `maxSelect`, `maxQuantity`, `addOrigins` and `removeOrigins` across the whole repository.
Inspect menu publication in `packages/catalogue/src/schema/menu.ts` and server selection validation
in `apps/server/src/working-order.ts`. Keep anti-overcharge, menu isolation, allergen and stored
snapshot tests. Document the deliberate replacement of the current skip-empty-required-group rule.

Write failing tests for the discriminated union, default validity, unlimited total cap and all four
selection payloads before implementation. Include repeated extras with an invalid negative entry,
explicit false and a required available modifier with no usable choices.

## 2. Definitions, validation and routes

Evolve the current group/item storage and add section-owned operations. Prefer a small
`modifiers.ts` rather than extending every branch's changes through one giant operations file.
Generate affected core/catalogue migrations with their package scripts; add required grants,
classification, transfer and language-gap support. Do not rename shipped error codes; add domain
codes for new failures and test their localized messages.

Save a definition, its choices, defaults and availability in one transaction. Validate type-specific
fields and tenant ownership. Serialize deletion/type changes with attachment/publication writes;
exercise those races on real PostgreSQL. Add routes at `/management-api/modifiers` with request/
response tests, including manager-tenant mismatch, unavailable choice/default handling and rollback
when one choice fails. Update existing API consumers before retiring old endpoints.

## 3. Management screen and form

Create `modifiers-screen.ts` and `modifier-form.ts`, browser-local API methods, translations and
passive live dependencies. Add only the Modifiers shell entry. Leave removal of the old combined
manager to Products integration. The form supplies the shared event contract for nested creation.

Use tests first for switching type on an unused definition, add/remove/reorder choices, price and
quantity validation, translated labels, default controls, availability and failed saves. Cover focus,
keyboard behavior and axe in both themes. Do not create a new generic primitive unless existing
ones cannot express the required controls; any new primitive needs token and accessibility tests.

## 4. Till selection, pricing and snapshots

Build the four input modes in `apps/till/src/widgets/modifier-picker.ts`. Extend its browser-local
wire types, order request parsing, shared server order resolver and menu projections. Separate
selection validation from Units' quantity validator, replacing the current each-only gate without
losing either branch's checks. Unit defaults are not modifier defaults.

Store nonprice selections as structured snapshots; extend working context and completed sale
presentation so receipt/reprint and kitchen read saved facts. Keep extras on the existing decimal
pricer and preserve option VAT override/inheritance in menu configurations. Test each path through
actual route serialization, not only a pure picker or a fake pricer. Cover walk-up, table rounds,
park/resume, quantity editing, split/correction where snapshots are copied, receipt and kitchen.

Coordinate dietary effect types with Products; initially keep current effects working, then consume
its source-free pickers. Do not ship a temporary origin-based editor as the completed overhaul.

## 5. Verify and hand off

Run focused definition/pricing tests, PostgreSQL grants/races, actual server order tests and till/
dashboard browser tests. Coordinate browser execution with other sessions. Run changed-area root
guards, including live subscriptions and schema classification/graph/journal checks. CI owns required
package-wide coverage after the normal push hook.

Supply canonical types, form properties, API examples and migration changes to Products. Update
operator docs and add dated pointers to superseded behavior in historical modifier designs. Record
test commands/results and announce readiness for `finish-branch`. Do not merge autonomously.

## Implementation and validation receipts — 2026-09-12

All four definitions use the existing group/item tables, with generated core migration
`0020_product_modifiers.sql`. The standalone screen, reusable form and till use the canonical
contract. The combined product manager retains its mapped group/item APIs until Products removes
that screen. Selected-item allergen and dietary controls expose no source/origin authoring fields.

Structured snapshots travel through held orders, table rounds, splits, settlement, correction,
substitution, kitchen and receipts/reprints. The correction/substitution regression tests exposed
lost parent/category metadata; those issuance paths now share the sale-line row mapper. Explicit
menu publication and price/VAT overrides remain separate from product attachments.

Tests were added and observed failing before implementation. Later negative cases reproduced
explicit nulls becoming defaults, coerced VAT values, negative menu prices, an omitted canonical
payload bypassing an empty required menu group, and missing selections on a context-less held
response. Each now has a passing regression assertion. A temporary no-op lock experiment made
the real-PostgreSQL blocking assertion fail with both `blocked` and `advisory` false; the experiment
was removed. No grants were widened.

Database commands below ran with `TESTCONTAINERS_RYUK_DISABLED=true` and host Docker access:

| Command | Result |
| --- | --- |
| `pnpm --filter @waitron/catalogue test operations.test.ts modifier-contract.test.ts modifier-projection.test.ts modifiers.pg.test.ts modifier-dependencies.pg.test.ts` | 185 passed; definitions, defaults, legacy mapping, publication, tenant isolation, application-role writes and competing attachment/publication/deletion transactions |
| `pnpm --filter @waitron/server test working-order.test.ts till-sale.test.ts` | 131 passed; all four selections, fractional pricing, retained answers/prices and required empty groups |
| `pnpm --filter @waitron/server test till-api.test.ts` | 100 passed, including actual HTTP menu/product selection, park/resume and table rounds; the extended saved-quantity case also passed after its added assertions |
| `pnpm --filter @waitron/server test till-api.pg.test.ts` | 36 passed, including fiscal issuance, explicit false, menu price/VAT overrides, saved-label reprint and idempotent replay |
| `pnpm --filter @waitron/server test configuration-transfer.test.ts` | 7 passed; exported/imported types, defaults, order, remapped choice IDs and menu prices |
| `pnpm --filter @waitron/core test record-sale.test.ts record-correction.test.ts record-substitution.test.ts` | 89 passed; snapshots and parent/child metadata survive all three issuance paths |
| `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad privileges` | 11 passed against real PostgreSQL |

Additional focused passes covered catalogue pricing/language gaps, management HTTP authorization,
receipt/kitchen rendering, tabs/splits and snapshot label fallback. Dashboard browser checks covered
form/screen behavior, API serialization, navigation, passive reads, localized errors and axe in both
themes. Till browser checks covered all four modes, defaults/reopening, stale choices, serialization,
separate basket lines, dietary effects and saved presentation. Browser runs were serialized.

Changed-package typechecks and changed-file lint/format checks passed. Root checks covered live
subscriptions, classifications, append-only triggers, module graph/seams, migration journals,
error reachability, vocabulary and documentation pointers. Package-wide coverage belongs to CI
after `finish-branch`; it has not run for this unpushed tree.


## Branch review — 2026-09-13

Claude's isolated run-it review took 163 seconds at candidate `063aae50`, base
`f1139e125485c5dec76ef45b8b33c22a3142ec46`. Accepted fixes let modifier readers coexist, bring
retained group/item writers under the same lock, and compare saved selections by value rather than
JSON order. The failing saved-order assertion reported 18.00 instead of 2.00 after a price change.

After fixes, catalogue dependency/operation suites passed 93 tests, management/order consumers
passed 263 tests, and saved-selection/working-order suites passed 129 tests after adding the final
retained-order assertions. A multi-ticket substitution probe returned 23505 for repeated line
numbers and left the sale/substitution counts unchanged. The no-backfill convention remains;
legacy pre-migration caps are not upgraded. A detached type change was exercised through an actual
held-order quantity edit, and retained extras choices were refused through their priced children.

The review report, timing, usage, exact commands and finding-by-finding triage are retained under
`/tmp/waitron-modifiers-review.gIUXNa/`. Browser and rendering experiments were outside the
reviewer's bounded pass; implementation receipts above remain the focused checks for those paths.


CI run `34746191891` exposed six exact receipt-response assertions in
`working-order.pg.test.ts` that omitted `modifierSnapshots: []`. The focused local run reproduced
all six failures; extending the nine expected line objects retained their amount/quantity/parent
assertions and passed all 51 tests with
`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test working-order.pg.test.ts`.


## Rebase onto Categories — 2026-09-13

Rebased onto `f1d1a8b2` (#340), retaining Categories and Modifiers navigation, translations,
product category memberships and ordered modifier attachments. The duplicate shared planning
commit was already on main. The existing Claude review approval is retained; `git range-diff`
shows the review fixes and receipt-fixture correction replayed unchanged.

Core migration 0020 now belongs to Categories. Restored the core migration directory from main
and ran `pnpm --filter @waitron/db db:generate --name product_modifiers`, producing
`0021_product_modifiers.sql` and its generated snapshot/journal entry. The integration guide names
the new file; the earlier 0020 references above record the initial implementation.

With `TESTCONTAINERS_RYUK_DISABLED=true`, focused validation passed:

- `pnpm --filter @waitron/catalogue test operations.test.ts categories.test.ts categories.pg.test.ts modifiers.pg.test.ts modifier-dependencies.pg.test.ts modifier-projection.test.ts`: 110 tests.
- `pnpm --filter @waitron/server test working-order.test.ts working-order.pg.test.ts catalogue-api.test.ts catalogue-api.pg.test.ts configuration-transfer.test.ts`: 323 tests.
- `pnpm --filter @waitron/fiscal-verifactu test privileges inmutabilidad`: 11 tests against real PostgreSQL.
- `pnpm --filter @waitron/dashboard test dashboard-app.test.ts i18n/codes.test.ts screens/modifiers-screen.test.ts screens/categories-screen.test.ts`: 156 Chromium tests.
- `pnpm exec vitest run scripts/journal-monotonic.test.ts scripts/live-subscriptions.test.ts scripts/module-graph-honesty.test.ts`: 30 checks.

Catalogue, server and dashboard typechecks passed. The normal push hook and current-head CI
remain the finishing gate after this rebase.

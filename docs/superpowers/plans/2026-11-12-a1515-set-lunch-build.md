# A1515: set lunch build plan

**Draft for Claude review and watcher clearance, 12 November 2026.** Neither has occurred. The [spec](../specs/2026-11-12-a1515-set-lunch-proposal.md), especially its 20:38/20:54 decisions, governs; the original proposal was not build authorisation.

**Smallest complete outcome:** you configure an €18 lunch using extras, offer it through existing menus/periods, and keep one item per diner. You choose courses later on that same saved item and send each course separately. Two lunches plus ordinary €7.80 Croquettes initially total €43.80; later hake adds €3 once; included coffee leaves €46.80 unchanged. Bill/receipt show two €18 bases, one €3 supplement and unpriced dish descriptions.

**Source reading at `fa9431322b`, not runtime verification:** `extra-contract.ts::{priceForExtraPortion,validateExtraSelections}` distinguishes explicit zero from blank and enforces required lists. `working-order.ts::{applyLineEdits,fireLines,insertSplitExtras,sendLines,stampSent}` refuses/recalls normal edits, filters parents, copies parent courses and stamps children together. Extend lunch handling only. Reuse parent/child prices, service courses, routing and print queues. Availability uses the existing service period’s `menuPeriods.menuId`, resolved by `venue-service/src/operations.ts::listZoneOffers` and `menu-timetable.ts`.

Each numbered slice is a separate PR, estimated at 2–3 hours. Later slices depend on earlier ones; catalogue configuration alone is slice 1's usable finish, not completed lunch service.

1. **Catalogue contract.** Add `products.setLunch` (false by default), plus nullable `product_modifiers.serviceCourseId`, a foreign key to existing kitchen courses. Only lunch extras use this assignment; null means immediate service. Set parent routing to No preparation. Keep required one-pick lists required, with explicit €0 inclusions/€3 premium prices. Save/read and publish these values through the existing management API.

   Exact files: `packages/db/src/schema/{catalogue.ts,catalogue/extras.ts}`; `packages/shared/src/menu-document/{product-types,menu-types}.ts`; `packages/catalogue/src/{product-editor-input,product-editor,product-modifiers,operations,offered-modifiers,menu-document,configuration-transfer}.ts`. Existing `product-editor.test.ts`, `product-modifiers.test.ts`, `offered-modifiers.test.ts`, `menu-document.test.ts` in catalogue own round-trip, course-reference transfer, published metadata and ordinary-extras assertions.

2. **Saved choices.** In `apps/server/src/{working-order,modifier-selection}.ts`, add lunch-only partial selection and same-parent late additions. Store required list/course labels and open/chosen/not-taken state on the parent in `packages/db/src/schema/orders.ts`; child lines keep actual price/name snapshots. Append missing choices after earlier work starts; hold additions until explicit send. Retain parent and existing children without repricing or recall. Return state on reload. Close untaken choices when the order closes, without changing price or sending dishes. `working-order.test.ts` and `split-off-extras.edit.test.ts` own these assertions and unchanged normal-edit refusals.

3. **Independent sends.** Extend the working-order sender and `kitchen-print.ts::buildTicketItems`: lunch children use their own course and product/folder routing, even beside a no-preparation parent or same-station sibling. Selected courses alone create/release kitchen work; earlier work appears only as context. Audit parent expansion/stamping, `order-groups.ts` release/projections and child service state. `split-off-extras.send.test.ts`, `split-off-extras.release.test.ts` and `kitchen-print.test.ts` assert exact new station/course jobs, unchanged earlier stamps/jobs and ordinary extras. `till-api.ts`/`till-api.test.ts` test changed mapping/answers using `useVenueDb`, not dependency failures.

4. **Existing controls.** Change dashboard `widgets/product-editor.ts`, till `widgets/{modifier-picker,basket}.ts`, `state/working-order.ts`, `screens/till-table-order-screen.ts`, `till-app.ts` and `api/client.ts`. Expose lunch/course settings, choose-later state and course sends; bypass merging only for lunches. Their existing focused tests own realistic choices, reload mapping, no second item/charge and ordinary extras. Update EN/ES wording and `guide/{en,es}/{products,table-service}.md`; inspect both themes at phone/desktop widths.

5. **Bill/receipt finish.** Change server `receipt-{adjustments,lines,document}.ts`, `till-sale.ts` presentation types and till `screens/till-ticket-view.ts`. Derive lunch presentation from saved order metadata, including reprints; preserve filed amounts. Existing receipt and ticket-view tests assert separate lunches, supplement once, unpriced dishes, total and ordinary-extra presentation.

Estimated added/removed lines, including generated output; new test support: 0:

| Slice | Production | Tests | Generated baseline |
| --- | --- | --- | --- |
| 1 | +300/−40 | +200/−20 | +140/−40 |
| 2 | +320/−45 | +220/−20 | +100/−35 |
| 3 | +330/−90 | +220/−25 | 0 |
| 4 | +400/−80 | +250/−30 | 0 |
| 5 | +240/−60 | +190/−20 | 0 |

Use observed failing tests before implementation, then focused file runs. Schema slices use TypeScript/`packages/db/triggers/core.sql`, `migration-baseline rebuild --set core`, and all five schema checks named in CLAUDE.md; no manual/new migrations or compatibility code.

**Delivery dependency:** adviser S10/VAT allocation and full invoices remain with Lane L. Live paid-lunch delivery depends on that resolution. No changes to `computeHuella`, chains, invoice numbers, `registros_facturacion`, alta builders, `registerSif` or `restoreFiscal`; no allocation policy, feature flag, bundle engine, ledger, schedule or speculative safeguards.

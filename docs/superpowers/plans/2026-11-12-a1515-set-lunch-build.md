# A1515: table-service set lunch build plan

**Draft for watcher clearance, 12 November 2026.** Separate Sol-high author; driver revisions follow Claude’s approach read. The [spec](../specs/2026-11-12-a1515-set-lunch-proposal.md) records the owner’s decisions; no owner plan approval is claimed.

**Finish:** configure an €18 lunch using extras; keep one item per diner; choose later on that saved item; send each course separately. Two lunches plus ordinary €7.80 Croquettes start at €43.80; later hake adds €3 once; included coffee leaves €46.80 unchanged. Bill, receipt and invoice show separate base/supplement prices and unpriced dishes. Existing `menuPeriods.menuId`, `listZoneOffers` and `menu-timetable.ts` control availability.

**Reuse, from source reading, not runtime checks:** products and order lines already have `courseId`; children have `extraListId`. `working_line_contexts.menu_version_id` records the original published menu; `sale_lines.menu_version_id` retains it for reprints. Derive required-but-unpicked lists and lunch identity from that version, never today’s product. No per-list course column, stored choice-state machine or close-at-payment writer.

Each numbered slice is a PR with a three-hour timebox; later slices depend on earlier ones. These are forecasts, not measured timings.

1. **Configure and publish.** Add `products.setLunch`, default false, in `packages/db/src/schema/catalogue.ts`; propagate through shared `menu-document/{product-types,menu-types}.ts` and catalogue `{product-editor-input,product-editor,operations,menu-document}.ts`. Put the checkbox in dashboard `widgets/product-editor.ts` now, reusing existing extras/course controls and No preparation parent routing. Catalogue `product-editor.test.ts`, `menu-document.test.ts` and dashboard `product-editor.test.ts` own save/publish and unchanged ordinary products. Managers can configure the lunch; service is not yet complete.

2. **Choose later without new records.** Extend catalogue `menu-publication.ts` to batch-read recorded versions; its tests republish/edit today’s menu and retain original choices/marker. Use that reader through venue-service `operations.ts`/`service.ts` and server `{working-order,modifier-selection}.ts`. Derive outstanding required lists minus saved picks; append only missing choices, held until explicit send, retaining earlier ids/prices/stamps after preparation starts. Snapshot each chosen product’s existing course. Lunch components inherit the parent’s restaurant-service VAT class, including €0 coffee; ordinary extras retain their own class. `working-order.test.ts`, `split-off-extras.edit.test.ts`, `modifier-selection.test.ts` and `vat-class-at-line-add.test.ts` own reload, one supplement, unchanged earlier work, only reduced-rate lunch rows and ordinary-edit refusals. Preserve unedited fiscal write-path/inmutabilidad checks.

3. **Send dishes independently.** One shared service-dish predicate includes lunch children. Extend ordinary `fireLines`/`makers()` routing, including default stations and same-station siblings, rather than extra-parent fallback. Trace `sendLines`, `unsentDishLines`, `stampSent`, `order-groups.ts`, `party-allergy.ts`, `order-state-counts.ts`, `finish-party-service.ts` and `unpaid-departure.ts`. Existing matching suites own each caller’s changed answer; `split-off-extras.{send,release}.test.ts` own exact new jobs and unchanged earlier jobs/stamps. API tests own mapping/refusals. In `kitchen-print.ts`, new slips show this course’s dishes, lunch reference and earlier dishes clearly marked as context; no sibling-station cross-reference feature.

4. **Take the order.** Change till `widgets/{modifier-picker,basket}.ts`, `state/working-order.ts`, `screens/till-table-order-screen.ts`, `till-app.ts`, `api/client.ts`. Existing focused suites own later choices, course buttons, reload mapping and no second lunch/charge. Keep lunches separate; ordinary merging remains. Update EN/ES strings and server `guide/{en,es}/{products,table-service}.md`; inspect phone/desktop in both themes.

5. **Print and reprint.** Server `receipt-{adjustments,lines,document}.ts`, `invoice-document.ts`, `till-sale.ts` presentation types and till `screens/till-ticket-view.ts` use the recorded menu-version marker. Their suites assert identical lunches stay separate, supplement once, unpriced inclusions, totals and unchanged reprints after catalogue edits. Preserve filed amounts; no new sale column or filing-path change.

| Slice | Production +/− | Tests +/− | Generated +/− |
| --- | --- | --- | --- |
| 1 | 220/20 | 150/10 | 90/20 |
| 2 | 300/40 | 200/20 | 0 |
| 3 | 440/90 | 280/25 | 0 |
| 4 | 300/60 | 200/20 | 0 |
| 5 | 260/70 | 190/20 | 0 |

New test support: 0; docs about 120 lines. TDD and focused files throughout; schema rebuild via `migration-baseline rebuild --set core` plus CLAUDE.md’s five schema checks, never manual/new migrations.

**Scope:** watcher21:37 relays the owner’s table-service 10% decision: no adviser wait or price split across VAT rates. Takeaway/delivery stay with adviser S10/Lane L, outside this build. No fiscal H2 function changes, allocation engine, ledger, schedule or compatibility layer.

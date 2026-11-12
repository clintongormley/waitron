# A1515: table-service set lunch build plan

**Cleared by the watcher, 12 November 2026 at 22:04, with the three required corrections applied.** Separate Sol-high author; Claude approach/fixes reads complete; driver applied corrections. The [spec](../specs/2026-11-12-a1515-set-lunch-proposal.md) records the owner’s decisions; no owner plan approval is claimed.

**Finish:** configure €18 lunch from extras, one item per diner, later choices and sends by course. Hake adds €3 once; included coffee adds nothing. Two lunches plus ordinary €7.80 Croquettes total €43.80 before hake, €46.80 after. Bill/receipt/invoice keep base/supplement prices and unpriced dishes. Existing `menuPeriods.menuId`/`listZoneOffers` control availability.

**Source reads, not runtime checks:** reuse product/line `courseId`, child `extraListId` and original menu versions in `working_line_contexts`/`sale_lines`. Derive outstanding required choices and lunch identity there. No new course/state columns or payment closer.

Each slice is a dependent PR. Watcher22:04: three hours is a point for a look, not a ceiling; growth past1.5times a PR forecast requires DEVIATION. Sizes are forecasts.

1. **Configure and publish.** Add `products.setLunch`, default false, in `packages/db/src/schema/catalogue.ts`; propagate through shared `menu-document/{product-types,menu-types}.ts` and catalogue `{product-editor-input,product-editor,operations,menu-document}.ts`. Put the checkbox in dashboard `widgets/product-editor.ts` now, reusing existing extras/course controls and No preparation parent routing. Catalogue `product-editor.test.ts`, `menu-document.test.ts` and dashboard `product-editor.test.ts` own save/publish and unchanged ordinary products. Managers can configure the lunch; service is not yet complete.

2. **Choose later.** In catalogue `menu-publication.ts`, batch-read recorded versions through venue-service `operations.ts`/`service.ts`; null version means ordinary line, old formats retain `menu.reset_required`, with no conversion. Server `{working-order,modifier-selection}.ts` reuse lunch-only `extrasListsFor` minimum relaxation and `ADDED_EXTRAS_ONLY`, leaving validators/ordinary edits unchanged. Required lists, later prices and new children’s version context come from the parent’s recorded version. Hold additions until explicit send; keep earlier ids/prices/stamps. Snapshot product courses; lunch components inherit parent restaurant-service class by recorded lunch marker, never No preparation. In `vat-class-at-line-add.test.ts`, retain the ordinary-extra assertion; add €21 lunch/€0 coffee: sole 10% row, base €19.09/tax €1.91. `working-order.test.ts`/`split-off-extras.edit.test.ts` cover reload, republish with changed hake price, then period ending: supplement still €3, coffee accepted, no recall/resend. `working-order.pay-and-dispatch.test.ts` proves an unchosen coffee never blocks payment, changes €21 or sends anything for that choice. `till-api.ts`’s existing PUT `/api/working-orders/:id/lines/:lineNo` tests mapping. Fiscal write-path/inmutabilidad remain unedited.

3. **Send dishes.** A shared service predicate selects ordinary parents or lunch children, excluding the lunch shell. Reuse `fireLines`/`makers()` default-station and course handling; update `sendLines`, `unsentDishLines`, `stampSent`, `order-groups`, `party-allergy`, `order-state-counts`, `finish-party-service`, `unpaid-departure`, `station-move` and `adjustments-apply` service-phase handling. Keep financial families in `move-bill`/`order-preview`; audit their allergy/service details. `orders-list` keeps families but never folds lunches. Matching suites, including `party-main-bill.test.ts`, cover caller answers; `split-off-extras.{send,release,cancel,split,queue}.test.ts` cover independent jobs/stamps and preserved bill families. `kitchen-print.ts` shows only current-course dishes and the lunch reference, never earlier dishes; watcher22:04 supersedes the earlier context direction. No sibling-station feature.

4. **Take the order.** Change till `widgets/{modifier-picker,basket}.ts`, `state/working-order.ts`, `screens/till-table-order-screen.ts`, `till-app.ts`, `api/client.ts` and server `order-drafts.ts`. Focused UI and `order-drafts{,.db}.test.ts` cover later choices, course sends, open-choice Pay and separate lunches. Keep lunches separate; ordinary merging remains. Update EN/ES strings and server `guide/{en,es}/{products,table-service}.md`; inspect phone/desktop in both themes.

5. **Print and reprint.** Server `receipt-{adjustments,lines,document}.ts`, `invoice-document.ts`, `till-sale.ts` presentation types and till `screens/till-ticket-view.ts` use the recorded menu-version marker. Their suites assert identical lunches stay separate, supplement once, unpriced inclusions, totals and unchanged reprints after catalogue edits. Preserve filed amounts; no new sale column or filing-path change.

| Slice | Production +/− | Tests +/− | Generated +/− |
| --- | --- | --- | --- |
| 1 | 220/20 | 150/10 | 90/20 |
| 2 | 300/40 | 200/20 | 0 |
| 3 | 640/90 | 280/25 | 0 |
| 4 | 300/60 | 200/20 | 0 |
| 5 | 260/70 | 190/20 | 0 |

New test support: 0; docs about 120 lines. TDD and focused files throughout; schema rebuild via `migration-baseline rebuild --set core` plus CLAUDE.md’s five schema checks, never manual/new migrations.

**Scope:** watcher21:37 relays the owner’s table-service 10% decision: no adviser wait or price split across VAT rates. Takeaway/delivery stay with S10/Lane L. Watcher22:05 clears the guide-only boundary: table service only, with no takeaway detector or counter refusal. No fiscal H2 function changes, allocation engine, ledger, schedule or compatibility layer.

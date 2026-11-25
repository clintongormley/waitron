# Products bulk availability

[Design §5 and delivery 7(c)](../specs/2026-11-24-products-list-redesign-design.md).

**Finish line.** In either Products view, tick dishes and choose **Mark available (2)** or
**Mark unavailable (2)**. The count includes ticks hidden by search or filters. Show both actions
only when at least one product and no category is ticked. A press saves every ticked product in
one request. The action changes each product’s own flag and preserves its variants’ flags.

**Request.** Reuse #4272’s `PUT /management-api/products/availability` with `{ productIds, available }`
and its existing transaction and menu permission. In `apps/dashboard/src/api/client.ts`, add
`setProductsAvailability(productIds: string[], available: boolean): Promise<void>` and delegate
from the existing single-item method. Extend `api/client.test.ts` to prove the exact multi-ID
request and keep the single-ID assertion. The server’s `menu-api.test.ts` already proves a batch
with a deleted product leaves the valid one available. Run that case and the existing permission
cases as receipts for reusing the route.

**Selection and saving.** In `widgets/product-browser.ts`, pass its full `#selection()` to a new
`widgets/product-bulk-availability.ts` for the counted actions in `product-list-toolbar.ts`, between
Move and Delete. Use the existing toolbar, `wt-button` and EN/ES keys in `i18n/strings.ts`. Capture
the IDs when pressed. Share the in-flight availability map with the row switches to keep a second
availability write off those products until the first answers. Keep unrelated switches usable.
On 204, let one `availabilitySaved(ids, available)` call patch all saved flags together via
`widgets/product-tree-availability.ts` and `screens/products-screen.ts`, then use its usual Products
refresh once. On refusal, keep the ticks and saved flags and show the server’s reason through
`product-list-action-feedback.ts`. Keep the ticks after success so staff can see which dishes they
acted on or reverse the change. Done and switching views already clear them.

**Test first.** Add browser cases in `widgets/product-browser.test.ts` for missing actions on empty,
category-only and mixed selections and for the two counted actions when search hides a tick.
Exercise each action across List and Tree. Assert one complete request, a refusal that leaves the
selection ready to retry, and one callback for the saved batch. In `screens/products-screen.test.ts`,
check the successful snapshot applies both product flags and preserves the variant flag even if a
refresh fails. Add an axe case in `widgets/product-browser.a11y.test.ts` for the new controls. Run
focused Dashboard cases, the design’s required fiscal and menu checks, and normal branch gates.

**Delivery.** Update both Products guides, the Select section of `docs/developers/design-system.md`
and `docs/backlog.md`. Use the existing Products capture setup for the spec’s 1440, 1180 and 390 px
views, languages, themes and states. Show the owner the captures before landing. Keep the editor’s
Category field and browser Back in their own pieces. This slice is Dashboard plus guides. Estimate
130–180 production lines and 140–200 test lines, with no schema change or venue reset.

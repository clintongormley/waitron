# Products bulk availability

[Design §5 and delivery 7(c)](../specs/2026-11-24-products-list-redesign-design.md).

**Finish line.** In List or Tree, tick dishes and choose **Mark available (2)** or **Mark unavailable (2)**.
Count every tick, including those hidden by search or filters. Show both actions for a nonempty
selection of products only. Send one request and change each product’s own flag.

**Request.** In `apps/dashboard/src/api/client.ts`, add `setProductsAvailability(productIds: string[],
available: boolean): Promise<void>` and delegate from the existing single-item method. Reuse #4272’s
`PUT /management-api/products/availability` with `{ productIds, available }`. `api/client.test.ts`
checks the exact multi-ID request and keeps the single-ID assertion. `apps/server/src/menu-api.test.ts`
checks menu permission and a refused batch that leaves the valid dish available.

**Select.** Add the counted `wt-button` actions between Move and Delete in `widgets/product-list-toolbar.ts`
with strings in `i18n/strings.ts`. In `widgets/product-browser.ts`, use the full `#selection()` and capture
its product IDs at press time. Share the current per-ID availability write guard in both directions.
While a selected ID has a row write pending, disable both actions. During a batch give the pressed
button the loading state, block another batch and ignore row writes to its IDs. Keep unrelated switches usable.

**Result.** Use one `availabilitySaved(ids, available)` callback and one refresh on success. Patch the flags
together in `widgets/product-tree-availability.ts`, with a line-neutral callback change in
`screens/products-screen.ts`. Clear only the submitted ticks after success. On refusal, preserve the saved
flags and announce the reason using the shared `product-list-action-feedback.ts` availability notice.
Name the blocked dish from the captured selection when `productId` identifies it. For a deleted or missing
dish, refresh Products so `#keepSelectionOwned` drops its stale tick. For an uncertain response, say the
change could not be confirmed. Clear the old availability notice when either availability action starts.

**Test first.** `widgets/product-browser.test.ts` covers product-only, mixed and empty selections, a
hidden tick, both directions of overlapping writes, and a deleted tick that disappears on refresh so
staff can retry. Check one complete request in each view and a fitted 390 px Spanish bar with ticks.
`screens/products-screen.test.ts` checks both flags update and the variant flag is preserved even when
refresh fails. Exercise the new buttons in `widgets/product-browser.a11y.test.ts`. The queue’s unchanged
gates are `write-path.e2e.test.ts`, `inmutabilidad.test.ts`, `till-api.sell-published.test.ts` and
`till-app-menu-refresh.test.ts`.

**Delivery.** Update the English and Spanish Products guides, `docs/developers/design-system.md`,
`docs/developers/product-categories.md` and `docs/backlog.md`. Reuse the 7(b) Products screen capture
fixture at 1440, 1180 and 390 px in both languages and themes. Show the owner the spec states plus
product-only, mixed and hidden ticks and a refusal before landing. Leave the Move footer wording,
editor Category and browser Back outstanding in the redesign backlog. Expect 90–130 production lines
and 125–175 test lines. The slice needs no schema change or venue reset.

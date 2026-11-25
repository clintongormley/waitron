# Products bulk availability

[Design §5 and delivery 7(c)](../specs/2026-11-24-products-list-redesign-design.md).

**Finish line.** In List or Tree, tick dishes and choose **Mark available (2)** or **Mark unavailable (2)**.
Count every tick, including those hidden by search or filters. Show both actions for a nonempty
selection of products only. Send one request and change each product’s own flag.

**Request.** In `apps/dashboard/src/api/client.ts`, add `setProductsAvailability(productIds: string[],
available: boolean): Promise<void>` and delegate from the existing single-item method. Reuse #4272’s
`PUT /management-api/products/availability` with `{ productIds, available }`. `api/client.test.ts`
checks the exact multi-ID request and keeps the single-ID assertion. `apps/server/src/menu-api.test.ts`
already checks menu permission and a refused batch that leaves the valid dish available.

**Select.** Add the counted `wt-button` actions between Move and Delete in `widgets/product-list-toolbar.ts`
with strings in `i18n/strings.ts`. In `widgets/product-browser.ts`, use the full `#selection()` and capture
its product IDs and names at press time. Put the shared per-ID write guard in
`widgets/product-availability-actions.ts` to keep the browser's file small. Disable both actions
while a selected ID has a row write pending. During a batch keep the pressed button focusable
with loading, disable its opposite and ignore row writes to the batch IDs. Keep unrelated switches usable.

**Result.** Use one `availabilitySaved(ids, available)` callback and one refresh on success. Patch the flags
together in `widgets/product-tree-availability.ts`, with a line-neutral callback change in
`screens/products-screen.ts`. Clear only submitted ticks after success. If the focused action disappears,
focus Done. On refusal, keep the saved flags and show the reason in `product-list-action-feedback.ts`.
Name the dish when `productId` matches a captured name. Otherwise show the refusal reason alone.
For a deleted or missing dish, invalidate `products` through `api.liveData?.invalidate` so the next
snapshot drops its stale tick. Clear the old notice when an availability write starts. A response
that follows Done or a view switch leaves the new selection and focus alone.

**Test first.** `widgets/product-browser.test.ts` covers product-only, mixed and empty selections, a
hidden tick, overlapping writes in both directions, keyboard focus through pending and success, and a
deleted tick that disappears on refresh so staff can retry. Prove new ticks survive and an unnamed
refusal replaces an older notice. Check one request in each view and the ticked 390 px Spanish bar.
`screens/products-screen.test.ts` checks both flags update and the variant flag is preserved even when
refresh fails. Exercise the new buttons in `widgets/product-browser.a11y.test.ts`. The queue’s unchanged
gates are `write-path.e2e.test.ts`, `inmutabilidad.test.ts`, `till-api.sell-published.test.ts` and
`till-app-menu-refresh.test.ts`.

**Delivery.** Update the English and Spanish Products guides, `docs/developers/design-system.md`,
`docs/developers/product-categories.md` and `docs/backlog.md`. Reuse the 7(b) Products screen capture
fixture at 1440, 1180 and 390 px in both languages and themes. Show the owner the Select states in List and Tree before landing, with product-only and hidden
ticks, a refusal, and the mixed selection in Tree. Change the Move window's last button to
Move / Mover and keep Move to… / Mover a… on the toolbar. Expect 90–130 production lines and
140–190 test lines. The slice needs no schema change or venue reset.

# Relative variant names (A357)

Owner decision: 2026-10-07, Lane D queue A357. Name a variant relative to its product:
Seagrams Gin and London Gin may each have Single and Double.

Active products remain unique among active products across the venue. Active variants of
an active product are unique within that product, ignoring case and surrounding spaces.
A variant may share a product's name. Unchanged existing clashes retain the existing
save behavior. Imports apply the same scopes; no stored-name migration is added.

A standalone sold or ordered line shows `<product> (<variant>)`. Staff, customer and
kitchen each use their own pair of names with their existing independent fallbacks.
A line without a variant keeps its current name. A picker, editor table or report row
already nested under the product may show the relative variant name alone.

Sold lines retain the separate parent and variant snapshots. Receipt rendering joins
those snapshots, never live catalogue names. No fiscal builder or record changes:
`packages/core/src/sale-location.ts:10` reads the filed operation description from the
location, and `packages/fiscal-verifactu/src/backend.ts:230` passes that separate value
as DescripcionOperacion. The installed verifactu 0.2.1 hash builder reads invoice identity,
type, tax and total, predecessor hash and record time (`dist/huella.js:60`). These are
read-path receipts; unchanged fiscal suites must also run before branch readiness.

Rename demo variants to relative names. Audit every presentation resolver and reader
of variant_name, including reports, exports, order history and reprint. Replace current
product documentation and prose describing variants as full independent names.
Render long paired names on both 58 mm and 80 mm receipt and kitchen tickets, with
wrapping, and inspect changed screens in EN/ES, light/dark, phone/desktop. Save a till
screenshot and receipt rendering in the campaign FYI for the owner's separator choice.

Existing assertions may change only where they pin the behavior this owner decision
changes; inventory every change for the PR and campaign FYI. Fiscal golden tests,
inmutabilidad, root guards, money and permission assertions stay unchanged.

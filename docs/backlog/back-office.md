# Purchasing, recipes, stock and reports — detail

The open entries are listed in [the backlog](../backlog.md), under "Purchasing, recipes, stock and reports". This file holds
their full text.

## Recipes are removed under A1308 (owner, 2026-11-04)

The question here was whether to delete the recipe routes and screen or to remount them. The owner
decided: "remove it, and remove recipes. we don't use them." Nothing outside tests mounts
`/management-api/ingredients` or `/management-api/products/:id/recipe`, and
`apps/dashboard/src/screens/recipe-screen.ts` is imported by nothing, so no box can reach them
(read, not run). Allergens and diet stay declared directly on the product, as they have been since
#345.

[A1308's menu slice](../superpowers/specs/2026-11-02-rationalisation/tables-menu.md) does the work; its §4
lists everything that goes. These backlog lines go stale with that slice, not before:

- `dashboard.md`: A1227's two tables, the form-width entry's "ingredient form", and the refusal list's
  ingredient form and dietary-origin picker.
- `architecture.md`: A974's and A976's "recipe ingredient" fixture text.
- `docs/developers/products.md:563`, `:784-785`, `:891`, `docs/developers/design-system.md:2863`, `:2882`,
  `:2980`, `docs/developers/ci-and-gates.md:278`, `:319`, `docs/developers/conventions-data.md:1352`.

## Comments and test titles left open by #615

Read, not run:

- `alert.not_found` was documented as never revealing which case applied, but
  `apps/server/src/alerts-api.ts` answers `authorization.not_permitted` for an incident the session
  cannot see and `alert.not_found` for a missing id, so a caller can tell a real incident exists.
- `mirror.bundle_fetch_failed` was documented as logging its cause; nothing logs it
  (`mirror-bundle-fetch.ts` discards the caught error). Whether it should is open.
- `packages/server-kit/src/request-screens.ts` says its screens are the only refusal and an
  unparseable value is stored; a foreign-key column refuses it.
- Test titles: "not an opaque 500" and "non-uuid" titles in `management-api-passkey.test.ts`,
  `catalogue-api.test.ts` and `recipe-api.test.ts`, "option groups, gates, by-id FKs" in
  `catalogue-api.full-manifest.test.ts` (option groups no longer exist), "(Task 7)" in
  `management-api.accounts-and-receipt-config.test.ts`, "(Task 4)" in
  `management-api.device-profiles.test.ts`, and "KDS-1" and "KDS-2" in `management-api.test.ts`.

## A supplier credit note cannot be entered through the dashboard

**OPEN, unqueued.** A negative gross total on the purchase-invoice routes is a supplier credit
note and is accepted and stored by design (see the supplier credit note decision below). The
dashboard form's
`inRange(this.total, 0, Infinity)`
(`apps/dashboard/src/widgets/purchase-form.ts`) refuses one, so the form refuses the very document
the ruling calls legitimate. Nobody has decided whether the form should be relaxed or the credit
note should become its own document type.

## Loose ends left by service Task 12 (#923, adjustment reports)

- A weighed item cancelled in part can differ by a cent between the cancel's list value and what
  stays on the line, so a rate can be a cent's share off. **Next action:** none unless someone
  sees it matter.
- With no day picked, a screen left open past the day's cutover moves to the new, empty day; the
  date inputs show it, nothing announces it. **Next action:** decide whether it should keep the
  day it opened on.

## Decisions and deliberate limits

- **Recipes are dropped, not parked (owner, 2026-11-04).** Recipe depth (nested sub-recipes, plate
  costing, stock depletion) ended with this decision: it assumed an authoring surface that no longer
  exists. If recipes are ever wanted again, they start from a new design. A product's allergens and
  diet are what a person declares on it, and a variant inherits them.

- **Supplier invoice numbers are unique within their issue year (owner, 2026-10-21, A981).**
  The same supplier may reuse a number in another calendar year; the purchase form names the
  other recorded year before saving. Reporting continues to use the receipt date for its period.
  Adviser confirmation remains open in [Q18(b)](../compliance/asesor-questions.md).

- **A negative purchase-invoice total is a supplier credit note (owner 2026-09-21, task N1).**
  The purchase-invoice routes accept and store a negative gross total by design.

**Sales: the category report names each category by its full path (W73, #1212).** Because
every row carries its whole path, a very deep tree prints far more lines than before, and its
print preview is cut short; the owner
chose to leave it as it is rather than shorten deep paths on paper (2026-10-05).

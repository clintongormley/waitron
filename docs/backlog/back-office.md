# Purchasing, recipes, stock and reports — detail

The open entries are listed in [the backlog](../backlog.md), under "Purchasing, recipes, stock and reports". This file holds
their full text.

## The recipe routes and the recipe screen are unreached

- Found by #615 (`apps/server` part d), outside its files or not fixable in a comments-only
  change. **The recipe routes and the recipe screen are unreached**: #345 (`f5c8e7b5f`) removed
  `mountRecipeApi` from `apps/server/src/boot.ts`, nothing outside tests mounts
  `/management-api/ingredients` or `/management-api/products/:id/recipe`, and
  `apps/dashboard/src/screens/recipe-screen.ts` is imported by nothing (`git grep`), while its
  client methods in `apps/dashboard/src/api/client.ts` still call those routes (read, not run).
  Next action: the owner decides whether to delete `recipe-api.ts`, the screen and the client
  methods, or to remount the routes and route the screen. Read, not run: `alert.not_found` was
  documented as never revealing which case applied, but `apps/server/src/alerts-api.ts` answers
  `authorization.not_permitted` for an incident the session cannot see and `alert.not_found` for
  a missing id, so a caller can tell a real incident exists (#615 narrowed the comment; the route
  is unchanged). `mirror.bundle_fetch_failed` was documented as logging its cause; nothing logs
  it (`mirror-bundle-fetch.ts` discards the caught error) — whether it should is open.
  `packages/server-kit/src/request-screens.ts` says its screens are the only refusal and an
  unparseable value is stored; a foreign-key column refuses it (read, not run; #615 narrowed the
  `till-api.ts` twin). `docs/developers/conventions-ui.md` says the no-secret-in-params rule is
  stated per code in `apps/server/src/errors.ts`; it is now stated once, in that file's header.
  Test titles #615 could not touch: "before it reaches Postgres" (two, in
  `management-api-passkey.test.ts`), "not an opaque 500" and "non-uuid" titles in
  `management-api-passkey.test.ts`, `catalogue-api.test.ts` and `recipe-api.test.ts`,
  "option groups, gates, by-id FKs" in `catalogue-api.full-manifest.test.ts` (option groups no
  longer exist), "(Task 11)" twice in `management-api.canvases.test.ts`, "(Task 7)" in
  `management-api.accounts-and-receipt-config.test.ts`, "(Task 4)" in
  `management-api.device-profiles.test.ts`, and "KDS-1", "KDS-2", "FP-2" and "KDS-3" in
  `management-api.test.ts`.

## A supplier credit note cannot be entered through the dashboard

**A supplier credit note cannot be entered through the dashboard — OPEN, unqueued.** A negative
gross total on the purchase-invoice routes is a supplier credit note and is accepted and stored by
design (see the supplier credit note decision below). The dashboard form's
`inRange(this.total, 0, Infinity)`
(`apps/dashboard/src/widgets/purchase-form.ts`) refuses one, so the form refuses the very document
the ruling calls legitimate. Nobody has decided whether the form should be relaxed or the credit
note should become its own document type.

## Decisions and deliberate limits

- **A negative purchase-invoice total is a supplier credit note (owner 2026-09-21, task N1).**
  The purchase-invoice routes accept and store a negative gross total by design.

**Sales: the category report names each category by its full path (W73, #1212).** Because
every row carries its whole path, a very deep tree prints far more lines than before (the
deep-tree case in `apps/server/src/category-sales-page.test.ts`, at 58mm and 203dpi, went from about
1,000 lines to about 14,500, measured 2026-10-05), and its print preview is cut short; the owner
chose to leave it as it is rather than shorten deep paths on paper (2026-10-05).

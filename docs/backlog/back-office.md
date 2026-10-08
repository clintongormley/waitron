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

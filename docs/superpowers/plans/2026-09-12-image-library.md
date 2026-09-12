# Image library implementation

## Status, 2026-09-12

Content-language configuration, editing and fallback, the media module, image management and product
selection are implemented in the `image-library` branch. Workspace validation is complete; the
branch is ready for `finish-branch`. No branch review, pull request or merge is claimed here.

The steps below are the implementation sequence. The recorded checks at the end describe focused
runs during development, not a final check of every later edit.

Design: [Image library](../specs/2026-09-12-image-library-design.md).

Prerequisite: implement [content languages](../specs/2026-09-12-content-languages-design.md)
before the media module. Its runtime list and explicit default drive image translation fields,
validation, fallback and language-aware search. The image library's original requirements remain
in scope after that prerequisite.

1. Add the media module and generated migrations. Test metadata validation, byte storage,
   duplicate handling, labels and multilingual ranked search with failing tests first.
   Register migration ownership, state classification, permission and transfer declarations.
2. Add management routes and public byte serving through the module route contribution.
   Test authentication, tenant isolation, request limits and validation. Replace product upload
   with the library operation and enforce product references in the database. Test usage and
   concurrent deletion against real Postgres as the deployment application role.
3. Build the library browser and editor with shared UI components and translated copy. Add the
   contributed navigation page and a reusable product picker through the dashboard composition
   boundary. Test all user operations, accessibility, form submission and request ordering.
4. Move demo seed, configuration transfer and backup media into the database path. Retain
   behavioural assertions while replacing filesystem assertions with database round trips.
   Verify image serving through trading boot and image bytes after restore.
5. Run focused package coverage, the cross-tree guards and the complete repository gate once.
   Audit consumers and prose across the branch, update the backlog and announce readiness for
   `finish-branch`. Do not merge without `land-branch` authorization.

## Focused evidence, 2026-09-12

- `pnpm --filter @waitron/dashboard test src/widgets/product-form.test.ts src/widgets/product-form.a11y.test.ts src/widgets/option-group-manager.test.ts src/widgets/option-group-manager.a11y.test.ts`:
  103 tests passed, including required default text, editing modifier translations while preserving
  disabled languages, Cancel, field identity and accessibility in both themes.
- `pnpm --filter @waitron/venue-service run test --project browser`: 43 tests passed, including
  configured fallback, section translations and direct editing of sections with no offers.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test src/catalogue-api.test.ts`:
  134 tests passed after adding section list/edit routes and correcting the Spanish-default product
  fixture. The new section tests include permission refusals and foreign-tenant identifiers.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test src/provisioning.test.ts`:
  seven tests passed for country/area-derived defaults, independent receipt languages and preserving
  authored language settings on another seed.
- `pnpm --filter @waitron/media run test --project browser src/dashboard/image-library.test.ts src/dashboard/client.test.ts src/dashboard/image-picker.test.ts`:
  22 tests passed, including both date and name sorting directions.
- `pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/changed-scope.test.mjs`: 154 tests
  passed after reproducing the three CI registration failures. Media has a dedicated Chromium and
  real-Postgres coverage job and is excluded from both light bins.
- `pnpm --filter @waitron/till test src/widgets/basket.test.ts src/widgets/station-queue.test.ts src/screens/till-expo-screen.test.ts src/widgets/product-name.test.ts`:
  150 tests passed. `pnpm --filter @waitron/dashboard test src/widgets/top-sellers-table.test.ts src/i18n/localized.test.ts src/screens/dashboard-overview-screen.test.ts src/screens/dashboard-sales-screen.test.ts`:
  35 tests passed. The four new regressions first reproduced missing recorded names with Catalan-only
  content and Spanish receipt snapshots; the fix keeps snapshot resolution separate from live
  catalogue fallback, including retrieved basket modifiers.
- `pnpm --filter @waitron/shared test:coverage`: 226 tests passed after adding the snapshot resolver;
  99.68% lines and statements, 98.75% branches and 100% functions in that run.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/restore-fiscal-e2e.test.ts -t 're-registers the SIF'`:
  one test passed and three were skipped. The populated-image fixture restored image bytes, names
  and labels through the real database restore path, alongside the existing fiscal assertions.
  The first restore attempt exposed an unqualified `media_text_config` call while rebuilding the
  search index with an empty `search_path`; the passing run uses `public.media_text_config` in the
  SQL helper functions.

## Final validation, 2026-09-12

- `pnpm lint`, `pnpm typecheck` and `pnpm format:check` passed after the final code and test edits.
  `pnpm install --offline --frozen-lockfile` also passed.
- Root `pnpm exec vitest run --coverage` passed: 2,700 tests in 31 files. The later
  `scripts/live-subscriptions.test.ts` rerun passed after adding content-language refresh to images.
- Workspace `test:coverage` completed successfully for all 47 packages declaring that script.
  The initial whole-workspace run and its continuations used a two-package concurrency limit;
  failed or unrun packages were rerun after fixes. Real-Postgres runs used
  `TESTCONTAINERS_RYUK_DISABLED=true`, and browser runs used host Chromium.
- The final media coverage run passed 80 tests, provisioning passed 263, and server passed 3,058.
  Server boot and provisioning fixture regressions passed all 47 tests before that coverage run.
- Dashboard's final focused accessibility and recipe-language checks passed 63 tests; its subsequent
  unfiltered `pnpm --filter @waitron/dashboard test:coverage` passed. The accessibility fixtures now
  supply content-language configuration, and recipe assertions exercise both Spanish and English
  defaults while retaining the missing-description id fallback.
- Comparing successful package results with every workspace manifest left no coverage package
  outstanding. `git diff --check` passed. Whole-branch review and CI belong to `finish-branch`.

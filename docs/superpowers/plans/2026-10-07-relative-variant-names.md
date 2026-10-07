# Relative variant names implementation plan

> Execute inline with superpowers:executing-plans and test-driven-development; one whole-branch review during finish-branch.

**Goal:** Allow relative variants and identify each standalone line by its parent and variant.

**Architecture:** Keep separate stored names and snapshots. Scope existing folded-name
checks by parent, and compose displayed pairs through catalogue's existing audience resolvers.

**Tech stack:** TypeScript, Drizzle/node:sqlite, Vitest, real Chromium.

**Spec:** `docs/superpowers/specs/2026-10-07-relative-variant-names-design.md`

## Constraints and review focus

No fiscal builder, chain, allocation or stored-record changes; no name migration. Keep
case folding, unchanged-clash behavior, active-parent counting, swaps and concurrency.
Test sibling activation after an inactive interval, omitted active flags on imports,
empty locale maps, sold snapshots after a live rename, and long paired printed labels.

## 1. Scope catalogue names

Files: `packages/catalogue/src/product-names.ts`, `configuration-transfer.ts`,
`product-names.db.test.ts`, `configuration-transfer.test.ts`.

- [x] Add owner's Seagrams Gin/Single and London Gin/Single save test; run
  `pnpm --filter @waitron/catalogue exec vitest run src/product-names.db.test.ts`
  and observe product.name_taken before implementation.
- [x] Add import cases for identical variants across parents and sibling refusal.
  Change old cross-product refusal checks to persisted success checks; retain same-parent
  refusals and case folding. Record the before/after inventory in campaign receipts.
- [x] Restrict product lookups to parent_id null; compare each variant family independently.
  Single-row updates query only the row's parent scope. Import groups by parent_id.
- [x] Run both suites and related name-key/editor suites; test same-parent racing saves
  and distinct-parent racing saves. Prove each refusal guard by removal in an installed
  disposable clone, alongside a legitimate success control. Commit with `git commit -s`.

## 2. Compose names for each audience

Files: `packages/catalogue/src/product-presentation.ts` and its test,
`apps/till/src/widgets/product-name.ts`, `apps/server/src/receipt-lines.ts` and tests.

- [x] Test staff `Seagrams Gin (Single)`, customer `Customer gin (Customer single)`
  and kitchen `GIN (SGL)` with all audience names different, plus no-variant and fallback
  cases. Update old variant-alone checks with the approved pair expectations; watch RED.
- [x] Join each audience's parent and variant through the shared resolver. Retain separate
  snapshot maps and use frozen maps when joining receipt names.
- [x] Run resolver, till name, receipt and kitchen focused suites. Verify unedited fiscal
  write-path.e2e and inmutabilidad before committing.

## 3. Audit standalone and nested consumers

Files selected by `rg 'staffPresentationName|kitchenPresentationName|joinCustomerPresentationText|variant_name|variantName' apps packages`.

- [x] Record each caller's standalone/nested decision; trace reporting, exports, history,
  order detail and reprint. Add failing behavioral cases for uncovered standalone readers.
- [x] Use shared staff resolver for standalone order detail; leave nested top-seller variants
  relative. Verify parent grouping distinguishes both gin products through real database tests.
- [ ] Run each affected screen in Chromium, including axe where markup changes, with different
  audience fixtures. Update demo seeds and fixtures from full to relative names.

## 4. Documentation, rendering and gates

- [x] Rewrite `docs/developers/products.md` and audit old-rule paraphrases in docs and comments.
  Update `docs/backlog.md` with precise completion status. Keep historical docs with dated pointers.
- [ ] Render long paired receipt/kitchen labels at 58/80 mm; inspect wrapping. Inspect till,
  order detail and relevant reports in EN/ES, both themes, 390/1280. Add FYI image references
  to campaign questions and changed-check inventory to PR.
- [ ] Rebase, full review path per queue; triage findings test-first, normal pre-push hook,
  every current-head CI job. Land only green under the lane's atomic main.lock; install and
  clean up managed worktree/local+remote branch. Record exact merge CI and queue receipts.

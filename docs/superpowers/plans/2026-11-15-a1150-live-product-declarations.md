# A1150: Live product declarations — implementation plan

**Basis:** [published design](../specs/2026-11-15-a1150-live-product-declarations-design.md),
commit `2f217370f582068be71dbc6b6f310c7f83ce3fa3`. Request in `docs/backlog.md` A1150
and `~/waitron-campaign-j/queue.md`: “Allergens and diet labels come from the live product
on every screen”. Claude reviewed the design; the watcher cleared it on 15 November at
18:46. No owner approval of the design or plan is recorded. This plan awaits Claude review
and watcher PLAN FOR APPROVAL clearance; this drafting involved source inspection only.

**Finish line:** saving a product declaration changes every design-mapped live reader without
republishing; sent till/history dishes and extras retain first-send capture. Held remains live
until release. Prices, names, choices and recorded versions/hashes remain intact.

**Proposed delivery for watcher clearance: one coherent PR**, including guides. Stripping and
hydration must ship together; a layer-only split would leave inconsistent allergy information.
Budget 165 active minutes through PR creation, with 15 minutes reserve, excluding outside waits:
steps 1–4 approximately 40/35/45/45 minutes. Estimated changed lines: **360 production,
460 behavioral tests, 40 test-support**, plus approximately 100 documentation lines. These are
estimates, not caps. Beyond 1.5× the estimate, or if three hours appears unattainable, obtain
watcher outside opinion before expanding; never land an incomplete boundary to meet the clock.

## Implementation and owning tests

For each behavior below: add/change the owning assertion, observe meaningful **FAIL**, make
the minimal implementation, then observe **PASS** with a nonzero test count. Reuse fixtures;
give published/live/captured declarations and parent/variant/extra different values. Repeat
caller assertions only for different output or recovery.

1. **Strip and hydrate atomically.** Change
   `packages/shared/src/menu-document/{menu-document-types,guest-menu}.ts`,
   `packages/shared/src/index.ts`, and
   `packages/menu/src/{menu-document,menu-navigation,menu-publication,index}.ts`.
   Extend `OverlayOfferField`, frozen extra and served types; `freezeOffer` omits dish/variant
   `allergens`, `diet`, `dietOverride`, `dietaryDeclarations` and extra `addAllergens`/`suitableFor`.
   Extend batched `readLiveRows`/`applyLiveFields` and `liveFieldsDigest`, using
   `variant-fallback.ts` effective columns. Keep `offerLineValues` diet derivation from live
   `dietOverride`; labels retain direct-declaration expansion. Preserve null unreviewed versus
   `{}` reviewed-empty, inheritance and independent extras. Require a hydrated document at
   `publicGuestMenu` through one adapter over `applyLiveFields`; omit missing-product members
   rather than restoring frozen declarations. Remove declaration
   comparisons/navigation and `ProductChangeField` cases, including
   `apps/dashboard/src/widgets/menu-preview.ts` labels. Hydrate working offers for warnings.
   `packages/menu/src/menu-document.test.ts` owns stripping, inheritance, missing rows, batching,
   digest changes and declaration-independent hash/diff; `menu-allergen-warnings.test.ts` owns
   advisory active-variant/null policy. Change its stale-preview trigger to a publishable edit.
   `menu-publication.test.ts` owns unchanged status for declaration-only edits after publishing
   a stripped document and
   preserved recorded bytes/hashes, including an earlier edition carrying old declarations;
   `menu-navigation.test.ts` retains publishable-edit destinations. Keep A1151 exclusions in
   `menu-patch.test.ts`. Adapt shared `guest-menu.test.ts` and dashboard
   `widgets/{test-helpers.ts,menu-preview.test.ts,menu-preview-navigation.test.ts}` fixtures
   without weakening unrelated assertions.

2. **Complete server readers.** Change `apps/server/src/{guest-menu-api,line-nutrition,working-order}.ts`.
   Hydrate all four `publicGuestMenu` producers: Cloud pages, manager preview, earlier-version
   paper and public page. Reuse the live-row query pattern for held retrieval, batching chosen
   product ids including extras outside current offers; bypass `readLineNutrition`'s filtered
   display result. Return current diet/override/declarations without replacing stored sale facts.
   `menu-allergen-workflow.test.ts` owns held retrieval beyond offers, including null/empty and
   chosen variants. Keep `sent-line-nutrition.test.ts` capture/replay/split/later-extra/missing-capture
   assertions. `guest-menu-api.test.ts` owns four outputs, old-paper prices/names and missing-row
   handling. `cloud-guest-menu.test.ts` owns changed generated-body reconciliation without a
   menu publication. Reuse `cloud-worker.ts`/`boot.ts` wiring unchanged. Retain kitchen live-read
   coverage in `kitchen-allergy.reads.test.ts` and `kitchen-print.allergy.test.ts`.

3. **Refresh till displays without editing orders.** Change
   `apps/till/src/{api/client,till-app,state/menu-refresh,state/working-order,widgets/menu-browser,widgets/basket}.ts`.
   Reuse `menuOfferToTillProduct`, the existing menu-state poll/digest and request/dialog guards.
   Apply declarations separately from price reconciliation even at the same version, to unsent
   counter/table drafts, held/last-added lines and open information/choice views. Preserve line
   identity, selections and prices; do not mark orders edited or save drafts. Reuse
   `draft-sync.ts`'s display-only `reshow` where applicable. `state/menu-refresh.test.ts` owns
   declaration-only replacement; `till-app-menu-refresh.test.ts` owns poll wiring, counter/table,
   held/last-added, no-save/no-confirmation and stale-request recovery. Keep all four filter
   meanings (vegan, vegetarian, no-meat, no-fish) in `menu-filter.test.ts`;
   `widgets/menu-browser.nutrition.test.ts` owns open-view
   refresh, `modifier-picker.allergens.test.ts` choices, and `basket.line-details.test.ts` detail
   refresh with sent capture preserved.

4. **Guides and finish.** Update `apps/server/src/guide/{en,es}/{products,modifiers,table-service}.md`
   and `docs/developers/{design-system,products}.md`: save without republishing, inheritance,
   separate extras, Recorded when sent, live kitchen and reopening previews; retain anchors.
   No transition guidance. Remove A1150 from `docs/backlog.md` when delivered. No migration,
   compatibility layer, reset, second hash, tables, records, protocols, polling service or A1517
   redesign; retain format 4 and the single full-document hash.

## Focused verification and review

Run from the repository root, using only named files:

```sh
pnpm --filter @waitron/menu exec vitest run src/{menu-document,menu-allergen-warnings,menu-publication,menu-navigation,menu-patch}.test.ts
pnpm --filter @waitron/shared exec vitest run src/menu-document/guest-menu.test.ts
pnpm --filter @waitron/server exec vitest run src/{menu-allergen-workflow,sent-line-nutrition,guest-menu-api,cloud-guest-menu,kitchen-allergy.reads,kitchen-print.allergy,guide-content}.test.ts
pnpm --filter @waitron/till exec vitest run src/state/menu-refresh.test.ts src/{till-app-menu-refresh,menu-filter}.test.ts src/widgets/{menu-browser.nutrition,modifier-picker.allergens,basket.line-details}.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/widgets/{menu-preview,menu-preview-navigation}.test.ts
pnpm exec vitest run scripts/guide-links.test.ts
```

Resolve A1308 collisions on rebase. Run the normal push hook and require current-head CI;
no whole-package local runs. Use the full safety-relevant `finish-branch` path: initial rebase,
two Claude run-it reviews for the cross-package contract, then a fresh Claude read of fixes.
PR creation is the three-hour milestone, not permission to merge.

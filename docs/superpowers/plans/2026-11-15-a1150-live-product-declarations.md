# A1150: Live product declarations — implementation plan

**Basis:** [design](../specs/2026-11-15-a1150-live-product-declarations-design.md), published
`2f217370f582068be71dbc6b6f310c7f83ce3fa3`; A1150 in `docs/backlog.md` and Lane J’s queue:
“Allergens and diet labels come from the live product on every screen”. Claude reviewed the
design. The watcher’s 15-November 18:46 clearance in Lane J’s `questions.md` says: “Take the
stripping design and keep the current document format, recorded versions and the single hash:
no migration, no second hash, no reset.” It also forbids transition guide text. No owner approval
of this design or plan is recorded. Claude reviewed this plan in two reads; the watcher cleared
it on 15 November at 19:44 with the corrections incorporated below.

**Finish line:** saving declarations updates all design-mapped live readers without publishing.
Sent till/history dishes and extras retain first-send capture; held stays live until release.
Keep prices, names, choices, four diet-filter meanings and recorded versions/hashes.

**Two proposed, independently usable PRs:** 1 serves current declarations to new/reloaded till
views, held retrieval and guest outputs; 2 refreshes already-open till lines and choice views.
The same-version open-line snapshot gap remains until PR 2, as today; both finish before go-live.
Guides ship with each behavior. Each slice has three active hours **including finish-branch
reviews, fixes and the hook through PR creation**, excluding outside waits. Estimates of changed
production/tests/support lines: PR 1 **300/400/40**, PR 2 **150/250/20**, plus about 70/30 docs.
The larger total corrects omitted fixture/type edits and open-view wiring, not added behavior.
Beyond 1.5× a slice estimate, or an unattainable three-hour milestone, stop for watcher outside
opinion; do not weaken a boundary or increase the budget yourself.

## PR 1 — current declarations at every read

1. **Test first, then strip and hydrate.** Extend assertions in
   `packages/menu/src/{menu-document,menu-allergen-warnings,menu-publication,menu-change-navigation,menu-patch}.test.ts`;
   observe meaningful FAIL, implement minimally, observe PASS. Reuse distinguishable
   published/live/captured and parent/variant/extra fixtures. Menu-document owns stripping,
   batched inheritance, null/empty, missing rows and digest; publication owns declaration-only
   status and unchanged recorded bytes/hashes. Warning policy stays advisory; change its stale-token
   trigger to a publishable edit. Change-navigation retains destinations for publishable edits;
   patches retain declaration exclusion. No repeated caller failure matrices.
2. Change shared `src/menu-document/{menu-document-types,guest-menu}.ts` and `src/index.ts`;
   menu `src/{menu-document,menu-navigation,menu-publication,operations,offered-modifiers,index}.ts`.
   Extend `OverlayOfferField`/frozen extras; served types require declarations. Omit declarations
   in `freezeOffer`; extend `readLiveRows`, `applyLiveFields` and `liveFieldsDigest` with effective
   variant columns. Add `packages/menu/src/product-declarations.ts`: `productDeclarationValues`
   shares the existing override-derived diet/validated declarations with `offerLineValues` and live
   hydration; `extraDeclarationValues` shares the existing expanded extra labels with
   `offered-modifiers.ts`. No new diet policy. Collect `BuiltMenu.unreviewed` from pre-freeze
   offers for preview warnings, avoiding another live read.
3. Require a hydrated document at `publicGuestMenu`. Add sibling `hydrateDeclarationDocument`
   in `menu-document.ts`, using the same batched `readLiveRows`; keep till `applyLiveFields` unchanged
   in how it drops absent rows.
   **Preserve guest/paper membership and published names/prices:** if a live product is missing,
   retain its published entry, always overwriting old declarations. Missing-row defaults are
   `null` allergens, no override and `[]` declarations through the shared helper, giving
   `overlayDietProfile(UNDECLARED_DIET, null)`, with one assertion in `menu-document.test.ts`.
   No production path deletes a product row; do not repeat that case in guest API tests.
   No old-label fallback or unrelated omission.
   In `apps/server/src/{guest-menu-api,line-nutrition,working-order}.ts`, hydrate all four producers
   and batch held products/variants/extras even outside offers; never use filtered
   `readLineNutrition` as the full profile. Existing `recordWorkingLineContexts` and set-lunch
   writers keep consuming hydrated offers; held retrieval stops reading copied context nutrition.
   `menu-allergen-workflow.test.ts` owns held outside-offer/null/variant reads;
   `guest-menu-api.test.ts` owns live declarations in Cloud/preview/old-paper/public output;
   `cloud-guest-menu.test.ts` owns body reconciliation without publication. Keep sent capture,
   replay, split, later-extra and missing-capture assertions in `sent-line-nutrition.test.ts`, and
   existing `kitchen-allergy.reads.test.ts`/`kitchen-print.allergy.test.ts` live checks.
4. Remove declaration change fields/labels in dashboard `widgets/menu-preview.ts` and
   `i18n/strings.ts`. Adapt fixtures in shared `menu-document/{guest-menu,customer-menu-presentation}.test.ts`
   and dashboard `widgets/{test-helpers.ts,menu-preview.test.ts,menu-preview-navigation.test.ts,menu-patch-draft.test.ts,menu-patch-dialog.test.ts,menu-patch-dialog.a11y.test.ts}`.
   Preserve unrelated assertions. Update Products/Modifiers guide twins under
   `apps/server/src/guide/{en,es}/` and developer `products.md`/`design-system.md`; describe live
   declarations, not a transition. Keep A1150’s remaining open-view work in `docs/backlog.md`.

## PR 2 — refresh open till views without editing orders

5. Test-first in `apps/till/src/state/menu-refresh.test.ts` (declaration-only replacement),
   `till-app-menu-refresh.test.ts` (same-version counter/table/held/last-added wiring, no saves,
   no price confirmation, stale requests), `menu-filter.test.ts` (all four filters),
   `widgets/{menu-browser.nutrition,modifier-picker.allergens,basket.line-details}.test.ts`
   (open info/choice/details, preserving sent captures). Change
   `apps/till/src/{till-app,state/menu-refresh,state/working-order,widgets/menu-browser,widgets/basket}.ts`.
   Reuse conversion, existing poll/digest and request/dialog guards. Update declarations separately
   from price reconciliation, preserving line identity, selections, clean state and staged prices;
   use display-only `draft-sync.ts` reshow where applicable. No new polling or client conversion.
   Update Table service guide twins; remove completed A1150 backlog entries.

## Verification and limits

Run every changed test file with `pnpm --filter <owning-package> exec vitest run <files>`,
not whole packages. PR 1 also runs its retained server suites above and shared guest renderer;
PR 2 runs its named till files. Both run server `guide-content.test.ts` and root
`scripts/guide-links.test.ts`. After PR 1’s type changes run
`pnpm --filter @waitron/shared --filter @waitron/menu --filter @waitron/dashboard --filter @waitron/server typecheck`;
the normal hook later covers dependents. Review EN/ES, light/dark, phone/desktop displays.

Use current A1308 `menuReleases` fixtures after rebase. Keep format 4, one full-document hash,
all recorded documents and A1517 behavior; no migration, compatibility layer, reset, schema,
protocol or second polling service. Each PR takes initial rebase, two Claude run-it reviews
(cross-package or concurrency trigger), one fresh fixes read, the normal hook and current-head CI before land.
This plan is source inspection, with no runtime verification claimed.

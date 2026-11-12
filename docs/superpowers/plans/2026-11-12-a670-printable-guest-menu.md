# A670: browser-printable guest menu

**PLAN FOR APPROVAL, 12 November 2026.** Design only. The [A1517 owner decisions](../specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11) bring forward [A670](../../backlog/catalogue.md#a670--printed-menus-owner-2026-10-14-open-not-designed); they do not approve these choices. The driver checks and commits this document, obtains one Claude read, then waits for watcher clearance.

## Finish line and fixed requirements

As a manager, you select a menu's published version, preview its guest-facing content and browser-print that same content, including dish, variant and extra declarations and an icon-word key. [October's A668 design](../specs/2026-10-14-a668-allergen-info-editor-and-till-design.md#menus-customers-read) specifies “the same icons after each dish name, and a key on the page naming each icon.” The owner said “unspecified allergens should be warned about before publishing a menu, not on the menu itself” and chose to “delete completely” the till sheet. Preserve these decisions; no new legal-sufficiency claim follows.

## Existing route to reuse

Source inspection, not runtime verification: `apps/dashboard/src/api/client.ts#getLiveMenu` calls authenticated `GET /management-api/catalogues/:id/live` in `apps/server/src/catalogue-api.ts`, backed by `packages/catalogue/src/menu-publication.ts#readLiveMenu`. It returns version identity, number, date and document, or null. `getMenuPublications` lists edition metadata, not historical documents.

`packages/shared/src/menu-document/menu-document-types.ts` defines `MenuDocument`, its ordered section tree and `FrozenOffer`. `packages/catalogue/src/menu-document.ts#freezeOffer` retains declarations; `operations.ts#readOfferVariants` uses effective inherited values through `variant-fallback.ts`. `offered-modifiers.ts` supplies each extra's separate `addAllergens`. Inference: printing those frozen values needs no recipe read or publication change; subsequent recipe edits will not appear until republished.

Reuse customer text resolution in `packages/shared/src/menu-document/customer-menu-presentation.ts`, `apps/dashboard/src/i18n/domain.ts#allergenLabel` for cereal/nut kinds, and `packages/ui/src/nutrition-icons.ts`. Existing dashboard `widgets/menu-preview.ts` previews proposed working content, so it is not the print source. Follow `widgets/equipment-label.ts` for an isolated browser-print frame and `screens/node-recovery-print.ts` for text-safe document construction and print styles, without generalising either into a framework.

## Visible choices for the watcher to take to the owner

Recommendations below remain unresolved:

1. **Version and freshness:** capture the selected menu's current published version, show its number/date in preview, and keep it fixed while open. Do not mix current recipes into it. Example: version 7 says Milk; a later Egg edit remains absent until publication. Does selection need older versions too? That requires another reader and re-estimation.
2. **Variants and extras:** indent each variant with its own effective declaration; list offered extras separately under their dish, including preselected ones. Never union every possibility into the parent. Example: Soup, Creamy: Milk; topping Walnuts: Nuts (Walnuts). Options have no separate allergen field; recommend listing their labels without inventing declarations.
3. **Language:** one enabled English or Spanish content language per print initially, with matching key words and existing customer-name fallback. Example: select Spanish to print Leche; a missing customer name falls back through the existing resolver. Other content languages need translated key words; confirm scope rather than silently mixing languages.
4. **Prices:** show published final dish/variant prices, extra supplements and applicable unit/portion, without recalculation. Example: Soup €6; Large €8; topping +€1 per portion.
5. **Unknown declarations:** October already excludes warnings. Recommend no declaration badge for either null or reviewed-empty, without calling either safe. Example: unchecked Soup and reviewed-empty Water show no icons; confirm whether Water needs an explicit positive “none” label.
6. **Presentation:** plain single-column sections, saved menu title, descriptions, no photos or diet badges, and the icon-word key repeated on each printed page. Example: a two-page Lunch menu retains the key on page two; cereal/nut kinds stay beside their specific item.

## Build boundary, files and checks

Exclude public sites, online menus, PDF generation, till sheets, editors, stored jobs, audit records, compliance frameworks and recipe/publication changes. Routine choices: existing permissions, shared controls/tokens, escaped text, temporary frame cleanup and no new records/controllers. Follow `docs/developers/{conventions-ui,design-system,products,testing-guide,writing-claims}.md`.

Expected files: new dashboard `widgets/guest-menu-print.ts` and `guest-menu-print-dialog.ts`; modify `screens/menus-screen.ts`, `i18n/strings.ts`, and server guides `guide/{en,es}/products.md`. Add sibling renderer/dialog tests, dialog accessibility tests and focused menu-screen integration cases. The future implementer owns failing-first tests: distinct dish/variant/extra declarations, inherited replacement, kinds/key, language/prices/null, escaping, unpublished/read-failure recovery, version retention across publication, and print-frame cleanup. Inspect actual rendering in both themes, phone width and multipage print media. No tests run for this design.

Provisional size: **250–400 production lines; 200–350 test lines**, plus wording/guides. Two proposed slices, each targeting **≤3 hours through PR** including focused checks and review: renderer with behavioral tests; then manager entry, preview/print integration, accessibility and guides. Re-estimate after owner answers, not from the old 3–5-day guess.

**Before implementation:** choices 1–6 need owner answers through the watcher. Build also waits for the driver's Claude read and watcher clearance of the resulting scope. This document authorises no build.

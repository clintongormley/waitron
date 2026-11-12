# A670: browser-printable guest menu

**PLAN FOR APPROVAL, 12 November 2026.** Design only. The [A1517 owner decisions](../specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11) bring forward [A670](../../backlog/catalogue.md#a670--printed-menus-owner-2026-10-14-open-not-designed); they do not approve this proposal. Separate Sol-high author; driver checked; Claude read once (323 seconds, Lane D `receipts/a670-plan-review.md`). Corrections below incorporate that read. Watcher clearance and the two visible choices remain outstanding.

## Finish line and existing route

As a manager, you open the selected menu's current published version from Menus, preview it and browser-print that same document. No historical-version chooser. Capture the version while the preview stays open; identify it by number, without needing a date conversion. Unpublished menus explain that you must publish first.

Source inspection, not runtime verification: dashboard `api/client.ts#getLiveMenu` calls authenticated `GET /management-api/catalogues/:id/live`, backed by `packages/catalogue/src/menu-publication.ts#readLiveMenu`. Its document already freezes dish/variant declarations and each extra's separate `addAllergens` (`menu-document.ts`, `offered-modifiers.ts`, shared `menu-document/menu-types.ts`). Recipe edits appear only after publication. Reuse that reader, not the working-content `widgets/menu-preview.ts`; no server route or recipe read is added.

## Fixed requirements and proposed defaults

[October's A668 decisions](../specs/2026-10-14-a668-allergen-info-editor-and-till-design.md#decisions-owner-2026-10-14) require icons after dish names with a words key, put missing-information warnings before publication, give reviewed-empty declarations no mark and retire the till sheet. Preserve them; no new legal-sufficiency claim follows.

Print ordered sections in one column, nesting their headings; `direct` sections put members in place without a heading. Include descriptions, omit photos/diet badges and use a localized “Menu” heading rather than the untranslated staff menu name. Include published sold-out items: paper is not a live availability screen.

Each dish and indented variant carries its own effective declarations. Extras, including preselected extras, appear separately under the dish with their own declarations; never union alternatives into their parent. Leave options out: they own no declarations and the ask does not name them. Null and reviewed-empty draw no declaration or safety claim.

Use `customer-menu-presentation.ts` for dish text and `product-presentation.ts#customerPresentationText` for each extra's independent parent/variant fallback. Show a dish price only without variants; otherwise show each variant's final published price, following `menuPriceRange`'s existing rule. Extras show their published `price`, portion and unit; no price recalculation.

## Two choices for the watcher to take to the owner

1. **Languages:** recommend English/Spanish initially, one enabled content language per print, with matching allergen words. `dashboard-kit/src/i18n.ts#NameTable` and dashboard `i18n/domain.ts` currently supply those two languages. Catalan/Galician menu names would otherwise mix with English allergen words. Accept English/Spanish for this first cut, or supply additional allergen wording before building? Example: a Catalan venue prints its Spanish customer names and “Leche”.
2. **Words beside each item:** recommend icon plus `allergenLabel(code, entry, printLanguage)` beside every declaration, including cereal/nut kinds; one key at the end names every icon used, via the same codes and `allergenName`. Example: Soup, icon, “Cereals containing gluten (Wheat)”; topping, icon, “Nuts (Walnuts)”. Accept these inline words and one key, or require a repeated page key too? Repeated-key pagination needs a browser experiment before estimating it.

## Build boundary and verification

One usable PR, provisionally **250–400 production lines and 200–350 test lines**, plus guides/wording; re-estimate after answers. Aim for three hours to PR, reporting a smallest usable cut if that proves wrong. New `widgets/guest-menu-print.ts` builds one plain document; a small `guest-menu-print-dialog.ts` displays that same frame and prints it. Follow `equipment-label.ts` for frame lifecycle and `screens/node-recovery-print.ts` for text-safe construction. Draw plain SVG paths from `packages/ui/src/nutrition-icons.ts`; dashboard custom elements are not registered inside the frame.

Modify `screens/menus-screen.ts`, `i18n/strings.ts` and EN/ES `guide/products.md`. Keep `catalogue.manage`: managers already have it (`packages/identity/src/permissions.ts`); no permission expansion is proposed. Renderer tests own distinct/inherited declarations, kinds/key, names/prices, nulls and escaping. Dialog/screen tests own read refusal, unpublished menus, retained version, accessible controls and frame cleanup. Inspect both themes, phone/desktop and multipage print media. Tests start failing first; none run for this design.

Exclude public sites, online menus, PDFs, till sheets, editors, stored jobs, audit records and publication changes. No build until the watcher settles the two choices and clears this scope.

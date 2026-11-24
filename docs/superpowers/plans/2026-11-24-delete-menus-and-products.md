# Permanent deletion for menus and products

[Owner's design](../specs/2026-11-24-delete-menus-and-products-design.md). Two pull requests by screen. Each makes Delete permanent throughout its screens, retains existing refusals and choices, and hides deleted rows from management and exports. Keep retained identities, the active flag, schema and fiscal paths. The separate Set menus page follows both.

## 1. Menus and set menus

- Reuse the deletion transaction in `menu-api.ts`, `packages/menu/src/{archive,operations,sections,menu-publication}.ts` and the venue timetable. Remove and reconcile draft includes and set-menu placements. Preserve Home positions with the existing named missing tile. Keep published dependants' versions and warn about their next publication. The impact counts distinct products in the menu's own sections or the set menu's own dishes.
- Settle due releases, end the live release and cancel future releases with the acting manager in that transaction. Keep by-id recorded versions. In `packages/media/src/images.ts` and its dashboard live queries, hide deleted-menu uses, refresh when a menu is deleted and release its section and folder photos when those photos are separately deleted. Keep the current protections for active drafts and live or scheduled editions. Apply release cleanup when Delete runs.
- Change the two routes, shared menu types, activity and error codes, dashboard API and consumers together. Filter management by-id reads in `menu-api.ts` and `guest-menu-api.ts`, including sections, paper and set-menu reads. Preserve internal `readMenuStructure` for upgrades. Refuse copying deleted menus in `menu-copy.ts`. Return deleted links to the list. Use a menu-specific Delete label, keep Copy on listed rows and start Status on All, with Published and Requiring attention. Exclude deleted set menus from visible counts in `course-delete.ts`.
- Start with failing cases in `menu-api.archive.test.ts`, `menu-structure.test.ts`, `image-references.test.ts` and the upgrade-check suite. Cover full and set menu deletion, hidden reads, refused copy, surviving placements and Home order, due releases and photo protection, with active controls. The Menus and dialog browser suites cover navigation, filters, impact and choices.

## 2. Products, variants and categories

- Reuse `archive.ts`, `operations.ts`, `variants.ts`, `product-editor.ts` and `product-items.ts`. Filter management and direct translation reads. Preserve internal editor-save and variant-restoration checks. Use current product counts in category and course impact and category confirmations. Keep moving all retained products when clearing a category key.
- Update Products, Units, product widgets, dashboard API, media, till and locales. Return deleted links to Products, remove archived browsing and use Delete for saved rows and all bulk selections. Keep Remove for unsaved variants and Keep for staged deletion. Rename remaining lifecycle files, routes, codes, activity and alerts.
- In `units.ts` and `images.ts`, show current uses and release deleted references on separate unit or photo deletion. Keep stale unit-move refusals and active-use protections. Stored orders and sales have unit snapshots (`schema/orders.ts`, `schema/sales.ts`). The unsent draft count in `order-state-counts.ts` reads the current unit. When an inactive product loses its unit, read its recorded offer in one batch via `readRecordedDocuments`, including `document.setMenus[setMenuId].offers[menuItemId]`. Keep the existing default for drafts without a version.
- Start with failing cases in `archive.db.test.ts`, `units.db.test.ts`, `image-references.test.ts`, `order-state-counts.test.ts` and `menu-api.test.ts`. Check editor save, hidden reads, retained order facts, the measured draft count and separate resource deletion. Test deleting menu, product and photo in that order, and a live-use refusal. Dashboard suites cover navigation, bulk and staged actions.

## Both pull requests

Use `leaveBehindWhenFalse: "active"` in `packages/db/src/configuration-transfer.ts`. Round-trip deleted and live controls in `configuration-transfer.test.ts`, including dependent rows, the missing Home slot and existing course and routing assertions. Run changed-file suites, code guards and full cross-package review. Update both language guides, design system, developer products, categories and transfer docs, and backlog.

Have the owner approve the captures before each merge. Show menu and set-menu windows and Menus filters first, then product, variant and category windows and Products filters. Capture both widths, themes and languages.

Estimated changed lines are about 520 product and 600 test for slice 1, and 725 product and 875 test for slice 2, counting additions and removals.

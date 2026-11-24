# Permanent deletion for menus and products

[Owner's design](../specs/2026-11-24-delete-menus-and-products-design.md). Two pull requests by screen. Each makes Delete permanent throughout its screens, retains existing refusals and choices, and hides deleted rows from management and exports. Keep retained identities, the active flag, schema and fiscal paths. The separate Set menus page follows both.

## 1. Menus and set menus

- Managers can permanently delete either kind of menu. Keep the period and default choices and warn about published menus that include it. Count distinct products in its own sections or its own set-menu dishes. Remove its placements from other working menus and keep their Home positions with the existing named missing tile. Keep published dependants’ versions.
- Reuse the transaction in `menu-api.ts`, the venue timetable and `packages/menu/src/{archive,operations,sections,menu-publication}.ts`. Settle due editions, end the live edition, and cancel future editions with the acting manager. Keep recorded editions. Clear `image` on the menu’s own sections and `folderImage` on their members in the same transaction. Earlier archives need a test-venue reset.
- Update shared types, routes, activity and errors, the dashboard client, locales and the existing dialog. Hide deleted rows in `listMenus`, remove the `readSetMenu` inactive override, and refuse copying a deleted menu in `menu-copy.ts`. The existing list check sends deleted links back to Menus. Drop the read-only view, inactive include logic and Archived filter. Start Status on All, with Published and Requiring attention. Count only current set menus in `course-delete.ts`. The shared deleted-menu refusal also has to read naturally on Products.
- Menu package tests own deletion, published and scheduled editions, photos and Home. Server tests own permissions and route responses. Dashboard tests own the window, navigation and filters. Products and variants keep their existing management actions until slice 2.

## 2. Products, variants and categories

- Managers can permanently delete saved products and variants, including products selected with categories. An unsaved variant still says Remove. Drop Show archived and its details panel. Filter the product and translation lists. Keep internal save checks, category-key moves and the existing unit and photo refusals for current products.
- Reuse `archive.ts`, `operations.ts`, `variants.ts`, `product-editor.ts` and `product-items.ts`. Trace stored order lines, kitchen papers, reports, refunds, reprints and past invoices before clearing product `image` in `markInactive`. Keep the product’s unit link until Unit Delete and leave the draft badge lookup alone. Record in the PR that the badge can overcount an unsent measured dish once its unit has been deleted separately.
- Update the dashboard client, Products, Units, widgets, till, errors, activities and translations. Count current products in category and course impact. Test separate unit and photo removal once per resource, with live-use controls. Test saved and unsaved choices and bulk Delete in the browser.

## Both slices

Use `leaveBehindWhenFalse: "active"` in `packages/db/src/configuration-transfer.ts` for the rows each slice deletes. The configuration transfer suite owns the round trip and dependent rows. Keep the existing course and routing assertions. Update both language guides, design system and the affected developer and backlog entries. Capture each slice’s approved windows and filters at desktop and phone widths, in both languages and themes. Get the owner’s recorded answer before each merge.

Slice 1 estimate is 520 product and 600 test lines, counting additions and removals. Slice 2 previously estimated 725 product and 875 test lines. Re-estimate after the watcher’s cuts before starting it. Above 1,500 changed lines, put pure code renames in a third PR. The watcher cleared these edits on 24 November at 16:49 after Claude’s review and final read.

**Review decision, 24 November at 21:19:** Keep a deleted product’s unit link for open draft counts.
Unit Delete clears the retained links once no current product uses it. The photo still comes off at
product deletion. The watcher cleared this small change after the 150 g draft check.

# Menu Structure save request implementation plan

[Menu editor design, section 4 and delivery 2(b)](../specs/2026-11-24-menu-editor-redesign-design.md#4-one-save-for-everything-on-the-tab)

A menu manager can save an ordinary menu’s whole working arrangement and prices in one request. A refusal rolls everything back. The last successful Save wins. The dashboard first uses the request in 2(d), after the variant-price change in 2(a). Set-menu editing, publishing and removal of old requests have their own pieces.

## Request and answer

Add `MenuStructureSaveInput` and `MenuStructureSaveResult` in `packages/shared/src/menu-document/menu-structure-save-types.ts`, exported from `packages/shared/src/index.ts`.

- `PUT /management-api/menus/:id/structure` takes `{ rootMembers, sections, prices }`. Each owned section has `id`, `internalName`, `names`, `image`, `color` and `members`. Each ordered member has `id`, existing `MemberRef` and the complete `IncludeFolder` for an ordinary include. An include names its root and a set menu uses `set_menu`. Use the read IDs for retained rows and assign UUIDs to new rows.
- Each price is `{ productId, variantId?, price }`, one decimal-string override per key, including dishes reached through includes. Omission clears the override.
- Return `200 { dropped }` with `x-waitron-menu-revision`. A member drop has `{ memberId, reason: "deleted" }`. A price drop has `{ productId, variantId?, reason }`, with `"deleted"`, `"has_variants"` or `"unreachable"`. For a row refusal return the existing error code and `params.field` pointing into the body, for example `rootMembers.1.ref`, `sections.2.members.0.folder.names` or `prices.3.price`. The dashboard uses its draft for names and the existing reads for refresh. Confirm this contract with Lane D before building.

## Build and prove

1. Start with failing database cases in `packages/menu/src/menu-structure-save.test.ts` using the migrated venue fixture. Cover same-product members swapping lists, retained section and offer IDs, a kept child of a removed parent, a missing Home shortcut, includer offer sync, and this menu’s prices versus the included source’s. Check stale saves, deleted refs and variant prices, a product gaining variants, and an override no longer reached.
2. Implement `saveMenuStructure(tx, menuId, input, venueLocale)` in `packages/menu/src/menu-structure-save.ts` and export it from `packages/menu/src/index.ts`. Require an active ordinary menu. Load the original graph. Drop inactive product, variant and menu refs before checking reachability. Refuse unknown refs, a variant placed as a member, another menu’s section or member ID, Home IDs, repeated IDs and folders on other refs. Each submitted section has one parent and is reachable from the root. Use `refKey` within each list and `wouldCreateCycle` against include roots. Reuse `sectionPatchValues` and `checkedOverrides`, merging retained names as today. A recreated include without stored names follows the existing new-folder validation for disabled languages.
3. In the same transaction, reuse `keepMissingTile` for omitted sections. Replace members only in the root and owned sections, preserving submitted IDs, delete exactly omitted sections, and upsert submitted sections before inserting members. Call `onStructureChanged` once with the original graph and `menusContaining(before, root)`. Apply prices afterwards to this menu’s final offers, using `isProductPrice`, variant price validation and cent conversion. Refuse duplicate keys and variants of another product.
4. Mount `apps/server/src/menu-structure-save-route.ts` from `menu-api.ts`. Pass its existing gated transaction and a route-specific boundary with 404 for the addressed menu and 400 for invalid body references. Add `apps/server/src/menu-api.structure-save.test.ts` for revision, notice, permission, invalid target and rollback with a row-specific refusal. Run both new test files and affected menu suites. Update `docs/backlog/menu.md`’s redesign pointer.

Estimate 450 added production and 310 added test lines. Expect a branch with no venue reset. Run the full branch review for the menu-to-server contract.

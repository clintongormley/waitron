# Menu Structure save request implementation plan

[Menu editor design, section 4 and delivery 2(b)](../specs/2026-11-24-menu-editor-redesign-design.md#4-one-save-for-everything-on-the-tab)

A menu manager can submit the whole working arrangement and its own prices in one request. A refusal leaves the old arrangement and prices intact. The last successful Save wins. The request serves ordinary menus. The dashboard, old mutation routes, publication, set-menu editing and the wider variant-price change in 2(a) have their own pieces.

## Request and answer

`PUT /management-api/menus/:id/structure` uses the existing Menu permission and transaction in `menu-api.ts`. Add the body and result types in `packages/shared/src/menu-document/menu-structure-save-types.ts`, with type exports in `packages/shared/src/index.ts`.

- `MenuStructureSaveInput` contains ordered `rootMembers`, `sections` and `prices`. Each section has `id`, `internalName`, `names`, `image`, `color` and ordered `members`. Each member has `id`, existing `MemberRef` and `folder` only for an ordinary menu include (the complete `IncludeFolder`). The dashboard keeps read IDs and assigns a UUID to each new section and member. Send an include's root ref and settings, or a set menu's existing `set_menu` ref. Their contents come from the box.
- Each price is `{ productId, variantId?, price }`, with one decimal-string override per key. Omission clears that override. A product reached through an include can have its own override on this menu.
- `MenuStructureSaveResult` is `200 { dropped }`. A member drop returns `{ memberId, ref, reason: "deleted" }`. A price drop returns `{ productId, variantId?, reason }` with `"deleted"`, `"has_variants"` or `"unreachable"`. The editor has the draft names and refreshes through the existing reads. Reuse the existing refusal codes, with the row or input field identified where available.

## Build and prove

1. In `packages/menu/src/menu-structure-save.test.ts`, use the migrated venue fixture. Start with a failing save that exchanges product placements between sections, retains member, section and offer IDs, sets an included dish's price here, and preserves its source price. Add cases for stale deleted refs and prices, a product gaining variants, and a dropped include that made a price unreachable. Check a removed section's Home shortcut keeps its missing name and the last save replaces intervening changes.
2. Add `saveMenuStructure(tx, menuId, input, venueLocale)` in `packages/menu/src/menu-structure-save.ts`, exported by `packages/menu/src/index.ts`. Compare current rows and the draft inside the transaction. Reuse section/ref, cycle and folder checks from `sections.ts`, `section-members.ts`, `section-graph.ts` and `include-folder.ts`. Check duplicates, cycles and ownership against the final arrangement. Update retained sections in place and reuse the missing-shortcut handling on removed sections. Stage moved members out before reinserting under their IDs so exchanges satisfy the unique indexes. Run `onStructureChanged` once over the final arrangement and its includers so a move keeps its offer. Set or clear this menu's prices from final reachability and active variants, using existing price validation and cent conversion. Leave schema and published copies alone.
3. In `apps/server/src/menu-api.structure-save.test.ts`, mount the real route with the menu API fixture. Assert the success notice, denial without Menu permission, and rollback on a cycle or duplicate after proposing valid changes. In `apps/server/src/menu-structure-save-route.ts`, validate the request shape, mount through the existing boundary and gated write, and return the result. Run both new files and the existing touched menu API and structure suites. Update the menu backlog pointer as part of the feature branch.

Estimate 410 added production lines and 245 added test lines. The save request changes neither the schema nor the installed venue data format. Run the full branch review for the menu-to-server contract.

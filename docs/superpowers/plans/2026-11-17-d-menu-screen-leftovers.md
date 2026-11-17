# Menu screen leftovers — implementation plan

**Finish line:** One PR: Add to menus reads all structures once; Price overrides offers only reached categories and their ancestors; variant rows announce their parent. Use this worktree's existing base. FOLDER-ROUTING-PREVIEW is independent and excluded. Separate Sol-high author and driver check; one Claude read (351 seconds), corrections checked; watcher clearance pending; no owner design approval is claimed.

**Request:** Lane D `queue.md`, MENU-SCREEN-LEFTOVERS, watcher 2026-11-17, verbatim:

> docs/backlog/menu.md:202 (#664): "Opening 'Add to menus' sends one `getMenuStructure` request per menu… one server read returning every menu's structure would make it one" (apps/dashboard/src/screens/products-screen.ts:491). And docs/backlog/menu.md:209 (#670, #680): the Price overrides tab's "main-category filter offers every category, not only those on the menu" (apps/dashboard/src/widgets/menu-prices-table.ts:1032), with the variant-row announcement named there if it fits. Delete both bullets when done.

**Files and interfaces**

- `packages/menu/src/menu-structure.ts`, `packages/menu/src/index.ts`: extract the existing result shape as `MenuStructure`; export `readMenuStructures(tx: Transaction): Promise<{menu: Menu; structure: MenuStructure}[]>` alongside the unchanged single-menu interface.
- `apps/server/src/menu-api.ts`: GET `/management-api/menus/structures`, using the existing `gated` session/`menu.manage` check and transaction.
- `apps/dashboard/src/api/client.ts`: `getMenuStructures(): Promise<{menu: MenuSummary; structure: MenuStructure}[]>`.
- `apps/dashboard/src/api/live-queries.ts`, `apps/dashboard/src/screens/products-screen.ts`: register and watch that aggregate query.
- `apps/dashboard/src/widgets/menu-prices-table.ts`: restrict options and add accessible parent text.
- `apps/dashboard/src/api/query-controller.ts`, sibling test and `docs/developers/dashboard-live-updates.md`: remove watchGroup after its sole production caller moves to the aggregate read.

**Build inline, with red/green checks**

- [ ] Aggregate read. Reuse `listMenus` ordering and inclusion of inactive menus, load `loadSectionGraph` once, and index its roots; compute direct includes once per root and invert them for includedBy. Extract a private structure builder shared with `readMenuStructure`; preserve nodes, include-folder presentation, `includable` and direct `includedBy`. Never loop over the database-backed single-menu reader. Await transaction reads sequentially. Return `[]` for no menus and normal roots with empty nodes for empty menus; retain `menu.not_found` for a listed menu missing its root.
- [ ] Placement. Replace `watchGroup` with one `watch("getMenuStructures", [], …)` and matching release. Derive both arrays for existing `placementMenus` from the same response, avoiding stale screen-menu alignment. Preserve the single create-follow-up path, selections, close/reopen handling and load recovery; a category-row create reaches that same path. Subscribe to `menus`, `sections`, `section_members`; retain passive refreshes and quiet-while-connected policy. Ownership is already declared by core/menu change sources (`packages/db/src/classification.ts`, `packages/menu/src/classification.ts`), installed through composition/boot; no source changes are expected.
- [ ] Prices. Build offered category IDs from `rows` through existing `#categoryChains`, then retain their existing full-path labels. Keep ancestor matching, sorting, multi-selection and the table's reset/wait contract, including empty rows. Opening a menu without the chosen category drops it from the shared saved view, like section filters; an empty option list keeps waiting. Add hidden parent staff text before the visible variant in the existing name cell, following `devices-screen.ts:335–336,1747` (`part="visually-hidden"` and shared `visuallyHiddenStyles`); style through `part`/`::part`, without changing table structure or search behaviour.

**Tests by owner**

- `packages/menu/src/menu-structure.test.ts`: reuse `useMenuDb`/included-menu fixtures; compare each aggregate entry with the existing single-menu answer (whose literal assertions stay), covering included/inactive/empty menus and no menus; a call-through spy checks one graph load.
- `apps/server/src/menu-api.test.ts`: route answer plus missing-session/insufficient-permission refusals; domain tests own traversal.
- `apps/dashboard/src/api/client.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`: URL/credentials, dependencies, the audited quiet-while-connected list and passive subsequent reads.
- `apps/dashboard/src/screens/products-screen.test.ts`: replace per-menu expectations with one aggregate call, rendered entries for the create follow-up once; retain the existing live recovery assertions, without another picker live-update test. Adapt existing stubs here, `screens/products-screen.a11y.test.ts`, `widgets/product-editor.unsaved.test.ts`, and `screens/{unit-owners,modifier-owners}.unsaved.test.ts`; grep other create/structure fixtures.
- `apps/dashboard/src/widgets/menu-prices-table.test.ts`: exclude unrelated categories, retain ancestor matches, and verify cross-menu category reset and empty-list waiting. Give the existing Spanish searchable-list fixture reached rows. `apps/dashboard/src/widgets/menu-prices-table.a11y.test.ts`: assert parent-plus-variant through the native accessible row/cell name, not `searchValue`; retain both-theme axe checks.

For each change, run its new assertion red before implementation, then green with the corresponding command below. Run every changed test file before handoff:

```sh
pnpm --filter @waitron/menu exec vitest run src/menu-structure.test.ts
pnpm --filter @waitron/server exec vitest run src/menu-api.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/api/live-queries.test.ts src/screens/products-screen.test.ts src/screens/products-screen.a11y.test.ts src/widgets/menu-prices-table.test.ts src/widgets/menu-prices-table.a11y.test.ts src/widgets/product-editor.unsaved.test.ts src/screens/unit-owners.unsaved.test.ts src/screens/modifier-owners.unsaved.test.ts src/api/query-controller.test.ts
pnpm exec vitest run scripts/live-subscriptions.test.ts
```

Inspect changed UI in EN/ES, light/dark, phone/desktop as RUNNER requires, specifically phone overflow from hidden parent text; no extra layout expansion. Guide edits only if instructions change; none are expected. No benchmark claim.

**Bounds and cleanup:** Expected additions/removals: production +150/−75, tests +190/−70, support +0/−0, docs +85/−15 (this plan and `docs/backlog/menu.md`): 585 changed lines; above 878, stop for the watcher's outside opinion. Reuse fixture support; no framework, records, revisions or helper fakes. **Driver flag:** remove only delivered clauses from both backlog bullets; preserve section-address/refusal gaps, editor-help/Columns gaps and the 2026-09-26 owner decision. Deleting whole bullets would lose unrelated work.

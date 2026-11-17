# Menu screen leftovers — implementation plan

**Finish line:** One PR: Add to menus reads all structures once; Price overrides offers only reached categories and their ancestors; variant rows announce their parent. Use this worktree's existing base. FOLDER-ROUTING-PREVIEW is independent and excluded. Driver checks, Claude reviews, then watcher clears before implementation; no owner design approval is claimed.

**Request:** Lane D `queue.md`, MENU-SCREEN-LEFTOVERS, watcher 2026-11-17, verbatim:

> docs/backlog/menu.md:202 (#664): "Opening 'Add to menus' sends one `getMenuStructure` request per menu… one server read returning every menu's structure would make it one" (apps/dashboard/src/screens/products-screen.ts:491). And docs/backlog/menu.md:209 (#670, #680): the Price overrides tab's "main-category filter offers every category, not only those on the menu" (apps/dashboard/src/widgets/menu-prices-table.ts:1032), with the variant-row announcement named there if it fits. Delete both bullets when done.

**Files and interfaces**

- `packages/menu/src/menu-structure.ts`, `packages/menu/src/index.ts`: extract the existing result shape as `MenuStructure`; export `readMenuStructures(tx: Transaction): Promise<{menu: Menu; structure: MenuStructure}[]>` alongside the unchanged single-menu interface.
- `apps/server/src/menu-api.ts`: GET `/management-api/menus/structures`, using the existing `gated` session/`menu.manage` check and transaction.
- `apps/dashboard/src/api/client.ts`: `getMenuStructures(): Promise<{menu: MenuSummary; structure: MenuStructure}[]>`.
- `apps/dashboard/src/api/live-queries.ts`, `apps/dashboard/src/screens/products-screen.ts`: register and watch that aggregate query.
- `apps/dashboard/src/widgets/menu-prices-table.ts`: restrict options and add accessible parent text.

**Build inline, with red/green checks**

- [ ] Aggregate read. Reuse `listMenus` ordering and inclusion of inactive menus, load `loadSectionGraph` once, and index its roots. Extract a private structure builder shared with `readMenuStructure`; preserve nodes, include-folder presentation, `includable` and direct `includedBy`. Never loop over the database-backed single-menu reader. Await transaction reads sequentially. Return `[]` for no menus and normal roots with empty nodes for empty menus; retain `menu.not_found` for a listed menu missing its root.
- [ ] Placement. Replace `watchGroup` with one `watch("getMenuStructures", [], …)` and matching release. Derive both arrays for existing `placementMenus` from the same response, avoiding stale screen-menu alignment. Preserve create-follow-up and row-action entry points, selections, close/reopen handling and load recovery. Subscribe to `menus`, `sections`, `section_members`; retain passive refreshes and quiet-while-connected policy. Ownership is already declared by core/menu change sources (`packages/db/src/classification.ts`, `packages/menu/src/classification.ts`), installed through composition/boot; no source changes are expected.
- [ ] Prices. Build offered category IDs from `rows` through existing `#categoryChains`, then retain their existing full-path labels. Keep ancestor matching, sorting, multi-selection and the table's reset/wait contract, including empty rows. Add hidden parent staff text before the visible variant in the existing name cell, following `top-sellers-table.ts`; style through `part`/`::part`, without changing table structure or search behaviour.

**Tests by owner**

- `packages/menu/src/menu-structure.test.ts`: reuse `useMenuDb`/included-menu fixtures; assert aggregate contents for included, inactive and empty menus, no menus, and one real graph load with a call-through spy, as in `menu-publication.test.ts`.
- `apps/server/src/menu-api.test.ts`: route answer plus missing-session/insufficient-permission refusals; domain tests own traversal.
- `apps/dashboard/src/api/client.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`: URL/credentials, dependencies and passive subsequent reads.
- `apps/dashboard/src/screens/products-screen.test.ts`: replace per-menu expectations with one aggregate call, rendered entries for both entry points, and live invalidation updating an open picker without losing choices; retain recovery assertions. Adapt existing stubs here and in `apps/dashboard/src/screens/products-screen.a11y.test.ts`.
- `apps/dashboard/src/widgets/menu-prices-table.test.ts`: exclude unrelated categories, retain ancestor matches, and verify selection retention/reset after row replacement. Give the existing Spanish searchable-list fixture reached rows. `apps/dashboard/src/widgets/menu-prices-table.a11y.test.ts`: assert parent-plus-variant through the native accessible row/cell name, not `searchValue`; retain both-theme axe checks.

For each change, run its new assertion red before implementation, then green with the corresponding command below. Run every changed test file before handoff:

```sh
pnpm --filter @waitron/menu exec vitest run src/menu-structure.test.ts
pnpm --filter @waitron/server exec vitest run src/menu-api.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/api/live-queries.test.ts src/screens/products-screen.test.ts src/screens/products-screen.a11y.test.ts src/widgets/menu-prices-table.test.ts src/widgets/menu-prices-table.a11y.test.ts
pnpm exec vitest run scripts/live-subscriptions.test.ts
```

Inspect changed UI in EN/ES, light/dark, phone/desktop. Guide edits only if instructions change; none are expected. No benchmark claim.

**Bounds and cleanup:** Expected additions/removals: production +150/−55, tests +210/−60, support +0/−0, docs +85/−10 (this plan and `docs/backlog/menu.md`): 570 changed lines; above 855, stop for the watcher's outside opinion. Reuse fixture support; no framework, records, revisions or helper fakes. **Driver flag:** remove only delivered clauses from both backlog bullets; preserve section-address/refusal gaps, editor-help/Columns gaps and the 2026-09-26 owner decision. Deleting whole bullets would lose unrelated work.

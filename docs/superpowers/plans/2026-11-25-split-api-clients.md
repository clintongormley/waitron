# Split the Dashboard and Till API clients

Each client is one class today. Move calls and types by area so developers can find them in files
under 1,000 lines. Keep construction and `api.method(...)` at current call sites. Lane E's watcher
agreed to area classes, the constructor edits and the route inventory change on 25 November at
17:26 and cleared this plan with five edits at 17:39. Dashboard comes first.

| PR | Destination groups under `src/api/` | Broad groups that need a second cut |
| --- | --- | --- |
| Dashboard | Menu, catalog, translations, account and sign-in, staff and roster, venue and floor, devices, printing, reporting and purchases, payments and orders, email and theme | Backup and recovery apart from cloud and servers. Their starting span is about 1,145 lines before imports. |
| Till | Menu and catalog, kitchen and pass, device and session, floor and parties, department transfers, attendance, payments and drawer, invoice delivery | Orders apart from drafts and find-bill. The combined area starts at over 1,100 lines. |

Measure modules with imports. Split Menu reads from editing if needed. `client.ts` remains the
real client. Dashboard keeps background, fresh-sign-in and locale state with its callers. Till
keeps person-header, live events and whole-bill state with their callers. `#todayChange` moves
with its callers. Keep existing package re-exports and point moved local types at their new homes.
Keep Dashboard's `taxOfficeMonthFileUrl` and `approveBoxJoin` in `client.ts`. Put `placeSetMenu`
with `addSectionMember`. Record measured lines and file names in the lane log before the move.

1. Give each area class a private `#request` holding the shared callback. Chain area classes in
   dependency order. The real client inherits the last class. Start its constructor with
   `super(<T,>(...args: Parameters<DashboardRequest>) => this.#request<T>(...args))`, or the same
   with `TillRequest` matching Till's full private signature, including signal and person options.
   Base constructors only store the callback. Keep a group together if its methods call each other.
2. Add the class lift to `scripts/move-ts-declarations.mjs` and one map per PR under `scripts/`,
   `dashboard-client-split.json` and `till-client-split.json`. Start with failing mover tests for an
   edited member, inline type imports and unmapped methods. Compare method bodies and signatures
   before and after formatting, and compare type tokens. Only the two client constructors change.
   Refuse runtime and type-only import cycles. Allow the type-only DashboardApi reference in
   `copyDeviceProfile`.
   Stage new files before the file-size guard. Remove each cap when its client fits the default.
3. Run changed API suites, both app typechecks, `handover-browser.e2e.test.ts` for Dashboard, and
   the file-size, mover and A4 guards. Keep both `client.test.ts` files whole. Repoint A4 paths without touching its assertions. Leave
   Till's person-fetch anchors and checks in place. Walk Dashboard's prototypes in its route
   inventory and keep its assertion. Plant an inherited `listTills` in a disposable copy and
   show the assertion fails. Update live backlog and developer-doc references in the same PR.
4. Arrange a quiet landing window for each app. Notify the watcher about 30 minutes before
   Dashboard is ready to land. Before opening each PR, replay the full map in
   installed disposable base and affected-branch trees. Set `split` to the split candidate commit
   and `app` to `dashboard` or `till`. Use Lane A's active allergens branch for the full Dashboard replay.
   Set `before=$(git merge-base origin/main "$split")` and omit the recipe's working-order `jq` line.
   Copy the new mover and map into both trees. Add new branch names to the branch map and drop
   removed names. The rebased map omits `RecoveryPackKeyState` after #4335. Run the mover from
   each tree. Compare the moved trees, verify the branch edits, typecheck and run focused tests. Include the
   commands and affected open branches in the PR. Land after current-head CI and retire each
   map with the mover once lanes finish replaying. [Replay setup](2026-11-24-working-order-file-split.md#carry-an-open-branch-across-the-split).

   ```sh
   for side in base branch; do
     git show "$split:scripts/move-ts-declarations.mjs" > "$scratch/$side/scripts/move-ts-declarations.mjs"
     git show "$split:scripts/$app-client-split.json" > "$scratch/$side.json"
   done
   ```

**Size.** About 5,500 Dashboard and 5,000 Till lines move. At most about 440 Dashboard and 490
Till importer files may need rewrites, with roughly 900–1,500 changed import lines per app.
Budget 200–350 new mover lines shared by both and 80–150 test lines. Retained class-member
spans before imports and grouping were 164 Dashboard and 524 Till lines.

**Planning probes.** Open PR #4334 kept its widget edit across a seven-type move. Dashboard
typecheck and 166 API cases passed. A separate typechecked pilot carried both recovery-pack
methods byte for byte from open PR #4335 (`e8753a54c9`). The PR's moved code accepted the stub
reply without the retired header, which the moved base (`b0a78c72e6`) refused. Full-map replay
uses the reviewed mover during implementation.

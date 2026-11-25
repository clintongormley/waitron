# Split the Server till API

Find each till route by job in one PR. `till-api.ts` keeps the mount. All pieces fit 1,000 lines. Expect roughly 4,300 product lines and 2,000 aggregate test lines to move, plus 400–600 product import and mount lines, 150–250 mover and map lines and 80–120 test and probe lines. Preserve boot, bill payments and route behaviour. Lane H's 24 November queue and 18:39 watcher note define this slice. Keep callbacks and helpers whole.

| File in `apps/server/src/` | Inclusive source lines at `2541ad4112` and route boundaries (`/api` omitted) | Extra mount arguments |
| --- | --- | --- |
| `till-session-routes.ts` | 1408–1573 · POST `/session` → GET `/locales` | PIN |
| `till-menu-routes.ts` | 1575–1863 · GET `/default-service-zone/offers` → POST `/dead-ends/sale` | |
| `till-working-order-routes.ts` | 1865–2284 · POST `/working-orders` → POST `/working-orders/:id/place` | PIN, fiscal, email |
| `till-kitchen-counter-routes.ts` | 2286–2409 · GET `/stations` → POST `/orders/:id/reprint` (preparation through collection) | |
| `till-sale-receipt-routes.ts` | 2411–2745 · GET `/sales/:id` → POST `/sales/:id/reprint` | email |
| `till-drawer-and-cancel-routes.ts` | 2747–2871 · GET `/drawer/authorizers` → POST `/working-orders/:id/split-after-print` (drawer and order overrides) | PIN |
| `till-table-routes.ts` | 2873–3318 · GET `/tables/state` → GET `/parties/:id/bills` | PIN, floor, fiscal |
| `till-set-menu-routes.ts` | 3320–3397 · GET `/bills/:id/set-menus` → DELETE `/bills/:id/set-menu-lines/:lineId` | |
| `till-group-routes.ts` | 3399–3735 · GET `/parties/:id/groups` → POST `/parties/:id/groups/move` | PIN |
| `till-draft-routes.ts` | 3737–4076 · GET `/parties/:id/drafts` → POST `/dead-ends/order` | PIN, fiscal |
| `till-order-line-routes.ts` | 4078–4311 · PUT `/working-orders/:id/make-at` → POST `/working-orders/:id/lines/send` | PIN, fiscal |
| `till-bill-move-routes.ts` | 4313–4502 · POST `/bills/:id/set-menu-moves` → POST `/bills/:id/move` | fiscal |

1. Pass one `app, deps, log` and share `pinThrottle`, `catchUpFloor`, `fiscal` (`TillSaleDeps`) and `readEmailTransport` as listed. Lift the email closure intact before the first group that uses it. Keep `changeSetMenus` and receipt helpers local. Register `mountBillReady` after expo. Keep `madeHereAnswer`, optional clock and attendance conditions, mounts at 1387–1406 and the final disk gate and its open set in order.
2. Add `scripts/till-api-split.json` and a lift step in `scripts/move-ts-declarations.mjs`. Use first and last method/path anchors. Copy raw statements and comments into typed mount functions at the same indentation. Compare spans before and after TypeScript rewrites imports and formatting runs. Check the remaining mount against the original with the named calls and email move substituted. Start with `scripts/move-ts-declarations.test.mjs` cases for lifting, bad anchors, a changed body and a wrong throttle argument. Retire the map and lift with the mover.
3. Move `TillApiDeps` to `till-api-deps.ts`, the error boundary and statuses to `till-api-errors.ts`, request fields to `till-request-fields.ts`, and zone and reader helpers to `till-order-zones.ts` and `till-card-collector.ts`. Put `stationMoveRequest`, `groupCommand` and its caller `allergyCommand` in `till-order-commands.ts`. Keep `requireMerge`, `JoinMerge` and `requireOtherTables` in the table routes and `requireSetMenuMoves` in the bill move routes. Import definitions directly, retain error registration, check for runtime cycles through new files and type-only cycles wholly among them, repoint live references and drop the old cap. In `packages/fiscal-verifactu/declarations/functions.md` change only the source paths for the seat and working-order routes.
4. Run the same temporary route probe in both Server trees via `node --import tsx`, with `Parameters<typeof mountTillApi>[1]` for the dependencies. Diff indexed `root.routes` rows. Cross disk and box clock on/off with workforce off, clock only and attendance. Keep `ALL /api/*` and duplicates. Label gates by `storage.disk_full_stop_refused` in the handler. With all options on, swapping expo and ready differs at row 262. Swapping the working-order POST gate and handler differs at row 61. Record the output in the PR.
5. The planning probe lifted PR #4101's 3,256-byte sign-in registration unchanged. Its 3,269-byte parent differed. Lane E's `1e9dc5375d` address lookup mount patch applies cleanly to the base (`git apply --check`). Rehearse the complete mover after clearance on the then-current Lane E tip. Preserve the added mount call and dependency field. Use an edited callback in the mover test as a second control beside #4101. In the PR name #4280 and #4275, whose status lines move by hand, and Lane E's mount and dependency field. Use the [replay recipe](2026-11-24-working-order-file-split.md#carry-an-open-branch-across-the-split) with `till-api-split.json`. Keep `till-api.ts` in the patch. Copy the new mover into both trees, then run it there and send affected lanes the command.

   ```sh
   git show "${split}:scripts/move-ts-declarations.mjs" > "$scratch/base/scripts/move-ts-declarations.mjs"
   cp "$scratch/base/scripts/move-ts-declarations.mjs" "$scratch/branch/scripts/move-ts-declarations.mjs"
   ```

   Run `node scripts/move-ts-declarations.mjs scripts/till-api-split.json` from each scratch root. Use the delta between the two raw outputs. For a standalone typecheck of a raw output, change `readBillSetMenus` in `till-set-menu-routes.ts` to a value import. The delivered files have that correction and each throwing file's error-registry import.

   The replay on Lane E's `5d5b0ce80c8bf707229b8e966a6ff9522472a950` kept its 220-byte mount call and moved its optional dependency. All 12 route group files matched the move on the base. The second reviewer replayed Lane B's regroup edit into `till-working-order-routes.ts`.

6. Move the chosen-device sessions, login/logout, PIN throttle, locale, roster and boot, device/profile admission, reader payments, malformed zone, sale policy and settling edit blocks from `till-api.test.ts`, sharing fixtures under `testing/`. Retarget live doc and profile-action pointers when their cited cases move. Update `apps/server/test-durations.json`. Keep the cited `requireSession` block and grandfathered English-guard text in place. Retarget the sign-out scan in `till-api.session-person.test.ts`. Preserve assertions. Run changed suites plus `till-api`'s `profile-actions`, `profile-zones`, `disk-full-gate`, `till-box-clock-api`, `till-clock.disk-full` and `attendance-till-api`. Run unchanged Fiscal `write-path.e2e` and `inmutabilidad`, Server `till-api.sell-published` and Till `till-app-menu-refresh`. Run Server typecheck and affected root guards. Require current-head Server CI.

# A1517-6: declarations recorded when sent

**Request:** “Capture the chosen product's effective current declaration at sending for sent-order/history displays while preserving variant inheritance and leaving kitchen screens, paper and guest-clash checks live. No fiscal or invoice change is authorised.” Lane F `queue.md`, A1517-6; [owner's product decisions](../specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11). Lane I `questions.md`, watcher 2026-11-11 22:01, quotes “As recommended”. This does not approve this plan. A separate Sol-high invocation authored the draft; Claude's 491-second read rejected its timing/storage approach. The watcher cleared the corrections on 2026-11-12 06:21 and the two sizes on 06:28. Source checks only; nothing implemented or runtime-qualified.

**Finish line:** Sent dishes retain their chosen product's allergens and dietary declarations after edits, in the till and Orders history detail. Held dishes remain live until their first `sent_at`. Kitchen screens, paper and guest-clash checks stay live.

## Shared approach

Reuse existing order contexts, `effectiveProductColumns`/`parentJoin`, and the two first-`sent_at` writes, `working-order.ts:2259,6954`. Add nullable JSON `sentNutrition` on `working_line_contexts`: `{ allergens: AllergenMap | null, dietaryDeclarations: string[] }`. Null snapshot means not recorded; null allergens mean unreviewed, while `{}` means reviewed empty. Preserve existing `allergens`/`diet` meanings and all profile readers. No backfill or published/live replacement for missing history.

Capture only ids returned by the first-send updates, including extras. Batch the effective-current product reads; retain variant inheritance and each extra's own declaration. Release, replay, bill moves and quantity splits preserve an existing snapshot. Keep `readLineNutrition` live; add saved-context reading separately. Context consumers traced: venue-service operations/service/module contract; working-order creation/retrieval/edits/copies; order-portions; issuance-pass menu attribution; till basket/modifier/details and grouping. History also folds portions in `orders-list.ts`: declarations with different values must not merge.

## PR1: capture and till display, within three build hours

Branch `feat/a1517-6-sent-declarations`.

Change `packages/db/src/schema/venue-service/service.ts`, venue-service `src/{operations,service}.ts`, module `src/module.ts`; server `src/{working-order,line-nutrition}.ts`; till `src/{api/client,till-app}.ts`, `widgets/{line-nutrition,sent-orders}.ts`, `screens/till-table-order-screen.ts`, `state/portion-groups.ts`, and `i18n/strings.ts`. Expose the snapshot through existing context/retrieval contracts. Capture both table and counter first sends through one writer. Sent details say “Recorded when sent”; older sent rows say the declaration was not recorded. Unsent editable/parked rows retain their existing live/parked presentation.

Rebuild core with `pnpm --filter @waitron/server migration-baseline rebuild --set core`; commit its baseline SQL, snapshot, journal and other generated changes. No hand edits or incremental migration. No new table. Its commit message says “Existing test venues must be reset: the core starting migration changes”.

Tests: server `src/line-nutrition.test.ts` owns effective variant/extra capture including null/empty declarations; new `src/sent-line-nutrition.test.ts` reuses `testing/party-venue.ts` for first-send timing, held release, edits adding extras, saved retrieval and copies. Keep one edited-product live check in `kitchen-allergy.reads.test.ts`; do not repeat existing paper/clash matrices. Add the service-method inventory in `packages/venue-service/src/service.test.ts` and the full-column seed assertion in `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`. Till `widgets/sent-orders.nutrition.test.ts`, `state/portion-groups.test.ts` and selected `till-app-boot-and-counter.test.ts` cases own display and grouping. Update English/Spanish `products.md` and `table-service.md` guides.

Estimate: production +220/−35; tests +320/−15; support +0/−0; prose +35/−8; generated diff +30/−8, provisional until regeneration. Count every generated change; today's 20,016-line snapshot is not assumed to change wholesale.

## PR2: Orders history detail, within three build hours

Branch `feat/a1517-6-order-history`.

Change server `src/orders-list.ts` and its existing tests; dashboard `src/{api/client,i18n/strings}.ts`, `widgets/order-detail-dialog.ts` and its existing tests. Read saved context beside each working-order line, preserve extras separately and compare folded declarations by values. Show saved allergens and dietary declarations beneath the existing dish detail; clearly identify missing capture. No new screen. Update English/Spanish product guides, `docs/developers/products.md`, and A1517/A1150 entries in `docs/{backlog.md,backlog/catalogue.md}`, citing the owner's 11-November exception to A1150's live-screen rule.

Estimate: production +100/−15; tests +140/−5; support +0/−0; prose +30/−8; generated +0/−0.

## Verification and exclusions

Use observed failing behavioural tests first, then each named changed file's focused Vitest run. PR1 also runs all five schema/migration guards required by CLAUDE.md and unedited fiscal `inmutabilidad`; PR2 runs `src/orders-list*.test.ts` and dashboard `src/widgets/order-detail-dialog.test.ts`. Check guides with `src/guide-content.test.ts`. Inspect both locales/themes at phone and desktop widths, then normal hook and current-head CI. No whole local package suite. Exclude fiscal/invoice writes, publication changes, compatibility machinery, new record lifecycles and kitchen redesign.

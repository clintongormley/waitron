# A1517-6: declarations recorded when sent

**Request:** “Capture the chosen product's effective current declaration at sending for sent-order/history displays while preserving variant inheritance and leaving kitchen screens, paper and guest-clash checks live. No fiscal or invoice change is authorised.” Recorded in Lane F `queue.md`, A1517-6. Authority: [owner decisions](../specs/2026-11-11-a1517-allergen-proposal.md#owner-decisions-2026-11-11), “As recommended”, not approval of this plan. Driver owns Claude review and watcher clearance. Source trace only; no tests run.

**Finish line:** You can reopen sent, held, served and cancelled dishes and read their recorded allergens, kinds and dietary declarations after a product edit. Unsent editable rows retain live display. Reuse existing displays and retrieval.

## Traced boundaries and storage

Context consumers: `working-order.ts` creation/retrieval/edits/splits, `order-portions.ts` input copies; venue-service operations/service and module contract; schema exports/classification; `issuance-pass.ts:30` menu attribution. `readLineNutrition` serves `readTabLines`, `readCurrentOrders`, paper and clashes; kitchen/expo separately read effective products (`working-order.ts:7831`). Till consumers: Sent icons, table/basket/modifier details, counter rebuilding (`till-app.ts:9360`) and portion grouping.

Reuse context `allergens`; extend its existing `diet` JSON object with `dietaryDeclarations`, preserving profile members. Property presence identifies capture, including `[]`; absence means **not recorded when sent**, never a published/live historical substitute. Distinguish `null` allergens from reviewed `{}`. Expose optional saved declarations through venue-service; leave database columns unchanged. Review this reuse: context nutrition currently records the offer (`operations.ts:1335`), and retrieval consumes it.

Keep `readLineNutrition` live. Reuse its `effectiveProductColumns`/`parentJoin` query for capture, retaining unknown and empty declarations before its display filtering. Read actual stored product ids, including variants and extras, in batches. Never merge extras into their parent.

## PR 1: table sending and history, at most three build hours

Capture once in the submission transaction, including held submissions before cooking starts. Cover accepted new lines in rounds, groups and edits; release, replay, quantity splits and bill moves retain the capture. Older submitted rows remain unrecorded. This deliberately treats submitting a held group as sending, rather than its later kitchen release.

Change `packages/venue-service/src/{operations,service}.ts`, `packages/module/src/module.ts`; `apps/server/src/{working-order,order-groups,line-nutrition}.ts`; `apps/till/src/widgets/{line-nutrition,sent-orders}.ts`, `screens/till-table-order-screen.ts`, `state/portion-groups.ts`, and `i18n/strings.ts` under that till prefix. Add saved-context read/write methods; switch only order/history readers. Opt table details into “Recorded when sent” and missing-capture wording; keep the basket helper's meaning. Compare grouped declarations by values. Narrow `issuance-pass.ts`'s context-immutability comment only. Update server `src/guide/{en,es}/products.md` and `docs/developers/products.md`.

Test ownership: new server `line-nutrition.test.ts` owns effective variant inheritance/override and null/empty/kind/diet values. New `sent-line-nutrition.test.ts`, reusing `testing/party-venue.ts`, owns submission timing, later edits, saved reads and copying. Existing `kitchen-print.allergy.test.ts` and `kitchen-allergy.reads.test.ts` each own one edited-product live-output check; `party-allergy.release.test.ts` owns live clash recalculation. Till `sent-orders.nutrition.test.ts` owns English/Spanish presentation; `state/portion-groups.test.ts` owns grouping. No repeated matrices.

Estimate: production +180/−25; tests +240/−15; test support +0/−0; prose +45/−8 lines.

## PR 2: counter sending and retrieval, at most three build hours

Wire first-send capture into `stampSent`, `placeOrder` and `sendToPrep` in `working-order.ts`, sharing PR 1's writer. Never backfill older submitted holds on release. Parking retains its existing snapshot; sending captures current values. Carry sent/missing provenance through `HeldOrder`, till `api/client.ts` and `widgets/{basket,modifier-picker}.ts`; older sent rows show no declaration claim and details say “Not recorded when sent”. Extend `working-order.test.ts` retrieval cases and `till-app-boot-and-counter.test.ts` display cases. Update the guides and A1517 entries in `docs/{backlog.md,backlog/catalogue.md}`; narrow A1150's conflicting history scope.

Estimate: production +100/−15; tests +130/−5; test support +0/−0; prose +15/−10 lines. Allow 2–3 days overall for both review/clearance cycles.

## Focused verification

Observe expected failing assertions before implementation, then passing results. Commands: `pnpm --filter @waitron/server exec vitest run src/line-nutrition.test.ts src/sent-line-nutrition.test.ts src/kitchen-print.allergy.test.ts src/kitchen-allergy.reads.test.ts src/party-allergy.release.test.ts src/guide-content.test.ts`; `pnpm --filter @waitron/till exec vitest run src/widgets/sent-orders.nutrition.test.ts src/state/portion-groups.test.ts`; PR 2: `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts -t 'A1517-6|retrieved line'` and `pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts -t A1517-6`. Inspect both themes at phone width. Normal hook and current-head CI follow.

Exclude fiscal/invoice behaviour, migrations, compatibility machinery, new rows, publication changes and kitchen redesign. Review must settle storage reuse and held-submission timing before build; reject either through the driver, without speculative fallback work.

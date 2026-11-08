# D2: One count of items everywhere

**Proposed, not approved.** Assignment: Lane D queue, watcher 2026-11-08 10:52, “One count of items everywhere (A995, A996, A1293)”; A997 stays. One PR for A995, A996 and A1293 only, following landed A757 slice 6/#1955. Build from current main without waiting for overlapping lanes. Parent commits this proposal, runs Claude `review-branch` asking “is this the simplest way to deliver what was asked, and what is missing, wrong or unnecessary?”, then obtains watcher approval. No product/test code before approval.

## Behavior and decisions

Use `dishCounts` (`apps/server/src/order-state-counts.ts:56`) as the authority: subtract cancellations; zero active quantity counts zero. Count whole portions only with no hardware unit, zero effective decimal places and no measure flag. A fractional active quantity counts one even for a non-measure. Remaining whole portions round upward after serving; measured food remaining counts one. Extras never add dishes.

Extract that arithmetic and unit classification into two small browser-safe functions in `item-counts.ts`, using integer thousandths. Preserve `dishCounts`’ state precedence and assertions. Join products, `productUnits` through `unitOwnerJoin`, and units in bulk, including inherited variant units. Apply frozen precision before current precision, as the authority does. Floor station tickets use their parent dish’s metadata and remaining quantity; count that dish once per station while retaining extras’ kitchen readiness. Held counts subtract serving too.

`readCurrentOrders` currently sends precision without hardware/measure information (`order-groups.ts:2066`). Add optional counting-only `countUnit` metadata (hardware unit, precision, measure), absent for implicit Each; mirror it in the till client. Sent active counts classify from original active quantity; keep slice quantities and money. Preserve charged cancellations in Served: combine served/cancelled slices per dish, using billed quantity for classification, so a measured dish counts once there even when fully cancelled.

The draft already uses `takesExtras` (`till-table-order-screen.ts:274`); keep it and the unavailable-product fallback. Fix `draft-groups.itemCount` for zero/fractional quantities using the shared arithmetic. Leave `soldByTheUnit`, extras eligibility, editing, selection and service controls unchanged.

Find a bill replaces `count(*)` with an SQL sum over active parent dishes using the same rule, before Items sorting and pagination. Keep saved-bill scope, search ranking, stable ties, numeric `BillRow.itemCount` and money calculations. No private drafts added to search. Pin SQL/shared-rule agreement with database assertions.

A997 remains: frozen precision combines with current hardware/measure metadata; reassignment can change counts. Keep missing-offer placeholders and widened draft precision. No frozen choice, snapshot, schema, migration, fiscal change or unrelated cleanup.

## Exact path allowance and size

Brace lists expand to exact paths; other files need watcher approval.

- `packages/shared/src/{item-counts.ts,item-counts.test.ts,index.ts}`.
- `apps/server/src/{order-state-counts.ts,order-state-counts.test.ts,table-signals.ts,table-signals.test.ts,order-groups.ts,current-orders.test.ts,find-bill-bills.ts,find-bill-bills.test.ts}`.
- `apps/till/src/api/client.ts`; `apps/till/src/state/{draft-groups.ts,draft-groups.test.ts,draft-lines.test.ts,sent-panel.ts,sent-panel.test.ts}`; `apps/till/src/screens/{till-table-order-screen.new-order-quantities.test.ts,till-table-order-screen.sent.test.ts}`.
- `apps/server/src/guide/{en,es}/table-service.md`, `docs/backlog.md`, `docs/backlog/till.md`, and this plan.

Estimate **140–180 code lines, 200–260 test lines** (340–440 total), plus about 15 documentation lines. More than 660 code/test lines requires watcher approval.

## Test first and finish

After approval, add behavioral cases, observe their expected failures, then implement and rerun. Cover 0.64 kg, 150 g and 330 ml (including precision zero), custom measures, counted quantity 3, fractional non-measures, zero/full/partial cancellation, extras and partial serving across ready/held/Sent. Assert wire metadata, missing/changed units and stale drafts within A997’s limit. Retain price, slice and submitted-quantity assertions. Test Items both directions across the 50-row page boundary with counts that disagree with row counts.

Focused commands, using the files above:

- `pnpm --filter @waitron/shared exec vitest run src/item-counts.test.ts`
- `pnpm --filter @waitron/server exec vitest run src/{order-state-counts,table-signals,current-orders,find-bill-bills,guide-content}.test.ts`
- `pnpm --filter @waitron/till exec vitest run src/state/{draft-groups,draft-lines,sent-panel}.test.ts src/screens/till-table-order-screen.{new-order-quantities,sent}.test.ts`
- `pnpm exec vitest run scripts/guide-links.test.ts`

Finish with nonzero passing test counts and a light/dark, phone-width LOOK: ham, grams and 330 ml each read one dish; quantity 3 reads three; Find a bill displays and pages by those counts. Update both guide twins concisely. Delete A995’s detailed section and A995/A996/A1293 bundle bullets; retain A997’s detail, link and bundle, changing its summary and the root index to one remaining entry. Then normal hook, scoped current-head CI and `finish-branch` readiness.

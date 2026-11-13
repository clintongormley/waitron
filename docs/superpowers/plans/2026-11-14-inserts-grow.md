# INSERTS-GROW implementation plan

**Status:** Codex draft, checked by the driver; Claude's read and watcher clearance precede the build. No owner design approval is claimed. Execute inline with `superpowers:executing-plans`, as adapted by `~/.codex/AGENTS.md`.
**Ask:** Watcher, 2026-11-14 00:44, `/Users/clintongormley/waitron-campaign-h/queue.md`, INSERTS-GROW:
> every write whose bound values grow with a bill's lines goes through insertInChunks or statementChunks (CLAUDE.md §4): moveOrderLines, stampSentOrderNumber, copyHeldGroups and insertTabRound first, then one read-through sweep of apps/server and packages for the rest, listed in the PR with file:line. Prove it with one test per path at a size past the bound-value limit (the 1,188-water round is today's failing case), each written first and watched failing. No new helper: use the existing two. Plan first (one page), Claude's read, then PLAN FOR APPROVAL.

## Result and approach

Large rounds and the named bill move/copy paths complete without exceeding the store's 32,766 bound values per statement; the sweep corrects further bill-growing writes. This does not promise unlimited bill sizes. Keep existing APIs, paid-line refusals, fiscal checks, ordering, identities, parent/extras relationships and the enclosing transaction.
Reuse `packages/db/src/insert-in-chunks.ts`: `insertInChunks` for plain inserts; `statementChunks(table, rows)` for returning/conflict inserts and growing updates. Accumulate returned rows before subsequent work. Necessary reads can reuse `bill-actions.ts:214`'s inline JSON-list predicate or receive bounded chunks. Growing writes use the requested chunk helper, budgeting repeated predicates and fixed binds. No helper/limit changes, new helper, scanner, migration, refactor or unrelated ID-list sweep.
**Size:** about 200–300 production and 450–650 test/support changed lines, plus this plan and documentation; one PR. The sweep's exact additions are not yet verified. Return material growth to the watcher before building it. Three-hour PR budget excludes watcher/service waits.

## Tests first and files

For each row, use real `useVenueDb` and existing fixtures, observe its SQL-variable failure at the target statement, then make the minimal fix and rerun. Seed through existing chunk helpers; a fixture failure is not the required red. Keep existing assertions. Existing db/store suites retain responsibility for helper sizing and limit enforcement.

| Owning production file | Regression in existing server test file; assertion |
| --- | --- |
| `apps/server/src/working-order.ts`: `insertTabRound` | `working-order.many-tickets.test.ts`: **1,188-water round** (12 quantities of 99) retains every returned/stored line, its context and kitchen item after firing. Gather chunk returns in order, then apply contexts/refusal once. |
| Same: `stampSentOrderNumber`, ticket ownership update | `move-merge.test.ts`: **all-line move of 32,767 lines** (`lineNos: undefined`) reaches the stamp independently. Eligible fired/printed-held items get their original order number; unprinted-held, made-here and already-stamped items retain theirs; all ticket ownership moves. Bound portion-event reads too. |
| Same: `moveOrderLines` selection | `transfer-lines.test.ts`: **32,767 selected lines**, given backwards, keep IDs, prices, parent links and portion events, append in source order, and leave an unselected row. Write this after the stamp case so the selection still supplies its own red. |
| `apps/server/src/order-groups.ts`: `copyGroups` behind `copyHeldGroups` | `waiting-course-copy.test.ts`: **16,384 held dishes with extras** exceed the repeated-ID budget. Copies retain group order, membership, HOLD stations, moved events and both draft references; only emptied source groups disappear. Observe successive consumer/update failures before fixing them. |

Trace the complete named chains before edits: `bill-payments.ts`'s paid-line reads; `order-portions.ts:233`'s bindings; `dish-kitchen.ts`; `service-dishes.ts` through `VENUE_SERVICE.readLunchLineIds` in `packages/venue-service/src/operations.ts`; and held-paper, draft-remapping and emptied-group calls in `order-groups.ts`. Bound calls without creating one group/event per chunk or changing sorting. Initial shared edit: `service-dishes.ts`; edit other consumers only where needed for these paths. Reuse `testing/party-venue.ts`, `group-submit-fixture.ts`, `zone-offers.ts`, `kitchen-table-order.ts` and split-extras fixtures; no new shared helper/fake.

- [ ] Complete one read-through of production inserts, raw SQL and relevant growing writes under `apps/server` and `packages`; record each bill-growing path's disposition with `file:line` in the PR. Grep is an index, not evidence of a completed read.
- [ ] Preliminary additional candidates (read, not run): `apps/server/src/station-move.ts:503`, `order-drafts.ts:1295`; `packages/venue-service/src/party-allergy.ts:307`; `packages/adjustments/src/refund-links.ts:18`; `packages/core/src/record-sale.ts:311`, `record-correction.ts:357`, `record-substitution.ts:204`. Check cardinality/callers; for each actual failure, add one beyond-limit case in its existing `station-move.test.ts`, `order-drafts.db.test.ts`, `party-allergy.test.ts`, `refund-links.test.ts` or matching core writer suite, asserting the complete stored result/relationships. Observe red before chunking. Do not alter fiscal backend builders, hashes, numbering or golden data. Other discovered bill-growing paths follow the same ownership; material expansion returns to the watcher.

## Verify and deliver

- [ ] Red/green: `pnpm --filter @waitron/server exec vitest run src/<owning-file>.test.ts -t '<case name>'`; use the owning package for discovered package paths. Then run every changed test file in full, plus focused suites for changed shared consumers. No whole-server local run.
- [ ] Keep fiscal gates unedited: `pnpm --filter @waitron/fiscal-verifactu test --project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] Remove the three completed entries, bundle heading and obsolete live detail in `docs/backlog/architecture.md`, and the bundle index in `docs/backlog.md`. Retire CLAUDE.md §4's table-round exception and unswept claim only after the inventory. Update the live paragraph in `docs/developers/testing-guide.md:783` and the touched 11,880-burger workaround comment; preserve its assertion and historical receipts/plans.
- [ ] Review the whole diff and red/green receipts, then `finish-branch` reviews, normal push hook, current-head scoped CI and authorised `land-branch`. Put the inventory and exact remaining limits in the PR; no new product mechanism or extra audit artifact.

# A1308 fk8 — kitchen tickets: the allergy snapshot on the ticket, MOVED notices that name their ticket, routing periods without a department copy: implementation plan

## 2026-11-13 — CURRENT-MAIN PREFLIGHT

**Claude reviewed in 213 seconds; findings folded in; watcher cleared 2026-11-13 19:54.** Base `4e930fd07c`;
fk7 merged `9dbea6ba9e`, exact-merge CI `43482596862` succeeded (Runner receipt). Preserve the
historical decisions/tests below. After fk8, allergy snapshots live on tickets, MOVED distinguishes
alike dishes, routing periods derive their department, and tickets need no node column.

**Authority/R2.** Sources: lane M's `reports/r1.md`, `reports/r2.md`; lane E's
`archive/questions-to-2026-11-11.md` (17:00–17:22). Watcher 17:15:
“Proposal 4 (delete recallLines, sendToPrep, advanceTicket, their routes and client methods) is
cleared by the watcher: put it at the start of fk8's plan, after showing with a search and a test
run that nothing calls them.” Watcher clearance, not new owner design approval. Proposal 1 landed
in #2926 (`68b0463513`)/#2933 (`1a663dafee`): preserve
`kitchenWork()`/`leftToServe()` (`apps/server/src/kitchen-print.ts:927-943`), callers and the
bill/index choice in `working-order.ts:8277-8289`. Recall removal landed #2879 (`a9e8f379b7`).
**Proposals 2/3/5 are outside this fk8 proposal and NEED watcher allocation:** immediate start/“from Grill”
printing after a pass-wait move to a non-waiting station; one Ready per pass card, including
counter/no-course, with server-enforced Runs the pass; undo Ready until served without a time
limit (17:22). Recommend a separate bounded watcher-queued change before fk9; invent no item.
Preserve served-dish/floor/split assertions.

**First build step — remaining proposal 4 only.**
`rg -n -w 'recallLines|sendToPrep|advanceTicket' apps packages -g '!*.test.*'` finds definitions,
route imports/calls, client and stale error comments; no screen callers, `recallLines` or
`advanceTicket` client. Runner's `apps/server` baseline, `pnpm exec vitest run
src/kitchen-request.send.test.ts src/kitchen-request.move.test.ts`, passed 15 tests/2 files;
nonexistent `src/kitchen-work.test.ts` supplied no evidence. Delete
`working-order.ts`'s two exports, `till-api.ts`'s `/api/working-orders/:id/prep` and
`/api/orders/:id/stations/:sid/advance`, and `apps/till/src/api/client.ts`'s `sendToPrep`.
Audit stale comments/docs, including `errors.ts`; no product UI/guide edits.
Port shared setup to real `fireLines`/payment/place paths and `advanceTicketItem`; retain supported
send/attendance/refusal/queue assertions. Delete API-exclusive cases/inventory rows, never shared
files. Focused suites under `apps/server/src/`:
`working-order.test.ts`, `working-order.pay-and-dispatch.test.ts`, `kitchen-request.send.test.ts`,
`kitchen-request.move.test.ts`, `counter-release.test.ts`, `attendance-final-order-paths.test.ts`,
`attendance-kitchen-service.test.ts`, `till-api.test.ts`, `till-api.fiscal-sale-paths.test.ts`,
`till-api.courses.test.ts`, `till-api.sell-published.test.ts`, `venue-settings-api.orders-open.test.ts`,
`till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts`, `till-device-proof.test.ts`;
also `apps/till/src/api/client.test.ts`. Re-run the name search and
`rg -n 'working-orders/.*(/prep|/lines/recall)|orders/.*stations/.*advance' apps packages`,
including tests; review every remaining hit. Add no permanent guard.

**Storage ports and checks.** Service schema lives in `packages/db/src/schema/venue-service/`;
`ticket-items.ts` stays in its parent. Remove the export from
`packages/venue-service/src/index.ts`. Keep Tasks 1–5's schema, allergy, MOVED, routing and overdue
tests; reuse `scripts/a1308/lib/fold-inserts.mjs` (fk0). fk7 replaced `station_printers`
with `kitchen_stations.printer_ids`. Per slice-rules §9, port
`apps/server/src/backup-verification-target.test.ts`'s policy pin by comparing serialized policies
(only the removed allergy-table ownership), and `apps/server/src/configuration-transfer.test.ts`'s
routing SQL via `menu_periods`, preserving assertions. Update strict lists
in `scripts/schema-constraints.test.ts`, `packages/venue-service/src/schema/service.test.ts` and
`packages/db/src/schema/venue-service/migrations.test.ts`; run them. Derive bundle version
from main at build/rebase. Extend
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` adapter for the four storage changes;
frozen Madrid captures stay byte-for-byte unchanged. Exclude the adapter from the final bulk
fixture-script pass, preserving historical source-table names; run both locale cases.

**Protection forecast.** Runner's base list contains all 12 composition/database/phase
entries (`receipts/fk8-kitchen-tickets/protection-before/protection-list.json` in lane E).
`missing table ticket_item_allergies` includes its PK, cascading ticket FK and both
`ticket_item_allergies_{original,current}_ck`; the implicit PK index and three change-feed triggers
also disappear, without separate nested-removal lines. Keep the other forecast rows below.
**Resolve before build:** `columns.ts:148` makes `flag()` a plain integer;
the captured schema has no automatic flag CHECK. Claude/watcher must settle whether an explicit
0/1 CHECK is intended; predict its name if so. Re-run list/compare after build; unpredicted
differences stop work, never assume equality. Run TDD, the original finish line and
`pass-lifetime.test.ts` and `station-outputs-down.test.ts` in `apps/server/src/`, unchanged.

**Cleanup backlog / review.** Delete the finished whole-ticket-route entry in
`docs/backlog/kitchen.md:181-187` and `docs/backlog/architecture.md:1518-1520`; reduce the latter
bundle count from 21 to 20. Ask the watcher to confirm that its older “FULL review path” means
the usual two Claude run-it reviews for this migration branch, with lane landing as below.

**Size / stop.** Provisional counted additions: production ≈225, tests/ports ≈410,
script/support ≈60, docs ≈105, total ≈800 (original ≈630). The plan refresh itself counts;
seek the watcher's outside opinion on this forecast before build. Separately uncounted: pure deletions,
generated migrations, committed fixture-script output; script source/manual ports count.
Retain the original **20% outside-opinion stop at 756**: consult the watcher before exceeding it.
No framework, new guard or permanent mutation
test. Report `Sale-path read changed:` for affected reads; retain every original stop point.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every step also
> follows [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules").

**Goal:** four kitchen changes: `ticket_item_allergies` (the allergy block a ticket was sent with,
and its current version) folds into `ticket_items`; `kitchen_notices` gains an index on its bill
(A1351) and the ticket item a MOVED notice was written for (A1366), so two alike dishes on one bill
stop sharing one MOVED notice; `routing_cell_periods` drops its copy of the period's department;
and `ticket_items.node_id` goes, since appendix §8 item 8's question was settled on `main` by #2570
(the overdue report no longer filters by box).

**Architecture:** `ticket_item_allergies` is keyed by the ticket item, and "a row exists" meant
"this ticket's allergy block is frozen", which becomes the flag `allergy_frozen` (appendix §1.17).
The MOVED notice's ticket item is found from the notice's line inside `recordKitchenNotices` (one
ticket per line, `ticket_items_working_order_line_id_key`), so no caller changes. A routing period
reaches its department through `menu_periods` (appendix §1.21).

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, the slice-1a rebuild command.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) "Additions of 6 November 2026"
(`kitchen_notices` rows); [appendix](../specs/2026-11-02-rationalisation/tables-floorkitchen.md)
§1.17, §1.20, §1.21, §5, §6, §8 item 8; backlog entries A1351 and A1366
(`docs/backlog/architecture.md`, the A1308 bundle).

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

**Who lands:** the lane (rules §6: tickets and notices feed no fiscal value).

## 2026-11-13 — named stop point 1 settled

The watcher accepted the split-piece control changing from zero to one MOVED slip at 20:23
(lane E questions.md). Join tables, move a multi-unit dish, split off a unit, then split the
tables apart: the new ticket has no MOVED record and receives one redundant slip. Keep the planned
ticket/station lookup; carry no paper-history record. List this new control's port in the PR.

## What it builds

- `ticket_items.allergy_frozen` (flag, default 0), `allergy_original`, `allergy_current` (JSON
  allergy blocks, null allowed), with `kitchenAllergyBlockCheck` on each
  (`packages/db/src/schema/venue-service/kitchen-allergy.ts:7-24`) and
  `ticket_items_allergy_frozen_ck`: `allergy_frozen = 1 or (allergy_original is null and
  allergy_current is null)`. `ticket_item_allergies` is deleted.
- `kitchen_notices_order_idx` on `kitchen_notices(working_order_id)` (A1351).
- `kitchen_notices.ticket_item_id` (key to `ticket_items`, `ON DELETE SET NULL`, because a notice
  outlives a voided line's ticket, `kitchen-notices.ts:35-37`), set on `moved` notices only
  (`kitchen_notices_ticket_item_kind_ck`: `kind = 'moved' or ticket_item_id is null`), with a partial
  index `kitchen_notices_ticket_item_idx` (where not null) so a ticket's delete does not scan the
  notices; `readNamesOnPaper` (`apps/server/src/kitchen-print.ts:2170-2245`) keys each dish's last
  MOVED notice by ticket item **and station** instead of by bill, station and dish name (A1366;
  coordinator decision 2026-11-08: the station term at `kitchen-print.ts:2196-2207` stays, or a
  rerouted dish would count paper printed at its new station).
- `routing_cell_periods.department_id` is dropped; its composite key becomes `period_id` →
  `menu_periods(id)` `ON DELETE CASCADE`.
- `ticket_items.node_id` (with its key to `nodes`) is removed (Task 4). Appendix §8 item 8 needs no
  measurement any more: #2570 (A1425 part 1, `df7fc95182`) deleted the overdue report's node filter
  (`computeOverdueOrders(tx)` at `packages/reporting/src/overdue-orders.ts:34` takes no box), so a
  ticket written before a takeover is already listed (`packages/reporting/src/overdue-orders.test.ts:448`,
  "another box's overdue order is listed"), and the column has no product reader left
  (`git grep -n "ticketItems\.nodeId" origin/main -- apps packages ':!*.test.ts'` prints nothing).
  The design's answer for that case is "the filter and `ticket_items.node_id` then go" (§8.8).
- Deletes the backlog entries A1351 and A1366 from `docs/backlog/architecture.md`'s bundle, takes
  their ids out of the bundle line in `docs/backlog.md:2300` ("Holds A1368, A1351, A1366"), and
  lowers the bundle's entry count by two from `main`'s value in both places (`docs/backlog.md:2300`
  "bundle of 16", `docs/backlog/architecture.md:1182` "16 entries" at `a086eedfb7`).
- Raises the configuration bundle's format version by one (rules §9): `routing_cell_periods` rows
  stop carrying `department_id` (`packages/provisioning/src/configuration-transfer.ts:123, 160,
  473-476`; an older export is refused as outdated, as fk1 set up).

## What it leaves out

| Left out | Owner |
| --- | --- |
| `ticket_items.working_order_id` | fk9 (§8 item 1, which needs slice 0's bench) |
| A1368 (one HOLD-paper record per dish in `order_group_hold_stations`) | the orders and sales area (design "Additions": "Lands in Orders and sales") |
| "Index the dishes not yet fired" (`docs/backlog/till.md`, bundle "Query plans and indexes, measured on a year of data") | that bundle; it needs the bench, and fk9 can take it if the watcher asks |
| Keeping `ticket_item_moves` a table | unchanged by design (appendix §1.18) |

## Files

- Modify: `packages/db/src/schema/ticket-items.ts` (:32-90), delete `ticketItemAllergies` from
  `packages/db/src/schema/venue-service/kitchen-allergy.ts:26-44` (keep `kitchenAllergyBlockCheck`),
  `packages/db/src/schema/venue-service/kitchen-notices.ts:38-107`,
  `packages/db/src/schema/venue-service/routing.ts:91-125`, `packages/db/src/index.ts`,
  `packages/db/src/classification.ts:355`, `packages/venue-service/src/classification.ts:37`,
  `scripts/schema-constraints.test.ts:182-183, 247-249`.
- Modify (allergy snapshot): `packages/venue-service/src/kitchen-allergy.ts` (all four functions),
  `apps/server/src/testing/kitchen-allergy-fixture.ts:252`.
- Modify (notices): `packages/venue-service/src/kitchen-notices.ts:55-60, 85-200`
  (`recordKitchenNotices`), `apps/server/src/kitchen-print.ts:2159-2245` (`readNamesOnPaper` and its
  comment).
- Modify (routing): `packages/venue-service/src/routing-store.ts:347-357`,
  `packages/venue-service/src/operations.ts:405-420` (`configureZone`'s clean-up),
  `packages/venue-service/src/service-delete-settings.ts:50-62`,
  `packages/venue-service/src/configuration-transfer.ts:535-552`.
- Modify (`node_id`, Task 4): `apps/server/src/working-order.ts:2041, 2335` (the two ticket
  inserts that name `nodeId`; the copy at :5203 spreads the old row, `...ticket`, and names no
  `nodeId`, so dropping the column drops it there too). The overdue report and `report-api.ts` need
  nothing: #2570 already removed the filter and the input.
- Create: `scripts/a1308/fk8-kitchen-fixtures.mjs` and `.test.mjs`,
  `apps/server/src/kitchen-print.moved-notice-ticket.test.ts`.
- Generated (uncounted): core's starting migration and the epoch file.
- Docs: `docs/developers/conventions-data.md` (no section names these tables by fold today; add one
  sentence to "Latest station move follows insertion order" only if Task 3 changes split behaviour,
  which is a stop), `docs/backlog/architecture.md`, `docs/backlog.md`.

## Size

| Part | Counted lines |
| --- | --- |
| Schema and lists | 70 |
| Allergy snapshot store (four functions) | 50 |
| MOVED notice ticket: writer and `readNamesOnPaper` | 40 |
| Routing periods | 30 |
| `ticket_items.node_id` removal (the filter is already gone, #2570) | 15 |
| Fixture script config and test | 60 |
| New tests (schema, snapshot, A1366's two dishes, routing clean-up) | 200 |
| Hand edits to tests the script reports | 90 |
| Docs and backlog | 15 |
| Format version, the D6 and reroute cases, the assertions above | 60 |
| **Total** | **≈ 630** |

Uncounted: the script's output (`ticket_item_allergies` inserts, `departmentId` in routing-period
inserts in 7 test files, and `nodeId` in `ticket_items` inserts in about 16 test files), deletions,
generated files.

## Finish line

```bash
pnpm --filter @waitron/venue-service exec vitest run src/kitchen-allergy.test.ts \
  src/kitchen-notices.test.ts src/routing-cells.test.ts src/routing-store.test.ts src/routing.test.ts \
  src/operations.test.ts src/service-delete-settings.test.ts src/configuration-transfer.test.ts \
  src/classification.test.ts src/schema
pnpm --filter @waitron/db exec vitest run src/schema
pnpm --filter @waitron/reporting exec vitest run src/overdue-orders.test.ts
pnpm --filter @waitron/server exec vitest run src/kitchen-allergy*.test.ts \
  src/kitchen-request.release.test.ts src/kitchen-request.tab-send.test.ts \
  src/line-cancel-context.test.ts src/working-order.many-tickets.test.ts src/kitchen-print*.test.ts \
  src/table-actions*.test.ts src/till-api.split-bill.test.ts src/report-api*.test.ts \
  scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts \
  scripts/floor-kitchen-triggers.test.ts scripts/a1308
node scripts/a1308/fk8-kitchen-fixtures.mjs --write $(git ls-files '*.test.ts' 'apps/*/src/testing/*.ts' 'packages/*/src/testing/*.ts') && git diff --exit-code
```

The A803 slice-4c suites that cover Split a table's MOVED slips (`git grep -l "readNamesOnPaper\|
moved slip" -- 'apps/server/src/*.test.ts'`) pass with assertions unchanged.

## Expected protection-list difference

Under all six venue headers unless "change-feed only". Lines marked † come from Task 4's removal
of `node_id`.

| Table | Lines |
| --- | --- |
| `ticket_item_allergies` (§5: "implicit; the two CHECKs on `ticket_items.allergy_*`") | `missing table ticket_item_allergies`; `missing index ticket_item_allergies.primary key(ticket_item_id)`; change-feed only: three `missing trigger waitron_change_ticket_item_allergies_*` |
| `ticket_items` | `extra table ticket_items.columns[allergy_frozen]`, `[allergy_original]`, `[allergy_current]`; `changed table ticket_items.columnOrder`; `extra table ticket_items.checks[ticket_items_allergy_original_ck]`, `[ticket_items_allergy_current_ck]`, `[ticket_items_allergy_frozen_ck]`; † `missing table ticket_items.columns[node_id]`; † `missing table ticket_items.foreignKeys[node_id->nodes(id)]`; change-feed only: `changed trigger waitron_change_ticket_items_update.when` |
| `kitchen_notices` (design "Additions": A1351, A1366) | `extra table kitchen_notices.columns[ticket_item_id]`; `changed table kitchen_notices.columnOrder`; `extra table kitchen_notices.foreignKeys[ticket_item_id->ticket_items(id)]`; `extra table kitchen_notices.checks[kitchen_notices_ticket_item_kind_ck]`; `extra index kitchen_notices_order_idx`; `extra index kitchen_notices_ticket_item_idx`; change-feed only: `changed trigger waitron_change_kitchen_notices_update.when` |
| `routing_cell_periods` (§5: "FK `period_id` → `menu_periods` cascade (department copy dropped)") | `missing table routing_cell_periods.columns[department_id]`; `changed table routing_cell_periods.columnOrder`; `missing table routing_cell_periods.foreignKeys[period_id,department_id->menu_periods(id,department_id)]`; `extra table routing_cell_periods.foreignKeys[period_id->menu_periods(id)]`; change-feed only: `changed trigger waitron_change_routing_cell_periods_update.when` |

`kitchen_notices_ticket_item_idx` is not in the design: the new key's `SET NULL` would otherwise scan
`kitchen_notices` (7,000–30,000 rows a year, appendix §1.20) on every ticket delete. Say so in the
pull request.

## Stop points (beyond rules §5)

1. Task 3: an existing Split-a-table suite changes its slips (prints one it did not, or misses one)
   with the ticket-keyed lookup, including the case of a dish whose line was split after its MOVED
   notice: stop; describe the case for the watcher.
2. Task 4 Step 1 finds a product reader of `ticket_items.node_id`, or the overdue report filtering
   by box again: the column stays until the watcher decides.
3. `menu_periods`' unique index on `(id, department_id)` is used only by the composite key this
   removes: leave it; the menu area decides (it owns `menu_periods`).

## Needs

- fk0 (the fixture library), fk6 (`scripts/floor-kitchen-triggers.test.ts`, which this re-runs),
  fk1–fk7 (lane order).
- Batch 1: 1a, 5.
- Outside: A1403 (unpaid kitchen stop, lane H) edits the overdue report's reads with no table
  change; Task 4 no longer edits that report, so only a fixture overlap can need a rebase (rules §8).

## Assumptions about batch 1

B1, B3, B4 as in [fk1](2026-11-08-a1308-fk1-zone-service-rules.md#assumptions-about-batch-1).

## In-flight work folded in

- A1366 and A1351: built here (their backlog entries, written 2026-11-06, are the evidence).
- A1378 (kitchen paper, no table change) and A1403 (above) rebase.
- A1368 is the orders area's; it touches the HOLD paper record, not `kitchen_notices`, but both edit
  MOVED-slip code in `kitchen-print.ts`; whichever lands second rebases.

## Assertions that change, by design

| Where | Change | Design |
| --- | --- | --- |
| `apps/server/src/venue-settings-api.orders-open.test.ts` | Delete only `/prep` probes after receipt-language checks; retain language and sent/unsent-state checks; drop the late-send assertion, not replace it with a direct call | R2 proposal 4, watcher 2026-11-11 17:15 |
| `apps/server/src/till-api.sell-published.test.ts`, `counter-release.test.ts` | Remove duplicate `/prep` probes; retain successful-sale, queued-item and surrounding assertions | same |
| `apps/server/src/till-api.fiscal-sale-paths.test.ts` | Remove the retired `/prep` request/refusal probes at :1903-1911 and later in that case; keep sale and station-queue assertions at :1890-1901/:1913-1926; remove only the late-send describe at :3035-3126 | same |
| `apps/server/src/attendance-final-order-paths.test.ts` | Remove only the three legacy-prep cases at :103-153 and their exclusive helper; retain all other attendance cases | same |
| `apps/server/src/working-order.test.ts`, `working-order.pay-and-dispatch.test.ts`, `till-api.test.ts` | Remove checks exclusively of the two retired functions/routes; port setup to supported send/advance paths and preserve shared state/queue assertions | same |
| `apps/server/src/kitchen-request.send.test.ts` | Remove the retired whole-ticket held no-op at :421; keep per-item held refusal and group-ready non-change checks | same |
| `apps/server/src/attendance-kitchen-service.test.ts`, `till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts`, `till-device-proof.test.ts` | Remove only retired-route inventory rows/probes; retain supported per-item advance, attendance, profile and proof assertions | same |
| `apps/till/src/api/client.test.ts` | Remove only the `sendToPrep` request-shape case with its deleted method | same |
| `packages/db/src/schema/venue-service/migrations.test.ts:302-308` | `routing_cell_periods`' keys read `(period_id) -> menu_periods(id) on delete cascade` instead of the composite | §1.21, §5 |
| same file `:326-331` | `kitchen_notices`' keys gain `(ticket_item_id) -> ticket_items(id) on delete set null` | design "Additions" (A1366) |
| same file `:856` | the case that a period of another department is refused through the composite key goes: the database no longer holds the department copy; the writer's and the import's refusals (`routing-store.ts`, `configuration-transfer.ts:549-551`) still refuse it, proved by Task 5's test | §1.21, §6 |
| `packages/venue-service/src/configuration-transfer.test.ts:795` | the `routing_cell_periods.department_id` refusal case goes with the column (the zone-department refusal beside it stays) | §1.21 |
| `packages/venue-service/src/schema/service.test.ts:151-162, :191-` | the `routing_cell_periods` entry loses its composite key and gains the period key; the `kitchen_notices` entry gains the ticket key, the CHECK and the two indexes | §1.21; "Additions" |
| `packages/db/src/schema/venue-service/migrations.test.ts`, `service.test.ts:116-` | `ticket_item_allergies` entries, if listed, go | §1.17 |

## Global constraints

- Rules §1–§9. `ticket_items` stays `ledger` and not append-only (appendix §1.17).
- An allergy block, once frozen, keeps its original; only `allergy_current` changes after
  (`setTicketAllergyCurrent`). An unfrozen ticket has neither.

## Review Focus

1. **Two alike dishes on one bill, one moved** (A1366): Split a table prints a slip for the dish
   whose ticket still names the table that left. Test: Task 3, the review's Mesa 940 case.
2. **A dish whose line was split after its MOVED notice**: the split piece has its own ticket with
   no notice. Test: Task 3's `a split piece of a moved dish` case, compared with the base (stop point
   1 if it differs).
3. **Freezing a ticket twice** keeps the first snapshot (today's `onConflictDoNothing`). Test: Task 2.
4. **A voided line** deletes its ticket; the MOVED notice stays, its `ticket_item_id` null. Test:
   Task 1.
5. **A zone moved to another department** drops its routing periods for the old department's
   periods. Test: existing `operations.test.ts` clean-up case, unchanged.

---

## Task 0: Base protection list

- [ ] As fk1 Task 0; keep `<A>`.

## Task 1: Schema

**Interfaces (produced):** `ticketItems.allergyFrozen: boolean`, `allergyOriginal:
KitchenAllergyBlock | null`, `allergyCurrent: KitchenAllergyBlock | null`;
`kitchenNotices.ticketItemId: string | null`; `routingCellPeriods` without `departmentId`.

- [ ] **Step 1: Write the failing tests** (constraint name in each refusal):
  `packages/db/src/schema/ticket-items.test.ts`: `refuses a snapshot on an unfrozen ticket` (`ticket_items_allergy_frozen_ck`);
  `stores a frozen ticket with no block` (succeeds: an unticked dish freezes too);
  `refuses a malformed block` (`ticket_items_allergy_original_ck`).
  `packages/venue-service/src/schema/kitchen-notices.test.ts` (create): `refuses a ticket item on a non-moved notice`
  (`kitchen_notices_ticket_item_kind_ck`); `a voided line's ticket leaves its MOVED notice with no
  ticket` (delete the line; the notice remains with `ticket_item_id` null);
  `has an index on working_order_id` (`pragma index_list('kitchen_notices')` names
  `kitchen_notices_order_idx`, and `explain query plan select … where working_order_id = ?` uses it).
  `packages/venue-service/src/schema/routing.test.ts` (create): `a routing period goes with its menu period` (delete the period: the
  routing row is gone); `refuses a period that does not exist`.
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement** as "What it builds"; the self-explanatory `ticket_items` comment block
  (:25-31) gains nothing; delete the `ticket_item_allergies` comment "Row presence also freezes an
  unticked dish" with its table. `schema-constraints.test.ts`: add `["kitchen_notices",
  ["ticket_item_id"], "ticket_items"]`; change the routing row to `["routing_cell_periods",
  ["period_id"], "menu_periods"]`.
- [ ] **Step 4: Rebuild** core; run Step 2; expect pass. **Commit.**

## Task 2: The allergy snapshot on the ticket

**Interfaces:** `recordTicketAllergies(tx, rows)`, `readTicketAllergies(tx, ids)`,
`setTicketAllergyCurrent(tx, id, block)` and `copyTicketAllergy(tx, from, to)`
(`packages/venue-service/src/kitchen-allergy.ts`) keep their signatures and answers.

- [ ] **Step 1: Write the failing tests** (`packages/venue-service/src/kitchen-allergy.test.ts`,
  re-pointed set-up, assertions unchanged, plus): `freezing twice keeps the first snapshot`;
  `an unfrozen ticket reads as not exposed` (`readTicketAllergies` omits it);
  `setting the current block on an unfrozen ticket changes nothing` (as updating a missing row did).
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** `recordTicketAllergies`: per `statementChunks` chunk, one `with v(id, o, c) as
  (values …) update ticket_items set allergy_frozen = 1, allergy_original = v.o, allergy_current =
  v.c from v where ticket_items.id = v.id and ticket_items.allergy_frozen = 0` (the CTE form:
  `update … from (values …) as v(…)` is a syntax error on the engine, `node:sqlite` 3.54.1, as the
  plan review ran it) (keeps "first
  freeze wins" and one statement per chunk, CLAUDE.md §4 "An insert whose rows grow with an order");
  `readTicketAllergies`: select the two blocks where `allergy_frozen = 1`;
  `setTicketAllergyCurrent`: update `allergy_current` where `allergy_frozen = 1`;
  `copyTicketAllergy`: copy the three columns. The fixture script folds test inserts: `{ child:
  "ticketItemAllergies", parent: "ticketItems", key: "ticketItemId", fields: { originalBlock:
  "allergyOriginal", currentBlock: "allergyCurrent" }, constants: { allergyFrozen: "true" } }`; raw
  SQL `insert into ticket_item_allergies` and `select … from ticket_item_allergies`
  (`kitchen-allergy.test.ts:112-201`, `kitchen-allergy.capture.test.ts:156`,
  `working-order.many-tickets.test.ts:100`) are reported and hand-edited to the columns.
- [ ] **Step 4: Run** the venue-service and server Finish-line commands; expect pass. **Commit**
  code; script and output; hand edits.

## Task 3: MOVED notices name their ticket (A1366, A1351)

**Interfaces:** `recordKitchenNotices` (`packages/venue-service/src/kitchen-notices.ts:85`) keeps its
signature; for `kind === "moved"` it reads `ticket_items.id` for the items' lines (one query,
`inArray(ticketItems.workingOrderLineId, …)`) and writes it as `ticketItemId`.

- [ ] **Step 1: Write the failing tests** in `apps/server/src/kitchen-print.moved-notice-ticket.test.ts`,
  through the real till routes (A1366's reproduction, `docs/backlog/architecture.md` bundle):
  - `two alike dishes: the moved one's slip still prints on a split` — two Burgers sent at table
    940; one moved to another bill; table 941 joins; that Burger moved back; table 940 split away:
    one MOVED slip prints for the Burger whose ticket names 940. (At the base this prints none, as
    the review found.)
  - `a dish whose only paper names the leaving table gets its slip` — the A803 slice-4c plan's D6
    reproduction (`docs/superpowers/plans/2026-11-04-a803-4c-split-table-picker.md:596-599`): a
    Burger's only ticket says Mesa 431; a second Burger, told `Mesa 431, 432`, moves onto its bill;
    431 leaves: one MOVED slip prints for the first Burger. (At the base: no notice and no slip.)
  - `a different second dish behaves as before` — the same with a Flan as the second dish: the slip
    prints (it did at the base too).
  - `a rerouted dish does not count paper at its new station` — a dish's MOVED notice at station A,
    then the dish rerouted to station B, then a split: B's slip decision ignores A's notice, as at
    the base.
  - `a split piece of a moved dish` — a Burger's MOVED notice, then its line split by quantity, then
    a table split: record what prints at the base and assert the same (stop point 1).
  - `each MOVED notice names its ticket` — after a move, every `kind = 'moved'` row has the moved
    line's ticket id; no other kind has one.
- [ ] **Step 2: Run**; the two reproductions (Mesa 940, Mesa 431) and `each MOVED notice names its
  ticket` fail at the base; the others pass there.
- [ ] **Step 3: Implement.** In `readNamesOnPaper`, select `ticketItemId` with the notices (:2200-2207)
  and key `lastNotice` by `[ticketItemId, stationId]`; look up `lastNotice.get(key(item.id,
  item.stationId))`; rewrite the function's comment's
  sentence "which is kept per bill, station and dish name, so two dishes alike on one bill share it"
  to "which names its ticket item and station". The query's `inArray(kitchenNotices.workingOrderId, billIds)`
  now uses `kitchen_notices_order_idx`.
- [ ] **Step 4: Run** the Finish-line server command, including the Split-a-table suites; expect pass
  with assertions unchanged. **Commit.**

## Task 4: `ticket_items.node_id` goes (§8 item 8, settled by #2570)

The measurement this task used to run is answered on `main`: #2570 removed the overdue report's
`eq(ticketItems.nodeId, input.nodeId)` filter and its `OverdueOrdersInput`, and replaced the case
"scopes to nodeId: another node's overdue order in the same tenant is excluded" with "another box's
overdue order is listed" (`packages/reporting/src/overdue-orders.test.ts:448`), which is §8.8's
case: a ticket under another box's `node_id`, still waiting, is shown.

- [ ] **Step 1: Check the column has no reader.** `git grep -n "ticketItems\.nodeId\|ticket_items\.node_id" -- apps packages ':!*.test.ts' ':!*.json' ':!*.sql'`
  prints nothing (at `48d527dbc8` it prints nothing). A hit is stop point 2.
- [ ] **Step 2: Remove it.** Remove `nodeId` from `ticketItems` (with its key to `nodes`) and from
  the two ticket inserts that name it (`working-order.ts:2041, 2335`; the copy at :5203 spreads the
  old row and follows); extend the fixture script with a rule dropping `nodeId` from
  `insert(ticketItems).values({…})` objects; rebuild core; run the reporting and server
  Finish-line commands, with `overdue-orders.test.ts` passing unchanged. **Commit.**

## Task 5: Routing periods reach their department through the menu period

- [ ] **Step 1: Write the failing test** (`packages/venue-service/src/operations.test.ts`): `moving a
  zone to another department drops its routing periods of the old department's periods, and keeps
  none of the new` — a zone cell with periods of department D1, `configureZone` to D2: no routing
  period of that cell remains whose `menu_periods.department_id` is D1.
- [ ] **Step 2: Implement.** `routing-store.ts:350-357` stops writing `departmentId` (the line still
  carries it for validation); `operations.ts:405-420` deletes the cell's periods whose
  `period_id` is in `select id from menu_periods where department_id <> ?`;
  `service-delete-settings.ts:50-62` selects periods by `period_id in (select id from menu_periods
  where department_id = ?)`; `configuration-transfer.ts:548` drops the `department_id` comparison and
  keeps the zone-department check at :549-551. Raise the bundle format version by one from `main`'s
  value (`packages/provisioning/src/configuration-transfer.ts:123, 160, 473-476`), with a case that
  the old number is refused `setup.configuration_outdated`. The fixture script drops `departmentId` from
  `insert(routingCellPeriods).values({…})` objects (its own rule).
- [ ] **Step 3: Run** the venue-service Finish-line command; expect pass. **Commit.**

## Task 6: Lists, Madrid baseline, backlog, finish

- [ ] Drop `ticket_item_allergies` from live-query lists (keep `ticket_items`); Madrid baseline: fold
  `ticket_item_allergies` into `ticket_items` (match `ticket_item_id` → `id`; `allergy_frozen` 1 for
  matched rows), drop `department_id` from `routing_cell_periods`, add `ticket_item_id` (null) to
  `kitchen_notices`, and drop `node_id` from `ticket_items` (Task 4).
- [ ] Delete A1351 and A1366 from the bundle and from `docs/backlog.md:2300`'s "Holds" list.
- [ ] Re-run `scripts/floor-kitchen-triggers.test.ts` (fk6); expect pass unchanged.
- [ ] Protection list compare; paste and mark (with or without the † lines). Finish line;
  `/finish-branch`.

## 2026-11-13 review and rebase decisions

The watcher requires the missing-ticket refusal to stay (lane E questions.md, 21:04): the writer
checks its skipped rows and throws `ticket_item.not_found` for an absent ticket. Restore the orphan
case against that domain code. Duplicate ids get only a PR-thread note; no caller produces them
according to the reviewed caller trace, and no extra guard is built. The 7f60fa9c7f rebase preserves
A1002's access-role storage; this slice now raises configuration format 29 to 30 and regenerates core.

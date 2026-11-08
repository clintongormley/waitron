# A1308 orders and sales, PR 10: HOLD paper is recorded per dish (A1368) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which stations hold a dish's HOLD paper per dish line instead of per group, so a dish
that leaves its group (a bill moved to the counter) keeps its record: its MOVED slip lists it and its
release prints the FIRE mark, as it does when its bill moves to another table (A1368; owner,
2026-11-06: "fix it").

**Architecture:** `order_group_hold_stations` keeps its name (the README's target list names it,
§4 "An open bill") and changes its key from `(group_id, station_id)` to `(working_order_line_id,
station_id)`; `group_id` goes. `recordHeldPaper` takes the dish lines a HOLD ticket carried;
`heldPaperStations(tx, groupIds)` keeps its name and result, deriving a group's stations from the
current lines of the group; a new `heldPaperStationsForLines(tx, lineIds)` answers per dish, and every
read that starts from a dish uses it (`onHeldPaper`, `printRelease`'s bill branch); the two queries that
join the record per ticket item (`apps/server/src/kitchen-print.ts:955-958`, `:1763-1766`) join on the
line. Without the per-dish reads the FIRE half stays broken: at the counter the dish has no group, so a
group-keyed read finds nothing.

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest.

**Spec:** README "Additions of 6 November 2026" (`order_group_hold_stations`, "One record per dish, not
per group … Orders and sales"); `docs/backlog/kitchen.md:214-236` (A1368); bundle entry A1368 in
`docs/backlog/architecture.md` ("Small checks …"). [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md)
§1.5 (the link table; both sides rows, R7). Rules: [slice rules](2026-11-08-a1308-slice-rules.md).

**Who lands:** the lane (kitchen paper; nothing fiscal).

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

---

## What it builds

1. `order_group_hold_stations`: `working_order_line_id` (not null, key to `working_order_lines` on delete
   cascade: a cancelled dish's paper record goes with its line), `station_id` (not null, key to
   `kitchen_stations`), primary key `(working_order_line_id, station_id)`. `group_id` and its key go.
2. `recordHeldPaper(tx, items: readonly { lineId: string; stationId: string }[])` — the lines each HOLD
   ticket job carried; its callers pass them: `order-groups.ts:2401` (`printHoldTickets`, items at
   stations in `carried`), `order-groups.ts:2591`, and `apps/server/src/station-move.ts:526`.
   **Copying a held group** (`order-groups.ts:864-912`): the moving lines keep their ids, so their records
   come with them; today the copy is recorded only for stations where a moving dish's kitchen item is not
   fired and is held or requested (`:900-906`). To keep that, the copy step replaces its
   `recordHeldPaper(tx, copyId, stations)` (`:909`) with `dropHeldPaper(tx, items)`, deleting the records
   of moving lines whose item at that station fails that same filter. After it, a moving dish keeps a
   record exactly where today's copy would have one for its station.
3. `heldPaperStations(tx, groupIds): Promise<Map<string, ReadonlySet<string>>>` unchanged in signature,
   derived through `working_order_lines.group_id`, for the callers that start from a group
   (`kitchen-print.ts:1010, :1139, :1524`; `order-groups.ts:597, :793, :867, :1129, :2503`;
   `station-move.ts:207`; `printRelease`'s group branch, `pass-release.ts:149-150`).
   New `heldPaperStationsForLines(tx, lineIds: readonly string[]): Promise<Map<string, ReadonlySet<string>>>`
   (dish line id → stations holding its HOLD paper), used by:
   - `onHeldPaper` (`kitchen-print.ts:1696-1720`): an item is on HOLD paper when its own line has a record
     at its station (today: line → group → the group's stations, `:1706-1719`, which is empty for a dish
     with no group);
   - `printRelease`'s bill branch (`pass-release.ts:141-152`): today it uses an empty station set for a bill
     release (`:151`), so a dish released by its bill never prints FIRE; now the set is the stations at
     which some released row's own line has a record (`heldPaperStationsForLines` over the released rows'
     `lineId`s, keeping each line's stations only where that row's `stationId` matches).
4. `readWaitingOnHoldPaper` (`kitchen-print.ts:1757-1775`) and the correction read (`:940-975`) join the
   record on `ticket_items.working_order_line_id` and `ticket_items.station_id`.
5. The two A1368 cases flip to the owner's behaviour (Task 2), and the backlog entries go.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `kitchen_notices`' ticket item (A1366) and index (A1351) | floor and kitchen |
| `order_groups.hold_printed_at` | unchanged: a group-level time read on kitchen paths (§6) |
| Renaming the table to say "dish" | not done; the README names it. Open question in the area's return |

## Files

- Modify: `packages/db/src/schema/order-group-hold-stations.ts` (29 lines)
- Modify: `apps/server/src/order-groups.ts:864-912` (copy), `:2350-2445` (`printHoldTickets`,
  `recordHeldPaper`, `heldPaperStations`, new `heldPaperStationsForLines`, new `dropHeldPaper`),
  `:2580-2592`; `apps/server/src/station-move.ts:515-527`;
  `apps/server/src/kitchen-print.ts:940-975, :1696-1720, :1755-1775`; `apps/server/src/pass-release.ts:139-152`
- Modify: `packages/db/src/classification.ts` (the entry's reason text: "the stations that have a dish's
  HOLD paper")
- Modify (tests): `apps/server/src/waiting-course-copy.test.ts:2476-2530`; the other test files naming the
  table or the two functions: `collect-at-counter.test.ts`, `draft-recall.test.ts`,
  `finish-party-collect.test.ts`, `kitchen-request.hold-paper.test.ts`, `line-service-projections.test.ts`,
  `made-here.routes.test.ts`, `management-api.station-disable.test.ts`, `order-groups.test.ts`,
  `station-delete.test.ts`, `station-move.test.ts`; `packages/db/src/schema/order-group-hold-stations.test.ts`;
  `scripts/schema-constraints.test.ts` (two rows); `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`:
  add `order_group_hold_stations: { group_id: "working_order_line_id" }` to `RENAMED_COLUMNS` (`:22`; the
  rename moves the column name and the foreign key's `from`, and keeps the column first, as the new
  schema has it), then, beside the other per-phase fixes (`:139-258`), set that foreign key's `table` to
  `"working_order_lines"` and `on_delete` to `"CASCADE"` (the capture has 0 rows of this table, so no row
  changes)

## Size

| | Counted | Not counted |
| --- | --- | --- |
| Code | schema 15, writers and `dropHeldPaper` 60, readers (incl. `heldPaperStationsForLines`, `onHeldPaper`, `printRelease`) 70 | generated files |
| Tests | flipped A1368 cases 30, new per-dish cases 110, re-pointed set-up 120, Madrid 10 | — |

About 415 counted lines; about 3 hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/order-group-hold-stations.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts src/kitchen-request.hold-paper.test.ts src/order-groups.test.ts src/station-move.test.ts src/collect-at-counter.test.ts src/finish-party-collect.test.ts src/draft-recall.test.ts src/line-service-projections.test.ts src/made-here.routes.test.ts src/station-delete.test.ts src/management-api.station-disable.test.ts src/pass-release.test.ts src/kitchen-print.test.ts --reporter=dot
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts --reporter=dot
```

## Expected protection-list difference

| Table | Line | Phases |
| --- | --- | --- |
| `order_group_hold_stations` | `missing table order_group_hold_stations.columns[group_id]`; `extra table order_group_hold_stations.columns[working_order_line_id]`; `changed table order_group_hold_stations.columnOrder` | all |
| `order_group_hold_stations` | `missing table order_group_hold_stations.foreignKeys[group_id->order_groups(id)]`; `extra table order_group_hold_stations.foreignKeys[working_order_line_id->working_order_lines(id)]` | all |
| `order_group_hold_stations` | `missing index order_group_hold_stations.primary key(group_id,station_id)`; `extra index order_group_hold_stations.primary key(working_order_line_id,station_id)` | all |
| `order_group_hold_stations` | `missing table order_group_hold_stations.keys[PRIMARY KEY(group_id,station_id)]`; `extra table order_group_hold_stations.keys[PRIMARY KEY(working_order_line_id,station_id)]` | all |
| `order_group_hold_stations` | `changed trigger waitron_change_order_group_hold_stations_update.when` | change-feed |

The station key stays. The group key is dropped with its column; the line key (cascade) replaces it.

## Stop points (beyond rules §5)

- A `heldPaperStations` caller needs the stations of a group whose dishes have since left it (the old
  per-group record kept them; the new derivation loses them). Read each caller's comment before Task 1.
- A test other than the two A1368 cases needs a changed assertion.

## Needs

- **In this area:** os5 (a dish is its line, so a record keyed by line is a record per dish).
- **Outside:** floor and kitchen's slices that change `kitchen_stations`, `ticket_items` and
  `kitchen_notices` have landed (rules §7; A1366's notice column is theirs).

---

## Global Constraints

- Rules §1–§9. Every kitchen paper and screen behaves as today except in the A1368 case.

## Review Focus

1. **A dish moved to the counter while waiting for the pass** (both counter paths). Test: Task 2.
2. **A dish moved to another table** keeps today's slip and FIRE (the case at
   `waiting-course-copy.test.ts:2440-2475`). Test: unchanged and passing.
3. **A dish moved to another station** (`station-move.ts:526`) is recorded at its new station only when
   that station's ticket carried it. Test: `station-move.test.ts`, re-pointed.
4. **A cancelled dish** loses its record with its line (cascade), so no slip lists it. Test: Task 1.
5. **A held group copied to another party** (`order-groups.ts:880-912`): its dishes' records follow them
   without a copy. Test: the existing copy case in `waiting-course-copy.test.ts`, unchanged.

---

### Task 1: The per-dish record

**Files:** `packages/db/src/schema/order-group-hold-stations.ts` and its test; `apps/server/src/order-groups.ts`,
`station-move.ts`, `kitchen-print.ts`; `packages/db/src/classification.ts`.

**Files (add):** `apps/server/src/pass-release.ts`.

**Interfaces:** `recordHeldPaper(tx: Transaction, items: readonly { lineId: string; stationId: string }[]): Promise<void>`
(insert, ignoring a row already present, as `onConflictDoNothing` on the primary key does at
`order-groups.ts:2419-2421`); `dropHeldPaper(tx, items: readonly { lineId: string; stationId: string }[]): Promise<void>`;
`heldPaperStations` unchanged; `heldPaperStationsForLines` as in What it builds, 3.

- [ ] **Step 1: Write the failing tests.** Schema: `"one record per dish and station; a second is
  refused"`, `"deleting the dish line deletes its record"`. Server, in `kitchen-request.hold-paper.test.ts`:
  `"a HOLD ticket records each dish it carried at its station"`; `"a dish that leaves its group keeps its
  HOLD paper record"`; `"heldPaperStationsForLines answers for a dish with no group"`; and in
  `waiting-course-copy.test.ts`'s copy cases, `"a copied held group keeps a dish's record only where its
  item is held or requested and not fired"` (the `:900-906` filter, now through `dropHeldPaper`).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** What it builds 1–4. Rebuild core.
- [ ] **Step 4: Run** the Finish line's db command and the server files except `waiting-course-copy.test.ts`;
  PASS, with re-pointed set-up only.
- [ ] **Step 5: Commit** `feat(server): record HOLD paper per dish`.

### Task 2: The A1368 cases (the owner's chosen behaviour)

These two cases pin the defect today (`docs/backlog/kitchen.md:229`). Changing their assertions is the
point of this PR (owner, 2026-11-06), so rules §4's stop does not apply to them, and only to them.

- [ ] **Step 1: Change the two cases** (`waiting-course-copy.test.ts:2476` and `:2501`) and rename them:
  - `"A1368: moved to the counter, the waiting tarta is on the MOVED slip, gets a moved notice and is
    released with the FIRE mark"`: the slip is `movedSlip(t.grill.name, …, words.counter, ["1 x BURG",
    "1 x TARTA"])`; new notices are BURG and TARTA at the grill; `releaseTarta(t)` equals today's expected
    ticket (`:2490-2499`) with the FIRE line first and nothing else changed:
    `[[`*** ${words.fire} ***`, t.grill.name, t.label, await orderNumberOf(t.bill2),
    expect.stringMatching(/^\d\d:\d\d$/), "1 x TARTA", ""]]`. There is no group line, because the dish has
    no group at the counter (today's expectation has none either); `fireTicket` (`:2001-2013`) is not used
    because it prints one.
  - The paid-bill case (`moveSettledBillToCounter`): the same three expectations.
- [ ] **Step 2: Run them; they pass after Task 1.** If either still fails, say which line and stop:
  the per-dish record is not the whole fix, and the backlog's proposed fix needs the watcher.
- [ ] **Step 3: Commit** `test(server): a dish waiting for the pass keeps its HOLD paper at the counter (A1368)`.

### Task 3: Backlog, guide, finish

- [ ] **Step 1: Backlog.** Delete A1368 from `docs/backlog/kitchen.md:214-236` and from the bundle in
  `docs/backlog/architecture.md` ("Small checks …"); correct the bundle's count; delete its index line in
  `docs/backlog.md` if it names A1368 (`:2300` names it in the bundle's "Holds" list — remove A1368 there).
- [ ] **Step 2: Guide.** If `apps/server/src/guide/{en,es}/kitchen-service.md` says a dish moved to the
  counter loses its HOLD mark, change both; otherwise nothing.
- [ ] **Step 3:** Rebuild core; Finish line; protection list.
- [ ] **Step 4: Commit**, `/finish-branch`, PR.

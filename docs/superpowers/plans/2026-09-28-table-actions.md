# Tables, parties and bills: the till's table actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate what happened in the room (table actions: seat, move guests, join tables, split a
table) from who pays for what (bill actions: split, merge, transfer, move a bill), with bills
belonging to the party rather than to a table, and "visit" renamed "party" throughout the code.

**Architecture:**
- **Task 1 renames** `visit` to `party` everywhere in the code, with no behaviour change: tables,
  columns, indexes, routes, identifiers and the `visit.*` error codes.
- **A party names its main bill** (`parties.main_bill_id`, Task 2). A database trigger clears it the
  moment that bill stops being open or leaves the party, and the next order then makes a new one
  (decision 15).
- **Table state moves to the table.** A table is free, held (an active `party_tables` row) or needs
  cleaning (`dining_tables.needs_cleaning_since`, Task 3). Kitchen slips, the pass and receipts name
  the party's tables (Task 4).
- **New server routes land beside the old ones.** Bill actions go under `/api/bills/:id/...` (Tasks
  5 and 7) and table actions under `/api/parties/:id/...` (Task 8), while the till keeps the old tab
  routes. The till switches over in Tasks 10 to 12.
- **Task 13 deletes the old tab routes and drops `dining_tables.tab_id`**, together with the other
  schema leftovers, in one migration that needs every venue reset.

**Tech Stack:** TypeScript, Drizzle ORM on SQLite (`drizzle-orm/sqlite-core`, `node:sqlite`,
drizzle-kit 0.31.11), Hono routes, Lit web components (the till), Vitest (`useVenueDb` real SQLite
databases for the server, real headless Chromium for the till).

**Spec:** `docs/superpowers/specs/2026-09-28-table-actions-design.md`, revision 4, approved by the
owner on 2026-09-28. **Read its §4 first**: the owner's decisions, which bind this plan. Its §13
proposals were accepted by the reviews and are treated as decided here. Then read the whole spec.
The service plan this one follows, `docs/superpowers/plans/2026-09-26-service-ordering-and-billing.md`,
explains the party (then called a visit), its revision (D19), its family (D2), groups (D1) and the
replay record (D8); read its D1, D2, D8 and D19.

---

## Owner rulings (2026-09-28)

The owner answered the four rulings this plan was written with. Each task that depends on one names it.

1. **Lane B holds until the whole plan lands.** The service plan's B10–B17 start only after Task 13
   has landed. B10, B11, B15 and B17 read the party's bills and the merge rules this plan changes
   (spec §12).
2. **Task 13's one-time venue reset and box wipe are agreed** (P28). Task 13 keeps its schema half,
   and its PR is still labelled `needs-owner-review` so the owner times the box wipe.
3. **The venue's clearing setting decides whether a table the guests leave needs cleaning** (P8,
   Tasks 3 and 8). With `service_settings.clearing_workflow` on, the tables need cleaning; with it
   off, they are free at once, as Finish does today. This narrows spec decision 6.
4. **A pending card payment does not stop a bill moving** (P19, spec §7), which overrides A82's text.
   A fully paid bill still never moves (decision 5).

---

## What this plan measured before it was written

All of these were run on 2026-09-28 against `main` at `f19768b3e`, in a scratch copy of
`packages/db` made with `git archive HEAD packages/db`, using drizzle-kit 0.31.11 and `node:sqlite`
on Node v26.7.0. **The migrations were applied by a small hand-written runner:** each core
`.sql` file was split on `--> statement-breakpoint` and applied inside its own `begin … commit`,
with `pragma foreign_keys=on`. **That runner is not the product's `applyMigrations`.** Each task
therefore measures again through the root guards named in its steps. The failing and passing
outputs were quoted from the runs.

1. **drizzle-kit cannot rename without a terminal.** With `visits` renamed to `parties` in the
   TypeScript schema, `drizzle-kit generate </dev/null` printed `Error: Interactive prompts require
   a TTY terminal`. **The command still exited with status 0.** A generate step is therefore checked by the file
   it writes, never by its exit status.
2. **Answering "rename" through a pseudo-terminal generates SQL that cannot be used.** Every table
   rename and column rename was answered "rename", with every constraint name left as it was. The
   generated migration still rebuilt seven tables (`party_tables`, `parties`, `working_orders`,
   `order_group_events`, `order_groups`, `order_drafts`, `service_commands`), because every foreign
   key naming the renamed table changed. The migration failed on a fresh database with
   `error in trigger visits_clear_table_status: no such table: main.party_tables`. A rebuild of
   `working_orders` would also drop `working_orders_enforce_transition`, a trigger ON it, silently
   (the mechanism is in `docs/developers/conventions-data.md`, the rebuild paragraphs).
3. **A hand-written rename applies cleanly.** It used `ALTER TABLE … RENAME TO`,
   `ALTER TABLE … RENAME COLUMN`, a drop and re-create of every index whose name changed, and a drop
   and re-create of the one trigger named after visits.
   - It applied after `0000`–`0031` on a fresh database.
   - Afterwards, `pragma foreign_key_list` showed every key pointing at `parties`, and the CHECK
     bodies on `parties` read `"parties"."state"`.
   - The body of `working_orders_enforce_transition` read `party_id` twice where it had read
     `visit_id`, so SQLite rewrote it.
   - `sqlite_master` still named "visit" in exactly two objects. The CHECK constraint names on
     `parties` stayed `visits_*_ck`, and `service_commands` kept its stored scope value `'visit'`.
4. **Dropping `dining_tables.tab_id` needs a table rebuild.**
   - Removing the column from the TypeScript schema made drizzle-kit generate a rebuild of
     `dining_tables` (`CREATE TABLE __new_dining_tables …`).
   - A hand-written `ALTER TABLE dining_tables DROP COLUMN tab_id` failed with
     `error in table dining_tables after drop column: unknown column "tab_id" in foreign key
     definition`, because the baseline declares that key at table level.
   - A `--custom` migration copies the previous snapshot, which still has `tab_id`. The next plain
     generate then produced the rebuild again.
5. **That rebuild fails unless a trigger is dropped first, and fails on rows.**
   - Applied after `0031`, the generated rebuild failed with `error in trigger
     visits_clear_table_status: no such table: main.dining_tables`.
   - With a migration that drops that trigger ahead of it, the rebuild applied on a fresh database.
   - With one `visit_tables` row seeded before it, the rebuild failed with
     `FOREIGN KEY constraint failed`.
   - The control, seeded with a table and no membership, applied and kept the row.

   **So Task 13 cannot upgrade any venue with a row in any table that holds a foreign key into a
   rebuilt table.** Read from the migration files, not run: every such key is `no action`.
   - Into `dining_tables`:
     - `bookings.table_id` (`packages/bookings/drizzle/0000_baseline.sql:16`);
     - `working_orders.delivery_table_id` (`packages/db/drizzle/0000_baseline.sql:125`);
     - `party_tables.table_id` (`packages/db/drizzle/0018_visits.sql:21`).
   - Into `parties`, which Task 13 rebuilds too:
     - `party_tables.party_id`, `working_orders.party_id`, `order_groups.party_id`,
       `order_group_events.party_id` and `order_drafts.party_id`;
     - its own `merged_into_party_id` (`0018_visits.sql:20,37,45-46`, `0028_order_groups.sql:9,26`,
       `0031_order_drafts.sql:42`).

   **A venue that ever seated a party, took a booking for a table, or delivered a counter order to a
   table** is therefore blocked. Only the first was measured.
6. **The new columns are plain additions.** `parties.name`, `parties.main_bill_id` (with a
   `references` thunk to `working_orders.id`) and `dining_tables.needs_cleaning_since` generated
   three `ALTER TABLE … ADD` statements, with no rebuild. They applied after `0031`.

Read, not run: `working_orders_enforce_transition`
(`packages/db/drizzle/0019_settled_order_freeze_visit_id.sql:9-31`) allows a `placed` row to change
only into `settled` or `abandoned`. So no placed (presented) bill can change party until Task 7
changes that trigger.

---

## When each task may start

B9 (`feat/service-served-and-reminders`) is in progress. It adds core migrations `0032`–`0034` on its
branch (read from `git diff --stat main...feat/service-served-and-reminders`), and changes
`apps/server/src/working-order.ts`, `order-groups.ts`, `till-api.ts` and `visits.ts`. **Every
`file:line` below was read on `main` at `f19768b3e`, before B9. Once B9 lands, the line numbers in
those four files move.** Each task's Step 0 re-maps them.

Spec §12 and §13 item 10 (accepted) put this work after B9 and before B10. Lane B is building B10–B17
of the service plan in parallel, and the brief for this plan says so. **By owner ruling 1, B10 onward start only after Task 13 has landed.** The rename alone touches
nearly every file they touch.

| Task | Slug | Branch | May start when |
| --- | --- | --- | --- |
| 1 | `party-rename` | `refactor/party-rename` | B9 `landed` |
| 2 | `party-main-bill` | `feat/party-main-bill` | Task 1 `landed` |
| 3 | `party-table-cleaning` | `feat/party-table-cleaning` | Task 2 `landed` |
| 4 | `party-kitchen-names` | `feat/party-kitchen-names` | Task 2 `landed` |
| 5 | `party-bill-actions` | `feat/party-bill-actions` | Task 2 `landed` |
| 6 | `party-collect-by-invoice` | `feat/party-collect-by-invoice` | Task 1 `landed` |
| 7 | `party-move-bill` | `feat/party-move-bill` | Tasks 3, 4, 5 and 6 `landed` |
| 8 | `party-table-actions` | `feat/party-table-actions` | Task 7 `landed` |
| 9 | `party-arriving-dishes` | `feat/party-arriving-dishes` | Task 8 `landed` |
| 10 | `party-till-bills` | `feat/party-till-bills` | Tasks 5 and 8 `landed` (see below) |
| 11 | `party-till-tables` | `feat/party-till-tables` | Tasks 8 and 10 `landed` |
| 12 | `party-till-move-bill` | `feat/party-till-move-bill` | Tasks 9 and 11 `landed` |
| 13 | `party-drop-tab-pointer` | `refactor/party-drop-tab-pointer` | Task 12 `landed` (the venue reset was agreed 2026-09-28, P28) |

**Task 10 waits for Task 8, not only Task 5.** Task 10 replaces the till's Merge with Task 5's
same-party merge, which removes the till's only way to combine two parties: the old cross-party
merge. Task 11 restores it through Move guests and Join tables. With Task 8 landed first, Task 11
can start the moment Task 10 lands.
- **The gap still exists between Task 10 landing and Task 11 landing.** The old Move and Join,
  which the till keeps until Task 11, refuse a table held by another party (`table.occupied`).
- So a runner starts Task 11 straight after Task 10, and the PR for Task 10 says so.

Tasks 3, 4 and 5 all touch `apps/server/src/working-order.ts`. Tasks 2 and 3 both add core
migrations. So run one at a time, even though the table allows them in parallel. A migration-number
collision on rebase is fixed by regenerating (CLAUDE.md §3), never by hand. **Task 1 is the
exception to plain regeneration:** see its Step 6a. Its regenerated SQL is replaced by the
hand-written rename again every time.

**The overlap rule applies to every task, even once its gate is met.** Before starting, run
`gh pr list`. If an open pull request from another lane changes a file this task will change, end
the firing and let that pull request land first.

**Queued items this plan absorbs** (`~/waitron-campaign/queue.md`):
- **A81** (move an unpaid counter order to a table) and **A82** (move a table's bill to the counter)
  are built by Tasks 7 and 12. Both are retired from lane A's queue when Task 12 lands; Task 12's PR
  says so.
- **A96** (dishes moved or merged into a party's bill get a group) is re-scoped to Task 9. That task
  covers dishes arriving in a party by Move a bill or Split a table. Inside one party a group already
  travels with its dishes, because a group belongs to the party. Retire A96 when Task 9 lands.

---

## What the code is today (read before Task 1)

Read from `main` at `f19768b3e`; nothing here was run unless it says so. Line numbers drift once B9
lands.

- **Party tables and columns.**
  - `visits` and `visit_tables`, plus `service_commands` with its scope enum `["visit","bill"]`, are
    in `packages/db/src/schema/visits.ts:17-121`.
  - The core columns `visit_id` are on `working_orders` (`orders.ts:84`), `order_groups` and
    `order_group_events` (`order-groups.ts:20`, `:66`) and `order_drafts` (`order-drafts.ts:35`).
  - The trigger `visits_clear_table_status` is in `packages/db/drizzle/0020_visit_clears_table_status.sql:7-16`.
- **A table points at a bill.** `dining_tables.tab_id` is at `packages/db/src/schema/dining-tables.ts:53`.
  Every non-test read and write of it is listed below.

  | Where | What it does |
  | --- | --- |
  | `apps/server/src/working-order.ts:992,1013` | `openTab` |
  | `:1054` | `assertAnchoredTabOpen`, which tells a table's bill from a "check" |
  | `:1846` | `openNextPartyTab` |
  | `:1867-1877` | `closedPartyTab` |
  | `:2500` | `assertTableAvailable` |
  | `:2522` | `freeTablesCoveredBy` |
  | `:2545-2573` | `moveTab` |
  | `:2585` | `tablePointsAt` |
  | `:2647` | `refuseMergeLeavingNoTable` |
  | `:2677,2698` | `joinTable` |
  | `:2784` | `mergeTabs` |
  | `:3260-3310` | `unjoinTable` |
  | `:5399-5400` | the pass (expo) label |
  | `:5636,5699` | `listTablesWithState` |
  | `:5798` | `readSeatedParties` |
  | `apps/server/src/visits.ts:361` | `releaseTables` |
  | `apps/server/src/order-groups.ts:954` | `visitTab`, the bill a new round goes on |
  | `apps/server/src/kitchen-print.ts:260-261` | the slip label, `readOrderHeader` |
  | `apps/server/src/receipt-order.ts:37,42` | the receipt label |
  | `apps/server/src/report-api.ts:174` | the open-table count |
  | `packages/reporting/src/overdue-orders.ts:52-53` | the overdue report |
  | `packages/db/src/configuration-transfer.ts:19` | left out of the configuration export |
  | `packages/bookings/src/testing/fake-core.ts:35-57` | a test fake |

  `bookings.tab_id` (`packages/bookings/src/schema/bookings.ts:47`) is that module's own column and
  stays.
- **The main bill is implicit.** `visitTab` (`order-groups.ts:951-962`) returns the `tab_id` of the
  party's earliest active table. `placeGroups` prices every round on it (`order-groups.ts:138-143`),
  and so does draft submission, through `placeGroups` (`order-drafts.ts:296`). `offersFor` reads the
  zone through it (`order-drafts.ts:721`). `priceTabRound` first calls `openNextPartyTab`
  (`working-order.ts:1782`, `:1832-1850`), which opens the party's next tab once the tab the tables
  point at has settled or been abandoned. It then refuses any bill no table points at
  (`assertAnchoredTabOpen`, `:1783`, `:1045-1058`).
- **The tab routes** (`apps/server/src/till-api.ts:1865-2008`) are `move`, `join`, `merge`,
  `transfer`, `split` and `unjoin`, taking `expectedVisitRevision` and `expectedSourceVisitRevision`
  through `visitCommand` (`:473-493`).
  - `transfer`, `split` and `unjoin` call `issueIfFullyPaid` on the source afterwards
    (`:1931`, `:1960`, `:1999`).
  - `merge` does not call it.
- **The merge today** (`mergeTabs`, `working-order.ts:2714-2810`):
  - it refuses a source holding money (`refuseBillHoldingMoney`, `:2745`, which lets a fully
    refunded payment through), and checks nothing about the destination's money;
  - it frees the source's tables, or points them at the destination;
  - between two parties it absorbs the source party: groups and drafts move, other open bills
    follow, and the source party closes with `merged_into_visit_id` set;
  - the till always sends `freeSourceTable: true` (`apps/till/src/screens/till-table-order-screen.ts:2902-2905`).
- **Transfer and split.**
  - `transferLines` needs a table pointing at BOTH bills (`carveBetweenTabs`, `:2876`) and matching
    service modes (`:2879`).
  - `splitOffCheck` needs a table pointing at the source (`:3221`) and refuses held lines
    (`tab.split_held_line`, `:2974-2976`). The owner kept that refusal on 2026-09-26: see the
    "Superseded" note under D1 of the service plan.
- **`assertAnchoredTabOpen` guards more than rounds.** It has eight callers:
  - `priceTabRound` (`:1783`), `carveBetweenTabs` (`:2876`) and `splitOffCheck` (`:3221`);
  - `sendLines` (`:1489`), `recallLines` (`:1594`), `voidTabLine` (`:1916`), `setLineCourse`
    (`:2130`) and `setLineServed` (`:2162`).

  So on `main` a split bill cannot take a round, be split, be transferred to or from, or have a line
  voided, sent, recalled or served. Task 2 replaces it.
- **Groups leaving a party.** `refuseHeldLeavingVisit` (`working-order.ts:3121-3138`) refuses held
  dishes with `group.held_leaves_visit`, and `clearGroups` (`:3140-3156`) takes sent dishes out of
  their group.
- **Kitchen names.**
  - `readOrderHeader` (`kitchen-print.ts:249-268`) picks ONE table: `tab_id` first, then the counter
    order's `delivery_table_id`, then the order's own label.
  - `enqueueMovedSlips` (`:669-721`) compares that one label before and after, and sends MOVED
    notices only when it changed.
  - The pass (`working-order.ts:5396-5401`), receipts (`receipt-order.ts:15-45`) and the overdue
    report (`packages/reporting/src/overdue-orders.ts:45-53`) pick the table the same way.
- **The pass shows no Ready or Away lever for a dish with no group:**
  `apps/till/src/screens/till-expo-screen.ts:584` renders the lever only when `group.groupId !== null`.
- **Collection** (`collectOrder`, `apps/server/src/till-sale.ts:1504-1512`) picks invoice-first from
  the service mode (`serviceContext?.serviceMode ?? cfg.orderFlow`). `readOutstandingSaleForOrder`
  (`till-sale.ts:711-731`) already decides by whether a `sales` row exists.
- **Money on a bill.**
  - `refuseBillWithPayments` (`bill-payments.ts:440-455`) refuses any pending or received payment
    row, even one refunded in full.
  - A card retry is found by bill and submission id (`findSubmission`, `bill-payments.ts:904-929`).
  - A payment's `working_order_id` is frozen by a trigger
    (`packages/db/drizzle/0024_bill_payment_triggers.sql:22`).
- **The service area** is `order_service_contexts` (`packages/venue-service/src/schema/service.ts:246-278`).
  - `retargetOrderContext` refuses an order that has none (`order.service_context_missing`,
    `packages/venue-service/src/operations.ts:693-719`).
  - A counter order takes the zone the till sends when it parks (`parkOrder`,
    `working-order.ts:933-969`, `req.zoneId`).
- **Nothing changes an existing order's `delivery_table_id`** (grep of `apps/server/src` for an
  update of it: none). Spec §8's "a deli order's delivery table changing" therefore has no path
  today; Task 7 is the first.
- **The till.**
  - The action menu is `#actionMenu`, with the verbs `move | join | merge | transfer | split`
    (`till-table-order-screen.ts:3060-3090`).
  - Targets come from `#freeTables` and `#otherTabs` (`:2854-2868`). A bill no table points at is
    never offered.
  - The handlers are `#onMoveTab`, `#onJoinTable`, `#onMergeTabs`, `#onTransferLines` and
    `#onSplitLines` (`apps/till/src/till-app.ts:3352-3439`).
  - The automatic merge-back (M7b3) is `#returnSplitCheck` and `#mergeCheckBack`
    (`till-app.ts:3528-3573`), with its state in `#splitCheck` and `#checkReturn` (`:839`, `:842`).
  - The refusals shown in their own words are in `TABLE_REFUSALS` (`till-app.ts:210-222`).
  - The client methods are `moveTab`, `joinTable`, `mergeTabs`, `transferLines` and `splitTab`
    (`apps/till/src/api/client.ts:2041-2110`). No client method calls unjoin.
  - The floor screen reads a table needing clearing from `table.visit?.state`
    (`till-floor-screen.ts:31-33`).

---
## The decisions this plan makes

The spec's §4 decisions are the owner's. The P-numbered decisions below are this plan's defaults.
Each PR that implements one names it, so the owner can overturn it at review. **P8, P16, P17, P19
and P28 read against wording in the spec or a queued item, or leave a known rough edge, and are
flagged for the owner in their PRs.**

- **P1. How the rename is done, and what keeps the word "visit" (Task 1).**
  - **What changes:**
    - tables, columns and index names;
    - drizzle's foreign-key names, which live only in its snapshot, because SQLite stores no
      foreign-key name;
    - the trigger `visits_clear_table_status`, which becomes `parties_clear_table_status`;
    - the routes `/api/visits/...`, which become `/api/parties/...`;
    - every identifier and file name, the till's string keys `visit.changed*`, and the DOM
      attribute `data-visit-outstanding`;
    - the error codes `visit.not_open`, `visit.out_of_date` and `visit.bill_outstanding`, which
      become `party.*`;
    - three more codes spelled with "visit": `tab.visit_mismatch` → `tab.party_mismatch`,
      `tab.visit_has_other_open_bill` → `tab.party_has_other_open_bill`, and
      `group.held_leaves_visit` → `group.held_leaves_party` (spec §10 names the last).
  - **How the migration is made.** The TypeScript schema changes. `drizzle-kit generate` runs under
    a pseudo-terminal that answers "rename", so the snapshot is generated rather than written by
    hand. **Then the generated `.sql` file is replaced by the hand-written rename** in Task 1 Step 5,
    because the generated one rebuilds seven tables and fails (measurement 2 above).
    - `scripts/migrations-match-schema.test.ts` compares the TypeScript with the snapshot and says
      in its header that an edited `.sql` is invisible to it. So the root guards that read the
      MIGRATED database, and a `sqlite_master` test, carry the proof.
    - This is the one place this plan edits a generated SQL file. The PR says why, with
      measurements 2 and 3.
  - **Kept until Task 13, whose rebuild renames them.** Renaming either needs a table rebuild, and
    Task 1 must not force a venue reset.
    - The four CHECK constraint names on `parties` (`visits_state_ck`, `visits_guest_count_ck`,
      `visits_closed_at_ck`, `visits_merged_into_ck`).
    - The stored scope value `'visit'` in `service_commands.scope_kind`, with its TypeScript literal
      (`CommandScope`'s `kind: "visit"`).
  - **Kept for good:**
    - the shipped migration files `0018_visits.sql`, `0019_settled_order_freeze_visit_id.sql` and
      `0020_visit_clears_table_status.sql`, their snapshots, and every older snapshot, because
      shipped migrations are never edited;
    - `docs/superpowers/` specs and plans, which are dated records;
    - the English word used for something else: see Task 1 Step 9's list.
- **P2. "Presented" means `status = 'placed'`.**
  - Spec §2 defines a presented bill by its invoice being issued before payment (invoice-first).
  - On `main` a `placed` bill is also a ticket-then-pay counter order: placed, with no invoice yet.
  - `working_orders_enforce_transition` and `working_order_lines_require_open_parent_update` freeze
    both kinds alike (read, `0019_…sql:9-31`). So no merge, split, transfer or new order can touch
    either, and the plan treats every placed bill as presented.
  - Collection is different: it asks whether an invoice exists (P22).
- **P3. "Untouched" means `status = 'open'` and no `bill_payments` row that is `pending` or
  `received`.** A payment later refunded in full still counts, as decision 5 says "has received any
  payment". That is exactly `refuseBillWithPayments` (`bill-payments.ts:440-455`), which the bill
  actions reuse. **The order of checks, and the code each gives, is fixed:**

  | The bill is | Code |
  | --- | --- |
  | `settled` | `bill.paid` (new) |
  | `abandoned` | `tab.not_open` (stays) |
  | `placed` | `bill.presented` (new) |
  | holding a payment | `bill.payments_received` (stays, now for either side) |

- **P4. The main bill is a column, kept honest by a trigger** (Task 2).
  - `parties.main_bill_id` is nullable and keyed to `working_orders`.
  - Two triggers on `working_orders` clear it. One fires when its bill leaves `open` (paid, placed or
    abandoned). The other fires when its bill's `party_id` changes. So every path that pays,
    presents, abandons or moves a bill keeps decision 15 without remembering to.
  - `partyMainBill` returns the main bill, or makes a new, empty one on the party when there is
    none. Only the order path calls it.
  - Paths that set the main bill: seating, Split a table, moving a bill to a free table, a merge
    whose merged-away bill was main, and combining parties (P12).
- **P5. New orders name their bill.** Group submission and draft submission take an optional
  `billId`.
  - When absent, the order goes to the main bill (P4).
  - When present, it must be an open bill of the same party, or it is refused: `bill.other_party`,
    `bill.presented`, `bill.paid` or `tab.not_open`.
  - Server side: Task 2. The till: Task 10.
- **P6. The party's name.**
  - `parties.name` is optional: trimmed, with an empty value stored as null, and at most 40
    characters (the plan's number). A longer value is `management.request_invalid`
    `{ field: "name" }`.
  - It is set by `PUT /api/parties/:id/name`, which takes `expectedPartyRevision`.
  - The display name is `name`, or else the tables' names joined by the spec §5 rule: labels that
    all share a first word are shortened ("Mesa 4, 5, 7"); otherwise they are listed in full ("Mesa
    4, Terraza 2"), in the order the tables joined.
  - Both rules are one pure function in `packages/shared/src/party-name.ts`, so the server, the
    reporting package and the till share it.
- **P7. Kitchen slips and the pass show the tables only, in the same form as the display name**
  ("Mesa 4, 7"), not the owner's "Mesa 4 + 7" example.
  - Spec §8 leaves the form to the plan and asks for it to match the party's default name.
  - The separator is one constant, `TABLE_SEPARATOR` in `party-name.ts`, so the owner can change it
    in one line.
  - Receipts show `name · tables` when the party has a name, otherwise the tables.
- **P8. A table's condition is derived, and "reserved" joins later without a column.**
  - `dining_tables.needs_cleaning_since` is a nullable timestamp.
  - `TableCondition = "free" | "held" | "needs_cleaning"` is computed in one function,
    `tableCondition`: held when an active `party_tables` row exists, else needs cleaning when the
    timestamp is set, else free.
  - A later "reserved" joins the union from the bookings module's own rows, so no table column is
    added now.
  - **The venue's clearing setting decides whether a table the guests leave needs cleaning**
    (owner ruling 3). That covers Finish, Move guests, and the tables a combining party leaves
    behind. `leaveForCleaning` (Task 3) sets `needs_cleaning_since` only when
    `VENUE_SERVICE.readClearingWorkflow(tx)` is true; with the setting off, the tables are free at
    once, as Finish frees them today. A venue with no settings row reads off.
- **P9. Mark cleared is per table, and doing it twice is harmless.**
  - The route is `POST /api/tables/:id/cleared`.
  - A table that does not need cleaning is left as it is, with a 204. It takes no revision: two
    devices clearing the same table both mean the same thing.
- **P10. The party state `needs_clearing` stops being written** in Task 3. Finish closes the party
  and marks its tables. The enum value is removed by Task 13's rebuild.
- **P11. Error codes** (spec §10). Before a venue is live a code is renamed or deleted in one change
  that moves every copy (CLAUDE.md §3).

  **New:**

  | Code | Params | When |
  | --- | --- | --- |
  | `bill.presented` | `{ workingOrderId }` | a merge, split, transfer or new order on a presented bill |
  | `bill.paid` | `{ workingOrderId }` | merging or moving a paid bill |
  | `bill.other_party` | `{ workingOrderId }` | merging or transferring between bills of two parties, or a counter order and a party |
  | `party.main_bill_stays` | `{ partyId }` | moving the main bill away while the party holds another unpaid bill, or choosing it for Split a table |
  | `table.needs_cleaning` | `{ tableId }` | seating, moving guests to or joining a table that needs cleaning |
  | `table.already_in_party` | `{ tableId }` | joining a table the party already holds, or moving guests to the party's only table |

  **Renamed** (Task 1): `visit.*` → `party.*`, plus the three codes listed in P1.

  **Reused with new params:**
  - `table.not_shared`: Split a table on the party's only table, `{ tableId, partyId }`;
  - `table.not_joined`: Split a table on a table outside the party, `{ tableId, partyId }`.

  **Stay:** `bill.payments_received`, `bill.line_paid`, `service_zone.join_mismatch`,
  `tab.split_held_line`, `tab.not_open`, `tab.merge_self`, `tab.transfer_self`, and
  `group.held_leaves_party`.

  **Go** (Task 13): `tab.merge_leaves_no_table`, `tab.party_has_other_open_bill`,
  `tab.not_table_tab`, `tab.party_mismatch` and `table.occupied`.
  - `service_zone.mode_incompatible` stops being thrown on bill moves, but stays registered:
    `openTab` still throws it for a table in a non-table zone (`working-order.ts:1002-1010`).
  - Every new code gets HTTP 409 in the `STATUS` map of `apps/server/src/till-api.ts`, and English
    and Spanish text in `apps/till/src/i18n/codes.ts`.
- **P12. The bill choice after combining.** Every route that combines parties, or moves a bill into
  a party, takes `bills: "merge" | "separate"`, defaulting to `"merge"`.
  - `"merge"` merges the incoming main bill (or the moved bill) into the receiving party's main
    bill, but only when both are untouched (P3). Otherwise both stay, and the answer says
    `merged: false`.
  - Main bill afterwards (decision 15): the receiving party's main bill if it can take orders; else
    the incoming main bill if IT can; else none, and the next order makes one.
  - "Can take orders" means open, whatever payments it holds. A partly paid open bill still takes
    orders, because nothing in spec §7 stops it.
- **P13. Combining parties moves the incoming party's open AND presented bills.** Its paid and
  abandoned bills stay on it and count through the family (`partyFamily`), as today. A presented bill
  can change party only after Task 7's trigger change, which is why combining parties lands in Task
  8.
- **P14. Two narrow trigger exceptions for a presented bill that moves** (Task 7).
  - **The bill's own row** (`working_orders_enforce_transition`): a `placed` row may stay `placed`
    while changing only `party_id`, `delivery_table_id` and `revision`. Every other column must be
    unchanged.
  - **Its lines' kitchen group** (`working_order_lines_require_open_parent_update`): an update of a
    line whose bill is `placed` is allowed when ONLY `group_id` changes. Every other column must be
    unchanged. Decided by the watcher on the owner's behalf: group membership is kitchen state, not
    invoice content.
    - Without it, a presented bill cannot leave a party or arrive in one. The line trigger (last
      written in `packages/db/drizzle/0027_line_vat_class_triggers.sql:14-22` on `f19768b3e`, and
      re-created by B9's `0033_line_served_exception.sql`) refuses any update to a line whose bill
      is not `open`. `clearGroups` (`working-order.ts:3140-3150`) updates every listed line, even
      one whose `group_id` is already null.
    - Measured by the plan review on `node:sqlite` (Node v26.7.0): a placed bill refused both a
      `clearGroups`-shaped update and a set-group update, and the control on an open bill passed.
      So Task 7 moving a presented bill out of a party, Task 8 Split a table choosing a placed bill,
      and Task 9's placed counter order would each fail with a raw engine error (a 500).
  - The price, quantity, VAT class and every other line value stay frozen, so a presented bill's
    contents do not change (spec §9).
- **P15. The service area of a moved bill** (spec §7).
  - An unpresented bill takes the receiving side's zone for everything added afterwards. The
    receiving side is:
    - a party: the zone of the party's earliest active table;
    - the counter: the zone the till sends, exactly as parking does.
  - The mechanism is `retargetOrderContext`, or `recordOrderContext` when the bill has none. A
    presented bill keeps its own.
  - Stored lines are never repriced, so each keeps its price and VAT class (decision 12).
  - No bill move refuses a mode mismatch.
  - Join still refuses tables in two zones (`service_zone.join_mismatch`).
  - Move guests to a held table in another zone is allowed, and the moving party's unpresented
    bills take the receiving party's zone. Spec §6 refuses different areas only for Join.
- **P16. Kitchen groups** (spec §7). **Flagged:** A96's default reads against spec §15's "leaves
  with them outside any group". The plan reads §15 as the leaving side (the old group) and applies
  A96 on the receiving side. The owner may rule that arriving dishes stay without a group; Task 9
  then does not land.
  - **Leaving a party** (Move a bill, Split a table):
    - a dish in a held group is refused with `group.held_leaves_party`, and nothing moves;
    - a sent dish leaves its group (`clearGroups`) and keeps its ticket state and served state.
  - **Combining parties** keeps whole groups (`moveGroupsToParty`).
  - **Arriving in a party** (Task 9, A96 re-scoped): the arriving bill's sent dishes with no group
    form ONE new fired group, and its unsent dishes with no group form ONE new held group. Both are
    appended after the party's last group, so the pass can mark them Ready and Away and the waiter
    can release the unsent ones.
- **P17. MOVED notices.** Before a table action, read the sent work of every bill of every party
  whose tables will change. Afterwards, call today's `enqueueMovedSlips` for each of those bills, and
  for the moved bill after a bill move. The per-bill label comparison stays, so only dishes whose
  destination changed get a notice (spec §8).
  - **One exception:** a move to or from the counter always tells the kitchen about the moved bill's
    sent dishes, through `enqueueMovedSlips(…, { force: true })`, because the label can read the
    same on both sides. P18 gives a bill moved to the counter its party's display name as its label.
  - **Flagged:** such a MOVED slip can read "Mesa 4 -> Mesa 4". Naming the counter on the slip needs
    a destination the kitchen ticket does not carry today (`kitchen-ticket.ts:244` prints two
    labels). The owner may want that as a follow-up.
- **P18. Counter orders.**
  - An open bill moved to the counter gets `label` set to its party's display name at the moment
    of the move, so the counter's held-order list names it. A presented bill keeps the label frozen
    at its issuance.
  - A bill moved into a party gets `delivery_table_id` cleared, because the party's tables are now
    where it goes.
- **P19. A card payment in flight does not stop a bill moving.**
  - Spec §7: "The bill keeps its id, so its payments, a pending card payment's retry, refunds and its
    invoice are untouched by the move".
  - **Flagged:** A82's text asked to refuse such a bill, and the spec supersedes it.
  - Merge, split and transfer keep refusing a bill with a payment (P3), which covers a pending one.
- **P20. Split a bill** starts from any open bill, including a counter order. The new bill copies the
  source's `party_id`, which is null for a counter order.
  - Held lines stay refused (`tab.split_held_line`, the owner's 2026-09-26 ruling).
  - A presented bill is `bill.presented`.
  - Paid items stay where they are (`bill.line_paid`, as today).
- **P21. Merge and Transfer** stay inside one party, between untouched bills (P3). Lines keep their
  groups, because the party is the same, and are never repriced.
  - Merge moves every line into the bill merged into and abandons the other.
  - If the merged-away bill was the main bill, the surviving bill becomes main.
  - Neither action touches a table.
- **P22. Collection asks whether an invoice exists** (Task 6). `collectOrder` settles the issued
  invoice when a `sales` row names the bill, and otherwise issues one, whatever the bill's zone now
  says.
- **P23. Move guests to a table of the party itself** is allowed when the party holds other tables
  (they leave). It is `table.already_in_party` when that is the party's only table. Joining a table
  the party holds is `table.already_in_party`.
- **P24. Split a table.**
  - The new party has no name, so it is named after its table (decision 3).
  - The chosen bill must be one of the party's bills that is open or placed, and not its main bill.
    Choosing the main bill is `party.main_bill_stays`.
  - With no bill chosen, the new party gets an empty main bill at once, as seating does.
- **P25. A main bill moves away only when it is the party's last unpaid bill** (spec §13 item 5).
  Otherwise the move is `party.main_bill_stays`. When it does move, the trigger (P4) clears the main
  bill.
- **P26. Old routes stay until Task 13.** Each new route is a new function. Tasks 2 to 4 change the
  old functions only where the new model requires it, and say which.
- **P27. Revisions, and no submission ids** (the service plan's D19). A table or bill action checks
  and moves on the revision of every party it touches:
  - `expectedPartyRevision` for the party in the path, or the moved bill's party;
  - `expectedOtherPartyRevision` for the party holding the target table, or the receiving party.

  A revision is required exactly when that party exists. Like today's tab routes, these actions
  carry no submission id: a retry whose first try committed meets `party.out_of_date`, and the till
  reloads.

  **Order of checks, in every table and bill action:**
  1. resolve the path's party: the bill's `party_id` for a bill action, the path party for a table
     action;
  2. `checkAndBumpParty`, giving `party.not_open` first, then `party.out_of_date`;
  3. the other party's revision, when there is one;
  4. only then the bills' and tables' own state.

  So the second of two tills acting from one read is always refused `party.out_of_date`, whichever
  ran first. It is never `tab.not_open`, `bill.other_party` or `bill.presented`, which it would meet
  if the bill checks came first.
  - A merge checks the revision of the party of the bill merged INTO. Both bills must be of that one
    party.
  - A bill action may also send `partyId`: the party the till read the path bill under. When the
    bill has since left that party, the answer is `party.out_of_date` even if the revision number
    happens to match its new party's.
- **P28. Task 13 needs every venue reset** (measurement 5).
  - Every dev venue that has ever seated a party runs `wa-wt reset demo <name>`.
  - The owner's box is wiped once, as menus Task 3 needed (`docs/backlog.md`, the paragraph opening
    "Classification Task 3 has landed").
  - **Flagged:** the alternative, if the owner refuses the reset, is to keep `tab_id`,
    `needs_clearing` and the two naming survivors as unused leftovers, and drop Task 13's schema
    half. The PR is labelled `needs-owner-review`, and the owner lands it.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Read `CLAUDE.md` first.** §1 (writing claims), §2 (the gate), §3 (conventions), §4 (testing)
  and §5 (fiscal invariants) apply to every task. Read the topic file for the area before touching
  it:
  - `docs/developers/conventions-data.md` for schema, migrations and error codes;
  - `docs/developers/conventions-ui.md` and `design-system.md` for screens;
  - `docs/developers/testing-guide.md` for any database or browser test.
- **Step 0 of every task: re-map.** Read the files the task names on the `main` it starts from, and
  write down in the task's ledger (`docs/handoffs/`) each "today" fact this plan states that no
  longer holds, and what replaced it. Follow the landed code. If the difference changes an owner
  decision (spec §4), stop: write the question in the lane's `questions.md` with a recommended
  default, and mark the task `blocked`.
- **Worktree, never `main`.** Create it with
  `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`, where the branch is in
  the table above. One pull request per task, which must leave `main` green and working on its own.
- **Every commit needs `git commit -s`.** Commit messages and PR text are in plain English. Exact
  file, function and error-code names appear once as pointers, and a command that was run goes in
  verbatim.
- **TDD, always.** Write the failing test first, watch it fail for the right reason, then write the
  minimal code. Product fixtures give the staff, customer and kitchen names three DIFFERENT texts
  (`docs/developers/products.md`).
- **Test databases come from `useVenueDb`.** Rejected writes assert the domain error CODE, never
  `toBeInstanceOf(Error)`.
- **Every action's test reads the state back, not only the response** (spec §15):
  - the tables (`dining_tables`: condition, status, and `tab_id` while it exists);
  - the memberships (`party_tables`);
  - the parties (`name`, `main_bill_id`, `state`, `merged_into_party_id`, `revision`);
  - the bills (`status`, `party_id`, lines with price and VAT class, payments, service zone).
- **Every refusal asserts its own code AND reads back that nothing changed:** the same party
  revision and the same rows as before.
- **"Two tills at once" is two orders of events, run one after the other** (the service plan's
  Global Constraints). `withTransaction` IS the venue file's write lock (CLAUDE.md §3), so two
  requests always run in some order. Each such test runs both orders as sequential calls: the first
  succeeds, and the second, carrying the revision read before the first, is refused
  `party.out_of_date` and writes nothing.
- **An owner-decided behaviour change changes the tests that pinned the old behaviour.** Name each
  such test in the PR, with the decision that retires it. Preserve every other behavioural
  assertion.
- **Migrations:**
  - Generate with `pnpm --filter @waitron/db db:generate`. A rename needs the pseudo-terminal
    driver of Task 1 Step 4. **Check the file it wrote, never its exit status** (measurement 1).
  - Never hand-edit a snapshot or `_journal.json`. P1 is the one allowed hand edit of a generated
    `.sql`.
  - A trigger change is a custom migration (`pnpm --filter @waitron/db db:generate:custom`) that
    drops and re-creates the trigger.
  - READ every generated SQL file. An unexpected `__new_` rebuild is a STOP, except the one Task 13
    is written for.
  - **Every column added to `working_orders` joins the column list of
    `working_orders_enforce_transition`** (CLAUDE.md §3). This plan adds none. Task 7 changes the
    trigger's placed rule, and nothing else in it.
  - Run the root guards, and the package's own migration and schema tests:
    `scripts/schema-constraints.test.ts`, `scripts/migrations-match-schema.test.ts`,
    `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`,
    `scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts`,
    `scripts/module-graph-honesty.test.ts`, `scripts/journal-monotonic.test.ts` and
    `scripts/migration-upgrade.test.ts`. The command is
    `pnpm exec vitest run scripts/<file>` from the repository root.
  - Measure the upgrade on a seeded scratch venue (`wa-wt demo <worktree>` started on the previous
    `main`'s venue folder, then on this branch), and state it in the PR and the backlog.
- **Queries on one transaction are awaited in turn, never `Promise.all`.** A route opens one
  `withTransaction`.
- **A test reads what it needs BEFORE opening a transaction.** For example, it reads the party
  revision it sends before calling `inTx`. A `withTransaction` started inside a running body is
  refused with "write lock: a body asked for the lock it is already holding"
  (`packages/store/src/write-queue.ts`, `enqueue`; read, not run).
- **Money is whole cents at the row** (`packages/shared/src/cents.ts`). No bill action reprices a
  line.
- **The fiscal fingerprint is unrecoverable** (CLAUDE.md §5). The golden huella gate
  (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` pass UNEDITED in
  every task. If they cannot, STOP and mark the task blocked.
- **Nothing external may block a sale** (CLAUDE.md §5). A print failure never refuses an action.
- **Screens:**
  - They follow `docs/developers/design-system.md`, with `--wt-*` tokens only.
  - Every action shows its scope before it acts, for example "Move Ana (Mesa 4, 5) to Mesa 9".
  - Every new dialog has an axe test in both themes.
  - Open every changed screen and LOOK in English and Spanish, light and dark, at 390 px and at
    1280 px, sizing through `page.viewport(w, h)` (`docs/developers/testing-guide.md`: a width set
    with `commands.setViewportSize` is not the width rendered). Put the `window.innerWidth` you read
    in the PR.
- **Write boundaries, not only disabled buttons** (the service plan's Global Constraints). Every
  refusal a screen shows is also refused by the server, and a server test drives it directly.
- **Strings:** every till string goes in both `en` and `es` of `apps/till/src/i18n/strings.ts`, and
  every code's wording in `apps/till/src/i18n/codes.ts`.
- **Browser runs:** check `memory_pressure | grep free` and `ps -axo rss,command | sort -nr | head`
  first, and never start one beside a backgrounded whole-workspace coverage run (CLAUDE.md §2).
- **The gate per task:** focused behavioural tests while implementing, then `/finish-branch`. It
  lets the pre-push hook run once and watches CI. Read CI's `changes` job scope on the current head
  before calling the branch green.
- **Update `docs/backlog.md` in the same change that makes it stale.**

**Review paths.**
- **Full review wave**, because each touches a risk trigger: Tasks 1, 2, 3, 13 (migrations), 4
  (cross-package: `packages/reporting`, `packages/shared`), 5, 7 and 8 (money and concurrency), 6
  (fiscal collection), 9 (kitchen state across parties, and concurrency), and 12 (the till moving
  bills that hold money: A81 and A82 were full-review items).
- **Light path:** Tasks 10 and 11. They are the till only, consuming server contracts that Tasks 5
  and 8 landed and tested. The two seats that run on every branch still run: the plan-versus-spec
  read and the Codex run-it seat.

---

## Review Focus

These are the conditions most likely to bite a person that the spec implies but no task would test
by default. Each has its test in the named task.

1. **A card payment is still at the reader when its bill is moved to another party or to the
   counter.** The reader then answers. The payment completes on the same bill, and the bill's invoice
   is issued once it is fully paid, wherever the bill now is. A retry of the payment with the same
   submission id returns the first result (Task 7).
2. **The guests take their only unpaid bill to the counter.** After the party's main bill (its last
   unpaid one) moves to the counter, Finish on the party succeeds and its tables follow P8. The
   counter bill still takes payment and issues one invoice (Task 7).
3. **A till acts on a party another till has just combined away.** The absorbed party is closed.
   Any action on it is `party.not_open` (checked before the revision), and nothing is written
   (Task 8).
4. **Split a table picks a bill holding a held group,** at a table with a manual service status.
   The split is refused with `group.held_leaves_party`, and the tables, memberships, status, parties
   and bills are unchanged (Task 8).
5. **A presented bill named as the target of new orders,** whether chosen in a draft or after it
   moved to another party, is refused with `bill.presented`, and no line is written (Tasks 2 and 7).

---
## Task 1: Rename "visit" to "party", with no behaviour change — slug `party-rename`

Spec decision 14, §12 ("First, the rename … as its own mechanical change … No behaviour changes");
P1, P11. Branch `refactor/party-rename`. Full review wave (a migration, and a contract across
packages: `packages/module`'s `seatTable` answer and every route path the till calls).

The inventory below was taken on `main` at `f19768b3e` (a read-only sweep with
`git grep -n -i visit`). B9 adds more. Step 0 retakes it.

**Files:**
- Rename (with `git mv`, so the history follows):
  - `apps/server/src/visits.ts` → `parties.ts`
  - `apps/server/src/visits.test.ts` → `parties.test.ts`
  - `apps/server/src/till-api.visits.test.ts` → `till-api.parties.test.ts`
  - `apps/till/src/till-app-visits.test.ts` → `till-app-parties.test.ts`
  - `apps/till/src/screens/till-floor-screen.visits.test.ts` → `till-floor-screen.parties.test.ts`
  - `apps/till/src/screens/till-table-order-screen.visits.test.ts` → `till-table-order-screen.parties.test.ts`
  - `packages/db/src/schema/visits.ts` → `parties.ts`
  - `packages/db/src/schema/visits.test.ts` → `parties.test.ts`
- Create: one core migration, `packages/db/drizzle/00NN_party_rename.sql`. NN is the next free
  number after B9; B9's branch ends at `0034`. Its snapshot and journal entry come from drizzle-kit
  (Step 4).
- Modify, schema:
  - `packages/db/src/schema/parties.ts`, `orders.ts`, `order-groups.ts`, `order-drafts.ts` and
    `index.ts`
  - `packages/db/src/index.ts` (`:78-81`)
  - `packages/db/src/classification.ts` (`:111`, `:113`, `:120`)
  - `packages/db/README.md` (`:80-82`)
- Modify, server:
  - `apps/server/src/working-order.ts`, `order-groups.ts`, `order-drafts.ts`, `kitchen-print.ts`,
    `till-api.ts`, `errors.ts`, `bill-payments.ts`, `bill-refunds.ts` and `boot.ts`
  - every `apps/server/src/*.test.ts` the Step 0 grep lists
- Modify, other packages:
  - `packages/module/src/module.ts:21-25` (`seatTable` answers `partyId`)
  - `packages/bookings/src/testing/fake-core.ts:1,4,59`
- Modify, the till:
  - `apps/till/src/api/client.ts`, `till-app.ts` and `i18n/codes.ts`
  - `i18n/strings.ts` (keys `visit.changed*` and `visit.try_again`, at `:490-495` and `:989-994`)
  - `state/draft-sync.ts`, `widgets/station-queue.ts`, `widgets/card-grid.ts`,
    `screens/till-table-order-screen.ts`, `screens/till-floor-screen.ts`,
    `screens/till-expo-screen.ts` and `screens/till-station-screen.ts`
  - every till test the grep lists, and `widgets/test-helpers.ts`
- Modify, root guards: `scripts/behavioural-triggers.test.ts` and `scripts/schema-constraints.test.ts`.
- Modify, docs: `docs/backlog.md` (its 28 domain lines), `docs/developers/modifiers.md:139,145,151`
  (route paths), and `CLAUDE.md` wherever it names a renamed code or table. Run
  `git grep -n -i 'visit' CLAUDE.md` to find them.

**Interfaces:**
- Consumes: nothing new.
- Produces (every later task uses these names):
  ```ts
  // packages/db/src/schema/parties.ts
  export const partyState: EnumType<["open", "needs_clearing", "closed"]>;
  export const parties: SQLiteTable; // "parties": id, guest_count, state, opened_at, opened_by,
  //   closed_at, closed_by, merged_into_party_id, bill_requested_at, revision
  export const partyTables: SQLiteTable; // "party_tables": id, party_id, table_id, joined_at, left_at
  export const serviceCommandScope: EnumType<["visit", "bill"]>; // stored value kept until Task 13 (P1)
  // working_orders.party_id, order_groups.party_id, order_group_events.party_id, order_drafts.party_id

  // apps/server/src/parties.ts (was visits.ts)
  export interface PartyBill { workingOrderId: string; partyId: string; label: string | null; status: "open" | "placed" | "settled" | "abandoned"; total: string; outstanding: string; receiptAvailable: boolean }
  export type CommandScope = { kind: "visit"; partyId: string } | { kind: "bill"; workingOrderId: string };
  export interface PartyCommand { expectedPartyRevision?: number; expectedSourcePartyRevision?: number; operatorId: string }
  export async function seatTable(tx, cfg, args: { tableId: string; guestCount: number | null; operatorId: string }): Promise<{ partyId: string; tabId: string; revision: number; orderNumber: number }>;
  export async function openParty(tx, args: { guestCount: number | null; operatorId: string; tableId: string }): Promise<{ partyId: string; revision: number }>;
  export async function partyOfOrder(tx, orderId: string): Promise<string | null>;
  export async function partyRevisionOfOrder(tx, orderId: string): Promise<{ id: string; revision: number } | null>;
  export async function memberTables(tx, partyId: string): Promise<string[]>;
  export async function leaveTables(tx, tableIds: readonly string[], at?: string): Promise<void>;
  export async function tableHeld(tx, tableId: string): Promise<boolean>;
  export async function guardParties(tx, destination: string | null, source: string | null, command: Omit<PartyCommand, "operatorId"> | undefined): Promise<void>;
  export async function checkAndBumpParty(tx, partyId: string, expectedPartyRevision: number, requiredState: "open" | "needs_clearing"): Promise<number>; // party.not_open, party.out_of_date
  export async function bumpPartyRevision(tx, partyId: string): Promise<void>;
  export async function partyFamily(tx, partyId: string): Promise<string[]>;
  export async function partyFamilies(tx, partyIds: readonly string[]): Promise<Map<string, string[]>>;
  export async function requireOpenParty(tx, partyId: string): Promise<void>;
  export async function readPartyBills(tx, partyId: string): Promise<PartyBill[]>;
  export async function readBillsOfParties(tx, partyIds: readonly string[]): Promise<Map<string, Omit<PartyBill, "receiptAvailable">[]>>;
  export async function finishTable(tx, args: { partyId: string; expectedPartyRevision: number; operatorId: string }): Promise<{ state: "closed" | "needs_clearing" }>;
  export async function markCleared(tx, args: { partyId: string; expectedPartyRevision: number }): Promise<void>;
  export function fingerprint(args: Record<string, unknown>): string; // NOT_FINGERPRINTED gains "expectedPartyRevision", loses "expectedVisitRevision"
  export async function runServiceCommand<R>(tx, scope: CommandScope, submissionId: string, kind: string, args: Record<string, unknown>, run: () => Promise<R>): Promise<R>;

  // apps/server/src/order-groups.ts
  export async function partyTab(tx, partyId: string): Promise<string>; // was visitTab; replaced by Task 2
  export async function moveGroupsToParty(tx, fromPartyId: string, intoPartyId: string): Promise<void>;
  export interface PartyCommandArgs { submissionId: string; expectedPartyRevision: number; operatorId: string } // was VisitCommandArgs
  // apps/server/src/order-drafts.ts
  export async function moveDraftsToParty(tx, fromPartyId: string, intoPartyId: string, operatorId?: string): Promise<void>;
  export async function discardPartyDrafts(tx, partyId: string, operatorId: string): Promise<void>;
  // apps/server/src/working-order.ts
  export interface TableParty { id: string; revision: number; guestCount: number | null; state: "open" | "needs_clearing" | "closed"; outstanding: string; billCount: number; tableIds: string[]; unsentDrafts: UnsentDraft[] } // was TableVisit
  // TableState.party (was .visit); ExpoOrder.party and StationQueueGroup.party (was .visit); QueueParty (was QueueVisit)

  // wire: POST /api/parties/:id/finish { expectedPartyRevision }, POST /api/parties/:id/cleared { expectedPartyRevision },
  //       GET /api/parties/:id/bills, and every /api/visits/:id/{groups,drafts,print-problems,…} route as /api/parties/:id/…
  //       tab routes take expectedPartyRevision / expectedSourcePartyRevision
  // codes: party.not_open, party.out_of_date, party.bill_outstanding, tab.party_mismatch,
  //        tab.party_has_other_open_bill, group.held_leaves_party
  // packages/module: CoreServices.seatTable → Promise<{ tabId: string; partyId: string }>

  // apps/till/src/api/client.ts
  export interface TableParty {…}  export interface PartyBill {…}
  export interface PartyRevisions { expectedPartyRevision?: number; expectedSourcePartyRevision?: number }
  // TableState.party, SeatResult.partyId, Draft.partyId; methods getPartyBills(partyId), finishTable(partyId, expectedPartyRevision), …
  ```

- [ ] **Step 0: Re-map.** On the `main` you start from, with B9 landed, run each of these and save
  the output to the ledger:
  ```bash
  git grep -n -i visit -- ':!pnpm-lock.yaml' ':!packages/db/drizzle/meta' ':!docs/superpowers' | wc -l
  git grep -l -i visit -- ':!pnpm-lock.yaml' ':!packages/db/drizzle/meta' ':!docs/superpowers'
  git grep -n -o -h -E '"(visit|tab\.visit|group\.held_leaves_visit)[a-z_.]*"' -- apps packages scripts | sort | uniq -c
  git grep -n '/api/visits' -- apps packages docs/developers | wc -l
  ```
  On `f19768b3e`, before B9, the first two commands gave 4,165 lines in 112 files (re-run
  2026-09-28). The read-only sweep this plan was written from used a wider pattern: 119 files, of
  which 88 are the domain concept, 31 use the ordinary English word, and 5 mix the two. Step 9 lists
  the English uses. Then list the index and trigger names on a migrated database:
  ```bash
  cd packages/db && pnpm exec vitest run src/schema/visits.test.ts
  ```
  This must pass, as a baseline. Then read `packages/db/drizzle/*.sql` for every `CREATE INDEX` and
  `CREATE TRIGGER` whose name or body says `visit`, B9's migrations included, and list them in the
  ledger. Step 5's SQL must drop and re-create each index named after visits, and re-create each
  trigger named after them.

- [ ] **Step 1: Write the failing tests.**

  In `packages/db/src/schema/parties.test.ts` (after the `git mv`), change the imports and the
  `describe` title to the new names. Add:
  ```ts
  it("names visit, on the migrated database, only in the two objects Task 13 renames", () => {
    const named = suite.db.all<{ type: string; name: string }>(sql`
      select type, name from sqlite_master
      where lower(name) like '%visit%' or lower(sql) like '%visit%'
      order by name
    `);
    // `parties` keeps its four CHECK constraint names and `service_commands` its stored scope
    // value 'visit' until Task 13's rebuild (plan P1).
    expect(named).toEqual([
      { type: "table", name: "parties" },
      { type: "table", name: "service_commands" },
    ]);
  });
  ```
  The existing case "refuses a second ACTIVE membership for one table by the partial unique index"
  (`packages/db/src/schema/visits.test.ts:78-91` on `f19768b3e`) becomes the rename's check of the
  index. Rename its `visitTables`, `visitId` and `table: "visit_tables"` to the new names, and it
  fails until Step 2.

  In `apps/till/src/i18n/codes.test.ts`, change the list at `:161` to
  `["tab.not_table_tab", "tab.party_mismatch", "tab.party_has_other_open_bill"]`. Add:
  ```ts
  it.each(["party.not_open", "party.out_of_date", "party.bill_outstanding", "group.held_leaves_party"])(
    "has English and Spanish wording for %s",
    (code) => {
      expect(codeMessage(code, "en")).not.toBe(codeMessage("server.internal", "en"));
      expect(codeMessage(code, "es")).not.toBe(codeMessage("server.internal", "es"));
    },
  );
  ```
  In `apps/server/src/till-api.parties.test.ts`, change every request path from `/api/visits/` to
  `/api/parties/`, and every body key from `expectedVisitRevision` to `expectedPartyRevision`.

  Run them:
  ```bash
  cd packages/db && pnpm exec vitest run src/schema/parties.test.ts
  cd apps/till && pnpm exec vitest run src/i18n/codes.test.ts
  cd apps/server && pnpm exec vitest run src/till-api.parties.test.ts
  ```
  Expected: FAIL. `parties` is not exported. The till prints the `server.internal` sentence for
  `party.not_open`. The server answers 404 for `/api/parties/…`.

- [ ] **Step 2: Rename the schema in TypeScript.** In `packages/db/src/schema/parties.ts`,
  `orders.ts`, `order-groups.ts` and `order-drafts.ts`:
  - table names `"visits"` → `"parties"` and `"visit_tables"` → `"party_tables"`;
  - columns `id("visit_id")` → `id("party_id")` and `id("merged_into_visit_id")` →
    `id("merged_into_party_id")`;
  - every `index(…)` and `uniqueIndex(…)` name containing `visit` → `party` (for example
    `visits_merged_into_idx` → `parties_merged_into_idx`, `visit_tables_active_table_uq` →
    `party_tables_active_table_uq`, `working_orders_visit_idx` → `working_orders_party_idx`);
  - every `foreignKey({ name })` containing `visit` → `party`;
  - the TypeScript names: `visits` → `parties`, `visitTables` → `partyTables`, `visitState` →
    `partyState`, `visitId` → `partyId`, `mergedIntoVisitId` → `mergedIntoPartyId`.

  **Leave** the four `check("visits_…_ck", …)` names and `serviceCommandScope = enumType(["visit",
  "bill"])` as they are (P1). Update the doc comments that name the old tables, and delete any whose
  only content is history (CLAUDE.md §1, the comment rule).

- [ ] **Step 3: Rename `classify("visits", …)` and `classify("visit_tables", …)`** in
  `packages/db/src/classification.ts` to the new names. Rename the exports in
  `packages/db/src/index.ts` and `schema/index.ts`.

- [ ] **Step 4: Generate the snapshot through a pseudo-terminal.** Save this driver OUTSIDE the
  worktree, in the scratchpad directory. It is not committed.
  ```python
  # rename-driver.py — run drizzle-kit generate, answering "rename" to every create-or-rename prompt.
  import os, pty, re, select, sys, time
  cwd = sys.argv[1]
  pid, fd = pty.fork()
  if pid == 0:
      os.chdir(cwd)
      os.execv("./node_modules/.bin/drizzle-kit", ["drizzle-kit", "generate", "--name=party_rename"])
  buf, answered, deadline = b"", 0, time.time() + 180
  while time.time() < deadline:
      ready, _, _ = select.select([fd], [], [], 2.0)
      if ready:
          try:
              chunk = os.read(fd, 65536)
          except OSError:
              break
          if not chunk:
              break
          buf += chunk
      text = re.sub(rb"\x1b\[[0-9;?]*[A-Za-z]", b"", buf).decode("utf8", "replace")
      asked = [m.start() for m in re.finditer(r"created or renamed from another", text)]
      if len(asked) > answered and "rename" in text[asked[-1]:]:
          time.sleep(0.5)
          os.write(fd, b"\x1b[B")  # the second option is "~ old › new rename"
          time.sleep(0.3)
          os.write(fd, b"\r")
          answered += 1
      if "Your SQL migration file" in text or "No schema changes" in text:
          time.sleep(1)
          break
  print("answered", answered)
  print(text[-2000:])
  ```
  Run it:
  ```bash
  python3 "$SCRATCH/rename-driver.py" "$(git rev-parse --show-toplevel)/packages/db"
  ls packages/db/drizzle/*_party_rename.sql packages/db/drizzle/meta/_journal.json
  git diff --stat -- packages/db/drizzle/meta/_journal.json
  ```
  **The answers must all be renames.** Read the printed transcript and check that every
  `❯` choice line it answered reads `~ … › … rename`.
  - On `f19768b3e` the scratch run answered 17 prompts, some of them asked more than once.
  - **Check the renames drizzle-kit recorded, not the table names.** The new snapshot's tables come
    from the TypeScript whatever was answered, so a grep for `"visits"` in it prints `0` either way.
    What the answers change is the snapshot's `_meta`:
    ```bash
    python3 -c "import json,sys; m=json.load(open(sys.argv[1]))['_meta']; print(json.dumps(m, indent=1))" packages/db/drizzle/meta/00NN_snapshot.json
    ```
    Expected:
    - `tables` maps `"visits"` → `"parties"` and `"visit_tables"` → `"party_tables"`;
    - `columns` has six entries: `visit_id` → `party_id` on `party_tables`, `working_orders`,
      `order_groups`, `order_group_events` and `order_drafts`, and
      `"parties"."merged_into_visit_id"` → `"parties"."merged_into_party_id"`.
    - **Measured:** one scratch run on `f19768b3e` recorded only five columns. The
      `merged_into_visit_id` entry was missing, which is exactly the case this check catches.
      Re-run the driver until all six are there.

  Expected: a new `00NN_party_rename.sql`, a new `meta/00NN_snapshot.json`, and one new journal
  entry. **The exit status says nothing** (measurement 1); these three files are the check.

- [ ] **Step 5: Replace the generated SQL with the rename.** Read the generated file first: it
  rebuilds tables (`__new_parties`, `__new_working_orders`, …). Measurement 2 is why it cannot ship.
  Write this in its place. Add a drop-and-create pair for any index or trigger named after visits
  that Step 0 found beyond these; on `f19768b3e` this is the complete list.
  ```sql
  -- The rename of visits to parties. A hand-written rename, because drizzle-kit's generated one
  -- rebuilds every table whose foreign key names the renamed one, and that fails on a fresh database.
  -- SQLite's RENAME rewrites the foreign keys, the CHECK bodies and the trigger bodies that name
  -- what it renames. The CHECK constraint names and the stored scope value 'visit' stay until a
  -- rebuild of those two tables.
  DROP TRIGGER visits_clear_table_status;--> statement-breakpoint
  ALTER TABLE `visits` RENAME TO `parties`;--> statement-breakpoint
  ALTER TABLE `visit_tables` RENAME TO `party_tables`;--> statement-breakpoint
  ALTER TABLE `parties` RENAME COLUMN `merged_into_visit_id` TO `merged_into_party_id`;--> statement-breakpoint
  ALTER TABLE `party_tables` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
  ALTER TABLE `working_orders` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
  ALTER TABLE `order_groups` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
  ALTER TABLE `order_group_events` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
  ALTER TABLE `order_drafts` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
  DROP INDEX `visits_merged_into_idx`;--> statement-breakpoint
  CREATE INDEX `parties_merged_into_idx` ON `parties` (`merged_into_party_id`);--> statement-breakpoint
  DROP INDEX `visit_tables_active_table_uq`;--> statement-breakpoint
  CREATE UNIQUE INDEX `party_tables_active_table_uq` ON `party_tables` (`table_id`) WHERE "party_tables"."left_at" is null;--> statement-breakpoint
  DROP INDEX `visit_tables_visit_idx`;--> statement-breakpoint
  CREATE INDEX `party_tables_party_idx` ON `party_tables` (`party_id`);--> statement-breakpoint
  DROP INDEX `working_orders_visit_idx`;--> statement-breakpoint
  CREATE INDEX `working_orders_party_idx` ON `working_orders` (`party_id`);--> statement-breakpoint
  DROP INDEX `order_groups_visit_idx`;--> statement-breakpoint
  CREATE INDEX `order_groups_party_idx` ON `order_groups` (`party_id`);--> statement-breakpoint
  DROP INDEX `order_group_events_visit_idx`;--> statement-breakpoint
  CREATE INDEX `order_group_events_party_idx` ON `order_group_events` (`party_id`);--> statement-breakpoint
  DROP INDEX `order_drafts_visit_idx`;--> statement-breakpoint
  CREATE INDEX `order_drafts_party_idx` ON `order_drafts` (`party_id`);--> statement-breakpoint
  DROP INDEX `order_drafts_open_owner_uq`;--> statement-breakpoint
  CREATE UNIQUE INDEX `order_drafts_open_owner_uq` ON `order_drafts` (`party_id`,`owner_id`) WHERE "order_drafts"."state" = 'open';--> statement-breakpoint
  CREATE TRIGGER parties_clear_table_status
  AFTER UPDATE ON parties
  FOR EACH ROW
  WHEN old.state = 'open' AND new.state <> 'open'
  BEGIN
    UPDATE dining_tables SET status_id = NULL
     WHERE id IN (
       SELECT table_id FROM party_tables WHERE party_id = new.id AND left_at IS NULL
     );
  END;
  ```
  Each `CREATE INDEX` must match the generated snapshot's index exactly: its columns and its `WHERE`.
  Read them from `meta/00NN_snapshot.json`. The last pair re-creates `order_drafts_open_owner_uq`
  only so that its `WHERE` names the renamed column the way drizzle writes it. SQLite rewrote it
  anyway in the scratch run, so if the snapshot's text matches the rewritten index, delete that
  pair. Check with
  `select sql from sqlite_master where name = 'order_drafts_open_owner_uq'` after Step 6.

- [ ] **Step 6: Run the database tests and the guards that read the migrated database.**
  ```bash
  cd packages/db && pnpm exec vitest run src/schema/parties.test.ts src/schema/order-groups.test.ts src/schema/order-drafts.test.ts
  cd ../.. && pnpm exec vitest run scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts scripts/behavioural-triggers.test.ts scripts/append-only-triggers.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/module-graph-honesty.test.ts scripts/journal-monotonic.test.ts
  ```
  First update `scripts/behavioural-triggers.test.ts` (`:46-48`, `:103-104`, `:129`, `:227-247`,
  `:284`, `:308-322`, `:543-550` and `describe("visits_clear_table_status")` at `:688-710`) and
  `scripts/schema-constraints.test.ts` (`:121-124`, `:210-212`, `:229`, `:316`) to the new table,
  column, index and trigger names. Keep the CHECK names `visits_*_ck` at `:508-511` and the scope
  constraint at `:477`.

  Expected: PASS, and the `sqlite_master` test of Step 1 passes.
  - If `migrations-match-schema` reports `changed: meta/…`, the snapshot and the TypeScript
    disagree. Regenerate (Step 4); never edit the snapshot.
  - If `migration-upgrade` fails at the new file, read its message. An index or trigger naming a
    renamed column that Step 5 missed shows as `no such column`.

- [ ] **Step 6a: If a rebase meets a migration-number collision** (lane B or lane C landed a core
  migration first):
  1. Reset `packages/db/drizzle/` to `main`'s state, as CLAUDE.md §3 says. That removes this
     branch's rename migration, its snapshot and its journal entry.
  2. Re-run the Step 4 driver. Check `_meta` as Step 4 says.
  3. **Replace the new `.sql` with Step 5's hand-written rename again,** adding any index or trigger
     the newly landed migrations named after visits.
  4. Re-run Step 6.

  A plain regeneration that is not followed by step 3 ships drizzle's rebuild SQL, which fails on a
  fresh database (measurement 2). Never ship it.

- [ ] **Step 7: Rename the server.**
  - Do the `git mv`s, then rename every identifier from the Interfaces list in
    `apps/server/src/**` and every call site.
  - In `till-api.ts`:
    - route paths `/api/visits/` → `/api/parties/`;
    - `requireVisitParam` → `requirePartyParam`, `visitCommand` → `partyCommand`,
      `crossesVisits` → `crossesParties`;
    - the `STATUS` entries (`:334-358`) to the new codes;
    - the body fields `expectedVisitRevision` → `expectedPartyRevision` and
      `expectedSourceVisitRevision` → `expectedSourcePartyRevision`, including in `requireRevision`'s
      field union (`:440-444`).
  - In `errors.ts` (`:314`, `:320`, `:325`, `:360`, `:514`, `:519`), rename the six codes and their
    params (`visitId` → `partyId`).
  - In `parties.ts`, `NOT_FINGERPRINTED` swaps `expectedVisitRevision` for `expectedPartyRevision`.
  - Rename the call sites passing `{ kind: "visit", visitId }` to `{ kind: "visit", partyId }`,
    keeping the literal (P1). They are `order-groups.ts:97,216,289,428,490` and
    `order-drafts.ts:281` on `f19768b3e`.
  - `packages/module/src/module.ts`: `seatTable` answers `{ tabId, partyId }`. Update
    `packages/bookings/src/testing/fake-core.ts` to match.

  Two names would collide:
  - `apps/server/src/parties.test.ts:1215` `mesa5Visit` would become `mesa5Party`, which the file
    already has at `:1157`. Call it `mesa5Seated`.
  - The fixture's `legalName: "Visitas SL"` (`:138`) is a company name: leave it.

  Run:
  ```bash
  cd apps/server && pnpm exec tsc --noEmit && pnpm exec vitest run src/parties.test.ts src/till-api.parties.test.ts src/order-groups.test.ts src/order-drafts.db.test.ts src/till-api.groups.test.ts src/till-api.drafts.test.ts src/move-merge.test.ts src/till-api.move-merge.test.ts src/split-bill.test.ts src/print-problems.test.ts src/till-api.tables.test.ts src/booking-seat.test.ts src/tabs.test.ts src/bill-payments-api.test.ts src/till-api.courses.test.ts
  ```
  Expected: PASS. The last three name the old routes or codes; on `f19768b3e` those three files had
  15 "visit" lines between them (`git grep -n -i visit -- apps/server/src/tabs.test.ts
  apps/server/src/bill-payments-api.test.ts apps/server/src/till-api.courses.test.ts`).

- [ ] **Step 8: Rename the till.**
  - Rename the client types and methods (`getVisitBills` → `getPartyBills`, `VisitRevisions` →
    `PartyRevisions`, and every other name in the Interfaces list) and the route paths.
  - In `till-app.ts`, rename the domain names: `orderParty` stays, `#visitOfTab` → `#partyOfTab`,
    `#loadVisitBills` → `#loadPartyBills`, `#onVisitOutOfDate` → `#onPartyOutOfDate`,
    `isVisitOutOfDate`, `describeVisitChange`, `visitBills` → `partyBills`, and the `TABLE_REFUSALS`
    codes.
  - **Leave** `#orderVisit`, `#shownOnVisit`, the `visit: number` parameter of `#rereadAmounts` and
    `#hasLeftOrder`, and the "floor visit" comments (`:708`, `:820-823`, `:2330-2341`,
    `:2592-2626`, `:3243-3311`, `:3703`, `:3726` on `f19768b3e`). These count visits to the order
    SCREEN, not parties. Renaming `#orderVisit` would also collide with `orderParty`.
  - In `i18n/strings.ts`, rename the keys `visit.changed*` and `visit.try_again` to `party.…`; their
    text says "table" and "party" already.
  - In `i18n/codes.ts`, rename the six codes.
  - In `screens/till-table-order-screen.ts:2444`, rename the attribute to `data-party-outstanding`,
    and update its two test queries (`till-table-order-screen.parties.test.ts:112`,
    `till-app-parties.test.ts:388`).
  - Leave "Gracias por su visita" in the receipt fixtures: it is Spanish for "thank you for coming".

  Run (a browser run: check memory first):
  ```bash
  memory_pressure | grep free
  cd apps/till && pnpm exec tsc --noEmit && pnpm exec vitest run src/till-app-parties.test.ts src/till-app-drafts.test.ts src/till-app-table-service.test.ts src/till-app.test.ts src/api/client.test.ts src/i18n/codes.test.ts src/screens/till-floor-screen.parties.test.ts src/screens/till-table-order-screen.parties.test.ts src/screens/till-expo-screen.test.ts src/screens/till-station-screen.test.ts src/state/draft-sync.test.ts src/till-app.a11y.test.ts
  ```
  Expected: PASS.

- [ ] **Step 9: Prove nothing but names changed.**

  First, the grep. Run this, whose exclusions are the uses of the ordinary English word that
  `f19768b3e` has:
  ```bash
  git grep -n -i visit -- ':!pnpm-lock.yaml' ':!docs/superpowers' \
    ':!packages/db/drizzle/0018_visits.sql' ':!packages/db/drizzle/0019_settled_order_freeze_visit_id.sql' \
    ':!packages/db/drizzle/0020_visit_clears_table_status.sql' ':!packages/db/drizzle/meta' \
    | grep -v -E '^(scripts/(apply-migrations-callers\.test\.ts|comments-only\.mjs|workspace-cycles\.test\.ts):.*visit|apps/dashboard/src/screens/menus-screen\.test\.ts:.*visit\()' \
    | grep -v -i -E 'visited|visitor|visita|revisit|first.visit|later visit|floor visit|#orderVisit|#shownOnVisit|visiting|never visits|to visit' \
    | grep -v -E 'visits_(state|guest_count|closed_at|merged_into)_ck|enumType\(\["visit", "bill"\]\)|kind: "visit"|scope_kind'
  ```
  Expected: no output. Every line that remains must be read and either renamed or added to this
  step's exclusions with its reason in the PR.
  - The English-word exclusions cover:
    - the dashboard and till receipt fixtures ("Gracias por su visita");
    - `apps/server/src/configuration-transfer.ts:184-197` `visiting`;
    - `packages/catalogue/src/section-graph.ts:115-118` `visited`;
    - `packages/ui/src/components/wt-data-table.ts:332,409,415,677-680`;
    - the tree walkers `const visit =` in `scripts/apply-migrations-callers.test.ts`,
      `scripts/comments-only.mjs` and `scripts/workspace-cycles.test.ts`;
    - `apps/dashboard/src/screens/menus-screen.test.ts`'s helper `visit(el, …)`;
    - `apps/till/src/state/held-options.ts:42-47` `visited`;
    - `vitest.config.ts:43`;
    - `deploy/README.md:63`;
    - the seven "revisit" or "visitor" lines of `docs/backlog.md`.
  - The tree walkers and `menus-screen.test.ts`'s helper are excluded by FILE, not by the text
    `const visit = `. That text also names a domain use in `apps/server/src/booking-seat.test.ts:160`
    (`const visit = await tx.execute(… from visits …)`), which must be renamed.
  - The domain exclusions are P1's two survivors.

  Second, the mechanical comparison. Save this OUTSIDE the worktree too:
  ```python
  # rename-check.py — every changed or renamed file must equal main's copy with the names mapped.
  import difflib, subprocess, sys
  MAP = [("Visits", "Parties"), ("visits", "parties"), ("VISITS", "PARTIES"),
         ("Visit", "Party"), ("visit", "party"), ("VISIT", "PARTY")]
  def mapped(text):
      for old, new in MAP:
          text = text.replace(old, new)
      return text
  out = subprocess.run(["git", "diff", "--name-status", "-M", "main...HEAD"],
                       capture_output=True, text=True, check=True).stdout.splitlines()
  for row in out:
      parts = row.split("\t")
      status, old, new = parts[0], parts[1], parts[-1]
      if status.startswith("A"):
          print(f"NEW (read by hand): {new}")
          continue
      if status.startswith("D"):
          print(f"DELETED: {old}")
          continue
      before = subprocess.run(["git", "show", f"main:{old}"], capture_output=True, text=True).stdout
      after = open(new, encoding="utf8").read()
      if mapped(before) != after:
          diff = difflib.unified_diff(mapped(before).splitlines(), after.splitlines(), old, new, lineterm="", n=0)
          print("\n".join(diff))
  ```
  Run it from the worktree root: `python3 "$SCRATCH/rename-check.py" | tee "$SCRATCH/rename-check.txt"`.
  - Expected output: the new migration, snapshot and journal as `NEW`.
  - Beyond those, expect only hunks whose `-` side is the mapped main text and whose `+` side
    differs for a reason in this list:
    1. an English-word use kept (the mapped side shows `reparty`, `partyed`, `Partyas SL` and the
       like);
    2. a P1 survivor;
    3. a comment deleted under CLAUDE.md §1's comment rule;
    4. a renamed local that would have collided (`mesa5Seated`);
    5. an import or line re-sorted by the formatter after a rename.

    Anything else is a behaviour change and is removed.
  - Paste the counts per reason into the PR.

  Third, the behavioural suites. CI's `test:coverage` shards run every package this touches. Read
  its `changes` job output on the head. `apps/server`, `apps/till`, `packages/db`, `packages/module`
  and `packages/bookings` must be in scope and green. Test files change only by names, which the
  comparison above shows.

- [ ] **Step 10: Docs.**
  - Update `docs/backlog.md`'s domain lines, `docs/developers/modifiers.md`'s three route paths,
    `packages/db/README.md:80-82`, and any `CLAUDE.md` line naming a renamed code or table.
  - Leave the dated specs and plans under `docs/superpowers/`.
  - `docs/developers/conventions-data.md:1282-1283` names the shipped migration files. Those names
    are unchanged, so leave them.

- [ ] **Step 11: Commit, then `/finish-branch`.**
  ```bash
  git add -A packages/db apps/server apps/till packages/module packages/bookings scripts docs/backlog.md docs/developers/modifiers.md CLAUDE.md
  git status --short
  git commit -s -m "Rename visit to party in the code, the tables and the error codes, with no behaviour change (table actions, Task 1)"
  ```
  The PR description names P1's survivors, measurements 2 and 3, the hand-written SQL, the counts
  from Step 9, and that lane B's next task rebases onto the new names.

---
## Task 2: The party names its main bill, and new orders go to it — slug `party-main-bill`

Spec decisions 3, 7 and 15; §5 (party `name` and `main_bill_id`, the display name) and §7 ("New
orders"); P4, P5, P6. Branch `feat/party-main-bill`. Full review wave (a migration, a behavioural
trigger, and the order path).

**What changes for a person using the till:**
- A party's next order after its main bill is paid or presented starts a new main bill. That was
  true today only after payment (`openNextPartyTab`).
- A round can be sent to a party bill no table points at (P5), though the till offers that only in
  Task 10.
- A split bill can have a line voided, sent, recalled or served, which `assertAnchoredTabOpen`
  refuses today.

Nothing else changes. The old tab paths keep `dining_tables.tab_id` in step, and also keep
`parties.main_bill_id` in step, as listed in Step 5.

**No product path presents a party's bill before Task 7.** `apps/server/src/visits.test.ts:366-376`
on `f19768b3e` says so: a party bill takes its table's `table_tab` mode, and placing it files
nothing. So the presented cases below place a bill by a direct write (`placeByHand`, moved into the
harness), as the existing party tests do.

**Files:**
- Create:
  - `packages/shared/src/party-name.ts` and `party-name.test.ts`; export them from
    `packages/shared/src/index.ts`.
  - `apps/server/src/testing/party-venue.ts`, the harness every new party suite uses. It is excluded
    from coverage like the rest of `src/testing/` (`apps/server/vitest.config.ts:30`).
  - `apps/server/src/party-main-bill.test.ts`.
- Modify:
  - `packages/db/src/schema/parties.ts`: `name` and `mainBillId`.
  - One generated core migration, which must be two `ALTER TABLE parties ADD` lines (measurement
    6).
  - One custom core migration for the two triggers in Step 3.
  - `apps/server/src/parties.ts`: `partyMainBill`, `setMainBill`, `partyZone`, `setPartyName`, and
    `seatTable` setting the main bill.
  - `apps/server/src/order-groups.ts`: `placeGroups` resolves its bill through `resolveOrderBill`;
    `partyTab` is deleted; `SubmitGroupsInput.billId`.
  - `apps/server/src/order-drafts.ts`: `SubmitDraftInput.billId`; `offersFor` reads `partyZone`.
  - `apps/server/src/working-order.ts`:
    - `priceTabRound` and `addTabRound` take the target bill as given, and `openNextPartyTab` is
      deleted;
    - `assertAnchoredTabOpen` becomes `assertPartyBillOpen`;
    - `mergeTabs`, `moveTab` and `unjoinTable` keep `main_bill_id` in step;
    - `TableParty` gains `name`, `displayName` and `mainBillId`.
  - `apps/server/src/till-api.ts`: `PUT /api/parties/:id/name`, and `billId` on group and draft
    submission.
  - `apps/server/src/errors.ts`: `bill.presented`, `bill.paid` and `bill.other_party`.
  - `apps/till/src/i18n/codes.ts`: their wording. The till sends none of them yet, but the wording
    exists for every code a till can meet.
  - `apps/server/src/parties.test.ts`: the "pay, then order dessert" block (`visits.test.ts:791-916`
    on `f19768b3e`) moves to `party-main-bill.test.ts`, rewritten to order through `placeGroups`,
    because `addTabRound` no longer opens a next tab. The PR names each case and what replaced it.
  - `scripts/behavioural-triggers.test.ts`: the two new triggers.
  - `docs/backlog.md`.

**Interfaces:**
- Consumes: Task 1's names.
- Produces:
  ```ts
  // packages/shared/src/party-name.ts
  export const TABLE_SEPARATOR = ", ";
  export const PARTY_NAME_MAX = 40;
  export function partyTablesName(labels: readonly string[]): string; // "Mesa 4, 5, 7"; "Mesa 4, Terraza 2"; "" for none
  export function partyDisplayName(name: string | null, labels: readonly string[]): string;
  export function partyReceiptLabel(name: string | null, labels: readonly string[]): string; // "Ana · Mesa 4, 5" or "Mesa 4, 5"
  export function normalisePartyName(value: unknown): string | null; // trims; "" → null; throws AppError management.request_invalid {field:"name"} when not a string or > PARTY_NAME_MAX

  // apps/server/src/parties.ts
  export async function partyMainBill(tx, cfg, partyId: string): Promise<string>; // the main bill; makes an empty one (and sets it) when there is none; party.not_open
  export async function setMainBill(tx, partyId: string, billId: string | null): Promise<void>; // also points the party's tables' tab_id at it while that column exists (until Task 13)
  export async function partyZone(tx, cfg, partyId: string): Promise<string | null>; // the zone of the party's earliest active table
  export async function partyTableLabels(tx, partyIds: readonly string[]): Promise<Map<string, string[]>>; // active tables' labels, in join order
  export async function setPartyName(tx, args: { partyId: string; name: unknown; expectedPartyRevision: number }): Promise<{ revision: number; name: string | null }>;
  export async function requireBillOfParty(tx, partyId: string, billId: string): Promise<void>; // bill.other_party, bill.paid, bill.presented, tab.not_open — the P3 order

  // apps/server/src/order-groups.ts
  export interface SubmitGroupsInput { …; billId?: string }
  export type PlaceGroupsInput = Pick<SubmitGroupsInput, "groups" | "joinGroupId" | "operatorId" | "billId">;
  // apps/server/src/order-drafts.ts
  export interface SubmitDraftInput { …; billId?: string }

  // apps/server/src/working-order.ts
  export interface TableParty { …; name: string | null; displayName: string; mainBillId: string | null }

  // wire: PUT /api/parties/:id/name { name: string | null, expectedPartyRevision } → { revision, name }
  //       POST /api/parties/:id/groups and POST /api/parties/:id/drafts/:did/submit take an optional billId
  // codes: bill.presented { workingOrderId }, bill.paid { workingOrderId }, bill.other_party { workingOrderId } — all 409
  ```

  The harness, `apps/server/src/testing/party-venue.ts`:
  ```ts
  export const OPERATOR = "cccccccc-0000-4000-8000-000000000001";
  export interface PartyVenue {
    db: Database; backend: FiscalBackend; clock: TrustedClock; cfg: TillConfig;
    tables: ZoneOffers;                       // the "tables" zone
    item(name: string): string;               // the offer selling `name` in the tables zone
    table(label: string, zoneId?: string): Promise<string>;
  }
  export async function setupPartyVenue(db: Database): Promise<PartyVenue>;
  export function inTx<T>(v: PartyVenue, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  export async function seat(v: PartyVenue, tableId: string, guestCount?: number | null): Promise<{ partyId: string; tabId: string; revision: number }>;
  export async function order(v: PartyVenue, billId: string, ...names: string[]): Promise<void>; // addTabRound on that bill
  export async function orderForParty(v: PartyVenue, partyId: string, names: string[], billId?: string): Promise<{ tabId: string; revision: number }>; // placeGroups, fired, as OPERATOR
  export async function pay(v: PartyVenue, billId: string, amount: string): Promise<void>; // cash, payWorkingOrder
  export async function placeByHand(v: PartyVenue, billId: string): Promise<void>;
  export async function revisionOf(v: PartyVenue, partyId: string): Promise<number>;
  export async function partyRow(v: PartyVenue, partyId: string): Promise<typeof parties.$inferSelect>;
  export async function activeTablesOf(v: PartyVenue, partyId: string): Promise<string[]>; // in join order
  export async function tableRow(v: PartyVenue, tableId: string): Promise<typeof diningTables.$inferSelect>;
  export async function billRow(v: PartyVenue, billId: string): Promise<typeof workingOrders.$inferSelect>;
  export async function billsOfParty(v: PartyVenue, partyId: string): Promise<string[]>; // by opened_at, order_number
  export async function linesOf(v: PartyVenue, billId: string): Promise<{ lineNo: number; name: string; quantity: number; unitPriceGross: number; vatClass: string; groupId: string | null }[]>;
  ```

- [ ] **Step 0: Re-map.** Read `placeGroups`, `partyTab`, `offersFor`, `priceTabRound`,
  `openNextPartyTab`, `closedPartyTab`, `assertAnchoredTabOpen` and its callers, and `mergeTabs`,
  `moveTab`, `unjoinTable` and `seatTable` on today's `main`. Record in the ledger each caller of
  `assertAnchoredTabOpen`, and each path that sets or moves `dining_tables.tab_id`. On `f19768b3e`
  there are eight callers (listed under "What the code is today"). B9 may add more. Every one of
  them is covered by Step 5.

- [ ] **Step 1: Write the display-name tests.** `packages/shared/src/party-name.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { AppError } from "./errors.js";
  import {
    PARTY_NAME_MAX,
    normalisePartyName,
    partyDisplayName,
    partyReceiptLabel,
    partyTablesName,
  } from "./party-name.js";

  describe("partyTablesName", () => {
    it.each([
      [["Mesa 4"], "Mesa 4"],
      [["Mesa 4", "Mesa 5", "Mesa 7"], "Mesa 4, 5, 7"],
      [["Mesa 7", "Mesa 4"], "Mesa 7, 4"],
      [["Mesa 4", "Terraza 2"], "Mesa 4, Terraza 2"],
      [["Mesa 4", "Mesa 5", "Terraza 2"], "Mesa 4, Mesa 5, Terraza 2"],
      [["12", "14"], "12, 14"],
      [["Barra", "Barra 2"], "Barra, Barra 2"],
      [[], ""],
    ])("names %j as %s", (labels, expected) => {
      expect(partyTablesName(labels)).toBe(expected);
    });
  });

  describe("partyDisplayName and partyReceiptLabel", () => {
    it("prefer the party's own name, and add the tables on a receipt", () => {
      expect(partyDisplayName("Ana", ["Mesa 4", "Mesa 5"])).toBe("Ana");
      expect(partyDisplayName(null, ["Mesa 4", "Mesa 5"])).toBe("Mesa 4, 5");
      expect(partyReceiptLabel("Ana", ["Mesa 4", "Mesa 5"])).toBe("Ana · Mesa 4, 5");
      expect(partyReceiptLabel(null, ["Mesa 4"])).toBe("Mesa 4");
    });
  });

  describe("normalisePartyName", () => {
    it("trims, and stores an empty name as none", () => {
      expect(normalisePartyName("  Ana ")).toBe("Ana");
      expect(normalisePartyName("   ")).toBeNull();
      expect(normalisePartyName(null)).toBeNull();
    });

    it("refuses a name longer than the limit, or one that is not text", () => {
      for (const bad of ["x".repeat(PARTY_NAME_MAX + 1), 7, {}]) {
        let caught: unknown;
        try {
          normalisePartyName(bad);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(AppError);
        expect((caught as AppError).code).toBe("management.request_invalid");
        expect((caught as AppError).params).toEqual({ field: "name" });
      }
      expect(normalisePartyName("x".repeat(PARTY_NAME_MAX))).toHaveLength(PARTY_NAME_MAX);
    });
  });
  ```
  Run: `cd packages/shared && pnpm exec vitest run src/party-name.test.ts`. Expected: FAIL, because
  the module does not exist. Check how `AppError` exposes `code` and `params` in
  `packages/shared/src/errors.ts` before running, and use its own accessors if the names differ.

- [ ] **Step 2: Write the implementation.** `packages/shared/src/party-name.ts`:
  ```ts
  import { AppError } from "./errors.js";

  export const TABLE_SEPARATOR = ", ";
  export const PARTY_NAME_MAX = 40;

  /** Tables sharing their first word are named once ("Mesa 4, 5, 7"); otherwise each in full. */
  export function partyTablesName(labels: readonly string[]): string {
    const words = labels.map((label) => {
      const space = label.indexOf(" ");
      return space <= 0 ? null : { first: label.slice(0, space), rest: label.slice(space + 1) };
    });
    const first = words[0]?.first;
    if (labels.length > 1 && words.every((word) => word !== null && word.first === first)) {
      return `${first} ${words.map((word) => word!.rest).join(TABLE_SEPARATOR)}`;
    }
    return labels.join(TABLE_SEPARATOR);
  }

  export function partyDisplayName(name: string | null, labels: readonly string[]): string {
    return name ?? partyTablesName(labels);
  }

  export function partyReceiptLabel(name: string | null, labels: readonly string[]): string {
    const tables = partyTablesName(labels);
    return name === null ? tables : `${name} · ${tables}`;
  }

  export function normalisePartyName(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new AppError("management.request_invalid", { field: "name" });
    const trimmed = value.trim();
    if (trimmed.length > PARTY_NAME_MAX) {
      throw new AppError("management.request_invalid", { field: "name" });
    }
    return trimmed === "" ? null : trimmed;
  }
  ```
  Export all five from `packages/shared/src/index.ts`. Run the test: PASS. Then run
  `pnpm --filter @waitron/shared mutation`, because `shared` holds a mutation floor of 90 that
  breaks a pull request whose scope contains it (CLAUDE.md §2). Expected: the score at or above 90;
  kill any surviving mutant in `party-name.ts` with a test.

- [ ] **Step 3: Schema, migrations and the triggers.**
  - In `packages/db/src/schema/parties.ts`, add inside the `parties` columns:
    ```ts
    name: label("name"),
    // Names an open bill of this party only; two triggers on working_orders clear it (0NNN_main_bill_release.sql).
    mainBillId: id("main_bill_id").references((): AnySQLiteColumn => workingOrders.id),
    ```
    with `import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";` and
    `import { workingOrders } from "./orders.js";`, exactly as `dining-tables.ts:53` names
    `workingOrders`.
  - Run `pnpm --filter @waitron/db db:generate`, then `cat` the new `.sql`. Expected: exactly
    these two lines (measurement 6):
    ```sql
    ALTER TABLE `parties` ADD `name` text;
    ALTER TABLE `parties` ADD `main_bill_id` text REFERENCES working_orders(id);
    ``` Anything else, `__new_parties` above all, is a STOP.
  - Then `pnpm --filter @waitron/db db:generate:custom --name=main_bill_release`, and write:
    ```sql
    -- A party's main bill is an open bill of that party (spec decision 15). Paying, presenting or
    -- abandoning it, or moving it to another party, leaves the party without one until its next
    -- order makes a new one.
    CREATE TRIGGER working_orders_release_main_bill
    AFTER UPDATE OF status ON working_orders
    FOR EACH ROW
    WHEN old.status = 'open' AND new.status <> 'open'
    BEGIN
      UPDATE parties SET main_bill_id = NULL WHERE main_bill_id = new.id;
    END;
    --> statement-breakpoint
    CREATE TRIGGER working_orders_release_main_bill_on_move
    AFTER UPDATE OF party_id ON working_orders
    FOR EACH ROW
    WHEN old.party_id IS NOT new.party_id
    BEGIN
      UPDATE parties SET main_bill_id = NULL WHERE id = old.party_id AND main_bill_id = new.id;
    END;
    ```
  - These are the first triggers ON `working_orders` whose body names `parties`. Task 13's rebuild
    of `parties` must drop and re-create them first (measurement 5's shape). Task 13 says so.
  - In `scripts/behavioural-triggers.test.ts`, add a `describe("working_orders_release_main_bill")`
    with four cases, each by direct SQL on a fixture party whose `main_bill_id` names an open bill:
    1. `open → settled` clears it;
    2. `open → placed` clears it;
    3. changing the bill's `party_id` clears it on the old party;
    4. a control: an update of `revision` alone leaves it set;
    5. a control: moving ANOTHER bill of the party (not the main one) to another party leaves
       `main_bill_id` set.

    Run `pnpm exec vitest run scripts/behavioural-triggers.test.ts`. Expected: cases 1–3 FAIL before
    the migration (no such column), and all five PASS after.

- [ ] **Step 4: Write the failing server tests.** First move the venue setup into
  `apps/server/src/testing/party-venue.ts`. Moved, not rewritten, from `apps/server/src/parties.test.ts`
  (Task 1's name for `visits.test.ts`), with `suite.db` becoming the `db` argument:
  - the clock and backend (`visits.test.ts:85-110` on `f19768b3e`);
  - `setupVenue` with `PRICES` (`:112-206`);
  - `seat`, `order`, `pay`, `revisionOf`, `tableRow`, `statusOf` and `placeByHand` (`:208-376`).

  Then write `orderForParty`, `activeTablesOf`, `billRow`, `billsOfParty` and `linesOf` new, and
  change `parties.test.ts` to import them.

  `apps/server/src/party-main-bill.test.ts`:
  ```ts
  import { eq } from "drizzle-orm";
  import { describe, expect, it } from "vitest";
  import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
  import { useVenueDb } from "@waitron/db/testing/venue-db.js";
  import { captureError, saleLines, sales, workingOrders } from "@waitron/db";
  import { listTablesWithState, splitOffCheck, voidTabLine, mergeTabs } from "./working-order.js";
  import { placeGroups } from "./order-groups.js";
  import { setPartyName } from "./parties.js";
  import {
    OPERATOR, activeTablesOf, billRow, billsOfParty, inTx, linesOf, order, orderForParty, partyRow,
    pay, placeByHand, revisionOf, seat, setupPartyVenue, tableRow, type PartyVenue,
  } from "./testing/party-venue.js";
  import "./errors.js";

  // `setup`, not `beforeAll`: the rows it writes are what `useVenueDb` resets back to after each
  // case (`packages/db/src/testing/venue-db.ts:175-193`), as `testing/bill-venue.ts`'s suites use it.
  let v: PartyVenue;
  useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
    setup: async (db) => {
      v = await setupPartyVenue(db);
    },
  });

  describe("the main bill", () => {
    it("is the tab seating opens, and a round with no bill named lands on it", async () => {
      const mesa4 = await v.table("Mesa 4");
      const { partyId, tabId } = await seat(v, mesa4);
      expect((await partyRow(v, partyId)).mainBillId).toBe(tabId);

      const { tabId: landed } = await orderForParty(v, partyId, ["Burger"]);

      expect(landed).toBe(tabId);
      expect((await linesOf(v, tabId)).map((line) => line.name)).toEqual(["Burger"]);
    });

    it("is cleared when it is paid, and the next order starts a new, empty main bill on the party", async () => {
      const mesa4 = await v.table("Mesa 4b");
      const { partyId, tabId } = await seat(v, mesa4);
      await order(v, tabId, "Burger");
      await pay(v, tabId, "12.00");
      const saleBefore = await inTx(v, (tx) => tx.select().from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId)).where(eq(sales.workingOrderId, tabId)));

      expect((await partyRow(v, partyId)).mainBillId).toBeNull();

      const { tabId: dessert } = await orderForParty(v, partyId, ["Flan"]);

      expect(dessert).not.toBe(tabId);
      expect((await partyRow(v, partyId)).mainBillId).toBe(dessert);
      expect((await billRow(v, dessert)).partyId).toBe(partyId);
      expect((await linesOf(v, dessert)).map((line) => line.name)).toEqual(["Flan"]);
      expect((await tableRow(v, mesa4)).tabId).toBe(dessert);
      expect(await billsOfParty(v, partyId)).toEqual([tabId, dessert]);
      const saleAfter = await inTx(v, (tx) => tx.select().from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId)).where(eq(sales.workingOrderId, tabId)));
      expect(saleAfter).toEqual(saleBefore);
    });

    it("is cleared when it is presented, and the next order starts a new one while the presented bill stays as it was", async () => {
      const mesa6 = await v.table("Mesa 6");
      const { partyId, tabId } = await seat(v, mesa6);
      await order(v, tabId, "Paella");
      await placeByHand(v, tabId);

      expect((await partyRow(v, partyId)).mainBillId).toBeNull();
      const { tabId: next } = await orderForParty(v, partyId, ["Agua"]);

      expect(next).not.toBe(tabId);
      expect((await linesOf(v, tabId)).map((line) => line.name)).toEqual(["Paella"]);
      expect((await billRow(v, tabId)).status).toBe("placed");
    });

    it("is cleared when it is abandoned", async () => {
      const mesa8 = await v.table("Mesa 8");
      const { partyId, tabId } = await seat(v, mesa8);
      await inTx(v, (tx) => tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, tabId)));
      expect((await partyRow(v, partyId)).mainBillId).toBeNull();
    });
  });

  describe("an order sent to a named bill (P5)", () => {
    it("lands on another open bill of the party, and the main bill stays", async () => {
      const mesa9 = await v.table("Mesa 9");
      const { partyId, tabId } = await seat(v, mesa9);
      await order(v, tabId, "Burger", "Vino");
      const command = { expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
      const { checkId } = await inTx(v, (tx) => splitOffCheck(tx, v.cfg, tabId, [{ lineNo: 2 }], command));

      const { tabId: landed } = await orderForParty(v, partyId, ["Agua"], checkId);

      expect(landed).toBe(checkId);
      expect((await linesOf(v, checkId)).map((line) => line.name)).toEqual(["Vino", "Agua"]);
      expect((await partyRow(v, partyId)).mainBillId).toBe(tabId);
    });

    it.each([
      ["a presented bill", "bill.presented"],
      ["a paid bill", "bill.paid"],
      ["an abandoned bill", "tab.not_open"],
      ["another party's bill", "bill.other_party"],
    ])("refuses %s with its own code, writing no line", async (kind, code) => {
      const mesa = await v.table(`Mesa ${kind}`);
      const { partyId, tabId } = await seat(v, mesa);
      await order(v, tabId, "Tarta");
      let target = tabId;
      if (kind === "a presented bill") await placeByHand(v, tabId);
      if (kind === "a paid bill") await pay(v, tabId, "15.00");
      if (kind === "an abandoned bill") {
        await inTx(v, (tx) => tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, tabId)));
      }
      if (kind === "another party's bill") {
        target = (await seat(v, await v.table(`Mesa other ${kind}`))).tabId;
      }
      const linesBefore = await linesOf(v, target);
      const revisionBefore = await revisionOf(v, partyId);

      const error = await captureError(() =>
        inTx(v, (tx) =>
          placeGroups(tx, v.cfg, partyId, {
            groups: [{ lines: [{ menuItemId: v.item("Agua"), quantity: "1" }], release: "fire" }],
            operatorId: OPERATOR,
            billId: target,
          }),
        ),
      );

      expect(error).toMatchObject({ code });
      expect(await linesOf(v, target)).toEqual(linesBefore);
      expect(await revisionOf(v, partyId)).toBe(revisionBefore);
    });
  });

  describe("a split bill is a bill like any other", () => {
    it("can have a line voided", async () => {
      const mesa10 = await v.table("Mesa 10");
      const { partyId, tabId } = await seat(v, mesa10);
      await order(v, tabId, "Burger", "Vino");
      const command = { expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
      const { checkId } = await inTx(v, (tx) => splitOffCheck(tx, v.cfg, tabId, [{ lineNo: 2 }], command));

      await inTx(v, (tx) => voidTabLine(tx, v.cfg, checkId, 1));

      expect(await linesOf(v, checkId)).toEqual([]);
    });
  });

  describe("the old merge keeps the main bill in step", () => {
    it("makes the bill merged into main when the merged-away bill was main", async () => {
      const mesa11 = await v.table("Mesa 11");
      const { partyId, tabId } = await seat(v, mesa11);
      await order(v, tabId, "Burger", "Vino");
      const command = { expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
      const { checkId } = await inTx(v, (tx) => splitOffCheck(tx, v.cfg, tabId, [{ lineNo: 2 }], command));

      const merge = { freeSourceTable: false, expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
      await inTx(v, (tx) => mergeTabs(tx, v.cfg, checkId, tabId, merge));

      expect((await partyRow(v, partyId)).mainBillId).toBe(checkId);
    });
  });

  describe("the party's name", () => {
    it("is shown instead of its tables, trimmed, and cleared by an empty name", async () => {
      const mesa12 = await v.table("Mesa 12");
      const { partyId, revision } = await seat(v, mesa12);

      const named = await inTx(v, (tx) => setPartyName(tx, { partyId, name: "  Ana ", expectedPartyRevision: revision }));
      const floor = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));

      expect(named).toEqual({ revision: revision + 1, name: "Ana" });
      expect((await partyRow(v, partyId)).name).toBe("Ana");
      expect(floor.find((t) => t.id === mesa12)!.party).toMatchObject({ name: "Ana", displayName: "Ana" });

      await inTx(v, (tx) => setPartyName(tx, { partyId, name: "", expectedPartyRevision: revision + 1 }));
      const after = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));
      expect(after.find((t) => t.id === mesa12)!.party).toMatchObject({ name: null, displayName: "Mesa 12" });
    });

    it("is refused with a stale revision, changing nothing", async () => {
      const mesa13 = await v.table("Mesa 13");
      const { partyId, revision } = await seat(v, mesa13);
      const error = await captureError(() =>
        inTx(v, (tx) => setPartyName(tx, { partyId, name: "Ana", expectedPartyRevision: revision - 1 })),
      );
      expect(error).toMatchObject({ code: "party.out_of_date" });
      expect((await partyRow(v, partyId)).name).toBeNull();
      expect(await revisionOf(v, partyId)).toBe(revision);
    });
  });
  ```
  Also add to `apps/server/src/till-api.parties.test.ts`:
  - `PUT /api/parties/:id/name` answers `{ revision, name }`. A 41-character name answers 400
    `management.request_invalid` `{ field: "name" }`. A request with no session answers 401.
  - `POST /api/parties/:id/groups` with a `billId` of another party answers 409
    `bill.other_party`.

  **Reading how `captureError` exposes the code:** the existing suites assert
  `expect(error).toMatchObject({ code: … })`. Check one (`visits.test.ts` on `f19768b3e`, any
  refusal case) and write these the same way.

  Run:
  ```bash
  cd apps/server && pnpm exec vitest run src/party-main-bill.test.ts src/till-api.parties.test.ts
  ```
  Expected: FAIL. `mainBillId` is not a column, `setPartyName` does not exist, `placeGroups` ignores
  `billId`, and `voidTabLine` on the check is refused `tab.not_open`.

- [ ] **Step 5: Implement.**
  - **`parties.ts`:**
    - `seatTable` calls `setMainBill(tx, partyId, tabId)` after `openTab`.
    - `setMainBill` updates `parties.main_bill_id`. While `dining_tables.tab_id` exists it also
      points every active member table's `tab_id` at the bill, when the bill is not null, so the
      old paths and the till read the same bill.
    - `partyMainBill`:
      1. reads the party (`party.not_open` unless `open`);
      2. returns `main_bill_id` when it is set (the triggers guarantee it is open);
      3. otherwise creates an empty open bill with
         `createOpenOrder(tx, cfg, id, [], null, { zoneId: await partyZone(…) ?? undefined, partyId })`,
         calls `setMainBill`, then `bumpPartyRevision`, and returns the new bill.
    - `requireBillOfParty` reads the bill's `party_id` and `status`, and refuses in P3's order:
      `bill.other_party` when the parties differ, then `bill.paid` (settled), `tab.not_open`
      (abandoned) and `bill.presented` (placed).
    - `setPartyName` runs `checkAndBumpParty(…, "open")`, then `normalisePartyName`, then the
      update.
  - **`order-groups.ts`:** `placeGroups` resolves
    `const billId = input.billId === undefined ? await partyMainBill(tx, cfg, partyId) : (await requireBillOfParty(tx, partyId, input.billId), input.billId);`
    before pricing, and prices on it. `partyTab` is deleted. `SubmittedGroups.tabId` keeps its name
    and meaning: the bill the lines went on.
  - **`order-drafts.ts`:** `submitDraft` passes `input.billId` through. `offersFor` reads
    `partyZone(tx, cfg, partyId)`, and returns an empty map when it is null.
  - **`working-order.ts`:**
    - `priceTabRound` no longer calls `openNextPartyTab`, which is deleted along with its doc
      comment. It asserts `assertPartyBillOpen`, which replaces `assertAnchoredTabOpen` at every
      caller Step 0 listed. It passes when the order is `open` and has a `party_id`, or (while
      `tab_id` exists) a table points at it. Otherwise it is `tab.not_open`, as today.
    - `mergeTabs` calls `setMainBill(tx, into.partyId, intoTabId)` when `from` was its party's main
      bill and both are one party.
    - `unjoinTable` calls `setMainBill(tx, newPartyId, newTabId)` after opening the new party.
    - `moveTab` needs nothing: the moved tab keeps its party and its id.
    - `readSeatedParties` reads `parties.name`, `parties.main_bill_id` and `partyTableLabels`, and
      fills `name`, `displayName` and `mainBillId`.
  - **`till-api.ts`:** add `PUT /api/parties/:id/name`, and read an optional `billId` (a UUID, else
    `management.request_invalid` `{ field: "billId" }`) on the groups and draft submission routes.
    The fingerprint includes `billId`, because it is part of the command's body.
  - **`errors.ts`:** register the three codes with their params, and give each 409 in `STATUS`.
    Add their English and Spanish wording to `apps/till/src/i18n/codes.ts`:
    - `bill.presented`: "This bill has been presented, so it cannot be changed" / "Esta cuenta ya
      se ha presentado, así que no se puede cambiar";
    - `bill.paid`: "This bill is paid" / "Esta cuenta ya está pagada";
    - `bill.other_party`: "That bill belongs to other guests" / "Esa cuenta es de otros clientes".

  Run the Step 4 command. Expected: PASS. Then run the suites the old paths live in:
  ```bash
  cd apps/server && pnpm exec vitest run src/parties.test.ts src/move-merge.test.ts src/split-bill.test.ts src/order-groups.test.ts src/order-drafts.db.test.ts src/till-api.groups.test.ts src/till-api.drafts.test.ts src/working-order.test.ts src/booking-seat.test.ts
  ```
  Expected: PASS, apart from the dessert cases moved in Step 4 and the cases that pinned a split
  bill as second-class. Those are retired by spec §3 ("A bill no table points at is second-class")
  and P5; name each one in the PR.
  - **Relaxed by `assertPartyBillOpen`,** read from the test titles on `f19768b3e` and to be
    confirmed by running them:
    - `split-bill.test.ts:304` "refuses a DETACHED CHECK as the split origin (tab.not_open)": a
      party's split bill can now be split again through `splitOffCheck`;
    - `visits.test.ts:1222` "refuses a round sent to the check, and opens no next tab": a round can
      now name a split bill;
    - any case in `move-merge.test.ts` or `split-bill.test.ts` refusing a transfer to or from a
      split bill with `tab.not_open` (`carveBetweenTabs`).
  - **Keep refusing, and check that they still do:**
    - `move-merge.test.ts:508` "refuses to join a detached open order to a table";
    - `move-merge.test.ts:769` "refuses a detached open order as the merge target";
    - `visits.test.ts:1240` "refuses moving the check to a free table, or joining one to it".

    These go through `refuseInconsistentMerge`, `tablePointsAt` and `joinTable`'s own check, not
    `assertAnchoredTabOpen`. A COUNTER order (no party) is still refused by `assertPartyBillOpen`
    everywhere it was.

- [ ] **Step 6: The main bill agrees with the old rule on every old path.** Add this to
  `party-main-bill.test.ts`. For each of seat, join, move-tab, unjoin-with-items and
  merge-into-the-tab, after the action on a fresh party, `parties.main_bill_id` equals the `tab_id`
  of the party's earliest active table:
  ```ts
  it.each(["seat", "join", "move", "unjoin", "merge"])(
    "after %s, the main bill is the bill the party's first table points at",
    async (path) => {
      const { partyId } = await afterOldPath(v, path);
      const [first] = await activeTablesOf(v, partyId);
      expect((await partyRow(v, partyId)).mainBillId).toBe((await tableRow(v, first!)).tabId);
    },
  );
  ```
  `afterOldPath` is a local helper in the test file. It seats a fresh table and orders two dishes,
  then runs the named old function (`joinTable`, `moveTab`, `unjoinTable` with line 2,
  `mergeTabs` of a split check into the tab) with the party's current revision. It returns the
  party (for unjoin, the new party). Run it: PASS.

- [ ] **Step 7: Guards, upgrade and look.**
  - Run the root guards listed in Global Constraints.
  - Measure the upgrade: start the previous `main`'s dev venue, stop it, start this branch on the
    same folder. `wa-wt demo <worktree>` must boot, and every open party's `main_bill_id` is null
    until its next order (no data migration, CLAUDE.md §3). Say so in the PR and the backlog.
  - Nothing on screen changed yet, so nothing needs looking at.

- [ ] **Step 8: Commit, then `/finish-branch`.**
  ```bash
  git add packages/shared packages/db apps/server apps/till/src/i18n/codes.ts scripts/behavioural-triggers.test.ts docs/backlog.md
  git commit -s -m "A party names its main bill, and its next order starts a new one once that bill is paid or presented (table actions, Task 2)"
  ```

---

## Task 3: A table needs cleaning, not its party — slug `party-table-cleaning`

Spec decision 6, §5 ("Needs cleaning moves from the party … to the table", room for "reserved")
and §6 (Finish, Cleared); P8, P9, P10. Branch `feat/party-table-cleaning`. Full review wave (a
migration, and the configuration export's column list).

**The venue's clearing setting decides** (P8; owner ruling 3). With
`service_settings.clearing_workflow` on, every table the guests leave needs cleaning; with it off,
Finish frees the tables at once, as today.

**Files:**
- Modify:
  - `packages/db/src/schema/dining-tables.ts`: `needsCleaningSince: tsString("needs_cleaning_since")`.
  - One generated core migration, which must be one `ALTER TABLE dining_tables ADD` (measurement 6).
  - `packages/db/src/configuration-transfer.ts:19`: `omit: ["tab_id", "needs_cleaning_since"]`.
    A table's cleaning state is running state, not configuration, like `tab_id`.
  - `apps/server/src/parties.ts`:
    - `finishTable` closes the party and calls `leaveForCleaning` on its tables;
    - `markCleared(party)` is deleted and `markTableCleared(table)` added;
    - `leaveForCleaning` is added; `tableCondition` is added in `working-order.ts`.
  - `apps/server/src/working-order.ts`:
    - `openTab` and `assertTableAvailable` refuse `table.needs_cleaning`;
    - `listTablesWithState` fills `condition`;
    - `TableState.condition`.
  - `apps/server/src/till-api.ts`: `POST /api/tables/:id/cleared` is added, and
    `POST /api/parties/:id/cleared` is deleted.
  - `apps/server/src/errors.ts`: `table.needs_cleaning`.
  - `apps/till/src/api/client.ts`: `markTableCleared(tableId)` replaces `markCleared`;
    `TableState.condition`.
  - `apps/till/src/screens/till-floor-screen.ts`: `needsClearing` reads `table.condition`; the
    Mark cleared dialog and card act on the table; the `mark-cleared` event detail becomes
    `{ tableId }`.
  - `apps/till/src/till-app.ts`: `#onMarkCleared` calls `markTableCleared`.
  - `apps/till/src/i18n/codes.ts`: `table.needs_cleaning`, and `table.not_found`, which Mark
    cleared can now meet. `table.not_found` already has its 404 in `till-api.ts`'s `STATUS`
    (`:326` on `f19768b3e`), but no till wording (`grep -n "table.not_found"
    apps/till/src/i18n/codes.ts` finds nothing). Suggested wording: "That table no longer exists" /
    "Esa mesa ya no existe".
- Test:
  - `apps/server/src/parties.test.ts`: the "needs clearing" block (`visits.test.ts:664-755` on
    `f19768b3e`) is rewritten to the table's condition. The PR names each case.
  - `apps/server/src/till-api.parties.test.ts`.
  - `apps/till/src/screens/till-floor-screen.parties.test.ts` (the Mark cleared cases, `:231` on
    `f19768b3e`).
  - `apps/till/src/till-app-parties.test.ts` (the needs-clearing case, `:1231`).
  - `apps/till/src/screens/till-floor-screen.a11y.test.ts` (the Mark cleared dialog, `:325`).
  - `apps/server/src/booking-seat.test.ts`, whose seat refusal for a table needing clearing moves
    from `tab.already_open` to `table.needs_cleaning`.

**Interfaces:**
- Consumes: Task 2's `setMainBill`; Task 1's `leaveTables` and `memberTables`.
- Produces:
  ```ts
  // apps/server/src/working-order.ts
  export type TableCondition = "free" | "held" | "needs_cleaning"; // "reserved" joins from the bookings module later (P8)
  export function tableCondition(row: { held: boolean; needsCleaningSince: string | null }): TableCondition;
  export interface TableState { …; condition: TableCondition }
  // apps/server/src/parties.ts
  export async function leaveForCleaning(tx, tableIds: readonly string[], at: string): Promise<void>; // ends memberships; tab_id and status_id null; needs_cleaning_since = at only when the venue's clearing setting is on (P8)
  export async function markTableCleared(tx, tableId: string): Promise<void>; // table.not_found; idempotent (P9)
  // finishTable answers { state: "closed" } always now; the tables carry the rest
  // wire: POST /api/tables/:id/cleared → 204; TableState.condition
  // code: table.needs_cleaning { tableId } — 409
  ```

- [ ] **Step 0: Re-map** `finishTable`, `markCleared`, `releaseTables`, `openTab`,
  `assertTableAvailable`, `listTablesWithState`, `readSeatedParties`, the floor screen's
  `needsClearing` and `#markCleared`, and `configuration-transfer.ts`'s table rules.

- [ ] **Step 1: Write the failing tests.** In `apps/server/src/parties.test.ts`, replace the
  "needs clearing" block with the following. It uses Task 2's harness:
  `writeClearingWorkflow` from `@waitron/venue-service` (as `visits.test.ts` does today), plus
  `finishTable`, `markTableCleared`, `seatTable` and `listTablesWithState`.
  ```ts
  describe("a table needs cleaning, not its party (P8, P9)", () => {
    // Each case starts from a fresh venue, as the file's other cases do with `setupVenue()` today.
    let v: PartyVenue;
    beforeEach(async () => {
      v = await setupPartyVenue(suite.db);
    });
    // Every revision is read BEFORE the transaction opens: a read through `inTx` inside a running
    // body asks for the write lock it holds, which the queue refuses
    // (`packages/store/src/write-queue.ts`, `enqueue`).
    async function finish(partyId: string) {
      const expectedPartyRevision = await revisionOf(v, partyId);
      await inTx(v, (tx) => finishTable(tx, { partyId, expectedPartyRevision, operatorId: OPERATOR }));
    }
    // Today's join (the old tab path, until Task 8 adds `joinTables`).
    async function joinOld(partyId: string, tabId: string, tableId: string) {
      const command = { expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
      await inTx(v, (tx) => joinTable(tx, v.cfg, tabId, tableId, command));
    }
    async function condition(tableId: string) {
      const floor = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));
      return floor.find((t) => t.id === tableId)!.condition;
    }

    it("closes the party at Finish and leaves each of its tables needing cleaning, with no party on them", async () => {
      await inTx(v, (tx) => writeClearingWorkflow(tx, true));
      const mesa4 = await v.table("Mesa 4c");
      const mesa5 = await v.table("Mesa 5c");
      const { partyId, tabId } = await seat(v, mesa4);
      await joinOld(partyId, tabId, mesa5);

      await finish(partyId);

      expect((await partyRow(v, partyId)).state).toBe("closed");
      expect(await activeTablesOf(v, partyId)).toEqual([]);
      expect((await tableRow(v, mesa4)).needsCleaningSince).not.toBeNull();
      expect(await condition(mesa4)).toBe("needs_cleaning");
      expect(await condition(mesa5)).toBe("needs_cleaning");
    });

    it("refuses seating a table that needs cleaning until it is cleared, one table at a time", async () => {
      await inTx(v, (tx) => writeClearingWorkflow(tx, true));
      const mesa6 = await v.table("Mesa 6c");
      const mesa7 = await v.table("Mesa 7c");
      const { partyId, tabId } = await seat(v, mesa6);
      await joinOld(partyId, tabId, mesa7);
      await finish(partyId);

      const refused = await captureError(() => seat(v, mesa6));
      expect(refused).toMatchObject({ code: "table.needs_cleaning", params: { tableId: mesa6 } });

      await inTx(v, (tx) => markTableCleared(tx, mesa6));
      expect(await condition(mesa6)).toBe("free");
      expect(await condition(mesa7)).toBe("needs_cleaning");
      await seat(v, mesa6);
      expect(await condition(mesa6)).toBe("held");
    });

    it("frees the tables at once when the venue's clearing setting is off (P8)", async () => {
      await inTx(v, (tx) => writeClearingWorkflow(tx, false));
      const mesa8 = await v.table("Mesa 8c");
      const { partyId } = await seat(v, mesa8);
      await finish(partyId);
      expect(await condition(mesa8)).toBe("free");
      expect((await tableRow(v, mesa8)).needsCleaningSince).toBeNull();
    });

    it("clears a table that does not need cleaning without complaint, and changes nothing", async () => {
      const mesa9 = await v.table("Mesa 9c");
      const { partyId, revision } = await seat(v, mesa9);
      await inTx(v, (tx) => markTableCleared(tx, mesa9));
      expect(await condition(mesa9)).toBe("held");
      expect(await revisionOf(v, partyId)).toBe(revision);
    });

    it("clears the table's manual status at Finish, as today", async () => {
      await inTx(v, (tx) => writeClearingWorkflow(tx, true));
      const mesa10 = await v.table("Mesa 10c");
      const { partyId } = await seat(v, mesa10);
      await giveStatus([mesa10]);
      await finish(partyId);
      expect((await tableRow(v, mesa10)).statusId).toBeNull();
    });
  });
  ```
  - `giveStatus` is the file's existing helper (`visits.test.ts:281-292` on `f19768b3e`). Change
    it to take the harness's `v`.
  - Add route cases to `till-api.parties.test.ts`: `POST /api/tables/:id/cleared` answers 204 and
    the table reads free; the removed `POST /api/parties/:id/cleared` answers 404.
  - Add a configuration export case to `apps/server/src/configuration-transfer.test.ts`: the
    exported `dining_tables` rows carry no `needs_cleaning_since` key.
  - Till, `till-floor-screen.parties.test.ts`:
    - a table with `condition: "needs_cleaning"` and `party: null` shows the needs-cleaning chip;
    - tapping it opens the clear dialog;
    - confirming emits `mark-cleared` with `{ tableId }`.

    And `till-app-parties.test.ts`: the app calls `api.markTableCleared(tableId)` and re-reads the
    floor.

  Run:
  ```bash
  cd apps/server && pnpm exec vitest run src/parties.test.ts src/till-api.parties.test.ts src/configuration-transfer.test.ts src/booking-seat.test.ts
  cd apps/till && pnpm exec vitest run src/screens/till-floor-screen.parties.test.ts src/till-app-parties.test.ts
  ```
  Expected: FAIL. There is no column or condition, `markTableCleared` does not exist, and the floor
  reads the party's state.

- [ ] **Step 2: Schema.** Add the column. Run `pnpm --filter @waitron/db db:generate` and read the
  file: it must be exactly ``ALTER TABLE `dining_tables` ADD `needs_cleaning_since` text;``.

- [ ] **Step 3: Implement.**
  - `leaveForCleaning(tx, tableIds, at)`: calls `leaveTables(tx, tableIds, at)`, then updates
    `dining_tables` for those ids with `tabId: null` and `statusId: null`, and with
    `needsCleaningSince: at` only when `VENUE_SERVICE.readClearingWorkflow(tx)` is true (P8, owner
    ruling 3).
  - `finishTable`:
    1. keeps its refusal checks and the empty-bill abandon;
    2. updates the party to `state: "closed"`, with `closedAt` and `closedBy`, **before**
       `leaveForCleaning`. `parties_clear_table_status` clears the status of the tables still
       members, so the order matters; the service plan's merge wrote it the same way.
    3. then calls `leaveForCleaning(tx, await memberTables(tx, partyId), at)`, and answers
       `{ state: "closed" }`.
  - `markTableCleared`: updates `needs_cleaning_since` to null. It does nothing else, and answers
    `table.not_found` when no row matched.
  - `openTab` and `assertTableAvailable` refuse `table.needs_cleaning` when `needs_cleaning_since`
    is set. That check comes first, so a table that needs cleaning never reads as occupied.
  - `listTablesWithState` selects `dt.needs_cleaning_since` and computes
    `condition: tableCondition({ held: party !== undefined, needsCleaningSince })`.
  - A dev venue upgraded while a party is still in `needs_clearing` keeps that party's tables held.
    `wa-wt reset demo <name>` clears it. No data migration (CLAUDE.md §3). The PR says so.
  - The till's floor shows the needs-cleaning chip and Mark cleared from `table.condition`. The
    `#clearDialog` and `#clearingCard` (`till-floor-screen.ts:690-743` on `f19768b3e`) act on the
    table, and the `mark-cleared` detail is `{ tableId }`.

  Run the Step 1 commands: PASS.

- [ ] **Step 4: Guards, upgrade, LOOK.** Run the root guards. Measure the upgrade (Task 2 Step 7).
  Open the floor with a table needing cleaning, in English and Spanish, light and dark, at 390 and
  1280 px. Run the floor's a11y test for the dialog.

- [ ] **Step 5: Commit, then `/finish-branch`.**
  ```bash
  git add packages/db apps/server apps/till docs/backlog.md
  git commit -s -m "A table the guests have left needs cleaning, and Mark cleared frees that one table (table actions, Task 3)"
  ```

---
## Task 4: Kitchen slips, the pass and receipts name the party's tables — slug `party-kitchen-names`

Spec decision 9, §8 (slips and the pass read the party; MOVED notices whatever caused the change;
receipts show the name and tables); P7, P17. Branch `feat/party-kitchen-names`. Full review wave
(kitchen output across two packages, `packages/reporting` and `packages/shared`).

**What changes for a person:**
- A joined party's slips, pass cards and receipts say "Mesa 4, 5" where they said one table's label
  (the one with the lowest id).
- A split bill's slips name the party's tables rather than the label copied when it was split.
- Joining or unjoining a table sends MOVED notices for sent dishes on EVERY bill of the party,
  because every bill's destination changed. Today only the tab's are considered, by the one label
  compared.

**Files:**
- Modify:
  - `apps/server/src/kitchen-print.ts`: `readOrderHeader` reads the party's tables;
    `readPartiesSentWork` and `enqueueMovedSlipsFor` are added.
  - `apps/server/src/working-order.ts`: the pass label (`listExpoQueue`, `:5396-5401` on
    `f19768b3e`), and the old `moveTab`, `joinTable`, `unjoinTable` and `mergeTabs`, which read
    party-wide sent work before and notify each bill after.
  - `apps/server/src/receipt-order.ts`: `readReceiptOrder`.
  - `apps/server/src/parties.ts`: `partyTableLabels` (from Task 2) is used by all three.
  - `packages/reporting/src/overdue-orders.ts:45-53`: the overdue report's label.
- Test:
  - `apps/server/src/kitchen-print.test.ts`
  - `apps/server/src/move-merge.test.ts` (the MOVED cases)
  - `apps/server/src/working-order.test.ts` (the expo label cases, whichever file holds
    `listExpoQueue`'s label tests; find it with `git grep -n "tableLabel" apps/server/src/*.test.ts`)
  - `apps/server/src/receipt-print.test.ts`
  - `packages/reporting/src/overdue-orders.test.ts`
  - `apps/till/src/screens/till-expo-screen.test.ts` only if a fixture there asserts a server label.
    The till shows whatever label arrives.

**Interfaces:**
- Consumes: Task 2's `partyTableLabels`, `partyTablesName` and `partyReceiptLabel`.
- Produces:
  ```ts
  // apps/server/src/kitchen-print.ts
  export async function orderTableLabel(tx, cfg, orderId: string): Promise<string | null>; // a party bill: its active tables (partyTablesName), else its label; a counter order: its delivery table, else its label
  export async function readPartiesSentWork(tx, cfg, partyIds: readonly (string | null)[]): Promise<Map<string, SentWork>>; // every open, placed or settled bill of those parties with fired items, keyed by bill
  export async function enqueueMovedSlipsFor(tx, cfg, before: ReadonlyMap<string, SentWork>, mergedInto?: ReadonlyMap<string, string>): Promise<void>; // enqueueMovedSlips(before.get(bill), mergedInto.get(bill) ?? bill) for each; Task 8 passes mergedInto
  ```

- [ ] **Step 0: Re-map** `readOrderHeader`, `readSentWork`, `enqueueMovedSlips` and their callers,
  the expo label SQL, `readReceiptOrder`, and the overdue report query. `packages/reporting` cannot
  import `apps/server`. Confirm that `@waitron/shared` is already one of its dependencies
  (`grep '"@waitron/shared"' packages/reporting/package.json`). If it is not, adding it is part of
  this task, and the root guard `scripts/workspace-cycles.test.ts` must stay green.

- [ ] **Step 1: Write the failing tests.** In `apps/server/src/kitchen-print.test.ts`, with a party
  seated at Mesa 4, then Mesa 5 joined, then a dish fired:
  ```ts
  it("names every table of the party on the slip, in the order they joined", async () => {
    const { partyId, tabId } = await seat(v, mesa4);
    await join(v, partyId, mesa5);
    await fireOne(v, tabId, "Burger");
    const header = await inTx(v, (tx) => orderTableLabel(tx, v.cfg, tabId));
    expect(header).toBe("Mesa 4, 5");
  });

  it("names the party's tables on a bill split from the tab, not the label it was split with", async () => {
    const { partyId, tabId } = await seat(v, mesa4);
    await join(v, partyId, mesa5);
    await order(v, tabId, "Burger", "Vino");
    const checkId = await split(v, partyId, tabId, [2]);
    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, checkId))).toBe("Mesa 4, 5");
  });

  it("names a counter order's delivery table, and an unlabelled walk-up nothing", async () => {
    // parkOrder with deliveryTableId, and one without
    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, delivered))).toBe("Terraza 2");
    expect(await inTx(v, (tx) => orderTableLabel(tx, v.cfg, walkUp))).toBeNull();
  });
  ```
  - `fireOne` and `join` are helpers in the test file. `fireOne` calls `orderForParty` with release
    `"fire"`.
  - Use labels with a shared first word, or the expectation is the unshortened form.

  In `apps/server/src/move-merge.test.ts`, the MOVED notices:
  ```ts
  it("tells the kitchen of sent dishes on every bill of a party that joins a table, and only those", async () => {
    const { partyId, tabId } = await seat(v, mesa4);
    await fireOne(v, tabId, "Burger");                 // sent, on the tab
    const checkId = await splitAfterFiring(v, partyId, tabId, "Vino"); // a second bill, one sent dish
    await order(v, tabId, "Agua");                     // not sent: no notice
    const before = await noticesOf(v, [tabId, checkId]);

    await join(v, partyId, mesa5);

    const after = await noticesOf(v, [tabId, checkId]);
    const added = after.slice(before.length);
    expect(added).toHaveLength(2);
    expect(added.map((n) => n.kind)).toEqual(["moved", "moved"]);
    expect(added.map((n) => n.movedTo)).toEqual(["Mesa 4, 5", "Mesa 4, 5"]);
    expect(added.map((n) => n.workingOrderId).sort()).toEqual([tabId, checkId].sort());
  });
  ```
  `noticesOf` reads `kitchen_notices` (`packages/venue-service/src/schema/kitchen-notices.ts:29-50`
  on `f19768b3e`) for those bills, ordered by `created_at`.
  - A notice's type is the column `kind` (`moved`); `direction` is only for a `changed` notice.
  - `moved_to` holds the destination table label.
  - Check the columns on the `main` you start from before writing the helper.

  Receipt: a named party ("Ana") at Mesa 4 and 5 pays its bill, and the receipt's order label reads
  "Ana · Mesa 4, 5". An unnamed party's receipt reads "Mesa 4, 5". A counter order delivered to
  Terraza 2 still reads "Terraza 2".

  Overdue report: an overdue dish on a party at Mesa 4 and 5 reads "Mesa 4, 5".

  Run:
  ```bash
  cd apps/server && pnpm exec vitest run src/kitchen-print.test.ts src/move-merge.test.ts src/receipt-print.test.ts
  cd packages/reporting && pnpm exec vitest run src/overdue-orders.test.ts
  ```
  Expected: FAIL. Today's label is one table (the lowest id), the check's own label, and no notice on
  join.

- [ ] **Step 2: Implement.**
  - `orderTableLabel` reads the order's `party_id`, `delivery_table_id` and `label`:
    - with a party: `partyTableLabels`, then `partyTablesName`, or the order's label when the party
      holds no table (a finished party);
    - otherwise: the delivery table's label, else the order's label.
  - `readOrderHeader` uses it.
  - The expo query selects `working_orders.party_id` beside the rows. One `partyTableLabels` call
    for all the parties in the result fills `tableLabel` in JavaScript. Delete the correlated
    subquery at `working-order.ts:5396-5401`.
  - `readReceiptOrder`, when not frozen by a sale, uses `partyReceiptLabel(name, labels)` for a
    party bill. It keeps the delivery table, then the label, for a counter order.
  - The overdue report selects `party_id`, reads the active tables' labels in one query ordered by
    `party_tables.joined_at`, and formats them with `partyTablesName` from `@waitron/shared`.
  - The old `joinTable`, `moveTab`, `unjoinTable` and `mergeTabs` each call
    `readPartiesSentWork` for the parties involved before they write, and `enqueueMovedSlipsFor`
    after. That replaces their single `readSentWork` and `enqueueMovedSlips` pair. For
    `unjoinTable` and `mergeTabs`, keep the `splitFrom` map for the bill the split lines landed on.

  Run the Step 1 commands: PASS. Then run the rest of the kitchen and pass suites:
  ```bash
  cd apps/server && pnpm exec vitest run src/kitchen-print.test.ts src/kitchen-print.concurrency.test.ts src/print-problems.test.ts src/till-api.print-problems.test.ts src/working-order.test.ts src/move-merge.test.ts src/parties.test.ts
  ```
  Expected: PASS. Any case that pinned the lowest-id table's label is changed to the party's tables.
  The PR names each, as retired by spec decision 9.

- [ ] **Step 3: Guards, LOOK.**
  - `packages/reporting` and `packages/shared` are in CI's scope. Read the `changes` job.
  - Open the pass (expo) screen in the dev stack with a joined party, in both themes at 1280 and
    390 px, and check that the longer label wraps rather than overflowing.

- [ ] **Step 4: Commit, then `/finish-branch`.**
  ```bash
  git add apps/server packages/reporting packages/shared docs/backlog.md
  git commit -s -m "Kitchen slips, the pass and receipts name all of a party's tables (table actions, Task 4)"
  ```

---

## Task 5: Split, merge and transfer between a party's bills — the server — slug `party-bill-actions`

Spec decisions 4, 5 and 8; §7 (Split a bill, Merge bills, Transfer items, Paid items); §9 ("No
payment ever moves", presented bills unchangeable); §15 (every refusal on each side of a merge);
P3, P20, P21, P26, P27. Branch `feat/party-bill-actions`. Full review wave (money and concurrency).

New routes under `/api/bills/:id/...` land beside the tab routes. The till keeps using the old ones
until Task 10, so nothing the till does changes in this PR.

**Files:**
- Create:
  - `apps/server/src/bill-actions.ts`: `splitBill`, `mergeBills`, `transferItems` and
    `requireUntouched`.
  - `apps/server/src/party-bill-actions.test.ts`.
  - `apps/server/src/till-api.bill-actions.test.ts`.
- Modify:
  - `apps/server/src/working-order.ts`: export `carveOffLines`, `moveOrderLines`,
    `assertDistinctTransferLines` and `refuseHeldLeavingParty` (Task 1's name), which
    `bill-actions.ts` calls. Nothing else in the file changes.
  - `apps/server/src/till-api.ts`: the three routes.
  - `apps/server/src/errors.ts`: no new code; the three from Task 2 are reused.

**Interfaces:**
- Consumes: Task 2's `setMainBill`, `requireBillOfParty` and `bill.*` codes; Task 1's `guardParties`
  and `checkAndBumpParty`.
- Produces:
  ```ts
  // apps/server/src/bill-actions.ts
  export interface BillCommand { expectedPartyRevision?: number; partyId?: string; operatorId: string } // partyId: the party the till read the path bill under
  export async function requireUntouched(tx, billId: string): Promise<void>; // P3's order: bill.paid, tab.not_open, bill.presented, bill.payments_received
  export async function splitBill(tx, cfg, billId: string, transfers: { lineNo: number; quantity?: string }[], command: BillCommand): Promise<{ billId: string }>;
  export async function mergeBills(tx, cfg, intoBillId: string, fromBillId: string, command: BillCommand): Promise<void>;
  export async function transferItems(tx, cfg, fromBillId: string, toBillId: string, transfers: { lineNo: number; quantity?: string }[], command: BillCommand): Promise<void>;
  // wire: POST /api/bills/:id/split { transfers, expectedPartyRevision?, partyId? } → { billId }
  //       POST /api/bills/:id/merge { fromBillId, expectedPartyRevision?, partyId? } → 204   (the path is the bill merged INTO; its party's revision is checked)
  //       POST /api/bills/:id/transfer { toBillId, transfers, expectedPartyRevision?, partyId? } → 204   (the path is the source)
  // expectedPartyRevision is required when the bill belongs to a party (management.request_invalid { field } otherwise), as guardParties does today
  ```

- [ ] **Step 0: Re-map** `carveOffLines`, `moveOrderLines`, `splitOffCheck`, `mergeTabs`,
  `transferLines`, `refusePaidLines`, `refuseBillWithPayments` and `assertBillInvariant`. **Establish
  how a held line is detected today.** `carveOffLines`' `refuseHeld` branch (`working-order.ts:2974`
  on `f19768b3e`) tests for a ticket item with no `fired_at`, and the service plan's D1 says a
  line in a held group has no ticket at all. Run:
  ```bash
  cd apps/server && pnpm exec vitest run src/split-bill.test.ts -t "held"
  ```
  Read which cases pass and what fixture each uses.
  - If a line in a held GROUP (no ticket) passes the split refusal today, `splitBill` must detect a
    held line by `order_groups.state = 'held'` as well as by an unfired ticket. That keeps the
    owner's 2026-09-26 ruling (held work never goes onto a split bill).
  - Record which it is in the ledger. The Step 1 test below fails if the detection is wrong.

- [ ] **Step 1: Write the failing tests.** `apps/server/src/party-bill-actions.test.ts`, on Task 2's
  harness with the `setup` option (Task 2 Step 4's header). Helpers local to the file:
  ```ts
  async function cmd(partyId: string): Promise<{ expectedPartyRevision: number; operatorId: string }> {
    return { expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
  }
  async function splitOff(partyId: string, billId: string, lineNos: number[]): Promise<string> {
    const command = await cmd(partyId);
    const { billId: made } = await inTx(v, (tx) =>
      splitBill(tx, v.cfg, billId, lineNos.map((lineNo) => ({ lineNo })), command),
    );
    return made;
  }
  async function snapshot(partyId: string, billIds: string[]) {
    return {
      party: await partyRow(v, partyId),
      tables: await activeTablesOf(v, partyId),
      bills: await Promise.all(billIds.map(async (id) => ({ row: await billRow(v, id), lines: await linesOf(v, id) }))),
    };
  }
  ```
  Cases (write each in full; the first three are spelled out):
  ```ts
  describe("split a bill", () => {
    it("puts the chosen items on a new bill of the same party, from a bill no table points at", async () => {
      const mesa4 = await v.table("Mesa 4");
      const { partyId, tabId } = await seat(v, mesa4);
      await order(v, tabId, "Burger", "Vino", "Agua");
      const first = await splitOff(partyId, tabId, [2, 3]);   // Vino, Agua off the tab

      const second = await splitOff(partyId, first, [2]);     // Agua off the split bill

      expect((await billRow(v, second)).partyId).toBe(partyId);
      expect((await linesOf(v, first)).map((l) => l.name)).toEqual(["Vino"]);
      expect((await linesOf(v, second)).map((l) => ({ name: l.name, price: l.unitPriceGross, vat: l.vatClass })))
        .toEqual([{ name: "Agua", price: 200, vat: "general" }]);
      expect((await partyRow(v, partyId)).mainBillId).toBe(tabId);
      expect(await activeTablesOf(v, partyId)).toEqual([mesa4]);
    });

    it("refuses a presented bill, changing nothing", async () => {
      const { partyId, tabId } = await seat(v, await v.table("Mesa 5"));
      await order(v, tabId, "Burger", "Vino");
      const checkId = await splitOff(partyId, tabId, [2]);
      await placeByHand(v, checkId);
      const before = await snapshot(partyId, [tabId, checkId]);

      const error = await captureError(() => splitOff(partyId, checkId, [1]));

      expect(error).toMatchObject({ code: "bill.presented", params: { workingOrderId: checkId } });
      expect(await snapshot(partyId, [tabId, checkId])).toEqual(before);
    });

    it("keeps an item already paid for where it is", async () => {
      const { partyId, tabId } = await seat(v, await v.table("Mesa 6"));
      await order(v, tabId, "Burger", "Vino");
      await takeBillPayment({ db: v.db, backend: v.backend, clock: v.clock }, v.cfg, tabId, {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: 1 }],
        method: "cash",
        tendered: "12.00",
        applied: "12.00",
        tip: "0.00",
      }, OPERATOR);
      const before = await snapshot(partyId, [tabId]);

      const error = await captureError(() => splitOff(partyId, tabId, [1]));

      expect(error).toMatchObject({ code: "bill.line_paid", params: { workingOrderId: tabId, lineNo: 1 } });
      expect(await snapshot(partyId, [tabId])).toEqual(before);
    });
  });
  ```
  The remaining cases, each asserting its code AND `snapshot` unchanged:
  - **split:** a held line is refused `tab.split_held_line` (Step 0's detection); a paid bill is
    `bill.paid`; an empty batch is `sale.empty_basket`; a stale revision is `party.out_of_date`;
    a counter order (no party) splits onto a new counter order whose `party_id` is null.
  - **merge:**
    - two untouched bills of one party: every line lands on `into` with its group and credit, and
      `from` is `abandoned`;
    - neither table nor membership changes (`activeTablesOf` equal before and after);
    - `from` was the main bill, so `into` is now main;
    - no payment row exists on either.
  - **merge refusals, each side** (spec §15). For `from` presented, partly paid, paid; then for
    `into` presented, partly paid, paid:
    - presented is `bill.presented`, partly paid is `bill.payments_received`, paid is `bill.paid`;
    - bills of two parties are `bill.other_party`, and so are a party bill and a counter order;
    - the same bill twice is `tab.merge_self`.

    "Partly paid" is a received cash contribution of €5.00 through `takeBillPayment` (import it
    from `./bill-payments.js`, as `visits.test.ts` does).
  - **merge, a refunded payment:** a bill whose only payment was refunded in full is still refused
    `bill.payments_received` (P3: "has received any payment"). Refund with `refundBillPayment` from
    `./bill-refunds.js`.
  - **transfer:** chosen items move between two untouched bills of one party, keeping price, VAT
    class, group and credit, and the party revision moves on by one. The refusals mirror merge's
    (each side presented, partly paid, paid; other party; same bill is `tab.transfer_self`).
  - **two tills at once:** each is run in BOTH orders, as sequential calls (Global Constraints).
    Because the revision is checked before any bill check (Step 2), the second call is refused
    `party.out_of_date` in both orders, never `tab.not_open`.
    - Till A merges B2 into B1 while till B transfers an item from B2 to B3, both having read the
      same party revision. Whichever runs second gets `party.out_of_date`, and the snapshot equals
      the state after the first alone. When the transfer runs second, its path bill B2 is already
      abandoned, and it is still `party.out_of_date`.
    - Till A splits B1 while till B merges B1 away (B1 into B3): the same. When the split runs
      second, B1 is abandoned, and it is still `party.out_of_date`.
    - A request whose `partyId` names a party the path bill is no longer in is `party.out_of_date`,
      even when the revision it sends equals the bill's party's current revision.

  `apps/server/src/till-api.bill-actions.test.ts` covers the HTTP surface:
  - no session is 401;
  - a malformed id is `tab.not_open`, as the tab routes do (`till-api.ts:1900`);
  - a bill of a party with no `expectedPartyRevision` is 400 `management.request_invalid`
    `{ field: "expectedPartyRevision" }`;
  - each new code is 409;
  - a split answers `{ billId }`;
  - a split that leaves the source fully paid issues its invoice (`issueIfFullyPaid`, as the tab
    split route does at `till-api.ts:1960`). The fixture pays line 1 by an item payment, then splits
    line 2 away, and `registroCount` for the source becomes 1.

  Run:
  ```bash
  cd apps/server && pnpm exec vitest run src/party-bill-actions.test.ts src/till-api.bill-actions.test.ts
  ```
  Expected: FAIL. `./bill-actions.js` does not exist and the routes answer 404.

- [ ] **Step 2: Implement `apps/server/src/bill-actions.ts`.**
  ```ts
  export async function requireUntouched(tx: Transaction, billId: string): Promise<void> {
    const [bill] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    if (bill?.status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
    if (bill === undefined || bill.status === "abandoned") throw new AppError("tab.not_open", { tabId: billId });
    if (bill.status === "placed") throw new AppError("bill.presented", { workingOrderId: billId });
    await refuseBillWithPayments(tx, billId);
  }

  /**
   * The party of the path bill, checked and moved on BEFORE any bill check (P27): a till acting on
   * a party another till has just changed is told `party.out_of_date`, whatever that change did to
   * the bill. `party.not_open` comes first (`checkAndBumpParty`). A counter order has no party and
   * no revision. Returns the party, or null.
   */
  async function guardPathParty(tx: Transaction, billId: string, command: BillCommand): Promise<string | null> {
    const [bill] = await tx
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    if (bill === undefined) throw new AppError("tab.not_open", { tabId: billId });
    if (bill.partyId === null) return null;
    if (command.partyId !== undefined && command.partyId !== bill.partyId) {
      const read = await partyRevisionOf(tx, command.partyId); // that party's revision now
      throw new AppError("party.out_of_date", { partyId: command.partyId, revision: read });
    }
    await guardParties(tx, bill.partyId, null, command);
    return bill.partyId;
  }

  async function requireSameParty(tx: Transaction, partyId: string | null, otherBillId: string): Promise<void> {
    if (partyId === null || (await partyOfOrder(tx, otherBillId)) !== partyId) {
      throw new AppError("bill.other_party", { workingOrderId: otherBillId });
    }
  }

  export async function mergeBills(tx, cfg, intoBillId, fromBillId, command): Promise<void> {
    if (intoBillId === fromBillId) throw new AppError("tab.merge_self", { tabId: intoBillId });
    // The revision checked is that of the party of the bill merged INTO (the path bill); both bills
    // must be of that one party, so it is the only party a merge touches.
    const partyId = await guardPathParty(tx, intoBillId, command);
    await requireSameParty(tx, partyId, fromBillId);
    await requireUntouched(tx, fromBillId);
    await requireUntouched(tx, intoBillId);
    const [party] = await tx.select({ mainBillId: parties.mainBillId }).from(parties).where(eq(parties.id, partyId));
    const before = await readSentWork(tx, cfg, fromBillId);
    await moveOrderLines(tx, cfg, fromBillId, intoBillId, undefined, { modesChecked: true });
    await moveKitchenPrintLinks(tx, fromBillId, intoBillId);
    await bumpRevision(tx, [fromBillId, intoBillId]);
    await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, fromBillId));
    if (party!.mainBillId === fromBillId) await setMainBill(tx, partyId, intoBillId);
    await enqueueMovedSlips(tx, cfg, before, intoBillId);
  }
  ```
  `modesChecked: true` is sound here: both bills are open bills of one party, and every bill of a
  party carries the party's zone. Splits copy it (`VENUE_SERVICE.copyOrderContext`), and Task 7's moves retarget
  it. Say so in one line at the call.
  **The order of checks is the point** (P27): the path bill's party, then its revision, then that
  the other bill is of the same party, then the bills' own state. Checking a bill's state first
  would answer the second of two tills with `tab.not_open` or `bill.other_party` in one order and
  `party.out_of_date` in the other.
  - `party.out_of_date`'s params are `{ partyId, revision }` (Task 1's rename of
    `visit.out_of_date`, `apps/server/src/errors.ts:320`). `partyRevisionOf` is a small private
    reader in `bill-actions.ts`.
  - `BillCommand` gains `partyId?: string`, the party the till read the path bill under. It guards
    against a stale revision that happens to equal another party's current one. The till sends it
    from Task 10 on.
  - `transferItems` (the path bill is the source):
    1. `tab.transfer_self` when both bills are one;
    2. `guardPathParty(tx, fromBillId, command)`;
    3. `requireSameParty(tx, partyId, toBillId)`;
    4. `requireUntouched` for each;
    5. `assertDistinctTransferLines`;
    6. `carveOffLines(tx, cfg, from, to, transfers, { refuseHeld: false, leavesParty: false })`;
    7. `bumpRevision` on both, `assertBillInvariant(tx, [from])`, and `enqueueMovedSlips` with the
       split map.
  - `splitBill`:
    1. `sale.empty_basket` for an empty batch;
    2. `assertDistinctTransferLines`;
    3. `guardPathParty(tx, billId, command)`;
    4. the P3 status checks without the payment check (a partly paid bill may be split; its paid
       items stay, through `refusePaidLines` inside `carveOffLines`);
    5. `createOpenOrder(tx, cfg, newId, [], label, { partyId })`, then `VENUE_SERVICE.copyOrderContext(tx, cfg, billId, newId)`;
    6. `carveOffLines(…, { refuseHeld: true, leavesParty: false })`, with Step 0's held detection;
    7. `bumpRevision` on both, and `assertBillInvariant(tx, [billId])`.

  The routes: `requireTabParam` for the path id, a UUID check on `fromBillId` and `toBillId`, and
  `partyCommand(personId, body)` from Task 1. `partyId`, when present, must be a UUID, else
  `management.request_invalid` `{ field: "partyId" }`. Each route opens one `withTransaction`. The split
  route runs `issueIfFullyPaid` on the source inside `withSaleTillWhenIssuing`, as
  `/api/tabs/:id/split` does.

  Run the Step 1 command: PASS.

- [ ] **Step 3: The fiscal gates, unedited.**
  ```bash
  cd packages/fiscal-verifactu && pnpm exec vitest run src/write-path.e2e.test.ts
  git grep -l inmutabilidad -- '*.test.ts' | head -1   # then run that file the same way
  ```
  Expected: PASS with no edit to either.

- [ ] **Step 4: Commit, then `/finish-branch`.**
  ```bash
  git add apps/server docs/backlog.md
  git commit -s -m "Split, merge and transfer between a party's bills, only between untouched bills (table actions, Task 5)"
  ```

---

## Task 6: Collecting a bill follows its invoice, not its zone — slug `party-collect-by-invoice`

Spec §9 ("Collection follows the bill's issuance history … the plan must also make collection check
for an already-issued invoice rather than rely on the mode alone"); P22. Branch
`feat/party-collect-by-invoice`. Full review wave (fiscal: which path issues or settles an invoice).

It lands before any path can change a placed bill's zone (Task 7), so the case it guards is built by
a direct retarget in the test.

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`collectOrder`, `:1479-1567` on `f19768b3e`).
- Create: `apps/server/src/collect-by-invoice.test.ts`.

**Interfaces:**
- Consumes: nothing new.
- Produces: no new name. `collectOrder`'s rule becomes "settle the sale a `sales` row names for this
  bill, else issue one". The mode is no longer read for this choice.

- [ ] **Step 0: Re-map** `collectOrder`, `placeOrder` (`working-order.ts:4630-4746` on `f19768b3e`),
  `readOutstandingSaleForOrder` (`till-sale.ts:711-731`), `parkOrder` and `offerProducts` (its
  `serviceMode` option).

- [ ] **Step 1: Write the failing test.**
  ```ts
  // apps/server/src/collect-by-invoice.test.ts
  import { randomUUID } from "node:crypto";
  import { eq } from "drizzle-orm";
  import { describe, expect, it } from "vitest";
  import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
  import { useVenueDb } from "@waitron/db/testing/venue-db.js";
  import { sales, workingOrders, withTransaction } from "@waitron/db";
  import { VENUE_SERVICE } from "./modules.js";
  import { parkOrder, placeOrder } from "./working-order.js";
  import { collectOrder } from "./till-sale.js";
  import { offerProducts } from "./testing/zone-offers.js";
  import { provisionBillVenue, registroCount, type BillVenue } from "./testing/bill-venue.js";
  import "./errors.js";

  let venue: BillVenue;
  useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
    setup: async (db) => {
      venue = await provisionBillVenue(db);
    },
  });

  describe("collecting a presented bill (spec §9)", () => {
    it("settles the invoice already issued, even once the bill's zone says to issue at payment", async () => {
      const { invoiceFirst, prepay } = await withTransaction(venue.db, async (tx) => ({
        invoiceFirst: await offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "invoice_first" }),
        prepay: await offerProducts(tx, venue.cfg, { zone: "tables", serviceMode: "prepay" }),
      }));
      const id = randomUUID();
      const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
      await parkOrder(deps, venue.cfg, {
        id,
        lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
        zoneId: invoiceFirst.zoneId,
        operatorId: venue.operatorId,
      });
      await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
      const [issued] = await withTransaction(venue.db, (tx) =>
        tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, id)),
      );
      await withTransaction(venue.db, (tx) => VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, id, prepay.zoneId));

      await collectOrder(deps, venue.cfg, { id, lines: [], tender: { method: "cash", amount: "18.00" } }, venue.operatorId);

      const after = await withTransaction(venue.db, (tx) =>
        tx.select({ id: sales.id, settledAt: sales.settledAt }).from(sales).where(eq(sales.workingOrderId, id)),
      );
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(issued!.id);
      expect(after[0]!.settledAt).not.toBeNull();
      expect(registroCount(venue, id)).toBe(1);
      const [order] = await withTransaction(venue.db, (tx) =>
        tx.select({ status: workingOrders.status }).from(workingOrders).where(eq(workingOrders.id, id)),
      );
      expect(order!.status).toBe("settled");
    });
  });
  ```
  - `venue.offerFor("Tarta")` offers from the bill venue's own zone. If `parkOrder` refuses it in the
    `invoiceFirst` zone, use `invoiceFirst.offerFor(productId)` with the product id from the venue's
    catalogue instead.
  - Check `sales.settledAt`'s real column name, and `collectOrder`'s and `placeOrder`'s signatures,
    on the `main` you start from.

  Run: `cd apps/server && pnpm exec vitest run src/collect-by-invoice.test.ts`.
  - **What the failing run should print:** on today's code the mode now reads `prepay`, so
    `collectOrder` takes `fileImmediateSale`. That tries to insert a second `sales` row for the bill,
    and the unique key `sales_working_order_id_key` refuses it, or a second registro is written.
  - If the test PASSES on today's code, it measures nothing (CLAUDE.md §1). Find out why before
    going on; for example, `retargetOrderContext` refusing a placed order would mean the fixture
    never reached the case.

- [ ] **Step 2: Implement.** In `collectOrder`, replace the mode branch with the sale lookup it
  already makes:
  ```ts
  const [issued] = await tx
    .select({ id: sales.id, total: sales.total })
    .from(sales)
    .where(eq(sales.workingOrderId, req.id));
  if (issued !== undefined) {
    // settle it: the body of today's invoice_first branch, from `settlementFor` down, unchanged
  }
  const order = await priceStoredOrderForIssuance(tx, req.id);
  return fileImmediateSale(tx, deps, cfg, req.id, req.tender, order, operatorId, true);
  ```
  - Delete the `serviceContext` and `orderFlow` reads.
  - Delete the `v8 ignore`d corruption throw for a missing sale. A placed bill with no sale is now
    simply the issue-at-payment path, which `placeOrder` produces for every mode but invoice-first.

  Run Step 1: PASS. Then run every collect case:
  ```bash
  cd apps/server && pnpm exec vitest run src/till-sale.test.ts src/working-order.pay-and-dispatch.test.ts src/device-api.test.ts src/collect-by-invoice.test.ts
  ```
  Expected: PASS.

- [ ] **Step 3: The fiscal gates, unedited** (Task 5 Step 3's commands). Expected: PASS.

- [ ] **Step 4: Commit, then `/finish-branch`.**
  ```bash
  git add apps/server
  git commit -s -m "Collecting a presented bill settles its invoice whatever its zone now says (table actions, Task 6)"
  ```

---
## Task 7: Move a bill — to another party, to a table, to and from the counter — the server — slug `party-move-bill`

Spec decisions 5, 11, 12 and 15; §7 (Move a bill, Kitchen groups when a bill leaves its party,
Service area of a moved bill); §8 (MOVED for bill moves and the counter); §9 (no payment moves; a
presented bill moves whole; collection follows issuance); §15 (money, main bill, presented bill,
paid bill, kitchen groups, MOVED, service area).
- It builds A81 (a counter order to a table) and A82 (a table's bill to the counter), whose till
  half is Task 12.
- Plan decisions: P2, P12, P14, P15, P16 (leaving), P18, P19, P25 and P27.
- Branch `feat/party-move-bill`. Full review wave: money, a trigger on the fiscal-adjacent
  transition rule, and concurrency.

**Files:**
- Create:
  - `apps/server/src/move-bill.ts`: `moveBill`.
  - `apps/server/src/party-move-bill.test.ts`, which covers the domain on Task 2's harness.
  - `apps/server/src/till-api.move-bill.test.ts`, which covers money through the routes on
    `testing/bill-venue.ts`, with its fake card provider and two tills.
  - One custom core migration holding both placed exceptions (P14): the bill's transition trigger,
    and the line trigger's group-only exception.
- Modify:
  - `apps/server/src/till-api.ts`: `POST /api/bills/:id/move`.
  - `apps/server/src/testing/party-venue.ts`: a counter zone, `counterOrder` and `counterItem`.
  - `apps/server/src/testing/bill-venue.ts`: a `seatedWith(venue, ...names)` helper that seats a
    party through the route and orders through `/api/parties/:id/groups`.
  - `apps/server/src/errors.ts`: `party.main_bill_stays` and `table.already_in_party`
    (`table.needs_cleaning` exists from Task 3).
  - `apps/till/src/i18n/codes.ts`: their wording, and `table.inactive`'s, which a move to a table
    can now meet. On `f19768b3e` `codes.ts` has only two `table.*` entries, `table.occupied` and
    `table.not_shared`. `table.inactive` has its 409 in `STATUS` (`till-api.ts:328`), and
    `table.not_found`'s wording comes from Task 3.
  - `scripts/behavioural-triggers.test.ts`: the placed exception.

**Interfaces:**
- Consumes:
  - Task 2's `setMainBill`, `partyMainBill` and `partyZone`;
  - Task 3's `table.needs_cleaning` check;
  - Task 4's `readSentWork` and `enqueueMovedSlips`, per bill;
  - Task 5's `requireUntouched` and `mergeBills`;
  - Task 1's `openParty`, `checkAndBumpParty`, `refuseHeldLeavingParty` and `clearGroups`.
    `clearGroups` is private in `working-order.ts` (`:3140` on `f19768b3e`); this task exports it.
- Produces:
  ```ts
  // apps/server/src/move-bill.ts
  export type MoveTarget = { tableId: string } | { counter: { zoneId: string | null } };
  export interface MoveBillOptions {
    bills: "merge" | "separate";                  // P12, default "merge" at the route
    expectedPartyRevision?: number;               // the bill's own party, required when it has one
    partyId?: string;                             // the party the till read the bill under (P27)
    expectedOtherPartyRevision?: number;          // the party holding the target table, required when one does
    operatorId: string;
  }
  export interface MoveBillResult { partyId: string | null; billId: string; merged: boolean } // billId: the moved bill, or the main bill it merged into
  export async function moveBill(tx, cfg, billId: string, to: MoveTarget, options: MoveBillOptions): Promise<MoveBillResult>;
  export async function isUntouched(tx, billId: string): Promise<boolean>; // requireUntouched without throwing (Task 5's order)
  export async function takeIntoParty(tx, cfg, billId: string, partyId: string, zoneId: string | null): Promise<void>; // party_id, delivery_table_id null, revision, the area rule (P15); Tasks 8 and 9 reuse it
  export async function leaveParty(tx, billId: string): Promise<void>; // group.held_leaves_party for held dishes; clears sent dishes' groups (P16)
  // apps/server/src/kitchen-print.ts (changed)
  export async function enqueueMovedSlips(tx, cfg, before: SentWork, toOrderId: string, splitFrom?: ReadonlyMap<string, string>, options?: { force?: boolean }): Promise<void>;
  // wire: POST /api/bills/:id/move { to: { tableId } | { counter: { zoneId } }, bills?, expectedPartyRevision?, partyId?, expectedOtherPartyRevision? } → MoveBillResult
  // codes: party.main_bill_stays { partyId }, table.already_in_party { tableId } — 409
  ```

- [ ] **Step 0: Re-map, and establish two things by running them.**
  1. Read the current definition of `working_orders_enforce_transition`: the last migration that
     re-creates it, `0019_settled_order_freeze_visit_id.sql` on `f19768b3e`, unless B9 or a later
     task re-created it. Also read `packages/db/src/schema/orders.ts` for every `working_orders`
     column. The exception in Step 3 names every column except `party_id`, `delivery_table_id` and
     `revision`.
  2. **How a test gives one dish two prices in two zones.** No suite on `f19768b3e` does it:
     `git grep -n -i "priced differently\|two zones" apps/server/src/*.test.ts` finds nothing, and
     `offerProducts` puts every zone on one shared menu at the product's own price
     (`apps/server/src/testing/zone-offers.ts`, its doc comment). Find the catalogue call that gives
     a menu item its own price with
     `git grep -n "price" packages/catalogue/src/menu*.ts | head -40`. `menu_items.price` has been
     nullable since `packages/catalogue/drizzle/0003_menu_price_nullable.sql`. Write
     `pricedInZone(v, zoneId, productName, price)` in the harness: a second menu with that item at
     that price, allowed and made default in that zone, then published (`publishWorkingMenu`,
     `apps/server/src/testing/publish-menu.ts`).
     - **Its proof:** before any move, a counter order line for Caña reads 350 cents and a table
       line for Caña reads 300.
     - The Step 1 test asserts both first, so a fixture that did not take fails there, not later.

- [ ] **Step 1: Write the failing domain tests** in `apps/server/src/party-move-bill.test.ts`.
  Harness as in Task 2 Step 4. `cmd(partyId)` is as in Task 5. `move` is a local helper:
  ```ts
  async function move(billId: string, to: MoveTarget, opts: Partial<MoveBillOptions> = {}) {
    const own = (await billRow(v, billId)).partyId;
    const target = "tableId" in to ? await partyAt(v, to.tableId) : null;
    const options: MoveBillOptions = {
      bills: "merge",
      operatorId: OPERATOR,
      ...(own === null ? {} : { expectedPartyRevision: await revisionOf(v, own) }),
      ...(target === null || target === own ? {} : { expectedOtherPartyRevision: await revisionOf(v, target) }),
      ...opts,
    };
    return inTx(v, (tx) => moveBill(tx, v.cfg, billId, to, options));
  }
  ```
  `partyAt(v, tableId)` is a harness helper: the party holding the table now, or null.

  ```ts
  describe("move a bill to another party (after Split a table, or guests joining)", () => {
    it("keeps its id, its lines' prices and VAT class, and lands as a separate bill when it has been paid towards", async () => {
      const mesa4 = await v.table("Mesa 4");
      const mesa7 = await v.table("Mesa 7");
      const ana = await seat(v, mesa4);
      const luis = await seat(v, mesa7);
      await order(v, ana.tabId, "Burger", "Vino");
      const checkId = await splitOff(ana.partyId, ana.tabId, [2]);
      await cashContribution(v, checkId, "10.00");           // partly paid: stays separate
      const linesBefore = await linesOf(v, checkId);

      const result = await move(checkId, { tableId: mesa7 });

      expect(result).toEqual({ partyId: luis.partyId, billId: checkId, merged: false });
      const row = await billRow(v, checkId);
      expect(row.partyId).toBe(luis.partyId);
      expect(row.status).toBe("open");
      expect(await linesOf(v, checkId)).toEqual(linesBefore);
      expect(await paymentsOf(v, checkId)).toHaveLength(1);
      expect((await partyRow(v, luis.partyId)).mainBillId).toBe(luis.tabId);
      expect((await partyRow(v, ana.partyId)).mainBillId).toBe(ana.tabId);
      expect(await activeTablesOf(v, ana.partyId)).toEqual([mesa4]);
      expect(await activeTablesOf(v, luis.partyId)).toEqual([mesa7]);
    });

    it("merges into the receiving main bill by default when both are untouched", async () => {
      const ana = await seat(v, await v.table("Mesa 5"));
      const luis = await seat(v, await v.table("Mesa 8"));
      await order(v, ana.tabId, "Burger", "Vino");
      await order(v, luis.tabId, "Agua");
      const checkId = await splitOff(ana.partyId, ana.tabId, [2]);

      const result = await move(checkId, { tableId: (await activeTablesOf(v, luis.partyId))[0]! });

      expect(result).toEqual({ partyId: luis.partyId, billId: luis.tabId, merged: true });
      expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua", "Vino"]);
      expect((await billRow(v, checkId)).status).toBe("abandoned");
    });

    it("keeps it separate when asked, even when both are untouched", async () => {
      const ana = await seat(v, await v.table("Mesa 6"));
      const luis = await seat(v, await v.table("Mesa 9"));
      await order(v, ana.tabId, "Burger", "Vino");
      await order(v, luis.tabId, "Agua");
      const checkId = await splitOff(ana.partyId, ana.tabId, [2]);

      const result = await move(checkId, { tableId: (await activeTablesOf(v, luis.partyId))[0]! }, { bills: "separate" });

      expect(result).toEqual({ partyId: luis.partyId, billId: checkId, merged: false });
      expect((await billRow(v, checkId)).status).toBe("open");
      expect((await billRow(v, checkId)).partyId).toBe(luis.partyId);
      expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
      expect((await partyRow(v, luis.partyId)).mainBillId).toBe(luis.tabId);
    });
  });
  ```
  `cashContribution(v, billId, amount)` and `paymentsOf(v, billId)` are harness helpers added by
  this task (`takeBillPayment` with a cash contribution, and a read of `bill_payments`).
  `splitOff` is Task 5's local helper, copied here.

  The remaining cases. Each reads the parties, memberships, tables and bills back, and each refusal
  also asserts that nothing changed, with Task 5's `snapshot` extended by the target party:
  - **A paid bill** is refused `bill.paid`. An abandoned bill is `tab.not_open`.
  - **The main bill while the party holds another unpaid bill** is `party.main_bill_stays`. The
    party's ONLY unpaid bill, which is main, moves. Ana's `main_bill_id` is then null, and her next
    order (`orderForParty`) makes a new main bill (spec §15, the main bill).
  - **Moving to a table of the bill's own party** is `table.already_in_party`. Moving to a table
    that needs cleaning is `table.needs_cleaning`.
  - **Held dishes cannot leave:** a bill holding a line in a held group is refused
    `group.held_leaves_party`, and nothing moves (spec §15, kitchen groups).
  - **Sent dishes leave their group:** a bill whose dishes were fired moves. Each moved line's
    `group_id` is null, and its ticket item keeps its `state`, `fired_at` and `away_at`. Its
    `served_quantity`, or whatever B9 names it, is unchanged (spec §15).
  - **To a free table** (A81's shape, from a party):
    - a new party opens on that table with `name` null, and the bill is its main;
    - the old party keeps its tables;
    - the new table reads held, and the bill's zone is that table's.
  - **To the counter** (A82):
    - the bill's `party_id` is null, and its `label` is the old party's display name ("Mesa 4");
    - it appears in `listHeldOrders`;
    - its zone is the counter zone sent, and the old party's main bill follows the P25 rule.
  - **From the counter into a party** ("I'll pay it with my meal"):
    - a parked counter order moves to Mesa 4 and merges into Ana's main bill when both are
      untouched;
    - kept separate with `bills: "separate"`, and its `delivery_table_id` is cleared.
  - **A counter order seated at a free table** (A81): a new party is opened, the bill is main, and
    the table is held.
  - **The service area** (spec §15):
    - with the Step 0 fixture, a counter order holding one Caña (350 cents, `general`) moves into
      Ana's party at a tables-zone table;
    - the existing line still reads 350 cents and `general`;
    - a new Caña ordered on that bill (`orderForParty` with `billId`) reads 300 cents;
    - `zoneOf(v, billId)` reads the tables zone.
  - **A presented bill keeps its zone** (P15):
    - an invoice-first counter order is placed (Task 6's fixture) and moved into Ana's party;
    - its zone is still the counter zone, its `status` is still `placed`, and its lines are
      unchanged;
    - an order naming it as `billId` is `bill.presented` (Review Focus 5).
  - **A presented party bill leaves its party (P14's line exception):**
    - Ana's split bill holds two dishes fired as a group, and is placed with `placeByHand`;
    - moved to Luis's table, it keeps `status: "placed"`, every line's name, quantity, price and VAT
      class, and its zone. Each line's `group_id` is null, and each ticket item keeps its `state`
      and `fired_at`;
    - moved to the counter instead: the same, with `party_id` null and its `label` unchanged, since
      P18 rewrites the label of an OPEN bill only;
    - **what the failing run should print before Step 3:** the engine's
      `lines may only be written while the order is open`, surfacing as a 500, not a domain code.
  - **MOVED notices** (spec §15):
    - moving a bill with two sent dishes and one unsent dish from Mesa 4's party to Mesa 7's
      records exactly two `moved` notices, naming "Mesa 7" for both dishes;
    - moving it to the counter records a `moved` notice for each of its two sent dishes, even
      though its header label ("Mesa 4") reads the same after the move (P17's exception);
    - moving a placed counter order with sent dishes into Ana's party records one `moved` notice per
      sent dish, naming Ana's tables;
    - dishes on the party's OTHER bill get no notice in any of these.
  - **Two tills at once**, in both orders as sequential calls:
    - Till A moves Ana's split bill to Mesa 7 while till B merges it back into Ana's main bill,
      both from one read of Ana's revision. The second is refused `party.out_of_date`, and the
      state is the first alone. **Why both orders give that code:**
      - Move then merge: the merge checks the revision of the party of the bill merged INTO, which
        is Ana's main bill. The move moved Ana's revision on, and the revision is checked before
        `requireSameParty`, so the merge never reaches `bill.other_party`.
      - Merge then move: the merged-away bill is `abandoned`, but it still names Ana's party. The
        move checks Ana's revision before the bill's state, so it never reaches `tab.not_open`.
    - Till A moving the bill while till B pays Luis's party's main bill: the payment does
      not read the party revision, so both succeed; assert that. That is the honest outcome, and it
      pins that a payment is never refused by a bill move elsewhere in the party.
  - **Review Focus 2:**
    - Ana's only unpaid bill (main) moves to the counter;
    - `finishTable` on Ana's party then succeeds, her tables follow P8, and her party is closed;
    - the counter bill is collected by a cash payment through `payWorkingOrder`, with one sale and
      `registroCount` 1.

  Run: `cd apps/server && pnpm exec vitest run src/party-move-bill.test.ts`. Expected: FAIL, because
  `./move-bill.js` does not exist.

- [ ] **Step 2: Write the failing money tests** in `apps/server/src/till-api.move-bill.test.ts`, on
  `provisionBillVenue`. Everything goes through the routes, with the helpers of
  `bill-payments.card.test.ts:36-128` (`pay`, `cardContribution`, `heldCard`) copied into this file.
  They are local to that file.
  ```ts
  it("finishes a card payment still at the reader on the bill it began on, after the bill moved party", async () => {
    const ana = await seatedWith(venue, "Tarta", "Pulpo");              // €18.00 + €20.00
    const luis = await seatedWith(venue, "Caña");
    const split = await send(venue.app, venue.cookie, "POST", `/api/bills/${ana.tabId}/split`, {
      transfers: [{ lineNo: 2 }], expectedPartyRevision: ana.revision,
    });
    const billId = split.json.billId as string;                         // Pulpo, €20.00
    const body: Body = {
      submissionId: randomUUID(), kind: "contribution", amount: "20.00",
      method: "card", entry: "reader", applied: "20.00", tip: "0.00",
    };
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const first = pay(billId, body);
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));

    const moved = await send(venue.app, venue.cookie2, "POST", `/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId }, bills: "merge",
      expectedPartyRevision: ana.revision + 1, expectedOtherPartyRevision: luis.revision,
    });
    release();
    const answered = await first;
    const retry = await pay(billId, body);

    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ partyId: luis.partyId, billId, merged: false });
    expect(answered.json).toMatchObject({ outcome: "received", invoice: { total: "20.00" } });
    expect(retry.json).toMatchObject({ outcome: "received", invoice: { total: "20.00" } });
    expect(venue.card.collectCalls.length).toBe(calls + 1);
    expect(await paymentRows(venue, billId)).toHaveLength(1);
    expect(registroCount(venue, billId)).toBe(1);
  });
  ```
  - `seatedWith` answers `{ partyId, tabId, tableId, revision }`.
  - `ana.revision + 1` is the party revision after the split, which moves it on once. Read it back
    with `GET /api/tables/state` instead if Step 0 shows the split moves it by a different amount.
  - `merged: false` holds because the moved bill holds a pending payment, so it is not untouched (P3).

  The remaining money cases (spec §15):
  - **A partly paid bill moved to another party keeps its payments.** A cash contribution of €5.00,
    then a move to Luis's table: `paymentRows` is unchanged, and its `working_order_id` is the same
    bill.
  - **A refund of an earlier payment runs after the move,** through
    `/api/working-orders/:billId/payments/:paymentId/refunds` with the administrator's PIN, as in
    `bill-refunds.card.test.ts:131-150`.
  - **An item payment** (`kind: "items"`, line 1) made before the move stays applied to that line.
    After the move, paying the rest settles the bill with ONE invoice whose lines are both dishes.
  - **A presented (invoice-first) counter bill moved into a party in another zone and then
    collected** (spec §15): `POST /api/working-orders/:id/collect` settles the SAME sale. There is
    one `sales` row, `registroCount` is 1, and the bill is `settled`. Task 6 made collection follow
    the invoice.
  - **A paid bill** is refused `bill.paid` by the route, with status 409.

  Run: `cd apps/server && pnpm exec vitest run src/till-api.move-bill.test.ts`. Expected: FAIL (404).

- [ ] **Step 3: The two placed exceptions (P14).** Run `pnpm --filter @waitron/db db:generate:custom
  --name=placed_bill_moves`. The migration drops and re-creates TWO triggers:
  `working_orders_enforce_transition` and `working_order_lines_require_open_parent_update`.

  **Take each trigger's current text from `sqlite_master` on a database migrated to this branch's
  head, never from the migration file that last wrote it.**
  ```bash
  cd apps/server && pnpm exec vitest run src/party-move-bill.test.ts -t "prints the trigger text"
  ```
  - That is a throwaway case you write and delete in this step. Its body is:
    ```ts
    console.log(v.db.all(sql`
      select name, sql from sqlite_master
      where name in ('working_orders_enforce_transition', 'working_order_lines_require_open_parent_update')
    `));
    ```
    Run it with `--reporter=verbose`, since Vitest hides a passing test's console output
    (`docs/developers/testing-guide.md`).
  - **Why it must be `sqlite_master`:** Task 1's `RENAME COLUMN` rewrote the stored trigger to say
    `party_id`, while `0019_settled_order_freeze_visit_id.sql` still says `visit_id`.
  - Copying the file's text would create a trigger that names a missing column. SQLite accepts
    that at creation, and every later update of `working_orders` then fails
    `no such column: new.visit_id` (probed by the plan review on `node:sqlite` v26.7.0).
  - The same applies to the line trigger: B9's `0033_line_served_exception.sql` re-created it with
    a served-quantity exception, which must be kept.

  **The bill's trigger:** the current text, plus this clause before the settled clause. The list
  must name every `working_orders` column except `status`, `party_id`, `delivery_table_id` and
  `revision`. On `f19768b3e`, after Task 1's rename, that is this list:
  ```sql
    OR (old.status = 'placed' AND new.status = 'placed'
        AND new.id IS old.id
        AND new.till_id IS old.till_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.payment_attempt_at IS old.payment_attempt_at)
  ```
  Its comment says: a presented bill may change party, lose its delivery table and move its revision
  on, and nothing else, because moving it whole changes no fiscal content (spec §9).

  **The line trigger:** the current text, with its `WHERE NOT exists (… status = 'open')` widened so
  that a line of a `placed` bill may be updated when ONLY `group_id` changes. Every other column of
  `working_order_lines` must be compared `new.<col> IS old.<col>`: read the full column list from
  `pragma table_info(working_order_lines)` on the migrated database, and list every column except
  `group_id`. Keep B9's served exception exactly as it is. Its comment says: which kitchen group a
  dish belongs to is kitchen state, not invoice content (the watcher's decision, P14).

  Add to `scripts/behavioural-triggers.test.ts`, on a placed fixture order:
  - the bill's row:
    - changing `party_id` alone is allowed;
    - changing `delivery_table_id` alone is allowed;
    - changing `revision` alone is allowed;
    - changing `label` alone is refused;
    - changing `payment_attempt_at` alone is refused;
    - changing `party_id` AND `label` together is refused;
    - `placed → open` is still refused;
  - its lines:
    - changing `group_id` alone (to a group, and to null) is allowed;
    - changing `quantity` alone is refused;
    - changing `unit_price_gross` alone is refused;
    - changing `group_id` AND `quantity` together is refused;
    - inserting a line is still refused, and so is deleting one;
  - a SETTLED bill's line: changing `group_id` alone is still refused (the exception is for
    `placed` only).

  Run `pnpm exec vitest run scripts/behavioural-triggers.test.ts`. Expected: the "allowed" cases
  FAIL before the migration and PASS after, and every refusal passes both before and after.

- [ ] **Step 4: Implement `apps/server/src/move-bill.ts`.** In this order, all in the caller's
  transaction, each query awaited in turn. **The parties and their revisions come before any bill
  check** (P27, Task 5 Step 2), so a second till is always told `party.out_of_date`.
  1. Read the bill's `party_id`; a missing bill is `tab.not_open`.
     - When it has a party: `checkAndBumpParty(source, expectedPartyRevision, "open")`, which gives
       `party.not_open` first, then `party.out_of_date`. An absent revision is
       `management.request_invalid` `{ field: "expectedPartyRevision" }`, and a `partyId` sent that
       differs is `party.out_of_date` (Task 5's `guardPathParty`).
  2. Resolve the target.
     - `{ counter }` gives target party null.
     - `{ tableId }`: read the table and its holding party (an active `party_tables` row).
       - When another party holds it:
         `checkAndBumpParty(target, expectedOtherPartyRevision, "open")`.
       - Then `table.not_found` or `table.inactive`, and `table.needs_cleaning` when
         `needs_cleaning_since` is set.
       - A table held by the bill's own party is `table.already_in_party`.
       - A free table in a zone whose mode is not `table_tab` is `service_zone.mode_incompatible`,
         exactly as seating refuses it (`openTab`, `working-order.ts:1002-1010`). This is the seat
         refusal, not a bill-to-bill mode check (P15).
  3. The bill's own state (`status` and `label`):
     - `abandoned` is `tab.not_open`, and `settled` is `bill.paid`;
     - a counter order sent to the counter is `management.request_invalid` `{ field: "to" }`.
  4. Leaving the source party, when there is one:
     - if the bill is the source's main bill and the source holds any other bill that is `open` or
       `placed`, refuse `party.main_bill_stays` (P25);
     - `leaveParty(tx, billId)`: `refuseHeldLeavingParty` over the bill's top-level lines, then
       `clearGroups` over those whose `group_id` is not null. Filtering them out keeps the writes
       down; the line-trigger exception (Step 3) allows a placed bill's group change either way.
  5. `const before = await readSentWork(tx, cfg, billId);`
  6. Move the bill.
     - **Counter:** update `party_id: null`. When the bill is `open`, also set
       `label: partyDisplayName(source.name, sourceLabels)` (P18). Then `bumpRevision`. When the bill
       is open and `zoneId` is not null, retarget, or record the context if it has none.
     - **Free table:** `openParty(tx, { guestCount: null, operatorId, tableId })`, then
       `takeIntoParty(tx, cfg, billId, newParty, table.zoneId)`. When the bill is open, call
       `setMainBill(tx, newParty, billId)`.
     - **Held table:** `takeIntoParty(tx, cfg, billId, target, await partyZone(tx, cfg, target))`.
       Then read the target's main bill.
       - When `bills` is `"merge"`, the main exists, and both `isUntouched`: merge the moved bill
         into the target's main bill with Task 5's internals (the body of `mergeBills` after its
         guards). The result is `merged: true` and `billId` is the main bill.
       - Otherwise, when the target has no main bill and the moved bill is open, call
         `setMainBill(tx, target, billId)` (P12).
  7. `takeIntoParty` updates `party_id`, sets `delivery_table_id: null` and calls `bumpRevision`.
     When the bill is `open` and the zone is not null, it retargets the order context, or records it
     if there is none. A placed bill keeps its zone (P15).
  8. `await enqueueMovedSlips(tx, cfg, before, result.billId, new Map(), { force: toOrFromCounter });`,
     where `toOrFromCounter` is true when the source or the target party is null.
     `enqueueMovedSlips` gains that optional last argument in this task, and its `force` skips the
     label comparison (P17). The trigger from Task 2 has already cleared the source's main bill when the
     moved bill was main.

  The route `POST /api/bills/:id/move`:
  - parses `to` strictly: exactly one of `tableId` (a UUID) or `counter: { zoneId: UUID | null }`,
    else `management.request_invalid` `{ field: "to" }`;
  - defaults `bills` to `"merge"`, and refuses any other value with `{ field: "bills" }`;
  - reads both revisions with `requireRevision` when present;
  - runs `moveBill` in one `withTransaction` and answers the result;
  - does not call `issueIfFullyPaid`: a move changes no amount.

  Run Steps 1 and 2: PASS.

- [ ] **Step 5: Everything the old paths share still passes,** and the fiscal gates stay unedited:
  ```bash
  cd apps/server && pnpm exec vitest run src/parties.test.ts src/move-merge.test.ts src/split-bill.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts src/bill-refunds.card.test.ts src/till-sale.test.ts src/collect-by-invoice.test.ts
  cd ../../packages/fiscal-verifactu && pnpm exec vitest run src/write-path.e2e.test.ts
  ```
  Then run `inmutabilidad` as in Task 5 Step 3. Expected: PASS, with no edit to either golden test.

- [ ] **Step 6: Guards, upgrade, docs.**
  - Run the root guards.
  - Measure the upgrade: the trigger migration applies on a dev venue with placed orders.
  - Update `docs/backlog.md`: A81 and A82 are built on the server; their till half is Task 12.

- [ ] **Step 7: Commit, then `/finish-branch`.**
  ```bash
  git add packages/db scripts/behavioural-triggers.test.ts apps/server apps/till/src/i18n/codes.ts docs/backlog.md
  git commit -s -m "Move a whole bill to another party, a table or the counter, keeping its payments and invoice (table actions, Task 7)"
  ```

---
## Task 8: Move guests, join tables, split a table — the server — slug `party-table-actions`

Spec decisions 1, 2, 3, 4, 6, 10 and 15; §6 (every table action, the bill choice after combining);
§8 (MOVED after a table action); §15 (table actions, main bill when parties combine, paid bill
stays, kitchen groups, two tills). Plan decisions: P8, P12, P13, P16, P17, P23, P24 and P27. Branch
`feat/party-table-actions`. Full review wave (concurrency across two parties, and money: bills
change party).

New routes under `/api/parties/:id/...`. The till keeps the old `move` and `join` tab routes until
Task 11.

**Files:**
- Create:
  - `apps/server/src/table-actions.ts`: `moveGuests`, `joinTables`, `splitTable` and
    `combineParties`.
  - `apps/server/src/party-table-actions.test.ts`.
  - `apps/server/src/till-api.table-actions.test.ts`.
- Modify:
  - `apps/server/src/till-api.ts`: the three routes.
  - `apps/server/src/errors.ts`: reuse `table.not_shared` and `table.not_joined` with new params
    (P11).
  - `apps/till/src/i18n/codes.ts`: `table.not_shared` and `table.not_joined` wording, when it names
    a table the party does not hold. Check today's text still reads right.

**Interfaces:**
- Consumes:
  - Task 7's `takeIntoParty`, `leaveParty` and `isUntouched`, and the merge internals of Task 5;
  - Task 3's `leaveForCleaning`; Task 2's `setMainBill`, `partyMainBill` and `partyZone`;
  - Task 4's `readPartiesSentWork` and `enqueueMovedSlipsFor`;
  - Task 1's `moveGroupsToParty`, `moveDraftsToParty`, `openParty` and `checkAndBumpParty`.
- Produces:
  ```ts
  // apps/server/src/table-actions.ts
  export interface TableActionOptions {
    bills: "merge" | "separate";
    expectedPartyRevision: number;          // the party in the path
    expectedOtherPartyRevision?: number;    // the party holding the target table, required when one does
    operatorId: string;
  }
  export interface TableActionResult { partyId: string; mainBillId: string | null; merged: boolean }
  export async function moveGuests(tx, cfg, partyId: string, toTableId: string, options: TableActionOptions): Promise<TableActionResult>;
  export async function joinTables(tx, cfg, partyId: string, tableId: string, options: TableActionOptions): Promise<TableActionResult>;
  export async function splitTable(tx, cfg, partyId: string, tableId: string, billId: string | null, options: { expectedPartyRevision: number; operatorId: string }): Promise<{ partyId: string; mainBillId: string | null }>;
  export async function combineParties(tx, cfg, args: { from: string; into: string; bills: "merge" | "separate"; tables: "leave" | "join"; operatorId: string }): Promise<{ merged: boolean; mainBillId: string | null; mergedInto: Map<string, string> }>; // mergedInto: each bill merged away → the bill it merged into
  // wire: POST /api/parties/:id/move { toTableId, bills?, expectedPartyRevision, expectedOtherPartyRevision? } → TableActionResult
  //       POST /api/parties/:id/join { tableId, bills?, expectedPartyRevision, expectedOtherPartyRevision? } → TableActionResult
  //       POST /api/parties/:id/split-table { tableId, billId: string | null, expectedPartyRevision } → { partyId, mainBillId }
  ```

- [ ] **Step 0: Re-map** `mergeTabs`' absorb block (`working-order.ts:2753-2804` on `f19768b3e`),
  `moveGroupsToParty`, `moveDraftsToParty`, `leaveTables`, and the `parties_clear_table_status`
  trigger. **The order in which memberships end and the absorbed party closes decides which tables
  lose their manual status**, as today's comment at `:2791-2792` says. Record the order the absorb
  block uses, and keep it.

- [ ] **Step 1: Write the failing tests.** `apps/server/src/party-table-actions.test.ts`, on the
  harness. Helpers local to the file: `cmd`, `snapshot` (Task 5's, extended to several parties),
  and:
  ```ts
  async function act<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return inTx(v, fn);
  }
  async function opts(partyId: string, other?: string, bills: "merge" | "separate" = "merge") {
    return {
      bills,
      expectedPartyRevision: await revisionOf(v, partyId),
      ...(other === undefined ? {} : { expectedOtherPartyRevision: await revisionOf(v, other) }),
      operatorId: OPERATOR,
    };
  }
  ```
  **Move guests:**
  ```ts
  describe("move guests", () => {
    it("moves the party off all its tables to a free one, and the tables left behind need cleaning", async () => {
      await act((tx) => writeClearingWorkflow(tx, true));
      const [m4, m5, m9] = [await v.table("Mesa 4"), await v.table("Mesa 5"), await v.table("Mesa 9")];
      const ana = await seat(v, m4);
      const joining = await opts(ana.partyId);
      await act((tx) => joinTables(tx, v.cfg, ana.partyId, m5, joining));
      await giveStatus([m4, m5]);

      const moving = await opts(ana.partyId);
      const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, moving));

      expect(result).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
      expect(await activeTablesOf(v, ana.partyId)).toEqual([m9]);
      for (const left of [m4, m5]) {
        const row = await tableRow(v, left);
        expect(row.needsCleaningSince).not.toBeNull();
        expect(row.statusId).toBeNull();
      }
      expect((await billRow(v, ana.tabId)).partyId).toBe(ana.partyId);
      expect((await partyRow(v, ana.partyId)).state).toBe("open");
    });

    it("combines the party into the party at a held table, which keeps its name and main bill", async () => {
      const [m4, m7] = [await v.table("Mesa 4"), await v.table("Mesa 7")];
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      await act((tx) => setPartyName(tx, { partyId: luis.partyId, name: "Luis", expectedPartyRevision: luis.revision }));
      await order(v, ana.tabId, "Burger");
      await order(v, luis.tabId, "Agua");

      const moving = await opts(ana.partyId, luis.partyId);
      const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

      expect(result).toEqual({ partyId: luis.partyId, mainBillId: luis.tabId, merged: true });
      expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua", "Burger"]);
      expect((await billRow(v, ana.tabId)).status).toBe("abandoned");
      expect(await partyRow(v, ana.partyId)).toMatchObject({ state: "closed", mergedIntoPartyId: luis.partyId });
      expect((await partyRow(v, luis.partyId)).name).toBe("Luis");
      expect(await activeTablesOf(v, luis.partyId)).toEqual([m7]);
      expect(await activeTablesOf(v, ana.partyId)).toEqual([]);
    });
  });
  ```
  The remaining cases. Each reads the state back, and each refusal also compares `snapshot` before
  and after.
  - **Move guests:**
    - `bills: "separate"` keeps both main bills, and Luis's stays main;
    - Ana's main bill has a €5.00 contribution, so `"merge"` still keeps them separate, with
      `merged: false`;
    - to a table that needs cleaning is `table.needs_cleaning`;
    - to the party's own only table is `table.already_in_party`;
    - to one of its own tables while it holds two: the other leaves and needs cleaning;
    - to an inactive table is `table.inactive`;
    - to a FREE table in a zone whose service mode is not `table_tab` (a counter zone) is
      `service_zone.mode_incompatible`, as seating refuses it (`openTab`, `working-order.ts:1002-1010`)
      and as Task 7's move of a bill to a free table does; nothing changes;
    - with a stale `expectedOtherPartyRevision` it is `party.out_of_date`, and nothing changes.
  - **Main bill when parties combine** (spec §15):
    - Luis's main bill presented (`placeByHand`) and Ana's untouched: after Ana moves to Luis's
      table, Ana's former main is Luis's main;
    - both presented, or Luis's paid and Ana's presented: Luis's party has `main_bill_id` null, and
      its next `orderForParty` creates a new main bill.
  - **A paid bill stays on its original party** (spec §15): Ana has a settled bill and an open
    split bill. After she moves to Luis's table:
    - the settled bill's `party_id` is still Ana's party;
    - the open one is Luis's;
    - `readPartyBills(luis)` lists all three through the family, and Finish on Luis's party is
      refused `party.bill_outstanding` until the open one is paid.
  - **Kitchen groups when parties combine:**
    - Ana's two groups, one held and one fired, are Luis's after the move, appended after his last
      position, in their own order and state;
    - a line in the held group keeps its `group_id`, because whole groups travel.
  - **Drafts:** an operator with open drafts on both parties ends with one draft on Luis's party
    holding both sets of lines. That is today's `moveDraftsToParty` behaviour, run through the new
    path.
  - **Join tables:**
    - a free table joins, both tables stay, and neither's status changes;
    - a table held by Luis: Luis's party is combined into Ana's, with ALL of Luis's tables now
      Ana's;
    - the bill choice as for Move guests;
    - a table in another zone is `service_zone.join_mismatch`;
    - a table the party holds is `table.already_in_party`;
    - a table that needs cleaning is `table.needs_cleaning`.
  - **Split a table:**
    - Ana at Mesa 4 and Mesa 5, with a split bill B2. Split Mesa 5 with B2: a new party on Mesa 5
      with `name` null, B2 its main, B2's `party_id` the new party, and Ana keeping Mesa 4 and her
      main bill;
    - with `billId: null`: a new party whose new, empty main bill exists at once;
    - the main bill is `party.main_bill_stays`;
    - the only table is `table.not_shared`;
    - a table not in the party is `table.not_joined`;
    - a paid bill is `bill.paid`;
    - another party's bill is `bill.other_party`.
  - **Split a table choosing a placed bill (P14's line exception):**
    - B2 holds two dishes fired as a group, and is placed with `placeByHand`;
    - Split Mesa 5 with B2 moves it to the new party, still `placed`, with its lines unchanged
      apart from `group_id`;
    - the new party's `main_bill_id` is null, because a placed bill cannot be main (P4). Its next
      order makes one;
    - before Task 7's Step 3 migration, this fails with the engine's
      `lines may only be written while the order is open`, which is why Task 8 waits for Task 7.
  - **Split a table, with held dishes (Review Focus 4):**
    - Mesa 5 carries a manual status, and B2 holds a line in a held group;
    - the split is refused `group.held_leaves_party`;
    - the tables, memberships, Mesa 5's status, both parties and every bill are unchanged
      (`snapshot`).
  - **Split a table, with sent dishes:** they leave their group and keep their ticket state.
    Task 9 then gives them a group on arrival; before Task 9 their `group_id` is null.
  - **MOVED notices (spec §15):**
    - joining Mesa 5 records `moved` notices for the sent dishes on every bill of Ana's party, and
      none for Luis's bills;
    - splitting Mesa 5 away with B2 records notices for B2's sent dishes (now "Mesa 5") and for
      Ana's other bills' sent dishes (now "Mesa 4", no longer "Mesa 4, 5");
    - **a sent dish merged away when parties combine:**
      - Ana's untouched main bill holds one sent dish, and Ana moves guests to Luis's table with
        `bills: "merge"`;
      - Ana's main bill is merged into Luis's and abandoned;
      - the dish, now on Luis's main bill, gets exactly ONE `moved` notice, with `moved_to` "Mesa 7";
      - without the merged-away map (Step 2) it gets none: the merged-away bill has no fired items
        left for `enqueueMovedSlips` to read (`kitchen-print.ts:686-697`).
  - **Two tills at once**, in both orders:
    - till A moves Ana to Mesa 9 while till B joins Mesa 6 to Ana. The second is
      `party.out_of_date`, and the state is the first alone.
    - Till A moves Ana into Luis's table while till B splits a table of Luis's party. Whichever
      runs second is refused `party.out_of_date`: the move carries Luis's revision as
      `expectedOtherPartyRevision`.
  - **Review Focus 3:** after Ana is combined into Luis, any action on Ana's party (move, join,
    split a table, name) is `party.not_open`, and nothing is written. This includes one sent with a
    stale revision, because the state is checked first (`checkAndBumpParty`,
    `apps/server/src/parties.ts`).

  `apps/server/src/till-api.table-actions.test.ts`:
  - no session is 401;
  - a malformed party id is `party.not_open`;
  - a missing `expectedPartyRevision` is 400;
  - `bills` other than `"merge"` or `"separate"` is 400 `{ field: "bills" }`;
  - each refusal's status is 409;
  - the answer bodies are the result shapes above.

  Run:
  ```bash
  cd apps/server && pnpm exec vitest run src/party-table-actions.test.ts src/till-api.table-actions.test.ts
  ```
  Expected: FAIL, because `./table-actions.js` does not exist.

- [ ] **Step 2: Implement `apps/server/src/table-actions.ts`.**
  - `combineParties({ from, into, bills, tables, operatorId })`, in this order:
    1. read `from`'s and `into`'s main bills;
    2. `moveGroupsToParty(from → into)`, then `moveDraftsToParty(from → into, operatorId)`;
    3. for each bill of `from` whose status is `open` or `placed`:
       `takeIntoParty(tx, cfg, bill, into, await partyZone(tx, cfg, into))`. Do NOT call
       `leaveParty`: whole groups travel (P16);
    4. the bill choice (P12): merge `from`'s main bill into `into`'s when `bills === "merge"`, both
       exist, and both are `isUntouched`. Otherwise, when `into` has no main bill and `from`'s is
       open, `setMainBill(into, fromMain)`;
    5. the tables: `"leave"` calls `leaveForCleaning(from's tables)`, so every table left behind
       needs cleaning when the venue's clearing setting is on (P8); and `"join"` calls
       `leaveTables(from's tables)` and inserts a `party_tables` row for `into` for each. Both happen
       BEFORE `from` closes, so closing clears no status of a table that joins (Step 0);
    6. close `from`: `state: "closed"`, `closedAt`, `closedBy`, `mergedIntoPartyId: into`;
    7. while `tab_id` exists, `setMainBill(into, currentMain)` when the main bill is not null, so
       every table of `into` points at it.
  - `moveGuests` and `joinTables`:
    1. `checkAndBumpParty(party, expectedPartyRevision, "open")`;
    2. read the target table and its holder, refusing as the tests list;
    3. `checkAndBumpParty(holder, expectedOtherPartyRevision, "open")` when another party holds it;
    4. `const before = await readPartiesSentWork(tx, cfg, [party, holder])`;
    5. act. `combineParties` returns `mergedInto: Map<string, string>`, each bill it merged away
       mapped to the bill it merged into;
    6. `enqueueMovedSlipsFor(tx, cfg, before, mergedInto)`.
       - For a bill in `mergedInto`, it calls `enqueueMovedSlips(before.get(away), mergedInto.get(away))`.
       - That reads the fired items where they are NOW. Today's
         `enqueueMovedSlips(before.get(bill), bill)` reads fired items on the same bill it was
         given (`kitchen-print.ts:686-697`), and a merged-away bill has none, so its moved dishes
         would get no notice.
    - Move guests to a free table:
      - a free table whose zone's service mode is not `table_tab` is refused
        `service_zone.mode_incompatible` before anything is written, with the check `openTab` makes
        (`working-order.ts:1002-1010`), as Task 7 does for a bill;
      - `leaveForCleaning` of the party's other tables (they need cleaning when the venue's
        clearing setting is on, P8), then insert the new membership. Add a Move guests case with
        the setting off: the tables left behind read free and `needsCleaningSince` stays null;
      - when the free table's zone differs from `partyZone`, `takeIntoParty` each open bill of the
        party, again to the same party, with the new zone. That is the area rule (P15), as
        `moveTab` retargets today.
  - `splitTable`:
    1. `checkAndBumpParty`;
    2. the membership checks (`table.not_joined`, then `table.not_shared`);
    3. the bill checks (`bill.other_party`, `bill.paid`, `tab.not_open`, `party.main_bill_stays`);
    4. `leaveParty(bill)`;
    5. `before` for the party;
    6. `leaveTables([table])`, then `openParty(tx, { guestCount: null, operatorId, tableId })`;
    7. `takeIntoParty(bill, newParty, table.zoneId)` and `setMainBill(newParty, bill)` when the bill
       is open. With no bill, `partyMainBill(tx, cfg, newParty)`;
    8. `setMainBill(party, partyMain)` to repoint the remaining tables while `tab_id` exists;
    9. `enqueueMovedSlipsFor(before)`, with the moved bill's entry included.
  - The routes parse the bodies as Task 7's does: `requireRevision` for both revisions, a UUID for
    the table and the bill (`billId` may be null), and `bills` defaulting to `"merge"`.

  Run Step 1's command: PASS. Then run the old paths' suites, which share the helpers:
  ```bash
  cd apps/server && pnpm exec vitest run src/parties.test.ts src/move-merge.test.ts src/till-api.move-merge.test.ts src/order-groups.test.ts src/order-drafts.db.test.ts
  ```
  Expected: PASS.

- [ ] **Step 3: Guards and the fiscal gates** (Task 5 Step 3). Expected: PASS, unedited.

- [ ] **Step 4: Commit, then `/finish-branch`.**
  ```bash
  git add apps/server apps/till/src/i18n/codes.ts docs/backlog.md
  git commit -s -m "Move guests, join tables and split a table, with the bill choice when two parties become one (table actions, Task 8)"
  ```

---

## Task 9: Dishes arriving in a party get a group, so the pass can mark them — slug `party-arriving-dishes`

A96, re-scoped by spec §7 and §15 and by P16 (flagged). Branch `feat/party-arriving-dishes`. Full
review wave (kitchen state, and the party revision).

Inside one party a group already travels with its dishes, because a group belongs to the party
(the service plan's D1, kept by Task 5's split, merge and transfer). So A96's remaining case is a
bill ARRIVING in a party through Move a bill (Task 7) or Split a table (Task 8). Its dishes have no
group, so the pass renders no Ready or Away lever for them (`till-expo-screen.ts:584` on
`f19768b3e`), and the waiter cannot release its unsent dishes as a group.

**Files:**
- Create: `apps/server/src/party-arriving-dishes.test.ts`.
- Modify:
  - `apps/server/src/order-groups.ts`: `groupArrivingDishes`.
  - `apps/server/src/move-bill.ts`: call it after `takeIntoParty` into a party, except when the
    bill was merged into the main bill. Merged lines keep the groups they have; lines with none get
    the same treatment on the main bill.
  - `apps/server/src/table-actions.ts`: call it in `splitTable` for the chosen bill.

**Interfaces:**
- Consumes: Task 7's `takeIntoParty`, Task 8's `splitTable`, and `startGroup` and
  `recordGroupEvent` in `order-groups.ts`.
- Produces:
  ```ts
  // apps/server/src/order-groups.ts
  export async function groupArrivingDishes(tx, partyId: string, billId: string, operatorId: string): Promise<{ fired: string | null; held: string | null }>; // the groups made, or null where none was needed
  ```

- [ ] **Step 0: Re-map, and establish what a sent dish is.**
  - Read `startGroup`, `releaseGroup`, `bumpGroupReady` and `markGroupAway` in `order-groups.ts`,
    and how a line's "sent" state is recorded: `working_order_lines.sent_at`, a `ticket_items` row,
    and its `fired_at`.
  - Run `cd apps/server && pnpm exec vitest run src/order-groups.test.ts -t "ready"`, and read one
    case to see what `bumpGroupReady` changes on the ticket items. The test in Step 1 asserts the
    same fields.
  - Decide from what you read: a dish is SENT when it has a ticket item whose `fired_at` is set;
    otherwise it is unsent. If the code marks sent differently on the `main` you start from (for
    example, `sent_at` alone), use that, and record it in the ledger.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  describe("dishes arriving in a party (A96, P16)", () => {
    it("puts a moved bill's sent dishes in one new fired group, after the receiving party's last group", async () => {
      const [m4, m7] = [await v.table("Mesa 4"), await v.table("Mesa 7")];
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      await orderForParty(v, ana.partyId, ["Burger", "Vino"]);            // one fired group on Ana's main bill
      const b2 = await splitOff(ana.partyId, ana.tabId, [2]);             // Vino, sent, on its own bill
      await orderForParty(v, luis.partyId, ["Agua"]);                     // Luis's group 1
      const groupsBefore = await groupsOf(v, luis.partyId);

      await move(b2, { tableId: m7 }, { bills: "separate" });

      const groups = await groupsOf(v, luis.partyId);
      expect(groups).toHaveLength(groupsBefore.length + 1);
      expect(groups.at(-1)).toMatchObject({ state: "fired", position: groupsBefore.length + 1 });
      expect((await linesOf(v, b2)).map((l) => l.groupId)).toEqual([groups.at(-1)!.id]);
    });

    it("puts an open counter order's unsent dishes in one new held group, which the waiter then releases", async () => {
      const m5 = await v.table("Mesa 5");
      const ana = await seat(v, m5);
      const counter = await counterOrder(v, ["Caña", "Croquetas"]);       // parked: nothing sent

      await move(counter, { tableId: m5 }, { bills: "separate" });

      const [held] = (await groupsOf(v, ana.partyId)).slice(-1);
      expect(held).toMatchObject({ state: "held" });
      expect((await linesOf(v, counter)).every((l) => l.groupId === held!.id)).toBe(true);
      const fire = { submissionId: randomUUID(), expectedPartyRevision: await revisionOf(v, ana.partyId), operatorId: OPERATOR };
      await inTx(v, (tx) => fireGroup(tx, v.cfg, ana.partyId, held!.id, fire));
      expect(await firedTicketsOf(v, counter)).toHaveLength(2);
    });
  });
  ```
  - `groupsOf` reads `order_groups` for the party, by position.
  - `firedTicketsOf` reads `ticket_items` for the bill with `fired_at` set.
  - Check `fireGroup`'s signature on the `main` you start from, since B9 changed `order-groups.ts`.
  - `counterOrder`, `move`, `splitOff` and `v` are as in Task 7.

  **Which arriving dishes can be sent and which unsent, read from the code, not run:**
  - a dish in a held group cannot leave a party (P16), so a bill leaving a party carries only sent
    dishes;
  - an open counter order has sent nothing, because `sendLines` requires a party bill after Task
    2's `assertPartyBillOpen`;
  - a placed counter order was wholly sent by `placeOrder` (`working-order.ts:4661-4666` on
    `f19768b3e` stamps every line).

  So a bill arrives either all sent or all unsent. `groupArrivingDishes` still handles a mixture,
  and a test writes one by hand to pin it.

  Also write:
  - The pass: after the first case's move, `listExpoQueue` answers `b2` with a `groups` entry whose
    `groupId` is the fired group, not null. `bumpGroupReady` on it with Luis's revision marks the
    Vino ticket item `ready`.
  - **A placed (ticket-then-pay) counter order moved into a party** gets ONE fired group:
    - every line's `group_id` is that group, the bill is still `placed`, and every other line value
      is unchanged;
    - the pass shows its Ready lever;
    - this is the write Task 7's line-trigger exception (P14) allows. Without it, it fails with
      `lines may only be written while the order is open`.
  - No silent change of state: a sent dish is never put in a held group, and an unsent dish never
    in a fired one. Use a bill written by hand with one of each, and assert both from the rows.
  - Split a table: the chosen bill's sent dishes arrive in the new party in ONE fired group at
    position 1.
  - Merged into the main bill: an open counter order merged into Ana's untouched main bill gives
    its dishes one new held group. The main bill's own lines keep theirs.
  - Nothing to do: a bill whose every dish already has a group (written directly) makes no group.

  Run: `cd apps/server && pnpm exec vitest run src/party-arriving-dishes.test.ts`. Expected: FAIL.
  The moved dishes have `group_id` null, and the pass shows no lever.

- [ ] **Step 2: Implement `groupArrivingDishes`.**
  1. Read the bill's top-level lines with `group_id` null, each with its sent state (Step 0).
  2. If any are sent, `startGroup(tx, partyId, "fire", operatorId)`, then set its `state` to
     `fired` with `fired_at` now and `fired_by` the operator. Check whether `startGroup` can make a
     fired group directly, and use it if so.
  3. If any are unsent, `startGroup(tx, partyId, "hold", operatorId)`.
  4. Set `group_id` on each line and on its extras children (`parent_line_id`), as `clearGroups`
     clears them.
  5. Record one `lines_moved` group event per group made, with the detail
     `{ workingOrderId: billId, arrived: true }`.
  6. `bumpPartyRevision`.
  - It never fires or holds a ticket: it only groups what is there.
  - Call it from the three places listed in Files.

  Run Step 1: PASS. Then:
  ```bash
  cd apps/server && pnpm exec vitest run src/party-move-bill.test.ts src/party-table-actions.test.ts src/order-groups.test.ts src/till-api.groups.test.ts
  ```
  Expected: PASS. Task 8's "sent dishes, before Task 9" expectation changes to one fired group. The
  PR says that case was written to change here.

- [ ] **Step 3: Commit, then `/finish-branch`.**
  ```bash
  git add apps/server docs/backlog.md
  git commit -s -m "Dishes that arrive in a party by a moved bill get a group, so the pass can mark them ready (table actions, Task 9; A96)"
  ```
  The PR says A96 is retired by this task, and names P16's reading of spec §15 for the owner.

---
## Task 10: The till — a party's bills, and split, merge and transfer between them — slug `party-till-bills`

Spec decisions 2, 4, 5, 7 and 8; §5 ("Ana · Bill 1"); §7 (bill actions, new orders to the main bill
or another bill, no automatic putting-back); §11 (M7b3 and `freeSourceTable` go); §15 (the till,
looked at). Plan decisions: P3, P5, P21 and P26. Branch `feat/party-till-bills`. Light path: the
till only, consuming Task 2's and Task 5's routes. The plan-versus-spec read and the Codex run-it
seat still run.

**What changes for a person:**
- The table screen lists the party's bills under its name: "Ana · Bill 1", "Ana · Bill 2", or
  "Mesa 4, 5 · Bill 1" for an unnamed party. It marks the one new orders go to.
- Split works from any bill of the party, including one split off before.
- Merge offers the party's other untouched bills. Transfer offers the same.
- Sending an order can name another open bill of the party.
- Leaving a split-off bill unpaid no longer merges it back; it stays listed until it is paid or
  merged (decision 8).
- Move and Join still use the old routes until Task 11.

**Files:**
- Modify:
  - `apps/till/src/api/client.ts`: `splitBill`, `mergeBills` and `transferItems` are added, and
    `splitTab`, `mergeTabs` and `transferLines` deleted. `billId` goes on `submitDraft`'s body.
    `TableParty` gains `name`, `displayName` and `mainBillId` (Task 2's wire).
  - `apps/till/src/screens/till-table-order-screen.ts`:
    - `#billsSection` and `#billRow` show the display name, the bill number and a main-bill marker;
    - `#otherTabs` is replaced by `#otherBills` (the party's other open, untouched bills, from
      `bills`);
    - the merge event becomes `merge-bills { fromBillId }`;
    - the transfer target is a bill;
    - a "Send to" choice appears in the draft preview when the party has more than one open,
      unpresented bill;
    - `SubmitDraftDetail.billId`.
  - `apps/till/src/till-app.ts`:
    - `#onMergeTabs` becomes `#onMergeBills`, and `#onTransferLines` and `#onSplitLines` call the
      new methods;
    - delete `#returnSplitCheck`, `#mergeCheckBack`, `#splitCheck`, `#checkReturn`,
      `#showCheckOutcome` and `#withdrawCheckKept`, and their calls at `#onOpenTable`, `#onTabSelect`,
      `#onBackToFloor` and `#endOperatorSession` (`till-app.ts:2343-2346`, `:2383`, `:3577-3603`,
      `:3711` on `f19768b3e`);
    - `#showsCheck` no longer hides ordering on a split bill;
    - `TABLE_REFUSALS` gains `bill.presented`, `bill.paid`, `bill.other_party`,
      `bill.payments_received` and `bill.line_paid`, and loses `tab.merge_leaves_no_table`.
  - `apps/till/src/i18n/strings.ts`, `en` and `es`:
    - add `table.bill_of` ("{party} · Bill {n}" / "{party} · Cuenta {n}"), `table.bill_main`
      ("New orders" / "Pedidos nuevos"), `table.send_to` ("Send to" / "Enviar a") and
      `table.action_merge_bills` ("Merge bills" / "Juntar cuentas");
    - delete `table.check_kept_held` and `table.check_return_unconfirmed`.
- Test:
  - `apps/till/src/till-app-parties.test.ts`: the revision table, `:1245-1318` on `f19768b3e`.
  - `apps/till/src/till-app-table-service.test.ts`: the M7b3 describe
    (`"a split-off bill left unpaid goes back to its table"`, `:1742-2270`) is deleted. The PR names
    each case as retired by spec decision 8 and §11.
  - `apps/till/src/screens/till-table-order-screen.test.ts`: the "table actions" describe, `:2534+`.
  - `apps/till/src/screens/till-table-order-screen.parties.test.ts`: the bill list.
  - `apps/till/src/screens/till-table-order-screen.a11y.test.ts`: the merge target picker and the
    Send to choice.
  - `apps/till/src/api/client.test.ts`: the new routes and bodies.

**Interfaces:**
- Consumes:
  - Task 5: `POST /api/bills/:id/split|merge|transfer`;
  - Task 2: `billId` on draft submission, and `TableParty.displayName` and `mainBillId`.
- Produces:
  ```ts
  // apps/till/src/api/client.ts
  // BillRevisions = { expectedPartyRevision?: number; partyId?: string }: the party read, and its revision (P27)
  splitBill(billId: string, transfers: TabTransfer[], revisions: BillRevisions): Promise<{ billId: string }>;
  mergeBills(intoBillId: string, fromBillId: string, revisions: BillRevisions): Promise<void>;
  transferItems(fromBillId: string, toBillId: string, transfers: TabTransfer[], revisions: BillRevisions): Promise<void>;
  // till-table-order-screen events: "merge-bills" { fromBillId }, "transfer-lines" { toBillId, transfers }, "split-lines" { transfers } (unchanged)
  // SubmitDraftDetail: { …; billId?: string }
  ```

- [ ] **Step 0: Re-map** the action flow (`till-table-order-screen.ts:915-923`, `:2854-2928`,
  `:3038-3145`), the bill list (`:2423-2519`), the draft preview (`#confirmPreview`, `:1254`), and
  every M7b3 call site. Record their current lines in the ledger.

- [ ] **Step 1: Write the failing browser tests.** In `till-app-parties.test.ts`, replace the
  merge, transfer and split rows of the revision table with:
  ```ts
  it.each([
    ["merge-bills", { fromBillId: "wo-check" }, "mergeBills", ["wo-4", "wo-check", { expectedPartyRevision: 3, partyId: "v1" }]],
    ["transfer-lines", { toBillId: "wo-check", transfers: [{ lineNo: 1 }] }, "transferItems", ["wo-4", "wo-check", [{ lineNo: 1 }], { expectedPartyRevision: 3, partyId: "v1" }]],
    ["split-lines", { transfers: [{ lineNo: 1 }] }, "splitBill", ["wo-4", [{ lineNo: 1 }], { expectedPartyRevision: 3, partyId: "v1" }]],
  ] as const)("%s sends the party revision it last read", async (type, detail, method, args) => {
    const { el } = await mountApp();
    const order = await openMesa(el);

    emit(order, type, detail);
    await flush(el);

    expect((api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalledWith(...args);
  });

  it("leaves an unpaid split-off bill listed when the waiter leaves it and comes back, and merges nothing (decision 8)", async () => {
    const { el } = await mountApp({
      mergeTabs: vi.fn().mockResolvedValue(undefined),                 // the old method, if anything still reaches it
      getPartyBills: vi.fn().mockResolvedValue([tabBill, checkBill]),  // the split bill, still open
    });
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    emit(order, "back-to-floor");
    await flush(el);
    const reopened = await openMesa(el);

    const listed = [...reopened.shadowRoot!.querySelectorAll<HTMLElement>("[data-bill]")].map((row) => row.dataset.bill);
    expect(listed).toContain(checkBill.workingOrderId);
    expect(api.mergeBills).not.toHaveBeenCalled();
    expect((api as unknown as { mergeTabs: ReturnType<typeof vi.fn> }).mergeTabs).not.toHaveBeenCalled();
    expect(api.transferItems).not.toHaveBeenCalled();
  });

  it("sends an order to the bill the waiter chose", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    // the draft helpers of this file put one line in the draft, then:
    emit(order, "submit-draft", { ...submitDetail(order), billId: "wo-check" });
    await flush(el);

    expect(drafts.submitDraft).toHaveBeenCalledWith("v1", expect.any(String), expect.objectContaining({ billId: "wo-check" }));
  });
  ```
  - `stubApi` gains `splitBill` (resolving `{ billId: "wo-check" }`), `mergeBills` and
    `transferItems`, and loses the three deleted methods.
  - **Why the merge-back case asserts what it does.** On today's code, `mergeBills` does not exist,
    so `expect(api.mergeBills).not.toHaveBeenCalled()` alone passes before the change: it
    measures nothing (CLAUDE.md §1).
    - The case stubs `mergeTabs` back in and asserts that neither merge method was called.
    - It also asserts that the split bill is still listed after the waiter leaves and reopens the
      table.
    - Today M7b3 calls `mergeTabs` on back-to-floor (`till-app.ts:3548-3573`), so the case FAILS
      until M7b3 is deleted.
  - The bill rows' selector (`[data-bill]` above) must be read from `#billRow` on the `main` you
    start from, and the case uses whatever attribute that renders. Add a `data-bill` attribute if
    there is none.
  - `submitDetail(order)` is the file's existing way of building a `SubmitDraftDetail` from the
    screen's draft. Find it with `grep -n "submit-draft" apps/till/src/till-app-parties.test.ts`,
    and use that exact construction.

  In `till-table-order-screen.test.ts`, the screen mounted with `bills: [tabBill, checkBill,
  paidBill, placedBill]` and `party: { …, displayName: "Ana", mainBillId: "wo-4" }`:
  - the bill rows read "Ana · Bill 1", "Ana · Bill 2", and so on, and the main bill's row carries
    the `table.bill_main` marker;
  - Merge lists `wo-check` only: not the bill on screen, not a paid or placed bill, and not a bill
    with `outstanding` below its `total`;
  - choosing it dispatches `merge-bills` `{ fromBillId: "wo-check" }`;
  - Transfer lists the same targets;
  - Split is offered on `wo-check` too (mount with `orderId: "wo-check"`);
  - with two open, unpresented bills, the draft preview shows a Send to choice defaulting to the
    main bill, and choosing Bill 2 puts `billId: "wo-check"` in `submit-draft`'s detail. With one
    such bill there is no choice and no `billId`.

  Refusals in their own words (`till-app-table-service.test.ts`): a `mergeBills` rejecting with each
  of `bill.presented`, `bill.paid`, `bill.other_party` and `bill.payments_received` shows that code's
  own sentence (`codeMessage`), not `table.error`.

  Run (after checking memory):
  ```bash
  memory_pressure | grep free
  cd apps/till && pnpm exec vitest run src/till-app-parties.test.ts src/till-app-table-service.test.ts src/screens/till-table-order-screen.test.ts src/screens/till-table-order-screen.parties.test.ts src/api/client.test.ts
  ```
  Expected: FAIL.

- [ ] **Step 2: Implement.**
  - The client methods post to Task 5's routes with the bodies in its Interfaces.
  - The screen reads `party.displayName` and numbers bills by their position in `#shownBills()`.
    The number is `index + 1`, as today; only the text around it changes.
  - `#otherBills()` is `bills` filtered to
    `workingOrderId !== orderId && status === "open" && outstanding === total`. The server stays
    the boundary (Global Constraints: "Write boundaries, not only disabled buttons").
  - The Send to choice is a `wt-*` radio group with `name="billId"`, following
    `docs/developers/design-system.md` → Forms.
  - Delete M7b3 whole. Search for `#splitCheck` and `checkReturn` afterwards: no hit.

  Run Step 1: PASS.

- [ ] **Step 3: LOOK, and axe.**
  - Add an axe case in `till-table-order-screen.a11y.test.ts` for the merge picker and the Send to
    choice, in both themes.
  - Open the table screen with three bills, one of them split twice, in English and Spanish, light
    and dark, at 1280 and 390 px, through `page.viewport(w, h)`. Read and report `window.innerWidth`.
  - Put the four screenshots' descriptions in the PR.

- [ ] **Step 4: Commit, then `/finish-branch`.**
  ```bash
  git add apps/till docs/backlog.md
  git commit -s -m "Till: a party's bills listed by name, split, merge and transfer between them, and no automatic merge-back (table actions, Task 10)"
  ```

---

## Task 11: The till — move guests, join tables, split a table, name the party — slug `party-till-tables`

Spec decisions 1, 3, 6 and 10; §6 (every table action and the bill choice); §15 (the till, looked
at). Plan decisions: P12, P23, P24 and P27. Branch `feat/party-till-tables`. Light path: the till
only, consuming Task 8's routes.

**Files:**
- Modify:
  - `apps/till/src/api/client.ts`:
    - add `moveGuests`, `joinTables`, `splitTable` and `setPartyName`, and delete `moveTab` and
      `joinTable`;
    - `TableState.party` is read for opening a table. The till stops reading `TableState.tabId`, so
      that Task 13 can remove it.
  - `apps/till/src/screens/till-table-order-screen.ts`:
    - the action menu gains Move guests, Join a table, Split a table (shown when the party holds
      two or more tables) and Name the party;
    - the target list shows every other table with its condition: free; held, with that party's
      display name; or needs cleaning, disabled, with `table.needs_cleaning`'s sentence;
    - picking a held table opens the bill choice dialog;
    - Split a table picks one of the party's tables, then a bill: its open or placed bills other
      than the main one, or "No bill, start an empty one".
  - `apps/till/src/widgets/bill-choice-dialog.ts` (new): "Merge the bills" (the default, focused)
    or "Keep separate bills", with the scope stated, for example "Ana (Mesa 4) joins Luis (Mesa 7)".
  - `apps/till/src/widgets/party-name-dialog.ts` (new): one optional text input, `name="partyName"`,
    `maxlength` 40, and an inline error for `management.request_invalid` `{ field: "name" }`
    (`docs/developers/conventions-ui.md`, a refusal beside the field it names).
  - `apps/till/src/till-app.ts`:
    - `#onMoveTab` and `#onJoinTable` become `#onMoveGuests` and `#onJoinTables`, and
      `#onSplitTable` and `#onNameParty` are new;
    - `#revisions` sends `expectedPartyRevision` and `expectedOtherPartyRevision`;
    - after a move into another party, the till follows the guests to the result's party and
      table;
    - when the answer says `merged: false` after the waiter chose Merge, the till says
      `table.bills_kept_separate`;
    - `#openTable` opens `table.party.mainBillId`, else the party's first unpaid bill, else its
      latest bill (from `getPartyBills`), where it read `table.tabId`.
  - `apps/till/src/screens/till-floor-screen.ts`: a card and a map token show `party.displayName`.
  - `apps/till/src/i18n/strings.ts`, `en` and `es`:
    - `table.action_move_guests` ("Move guests" / "Mover clientes");
    - `table.action_join` stays;
    - `table.action_split_table` ("Split a table" / "Separar una mesa");
    - `table.action_name` ("Name the party" / "Poner nombre");
    - `table.bills_merge` ("Merge the bills" / "Juntar las cuentas");
    - `table.bills_separate` ("Keep separate bills" / "Mantener cuentas separadas");
    - `table.bills_kept_separate` ("The bills were kept separate: one has already been paid
      towards or presented" / "Las cuentas se han mantenido separadas: una ya tiene pagos o se ha
      presentado");
    - `table.split_no_bill` ("No bill, start an empty one" / "Sin cuenta, empezar una vacía");
    - `table.held_by` ("Seated: {party}" / "Ocupada: {party}").
- Test:
  - `apps/till/src/till-app-parties.test.ts`
  - `apps/till/src/screens/till-table-order-screen.test.ts`
  - `apps/till/src/widgets/bill-choice-dialog.test.ts` and `.a11y.test.ts` (new)
  - `apps/till/src/widgets/party-name-dialog.test.ts` and `.a11y.test.ts` (new)
  - `apps/till/src/screens/till-floor-screen.parties.test.ts`
  - `apps/till/src/api/client.test.ts`

**Interfaces:**
- Consumes: Task 8's three routes; Task 2's `PUT /api/parties/:id/name`.
- Produces:
  ```ts
  // apps/till/src/api/client.ts
  moveGuests(partyId: string, toTableId: string, bills: "merge" | "separate", revisions: { expectedPartyRevision: number; expectedOtherPartyRevision?: number }): Promise<{ partyId: string; mainBillId: string | null; merged: boolean }>;
  joinTables(partyId: string, tableId: string, bills: "merge" | "separate", revisions: { expectedPartyRevision: number; expectedOtherPartyRevision?: number }): Promise<{ partyId: string; mainBillId: string | null; merged: boolean }>;
  splitTable(partyId: string, tableId: string, billId: string | null, expectedPartyRevision: number): Promise<{ partyId: string; mainBillId: string | null }>;
  setPartyName(partyId: string, name: string | null, expectedPartyRevision: number): Promise<{ revision: number; name: string | null }>;
  // screen events: "move-guests" { toTableId, bills }, "join-tables" { tableId, bills }, "split-table" { tableId, billId: string | null }, "name-party" { name: string | null }
  ```

- [ ] **Step 0: Re-map** the action menu, the target picker and `#openTable`
  (`till-app.ts:2392-2473` on `f19768b3e`), including every read of `table.tabId` in `apps/till/src`
  (`grep -n "tabId" apps/till/src/till-app.ts apps/till/src/screens/*.ts apps/till/src/widgets/*.ts`).
  List each in the ledger. After this task, no read of `TableState.tabId` remains, and Step 2 greps
  for it.

- [ ] **Step 1: Write the failing browser tests.**
  ```ts
  describe("till-app: table actions on the party", () => {
    it("moves the party to a free table, sending its revision, and follows it there", async () => {
      const { el } = await mountApp({
        moveGuests: vi.fn().mockResolvedValue({ partyId: "v1", mainBillId: "wo-4", merged: false }),
      });
      const order = await openMesa(el);
      const readsBefore = vi.mocked(api.getTablesState).mock.calls.length;

      emit(order, "move-guests", { toTableId: "t9", bills: "merge" });
      await flush(el);

      expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", { expectedPartyRevision: 3 });
      expect(vi.mocked(api.getTablesState).mock.calls.length).toBeGreaterThan(readsBefore);
    });

    it("sends the other party's revision when the guests join a seated table, and says when the bills stayed apart", async () => {
      const { el } = await mountApp({
        moveGuests: vi.fn().mockResolvedValue({ partyId: "v7", mainBillId: "wo-7", merged: false }),
      });
      const order = await openMesa(el);

      emit(order, "move-guests", { toTableId: "t7", bills: "merge" });
      await flush(el);

      expect(api.moveGuests).toHaveBeenCalledWith("v1", "t7", "merge", { expectedPartyRevision: 3, expectedOtherPartyRevision: 9 });
      expect(banner(el)!.textContent).toContain(t("table.bills_kept_separate"));
    });
  });
  ```
  - `t` is imported from `./i18n/t.js`, as the file's other string assertions do.

  The other cases:
  - **Join a table:** `join-tables` `{ tableId: "t9", bills: "merge" }` calls `joinTables` with the
    own revision only. To a seated table it also sends `expectedOtherPartyRevision`.
  - **Split a table:** Split a table is offered only when `party.tableIds.length > 1`. Choosing
    table `t5` and bill `wo-check` calls `splitTable("v1", "t5", "wo-check", 3)`. Choosing "No
    bill" sends `null`. The main bill is not offered.
  - **The bill choice dialog** opens only for a held target. It shows the scope ("Ana (Mesa 4) joins
    Luis (Mesa 7)"), "Merge the bills" is focused, and Escape cancels without a call.
  - **The target list:** a needs-cleaning table is listed disabled, with its reason, and cannot be
    chosen. A held table shows "Seated: Luis".
  - **Refusals in their own words:** `table.needs_cleaning`, `table.already_in_party`,
    `table.not_shared`, `party.main_bill_stays`, `group.held_leaves_party`,
    `service_zone.join_mismatch` and `party.not_open`. `party.out_of_date` reloads and says what
    changed (`#onPartyOutOfDate`).
  - **Name the party:** the dialog sends `setPartyName("v1", "Ana", 3)`, and the floor card then
    shows "Ana". An empty value sends `null`. A 41-character value is refused beside the field
    without a call, because `maxlength` holds it. The server's refusal is also shown beside the
    field.
  - **Opening a table:** a party whose `mainBillId` is null (its main bill was paid) opens its first
    unpaid bill, else its latest. No test reads `TableState.tabId` any more; delete it from the
    fixtures.

  Run the Task 10 Step 1 command with the new files added. Expected: FAIL.

- [ ] **Step 2: Implement,** then check no `TableState.tabId` read remains:
  ```bash
  git grep -n "\.tabId" apps/till/src -- ':!*.test.ts' | grep -i "table\b\|row\.\|t\.tabId\|table\.tabId"
  ```
  Expected: no line reading a `TableState`'s `tabId`. Read the whole unfiltered list too, since the
  pattern is a helper, not a proof.

  Run Step 1: PASS.

- [ ] **Step 3: LOOK, and axe.**
  - Add axe cases for the bill choice dialog, the party name dialog and the target list with a
    disabled row, in both themes.
  - Open each action in English and Spanish, light and dark, at 1280 and 390 px (`page.viewport`).
    Report `window.innerWidth`.
  - Check that "Ana (Mesa 4, 5) joins Luis (Mesa 7)" wraps inside the dialog at 390 px.

- [ ] **Step 4: Commit, then `/finish-branch`.**
  ```bash
  git add apps/till docs/backlog.md
  git commit -s -m "Till: move guests, join tables, split a table and name the party (table actions, Task 11)"
  ```

---

## Task 12: The till — move a bill, to and from the counter — slug `party-till-move-bill`

Spec §7 (Move a bill), decisions 11 and 12, §15 (the till, looked at). It is A81's and A82's till
half; both are retired from lane A's queue when this lands. Plan decisions: P12, P18, P19 and P25.
Branch `feat/party-till-move-bill`. Full review wave: it moves bills holding money, and A81 and A82
were full-review items.

**Paying a moved bill: the till picks the payment path by the bill's state, not by where it
sits.** Read from the code, not run:
- A **placed** (presented) bill is refused by the bill-payment routes: `requireOpenBill`,
  `apps/server/src/bill-payments.ts:831-843`, gives `working_order.not_open`. Only
  `POST /api/working-orders/:id/collect` settles it, through `collectOrder`, which Task 6 made
  follow the invoice. This holds wherever the bill now sits, a party included.
- An **open bill holding a payment row** is refused by the single-payment paths: `payWorkingOrder`
  (`till-sale.ts:441`) and `collectOrder` (`:1498`) both call `refuseBillWithPayments`. That is the
  counter's pay path (`recordSale`, `till-app.ts:1766` and `:3617`). Its rest is paid through
  `POST /api/working-orders/:id/payments`.
  - **No till screen calls that route on `f19768b3e`.** `docs/backlog.md:2691` says the service
    plan's Task 15 builds it, and that is lane B's B15.
  - So until B15 lands, this task shows such a bill's amount still to pay and the sentence
    `bill.pay_with_bill_payments`. It does not offer the single-payment button the server would
    refuse. Once B15 has landed, the button opens B15's screen instead.
  - Step 0 checks which is true.
- An **open bill with no payment** keeps today's path (`recordSale`).
- **Finish is never left refused by a moved bill.**
  - A presented bill moved into a party counts as outstanding (`readPartyBills`), and Finish is
    refused while it is unpaid, as for any presented bill.
  - The table screen's "Take payment" on it collects it through `/collect`, after which Finish
    succeeds. The test below runs that whole sequence.

**Files:**
- Modify:
  - `apps/till/src/api/client.ts`: `moveBill`.
  - `apps/till/src/screens/till-table-order-screen.ts`:
    - "Move this bill" in the action menu;
    - targets are every other table with its condition, plus "The counter";
    - a held table opens Task 11's bill choice dialog;
    - the scope line reads, for example, "Bill 2 of Ana (Mesa 4) to Luis (Mesa 7)".
  - `apps/till/src/widgets/held-orders.ts`: "Move to table" / "Pasar a mesa" on each held counter
    order, which opens a table picker and, for a held table, the bill choice dialog.
  - `apps/till/src/till-app.ts`:
    - `#onMoveBill`;
    - after a move to the counter, the table screen shows the party's remaining bills, or the floor
      when none is left, and the counter's held orders list the moved bill;
    - after a counter order moves to a table, the counter stays on screen and says
      `counter.moved_to_table` with the table's name;
    - the counter zone sent is the one the till sends when it parks (`#onParkOrder`,
      `till-app.ts:2018` on `f19768b3e`; re-map which property holds it);
    - `#payBill(bill)` picks the path by state:
      - `placed` calls `api.collectOrder(id, tender)`;
      - `open` with `outstanding` below `total`, or a payment pending, goes to the bill-payment
        path (B15's screen once it exists, else the sentence);
      - otherwise `api.recordSale([], tender, id)`, as today.

      It is used by the table screen's Take payment and by a retrieved counter order.
  - `apps/server/src/working-order.ts`: `HeldOrderSummary` gains `outstanding: string`, the total
    less what the bill has received (`readReceivedByBill`, as `readBillsOfParties` computes it). It
    also gains `hasPayments: boolean`, true when any `pending` or `received` payment row exists. So
    the counter can tell a partly paid moved bill. It is a server change inside this till task,
    covered by a case in `apps/server/src/working-order.test.ts` (or wherever `listHeldOrders` is
    tested: `git grep -n "listHeldOrders" apps/server/src/*.test.ts`).
  - `apps/till/src/i18n/strings.ts`:
    - `table.action_move_bill` ("Move this bill" / "Mover esta cuenta");
    - `table.to_counter` ("The counter" / "La barra");
    - `held.move_to_table` ("Move to table" / "Pasar a mesa");
    - `table.move_to_counter` ("Move to counter" / "Pasar a barra"), A82's wording;
    - `counter.moved_to_table` ("Moved to {table}" / "Pasada a {table}");
    - `bill.pay_with_bill_payments` ("Part of this bill is already paid: take the rest as a bill
      payment" / "Parte de esta cuenta ya está pagada: cobra el resto como pago de cuenta").
- Test:
  - `apps/till/src/till-app-parties.test.ts`
  - `apps/till/src/till-app.test.ts` (the counter's held orders)
  - `apps/till/src/widgets/held-orders.test.ts` and `.a11y.test.ts`
  - `apps/till/src/screens/till-table-order-screen.test.ts`
  - `apps/till/src/api/client.test.ts`

**Interfaces:**
- Consumes: Task 7's `POST /api/bills/:id/move`; Task 11's bill choice dialog.
- Produces:
  ```ts
  // apps/till/src/api/client.ts
  moveBill(billId: string, to: { tableId: string } | { counter: { zoneId: string | null } }, bills: "merge" | "separate", revisions: { expectedPartyRevision?: number; partyId?: string; expectedOtherPartyRevision?: number }): Promise<{ partyId: string | null; billId: string; merged: boolean }>;
  // events: table screen "move-bill" { to: { tableId } | { counter: true }, bills }; held-orders "move-held-order" { orderId, tableId, bills }
  ```

- [ ] **Step 0: Re-map** whether lane B's B15 (the bill-payment screen) has landed
  (`git grep -n "/payments" apps/till/src/api/client.ts`: nothing on `f19768b3e`).
  Also re-map `widgets/held-orders.ts` (its events at `:68-86` on `f19768b3e`), the
  counter's zone (the property `#onParkOrder` reads), and the table screen's action menu as Task 11
  left it.

- [ ] **Step 1: Write the failing browser tests.**
  ```ts
  it("moves the bill on screen to the counter, sending the counter's zone and the party revision", async () => {
    const { el } = await mountApp({
      moveBill: vi.fn().mockResolvedValue({ partyId: null, billId: "wo-check", merged: false }),
    });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });      // the split bill on screen
    await flush(el);

    emit(order, "move-bill", { to: { counter: true }, bills: "separate" });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledWith("wo-check", { counter: { zoneId: zone.id } }, "separate", { expectedPartyRevision: 3, partyId: "v1" });
  });
  ```
  - `zone` is the file's zone fixture. If the till parks with another zone value, assert that value
    (Step 0).

  The other cases:
  - **A held counter order to a free table:** "Move to table" on a held counter order, then Mesa 9,
    calls `moveBill(orderId, { tableId: "t9" }, "merge", {})`. No party revision is sent, since a
    counter order has no party and Mesa 9 is free. To Mesa 7 (Luis) the bill choice dialog opens
    first, and the call carries `{ expectedOtherPartyRevision: 9 }`.
  - **Refusals in their own words:** `party.main_bill_stays` ("move the other bills first or merge
    them"), `bill.paid`, `group.held_leaves_party` and `table.needs_cleaning`.
  - **After the move** (A82's shape): the held orders list on the counter shows the moved bill,
    under the label the server set (P18), and the table screen no longer lists it.
  - **Money on the moved bill:** a bill with a card payment pending shows "Move this bill" enabled,
    because the spec keeps its payments and retries on the same bill (P19). The server side of the
    retry is Task 7's test.
  - **Paying a moved bill, by its state:**
    - a presented bill moved into the party is listed with Take payment. Taking cash calls
      `api.collectOrder(billId, tender)` and not `recordSale`. After that answer the bills re-read as
      paid, and Finish calls `finishTable` and is not refused (the stub answers
      `{ state: "closed" }`; assert the call and the move to the floor);
    - a retrieved counter order with `hasPayments: true` shows its `outstanding` and the
      `bill.pay_with_bill_payments` sentence. No `recordSale` call happens when the operator tries
      to pay. Once B15 has landed, it opens B15's payment screen instead; assert whichever Step 0
      found;
    - a retrieved counter order with no payments pays through `recordSale`, as today.
  - **The server half of the same,** in `apps/server/src/till-api.move-bill.test.ts` (Task 7's file):
    - a partly paid bill (a €5.00 cash contribution) moved to the counter:
      `POST /api/working-orders/:id/collect` and the single-payment route are refused
      `bill.payments_received`. `POST /api/working-orders/:id/payments` for the rest succeeds,
      issuing one invoice (`registroCount` 1);
    - a presented bill moved into a party: `POST /api/working-orders/:id/payments` is refused
      `working_order.not_open`, and `/collect` succeeds with one sale;
    - after that, `POST /api/parties/:id/finish` succeeds.

  Run the till files. Expected: FAIL.

- [ ] **Step 2: Implement.** Run Step 1: PASS.

- [ ] **Step 3: LOOK, and axe.** The held orders list with the new button (axe, both themes); the
  table picker from the counter; the bill choice dialog from each entry point. English and Spanish,
  light and dark, at 1280 and 390 px.

- [ ] **Step 4: Commit, then `/finish-branch`.**
  ```bash
  git add apps/till docs/backlog.md
  git commit -s -m "Till: move a bill to another table or the counter, and a counter order to a table (table actions, Task 12; A81, A82)"
  ```
  The PR says A81 and A82 are built, and asks the watcher to retire them from lane A's queue.

---

## Task 13: Remove the old tab routes and the table's bill pointer — slug `party-drop-tab-pointer`

Spec §5 ("Table loses `tab_id`"), §10 (the codes that go) and §11 (`freeSourceTable`, "a bill with a
table" versus "a check", cross-party merge and transfer go). Plan decisions: P1 (the naming
survivors), P10, P11 and P28. Branch `refactor/party-drop-tab-pointer`. Full review wave:
migrations, and a rebuild that needs every venue reset. **Labelled `needs-owner-review`; the owner
lands it.**

**Files:**
- Modify, server:
  - `apps/server/src/till-api.ts`: delete `POST /api/tabs/:id/move|join|merge|transfer|split|unjoin`
    (`:1865-2008` on `f19768b3e`).
  - `apps/server/src/working-order.ts`: delete `moveTab`, `joinTable`, `mergeTabs`,
    `transferLines`, `carveBetweenTabs`, `splitOffCheck`, `unjoinTable`, `tablePointsAt`,
    `refuseInconsistentMerge`, `refuseMergeLeavingNoTable`, `freeTablesCoveredBy`,
    `closedPartyTab`, `assertTabOpenOrPartyCurrent` and `moveTabLines`. Before deleting each, check
    that it has no caller left (`git grep -n "<name>(" apps packages`).
    - Keep `assertServiceModesMatch` and `assertTableAvailable` only if something still calls them.
    - `openTab` stops writing `tab_id`.
    - `listTablesWithState` aggregates over each party's bills that are `open` (and `placed`, for
      the counts of unserved dishes; Step 0 decides) instead of joining on `tab_id`.
    - `TableState.tabId` is deleted. `hasOpenTab`, `tabLineCount` and `tabTotal` are derived from
      the party's open bills.
  - `apps/server/src/parties.ts`: `setMainBill` and `releaseTables` stop writing `tab_id`.
    `CommandScope`'s literal becomes `kind: "party"`.
  - `apps/server/src/report-api.ts:174`: open tables are counted by active memberships.
  - `apps/server/src/errors.ts` and `apps/till/src/i18n/codes.ts`: delete
    `tab.merge_leaves_no_table`, `tab.party_has_other_open_bill`, `tab.not_table_tab`,
    `tab.party_mismatch` and `table.occupied`, their `STATUS` entries, and their tests
    (`apps/till/src/i18n/codes.test.ts:110-161` on `f19768b3e`).
  - `packages/bookings/src/testing/fake-core.ts`: stop writing `dining_tables.tab_id`.
- Modify, schema:
  - `packages/db/src/schema/dining-tables.ts`: delete `tabId` and its doc comment.
  - `packages/db/src/schema/parties.ts`:
    - `partyState` becomes `["open", "closed"]`;
    - the four CHECK names become `parties_*_ck`, with `parties_closed_at_ck` as
      `(state = 'open') = (closed_at is null)`, unchanged;
    - `serviceCommandScope` becomes `["party", "bill"]`.
  - `packages/db/src/configuration-transfer.ts:19`: drop `"tab_id"` from `omit`.
  - The comments naming `tab_id`: `packages/db/src/schema/orders.ts:75`, and `errors.ts:285,
    303-304, 500`.
- Migrations, in this order: custom A (drop the triggers), generated B (the rebuilds), custom C
  (re-create the triggers).
- Modify, tests: every server test that reads `tabId` from a table row, or calls a deleted function.
  Those files move to the new functions or are deleted with the old behaviour, named in the PR:
  - `move-merge.test.ts`, `till-api.move-merge.test.ts`, `split-bill.test.ts`,
    `till-api.split-bill.test.ts` and `parties.test.ts`'s old-path blocks;
  - `scripts/schema-constraints.test.ts` (the CHECK names and the scope constraint);
  - `scripts/behavioural-triggers.test.ts` (`needs_clearing` fixtures).
- Docs: `docs/backlog.md`, with the reset notice; `CLAUDE.md` if any line names a deleted code;
  `packages/db/README.md`.

**Interfaces:**
- Consumes: everything above. After this task the old tab routes and every table-to-bill pointer
  are gone.
- Produces: `TableState` without `tabId`; `CommandScope = { kind: "party"; partyId } | { kind:
  "bill"; workingOrderId }`; `partyState = ["open", "closed"]`.

- [ ] **Step 0: Re-map, and list what the rebuilds will meet.**
  - `git grep -n "tab_id\|\.tabId" -- apps packages scripts ':!packages/db/drizzle'` gives every
    remaining read and write. Each is changed or deleted by this task. `packages/bookings`' own
    `bookings.tab_id` stays.
  - List every trigger whose body names `dining_tables`, `parties` or `service_commands`, or which
    is ON one of them. Run this on a database migrated to today's head, for example in a scratch
    `vitest` case or with the Task 1 query:
    ```sql
    select name, tbl_name from sqlite_master where type = 'trigger'
      and (tbl_name in ('dining_tables','parties','service_commands')
           or sql like '%dining_tables%' or sql like '%parties%' or sql like '%service_commands%')
    order by name;
    ```
    Expected, from Tasks 1 to 7: `parties_clear_table_status`, `working_orders_release_main_bill`
    and `working_orders_release_main_bill_on_move`, plus any B-task or C-task trigger added since.
    Every one goes in migration A and back in migration C.
  - Check for append-only triggers on these tables, and change-feed triggers. `applyMigrations`
    removes the change feed first (CLAUDE.md §2) and installs the append-only ones after each set.

- [ ] **Step 1: Write the failing tests.**
  - In `packages/db/src/schema/parties.test.ts`, change Task 1's `sqlite_master` case to expect
    `[]`: no object names "visit" any more.
  - Add: a `parties` row with `state: 'needs_clearing'` is refused by `parties_state_ck`.
  - Add: `pragma table_info(dining_tables)` has no `tab_id`.
  - Add: `service_commands` refuses `scope_kind: 'visit'` and accepts `'party'`.
  - In `apps/server/src/till-api.parties.test.ts`, each deleted tab route answers 404.

  Run them. Expected: FAIL.

- [ ] **Step 2: The migrations.**
  1. `pnpm --filter @waitron/db db:generate:custom --name=drop_triggers_before_rebuild` writes
     migration A: `DROP TRIGGER` for each trigger Step 0 listed.
  2. Make the schema changes, then run `pnpm --filter @waitron/db db:generate`, generating
     migration B. Read it. It must rebuild exactly `dining_tables`, `parties` and
     `service_commands` (`__new_dining_tables`, `__new_parties`, `__new_service_commands`); any
     other `__new_` table is a STOP. Its journal entry must come AFTER A's. drizzle orders by
     `created_at` alone (CLAUDE.md §3), and A was generated first, so check
     `packages/db/drizzle/meta/_journal.json`.
  3. `pnpm --filter @waitron/db db:generate:custom --name=recreate_triggers_after_rebuild` writes
     migration C: each trigger A dropped, re-created with its text from its last migration, with
     the table and column names as they are now.
  4. Run the guards:
     ```bash
     pnpm exec vitest run scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts scripts/behavioural-triggers.test.ts scripts/append-only-triggers.test.ts scripts/migration-upgrade.test.ts scripts/two-file-foreign-keys.test.ts scripts/classification-complete.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts
     ```
     Expected: PASS. `migration-upgrade` walks empty tables, so it cannot see measurement 5's
     failure on rows. Step 3 measures that.

- [ ] **Step 3: Measure the reset, and write it down** (P28).

  **The foreign keys into the rebuilt tables**, read from the migration files on `f19768b3e`. Every
  one is `ON DELETE no action`, so a row in any of them makes the rebuild's `DROP TABLE` fail inside
  the migrator's transaction (`docs/developers/conventions-data.md`, the rebuild paragraphs):
  - into `dining_tables`: `bookings.table_id` (`packages/bookings/drizzle/0000_baseline.sql:16`),
    `working_orders.delivery_table_id` (`packages/db/drizzle/0000_baseline.sql:125`) and
    `party_tables.table_id` (`0018_visits.sql:21`);
  - into `parties`: `party_tables.party_id`, `working_orders.party_id`, `order_groups.party_id`,
    `order_group_events.party_id` and `order_drafts.party_id`, plus `parties.merged_into_party_id`
    into itself;
  - into `service_commands`: none. The last command below finds nothing.

  So the reset is needed on any venue that ever seated a party, took a booking for a table, or
  delivered a counter order to a table. Re-run these on the `main` you start from, and list any key
  added since:
  ```bash
  grep -n 'REFERENCES `dining_tables`' packages/*/drizzle/*.sql
  grep -n 'REFERENCES `parties`\|REFERENCES parties' packages/*/drizzle/*.sql
  grep -n 'REFERENCES `service_commands`' packages/*/drizzle/*.sql
  ```
  The second also finds a key added by `ALTER TABLE … ADD … REFERENCES parties(id)`, drizzle's form
  for a column added to an existing table (measurement 6). Task 1's rename leaves the older keys
  spelled `visits` in the migration files, so read `pragma foreign_key_list(<table>)` on a migrated
  database for the five tables listed above as well.

  Start the previous `main`'s dev venue with at least one party seated and finished, then start this
  branch on it.
  - **Expected:** the boot fails at migration B with `FOREIGN KEY constraint failed`. That is
    measurement 5's shape.
  - If it does NOT fail, find out why before claiming the reset is needed.

  Then run `wa-wt reset demo <worktree>`, and boot again: it must start. Put both outcomes, their
  commands and their output in the PR, and put the reset instruction (every dev venue, and the
  owner's box wiped once) in `docs/backlog.md`.

- [ ] **Step 4: Implement the code deletions and the derivations.**
  - Deletions: the Files list.
  - `listTablesWithState`'s derived table becomes a join on `party_tables` and `working_orders` by
    `party_id`, grouped per table. Keep the file's existing note on why it is a grouped derived
    table and not a LATERAL join (`working-order.ts:5645-5650` on `f19768b3e`).

  Then run:
  ```bash
  cd apps/server && pnpm exec tsc --noEmit && pnpm exec vitest run src/parties.test.ts src/party-main-bill.test.ts src/party-bill-actions.test.ts src/party-move-bill.test.ts src/party-table-actions.test.ts src/party-arriving-dishes.test.ts src/till-api.parties.test.ts src/till-api.tables.test.ts src/kitchen-print.test.ts src/booking-seat.test.ts
  cd ../till && pnpm exec tsc --noEmit
  ```
  Expected: PASS.

- [ ] **Step 5: The final sweeps.**
  ```bash
  git grep -n "tab_id\|\.tabId\b" -- apps packages scripts ':!packages/db/drizzle' ':!packages/bookings/src/schema/bookings.ts'
  git grep -n -i "freeSourceTable\|splitOffCheck\|mergeTabs\|merge_leaves_no_table\|not_table_tab\|party_mismatch\|has_other_open_bill" -- apps packages scripts docs/developers CLAUDE.md
  ```
  Expected:
  - the first command prints only lines about a BILL's `tabId` in names that still say "tab" for a
    bill, such as `SubmittedGroups.tabId`, each read and justified in the PR, or renamed;
  - the second prints nothing.

  Then rerun Task 1 Step 9's `visit` grep without the P1 survivor filter. Expected: only the
  ordinary-English lines.

- [ ] **Step 6: The fiscal gates, unedited** (Task 5 Step 3). Expected: PASS.

- [ ] **Step 7: Commit, then `/finish-branch`.**
  ```bash
  git add packages/db packages/bookings apps/server apps/till scripts docs/backlog.md CLAUDE.md packages/db/README.md
  git commit -s -m "Remove the old tab routes and the table's pointer to a bill; every venue needs a reset (table actions, Task 13)"
  ```
  Label the PR `needs-owner-review`. Its description opens with the reset. The owner lands it.

---

## Finish (every task)

Each task ends with `/finish-branch` in its worktree, then `/land-branch` once the owner or the
campaign's rules allow. The next task starts from a freshly synced `main`. Update `docs/backlog.md`
in the task's own PR wherever the task makes it stale. **The last task to land** also sweeps spec
§15's test list against what landed, and records any item not met in the backlog.

---

## Self-review notes

- **Spec coverage.**

  | Spec | Tasks |
  | --- | --- |
  | §1–§3 | the "What the code is today" section; the one correction is below |
  | §4, decision 1 | 8, 11 |
  | decision 2 | 2, 5, 7 |
  | decision 3 | 2 (P6), 8 (split a table's name), 11 (naming) |
  | decision 4 | 5 (P21), 8 |
  | decision 5 | 5 (P3), 7 |
  | decision 6 | 3, 8 (P8, narrowed by owner ruling 3) |
  | decision 7 | 2 (P5), 10 |
  | decision 8 | 10 (M7b3 goes) |
  | decision 9 | 4 (P7) |
  | decision 10 | 8, 11 |
  | decision 11 | 5 and 7 |
  | decision 12 | 7 (never repriced, and tested) |
  | decision 13 | 3 (P8) |
  | decision 14 | 1 |
  | decision 15 | 2 (P4), 7, 8 |
  | §5 | 2 (name, main bill, display name), 3 (table state), 13 (`tab_id` dropped) |
  | §6 | 8 (Seat is unchanged, since Task 2 only sets the main bill), 3 (Finish, Cleared) |
  | §7 | 5 (split, merge, transfer, paid items), 7 (move a bill, groups leaving, service area), 9 (groups arriving), 2 and 10 (new orders), 10 (no putting-back) |
  | §8 | 4 (slips, pass, receipts, MOVED on table actions), 7 (MOVED on bill and counter moves) |
  | §9 | 5 and 7 (no payment moves, presented bills frozen), 6 (collection by invoice), the fiscal gates in 5, 6, 7 and 8 |
  | §10 | P11: new codes in 2, 3, 7 and 8; renamed in 1; gone in 13 |
  | §11 | 10 (A111's rule and M7b3 leave the till's use), 13 (A111's refusal, `freeSourceTable`, cross-party merge and transfer, and checks, all deleted) |
  | §12 | the "When each task may start" table; A81 and A82 in 7 and 12; A96 in 9; C31 below |
  | §13 | every accepted proposal is a P-decision: 1 → Task 8; 2 → P8; 3 → P6; 4 → P12; 5 → P24 and P25; 6 → P21; 7 → P12; 8 → P7; 9 → P15; 10 → the task table |
  | §14 | nothing is built for the out-of-scope items |
  | §15 | each bullet is named in the task that owns it: read-backs (Global Constraints); refusals and each side of a merge (5); two tills (5, 7, 8); money (7); main bill (2, 7, 8); presented bill paid after a move (6, 7); paid bill (7, 8); kitchen groups (7, 8, 9); MOVED (4, 7, 8); service area (7); the till looked at (3, 10, 11, 12) |

- **Lane C's C31** (print failures per dish) is independent, as spec §12 says. Whichever lands
  second rebases. Task 4 changes `kitchen-print.ts`'s label reads and Task 5 its merge link move;
  check `gh pr list` for C31 at each.
- **Interfaces across tasks:**
  - `partyMainBill`, `setMainBill`, `partyZone`, `partyTableLabels` and `requireBillOfParty`
    (Task 2) are used by 4, 5, 7 and 8;
  - `leaveForCleaning` (3) is used by 8;
  - `orderTableLabel`, `readPartiesSentWork` and `enqueueMovedSlipsFor` (4) are used by 7 and 8;
  - `requireUntouched` and the merge internals (5) are used by 7 and 8;
  - `takeIntoParty`, `leaveParty` and `isUntouched` (7) are used by 8 and 9;
  - `groupArrivingDishes` (9) is called from 7's and 8's functions;
  - the till's client methods (10–12) match the routes' bodies (5, 7, 8) field for field;
  - `expectedPartyRevision` and `expectedOtherPartyRevision` are the only two revision names on the
    new routes.
- **Where the spec and the code disagree, read from the code:**
  1. **Spec §3** says a bill's invoice is issued before payment in the invoice-first flow, and
     decision 15 speaks of a presented main bill. On `f19768b3e`, no product path presents a
     PARTY's bill: a party bill takes its table's `table_tab` mode, and placing it files nothing
     (`apps/server/src/visits.test.ts:366-376`, and `openTab` refusing any zone whose mode is not
     `table_tab`, `working-order.ts:1002-1010`).
     - A presented bill enters a party only by Task 7's move from the counter.
     - The main-bill rule still covers it (P4). The tests that need a presented party bill place
       one by a direct write, as the existing suites do.
  2. **Spec §2 defines "presented" by the invoice.** The code's `placed` status also covers a
     ticket-then-pay counter order with no invoice yet. P2 treats both as presented, because the
     triggers freeze both. Collection asks about the invoice (P22).
  3. **Spec §7 says a presented bill moves whole,** but `working_orders_enforce_transition` refuses
     any `placed → placed` update (`0019_…sql:9-31`). Also,
     `working_order_lines_require_open_parent_update` refuses any update to a placed bill's lines,
     which a move must make to change a dish's kitchen group (`0027_line_vat_class_triggers.sql:14-22`;
     probed by the plan review). P14 adds a narrow exception to each (Task 7). The line exception
     was decided by the watcher on the owner's behalf.
  4. **Spec §8's "a deli order's delivery table changing"** has no path on `f19768b3e`. Nothing
     updates an existing order's `delivery_table_id`. Task 7's move into a party is the first; it
     clears the column and the label change sends the notice.
  5. **Spec §5 drops `tab_id`,** and that needs a rebuild which fails on any venue that ever seated
     a party (measurements 4 and 5). Hence P28 and the owner's review of Task 13.
  6. **The brief for this plan says lane B builds B10–B17 in parallel,** while spec §12 and §13
     item 10 put this work before B10. Owner ruling 1 settles it: lane B holds until Task 13 lands.
- **Owner rulings** (2026-09-28) are listed near the top of the plan: lane B timing, Task 13's
  reset, the clearing setting, and a pending card payment on a moved bill.
- **Flagged for the owner in the PRs that implement them:**
  - P17: a MOVED slip for a counter move can name the same label twice;
  - P16: dishes arriving in a party get a group, which reads against spec §15's "outside any
    group";
  - P19: a pending card payment does not stop a bill moving, which retires A82's refusal;
  - P28: the venue reset.
- **Honest limits of this plan:**
  - Every `file:line` was read on `f19768b3e`, before B9, so each task's Step 0 re-maps.
  - The scratch measurements used a hand-written migration runner, not `applyMigrations`, so each
    migrating task re-measures through the root guards.
  - The till tasks' test code uses the helper names `till-app-visits.test.ts` has today, renamed
    by Task 1, so check them after Task 1 lands.

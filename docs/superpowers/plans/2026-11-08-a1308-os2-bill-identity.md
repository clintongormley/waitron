# A1308 orders and sales, PR 2: a bill's number, name and editor live on the bill — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `bill_identities` and `bill_edit_states` into `working_orders` (`bill_number`,
`bill_name`, `editor_id`, `editor_version`), replace `bill_number_allocations` with the party's
counter `parties.last_bill_number`, make a party merge move settled bills too, and rewrite the
transition trigger with the owner's five-column exception for settled bills.

**Architecture:** The venue-service seam keeps its function names (`allocateBillNumber`,
`rescopeBillNumbers`, `releaseBillNumber`, `setBillName`, `readBillIdentities`,
`packages/module/src/module.ts:1361-1370`) so most callers do not change; their bodies read and
write `working_orders` and `parties`. One rewrite of `working_orders_enforce_transition` in
`packages/db/triggers/core.sql` (slice 1a's trigger source).

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §10 ("A settled bill: five columns
may change", "Merging two parties: also moves their settled bills"), §5 U11 (person keys);
[tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md) §1.1, §4, §5
(working_orders, bill_identities, bill_edit_states, bill_number_allocations), §6 items 3–4, §8 M8;
[tables-floorkitchen.md](../specs/2026-11-02-rationalisation/tables-floorkitchen.md) `parties`
(`last_bill_number`, :306, :313). Rules: [slice rules](2026-11-08-a1308-slice-rules.md).

**Who lands:** the lane (rules §6: no `sales`, invoice number, fiscal record or hash input changes;
a bill number is the table's "Bill 2", not an invoice number).

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

---

## What it builds

1. `working_orders` gains `bill_number` (integer, null), `bill_name` (text, null), `editor_id`
   (text, null, key to `persons`, design U11), `editor_version` (integer, not null, default 0), with
   CHECKs `working_orders_bill_number_ck` (`bill_number is null or (party_id is not null and
   typeof(bill_number) = 'integer' and bill_number >= 1)`), `working_orders_bill_name_ck` (1–40
   characters and trimmed, as `bill_identities_name_ck`), `working_orders_editor_version_ck`
   (`editor_version >= 0`), and the partial unique index `working_orders_party_bill_number_key` on
   `(party_id, bill_number) where bill_number is not null`.
2. `parties.last_bill_number` (not null, default 0) and the trigger
   `parties_last_bill_number_no_decrease`. Floor and kitchen's fk6 leaves both to this PR
   (`2026-11-08-a1308-fk6-parties-and-person-keys.md:57`: "the orders and sales area, in the pull request
   that deletes `bill_number_allocations`").
3. `bill_identities`, `bill_edit_states`, `bill_number_allocations` deleted.
4. **A merge moves settled bills too** (owner, 2026-11-04): `combineParties` takes the `from` party's
   settled bills into `into` and renumbers every non-abandoned bill there. Abandoned bills stay where
   they are, as today.
5. **The transition trigger rewrite** with M8's cases.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `zone_id`, `department_id`, `service_mode` (from `order_service_contexts`) | os3, which adds them to the trigger's lists |
| `departments.transfer_desk_profile_id` | the venue-and-box slice |
| Person keys on the tables this area keeps unchanged | os11 |
| Any change to when a bill may be named or merged | none: "only the server limits when these happen" (tables-ordersales.md §5) |

## Files

- Modify: `packages/db/src/schema/orders.ts` (four columns, three CHECKs, one index; import `persons`)
- Modify: `packages/db/triggers/core.sql` (`working_orders_enforce_transition`,
  `parties_last_bill_number_no_decrease`); `packages/db/src/trigger-refusals.ts` (one constant)
- Modify: `packages/db/src/schema/parties.ts`
- Delete: `packages/db/src/schema/venue-service/bill-identities.ts`, `packages/db/src/schema/bill-edit-states.ts`,
  `packages/db/src/schema/bill-edit-states.test.ts`, `packages/venue-service/src/schema/bill-identities.test.ts`
  (their cases move, Task 2)
- Modify: `packages/db/src/index.ts`, `packages/db/src/classification.ts` (`bill_edit_states` entry
  `:213`; `bill_identities`, `bill_number_allocations` entries near `:362`),
  `packages/venue-service/src/classification.ts:41-42`, `packages/venue-service/src/index.ts`,
  `packages/venue-service/src/backup-verification.ts:10` (drop `bill_number_allocations`),
  `packages/migrations/migrations.manifest.json:31` (drop `bill_number_allocations`)
- Modify: `packages/venue-service/src/bill-identities.ts` (all five functions, 85 lines)
- Modify: `apps/server/src/bill-editing.ts:99-107` (`writeEditor`), `:292-301` (`readBillEditState`);
  `apps/server/src/order-drafts.ts:815-829`; `apps/server/src/bill-identities.ts:13-57`;
  `apps/server/src/move-bill.ts:241-249` (counter move: `billNumber: null` in the same update as
  `partyId: null`), `:333-336` (`moveSettledBillToCounter`: the same), `:504-508` (`takeIntoParty` clears
  the number);
  `apps/server/src/table-actions.ts:250-256` (`combineParties`)
- Modify (tests and helpers): `apps/server/src/testing/bill-identities.ts`,
  `apps/server/src/testing/party-bill-of.ts`, and the test files naming the three tables:
  `bill-identities.test.ts`, `till-api.parties.test.ts`, `till-api.zone-closed.test.ts`,
  `testing/party-bill-of.test.ts`, `bill-editing*.test.ts` (4 files), `draft-split.test.ts`,
  `find-bill-api.test.ts`, `parked-table-payments.test.ts`, `till-api.drafts.test.ts`,
  `bill-editing.table-actions.test.ts`, `party-table-actions.test.ts`, `party-bill-create.test.ts`,
  `testing/whole-payment-fixture.ts`, `packages/venue-service/src/bill-identities.test.ts`,
  `packages/db/src/schema/orders.transition.test.ts`, `packages/db/src/schema/orders.test.ts`,
  `apps/server/src/personal-data-actions.coverage.test.ts:45`
- Modify (guards): `scripts/schema-constraints.test.ts` (rows naming `bill_identities`),
  `scripts/append-only-triggers.test.ts:38`, `scripts/behavioural-triggers.test.ts`, `scripts/floor-kitchen-triggers.test.ts`
  (it pins the floor-and-kitchen trigger list: add `parties_last_bill_number_no_decrease`; whichever of fk6
  and this PR lands second updates it), `packages/db/src/classification.test.ts`, `packages/venue-service/src/classification.test.ts`,
  `packages/venue-service/src/backup-verification.test.ts`,
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:26-27` (drop `bill_identities` and
  `bill_number_allocations` from `ADDED_TABLES`; add `bill_edit_states` to `REMOVED_TABLES`; push the
  four new `working_orders` columns as the `working_orders` recipient columns are pushed at `:141-145`)
- Generated: core's starting migration through the rebuild command

## Size

| | Counted | Not counted |
| --- | --- | --- |
| Code | schema 40, trigger text 90 (the rewritten branches), seam bodies 70, server 60 | deleted schema files and tests (about 250 lines); generated files |
| Tests | M8 trigger cases 200, moved constraint cases 80, re-pointed reads in about 16 files 150, `allocationsOf` rewrites 60, merge behaviour and the counter-move cases 80, `MOVABLE_ORDER_COLUMNS` 2 | — |

About 920 counted lines (the `parties` column and trigger included); about 3 hours. Over about 1,200 is rules §5.6's stop: split Task 4 (the merge change)
into its own PR before Task 5.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/orders.transition.test.ts src/schema/orders.test.ts --reporter=dot
pnpm --filter @waitron/venue-service exec vitest run src/bill-identities.test.ts src/classification.test.ts src/backup-verification.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/bill-identities.test.ts src/bill-editing.test.ts src/bill-editing.commands.test.ts src/bill-editing.multiple.test.ts src/bill-editing.transitions.test.ts src/bill-editing.table-actions.test.ts src/party-table-actions.test.ts src/till-api.parties.test.ts src/till-api.move-bill.test.ts src/till-api.zone-closed.test.ts src/draft-split.test.ts src/find-bill-api.test.ts src/parked-table-payments.test.ts src/till-api.drafts.test.ts src/personal-data-actions.coverage.test.ts --reporter=dot
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/floor-kitchen-triggers.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts --reporter=dot
```

## Expected protection-list difference

Both compositions; venue database.

| Table | Line | Phases |
| --- | --- | --- |
| `bill_edit_states` | `missing table bill_edit_states`; `missing index bill_edit_states.primary key(bill_id)` | all |
| `bill_edit_states` | `missing trigger waitron_change_bill_edit_states_insert`, `_update`, `_delete` | change-feed |
| `bill_identities` | `missing table bill_identities`; `missing index bill_identities.primary key(working_order_id)`; `missing index bill_identities_party_number_key` | all |
| `bill_identities` | `missing trigger waitron_change_bill_identities_insert`, `_update`, `_delete` | change-feed |
| `bill_number_allocations` | `missing table bill_number_allocations`; `missing index bill_number_allocations.primary key(id)`; `missing index bill_number_allocations_party_number_key` | all |
| `bill_number_allocations` | `missing trigger bill_number_allocations_append_only_update`, `…_append_only_delete` | migrated, change-feed |
| `bill_number_allocations` | `missing trigger waitron_change_bill_number_allocations_insert`, `_update`, `_delete` | change-feed |
| `working_orders` | `extra table working_orders.columns[bill_number]`, `[bill_name]`, `[editor_id]`, `[editor_version]` | all |
| `working_orders` | `extra table working_orders.checks[working_orders_bill_number_ck]`, `[working_orders_bill_name_ck]`, `[working_orders_editor_version_ck]` | all |
| `working_orders` | `extra table working_orders.foreignKeys[editor_id->persons(id)]` | all |
| `working_orders` | `extra index working_orders_party_bill_number_key` | all |
| `working_orders` | `changed table working_orders.columnOrder` (the four columns join the list) | all |
| `working_orders` | `changed trigger working_orders_enforce_transition.body` | all |
| `working_orders` | `changed trigger waitron_change_working_orders_update.when` | change-feed |
| `parties` | `extra table parties.columns[last_bill_number]`; `extra trigger parties_last_bill_number_no_decrease` (all); `changed table parties.columnOrder` (all); `changed trigger waitron_change_parties_update.when` (change-feed) | as stated |

Where each old protection went (tables-ordersales.md §5): the scope, number and name CHECKs →
`working_orders_bill_number_ck` and `_bill_name_ck` (the scope check becomes one-way, "a number only
with a party", because a bill is inserted before it is numbered, `working-order.ts:1713, :1734`);
`bill_identities_party_number_key` → `working_orders_party_bill_number_key`;
`bill_number_allocations_party_number_key` plus its append-only triggers ("never give a number
twice") → the counter and its no-decrease trigger; `bill_edit_states_version_ck` →
`working_orders_editor_version_ck`; the cascade from the bill is inherent. Dropped with a reason:
venue-service's backup check that treated `bill_number_allocations` as immutable
(`backup-verification.ts:10`).

## Stop points (beyond rules §5)

- An editor write (`writeEditor`, `order-drafts.ts:822`) hits an **abandoned** bill in any suite. No
  branch of the trigger lets an abandoned bill change, and the owner's exception names settled bills
  only. Today nothing guards `bill_edit_states`, so such a write would have passed silently.
- A suite shows a settled bill changing `revision`, `zone`, or any column other than the five.

## Assertions that change, by design (rules §4)

Each is named here in advance; any other changed assertion is a stop.

- `packages/db/src/schema/orders.transition.test.ts:696, :720, :740` (Task 2 Step 2): the owner's
  five-column exception (README §10).
- `scripts/behavioural-triggers.test.ts:657` `MOVABLE_ORDER_COLUMNS` gains `bill_number`, `bill_name`,
  `editor_id`, `editor_version`: a presented bill's move may change them with its party, because they are
  free wherever `party_id` is free on an open or placed bill (tables-ordersales.md §5). The test reads the
  columns live (`:658-663`), so without this it would report them as wrongly accepted.
- `allocationsOf` assertions in `packages/venue-service/src/bill-identities.test.ts:92, :114, :246, :324,
  :380, :432, :463, :654` and in `apps/server/src/party-bill-create.test.ts`: they assert the history of
  every number a party gave (rows of `bill_number_allocations`), which a counter cannot reproduce. Each
  becomes an assertion of `parties.last_bill_number` and of the bills' current numbers; where a case's
  point is "a number is never given again", it asserts the next number given instead.
- Any assertion that a paid bill stays on a merged-away party (Task 4 Step 4): the owner's merge decision.

## Needs

- **In this area:** os1.
- **Outside:** floor and kitchen's fk6 (it rewrites `parties`) has landed, or waits for this one
  (rules §7; fk6:57). **Which slice adds `parties.last_bill_number`:** this one, as fk6 decided, though
  `tables-floorkitchen.md` lists the column in its `parties` design (:306, :313). People's A1002 is not needed: `persons` is already in core (A760).

---

## Global Constraints

- Rules §1–§9.
- **The five columns** that may change on a settled bill: `party_id`, `bill_number`, `bill_name`,
  `editor_id`, `editor_version` (README §10). Nothing else loosens.
- On an open or placed bill, the four new columns are free in exactly the branches where `party_id`
  is free today, and pinned where it is pinned (tables-ordersales.md §5).
- A bill number is never given twice within a party: the next number is `last_bill_number + 1`.
- Bill name rule: `normalisePartyName` (`@waitron/shared`), 1–40 characters, trimmed.

## Review Focus

1. **A bill moved into a party that already uses its number** (Bill 1 of table A moved to table B
   which has a Bill 1). The partial unique index refuses the intermediate row unless the move clears
   the number first. Test: Task 4's "moving Bill 1 onto a party with a Bill 1 numbers it 2".
2. **A merge with a settled, collected bill on the `from` party.** It moves and is renumbered.
   Test: Task 4 and M8's case.
3. **A number never comes back.** A bill moves away and another arrives: it gets the next number,
   not the freed one. Test: Task 3's counter case.
4. **Naming a settled bill** keeps working, and is guarded by the bill's own party now (the
   "numbering party" goes, `apps/server/src/bill-identities.ts:23-26`). Test: Task 3's "naming a paid
   bill after a merge".
5. **A counter bill** (no party) has no number: the CHECK refuses a number without a party. Test: Task 1,
   and Task 3's counter-move case.
6. **The `parties` live update fires on every new bill number**, because the counter is a column of
   `parties` (`waitron_change_parties_update`); today a new number touched only `bill_number_allocations`
   and `bill_identities`. Screens subscribed to `parties` refresh once more per new bill; the PR says so.

---

### Task 1: The party's counter and the new columns

**Files:** `packages/db/src/schema/orders.ts`, `packages/db/src/schema/parties.ts`,
`packages/db/triggers/core.sql`, `packages/db/src/trigger-refusals.ts`, `scripts/behavioural-triggers.test.ts`;
`packages/db/src/schema/orders.test.ts`.

- [ ] **Step 1: Check fk6 left it.** `git grep -n "last_bill_number" -- packages/db` finds nothing;
  if it finds the column, fk6 changed course: drop the `parties` parts here and tell the watcher.
- [ ] **Step 2: Write the failing tests** in `orders.test.ts`, describe `"a bill's identity columns"`:
  - `"refuses a bill number without a party"` → error names `working_orders_bill_number_ck`; control:
    with a party, number 1 is accepted.
  - `"refuses a bill number of 0 or 1.5"` → same CHECK.
  - `"refuses a bill name that is blank, untrimmed or 41 characters"` → `working_orders_bill_name_ck`;
    control: 40 characters accepted.
  - `"refuses a second Bill 2 in one party, and allows Bill 2 in another"` → unique on
    `working_orders_party_bill_number_key`.
  - `"refuses an editor version below 0"` → `working_orders_editor_version_ck`.
  - `"refuses an editor who is not a person"` → foreign key failure; control: a seeded person.
  - In `scripts/behavioural-triggers.test.ts`: `"a party's last bill number
    never goes down"` → refusal with `BILL_NUMBER_DECREASE_REFUSAL`; accepting control: 0 → 1 → 2;
    and add the trigger to `EXPECTED_TRIGGERS`.
- [ ] **Step 3: Run; they fail.**
- [ ] **Step 4: Implement** the columns, CHECKs and index above;
  `lastBillNumber: count("last_bill_number").notNull().default(0)` on `parties`; in `core.sql`
  `CREATE TRIGGER parties_last_bill_number_no_decrease BEFORE UPDATE OF last_bill_number ON parties
  FOR EACH ROW WHEN new.last_bill_number < old.last_bill_number BEGIN SELECT raise(abort, '<constant>'); END;`;
  the constant `BILL_NUMBER_DECREASE_REFUSAL = "a party's last bill number never goes down"`.
  Rebuild core.
- [ ] **Step 5: Run; PASS. Commit** `feat(db): a bill's number, name and editor are columns of the bill`.

### Task 2: Rewrite the transition trigger (M8, first half)

**Files:** `packages/db/triggers/core.sql` (`working_orders_enforce_transition`, today
`packages/db/drizzle/0000_baseline.sql:3553-3700`); `packages/db/src/schema/orders.transition.test.ts`.

The branches today, and what each becomes:

| Branch (today's order) | Pins `party_id` today? | Change |
| --- | --- | --- |
| `old.status = 'open'` | no (free) | none |
| placed → settled/abandoned, invoice columns pinned | no | none (the four stay free) |
| placed → placed, general | no | none |
| placed → placed, the handover stamp | yes | add the four to the pinned list |
| settled → settled, the handover stamp | yes | add the four |
| settled → settled, "leave its party once" (A758-7) | changes it | **replaced** by the five-column branch below |
| delivery-table release | yes | add the four |

**The five-column branch:** it opens with the comment line
`-- settled: party, bill number, bill name and editor may change (owner, 2026-11-04)` (the test's anchor),
then `old.status = 'settled' AND new.status = 'settled'`, and every column of
`working_orders` except `party_id`, `bill_number`, `bill_name`, `editor_id`, `editor_version` is
`IS old.` (including `collected_at`, `revision`, `status`, `zone`-to-come in os3). It is a superset of
the A758-7 branch, so `moveSettledBillToCounter` (`move-bill.ts:313-336`) keeps working.

- [ ] **Step 1: Write the failing tests** in `orders.transition.test.ts` (M8, tables-ordersales.md §8):
  - `"a settled bill may change only party, bill number, bill name and editor"` — one update per
    column of the five on a settled, uncollected bill: each accepted.
  - The same on a **settled, collected** bill: each accepted (a merge renumbers collected bills,
    `packages/venue-service/src/bill-identities.ts:36-48`).
  - `"a settled bill still refuses every other column"` — on a **collected** settled bill (so the handover
    stamp branch cannot accept a `collected_at` change), loop over `pragma_table_info('working_orders')`
    minus the five and `status`: each single-column update refused with `TRANSITION_REFUSAL`.
  - `"the handover stamp refuses a bill number or editor change in the same update"` — placed and
    settled: refused.
  - `"an abandoned bill refuses an editor change"` — refused (see Stop points).
  - `"a placed bill's identity columns change freely"` — accepted.
- [ ] **Step 2: Change the assertions the owner's decision retires, and only these** (rules §4 needs
  this named in advance; README §10 "A settled bill: five columns may change"):
  `"refuses a handed-over order leaving its party"` (`:696`) and `"refuses a settled order joining a
  party or changing party"` (`:720`) now expect acceptance, and are renamed
  `"lets a handed-over order leave its party"` / `"lets a settled order join or change party"`.
  `"the exception names every column"` (`:740`) anchors on a marker unique to the new branch, the SQL
  comment `-- settled: party, bill number, bill name and editor may change (owner, 2026-11-04)` that the
  branch opens with (the handover-stamp branch also starts `old.status = 'settled' AND new.status =
  'settled'`), instead of `old.party_id IS NOT NULL AND new.party_id IS NULL`, and exempts the five columns.
  `"rejects any change to a settled order other than the handover stamp or leaving its party …"`
  (`:248`) keeps its assertions for every other column. Any other assertion that must change is a stop.
- [ ] **Step 3: Run; the new cases fail.**
- [ ] **Step 4: Rewrite the trigger** in `core.sql` per the table; rebuild core.
- [ ] **Step 5: Run** `orders.transition.test.ts` and `scripts/behavioural-triggers.test.ts`; PASS.
- [ ] **Step 6: Commit** `feat(db): a settled bill may change its party, number, name and editor (owner, 2026-11-04)`.

### Task 3: The seam reads and writes the bill

**Files:** `packages/venue-service/src/bill-identities.ts`; `apps/server/src/bill-editing.ts`,
`order-drafts.ts:815-829`, `bill-identities.ts`, `move-bill.ts:504-508`; `packages/venue-service/src/bill-identities.test.ts`;
the server test files listed under Files.

**Interfaces (unchanged names):**
- `allocateBillNumber(tx, billId, partyId): Promise<number>` — `update parties set last_bill_number =
  last_bill_number + 1 where id = ? returning last_bill_number`, then `update working_orders set
  party_id = ?, bill_number = ? where id = ?`.
- `rescopeBillNumbers(tx, billIds: readonly string[], intoPartyId: string): Promise<void>` —
  **signature changes**: it numbers the named bills in `into`, in their current `bill_number` order then
  id (the order `bill-identities.ts:46` uses). The one caller is `table-actions.ts:256` (Task 4); update
  `packages/module/src/module.ts:1363`.
- `releaseBillNumber(tx, billId)` — sets `bill_number = null`; the name stays (`:50`).
- `setBillName(tx, billId, name)` — updates `working_orders.bill_name`; throws as today when the bill
  has no party (`:65-68`'s "no identity" becomes "no party").
- `readBillIdentities(tx, billIds)` — reads `party_id`, `bill_number`, `bill_name` from `working_orders`
  for the named bills; a bill with no party and no name is absent, as a bill with no identity row is today.
- `apps/server/src/bill-editing.ts` `writeEditor` and `readBillEditState`: `update working_orders set
  editor_id, editor_version = editor_version + 1`; read the two columns from `working_orders`.

- [ ] **Step 1: Re-point the existing tests first** (rules §4: set-up and table names change,
  assertions do not): every `billIdentities` read becomes a `working_orders` read of the same three
  facts; every `billNumberAllocations` read becomes `parties.last_bill_number`; every
  `billEditStates` read becomes the two `working_orders` columns. Add, in
  `packages/venue-service/src/bill-identities.test.ts`: `"a number freed by a bill that left is never
  given again"` (Bill 1, Bill 2; Bill 2 leaves; a new bill is 3). In `apps/server/src/bill-identities.test.ts`:
  `"naming a paid bill after a merge"` (a settled bill moved by a merge is named through the party it is on
  now; the name is stored; that party's revision guards it). In `apps/server/src/till-api.move-bill.test.ts`:
  `"moving a bill to the counter clears its number in the same write"`.
- [ ] **Step 2: Run; they fail to compile** (the tables are gone from `@waitron/db` after Task 5's
  deletion; do Task 5's schema deletion first if the order of commits needs it).
- [ ] **Step 3: Implement** the bodies above. `takeIntoParty` (`move-bill.ts:504-508`) adds
  `billNumber: null` to its update, so a bill arriving with a number from another party never collides
  before its caller numbers it (`move-bill.ts:263, :298`). The counter move (`:241-249`) and
  `moveSettledBillToCounter` (`:335-336`) set `billNumber: null` in the update that sets `partyId: null`,
  because `working_orders_bill_number_ck` refuses a number without a party in between; their following
  `releaseBillNumber` calls (`:249`, `:336`) are deleted. `apps/server/src/bill-identities.ts:13-57`:
  the numbering party is the bill's own party; delete the paragraph about a paid bill left on a merged
  party (`:23-26`), which no longer happens.
- [ ] **Step 4: Run** the server and venue-service commands of the Finish line; PASS.
- [ ] **Step 5: Commit** `refactor(venue-service): bill numbers and editors read and written on the bill`.

### Task 4: A merge moves settled bills

**Files:** `apps/server/src/table-actions.ts:215-260`; `apps/server/src/party-table-actions.test.ts`;
`apps/server/src/bill-editing.table-actions.test.ts`.

- [ ] **Step 1: Write the failing tests** in `party-table-actions.test.ts`:
  - `"combining parties moves the paid bills too, renumbered after the open ones"` — `from` has Bill 1
    (placed) and Bill 2 (settled, not collected); `into` has Bill 1. After the merge both are on
    `into`, numbered 2 and 3 in their old order; `from` has no non-abandoned bill.
  - `"a collected paid bill moves and keeps its collection"` — `collected_at` unchanged.
  - `"an abandoned bill stays on the merged-away party with its number"`.
  - `"moving Bill 1 onto a party with a Bill 1 numbers it 2"` (Review Focus 1), through `moveBill`.
- [ ] **Step 2: Run; the first two fail** (settled bills stay on `from` today, `table-actions.ts:250`).
- [ ] **Step 3: Implement.** In `combineParties`, before moving anything, read
  `numbered = from's non-abandoned bills ordered by bill_number, id`; clear their numbers; move
  open/placed bills as today; set `party_id = into` on the settled ones (allowed by Task 2's branch;
  their zone, department and editor do not change); then `rescopeBillNumbers(tx, numbered, into)`.
  Update the doc comment at `:215-219` ("its paid and abandoned bills stay on it") to "its abandoned
  bills stay on it".
- [ ] **Step 4: Readers of a merged party's paid bills.** Today a paid bill stays on the merged-away party
  and is found through the family (`partyFamily`, `apps/server/src/parties.ts:471`; callers include
  `bill-request.ts:76`, `finish-party-service.ts:122`, `parties.ts:737`, `kitchen-print.ts:1000, :2791`,
  `order-groups.ts:2127`, `line-cancel-context.ts:66`, and `receipt-guests.ts`' `guestsOfParty`). A family
  read still finds it, now on `into`; a read of one party alone may now see more bills. Read each caller and
  write in the PR which, if any, changes what it shows. (The review named `party-table-labels.ts`; no file
  of that name exists at HEAD.)
- [ ] **Step 5: Run** `party-table-actions.test.ts`, `bill-editing.table-actions.test.ts`,
  `till-api.parties.test.ts`; PASS. An assertion elsewhere that a paid bill stays on the merged-away
  party is the owner-decided change: list each one changed in the PR with this sentence; any other
  changed assertion is a stop.
- [ ] **Step 6: Commit** `feat(server): merging two parties also moves their paid bills (owner, 2026-11-04)`.

### Task 5: Delete the three tables; registries; guards

- [ ] **Step 1:** Delete the schema files and their exports, classification entries (core and
  venue-service), the manifest's `bill_number_allocations`, the backup-verification name.
- [ ] **Step 2:** Update `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts:38`,
  the two classification tests, `backup-verification.test.ts`, `seed.madrid-baseline.test.ts`
  (Files), and `personal-data-actions.coverage.test.ts:45` (`"bill_edit_states.editor_id"` →
  `"working_orders.editor_id"`).
- [ ] **Step 3:** Rebuild core; run the whole Finish line; run the protection list and compare with
  the prediction.
- [ ] **Step 4: Docs.** `docs/developers/conventions-data.md`: grep it and the guides for
  `bill_identities`, `bill_number_allocations`, `bill_edit_states` and "numbering party"; reword each
  sentence that describes the old tables (CLAUDE.md §1, "a behaviour change retires every receipt").
  The till guide's merge paragraph (`apps/server/src/guide/{en,es}/`): if it says paid bills stay on
  the old table, change both languages.
- [ ] **Step 5: Commit**, `/finish-branch`, PR.

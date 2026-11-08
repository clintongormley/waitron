# A1308 fk6 — a party holds its allergy answer; the area's person ids become checked keys: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every step also
> follows [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules").

**Goal:** `party_allergy` (one answer per party: "no allergies" or "allergies", and who gave it)
folds into `parties`; `party_allergy_guests` points at `parties` and keeps "a guest exists only for a
party with an answer" through a trigger; each answer is written to `activity_log`; and the six person
columns in this area gain keys to `persons`.

**Architecture:** `party_allergy` is keyed by `party_id`, so three columns on the party hold it
(appendix §1.9). The old key from guests to the answer row did two jobs: it refused a guest with no
answer, which a pair of `BEFORE` triggers now does, and it deleted the guests when the answer row was
deleted, which the one writer that clears an answer now does itself (appendix §1.11). Person keys
follow the house convention for keys into `persons`, `ON DELETE RESTRICT`
(`packages/db/src/schema/identity/persons.ts:25-28`).

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, the slice-1a rebuild command, slice
2's `activity_log` writer.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) U1, U11 (person keys; "an allergy
answer records a count only");
[appendix](../specs/2026-11-02-rationalisation/tables-floorkitchen.md) §1.9, §1.11, §1.14, §1.18,
§1.22, §3, §5, §7 ("People"), §8 items 4 and 5.

**First line of the pull request:** "Every venue is reset: core, bookings; backups and exports from
before this cannot be restored or imported."

**Who lands:** the lane (rules §6). `parties` feeds no fiscal value; `parties.last_bill_number` is not
added here (below).

## What it builds

- `parties.allergy_answer` (`none` | `allergies`, null = not asked yet), `allergy_answered_by` (key
  to `persons`), `allergy_answered_at`: an enum CHECK and "all three set or all null".
- `party_allergy` is deleted. `party_allergy_guests.party_id` → `parties.id`, `ON DELETE CASCADE` (as
  the old key cascaded); triggers `party_allergy_guests_need_answer_insert` and
  `party_allergy_guests_need_answer_update` refuse a guest whose party has no answer (the appendix's
  one trigger, `party_allergy_guests_need_answer`, is two because a SQLite trigger fires on one
  event).
- `activity_log` kind `party.allergy_answered`, `data = { answer, guestCount }` (appendix §3; never a
  guest's label or allergens).
- Keys to `persons(id)`, `ON DELETE RESTRICT`: `parties.opened_by`, `parties.closed_by`,
  `parties.allergy_answered_by`, `service_step_completions.done_by`,
  `ticket_item_moves.moved_by_person_id`, `bookings.created_by` (appendix §7 "People"; README U11).
- Appendix §8 item 5 (the allergy tick stays a table) and §8 item 4 (no unexpected trigger names this
  area's tables), each as a test.
- Shrinks the backlog entry "Person-id columns and `order_draft_lines.menu_item_id` have no foreign
  key" (`docs/backlog/architecture.md`, the A1308 bundle) by these six columns; it stays open for
  other areas' columns, and the last area to finish deletes it.

## What it leaves out

| Left out | Owner, and why |
| --- | --- |
| `parties.last_bill_number` and its no-decrease trigger | **the orders and sales area**, in the pull request that deletes `bill_number_allocations` and rewrites the bill-number allocator (`tables-ordersales.md` §4, §5). The column has no writer until then, and its trigger's tests need the allocator. That pull request changes `parties`, so under rules §7 it starts after this one lands (or this one waits); whichever lands second rebuilds the starting migration (rules §2.4). |
| Folding `allergy_line_ticks` into the lines | not built: §8 item 5 (Task 4) keeps it a table |
| `party_tables`, `order_kitchen_notes` | unchanged (appendix §1.10, §1.13) |
| `bookings`' location index | slice 5 (A1301 S20, assumed landed) |

## Files

- Modify: `packages/db/src/schema/parties.ts` (:20-65), `packages/db/src/schema/venue-service/party-allergy.ts`
  (delete `partyAllergy` :9-22; re-point `partyAllergyGuests` :24-50),
  `packages/db/src/schema/venue-service/service-steps.ts:60-63`,
  `packages/db/src/schema/ticket-item-moves.ts:18-20`, `packages/bookings/src/schema/bookings.ts:50-53`,
  `packages/db/triggers/core.sql` (1a's hand-written trigger file: the two new triggers),
  `packages/db/src/trigger-refusals.ts` (`PARTY_ALLERGY_GUEST_ANSWER_REFUSAL`),
  `packages/db/src/index.ts`, `packages/venue-service/src/index.ts:37` (re-exports `partyAllergy`),
  `packages/db/src/classification.ts:357`,
  `packages/venue-service/src/classification.ts:39`, `scripts/schema-constraints.test.ts`,
  `scripts/behavioural-triggers.test.ts`.
- Modify (writers and readers): `packages/venue-service/src/party-allergy.ts` (`readPartyAllergy`
  :48-87, `savePartyAllergy` :89-107, `writePartyAllergy` :109-169, `mergePartyAllergies` :308-340,
  `splitPartyAllergies` :342-355, `moveBillAllergies` :400-425), `apps/server/src/testing/kitchen-allergy-fixture.ts:249`.
- Modify (fixtures): `packages/db/src/testing/seed.ts` (`clearPartyAllergyForTest`; `seedPerson`
  comes from fk2), and the test fixtures Task 5 lists.
- Create: `packages/venue-service/src/party-allergy-answer.test.ts`,
  `scripts/floor-kitchen-triggers.test.ts`, `apps/server/src/allergy-tick-settled.test.ts`.
- Generated (uncounted): core's and bookings' starting migrations and the epoch file.
- Docs: `docs/backlog/architecture.md` (the person-ids entry).

## Size

| Part | Counted lines |
| --- | --- |
| Schema, triggers, refusal constant, lists | 70 |
| `party-allergy.ts` (answer reads and writes, merge, split, move) | 70 |
| Activity kind and writer call | 15 |
| `clearPartyAllergyForTest` | 15 |
| New tests (schema, triggers with accepting controls, answer history, §8.4, §8.5) | 230 |
| Fixture edits: tests that invent person ids now seed the person (Task 5) | 170 |
| Docs and backlog | 10 |
| Snapshot and list assertions (the table below) | 30 |
| **Total** | **≈ 610** |

Uncounted: deletions and generated files. No fixture script: no test inserts into `party_allergy`.

## Finish line

```bash
pnpm --filter @waitron/venue-service exec vitest run src/party-allergy.test.ts \
  src/party-allergy-answer.test.ts src/kitchen-allergy.test.ts src/service-step-completions.test.ts \
  src/classification.test.ts src/schema
pnpm --filter @waitron/db exec vitest run src/schema
pnpm --filter @waitron/bookings exec vitest run
pnpm --filter @waitron/server exec vitest run src/party-allergy*.test.ts src/floor-allergy.test.ts \
  src/kitchen-allergy*.test.ts src/allergy-tick-settled.test.ts src/parties*.test.ts \
  src/station-move.test.ts src/till-api.station-move.test.ts src/service-step*.test.ts \
  src/till-api.test.ts src/working-order.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/behavioural-triggers.test.ts \
  scripts/floor-kitchen-triggers.test.ts scripts/classification-complete.test.ts \
  scripts/starting-migrations.test.ts scripts/append-only-triggers.test.ts
```

Because the person keys reach every suite that writes a party, a step completion, a station move or
a booking, run `apps/server`'s whole suite once locally before pushing (CLAUDE.md §2 allows a broad
run when chasing a value many suites write): `pnpm --filter @waitron/server test:coverage`, checking
memory headroom first.

## Expected protection-list difference

Under all six venue headers unless marked; `bookings` lines appear under each header too, since both
compositions include the bookings set.

| Table | Lines |
| --- | --- |
| `party_allergy` (§5: PK/FK "implicit"; answer CHECK moves) | `missing table party_allergy`; `missing index party_allergy.primary key(party_id)`; change-feed only: three `missing trigger waitron_change_party_allergy_*` |
| `parties` | `extra table parties.columns[allergy_answer]`, `[allergy_answered_by]`, `[allergy_answered_at]`; `changed table parties.columnOrder`; `extra table parties.checks[parties_allergy_answer_ck]`, `[parties_allergy_answered_ck]`; `extra table parties.foreignKeys[allergy_answered_by->persons(id)]`, `[opened_by->persons(id)]`, `[closed_by->persons(id)]`; change-feed only: `changed trigger waitron_change_parties_update.when` |
| `party_allergy_guests` (§5: "FK → `parties` (cascade), plus trigger") | `missing table party_allergy_guests.foreignKeys[party_id->party_allergy(party_id)]`; `extra table party_allergy_guests.foreignKeys[party_id->parties(id)]`; `extra trigger party_allergy_guests_need_answer_insert`; `extra trigger party_allergy_guests_need_answer_update` |
| `service_step_completions` | `extra table service_step_completions.foreignKeys[done_by->persons(id)]` |
| `ticket_item_moves` | `extra table ticket_item_moves.foreignKeys[moved_by_person_id->persons(id)]` |
| `bookings` | `extra table bookings.foreignKeys[created_by->persons(id)]` |

The two `party_allergy_guests_need_answer_*` triggers are in core's starting migration, so they
appear under the `sql-only` headers as well as the others.

## Stop points (beyond rules §5)

1. §8.5 (Task 4) prints its failing result: the settled line's update is **not** refused. Then the
   tick could fold into the lines (appendix §8.5); stop and tell the watcher; do not fold it here.
2. §8.4 (Task 4) finds a trigger naming an area table other than the two added here: stop and list
   it.
3. A product path is found that deletes a `persons` row (searched 2026-11-08: `git grep -n -E
   "delete\(persons\)|delete from persons" -- apps packages ':!*.test.ts'` finds none); the new keys
   would refuse it.
4. A test needs a person whose id it cannot seed (an id the test asserts is unknown): stop.

## Needs

- fk2 (`seedPerson`, which Task 5 uses), and fk3–fk5 (the §8.4 test names the tables they create,
  `table_merges` among them); fk1 and fk0 by lane order.
- Batch 1: 1a (`packages/db/triggers/core.sql`, the rebuild command for `core` and `bookings`), 2
  (`activity_log`), 5 (`bookings` without `location_id`).
- Outside: the orders area's bill-counter pull request waits for this one (rules §7).

## Assumptions about batch 1

- B2 as in [fk2](2026-11-08-a1308-fk2-todays-choices.md#assumptions-about-batch-1); `activity_log.person_id`
  has a key to `persons`, so a test writing an answer under an invented operator id fails until the
  person is seeded (Task 5 handles it).
- Slice 2 seeds persons inline in its own tests and adds no shared helper; fk2 adds `seedPerson` to
  `@waitron/db`'s test seeds, and this plan uses it.
- B1, B3, B4 as in [fk1](2026-11-08-a1308-fk1-zone-service-rules.md#assumptions-about-batch-1).

## In-flight work folded in

- A1403 (unpaid kitchen stop) closes parties through `closeParty` and changes no table; it rebases.
- A1378 (kitchen paper) changes no table.

## Assertions that change, by design

| Where | Change | Design |
| --- | --- | --- |
| `apps/server/src/party-allergy.release.test.ts:90` (`frozen()`, a snapshot of every table) and `:161` (the tables a save writes) | `party_allergy` leaves the written set and `activity_log` joins it (an answer now writes one history row) | §1.9, §3 |
| the other whole-database snapshot tests around allergy writes: `party-allergy.submit.test.ts`, `party-allergy.adoption.test.ts`, `till-api.allergy-move.test.ts` (each reads `sqlite_master`), and any other `git grep -l "sqlite_master" -- 'apps/server/src/*.test.ts'` lists whose snapshot spans an allergy answer (about eleven at `a086eedfb7`) | the same two changes, only where an answer is written | §1.9, §3 |
| `apps/server/src/party-table-actions.test.ts:2704`, `:3114` | `"party_allergy"` → `"parties"` in the lists of tables a step writes (de-duplicated) | §1.9 |
| `packages/venue-service/src/party-allergy.test.ts:312-316` | the table-existence check no longer lists `party_allergy` | §4 |
| `packages/bookings/src/migrations.test.ts:44-55` | the key list gains `{ from: "created_by", table: "persons", to: "id", onDelete: "RESTRICT" }`; the count in the case's name follows | §1.22, README U11 |
| the eight raw `delete from party_allergy` set-ups (Task 2 Step 3) | become `clearPartyAllergyForTest`; set-up, not assertion | §1.11 |

## Global constraints

- Rules §1–§9. `activity_log` rows carry a count, never a guest's words (README U11).
- The trigger refusal's text is declared once, in `trigger-refusals.ts`, and the SQL spells it out
  (the file's own rule, :1-11).

## Review Focus

1. **Merging two parties where one was never asked** clears both answers and deletes both parties'
   guests (and, by their key, their ticks), as the old cascade did. Test: Task 2's merge case.
2. **A guest inserted before its party's answer** is refused; writing the answer first, then the
   guests, in one transaction succeeds (`writePartyAllergy`'s order). Test: Task 1 and the existing
   save cases.
3. **Moving a guest to another party** (`update … set party_id`) is refused when that party has no
   answer: the `_update` trigger. Test: Task 1.
4. **A history row on every answer save, including "no allergies"**, and none on merge, split or a
   bill moving (those are not a person answering). Test: Task 2.
5. **A party opened by a person who is later suspended** keeps its key (suspension never deletes).
   Test: none needed beyond stop point 3; say so in the pull request.

---

## Task 0: Base protection list

- [ ] As fk1 Task 0; keep `<A>`.

## Task 1: Schema and the guest triggers

**Interfaces (produced):** `parties.allergyAnswer: "none" | "allergies" | null`,
`allergyAnsweredBy: string | null`, `allergyAnsweredAt: string | null`;
`PARTY_ALLERGY_GUEST_ANSWER_REFUSAL = "an allergic guest needs the party's answer first"`.

- [ ] **Step 1: Write the failing tests.** `packages/db/src/schema/parties.test.ts`: `refuses an
  unknown answer` (`parties_allergy_answer_ck`); `refuses an answer with no person`
  (`parties_allergy_answered_ck`); `refuses an answer by a person who does not exist`
  (`FOREIGN KEY constraint failed`); `stores an answer with its person and time` (succeeds);
  `refuses a party opened by a person who does not exist`. In `scripts/behavioural-triggers.test.ts`,
  two cases with accepting controls (the file's rule, :47-52): `party_allergy_guests_need_answer_insert`
  refuses a guest of an unanswered party with `PARTY_ALLERGY_GUEST_ANSWER_REFUSAL`, and accepts it
  once the party's answer is set; `party_allergy_guests_need_answer_update` refuses moving a guest to
  an unanswered party, and accepts moving it to an answered one.
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** The three columns and two CHECKs on `parties` (enum via `enumType`;
  "all set or all null" as fk2's `kept_open` CHECK); `foreignKey`s to `persons.id` with
  `.onDelete("restrict")` on `opened_by`, `closed_by`, `allergy_answered_by`; delete the "no key
  yet" comment at `parties.ts:24`. `party_allergy_guests_party_fk` names `parties.id`, cascade kept.
  In `core.sql`:

  ```sql
  CREATE TRIGGER party_allergy_guests_need_answer_insert
  BEFORE INSERT ON party_allergy_guests
  WHEN (SELECT allergy_answer FROM parties WHERE id = NEW.party_id) IS NULL
  BEGIN SELECT RAISE(ABORT, 'an allergic guest needs the party''s answer first'); END;
  CREATE TRIGGER party_allergy_guests_need_answer_update
  BEFORE UPDATE OF party_id ON party_allergy_guests
  WHEN (SELECT allergy_answer FROM parties WHERE id = NEW.party_id) IS NULL
  BEGIN SELECT RAISE(ABORT, 'an allergic guest needs the party''s answer first'); END;
  ```

  Person keys: `service_step_completions.done_by`, `ticket_item_moves.moved_by_person_id` (nullable;
  the actor CHECK stays) and `bookings.created_by`, each `restrict`, deleting their "No key yet"
  comments. Delete `partyAllergy`, its export and both classification entries; update
  `schema-constraints.test.ts` (it has no `party_allergy_guests` row today: add
  `["party_allergy_guests", ["party_id"], "parties"]`, and the six person rows).
- [ ] **Step 4: Rebuild** `core` and `bookings`; run Step 2's files; expect pass. **Commit.**

## Task 2: The answer on the party, and its history

**Interfaces:** `readPartyAllergy(tx, partyId)` keeps its answer shape; `writePartyAllergy(tx,
partyId, input, operatorId)` and `savePartyAllergy` keep their signatures. Activity: declare
`"party.allergy_answered"` in slice 2's `packages/db/src/activity-kinds.ts` with `{ subject: "party"
}` and data `{ answer: "none" | "allergies"; guestCount: number }` (its comment: "a count only; never a
guest's label or allergens", slice 2's per-kind rule 4); write it with `recordActivity(tx, { kind:
"party.allergy_answered", subjectId: partyId, personId: operatorId, data: { answer, guestCount } })`,
`guestCount` the number of guests saved.

- [ ] **Step 1: Write the failing tests** in `packages/venue-service/src/party-allergy-answer.test.ts`:
  - `an answer is written on the party with its person and one history row` — after
    `writePartyAllergy(tx, p, { answer: "allergies", guests: [g1, g2] }, person)`: the party's three
    columns are set; one `activity_log` row with `kind = 'party.allergy_answered'` and `data =
    { answer: "allergies", guestCount: 2 }`; the row's `data` holds no key other than those two.
  - `"no allergies" is an answer too` — `{ answer: "none", guests: [] }` writes a row with
    `guestCount: 0`.
  - `merging a party never asked clears both answers and both parties' guests` — party A answered
    with one guest and one tick, party B never asked; `mergePartyAllergies(tx, A, B, person)`: both
    parties' three columns null, no guest and no tick left for either, and **no** history row.
  - `splitting and moving a bill copy the answer without a history row`.
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** Every `insert(partyAllergy)…onConflictDoUpdate` becomes
  `update(parties).set({ allergyAnswer, allergyAnsweredBy: operatorId, allergyAnsweredAt: nowIso()
  }).where(eq(parties.id, …))`; `readPartyAllergy` reads the three columns from the party row it
  already selects (:52-55); `mergePartyAllergies` (:308-340): for a null result, delete the guests
  of both parties (`delete(partyAllergyGuests).where(inArray(partyAllergyGuests.partyId, [from,
  into]))`) and then clear both parties' columns; otherwise set `into`'s answer **before** moving
  `from`'s guests (the `_update` trigger needs it), then clear `from`'s columns.
  `writePartyAllergy` writes the history row after its guest writes. No test inserts into `party_allergy` (`git grep -l "insert(partyAllergy)" -- '*.test.ts'
  '*/testing/*'` finds none on 2026-11-08), so no fixture script is needed. Eight raw statements
  make a party unanswered with `delete from party_allergy where party_id = …`, which also deleted
  that party's guests through the old key (`device-levers.test.ts:353`,
  `finish-party-collect.test.ts:418`, `kitchen-request.release.test.ts:391`,
  `kitchen-request.tab-send.test.ts:136`, `party-allergy.moves.test.ts:176`,
  `party-allergy.release.test.ts:72, 370, 422`, all in `apps/server/src/`): each becomes a call to a
  new helper, `clearPartyAllergyForTest(db, partyId)` in `packages/db/src/testing/seed.ts`, which
  deletes the party's guests and then clears its three columns.
- [ ] **Step 4:** Make the changes "Assertions that change, by design" lists for this task.
- [ ] **Step 5: Run** the Finish-line venue-service and server commands; expect pass. **Commit.**

## Task 3: Live queries and the Madrid baseline

- [ ] Drop `party_allergy` from any live-query list that names it, keeping `parties`. Madrid baseline:
  fold `party_allergy` into `parties` (match `party_id` → `id`; `answer` → `allergy_answer`,
  `changed_by` → `allergy_answered_by`, `changed_at` → `allergy_answered_at`). **Commit.**

## Task 4: The two measurements

**Run Step 1 (§8.5) first, straight after Task 0:** it needs nothing this plan builds, and its
failing result would change the plan. Step 2 (§8.4) needs Task 1's triggers.

- [ ] **Step 1: §8.5, the allergy tick stays a table.** `apps/server/src/allergy-tick-settled.test.ts`,
  on a real venue (`useVenueDb`, the party fixtures in `apps/server/src/testing/party-venue.ts`):
  seat a party, answer "allergies" with one guest, send a dish line, settle that bill while the
  party stays open. Then:
  - `ticking a guest on a settled bill's line succeeds` — `setAllergyLineTicks`
    (`packages/venue-service/src/party-allergy.ts:169-279`) for that line answers without error and
    the tick row exists.
  - `a settled bill's line refuses any change but what was served` — an
    `update working_order_lines set kitchen_name = kitchen_name || ' '` on that line is refused with
    `OPEN_PARENT_REFUSAL` (`packages/db/src/trigger-refusals.ts`), the trigger a tick column on the
    line would meet.
  **Failing result named in advance:** the second update is accepted. The design's answer is that
  the tick can then fold into the line (appendix §8.5); stop point 1.
- [ ] **Step 2: §8.4, no unexpected trigger names this area's tables.**
  `scripts/floor-kitchen-triggers.test.ts` (root project): migrate a database through
  `applyMigrations` with every set (as `scripts/behavioural-triggers.test.ts` does) and install the
  change feed; list `sqlite_master` triggers whose `sql` names any of the area's tables as a whole
  word (`floor_zones`, `floor_plan_tables`, `dining_tables`, `floor_reset_tables`,
  `floor_plan_sets`, `floor_plans`, `floor_plan_placements`, `table_merges`, `parties`,
  `party_tables`, `party_allergy_guests`, `allergy_line_ticks`, `bookings`, `order_kitchen_notes`,
  `service_steps`, `service_step_completions`, `kitchen_stations`, `kitchen_courses`,
  `ticket_items`, `ticket_item_moves`, `kitchen_print_jobs`, `kitchen_print_job_lines`,
  `kitchen_notices`, `routing_cells`, `routing_cell_periods`), leaving out **every** trigger
  whose name starts `waitron_change_` (the change feed's; bookings' feed triggers also name
  `dining_tables` in their body, so excluding only a table's own would report them). Assert the list equals
  `["party_allergy_guests_need_answer_insert", "party_allergy_guests_need_answer_update"]`.
  **Failing result named in advance:** any other name (stop point 2). When the orders area adds
  `parties`' no-decrease trigger, it adds that name here.
- [ ] **Step 3: Run both**; record the output in the pull request. **Commit.**

## Task 5: Person fixtures

**Interfaces (consumed):** `seedPerson(db, { id?, displayName? }): Promise<string>` from fk2
(`packages/db/src/testing/seed.ts`).

- [ ] **Step 1:** Run the Finish-line commands and `apps/server`'s suite; collect every
  `FOREIGN KEY constraint failed` whose cause is an invented person id (a constant such as
  `OPERATOR` in `apps/server/src/testing/party-venue.ts:58`, `cancel-line.ts:18`,
  `order-writer-fixture.ts:21`, `serve-line.ts:18`, `whole-payment-fixture.ts:23`, or a
  `randomUUID()` passed as `openedBy`, `doneBy`, `movedByPersonId`, `createdBy`).
- [ ] **Step 2:** Fix each at its narrowest shared point: where a helper owns the constant, the
  helper seeds the person once (`await seedPerson(tx, { id: OPERATOR })`) when it builds the venue;
  otherwise the test seeds it in its set-up. No assertion changes (rules §4; stop point 4).
- [ ] **Step 3: Run** again until green. **Commit.**

## Task 6: Backlog, protection list, finish

- [ ] Remove `parties.opened_by`, `parties.closed_by`, `service_step_completions.done_by`,
  `ticket_item_moves.moved_by_person_id` and `bookings.created_by` from the person-ids backlog entry
  (if the entry lists columns; otherwise add one line saying which area has keyed its columns).
- [ ] Protection list compare; paste and mark. Finish line; `/finish-branch`.

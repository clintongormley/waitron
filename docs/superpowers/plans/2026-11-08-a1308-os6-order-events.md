# A1308 orders and sales, PR 6: one history of a bill's dishes, rounds and drafts — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `order_portion_events`, `order_group_events` and `order_draft_events` with one typed,
append-only `order_events` table, and give attendance the time indexes it asks for on
`order_amendments` and `bill_payments`.

**Architecture:** Measure M6 and M7 on slice 0's year of trading first. One new table with a `kind`
whose prefix names its family (`dish.`, `group.`, `draft.`), one CHECK per family carrying today's
rules, and the four indexes the design names. The three writers (`recordPortionEvents`,
`recordGroupEvent`, `recordDraftEvents`) keep their names and write `order_events`; the four readers
(attendance facts, attendance discovery, service-step signals, `takenOverFrom`) read it.

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest; slice 0's bench.

**Spec:** README §5 U3; [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md)
§1.3, §1.4, §1.6, §1.9, §1.23, §3, §4, §5 (the three event tables; "Gained: the time indexes"), §6
item 9, §8 M6 and M7; README §10 "Applied as the design" (`order_groups.last_joined_at` and
`order_drafts.taken_over_from` read from `order_events` if the measurement allows). Rules:
[slice rules](2026-11-08-a1308-slice-rules.md).

**Who lands:** the lane (no sale, invoice number or hash input; `order_amendments` keeps its chain and
its columns: only an index is added).

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

---

## What it builds

1. **M6 and M7** (Task 1), results in the PR.
2. `order_events`: `id` PK; `kind` (not null); `at` (not null); `actor_id` (key to `persons`);
   `actor_device_id` (key to `devices`); `party_id` (key to `parties`); `group_id` (key to
   `order_groups`); `draft_id` (key to `order_drafts`); `line_id`, `from_order_id`, `to_order_id` (plain
   ids: a cancelled dish's line is deleted and the event outlives it, §1.23; the order ids stay plain as
   `order_portion_events`' are today, `packages/db/src/schema/order-portion-events.ts` after os5);
   `from_person`, `to_person` (keys to `persons`); `detail` (JSON, not null, default `{}`; a dish event's
   `detail` holds the `cohortId` and `ordinal` os5 records). Core, `state`, append-only.
   - `order_events_kind_ck`: `kind in ('dish.moved','dish.cancelled','group.submitted','group.joined',
     'group.fired','group.reordered','group.lines_moved','group.removed','draft.created',
     'draft.taken_over','draft.submitted','draft.discarded')`.
   - `order_events_dish_ck`: a `dish.` row has `line_id` and `from_order_id`; `dish.moved` has a
     `to_order_id` different from `from_order_id`; `dish.cancelled` has none (today's
     `order_portion_events_destination_ck`).
   - `order_events_group_ck`: a `group.` row has `party_id` and exactly one of `actor_id`,
     `actor_device_id` (today's `order_group_events_actor_ck`). `group_id` stays null on a reorder.
   - `order_events_draft_ck`: a `draft.` row has `draft_id`, `actor_id` and `to_person`.
   - Indexes `order_events_actor_at_idx (actor_id, at)`, `order_events_party_idx`,
     `order_events_group_idx`, `order_events_draft_idx`; and `order_events_at_idx (at)` **only if M6
     fails**.
3. `order_amendments_event_at_idx (event_at)` and `bill_payments_created_at_idx (created_at)`
   (tables-ordersales.md §1.3, §1.9).
4. The three old tables deleted.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `refunds`' `created_at` index | os12 (the refunds table is made there) |
| Person keys on `order_amendments`, `order_groups`, `order_drafts`, `bill_payments` | os11 |
| The rest of attendance's redesign (`attendance_source_state`, the checker's tables) | people and working time |
| `order_draft_recalled_lines` | os7 |

## Files

- Create: `packages/db/src/schema/order-events.ts` (`orderEvents`, `ORDER_EVENT_KINDS`)
- Delete: `packages/db/src/schema/order-portion-events.ts` (os5 made it); the `orderGroupEvents`
  block of `packages/db/src/schema/order-groups.ts:88-129`; the `orderDraftEvents` block of
  `packages/db/src/schema/order-drafts.ts:119-145`
- Modify: `packages/db/src/schema/order-amendments.ts`, `packages/db/src/schema/bill-payments.ts`
  (one index each)
- Modify: `packages/db/src/index.ts`, `packages/db/src/classification.ts` (`:208`, `:233`, and the
  `order_portion_events` entry), `packages/migrations/migrations.manifest.json:25-26` (and the
  `order_portion_events` line)
- Modify (writers): `apps/server/src/order-portions.ts` (`recordPortionEvents`),
  `apps/server/src/order-groups.ts:2790-2800` (`recordGroupEvent`) and its callers' `kind` literals,
  `apps/server/src/order-drafts.ts:1571-1590` (`recordDraftEvents`) and its callers' `kind` literals
- Modify (readers): `apps/server/src/attendance-facts.ts:22-30`, `apps/server/src/attendance-discovery.ts:113`
  (`RowSource` gains `where?: SQL`), `:129-141` (the two source entries), `:393` (the scan query) and
  `:408` (`watchedRow`'s query), both of which apply `source.where`; `apps/server/src/testing/adjustment-venue.ts:695-790`
  (`todayLine` reads dish events from `order_events`);
  `apps/server/src/service-step-signals.ts:125-150`, `apps/server/src/order-drafts.ts:1879-1902`
- Modify (tests): the 20 test files naming `orderGroupEvents`, the 16 naming `orderDraftEvents`, the 4
  naming `orderPortionEvents` (`git grep -l`), and those naming the snake-case tables in SQL
  (`bill-editing.table-actions.test.ts`, `party-arriving-dishes.test.ts`, `party-table-actions.test.ts`,
  `service-step-signals.test.ts`, `till-api.table-actions.test.ts`, `management-api.station-disable.test.ts`,
  `station-delete.test.ts`, `move-dishes.test.ts`, `order-portions.filing.test.ts`,
  `order-portions.lifecycle.test.ts`); `packages/db/src/schema/order-groups.test.ts`,
  `order-drafts.test.ts`; `apps/server/src/personal-data-actions.coverage.test.ts:55-62`;
  `scripts/append-only-triggers.test.ts:59-60` and the `order_portion_events` line;
  `scripts/schema-constraints.test.ts`; Madrid lists (`REMOVED_TABLES` gains `order_group_events`,
  `order_draft_events`; `ADDED_TABLES` loses `order_portion_events`, gains `order_events`)

## Size

| | Counted | Not counted |
| --- | --- | --- |
| Code | schema 70, writers 40, readers 50, kind literals 30 | deleted schema blocks (about 90); generated files |
| Tests | new CHECK cases 100; re-pointed event reads in about 40 files 300 | M6/M7 scratch timing script (not committed) |

About 650 counted lines (the attendance scan filter and `todayLine` included); about 3 hours. If re-pointing passes 400 test lines, the kind renames go
through `scripts/a1308/os6-order-event-kinds.mjs` (idempotent; rewrites `orderGroupEvents.kind, "x"` and
`kind: "x"` beside `orderGroupEvents`/`orderDraftEvents`/`orderPortionEvents` to the prefixed kind and
the table identifier to `orderEvents`); its output is uncounted (rules §1).

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/order-events.test.ts src/schema/order-groups.test.ts src/schema/order-drafts.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/attendance-facts.test.ts src/attendance-discovery.test.ts src/service-step-signals.test.ts src/order-drafts.test.ts src/till-api.drafts.test.ts src/party-arriving-dishes.test.ts src/party-table-actions.test.ts src/till-api.table-actions.test.ts src/move-dishes.test.ts src/order-portions.lifecycle.test.ts src/station-delete.test.ts src/personal-data-actions.coverage.test.ts --reporter=dot
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts --reporter=dot
```

## Expected protection-list difference

| Table | Line | Phases |
| --- | --- | --- |
| `order_portion_events` | `missing table order_portion_events`; `missing index order_portion_events.primary key(id)` | all |
| `order_group_events` | `missing table order_group_events`; `missing index order_group_events.primary key(id)`; `missing index order_group_events_party_idx`; `missing index order_group_events_group_idx` | all |
| `order_draft_events` | `missing table order_draft_events`; `missing index order_draft_events.primary key(id)`; `missing index order_draft_events_draft_idx` | all |
| the three | `missing trigger <t>_append_only_update`, `<t>_append_only_delete` for each | migrated, change-feed |
| the three | `missing trigger waitron_change_<t>_insert`, `_update`, `_delete` for each | change-feed |
| `order_events` | `extra table order_events`; `extra index order_events.primary key(id)`; `extra index order_events_actor_at_idx`, `order_events_party_idx`, `order_events_group_idx`, `order_events_draft_idx` (and `order_events_at_idx` if M6 fails) | all |
| `order_events` | `extra trigger order_events_append_only_update`, `order_events_append_only_delete` | migrated, change-feed |
| `order_events` | `extra trigger waitron_change_order_events_insert`, `_update`, `_delete` | change-feed |
| `order_amendments` | `extra index order_amendments_event_at_idx` | all |
| `bill_payments` | `extra index bill_payments_created_at_idx` | all |

Where the protections went (§5): append-only kept on `order_events`; the group events' keys to party,
group and device, the draft events' key to the draft, and their party, group and draft indexes kept;
the kind, actor and destination CHECKs become the per-family CHECKs; the portion key was already a plain
`line_id` (os5). Gained: person keys (U11) and `(actor_id, at)`.

## Stop points (beyond rules §5)

- M6 or M7 gives its failing result (Task 1).
- Slice 0's bench has not landed when Task 1 starts: stop for the watcher; do not build an ad hoc bench.
  The fallbacks in Task 1 are taken only on a measured failure, never in place of a measurement.
- Attendance's keys change: a `draft` fact's key stays `'event:' || id` and a `group` fact's
  `'group:' || id` (`attendance-facts.ts:22, :27`; `attendance-discovery.ts:133, :140`), because
  `attendance_operation_facts` matches on them. A plan that needs another key is a stop.

## Needs

- **In this area:** os5 (dish events name a line).
- **Outside:** slice 0's year-of-trading bench (Tasks 5–6 of its plan) for M6 and M7. If people and
  working time has a PR in flight that edits `attendance-facts.ts` or `attendance-discovery.ts`, the
  later one rebases; neither changes the other's tables.

---

## Global Constraints

- Rules §1–§9. `order_events` is a history product code reads back (attendance, the till's
  previous draft owner, service-step times); it is not `activity_log` (README §3, R2).
- `takenOverFrom` takes the latest take-over by `rowid`, not by time (`order-drafts.ts:1871-1877`
  explains why); `order_events` is a rowid table and keeps that order.

## Review Focus

1. **A clock stepped back.** `takenOverFrom` must still pick the last row written. Test: Task 3's
   "the latest take-over is the last written, whatever its time".
2. **A party merged into another.** Group events keep the old party id; service-step signals read the
   family (`service-step-signals.ts:125-163`). Test: the existing merged-party case, re-pointed.
3. **A kitchen display fires a group** (`actor_device_id`, no person). Test: Task 2's group CHECK
   control.
4. **The attendance key prefixes** stay. Test: an existing attendance discovery case that asserts a
   key, re-pointed, unchanged.
5. **A reorder names no group.** Test: Task 2's "a reorder with no group is accepted".

---

### Task 1: M6 and M7 on a year of trading

**Files:** none committed; a scratch script under the bench's folder, results in the PR.

- [ ] **Step 1: Build the year** (if slice 0's bench has not landed, stop: Stop points) with slice 0's
  `bench build` on the base commit (or reuse one built on
  the base), and again on the branch after Task 3. Same machine, same seed (design U11).
- [ ] **Step 2: M6** (tables-ordersales.md §8 M6). Time `readAttendanceFacts(tx, day)`
  (`apps/server/src/attendance-facts.ts:9`) for one day near the end of the year, 50 samples × 3 rounds,
  on both builds. **Failing:** the branch's median is above the base's highest round median by over
  10% (`bench compare`'s `slower`). **Fallback** (§8 M6): replace the shared
  `julianday(r.at) >= julianday(…)` filter (`:44`) with per-source text comparisons
  (`e.at >= ${day.startAt} and e.at < ${day.endAt}`) and add `order_events_at_idx`; this is right only
  while every writer stores one spelling of time (CLAUDE.md §3, "A time stored as text …"), which
  holds for `order_events.at` (written by `nowIso`) — check `order_amendments.event_at` and
  `bill_payments.created_at` writers the same way before relying on their new indexes. The watcher
  confirms before the builder takes it.
- [ ] **Step 3: M7** (§8 M7). Time `readStepFacts`' order-times read (`service-step-signals.ts:75`)
  (`service-step-signals.ts:128-150`) for a party with four merged members, and `takenOverFrom` for a
  till's whole list of drafts, 200 samples × 3 rounds, both builds. **Failing:** either is `slower`.
  **Fallback:** that read gets its column (`order_groups.last_joined_at`, maintained when a group is
  submitted, joined or arrives, and checked against the events' result for merged parties, since events
  keep the old party id while groups move, `moveGroupsToParty`; or `order_drafts.taken_over_from`, key to
  `persons`). The watcher confirms first.
- [ ] **Step 4:** Paste both results, with the machine named, into the PR draft.

### Task 2: The table

**Files:** `packages/db/src/schema/order-events.ts`, `order-amendments.ts`, `bill-payments.ts`;
`packages/db/src/schema/order-events.test.ts` (create); `packages/db/src/classification.ts`;
`packages/migrations/migrations.manifest.json`.

- [ ] **Step 1: Write the failing tests** in `order-events.test.ts`: per family, one refused row for
  each rule of its CHECK (`"a dish move needs a different destination"`, `"a cancelled dish names no
  destination"`, `"a group event needs a party and exactly one actor"`, `"a draft event needs its draft,
  actor and new owner"`, `"refuses an unknown kind"`), each with its accepting control; `"a reorder with
  no group is accepted"`; `"refuses an actor who is not a person"` (fixtures create persons first);
  `"refuses any update or delete"` (append-only, after migration).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Classification: `appendOnly("order_events", "state", "what happened to a
  bill's dishes, rounds and drafts, and who did it; never corrected, copied to a standby, never drained
  back")`; manifest lists it. Rebuild core.
- [ ] **Step 4: Run; PASS. Commit** `feat(db): order_events, one history of a bill's dishes, rounds and drafts`.

### Task 3: Writers and readers

**Interfaces:** `recordPortionEvents(tx, lineIds, event)`, `recordGroupEvent(tx, values, attendance?)`,
`recordDraftEvents(tx, attendance, ...events)` keep their signatures; their `kind` parameter types
become the prefixed kinds (`"group.submitted"`, …). `ORDER_EVENT_KINDS` is exported from
`@waitron/db`.

- [ ] **Step 1: Re-point the tests** (assertions unchanged except the kind strings, which are the same
  facts under their prefixed names). **The kind strings that change, named in advance (rules §4):** every
  `kind` literal of a group, draft or dish event (`"submitted"`, `"joined"`, `"fired"`, `"reordered"`,
  `"lines_moved"`, `"removed"`, `"created"`, `"taken_over"`, `"discarded"`, `"moved"`, `"cancelled"`)
  compared with or written to an event row becomes its prefixed kind, in these test files (counts are lines
  with such literals near `kind`, `git grep` at `a086eedfb7`): `order-groups.test.ts` (19),
  `order-drafts.db.test.ts` (15), `waiting-course-copy.test.ts` (10), `order-groups.request-kind.test.ts` (9),
  `party-allergy.submit.test.ts` (8), `attendance-discovery.test.ts` (7), `till-api.groups.test.ts` (6),
  `service-step-signals.test.ts` (5), `kitchen-allergy.notices.test.ts` (4), `party-arriving-dishes.test.ts`,
  `order-kitchen-note.corrections.test.ts`, `kitchen-allergy.capture.test.ts`,
  `backup-recovery-pack-status.test.ts`, `attendance-facts.test.ts`, `attendance-draft-merge-routes.test.ts`
  (3 each), `party-table-actions.test.ts`, `party-allergy.test.ts`, `draft-discard.test.ts`,
  `collect-at-counter.test.ts`, `attendance-draft-events.test.ts` (2 each), and the four
  `order-portions.*`/`move-dishes` suites for the dish kinds. A literal that is a group's `state` or a
  request kind, not an event kind, stays. Any other changed assertion is a stop. Add in `order-drafts.test.ts`: `"the latest
  take-over is the last written, whatever its time"` (two take-overs, the second with an earlier `at`;
  the second's previous owner is returned).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Attendance: the two `union all` arms read `order_events` filtered by
  `kind like 'draft.%'` (joined to `order_drafts` as today) and `kind like 'group.%' and actor_id is not
  null`, keys `'event:' || e.id` and `'group:' || e.id`; same in `attendance-discovery.ts`'s two source
  entries (`table`: `order_events`, `where`: `e.kind like 'draft.%'` and `e.kind like 'group.%'`), and the
  scan (`:393`) and watch (`:408`) queries add `and ${source.where}` when a source has one, so a scan of the
  draft source never reads group rows and the reverse. Service-step signals:
  `kind in ('group.submitted','group.joined')` and `kind = 'group.lines_moved'` with `detail.arrived`.
  `takenOverFrom`: `kind = 'draft.taken_over'`, ordered by `order_events.rowid`.
- [ ] **Step 4: Run** the Finish line's server command; PASS. Then run Task 1 Steps 2–3 on the branch.
- [ ] **Step 5: Commit** `refactor(server): write and read order_events`.

### Task 4: Delete; registries; backlog; finish

- [ ] **Step 1:** Delete the three schema blocks, exports, classification and manifest entries; update
  `scripts/append-only-triggers.test.ts` (`EXPECTED` loses the three, gains `order_events`),
  `scripts/schema-constraints.test.ts`, the Madrid lists, and `personal-data-actions.coverage.test.ts`
  (`order_events.actor_id`, `.from_person`, `.to_person` replace the five event entries in `NOT_YET`).
- [ ] **Step 2: Backlog.** In `docs/backlog/architecture.md`'s bundle, remove the event tables from
  "Person-id columns … have no foreign key" if it names them (the entry stays until os11 and the other
  areas finish).
- [ ] **Step 3:** Rebuild core; Finish line; protection list.
- [ ] **Step 4:** Grep `docs/developers/` for the three table names; reword each sentence.
- [ ] **Step 5: Commit**, `/finish-branch`, PR with M6 and M7.

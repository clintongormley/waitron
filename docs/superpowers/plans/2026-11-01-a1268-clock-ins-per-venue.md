# A1268 — working time is per venue: one pull request (#2375, revised)

> **Revision 2 (2026-11-01).** Rewritten for the owner's per-venue decisions (design revision 2):
> no location on clock entries, sessions, corrections, confirmations or pay-period closures; both
> hashes lose the location; the export names the venue once. Revision 1's PR 2 is not built. The
> build is done inline by the lead session, test first, task by task.

**Goal:** Nothing in the working-time record names a location. One hash chain per node, one
pay-period closure per period for the venue, every reading per person at the venue.

**Architecture:** `time_entries` and `pay_period_closures` lose `location_id`; the keys that tie an
answer to its entry become (entry, person); `drizzle-kit` writes two migrations (a key, then the
rebuilds — "What the rehearsal found" says why two). The entry and closure hashes stop hashing a
location. Every reader that filters, groups or compares by an entry's location stops. The till
loses its other-location refusal and message. The export loses its workplace columns. What still
names a location after this pull request is listed in "What A1268 leaves to A1301".

**Tech Stack:** TypeScript, drizzle-orm 0.45 / drizzle-kit 0.31.11 on `node:sqlite`, Vitest 4.1.12,
Lit (till, dashboard).

**Spec:** [A1268 design, revision 2](../specs/2026-11-01-a1268-clock-ins-per-venue-design.md)
(D1–D8, §5).

**Branch:** `feat/a1268-clock-ins-per-venue`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a1268-clock-ins-per-venue`, PR #2375. Its
review thread (https://github.com/clintongormley/waitron/pull/2375#discussion_r4436001488) holds
the PR until this revision is built; the reply names both hash changes.

**Review:** plan revision 2 has had the writer's self-review only. A fresh-context plan review runs
before Task 0.

**Out of scope:** part 2 (design §4, pairing by write order after a backward clock step), with its
own plan later; everything in "What A1268 leaves to A1301".

## Global Constraints

- **No carry-forward code** (CLAUDE.md §3). A venue the migration refuses is reset.
- **Let `drizzle-kit` write the migration; never hand-edit SQL, a snapshot or `_journal.json`.**
  Task 3 resets `packages/workforce/drizzle` to main's and regenerates, as two generations.
- **Fiscal gates stay unedited and green:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`;
  `git diff --stat origin/main -- packages/fiscal-verifactu packages/fiscal` prints nothing.
- **Nothing new is built on locations** (lane B queue, owner ~14:55): no new `location_id` column,
  `locationId` parameter, per-location view, rule, setting, fixture or translation. Where a business
  day is needed, read the box's location the way the code reads it today (`readLocationClock` with
  the configured location).
- **Tests:** an assertion changes only where a design decision changes what it checks, and every
  such change is in "Test checks this plan changes". An assertion that must change and is not in
  the table gets a row naming its decision; if no decision covers it, STOP. Golden and fiscal tests
  are never edited.
- **Comments:** only an invariant or a non-obvious why. A comment that states the per-location
  shape is cut in the task that changes the code under it.
- **Commits:** `git commit -s`, explicit paths, never `git add -A`. Plain-English messages.
- **Local runs are for feedback:** focused files and the named package runs, never a
  whole-workspace run. Check `memory_pressure | grep free` before browser tests.
- **Shell is zsh:** quote globs; use `/usr/bin/grep` when an exit status decides anything; check
  each command's exit status.
- **Task size:** each task is planned for well under 100 tool calls. A task past about 150 calls
  stops at a passing or cleanly red point, commits, and writes a handover into the ledger (done,
  left, files, each check's state).

### Guard suites for the schema change

From the worktree root, each exit status checked:

```bash
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts \
  scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts \
  scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts \
  scripts/journal-monotonic.test.ts scripts/id-columns-are-references.test.ts \
  scripts/append-only-migration-sets.test.ts scripts/migration-upgrade.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
```

No error code is added, renamed or removed, so `scripts/alert-codes.test.ts` and
`scripts/errors-reachable.test.ts` are not in the set; if a task does change one, add both.

## Review Focus

1. **A venue that recorded a clock entry, migrated by this release.** Expected: the migration is
   refused (`FOREIGN KEY constraint failed` at `DROP TABLE`), nothing changes, the venue is reset.
   Task 3's migration test.
2. **A fresh venue, and a venue with no working-time rows.** Expected: both migrate, and the
   append-only triggers on `time_entries` and `pay_period_closures` are back after the set's
   trigger install. Task 3's migration test.
3. **A pay period closed on two nodes of one venue** (a promotion). Expected: the second close
   returns the first node's closure (one closure per period for the venue); each node's closures
   chain from 1. Task 3.
4. **A shift begun on one node and ended on another.** Expected: one session, paired, counted once
   in the hours, the end-of-day pass, the closure snapshot and the export; the till does not
   refuse the clock-out. Tasks 4, 7.
5. **A manager's proposal and its approval after the location leaves correction items.** Expected:
   the worker's prompt shows the place of the command that proposed it; approving writes the
   command row with that same place. Task 4, open question 1.

---

## What #2375 already holds, and what this revision does with it

At head `8eddd1a4f` (`git -C <worktree> log --oneline origin/main..HEAD`), based on `790214ba8`:

| Commit | What it did | Revision 2 |
|---|---|---|
| `c30f7f8913` Pass the clock entry's location with the entry, not only the chain key | `TimeEntryAppend.locationId` | **Replaced**: Task 3 removes the field. Not reverted as a commit (later commits build on it); the squash merge carries only the end state. |
| `e48677b286` Name backup verification's time and closure groupings separately | `chainScope` / `closureScope` | **Stands**; Task 3 makes `closureScope` the node alone. Its control "verifies closures at two locations of one node as two chains" is rewritten (table). |
| `c2f62f5fd5` Seed two workforce tests in ways that do not depend on the chain key | raw-insert seeding | **Stands.** |
| `82aaad15ab` One working-time chain per node… | `workforce_chains` by node, `ChainKey { nodeId }`, `readLatestLiveEntry`, migration `0012_workforce_chain_per_node` | **Stands, except its migration**: Task 3 deletes `0012_workforce_chain_per_node.sql`, its snapshot and journal entry, and regenerates. `chain-per-node-migration.test.ts` is replaced. |
| `0fee955ef8` Update the server's tests and the schema guard… | server fixtures, `schema-constraints` row | **Stands.** |
| `1861ebe4a9` The working-time export says why… positions can skip numbers | export note and its test | **Removed** in Task 6 (owner ~14:40: no note). |
| `e7009df544` docs: record that the working-time chain is now one per node | spec and 9b-plan pointers | **Rewritten** in Task 10 (its pointer says each entry keeps its `location_id`). |
| `bbe37e482d` Fold the per-task reviews… | adds `time_entries_location_chain_idx` and a query-plan test for it; migration-test checks; export note wording; conventions-data text | **Index removed** (Task 3); the query-plan test is **retargeted** (Task 7); the note goes (Task 6); the conventions-data text is rewritten (Task 10). |
| `5defc19e30` Fold the whole-branch review… | docs, two test tidies | Docs **rewritten** in Task 10; the test tidies stand. |
| `8eddd1a4f7` Drop a chain head's location column in two tests… | test tidy | **Stands** (the migration test it touches is replaced in Task 3). |

## What the survey and the rehearsal found (2026-11-01)

Commands ran in a throwaway worktree at main `0160250f67`
(`git worktree add --detach /tmp/a1268-rehearsal.cyj7/wt 0160250f67`, `pnpm install
--frozen-lockfile --prefer-offline`, removed afterwards with `git worktree remove --force`), on `node:sqlite`
through the repo's own store (`useVenueDb`, `runMigrations`, `installAppendOnlyTriggers`), never the
`sqlite3` command line.

- **The schema used.** Branch head's `workforce-chains.ts` (node key); `time-entries.ts` without
  `locationId`, `time_entries_location_fk` and `time_entries_location_chain_idx`, with
  `time_entries_response_subject_fk` on (responds_to_entry_id, person_id) → (id, person_id),
  the person-and-entry key on (id, person_id), `time_entries_person_chain_idx` on
  (person_id, node_id, sequence_no) and `time_entries_chain_position_uq` on (node_id, sequence_no);
  `pay-period-closures.ts` without `locationId`, `pay_period_closures_chain_position_uq` on
  (node_id, sequence_no) and `pay_period_closures_period_uq` on (period_start, period_end);
  `attendance.ts` with the open, automatic and resolution keys on (entry, person_id) →
  `time_entries(id, person_id)`.
- **One generation does not apply anywhere.** `pnpm db:generate --name working_time_per_venue`
  wrote one file that rebuilds, in this order, `attendance_questions`, `pay_period_closures`,
  `time_entries`, `workforce_chains`. Run on a database migrated in one go from empty, it failed:
  `foreign key mismatch - "__new_attendance_questions" referencing "time_entries"`. The new
  question keys name `time_entries(id, person_id)`, and when `attendance_questions` is rebuilt
  first, the old `time_entries` has no unique key on exactly those columns. It failed the same way
  on every seeded case, so a fresh setup could not have migrated.
- **Two generations apply.** First generation: main's schema plus one line,
  `uniqueIndex("time_entries_person_entry_uq").on(t.id, t.personId)`, generated as
  `0012_time_entries_person_entry_key` — one statement,
  ``CREATE UNIQUE INDEX `time_entries_person_entry_uq` ON `time_entries` (`id`,`person_id`);``.
  Second generation: the schema above, with the old (id, person_id, location_id) key dropped and
  `time_entries_person_entry_uq` kept, generated as `0013_working_time_per_venue` — 27 statements,
  rebuilding the same four tables in the same order, with no `ALTER TABLE … ADD` (the 0.31.x
  add-column-in-a-rebuild trap does not apply) and no expression index (the quoted-name trap does
  not apply). This is the one departure from "regenerate as one generation": a single generation
  cannot apply.
- **What the two generations do to data.** Each case: a database migrated to main's `0011`, rows
  written by raw insert, `removeChangeFeed`, then `runMigrations(db, WORKFORCE_MIGRATIONS)`, then
  `installAppendOnlyTriggers(db, ["time_entries", "pay_period_closures"])`. Vitest: `Tests 9 passed`.

  | Case | Migration | Rows after | Append-only triggers |
  |---|---|---|---|
  | Fresh database, every migration in one run | applied | — | 4 present |
  | Existing database, no working-time rows | applied | — | 0 after migrating, 4 after the install |
  | Two clock entries and their chain head | refused: `FOREIGN KEY constraint failed` | unchanged; `time_entries.location_id` still there | 4 (rolled back) |
  | A clock entry with no chain head (the app never writes this) | applied | kept | 0, then 4 |
  | Entries, a closure and a confirmation pointing at it | refused: `FOREIGN KEY constraint failed` | unchanged | 4 |
  | A closure no entry points at | applied | kept | 0, then 4 |
  | A missing-times question with a reminder email | refused: `FOREIGN KEY constraint failed` | unchanged | 4 |
  | A missing-times question, no email | applied | kept | 0, then 4 |
  | An automatic-out question pointing at two entries | refused: `FOREIGN KEY constraint failed` | unchanged | 4 |

  So foreign keys are enforced through the rebuild (the emitted `PRAGMA foreign_keys=OFF` does not
  take effect inside the migration's transaction, as CLAUDE.md §3 says): `DROP TABLE` of a table
  that a restrict or no-action child row points at is refused — `workforce_chains.last_entry_id`
  points at `time_entries`, `attendance_mail` and `attendance_response_commands` at
  `attendance_questions`, `time_entries.pay_period_closure_id` at `pay_period_closures`. Nothing
  cascades, so nothing is silently deleted: `grep -c -i cascade` on the generated `0013` printed
  `0`, and every key on these tables in `packages/workforce/src/schema/` is restrict or no action.
- **Triggers across the rebuild.** The rebuild drops the append-only triggers with the old tables;
  `applyMigrations` puts them back right after the set (`installAppendOnlyTriggers`,
  `packages/migrations/src/apply.ts:88-90`). Boot raises `append_only.triggers_restored` only for
  triggers missing BEFORE migrating (`missingBeforeMigration`, `apps/server/src/boot.ts:1018`,
  `apps/server/src/append-only-watch.ts:27-46`), and these were present then, so a successful
  migration raises no warning. That boot step was read, not run. The PR discloses the rebuild of
  two append-only tables (`time_entries`, `pay_period_closures`) anyway.
- **No other set's trigger names these tables.** `git grep -n -l -E
  'time_entries|pay_period_closures|attendance_questions|workforce_chains' -- '**/drizzle/*.sql'`
  outside `packages/workforce/` printed nothing, and no workforce migration creates a trigger.
- **`scripts/migration-upgrade.test.ts`** failed at the new step: `DROP TABLE attendance_questions`
  refused with `FOREIGN KEY constraint failed` (its synthetic rows fill every table). With this
  `RESETS` entry it passed (`Tests 4 passed`, 66 s):
  ```ts
  "workforce/0013_working_time_per_venue": {
    refused: ["DROP TABLE `attendance_questions`", "FOREIGN KEY constraint failed"],
  },
  ```
- **The other guards against those two generations:** `schema-constraints` failed one case,
  "carries every foreign key the product declares", on exactly two stale rows,
  `time_entries(location_id)->locations` and `workforce_chains(location_id)->locations`;
  `behavioural-triggers` (368), `two-file-foreign-keys`, `append-only-triggers` (86),
  `classification-complete`, `journal-monotonic`, `id-columns-are-references`,
  `append-only-migration-sets` and `migrations-match-schema` (20) passed. `Tests 1 failed | 527
  passed`.
- **The Madrid demo baseline** (`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`)
  failed both locales on `attendance_questions`' captured foreign keys: the `location_id` parts
  pointing at `time_entries` are gone. It compares tables one at a time, so it will also need the
  `time_entries`, `pay_period_closures` and `workforce_chains` shapes adjusted (the last is the
  branch's existing adjustment). The demo seed writes no clock rows (revision 1's survey).
- **Discovery's clock reads, as query plans on the new schema:** the page read
  (`… where node_id = ? and sequence_no > ? and sequence_no <= ? order by sequence_no limit ?`) is
  `SEARCH time_entries USING INDEX time_entries_chain_position_uq (node_id=? AND sequence_no>? AND
  sequence_no<?)`; the endpoint read as written today without its location
  (`select node_id, max(sequence_no) from time_entries group by node_id`) is `SCAN time_entries
  USING COVERING INDEX time_entries_chain_position_uq`, a walk of every entry on every pass; the
  same answer from the head table (`select node_id, sequence_no from workforce_chains`) is `SCAN
  workforce_chains`, one row per node. Task 7 reads the head table.
- **Who reads an entry's location today** (source files, branch head; `git grep -n -E
  'locationId|location_id'` over the working-time files, then read): the chain and hash
  (`chain.ts`, `chain-hash.ts`), the record reads (`record-reads.ts:20-79,149`), sessions
  (`projection.ts:19,34,119`, `record-period.ts:25,31`), the answer rule (`effective-entries.ts:17-19`),
  corrections (`corrections.ts:136,161,166,180,232`, the missing-entry input at :256-286), correction
  items (`attendance-responses.ts:94,132`), the attendance reads (`attendance-reads.ts:55,79,109,117,
  170,189`), question answers (`attendance-question-responses.ts:34,44,51`), answer commands
  (`attendance-response-commands.ts:191-194,231,246`), the end-of-day pass (`end-of-day.ts:160,253,
  255,306,348`), automatic entries (`automatic-entries.ts:49-55,71,88-96,136`), closures
  (`pay-period-close.ts:43,74-113,132,185`, `pay-period-reads.ts:9-18`, `pay-period-chain.ts:17,57,
  83,123,153`, `record-projection.ts:51,78,83,92-93,105`), hours (`hours-reads.ts:106-115,153`),
  planned versus actual (`clocking.ts:229,270`), backup verification (`backup-verification.ts:118,
  141,214`), the Spanish record (`packages/workforce-es/src/registro-jornada.ts:93,111,138`,
  `record-export.ts:30,97,149,252,336,345,369,372`), and in the server `till-clock-state.ts:49,63`,
  `till-clock-api.ts:152-157`, `attendance-discovery.ts:31,192,350`, `attendance-facts.ts:40-41`,
  `attendance-own-scope.ts:13-18`, `personal-data-time-record.ts:35`.
- **Apps that read the location off a working-time value.** In the throwaway, `locationId` was
  removed from `TimeEntryRecord`, `WorkSession`, `PayPeriodClosure`, `PayPeriodClosureView` and
  `CorrectionItem`, then `pnpm --filter @waitron/dashboard typecheck` and `--filter @waitron/till
  typecheck` were read for errors under each app: one production line,
  `apps/dashboard/src/screens/attendance-corrections-screen.ts:499` (`this.locationId =
  item.locationId`); the rest are test fixtures (dashboard `test/attendance-fixtures.ts`,
  `test/hours-fixtures.ts`, `test/manager-hours-fixtures.ts`, `src/api/attendance.test.ts`,
  `src/screens/attendance-corrections-screen.test.ts`; till `test/attendance-fixtures.ts`,
  `test/hours-fixtures.ts`, `src/api/client.attendance.test.ts`, `src/screens/till-hours-screen.test.ts`,
  `src/till-app.attendance*.test.ts`, `src/till-app.hours.test.ts`). The till's own clock state type
  (`apps/till/src/api/client.ts:148`) and `till-shell.ts:1103-1121` read `activeLocationId`.
- **Where a correction item's location is used.** `CorrectionItem.locationId` is the first
  request entry's (`attendance-responses.ts:132`). Two places need a place for an item: the
  worker's prompt for a manager's proposal takes its name and time zone from it
  (`attendance-reads.ts:117-130`), and an approve, decline, accept or disagree command writes it
  into `attendance_response_commands.location_id`, which is required
  (`attendance-response-commands.ts:191-194,274`). Every production request and proposal is
  written by an attendance command (`git grep -n -E 'requestCorrection|proposeCorrection' --
  'apps/**/*.ts' 'packages/**/*.ts' ':!*.test.ts'` prints only `clocking.ts`'s wrappers,
  `corrections.ts` and `apps/server/test/attendance-export-fixture.ts`), and that command's row
  holds a location. Open question 1.
- **Guides:** nothing to change. `grep -rn -i -E 'workplace|centro de trabajo|referencia del
  centro|chain position|posición en la cadena' apps/server/src/guide` printed nothing.
- **Developer docs** describing per-location working time: only the paragraph the branch already
  edited in `docs/developers/conventions-data.md` (the clock-step section) — `grep -rn -i -E
  '\(node, location\)|node and location|time_entries.*location|clock.*another location|other
  location' docs/developers/*.md CLAUDE.md README.md` printed one unrelated line
  (`offline-fiscal-restore.md:22`).

## Where this plan departs from the design

1. **Two generations** (above): the design says nothing about the migration's shape; the brief
   asked for one generation, which cannot apply.
2. **Discovery's clock endpoint reads the head table** (Task 7), so a pass does not walk every
   entry.

## Open questions (each has a default the build uses)

1. **Where does a correction item's place come from, now that the item has no location?** It is
   needed for the worker's proposal prompt (place name and time zone) and for the required
   `location_id` of an item's approve, decline, accept or disagree command row. Default: from the
   request or propose command whose `entryIds` include the item's first request — that command row
   keeps its own `location_id` until A1301 S22. An item no command wrote (only the test-facing
   `WorkforceBackend.requestCorrection`/`proposeCorrection` write one) gets no proposal prompt, and
   a command on it is refused `attendance.invalid` `location_missing`, as today's code does when it
   finds no location. Alternative for the watcher: drop the column's requirement in A1268.
2. **Who may read their own attendance at a location other than the box's?** Today: anyone with a
   clock entry or a question there (`attendance-own-scope.ts`). Default: anyone with a question
   there; the clock-entry evidence goes, because entries name no location.
3. **The hours, attendance and export routes keep their `locationId` parameter** to choose the
   business-day clock, the questions shown and the export's workplace name. Default: kept until
   A1301 S13–S15; no route reads it to filter entries or closures.
4. **The dashboard's correction screen keeps its selected location when a manager opens an item**
   (the line that copied the item's location goes). Default: as stated.

## What A1268 leaves to A1301

A1301 design §6, "How A1301 meets A1268". A1268 removes what reads or compares an entry's or a
closure's location; the rest is A1301's.

| Piece | A1268 | A1301 |
|---|---|---|
| `time_entries.location_id`, its foreign key, the append input's location, `LocationId` in the entry hash, `time_entries_location_chain_idx` | removes (Tasks 1, 3) | nothing |
| `time_entries_response_subject_fk`, the person-and-entry key, `sameSubject`'s location half | re-keys to (entry, person) (Tasks 3, 4) | nothing |
| The three `attendance_questions` keys to an entry | re-keys to (entry, person) (Task 3) | nothing |
| `pay_period_closures.location_id`, its keys, the closure hash's location, `closureScope` | removes (Tasks 2, 3) | nothing |
| Sessions, correction items, closure views, hours, end-of-day pairing by location | removes (Task 4) | nothing |
| The till's other-location refusal, `activeLocationId`, `clock.other_location` | removes (Tasks 7, 9) | nothing |
| The export's skip note and its "Workplace reference" column | removes (Task 6) | nothing |
| The export's workplace NAME, read from `locations` by the input's location | kept | S14 |
| `location_id` on `attendance_day_work`, `attendance_source_state`, `attendance_operation_facts`, `attendance_questions`, `attendance_response_commands`, and their keys among themselves | kept: the processing scope, compared with no entry | S22 |
| The `locationId` the hours, attendance, queue, day and export routes take, the clients that send it, the dashboard location picker | kept (open question 3) | S13, S15 |
| Business day from the box's location (`readLocationClock`) | kept | S13 |
| Rosters, shifts, templates, convenio, device admission | untouched | S12, S13, S20, S22 |

## Test checks this plan changes

"Fixture" rows change setup only; every other row changes an assertion and names its decision.
Rows marked *(read)* were found by reading and are confirmed by the task's run; a task that finds
another adds a row before editing.

| Task | Test file | Test | Old check | New check | Why |
|---|---|---|---|---|---|
| 1 | `packages/workforce/src/chain-hash.test.ts` | "hashes a missing device as an empty field" | canonical string includes `&LocationId=2222…` | the same string without that field | D1h |
| 1 | same | "changes the digest when %s changes" | row `["locationId", …]` | row deleted | D1h |
| 1 | same | `content()`, "hashes node_id and recorded_at…" | inputs carry `locationId` | without it | fixture |
| 2 | `packages/workforce/src/pay-period-chain.test.ts` | the hand-built closure hash (:1-41) | hashes `row.locationId` | does not | D6 |
| 2 | same | the mutation table (:57) | row `["location", { locationId: "different" }]` | row deleted | D6 |
| 2 | same | other cases (:130, :158) | rows carry `locationId` | without it (Task 3 drops the type field) | fixture |
| 3 | `packages/workforce/src/chain-per-node-migration.test.ts` | both cases | one-location node migrates in place; two-location node refused on `__new_workforce_chains.node_id` | file deleted; replaced by `working-time-per-venue-migration.test.ts` | D2 |
| 3 | `src/migrations.test.ts` | "rebuilds the multi-column keys on their remaining columns" | `time_entries_chain_position_uq` on (node, sequence) (branch) | also `time_entries_person_entry_uq` (id, person_id), `pay_period_closures_chain_position_uq` (node_id, sequence_no), `pay_period_closures_period_uq` (period_start, period_end) | D1, D6 |
| 3 | `src/index.test.ts` | "declares time_entries' seven foreign keys…" (:110-122) | includes `time_entries_location_fk` | without it; renamed "…six foreign keys…" *(read)* | D1 |
| 3 | `src/personal-data.coverage.test.ts` | the `time_entries` and `pay_period_closures` column lists | include `location_id` | without it *(read)* | D1, D6 |
| 3 | `src/backup-verification.test.ts` | "verifies closures at two locations of one node as two chains" (:268) | two locations' closures as two chains | "verifies a node's closures as one chain": two periods closed on one node chain 1, 2 | D6 |
| 3 | same | "checks retired-node closure history at another location" (:262) | closure at another location | the retired node's closures; location dropped from the name and fixture *(read)* | D6 |
| 3 | `src/pay-period-closure.test.ts` | "refuses a malformed closure read location %j" (:414) | refuses a bad location | deleted: the read takes no location | D6 |
| 3 | same | new "closes a period once for the venue" | — | new | D6 |
| 3 | `src/chain.test.ts` | "keeps one chain per node across locations" (:115) | second location continues at 2 | "keeps one chain per node": a second person's entry on the node continues at 2 | D1 |
| 3 | `scripts/schema-constraints.test.ts` | FK list | rows `time_entries(location_id)->locations`, `workforce_chains(location_id)->locations` | both deleted (the second may already be gone on the branch) | D1 |
| 3 | `scripts/migration-upgrade.test.ts` | `RESETS` | — | entry for `workforce/0013_working_time_per_venue` (receipt above) | D2 |
| 4 | `src/record-closures.test.ts` | "does not invent an amendment for unchanged or unrelated records" (:153) | `elsewhere` entries reuse ids at "other-venue" | own ids and times outside the session; same assertions (revision 1's plan review ran it: the reused ids collide once the location filter goes) | D6 |
| 4 | `src/automatic-entries.test.ts` | cases refusing an automatic close because the open entry or latest entry is at another location *(read)* | `attendance.not_pending` | deleted | D4 |
| 4 | `src/correction-lifecycle.test.ts` | "rechecks other locations before approving…" (:64), "accepts a separate-location missing session…" (:86) | second location in the fixture | without it; checks unchanged, names lose "location" | fixture |
| 4 | `src/attendance-reads.test.ts` | :274 "retains historical locations…", :312 manager queue "only the selected location", :364, :388, :443, :576 *(read)* | entries and items scoped by location | locations come from questions and commands only; the queue lists the venue's items; entries are the person's at the venue | D4, open question 1 |
| 4 | same | "keeps a worker request as history while a manager proposal is a prompt…" | prompt `locationId` from the item | the same value, now from the proposing command | open question 1 |
| 4 | `src/end-of-day.test.ts` | "excludes another person, another location and both sides of the business-day window" (:83) | another location's entries excluded | the other-location ENTRY part deleted; another location's FACT still excluded (facts keep their location) | D7 |
| 4 | `src/scheduling.test.ts` | "scopes to the queried location — another location's published shifts and entries do not leak in" (:948) | other location's entries excluded | the entries half deleted; shifts half unchanged | D4 |
| 4 | `src/hours-reads.test.ts` | "never leaks another person or location through own open/pending/history/closures" (:419) | other-location entries and closures hidden | the location half for entries and closures deleted; person half and question half unchanged | D4, D6 |
| 4 | `src/record-reads.test.ts` | "keeps split shifts and two locations scoped without another worker's entries" (:220) | per-location scoping | split shifts and other-worker scoping only | D4 |
| 5 | every workforce test the typecheck reports | — | literals carry `locationId` on entries, appends, clock inputs, sessions, items, closures | without it | fixture |
| 5 | `src/clocking-step.test.ts` | "reads the clock-in at another location written after a step" (:282), "reads the latest entry when the person moved location (control)" (:157) | locations A and B | one place; if a case then repeats another case's check, it is deleted (say which) | D1 |
| 6 | `packages/workforce-es/src/record-export.test.ts` | "explains that a chain position counts its node's entries at every location" (:480) | the note | deleted | D8 |
| 6 | same | cases reading the opening table, entries and closures columns *(read)* | `locationId` / "Workplace reference" columns | no such column; the opening table's first column is "Workplace" | D8 |
| 6 | `registro-jornada*.test.ts` | location fixtures and any cross-location case *(read)* | per location | without | D4 |
| 7 | `apps/server/src/till-clock-api.test.ts` | "refuses break and out writes on a shift at another location, while a matching-location shift succeeds" (:92) | 403 `attendance.not_permitted` | "lets break and out writes close a shift begun on another node": break-start, break-end, out all 200; state `out` | D3 |
| 7 | `src/till-clock-state.test.ts` | "keeps yesterday's open shift open and uses its active location" (:229) | `activeLocationId` | no such field; the shift stays open | D3 |
| 7 | same, `src/till-clock-step.test.ts:99` | `activeLocationId` in expected states | present | absent | D3 |
| 7 | `src/attendance-discovery.test.ts` | "reads a location's clock entries through an index on location, node and position" (:362) | plans use `time_entries_location_chain_idx` | "reads each node's clock entries by position": no `SCAN time_entries`; the page read uses `time_entries_chain_position_uq` | D7 |
| 7 | `src/personal-data-time-record.test.ts` | "builds no files for a person whose only entries are at another location" (:254) | no files | deleted: entries have no location | D4 |
| 7 | `src/management-hours-api.test.ts:392`, `src/till-attendance-api.test.ts:317`, `src/till-hours-api.test.ts:146`, `src/attendance-export-api.test.ts:224` | "historically recorded" workplace admitted by an entry there | admitted | admitted only by a question there *(read)* | open question 2 |
| 8 | every server test the typecheck reports, `apps/server/test/attendance-export-fixture.ts` | — | `locationId` on clock inputs, entries, closes | without | fixture |
| 8 | `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` | "preserves every Madrid seed row (en/es)" | captured shapes | adjustments: drop `location_id` and its keys from `time_entries`, `pay_period_closures`, `workforce_chains`; drop the `location_id` parts of `attendance_questions`' three keys to `time_entries` | D1, D6 |
| 9 | `apps/till/src/widgets/till-shell.test.ts` | "unknown or another-location clock state offers Retry or an explanation and disables clock writes (%s)" (:122) | `"another-venue"` case: disabled, `clock.other_location` | the `null` case stays; the other-location case deleted | D3 |
| 9 | till and dashboard fixtures the typecheck reports | — | `activeLocationId`, `locationId` on entries, sessions, items | without | fixture |

---

## Task 0: Rebase #2375 onto main

**Files:** none edited by hand except conflict resolution.

- [ ] **Step 1:** In the branch worktree: `git fetch origin && git rebase origin/main`. Expected
  conflicts are in docs only (`docs/superpowers/plans/2026-11-01-a1268-clock-ins-per-venue.md`,
  `docs/superpowers/specs/2026-11-01-a1268-clock-ins-per-venue-design.md`, `docs/backlog.md`,
  `docs/backlog/box.md`). For each, take main's file (`git checkout origin/main -- <path>`; Task 10
  redoes the branch's docs). A code conflict: STOP and report.
- [ ] **Step 2:** `pnpm install`, then
  `pnpm --filter @waitron/workforce exec vitest run src/chain.test.ts src/chain-per-node-migration.test.ts src/backup-verification.test.ts`.
  Expected: all pass (read the `Tests` count).
- [ ] **Step 3:** Write the ledger (`docs/handoffs/2026-11-01-a1268-per-venue.md`), naming this
  plan and Task 1 as next.

## Task 1: The entry hash leaves the location out (D1h)

**Files:** `packages/workforce/src/chain-hash.ts`, `chain.ts`, `backup-verification.ts`;
test `chain-hash.test.ts`, plus fixtures typecheck reports.

- [ ] **Step 1: Failing test.** In `chain-hash.test.ts`: remove `&LocationId=2222…` from the
  hand-written canonical string in "hashes a missing device as an empty field", delete the
  `locationId` row of "changes the digest when %s changes", and drop `locationId` from `content()`
  and the "hashes node_id and recorded_at…" base. Run
  `pnpm --filter @waitron/workforce exec vitest run src/chain-hash.test.ts`. Expected: FAIL on the
  canonical-string case (the digest still contains `LocationId=`).
- [ ] **Step 2:** Delete `locationId` from `EntryHashInput` and the `["LocationId", …]` row of
  `canonicalString`. Fix what `pnpm --filter @waitron/workforce typecheck` reports in `chain.ts`
  (the hash input; `readChain`'s select) and `backup-verification.ts` (the decoded entry, :118).
  The `time_entries.location_id` column is still written in this task.
- [ ] **Step 3:** `pnpm --filter @waitron/workforce typecheck`, then
  `pnpm --filter @waitron/workforce exec vitest run src/chain-hash.test.ts src/chain.test.ts src/backup-verification.test.ts src/record-migration.test.ts src/attendance-response-migration.test.ts src/restore-continuation.test.ts src/record-extension.test.ts`.
  Expected: exit 0; all pass.
- [ ] **Step 4: Deletion control:** put the `LocationId` row back → the canonical-string case fails.
  Revert.
- [ ] **Step 5: Commit** — "The working-time entry hash no longer includes a location".

## Task 2: The closure hash leaves the location out (D6)

**Files:** `packages/workforce/src/pay-period-chain.ts`; test `pay-period-chain.test.ts`.

- [ ] **Step 1: Failing test.** In `pay-period-chain.test.ts`, the hand-built hash (:1-41) stops
  hashing `row.locationId`, and the mutation table's `location` row (:57) is deleted. Run
  `pnpm --filter @waitron/workforce exec vitest run src/pay-period-chain.test.ts`. Expected: FAIL
  (`hash_mismatch` against the hand-built hash).
- [ ] **Step 2:** In `computeClosureHash` delete `row.locationId` (:123); in `verifyPayPeriodClosures`
  delete the `row.locationId !== previous.locationId` link check (:153); in `canonicalEntry` and
  `canonicalSession` delete `locationId` (:17, :57) and the session sort's location tie-break
  (:83). The types still carry the field until Task 3; only the hashed bytes change here.
- [ ] **Step 3:** `pnpm --filter @waitron/workforce exec vitest run src/pay-period-chain.test.ts src/pay-period-closure.test.ts src/record-closures.test.ts src/backup-verification.test.ts`.
  Expected: all pass.
- [ ] **Step 4: Deletion control:** put `row.locationId` back into the hashed array → the hand-built
  hash case fails. Revert.
- [ ] **Step 5: Commit** — "The pay-period closure hash no longer includes a location".

## Task 3: The schema, the migration and the chain layer (D1, D2, D6)

The column goes, so everything that names `timeEntries.locationId` or `payPeriodClosures.locationId`
in the chain layer changes here. This task ends with its own files green; the readers Task 4 lists
do not typecheck until Task 4 (cleanly red, stated in the ledger).

**Files:**
- Create: `packages/workforce/src/working-time-per-venue-migration.test.ts`; delete
  `chain-per-node-migration.test.ts`.
- Modify: `packages/workforce/src/schema/time-entries.ts`, `schema/pay-period-closures.ts`,
  `schema/attendance.ts` (the open, automatic and resolution keys only).
- Regenerate: `packages/workforce/drizzle/` (two generations).
- Modify: `chain.ts` (`TimeEntryAppend` and the insert lose the location), `record-reads.ts`
  (`recordFromRow`, `readRecordedEntries`' scope loses `locationId`), `projection.ts`
  (`TimeEntryRecord.locationId` deleted), `record-types.ts` (`PayPeriodClosure.locationId`,
  `PayPeriodClosureView.locationId` deleted), `pay-period-close.ts` (`closePayPeriod` and
  `readPayPeriodClosures` take no location; existing closures read by period; the node's previous
  closure by node alone; entries read for the venue; the closure marker writes no location),
  `pay-period-reads.ts` (`readClosures({ period })`), `backup-verification.ts` (`closureScope` is the
  node; no `location_id` decoded), `classification.ts` comment if it names a location.
- Tests: `migrations.test.ts`, `index.test.ts`, `personal-data.coverage.test.ts`,
  `backup-verification.test.ts`, `pay-period-closure.test.ts`, `chain.test.ts` (table rows for
  Task 3); `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `working-time-per-venue-migration.test.ts`, built on the truncated-journal pattern the branch's
    `chain-per-node-migration.test.ts` uses, with the folder holding main's `0000`–`0011`
    (`journal.entries.slice(0, 12)`) and `appendOnlyTables: ["time_entries", "pay_period_closures"]`.
    Rows by raw `insert`. Each case in its own `describe` with its own `useVenueDb`:
    (a) "migrates a venue with no working-time rows and keeps its append-only triggers": after
    `removeChangeFeed`, `runMigrations(db, WORKFORCE_MIGRATIONS)` and
    `installAppendOnlyTriggers(db, [...])`, `pragma table_info(time_entries)` and
    `(pay_period_closures)` name no `location_id`, no `__new_%` table is left, and the four
    append-only triggers exist; (b) "refuses a venue that recorded a clock entry and changes
    nothing": two entries and their head; `engineErrorMessage(error)` contains `FOREIGN KEY
    constraint failed`; both tables' rows and the `location_id` column are as before; (c) "refuses a
    venue holding an attendance question with a reminder email": a missing-times question and its
    `attendance_mail` row, no entries; refused the same way, rows unchanged. Then an
    `appendToChain(tx, { nodeId }, { personId, entryKind: "in", … })` after (a) gets
    `sequenceNo: 1` and `verifyChain(await readChain(db, { nodeId }))` is `{ ok: true }`.
  - `pay-period-closure.test.ts`, "closes a period once for the venue": `closePayPeriod` for
    January on `node`, then on a second node; the second returns the first's closure id, and
    `readPayPeriodClosures(tx, { period })` returns one row. Closing February on `node` gets
    `sequenceNo: 2`.
  Run `pnpm --filter @waitron/workforce exec vitest run src/working-time-per-venue-migration.test.ts src/pay-period-closure.test.ts`.
  Expected: FAIL (the migration does not exist yet; `closePayPeriod` still needs a location).
- [ ] **Step 2: Change the schema** to what "What the rehearsal found" lists: drop `locationId`,
  `time_entries_location_fk`, `time_entries_location_chain_idx` and
  `time_entries_subject_identity_uq`; add `time_entries_person_entry_uq` on (id, person_id);
  `time_entries_response_subject_fk` on (respondsToEntryId, personId) → (id, personId); drop the
  `locations` import. Closures: drop `locationId`, keys on (nodeId, sequenceNo) and
  (periodStart, periodEnd). `attendance.ts`: the open, automatic and resolution keys on
  (x, personId) → (timeEntries.id, timeEntries.personId). Rewrite the comments that name a location
  (`time-entries.ts` :53-54, :86, :93, :165-167 on the branch).
- [ ] **Step 3: Regenerate the migrations.** From `packages/workforce`:
  ```bash
  SAVE=$(mktemp -d)
  cp src/schema/time-entries.ts src/schema/pay-period-closures.ts src/schema/attendance.ts src/schema/workforce-chains.ts "$SAVE/"
  rm -rf drizzle && git checkout origin/main -- drizzle
  git checkout origin/main -- src/schema/time-entries.ts src/schema/pay-period-closures.ts src/schema/attendance.ts src/schema/workforce-chains.ts
  # add one line after time_entries_subject_identity_uq in src/schema/time-entries.ts:
  #   uniqueIndex("time_entries_person_entry_uq").on(t.id, t.personId),
  pnpm db:generate --name time_entries_person_entry_key
  cp "$SAVE"/*.ts src/schema/
  pnpm db:generate --name working_time_per_venue
  ```
  Expected: `drizzle/0012_time_entries_person_entry_key.sql` is the one `CREATE UNIQUE INDEX`;
  `/usr/bin/grep -o '__new_[a-z_]*' drizzle/0013_working_time_per_venue.sql | uniq` prints
  `__new_attendance_questions`, `__new_pay_period_closures`, `__new_time_entries`,
  `__new_workforce_chains` in that order; `/usr/bin/grep -c 'ALTER TABLE .* ADD' drizzle/0013_working_time_per_venue.sql` prints `0`.
  Any other shape: STOP and report. `git status` shows the branch's `0012_workforce_chain_per_node`
  files deleted.
- [ ] **Step 4: The chain layer.** Make the Files list's changes. `ChainKey` stays `{ nodeId }`.
  `closePayPeriod`'s input is `{ nodeId, period, clock, now, ruleset, origin }`; its replay and
  overlap check reads `readClosures(tx, { period })`; the automatic-entry eligibility compares
  person and end time only.
- [ ] **Step 5: Root guards.** Delete the two foreign-key rows in `scripts/schema-constraints.test.ts`
  (one may already be gone) and add the `RESETS` entry in `scripts/migration-upgrade.test.ts`
  exactly as the rehearsal section quotes it, with a one-line comment: "Rebuilds the working-time
  tables without a location; every venue that recorded working time needs a reset (A1268)."
- [ ] **Step 6: Run.**
  `pnpm --filter @waitron/workforce exec vitest run src/working-time-per-venue-migration.test.ts src/pay-period-closure.test.ts src/pay-period-chain.test.ts src/chain.test.ts src/chain.concurrency.test.ts src/backup-verification.test.ts src/migrations.test.ts src/index.test.ts src/personal-data.coverage.test.ts src/restore-continuation.test.ts src/record-migration.test.ts src/attendance-response-migration.test.ts`
  (expected: all pass, after the Task 3 table rows), then the guard suites (expected: all pass,
  `migration-upgrade` about a minute). `pnpm --filter @waitron/workforce typecheck` reports errors
  only in the files Task 4 lists and in test files (Task 5); record the list in the ledger.
- [ ] **Step 7: Deletion controls,** each reverted: remove the `RESETS` entry → `migration-upgrade`
  fails at the new step; make `closureScope` `[node_id, period_start]` → the "verifies a node's
  closures as one chain" case fails.
- [ ] **Step 8: Commit** — "Clock entries and pay-period closures no longer store a location".

## Task 4: The readers and the remaining types in the workforce package (D3, D4, D6, D7)

**Files** (source only; tests in the table's Task 4 rows):
`effective-entries.ts` (`sameSubject` is the person), `projection.ts` (`WorkSession.locationId`
deleted), `record-period.ts` (the key is the person), `record-projection.ts` (closure views: no
location filter or sort), `record-reads.ts` (`readTimeRecord`'s query is `{ period, personId? }`;
without a person it is the venue's record), `clocking.ts` (`ClockEventInput` loses `locationId`;
`getPlannedVsActual` reads the venue's entries, shifts still by location), `corrections.ts` (the
missing-entry input is `{ personId, missingEntryKind }`, no `assertLocationExists`; the
comparisons at :136, :161, :166, :180, :232 go), `automatic-entries.ts` (`AutomaticCloseInput`
loses `locationId`; :49-55's location checks go; reads by person; closures by period),
`end-of-day.ts` (subjects, `effective`, `intervals`, `breaks` and `canClose` lose the location;
facts and questions keep `day.locationId`), `attendance-contract.ts` (`CorrectionItem.locationId`
deleted), `attendance-responses.ts` (:94, :132), `attendance-reads.ts` (entry filters by person and
window; `ownLocations` from questions and commands; proposal prompt place from its command — open
question 1), `attendance-question-responses.ts` (:34, :44, :51), `attendance-response-commands.ts`
(the item's place from its command; :231 and :246 lose the location), `hours-reads.ts` (entries
and record by person; closures by period; items unfiltered by location; prompts still by the
question's location).

- [ ] **Step 1: Failing tests.** Make the Task 4 table rows' changes. Add
  `attendance-response-commands.test.ts` "approves a proposal and writes the command at its
  proposing command's place": propose (with `locationId`), then approve; the approve command row's
  `location_id` equals the propose row's. Run those files. Expected: FAIL on the new and flipped
  cases (and on typecheck, until Step 2).
- [ ] **Step 2: Implement** the Files list.
- [ ] **Step 3: Run** `pnpm --filter @waitron/workforce typecheck` (expected: errors only in test
  files, which Task 5 sweeps) and `pnpm --filter @waitron/workforce exec vitest run` (whole
  package). Expected: every case passes except ones failing only because a fixture still passes a
  location the code now ignores — none should fail at runtime for that reason; any that does, add
  a row or STOP.
- [ ] **Step 4: Deletion controls,** each reverted: put `a.locationId === b.locationId` back into
  `sameSubject` → a correction-lifecycle or attendance-reads case fails (name it in the ledger);
  take the place from the item instead of the command → the new approve case fails.
- [ ] **Step 5: Commit** — "Pair, correct and close working time per person at the venue".

## Task 5: The workforce tests carry no location

**Files:** the test files `pnpm --filter @waitron/workforce typecheck` reports, and
`packages/workforce/test/fixtures.ts`.

- [ ] **Step 1:** Run the typecheck and save its error list. If it names more than about 20 files,
  split: this task takes files `a`–`m`, a Task 5b takes the rest, each with its own commit.
- [ ] **Step 2:** Remove each reported `locationId` property from entry, append, clock-input,
  session, item and closure literals. A throwaway script outside the repo that deletes exactly the
  reported `locationId` property at each reported line and column is fine; read the diff after.
  Where a case loses its only reason to exist (two locations kept apart), delete it and add a table
  row.
- [ ] **Step 3:** `pnpm --filter @waitron/workforce typecheck && pnpm --filter @waitron/workforce exec vitest run`.
  Expected: exit 0; all pass.
- [ ] **Step 4:** `git grep -n -E 'locationId|location_id' -- packages/workforce/src packages/workforce/test`
  and read every hit: each must be a roster, shift, template, convenio, attendance-processing,
  question or answer-command use, or a route scope ("What A1268 leaves to A1301"). Anything that
  puts a location on an entry, session, correction item or closure: fix, or STOP.
- [ ] **Step 5: Commit** — "Workforce tests no longer give clock entries a location".

## Task 6: The export is per venue (D8)

**Files:** `packages/workforce-es/src/record-export.ts`, `registro-jornada.ts`; tests
`record-export.test.ts`, `registro-jornada*.test.ts`.

- [ ] **Step 1: Failing tests.** Delete "explains that a chain position counts its node's entries
  at every location". Add "names the venue once and gives entries and closures no workplace
  column": `formatTimeRecordExport` for `en` → the `metadata` section's columns are
  `["locationName", "periodStart", "periodEnd", "audience", "retainUntil", "accessHolder"]` with
  labels starting `Workplace`, `From`, `Before (excluded)`; the `history`, `frozen-history` and
  `closures` sections have no `locationId` column; `notes` has no line containing "Chain position".
  For `es`, the first label is "Centro de trabajo". Run
  `pnpm --filter @waitron/workforce-es exec vitest run src/record-export.test.ts`. Expected: FAIL.
- [ ] **Step 2:** Delete `LABELS.locationId`, `"locationId"` from `ENTRY_KEYS`, the metadata keys and
  the closures keys, the `locationId` cells, the skip note, and the location in
  `registro-jornada.ts`' entries and closures (:93, :111, :138). `prepareTimeRecordExport` reads
  `timeRecord({ personId, period })`; the workplace name is read as today (:181-185).
- [ ] **Step 3:** `pnpm --filter @waitron/workforce-es typecheck && pnpm --filter @waitron/workforce-es exec vitest run`.
  Expected: exit 0; all pass.
- [ ] **Step 4: Commit** — "The working-time export names the venue once and drops the workplace
  reference columns".

## Task 7: The server's working-time code (D3, D7)

**Files:** `apps/server/src/till-clock-state.ts` (`activeLocationId` deleted; `firstClockIn` counts
the person's clock-ins in the box location's business day), `till-clock-api.ts` (the :152-157
refusal goes; the clock input has no location), `attendance-discovery.ts` (reconcile returns early
only when `state.state === "out"`; the clock endpoint reads `select node_id as key, sequence_no as
endpoint from workforce_chains`; the clock page drops `and location_id = …` and selects
`${scan.locationId} as locationId`), `attendance-facts.ts` (clock facts drop the location filter and
take `${day.locationId}` as their location), `attendance-own-scope.ts` (the entry lookup :13-18
goes — open question 2), `personal-data-time-record.ts` (the days read drops the location filter);
anything else `pnpm --filter @waitron/server typecheck` reports in source files.

- [ ] **Step 1: Failing tests.** Make the Task 7 table rows' changes. The rewritten
  `till-clock-api.test.ts:92` case: an open shift written on another node; the till's node writes
  break-start, break-end and out, moving `instant` on a minute before each and sending each the
  latest state's `lastEntryId` (equal event times fall back to recording time, then node id,
  `effective-entries.ts:3-13`). The retargeted discovery plan case expects no line matching
  `^SCAN time_entries\b` and a page-read plan naming `time_entries_chain_position_uq`. Add
  `attendance-discovery.test.ts` "reconciles the ended day of a shift begun on another node before
  clocking": open shift written on another node yesterday, its day ended →
  `reconcileAttendanceBeforeClock` returns `null` and an `attendance_day_work` row exists for
  yesterday. Two of these are controls rather than flips: once entries carry no location, the old
  refusal and the old early return have nothing to compare, so what fails first is the server's
  typecheck against Tasks 3–4. Run
  `pnpm --filter @waitron/server exec vitest run src/till-clock-api.test.ts src/till-clock-state.test.ts src/till-clock-step.test.ts src/attendance-discovery.test.ts src/personal-data-time-record.test.ts`.
  Expected: FAIL (the server does not compile against Task 3–4 yet, or the new cases fail).
- [ ] **Step 2: Implement** the Files list.
- [ ] **Step 3:** Run Step 1's files plus
  `src/attendance-facts.test.ts src/attendance-loop.test.ts src/boot.attendance.test.ts src/boot.till-clock.test.ts src/till-attendance-api.test.ts src/management-hours-api.test.ts src/till-hours-api.test.ts src/attendance-export-api.test.ts src/attendance-export-csv.test.ts src/attendance-export-pdf.test.ts`.
  Expected: all pass once Task 8's fixture changes for these files are made; make those here for
  these files only.
- [ ] **Step 4: Deletion controls,** each reverted: restore the `writeClock` refusal using any
  remaining field → the rewritten till case fails; restore the `max(sequence_no) … group by
  node_id` endpoint → the plan case fails on `SCAN time_entries`.
- [ ] **Step 5: Commit** — "The till and attendance discovery stop reading an entry's location".

## Task 8: The server's tests and the Madrid baseline

**Files:** test files `pnpm --filter @waitron/server typecheck` reports;
`apps/server/test/attendance-export-fixture.ts`; `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`.

- [ ] **Step 1:** Save the typecheck's error list. More than about 25 files: split into Task 8 (`a`–`m`)
  and Task 8b (the rest).
- [ ] **Step 2:** Remove the reported `locationId` properties (as in Task 5). Keep every
  `locationId` that names the attendance scope, a route parameter, a device or a roster.
- [ ] **Step 3: The Madrid baseline,** beside the branch's `workforce_chains` adjustment: for
  `time_entries` and `pay_period_closures` filter `location_id` out of `columns` and
  `from === "location_id"` out of `foreignKeys`, renumbering `id` from 0 in order; for
  `attendance_questions` filter out the foreign-key rows with `table === "time_entries"` and
  `from === "location_id"`. If a table's remaining keys come back with other ids or order, match
  what the run prints and say so in the commit message.
- [ ] **Step 4:** `pnpm --filter @waitron/server typecheck`, then
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts` and
  every test file Step 2 touched. Expected: exit 0; all pass.
- [ ] **Step 5: Commit** — "Server tests no longer give clock entries a location".

## Task 9: The till and the dashboard (D3, D4)

**Files:** `apps/till/src/api/client.ts` (`activeLocationId` deleted from `TillClockState`),
`apps/till/src/widgets/till-shell.ts` (`foreign` and its message go; `disabled` is
`this.clockBusy || state === null`), `apps/till/src/i18n/strings.ts` (`clock.other_location`
deleted in English and Spanish), `apps/till/test/clock-app.ts`; `apps/dashboard/src/screens/attendance-corrections-screen.ts:499`
(line deleted — open question 4); fixtures both typechecks report.

- [ ] **Step 1: Failing test.** Split `till-shell.test.ts:122` as the table says. Check headroom
  (`memory_pressure | grep free`), then
  `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts`. Expected: the
  deleted case is gone and the typecheck fails until Step 2.
- [ ] **Step 2: Implement;** remove the reported fixture fields in both apps.
  `/usr/bin/grep -rn -E 'activeLocationId|other_location' apps packages --include='*.ts'` prints
  nothing.
- [ ] **Step 3:** `pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/dashboard typecheck`,
  then the till files touched plus `src/i18n/strings.test.ts src/widgets/till-shell.a11y.test.ts`,
  and the dashboard files touched plus `src/screens/attendance-corrections-screen.test.ts`.
  Expected: exit 0; all pass.
- [ ] **Step 4: Commit** — "The till no longer blocks clock actions for a shift begun elsewhere".

## Task 10: Docs and backlog

**Files:**
- `docs/superpowers/specs/2026-07-22-workforce-and-time-record-design.md`: replace the branch's
  2026-11-01 pointer with "> **2026-11-01 — working time is per venue (A1268).** One chain per
  node; clock entries and pay-period closures store no location, and neither hash includes one.
  See `docs/superpowers/specs/2026-11-01-a1268-clock-ins-per-venue-design.md`." Keep the "Chain
  scope" row's pointer to §5.
- `docs/superpowers/plans/2026-10-24-a798-9b-box-sets-its-clock.md`: the branch's three pointers
  stand; check each still reads true.
- `docs/developers/conventions-data.md`, the clock-step paragraph the branch edited: say each
  node's chain holds every one of a person's entries on that node, which carry no location; cut
  the sentence about moving between two locations.
- `docs/backlog.md`: delete the A1268 entry; add in the same area "**A1268 part 2: pair a person's
  entries by write order after a backward clock step.** [Detail](backlog/box.md#a1268-part-2-pair-a-persons-entries-by-write-order-after-a-backward-clock-step)".
- `docs/backlog/box.md`: rename the A1268 section to "## A1268 part 2: pair a person's entries by
  write order after a backward clock step.", keep its second half (the hours read, `intervalsFor`
  and `validateSequence` still order by `compareEvents`; read, not run, except the retime), and
  point at design §4.
- This plan's header: a `Status` line once the PR is updated.

- [ ] **Step 1:** Make the edits, then `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and
  `pnpm exec prettier --check CLAUDE.md` if `CLAUDE.md` was touched (it should not be).
- [ ] **Step 2: Commit** — "docs: working time is per venue; part 2 stays in the backlog".

## Before the PR is merged: name every venue that needs a reset

- [ ] Count each venue's working-time rows, read-only, with `node:sqlite` (never the `sqlite3`
  command line), from a script kept outside every worktree:
  ```js
  import { DatabaseSync } from "node:sqlite";
  const tables = ["time_entries", "pay_period_closures", "workforce_chains", "attendance_questions", "attendance_mail", "attendance_response_commands"];
  for (const path of process.argv.slice(2)) {
    const db = new DatabaseSync(path, { readOnly: true });
    const have = new Set(db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name));
    console.log(path, tables.map((t) => `${t}=${have.has(t) ? db.prepare(`select count(*) as n from ${t}`).get().n : "-"}`).join(" "));
    db.close();
  }
  ```
  run as `node <script> $(find $HOME/workspace/.waitron-dev -maxdepth 6 -name venue.db)`. That
  covers the first dev-stack slot (`.waitron-dev/box/venue`), every `wa-wt` instance
  (`.waitron-dev/instances/<name>/box/venue`) and the Santet venue
  (`instances/waitron-local-santet-data`). A venue with `workforce_chains` > 0 or
  `attendance_mail` > 0 is refused by the migration; one with `time_entries` or
  `pay_period_closures` > 0 no longer verifies. The 2026-11-01 run printed: the first slot
  `time_entries=1 workforce_chains=1`; Santet all zero; entries in instances
  `review-base-9acc3c8aa`, `waitron-feat-a10-4-answers-and-corrections` (24 entries),
  `waitron-feat-a10-5-hours-screens` (23, one closure), `waitron-feat-a10-6-record-export` (22, one
  closure), `waitron-feat-a797-9b-columns-panel`, `waitron-feat-a740-zones-on-device`,
  `waitron-feat-a655-products-columns`. Re-run it before merging.
- [ ] The owner's home box cannot be read from here. The PR names it as needing a reset if it has
  ever recorded a clock entry.
- [ ] The PR's first line: "Venue reset needed for every venue that has recorded a clock entry or
  holds an attendance reminder email: the working-time entry and closure hashes change, and the
  migration refuses such a venue." The body lists the venues above; says a backup taken before
  this release holds the same rows, so restoring it is expected to meet the same refusal (not run);
  discloses that the migration rebuilds `time_entries` and `pay_period_closures`
  (append-only; triggers reinstalled by the set's install) plus `attendance_questions` and
  `workforce_chains`, and that it is two generations and why.
- [ ] Then `/finish-branch` with this plan's path. Risk triggers: a migration and a cross-package
  contract (`TimeEntryRecord`, `CorrectionItem`, `TillClockState`), so the full path and two Codex
  reviews. Reply on the review thread naming both hash changes, the column removal and the export
  change, then resolve it.

---

## Self-review notes

- **Owner decisions → tasks.** No location on entries (column, append input, hash): Tasks 1, 3, 5.
  Sessions per venue: Task 4. Corrections and confirmations by person and entry (D5 gone): Tasks 3
  (keys), 4 (code). Closures per venue, one chain per node, hash without location, verification by
  node: Tasks 2, 3. Export per venue, no skip note, no workplace columns, opening table names the
  venue once: Task 6. End-of-day and attendance per venue on the box location's business day:
  Tasks 4, 7. Device admission untouched: Task 7 leaves `admit`. Reset named in the PR's first
  line: "Before the PR is merged".
- **Nothing new on locations:** no task adds a location column, parameter, view, rule, setting,
  fixture or translation; open question 1's place comes from an existing column.
- **Names used across tasks:** `time_entries_person_entry_uq` (T3), `ChainKey { nodeId }`,
  `readTimeRecord({ period, personId? })` (T3–T4), `closePayPeriod({ nodeId, period, … })` (T3),
  `readClosures({ period })` (T3).

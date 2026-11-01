# A1268 — clock-ins per venue: PR 1 (one chain per node) and PR 2 (clock state and sessions per venue)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** A person is clocked in or out at the venue, not at a location: one working-time hash chain
per node (PR 1), then one clock state per person across the venue, with a work session paired across
locations and counted at its clock-in's location (PR 2).

**Architecture:** PR 1 re-keys `workforce_chains` by `node_id` alone, moves the entry's location
from the chain key onto the append input, and lets `drizzle-kit` write one migration (a rebuild of
`workforce_chains` plus a drop-and-recreate of two `time_entries` indexes, no `time_entries`
rebuild). PR 2 makes every reading that pairs entries read the person's entries at every location,
adds one rule for what a location's view of a record holds (`recordAtLocation`), and removes the
till's and the end-of-day pass's same-location requirements.

**Tech Stack:** TypeScript, drizzle-orm 0.45 / drizzle-kit 0.31.11 on `node:sqlite`, Vitest 4.1.12,
Lit (till).

**Spec:** [A1268 design](../specs/2026-11-01-a1268-clock-ins-per-venue-design.md) (D1–D7, §5).

**Branches:** PR 1 is built on `feat/a1268-clock-ins-per-venue` (this worktree,
`/Users/clintongormley/workspace/worktrees/waitron-feat-a1268-clock-ins-per-venue`). PR 2 is built
on `feat/a1268-2-sessions-per-venue`, a fresh worktree off `main` after PR 1 lands
(`python3 ~/workspace/tools/worktree.py new waitron feat/a1268-2-sessions-per-venue --headless`).
Each PR leaves `main` working on its own.

**Out of scope:** PR 3 — the design's part 2 (§4, "pair by write order, show the time as written"),
which gets its own plan after PR 2 lands. Also out (design §6): a cross-node write order, device
admission, and the pay-period closure chain.

## Global Constraints

- **No carry-forward code** (CLAUDE.md §3, "No backwards-compatibility or data-migration code until
  Waitron is in production"). A database the new unique key refuses is reset, not migrated.
- **Let `drizzle-kit` write the migration.** Never hand-edit a snapshot or `_journal.json`.
  Command (from `packages/workforce`): `pnpm db:generate --name workforce_chain_per_node`
  (`--name` is listed by `pnpm exec drizzle-kit generate --help`, run 2026-11-01).
- **The hash does not change** (D1): `computeEntryHash` (`packages/workforce/src/chain-hash.ts`)
  already hashes the entry's own `locationId` and `sequenceNo`. `chain-hash.ts` is not edited
  except its one comment ("within its (node, location) chain").
- **Fiscal gates stay unedited and green:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`.
- **D5 is kept:** `time_entries_response_subject_fk`, `time_entries_subject_identity_uq` and
  `sameSubject` (`effective-entries.ts:17-19`, person AND location) are not touched. Only
  session PAIRING becomes per person.
- **D6 is kept:** pay-period closures stay a chain per (node, location)
  (`pay_period_closures_chain_position_uq`, `schema/pay-period-closures.ts:28`).
- **Tests:** a test's ASSERTION changes only where a design decision changes what it checks, and
  every such change is in the "Test checks this plan changes" table. An implementer who finds
  another assertion that must change adds a row with the decision that justifies it; if no decision
  does, STOP and report.
- **Comments:** only for an invariant or a non-obvious why. A comment stating the old
  per-(node, location) shape is cut or rewritten in the task that changes the code under it.
- **Commits:** `git commit -s`, explicit paths, never `git add -A`. Commit messages and PR text in
  plain English.
- **Local runs are for feedback.** Focused files plus the named package suites; never a
  whole-workspace run. Check free memory first (`memory_pressure | grep free`) before the till's
  browser tests.
- **Shell is zsh:** quote globs, use `/usr/bin/grep` where an exit status decides anything.

### Guard suites for a schema change (Task 3)

From the worktree root, every one, each exit status checked:

```bash
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts \
  scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts \
  scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts \
  scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
```

## Review Focus

1. **A box whose node already wrote clock entries at two locations** (a dashboard correction naming
   another location, `corrections.ts`). Expected: the migration is refused with
   `UNIQUE constraint failed: __new_workforce_chains.node_id`, nothing is changed, and the venue is
   reset. Task 3's rehearsal test.
2. **A correction or confirmation written at another location on the same box after PR 1.**
   Expected: it takes the node's next position in its one chain, keeps its own `location_id`, and
   the chain verifies whole. Task 3's chain case.
3. **A session clocked in at A and out at B** (after PR 2, from the till). Expected: counted once,
   at A, in the hours screen, the period record, the art. 34.9 export, the closure snapshot and the
   end-of-day pass — never at B, never twice, never as an unmatched clock-out. Tasks 6–9.
4. **An open shift clocked in at A with a break started at B.** Expected: the hours screen at A shows
   it open with the break; B's view shows none of its entries. Tasks 6 and 8.
5. **Two nodes writing one venue database (a promotion).** Expected: still one chain per node, each
   numbered from 1, merged by time as today. Task 3 keeps the two-node control.

---

## What a survey and a throwaway run found (2026-11-01, on `56aa74f85`)

- **The migration `drizzle-kit` writes.** With the schema edited as Task 3 says, `pnpm db:generate`
  wrote ONE file that rebuilds `workforce_chains` (create `__new_workforce_chains` with
  `node_id text PRIMARY KEY`, copy the six remaining columns, `DROP TABLE`, rename) and then only
  drops and recreates `time_entries_person_chain_idx` and `time_entries_chain_position_uq`.
  `time_entries` is NOT rebuilt, so its append-only triggers are untouched. The experiment was
  reverted; the file is regenerated in Task 3.
- **Foreign keys stay on through that rebuild.** The `PRAGMA foreign_keys=OFF` it emits is a no-op
  inside the migration's transaction (CLAUDE.md §3). Nothing references `workforce_chains`
  (`/usr/bin/grep -rn "workforceChains\|workforce_chains"` over `packages/*/src/schema` printed only
  the table itself), so the `DROP TABLE` loses and refuses nothing. Rehearsed on `node:sqlite`
  (a throwaway script, not the `sqlite3` CLI), with the migration's own statements in one
  transaction and `pragma foreign_keys` reading 1 throughout: one location on a node → migrated,
  head kept with its `sequence_no`; two locations on one node → refused
  `UNIQUE constraint failed: __new_workforce_chains.node_id`, rolled back, both heads kept.
- **The rebuild traps do not apply.** No column is added (the 0.31.x add-column-in-a-rebuild
  failure), and `workforce_chains` has no expression index.
- **Its triggers.** `workforce_chains` is classified `ledger` but not `appendOnly`
  (`packages/workforce/src/classification.ts:15-19`), so its only triggers are the change feed's,
  which are removed before migrating (`packages/migrations/src/apply.ts:65`) and reinstalled by
  boot (`packages/db/src/change-feed.ts:139-143`). Boot's append-only trigger restore has nothing
  to restore: `time_entries`' triggers are not dropped. So the PR discloses a rebuild of a
  non-append-only table and no append-only trigger change.
- **Guard suites against that migration** (8 files: 507 passed, 1 failed). The one failure was
  `scripts/schema-constraints.test.ts` "carries every foreign key the product declares", missing
  `workforce_chains(location_id)->locations` — the row Task 3 deletes.
  `scripts/migration-upgrade.test.ts` passed. It is weaker than it looks here: its synthetic
  rows differ in every unique-index column (its header comment, lines 39-49), so it cannot show the
  two-location refusal. Task 3's rehearsal test does.
- **The demo seed writes no clock rows:** `madrid-before-move.manifest.json` counts
  `time_entries: 0` and `workforce_chains: 0` in every phase. But
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` compares each table's captured
  columns and foreign keys. Against the experiment it failed on `workforce_chains`: `location_id` is
  gone and the `node_id` foreign key's `id` goes from 2 to 1. Task 3 adds the adjustment, the way
  `parties.main_bill_id` was handled (lines 134-136 of that test).
- **`projectWorkSessions` already pairs per person** (`projection.ts`, `groupByPerson`). Today's
  per-location pairing comes from callers that filter entries by location before pairing
  (`readTimeRecord`, `hours-reads.ts:106`, `clocking.ts:270`, `pay-period-close.ts:112`), from
  `recordInPeriod`'s (person, location) key (`record-period.ts:25,31`), and from the closure view's
  location filters (`record-projection.ts:92-93,105`).
- **The correction sequence check already reads the person at every location.** `validateChange`
  is handed `readRecordedEntries(tx, { personId })` (`corrections.ts:338,406`) and filters by
  person only. Only the pending-counterpart lookup (`corrections.ts:232`) matches the location.
  This was read, not run; the existing cases `correction-lifecycle.test.ts:38` and `:64`
  ("…overlapping the person's completed work at another location") agree.
- **Guides:** nothing to change. `/usr/bin/grep -rniE "another location|other location|otro local|per location|each location|cada local"`
  over `apps/server/src/guide`, filtered to clock, shift, turno, fichar and hours words, printed
  nothing.
- **Dashboard:** no screen shows another-location clock state. The same grep over `apps/dashboard/src`
  and `packages/workforce/src/dashboard`, test files left out, printed nothing.

## Where this plan departs from the design

1. **The 9b residual test flips in PR 1, not PR 2.** It pins `readLatestLiveEntry` and the
   `WorkforceBackend` clock actions (`clocking-step.test.ts:282-296`), with no till refusal in the
   path. PR 1 changes that read (D3's read), so it flips there. The 9b plan's FYI 7,
   "Accepted residual" and ruling (e) pointers move with it into PR 1.
2. **The workforce spec gets its chain-scope pointer in PR 1.** PR 1 changes what §5 and the
   "Chain scope" row say (CLAUDE.md §1: a behaviour change retires every receipt about the old
   behaviour). PR 2 adds the pairing pointer.
3. **D4's list is narrowed to where pairing is actually per location** (the survey above). The
   hours projection itself and the correction sequence check are already per person; the change is
   in what their callers hand them, plus `corrections.ts:232`.
4. **The design does not say what a location's view holds besides its sessions.** This plan decides
   it (Task 6, `recordAtLocation`): an entry belongs to the location of the session it falls in,
   including a person's trailing open shift. An entry that falls in no session belongs to the
   location it was made at. So an entry is in exactly one location's view. Open question 1.
5. **Closure snapshots follow D4** (Task 7). The closure chain is untouched (D6), but what a closure
   freezes is the location view, so a session clocked in at A and out at B is frozen in A's closure.

## Open questions (each has a default the build uses)

1. **Is an entry made at B, inside a session clocked in at A, also listed in B's view?** Default:
   no. It is in A's view only, so the art. 34.9 export at B does not show a lone clock-out.
2. **Keep `activeLocationId` in the till's clock state response?** After PR 2 nothing reads it
   (`till-shell.ts:1103-1106` and `attendance-discovery.ts:31` are its only readers). Default: keep
   it. Removing it changes the server-to-till contract and some 15 till fixtures, and the design
   does not ask for it. A backlog line records it.
3. **Which location's day does the till's pre-clock reconciliation process when the open shift
   began at another location?** Default: the clock-in's location, by that location's clock. This
   follows D7's "a session counted at its clock-in's location".
4. **Questions keep their per-location history.** An end-of-day question belongs to one
   (person, location, day), and `attendance-reads.ts`/`attendance-question-responses.ts` show only
   that location's entries in its history. Default: unchanged (D5). A later entry at another
   location is not shown in the question's history.

## Test checks this plan changes

"Fixture" rows change setup or a query only; every other row changes an assertion and names its
decision.

| PR / Task | Test file | Test | Old check | New check | Why |
|---|---|---|---|---|---|
| 1 / T3 | `packages/workforce/src/chain.test.ts` | "keeps a separate, independent chain per (node, location)" (:114) | other location on another node: own chain from 1 | renamed "keeps one chain per node across locations": second location on the SAME node continues at 2; the other node's chain still starts at 1 | D1 |
| 1 / T3 | same | "keeps one chain per (node, location); two nodes at one location do not collide" (:127) | positions per node | unchanged checks; renamed "…per node…" | fixture (name) |
| 1 / T3 | same | "advances the chain head…" (:94), readChainHead cases (:477, :491), retry case (:376) | head row selected `where node_id and location_id` | `where node_id` | fixture (query) |
| 1 / T3 | same | "rejects a second entry claiming an occupied chain position" (:242), retry case (:349) | refusal columns `node_id, location_id, sequence_no` | `node_id, sequence_no` | D1 |
| 1 / T3 | same | exhaustion cases (:271, :289) | params `{ nodeId, locationId, attempts: 3 }` | `{ nodeId, attempts: 3 }` | D1 (the key is the node) |
| 1 / T3 | `src/chain.concurrency.test.ts` | "never collides between two nodes on the SAME location" (:95) | key helper takes a location | key `{ nodeId }` | fixture |
| 1 / T3 | `src/restore-continuation.test.ts` | "refuses a survivor's forked row loudly…" (:118) | columns `node_id, location_id, sequence_no` | `node_id, sequence_no` | D1 |
| 1 / T3 | same | `readHead` (:65) | `where nodeId and locationId` | `where nodeId` | fixture |
| 1 / T3 | `src/clocking-step.test.ts` | "reads the latest chain's entry when the person moved location (control)" (:157) | positions `[a,1],[a,2],[b,1]` | `[a,1],[a,2],[b,3]`; renamed "…reads the latest entry when the person moved location (control)" | D1 |
| 1 / T3 | same | "keeps a chain per node as well as per location" (:204) | latest is the second node's `in` | same check; renamed "keeps a chain per node" | fixture (name) |
| 1 / T3 | same | "still reads another location's later-dated entry after a step, as the plan accepts" (:282) | reads `out` 21:10; clock-out at B refused `attendance.no_open_entry`; second clock-in at B written (4 rows) | renamed "reads the clock-in at another location written after a step": reads `in` 20:15; clock-out at B 20:40 accepted; a clock-in at B 20:45 refused `attendance.already_open`; 4 rows | D1, D3 |
| 1 / T3 | same | "finds the deciding entry through indexes…" (:300) | plan contains `…time_entries_person_chain_idx (person_id=? AND node_id=? AND location_id=?)` | `…(person_id=? AND node_id=?)` | D1 |
| 1 / T3 | `src/migrations.test.ts` | "keys the working-time chain head by (node_id, location_id) alone" (:546) | key `["node_id","location_id"]` | renamed "…by node_id alone": `["node_id"]` | D1 |
| 1 / T3 | same | "rebuilds the multi-column keys on their remaining columns" (:558) | `time_entries_chain_position_uq` = `node_id, location_id, sequence_no` | `node_id, sequence_no`; add `time_entries_person_chain_idx` = `person_id, node_id, sequence_no` | D1 |
| 1 / T3 | `src/index.test.ts` | "declares the chain head's composite key, foreign keys and pointer check" (:143-160) | pk `workforce_chains_node_id_location_id_pk`; location foreign key | no composite key (`primaryKeys` empty; `node_id` is the column primary key); foreign keys on node and last entry only; renamed "declares the chain head's key…" | D1 |
| 1 / T3 | `src/personal-data.coverage.test.ts` | "classifies every column of workforce_chains exactly once" | `out` lists `location_id` | without `location_id` | D1 |
| 1 / T3 | `src/backup-verification.test.ts` | "walks every node-location time chain and stored head including retired nodes" (:237) | 3 heads | 2 heads (node, retired); renamed "walks every node's time chain…" | D1 |
| 1 / T3 | same | "rejects malformed stored head scope %s" (:351) | cases `node_id=x'01'`, `location_id=x'01'` | `node_id=x'01'` only (the column is gone) | D1 |
| 1 / T3 | same | "detects damage on another location" (:367) | damages `location_id=otherPlace and sequence_no=1` | damages the lowest-positioned `otherPlace` row on `node` (`sequence_no=6` by the seed's order, read not run) | fixture (that row's position moved) |
| 1 / T3 | same | "accepts legacy entries with no record extension" (:290), "accepts an explicit empty stored head…" (:488) | head written `where/values … location_id` | without `location_id` | fixture |
| 1 / T3 | `src/attendance-response-migration.test.ts` | "adds only the empty receipt table and retains legal rows, heads, questions and attempted mail byte for byte" (:172) | rows written by today's `WorkforceBackend` on the 0008-era schema; heads byte for byte | rows written by raw inserts with `computeEntryHash` (as `record-migration.test.ts` does); heads equal to the before rows minus `location_id` | D1/D2 (this test runs through the new migration, which drops the column) |
| 1 / T3 | `src/attendance-response-commands.test.ts` (:223), `src/correction-groups.test.ts` (:159) | heads ordered by `nodeId, locationId` | ordered by `nodeId` | fixture |
| 1 / T3 | `scripts/schema-constraints.test.ts` | FK list (:343) | row `["workforce_chains", ["location_id"], "locations"]` | row deleted | D1 |
| 1 / T3 | `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` | "preserves every Madrid seed row (en/es)" | captured `workforce_chains` shape | adjustment: drop the `location_id` column and its foreign key, renumber the remaining foreign keys' `id` | D1 (as `parties.main_bill_id`) |
| 1 / T3 | `apps/server/src/management-hours-api.test.ts` (:107), `till-attendance-api.test.ts` (:118), `attendance-export-api.test.ts` (:89) | heads `order by node_id, location_id` | `order by node_id` | fixture |
| 1 / T1, T3 | every `appendToChain`/`readChain`/`readChainHead` call in tests (list in Tasks 1 and 3) | entry gains `locationId` (T1); key loses it (T3) | — | fixture |
| 1 / T2 | `src/backup-verification.test.ts` | new "verifies closures at two locations of one node as two chains" | — | new control | D6 |
| 2 / T6 | `src/record-reads.test.ts` | new cases (Task 6) | — | — | D4 |
| 2 / T10 | `apps/server/src/till-clock-api.test.ts` | "refuses break and out writes on a shift at another location, while a matching-location shift succeeds" (:92) | out/break-start/break-end answer 403 `attendance.not_permitted`, 1 row | renamed "lets break and out writes close a shift begun at another location": break-start 200, break-end 200, out 200; the out is written at the box's location on the box's node; state `out` | D3 |
| 2 / T11 | `apps/till/src/widgets/till-shell.test.ts` | "unknown or another-location clock state offers Retry or an explanation and disables clock writes (%s)" (:122) | `"another-venue"`: buttons disabled, text `clock.other_location` | split: `null` case unchanged; new "keeps clock actions enabled when the open shift began at another location": buttons enabled, no "another location" text | D3 |

---

# PR 1 — one chain per node (D1, D2, D6's split, D3's read)

The PR's first line: **"Venue reset needed only for a box that recorded clock entries at two
locations; every other venue migrates in place."** Its body discloses that the migration rebuilds
`workforce_chains` (not append-only; change-feed triggers only, removed before migrating and
reinstalled at boot) and drops and recreates two `time_entries` indexes, with no `time_entries`
rebuild and no append-only trigger change.

### Task 1: The append input carries the entry's location

A refactor with no behaviour change. It moves the location onto the entry before Task 3 removes it
from the key, which keeps Task 3's sweep small. There is no new test: what proves it is typecheck
plus the unchanged suites.

**Files:**
- Modify: `packages/workforce/src/chain.ts` (`TimeEntryAppend`, `attemptAppend`)
- Modify (callers): `packages/workforce/src/clocking.ts:614-637`, `corrections.ts` (the four
  `appendToChain` calls, :339, :407, :465, :503, and the `entry` values they pass),
  `automatic-entries.ts:66`, `:130`, `pay-period-close.ts:38`, `packages/workforce/test/fixtures.ts:250`
- Modify (tests that build a `TimeEntryAppend`): whatever
  `pnpm --filter @waitron/workforce typecheck` and `pnpm --filter @waitron/server typecheck` report.
  Expected from reading: `chain.test.ts`, `chain.concurrency.test.ts`, `restore-continuation.test.ts`,
  `backup-verification.test.ts`, `record-extension.test.ts`, `record-read-budget.test.ts`,
  `end-of-day.obligations.test.ts`; `apps/server/src/till-clock-attendance.test.ts`,
  `till-clock-state.test.ts`, `restore-command.archive.test.ts`

**Interfaces:**
- Produces: `TimeEntryAppend.locationId: string` (required). In this task `attemptAppend` hashes and
  stores `entry.locationId`, and `key.locationId` still addresses the head row. Callers pass the same
  location in both until Task 3.

- [ ] **Step 1: Add `locationId: string` to `TimeEntryAppend`.** In `attemptAppend`, use
  `entry.locationId` for `computeEntryHash` and the `time_entries` insert (`chain.ts:127`, `:148`);
  leave `selectHead`, the head insert and the head update on `key`.
- [ ] **Step 2: Fix every caller typecheck reports.** Each passes the location it already put in the
  key. Run `pnpm --filter @waitron/workforce typecheck && pnpm --filter @waitron/server typecheck`.
  Expected: exit 0 from both.
- [ ] **Step 3: Run the suites the change reaches.**
  `pnpm --filter @waitron/workforce exec vitest run` (whole package; every clock action goes through
  `appendToChain`), then
  `pnpm --filter @waitron/server exec vitest run src/till-clock-attendance.test.ts src/till-clock-state.test.ts src/restore-command.archive.test.ts src/till-clock-api.test.ts`.
  Expected: every test passes with no assertion edited. Read the `Tests` count.
- [ ] **Step 4: Commit** — "Pass the clock entry's location with the entry, not only the chain key".

### Task 2: Backup verification names its two groupings

The time chain and the closure chain are grouped by the same `scope()` today
(`backup-verification.ts:137-139`, used at :149, :165, :206). This task splits it. The behaviour is
unchanged here; Task 3 changes only the time grouping.

**Files:**
- Modify: `packages/workforce/src/backup-verification.ts`
- Test: `packages/workforce/src/backup-verification.test.ts`

**Interfaces:**
- Produces: `chainScope(row: BackupRow): string` (time entries and stored heads; still
  `[node_id, location_id]` until Task 3) and `closureScope(row: BackupRow): string`
  (`[node_id, location_id]`, kept by D6).

- [ ] **Step 1: Write the control test** "verifies closures at two locations of one node as two
  chains": in its own case, `closePayPeriod` for `node` at `otherPlace` for a period not yet closed
  there (January is closed there by `retired`, so `2026-02-01`–`2026-03-01`). The seed already
  closes three periods for `node` at `place`. A close can append closure markers to the time chain,
  so re-copy `pay_period_closures`, `time_entries` and `workforce_chains` from `original` into
  `restored` (delete, then insert, as the `beforeEach` copies them). Then
  `expect(await run()).toEqual(passed)`. It passes before and after this task.
- [ ] **Step 2: Deletion control.** Temporarily make `closureScope` return `[node_id]` alone. The new
  case must fail on `history` (the two locations' closures then form one chain that restarts at 1).
  Revert.
- [ ] **Step 3: Split `scope` into `chainScope` and `closureScope`;** `checkTime` uses the first,
  `checkClosures` the second.
- [ ] **Step 4: Run** `pnpm --filter @waitron/workforce exec vitest run src/backup-verification.test.ts`
  — every case passes.
- [ ] **Step 5: Commit** — "Name backup verification's time and closure groupings separately".

### Task 3: The cut — one chain per node

The one task that cannot be split without leaving a red tree: once the column goes, `chain.ts`,
`readLatestLiveEntry`'s subqueries and the backup check all name it. The edits are small; most of
the task is the test sweep, which typecheck finds. If it passes about 150 tool calls unfinished,
stop at a green or cleanly red point, commit, and hand over (global rule).

**Files:**
- Create: `packages/workforce/src/chain-per-node-migration.test.ts`
- Modify: `packages/workforce/src/schema/workforce-chains.ts`, `schema/time-entries.ts`
  (`time_entries_person_chain_idx` → `(personId, nodeId, sequenceNo)`,
  `time_entries_chain_position_uq` → `(nodeId, sequenceNo)`; comments at :53-54, :86, :165)
- Generate: `packages/workforce/drizzle/0012_workforce_chain_per_node.sql`, `drizzle/meta/0012_snapshot.json`, `_journal.json`
- Modify: `packages/workforce/src/chain.ts` (`ChainKey`, `selectHead`, `readChainHead`,
  `attemptAppend`, `readChain`; comment at :20-21), `errors.ts:27-31`,
  `record-reads.ts:85-147`, `backup-verification.ts` (`chainScope`, the `order by` at :146),
  `chain-hash.ts:7` (comment)
- Modify (tests): the rows in "Test checks this plan changes" marked 1 / T3, plus every
  key literal typecheck reports, in both packages
- Modify: `scripts/schema-constraints.test.ts:343`, `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`

**Interfaces:**
- Consumes: `TimeEntryAppend.locationId` (Task 1), `chainScope` (Task 2).
- Produces: `interface ChainKey { nodeId: string }`;
  `appendToChain(tx, key: ChainKey, entry: TimeEntryAppend, clock?)`,
  `readChainHead(tx, key: ChainKey)`, `readChain(tx, key: ChainKey): Promise<VerifiableEntry[]>`
  (the node's whole chain, ordered by `sequence_no`); `attendance.append_contention` params
  `{ nodeId: string; attempts: number }`.

- [ ] **Step 1: Write the rehearsal test** `chain-per-node-migration.test.ts`. Use the
  truncated-journal pattern of `record-migration.test.ts:24-37`, with the folder holding entries
  `0000`–`0011` (`journal.entries.slice(0, 12)`). Use `useVenueDb` with `CORE_MIGRATIONS`,
  `IDENTITY_MIGRATIONS` and `{ ...WORKFORCE_MIGRATIONS, migrationsFolder: previousFolder, appendOnlyTables: ["time_entries"] }`.
  Write rows by raw `insert` with `computeEntryHash`, as `record-migration.test.ts:61-102` does,
  never through today's writer. Two cases, each in its own `describe` with its own database:
  - "migrates a node whose entries are all at one location in place": two entries (`in`, `out`) at
    `place` on `node`, positions 1–2, and their head. Then `await runMigrations(suite.db, WORKFORCE_MIGRATIONS)`.
    Assert `time_entries` rows are byte-equal to before; `pragma table_info(workforce_chains)` names
    no `location_id`; the head row is `{ node_id, sequence_no: 2, last_entry_id, last_entry_hash, last_recorded_at }`
    from before; an `appendToChain(tx, { nodeId: node }, { …, locationId: place })` gets
    `sequenceNo: 3`; and `verifyChain(await readChain(suite.db, { nodeId: node }))` is `{ ok: true }`.
  - "refuses a node with chains at two locations and changes nothing": one entry at each of two
    locations on `node`, each position 1 with its own head. Assert that `runMigrations` throws, that
    `engineErrorMessage(error)` contains `UNIQUE constraint failed: __new_workforce_chains.node_id`,
    that both tables' rows equal those before, and that `workforce_chains` still has `location_id`.
  Run `pnpm --filter @waitron/workforce exec vitest run src/chain-per-node-migration.test.ts`.
  Expected: FAIL. The first case still finds `location_id`; the second resolves instead of throwing.
- [ ] **Step 2: Write the chain case** in `chain.test.ts`: rename "keeps a separate, independent chain
  per (node, location)" (:114) to "keeps one chain per node across locations". Append at `locationId`
  and then at `otherLocation`, both on `nodeId`, and expect
  `(await readChain(suite.db, { nodeId })).map((e) => [e.locationId, e.sequenceNo])` to equal
  `[[locationId, 1], [otherLocation, 2]]` and `verifyChain` to be `{ ok: true }`. A third append on
  `otherNode` gets `sequenceNo: 1`. Expected now: FAIL (the second position is 1).
- [ ] **Step 3: Change the schema.** `workforce_chains`: `nodeId: id("node_id").primaryKey().references(() => nodes.id)`,
  delete `locationId`, delete the `primaryKey(...)` entry and the `locations` import. Rewrite the
  table comment to one sentence: one row per node; `sequence_no` is never reset; `last_recorded_at`
  keeps `recorded_at` monotonic per chain. Change the two `time_entries` indexes. Rewrite the
  comments at `time-entries.ts:53-54` and `:86` to say the node keys the chain, and the one at
  `:165` to say "a person's latest entry on each node".
- [ ] **Step 4: Generate the migration.** From `packages/workforce`:
  `pnpm db:generate --name workforce_chain_per_node`. Expected: `drizzle/0012_workforce_chain_per_node.sql`
  holds the `__new_workforce_chains` rebuild and the two index drops and creates, and no
  `__new_time_entries`. Run `/usr/bin/grep -c "__new_time_entries" drizzle/0012_workforce_chain_per_node.sql`
  and expect `0`. If the file differs from that shape, STOP and report.
- [ ] **Step 5: Re-key `chain.ts`.** `ChainKey` is `{ nodeId: string }`. `selectHead`, the head
  update and `readChain` match `nodeId` only; the head insert is `values({ nodeId })` with
  `onConflictDoNothing({ target: workforceChains.nodeId })`. Hash and store `entry.locationId`. The
  `ChainKey` comment becomes "One chain per node." (or is cut). Change the `errors.ts` params to
  `{ nodeId: string; attempts: number }`.
- [ ] **Step 6: Re-key `readLatestLiveEntry`** (`record-reads.ts`). `followedByDirect(node, sequence)`
  drops its `location` argument and the `later.location_id = …` clause. The head subquery drops
  `and head.location_id = ${workforceChains.locationId}`. Rewrite the doc comment (:85-96) to the
  rule as it now stands: within a node a later position is a later write, whatever the clock said;
  event times are compared across nodes and against an approved missing-entry correction; retimes
  are left out. Cut the "Accepted residual" sentence.
- [ ] **Step 7: Backup verification.** `chainScope` returns `JSON.stringify([text(row, "node_id")])`;
  `checkTime` selects `… order by node_id, sequence_no`.
- [ ] **Step 8: Sweep.** Run `pnpm --filter @waitron/workforce typecheck` and
  `pnpm --filter @waitron/server typecheck`. Fix each reported key literal (`{ nodeId, locationId }`
  handed to `appendToChain`/`readChain`/`readChainHead` becomes `{ nodeId }`; a helper like
  `key(location, node)` keeps only the node). Find raw SQL on the head table with
  `/usr/bin/grep -rn "workforce_chains" packages/workforce/src apps/server/src | /usr/bin/grep location`
  and `/usr/bin/grep -rn "workforceChains.locationId" packages apps`, and fix each hit. Expected
  afterwards: both typechecks exit 0, and both greps print nothing outside
  `chain-per-node-migration.test.ts`.
- [ ] **Step 9: Make the table's assertion changes** marked 1 / T3. That includes the
  `attendance-response-migration.test.ts` rewrite: seed by raw insert, and compare heads with
  `location_id` left out of the before rows. Also the `seed.madrid-baseline.test.ts` adjustment,
  inside the `for (const phase …)` loop beside the `parties` one: filter `location_id` out of
  `workforce_chains.columns`, filter `from === "location_id"` out of its `foreignKeys`, and
  renumber the remaining keys' `id` in their existing order from 0. Then delete the
  `schema-constraints.test.ts:343` row. For the clocking-step residual flip, the new body is:
  in at A 21:00, out at A 21:10, in at B 20:15 → `latest` is `{ kind: "in", at: "20:15" }`;
  out at B 20:40 → accepted; in at B 20:45 → `attendance.already_open`; `rowCount` 4. Replace its
  comment with "One chain per node: the clock-in written after the step is the latest write.".
- [ ] **Step 10: Run the focused files, then the package.**
  `pnpm --filter @waitron/workforce exec vitest run src/chain-per-node-migration.test.ts src/chain.test.ts src/chain.concurrency.test.ts src/clocking-step.test.ts src/backup-verification.test.ts src/migrations.test.ts src/index.test.ts src/restore-continuation.test.ts src/attendance-response-migration.test.ts src/personal-data.coverage.test.ts`
  (expected: all pass), then `pnpm --filter @waitron/workforce exec vitest run` (whole package).
- [ ] **Step 11: Run the server files the cut reaches.**
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts src/management-hours-api.test.ts src/till-attendance-api.test.ts src/attendance-export-api.test.ts src/till-clock-api.test.ts src/till-clock-state.test.ts src/till-clock-step.test.ts src/till-clock-attendance.test.ts src/restore-command.archive.test.ts src/attendance-loop.test.ts src/attendance-restore.test.ts src/boot.attendance.test.ts src/backup-verification.authority.test.ts src/venue-details.test.ts`.
  Expected: all pass.
- [ ] **Step 12: Run the guard suites** in "Guard suites for a schema change" — every one passes,
  and the two fiscal ones are unedited (`git diff --stat -- packages/fiscal-verifactu` prints
  nothing).
- [ ] **Step 13: Deletion controls.** Each is reverted afterwards:
  - Put `location_id` back into the head subquery of `readLatestLiveEntry`. The clocking-step
    residual case must fail, and so must "finds the deciding entry through indexes…".
  - Make `chainScope` `[node_id, location_id]` again. The backup case "walks every node's time
    chain…" must fail on `head`, because a head row has no `location_id`.
- [ ] **Step 14: Commit** — "One working-time chain per node: the chain head is keyed by the node
  alone and each entry keeps its own location".

### Task 4: PR 1's docs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-workforce-and-time-record-design.md` — a dated pointer
  after the 2026-09-07 note (:275-…): "> **2026-11-01 — one chain per node (A1268 PR 1).** The
  chain is keyed by `node_id` alone; each entry keeps its own `location_id`. See
  `docs/superpowers/specs/2026-11-01-a1268-clock-ins-per-venue-design.md`." Also add
  `_(2026-11-01: one chain per node — see §5)_` to the "Chain scope" row (:374). Do not rewrite the
  history above them.
- Modify: `docs/superpowers/plans/2026-10-24-a798-9b-box-sets-its-clock.md`. Add one dated line
  each after FYI 7 (:245-252), after the "Accepted residual" paragraph (:2979-2992) and after
  ruling (e) (:3814-3821): "*(2026-11-01: A1268 PR 1 keyed the chain by node alone; the case no
  longer arises, and the residual test in `clocking-step.test.ts` now pins the fixed behaviour.)*"
- Modify: `docs/backlog/box.md` A1268 section. Replace "A1268 re-keys the chain to one per venue,
  which removes that case." with "PR 1 keyed the chain by node, which removed that case; PR 2 makes
  clock state and work sessions per venue." The backlog index line is unchanged.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` — passes.
- [ ] **Step 3: Commit** — "docs: record that the working-time chain is now one per node".

Then `/finish-branch` with this plan's path. Risk triggers: a migration, and a cross-package
contract (`ChainKey`), so this is the full path and two Codex reviews.

---

# PR 2 — clock state and sessions per venue (D3's till change, D4, D5, D7)

Branch `feat/a1268-2-sessions-per-venue`, off `main` after PR 1 lands. No migration. On a box with
one location, nothing a person sees changes. The tests prove the cross-location cases.

**The rule the tasks share.** A location's view of a record is made in three steps. Read the
entries of every person with any entry at that location, at every location. Pair them per person.
Then keep three things: the sessions whose clock-in was made at the location; the entries that fall
inside one of those sessions, or inside the person's trailing open shift if it began there; and the
entries made at the location that fall inside no session and no open shift. Corrections and
confirmations go with their root entry (`recordRoot`).

### Task 5: Session windows and a location's view of a record

**Files:**
- Modify: `packages/workforce/src/projection.ts` (add `sessionWindows`)
- Modify: `packages/workforce/src/record-period.ts` (add `recordAtLocation`; `recordInPeriod` keys
  sessions by person, :23-31)
- Test: `packages/workforce/src/projection.test.ts`, `packages/workforce/src/record-projection.test.ts`

**Interfaces:**
- Produces:
  - `interface SessionWindow { personId: string; locationId: string; startedAt: string; endedAt: string | null }`
  - `sessionWindows(entries: readonly TimeEntryRecord[]): SessionWindow[]` — the same pairing as
    `projectWorkSessions` (effective clock entries, per person, by `compareEvents`), plus one
    window with `endedAt: null` for a person's trailing open shift. `locationId` is the clock-in's.
  - `recordAtLocation(record: TimeRecord, locationId: string): TimeRecord` — the shared rule above.
    Membership is decided per root over `effectiveClockEntries` of `record.entries`. A root inside a
    window with `start ≤ eventAt ≤ end` (no end for an open one) belongs to that window's location;
    otherwise to its own `locationId`. It keeps `sessions` with `s.locationId === locationId`, plus
    `closures` and `closedPeriodImpacts` of that location.

- [ ] **Step 1: Write the failing tests.** Build the entries with the existing record-projection
  helpers.
  - `sessionWindows`: in A 09:00, out B 17:00, in B 18:00 →
    `[{ A, 09:00, 17:00 }, { B, 18:00, null }]`.
  - `recordAtLocation(projectTimeRecord(entries), A)` for in A 09:00, break_start B 12:00,
    break_end B 12:30, out B 17:00: one session, `workedMinutes` 450, and entries
    `in, break_start, break_end, out`. For B: no sessions and no entries.
  - `recordInPeriod` over that A view keeps all four entries. Today's (person, location) key keeps
    only the `in`, which is what this case fails on.
  - Control (passes before and after): in A 09:00, out A 12:00, in B 13:00, out B 17:00 → A's view
    has the 180-minute session and two entries, B's the 240-minute one and two.
  Run `pnpm --filter @waitron/workforce exec vitest run src/projection.test.ts src/record-projection.test.ts`.
  Expected: FAIL (`sessionWindows`/`recordAtLocation` are not exported).
- [ ] **Step 2: Implement** `sessionWindows`, `recordAtLocation`, and the per-person key in
  `recordInPeriod` (`JSON.stringify([session.personId])`, and the same for the entry lookup at :31).
- [ ] **Step 3: Run** the two files, then `pnpm --filter @waitron/workforce exec vitest run src/record-reads.test.ts src/record-closures.test.ts src/pay-period-closure.test.ts`
  — every one passes. On callers that still pre-filter by location, the per-person key changes
  nothing.
- [ ] **Step 4: Deletion control:** key `recordInPeriod` by (person, location) again → the
  four-entry case fails. Revert.
- [ ] **Step 5: Commit** — "Add a location's view of a working-time record, with sessions paired
  per person".

### Task 6: The period record reads the person at every location

**Files:**
- Modify: `packages/workforce/src/record-reads.ts` (`readRecordedEntries` gains a `presentAt`
  scope; `readTimeRecord` uses it and `recordAtLocation`)
- Modify: `packages/workforce/src/record-projection.ts:89-107` (each closure's current view)
- Test: `packages/workforce/src/record-reads.test.ts`, `record-closures.test.ts`

**Interfaces:**
- Consumes: `recordAtLocation` (Task 5).
- Produces: `readRecordedEntries(tx, scope: { personId?: string; locationId?: string; entryId?: string; presentAt?: string })`.
  `presentAt: L` reads every entry of every person with any entry at `L`, through
  `person_id in (select person_id from time_entries where location_id = ?)`. `readTimeRecord` with
  a `locationId`: with `personId`, it reads `{ personId }`; without, it reads `{ presentAt: locationId }`;
  either way it returns `recordInPeriod(recordAtLocation(projectTimeRecord(entries, closures), locationId), period)`.
  With no `locationId` it behaves as today.

- [ ] **Step 1: Write the failing tests** in `record-reads.test.ts`. Two new cases:
  - "pairs a clock-out at another location with its clock-in and counts it there": in at `locationId`
    09:00, out at `second` 17:00, both on one node. `timeRecord({ period: january, locationId })` →
    sessions `[480]`, entries `["in", "out"]`. With `locationId: second` → no sessions, no entries.
    With `{ personId, locationId }` → the same as the location-only read.
  - In `record-closures.test.ts`, "freezes a session clocked out at another location in its
    clock-in location's closure": the same two entries, then close January at `locationId`. The
    closure's `snapshot.sessions` holds the 480-minute session and its `snapshot.entries` both rows;
    both rows carry `closedPeriodIds` with the closure.
  Expected: FAIL. Today the location read holds only the `in` and no session.
- [ ] **Step 2: Implement** `presentAt` and the new `readTimeRecord`. In `record-projection.ts`,
  build each closure's `current` as
  `recordInPeriod(recordAtLocation({ ...record, closures: [], closedPeriodImpacts: [] }, closure.locationId), closure.period)`.
  At :105, drop `row.entry.locationId === closure.locationId &&`: membership is `roots`, which
  now comes from the location view.
- [ ] **Step 3: Run** `pnpm --filter @waitron/workforce exec vitest run src/record-reads.test.ts src/record-closures.test.ts src/record-projection.test.ts src/record-read-budget.test.ts src/pay-period-closure.test.ts`.
  Expected: all pass. `record-read-budget.test.ts`'s row counts are unchanged, because its people
  work at one location. If one changes, STOP: the budget is a decided limit, not a fixture.
- [ ] **Step 4: Run the apps that read the record:**
  `pnpm --filter @waitron/server exec vitest run src/attendance-export-api.test.ts src/personal-data-time-record.test.ts src/management-hours-api.test.ts`.
  Expected: all pass. "builds no files for a person whose only entries are at another location"
  still holds: no session at this location, and no entry of theirs falls in one.
- [ ] **Step 5: Commit** — "Count a work session at its clock-in's location in the period record
  and its closures".

### Task 7: Closing a pay period, the hours screen and planned-versus-actual

**Files:**
- Modify: `packages/workforce/src/pay-period-close.ts:112-136` (read `{ presentAt }`; both
  `recordInPeriod(projectTimeRecord(…))` calls wrap the projection in `recordAtLocation(…, input.locationId)`)
- Modify: `packages/workforce/src/hours-reads.ts:98-140` (`personInWindow`)
- Modify: `packages/workforce/src/clocking.ts:224-234`, `:269-271` (`getPlannedVsActual`, `entriesForLocation`)
- Test: `pay-period-closure.test.ts`, `hours-reads.test.ts`, `planned-vs-actual.test.ts`

**Interfaces:**
- Consumes: `presentAt`, `recordAtLocation` (Tasks 5–6).

- [ ] **Step 1: Write the failing tests.**
  - `pay-period-closure.test.ts`, "closes a session clocked out at another location in its clock-in
    location's period": in A 09:00 and out B 17:00 (an automatic out at B, for the marker path).
    `closePayPeriod` at A → the snapshot has the 480-minute session. At B → no sessions.
  - `hours-reads.test.ts`, "shows a shift begun here and continued elsewhere as one":
    in A 09:00, break_start B 12:00 → `readPersonHours({ locationId: A, … })` has one open shift
    whose `breakStart` is the B entry, and at B there is no open shift. Then break_end B 12:30 and
    out B 17:00 → A's day has one session of 450 worked minutes, and B's has none.
  - `planned-vs-actual.test.ts`: a shift planned at A 09:00–17:00, in A 09:00, out B 17:00 →
    A's comparison shows the shift worked, not missed.
  Expected: FAIL.
- [ ] **Step 2: Implement.** In `personInWindow`, read `entries` by `{ personId }`. Filter
  `openShiftsFor(entries)` to `s.start.locationId === locationId`, and build `fullRecord` as
  `recordAtLocation(projectTimeRecord(entries), locationId)`. `entriesForLocation` reads
  `{ presentAt: locationId }`, and `getPlannedVsActual` filters sessions to
  `s.locationId === query.locationId` as well as the period.
- [ ] **Step 3: Run** `pnpm --filter @waitron/workforce exec vitest run src/pay-period-closure.test.ts src/pay-period-configuration.test.ts src/hours-reads.test.ts src/planned-vs-actual.test.ts src/scheduling.test.ts`.
  Expected: all pass. That includes `scheduling.test.ts:948` ("another location's published shifts
  and entries do not leak in") and `hours-reads.test.ts:419` ("never leaks another person or
  location…"), unedited.
- [ ] **Step 4: Commit** — "Close pay periods and read hours with sessions paired across locations".

### Task 8: The end-of-day pass and its automatic clock-out

**Files:**
- Modify: `packages/workforce/src/end-of-day.ts:250-348`
- Modify: `packages/workforce/src/automatic-entries.ts:42-87` (`recordAutomaticClose`)
- Test: `end-of-day.test.ts`, `automatic-entries.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `automatic-entries.test.ts`, "closes a shift begun here whose latest entry was made elsewhere":
    in A 09:00, break_start B 12:00, break_end B 12:30. `recordAutomaticClose({ locationId: A, openEntryId: <the in>, at: 16:00 })`
    → resolves. The new `out` is stored with `location_id` A, and the A view's session is 390
    minutes. Today it is refused `attendance.not_pending`, because `live.at(-1)` is at B.
  - Control: `recordAutomaticClose` with `locationId: B` for that `in` → `attendance.not_pending`
    (the clock-in is not at B; this is kept).
  - `end-of-day.test.ts`, "closes the day's open shift whose break was taken at another location":
    the same entries plus an order fact at A at 16:40. Processing A's day appends an automatic out
    at 16:40 at A, and processing B's day appends nothing.
  Expected: FAIL.
- [ ] **Step 2: Implement.** In `recordAutomaticClose`, keep `open.locationId !== input.locationId`
  and drop `live.at(-1)!.locationId !== input.locationId`. `effectiveLatest` loses its location
  filter, and `afterEntries` reads `{ personId }`. The session lookup by `endedAt` is unchanged. In
  `end-of-day.ts`, `effective` loses its location filter, `breaks` loses
  `e.locationId === day.locationId`, and `canClose` loses `liveLatest.locationId === day.locationId`.
  `intervals` keeps `i.start.locationId === day.locationId` (D4).
- [ ] **Step 3: Run** `pnpm --filter @waitron/workforce exec vitest run src/end-of-day.test.ts src/end-of-day.targeted.test.ts src/end-of-day.obligations.test.ts src/end-of-day.concurrency.test.ts src/automatic-entries.test.ts`.
  Expected: all pass. "excludes another person, another location and both sides of the business-day
  window" (`end-of-day.test.ts:85`) is unedited: its other-location FACT still belongs to the
  other location.
- [ ] **Step 4: Deletion control:** put back `liveLatest.locationId === day.locationId` → the
  end-of-day case fails. Revert.
- [ ] **Step 5: Commit** — "Close a shift at the end of its clock-in's day wherever its last entry
  was made".

### Task 9: A missing-entry request pairs with its counterpart at any location

**Files:**
- Modify: `packages/workforce/src/corrections.ts:224-238` (drop `e.locationId === change.locationId`
  from the pending-counterpart filter)
- Test: `packages/workforce/src/correction-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test** "accepts a missing clock-out at another location whose
  missing clock-in is still waiting": in A 09:00, out A 12:00 (direct). A worker requests a missing
  `in` at A 13:00 (pending), then a missing `out` at B 17:00 → accepted. Today it is refused
  `correction.invalid` `unmatched_out`. Control (passes before and after): the same `out` request
  with no pending `in` → refused `unmatched_out`.
- [ ] **Step 2: Implement.** Leave `assertDecisionPair` (:136), `correctionGroupCanApply` (:161,
  :166, :180) and `sameSubject` alone: a request group is written at one location, and an answer
  belongs to its target's location (D5).
- [ ] **Step 3: Run** `pnpm --filter @waitron/workforce exec vitest run src/correction-lifecycle.test.ts src/corrections.test.ts src/correction-groups.test.ts src/attendance-response-commands.test.ts src/attendance-responses.test.ts`.
  Expected: all pass.
- [ ] **Step 4: Commit** — "Let a missing clock-out pair with a waiting clock-in at another location".

Then run `pnpm --filter @waitron/workforce exec vitest run` (whole package) once before Task 10.

### Task 10: The till's clock routes stop refusing another location's shift

**Files:**
- Modify: `apps/server/src/till-clock-api.ts:152-157` (delete the `activeLocationId` refusal in `writeClock`)
- Modify: `apps/server/src/till-clock-state.ts:43-56` (`firstClockIn` drops
  `eq(timeEntries.locationId, scope.locationId)`; the day stays `scope.locationId`'s)
- Modify: `apps/server/src/attendance-discovery.ts:31-52` (open question 3's default)
- Test: `apps/server/src/till-clock-api.test.ts`, `till-clock-state.test.ts`, `attendance-discovery.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Flip `till-clock-api.test.ts:92` as the table says.
  - `till-clock-state.test.ts`, "counts today's clock-in at another location as the first": clock in
    at `other` today, out at `other`, then `read()` at the box location → `firstClockIn: false`.
    Today it is `true`.
  - `attendance-discovery.test.ts`, "reconciles the day of a shift begun at another location before
    clocking out here": open shift at `otherLocation` from yesterday 18:00, whose day has ended.
    `reconcileAttendanceBeforeClock` at the box location → returns `null`, and an
    `attendance_day_work` row exists for (`otherLocation`, yesterday). Today it returns the state
    and enqueues nothing.
  Run `pnpm --filter @waitron/server exec vitest run src/till-clock-api.test.ts src/till-clock-state.test.ts src/attendance-discovery.test.ts`.
  Expected: FAIL in those three.
- [ ] **Step 2: Implement.** In `reconcileAttendanceBeforeClock`, return early only when
  `state.state === "out"`. Use `start.locationId` for `readLocationClock`, for `day.locationId`, for
  the saved-work lookup, and as the `locationId` handed to `reconcileAttendanceDay`. `admit` (:71-84)
  is unchanged.
- [ ] **Step 3: Run** those three plus `src/till-clock-step.test.ts src/till-clock-attendance.test.ts src/till-attendance-api.test.ts`.
  Expected: all pass. `till-clock-step.test.ts:99`'s control is unedited: it still reads `working`
  at the other location.
- [ ] **Step 4: Deletion control:** restore the `writeClock` refusal → the flipped
  `till-clock-api` case fails. Revert.
- [ ] **Step 5: Commit** — "Let the till clock out or break a shift begun at another location".

### Task 11: The till drops "Your open shift belongs to another location"

**Files:**
- Modify: `apps/till/src/widgets/till-shell.ts:1102-1121` (`foreign` goes; `disabled` is
  `this.clockBusy || state === null`)
- Modify: `apps/till/src/i18n/strings.ts:231-232` (EN) and `:2100` (ES): delete `clock.other_location`
- Test: `apps/till/src/widgets/till-shell.test.ts:122-153`

- [ ] **Step 1: Split and flip the test** as the table says. The new case's state is
  `{ state: "working", activeLocationId: "another-venue", locationId: "venue", … }`. Expect
  `[data-clock-action]` not to be `disabled`, and `el.shadowRoot!.textContent` not to contain
  "another location". Check headroom (`memory_pressure | grep free`), then run
  `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts`. Expected: the new
  case FAILS.
- [ ] **Step 2: Implement.** Delete the key from both catalogues, since `es` is
  `Record<StringKey, string>` (`strings.ts:1868`). Run
  `/usr/bin/grep -rn "other_location" apps packages --include='*.ts'` and expect no output.
- [ ] **Step 3: Run** `pnpm --filter @waitron/till typecheck` and
  `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.test.ts src/i18n/strings.test.ts src/widgets/till-shell.a11y.test.ts`.
  Expected: all pass.
- [ ] **Step 4: Commit** — "The till no longer blocks clock actions for a shift begun at another
  location".

### Task 12: PR 2's docs and backlog

**Files:**
- Modify: the workforce spec. After PR 1's pointer, add "> **2026-11-01 — clock state and sessions
  per venue (A1268 PR 2).** A person has one clock state across the venue, and a work session pairs
  their entries wherever each was made; a per-location view counts it at its clock-in's location."
- Modify: `docs/backlog.md` — delete the A1268 entry (:5232). In the same area add
  "**A1268 part 2: pair a person's entries by write order after a backward clock step.**
  [Detail](backlog/box.md#a1268-part-2-pair-a-persons-entries-by-write-order-after-a-backward-clock-step)",
  and the `activeLocationId` line held back from Task 4.
- Modify: `docs/backlog/box.md` — replace the A1268 section with
  "## A1268 part 2: pair a person's entries by write order after a backward clock step." Carry its
  second half (the hours read, `intervalsFor` and `validateSequence` still order by
  `compareEvents`; `unmatched_out` until a retime; read, not run, except the retime), and point at
  design §4 for the rule and at "its own plan" for the build.
- Modify: this plan's header: a `Status` line once PR 2 is open.

- [ ] **Step 1: Make the edits.** The anchor must match the new heading. Run
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 2: Commit** — "docs: A1268's clock state and sessions are per venue; part 2 stays in
  the backlog".

Then `/finish-branch`. Risk trigger: none of the listed ones (no migration, no grants, no fiscal
code). It touches the legal working-time record's readings, so ask for the full path anyway, and
say so in the note.

---

## Self-review notes

- **Spec coverage.** D1 → Task 3. D2 → Task 3's rehearsal test and the PR's first line. D3's read →
  Task 3; D3's till → Tasks 10–11. D4 → Tasks 5–9. D5 → kept, with Global Constraints and Task 9
  Step 2 naming what stays. D6 → Task 2 and Task 3's `chainScope`. D7 → Task 10. Docs → Tasks 4
  and 12. Guides: none, with the grep receipt.
- **Names used across tasks:** `TimeEntryAppend.locationId` (T1), `chainScope`/`closureScope` (T2),
  `ChainKey { nodeId }` (T3), `SessionWindow`/`sessionWindows`/`recordAtLocation` (T5), `presentAt`
  (T6).

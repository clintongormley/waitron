# A773-2 PR D: course headings on kitchen tickets, "Goes with kitchen food", and the retired pass storage — task plan

**Goal.** PRs A to C (#2381 … #2445) finished the waiter's request, the pass's **Fire**, the pass and
station boards and the station setting "Waits for the pass". Two things remain. First, kitchen paper
names a group only by its number (`GROUP 3`), and nothing tells a station that does not wait for the
pass that its dishes belong with food the pass has not fired yet. PR D makes every group heading on
kitchen paper name the group's courses (`GROUP 3 · MAINS`), and prints and shows "Goes with kitchen
food" on such a station's ticket and screen card (spec §5, §6, pictures 7 and 8). Second, two
storage items no code reads any more are dropped: the column `ticket_items.away_at` (the old Away
stamp) and the table `pass_item_marks` (the old per-device Done marks). The third retired item,
`locations.fire_control`, stays where it is: dropping it would rebuild `locations`, a table A1301
drops whole in its slice S28 (D113).

**Words used here.** *Group heading*: the line `GROUP n …` kitchen paper prints above a group's
dishes (`emitGroup`, `apps/server/src/kitchen-ticket.ts:265-277`). *Pass-controlled dish*: a ticket
item whose `pass_controlled` flag is true, frozen when the waiter asked for it at a station that
waits for the pass (`requestStamps`, `apps/server/src/kitchen-release.ts:23-36`). *The cue*: the
words "Goes with kitchen food". *Pin*: a test of behaviour that is already right; every pin names
the mutation that turns it red.

**Implements.** The [master plan](2026-10-19-a773-2-firing-and-pass.md)'s Tasks 11 and 12 and its
PR D row ("Working PR boundaries"), under its Global Constraints, Review Focus 5 and Shared
verification contract (S, G, LOOK); the [spec](../specs/2026-10-16-a773-courses-and-groups-design.md)
§5 ("One group, several stations"), §6, §8, §9 ("`away_at` and the pass's Done marks go …
`locations.fire_control` goes") and §13; the A803 [spec](../specs/2026-10-18-a803-bills-and-tables-design.md)
§§3.2–3.3 and §6 and its [plan's dependency tail](2026-10-19-a803-bills-and-tables.md) ("Dependency
tail: A773-2 station modes, pass and shared fire tickets"). Decisions continue PR C's numbering at
D112.

**Researched at** `69534cec83` (main, 2026-11-04; PR C landed as #2445). Every file, line and
signature below was read at that commit; four probes were run (P1–P4 in "What the planning pass
found") and reverted (`git status --short` printed nothing after each). Implementers find code by
function name, never by line alone.

**No location (owner, 2026-11-01, A1301; high priority).** Nothing here adds a `location_id`
column, a `locationId` parameter, or a per-location rule, setting, fixture or translation. The new
reads join `kitchen_courses` and `kitchen_stations` by id only and never name their `location_id`
columns (A1301 S24 drops those). Existing `cfg` parameters stay for A1301 S18 to remove.

**English only.** Spanish appears only in `apps/server/src/i18n/kitchen-ticket.ts`'s `es` block, the
till's `apps/till/src/i18n/strings.ts` Spanish block and `apps/server/src/guide/es/` (catalogues
the English-only guard exempts). Tests read Spanish from those files.

**Fiscal.** No task touches money, invoices, numbering, the hash chain or `adjustments-apply.ts`.
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `src/inmutabilidad.test.ts` are never
edited and run unedited after each schema task and in the final task.

**Migrations: two, in the core set, expected with no venue reset.** Task 8 drops `pass_item_marks`
and Task 9 drops `ticket_items.away_at`; drizzle-kit writes a plain `DROP TABLE` and a plain
`ALTER TABLE … DROP COLUMN`, not a table rebuild (P1). Whether a venue must be reset is decided by
`scripts/migration-upgrade.test.ts`, which steps a database holding rows in every table through each
migration with the change feed installed in between (`:184-215`, `:217-330`). If either step fails
there, the task stops (master S: "An unsafe parent rebuild or failing preservation guard blocks that
schema PR"); it never gains a `RESETS` entry without a new plan revision. The PR's first line says
which, from that run.

**Execution.** Every implementer is dispatched as `subagent_type: "implementer"` (medium effort),
one task per dispatch, in this worktree. An implementer that passes about 150 calls with the task
unfinished stops at a passing or cleanly red point, commits, and hands over (done, left, files, each
check's state). Each task ends with the touched packages' `typecheck` clean, its focused suites
green, `pnpm format:check` clean, and a signed commit (`git commit -s`, explicit paths staged,
`git diff --cached --check`). **Till suites run in real headless Chromium: measure free memory first
(`memory_pressure | grep free`) and run named files, never a whole package.**

**The test-change rule (owner, 2026-10-05).** Adding fixture fields or rows is fine. An existing
check may change only where this plan deliberately changes the behaviour it pins, and is then listed
in "Changed test checks". Any other change to an existing assertion is a **stop** to flag, never made.
Two guards under `scripts/` lose rows naming the dropped table (Changed test checks); no other guard
is edited. Prefer a new case to an edit. New cases carry `A773 fire paper` (Tasks 1–3) or `A773
retired storage` (Tasks 6–9) in their title so RED commands can select them with `-t`.

**Review weight: FULL.** Two migrations, and a cross-package contract (the station queue's group
shape between the server and the till). Per-task reviews, the fresh-context plan review, and
`/finish-branch`'s full wave with two Codex run-it reviews (the second told to set the checklist
aside).

## What the planning pass found (at `69534cec83`)

1. **No runtime code reads the retired storage any more; only the schema and tests name it.** The
   master's audit search, `rg -n 'firedAt|fired_at|awayAt|away_at|passItemMarks|pass_item_marks|fireControl|fire_control|fireHeldGroupsOfCourse|fireCourse' apps packages scripts docs`,
   narrowed to the retired names and to files that are not tests, drizzle output or fixtures
   (`rg -l 'awayAt|away_at|enRoute|en_route|passItemMarks|pass_item_marks|PassItemMark|fireControl|fire_control|FireControl|fireControlMode|fireHeldGroupsOfCourse|fireCourse|pass-item-marks' apps packages scripts | rg -v '\.test\.|/drizzle/|test-fixtures|/testing/|/test/'`),
   lists only: `packages/db/src/schema/ticket-items.ts:67` (`awayAt: tsString("away_at")`),
   `packages/db/src/schema/pass-item-marks.ts` (the table), its exports
   (`packages/db/src/schema/index.ts:34`, `packages/db/src/index.ts:173`), its classification
   (`packages/db/src/classification.ts:139-143`, `classify("pass_item_marks", "state", …)`), `packages/db/mutation-costs.json:72`,
   `packages/db/src/schema/tenants.ts:26-32,86,100` (`fireControlMode`, the column, its CHECK), and
   two false matches: `apps/server/src/kitchen-print.ts:457` (`KitchenRoute` contains `enRoute`) and
   `apps/till/src/screens/till-table-order-screen.current-orders.test-helpers.ts:69` (an old
   payload key in a till fixture, not the column). `fireCourse` and `fireHeldGroupsOfCourse` survive
   only in till tests asserting their absence (`apps/till/src/api/client.test.ts:1839`) or in mocks.
   Every `firedAt`/`fired_at` hit is live: since B1 it means "actually released to the station"
   (`apps/server/src/kitchen-phase.ts`), so none is retired. PRs A–C removed every runtime reader.

2. **Tests that write or read the retired storage.** `awayAt`/`away_at` in 26 server test files and
   `packages/db/src/schema/ticket-items.test.ts` (count per file in "Changed test checks");
   `passItemMarks`/`pass_item_marks` in `pass-board.test.ts`, `device-api.pass.test.ts`,
   `pass-lifetime.test.ts`, `station-outputs-down.test.ts`, `watchers.leave.test.ts`,
   `personal-data-actions.coverage.test.ts:57`, `packages/db/src/schema/pass-item-marks.test.ts` and
   `scripts/schema-constraints.test.ts:234-235`. They are controls of the kind "the old stamp or mark
   changes nothing" (for example `pass-board.test.ts:187` "legacy Done marks stay device-specific but
   never hide food from either pass"). The Done route already answers 404
   (`pass-board.test.ts:363-385`). The till's `enRoute` and `awayAt` mentions are payload keys the
   server no longer sends, typed `& { enRoute?: number }` in each test; they name no column and
   stay.

3. **P1: what drizzle-kit writes for each removal.** In this worktree, deleting the `awayAt` line
   from `ticket-items.ts` and the `pass-item-marks.js` export from `schema/index.ts`, then
   `cd packages/db && pnpm exec drizzle-kit generate --name exp_retire_pass_storage`, wrote
   `0205_exp_retire_pass_storage.sql` holding exactly `DROP TABLE \`pass_item_marks\`;` and
   `ALTER TABLE \`ticket_items\` DROP COLUMN \`away_at\`;`. No rebuild. Earlier column drops in this
   repo take the same plain form (`packages/db/drizzle/0167_retire_station_order.sql:1`,
   `0040_drop_order_group_added_later.sql:1`). Reverted (generated SQL and snapshot deleted,
   `git checkout -- packages/db`).

4. **P2: dropping `fire_control` rebuilds `locations`.** Removing the column and its CHECK from
   `tenants.ts` and generating wrote `PRAGMA foreign_keys=OFF; CREATE TABLE \`__new_locations\` …;
   INSERT INTO \`__new_locations\` … SELECT … FROM \`locations\`; DROP TABLE \`locations\`; ALTER
   TABLE \`__new_locations\` RENAME TO \`locations\`; PRAGMA foreign_keys=ON;` Reverted. A rebuild
   runs with foreign keys on (CLAUDE.md §3), and `locations` has 37 child tables, none cascading
   (A1301 design `docs/superpowers/specs/2026-11-01-a1301-remove-location-design.md` §4, `:363`), so
   its `DROP TABLE` would be refused on any box that holds a child row. `tenants.ts:20-24` already
   leaves `bump_mode` in place for the same reason. A1301's plan drops the whole table: S23 moves the
   venue's settings into `venue_settings` without `fire_control` (design §2.1 table, `:136`: "deleted,
   unused … Whichever lands first does it; the other drops the step"), and S28 runs a plain
   `DROP TABLE locations` once nothing points at it (`:625`). Lane A's S18a worktree
   (`refactor/a1301-s18a-venue-service-scope`, at `d8f2848689`) has no commits and no changes yet.

5. **The configuration copy carries none of the three.** `rg -n 'ticket_items|pass_item_marks|away_at|fire_control' packages/*/src/configuration-transfer*.ts packages/provisioning/src/*.ts`
   outside tests prints nothing (exit 1). A1301 S17 (#2415) already removed `fireControl` from the
   copy and moved the format to 10 (`packages/provisioning/src/configuration-transfer.ts:119,151,464-467`;
   `docs/developers/conventions-data.md:1711-1722`). The format moves only when a carried table or a
   required key changes (same lines), so PR D moves nothing. The master's "format 4 → 5" is stale.

6. **Where triggers could stop the drops.** No migration's trigger body names `ticket_items` or
   `pass_item_marks` (`grep -l 'CREATE TRIGGER' packages/*/drizzle/*.sql | xargs grep -l ticket_items`
   prints nothing), and no source file that generates triggers names `ticket_items`. The change
   feed's update trigger names every column of a source table, and SQLite refuses to drop a column a
   trigger names (`packages/db/src/change-feed.ts:136-150`), but migrating removes the feed first
   (`packages/migrations/src/apply.ts:80`) and boot reinstalls it. `ticket_items` is classified
   `ledger` (`classification.ts:36`), not append-only. Inbound keys to `ticket_items`:
   `pass_item_marks` (dropped here), `watcher_item_marks` (`packages/db/drizzle/0071_watchers.sql:46`),
   `ticket_item_allergies` (`packages/venue-service/drizzle/0063_kitchen_allergy_copies.sql:5`); a
   `DROP COLUMN` does not rebuild the table, so none of them is touched. Nothing points at
   `pass_item_marks`.

7. **Kitchen paper prints `GROUP n` and, for a reused number, the origin tables, but never a
   course.** `emitGroup` prints `${words.group} ${item.group}${label}` where `label` is
   `" · " + groupLabel` (`kitchen-ticket.ts:265-277`); `groupLabel` is set only when two groups of a
   merged party share a display number, to the origin party's table names (`readGroupNumberLabels`,
   `apps/server/src/order-groups.ts:2477-2517`, used at `kitchen-print.ts:233-235,328-330`).
   `buildTicketItems` (`kitchen-print.ts:173-345`) reads no course. A ticket whose items share one
   group names it once under the header; otherwise each group's run is headed
   (`formatKitchenTicket`, `:345-410`). The same `emitGroup` heads groups on correction slips
   (`:509-523`), kitchen-note slips (`:559-580`) and MOVED slips (`:616-645`). The words are
   `GROUP`/`GRUPO` (`apps/server/src/i18n/kitchen-ticket.ts:25,62`).

8. **The station screen already names a group and its course; it has no cue.** The card head draws
   the group's name and, when the card's dishes share one course, that course's name
   (`apps/till/src/widgets/station-queue.ts:1240-1290`, `groupName(group)`, `sharedCourse.name`),
   which is picture 7's "T4 · Group 4 · Desserts". The server's `QueueGroup` carries
   `id, position, displayNumber, numberPartyId, numberPartyLabel?, state`
   (`apps/server/src/working-order.ts:7860-7867`; client twin `apps/till/src/api/client.ts:1550-1557`),
   built per row by the helper at `working-order.ts:8120-8145` inside `listStationQueues`
   (`:8235-…`), the one read behind the till's station screen and a kitchen display
   (`device-api.ts` `listStationQueues` import). Course names on the screen come from
   `kitchen_courses.name` joined by `ticket_items.course_id`, not filtered by `active`
   (`working-order.ts` `listStationQueues`, "a course deleted after the item was fired still names
   its header").

9. **The pictures.** Picture 8 (recovered from `git show 3ef533f4fe^:docs/backlog/mockups/a773-courses-and-groups/08-tickets.png`
   to `/tmp`, not committed) shows a Grill HOLD ticket headed `GROUP 3 · MAINS` and a Bar ticket
   headed `GROUP 4 · DESSERTS` with the line `Goes with kitchen food` under the heading, above the
   dishes, in normal case. Picture 7 shows the Bar card "T4 · Group 4 · Desserts / 2 × Moscatel /
   Goes with kitchen food", the cue in muted text under the dishes. The spec says text wins over
   pictures; the text (§5, §6) agrees with both.

10. **P3: which existing paper pins change when headings carry courses.** With a scratch change to
    `buildTicketItems` (join `kitchen_courses` on the item's `course_id` and append the upper-cased
    course name to `groupLabel`), `pnpm --filter @waitron/server exec vitest run` over
    `order-groups.test.ts kitchen-request.hold-paper.test.ts print-problems.test.ts kitchen-print.test.ts adjustments-extra-cancel.test.ts kitchen-request.alerts.test.ts kitchen-ticket.test.ts kitchen-ticket.kitchen-note.test.ts kitchen-ticket.language.test.ts kitchen-print.shared-printers.test.ts kitchen-print.concurrency.test.ts pass-release.test.ts`
    gave `Tests 34 failed | 623 passed (657)`, every failure in `order-groups.test.ts` (listed in
    "Changed test checks"), each a heading line now reading for example `GROUP 1 · DRINKS` where the
    pin says `GROUP 1`. The other eleven files' fixtures print no course on a heading. Reverted.
    Fifty server test files read paper text (`grep -rlE 'GROUP|GRUPO|decodeTicket|ticketText|paperText' apps/server/src apps/server/scripts --include='*.test.ts'`);
    P3 ran the twelve most likely. Task 1b re-runs the rest before editing anything.

11. **The waiter's group Fire prints bill by bill.** `releaseGroup` (`order-groups.ts:853-909`)
    loops over the group's bills and calls `fireOrderLines` for each (`:876-878`); each bill's
    release stamps its own items (`requestHeldItems`, `kitchen-release.ts:44-82`) and enqueues its
    own tickets (`finishRelease`, `working-order.ts`, `enqueueKitchenTickets(… ordinary, { fire })`).
    So when Bill 1's Bar ticket prints, Bill 2's Grill items in the same group may still be held,
    with `pass_controlled` false. A cue rule that reads only `pass_controlled` would miss them; D117
    reads held items' current station setting as well.

12. **A live dish has one predicate.** `liveKitchenDish()` (`working-order.ts:8474-8493`), used by
    the pass board's `scopedItems` (`apps/server/src/pass-board.ts:165-206`) and PR C's coverage read.

13. **Madrid baseline.** `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` compares the
    demo seed with a frozen capture whose bytes are hash-pinned
    (`packages/country-es/test-fixtures/demo/madrid-before-move.*.json`, manifest at `d5c7ccb1a7`).
    Schema changes since the capture are applied to the expected side in the test: `REMOVED_TABLES`
    (`:36`), the `parties.main_bill_id` filter (`:163-165`), added columns (`:198-234`). The capture
    holds `pass_item_marks` and `ticket_items.away_at` with zero rows in every phase (manifest
    `phases`, read with a Python one-liner). The fixture files are never edited.

14. **Guards that name the table.** `scripts/schema-constraints.test.ts:234-235` lists
    `pass_item_marks`' two foreign keys as required; `apps/server/src/personal-data-actions.coverage.test.ts:57`
    lists `pass_item_marks.done_by_person_id` as an actor column not yet covered, and its case
    "classifies every actor column in the core schema exactly once" (`:184`) holds the list equal to
    the schema's. `packages/db/mutation-costs.json:72` names `src/schema/pass-item-marks.ts`, and
    `scripts/mutation-shard.test.mjs`' cost-table cases require every named file to be mutated.

15. **The words.** The spec's own text says the ticket and screen "say 'Goes with kitchen food'"
    (§5), an owner decision, so the English is approved. Its Spanish is not: the master's copy section
    lists «Sale con la comida de cocina» as proposed (`2026-10-19-a773-2-firing-and-pass.md:59`), the
    owner's 2026-11-02 copy sheet (B3's Question 1, `~/waitron-campaign-c/questions.md:1124-1160`)
    does not include it, and `grep -n 'Sale con\|Goes with kitchen' ~/waitron-campaign-c/questions.md`
    finds nothing. The heading adds no word: `GROUP`/`GRUPO` exists and course names are the venue's
    own.

16. **A803 has built nothing on tickets that PR D touches.** A803 slices 1–4a landed (portions,
    named bills, the bill switcher, the dish picker; `docs/backlog/till.md` "A803" entry). Its ticket
    work is portion folding in `kitchen-print.ts` (`readWholePortionLines`, `foldWholePortions`,
    `:660-760`); its station ticket modes, bill names on tickets and one cross-bill ticket per action
    wait for A773-2 (A803 spec §6 "Slices touching the pass and the station settings wait for
    A773-2"; plan dependency tail). A kitchen print job still belongs to one bill
    (`kitchen_print_jobs.working_order_id`, `linkKitchenJob`, `kitchen-print.ts:841-851`).

17. **Other branches.** `feat/a802-partial-invoice-correction` adds core migrations numbered
    `0205` and `0206`; whichever of it and this PR lands second regenerates (CLAUDE.md §3). A1301's
    S18b plan removes the ignored `_cfg` of `orderTableLabel` (`kitchen-print.ts:403`,
    `docs/superpowers/plans/2026-11-04-a1301-s18-contract-cleanup.md:580`); PR D does not touch that
    function. No other worktree's branch changes `kitchen-ticket.ts`, `kitchen-print.ts`,
    `station-queue.ts`, `ticket-items.ts` or `pass-item-marks.ts` (`git diff --name-only main...<branch>`
    over every `git worktree list` branch).

18. **Backlog.** `docs/backlog.md:88-98` (Ordered work item 1) and `:2474-2479` (A773-2 entry) and
    `docs/backlog/till.md:2506-2560` say PR D is next and name its three items; `docs/backlog/kitchen.md:291`
    and `docs/backlog/architecture.md:1080` say A773-2 removes `fire_control`, which D113 changes.
    `docs/backlog.md:2584-2588` keeps "a station waits for another station's part" for later.

## Scope

**In PR D.** Course names on every group heading kitchen paper prints; the cue on the FIRE paper of
a station that does not wait for the pass and on its station card; the guide; an A803 handoff note;
dropping `pass_item_marks` and `ticket_items.away_at` with their tests; prose that named them.

**Out.** Dropping `locations.fire_control` and its enum (A1301 S28, D113). Any configuration-copy
format change (finding 5). The pass board and the waiter's table screen (D126). A803's bill names on
tickets, station ticket modes and one cross-bill ticket per action (D124). The cue on counter orders
(D120). The till fixtures that still pass a `fireControl` prop (backlog point, Task 10).

## Decisions

- **D112 No location.** As stated above.

- **D113 `fire_control` stays for A1301 S28.** Dropping it rebuilds `locations` (P2), the rebuild
  A1301 avoided in S23 for the same reason (design §2.1, "cutting it to its id in S23 would mean an
  extra rebuild of a table 37 others point at"), and S28's plain `DROP TABLE locations` takes the
  column, its CHECK and, with the schema line, `fireControlMode`. Doing it here would duplicate that
  slice's work through the riskier rebuild. Under A1301 design note 9 ("Whichever lands second drops
  its removal step") PR D is the one that drops its step. Task 10 rewrites `tenants.ts`'s doc comment
  on `fireControlMode` to say what `bumpMode`'s says (read by nothing; S28's drop of `locations`
  removes it), and leaves a dated pointer in the A1301 design and backlog so S28 also deletes the
  tests that still set it (`packages/db/src/schema/kitchen-courses.test.ts:128-161`,
  `apps/server/src/order-groups.test.ts:5961-5973`, `management-api.test.ts:3035-3059`,
  `till-api.test.ts:1634-1643`, `configuration-import.test.ts:97`,
  `packages/provisioning/src/configuration-transfer.boundaries.test.ts:475`). They pass today and
  stay unchanged here.

- **D114 No configuration-copy format change.** Finding 5.

- **D115 The heading names the courses of its dishes.** Every group heading on kitchen paper reads
  `GROUP n[ · <origin tables>][ · <COURSES>]`: today's number and origin label unchanged, then, when
  any dish under that heading has a course, ` · ` and the distinct course names of the dishes under
  that heading on that paper, ordered by `kitchen_courses.display_order`, then name, joined by `, `
  (`GROUP 3 · STARTERS, MAINS`). A dish with no course adds nothing; a group whose dishes have none
  prints today's heading. Names are upper-cased with `toLocaleUpperCase` in the paper's kitchen
  language, as the late-send mark is (`emitLateMark`, `kitchen-ticket.ts:279-288`), because picture
  8 prints `MAINS` for the course Mains. "Under that heading on that paper" means every item with
  the same group key (`groupKey`, `:254-256`) anywhere on the paper, so a shared-printer ticket that
  heads a group once (`onlyGroupOf`) names every course the group has on it. This applies to every
  paper `emitGroup` heads: FIRE and HOLD tickets, reprints, correction slips, kitchen-note slips and
  MOVED slips (picture 8 heads a HOLD ticket this way). The course name is read when the paper is
  planned, from the dish's ticket item (`ticket_items.course_id` → `kitchen_courses`, not filtered
  by `active`, as the station screen reads it), and frozen in the bytes. The number stays the
  group's permanent display number, never its position (master Interfaces).

- **D116 Where the course travels.** `KitchenTicketItem` gains `course?: { name: string; order:
  number }`, set by `buildTicketItems` for a dish whose ticket item has a course. The formatter
  computes each group's course list from the paper's items (a pure helper in `kitchen-ticket.ts`),
  never from the database. `entryKey` (`:88-108`) gains the course name, so two otherwise identical
  dishes of different courses in one group never merge and lose a course from the heading.
  Correction slips build their items by spreading the same `buildTicketItems` entry and overriding
  only `group` and `groupLabel` (`kitchen-print.ts:1318-1335`, `:1380-1394`), so `course` travels
  with the dish; when a slip heads a dish under the group it left (`target.group`), the heading
  still names the dish's own course. Task 1a's case 8 and P3's slip pins confirm each path.

- **D117 Which groups have kitchen food at the pass.** One server function,
  `groupsWithPassFood(tx: Transaction, groupIds: readonly string[]): Promise<ReadonlySet<string>>`
  in `apps/server/src/kitchen-release.ts`, one query whatever the number of groups. A group is in
  the answer when, among its live dishes (`liveKitchenDish()`, joined through
  `working_order_lines.group_id`, across every bill of the party), at least one ticket item either
  has `pass_controlled` true, or has not been asked for yet (`requested_at` null) and sits at a
  station whose `waits_for_pass` is true now. The first half is the frozen fact for dishes already
  asked for (master Contract 10); the second is the current setting for held ones, as the pass board
  classifies held previews (same contract), and it is what makes Bill 1's Bar ticket see Bill 2's
  still-held Grill dish (finding 11). This is the spec's "the same group has lines at a station that
  waits for the pass", read literally: a held group fired one dish at a time keeps the cue while its
  waiting station's dishes are still held, because those dishes still go with it.

- **D118 The cue on paper.** A dish on a station ticket carries `goesWithKitchenFood: true` when its
  group is in D117's answer, its own ticket item is not pass-controlled and not made here, and the
  ticket is not a HOLD ticket (`mark !== "HOLD"`). The formatter prints the cue once per group
  heading whose run holds such a dish, on its own line directly under the heading (picture 8), in
  the paper's kitchen language, normal case. With one shared group heading under the header, the
  cue prints once under it. Correction, kitchen-note and MOVED slips never print it (they describe a
  change, not a send). A reprint plans its paper afresh (`planKitchenTickets(… { reprint: true })`)
  and so recomputes both heading and cue: a reprint shows the group's courses and cue as they are at
  the reprint. A dish the pass releases is pass-controlled, so the pass's release ticket never
  carries the cue. `entryKey` gains the flag. Words: `goesWithKitchenFood` in
  `KITCHEN_TICKET_WORDS`, English "Goes with kitchen food", Spanish per Owner question 1.

- **D119 The cue on the station screen.** The server's `QueueGroup` gains `goesWithKitchenFood?:
  true`, present only when the group is in D117's answer (absent when not, as `numberPartyLabel` is,
  so no existing whole-shape pin changes), computed once per `listStationQueues` call for all its
  groups. The till's `QueueGroup` twin gains the same optional key. A station card draws the cue as a
  muted line under its dishes (picture 7) when its group carries the key and at least one of the
  card's dishes is released (phase `waiting`, `preparing` or `ready`) and not pass-controlled. A held
  card, and a card all of whose dishes are pass-controlled (a Grill card), draws nothing. New till
  string `station.goes_with_kitchen_food`, English "Goes with kitchen food", Spanish per Owner
  question 1. The line uses existing text tokens (`--wt-color-text-muted` or whatever the card's
  `.held-note` uses, read at implementation).

- **D120 Counter orders and bills with no party get no heading and no cue.** They have no group
  (spec §8 "No courses and no groups"; `QueueGroup` absent "on a bill with no party"), and the cue is
  a group fact (§5 "the same group"). A counter order whose Bar drink goes with a Grill burger that
  waits for the pass prints no cue. Recorded as a backlog question (Task 11), not built.

- **D121 Retiring `pass_item_marks`.** Schema file, its test, both exports, its classification
  entry and its `mutation-costs.json` entry go; one generation (`0205_retire_pass_item_marks` or the
  next free number) writes `DROP TABLE`. The two guard rows and the personal-data list entry go
  (Changed test checks). Every server test stops inserting or reading marks first (Task 6), so each
  commit is green.

- **D122 Retiring `ticket_items.away_at`.** The schema line and the db test's away case go; one
  generation writes `ALTER TABLE … DROP COLUMN`. Every server test stops writing or reading the
  column first (Tasks 7a, 7b). The Madrid baseline test filters `away_at` out of the captured
  `ticket_items` columns as it filters `parties.main_bill_id`, and adds `pass_item_marks` to
  `REMOVED_TABLES` (Tasks 8, 9). Neither fixture file is edited.

- **D123 How a test that wrote the retired storage changes.** (a) A write of `awayAt` or a marks
  row whose only purpose was to prove the stamp or mark changes nothing is deleted with the
  assertions that read the stamp or mark; every other assertion in the case stays byte for byte.
  (b) A select of `ticketItems.awayAt` loses that key, and each expected object loses the matching
  `awayAt` key; no other value changes. (c) An assertion that an API answer has no `awayAt`
  (`not.toHaveProperty("awayAt")`, e.g. `till-api.courses.test.ts:674,696`) stays: it checks the
  answer, not the column. (d) A case whose title and every remaining assertion only described the old
  stamp or mark, so that after (a) it asserts nothing another case in the same file does not, is
  deleted and named in the task report; any other case keeps its title, or loses only the words
  "legacy Away" / "legacy Done" from it. The implementer lists each case touched, with which of
  (a)–(d) applied, in the task report; Task 11 copies them into "Changed test checks".

- **D124 The A803 handoff, documented not built.** PR D leaves one ticket per bill, per station.
  Task 4 appends a dated paragraph to the A803 plan's dependency tail naming the seams A803's
  cross-bill ticket will change: the per-bill loop in `releaseGroup` (`order-groups.ts`) and in
  `releasePassItems` (`pass-release.ts`), `planKitchenTickets`/`enqueueKitchenTickets`'s one-order
  signature and `linkKitchenJob`'s one `working_order_id`, `buildTicketItems` (where a bill name
  would join the item, beside `course` and `goesWithKitchenFood`), and that D115's course list and
  D117's group fact are already per group across bills, so a cross-bill ticket reuses them
  unchanged. The PR body carries the same list.

- **D125 Prose.** Current developer prose that names a retired item is updated in the same task
  that retires it (Task 10 for the remainder); historical specs and plans get dated pointers, never
  rewrites.

- **D126 The pass board and the table screen are unchanged.** The pass card already lists another
  station's part ("Already at {station}", B3 copy sheet), and the waiter's screen already shows "at
  the pass". The spec puts the cue on the station's ticket and screen only.

## Departures from the master plan

| Master (Tasks 11–12) | This plan | Why |
| --- | --- | --- |
| `KitchenTicketItem.groupCourseNames?: string[]` | `course?: { name; order }` per dish; the formatter derives each heading's list | the heading lists what is on that paper; one source per dish keeps slips and tickets alike (D115, D116) |
| "print the cue once per affected group/station section" when "same group has pass-waiting station work" | D117's rule: pass-controlled dishes, or held dishes at a station that waits now | bills print one at a time (finding 11) |
| "immediate Bar ticket/screen" | paper and the station card; pass board and table screen unchanged | spec §5 names ticket and screen of the station (D126) |
| Delete `locations.fire_control` and its enum/CHECK | stays for A1301 S28 | a `locations` rebuild (P2); S28 drops the table (D113) |
| Bump configuration format "4 → 5" | none | already 10; nothing carried changes (D114) |
| "Remove retired child marks first; generate drops" in one task | test edits first (Tasks 6, 7a, 7b), then one generation per storage item (Tasks 8, 9) | each commit green; tasks small |
| "Reset is required, never backfill" | no reset expected; the upgrade guard decides | plain `DROP TABLE` / `DROP COLUMN` (P1); stop if the guard refuses |
| Requested Grill prints no paper at request, one at release; HOLD obeys A756 | pinned already by B3 (`kitchen-request.hold-paper.test.ts`, `pass-release.test.ts`); Task 2 adds the heading and no-cue facts to one release case | not rebuilt |

## Consumer audit

The search in finding 1, every hit outside tests, drizzle output and fixtures:

| Hit | Task |
| --- | --- |
| `packages/db/src/schema/ticket-items.ts:67` (`awayAt`) | Task 9 deletes |
| `packages/db/src/schema/pass-item-marks.ts` (table) | Task 8 deletes |
| `packages/db/src/schema/index.ts:34`, `packages/db/src/index.ts:173` (exports) | Task 8 deletes |
| `packages/db/src/classification.ts:139-143` | Task 8 deletes |
| `packages/db/mutation-costs.json:72` | Task 8 deletes |
| `packages/db/src/schema/tenants.ts:26-32,86,100` (`fireControlMode`, column, CHECK) | unchanged (D113); Task 10 rewrites the doc comment |
| `apps/server/src/kitchen-print.ts:457` (`KitchenRoute`) | false match |
| `apps/till/src/screens/till-table-order-screen.current-orders.test-helpers.ts:69` | unchanged (payload key, finding 2) |
| `packages/country-es/test-fixtures/demo/madrid-before-move.{en,es}.json` | unchanged (hash-pinned capture, finding 13) |
| `packages/db/drizzle/*.sql`, `meta/*.json` | historical, unchanged |

Prose hits (`rg -n -i 'away_at|awayAt|pass_item_marks|fire_control|fireControl' docs/developers docs/operations docs/backlog docs/backlog.md`):
`docs/developers/conventions-ui.md:632` (Task 8), `docs/developers/conventions-data.md:1721,1733`
(historical format-10 description; unchanged), `docs/backlog/data-protection.md:93` (Task 8),
`docs/operations/a760-migration-squash-inventory.md:259` (Task 8, dated pointer),
`docs/backlog/kitchen.md:291`, `docs/backlog/architecture.md:1080` (Task 10), the A773 entries
(Task 11).

New readers this PR adds: `buildTicketItems`' course and pass-control read (Tasks 1b, 2),
`groupsWithPassFood` (Task 2) and its call in `listStationQueues` (Task 3).

## Changed test checks (expected; the implementer confirms each)

**Course headings (Task 1b; P3).** In `apps/server/src/order-groups.test.ts`, only the heading
strings change: each expected `GROUP n` (or `GROUP n · <tables>`) line, or substring ending in
`\n`, gains ` · <COURSE>` for its fixture dishes' course; every other expected value, order and
count stays. The 34 cases P3 turned red:
"permanent group numbers on kitchen work" › "qualifies duplicate numbers from a closed origin using
its recorded tables", "keeps original numbers on FIRE paper after reordering held groups", "keeps
original numbers on HOLD corrections after reordering", "reprints permanent numbers in the changed
firing order", "keeps the original group number on order-note change slips"; "a group split across
bills of its party" › "splits part of a held-group line onto a check as two held rows of the group,
and fires both"; "kitchen tickets for a party's groups (Task 5)" › "names the group under the header
of each group's fire ticket", "marks a reprint REPRINT, heads each group, and records no event, ticket
item or sent stamp", "prints a reprint's groups in position order, not in the order their lines were
added"; "advance HOLD tickets (Task 6)" › "setting off (the default): holding prints nothing, and
firing prints the group's current contents, edits included"; › "setting on" › "holding the mains
prints a ticket headed HOLD listing 2 x Steak and 1 x Fish, linked so a printing problem can name it",
"moves a Steak, removes the Fish and fires the mains: -1/+1 corrections, a HOLD cancellation, then one
FIRE slip", "prints a FIRE slip for a waiter-released group", "prints a MOVED slip listing the Steak
under HOLD when one of the printed mains is split onto a check, then one FIRE slip from each bill for
its own dishes", "prints +1 for a Steak joined to the printed mains, with an added notice", "prints a
HOLD ticket for the new group a move makes, and -1 for the printed group it left", "prints -1 and +1
for a whole line moved between printed groups", "prints a changed note as -N of the dish as it read,
then +N as it now reads", "prints a quantity and a note changed together as the old dish taken away
and the new one given", "A803 portions: raising a held portion to 2 with a new note prints the old
dish taken away, then the edited and the added portion given apart", "prints an added extra as the
dish without it taken away and the dish with it given", "prints +1 and -1 for a held Steak's quantity
raised and lowered by an edit", "prints a HOLD cancellation for a held line a whole-order save leaves
out", "prints a HOLD cancellation for the part of a held line voided, and for a void that empties its
group", "prints a HOLD ticket for the held group an edit makes on a party with nothing sent", "records
no HOLD ticket where no active printer took one, and the group fires as before"; › "a group held
before the setting was turned on" › "fires with a normal ticket, and its edits print nothing"; ›
"each station's own held printing" › "a held group's HOLD ticket prints only at the stations that
print held work, and records them"; › "HOLD corrections from group changes" › "removing a held dish
corrects the HOLD ticket only at a station recorded for the group, and tells every station's screen",
"moving a held dish between printed groups takes it off and adds it only at stations recorded for
each group", "firing one held dish takes it off the HOLD ticket only at a station recorded for the
group", "a held edit's quantity change corrects the HOLD ticket only at a station recorded for the
group", "a held dish moved into a printed group holding none of a station's held work gets HOLD
CHANGED there, and records it", "a station switched off after its HOLD ticket printed still gets +N
for a joining dish". A heading change in any other case or file found by Task 1b's step 1 is a
**stop**: report it and amend this table before editing.

**Retired storage (Tasks 6–9, rule D123).**

| File | Hits | Expected change |
| --- | --- | --- |
| `apps/server/src/pass-board.test.ts` | marks 11, away 2 | `:187` "legacy Done marks stay device-specific …" and `:244` "A773 no dispatch state: splitting keeps the source mark …" deleted under (d) unless a food-visibility assertion remains that no other case holds, then kept under (a); `:363` "refuses Done and Undo …" keeps its two 404s, loses the marks read (a); `:304` "… after a legacy Away stamp" and `:389` "… independently of legacy Done and Away stamps" lose the stamp/mark writes (a) and the words "legacy …" from their titles |
| `apps/server/src/device-api.pass.test.ts` | marks 14 | each case keeps its 404s and board reads; marks inserts and `select … from(passItemMarks)` assertions go (a) |
| `apps/server/src/pass-lifetime.test.ts` | marks 5, away 3 | (a) |
| `apps/server/src/station-outputs-down.test.ts` | marks 4, away 2 | (a) |
| `apps/server/src/watchers.leave.test.ts` | marks 4 | the insert, the two `onPassScreen` checks between it and the delete, and the delete go (a); the rest unchanged |
| `apps/server/src/personal-data-actions.coverage.test.ts:57` | 1 | the list entry `pass_item_marks.done_by_person_id` goes (the table's column no longer exists) |
| `scripts/schema-constraints.test.ts:234-235` | 2 | the two `pass_item_marks` key rows go |
| `packages/db/src/schema/pass-item-marks.test.ts` | file | deleted with the table |
| `packages/db/src/schema/ticket-items.test.ts:144`, `:147-158` | 4 | `expect(row!.awayAt).toBeNull()` goes; the case "stamps away_at (the pass dispatch) …" is deleted |
| `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:36`, after `:165` | set-up of the expected side | `REMOVED_TABLES` gains `"pass_item_marks"`; `ticket_items`' expected columns lose `away_at` (and each captured row its key), as `parties` loses `main_bill_id` |
| server tests with `awayAt` (Tasks 7a, 7b): `current-orders` 1, `department-transfer-api` 4, `device-levers` 4, `kitchen-allergy.notices` 1, `kitchen-print` 1, `management-api.station-disable` 1, `order-groups` 6, `order-kitchen-note.corrections` 2, `party-move-bill` 3, `rest-of-order` 1, `served` 2, `split-off-extras.groups` 3, `split-off-extras.release` 2, `station-delete` 1, `station-move` 1, `station-queue-rest` 1, `table-signals.service-lifetime` 1, `tables` 1, `till-api.groups` 3, `till-api.station-today` 2, `working-order-reads.sqlite` 1, `working-order` 13 | as counted | (a) or (b) per hit; a combined `.set({ state, awayAt })` keeps `state`; a helper option `away` (e.g. `rest-of-order.test.ts:154`, `station-queue-rest.test.ts:160`, `station-delete.test.ts:110`) and the fixtures that pass it go |
| `apps/server/src/till-api.courses.test.ts:674,696,731` | 3 | `:674`, `:696` stay (c); `:731` (`before.items.every((item) => item.awayAt === null)`) reads the API answer: stays if the answer still types `awayAt`-free items, as (c); confirm |

## Guard suites (the final task runs each; earlier tasks run the ones they name)

- **S** (Tasks 8, 9, 11): `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/two-file-foreign-keys.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/apply-migrations-callers.test.ts`,
  then `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`, then
  `pnpm exec vitest run scripts/mutation-shard.test.mjs`.
- **Fiscal pair, unedited** (Tasks 8, 9, 11): `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **G** (Task 4, 11): `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`; `pnpm exec vitest run scripts/guide-links.test.ts`.
- `scripts/english-only.test.ts`, `scripts/style-token-names.test.ts`,
  `scripts/primary-coloured-text.test.ts` (Tasks 2, 3).
- `scripts/errors-reachable.test.ts`, `scripts/alert-codes.test.ts`, `scripts/personal-log-params.test.ts`:
  not needed (no new error, alert or log field); run once in Task 11.

## Owner answers needed

Building proceeds on the recommended words; the PR lands only after the owner's answer (or the
watcher's "Y"). The lane posts this to `~/waitron-campaign-c/questions.md` in Task 0.

**Question 1 of 1 — the Spanish for "Goes with kitchen food".** Worked example: Table 4's
waiter fires the desserts group: a tarta (Grill waits for the pass) and two moscatels (Bar does
not). The Bar's ticket prints at once:

```
BAR
Mesa 4 · Pedido 12
15:10
GRUPO 4 · POSTRES
Sale con la comida de cocina
2.000 x Moscatel
```

and the Bar's screen card says the same line under the moscatels. The tarta prints at the Grill
only when the pass presses **Marchar**.

| Where | English (approved, spec §5) | Proposed Spanish |
| --- | --- | --- |
| Bar ticket, under the group heading; Bar card, under the dishes | Goes with kitchen food | Sale con la comida de cocina |

**Recommended:** «Sale con la comida de cocina», the master plan's proposal: «salir» is the pass's
own verb ("¡sale la mesa 4!"), and «comida de cocina» separates the kitchen's food from the bar's
drinks.

**FYI, no answer needed unless you disagree (builder's calls).** The heading upper-cases the course
name (`GRUPO 4 · POSTRES`) as picture 8 does; a group with two courses on one ticket reads `GRUPO 3 ·
ENTRANTES, PRINCIPALES`; a merged table's repeated number keeps its tables first (`GRUPO 1 · Mesa 4,
9 · PRINCIPALES`). A counter order gets no heading and no cue, since it has no groups (D120; asked
later as a backlog question). The cue stays while the kitchen's part of the group is still held,
because those dishes still go with it (D117).

## Task 0: preflight (no commit, about 15 calls)

- [ ] `git -C <worktree> fetch && git log --oneline 69534cec83..origin/main -- apps/server/src/kitchen-ticket.ts apps/server/src/kitchen-print.ts apps/server/src/kitchen-release.ts apps/server/src/order-groups.ts apps/server/src/working-order.ts apps/till/src/widgets/station-queue.ts packages/db/src/schema packages/db/drizzle apps/server/src/guide`.
  If anything landed (A1301 S18b edits `kitchen-print.ts`; `feat/a802-partial-invoice-correction`
  adds core migrations), rebase and re-read the lines this plan cites.
- [ ] Read the other lanes' queues and live worktrees for these files (`~/waitron-campaign*/queue.md`,
  `git worktree list`); never edit a file another lane's open branch reserves without saying so in
  the ledger.
- [ ] `pnpm install`; `memory_pressure | grep free`.
- [ ] Post Owner question 1 (and the FYI) to `~/waitron-campaign-c/questions.md`.
- [ ] Ledger `docs/handoffs/2026-11-04-a773-2d.md` (`Status: in progress`); add `docs/handoffs/` to
  `.git/info/exclude` if not ignored.

## Task 1a: the heading's course list, in the formatter (about 35 calls)

**Files.** `apps/server/src/kitchen-ticket.ts`; test `kitchen-ticket.test.ts`.

**Interfaces.** D116: `KitchenTicketItem.course?: { name: string; order: number }`; a pure,
exported helper `groupCourseNames(items: readonly KitchenTicketItem[], locale: string):
ReadonlyMap<string, string[]>` keyed by `groupKey`, values upper-cased per D115; `emitGroup` takes
the list for its group. `entryKey` gains `item.course?.name ?? null`.

- [ ] **Failing tests** (new cases in `kitchen-ticket.test.ts`, `A773 fire paper` in each title):
  1. "A773 fire paper: a group heading names its dishes' course" — one-group station ticket, two
     dishes of course Mains (order 2) → the heading line is `GROUP 3 · MAINS`; a Spanish ticket
     (`es-ES`) → `GRUPO 3 · MAINS` (the venue's name, upper-cased; no translation).
  2. "A773 fire paper: two courses list in course order, once each" — dishes of Mains (order 2),
     Starters (order 1), Mains → `GROUP 3 · STARTERS, MAINS`.
  3. "A773 fire paper: a dish with no course adds nothing" — one dish without `course`, one with
     Desserts → `GROUP 4 · DESSERTS`; all without → `GROUP 4`, exactly today's line.
  4. "A773 fire paper: the origin tables stay beside the number" — `groupLabel: "Terrace 4, 9"` and
     course Mains → `GROUP 1 · Terrace 4, 9 · MAINS`.
  5. "A773 fire paper: a ticket spanning groups heads each with its own courses" — group 3
     (Starters) then group 4 (Mains) on one ticket → each heading names only its own.
  6. "A773 fire paper: a shared-printer ticket names every course its one group has" — `scope:
     "stations"`, Grill's Mains and Bar's Drinks in group 2 → one heading `GROUP 2 · MAINS, DRINKS`
     (order 2 then 5) under the header.
  7. "A773 fire paper: two dishes alike but for their course do not merge" — `arrangeTicketItems(…,
     "combined")` keeps them apart and the heading names both courses.
  8. "A773 fire paper: correction, kitchen-note and MOVED slips name the course" — one case per
     formatter (`formatCorrectionSlip`, `formatKitchenNoteChangeSlip`, `formatMovedSlip` including
     its `held` groups) → the heading carries the course.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts -t 'A773 fire paper'`
  — fails on the heading text, not on a type or import error.
- [ ] **Minimal implementation.** As Interfaces. Compute the map once per formatted paper over all
  its items (for `formatMovedSlip`, `slip.items` and every `held` group's items) and pass each group's
  list to `emitGroup`. Upper-case with `toLocaleUpperCase(kitchenLanguageFor(locale))`.
- [ ] **Mutation controls.** Sort courses by name instead of `order` → case 2 red; drop the
  `entryKey` addition → case 7 red; compute per run instead of per paper → case 6 red.
- [ ] **GREEN.** `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts src/kitchen-ticket.kitchen-note.test.ts src/kitchen-ticket.language.test.ts`
  (read each `Tests` count; existing cases pass unchanged because no existing item has a `course`);
  `pnpm --filter @waitron/server typecheck`.
- [ ] **Commit.** `git commit -s -m "Kitchen paper's group heading can name its dishes' courses"`.

## Task 1b: the planner reads each dish's course (about 55 calls)

**Files.** `apps/server/src/kitchen-print.ts` (`buildTicketItems`); tests `kitchen-print.test.ts`,
`order-groups.test.ts` (the 34 pins).

- [ ] **Step 1, the probe that decides the edit list.** Before any code: implement the change below,
  then run every server test file that reads paper text and could carry a group heading:
  `pnpm --filter @waitron/server exec vitest run src/order-groups.test.ts src/kitchen-request.*.test.ts src/print-problems.test.ts src/kitchen-print*.test.ts src/adjustments-extra-cancel.test.ts src/kitchen-ticket*.test.ts src/pass-release.test.ts src/station-move.test.ts src/split-off-extras.*.test.ts src/till-api.reprint.test.ts src/orders-reprint.test.ts src/move-merge.test.ts src/working-order.test.ts src/working-order.pay-and-dispatch.test.ts src/made-here.routes.test.ts src/till-api.service-periods.test.ts src/order-kitchen-note.receipts.test.ts`.
  The failures must be exactly the 34 cases in "Changed test checks"; any other is a **stop**.
- [ ] **Failing tests** (new, `kitchen-print.test.ts`):
  1. "A773 fire paper: a waiter's fire prints the group's course on its heading" — a party with a
     Mains group of two dishes at Grill, fired → the Grill job's text has `GROUP n · MAINS`.
  2. "A773 fire paper: the heading keeps the course a dish was sent with after the course is
     renamed and deactivated" — rename the course after the HOLD ticket, fire → the FIRE paper names
     the current name (D115: read when planned), and a reprint names it too; deactivating the course
     still prints its name (not filtered by `active`).
  3. "A773 fire paper: reordering held groups keeps each heading's number and course" — two held
     groups (Mains, Desserts) swapped, Desserts fired → `GROUP <its original number> · DESSERTS`.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-print.test.ts -t 'A773 fire paper'`.
- [ ] **Minimal implementation.** In `buildTicketItems`, left-join `kitchen_courses` on
  `ownRecord.courseId` (alias it; no location column named) and set `course: { name, order:
  displayOrder }` when present. Edit the 34 pins per "Changed test checks" (heading strings only).
- [ ] **Mutation controls.** Join on the line's `course_id` of the parent instead of the dish's own
  ticket item → case 1 still green? If so, add a case where the line's and the ticket item's courses
  differ (`ticket_items.course_id` is what the station screen reads, finding 8) and show it red.
- [ ] **GREEN.** Step 1's command again, all green (read the count); `pnpm --filter @waitron/server typecheck`.
- [ ] **Commit.** `git commit -s -m "Kitchen tickets and slips name each group's courses on its heading (GROUP 3 · MAINS)"`.

## Task 2: "Goes with kitchen food" on the ticket (about 55 calls)

**Files.** `apps/server/src/kitchen-release.ts` (`groupsWithPassFood`), `kitchen-print.ts`
(`buildTicketItems` or the ticket planner), `kitchen-ticket.ts` (cue line, `entryKey`),
`i18n/kitchen-ticket.ts` (`goesWithKitchenFood`); tests a new `kitchen-release.test.ts` (none exists;
`requestStamps` and friends are exercised through `pass-release.test.ts` and
`party-move-bill.test.ts`), `kitchen-ticket.test.ts`, new `kitchen-print.goes-with.test.ts` (or cases in `pass-release.test.ts`
where its fixtures fit; use `setStationsWaitForPass`, `apps/server/src/testing/pass-waiting.ts`).

**Interfaces.** D117 `groupsWithPassFood(tx, groupIds)`; D118 `KitchenTicketItem.goesWithKitchenFood?: true`;
`KITCHEN_TICKET_WORDS.{en,es}.goesWithKitchenFood`.

- [ ] **Failing tests** (`A773 fire paper` in each title):
  1. new `kitchen-release.test.ts` "A773 fire paper: a group has kitchen food at the pass" — group with
     a pass-controlled Grill dish → in; group whose Grill dish is held and Grill waits now → in; group
     whose only Grill dish was released before Grill started waiting (`pass_controlled` false,
     `requested_at` set) → out; a cancelled pass-controlled dish (not `liveKitchenDish`) → out;
     empty input → empty set with no query (count queries or assert on an empty array).
  2. `kitchen-ticket.test.ts` "A773 fire paper: the cue prints once under its group's heading" —
     two dishes of group 4 with the flag → `GROUP 4 · DESSERTS`, then `Goes with kitchen food`, then
     the dishes; Spanish ticket uses the `es` word; a group without the flag prints no cue; a HOLD
     ticket's items never carry it (planner) and the formatter prints whatever the items say.
  3. "A773 fire paper: the bar's ticket says it goes with the kitchen's food" — Grill waits, Bar does
     not; one bill, desserts group of a tarta (Grill) and moscatel (Bar), held, then the waiter fires
     it → the Bar job's text has the cue under `GROUP n · DESSERTS`; no Grill job yet; the pass
     releases the tarta → the Grill job has the heading and no cue.
  4. "A773 fire paper: two bills of one group" — the tarta on Bill 2, the moscatel on Bill 1, fired by
     the group's Fire → Bar's ticket has the cue whichever bill prints first (finding 11). Build it so
     Bill 1 prints first, and show it red with D117's second half removed.
  5. "A773 fire paper: no cue without food at the pass" — nobody waits → no cue; a Bar-only group →
     no cue; an advance HOLD ticket at Bar for the held group → no cue.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-release.test.ts src/kitchen-ticket.test.ts src/kitchen-print.goes-with.test.ts -t 'A773 fire paper'`.
- [ ] **Minimal implementation.** One query for the planned dishes' groups per paper plan; set the
  flag per D118 (needs the dish's own `pass_controlled` and `made_here`: add both to
  `buildTicketItems`' `ownRecord` select). Print the cue after the heading in `emitGrouped` and after
  the shared heading in `formatKitchenTicket`; never in the slip formatters. Add the flag to
  `entryKey`.
- [ ] **Mutation controls.** Drop the `mark !== "HOLD"` guard → case 5's HOLD part red; drop the
  dish's own `pass_controlled` check → case 3's Grill release red; read `pass_controlled` only (no
  held-at-waiting-station half) → case 4 red.
- [ ] **GREEN.** The three files unfiltered, plus `src/pass-release.test.ts src/kitchen-request.hold-paper.test.ts src/kitchen-print.shared-printers.test.ts src/kitchen-print.concurrency.test.ts src/order-groups.test.ts`;
  `scripts/english-only.test.ts`; `pnpm --filter @waitron/server typecheck`.
- [ ] **Commit.** `git commit -s -m "A station that does not wait for the pass prints 'Goes with kitchen food' when its group has food at the pass"`.

## Task 3: the cue on the station card (about 50 calls)

**Files.** `apps/server/src/working-order.ts` (`QueueGroup`, `listStationQueues`); till
`apps/till/src/api/client.ts` (`QueueGroup`), `widgets/station-queue.ts` (`#card`),
`i18n/strings.ts` (EN and ES `station.goes_with_kitchen_food`); tests server
`station-queue-rest.test.ts` or a new `station-queue.goes-with.test.ts`, till
`widgets/station-queue.test.ts`, `widgets/station-queue.a11y.test.ts`.

- [ ] **Failing tests** (`A773 fire paper`):
  1. Server: "A773 fire paper: a station's queue marks a group with kitchen food at the pass" — the
     Task 2 fixture after the waiter's fire: the Bar's queue item's `group.goesWithKitchenFood` is
     `true`; the Grill's queue (after the pass's release) also carries it on the group (it is a group
     fact); a group with no food at the pass has no such key (`not.toHaveProperty`).
  2. Till: "A773 fire paper: a released card whose group has food at the pass says so" — a Bar card
     with a waiting, not pass-controlled moscatel and the key → the line "Goes with kitchen food"
     under its dishes; Spanish locale → the `es` string; a held card with the key → no line; a card
     whose dishes are all pass-controlled → no line; no key → no line. Restore the language after
     the case (CLAUDE.md §4).
  3. Till a11y: the Bar card with the line passes axe in both themes.
- [ ] **RED.** Server: `pnpm --filter @waitron/server exec vitest run src/station-queue.goes-with.test.ts -t 'A773 fire paper'`;
  till (memory first): `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts -t 'A773 fire paper'`.
- [ ] **Minimal implementation.** One `groupsWithPassFood` call over the read's group ids; add the
  key in the group builder only when true. Client type gains `goesWithKitchenFood?: true`. The card
  draws `<p class="goes-with" data-goes-with>` after its sections, styled with the tokens the card's
  muted text already uses.
- [ ] **Mutation controls.** Draw on any card with the key (drop the released-and-not-pass-controlled
  test) → case 2's held and Grill parts red.
- [ ] **GREEN.** Server file unfiltered plus `src/station-queue-rest.test.ts src/device-api.pass.test.ts src/till-api.station-today.test.ts`;
  till `src/widgets/station-queue.test.ts src/widgets/station-queue.a11y.test.ts src/screens/till-station-screen.test.ts`;
  `scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/english-only.test.ts`;
  typecheck server and till.
- [ ] **Commit.** `git commit -s -m "The station card says 'Goes with kitchen food' when its group has food at the pass"`.

## Task 4: the guide and the A803 handoff (about 35 calls)

- [ ] `apps/server/src/guide/en/kitchen-service.md` and `es/` twin: in `#held-work` (or a new
  `{#group-headings}` section; if new, `guide-content.test.ts`' list of ids gains it and it is added
  to "Changed test checks"), written from the code, each sentence's `file:line` in the task report:
  a group's heading names its courses; a station that does not wait for the pass prints and shows
  "Goes with kitchen food" when the same group has dishes for the pass, and what that means (serve
  it with that food); `#kitchen-screen` mentions the card's line. Spanish uses Owner question 1's
  words.
- [ ] Append to `docs/superpowers/plans/2026-10-19-a803-bills-and-tables.md`'s "Dependency tail" a
  paragraph headed "A773-2 PR D handoff (2026-11-04)" with D124's seams.
- [ ] G. **Commit.** `git commit -s -m "Guide: course headings and 'Goes with kitchen food'; A803 handoff note"`.

## Task 5: LOOK (about 40 calls)

- [ ] Paper: render the Task 2 fixture's Bar and Grill jobs and a two-course HOLD ticket at 58 and
  80 mm (the text decoder the server tests use) in EN and ES; check the heading and cue wrap without
  splitting words where they fit. Say this is rendered text, not printed paper.
- [ ] Screen: `wa-wt demo "$(basename "$PWD")"`; set Grill to wait for the pass; seat a table with a
  tarta and a moscatel in a held desserts group; fire it; screenshot the Bar station card and a
  kitchen display in EN/ES, light/dark, at 390 and 1280 px; check the line is muted, readable, and
  the card's layout unchanged otherwise. Screenshots in `~/waitron-campaign-c/a773-2d-shots/`, never
  committed. Stop only the processes you started.
- [ ] Record what was seen in the ledger and the PR body draft. No commit unless a defect is fixed
  (test first).

## Task 6: tests stop reading and writing pass marks (about 45 calls)

**Files.** `apps/server/src/pass-board.test.ts`, `device-api.pass.test.ts`, `pass-lifetime.test.ts`,
`station-outputs-down.test.ts`, `watchers.leave.test.ts`.

- [ ] Apply D123 to every `passItemMarks` hit in these five files; record each case and the rule
  applied.
- [ ] **GREEN.** The five files unfiltered (read each count; the total falls only by the cases (d)
  deleted, named in the report); `rg -n 'passItemMarks|pass_item_marks' apps/server/src` lists only
  `personal-data-actions.coverage.test.ts:57`.
- [ ] **Commit.** `git commit -s -m "Tests stop writing the retired pass Done marks"`.

## Task 7a: tests stop writing `away_at`, part 1 (about 50 calls)

**Files.** `current-orders`, `department-transfer-api`, `device-levers`, `kitchen-allergy.notices`,
`kitchen-print`, `management-api.station-disable`, `order-groups`, `order-kitchen-note.corrections`,
`party-move-bill`, `pass-board`, `pass-lifetime` (`.test.ts` under `apps/server/src/`).

- [ ] Apply D123 to every `awayAt` hit; record each.
- [ ] **GREEN.** Those files unfiltered, each count read. **Commit.** `git commit -s -m "Tests stop writing the retired Away stamp (part 1)"`.

## Task 7b: tests stop writing `away_at`, part 2 (about 50 calls)

**Files.** `rest-of-order`, `served`, `split-off-extras.groups`, `split-off-extras.release`,
`station-delete`, `station-move`, `station-outputs-down`, `station-queue-rest`,
`table-signals.service-lifetime`, `tables`, `till-api.courses` (confirm `:731`),
`till-api.groups`, `till-api.station-today`, `working-order-reads.sqlite`, `working-order`.

- [ ] Apply D123; record each. **GREEN.** Those files unfiltered;
  `rg -n 'awayAt|away_at' apps/server/src` lists only the (c) assertions. **Commit.**
  `git commit -s -m "Tests stop writing the retired Away stamp (part 2)"`.

## Task 8: drop `pass_item_marks` (about 45 calls)

- [ ] **Failing test.** `packages/db/src/schema/ticket-items.test.ts` (or a new
  `retired-storage.test.ts` beside it): "A773 retired storage: a migrated database has no pass marks
  table" — `select name from sqlite_master where name = 'pass_item_marks'` on `useVenueDb` is empty.
  **RED:** `pnpm --filter @waitron/db exec vitest run src/schema/ticket-items.test.ts -t 'A773 retired storage'`.
- [ ] Delete `packages/db/src/schema/pass-item-marks.ts` and `.test.ts`; remove both exports, the
  classification entry and `mutation-costs.json:72`; remove the guard rows and the personal-data
  entry (Changed test checks); `docs/developers/conventions-ui.md:632`'s clause about legacy marks;
  `docs/backlog/data-protection.md:93`'s mention; a dated pointer row note in
  `docs/operations/a760-migration-squash-inventory.md:259`.
- [ ] `pnpm --filter @waitron/db db:generate` (name the file `retire_pass_item_marks` with
  `--name`); read the SQL: exactly `DROP TABLE \`pass_item_marks\`;`. Anything else is a stop.
- [ ] Madrid baseline: `REMOVED_TABLES` gains `"pass_item_marks"`. Run
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts`.
- [ ] **GREEN.** db `src/schema` unfiltered; server `src/personal-data-actions.coverage.test.ts`
  and Task 6's five files; S; fiscal pair. `scripts/migration-upgrade.test.ts` must pass with no new
  `RESETS` entry — its log names the step; if the step is refused, **stop** with the receipt.
  `pnpm --filter @waitron/db typecheck`, `pnpm --filter @waitron/server typecheck`.
- [ ] **Commit.** `git commit -s -m "Drop the retired pass Done marks table (no venue reset)"`.

## Task 9: drop `ticket_items.away_at` (about 40 calls)

- [ ] **Failing test.** "A773 retired storage: ticket items have no Away column" —
  `pragma_table_info('ticket_items')` has no `away_at`. **RED** as Task 8.
- [ ] Remove the schema line; the db test's away case and `:144` (Changed test checks); generate
  (`--name retire_away_at`); read the SQL: exactly `ALTER TABLE \`ticket_items\` DROP COLUMN
  \`away_at\`;`.
- [ ] Madrid baseline: filter `away_at` out of `ticket_items`' expected columns and rows in every
  phase, beside the `parties` filter.
- [ ] **GREEN.** As Task 8, plus Tasks 7a/7b's files and `rg -n 'awayAt|away_at' apps packages scripts -g '!**/drizzle/**' -g '!**/test-fixtures/**'`
  showing only finding 2's till payload keys and D123 (c) assertions.
- [ ] **Commit.** `git commit -s -m "Drop the retired Away column from kitchen items (no venue reset)"`.

## Task 10: prose, `fire_control`'s pointer and the audit (about 30 calls)

- [ ] `packages/db/src/schema/tenants.ts`: `fireControlMode`'s doc comment becomes the `bumpMode`
  form ("Read by nothing … A1301 S28's drop of `locations` removes it"). Comment only; generate and
  confirm drizzle writes no migration (`git status packages/db/drizzle` clean).
- [ ] `docs/backlog/kitchen.md:291` and `docs/backlog/architecture.md:1080`: `fire_control`'s
  removal is A1301 S28's (D113), with the test list from D113. A dated pointer line under A1301
  design note 9 (`2026-11-01-a1301-remove-location-design.md:778`): "2026-11-04: A773-2 PR D left
  `fire_control` to S28 (its plan D113)". A dated pointer at the top of the master plan's Tasks 11–12
  to this plan.
- [ ] Re-run finding 1's search and the prose search; every hit is in a "Consumer audit" row or is
  new code from Tasks 1–3. Record any till fixture still passing `fireControl` as one backlog point
  (Task 11).
- [ ] **Commit.** `git commit -s -m "Docs: the retired pass storage is gone; fire_control goes with locations in A1301 S28"`.

## Task 11: the whole branch, backlog and the PR (about 40 calls)

- [ ] Focused suites, each count read: server `kitchen-ticket*.test.ts`, `kitchen-print*.test.ts`,
  `kitchen-release.test.ts`, `order-groups.test.ts`, `pass-release.test.ts`, `pass-board.test.ts`,
  `device-api.pass.test.ts`, the Tasks 6–7b files, `station-queue*.test.ts`, `guide-content.test.ts`,
  `guide-pages.test.ts`, `scripts/demo-seed/seed.madrid-baseline.test.ts`; db `src/schema`; till
  `station-queue*.test.ts`, `till-station-screen.test.ts` (memory first).
- [ ] Guards: every file in "Guard suites". Fiscal pair unedited; `git diff 69534cec83 -- packages/fiscal-verifactu` empty.
- [ ] Every removed or changed `expect` line in `git diff 69534cec83 -- '*.test.ts' '*.test.mjs'`
  is a row of "Changed test checks"; add the per-case rows Tasks 6–9 reported.
- [ ] Backlog: delete the A773-2 entry in `docs/backlog.md` (`:2474-2479`) and Ordered work item 1's
  A773-2 half (`:88-96`), keeping A803's sentence; rewrite `docs/backlog/till.md#a773-courses-groups-and-the-pass`'s
  "Next: PR D" lines to say A773-2 is complete; new short entries: (1) "A counter order gets no
  'Goes with kitchen food' (D120)" as a question for the owner; (2) the till and server tests that
  still set `fireControl`, to delete with A1301 S28; (3) any LOOK finding not fixed. A803's entry
  says its pass and station slices no longer wait for A773-2.
- [ ] Ledger `Status: done` for the build; next step `/finish-branch` (FULL, two Codex angles).
- [ ] PR body draft at `~/waitron-campaign-c/a773-2d-pr-body.md`: title "Kitchen tickets name each
  group's courses and say 'Goes with kitchen food'; the old Away and Done storage is dropped (A773-2
  PR D; no venue reset)"; first line from Tasks 8–9's upgrade-guard result; plain-English body:
  what paper and the station card now say (with the worked example), what was dropped and why
  `fire_control` waits for A1301 S28, the two migrations' SQL, the A803 handoff (D124), "Changed test
  checks", the owner question's state, LOOK's findings.

## Self-review

- **Spec coverage.** §5 "One group, several stations" (cue on ticket and screen) → Tasks 2, 3; §6
  headings → Tasks 1a, 1b; §6 "a station that waits prints when the pass fires" and HOLD → already
  pinned by B3, plus Task 2 case 3's release facts; §8 counter → D120; §9 `away_at` and Done marks →
  Tasks 6–9; §9 `fire_control` → D113 (A1301 S28); §13 "each rule gets a test that fails if removed"
  → every task's mutation controls.
- **Master Task 11/12 coverage.** Headings, cue, print boundary, A803 handoff (D124), guide (Task 4),
  LOOK (Task 5); storage retirement (Tasks 6–9), format bump (not needed, D114), audit (Task 10),
  prose (Tasks 8, 10). Review Focus 5 (output count follows outputs): Task 2 runs
  `kitchen-print.shared-printers.test.ts` unfiltered, and the cue is a property of each paper, not
  a new job.
- **Claims checked by running something.** P1 (plain drops), P2 (`locations` rebuild), P3 (34 pins),
  the bundle grep, the trigger grep, the Madrid row counts. Reasoned, not run: that the two drops
  pass the upgrade guard with rows present (Tasks 8–9 run it and stop otherwise); that P3's twelve
  files are the only heading pins (Task 1b step 1 runs eighteen globs first).
- **Task sizes.** Every task is estimated under 60 calls; 1b and 2 are the largest (55).
- **No location, English only, no fiscal edit, no compatibility code.** Stated above; no task adds a
  location column or parameter, a Spanish identifier, or a conversion.

# A757 slice 8 — Service steps on the floor: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** (design §11 item 8: "a till write route: CLAUDE.md §3 asks for a profile-action
row and a refusing case"). Three more reasons the full wave is right: Task 1 is a **migration** (a
new venue-service table with two cascading foreign keys, one into the core `parties`); Task 2
changes a **cross-package contract**, the shared `TableSignal` union in `packages/shared` that the
server sends and the till reads; and Task 5 adds a till write route. So every task gets its
per-task review, and `/finish-branch` runs the full wave with two Codex angles. **`packages/*`
changes:** `packages/shared` (the signal type, Tasks 2 and 9) and `packages/venue-service` (the
table, its migration, its reads and its write, Tasks 1 and 3a). **No `packages/ui` change**: the
map's cue is already a string and the chips already take any key; a task that finds it needs a
`packages/ui` change stops and reports. **Nothing fiscal**: no task touches `packages/fiscal-*`,
invoices, the chain, series or AEAT filing; the golden hash test
(`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` must pass **unedited**.
**One pull request.** Branch `feat/a757-8-service-steps-floor`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a757-8-service-steps-floor`, from `main` at
`fef29d8dc` (the brief named `c123d2c32`; the worktree's `main` had moved one commit, A998, when
this plan was written). Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** a seated table shows the one service step it is due for — a blue chip "🛎 Dessert? | Done"
on its card, a seated-blue table with "🛎 Dessert?" on the map, the step with Done in its details —
and a tap on Done, an order sent once it is due, the party's first order, or the party leaving
clears it.

**Architecture:** a new venue-service table, `service_step_completions`, records each Done (party,
step, time, person). The server works out each seated table's steps on every floor read in a pure
function, `liveSteps` (`apps/server/src/service-step-reckoning.ts`), from facts read in six
statements for the whole floor (`readTableSteps`, `apps/server/src/service-step-signals.ts`), and
sends them as a new `service_step` signal carrying every live step with the moment it falls due;
the till shows the latest one already due and redraws itself when the next falls due. A new route,
`POST /api/parties/:id/service-steps/:stepId/done`, records Done. Today's `take_order` signal goes:
Take order is now one of the venue's steps.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, drizzle-kit 0.31.11, Hono, Lit, Vitest (Node
for `apps/server` and venue-service's `node` project, real Chromium for `apps/till`).

**Spec:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md` — "Decided" Q29–Q32
(lines 69-75), §3 (lines 213-220), §4 row 8 (line 254) and its merge rule (line 276), §5.4 (lines
427-438), §6 (lines 451-457), §8 (lines 513-580), §9 (lines 582-598), §11 item 8 (lines 655-657).
Pictures `docs/backlog/mockups/a757-table-states/10-service-steps.png`, `02-lifecycle.png`,
`09-busy-floor.png` (and `-dark`), `11-calm.png` (and `-dark`). Earlier slices:
`docs/superpowers/plans/2026-10-19-a757-7-service-step-settings.md` (the steps' table and its
Decision 7, what this slice owes), `docs/superpowers/plans/2026-10-20-a757-4-precedence-pulses.md`
(Decision 2: "slice 8's step signal maps to `step`"), `docs/superpowers/plans/2026-10-20-a757-5-map-zone-tabs.md`
(the map's `step` look, Decision 4).

## Driver rulings (plan review)

- **C1:** Task 6 keeps `case "take_order": return [];` in `signalChips` (its switch has no
  default) until Task 9 removes the member, converts every till `{ kind: "take_order" }` fixture to
  `dueStepSignal("Take order")`, makes the key and text-only assertion changes (the precedence
  chip key, the Spanish test), and ends by running every floor screen test file plus the details
  sheet's and status pin's a11y files. Task 7 keeps only the card-with-Done changes.
- **I1:** follow the spec as written. "Started" is when a step falls due (its trigger plus its
  minutes); one step shows at a time, the latest due; Q30: an order sent after a step is due clears
  it. Today's Take order behaviour is kept by one general rule needing no marker: before the
  party's first order an open draft hides every live step, and that first order clears every step
  triggered before it. The first order's time comes from the same `order_group_events` statement
  (the earliest row beside the latest). The 20:34 example comes out the same; Dessert? survives a
  drinks round sent while it waits out its minutes; the former owner points 1 and 2 are gone.
- **I2:** the dishes are reckoned with the existing serving reckoning, as §8 says:
  `serviceQuantities` and `serviceCompletedAt` (`apps/server/src/line-service-state.ts:20-49`), the
  cancellation's time selected, and `readReleaseReminders`' three filters
  (`apps/server/src/order-groups.ts:1497-1508`).
- **I3:** Task 4's statement-count extension gives the parties' departments steps so the step reads
  run in both counts; the kinds assertion stays unchanged (no step is live there) and
  `three.count === one.count` stays.
- **I4:** the a11y case that checks the card with Done is the list case at
  `till-floor-screen.a11y.test.ts:473-500`, gaining `canMarkSteps: true`; `:677` is a zone-tab case
  and only its fixture changes.
- **I5:** Task 7 is split into 7a (the step chip and its tests) and 7b (the card, the timer, the
  floor screen's tests); Task 3 into 3a (venue-service reads and writes) and 3b (`readTableSteps`
  and its database tests).
- **Minor:** `dueStepSignal` defaults to `2000-01-01T00:00:00.000Z` (M1); Task 9's grep may name
  the generic `take-order` chip key in `packages/ui/src/components/wt-table-token.a11y.test.ts:147`,
  which stays (M2); `createDepartment` writes the starters, so two-department fixtures replace them
  with `setSteps` (M3); `doneAt` is `new Date(nowMs).toISOString()` (M4); step ids are
  de-duplicated before the insert and in `cleared`, with a test (M5); `requireStepParam`
  lower-cases (M6); Task 5's deletion proof expects `409 party.not_open` (M7); `canMarkSteps` stays
  its own property, with the reason in Decision 8 (M8); owner point 7 says what a split-off party
  lacks (M9); citations corrected (M10).

- **Round 3 (after the claim check, 08ce30a99):**
  1. Decision 2's comments: the signal lists "steps whose trigger has happened and that are not
     cleared" (it carries steps not yet due too); `dueAt` is "its trigger plus its minutes".
  2. `chipState`'s `"take-order"` case (`apps/till/src/widgets/signal-chips.ts:110-111`) stays
     through Task 6 and goes in Task 9 with the `take_order` member, so Task 9's grep finds only
     the allowed `wt-table-token.a11y.test.ts:147`.
  3. Task 10's guide says an order clears a step "once it is due", matching Decision 3 and the
     Goal, an earlier-due step hidden behind a later one included.
  4. A dish with nothing left to serve but no serving time (`serviceCompletedAt` returns null)
     keeps its course unserved, as the fire reminder treats null (`order-groups.ts:1444`); Task 2's
     `servedTimes` tests pin it.

## Sources the plan answers to (quoted)

- §8: "A **service step** is a reminder to go to a table." "**What starts a step** — one of four,
  each plus a number of minutes (0 = at once): 1. **When seated** … 2. **After the step before** —
  the step above it in the list is done. 3. **A course served** — every dish of a named course on
  the party's order is served … 'Mains served at 21:32' is the latest `served_at` among the party's
  Mains lines once none is left unserved … 4. **Everything served** — nothing ordered is left
  unserved and nothing is held." "**A step starts again each time its start happens again** … A
  step whose start never happens never shows." "**What a waiter sees:** one step at a time per
  table — the latest one started — as a blue chip on the card with its own **Done** button ('🛎
  Dessert? | Done'), and on the map a seated-blue table with '🛎 Dessert?'. One tap on Done clears
  it. From the map, the table's details … list the step with Done. A step also clears when the
  party leaves. … Take order keeps today's rule as well: it clears when an order is started, as
  `take_order` does." "**Worked example** (picture 10): T9 is seated at 20:30 → 'Set up'. The
  waiter brings bread and water and taps Done at 20:33 → at 20:35 'Take order'. The order is sent;
  the chip clears. The mains are all served at 21:32 → at 21:42 'Dessert?' (the venue's own step).
  The guests want nothing; Done at 21:45 → '✓ Nothing needed'." "**What it stores** …: each party's
  done steps with the time and who tapped Done. The server sends the active step with the floor
  read as a new signal, with its start time, so the till redraws when a step's minutes run out."
- Q30: "**A.** Any order sent after a step started clears it; Done is for when the guests want
  nothing." Q31: "**A.** A fifth start, 'every N minutes since the last order'." Q32: "**A.** A
  seated table that needs nothing is pale blue with ✓ ('Nothing needed'); solid blue means 'go to
  this table'."
- §4 row 8: "**A service step** (section 8) | seated blue | 🛎 and the step's name | no | —". §6:
  "A long step name is cut to fit with an ellipsis; the table's details show it in full."
- Picture 10 (read 2026-10-22): each card's last line is one joined chip — a filled blue segment
  with a bell and the step's name in white ("Set up", "Take order", "Dessert?"), then a white
  segment "Done" in dark text, the whole chip outlined in blue; the card's left edge is solid blue
  while a step shows and pale blue once "✓ Nothing needed". Picture 09: T6 is a solid blue table
  with "🛎 Dessert?". Picture 11: T6's card has the same joined chip; the map's T6 is solid blue.

## What the code does today (each read 2026-10-22 at `fef29d8dc`)

**Take order.** The floor read pushes `{ kind: "take_order" }` for a seated party whose bills have
no line and which has no open draft: `own.every((bill) => bill.lines === 0) && !drafting.has(party.id)`
(`apps/server/src/table-signals.ts:231-233`), where `drafting` is the parties with an
`order_drafts` row in state `open` (`:216-223`) — that statement has no other use. The type is
`packages/shared/src/table-signals.ts:9`. Every consumer, from
`git grep -n "take_order" -- apps packages` (the `take-orders` profile action is a different word):
the server's push (`table-signals.ts:232`); the till's ranking, `if (has("take_order"))
active.add("step")` (`apps/till/src/state/table-precedence.ts:47`); its chip, key `take-order`,
tone `primary`, no icon (`apps/till/src/widgets/signal-chips.ts:29-30`) and that chip's state
(`:110-111`); the map's cue and spoken words, both the fixed string `signal.take_order`
(`apps/till/src/state/floor-look.ts:79`, `:91`); the strings `signal.take_order` "Take order" /
«Tomar nota» (`apps/till/src/i18n/strings.ts:1030`, `:2733`); and tests (Changed checks).

**The floor read.** `listTablesWithState` (`apps/server/src/working-order.ts:8122`) reads
seated parties with `readSeatedParties` (`:8413-8476`, members selected at `:8417-8432` without
`parties.opened_at`), then `readPartySignals(tx, parties, facts, nowMs)` once (`:8232`) with
`nowMs = Date.now()` (`:8231`), and builds each table's list with `tableSignals(partySignals,
needsClearingSince)` (`:8269-8272`; `table-signals.ts:267-277`). `readPartySignals` reads each kind
of fact once for all parties, pinned by "reads every kind of fact once for the whole floor, not
once per table" (`apps/server/src/table-signals.test.ts:768-817`, a `DatabaseSync.prototype.prepare`
spy comparing one party with three).

**A table's department.** A table's department is its zone's `zone_service_policies.department_id`
(`packages/venue-service/src/schema/service.ts:52-76`); Needs clearing reads it with
`dining_tables` ⋈ `zone_service_policies` ⋈ `departments` (`packages/venue-service/src/table-clearing.ts:11-18`),
so a table whose zone has no policy row is in no department (slice 1 plan, Decision 3).

**The steps (slice 7).** `service_steps` (`packages/venue-service/src/schema/service-steps.ts`):
`department_id`, `position`, `name`, `start` (`seated`, `after_previous`, `course_served`,
`all_served`, `since_last_order`), `course_id` (set only for `course_served`), `minutes` (0–120, at
least 1 for `since_last_order`); classified `state`
(`packages/venue-service/src/classification.ts:9`). The department save keeps each kept step's id
and deletes the rest (`saveServiceSteps`, `packages/venue-service/src/service-steps.ts:54-110`,
delete at `:94-96`). A department delete deletes its steps
(`packages/venue-service/src/service-delete-settings.ts:449`); a course delete deletes the steps
that start from it (slice 7 Decision 3). A configuration import deletes every row of every
declared table, `service_steps` included, with `pragma defer_foreign_keys = on`
(`packages/provisioning/src/configuration-transfer.ts:697-709`). The provisioned default
department and every department `createDepartment` makes start with Set up (seated, 0), Take order
(after the step before, 2) and Anything else? (everything served, 10), named in Spanish unless the
first receipt language is English (`addStarterServiceSteps`, `service-steps.ts:110-135`).

**Orders, serving and drafts.** A party's order is sent through `placeGroups`
(`apps/server/src/order-groups.ts:235`; the till's draft submit reaches it,
`apps/server/src/order-drafts.ts` `submitDraft`), which records one `order_group_events` row per
group, kind `submitted`, or `joined` when the dishes join a held group (`order-groups.ts:388-397`;
kinds at `packages/db/src/schema/order-groups.ts:56-63`; `created_at` defaults to `nowIso`).
Firing a held group records `fired`, not an order. The product `addTabRound`
(`apps/server/src/working-order.ts:2781`) records none; I believe it is reached by tests only:
`git grep -n "addTabRound(" -- apps/server/src ':!*.test.ts' ':!apps/server/src/testing/*'` names
only its definition. A line's course is `working_order_lines.course_id`, its full serving
`served_at`, "Set only once the whole line is served" (`packages/db/src/schema/orders.ts:193-197`);
food cancelled while its charge stays is `line_service_cancellations.quantity` (slice 6 plan,
Decision 1). A party's family is itself and every party merged into it (`partyFamilies`,
`apps/server/src/parties.ts:459-470`, one statement for many parties).

**Till routes.** A table-service write such as the bill request checks only a session and the
profile action `take-orders` (`requireSession(deps, c, { action: "take-orders" })`), then
`checkZones(tx, deps.cfg, session, [{ partyId }])` inside its one `withTransaction`
(`apps/server/src/till-api.ts:2925-2940`). `requireSession` checks a person permission only when
given one (`apps/server/src/till-session.ts:92-130`). The permission list
(`packages/identity/src/permissions.ts:5-39`) has no ordering or table-service permission; staff
hold only `sale.take_payment` (`:45`). Codes map to HTTP statuses in `STATUS`
(`apps/server/src/till-api.ts:416`, `"party.not_open": 409` at `:588`). A party id that is not a
UUID is refused `party.not_open` (`requirePartyParam`, `:791-796`). The two route maps are comments
atop `apps/server/src/till-api.profile-actions.test.ts` (the map comment `:39-155`, the refusing `ROUTES`
from `:305`, the bill request at `:112` and `:431`) and
`apps/server/src/till-api.profile-zones.test.ts` (`:156`, its row at `:911-917`; a zone refusal is
`service_zone.not_allowed`, `:483`).

**The till's floor.** The floor screen redraws itself at the next reminder or held countdown change
(`#watchReminders`, `apps/till/src/screens/till-floor-screen.ts:949-963`; the design cites
`:717-728`, drift) and re-reads the floor every 15 s in map view only (`#watchFloor`, `:931-941`);
after a write, `till-app` re-reads it (`#onMarkCleared`, `apps/till/src/till-app.ts:15884-15893`,
`await this.#refreshFloor()`). The map takes its tables again only when one of `#zoneOnScreen`'s
inputs changes, `reminderClock` among them (`till-floor-screen.ts:2165-2176`;
`floor-look.ts:275-283`). A list card is one `<button class="card">` (`#card`,
`till-floor-screen.ts:2717-2739`); a card needing clearing is "a plain box instead" because "A card
is one button" (`:2647-2690`). The card's marks are sorted by `byPrecedence`
(`:2736`, `#marks` at `:2741-2789`), the signal chips coming from `tableChips`
(`:178-184`). The unplaced token gets the same chips through `#toFloorTable` (`:2132-2161`). The
details sheet is `till-table-details-sheet` (the design calls it `wt-table-details`), which draws
`signalChips` sorted by precedence (`apps/till/src/widgets/table-details-sheet.ts:207-231`) and
closes after Mark cleared (`:137-140`). The order screen's status pin is `pinLook`
(`floor-look.ts:254-262`, used by `apps/till/src/widgets/table-status.ts:108`). The floor screen
already receives `canChangeToday=${this.capabilities.includes("take-orders")}`
(`till-app.ts:17451`). A refused table write shows its code's sentence when the code is in
`TABLE_REFUSALS` (`till-app.ts:525-559`, `tableWriteError` at `:650-659`), else a generic one;
sentences live in `apps/till/src/i18n/codes.ts`.

## Global constraints

- **Words.** New till strings in `apps/till/src/i18n/strings.ts`, English and Spanish:
  `floor.step_done` "Done" / «Hecho» (the till's Spanish for Done elsewhere: `make_now.dismiss`,
  `cancel_credit.done_action`, `strings.ts:3000`, `:3349`); `floor.step_done_label` "Done: {step}"
  / «Hecho: {step}» (the Done button's accessible name, so two Done buttons on one screen are told
  apart). A code sentence in `apps/till/src/i18n/codes.ts`: `service_step.not_found` "This step no
  longer exists" / «Este paso ya no existe», without a full stop, as its twin `table.not_found`
  (corrected 2026-10-22 by the Task 6 ruling). `signal.take_order` is deleted in Task 9 (nothing
  reads it then). A step's own name is venue data and is shown as stored, never translated. Help
  and guide words: Task 10. No other new words.
- **English in code.** Spanish only in `strings.ts`, `codes.ts`, `help-strings.ts` and
  `apps/server/src/guide/es/`; a test of Spanish text reads `es[...]`. `scripts/english-only.test.ts`
  skips `apps/*`, so review greps the diff.
- **Tokens only** (CLAUDE.md §3): every colour, spacing, radius and size reads a `--wt-*` token;
  text in the brand colour reads `--wt-color-primary-text`. Guards:
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
- **Bounded reads.** `readTableSteps` runs six statements for all the parties it is given, none for
  none, each awaited in turn on the caller's transaction — never in a loop over parties or tables,
  never in `Promise.all` (CLAUDE.md §3).
- **Times are compared as numbers.** Every time read from the database is turned into milliseconds
  with `Date.parse` and compared or maximised in TypeScript, never `max()` over text in SQL
  (CLAUDE.md §3, "A time stored as text and compared or sorted as text is right only while every
  writer stores one spelling").
- **One transaction per request**; the Done route opens exactly one `withTransaction` (CLAUDE.md
  §3). `service_step_completions` is not in `scripts/write-path-tables.json` (which lists
  `deployment`, `mirror_config`, `node_roles`, `nodes` and `tenants` only), so that rule does not
  apply.
- **Migrations:** generated by drizzle-kit, numbered by the tool, never hand-edited; a collision on
  rebase is fixed by regeneration (CLAUDE.md §3). No shipped migration file is edited.
- **Coverage 98/98/98/95** in every package touched (CI enforces it; run `pnpm --filter <pkg>
  test:coverage` locally only when chasing a failure).
- **Changing an existing test assertion is a stop** unless it is in "Changed checks" below. Setup
  that only follows the type (a fixture's `{ kind: "take_order" }` becoming a `service_step`
  signal), or a test venue's setup losing its provisioned steps (Task 4, Decision 9), is not an
  assertion change. A whole-row `toEqual` that turns red with only the new key missing is fixed by
  adding the key and named in the pull request; any other red is a stop and a report (owner rule
  2026-10-05). Golden and fiscal tests are never changed.
- **Read the `Tests` count, never the exit status** (CLAUDE.md §4); unset `AI_AGENT` and
  `CLAUDECODE` to see console output. A `-t` filter selects by test name.
- Every commit `git commit -s`. Every task ends with its focused tests, `pnpm --filter <pkg>
  typecheck` for each package it touched, and `pnpm exec prettier --check <changed files>`
  (`pnpm exec prettier --file-info <file>` for anything under `docs/`, which is ignored).
  `apps/till` runs in real Chromium: check `memory_pressure | grep free` first and size
  concurrency to it. An implementer past about 150 tool calls with the task unfinished stops at a
  passing or cleanly red point, commits, and returns a handover (done, left, files, each check's
  state).

## Decisions (with receipts)

1. **Storage: `service_step_completions`, one row per Done, classified `state`.** In
   `packages/venue-service/src/schema/service-steps.ts`, beside `serviceSteps`:

   ```ts
   export const serviceStepCompletions = table(
     "service_step_completions",
     {
       id: id("id").primaryKey().$defaultFn(newId),
       partyId: id("party_id").notNull(),
       stepId: id("step_id").notNull(),
       doneAt: tsString("done_at").notNull(),
       // A plain person id: persons is in @waitron/identity's migration set.
       doneBy: id("done_by").notNull(),
     },
     (t) => [
       foreignKey({ columns: [t.partyId], foreignColumns: [parties.id],
         name: "service_step_completions_party_fk" }).onDelete("cascade"),
       foreignKey({ columns: [t.stepId], foreignColumns: [serviceSteps.id],
         name: "service_step_completions_step_fk" }).onDelete("cascade"),
       index("service_step_completions_party_idx").on(t.partyId, t.stepId),
       index("service_step_completions_step_idx").on(t.stepId),
     ],
   );
   ```

   - **One row per Done, not one per step.** Insert-only: a step that starts again and is done
     again gets a second row, and the reader takes the latest per party and step. No unique index,
     so no upsert and no conflict target to get wrong (CLAUDE.md §3 on untargeted
     `onConflictDoNothing`); a double tap writes nothing the second time because the step is no
     longer live (Decision 5).
   - **`state`, beside `party_allergy`**: live service state of a seated party, copied to a
     standby, never drained back — the class venue-service gives every other party-scoped table
     (`party_allergy`, `party_allergy_guests`, `allergy_line_ticks`, `classification.ts:43-45`).
     Not `local` (a standby taking over must know which steps were done); not `ledger`/append-only
     (its rows go with their step, below, which a `RAISE(ABORT)` delete trigger would refuse).
     Both foreign keys join `state` tables (`parties` is `state`,
     `packages/db/src/classification.ts:176`; `service_steps` is `state`), so
     `scripts/two-file-foreign-keys.test.ts` holds.
   - **Cascade on both keys**, as `party_allergy` cascades from `parties`
     (`packages/venue-service/src/schema/party-allergy.ts:22-24`). What happens to the rows:
     - **a step edited** in the department dialog (renamed, moved, minutes or start changed) keeps
       its id (`saveServiceSteps` updates kept ids, `service-steps.ts:97-107`), so its rows stay; a
       Done before the edited step's new start does not clear it (Decision 3);
     - **a step deleted** — dropped in the dialog (`:94-96`), with its course (slice 7 Decision 3),
       with its department (`service-delete-settings.ts:449`), or by a configuration import
       (`configuration-transfer.ts:697-709`) — takes its rows with it. Without the cascade every one
       of those deletes would fail on the new key; the import's deletes run with
       `defer_foreign_keys` on, and **I believe SQLite carries out a cascade at the delete
       statement even then**; Task 1's import case is the check;
     - **the party leaves**: its party row stays (closed), so its rows stay as history and no floor
       read asks for them (only seated parties are read). No product code deletes a party:
       `git grep -n "delete(parties)\|delete from parties" -- apps packages ':!*.test.ts'` finds
       none, so the party cascade serves test clean-ups and any future removal.
   - **No `requires` change**: venue-service SQL already references `parties`
     (`party-allergy.ts:22-24`); `scripts/module-graph-honesty.test.ts` is run.
   - **Not declared for configuration transfer**: completions are service history, not
     configuration; an import empties the steps and the cascade empties their completions.
   - **Migration-upgrade samples:** `scripts/migration-upgrade.test.ts` fills only tables the step
     before already had (slice 7 Decision 1), so I expect it to need no `CANDIDATES` value for this
     table; if a regeneration makes it ask for one, the owner allows sample values for a new table
     without asking — add them and say so in the pull request.
   - **Expected generated SQL:** one `CREATE TABLE \`service_step_completions\`` with the two
     foreign keys `ON DELETE cascade`, and two `CREATE INDEX`; nothing else. No `__new_` table, no
     other table touched — anything else is a stop (a rebuild of `service_steps` with foreign keys
     on would delete cascading children, CLAUDE.md §3).

2. **The shared signal.** In `packages/shared/src/table-signals.ts`, replacing `take_order` (Task 9
   removes it; Task 2 adds the new one beside it so every task stays green):

   ```ts
   /** The table's department's steps whose trigger has happened and that are not cleared, soonest due first. */
   | { kind: "service_step"; steps: ServiceStepDue[] }

   export interface ServiceStepDue {
     stepId: string;
     name: string;
     /** When the step shows: its trigger plus its minutes. May still be ahead. */
     dueAt: string;
   }
   ```

   The server sends every live step, not only the one to show, because a step still ahead can
   overtake the one showing ("the latest one started", the latest due, Decision 3) and the list view re-reads the floor only
   after this till's own actions; with the whole list the till redraws at the next `dueAt`, as it
   does for a reminder (`#watchReminders`). A table with no live step carries no `service_step`
   signal. In the server's list it goes first, where `take_order` was.

3. **The reckoning** (`liveSteps`, pure). For each step of the table's department, in list order,
   with its index `i`, a **trigger** `T` (the moment its start happened) and a **due time** `D`
   (when it starts, in §8's and Q30's sense, and shows):

   | Start | Its trigger `T` | Its due time `D` |
   |---|---|---|
   | `seated` | the party's `opened_at` | `T + minutes` |
   | `after_previous` | the latest Done of the step directly above (`i − 1`); none when `i = 0` or never done | `T + minutes` |
   | `course_served` | the latest serving end of the family's dishes of that course, once none of them is left to serve; none if no dish of it | `T + minutes` |
   | `all_served` | the latest serving end of all the family's dishes, once none is left to serve; none with no dish | `T + minutes` |
   | `since_last_order` | the repeat at `L + k·N` (below); none before the first order | `T` |

   With `F` the party's first order and `L` its last ("an order sent" is defined below), a step
   is **live** when it has a trigger and none of these holds:
   - its own latest Done is later than `T`;
   - `L` is later than `D` — **Q30: an order sent after a step is due clears it**;
   - `F` is later than `T` — the party's first order clears every step triggered before it;
   - `F` is none and the party has an open draft — before the first order, an order being taken
     hides every step.

   Live steps are listed soonest `D` first, ties in list order. The one shown is the latest due
   (driver ruling I1).

   - **"Started" is `D`, as the spec writes it** ("the latest one started", "any order sent after
     a step started"). So Dessert? (Mains served, 10) survives a drinks round sent while it waits
     out its minutes: mains served 21:32, drinks sent 21:35, Dessert? still shows at 21:42; an order
     sent at 21:43 clears it.
   - **Done is compared with `T`, not `D`**, so a Done from a till whose clock runs a little ahead
     of the server, tapped just before the server's `D`, still counts. Comparisons are strictly
     "later than", so the Done that triggers an `after_previous` step (its `T` equals that Done's
     time) does not clear it.
   - **Take order's extra rule, with no marker on the step.** Today `take_order` shows only while
     the party has no line and no open draft (`table-signals.ts:231-233`). The last two rules keep
     that for any step without knowing which one is Take order: before the first order an open
     draft (today's `drafting`, `table-signals.ts:216-223`, moved into this reader) hides every live
     step, and the first order clears every step triggered before it. Example: seated 20:30, Set up
     Done 20:33 → Take order triggered 20:33, due 20:35; the first order sent at 20:34 → Take order
     never shows. After the first order a draft hides nothing, so a dessert order being drafted
     leaves Dessert? showing until it is sent. Why no marker: there is no column today (slice 7
     Decision 7); a hidden boolean set only on the starter's Take order would need a migration on
     `service_steps` and a dashboard control the pictures do not draw, and a name match would break
     on rename and in Spanish («Tomar nota»).
   - **`since_last_order` (Q31: "every N minutes since the last order").** With `N = minutes ×
     60 000`: `k = max(1, floor((now − L) / N))`, `T = L + k·N`; if the step's latest Done is later
     than that `T`, the next repeat after the Done, `T = L + (floor((done − L) / N) + 1)·N`. `T` may
     be ahead of now: the step is then live and not yet due. Q31's example: last round 22:00, N 20 →
     "Drinks?" at 22:20; Done at 22:21 → again at 22:40; an order at 22:30 moves `L`, so the next is
     22:50.
     **2026-10-22, as built (Task 5 ruling):** the formula above let a Done tapped before the first
     repeat clear nothing. The built rule (`triggerOf`, `apps/server/src/service-step-reckoning.ts`):
     with `shown(t) = L + max(1, floor((t − L) / N))·N`, the repeat showing at `t` (before any
     repeat has come, the first), `T = shown(now)`; if the step's latest Done is later than `L`,
     `T = max(shown(now), shown(done) + N)`. So a Done clears the repeat showing when it was tapped
     and the next repeat after it shows next: last round 22:00, N 20, Done at 22:10 → next 22:40.
   - **Dishes, reckoned as the fire reminder reckons them** (§8 start 3 cites `releaseReminder`):
     the same three filters as `readReleaseReminders` — `isNull(workingOrderLines.parentLineId)`,
     `onShownBill()` and `not(isRecalledDish(tx))` (`apps/server/src/order-groups.ts:1497-1508`;
     `onShownBill` at `:1657-1659`, `isRecalledDish` at `apps/server/src/draft-source.ts:34`) — over
     the family's bills, selecting `servedAt`, `servedQuantity`, `quantity`,
     `coalesce(line_service_cancellations.quantity, 0)` and `line_service_cancellations.cancelled_at`.
     A dish is left to serve while `serviceQuantities(...).remaining > 0`, and its serving end is
     `serviceCompletedAt(...)` (`apps/server/src/line-service-state.ts:20-49`): the later of its
     serving and the cancellation of its rest, or the cancellation time for a dish cancelled whole.
     Held dishes are unserved, so "nothing is held" (§8 start 4) needs no rule of its own.
   - **An order sent** is a `submitted` or `joined` `order_group_events` row of the party or a party
     merged into it (`order-groups.ts:388-397`); firing a held course is not one. One statement
     reads them; `F` is the earliest and `L` the latest per party, by `Date.parse`.
   - **"After the step before" triggers only from a Done on the step above**, never from an order
     clearing it: when guests order before anyone taps Set up, Take order never starts, which is
     right; the price is that a "Coffee? · after the step before" under "Dessert?" never starts when
     dessert was ordered rather than Done. Owner point 1.

   Worked through §8's example with Set up (seated, 0), Take order (after the step before, 2), a
   Mains course, Dessert? (Mains served, 10): 20:30 seated → Set up due 20:30; Done 20:33 → Set up
   not live, Take order triggered 20:33, due 20:35; first order sent 20:36 → Take order not live
   (an order after its due time, and the first order after its trigger); mains all served 21:32 →
   Dessert? due 21:42; Done 21:45 → nothing live. Task 2 pins exactly this.

4. **Which department's steps a table shows: its own zone's.** One statement joins the seated
   tables to `zone_service_policies` and `service_steps` (the join of
   `packages/venue-service/src/table-clearing.ts:11-18`,
   without the `needs_clearing` filter, ordered by position then id). A table whose zone has no
   policy row shows no steps (slice 1 Decision 3's rule). A party seated across tables of two
   departments shows each table its own department's step, reckoned from the same party facts;
   Done on one clears only that department's steps (step ids are per department). Tables of one
   department carry the same steps. (2026-10-22: no path today seats a party across zones; the
   two-department case is a guard.)

5. **The Done route.** `POST /api/parties/:id/service-steps/:stepId/done`, no body, answering 200
   `{ cleared: string[] }` — the step ids it recorded.
   **2026-10-22, as built (review fix):** the body is `{ dueAt }`, required — the `dueAt` the floor
   read sent for the step the till showed, refused otherwise as `management.request_invalid`
   `{ field: "dueAt" }` (`{ field: "body" }` when the body is not an object). Without it, two Done requests either side of an every-N-minutes repeat
   both wrote a row and the second hid the next repeat. A Done for a showing already cleared — by
   the step's own Done or an order sent once it was due — answers `{ cleared: [] }`
   (`stepsClearedByDone`, `apps/server/src/service-step-reckoning.ts`).
   - **Who may:** a signed-in, admitted person on a device whose profile has `take-orders`
     (`requireSession(deps, c, { action: "take-orders" })`), and **no person permission** — as
     every table-service write (`/bill-request`, `/name`, `/guests`, `/finish`,
     `till-api.profile-actions.test.ts:112-114`). No permission in the list fits
     (`permissions.ts:5-39`), and a new one would go against the permissions review's "fewer,
     coarser" direction (`permissions.ts:6-7`). So the profile-action map gains a row and
     `ROUTES` an `ordering(...)` row, and the profile-zones map a `party` row with its refusing
     case.
   - **In one `withTransaction`:** `checkZones(tx, deps.cfg, session, [{ partyId }])`; then
     `markServiceStepDone(tx, { partyId, stepId, personId: session.personId, nowMs: Date.now() })`:
     1. the party, `select state, opened_at from parties where id = ?` — absent or not `open` →
        `party.not_open` `{ partyId }` (the code `requirePartyParam` and the group commands use);
     2. its tables, `party_tables` with `left_at` null;
     3. `readTableSteps(tx, [{ partyId, openedAt, tableIds }], nowMs)` (Task 3b);
     4. the department whose steps include `stepId` among the party's tables; none →
        `service_step.not_found` `{ stepId }` (a step deleted meanwhile, or another department's);
     5. if `stepId` is not live, answer `{ cleared: [] }` and write nothing (a second tap, another
        till's Done, or an order sent meanwhile);
     6. else record a completion for it and for every other live step of that department whose `D`
        is at or before its `D` — the steps it was hiding — all at one `doneAt` (`new Date(nowMs).toISOString()`, so the time written is the time the
        reckoning used) and `doneBy` = the session's person, in one insert; answer their ids. A party
        at two tables of one department reads the same steps for both tables, so the step ids are
        de-duplicated before the insert and in `cleared`.
   - **A live step not yet due is accepted**: the till shows Done only once a step is due by its
     own clock, and a till a few seconds ahead of the server must not be refused. Owner point 3.
   - **`service_step.not_found`** is declared again in `apps/server/src/errors.ts` with venue-service's
     params, `{ stepId: string }` (`packages/venue-service/src/errors.ts:53`): every file that
     throws a code imports its registry (CLAUDE.md §3), and identical declarations merge (measured
     by slice 7 with `tsc` 7.0.2, its Decision 8). `STATUS` gains `"service_step.not_found": 404`.
     A step id that is not a UUID is refused the same code, and a UUID is lower-cased
     (`requireStepParam`, beside and like `requireDraftParam`, `till-api.ts:1091-1094`). No incident is recorded, so
     `scripts/alert-codes.test.ts` gains nothing; it and `scripts/errors-reachable.test.ts` are run.
   - **No party revision**: Done does not take or bump `parties.revision`, so another till's open
     order screen is not made stale by it; its idempotence comes from step 5.

6. **The card.** A card whose current step is shown with Done cannot stay one `<button>` (a button
   inside a button is invalid and fails axe's `nested-interactive`). Only such a card changes
   shape; every other card stays `<button class="card">`:
   - `<div class="card state-… step-card" data-table data-top @click=open>` — the same classes, so
     the card's look is unchanged; the `@click` on the box keeps every existing
     `[data-table="…"]` click working;
   - inside it, first, `<button class="card-open" data-card-open aria-label=…>` laid over the whole
     card (`position: absolute; inset: 0`, transparent) for the keyboard, with no handler of its own
     (its click bubbles to the box). Its name is the table's shown name and the map's spoken
     description of it, `${shownUnder(table)}, ${mapLook([table], now).description}`, e.g. "T9,
     Seated, Dessert?" — the words the map already speaks for that table; the card's text stays in
     the page for reading;
   - then today's content (ring, head, party name, occupancy, marks), with the step mark drawn by
     `stepChip` in its precedence place among the marks; its Done button is
     `position: relative; z-index: 1` above the cover, and its click calls `stopPropagation()` so
     the table does not open.
   - **The step chip** (`apps/till/src/widgets/step-chip.ts`, till-local): `<span class="step-chip"
     data-chip="service-step" data-step=${stepId}>` holding `<span class="step-name"><wt-icon
     name="floor-step" size="sm"></wt-icon>${name}</span>` and `<button type="button" class="step-done"
     data-step-done=${stepId} aria-label=${floor.step_done_label}>${floor.step_done}</button>`. The
     name segment is `--wt-color-primary` with `--wt-color-on-primary` text (the `primary-filled`
     pair, `packages/ui/src/floor-chips.ts:82-86`); the Done segment `--wt-color-surface-raised`
     with `--wt-color-text`, a 1 px `--wt-color-primary` line between; the chip outlined 1 px
     `--wt-color-primary`, `--wt-radius-sm`, `--wt-font-size-sm` bold; Done at least
     `--wt-tap-min` tall and wide (owner point 10), with `outline: var(--wt-focus-ring);
     outline-offset: var(--wt-focus-offset)` on `:focus-visible`. A long name wraps inside the
     chip (`overflow-wrap: anywhere`, as `signalChipStyles` does, `signal-chips.ts:128-131`).
   - **Where Done is not offered** — the unplaced token, and a device whose profile lacks
     `take-orders` — the step is the plain chip `signalChips` gives: key `service-step`, tone
     `primary-filled`, icon `floor-step`, the step's name.
   - The card's left edge stays solid blue while a step shows (`.card.state-open-tab`,
     `till-floor-screen.ts:557-559`), as picture 10 draws; nothing changes there.

7. **The till reads the step.** `apps/till/src/state/service-steps.ts`:
   `currentStep(signals, now): ServiceStepDue | null` — the last step of the `service_step` signal
   whose `dueAt` is at or before `now` (the list is soonest first, so the last one due is the
   latest due, which §8 calls "the latest one started"); `nextStepDueAt(signals, now): number` — the first `dueAt` after `now`, else
   `Number.POSITIVE_INFINITY`. Then: `tableStates` adds `step` when `currentStep` is not null;
   `signalChips(signals, { forgottenShown, now })` gives the plain step chip (callers without a
   clock pass none and get no step chip — the held-orders list and the order screen's bill-request
   chip, whose signals never hold a step); the map's `step` cue is `{ icon: "floor-step", text:
   name }` and its words the name, from the member whose current step falls due latest (a merge's
   counts come from one member, slice 5 Decision 10); `reminderClock` adds each table's current
   step id, so the map takes new looks when a step falls due; `#watchReminders` also wakes at the
   soonest `nextStepDueAt`. The map's cue is cut with an ellipsis already (slice 5 Decision 4); the
   details sheet shows the name whole.

8. **Done in the till.** The floor screen and the details sheet send `service-step-done` with
   `{ partyId, stepId, tableId }` (app-owned components may name events plainly, CLAUDE.md §3);
   the sheet then closes, as after Mark cleared. `till-app` calls
   `this.api.markServiceStepDone(partyId, stepId)`, shows a refusal with `stepDoneError` — the
   table refusals plus `service_step.not_found`, `service_zone.not_allowed` and
   `device.forbidden_action`, so no other table write's messages change — and re-reads the floor
   either way (`await this.#refreshFloor()`), as `#onMarkCleared` does. No busy state: the route is
   idempotent, so a second tap before the re-read changes nothing. Both components take
   `canMarkSteps`, set from `this.capabilities.includes("take-orders")` — today the same value as
   `canChangeToday` (`till-app.ts:17451`), kept as its own property because it means something
   else: if changing today's floor later gets its own profile action, Done must not quietly follow
   it.

9. **Test venues start with no steps.** The party suites' provisioned venue now holds the three
   starter steps (slice 7), and with this slice Set up (seated, 0) would show on every seated table
   of every floor read, turning red dozens of assertions written about a floor without steps —
   `table-signals.test.ts` alone reads a row's whole signal list 38 times
   (`grep -c "\.signals)" apps/server/src/table-signals.test.ts`, 2026-10-22).
   So `setupPartyVenue` (`apps/server/src/testing/party-venue.ts`) deletes the provisioned
   `service_steps` rows after provisioning, with one comment: "A test venue starts with no service
   steps; a suite that tests them adds its own." That is setup, not an assertion change, and it
   hides no code from coverage. A suite on another venue fixture that turns red only because of a
   provisioned starter step's `service_step` signal gets the same delete in its own setup, named in
   the pull request. Task 3b proves the starter set itself reaches the floor. `createDepartment`
   also writes the starter steps (`packages/venue-service/src/operations.ts:214`), and
   `createZone` in `apps/server/src/testing/service-zone.ts` calls it when the venue has no active
   department, so a second department made in a test starts with the starters (Spanish names in the es-ES test venue): Tasks 3b and 5
   replace them with `setSteps` before relying on a department's list.

10. **Help, guide and design system.** `help.floor.tables_list` gains a sentence about Done and the
    two map help texts one about the details' Done (Task 10). The user guide has no floor page
    today (`apps/server/src/guide-catalogue.ts:6-14`); the closest, `table-service`, is titled
    "Refund a payment" (`apps/server/src/i18n/table-service-guide.ts:1-4`) and holds two refund
    sections. Task 10 adds a section `{#service-steps}` to it in English and Spanish and retitles
    the page "Table service" / «Servicio en mesa» (owner point 14). `design-system.md:943`, the
    floor states paragraph, gains the step chip and the step card's shape.

## Review focus

1. **A party at two tables in two departments**: each table shows its own department's step, and
   Done on one leaves the other's — Tasks 3b and 5.
2. **A double tap, or two tills tapping Done**: one set of rows, the second answer `{ cleared: [] }`
   — Task 5.
3. **A step deleted in the dashboard while a till shows it**: Done answers 404
   `service_step.not_found`, the till says "This step no longer exists" and re-reads the floor;
   the step's completions went with it — Tasks 1, 5 and 8.
4. **A step falling due while the floor sits idle in list view**: the card shows it at its due
   minute with no re-read, and the map's look changes too — Tasks 6 and 7b.
5. **Guests order while Take order is not yet due**: it never shows; **a drinks round sent while
   Dessert? waits out its minutes** leaves Dessert? to show — Tasks 2 and 4.
6. **A configuration import over a venue with completions**: it succeeds and leaves none — Task 1.

## Changed checks

Each edit below changes what an existing assertion pins because §8 makes Take order a service step
and gives steps their look (§5.4 line 431: "Take order is now a service step and looks like every
step"; slice 4 plan, Open point 11: "Take order keeps its blue-bordered chip until slice 8"). The
last column names the task that makes the edit.

| File:line | Today | After | Why | Task |
|---|---|---|---|---|
| `apps/server/src/table-signals.test.ts:221-252` "asks a just-seated party for its order until dishes are saved" | `[{ kind: "take_order" }]` before and after an empty draft; `[unsent_draft]` with a drafted line | the test adds one step, Take order (seated, 0); title "shows a just-seated party's Take order step until dishes are drafted"; `[{ kind: "service_step", steps: [{ stepId, name: "Take order", dueAt: <the party's opened_at> }] }]` before and after the empty draft; `[unsent_draft]` with a drafted line (unchanged) | §8 start 1; before the first order a draft hides every step (Decision 3) | 4 |
| `apps/server/src/table-signals.test.ts:257-264` "stops asking for the order once a line is on a bill" | `order()` (the test-only `addTabRound`) then `signals` `[]` | adds the Take order step, orders with `orderForParty` (`party-venue.ts:248-268`, which sends through `placeGroups`), title "clears the Take order step once the first order is sent", `signals` `[]` | the first order clears every step triggered before it; `addTabRound` records no order (Decision 3) | 4 |
| `apps/server/src/canvas-retirement-upgrade.test.ts:498-512` | `retained` lists `service_steps: []` and the other tables made after its starting point | gains `service_step_completions: []` | a whole-shape expectation gaining the new table (slice 7 measured the same failure for its table, its "Whole-suite measurement") | 1 |
| `apps/till/src/widgets/signal-chips.test.ts:49-52` "draws the overdue wait with the timer, and Take order with no icon" | `signalChips([{ kind: "take_order" }])[0]?.icon` undefined | title "…and a service step with the bell"; a due step's chip has icon `floor-step`, text the step's name, tone `primary-filled`, key `service-step` | §4 row 8 cue "🛎 and the step's name"; picture 10's bell | 6 |
| `apps/till/src/widgets/signal-chips.test.ts:55-58` (chipState) | `{ kind: "take_order" }` → `step` | a due `service_step` → `step`; one not yet due gives no chip | same state, new signal | 6 |
| `apps/till/src/state/table-precedence.test.ts:101` | `["step", { signals: [take_order] }, ["step"]]` | a due step → `["step"]`; new row: a step not yet due ranks nothing (`step` absent) | `currentStep` (Decision 7) | 6 |
| `apps/till/src/state/floor-look.test.ts:90`, `:172-181`, `:292-299`, `:458` | cue and words `en["signal.take_order"]` | the step's name ("Take order", the fixture's); `:458` calls `kindWords("step", …)` on a table with no signal, so it gains `signals: [dueStepSignal("Take order")]` | §4 row 8, §6 | 6 |
| `apps/till/src/screens/till-floor-screen.signals.test.ts:205-237` "says the signals in Spanish" | keys list holds `signal.take_order`; last chip `es["signal.take_order"]` | `signal.take_order` leaves the keys list; the last chip is the fixture step's stored name, "Take order", untranslated; the other chips unchanged | a step's name is venue data; `signal.take_order` retires | 6 |
| `apps/till/src/screens/till-floor-screen.precedence.test.ts:375-401` "lists every mark, most urgent first…" | `'[data-chip="take-order"]'` sixth | `'[data-chip="service-step"]'` sixth — same place | same rank, new mark | 6 |
| `apps/till/src/screens/till-floor-screen.a11y.test.ts:473-500` "has no violations with signals side by side…, on the list" | mounted with `{ zones, tables, canOpenStation: true }` | also `canMarkSteps: true`, so axe checks the card with Done in both themes; its assertions unchanged | Decision 6 | 7b |

Fixture-only changes, all made by **Task 6** (each `{ kind: "take_order" }` becomes
`dueStepSignal("Take order")`, a due step; each assertion stays): `signal-chips.test.ts:102`,
`table-precedence.test.ts:162`, `:187`, `till-floor-screen.signals.test.ts:155` (its card is
mounted without `canMarkSteps`, so the plain chip reads "Take order", as the assertion at `:156`
expects), `:311`, `till-floor-screen.precedence.test.ts:206`, `:565`,
`till-floor-screen.zone-tabs.test.ts:237`, `:284`, `:471`, `:799`, `:911`, `:966`, `:1114`,
`:1150`, `:1247`, `till-floor-screen.a11y.test.ts:481`, `:677` (a zone-tab case: the table is off
screen and never draws Done; the zone states it asserts at `:712` keep `"step"`),
`apps/till/src/widgets/table-details-sheet.a11y.test.ts:41`,
`apps/till/src/widgets/table-status.a11y.test.ts:65`.

---

## Tasks

### Task 1: the completions table and its migration (venue-service)

**Files:**
- Modify: `packages/venue-service/src/schema/service-steps.ts` (Decision 1's table; imports
  `parties`, `tsString` from `@waitron/db`)
- Modify: `packages/venue-service/src/classification.ts` (`classify("service_step_completions",
  "state", STATE)` after `service_steps`)
- Create (generated): `packages/venue-service/drizzle/NNNN_service_step_completions.sql`, its
  snapshot and journal entry — `cd packages/venue-service && ./node_modules/.bin/drizzle-kit
  generate --name service_step_completions`; never number or edit by hand
- Modify: `apps/server/src/canvas-retirement-upgrade.test.ts` (Changed checks)
- Test: `packages/venue-service/src/schema/service-steps.test.ts`,
  `packages/venue-service/src/service-steps.test.ts`, a new
  `apps/server/src/configuration-import.service-steps.test.ts`, and a case in
  `apps/server/src/course-delete.service-steps.test.ts`

**Interfaces — produces:** `serviceStepCompletions` (exported from the schema barrel, which already
re-exports `./service-steps.js`).

- [ ] **Step 1: Write the failing tests.** Rows are inserted with `tx.insert(serviceStepCompletions)`
  (setup), parties with `tx.insert(parties).values({ openedBy: "sender" })` as
  `packages/venue-service/src/department-transfers.test.ts:312` does.
  - `schema/service-steps.test.ts`: `"keeps who tapped Done on a step, and when"` (read back);
    `"refuses a completion naming no party or no step"` — `FOREIGN KEY constraint failed`, caught
    outside the transaction; `"deletes a step's completions with the step, and a party's with the
    party"`.
  - `service-steps.test.ts`: `"a department save keeps a renamed step's completions and drops a
    removed step's"` (`saveServiceSteps` with the first step renamed and the second left out);
    `"a department delete takes its steps' completions"` (through the department delete that
    calls `service-delete-settings.ts:449`; find its test helper in
    `packages/venue-service/src/service-delete*.test.ts`).
  - `apps/server/src/course-delete.service-steps.test.ts`: `"deleting a course deletes the
    completions of the steps it deletes"`.
  - `apps/server/src/configuration-import.service-steps.test.ts`: `"a configuration import over a
    venue whose closed party has a completed step succeeds and leaves no completion"` — set up as
    `apps/server/src/configuration-import.test.ts` imports a bundle (read it first); the party is
    closed so the case does not depend on whether an import is allowed while parties sit.
- [ ] **Step 2: Run them and watch them fail** (no table), reading each `Tests` count:
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/schema/service-steps.test.ts src/service-steps.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/course-delete.service-steps.test.ts src/configuration-import.service-steps.test.ts`
- [ ] **Step 3: Add the schema and classification, and generate.** Read the SQL: Decision 1's
  "Expected generated SQL" or stop.
- [ ] **Step 4: Run Step 2's commands** — PASS. If the import case fails with `FOREIGN KEY
  constraint failed`, the cascade does not run under `defer_foreign_keys`: stop and report (the
  import would then need to delete completions itself, which is a design change).
- [ ] **Step 5: Guards**, each `Tests` count read:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/live-subscriptions.test.ts`;
  `pnpm --filter @waitron/venue-service exec vitest run src/schema/schema-conformance.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts`
  (unedited); `pnpm --filter @waitron/server exec vitest run src/canvas-retirement-upgrade.test.ts src/in-use-references.test.ts src/provision.test.ts`
  — the first fails until `service_step_completions: []` is added (Changed checks), then passes.
  **Control:** remove the `classify` line and see `classification-complete` fail naming the table;
  restore. Record the guard counts and the control in the commit message.
- [ ] **Step 6:** typecheck `@waitron/venue-service` and `@waitron/server`; prettier; commit —
  `"Record each Done on a party's service step, deleted with its step or party (A757 slice 8)"`.

### Task 2: the shared signal and the pure reckoning

**Files:**
- Modify: `packages/shared/src/table-signals.ts` (Decision 2; keep `take_order` for now),
  `packages/shared/src/index.ts` (export `ServiceStepDue`)
- Modify: `apps/till/src/widgets/signal-chips.ts` — only `case "service_step": return [];` so the
  till compiles (Task 6 replaces it)
- Create: `apps/server/src/service-step-reckoning.ts`, `apps/server/src/service-step-reckoning.test.ts`
  (Node, no database)

**Interfaces — produces:**
- `interface StepRule { id: string; name: string; start: ServiceStepStart; courseId: string | null; minutes: number }`
  (declared here, importing `ServiceStepStart` from `@waitron/venue-service`; Task 3a moves it to
  venue-service)
- `interface StepFacts { openedAt: number; firstOrderAt: number | null; lastOrderAt: number | null; drafting: boolean; courseServedAt: ReadonlyMap<string, number>; allServedAt: number | null; doneAt: ReadonlyMap<string, number> }`
- `interface LiveStep { stepId: string; name: string; triggeredAt: number; dueAt: number }`
- `liveSteps(rules: readonly StepRule[], facts: StepFacts, nowMs: number): LiveStep[]` — Decision 3
- `interface DishServing { courseId: string | null; quantity: number; servedQuantity: number; servedAt: string | null; cancelledQuantity: number; cancelledAt: string | null }`
  (quantities in thousandths, as stored; the shape `serviceCompletedAt` takes, plus the course)
- `servedTimes(dishes: readonly DishServing[]): { courseServedAt: Map<string, number>; allServedAt: number | null }`,
  built on `serviceQuantities` and `serviceCompletedAt` (`apps/server/src/line-service-state.ts:20-49`)

- [ ] **Step 1: Write the failing tests** (times built from one base instant; names as listed):
  - `"the worked example of the design's §8"` — Decision 3's last paragraph, asserting the live
    list at 20:30, 20:34, 20:36, 21:41, 21:42 and 21:46;
  - `"a seated step is due its minutes after the party sat down"`;
  - `"after the step before is triggered by the Done of the step above, and never for the first
    step"`;
  - `"a course served is triggered by its latest serving end once none of it is left, and never for
    a course not ordered"`; `"everything served needs a dish and none left, and starts again after
    the next serving"`;
  - `"every N minutes since the last order repeats, a Done stops only the current repeat, and
    nothing comes before the first order"` (Q31's 22:00 / 22:20 / 22:21 / 22:40 / 22:30 → 22:50);
  - `"a Done after a step's trigger clears it; one before its next trigger does not"`;
  - `"an order sent after a step is due clears it"`;
  - `"an order sent while a step waits out its minutes leaves it, unless it is the party's first
    order"` — the 20:34 case clears Take order; a second order in the same window leaves a step;
  - `"Dessert? survives a drinks round sent while it waits out its minutes"` — mains served 21:32,
    drinks sent 21:35 (not the first order), Dessert? live and due 21:42; an order at 21:43 clears
    it;
  - `"the Done that triggers the next step does not clear it"` (equal instants);
  - `"before the first order an open draft hides every step; after it a draft hides none"`;
  - `"lists live steps soonest due first, ties in list order"`;
  - `servedTimes`: a dish whose remainder was cancelled gives the cancellation time when that is
    later than its serving; a dish cancelled whole gives its cancellation time; a part-served dish
    keeps its course unserved; a dish with nothing left to serve but no serving time
    (`serviceCompletedAt` returns null) keeps its course, and everything served, unserved, as the
    fire reminder treats a null serving time (`apps/server/src/order-groups.ts:1444`); dishes with
    no course count only for everything served.
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/server exec vitest run src/service-step-reckoning.test.ts`
- [ ] **Step 3: Implement**; one doc comment on `liveSteps` naming trigger and due time and the
  four rules that end a step; no others.
- [ ] **Step 4: Run** — PASS; prove three rules by deletion: drop the first-order rule (the 20:34
  case fails), compare orders with the trigger instead of the due time (the Dessert? case fails),
  drop the draft rule (the draft case fails); restore; record all three.
- [ ] **Step 5:** typecheck `@waitron/shared`, `@waitron/server`, `@waitron/till`; prettier;
  commit — `"Work out which service steps a party is due for (A757 slice 8)"`.

### Task 3a: venue-service reads and writes the steps and their completions

**Files:**
- Create: `packages/venue-service/src/service-step-completions.ts`,
  `packages/venue-service/src/service-step-completions.test.ts` (node project); modify
  `packages/venue-service/src/index.ts` (exports)
- Modify: `apps/server/src/service-step-reckoning.ts` (import `StepRule` from venue-service)

**Interfaces — produces:** `StepRule` (moved here); `readTableStepRules(tx, tableIds: readonly
string[]): Promise<Map<string, { departmentId: string; rules: StepRule[] }>>` — one statement
(Decision 4), a table with a department and no steps present with `rules: []`, a table in no
department absent; `readStepCompletions(tx, partyIds: readonly string[]): Promise<{ partyId:
string; stepId: string; doneAt: string }[]>` — one statement, none for `[]`;
`recordStepCompletions(tx, rows: readonly { partyId: string; stepId: string; doneAt: string;
doneBy: string }[]): Promise<void>` — one insert, none for `[]`.

- [ ] **Step 1: Write the failing tests** (parties inserted as
  `packages/venue-service/src/department-transfers.test.ts:312` does,
  `tx.insert(parties).values({ openedBy: "sender" })`): `"reads each table's department's steps
  in list order"`, `"leaves out a table whose zone has no department"`, `"records completions and
  reads them back by party"`, and `"reads nothing and writes nothing for no ids"`.
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/service-step-completions.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; typecheck `@waitron/venue-service` and `@waitron/server`.
- [ ] **Step 5:** prettier; commit — `"Venue-service reads a table's steps and records Done (A757 slice 8)"`.

### Task 3b: reading the floor's steps in six statements

**Files:**
- Create: `apps/server/src/service-step-signals.ts`, `apps/server/src/service-step-signals.test.ts`,
  and `apps/server/src/testing/service-steps.ts` (test helpers)

**Interfaces — produces:**
- `interface StepParty { partyId: string; openedAt: string; tableIds: readonly string[] }`;
  `interface TableSteps { departmentId: string; ruleIds: ReadonlySet<string>; live: LiveStep[] }`;
  `readTableSteps(tx, parties: readonly StepParty[], nowMs: number): Promise<Map<string, TableSteps>>`
  keyed by table id; `stepSignal(steps: TableSteps | undefined): Extract<TableSignal, { kind:
  "service_step" }> | undefined` (undefined when nothing is live; `dueAt` as
  `new Date(ms).toISOString()`).
- The six statements, each once for all parties: `partyFamilies` (`parties.ts:459`);
  `readTableStepRules`; `readStepCompletions`; the family's dishes with Decision 3's three filters
  and columns → `servedTimes` per party; `order_group_events` of kinds `submitted` and `joined` for
  the family ids → the earliest (`firstOrderAt`) and latest (`lastOrderAt`) per party by
  `Date.parse`; open `order_drafts` of the parties (today's `drafting`, `table-signals.ts:216-223`).
- Test helpers: `departmentOf(v, zoneId): Promise<string>`; `setSteps(v, departmentId, steps:
  ServiceStepInput[]): Promise<string[]>` (through `saveServiceSteps`, which replaces whatever the
  department held — the starters `createDepartment` writes included — and returns ids in order);
  `setOpenedAt(v, partyId, iso)`.

- [ ] **Step 1: Write the failing tests** (`useVenueDb` with `migrationOptionsFor(manifestSets(),
  null)`, `setupPartyVenue`, which holds the starter steps until Task 4 clears them — delete them in
  this file's setup until then), each with a fixed `nowMs`:
  - `"a seated party's step is due at its seating"` (`opened_at` set by `setOpenedAt`);
  - `"a course served reads the family's dishes of that course"` (a course from `createCourse`,
    `apps/server/src/kitchen.ts:308`; `course_id` set on the lines by a direct update; all served
    with `serveLine`, `apps/server/src/testing/serve-line.ts`); `"a recalled dish and an abandoned
    bill's dishes are left out"`;
  - `"everything served is triggered once the last dish is served"`;
  - `"the first order sent through placeGroups clears a step triggered before it"`
    (`orderForParty`) and `"every N minutes since the last order counts from that order"`;
  - `"after the step before is triggered by a recorded Done"` (`recordStepCompletions`);
  - `"before the first order no step shows while the party has an open draft"` (`saveDraftForTest`
    with a line, as `table-signals.test.ts:240-247`);
  - `"a party at tables of two departments gets each table's own steps"` — a second department and
    zone made with `createDepartment` and `createServiceZone` from `@waitron/venue-service` —
    not with `service-zone.ts`'s `createZone`, which reuses the venue's existing active department
    (`apps/server/src/testing/service-zone.ts:10-16`) and so makes no second one (`createDepartment`
    writes the starters, `packages/venue-service/src/operations.ts:214`; `setSteps` replaces them);
    the party joined to a table there;
  - `"a table whose zone has no department shows no step"`;
  - `"a new venue's starter steps reach the floor"` — `addStarterServiceSteps` on the tables zone's
    department, seat: one live step named `Montar mesa` (the venue's locale is `es-ES`,
    `party-venue.ts:52`) due at the seating;
  - `"reads every fact once, whatever the number of parties"` — the `prepare` spy of
    `table-signals.test.ts:789-796`: three parties prepare as many statements as one, and none are
    prepared for `[]`.
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/server exec vitest run src/service-step-signals.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; prove the bound by deletion: read the completions inside a loop over
  parties and see the statement-count case fail; restore; record it.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit —
  `"Read every seated table's service steps in six statements (A757 slice 8)"`.

### Task 4: the floor read sends the steps; Take order goes

**Files:**
- Modify: `apps/server/src/table-signals.ts` — drop the `take_order` push and the `drafting`
  statement (`:216-233`); `tableSignals(partySignals, step, needsClearingSince)` puts `step`
  first; `SeatedPartyFacts` gains `openedAt: string`; the `TableSignal` order comment updated
- Modify: `apps/server/src/working-order.ts` — `readSeatedParties` selects `parties.openedAt`
  (`:8417-8432`) into the facts; `listTablesWithState` builds one `StepParty` per seated party and
  calls `readTableSteps(tx, stepParties, nowMs)` once beside `readPartySignals` (`:8232`), then
  `tableSignals(…, stepSignal(tableSteps.get(r.id)), …)` (`:8269`)
- Modify: `apps/server/src/testing/party-venue.ts` — Decision 9's delete
- Modify: `apps/server/src/table-signals.test.ts` (Changed checks), and remove Task 3b's temporary
  delete from `service-step-signals.test.ts`

- [ ] **Step 1: Write the failing tests** in `table-signals.test.ts`: the two Changed-checks rows;
  `"puts a due step first among a table's signals"` (a step and a ready dish); `"a step stops
  showing when the party leaves"` (`finishTable`: the table's row has no party and no
  `service_step`); and extend `"reads every kind of fact once for the whole floor"`
  (`:768-817`) by giving the tables' department steps with `setSteps` before the first count, so
  the step reads run in both counts. Each party (`seatBusyTable`, `:773-787`) orders a Caña
  through the test-only `addTabRound`, which records no order, but also holds a Burger group
  through `holdGroup` → `placeGroups`, which records a `submitted` event (`order-groups.ts:388-397`)
  — so every party has its first order and its open draft hides nothing. Give the department
  `seated` steps: the first order comes after the seating, so it clears them, no step is live and
  the kinds assertion (`:804-809`) stays unchanged. A `since_last_order` step would be live there.
  `three.count` must still equal `one.count`.
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/server exec vitest run src/table-signals.test.ts src/service-step-signals.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run every server file that reads the floor** — PASS, each `Tests` count read; re-run
  `git grep -l "listTablesWithState\|floorRow\|/api/tables/state" -- 'apps/server/src/*.test.ts'`
  first and add any new name. A red file whose only cause is a provisioned starter step's
  `service_step` signal gets Decision 9's delete in its own setup; anything else is a stop. On
  2026-10-22 it named these 40:
  `pnpm --filter @waitron/server exec vitest run src/boot.table-removal.test.ts src/current-orders.test.ts src/floor-allergy.test.ts src/floor-annotations.test.ts src/floor-catch-up.test.ts src/floor-delete.test.ts src/floor-today-api.test.ts src/floor-today-flatten-api.test.ts src/floor-today-mark-moved.test.ts src/floor-today-merge-api.test.ts src/floor-today-reset-table.test.ts src/floor-today-seat-api.test.ts src/floor-today-split-group.test.ts src/floor-today-state.test.ts src/floor-today-store.test.ts src/joined-parts.test.ts src/kitchen-timing-consumers.test.ts src/leave-for-clearing.test.ts src/order-drafts.db.test.ts src/order-kitchen-note.paths.test.ts src/parties.test.ts src/party-main-bill.test.ts src/party-table-actions.test.ts src/party-table-order.test.ts src/service-delete.integration.test.ts src/table-signals.service-lifetime.test.ts src/table-signals.test.ts src/tables.test.ts src/tabs.test.ts src/till-api.parties.test.ts src/till-api.profile-zones.test.ts src/till-api.split-bill.test.ts src/till-api.status.test.ts src/till-api.table-actions.test.ts src/till-api.tables.test.ts src/till-api.test.ts src/till-api.today-joins.test.ts src/till-sale-integrated.db.test.ts src/today-names.test.ts src/working-order-reads.sqlite.test.ts`
  (check `memory_pressure | grep free` and split the run if headroom is short).
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit —
  `"The floor read sends each table's service steps in place of Take order (A757 slice 8)"`.

### Task 5: the Done route

**Files:**
- Create: `apps/server/src/service-step-done.ts` (`markServiceStepDone`, Decision 5; imports
  `./errors.js`), `apps/server/src/service-step-done.test.ts`,
  `apps/server/src/till-api.service-steps.test.ts`
- Modify: `apps/server/src/errors.ts` (`"service_step.not_found": { stepId: string }`),
  `apps/server/src/till-api.ts` (the route beside the bill request, `:2925`; `requireStepParam`
  beside `requireDraftParam`, lower-casing as it does; `STATUS` gains
  `"service_step.not_found": 404`)
- Modify: `apps/server/src/till-api.profile-actions.test.ts` — map row
  `| POST /api/parties/:id/service-steps/:stepId/done | take-orders | take-orders |` after the
  bill-request row (`:112`), and `ordering("POST", \`/api/parties/${id}/service-steps/${id}/done\`)`
  in `ROUTES` after `:431`
- Modify: `apps/server/src/till-api.profile-zones.test.ts` — map row
  `| POST /api/parties/:id/service-steps/:stepId/done | party | refuses POST /api/parties/:id/service-steps/:stepId/done |`
  after `:156`, and its `Row` after `:917` (`deliParty`, a `randomUUID()` step id — the zone
  check runs before the step is looked up — and no body)

**Interfaces — produces:** `markServiceStepDone(tx, args: { partyId: string; stepId: string;
personId: string; nowMs: number }): Promise<{ cleared: string[] }>`; the route answers that object.

- [ ] **Step 1: Write the failing tests.** Departments a test relies on get their list from
  `setSteps` (Task 3b), which replaces the starters `createDepartment` writes.
  - `service-step-done.test.ts` (database level): `"records Done with the person and the time, and
    the step stops showing"` (`done_at` equals `new Date(nowMs).toISOString()`); `"a second Done
    writes nothing and clears nothing"`; `"Done also records the due steps the shown one was
    hiding, so their followers start"`; `"Done on a step not yet due is accepted"`; `"a party at two
    tables of one department records each step once and names it once"`; `"refuses a step of a
    department none of the party's tables is in"` and `"…a step that no longer exists"` →
    `toMatchObject({ code: "service_step.not_found", params: { stepId } })`; `"refuses a party that
    has left"` → `party.not_open`; `"Done on one department's step leaves the other table's step"`
    (Task 3b's two-department fixture).
  - `till-api.service-steps.test.ts` (mount and session as
    `apps/server/src/till-api.kitchen-note.test.ts` does — read it first): 200 and
    `{ cleared: [stepId] }`, the completion's `done_by` the session's person; a double tap answers
    `{ cleared: [] }` with one row; an upper-case step id is found; 404 `service_step.not_found`
    for a UUID that is no step and for `not-a-uuid`; 409 `party.not_open` for an unknown and a
    closed party; 401 `session.required` with no cookie; each answer's body read as
    `toEqual({ error: { code, params } })`.
  - The two map files' new rows (their suites already iterate the rows).
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/server exec vitest run src/service-step-done.test.ts src/till-api.service-steps.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2's command — PASS — and
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`. Prove the
  two gates by deletion: drop `action: "take-orders"` and see the profile-actions row fail with
  `409 party.not_open` in place of `device.forbidden_action` (its party id is random, and
  `checkZones` lets a party in no zone through, `apps/server/src/zone-access.ts:43-56`); drop
  `checkZones` and see the profile-zones row fail; restore; record both.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit —
  `"A till marks a party's service step Done (A757 slice 8)"`.

### Task 6: the till reads the step (state, chips, map words) and every `take_order` fixture moves

**Files:**
- Create: `apps/till/src/state/service-steps.ts` and its test; a test helper
  `dueStepSignal(name: string, dueAt = "2000-01-01T00:00:00.000Z"): TableSignal` in the till's
  existing test fixtures folder (`apps/till/test/`) — a fixed past instant, because the till's test
  files use different `now`s
- Modify: `apps/till/src/state/table-precedence.ts:47` (`step` from `currentStep`; `take_order`
  no longer ranks), `apps/till/src/widgets/signal-chips.ts` (the `service_step` chip with `now`;
  `chipState("service-step") → "step"`; `case "take_order"` returns `[]` — the switch has no
  default, `:28-67`, so the case stays until Task 9 removes the member; `chipState`'s
  `"take-order"` case, `:110-111`, also stays until Task 9),
  `apps/till/src/state/floor-look.ts` (`step` leaves `FIXED_CUE` and `FIXED_WORDS`; `kindWords`
  and `kindCue` read the step's name; `reminderClock` adds the current step id),
  `apps/till/src/screens/till-floor-screen.ts:178-184` (`tableChips` passes `now`),
  `apps/till/src/widgets/table-details-sheet.ts:209` (passes `this.now ?? Date.now()`)
- Modify: `apps/till/src/i18n/strings.ts` (`floor.step_done`, `floor.step_done_label`),
  `apps/till/src/i18n/codes.ts` (`service_step.not_found`), and their tests
- Modify: every till test with `{ kind: "take_order" }` — the Changed checks rows marked Task 6 and
  every fixture-only row

**Interfaces — produces:** `currentStep(signals: readonly TableSignal[], now: number):
ServiceStepDue | null`; `nextStepDueAt(signals: readonly TableSignal[], now: number): number`;
`signalChips(signals, { forgottenShown?: boolean; now?: number })`; `dueStepSignal`.

- [ ] **Step 1: Write the failing tests:** `service-steps.test.ts` — the latest due of three steps,
  none due, a step due exactly now, `nextStepDueAt` with and without a step ahead;
  `table-precedence.test.ts` — its Changed check plus "a step not yet due ranks nothing";
  `signal-chips.test.ts` — its Changed checks plus "gives no step chip without a clock";
  `floor-look.test.ts` — its Changed check plus "a merge says the step of the member due latest"
  and "`reminderClock` changes when a step falls due and not before"; `codes.test.ts` — the new
  sentence in both languages; `strings.test.ts` — both new keys in both languages, and
  `es["floor.step_done"]` equal to `es["make_now.dismiss"]`; then convert the floor screen's
  fixtures and make the Spanish and precedence Changed checks.
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/till exec vitest run src/state/service-steps.test.ts src/state/table-precedence.test.ts src/widgets/signal-chips.test.ts src/state/floor-look.test.ts src/i18n/codes.test.ts src/i18n/strings.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2's files, every floor screen file and the two a11y files with a
  converted fixture — PASS, each `Tests` count read:
  `pnpm --filter @waitron/till exec vitest run src/state/service-steps.test.ts src/state/table-precedence.test.ts src/widgets/signal-chips.test.ts src/state/floor-look.test.ts src/i18n/codes.test.ts src/i18n/strings.test.ts src/screens/till-floor-screen*.test.ts src/widgets/table-details-sheet.a11y.test.ts src/widgets/table-status.a11y.test.ts`
  (check `memory_pressure | grep free` and split the run if headroom is short). Then
  `git grep -n "kind: \"take_order\"" -- apps/till` names nothing.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"The till ranks, words and redraws a table's due service step (A757 slice 8)"`.

### Task 7a: the step chip

**Files:**
- Create: `apps/till/src/widgets/step-chip.ts` (`stepChip`, `stepChipStyles`, Decision 6),
  `apps/till/src/widgets/step-chip.test.ts`, `apps/till/src/widgets/step-chip.a11y.test.ts`

**Interfaces — produces:** `stepChip(step: ServiceStepDue, options: { onDone: () => void }):
TemplateResult`; `stepChipStyles`.

- [ ] **Step 1: Write the failing tests:**
  - `step-chip.test.ts`: the name and "Done" drawn; the Done button's accessible name
    `Done: Dessert?`; a click calls `onDone`; each segment's computed colours equal the tokens it
    reads, set to test values on the host (the token-painting check); Done's box at least
    `--wt-tap-min` tall and wide; a 40-character name wraps inside the chip at 320 px; Spanish
    reads `es[...]` (language restored after, CLAUDE.md §4);
  - `step-chip.a11y.test.ts`: axe over the chip in light and dark, following
    `apps/till/src/widgets/order-counts.a11y.test.ts`.
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/till exec vitest run src/widgets/step-chip.test.ts src/widgets/step-chip.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts` —
  PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"A service step's chip with its Done button (A757 slice 8)"`.

### Task 7b: the card holds the step chip; the floor redraws when a step falls due

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` — `canMarkSteps` property beside
  `canChangeToday` (`:748`; Decision 8 says why it is its own); `#card` draws Decision 6's box
  when the current step is shown with Done; `#marks` puts `stepChip` in place of the plain step
  chip; `#watchReminders` also wakes at the soonest `nextStepDueAt`; the `service-step-done` event
- Create: `apps/till/src/screens/till-floor-screen.steps.test.ts`
- Modify: `apps/till/src/screens/till-floor-screen.a11y.test.ts:473-500` (Changed checks)

**Interfaces — produces:** event `service-step-done`, `detail: { partyId: string; stepId: string;
tableId: string }`.

- [ ] **Step 1: Write the failing tests** in `till-floor-screen.steps.test.ts`: with
  `canMarkSteps` true, a due step's card is a `div.step-card` with `button.card-open` named
  `${name}, ${mapLook([table], now).description}`; a click on the box and on the cover each send
  `open-table`; a click on Done sends `service-step-done` with the ids and no `open-table` (use
  `userEvent.click`, CLAUDE.md §4); the step chip sits in its precedence place among the marks; a
  step not yet due draws no chip, then appears with no re-read when its minute comes (the screen's
  `now` unset, fake timers advanced as the held countdown's tests do — read
  `till-floor-screen.held.test.ts` first), and the map's look changes at the same moment; with
  `canMarkSteps` false the card stays a `button.card` with the plain chip; a table with no step
  keeps `button.card`. In the a11y file, the list case at `:473-500` gains `canMarkSteps: true`
  (axe in both themes).
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.steps.test.ts src/screens/till-floor-screen.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every floor screen test file — PASS, each `Tests` count read:
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen*.test.ts`, plus
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"A floor card shows its due service step with a Done button (A757 slice 8)"`.

### Task 8: Done reaches the server; the details sheet, token and pin

**Files:**
- Modify: `apps/till/src/api/client.ts` — `markServiceStepDone(partyId: string, stepId: string):
  Promise<{ cleared: string[] }>` beside `markTableCleared` (`:3775-3779`)
- Modify: `apps/till/src/till-app.ts` — `.canMarkSteps=${this.capabilities.includes("take-orders")}`
  on the floor screen (`:17451`); `@service-step-done=${(event: Event) => void this.#onServiceStepDone(event)}`
  beside `@mark-cleared` (`:18005`); `#onServiceStepDone` and `stepDoneError` (Decision 8)
- Modify: `apps/till/src/widgets/table-details-sheet.ts` — `canMarkSteps` and `now` used; the
  current step drawn with `stepChip` above the chips (its Done sends `service-step-done` then
  `details-close`), the plain step chip left out of the chip row there; the floor screen passes
  `canMarkSteps`
- Test: `apps/till/src/api/client.test.ts`, a new `apps/till/src/till-app-service-steps.test.ts`
  (mount as `apps/till/src/till-app-floor-layout.test.ts` does — read it first),
  `apps/till/src/widgets/table-details-sheet.test.ts` and `.a11y.test.ts`,
  `apps/till/src/widgets/table-status.a11y.test.ts`

- [ ] **Step 1: Write the failing tests:** the client posts to
  `/api/parties/p1/service-steps/s1/done`; in the app, Done calls it and then reads the floor again
  (the step is gone from the redrawn card); a 404 `service_step.not_found` shows
  `codeMessage("service_step.not_found")` and still reads the floor; in the sheet, the step's whole
  name and Done show, Done sends both events, and with `canMarkSteps` false the sheet shows the
  plain chip; axe over the sheet with a step in both themes; the unplaced token shows the plain
  filled step chip (`[data-chip="service-step"]`, no `[data-step-done]`); the order screen's pin
  says the step's name (`table-status`).
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/till-app-service-steps.test.ts src/widgets/table-details-sheet.test.ts src/widgets/table-details-sheet.a11y.test.ts src/widgets/table-status.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `src/till-app-floor-layout.test.ts src/till-app.test.ts` —
  PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"Done on a service step reaches the server, from the card or the table's details (A757 slice 8)"`.

### Task 9: retire `take_order`

**Files:**
- Modify: `packages/shared/src/table-signals.ts` (the `take_order` member goes),
  `apps/till/src/widgets/signal-chips.ts` (Task 6's `case "take_order"` in `signalChips` and
  `chipState`'s `"take-order"` case, `:110-111`, both go),
  `apps/till/src/i18n/strings.ts` (`signal.take_order` goes, both languages)

- [ ] **Step 1:** Remove the member, both cases and the strings; `pnpm --filter @waitron/shared
  typecheck`, `pnpm --filter @waitron/server typecheck` and `pnpm --filter @waitron/till typecheck`
  must pass with no other change (Task 6 converted every till fixture; Task 4 every server one).
  Then `git grep -n "take_order\|take-order\"" -- apps packages` must name nothing but
  `packages/ui/src/components/wt-table-token.a11y.test.ts:147`, a generic chip fixture whose key
  `take-order` is a made-up string the token does not read, which stays.
- [ ] **Step 2: Run**, each `Tests` count read:
  `pnpm --filter @waitron/till exec vitest run src/widgets/signal-chips.test.ts src/i18n/strings.test.ts src/screens/till-floor-screen.signals.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/table-signals.test.ts` — PASS.
- [ ] **Step 3:** prettier; commit — `"Take order is a service step: the take_order signal and its word go (A757 slice 8)"`.

### Task 10: help, the user guide and the design system

**Files:**
- Modify: `apps/till/src/i18n/help-strings.ts` — `help.floor.tables_list` gains "A card with a
  service step has Done: tap it when the guests want nothing." («Una tarjeta con un paso de
  servicio tiene Hecho: tócalo cuando no quieran nada.»); `help.floor.tables_map` and
  `help.floor.tables_map_view` gain "Its details list a service step with Done." («Sus detalles
  muestran el paso de servicio con Hecho.») (`:19-24` and the Spanish twins at `:63-68`)
- Modify: `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`
  — retitle (`# Table service` / `# Servicio en mesa`) and add `## Clear a service step
  {#service-steps}` / `## Marcar un paso de servicio como hecho {#service-steps}`: what a step is
  and where it shows (the card's chip with Done, the map's blue table with the bell and the step's
  name, the table's details); one at a time, the latest due; what clears it (Done; an order sent
  once it is due, which also clears an earlier-due step hidden behind a later one; the party's
  first order; the party leaving) and that before the first order
  it hides while an order is being taken; that it starts again when its start happens again; where a venue sets them (the department's Service
  tab, Service steps). Short, in `~/.claude/docs-writing-style.md`'s style.
- Modify: `apps/server/src/i18n/table-service-guide.ts` ("Table service" / «Servicio en mesa»)
- Modify: `docs/developers/design-system.md:943` — after the held chip's sentences: a due service
  step shows as one joined chip, a filled primary segment with the bell and the step's name and a
  Done button at least `--wt-tap-min` square (`stepChip`, `apps/till/src/widgets/step-chip.ts`);
  a card with that chip is a box holding a cover button over the whole card and the Done button
  above it, because a button cannot hold a button; the unplaced token and a profile without
  `take-orders` show the plain filled chip; on the map a step is seated blue with the bell and the
  name cut to fit.

- [ ] **Step 1: Write the failing tests:** `apps/server/src/guide-pages.test.ts` — a new case
  `"serves the service steps section in %s"` finding `<section id="service-steps"`;
  `help-strings.test.ts` — the added sentences present in both languages, read from the file.
- [ ] **Step 2: Run, watch them fail:**
  `pnpm --filter @waitron/server exec vitest run src/guide-pages.test.ts src/guide-content.test.ts`
  and `pnpm --filter @waitron/till exec vitest run src/i18n/help-strings.test.ts`
- [ ] **Step 3: Write the texts.**
- [ ] **Step 4: Run** Step 2's commands plus `pnpm exec vitest run scripts/guide-links.test.ts
  scripts/claude-md-pointers.test.ts` and the till files drawing the floor help keys:
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.help.test.ts src/till-app.help-mode.test.ts`
  — PASS. Then `git grep -n "Refund a payment\|Devolver un pago" -- apps docs` and update any
  hit that names the retitled page (`apps/till/README.md:57` is one hit; read the line before
  deciding whether it names the page).
- [ ] **Step 5:** prettier (`--file-info` for `docs/`); commit —
  `"Help and the guide say how a service step is cleared (A757 slice 8)"`.

### Task 11: docs and backlog

**Files:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md`, `docs/backlog.md`,
`docs/backlog/till.md`, `docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md`,
`docs/superpowers/specs/2026-10-16-a664-retention-table-inventory.md`.

- [ ] **Step 1: The design.** Status line (`:3`): "slice 8 built 2026-10-2x; A757 is built". Dated
  notes, each pointing at this plan: under §5.4 (after `:438`), Take order is a step and looks like
  one; under §8 (after `:580`), what slice 8 built — completions in `service_step_completions`, a
  step starts when it falls due and the latest due shows; an order sent after that clears it; the
  party's first order clears every step triggered before it, and before that order an open draft
  hides every step (how Take order keeps its rule; the code does not know which step is Take
  order); a Done counts from the step's trigger; "after the step before" starts only from a Done, the route, the chip and its
  Done, the map's name cue; §11 item 8 "(built)". Line `:4-5`'s link to the backlog detail gets a
  dated pointer once Step 3 deletes that section.
- [ ] **Step 2: `docs/backlog.md`.** A757 is finished, so its entry (`:2159-2172`) is **deleted**
  (CLAUDE.md §6 Docs); A893 (`:2174-2177`) now reads "A757 has landed (2026-10-2x); ready to show
  the owner" in place of "Waits for the whole of A757 (slice 8 is left)". Grep
  `git grep -n "A757" -- docs/backlog.md` for any other line saying a slice is left.
- [ ] **Step 3: `docs/backlog/till.md`.** The `## A757` section (`:1271-1346`) goes with its entry;
  anything in it a comment or doc cites moves to the area's `## Decisions and deliberate limits`
  (grep `git grep -n "a757-table-states-review-the-lifecycle" -- docs apps packages` — on
  2026-10-22 it named `docs/backlog.md:2170` and the design's `:5`). A893's list (`:1348-1446`):
  "Waits for the whole of A757" becomes "A757 landed 2026-10-2x"; add "the choices slice 8 made
  where the pictures are silent: its plan's Owner points
  (`docs/superpowers/plans/2026-10-22-a757-8-service-steps-floor.md`), each built with the default
  named there, and the step pictures as built (`docs/backlog/mockups/a757-table-states/built-8/`)".
- [ ] **Step 4: Data inventories.** One dated line under each A664 document's `service_steps` line
  (`a664-personal-data-audit.md:203`, `a664-retention-table-inventory.md:257`):
  `service_step_completions` (added 2026-10-2x, A757 slice 8, venue-service migration NNNN) —
  **L**: `id`, `party_id`, `step_id`, `done_by`; **R**: `done_at`; retention as `parties`; out:
  `party_id` → `parties(id)` [cascade], `step_id` → `service_steps(id)` [cascade]; non-FK
  `done_by` is the person who tapped Done.
- [ ] **Step 5: New entries only for what is left open and is not an owner point.** If the run
  finds one, take its number from `~/waitron-campaign-shared/next-item-number` (read, use, write
  back incremented) and name it in the commit. This plan reserved none.
- [ ] **Step 6: Stale receipts.** `git grep -n -i "take_order\|take order\|Tomar nota" -- docs
  apps/till/src apps/server/src ':!*.test.ts' ':!docs/superpowers/plans'` — each hit describing
  today's floor is updated, a historical doc left with a dated pointer; record the output in the
  commit message.
- [ ] **Step 7:** `pnpm exec prettier --file-info` on each file; commit —
  `"Docs: A757 slice 8, service steps on the floor, is built; A757 is whole"`.

### Task 12: LOOK — service steps in real Chromium

**Files:** a throwaway test `apps/till/src/screens/service-steps.look-shots.test.ts` (deleted,
never committed); pictures under `__screenshots__/a757-8/` (a path Vite allows,
`docs/developers/testing-guide.md:1478-1479`), copied to
`docs/backlog/mockups/a757-table-states/built-8/` (committed) and
`/Users/clintongormley/waitron-campaign-c/a757-8-shots/`; notes in
`/Users/clintongormley/waitron-campaign-c/a757-8-look-report.md`, following
`/Users/clintongormley/waitron-campaign-c/a757-5-look-report.md`. Method as slice 6's Task 8:
mount the floor screen and the details sheet with fixtures, viewport 720 high; size, theme and
language restored in `finally`.

- [ ] **Step 1: Draw**, each in light and dark at 390 and 1280 px: (a) picture 10's four cards —
  Set up | Done, Take order | Done, Dessert? | Done, then ✓ Nothing needed; (b) a card with Bill
  requested, Ready, a step and a held chip (the step in its place); (c) a step with a 40-character
  name; (d) the map with picture 09's T6 (🛎 Dessert?) beside a calm T9 and a ready T5; (e) the
  details sheet with a step and Done; (f) the unplaced token with a step; (g) a card with a step
  on a profile without `take-orders`; (a) and (e) also in Spanish at 390 in both themes. Name each
  `<scene>-<width>-<theme>.png`.
- [ ] **Step 2: Measure and look.** Record each segment's computed colours, Done's box size, the
  focus ring on Done and on the cover, and `document.documentElement.scrollWidth` equal to the
  viewport. Look beside pictures 10, 09 and 11: the joined chip, the bell, the Done segment's
  height against the other chips, the map's name cut with an ellipsis, the card's blue edge. A
  defect is fixed with a failing test first, in the file that owns it, and committed.
- [ ] **Step 3:** Copy the pictures to both places, delete the throwaway test and the
  `__screenshots__/a757-8/` copies, `git status` clean but for the pictures; commit — `"Pictures of
  service steps on the floor as built (A757 slice 8)"`.

---

## Owner points (each with the default this plan builds; the owner is away until 2 Nov)

1. **"After the step before" starts only from a Done on the step above**, not from an order
   clearing it: when guests order before Set up is tapped, Take order never starts; a "Coffee? ·
   after the step before" under "Dessert?" never starts when dessert was ordered rather than Done.
2. **One Done clears the step shown and every due step it was hiding**, each recorded, so their
   own followers start.
3. **Done is accepted on a step that has been triggered but is not yet due by the server's
   clock**, so a till a little ahead is not refused; a Done on a step no longer showing changes
   nothing and is not an error.
4. **Dishes are reckoned as the fire reminder reckons them**: a dish's serving ends at its serving
   or at the cancellation of its rest, whichever is later, and a dish cancelled whole ends at its
   cancellation; recalled dishes and abandoned bills are left out; only sent dishes count (a draft
   is not ordered); a course never ordered never starts its step.
5. **"Every N minutes since the last order"** repeats at the last order + N, + 2N, …; nothing
   before the first order; Done stops only the current repeat.
6. **"An order sent" is a group submission** (new dishes, or dishes joining a held course); firing
   a held course is not one.
7. **A party moved to another department's table, or split off as a new party, starts that
   department's steps from the beginning**: Set up shows again (from the party's seating for a
   move, from the split for a new party). A party split off with dishes has no orders of its own —
   the group submissions belong to the party they were sent from — so its Set up shows at once,
   its first order is whatever it orders next, and "every N minutes since the last order" never
   starts until then.
8. **A party across two departments' tables** shows each table its own department's step.
9. **A table whose zone has no department shows no steps**, as Needs clearing does.
10. **Done is at least 44 px square** (`--wt-tap-min`), so a card with a step is a little taller
    than picture 10 draws it.
11. **The unplaced token shows the step without Done**; Done is on the card and in the details.
12. **A device whose profile cannot take orders sees the step without Done.**
13. **Done in the details closes them**, as Mark cleared does.
14. **The guide's "Refund a payment" page becomes "Table service"** («Servicio en mesa»), holding
    its refund sections and the new service-steps section.
15. **New words:** "Done" («Hecho»), "Done: Dessert?" as the button's spoken name («Hecho:
    Dessert?», the step's name as stored), "This step no longer exists" («Este paso ya no
    existe», without a full stop since the Task 6 ruling); the fixed «Tomar nota» chip retires, replaced by the step's own stored name.
16. **The order screen's status pin names the step** but has no timer of its own, so a step that
    falls due while the order screen stays open reaches the pin at its next redraw.
17. **The status pin's sheet shows the step as a plain chip, without Done** (Task 8 ruling,
    2026-10-22): Done is on the card and in the details opened from the map.

## What contradicted the brief or the design

- The brief named `c123d2c32` as the base; the worktree's `main` is `fef29d8dc`, one commit later
  (A998, not in A757's files).
- The design names the details sheet `wt-table-details`; it is `till-table-details-sheet`
  (`apps/till/src/widgets/table-details-sheet.ts`).
- The design cites the reminder redraw at `till-floor-screen.ts:717-728`; it is now `:949-963`.
- The design's "What it stores" says the steps' table is `state` per `conventions-data.md`; the
  completions table is `state` too, for the reason in Decision 1, not because the design says so.
- §8 gives Take order an extra rule "as `take_order` does"; this plan keeps it with one general
  rule about the party's first order rather than marking Take order (Decision 3, driver ruling
  I1).

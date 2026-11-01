# A773-2 PR B: the waiter's request, the pass's release — task plan, cut into four pull requests

**Goal.** When a waiter fires dishes, each station's part follows that station's setting "Waits for
the pass": a station that does not wait gets its part at once, as today; a station that waits gets
it only when a pass that sees it presses Fire. A group reads ready only when every station's part
is ready. The pass shows Held, To fire, In progress and Ready (and Overview, off by default), and
the station's Held column shows "Waiting for the pass". The setting itself stays off and has no
editor until PR C, so no venue changes behaviour during PR B.

**Implements.** [Master plan](2026-10-19-a773-2-firing-and-pass.md) PR B: Tasks 4, 5, 6, 7a, 7b,
7, 8 and 9, under its "Dated authority amendment", "Global Constraints", "Review Focus",
"Ownership" table, Contracts 1–13 and "Shared verification contract", all binding except where
"Departures" below says otherwise and why. [Spec](../specs/2026-10-16-a773-courses-and-groups-design.md)
§§5–10 and 12–13; the [ownership amendment](../specs/2026-10-17-a773-one-editor-design.md) for
every write that touches a bill. PR A (master Tasks 1–3) landed as #1944 (`509e8d42a6`).

**Researched at** `abfe271663` (main, 2026-11-01). The master plan's receipts were taken at
`96f93c52`; every file, line and signature below was read again at `abfe271663`. "Read" means read;
the commands that were run are named where they are used ("Probe" below).

**Owner decision that binds this plan (2026-11-01, A1301).** The location concept is being
removed ([design](../specs/2026-11-01-a1301-remove-location-design.md)). This plan adds no
`location_id` column, no `locationId` parameter and no per-location rule, setting or fixture. Where
the master plan keyed something by location it is re-keyed in "Departures" (D13, D16, D17). Existing
code that already passes `cfg.locationId` is left as it is; A1301's slices remove it.

## The cut (why four pull requests)

The master plan's PR B is eight tasks of 20–65 calls each. Read against today's code it is about
25 implementer-sized tasks. Because the station setting can be switched on by nothing until PR C
(no route, no editor, no import: D9, D10), every boundary below leaves every venue working exactly
as today, and each PR is reviewable on its own.

| Cut | Branch | What it ships | Works on its own because |
| --- | --- | --- | --- |
| **B1** (this plan, full detail) | `feat/a773-2b-requested-release` | The columns (`requested_at`, `pass_controlled`, `waits_for_pass`, `request_kind`), the kitchen phase, each group's request kind, and the waiter's four ways of firing (and the counter's send) stamping each station's part Requested or released by its station's setting | Server only. With every station's setting false (the default, and nothing can change it), every write is today's write plus a request time equal to the fire time |
| **B2** (outline) | `feat/a773-2b2-requested-lifecycle` | A requested dish through Serve, Undo, Recall, Void/cancel, station moves, bill moves, arrival at another party, Finish table, floor counts, reminders and group readiness | Server plus the till's cancel-context type twin; still unreachable in a venue |
| **B3** (outline) | `feat/a773-2b3-pass-release` | The pass board read (Held, To fire, In progress, Ready, Overview facts) on a **new** route, and the pass's Fire (`POST /api/device/pass-screen/release`) with replay and print-once | The till still reads today's pass routes; the new ones are used by tests only until B4 |
| **B4** (outline) | `feat/a773-2b4-pass-screens` | Profile and device "show other stations' dishes", the pass and monitor screens on the new board with Columns, the station's Held column with "Waiting for the pass", the Spanish copy, guides, LOOK; the old pass routes retire | Ends PR B. PR C then exposes the station setting and the coverage warning |

The master plan's "do not land T7a's settings alone with mismatched clients" is kept: T7a's
settings, their dashboard controls and the screens that read them all land in B4. B1 is planned
task by task below; B2–B4 are outlined with their tasks, order, interfaces and gates, and each gets
its own task plan and fresh plan review when it starts.

**Execution.** Every implementer is dispatched as `subagent_type: "implementer"` (medium effort),
one task per dispatch, in the worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a773-2b-requested-release`, branch
`feat/a773-2b-requested-release`, planned from main `abfe271663`. Review weight **FULL**: B1 touches
concurrency-sensitive kitchen writes, a migration and the waiter's firing paths, which other lanes
and the pass depend on (master "Review Focus" 4 and 5). An implementer that passes about 150 calls
with the task unfinished stops at a passing or cleanly red point, commits, and hands over (done,
left, files, each check's state).

**Task size and end state.** Each task is sized at 35–70 tool calls (estimate in its heading; read,
not measured). Each ends with `pnpm --filter @waitron/server typecheck` clean (and `@waitron/db`'s when it touched the
schema), its focused suites green, `pnpm format:check` clean, and a signed commit. No task is
planned to end red.

## Owner answers

None yet for PR B. B1 asks the owner nothing: it adds no words and changes no behaviour a venue can
reach. The one copy sheet (Owner question 1) is written to `~/waitron-campaign-c/questions.md` when
B3's plan starts, with B4's pictures; B3 and B4 build on its defaults meanwhile, as the owner's
2026-10-05 rule allows, and B4 cannot land until it is answered.

## Read this first: what the planning pass found (at `abfe271663`)

1. **A requested item would be invisible to every "held" test today, and swept up by every
   release.** A held item is a `ticket_items` row with `fired_at` null
   (`packages/db/src/schema/ticket-items.ts:65`). Exactly three statements turn null into a time:
   the extras release inside `fireLines` (`apps/server/src/working-order.ts:2323-2348`, `.set({ firedAt })`),
   `releaseHeld` (`:2558`) and `sendLines` (`:2765`), each `where … isNull(ticketItems.firedAt)`.
   New rows are written by the two inserts in `fireLines` (`:2308`, dishes) and `insertSplitExtras`
   (`:2005`, separately routed extras), plus `splitTicketItem`'s copy (`:4972`, which spreads the
   whole row, so new columns travel with a split). `recallLines` (`:2904`) clears `fired_at`;
   `draft-recall.ts:378`, `line-cancel.ts:523` and `working-order.ts:3495,3506,6292,6297` delete
   items. So if Requested is "`requested_at` set, `fired_at` null" (master Contract 1), each of
   the three updates must touch only rows with **both** stamps null, or the next Fire of anything on
   the bill releases the pass's work. B1 replaces all three with one function (D4). `recallLines`'
   update (`:2904`) is the only writer that sets `fired_at` back to null
   (`rg -n "firedAt: null" apps/server/src -g '!*.test.ts'` names it and a `groupArrived` argument
   list, `order-groups.ts:2514`), so it must clear `requested_at` and `pass_controlled` too, from the
   task that first writes `requested_at` (D20).

2. **The waiter's four ways of firing all funnel into those writers.** Send all and Fire on ticked
   lines go through `placeGroups` (`apps/server/src/order-groups.ts:263`) → `fireLines`
   (`:415`); Fire on a held group through `fireGroup` (`:463`) → `releaseGroup` (`:835`) →
   `fireOrderLines` (`working-order.ts:2514`) → `releaseHeld` (`:2533`); Fire now on one held dish
   through `fireHeldLine` (`order-groups.ts:515`) → `fireOrderLines` (`:604`); the older tab Send
   through `sendLines` (`working-order.ts:2661`). The counter's sale goes through `fireLines`
   (`apps/server/src/till-sale.ts:1927`), a counter order moved to a table through
   `move-bill.ts:576`, dishes arriving at another party through `groupArrivingDishes`
   (`order-groups.ts:2431`, which calls `fireOrderLines` at `:2499`), bills leaving a party through
   `releaseHeldWorkOf` (`:763`), and the held-order edit through `applyLineEdits`
   (`working-order.ts:5764`, `fireLines` at `:6543`, extras at `:6482`). Other `fireLines` callers:
   `working-order.ts:3000,7022,7290` and test fixtures.

3. **Extras are routed on their own and copy their dish's hold.** `insertSplitExtras`
   (`working-order.ts:1927`) gives an extra its own item when its station differs from the dish's,
   with `firedAt = here ? at : dish.firedAt` (`:1983`). The master plan's Contract 2 says the
   setting "governs each independently routed component", so an extra at a waiting station must be
   requested even when its dish's station does not wait, and the reverse. Its three callers pass
   `DishKitchenPlace` (`:1919-1924`): `fireLines` (`:2351`), `finishRelease` (`:2602`, the
   no-preparation dishes whose extras go to a station) and `applyLineEdits` (`:6482`).

4. **The course rule reads "fired" where it means "initiated".** `fireLines`' `anyFired`
   (`:2204`) lets a later round join a course already cooking; `releasedCourses` (`:2809`) releases
   a course's no-preparation dishes once nothing in that course is held. Both test `fired_at`; with
   a requested item both would wrongly treat its course as still held. `sendLines` also hands
   `releasedCourses` only the courses of the rows its update released (`:2782-2786`), and records
   the send's attendance only when something was released (`:2804-2805`), so a send whose dishes
   all become Requested would release no course and record no attendance (D4, Task 6).

5. **Held work is rerouted at release, before stamping.** `rerouteHeldAtRelease`
   (`apps/server/src/station-move.ts:34`) moves held items at a closed station to the product's
   current route; its query (`:57-63`) reads `isNull(ticketItems.firedAt)`. `sendLines` with no
   line numbers scopes it to the whole tab outside held groups (`working-order.ts:2752-2755`), which
   would include already requested items. Master Contract 8 reroutes at waiter initiation only.

6. **Stations, groups and items take plain ADD COLUMN, so no venue reset is needed. Probe, run in
   a throwaway worktree of `abfe271663` (removed afterwards):** the four db columns and the two
   venue-service columns were added with the house column helpers (`flag`, `tsString`, `label`) and
   `pnpm db:generate` run in each package. drizzle-kit 0.31.11 wrote only `ALTER TABLE … ADD`
   statements (`ALTER TABLE \`order_groups\` ADD \`request_kind\` text DEFAULT 'new_order' NOT NULL`,
   `… \`kitchen_stations\` ADD \`waits_for_pass\` integer DEFAULT false NOT NULL`,
   `… \`ticket_items\` ADD \`requested_at\` text`, `… ADD \`pass_controlled\` integer DEFAULT false NOT NULL`;
   venue-service: `device_kitchen_screens` `show_non_pass_stations integer`,
   `device_profile_kitchen_screens` `… integer DEFAULT true NOT NULL`). No table was rebuilt, so no
   inbound foreign key (`ticket_item_allergies`, `pass_item_marks`, `ticket_item_moves`, the
   kitchen-screen child tables with `ON DELETE CASCADE`) is touched. Then
   `pnpm exec vitest run` over the twelve schema guards of the master's "S" list passed unchanged
   (12 files, 593 tests), including `scripts/migration-upgrade.test.ts`, which walks the migrations
   carrying rows and fails a step that loses them unless a `RESETS` entry names it: no entry was
   needed. What a FAILING probe would have printed: a `__new_ticket_items` rebuild in the SQL, and
   `migration-upgrade` refusing the step. A CHECK on `request_kind` would rebuild `order_groups`
   (the reason `kitchen_stations` carries its enum-like columns without CHECKs,
   `packages/db/src/schema/kitchen-stations.ts:30-40`), so D8 stores it unchecked.

7. **Which existing checks the new columns alone change. Same probe:** `apps/server` was run over
   every test file that selects whole `ticket_items`, `order_groups` or `kitchen_stations` rows
   (`rg -l 'select\(\)\s*\.from\((ticketItems|orderGroups|kitchenStations)\)'`), the
   configuration-transfer, pass and kitchen suites and the Madrid demo baseline: 60 files, 3042
   tests, **3 failed**: `scripts/demo-seed/seed.madrid-baseline.test.ts` (both locales; it compares
   every table's columns and rows with a capture, and failed first at
   `before/kitchen_stations: … "name": "waits_for_pass", "dflt_value": "false"`, then, with the
   venue-service columns in, at `device_kitchen_screens`), and `src/configuration-transfer.test.ts:7281`
   (a whole-row `toEqual` of `device_profile_kitchen_screens` that gained
   `show_non_pass_stations: 1`; B4's column, not B1's). `packages/db` (`src/schema/ticket-items.test.ts`,
   `kitchen-stations.test.ts`, `order-groups.test.ts`, `src/configuration-transfer.test.ts`:
   102 tests) and `packages/venue-service --project node` (`src/kitchen-screens.test.ts`,
   `src/configuration-transfer.test.ts`: 310 tests) passed. This measures the columns only; each
   task's behaviour changes are measured by that task.

8. **The configuration bundle copies every column of `kitchen_stations`.** Its declaration
   (`packages/db/src/configuration-transfer.ts:66-70`) has no column list, and the import copies
   whatever columns the bundle row carries that the table has (column lists read from `pragma_table_info` at `packages/provisioning/src/configuration-transfer.ts:674-680`, rows written from `:702`).
   So after B1 a crafted bundle with `waits_for_pass: 1` would switch waiting on before B2–B4
   exist. The declaration's `omit` list refuses such a row with `setup.request_invalid`
   `{ field: "kitchen_stations.waits_for_pass" }` (`provisioning/src/configuration-transfer.ts:597-601`)
   and leaves the column out of exports (`:334`). D9 uses it until PR C.

9. **The till already has what the pass's Columns needs, keyed without a location.** A797's store
   (`apps/till/src/state/kitchen-columns.ts`) already declares `ColumnKey` with `held`, `toFire`,
   `inProgress` and the master's `ColumnScope {venueId, deviceId, screen, stationId?}`, and the
   station fills `venueId` with the server's origin (`apps/till/src/screens/till-station-screen.ts:359`),
   not a location. `overviewRows` (`apps/till/src/state/kitchen-overview.ts:31`) is the one Overview
   counter. Approved words already exist for Overview «Resumen», Columns «Columnas», Move up/down
   «Subir»/«Bajar», Show «Mostrar», the states Waiting/Preparing/Ready «Esperando»/«Preparando»/«Listo»,
   Fire «Marchar» (`table.group_fire`), "Held, not released" «En espera, sin marchar» and the
   station's stale-screen sentence "The screen has been refreshed: check it and press again." /
   «La pantalla se ha actualizado: revísala y vuelve a pulsar.» (`apps/till/src/i18n/strings.ts:684-712,1139,2531-2559,2968`).

10. **A756's prerequisites for the lifecycle have landed.** `kitchen_stations.changes_after_sending`
    with its three values (`kitchen-stations.ts:37`, read by `apps/server/src/changes-after-sending.ts`,
    A756 PR 8 #2044) and `print_held_work` (`:33`) are on main. `refuseChangesAfterSending` treats a
    record with `firedAt` null as held (`changes-after-sending.ts:32`), which is what the master asks
    for Requested ("Requested is unreleased for 'while held'"), so B2 only pins it.

11. **The A803 portion model carries kitchen state through moves.** Slice 1 (#2232) made each dish
    its own line; slice 4a (#2372) added `moveDishes` (`apps/server/src/bill-actions.ts`), which
    reuses `carveOffLines` whole-line, so a ticket item (and its new columns) moves in place with its
    line. B2's move task pins that a requested dish keeps its stamps across `moveDishes`, Move this
    bill and arrival.

## Scope

**In B1.** Four columns and their migration; `apps/server/src/kitchen-phase.ts` (the phase of an
item, and its SQL twins); `request_kind` written by every writer that starts a group;
`apps/server/src/kitchen-release.ts` (the station setting read once per write, and the one release
step); the waiter's four ways of firing, the counter's send, moves that send, and extras each
stamping Requested or released by their own station's setting; requested items never printed,
never rerouted, never swept by a later release, refused by every Advance; the allergy snapshot
frozen at request; the column kept out of the configuration bundle; the Madrid baseline told of the
new columns.

**Out of B1.** Every reader that classifies items (pass board, station queue, current orders,
floor counts, group readiness, reminders, output alerts) and every service action on a requested
dish (B2, B3). The pass's release (B3). Any screen, word, guide or dashboard control (B4, PR C).
The station editor, its import validation and the coverage warning (PR C). Ticket headings and
"Goes with kitchen food" (PR D). Removing `away_at`, `pass_item_marks` and `fire_control` (PR D).

**Backlog.** B1 deletes nothing from the backlog. Its last task rewrites the A773-2 entry
(`docs/backlog.md`, "A773-2 — firing and the pass" (`:88`), and `docs/backlog/till.md` "A773. Courses,
groups and the pass") to say B1 landed and B2–B4 remain, with this plan linked.

**Venue reset.** Not needed (finding 6). The PR text says so on its first line.

## Owner decisions this plan applies

- **"Only the waiter fires"** and **"A pass's Fire releases the requested lines of that group that
  this pass sees"** (spec §5; master "Global Constraints").
- **Station settings resolve at the waiter's request; changing a setting never releases or re-holds
  outstanding work** (master Contract 2, builder default kept).
- **Q42, completed 2026-10-18** (master "Dated authority amendment"): Held / To fire / In progress /
  Ready, Overview off by default, heading tap collapses, Columns window for show/hide and up/down,
  non-pass dishes dimmed and configurable per profile and device. Held «En espera» (owner,
  2026-10-20). Applies to B4.
- **A1301 (owner, 2026-11-01):** nothing new keyed by location (D13, D16, D17).
- **The owner's test-change rule (2026-10-05)**, as A803's slice plans apply it: a check may change
  without asking where it pins behaviour this slice deliberately changes and checks the new
  behaviour at least as strictly; "adding what a fixture lacks is not an edit". Still a stop: a
  fiscal hash or filing test, a guard under `scripts/`, a deleted or weakened check, or one about
  something this slice was not asked to change.
- **Fiscal:** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `src/inmutabilidad.test.ts`
  are never edited and run unchanged after Task 1 and Task 7. No invoice, tax, numbering or
  refund-amount change.

## Decisions

- **D1 The phase reads `fired_at` first.** `kitchenPhase({requestedAt, firedAt, state})` returns
  `waiting`/`preparing`/`ready` from `state` whenever `firedAt` is set; otherwise `requested` when
  `requestedAt` is set, else `held`. A row written before the column (fired, no request time) reads
  as released, as it is, so no backfill and no reset (finding 6). The SQL twins are
  `heldItem()` (`fired_at is null and requested_at is null`), `requestedItem()`
  (`fired_at is null and requested_at is not null`) and `initiatedItem()`
  (`requested_at is not null or fired_at is not null`); a test holds them to the TS function over
  the same rows. The TS twin of `initiatedItem()` is `initiatedAt(item)` = `requestedAt ??
  firedAt` (D19).

- **D2 The stamps.** Held: both null, `pass_controlled` false. Requested: `requested_at` = the
  waiter's time, `fired_at` null, `pass_controlled` true. Released at once: `requested_at` =
  `fired_at` = the waiter's time, `pass_controlled` false (master T9: "Populate request time for
  immediate work too"). Made here: as today (`state` ready, `ready_at` = `fired_at`) plus
  `requested_at` = `fired_at`, never pass-controlled (master Contract 1). `queued_at` of a requested
  item is left as written; the pass's release sets it (B3), so station ages start there.

- **D3 "Sent" follows the waiter.** A requested dish line gets `sent_at` at the request, as a
  released one does (`stampSent`, `working-order.ts:2384`), and `assertSendable` and
  `bumpRevision` run over it in `finishRelease`. `isReleased` (`:3675`), `ordersWithUnfiredDish`
  (`:3694`, feeding `unpaid-departure.ts`) and `adjustments-apply.ts` keep reading the item's
  `fired_at`, so they still see a requested dish as not released (master: "Keep those existing
  financial gates unchanged"); B2 pins `unpaid_departure.unfired_dishes` for one. One shift
  follows from Task 6 (round 3, M6): a no-preparation line in a course whose dishes are all
  Requested is stamped sent at the request (Task 6 case 4), and `isReleased` reads a ticketless
  line by its sent time, so that water reads as released — to `ordersWithUnfiredDish` and
  `adjustments-apply.ts` as well — while its course's dishes are Requested. Today it reads so only
  once its course is released. The gate code is unchanged, as the master requires; B2.1's
  requested fixture pins the water's reading.

- **D4 One release step.** New `requestHeldItems(tx, orderId, scope, at)` in
  `apps/server/src/kitchen-release.ts` replaces the three updates of finding 1. It runs two
  updates over `heldItem()` rows in `scope`: first those at a station that waits (sets
  `requested_at`, `pass_controlled`), then the rest (sets `requested_at`, `fired_at`, `queued_at`),
  and returns both sets, each row carrying its `courseId`. A requested row is outside `heldItem()`,
  so no later Fire, Send or arrival can release it; only the pass can (B3). Every caller decides
  what the waiter's write *did* from **both** sets: `sendLines` gives `releasedCourses` the courses
  of the released and the requested rows, and records the send's attendance when either set or the
  no-preparation lines is non-empty (finding 4); `finishRelease` stamps both sets sent. Only the
  released set prints.

- **D5 The setting is read at the request, per component.** `passWaitingStations(tx, stationIds)`
  reads `kitchen_stations.waits_for_pass` for the stations a write is about to stamp, an inactive
  station included (it can still hold work), once per write. An extra's own station decides its
  stamps, not its dish's. The result is frozen in `pass_controlled`.

- **D6 Only genuinely held work is rerouted.** `rerouteHeldAtRelease` reads `heldItem()`, so a
  requested item at a closed station stays where it is (the pass's release refuses a stale
  destination, master Contract 8, in B3).

- **D7 The allergy snapshot is frozen at the request.** Requested is the item's first kitchen
  exposure (the A669 note, `docs/backlog/till.md:1880`: "Freeze at the first kitchen exposure,
  including advance HOLD or future Requested visibility; a later pass release must not
  recapture"). B1 passes requested items to `freezeKitchenAllergyItems` /
  `freezeKitchenAllergies` beside the released ones; `freezeKitchenAllergies` already skips an item
  that has a snapshot (`apps/server/src/kitchen-allergy.ts:163-165`). The allergy *notice* to a
  destination (`notifyKitchenAllergyDestination`) is sent at the pass's release, in B3: in B1,
  `finishRelease` passes only the **released** rows to it (`:2638-2657`), never the requested ones.
  B1 has no case that would see a wrong notice (every fixture party answers "none" to the allergy
  question, `testing/split-extras-venue.ts:230`); B3.4 pins that the notice goes at the pass's release and
  not at the request.

- **D8 Each group records its kind, unchecked and off the wire.** `order_groups.request_kind`,
  `label(...).$type<OrderGroupRequestKind>()`, not null, default `new_order`, no CHECK (finding 6).
  Every writer that starts a group passes it (`startGroup` gains a required parameter):

  | Writer | Group | Kind |
  | --- | --- | --- |
  | `placeGroups` fire group, when the party had no group (other than removed ones) before this submission | fire | `new_order` |
  | `placeGroups` fire group otherwise; `applyLineEdits`' new fire group (`working-order.ts:6130`); `groupArrived` fire group (`order-groups.ts:2542`) | fire | `nextFireKind` of the party, read once before the writer inserts its first group |
  | every held group: `placeGroups`, `startGroupAfter`, `moveLinesToGroup` "new" (`:1103`), `applyLineEdits`, `groupArrived` | hold | `next_course` |
  | `fireHeldLine`'s new group (`:596`) | fire | `next_course` |
  | `fireGroup` (held → fired) | unchanged | keeps `next_course` |

  `nextFireKind(tx, partyId)` answers `new_order` when the party has no group whose state is not
  `removed`, else `added`. Reading it once before the loop matters: a submission listing its held
  group before its fire group must still give the fire group `new_order`. A counter order has no
  group and is a New order card by itself (B3). `OrderGroup` (the till's wire,
  `order-groups.ts:147`) does not gain the field: only B3's pass read consumes it, and leaving the
  wire alone keeps every pinned group shape unchanged.

- **D9 The bundle leaves the setting out until PR C.** `kitchen_stations` gains
  `omit: ["waits_for_pass"]` (finding 8). PR C, which exposes the setting, removes the `omit` and
  adds the boolean validation the master's Task 4 asked for ("malformed imported station pass
  settings refuse").

- **D10 Nothing in PR B can switch the setting on.** No route, editor, import or seed writes
  `waits_for_pass`. Tests set it with a new `apps/server/src/testing/pass-waiting.ts`
  (`setStationsWaitForPass`), shaped like `testing/changes-after-sending.ts`. `src/testing/**` is
  outside `apps/server`'s coverage (`apps/server/vitest.config.ts:43`).

- **D11 Advance refuses a requested item with today's code.** `advanceTicketItem`
  (`working-order.ts:7603`) answers `ticket.item_held` for an item with `fired_at` null, and
  `advanceTicket`, `bumpGroupReady`, `bumpCourseReady` skip it (`isNotNull(firedAt)`). No new error
  code; B1 pins the refusal for a requested item.

- **D12 No venue reset** (finding 6).

- **D13 No location.** `passWaitingStations` reads by station id, `requestHeldItems` by order id
  and scope; neither takes a `cfg`. The existing `cfg.locationId` reads inside `fireLines`
  (`:2125,2162,2169,2182,2212`) stay as they are; A1301's S11 removes them.

- **D14 Printing is unchanged except that requested items print nothing.** `fireLines`' printed set
  (`:2363`) already keeps `firedAt !== null`, and `finishRelease` prints the update's returned
  released rows only. Advance HOLD printing (`printHoldTickets`, `correctHoldTickets`) is untouched.
  A requested extra added by an edit never gets a HOLD CHANGED slip, and that is true today with no
  change: `givenExtras` (`working-order.ts:6509-6535`) needs `printedHeldGroups`, which keeps only
  groups whose state is `held` (`order-groups.ts:2140-2145`), and a requested dish's group is always
  fired (`fireGroup` fires it, `fireHeldLine` and Fire now start a fired one). So no mutation control
  is planned for it. That last premise holds only until B2.5 (round 3, M8): if B2.5 lets
  `moveLinesToGroup` move a Requested dish into a held group whose HOLD ticket printed, an extra
  added to it afterwards would reach `givenExtras`; B2.5's decision on `moveLinesToGroup` settles
  it.

- **D19 "Initiated by the waiter" is the request time or the fire time.** At the four sites B1
  changes — `DishKitchenPlace.initiated` (Task 4), the editable order's "a child is still held"
  test (`working-order.ts:6494-6497`, Task 4), `anyFired` (Task 3b) and `releasedCourses` (Task 6),
  the last two over `initiatedItem()` / `heldItem()` — B1 reads `initiatedAt(ticket)`
  (`requestedAt ?? firedAt`, D1), never `requestedAt` alone, so a row written before the column
  (`fired_at` set, no `requested_at`) reads as fired. Task 4 cases 5 and 6 pin the two edit-path
  sites against a raw-`firedAt` read; no B1 case can tell them from a `requestedAt`-alone read,
  because a record with `fired_at` set makes the edit a `"change"` and never reaches them (Task 4).
  B1 does **not** change the other places that decide "fired" from raw `fired_at`: `kitchenHas`
  (`:5798`, "free" or "change"), `firedCourseIds` (`:5702-5707`, harmless: `fireLines`' `anyFired`
  decides the same course), the edit's VOID (`:6075`), `planHeldCorrections` (`:6612`) and the
  RECALLED lists (`:6158`, `:6163`, `:6183`); they are B2's (audit table). One behaviour follows
  from leaving `kitchenHas` alone (round 3, M4): an edit to an already-released dish at a waiting
  station takes `"change"`, so the dish is recalled (with a RECALLED slip) and sent again through
  `fireLines`, which makes it Requested; the kitchen loses a dish it had until the pass fires. No
  venue can reach it in B1 (the setting stays off) and no B1 case pins it; B2.2 decides it.

- **D20 Legacy recall puts an item back to held, both stamps cleared.** `recallLines`' update
  (`working-order.ts:2903-2911`) sets `fired_at`, `requested_at` and `pass_controlled` back to
  null/false. It lands in Task 3a, the task that starts writing `requested_at` on released items, so
  no commit of B1 leaves a recalled item looking Requested; otherwise, from Task 3b on, a recalled
  item's leftover `requested_at` would make `anyFired` count its course as initiated, and from Task 6
  on a later Send would skip it for good (review-1 I6). B2.2 keeps the draft recall of a requested
  dish.

D15–D18 are B3/B4 decisions recorded here so B1 does not build against them:

- **D15 (B3) A new route for the new board.** `GET /api/device/pass-board` (and the monitor's twin)
  answers the master's `PassBoard`; today's `/api/device/pass-screen`, `/api/device/pass-monitor` and
  `/api/expo/queue` stay until B4 switches the till and retires them in the same PR.
- **D16 (B4) The pass's Columns key uses the server's origin,** as the station's does
  (finding 9; A797 plan D5), not "the location id its pass read returns" (A797 plan D15, written
  before A1301). Different screen kinds never share a key.
- **D17 (B4) `setDeviceKitchenScreenDisplay(tx, deviceId, kind, value)` takes no `cfg`,** as
  `countDeviceKitchenScreens(tx, deviceId)` and `removeDeviceKitchenScreens(tx, deviceId)` do
  (`packages/module/src/module.ts:1173,1175`); the device id names the row. Reads go through the
  existing `readDeviceKitchenScreens` and `readProfileKitchenScreens`, whose existing `cfg` stays.
- **D18 (B3) The stale card's refusal reuses approved words.** `ticket.pass_context_changed`
  (409) is a new code, worded in the till's fallback by the station's existing
  "The screen has been refreshed: check it and press again." / «La pantalla se ha actualizado:
  revísala y vuelve a pulsar.», not the master's proposed new sentence.

## Departures from the master plan, and where it no longer matches the code

| Master plan says | Now | Why |
| --- | --- | --- |
| PR B is one PR (T4–T9) | B1–B4 | "The cut"; each boundary works because nothing can switch the setting on |
| Contract 1 "Waiting has both" timestamps | `fired_at` set reads as released whatever `requested_at` holds | D1: no backfill, no reset; rows before the column stay correct |
| "Schema releases require a pre-live reset" | no reset for B1 or B4 | finding 6: plain ADD COLUMN, rows carried |
| Contract 4 `requestKitchenItems(tx, cfg, orderId, lineIds, routing, mark?)` | `passWaitingStations` + `requestStamps` for inserts, `requestHeldItems(tx, orderId, scope, at)` for held rows | the writers already route first and stamp in three different places (finding 1); one helper per shape keeps each writer's routing, print and allergy steps where they are |
| Contract 3 `request_kind` "typed at its internal writers" | as planned, unchecked column, not on `OrderGroup` | D8 (CHECK would rebuild `order_groups`; no client reads it before B3) |
| T4 "malformed imported station pass settings refuse" | column omitted from the bundle until PR C | D9 |
| T9 is last in PR B | the writer is B1, before the lifecycle (B2) and the pass (B3) | the readers and the release need requested rows to exist; with the setting unreachable, order does not matter to a venue |
| Contract 12 `setDeviceKitchenScreenDisplay(tx, cfg:{locationId}, …)` | no `cfg` | D17, A1301 |
| Contract 12 `storageScope:{venueId: server location id, deviceId}` | the till keys by its server origin; the read returns no `storageScope` | D16, A1301 |
| T5 "update clients atomically" on today's routes | new board route in B3, till switch and old-route retirement in B4 | D15: no throwaway adapter over today's per-order cards |
| Proposed stale-card sentence (new EN/ES) | reuse `station.table_changed` | D18 |
| T4 "group origin remains stable after reorder and bill move" | stable across a held-group reorder and a same-party `moveDishes` (Task 2 case 9); dishes **arriving at another party** start new groups there whose kind that party's own groups decide (D8's `groupArrived` row) | an arrival's groups are new groups of the destination party, written by `groupArrived` (`order-groups.ts:2525-2560`); the source party's groups keep their kind. Merging whole parties (`moveGroupsToParty`, `order-groups.ts:712`) writes only `party_id` and `position` (`:726`), so it keeps every kind |
| T9 "source resend" | B1 pins the resend's write, the `existingLineIds` path of `placeGroups` (`order-groups.ts:380-396`), through `placeGroupedRound` (Task 3b case 9); the full draft recall and resend round trip is in B2.2 | a recalled source's items are deleted by the recall (`draft-recall.ts:377-382`) and come back through `fireLines`' insert, which Task 3a changes; the recall half is B2.2's code |
| T9 "a multi-output station; no duplicate item or ticket" | no separate case: folded into Task 3a case 2 | `setupSplitExtrasVenue` gives Grill and Fryer each their own printer and a shared Pass printer (`testing/split-extras-venue.ts:84-117`); round 3 ran a released counter burger and it printed at both of Grill's outputs. With nothing waiting, Task 3a case 2 asserts exactly one ticket item per line and exactly one job at each of the Grill, Pass and Kitchen printers, which is the "no duplicate" check; Task 3a case 1 and Task 4 case 1 add that a waiting station's outputs get no job |

## Consumer audit: where each current hit goes

`rg -n 'firedAt|fired_at|awayAt|away_at|passItemMarks|pass_item_marks|fireControl|fire_control|fireHeldGroupsOfCourse|fireCourse' apps packages scripts -g '!*.test.ts' -g '!**/drizzle/**'`
at `abfe271663` names 57 files. Each is assigned here; an implementer re-runs it at Task 0 and adds
any new file to the same table in the ledger.

| Files (server unless prefixed) | Hits are about | PR / task |
| --- | --- | --- |
| `working-order.ts` `fireLines` (Tasks 3a, 3b), `insertSplitExtras` and `applyLineEdits` extras (`:6482-6530`, Task 4), `releaseHeld` and `finishRelease` (Task 5a), `fireLines`' extras release (Task 5b), `sendLines` and `releasedCourses` (Task 6) | writers | **B1** Tasks 3a–6 |
| `working-order.ts` `recallLines`' un-fire (`:2903-2911`) | the one writer that clears `fired_at` | **B1** Task 3a (D20) |
| `order-groups.ts` `startGroup` callers, `placeGroups`, `fireHeldLine`, `releaseGroup`, `groupArrived` | group writers | **B1** Task 2 (kinds), Task 5a (release) |
| `station-move.ts:57-63` (`rerouteHeldAtRelease`) | reroute at release | **B1** Task 6 |
| `kitchen-allergy.ts` freeze at first exposure | allergy snapshot | **B1** Tasks 3a, 4, 5a, 5b (D7; pinned by Task 3a case 3 and Task 4 case 7); notices B3 |
| `working-order.ts` `servableLines`/`isReleased`/`refuseUnreleased`/`markServed` (`:3608-3810`), `ordersWithUnfiredDish`; `adjustments-apply.ts`; `unpaid-departure` | serving, money gates | B2 (serving keeps financial gates) |
| `draft-recall.ts`, `changes-after-sending.ts` | recall | B2 |
| `working-order.ts` `applyLineEdits`' voided items (`:6075`) and `planHeldCorrections` (`:6612-6650`) | an edit's VOID and HOLD CHANGED slips | B2 (B2.6: correction slips skip requested items) |
| `line-cancel.ts`, `line-cancel-context.ts`, `line-cancel-input.ts`, `finish-party-service.ts`; till `api/line-cancel-types.ts`, `widgets/cancel-item-dialog.ts`, `widgets/finish-table-dialog.ts` | cancellation, Finish | B2 |
| `station-move.ts` (move, `:216`, `:357-480`), `department-transfer-api.ts:301`, `working-order.ts` carve/split/transfer (`:4589`, `:5413-5800`, `:6075-6183`), `order-groups.ts` `groupArrivingDishes` classification, `moveLinesToGroup`, `bill-actions.ts` | moves and arrival | B2 |
| `order-groups.ts` `readGroups` readiness (`:1492`), `readReleaseReminders`, `readHeldCounts`, `:659`; `order-state-counts.ts`; `table-signals.ts:74`; `rest-of-order.ts:72`; `station-outputs-down.ts:122`; `station-delete.ts:76`; `kitchen-print.ts:924,1462,1529,1931` (correction slips, reprint, on-hold reads) | readers that would misread requested as held or absent | B2 |
| `pass-board.ts`, `working-order.ts` `readPassBoard`/`liveKitchenDish`/`ExpoItem` (`:8290-8600`), station queue (`:7726-8290`), `dish-kitchen.ts`, `kitchen-ticket.ts:70-79,376`, `order-groups.ts` `readCurrentOrders` (`:1816-2045`) | board and queue reads | B3 (server), B4 (till) |
| till `api/client.ts`, `state/sent-panel.ts`, `state/kitchen-cards.ts`, `state/portion-groups.ts`, `state/adjust-target.ts`, `widgets/station-queue.ts`, `widgets/sent-orders.ts`, `widgets/fired-ago.ts`, `widgets/basket.ts`, `screens/till-expo-screen.ts`, `screens/till-table-order-screen.ts`, `till-app.ts`, `test/*` fixtures | client twins and presentation | B4 (B2 for the cancel types) |
| `kitchen-print.ts:689-707` (fire ticket time), `kitchen-ticket.ts` | ticket presentation | PR D (T11) |
| db `schema/pass-item-marks.ts`, `schema/tenants.ts` (`fire_control`), `schema/ticket-items.ts` `awayAt`, `index.ts`, `classification.ts`; `packages/provisioning/src/configuration-transfer.ts`, `packages/provisioning/test/configuration-bundle.ts`; `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json`; `errors.ts:871` | retired storage | PR D (T12) |
| `packages/country-es/test-fixtures/demo/madrid-before-move.*.json`, `packages/reporting/test/fixtures.ts` | captured fixtures | unchanged; the Madrid test is told of new columns (Task 1) |

## Changed test checks (expected; the implementer confirms each)

Measured by the probe (finding 7) or by reading the named assertion.

| Check | Task | Change | Why it is allowed |
| --- | --- | --- | --- |
| `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` | B1 Task 1 | its after-capture fix-ups, inside the loop over **every** phase (`for (const phase of ["before", "provisioned", "seeded"])`, `:115`, beside the `webauthn_challenges.purpose` push at `:146-152`), gain the four new db columns in the capture's pragma form — `kitchen_stations` `{ name: "waits_for_pass", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 }`; `ticket_items` `{ name: "requested_at", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }` and `{ name: "pass_controlled", type: "INTEGER", notnull: 1, dflt_value: "false", pk: 0 }`; `order_groups` `{ name: "request_kind", type: "TEXT", notnull: 1, dflt_value: "'new_order'", pk: 0 }` (the default strings exactly as the pragma prints them: the probe's failure printed `"dflt_value": "false"`; a captured `INTEGER` boolean reads `"true"`, `madrid-before-move.es.json:975-979`) — and, on every captured row of those tables, the column's stored default in the capture's own value form (read one captured row first) | adding what the capture lacks, as #2257 (`webauthn_challenges.purpose`), #2292 and #2371 did to the same list; no captured value changes |
| `packages/db/src/configuration-transfer.test.ts` "CORE_CONFIGURATION_TRANSFER" | B1 Task 1 | a new case pins the `kitchen_stations` declaration's `omit` alone (`["waits_for_pass"]`), not its `locationColumns` | new case, not an edit; it names no location (A1301) |
| `party-move-bill.test.ts`, `party-bill-actions.test.ts`, `attendance-line-service.test.ts` | B1 Tasks 3b, 5b, 6 | each gains one new `A773 waiter request` case beside the setup it reuses | new cases, not edits |
| `apps/server/src/canvas-retirement-upgrade.test.ts` "refuses the populated predecessor for reset and retains every row after rollback" | B1 Task 1 | its hand-kept list of later core migrations the fill needs gains `"_requested_release"` (today's fill inserts `kitchen_stations` naming `waits_for_pass`) | adding a migration the fixture lacked, as `_station_ready_warning` and `_recipient_identifier` were added; no assertion changes. Found by the Task 1 review, after the probe |
| none else in B1 found | — | the probe's 60 server files, 4 db files and the schema guards passed with the columns in | — |
| `apps/server/src/configuration-transfer.test.ts:7281` | B4 | the expected `device_profile_kitchen_screens` row gains `show_non_pass_stations: 1` | probe; a whole-row pin gaining the new column's default |
| Madrid baseline again | B4 | the two venue-service columns | as above |
| whole-shape pins of `CancellationContext.components` (`line-cancel-context.test.ts`, the till's cancel-type parity tests, `finish-party-service.test.ts`) | B2 | each component gains `requestedAt` and `stationId` | master T8 contract; the planner of B2 lists the exact assertions after reading them |
| `pass-board.test.ts`, `device-api.pass.test.ts`, `till-expo-screen*.test.ts` pins of today's pass read | B4 | the routes they pin retire (D15) | behaviour this PR is asked to change; B4's plan lists them |
| `apps/till/src/widgets/station-queue.test.ts` "the station registers only columns the board draws" | B4 | `held` joins `STATION_COLUMNS` and is drawn | the check stays; it must still pass |

## Guard suites

Each run separately, exit status and nonzero `Tests` count read:

- **S (Task 1, Task 7):** `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/two-file-foreign-keys.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/apply-migrations-callers.test.ts`
  (about 4 minutes; 593 tests at the probe), then
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
- **Fiscal pair (Task 1, Task 7), unedited:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **Code guards (Task 7):** `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/write-path-tables.test.ts`.

## Owner questions

**Question 1 (asked at B3's start, blocks B4's landing; nothing in B1 or B2): one Spanish copy
sheet.** Every new phrase PR B introduces, with its proposal; approved phrases it reuses are listed
so the owner sees the whole vocabulary once ("never introduce two Spanish words for the same
meaning", master).

| Where | English | Proposed Spanish | Built from / status |
| --- | --- | --- | --- |
| Pass column | Held | «En espera» | **approved** (owner, 2026-10-20) |
| Pass column | To fire | «Por marchar» | Fire = «Marchar» (`table.group_fire`) |
| Pass column | In progress | «En curso» | owner's English (Q42) |
| Pass column | Ready | «Listo» | **approved** (`station.state.ready`) |
| Pass column | Overview | «Resumen» | **approved** (`station.overview`) |
| Pass card label | New order | «Nuevo pedido» | the till's approved name for the unsent list (`strings.ts:3161`); see the choice below |
| Pass card label | Next course | «Siguiente pase» | proposal |
| Pass card label | Added | «Añadido» | proposal |
| Pass card button | Fire | «Marchar» | **approved** |
| Station Held marker, pass card part | Waiting for the pass | «Esperando al pase» | `station.state.queued` «Esperando» + «pase» (`expo.title`) |
| Pass card, another pass's part | {station}: waiting for its pass | «{station}: esperando a su pase» | spec §5 "Cold: waiting for the cold pass" |
| Pass card, immediate part | Already at {station} | «Ya en {station}» | spec §5 "already at the Bar" |
| Columns window section | Other stations' dishes | «Platos de otras estaciones» | A797 hand-off ("a second section the pass adds") |
| Dashboard profile and device | Show other stations' dishes on the pass | «Mostrar en el pase los platos de otras estaciones» | replaces the master's "Show non-pass stations" |
| Dashboard device | Use the profile's setting | «Usar la configuración del perfil» | proposal; B4 greps for an approved twin first |
| Stale card refusal | The screen has been refreshed: check it and press again. | «La pantalla se ha actualizado: revísala y vuelve a pulsar.» | **approved** (`station.table_changed`), D18 |
| Columns window | Move up / Move down / Show | «Subir» / «Bajar» / «Mostrar» | **approved** (A797) |

The choice inside it: the pass card for a table's first send is called "New order" in spec §5,
which is also the till's name for the waiter's unsent dishes. Default: keep "New order" /
«Nuevo pedido» on the card (the card is that same order, now sent). Alternative: "First order" /
«Primer pedido». Mock-ups of both go with B4's pictures.

PR C's station-editor words ("Waits for the pass" / «Espera al pase», "No service zone" /
«Sin zona de servicio», the coverage sentence) and PR D's ("Goes with kitchen food") are asked by
those PRs; they are not built in PR B.

## Task 0: preflight and reservations (no commit, about 15 calls)

- [ ] `git -C <worktree> fetch && git log --oneline abfe271663..origin/main -- apps/server/src/working-order.ts apps/server/src/order-groups.ts apps/server/src/station-move.ts apps/server/src/kitchen-allergy.ts packages/db/src/schema packages/db/src/configuration-transfer.ts`.
  If anything landed, rebase and re-read the lines this plan cites before Task 1.
- [ ] Read the other lanes' queues and active worktrees for these files
  (`~/waitron-campaign*/queue.md`, `git worktree list`). A1301's S1/S11 and A803's 4b/4c edit
  `working-order.ts` and `order-groups.ts`; record which are in flight. Overlap is a reason to
  rebase often, not to wait.
- [ ] Re-run the audit search above; add any new file to the ledger's copy of the audit table.
- [ ] Write the ledger `docs/handoffs/2026-11-01-a773-2b-requested-release.md` (`Status: in progress`).

## Task 1: the columns and the kitchen phase (about 35 calls)

**Files.** Modify `packages/db/src/schema/ticket-items.ts`, `kitchen-stations.ts`,
`order-groups.ts`, `packages/db/src/configuration-transfer.ts`, `packages/db/src/index.ts`; generated
`packages/db/drizzle/<n>_*.sql` and `meta/` (whatever number drizzle assigns); create
`apps/server/src/kitchen-phase.ts` and `apps/server/src/kitchen-phase.test.ts`; tests
`packages/db/src/schema/ticket-items.test.ts`, `kitchen-stations.test.ts`, `order-groups.test.ts`,
`packages/db/src/configuration-transfer.test.ts`, `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`.

**Interfaces.**

```ts
// packages/db/src/schema/ticket-items.ts, after firedAt (:65)
requestedAt: tsString("requested_at"),                       // null while held
passControlled: flag("pass_controlled").notNull().default(false),
// packages/db/src/schema/kitchen-stations.ts
waitsForPass: flag("waits_for_pass").notNull().default(false),
// packages/db/src/schema/order-groups.ts
export type OrderGroupRequestKind = "new_order" | "next_course" | "added";
requestKind: label("request_kind").$type<OrderGroupRequestKind>().notNull().default("new_order"),
// packages/db/src/configuration-transfer.ts, the kitchen_stations entry (:66-70)
omit: ["waits_for_pass"],

// apps/server/src/kitchen-phase.ts
export type KitchenPhase = "held" | "requested" | "waiting" | "preparing" | "ready";
export function kitchenPhase(item: {
  requestedAt: string | null;
  firedAt: string | null;
  state: TicketState; // from ./kitchen-print.js (:851)
}): KitchenPhase;
/** When the waiter initiated the item (D19): its request time, or its fire time on a row from
 *  before the column; null while held. */
export function initiatedAt(item: { requestedAt: string | null; firedAt: string | null }): string | null;
export function heldItem(): SQL;       // fired_at is null and requested_at is null
export function requestedItem(): SQL;  // fired_at is null and requested_at is not null
export function initiatedItem(): SQL;  // requested_at is not null or fired_at is not null
```

`packages/db/src/index.ts` adds `type OrderGroupRequestKind` to its `./schema/order-groups.js`
export block (`:124-129`).

`request_kind`'s comment names its one writer and says nothing refuses another value at run time.

- [ ] **Failing tests.**
  - `packages/db/src/schema/ticket-items.test.ts`, inside the existing suite and its fixture:
    `A773 phases: a new ticket item has no request time and is not pass-controlled` (insert one,
    select it, `requestedAt` null, `passControlled` false). Same file style in
    `kitchen-stations.test.ts` (`waitsForPass` false) and `order-groups.test.ts`
    (`requestKind` `"new_order"`). These fail on a missing property before the schema change.
  - `packages/db/src/configuration-transfer.test.ts` → `describe("CORE_CONFIGURATION_TRANSFER")`:
    `A773 phases: a station's pass waiting is never carried`:
    `expect(CORE_CONFIGURATION_TRANSFER.tables.find((t) => t.name === "kitchen_stations")?.omit).toEqual(["waits_for_pass"])`.
    It asserts the `omit` alone, so it names no location column (A1301: nothing new keyed by
    location, and A1301's slices can drop `locationColumns` without editing this case).
  - `apps/server/src/kitchen-phase.test.ts` `A773 phases`, written against a stub that returns
    `"held"` so each row fails by assertion: the tuples (requestedAt, firedAt, state) →
    phase: (null, null, queued) held; (T, null, queued) requested; (T, T, queued) waiting;
    (null, T, queued) waiting (a row from before the column, D1); (T, T, preparing) preparing;
    (T, T, ready) ready; and `initiatedAt` over (null, null) null, (T, null) T, (null, T) T,
    (T, U) T. Then **SQL twins agree**: on `useVenueDb` with
    `setupSplitExtrasVenue` (`apps/server/src/testing/split-extras-venue.ts:75`), fire a counter
    order of four burgers as four lines (`fireNewOrder`), update their stamps to the four
    `queued`/`preparing` tuples above, and select the ids matching each of `heldItem()`,
    `requestedItem()`, `initiatedItem()`; each set equals the ids whose `kitchenPhase` is
    held / requested / anything but held.
- [ ] **RED.** `pnpm --filter @waitron/db exec vitest run src/schema/ticket-items.test.ts src/schema/kitchen-stations.test.ts src/schema/order-groups.test.ts src/configuration-transfer.test.ts -t 'A773 phases'`
  and `pnpm --filter @waitron/server exec vitest run src/kitchen-phase.test.ts`. Each named case
  fails on its assertion. The `-t` filter selects nothing until the cases are written (at
  revision 2, `vitest list` over the four db files listed all four and only the three existing
  `CORE_CONFIGURATION_TRANSFER` cases, none named `A773`); read the `Tests` count, never a blank
  run.
- [ ] **Minimal implementation.** The columns; `pnpm --filter @waitron/db db:generate`; read the
  SQL: four `ALTER TABLE … ADD` statements and nothing else (a `__new_` table is a stop: report it,
  do not hand-edit). The `omit`. `kitchen-phase.ts`. Run the Madrid baseline
  (`pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts`),
  watch it fail on `waits_for_pass` as the probe did, and add the four columns and their row
  defaults to its after-capture fix-ups ("Changed test checks").
- [ ] **GREEN.** The RED commands unfiltered; the Madrid baseline; S; the fiscal pair;
  `pnpm --filter @waitron/db typecheck`, `pnpm --filter @waitron/server typecheck`, `pnpm format:check`.
- [ ] **Mutation controls** (each reverted after it goes red): drop `.default(false)` from
  `pass_controlled` → the ticket-items default case red; make `kitchenPhase` test `requestedAt`
  first → "(null, T, queued) waiting" red; drop `requested_at is null` from `heldItem()` → the SQL
  agreement case red; drop the `omit` → the declaration case red; `initiatedAt` returning
  `requestedAt` alone → its (null, T) tuple red.
- [ ] **Commit.** Stage the named paths; `git diff --cached --check`;
  `git commit -s -m "Record when the waiter asks for each kitchen item, apart from its release"`
  (body: what the four columns hold, that nothing writes them yet, no venue reset needed and why).

## Task 2: each group says what kind of request it is (about 45 calls)

**Files.** Modify `apps/server/src/order-groups.ts` (`startGroup` `:1328`, `startGroupAfter`
`:1353`, `placeGroups` `:263` (its `startGroup` at `:364`), `fireHeldLine` `:515` (at `:596`),
`moveLinesToGroup` `:1021` (at `:1103`), `groupArrivingDishes`/`groupArrived` `:2431-2560` (at
`:2542`)), `apps/server/src/working-order.ts` (`applyLineEdits`' group start, `:6130`),
`apps/server/src/testing/adjustment-venue.ts:600`; the existing direct `startGroup` calls in
`apps/server/src/order-group-numbers.test.ts` and `apps/server/src/order-portions.adjustments.test.ts`
gain the kind their `release` implies (`"hold"` → `next_course`, `"fire"` → `new_order`), a
signature update with no assertion changed; create `apps/server/src/order-groups.request-kind.test.ts`.
(`rg -n "startGroup\(" apps packages` at revision 2: those two test files, `order-groups.ts`,
`working-order.ts` and `testing/adjustment-venue.ts`, nothing else.)

**Interfaces.**

```ts
// apps/server/src/order-groups.ts
export async function startGroup(
  tx: Transaction,
  partyId: string,
  release: GroupRelease,
  operatorId: string,
  requestKind: OrderGroupRequestKind,
  fired?: { at: string; by: Firer },
): Promise<string>;
/** new_order while the party has no group other than removed ones; added after. */
export async function nextFireKind(tx: Transaction, partyId: string): Promise<"new_order" | "added">;
```

`startGroupAfter` passes `next_course` itself. Every writer follows D8's table.

- [ ] **Failing tests** (`order-groups.request-kind.test.ts`, `A773 request kind`; party fixture
  from `setupSplitExtrasVenue`'s seated `party`, submissions through
  `apps/server/src/testing/group-submit-fixture.ts` `submitGroups`/`placeGroups`; each case reads
  `order_groups.request_kind` by group id):
  1. One submission listing a **held group first** and a Fire now group second: Fire now group
     `new_order`, held group `next_course`, as one assertion on both rows (fails if the kind is read
     inside the loop).
  2. A second submission's Fire now group: `added`.
  3. `fireGroup` on case 1's held group: state `fired`, kind still `next_course`.
  4. `fireHeldLine` on a held dish: the new group is `next_course`.
  5. `moveLinesToGroup` to `"new"`: `next_course`.
  6. A party whose only group was emptied and `removed` sends Fire now: `new_order`.
  7. A counter order fired with `fireNewOrder` writes no `order_groups` row (count unchanged).
  8. Dishes arriving at a party: reuse the arrival setup of
     `apps/server/src/attendance-arriving-groups.test.ts` (read it first); arriving at a party that
     has a group → the arrival's fire group `added`; at a newly seated party → `new_order`; a
     held-until-fired course's arrival group `next_course`.
  9. The kind stays put (master T4 "stable after reorder and bill move"): two held groups and a
     fired one; `reorderHeldGroups` (`order-groups.ts:889`) swaps the held two, then `moveDishes`
     (`bill-actions.ts:364`; read `src/move-dishes.test.ts` for its call) moves a dish to another
     bill of the same party: every group's kind equals what it was before. Arrival at another party
     is D8's `groupArrived` row, not this case ("Departures").
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/order-groups.request-kind.test.ts`:
  cases 1 (the held row), 2, 3, 4, 5 and 8's `added` and `next_course` halves fail on
  `"new_order"`, the column default; 6, 7, 8's `new_order` half and 9 pass from the start (the
  default is the right answer there, and no writer case 9 runs touches the column) and stay as pins
  (say so in the commit).
- [ ] **Minimal implementation.** `nextFireKind`; the parameter; each writer per D8; the fixture in
  `testing/adjustment-venue.ts` and the two test files' direct calls pass the kind their `release`
  implies.
- [ ] **GREEN.** RED unfiltered; then unfiltered `src/order-groups.test.ts`,
  `src/till-api.groups.test.ts`, `src/attendance-arriving-groups.test.ts`,
  `src/attendance-group-commands.test.ts`, `src/draft-recall-legacy.test.ts`,
  `src/order-group-numbers.test.ts`, `src/order-portions.adjustments.test.ts`,
  `src/move-dishes.test.ts`; `pnpm --filter @waitron/db typecheck` (the barrel) and
  `pnpm --filter @waitron/server typecheck`; format check.
- [ ] **Mutation controls:** call `nextFireKind` inside `placeGroups`' loop → case 1 red; have
  `startGroup` ignore `requestKind` → cases 2 and 4 red; `fireHeldLine` passing `nextFireKind` →
  case 4 red; `nextFireKind` counting `removed` groups → case 6 red; `reorderHeldGroups`' update
  (`:928`) also setting `requestKind: "added"` → case 9 red.
- [ ] **Commit.** `git commit -s -m "Record whether each kitchen group is a new order, the next course or an addition"`.

## Task 3a: a new dish's kitchen item follows its station's pass setting (about 65 calls)

**Files.** Create `apps/server/src/kitchen-release.ts`, `apps/server/src/testing/pass-waiting.ts`,
`apps/server/src/kitchen-request.send.test.ts`; modify `apps/server/src/working-order.ts`
`fireLines`' inserts, sent lines, printed set and freeze (`:2071-2380`, leaving `anyFired` at
`:2204` to Task 3b) and `recallLines`' un-fire (`:2903-2911`, D20).

**Interfaces.**

```ts
// apps/server/src/kitchen-release.ts
/** The named stations that wait for the pass, inactive ones included. */
export async function passWaitingStations(
  tx: Transaction,
  stationIds: readonly string[],
): Promise<ReadonlySet<string>>;
/** D2's stamps for one item a waiter's write places. Made here wins: such an item is released
 *  and ready at `at` whatever `initiated` and `waits` say (master Contract 1). Otherwise: not
 *  initiated → held; initiated at a waiting station → Requested; initiated elsewhere → released. */
export function requestStamps(input: {
  at: string;
  initiated: boolean; // the waiter fired it now (fireLines' `courseFired`, :2238-2245)
  madeHere: boolean;
  waits: boolean;     // its station is in passWaitingStations
}): { requestedAt: string | null; firedAt: string | null; passControlled: boolean };

// apps/server/src/testing/pass-waiting.ts
export async function setStationsWaitForPass(
  tx: Transaction,
  value: boolean,
  stationIds: readonly string[],
): Promise<void>; // throws when an id matches no station, as setChangesAfterSending does
```

In `fireLines`: decide each value's `stationId` as today, read `passWaitingStations` once for
them, and write `requestStamps({ at: firedAt, initiated: courseFired, madeHere: made, waits })`'s
three fields into each insert value. `fired` (`:2264`, `made || courseFired`) keeps deciding
`sentLineIds` (D3) and `DishKitchenPlace` (Task 4 renames its stamp). The printed set
(`:2363`) is unchanged. Requested inserted items are passed to `freezeKitchenAllergyItems` with the
printed ones (D7). `recallLines`' update sets `firedAt: null, requestedAt: null, passControlled:
false` (D20; it stays in this task because this task is the first writer of `requested_at`).

- [ ] **Failing tests** (`kitchen-request.send.test.ts`, `A773 waiter request: send`;
  `setupSplitExtrasVenue` (Grill makes burgers; Kitchen is the default station; each station has
  its own printer and Grill and Fryer also share a Pass printer, so Grill is a two-output station,
  `testing/split-extras-venue.ts:84-117`); `decodeTicket` and `printJobs` to read what printed;
  compare whole affected rows: `requestedAt`, `firedAt`, `passControlled`, `state`, `queuedAt`).
  Every line in this file is built with **no** `extras` field unless a case says otherwise (the
  fixture's burger and water carry extra lists; chips at Fryer would add items and jobs the cases
  do not count). Write `testing/pass-waiting.ts` first, so each case fails on an assertion, not
  an import:
  1. Grill waits. A counter order (`fireNewOrder`) of a burger (Grill) and a dish routed to
     Kitchen (read the fixture's routing cells first; add a product or cell in the test if none
     routes there): the burger's item is Requested (D2) with `queuedAt` unchanged from
     the insert; the Kitchen item has `requestedAt` = `firedAt`; one job at the Kitchen printer and
     **no** job at the Grill printer or the Pass printer.
  2. Nothing waits (the default): the same order gives two released items with `requestedAt` =
     `firedAt`, exactly one ticket item per line, and **three** jobs: exactly one at each of the
     Grill, Pass and Kitchen printers (round 3 ran this shape: a released counter burger printed
     at `["grill", "pass"]`). This is the master's "a multi-output station; no duplicate item or
     ticket" check ("Departures"). Bytes as before: compare with the same order in
     `src/split-off-extras.release.test.ts`' style.
  3. Grill waits. A table submission (`submitGroups` on the fixture's seated `party`) with a Fire
     now group (burger) and a held group (burger): the Fire now burger Requested, the held burger
     with both stamps null and `passControlled` false; the dish lines' `sentAt`: set on the
     requested one, null on the held one (D3); and the Requested burger's item has an allergy
     snapshot: `VENUE_SERVICE.readTicketAllergies(tx, [itemId]).has(itemId)` is true (D7). The
     snapshot is checked on a table order because `resolveKitchenAllergyBlocks` takes only tickets
     whose order has a party (`kitchen-allergy.ts:105`); a counter item never gets one, released or
     not (round 3, P5: counter `snapshots: 0`, table round `snapshots: 1`, both released chips). A
     party that answered "none" still gets an entry, with a null block (`kitchen-allergy.ts:128-131`,
     read). That the Requested burger gets one is first run by this task.
  4. Made here wins: Grill waits and is the sending device's made-here station
     (`device_made_here_stations`, as `src/split-off-extras.send.test.ts:1028` sets it), and the
     burger is in a **held** group: the burger is `ready`, `requestedAt` = `firedAt` = `readyAt`,
     `passControlled` false, no job.
  5. Replay: the same `submitGroups` submission sent twice with Grill waiting answers the first
     answer; one item per line, stamps and every printer's job count unchanged after the second.
  6. Legacy recall puts an item back to held (D20): nothing waits; `addTabRound` a burger → its
     item reads released with `requestedAt` = `firedAt`; `recallLines`
     (`testing/order-writer-fixture.ts:42`) → `firedAt` null, `requestedAt` null,
     `passControlled` false (`kitchenPhase` = `held`). Round 3 ran this case and its control
     (P3: green with D20, red with D20 switched off, `"requestedAt": "…Z"` received).
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.send.test.ts`.
  Every case fails on stamps (`requestedAt` null, or `firedAt` set at a waiting station); case 6
  fails first on its released item's `requestedAt` null, before it reaches the recall.
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered; unfiltered
  `src/split-off-extras.send.test.ts`, `src/split-off-extras.release.test.ts`,
  `src/split-off-extras.edit.test.ts`, `src/counter-release.test.ts`, `src/made-here.test.ts`,
  `src/made-here.routes.test.ts`, `src/till-api.groups.test.ts`, `src/order-groups.test.ts`,
  `src/kitchen-allergy.capture.test.ts`, `src/kitchen-allergy.lifecycle.test.ts`,
  `src/kitchen-print.test.ts`, `src/draft-recall-legacy.test.ts`, `src/tabs.test.ts`,
  `src/working-order.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `requestStamps` ignoring `waits` → case 1 red; leaving `requestedAt`
  null when released at once → case 2 red; `sentLineIds` only on `firedAt` → case 3's `sentAt` red;
  Requested inserts not passed to `freezeKitchenAllergyItems` → case 3's snapshot red;
  `requestStamps` answering held for a not-initiated item before it checks `madeHere` → case 4
  red; printing on `initiated` instead of `firedAt` → case 1's job count red; `recallLines` leaving
  `requestedAt` → case 6 red.
- [ ] **Commit.** `git commit -s -m "Hold a new dish for the pass when its station waits for it"`
  (body: that a legacy recall now clears both stamps, and why in the same commit, D20).

## Task 3b: the course rule reads initiation; the other new-dish writers (about 45 calls)

**Files.** Modify `apps/server/src/working-order.ts` `fireLines`' `anyFired` (`:2204`); add cases
to `apps/server/src/kitchen-request.send.test.ts` and one case to
`apps/server/src/party-move-bill.test.ts`.

**Interfaces.** `anyFired` becomes "any item of the course initiated and not made here" over
`initiatedItem()` (D19). No signature changes.

- [ ] **Failing tests and pins** (`kitchen-request.send.test.ts`, same `describe`, same no-extras
  rule):
  7. The course rule reads initiation (`anyFired`). Create a Starters and a Mains course with
     `createCourse` (read the fixture's courses first; give Starters the lower `displayOrder`).
     Grill waits. Round 1, `addTabRound`
     (`apps/server/src/testing/order-writer-fixture.ts:171`): a burger with `courseId` Starters and
     a burger with `courseId` Mains, both `release: true` → both Requested. Round 2, `addTabRound`:
     a burger with `courseId` Mains and neither flag → Requested, not held. Why it detects the
     change: Starters holds an item, so Mains is not the order's earliest course
     (`working-order.ts:2238-2251`), and only `anyFired` lets round 2's Mains burger in; read on
     `fired_at`, the Requested Mains burger does not count and round 2's burger stays held.
  8. Every advance refuses or skips a Requested item (D11; pins of today's code). A table Fire
     now burger with nothing waiting, then its item set to the Requested shape by a direct update
     (`requested_at` = its `fired_at`, `fired_at` null, `pass_controlled` true), so the case does
     not depend on this plan's writers: `advanceTicketItem(tx, cfg, itemId, "preparing")` refuses
     `ticket.item_held` (caught outside `withTransaction`); `advanceTicket(tx, cfg, orderId,
     grillId, "preparing")` and `bumpGroupReady` on its group leave the row unchanged.
  9. Source resend's write (the `existingLineIds` path, `order-groups.ts:380-396`):
     `placeGroupedRound` (`testing/group-submit-fixture.ts:110`) with `release: "fire"` and a
     burger, Grill waiting → one item, Requested, no Grill or Pass job. (The draft recall round
     trip is B2.2's; "Departures".)
  10. Counter moved to a table (`move-bill.ts:576` → `fireLines`), a **new case in
      `party-move-bill.test.ts`** under `describe("A773 waiter request")`, beside `:1089` and
      reusing its setup: every station of that venue waits (`setStationsWaitForPass` over the
      venue's station ids, read from `kitchen_stations`). That venue's stations have no printer
      until the file's `printerFor` (`:225-241`) attaches one after a send, so **before** the move
      create one printer and attach it to every station of the venue (as `printerFor` does, over
      `kitchen_stations` rather than the bill's items). After the move the Tarta's one ticket item
      is Requested and that printer has no job.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.send.test.ts -t 'A773 waiter request'`
  and `pnpm --filter @waitron/server exec vitest run src/party-move-bill.test.ts -t 'A773 waiter request'`.
  Case 7 fails with round 2's burger held. Cases 8, 9 and 10 pass from the start: 8 seeds its own
  stamps and pins today's advance code; 9 and 10 run through the insert Task 3a changed. They stay
  as pins (say so in the commit), each proved by a control below.
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered (`party-move-bill.test.ts` whole); unfiltered
  `src/split-off-extras.send.test.ts`, `src/till-api.groups.test.ts`, `src/order-groups.test.ts`,
  `src/draft-recall-legacy.test.ts`, `src/tabs.test.ts`, `src/working-order.test.ts`; typecheck;
  format check.
- [ ] **Mutation controls:** `anyFired` back on `fired_at` → case 7 red; dropping
  `isNotNull(firedAt)` from `advanceTicket` (`:7666`) → case 8 red; and from `bumpGroupReady`
  (`order-groups.ts:659`) → case 8 red; `requestStamps` ignoring `waits` → cases 9 and 10 red.
- [ ] **Commit.** `git commit -s -m "Let a later round join a course the waiter has already asked for"`.

## Task 4: extras placed with their dish follow their own station (about 55 calls)

**Files.** Modify `apps/server/src/working-order.ts`: `DishKitchenPlace` (`:1919-1924`),
`insertSplitExtras` (`:1927-2035`), `fireLines`' `dishPlaces` (`:2231-2286`), `finishRelease`'s
`insertSplitExtras` call (`:2602-2612`), the editable order's ticket read (`:5627`, and its
`EditableLine` ticket type) and `applyLineEdits`' extras (`:6474-6505`); create
`apps/server/src/kitchen-request.extras.test.ts`.

**Interfaces.**

```ts
// working-order.ts
interface DishKitchenPlace {
  dishLineId: string;
  stationId: string | null;
  courseId: string | null;
  /** Was `firedAt`. For a stored dish, initiatedAt(its ticket) (D19); the waiter's time when this
   *  write initiates it; null while held. */
  initiatedAt: string | null;
}
// insertSplitExtras' returned rows gain `requestedAt: string | null`.
```

`insertSplitExtras` reads `passWaitingStations` once over the decided stations and stamps each
extra with `requestStamps({ at: here ? routing.at : dish.initiatedAt ?? routing.at, initiated:
dish.initiatedAt !== null, madeHere: here, waits })` for the extra's **own** station. Today an
extra made elsewhere copies its dish's fire time (`:1983`); it now copies the dish's initiation
time, the same instant on every row B1 writes. Its freeze (`:2016-2020`) takes every initiated,
not-made-here row (`(row.firedAt ?? row.requestedAt) !== null`, D7). `fireLines`' `dishPlaces`
pass `initiatedAt: fired ? firedAt : null`; `finishRelease` passes `initiatedAt: at`.
`applyLineEdits` gives a parent with a ticket `initiatedAt(parent.ticket)`; one without a ticket
null when its group is held or a child's ticket is still held (`initiatedAt(child.ticket) ===
null`, replacing `child.ticket.firedAt === null` at `:6494-6497`, D19), else `routing.at`. Callers
print `firedAt !== null` as today; HOLD CHANGED is unchanged (D14). `fireLines`' extras **release**
(`:2322-2350`) is Task 5b's.

**Changed at the build's Task 4 review (2026-11-01, I1, m1, m2).** An extra takes the time of the
write that adds it, never its dish's earlier time: an edit adding chips to a burger requested at
12:00 stamps them with the edit's 12:05 (case 5 pins the value). So `DishKitchenPlace` carries
`initiated: boolean` instead of `initiatedAt`, and every extra is stamped `routing.at`. The extras
of a made-here dish in a held group still leave hold at once, as before the branch (5e8d5ec094),
so at a waiting station they are Requested while the group is held; a case pins it, and B2 or B3
decides whether that stays. `insertSplitExtras` returns no `requestedAt`: no caller reads it.

Which edits reach this code (round 3, P2, run): a parent with any record whose `fired_at` is set
makes `kitchenHas` answer true (`:5798`), so the action is `"change"` (`:5961`) and
`addedToExisting` (`:6476`), which keeps only `"free"` changes, leaves it out; such a dish is
recalled and its extras come from `fireLines`' own `insertSplitExtras`. So the edit path here sees
only parents whose records are all unfired: held, Requested, or no record at all.

- [ ] **Failing tests** (`kitchen-request.extras.test.ts`, `A773 waiter request: extras`;
  `setupSplitExtrasVenue`: chips and onion rings are burger and water extras routed to Fryer
  (Sides), chips carry gluten, and Fryer has its own printer and the shared Pass printer; copy the
  edit suite's `line` and `edit` helpers, `src/split-off-extras.edit.test.ts:45-55` and `:97-112`):
  1. Fryer waits, Grill does not. Counter burger with chips: burger released and printed at
     Grill; chips Requested, no job at the Fryer or the Pass printer. (No allergy snapshot is
     asserted here: a counter order gets none, `kitchen-allergy.ts:105`; case 7 checks it.)
  2. Grill waits, Fryer does not. Counter burger with chips: burger Requested; chips released
     (`requestedAt` = `firedAt`) and printed at Fryer.
  3. `finishRelease`'s insert (review-1 C1): the setup of
     `src/split-off-extras.release.test.ts:268-308` — a held no-preparation water in a later course
     (`addTabRound` with `hold: true`) given a chips child with no item by a direct insert — with
     Fryer waiting, then `sendLines(tx, cfg, tabId, [])`: the water line's `sentAt` set; the chips'
     new item Requested; no Fryer or Pass job. This reaches no code Task 5a, 5b or 6 changes (round 3,
     P1, run: `sendLines`' update released nothing, and the chips were inserted by
     `finishRelease`'s `insertSplitExtras`, `:2602`, which takes only extras with no item, `:1965`).
  4. Made here wins (review-1 I4): the setup of `src/split-off-extras.send.test.ts:1028` (Fryer
     made here on the sending device; a burger with chips in a held group) with Fryer also
     waiting: chips `ready`, `requestedAt` = `firedAt` = `readyAt`, `passControlled` false; the
     burger held (both null).
  5. An edit adds chips to a Requested burger (the parent branch of D19). Grill waits, Fryer does
     not; `addTabRound` a burger with no extras (Requested since Task 3a); then
     `edit(tx, venue, 1, { extras: line(venue, "burger", "1", 1).extras })`: chips released and
     printed at Fryer; no HOLD CHANGED job. The burger's only record is unfired, so the edit takes
     `"free"` and reaches the parent's `initiatedAt` (read, not run).
  6. An edit adds onion rings to a water whose chips are Requested (the children branch of D19,
     `:6494-6497`). Fryer waits. `addTabRound` a water with chips (`line(venue, "water", "1", 1)`):
     the water has no item; the chips' item is Requested. Then
     `edit(tx, venue, 1, { extras: line(venue, "water", "1", 1, 1).extras })`: the rings' new item
     is Requested (`requestedAt` = the edit's time, `firedAt` null, `passControlled` true), not
     held; the chips' row identical; no Fryer or Pass job. Why it reaches the children test: the
     water has no ticket and its chips' `fired_at` is null, so `kitchenHas` answers false, the edit
     is `"free"`, the water is in `addedToExisting`, and its initiation is decided by the children
     test alone. **Run at revision 3** in a throwaway worktree of `d45fe58b88`: the same shape with
     the chips recalled rather than Requested (`split-off-extras.edit.test.ts:695`, "keeps a
     recalled water's newly added onion rings held") passed (1 passed), and failed with
     `expected '2026-11-01T16:16:12.513Z' to be null` when the children test was made to answer
     false for every child; so in this setup that test alone decides the rings' stamp. `:695`
     stays green after this task (a recalled child has both stamps null, D20) and is this case's
     control in the other direction. The Requested-chips variant is first run by this task.
  7. A Requested extra gets its allergy snapshot at the request (D7). Fryer waits, Grill does not.
     `addTabRound` on the fixture's seated party's tab a burger with chips: chips Requested and
     `VENUE_SERVICE.readTicketAllergies(tx, [chipsItemId]).has(chipsItemId)` true. Round 3 (P5,
     run) showed the released twin of this shape gets one (`snapshots: 1`); the Requested one is
     first run by this task.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.extras.test.ts`.
  Cases 1, 3, 6 and 7 fail with the chips released (6, once the chips are Requested, with the
  rings held; 7, once they are Requested, on the missing snapshot), 2 and 4 on `requestedAt` null,
  5 with the chips held (the parent's raw `firedAt` is null).
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered; unfiltered `src/split-off-extras.edit.test.ts` (`:190` keeps HOLD
  CHANGED for chips added to a printed held burger; `:695` and `:711` keep a recalled dish's added
  extras held), `src/split-off-extras.send.test.ts` (`:956`, `:1028` keep made-here extras of held
  dishes ready), `src/split-off-extras.release.test.ts`, `src/kitchen-request.send.test.ts`,
  `src/kitchen-allergy.capture.test.ts`, `src/kitchen-allergy.atomic.test.ts`,
  `src/bill-editing.order-writers.test.ts`, `src/tabs.test.ts`, `src/working-order.test.ts`;
  typecheck; format check.
- [ ] **Mutation controls:** `insertSplitExtras` deciding waiting by the dish's station → cases 1–2
  red; `finishRelease` passing `initiatedAt: null` → case 3 red; `requestStamps` answering held for
  a not-initiated item before it checks `madeHere` → case 4 red; `applyLineEdits` taking the
  parent's `initiatedAt` from its ticket's `firedAt` → case 5 red; the children test left on
  `child.ticket.firedAt === null` → case 6 red (the rings held); the freeze kept on
  `firedAt !== null` → case 7 red. **No control for "`requestedAt` alone"** at either branch: a
  record with `fired_at` set never reaches this code (the paragraph above), so on every row that
  does, `initiatedAt` and `requestedAt` agree, and such a mutation cannot go red here. Revision 2's
  case 6 (a pre-upgrade fired burger) was deleted for that reason: its edit took `"change"`.
- [ ] **Commit.** `git commit -s -m "Hold each extra for the pass by its own station's setting"`.

## Task 5a: one release step for held groups and dishes (about 70 calls)

**Files.** Modify `apps/server/src/kitchen-release.ts`, `apps/server/src/working-order.ts`
(`releaseHeld` `:2533-2581`, `finishRelease` `:2584-2654`); create
`apps/server/src/kitchen-request.release.test.ts`.

**Interfaces.**

```ts
// kitchen-release.ts
/** D4: stamp the held (both-null) items in `scope`: those at a waiting station Requested, the
 *  rest released. Requested items are outside `heldItem()` and are never touched. */
export async function requestHeldItems(
  tx: Transaction,
  orderId: string,
  scope: SQL,
  at: string,
): Promise<{
  released: { workingOrderLineId: string; stationId: string; courseId: string | null; quantity: number | null }[];
  requested: { workingOrderLineId: string; stationId: string; courseId: string | null; quantity: number | null }[];
}>;
```

`releaseHeld` calls it in place of its update, after `rerouteHeldAtRelease` as today, so a rerouted
item's waiting is decided at its new station; its `pending` probe (`:2543-2547`) reads
`heldItem()`. `finishRelease` takes `requested` beside `fired`: requested lines are checked by
`assertSendable`, stamped sent and frozen (D3, D7) and bump the revision; they are never printed,
never given the rerouted MOVED-from ticket, and never passed to `notifyKitchenAllergyDestination`
(D7). `sendLines` passes `requested: []` until Task 6, and `fireLines`' extras release is left to
Task 5b. No other exported signature changes.

- [ ] **Failing tests** (`kitchen-request.release.test.ts`, `A773 waiter request: release`; lines
  with no extras unless a case names one):
  1. Extras released with a held group (review-1 C1's old case 4). A held burger with chips in a
     table's held group (`placeGroups`, `release: "hold"`), Fryer waiting, Grill not; `fireGroup`:
     burger released and printed at Grill; chips Requested; no Fryer or Pass job.
  2. Grill waits, Bar does not. A held group on **two bills** of one party (a burger on each, and
     on one a dish the test routes to Bar with `setRoutingCell`, as the fixture does) fired with
     `fireGroup`: both burgers Requested, the drink released and printed; the group `fired` with
     `firedAt` = the request time; no Grill or Pass job.
  3. `fireHeldLine` on a held burger, Grill waiting: Requested; nothing printed.
  4. HOLD paper: a held group whose HOLD ticket printed at Grill (Grill prints held work,
     `testing/station-printing.ts`) and at Bar; Fire with Grill waiting: Bar gets its FIRE-marked
     ticket as today; Grill gets nothing.
  5. Not swept by a later release, and a setting change releases nothing (master Contract 2:
     "changing settings … never automatically releases … outstanding work"). A Requested burger
     (Fire now, Grill waiting). (a) `fireOrderLines` named on its line (as an arrival does,
     `order-groups.ts:2499`), passing a routing a minute after its request time
     (`routingOnce(tx, cfg, new Date(Date.parse(requestedAt) + 60_000))`, `working-order.ts:1911`):
     its row identical; no new job. (b) Then `setStationsWaitForPass(tx, false, [grill])` and the
     same `fireOrderLines` again: its row still identical (`requestedAt` unchanged, `firedAt` null,
     `passControlled` true); no new job at the Grill or Pass printer. (b) is the case the
     both-stamps-null guard exists for: Grill no longer waits, so only `heldItem()` keeps the
     second update off the burger, however "the rest" is written (round 3, I-C).
     **Amended 2026-11-01 (Task 6 review, M3):** once `requestHeldItems` reads stations from held
     rows only, a release with nothing held runs no request update, so (a) also holds a second
     burger at Grill and names it in the same release: it becomes Requested at the later time
     while the first burger's row stays identical. Without it the "first update without
     `heldItem()`" control below cannot go red.
  6. Rerouted before it is stamped (round 3, M7). A held group's burger at Grill; Grill is then
     closed for the day (as `src/station-move.test.ts` closes a station) and the burger's product
     now routes to Kitchen; Kitchen waits, Grill does not; `fireGroup`: the burger's `stationId`
     is Kitchen and it is Requested there; no job at any printer. Task 6 case 3 pins the same order
     for `sendLines`.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.release.test.ts`.
  Every case fails: 1 with the chips released, 2 and 3 with the dishes released and printed, 4
  with a FIRE ticket at Grill, 5 with the burger released by the old update, 6 with the burger
  released and printed at Kitchen.
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered; unfiltered
  `src/order-groups.test.ts`, `src/till-api.groups.test.ts`, `src/split-off-extras.release.test.ts`,
  `src/split-off-extras.groups.test.ts`, `src/split-off-extras.send.test.ts`,
  `src/party-allergy.release.test.ts`, `src/kitchen-print.shared-printers.test.ts`,
  `src/kitchen-print.concurrency.test.ts`, `src/attendance-arriving-groups.test.ts`,
  `src/station-move.test.ts`, `src/kitchen-request.send.test.ts`,
  `src/kitchen-request.extras.test.ts`, `src/working-order.test.ts`; the fiscal pair, unedited;
  typecheck; format check.
- [ ] **Mutation controls:** `requestHeldItems`' second update without `heldItem()` (on
  `isNull(firedAt)`, with or without a "station not waiting" clause) → case 5b red; its first
  update without `heldItem()` → case 5a red (`requestedAt` rewritten to the later instant); its
  first update ignoring the station setting → case 2 red; `finishRelease` printing `requested` →
  case 2's job count red; `requestHeldItems` called before `rerouteHeldAtRelease` → case 6 red
  (the burger released and printed at the closed Grill).
- [ ] **Commit.** `git commit -s -m "Leave requested work with the pass when the waiter fires held work"`.

## Task 5b: the extras release inside a fire, and the master's replay and paid-group checks (about 45 calls)

**Files.** Modify `apps/server/src/working-order.ts` (`fireLines`' extras release `:2322-2350`); add
cases to `apps/server/src/kitchen-request.release.test.ts` and one case to
`apps/server/src/party-bill-actions.test.ts`.

**Interfaces.** `fireLines`' extras release becomes `requestHeldItems` scoped to the extras of the
initiated dishes: its released rows print as today, its requested rows are frozen (D7). No
signature changes.

- [ ] **Failing test and pins:**
  7. `fireLines`' extras release: a held no-preparation water with chips in a later course
     (`addTabRound` with `hold: true`: the chips get a held item, the water none), Fryer waiting;
     then `fireLines(tx, cfg, tabId, (await unsentDishLines(tx, tabId)).map((line) => ({ ...line,
     release: true })))`, as `src/split-off-extras.send.test.ts:513` does: the water's `sentAt` set;
     chips Requested; no Fryer or Pass job.
  8. Replays keep stamps and print counts (master T9): `fireGroup` with Grill waiting, then the same
     call with the same `submissionId` and expected revision: the second answer equals the first;
     the burger's row and every printer's job count unchanged, and no Grill or Pass job after
     either call. The same for `fireHeldLine`.
  9. A paid group's fire changes no financial row (master T9), a **new case in
     `party-bill-actions.test.ts`** under `describe("A773 waiter request")`, beside `:608` and
     reusing `heldFlanOnCheck` (`:544`), `pay` and `fireHeld`: every station of its venue waits;
     pay the check, select whole the check's bill row, its lines and its sale and payment rows;
     `fireHeld`: the flan's ticket item Requested, its line's `sentAt` set (D3), the check still
     settled, no FLAN ticket printing, and every selected financial row identical except the
     line's `sentAt`.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.release.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/party-bill-actions.test.ts -t 'A773 waiter request'`.
  Case 7 fails with the chips released by the old update. Cases 8 and 9 run through Task 5a's
  `releaseHeld` and pass from the start; they stay as pins (say so in the commit), each proved by a
  control below.
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered (`party-bill-actions.test.ts` whole); unfiltered
  `src/split-off-extras.send.test.ts`, `src/split-off-extras.release.test.ts`,
  `src/split-off-extras.groups.test.ts`, `src/kitchen-request.send.test.ts`,
  `src/kitchen-request.extras.test.ts`, `src/working-order.test.ts`; the fiscal pair, unedited;
  typecheck; format check.
- [ ] **Mutation controls:** `fireLines`' extras release left as the old update → case 7 red;
  `finishRelease` printing `requested` → case 8 red; `finishRelease` not stamping `requested` sent
  → case 9's `sentAt` red.
- [ ] **Commit.** `git commit -s -m "Leave a fired dish's waiting extras with the pass"`.

## Task 6: the tab's Send (about 50 calls)

**Files.** Modify `apps/server/src/working-order.ts` (`sendLines` `:2705-2806`, `releasedCourses`
`:2809-2822`), `apps/server/src/station-move.ts` (`rerouteHeldAtRelease` `:57-63`); create
`apps/server/src/kitchen-request.tab-send.test.ts`; add one case to
`apps/server/src/attendance-line-service.test.ts`.

**Interfaces.** `sendLines` calls `requestHeldItems` instead of its update and passes both sets to
`finishRelease`. `releasedCourses` is given the courses of the released **and** the requested rows
(finding 4, review-1 I1) and reads `heldItem()`. `captureOrderService(…, "send")` runs when the
released set, the requested set or the no-preparation lines is non-empty. `rerouteHeldAtRelease`
reads `heldItem()` (D6). No exported signature changes.

- [ ] **Failing tests** (`kitchen-request.tab-send.test.ts`, `A773 waiter request: tab send`):
  1. Not swept: Grill waits; a tab holding a Requested burger (`addTabRound`) and a held burger
     outside any held group (`addTabRound` with `hold: true`); `sendLines` with no line numbers
     (`testing/order-writer-fixture.ts:33`): the first burger's row identical before and after, the
     held one now Requested, no new job. A second `sendLines` with no line numbers: both identical.
  2. Not rerouted: a Requested burger whose Grill is then closed for the day (as
     `src/station-move.test.ts` closes a station), then `sendLines` with no line numbers: the
     burger's `stationId` unchanged and no MOVED slip.
  3. Rerouted held work meets the destination's setting: a held burger at a closed Grill whose
     product now routes to Kitchen. Kitchen waiting: rerouted to Kitchen and Requested there, no
     job. Kitchen not waiting: rerouted and printed with the "from Grill" ticket as today.
  4. The course goes with the waiter's send, not with what was released (review-1 I1). Grill waits.
     A later course holds burger 1, burger 2 and a water (no preparation), all `addTabRound` with
     `hold: true`. `sendLines` names burger 1 → Requested; the water still unsent (burger 2 is
     held). `sendLines` names burger 2 → Requested; the water's line `sentAt` set. Nothing in the
     course was released, which is the case today's code gets wrong. All three lines are built
     with **no** `extras` field (not with a helper that adds chips by default, as the split-extras
     suites' `pick` does; round 3, M2): chips on a burger, at Fryer, which does not wait, would be
     released and put the course in the released set, so the "released rows only" control below
     would stay green; chips on the water would give it a held item that keeps the course held, so
     the water would never send, even on correct code.
  5. A send of only requested work still records attendance (review-1 I1), a **new case in
     `attendance-line-service.test.ts`** under `describe("A773 waiter request")`, reusing its `send`
     setup (`prepare("send")`, `:66-85`: seated with Ensalada, legacy-recalled, then sent through the
     route) with its Kitchen station waiting: the Ensalada's item Requested and the send's activity
     recorded as that file's `send` case asserts it, without its location fields (A1301).
  6. Recall then Send sends it again (D20's behaviour): nothing waits; `addTabRound` a burger;
     `recallLines`; `sendLines` naming it → released again (`firedAt` set, `requestedAt` = that
     `firedAt`) and a second Grill job.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.tab-send.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/attendance-line-service.test.ts -t 'A773 waiter request'`.
  Cases 1, 2, 4 and 5 fail with the Requested or held burger released by the old update (2 also
  rerouted), 3's waiting half with the burger released at Kitchen; 3's other half and 6 pass from
  the start (6 since Task 3a) and stay as pins.
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered (`attendance-line-service.test.ts` whole); unfiltered
  `src/station-move.test.ts`, `src/till-api.station-move.test.ts`,
  `src/split-off-extras.release.test.ts`, `src/split-off-extras.edit.test.ts`,
  `src/attendance-kitchen-service.test.ts`, `src/kitchen-request.release.test.ts`,
  `src/tabs.test.ts`, `src/working-order.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `sendLines`' update left on `isNull(firedAt)` → case 1 red;
  `rerouteHeldAtRelease` on `isNull(firedAt)` → case 2 red; `requestHeldItems` called before
  `rerouteHeldAtRelease` → case 3 red; `releasedCourses`' candidates from the released rows only →
  case 4 red; its still-held read on `isNull(firedAt)` → case 4 red; the capture on released or
  no-preparation lines only → case 5 red; `recallLines` leaving `requestedAt` (Task 3a undone) →
  case 6 red.
- [ ] **Commit.** `git commit -s -m "Send a tab's held work to each station by its pass setting"`.

## Task 7: whole-branch run, guards, backlog and the PR (no product change, about 35 calls)

- [ ] Every B1 test file unfiltered, then the GREEN lists of Tasks 2–6 (3a, 3b, 5a and 5b each) once more, after a rebase on
  current main. S, the fiscal pair, the code guards. Read each `Tests` count.
- [ ] Re-run each task's mutation controls that a later task could have weakened (Task 3a's
  "printing on `initiated`" and "recall leaving `requestedAt`", Task 3b's `anyFired`, Task 4's
  "made here wins" and children test, Task 5a's two "sweep" controls (cases 5a and 5b) and its
  "request before reroute" in particular); record each red-then-reverted run in the ledger.
- [ ] Re-run the audit search; confirm every hit not touched by B1 is in B2/B3/B4/D's rows.
- [ ] Docs: no guide changes (nothing visible); `docs/developers/conventions-data.md` gains nothing
  (no new convention). Backlog: rewrite the A773-2 entry (`docs/backlog.md:88`, "A773-2 — firing
  and the pass", and `docs/backlog/till.md` "A773. Courses, groups and the pass") to name B1 as
  landed and B2–B4 as remaining with this plan's link, in the same change.
- [ ] PR (through `/finish-branch` with the worktree path and this plan's path): title "The waiter's
  fire holds each station's part for the pass when the station waits (A773-2 PR B1; no venue
  reset)"; first line: "No venue reset: the migration only adds columns with defaults"; body in
  plain English, naming that nothing can switch a station's waiting on until PR C, and that a legacy
  recall now clears the request time too (D20).
- [ ] Ledger `Status: done` for B1 and the exact next step: B2's task plan.

## Left for B2 and B3 by B1's per-task reviews (2026-11-01)

Each point was found by a B1 reviewer and is outside B1's scope; the reports are kept with lane
C's campaign notes, not in the repository.

- **B2.1:** D3's shift has a second path. When every dish in a course is Requested, `fireLines`'
  later round stamps the course's no-preparation line (a water) sent at once, as the first
  round does. B2.1's check covers both paths.
- **B2.2:** the edited-order read keeps its own `firedCourseIds`, built from
  `ticket.firedAt != null`, in `working-order.ts` (search the name). Check it under D19 when
  editing a released or Requested dish. `applyLineEdits`' late read of the next fire's kind has
  no case that reaches it; none was found, and none was shown impossible.
- **B2.5:** after Task 5a, a Requested dish moved into a course held until fired would print a
  HOLD ticket. The move task decides and pins it.
- **B2 or B3:** the extras of a dish made here, in a held group, become Requested at a waiting
  station while the group is still held (Task 4's dated paragraph). Decide the mapping where the
  pass first reads those extras.
- **B2.6:** `releaseHeld`'s count now includes Requested lines; nothing reads it yet.
- **B3, beside master Contract 8:** a held item rerouted from a closed station and then made
  Requested raises `route.released_at_closed_station` at the request, whose words say the dishes
  "went to" the closed station; the reroute also sets its `queued_at`, which D2 says a Requested
  item keeps as written; and its old station is kept only in memory, so the pass's release cannot
  print "From Grill". Decide all three: when the alert fires, what `queued_at` the reroute leaves,
  and how the release learns the old station. `rerouteHeldAtRelease` runs before
  `requestHeldItems` in both `releaseHeld` and `sendLines`.
- **B3:** `apps/server/src/kitchen-allergy.ts` reads `firedAt` in three places (search
  `firedAt`); the consumer audit gives the file to B1 with "notices B3", and B1 changed only its
  callers. B3.4's allergy notice at the release reads them.
- **B4:** the till's `screens/till-table-order-screen.current-orders.test-helpers.ts` and
  `screens/till-table-order-screen.sent-fallback.test-helpers.ts` build kitchen fixtures from
  `firedAt` and sit outside `test/`, so the audit's fixtures row does not name them.
- **B3:** a party whose fired dishes were all cancelled or moved, or whose first submission was
  all held, gets `added` on its next fire. Before the pass shows "New order" or "Added", ask the
  owner what counts as a table's first send (with Owner question 1's copy sheet).

## B2 (outline): a requested dish through every service action

Branch `feat/a773-2b2-requested-lifecycle`. Master Task 8 plus the readers of the audit table's
B2 rows. Server, and the till's cancel-context type twin. Its plan re-reads every file first and
lists the exact pinned assertions it changes.

| Task | What | Main files | Calls |
| --- | --- | --- | --- |
| B2.1 | Serving: `ServableLine.ticketRequestedAt`, internal `serviceRequested(line)` (initiation), Serve/Undo/All served of a requested dish and its split extras; `extraHeld` means genuinely held; `isReleased`, `ordersWithUnfiredDish` and `adjustments-apply.ts` keep `fired_at` (D3): a requested fixture in `unpaid-departure.test.ts` asserts `unpaid_departure.unfired_dishes` and unchanged sale and number rows, and pins that a no-preparation line sent with a Requested course reads as released (D3's shift) | `working-order.ts:3590-3810`, `adjustments-apply.ts` (read only) | 45 |
| B2.2 | Recall: draft recall of a requested dish (no RECALLED slip, no fictitious FIRE) and its source resend round trip (master T9 "source resend"; B1 Task 3b case 9 pins only the resend's write); legacy `recallLines` of a **requested** dish (B1 Task 3a already clears both stamps, D20); an edit's recall-and-resend of an already-released dish at a waiting station, which after B1 comes back Requested (D19; decide whether it keeps its release, and pin it); `changes-after-sending` treats Requested as held (pin); started or paid still refuse | `draft-recall.ts`, `order-drafts.ts:1200-1240`, `changes-after-sending.ts` | 35 |
| B2.3 | Cancellation context: `CancellationContext.components` gain `requestedAt` and `stationId` (server, parser, till twin `apps/till/src/api/line-cancel-types.ts`); a release racing the dialog refuses `tab.cancel_context_changed`; requested cancels take the not-started choices | `line-cancel-context.ts`, `line-cancel-input.ts`, `line-cancel.ts`, till types | 50 |
| B2.4 | Finish table: `finishPartyService` includes held, requested, waiting and ready unserved paid dishes with exact contexts, one transaction, unchanged refund hand-off | `finish-party-service.ts`, till `widgets/finish-table-dialog.ts` (types only) | 35 |
| B2.5 | Moves: a station move of a Requested dish keeps it Requested and pass-controlled, even to a station that does not wait; a released dish is never re-held; closing a station whose "move" choice runs `moveDishesToStation` over `stillMovable` dishes; `moveDishes`, Move this bill and `carveLines`/`splitTicketItem` carry the stamps; `groupArrivingDishes` treats a requested arrival as initiated (never re-held or re-requested); `moveLinesToGroup` refuses or keeps a requested dish (the plan reads `requireHeldGroup`'s callers and decides; if it keeps one in a held group whose HOLD ticket printed, D14's "no HOLD CHANGED for a requested extra" needs a case). GREEN adds `kitchen-delete.integration.test.ts` (master T8) | `station-move.ts`, `station-closing.ts`, `department-transfer-api.ts`, `working-order.ts` carve/split, `order-groups.ts:2431-2520`, `bill-actions.ts` | 50 |
| B2.6 | Readers: `readGroups` readiness counts initiated parts (`order-groups.ts:1492`), reminders wait for initiated dishes to be served, held counts and floor marks count Requested as fired-not-held (`readHeldCounts`, `order-state-counts.ts`, `table-signals.ts:74`, `rest-of-order.ts:72`), output-down alerts include requested pass demand (`station-outputs-down.ts:122`), station deletion counts requested work (`station-delete.ts:76`), correction slips skip requested items (nothing printed), including an edit's VOID (`working-order.ts:6075`) and HOLD CHANGED (`planHeldCorrections`, `:6612-6650`) | as listed | 50 |
| B2.7 | Whole-branch run, fiscal pair, backlog, PR | — | 35 |

## B3 (outline): the pass board and the pass's Fire

Branch `feat/a773-2b3-pass-release`. Master Tasks 5 (server half) and 6, Contracts 5–10. Asks
Owner question 1 at its start (with B4's pictures).

| Task | What | Main files | Calls |
| --- | --- | --- | --- |
| B3.1 | Pure card builder: Contract 9's `PassCard`/`PassCardItem`/`PassBoard`/`OverviewFact` (with `unitName` and `soldInEach`, finding 9's A797 hand-off), cards per party group across bills or per counter order, readiness and context digest over all active station parts before any narrowing; `kind` from `request_kind` (D8) | new `pass-card.ts` + test | 50 |
| B3.2 | `readScopedPassBoard(tx, cfg, scope, display?)` reads the rows (reusing `liveKitchenDishAt(cfg)` and `rowsWatchZones`, no new location parameter, D13) and the new routes `GET /api/device/pass-board` and the monitor's (D15), same admission as today's pass reads | `pass-board.ts`, `device-api.ts` | 50 |
| B3.3 | Station queue and current orders carry `phase`, `requestedAt`, `readyAt`, `passControlled` (server fields only; the till ignores them until B4) | `working-order.ts:7726-8290`, `order-groups.ts:1816-2045`, `dish-kitchen.ts` | 40 |
| B3.4 | `releasePassItems(tx, cfg, by: PassActor, ask)`: authority re-read (device proof, effective pass screen and scope, `prepare-orders`, a fresh `run-the-pass` screen-flag check, session for non-KDS), exact visible Requested set and context, conditional Requested → released update, `queued_at` = release, `pass_controlled` left true (master Contract 1: "preserve it through release"), FIRE marking for stations holding HOLD paper, allergy destination notice sent at the release and not before (D7) | new `pass-release.ts` + test | 55 |
| B3.5 | Route `POST /api/device/pass-screen/release` through `runServiceCommand` (party or bill scope), fingerprint, replay before stale checks, `ticket.pass_context_changed` (errors registry, D18), races with promise barriers (release vs release, Recall, move, Serve, cancel), print-once by job bytes, a printer shared by two screens prints once | `device-api.ts`, `errors.ts`, `pass-release.test.ts`, `kitchen-print.concurrency.test.ts` | 55 |
| B3.6 | Till client `releaseDevicePass(ask)` and `getDevicePassBoard`, types, code fallback EN/ES (approved words, D18); no screen change | `apps/till/src/api/client.ts`, `apps/till/src/i18n/codes.ts` | 30 |
| B3.7 | Whole-branch run, profile action/zone maps (`till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts` rows for the new route), backlog, PR | — | 35 |

## B4 (outline): the screens, the display setting, Columns

Branch `feat/a773-2b4-pass-screens`. Master Tasks 7a, 7b and 7 and the till half of Task 5. Lands
only after Owner question 1 is answered. Browser suites: measure free memory first.

| Task | What | Main files | Calls |
| --- | --- | --- | --- |
| B4.1 | Venue-service columns (finding 6: plain ADD COLUMN, no reset), `ProfileKitchenScreens` values gain `showNonPassStations?`, `DeviceKitchenScreen` `showNonPassStations?: boolean \| null`, `ResolvedKitchenScreen` effective value and override; copy/replace/narrowing keep it; `setDeviceKitchenScreenDisplay(tx, deviceId, kind, value)` (D17); profile defaults travel in `VENUE_SERVICE_CONFIGURATION_TRANSFER`, device overrides do not | `packages/venue-service/src/schema/kitchen-screens.ts`, `kitchen-screens.ts`, `service.ts`, `configuration-transfer.ts`, `packages/module/src/module.ts` | 50 |
| B4.2 | Server parsers on the profile and device admin routes, `PUT /api/device/kitchen-screen-display` (proven device, effective screen, session for non-KDS, no cooking permission), the board's `display` argument | `device.ts`, `device-api.ts`, `management-api.ts` | 45 |
| B4.3 | Dashboard: the profile's switch and the device's three-way choice (inherit / show / hide), save-state, unsaved and axe tests | `apps/dashboard/src/screens/device-profiles-screen.ts`, `devices-screen.ts`, client, strings | 50 |
| B4.4 | Columns: pass and monitor defaults (Overview, Held, To fire, In progress, Ready; Overview hidden), `held` in `STATION_COLUMNS` and drawn, the Columns window's "Other stations' dishes" section, key by server origin (D16) | `apps/till/src/state/kitchen-columns.ts`, `widgets/kitchen-columns-dialog.ts`, `widgets/station-queue.ts` | 40 |
| B4.5 | The pass screen on the new board: four columns plus Overview through `overviewRows`, dimmed other-station parts with station and state, collapse by heading, narrow tabs in the chosen order; Fire sends the card's exact ids and context once (double press, lost reply, stale refusal refreshes) | `apps/till/src/screens/till-expo-screen.ts` (+ new `till-expo-screen.requested.test.ts`) | 60 (split at the Fire flow if it nears 80) |
| B4.6 | The monitor (no Fire, no Ready) and the station's Held column with "Waiting for the pass"; the table screen's Fired section names a requested dish "at the pass" | `till-expo-screen.ts`, `widgets/station-queue.ts`, `screens/till-station-screen.ts`, `state/sent-panel.ts` | 50 |
| B4.7 | Retire `/api/device/pass-screen`, `/api/device/pass-monitor`, `/api/expo/queue` and their clients and tests (D15); guides `apps/server/src/guide/{en,es}/kitchen-service.md` (or the landed page) | as named | 40 |
| B4.8 | LOOK in EN/ES, light/dark, 390 and 1280 px; pictures for Owner question 1; backlog; PR | — | 45 |

## Task list and sizes (B1)

Estimates are read, not measured.

| Task | Calls | Commit |
| --- | --- | --- |
| 0 Preflight | 15 | none |
| 1 Columns and phase | 35 | yes |
| 2 Request kind | 45 | yes |
| 3a New dishes follow the station; legacy recall clears both stamps | 65 | yes |
| 3b The course rule reads initiation; the other new-dish writers | 45 | yes |
| 4 Extras placed with their dish | 55 | yes |
| 5a One release step for held groups and dishes | 70 | yes |
| 5b The extras release inside a fire; replay and paid-group checks | 45 | yes |
| 6 The tab's Send | 50 | yes |
| 7 Whole-branch run and PR | 35 | docs only |

B2: 7 tasks (about 300 calls), B3: 7 (about 315), B4: 8 (about 380).

## Self-review

- **Spec and master coverage.** Contracts 1–4 → B1 Tasks 1–6; Contract 5–8 → B3.4–B3.5;
  Contracts 9–10 → B3.1–B3.3; Contracts 11–12 → B4.1–B4.2 (re-keyed, D16–D17); Contract 13 →
  B4.4. Master T8 → B2; T9 → B1 (writers) and B2.6 (floor and alert readers); T9's tests: the four
  waiter paths (Tasks 3a, 5a, 6), advance refusals (Task 3b case 8), replays (Task 3a case 5, Task
  5b case 8), a paid group (Task 5b case 9), a counter moved to a table (Task 3b case 10), source
  resend (Task 3b case 9 and B2.2), a multi-output station with no duplicate item or ticket (Task
  3a case 2, "Departures"), a setting change releasing nothing (Task 5a case 5b). Spec §13's "a
  station that waits for the pass receives nothing until the pass fires, and one that does not
  wait receives it at once" → B1 Task 3a cases 1–2 (the receiving half in B3.5).
- **Claims checked by running:** the ADD COLUMN migrations, the schema guards and the list of
  existing checks the columns change (findings 6–7, in a throwaway worktree, removed); at
  revision 2, which test files the RED and GREEN commands select ("Revision 2"). Everything else
  here is read, not run, and each task's RED step is where it is first measured.
- **What this plan does not know yet.** The exact pinned cancel-context assertions (B2's plan
  lists them); whether A1301's S11 lands in `working-order.ts` before B1 (rebase, Task 0).

## Revision 2 (review-1)

Answers `~/waitron-campaign-c/a773-2b-plan-review/review-1.md` (read against `abfe271663`). Each
finding was checked against the code before acting; what was read or run is named.

| Finding | Done |
| --- | --- |
| **C1** Task 4 cases 3–4 run through code Task 5 changes | Fixed. The `fireGroup` case (old 4.4) moved to Task 5 (case 1) with the release step it needs, and the "second update without `heldItem()`" control with it (Task 5, against case 6). Old case 3 is replaced by the `split-off-extras.release.test.ts:268-308` setup with a mutation "`finishRelease` passes `initiatedAt: null`". **Departure from the review's fix:** that case stays in Task 4, not Task 5, because with that setup it reaches no code Task 5 or 6 changes: read `working-order.ts:2752-2805` (the tab has no ticket item, so `sendLines`' update returns nothing) and `:1960-1965` (`finishRelease`'s `insertSplitExtras` inserts the child, which has no item); Task 4 changes that insert. |
| **I1** `sendLines` decides course release and attendance from released rows only | Confirmed by reading `:2780-2805`. Fixed: D4 and Task 6 — `requested` rows carry `courseId`, `releasedCourses` gets both sets, the capture runs when either set or the no-preparation lines is non-empty. Pinned by Task 6 case 4 (all-requested named sends release the course's water; two mutations) and case 5 (attendance, in `attendance-line-service.test.ts`). |
| **I2** "Initiated" read from raw `requestedAt` | Fixed: D19, `initiatedAt(item)` in Task 1, `DishKitchenPlace.initiatedAt` and the children test in Task 4, pinned by Task 4 case 6 (a row with `fired_at` = T and `requested_at` null; mutation "from `requestedAt` alone"). **Corrected at revision 3:** that case never reached the code it pinned, and review-1 I2's failure scenario cannot happen in the edit path: a parent with a fired record takes `"change"` and is recalled, never reaching `addedToExisting` (round 3, I-A, P2 run). Case 6 is now the children test with a Requested child; see "Revision 3". |
| **I3** Task 3 case 6 cannot detect `anyFired` | Confirmed by reading `:2218-2251`. Fixed: Starters and Mains, both `release: true` in round 1, so Mains is not the earliest course and only `anyFired` admits round 2 (the review's setup, with `addTabRound`'s `release: true` in place of `placeGroups`, which passes the same flag, `order-groups.ts:415-422`). |
| **I4** GREEN lists select no file / skip the edit and send suites | Confirmed (`rg -l updateHeldOrder apps/server/src --glob '*.test.ts'` names no `*held-order*` or `order-edit*` file). Fixed: every list names files; `split-off-extras.edit`, `.send`, `tabs` and `working-order` suites added where they pin changed code; `requestStamps`' contract says made here wins, pinned by Task 3 case 4 and Task 4 case 4. |
| **I5** Five master T9 tests dropped | Counter moved to a table → Task 3 case 8; source resend → Task 3 case 9 (its write) and B2.2 (the round trip), a stated departure; multi-output station → rejected as a separate case, already asserted (Grill and Fryer each have two printers, `testing/split-extras-venue.ts:84-117`; Task 3 case 1, Task 4 case 1), now a departure row (**corrected at revision 3:** those cases asserted only "no job" while the station waits; the "no duplicate item or ticket" check is now Task 3a case 2, round 3 M1); paid group's fire → Task 5 case 8; `fireGroup`/`fireHeldLine` replays → Task 5 case 7. |
| **I6** Legacy recall leaves a stuck Requested item | Confirmed: `recallLines`' update is the only writer clearing `fired_at` (`rg -n "firedAt: null" apps/server/src -g '!*.test.ts'`). Fixed in B1 (D20), but in **Task 3, not Task 5**: Task 3 is where released items first carry `requested_at`, and from then a leftover stamp would already make `anyFired` count a recalled item's course as initiated. Pinned by Task 3 case 10 and, behaviourally, Task 6 case 6; B2.2 shrunk. |
| **I7** Tasks 4–5 will pass 100 calls | Fixed: re-cut into Tasks 4 (extras placed with the dish, 50), 5 (one release step: `requestHeldItems`, `releaseHeld`, `finishRelease`, `fireLines`' extras release, 60) and 6 (the tab's Send: `sendLines`, `releasedCourses`, reroute, 50). Grouped by function rather than the review's 5a/5b, so that each function changes in one task; old Task 6 is now Task 7. |
| **M1** Task 2 file list misses callers and the barrel | Fixed (`rg -n "startGroup\(" apps packages`: the two test files, plus `packages/db/src/index.ts:124-129`). |
| **M2** Two wrong RED predictions | Fixed: Task 2's RED names cases 3 and 8's `next_course` half; Task 3 case 5 seeds its own Requested stamps and is a pin. |
| **M3** Vacuous HOLD CHANGED control | Removed; D14 now says why the clause is true today (`order-groups.ts:2140-2145`). Old Task 4 case 6 dropped in favour of the existing `split-off-extras.edit.test.ts:190`, named in Task 4's GREEN. |
| **M4** Declaration case pins `location_id` | Fixed: it asserts `.omit` alone (A1301). |
| **M5** Request kind after a move unpinned | Task 2 case 9 (reorder, same-party `moveDishes`, with a mutation); arrival at another party listed as a departure. |
| **M6** One advance refusal pinned | Task 3 case 5 covers `advanceTicketItem`, `advanceTicket` and `bumpGroupReady`, with mutations on the latter two. |
| **M7** Two unsaid things | D7 and Task 5 say requested rows never reach `notifyKitchenAllergyDestination` (no B1 case can see it: the fixtures' parties answer "none"; B3.4 pins it); B3.4 keeps `pass_controlled` true on release. |
| **M8** Madrid fix-up defaults | "Changed test checks" gives every phase and the exact pragma column objects (`"false"`, `"'new_order'"`). |
| **M9** One "unknown" already answered | Removed from "does not know yet"; Task 4 case 5 points at `split-off-extras.edit.test.ts:97-112` and `:162`. **Corrected at revision 3:** `:162` does not reach this extras path for a fired burger (it takes `"change"`, and its chips come from `fireLines`, round 3 P2); the pointer to it is struck from Task 4 case 5. |
| **M10** B2.5 misses two names | Added `station-closing.ts` and `kitchen-delete.integration.test.ts`. |
| **M11** Backlog heading | Fixed: "A773-2 — firing and the pass" (`docs/backlog.md:88`). |

Also found while revising: `applyLineEdits`' VOID (`:6075`) and `planHeldCorrections`
(`:6612-6650`) read raw `fired_at`; added to the audit table and B2.6.

**Selection check, run at revision 2.** Every test path named in Tasks 1–7 was extracted from this
file (42 paths). Six do not exist yet, and are exactly the six files the tasks create
(`kitchen-phase`, `kitchen-request.{send,extras,release,tab-send}`, `order-groups.request-kind`).
`pnpm --filter @waitron/server exec vitest list --filesOnly <the 33 existing server paths>` exited 0
and listed all 33; `pnpm --filter @waitron/db exec vitest list --filesOnly` over Task 1's four db
files listed all four. Control: in an earlier run of the same command one invented path
(`src/group-submit-fixture.test.ts`) was silently left out of the listing with exit 0, so a listing
is evidence only when compared path by path against what was named, as this one was. The `-t`
filters select only the new cases: no existing test in `party-move-bill`, `party-bill-actions`,
`attendance-line-service` or Task 1's db files contains `A773` (`rg -c A773` over them matched
nothing), and `vitest list -t CORE_CONFIGURATION_TRANSFER` over the db file lists its three
existing cases. The six new files' RED runs are first measured by their tasks.

## Revision 3 (round-3)

Answers `~/waitron-campaign-c/a773-2b-plan-review/round-3.md`, a narrow claim check of revision 2
(`d45fe58b88`; 0 Critical, 4 Important, 8 Minor). The code is unchanged since `abfe271663`. Each
answer is in the task text an implementer reads; this table only points at it. Task and case
numbers in the "Revision 2" table above are revision 2's: its Task 3 cases 1–4 and 10 are now
Task 3a cases 1–4 and 6 (its 7 is 3a's 5); its Task 3 cases 5, 6, 8 and 9 are Task 3b cases 8, 7,
10 and 9; its Task 5 cases 1–4 and 6 are Task 5a cases 1–5; its Task 5 cases 5, 7 and 8 are Task
5b cases 7–9.

**Run at revision 3**, in a throwaway worktree (`git worktree add --detach /tmp/a773-2b-rev3
d45fe58b88`, `pnpm install --frozen-lockfile`, removed afterwards with `git worktree remove
--force`): `pnpm exec vitest run src/split-off-extras.edit.test.ts -t "newly added onion rings held"`
in `apps/server` printed `Tests 1 passed | 30 skipped`; with the children test at
`working-order.ts:6494-6497` changed to answer false for every child, the same command printed
`Tests 1 failed` with `AssertionError: expected '2026-11-01T16:16:12.513Z' to be null`. What a
failing probe would have printed: the case still passing under the change, meaning something else
decides the rings' stamp. Everything else below is read, not run, unless it cites round 3's own
runs (P1–P5).

| Finding | Done |
| --- | --- |
| **I-A** Task 4 case 6 never reaches the code it pins | Agreed (round 3's P2 was run; reading `:5798`, `:5961`, `:6476` agrees). Case 6 deleted, with the reason in Task 4's controls. New case 6: Fryer waits, a water's chips are Requested, an edit adds onion rings → rings Requested; control "children test left on `firedAt`" → red. The probe above shows the children test alone decides the rings' stamp in that shape (with recalled chips); the Requested-chips variant is first run by Task 4. Task 4 states that no "`requestedAt` alone" control can go red at either edit-path branch. The `:162` parenthetical is struck from case 5; the I2 and M9 rows of revision 2 carry corrections. D19 says which sites its pins reach. |
| **I-B** Task 4 case 1's snapshot cannot exist on a counter order | Agreed (`kitchen-allergy.ts:105`, read; round 3's P5, run). The snapshot clause leaves case 1 (with one line why); new Task 4 case 7 checks a Requested extra's snapshot on a table round; Task 3a case 3 (a table submission) checks a Requested dish's, with the control "Requested inserts not passed to `freezeKitchenAllergyItems`" → red. A party answering "none" still gets an entry with a null block (`kitchen-allergy.ts:128-131`, read). |
| **I-C** Task 5's sweep control can pass vacuously; Contract 2 unpinned | Agreed. Task 5a case 5 now has (a) Grill still waiting, a later-instant `fireOrderLines` (control: first update without `heldItem()` → red), and (b) Grill's setting turned off after the request, then the same call → row identical, no job (control: second update without `heldItem()`, with or without a "not waiting" clause → red). Self-review names it as the Contract 2 pin. |
| **I-D** Task 3 past 100 calls | Split into Task 3a (`kitchen-release.ts`, the helper, `fireLines`' inserts, printed set and freeze, D20; 6 cases, 7 controls, about 65) and Task 3b (`anyFired`; 4 cases, 4 controls, about 45). **Departure from the check's cut:** the advance-refusal case goes to 3b, not 3a; it seeds its own stamps and needs no 3a code, and moving it keeps 3a well under 100. 3b's resend and counter-move cases run through 3a's insert, so they pass from the start and are pins, each with a control. |
| **M1** "two jobs"; the multi-output departure | Task 3a case 2 asserts three jobs, one at each of Grill, Pass and Kitchen, and one item per line; the departure row and revision 2's I5 row cite it. |
| **M2** Task 6 case 4's extras | The case names its lines without extras, with why. Task 3a's and 5a's test files say the same for every case. |
| **M3** "nothing prints" vacuous in `party-move-bill` | Task 3b case 10 attaches a printer to every station before the move and asserts it has no job. |
| **M4** D19 claims too much; edit of a released dish | D19 narrowed to its four sites and names the unchanged ones; the recall-and-resend of an already-released dish at a waiting station is stated in D19 and added to B2.2. |
| **M5** `courseFired, :2218-2224` | `:2238-2245` in Task 3a's Interfaces (read). Task 3b case 7 cites `:2238-2251`. |
| **M6** D3 and the no-preparation shift | D3 states it; B2.1's row pins it. |
| **M7** Release order unpinned for `releaseHeld` | Task 5a case 6 (a held group at a closed Grill rerouted to a waiting Kitchen), control "request before reroute" → red. |
| **M8** D14's premise ends at B2.5 | D14 says so; B2.5's row names it. |
| Task 5 size (round 3, answer 7) | Split into Task 5a (`requestHeldItems`, `releaseHeld`, `finishRelease`; 6 cases, 5 controls, about 70) and Task 5b (`fireLines`' extras release, plus the master's replay and paid-group checks as pins with controls; about 45). |

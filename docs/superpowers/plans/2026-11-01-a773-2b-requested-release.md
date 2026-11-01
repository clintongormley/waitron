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

**Task size and end state.** Each task is sized at 25–50 tool calls (estimate in its heading). Each
ends with `pnpm --filter @waitron/server typecheck` clean (and `@waitron/db`'s when it touched the
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
   the bill releases the pass's work. B1 replaces all three with one function (D4).

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
   a requested item both would wrongly treat its course as still held.

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
(`docs/backlog.md`, "A773-2. Firing and the pass", and `docs/backlog/till.md` "A773. Courses,
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
  are never edited and run unchanged after Task 1 and Task 6. No invoice, tax, numbering or
  refund-amount change.

## Decisions

- **D1 The phase reads `fired_at` first.** `kitchenPhase({requestedAt, firedAt, state})` returns
  `waiting`/`preparing`/`ready` from `state` whenever `firedAt` is set; otherwise `requested` when
  `requestedAt` is set, else `held`. A row written before the column (fired, no request time) reads
  as released, as it is, so no backfill and no reset (finding 6). The SQL twins are
  `heldItem()` (`fired_at is null and requested_at is null`), `requestedItem()`
  (`fired_at is null and requested_at is not null`) and `initiatedItem()`
  (`requested_at is not null or fired_at is not null`); a test holds them to the TS function over
  the same rows.

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
  financial gates unchanged"); B2 pins `unpaid_departure.unfired_dishes` for one.

- **D4 One release step.** New `requestHeldItems(tx, orderId, scope, at)` in
  `apps/server/src/kitchen-release.ts` replaces the three updates of finding 1. It runs two
  updates over `heldItem()` rows in `scope`: first those at a station that waits (sets
  `requested_at`, `pass_controlled`), then the rest (sets `requested_at`, `fired_at`, `queued_at`),
  and returns both sets. A requested row is outside `heldItem()`, so no later Fire, Send or arrival
  can release it; only the pass can (B3).

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
  destination (`notifyKitchenAllergyDestination`) is sent at the pass's release, in B3.

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
  released rows only. Advance HOLD printing (`printHoldTickets`, `correctHoldTickets`) is untouched;
  a requested extra added by an edit never gets a HOLD CHANGED slip (Task 4).

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

## Consumer audit: where each current hit goes

`rg -n 'firedAt|fired_at|awayAt|away_at|passItemMarks|pass_item_marks|fireControl|fire_control|fireHeldGroupsOfCourse|fireCourse' apps packages scripts -g '!*.test.ts' -g '!**/drizzle/**'`
at `abfe271663` names 57 files. Each is assigned here; an implementer re-runs it at Task 0 and adds
any new file to the same table in the ledger.

| Files (server unless prefixed) | Hits are about | PR / task |
| --- | --- | --- |
| `working-order.ts` `fireLines`, `insertSplitExtras`, `releaseHeld`, `finishRelease`, `sendLines`, `releasedCourses`, `applyLineEdits` extras (`:6482-6530`) | writers | **B1** Tasks 3–5 |
| `order-groups.ts` `startGroup` callers, `placeGroups`, `fireHeldLine`, `releaseGroup`, `groupArrived` | group writers | **B1** Task 2 (kinds), Task 5 (release) |
| `station-move.ts:57-63` (`rerouteHeldAtRelease`) | reroute at release | **B1** Task 5 |
| `kitchen-allergy.ts` freeze at first exposure | allergy snapshot | **B1** Tasks 3–4 (D7); notices B3 |
| `working-order.ts` `servableLines`/`isReleased`/`refuseUnreleased`/`markServed` (`:3608-3810`), `ordersWithUnfiredDish`; `adjustments-apply.ts`; `unpaid-departure` | serving, money gates | B2 (serving keeps financial gates) |
| `draft-recall.ts`, `working-order.ts` `recallLines` (`:2833`), `changes-after-sending.ts` | recall | B2 |
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
| `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` | B1 Task 1 | its after-capture fix-ups (the column list at `:135-141` and the `webauthn_challenges.purpose` push after it) gain the four new db columns (`kitchen_stations.waits_for_pass` integer not null default `false`, `ticket_items.requested_at` text, `ticket_items.pass_controlled` integer not null default `false`, `order_groups.request_kind` text not null default `'new_order'`) and, on every captured row of those tables, the column's default | adding what the capture lacks, as #2257 (`webauthn_challenges.purpose`), #2292 and #2371 did to the same list; no captured value changes |
| `packages/db/src/configuration-transfer.test.ts` "CORE_CONFIGURATION_TRANSFER" | B1 Task 1 | a new case pins the `kitchen_stations` declaration with `omit: ["waits_for_pass"]` | new case, not an edit |
| none else in B1 | — | the probe's 60 server files, 4 db files and the schema guards passed with the columns in | — |
| `apps/server/src/configuration-transfer.test.ts:7281` | B4 | the expected `device_profile_kitchen_screens` row gains `show_non_pass_stations: 1` | probe; a whole-row pin gaining the new column's default |
| Madrid baseline again | B4 | the two venue-service columns | as above |
| whole-shape pins of `CancellationContext.components` (`line-cancel-context.test.ts`, the till's cancel-type parity tests, `finish-party-service.test.ts`) | B2 | each component gains `requestedAt` and `stationId` | master T8 contract; the planner of B2 lists the exact assertions after reading them |
| `pass-board.test.ts`, `device-api.pass.test.ts`, `till-expo-screen*.test.ts` pins of today's pass read | B4 | the routes they pin retire (D15) | behaviour this PR is asked to change; B4's plan lists them |
| `apps/till/src/widgets/station-queue.test.ts` "the station registers only columns the board draws" | B4 | `held` joins `STATION_COLUMNS` and is drawn | the check stays; it must still pass |

## Guard suites

Each run separately, exit status and nonzero `Tests` count read:

- **S (Task 1, Task 6):** `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/two-file-foreign-keys.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/apply-migrations-callers.test.ts`
  (about 4 minutes; 593 tests at the probe), then
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
- **Fiscal pair (Task 1, Task 6), unedited:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **Code guards (Task 6):** `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/write-path-tables.test.ts`.

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
`order-groups.ts`, `packages/db/src/configuration-transfer.ts`; generated
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
export function heldItem(): SQL;       // fired_at is null and requested_at is null
export function requestedItem(): SQL;  // fired_at is null and requested_at is not null
export function initiatedItem(): SQL;  // requested_at is not null or fired_at is not null
```

The comment beside `request_kind` follows its siblings' form: the writers' type refuses another
value; a CHECK would rebuild this table. No other comment is added.

- [ ] **Failing tests.**
  - `packages/db/src/schema/ticket-items.test.ts`, inside the existing suite and its fixture:
    `A773 phases: a new ticket item has no request time and is not pass-controlled` (insert one,
    select it, `requestedAt` null, `passControlled` false). Same file style in
    `kitchen-stations.test.ts` (`waitsForPass` false) and `order-groups.test.ts`
    (`requestKind` `"new_order"`). These fail on a missing property before the schema change.
  - `packages/db/src/configuration-transfer.test.ts` → `describe("CORE_CONFIGURATION_TRANSFER")`:
    `A773 phases: a station's pass waiting is never carried`, `toEqual` on the `kitchen_stations`
    declaration (`{ name, leaveBehindWhenFalse: "active", locationColumns: ["location_id"], omit:
    ["waits_for_pass"] }`, the existing `locationColumns` copied as it is, D13).
  - `apps/server/src/kitchen-phase.test.ts` `A773 phases`, written against a stub that returns
    `"held"` so each row fails by assertion: the tuples (requestedAt, firedAt, state) →
    phase: (null, null, queued) held; (T, null, queued) requested; (T, T, queued) waiting;
    (null, T, queued) waiting (a row from before the column, D1); (T, T, preparing) preparing;
    (T, T, ready) ready. Then **SQL twins agree**: on `useVenueDb` with
    `setupSplitExtrasVenue` (`apps/server/src/testing/split-extras-venue.ts:75`), fire a counter
    order of four burgers as four lines (`fireNewOrder`), update their stamps to the four
    `queued`/`preparing` tuples above, and select the ids matching each of `heldItem()`,
    `requestedItem()`, `initiatedItem()`; each set equals the ids whose `kitchenPhase` is
    held / requested / anything but held.
- [ ] **RED.** `pnpm --filter @waitron/db exec vitest run src/schema/ticket-items.test.ts src/schema/kitchen-stations.test.ts src/schema/order-groups.test.ts src/configuration-transfer.test.ts -t 'A773 phases'`
  and `pnpm --filter @waitron/server exec vitest run src/kitchen-phase.test.ts`. Each named case
  fails on its assertion.
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
  agreement case red; drop the `omit` → the declaration case red.
- [ ] **Commit.** Stage the named paths; `git diff --cached --check`;
  `git commit -s -m "Record when the waiter asks for each kitchen item, apart from its release"`
  (body: what the four columns hold, that nothing writes them yet, no venue reset needed and why).

## Task 2: each group says what kind of request it is (about 40 calls)

**Files.** Modify `apps/server/src/order-groups.ts` (`startGroup` `:1328`, `startGroupAfter`
`:1353`, `placeGroups` `:263`, `fireHeldLine` `:515`, `moveLinesToGroup` `:1021` at `:1103`,
`groupArrivingDishes`/`groupArrived` `:2431-2560`), `apps/server/src/working-order.ts`
(`applyLineEdits`' group start, `:6118-6140`), `apps/server/src/testing/adjustment-venue.ts:600`;
create `apps/server/src/order-groups.request-kind.test.ts`.

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
     `new_order`, held group `next_course` (fails if the kind is read inside the loop).
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
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/order-groups.request-kind.test.ts`:
  cases 2, 4, 5 and the `added` half of 8 fail on `"new_order"` (the column default), case 1
  passes only by accident of the default — so first write case 1's Fire now and held kinds as one
  assertion on both rows, which fails on the held row.
- [ ] **Minimal implementation.** `nextFireKind`; the parameter; each writer per D8; the fixture in
  `testing/adjustment-venue.ts` passes the kind its `release` implies.
- [ ] **GREEN.** RED unfiltered; then unfiltered `src/order-groups.test.ts`,
  `src/till-api.groups.test.ts`, `src/attendance-arriving-groups.test.ts`,
  `src/attendance-group-commands.test.ts`, `src/draft-recall-legacy.test.ts`; typecheck;
  format check.
- [ ] **Mutation controls:** call `nextFireKind` inside `placeGroups`' loop → case 1 red; have
  `startGroup` ignore `requestKind` → cases 2 and 4 red; `fireHeldLine` passing `nextFireKind` → case 4 red.
- [ ] **Commit.** `git commit -s -m "Record whether each kitchen group is a new order, the next course or an addition"`.

## Task 3: a new dish's kitchen item follows its station's pass setting (about 45 calls)

**Files.** Create `apps/server/src/kitchen-release.ts`, `apps/server/src/testing/pass-waiting.ts`,
`apps/server/src/kitchen-request.send.test.ts`; modify `apps/server/src/working-order.ts`
`fireLines` (`:2071-2380`).

**Interfaces.**

```ts
// apps/server/src/kitchen-release.ts
/** The named stations that wait for the pass, inactive ones included. */
export async function passWaitingStations(
  tx: Transaction,
  stationIds: readonly string[],
): Promise<ReadonlySet<string>>;
/** D2's stamps for one item the waiter's write is placing. */
export function requestStamps(input: {
  at: string;
  initiated: boolean; // the waiter fired it now (fireLines' `fired`, :2264)
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
them, and write `requestStamps`' three fields into each insert value. `fired` (`:2264`) keeps its
meaning "the waiter initiated it": it decides `sentLineIds` (D3) and `DishKitchenPlace` (Task 4
renames its stamp). `anyFired` (`:2204`) becomes "any item of the course initiated and not made
here" over `initiatedItem()`. The printed set (`:2363`) is unchanged. Requested inserted items are
passed to `freezeKitchenAllergyItems` with the printed ones (D7).

- [ ] **Failing tests** (`kitchen-request.send.test.ts`, `A773 waiter request: send`;
  `setupSplitExtrasVenue` (Grill makes burgers; Kitchen is the default station; each station has
  its own printer and Grill and Fryer share a Pass printer); `decodeTicket` and `printJobs` to read
  what printed; compare whole affected rows: `requestedAt`, `firedAt`, `passControlled`, `state`,
  `queuedAt`):
  1. Grill waits. A counter order (`fireNewOrder`) of a burger (Grill) and a dish routed to
     Kitchen (read the fixture's routing cells first; add a product or cell in the test if none
     routes there): the burger's item is Requested (D2) with `queuedAt` unchanged from
     the insert; the Kitchen item has `requestedAt` = `firedAt`; one job at the Kitchen printer and
     **no** job at the Grill or the Pass printer.
  2. Nothing waits (the default): the same order gives two released items with `requestedAt` =
     `firedAt` and today's two jobs (bytes as before: compare with the same order in
     `src/split-off-extras.release.test.ts`' style).
  3. Grill waits. A table submission with a Fire now group (burger) and a held group (burger):
     the Fire now burger Requested, the held burger with both stamps null and
     `passControlled` false; the dish lines' `sentAt`: set on the requested one, null on the held
     one (D3).
  4. Grill waits and is the device's made-here station (`device_made_here_stations`, as
     `src/made-here.test.ts` sets it): the burger is `ready`, `requestedAt` = `firedAt` =
     `readyAt`, `passControlled` false, no job.
  5. `advanceTicketItem(tx, cfg, requestedId, "preparing")` refuses `ticket.item_held`; the row is
     unchanged (caught outside `withTransaction`).
  6. Grill waits. Two burgers in a course at a table through `addTabRound`
     (`apps/server/src/testing/order-writer-fixture.ts:171`; `working-order.ts:2968`, which hands
     `fireLines` lines with neither `hold` nor `release` set, so the course rule decides): the
     first round's burger is Requested, not fired; a second round's burger of the same course is
     initiated (Requested), not held (`anyFired` reads initiation). Set the courses up as
     `src/split-off-extras.release.test.ts` does with `createCourse`/`setProductCourse`.
  7. Replay: the same `submitGroups` submission sent twice answers the first answer; stamps and
     job counts unchanged after the second.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.send.test.ts`.
  Cases 1, 3, 4, 6 fail on stamps (`requestedAt` null, or `firedAt` set at the Grill); case 2 fails
  on `requestedAt` null; 5 and 7 pass from the start and stay as pins (say so in the commit).
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered; unfiltered `src/split-off-extras.release.test.ts`,
  `src/counter-release.test.ts`, `src/made-here.test.ts`, `src/made-here.routes.test.ts`,
  `src/till-api.groups.test.ts`, `src/kitchen-allergy.capture.test.ts`, `src/kitchen-allergy.lifecycle.test.ts`,
  `src/kitchen-print.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `requestStamps` ignoring `waits` → case 1 red; leaving `requestedAt`
  null when released at once → case 2 red; `sentLineIds` only on `firedAt` → case 3's `sentAt` red;
  printing on `initiated` instead of `firedAt` → case 1's job count red; `anyFired` back on
  `fired_at` → case 6 red.
- [ ] **Commit.** `git commit -s -m "Hold a new dish for the pass when its station waits for it"`.

## Task 4: extras follow their own station, and the one release step (about 45 calls)

**Files.** Modify `apps/server/src/kitchen-release.ts`, `apps/server/src/working-order.ts`
(`DishKitchenPlace` `:1919`, `insertSplitExtras` `:1927-2035`, `fireLines`' extras release
`:2322-2350`, `applyLineEdits`' extras `:6482-6530`); create
`apps/server/src/kitchen-request.extras.test.ts`.

**Interfaces.**

```ts
// working-order.ts
interface DishKitchenPlace {
  dishLineId: string;
  stationId: string | null;
  courseId: string | null;
  requestedAt: string | null; // was firedAt: when the waiter initiated the dish; null while held
}
// insertSplitExtras' returned rows gain `requestedAt: string | null`.

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
  requested: { workingOrderLineId: string; stationId: string }[];
}>;
```

`insertSplitExtras` stamps each extra with `requestStamps({ at: routing.at, initiated:
dish.requestedAt !== null, madeHere, waits })` for the extra's **own** station. `fireLines`' extras
release becomes `requestHeldItems` scoped to the extras of initiated dishes. `applyLineEdits`
passes the parent's `requestedAt` (its ticket's, or the waiter's time when it is released now), and
gives a HOLD CHANGED slip only to an added extra that is genuinely held (`requestedAt === null`,
D14). Callers print only `firedAt !== null` as today.

- [ ] **Failing tests** (`kitchen-request.extras.test.ts`, `A773 waiter request: extras`;
  `setupSplitExtrasVenue`: chips are a burger extra routed to Fryer and carry gluten):
  1. Fryer waits, Grill does not. Counter burger with chips: burger released and printed at
     Grill; chips Requested, no Fryer or Pass job; the chips item has a frozen allergy snapshot
     (`VENUE_SERVICE.readTicketAllergies`) at the request (D7).
  2. Grill waits, Fryer does not: burger Requested, chips released and printed at Fryer.
  3. Water (no preparation) with chips, Fryer waits, at a table released through the held group's
     Fire (`fireGroup`): water line `sentAt` set; chips Requested (the `finishRelease` path).
  4. A held burger with chips joins a table's held group, then Fire on the group with Fryer
     waiting: burger released, chips Requested (`requestHeldItems` path).
  5. Edit: add chips to an already Requested burger through `updateHeldOrder`
     (`apps/server/src/testing/order-writer-fixture.ts:90-123`; Task 4 first confirms it reaches `applyLineEdits`),
     Fryer not waiting: chips released and printed (its own station decides); no HOLD CHANGED job.
  6. Edit: add chips to a burger in a held group whose HOLD paper printed (Fryer printing held
     work, `testing/station-printing.ts`): HOLD CHANGED as today (unchanged behaviour pinned).
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.extras.test.ts`;
  1–5 fail on the extras' stamps; 6 passes and stays as a pin.
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered; unfiltered `src/split-off-extras.release.test.ts`,
  `src/kitchen-request.send.test.ts`, `src/kitchen-allergy.capture.test.ts`,
  `src/kitchen-allergy.atomic.test.ts`, every `src/*held-order*.test.ts` and
  `src/order-edit*.test.ts` that `rg -l updateHeldOrder apps/server/src` names; typecheck; format check.
- [ ] **Mutation controls:** `insertSplitExtras` deciding by the dish's station → cases 1–2 red;
  `requestHeldItems` second update without `heldItem()` → case 4's chips released (red);
  `applyLineEdits` HOLD CHANGED for a requested extra → case 5 red.
- [ ] **Commit.** `git commit -s -m "Hold each extra for the pass by its own station's setting"`.

## Task 5: releasing held work leaves the pass's work with the pass (about 45 calls)

**Files.** Modify `apps/server/src/working-order.ts` (`releaseHeld` `:2533-2581`, `finishRelease`
`:2584-2654`, `sendLines` `:2705-2797`, `releasedCourses` `:2809-2822`),
`apps/server/src/station-move.ts` (`rerouteHeldAtRelease` `:57-63`); create
`apps/server/src/kitchen-request.release.test.ts`.

**Interfaces.** `releaseHeld` and `sendLines` call `requestHeldItems` instead of their updates;
their `pending` probe (`:2543-2547`) reads `heldItem()`. `finishRelease` takes
`requested` beside `fired`: requested lines are stamped sent, checked by `assertSendable` and
frozen (D3, D7), never printed and never given the rerouted MOVED-from ticket.
`releasedCourses` and `rerouteHeldAtRelease` read `heldItem()` (D6). No exported signature
changes.

- [ ] **Failing tests** (`kitchen-request.release.test.ts`, `A773 waiter request: release`):
  1. Grill waits, Bar does not. A held group on **two bills** of one party (burger on each, and on
     one a dish the test routes to Bar with `setRoutingCell`, as the fixture does) fired with
     `fireGroup`: both burgers Requested, the drink released and printed;
     the group `fired` with `firedAt` = the request time; no Grill or Pass job.
  2. `fireHeldLine` on a held burger, Grill waiting: Requested; nothing printed.
  3. Not swept: a tab holding a Requested burger and a held dish outside any held group (an
     `addTabRound` line with `hold: true`), then `sendLines` with no line numbers
     (`testing/order-writer-fixture.ts:33`): the held dish released; the burger's
     row identical before and after; no new job. Then a second `sendLines`: still identical.
  4. Not rerouted: a Requested burger whose Grill is then closed for the day (as
     `src/station-move.test.ts` closes a station), then `sendLines` with no line numbers: the
     burger's `stationId` unchanged and no MOVED slip.
  5. Rerouted held work meets the destination's setting: a held burger at a closed Grill whose
     product now routes to Kitchen, Kitchen waiting: rerouted to Kitchen and Requested there, no
     job; Kitchen not waiting: rerouted and printed with the "from Grill" ticket as today.
  6. A course with a Requested item counts as released: the course's no-preparation line
     (water) is released by the next named `sendLines` of that course (`releasedCourses`).
  7. HOLD paper: a held group whose HOLD ticket printed at Grill (Grill prints held work) and at
     Bar; Fire with Grill waiting: Bar gets its FIRE-marked ticket as today; Grill gets nothing.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.release.test.ts`;
  each case fails on stamps, a sweep, a reroute or a job.
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered; unfiltered `src/order-groups.test.ts`, `src/till-api.groups.test.ts`,
  `src/station-move.test.ts`, `src/till-api.station-move.test.ts`, `src/split-off-extras.release.test.ts`,
  `src/party-allergy.release.test.ts`, `src/kitchen-print.shared-printers.test.ts`,
  `src/kitchen-print.concurrency.test.ts`, `src/attendance-arriving-groups.test.ts`; typecheck;
  format check.
- [ ] **Mutation controls:** `requestHeldItems` second update on `isNull(firedAt)` only → case 3
  red; `rerouteHeldAtRelease` on `isNull(firedAt)` → case 4 red; `releasedCourses` on `fired_at` →
  case 6 red; `finishRelease` printing `requested` → case 1's job count red.
- [ ] **Commit.** `git commit -s -m "Leave requested work with the pass when the waiter fires held work"`.

## Task 6: whole-branch run, guards, backlog and the PR (no product change, about 35 calls)

- [ ] Every B1 test file unfiltered, then the GREEN lists of Tasks 2–5 once more, after a rebase on
  current main. S, the fiscal pair, the code guards. Read each `Tests` count.
- [ ] Re-run each task's mutation controls that a later task could have weakened (Task 3's
  "printing on `initiated`" and Task 5's "sweep" in particular); record each red-then-reverted run in
  the ledger.
- [ ] Re-run the audit search; confirm every hit not touched by B1 is in B2/B3/B4/D's rows.
- [ ] Docs: no guide changes (nothing visible); `docs/developers/conventions-data.md` gains nothing
  (no new convention). Backlog: rewrite the A773-2 entry (`docs/backlog.md`, and
  `docs/backlog/till.md` "A773. Courses, groups and the pass") to name B1 as landed and B2–B4 as
  remaining with this plan's link, in the same change.
- [ ] PR (through `/finish-branch` with the worktree path and this plan's path): title "The waiter's
  fire holds each station's part for the pass when the station waits (A773-2 PR B1; no venue
  reset)"; first line: "No venue reset: the migration only adds columns with defaults"; body in
  plain English, naming that nothing can switch a station's waiting on until PR C.
- [ ] Ledger `Status: done` for B1 and the exact next step: B2's task plan.

## B2 (outline): a requested dish through every service action

Branch `feat/a773-2b2-requested-lifecycle`. Master Task 8 plus the readers of the audit table's
B2 rows. Server, and the till's cancel-context type twin. Its plan re-reads every file first and
lists the exact pinned assertions it changes.

| Task | What | Main files | Calls |
| --- | --- | --- | --- |
| B2.1 | Serving: `ServableLine.ticketRequestedAt`, internal `serviceRequested(line)` (initiation), Serve/Undo/All served of a requested dish and its split extras; `extraHeld` means genuinely held; `isReleased`, `ordersWithUnfiredDish` and `adjustments-apply.ts` keep `fired_at` (D3): a requested fixture in `unpaid-departure.test.ts` asserts `unpaid_departure.unfired_dishes` and unchanged sale and number rows | `working-order.ts:3590-3810`, `adjustments-apply.ts` (read only) | 45 |
| B2.2 | Recall: draft recall of a requested dish (no RECALLED slip, no fictitious FIRE), legacy `recallLines` clears both stamps and `pass_controlled`; `changes-after-sending` treats Requested as held (pin); started or paid still refuse | `draft-recall.ts`, `working-order.ts:2833-2915`, `changes-after-sending.ts` | 40 |
| B2.3 | Cancellation context: `CancellationContext.components` gain `requestedAt` and `stationId` (server, parser, till twin `apps/till/src/api/line-cancel-types.ts`); a release racing the dialog refuses `tab.cancel_context_changed`; requested cancels take the not-started choices | `line-cancel-context.ts`, `line-cancel-input.ts`, `line-cancel.ts`, till types | 50 |
| B2.4 | Finish table: `finishPartyService` includes held, requested, waiting and ready unserved paid dishes with exact contexts, one transaction, unchanged refund hand-off | `finish-party-service.ts`, till `widgets/finish-table-dialog.ts` (types only) | 35 |
| B2.5 | Moves: a station move of a Requested dish keeps it Requested and pass-controlled, even to a station that does not wait; a released dish is never re-held; `moveDishes`, Move this bill and `carveLines`/`splitTicketItem` carry the stamps; `groupArrivingDishes` treats a requested arrival as initiated (never re-held or re-requested); `moveLinesToGroup` refuses or keeps a requested dish (the plan reads `requireHeldGroup`'s callers and decides) | `station-move.ts`, `department-transfer-api.ts`, `working-order.ts` carve/split, `order-groups.ts:2431-2520`, `bill-actions.ts` | 50 |
| B2.6 | Readers: `readGroups` readiness counts initiated parts (`order-groups.ts:1492`), reminders wait for initiated dishes to be served, held counts and floor marks count Requested as fired-not-held (`readHeldCounts`, `order-state-counts.ts`, `table-signals.ts:74`, `rest-of-order.ts:72`), output-down alerts include requested pass demand (`station-outputs-down.ts:122`), station deletion counts requested work (`station-delete.ts:76`), correction slips skip requested items (nothing printed) | as listed | 50 |
| B2.7 | Whole-branch run, fiscal pair, backlog, PR | — | 35 |

## B3 (outline): the pass board and the pass's Fire

Branch `feat/a773-2b3-pass-release`. Master Tasks 5 (server half) and 6, Contracts 5–10. Asks
Owner question 1 at its start (with B4's pictures).

| Task | What | Main files | Calls |
| --- | --- | --- | --- |
| B3.1 | Pure card builder: Contract 9's `PassCard`/`PassCardItem`/`PassBoard`/`OverviewFact` (with `unitName` and `soldInEach`, finding 9's A797 hand-off), cards per party group across bills or per counter order, readiness and context digest over all active station parts before any narrowing; `kind` from `request_kind` (D8) | new `pass-card.ts` + test | 50 |
| B3.2 | `readScopedPassBoard(tx, cfg, scope, display?)` reads the rows (reusing `liveKitchenDishAt(cfg)` and `rowsWatchZones`, no new location parameter, D13) and the new routes `GET /api/device/pass-board` and the monitor's (D15), same admission as today's pass reads | `pass-board.ts`, `device-api.ts` | 50 |
| B3.3 | Station queue and current orders carry `phase`, `requestedAt`, `readyAt`, `passControlled` (server fields only; the till ignores them until B4) | `working-order.ts:7726-8290`, `order-groups.ts:1816-2045`, `dish-kitchen.ts` | 40 |
| B3.4 | `releasePassItems(tx, cfg, by: PassActor, ask)`: authority re-read (device proof, effective pass screen and scope, `prepare-orders`, a fresh `run-the-pass` screen-flag check, session for non-KDS), exact visible Requested set and context, conditional Requested → released update, `queued_at` = release, FIRE marking for stations holding HOLD paper, allergy destination notice | new `pass-release.ts` + test | 55 |
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

| Task | Calls | Commit |
| --- | --- | --- |
| 0 Preflight | 15 | none |
| 1 Columns and phase | 35 | yes |
| 2 Request kind | 40 | yes |
| 3 New dishes follow the station | 45 | yes |
| 4 Extras and the release step | 45 | yes |
| 5 Held work released, requested kept | 45 | yes |
| 6 Whole-branch run and PR | 35 | docs only |

B2: 7 tasks (about 305 calls), B3: 7 (about 315), B4: 8 (about 380).

## Self-review

- **Spec and master coverage.** Contracts 1–4 → B1 Tasks 1–5; Contract 5–8 → B3.4–B3.5;
  Contracts 9–10 → B3.1–B3.3; Contracts 11–12 → B4.1–B4.2 (re-keyed, D16–D17); Contract 13 →
  B4.4. Master T8 → B2; T9 → B1 (writers) and B2.6 (floor and alert readers). Spec §13's
  "a station that waits for the pass receives nothing until the pass fires, and one that does not
  wait receives it at once" → B1 Task 3 cases 1–2 (the receiving half in B3.5).
- **Claims checked by running:** the ADD COLUMN migrations, the schema guards and the list of
  existing checks the columns change (findings 6–7, in a throwaway worktree, removed). Everything
  else here is read, not run, and each task's RED step is where it is first measured.
- **What this plan does not know yet.** Whether `updateHeldOrder` reaches `applyLineEdits`' extras
  path with a requested parent in one call (Task 4 case 5 reads the fixture first); the exact
  pinned cancel-context assertions (B2's plan lists them); whether A1301's S11 lands in
  `working-order.ts` before B1 (rebase, Task 0).

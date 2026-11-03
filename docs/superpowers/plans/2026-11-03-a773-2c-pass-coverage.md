# A773-2 PR C: a station that waits for the pass, and the coverage warning — task plan

**Goal.** PR B (B1–B4b, #2381, #2392, #2406, #2425, #2440) built everything a dish needs when its
station waits for the pass: the waiter's request, the pass's **Fire**, the pass and station screens,
"at the pass" on the table screen. Nothing can switch a station's waiting on yet: the column
`kitchen_stations.waits_for_pass` exists with default false, no route or screen writes it, and the
configuration copy refuses it. PR C lets a manager switch it on in the station editor, shows it in
the stations table, lets a configuration copy carry it, and warns on the Prep stations page when a
station that waits has no pass screen that could fire its dishes in some service zone. Saving such a
setting still succeeds; the warning only tells the manager what to fix.

**Words used here.** *Waiting station*: an active station with `waits_for_pass` true. *Requested
dish*: a ticket item with `requested_at` set and `fired_at` null, waiting for a pass's Fire
(`requestedItem()`, `apps/server/src/kitchen-phase.ts:31-33`). *Pass device*: an active device whose
profile allows what the pass's Fire checks (`prepare-orders` and the `run-the-pass` flag) and whose
resolved pass screen is available. *Covers*: a pass device's Fire would be allowed to release a dish
of that station in that zone. *Gap*: a station-and-zone pair that should be covered and is not.
*Pin*: a test of behaviour that is already right; every pin names the mutation that turns it red.

**Implements.** The [master plan](2026-10-19-a773-2-firing-and-pass.md)'s Task 10 and its PR C row
("Working PR boundaries"), under its Global Constraints, Review Focus and Shared verification
contract; the [spec](../specs/2026-10-16-a773-courses-and-groups-design.md) §5 ("Safety net on the
dashboard"), §7 change 1 ("The stations table shows 'Waits for the pass' as a column") and §13; the
[B1 slice plan](2026-11-01-a773-2b-requested-release.md)'s D9 ("PR C … removes the `omit` and adds
the boolean validation"); and the [B4 plan](2026-11-02-a773-2b4-pass-screens.md)'s "Left for PR C".
Decisions continue B4's numbering at D97.

**Researched at** `2ea0d1bd76` (main, 2026-11-03; B4b landed as #2440, A1315 part 5 as #2441).
Every file, line and signature below was read at that commit; two probes were run (P1, P2 in
"What the planning pass found") and reverted. Implementers find code by function name, never by line
alone.

**No location (owner, 2026-11-01, A1301; high priority).** Nothing here adds a `location_id`
column, a `locationId` parameter, or a per-location rule, setting, fixture or translation. The
master's `readPassCoverage(tx, cfg: Pick<TillConfig, "locationId">)` is retired: `TillConfig` no
longer exists (`apps/server/src/trading-context.ts:1-30` defines `TradingContext`), and the coverage
read takes `TradingContext` only because the functions it reuses still take one
(`orderWatchZones`, `readDevicesKitchenScreens`, `readZoneScope`); it reads no location itself. Those
existing `cfg` parameters stay for A1301 S18 to remove (lane B's queue lists S18 after A1317).

**English only.** Spanish appears only in `packages/venue-service/src/dashboard/strings.ts`' `es`
block (a catalogue the English-only guard exempts, `scripts/english-only.test.ts:180`) and in
`apps/server/src/guide/es/`. Tests read Spanish from those files.

**Fiscal.** No task touches money, invoices, numbering, the hash chain or `adjustments-apply.ts`.
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `src/inmutabilidad.test.ts` are never
edited and run unedited in the final task.

**No migration, no venue reset.** The column was added by `packages/db/drizzle/0204_requested_release.sql`
(B1). PR C changes no schema and no stored data.

**Execution.** Every implementer is dispatched as `subagent_type: "implementer"` (medium effort),
one task per dispatch, in this worktree. An implementer that passes about 150 calls with the task
unfinished stops at a passing or cleanly red point, commits, and hands over (done, left, files, each
check's state). Each task ends with the touched packages' `typecheck` clean, its focused suites
green, `pnpm format:check` clean, and a signed commit (`git commit -s`, explicit paths staged,
`git diff --cached --check`). **Browser suites (venue-service `--project browser`) run in real
headless Chromium: measure free memory first (`memory_pressure | grep free`) and run named files,
never a whole package.**

**The test-change rule (owner, 2026-10-05).** Adding fixture fields or rows is fine; a whole-shape
pin may gain the new key with every existing value unchanged. An existing check may change only
where this plan deliberately changes the behaviour it pins, and is then listed in "Changed test
checks". Any other change to an existing assertion is a **stop** to flag, never made. No guard under
`scripts/` is edited. Prefer a new case to an edit. New cases carry `A773 station policy` in their
title so the RED commands can select them with `-t`.

**Review weight: FULL.** The branch changes a cross-package contract (a station field through the
station routes, the dashboard client and the configuration copy between `@waitron/db`,
`@waitron/provisioning` and the server) and adds an authorised management route. Per-task reviews,
the fresh-context plan review, and `/finish-branch`'s full wave with two Codex run-it reviews (the
second told to set the checklist aside).

## What the planning pass found (at `2ea0d1bd76`)

1. **The storage exists; only tests write it.** `kitchenStations.waitsForPass`
   (`packages/db/src/schema/kitchen-stations.ts:41`, `flag("waits_for_pass").notNull().default(false)`).
   `rg -n "waitsForPass|waits_for_pass" packages apps scripts -g '!*.sql' -g '!**/meta/*.json'` outside
   tests finds four readers and one writer: the transfer's `omit` (`packages/db/src/configuration-transfer.ts:69-70`),
   the pass board's dimming read (`apps/server/src/pass-board.ts:72-77`), the waiter request's
   `passWaitingStations` (`apps/server/src/kitchen-release.ts:6-21`), and the test helper
   `setStationsWaitForPass` (`apps/server/src/testing/pass-waiting.ts:11`). No station route, the
   `Station` type (`apps/server/src/kitchen.ts:34-52`), `listStations` (`:131-160`), `createStation`
   (`:84-129`), `updateStation` (`:178-237`), the POST and PATCH parsers
   (`apps/server/src/management-api.ts:1562-1606`, `:1629-1709`), the dashboard's `PrepStation`
   (`packages/venue-service/src/dashboard/routing-client.ts:31-47`), the editor
   (`station-editor.ts`) or the table (`station-table.ts`) names it. No till file names it
   (`rg -n waitsForPass apps/till` finds nothing).

2. **New stations already start false everywhere.** The schema default covers setup's first station
   (`packages/provisioning/src/venue-apply.ts:322-328` sets no value), the demo seed
   (`apps/server/scripts/demo-seed/seed-catalogue.ts:73-86`) and `createStation`. Add station's form
   sets name, colour, printers and late flags only, a recorded built default
   (`docs/backlog/kitchen.md`, "Add station sets a station's name, colour, printers and late flags
   only (A756 PRs 6–8)").

3. **The configuration copy refuses the column today, and a copy without it needs no new format.**
   The `omit` makes an import refuse a row carrying `waits_for_pass` and leaves it out of exports
   (B1 finding 8, `packages/provisioning/src/configuration-transfer.ts`). The format is 10
   (`:119`, `:151`, `:464-467`). The format moved only when a table was dropped or a required key
   added (`docs/developers/conventions-data.md:1711-1721`); A756 PR 7 added a station column
   (`bump_mode`, `6037aa68ad`) without moving it (`git show 6037aa68ad -- packages/provisioning/src/configuration-transfer.ts | grep version`
   prints nothing). A format-10 copy made before PR C has no `waits_for_pass` and imports with the
   default. Exported flags are `0`/`1` numbers (`apps/server/src/configuration-transfer.test.ts:2227`,
   `:2344-2345`). The import validates station values in `validateCoreConfiguration`
   (`packages/db/src/configuration-transfer.ts:13-30`).

4. **What the pass's Fire allows is three checks, and coverage must be the same three.**
   `releasePassItems` (`apps/server/src/pass-release.ts:38-90`): the device's profile allows
   `prepare-orders` and carries `run-the-pass` (`:54-58`); its resolved `pass` screen is
   `available` (`:59-62`); the order's zone passes the profile's own zone list
   (`assertSubjectZones`, `apps/server/src/zone-access.ts:63-76`, which reads `readZoneScope`,
   `:100-107`, and lets a dish with no zone through); and the card's dishes are those
   `passScopeOf(screen)` sees (`pass-board.ts:44-52`, through `passSees`, `:33-42`: a dish in no
   zone only on an every-zone screen). The route also requires an active device
   (`apps/server/src/device-session.ts:223`, "`active = true` is the revocation filter"). The
   display setting "show other stations' dishes" changes only what is drawn (`device-api.ts:557-570`,
   "Presentation only"), so it is not part of coverage. A pass monitor has no Fire
   (`readScopedPassBoard(…, { release: false })`, `device-api.ts:587-601`), nor does a till's All
   stations view.

5. **Every device's screens resolve in a fixed number of queries.**
   `readDevicesKitchenScreens(tx, cfg, deviceIds)` (`packages/venue-service/src/kitchen-screens.ts:671-684`),
   through the existing `VENUE_SERVICE` seat (`packages/module/src/module.ts:1158-1162`). Its slots
   list active stations only, ordered by name then id, and zones by display order, name, id
   (`placesHere`, `kitchen-screens.ts:362-373`). It does not filter inactive devices: the coverage
   read does.

6. **The dish's zone is its order's watched zone.** `orderWatchZones` (`apps/server/src/watch-zones.ts:15-50`),
   the same function the board's `rowsWatchZones` wraps (`pass-board.ts:249-262`). A live dish is
   `liveKitchenDish()` (`apps/server/src/working-order.ts:8474-8493`).

7. **The sibling station routes' authority.** Station writes and the warning-shaped read
   `GET /management-api/stations/outputs-down` (`management-api.ts:1617-1627`) use `withVenueAuth`
   (`venue.configure`, `:456-469`); the station list uses `withVenueReadAuth` (`venue.view`,
   `:471-480`). A supervisor holds `venue.view` and not `venue.configure`
   (`packages/identity/src/permissions.ts:48-56`); `management-api.test.ts` already logs one in
   (`supervisorCookie`, `:241`, `:259`). The Prep stations screen needs `venue_service.manage`
   (`packages/venue-service/src/dashboard/index.ts:83`).

8. **The page refreshes through one routing watch and leaves an open editor's draft alone.** The
   screen watches `venue-service:routing` with `QUERY_DEPENDENCIES.routing` and `refreshMs: 60_000`,
   reading through the passive client after the first read (`#load`, `prep-stations-screen.ts:408-445`); with
   no live data it reloads every 60 seconds (`:378-381`). The editor resets its draft only when it
   opens on another station (`station-editor.ts:385-406`), so a refreshed list never resets a dirty
   draft. A successful save closes the editor and calls `#load()` (`:739-744`). The dashboard
   `listOutputsDown` is a passive read with no screen caller (`routing-client.ts:160-164`; `rg -n
   listOutputsDown packages apps -g '!*.test.ts'` finds only its definition). Query dependency names
   are checked by `scripts/live-subscriptions.test.ts` against declared change sources.

9. **Every gap between the editor's fields is pinned except the one before Late flags.**
   `station-editor.test.ts` pins Done on the screen after the Late flags fieldset and before the rest
   of order switch (`:661-665`), the order rest → MOVED → grouping → held (`:579-580`, `:597-599`),
   and Changes after sending as the last field (`:713-714`, "last before the buttons"). No order
   pin covers the gap between the printers field (`station-editor.ts:645-650`) and the fieldset
   (`:651`), but a count pin does: "at %ipx (printers managed: %s) the minutes, notes and read-out
   end where the fields end" counts the `.note` blocks, `toHaveLength(canManagePrinters ? 3 : 2)`
   (`station-editor.test.ts:993-995`); the plan review's probe E2 (D105's switch and note added)
   turned three of its cases red and every order pin stayed green.
   `wt-switch` has no `error` property (`packages/ui/src/components/wt-switch.ts:113-122`).

10. **The table's headings are pinned as whole lists, six times.** `station-table.test.ts:52`,
    `:78`, `:148`, `:163`; `prep-stations-screen.test.ts:516`, `:3097-3100` (`rg -n '"Shown on"|"Se
    muestra en"' packages/venue-service/src -g '*.test.ts'`). `:517-518` checks the headings contain
    none of "Waiting", "Being made", "Ready", "Late", "Oldest". Two phone-width cases hold the table
    inside the screen: "keeps the table inside %s %s %ipx" (`station-table.test.ts:112-132`) and
    "keeps the table with its read-outs inside %s %ipx" (`:165-…`).

11. **Probe P1: which existing checks pin a station's whole shape.** With
    `waitsForPass: kitchenStations.waitsForPass` added to `listStations`' select, `pnpm --filter
    @waitron/server exec vitest run` over `kitchen.test.ts`, `management-api.test.ts`,
    `till-api.test.ts`, `till-api.station-today.test.ts`, `till-api.station-move.test.ts`,
    `device-api.station-move.test.ts`, `till-api.courses.test.ts`, `till-api.profile-actions.test.ts`,
    `till-api.profile-zones.test.ts` and `kitchen-delete.integration.test.ts` gave `Tests 2 failed |
    807 passed (809)`: `kitchen.test.ts:235` ("defaults isDefault to false and lists active stations
    by name") and `:410` ("updateStation renames but cannot reactivate a removed station"), each a
    whole-shape `toEqual` now receiving `waitsForPass: false`. A second run over eleven more files
    (`till-api.fiscal-sale-paths`, `till-api.service-periods`, `till-api.allergy-kitchen`,
    `station-queue-short-names`, `station-queue-rest`, `station-order-migration`, `station-delete`,
    `kitchen-allergy.restart`, `course-retention`, `configuration-transfer`, `configuration-import`)
    gave `1 failed | 456 passed (457)`: `station-order-migration.test.ts` ("A725 drops only station
    order …") failed with `no such column: "waits_for_pass"`, because its last step migrates to a
    hand-picked set of station migrations (`:248-261`) and then calls `listStations`. Reverted.

12. **Probe P2: that test needs the B1 migration in its list, nothing else.** Adding
    `requested = …tag.endsWith("_requested_release")` beside `readyWarning` (`:53-56`) and
    `|| when === requested.when` to its list made it pass (`Tests 1 passed (1)`), with P1's change
    still in place. That is how `readyWarning` joined the list when `listStations` began reading
    `ready_warning_after_minutes`. Reverted; `git status --short` clean.

13. **A756's settings have all landed.** PR 6 (#2031, `c072fd5db6`: identical dishes, held
    printing, MOVED slips) and PR 8 (#2044, `251e256a4b`: changes after sending) are on main; the
    editor draws each (`station-editor.ts:687-761`, `printMovedSlips`, `ticketGrouping`,
    `printHeldWork`, `changesAfterSending`) and A756's backlog says only "Waits for the pass" and
    `fire_control`'s removal remain, both A773-2's (`docs/backlog/kitchen.md`, "A756. The Kitchen tab
    split up", last paragraph). The master's "Consume A756 PR 6 … and PR 8 …" therefore needs nothing.

14. **The guide describes the pass's side and never how a station starts waiting.**
    `apps/server/src/guide/en/kitchen-service.md` `#pass-screen` (`:183-256`) and `#request-cooking`
    (`:306-325`) say what happens to "a dish whose station waits for the pass"; `#service-lifetime`
    (`:83-126`) lists each station setting the editor holds and omits it. The Spanish twin has the
    same ids (`es/kitchen-service.md:92`, `:209`, `:340`). The dashboard's prep screens draw no help
    bubble and no guide link (`rg -n "wt-help-tooltip|guideHref" packages/venue-service/src/dashboard -g '!*.test.ts'`
    finds nothing).

15. **The copy sheet the owner approved (2026-11-02) has none of PR C's words.**
    `~/waitron-campaign-c/a773-2b3-owner-questions.md` Question 1's table (`:27-50`) holds the pass
    and station words; the B1 plan says PR C's station-editor words and the coverage sentence "are
    asked by those PRs" (`2026-11-01-a773-2b-requested-release.md:496-498`). The master's proposals
    ("Waits for the pass" / «Espera al pase»; "No pass covers {stations} in {zone}. Food may wait for
    release.", `2026-10-19-a773-2-firing-and-pass.md:59`) were never approved. Approved words reused
    here: «Marchar» (Fire), «pantalla de pase» (`strings.ts:1135`), "Runs the pass" / «Lleva el pase»
    (`apps/dashboard/src/i18n/strings.ts:2545`, `:6339`), "Devices" / «Dispositivos» (`prep.devices`,
    `strings.ts:319`, `:1229`), Yes/No (`venue.yes`/`venue.no`, `:436-437`, `:1350-1351`). The
    owner has since approved PR C's two wording tables as written ("Owner answers").

16. **A profile's zone list binds only a till or handheld pass with a department.**
    `readProfileZones` answers "every zone" for a shared display (a kitchen display) and for a
    profile with no department or starting zone (`packages/venue-service/src/profile-access.ts:91-97`);
    otherwise its zones are the department's `zone_service_policies` rows whose zone and department
    are active, narrowed by `device_profile_zones` unless the profile serves every zone (`:99-121`).
    `setProfileServiceAccess` refuses any department or zone on a shared display (`:274-277`) and a
    zone list without a department and starting zone (`:279-294`). A non-KDS Fire also needs a person
    signed in (`pass-release.ts:52-53`); `pass-release.test.ts` builds such a pass with
    `signedInTillPass` (`:577-589`) and limits its zones with `serveElsewhere` (`:591-604`).

17. **The split-extras fixture already has two zones and a seated party.** `setupSplitExtrasVenue`
    offers its products in a "tables" zone and a "counter" zone and seats a party at a table in the
    first (`apps/server/src/testing/split-extras-venue.ts:209-216`; `venue.party.zoneId`,
    `venue.counter.zoneId`). `fireNewOrder` opens a counter-zone order (`:229-231`). A kitchen-screen
    choice of `zoneIds: []` is refused `kitchen_screen.invalid` (`checkedChoice`,
    `packages/venue-service/src/kitchen-screens.ts:520-531`), so "no zone left" is built as a listed
    zone then deactivated, as `pass-release.test.ts:325-366` does ("refuses a pass with no zone left,
    and a dish in no zone to a zone-limited pass", which also builds a zone-less counter order by
    deleting its `order_service_contexts` row, `:339-341`).

## Scope

**In PR C.** The station field through `Station`, `listStations`, `createStation`, `updateStation`,
the POST and PATCH routes, the dashboard's `PrepStation` and `updateStation`; the configuration copy
carrying and checking it; `readPassCoverage` and `GET /management-api/stations/pass-coverage`; the
editor's switch, the table's column, the page's warning; the guide section; LOOK; backlog.

**Out.** Add station's form (D98). The demo seed's stations (stay false, D98). Anything on the till
(D108). The follow-ups that become reachable once a venue switches waiting on and that already have
backlog entries: the manager overview's "orders taking too long" ageing a waiting dish from its
insert (`docs/backlog/kitchen.md`, `computeOverdueOrders`), a pass warning before releasing to a
station whose output is down (`docs/backlog.md`, B3 D54), the help badges and other "Left for
later" points of the B4 plan. PR D's ticket headings, "Goes with kitchen food" and schema
retirement.

## Decisions

- **D97 No location.** As stated above. `readPassCoverage(tx: Transaction, cfg: TradingContext)`;
  the route passes `requireVenueCfg(deps)` as its siblings do.

- **D98 The station field.** `Station` and `listStations` gain `waitsForPass: boolean`.
  `createStation`'s input gains optional `waitsForPass?: boolean`, stored as given, else false.
  `updateStation`'s patch gains optional `waitsForPass?: boolean` (it is spread into the update with
  the other plain fields, `kitchen.ts:197-228`). The POST and PATCH routes read `waitsForPass` as
  their other booleans are read: absent leaves it out, anything but a boolean (explicit `null`
  included) refuses `management.request_invalid` `{ field: "waitsForPass" }` before any write. The
  dashboard's Add station form does not offer it (the A756 built default, finding 2); the route
  accepts it so the create and patch shapes match. Provisioning and the demo seed are unchanged.
  Changing the setting affects dishes the waiter asks for afterwards only: B1's `requestStamps`
  freezes the choice on each item at the request (`kitchen-release.ts:23-36`), and nothing in this
  PR releases or re-holds a dish already asked for (master Contract 2).

- **D99 The configuration copy carries it, unchanged format.** `kitchen_stations` loses its `omit`
  (and the comment above it). `validateCoreConfiguration` refuses a row whose `waits_for_pass` is
  present and is neither `0` nor `1` (`null`, `true`, `"1"`, `2` all refuse) with
  `setup.request_invalid` `{ field: "kitchen_stations.waits_for_pass" }`, before anything is
  written. `0` and `1` are what the export writes (finding 3), pinned by the round-trip case. An
  absent key imports the default, false. This is deliberately stricter than the station's other
  flags, which the import does not check at all (`packages/db/src/configuration-transfer.ts:16-30`)
  and whose JSON `true` the import would bind as `1` (`bindable`,
  `packages/provisioning/src/configuration-transfer.ts:210-213`): a copy is made by the export, which
  never writes `true`, so anything else is a hand-edited file and is refused rather than guessed at. No format change: a format-10 copy without the key is
  still a correct copy (finding 3); a copy with the key, read by a box built before PR C, is refused
  by that box's `omit` with `setup.request_invalid` naming the field, which is an explicit refusal,
  not a wrong import.

- **D100 Coverage is the Fire's own authority, never a second copy of it.** `pass-release.ts`
  exports `passReleaseRefusal(device: { formFactor: FormFactor; capabilities: readonly string[] }):
  "prepare-orders" | "run-the-pass" | null`, the loop at `:54-58` moved into it unchanged;
  `releasePassItems` throws `device.forbidden_action` `{ action }` when it answers non-null, exactly
  as today. `readPassCoverage` counts a device as a pass device when it is active, its profile gives
  `passReleaseRefusal(…) === null`, and its resolved `pass` screen (`readDevicesKitchenScreens`) is
  `available`. A pair is covered when some pass device has `passSees(passScopeOf(screen), pair)` and
  the pair's zone is null or allowed by the device profile's zone list (null: every zone), the list
  `assertSubjectZones` checks through `readZoneScope`. That list binds only a till or handheld
  profile with a department and starting zone; a kitchen display's, and a profile's without a
  department, is every zone (finding 16). A till counts though its Fire also needs a person signed
  in: that is a sign-in, not a setting. **No read per profile.** A new venue-service function
  `readProfilesZones(tx, profileIds): Promise<Map<string, string[] | null>>` (beside
  `readProfileZones` in `profile-access.ts`, exposed on the `VENUE_SERVICE` seat with no `cfg`,
  as B4's new seat took none) answers every profile's `allowedZoneIds` in two queries whatever the
  number of profiles: one for the profiles and their service access, one for the allowed zones of
  the profiles that have a department, grouped by profile. A venue-service case holds it equal to
  `readProfileZones(…).allowedZoneIds` profile by profile, so the Fire's check and the warning's
  cannot drift. `assertSubjectZones` is unchanged.

- **D101 Which pairs must be covered.** (a) Each active waiting station with each active floor zone.
  If the venue has no active zone, each active waiting station with "no zone", which only an
  every-zone pass covers. (b) Each requested dish that is live (`liveKitchenDish()` and
  `requestedItem()`), whatever its station's setting now and whether its zone is still active, with
  its order's watched zone (null allowed, needing an every-zone pass). A requested dish at a
  deactivated station cannot arise: deleting a station refuses `station.work_in_progress` while any
  of its items has `fired_at` null (`apps/server/src/station-delete.ts:58-70`), and the editor
  cannot set `active` (`kitchen.ts:194-195`). The read does not filter by station `active`, and no
  case builds that state. A station that
  is closed today stays in (a): closing is a day state, and the pass card already says what to do
  about a dish at a closed station (B3). Held dishes and dishes already released are not pairs.
  Known limit, reasoned not measured: an order taken with no service zone while the venue has zones
  needs an every-zone pass, and is warned about only once one of its dishes waits (the master's
  rule).

- **D102 The answer.** `PassCoverageGap = { stationId: string; stationName: string; zoneId: string
  | null; zoneName: string | null }`, each pair once, ordered by zone (`floor_zones.display_order`,
  name, id; no zone last), then station name, then station id. Names come from the station and zone
  rows whatever their `active` flag. An empty list means nothing to warn about.

- **D103 The route.** `GET /management-api/stations/pass-coverage`, registered beside
  `/stations/outputs-down`, `requireManagementSession` then `withVenueAuth` (`venue.configure`), as
  outputs-down. It reads no body and no query. New refusing cases: a supervisor (holds
  `venue.view` only) 403 `authorization.not_permitted`, staff 403, no session 401
  `management_session.required`.

- **D104 The dashboard reads it passively, in its own watch.** `PrepStationsApi.readPassCoverage():
  Promise<PassCoverageGap[]>` sends `GET`, `{ passive: true }` always (an automatic read, never a
  person's action). `QUERY_DEPENDENCIES["pass-coverage"]` lists, reader by reader, the tables the
  answer's configured half reads:

  | Reader | Tables |
  | --- | --- |
  | the waiting stations and active zones | `kitchen_stations`, `floor_zones` |
  | the pass devices and their profiles' action and flag | `devices`, `device_profiles` |
  | `readDevicesKitchenScreens` (`readChoices`, `readRemovals`, `readStored`, `placesHere`, `kitchen-screens.ts:63-110`, `:362-445`) | `device_kitchen_screens`, `device_kitchen_screen_stations`, `device_kitchen_screen_zones`, `device_kitchen_screen_removals`, `device_profile_kitchen_screens`, `device_profile_kitchen_screen_stations`, `device_profile_kitchen_screen_zones` (plus the two above) |
  | `readProfilesZones` (as `readProfileZones`, `profile-access.ts:71-121`) | `device_profile_service_access`, `device_profile_zones`, `zone_service_policies`, `departments` (plus `device_profiles`, `floor_zones`) |

  It deliberately leaves out `ticket_items` and the order tables, which change with every dish
  during service; the 60-second `refreshMs` picks up a requested dish's gap (`refreshMs` polls even
  with live data, `packages/dashboard-kit/src/live-data.ts:81-87`). The screen holds a second `QueryController` for it, so its failure never
  shows `prep.load_error` and the routing read's recovery never clears it. A failed read shows one
  line in the warning's place (Owner answer 2); the next successful read replaces it. After a
  station save the screen re-reads it with the routing (both `#load` paths). It never touches an
  editor's draft.

- **D105 The switch's place in the editor.** A `wt-switch name="waitsForPass"` and a
  `<p class="note" data-test="waits-for-pass-hint">` go between the printers field (and its
  "printers need an active station" note) and the Late flags fieldset, the one gap no order pin
  covers (finding 9), so no order pin changes; the `.note` count pin does (Changed test checks). It joins `Draft`, `equal`, `sendable` and the
  `changed` field union as `printHeldWork` does; Save stays disabled through `saveActionState` until
  it differs from the opened value; flipping it back makes Save quiet again. A refusal naming
  `waitsForPass` can only come from a bug (the editor sends a boolean); it shows on the line above
  the buttons, as a refusal naming `printHeldWork` does (`stationRefusalField` places neither).

- **D106 The table's column.** `prep-station-table` gains a column keyed `waitsForPass`, headed
  "Waits for the pass", between Shown on and Actions, reading `venue.yes` / `venue.no`. The six
  whole-list heading pins gain it (finding 10, Changed test checks).

- **D107 The warning's place and shape.** Under the page heading and above the tabs, so it shows on
  Stations and Routing alike, a `<section data-test="pass-coverage" class="warning" role="status">`
  with one `<p>` per zone that has gaps: the zone's stations joined by `listOf`
  (`painter-labels.ts:9-13`), the sentence from Owner answer 2, and "Devices" as a link to
  `/manage/devices` (the table already links there, `prep-stations-screen.ts:687-690`). Nothing when
  the list is empty. `.warning` is the page's existing class (`prep-stations-screen.ts:156-158`).

- **D108 Nothing changes on the till.** No till code reads the field (finding 1). The pass board
  reads `waits_for_pass` at every board read (`pass-board.ts:72-77`), so switching it on changes a
  pass's dimming at that pass's next read; no `setupRevision` is involved.

- **D109 The A756 integration needs nothing** (finding 13).

- **D110 The guide.** A new section in `kitchen-service.md`, EN and ES, "Make a station wait for the
  pass" / «Haz que una estación espere al pase» `{#station-waits}`, written from the code (each
  sentence's `file:line` in the task's report): where the switch is, what a waiting station's dishes
  do, that the change affects later requests only (D98), what covers a station and zone (D100), that
  saving with a gap is allowed and the Prep stations page warns, and that a configuration copy
  carries the setting. Fixing a gap takes two steps on two pages, and the section names both: under
  **Device profiles**, the device's profile offers a pass screen and has **Runs the pass** on (and,
  for a till or handheld profile limited to a department, that department serves the zone); under
  **Devices**, the device picks the pass screen and its stations and zones. The warning's link
  stays "Devices", as the owner approved; the guide carries the profile step. `#pass-screen` and `#request-cooking` link to it where they first say "a dish
  whose station waits for the pass"; `#service-lifetime`'s list of station settings gains it.

## Departures from the master plan

| Master (Task 10) | This plan | Why |
| --- | --- | --- |
| `readPassCoverage(tx, cfg: Pick<TillConfig,"locationId">)` | `readPassCoverage(tx, cfg: TradingContext)` | No locations (D97); `TillConfig` no longer exists |
| "venue-service effective kitchen-screen read/service seat" | no venue-service seat change | `readDevicesKitchenScreens` already resolves every device in fixed queries (finding 5) |
| "Consume A756 PR 6 … and PR 8 Recall policy" | nothing | both landed and drawn (finding 13) |
| Coverage: stations × zones, monitor and forbidden profiles excluded | also the profile's own zone list and the device's `active` | the Fire checks both (finding 4); a warning that disagrees with Fire is wrong |
| "update provisioning station field readers" | none | the schema default is already false (finding 2) |
| Coverage words: "No pass covers {stations} in {zone}. Food may wait for release." | a sentence that names what to do (Owner answer 2, approved) | CLAUDE.md: say what happened and what to do |
| "station input … add `waitsForPass`" | the route accepts it; Add station's form does not offer it | A756 built default (finding 2) |
| "column/read-only state" | no read-only case | the Prep stations screen has no read-only mode: it declares no `readPermission` (`packages/venue-service/src/dashboard/index.ts:79-84`), and everyone who may open it (`venue_service.manage`, manager and up, `packages/venue-service/src/permissions.ts:6`) may change a station |
| profile zones via `readZoneScope` per profile | one batched `readProfilesZones` | no read per profile (D100) |
| case 10's C in a department of its own | `setupSplitExtrasVenue`'s T and C share one department, so case 10 keeps C out by the till pass's zone list alone | the fixture has one department for both zones (Revision 2); the department half is held by the venue-service `readProfilesZones` case |

## Consumer audit

`rg -n "waitsForPass|waits_for_pass" packages apps scripts docs/developers -g '!*.sql' -g '!**/meta/*.json'`
at `2ea0d1bd76`, every hit:

| Hit | Task |
| --- | --- |
| `packages/db/src/schema/kitchen-stations.ts:41` (column) | unchanged |
| `packages/db/src/configuration-transfer.ts:69-70` (`omit`) | Task 2 removes |
| `packages/db/src/configuration-transfer.test.ts:275-279` (pins the `omit`) | Task 2 (changed check) |
| `packages/db/src/schema/kitchen-stations.test.ts:130` (default false) | unchanged |
| `apps/server/src/pass-board.ts:77`, `kitchen-release.ts:17` | unchanged readers |
| `apps/server/src/testing/pass-waiting.ts:11` | unchanged; existing tests keep using it |
| `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:204` (table_info) | unchanged (no schema change) |
| `apps/server/src/{unpaid-departure,table-signals.pass-wait,adjustments-apply}.test.ts` | unchanged (set through the helper) |

New readers this PR adds: `listStations` (Task 1), `validateCoreConfiguration` (Task 2),
`readPassCoverage` (Tasks 3a–3b), the dashboard's `PrepStation` consumers (Tasks 5–7). Other
callers of `listStations`/`listStationsToday` that gain the key in their answers: `GET
/management-api/stations` (`management-api.ts:1608-1615`), `GET /api/stations`
(`till-api.ts:2215-2220`), `GET /api/device/stations` (`device-api.ts:737-748`),
`apps/server/scripts/dev-setup.ts:294`. P1 ran each route's suites; only the two `kitchen.test.ts`
pins and the migration case changed.

## Changed test checks (expected; the implementer confirms each)

| File:line | Before | After | Decision |
| --- | --- | --- | --- |
| `packages/db/src/configuration-transfer.test.ts:275-279` "A773 phases: a station's pass waiting is not carried" | `omit` equals `["waits_for_pass"]` | retitled "A773 station policy: a station's pass waiting is carried"; the whole `kitchen_stations` declaration `toEqual({ name: "kitchen_stations", leaveBehindWhenFalse: "active" })` | D99 |
| `apps/server/src/kitchen.test.ts:235` and `:410` | whole station shape | gains `waitsForPass: false`, every other value unchanged | D98 (P1) |
| `apps/server/src/station-order-migration.test.ts:53-56`, `:248-261` (set-up, not an assertion) | final `setsAsOf` keeps the station migrations up to `_station_ready_warning` | also keeps `_requested_release` | D98 (P2) |
| `packages/venue-service/src/dashboard/station-table.test.ts:52`, `:78`, `:148`, `:163` | `["Name","Printed on","Shown on","Actions"]` / Spanish | `"Waits for the pass"` / `"Espera al pase"` inserted before Actions | D106 |
| `packages/venue-service/src/dashboard/prep-stations-screen.test.ts:516`, `:3097-3100` | same lists | same insertion | D106 |
| `packages/venue-service/src/service.test.ts:22-…` "exposes every generic ordering capability" | the seat's sorted key list | gains `"readProfilesZones"` in sorted place | D100 |
| `packages/venue-service/src/dashboard/station-editor.test.ts:993-995` ("at %ipx (printers managed: %s) the minutes, notes and read-out end where the fields end") | `.note` count `canManagePrinters ? 3 : 2` | `canManagePrinters ? 4 : 3`; the rest of the case (every block lines up with the name field at 390 and 1280 px) unchanged, and now also holds the new switch and its line | D105 (review probe E2) |

Fixtures that grow (no assertion changes): every `PrepStation`/`StationEditorStation` literal in
`packages/venue-service/src/dashboard/*.test.ts` and `packages/venue-service/test/station-delete-test-helpers.ts`
gains `waitsForPass: false` (`rg -l "changesAfterSending:" packages/venue-service` lists them).
Every stub of the Prep stations screen's API or of its requests gains the coverage read answering
`[]` (Task 7), or the page draws the read-failure line: `prep-stations-screen.a11y.test.ts:135`,
`:325`, `:420`, `:489`; `prep-stations-screen.unsaved.test.ts:111`;
`packages/venue-service/test/station-delete-test-helpers.ts:103`;
`apps/dashboard/src/dashboard-app.unsaved-changes.test.ts:996-1009` (its request stub throws
`Unexpected request` for any other path); `apps/dashboard/src/dashboard-app.test.ts:4309`, `:4358`
(their stubs already answer `[]`, so they need nothing, but Task 7 runs them).

## Guard suites (the final task runs each; earlier tasks run the ones they name)

- `scripts/live-subscriptions.test.ts` (Task 4: the new query key's table names).
- `scripts/native-form-fields.test.ts` (Tasks 5, 7: no native field; `wt-switch` only).
- `scripts/help-tooltip-mode.test.ts` (no tooltip is added; run once to show it stays green).
- `scripts/guide-links.test.ts`, `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts` (Task 8).
- `scripts/english-only.test.ts` (Tasks 5–8).
- `scripts/style-token-names.test.ts`, `scripts/primary-coloured-text.test.ts`,
  `scripts/pinned-actions-column.test.ts` (Tasks 6–7).
- `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts` are not needed: no new error
  or alert code. `scripts/personal-log-params.test.ts` is not needed: no new log field.

## Owner answers

The owner approved both tables below exactly as written ("WATCHER 2026-11-03 ~23:35" in
`~/waitron-campaign-c/questions.md:1829-1830`: "'Y' to both tables as written … PR C may land on them
once built and green"). No landing waits on words. Tasks 5–7 build these words exactly.

**Answer 1 of 2 — the station editor's switch and the stations table (approved).** Worked example: the manager opens Grill in Prep stations; under Printers is a
switch "Waits for the pass", with the line under it; the stations table gains a column "Waits for
the pass" reading Yes for Grill and No for Bar.

| Where | English (approved) | Spanish (approved) |
| --- | --- | --- |
| Switch label and column heading | Waits for the pass | Espera al pase |
| Line under the switch | Its dishes wait at the pass until the pass fires them. | Sus platos esperan en el pase hasta que el pase los marcha. |
| Column cells | Yes / No (existing) | Sí / No (existing) |

"Waits for the pass" is the spec's own name for the setting (§5); «Espera al pase» is the master
plan's proposal and matches the approved «Esperando al pase».

**Answer 2 of 2 — the warning on the Prep stations page (approved).** Worked
example: Grill and Cold wait for the pass. The only pass screen covers Grill and Cold in Inside, not
the Terrace. Above the tabs: "Nothing fires dishes from Grill and Cold in Terrace: no pass screen
covers them there. Set one up under Devices." (Devices is a link.)

| Case | English (approved) | Spanish (approved) |
| --- | --- | --- |
| A zone | Nothing fires dishes from {stations} in {zone}: no pass screen covers them there. Set one up under Devices. | Nadie marcha los platos de {stations} en {zone}: ninguna pantalla de pase los cubre allí. Configura una en Dispositivos. |
| Dishes with no service zone | Nothing fires dishes from {stations} that have no service zone: only a pass screen on every service zone covers them. Set one up under Devices. | Nadie marcha los platos de {stations} sin zona de servicio: solo los cubre una pantalla de pase con todas las zonas de servicio. Configura una en Dispositivos. |
| The read failed | Which pass screens cover these stations could not be checked. | No se pudo comprobar qué pantallas de pase cubren estas estaciones. |

The sentence holds for a station set to wait and for dishes already waiting at a station that no
longer does (D101 (b)); the guide says that a pass screen covers only on a device whose profile Runs
the pass.

## Task 0: preflight (no commit, about 15 calls)

- [ ] `git -C <worktree> fetch && git log --oneline 2ea0d1bd76..origin/main -- apps/server/src/kitchen.ts apps/server/src/management-api.ts apps/server/src/pass-release.ts apps/server/src/pass-board.ts packages/db/src/configuration-transfer.ts packages/venue-service/src/dashboard apps/server/src/guide`.
  If anything landed (A1301 S18 is queued in lane B and edits `kitchen.ts`'s `cfg` parameters),
  rebase and re-read the lines this plan cites.
- [ ] Read the other lanes' queues and live worktrees for these files (`~/waitron-campaign*/queue.md`,
  `git worktree list`); never edit a file another lane's open branch reserves without saying so in
  the ledger.
- [ ] `pnpm install`; `memory_pressure | grep free`.
- [ ] Ledger `docs/handoffs/2026-11-03-a773-2c.md` (`Status: in progress`), add `docs/handoffs/` to
  `.git/info/exclude` if not ignored.

## Task 1: the station field through the station routes (about 45 calls)

**Files.** `apps/server/src/kitchen.ts`, `management-api.ts`; tests `kitchen.test.ts`,
`management-api.test.ts`, `station-order-migration.test.ts`.

**Interfaces.** D98: `Station.waitsForPass: boolean`; `createStation(tx, cfg, { …, waitsForPass?:
boolean })`; `updateStation(tx, cfg, id, { …, waitsForPass?: boolean })`; POST and PATCH bodies
`waitsForPass?: boolean`.

- [ ] **Failing tests** (new cases, `A773 station policy` in each title):
  1. `kitchen.test.ts` "A773 station policy: a station starts not waiting, and a patch switches it
     on and off": `createStation` without the key → `listStations` row `waitsForPass: false`;
     `updateStation(…, { waitsForPass: true })` → true; `{ waitsForPass: false }` → false; a patch
     naming only `name` leaves it as it was.
  2. `kitchen.test.ts` "A773 station policy: create stores a given waitsForPass": `createStation(…,
     { name, waitsForPass: true })` → true.
  3. `management-api.test.ts` "A773 station policy: the station routes carry waitsForPass": POST
     without it → GET `/stations` lists false; POST with `true` → true; PATCH `{ waitsForPass:
     false }` → 204 and false; PATCH with `null`, `"true"`, `1` each → 400
     `management.request_invalid` `{ field: "waitsForPass" }` and the stored row unchanged (compare
     the whole row before and after); POST with `null` → 400, same field, no station created.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts src/management-api.test.ts -t 'A773 station policy'`
  — the new cases fail on `waitsForPass` being undefined or ignored (not on an import error).
- [ ] **Minimal implementation.** Add the column to `listStations`' select and the `Station`
  type; `createStation`'s values `waitsForPass: input.waitsForPass ?? false`; the patch type; in
  both routes, read `waitsForPass` exactly as `printHeldWork`/`isDefault` are read. Add
  `requested_release` to `station-order-migration.test.ts`'s final set (finding 12) and
  `waitsForPass: false` to the two `kitchen.test.ts` pins (Changed test checks).
- [ ] **GREEN.** `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts src/management-api.test.ts src/station-order-migration.test.ts src/till-api.station-today.test.ts src/device-api.station-move.test.ts`
  (read each `Tests` count); `pnpm --filter @waitron/server typecheck`.
- [ ] **Mutation controls.** (a) Drop `waitsForPass` from `updateStation`'s patch type and strip it
  in the PATCH route → case 3's PATCH to false stays true, red. (b) Replace `?? false` with `?? true`
  → cases 1 and 3's absent create red. (c) Make the PATCH route accept `null` (skip the type check
  when `null`) → case 3's `null` row red. Revert each.
- [ ] **Commit.** `A station's routes read and write whether it waits for the pass (A773-2 PR C)`.

## Task 2: the configuration copy carries the setting (about 40 calls)

**Files.** `packages/db/src/configuration-transfer.ts`, its test; `apps/server/src/configuration-transfer.test.ts`.

- [ ] **Failing tests.**
  1. db `configuration-transfer.test.ts`: the changed check (Changed test checks row 1).
  2. db, new `it.each([null, true, "1", 2, -1])("A773 station policy: refuses an imported
     waits_for_pass of %j", …)` → `setup.request_invalid` `{ field: "kitchen_stations.waits_for_pass" }`;
     and "A773 station policy: accepts 0, 1 and an absent waits_for_pass" → no throw.
  3. server `configuration-transfer.test.ts`, beside "transfers each station's changes after
     sending": "A773 station policy: transfers each station's pass waiting" — source Grill
     `waitsForPass: true`, Cold false; the bundle's rows carry `waits_for_pass: 1` and `0`; the
     imported rows read true and false.
  4. server: "A773 station policy: a copy without waits_for_pass imports every station not waiting"
     — delete the key from every bundle row, import, every station false.
  5. server: "A773 station policy: refuses an imported waits_for_pass outside 0 and 1 before
     writing anything" — `"yes"`; rejects with the field; tenants and stations counts 0 (as the
     changes-after-sending refusal case checks).
- [ ] **RED.** `pnpm --filter @waitron/db exec vitest run src/configuration-transfer.test.ts -t 'A773 station policy'`;
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts -t 'A773 station policy'`.
  Today case 3 fails on the refused column and case 2 on no refusal. Case 5 **passes today**, through
  the `omit` (`checkedRows`, `packages/provisioning/src/configuration-transfer.ts:555-557`, refuses
  an omitted column with the same code and field; the plan review's probe E3 ran it green on main);
  once the `omit` goes, it is the server-level proof that the new check refuses before writing.
- [ ] **Minimal implementation.** Remove `omit` and its comment; add the check to
  `validateCoreConfiguration`'s station loop.
- [ ] **GREEN.** Both files unfiltered, plus `apps/server/src/configuration-import.test.ts` and
  `packages/provisioning` (`pnpm --filter @waitron/provisioning exec vitest run`, its transfer
  files by name: `rg -l configuration packages/provisioning/src -g '*.test.ts'`); `pnpm --filter
  @waitron/db typecheck`. `@waitron/db` is mutation-tested: run
  `pnpm --filter @waitron/db mutation -- --mutate src/configuration-transfer.ts` only if the package
  script accepts a file list (read `packages/db/package.json` first); otherwise leave mutation to CI
  and say so in the commit body.
- [ ] **Mutation controls.** Accept `null` → case 2's `null` red. Accept any number → `2` and `-1`
  red. Put the `omit` back → case 3 red. With the `omit` removed, delete the new `waits_for_pass`
  check from `validateCoreConfiguration` → case 5 red (no refusal; the station row is written), and
  case 4 stays green.
- [ ] **Commit.** `A configuration copy carries each station's choice to wait for the pass and refuses a value other than 0 or 1 (A773-2 PR C)`.

## Task 3a1: one rule for what the pass's Fire allows, and the configured pairs on kitchen displays (about 50 calls)

**Files.** `apps/server/src/pass-release.ts`; create `apps/server/src/pass-coverage.ts` and
`pass-coverage.test.ts`.

**Interfaces.** D100–D102:
`export function passReleaseRefusal(device: { formFactor: FormFactor; capabilities: readonly string[] }): "prepare-orders" | "run-the-pass" | null`;
`export interface PassCoverageGap { stationId: string; stationName: string; zoneId: string | null; zoneName: string | null }`;
`export async function readPassCoverage(tx: Transaction, cfg: TradingContext): Promise<PassCoverageGap[]>`.
In this task the profile-zone half of D100 is not built yet (every profile here is a kitchen
display, whose list is every zone, finding 16).

Fixture (in the test file): `setupSplitExtrasVenue()` (stations Grill, Fryer, Kitchen, Bar; its own
two zones, written below as **T** = `venue.party.zoneId`, the "tables" zone, and **C** =
`venue.counter.zoneId`; finding 17). No other zone is created. Kitchen-display pass devices are
enrolled as `pass-release.test.ts`'s `device()` and `passOn()` do (`:129-157`, `formFactor: "kds"`,
`ALL_PASS` capabilities); waiting is set with `setStationsWaitForPass`. Expected lists are written
in D102's order (T and C in their `floor_zones` display order; read it once in the test rather than
assuming).

- [ ] **Failing tests** (`describe("A773 station policy: pass coverage", …)`):
  1. No station waits → `[]`, even with no pass device.
  2. Grill waits, no pass device → gaps Grill×T and Grill×C.
  3. An every-station every-zone pass → `[]`.
  4. A pass on Grill with zones [T] → only Grill×C. A pass on Bar only (every zone) → both gaps. A
     pass on Grill listing only T, then T deactivated (`floorZones.active = false`, as
     `pass-release.test.ts:363-365`) → its scope has no zone left; with C still active the answer is
     Grill×C only (T is no longer an active zone, so it is no pair).
  5. Hot and cold: Grill and Fryer wait; pass A on Grill every zone, pass B on Fryer zone [T] → only
     Fryer×C.
  6. The same every-zone screen as a `pass_monitor` → both gaps (a monitor does not cover).
  7. A profile without `run-the-pass`, and separately without `prepare-orders` (profiles built as
     `profiledPass`, `:556`) → both gaps.
  8. The pass device disabled (`devices.active = false`) → both gaps.
  9. The pass screen taken by a profile narrowing (`available: false`, as "refuses a pass screen a
     narrowing took", `pass-release.test.ts:641`) → both gaps.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/pass-coverage.test.ts`
  — first add `readPassCoverage` returning `[]` and `passReleaseRefusal` as the moved loop, so the
  file imports; then cases 2 and 4–9 fail on assertions.
- [ ] **Minimal implementation.** Move the loop into `passReleaseRefusal` and call it from
  `releasePassItems`. `readPassCoverage`: active waiting stations; active zones (D102's order);
  active devices joined to profiles (`deviceBindingColumns`, `deviceProfileJoin`); keep those whose
  refusal is null; `VENUE_SERVICE.readDevicesKitchenScreens(tx, cfg, ids)`; D101 (a)'s pairs; the
  `passSees` half of D100's covered test; sort per D102.
- [ ] **GREEN.** `src/pass-coverage.test.ts` and `src/pass-release.test.ts` unfiltered;
  `pnpm --filter @waitron/server typecheck`.
- [ ] **Mutation controls.** Drop the `available` check → case 9 red. Accept `pass_monitor` → case
  6 red. Drop the active-device filter → case 8 red. Drop the `prepare-orders` entry from
  `passReleaseRefusal` → case 7 and `pass-release.test.ts` "refuses a profile without the action,
  the flag, a person or the party's zone, writing nothing" red. Read inactive zones → case 4's
  deactivated-T half red.
- [ ] **Commit.** `The coverage read names each waiting station and zone no kitchen display's pass could fire, using the Fire's own checks (A773-2 PR C)`.

## Task 3a2: a till pass's own zones, in one read, and a venue with no zone (about 55 calls)

**Files.** `packages/venue-service/src/profile-access.ts` and `profile-access.test.ts` (node),
`packages/venue-service/src/service.ts` (seat entry) and `service.test.ts` (its seat-name pin,
Changed test checks), `packages/module/src/module.ts` (seat
signature); `apps/server/src/pass-coverage.ts`, `pass-coverage.test.ts`.

**Interfaces.** `readProfilesZones(tx: Transaction, profileIds: readonly string[]): Promise<Map<string, string[] | null>>`
(D100; no `cfg`); an unknown id is absent from the map.

- [ ] **Failing tests.**
  1. venue-service (node): "A773 station policy: readProfilesZones answers each profile as
     readProfileZones does" — a kitchen-display profile, a till profile with no department, a till
     profile with a department serving every zone, and a till profile with a zone list holding one
     zone that is then deactivated and one in a department that is then deactivated: for each, the
     map's value `toEqual`s `(await readProfileZones(tx, cfg, id)).allowedZoneIds`; the empty id
     list answers an empty map.
  2. server, case 10: a till pass built as `signedInTillPass` (`pass-release.test.ts:577-589`) with
     an every-station every-zone pass screen, its profile limited to T's own department with
     `allowedZoneIds: [T]` and starting zone T (`setProfileServiceAccess`, read T's department from
     `zone_service_policies`; the fixture puts C in the same department, so the test checks that
     and case 10 keeps C out by the zone list alone; see Revision 2) → only Grill×C.
  3. server, case 13, agreement with Fire: for case 10's device, a requested Grill dish on C (a
     counter order, `fireNewOrder`) is refused by `releasePassItems` with `service_zone.not_allowed`
     and one at the party's table on T (`placeGroups(…, { release: "fire" })`, as
     `pass-release.test.ts:330-336`) is released.
  4. server, case 12: Grill waits; both fixture zones deactivated → Grill×no zone with case 4's
     pass that listed only T; add an every-zone pass → `[]`.
- [ ] **RED.** `pnpm --filter @waitron/venue-service exec vitest run --project node src/profile-access.test.ts src/service.test.ts -t 'A773 station policy'`;
  `pnpm --filter @waitron/server exec vitest run src/pass-coverage.test.ts -t 'case 1[0-3]'` (title
  the server cases "case 10", "case 12", "case 13"). Cases 2 and 4 fail; case 3 is a pin of the
  Fire (green), whose control is below.
- [ ] **Minimal implementation.** `readProfilesZones` in two queries (D100); the seat entry;
  `readPassCoverage` reads it once for the kept profiles and applies the zone half of D100; the
  no-active-zone pairs of D101 (a).
- [ ] **GREEN.** The venue-service files and `src/pass-coverage.test.ts` unfiltered,
  `src/pass-release.test.ts`; typecheck server, venue-service and module; `pnpm exec vitest run
  scripts/module-seams.test.ts`.
- [ ] **Mutation controls.** Drop the profile-zone check in `readPassCoverage` → case 2 red (and
  case 3 then shows the warning disagreeing with the Fire). Make `readProfilesZones` answer `null`
  for a profile whose department is inactive → case 1 red. Skip D101 (a)'s no-zone rule → case 4
  red.
- [ ] **Commit.** `A till pass's own service zones bound what the coverage warning counts, read for every profile at once (A773-2 PR C)`.

## Task 3b: dishes already waiting for the pass (about 45 calls)

**Files.** `apps/server/src/pass-coverage.ts`, `pass-coverage.test.ts`.

Requests are made as `pass-release.test.ts:325-342` makes them: at the party's table (zone T) with
`placeGroups(tx, venue.cfg, venue.party.partyId, { operatorId: OPERATOR, groups: [{ lines: [dish(venue,
"burger")], release: "fire" }] })`, and a counter order (zone C) with `fireNewOrder`; a zone-less
counter order by deleting its `order_service_contexts` row (`:339-341`).

- [ ] **Failing tests** (same describe; title each with "dishes").
  1. Grill waits; a Grill dish is requested at the party's table; then Grill stops waiting → gap
     Grill×T remains while the dish waits, with no pass device (and no Grill×C: nothing waits there
     and Grill no longer waits).
  2. Same, with a pass on Grill in [C] only → Grill×T; a pass on Grill in [T] → `[]`.
  3. The pass releases the dish (`releasePassItems`) → the gap goes (released dishes are not pairs).
  4. A held Grill dish (`release: "hold"`) at a station that no longer waits → `[]`.
  5. A zone-less counter order's requested Grill dish → Grill×no zone with the pass on Grill in [T]
     and [C]; add an every-zone pass → `[]`.
  6. The dish served in full, or its order abandoned → `[]` (`liveKitchenDish`).
  7. A pair that is both configured and requested (Grill still waits, a dish requested at T) is
     listed once.
  (No case for a dish at a deactivated station: D101 (b), the product cannot reach it.)
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/pass-coverage.test.ts -t 'dishes'`;
  cases 1, 2 and 5 fail.
- [ ] **Minimal implementation.** Read live requested items (`liveKitchenDish()` and
  `requestedItem()`, joined as `scopedItems` joins, `pass-board.ts:176-195`), their orders' zones
  through `orderWatchZones`, the stations' and zones' names whatever `active`; merge with the
  configured pairs before the covered test.
- [ ] **GREEN.** `src/pass-coverage.test.ts` unfiltered; typecheck.
- [ ] **Mutation controls.** Drop `requestedItem()` (read every live dish) → case 4 red. Drop
  `liveKitchenDish()` → case 6 red. Read the zone as null always → case 2 red. Skip the
  de-duplication → case 7 red.
- [ ] **Commit.** `The coverage read also names each station and zone where dishes already wait for a pass that cannot fire them (A773-2 PR C)`.

## Task 4: the route and the dashboard's read (about 35 calls)

**Files.** `apps/server/src/management-api.ts`, `management-api.test.ts`;
`packages/venue-service/src/dashboard/routing-client.ts`, `routing-client.test.ts`, `live-queries.ts`.

- [ ] **Failing tests.**
  1. `management-api.test.ts` "A773 station policy: a manager reads the pass coverage": with Grill
     waiting (`setStationsWaitForPass`) and no pass device, GET `/stations/pass-coverage` → 200 and
     the gap list `toEqual` (whole objects).
  2. "A773 station policy: pass coverage is refused without venue.configure": `supervisorCookie`
     → 403 `authorization.not_permitted`; staff → 403; no cookie → 401
     `management_session.required`.
  3. `routing-client.test.ts` "A773 station policy: reads the pass coverage passively":
     `request.mock.calls` `toEqual([["/management-api/stations/pass-coverage", "GET", undefined, {
     passive: true }]])`, from both `api` and `api.background`.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts -t 'A773 station policy'`;
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/routing-client.test.ts -t 'A773 station policy'`.
- [ ] **Minimal implementation.** The route per D103; `readPassCoverage()` and the exported
  `PassCoverageGap` type on the client per D104 (declare the type in the client, not imported from
  the server); `QUERY_DEPENDENCIES["pass-coverage"]` per D104.
- [ ] **GREEN.** Both files unfiltered; `pnpm exec vitest run scripts/live-subscriptions.test.ts`;
  typecheck server and venue-service.
- [ ] **Mutation controls.** `withVenueAuth` → `withVenueReadAuth` → case 2's supervisor red. Drop
  `passive` → case 3 red. A made-up table name in the dependency list → the live-subscriptions guard
  red (proves the guard reads the new key).
- [ ] **Commit.** `Managers can read which waiting stations no pass screen covers (A773-2 PR C)`.

## Task 5: the editor's switch (about 55 calls)

**Files.** `packages/venue-service/src/dashboard/station-editor.ts`, `prep-stations-screen.ts`
(`#stationEditor` hands it over; `#saveStationEdit` unchanged), `routing-client.ts`
(`PrepStation.waitsForPass`, `updateStation`'s `Pick`), `strings.ts`; tests
`station-editor.test.ts`, `station-editor.save-state.test.ts`, `station-editor.unsaved.test.ts`,
`station-editor.a11y.test.ts`, `prep-stations-screen.test.ts`, `prep-stations-screen.unsaved.test.ts`;
fixtures per "Changed test checks".

- [ ] **Failing tests.**
  1. `station-editor.test.ts` "A773 station policy: opens on the station's pass waiting, after the
     printers": the switch's `label` ("Waits for the pass"), `checked` from the station, the hint
     text, and `nextElementSibling` of the hint is the Late flags fieldset; the switch follows the
     printers field (or its note).
  2. "A773 station policy: sends only a changed pass waiting, and nothing once put back": flip on →
     Save enabled; flip off → disabled; flip on, Save → `station-save` detail exactly
     `{ waitsForPass: true }`.
  3. "A773 station policy: reads the switch in Spanish": label and hint from `strings.ts`' `es`.
  4. `station-editor.save-state.test.ts` "A773 station policy: an unchanged pass waiting keeps Save
     quiet": opened with `waitsForPass: true`, Save disabled and secondary.
  5. `station-editor.unsaved.test.ts` "A773 station policy: a changed pass waiting asks before
     closing, and choosing back the opened one does not" (shaped as the held-printing case,
     `:294-310`).
  6. `station-editor.test.ts` "A773 station policy: a refusal naming waitsForPass keeps the draft
     and shows above the buttons": `refusal = { code: "management.request_invalid", params: { field:
     "waitsForPass" } }` → the switch stays as changed; the footer's message is set; nothing under a
     field.
  7. `prep-stations-screen.test.ts` "A773 station policy: hands the station's pass waiting to the
     editor and saves it": a station with `waitsForPass: true` opens checked; flipping it off and
     saving calls `updateStation("bar", { waitsForPass: false })` exactly once.
  8. `prep-stations-screen.unsaved.test.ts` "A773 station policy: a refreshed station list keeps a
     changed switch": open, flip, trigger the routing watch's refresh with the stored value
     unchanged → the switch keeps the change and Save stays enabled.
  9. `station-editor.a11y.test.ts`: a new state "waits for the pass" (switch on) in both themes,
     through the file's existing state loop.
  10. The changed count pin `station-editor.test.ts:993-995` (`4 : 3`, Changed test checks), whose
      alignment checks then hold the new switch and its line at 390 and 1280 px.
- [ ] **RED.** `memory_pressure | grep free`, then
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/station-editor.test.ts src/dashboard/station-editor.save-state.test.ts src/dashboard/station-editor.unsaved.test.ts src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.unsaved.test.ts -t 'A773 station policy'`.
- [ ] **Minimal implementation.** D105, with Owner answer 1's approved words; `prep.waits_for_pass`
  and `prep.waits_for_pass_hint` in both catalogue blocks.
- [ ] **GREEN.** The five files unfiltered, plus `station-editor.a11y.test.ts`; venue-service
  typecheck; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/english-only.test.ts`.
- [ ] **Mutation controls.** Drop the hint `<p class="note">` → case 1 and the count pin red. Drop `waitsForPass` from `equal` → case 2's "put back" red. Drop it
  from `sendable` → case 2's detail red. Seed the draft from `false` instead of the station → case
  1 and 7 red. Reset the draft on every `station` change → case 8 red.
- [ ] **Commit.** `The station editor switches a station's waiting for the pass on and off (A773-2 PR C)`.

## Task 6: the stations table's column (about 35 calls)

**Files.** `packages/venue-service/src/dashboard/station-table.ts`, `strings.ts` (none new if the
heading reuses `prep.waits_for_pass`); tests `station-table.test.ts`, `station-table.a11y.test.ts`,
`prep-stations-screen.test.ts`, `prep-stations-screen.a11y.test.ts`.

- [ ] **Failing tests.**
  1. `station-table.test.ts` "A773 station policy: shows whether each station waits for the pass":
     two stations, true and false; the cells (`data-test="waits-for-pass-<id>"`) read Yes and No; in
     Spanish Sí and No.
  2. The six heading pins (Changed test checks).
  3. `station-table.a11y.test.ts`: the existing states with one station waiting, both themes.
- [ ] **RED.** `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/station-table.test.ts -t 'A773 station policy'`.
- [ ] **Minimal implementation.** D106.
- [ ] **GREEN.** `station-table.test.ts`, `station-table.a11y.test.ts`, `prep-stations-screen.test.ts`,
  `prep-stations-screen.a11y.test.ts` unfiltered. Both phone-width cases must stay green unedited:
  "keeps the table inside %s %s %ipx" (`station-table.test.ts:112-132`) and "keeps the table with
  its read-outs inside %s %ipx" (`:165-…`, the likelier to overflow); if the column pushes the
  table past 390 px, fix the column (shorter cell, wrap), never the tests. `pnpm exec vitest run
  scripts/pinned-actions-column.test.ts`.
- [ ] **Mutation controls.** Read `!station.waitsForPass` → case 1 red. Put the column after
  Actions → the heading pins red.
- [ ] **Commit.** `The stations table shows which stations wait for the pass (A773-2 PR C)`.

## Task 7: the warning on the Prep stations page (about 60 calls; split after case 4 if it nears 90)

**Files.** `packages/venue-service/src/dashboard/prep-stations-screen.ts`, `strings.ts`; tests
`prep-stations-screen.test.ts`, `prep-stations-screen.a11y.test.ts`, the screen's test `api()`
stub gains `readPassCoverage: vi.fn().mockResolvedValue([])`.

- [ ] **Stubs first.** Add the coverage read answering `[]` to every stub "Changed test checks"
  lists under fixtures (Prep stations a11y, unsaved, the station-delete helper, and
  `apps/dashboard/src/dashboard-app.unsaved-changes.test.ts`'s path list).
- [ ] **Failing tests** (`describe("A773 station policy: the pass coverage warning", …)`).
  1. Gaps Grill×Terrace and Cold×Terrace and Grill×no zone → two lines, in that order: "Nothing
     fires dishes from Grill and Cold in Terrace: …" and the no-zone line; each line's "Devices" is
     an `<a href="/manage/devices">`; the section is above `wt-tabs` and shows on both tabs.
  2. `[]` → no `[data-test=pass-coverage]`.
  3. Spanish: both lines from the `es` block, stations joined with «y».
  4. A failed coverage read → the failure line in its place, `prep.load_error` not shown, the
     tables still drawn; the next successful read replaces it; a failing routing read does not
     clear it, nor does the routing read's recovery (D104; CLAUDE.md "remembers which one set it").
  5. After a successful station save the screen reads coverage again (`readPassCoverage` called once
     more after `updateStation` resolves).
  6. Refresh, checked against the readers, not against the constant. (a) `QUERY_DEPENDENCIES["pass-coverage"]`
     `toEqual`s a list written out in the test from D104's reader table, each table beside the
     reader that reads it in a comment. (b) With `LiveData`, a change of type `zone_service_policies`
     (`readProfilesZones`), one of type `device_kitchen_screen_removals` (`readDevicesKitchenScreens`)
     and one of type `devices` each re-read coverage once, through the passive client, while an open
     editor's changed switch stays changed. (c) A change of type `ticket_items` does not re-read it
     (D104's deliberate omission). (d) The watch's `refreshMs` is `60_000`.
  7. Without live data, the 60-second reload also re-reads coverage (fake timers, as the routing
     timer's existing case does).
  8. `prep-stations-screen.a11y.test.ts`: the warning shown, both themes.
- [ ] **RED.** `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen.test.ts -t 'pass coverage warning'`.
- [ ] **Minimal implementation.** D104 and D107, with Owner answer 2's approved words
  (`prep.pass_gap`, `prep.pass_gap_no_zone`, `prep.pass_gap_error`, both blocks).
- [ ] **GREEN.** `prep-stations-screen.test.ts`, `prep-stations-screen.a11y.test.ts`,
  `prep-stations-screen.unsaved.test.ts` unfiltered; `pnpm --filter @waitron/dashboard exec vitest
  run src/dashboard-app.unsaved-changes.test.ts src/dashboard-app.test.ts` (outside every other
  focused run; CI's scope decides whether they run there); venue-service and dashboard typecheck;
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/english-only.test.ts`.
- [ ] **Mutation controls.** Share the routing `QueryController` → case 4 red. Drop the re-read
  after save → case 5 red. Group by station instead of zone → case 1 red. Drop `departments` from
  the constant → case 6 (a) red.
- [ ] **Commit.** `The Prep stations page warns when no pass screen can fire a waiting station's dishes in a zone (A773-2 PR C)`.

## Task 8: the guide (about 35 calls)

**Files.** `apps/server/src/guide/en/kitchen-service.md`, `apps/server/src/guide/es/kitchen-service.md`.

- [ ] Read the code behind each sentence first (owner, 2026-11-03 ~16:55) and list each sentence
  with its `file:line` in the commit body: the switch (`station-editor.ts`), later requests only
  (`kitchen-release.ts` `requestStamps`), what a waiting station's dishes show (the station's Held
  "Waiting for the pass", the pass's To fire), what covers (`pass-coverage.ts`, D100), the warning
  (`prep-stations-screen.ts`), the copy (`configuration-transfer.ts`), and the two fixing steps of
  D110 (Device profiles: offers a pass screen, Runs the pass, a department's zones; Devices: the
  pass screen's stations and zones), each from the dashboard screen and server check that does it.
- [ ] Write D110's section in both languages with the shared id `{#station-waits}`; add the links
  from `#pass-screen` and `#request-cooking`; add the setting to `#service-lifetime`'s list. Keep
  every other sentence as it is.
- [ ] **GREEN.** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`;
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/guide-page-tokens.test.ts`.
- [ ] **Control.** Rename the Spanish id → `guide-content.test.ts` red; revert.
- [ ] **Commit.** `The kitchen guide says how a station waits for the pass and what the coverage warning means (A773-2 PR C)`.

## Task 9: LOOK (about 40 calls)

- [ ] `wa-wt demo waitron-feat-a773-2c-pass-coverage` (record each process id started; stop only
  those). In the dashboard, Prep stations: open Grill, check the switch and hint, switch it on, save;
  see the column read Yes and the warning name Grill's zones; in Devices give a device's pass screen
  Grill and every zone on a profile that Runs the pass; back on Prep stations the warning is gone
  (within a refresh). Take the same steps with a pass monitor only: the warning stays.
- [ ] Each of: the editor with the switch, the table, the warning with two lines — in light and
  dark, English and Spanish, at 390 px and 1280 px (measure `window.innerWidth`). Check focus order
  through the switch, wrapping of the warning at 390 px, and that the column does not push the table
  off screen.
- [ ] Screenshots in `~/waitron-campaign-c/a773-2c-shots/`, never in the repository; report in
  `~/waitron-campaign-c/a773-2c-look-report.md` (what was looked at, what was seen, anything fixed
  and its commit). A defect found is fixed in its own commit with a test that fails without it.

## Task 10: the whole branch, backlog and the PR (about 40 calls)

- [ ] Focused suites per package touched, each file named, each `Tests` count read:
  server `kitchen.test.ts`, `management-api.test.ts`, `station-order-migration.test.ts`,
  `pass-coverage.test.ts`, `pass-release.test.ts`, `pass-board.requested.test.ts`,
  `configuration-transfer.test.ts`, `configuration-import.test.ts`, `guide-content.test.ts`,
  `guide-pages.test.ts`; db `configuration-transfer.test.ts`; venue-service `--project browser`
  `station-editor*.test.ts`, `station-table*.test.ts`, `prep-stations-screen*.test.ts`,
  `routing-client.test.ts` (memory first); venue-service node `profile-access.test.ts`,
  `service.test.ts`; dashboard `dashboard-app.unsaved-changes.test.ts`, `dashboard-app.test.ts`.
- [ ] Guards: every file named in "Guard suites".
- [ ] Fiscal controls, unedited: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`;
  `git diff 2ea0d1bd76 -- packages/fiscal-verifactu` is empty.
- [ ] Re-run the consumer audit's `rg`; every hit is in its row.
- [ ] Backlog: rewrite `docs/backlog.md`'s A773-2 entry and `docs/backlog/till.md#a773-courses-groups-and-the-pass`
  to say PR C landed (a station can wait for the pass; the warning) and PR D is next; move the
  "Left for PR C" paragraph's done points out; keep D101's known limit as a short entry under the
  till area if review agrees it is worth tracking.
- [ ] Ledger `Status: done` for PR C's build, next step `/finish-branch` (FULL, two Codex angles).
- [ ] PR (through `/finish-branch` with the worktree path and this plan's path): title "A station
  can wait for the pass, and Prep stations warns when no pass screen can fire its dishes (A773-2 PR
  C; no venue reset)"; first line "No venue reset: no schema change". Body in plain English: from
  this PR a venue can switch waiting on, which makes reachable everything PR B built (list B2's and
  B3's "Changed behaviour" sections and B4's D89 dimming); the owner questions and their state.

## Self-review

- **Master Task 10 coverage.** Station type, input, patch, editor save → Tasks 1, 5; absent create
  false, explicit null refused → Task 1; `readPassCoverage` and its route and authority → Tasks 3a,
  3b, 4; hot/cold, zones, every versus none left, disabled device/profile/screen, monitor-only →
  Tasks 3a1 cases 4–9 and 3a2 cases 10–12; outstanding requests regardless of setting, null zone → Task 3b; saving uncovered
  settings succeeds with a warning → Task 5 case 7 saves with no coverage read involved, Task 7 shows
  the warning; column → Task 6; read-only state → a departure (the screen has no read-only mode); import and provisioning → Task 2, finding 2;
  live refresh without resetting a dirty draft → Task 5 case 8, Task 7 case 6; G → Task 8; LOOK →
  Task 9; A756 → D109.
- **Every "Left for PR C" point.** B4's: the switch (Task 5), removing D9's `omit` with the boolean
  validation (Task 2), the coverage warning (Tasks 3a–4, 7). B1's D9 → Task 2. B1's "PR C's
  station-editor words … are asked by those PRs" → Owner answers 1–2 (approved 2026-11-03 ~23:35). B3's "B4 must fix before PR
  C" was built by B4's D68 (`2026-11-02-a773-2b4-pass-screens.md:371-378`).
- **Commands run** (in this worktree at `2ea0d1bd76`): the `rg` of finding 1 and the consumer
  audit; `rg -n waitsForPass apps/till`; `git show 6037aa68ad -- packages/provisioning/src/configuration-transfer.ts | grep version`;
  `git log --oneline --grep="#2031" --grep="#2044"`; P1 (two `pnpm --filter @waitron/server exec
  vitest run …` runs, `Tests 2 failed | 807 passed (809)` and `1 failed | 456 passed (457)`) and P2
  (`Tests 1 passed (1)`), each reverted with `git checkout --`, `git status --short` clean after;
  memory 94% free before P1. Everything else is read, not run: every call estimate, the Fire's
  checks (finding 4), the readers' line numbers, and whether `station-table`'s phone-width case
  holds with a fifth column (Task 6 measures it).
- **What this plan does not know yet.** Whether A1301 S18 lands first (Task 0 rebases); the
  whether `@waitron/db`'s mutation script takes a file list (Task 2 reads it).

## Revision 1 (2026-11-03, plan review)

Answers the fresh-context review (`~/waitron-campaign-c/a773-2c-plan-review.md`: 0 Critical,
6 Important, 7 Minor). Each finding was checked against the code before applying it; none was
rejected.

- **I1.** Finding 9 corrected: a `.note` count pin (`station-editor.test.ts:993-995`) covers the
  gap D105 uses. Added to Changed test checks (`3 : 2` → `4 : 3`) and to Task 5 (case 10, a control).
- **I2.** Two more heading pins (`station-table.test.ts:148`, `:163`; six in all, finding 10, D106)
  in Changed test checks; Task 6 names both phone-width cases as must stay green unedited.
- **I3.** Findings 16–17 added. Task 3a/3b fixtures rebuilt on `setupSplitExtrasVenue`'s own two
  zones (T and C, no new zones); "zones `[]`" replaced by a listed zone then deactivated (the empty
  list is refused, `kitchen-screens.ts:520-531`); requests at the party's table through
  `placeGroups(…, { release: "fire" })` and counter orders through `fireNewOrder`.
- **I4.** D100 says the profile's zone list binds only a till or handheld pass with a department.
  Task 3a split into 3a1 (kitchen displays, cases 1–9) and 3a2 (cases 10, 12, 13 on a signed-in
  till pass limited to T's department, built as `signedInTillPass`/`serveElsewhere` build theirs).
- **I5.** `zone_service_policies` and `departments` added to D104's list, which is now a
  reader-by-reader table; Task 7 case 6 checks the constant against a list written from the readers
  and checks one change type per reader, plus `ticket_items` not refreshing.
- **I6.** Task 2's RED line corrected (case 5 passes today through the `omit`); a control added that
  reddens it once the `omit` is gone and the new check is deleted.
- **M1.** No read per profile: a batched `readProfilesZones` on the venue-service seat (no `cfg`),
  held equal to `readProfileZones` per profile (Task 3a2); the seat-name pin
  (`service.test.ts:22-…`) is a new Changed test check.
- **M2.** D110 and Task 8: the guide names both fixing steps, Device profiles and Devices; the
  approved warning keeps its one link.
- **M3.** D101 (b): a requested dish at a deactivated station is unreachable
  (`station-delete.ts:58-70`); Task 3b's case dropped.
- **M4.** The API and request stubs that need the coverage read are listed under fixtures; Task 7
  adds them first and runs the two `apps/dashboard` files.
- **M5.** "Read-only state" recorded as a departure: the screen has no read-only mode.
- **M6.** "Owner questions" became "Owner answers": the owner approved both tables as written
  (`questions.md:1829-1830`, 2026-11-03 ~23:35); no landing waits on words.
- **M7.** D99 says why refusing a JSON `true` is deliberately stricter than the sibling flags.

## Revision 2 (2026-11-04, Task 3a2 and 3b reviews)

- Task 3a2's case 10 premise was false for this fixture: `setupSplitExtrasVenue` puts the tables
  zone T and the counter zone C in one department, so case 10 relies on the till pass's zone list
  alone (`allowedZoneIds: [T]`), and its helper checks the shared department. Whether a profile's
  department bounds its zones is held by the venue-service `readProfilesZones` case instead.

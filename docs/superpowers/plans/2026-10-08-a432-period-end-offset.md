# A432: Period end offset implementation plan

## Decisions

1. Store `endOffsetMinutes` on each department period, default **0**, as a signed whole number
   of venue wall-clock minutes. Create defaults only when absent; PATCH omission preserves the
   saved value. Reject null, strings, fractions, non-finite numbers and values outside
   **−1439…1439**. This deliberately limits grace to less than one business day, so runtime
   needs only today's and yesterday's effective schedules.
2. For each placement `[start, end)`, sending newly persisted dishes is allowed in
   `[start, end + offset)`. New menu selections use `[start, min(end, end + offset))`.
   Cutoffs are exclusive. Lunch 12:00–14:00 with −15 stops selection and sending at 13:45;
   with +15 it stops selection at 14:00 and sending at 14:15. Grace applies equally to
   customer and staff menus. It does not change the department's opening hours or routing.
3. Validate every placement, including repeated placements of the same period. Require
   `end + offset > start`. For a positive offset require `end + offset < next.start`, where
   the next placement belongs to the **same department**, including across midnight/changeover.
   Reaching its start also prevents reaching its end. Zero remains valid for adjoining periods.
   Example: Lunch ends 14:00, Dinner starts 14:15: +14 passes, +15 fails. An unplaced period
   may save a valid scalar; placing it later must validate it. Never silently shorten an offset.
4. The next placement is found in the effective timetable: a dated override replaces the week,
   an empty override closes the department, and whole-venue closure suppresses that day's slots.
   Gaps and closed days allow **only the earlier occurrence's remaining grace**. Grace may cross
   civil midnight or the business changeover, including into a whole-venue closed day, but expires
   at its cutoff. No earlier occurrence means no grace. With the one-day limit, only the same day
   and following day can constrain a placement; a next period further away cannot be reached.
5. A menu shared by periods is selectable/sendable if **any eligible occurrence offering that
   menu** permits it. Membership is by the root menu's ID, not product ID or an included menu's
   ID: a Drinks item reached inside Lunch takes Lunch's root selling identity and prices. Another
   department never supplies eligibility. Keep all published offers for snapshots and repricing.
6. The server accepts fresh request lines during grace without claiming to verify when they were
   selected. `priceOrderLines` receives no trusted selection timestamp. Do not add timestamps,
   period IDs to stored order lines, or a client bypass flag. Till selection and all quantity
   increases use the selection window; **stored-line increases on the server also use that
   window**, not grace. Stored unchanged lines, decreases, removals, notes/options/extras edits,
   already saved drafts' existing submission behavior, payments and replay keep slice 1 behavior.
   Actual product availability, menu version and profile/zone checks still apply.
7. Use `rangeSpan`/`serviceMomentAt` and civil-date arithmetic, not host time or elapsed UTC
   minutes. Both readings of a repeated local minute get the same decision (a fall-back can
   revisit an eligible wall minute); a skipped cutoff is crossed at the first displayed minute
   after it. Keep the existing skipped **slot endpoint** refusal and end-at-changeover rule.
   An unreadable venue clock retains slice 1's all-menu fallback for both decisions.
8. Reject an offset edit with existing `menu_period.invalid`, `field: "endOffsetMinutes"`,
   plus `reason: "whole_minutes" | "range" | "placement"`; placement details carry
   `periodId`, `departmentId`, and weekday/date. Timetable edits reuse `menu_timetable.invalid`
   with the submitted slot/day field and `reason: "end_offset"`, naming the conflicting period.
   Calendar and clock edits name their own shown `date`, `closeWholeVenue`, `dayCutover` or
   `timeZone` field. Import maps refusals to `setup.request_invalid` and a table/column field.

> **Execution:** implement inline with `superpowers:executing-plans`; owner authorizes proceeding
> after this plan without another question. Read `superpowers:test-driven-development` before
> writing implementation or tests. This planner changes only this file, with no commit or servers.

**Goal:** configure last orders or bounded leftover sending without changing fiscal behavior.
**Architecture:** one additive period column; one browser-safe rules module shared by write/import
validation and service decisions; two menu eligibility flags carried through offers and polling.
**Stack:** existing TypeScript, Drizzle/SQLite, Hono, Lit and Vitest/Chromium; no new dependency.
**Spec:** [service times](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§§4, 5 (2026-10-08 owner update), 9.2; [slice 1](2026-10-07-a366-slice-1-service-periods.md)
decisions 1–5. A432 queue and owner answer read 2026-10-08. Inspected branch/main:
`685a6074b152eeb904a66cfac9f83e8f432196ab`.

## Constraints and inspected consumers

Use real `useVenueDb` fixtures, one caller-owned transaction, sequential statements, domain-code
assertions and rollback checks. Preserve behavioral assertions; list deliberate wire-shape changes
in commits/PR. Commit with `git commit -s`; no hook bypass, coverage exclusions or lowered bars
(98/98/98/95). No fiscal implementation, manager extensions, zone closure feature or migration
compatibility layer. PR first line: **venue reset needed**.

Read `CLAUDE.md`, developer data/UI/testing/writing/CI/workflow topics and design-system Forms
before execution. The actual gates traced here are `menu-timetable.ts:193` (resolver),
`operations.ts:820` (offers) and `:873` (poll state), `working-order.ts:404` (pricing) and `:4800`
(stored increases), and till `till-app.ts:903` (offer index), `:2948` (poll refresh). UI selection
also reaches `menu-filter.ts`, `widgets/card-grid.ts:327`, `widgets/menu-browser.ts:401`,
`widgets/product-pick.ts`, `widgets/tender-pay.ts`, `widgets/basket.ts:655`,
`screens/till-table-order-screen.ts:2726`, and `state/draft-sync.ts:26`. Trace their consumers
again before changing gates; these are inspection receipts, not executed verification.

## Review focus

- Same menu through different periods/root menus: Task 3 pins root identity and union behavior.
- Timetable or calendar changes invalidate an already saved offset: Task 2 pins rollback.
- Negative cutoff and grace expiry leave `open`, name and versions unchanged: Task 3 pins polling.
- Quantity controls and a picker already open at cutoff: Task 3 pins store and visible controls.
- Previous-day grace, unreadable clock and both DST occurrences: Tasks 2–3 pin explicit decisions.

## Task 1: Storage, scalar validation and period wire model

**Modify:** `packages/venue-service/src/schema/menus.ts`, `menu-timetable-types.ts`,
`menu-timetable.ts`, `routes.ts`, `configuration-transfer.ts`, `errors.ts`.
**Create:** `packages/venue-service/src/period-end-offset.ts`, `period-end-offset.test.ts`;
generated `packages/venue-service/drizzle/0034_period_end_offset.sql`,
`drizzle/meta/0034_snapshot.json`, and entry in `drizzle/meta/_journal.json`.
**Tests:** `packages/venue-service/src/menu-timetable.test.ts`, `menu-timetable-routes.test.ts`,
`configuration-transfer.test.ts`, `schema/schema-conformance.test.ts`.

- [ ] RED: assert created/model-read offset is 0, +14 and −15 round-trip, PATCH of name retains
  −15 and explicit 0 clears it. Malformed inputs above return the exact field/domain code with
  no changed rows; HTTP accepts the new key rather than `onlyKeys` refusing it. Run the named
  files; expect missing model/storage value and rejected valid offset to fail first.
- [ ] Add `count("end_offset_minutes").notNull().default(0)` using DB column vocabulary. Keep
  this generation additive, without a table rebuild or new CHECK; signed whole-minute/range
  checks live at writer and import boundaries, as other `count` inputs do. Generate with
  `pnpm --filter @waitron/venue-service db:generate --name period_end_offset` and inspect SQL.
  If numbering changed after rebase, regenerate from main; never edit shipped SQL/snapshots.
- [ ] Export `parseEndOffsetMinutes(value: unknown): number` from the rules module, with the
  scalar refusals of decision 8. Extend `menu_period.invalid` in `errors.ts` with
  `endOffsetMinutes`, optional `reason`, `periodId`, `departmentId`, `weekday` and `date`,
  retaining its existing fields. Add optional `MenuPeriodInput.endOffsetMinutes` and required
  numeric field on `OpeningHoursModel.departments[].periods[]`. Carry it through create/PATCH
  allowlists, `writeMenuPeriod`, `updateMenuPeriod`, `readOpeningHoursModel`; preserve omitted
  PATCH values, including zero. Provisioning/demo use the DB default; no fixture backfill.
- [ ] Import/export already enumerates `menu_periods` without omitting columns
  (`configuration-transfer.ts:567`). Validate the scalar at `menu_periods.end_offset_minutes`
  and extend parser-error mapping for `menu_period.invalid`. Pin omission separately from explicit null refusal. An absent imported column takes 0
  as a current-schema default, not an old-bundle conversion. Assert −15/+14 exports and imports
  under regenerated IDs in `apps/server/src/configuration-transfer.test.ts`.
- [ ] GREEN: rerun red files and server transfer roundtrip, then schema/upgrade guards below.
  An additive migration must pass upgrade without a new `RESETS` entry. Commit signed off.

## Task 2: Placement bounds on every configuration writer

**Modify:** `packages/venue-service/src/period-end-offset.ts`, `menu-timetable.ts`,
`menu-timetable-rules.ts`, `configuration-transfer.ts`, `hours.ts`, `service.ts`, `index.ts`,
`routes.ts`, `errors.ts`;
`packages/module/src/module.ts`; `apps/server/src/venue-details.ts`.
**Tests:** `period-end-offset.test.ts`, `menu-timetable.test.ts`, `menu-timetable-routes.test.ts`,
`configuration-transfer.test.ts`, `hours.test.ts` (all under venue-service `src/`);
`apps/server/src/venue-details.test.ts`, `configuration-transfer.test.ts`.

- [ ] RED: Lunch 12–14, next 14:15: +14 passes/+15 refuses; adjacent next at 14:00 permits 0
  and refuses +1; −119 passes/−120 refuses. A shorter second placement constrains the same
  period. Friday 21–03 and Saturday next range, Sunday/Monday wrap, department isolation,
  explicit closed day vs inherited week, whole-venue closure and unplaced periods get cases.
  Expect valid/invalid saves currently indistinguishable; assert exact field and unchanged tree.
- [ ] In the pure module expose `periodOrderCutoff(range, offset, cutover): number` (service-day
  minute, possibly >1440) and `findEndOffsetClash(days, offsets, cutover)` returning null or
  `{ periodId, dayIndex, slotIndex }`. `days` is ordered effective day arrays of `ServiceRange`;
  `offsets` is a read-only map by period ID. Flatten adjacent days with 1440-minute displacement
  and apply decision 3. Use the browser-safe `rangeSpan` value and type-only `ServiceRange` import.
- [ ] Load one department schedule snapshot in `menu-timetable.ts`. Validate cyclic week pairs
  and each stored special-date day with its predecessor/successor, including past dates; resolve
  whole-venue closure and missing/empty override exactly as the resolver does. No calendar
  enumeration: the scalar limit means adjacent pairs are sufficient. Period and week/date saves validate
  their proposed rows inside the caller-owned transaction before it commits;
  clear-override validates the restored week. Map a clash to the submitting field, even if an
  unchanged predecessor is the period with the conflicting offset.
- [ ] RED then wire calendar mutation checks: copy, move, delete, create/update closure, and
  reopening a date must reject a newly conflicting boundary. Add optional `afterChange` to
  `SpecialDateParticipant` and invoke it after save/delete inside the existing transaction;
  retain skipped-endpoint `beforeMove` and use existing `afterCopies` for batch copy checks.
  Pass participants through POST creation in `routes.ts`, which currently omits them; pin
  real POST rollback through a refusing participant. Use reopening, moving and deleting
  existing overrides to exercise offset conflicts directly.
  Extend `menu_timetable.invalid` with `end_offset` and `periodId` in `errors.ts`.
  `MENU_TIMETABLE_CALENDAR_PARTICIPANT` runs the same snapshot validator. Assert rollback of
  date rows and child rows, with error mapped to `hours.invalid` and the submitted calendar field.
- [ ] Expose `assertPeriodEndOffsets(tx, cfg): Promise<void>` through the venue-service
  contribution and index. After a permitted clock update in `writeVenueDetails`, run it in the
  same transaction through `VENUE_SERVICE` from `apps/server/src/modules.ts`; translate a clash
  to existing `venue.detail_invalid` on the changed clock field. Preserve history locks. Import
  uses its exported cutover and reconstructed effective schedules, translating clashes to
  `setup.request_invalid`, field `menu_slots`. Tests include a changed cutover that reverses a
  formerly valid range/bound and an invalid imported next-day boundary.
- [ ] Run each named test file with its package command; watch each new group fail before its
  implementation and pass afterward. Commit signed off.

## Task 3: Service decisions, server acceptance, wire and till

**Modify:** venue-service `src/menu-timetable-types.ts`, `menu-timetable.ts`, `operations.ts`;
`packages/module/src/module.ts`, `packages/catalogue/src/menu-document-types.ts`;
`apps/server/src/working-order.ts`, `till-api.ts`; till `src/till-app.ts`, `menu-filter.ts`,
`state/working-order.ts`, `state/menu-refresh.ts`, `widgets/basket.ts`, `widgets/card-grid.ts`,
`widgets/menu-browser.ts`, `widgets/basket-refresh-dialog.ts`, `screens/till-counter-screen.ts`, `screens/till-table-order-screen.ts`,
`i18n/strings.ts`. `api/client.ts` aliases the shared wire types; keep that seam.
**Tests:** venue-service `src/service-day.test.ts`, `period-end-offset.test.ts`,
`menu-timetable.test.ts`; server `src/till-api.service-periods.test.ts`, `working-order.test.ts`;
till `src/till-app-menu-timetable.test.ts`, `state/working-order.test.ts`,
`state/draft-sync.test.ts`, `menu-filter.test.ts`, `widgets/basket.test.ts`,
`widgets/basket-refresh-dialog.test.ts`.

- [ ] RED: pin selection/send sets immediately before/at −15, 0 and +15 cutoffs, before a
  future period, in a gap, and yesterday's grace just after changeover on a closed day (then
  expired). Shared customer/staff menus union eligibility; a product under a different root
  menu does not. Pin both repeated 02:20 occurrences with a 02:30 cutoff and a spring jump
  across a skipped cutoff using `localTimeOccurrences`/existing clock-change fixtures; preserve
  unreadable-clock fallback. Expect the resolver's single set to fail grace assertions.
- [ ] Keep `orderableMenuIds` meaning **selection**; add `sendableMenuIds: readonly string[]`
  to `DepartmentService` and the contribution's resolver return. Calculate occurrence windows
  for effective today/yesterday; never use unbounded `endedMenuIds` as permission. Preserve
  `endedMenuIds`' diagnostic meaning and `open`/`periodName` as actual period state.
- [ ] Add required `sendable: boolean` alongside `orderable` to shared `ZoneMenu`/`ServedMenu`.
  Add both flags to each `ZoneMenuState`/`MenuState.menus[]` entry. `listZoneOffers` uses the
  two sets; defaults and switchers use selection only. Its `withDefault: false` pricing snapshot
  retains all menus and never bypasses the separate server service check.
- [ ] RED server cases: grace permits a fresh line/new round/unsaved counter basket and rejects
  at expiry with `menu_period.not_running`; negative cutoff refuses all new dishes. Retain zero
  daily/closed/future cases and stored edit/payment/replay assertions. A stored quantity increase
  during grace must refuse while a fresh line succeeds. Mark increases in the internal pricing
  request with a private symbol `REQUIRES_PERIOD_SELECTION`; `priceOrderLines` checks them
  against selection, other added dishes against sending, retaining `ADDED_EXTRAS_ONLY` and
  `periodCheck: "none"` exemptions. No client-controlled symbol or wire bypass.
- [ ] RED till cases: unchanged versions/name/open with changed eligibility must update offers
  on the existing 15-second poll, for counter and table. Compare both per-menu flags in
  `#onMenuState`; retain ordering/stale-read guards. A grace basket stays sendable with no menu
  selectable; expired unsaved dishes stay visible but block send/pay with a localized period
  marker. Add `period_ended` to `BlockReason` and its basket/i18n mapping, including the
  exhaustive `Record<BlockReason, StringKey>` in `basket-refresh-dialog.ts`; pin the marker
  after menu refresh and the unchanged saved-line exemption; never mark unchanged
  saved lines solely for period expiry. Preserve product/version blocking alongside it.
- [ ] Gate **every** addition/increase at the store: add
  `canSelectProduct: ((product: TillProduct) => boolean) | undefined`, supplied from the
  app's current zone/menu flags for counter, table drafts and editable rounds. Check it in
  `addProduct`, `addMerging` and only increases in `setLineQuantity`; absent callback retains
  isolated store behavior. Add a discriminated period refusal to `BasketRefusal` and update its
  consumers (counter's current handler assumes an invoice-limit refusal). Disable visible plus
  controls using the same predicate; keep decrease/remove usable. Test open pickers and
  programmatic calls so hidden controls are not the only guard. Hide the product browser when
  no selectable menu exists even if `service.open` remains true; filter cross-menu search by
  root eligibility. Show EN/ES “Last orders have ended” in this negative-cutoff state.
- [ ] Run the named focused suites, including real server routes and counter/table browser
  interactions; add required keys to fixture/full-body pins rather than weakening assertions.
  Commit signed off. No direct fiscal path edits.

## Task 4: Periods editor and form contract

**Modify:** `packages/venue-service/src/dashboard/period-editor.ts`, `strings.ts`,
`opening-hours-screen.ts`, `opening-hours-week.ts`, `opening-hours-day.ts`.
**Tests:** the matching `period-editor.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`,
`opening-hours-screen.test.ts`, `opening-hours-client.test.ts`, `opening-hours-week.test.ts`,
`opening-hours-day.test.ts` in that dashboard directory.

- [x] RED: native input starts at 0/new or saved signed value/edit; changing only offset makes
  Save active and sends a JSON number; restoring the saved value makes Save quiet/disabled.
  Fraction, empty and out-of-range text gets field/bottom errors after attempted save, preserves
  input and blocks action until fixed. Request refusal on `endOffsetMinutes` marks the field
  and bottom while leaving retry enabled. Unchanged programmatic submission emits nothing.
- [x] Add `wt-input name="endOffsetMinutes"`, labelled EN “Period end offset (minutes)” /
  ES “Desfase del final del periodo (minutos)”, required, with a signed-integer text input.
  Keep draft text separate from parsed numeric input so invalid text survives. Accept a leading
  + or − sign and whole decimal digits only; normalize equivalent integer spellings for dirty
  comparison. Empty is invalid, never converted with `Number("")`. Add an always visible short
  EN/ES explanation: “Negative: stop new dishes before the end. Positive: send leftovers after
  the end. 0: use the period end.” Use existing token styles; no new primitive/help button.
- [x] Include offset in draft snapshot/equality/restore/submitted-generation commit and field
  refusal mapping. Close after successful write; a failed refresh remains a load failure. Carry
  the value through all three embedded editors and show a signed minutes column in Periods.
  Timetable `end_offset` refusals show the affected day/department and localized wording about
  changing the period's offset; retain Week/Day drafts and existing server-refusal retry rules.
- [x] Pin offset-only Stay/Discard/navigation/reopen behavior in the unsaved suite; run axe on
  normal and invalid/refused forms in both themes, using native control values/accessibility.
  Check Enter submission and restore language after each case. Run focused files and commit.

## Task 5: Guards, visual evidence, documentation and full finish

- [ ] After storage/migration work, run these exact guards, checking exit statuses and test counts:

  ```sh
  pnpm exec vitest run scripts/schema-constraints.test.ts scripts/column-vocabulary.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/module-seams.test.ts
  pnpm --filter @waitron/venue-service exec vitest run src/schema/schema-conformance.test.ts src/migrations.test.ts
  pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/sale-amount.huella.test.ts src/inmutabilidad.test.ts
  ```

  Use `pnpm --filter @waitron/<package> exec vitest run <src/files>` for each task's focused
  files. No whole-workspace local test/coverage run solely for finish. Run browser suites only
  after checking other runs and `memory_pressure`; keep separate report paths for concurrent
  coverage. No guard/fiscal assertion changes except required new wire fields in contract pins.
- [ ] LOOK once at the completed Periods form/list (0, negative, positive, invalid/server refusal),
  and counter/table selection/grace/expiry states: EN/ES, light/dark, **1280 and 390** wide.
  Extend `period-editor.a11y.test.ts` and till `screens/service-periods.a11y.test.ts` screenshot
  matrices; inspect saved images and native controls, not just passing axe/string tests. If an
  app integration look needs a stack, use only `wa-wt demo waitron-feat-period-end-offset`.
  Retain screenshot paths and test counts for the owner; stop only recorded PIDs you started.
- [ ] Update `docs/developers/conventions-data.md` with measured selection/send/import receipts
  and A432 decisions; audit current prose across the whole base-to-tip path set. Preserve the
  service spec's historical account with a dated pointer. Delete a completed A432 backlog entry
  if present in `docs/backlog.md`, retaining A366 slices and recording any actual remaining work.
- [ ] Announce ready for `finish-branch`, then execute the **full code-branch** finish workflow
  inline: clean signed-off commits, initial fetch/rebase, complete candidate in a disposable
  checkout with its own frozen dependency install, **one Claude run-it whole-branch review** via
  `~/workspace/tools/claude-seat.sh review-run`. Supply this plan and literal captured merge-base;
  ask for experiments on bounds, saved increases, polling and closed-day grace. Read completed
  findings, triage with evidence, fix accepted issues test-first, and retain review/usage receipts.
- [ ] Push through the normal hook, create/update PR with first line **venue reset needed**,
  decisions, deliberate changed checks and validation receipts. Verify CI's changed-package scope
  selects venue-service, module, catalogue, server and till plus their affected dependents. Watch
  required CI and licence checks on the **current head SHA**; inspect every job's conclusion,
  including package coverage, rather than trusting the summary alone. Diagnose real failures,
  rerun focused checks after fixes, commit/push normally and wait for that new head. Keep prior
  review approval across a later rebase; do not repeat it solely because main advanced.
- [ ] End this plan's implementation at a reviewed PR with green current-head CI. Report PR,
  head SHA, decisions, screenshots and remaining limits. Landing is a separate campaign runner
  action under its existing authority/lock procedure; this plan supplies no new merge approval.

## Planner self-review

Checked against A432, the owner update and landed slice 1: tasks cover storage/default/PATCH,
scalar and placement refusal, all timetable/calendar/clock/import writers, shared roots, overnight
and closed-day grace, saved increases/decreases, separate wire decisions, unchanged-version poll
refresh, store/picker bypasses, editor/i18n/draft/a11y/visual evidence, migration guards and full
finish/current-head CI. Proposed names and meanings are consistent across tasks. No code/tests
were written or run in planning; execution must obtain the RED/GREEN and guard receipts above.

# Device profile access and switching — implementation plan

> **For agentic workers:** implement this plan task by task with failing behavioural tests first. Claude drives with subagent-driven development; /finish-branch runs two Codex run-it reviews (risk-trigger branch).

**Goal:** Let a device use only its approved profiles, with profile-controlled department and zone access, staff admission, actions, screens, and kitchen display bindings.

**Architecture:** Keep the active profile on `devices` and store its approved alternatives separately. Keep cross-module department and zone rules in `@waitron/venue-service`; do not make `@waitron/layouts` depend on that module. Resolve a request's device, person, active profile, and service scope at the server boundary, then check each operation there. The till displays the same resolved choices but is never the authority for access.

**Tech Stack:** TypeScript, Drizzle/SQLite, Hono, Lit, Vitest database and browser projects.

**Spec:** [Devices, menus and service zones](../specs/2026-10-04-devices-menus-and-service-zones-design.md), chiefly §§2, 4, 6, 8–10. The owner approved this written spec on 2026-10-04. Section 9's proposed details are included in that approval.

**Amended 2026-10-06** for main `c3339ed99` after a fresh-context review (`.superpowers/sdd/2026-10-04-device-profile-access-and-switching/plan-review.md`) and the coordinator's rulings on it. Paths and line numbers below were read at that commit; re-read them before editing.

## Global constraints

- This is the **profile access and device switching** slice from spec §8. Department menu membership and scheduling, forward-only publication, portable equipment possession and independent drawers, and transfers each need their own plan and branch. Keep the current printer selection behavior until the equipment branch replaces it.
- Every ordering profile has one department, an allowed set of that department's zones or **all** of them, and a valid starting zone — subject to the owner question below about a profile with no department yet. A kitchen station or watcher profile may receive work from several departments; its station or watcher determines that scope.
- A profile's department is validated against the request's location (`cfg.locationId`). Profiles themselves carry no location (`packages/db/src/schema/device-profiles.ts:22`); departments and zones do.
- A person's permission and the active profile must both allow an action. Screen visibility is separate. Shared displays can prepare or watch only as configured; they cannot order, pay, or open a drawer without a named login.
- **No new person permissions in this slice.** An action that has no person permission today needs only a signed-in active person; actions that already have one (`sale.take_payment`, `cash.drawer`, and the rest in `packages/identity/src/permissions.ts:5`) still require it. A later slice may add ids.
- **Admission default:** a profile with no admission rows admits every active person (its role set defaults to all roles). This keeps every existing login fixture valid.
- A device switch requires both management approval of that profile for the device and the current person's admission to that profile. The active profile counts as approved implicitly; only alternatives are stored. Refuse switching during an active payment or an unresolved local draft. Recheck admission on every new login and switch.
- A zone change chooses that zone's current default menu. A screen change and the same person's return to the same device and zone retain a manual menu choice. Another person's login starts at the profile's starting zone and its current default. Browsing state is held in memory, so a page reload starts again from the profile's starting zone and default (the reload assertion at `apps/till/src/till-app.test.ts:10583-10586` stays). The menu timetable branch will implement the later time-bound default changes.
- **A starting zone that is no longer usable** (deactivated, moved out of the department, or its department disabled) does not block deactivation. At login or switch the device falls back to the first active allowed zone by position; with none left the profile cannot order, and the server refuses with a domain error.
- **Keep the name `capabilities`** for the stored column and the wire field. Split it into typed action and screen subsets in `@waitron/layouts`; add only new flags. Login mode is derived from the form factor in this slice (`kds` = shared display). `startingScreen` is a plain nullable column validated in the store.
- **No `device_profiles` or `devices` table rebuild.** No new CHECK constraint on either table: a CHECK makes drizzle-kit rebuild the table, which drops the `device_profile_form_factor_locked` trigger and the station/watcher triggers (`packages/db/drizzle/0091_devices_recreate_triggers.sql`), cascade-deletes `device_profile_printers` rows and is refused by the `devices` RESTRICT key. Validate new values in the store, as `devices.battery_level` does (`packages/db/src/schema/devices.ts`, comment above the column). Read the generated SQL of every migration for `__new_` tables before committing.
- **New foreign keys into `device_profiles` are `ON DELETE CASCADE`.** `packages/layouts/src/device-profile-store.db.test.ts:785` pins the keys into and out of `device_profiles`; it gains rows under the owner's whole-shape rule, named in the PR.
- **The server reaches venue-service only through `VenueServiceContribution`** (`packages/module/src/module.ts`, interface around `:415`; selected at `apps/server/src/modules.ts:16`). Every venue-service function the server calls in this plan is added to that interface, to the contribution object in `packages/venue-service/src/service.ts`, and to the function list pinned in `packages/venue-service/src/service.test.ts:15-40`. This is a cross-package contract change. Do not grow the allowlist in `scripts/module-seams.test.ts`.
- **Every new table** gets, in its own task: a classification entry (all are `state`, like `devices` and `device_profiles`, so no key crosses table classes); an export/import decision (profile-owned tables travel with profiles; per-device approvals stay behind, as `device_zone_defaults` does today — `packages/venue-service/src/service.test.ts:43`); a place in `apps/server/src/testing/clear-provision-fixture.ts` before every parent it references; and a live-subscription entry wherever a dashboard screen shows it (`scripts/live-subscriptions.test.ts`). A new core table needs its reason stated in the commit message.
- A changed form follows [Forms](../../developers/design-system.md): field-level and bottom validation, semantic names, shared primitives, English and Spanish copy. Inspect light and dark themes and phone width.
- Follow [data](../../developers/conventions-data.md), [UI](../../developers/conventions-ui.md), [testing](../../developers/testing-guide.md), [CI](../../developers/ci-and-gates.md), and [workflow](../../developers/workflow-guide.md) before their respective tasks. Do not edit a shipped migration. Use a pre-production reset when schema changes require it.
- Existing error codes are reused: `device.forbidden_action` and `device.cash_not_allowed` (`apps/server/src/errors.ts:710-714`). CLAUDE.md §5 names `open-cash-drawer`, `take-cash` and `assertTakesCash`; none of them is renamed.

### Owner question

- **Owner question (pending):** a profile with no department. **B (recommended):** the department is nullable; no department means no department restriction, and the device starts at the counter default zone, until a manager sets one. **A:** a department is required on every ordering profile (every existing profile POST/PUT fixture without one would then be refused). Build B's shape until answered; A is a validation change on top of it.

### Owner exceptions requested

Each existing assertion below must be edited or deleted by this plan. **Every item is pending owner answer — do not edit until answered.**

1. **Task 7b deletions** — the tests and assertions that exist only for the per-device default zone, listed in Task 7b (groups a and b).
2. **`apps/till/src/till-app.test.ts:10590`, the `p1` row** of `it.each(["p1", "p2"])("resets the menu after logout and a new login as %s")`. `toCounter` signs in as `p1` (`:608`), so that row asserts the same person's re-login resets the menu, which spec §2's owner clarification reverses. The `p2` row stays.
3. **`apps/server/src/till-api.test.ts:1862`** "prefers the session's device's default service zone, whatever device cookie the request carries" — becomes the profile's starting zone; the "session's device wins over the cookie" half stays.
4. **Moving `packages/venue-service/src/dashboard/venue-operations-screen.test.ts:3525`** ("leaves focus on a till's starting zone after it is changed…") onto a control that survives Task 7b, keeping its focus assertion.
5. **Task 5 seed pins** — the seeded profiles' capability lists in `packages/provisioning/src/venue-plan.test.ts:87-107`, `packages/provisioning/src/venue-apply.test.ts:320-352`, `apps/server/scripts/dev-setup.test.ts:304-324` and `packages/layouts/src/device-profile.test.ts:125-127`, wherever a new flag is added to a seeded profile.

## Existing behavior and the two plan conflicts

At `main` `c3339ed99`:

- `devices.device_profile_id` is the one active profile (`packages/db/src/schema/devices.ts`). `device_profiles` has form factor, canvas, a `capabilities` JSON list, timeout and `retired_at` (`packages/db/src/schema/device-profiles.ts`).
- The manager's device edit is `PATCH /management-api/devices/:id` (`apps/server/src/device-api.ts:515`). It writes name, profile, station, watcher, printers and made-here stations through `resolveDeviceBinding` and `updateDeviceSettings` (`apps/server/src/device.ts:103` and `:63`).
- Profile routes are in `apps/server/src/management-api.ts`: GET `:1245` and `:1259`, POST `:1275`, PUT `:1325`, DELETE `:1376`. `capabilities` is a required body key (`:1293`, `:1344`).
- The server's capability gate is `assertDeviceCapability` (`apps/server/src/device-session.ts:362`), and the cash gate is `assertTakesCash` (`:377`). A request with no device passes both.
- A till session's device binding, profile capabilities included, is re-read on every request (`requireSession`, `apps/server/src/till-session.ts:72`).
- The per-device default zone is `device_zone_defaults` (`packages/venue-service/src/schema/service.ts:207`). It feeds `resolveNewOrderZone` (`packages/venue-service/src/operations.ts:890`), which serves `GET /api/default-service-zone/offers` (`apps/server/src/till-api.ts:1241`) and `GET /api/menu-state` (`:1290`).
- Station-or-watcher exclusion is in `resolveDeviceBinding` (`apps/server/src/device.ts:129-146`) and in the core triggers `device_binding_rule_insert`/`_update` (`packages/db/drizzle/0091_devices_recreate_triggers.sql`).

These are starting points, not proof that they are the only consumers: trace each before changing its meaning.

The [A261 step 2 plan](2026-10-04-departments-and-zones.md) was written before this spec. Its Task 7 places the starting zone on a device, and Task 8 preserves zone-by-zone menu availability. The approved spec places the starting zone on the **profile** and available menus on the **department**. At 17:10 on 2026-10-04 the owner chose an interim A261 build: omit Task 8 and the device-level starting-zone move, while keeping today's zone-menu and device-default-zone controls available in a small section of the new screen (`~/waitron-campaign-d/questions.md`, owner answer). That control shipped as `#deviceStartingZones` in `packages/venue-service/src/dashboard/venue-operations-screen.ts:1372`. This profile branch replaces it (Task 7b). The department-menu branch replaces zone-by-zone menus; until then "offered to Restaurant" in this plan means offered through a Restaurant zone's `zone_menus`.

## File map and interfaces

| Unit | Responsibility |
| --- | --- |
| `packages/db/src/schema/device-profiles.ts`, `devices.ts`, new approval schema, new core migrations | Profile-owned starting screen and device-approved alternatives; active profile stays on the device |
| `packages/venue-service/src/schema/service.ts`, new venue-service migration, new `profile-access.ts`, `service.ts` | Department, allowed zones, starting zone, and station/watcher lists, validated against live venue rows |
| `packages/module/src/module.ts` (`VenueServiceContribution`), `packages/venue-service/src/service.test.ts` | The contract through which the server calls the new venue-service functions |
| `packages/identity/src/profile-admission.ts`, identity schema/migration | Role and individual admission rules, evaluated against the real person's current role and status |
| `packages/layouts/src/canvas.ts`, `device-profile.ts`, `device-profile-store.ts` | Typed action and screen subsets of `capabilities`; existing form factor, canvas, timeout and printer fields |
| `apps/server/src/device-session.ts`, `till-session.ts`, `device-api.ts`, `till-api.ts`, `orders-api.ts`, `bill-payments-api.ts`, `receipt-print.ts` | Resolve one active profile per request and refuse disallowed operations at their actual write boundaries |
| `apps/dashboard/src/screens/device-profiles-screen.ts`, `devices-screen.ts`, `apps/till/src/till-app.ts`, lock and station screens | Configure profiles and approved devices; show only available screens and choices |

Expose a server-side `ProfileAccess` value with `profileId`, `departmentId`, `allowedZoneIds`, `startingZoneId`, `actions`, `screens`, `stationIds`, and `watcherIds`. `allowedZoneIds: null` means **all active zones in the department**, not all venue zones; reject an empty explicit set on an ordering profile because it cannot contain a starting zone. For a shared display, `departmentId` and `startingZoneId` are null. Under the owner question's option B, a profile with no department also has null `departmentId`, means no department restriction, and starts at the counter default zone. Resolve these against current rows rather than trusting a stale client snapshot. The implementation may split this value into narrower functions where a caller needs less data, but keep those field meanings consistent.

## Review focus

Each case below belongs in the owning task's failing test, not only in this list.

1. A zone moved to another department or deactivated after profile setup must cease to be orderable; a saved profile choice must not grant cross-department access (Tasks 1 and 4).
2. A person's role/status or individual exception changed while the device stays enrolled must affect the next login and profile switch (Tasks 2 and 3).
3. A profile approval removed while an old client still offers it must be refused by the server; the active profile must remain approved (Task 3).
4. A hidden screen's route must still check its action, and a visible read-only screen must not inherit write access (Task 5).
5. A station receives work from two ordering departments while the kitchen device cannot browse either department's unrelated orders (Task 6).

---

### Task 1: Store and validate profile service scope

**Files:** `packages/venue-service/src/schema/service.ts`, `packages/venue-service/src/profile-access.ts` (new), `packages/venue-service/src/profile-access.test.ts` (new), the next venue-service migration (after `0020`) and journal, `packages/venue-service/src/index.ts`, `packages/venue-service/src/service.ts` and `service.test.ts`, `packages/module/src/module.ts`, `packages/venue-service/src/classification.ts`, `packages/venue-service/src/configuration-transfer.ts`, `packages/venue-service/src/migrations.test.ts`, `packages/venue-service/src/schema/service.test.ts`, `scripts/schema-constraints.test.ts`, `apps/server/src/testing/clear-provision-fixture.ts`.

**Interface:** `readProfileServiceAccess(tx, cfg, profileId): Promise<{ departmentId: string | null; allowedZoneIds: string[] | null; startingZoneId: string | null; stationIds: string[]; watcherIds: string[] }>` and `setProfileServiceAccess(tx, cfg, profileId, input): Promise<void>`. Add `readProfileServiceAccess` to `VenueServiceContribution` and the pinned list in `service.test.ts`. The display case has null department/start zone; an ordering profile with a department requires a start zone. Validate each foreign id against `cfg.locationId`, the active department, and its zones inside the same transaction as the write.

- [ ] Write database tests with Restaurant and Deli departments, two Restaurant zones and one Deli zone. A Restaurant profile accepts its own start zone, refuses the Deli zone as an allowed or start zone, refuses a start zone outside its explicit subset, and refuses an empty explicit subset. A department at another location is refused. Verify a null allowed-zone list expands only to active Restaurant zones at read time. Deactivate or move an allowed zone and verify it cannot be used for a new order. Deactivate the starting zone and verify the read falls back to the first active allowed zone by position, and that with none left the read says the profile cannot order.
- [ ] Run `pnpm --filter @waitron/venue-service test -- src/profile-access.test.ts`; see assertions fail because the access store/resolver is absent, not because setup or migration failed.
- [ ] Add the schema and generated migration in the venue-service set, the resolver and validation. Keys into `device_profiles` are `ON DELETE CASCADE`. Do not change the existing `zone_menus` write path or `device_zone_defaults` in this task. The new tables: classify as `state`; add to the venue-service configuration transfer (they travel with profiles), with each id column a declared foreign key (`scripts/id-columns-are-references.test.ts`); add to `clear-provision-fixture.ts` before `departments`, `floor_zones` and `device_profiles`. The `migrations.test.ts` table list, `schema/service.test.ts` and `scripts/schema-constraints.test.ts` gain entries for the new tables only.
- [ ] Run the focused suite and the migration guards named in `docs/developers/conventions-data.md`. Read the generated SQL, especially any rebuilt table and inbound keys. Commit with `git commit -s`.

### Task 2: Admit people by role and individual exception

**Files:** `packages/identity/src/profile-admission.ts` (new), identity schema/migration (after `0006`) and tests, `packages/identity/src/classification.ts`, `packages/identity/src/configuration-transfer.ts`, `packages/identity/src/index.ts`, `apps/server/src/till-api.ts`, `apps/server/src/till-api.test.ts`, `apps/server/src/testing/clear-provision-fixture.ts`, `packages/layouts/src/device-profile-store.db.test.ts`. The login-person list is `GET /api/staff` (`apps/server/src/till-api.ts:1069`); PIN login is `POST /api/session` (`:994`).

**Interface:** `canUseDeviceProfile(tx, profileId, personId): Promise<boolean>`. Store an allowed role set and per-person allow/deny exceptions; deny wins for that person, then allow, then role set. **No admission rows means every role is admitted.** Inactive, suspended or missing people are never admitted. Keep the public login refusal generic (`pin.invalid`) and make the names shown at login use the same admission rule.

- [ ] Write a failing identity suite for each role, explicit allow, explicit deny, changed role, inactive person, deleted exception, and a profile with no rows admitting every active person. Write route tests showing only eligible names on the device's login screen and the same generic refusal for an ineligible correct PIN and a bad PIN. Include a named eligible person as the negative control for an over-wide refusal.
- [ ] `GET /api/staff` filters by admission **only when the request identifies a device** (device cookie, or the dev header in dev mode, via `tryReadDevice`). Without one it returns today's list, so `till-api.test.ts:1185` stays as it is.
- [ ] Run `pnpm --filter @waitron/identity test -- src/profile-admission.test.ts` and the focused server login suite; confirm the new assertions fail for admission behavior.
- [ ] Add the identity-owned tables and evaluator. Keys into `device_profiles` are `ON DELETE CASCADE`; `device-profile-store.db.test.ts:785` gains their rows (whole-shape rule, named in the PR). Classify as `state`. Admission rules travel with profiles in the configuration transfer only if the person rows they name travel too (`persons` is in identity's transfer list); otherwise leave them behind and say why in the commit. Add them to `clear-provision-fixture.ts` before `persons` and `device_profiles`.
- [ ] In the login path, keep the existing order: `refuseKitchenSignIn` (`till-api.ts:915`), throttle check, `checkPin` outside the transaction, then inside the transaction `assertDeviceStillProven` and the admission check on the device's current profile before `loginWithPin` inserts a session. An ineligible person gets `pin.invalid` after the same hashing work. Reuse the evaluator in the login-person list.
- [ ] Rerun focused suites, inspect stored session rows for a refused login, run schema and migration guards, and commit with sign-off.

### Task 3: Approve alternatives and switch one device's active profile

**Files:** `packages/db/src/schema/devices.ts` or a new schema file, new core migration (after `0110`), `packages/db/src/classification.ts`; `apps/server/src/device-api.ts`, `device-api.test.ts`, `device.ts`, `device-session.ts`, `till-session.ts`; `apps/server/src/testing/clear-provision-fixture.ts`; `apps/dashboard/src/screens/devices-screen.ts` and tests; `apps/till/src/till-app.ts` and tests.

**Interface:** `listApprovedProfiles(tx, deviceId): Promise<string[]>` (the active profile plus stored alternatives), `approveDeviceProfiles(tx, deviceId, ids): Promise<void>`, and one authenticated `POST /api/device/active-profile` with `{ profileId }`. The existing `devices.device_profile_id` remains the active profile and **counts as approved implicitly**; only alternatives are stored, so the device insert sites (`apps/server/src/join-requests.ts:543`, `packages/db/src/testing/seed.ts:87`, the two `apps/server/scripts` files) are untouched. The management Devices editor changes the approved set; staff switch only within it. This task builds the till's profile switcher; Task 7 does not build another.

- [ ] Red tests: a freshly enrolled device lists exactly its active profile as approved; approving two alternatives retains the active one; an unknown or incompatible form-factor profile is refused. An old client cannot switch to an unapproved profile. The server switch checks current-person eligibility (Task 2) and refuses during an active payment. A shared display cannot switch into a named-login profile without a person signing in. The browser refuses switching with an unfinished local draft until Save or Cancel. Either refusal leaves profile and printer choices untouched. A successful switch updates the active profile, ends the sessions of people not eligible for the new profile, resets zone/menu browsing, retains a printer choice still on the new profile's list, and uses the existing first-usable choice when it is not (`updateDeviceSettings`, `device.ts:63`). The equipment plan replaces that last fallback with explicit defaults. Same-profile selection is idempotent.
- [ ] `PATCH /management-api/devices/:id` keeps **approve-and-activate in one transaction**: a `profileId` not yet approved becomes approved and active together, and the route refuses during an active payment on that device. Its existing cases (`device-api.test.ts:1363`, `1400`, `1418`, `1449`) stay as they are. Approved alternatives travel in an optional body field; absent leaves the stored set alone.
- [ ] Run `pnpm --filter @waitron/server test -- src/device-api.test.ts` with the new cases and confirm the behavioral assertions fail. For the local draft, add the browser test first and confirm it fails before adding the UI guard.
- [ ] Add the core approval table and migration (stated reason in the commit: it joins two core tables, `devices` and `device_profiles`). Keys `ON DELETE CASCADE` into `device_profiles`; `device-profile-store.db.test.ts:785` gains that row. Classify as `state`. It stays behind in the configuration transfer (devices are not exported). Add it to `clear-provision-fixture.ts` before `device_profiles`. Do not rebuild `devices`.
- [ ] Server operations run in one transaction, and the device-authenticated switch route. Every request already re-reads the active profile through `requireSession`; a stale session cannot gain actions because the switch ends ineligible sessions. The payment check uses `payments.device_id` and `payments.state` (`packages/payments/src/schema/payments.ts`); trace its writers before choosing the predicate. The draft check is client-side because the draft is local; show Save or Cancel and leave the profile unchanged until resolved.
- [ ] Implement the Devices approval editor and till switcher with shared field primitives and localized refusals. Rerun focused server/browser tests, schema and migration guards, then commit with sign-off.

### Task 4: Use profile zones in order paths and browsing state

**Files:** `apps/server/src/till-api.ts` and its zone/order/table/party/bill suites, `packages/venue-service/src/profile-access.ts`, `operations.ts`, `service.ts`, `service.test.ts`, `packages/module/src/module.ts`, `apps/till/src/till-app.ts`, `apps/till/src/screens/till-table-order-screen.ts`, `till-floor-screen.ts`, focused browser suites.

**Interface:** `assertProfileZone(tx, cfg, profileId, zoneId): Promise<void>` uses Task 1's current active-zone resolution and joins `VenueServiceContribution` and the `service.test.ts` list. Its refusal names the attempted zone without exposing another department's order. Existing-order reads and writes also check that the order's zone belongs to the active profile; opening a table uses the order's zone. `resolveNewOrderZone` takes the profile's starting zone ahead of the per-device default; the per-device default stays until Task 7b.

- [ ] **Route-to-zone map.** Before writing gates, list every route in `apps/server/src/till-api.ts` (routes `:942` to `:2874`) and `apps/server/src/bill-payments-api.ts` in a table at the top of the Task 4 server test file: route, how its zone is found (body, order, table, party, bill), and the case that fails when the gate is removed. Cover zone selection and offers (`/api/default-service-zone/offers`, `/api/service-zones/:zoneId/offers`, `/api/menu-state`), sales and pay, working orders and their lines, and the table, party and bill routes (`/api/tables*`, `/api/parties/:id/*`, `/api/bills/:id/*`). Follow each route's actual call chain rather than assuming one gate covers all. The list endpoints (`/api/zones`, `/api/tables`, `/api/tables/state`, `/api/working-orders`, the counter zone list in `/api/default-service-zone/offers`) return only the active profile's zones and their orders.
- [ ] Red server tests: a Restaurant profile can order a menu item originating in Deli when it is offered to a Restaurant zone, but cannot select the Deli zone or browse/manage a Deli order or table. A zone moved to Deli or deactivated after profile setup fails the same way. A profile with no department (option B) keeps today's behavior.
- [ ] Red browser tests: a new operator starts at the profile's starting zone and current default menu; the same operator returning to the same device and zone retains a manual menu choice; changing zone and returning selects the destination's current default; opening an existing table uses its recorded zone; screen changes retain the manual choice; a page reload starts from the profile's starting zone. Use distinct menu names so the wrong selection is visible. The later timetable branch will add period-boundary cases. Today's login path re-fetches the zone and resets the menu (`till-app.ts:1873-1890`); the browsing fields are `counterServiceZoneId` (`:1340`), `selectedCatalogueId` (`:1343`), `tableSelectedCatalogueId` (`:1312`) and `#tableZoneId` (`:1263`). Zone change already picks the new zone's default (`:2203`).
- [ ] The `p1` row of `till-app.test.ts:10590` and `till-api.test.ts:1862` are owner exceptions 2 and 3; do not edit them until answered.
- [ ] Run focused `@waitron/server`, `@waitron/venue-service`, and `@waitron/till` suites and see the intended failures. Add the server checks before changing the UI. Keep an open order's recorded lines, prices and service context unchanged. Rerun and commit with sign-off.

### Task 5: Separate permitted actions from screens

**Files:** `packages/layouts/src/canvas.ts`, `device-profile.ts`, `device-profile-store.ts`, `card-contract.ts` and tests; `packages/db/src/schema/device-profiles.ts` and new core migration; `apps/server/src/device-session.ts`, `till-api.ts`, `orders-api.ts`, `bill-payments-api.ts`, `receipt-print.ts`, `device-api.ts`, `management-api.ts` and focused route tests; `apps/till/src/till-app.ts`, `apps/till/src/layout.ts`, `apps/till/src/widgets/card-grid.ts` and browser tests; `apps/dashboard/src/screens/canvas-editor/card-contracts.ts` and its parity test.

**Interface:** keep `capabilities` as the stored column and wire field. In `@waitron/layouts`, type it as two subsets of one list: `ProfileAction` (taking orders, cash, connected/hand-keyed card payments, preparing, handing over, printing, opening a drawer) and `ProfileScreen` (the corresponding navigation views; today's `show-*` flags). Existing flags keep their names; add only new ones. Login mode is derived from the form factor (`kds` = shared display). `startingScreen` is a new nullable plain column with no CHECK, validated in the store against the profile's screen subset. `assertProfileAction(device, action)` refuses with the existing `device.forbidden_action`. Do not add identity permission ids: an action with no person permission needs only a signed-in active person; existing permission checks stay. A shared display may use only its prepare/watch actions without a named person; order/payment/drawer actions always require one.

- [ ] Before changing anything, list every consumer of `CAPABILITY_FLAGS`, `show-*`, `assertDeviceCapability`, `assertTakesCash`, and every affected route handler. At least: `apps/server/src/device-session.ts:362` and `:377`; `till-api.ts:1435`, `:1454`, `:1886`, `:1912`, `:1926`, `:1954`, `:1993` and the `/api/till` boot read (`:1107-1205`); `bill-payments-api.ts:220`, `:226`; `orders-api.ts:197` (reprint); `receipt-print.ts:86-94` (which printer's drawer opens); `requiredCapability` on cards (`packages/layouts/src/card-contract.ts:15`, `:90`); `apps/till/src/layout.ts:93`; `apps/till/src/widgets/card-grid.ts:177`; and the dashboard's copy of the flag list (`apps/dashboard/src/screens/canvas-editor/card-contracts.ts:20`), pinned equal to the original by `card-contracts.parity.test.ts:33`. Record the route-to-action map in this task's test file.
- [ ] Red cases include a visible read-only live-orders screen refusing preparation/payment; a hidden screen's direct POST refusing the action; a permitted profile action with a person lacking an existing permission refusing; and the reverse. Preserve existing cash, drawer, receipt and card behavior assertions while moving the gates (CLAUDE.md §5's guard files).
- [ ] **No table rebuild.** The migration only adds the nullable `starting_screen` column. Read the generated SQL; if it contains a `__new_device_profiles` table, stop and change the schema.
- [ ] Run the focused `@waitron/layouts` and `@waitron/server` cases and see behavior failures. Add the subsets, the starting screen and write validation, then gate each actual route. Keep display-only visibility decisions in the till, never as a substitute for the server refusal.
- [ ] Update seeded profiles (`DEFAULT_PROFILE_CAPABILITIES`, `packages/layouts/src/device-profile.ts`) deliberately, including the `kds` shared display's restricted actions. The seed pins are owner exception 5; do not edit them until answered. If a new flag would change a seed, prefer a gate that existing seeds already satisfy, and say in the commit which seed changed and why.
- [ ] Rerun the focused route and browser suites. Confirm a direct HTTP request to a hidden action is refused and a permitted neighboring operation succeeds. Run the migration/schema guards and commit with sign-off.

### Task 6: Configure station and watcher choices for shared displays

**Files:** `packages/venue-service/src/profile-access.ts` and tests, `service.ts`, `service.test.ts`, `packages/module/src/module.ts`; `apps/server/src/device.ts`, `device-api.ts`, `device-api.test.ts`, `watchers.ts`, `in-use-references.test.ts`, station action routes and tests; `apps/dashboard/src/screens/device-profiles-screen.ts`, `devices-screen.ts`; `apps/till/src/till-app.ts` and station screen tests.

**Who chooses:** the manager, in the Devices edit dialog (`PATCH /management-api/devices/:id`), as today. A kitchen display has no person signed in. The choice is limited to the profile's station/watcher list.

- [ ] Red tests: one Kitchen profile permits two stations, and two devices are given different stations from that list; a third station is refused. A watcher device is given one permitted watcher and follows that watcher's configured stations/zones. The kitchen receives work from Restaurant and Deli at its chosen station but cannot browse either department's unrelated orders. Removing a station or watcher from a profile's list while an active device uses it is refused and identifies the device, so the manager can choose another first. A shared display cannot order, pay or open a drawer through direct routes.
- [ ] Run focused venue-service, server and till suites; confirm the expected failures. Implement list validation (`resolveDeviceBinding`, `device.ts:103`, calls the new venue-service check through `VenueServiceContribution`) and the two editors. Keep station/watcher routing in the existing venue-service model, not duplicated as profile routing. Leave the station-or-watcher exclusion unchanged, in both `device.ts:129-146` and the core triggers (`packages/db/drizzle/0091_devices_recreate_triggers.sql`).
- [ ] The profile station/watcher list tables come from Task 1 (classified, transferred with profiles, cleared before their parents). A key into `watchers` must join `WATCHER_REFERENCES` or `WATCHER_SETTINGS` (`apps/server/src/watchers.ts:164`), or `in-use-references.test.ts:32` fails. Decide which and say it in the commit: a reference makes a listed watcher disabled rather than deleted on removal (W110b); a setting is deleted with the watcher.
- [ ] Rerun focused tests, inspect both themes and phone width, run axe for changed profile/device views, and commit with sign-off.

### Task 7: Expose all profile settings to managers

**Files:** `apps/server/src/management-api.ts` (profile routes `:1245`–`:1376`), `management-api.device-profiles.test.ts`, `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/screens/device-profiles-screen.ts`, `device-profiles-screen.test.ts`, `device-profiles-screen.a11y.test.ts`, English/Spanish strings, and the dashboard live-subscription names for the new tables.

- [ ] Red management-route tests: creating and replacing an ordering profile stores its department, zone mode/subset, valid starting zone, role admissions, person exceptions, action and screen flags, starting screen and permitted stations/watchers. An unknown department/person or a zone outside the profile's department is refused with a field named in the refusal; a failed update leaves the previous policy intact. A shared display rejects order, payment and drawer actions. Test omitted optional values and explicit null separately. Existing profile-row shapes (`management-api.device-profiles.test.ts:177`, `:195`, `:226`) gain keys under the whole-shape rule; their existing values stay.
- [ ] Red browser tests: the editor makes the department, zone mode and starting zone choices understandable; the admitted people list updates when a role or exception changes; actions and screens have separate controls; station/watcher lists are distinct from a device's current choice. A failed save retains the draft and marks the relevant field; a successful save refreshes without resetting another draft.
- [ ] Run the focused server/dashboard suites and confirm the new behavior fails. Extend the existing profile POST/PUT routes and dashboard client contract, using the stores from Tasks 1, 2, 5 and 6 inside the route's one gated transaction. Keep default printer-list behavior from A238 until the equipment plan. Add localized form copy. The device operator's profile switcher is Task 3's; do not build another.
- [ ] Rerun focused suites, axe tests, and visual checks in both themes at phone width. Commit with sign-off.

### Task 7b: Retire the per-device default zone

Runs after Task 7, so managers can set a starting zone on the profile before the per-device control goes. **Every test edit below is owner exception 1 (and 4 for the focus case); do not edit until answered.**

**Production code to remove:** table `device_zone_defaults` (`packages/venue-service/src/schema/service.ts:207`) via a new venue-service migration; `setDeviceDefaultZone`, `listDeviceDefaultZones`, `clearDeviceDefaultZone` and the device branch of `resolveNewOrderZone` (`packages/venue-service/src/operations.ts:890-984`) and the delete at `:363`; routes `PUT`/`DELETE /management-api/venue-service/devices/:deviceId/default-zone` (`packages/venue-service/src/routes.ts:771`, `:781`) and `deviceZones` in the GET (`:456`); client methods (`packages/venue-service/src/dashboard/client.ts:238-246`) and the `deviceZones` type (`:76`); `#deviceStartingZones` (`packages/venue-service/src/dashboard/venue-operations-screen.ts:1372-1430`, used at `:1850`). **Production lists:** `packages/venue-service/src/classification.ts:14`; `packages/venue-service/src/dashboard/live-queries.ts:51`; `apps/server/src/testing/clear-provision-fixture.ts:16`. Leave `packages/fiscal-verifactu/src/privileges.expected.ts:41` alone: it is a frozen record. Trace every remaining `device_zone_defaults` reader and writer before the migration; a pre-production venue reset is allowed.

**(a) Tests that exist only for the retired feature — delete:**
- `packages/venue-service/src/operations.test.ts:1711` "returns to the counter default after a device default is cleared" — keep its counter-default fallback as a case on `resolveNewOrderZone` without a device, if no other case covers it.
- `packages/venue-service/src/operations.test.ts:1733` "starts a device's new order in its own default zone ahead of the venue's counter default".
- `packages/venue-service/src/routes.test.ts:1594` "stores the zone a device's new orders start in".
- `packages/venue-service/src/dashboard/client.test.ts:313` "sets and clears a device's default zone through the same device endpoint".
- `packages/venue-service/src/service.test.ts:43` "does not transfer device defaults without their device rows".
- `packages/venue-service/src/dashboard/venue-operations-screen.test.ts:1999`, `2035`, `2048`, `2069`, `2088`, `2109`, `2130`.

**(a) Single assertions inside wider tests — remove only that assertion:**
- `packages/venue-service/src/operations.test.ts:1351-1353`, inside "removes a zone's routing, watcher and device selections…" (`:1292`).
- `packages/venue-service/src/routes.test.ts:1461-1471`, the default-zone 404 inside "requires a manager and screens malformed resource ids" (`:1444`).

**(b) Pinned lists that lose the retired table or field:**
- `packages/venue-service/src/migrations.test.ts:37` and `:171`.
- `packages/venue-service/src/schema/service.test.ts:99-106`.
- `scripts/schema-constraints.test.ts:70-71`.
- `deviceZones` in fixtures: `packages/venue-service/src/dashboard/client.test.ts:108`, `venue-navigation.test.ts:15`, `venue-operations-screen.a11y.test.ts:21`, `:63`, `:106`, `:181`, `venue-operations-screen.test.ts:72`, `:3513`.

**(c) Cases whose meaning changes:**
- `apps/server/src/till-api.test.ts:1862` — owner exception 3 (may already be handled in Task 4).
- `packages/venue-service/src/dashboard/venue-operations-screen.test.ts:3525` — owner exception 4: move its focus assertion onto a surviving control, not delete it.

- [ ] Remove the production code and lists, generate the migration and read its SQL, apply the answered test edits, run the venue-service, server and dashboard focused suites and the migration guards, and commit with sign-off.

### Task 8: Audit integration and leave handoffs for the other slices

**Files:** `docs/backlog.md`, relevant developer topic files only where a reusable rule emerged, current user-facing device help/copy, and tests for any discovered missing consumer.

- [ ] Search all consumers of the profile capability fields, device profile id, zone selection, station/watcher binding, login-person list and action gates. For each affected route, identify the failing case that would have caught a removed guard. Add focused tests for gaps, red first. Do not change assertions merely to match a new shape.
- [ ] Rerun focused package tests and any broader checks called for by a found cross-package failure. Run the normal pre-push hook once during `finish-branch`; check current-head CI package coverage before claiming readiness. Open the changed dashboard and till views in light/dark at desktop and phone width. Update the backlog with delivered scope and the separate equipment, menus and transfer branches. Commit with sign-off and announce readiness for `finish-branch`.

## Execution order and handoff

Order: 1, 2, 3, 4, 5, 6, 7, 7b, 8. Task 3 needs Task 2's admission check; Task 6 needs Task 5's derived login mode and Task 1's lists; Task 7b needs Task 7's profile editor. The whole plan lands as one branch. The menu membership/scheduling branch must replace A261 step 2 Task 8 before that plan removes the old menu editor. The equipment branch must define portable assignment, Use default, busy-terminal protection and the drawer independent of receipt printers before removing the present printer-choice behavior. The transfer branch consumes the profile admission and department scope established here.

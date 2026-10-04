# Device profile access and switching — implementation plan

> **For agentic workers:** implement this plan task by task with failing behavioural tests first. Use `superpowers:executing-plans` for inline execution; the repository's direct Codex workflow owns review and branch finishing.

**Goal:** Let a device use only its approved profiles, with profile-controlled department and zone access, staff admission, actions, screens, and kitchen display bindings.

**Architecture:** Keep the active profile on `devices` and store its approved alternatives separately. Keep cross-module department and zone rules in `@waitron/venue-service`; do not make `@waitron/layouts` depend on that module. Resolve a request's device, person, active profile, and service scope at the server boundary, then check each operation there. The till displays the same resolved choices but is never the authority for access.

**Tech Stack:** TypeScript, Drizzle/SQLite, Hono, Lit, Vitest database and browser projects.

**Spec:** [Devices, menus and service zones](../specs/2026-10-04-devices-menus-and-service-zones-design.md), chiefly §§2, 4, 6, 8–10. The owner approved this written spec on 2026-10-04. Section 9's proposed details are included in that approval.

## Global constraints

- This is the **profile access and device switching** slice from spec §8. Department menu membership and scheduling, forward-only publication, portable equipment possession and independent drawers, and transfers each need their own plan and branch. Keep the current printer selection behavior until the equipment branch replaces it.
- Every ordering profile has one department, an allowed set of that department's zones or **all** of them, and a valid starting zone. A kitchen station or watcher profile may receive work from several departments; its station or watcher determines that scope.
- A person's permission and the active profile must both allow an action. Screen visibility is separate. Shared displays can prepare or watch only as configured; they cannot order, pay, or open a drawer without a named login.
- A device switch requires both management approval of that profile for the device and the current person's admission to that profile. Refuse switching during an active payment or an unresolved local draft. Recheck admission on every new login and switch.
- A zone change chooses that zone's current default menu. A screen change and the same person's return to the same device and zone retain a manual menu choice. Another person's login starts at the profile's starting zone and its current default. The menu timetable branch will implement the later time-bound default changes.
- A changed form follows [Forms](../../developers/design-system.md): field-level and bottom validation, semantic names, shared primitives, English and Spanish copy. Inspect light and dark themes and phone width.
- Follow [data](../../developers/conventions-data.md), [UI](../../developers/conventions-ui.md), [testing](../../developers/testing-guide.md), [CI](../../developers/ci-and-gates.md), and [workflow](../../developers/workflow-guide.md) before their respective tasks. Do not edit a shipped migration. Use a pre-production reset when schema changes require it.

## Existing behavior and the two plan conflicts

At `main` `13166a042`, `devices.device_profile_id` is the one active profile (`packages/db/src/schema/devices.ts`); `device_profiles` has form factor, canvas, mixed capabilities and timeout (`packages/db/src/schema/device-profiles.ts`). The manager's reassignment route is `apps/server/src/device-api.ts:414`; profile writes are in `apps/server/src/management-api.ts:1272`. The server's profile capability gate is `apps/server/src/device-session.ts:298`. These are starting points, not proof that they are the only consumers: trace each before changing its meaning.

The [A261 step 2 plan](2026-10-04-departments-and-zones.md) was written before this spec. Its Task 7 places the starting zone on a device, and Task 8 preserves zone-by-zone menu availability. The approved spec places the starting zone on the **profile** and available menus on the **department**. At 17:10 on 2026-10-04 the owner chose an interim A261 build: omit Task 8 and the device-level starting-zone move, while keeping today's zone-menu and device-default-zone controls available in a small section of the new screen (`~/waitron-campaign-d/questions.md`, owner answer). This profile branch replaces the latter control. The department-menu branch replaces the former; A261's sale and receipt policy work proceeds separately.

## File map and interfaces

| Unit | Responsibility |
| --- | --- |
| `packages/db/src/schema/device-profiles.ts`, `devices.ts`, new approval schema, new core migrations | Profile-owned login mode, starting screen, action/screen settings and device-approved profiles; active profile stays on the device |
| `packages/venue-service/src/schema/service.ts`, new venue-service migration, new `profile-access.ts` | Department, allowed zones, starting zone, and station/watcher choices, validated against live venue rows |
| `packages/identity/src/profile-admission.ts`, identity schema/migration | Role and individual admission rules, evaluated against the real person's current role and status |
| `packages/layouts/src/device-profile.ts`, `device-profile-store.ts` | Typed action and screen sets; existing form factor, canvas, timeout and printer fields |
| `apps/server/src/device-session.ts`, `device-api.ts`, `till-api.ts`, action routes | Resolve one active profile per request and refuse disallowed operations at their actual write boundaries |
| `apps/dashboard/src/screens/device-profiles-screen.ts`, `devices-screen.ts`, `apps/till/src/till-app.ts`, lock and station screens | Configure profiles and approved devices; show only available screens and choices |

Expose a server-side `ProfileAccess` value with `profileId`, `departmentId`, `allowedZoneIds`, `startingZoneId`, `actions`, `screens`, `stationIds`, and `watcherIds`. `allowedZoneIds: null` means **all active zones in the department**, not all venue zones; reject an empty explicit set on an ordering profile because it cannot contain a starting zone. For a shared display, `departmentId` and `startingZoneId` are null. Resolve these against current rows rather than trusting a stale client snapshot. The implementation may split this value into narrower functions where a caller needs less data, but keep those field meanings consistent.

## Review focus

Each case below belongs in the owning task's failing test, not only in this list.

1. A zone moved to another department or deactivated after profile setup must cease to be orderable; a saved profile choice must not grant cross-department access (Tasks 1 and 4).
2. A person's role/status or individual exception changed while the device stays enrolled must affect the next login and profile switch (Tasks 2 and 3).
3. A profile approval removed while an old client still offers it must be refused by the server; the active profile must remain approved (Task 3).
4. A hidden screen's route must still check its action, and a visible read-only screen must not inherit write access (Task 5).
5. A station receives work from two ordering departments while the kitchen device cannot browse either department's unrelated orders (Task 6).

---

### Task 1: Store and validate profile service scope

**Files:** `packages/venue-service/src/schema/service.ts`, `packages/venue-service/src/profile-access.ts` (new), `packages/venue-service/src/profile-access.test.ts` (new), the next venue-service migration and journal, `packages/venue-service/src/index.ts`.

**Interface:** `readProfileServiceAccess(tx, cfg, profileId): Promise<{ departmentId: string | null; allowedZoneIds: string[] | null; startingZoneId: string | null; stationIds: string[]; watcherIds: string[] }>` and `setProfileServiceAccess(tx, cfg, profileId, input): Promise<void>`. The display case has null department/start zone; an ordering profile requires both. Validate each foreign id against the venue, active department, and its zones inside the same transaction as the write.

- [ ] Write database tests with Restaurant and Deli departments, two Restaurant zones and one Deli zone. A Restaurant profile accepts its own start zone, refuses the Deli zone as an allowed or start zone, refuses a start zone outside its explicit subset, and refuses an empty explicit subset. Verify null allowed-zone list expands only to active Restaurant zones at read time. Deactivate or move an allowed zone and verify it cannot be used for a new order.
- [ ] Run `pnpm --filter @waitron/venue-service test -- src/profile-access.test.ts`; see assertions fail because the access store/resolver is absent, not because setup or migration failed.
- [ ] Add the schema and generated migration in the venue-service set, the resolver and validation. Do not change the existing `zone_menus` write path in this task. Check the new table's classification, migration dependency graph, foreign keys, schema conformance and append-only classification.
- [ ] Run the focused suite and the migration guards named in `docs/developers/conventions-data.md`. Read the generated SQL, especially any rebuilt table and inbound keys. Commit with `git commit -s`.

### Task 2: Admit people by role and individual exception

**Files:** `packages/identity/src/profile-admission.ts` (new), identity schema/migration and tests, `packages/identity/src/index.ts`, `apps/server/src/till-api.ts`, `apps/server/src/till-api.test.ts`. The login-person list is `GET /api/staff` in `till-api.ts:1049`.

**Interface:** `canUseDeviceProfile(tx, profileId, personId): Promise<boolean>`. Store an allowed role set and per-person allow/deny exceptions; deny wins for that person, then allow, then role set. Inactive, suspended or missing people are never admitted. Keep the public login refusal generic (`pin.invalid`) and make the names shown at login use the same admission rule.

- [ ] Write a failing identity suite for each role, explicit allow, explicit deny, changed role, inactive person, and deleted exception. Write route tests showing only eligible names on the device's login screen and the same generic refusal for an ineligible correct PIN and a bad PIN. Include a named eligible person as the negative control for an over-wide refusal.
- [ ] Run `pnpm --filter @waitron/identity test -- src/profile-admission.test.ts` and the focused server login suite; confirm the new assertions fail for admission behavior.
- [ ] Add the identity-owned tables and evaluator. In the login path, perform PIN hashing through the existing `checkPin` path before returning the generic refusal; keep the route's throttle keyed by device and person. Resolve the device's active profile inside the transaction before inserting a session. Reuse the evaluator in the login-person list.
- [ ] Rerun focused suites, inspect stored session rows for a refused login, run schema and migration guards, and commit with sign-off.

### Task 3: Approve alternatives and switch one device's active profile

**Files:** `packages/db/src/schema/devices.ts`, new approval schema and core migration; `apps/server/src/device-api.ts`, `device-api.test.ts`, `device-session.ts`; `apps/dashboard/src/screens/devices-screen.ts` and tests; `apps/till/src/till-app.ts` and tests.

**Interface:** `listApprovedProfiles(tx, deviceId): Promise<string[]>`, `approveDeviceProfiles(tx, deviceId, ids): Promise<void>`, and one authenticated `POST /api/device/active-profile` with `{ profileId }`. The existing `devices.device_profile_id` remains the active profile. The management Devices editor changes the approved set; staff switch only within it.

- [ ] Red tests: enrolment approves its initial profile; approving two profiles retains the active one; removing the active one is refused until another approved profile is made active; an unknown or incompatible form-factor profile is refused. An old client cannot switch to an unapproved profile. The server switch checks current-person eligibility and refuses during an active payment. A shared display cannot switch into a named-login profile without a person signing in. The browser refuses switching with an unfinished local draft until Save or Cancel. Either refusal leaves profile and printer choices untouched. A successful switch updates the active profile, resets zone/menu browsing, retains a printer choice still on the new profile's list, and uses the existing first-usable choice when it is not. The equipment plan replaces that last fallback with explicit defaults. Same-profile selection is idempotent.
- [ ] Run `pnpm --filter @waitron/server test -- src/device-api.test.ts` with the new cases and confirm the behavioral assertions fail. For the local draft, add the browser test first and confirm it fails before adding the UI guard.
- [ ] Add the core approval table and migration, server operations in one transaction, and the device-authenticated switch route. Change the existing manager reassignment route so it cannot silently activate an unapproved profile or bypass the busy-payment rule; either approve and activate in one transaction or keep it as approval only. Every request reads the current active profile and checks the session person is still eligible; a stale session cannot gain actions from a profile switch. The payment check must use the existing payment state that owns the terminal/device; trace its writers before choosing the predicate. The draft check is client-side because the draft is local; show Save or Cancel and leave the profile unchanged until resolved.
- [ ] Implement the Devices approval editor and till switcher with shared field primitives and localized refusals. Rerun focused server/browser tests, schema and migration guards, then commit with sign-off.

### Task 4: Use profile zones in order paths and browsing state

**Files:** `apps/server/src/till-api.ts` and its zone/order suites, `packages/venue-service/src/profile-access.ts`, `apps/till/src/till-app.ts`, `apps/till/src/screens/till-table-order-screen.ts`, focused browser suites.

**Interface:** `assertProfileZone(tx, cfg, profileId, zoneId): Promise<void>` uses Task 1's current active-zone resolution. Its refusal names the attempted zone without exposing another department's order. Existing-order reads and writes also check that the order's zone belongs to the active profile; opening a table uses the order's zone.

- [ ] Red server tests: a Restaurant profile can order a menu item originating in Deli when it is offered to Restaurant, but cannot select the Deli zone or browse/manage a Deli order. A zone moved to Deli or deactivated after profile setup fails the same way. Check zone selection, order creation, saved-order read, payment and amendment routes; follow each route's actual call chain rather than assuming one gate covers all.
- [ ] Red browser tests: new operator starts at the profile's starting zone and current default menu; same operator returning to the same device and zone retains a manual menu choice; changing zone and returning selects the destination's current default; opening an existing table uses its recorded zone; screen changes retain the manual choice. Use distinct menu names so the wrong selection is visible. The later timetable branch will add period-boundary cases.
- [ ] Run focused `@waitron/server`, `@waitron/venue-service`, and `@waitron/till` suites and see the intended failures. Add the server checks before changing the UI. Keep an open order's recorded lines, prices and service context unchanged. Rerun and commit with sign-off.

### Task 5: Separate permitted actions from screens

**Files:** `packages/layouts/src/device-profile.ts`, `device-profile-store.ts` and tests; `packages/db/src/schema/device-profiles.ts` and new core migration; `packages/identity/src/permissions.ts` and tests; `apps/server/src/device-session.ts`, `till-api.ts`, `bill-payments-api.ts`, `receipt-print.ts`, `device-api.ts` and focused route tests; `apps/till/src/till-app.ts` and browser tests.

**Interface:** `ProfileAction` covers taking orders, cash, connected/hand-keyed card payments, preparing, handing over, printing, and opening a drawer. `ProfileScreen` covers the corresponding navigation views. Store `loginMode: "named" | "shared"` and `startingScreen: ProfileScreen` separately from form factor. `assertProfileAction(device, action)` rejects absence with a domain `device.forbidden_action` refusal. Add identity permission ids for actions that currently have no person permission, then check both gates. A shared operational display may use only its configured prepare/watch actions without a named person; order/payment/drawer actions always require one.

- [ ] Before changing `capabilities`, search every consumer of `CAPABILITY_FLAGS`, `show-*`, `assertDeviceCapability`, `assertTakesCash`, and all affected route handlers. Record the route-to-action map in this task's test file. Red cases include a visible read-only live-orders screen refusing preparation/payment; a hidden screen's direct POST refusing the action; a permitted profile action with a person lacking permission refusing; and the reverse. Preserve existing cash, drawer, receipt and card behavior assertions while moving the gates.
- [ ] Run the focused `@waitron/layouts` and `@waitron/server` cases and see behavior failures. Add separate stored action/screen lists, login mode, starting screen and write validation, then gate each actual route. Refuse a starting screen outside the profile's screen list. Keep display-only visibility decisions in the till, never as a substitute for the server refusal. Update seeded profiles deliberately, including the `kds` shared display's restricted actions.
- [ ] Rerun the focused route and browser suites. Confirm a direct HTTP request to a hidden action is refused and a permitted neighboring operation succeeds. Run the migration/schema guards and commit with sign-off.

### Task 6: Configure station and watcher choices for shared displays

**Files:** `packages/venue-service/src/profile-access.ts` and tests; `apps/server/src/device.ts`, `device-api.ts`, `device-api.test.ts`, station action routes and tests; `apps/dashboard/src/screens/device-profiles-screen.ts`, `devices-screen.ts`; `apps/till/src/till-app.ts` and station screen tests.

- [ ] Red tests: one Kitchen profile permits two stations, and two devices choose different stations from that list; a third station is refused. A watcher chooses one permitted watcher and follows that watcher's configured stations/zones. The kitchen receives work from Restaurant and Deli at its chosen station but cannot browse either department's unrelated orders. Removing a station or watcher from a profile's list while an active device uses it is refused and identifies the device, so the operator can select another choice first. A shared display cannot order, pay or open a drawer through direct routes.
- [ ] Run focused venue-service, server and till suites; confirm the expected failures. Implement list validation, device choice operations and the two editors. Keep station/watcher routing in the existing venue-service model, not duplicated as profile routing. Respect the current station-or-watcher mutual exclusion in `apps/server/src/device.ts` unless the approved spec explicitly changes it.
- [ ] Rerun focused tests, inspect both themes and phone width, run axe for changed profile/device views, and commit with sign-off.

### Task 7: Expose all profile settings to managers and the device operator

**Files:** `apps/server/src/management-api.ts`, `management-api.device-profiles.test.ts`, `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/screens/device-profiles-screen.ts`, `device-profiles-screen.test.ts`, `device-profiles-screen.a11y.test.ts`, `apps/till/src/till-app.ts`, its focused tests, and English/Spanish strings.

- [ ] Red management-route tests: creating and replacing an ordering profile stores its department, zone mode/subset, valid starting zone, role admissions, person exceptions, action set, screen set, starting screen and permitted stations/watchers. An unknown department/person or a zone outside the profile's department is refused with a field named in the refusal; a failed update leaves the previous policy intact. A shared display rejects order, payment and drawer actions. Test omitted optional values and explicit null separately.
- [ ] Red browser tests: the editor makes the department, zone mode and starting zone choices understandable; the admitted people list updates when a role or exception changes; actions and screens have separate controls; station/watcher choices are distinct from the device's current choice. The Devices editor displays approved profiles and the current active one. A failed save retains the draft and marks the relevant field; a successful save refreshes without resetting another draft.
- [ ] Run the focused server/dashboard/till suites and confirm the new behavior fails. Extend the existing profile POST/PUT routes and dashboard client contract, using the stores from Tasks 1, 2, 5 and 6 inside one `withTransaction`. Keep default printer-list behavior from A238 until the equipment plan. Add localized form copy and the device operator's profile switcher.
- [ ] Rerun focused suites, axe tests, and visual checks in both themes at phone width. Commit with sign-off.

### Task 8: Audit integration and leave handoffs for the other slices

**Files:** `docs/backlog.md`, relevant developer topic files only where a reusable rule emerged, current user-facing device help/copy, and tests for any discovered missing consumer.

- [ ] Search all consumers of the old profile capability fields, device profile id, zone selection, station/watcher binding, login-person list and action gates. For each affected route, identify the failing case that would have caught a removed guard. Add focused tests for gaps, red first. Do not change assertions merely to match a new shape.
- [ ] Rerun focused package tests and any broader checks called for by a found cross-package failure. Run the normal pre-push hook once during `finish-branch`; check current-head CI package coverage before claiming readiness. Open the changed dashboard and till views in light/dark at desktop and phone width. Update the backlog with delivered scope and the separate equipment, menus and transfer branches. Commit with sign-off and announce readiness for `finish-branch`.

## Execution order and handoff

Tasks 1–2 can be reviewed independently; Tasks 3–6 depend on their interfaces and run in order. The menu membership/scheduling branch must replace A261 step 2 Task 8 before that plan removes the old menu editor. The equipment branch must define portable assignment, Use default, busy-terminal protection and the drawer independent of receipt printers before removing the present printer-choice behavior. The transfer branch consumes the profile admission and department scope established here.

# Department menus and timetable — implementation plan

> **For agentic workers:** implement each task with a failing behavioral test first. Use `superpowers:executing-plans` for inline work and the repository's branch finishing workflow.

**Goal:** Give each department one available-menu list and timetable, with zone overrides of defaults, while preserving recorded order facts.

**Architecture:** `@waitron/venue-service` owns membership and default resolution because it already owns departments, zones, `zone_menus`, and `listZoneOffers`. Catalogue continues to own immutable published menu documents. Resolve one service zone, local time, available set, and default before the till presents offers; the server checks membership again when a line is added.

**Tech Stack:** TypeScript, Drizzle/SQLite, Hono, Lit, Vitest database and browser projects.

**Spec:** [Devices, menus and service zones](../specs/2026-10-04-devices-menus-and-service-zones-design.md) §§2, 8–10; [Venue operations](../specs/2026-10-03-venue-operations-design.md) §7 for the shared special-date calendar. The devices/menus/zones spec is owner-approved; use A261's shared calendar model as its dependency.

## Global constraints

- Build after A261 step 2's departments/zones and W97's profile zone gate. Use the shared special-date model from A261's Hours/calendar steps; if it has not landed, keep this item pending rather than inventing a second calendar.
- Menu membership belongs to a department; zones can override a default for one shared period or all-day gap, never their available set or period boundaries. A zone's all-day choice does not override a department's active period.
- A period includes its start and excludes its end, in the venue's time zone. Normal weeks, overnight periods and special dates follow the approved A261 rules. Nonexistent or repeated local clock times must be resolved explicitly at the write boundary.
- Existing lines keep their recorded menu version, price and service context. A menu removed from availability stops new selections but does not rewrite an open order. A menu without a live published version is not offered.
- Preserve the existing sale/drawer and fiscal paths. New tables get module classification, generated constraints and migration guards. Do not edit shipped migrations. Inspect all changed UI in both themes and at phone width.

## File map and contracts

| Area | Starting point and responsibility |
| --- | --- |
| `packages/venue-service/src/schema/service.ts`, next venue-service migration, `classification.ts` | Replace `zone_menus` membership with department membership; store department periods, all-day default and zone default overrides |
| `packages/venue-service/src/operations.ts`, new `menu-timetable.ts`, `routes.ts` | Validate schedules; resolve available menus and effective default for a zone and instant |
| `packages/venue-service/src/dashboard/venue-operations-screen.ts`, module dashboard `client.ts` and strings | Edit membership and zone overrides on the Menus/Venue operations surfaces A261 establishes |
| `apps/server/src/till-api.ts`, `apps/till/src/till-app.ts`, menu browser, order route suites | Offer and enforce resolved menus; retain the operator's browsing choice only under the approved conditions |

Proposed seam: `resolveZoneMenus(tx, venueScope, zoneId, at): Promise<{ availableMenuIds: string[]; defaultMenuId: string | null; periodId: string | null }>`; `at` is one captured instant. A zone override is keyed by a stable period id, never by row position. Re-read the current A261 and W97 heads before fixing the schema or route names.

## Review focus

1. A restaurant zone can offer a Deli menu without granting access to Deli's zone or orders (Tasks 1 and 3).
2. A zone override inherits the department's lunch period even when its all-day menu differs (Task 2).
3. At an overnight or clock-change boundary, exactly one period is effective (Task 2).
4. A removed or unpublished menu is absent from new choices while an existing line stays intact (Tasks 1 and 3).
5. Returning to a zone after a manual menu choice follows its current default, while switching screens in one zone retains the manual choice (Task 3).

---

### Task 1: Move menu availability to departments

**Files:** `packages/venue-service/src/schema/service.ts`, `operations.ts`, `routes.ts`, their tests, new migration, classification and dashboard client.

- [ ] Write a real database test with Restaurant and Deli, their zones, and a Deli menu assigned to Restaurant. Assert both Restaurant zones receive it; Deli's zone does not gain Restaurant membership. Removing it refuses a new line without changing a previously recorded line. Run the focused venue-service test and confirm the new assertions fail.
- [ ] Add department membership and an ordered available-menu list, then change `zoneMenuIds`, `zoneLiveDocuments`, `listZoneOffers`, `menuState`, `allowMenuInZone` and their routes to read/write that list. Trace every `zone_menus` consumer, including provisioning, configuration transfer, tests and the default-menu foreign-key cycle in `schema/service.ts`, before retiring the interim table and control.
- [ ] Generate a new migration; inspect inbound keys/triggers and test a populated pre-live venue plus a fresh one. Run `pnpm --filter @waitron/venue-service test -- src/operations.test.ts` (or the owning focused suite), schema/migration guards, then commit with `git commit -s`.

### Task 2: Resolve one department timetable and zone defaults

**Files:** new `packages/venue-service/src/menu-timetable.ts` and tests, `schema/service.ts`, `operations.ts`, `routes.ts`, migration; shared Hours/calendar contract from A261.

- [ ] Write failing cases for weekday breakfast/lunch, a gap using the all-day default, weekend differences, a special date replacing the normal week, a zone override for lunch, zone all-day fallback, overnight intervals and exact boundary times. Include overlapping-period refusal, a removed menu, inactive department, and local times that do not occur or occur twice at a clock change.
- [ ] Run the focused venue-service suite; then store stable period ids and validate membership of every default and override inside one write transaction. Reuse A261's special-date calendar and venue time zone. Make `resolveZoneMenus` return only active published choices and the applicable default without reading a period per order line.
- [ ] Rerun focused tests, inspect generated SQL and migration guards, and commit with sign-off.

### Task 3: Apply defaults to browsing and ordering

**Files:** `apps/server/src/till-api.ts` and sale/order suites; `apps/till/src/till-app.ts`, menu browser and browser tests; `packages/venue-service/src/operations.ts`.

- [ ] Write failing server tests for a line from an available nondefault menu, a direct request for a menu outside the department, and removal after the screen loaded. Assert an open order's old lines and prices stay unchanged. Write browser tests with distinct menu names for period rollover between orders, an open order/manual choice held steady, same-zone screen/login retention, zone switch/back resetting to that zone's current default, and a new operator starting at the profile's zone/default.
- [ ] Run the focused server and till suites and confirm the intended failures. Read the default at each new order/browse transition from one captured instant; keep a manual choice until the spec's reset events. Check the server's line-add route against current membership and published version, not a client list.
- [ ] Rerun focused suites and visual checks in both themes at phone and desktop widths; commit with sign-off.

### Task 4: Manager editing and integration

**Files:** `packages/venue-service/src/dashboard/venue-operations-screen.ts`, dashboard client/strings and tests; `apps/dashboard/src/screens/menus-screen.ts` only where menu navigation needs the department editor; `docs/backlog.md`.

- [ ] Write failing manager-route and browser cases for changing the department menu list, normal week, special date, all-day default and per-zone override. A failed save keeps the draft and marks the field; another department's menu cannot be chosen by a zone unless the department includes it.
- [ ] Implement the forms with shared primitives and English/Spanish copy. Trace the old zone-menu editor and remove it only after the new controls work. Run focused route/browser/a11y tests, inspect both themes and phone width, update the backlog, and commit with sign-off.
- [ ] During `finish-branch`, run the normal pre-push gate and verify current-head CI coverage. Record any follow-up belonging to scheduled publication separately.

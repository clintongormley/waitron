# Service periods, slice 1 — implementation plan (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this slice removes" below), and only in a separate
> commit whose message begins `Changed test checks (A366 slice 1):` and lists each `file:line`
> with its before and after. Any other assertion that turns out to need changing is a STOP:
> report it, do not edit it. Adding fixture rows, or a key to a whole-shape pin, is allowed.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer
> past about 150 calls with the task unfinished stops at a passing or cleanly red point,
> commits, and returns a handover: done, left, files, each check's state.

**Goal:** a department's opening hours and its menu timetable become one thing. A period is a
name, a colour, one menu customers see and any number of staff-only menus; each day of the
normal week, and each special date, is a set of time ranges each assigned a period; the till
can order only from the current period's menus, and nothing when no period runs.

**Architecture:** reuse the W98 timetable tables (`menu_periods`, `menu_day_timetables`,
`menu_slots`) and drop the four tables this design retires (`department_menus`,
`department_all_day_menus`, `zone_all_day_menus`, `zone_period_menus`) plus department-owned
hours rows. A pure module (`service-day.ts`) owns the business-day arithmetic. The venue-service
resolver answers "which period, which menus, at this moment" for a department; the existing offer
readers (`listZoneOffers`, `menuState`) and the server's basket check call it. The dashboard gets
one new Opening hours screen (Week, Periods and Day tabs) built on one new grid component; the
Menu timetable screen goes, and the Hours screen keeps only stations, special dates and the
calendar until slice 2.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§§3, 4, 5 (all but the manager's extension), 9.2 (Week for one department, Periods, Day), 12 and
13 item 1. Backlog: A366.

**Risk path:** FULL ceremony. This slice has a migration and changes a cross-package contract
(the till's offers and menu-state answers).

## Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan.

1. **Items added before a period ended.** The till's basket stays on the till until it is sent,
   so the server cannot know when an item was added. The server accepts a new line whose menu
   belongs to the current period, or to the period that ended within the last **30 minutes**
   (`PERIOD_GRACE_MINUTES`). After that, it refuses. Lines already stored are never re-checked.
2. **A slot stores clock times read inside the business day.** `starts_at` and `ends_at` stay
   `HH:MM` clock times. A time earlier than the changeover belongs to the next calendar morning,
   so with a 06:00 changeover "21:00–03:00" is one range. An end equal to the changeover means
   the end of the business day, so "06:00–06:00" is the whole day. Times are in 15-minute steps.
3. **A special date covers the business day that starts at the changeover on that date.** The
   till resolves "now" by business day, not by calendar date.
4. **A clock that cannot be read** (no valid time zone) leaves every menu of every period of the
   department orderable, as today's resolver falls back to the all-day menu. Nothing is refused
   for want of a clock.
5. **Period colours** use the six calendar colours already on special dates
   (`CALENDAR_COLOURS`, `packages/venue-service/src/hours-types.ts`); a new period takes the first
   colour its department has not used, then repeats.
6. **"Open" on a new department.** Provisioning's first department gets the period "Open" with the
   venue's catalogue as its menu, placed 09:00–17:00 Monday to Friday. A department added later
   from the dashboard gets the same, if the venue has a catalogue (`locations.catalogue_id`);
   otherwise it starts with no periods and the Departments page says so.
7. **Until slice 2, the old Hours screen is renamed "Station hours"** and keeps station hours,
   special dates and the calendar. Its department columns go. The new screen is "Opening hours".
8. **The configuration bundle moves to format 3**, since four tables leave it. An export in
   format 2 is refused with `setup.configuration_outdated`, as format 1 was.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited (CLAUDE.md §3). New migrations only; the pull
  request's first line says **"venue reset needed"**.
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it, and
  an expression index is taken out for any generation that rebuilds its table (CLAUDE.md §3).
- Every foreign key and unique index is declared in the TypeScript schema.
- Error codes name the domain concept and are registered in `packages/venue-service/src/errors.ts`.
- Multi-table writes take one `tx: Transaction`; queries on one transaction are awaited in turn.
- Every colour, spacing and radius in new UI reads a `--wt-*` token. A screen does not draw its own
  `<select>`, `<textarea>` or text `<input>`; it uses `wt-combobox`, `wt-input` and the rest.
- A new dashboard dialog or page holding staged input takes a draft scope from
  `leaveCoordinatorFor` and has a `*.unsaved.test.ts`.
- New and changed forms follow `docs/developers/design-system.md` → Forms.
- Strings in English and Spanish, in `packages/venue-service/src/dashboard/strings.ts` (dashboard)
  and the till's strings file (till).
- Coverage stays at 98/98/98/95 in every package touched.
- Comments only for an invariant or a non-obvious why; no history.

## Behaviour this slice removes

Tests pinning these may change, under the commit rule above:

- A department's ordered menu list (`department_menus`), and its writers `setDepartmentMenus`,
  `addDepartmentMenu`.
- The all-day menu, department and zone (`department_all_day_menus`, `zone_all_day_menus`).
- A zone's own menu for a period (`zone_period_menus`, `setZonePeriodMenu`).
- Staff ordering from any department menu at any time; `availableMenuIds` being the whole list.
- Department opening hours (`hours_week_cells` / `special_date_hours` rows with a `department_id`)
  and the Hours screen's department columns.
- Slots that run past midnight into the next calendar day's slots, and the neighbouring-day overlap
  checks (`tailOverlaps`, `firstMenuClash`, `assertBesideNeighbours`); the business day replaces
  them.
- Readiness `zone.menu_missing` ("needs a default menu").
- The Menu timetable screen and its routes for menus, all-day menus and zone period menus.

## Review focus

The five conditions most likely to bite a person that no single task's happy path exercises. Each
has its test in the task named.

1. **A period running past midnight.** Night is 21:00–03:00 on Friday; an order at 02:30 on
   Saturday morning is Friday's Night, not Saturday's (Task 1 and Task 4).
2. **A boundary minute.** Lunch 12:00–14:00 then Afternoon 14:00–19:00: at exactly 14:00 it is
   Afternoon; at 13:59 it is Lunch (Task 1).
3. **The 30-minute allowance.** A Lunch item sent at 14:20 is accepted; at 14:31 it is refused with
   `menu_period.not_running`; an item already stored on the order is never re-checked (Task 6).
4. **No period at all.** A department with no slots today: the till shows that the department is
   closed and the server refuses any new line with `menu_period.not_running` (Tasks 6 and 7).
5. **A special date replacing the week.** A special date with its own ranges replaces that
   business day entirely; a special date with no ranges for this department follows the normal
   week (Task 4).

---

### Task 1: Business-day arithmetic

**Files:**
- Create: `packages/venue-service/src/service-day.ts`
- Test: `packages/venue-service/src/service-day.test.ts`

**Interfaces:**
- Consumes: `venueMomentAt` from `@waitron/reporting` (returns `{ weekday, timeOfDay, businessDay }`
  or `null`; read `packages/reporting/src/business-day.ts` for the weekday convention and use the
  same 0–6 convention as `menu_day_timetables.weekday`).
- Produces:

```ts
export interface ServiceRange { periodId: string; startsAt: string; endsAt: string } // "HH:MM"
export interface ServiceMoment { businessDay: string; weekday: number; minute: number } // minute 0..1439 since the changeover
export const SERVICE_STEP_MINUTES = 15;
export function minuteOfServiceDay(time: string, cutover: string): number;              // 0..1439
export function rangeSpan(range: Pick<ServiceRange, "startsAt" | "endsAt">, cutover: string): { start: number; end: number }; // end in 1..1440
export function parseServiceDay(value: unknown, field: string, cutover: string): ServiceRange[]; // throws menu_timetable.invalid
export function serviceMomentAt(at: Date, clock: { timeZone: string; dayCutover: string }): ServiceMoment | null;
export function rangeInForce(ranges: readonly ServiceRange[], minute: number, cutover: string): ServiceRange | null;
```

- [ ] **Step 1: Write the failing tests** — in `service-day.test.ts`, cover:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { minuteOfServiceDay, parseServiceDay, rangeInForce, rangeSpan, serviceMomentAt } from "./service-day.js";

const P = "00000000-0000-4000-8000-000000000001";
const Q = "00000000-0000-4000-8000-000000000002";

describe("service day", () => {
  it("counts minutes from the changeover", () => {
    expect(minuteOfServiceDay("06:00", "06:00")).toBe(0);
    expect(minuteOfServiceDay("05:45", "06:00")).toBe(1425);
    expect(minuteOfServiceDay("02:30", "06:00")).toBe(1230);
  });
  it("reads an end at the changeover as the end of the day", () => {
    expect(rangeSpan({ startsAt: "21:00", endsAt: "03:00" }, "06:00")).toEqual({ start: 900, end: 1260 });
    expect(rangeSpan({ startsAt: "06:00", endsAt: "06:00" }, "06:00")).toEqual({ start: 0, end: 1440 });
  });
  it("refuses a range that is empty, backwards, off the 15-minute step, or overlapping", () => {
    const bad = [
      [{ periodId: P, startsAt: "12:00", endsAt: "12:00" }],
      [{ periodId: P, startsAt: "14:00", endsAt: "12:00" }],
      [{ periodId: P, startsAt: "12:10", endsAt: "14:00" }],
      [{ periodId: P, startsAt: "12:00", endsAt: "14:00" }, { periodId: Q, startsAt: "13:45", endsAt: "15:00" }],
    ];
    for (const slots of bad) {
      expect(() => parseServiceDay(slots, "slots", "06:00")).toThrow(AppError);
    }
  });
  it("accepts touching ranges and a range crossing midnight", () => {
    expect(
      parseServiceDay(
        [{ periodId: P, startsAt: "12:00", endsAt: "14:00" }, { periodId: Q, startsAt: "14:00", endsAt: "03:00" }],
        "slots",
        "06:00",
      ),
    ).toHaveLength(2);
  });
  it("picks the range in force, end exclusive", () => {
    const day = [
      { periodId: P, startsAt: "12:00", endsAt: "14:00" },
      { periodId: Q, startsAt: "14:00", endsAt: "03:00" },
    ];
    expect(rangeInForce(day, minuteOfServiceDay("13:59", "06:00"), "06:00")?.periodId).toBe(P);
    expect(rangeInForce(day, minuteOfServiceDay("14:00", "06:00"), "06:00")?.periodId).toBe(Q);
    expect(rangeInForce(day, minuteOfServiceDay("02:30", "06:00"), "06:00")?.periodId).toBe(Q);
    expect(rangeInForce(day, minuteOfServiceDay("03:00", "06:00"), "06:00")).toBeNull();
  });
  it("puts 02:30 on Saturday morning in Friday's business day", () => {
    // 2026-10-10 is a Saturday; Europe/Madrid is UTC+2 in October.
    const moment = serviceMomentAt(new Date("2026-10-10T00:30:00Z"), { timeZone: "Europe/Madrid", dayCutover: "06:00" });
    expect(moment?.businessDay).toBe("2026-10-09");
    expect(moment?.minute).toBe(1230);
  });
  it("returns null for a clock it cannot read", () => {
    expect(serviceMomentAt(new Date(), { timeZone: "Not/AZone", dayCutover: "06:00" })).toBeNull();
  });
});
```

Also assert the refusal's code and details: `menu_timetable.invalid` with `{ field: "slots", reason }`
where `reason` is `"empty"`, `"order"`, `"step"` or `"overlap"` (one `expect` per bad case, using
`toMatchObject({ code: "menu_timetable.invalid", details: { reason } })`). Check `AppError`'s shape
in `packages/shared` first and match it. `reason` gains the values `"empty"`, `"order"` and `"step"`;
add them where `menu_timetable.invalid` is declared in `packages/venue-service/src/errors.ts`.

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/service-day.test.ts`. Expected: fails to import `./service-day.js`.

- [ ] **Step 3: Implement** `service-day.ts`. `parseServiceDay` keeps `parseSlots`'s input checks
(`packages/venue-service/src/menu-timetable-rules.ts:47`: array, period id a UUID, `HH:MM`) and
replaces its interval logic with `rangeSpan`; it sorts the result by start. `serviceMomentAt`
calls `venueMomentAt`, takes `businessDay`, derives `weekday` from the business day's date (not
the calendar date), and `minute` from `timeOfDay` via `minuteOfServiceDay`.

- [ ] **Step 4: Run the test and see it pass.** Then `pnpm --filter @waitron/venue-service typecheck`.

- [ ] **Step 5: Commit** — `feat(venue-service): business-day arithmetic for service periods (A366)`.

---

### Task 2: Schema and migrations

**Files:**
- Modify: `packages/venue-service/src/schema/menus.ts`, `packages/venue-service/src/schema/hours.ts`
  (comment at `department_id` only, see Step 5), `packages/venue-service/src/classification.ts`
- Create: `packages/venue-service/drizzle/0032_*.sql`, `0033_*.sql`, `0034_*.sql` and their
  snapshots and journal entries (generated)
- Modify: `packages/venue-service/src/migrations.test.ts` (`TABLES`),
  `packages/venue-service/src/classification.test.ts`, `scripts/schema-constraints.test.ts`,
  `scripts/migration-upgrade.test.ts` (`RESETS`), `packages/venue-service/src/schema/service.test.ts`
  if it names the dropped tables

**Interfaces:**
- Produces (drizzle table objects in `schema/menus.ts`, exported from `schema/index.ts`):
  - `menuPeriods`: `id`, `departmentId`, `name`, `menuId` (now references `catalogues.id`
    directly), `colour` (`calendarColour`, not null, default `"grey"`, CHECK in
    `CALENDAR_COLOURS`).
  - `menuPeriodStaffMenus` (new, table `menu_period_staff_menus`): `periodId`, `departmentId`,
    `menuId`, `displayOrder` (integer, default 0). Primary key `(period_id, menu_id)`; foreign key
    `(period_id, department_id)` → `menu_periods(id, department_id)` on delete cascade; foreign
    key `menu_id` → `catalogues.id`.
  - `menuSlots`: drops the `starts_at <> ends_at` check (Task 1's rule replaces it: "06:00–06:00"
    is the whole day) and adds `menu_slots_step_ck`: minutes of both times in `00, 15, 30, 45`.
  - Removed: `departmentMenus`, `departmentAllDayMenus`, `zoneAllDayMenus`, `zonePeriodMenus`.

Steps, in this order because of the drizzle-kit limits above:

- [ ] **Step 1: Failing test first.** In `migrations.test.ts`, update `TABLES` to the new set
(remove the four, add `menu_period_staff_menus`) and add a case that inserts a period, a staff
menu for it, deletes the period, and expects the staff-menu row gone. Run
`pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`;
expected: fails on the table list.

- [ ] **Step 2: Generation 0032 (add only).** In the schema add `menu_periods.colour` without its
CHECK, and the new `menu_period_staff_menus` table. Run
`pnpm --filter @waitron/venue-service db:generate`. Read the SQL: it must be `ALTER TABLE ... ADD`
and `CREATE TABLE` only, no rebuild.

- [ ] **Step 3: Generation 0033 (rebuild and drop).** Add the colour CHECK; point
`menu_periods.menu_id` at `catalogues.id` (drop `menu_periods_member_fk`); change `menu_slots`'
checks; remove the four retired tables. Generate again. Before accepting it, list every foreign
key that points at `menu_periods` and `menu_slots` (`grep -n "menu_periods\|menu_slots"
packages/venue-service/src/schema/*.ts`): `menu_slots` → `menu_periods` has no cascade, so the
rebuild fails on a venue holding slots. That is the accepted venue reset: add a `RESETS` entry
for `venue-service/0033_...` in `scripts/migration-upgrade.test.ts` naming the refusal the test
prints, following the `venue-service/0027_retire_zone_menus` entry.

- [ ] **Step 4: Generation 0034 (custom: department hours rows).** Run
`pnpm --filter @waitron/venue-service db:generate:custom` and write the SQL that deletes
department-owned rows from `special_date_hours_periods`, `special_date_hours`,
`hours_week_periods` and `hours_week_cells` (children first unless the foreign keys cascade —
read `schema/hours.ts`). Statement breakpoints as the other custom migrations in the folder.

- [ ] **Step 5: Classification and guards.** In `classification.ts` remove the four tables and
classify `menu_period_staff_menus` as `state`. At `hours_week_cells.department_id` and
`special_date_hours.department_id` add one line: the column is unused from A366 slice 1 and goes
with station hours in slice 4. Update `scripts/schema-constraints.test.ts` (foreign keys, unique
indexes and checks it lists for these tables).

- [ ] **Step 6: Verify by running** —
`pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts`
and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`, then
Step 1's test. Read each run's `Tests` count. The package does not typecheck after this task:
code still names the dropped tables until Tasks 3–5. Say so in the commit body.

- [ ] **Step 7: Commit** — `feat(venue-service): periods carry a colour and staff-only menus; retire department and zone menu tables (A366)`.

---

### Task 3: Period and timetable writers

**Files:**
- Modify: `packages/venue-service/src/menu-timetable.ts`, `menu-timetable-rules.ts`,
  `menu-timetable-types.ts`, `packages/venue-service/src/errors.ts`
- Delete: `packages/venue-service/src/department-menus.ts` and its test
- Modify: `packages/venue-service/src/provisioning.ts`, `packages/venue-service/src/operations.ts`
  (`createDepartment` only, `:152`)
- Test: `menu-timetable.test.ts`, `provisioning.test.ts`, `operations.test.ts` (createDepartment cases)

**Interfaces:**
- Consumes: Task 1's `parseServiceDay`, `ServiceRange`; Task 2's tables.
- Produces:

```ts
export interface MenuPeriodInput { name: string; colour?: CalendarColour; menuId: string; staffMenuIds: readonly string[] }
export async function saveMenuPeriod(tx: Transaction, cfg: TillConfig, departmentId: string, input: MenuPeriodInput): Promise<{ id: string }>;
export async function updateMenuPeriod(tx: Transaction, cfg: TillConfig, periodId: string, input: Partial<MenuPeriodInput>): Promise<void>;
export async function deleteMenuPeriod(tx: Transaction, cfg: TillConfig, periodId: string): Promise<void>; // menu_period.in_use if placed
export async function replaceMenuWeek(tx: Transaction, cfg: TillConfig, departmentId: string, days: unknown, at: Date): Promise<void>;
export async function saveSpecialDateMenus(tx: Transaction, cfg: TillConfig, specialDateId: string, departmentId: string, slots: unknown, at: Date): Promise<void>;
export async function clearSpecialDateMenus(tx: Transaction, cfg: TillConfig, specialDateId: string, departmentId: string, at: Date): Promise<void>;
export async function placeOpenPeriod(tx: Transaction, cfg: TillConfig, departmentId: string, menuId: string): Promise<void>; // "Open", 09:00–17:00 Mon–Fri
```

Rules the tests pin:

- A period's menu and each staff menu must be an active catalogue (`catalogue.not_found`); a staff
  menu may not be the period's own menu or repeat (`menu_period.invalid`, new code, details
  `{ field: "staffMenuIds" }`); the staff menus keep the order given.
- Name trimmed and unique per department (`menu_period.name_taken`, existing).
- `colour` omitted → the first of `CALENDAR_COLOURS` the department's periods do not use, else
  the first.
- `replaceMenuWeek` and `saveSpecialDateMenus` validate each day with `parseServiceDay` using the
  location's `day_cutover` (`readLocationClock`), and refuse a period of another department
  (existing `assertOwnPeriods`). The neighbour checks across midnight go.
- `saveSpecialDateMenus` keeps the clock-skip refusal (`skippedSlot`) for that date.
- `placeOpenPeriod` creates "Open" with the menu and places 09:00–17:00 on the five weekdays,
  using the weekday convention of Task 1.
- Provisioning (`provisioning.ts:36-112`): replace `addDepartmentMenu` and the all-day insert with
  `placeOpenPeriod` when the location has a catalogue.
- `createDepartment` calls `placeOpenPeriod` when the location has a catalogue
  (`locations.catalogue_id`), otherwise nothing.

- [ ] **Step 1: Write the failing tests** for each rule above, in the files listed, using the
`useVenueDb` setup in `menu-timetable.test.ts:65-80`. Read the stored rows directly with drizzle
(`menuPeriods`, `menuPeriodStaffMenus`, `menuDayTimetables`, `menuSlots`); Task 4 adds the model
reader. For example, the new-department case: call `createDepartment` with the same input its
existing tests use, then select the department's `menu_periods` rows and expect exactly one, named
"Open", whose `menuId` is the location's `catalogue_id`; then select its `menu_slots` joined to
`menu_day_timetables` and expect five rows, one per weekday Monday to Friday, each
`startsAt "09:00"`, `endsAt "17:00"`. A location with no catalogue: expect no period rows.

- [ ] **Step 2: Run them; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/menu-timetable.test.ts src/provisioning.test.ts src/operations.test.ts`.

- [ ] **Step 3: Implement.** Delete `department-menus.ts`; remove `setZonePeriodMenu`,
`assertBesideNeighbours`, `firstMenuClash` and the tail checks; keep the special-date calendar
participant (`MENU_TIMETABLE_CALENDAR_PARTICIPANT`) working for copy, move and delete.

- [ ] **Step 4: Run the tests; see them pass.**

- [ ] **Step 5: Commit** — `feat(venue-service): periods with a customer menu and staff-only menus, placed by business day (A366)`.

---

### Task 4: The resolver, the offers and readiness

**Files:**
- Modify: `packages/venue-service/src/menu-timetable.ts` (resolver and model reader),
  `packages/venue-service/src/operations.ts` (`allDayMenuId :84`, `listVenueReadiness :340`,
  `configureZone :421`, `zoneMenuIdsByZone :727`, `zoneMenuIds :747`, `zoneLiveDocuments :766`,
  `listZoneOffers :789`, `menuState :830`, `recordWorkingLineContexts :1098`),
  `packages/venue-service/src/service.ts`, `packages/module/src/module.ts` (`:498`, `:511`),
  `packages/venue-service/src/routes.ts` (`:934-1062`)
- Test: `menu-timetable.test.ts`, `operations.test.ts`, `menu-timetable-routes.test.ts`, `service.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:

```ts
export interface DepartmentService {
  departmentId: string;
  open: boolean;                  // a period is running (always true when the clock cannot be read)
  periodId: string | null;
  customerMenuId: string | null;
  staffMenuIds: readonly string[];
  orderableMenuIds: readonly string[]; // customer first, then staff, in order; every period's menus when the clock cannot be read
  previous: { periodId: string; orderableMenuIds: readonly string[]; endedMinutesAgo: number } | null; // the period that ended most recently today, for Task 6
}
export async function resolveDepartmentService(tx: Transaction, cfg: TillConfig, departmentId: string, at: Date): Promise<DepartmentService>;
export async function readOpeningHoursModel(tx: Transaction, cfg: TillConfig, at: Date): Promise<OpeningHoursModel>;
```

`OpeningHoursModel` (in `menu-timetable-types.ts`):

```ts
export interface OpeningHoursModel {
  dayCutover: string;
  menus: readonly { id: string; name: string; active: boolean }[];
  specialDates: readonly { id: string; date: string; name: string; colour: CalendarColour }[];
  departments: readonly {
    id: string; name: string; active: boolean;
    periods: readonly { id: string; name: string; colour: CalendarColour; menuId: string; staffMenuIds: readonly string[]; weekdays: readonly number[] }[];
    week: readonly { weekday: number; slots: readonly ServiceRange[] }[]; // all seven
    dates: readonly { specialDateId: string; slots: readonly ServiceRange[] }[]; // only dates with their own ranges
  }[];
}
```

Offer shape change (the cross-package contract): each menu in `ZoneOffers.menus` gains
`audience: "customer" | "staff"`, and `ZoneOffers` gains `service: { open: boolean; periodName: string | null }`.
`listZoneOffers` and `menuState` list the **orderable** menus only, the customer menu marked
`isDefault`. `servedDefault` keeps its job when the customer menu is unpublished.

Routes (replacing `:934-1062`): `GET /management-api/venue-service/opening-hours` →
`readOpeningHoursModel`; `POST .../departments/:departmentId/menu-periods`; `PATCH`/`DELETE
.../menu-periods/:periodId`; `PUT .../departments/:departmentId/menu-week`; `PUT`/`DELETE
.../special-dates/:id/menu-timetables/:departmentId`. The menus, all-day and zone period-menu
routes go; their callers answer 404.

Readiness: `zone.menu_missing` goes; `department.no_periods` (no slot on any weekday) is added per
active department; `zone.menu_unpublished` and `zone.menu_empty` read the department's period
menus instead of `department_menus`.

- [ ] **Step 1: Write the failing tests.** In `menu-timetable.test.ts`, with the location clock
set to `Europe/Madrid`, cutover `06:00`, Lunch 12:00–14:00 (menu L, staff menu D), Afternoon
14:00–19:00 (menu A), Night 21:00–03:00 on Friday (menu N):
  - 13:59 Friday → Lunch, `orderableMenuIds` `[L, D]`; 14:00 → Afternoon `[A]`, `previous` Lunch,
    `endedMinutesAgo` 0; 14:31 → `previous.endedMinutesAgo` 31.
  - 02:30 Saturday → Friday's Night `[N]`.
  - 20:00 Friday → `open: false`, `orderableMenuIds` `[]`.
  - A special date on that Friday with only "Lunch 13:00–16:00" → 12:30 closed, 15:00 Lunch.
  - A special date with no ranges for this department → the normal week.
  - An unreadable time zone → `open: true` and every period's menus.
  In `operations.test.ts`: `listZoneOffers` at 13:59 lists L (customer, default) and D (staff)
  only; at 20:00 lists none with `service.open === false`. Readiness: a department with no slots
  reports `department.no_periods`; one with slots does not.
  In `menu-timetable-routes.test.ts`: each route above answers as specified, and
  `PUT .../departments/:id/menus` answers 404.

- [ ] **Step 2: Run; watch them fail** — the three files with `--project node`.

- [ ] **Step 3: Implement.** `resolveDepartmentService` reads the clock once
(`readLocationClock`), takes `serviceMomentAt`, reads the business day's special-date row for the
department if one exists, else the weekday row, and uses `rangeInForce`. Remove
`resolveZoneMenus`, `allDayMenuId`, `zoneMenuIdsByZone` and the zone-override deletes in
`configureZone`. A zone resolves through its department (`zone_service_policies`).

- [ ] **Step 4: Run; see them pass.** Then `pnpm --filter @waitron/venue-service typecheck` — expected to
pass for the package; `apps/server` still fails until Task 5.

- [ ] **Step 5: Commit** — `feat(venue-service): the till's offers are the current period's menus (A366)`.

---

### Task 5: Fixtures, demo seed and configuration transfer

**Files:**
- Modify: `packages/venue-service/src/testing/zone-menus.ts` (`offerMenuThroughZone`),
  `apps/server/src/testing/zone-offers.ts` (`offerProducts :59`),
  `apps/server/src/testing/clear-provision-fixture.ts :30`,
  `apps/server/scripts/demo-seed/seed-floor.ts :152-209`, `seed-catalogue.ts :111-115`,
  `packages/venue-service/src/configuration-transfer.ts` (`:70-80`, `:125-210`, `:318-445`,
  `:537-568`), `apps/server/src/configuration-transfer.ts` (`:122`, `:159`, `:456-459`)
- Test: `apps/server/scripts/demo-seed/seed.test.ts`, `packages/venue-service/src/configuration-transfer.test.ts`,
  `apps/server/src/configuration-transfer.test.ts`, `apps/server/src/testing-zone-offers.test.ts`

**Interfaces:**
- `offerMenuThroughZone(tx, cfg, zoneId, menuId)` keeps its signature. It ensures the zone's
  department has a period named `"Always"` placed 06:00–06:00 on all seven weekdays (the whole
  business day), makes the menu that period's customer menu if it has none, otherwise adds it as a
  staff menu. So the 75 suites using `offerProducts` keep ordering at any hour.
- The bundle's `version` becomes 3 (decision 8).

- [ ] **Step 1: Failing tests.** `testing-zone-offers.test.ts`: two menus offered through one zone
are both orderable at 03:00 and 15:00. `configuration-transfer.test.ts` (both): an export holds
`menu_periods` with `colour` and `menu_period_staff_menus`, none of the four retired tables, and
round-trips; a format-2 bundle is refused with `setup.configuration_outdated`. `seed.test.ts`:
the demo's Restaurant has "Open" 12:00–01:00 every day and the deli "Open" 09:00–18:00 Monday to
Saturday (translating today's demo hours, `seed-floor.ts:196-209`); no department hours rows.

- [ ] **Step 2: Run; watch them fail.**

- [ ] **Step 3: Implement.** Then run `pnpm --filter @waitron/server typecheck` and
`pnpm --filter @waitron/venue-service typecheck`: both pass.

- [ ] **Step 4: Run the suites most likely to break** — `pnpm --filter @waitron/server test:coverage`
in the background with headroom checked first (`memory_pressure | grep free`), and the listed
venue-service files. Fix fixtures only; a failing assertion outside "Behaviour this slice removes"
is a STOP.

- [ ] **Step 5: Commit** — `test: fixtures, demo seed and configuration transfer follow periods (A366)`.

---

### Task 6: The server refuses items outside the current period

**Files:**
- Modify: `apps/server/src/working-order.ts` (`readBasketOffers :347`, `priceOrderLines :399-466`),
  `apps/server/src/order-drafts.ts :767`, `packages/venue-service/src/errors.ts`
- Test: `apps/server/src/working-order.test.ts`, `apps/server/src/till-api.menu-timetable.test.ts`
  (rename to `till-api.service-periods.test.ts`)

**Interfaces:**
- Consumes: Task 4's `DepartmentService.previous`.
- Produces: `PERIOD_GRACE_MINUTES = 30` (in `packages/venue-service/src/service-day.ts`); error
  `menu_period.not_running` with details `{ departmentId, menuId }`, registered in
  `packages/venue-service/src/errors.ts`. It is a refusal, not a recorded incident, so it needs no
  alert wording.

Rule: a **new** line is accepted when its menu is in `orderableMenuIds`, or in
`previous.orderableMenuIds` with `previous.endedMinutesAgo <= PERIOD_GRACE_MINUTES`. Stored lines
are not re-checked. `service_zone.offer_not_allowed` stays for an item on no menu of the
department's periods at all.

- [ ] **Step 1: Failing tests** in `till-api.service-periods.test.ts`, through the real routes with
a fixed clock (`vi.setSystemTime`, as the existing timetable test does): Lunch item at 13:50 →
accepted; same item sent at 14:20 → accepted; at 14:31 → refused `menu_period.not_running`; a
Lunch line stored at 13:50 survives an unrelated edit to the order at 15:00; at 20:00 with no
period → any new line refused `menu_period.not_running`; an item on no period's menu →
`service_zone.offer_not_allowed`.

- [ ] **Step 2: Run; watch them fail.** `pnpm --filter @waitron/server exec vitest run src/till-api.service-periods.test.ts`.

- [ ] **Step 3: Implement** in `readBasketOffers`/`priceOrderLines`: read the department service
once per request, and check only the lines this request adds.

- [ ] **Step 4: Run; see them pass;** run `working-order.test.ts` too.

- [ ] **Step 5: Commit** — `feat(server): refuse new items outside the current period, with a 30-minute allowance (A366)`.

---

### Task 7: The till shows the period and when the department is closed

**Files:**
- Modify: `apps/till/src/api/client.ts` (`ZoneOfferCatalogue :378-389`, `MenuStateAnswer :402`),
  `apps/till/src/till-app.ts` (`#onMenuState :2921`, `#followDefault :2946`),
  `apps/till/src/state/menu-filter.ts :50`, `apps/till/src/screens/till-counter-screen.ts :247`,
  `apps/till/src/screens/till-table-order-screen.ts :2795`, the till's strings file
- Test: the matching `*.test.ts` beside each, plus an `*.a11y.test.ts` case for the closed notice

**Behaviour:**
- The menu switcher lists the orderable menus, customer menu first.
- When `service.open` is false: the order screen shows a notice "{department} is closed: no period
  is running" in place of the menu, and the add buttons are not offered. The basket's existing
  items stay and can still be sent within the allowance.
- When the polled menu state changes period (for example Lunch → Afternoon), the till follows the
  new default as `#followDefault` does today (only with an empty basket and no menu picked by
  hand); a menu that is no longer orderable is replaced by the new default even with a basket,
  and the basket is kept.
- A refusal `menu_period.not_running` is shown as one sentence naming the menu.

- [ ] **Step 1: Failing tests** for each bullet, in the browser project.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/till exec vitest run <files>`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass.** Open the order screen in both themes and at phone width and look.
- [ ] **Step 5: Commit** — `feat(till): show the running period and a closed department (A366)`.

---

### Task 8: Department hours leave the Hours screen

**Files:**
- Modify: `packages/venue-service/src/hours.ts` (`keyOf :59`, `ownerOf :64`, `subjectOfRow :70`,
  `requireSubjects :81`, `replaceWeekHours :246`, `scheduledSubjects :432`,
  `weekIntervalsBySubject :450`, `saveSpecialDate :742`, `duplicateSpecialDate :897`,
  `resolveSubjects :945`, `resolveOpeningDateHours :1021`, `readRange :1040`, `calendarDays :1154`),
  `hours-rules.ts :159`, `hours-types.ts :27`, `index.ts :40-46`,
  `packages/venue-service/src/dashboard/hours-screen.ts`, `hours-view.ts`, `hours-client.ts`,
  `index.ts` (label), `strings.ts` (`nav.hours`), `apps/dashboard/src/navigation.ts :10`
- Test: `hours.test.ts`, `hours-routes.test.ts`, `dashboard/hours-screen*.test.ts`,
  `dashboard/hours-calendar.test.ts`, `apps/dashboard/src/navigation.test.ts`

**Behaviour:** subjects are stations only; a request naming a department subject is refused
(`management.request_invalid`, field `subject`); `resolveOpeningDateHours` is deleted; the
calendar's Closed tone means "no active department has a period that business day" (read through
Task 4's model); the nav label is "Station hours" / "Horario de estaciones"; the URL's
`department` parameter goes.

- [ ] Steps 1–5 as above: failing tests for each behaviour, watch them fail, implement, pass,
commit `feat(venue-service): the Hours screen keeps stations only (A366)`.

---

### Task 9: The grid component

**Files:**
- Create: `packages/venue-service/src/dashboard/service-grid.ts` (element `service-grid`)
- Test: `service-grid.test.ts`, `service-grid.a11y.test.ts`

**Interfaces:**

```ts
export interface GridColumn { key: string; label: string; slots: readonly ServiceRange[]; periods: readonly GridPeriod[]; editable: boolean }
export interface GridPeriod { id: string; name: string; colour: CalendarColour }
// properties: columns: GridColumn[]; dayCutover: string; readOnly: boolean
// events (bubbles, composed; app-owned so plain names):
//   "grid-range-select"  detail { columnKey, startsAt, endsAt }      — a drag (or keyboard selection) finished
//   "grid-block-change"  detail { columnKey, index, startsAt, endsAt } — a block's edge was dragged
//   "grid-block-open"    detail { columnKey, index }                  — a block was clicked or Enter pressed on it
```

**Behaviour:**
- Rows are 15-minute steps from the changeover to the next changeover; hour labels on the left.
- A block is drawn per slot in its period's colour (`--wt-color-palette-*` and
  `--wt-color-on-palette-*`), labelled with the period's name.
- Pointer: press on an empty step and drag down → a dashed selection; release → `grid-range-select`.
  Dragging a block's bottom edge → `grid-block-change`. Selections snap to 15 minutes and stop at
  a neighbouring block.
- Keyboard: every column is reachable; arrow keys move a focus cell; Shift+arrows extend a
  selection; Enter on a selection emits `grid-range-select`; Enter on a block emits
  `grid-block-open`. A visible "Add a time range" button beside the grid does the same through
  a dialog (Task 11), so nothing needs a pointer.
- `readOnly` draws only.

- [ ] Step 1: failing tests (browser project): rendering positions for "21:00–03:00" with cutover
06:00; a simulated pointer drag from 12:00 to 14:00 emits `{ startsAt: "12:00", endsAt: "14:00" }`;
a drag across an existing block stops at it; keyboard selection emits the same event; tokens paint
the block (read the computed style); axe passes for empty, filled and selected states in both
themes.
- [ ] Steps 2–5: watch them fail, implement, pass, commit
`feat(venue-service): a day grid for service periods (A366)`.

---

### Task 10: Opening hours screen — shell, client, Periods tab

**Files:**
- Create: `packages/venue-service/src/dashboard/opening-hours-screen.ts`,
  `opening-hours-client.ts`, `period-editor.ts`
- Modify: `packages/venue-service/src/dashboard/index.ts` (register `opening-hours`, group
  `operations`, order 15; move Station hours to order 16; remove `menu-timetable`),
  `live-queries.ts` (`opening-hours`: `menu_periods`, `menu_period_staff_menus`,
  `menu_day_timetables`, `menu_slots`, `special_dates`, `departments`, `catalogues`, `locations`;
  remove `menu-timetable`), `strings.ts`, `apps/dashboard/src/navigation.ts`
- Delete: `menu-timetable-screen.ts`, `menu-timetable-client.ts`, `menu-slot-editor.ts` and their tests
- Test: `opening-hours-screen.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`,
  `opening-hours-client.test.ts`, `period-editor.test.ts`, `index.test.ts`, `live-queries.test.ts`,
  `apps/dashboard/src/navigation.test.ts`

**Behaviour:**
- Tabs Week, Periods, Day (`wt-tabs`); the URL holds `view` and `department`
  (`UrlStateController`, as `menu-timetable-screen.ts:330-342`).
- Periods: a department picker (`wt-combobox`) and a `wt-data-table`: colour swatch and name; the
  customer menu; staff-only menus; days placed (from `weekdays`); a `wt-row-actions` column keyed
  `actions`, pinned end, with Edit and Delete. "Add a period" button.
- The period dialog (`period-editor.ts`, `wt-modal`): name (required), colour (`wt-combobox` over
  `CALENDAR_COLOURS`, as the special-date colour at `hours-screen.ts:1164`), menu (required),
  staff-only menus (multi-choice; the customer menu is not offered). Refusals are shown beside the
  field they name. Draft scope via `leaveCoordinatorFor`.
- Delete refuses with `menu_period.in_use` shown as one sentence naming where it is placed.

- [ ] Steps 1–5: failing tests (screen renders the model's periods; creating, editing, deleting
call the client and refresh; a refusal lands under its field; unsaved dialog asks before closing;
axe in both themes), watch fail, implement, pass, look at it in both themes and at phone width,
commit `feat(venue-service): Opening hours screen with periods (A366)`.

---

### Task 11: Opening hours — Week tab

**Files:**
- Modify: `opening-hours-screen.ts`; create `range-dialog.ts`
- Test: `opening-hours-screen.test.ts`, `.unsaved.test.ts`, `range-dialog.test.ts`

**Behaviour:**
- A switch "Normal week" / "Special date" with a special-date picker (dates from the model; a link
  "Add special dates in Station hours" until slice 2).
- The department's week (or the date) drawn with `service-grid`: seven columns Monday to Sunday
  for the normal week, one column for a date.
- `grid-range-select` opens `range-dialog`: the range's times (editable, 15-minute steps, a
  `wt-input type="time"` pair), and a period choice listing the department's periods plus "New
  period…" (opens Task 10's dialog and returns to this one). Saving adds the range to the staged
  day. `grid-block-open` opens the same dialog for that block, with Delete.
- Each day header has a `wt-row-actions` menu: "Copy this day to…" (a dialog of weekday checkboxes)
  and "Clear".
- Changes are staged for the whole week and saved with one "Save" (`PUT .../menu-week`) or, for a
  date, `PUT`/`DELETE .../special-dates/:id/menu-timetables/:departmentId`. A refusal is shown on
  the day it names. Draft scope via `leaveCoordinatorFor`; leaving with staged changes asks.

- [ ] Steps 1–5: failing tests for each bullet, watch fail, implement, pass, look in both themes
and at phone width, commit `feat(venue-service): edit a department's week of periods (A366)`.

---

### Task 12: Opening hours — Day tab, and the Departments page

**Files:**
- Modify: `opening-hours-screen.ts`; `packages/venue-service/src/dashboard/venue-operations-screen.ts`
  (`openHoursPage :50`, `menuTimetablePath :54`, readiness link `:1100-1108`,
  `#readinessMessage :966`), `strings.ts` (`venue.readiness.*`)
- Test: `opening-hours-screen.test.ts`, `venue-operations-screen.test.ts`

**Behaviour:**
- Day: one date with ‹ › (from today's business day); one `service-grid` column per active
  department, editable, staging and saving that department's day as the Week tab does (for a
  special date, the date's ranges; otherwise the weekday's, with a note that it changes every such
  weekday).
- Departments page: the department row's "Hours" action and the readiness link open
  `/manage/opening-hours?department=<id>`; `department.no_periods` reads "Has no opening periods"
  with that link; the `zone.menu_missing` message and link go.

- [ ] Steps 1–5 as above; commit `feat(venue-service): Opening hours day view; Departments links to it (A366)`.

---

### Task 13: Setup shows the first hours; documentation; backlog

**Files:**
- Modify: the setup flow's final summary (find it: `grep -rn "summary" apps/setup/src | head`),
  `docs/developers/design-system.md :2663`, `docs/developers/public-holidays.md :4`,
  `docs/backlog.md` (A366: slice 1 built; S11 untouched), the spec's dated note if any claim moved
- Test: the setup summary's test

**Behaviour:** the summary shows "Opening hours: Monday to Friday, 09:00–17:00" and a link to
Opening hours, when provisioning placed the Open period.

- [ ] Steps 1–5 as above; commit `feat(setup): show the first opening hours (A366)`; then the docs
commit `docs: Opening hours replaces the menu timetable and department hours (A366)`.

---

## After the last task

Run `/finish-branch` with this worktree and this plan. Its pull request's first line:
**"venue reset needed"**.

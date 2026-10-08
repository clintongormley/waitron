# Service periods, slice 1 — implementation plan (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this slice removes"), and only in a separate commit
> whose message begins `Changed test checks (A366 slice 1):` and lists each `file:line` with its
> before and after. Any other assertion that turns out to need changing is a STOP: report it, do
> not edit it. Adding fixture rows, or a key to a whole-shape pin, is allowed.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer
> past about 150 calls with the task unfinished stops at a passing or cleanly red point,
> commits, and returns a handover: done, left, files, each check's state.
>
> **Revised 2026-10-07** after a fresh-context review against the spec and the code. Every
> `file:line` below was read at `main` `94e894044`.

**Goal:** a department's opening hours and its menu timetable become one thing. A period is a
name, a colour, one menu customers see and any number of staff-only menus; each day of the
normal week, and each special date, is a set of time ranges each assigned a period; the till
can order only from the current period's menus, and nothing when no period runs.

**Architecture:** reuse the W98 timetable tables (`menu_periods`, `menu_day_timetables`,
`menu_slots`), add a colour and a staff-menu table first, move every reader and writer onto
periods, and only then drop the four tables this design retires (`department_menus`,
`department_all_day_menus`, `zone_all_day_menus`, `zone_period_menus`). A pure module
(`service-day.ts`) owns the business-day arithmetic. A resolver answers "which period, which
menus, at this moment" for a department. The till's offers list every menu of the department's
periods, each marked orderable or not, so pricing and the till's basket never lose a line's
menu; the server checks only lines a request adds. The dashboard gets an Opening hours screen
(Week, Periods, Day) on one new grid component; the Menu timetable screen goes, and the Hours
screen keeps stations, special dates and the calendar until slice 2.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§§3, 4, 5 (all but the manager's extension), 9.2 (Week for one department, Periods, Day), 12 and
13 item 1. Backlog: A366.

**Risk path:** FULL ceremony: a migration, and a changed cross-package contract (the till's offers
and menu-state answers).

## Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan.

1. **Items added before a period ended can be sent at any time after it** (owner, 2026-10-07: the
   kitchen should see what is left to cook). The till's basket stays on the till until it is sent,
   so the server cannot know when an item was added: it accepts a new line whose menu belongs to
   the current period or to any period that has already ended this business day or ran on the one
   before, and refuses a menu whose period has not started yet, or anything when no period has
   run. The till offers no new items from a period that has ended. Lines already stored are never
   re-checked.
2. **Asking for more of a stored line after its period has ended is refused** (owner, 2026-10-07),
   until slice 3's manager extension can keep the period open. Raising a stored line's quantity
   is checked against the current period only. Any other edit of a stored line is not checked.
3. **A slot stores clock times read inside the business day.** `starts_at` and `ends_at` stay
   `HH:MM`. A time earlier than the changeover belongs to the next calendar morning, so with a
   06:00 changeover "21:00–03:00" is one range; an end equal to the changeover is the end of the
   business day, so "06:00–06:00" is the whole day. Times are in 15-minute steps.
4. **A special date covers the business day that starts at the changeover on that date.** A
   department with a row for the date and no ranges is **closed** that day; no row follows the
   normal week. A date marked "Close the whole venue" closes every department.
5. **A clock that cannot be read** leaves every menu of every period of the department orderable.
6. **Period colours** use the six calendar colours already on special dates (`CALENDAR_COLOURS`,
   `packages/venue-service/src/hours-types.ts:43`); a new period takes the first its department
   has not used, then repeats.
7. **"Open" on a new department.** Provisioning's first department gets "Open" with the venue's
   catalogue as its menu, 09:00–17:00 Monday to Friday, only when the department has no periods
   (provisioning may run again). A department added from the dashboard gets the same when the
   location has a catalogue, otherwise no periods.
8. **The demo venue's Restaurant is open 09:00–24:00 every day** (one "Open" period, stored as
   `09:00`–`00:00`; owner, 2026-10-07); the deli keeps today's demo hours, 09:00–18:00 Monday to
   Saturday, as "Open".
9. **On the Day tab, editing a date that is not a special date edits that weekday** (owner
   approved 2026-10-07) of the normal
   week, with a note saying so. Spec §9.2 says the Day view is editable; one-off dates arrive with
   named days in slice 2.
10. **Until slice 2, the old Hours screen is named "Station hours"** and keeps station hours,
    special dates and the calendar. Its department columns go.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited. New migrations only; the pull request's first line
  says **"venue reset needed"**.
- No data-migration code before go-live (CLAUDE.md §3): a migration changes the schema; old rows
  are left to the reset.
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it, and an
  expression index is taken out for any generation that rebuilds its table.
- Every foreign key and unique index is declared in the TypeScript schema.
- Error codes name the domain concept and are registered in `packages/venue-service/src/errors.ts`.
  `AppError` carries `code` and `params` (`packages/shared/src/errors.ts:59`).
- venue-service functions take `cfg: VenueScope` (as `menu-timetable.ts:366`).
- Multi-table writes take one `tx: Transaction`; queries on one transaction are awaited in turn.
- New UI reads `--wt-*` tokens only; a screen does not draw its own `<select>`, `<textarea>` or text
  `<input>`; forms follow `docs/developers/design-system.md` → Forms; a dialog or page holding
  staged input takes a draft scope from `leaveCoordinatorFor` and has a `*.unsaved.test.ts`.
- Strings in English and Spanish.
- Coverage stays at 98/98/98/95 in every package touched.
- Comments only for an invariant or a non-obvious why; no history.

## Behaviour this slice removes

Tests pinning these may change, under the commit rule above:

- A department's ordered menu list (`department_menus`) and its writers `setDepartmentMenus`,
  `addDepartmentMenu`; the all-day menu, department and zone; a zone's own menu for a period.
- Staff ordering from any department menu at any time; `availableMenuIds` being the whole list;
  the zone-override precedence in `resolveZoneMenus` (`menu-timetable.ts:240`).
- A special-date row with no slots meaning "the all-day menu all day"
  (`docs/developers/conventions-data.md:431-434`); it now means closed.
- A whole-venue closure leaving menus offered (`menu-timetable-rules.ts:133`, documented at
  `conventions-data.md:437-439`).
- Slots resolved by calendar date with yesterday's overnight part, and the cross-midnight checks:
  `parseMenuWeek`'s Sunday-to-Monday tail check (`menu-timetable-rules.ts:98-100`),
  `firstMenuClash` (`:135`), `assertBesideNeighbours` (`menu-timetable.ts:175`).
- Department opening hours (rows with a `department_id` in `hours_week_cells` and
  `special_date_hours`) and the Hours screen's department columns.
- Readiness `zone.menu_missing`.
- The Menu timetable screen and its menus, all-day and zone period-menu routes
  (`routes.ts:934-1075`).

## Review focus

The five conditions most likely to bite a person that no single task's happy path exercises. Each
has its test in the task named.

1. **A period running past midnight.** Night 21:00–03:00 on Friday: an order at 02:30 on Saturday
   morning is Friday's Night (Tasks 1 and 4).
2. **A boundary minute.** Lunch 12:00–14:00 then Afternoon 14:00–19:00: 14:00 is Afternoon; 13:59
   is Lunch (Task 1).
3. **After a period ends.** A Lunch item left in the basket and sent at 17:00 is accepted; a
   Dinner item sent during Lunch is refused with `menu_period.not_running`; raising a stored Lunch
   line's quantity at 14:05 is refused the same way; the till's basket keeps a Lunch line after
   the period changes (Tasks 8 and 9).
4. **No period at all.** A department with nothing running: the till says it is closed and the
   server refuses any new line (Tasks 8 and 9).
5. **A special date.** A row with ranges replaces that business day; a row with no ranges closes
   the department; no row follows the week; "Close the whole venue" closes everyone (Task 4).

---

### Task 1: Business-day arithmetic

**Files:**
- Create: `packages/venue-service/src/service-day.ts`, `service-day.test.ts`
- Modify: `packages/venue-service/src/errors.ts` (the `menu_timetable.invalid` params)

**Interfaces:**
- Consumes: `venueMomentAt` from `@waitron/reporting` (`packages/reporting/src/business-day.ts:200`,
  returns `{ weekday, timeOfDay, businessDay }` or `null`). Use the weekday convention of
  `menu_day_timetables.weekday`; check it against `venueMomentAt`'s.
- Produces:

```ts
export interface ServiceRange { periodId: string; startsAt: string; endsAt: string } // "HH:MM"
export interface ServiceMoment { businessDay: string; weekday: number; minute: number } // minute since the changeover, 0..1439; weekday of the business day
export const SERVICE_STEP_MINUTES = 15;
export function minuteOfServiceDay(time: string, cutover: string): number;
export function rangeSpan(range: Pick<ServiceRange, "startsAt" | "endsAt">, cutover: string): { start: number; end: number }; // end 1..1440
export function parseServiceDay(value: unknown, field: string, cutover: string): ServiceRange[];
export function serviceMomentAt(at: Date, clock: { timeZone: string; dayCutover: string }): ServiceMoment | null;
export function rangeInForce(ranges: readonly ServiceRange[], minute: number, cutover: string): ServiceRange | null;
export function calendarDateOfTime(businessDay: string, time: string, cutover: string): string; // the calendar date a clock time on that business day falls on
```

- [ ] **Step 1: Write the failing tests:**

```ts
import { describe, expect, it } from "vitest";
import {
  calendarDateOfTime, minuteOfServiceDay, parseServiceDay, rangeInForce, rangeSpan, serviceMomentAt,
} from "./service-day.js";

const P = "00000000-0000-4000-8000-000000000001";
const Q = "00000000-0000-4000-8000-000000000002";
const refusal = (slots: unknown) => {
  try { parseServiceDay(slots, "slots", "06:00"); } catch (error) { return error; }
  throw new Error("expected a refusal");
};

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
  it.each([
    ["empty", [{ periodId: P, startsAt: "12:00", endsAt: "12:00" }]],
    ["order", [{ periodId: P, startsAt: "14:00", endsAt: "12:00" }]],
    ["step", [{ periodId: P, startsAt: "12:10", endsAt: "14:00" }]],
    ["overlap", [{ periodId: P, startsAt: "12:00", endsAt: "14:00" }, { periodId: Q, startsAt: "13:45", endsAt: "15:00" }]],
  ])("refuses a %s range", (reason, slots) => {
    expect(refusal(slots)).toMatchObject({ code: "menu_timetable.invalid", params: { field: "slots", reason } });
  });
  it("accepts touching ranges and a range crossing midnight", () => {
    const day = [
      { periodId: P, startsAt: "12:00", endsAt: "14:00" },
      { periodId: Q, startsAt: "14:00", endsAt: "03:00" },
    ];
    expect(parseServiceDay(day, "slots", "06:00")).toHaveLength(2);
  });
  it("picks the range in force, end exclusive", () => {
    const day = [
      { periodId: P, startsAt: "12:00", endsAt: "14:00" },
      { periodId: Q, startsAt: "14:00", endsAt: "03:00" },
    ];
    const at = (time: string) => rangeInForce(day, minuteOfServiceDay(time, "06:00"), "06:00")?.periodId ?? null;
    expect(at("13:59")).toBe(P);
    expect(at("14:00")).toBe(Q);
    expect(at("02:30")).toBe(Q);
    expect(at("03:00")).toBeNull();
  });
  it("puts 02:30 on Saturday morning in Friday's business day", () => {
    // 2026-10-10 is a Saturday; Europe/Madrid is UTC+2 in October.
    const moment = serviceMomentAt(new Date("2026-10-10T00:30:00Z"), { timeZone: "Europe/Madrid", dayCutover: "06:00" });
    expect(moment).toMatchObject({ businessDay: "2026-10-09", minute: 1230 });
  });
  it("returns null for a clock it cannot read", () => {
    expect(serviceMomentAt(new Date(), { timeZone: "Not/AZone", dayCutover: "06:00" })).toBeNull();
  });
  it("places a time before the changeover on the next calendar date", () => {
    expect(calendarDateOfTime("2026-03-28", "02:30", "06:00")).toBe("2026-03-29");
    expect(calendarDateOfTime("2026-03-28", "21:00", "06:00")).toBe("2026-03-28");
  });
});
```

Add `"empty" | "order" | "step"` to the `reason` union of `menu_timetable.invalid` in `errors.ts`
(`:49-54`; `date`, `departmentId` and `reason` are already optional there). Change
`invalidTimetable` (`menu-timetable-rules.ts:19-24`), whose `clash` argument today requires all
three together, so `reason` can be passed alone.

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/service-day.test.ts`. Expected: cannot import `./service-day.js`.

- [ ] **Step 3: Implement.** `parseServiceDay` keeps `parseSlots`'s input checks
(`menu-timetable-rules.ts:47`: an array, a UUID period id, `HH:MM` via the regex at `:16`), uses
`rangeSpan` for order and overlap, and returns the ranges sorted by start. `serviceMomentAt` calls
`venueMomentAt`, takes `businessDay`, derives the weekday from the business day's date, and the
minute from `timeOfDay`.

- [ ] **Step 4: Run it and see it pass;** `pnpm --filter @waitron/venue-service typecheck`.

- [ ] **Step 5: Commit** — `feat(venue-service): business-day arithmetic for service periods (A366)`.

---

### Task 2: Migration 0032 — a period's colour and staff-only menus (add only)

**Files:**
- Modify: `packages/venue-service/src/schema/menus.ts`, `packages/venue-service/src/classification.ts`
  (+ its test), `packages/venue-service/src/migrations.test.ts` (`TABLES :33`),
  `scripts/schema-constraints.test.ts`
- Create (generated): `packages/venue-service/drizzle/0032_*.sql`, `meta/0032_snapshot.json`,
  journal entry

**Interfaces — produces:**
- `menuPeriods.colour`: `enumType(CALENDAR_COLOURS)` column `colour`, not null, default `"grey"`,
  **no CHECK yet** (Task 7 adds it in a rebuild).
- `menuPeriodStaffMenus` (table `menu_period_staff_menus`): `periodId`, `departmentId`, `menuId`,
  `displayOrder` (integer, default 0); primary key `(period_id, menu_id)`; foreign key
  `(period_id, department_id)` → `menu_periods(id, department_id)` on delete cascade; foreign key
  `menu_id` → `catalogues.id`. Exported from `schema/index.ts`.

- [ ] **Step 1: Failing test.** In `migrations.test.ts` add `menu_period_staff_menus` to `TABLES`
and a case: insert a department, a catalogue, a period, a staff menu for it; delete the period;
expect the staff-menu row gone; expect `menu_periods.colour` to read `"grey"` for a row inserted
without one. Run `pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`; expected: fails.

- [ ] **Step 2: Schema, then generate** — `pnpm --filter @waitron/venue-service db:generate`. Read
the SQL: only `ALTER TABLE ... ADD` and `CREATE TABLE`; no table is rebuilt.

- [ ] **Step 3: Classification** — `menu_period_staff_menus` as `state`. Add its key and foreign
keys to `scripts/schema-constraints.test.ts`.

- [ ] **Step 4: Run** Step 1's test and
`pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts`.
Read each run's `Tests` count.

- [ ] **Step 5: Commit** — `feat(venue-service): a period has a colour and staff-only menus (A366)`.

---

### Task 3: Period and timetable writers

**Files:**
- Modify: `packages/venue-service/src/menu-timetable.ts`, `menu-timetable-rules.ts`,
  `menu-timetable-types.ts`, `packages/venue-service/src/provisioning.ts` (`:36-112`),
  `packages/venue-service/src/operations.ts` (`createDepartment :152`)
- Test: `menu-timetable.test.ts`, `provisioning.test.ts`, `operations.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces:

```ts
export interface MenuPeriodInput { name: string; colour?: CalendarColour; menuId: string; staffMenuIds: readonly string[] }
export async function saveMenuPeriod(tx: Transaction, cfg: VenueScope, departmentId: string, input: MenuPeriodInput): Promise<{ id: string }>;
export async function updateMenuPeriod(tx: Transaction, cfg: VenueScope, periodId: string, input: Partial<MenuPeriodInput>): Promise<void>;
export async function deleteMenuPeriod(tx: Transaction, cfg: VenueScope, periodId: string): Promise<void>; // menu_period.in_use when placed
export async function replaceMenuWeek(tx: Transaction, cfg: VenueScope, departmentId: string, days: unknown, at: Date): Promise<void>;
export async function saveSpecialDateMenus(tx: Transaction, cfg: VenueScope, specialDateId: string, departmentId: string, slots: unknown, at: Date): Promise<void>; // [] = closed that day
export async function clearSpecialDateMenus(tx: Transaction, cfg: VenueScope, specialDateId: string, departmentId: string, at: Date): Promise<void>; // follow the week
export async function placeOpenPeriod(tx: Transaction, cfg: VenueScope, departmentId: string, menuId: string): Promise<void>;
```

Rules the tests pin:

- The period's menu and each staff menu must be active catalogues (`catalogue.not_found`); a staff
  menu may not be the period's own menu or repeat (`menu_period.invalid`, new code, params
  `{ field: "staffMenuIds" }`); staff menus keep the given order.
- Names trimmed and unique per department (`menu_period.name_taken`).
- `colour` omitted → the first of `CALENDAR_COLOURS` the department's periods do not use, else the
  first.
- Until Task 7 drops it, `menu_periods.menu_id` still has its foreign key to `department_menus`:
  `saveMenuPeriod` and `updateMenuPeriod` insert the `department_menus` row for each menu they use
  (`onConflictDoNothing`), so the key holds. Task 7 removes those lines.
- `replaceMenuWeek` and `saveSpecialDateMenus` validate each day with `parseServiceDay` using the
  location's `day_cutover` (`readLocationClock`, `packages/reporting/src/business-day.ts:220`) and
  refuse another department's period (existing `assertOwnPeriods`). The cross-midnight neighbour
  checks go (see "Behaviour this slice removes").
- The clock-skip check (`skippedSlot` and `assertPlaced`) checks each endpoint on its calendar
  date: `calendarDateOfTime(date, time, cutover)` for a start; the same for an end, except an
  end exactly equal to the changeover belongs to the next calendar date. A start exactly at the
  changeover belongs to the business date. This also governs copies and moves (owner approved
  2026-10-08).
- `placeOpenPeriod` creates "Open" with the menu and places 09:00–17:00 on Monday to Friday — only
  when the department has no periods.
- Provisioning replaces `addDepartmentMenu` and the all-day insert (`:106-112`) with
  `placeOpenPeriod` when the location has a catalogue; a second provisioning run changes nothing.
- `createDepartment` calls `placeOpenPeriod` when the location has a catalogue
  (`locations.catalogue_id`).

- [ ] **Step 1: Failing tests** for each rule, using the `useVenueDb` setup at
`menu-timetable.test.ts:65-80`, reading stored rows with drizzle. Among them:
  - new department: one period "Open", `menuId` the location's `catalogue_id`, five slots Monday to
    Friday `09:00`–`17:00`; a location with no catalogue: no periods;
  - provisioning run twice: still one "Open" period, five slots;
  - a special date on 2026-03-28 (Europe/Madrid) with 21:00–02:30 is refused with
    `reason: "clock_skips"`; one on 2026-03-29 with 06:00–02:30 is accepted;
  - a week with Sunday 22:00–03:00 and Monday 06:00–10:00 is accepted (no tail clash any more).
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/menu-timetable.test.ts src/provisioning.test.ts src/operations.test.ts`.
- [ ] **Step 3: Implement.** Remove `setZonePeriodMenu`, `assertBesideNeighbours`, `firstMenuClash`
and the tail check. Keep `MENU_TIMETABLE_CALENDAR_PARTICIPANT` (`:688-724`) working.
- [ ] **Step 4: Run; see them pass;** typecheck the package.
- [ ] **Step 5: Commit** — `feat(venue-service): periods with a customer menu and staff-only menus, placed by business day (A366)`.

---

### Task 4: The resolver, the model, the routes and the menu state

**Files:**
- Modify: `packages/venue-service/src/menu-timetable.ts` (resolver, model; remove
  `resolveZoneMenus :240`, rewrite `resolveDefaultMenu :352`), `menu-timetable-types.ts`,
  `packages/venue-service/src/routes.ts` (`:934-1075`), `packages/module/src/module.ts`
  (`ZoneMenuState :261`, `:498`, `:511`), `packages/venue-service/src/service.ts :96-98`,
  `apps/server/src/till-api.ts` (`/api/menu-state :1363-1392`)
- Test: `menu-timetable.test.ts`, `menu-timetable-routes.test.ts`, `apps/server/src/till-api.menu-timetable.test.ts`
  (rename to `till-api.service-periods.test.ts`)

**Interfaces:**

```ts
export interface DepartmentService {
  departmentId: string;
  open: boolean;                       // always true when the clock cannot be read
  periodId: string | null;
  periodName: string | null;
  customerMenuId: string | null;
  orderableMenuIds: readonly string[]; // customer first, then staff, in order; every period's menus when the clock cannot be read
  endedMenuIds: readonly string[]; // menus of every range that has ended this business day or ran on the one before, not already orderable
}
export async function resolveDepartmentService(tx: Transaction, cfg: VenueScope, departmentId: string, at: Date): Promise<DepartmentService>;

export interface OpeningHoursModel {
  dayCutover: string;
  menus: readonly { id: string; name: string; active: boolean; includes: readonly string[] }[]; // includes: names of menus it includes directly
  specialDates: readonly { id: string; date: string; name: string; colour: CalendarColour; closeWholeVenue: boolean }[];
  departments: readonly {
    id: string; name: string; active: boolean;
    periods: readonly { id: string; name: string; colour: CalendarColour; menuId: string; staffMenuIds: readonly string[]; weekdays: readonly number[] }[];
    week: readonly { weekday: number; slots: readonly ServiceRange[] }[]; // all seven
    dates: readonly { specialDateId: string; slots: readonly ServiceRange[] }[]; // every date with a row; [] = closed
  }[];
}
export async function readOpeningHoursModel(tx: Transaction, cfg: VenueScope, at: Date): Promise<OpeningHoursModel>;
```

`includes` comes from the catalogue's inclusion graph (`directIncludedMenus`,
`packages/catalogue/src/menu-inclusion.ts:8`; find how existing callers build its `SectionGraph`
with `grep -rn "directIncludedMenus(" packages apps`).

`ZoneMenuState` gains `service: { open: boolean; periodName: string | null }`; `/api/menu-state`
answers it and the current customer menu as the default, through `resolveDepartmentService`.

Routes: `GET /management-api/venue-service/opening-hours` → `readOpeningHoursModel`; `POST
.../departments/:departmentId/menu-periods` (body `MenuPeriodInput`); `PATCH` and `DELETE
.../menu-periods/:periodId`; `PUT .../departments/:departmentId/menu-week`; `PUT` and `DELETE
.../special-dates/:id/menu-timetables/:departmentId`. Removed: `GET .../menu-timetable`,
`.../departments/:id/menus`, `.../departments/:id/all-day-menu`, `.../zones/:id/all-day-menu`,
`.../zones/:zoneId/period-menus/:periodId`; each answers 404.

- [ ] **Step 1: Failing tests.** In `menu-timetable.test.ts`, with the clock `Europe/Madrid`,
cutover `06:00`, Lunch 12:00–14:00 (menu L, staff menu D), Afternoon 14:00–19:00 (A), Night
21:00–03:00 on Friday (N):
  - Friday 13:59 → Lunch, `[L, D]`; 14:00 → Afternoon `[A]`, with L and D in `endedMenuIds`.
  - Saturday 02:30 → Friday's Night `[N]`. Saturday 06:10 → nothing running, N in `endedMenuIds`
    (it ran on the business day before).
  - Friday 20:00 → `open: false`, `[]`.
  - A special date on that Friday with only Lunch 13:00–16:00 → 12:30 closed, 15:00 Lunch; a row
    with no slots → closed all day; no row → the week; "Close the whole venue" → closed even with
    a row holding slots.
  - An unreadable time zone → `open: true` and every period's menus.
  - `readOpeningHoursModel` lists a menu's `includes`.
  In `menu-timetable-routes.test.ts`: each route answers as specified; the removed ones 404. In
  `till-api.service-periods.test.ts`: `/api/menu-state` at 13:59 answers default L and
  `service.open` true; at 20:00 `service.open` false.
- [ ] **Step 2: Run; watch them fail.**
- [ ] **Step 3: Implement.** The resolver reads the clock once, takes `serviceMomentAt`, and reads
the department's row for the business day's special date when there is one, else the weekday row.
- [ ] **Step 4: Run; see them pass.**
- [ ] **Step 5: Commit** — `feat(venue-service): resolve the running period; Opening hours model and routes (A366)`.

---

### Task 5: Offers, readiness and the zone reader

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`allDayMenuId :84`, `listVenueReadiness
  :340`, `configureZone :421`, `zoneMenuIdsByZone :727`, `zoneMenuIds :747`, `zoneLiveDocuments
  :766`, `listZoneOffers :789`, `menuState :830`, `recordWorkingLineContexts :1098`),
  `packages/venue-service/src/dashboard/live-queries.ts` (`operations :76-78`; `menu-timetable
  :58-72` → `opening-hours`), `live-queries.test.ts`, `packages/venue-service/src/dashboard/client.ts
  :44` (readiness codes)
- Test: `operations.test.ts`, `service.test.ts`, `live-queries.test.ts`

**Interfaces — the offers contract:** `ZoneOffers.menus` lists **every menu of the department's
periods** (so pricing and the till's basket keep any line's menu), each with
`audience: "customer" | "staff"` and `orderable: boolean`; `isDefault` marks the current customer
menu. `ZoneOffers.service` is `{ open: boolean; periodName: string | null }`. With
`withDefault: false` (pricing), static customer/staff period membership may be read; range,
special-date and clock resolution is not read. Every period menu remains present and orderable,
with no default selected. Owner, 2026-10-08 Task 5 ruling (A): update the pricing test to compare
the same membership with no ranges against many ranges, preserve its statement-count assertion,
forbid range/date/clock reads, and add a resolver-in-pricing deletion control. Commit the changed
assertion separately and include its inventory in the pull request.

Readiness: `zone.menu_missing` goes; `department.no_periods` (an active department with no slot on
any weekday) is added; `zone.menu_unpublished` and `zone.menu_empty` read the department's period
menus. `configureZone` stops deleting zone menu rows.

The `opening-hours` live query lists `menu_periods`, `menu_period_staff_menus`,
`menu_day_timetables`, `menu_slots`, `special_dates`, `departments`, `catalogues`, `locations`.
The `operations` query no longer names the four retired tables.

- [ ] **Step 1: Failing tests:** at Friday 13:59 `listZoneOffers` lists L (customer, orderable,
default), D (staff, orderable), A and N (not orderable); at 20:00 `service.open` false and none
orderable; readiness as above; the live-query lists exactly as above.
- [ ] **Step 2: Run; watch them fail.**
- [ ] **Step 3: Implement.** `zoneMenuIds` reads the department's period menus (customer and staff,
distinct).
- [ ] **Step 4: Run; see them pass;** typecheck the package.
- [ ] **Step 5: Commit** — `feat(venue-service): offers mark which menus the current period allows (A366)`.

---

### Task 6: Fixtures, demo seed and configuration transfer

**Files:**
- Modify: `packages/venue-service/src/testing/zone-menus.ts` (`offerMenuThroughZone :14-20`),
  `apps/server/src/testing/zone-offers.ts` (`offerProducts :59`, `:152`),
  `apps/server/src/testing/clear-provision-fixture.ts :30`, `apps/server/src/testing/party-venue.ts`
  (doc comment), `apps/server/scripts/demo-seed/seed-floor.ts` (`:152-209`), `seed-catalogue.ts
  :111-115`, `packages/venue-service/src/configuration-transfer.ts` (`:70-80`, `:125-210`,
  `:318-445`, `:537-568`)
- Raw-SQL fixtures naming the retired tables: `apps/server/src/tabs.test.ts:1009`,
  `till-sale.test.ts:237`, `till-api.sell-published.test.ts:242`, `working-order.test.ts:246`,
  `:1112`; the assertion at `provision.test.ts:205-211`
- Test: `apps/server/scripts/demo-seed/seed.test.ts`, both `configuration-transfer.test.ts`,
  `apps/server/src/testing-zone-offers.test.ts`

**Interfaces:** `offerMenuThroughZone(tx, cfg, zoneId, menuId, { displayOrder?, makeDefault? })`
keeps its signature. It ensures the zone's department has a period `"Always"` placed from the
location's changeover to the next changeover on all seven weekdays; `makeDefault: true` (or a
period with no menu yet) makes the menu the customer menu, otherwise it becomes a staff menu at
`displayOrder`. So the suites using `offerProducts` keep ordering at any hour. The configuration
bundle keeps format 2: the module-version check (`apps/server/src/configuration-transfer.ts:571-575`)
already refuses an older export.

- [x] **Step 1: Failing tests:** `testing-zone-offers.test.ts`: two menus offered through one zone
are both orderable at 03:00 and 15:00. `configuration-transfer.test.ts` (both): an export holds
`menu_periods` with `colour` and `menu_period_staff_menus` and round-trips. `seed.test.ts`:
decision 8's demo hours; no department rows in `hours_week_cells`.
- [x] **Step 2: Run; watch them fail.**
- [x] **Step 3: Implement,** including the raw-SQL fixtures and `provision.test.ts:205-211` (its
change goes in the `Changed test checks` commit). Then
`pnpm --filter @waitron/server typecheck` and `pnpm --filter @waitron/venue-service typecheck`.
- [x] **Step 4: Run** the listed files, then `pnpm --filter @waitron/server test:coverage` in the
background after checking headroom (`memory_pressure | grep free`). Fix fixtures only.
- [x] **Step 5: Commit** — `test: fixtures, demo seed and configuration transfer follow periods (A366)`.

Checkpoint 2026-10-08: server coverage ran 415 files and 9,550 tests, all passing with no skips.
The configuration-transfer and fixture changes have focused checks and independent deletion
controls recorded in the local implementation ledger. Task 7 still owns the legacy schema and
transfer-table retirement; the slice remains unfinished.

---

### Task 7: Migration 0033 — retire the department and zone menu tables

**Files:**
- Modify: `packages/venue-service/src/schema/menus.ts`, `classification.ts` (+ test),
  `migrations.test.ts`, `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`
  (`RESETS :247-253`), `packages/venue-service/src/menu-timetable.ts` (remove Task 3's
  `department_menus` inserts), `packages/venue-service/src/department-transfers.ts:19`,
  `packages/venue-service/src/index.ts:5`
- Delete: `packages/venue-service/src/department-menus.ts` and its test (move `assertDepartment`,
  used by `department-transfers.ts`, into `operations.ts` beside `createDepartment`)
- Create (generated): `drizzle/0033_*.sql`, snapshot, journal entry

**Schema changes, in one generation:** remove `departmentMenus`, `departmentAllDayMenus`,
`zoneAllDayMenus`, `zonePeriodMenus`; `menu_periods.menu_id` references `catalogues.id`
(drop `menu_periods_member_fk`); add the colour CHECK (`menu_periods_colour_ck`, in
`CALENDAR_COLOURS`); on `menu_slots` drop `starts_at <> ends_at` and add `menu_slots_step_ck`
(minutes `00`, `15`, `30` or `45` on both times). No column is added, so the rebuild rule holds.

- [x] **Step 1: Failing test.** `migrations.test.ts`: `TABLES` without the four; a period whose
menu is an active catalogue never listed anywhere else saves; a slot `06:00`–`06:00` saves; a slot
`12:10`–`14:00` inserted directly is refused by the database.
- [x] **Step 2: Generate** — `pnpm --filter @waitron/venue-service db:generate`. Generated `0033_aromatic_slapstick.sql` drops the four retired tables before rebuilding
periods and slots. The upgrade walk refused the second drop, `DROP TABLE department_menus`,
with `FOREIGN KEY constraint failed`; the first drop of `department_all_day_menus` completed.
That measured refusal is recorded under `venue-service/0033_aromatic_slapstick` in `RESETS`
in `scripts/migration-upgrade.test.ts`. No shipped migration is edited.
- [x] **Step 3:** remove the transitional `department_menus` inserts from the writers; delete
`department-menus.ts`; fix the two importers.
- [x] **Step 4: Run** Step 1's test, the guard list from Task 2 Step 4,
`scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts` and
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`; typecheck
venue-service and server.
- [x] **Step 5: Commit** — `feat(venue-service): retire department and zone menu tables (A366) — venue reset needed`.

Checkpoint 2026-10-08: the complete venue-service node project passes after the retained
resolver/model/provisioning checks moved to periods. The named migration guards, venue-service
and server typechecks, server provisioning/transfer checks and unedited fiscal suites pass.
Backend consumers of the removed tables retire here; Task 12 still removes the old browser
client, screen and their types.

---

### Task 8: The server refuses items from a period that has not started, and repeats after one has ended

**Files:**
- Modify: `apps/server/src/working-order.ts` (`readBasketOffers :347`, `priceOrderLines :399-466`,
  `applyLineEdits :4575`, which prices at `:4855`), `apps/server/src/order-drafts.ts :767`,
  `packages/venue-service/src/errors.ts`
- Test: `apps/server/src/till-api.service-periods.test.ts`, `working-order.test.ts`

**Interfaces:** error `menu_period.not_running`, params `{ departmentId, menuId }`, registered in
`packages/venue-service/src/errors.ts` (a refusal, not a recorded incident: no alert wording).

Rule: a line the request adds is accepted when its menu is in `orderableMenuIds` or
`endedMenuIds`. The added quantity of a stored line is accepted only when its menu is in
`orderableMenuIds`. Anything else about stored lines is not checked. An item on no menu of the
department's periods stays `service_zone.offer_not_allowed`.

- [ ] **Step 1: Failing tests** through the real routes with `vi.setSystemTime`: a Lunch item sent
at 13:50 → accepted; sent at 17:00 → accepted; a Dinner item sent at 13:00 →
`menu_period.not_running`; a Lunch line stored at 13:50, quantity raised at 13:55 → accepted, at
14:05 → `menu_period.not_running`; that stored line's note edited at 15:00 → accepted; on a day with
no periods, any new line → `menu_period.not_running`; an item on no period's menu →
`service_zone.offer_not_allowed`.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/till-api.service-periods.test.ts`.
- [ ] **Step 3: Implement:** resolve the department service once per request; check only added
lines and added quantities.
- [ ] **Step 4: Run; see them pass;** run `working-order.test.ts` and `order-drafts.db.test.ts`.
- [ ] **Step 5: Commit** — `feat(server): refuse items from a period that has not started, and repeats after one has ended (A366)`.

---

### Task 9: The till shows the period and a closed department

**Files:**
- Modify: `apps/till/src/api/client.ts` (`ZoneOfferCatalogue :378-389`, `MenuStateAnswer :402`),
  `apps/till/src/till-app.ts` (`#onMenuState :2921`, `#followDefault :2946`, `#refreshBasket
  :2985-3005`), `apps/till/src/menu-filter.ts :50`, `apps/till/src/widgets/menu-switcher.ts`,
  `apps/till/src/screens/till-counter-screen.ts :247`, `till-table-order-screen.ts :2795`, the
  till's strings
- Test: beside each file, browser project, plus an `*.a11y.test.ts` case for the closed notice

**Behaviour:**
- The menu switcher lists orderable menus only, customer menu first.
- With `service.open` false the order screen shows "{department} is closed: no period is running"
  in place of the menu and offers no add buttons; the basket's items stay.
- When the period changes, the basket keeps every line (its menu is still in `menus`); the till
  follows the new default as `#followDefault` does today, and also when the shown menu is no longer
  orderable.
- `menu_period.not_running` shows as one sentence naming the menu.

- [ ] Steps: failing tests for each bullet; watch them fail (`pnpm --filter @waitron/till exec vitest run <files>`);
implement; pass; open the order screen in both themes and at phone width and look; commit
`feat(till): show the running period and a closed department (A366)`.

---

### Task 10: Department hours leave the Hours screen

**Files:**
- Modify: `packages/venue-service/src/hours.ts` (`keyOf :59`, `ownerOf :64`, `subjectOfRow :70`,
  `requireSubjects :81`, `replaceWeekHours :246`, `scheduledSubjects :432`,
  `weekIntervalsBySubject :450`, `saveSpecialDate :742`, `duplicateSpecialDate :897`,
  `resolveSubjects :945`, `resolveOpeningDateHours :1021`, `readRange :1040`, `calendarDays :1154`),
  `hours-rules.ts :159-163`, `hours-types.ts :27`, `index.ts :40-46`,
  `dashboard/hours-screen.ts`, `hours-view.ts`, `hours-client.ts`, `dashboard/index.ts`, `strings.ts`
  (`nav.hours`), `dashboard/hours-dates-list.ts`, `apps/dashboard/src/navigation.ts :10`, `configuration-transfer.ts` `ownerKey
  :70-80`
- Test: `hours.test.ts`, `hours-routes.test.ts`, `dashboard/hours-*.test.ts`,
  `apps/dashboard/src/navigation.test.ts`

**Behaviour:** subjects are stations only; a request naming a department is refused as its
siblings are (`hours.invalid` at `subject.kind`); readers ignore any department rows left in the
tables; `resolveOpeningDateHours` is deleted; the calendar's Closed tone means "no active
department is open that business day" (through `readOpeningHoursModel`); the nav label is "Station
hours" / "Horario de estaciones"; the URL's `department` parameter goes.
Timetable refusals keep their department names in a separate `HoursModel.departments` list of
`{ id, name }`, from the opening-model snapshot used for the calendar. These names do not create
editable columns; `subjects` and all hour cells remain stations only.
The rewritten Hours editors follow A331 (owner, 2026-10-08): `draftScopeFor`,
`saveActionState` and an unchanged-submit early return, with retained baselines and reconnect
cases in `hours-screen.unsaved.test.ts`. Clear/Delete remain confirmations.

- [ ] Steps: failing tests per behaviour; watch them fail; implement; pass; commit
`feat(venue-service): the Hours screen keeps stations only (A366)`.

---

### Task 11: The grid component

**Files:** create `packages/venue-service/src/dashboard/service-grid.ts` (element `service-grid`),
`service-grid.test.ts`, `service-grid.a11y.test.ts`.

**Interfaces:**

```ts
export interface GridPeriod { id: string; name: string; colour: CalendarColour }
export interface GridColumn { key: string; label: string; slots: readonly ServiceRange[]; periods: readonly GridPeriod[]; editable: boolean }
// properties: columns: GridColumn[]; dayCutover: string; readOnly: boolean
// events (bubbles, composed; app-owned, so plain names):
//   "grid-range-select" detail { columnKey, startsAt, endsAt }
//   "grid-block-change" detail { columnKey, index, startsAt, endsAt }
//   "grid-block-open"   detail { columnKey, index }
```

**Behaviour:** rows are 15-minute steps from the changeover to the next; hour labels on the left;
a block per slot in its period's colour (`--wt-color-palette-*`, `--wt-color-on-palette-*`) with its
name. Pointer: drag down from an empty step → dashed selection → `grid-range-select` on release;
drag a block's bottom edge → `grid-block-change`; selections snap to 15 minutes and stop at a
neighbouring block. Keyboard: arrows move a focus cell, Shift+arrows extend, Enter on a selection
emits `grid-range-select`, Enter on a block emits `grid-block-open`. `readOnly` draws only.

- [x] Steps: failing tests (a "21:00–03:00" block's position with cutover 06:00; a pointer drag
12:00→14:00 emits `{ startsAt: "12:00", endsAt: "14:00" }`; a drag across a block stops at it; the
keyboard emits the same; the block's computed colour is the token's; axe for empty, filled and
selected in both themes); watch them fail; implement; pass; commit
`feat(venue-service): a day grid for service periods (A366)`.

---

Task 11 checkpoint: the component and its event payloads pass the focused Chromium suites,
including real mouse selection and resizing, keyboard selection, cancellation and both-theme
axe scans. A changeover between quarter-hours draws short edge fragments but selects clock
quarter-hours only, matching the request parser. Read-only grids retain a keyboard-scrollable
region. Opening hours integration follows in Tasks 12–14.

### Task 12: Opening hours screen — shell, client, Periods tab

**Files:**
- Create: `dashboard/opening-hours-screen.ts`, `opening-hours-client.ts`, `period-editor.ts`
- Modify: `dashboard/index.ts` (register `opening-hours`, group `operations`, order 15; Station
  hours to 16; remove `menu-timetable`, `:53-91`), `strings.ts`, `apps/dashboard/src/navigation.ts`
  (`"opening-hours": { view, department }`; remove `"menu-timetable"`)
- Delete: `dashboard/menu-timetable-screen.ts`, `menu-timetable-client.ts`, `menu-slot-editor.ts`,
  their tests
- Test: `opening-hours-screen.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`,
  `opening-hours-client.test.ts`, `period-editor.test.ts`, `index.test.ts`,
  `apps/dashboard/src/navigation.test.ts`

**Behaviour:** tabs Week, Periods, Day (`wt-tabs`); the URL holds `view` and `department`
(`UrlStateController`, as `menu-timetable-screen.ts:330-342`). Periods: a department `wt-combobox`;
a `wt-data-table` of colour and name, menu with what it includes ("Lunch · includes Desserts,
Drinks"), staff-only menus, days placed, and an `actions` column pinned end (`wt-row-actions`: Edit,
Delete); "Add a period". The dialog (`period-editor.ts`, `wt-modal`): name (required), colour
(`wt-combobox` over `CALENDAR_COLOURS`, as `hours-screen.ts:1164`), menu (required), staff-only
menus (the customer menu not offered); refusals under the field they name; a draft scope.
`menu_period.in_use` shows as one sentence.

- [ ] Steps: failing tests (periods render; create, edit, delete call the client and refresh; a
refusal lands under its field; the unsaved dialog asks; axe in both themes); watch them fail;
implement; pass; look in both themes and at phone width; commit
`feat(venue-service): Opening hours screen with periods (A366)`.

---

### Task 13: Opening hours — Week tab

**Files:** modify `opening-hours-screen.ts`; create `range-dialog.ts`; tests
`opening-hours-screen.test.ts`, `.unsaved.test.ts`, `range-dialog.test.ts`.

**Behaviour:**
- "Normal week" / "Special date" switch with a special-date picker; a link "Add special dates in
  Station hours" until slice 2. A special date's department can be set "Closed all day" (saves `[]`)
  or "Follow the normal week" (`DELETE`).
- `service-grid` with seven columns Monday to Sunday, or one column for a date.
- `grid-range-select` opens `range-dialog`: the two times (`wt-input type="time"`, 15-minute steps)
  and a period choice listing the department's periods plus "New period…" (opens Task 12's dialog,
  then returns). `grid-block-open` opens it for that block, with Delete. `grid-block-change` updates
  the staged day.
- Each day header has `wt-row-actions`: "Copy this day to…" (weekday checkboxes) and "Clear".
- Changes are staged and saved with one "Save" (`PUT .../menu-week`, or the special-date routes); a
  refusal is shown on the day it names; a draft scope; leaving with staged changes asks.

- [ ] Steps: failing tests per bullet; watch them fail; implement; pass; look in both themes and at
phone width; commit `feat(venue-service): edit a department's week of periods (A366)`.

---

### Task 14: Opening hours — Day tab, and the Departments page

**Files:** modify `opening-hours-screen.ts`, `dashboard/venue-operations-screen.ts`
(`openHoursPage :50`, `menuTimetablePath :54`, readiness link `:1100-1108`, `#readinessMessage
:966`), `strings.ts` (`venue.readiness.*`); tests `opening-hours-screen.test.ts`,
`venue-operations-screen.test.ts`.

**Behaviour:** Day: one date with ‹ ›, starting at today's business day; one `service-grid` column
per active department, editable. On a special date it edits the date's ranges; otherwise it edits
that weekday, with the note "Changes every {weekday}" (decision 9). Departments page: the department
row's "Hours" action and the readiness link open `/manage/opening-hours?department=<id>`;
`department.no_periods` reads "Has no opening periods" with that link; `zone.menu_missing` goes.

- [ ] Steps: failing tests per behaviour; watch them fail; implement; pass; commit
`feat(venue-service): Opening hours day view; Departments links to it (A366)`.

---

### Task 15: Setup shows the first hours; documentation; backlog

**Files:** the setup flow's final summary (`grep -rn "summary" apps/setup/src`) and its test;
`docs/developers/conventions-data.md :411-446`, `docs/developers/design-system.md :2663`,
`docs/developers/public-holidays.md :4`, `docs/backlog.md` (A366 slice 1 built).

**Behaviour:** the summary shows "Opening hours: Monday to Friday, 09:00–17:00" with a link to
Opening hours when provisioning placed the "Open" period. The docs describe periods, the business
day, a closed special date and sending items after their period, and retire the all-day menu, zone menus and
department hours (dated pointer where a document is historical).

- [ ] Steps: failing test for the summary; watch it fail; implement; pass; commit
`feat(setup): show the first opening hours (A366)`; then the docs commit
`docs: Opening hours replaces the menu timetable and department hours (A366)`.

---

## After the last task

Run `/finish-branch` with this worktree and this plan. Its pull request's first line:
**"venue reset needed"**.

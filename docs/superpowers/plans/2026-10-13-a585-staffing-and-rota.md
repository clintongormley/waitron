# A585 Staffing needs and the rota — Implementation Plan

> 2026-10-16: A724 changes the staffing painters’ guide contract, bands and season title.
> Use its [Part 1 plan](2026-10-16-a724-staffing-guide-bands.md) for that work; the historical
> A585 steps below retain their original contract. The month’s day-box work stays open.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Staff roles that people hold; how many of each a department or prep station needs, painted
per season weekday and special day; and a rota of slots to fill, by area and by person, with labour
warnings while it is built, all inside a Calendar that also holds opening hours.

**Architecture:** A new module package, `packages/staffing`, owns five tables, the staffing paint,
a browser-safe slot-and-matching library, its routes and its dashboard views. It reaches
`venue-service` (seasons, special days, departments, the painter frame), `workforce` (shifts, rota
versions) and `identity` (people) through their public exports. Two small seams keep the core
generic. The dashboard contract gains `calendarViews`, which the Calendar page renders as extra
tabs. The module contract gains `describeShifts`, which the till and My schedule use to label a
shift.

**Tech Stack:** TypeScript (tsc 7 in packages), Hono routes, drizzle-orm on `node:sqlite` with
drizzle-kit 0.31.11 migrations, Lit web components with the `wt-*` primitives, Vitest 4.1.11 (node
and Playwright Chromium browser projects).

**Spec:** [docs/superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md](../specs/2026-10-13-a585-staffing-and-rota-design.md).
Mockups: [docs/backlog/mockups/a585-staffing/](../../backlog/mockups/a585-staffing/). Read both
before any task.

## Global Constraints

- Every package, this one included from its first commit, holds coverage `98/98/98/95` (statements,
  lines, functions, branches) with `coverage.include: ["src/**/*.ts"]`. Never close a gap with an
  exclude or an ignore comment.
- Screen text is "staff role" / "rol de personal", never bare "role"/"rol". Code identifiers say
  `staffRole`, never `role`.
- Error codes name the domain concept (`staff_role.not_found`, `staffing.invalid`), never the
  package. Every file that throws a code imports `./errors.js`.
- Every dashboard string exists in EN and ES, under keys prefixed `staffing.` (the string catalogue
  is one global object, so a key must not collide with another module's).
- Colours, spacing, radii and fonts read `--wt-*` tokens; no hex, no named colours, no `rem`/`em`.
- Forms follow design-system.md → Forms: required fields marked; field errors beside the field plus
  one localized message above the buttons; a saving form opens quiet and disabled until its draft
  changes (`draftScopeFor` + `saveActionState` + an early return in the save handler); every input
  has a semantic `name`; no screen draws its own `<select>`, `<textarea>` or text `<input>`.
- A `wt-data-table` row-menu column is keyed `actions` and declared `pinned: "end"`.
- A new `wt-*`-style shared primitive needs a token-painting test and a `*.a11y.test.ts`; a screen
  with staged input takes `draftScopeFor` and has a `*.unsaved.test.ts`; every screen has a
  `*.a11y.test.ts` covering each state in both themes.
- One `withTransaction` per request; write-path functions take `tx: Transaction`; queries on one
  transaction are awaited in turn, never `Promise.all`.
- Never build SQL by string concatenation.
- Every foreign key and unique index is declared in the TypeScript schema; a migration is generated
  with `pnpm --filter <pkg> db:generate`, never hand-edited.
- Times on a business day are `HH:MM` strings in 15-minute steps, placed relative to the day's
  changeover (`minuteOfServiceDay`); a range ending at the changeover ends at minute 1440.
- `git commit -s` on every commit. Each part is one branch in its own worktree
  (`python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`) and lands through
  `/finish-branch`.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing (or
  cleanly red) point, commits, and returns a handover: done, left, files, each check's state.
- No data-migration or backwards-compatibility code: Waitron is not live. A part whose migration
  needs it says "venue reset" in its PR's first line.

## Review Focus

1. **A shift that starts after midnight but before the changeover** (Monday 01:00 with a 06:00
   changeover) belongs to Sunday's business day: the rota must show it on Sunday, and the week read
   must include it although its calendar date is Monday. Pinned in Task 2.2 and Task 6.1.
2. **Filling a slot on a clock-change day** (a 02:00 start on the spring-forward date does not exist;
   a 02:30 start on the autumn date exists twice): the server refuses the first with
   `staffing.invalid {field:"startsAt"}` and takes the earlier occurrence for the second. Pinned in
   Task 6.1.
3. **Two managers fill the same slot at once**: both writes succeed, and the rota then shows one
   filled slot and one "over" shift — never an error, never a lost shift. Pinned in Task 6.1.
4. **A location with no labour-rules row** (`convenio.not_found`): the rota still loads, fills and
   publishes; the warnings area shows one notice instead of warnings. Pinned in Task 5.4 and
   Task 7.1.
5. **Deleting what a shift points at**: deleting a department or a station only switches it off
   (`active = false`: `packages/venue-service/src/service-delete.ts:329`,
   `apps/server/src/station-delete.ts:215`), so its staffing rows stay. Its paint must disappear
   from every read, and its shifts must show under "Not in a slot". Deleting a staff role that a
   shift uses is refused as `staff_role.in_use`. Pinned in Task 1.2, Task 2.3 and Task 6.1.

---

## The parts

Each part is one branch and one PR, and lands on its own. "Waits for" is a hard dependency: do not
start a part before what it waits for is on `main`.

| Part | What it delivers | Waits for | Review weight | Venue reset |
| --- | --- | --- | --- | --- |
| **A585-1** | The `staffing` package, its five tables, staff roles and who holds them, a Staff roles page | — | FULL (migration, new package) | **Yes** |
| **A585-2** | Staffing paint storage and routes; the slot and matching library | A585-1 | FULL (cross-package exports from venue-service) | No |
| **A585-3** | The Calendar: rename, the `calendarViews` seam, the Staffing month view | A585-2, the A506 chain (A506-7, -8, -9, -11, -12, A577, A578) | FULL (dashboard contract) | No |
| **A585-4** | The staffing painters (season week and special day) | A585-3 | FULL (venue-service painter exports) | No |
| **A585-5** | Workforce: published-only own shifts, copy a published week into a draft, `describeShifts`, the warnings route | A585-1, A10-3 | FULL (shifts, what staff see, module contract) | No |
| **A585-6** | The Rota view by area: slots, filling, the picker, "Not in a slot" | A585-3, A585-5 | FULL (writes shifts) | No |
| **A585-7** | The Rota view by person, live warnings, Publish, "Change this week" | A585-6 | FULL | No |
| **A585-8** | The old Rota screen, the shift dialog and the free-text `role` columns go | A585-7 | FULL (migration) | **Yes** |

A585-1 and A585-2 can start at once. A585-5 can run beside A585-3 and A585-4 in another lane once
A10-3 has landed.

## Shared interfaces

These names are used across parts. An implementer sees only their own task, so every task's
**Interfaces** block repeats what it needs from here.

**Where types live.** `scripts/dashboard-browser-purity.test.ts` follows every RELATIVE import of a
dashboard file as text, `import type` included. So every shape the dashboard uses lives in one of two
browser-safe files that import nothing server-side: `src/staffing-types.ts` (type-only: `export
type`/`export interface`, and `import type` only) and `src/slots.ts` (types plus pure functions).
Server files (`staff-roles.ts`, `paint.ts`, `month.ts`, `rota.ts`) import their answer types from
`staffing-types.ts`, never the other way round. The dashboard never imports a server file.

**How times are stored.** As venue-service does (`storedTime`/`wireTime`,
`packages/venue-service/src/operations.ts:84-90`): `HH:MM:00` in the database, `HH:MM` on the wire
and everywhere above the row. Staffing has its own two-line copies in `paint.ts`; the step CHECK's
`substr(…, 4, 2)` reads the minutes in either spelling.

```ts
// packages/staffing/src/staffing-types.ts — type-only.
export interface StaffRole { id: string; name: string; colour: CalendarColour; position: number; holderIds: string[]; blockCount: number; shiftCount: number }
export type CalendarColour = "red" | "amber" | "grey" | "blue" | "green" | "purple"; // = CALENDAR_COLOURS, pinned by a test
export interface SeasonStaffing {
  areas: { area: AreaRef; name: string; weekdays: Record<number, StaffingBlock[]> }[]; // 0 = Sunday
  guides: Record<string, Record<number, { startsAt: string; endsAt: string }[]>>;    // areaKey → weekday → hours
}
export interface SpecialDayStaffing {
  areas: { area: AreaRef; name: string; dates: { dateId: string; date: string; blocks: StaffingBlock[] | null }[] }[]; // null: follows the season
}
export interface StaffingMonth { /* Task 3.2 */ }
export interface RotaWeek { /* Task 6.1 */ }

// packages/staffing/src/slots.ts — browser-safe: no database, no Node built-ins, no @waitron/reporting.
export type AreaKind = "department" | "station";
export interface AreaRef { kind: AreaKind; id: string }
export function areaKey(area: AreaRef): string; // "department:<uuid>" | "station:<uuid>"
export interface StaffingBlock { staffRoleId: string; headcount: number; startsAt: string; endsAt: string }
export interface Slot {
  key: string; businessDay: string; area: AreaRef; staffRoleId: string;
  startsAt: string; endsAt: string; start: number; end: number; // minutes from the changeover
}
export interface RotaShift {
  shiftId: string; personId: string;
  startsAt: string; startsOffsetMinutes: number; endsAt: string; endsOffsetMinutes: number;
  area: AreaRef | null; staffRoleId: string | null;
}
export interface PlacedShift extends RotaShift { businessDay: string; start: number; end: number }
export type SlotStatus =
  | { kind: "filled"; shiftId: string; outsideRole: boolean }
  | { kind: "partly_uncovered"; shiftId: string; outsideRole: boolean; uncovered: { start: number; end: number }[] }
  | { kind: "unfilled" };
export interface AreaDayMatch { slots: { slot: Slot; status: SlotStatus }[]; over: string[] }
export function minuteOfServiceDay(time: string, cutover: string): number;
export function blockSpan(block: Pick<StaffingBlock, "startsAt" | "endsAt">, cutover: string): { start: number; end: number };
export function slotsForDay(businessDay: string, area: AreaRef, blocks: readonly StaffingBlock[], cutover: string): Slot[];
export function placeShift(shift: RotaShift, cutoverFor: (businessDay: string) => string): PlacedShift;
export function matchAreaDay(
  slots: readonly Slot[], shifts: readonly PlacedShift[],
  holds: (personId: string, staffRoleId: string) => boolean,
): AreaDayMatch;

// packages/staffing/src/paint.ts — server only. Reads skip departments and stations that are switched off.
export async function readSeasonStaffing(tx: Transaction, cfg: { locationId: string }, seasonId: string): Promise<SeasonStaffing>;
export async function saveSeasonStaffing(tx: Transaction, cfg: { locationId: string }, seasonId: string,
  edits: readonly { area: AreaRef; weekday: number; blocks: readonly StaffingBlock[] }[]): Promise<void>;
export async function readSpecialDayStaffing(tx: Transaction, cfg: { locationId: string }, specialDayId: string): Promise<SpecialDayStaffing>;
export async function saveSpecialDayStaffing(tx: Transaction, cfg: { locationId: string }, specialDayId: string,
  edits: readonly { area: AreaRef; dateId: string; blocks: readonly StaffingBlock[] | null }[]): Promise<void>; // null: follow the season
export async function resolveStaffing(tx: Transaction, cfg: { locationId: string }, businessDays: readonly string[]):
  Promise<Map<string, Map<string, StaffingBlock[]>>>; // day → areaKey → blocks
```

Routes (all under `/management-api/staffing`; reads need `venue.view`, writes need
`staffing.manage`, except the rota, which reads and writes under `schedule.manage`):

| Method and path | Part | Body → answer |
| --- | --- | --- |
| `GET /staff-roles` | 1 | → `{ staffRoles: StaffRole[] }` |
| `POST /staff-roles` | 1 | `{ name, colour }` → 201 `StaffRole` |
| `PUT /staff-roles/:staffRoleId` | 1 | `{ name, colour }` → `StaffRole` |
| `PUT /staff-roles/:staffRoleId/holders` | 1 | `{ personIds }` → `StaffRole` |
| `PUT /staff-roles/order` | 1 | `{ staffRoleIds }` → 204 |
| `DELETE /staff-roles/:staffRoleId` | 1 | → 204; 409 `staff_role.in_use` |
| `GET /areas` | 2 | → `{ areas: { area: AreaRef; name: string }[] }` (active departments, then active stations) |
| `GET /seasons/:seasonId` | 2 | → `SeasonStaffing` |
| `PUT /seasons/:seasonId` | 2 | `{ edits }` → 204 |
| `GET /special-days/:specialDayId` | 2 | → `SpecialDayStaffing` |
| `PUT /special-days/:specialDayId` | 2 | `{ edits }` → 204 |
| `GET /month?month=YYYY-MM` | 3 (+6) | → `StaffingMonth` |
| `GET /rota?week=YYYY-MM-DD` | 6 | → `RotaWeek` |
| `POST /rota/shifts` | 6 | `{ week, personId, businessDay, area, staffRoleId, startsAt, endsAt }` → 201 `{ shiftId }` |
| `PATCH /rota/shifts/:shiftId` | 6 | `{ personId?, startsAt?, endsAt?, area?, staffRoleId? }` → 204 |
| `DELETE /rota/shifts/:shiftId` | 6 | → 204 |
| `POST /rota/change-week` | 7 | `{ week }` → `{ versionId }` |

Core routes this plan adds in `apps/server/src/workforce-api.ts` (part 5, `schedule.manage`):
`GET /management-api/roster/breaches?locationId&period` → `{ breaches: RosterBreach[] }`, 409
`convenio.not_found`. Publishing keeps the existing
`POST /management-api/roster/:versionId/publish`.

---

## Part A585-1 — the staffing package, staff roles and who holds them

> **Landed 2026-10-14 as #1681, with three changes later parts should know.** `StaffRole` carries no
> `blockCount`/`shiftCount`; a new `GET /staff-roles/:staffRoleId/delete-impact` (`staffing.manage`)
> answers the delete question, and `DELETE` answers 200 with that result. Staffing's tables are in two
> migrations (`0000`, `0001`) to fit `scripts/migration-upgrade.test.ts` (backlog A624).

Branch `feat/a585-1-staffing-package`. Template for every file: `packages/adjustments` (added in
37ab95ace, the newest module package with its own migration set and dashboard).

### Task 1.1: The package skeleton and its registration

**Files:**
- Create: `packages/staffing/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`,
  `src/index.ts`, `src/errors.ts`, `src/permissions.ts`, `src/migrations.ts`, `src/classification.ts`,
  `src/configuration-transfer.ts`, `src/staffing-types.ts`, `src/staffing-types.test.ts`,
  `src/schema/index.ts`, `src/schema/staffing.ts`,
  `src/migrations.test.ts`, `src/classification.test.ts`, `src/schema/schema-conformance.test.ts`
- Modify: `packages/composition/src/modules.ts` (entry after adjustments, ~line 286),
  `packages/composition/package.json`, `packages/composition/src/composition.test.ts` (journal map
  ~52-73, a field-by-field test like adjustments' ~163-173),
  `packages/migrations/migrations.manifest.json` (after adjustments' entry, ~97-102),
  `apps/server/src/boot.test.ts:907` (`toHaveLength(14)` → 15), `.github/workflows/ci.yml`
  (`changes.outputs` ~129; a `test-staffing` job copied from `test-adjustments` ~1411-1449 with
  `timeout-minutes: 10`; `--filter "!@waitron/staffing"` in both light jobs ~1686 and ~1761;
  `- test-staffing` in the `ci` job's `needs` ~1860), `scripts/changed-scope.mjs` (~196, ~220-235,
  ~337), `scripts/changed-scope.test.mjs` (~387-401, ~420, ~455, ~512, ~525-646),
  `scripts/module-seams.test.ts:117-124` (`APP_FORBIDDEN`),
  `scripts/dashboard-browser-purity.test.ts:24-27` (`SUBPATHS`), `packages/db/src/english-only.ts:42`
  and `scripts/english-only.test.ts:118` (same position in both), `scripts/schema-constraints.test.ts`
  (`EXPECTED_FOREIGN_KEYS` ~36, `EXPECTED_UNIQUE_INDEXES` ~341, `EXPECTED_CHECK_CONSTRAINTS` ~469),
  `pnpm-lock.yaml`.

**Interfaces:**
- Consumes: `table`, `id`, `label`, `count`, `timeOfDay`, `enumType`, `enumCheck`, `newId`,
  `locations`, `kitchenStations` from `@waitron/db`; `persons` from `@waitron/identity`;
  `departments`, `seasons`, `specialDayDates` from `@waitron/venue-service`; `CALENDAR_COLOURS`,
  `CalendarColour` from `@waitron/venue-service/hours-types`; `shifts` from `@waitron/workforce`;
  `classify`, `appendOnlyTablesIn` from `@waitron/sync-enrolment`.
- Produces: tables `staffRoles`, `personStaffRoles`, `staffingDays`, `staffingBlocks`,
  `shiftAssignments`; `STAFFING_MIGRATIONS`, `STAFFING_CLASSIFICATION`, `STAFFING_CHANGE_SOURCES`,
  `STAFFING_CONFIGURATION_TRANSFER`, `STAFFING_PERMISSIONS` (`staffing.manage`, granted from
  manager); the composition entry named `staffing`.

- [ ] **Step 1: Copy the template's config files.** `package.json` as adjustments' (name
  `@waitron/staffing`, exports `.` and `./dashboard`), dependencies adding `@waitron/venue-service`
  and `@waitron/workforce`; `vitest.config.ts` byte-for-byte from adjustments (two projects, coverage
  `include: ["src/**/*.ts"]`, thresholds 98/98/98/95); `drizzle.config.ts` with
  `migrations: { table: "__drizzle_migrations_staffing" }`. Run `pnpm install`.

- [ ] **Step 2: Write the schema** in `src/schema/staffing.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, kitchenStations, label, locations, newId, table, timeOfDay } from "@waitron/db";
import { persons } from "@waitron/identity";
import { departments, seasons, specialDayDates } from "@waitron/venue-service";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import { shifts } from "@waitron/workforce";

const calendarColour = enumType(CALENDAR_COLOURS);
const STEP = (column: unknown) => sql`substr(${column}, 4, 2) in ('00', '15', '30', '45')`;

export const staffRoles = table(
  "staff_roles",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    colour: calendarColour("colour").notNull().default("grey"),
    position: count("position").notNull().default(0),
  },
  (t) => [
    foreignKey({ columns: [t.locationId], foreignColumns: [locations.id], name: "staff_roles_location_fk" }),
    uniqueIndex("staff_roles_location_name_key").on(t.locationId, t.name),
    check("staff_roles_name_ck", sql`trim(${t.name}) <> ''`),
    check("staff_roles_colour_ck", enumCheck(t.colour)),
  ],
);

export const personStaffRoles = table(
  "person_staff_roles",
  { personId: id("person_id").notNull(), staffRoleId: id("staff_role_id").notNull() },
  (t) => [
    primaryKey({ columns: [t.personId, t.staffRoleId], name: "person_staff_roles_pk" }),
    foreignKey({ columns: [t.personId], foreignColumns: [persons.id], name: "person_staff_roles_person_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.staffRoleId], foreignColumns: [staffRoles.id], name: "person_staff_roles_role_fk" }).onDelete("cascade"),
  ],
);

/** One area's painted day: a department OR a prep station, on a season's weekday OR a special day's date. */
export const staffingDays = table(
  "staffing_days",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id"),
    stationId: id("station_id"),
    seasonId: id("season_id"),
    weekday: count("weekday"), // 0 = Sunday, as weekdayOf
    specialDayDateId: id("special_day_date_id"),
  },
  (t) => [
    foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id], name: "staffing_days_department_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "staffing_days_station_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.seasonId], foreignColumns: [seasons.id], name: "staffing_days_season_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.specialDayDateId], foreignColumns: [specialDayDates.id], name: "staffing_days_date_fk" }).onDelete("cascade"),
    check("staffing_days_one_area_ck", sql`(${t.departmentId} is null) <> (${t.stationId} is null)`),
    check(
      "staffing_days_one_day_ck",
      sql`(${t.seasonId} is null) <> (${t.specialDayDateId} is null) and (${t.seasonId} is null) = (${t.weekday} is null)`,
    ),
    check("staffing_days_weekday_ck", sql`${t.weekday} is null or ${t.weekday} between 0 and 6`),
    // SQLite treats NULLs in a unique index as distinct, so each area kind × day kind has its own.
    uniqueIndex("staffing_days_department_season_key").on(t.departmentId, t.seasonId, t.weekday)
      .where(sql`${t.departmentId} is not null and ${t.seasonId} is not null`),
    uniqueIndex("staffing_days_department_date_key").on(t.departmentId, t.specialDayDateId)
      .where(sql`${t.departmentId} is not null and ${t.specialDayDateId} is not null`),
    uniqueIndex("staffing_days_station_season_key").on(t.stationId, t.seasonId, t.weekday)
      .where(sql`${t.stationId} is not null and ${t.seasonId} is not null`),
    uniqueIndex("staffing_days_station_date_key").on(t.stationId, t.specialDayDateId)
      .where(sql`${t.stationId} is not null and ${t.specialDayDateId} is not null`),
  ],
);

export const staffingBlocks = table(
  "staffing_blocks",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    dayId: id("day_id").notNull(),
    staffRoleId: id("staff_role_id").notNull(),
    headcount: count("headcount").notNull(),
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.dayId], foreignColumns: [staffingDays.id], name: "staffing_blocks_day_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.staffRoleId], foreignColumns: [staffRoles.id], name: "staffing_blocks_role_fk" }).onDelete("cascade"),
    check("staffing_blocks_headcount_ck", sql`${t.headcount} between 1 and 50`),
    check("staffing_blocks_step_ck", sql`${STEP(t.startsAt)} and ${STEP(t.endsAt)}`),
    index("staffing_blocks_day_idx").on(t.dayId, t.startsAt),
  ],
);

/** Which area and staff role a shift fills. No row: the shift is "not in a slot". */
export const shiftAssignments = table(
  "shift_assignments",
  {
    shiftId: id("shift_id").primaryKey(),
    departmentId: id("department_id"),
    stationId: id("station_id"),
    staffRoleId: id("staff_role_id").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.shiftId], foreignColumns: [shifts.id], name: "shift_assignments_shift_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id], name: "shift_assignments_department_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "shift_assignments_station_fk" }).onDelete("cascade"),
    // restrict: a staff role a shift uses cannot be deleted (staff_role.in_use is checked first).
    foreignKey({ columns: [t.staffRoleId], foreignColumns: [staffRoles.id], name: "shift_assignments_role_fk" }).onDelete("restrict"),
    check("shift_assignments_one_area_ck", sql`(${t.departmentId} is null) <> (${t.stationId} is null)`),
  ],
);
```

  If `STEP(...)` interpolation does not emit the column name in the generated SQL, write the two
  `substr(...)` conditions out in full as `department_day_ranges_step_ck` does
  (`packages/venue-service/src/schema/seasons.ts:155`). `src/schema/index.ts` re-exports only these
  five tables.

- [ ] **Step 3: Generate the migration:** `pnpm --filter @waitron/staffing db:generate`. Read the
  generated `drizzle/0000_*.sql`: it must CREATE the five tables with every FK, check and partial
  unique index above, and touch no other set's table.

- [ ] **Step 4: Write `classification.ts`, `migrations.ts`, `permissions.ts`,
  `configuration-transfer.ts`, `errors.ts`, `index.ts`.**

```ts
// classification.ts
import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
export const STAFFING_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("staff_roles", "state", "the venue's job positions, which an owner edits"),
  classify("person_staff_roles", "state", "which staff roles a person can fill"),
  classify("staffing_days", "state", "an area's painted staffing day"),
  classify("staffing_blocks", "state", "one painted staffing need"),
  classify("shift_assignments", "state", "the area and staff role a shift fills"),
];
export const STAFFING_CHANGE_SOURCES = STAFFING_CLASSIFICATION.map(({ table }) => ({ table, type: table }));

// migrations.ts
export const STAFFING_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_staffing",
  appendOnlyTables: appendOnlyTablesIn(STAFFING_CLASSIFICATION),
} as const;

// permissions.ts
export const STAFFING_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "staffing.manage", grantedFrom: "manager" },
];

// configuration-transfer.ts
export const STAFFING_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "staff_roles", locationColumns: ["location_id"] },
    { name: "person_staff_roles" },
    { name: "staffing_days" },
    { name: "staffing_blocks" },
  ],
} as const satisfies ModuleConfigurationTransfer;

// errors.ts
import "@waitron/shared";
declare module "@waitron/shared" {
  interface ErrorParams {
    "staff_role.not_found": { staffRoleId: string };
    "staff_role.name_taken": { name: string };
    "staff_role.in_use": { staffRoleId: string; shiftCount: number };
    "staffing.invalid": { field: string };
    "staffing_area.not_found": { area: string };
  }
}
```

  Composition entry (after adjustments):

```ts
{
  name: "staffing", version: "0.0.0", tier: "toggleable",
  requires: { core: "*", modules: { identity: "*", "venue-service": "*", workforce: "*" } },
  migrations: { name: "staffing", table: "__drizzle_migrations_staffing", from: "../staffing/drizzle" },
  classification: STAFFING_CLASSIFICATION, changes: STAFFING_CHANGE_SOURCES,
  routes: STAFFING_ROUTES, permissions: STAFFING_PERMISSIONS,
  configurationTransfer: STAFFING_CONFIGURATION_TRANSFER,
},
```

  `STAFFING_ROUTES` in this task is `{ mount() {} }` (routes land in Task 1.2). Manifest entry:
  `{ "name": "staffing", "table": "__drizzle_migrations_staffing", "from": "../staffing/drizzle", "appendOnlyTables": [] }`.

- [ ] **Step 5: Tests.** `migrations.test.ts` and `classification.test.ts` as adjustments'.
  `schema/schema-conformance.test.ts`:

```ts
describeSchemaConformance({
  subjectName: "staffing",
  prerequisites: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  subject: STAFFING_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
});
```

  The conformance test needs `@waitron/catalogue` as a staffing devDependency. Add a
  `staffing-types.test.ts` case that pins `CalendarColour` to `CALENDAR_COLOURS` (same members).

- [ ] **Step 6: Register in every list** named under **Files**, then run the root guards:
  `pnpm vitest run scripts/` and `pnpm --filter @waitron/staffing test:coverage` and
  `pnpm --filter @waitron/composition test`. Expected: all pass. A guard that names a missing
  `vitest.config.ts` means a list is still missing the package.

- [ ] **Step 7: Commit.** `git add packages/staffing packages/composition packages/migrations apps/server/src/boot.test.ts .github/workflows/ci.yml scripts packages/db/src/english-only.ts pnpm-lock.yaml && git commit -s -m "A585-1: the staffing module package and its tables"`

### Task 1.1b: What the database refuses, and the configuration export

**Files:**
- Create: `packages/staffing/src/schema/constraints.test.ts`
- Modify: `apps/server/src/configuration-transfer.test.ts`, `apps/server/package.json` (only if the
  test imports `@waitron/staffing` directly)

- [ ] **Step 1: Database cases** (`useVenueDb` with `[CORE_MIGRATIONS, CATALOGUE_MIGRATIONS,
  VENUE_SERVICE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, STAFFING_MIGRATIONS]`),
  inserting rows directly: a `staffing_days` row with both a department and a station is refused;
  one with neither is refused; one with a season and a date is refused; two rows for one department,
  season and weekday are refused, while the same weekday for a station and for a department are
  both accepted; a headcount of 0 and a `08:10` start are refused; deleting a season deletes its
  `staffing_days` and `staffing_blocks`; deleting a special day's date the same; deleting a shift
  deletes its `shift_assignments` row; deleting a staff role that a `shift_assignments` row names is
  refused. Catch each refusal outside the `withTransaction`, around the whole call (CLAUDE.md §3).
  Departments and stations are never deleted by the product (they are switched off), so no case
  deletes one.
- [ ] **Step 2: Export and import:** add an end-to-end case to
  `apps/server/src/configuration-transfer.test.ts`, as the adjustments commit did: a venue with two
  staff roles, a holder and a painted season week exports and imports into an empty venue with the
  same rows (ids remapped). If the import refuses `person_staff_roles` because people are not
  transferred, move that table to `omit` and say so in the PR.
- [ ] **Step 3: Run** `pnpm --filter @waitron/staffing test:coverage` and
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts`; PASS.
- [ ] **Step 4: Commit** `git commit -s -m "A585-1: what the staffing tables refuse, and their export"`.

### Task 1.2: Staff roles and their holders on the server

> 2026-10-16, A645: the staff-role and staffing-paint saves use `readRawJsonBody`
> and check that the body is an object before reading its keys. See
> `packages/staffing/src/routes.test.ts`, the non-object-body cases.

**Files:**
- Create: `packages/staffing/src/staff-roles.ts`, `src/staff-roles.test.ts`, `src/routes.ts`,
  `src/routes.test.ts`, `test/seed.ts`
- Modify: `packages/staffing/src/index.ts`

**Interfaces:**
- Consumes: Task 1.1's tables and error codes; `authorizeManager` (`@waitron/identity`);
  `createErrorBoundary`, `readJsonBody`, `requireManagementSession`, `requireUuidParam`,
  `requireString` (`@waitron/server-kit`); `CALENDAR_COLOURS` (`@waitron/venue-service/hours-types`).
- Produces: `listStaffRoles(tx, cfg)`, `createStaffRole(tx, cfg, { name, colour })`,
  `updateStaffRole(tx, cfg, id, { name, colour })`, `setStaffRoleHolders(tx, cfg, id, personIds)`,
  `reorderStaffRoles(tx, cfg, ids)`, `deleteStaffRole(tx, cfg, id)`, all returning or using
  `StaffRole`; `STAFFING_ROUTES` with the six staff-role routes in the table above.

- [ ] **Step 1: Failing tests** in `staff-roles.test.ts` (`useVenueDb` with the six sets; `test/seed.ts`
  inserts a location, two persons, a department and a station):

```ts
it("creates, lists in position order and counts holders, blocks and shifts", async () => {
  const chef = await createStaffRole(tx, cfg, { name: "Head chef", colour: "purple" });
  const sous = await createStaffRole(tx, cfg, { name: "Sous chef", colour: "green" });
  await setStaffRoleHolders(tx, cfg, sous.id, [ana, marc]);
  const roles = await listStaffRoles(tx, cfg);
  expect(roles.map((r) => r.name)).toEqual(["Head chef", "Sous chef"]);
  expect(roles[1]).toMatchObject({ holderIds: [ana, marc].sort(), blockCount: 0, shiftCount: 0 });
});
it("refuses a duplicate name as staff_role.name_taken", async () => {
  await createStaffRole(tx, cfg, { name: "Waiter", colour: "blue" });
  await expect(createStaffRole(tx, cfg, { name: "Waiter", colour: "red" }))
    .rejects.toMatchObject({ code: "staff_role.name_taken" });
});
it("refuses a blank name and an unknown colour as staffing.invalid", ...);
it("refuses holders that are not persons as staffing.invalid {field: personIds}", ...);
it("deleting a staff role deletes its blocks and holders", ...);
it("refuses to delete a staff role a shift uses as staff_role.in_use with the shift count", ...);
it("reorders by the given ids and refuses a list that is not exactly the venue's roles", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @waitron/staffing exec vitest run src/staff-roles.test.ts`;
  expected FAIL (module not found).

- [ ] **Step 3: Implement** `staff-roles.ts`. `createStaffRole` puts the new role last
  (`position = max + 1`); a name already used at the location is refused `staff_role.name_taken`
  by a select before the write, as the template's `assertNameFree` does
  (`packages/adjustments/src/operations.ts:109-121`). `listStaffRoles` reads roles, then holders, then block counts, then shift
  counts, one query after another (never `Promise.all`). `deleteStaffRole` counts
  `shift_assignments` for the role first and throws `staff_role.in_use { staffRoleId, shiftCount }`
  when it is above zero.

- [ ] **Step 4: Routes.** `routes.ts` follows `packages/adjustments/src/routes.ts:180-260`:
  `gatedBy(permission, sessionId, fn)` around one `withTransaction`; reads under `venue.view`,
  writes under `staffing.manage`. `STATUS`: `management_session.required`/`expired` 401,
  `person.suspended` 403, `authorization.not_permitted` 403, `management.request_invalid` 400,
  `shared.invalid_id` 400, `staffing.invalid` 400, `staff_role.not_found` 404,
  `staff_role.name_taken` 409, `staff_role.in_use` 409. Body keys are checked with an `onlyKeys`
  helper as venue-service's (`packages/venue-service/src/routes.ts:166-169`). `routes.test.ts` builds
  a Hono app over `useVenueDb` and `registerModulePermissions` as
  `packages/venue-service/src/season-routes.test.ts:1-45` does, and asserts each route's status and
  body, a staff session refused 403, and an extra body key refused 400.

- [ ] **Step 5: Run** the two test files; expected PASS. Then
  `pnpm --filter @waitron/staffing test:coverage`; expected thresholds met.

- [ ] **Step 6: Commit** `git commit -s -m "A585-1: staff roles and who holds them, with routes"`.

### Task 1.3: The Staff roles page

**Files:**
- Create: `packages/staffing/src/dashboard/index.ts`, `client.ts`, `strings.ts`, `live-queries.ts`,
  `staff-roles-screen.ts`, `staff-role-dialog.ts`, and for each screen/dialog `*.test.ts`,
  `*.a11y.test.ts`, `*.unsaved.test.ts` (the dialog), `*.save-state.test.ts` (the dialog),
  `src/dashboard/vite-env.d.ts`
- Modify: `packages/dashboard-modules/src/index.ts`, `packages/dashboard-modules/package.json`,
  `packages/dashboard-modules/src/registry.test.ts`

**Interfaces:**
- Consumes: Task 1.2's routes; `DashboardContribution`, `DashboardRequest`, `registerCodeMessages`
  (`@waitron/dashboard-kit`); `draftScopeFor`, `saveActionState`, `LeaveController`
  (`@waitron/ui`); `wt-data-table`, `wt-dialog`, `wt-input`, `wt-combobox` (multiple),
  `wt-row-actions`.
- Produces: `STAFFING_DASHBOARD: DashboardContribution` with `module: "staffing"` and, as its
  required `screen` (`packages/dashboard-kit/src/contract.ts:41-44,63`), the Staff roles page
  `{ id: "staff-roles", navLabelKey: "nav.staff_roles", group: "team",
  requiresPermission: "staffing.manage", readPermission: "venue.view" }`. It stays the module's
  `screen` in every later part. Also `StaffingApi` (client) with `watchStaffRoles`,
  `createStaffRole`, `updateStaffRole`, `setHolders`, `reorder`, `deleteStaffRole`, and
  `QUERY_DEPENDENCIES = { "staff-roles": ["staff_roles", "person_staff_roles", "staffing_blocks", "shift_assignments", "persons"] }`.
  The client imports `StaffRole` from `../staffing-types.js`, never from a server file.

> 2026-10-16, A636: the Staff roles list now watches only `staff_roles` and
> `person_staff_roles`; `staff-role-delete-impact` retains its separate `persons` dependency.

- [ ] **Step 1: Failing browser tests** in `staff-roles-screen.test.ts`: the list shows each staff
  role's colour swatch (styled with `part=`, CLAUDE.md §3), name and holder count in position order;
  the `actions` column is pinned to the end; "+ New staff role" opens the dialog; a role whose
  `shiftCount > 0` offers Delete but the confirmation names the shifts and the delete answer
  `staff_role.in_use` shows its message; the move-up/move-down row actions call `reorder`.
  `staff-role-dialog.test.ts`: Name (required, marked), Colour (the six calendar colours as a
  `wt-combobox`), People (a `wt-combobox multiple` of the venue's people); Save quiet and disabled
  until the draft changes; a `staff_role.name_taken` refusal shows under Name; a blank name shows
  the field error and the one message above the buttons, and Save stays disabled until fixed.

- [ ] **Step 2: Run** `pnpm --filter @waitron/staffing exec vitest run --project browser`; expected
  FAIL.

- [ ] **Step 3: Implement** the client (`watchStaffRoles` uses `{ passive: true }` and the live query
  `staff-roles`), the strings (EN and ES; keys `nav.staff_roles` "Staff roles"/"Roles de personal",
  `staffing.role.*`; register code messages for `staff_role.name_taken`, `staff_role.in_use`,
  `staff_role.not_found`, `staffing.invalid`), the screen and the dialog. People come from the
  existing `GET /management-api/staff` route; check its answer shape in `apps/dashboard/src/api/client.ts`
  before using it.

- [ ] **Step 4: a11y and unsaved tests** following `packages/venue-service/src/dashboard/opening-hours-year.a11y.test.ts`
  (`describe.each(["light","dark"])`, `mountThemed`, `expectNoA11yViolations`) and
  `season-dialog.unsaved.test.ts`.

- [ ] **Step 5: Register** `STAFFING_DASHBOARD` in `DASHBOARD_MODULES`; add a placement test.

- [ ] **Step 6: Run** `pnpm --filter @waitron/staffing test:coverage`,
  `pnpm --filter @waitron/dashboard-modules test`, `pnpm vitest run scripts/live-subscriptions.test.ts scripts/dashboard-browser-purity.test.ts`;
  expected PASS.

- [ ] **Step 7: Look at it.** Start the dev stack from the worktree (`wa-wt demo <worktree-name>`;
  this part needs `wa-wt reset demo <worktree-name>` first because of the new tables), open Team →
  Staff roles in both themes and at 390 px, add, edit, reorder and delete a role.

- [ ] **Step 8: Commit** `git commit -s -m "A585-1: the Staff roles page"`.

---

## Part A585-2 — staffing paint storage and the slot library

> **Landed 2026-10-14 as #1686, with six things later parts should know.**
> `placeShift` measures `start` from its business day's own changeover, so when the changeover
> moves later between two days a shift can start past minute 1440 (`slotsForDay` still ends every
> slot by 1440). `resolveStaffing` answers an area whose special-day row is empty with `[]`, not by
> leaving it out. `parseArea`/`parseBlocks` lower-case ids; `paint-rules.ts` also exports `record`
> and `uuid`. `listStaffingAreas` is exported for `GET /areas`. Staffing depends on
> `@waitron/reporting` for `readLocationClock`. On a paint save, an area or staff role the body
> names that is not the venue's answers 400 (`staffing_area.not_found`, `staff_role.not_found`),
> and a date that is not one of the special day's is `staffing.invalid` on `edits.<i>.dateId`; only
> the season or special day in the path answers 404.

Branch `feat/a585-2-staffing-paint`. Waits for A585-1.

### Task 2.1: venue-service exports what staffing reads

**Files:**
- Modify: `packages/venue-service/src/index.ts`; `packages/venue-service/src/index.test.ts` if it
  pins the export list.

**Interfaces:**
- Produces (new exports from `@waitron/venue-service`): `readDayPlan`, `type DayPlan`
  (`day-resolver.ts:35`), `readSeasons` (`seasons.ts:27`), `type Season` (`season-rules.ts`),
  `readDepartmentSeasonWeeks` (`season-weeks.ts:193`, for the painter's guide hours), `weekdayOf`, `addDays`
  (`hours-rules.ts:50,58`), `type SpecialDayOccurrence`.

- [ ] **Step 1:** Add the exports. **Step 2:** `pnpm --filter @waitron/venue-service typecheck` and
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/index.test.ts`; expected
  PASS. **Step 3: Commit** `git commit -s -m "A585-2: venue-service exports the day plan for staffing"`.

### Task 2.2: The slot and matching library

**Files:**
- Create: `packages/staffing/src/slots.ts`, `packages/staffing/src/slots.test.ts`

**Interfaces:**
- Produces: everything listed under `slots.ts` in **Shared interfaces**.

- [ ] **Step 1: Failing tests** (`slots.test.ts`, node project):

```ts
const KITCHEN: AreaRef = { kind: "station", id: "s1" };
const block = (staffRoleId: string, headcount: number, startsAt: string, endsAt: string) =>
  ({ staffRoleId, headcount, startsAt, endsAt });

describe("slotsForDay", () => {
  it("makes one slot per person a block asks for, with business-day minutes", () => {
    const slots = slotsForDay("2026-12-04", KITCHEN, [block("sous", 2, "08:00", "14:00")], "06:00");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ staffRoleId: "sous", start: 120, end: 480, startsAt: "08:00", endsAt: "14:00" });
    expect(new Set(slots.map((s) => s.key)).size).toBe(2);
  });
  it("places a block running to the changeover at minute 1440 and past midnight after 1080", () => {
    const [late] = slotsForDay("2026-12-04", KITCHEN, [block("dw", 1, "20:00", "06:00")], "06:00");
    expect(late).toMatchObject({ start: 840, end: 1440 });
    const [night] = slotsForDay("2026-12-04", KITCHEN, [block("dw", 1, "23:00", "01:30")], "06:00");
    expect(night).toMatchObject({ start: 1020, end: 1170 });
  });
  it("orders slots by start, then staff role, then key", ...);
});

describe("placeShift", () => {
  const cutover = () => "06:00";
  it("puts a 01:00 Monday start on Sunday's business day", () => {
    const placed = placeShift({ shiftId: "x", personId: "p", startsAt: "2026-11-30T00:00:00Z", startsOffsetMinutes: 60,
      endsAt: "2026-11-30T04:00:00Z", endsOffsetMinutes: 60, area: KITCHEN, staffRoleId: "sous" }, cutover);
    expect(placed).toMatchObject({ businessDay: "2026-11-29", start: 1140, end: 1380 });
  });
  it("lets a shift run past the changeover (end above 1440)", ...);
  it("uses the cutover of the shift's own business day when the clock changed", ...);
  it("measures length on the wall clock across the spring-forward night", () => {
    // Europe/Madrid, 2027-03-28: 22:00 (+60) to 04:00 (+120) is 5 elapsed hours, 6 on the wall.
    const placed = placeShift({ shiftId: "n", personId: "p", startsAt: "2027-03-27T21:00:00Z", startsOffsetMinutes: 60,
      endsAt: "2027-03-28T02:00:00Z", endsOffsetMinutes: 120, area: KITCHEN, staffRoleId: "sous" }, cutover);
    expect(placed).toMatchObject({ businessDay: "2027-03-27", start: 960, end: 1320 });
  });
});
// In describe("slotsForDay"):
//   it("ends a block that crosses a new changeover at the changeover", () => {
//     // saved as 05:00–07:00 under a 04:00 changeover; read under 06:00 → start 1380, end 1440
//   });

describe("matchAreaDay", () => {
  const holdsAll = () => true;
  it("pairs staggered shifts with the staggered slots they were meant for", () => {
    const slots = slotsForDay("2026-12-04", KITCHEN,
      [block("sous", 1, "08:00", "14:00"), block("sous", 1, "10:00", "16:00")], "06:00");
    const shifts = [placed("a", "08:00", "14:00"), placed("b", "10:00", "16:00")];
    const match = matchAreaDay(slots, shifts, holdsAll);
    expect(match.slots.map((s) => s.status)).toEqual([
      { kind: "filled", shiftId: "a", outsideRole: false },
      { kind: "filled", shiftId: "b", outsideRole: false },
    ]);
    expect(match.over).toEqual([]);
  });
  it("reports the part of a slot a short shift leaves uncovered", () => {
    // slot 11:00–17:00, shift 11:00–14:00 → uncovered 14:00–17:00 = minutes 480–660
  });
  it("reports a slot with no shift as unfilled and a shift with no slot as over", ...);
  it("marks a shift whose person does not hold the staff role as outside role", ...);
  it("never pairs across staff roles", ...);
  it("breaks ties the same way whatever order the shifts arrive in", () => {
    // two identical shifts, two identical slots: shuffle the shift array 10 times; same pairing each time.
  });
});
```

  Write every `...` case out in full with concrete times before running; each asserts the exact
  status objects.

- [ ] **Step 2: Run** `pnpm --filter @waitron/staffing exec vitest run src/slots.test.ts`; expected FAIL.

- [ ] **Step 3: Implement** `slots.ts`:

```ts
const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export function minuteOfServiceDay(time: string, cutover: string): number {
  return (clockMinutes(time) - clockMinutes(cutover) + 1440) % 1440;
}
export function blockSpan(block: Pick<StaffingBlock, "startsAt" | "endsAt">, cutover: string) {
  return { start: minuteOfServiceDay(block.startsAt, cutover), end: minuteOfServiceDay(block.endsAt, cutover) || 1440 };
}
export const areaKey = (area: AreaRef) => `${area.kind}:${area.id}`;

export function slotsForDay(businessDay: string, area: AreaRef, blocks: readonly StaffingBlock[], cutover: string): Slot[] {
  const slots: Slot[] = [];
  blocks.forEach((b, blockIndex) => {
    const span = blockSpan(b, cutover);
    // A block saved before a changeover change can cross the new changeover; it ends there.
    const { start, end } = span.end > span.start ? span : { start: span.start, end: 1440 };
    for (let n = 0; n < b.headcount; n += 1) {
      slots.push({ key: `${businessDay}|${areaKey(area)}|${blockIndex}|${n}`, businessDay, area,
        staffRoleId: b.staffRoleId, startsAt: b.startsAt, endsAt: b.endsAt, start, end });
    }
  });
  return slots.sort((a, b) => a.start - b.start || a.staffRoleId.localeCompare(b.staffRoleId) || a.key.localeCompare(b.key));
}

function wall(instant: string, offsetMinutes: number): { date: string; time: string } {
  const iso = new Date(Date.parse(instant) + offsetMinutes * 60_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
export function placeShift(shift: RotaShift, cutoverFor: (businessDay: string) => string): PlacedShift {
  const { date, time } = wall(shift.startsAt, shift.startsOffsetMinutes);
  const businessDay = time < cutoverFor(date) ? previousDay(date) : date;
  const start = minuteOfServiceDay(time, cutoverFor(businessDay));
  // Wall-clock length, not elapsed time: slots are wall-clock, and on a clock-change night a
  // 22:00–04:00 shift lasts five or seven elapsed hours but still ends at 04:00 on the wall.
  const wallMs = (instant: string, offset: number) => Date.parse(instant) + offset * 60_000;
  const minutes = (wallMs(shift.endsAt, shift.endsOffsetMinutes) - wallMs(shift.startsAt, shift.startsOffsetMinutes)) / 60_000;
  return { ...shift, businessDay, start, end: start + minutes };
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

export function matchAreaDay(slots: readonly Slot[], shifts: readonly PlacedShift[],
  holds: (personId: string, staffRoleId: string) => boolean): AreaDayMatch {
  const pairs: { slot: Slot; shift: PlacedShift; size: number }[] = [];
  for (const slot of slots) for (const shift of shifts) {
    if (shift.staffRoleId !== slot.staffRoleId) continue;
    const size = overlap(slot, shift);
    if (size > 0) pairs.push({ slot, shift, size });
  }
  pairs.sort((a, b) => b.size - a.size || a.slot.start - b.slot.start || a.shift.start - b.shift.start
    || a.slot.key.localeCompare(b.slot.key) || a.shift.shiftId.localeCompare(b.shift.shiftId));
  const bySlot = new Map<string, PlacedShift>();
  const used = new Set<string>();
  for (const { slot, shift } of pairs) {
    if (bySlot.has(slot.key) || used.has(shift.shiftId)) continue;
    bySlot.set(slot.key, shift);
    used.add(shift.shiftId);
  }
  return {
    slots: slots.map((slot) => {
      const shift = bySlot.get(slot.key);
      if (shift === undefined) return { slot, status: { kind: "unfilled" } };
      const outsideRole = !holds(shift.personId, slot.staffRoleId);
      const uncovered = [
        ...(shift.start > slot.start ? [{ start: slot.start, end: Math.min(shift.start, slot.end) }] : []),
        ...(shift.end < slot.end ? [{ start: Math.max(shift.end, slot.start), end: slot.end }] : []),
      ];
      return uncovered.length === 0
        ? { slot, status: { kind: "filled", shiftId: shift.shiftId, outsideRole } }
        : { slot, status: { kind: "partly_uncovered", shiftId: shift.shiftId, outsideRole, uncovered } };
    }),
    over: shifts.filter((s) => !used.has(s.shiftId)).map((s) => s.shiftId).sort(),
  };
}
```

- [ ] **Step 4: Run**; expected PASS. Then `pnpm --filter @waitron/staffing test:coverage`.
- [ ] **Step 5: Commit** `git commit -s -m "A585-2: slots and matching"`.

### Task 2.3: Reading and saving staffing paint

**Files:**
- Create: `packages/staffing/src/paint.ts`, `src/paint.test.ts`, `src/paint-rules.ts`,
  `src/paint-rules.test.ts`
- Modify: `packages/staffing/src/routes.ts`, `src/routes.test.ts`, `src/index.ts`

**Interfaces:**
- Consumes: `readDayPlan`, `readSeasons`, `weekdayOf` (Task 2.1); `readLocationClock` and
  `cutoverForBusinessDay` (`@waitron/reporting`, `@waitron/shared`); `slots.ts` types; Task 1.1
  tables.
- Produces: `paint.ts` functions listed in **Shared interfaces**; `parseBlocks(value, field,
  cutover): StaffingBlock[]` and `parseArea(value, field): AreaRef` in `paint-rules.ts`; the routes
  `GET /areas`, `GET|PUT /seasons/:seasonId`, `GET|PUT /special-days/:specialDayId`.

- [ ] **Step 1: Failing tests** in `paint-rules.test.ts`: `parseBlocks` accepts an empty array;
  refuses a non-array, a headcount of 0 or 51 or 1.5, a time off the 15-minute step, a start equal
  to its end, an unknown key, and a non-uuid staff role, each as `staffing.invalid` naming the field
  (`blocks.2.headcount`); accepts `20:00–02:00` with a 06:00 changeover and refuses `05:00–07:00`
  (it crosses the changeover). `paint.test.ts` (database): a season week saved for a department and
  a station reads back identically; saving an empty block list for a weekday deletes that day's
  row; a staff role from another location or an unknown area is refused
  (`staff_role.not_found`, `staffing_area.not_found`); a special day's edit with `blocks: null`
  removes the date's row and `[]` keeps an empty row; `resolveStaffing` returns the season's blocks
  on an ordinary date, the special day's blocks on its date, `[]` for an area whose special-day row
  is empty, and the season's blocks for an area the special day did not paint. **Switched-off
  areas** (Review Focus 5): after `update departments set active = 0` (what
  `service-delete.ts:329` does) and the same for a station (`station-delete.ts:215`), the area is
  absent from `GET /areas`, from `readSeasonStaffing`, from `readSpecialDayStaffing` and from
  `resolveStaffing`, and a save naming it is refused `staffing_area.not_found`; switching it back on
  brings its paint back unchanged. Times are stored `HH:MM:00` (read the row in the test) and come
  back `HH:MM`. `readSeasonStaffing`'s `guides` hold each department's painted hours per weekday
  from `readDepartmentSeasonWeeks` (`season-weeks.ts:193`, called with the ACTIVE department ids
  only); a station's guide is empty in this part
  (Task 4.0 decides whether A506-12 offers a per-weekday station read).

- [ ] **Step 2: Run**; expected FAIL.

- [ ] **Step 3: Implement.** `saveSeasonStaffing` checks the season belongs to `cfg.locationId`,
  checks every area and staff role exists at the location (department or station `active`), then per
  edit deletes the `staffing_days` row for (area, season, weekday) and, when blocks remain, inserts
  the day and its blocks. `saveSpecialDayStaffing` checks each `dateId` belongs to the special day.
  The cutover used to validate is `readLocationClock(tx, cfg.locationId)`'s current cutover.
  `resolveStaffing` reads the day plan for the days, then the season-weekday rows and the date rows
  that apply, then their blocks, one query after another, and assembles the map by the rule: an
  area's special-day row wins; otherwise its season-weekday row; otherwise no entry.

- [ ] **Step 4: Routes and their tests** (status codes as Task 1.2, except that on a save an area
  or staff role the body names that is not the venue's answers 400 — `staffing_area.not_found`,
  `staff_role.not_found` — and a date that is not one of the special day's is `staffing.invalid` on
  `edits.<i>.dateId`; the season and special day in the path answer `season.not_found` /
  `special_day.not_found` 404 when the id is not at the location — reuse venue-service's codes,
  which its `errors.ts` already declares).

- [ ] **Step 5: Run** `pnpm --filter @waitron/staffing test:coverage`; expected PASS.
- [ ] **Step 6: Commit** `git commit -s -m "A585-2: staffing paint storage and routes"`.

---

## Part A585-3 — the Calendar and its Staffing month

Branch `feat/a585-3-calendar-views`. Waits for A585-2 and the whole A506 chain.

### Task 3.0: Re-check on the base

- [ ] Read, on the current `main`: `packages/venue-service/src/dashboard/opening-hours-screen.ts`
  (its `View` union, its `wt-tabs`, its `UrlStateController` address),
  `apps/dashboard/src/navigation.ts` (the opening-hours address tree),
  `packages/dashboard-kit/src/contract.ts`, `apps/dashboard/src/dashboard-app.ts` (where
  `settingsPanels` are validated and `renderPanel` is built, ~1203-1265), the landed month view
  (`opening-hours-month.ts`, its properties and events) and `readOpeningHoursMonth`'s answer.
  Write down any name in Tasks 3.1–3.3 that no longer matches, and correct this plan's text in the
  same branch before Task 3.1. Commit the plan fix on its own.

**Corrections from Task 3.0 (re-checked on `main` 57dc431a1, 2026-10-15).** Where these differ from
Tasks 3.1–3.3 below, these win.

- `packages/dashboard-kit` has no `contract.test.ts`; the contract's new fields are tested through
  `apps/dashboard/src/dashboard-app.test.ts` and the screens that use them.
- The app knows the person's permissions and the screen does not (a screen gets `render(readOnly)`).
  So the context carries each view with its write answer already worked out:
  `DashboardModuleContext.calendarViews?: readonly { view: DashboardCalendarView; canWrite: boolean }[]`,
  holding only views whose `requiresPermission` or `readPermission` the person holds, ordered by
  `order`. `#activate` (`apps/dashboard/src/dashboard-app.ts`) collects them from every enabled
  module BEFORE it creates any module's screens, because it builds and hands out `ctx` module by
  module. The duplicate-id check names the screen's own view words: `year`, `month`, `season`,
  `special-day`, `date`, `calendar`, `week` (an old address that opens the season painter), and
  `hours` (a view's way back to Opening hours).
- The Opening hours screen has ONE own tab today, "Year" (`opening.tab.year`), holding the year and
  the month; the department picker is inside the month (`opening-hours-month.ts`), not on the page.
  So Step 5 becomes: the `h1` reads the nav label (key renamed `nav.calendar` at review), which becomes "Calendar"/"Calendario"; the
  switch's first item reads `opening.title` ("Opening hours"/"Horario de apertura", unchanged); the
  "Year" tab keeps its label. With no module view the person may read, no switch is drawn and the
  page is exactly today's.
- The switch is a radio group drawn like the special-day painter's `.segmented` control
  (`packages/venue-service/src/dashboard/special-day-painter.ts`), not `wt-tabs`.
- `UrlStateController` (`packages/ui/src/url-state.ts`) reads only the keys it is configured with,
  so the screen reads a module view's `<key>/<value>` pairs after `view/<id>` from the path itself.
  `host.month` is the address's `month` value when it is a valid `YYYY-MM`, else the month holding
  the venue's business date today, or the browser's today when the venue's clock cannot be read. Choosing a module view from Opening hours' month carries the
  shown month into its address (`view/staffing/month/2026-12`); a view steps months with
  `host.open(<its id>, { ...params, month })`.
- `StaffingMonth` also carries what the season chips and the day clicks of A585-4 need, read through
  venue-service's `readOpeningHoursMonth` (superseded below: `readCalendarMonthPlan` is what this part exports)
  rather than worked out twice: `today`, `seasons` (as `OpeningHoursMonth.seasons`), and on each
  day `seasonId`, `specialDay` (`{ id, name } | null`) and `closedAllDay`.
- (2026-10-15, after Task 3.2's review.) The staffing month reads those through
  `readCalendarMonthPlan`, the part of `readOpeningHoursMonth` that comes before any hours and that
  the opening-hours month now calls itself; it hands that read's day plan and changeover, and its
  own area list, to `resolveStaffing`, so no table is read twice. `StaffingMonth` also carries
  `areas`, every active area by name in `listStaffingAreas` order, so the Staffing view asks for
  the month alone.

### Task 3.1: The `calendarViews` seam

**Files:**
- Modify: `packages/dashboard-kit/src/contract.ts` (+ its test), `apps/dashboard/src/dashboard-app.ts`
  (+ `dashboard-app.test.ts`), `packages/venue-service/src/dashboard/index.ts`,
  `packages/venue-service/src/dashboard/opening-hours-screen.ts` (+ tests),
  `apps/dashboard/src/navigation.ts` (+ test)

**Interfaces:**
- Produces:

```ts
// packages/dashboard-kit/src/contract.ts
export interface CalendarViewHost {
  /** The month the Calendar is showing, YYYY-MM; views that show a week use the week holding its 1st. */
  month: string;
  /** The address's `<key>/<value>` pairs after `view/<id>`, e.g. { week: "2026-11-30", area: "station:<id>" }. */
  params: Readonly<Record<string, string>>;
  /** True when the person holds the view's `requiresPermission`; otherwise the view draws read-only. */
  canWrite: boolean;
  /** Moves the Calendar to `view/<view>/<key>/<value>…` (another module view, or "hours" for Opening hours). */
  open(view: string, params: Record<string, string>): void;
}
export interface DashboardCalendarView {
  id: string;                 // "staffing", "rota" — becomes the address's view name
  labelKey: string;
  order: number;              // after Opening hours' own tabs
  requiresPermission: string;
  readPermission?: string;
  create(ctx: DashboardModuleContext, host: CalendarViewHost): DashboardScreenHandle;
}
export interface DashboardContribution extends DashboardFurtherScreen {
  // …existing fields…
  calendarViews?: readonly DashboardCalendarView[];
}
export interface DashboardModuleContext {
  // …existing fields…
  /** The other enabled modules' Calendar views the person may read, ordered by `order`. */
  calendarViews?: readonly DashboardCalendarView[];
}
```

**The layout** (mockups 2–4): a segmented switch sits beside the page title, ABOVE the screen's
existing tabs: "Opening hours", then each module view in `order`. With "Opening hours" chosen the
page is exactly today's (its own tabs and department picker under the switch). With a module view
chosen, the screen's own tabs and picker are hidden and the view's handle renders in their place.
The address is `/manage/opening-hours/view/<id>/<key>/<value>…`; the existing views keep their
addresses, and "Opening hours" is any address whose view is one of the screen's own. The screen's
own `readOnly` (from `venue_service.manage`) applies only to its own views; a module view gets
`host.canWrite` from its own `requiresPermission`.

- [ ] **Step 1: Failing tests.** `dashboard-app.test.ts`: a contribution with a `calendarViews`
  entry reaches the Opening hours screen's context; one whose `readPermission` the person lacks does
  not; two views with the same `id`, or an `id` equal to one of the screen's own views, fail the
  app's validation as duplicate screens do. `opening-hours-screen.test.ts`: given `calendarViews`,
  the switch shows "Opening hours" first then each view's label; choosing one hides the own tabs,
  renders its handle and puts `view/<id>` in the address; `host.open("staffing", { week: "2026-11-30" })`
  moves the address to `view/staffing/week/2026-11-30` and the view receives those `params`;
  reloading that address opens it; a person with the read permission but not the write one gets
  `canWrite: false`; a person without the read permission never sees the view.

- [ ] **Step 2: Run**; FAIL. **Step 3: Implement**: the contract fields; the app collects every
  enabled module's `calendarViews`, filters by permission, validates unique ids, and passes them in
  the `ctx` it hands venue-service's `create`; venue-service passes them to the screen, which renders
  the switch and the chosen view as described above. **Step 4: Run** the three packages' tests; PASS.

- [ ] **Step 5: Rename.** `nav.opening_hours` becomes "Calendar"/"Calendario"; the screen's `h1`
  becomes the same key's text; the screen's own tab for hours reads "Opening hours"/"Horario". Update
  the tests that assert the old title.

- [ ] **Step 6: Commit** `git commit -s -m "A585-3: the Calendar takes other modules' views"`.

### Task 3.2: The staffing month read

**Files:**
- Create: `packages/staffing/src/month.ts`, `src/month.test.ts`
- Modify: `src/routes.ts`, `src/routes.test.ts`

**Interfaces:**
- Produces:

```ts
export interface StaffingMonth {
  month: string;
  days: { date: string; inMonth: boolean; areas: { area: AreaRef; needed: number; unfilled: number | null }[] }[];
}
export async function readStaffingMonth(tx: Transaction, cfg: { locationId: string }, month: string): Promise<StaffingMonth>;
```

  `days` covers whole Monday–Sunday weeks, as the opening-hours month does. `needed` is the number
  of slots; `unfilled` is `null` in this part (A585-6 fills it in).

- [ ] **Step 1: Failing tests:** a month with a season painted for one station and one department
  and one special day reads the right `needed` per day and area; a day with no paint has no areas;
  `GET /month?month=2026-13` is refused `management.request_invalid {field:"month"}`.
- [ ] **Step 2–4:** implement over `resolveStaffing` and `slotsForDay`, run, PASS.
- [ ] **Step 5: Commit** `git commit -s -m "A585-3: the staffing month read"`.

### Task 3.3: The Staffing view's month

**Files:**
- Create: `packages/staffing/src/dashboard/staffing-month.ts` (+ `.test.ts`, `.a11y.test.ts`)
- Modify: `packages/staffing/src/dashboard/index.ts` (adds `calendarViews: [{ id: "staffing",
  labelKey: "staffing.view.tab", order: 10, requiresPermission: "staffing.manage", readPermission: "venue.view", … }]`;
  Staff roles stays the module's `screen`), `client.ts`, `strings.ts`, `live-queries.ts`
  (`staffing-month`: `staffing_days`, `staffing_blocks`, `staff_roles`, `departments`,
  `kitchen_stations`, `seasons`, `special_days`, `special_day_dates`,
  `location_business_day_settings`, `location_day_cutover_changes`)

- [ ] **Step 1: Failing browser tests** (mockup 2, top): the month grid shows, per day, a line per
  area "Kitchen 4" with a bar whose width follows the number; an area picker (All areas / one area)
  filters; season chips and month stepping follow the host's month; "Rota for this week" calls
  `host.open("rota", { week })` (the Rota view arrives in A585-6; until then the button is hidden);
  clicking a day calls `host.open("staffing", { painter: "season", season: <id> })` or, on a
  special day, `{ painter: "special-day", "special-day": <id> }` (hidden until A585-4; the Staffing
  view opens its painter when `host.params.painter` is set); both themes, 1280
  and 390 px.
- [ ] **Step 2–4:** implement, run, PASS. Look at it in the dev stack in both themes.
- [ ] **Step 5: Commit** `git commit -s -m "A585-3: the Staffing view's month"`.

---

## Part A585-4 — the staffing painters

Branch `feat/a585-4-staffing-painters`. Waits for A585-3.

### Task 4.0: Re-check on the base

- [x] Read the landed `paint-model.ts`, `paint-grid.ts`, `painter-frame.ts`, `season-painter.ts`
  and `special-day-painter.ts` in `packages/venue-service`, and the A506 plan's Tasks 8.2–8.6 and
  9.x. List the frame's slots, properties and events, `stepAt`'s signature, the drag-autoscroll and
  "Copy to…" menu code, and how the season painter's address is built. Correct Tasks 4.1–4.3 in
  this branch before starting them; commit the plan fix on its own.

**Corrections from Task 4.0 (re-checked on `main` f87319704, 2026-10-15).** Where these differ from
Tasks 4.1–4.3 below, these win. Paths are under `packages/venue-service/src/` unless named.

- **What exists.** `paint-model.ts` is at `src/paint-model.ts`, not under `dashboard/`.
  `stepAt(offsetPx, rowPx, cutover): string` (`paint-model.ts:71`) and
  `stepMinuteAt(offsetPx, rowPx, cutover): number` (`:76`, minutes from the changeover; the grid
  calls it as `stepMinuteAt(clientY - box.top, box.height / ROWS, cutover)`, `paint-grid.ts:435-438`).
  `clockAt(step, cutover)` is `day-paint.ts:33`. Staffing already has its own `blockSpan`
  (`packages/staffing/src/slots.ts:58`), so it needs only `stepMinuteAt` and `clockAt`.
- **The frame** (`dashboard/painter-frame.ts`) is a `wt-modal size="full"` (`:166`), not the native
  dialog the A506 plan describes. Properties (`:126-139`): `open`, `heading`, `scope`, `dirty`,
  `coordinator`, `busy`, `refusal` (shown beside Save), `readOnly` (only ✕). Slots: `picker`, `link`,
  `actions` (before Cancel/Save), `row` (above the content), default (fills the rest)
  (`:191-203`, `:228-229`). Events: `painter-save` (`:161`, only on a dirty draft and not busy) and
  `painter-close` (`:175`, after it has closed, however). Its Cancel, Save and ✕ labels come from
  venue-service's `t` (`:13`), whose `strings.ts` registers the whole venue-service catalogue on load
  (`strings.ts:1731-1733`); in the app that catalogue is already loaded, and its keys do not collide
  with `staffing.*`. Reusing venue-service's own words for the shared pieces (Cancel, Save, Copy to…,
  Clear) is intended; staffing's own text keeps the `staffing.` prefix.
- **What is private in `dashboard/paint-grid.ts` today** (everything below is a `#` member or inline
  template of the one `PaintGrid` element): the time ruler (hour list `:862-863`, `.times` `:916-923`,
  hour lines `:942-948`, CSS `:157-193`, `ROWS = 96` `:48`); the scroll box with its overflow fade
  (`:78-117`, `:371-398`); the column heading ⋮ menu with "Copy to…" and Clear (`:893-912`, CSS
  `:118-156`); the copy chooser (`:656-694`, `:812-859`, CSS `:288-332`); popover placement `#place`
  (`:570-577`); the drag stroke and its edge-band autoscroll (`MAX_SCROLL_STEP`/`BAND_DWELL_MS`
  `:49-53`, `#start`…`#stop` `:440-557`, including the click-after-drag suppression `#dragged`).
  The grid's public surface, for reference: properties `columns`, `days`, `underlay`, `periods`,
  `chosen`, `cutover`, `closedErases`, `columnErrors`, `paintable`, `closedAllDay`, `readOnly`,
  `target` (`:336-355`); event `paint-change` `{ key, day }` (`:417-425`); slots `column-menu-<key>`
  and `column-head-<key>` (`:895`, `:913`). A block is found by `startsAt` (`:412-416`), which is
  unique there; staffing blocks are not (two sous chefs may start at 09:00), so the staffing grid
  finds a block by index.
- **The `./painter` export** (`dashboard/painter.ts`, `package.json` `"./painter"`), decided:
  `PainterFrame` (and its side-effect registration), `stepMinuteAt`, `stepAt`, `clockAt`,
  `periodColourStyles` (`dashboard/period-colour-styles.ts:15`; staff roles use the same
  `CalendarColour`, `packages/staffing/src/staffing-types.ts:2`), `paintRowStyles`
  (`dashboard/paint-row.ts:16`; staffing draws its own chip row with those classes, because
  `paintRow` hard-codes "+ New period" and the period hint, `paint-row.ts:180,185`), `seasonLastDay`
  (`season-rules.ts:48`), and the pieces extracted from `paint-grid.ts` into a new
  `dashboard/paint-grid-parts.ts`: `ROWS`, `hourMarks(cutover)`, `timeRuler(cutover)`,
  `hourLines(cutover)`, `paintGridStyles` (the scroll, layout, heading, ruler, day, line, menu and
  chooser CSS), `OverflowFade` (a controller for `:371-398`), `columnMenu(label, { copy, clear },
  extra?)` (extra items let staffing add "Follow the season"), `placePopover(popup, trigger,
  alignEnd)`, `ColumnStroke` (a controller for the drag stroke and autoscroll, calling back with the
  preview stretch and the released stretch in minutes), and `CopyChooser` (a controller plus its
  template; it reports `from` and the ticked keys and leaves the copying to its host). (2026-10-15,
  as built: `isDeleteKey` is exported from `paint-grid-parts.ts` and `./painter` too.) `paint-grid.ts`
  then uses them, and `paint-grid.test.ts`/`paint-grid.a11y.test.ts` stay unchanged as the proof
  that its behaviour did not move. Nothing reachable from these imports a client or anything
  server-side: run on 2026-10-15 with a copy of the purity guard's scan
  (`scripts/dashboard-browser-purity.test.ts:51-91`) from `painter-frame.ts`, `paint-model.ts`,
  `day-paint.ts`, `paint-grid.ts` and `paint-row.ts`, it reached no forbidden specifier and no server
  entry (the `import type` edge `day-paint.ts:1` → `service-day.ts` reaches only `@waitron/shared`,
  `@waitron/reporting` and `@waitron/module`, which the scan does not follow).
- **The purity guard takes a directory today** (`SUBPATHS` `:24-28`, read by `tsFiles(dir)` `:30-38`),
  and the whole `src/dashboard` of venue-service fails it: the same scan from every non-test file
  there reached `@waitron/db` or `drizzle-orm` in 28 files (`season-weeks.ts`, `schema/*.ts`, …). So
  Task 4.1 lets an entry name a FILE (`tsFiles` returns `[path]` for a `.ts` path; 2026-10-15, as
  built: for a path `statSync().isFile()` calls a file, whatever its name) and adds
  `["@waitron/venue-service/painter", "packages/venue-service/src/dashboard/painter.ts"]`
  (2026-10-15, as built: `SUBPATHS` is now a plain list of paths, so the entry is the path alone).
  A585-3's `./dashboard/season-tint` export has no entry; leave it.
- **The server barrel** (`index.ts`) also gains `resolveDepartmentsDays` (`day-resolver.ts:110`, not
  exported today; the special-day guides below need it). (2026-10-15, as built: it gains
  `readSpecialDayPlan` beside it, which the special-day staffing read uses.)
- **Station guides: none, in both painters.** venue-service has no per-weekday station hours read:
  `stationServiceTimes` (`station-service-times.ts:70`, exported `index.ts:55-59`) works per DATE, at
  most 42 days (`:80-82`), and answers `always: "default"` for the default station. `readSeasonStaffing`
  already returns a key for every area with stations' weekdays empty
  (`packages/staffing/src/paint.ts:243-257`, `staffing-types.ts:24-25`). Add a backlog entry for a
  station's guide.
- **The painter reads lack what the painters show.** `SeasonStaffing` has no changeover, no season
  name and no season list; `SpecialDayStaffing` has no changeover, no name and no guides
  (`staffing-types.ts:22-36`). The seasons in `StaffingMonth` are only those the month touches
  (`staffing-types.ts:60-61`), so they cannot drive ‹ ›. New Task 4.2a adds: `SeasonStaffing.cutover`
  and `SeasonStaffing.seasons` (every season, `readSeasons` order, `{ id, name, startsOn }`; the
  dashboard works out each `lastDay` with `seasonLastDay`, as `season-painter.ts:535` does);
  `SpecialDayStaffing.cutover`, `.name`, and `.guides: Record<areaKey, Record<dateId, { startsAt;
  endsAt }[]>>` (departments from `resolveDepartmentsDays` with `readLocationClock`; stations empty;
  a date closed all day gives `[]`). The painters read once when opened or stepped and after a save
  (passive GET), and do not follow live changes to the staffing while open (2026-10-15, as built:
  the staff roles do follow live changes while open); a save replaces only the pairs it sends
  (`paint.ts:262-287`, `:321-342`).
- **Staff role dialog** exists as named: `<staff-role-dialog .api .staffRole .open>`
  (`packages/staffing/src/dashboard/staff-role-dialog.ts:45,60-63`), emitting `staff-role-saved`
  (detail: the `StaffRole`, `:263`) and `staff-role-close` (`{ wrote }`, `:360`). "+ New staff role"
  opens it with no `staffRole`, and a `staff-role-saved` chooses the new staff role as the chip. Render
  it AFTER `<painter-frame>`, as a sibling, as `season-painter.ts:656` does with its period dialog. Its
  people list needs `person.manage` (`client.ts:115-119`) and shows its own error without it.
- **How the month opens a painter.** The venue-service season painter's address is
  `seasonPainterPath` → `view/season/season/<id>/department/<id>/zone/<id>`
  (`dashboard/opening-hours-paths.ts:14-25`), pushed by `openPainter` and rewritten in place on
  `painter-navigate` (`opening-hours-screen.ts:586-605`, `:700-704`). A module view has only
  `host.open(view, params)` (`packages/dashboard-kit/src/contract.ts:50-58`), which always PUSHES and
  asks the leave question first when anything is dirty (`opening-hours-screen.ts:269-274`, `:546-555`; `packages/ui/src/navigation-guard.ts:172-176`).
  So:
  - address: `view/staffing[/month/<m>][/area/<areaKey>]/painter/season/season/<seasonId>` and
    `…/painter/special-day/special-day/<specialDayId>`; the Staffing handle (`dashboard/index.ts:25-36`)
    renders `<staffing-month>` and, when `host.params.painter` is `season` or `special-day`, the
    painter beside it, with `readOnly = !host.canWrite`;
  - the month: each day becomes a `<button class="day">` when `canWrite`, with the roving focus of
    `opening-hours-month.ts:309-330,524-536,645-671`; today it is a `div role="group"`
    (`staffing-month.ts:445`). A day with `specialDay` opens the special-day painter, otherwise one
    with `seasonId` opens the season painter, otherwise it is not a button. A season chip's name
    (today an `<li>`, `:393`) becomes a button opening that season. (2026-10-15, as built: for a
    person who may only look, a special day's date is a button too, opening the read-only
    special-day painter; their other days stay plain.) Both keep `month` and `area`;
    the month's `#go` (`:301-303`) drops `painter`, `season` and `special-day`;
  - inside the painter the area picker is the painter's own state, starting from `params.area` (else
    the first area), and never writes the address: a `host.open` would ask the leave question and the
    draft must survive a switch. ‹ › call `host.open` with the new `season` (the leave question
    covers the draft); close calls `host.open("staffing", { month, area })` from `painter-close`.
    Each step and close adds a history entry, because the host has no replace.
- **Task 4.2's grid, as it will be built** (`packages/staffing/src/dashboard/staffing-grid.ts`,
  element `staffing-grid`): properties `columns: readonly { key; label }[]` (stable between renders,
  as `season-painter.ts:597-610` keeps them), `days: ReadonlyMap<string, readonly StaffingBlock[] |
  null>` (null: follows the season), `guides: ReadonlyMap<string, readonly { startsAt; endsAt }[]>`,
  `staffRoles`, `chosen` (a staff role id or `undefined`), `headcount` (1–50, the server's bound,
  `paint-rules.ts:34-41`; 2026-10-15, as built: the grid passes `headcount` on as given, the paint
  row's How many keeps it within 1–50, and the block menu's How many ignores a value outside it),
  `cutover`, `readOnly`, `target` (as `paint-grid.ts:353-355`),
  `columnErrors`, `followable` (adds "Follow the season" to each ⋮); event `staffing-change`
  `{ key, blocks: StaffingBlock[] | null }`, bubbling and composed. A column whose value is null shows
  a "Follows the season" note; painting on it starts from `[]`. Hours never stop painting: there is
  no `closedAllDay` (spec: staffing paint is independent of the hours). The block menu offers the
  staff roles, a How many `wt-number-stepper` and Delete. Keyboard is the shared grid's: blocks are
  buttons in tab order, Enter opens, Delete or Backspace deletes (`paint-grid.ts:642-649`); there are
  NO arrow keys between blocks. `copyDay` in `block-model.ts` copies `null` as a value.
- **Refusals** map as `season-painter.ts:480-515` does: `staffing.invalid` whose `field` is
  `edits.<i>.…` (`packages/staffing/src/routes.ts:94-105`) names the i-th SENT edit, so the painter
  switches its picker to that area and marks that column; any other code shows `codeMessage(code)`
  beside Save, the draft kept.
- **Not built:** the mockup's "Opening hours | Staffing" switch inside the painter bar (the host can
  return only to Opening hours' month or year, `contract.ts:56`), and the season's blocks drawn
  faintly under a special-day column that follows the season.
- **Task 4.3's files:** no `.save-state.test.ts` — no guard asks for one (`git grep save-state --
  scripts docs/developers` finds nothing), the frame owns Save's state and is tested there, and
  venue-service's painters have none; save and refusal cases go in each painter's `.test.ts`. Keep
  `.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`.
- **Split, to stay under about 100 tool calls a dispatch:**
  - **4.1a** `./painter` with the frame, the pure helpers, the two style exports and `seasonLastDay`;
    the purity guard's file entry; `resolveDepartmentsDays` on the barrel.
  - **4.1b** extract `paint-grid-parts.ts` from `paint-grid.ts` and re-export it from `./painter`;
    paint-grid's tests unchanged.
  - **4.2a** `block-model.ts` (node tests) and the read changes above in `paint.ts`,
    `staffing-types.ts` and `client.ts` (`readSeason`, `saveSeason`, `readSpecialDay`,
    `saveSpecialDay`).
  - **4.2b** `staffing-grid.ts` with its `.test.ts` and `.a11y.test.ts`.
  - **4.3a** the season painter, and the month's day, chip and address wiring.
  - **4.3b** the special-day painter.

### Task 4.1: venue-service exports its painter frame

**Files:**
- Modify: `packages/venue-service/package.json` (an `exports` entry `"./painter"`), create
  `packages/venue-service/src/dashboard/painter.ts` re-exporting `painter-frame.ts` and the
  browser-safe helpers of `paint-model.ts` (`stepAt`) and of `paint-grid.ts` that draw the time
  ruler and the column heading menu (extract them into their own file if they are private today,
  keeping `paint-grid.ts` behaviour and tests unchanged);
  `scripts/dashboard-browser-purity.test.ts` (`SUBPATHS` gains `["@waitron/venue-service/painter", …]`).
- [x] Steps: failing purity case → export → run venue-service's browser tests and the root guard →
  commit `"A585-4: venue-service exports its painter frame"`.

### Task 4.2: The staffing block model and grid

**Files:**
- Create: `packages/staffing/src/block-model.ts` (+ node test), `src/dashboard/staffing-grid.ts`
  (+ `.test.ts`, `.a11y.test.ts`)

**Interfaces:**
- Produces:

```ts
// block-model.ts (browser-safe)
export function addBlock(day: readonly StaffingBlock[], block: StaffingBlock): StaffingBlock[];
export function resizeBlock(day: readonly StaffingBlock[], index: number, edge: "start" | "end", time: string, cutover: string): StaffingBlock[];
export function changeBlock(day: readonly StaffingBlock[], index: number, change: Partial<Pick<StaffingBlock, "staffRoleId" | "headcount">>): StaffingBlock[];
export function deleteBlock(day: readonly StaffingBlock[], index: number): StaffingBlock[];
export function copyDay<K>(days: ReadonlyMap<K, readonly StaffingBlock[]>, from: K, to: readonly K[]): Map<K, StaffingBlock[]>;
/** Side-by-side layout: each block's lane and the lane count of its overlap group. */
export function laneLayout(day: readonly StaffingBlock[], cutover: string): { lane: number; lanes: number }[];
```

  `staffing-grid` element: properties `columns: { key: string; label: string; blocks: StaffingBlock[]; guide: { startsAt: string; endsAt: string }[] }[]`,
  `cutover`, `staffRoles: StaffRole[]`, `chosenStaffRoleId`, `headcount`; event
  `staffing-change` with `{ key, blocks }`.

- [x] **Step 1: Failing node tests** for the model: `laneLayout` of the mockup's Friday (head chef
  09:00–16:30, sous 09:00–15:00, sous 11:00–17:00, dishwasher 13:00–16:30) gives four lanes for the
  first group; two blocks that only touch (one ends 15:00, one starts 15:00) share a lane; a resize
  never crosses the changeover nor makes start ≥ end; `copyDay` copies by value (editing the copy
  leaves the source unchanged).
- [x] **Step 2: Failing browser tests** for the grid: a drag down a column adds a block of the
  chosen staff role and headcount; overlapping blocks sit side by side; dragging an edge resizes;
  clicking a block opens its staff role and headcount and Delete (Backspace too); each column's ⋮
  offers "Copy to…" and Clear; the guide ranges are drawn faintly behind; keyboard: arrow keys move
  between blocks, Enter opens one; a11y in both themes. (2026-10-15, as built: as the corrections
  above say, there are no arrow keys between blocks; blocks are reached by Tab.)
- [x] **Steps 3–5:** implement (the grid uses Task 4.1's ruler, step and menu helpers), run, PASS,
  commit `"A585-4: the staffing block grid"`.

### Task 4.3: The season and special-day staffing painters

**Files:**
- Create: `packages/staffing/src/dashboard/staffing-season-painter.ts`,
  `staffing-special-day-painter.ts` (each + `.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`,
  `.save-state.test.ts`)
- Modify: `packages/staffing/src/dashboard/staffing-month.ts` (clicking a day or a season chip opens
  the painter), `client.ts`, `strings.ts`

- [x] **Step 1: Failing browser tests** (mockup 2, bottom): the frame's title is the season ("Winter
  week") with ‹ › stepping; the picker lists departments then prep stations, grouped; the chips are
  staff roles plus "+ New staff role" (opens Task 1.3's dialog) and a How many stepper; the guide
  behind an area is `SeasonStaffing.guides[areaKey][weekday]` (a station's guide is whatever Task
  4.0 found A506-12 offers per weekday, else none); switching the picker keeps the draft for the
  area left; Save sends only the
  edited (area, weekday) pairs in one `PUT /seasons/:id`; a refusal keeps the draft and shows beside
  Save; Cancel with changes asks first. The special-day painter: one column per date, "Follow the
  season" per column (sends `blocks: null`) and Clear (sends `[]`).
- [x] **Steps 2–5:** implement, run, look at both painters in the dev stack in both themes and at
  390 px, commit `"A585-4: the staffing painters"`.

---

## Part A585-5 — workforce: what staff see, copying a week, describing shifts, warnings

Branch `feat/a585-5-workforce-rota`. Waits for A585-1 and A10-3. Re-read A10-1…3's changes to
`packages/workforce/src/clocking.ts` and `schedule-reads.ts` first.

### Task 5.1: Own shifts are published shifts

**Files:**
- Modify: `packages/workforce/src/schedule-reads.ts:54-85` (+ `schedule-reads.test.ts`),
  `apps/server/src/schedule-api.test.ts`, `apps/server/src/me-api.test.ts`,
  `apps/server/src/me-api.cross-person.test.ts`, `apps/dashboard/src/api/live-queries.ts:484`,
  the till's live-query list for `listMyShifts` if it has one

- [x] **Step 1: Failing test** in `schedule-reads.test.ts`: a person with one shift in a published
  version, one in a draft version and one in no version sees only the published one. The existing
  cases that insert unattached shifts and expect to see them now attach them to a published version
  first; keep each case's other assertions as they are.
- [x] **Step 2: Run**; FAIL. **Step 3:** add
  `join roster_versions rv on rv.id = shifts.roster_version_id and rv.status = 'published'` to the
  query (keep `shifts` unaliased: `shiftLocalDate` names it). Add `roster_versions` to the
  `listMyShifts` live-query dependencies. **Step 4: Run** the workforce, server and dashboard tests
  named above; PASS. **Step 5: Commit** `"A585-5: staff see only published shifts"`.

### Task 5.2: Copy a published week into a new draft

**Files:**
- Modify: `packages/workforce/src/clocking.ts` (+ `scheduling.test.ts`)

**Interfaces:**
- Produces: `WorkforceBackend.copyPublishedToDraft(tx, { versionId }): Promise<{ versionId: string; shiftIds: Map<string, string>; openSwaps: { swapId: string; fromShiftId: string }[] }>`
  (old shift id → new shift id; the open swap requests now on the copies).

- [x] **Step 1: Failing tests:** copying a published version creates a draft for the same location
  and period whose shifts equal the published ones field by field except `id` and
  `roster_version_id`; the published version and its shifts are unchanged; copying a draft or a
  superseded version is refused `roster.not_published` (declare the code in workforce's `errors.ts`);
  copying while a draft for the period exists is refused `roster.draft_exists`; publishing the new
  draft supersedes the old version and staff then see the new shifts only. **Swaps (owner,
  2026-10-13: "just warn that one exists, because it may still be valid after the change"):**
  approving a swap only changes the request's status (`decideSwap`, `shift-swaps.ts:95`), so a
  request survives the copy. In the same transaction, every swap request on the week's shifts still
  waiting for a decision (`requested` or `accepted`) is re-pointed to the copies
  (`from_shift_id`, and `to_shift_id` when set, through the id map); decided ones (`approved`,
  `rejected`) stay with the superseded shifts as history. The answer also carries
  `openSwaps: { swapId: string; fromShiftId: string }[]` (new ids) so the caller can warn. Test: an
  open request follows its shift to the copy and can still be accepted and decided there; a decided
  one stays on the old shift.
- [x] **Steps 2–4:** run (FAIL), implement (insert the version, then `insert … select` the shifts
  with new ids, returning the map), run (PASS). **Step 5: Commit** `"A585-5: copy a published week into a draft"`.

### Task 5.3: Modules describe shifts

**Files:**
- Modify: `packages/module/src/module.ts` (the `WaitronModule` seat), `packages/workforce/src/schedule-reads.ts`
  (`PersonShiftRow` gains `description: string | null`), `apps/server/src/schedule-api.ts`,
  `apps/server/src/me-api.ts`, `apps/server/src/boot.ts` (~1710, build `describeShifts` from the
  enabled modules), `apps/till/src/api/client.ts:1694`, `apps/till/src/screens/till-schedule-screen.ts:431-436`,
  `apps/dashboard/src/api/client.ts:1024`, `apps/dashboard/src/screens/my-schedule-screen.ts:356-361`,
  their tests; `packages/staffing/src/describe-shifts.ts` (+ test), `packages/composition/src/modules.ts`
  (staffing's entry gains `describeShifts`)

**Interfaces:**
- Produces:

```ts
// packages/module/src/module.ts, on WaitronModule
/** Labels a person's shifts for the till and My schedule ("Kitchen · Sous chef"); omit the ids it cannot label. */
describeShifts?: (tx: Transaction, shiftIds: readonly string[]) => Promise<Map<string, string>>;
// packages/staffing/src/describe-shifts.ts
export async function describeShifts(tx: Transaction, shiftIds: readonly string[]): Promise<Map<string, string>>;
```

- [x] **Step 1: Failing tests:** staffing's `describeShifts` answers "Kitchen · Sous chef" for an
  assigned shift (area name, then staff role name) and nothing for an unassigned one; the till's
  `/api/schedule/shifts` and the dashboard's `/management-api/me/schedule/shifts` carry
  `description` from the seat and fall back to the free-text `role` when no module describes the
  shift; with staffing disabled the description is the role. The till and My schedule show
  `time · description`. **Live updates:** core apps cannot name staffing's tables, so renaming an
  area or a staff role does not refresh an open My schedule until its next read; adding or moving a
  shift does, through `shifts` and `roster_versions`. Accepted; say so in the PR.
- [x] **Steps 2–5:** run (FAIL), implement, run every package touched (PASS), commit
  `"A585-5: modules describe shifts for the till and My schedule"`.

### Task 5.4: The warnings route

**Files:**
- Modify: `apps/server/src/workforce-api.ts` (+ `workforce-api.test.ts`, the gate-sweep test)

- [x] **Step 1: Failing tests:** `GET /management-api/roster/breaches?locationId&period` answers
  `{ breaches, ruleset }`. It runs `validateRoster` over THREE weeks — the week before, the week
  asked for and the week after — each week's shifts being its roster's (the draft if there is one,
  otherwise the published version, as `getRoster` chooses) plus that week's unattached shifts by
  calendar date, with the location's ruleset; it keeps only the breaches that touch the week asked
  for. Three weeks because rest between shifts crosses a week's edge and weekly rest is judged only
  for a person's own "middle weeks" (`roster-validation.ts:301-303`); a person with no shifts in the
  week before or after is still not judged for weekly rest (accepted; say so in the PR). Rest between shifts
  crosses a week's edge (`roster-validation.ts:58-59,66-68`). Cases: a Sunday-night shift followed
  by a Monday-morning one in the next week gives `rest_too_short` on the Monday; a location with no
  `convenio_config` row answers 409 `convenio.not_found`; a staff session is refused 403; the gate
  sweep covers the route. The annual overtime cap and each person's running total arrive with A586
  (the spec's open point 6); this route does not judge the cap.
- [x] **Steps 2–5:** run, implement, run, commit `"A585-5: the rota's warnings route"`.

### Task 5.5: The roster checks are importable in a browser

**Files:**
- Modify: `packages/workforce/package.json` (add an `exports` map: `"."` → `./src/index.ts`,
  `"./roster-validation"` → `./src/roster-validation.ts`, and `"./test/fixtures.js"` →
  `./test/fixtures.ts`, which `packages/workforce-es/test/fixtures.ts:9` imports; before adding the
  map, `rg -n "@waitron/workforce/" packages apps scripts bench` and add every other deep path it
  finds), a test in `packages/workforce` that reads `roster-validation.ts`, `ruleset.ts` and the
  files they import and asserts each import is `import type` or relative to a file in the same list.

- [x] Steps: failing test → add the map (keep `main`) → `pnpm --filter @waitron/workforce typecheck`,
  the workspace typecheck of every package importing `@waitron/workforce`, and
  `pnpm --filter @waitron/workforce-es test` → PASS → commit
  `"A585-5: the roster checks are importable in a browser"`.

---

## Part A585-6 — the Rota view by area

Branch `feat/a585-6-rota-by-area`. Waits for A585-3 and A585-5.

### Task 6.1: The rota read

**Files:**
- Create: `packages/staffing/src/rota.ts`, `src/rota.test.ts`
- Modify: `src/staffing-types.ts` (`RotaWeek`), `src/routes.ts` (`GET /rota`), `src/routes.test.ts`

**Interfaces:**
- Consumes: `WorkforceBackend.getRoster` (`clocking.ts:396`); `absences` (`@waitron/workforce`);
  `readLocationClock` (`@waitron/reporting`), `cutoverForBusinessDay` (`@waitron/shared`);
  `resolveStaffing`; `slots.ts`.
- Produces:

```ts
// staffing-types.ts
export interface RotaWeek {
  week: string; // the Monday
  version: { id: string; status: "draft" | "published"; changedSincePublished: boolean } | null;
  days: {
    businessDay: string; cutover: string;
    areas: { area: AreaRef; match: AreaDayMatch }[];
    notInSlot: { shiftId: string; outsideWeek: boolean }[];
  }[];
  shifts: PlacedShift[];
  people: { personId: string; name: string; staffRoleIds: string[]; contractedMinutes: number | null; plannedMinutes: number }[];
  absences: { personId: string; startsOn: string; endsOn: string }[]; // approved time off touching the week
  areas: { area: AreaRef; name: string; active: boolean }[];
  staffRoles: StaffRole[];
}
// rota.ts
export async function readRotaWeek(tx: Transaction, cfg: { locationId: string }, week: string): Promise<RotaWeek>;
```

**Which shifts a week holds** (the spec's open point 4): the shifts of the week's roster version,
as `getRoster` returns them (the draft if there is one, otherwise the published version), plus any
unattached shift whose calendar date falls in the week. Writes from the Rota view always attach the
shift to the week's version (Task 6.1b), so `publishRoster`'s calendar-date rule only ever sees
unattached shifts made outside the Rota view. Each shift is placed on its business day with
`placeShift`. A shift whose business day falls outside the week (a version's Monday 00:30 shift
places on the previous Sunday) is listed in `notInSlot` of the week's first or last day with
`outsideWeek: true`. `validateRoster` keeps grouping by calendar date; that mismatch is accepted and
tested here.

A shift whose assignment names a switched-off department or station is in `notInSlot`, not matched.
`changedSincePublished` is true when the version is a draft and a published version for the same
week also exists.

- [ ] **Step 1: Failing tests** (`rota.test.ts`, database):
  - A 01:00 shift on the Monday AFTER the week, in the week's version, appears on the week's last
    (Sunday) business day, and is
    read although its calendar date is Monday (**Review Focus 1**). A version shift at Monday 00:30
    of the week's first day is in day 0's `notInSlot` with `outsideWeek: true`.
  - Unassigned shifts are in `notInSlot`; `people.plannedMinutes` sums each person's week across
    areas; approved absences touching the week are listed and pending ones are not.
  - After `update departments set active = 0`, that department's shifts are in `notInSlot` and its
    slots are gone (**Review Focus 5**).
  - A draft beside a published version reads the draft with `changedSincePublished: true`.
  - `GET /rota?week=2026-12-01` (not a Monday) is refused `management.request_invalid {field:"week"}`;
    a staff session is refused 403 (`schedule.manage`).
- [ ] **Steps 2–5:** run (FAIL), implement, run (PASS), commit `"A585-6: the rota read"`.

### Task 6.1b: The rota writes

**Files:**
- Modify: `packages/staffing/src/rota.ts`, `src/rota.test.ts`, `src/routes.ts`, `src/routes.test.ts`

**Interfaces:**
- Consumes: `WorkforceBackend.createRosterVersion`, `addShift`, `updateShift`, `removeShift`;
  `localTimeOccurrences`, `offsetMinutes` (`@waitron/venue-service/hours-occurrences`).
- Produces:

```ts
export async function addRotaShift(tx: Transaction, cfg: { locationId: string }, input: {
  week: string; personId: string; businessDay: string; area: AreaRef; staffRoleId: string; startsAt: string; endsAt: string;
}): Promise<string>;
export async function updateRotaShift(tx: Transaction, cfg: { locationId: string }, shiftId: string, patch: {
  personId?: string; startsAt?: string; endsAt?: string; area?: AreaRef; staffRoleId?: string;
}): Promise<void>;
export async function removeRotaShift(tx: Transaction, cfg: { locationId: string }, shiftId: string): Promise<void>;
```

- [ ] **Step 1: Failing tests:**
  - `addRotaShift` creates the week's draft when the week has no version, converts the wall times
    (business day + `HH:MM`, placed with the day's changeover via `calendarDateOfTime` semantics) to
    instants with the location's time zone, stores the assignment, and `readRotaWeek` then shows the
    slot filled.
  - Europe/Madrid, business day 2027-03-27 (its 02:00 is calendar 2027-03-28, the spring-forward
    night): a 02:00 start is refused `staffing.invalid {field:"startsAt"}`. Business day 2026-10-24
    (its 02:30 is calendar 2026-10-25, the autumn night): a 02:30 start takes the earlier of the
    two instants (`+02:00`) (**Review Focus 2**).
  - Two `addRotaShift` calls for the same slot both succeed; the read shows one filled slot and one
    over shift (**Review Focus 3**).
  - Writing to a week whose only version is published is refused `roster.not_draft`.
  - `updateRotaShift` with only `area` or `staffRoleId` on a shift of a published version is refused
    `roster.not_draft` before `shift_assignments` is touched (staffing checks the version status
    itself: `updateShift` is not called for an assignment-only change).
  - `updateRotaShift` on an unassigned shift with `area` and `staffRoleId` creates its assignment
    ("Not in a slot" → assigned).
  - An area that is switched off or not at the location is refused `staffing_area.not_found`; an
    unknown staff role `staff_role.not_found`.
- [ ] **Steps 2–5:** run (FAIL), implement, add the three routes, run (PASS), commit
  `"A585-6: the rota writes"`.

### Task 6.1c: Unfilled counts in the month

**Files:** Modify `packages/staffing/src/month.ts`, `month.test.ts`.

- [ ] Failing test: a month with a rota for one week shows `unfilled` for that week's days and `null`
  for weeks with no version → implement over `readRotaWeek`'s matching → run → commit
  `"A585-6: unfilled slots in the staffing month"`.

### Task 6.2: The Rota view, by area

**Files:**
- Create: `packages/staffing/src/dashboard/rota-view.ts`, `rota-by-area.ts` (each + `.test.ts`,
  `.a11y.test.ts`)
- Modify: `src/dashboard/index.ts` (`calendarViews` gains `{ id: "rota", labelKey: "staffing.rota.tab",
  order: 20, requiresPermission: "schedule.manage", readPermission: "schedule.manage", … }`),
  `client.ts`, `strings.ts`, `live-queries.ts` (`rota`: `shifts`, `roster_versions`,
  `shift_assignments`, `staffing_days`, `staffing_blocks`, `staff_roles`, `person_staff_roles`,
  `persons`, `employments`, `absences`, `departments`, `kitchen_stations`, `seasons`,
  `special_days`, `special_day_dates`, `locations`, `location_business_day_settings`,
  `location_day_cutover_changes`), `staffing-month.ts` (show "Rota for this week")

- [ ] **Step 1: Failing browser tests** (mockup 3): week stepping through `host.open("rota", { week })`;
  an area picker; rows are staff roles in position order; each day lists its slots with the person's
  name and draws filled, partly uncovered ("uncovered 14:00–17:00"), unfilled (dashed, "+ unfilled"),
  over ("not needed") and outside role differently; a last row "Not in a slot" (read-only until
  A585-7's shift dialog; an `outsideWeek` entry says "belongs to the next/previous week"); the header
  counts what needs attention; the side panel lists everyone's week hours against their contract
  with over-contract in the warning colour; a closed day shows "closed"; a published week shows no
  editing controls; both themes, 1280 and 390 px.
- [ ] **Steps 2–5:** implement, run, commit `"A585-6: the Rota view by area"`.

### Task 6.2b: The slot picker

**Files:**
- Create: `packages/staffing/src/dashboard/slot-picker.ts` (+ `.test.ts`, `.a11y.test.ts`)
- Modify: `rota-by-area.ts`, `client.ts`, `strings.ts`

- [ ] **Step 1: Failing browser tests** (mockup 4, the picker card): clicking an unfilled slot opens
  the picker listing people who hold the staff role first, each with "free", "working HH:MM–HH:MM"
  (an overlapping shift that day) or "on leave" (an approved absence that day) and their week hours
  against their contract; "Show everyone" lists the rest; choosing someone calls `addRotaShift` and
  the slot then shows them; a refusal shows inside the picker and keeps it open.
- [ ] **Steps 2–5:** implement, run, look at the Rota view in the dev stack in both themes, commit
  `"A585-6: the slot picker"`.

---

## Part A585-7 — the Rota by person, warnings, Publish and "Change this week"

Branch `feat/a585-7-rota-by-person`. Waits for A585-6.

### Task 7.1: Warnings while planning, and Publish

**Files:**
- Create: `packages/staffing/src/dashboard/rota-warnings.ts` (+ tests), `publish-dialog.ts` (+ tests)
- Modify: `rota-view.ts`, `rota-by-area.ts`, `slot-picker.ts`, `client.ts`, `strings.ts`,
  `packages/staffing/package.json` (nothing new: `@waitron/workforce` is already a dependency)

**Interfaces:**
- Consumes: `GET /management-api/roster/breaches` → `{ breaches, ruleset }` (Task 5.4);
  `validateRoster`, `RosterBreach`, `WorkTimeRuleset` from `@waitron/workforce/roster-validation`
  (Task 5.5) — never from `@waitron/workforce` itself, whose entry exports drizzle tables.

- [ ] **Step 1: Failing browser tests:** after every rota change the view re-reads the breaches and
  draws each on what it names (`rest_too_short`, `break_owed`, `night_work` on the shift by
  `shiftId`; `exceeds_daily_max` on the person's day; `exceeds_weekly_max`,
  `weekly_rest_insufficient` on the person's row), and counts them in the header. The picker shows
  the warning a candidate would cause, computed in the browser with `validateRoster` over the
  week's shifts plus the candidate shift and the returned `ruleset`. A 409 `convenio.not_found` shows
  one notice "Labour rules are not set up", the picker shows no warnings, and filling and publishing
  still work (**Review Focus 4**). Publish lists the warnings with "Back to the rota" and "Publish
  anyway", and publishes through `POST /management-api/roster/:versionId/publish`. Staffing declares
  its own `staffing.breach.*` strings in EN and ES (a package cannot import `apps/dashboard`).
- [ ] **Steps 2–5:** implement, run, commit `"A585-7: warnings while planning, and Publish"`.

### Task 7.2: Changing a published week

**Files:**
- Modify: `packages/staffing/src/rota.ts` (`changeRotaWeek`), `src/rota.test.ts`, `src/routes.ts`
  (`POST /rota/change-week`), `src/routes.test.ts`, `rota-view.ts` (the "Change this week" button),
  `client.ts`, `strings.ts`

- [ ] **Step 1: Failing tests:** `changeRotaWeek` calls `copyPublishedToDraft` and copies every
  `shift_assignments` row onto the new shift ids in the same transaction; the till's own-shift read
  keeps answering the published shifts until the draft is published; when the week has open swap
  requests, the answer lists them and the view warns once ("2 swap requests are open for this week;
  they stay attached to their shifts"); in the draft, a shift with an open swap request carries a
  marker, and deleting it asks first and says the request will be cancelled with it (a swap's
  `from_shift_id` cascades, `schema/shift-swaps.ts:45-49`), while moving it to another person or time
  warns that the request was made for the old one; a published week's view shows "Change this week" and
  no editing controls, and after it the draft's controls.
- [ ] **Steps 2–5:** implement, run, commit `"A585-7: changing a published week"`.

### Task 7.2b: The shift dialog

**Files:**
- Create: `packages/staffing/src/dashboard/shift-edit-dialog.ts` (+ `.test.ts`, `.a11y.test.ts`,
  `.unsaved.test.ts`, `.save-state.test.ts`)
- Modify: `rota-by-area.ts` ("Not in a slot" shifts and filled slots open it), `client.ts`, `strings.ts`

- [ ] **Step 1: Failing browser tests:** fields Person, Area, Staff role, From, To (all required and
  marked; field primitives only); Save quiet and disabled until the draft changes; a refusal naming
  a field shows under it, and every refusal shows once above the buttons; Delete on an existing
  shift asks first; opening a "Not in a slot" shift and choosing an area and staff role assigns it.
- [ ] **Steps 2–5:** implement, run, commit `"A585-7: the shift dialog"`.

### Task 7.2c: The Rota by person

**Files:**
- Create: `packages/staffing/src/dashboard/rota-by-person.ts` (+ `.test.ts`, `.a11y.test.ts`)
- Modify: `rota-view.ts` (the By area | By person switch, kept in the address as `mode/person`),
  `strings.ts`

- [ ] **Step 1: Failing browser tests** (mockup 4): one row per person with their staff roles and
  week hours against their contract; each shift shows its time, area and staff role and its warning;
  "+ Add shift" in a cell opens Task 7.2b's dialog with the day filled in; clicking a shift opens it
  with Delete; a published week shows no editing controls; both themes, 1280 and 390 px.
- [ ] **Steps 2–5:** implement, run, look at both views in the dev stack, commit
  `"A585-7: the Rota by person"`.

---

## Part A585-8 — the old Rota screen and the free-text role go

Branch `feat/a585-8-retire-roster-screen`. Waits for A585-7.

### Task 8.1: Remove the screen, the dialog and the role field

**Files:**
- Delete: `apps/dashboard/src/screens/roster-screen.ts` and its `.test.ts`, `.a11y.test.ts`,
  `.unsaved.test.ts`; `apps/dashboard/src/widgets/shift-dialog.ts` and its four test files
- Modify: `apps/dashboard/src/dashboard-app.ts` (import ~66, `CORE_SCREENS` ~116, the Team nav item
  ~210-218, the render case ~2042) and `dashboard-app.test.ts` (~267, 298, 322, 358, 1630-1636,
  6590); `apps/dashboard/src/api/client.ts` (`Shift.role`, `ShiftInput.role`, `ShiftPatch`,
  `MyShift.role`); `apps/dashboard/src/i18n/strings.ts` (`nav.roster`, `roster.*` keys no longer
  used; keep any the staffing views use); `packages/workforce/src/clocking.ts` (`role` in
  `AddShiftInput`, `UpdateShiftInput`, `ShiftRow`, the insert ~459, the update ~485, the selects
  ~435, ~499, ~869, ~894); `schedule-reads.ts`; `schema/shifts.ts:22`; `schema/shift-templates.ts:29`;
  `apps/server/src/workforce-api.ts` (~159, ~169, ~194); `apps/server/src/schedule-api.ts` and
  `me-api.ts` (the `role` fallback goes); `apps/till/src/api/client.ts`; the test fixtures listed in
  the research (`packages/workforce/test/fixtures.ts:110,123,193,204`, `scheduling.test.ts`,
  `schedule-reads.test.ts`, `workforce-api.test.ts`, `workforce-api.gate-sweep.test.ts:193`,
  `schedule-api.test.ts:96`, `me-api.test.ts:167`, the till and dashboard schedule tests);
  `docs/backlog/dashboard.md` and `docs/backlog.md` lines that name the Rota screen.

- [x] **Step 1:** Grep first: `rg -n "roster-screen|shift-dialog|nav\.roster|shift_role|\.role\b" apps packages --glob '!**/node_modules/**'`
  and list every hit in the PR description.
- [x] **Step 2:** Remove the screen, the dialog, their tests, the nav entry and the role field
  through every layer. The Team menu now reaches the rota through Calendar → Rota; add a dashboard
  test that the Team group no longer lists "Rota".
- [x] **Step 3: Generate the workforce migration** (`pnpm --filter @waitron/workforce db:generate`)
  and READ it. If drizzle-kit rebuilds `shifts` (a `__new_shifts` table and a `DROP TABLE shifts`),
  stop: with foreign keys on, that `DROP TABLE` deletes every `shift_assignments` row (cascade) and
  fails on `shift_swaps` (CLAUDE.md §3). In that case hand-check whether this engine accepts
  `ALTER TABLE shifts DROP COLUMN role` and write a custom migration
  (`db:generate:custom`) with exactly that statement, then prove it with a database test that a
  shift with an assignment and a swap keeps both after migrating.
- [x] **Step 4: Run** `pnpm --filter @waitron/workforce test:coverage`, the server, dashboard and
  till suites touched, `pnpm vitest run scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts scripts/migration-upgrade.test.ts`;
  PASS.
- [x] **Step 5: Commit** `git commit -s -m "A585-8: the old Rota screen and the free-text role go (venue reset)"`.

---

## Not in this plan: counting staffing paint in venue-service's delete confirmations

Departments and stations are never deleted, only switched off, so their staffing paint is kept and
hidden (Task 2.3) and comes back if they are switched on again. Seasons and special days' dates are
deleted, and their staffing paint goes with them (Task 1.1's cascades). Their delete confirmations
do not count that paint (the spec's open point 7): venue-service's delete dialogs cannot read
another module's tables without a new seam, and generic code must never learn staffing exists.
This is an open question for the owner (a delete-impact seam, or no count), recorded as the spec's
open point 7; nothing in this plan depends on the answer.

## Docs and backlog, with every part

- When a part lands, `docs/backlog.md`'s A585 entry names the parts still open; the last part
  deletes the entry.
- A585-3 adds `calendarViews` to `docs/developers/conventions-ui.md` where dashboard contributions
  are described; A585-5 adds `describeShifts` beside the other module seats in
  `docs/developers/conventions-data.md`. Grep both files for "moreScreens" and "settingsPanels" to
  find the place.
- A585-8 updates any developer doc or runbook that names the Rota screen
  (`rg -n "Rota screen|roster-screen" docs`).

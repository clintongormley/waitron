# Service periods, slice 2 — zone closed times and named days (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this slice removes"), and only in a separate commit
> whose message begins `Changed test checks (A366 slice 2):` and lists each `file:line` with its
> before and after. Any other assertion that turns out to need changing is a STOP: report it, do
> not edit it. Adding fixture rows, or a key to a whole-shape pin, is allowed. Turning a named
> day's "own hours" on in a fixture before it writes dated ranges is a fixture change.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer
> past about 150 calls with the task unfinished stops at a passing or cleanly red point,
> commits, and returns a handover: done, left, files, each check's state.
>
> **Green between tasks.** Before its commit, every task runs its package's whole node project
> (`pnpm --filter @waitron/venue-service exec vitest run --project node`;
> `pnpm --filter @waitron/server exec vitest run` for `apps/server`, which has one project), plus
> the browser files it touched, and the typecheck of every package it touched. A task touching
> `apps/till` runs the till's whole suite (it has only the Chromium project) after checking
> headroom with `memory_pressure | grep free`. Read each run's `Tests` count.
>
> **What this plan was read against.** Slice 1 has not landed. Every `file:line` below was read
> either at slice 1's branch `feat/service-periods-slice-1` commit
> `79bffeca9b565525402b756d193bfe9015e2d665` (marked **S1**) or at `main` `068d441ee` (marked
> **M**). Between slice 1's merge base (`0f1101446`) and `068d441ee`, `main` changed nothing in
> `packages/venue-service`, `packages/module` or the `apps/server` files named here (checked with
> `git diff --stat 0f1101446 068d441ee`), so an S1 citation in a file slice 1 did not change is
> also the `main` line. In `apps/till`, `main` changed `till-app.ts` by three lines, so its S1 line
> numbers may be off by up to three.
>
> **Start only after slice 1 has merged.** Then, before Task 1, re-check every fact marked
> **(unbuilt in slice 1)** against what landed: at `79bffeca9` slice 1's Tasks 1–11 were done,
> Tasks 12 and 13 were partly done, and Tasks 14 and 15 were not started. The list of those facts
> is the last section of this plan.
>
> **Revised 2026-10-08** after a fresh-context review; the coordinator's rulings changed decisions
> 6 and 13, and added the station readers, the guest moves and the task splits.

**Goal:** a zone can be closed for part of its department's open time; while it is, the till
starts no order and adds no item there. The venue's own named days — unlimited, each with a kind,
a yearly repeat and either the normal week's hours or its own — replace the special dates and the
two-a-year local holidays. The Opening hours page gains the zone layer, real weeks with named days
applied, an All departments view, zones on the Day tab, and the Calendar.

**Architecture:** named days stay in the `special_dates` table, which gains `kind`, `repeat_on`
and `own_hours` and later loses `colour`; one browser-safe module (`named-day-rules.ts`) decides
when a named day falls on a date, and one server module (`named-days.ts`) reads the named day on
any date, so every reader that today matches a special date by its exact date — the department
resolver, the calendar and the station-hours readers routing uses — matches repeats the same way.
Zone closed times get their own table, `zone_closed_times`, shaped like a day's ranges without a
period. One venue-service function answers "which zones are closed at this moment"; the server
refuses, with `service_zone.closed`, a new order, a new item, or a bill or party moving into a
closed zone. The dashboard reuses slice 1's `service-grid` with a second, "closed" layer.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§3 (Zone, Named day), §5 (the "When a zone is closed" bullet), §6 "Closed times", §7, §9.2 (Week
with zones and real weeks, All departments, Day with zones, Calendar; not the prep station view),
§12 (the two-a-year local-holiday cap) and §13 item 2. Backlog: A366.
[Slice 1 plan](2026-10-07-a366-slice-1-service-periods.md).

**Where slice 2 stops.** Not in this plan: a manager's "keep … open until … today" (slice 3);
station hours, station fallbacks, the prep station entries in the picker and the read-only station
view (slice 4); monitors (slice 5); the Departments page's Zones tab and its closed-times summary
(slice 6); receipts (slice 7). Station hours keep working, on their own screen, until slice 4.

**Risk path:** FULL ceremony: two migrations (one rebuilds a shipped table), a changed
cross-package contract (`ZoneOffers`, `ZoneMenuState` and two new seats in
`packages/module/src/module.ts`), and a new refusal on the till's order and item routes.

## Decisions this plan makes that the spec does not

Each is the DEFAULT to build. The owner may override any of them when reviewing the plan.

1. **Named days keep the `special_dates` table, its `special_date.*` error codes and its
   `/special-dates` routes**; screens and strings say "named day". A rename would touch every
   station-hours reader that slice 4 deletes and every copy of the `special_date.*` codes, for no
   change in behaviour. The hand-picked `colour` goes (spec §7: colour shows the kind).
2. **Two kinds, `holiday` and `working_day`, and a kind changes nothing but colour** — no hours,
   nothing at the till. The only other reader is the Calendar's yearly local-holiday note
   (decision 10).
3. **Calendar colours, one per date, in this order of precedence:** a public holiday is red
   (`--wt-color-palette-red`); else an own holiday purple; else a named working day blue; else, on
   a date no active department opens, today's reserved closed fill (`--wt-color-day-closed`); else
   the standard fill. A day with its own hours carries a mark (a small clock glyph, with the words
   "Own hours" for screen readers). A date no department opens always says "Closed" in words, so a
   closed public holiday is red and says Closed.
4. **A repeating day is stored with its first date and `repeat_on` (`MM-DD`)**. It falls on that
   month and day in its first year and every later year, never earlier. A repeating 29 February
   falls only in leap years; the editor says so when that date is chosen.
5. **One named day per date, repeats counted.** A one-off day is refused `special_date.date_taken`
   on a date a repeating day falls on; a repeating day is refused when another repeating day has
   its month and day, or a one-off day on or after its first date does. Two repeating days on one
   month and day are also refused by a unique index (Task 27).
6. **"Own hours" is an explicit flag, `own_hours`.** Off: every department and zone follows its
   normal week that date, and no dated ranges are kept. On: a department's dated row replaces its
   week (a row with no ranges is closed; a department with **no row follows its normal week** —
   slice 1's decision 4, kept); a zone's dated closed times replace its week's (a zone with none
   is not closed that date). Switching it on copies every department's and every zone's
   normal-week day for the stored date's weekday onto the date; switching it off deletes the dated
   rows. Slice 1's per-department "Follow the normal week" (`DELETE …/menu-timetables/:departmentId`)
   retires: on an own-hours day each department is edited as on a normal-week day.
7. **"Close the whole venue" cannot be combined with own hours** (`hours.invalid`, field
   `ownHours`). It closes every department and every station that date, as today, every year for a
   repeating day.
8. **A public holiday is a fact, not a stored day, and changes no hours.** A stored named day may
   share its date. "Give this date its own hours" on a public holiday with no stored day opens a
   new day pre-filled: kind holiday, named after the holiday (`holidayDateName`), own hours on.
9. **Station hours on named days stay until slice 4, on one-off named days only**: a repeating
   day with station cells is refused (`hours.invalid`, field `repeats`). Station cells are edited
   only on the Station hours screen; named days are created, edited, copied and deleted only on
   Opening hours → Calendar.
10. **Local holidays become own days.** The `local_holidays` table, its writer, routes and editor
    go. The holiday area choice (`holiday_geographies.area_key`), which decides some regions'
    public holidays, stays and moves to the Calendar. The yearly coverage note's `local` state is
    `owner_entered` when **any** own day of kind holiday falls in that year (there is no separate
    "town holiday" mark). The country pack's `localEntryLimit` stays as a number the Calendar
    quotes ("Spanish towns have 2 local holidays a year: add yours as own holidays"); it refuses
    nothing.
11. **Zone closed times have their own table** (`zone_closed_times`: zone, weekday or named day,
    start, end). `menu_slots` needs a period and a department; a closed time has neither. Times
    follow slice 1's day: clock times read inside the business day, 15-minute steps, an end equal
    to the changeover is the end of the day, ranges may not overlap. A closed time may cover time
    when the department is closed; that part changes nothing, and "closed from 23:30 to the end of
    the day" keeps working whatever the department's hours become.
12. **A zone is closed from a closed time's start minute up to, not including, its end minute**,
    as slice 1's periods are. A closed time after midnight belongs to the business day it started
    in (Friday's 23:30–03:00 still closes the zone at 02:00 on Saturday).
13. **A closed zone takes nothing new.** `service_zone.closed` refuses: starting an order there
    (seating a table, a counter sale, park or pay whose zone or delivery table is in it); any line
    or added quantity on a bill there, including items left in a basket from before it closed and
    a handheld draft submitted there; a bill or a party moving into it from another zone; accepting
    a department transfer into it. Still allowed: paying, splitting, printing, moving a bill or
    the guests out, cancelling and editing what is stored. An extras-only edit of a stored line
    (`ADDED_EXTRAS_ONLY`, `working-order.ts:469`) is not checked, as slice 1 leaves its other
    stored-line edits unchecked. A bill already presented for payment can still be moved to a free
    table in a closed zone, because `takeIntoParty` skips `adoptZone` for a bill that is not open
    (`move-bill.ts:349`); nothing new can be ordered on it there, because the item check refuses
    it — accepted. Spec §5 lists only "paid, or moved to another zone"; the remedy for more orders
    is moving the bill. **Override, not built:** bills
    already open there keep taking items (subject to slice 1's period rules) and only new orders
    are refused — the check in `priceOrderLines` (Task 11) is then removed.
14. **`service_zone.closed` is about the zone's own closed times only.** A department with no
    period running stays slice 1's refusal (`menu_period.not_running`); opening an empty tab while
    the department is closed stays allowed, as slice 1 leaves it. A clock that cannot be read leaves
    every zone open (as slice 1's decision 5). A whole-venue closure closes the department, not the
    zone (one reason per refusal).
15. **New error codes:** `service_zone.closed` `{ zoneId }` (HTTP 409);
    `special_date.keeps_week` `{ specialDateId }` (dated ranges written for a named day without
    own hours, 409); `zone_closed_time.invalid` `{ field, reason? }` with slice 1's reasons
    `empty | order | step | overlap` (400). **Retired with local holidays:** `holiday.local_limit`,
    `holiday.not_found`, `holiday.date_taken`, `holiday_geography.not_found`,
    `holiday.geography_current`. None is a recorded incident, so none needs alert wording.
16. **Clock changes.** A zone closed time is not checked against minutes the clock skips: a
    boundary in a skipped hour takes effect at the next minute that exists. A repeating day's own
    hours are checked for skipped minutes on its next occurrence from the venue's today only;
    later years are not checked (Task 3 pins that the resolver still answers on such a date).
17. **The till.** With `zoneOpen` false the counter screen and a table's bill show "{zone} is
    closed: nothing new can be ordered here. Bills can be paid or moved to another area." in place
    of the menu's add buttons. The floor marks a zone closed from its last floor load (zone tab
    "Terrace · Closed"); tapping a free table there shows the refusal sentence instead of the seat
    dialog. A refusal from the server always wins and makes the floor reload. The floor does not
    poll for closures.
18. **Real week.** Monday first, starting at the current business week; ‹ goes no earlier. Only a
    named day with own hours is editable in a real week; any other date is read-only, with a
    header action "Give this date its own hours" (decision 21).
19. **All departments belongs to slice 2** (slice 1 built the department view only; this slice
    builds the picker). It is read-only: for each day of the shown week, one narrow column per
    active department. The picker's prep station entries come with slice 4.
20. **Day tab.** No date before today's business day. Each active department's column is followed
    by a narrow column per active zone. On a named day with own hours it edits that date; on any
    other date it edits the weekday, as slice 1's decision 9, with the note and with "Give this date
    its own hours".
21. **"Give this date its own hours"** on a date that already has a named day — stored or
    repeating — opens that day's editor with own hours switched on, not a new day; for a repeating
    day the editor says the change applies every year. On a public holiday with no stored day it
    follows decision 8; on any other date it opens a new day with own hours on, kind working day and
    the name empty.
22. **"Copy to other dates" stays**, on the Calendar's named-day menu: copies are one-off days with
    the source's name (or the holiday's, as today), kind, own hours, closure, dated department rows,
    dated zone closed times and station cells.
23. **The demo's Terrace is closed from 23:00 to the changeover every day**, written as the demo
    seed's last step, after its sales, so a seed run late at night never trips over it.
24. **The picker lists active departments and active zones only.**

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited. New migrations only, generated, never hand-numbered
  (numbers below are indicative); the pull request's first line says **"venue reset needed"**.
- No data-migration code before go-live (CLAUDE.md §3): a migration changes the schema; old rows
  are left to the reset.
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it, and an
  expression index is taken out for any generation that rebuilds its table. A rebuild runs with
  foreign keys on, so its `DROP TABLE` silently empties every cascading child: list the keys that
  point at the table before generating.
- Every foreign key and unique index is declared in the TypeScript schema; every new table is
  classified in `VENUE_SERVICE_CLASSIFICATION` (`packages/venue-service/src/classification.ts`).
- Error codes name the domain concept and are registered in `packages/venue-service/src/errors.ts`
  with a status in the route map that answers them, and wording in English and Spanish wherever a
  screen shows them.
- venue-service functions take `cfg: VenueScope`. Multi-table writes take one `tx: Transaction`;
  queries on one transaction are awaited in turn.
- New UI reads `--wt-*` tokens only; a screen does not draw its own `<select>`, `<textarea>` or text
  `<input>`; forms follow `docs/developers/design-system.md` → Forms.
- **Every form this slice creates or rewrites follows A331's save rule:** its scope from
  `draftScopeFor`, its action bound through `saveActionState(scope)`, an early return in the save
  handler while `saveActionState(scope).unchanged`, a `*.unsaved.test.ts`, and #1422's reconnect
  case (edit, take the form off the page, put it back: it still asks before discarding). See
  design-system.md → Forms and
  [the A331 plan](2026-10-07-a331-save-follows-changes.md). **A button that is not a save** follows
  design-system.md's quiet-while-waiting rule: drawn `secondary` while it waits for a choice, a
  selection or a load, or while its row's own state rules it out.
- Strings in English and Spanish.
- Coverage stays at 98/98/98/95 in every package touched.
- Comments only for an invariant or a non-obvious why; no history.
- Visual tasks: LOOK in English and Spanish, light and dark themes, at 1280 and 390 CSS pixels wide.

## Behaviour this slice removes

Tests pinning these may change, under the commit rule above, in the task named. Line numbers are
S1; where slice 1 lands with different lines, find the same assertion by its text.

- **The two-a-year local-holiday cap** (`holiday.local_limit`, `packages/venue-service/src/holidays.ts:334-347`,
  the same at M), and with it the separate local-holiday list: `saveLocalHoliday` (`:308-359`),
  `deleteLocalHoliday`, `deleteRetainedHolidayGeography` (`:366-380`), the local entries in
  `readHolidays` (`:182-199`) and `readLocalHolidayModel` (`:249-272`); the routes
  `packages/venue-service/src/routes.ts:317-376` except `PUT /holiday-area` (`:324`), which stays;
  the editor `dashboard/local-holidays-editor.ts` and its four test files; the import check and
  table entry `configuration-transfer.ts:282-298`, `:574`. Pinned at `holidays.test.ts:376, 620,
  649, 670, 681, 705, 1133`, `holidays-routes.test.ts:463`, `provisioning.test.ts:380-392`
  (counts `local_holidays`, calls `readLocalHolidayModel`), `hours.live.test.ts:205-212` (calls
  `saveLocalHoliday`), `apps/server/src/provision.test.ts:131-135` and `:441-446` (count
  `local_holidays`), `apps/server/src/configuration-transfer.test.ts:4257-4493` (the local-holiday
  round trip; the review cited it without its `apps/server/` prefix), and
  `dashboard/hours-screen.test.ts` "Hours: public holidays" (`:2345` on, the
  `local-holidays-editor` cases at `:2399-2412` and `:2549`). All change in Task 26.
- **A special date's hand-picked colour** (`special_dates.colour`, `schema/hours.ts:92` and `:107`,
  the same at M; `parseSpecialDateInput`, `hours-rules.ts:223`; `configuration-transfer.ts:173` and
  `:206`). Changed in Task 27. `CALENDAR_COLOURS` itself stays: periods use it
  (`schema/menus.ts:14-27`, `dashboard/period-editor.ts:19`).
- **Slice 1's per-department "Follow the normal week" on a special date**: `clearSpecialDateMenus`,
  `menu-timetable.ts:555-576`, its `DELETE` route, `routes.ts:1028-1037`, and the client's
  `clearDateMenus`. Changed in Task 7. Pins of the removed function itself, which go:
  `menu-timetable.test.ts:975-983` (the whole case "goes back to the normal week when cleared"),
  `:1019` (its refusal of another venue's date), `:2028` (its clock-read count),
  `menu-timetable-routes.test.ts:226`, `dashboard/opening-hours-client.test.ts:32`. Cases that use
  it only as a step towards behaviour that stays keep their assertions; their step becomes
  "turn the day's own hours off", which removes every dated row: `:1233` (a period placed only on
  a past date can then be deleted), `:1463` and `:1471` (clearing one date restores the week
  independently of its neighbour), `:2535` (a day whose rows are gone reads its week), and the
  step in `:2506-2520`. Where the replaced step clears one department of two, the case keeps the
  other department's row by writing it again after turning own hours back on (a fixture change).
- **A special date found only by its exact date**: `menu-timetable.ts:236-248`;
  `hours.ts:1145-1158` (`readStationSchedules`), `:1200-1220` (`stationsRestrictedFrom`) and
  `:499-505` (the neighbour read). Replaced in Tasks 3 and 4; no assertion is expected to change.
- **The Station hours screen's Calendar tab, local-holiday editor, and its adding, copying and
  deleting of special dates** (`dashboard/hours-screen.ts:1500-1531`, `:1568`, `:1583-1599`;
  `dashboard/hours-dates-list.ts:98-99`, `:142-148`). Pinned in `hours-screen.test.ts` "Hours:
  special dates" (`:1018`) and "Hours: the calendar" (`:1911`), and in
  `hours-screen.unsaved.test.ts` and `hours-screen.a11y.test.ts` where they open those editors.
  Changed in Tasks 24 and 26.
- **(unbuilt in slice 1)** Slice 1 Task 13's "Normal week / Special date" switch, its special-date
  picker and its "Follow the normal week" button: replaced by the real week (Task 22). If slice 1
  lands with them built, their tests are listed in Task 22's changed-checks commit.

## Review focus

The conditions most likely to bite a person that no single task's happy path exercises.

1. **A zone closed across midnight.** Terrace closed Friday 23:30–06:00 (cutover 06:00): seating
   at 23:29 Friday is accepted, at 23:30 and at 02:00 Saturday refused; at 06:00 Saturday it
   follows Saturday's day (Tasks 10 and 11).
2. **Nothing new in a closed zone, but the way out stays open.** A Terrace bill at 23:45 is
   refused a new line and a raised quantity; it can be paid, split and moved to the Dining room. A
   bill moved in from the Dining room, guests moved to a free Terrace table, a party combined into
   a Terrace party, a seated party's first order and a department transfer into the Terrace are
   refused (Tasks 11 and 12).
3. **Pricing reads no closure.** `listZoneOffers(…, { withDefault: false })` reads no zone closed
   time, named day or clock; slice 1's pin on pricing (`menu-timetable.test.ts:1702-1742`) stays
   unchanged (Task 10).
4. **Own hours on and off.** Turning a named day's own hours on copies every department's and
   zone's normal day; a department added afterwards follows its normal week that date; a row with
   no ranges is closed; turning it off removes the dated rows and the date follows the week again
   (Tasks 3 and 7).
5. **Repeats, stations included.** "Christmas" repeating from 2026-12-25 with "Close the whole
   venue" closes the departments **and the prep stations** on 2027-12-25 but not on 2025-12-25; a
   repeating 29 February falls on 2028-02-29 and not in 2027; a one-off day on a date a repeating
   day falls on is refused (Tasks 1, 3, 4 and 5).
6. **The special-dates table rebuild** (Task 27) empties dated ranges, station cells and zone
   closed times on a box that has them; the pull request's first line says so.

---

### Task 1: When a named day falls

**Files:**
- Create: `packages/venue-service/src/named-day-rules.ts`, `named-day-rules.test.ts`

**Interfaces — produces (browser-safe, no server imports):**

```ts
export const NAMED_DAY_KINDS = ["holiday", "working_day"] as const;
export type NamedDayKind = (typeof NAMED_DAY_KINDS)[number];
export interface NamedDayRule { date: LocalDate; repeats: boolean }
export function repeatKey(date: LocalDate): string;                       // "MM-DD"
export function occursOn(day: NamedDayRule, on: LocalDate): boolean;
export function occurrenceIn(day: NamedDayRule, year: number): LocalDate | null;
export function nextOccurrence(day: NamedDayRule, from: LocalDate): LocalDate | null; // on or after `from`
```

`LocalDate` and `isLocalDate` come from `hours-types.ts` and `hours-rules.ts`, which the dashboard
already imports (`dashboard/hours-screen.ts:42`).

- [ ] **Step 1: Write the failing tests:**

```ts
const xmas = { date: "2026-12-25", repeats: true };
it("falls on its first date and every later year, never earlier", () => {
  expect(occursOn(xmas, "2026-12-25")).toBe(true);
  expect(occursOn(xmas, "2031-12-25")).toBe(true);
  expect(occursOn(xmas, "2025-12-25")).toBe(false);
  expect(occursOn(xmas, "2026-12-26")).toBe(false);
});
it("a one-off day falls on its date only", () => {
  expect(occursOn({ date: "2026-12-25", repeats: false }, "2027-12-25")).toBe(false);
});
it("a repeating 29 February falls only in leap years", () => {
  const leap = { date: "2024-02-29", repeats: true };
  expect(occurrenceIn(leap, 2027)).toBeNull();
  expect(occurrenceIn(leap, 2028)).toBe("2028-02-29");
  expect(nextOccurrence(leap, "2026-03-01")).toBe("2028-02-29");
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/named-day-rules.test.ts`. Expected: cannot import `./named-day-rules.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and see it pass;** the package's node project; `pnpm --filter @waitron/venue-service typecheck`.
- [ ] **Step 5: Commit** — `feat(venue-service): when a named day falls, repeats included (A366)`.

---

### Task 2: Migration 0035 — named-day columns and zone closed times (add only)

**Files:**
- Modify: `packages/venue-service/src/schema/hours.ts` (`specialDates :85-109`), a new
  `schema/zone-closed-times.ts` exported from `schema/index.ts`, `classification.ts` (+ its test),
  `migrations.test.ts` (`TABLES`), `scripts/schema-constraints.test.ts`,
  `apps/server/src/testing/clear-provision-fixture.ts` (add `zone_closed_times` before
  `zone_service_policies :32`)
- Create (generated): `packages/venue-service/drizzle/0035_*.sql`, its snapshot, journal entry

**Interfaces — produces:**
- `specialDates.kind`: `label("kind").$type<NamedDayKind>().notNull().default("working_day")`,
  **no CHECK yet**. Use typed text until Task 27 adds the enum declaration and its CHECK
  together: `schema/schema-conformance.test.ts` requires every declared enum to have its
  vocabulary enforced in the migrated database. `specialDates.repeatOn`: `label("repeat_on")`,
  nullable, no CHECK yet;
  `specialDates.ownHours`: `flag("own_hours").notNull().default(false)`. `colour` stays for now.
- `zoneClosedTimes` (table `zone_closed_times`): `id` (primary key), `zoneId` not null,
  `weekday` (`count`, nullable), `specialDateId` (nullable), `startsAt`, `endsAt` (`timeOfDay`, not
  null). Foreign keys: `zone_id` → `zone_service_policies.zone_id` (`zone_closed_times_zone_fk`;
  no code outside test fixtures deletes a `zone_service_policies` row — `grep -rn
  "delete(zoneServicePolicies"` finds none, S1); `special_date_id` → `special_dates.id` on delete
  cascade (`zone_closed_times_date_fk`). CHECKs, written with the new table:
  `zone_closed_times_one_day_ck` (`(weekday is null) <> (special_date_id is null)`),
  `zone_closed_times_weekday_ck` (0–6), `zone_closed_times_step_ck` (as `menu_slots_step_ck`,
  `schema/menus.ts:135-139`). Indexes `zone_closed_times_week_idx` (`zone_id`, `weekday`) and
  `zone_closed_times_date_idx` (`special_date_id`, `zone_id`). Weekday numbering is Sunday 0, as
  `menu_day_timetables.weekday`.

- [ ] **Step 1: Failing test** in `migrations.test.ts`: `zone_closed_times` in `TABLES`; a special
  date inserted without the new columns reads `kind: "working_day"`, `ownHours: false`,
  `repeatOn: null`; a closed time with both `weekday` and `special_date_id` is refused by the
  database; one at `12:10` is refused; deleting the special date removes its closed times. Run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`; expected: fails.
- [ ] **Step 2: Schema, then generate** — `pnpm --filter @waitron/venue-service db:generate`. Read
  the SQL: only `ALTER TABLE special_dates ADD` and `CREATE TABLE zone_closed_times`; no table
  rebuilt.
- [ ] **Step 3: Classification** — `zone_closed_times` as `state`. Add its keys and indexes to
  `scripts/schema-constraints.test.ts`; add it to the fixture clear list.
- [ ] **Step 4: Run** Step 1's test, the package's node project, the server package
  (`pnpm --filter @waitron/server exec vitest run`, for the fixture clear list), and
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** — `feat(venue-service): named-day columns and zone closed times (A366)`.

---

### Task 3: The named day on a date, for departments and the calendar

**Files:**
- Create: `packages/venue-service/src/named-days.ts`, `named-days.test.ts`
- Modify: `packages/venue-service/src/menu-timetable.ts` (`resolveDepartmentService :193-314`,
  the special-date read `:236-248` and `timetableOn :270-279`; `readOpeningHoursModel :624-744`, its
  date list `:674-699`), `menu-timetable-types.ts` (`OpeningHoursModel :105-130`), `hours.ts`
  (`calendarDays :985-1019`, the special-date read in `readRange :936-954`)
- Test: `menu-timetable.test.ts`, `named-days.test.ts`, `hours-service-calendar.test.ts`

**Interfaces — produces:**

```ts
export interface NamedDayOccurrence {
  id: string; date: LocalDate; storedDate: LocalDate; name: string; kind: NamedDayKind;
  repeats: boolean; ownHours: boolean; closeWholeVenue: boolean;
}
export async function namedDaysOn(tx: Transaction, cfg: VenueScope, dates: readonly LocalDate[]): Promise<Map<LocalDate, NamedDayOccurrence>>;
export async function namedDaysBetween(tx: Transaction, cfg: VenueScope, from: LocalDate, to: LocalDate): Promise<NamedDayOccurrence[]>;
```

Each reads `special_dates` once: rows whose `date` is asked for, or whose `repeat_on` is the month
and day of an asked date and whose `date` is not after it; `occursOn` (Task 1) decides. Until
Task 5 writes `repeat_on`, tests insert rows directly.

`OpeningHoursModel.specialDates` becomes (in Task 18, together with its browser consumers) `namedDays: { id; date; name; kind; repeats; ownHours;
closeWholeVenue }[]`, listing every repeating day, every one-off day from the business day before
today on, and any day holding dated rows (as `:686-696` does for timetables).

Task 3 keeps the existing wire shape while including old repeats in the list; Task 18 changes the
shape together with `opening-hours-screen.ts`, `opening-hours-day.ts` and their fixtures.
`duplicateSpecialDate` copies `ownHours` in Task 3 so the existing dated-timetable copy assertions
keep their behavior; Task 5 owns the remaining named-day copy fields and validation.

The resolver and `calendarDays`: for the business day (and, in the resolver, the day before) the
named day on that date decides — whole-venue closure: closed; own hours: the department's dated
row if it has one (no ranges: closed), else its weekday row; no own hours: the weekday row, dated
rows ignored (decision 6).

- [ ] **Step 1: Failing tests.** Clock `Europe/Madrid`, cutover `06:00`, Lunch 12:00–16:00 on
  every weekday:
  - a repeating "Navidad" from 2026-12-25 with "Close the whole venue": 2027-12-25 13:00 →
    `open: false`; 2025-12-25 13:00 → Lunch. Fails today because the read at `:246` matches only
    `2026-12-25`;
  - a one-off day **without** own hours that has a dated empty row (inserted directly) → Lunch (the
    row is ignored);
  - a one-off day with own hours and a dated row Lunch 13:00–15:00 → 12:30 closed, 14:00 Lunch; a
    second department with no dated row → its weekday's Lunch;
  - a named day on business day 2027-03-27 with own hours and a dated range 02:30–04:00 inserted
    directly (with cutover 06:00 both times fall on calendar 2027-03-28, when Madrid's clocks jump
    from 02:00 to 03:00, so 02:30 never happens): at 03:00 on the 28th the range is in force and the
    resolver does not throw (decision 16);
  - `readOpeningHoursModel` lists a repeating day first dated in 2020 and not a one-off day dated
    last month;
  - the calendar's tone for 2027-12-25 is closed.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/named-days.test.ts src/menu-timetable.test.ts src/hours-service-calendar.test.ts`.
- [ ] **Step 3: Implement.** Fixtures that write dated rows set `own_hours` first, including
  `hours-service-calendar.test.ts:153-186` and the `menu-timetable.test.ts` cases at `:888-934`
  and `:2506-2520` (fixture changes; their assertions stay, since decision 4 is kept).
- [ ] **Step 4: Run; see them pass;** the package's node project; typecheck.
- [ ] **Step 5: Commit** — `feat(venue-service): a named day's own hours, and repeats, for departments (A366)`.

---

### Task 4: The named day on a date, for prep stations and routing

**Files:**
- Modify: `packages/venue-service/src/hours.ts` (`readStationSchedules :1118-1188`, its
  special-date read `:1145-1158`; `stationsRestrictedFrom :1195-1225`; the neighbour read in
  `assertDatesBesideNeighbours :499-505` and `readDateStates :318-327`)
- Test: `hours.test.ts`, `routing-store.test.ts`

Both station readers feed routing (`routing-store.ts:258` and `:811`). `readStationSchedules`
takes its dates through `namedDaysBetween`, so a repeating whole-venue closure closes every
station on each occurrence in the range; station cells stay one-off only (decision 9), so cells are
still read by the stored date. `stationsRestrictedFrom` counts a repeating whole-venue closure from
any first date (it recurs on or after `from`). The neighbour check reads the named day on each
neighbour date through `namedDaysOn`. Two checks keep matching special dates by exact date:
`assertWeekBesideSpecialDates` (`hours.ts:338-341`) and `assertDemotedStationHours` (`:588-592`);
leaving repeats out of them can only add refusals (a closed repeating day reads as its normal
week), never let a clash through, so they are left as they are.

- [ ] **Step 1: Failing tests:** a repeating "Navidad" from 2026-12-25 with "Close the whole
  venue": `readStationSchedules` for 2027-12-20…2027-12-31 gives every station `[]` on 2027-12-25
  (fails today: the read at `:1155-1156` finds no row in that range); through routing at 2027-12-25
  13:00, a dish routed to the Kitchen station goes where a closed Kitchen sends it, as on the
  first year's date; `stationsRestrictedFrom(tx, cfg, "2027-01-01")` reports `wholeVenue: true`.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/hours.test.ts src/routing-store.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** the package's node project; typecheck.
- [ ] **Step 5: Commit** — `fix(venue-service): a repeating closure closes prep stations every year (A366)`.

---

### Task 5: Writing named days

**Files:**
- Modify: `packages/venue-service/src/hours-rules.ts` (`parseSpecialDateInput :218-251`),
  `hours-types.ts` (`SpecialDate :46-52`, `SpecialDateInput :54`), `hours.ts` (`saveSpecialDate
  :620-716`, `duplicateSpecialDate :778-872`), `holidays.ts`
  (`duplicateHolidayNamedSpecialDates :387-410`), `dashboard/hours-screen.ts` (its `SpecialDate`
  uses compile unchanged; only types it names may need the new optional fields)
- Test: `hours.test.ts`, `hours-routes.test.ts`

**Interfaces:**

```ts
export interface SpecialDate {
  id: string; date: LocalDate; name: string; kind: NamedDayKind; repeats: boolean;
  ownHours: boolean; closeWholeVenue: boolean;
  colour: CalendarColour; // read-only until Task 27 drops the column
}
export type SpecialDateInput = Pick<SpecialDate, "date" | "name" | "closeWholeVenue"> &
  Partial<Pick<SpecialDate, "kind" | "repeats" | "ownHours">> & {
    colour?: CalendarColour; // accepted and ignored until Task 27
    cells: DateHoursCell[];
  };
```

Rules the tests pin:
- `kind` in `NAMED_DAY_KINDS`, `repeats`, `ownHours` and `closeWholeVenue` booleans, else
  `hours.invalid` naming the field. An absent `kind`, `repeats` or `ownHours` takes `working_day`,
  `false`, `false` on create and keeps the stored value on update, so today's callers — the Station
  hours editor, whose POST body is pinned at `hours-screen.test.ts:1097-1104`, and the
  configuration import (`configuration-transfer.ts:203-210`) — keep working unchanged. `colour`
  stays optional and ignored; until Task 27 the writer stores `red` for a holiday and `blue` for a
  working day so the column's `not null` holds.
- `repeat_on` is written as `repeatKey(date)` when `repeats`, else null.
- Decision 5's clashes → `special_date.date_taken` `{ date }` naming the clashing date.
- `ownHours` with `closeWholeVenue` → `hours.invalid` field `ownHours`; `repeats` with any station
  cell → `hours.invalid` field `repeats`.
- A copy is one-off and carries `kind`, `ownHours`, `closeWholeVenue` and station cells (dated
  rows join the copy through the participant, as today, and zone rows in Task 8).

- [ ] **Step 1: Failing tests** for each rule, e.g. saving a one-off "Cena" on 2027-12-25 beside a
  repeating Navidad from 2026-12-25 expects `special_date.date_taken` `{ date: "2027-12-25" }` and
  fails today because only the exact date `2026-12-25` is compared (`hours.ts:639-649`).
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/hours.test.ts src/hours-routes.test.ts`.
- [ ] **Step 3: Implement.** Fixtures that send `colour` keep working; the Station hours POST
  assertion at `hours-screen.test.ts:1097-1104` stays unchanged. Under the owner’s 2026-10-05
  test-change ruling, checks of the removed hand-picked colour now assert the kind-derived
  colour, and exact named-day response shapes gain `kind`, `repeats` and `ownHours`. Inventory
  every changed check in the PR and campaign FYI. Read models carry the same metadata.
- [ ] **Step 4: Run; see them pass;** the venue-service node project and the touched browser
  files; typecheck.
- [ ] **Step 5: Commit** — `feat(venue-service): named days with a kind and a yearly repeat (A366)`.

---

### Task 6: The configuration import carries named days

**Files:** modify `packages/venue-service/src/configuration-transfer.ts` (the special-date checks
`:167-177`, the `parseSpecialDateInput` call `:203-210`); tests both `configuration-transfer.test.ts`.

**Behaviour:** the import passes each row's `kind`, `repeat_on` and `own_hours` to the same parse
and refuses (`setup.request_invalid`) a bad kind, a `repeat_on` other than the date's month and
day, decision 5's clashes and own hours with a whole-venue closure. An export round-trips the three
columns.

- [ ] Steps: add a real export/import round-trip for a repeating own-hours day, checking
  `kind`, `repeat_on` and `own_hours` intact. The raw-table transfer already preserves the columns;
  the new refusal cases must fail before implementation because the validator ignores them.
  Watch each refusal fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project node src/configuration-transfer.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts`);
  implement; the venue-service node project and the server package; commit
  `feat(venue-service): configuration transfer carries named days (A366)`.

---

### Task 7: Switching a named day's own hours

**Files:**
- Modify: `packages/venue-service/src/hours.ts` (`saveSpecialDate`, `deleteSpecialDate :879-892`),
  `menu-timetable.ts` (`saveSpecialDateMenus :527-553`; delete `clearSpecialDateMenus :555-576`),
  `routes.ts` (delete the `DELETE` at `:1028-1037`; status map), `errors.ts`,
  `dashboard/opening-hours-client.ts` (delete `clearDateMenus :65-70`), `dashboard/strings.ts`
- Test: `hours.test.ts`, `menu-timetable.test.ts`, `menu-timetable-routes.test.ts`,
  `dashboard/opening-hours-client.test.ts`

Rules: turning `ownHours` on copies, in the same transaction, each department's
`menu_day_timetables` row for the stored date's weekday (with its slots) and each zone's
`zone_closed_times` rows for that weekday onto the date; turning it off removes them; a save that
leaves `ownHours` unchanged leaves them alone. `saveSpecialDateMenus` on a day without own hours →
`special_date.keeps_week` (409); a repeating day’s clock-skip check runs on `nextOccurrence(day, today)`
(decision 16). One-off dates retain their stored-date endpoint checks. The `DELETE …/menu-timetables/:departmentId` route answers 404. Dashboard wording
for `special_date.keeps_week`: "This named day keeps the normal week. Give it its own hours first."
/ "Este día especial sigue la semana normal. Dale primero su propio horario."

- [x] **Step 1: Failing tests:** on with Lunch on Fridays copies Friday's Lunch onto a Friday named
  day (fails today: nothing copies); off removes the dated rows; a dated save on a day keeping the
  week is refused `special_date.keeps_week`; the DELETE route answers 404.
- [x] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/hours.test.ts src/menu-timetable.test.ts src/menu-timetable-routes.test.ts`.
- [x] **Step 3: Implement.** Every `clearSpecialDateMenus` and `clearDateMenus` use listed under
  "Behaviour this slice removes" changes here: the pins of the removed function go in the
  changed-checks commit; the step-only uses get the "own hours off" step.
- [x] **Step 4: Run; see them pass;** the package's node project; typecheck.
- [x] **Step 5: Commit** — `feat(venue-service): a named day's own hours start from the normal week (A366)`.

---

### Task 8: Writing zone closed times, and the zones in the Opening hours model

**Files:**
- Modify: `packages/venue-service/src/service-day.ts` (add the parser), `menu-timetable.ts`
  (model; participant `:606-622`), `menu-timetable-types.ts`, `routes.ts`, `errors.ts`,
  `dashboard/opening-hours-client.ts`, `dashboard/live-queries.ts` (`"opening-hours" :58-67`)
- Create: `packages/venue-service/src/zone-closed-times.ts`, `zone-closed-times.test.ts`
- Test: `service-day.test.ts`, `menu-timetable-routes.test.ts`, `dashboard/live-queries.test.ts`,
  `dashboard/opening-hours-client.test.ts`

**Interfaces:**

```ts
export interface ClosedRange { startsAt: string; endsAt: string }
export function parseClosedRanges(value: unknown, field: string, cutover: string): ClosedRange[]; // zone_closed_time.invalid
export async function replaceZoneClosedWeek(tx: Transaction, cfg: VenueScope, zoneId: string, days: unknown): Promise<void>; // seven { weekday, ranges }
export async function saveZoneClosedDate(tx: Transaction, cfg: VenueScope, specialDateId: string, zoneId: string, ranges: unknown): Promise<void>;
// OpeningHoursModel.departments[n] gains:
//   zones: readonly { id: string; name: string; week: readonly { weekday: number; ranges: readonly ClosedRange[] }[];
//                     dates: readonly { specialDateId: string; ranges: readonly ClosedRange[] }[] }[]
```

`parseClosedRanges` shares `parseServiceDay`'s checks (`service-day.ts:40-69`) without the period
id; refactor both onto one internal function so the two cannot drift. The zone is resolved within
the venue through `resolveZoneContext` (`operations.ts:521-554`, which also refuses a zone whose
department is switched off). `saveZoneClosedDate` on a day without own hours →
`special_date.keeps_week`. Zones are listed under their department, active ones only, by
`floor_zones.display_order`.

Routes (manager, `venue.configure` as the other writers): `PUT
/management-api/venue-service/zones/:zoneId/closed-week` (body `{ days }`) and `PUT
/management-api/venue-service/special-dates/:id/zone-closed-times/:zoneId` (body `{ ranges }`).
`OpeningHoursApi` gains `saveZoneWeek` and `saveZoneDate`. The `opening-hours` live query adds
`zone_closed_times`, `zone_service_policies` and `floor_zones`. The calendar participant copies a
date's zone rows.

- [x] **Step 1: Failing tests:** a week saved and read back (fails today: no such route); a
  06:00–06:00 range is the whole day; overlap, order, step and empty refusals name the field and
  reason; another venue's zone is refused `service_zone.not_found`; a dated save on a day keeping
  the week is refused; a copy of a day carries its zone rows; the live query's list.
- [x] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/zone-closed-times.test.ts src/service-day.test.ts src/menu-timetable-routes.test.ts src/dashboard/live-queries.test.ts`.
- [x] **Step 3: Implement.** Register `zone_closed_time.invalid` (400).
- [x] **Step 4: Run; see them pass;** the venue-service node project and the server package;
  typecheck.
- [x] **Step 5: Commit** — `feat(venue-service): zone closed times for the week and for a named day (A366)`.

---

### Task 9: The configuration import carries zone closed times

**Files:** modify `packages/venue-service/src/configuration-transfer.ts` (validation; the table
list `:550-575`); tests both `configuration-transfer.test.ts`.

**Behaviour:** the transfer lists `zone_closed_times` and refuses a row naming a zone outside the
bundle, both or neither of weekday and named day, a dated row on a day without own hours, or ranges
`parseClosedRanges` refuses.

- [x] Steps: failing tests (a Terrace week round-trips — fails today because the table list at
  `:550-575` omits `zone_closed_times`; each refusal); watch them fail; implement; the venue-service
  node project and the server package; commit
  `feat(venue-service): configuration transfer carries zone closed times (A366)`.

---

### Task 10: Which zones are closed now — the contract

**Files:**
- Modify: `packages/venue-service/src/zone-closed-times.ts`, `operations.ts` (`listZoneOffers
  :820-871`, `menuState :873-904`), `service.ts` (the seats, beside `:96-111`), `errors.ts`,
  `packages/module/src/module.ts` (`ZoneOffers :250-251`, `ZoneMenuState :266-267`, the
  venue-service seat list near `resolveDepartmentService :438`), `apps/server/src/working-order.ts`
  (the empty `ZoneOffers` literal in `priceOrderLines`, S1 `:449-455`),
  `packages/catalogue/src/menu-document-types.ts` (`MenuState :381-385`, whose `service` the till's
  `/api/menu-state` answer uses), `apps/till/src/api/client.ts` (`ZoneOfferCatalogue`,
  `MenuStateAnswer`), and as fixture growth (a new field on an existing shape) the empty literals at
  `apps/till/src/till-app.ts:2412`, `:4930`, `:4944` and the till test fixtures that build a
  `service`
- Test: `zone-closed-times.test.ts`, `operations.test.ts`, `menu-timetable.test.ts`

**Interfaces — the contract:**

```ts
export async function closedZoneIdsAt(tx: Transaction, cfg: VenueScope, at: Date, zoneIds?: readonly string[]): Promise<ReadonlySet<string>>;
export async function assertZoneTakesNewOrders(tx: Transaction, cfg: VenueScope, zoneId: string, at: Date): Promise<void>; // service_zone.closed
// ZoneOffers.service and ZoneMenuState.service gain: readonly zoneOpen: boolean
```

A zone is closed when a range of its day contains the moment's minute: its dated ranges when the
business day's named day has own hours, else its weekday's (decisions 6, 12 and 14). One clock read,
one named-day read, one closed-times read, however many zones. `listZoneOffers` with
`withDefault: false` (pricing) sets `zoneOpen: true` and reads nothing new: slice 1's case "prices
every period menu without reading ranges, dates or the venue clock" (`menu-timetable.test.ts:1702-1742`)
passes unchanged, and a new case beside it asserts no statement names `zone_closed_times`.

- [x] **Step 1: Failing tests:** review focus 1 at 23:29, 23:30, 02:00 and 06:00 (fails today:
  `closedZoneIdsAt` does not exist); a named day with own hours and no Terrace ranges leaves the
  Terrace open while its weekday would close it; a whole-venue closure leaves `zoneOpen` true; an
  unreadable time zone → open; `assertZoneTakesNewOrders` throws `service_zone.closed`
  `{ zoneId }`; `menuState` and `listZoneOffers` answer `zoneOpen`; the new pricing case.
- [x] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/zone-closed-times.test.ts src/operations.test.ts src/menu-timetable.test.ts`.
- [x] **Step 3: Implement.** Register `service_zone.closed`.
- [x] **Step 4: Run; see them pass;** the venue-service node project and the server package;
  the till's whole suite; typecheck `@waitron/module`, `@waitron/catalogue`,
  `@waitron/venue-service`, `@waitron/server` and `@waitron/till`.
- [x] **Step 5: Commit** — `feat(venue-service): which zones are closed now (A366)`.

Task 10 receipt (2026-10-09): closure state is a separate `zoneOpen` field; the till client
already derives both response service types from `MenuState["service"]`, so its type alias needs
no edit. Counter and table screen indicators remain Task 13. New real-database cases cover the
start, an overnight end inside the day, changeover, own-hours replacement, location and zone
selection, whole-venue closure, unreadable clock, refusal and a three-statement batch. Existing
service shapes gain the field; the availability batch count gains those three reads.

---

### Task 11: The server takes nothing new in a closed zone

**Files:**
- Modify: `apps/server/src/working-order.ts` (`createOpenOrder :1068`; in `priceOrderLines`, a
  zone check beside the period refusal `:490-500`, run when the period is resolved `:468-476`), `apps/server/src/parties.ts`
  (`partyMainBill :113-149`), `apps/server/src/till-api.ts` (`/api/zones :2231-2240`; the status map
  beside `service_zone.not_allowed :466`)
- Test: create `apps/server/src/till-api.zone-closed.test.ts`

**Rules (decision 13):**
- `createOpenOrder` calls `VENUE_SERVICE.assertZoneTakesNewOrders` once it knows the effective
  zone (after the delivery-table lookup at `:1111-1124`), unless the caller passes
  `placement.existingService: true`. Callers: the park at `:1185`, the table at `openTab :1263`
  (seating, `parties.ts:91`), the walk-up sale at `till-sale.ts:539` and pay at `:1006` check;
  `partyMainBill` (`parties.ts:140`) passes `existingService: true`, because splitting a table
  (`table-actions.ts:275`) creates a bill that way; the split at `bill-actions.ts:144` names no
  zone. A check on by default means a new caller is refused rather than let through.
- `priceOrderLines` refuses `service_zone.closed` for the lines slice 1's period refusal
  (`:490-500`) checks — every line or quantity the request adds, not extras-only edits — and
  resolves the zone once, when it resolves the period (`:468-476`).
  This is what refuses a seated party's first order in a closed zone, whatever `partyMainBill`
  passed, and a handheld draft submitted there (the test checks that path rather than assuming
  it).
- `GET /api/zones` adds `closed: boolean` to each zone. `service_zone.closed` maps to 409. No route
  is added, so neither route map in `till-api.profile-actions.test.ts` or
  `till-api.profile-zones.test.ts` changes.

- [x] **Step 1: Failing tests** through the real routes with `vi.setSystemTime`, Terrace closed
  23:30–06:00: seat a Terrace table at 23:29 → 200, at 23:30 → 409 `service_zone.closed` (fails
  today with 200: nothing checks closed times); a walk-up sale, a park and a pay in the Terrace at
  23:45 → refused and no `working_orders` row written; a walk-up sale with a Terrace delivery table
  → refused; a stored Terrace bill: a new line and a raised quantity at 23:45 → refused; a note
  edit → accepted; payment → accepted; a split → accepted; a party seated at 23:00 with no bill
  orders its first item at 23:45 → refused and no bill row left; a handheld draft for that party
  submitted at 23:45 → refused; `/api/zones` answers `closed: true` for the Terrace at 23:45.
- [x] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/till-api.zone-closed.test.ts`.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run; see them pass;** the server package; `pnpm --filter @waitron/server typecheck`.
- [x] **Step 5: Commit** — `feat(server): a closed zone takes no new order or item (A366)`.

---

### Task 12: The server refuses moves into a closed zone

**Files:**
- Modify: `apps/server/src/move-bill.ts` (`adoptZone :393-416`, reached from `takeIntoParty
  :336-350`), `apps/server/src/table-actions.ts` (`moveGuests :64-95`),
  `packages/venue-service/src/department-transfers.ts` (`acceptDepartmentTransfer :360`, before the
  retarget at `:425`)
- Test: `apps/server/src/till-api.zone-closed.test.ts`, `packages/venue-service/src/department-transfers.test.ts`

**Rule:** the check sits where the zone changes. `adoptZone` refuses `service_zone.closed` when
the new zone is closed and differs from the bill's own (`findOrderContext`, already read at
`:399`). `moveBill`'s counter destination calls it directly (`move-bill.ts:110`); its free-table
and party destinations (`:118`, `:124`), `moveGuests`' `retargetOpenBills`
(`table-actions.ts:337-344`) and `combineParties` (`table-actions.ts:192`) reach it through
`takeIntoParty`, which skips it for a bill not open (decision 13). `moveGuests` also refuses, before its `combineAt` branch (`:73-74`), when
the target table's zone is closed and differs from the party's zone (`partyZone`), so a party with
no open bill cannot move in either. Moving within the closed zone, or out of it, is allowed.
Accepting a department transfer into a closed zone is refused; the request stays pending.

- [x] **Step 1: Failing tests** at 23:45: a Dining room bill → free Terrace table → refused (fails
  today: the move succeeds); a Terrace bill → Dining room → accepted; a Terrace bill → another
  Terrace table → accepted; guests moved from the Dining room to a free Terrace table → refused;
  a Dining room party moved onto a table a Terrace party holds (merge) → refused; a Dining room
  party with no bill moved to a free Terrace table → refused; a transfer accepted into the Terrace →
  refused and still pending.
- [x] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/till-api.zone-closed.test.ts` and `pnpm --filter @waitron/venue-service exec vitest run --project node src/department-transfers.test.ts`.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run; see them pass;** the server package and the venue-service node project.
- [x] **Step 5: Commit** — `feat(server): no bill or party moves into a closed zone (A366)`.

---

### Task 13: The till's order screens show a closed zone

**Files:**
- Modify: `apps/till/src/screens/till-counter-screen.ts` (`service :148`, the notice `:286-300`),
  `screens/till-table-order-screen.ts` (`service :1106`, `:2800-2807`), `till-app.ts` (the
  menu-state comparisons `:2952-2954` and `:2970-2972`, which look only at `open` and
  `periodName`; add `zoneOpen` so an open order screen notices the zone closing), `i18n/codes.ts` (beside
  `service_zone.not_allowed :74`), `i18n/strings.ts` (beside `menu.department_closed :1059`)
- Modify: `apps/till/src/widgets/card-grid.ts` (the counter product-card gate and table
  screen properties; the zone name travels from the app’s existing zone lists)
- Test: `i18n/codes.test.ts`, `till-app-menu-refresh.test.ts`, `till-counter-screen.test.ts`, `till-table-order-screen.test.ts`,
  `screens/service-periods.a11y.test.ts`

**Behaviour:** decision 17's notice replaces the add buttons on both screens when
`service.zoneOpen` is false; the basket and the bill's payment and move actions stay.
`service_zone.closed` reads: "That area is closed now, so nothing new can be ordered there. Bills
there can still be paid or moved." / "Esa zona está cerrada ahora, así que no se puede pedir nada
nuevo. Las cuentas se pueden cobrar o mover."

- [x] Steps: failing tests (with `zoneOpen: false` the counter screen shows the notice and no add
  button — fails today because the screen reads only `service.open`; a menu-state poll that
  changes only `zoneOpen` redraws the open order screen (`till-app-menu-refresh.test.ts`); the
  table bill keeps Pay and Move; the refusal's sentence; axe for both notices in both themes); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-counter-screen.test.ts src/screens/till-table-order-screen.test.ts src/screens/service-periods.a11y.test.ts`);
  implement; the till's whole suite; LOOK at both screens in EN and ES, both themes, 1280 and 390;
  commit `feat(till): order screens show a closed zone (A366)`.

---

### Task 14: The till's floor shows a closed zone

**Files:**
- Modify: `apps/till/src/api/client.ts` (`FloorZone :1633-1638`), `screens/till-floor-screen.ts`
  (`zones :400`, `buildZoneTabs :630`, the seat dialog `:797-807`), `till-app.ts`
  (`#loadFloorData :4786`), `i18n/strings.ts`
- Test: `till-floor-screen.test.ts`, `till-floor-screen.a11y.test.ts`, `till-app.test.ts`

**Behaviour:** decision 17: the zone tab reads "Terrace · Closed" / "Terraza · Cerrada"; a free
table there answers a tap with the refusal sentence; any `service_zone.closed` refusal reloads the
floor.

- [x] Steps: failing tests (a zone with `closed: true` labels its tab — fails today because
  `FloorZone` has no `closed`; tapping its free table shows the sentence and no seat dialog; a
  seat refused by the server reloads the floor); watch them fail; implement; the till's whole
  suite; LOOK at the floor in EN and ES, both themes, 1280 and 390; commit
  `feat(till): the floor shows a closed zone (A366)`.

The app's table and counter refusal lists both retain `service_zone.closed`. When that refusal
is displayed, reload through `#loadFloorData` so the zone flags and tables are refreshed together;
ignore the result after disconnect or an operator-session change. Placement refreshes remain
table-only. The floor keeps occupied tables openable, clears the notice on a zone change and stops
showing it after that zone reopens. Typed open-zone fixtures gain `closed: false` without changing
any existing check.

---

### Task 15: The grid's closed-times layer

**Files:** modify `packages/venue-service/src/dashboard/service-grid.ts` (`GridColumn :13-19`,
properties `:194-196`), `service-grid.test.ts`, `service-grid.a11y.test.ts`.

**Interfaces:**

```ts
export interface GridColumn {
  key: string; label: string; slots: readonly ServiceRange[]; periods: readonly GridPeriod[];
  editable: boolean;
  layer?: "periods" | "closed";        // default "periods"
  closed?: readonly ClosedRange[];     // used when layer is "closed"
  narrow?: boolean;                    // the Day tab's zone columns and All departments
}
```

With `layer: "closed"`, `slots` are drawn faded and take no pointer or keyboard input; `closed`
blocks are drawn hatched with the word "Closed" and are what the events' `index` refers to. The
period fill fades through `--wt-opacity-disabled`; its text stays at full contrast. The hatch uses
existing `--wt-color-*` tokens. Selection stops at a neighbouring closed block, never at a faded
period.

- [x] Steps: failing tests (a drag over a faded Lunch block on a closed layer emits the range —
  fails today because a Lunch block stops the selection; a drag across a closed block stops at it;
  Enter on a closed block emits `grid-block-open` with its index; a narrow column's width; axe for
  a closed layer empty, filled and selected in both themes); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/service-grid.test.ts src/dashboard/service-grid.a11y.test.ts`);
  implement; the package's node project; commit `feat(venue-service): the day grid shows a zone's closed times (A366)`.

---

### Task 16: The Opening hours picker and All departments

**Files:**
- Modify: `dashboard/opening-hours-screen.ts` (`View :23`, the URL children `:68-72`, the
  department chooser), `apps/dashboard/src/navigation.ts` (the `opening-hours` children),
  `strings.ts`
- Create: `dashboard/opening-hours-all.ts`, `.test.ts`, `.a11y.test.ts`
- Test: `opening-hours-screen.test.ts`, `apps/dashboard/src/navigation.test.ts`

**Behaviour:** the picker (`wt-combobox`) lists "All departments", then each active department
with its active zones beneath it, labelled "Restaurant › Terrace". The URL keeps `department` and
adds `zone`; `department=all` is All departments. All departments is read-only: for each day of the
week, one narrow column per active department; a column heading opens that department. A chosen
zone shows a placeholder until Task 17.

- [x] Steps: failing tests (the picker's options — fails today because it lists departments only;
  the URL round trip; All departments' columns and headings); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser <files>` and
  `pnpm --filter @waitron/dashboard exec vitest run src/navigation.test.ts`); implement; the
  package's node project; LOOK in EN and ES, both themes, 1280 and 390; commit
  `feat(venue-service): the Opening hours picker and All departments (A366)`.

---

### Task 17: A zone's normal week

**Files:**
- Create: `dashboard/opening-hours-zone-week.ts`, `.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`
- Modify: `dashboard/opening-hours-screen.ts`, `dashboard/range-dialog.ts`, `strings.ts`

**Behaviour:** seven closed-layer columns over the department's periods. A drag marks a closed
range; opening a block reuses slice 1's `range-dialog` with its period choice hidden (a
`closedTimes` mode: two times and Delete); each day's header menu has "Copy this day to…" and
"Clear". One Save sends `saveZoneWeek`; a refusal shows on the day it names; A331 save rule.
Wording for `zone_closed_time.invalid`: "These closed times overlap or are not in 15-minute steps."
/ "Estas horas de cierre se solapan o no van de 15 en 15 minutos."

- [x] Steps: failing tests (a drag 23:30→06:00 on Friday stages it — fails today because the
  element does not exist; `range-dialog` in `closedTimes` mode shows no period field; copy and
  clear; Save sends seven days; unchanged Save is quiet and disabled; reconnect still asks); watch
  them fail; implement; the package's node project; LOOK in EN and ES, both themes, 1280 and 390;
  commit `feat(venue-service): a zone's closed times in Opening hours (A366)`.

Verified 2026-10-09: the focused zone/range/screen browser family ran 163 tests, the whole
venue-service node project ran 1463, and the unchanged fiscal write-path/inmutabilidad suites
ran 20. Types, touched-file lint/format and six relevant root guards (70 tests) passed.
Seven independent guard changes failed their selected assertions in an installed disposable
checkout; restoring it passed 46 behavioral cases. EN/ES light/dark captures at measured
1280/390 CSS pixels covered the week, copy chooser, two-time dialog, refusal and the overnight
range's start and changeover end in separate scroll positions. The normal-week zone placeholder
assertion was deliberately replaced by strict zone name/id and department-id wiring assertions
in signed-off `ace9d08c1`; its navigation assertions remain. Date mode retains its safe
placeholder until the later dated-hours editor, so it cannot write the normal week's closed times.

---

### Task 18: The named-days read for the Calendar

**Files:**
- Modify: `packages/venue-service/src/named-days.ts`, `holidays.ts` (`readHolidays :162-244`:
  coverage `local :212-219` also counts own holidays; its owner facts and sources stay until
  Task 26), `holiday-types.ts`,
  `routes.ts`, `dashboard/live-queries.ts`; create `dashboard/named-days-client.ts`
- Test: `named-days.test.ts`, `holidays.test.ts`, `hours-routes.test.ts`

**Interfaces:**

```ts
export interface NamedDay { id: string; date: LocalDate; name: string; kind: NamedDayKind; repeats: boolean; ownHours: boolean; closeWholeVenue: boolean; hasStationHours: boolean }
export interface NamedCalendarDay {
  date: LocalDate; namedDay: NamedDay | null; holidays: readonly HolidayFact[];
  tone: "public_holiday" | "own_holiday" | "working_day" | "closed" | "standard"; ownHours: boolean; closed: boolean;
}
export interface NamedDaysModel {
  timeZone: string; dayCutover: string; civilDate: LocalDate | null; clockReadable: boolean;
  days: readonly NamedCalendarDay[];
  holidayCoverage: readonly HolidayCoverage[]; holidaySources: readonly HolidaySource[];
  area: { options: readonly { key: string; name: string }[]; required: boolean; chosen: string | null };
  localHolidaysPerYear: number;
}
export async function readNamedDaysModel(tx: Transaction, cfg: VenueScope, from: LocalDate, to: LocalDate, at: Date, holidays?: HolidayReader): Promise<NamedDaysModel>;
```

`tone` follows decision 3; `closed` is Task 3's calendar rule. Route `GET
/management-api/venue-service/named-days?from&to` (`venue.view`, at most `HOURS_RANGE_MAX_DAYS`).
Live query `named-days`: `special_dates`, `special_date_hours`, `menu_day_timetables`,
`menu_slots`, `departments`, `tenants`, `locations`, `holiday_geographies`. The existing
`readHolidays` callers keep working until Task 26 removes the local entries.

- [x] Steps: failing tests (a public holiday and a working day on one date: tone
  `public_holiday`, both names — fails today: no such read; a repeating own holiday in a later year;
  own-hours mark; a closed public holiday keeps its tone and `closed: true`; coverage
  `owner_entered` for a year holding an own holiday and no local entry, and `none_entered` for a
  year with neither; the area
  options); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project node src/named-days.test.ts src/holidays.test.ts src/hours-routes.test.ts`);
  implement; the package's node project; commit `feat(venue-service): the named-days calendar read (A366)`.

---

### Task 19: The named-day editor

**Files:** create `dashboard/named-day-editor.ts` (element `named-day-editor`), `.test.ts`,
`.unsaved.test.ts`, `.a11y.test.ts`; modify `strings.ts`.

**Behaviour:** a `wt-modal` form: date (required), name (required; a date that is a public holiday
suggests its name, as `#followHolidays` does today, `hours-screen.ts:645`), kind (Holiday /
Working day, `wt-combobox`), "Repeats every year" (`wt-switch`; on 29 February the hint "Repeats
only in leap years"), hours ("Keeps the normal week's hours" / "Has its own hours"), "Close the
whole venue" (`wt-switch`; when on, the hours choice is hidden and sent as normal week). For a
repeating day opened with own hours switched on (decision 21) it says "This changes the day every
year". It emits `named-day-save` with `{ id, input }`; the parent sends it with the day's stored
station cells unchanged (decision 9). Refusals: `special_date.date_taken` under Date;
`hours.invalid` under the field it names (`repeats` reads "This day has station hours. Remove them
in Station hours first."); others at the bottom. A331 save rule; `{ savableAtOpen: true }` when
opened by "Give this date its own hours".

- [x] Steps: failing tests (Save without a name marks Name — fails today because the element does
  not exist; each refusal's placement; leap-year hint; the every-year note; closure hides hours;
  unchanged Save quiet and disabled; reconnect; axe in both themes); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/named-day-editor.test.ts src/dashboard/named-day-editor.unsaved.test.ts src/dashboard/named-day-editor.a11y.test.ts`);
  implement; the package's node project; commit `feat(venue-service): the named-day editor (A366)`.

---

### Task 20: The Calendar tab — the month

**Files:**
- Modify: `dashboard/opening-hours-screen.ts` (a `calendar` view and `month` in the URL),
  `dashboard/hours-calendar.ts` (reads `NamedDaysModel`; tones by kind; own-hours mark),
  `strings.ts`, `apps/dashboard/src/navigation.ts`
- Test: `hours-calendar.test.ts`, `hours-calendar.a11y.test.ts`, `opening-hours-screen.test.ts`

`hours-calendar` keeps its element name and file; it now serves only Opening hours. Colours use
`--wt-color-palette-red`, `-purple` and `-blue` with their `--wt-color-on-palette-*` pairs, and
`--wt-color-day-closed` / `--wt-color-day-standard` as today.

**Behaviour:** a month with ‹ ›; each date coloured by decision 3, marked for own hours, "Closed"
in words; the holiday area picker shows when the region has areas and saves through `PUT
/holiday-area`; the yearly coverage notes stay; the local-holiday hint quotes
`localHolidaysPerYear` (decision 10). No actions yet.

- [x] Steps: failing tests (an own holiday's date is purple — fails today because the calendar
  colours by the stored `colour`; the mark; the area choice saves; axe for each tone in both
  themes); watch them fail; implement; the package's node project; LOOK in EN and ES, both themes,
  1280 and 390; commit `feat(venue-service): the Calendar month in Opening hours (A366)`.

---

### Task 21: The Calendar tab — adding, editing, copying and deleting named days

**Files:**
- Modify: `dashboard/hours-calendar.ts` (the date menu), `dashboard/opening-hours-screen.ts`,
  `strings.ts`, `dashboard/named-days-client.ts`, `dashboard/named-day-editor.ts`
- Create: `dashboard/named-day-copy.ts` (the copy form moved from `hours-screen.ts:1239-1297`),
  `.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`
- Test: `hours-calendar.test.ts`, `opening-hours-screen.test.ts`, `opening-hours-screen.unsaved.test.ts`

**Behaviour:** a date's menu offers "Add a named day" on a plain date, "Give this date its own
hours" (decision 21), and on a named day Edit, "Copy to other dates" and Delete (a confirmation
naming the day; a repeating day says every year goes). The moved copy form follows the A331 save
rule in full: `draftScopeFor`, `saveActionState`, the early return, its `*.unsaved.test.ts` and
the reconnect case. It opens with one empty date, which is not savable, so it does not pass
`{ savableAtOpen: true }`. The explicit own-hours action clears whole-venue closure in the
staged draft. Metadata edits preserve station cells through the existing passive Hours read;
copy uses that read for the retained station repeated-clock warnings.

- [x] Steps: failing tests (Edit on a repeating day opens it, not a new day — fails today because
  the calendar emits no such action; "Give this date its own hours" on a stored day opens it with
  own hours on and on a public holiday pre-fills kind holiday and its name; add, copy and delete
  call the client and the month refreshes; the copy form's quiet Save, discard and reconnect);
  watch them fail; implement; the package's node project; LOOK in EN and ES, both themes, 1280 and
  390; commit `feat(venue-service): add, edit, copy and delete named days on the Calendar (A366)`.

---

### Task 22: Real weeks

**Files:** modify `dashboard/opening-hours-screen.ts`, `dashboard/opening-hours-week.ts`,
`dashboard/opening-hours-zone-week.ts`, `dashboard/opening-hours-all.ts`, `strings.ts`; tests
beside each (`.test.ts`, `.unsaved.test.ts`), plus `real-week.ts` occurrence/action helpers,
`opening-hours-day.ts` exporting its existing business-date derivation, a shared browser-safe
test model and real-week axe/capture tests.

**Behaviour:** decision 18. A `wt-switch` "Real week" (off: the normal week) with ‹ › and the dates
in the column headings; the URL holds `week=<Monday's date>` in a real week. Columns apply the
model's named days through `occursOn`: a whole-venue closure reads "Closed"; a named day with own
hours shows its dated ranges and is editable for a department (`saveDateMenus`, slice 1) or a zone
(`saveZoneDate`), each date saved on its own; any other date is read-only with the header action
"Give this date its own hours", which opens Task 19's editor per decision 21 — except a whole-venue
closure, which offers no action (decision 7). **(unbuilt in slice
1)** If slice 1 lands with Task 13's "Special date" switch, this task replaces it; its tests go in
the changed-checks commit.

- [x] Steps: failing tests (a real week with a repeating own day shows it — fails today because
  there is no real week; ‹ stops at the current week; an own-hours date saves only that date; a
  plain date offers "Give this date its own hours"; a staged edit asks before stepping weeks);
  watch them fail; implement; the package's node project; LOOK in EN and ES, both themes, 1280 and
  390; commit `feat(venue-service): real weeks with named days applied (A366)`.

---

Task 22 rulings (2026-10-09): dated Save uses one shared draft scope per own-hours date;
a successful date commits only its submitted baseline, retaining every other staged date.
Normal week keeps one scope and one Save. Reconnect registers those retained baselines before
comparing a fresh model snapshot. Public-holiday own-hours actions wait for the week's passive
calendar read, rather than treating missing facts as a plain working day. Invalid week queries
are removed; earlier Mondays are replaced by the current business Monday. Explicit valid week
URLs remain usable when the venue clock is unreadable, with Previous and the switch disabled.
The old one-date selector and Station hours link are retired by decision 18/spec §9.2; their
behavioral checks migrate to full weeks and independent date saves in the changed-checks commit.
Tasks 23–29 remain.

### Task 23: Zones on the Day tab

**Files:** modify `dashboard/opening-hours-screen.ts` (the Day view **(unbuilt in slice 1,
Task 14)**), `strings.ts`; tests `opening-hours-screen.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`.

**Behaviour:** decision 20. Each active department's column is followed by a narrow closed-layer
column per active zone. On a named day with own hours, edits save that date's department rows and
zone rows; otherwise they save the weekday (with slice 1's note "Changes every {weekday}") and the
heading offers "Give this date its own hours". A whole-venue closure shows "Closed" and nothing is
editable. ‹ stops at today's business day. A331 rule for the staged day.

- [x] Steps: failing tests (the Terrace column follows the Restaurant column — fails today because
  the Day view draws departments only; edits on an own-hours day save the date; ‹ stops at today);
  watch them fail; implement; the package's node project; LOOK in EN and ES, both themes, 1280 and
  390; commit `feat(venue-service): zones on the Day tab (A366)`.


2026-10-09 Task 23 checkpoint: implemented in the existing `dashboard/opening-hours-day.ts`
extraction, with screen integration for the named-day editor. The Day grid now places each zone’s
narrow closed-time layer after its department; its combined staged draft saves changed department
rows and zone rows to the weekday or named-day occurrence. Previous stops at the venue’s business
Today, and a whole-venue closure offers no editing action. Calendar facts gate the heading’s own-hours
action, preserving existing repeating-day identity and public-holiday prefills. Dirty drafts retain
cloned department, zone and named-day facts through background reads and reconnect. Each successful
write commits its own baseline before the next request; refusals remain retryable.

Implementation validation: the node project passed 1475 tests; the unchanged fiscal pair passed 20.
The screen/Day/Calendar regression wave passed 207 tests before the final Day-only error cleanup;
focused Day tests and lifecycle controls verify that cleanup and the added zone cases. Existing Day,
unsaved and accessibility assertions were retained. Eight installed-checkout deletion controls
failed at the intended assertions and passed after restoration; the source hashes and discarded
initial probes are retained in the campaign’s Task 23 receipts. LOOK captured normal/own/closed
states once across EN/ES, light/dark and actual CSS widths 1280/390; the visible hour range is roughly
09:00–13:00, not the full business day. Implementation done, pending controller review. Remaining
slice work starts at Task 24; this checkpoint does not complete slice 2.

---

### Task 24: Station hours loses its calendar

**Files:** modify `dashboard/hours-screen.ts` (remove the Calendar tab `:1568`, `:1590-1600`,
`#calendarAction :1521-1531`, the duplicate and delete editors, the Add buttons' handlers),
`dashboard/hours-dates-list.ts` (`:98-99`, `:142-148`), `strings.ts`; tests `hours-screen.test.ts`,
`.unsaved.test.ts`, `.a11y.test.ts`.

**Behaviour:** tabs Week and Named days; adding, copying and deleting named days link to Opening
hours → Calendar. The local-holiday editor stays on this screen until Task 26 removes it.

- [ ] Steps: failing tests (no Calendar tab; the Named days tab links to the Calendar — fails
  today because the tab is "Special dates" with Add buttons); watch them fail; implement; the
  removed tabs' tests go in the changed-checks commit; the package's node project; LOOK in EN and
  ES, both themes, 1280 and 390; commit `feat(venue-service): Station hours leaves named days to the Calendar (A366)`.

---

### Task 25: Station hours edits only station cells on a named day

**Files:** modify `dashboard/hours-screen.ts` (the `date` editor `:101-120`, `#dateForm`),
`dashboard/hours-dates-list.ts`, `hours-types.ts` (`HoursModel :82-108`: drop `days`,
`holidayCoverage`, `holidaySources` once `grep -rn "holidayCoverage\|model\.days\b"` finds no reader
outside this screen), `hours.ts` (`readHoursModel :1060-1095`), `routes.ts` (`GET /hours
:292-305`), `strings.ts`; tests `hours-screen.test.ts`, `.unsaved.test.ts`, `hours-routes.test.ts`,
`hours-station-model.test.ts`.

**Behaviour:** the Named days tab lists one-off named days from yesterday on, each with its
stations' cells; the editor shows date and name as text and edits station cells only, sending the
day's other fields back as stored (the `hidden` pattern the `date` editor uses for subjects it does
not show, the other way round). A note says repeating named days follow each station's week. A331
rule for the rewritten editor.

- [ ] Steps: failing tests (the editor has no Date or Name field and its save sends the stored
  name and kind — fails today because the editor edits them); watch them fail; implement; the
  package's node project; LOOK in EN and ES, both themes, 1280 and 390; commit
  `feat(venue-service): Station hours edits station cells on a named day (A366)`.

---

### Task 26: Retire local holidays

**Files:**
- Modify: `holidays.ts` (delete `saveLocalHoliday`, `deleteLocalHoliday`,
  `deleteRetainedHolidayGeography`, `readLocalHolidayModel`, the local entries in `readHolidays`;
  keep `saveHolidayArea`), `holiday-types.ts`, `holiday-rules.ts` (`localHolidayName` if unused),
  `routes.ts` (`:317-376` except `PUT /holiday-area :324`; the status map's entries `:125-129`),
  `errors.ts` (`:124-130`; `holiday.invalid :123` stays for the area choice),
  `dashboard/hours-client.ts` (`loadLocalHolidays :112`, `saveLocalHoliday :128`,
  `deleteLocalHoliday :134`, `deleteRetainedGeography :138`; `saveHolidayArea :119` stays),
  `dashboard/hours-screen.ts` (the editor `:55`, `:1583-1587`), `dashboard/live-queries.ts` (`hours
  :55`, `holidays :57`), `configuration-transfer.ts` (`:270-298`, `:574`), `index.ts` exports
- Delete: `dashboard/local-holidays-editor.ts` and its four test files
- Also in `readHolidays`: owner facts (`:191-199`) and the owner source (`:235-242`) go.
- Change, in the changed-checks commit: `holidays.test.ts` and `holidays-routes.test.ts` (the cap
  and list cases, and the owner facts and source at `holidays.test.ts:349-391`, `:570` and
  `holidays-routes.test.ts:235-238`), `provisioning.test.ts:380-392`, `hours.live.test.ts:205-212`,
  `apps/server/src/provision.test.ts:131-135` and `:441-446`,
  `apps/server/src/configuration-transfer.test.ts:4257-4493`, `hours-screen.test.ts`'s public
  holidays group

- [ ] Steps: a failing test first (the local-holidays routes answer 404 — fail today with 200);
  implement; run `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`,
  the venue-service node project, its touched browser files and the server package; commit
  `refactor(venue-service): local holidays are own named days (A366)`.

---

### Task 27: Migration 0036 — named days lose their colour; local holidays go

**Files:**
- Modify: `schema/hours.ts` (`specialDates`: drop `colour`; change `kind` to
  `enumType(NAMED_DAY_KINDS)("kind").notNull().default("working_day")`; add `special_dates_kind_ck`
  (`enumCheck`), `special_dates_repeat_ck` (`repeat_on is null or repeat_on = substr(date, 6, 5)`),
  unique `special_dates_location_repeat_key` on (`location_id`, `repeat_on`) where `repeat_on is
  not null`), `schema/holidays.ts` (delete `localHolidays :37-58`), `classification.ts` (+ test),
  `migrations.test.ts`, `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`
  (`RESETS`, only if measured), `hours.ts` and `hours-types.ts` (drop the transitional colour;
  `CALENDAR_COLOURS` stays for periods), `configuration-transfer.ts` (`:173`, `:206`),
  `apps/server/src/testing/clear-provision-fixture.ts` (`local_holidays :8` goes); fixtures in
  `apps/server/src/configuration-transfer.test.ts` that send a special date's `colour` (for
  example `:4287`) drop it — a fixture change
- Create (generated): `drizzle/0036_*.sql`, snapshot, journal entry

The rebuild adds no column. Before generating, list the foreign keys pointing at `special_dates`:
at S1 they are `special_date_hours_date_fk` and `menu_day_timetables_date_fk`, both on delete
cascade, plus Task 2's `zone_closed_times_date_fk`. The rebuild's `DROP TABLE special_dates` will
empty all three on a box that has rows; that is the venue reset the pull request names. The
partial unique index is not an expression index; read the generated SQL to confirm drizzle wrote
it as declared.

- [ ] **Step 1: Failing test** in `migrations.test.ts`: `local_holidays` gone from `TABLES`; a
  special date with `repeat_on` `12-24` and date `2026-12-25` is refused by the database; two
  repeating days on `12-25` in one venue are refused; a `kind` of `party` is refused.
- [ ] **Step 2: Generate** — `pnpm --filter @waitron/venue-service db:generate`. Read the SQL.
- [ ] **Step 3:** remove the transitional colour writes, the `colour` field and the transfer's
  colour check.
- [ ] **Step 4: Run** Step 1's test, Task 2's guard list,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`, the
  venue-service node project and the server package; typecheck venue-service and server. If
  `scripts/migration-upgrade.test.ts` fails on this step, record the measured refusal or loss in
  `RESETS` with the words the run printed, as slice 1 did for `0033_aromatic_slapstick`.
- [ ] **Step 5: Commit** — `feat(venue-service): named days are coloured by kind; local holidays table goes (A366) — venue reset needed`.

---

### Task 28: The demo's Terrace closes at 23:00

**Files:** modify `apps/server/scripts/demo-seed/seed.ts` (its last step), `seed.test.ts`.

**Behaviour:** decision 23: after its sales, the seed gives the Terrace (`floor.ts:34`, M) a closed
time from 23:00 to the changeover on every weekday.

- [ ] Steps: failing test (the seeded Terrace week holds 23:00–06:00 on all seven days — fails
  today: no closed times are seeded; the step runs after the sales); watch it fail
  (`pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.test.ts`); implement; the
  server package; commit `feat(demo): the Terrace closes at 23:00 (A366)`.

---

### Task 29: Documentation and backlog

**Files:** `docs/developers/conventions-data.md` (the hours and timetable sections — at M
`:398-426` and `:427-465`, rewritten by slice 1's Task 15 **(unbuilt in slice 1)**; find them by
their headings "Opening hours store "no claim" as no row" and "Menu timetables share the
special-date calendar"), `docs/developers/public-holidays.md` (local holidays at M `:6`, `:26-30`,
"The local allowance" `:72-80`, `:119`, `:173`), `docs/developers/design-system.md` (the calendar
fills at M `:177-190`, which say a special date picks one of six colours; the Hours page's
Special dates, Calendar and Local holidays paragraphs at M `:2930-2970`; and whatever slice 1's
Task 15 adds about Opening hours **(unbuilt in slice 1)**), `docs/backlog.md` (A366 at M
`:5925-5937`; the A331 batch 4b note at M `:1887-1889` that waits for A366's hours, date and slot
forms).

Say, with the code pointer for each: a named day's kind, repeat and own hours (decisions 2, 4, 6);
one named day per date; on an own-hours day a department with no dated row still follows its
normal week, a row with no ranges is closed, and the per-department "follow the week" route is
gone; zone closed times and what a closed zone refuses (decisions 11–14); local holidays are own
days and nothing caps them; the transitional colour is gone. Retire the claims they replace with a
dated pointer where a document is historical. Run `pnpm exec prettier --file-info` on each changed
path (most of `docs/` is ignored) and `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.

- [ ] Commit — `docs: named days and zone closed times (A366 slice 2)`.

---

## After the last task

Run `/finish-branch` with this worktree and this plan. The branch touches risk triggers
(migrations and a cross-package contract), so it takes the full wave with **two run-it reviews**:
one on this plan's checklist, one told to set the checklist aside and test what it does not name.
The pull request's first line: **"venue reset needed"**. Do not merge; the owner lands it.

## Start-up recheck against landed slice 1 and A432

Checked 2026-10-09 against `685a6074b152eeb904a66cfac9f83e8f432196ab` (slice 1)
and `e70b68915607a1a0f3b1861bc003197c3636ed5c` (A432), the implementation branch's base.
The original S1 citations above remain historical; find assertions by their text.

- The menu timetable screen, client and slot editor are retired. Navigation declares
  `opening-hours: { view, department }` in `apps/dashboard/src/navigation.ts`.
- `opening-hours-screen.ts` now selects a special date; `opening-hours-week.ts` implements
  its dated ranges and Follow the normal week flow through `clearDateMenus`. Tasks 7 and 22
  retire and replace these landed flows. `range-dialog.ts` is present for Task 17.
- `opening-hours-day.ts` implements the department Day view. Task 23 adds zones to it.
- The service-period sections in `conventions-data.md` and Opening hours entries in
  `design-system.md` have landed. `public-holidays.md` still describes Station hours and
  local holidays; Task 29 changes these current claims and retains historical pointers.
- A432 added `0034_period_end_offset.sql`. Tasks 2 and 27 now propose 0035 and 0036;
  generate the actual next numbers, and regenerate on a collision after rebase.
- A432 added selection/sending state and signed period offsets. Tasks 3, 5–7 and 9 must retain
  offset placement validation when replacing date resolution or writing/importing named days.
  Tasks 10–14 add zone state alongside the existing selection and sending fields, preserving
  cutoff refusal tests and the pricing path's static-only reads. Zone closed times remain an
  independent refusal; positive period grace never overrides a zone closure (decision 13).

The queue's 2026-10-05 test-change decision governs changed assertions, and its authorisation
for finish-branch and land-branch replaces the historical "owner lands it" instruction above.

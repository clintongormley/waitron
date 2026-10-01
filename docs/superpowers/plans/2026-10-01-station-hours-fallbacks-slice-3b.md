# Station opening hours and fallbacks (slice 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each prep station a weekly opening schedule, a by-hand "closed / open for today", and
a fallback station that takes its work while it is closed or switched off. Also tell the venue
when a station's printer stops printing (on the dashboard, on Prep Stations and on the station's
own kitchen screen) or when all its kitchen screens stop checking in (on the dashboard and Prep
Stations).

**Architecture:** The pure rule from slice 3a (`chooseMaker`, `packages/venue-service/src/routing.ts`)
gains a moment in time. After a rule picks a station, the rule asks whether that station is open
at that moment. If it is not, the work walks the station's fallback chain, which ends at the venue
default station. The schedule, the fallbacks and today's by-hand changes live in three new
venue-service tables. The sending code (`fireLines`) reads the clock once, before routing, and
passes that instant to `resolveMakers`. A down printer reroutes nothing (owner, 2026-10-01). The
server works out which station printers have stopped printing and which stations' screens have gone
quiet, raises alerts, and shows them on Prep Stations (and a printer's on the station's kitchen
screen). The manager then closes the station by hand.

**Tech Stack:** TypeScript, Hono (server routes), drizzle-orm + drizzle-kit on `node:sqlite`, Lit web
components (dashboard and till; their suites run in real headless Chromium), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md](../specs/2026-09-30-catalogue-menus-routing-design.md),
§5.3 (the last paragraph), §5.7, §5.12 (the tester's time) and §7 item 1. The owner split slice 3
into four plans on 2026-10-01; this is the second. **Not in this plan:** split-off extras, ticket
cross-references, "Show the rest of the order", "Made here, no ticket" (3c); watchers and the
whole-order printer (3d).

**Builds after slice 3a** (`docs/superpowers/plans/2026-10-01-prep-station-rules-slice-3a.md`,
branch `feat/prep-station-rules`). Every file this plan modifies under `packages/venue-service/src/`
named `routing*`, `prep-stations-screen*` or `exception-sentence*` is created by 3a. Start this
branch from a `main` that holds 3a. Where this plan says "3a's X", read X in the code, not in the
3a plan: the code is what landed.

## Decisions for the owner (S1–S16)

The owner settled S1, S3 and S11 on 2026-10-01. Every other decision is a default this plan takes,
and approving the plan approves them.

- **S1. A down printer reroutes nothing (owner).** It raises an alert. The manager closes the
  station by hand, and the station's work then follows its fallback. The alert shows in three
  places: the dashboard's alert list, the station's card on Prep Stations (beside the Close
  button), and the station's kitchen screen (owner: "both"). One fault raises two dashboard alerts
  on purpose: today's `printer.jobs_waiting` in the printing area, for whoever looks after printers,
  and the new station alert in the kitchen area, for whoever runs the kitchen. A dark kitchen screen
  (S2b) is also alerted, and shown on Prep Stations.
- **S2. What "down" means, for a printer.** A printer attached to an active station counts as down
  when two things hold. First, it has a ticket the existing check counts as in trouble: unprinted
  for two minutes, or given up after five tries (`printJobInTrouble`,
  `apps/server/src/print-job-trouble.ts`). Second, the printer has printed nothing since that
  ticket was made. One down printer is enough, even if the station has another printer or a screen
  (owner). The second condition means one old given-up ticket keeps a printer counted as down only
  until the printer next prints something, not for ever. (Reading the code suggests
  `printJobInTrouble` alone would match such a ticket for ever; backlog item A165 is to reproduce
  that first.) So the alert says only what is known — "has printed nothing since something sent
  to it got stuck" — which stays true after someone fixes the printer and before its next ticket prints.
- **S2b. Kitchen screens that go dark while dishes wait are alerted too.** The design says someone
  is alerted when a station's printer OR screen is not reachable. The alert is raised when a
  station has at least one kitchen screen, none of its screens has checked in for three minutes,
  AND it has dishes sent to it in the last hour that are still waiting (not yet marked ready).
  Unlike the printer alert, it does not depend on the station being open: closing a station moves
  only new work, so dishes already waiting there still need someone to see them. A
  live screen checks in at least every 75 seconds or so: it asks every 15 seconds, and the server
  records at most one check-in a minute (research `slice3b-research-reachability.md` §2; worked out
  from the code, not measured). Requiring waiting dishes is what keeps the alert quiet at night,
  when screens are switched off and nothing is being sent — including at the default station,
  which is always open. **What it will get wrong:** a kitchen that works from paper and never marks
  dishes ready on its screen, with that screen switched off, is alerted for up to an hour after each
  send; and in the dev stack, a kitchen screen opened through the device chooser never records a
  check-in (`apps/server/src/device-session.ts:176-186`), so a send to its station alerts.
- **S3. A switched-off station follows its fallback (owner).** This replaces 3a's R2, which skipped
  to the next rule. A rule naming a switched-off station still matches, and the work then goes to
  that station's fallback, then that one's fallback, and so on, exactly as for a closed station.
  Two visible effects: the tester no longer says "Skipped", and an exception placed below one that
  names a switched-off station is now marked "Never used", because the one above it still catches
  the work. The tests that pinned the old behaviour are changed in Task 2, deliberately.
- **S4. Opening hours.** A schedule is a list of weekly intervals: a weekday, an opening time and a
  closing time. **A station with no intervals is always open.** An interval includes its opening
  minute and stops just before its closing minute. **A closing time earlier than the opening time
  runs past midnight:** "Friday 22:00–02:00" covers Friday from 22:00, then Saturday until 01:59.
  A closing time of 00:00 means until midnight. Intervals may overlap, and overlapping intervals
  simply add up. Times are read by the venue's wall clock. On the night the clocks go forward, the
  missing hour never happens. On the night they go back, the repeated hour counts twice. (Measured
  2026-10-01 for Madrid, research note `slice3b-research-time.md` §1.)
- **S5. "Today" is the venue's business day,** which ends at the day cutover (`locations.day_cutover`,
  06:00 by default). "Close for today" and "Open for today" last until the next cutover. "Back to the
  schedule" removes today's change. A change made on an earlier business day is ignored without
  anyone removing it. If a venue sets its cutover between 02:00 and 03:00, "today" can read as the
  previous day for up to an hour on the night the clocks go back (measured with a 02:30 cutover:
  30 minutes). The default 06:00 cutover is unaffected. This is accepted.
- **S6. The default station is always open while it is switched on.** It ignores its hours, any
  by-hand change and any fallback (design §7 item 1). Prep Stations offers none of those controls on
  the default's card. It says "Always open: this is the default station." When the default's printer
  is down, a separate alert says so, and the work waits on its screen or in its print queue.
- **S7. Fallbacks.** Each station names at most one fallback. With none named, its work goes to the
  default. A fallback must be a switched-on station of the same venue (`route.station_inactive`,
  the code 3a's writes use). It cannot lead back to the station itself (`station.fallback_loop`,
  new). A chain that a later switch-off breaks is still walked safely: a station met twice ends
  the walk at the default.
- **S8. An unreadable venue clock never stops a dish.** If the stored time zone or cutover cannot be
  read, hours and by-hand changes are ignored and every switched-on station counts as open.
  Switched-off stations still follow their fallbacks. The tester says "The venue's time zone
  cannot be read, so opening hours are not applied." A by-hand change is refused
  `venue.clock_unreadable` (new), because "today" cannot be worked out.
- **S9. One clock reading per send.** `fireLines` reads the time once, before routing, and uses that
  same instant for the hours check and for the fire time it stamps.
- **S10. A held dish keeps the station it was first sent to.** The station is fixed when the dish
  is first sent on hold, and releasing it later prints there even if that station has closed in
  between. The reason: the HOLD ticket may already have printed at that station (research note
  `slice3b-research-reachability.md` §4). A backlog entry records it.
- **S11. Opening and closing by hand is on the dashboard only (owner).** The till gets it later,
  through a backlog entry.
- **S12. Hours, fallback and by-hand changes get a one-line confirmation, not the full routing
  preview. This departs from the design's §5.12,** which asks for a preview listing the products
  that would move before any routing change is saved. These changes do move work: closing a
  station, or changing the fallback of a station that is closed or switched off, sends its dishes
  somewhere else at once. But every product the station makes moves together, to one place, so a
  single sentence says all that the list would: "Upstairs bar's work goes to Downstairs bar until
  06:00 tomorrow." A fallback change says "While Cocktail bar is closed, its work will go to Main
  bar", and when the station is closed or switched off right now it adds "That starts now." An
  hours change confirms nothing: it reroutes only at the times it names, which the tester shows.
- **S13. "Made at" on the products screen, and 3a's routing preview, ignore time.** Hours and
  by-hand changes do not apply to them. Switched-off stations still follow their fallbacks, because
  switching off is permanent.
- **S14. Hours and fallbacks travel in configuration export. By-hand changes do not.**
- **S15. Switching a station off asks where its work goes,** pre-filled with its current fallback.
  The fallback is saved first and the switch-off second, so if the second request fails, the
  station stays switched on with its new fallback, which it uses only while it is closed. The
  screen says the switch-off failed. The default station's
  switch-off asks nothing, because the default has no fallback.
  Prep Stations' "Switched off" list can change a switched-off station's fallback and switch it back
  on. Today no screen can switch a station back on, although the API allows it
  (`apps/server/src/management-api.ts:1688-1691`).
- **S16. The tester gains "When":** either "Now", which uses today's by-hand changes, or a weekday
  and a time, which uses the schedule alone.

## Global Constraints

- Every commit: `git commit -s`, message in plain English (owner rule; name files and codes once as
  pointers).
- Coverage `98/98/98/95` in every package touched; never close a gap with an exclude or an ignore
  comment. Mutation-tested packages touched: `db` (Task 5's two indexes only). A thinned test there
  reddens the weekly mutation run.
- Every colour, spacing, radius and font reads a `--wt-*` token. Markup handed to `wt-data-table` as
  a cell is styled with `part=`/`::part()`. A `wt-data-table` row menu column is keyed `actions` and
  declared `pinned: "end"`.
- Forms follow `docs/developers/design-system.md` → Forms: required fields are marked, and a field's
  problem shows beside the field. A hint goes in the field as its placeholder. The form's refusal
  message goes at the BOTTOM of the form, left-aligned on its own line, never beside the buttons
  or in a dialog's pinned button bar (owner 2026-09-30).
- UI words: the screen is **Prep stations** / **Estaciones de preparación** (3a). Weekdays reuse
  `venue.day.0` … `venue.day.6` (Sunday = 0, `packages/venue-service/src/dashboard/strings.ts:70-76`,
  Spanish `:174-180`). "Opening hours" / "Horario de apertura" reuses `venue.hours`.
- Every new string in English AND Spanish: venue-service screens in
  `packages/venue-service/src/dashboard/strings.ts`, till screens in the till's string table (find
  it with `grep -n 't("' apps/till/src/screens/till-station-screen.ts`), alert wording in
  `apps/dashboard/src/i18n/alert-messages.ts`.
- Error codes name the domain concept. New: `station.fallback_loop` and `venue.clock_unreadable`.
  Before committing, grep the siblings (`grep -rn '"station\.' apps/server/src/errors.ts packages/*/src/errors.ts`).
- Weekday numbering is Sunday = 0 everywhere, the convention of `department_hours`, `backup-config`
  and the weekday strings.
- Migrations: never edit a shipped migration file. Generate with
  `pnpm --filter <pkg> db:generate --name <name>`. READ every generated file: an unexpected
  `__new_<table>` rebuild is a STOP (CLAUDE.md §3). The migration numbers in this plan are
  illustrative. The generator picks the next free number, and `main` moves.
- The one fire point stays `fireLines` (`apps/server/src/working-order.ts`). The station is chosen
  and recorded when the work is sent. Neither a rule change nor a station closing moves work already
  sent.
- Module boundary: core code reaches venue-service only through the `VENUE_SERVICE` seat
  (`apps/server/src/modules.ts`, contract `packages/module/src/module.ts`). Core dashboard code never
  calls `/management-api/venue-service/*`. venue-service never imports `apps/server` or
  `@waitron/printing`. The venue-service dashboard imports only TYPES from `../routing.js`.
- Browser suites: check `memory_pressure | grep free` before a browser run; do not start one beside
  a whole-workspace `pnpm -r test:coverage`.
- Run focused tests while implementing; CI runs the package suites. Do not hand-run the pre-push
  checks before pushing.

## Review Focus

These are the inputs likeliest to hurt a venue. Each is pinned by a test in the task named:

1. **Hours past midnight.** Late bar is open Friday 22:00–02:00. It is open on Saturday at 01:00,
   closed on Saturday at 02:00, and closed on Friday at 21:59. With a closing time of 00:00, Friday
   23:59 is open and Saturday 00:00 is closed. (Task 2)
2. **A by-hand close that outlives its day.** Upstairs bar is closed by hand at 23:00 on Friday. At
   05:59 on Saturday it is still closed. At 06:00 Saturday, with the default cutover, it is back on
   its schedule, without anyone removing the row. (Task 3)
3. **A fallback chain that loops, or ends at a switched-off default.** Two stations, closed by hand
   and each naming the other, send their work to the default — through `fireLines`, not only in the
   pure rule. With the default switched off as well, sending is refused `station.no_default`, and
   paying sets the dish aside and raises `route.dish_not_sent`. (Tasks 2, 4)
4. **A printer that recovers.** A ticket given up at 20:00, then another ticket printed at 20:05:
   the printer is no longer down. At 20:03 it was. With no later ticket and the station closed by
   hand overnight, the alert returns when the station reopens at 06:00, and its wording ("has
   printed nothing since something sent to it got stuck") is still true. (Task 5)
5. **An unreadable time zone.** With `locations.time_zone` set to `Mars/Base`, a dish sent through
   `fireLines` for a station whose hours have ended is still made at that station, not refused.
   Close for today is refused `venue.clock_unreadable`. (Tasks 3, 4)
6. **One clock reading per send.** The clock advances by one millisecond at every reading, starting
   at Friday 20:59:59.999, and the station is open until 21:00. With one reading, the dish goes to
   that station and is stamped 20:59:59.999. A second reading would stamp 21:00:00.000 or route to
   the fallback, and the test fails either way. (Task 4)
7. **A dark kitchen screen.** Grill's only screen last checked in four minutes ago, Grill is open,
   and a dish sent ten minutes ago is still waiting: the alert is raised, and it stays raised if
   Grill is then closed, because the dish is still waiting. At two minutes, or with nothing waiting
   (the night), it is not. A station with no screen
   raises nothing. (Task 5)

---

## File structure

**Created**

- `packages/venue-service/src/schema/station-times.ts`: `stationHours`, `stationFallbacks`,
  `stationDayStates`.
- `packages/venue-service/src/station-times.ts` + `.test.ts`: `replaceStationHours`,
  `setStationFallback`, `setStationToday`, `venueMoment`.
- `packages/venue-service/drizzle/00NN_station_times.sql` (generated).
- `packages/db/drizzle/00NN_station_output_indexes.sql` (generated).
- `apps/server/src/station-outputs-down.ts` + `.test.ts`: `stationPrintersDown`, `stationScreensDark`.
- `packages/venue-service/src/dashboard/station-hours-form.ts` + `.test.ts`: the hours editor
  modal body.

**Modified (main ones).** Each task lists its own files exactly.

- `packages/reporting/src/business-day.ts`, `index.ts` (`venueMomentAt`)
- `packages/venue-service/src/{routing,routing-store,routes,service,errors,classification,
  configuration-transfer}.ts`, `schema/index.ts`, `dashboard/{prep-stations-screen,routing-client,
  strings,live-queries}.ts`
- `packages/module/src/module.ts` (the seat)
- `apps/server/src/{working-order,alert-sources,boot,management-api,device-api,till-api,errors}.ts`,
  `apps/server/src/testing/clear-provision-fixture.ts`, `apps/server/scripts/demo-seed/seed-floor.ts`
- `packages/db/src/schema/print-jobs.ts`, `packages/db/src/schema/ticket-items.ts`
- `apps/till/src/screens/till-station-screen.ts`, `apps/till/src/api/client.ts`
- `apps/dashboard/src/i18n/alert-messages.ts`
- `docs/backlog.md`, the design, `docs/developers/conventions-data.md` (if a rule there is touched)

---

### Task 1: The venue's local moment

A pure helper that turns an instant into the venue's weekday, time of day and business day. It
answers `null` instead of throwing when the venue's clock settings cannot be read (S8).

**Files:**
- Modify: `packages/reporting/src/business-day.ts` (add `venueMomentAt` beside `businessDayOf`),
  `packages/reporting/src/index.ts` (export it)
- Test: `packages/reporting/src/business-day.test.ts`

**Interfaces:**
- Produces:

```ts
export interface VenueMoment {
  readonly businessDay: string; // "YYYY-MM-DD", cutover-shifted, as businessDayOf
  readonly weekday: number; // 0 = Sunday … 6 = Saturday, of the wall clock (NOT cutover-shifted)
  readonly timeOfDay: string; // "HH:MM", of the wall clock
}

/** The venue's wall-clock weekday and time, and its business day, at `instant`. `null` when the
 *  zone or the cutover is not one `validateTimeZone` / `validateCutover` accept. */
export function venueMomentAt(
  instant: Date,
  clock: { timeZone: string; dayCutover: string },
): VenueMoment | null;
```

Build it on the file's private `wallClockMs` (the local wall clock expressed as UTC milliseconds):
`const wall = new Date(wallClockMs(instant.getTime(), timeZone))`, then `wall.getUTCDay()` and
`wall.toISOString().slice(11, 16)`. Wrap the two validators in one `try`/`catch` that returns
`null`. `businessDay` is `businessDayOf(instant, clock)`. Never use `instant.getUTCDay()`: near
midnight the venue's weekday and the UTC weekday differ.

- [ ] **Step 1: Write the failing tests**

```ts
describe("venueMomentAt", () => {
  const madrid = { timeZone: "Europe/Madrid", dayCutover: "06:00" };

  it("gives the venue's weekday, not UTC's, just after local midnight", () => {
    // 2026-10-02 is a Friday; 22:30Z is Saturday 00:30 in Madrid (summer time, UTC+2).
    expect(venueMomentAt(new Date("2026-10-02T22:30:00Z"), madrid)).toEqual({
      businessDay: "2026-10-02", weekday: 6, timeOfDay: "00:30",
    });
  });

  it("starts the business day at the cutover", () => {
    expect(venueMomentAt(new Date("2026-10-03T03:59:00Z"), madrid)?.businessDay).toBe("2026-10-02");
    expect(venueMomentAt(new Date("2026-10-03T04:00:00Z"), madrid)?.businessDay).toBe("2026-10-03");
  });

  it("reads the wall clock across both clock changes", () => {
    expect(venueMomentAt(new Date("2026-03-29T00:59:00Z"), madrid)?.timeOfDay).toBe("01:59");
    expect(venueMomentAt(new Date("2026-03-29T01:00:00Z"), madrid)?.timeOfDay).toBe("03:00");
    expect(venueMomentAt(new Date("2026-10-25T00:30:00Z"), madrid)?.timeOfDay).toBe("02:30");
    expect(venueMomentAt(new Date("2026-10-25T01:30:00Z"), madrid)?.timeOfDay).toBe("02:30");
  });

  it("answers null for a zone or cutover it cannot read", () => {
    expect(venueMomentAt(new Date(), { timeZone: "Mars/Base", dayCutover: "06:00" })).toBeNull();
    expect(venueMomentAt(new Date(), { timeZone: "+02:00", dayCutover: "06:00" })).toBeNull();
    expect(venueMomentAt(new Date(), { timeZone: "Europe/Madrid", dayCutover: "6am" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/reporting exec vitest run src/business-day.test.ts -t venueMomentAt`
Expected: FAIL, `venueMomentAt is not a function` (or not exported).

- [ ] **Step 3: Implement** as described above.

- [ ] **Step 4: Run to verify it passes** (same command). Expected: PASS.

- [ ] **Step 5: Commit**: `git add packages/reporting/src/business-day.ts packages/reporting/src/index.ts packages/reporting/src/business-day.test.ts && git commit -s -m "Reporting: venueMomentAt gives the venue's weekday, time of day and business day at an instant, or null when its clock settings cannot be read"`

---

### Task 2: The rule follows opening hours and fallbacks

Everything else calls this. It stays pure: rules, station timings and a moment go in, and a
decision comes out.

**Files:**
- Modify: `packages/venue-service/src/routing.ts`, `packages/venue-service/src/routing.test.ts`
- Modify (so the package typechecks after the type changes): every call of `chooseMaker` in
  `packages/venue-service/src` (`grep -rn 'chooseMaker(' packages/venue-service/src`) passes `null`
  for now — Task 4 passes a real moment on the send path; 3a's `loadRoutingRules`
  (`routing-store.ts`) returns `timing: new Map()` until Task 3 fills it; 3a's `RouteExplanation`
  replaces `skipped: SkippedRule[]` with `fallbacks: FallbackStep[]`, and `explainRoute` fills it
  from `chooseMaker`; 3a's tester stops rendering its "Skipped: …" line, and that line's case in
  `prep-stations-screen.test.ts` is deleted here (Task 8 adds the fallback sentences and their
  cases).

**Interfaces:**
- Consumes (3a, `routing.ts`): `RoutingRules`, `ProductFacts`, `RoutingDecision`, `MakerChoice`,
  `chooseMaker`, `unreachableExceptions`, `folderAncestors`.
- Produces (exported from `routing.ts` and re-exported from `packages/venue-service/src/index.ts`):

```ts
/** One weekly interval. Times are "HH:MM" or "HH:MM:SS"; only the first five characters count. */
export interface WeeklyInterval {
  readonly weekday: number; // 0 = Sunday
  readonly opensAt: string;
  readonly closesAt: string; // earlier than opensAt: runs past midnight into the next weekday
}

export interface StationTiming {
  readonly fallbackId: string | null; // null: the default station
  readonly hours: readonly WeeklyInterval[]; // empty: always open by schedule
  readonly today: "open" | "closed" | null; // today's by-hand change, already filtered to today
}

/** The venue's wall-clock weekday and time, or null when time does not apply (see below). */
export interface RoutingMoment {
  readonly weekday: number;
  readonly timeOfDay: string; // "HH:MM"
}

// RoutingRules (3a) GAINS one required field:
//   readonly timing: ReadonlyMap<string, StationTiming>; // a station with no entry: no hours, no fallback, no by-hand change

export type StationStatus =
  | { readonly open: true; readonly why: "default" | "opened_by_hand" | "in_hours" | "no_hours" | "time_not_applied" }
  | { readonly open: false; readonly why: "switched_off" | "closed_by_hand" | "out_of_hours" };

export interface FallbackStep {
  readonly stationId: string; // a station passed over
  readonly why: "switched_off" | "closed_by_hand" | "out_of_hours";
}

// MakerChoice (3a) CHANGES: `skipped` is deleted, and `fallbacks` replaces it:
export interface MakerChoice {
  readonly route: RouteTarget | null; // null: nothing can take it
  readonly decidedBy: RoutingDecision | null; // the rule that matched, before any fallback
  readonly fallbacks: readonly FallbackStep[]; // the stations passed over, in order
}

export function stationStatus(rules: RoutingRules, stationId: string, moment: RoutingMoment | null): StationStatus;

/** Where work for `stationId` is made at `moment`: the station, or the first open one down its
 *  fallback chain, or the default. `stationId: null` only when the default is needed and is off. */
export function followFallbacks(
  rules: RoutingRules,
  stationId: string,
  moment: RoutingMoment | null,
): { readonly stationId: string | null; readonly steps: readonly FallbackStep[] };

export function chooseMaker(
  rules: RoutingRules,
  product: ProductFacts,
  zoneId: string | null,
  moment: RoutingMoment | null,
): MakerChoice;

/** Where this station's work would go if it closed now: the walk from its fallback (or the default). */
export function closedSendsTo(rules: RoutingRules, stationId: string, moment: RoutingMoment | null): string | null;
```

`SkippedRule` is deleted.

**Behaviour (the tests pin each):**
- `stationStatus` checks these in order, and the first that applies decides:
  1. not in `activeStationIds`: closed, `switched_off`;
  2. equal to `defaultStationId`: open, `default` (S6);
  3. `moment` null: open, `time_not_applied`. Neither hours nor `today` applies; S8 and S13 both
     arrive here;
  4. `today === "closed"`: closed, `closed_by_hand`;
  5. `today === "open"`: open, `opened_by_hand`;
  6. no hours: open, `no_hours`;
  7. an interval covers the moment: open, `in_hours`. Otherwise closed, `out_of_hours`.
- An interval covers a moment, comparing `"HH:MM"` strings, with `o = opensAt.slice(0, 5)`,
  `c = closesAt.slice(0, 5)` and `t = moment.timeOfDay`:
  - when `o < c`: same weekday and `o <= t < c`;
  - otherwise (it runs past midnight): either the same weekday and `t >= o`, or the next weekday
    (`(weekday + 1) % 7 === moment.weekday`) and `t < c`.
- `followFallbacks` walks like this. Start at `stationId`. If it is the default (always open while
  switched on) or open, stop there. Otherwise record a step and move to its `fallbackId`. A
  station with no fallback, or one already visited, ends the walk at `defaultStationId`, which may
  be `null`.
- `chooseMaker` picks a rule exactly as in 3a, except that a rule naming a switched-off station is
  NO LONGER skipped (S3). Then, when the route is a station, it walks `followFallbacks`. The route
  becomes the station the walk ends at (`null` when that is `null`), and the steps become
  `fallbacks`. A `no_preparation` route never walks.
- `unreachableExceptions` loses its switched-off clause: an earlier exception whose station is
  switched off now catches work like any other.
- `closedSendsTo` walks from the station's `fallbackId` when it has one, otherwise from the default.
  It treats the station itself as already visited, so a chain that leads back to it ends at the
  default. It answers `defaultStationId` for the default station itself.

- [ ] **Step 1: Change 3a's tests that S3 retires, and write the new ones** (`routing.test.ts`).
  Add `timing: new Map()` to 3a's `base` rules. Then make these changes:
  - 3a's "skips a rule whose station is switched off, and records it" BECOMES "follows a
    switched-off station's fallback". Its active set must now include Main bar:
    `activeStationIds: new Set(["bar", "mainBar", "kitchen"])` (3a's was `["bar", "kitchen"]`, which
    would switch Main bar off too). With `"cocktailBar"` switched off and
    `timing: new Map([["cocktailBar", { fallbackId: "mainBar", hours: [], today: null }]])`, a mojito
    goes to `station("mainBar")`. `decidedBy` is still `{ kind: "claim", categoryId: "cocktails" }`,
    and `fallbacks` is `[{ stationId: "cocktailBar", why: "switched_off" }]`. With no timing entry,
    the mojito goes to `station("kitchen")`, the default. (Station ids are string literals in this
    file.)
  - 3a's "does not flag an exception behind one whose station is switched off" BECOMES "flags an
    exception behind one whose station is switched off". `unreachableExceptions` returns
    `new Set(["on"])`.
  - Every other 3a expectation that compared a whole `MakerChoice` gains `fallbacks: []` in place
    of `skipped: []`, and every 3a `chooseMaker(rules, product, zone)` call gains a fourth argument,
    `null`.
  - **Beyond this file:** S3 changes where work goes whenever a rule names a switched-off station,
    so 3a tests that assert the NEXT rule's station in that case now fail, and a grep for `skipped`
    does not find them because they assert a station. The known one is 3a Task 4's re-expression of
    "falls back past a switched-off station" (`operations.test.ts:1135` before 3a; after 3a, a
    switched-off claim skipped for the claim above, through `resolveMakers`). Run
    `pnpm --filter @waitron/venue-service exec vitest run --project node` and the server's routing
    suites (`pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/till-api.unroutable-dish.test.ts src/testing-zone-offers.test.ts`);
    each failure in which a rule names a switched-off station and the test expects the next rule's
    outcome (a station, or no preparation) is this intended change: rewrite it to expect the station's fallback (or the default),
    and say so in the commit message. Any other failure is a defect.

```ts
const at = (weekday: number, timeOfDay: string) => ({ weekday, timeOfDay });
const FRI = 5, SAT = 6;

describe("opening hours", () => {
  const rules: RoutingRules = {
    ...base,
    activeStationIds: new Set([...base.activeStationIds, "upstairs", "downstairs", "late"]),
    timing: new Map([
      ["upstairs", { fallbackId: "downstairs", hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }], today: null }],
      ["late", { fallbackId: null, hours: [{ weekday: FRI, opensAt: "22:00:00", closesAt: "02:00:00" }], today: null }],
      ["midnight", { fallbackId: null, hours: [{ weekday: FRI, opensAt: "20:00", closesAt: "00:00" }], today: null }],
    ]),
  };
  const open = (id: string, m: RoutingMoment | null) => stationStatus({ ...rules, activeStationIds: new Set([...rules.activeStationIds, "midnight"]) }, id, m);

  it("is open inside an interval, from its opening minute to just before its closing minute", () => {
    expect(open("upstairs", at(FRI, "19:00"))).toEqual({ open: true, why: "in_hours" });
    expect(open("upstairs", at(FRI, "20:59"))).toEqual({ open: true, why: "in_hours" });
    expect(open("upstairs", at(FRI, "21:00"))).toEqual({ open: false, why: "out_of_hours" });
    expect(open("upstairs", at(SAT, "20:00"))).toEqual({ open: false, why: "out_of_hours" });
  });

  it("runs an interval past midnight when it closes earlier than it opens", () => {
    expect(open("late", at(FRI, "21:59")).open).toBe(false);
    expect(open("late", at(FRI, "23:30")).open).toBe(true);
    expect(open("late", at(SAT, "01:59")).open).toBe(true);
    expect(open("late", at(SAT, "02:00")).open).toBe(false);
    expect(open("midnight", at(FRI, "23:59")).open).toBe(true);
    expect(open("midnight", at(SAT, "00:00")).open).toBe(false);
  });

  it("wraps Saturday's late interval into Sunday", () => {
    const sat = { ...rules, timing: new Map([["late", { fallbackId: null, hours: [{ weekday: SAT, opensAt: "22:00", closesAt: "02:00" }], today: null }]]) };
    expect(stationStatus(sat, "late", at(0, "01:00")).open).toBe(true);
  });

  it("treats a station with no hours as open, and the default as open whatever its hours say", () => {
    expect(open("downstairs", at(FRI, "04:00"))).toEqual({ open: true, why: "no_hours" });
    const kitchenHours = { ...rules, timing: new Map([["kitchen", { fallbackId: "bar", hours: [{ weekday: 1, opensAt: "09:00", closesAt: "10:00" }], today: "closed" as const }]]) };
    expect(stationStatus(kitchenHours, "kitchen", at(FRI, "20:00"))).toEqual({ open: true, why: "default" });
  });

  it("lets a by-hand change win over the hours, and ignores both when time does not apply", () => {
    const closed = { ...rules, timing: new Map([["upstairs", { fallbackId: "downstairs", hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }], today: "closed" as const }]]) };
    expect(stationStatus(closed, "upstairs", at(FRI, "20:00"))).toEqual({ open: false, why: "closed_by_hand" });
    const opened = { ...rules, timing: new Map([["upstairs", { fallbackId: "downstairs", hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }], today: "open" as const }]]) };
    expect(stationStatus(opened, "upstairs", at(SAT, "12:00"))).toEqual({ open: true, why: "opened_by_hand" });
    expect(stationStatus(closed, "upstairs", null)).toEqual({ open: true, why: "time_not_applied" });
  });

  it("calls a switched-off station closed, even when time does not apply", () => {
    expect(stationStatus(base, "retired", null)).toEqual({ open: false, why: "switched_off" });
  });
});

describe("fallbacks", () => {
  const rules: RoutingRules = {
    ...base,
    claims: new Map([["drinks", station("upstairs")]]),
    activeStationIds: new Set(["upstairs", "downstairs", "kitchen", "a", "b"]),
    timing: new Map([
      ["upstairs", { fallbackId: "downstairs", hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }], today: null }],
      ["downstairs", { fallbackId: null, hours: [], today: null }],
      ["a", { fallbackId: "b", hours: [], today: "closed" }],
      ["b", { fallbackId: "a", hours: [], today: "closed" }],
    ]),
  };

  it("sends a closed station's work down its fallback chain, and says why", () => {
    expect(chooseMaker(rules, lager, null, at(FRI, "22:00"))).toEqual({
      route: station("downstairs"),
      decidedBy: { kind: "claim", categoryId: "drinks" },
      fallbacks: [{ stationId: "upstairs", why: "out_of_hours" }],
    });
    expect(chooseMaker(rules, lager, null, at(FRI, "20:00")).route).toEqual(station("upstairs"));
  });

  it("ends a loop at the default station", () => {
    expect(followFallbacks(rules, "a", at(FRI, "20:00"))).toEqual({
      stationId: "kitchen",
      steps: [{ stationId: "a", why: "closed_by_hand" }, { stationId: "b", why: "closed_by_hand" }],
    });
  });

  it("answers no station when the walk reaches a switched-off default", () => {
    expect(followFallbacks({ ...rules, defaultStationId: null }, "a", at(FRI, "20:00")).stationId).toBeNull();
    expect(chooseMaker({ ...rules, defaultStationId: null, claims: new Map([["drinks", station("a")]]) }, lager, null, at(FRI, "20:00")).route).toBeNull();
  });

  it("never walks a no-preparation route", () => {
    const np = { ...rules, claims: new Map([["drinks", { kind: "no_preparation" as const }]]) };
    expect(chooseMaker(np, lager, null, at(FRI, "22:00"))).toEqual({
      route: { kind: "no_preparation" }, decidedBy: { kind: "claim", categoryId: "drinks" }, fallbacks: [],
    });
  });

  it("says where a station's work would go if it closed", () => {
    expect(closedSendsTo(rules, "upstairs", at(FRI, "20:00"))).toBe("downstairs");
    expect(closedSendsTo(rules, "downstairs", at(FRI, "20:00"))).toBe("kitchen");
    expect(closedSendsTo(rules, "a", at(FRI, "20:00"))).toBe("kitchen"); // b is closed and leads back to a
    expect(closedSendsTo(rules, "kitchen", at(FRI, "20:00"))).toBe("kitchen");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing.test.ts`
Expected: FAIL. `stationStatus` and `followFallbacks` are not exported, and the switched-off case
still reads `skipped`.

- [ ] **Step 3: Implement** to the interfaces and behaviour above. Never mutate the input. Make
  the caller changes listed under **Files**, and change 3a's other tests that read `skipped` to read
  `fallbacks` (`grep -rn 'skipped\|Skipped' packages/venue-service/src`).

- [ ] **Step 4: Run to verify it passes**, then the package's node project:
  `pnpm --filter @waitron/venue-service exec vitest run --project node` and
  `pnpm --filter @waitron/venue-service typecheck`. Read `routing.ts`'s row in
  `pnpm --filter @waitron/venue-service exec vitest run --project node --coverage src/routing.test.ts`:
  100% lines and branches. That run exits non-zero, because the package's thresholds apply to files
  this one test does not load. The row is the evidence, not the exit code.

- [ ] **Step 5: Commit**: "Prep stations rule: a station that is closed, out of hours or switched off passes its work down its fallback chain to the default".

---

### Task 3: Hours, fallbacks and today's by-hand changes are stored, read and written

**Files:**
- Create: `packages/venue-service/src/schema/station-times.ts`. Export it where 3a's
  `schema/routing.ts` is exported.
- Create (generated): `packages/venue-service/drizzle/00NN_station_times.sql`
- Create: `packages/venue-service/src/station-times.ts`, `station-times.test.ts`
- Modify: `packages/venue-service/src/routing-store.ts` (`loadRoutingRules` reads the timings;
  `routingModel` gains the station times), `routes.ts` (three endpoints), `errors.ts`
  (`station.fallback_loop`, `venue.clock_unreadable`), `classification.ts` (three tables, `state`),
  `configuration-transfer.ts` (`station_hours`, `station_fallbacks`, the way `department_hours` is
  listed; NOT `station_day_states`), `index.ts`
- Modify: `apps/server/src/testing/clear-provision-fixture.ts` (delete from the three new tables
  before `kitchen_stations`)
- Modify: `scripts/schema-constraints.test.ts` (pin the new keys, checks and unique indexes, beside
  3a's `station_claims` entries)
- Test: `station-times.test.ts`, `routing-store.test.ts`, `routes.test.ts`, `migrations.test.ts`,
  `classification.test.ts`, `service.test.ts` (the transfer list)

**Schema** (`schema/station-times.ts`; import `table`, `id`, `count`, `timeOfDay`, `day`, `flag`,
`newId` and `kitchenStations` from `@waitron/db`, as `schema/service.ts:1-20` does):

```ts
export const stationHours = table(
  "station_hours",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    stationId: id("station_id").notNull(),
    weekday: count("weekday").notNull(),
    opensAt: timeOfDay("opens_at").notNull(),
    closesAt: timeOfDay("closes_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "station_hours_station_fk" }),
    check("station_hours_weekday_ck", sql`${t.weekday} between 0 and 6`),
    check("station_hours_distinct_ck", sql`${t.opensAt} <> ${t.closesAt}`),
    uniqueIndex("station_hours_interval_key").on(t.stationId, t.weekday, t.opensAt, t.closesAt),
  ],
);

export const stationFallbacks = table(
  "station_fallbacks",
  {
    stationId: id("station_id").primaryKey(),
    fallbackStationId: id("fallback_station_id").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "station_fallbacks_station_fk" }),
    foreignKey({ columns: [t.fallbackStationId], foreignColumns: [kitchenStations.id], name: "station_fallbacks_fallback_fk" }),
    check("station_fallbacks_not_self_ck", sql`${t.stationId} <> ${t.fallbackStationId}`),
  ],
);

export const stationDayStates = table(
  "station_day_states",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    stationId: id("station_id").notNull(),
    businessDay: day("business_day").notNull(),
    open: flag("open").notNull(), // true: opened by hand for that day; false: closed by hand
  },
  (t) => [
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "station_day_states_station_fk" }),
    uniqueIndex("station_day_states_day_key").on(t.stationId, t.businessDay),
  ],
);
```

Stations are never deleted, only switched off (`apps/server/src/kitchen.ts:169-185`), so no key
needs a cascade. Times are stored as `HH:MM:SS`. Reuse `storedTime` from `operations.ts:86`: export
it, or move it into `station-times.ts` and import it back.

**Interfaces** (`station-times.ts`; every writer takes a `tx: Transaction` and opens none; `cfg` is
3a's `VenueScope`, `{ locationId }`):

```ts
export async function venueMoment(tx: Transaction, cfg: VenueScope, at: Date): Promise<VenueMoment | null>;
  // readLocationClock, then venueMomentAt (Task 1). A missing location row still throws, as readLocationClock does.
export async function replaceStationHours(tx, cfg, stationId: string, hours: readonly WeeklyInterval[]): Promise<void>;
  // the station must be this venue's (switched off allowed): otherwise station.not_found { stationId }.
  // Deletes the station's whole set, then inserts (CLAUDE.md §3: rewriting rows one at a time can break a unique index).
export async function setStationFallback(tx, cfg, stationId: string, fallbackStationId: string | null): Promise<void>;
  // station.not_found for an unknown station; route.station_inactive { stationId: fallbackStationId }
  // for a fallback that is unknown, another venue's or switched off; station.fallback_loop
  // { stationId, fallbackStationId } when walking fallbacks from fallbackStationId reaches stationId
  // (itself included). null deletes the row.
export async function setStationToday(tx, cfg, stationId: string, state: "open" | "closed" | null, at: Date): Promise<void>;
  // station.not_found; venue.clock_unreadable {} when venueMoment answers null. Deletes the
  // station's rows for every OTHER business day, then upserts today's row (null deletes it). The
  // upsert names its conflict target, `.onConflictDoUpdate({ target: [stationDayStates.stationId,
  // stationDayStates.businessDay], … })` (CLAUDE.md §3: an untargeted conflict clause absorbs every
  // unique conflict).
```

`station.not_found` is declared in `@waitron/db`'s `errors.ts` (`packages/db/src/errors.ts:30`).
Throw it from there. The two new codes go in venue-service's own `errors.ts`. venue-service's route
`STATUS` map (`packages/venue-service/src/routes.ts:50-65`) has no `station.not_found` today, and an
unmapped code answers 400 (`packages/server-kit/src/error-boundary.ts:31`), so add
`"station.not_found": 404`, `"station.fallback_loop": 409` and `"venue.clock_unreadable": 409`.

**3a's store changes** (`routing-store.ts`):

```ts
export async function loadRoutingRules(tx, cfg, businessDay: string | null): Promise<RoutingRules>;
  // Gains `timing`: every station's hours, fallback, and, when businessDay is not null, its
  // by-hand change for that day. One query per table.

export interface StationTimes {
  stationId: string;
  status: StationStatus; // at `at`
  hours: WeeklyInterval[]; // "HH:MM", ordered by weekday, then opening time
  fallbackStationId: string | null;
  today: "open" | "closed" | null;
  closedSendsTo: string | null; // closedSendsTo(rules, stationId, moment)
}
// RoutingModel (3a) GAINS:
//   stationTimes: StationTimes[]; // every station of the venue, switched on or off
//   (3a's `stations`, which named only stations a rule names plus the default, now lists EVERY
//   station of the venue, switched on or off, with its name and `active` flag: the fallback
//   combobox and the "Switched off" list need the names of switched-off stations no rule names,
//   and core's `GET /management-api/stations` lists switched-on ones only)
//   todayEnds: { timeOfDay: string; tomorrow: boolean } | null;
//     // when a by-hand change made now lapses: the cutover "HH:MM", and whether that is on the
//     // venue's next calendar date (now's wall-clock time is at or after the cutover) or later
//     // today (before it: 01:30 with a 06:00 cutover lapses at 06:00 today). null: clock unreadable.
//   clockReadable: boolean;
export async function routingModel(tx, cfg, at: Date): Promise<RoutingModel>;
```

The store's second "never used" check — a product exception that an earlier folder exception
always catches (3a plan, Task 2, `routingModel`'s `neverMatches`) — drops its "with an active
station" condition, as Task 2 did for the pure check (S3): an earlier exception naming a
switched-off station still catches the work.

Every other 3a caller of `loadRoutingRules` passes `null` (S13: preview, `describeMakers`), until
Task 4 wires the send path and Task 8 the tester. 3a's tests that call `routingModel(tx, cfg)` or
`loadRoutingRules(tx, cfg)` gain the new argument in this task
(`grep -rn 'routingModel(\|loadRoutingRules(' packages/venue-service/src apps/server/src`): pass a
fixed instant, never `new Date()`, so no test depends on the day it runs.

**HTTP routes** (`routes.ts`, all behind `MANAGE_VENUE_SERVICE`, errors through `STATUS`):
- `PUT /management-api/venue-service/stations/:stationId/hours` body
  `{ hours: [{ weekday, opensAt, closesAt }] }` → 204. Validate exactly as the department hours
  route does (`routes.ts:239-272`: an integer weekday 0–6, `CLOCK_TIME` times, opening ≠ closing;
  refusals `management.request_invalid` with `field` `hours` or `hours.N`).
- `PUT /management-api/venue-service/stations/:stationId/fallback` body
  `{ fallbackStationId: string | null }` → 204. A missing key gives
  `management.request_invalid { field: "fallbackStationId" }`.
- `PUT /management-api/venue-service/stations/:stationId/today` body
  `{ state: "open" | "closed" | null }` → 204. Any other value gives `{ field: "state" }`.
- `GET /management-api/venue-service/routing` passes `new Date()` to `routingModel`.

- [ ] **Step 1: Write the failing store tests** (`station-times.test.ts`), with `useVenueDb` and
  `[CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS]`, set up as
  `routing-store.test.ts` is (3a). Seed the location with `timeZone: "Europe/Madrid"` and
  `dayCutover: "06:00:00"`, and stations Upstairs bar, Downstairs bar, Kitchen (default) and
  Retired (switched off). Every refusal asserts the domain code, never just `Error`.

```ts
it("replaces a station's whole week, and refuses another venue's station", async () => {
  await replaceStationHours(tx, cfg, upstairs, [{ weekday: 5, opensAt: "19:00", closesAt: "21:00" }]);
  await replaceStationHours(tx, cfg, upstairs, [{ weekday: 6, opensAt: "19:00", closesAt: "21:00" }]);
  const model = await routingModel(tx, cfg, new Date("2026-10-02T18:00:00Z"));
  expect(model.stationTimes.find((s) => s.stationId === upstairs)?.hours)
    .toEqual([{ weekday: 6, opensAt: "19:00", closesAt: "21:00" }]);
  await expect(replaceStationHours(tx, cfg, otherVenueStation, [])).rejects.toMatchObject({ code: "station.not_found" });
});

it("refuses a fallback that is switched off, or that leads back to the station", async () => {
  await expect(setStationFallback(tx, cfg, upstairs, retired)).rejects.toMatchObject({ code: "route.station_inactive" });
  await expect(setStationFallback(tx, cfg, upstairs, upstairs)).rejects.toMatchObject({ code: "station.fallback_loop" });
  await setStationFallback(tx, cfg, upstairs, downstairs);
  await expect(setStationFallback(tx, cfg, downstairs, upstairs)).rejects.toMatchObject({ code: "station.fallback_loop" });
  await setStationFallback(tx, cfg, retired, downstairs); // a switched-off station's own fallback can be set (S15)
});

it("keeps a by-hand close until the cutover, without anyone removing it", async () => {
  // Friday 2026-10-02, 23:00 in Madrid is 21:00Z.
  await setStationToday(tx, cfg, upstairs, "closed", new Date("2026-10-02T21:00:00Z"));
  const at0559 = await routingModel(tx, cfg, new Date("2026-10-03T03:59:00Z")); // Sat 05:59
  expect(at0559.stationTimes.find((s) => s.stationId === upstairs)?.status).toEqual({ open: false, why: "closed_by_hand" });
  const at0600 = await routingModel(tx, cfg, new Date("2026-10-03T04:00:00Z")); // Sat 06:00
  expect(at0600.stationTimes.find((s) => s.stationId === upstairs)?.status).toEqual({ open: true, why: "no_hours" });
});

it("goes back to the schedule, and tidies away earlier days", async () => {
  await setStationToday(tx, cfg, upstairs, "closed", new Date("2026-10-02T21:00:00Z"));
  await setStationToday(tx, cfg, upstairs, "open", new Date("2026-10-03T10:00:00Z"));
  expect(await tx.select().from(stationDayStates)).toHaveLength(1);
  await setStationToday(tx, cfg, upstairs, null, new Date("2026-10-03T10:00:00Z"));
  expect(await tx.select().from(stationDayStates)).toHaveLength(0);
});

it("refuses a by-hand change when the venue's clock cannot be read", async () => {
  await tx.update(locations).set({ timeZone: "Mars/Base" }).where(eq(locations.id, cfg.locationId));
  await expect(setStationToday(tx, cfg, upstairs, "closed", new Date())).rejects.toMatchObject({ code: "venue.clock_unreadable" });
  expect((await routingModel(tx, cfg, new Date())).clockReadable).toBe(false);
});

it("says where a station's work would go if it closed", async () => {
  await setStationFallback(tx, cfg, upstairs, downstairs);
  const model = await routingModel(tx, cfg, new Date("2026-10-02T18:00:00Z"));
  expect(model.stationTimes.find((s) => s.stationId === upstairs)?.closedSendsTo).toBe(downstairs);
  expect(model.stationTimes.find((s) => s.stationId === downstairs)?.closedSendsTo).toBe(kitchen);
});

it("says whether today's by-hand change lapses later today or tomorrow", async () => {
  // Friday 20:00 Madrid is 18:00Z; Saturday 01:30 Madrid is Friday 23:30Z.
  expect((await routingModel(tx, cfg, new Date("2026-10-02T18:00:00Z"))).todayEnds).toEqual({ timeOfDay: "06:00", tomorrow: true });
  expect((await routingModel(tx, cfg, new Date("2026-10-02T23:30:00Z"))).todayEnds).toEqual({ timeOfDay: "06:00", tomorrow: false });
  // Exactly 06:00 Saturday (04:00Z) starts a new business day, which ends at 06:00 on Sunday.
  expect((await routingModel(tx, cfg, new Date("2026-10-03T04:00:00Z"))).todayEnds).toEqual({ timeOfDay: "06:00", tomorrow: true });
});
```

  In `routing-store.test.ts`: `routingModel(...).stations` lists a switched-off station that no
  claim or exception names, with its name and `active: false`, and so does `stationTimes`.
  Also: a folder exception "Drinks from Terrace" to a switched-off station,
  then a product exception "Mojito from Terrace" below it → the product exception is
  `neverMatches: true` (3a's case with an active station keeps passing).

  In `service.test.ts`, beside "never the kitchen notices, which are operational rows"
  (`:41-46`): configuration transfer lists `station_hours` and `station_fallbacks` and never
  `station_day_states`.

- [ ] **Step 2: Run**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/station-times.test.ts`.
  Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the schema, then
  `pnpm --filter @waitron/venue-service db:generate --name station_times`. READ the SQL: three
  `CREATE TABLE`s and their indexes, nothing else. Then the store, the 3a store changes, the
  classification and transfer lists, the errors and the routes.
- [ ] **Step 4: Write the route tests** in `routes.test.ts` beside 3a's routing route cases: each
  endpoint's 204; the body refusals with their `field`; `station.fallback_loop` → 409; an unknown
  station → `station.not_found` 404. Then run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/station-times.test.ts src/routing-store.test.ts src/routes.test.ts src/migrations.test.ts src/classification.test.ts src/service.test.ts`
  and `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/errors-reachable.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: "Prep stations: each station's opening hours, fallback and today's by-hand open or close are stored, checked and (except today's change) exported".

---

### Task 4: Sending reads the clock once and follows hours and fallbacks

**Files:**
- Modify: `packages/module/src/module.ts`. In `VenueServiceContribution`, `resolveMakers` GAINS
  `at: Date` as its last parameter. ADD:

```ts
/** Each station's state at `at`, for the station alerts: whether it is taking work now, and
 *  whether it is the default. Every station of the venue, switched off included. */
stationStates(
  tx: Transaction,
  cfg: { locationId: LocationId },
  at: Date,
): Promise<ReadonlyMap<string, { open: boolean; isDefault: boolean }>>;
```

- Modify: `packages/venue-service/src/routing-store.ts`. `resolveMakers(tx, cfg, zoneId,
  productIds, at)` calls `venueMoment` once, loads the rules with its `businessDay` (or `null` when
  the moment is `null`), and passes the moment to `chooseMaker`. Add `stationStates`.
  `packages/venue-service/src/service.ts` wires both.
- Modify: every 3a test that calls `resolveMakers(tx, cfg, zone, ids)` gains a fixed instant
  (`grep -rn 'resolveMakers(' packages/venue-service/src apps/server/src apps/server/scripts`).
  That includes 3a Task 13's demo-seed test (`apps/server/src/demo-seed.test.ts`, or wherever 3a put
  it): give it a fixed weekday evening now, because Task 9 gives Upstairs bar opening hours, and a
  test reading `new Date()` would then pass only on some days.
- Modify: `apps/server/src/working-order.ts`. In `fireLines`, move the one clock reading to the
  FIRST statement of the function, before any `await`:
  `const now = new Date(); const firedAt = now.toISOString();`. (The test below replaces `Date`
  with one that moves on every reading. Any other code that reads the clock while `fireLines` waits
  on an `await` would take a step first; the plan's re-check measured a timer in such a gap shifting
  the reading. A correct implementation would then fail the test.) Pass `now` to
  `resolveMakers`, and use `firedAt` where `nowIso()` was used. Keep the comment "One clock reading
  for the whole round", now true of routing as well. `heldNoRouteLines` (3a) reads `new Date()` once
  and passes it too.
- Tests: `packages/venue-service/src/routing-store.test.ts`, `apps/server/src/working-order.test.ts`,
  `apps/server/src/till-api.unroutable-dish.test.ts` (or wherever 3a left the "nothing can take it"
  cases: `grep -rln 'station.no_default' apps/server/src/*.test.ts`)

- [ ] **Step 1: Write the failing tests.** In `routing-store.test.ts`:

```ts
it("sends a closed station's work to its fallback, and an open one's to itself", async () => {
  await setClaim(tx, cfg, drinks, { kind: "station", stationId: upstairs });
  await replaceStationHours(tx, cfg, upstairs, [{ weekday: 5, opensAt: "19:00", closesAt: "21:00" }]);
  await setStationFallback(tx, cfg, upstairs, downstairs);
  const fri2030 = new Date("2026-10-02T18:30:00Z");
  const fri2200 = new Date("2026-10-02T20:00:00Z");
  expect((await resolveMakers(tx, cfg, null, [lager], fri2030)).get(lager)).toEqual({ kind: "station", stationId: upstairs });
  expect((await resolveMakers(tx, cfg, null, [lager], fri2200)).get(lager)).toEqual({ kind: "station", stationId: downstairs });
});

it("sends a switched-off station's work to its fallback", async () => { /* claim → retired, retired's fallback downstairs → downstairs */ });

it("ignores hours when the venue's clock cannot be read", async () => {
  // As the first case, but with time_zone "Mars/Base": Friday 22:00 still goes to Upstairs bar.
});

it("answers null when the chain ends at a switched-off default", async () => { /* upstairs closed by hand, no fallback, kitchen switched off → null */ });
```

  In `apps/server/src/working-order.test.ts`, with the location's zone set to `Europe/Madrid`:
  - **One clock reading (Review Focus 6).** A frozen fake clock cannot tell one reading from two
    (the review measured it: under `vi.useFakeTimers({ toFake: ["Date"] })` two readings 20 ms apart
    return the same instant). So use a clock that moves on every reading — the idea
    `apps/server/src/vat-rate-at-issue.test.ts:76-108` uses with an injected clock object (switched
    on at `:482`) for the
    payment path; `fireLines` has no injected clock, so here: replace `globalThis.Date` for the call
    with a subclass whose no-argument constructor returns a start
    instant plus one millisecond per construction so far (`Date.now()` likewise), and restore it in
    `finally`. Install it immediately before calling `fireLines` directly (not through a route,
    so no other request work reads the clock first), and remove it straight after. Its first
    construction returns the start instant itself; each later one adds a millisecond. Start it at
    Friday 20:59:59.999 local (`2026-10-02T18:59:59.999Z`). Upstairs bar
    claims Drinks, opens 19:00–21:00 on Friday, and has Downstairs bar as its fallback. A lager's
    ticket item must be at Upstairs bar AND stamped `2026-10-02T18:59:59.999Z`. (Two readings
    would stamp `…19:00:00.000Z` or route to Downstairs bar.) Count the constructions the stub saw
    during `fireLines` only if the stamp check proves too weak; do not assert an exact count, since
    other code on the path may read the clock.
  - With a plain fake clock (`vi.useFakeTimers({ toFake: ["Date"] })`, `vi.setSystemTime`) at Friday
    21:00 local, the lager is at Downstairs bar.
  - **A loop (Review Focus 3).** Upstairs bar and Downstairs bar are both closed by hand and each
    names the other as its fallback: the lager is at Kitchen. Make both by-hand closes and the send
    at the same fake time (Friday 20:00 local), so all three fall on one business day.
    `setStationFallback` refuses a loop,
    so insert the two `station_fallbacks` rows directly: the walk's loop guard is a defence against
    rows written some other way, and this test is what holds it.
  - **An unreadable clock (Review Focus 5).** `locations.time_zone` set to `Mars/Base`, Friday 22:00:
    the lager is at Upstairs bar, and the send is not refused.
  - Closed by hand with no fallback and the default switched off: sending is refused
    `station.no_default`. On the payment path (`unroutable: "skip"`), the dish is set aside and
    `route.dish_not_sent` is raised. Reuse 3a's cases for the shape.

- [ ] **Step 2: Run**
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing-store.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts -t "opening hours"`
  (name the new `describe` "opening hours"). Expected: FAIL. Then, as a control for the clock case,
  temporarily add a second `new Date()` read for `firedAt` after routing and confirm that case fails;
  remove it.
- [ ] **Step 3: Implement** the seat, the store and `fireLines`.
- [ ] **Step 4: Run** the venue-service node project and
  `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/till-api.unroutable-dish.test.ts src/till-sale.test.ts src/order-groups.test.ts src/kitchen-print.test.ts`,
  then `pnpm --filter @waitron/server typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Sending: one clock reading decides both the station's opening hours and the fire time; closed and switched-off stations pass work to their fallbacks".

---

### Task 5: A station whose printer stops printing, or whose screens go dark, is alerted

**Files:**
- Modify: `packages/db/src/schema/print-jobs.ts`: add
  `index("print_jobs_printer_delivered_idx").on(t.printerId, t.deliveredAt)`; and
  `packages/db/src/schema/ticket-items.ts`: add
  `index("ticket_items_waiting_idx").on(t.stationId, t.state, t.firedAt)`. Then
  `pnpm --filter @waitron/db db:generate --name station_output_indexes`. READ it: two
  `CREATE INDEX` statements, nothing else. The index keeps "printed since" cheap, because no code deletes
  old print jobs, and the second keeps the waiting-dish check to the last hour. `packages/db` has a
  mutation floor of 90: change each index's name by hand, run
  `pnpm --filter @waitron/db exec vitest run`, and record which test fails. If none does, add a case
  to the db suite that pins its schema against its migrations (`grep -rln 'index_list\|_journal' packages/db/src/*.test.ts`)
  asserting each index exists by name, and confirm the hand mutation now fails it.
- Create: `apps/server/src/station-outputs-down.ts`, `station-outputs-down.test.ts`
- Modify: `apps/server/src/alert-sources.ts` (`stationOutputAlertSource`), `apps/server/src/boot.ts`
  (register it in `serverAlertSources`, `:1651-1662`, passing `till.locationId` (in scope there,
  `boot.ts:1342`) and the real seat call
  `(tx, at) => VENUE_SERVICE.stationStates(tx, { locationId: till.locationId }, at)`),
  `apps/dashboard/src/i18n/alert-messages.ts` (four codes, both languages)
- Modify: `apps/server/src/management-api.ts`: `GET /management-api/stations/outputs-down` →
  `{ printersDown: DownPrinter[]; screensDark: DarkScreen[] }`, gated as the other station routes are
  (`venue.configure`, `withVenueAuth`)
- Modify: `apps/server/src/device-api.ts` (`GET /api/device/station`, `:198-212`) and
  `apps/server/src/till-api.ts` (`GET /api/stations/:id/queue`, `:1309`). Each station response
  gains `printersDown: { printerId, printerName, since }[]` for its own station only (a screen does
  not report on itself).
- Tests: `station-outputs-down.test.ts`, `alert-sources.test.ts`, `device-api.test.ts`, the till
  station-queue cases, the management-api station cases

**Interfaces:**

```ts
export interface DownPrinter {
  stationId: string; stationName: string;
  printerId: string; printerName: string;
  since: string; // created_at of the oldest ticket that counts
}
export interface DarkScreen {
  stationId: string; stationName: string;
  lastSeenAt: string | null; // the newest check-in among the station's screens; null: never seen
}

/** Each active printer attached to an active station of `locationId` (only `stationId`'s, when
 *  given) that has a ticket `printJobInTrouble(now)` matches, that an Unpair did not end, and that
 *  was made after the printer's last delivered job. One row per (station, printer). */
export async function stationPrintersDown(
  tx: Transaction, locationId: string, now: Date, stationId?: string,
): Promise<DownPrinter[]>;

/** Each active station of `locationId` with at least one active kitchen-screen device bound to it
 *  (`devices.station_id`), none of which has checked in (`devices.last_seen_at`) within
 *  `SCREEN_DARK_MS` of `now`, and with a dish fired within `WAITING_WINDOW_MS` that is still
 *  queued or being prepared. */
export const SCREEN_DARK_MS = 3 * 60 * 1000;
export const WAITING_WINDOW_MS = 60 * 60 * 1000;
export async function stationScreensDark(tx: Transaction, locationId: string, now: Date): Promise<DarkScreen[]>;
```

**Printer query shape:** `station_printers` joined to `kitchen_stations` (active, this location,
and `= stationId` when given), `printers` (active) and `print_jobs` (on the printer), where
`inArray(printJobs.status, ["queued", "printing", "failed"])` AND `printJobInTrouble(now)` (the
first condition repeats part of the second on purpose: measured by the plan's re-check on
`node:sqlite` with no table statistics, `printJobInTrouble`'s `or` alone makes SQLite match on
`printer_id` only and read every job the printer ever had, while a `status in (…)` condition at the
top level lets it use `print_jobs_pull_idx (printer_id, status)`), the Unpair exclusion exactly as `printingAlertSource` writes it
(`alert-sources.ts:294-297`, `PRINTER_UNPAIRED`), and `not exists` a job `d` on the same printer
with `d.kind = 'document'`, `d.status = 'done'` and `d.delivered_at > print_jobs.created_at` (a
delivered cash-drawer pulse is not a print and must not lift the alert). Use `alias(printJobs, "d")`.
`print_jobs` is a JOIN here, not the `.from()` base, but READ the emitted SQL with `.toSQL()` all
the same (CLAUDE.md §3, the correlated subquery rule), and run `explain query plan` on it in the
test file's database: the main scan must name `print_jobs_pull_idx` and the `not exists` must name
`print_jobs_printer_delivered_idx`. Put that check in the suite as a test, so a later edit that
loses the index fails. Group by station and printer, with `since = min(print_jobs.created_at)`. This takes the printer's tickets wherever they came from, not
only this station's kitchen tickets: a printer that cannot print a receipt cannot print a kitchen
ticket either.

**Cost on the kitchen screen's poll.** Every kitchen screen re-reads `GET /api/device/station` every
15 seconds, inside that route's `withTransaction` (`device-api.ts:205-209`), and `withTransaction`
is the venue file's one write lock (CLAUDE.md §3). So the two station routes pass their own
`stationId`, and the query reads one station's printers through the two indexes above. The
venue-wide form runs for the alert source and the dashboard route: the source is read whenever an
open dashboard asks for its alerts (every minute, and again after an incident changes).

**Screen query shape, in two steps** (measured by the plan's third check: as one query, the
waiting-dish test runs for every station first, and a station nobody bumps — a printer-only bar —
piles up `queued` dishes for ever, since only a bump moves a dish out of `queued`): first the dark
stations — `kitchen_stations` (this location, switched on OR off: a station switched off
mid-service can still have dishes waiting) joined to `devices` (active, `station_id` =
the station; a kitchen-screen device is the only kind bound to a station, by the
`device_binding_rule_*` triggers), grouped by station, kept when
`max(last_seen_at) is null or max(last_seen_at) < <threshold>`; then, for those stations only, keep
each that has a `ticket_items` row with `state in ('queued', 'preparing')` and
`fired_at >= <an hour ago>`. A new index `ticket_items_waiting_idx (station_id, state, fired_at)`
(core, in the same generated migration as the print-jobs index: one more `CREATE INDEX`) lets that
second step read only the last hour's dishes; check with `explain query plan` that it is used, as
a test, as for the printer query. Both thresholds are ISO strings
(`new Date(now.getTime() - SCREEN_DARK_MS).toISOString()`, and the same for `WAITING_WINDOW_MS`),
because `last_seen_at` and `fired_at` are text and compared as text.

**The alert** (`stationOutputAlertSource({ locationId, stationStates })`, area `"kitchen"`,
permission `"venue_service.manage"`, the area and permission venue-service's `route.` claim uses,
`packages/venue-service/src/alerts.ts:3`). `stationStates` is injected so the source's test can stub
it: `alert-sources.test.ts` migrates core only (`:401`) and cannot reach venue-service's seat. It
reads `stationPrintersDown(tx, locationId, now)`, `stationScreensDark(tx, locationId, now)` and
`stationStates(tx, now)`. A printer alert counts only at a station that is open now; a dark-screen
alert counts whether the station is open or not, because its condition is dishes already waiting
there, and closing a station moves only new work:
- a down printer at the default station: code `station.default_printer_down`, params
  `{ station, printer }`, key `station.printer_down:<stationId>:<printerId>`;
- a down printer at any other station: code `station.printer_down`, params `{ station, printer }`,
  the same key form;
- dark screens at the default station: code `station.default_screens_dark`, params `{ station }`;
  at any other: code `station.screens_dark`, params `{ station }`. Key
  `station.screens_dark:<stationId>` for both, `since` the row's `lastSeenAt` (or `now` when never
  seen).

Severity `"error"` for the printer codes and `"warning"` for screens; `since` the printer row's
`since`; screen `"prep-stations"`. A station that is closed or switched off raises no printer
alert: no new work reaches it, and its stuck tickets are still covered by `printer.jobs_waiting`
and the till's printing problems.

Wording (`alert-messages.ts`; its header forbids promising a later automatic check). Each says only
what is known (S2):
- `station.printer_down`, EN: "{station}'s printer {printer} has printed nothing since something
  sent to it got stuck, so {station}'s tickets may not be reaching it. Fix the printer, or close
  {station} on the Prep stations page to send its work elsewhere (the page shows where)." ES: "La
  impresora {printer} de {station} no ha impreso nada desde que se atascó algo que se le envió, así
  que puede que las comandas de {station} no le lleguen. Arregla la impresora o cierra {station} en
  la página de Estaciones de preparación para enviar su trabajo a otro sitio (la página indica
  adónde)."
- `station.default_printer_down`, EN: "{printer}, the printer of the default station {station}, has
  printed nothing since something sent to it got stuck. The default station cannot be closed: fix
  the printer, and until then read {station}'s tickets on its kitchen screen or on the till's
  station view." ES: "La impresora {printer} de la estación predeterminada {station} no ha impreso
  nada desde que se atascó algo que se le envió. La estación predeterminada no se puede cerrar:
  arregla la impresora y, mientras tanto, consulta las comandas de {station} en su pantalla de
  cocina o en la vista de estación del TPV." (Not "reprint from the till": the till's reprint,
  `reprintOrderTickets`, `apps/server/src/kitchen-print.ts:1092`, prints to the same station's
  printers, the down one included.)
- `station.screens_dark`, EN: "{station} has dishes waiting, and none of its kitchen screens has
  checked in for over three minutes. Check the screen; until then, read its tickets on the till's
  station view. Closing {station} on the Prep stations page sends new work elsewhere, but does not
  move the dishes already waiting." ES: "{station} tiene platos pendientes y ninguna de sus
  pantallas de cocina se ha conectado en más de tres minutos. Revisa la pantalla; mientras tanto,
  consulta sus comandas en la vista de estación del TPV. Cerrar {station} en la página de
  Estaciones de preparación envía el trabajo nuevo a otro sitio, pero no mueve los platos que ya
  esperan."
- `station.default_screens_dark`, EN: "{station}, the default station, has dishes waiting, and none
  of its kitchen screens has checked in for over three minutes. Check the screen; until then, read
  its tickets on the till's station view." ES: "{station}, la estación predeterminada, tiene platos
  pendientes y ninguna de sus pantallas de cocina se ha conectado en más de tres minutos. Revisa la
  pantalla; mientras tanto, consulta sus comandas en la vista de estación del TPV."

The source lives in `apps/server/src/alert-sources.ts`, which `scripts/ongoing-alert-codes.test.ts`
already scans. Writing the codes there as `code: "…"` literals is what lets the guard see them.

- [ ] **Step 1: Write the failing tests** (`station-outputs-down.test.ts`, on a real database; seed
  print jobs and devices directly, as `alert-sources.test.ts:580-592` seeds jobs):

```ts
it("does not count a delivered cash-drawer pulse as printing", async () => {
  await job({ printer: grillPrinter, status: "failed", attempts: 5, createdAt: "2026-10-02T18:00:00.000Z" });
  await job({ printer: grillPrinter, kind: "drawer", status: "done", createdAt: "2026-10-02T18:05:00.000Z", deliveredAt: "2026-10-02T18:05:01.000Z" });
  expect(await stationPrintersDown(tx, locationId, new Date("2026-10-02T18:06:00Z"))).toHaveLength(1);
});

it("counts a printer down from its stuck ticket until it prints again", async () => {
  await job({ printer: grillPrinter, status: "failed", attempts: 5, createdAt: "2026-10-02T18:00:00.000Z" });
  expect(await stationPrintersDown(tx, locationId, new Date("2026-10-02T18:03:00Z"))).toEqual([
    { stationId: grill, stationName: "Grill", printerId: grillPrinter, printerName: "Epson", since: "2026-10-02T18:00:00.000Z" },
  ]);
  await job({ printer: grillPrinter, status: "done", createdAt: "2026-10-02T18:05:00.000Z", deliveredAt: "2026-10-02T18:05:02.000Z" });
  expect(await stationPrintersDown(tx, locationId, new Date("2026-10-02T18:06:00Z"))).toEqual([]);
});

it("keeps counting a given-up ticket the next morning when nothing has printed since", async () => {
  await job({ printer: grillPrinter, status: "failed", attempts: 5, createdAt: "2026-10-02T18:00:00.000Z" });
  expect(await stationPrintersDown(tx, locationId, new Date("2026-10-03T04:00:00Z"))).toHaveLength(1);
});

it("reads one station only when asked", async () => { /* Grill and Bar printers both stuck; stationId: grill → only Grill's row */ });

it("does not count a ticket younger than two minutes, a drawer pulse, or a job an Unpair ended", async () => { /* each → [] */ });

it("lists one down printer even when the station has another printer that works", async () => { /* two printers on Grill, one stuck → one row */ });

it("leaves out switched-off printers and stations, and other venues' stations", async () => { /* → [] */ });

it("calls a station's screens dark only when none has checked in for three minutes", async () => {
  await screen({ station: grill, lastSeenAt: "2026-10-02T18:00:00.000Z" });
  await firedItem({ station: grill, state: "queued", firedAt: "2026-10-02T17:50:00.000Z" });
  expect(await stationScreensDark(tx, locationId, new Date("2026-10-02T18:02:00Z"))).toEqual([]);
  expect(await stationScreensDark(tx, locationId, new Date("2026-10-02T18:04:00Z"))).toEqual([
    { stationId: grill, stationName: "Grill", lastSeenAt: "2026-10-02T18:00:00.000Z" },
  ]);
  await screen({ station: grill, lastSeenAt: "2026-10-02T18:03:30.000Z" }); // a second, live screen
  expect(await stationScreensDark(tx, locationId, new Date("2026-10-02T18:04:00Z"))).toEqual([]);
});

it("treats a never-seen screen as dark, and a station with no screen as nothing", async () => { /* lastSeenAt null → listed with null; Bar with no device → absent; a revoked (inactive) device ignored */ });

it("lists a switched-off station whose screens are dark while its dishes wait", async () => { /* station switched off after the send → still listed */ });

it("stays quiet when nothing is waiting", async () => { /* dark screen; no fired item → []; an item fired 61 minutes ago → []; a waiting item marked ready → []; a held item (fired_at null) → [] */ });
```

  In `alert-sources.test.ts`, with `stationStates` stubbed: an open station → `station.printer_down`
  with the key, area, permission and screen above; the default → `station.default_printer_down`; a
  station closed now → no printer alert, but its dark screens with dishes waiting still raise
  `station.screens_dark`; dark screens at an open station → `station.screens_dark`; at the default
  → `station.default_screens_dark`. Device and till routes: the station response carries `printersDown` for
  its own station only. Management route: 200 with both lists, and 403 without `venue.configure`.

- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/station-outputs-down.test.ts src/alert-sources.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: the two indexes, the two functions, the routes, the source and its
  registration, and the wording.
- [ ] **Step 4: Run** the files above plus `src/device-api.test.ts`,
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`, and the db suite
  named in **Files**. Expected: PASS. (`scripts/alert-codes.test.ts` covers recorded incidents only,
  so it says nothing about these codes.)
- [ ] **Step 5: Commit**: "Kitchen alerts: an open station whose printer has stopped printing, or any station with dishes waiting whose screens have all gone quiet, is alerted (nothing is rerouted)".

---

### Task 6: Prep Stations — open or closed now, hours, fallback, and the printer and screen warnings

**Files:**
- Create: `packages/venue-service/src/dashboard/station-hours-form.ts` + `.test.ts`
- Modify: `packages/venue-service/src/dashboard/prep-stations-screen.ts`, its `.test.ts` and
  `.a11y.test.ts`, `routing-client.ts` + `.test.ts` (`setStationHours`, `setStationFallback`,
  `setStationToday`, `listOutputsDown` → `GET /management-api/stations/outputs-down`),
  `strings.ts` (every new line below, and the messages for `station.fallback_loop`,
  `venue.clock_unreadable` and `station.not_found`, in English and Spanish), `live-queries.ts` (the
  3a `routing` entry gains `station_hours`, `station_fallbacks`, `station_day_states`)

**What each station card gains (the tests pin each):**
- **A status line**, from `RoutingModel.stationTimes` and `todayEnds`:
  - "Open now";
  - "Open now, opened by hand until 06:00 tomorrow" (or "until 06:00 today" when
    `todayEnds.tomorrow` is false: a change made at 01:30 lapses at 06:00 the same morning);
  - "Closed now: outside its opening hours. Its work goes to Downstairs bar.";
  - "Closed now, closed by hand until 06:00 tomorrow. Its work goes to Downstairs bar.";
  - "Always open: this is the default station" (S6).

  The destination is `closedSendsTo`'s station name. When `closedSendsTo` is `null` (no default
  station is switched on), the sentence ends "Nothing can make its work: no default station is
  switched on." instead. With `clockReadable` false, every card says
  "Opening hours are not applied: the venue's time zone cannot be read."
- **Buttons**, by state, never on the default's card:
  - "Close for today", when the station is open;
  - "Open for today", when it is closed;
  - "Back to the schedule", when `today` is set.

  Close for today first shows a `wt-modal` confirmation: "Upstairs bar's work goes to Downstairs
  bar until 06:00 tomorrow." (S12, with today/tomorrow as above). A refusal
  (`venue.clock_unreadable`) shows at the bottom of that dialog's body.
- **"Opening hours"**: a summary ("Friday 19:00–21:00, Saturday 19:00–21:00", or "Always open") and
  an "Edit hours" button. A past-midnight interval reads "Friday 22:00–02:00 (next day)". The button
  opens `station-hours-form` in a `wt-modal`: one row per interval, each with a weekday `<select>`
  (`venue.day.N`), two `<input type="time">` and a remove button, plus "Add hours". When a row's
  closing time is earlier than its opening time, the row shows, as visible text after the closing
  field, "until 02:00 the next day" — not a placeholder, which Chromium does not show on a time
  field (measured by the plan's review with the workspace's Playwright Chromium). Equal times are
  refused beside both fields (`venue.time_distinct`, the department-hours string). Saving sends the
  whole list. A server refusal for `hours.N` goes beside row N.
- **"When closed, work goes to"**: a single-choice `wt-combobox`, following
  `docs/developers/design-system.md` → Forms (the single-choice combobox rule): its first option
  has an empty value and reads "Same as the default station (Kitchen)", and so does its
  placeholder; it saves `null`. The named options are the switched-on stations other than this one
  AND other than the default, so Kitchen appears once. When the stored fallback is not among them —
  it is the default (stored by name, through the route or an import), or a station since switched
  off — it is listed too, by name, marked "(switched off)" when it is, so the field never shows a
  value it does not list. Saving first shows a one-line confirmation (S12): "While Upstairs bar is
  closed, its work will go to Main bar." When Upstairs bar is closed or switched off at this
  moment, it adds where the work goes now: "That starts now." if Main bar is open, or, if Main bar
  is closed too, "Main bar is closed now as well, so for now it goes to <Main bar's
  `closedSendsTo`>." A refusal of `station.fallback_loop`
  or `route.station_inactive` goes beside the combobox.
- **Warnings**, from `listOutputsDown()`, polled as a `passive` read every 60 seconds (CLAUDE.md §3:
  automatic dashboard reads are passive). They sit in the card's status area, under the status line
  (whatever buttons the card shows), in the warning token colours. The "Switched off" list shows a
  dark-screen warning for a switched-off station the same way:
  - per down printer: "Printer Epson has printed nothing since something sent to it at 20:14 got
    stuck." (the time is when that print was sent);
  - dark screens: "Dishes are waiting, and no kitchen screen here has checked in since 20:10." (or
    "… has ever checked in." for a never-seen screen).
- **Switching a station off** (3a's action) now opens a `wt-modal`: "Switch off Cocktail bar? Its
  work will go to: [the same combobox, pre-filled with its fallback when that station is switched
  on, otherwise with "Same as the default station"]". Confirm calls `setStationFallback` FIRST,
  and only when the choice differs from the stored fallback, then core's
  `DELETE /management-api/stations/:id` (S15): if the second request fails, the station stays
  switched on with its new fallback, which it uses only while it is closed. The modal reports that
  failure at the bottom of its body. The default station's switch-off has no combobox.
- **The "Switched off" list** (3a) shows, for each station, "its work goes to Main bar" from
  `closedSendsTo`. Each has "Change where its work goes" (the same combobox, in a modal, with the
  same confirmation) and "Switch on" (core's `PATCH /management-api/stations/:id` with
  `{ active: true }`). 3a's flag wording "Switched off: its work goes to the next rule" BECOMES
  "Switched off: its work goes to its fallback" (S3).

- [ ] **Step 1: Write the failing tests**, mounting with a stub `PrepStationsApi` as 3a's screen
  tests do:
  - each of the five status lines, with "tomorrow" and with "today", and the destination;
  - the default card has no Close, hours or fallback controls;
  - Close for today shows the confirmation sentence, and Confirm calls `setStationToday(id, "closed")`;
  - Back to the schedule calls `setStationToday(id, null)`;
  - the hours form keeps a row per interval, refuses equal times beside both fields, and saves the
    whole list;
  - an overnight row is accepted, and its "until 02:00 the next day" text is rendered (assert the
    element's `textContent`, not an attribute);
  - the fallback combobox lists Kitchen once, as "Same as the default station (Kitchen)", which
    sends `null` — and, only when the stored fallback is Kitchen's id itself, a second time by name,
    because that stored value follows Kitchen even if the default later moves, and the field must
    show what is stored (the design system's rule against a second "none" entry is about entries
    that save the same thing; these two save different things);
  - a fallback change shows its confirmation, with "That starts now." only for a closed station,
    and the "closed now as well" sentence when the new fallback is closed too;
  - a stored fallback that has been switched off is listed, marked "(switched off)"; Switch off
    then pre-fills "Same as the default station" and, when left so, sends `null` before switching
    off;
  - `station.fallback_loop` shows beside the combobox;
  - the printer warning and the dark-screen warning show on their own station's card only;
  - a stored fallback that is the current default station (the default moved after it was saved)
    still shows by name, so the combobox never shows a value it does not list;
  - Switch off asks for the fallback, sends the fallback before the switch-off, and shows a failed
    switch-off at the bottom of the modal;
  - Switch on calls the PATCH.

  `station-hours-form.test.ts` covers the form alone.
- [ ] **Step 2: Run**
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen.test.ts src/dashboard/station-hours-form.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse `wt-card`, `wt-modal`, `wt-combobox`, `wt-button` from
  `@waitron/ui`. No hard-coded colour or size.
- [ ] **Step 4: Run** those tests, the a11y test covering each new state in both themes, the
  client test, and `pnpm exec vitest run scripts/live-subscriptions.test.ts`. Expected: PASS. Open
  the screen with the dev stack (`wa-wt demo <worktree>`) at desktop and phone width, in both
  themes, and look at a closed station, the default, the hours form with an overnight row, the
  fallback combobox, and both warnings.
- [ ] **Step 5: Commit**: "Prep stations screen: each station says whether it is open now and where its work goes, and can be closed for today, given hours and a fallback".

---

### Task 7: The station's kitchen screen says its printer is not printing

**Files:**
- Modify: `apps/till/src/api/client.ts` (the station response types gain `printersDown`),
  `apps/till/src/screens/till-station-screen.ts` (a warning line at the top of the queue), the till's
  string table (both languages)
- Test: `apps/till/src/screens/till-station-screen.test.ts` (and its a11y test, if it has one:
  `ls apps/till/src/screens/till-station-screen*`)

**Behaviour:** When the station's response lists any down printer, a line shows at the top, above
the queue, on both the kitchen screen (device mode, `GET /api/device/station`, re-read every 15
seconds, `till-station-screen.ts:34`) and the till's station view (`GET /api/stations/:id/queue`).
EN: "Printer Epson has printed nothing since something sent to it at 20:14 got stuck. Tickets are
still shown here; tell a manager." ES: "La impresora Epson no ha impreso nada desde que se atascó
algo que se le envió a las 20:14. Las comandas siguen apareciendo aquí; avisa a un encargado." The
time is the printer's `since` (when that print was sent), shown in the venue's local time the way the screen already shows ticket times. With two
down printers, there is one line per printer. The line goes away on the next read that no longer
lists the printer. It uses `role="status"`, not `alert`, because it is re-read every 15 seconds,
and it uses the warning token colours.

- [ ] **Step 1: Write the failing tests**: a response with one down printer shows the line with its
  name and time; two give two lines; an empty list shows none; after a re-read without it, the line is gone.
- [ ] **Step 2: Run**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts`. Expected:
  FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the screen test and its a11y test. Expected: PASS. Look at it in the dev
  stack, in both themes.
- [ ] **Step 5: Commit**: "Kitchen screen: a station whose printer has stopped printing says so above its tickets".

---

### Task 8: The tester answers for a time, and explains fallbacks

**Files:**
- Modify: `packages/venue-service/src/routing-store.ts` (`explainRoute` gains a moment),
  `routes.ts` (`GET …/routing/explain` gains `weekday` and `time`), `routing-client.ts`,
  `prep-stations-screen.ts` + tests, `strings.ts`

**Interfaces:**

```ts
export type ExplainWhen = { kind: "now"; at: Date } | { kind: "at"; moment: RoutingMoment };
export async function explainRoute(tx, cfg, productId: string, zoneId: string | null, when: ExplainWhen): Promise<RouteExplanation>;
// RouteExplanation (Task 2 already replaced `skipped` with `fallbacks`) GAINS
//   `clockReadable: boolean`. `stations` names every station in route, decidedBy and fallbacks.
```

`kind: "now"` loads today's by-hand changes. `kind: "at"` uses the schedule alone and loads none
(S16). The route takes either no `weekday`/`time` (now) or both (`weekday` 0–6, `time` `HH:MM`).
Exactly one of the two is refused `management.request_invalid { field: "when" }`.

**Screen:** the "Where is this made?" card gains **When**: "Now" (the default), or a weekday
`<select>` and a time input. The answer gains one line per fallback step, before "Made at":
- "Upstairs bar is closed outside its opening hours, so its work goes to Downstairs bar.";
- "… is closed by hand today, so …";
- "… is switched off, so …".

The last step names the station the work reached: the next step's station, or the route. When the
walk ended at the default, it reads "…, so the default station, Kitchen, takes it." When a rule
matched but the walk found no station (`route` null, `decidedBy` set: the chain ended at a
switched-off default), 3a's "Nothing can make this: no rule matched…" is wrong; say instead "Nothing
can make this: the rule above sends it to stations that are all closed or switched off, and no
default station is switched on." 3a's sentence stays for `decidedBy` null. With `clockReadable`
false: "The venue's time zone cannot be read, so opening hours are not applied."

- [ ] **Step 1: Write the failing tests.** Store: Friday 22:00 explains Upstairs bar → Downstairs bar
  with one `out_of_hours` step; the same weekday and time with `kind: "at"` ignores a by-hand open
  made today; an unreadable zone gives `clockReadable: false`. Route: the `when` refusal. Screen:
  the three step sentences, the default sentence, the "all closed or switched off" sentence, the
  unreadable-clock sentence, and that choosing a weekday and time sends both.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS):
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing-store.test.ts src/routes.test.ts`
  and the browser screen test.
- [ ] **Step 5: Commit**: "Prep stations tester: answers for now or for a weekday and time, and says which closed stations the work passed over".

---

### Task 9: The demo shows hours and a fallback, and the documents catch up

**Files:**
- Modify: `apps/server/scripts/demo-seed/seed-floor.ts`. Give Upstairs bar the design's example:
  open 19:00–21:00 on Friday and Saturday, with Downstairs bar as its fallback. Write them through
  the venue-service store functions, or with the same column values they write (`HH:MM:SS`).
  Its test (`apps/server/scripts/demo-seed/seed.test.ts`, or where 3a left it) asserts both. 3a
  Task 13's routing check on the seeded demo (`apps/server/src/demo-seed.test.ts`, or wherever 3a
  put it) now uses two fixed instants: Friday 20:00 Madrid (`2026-10-02T18:00:00Z`) sends an
  Upstairs-bar-zone drink to Upstairs bar, and Tuesday 20:00 (`2026-10-06T18:00:00Z`) sends it to
  Downstairs bar.
- Modify: `docs/backlog.md`:
  - the design entry (3a's Task 13 updated it): slice 3b built (PR number when it lands);
  - NEW entries:
    - "The dark-screen alert can be wrong" (S2b: a kitchen that works from paper and never marks
      dishes ready on its screen, with that screen switched off, is alerted for up to an hour after
      each send; a kitchen screen opened through the dev stack's device chooser never records a
      check-in, `apps/server/src/device-session.ts:176-186`, so a send to its station alerts);
    - "A held dish keeps a station that has since closed" (S10);
    - "Opening or closing a station from the till" (S11: a core till route calling a new
      `VENUE_SERVICE` seat method, a manager's PIN as the cash drawer route takes it,
      `till-api.ts:1468-1478`, and `authorize` widened as `authorizeManager` was,
      `packages/identity/src/manager-login.ts:118-122`);
  - A165 has no entry of its own: it is the "Left open, not checked" line inside A163's entry
    (`grep -n 'A165' docs/backlog.md`). Add a dated line there: 3b's station alert counts a stuck
    ticket only until the printer next prints, so it lifts once the printer prints again; A165's
    `printer.jobs_waiting` is unchanged. Do not mark A165 done.
- Modify: the design, `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md`:
  - a dated note at §5.7's "Printer or screen down" bullet: "_2026-10-01 (slice 3b, owner): a down
    printer reroutes nothing; it raises an alert on the dashboard, on Prep Stations and on the
    station's kitchen screen, and the manager closes the station by hand. A station with dishes
    sent in the last hour still waiting, whose kitchen screens have all stopped checking in for
    three minutes, is alerted on the dashboard and Prep Stations, whether or not it is open —
    closing it moves only new work._";
  - one at §5.6's "Warnings" bullet on switched-off stations: "_2026-10-01 (slice 3b, owner): a
    switched-off station follows its fallback, like a closed one._";
  - one at §5.3's last paragraph, pointing at the 3b plan.
- Modify: `docs/developers/conventions-data.md` and root `CLAUDE.md`, only where a sentence states
  the old behaviour. Run
  `grep -rn "switched-off station\|switched off station\|A143\|next rule\|next matching route" CLAUDE.md docs/developers apps/*/README.md packages/*/README.md`
  and fix each hit that S3 makes false (CLAUDE.md §1: a behaviour change retires every receipt
  about the old behaviour, wherever it lives).

- [ ] **Step 1:** the demo seed and its test (FAIL first), then run it.
- [ ] **Step 2:** the documents.
- [ ] **Step 3: Commit**: "Demo and documents: Upstairs bar opens on Friday and Saturday evenings and falls back to Downstairs bar; the design and backlog record 3b's decisions".

---

## Self-review notes

- Design §5.7: hours (Tasks 2, 3, 6), manual open and close (Tasks 3, 6), fallback (Tasks 2–4, 6),
  printer down (Tasks 5–7, owner's S1), screen down (Tasks 5, 6, S2b), "rules never mention time" (no rule table gains a time).
  §5.3's last paragraph: Tasks 2, 4. §5.12's tester time: Task 8. §7 item 1: S6, Tasks 2, 5, 6.
- 3a interfaces changed on purpose: `MakerChoice.skipped` → `fallbacks`; `RoutingRules.timing`;
  `chooseMaker`'s moment; `loadRoutingRules`'s business day; `routingModel`'s instant;
  `resolveMakers`'s instant; `explainRoute`'s `when`; `RouteExplanation.skipped` → `fallbacks`. Each
  task that changes one names the 3a tests that change with it.
- Codes: new `station.fallback_loop` and `venue.clock_unreadable` (thrown), and
  `station.printer_down`, `station.default_printer_down`, `station.screens_dark` and
  `station.default_screens_dark` (ongoing alerts). Kept:
  `route.station_inactive`, `station.no_default`, `route.dish_not_sent`, `station.not_found`.

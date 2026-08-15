# Workforce roster management — slice 2 design (2026-08-15)

**Sub-project 16 (Workforce), building on shift-planning authoring slice 1 (#83).** Slice 1 gave the
management dashboard a person × day grid to **author a draft roster, see advisory breach warnings,
and publish**. This slice surfaces the REMAINING roster-management engine — most of which
`@waitron/workforce` already ships headless — behind the same dashboard: **split-shift (jornada
partida) authoring, manager approve/reject of shift swaps, manager approve/reject of absences, and a
planned-vs-actual comparison view**. It is mostly "surface the existing engine + fill two small
gaps", not a from-scratch build.

> **File:line references to existing code in this spec come from the 2026-08-15 research pass.
> Re-confirm them at implementation time — they are the design's basis, not a frozen contract.**

---

## 1. Scope

**In slice 2 — the four features, one branch:**

1. **Split-shift authoring** — a PURE dashboard-UI change. The schema, backend verbs and grid render
   already permit multiple shifts per (person, day); only the cell-click interaction blocks a second
   one. No schema, migration, backend or route change.
2. **Swap approve/reject** — one genuinely-new package verb (`decideSwap`), one new error code, a
   list read model, two routes, and the approvals screen.
3. **Absence approve/reject** — the verb (`setAbsenceStatus`) already exists; extend it to record the
   decider, add a list read model, two routes, and the same approvals screen.
4. **Planned-vs-actual view** — one new backend read model that assembles the two inputs and calls
   the existing pure comparator, one route, one screen.

Plus one migration (nullable decider columns on two tables), two new `@waitron/identity` permissions,
and the dashboard wiring.

**Explicitly OUT OF SCOPE (the STAFF-FACING request path).** Nothing in any app yet CREATES a swap
or an absence: `requestSwap`/`acceptSwap` (`packages/workforce/src/shift-swaps.ts:40,75`) and
`createAbsence` (`packages/workforce/src/absences.ts:41`) are package-only, called from no route.
Slice 2 builds only the **manager approval half**; where and how a staff member requests a swap or
files an absence — and the auth surface for it (a staff session is not a management session) — is a
separate later slice. The approval flow here is still fully built and tested against seeded/fixture
data (the RLS/route suites INSERT `accepted` swaps and `requested` absences directly, exactly as the
slice-1 fixtures insert roster rows).

**Deferred (carried forward from the #83 deferred list, each its own later slice):**
template/availability **generators**; a real **per-venue timezone offset** (slice 1 and this slice
use offset 0 — `apps/dashboard/src/widgets/shift-dialog.ts:39`); and the **D3 payroll export**.

**Owner decisions (approved, not re-decided here):** the four features ship on one branch; the swap
decision verb is named `decideSwap` and transitions `accepted → approved | rejected` only; the two
new permissions are `swap.approve` and `absence.decide` (pre-agreed in
`packages/identity/src/permissions.ts:20`); the approvals surface is manager-only.

---

## 2. Context — what the engine already ships, and the two gaps

`@waitron/workforce` is headless and the barrel already exports everything below
(`packages/workforce/src/index.ts`). Reused UNCHANGED:

- **`comparePlannedVsActual(shifts: readonly PlannedShift[], sessions: readonly WorkSession[]):
  PlannedVsActual[]`** (`planned-vs-actual.ts:71`) — pure, DB-free; folds both streams by (person,
  local day) and emits one row per matched-or-unmatched day with `plannedMinutes`, `workedMinutes`,
  `lateMinutes`, `noShow`, `unplanned` (`planned-vs-actual.ts:20-35`).
- **`projectWorkSessions(entries: readonly TimeEntryRecord[]): WorkSession[]`** (`projection.ts:274`)
  — folds a flat `time_entries` stream into per-person `WorkSession`s; it **groups by person
  internally** (`projection.ts:279`), so a multi-person stream for a whole location projects in one
  call. `WorkSession` carries `workDate` (local day), `startedAt` (UTC instant) and `workedMinutes`
  (`projection.ts:70-88`) — exactly the three fields the comparator reads.
- **`PlannedShift`** (`roster-validation.ts:29-36`) — the neutral `{ shiftId, personId, startsAt,
  startsOffsetMinutes, endsAt, endsOffsetMinutes }` shape the comparator's planned side needs.
- **`Period = { start, end }`** (`projection.ts:141`) — a half-open local-date window (`start`
  inclusive, `end` exclusive), reused as the planned-vs-actual query window.
- **The `shift_swap_status` pgEnum already includes `approved`/`rejected`**
  (`schema/shift-swaps.ts:13-18`; migration `0007_scheduling_planning.sql:3`); today only `requested`
  (`requestSwap`) and `accepted` (`acceptSwap`, `shift-swaps.ts:91`) are ever written. Likewise
  **`absence_status` already includes `approved`/`rejected`** (`schema/absences.ts:31`; migration
  `0007:2`).
- **`setAbsenceStatus(tx, { tenantId, absenceId, status })`** (`absences.ts:69-83`) — an ungated
  plain status UPDATE that throws `absence.not_found` on a miss; extended (not replaced) below to
  record the decider.
- **`WorkforceBackend`** (`clocking.ts:213`) — already carries the roster read models this slice
  extends: `workSummary` (`clocking.ts:258`, the read-model-that-projects precedent), `getRoster`
  (`clocking.ts:444`), the private `entriesInPeriod` (`clocking.ts:960`, person-scoped
  `time_entries` read + ±1-day window widening) and the private `attachedShifts` (`clocking.ts:674`,
  `shifts` → `PlannedShift` mapping).

**The two gaps this slice fills in the engine:**

- **No swap `accepted → approved/rejected` transition exists.** `acceptSwap` writes `accepted` and
  stops; no verb decides it. → new `decideSwap`.
- **No DB assembly for the planned-vs-actual comparator exists.** `comparePlannedVsActual` is pure;
  nothing reads the two inputs from the database and calls it. → new `getPlannedVsActual` read model.

Everything else is surfacing (routes + UI) over verbs that already exist.

---

## 3. Components

### 3a. `@waitron/workforce` — the swap decision verb (new)

Added to `packages/workforce/src/shift-swaps.ts` (beside `requestSwap`/`acceptSwap`, as a free
function — matching that file's organisation), TDD'd:

```ts
export interface DecideSwapInput {
  tenantId: string;
  swapId: string;
  /** The manager's decision. Only these two — a decide never returns a swap to requested/accepted. */
  decision: "approved" | "rejected";
  /** The manager who decided, recorded on the swap; null when the caller does not attribute it
   *  (mirrors roster_versions.published_by_person_id — recorded when supplied, never required). */
  decidedByPersonId: string | null;
}
export async function decideSwap(tx: Transaction, input: DecideSwapInput): Promise<void>;
```

Logic, in order: read the swap's `status` under the tenant (`shift.not_found`-style single-row
select); throw **`swap.not_found`** if absent (never created, or hidden by RLS); throw the new
**`swap.not_decidable`** if its status is not `accepted` (a `requested` swap has not been accepted
yet; an `approved`/`rejected` one is terminal); otherwise UPDATE `status = decision`,
`decided_by_person_id = decidedByPersonId`, `decided_at = now()`.

**New error code — `swap.not_decidable`.** Grepped against the two swap siblings
(`errors.ts:120` `swap.not_found`, `errors.ts:126` `swap.not_permitted`): both are `swap.not_<x>`,
so `swap.not_decidable` matches the shape exactly. Its params mirror the "exists but wrong state"
codes (`roster.already_published` = `{ tenantId, rosterVersionId }`, `errors.ts:72`):
`swap.not_decidable: { tenantId: string; swapId: string }`. `swap.not_found` is **reused**, not
re-declared (`errors.ts:120`). Both are declared in `errors.ts`'s `declare module "@waitron/shared"`
block, and `shift-swaps.ts` already side-effect-imports `./errors.js` (`shift-swaps.ts:6`).

**New list read model** (same file, for the approvals screen's queue):

```ts
export interface PendingSwapRow {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: ShiftSwapStatus; // always "accepted" for this query, typed to the enum
  createdAt: string;        // UTC ISO instant (to_char-normalised, the getRoster pattern)
}
export async function listPendingSwaps(
  tx: Transaction,
  input: { tenantId: string },
): Promise<PendingSwapRow[]>;
```

Selects `shift_swaps` rows with `status = 'accepted'` under the tenant, ordered by `created_at`.
**Tenant-scoped, not location-scoped:** `shift_swaps` carries no `location_id`
(`schema/shift-swaps.ts:36-53`) — the location lives on the referenced shifts — so the queue is the
whole tenant's accepted swaps. Barrel: add `decideSwap`, `listPendingSwaps`, `DecideSwapInput`,
`PendingSwapRow` to `index.ts`.

### 3b. `@waitron/workforce` — absence decider (extend the existing verb) + list read model

`setAbsenceStatus` (`absences.ts:69-83`) already exists as an ungated plain UPDATE. **Extend, do not
replace**, its input and SQL to record the decider:

```ts
export interface SetAbsenceStatusInput {
  tenantId: string;
  absenceId: string;
  status: AbsenceStatus;
  /** The manager who decided, recorded on the absence; null when unattributed. NEW field. */
  decidedByPersonId: string | null;
}
```

The UPDATE gains `decided_by_person_id = ${input.decidedByPersonId}, decided_at = now()` alongside
the existing `status = ${input.status}`; the `absence.not_found` guard is unchanged
(`absences.ts:77-82`). Its existing tests (`absences.test.ts`) update to pass the new field. New list
read model (same file):

```ts
export interface PendingAbsenceRow {
  id: string;
  personId: string;
  kind: AbsenceKind;
  startsOn: string; // YYYY-MM-DD (::text cast, the getRoster date pattern)
  endsOn: string;
  status: AbsenceStatus; // always "requested" for this query
  note: string | null;
  createdAt: string;
}
export async function listPendingAbsences(
  tx: Transaction,
  input: { tenantId: string },
): Promise<PendingAbsenceRow[]>;
```

Selects `absences` rows with `status = 'requested'` under the tenant, ordered by `created_at`.
Barrel: add `listPendingAbsences` and `PendingAbsenceRow` to `index.ts`.

### 3c. `@waitron/workforce` — the planned-vs-actual read model (new)

Added to `WorkforceBackend` (`clocking.ts`), beside `workSummary` (`clocking.ts:258`), which is the
existing "read `time_entries` → `projectWorkSessions` → derive" precedent:

```ts
async getPlannedVsActual(
  tx: Transaction,
  query: { tenantId: string; locationId: string; period: Period },
): Promise<PlannedVsActual[]>;
```

`period` is the half-open local-date window `[period.start, period.end)` (the exported `Period`
shape). Steps:

1. **Planned side** — a new private `plannedShiftsInPeriod(tx, tenantId, locationId, period)`,
   mirroring `attachedShifts` (`clocking.ts:674-702`) but keyed on `location_id` + a local-date window
   AND the currently-PUBLISHED roster version instead of a single `roster_version_id`. Selects
   `shifts` for the tenant + location, INNER-JOINed to `roster_versions` on
   `shifts.roster_version_id` and filtered to `roster_versions.status = 'published'`, whose LOCAL date
   (`starts_at` shifted by `starts_offset_minutes`, read back as a date — offset 0 in this slice, so
   local = UTC, but the expression is offset-aware to match the codebase) falls in
   `[period.start, period.end)`; maps each to a `PlannedShift`. **The published-version filter is the
   point of "planned":** planned-vs-actual compares worked time against what staff were actually
   rostered, so a manager's in-progress DRAFT (never shown to staff) and a SUPERSEDED old version must
   not produce phantom no-shows. Grounded in the real schema — `shifts.roster_version_id` is
   `uuid` NULL while a shift is an unpublished draft and is set on publish
   (`schema/shifts.ts:30-32,49-50`; the `shifts_roster_version_fk` SET-NULLs it, `:75-79`), so the
   INNER JOIN alone drops drafts; `roster_versions.status` is the `roster_version_status` enum
   `draft`/`published`/`superseded` (`schema/roster-versions.ts:32-36`), so `status = 'published'`
   additionally drops superseded versions. The slice-1 partial unique index
   `roster_versions_published_period_uq` on `(tenant_id, location_id, period_start, period_end)
   WHERE status = 'published'` (`schema/roster-versions.ts:108-110`) guarantees at most one published
   version per (tenant, location, exact period), so the join yields a single coherent plan.
2. **Actual side** — a new private `entriesForLocationInPeriod(tx, tenantId, locationId, period)`,
   mirroring `entriesInPeriod` (`clocking.ts:960-998`) but filtering on `location_id` (**all
   persons**, not one — `entriesInPeriod` filters `eq(personId)` at `clocking.ts:992`, which is why
   this is a new helper, not a reuse) and applying the same ±1-day UTC window widening so a session
   whose local day is inside is not missed. Feed the rows to `projectWorkSessions`.
3. Keep only projected sessions whose `workDate` falls in `[period.start, period.end)` (the widened
   fetch can return a session one day outside), then call
   `comparePlannedVsActual(plannedShifts, sessions)` and return its rows.

Both inputs are scoped to the SAME location, so the per-(person, day) comparison is a single
location's planned-vs-worked picture. No new error code (a read over zero rows is an empty array, not
an error). Uses only already-exported symbols (`Period`, `PlannedShift`, `WorkSession`,
`comparePlannedVsActual`, `projectWorkSessions`), so no barrel change beyond the method itself being
on the already-exported `WorkforceBackend`.

### 3d. `@waitron/identity` — two new permissions

Append `"swap.approve"` and `"absence.decide"` to `PERMISSIONS`
(`packages/identity/src/permissions.ts:7-22`) and add BOTH to the `MANAGER` set
(`permissions.ts:35-40`); `ALL`/`admin` picks them up automatically (`permissions.ts:41`). The
names are pre-agreed in this file's own comment (`permissions.ts:20`: "Later slices add swap.approve
/ absence.decide beside it") and in the #83 spec. Code-only, no migration.

**Permission-matrix test** (`permissions.test.ts`): add one `it(...)` mirroring the `schedule.manage`
block (`permissions.test.ts:35-43`) — `swap.approve` and `absence.decide` are `true` for
manager/admin and `false` for staff/supervisor. **Note the existing guardrail:** the manager loop at
`permissions.test.ts:21` (`for (const p of PERMISSIONS) expect(roleHasPermission("manager", p))`)
already asserts manager holds EVERY catalog entry, so if the two codes were added to `PERMISSIONS`
but forgotten in `MANAGER`, that loop turns red — the reason both must land in `MANAGER` too.

### 3e. `apps/server` — new routes on `mountWorkforceApi`

Extend `apps/server/src/workforce-api.ts` (do NOT add a new mount; `boot.ts:340` already mounts this
group). Two structural changes plus five routes:

- **Two new permission constants**, beside `SCHEDULE_PERMISSION` (`workforce-api.ts:27`):
  `const SWAP_APPROVE_PERMISSION: Permission = "swap.approve";` and
  `const ABSENCE_DECIDE_PERMISSION: Permission = "absence.decide";`.
- **Generalise the `gated` helper** (`workforce-api.ts:110-118`) to take the permission as a
  parameter — `gated(sessionId, permission, fn)` — and update the ~6 existing call sites in this
  file to pass `SCHEDULE_PERMISSION`. Today `gated` hard-codes `SCHEDULE_PERMISSION`
  (`workforce-api.ts:115`), so the new routes on the other two permissions cannot reuse it as-is;
  the change is contained to this one file and the RLS suite already exercises the existing routes
  (so a regression turns red).
- **New STATUS entries** (`workforce-api.ts:35-50`): `"swap.not_found": 404`,
  `"swap.not_decidable": 409`, `"absence.not_found": 404`. (`swap.not_permitted`/`absence.overlaps`
  belong to the out-of-scope staff-request path and are not thrown by any route added here, so they
  are not mapped now.)

| Route | Gate | Body / query | Returns |
| --- | --- | --- | --- |
| `GET /management-api/swaps` | `swap.approve` | — | `PendingSwapRow[]` (via `listPendingSwaps`) |
| `POST /management-api/swaps/:swapId/decide` | `swap.approve` | `{ decision }` | `204` (via `decideSwap`) |
| `GET /management-api/absences` | `absence.decide` | — | `PendingAbsenceRow[]` (via `listPendingAbsences`) |
| `POST /management-api/absences/:absenceId/decide` | `absence.decide` | `{ decision }` | `204` (via `setAbsenceStatus`) |
| `GET /management-api/planned-vs-actual?locationId=&from=&to=` | `schedule.manage` | — | `PlannedVsActual[]` (via `getPlannedVsActual`) |

Route details, all following the existing helpers in this file:

- The **two `GET` list** routes use the generalised `gated(sessionId, <permission>, fn)`.
- The **two `decide`** routes **compose inline** (not via `gated`), exactly as the publish route
  does (`workforce-api.ts:228-251`), because they need `authorizeManager`'s returned `authorizedBy`
  (`packages/identity/src/manager-login.ts:46,51`) for `decidedByPersonId`. Each: validate the
  `:swapId`/`:absenceId` with `requireUuidParam` (`workforce-api.ts:55-58`); read+validate a body
  `decision` with a new tiny screen `requireDecision(v)` that accepts only `"approved"`/`"rejected"`
  (else `management.request_invalid` naming `decision`, the `requireNullableString` pattern at
  `workforce-api.ts:103-107`); then `withTenant → asAppUser → authorizeManager(permission) →
  decideSwap/setAbsenceStatus({ …, decidedByPersonId: authorizedBy })`.
- The **planned-vs-actual** route validates `locationId` with `requireUuidParam`, and `from`/`to`
  each with the existing `requirePeriod` (`workforce-api.ts:65-74`, which rejects impossible days),
  assembles `period = { start: from, end: to }`, and calls `getPlannedVsActual` through
  `gated(sessionId, SCHEDULE_PERMISSION, fn)`.

The absence decide route calls `setAbsenceStatus` with `status: decision` — the verb accepts
`AbsenceStatus`, and `"approved"`/`"rejected"` are two of its three values (`schema/absences.ts:37`).

### 3f. `apps/dashboard` — split-shift authoring (pure UI)

The only blocker is the cell-click resolution in `RosterScreen.openCell`
(`apps/dashboard/src/screens/roster-screen.ts:255-265`): it resolves the cell's shift via
`this.snapshot.shifts.find(...)` (**first match only**, `roster-screen.ts:261`), so a populated cell
always re-opens THAT one shift in edit mode — the SLICE-1 LIMITATION documented in the method's own
comment (`roster-screen.ts:249-253`). Everything else already supports multiple shifts per cell:
`#renderCell` already `.filter`s and `.map`s every shift in the cell to its own span
(`roster-screen.ts:456-462`); `addShift` is a plain insert with no per-(person, day) uniqueness
(`clocking.ts:518-535`; schema `shifts` has no such constraint, `schema/shifts.ts:34-89`); and the
dialog already authors an add when `.shift` is null and an edit/remove when it is set
(`shift-dialog.ts:82-127`).

**Fix (no schema/backend/route change):** rework the cell so a populated cell can author an
ADDITIONAL shift as well as edit/remove existing ones. Change `openCell` to take the target shift
explicitly — `openCell(personId, day, shift: Shift | null)` — dropping the `.find`. In `#renderCell`,
render each existing shift as its own edit button (`openCell(personId, day, shift)`, its visible time
as its accessible name — the current per-span a11y intent, `roster-screen.ts:453`) and add an
always-present "add another shift" affordance in the cell (`openCell(personId, day, null)`, carrying
the `roster.new_shift` aria-label, `roster-screen.ts:470`). Update the SLICE-1 LIMITATION comment to
record that split shifts are now authorable. The exact cell layout (a "+" button vs. an empty-slot
row) is a **visual** question for the companion when built; this spec fixes the interaction model
(each shift individually editable; the cell always addable), not the pixels.

### 3g. `apps/dashboard` — approvals screen (new)

A new `<dashboard-approvals-screen>` (`apps/dashboard/src/screens/approvals-screen.ts`), mirroring
the `staff`/`roster` screen pattern (injected `DashboardApi`, `@waitron/ui` primitives on `--wt-*`
tokens, `codeMessage()` error banner, single-flight guards, per-screen axe test in both themes).
Lists the two pending queues side by side — accepted swaps and requested absences — each row with
**Approve** and **Reject** `wt-button`s. Person ids render as names via `listStaff`
(`client.ts:328`, already on the client). A pending-swap row carries shift IDs, not times
(`PendingSwapRow`, §3a), so slice 2 shows the from/to shift references as-is; a human-readable shift
label (its time/role, which would need `listPendingSwaps` to join to `shifts`) is a deferred visual
refinement, not built here. On a decide, single-flight → call the API → reload the queue.

Shell wiring (`dashboard-app.ts`): add `"approvals"` to the `Screen` union
(`dashboard-app.ts:22`), a nav `wt-button` (`dashboard-app.ts:177-183` pattern), a `#renderScreen`
case (`dashboard-app.ts:206-207` pattern), and a side-effect import (`dashboard-app.ts:13` pattern).

`DashboardApi` (`client.ts`) — four thin methods with **browser-local** row types (the
bundle-isolation rule — no `@waitron/*` runtime import; the same way `Shift`/`RosterSnapshot` are
re-declared at `client.ts:214-286`):

```ts
listPendingSwaps(): Promise<PendingSwap[]>;                       // GET /management-api/swaps
decideSwap(swapId: string, decision: "approved" | "rejected"): Promise<void>;   // POST …/swaps/:id/decide
listPendingAbsences(): Promise<PendingAbsence[]>;                 // GET /management-api/absences
decideAbsence(absenceId: string, decision: "approved" | "rejected"): Promise<void>; // POST …/absences/:id/decide
```

### 3h. `apps/dashboard` — planned-vs-actual screen (new)

A new `<dashboard-planned-actual-screen>`
(`apps/dashboard/src/screens/planned-actual-screen.ts`), same screen conventions. A **location
picker** (reusing `GET /management-api/locations`, already on the client as `listLocations`,
`client.ts:493`) and a **week picker** (reuse the roster screen's week helpers), whose from/to bound
`[Monday, Monday+7)`; on change it calls `getPlannedVsActual(locationId, from, to)` and renders the
returned rows as a table — person (name via `listStaff`), local day, planned vs worked minutes, late
minutes, and no-show / unplanned flags. Shell wiring as in §3g (a `"planned-actual"` Screen member,
nav button, render case, import). `DashboardApi` method with a browser-local row type:

```ts
getPlannedVsActual(locationId: string, from: string, to: string): Promise<PlannedVsActualRow[]>;
// GET /management-api/planned-vs-actual?locationId=&from=&to=
```

i18n (all three files under `apps/dashboard/src/i18n/`): `nav.approvals`, `nav.planned_actual`, and
`approvals.*` / `planned.*` UI keys in `strings.ts`; the new `swap.*` / `absence.*` codes in
`codes.ts`; and the absence-kind + swap/absence status tokens in `domain.ts`, each with the
raw-value fallback so an unmapped token never renders raw (the slice-1 `domain.ts` convention).

---

## 4. Data flow

```
approvals screen
  → GET /management-api/swaps         (gated: withTenant + asAppUser + swap.approve)      → listPendingSwaps    → PendingSwapRow[]
  → GET /management-api/absences      (gated: … + absence.decide)                          → listPendingAbsences → PendingAbsenceRow[]
  → POST /management-api/swaps/:id/decide     (inline compose → authorizedBy)  → decideSwap({decision, decidedByPersonId})
  → POST /management-api/absences/:id/decide  (inline compose → authorizedBy)  → setAbsenceStatus({status, decidedByPersonId})
        → shift_swaps / absences  (app_user, FORCE RLS, existing table-level UPDATE grant, +decided_by/decided_at columns)

planned-vs-actual screen
  → GET /management-api/planned-vs-actual?locationId=&from=&to=   (gated: … + schedule.manage)
        → getPlannedVsActual(period)
             → plannedShiftsInPeriod (published shifts, local-date window)  ─┐
             → entriesForLocationInPeriod (time_entries) → projectWorkSessions ─┤→ comparePlannedVsActual → PlannedVsActual[]

roster screen (split shifts)  →  openCell(person, day, shift|null)  →  existing add / edit / remove routes (unchanged)
```

Every write and read runs in one `withTenant` tx per request as `app_user` under FORCE RLS, exactly
like the slice-1 roster routes.

---

## 5. Migration — decider columns (workforce journal 0010)

The workforce package owns its own drizzle journal (`packages/workforce/drizzle/`), separate from
`packages/db/drizzle`. The journal ends at `idx 9` / tag `0009_roster_published_period_uq`
(`packages/workforce/drizzle/meta/_journal.json`), so **the next free number is `0010`**.

**Schema change (both `schema/shift-swaps.ts` and `schema/absences.ts`):** add two nullable columns
mirroring `roster_versions.published_by_person_id` (`schema/roster-versions.ts:71,92-96`):

- `decidedByPersonId: uuid("decided_by_person_id")` — nullable, with a
  `foreignKey({ columns: [t.decidedByPersonId], foreignColumns: [persons.id], name:
  "<table>_decided_by_person_fk" }).onDelete("restrict")` (the array-`foreignKey` form + `restrict`,
  matching `roster_versions_published_by_person_fk`, `schema/roster-versions.ts:92-96`).
- `decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" })` — nullable.

Then `drizzle-kit generate` produces `0010` as an ordinary ALTER-TABLE ADD COLUMN + ADD CONSTRAINT
migration. **This is NOT a `--custom` migration** — no policy, FORCE, or grant statement is needed,
for two grounded reasons:

- **FORCE RLS + the tenant-isolation policy already cover the added columns.** Both tables carry
  `FORCE ROW LEVEL SECURITY` and a `FOR ALL … USING/WITH CHECK (tenant_id = current_tenant_id())`
  policy from `0008_scheduling_planning_rls.sql:21-41`. A row-level `FOR ALL` policy is
  column-agnostic — it filters rows, not columns — so a new column inherits the isolation with no
  policy change.
- **No new GRANT is required.** `0008_scheduling_planning_rls.sql:45-52` grants
  `SELECT, INSERT, UPDATE, DELETE` on `absences` and on `shift_swaps` to `app_user` at the **table
  level, with no column list**. A table-level privilege granted without a column list covers columns
  added later, so the existing UPDATE grant reaches `decided_by_person_id`/`decided_at`. This is
  proven, not asserted, by the decide-verb real-Postgres tests (§7): they UPDATE the new column as
  the non-superuser `app_user` under FORCE RLS — a table-level grant that did NOT cover the new
  column would raise `42501 permission denied for column decided_by_person_id` and turn the test red.
  The `persons`-FK write under FORCE RLS is likewise already proven in the tree: `publishRoster`
  stamps `roster_versions.published_by_person_id` (a `persons`-FK column) as `app_user`
  (`clocking.ts:599-601`; route passes `authorizedBy`, `workforce-api.ts:248`) with the same
  `restrict` FK and no extra grant.

**Parallel-safety of the migration number:** this branch is the only one touching
`packages/workforce/drizzle/meta/_journal.json`. The sync-transport slice's only migration is in
`packages/db/drizzle` (`2026-08-15-sync-transport-slice1-design.md §8`) and slice-1 roster authoring
added no migration at all (`2026-08-15-shift-planning-authoring-slice1-design.md §8`), so `0010` here
cannot collide.

---

## 6. Error handling

- `decideSwap` throws `swap.not_found` (404) or `swap.not_decidable` (409); `setAbsenceStatus`
  throws `absence.not_found` (404). All map through the shared `createErrorBoundary` STATUS table
  (`workforce-api.ts:52`), extended in §3e.
- A non-`"approved"`/`"rejected"` `decision` body → `management.request_invalid` (400) via
  `requireDecision`, never an enum 500.
- A malformed `:swapId`/`:absenceId`/`locationId` → `shared.invalid_id` (400) via `requireUuidParam`
  (`workforce-api.ts:55-58`); a malformed `from`/`to` → `management.request_invalid` (400) via
  `requirePeriod` (`workforce-api.ts:65-74`).
- A missing/expired management session or a role lacking the route's permission →
  `management_session.required`/`authorization.not_permitted` (401/403), from the existing
  session/authorize layer (`workforce-api.ts:36-39`).
- `getPlannedVsActual` over a window with no shifts and no sessions returns `[]`, not an error.
- No error param carries row content beyond ids (the workforce codes' existing convention,
  `errors.ts`).

---

## 7. Testing

Per CLAUDE.md §4, real Postgres is required for anything about privileges, RLS as the non-superuser
`app_user`, or the permission gates; PGlite (superuser, single-backend) is a false pass for those and
is used only for pure logic.

- **`decideSwap` — PGlite** for the state-machine logic (accepted → approved/rejected; the
  `swap.not_found` and `swap.not_decidable` paths from a `requested`/`approved`/absent swap), each
  guard **proven by deletion** (remove the check, watch the test fail, restore). Confirm the
  `decided_by_person_id`/`decided_at` columns are written.
- **`setAbsenceStatus` decider extension — PGlite** for the added-column write and the unchanged
  `absence.not_found` path; update the existing `absences.test.ts` call sites for the new field.
- **`listPendingSwaps` / `listPendingAbsences` — PGlite** for the status filter and ordering.
- **`getPlannedVsActual` — PGlite** for the assembly: seed `shifts` + `time_entries` and assert the
  matched/no-show/unplanned/late rows come back, plus the window boundary (a session one day outside
  `[from, to)` is excluded, an in-window one included) and the location scoping (another location's
  shifts/entries do not leak in). The comparator itself is already covered
  (`planned-vs-actual.test.ts`); these tests cover the DB assembly and windowing only.
- **`apps/server` route + RLS + gate — real Postgres**, extending `workforce-api.rls.test.ts` (whose
  header, `workforce-api.rls.test.ts:13-19`, already states the differential contract). Prove, as
  `app_user` under FORCE RLS:
  - **tenant isolation** — one tenant's manager cannot list or decide another tenant's swaps/absences
    (differential: fails if `asAppUser` is dropped from `workforce-api.ts`);
  - **the gates** — a role without `swap.approve` gets 403 from the swap routes, a role without
    `absence.decide` gets 403 from the absence routes, and a role without `schedule.manage` gets 403
    from planned-vs-actual — each **proven by deletion** of the `authorizeManager` call for that
    route;
  - **the decider column write as `app_user`** — a decide lands `decided_by_person_id` = the manager
    and `decided_at` non-null, which is simultaneously the §5 receipt that the table-level UPDATE
    grant covers the new column (a `42501` would turn it red).
  In-process route mechanics (happy-path 204/JSON shapes, the `requireDecision` 400) can stay on
  PGlite in `workforce-api.test.ts`, mirroring the slice-1 split.
- **`@waitron/identity`** — extend `permissions.test.ts` (§3d); pure, no DB.
- **`apps/dashboard`** — browser tests: the split-shift cell (a populated cell can open BOTH an edit
  of an existing shift AND an add of a second one — the regression the `.find` fix targets); the
  approvals queue render + approve/reject flow; the planned-vs-actual table render; and a per-screen
  axe test in both themes for each new screen (the slice-1 convention).

**Coverage thresholds:** `packages/workforce`, `packages/identity` and `apps/server` are node
packages at **98 / 98 / 98 / 95** (statements/lines/functions/branches). `apps/dashboard` carries
**95 / 95 / 90 / 88** (`apps/dashboard/vitest.config.ts:64-68`). Run each changed package's
`test:coverage` (not plain `test`) — CI's shards and the pre-push hook both gate on coverage
(CLAUDE.md §2).

---

## 8. Parallel-safety

- **Migration journals do not collide** — this slice's only migration is workforce `0010` (§5); no
  other in-flight slice touches `packages/workforce/drizzle`.
- **The identity permission array is code, not a migration** — appending two entries to `PERMISSIONS`
  cannot collide with a DB change.
- **The dashboard shell edits are additive** — two new `Screen` members, nav buttons, render cases
  and imports, plus new files; they extend the same `dashboard-app.ts` slice-1 already extended for
  `roster`, so a later dashboard slice merges cleanly as long as it appends rather than renumbers.

---

## 9. Resolved questions

- **Q: A new verb for absence decide, like `decideSwap`?** No — `setAbsenceStatus` already exists and
  already transitions to `approved`/`rejected` (`absences.ts:69-83`); this slice only adds the
  decider columns to it. A parallel `decideAbsence` would duplicate it. (The dashboard client method
  is named `decideAbsence` for symmetry with `decideSwap`, but it calls the same route → same verb.)
- **Q: `swap.not_decidable` vs. reusing an existing code?** New code — no existing swap code covers
  "exists but not in `accepted`" (`swap.not_found` = absent, `swap.not_permitted` = wrong actor,
  `errors.ts:120,126`). It follows the `swap.not_<x>` sibling shape and is never renamed once shipped
  (CLAUDE.md §3).
- **Q: Is the planned-vs-actual window a week or arbitrary?** Arbitrary half-open `[from, to)` local
  window (the exported `Period` shape), so the route reuses `requirePeriod` per bound and the UI
  passes a week; more general than hard-coding a week and it matches `entriesInPeriod`'s existing
  window semantics.
- **Q: Are swaps location-scoped?** No — `shift_swaps` has no `location_id`
  (`schema/shift-swaps.ts:36-53`), so the pending-swap queue is tenant-scoped; planned-vs-actual and
  the roster are location-scoped because `shifts`/`time_entries` carry `location_id`.
- **Q: Does planned-vs-actual count DRAFT shifts?** No — the planned side counts only shifts on the
  currently-PUBLISHED roster version (§3c step 1: INNER JOIN `roster_versions` +
  `status = 'published'`). A manager's in-progress draft is never shown to staff and a superseded
  version is a retired plan, so counting either would manufacture phantom no-shows against a plan
  nobody was rostered on. OWNER DECISION (2026-08-15). The `roster_versions_published_period_uq`
  partial unique index keeps at most one published version per (tenant, location, period), so "the
  published plan" is unambiguous.
- **Q: Does adding decider columns need a `--custom` RLS/grant migration?** No — §5: FORCE RLS +
  the row-level policy are column-agnostic and the table-level UPDATE grant covers added columns,
  both confirmed by the real-PG decide tests writing the column as `app_user`.

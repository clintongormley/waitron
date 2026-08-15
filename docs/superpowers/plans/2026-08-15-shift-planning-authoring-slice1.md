# Shift-planning authoring — slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the headless scheduling engine (#50) a management-dashboard surface so a manager can author a draft weekly roster on a person × day grid, see the advisory breach warnings, and publish it.

**Architecture:** Five new draft-authoring verbs on the existing `WorkforceBackend` (`packages/workforce`, PGlite-tested) → a new `schedule.manage` permission (`@waitron/identity`) → a new `mountWorkforceApi` `/management-api` route group on `apps/server` (gated `withTenant` + `asAppUser` + `authorizeManager`, real-Postgres RLS/gate suite) → new `DashboardApi` methods and a `<dashboard-roster-screen>` + `<dashboard-shift-dialog>` in `apps/dashboard` (Lit + `@waitron/ui`, axe in both themes). No schema change and no migration: `app_user` already holds `SELECT, INSERT, UPDATE, DELETE` on `roster_versions`/`shifts` (`packages/workforce/drizzle/0006_scheduling_rls.sql:36-39`) and `SELECT` on `locations` (`packages/db/drizzle/0001_tenancy_rls.sql:104`).

**Tech Stack:** TypeScript (pnpm workspace), Drizzle `sql` templates over PGlite + real Postgres (Testcontainers), Hono routes, Lit 3 + `@waitron/ui` primitives, Vitest (Node + Playwright browser), axe-core.

**Spec:** `docs/superpowers/specs/2026-08-15-shift-planning-authoring-slice1-design.md`

## Global Constraints

- **TDD, always.** Failing test FIRST, run it, watch it fail for the right reason, minimal implementation, watch it pass, commit. Every guard is **proven by deletion** (remove the guard → the test goes red → restore it).
- **Error codes name the DOMAIN concept, never the package** (`packages/shared/src/errors.ts`). Codes are **never renamed once shipped**. Every file that `throw new AppError(...)` imports its registry directly (`import "./errors.js"`). Grep the sibling codes before finalising a new one.
- **No new schema, no migration, no grant widening.** The grants already exist (see Architecture). If a task appears to need one, STOP and flag it — it changes the parallel-safety story with the sync-transport slice (spec §8).
- **No Spanish tokens introduced into schema** (there is no schema change here). Engine identifiers stay English (`packages/workforce` is a generic package the english-only guard scans; `roster`/`shift`/`draft`/`published` are already English in the tree). Dashboard user-facing Spanish copy is translation, not schema vocabulary (`apps/*` is exempt).
- **Coverage thresholds:** `@waitron/workforce` / `@waitron/identity` / `@waitron/server` are `98/98/98/95`; `@waitron/dashboard` is `95/95/90/88` (`apps/dashboard/vitest.config.ts:64-69`). CI shards run `test:coverage`, not `test` — run `pnpm --filter <pkg> test:coverage` before claiming green.
- **Real-Postgres suites require `TESTCONTAINERS_RYUK_DISABLED=true` locally** (`.husky`/CLAUDE.md §4) or they hang to the 180s hook timeout.
- **Every commit is `git commit -s`.** Feature work happens in a worktree, not the main checkout (do NOT create one as part of this plan — the executor does that once, up front).

---

## Resolved open questions (read before starting)

1. **Period representation — FROM/TO dates, both inclusive, NOT a single column.** `roster_versions` stores two `date` columns: `period_start` and `period_end`, inclusive on both ends (`packages/workforce/src/schema/roster-versions.ts:62-64`, check `period_end >= period_start` at :111, and `publishRoster` attaches shifts with SQL `between rv.period_start and rv.period_end` at `clocking.ts:398` — inclusive). Slice 1 authors **weekly** rosters, so the wire/API `period` is a single `YYYY-MM-DD` token = the week's **Monday** (`period_start`); the engine derives `period_end = period + 6 days` in SQL. A roster is keyed for read/guard purposes by `period_start = period`. **Do NOT reuse the projection `Period` type** (`{ start; end }`, exported from `projection.ts`): it is a HALF-OPEN `[start, end)` window (`clocking.ts:39`), a different semantic — borrowing it would assert a convention that does not hold (CLAUDE.md §1). The new engine inputs carry a plain `period: string`.

2. **`shift.not_found` already exists — the spec lists it as new, but it is not.** `packages/workforce/src/errors.ts:57` already declares `"shift.not_found": { tenantId: string; shiftId: string }` (first thrown by `requestSwap`). **Reuse it.** So the genuinely NEW codes are only **three**: `roster.draft_exists`, `roster.not_draft`, `shift.invalid`. `roster.not_found` (errors.ts:66), `roster.already_published`, `roster.period_already_published` (errors.ts:72/81) and `convenio.not_found` (`packages/workforce-es/src/errors.ts`) all already exist.

3. **No test pins the `PERMISSIONS` list as a literal.** `packages/identity/src/permissions.test.ts` enumerates it only through `for (const p of PERMISSIONS) …` loops (lines 6, 21, 24), which self-adapt. Appending `"schedule.manage"` to `PERMISSIONS` breaks **nothing** — BUT the manager loop (`:21`) and admin loop (`:24`) REQUIRE the new permission be reachable to those roles, so `schedule.manage` MUST be added to the `MANAGER` set (`permissions.ts:30-34`); `ALL`/admin picks it up automatically from `PERMISSIONS` (`:35`, `:40`). Do NOT add it to `staff`/`supervisor`.

4. **`apps/server` does not yet depend on `@waitron/workforce` / `@waitron/workforce-es`.** Both must be added to `apps/server/package.json` (Task 6). This is a `pnpm install` + lockfile change (CI runs `--frozen-lockfile`). It needs no migration — both packages are already in the migration manifest (`packages/migrations/migrations.manifest.json`), so `apps/server`'s real-PG helper already creates `roster_versions`/`shifts`/`convenio_config`.

5. **Location resolution gap — resolved by adding one thin read route.** The design's `GET /management-api/roster?locationId=…` requires the screen to know a `locationId`, but the dashboard has no locations surface today. Resolution: add a gated `GET /management-api/locations` → `[{ id, name }]` to the same route group (reads `locations` as `app_user`, which holds `SELECT` — no migration). The screen renders a location `<select>` (mirroring the catalogue-screen catalogue picker) and defaults to the first.

6. **Shift wall-time — slice-1 simplification: offset 0.** The `<dashboard-shift-dialog>` composes `startsAt`/`endsAt` from the cell's local date + entered `HH:MM` with `starts/ends_offset_minutes = 0` (entered wall time stored as the UTC instant). This is internally consistent (`localDate(instant, 0)` = the UTC date) and keeps the advisory guardrails meaningful. A real per-venue timezone offset is deferred to a later slice / the visual companion (spec §3d fixes the model, not the pixels).

---

## File Structure

**Create:**
- `apps/server/src/workforce-api.ts` — the `mountWorkforceApi` route group (roster CRUD + publish + locations).
- `apps/server/src/workforce-api.test.ts` — in-process PGlite route mechanics (body/id screens, happy paths, publish-returns-breaches).
- `apps/server/src/workforce-api.rls.test.ts` — real-Postgres differential cross-tenant isolation + gate-by-deletion.
- `apps/dashboard/src/widgets/shift-dialog.ts` + `.test.ts` + `.a11y.test.ts` — the add/edit/remove-shift dialog.
- `apps/dashboard/src/screens/roster-screen.ts` + `.test.ts` + `.a11y.test.ts` — the week picker + person × day grid + publish.

**Modify:**
- `packages/workforce/src/clocking.ts` — five new `WorkforceBackend` methods + new input/row types.
- `packages/workforce/src/errors.ts` — three new codes.
- `packages/workforce/src/index.ts` — `export type` the new input/row types (type-only; does not touch the `index.test.ts` runtime-key surface).
- `packages/workforce/src/scheduling.test.ts` — new PGlite tests for the authoring verbs (alongside the existing `publishRoster` tests).
- `packages/identity/src/permissions.ts` + `permissions.test.ts` — the `schedule.manage` permission.
- `apps/server/src/boot.ts` — mount the new group; `apps/server/package.json` — add the two workspace deps.
- `apps/dashboard/src/api/client.ts` + `client.test.ts` — roster methods + browser-local payload types.
- `apps/dashboard/src/dashboard-app.ts` + `dashboard-app.test.ts` — `"roster"` screen + nav + `#renderScreen`.
- `apps/dashboard/src/i18n/{strings,codes,domain}.ts` (+ `codes.test.ts`, `domain.test.ts`) — roster copy, code messages, breach/status tokens.

---

## Task 1: Engine — `createRosterVersion` + `roster.draft_exists`

**Files:**
- Modify: `packages/workforce/src/errors.ts` (add `roster.draft_exists`)
- Modify: `packages/workforce/src/clocking.ts` (new input/row types + `createRosterVersion` method)
- Modify: `packages/workforce/src/index.ts` (`export type` the new types)
- Test: `packages/workforce/src/scheduling.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `WorkforceBackend` (class, `clocking.ts:139`); fixtures `seedTenant`, `seedLocation`, `seedPerson`, `insertRosterVersion` (`packages/workforce/test/fixtures.ts`); the PGlite `suite`/`run`/`codeOfRejection` harness at the top of `scheduling.test.ts`.
- Produces:
  ```ts
  export interface CreateRosterVersionInput { tenantId: string; locationId: string; period: string; }
  // WorkforceBackend method:
  createRosterVersion(tx: Transaction, input: CreateRosterVersionInput): Promise<string>; // returns new version id
  // errors.ts: "roster.draft_exists": { tenantId: string; locationId: string }
  ```

- [ ] **Step 1: Write the failing tests** — append to `scheduling.test.ts`:

```ts
describe("createRosterVersion", () => {
  it("inserts a draft for the week (period_start = the Monday, period_end = +6 days) and returns its id", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-02" }),
    );
    const row = await suite.db.execute<{
      status: string;
      period_start: string;
      period_end: string;
      published_at: string | null;
    }>(sql`select status, period_start, period_end, published_at
           from roster_versions where id = ${versionId}`);
    expect(row.rows[0]!.status).toBe("draft");
    expect(row.rows[0]!.period_start).toBe("2026-03-02");
    expect(row.rows[0]!.period_end).toBe("2026-03-08");
    expect(row.rows[0]!.published_at).toBeNull();
  });

  it("refuses a second draft for the same (tenant, location, week) — roster.draft_exists", async () => {
    await run((tx) => backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-09" }));
    const code = await codeOfRejection(() =>
      run((tx) => backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-09" })),
    );
    expect(code).toBe("roster.draft_exists");
  });

  it("allows a draft for a DIFFERENT week at the same location", async () => {
    await run((tx) => backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-16" }));
    const other = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-23" }),
    );
    expect(other).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: FAIL — `backend.createRosterVersion is not a function`.

- [ ] **Step 3: Declare the code** — in `packages/workforce/src/errors.ts`, inside the `declare module "@waitron/shared" { interface ErrorParams { … } }` block, beside the existing `roster.*` codes:

```ts
/** `createRosterVersion` (../clocking.ts) was asked to open a draft for a (tenant, location, week)
 * that already has one. The published-uniqueness index covers only PUBLISHED rows, so drafts need
 * this guard to keep the authoring screen from silently forking two drafts of one week. `roster.*`,
 * grepped against the registry — the prefix already groups publishRoster's codes. */
"roster.draft_exists": { tenantId: string; locationId: string };
```

- [ ] **Step 4: Implement** — in `clocking.ts`, add the input/row types near `PublishRosterInput` (:96):

```ts
export interface CreateRosterVersionInput {
  tenantId: string;
  locationId: string;
  /** The Monday (YYYY-MM-DD) of the week to author — period_start; period_end is derived as +6 days. */
  period: string;
}
```

Add the method to `WorkforceBackend` (beside `publishRoster`):

```ts
/**
 * Opens a DRAFT roster version for one location's week (design §3a) — planning data (mutable),
 * inserted with status 'draft' and a null publish stamp. `period_end` is derived in SQL as the
 * inclusive Sunday (`+ 6` days), so no date value round-trips through TypeScript. Throws
 * `roster.draft_exists` when a draft for this (tenant, location, week) already exists — the
 * published-uniqueness index does not cover drafts, so this check-then-insert is the guard.
 * Slice-1 single-author screen: a concurrent double-create could still fork two drafts (no draft
 * unique index — that would be a migration); acceptable and documented here.
 */
async createRosterVersion(tx: Transaction, input: CreateRosterVersionInput): Promise<string> {
  const existing = await tx.execute<{ id: string }>(sql`
    select id from roster_versions
    where tenant_id = ${input.tenantId} and location_id = ${input.locationId}
      and period_start = ${input.period} and status = 'draft'
    limit 1`);
  if (existing.rows.length > 0) {
    throw new AppError("roster.draft_exists", {
      tenantId: input.tenantId,
      locationId: input.locationId,
    });
  }
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into roster_versions (tenant_id, location_id, period_start, period_end)
    values (${input.tenantId}, ${input.locationId}, ${input.period}, ${input.period}::date + 6)
    returning id`);
  return rows[0]!.id;
}
```

In `packages/workforce/src/index.ts`, beside `export type { PublishRosterInput } from "./clocking.js";` (:9):

```ts
export type { CreateRosterVersionInput } from "./clocking.js";
```

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: PASS (all three).

- [ ] **Step 6: Prove the guard by deletion** — temporarily delete the `if (existing.rows.length > 0) { throw … }` block; run the suite; confirm the `roster.draft_exists` test fails (the second create now succeeds). Restore it; confirm green.

- [ ] **Step 7: Gate + commit**

```bash
pnpm --filter @waitron/workforce typecheck && pnpm --filter @waitron/workforce test:coverage
git add packages/workforce/src/errors.ts packages/workforce/src/clocking.ts packages/workforce/src/index.ts packages/workforce/src/scheduling.test.ts
git commit -s -m "feat(workforce): createRosterVersion draft-authoring verb (+ roster.draft_exists)"
```

---

## Task 2: Engine — `getRoster` + `getRosterVersion`

**Files:**
- Modify: `packages/workforce/src/clocking.ts` (two read methods + `RosterVersionRow`/`ShiftRow`/`RosterSnapshot` types + private helpers)
- Modify: `packages/workforce/src/index.ts` (`export type` the row/snapshot types)
- Test: `packages/workforce/src/scheduling.test.ts`

**Interfaces:**
- Consumes: `insertRosterVersion`, `insertDraftShift` (`test/fixtures.ts`); `publishRoster` (`clocking.ts:357`) to make a published version for the fallback test.
- Produces:
  ```ts
  export interface RosterVersionRow { id: string; locationId: string; periodStart: string; periodEnd: string;
    status: "draft" | "published" | "superseded"; publishedAt: string | null; publishedByPersonId: string | null; }
  export interface ShiftRow { id: string; personId: string; locationId: string; startsAt: string;
    startsOffsetMinutes: number; endsAt: string; endsOffsetMinutes: number; role: string | null; rosterVersionId: string | null; }
  export interface RosterSnapshot { version: RosterVersionRow | null; shifts: ShiftRow[]; }
  getRoster(tx: Transaction, input: { tenantId: string; locationId: string; period: string }): Promise<RosterSnapshot>;
  getRosterVersion(tx: Transaction, input: { tenantId: string; versionId: string }): Promise<RosterVersionRow>; // throws roster.not_found
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("getRoster / getRosterVersion", () => {
  it("returns the draft version and its attached shifts for the week", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-04-06" }),
    );
    const shiftId = await insertDraftShift(suite.db, {
      tenantId, personId, locationId,
      startsAt: "2026-04-06T09:00:00Z", endsAt: "2026-04-06T17:00:00Z",
      rosterVersionId: versionId,
    });
    const snapshot = await run((tx) =>
      backend.getRoster(tx, { tenantId, locationId, period: "2026-04-06" }),
    );
    expect(snapshot.version?.id).toBe(versionId);
    expect(snapshot.version?.status).toBe("draft");
    expect(snapshot.shifts.map((s) => s.id)).toEqual([shiftId]);
    expect(snapshot.shifts[0]!.startsAt).toBe("2026-04-06T09:00:00Z");
  });

  it("returns { version: null, shifts: [] } for a week with no roster", async () => {
    const snapshot = await run((tx) =>
      backend.getRoster(tx, { tenantId, locationId, period: "2026-05-04" }),
    );
    expect(snapshot).toEqual({ version: null, shifts: [] });
  });

  it("falls back to the PUBLISHED version when there is no draft", async () => {
    const versionId = await insertRosterVersion(suite.db, {
      tenantId, locationId, periodStart: "2026-06-01", periodEnd: "2026-06-07",
    });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
    const snapshot = await run((tx) =>
      backend.getRoster(tx, { tenantId, locationId, period: "2026-06-01" }),
    );
    expect(snapshot.version?.id).toBe(versionId);
    expect(snapshot.version?.status).toBe("published");
  });

  it("getRosterVersion returns the row, or throws roster.not_found for an unknown id", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-07-06" }),
    );
    const row = await run((tx) => backend.getRosterVersion(tx, { tenantId, versionId }));
    expect(row.locationId).toBe(locationId);
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.getRosterVersion(tx, { tenantId, versionId: "00000000-0000-0000-0000-000000000000" }),
      ),
    );
    expect(code).toBe("roster.not_found");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: FAIL — `backend.getRoster is not a function`.

- [ ] **Step 3: Implement** — add the three types (near `CreateRosterVersionInput`) and the methods + two private helpers to `clocking.ts`:

```ts
async getRoster(
  tx: Transaction,
  input: { tenantId: string; locationId: string; period: string },
): Promise<RosterSnapshot> {
  // Prefer the DRAFT (what is being edited); fall back to the current PUBLISHED version for the week.
  // `period_start/end::text`: node-postgres parses a `date` column into a JS Date, PGlite into a
  // string — the same driver divergence `attachedShifts` handles with `to_char`. The `::text` cast
  // pins both to a 'YYYY-MM-DD' string, so the row (and its JSON to the browser) is stable.
  const { rows } = await tx.execute<RosterVersionDbRow>(sql`
    select id, location_id, period_start::text as period_start, period_end::text as period_end, status,
      to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as published_at,
      published_by_person_id
    from roster_versions
    where tenant_id = ${input.tenantId} and location_id = ${input.locationId}
      and period_start = ${input.period} and status in ('draft', 'published')
    order by case when status = 'draft' then 0 else 1 end
    limit 1`);
  const row = rows[0];
  if (row === undefined) return { version: null, shifts: [] };
  const version = mapRosterVersion(row);
  return { version, shifts: await this.shiftsForVersion(tx, input.tenantId, version.id) };
}

async getRosterVersion(
  tx: Transaction,
  input: { tenantId: string; versionId: string },
): Promise<RosterVersionRow> {
  const { rows } = await tx.execute<RosterVersionDbRow>(sql`
    select id, location_id, period_start::text as period_start, period_end::text as period_end, status,
      to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as published_at,
      published_by_person_id
    from roster_versions
    where tenant_id = ${input.tenantId} and id = ${input.versionId}
    limit 1`);
  const row = rows[0];
  if (row === undefined) {
    throw new AppError("roster.not_found", {
      tenantId: input.tenantId,
      rosterVersionId: input.versionId,
    });
  }
  return mapRosterVersion(row);
}

private async shiftsForVersion(
  tx: Transaction,
  tenantId: string,
  versionId: string,
): Promise<ShiftRow[]> {
  const { rows } = await tx.execute<ShiftDbRow>(sql`
    select id, person_id, location_id,
      to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
      starts_offset_minutes,
      to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at,
      ends_offset_minutes, role, roster_version_id
    from shifts
    where tenant_id = ${tenantId} and roster_version_id = ${versionId}
    order by starts_at`);
  return rows.map(mapShift);
}
```

Add module-private DB-row shapes + mappers (near the bottom of `clocking.ts`, beside `shiftDay`):

```ts
interface RosterVersionDbRow {
  id: string; location_id: string; period_start: string; period_end: string;
  status: string; published_at: string | null; published_by_person_id: string | null;
}
interface ShiftDbRow {
  id: string; person_id: string; location_id: string; starts_at: string; starts_offset_minutes: number;
  ends_at: string; ends_offset_minutes: number; role: string | null; roster_version_id: string | null;
}
function mapRosterVersion(r: RosterVersionDbRow): RosterVersionRow {
  return {
    id: r.id, locationId: r.location_id, periodStart: r.period_start, periodEnd: r.period_end,
    status: r.status as RosterVersionRow["status"],
    publishedAt: r.published_at, publishedByPersonId: r.published_by_person_id,
  };
}
function mapShift(r: ShiftDbRow): ShiftRow {
  return {
    id: r.id, personId: r.person_id, locationId: r.location_id, startsAt: r.starts_at,
    startsOffsetMinutes: r.starts_offset_minutes, endsAt: r.ends_at,
    endsOffsetMinutes: r.ends_offset_minutes, role: r.role, rosterVersionId: r.roster_version_id,
  };
}
```

Export the types in `index.ts`:

```ts
export type { RosterVersionRow, ShiftRow, RosterSnapshot } from "./clocking.js";
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: PASS.

- [ ] **Step 5: Prove the guard by deletion** — delete the `if (row === undefined) { throw … }` in `getRosterVersion`; confirm the `roster.not_found` assertion fails (it returns `undefined` and `.locationId` throws a TypeError instead of the AppError). Restore.

- [ ] **Step 6: Gate + commit**

```bash
pnpm --filter @waitron/workforce typecheck && pnpm --filter @waitron/workforce test:coverage
git add packages/workforce/src/clocking.ts packages/workforce/src/index.ts packages/workforce/src/scheduling.test.ts
git commit -s -m "feat(workforce): getRoster + getRosterVersion read verbs"
```

---

## Task 3: Engine — `addShift` + `shift.invalid` + `roster.not_draft`

**Files:**
- Modify: `packages/workforce/src/errors.ts` (add `shift.invalid`, `roster.not_draft`)
- Modify: `packages/workforce/src/clocking.ts` (`AddShiftInput` + `addShift`)
- Modify: `packages/workforce/src/index.ts` (`export type { AddShiftInput }`)
- Test: `packages/workforce/src/scheduling.test.ts`

**Interfaces:**
- Consumes: `createRosterVersion` (Task 1), `insertRosterVersion` + `publishRoster` (to make a published version for the not-draft test), the private `rosterVersionStatus` (`clocking.ts:449`, returns status / throws `roster.not_found`).
- Produces:
  ```ts
  export interface AddShiftInput { tenantId: string; versionId: string; personId: string; locationId: string;
    startsAt: string; startsOffsetMinutes: number; endsAt: string; endsOffsetMinutes: number; role: string | null; }
  addShift(tx: Transaction, input: AddShiftInput): Promise<string>; // returns new shift id
  // errors.ts: "roster.not_draft": { tenantId; rosterVersionId }, "shift.invalid": { tenantId; reason }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("addShift", () => {
  function shiftInput(versionId: string, overrides: Partial<import("./clocking.js").AddShiftInput> = {}) {
    return {
      tenantId, versionId, personId, locationId,
      startsAt: "2026-08-03T09:00:00Z", startsOffsetMinutes: 0,
      endsAt: "2026-08-03T17:00:00Z", endsOffsetMinutes: 0, role: null,
      ...overrides,
    };
  }

  it("inserts a shift attached to the draft version and returns its id", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-08-03" }),
    );
    const shiftId = await run((tx) => backend.addShift(tx, shiftInput(versionId, { role: "bar" })));
    const row = await suite.db.execute<{ roster_version_id: string; role: string | null }>(
      sql`select roster_version_id, role from shifts where id = ${shiftId}`,
    );
    expect(row.rows[0]!.roster_version_id).toBe(versionId);
    expect(row.rows[0]!.role).toBe("bar");
  });

  it("rejects a version that does not exist — roster.not_found", async () => {
    const code = await codeOfRejection(() =>
      run((tx) => backend.addShift(tx, shiftInput("00000000-0000-0000-0000-000000000000"))),
    );
    expect(code).toBe("roster.not_found");
  });

  it("rejects a PUBLISHED version — roster.not_draft", async () => {
    const versionId = await insertRosterVersion(suite.db, {
      tenantId, locationId, periodStart: "2026-08-10", periodEnd: "2026-08-16",
    });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
    const code = await codeOfRejection(() => run((tx) => backend.addShift(tx, shiftInput(versionId))));
    expect(code).toBe("roster.not_draft");
  });

  it("rejects a non-positive interval (starts >= ends) — shift.invalid", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-08-17" }),
    );
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.addShift(tx, shiftInput(versionId, {
          startsAt: "2026-08-17T17:00:00Z", endsAt: "2026-08-17T09:00:00Z",
        })),
      ),
    );
    expect(code).toBe("shift.invalid");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: FAIL — `backend.addShift is not a function`.

- [ ] **Step 3: Declare the codes** — in `errors.ts`, beside the other `roster.*`/`shift.*` codes:

```ts
/** A shift write named a roster version whose `status` is not `draft` (published or superseded) —
 * planning is closed once a version is published, so a shift add/edit/remove against it is refused.
 * Distinct from `roster.not_found` (the version does not exist); here it EXISTS but is not editable.
 * `roster.*`, grepped — groups with publishRoster's codes. */
"roster.not_draft": { tenantId: string; rosterVersionId: string };
/** A shift's planned interval is malformed — its start is at or after its end. Refused BEFORE the
 * insert/update so a caller gets a structured 4xx rather than the `shifts_interval_ck` 23514 → 500.
 * `reason` names WHICH invariant failed (no shiftId: on add the row does not exist yet). `shift.*`,
 * grepped — the entity is the shift. */
"shift.invalid": { tenantId: string; reason: string };
```

- [ ] **Step 4: Implement** — `AddShiftInput` + method in `clocking.ts`:

```ts
export interface AddShiftInput {
  tenantId: string;
  versionId: string;
  personId: string;
  /** The centro de trabajo — should match the version's location (the screen uses the roster's). */
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
}

/**
 * Adds a planned shift to a DRAFT roster version (design §3a), attaching it directly
 * (`roster_version_id = versionId`). Refuses a malformed interval up front (`shift.invalid`, not the
 * `shifts_interval_ck` 500), a missing version (`roster.not_found`, via `rosterVersionStatus`) and a
 * non-draft version (`roster.not_draft`). Planning data — a plain INSERT, no chain.
 */
async addShift(tx: Transaction, input: AddShiftInput): Promise<string> {
  if (Date.parse(input.startsAt) >= Date.parse(input.endsAt)) {
    throw new AppError("shift.invalid", { tenantId: input.tenantId, reason: "ends_not_after_starts" });
  }
  const status = await this.rosterVersionStatus(tx, input.tenantId, input.versionId); // throws roster.not_found
  if (status !== "draft") {
    throw new AppError("roster.not_draft", {
      tenantId: input.tenantId,
      rosterVersionId: input.versionId,
    });
  }
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes,
      ends_at, ends_offset_minutes, role, roster_version_id)
    values (${input.tenantId}, ${input.personId}, ${input.locationId},
      ${input.startsAt}, ${input.startsOffsetMinutes}, ${input.endsAt}, ${input.endsOffsetMinutes},
      ${input.role}, ${input.versionId})
    returning id`);
  return rows[0]!.id;
}
```

`export type { AddShiftInput } from "./clocking.js";` in `index.ts`.

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: PASS.

- [ ] **Step 6: Prove both guards by deletion** — (a) remove the `if (status !== "draft")` block → the `roster.not_draft` test fails (the insert against a published version succeeds); (b) remove the `Date.parse` interval check → the `shift.invalid` test fails (the DB `shifts_interval_ck` fires as a non-AppError instead). Restore both; confirm green.

- [ ] **Step 7: Gate + commit**

```bash
pnpm --filter @waitron/workforce typecheck && pnpm --filter @waitron/workforce test:coverage
git add packages/workforce/src/errors.ts packages/workforce/src/clocking.ts packages/workforce/src/index.ts packages/workforce/src/scheduling.test.ts
git commit -s -m "feat(workforce): addShift verb (+ roster.not_draft, shift.invalid)"
```

---

## Task 4: Engine — `updateShift` + `removeShift`

**Files:**
- Modify: `packages/workforce/src/clocking.ts` (`UpdateShiftInput` + `updateShift` + `removeShift` + private `shiftForWrite`)
- Modify: `packages/workforce/src/index.ts` (`export type { UpdateShiftInput }`)
- Test: `packages/workforce/src/scheduling.test.ts`

**Interfaces:**
- Consumes: `addShift` (Task 3), `createRosterVersion` (Task 1), `insertRosterVersion` + `publishRoster` (published-version test). Reuses existing `shift.not_found` (`errors.ts:57`) and `roster.not_draft` (Task 3).
- Produces:
  ```ts
  export interface UpdateShiftInput { tenantId: string; shiftId: string; personId?: string;
    startsAt?: string; startsOffsetMinutes?: number; endsAt?: string; endsOffsetMinutes?: number; role?: string | null; }
  updateShift(tx: Transaction, input: UpdateShiftInput): Promise<void>;
  removeShift(tx: Transaction, input: { tenantId: string; shiftId: string }): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("updateShift / removeShift", () => {
  async function draftShift(period: string): Promise<{ versionId: string; shiftId: string }> {
    const versionId = await run((tx) => backend.createRosterVersion(tx, { tenantId, locationId, period }));
    const shiftId = await run((tx) =>
      backend.addShift(tx, {
        tenantId, versionId, personId, locationId,
        startsAt: `${period}T09:00:00Z`, startsOffsetMinutes: 0,
        endsAt: `${period}T17:00:00Z`, endsOffsetMinutes: 0, role: null,
      }),
    );
    return { versionId, shiftId };
  }

  it("edits a shift's times and role", async () => {
    const { shiftId } = await draftShift("2026-09-07");
    await run((tx) =>
      backend.updateShift(tx, { tenantId, shiftId, endsAt: "2026-09-07T15:00:00Z", role: "kitchen" }),
    );
    const row = await suite.db.execute<{ ends_at: string; role: string | null }>(sql`
      select to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at, role
      from shifts where id = ${shiftId}`);
    expect(row.rows[0]!.ends_at).toBe("2026-09-07T15:00:00Z");
    expect(row.rows[0]!.role).toBe("kitchen");
  });

  it("removes a shift", async () => {
    const { shiftId } = await draftShift("2026-09-14");
    await run((tx) => backend.removeShift(tx, { tenantId, shiftId }));
    const row = await suite.db.execute(sql`select id from shifts where id = ${shiftId}`);
    expect(row.rows).toEqual([]);
  });

  it("rejects an unknown shift — shift.not_found (both verbs)", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(await codeOfRejection(() => run((tx) => backend.updateShift(tx, { tenantId, shiftId: missing, role: "x" })))).toBe("shift.not_found");
    expect(await codeOfRejection(() => run((tx) => backend.removeShift(tx, { tenantId, shiftId: missing })))).toBe("shift.not_found");
  });

  it("rejects editing/removing a shift whose version is PUBLISHED — roster.not_draft", async () => {
    const versionId = await insertRosterVersion(suite.db, {
      tenantId, locationId, periodStart: "2026-09-21", periodEnd: "2026-09-27",
    });
    const shiftId = await insertDraftShift(suite.db, {
      tenantId, personId, locationId,
      startsAt: "2026-09-21T09:00:00Z", endsAt: "2026-09-21T17:00:00Z", rosterVersionId: versionId,
    });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
    expect(await codeOfRejection(() => run((tx) => backend.updateShift(tx, { tenantId, shiftId, role: "x" })))).toBe("roster.not_draft");
    expect(await codeOfRejection(() => run((tx) => backend.removeShift(tx, { tenantId, shiftId })))).toBe("roster.not_draft");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: FAIL — `backend.updateShift is not a function`.

- [ ] **Step 3: Implement** — in `clocking.ts`:

```ts
export interface UpdateShiftInput {
  tenantId: string;
  shiftId: string;
  personId?: string;
  startsAt?: string;
  startsOffsetMinutes?: number;
  endsAt?: string;
  endsOffsetMinutes?: number;
  role?: string | null;
}

/** Edits a shift on a DRAFT version. Reads the shift + its version status (`shift.not_found` if the
 * shift is gone, `roster.not_draft` if its version is published). Validates the EFFECTIVE interval
 * (patch value ?? current) so a partial edit cannot land a malformed interval as a 500 — `shift.invalid`. */
async updateShift(tx: Transaction, input: UpdateShiftInput): Promise<void> {
  const shift = await this.shiftForWrite(tx, input.tenantId, input.shiftId);
  const startsAt = input.startsAt ?? shift.startsAt;
  const endsAt = input.endsAt ?? shift.endsAt;
  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new AppError("shift.invalid", { tenantId: input.tenantId, reason: "ends_not_after_starts" });
  }
  await tx.execute(sql`
    update shifts set
      person_id = ${input.personId ?? shift.personId},
      starts_at = ${startsAt},
      starts_offset_minutes = ${input.startsOffsetMinutes ?? shift.startsOffsetMinutes},
      ends_at = ${endsAt},
      ends_offset_minutes = ${input.endsOffsetMinutes ?? shift.endsOffsetMinutes},
      role = ${input.role === undefined ? shift.role : input.role}
    where tenant_id = ${input.tenantId} and id = ${input.shiftId}`);
}

/** Deletes a shift on a DRAFT version. Same guards as `updateShift`. */
async removeShift(tx: Transaction, input: { tenantId: string; shiftId: string }): Promise<void> {
  await this.shiftForWrite(tx, input.tenantId, input.shiftId);
  await tx.execute(sql`delete from shifts where tenant_id = ${input.tenantId} and id = ${input.shiftId}`);
}

/** Reads a shift + its version's status, throwing `shift.not_found` (no such shift) or
 * `roster.not_draft` (the shift's non-null version is not a draft). A null `roster_version_id`
 * (an unattached draft shift) is editable — there is no published version to protect. */
private async shiftForWrite(
  tx: Transaction,
  tenantId: string,
  shiftId: string,
): Promise<ShiftRow> {
  const { rows } = await tx.execute<ShiftDbRow & { version_status: string | null }>(sql`
    select s.id, s.person_id, s.location_id,
      to_char(s.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
      s.starts_offset_minutes,
      to_char(s.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at,
      s.ends_offset_minutes, s.role, s.roster_version_id, rv.status as version_status
    from shifts s
    left join roster_versions rv on rv.id = s.roster_version_id and rv.tenant_id = ${tenantId}
    where s.tenant_id = ${tenantId} and s.id = ${shiftId}
    limit 1`);
  const row = rows[0];
  if (row === undefined) throw new AppError("shift.not_found", { tenantId, shiftId });
  if (row.version_status !== null && row.version_status !== "draft") {
    throw new AppError("roster.not_draft", { tenantId, rosterVersionId: row.roster_version_id! });
  }
  return mapShift(row);
}
```

`export type { UpdateShiftInput } from "./clocking.js";` in `index.ts`.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: PASS.

- [ ] **Step 5: Prove the guards by deletion** — remove the `if (row === undefined) throw …` → the `shift.not_found` assertions fail; remove the `if (row.version_status !== null && …)` → the `roster.not_draft` assertions fail. Restore; confirm green.

- [ ] **Step 6: Gate + commit** — this closes the engine; run the WHOLE package unfiltered (cross-cutting guards, CLAUDE.md §2/§4):

```bash
pnpm --filter @waitron/workforce typecheck
pnpm --filter @waitron/workforce test:coverage
git add packages/workforce/src/clocking.ts packages/workforce/src/index.ts packages/workforce/src/scheduling.test.ts
git commit -s -m "feat(workforce): updateShift + removeShift verbs"
```

---

## Task 5: Identity — `schedule.manage` permission

**Files:**
- Modify: `packages/identity/src/permissions.ts`
- Test: `packages/identity/src/permissions.test.ts`

**Interfaces:**
- Consumes: `PERMISSIONS`, `roleHasPermission`, the `MANAGER`/`ALL` sets (`permissions.ts:7/30/35`).
- Produces: `"schedule.manage"` added to the `Permission` union, held by `manager` + `admin` only.

- [ ] **Step 1: Write the failing test** — add a new `it` to `permissions.test.ts`, mirroring the `till.configure` block exactly:

```ts
it("grants schedule.manage to manager and admin only (shift-planning slice 1)", () => {
  // A domain-named scheduling permission (roster authoring), granted to exactly the roles that hold
  // person.manage — manager and admin — and NEVER to staff or supervisor, so the roster write gate
  // matches the staff-admin gate. Later slices add swap.approve / absence.decide beside it.
  expect(roleHasPermission("manager", "schedule.manage")).toBe(true);
  expect(roleHasPermission("admin", "schedule.manage")).toBe(true);
  expect(roleHasPermission("staff", "schedule.manage")).toBe(false);
  expect(roleHasPermission("supervisor", "schedule.manage")).toBe(false);
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/identity test permissions`
Expected: FAIL — `roleHasPermission("manager", "schedule.manage")` is `false` (the string is not yet in `MANAGER`). (The `for (const p of PERMISSIONS)` manager loop at `:21` still passes here because `schedule.manage` is not yet in `PERMISSIONS`.)

- [ ] **Step 3: Implement** — in `permissions.ts`, append to `PERMISSIONS` (after `till.configure`, :16):

```ts
  // Authoring the weekly roster (draft → warn → publish) from the management dashboard
  // (@waitron/workforce). A domain-named SCHEDULING permission, distinct from staff admin
  // (person.manage) and till config (till.configure); granted to manager + admin. Later slices add
  // swap.approve / absence.decide beside it (shift-planning slice 1, 2026-08-15).
  "schedule.manage",
```

and add it to the `MANAGER` set (:30-34):

```ts
const MANAGER: ReadonlySet<Permission> = new Set([
  ...SUPERVISOR,
  "person.manage",
  "till.configure",
  "schedule.manage",
]);
```

(`ALL`/`admin` picks it up from `PERMISSIONS` automatically — no further edit.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/identity test permissions`
Expected: PASS (including the pre-existing manager/admin loops at `:21`/`:24`, which now cover `schedule.manage` too).

- [ ] **Step 5: Prove the manager mapping is load-bearing** — temporarily remove `"schedule.manage"` from the `MANAGER` set (leave it in `PERMISSIONS`); confirm BOTH the new test AND the existing manager loop (`:21`) go red. Restore; confirm green.

- [ ] **Step 6: Gate + commit**

```bash
pnpm --filter @waitron/identity typecheck && pnpm --filter @waitron/identity test:coverage
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts
git commit -s -m "feat(identity): add schedule.manage permission (manager + admin)"
```

---

## Task 6: Server — `mountWorkforceApi` skeleton + roster read/create + locations route

**Files:**
- Modify: `apps/server/package.json` (add `@waitron/workforce`, `@waitron/workforce-es` deps)
- Create: `apps/server/src/workforce-api.ts`
- Modify: `apps/server/src/boot.ts` (mount the group)
- Create: `apps/server/src/workforce-api.test.ts` (in-process PGlite)

**Interfaces:**
- Consumes: `asAppUser`, `withTenant`, `Database`, `Transaction` (`@waitron/db`); `authorizeManager`, `Permission` (`@waitron/identity`); `WorkforceBackend` + `RosterSnapshot` (`@waitron/workforce`); `createErrorBoundary` (`./error-boundary.js`); `requireManagementSession` (`./management-session.js`); `isUuid` (`./till-session.js`); `AppError` (`@waitron/shared`); `locations` (`@waitron/db`).
- Produces:
  ```ts
  export interface WorkforceApiDeps { db: Database; cfg: { tenantId: string }; }
  export function mountWorkforceApi(app: Hono, deps: WorkforceApiDeps, log: Logger): void;
  // Routes added here: GET /management-api/locations, GET /management-api/roster, POST /management-api/roster
  ```

- [ ] **Step 1: Add the workspace deps + install** — add to `apps/server/package.json` `dependencies` (alphabetical, after `@waitron/verifactu`):

```json
    "@waitron/workforce": "workspace:*",
    "@waitron/workforce-es": "workspace:*",
```

Run `pnpm install` (updates the lockfile). Verify: `pnpm --filter @waitron/server typecheck` still passes (nothing imports them yet).

- [ ] **Step 2: Write the failing test** — `apps/server/src/workforce-api.test.ts` (mirror `catalogue-api.test.ts`'s in-process PGlite setup: `usePgliteDb` with `CORE_MIGRATIONS + IDENTITY_MIGRATIONS + WORKFORCE_MIGRATIONS + WORKFORCE_ES_MIGRATIONS`, seed a tenant/location/manager/staff, mint sessions with `startManagementSession`):

```ts
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS } from "@waitron/workforce-es";
import type { Logger } from "./logger.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

const noopLog: Logger = () => {};
let tenantId: string;
let locationId: string;
let personId: string;
let managerCookie: string;
let staffCookie: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    const seeded = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const loc = await tx.execute<{ id: string }>(sql`
        insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (current_tenant_id(), 'Main', array['es-ES'], 'Sale on premises') returning id`);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
      const mSes = await startManagementSession(tx, { tenantId, personId: mgr.rows[0]!.id });
      const sSes = await startManagementSession(tx, { tenantId, personId: stf.rows[0]!.id });
      return { locationId: loc.rows[0]!.id, personId: mgr.rows[0]!.id, mSid: mSes.id, sSid: sSes.id };
    });
    locationId = seeded.locationId;
    personId = seeded.personId;
    managerCookie = `${MANAGEMENT_COOKIE}=${seeded.mSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${seeded.sSid}`;
  },
});

function mountApp(): Hono {
  const app = new Hono();
  mountWorkforceApi(app, { db: suite.db, cfg: { tenantId } }, noopLog);
  return app;
}

async function send(app: Hono, method: string, path: string, opts: { body?: unknown; cookie?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const cookie = opts.cookie === undefined ? managerCookie : opts.cookie;
  if (cookie !== null) headers["cookie"] = cookie;
  return app.request(path, { method, headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) });
}

describe("mountWorkforceApi — locations + roster read/create", () => {
  it("GET /management-api/locations lists the tenant's locations", async () => {
    const res = await send(mountApp(), "GET", "/management-api/locations");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; name: string }[];
    expect(rows).toContainEqual({ id: locationId, name: "Main" });
  });

  it("GET /management-api/roster returns { version: null, shifts: [] } for an empty week", async () => {
    const res = await send(mountApp(), "GET", `/management-api/roster?locationId=${locationId}&period=2026-03-02`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: null, shifts: [] });
  });

  it("POST /management-api/roster creates a draft and returns { versionId } (201)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", {
      body: { locationId, period: "2026-03-09" },
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as { versionId: string }).toMatchObject({ versionId: expect.any(String) });
  });

  it("400s a non-UUID locationId on GET (shared.invalid_id, never a 500)", async () => {
    const res = await send(mountApp(), "GET", "/management-api/roster?locationId=not-a-uuid&period=2026-03-02");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "shared.invalid_id" } });
  });

  it("400s a malformed period on POST (management.request_invalid)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", { body: { locationId, period: "not-a-date" } });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "management.request_invalid" } });
  });

  it("401s an unauthenticated request", async () => {
    const res = await send(mountApp(), "GET", "/management-api/locations", { cookie: null });
    expect(res.status).toBe(401);
  });

  it("403s a staff-role session (no schedule.manage)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster", { body: { locationId, period: "2026-03-09" }, cookie: staffCookie });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "authorization.not_permitted" } });
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @waitron/server test workforce-api.test`
Expected: FAIL — cannot find `./workforce-api.js`.

- [ ] **Step 4: Implement `workforce-api.ts`** — mirror `catalogue-api.ts`'s structure (`import "./errors.js"` for `management.request_invalid`; a `STATUS` map; `run = createErrorBoundary(STATUS, "workforce.failed")`; a `requireUuidParam` helper; a `gated()` closure = `withTenant` + `asAppUser` + `authorizeManager(SCHEDULE_PERMISSION)`):

```ts
// Side-effect: loads this host's errors.ts augmentation for `management.request_invalid`, thrown by
// the body/query screens below (the "every file that throws imports ./errors.js" convention). The
// workforce codes (roster.*, shift.*, convenio.not_found) are declared in @waitron/workforce /
// @waitron/workforce-es and load transitively via the value imports below; shared.invalid_id loads
// via the AppError value import.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, locations, type Database, type Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import { WorkforceBackend } from "@waitron/workforce";
import { resolveWorkTimeRuleset } from "@waitron/workforce-es";
import { createErrorBoundary } from "./error-boundary.js";
import { requireManagementSession } from "./management-session.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

export interface WorkforceApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

/** The ONE permission gating every workforce route — referenced through this single constant, never
 * an inline literal (the catalogue-api CATALOGUE_WRITE_PERMISSION pattern). Later slices add
 * swap.approve / absence.decide beside it. */
const SCHEDULE_PERMISSION: Permission = "schedule.manage";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "roster.not_found": 404,
  "roster.draft_exists": 409,
  "roster.not_draft": 409,
  "roster.already_published": 409,
  "roster.period_already_published": 409,
  "shift.not_found": 404,
  "shift.invalid": 400,
  "convenio.not_found": 409,
};

const run = createErrorBoundary(STATUS, "workforce.failed");
const backend = new WorkforceBackend();

function requireUuidParam(id: string, kind: string): string {
  if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind, value: id });
  return id;
}

/** Screen a `period` query/body value as a YYYY-MM-DD date shape (a non-date would 22007 → 500 at the
 * `date` column). Refuses as `management.request_invalid` naming the field. */
function requirePeriod(value: unknown): string {
  if (typeof value !== "string" || !YYYY_MM_DD.test(value)) {
    throw new AppError("management.request_invalid", { field: "period" });
  }
  return value;
}

export function mountWorkforceApi(app: Hono, deps: WorkforceApiDeps, log: Logger): void {
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission: SCHEDULE_PERMISSION });
      return fn(tx);
    });

  // The tenant's centros de trabajo, for the roster screen's location picker (design §3d gap-fill).
  app.get("/management-api/locations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) =>
        tx.select({ id: locations.id, name: locations.name }).from(locations),
      );
      return c.json(rows);
    }),
  );

  app.get("/management-api/roster", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.query("locationId") ?? "", "LocationId");
      const period = requirePeriod(c.req.query("period"));
      const snapshot = await gated(sessionId, (tx) =>
        backend.getRoster(tx, { tenantId: deps.cfg.tenantId, locationId, period }),
      );
      return c.json(snapshot);
    }),
  );

  app.post("/management-api/roster", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = (await c.req.json<{ locationId?: unknown; period?: unknown }>()) ?? {};
      if (typeof body.locationId !== "string" || !isUuid(body.locationId)) {
        throw new AppError("management.request_invalid", { field: "locationId" });
      }
      const period = requirePeriod(body.period);
      const { locationId } = body;
      const versionId = await gated(sessionId, (tx) =>
        backend.createRosterVersion(tx, { tenantId: deps.cfg.tenantId, locationId, period }),
      );
      return c.json({ versionId }, 201);
    }),
  );
}
```

- [ ] **Step 5: Mount in `boot.ts`** — add the import beside `mountCatalogueApi` (:41) and the mount beside it (:307), reusing the exact `db` + `till.tenantId`:

```ts
import { mountWorkforceApi } from "./workforce-api.js";
// … after mountCatalogueApi(...):
// The dashboard's gated shift-planning surface (roster authoring + publish) on the SAME app, the
// identical convention. Reuses the EXACT db + tenant (till.tenantId, this venue's one tenant); no
// fiscal backend, clock, card provider or media store — these routes touch only roster_versions /
// shifts / convenio_config / locations. Routes only; the schedule.manage gate runs per request.
mountWorkforceApi(app, { db, cfg: { tenantId: till.tenantId } }, log);
```

- [ ] **Step 6: Run it — verify it passes**

Run: `pnpm --filter @waitron/server test workforce-api.test`
Expected: PASS.

- [ ] **Step 7: Prove the gate by deletion** — temporarily remove the `authorizeManager(...)` call from `gated`; confirm the "403s a staff-role session" test flips to a success (201). Restore; confirm green.

- [ ] **Step 8: Gate + commit**

```bash
pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test workforce-api.test
git add apps/server/package.json pnpm-lock.yaml apps/server/src/workforce-api.ts apps/server/src/boot.ts apps/server/src/workforce-api.test.ts
git commit -s -m "feat(server): mountWorkforceApi — locations + roster read/create routes"
```

---

## Task 7: Server — shift write routes (add / update / remove)

**Files:**
- Modify: `apps/server/src/workforce-api.ts` (three shift routes)
- Modify: `apps/server/src/workforce-api.test.ts`

**Interfaces:**
- Consumes: the `gated` helper, `requireUuidParam`, `backend.addShift/updateShift/removeShift` (Tasks 3-4).
- Produces routes: `POST /management-api/roster/:versionId/shifts` → `{ shiftId }` (201); `PATCH /management-api/roster/shifts/:shiftId` → 204; `DELETE /management-api/roster/shifts/:shiftId` → 204.

- [ ] **Step 1: Write the failing tests** — append to `workforce-api.test.ts`:

```ts
describe("mountWorkforceApi — shift routes", () => {
  async function draftVersion(period: string): Promise<string> {
    const res = await send(mountApp(), "POST", "/management-api/roster", { body: { locationId, period } });
    return ((await res.json()) as { versionId: string }).versionId;
  }
  const shiftBody = (day: string) => ({
    personId, locationId,
    startsAt: `${day}T09:00:00Z`, startsOffsetMinutes: 0,
    endsAt: `${day}T17:00:00Z`, endsOffsetMinutes: 0, role: "bar",
  });

  it("POST …/roster/:versionId/shifts adds a shift (201) and GET roster shows it", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-06");
    const res = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, { body: shiftBody("2026-04-06") });
    expect(res.status).toBe(201);
    const { shiftId } = (await res.json()) as { shiftId: string };
    const roster = await send(app, "GET", `/management-api/roster?locationId=${locationId}&period=2026-04-06`);
    expect(((await roster.json()) as { shifts: { id: string }[] }).shifts.map((s) => s.id)).toContain(shiftId);
  });

  it("PATCH …/roster/shifts/:shiftId edits a shift (204)", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-13");
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, { body: shiftBody("2026-04-13") });
    const { shiftId } = (await add.json()) as { shiftId: string };
    const res = await send(app, "PATCH", `/management-api/roster/shifts/${shiftId}`, { body: { role: "kitchen" } });
    expect(res.status).toBe(204);
  });

  it("DELETE …/roster/shifts/:shiftId removes a shift (204)", async () => {
    const app = mountApp();
    const versionId = await draftVersion("2026-04-20");
    const add = await send(app, "POST", `/management-api/roster/${versionId}/shifts`, { body: shiftBody("2026-04-20") });
    const { shiftId } = (await add.json()) as { shiftId: string };
    const res = await send(app, "DELETE", `/management-api/roster/shifts/${shiftId}`);
    expect(res.status).toBe(204);
  });

  it("404s a shift route with an unknown shift id (shift.not_found)", async () => {
    const res = await send(mountApp(), "DELETE", "/management-api/roster/shifts/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "shift.not_found" } });
  });

  it("400s a non-UUID :shiftId (shared.invalid_id, never a 500)", async () => {
    const res = await send(mountApp(), "DELETE", "/management-api/roster/shifts/not-a-uuid");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "shared.invalid_id" } });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/server test workforce-api.test`
Expected: FAIL — the shift routes 404 (unmounted) so `res.status` is not 201/204.

- [ ] **Step 3: Implement** — add the three routes to `mountWorkforceApi` (after the `POST /management-api/roster` route). Each body field is typeof-screened as `management.request_invalid` naming the field (the catalogue/management convention); a present-but-wrong field is a 400, an absent optional field on PATCH is a no-op:

```ts
app.post("/management-api/roster/:versionId/shifts", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const versionId = requireUuidParam(c.req.param("versionId"), "RosterVersionId");
    const body = (await c.req.json<Record<string, unknown>>()) ?? {};
    const personId = requireBodyUuid(body.personId, "personId");
    const locationId = requireBodyUuid(body.locationId, "locationId");
    const startsAt = requireBodyString(body.startsAt, "startsAt");
    const endsAt = requireBodyString(body.endsAt, "endsAt");
    const startsOffsetMinutes = requireBodyInt(body.startsOffsetMinutes, "startsOffsetMinutes");
    const endsOffsetMinutes = requireBodyInt(body.endsOffsetMinutes, "endsOffsetMinutes");
    const role = requireNullableString(body.role, "role");
    const shiftId = await gated(sessionId, (tx) =>
      backend.addShift(tx, {
        tenantId: deps.cfg.tenantId, versionId, personId, locationId,
        startsAt, startsOffsetMinutes, endsAt, endsOffsetMinutes, role,
      }),
    );
    return c.json({ shiftId }, 201);
  }),
);

app.patch("/management-api/roster/shifts/:shiftId", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const shiftId = requireUuidParam(c.req.param("shiftId"), "ShiftId");
    const body = (await c.req.json<Record<string, unknown>>()) ?? {};
    const patch: import("@waitron/workforce").UpdateShiftInput = { tenantId: deps.cfg.tenantId, shiftId };
    if (body.personId !== undefined) patch.personId = requireBodyUuid(body.personId, "personId");
    if (body.startsAt !== undefined) patch.startsAt = requireBodyString(body.startsAt, "startsAt");
    if (body.endsAt !== undefined) patch.endsAt = requireBodyString(body.endsAt, "endsAt");
    if (body.startsOffsetMinutes !== undefined) patch.startsOffsetMinutes = requireBodyInt(body.startsOffsetMinutes, "startsOffsetMinutes");
    if (body.endsOffsetMinutes !== undefined) patch.endsOffsetMinutes = requireBodyInt(body.endsOffsetMinutes, "endsOffsetMinutes");
    if (body.role !== undefined) patch.role = requireNullableString(body.role, "role");
    await gated(sessionId, (tx) => backend.updateShift(tx, patch));
    return c.body(null, 204);
  }),
);

app.delete("/management-api/roster/shifts/:shiftId", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const shiftId = requireUuidParam(c.req.param("shiftId"), "ShiftId");
    await gated(sessionId, (tx) => backend.removeShift(tx, { tenantId: deps.cfg.tenantId, shiftId }));
    return c.body(null, 204);
  }),
);
```

Add the small module-private body-screen helpers (near `requirePeriod`), each throwing `management.request_invalid` naming the field:

```ts
function requireBodyString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}
function requireBodyUuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !isUuid(v)) throw new AppError("management.request_invalid", { field });
  return v;
}
function requireBodyInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new AppError("management.request_invalid", { field });
  return v;
}
function requireNullableString(v: unknown, field: string): string | null {
  if (v === null) return null;
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/server test workforce-api.test`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test workforce-api.test
git add apps/server/src/workforce-api.ts apps/server/src/workforce-api.test.ts
git commit -s -m "feat(server): workforce-api shift add/update/remove routes"
```

---

## Task 8: Server — publish route (resolve ruleset → `publishRoster` → breaches)

**Files:**
- Modify: `apps/server/src/workforce-api.ts` (publish route)
- Modify: `apps/server/src/workforce-api.test.ts`

**Interfaces:**
- Consumes: `backend.getRosterVersion` (Task 2, for the version's `locationId`), `resolveWorkTimeRuleset` (`@waitron/workforce-es`, `{ tenantId, locationId }` → ruleset, throws `convenio.not_found`), `backend.publishRoster` (`clocking.ts:357`, returns `RosterBreach[]`).
- Produces route: `POST /management-api/roster/:versionId/publish` → `{ breaches }` (200).

- [ ] **Step 1: Write the failing tests** — append to `workforce-api.test.ts`. The publish test needs a `convenio_config` row for the location; seed it once as `app_user` in an `it` (the PGlite suite already migrated `WORKFORCE_ES_MIGRATIONS`):

```ts
describe("mountWorkforceApi — publish", () => {
  async function seedConvenio(): Promise<void> {
    await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into convenio_config (tenant_id, location_id)
        values (current_tenant_id(), ${locationId})
        on conflict (tenant_id, location_id) do nothing`);
    });
  }

  it("publishes a draft and returns { breaches } (a clean roster → empty array)", async () => {
    await seedConvenio();
    const app = mountApp();
    const create = await send(app, "POST", "/management-api/roster", { body: { locationId, period: "2026-05-04" } });
    const { versionId } = (await create.json()) as { versionId: string };
    await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: { personId, locationId, startsAt: "2026-05-04T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-05-04T14:00:00Z", endsOffsetMinutes: 0, role: null },
    });
    const res = await send(app, "POST", `/management-api/roster/${versionId}/publish`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { breaches: unknown[] }).toEqual({ breaches: [] });
  });

  it("returns the advisory breaches but still publishes a breaching roster (owner decision 2026-08-02)", async () => {
    await seedConvenio();
    const app = mountApp();
    const create = await send(app, "POST", "/management-api/roster", { body: { locationId, period: "2026-05-11" } });
    const { versionId } = (await create.json()) as { versionId: string };
    // A 12h shift breaches the 9h ordinary-daily max AND owes a break — a non-empty breaches array.
    await send(app, "POST", `/management-api/roster/${versionId}/shifts`, {
      body: { personId, locationId, startsAt: "2026-05-11T08:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-05-11T20:00:00Z", endsOffsetMinutes: 0, role: null },
    });
    const res = await send(app, "POST", `/management-api/roster/${versionId}/publish`);
    expect(res.status).toBe(200);
    const { breaches } = (await res.json()) as { breaches: { kind: string }[] };
    expect(breaches.map((b) => b.kind)).toContain("exceeds_daily_max");
    // Still published:
    const roster = await send(app, "GET", `/management-api/roster?locationId=${locationId}&period=2026-05-11`);
    expect(((await roster.json()) as { version: { status: string } }).version.status).toBe("published");
  });

  it("409s publish when the location has no convenio_config (convenio.not_found)", async () => {
    const app = mountApp();
    // A DIFFERENT location with no convenio row.
    const otherLoc = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const r = await tx.execute<{ id: string }>(sql`
        insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (current_tenant_id(), 'Annex', array['es-ES'], 'Sale on premises') returning id`);
      return r.rows[0]!.id;
    });
    const create = await send(app, "POST", "/management-api/roster", { body: { locationId: otherLoc, period: "2026-05-18" } });
    const { versionId } = (await create.json()) as { versionId: string };
    const res = await send(app, "POST", `/management-api/roster/${versionId}/publish`);
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "convenio.not_found" } });
  });

  it("404s publish of an unknown version (roster.not_found)", async () => {
    const res = await send(mountApp(), "POST", "/management-api/roster/00000000-0000-0000-0000-000000000000/publish");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/server test workforce-api.test`
Expected: FAIL — the publish route 404s (unmounted).

- [ ] **Step 3: Implement** — add the route. It reads the version to get `locationId` (→ `roster.not_found` if the version is gone, BEFORE touching the convenio), resolves the ruleset (→ `convenio.not_found`), then publishes; the publish stamps `published_by_person_id` from the session's authorised person:

```ts
app.post("/management-api/roster/:versionId/publish", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const versionId = requireUuidParam(c.req.param("versionId"), "RosterVersionId");
    const breaches = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: SCHEDULE_PERMISSION,
      });
      const version = await backend.getRosterVersion(tx, { tenantId: deps.cfg.tenantId, versionId });
      const ruleset = await resolveWorkTimeRuleset(tx, {
        tenantId: deps.cfg.tenantId,
        locationId: version.locationId,
      });
      return backend.publishRoster(tx, {
        tenantId: deps.cfg.tenantId,
        versionId,
        publishedByPersonId: authorizedBy,
        ruleset,
      });
    });
    return c.json({ breaches });
  }),
);
```

(This route composes `withTenant` + `asAppUser` + `authorizeManager` inline rather than via `gated`, because it needs `authorizeManager`'s returned `authorizedBy` for `publishedByPersonId` — the same reason `management-api.ts`'s `GET /management-api/layout` calls `authorizeManager` inline.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/server test workforce-api.test`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test workforce-api.test
git add apps/server/src/workforce-api.ts apps/server/src/workforce-api.test.ts
git commit -s -m "feat(server): workforce-api publish route (resolve ruleset -> breaches)"
```

---

## Task 9: Server — real-Postgres RLS + gate suite

**Files:**
- Create: `apps/server/src/workforce-api.rls.test.ts`

**Interfaces:**
- Consumes: `useRealPostgres` + `startRealPostgres` (`./testing/postgres.js`); `applyVenue` + `planVenue` (`@waitron/provisioning`); `hashPin`, `hashPassword`, `startManagementSession` (`@waitron/identity`); `asAppUser`, `withTenant` (`@waitron/db`); `mountWorkforceApi`; `MANAGEMENT_COOKIE`. Mirrors `apps/server/src/catalogue-api.rls.test.ts` exactly.
- Produces: the differential cross-tenant isolation proof (fails if `asAppUser` is dropped) + the gate-by-deletion proof (staff → 403).

- [ ] **Step 1: Write the failing tests** — model on `catalogue-api.rls.test.ts` (per-venue NIF counter, `setupVenue()` provisioning a manager + staff, one Hono app per tenant). The load-bearing differences: each venue needs its **location id** (read it back as `app_user`) and, for the publish assertion, a `convenio_config` row seeded as admin.

```ts
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { startRealPostgres } from "./testing/postgres.js";

const LOCALE = "es-ES";
const suite = useRealPostgres({ start: startRealPostgres, timeoutMs: 180_000 });
const noopLog: Logger = () => {};

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

interface Venue { tenantId: string; locationId: string; personId: string; managerCookie: string; staffCookie: string; }

async function setupVenue(): Promise<Venue> {
  const venue = await applyVenue(
    planVenue({
      country: "ES", taxId: nextNif(), legalName: "Deli Test SL",
      location: {
        name: "Sala principal", fiscalTerritory: "ES-common", invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento", addressLine1: "Calle Mayor 1",
        addressLine2: null, postalCode: "28013", city: "Madrid", province: "Madrid",
        timeZone: "Europe/Madrid", dayCutover: "05:00",
      },
      tillName: "Caja 1", seriesCode: "A", rectificativeSeriesCode: "R",
      admin: { displayName: "Administradora", pinHash: hashPin("1234"), passwordHash: hashPassword("dashPass123") },
    }),
    { db: suite.admin },
  );
  const seeded = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const loc = await tx.execute<{ id: string }>(sql`select id from locations where tenant_id = current_tenant_id() limit 1`);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const mSes = await startManagementSession(tx, { tenantId: venue.tenantId, personId: mgr.rows[0]!.id });
    const sSes = await startManagementSession(tx, { tenantId: venue.tenantId, personId: stf.rows[0]!.id });
    return { locationId: loc.rows[0]!.id, personId: mgr.rows[0]!.id, mSid: mSes.id, sSid: sSes.id };
  });
  return {
    tenantId: venue.tenantId, locationId: seeded.locationId, personId: seeded.personId,
    managerCookie: `${MANAGEMENT_COOKIE}=${seeded.mSid}`, staffCookie: `${MANAGEMENT_COOKIE}=${seeded.sSid}`,
  };
}

function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountWorkforceApi(app, { db: suite.admin, cfg: { tenantId } }, noopLog);
  return app;
}

async function send(app: Hono, method: string, path: string, cookie: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("Workforce API over real Postgres (RLS end-to-end)", () => {
  it("isolates rosters across tenants — a manager sees only their OWN tenant's draft", async () => {
    // Differential cross-tenant isolation. GET /roster is an UNFILTERED read (its only tenant scoping
    // is withTenant + asAppUser RLS), so were asAppUser dropped from `gated`, tenant B's manager
    // reading B's own version id... — instead we assert the cleaner cross-read: A's version is
    // INVISIBLE to B. GUARD-BY-DELETION (asAppUser): drop `await asAppUser(tx)` from workforce-api.ts's
    // `gated` and B's read of A's roster leaks A's draft version (the run becomes red).
    const a = await setupVenue();
    const b = await setupVenue();
    const appA = mountApp(a.tenantId);
    const appB = mountApp(b.tenantId);

    // A authors a draft for its own location + week.
    const createA = await send(appA, "POST", "/management-api/roster", a.managerCookie, { locationId: a.locationId, period: "2026-03-02" });
    expect(createA.status).toBe(201);
    const versionA = ((await createA.json()) as { versionId: string }).versionId;
    await send(appA, "POST", `/management-api/roster/${versionA}/shifts`, a.managerCookie, {
      personId: a.personId, locationId: a.locationId,
      startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null,
    });

    // A sees its own draft + shift.
    const readA = await send(appA, "GET", `/management-api/roster?locationId=${a.locationId}&period=2026-03-02`, a.managerCookie);
    const snapA = (await readA.json()) as { version: { id: string } | null; shifts: unknown[] };
    expect(snapA.version?.id).toBe(versionA);
    expect(snapA.shifts).toHaveLength(1);

    // B reading A's location id sees NOTHING — RLS row-hides A's version + shifts (the load-bearing
    // differential; if asAppUser were dropped this would return A's draft).
    const bReadsA = await send(appB, "GET", `/management-api/roster?locationId=${a.locationId}&period=2026-03-02`, b.managerCookie);
    expect(bReadsA.status).toBe(200);
    expect(await bReadsA.json()).toEqual({ version: null, shifts: [] });

    // B cannot mutate A's shift either — RLS hides it, so the id is shift.not_found from B's side.
    const bAddsToAsVersion = await send(appB, "POST", `/management-api/roster/${versionA}/shifts`, b.managerCookie, {
      personId: b.personId, locationId: b.locationId,
      startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null,
    });
    expect(bAddsToAsVersion.status).toBe(404); // roster.not_found — A's version is invisible to B
  });

  it("refuses every roster write route to a staff-role session — 403 authorization.not_permitted", async () => {
    // GUARD-BY-DELETION (authorizeManager): remove the authorizeManager call from workforce-api.ts's
    // `gated` (and the inline one in the publish route) and these 403s flip to success.
    const { tenantId, locationId, staffCookie } = await setupVenue();
    const app = mountApp(tenantId);
    const missing = "00000000-0000-0000-0000-000000000000";
    const expect403 = async (res: Response) => {
      expect(res.status).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "authorization.not_permitted" } });
    };
    await expect403(await send(app, "GET", `/management-api/roster?locationId=${locationId}&period=2026-03-02`, staffCookie));
    await expect403(await send(app, "POST", "/management-api/roster", staffCookie, { locationId, period: "2026-03-02" }));
    await expect403(await send(app, "POST", `/management-api/roster/${missing}/shifts`, staffCookie, {
      personId: missing, locationId, startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null,
    }));
    await expect403(await send(app, "DELETE", `/management-api/roster/shifts/${missing}`, staffCookie));
    await expect403(await send(app, "POST", `/management-api/roster/${missing}/publish`, staffCookie));
  });

  it("publishes end-to-end under RLS and returns the breaches array", async () => {
    const v = await setupVenue();
    // Seed the location's convenio_config (as admin — superuser bypasses RLS; tenant_id set explicitly).
    await suite.admin.execute(sql`insert into convenio_config (tenant_id, location_id) values (${v.tenantId}, ${v.locationId})`);
    const app = mountApp(v.tenantId);
    const create = await send(app, "POST", "/management-api/roster", v.managerCookie, { locationId: v.locationId, period: "2026-06-01" });
    const versionId = ((await create.json()) as { versionId: string }).versionId;
    const res = await send(app, "POST", `/management-api/roster/${versionId}/publish`, v.managerCookie);
    expect(res.status).toBe(200);
    expect((await res.json()) as { breaches: unknown[] }).toEqual({ breaches: [] });
  });
});
```

- [ ] **Step 2: Run it — verify it fails first for the right reason, then passes** — run with the container flag:

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test workforce-api.rls`
Expected on first run: PASS (the routes exist from Tasks 6-8). If anything is red, fix the route, not the test.

- [ ] **Step 3: Prove the differential is real (drop `asAppUser`)** — temporarily remove `await asAppUser(tx)` from `workforce-api.ts`'s `gated` helper AND the publish route's inline `asAppUser`; re-run the suite; confirm the isolation test goes red (B's read of A's roster leaks A's draft). Restore both; `git diff apps/server/src/workforce-api.ts` is clean; re-run green.

- [ ] **Step 4: Prove the gate is real (drop `authorizeManager`)** — temporarily remove the `authorizeManager(...)` from `gated` and from the publish route; re-run; confirm the staff-refusal test goes red (the writes succeed). Restore; re-run green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/workforce-api.rls.test.ts
git commit -s -m "test(server): workforce-api real-Postgres RLS isolation + gate suite"
```

---

## Task 10: Dashboard — `DashboardApi` roster methods + browser-local types

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`
- Modify: `apps/dashboard/src/api/client.test.ts`

**Interfaces:**
- Consumes: `DashboardApi` (`client.ts:207`), its `#request` funnel (`client.ts:425`).
- Produces (all browser-local, NO `@waitron/*` runtime import — the bundle-isolation rule):
  ```ts
  export interface RosterVersion { id: string; locationId: string; periodStart: string; periodEnd: string;
    status: "draft" | "published" | "superseded"; publishedAt: string | null; publishedByPersonId: string | null; }
  export interface Shift { id: string; personId: string; locationId: string; startsAt: string;
    startsOffsetMinutes: number; endsAt: string; endsOffsetMinutes: number; role: string | null; rosterVersionId: string | null; }
  export interface RosterSnapshot { version: RosterVersion | null; shifts: Shift[]; }
  export interface ShiftInput { personId: string; locationId: string; startsAt: string;
    startsOffsetMinutes: number; endsAt: string; endsOffsetMinutes: number; role: string | null; }
  export interface ShiftPatch { personId?: string; startsAt?: string; startsOffsetMinutes?: number;
    endsAt?: string; endsOffsetMinutes?: number; role?: string | null; }
  export type RosterBreachKind = "rest_too_short" | "exceeds_daily_max" | "exceeds_weekly_max"
    | "overtime_cap_exceeded" | "weekly_rest_insufficient" | "break_owed" | "night_work";
  export interface RosterBreach { kind: RosterBreachKind; personId: string; [detail: string]: unknown; }
  export interface LocationSummary { id: string; name: string; }
  // methods on DashboardApi:
  getLocations(): Promise<LocationSummary[]>;
  getRoster(locationId: string, period: string): Promise<RosterSnapshot>;
  createRosterVersion(locationId: string, period: string): Promise<{ versionId: string }>;
  addShift(versionId: string, input: ShiftInput): Promise<{ shiftId: string }>;
  updateShift(shiftId: string, patch: ShiftPatch): Promise<void>;
  removeShift(shiftId: string): Promise<void>;
  publishRoster(versionId: string): Promise<{ breaches: RosterBreach[] }>;
  ```

- [ ] **Step 1: Write the failing tests** — append to `client.test.ts`, mirroring the existing `jsonResponse`/`emptyResponse` + fetch-assert pattern:

```ts
describe("DashboardApi — roster", () => {
  it("getRoster GETs the snapshot with the location + period query", async () => {
    const snapshot = { version: null, shifts: [] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(snapshot));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getRoster("loc-1", "2026-03-02")).toEqual(snapshot);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster?locationId=loc-1&period=2026-03-02", {
      method: "GET", credentials: "include",
    });
  });

  it("createRosterVersion POSTs { locationId, period }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ versionId: "v1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createRosterVersion("loc-1", "2026-03-02")).toEqual({ versionId: "v1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locationId: "loc-1", period: "2026-03-02" }),
    });
  });

  it("addShift POSTs the shift under the version and returns { shiftId }", async () => {
    const input = { personId: "p1", locationId: "loc-1", startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ shiftId: "s1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.addShift("v1", input)).toEqual({ shiftId: "s1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster/v1/shifts", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
  });

  it("updateShift PATCHes and removeShift DELETEs (both 204 → void)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.updateShift("s1", { role: "bar" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster/shifts/s1", {
      method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "bar" }),
    });
    await api.removeShift("s1");
    expect(fetchImpl).toHaveBeenLastCalledWith("/management-api/roster/shifts/s1", { method: "DELETE", credentials: "include" });
  });

  it("publishRoster POSTs and returns { breaches }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ breaches: [{ kind: "night_work", personId: "p1", shiftId: "s1", nightMinutes: 120 }] }));
    const api = new DashboardApi("", fetchImpl);
    const out = await api.publishRoster("v1");
    expect(out.breaches[0]!.kind).toBe("night_work");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster/v1/publish", { method: "POST", credentials: "include" });
  });

  it("getLocations GETs the location list", async () => {
    const locs = [{ id: "loc-1", name: "Main" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(locs));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getLocations()).toEqual(locs);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locations", { method: "GET", credentials: "include" });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/dashboard test client`
Expected: FAIL — `api.getRoster is not a function`.

- [ ] **Step 3: Implement** — add the type block (a new `// ── Shift-planning types ──` section, mirroring the catalogue section's header note about the bundle-isolation rule) and the methods to `DashboardApi`:

```ts
getLocations(): Promise<LocationSummary[]> {
  return this.#request<LocationSummary[]>("/management-api/locations", "GET");
}
getRoster(locationId: string, period: string): Promise<RosterSnapshot> {
  return this.#request<RosterSnapshot>(
    `/management-api/roster?locationId=${locationId}&period=${period}`, "GET",
  );
}
createRosterVersion(locationId: string, period: string): Promise<{ versionId: string }> {
  return this.#request<{ versionId: string }>("/management-api/roster", "POST", { locationId, period });
}
addShift(versionId: string, input: ShiftInput): Promise<{ shiftId: string }> {
  return this.#request<{ shiftId: string }>(`/management-api/roster/${versionId}/shifts`, "POST", input);
}
updateShift(shiftId: string, patch: ShiftPatch): Promise<void> {
  return this.#request<void>(`/management-api/roster/shifts/${shiftId}`, "PATCH", patch);
}
removeShift(shiftId: string): Promise<void> {
  return this.#request<void>(`/management-api/roster/shifts/${shiftId}`, "DELETE");
}
publishRoster(versionId: string): Promise<{ breaches: RosterBreach[] }> {
  return this.#request<{ breaches: RosterBreach[] }>(`/management-api/roster/${versionId}/publish`, "POST");
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/dashboard test client`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/dashboard test:coverage
git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/client.test.ts
git commit -s -m "feat(dashboard): DashboardApi roster methods + browser-local roster types"
```

---

## Task 11: Dashboard — `<dashboard-shift-dialog>` widget

**Files:**
- Create: `apps/dashboard/src/widgets/shift-dialog.ts`
- Create: `apps/dashboard/src/widgets/shift-dialog.test.ts`
- Create: `apps/dashboard/src/widgets/shift-dialog.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (the dialog's own copy, en + es)

**Interfaces:**
- Consumes: `@waitron/ui` (`baseStyles`, `wt-dialog`, `wt-button`, `wt-input`); `t` (`../i18n/t.js`); `Shift` (`../api/client.js`); `mountWidget`/`cleanupWidgets`/`expectNoA11yViolations` (`./test-helpers.js`).
- Produces: `<dashboard-shift-dialog>` emitting composed events `add-shift` (detail `{ personId, startsAt, startsOffsetMinutes, endsAt, endsOffsetMinutes, role }`), `update-shift` (detail `{ shiftId, patch }`), `remove-shift` (detail `{ shiftId }`), and `wt-close`. Properties: `open`, `day` (YYYY-MM-DD), `personId`, `shift: Shift | null`, `busy`.

- [ ] **Step 1: Add the dialog strings** — in `strings.ts`, add to `en` (Person form / Product form region) AND the matching `es` (compile-guarded so both must land together):

```ts
// en:
"roster.new_shift": "New shift",
"roster.edit_shift": "Edit shift",
"roster.shift_start": "Start",
"roster.shift_end": "End",
"roster.shift_role": "Role",
// es:
"roster.new_shift": "Nuevo turno",
"roster.edit_shift": "Editar turno",
"roster.shift_start": "Inicio",
"roster.shift_end": "Fin",
"roster.shift_role": "Puesto",
```
(`action.save`, `action.create`, `action.remove` already exist — reuse them.)

- [ ] **Step 2: Write the failing behaviour tests** — `shift-dialog.test.ts`, mirroring `product-form.test.ts` (mount by props, `emit`/click, assert the composed event fired with the composed instants):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { Shift } from "../api/client.js";
import { ShiftDialog } from "./shift-dialog.js";

const shift: Shift = {
  id: "s1", personId: "p1", locationId: "loc-1",
  startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0,
  endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: "bar", rosterVersionId: "v1",
};
const setInput = (el: ShiftDialog, test: string, value: string) => {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=${test}]`)!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
};
const capture = (el: ShiftDialog, type: string) => {
  const spy = vi.fn();
  el.addEventListener(type, (e) => spy((e as CustomEvent).detail));
  return spy;
};
afterEach(cleanupWidgets);

describe("shift-dialog", () => {
  it("emits add-shift with instants composed from the day + entered times (offset 0)", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true, day: "2026-03-02", personId: "p1", shift: null,
    });
    const add = capture(el, "add-shift");
    setInput(el, "shift-start", "09:00");
    setInput(el, "shift-end", "13:00");
    setInput(el, "shift-role", "bar");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(add).toHaveBeenCalledWith({
      personId: "p1", startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0,
      endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: "bar",
    });
  });

  it("pre-fills from an existing shift and emits update-shift on save", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true, day: "2026-03-02", personId: "p1", shift,
    });
    const update = capture(el, "update-shift");
    setInput(el, "shift-end", "15:00");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(update).toHaveBeenCalledWith({
      shiftId: "s1",
      patch: { startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T15:00:00Z", endsOffsetMinutes: 0, role: "bar" },
    });
  });

  it("emits remove-shift for an existing shift", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", { open: true, day: "2026-03-02", personId: "p1", shift });
    const remove = capture(el, "remove-shift");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove]")!.click();
    await el.updateComplete;
    expect(remove).toHaveBeenCalledWith({ shiftId: "s1" });
  });

  it("does not offer Remove for a new shift (shift null)", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", { open: true, day: "2026-03-02", personId: "p1", shift: null });
    expect(el.shadowRoot!.querySelector("[data-test=remove]")).toBeNull();
  });

  it("drops a double-fired confirm to one event when busy", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", { open: true, day: "2026-03-02", personId: "p1", shift: null, busy: false });
    const add = capture(el, "add-shift");
    setInput(el, "shift-start", "09:00");
    setInput(el, "shift-end", "13:00");
    const btn = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!;
    btn.click();
    (el as unknown as { busy: boolean }).busy = true; // the screen sets busy while the add round-trips
    await el.updateComplete;
    btn.click();
    await el.updateComplete;
    expect(add).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @waitron/dashboard test shift-dialog.test`
Expected: FAIL — cannot resolve `./shift-dialog.js`.

- [ ] **Step 4: Implement `shift-dialog.ts`** — model on `product-form.ts` (a `wt-dialog` with `heading`/`.open`/`@wt-close`, `willUpdate` reseeding, `#confirm` composing + dispatching, a `busy` single-flight, `slot="footer"` buttons). The offset-0 composition (Resolved Q6) turns the cell `day` + `HH:MM` into the instant:

```ts
import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import type { Shift, ShiftInput, ShiftPatch } from "../api/client.js";

export interface AddShiftDetail extends ShiftInput {}
export interface UpdateShiftDetail { shiftId: string; patch: ShiftPatch; }

@customElement("dashboard-shift-dialog")
export class ShiftDialog extends LitElement {
  static override styles = [baseStyles, css`
    :host { display: block; }
    .field { display: block; margin-bottom: var(--wt-space-4); }
  `];

  @property({ type: Boolean, reflect: true }) open = false;
  /** The local date (YYYY-MM-DD) of the grid cell this dialog authors. */
  @property() day = "";
  /** The person whose row was clicked — fixed for the shift (edit keeps the same person). */
  @property() personId = "";
  /** The shift being edited, or null for an add. `willUpdate` reseeds the fields on open/change. */
  @property({ attribute: false }) shift: Shift | null = null;
  /** Single-flight: the screen sets it true while an add/update/remove round-trips. */
  @property({ type: Boolean }) busy = false;

  @state() private start = "";
  @state() private end = "";
  @state() private role = "";

  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("shift") && !(changed.has("open") && this.open)) return;
    // Offset 0 (slice-1 simplification): startsAt is `${day}T${HH:MM}:00Z`, so slice(11,16) is the time.
    this.start = this.shift ? this.shift.startsAt.slice(11, 16) : "";
    this.end = this.shift ? this.shift.endsAt.slice(11, 16) : "";
    this.role = this.shift?.role ?? "";
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy || this.start === "" || this.end === "") return;
    const startsAt = `${this.day}T${this.start}:00Z`;
    const endsAt = `${this.day}T${this.end}:00Z`;
    const role = this.role.trim() === "" ? null : this.role.trim();
    if (this.shift) {
      this.dispatchEvent(new CustomEvent<UpdateShiftDetail>("update-shift", {
        detail: { shiftId: this.shift.id, patch: { startsAt, startsOffsetMinutes: 0, endsAt, endsOffsetMinutes: 0, role } },
        bubbles: true, composed: true,
      }));
      return;
    }
    this.dispatchEvent(new CustomEvent<AddShiftDetail>("add-shift", {
      detail: { personId: this.personId, locationId: "", startsAt, startsOffsetMinutes: 0, endsAt, endsOffsetMinutes: 0, role },
      bubbles: true, composed: true,
    }));
  }

  #remove(event: Event): void {
    event.stopPropagation();
    if (this.busy || !this.shift) return;
    this.dispatchEvent(new CustomEvent("remove-shift", { detail: { shiftId: this.shift.id }, bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <wt-dialog heading=${this.shift ? t("roster.edit_shift") : t("roster.new_shift")} .open=${this.open} @wt-close=${() => (this.open = false)}>
        <wt-input class="field" data-test="shift-start" type="time" label=${t("roster.shift_start")}
          .value=${this.start} @input=${(e: Event) => (this.start = (e.target as HTMLInputElement).value)}></wt-input>
        <wt-input class="field" data-test="shift-end" type="time" label=${t("roster.shift_end")}
          .value=${this.end} @input=${(e: Event) => (this.end = (e.target as HTMLInputElement).value)}></wt-input>
        <wt-input class="field" data-test="shift-role" label=${t("roster.shift_role")}
          .value=${this.role} @input=${(e: Event) => (this.role = (e.target as HTMLInputElement).value)}></wt-input>
        ${this.shift ? html`<wt-button slot="footer" variant="secondary" data-test="remove" ?disabled=${this.busy} @click=${(e: Event) => this.#remove(e)}>${t("action.remove")}</wt-button>` : nothing}
        <wt-button slot="footer" variant="primary" data-test="confirm" ?disabled=${this.busy} @click=${(e: Event) => this.#confirm(e)}>
          ${this.shift ? t("action.save") : t("action.create")}
        </wt-button>
      </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "dashboard-shift-dialog": ShiftDialog; }
}
```

> Note the `locationId: ""` in the `add-shift` detail: the SCREEN owns the selected location and fills it in when it calls `api.addShift` (Task 12), so the dialog does not need to know it. If the `wt-input` used here does not forward a native `input` event, bind `@wt-change` and read `e.detail.value` instead — match whichever `wt-input` emits (see `product-form.ts`'s `@wt-change` usage); adjust the test's `setInput` accordingly. Verify against `packages/ui/src/components/wt-input.ts` before writing the handler.

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @waitron/dashboard test shift-dialog.test`
Expected: PASS.

- [ ] **Step 6: Write + run the a11y test** — `shift-dialog.a11y.test.ts`, mirroring `catalogue-screen.a11y.test.ts` (`describe.each(["light","dark"])`, `mountWidget(tag, props, theme)`, `expectNoA11yViolations(host)`), mounting the dialog `open: true` in both add (shift null) and edit (shift set) shapes.

Run: `pnpm --filter @waitron/dashboard test shift-dialog`
Expected: PASS (behaviour + a11y).

- [ ] **Step 7: Gate + commit**

```bash
pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/dashboard test:coverage
git add apps/dashboard/src/widgets/shift-dialog.ts apps/dashboard/src/widgets/shift-dialog.test.ts apps/dashboard/src/widgets/shift-dialog.a11y.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "feat(dashboard): dashboard-shift-dialog add/edit/remove widget"
```

---

## Task 12: Dashboard — `<dashboard-roster-screen>` + shell wiring + i18n

**Files:**
- Create: `apps/dashboard/src/screens/roster-screen.ts`
- Create: `apps/dashboard/src/screens/roster-screen.test.ts`
- Create: `apps/dashboard/src/screens/roster-screen.a11y.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` + `dashboard-app.test.ts` (add the `roster` screen)
- Modify: `apps/dashboard/src/i18n/strings.ts` (nav + screen copy, en + es)
- Modify: `apps/dashboard/src/i18n/codes.ts` + `codes.test.ts` (roster/shift/convenio code messages)
- Modify: `apps/dashboard/src/i18n/domain.ts` + `domain.test.ts` (breach-kind + roster-status tokens)

**Interfaces:**
- Consumes: `DashboardApi` (with the Task-10 methods) + `RosterSnapshot`/`Shift`/`RosterBreach`/`LocationSummary` types; `PersonSummary` (`listStaff`); `<dashboard-shift-dialog>` (Task 11) + its `AddShiftDetail`/`UpdateShiftDetail`; `codeMessage` (`../i18n/codes.js`); the new `breachKindName`/`rosterStatusName` (`../i18n/domain.js`); `t`; `@waitron/ui`.
- Produces: `<dashboard-roster-screen>` (property `api`), reachable from the shell as the `roster` screen.

- [ ] **Step 1: Add the i18n (strings + codes + domain), each with a failing test first where the file has one.**

  - `strings.ts` — add to `en` + `es` (compile-guarded):
    ```ts
    // en
    "nav.roster": "Shifts",
    "roster.title": "Shifts",
    "roster.week": "Week",
    "roster.location": "Location",
    "roster.publish": "Publish",
    "roster.no_location": "No location configured yet.",
    "roster.breaches_intro": "Published with advisory warnings:",
    "roster.published_readonly": "This week is published — create changes as a new draft (coming soon).",
    // es
    "nav.roster": "Turnos",
    "roster.title": "Turnos",
    "roster.week": "Semana",
    "roster.location": "Local",
    "roster.publish": "Publicar",
    "roster.no_location": "Aún no hay ningún local configurado.",
    "roster.breaches_intro": "Publicado con avisos:",
    "roster.published_readonly": "Esta semana está publicada — crea los cambios como un nuevo borrador (próximamente).",
    ```
  - `codes.ts` — add code messages (en + es) for every code the roster surface can surface, so the banner never shows a raw code. Add a failing assertion to `codes.test.ts` first (mirroring its existing per-code assertions):
    ```ts
    // codes.test.ts (failing first):
    it("has a sentence for each roster/shift/convenio code", () => {
      for (const code of ["roster.draft_exists", "roster.not_draft", "roster.not_found",
        "roster.already_published", "roster.period_already_published", "shift.not_found",
        "shift.invalid", "convenio.not_found"]) {
        expect(codeMessage(code, "es")).not.toBe(code);
        expect(codeMessage(code, "es")).not.toBe(GENERIC.es); // if codes.test.ts imports GENERIC; else assert it is a mapped sentence
      }
    });
    ```
    Then add to `CODE_MESSAGES`:
    ```ts
    "roster.draft_exists": { en: "A draft already exists for that week", es: "Ya existe un borrador para esa semana" },
    "roster.not_draft": { en: "That week is already published", es: "Esa semana ya está publicada" },
    "roster.not_found": { en: "That roster could not be found", es: "No se ha encontrado ese cuadrante" },
    "roster.already_published": { en: "That roster is already published", es: "Ese cuadrante ya está publicado" },
    "roster.period_already_published": { en: "Another version of that week was just published", es: "Se acaba de publicar otra versión de esa semana" },
    "shift.not_found": { en: "That shift could not be found", es: "No se ha encontrado ese turno" },
    "shift.invalid": { en: "Check the shift times", es: "Revisa las horas del turno" },
    "convenio.not_found": { en: "Configure this location's working-time rules first", es: "Configura primero las reglas de jornada de este local" },
    ```
    (If `codes.test.ts` cannot reference `GENERIC`, assert `codeMessage(code) !== code` and equals the known Spanish sentence — enough to prove the mapping and the guard by deletion.)
  - `domain.ts` — add the two tables + resolvers (raw-value fallback via the existing `resolve()`), and a failing `domain.test.ts` assertion first:
    ```ts
    // domain.test.ts (failing first):
    it("names every breach kind and roster status, falling back to the raw token", () => {
      expect(breachKindName("exceeds_daily_max", "es")).not.toBe("exceeds_daily_max");
      expect(rosterStatusName("draft", "es")).not.toBe("draft");
      expect(breachKindName("unknown_kind", "es")).toBe("unknown_kind"); // raw-value fallback
    });
    ```
    Then in `domain.ts`:
    ```ts
    const BREACH_KIND_NAMES: NameTable = {
      rest_too_short: { en: "Too little rest between shifts", es: "Descanso insuficiente entre turnos" },
      exceeds_daily_max: { en: "Over the daily maximum", es: "Supera el máximo diario" },
      exceeds_weekly_max: { en: "Over the weekly maximum", es: "Supera el máximo semanal" },
      overtime_cap_exceeded: { en: "Over the overtime cap", es: "Supera el límite de horas extra" },
      weekly_rest_insufficient: { en: "Insufficient weekly rest", es: "Descanso semanal insuficiente" },
      break_owed: { en: "A break is owed", es: "Se debe un descanso" },
      night_work: { en: "Night work", es: "Trabajo nocturno" },
    };
    const ROSTER_STATUS_NAMES: NameTable = {
      draft: { en: "Draft", es: "Borrador" },
      published: { en: "Published", es: "Publicado" },
      superseded: { en: "Superseded", es: "Reemplazado" },
    };
    export function breachKindName(kind: string, locale: string = currentLocale()): string { return resolve(BREACH_KIND_NAMES, kind, locale); }
    export function rosterStatusName(status: string, locale: string = currentLocale()): string { return resolve(ROSTER_STATUS_NAMES, status, locale); }
    ```

  Run each i18n test, watch it fail, implement, watch it pass:
  Run: `pnpm --filter @waitron/dashboard test codes domain`
  Expected: FAIL then PASS. Then prove the raw-value fallback by deletion (temporarily change `resolve` to return `""` for a miss → the `unknown_kind` assertion fails → restore).

- [ ] **Step 2: Write the failing screen behaviour tests** — `roster-screen.test.ts`, mirroring `catalogue-screen.test.ts` (`stubApi`, `mountWidget`, `emit`, `flush`, shadow queries, private-state peeks):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, PersonSummary, RosterSnapshot } from "../api/client.js";
import { RosterScreen } from "./roster-screen.js";

const staff: PersonSummary[] = [
  { personId: "p1", displayName: "Ana", role: "staff", status: "active", hasPassword: false, hasTotp: false },
  { personId: "p2", displayName: "Beto", role: "staff", status: "active", hasPassword: false, hasTotp: false },
];
const locations = [{ id: "loc-1", name: "Main" }];
const emptySnapshot: RosterSnapshot = { version: null, shifts: [] };

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getLocations: vi.fn().mockResolvedValue(locations),
    listStaff: vi.fn().mockResolvedValue(staff),
    getRoster: vi.fn().mockResolvedValue(emptySnapshot),
    createRosterVersion: vi.fn().mockResolvedValue({ versionId: "v1" }),
    addShift: vi.fn().mockResolvedValue({ shiftId: "s1" }),
    updateShift: vi.fn().mockResolvedValue(undefined),
    removeShift: vi.fn().mockResolvedValue(undefined),
    publishRoster: vi.fn().mockResolvedValue({ breaches: [] }),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: RosterScreen): Promise<void> { await new Promise((r) => setTimeout(r, 0)); await el.updateComplete; }
function emit(source: Element, type: string, detail: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
const dialog = (el: RosterScreen) => el.shadowRoot!.querySelector("dashboard-shift-dialog")!;
afterEach(cleanupWidgets);

describe("roster-screen", () => {
  it("loads locations, staff and the roster on connect and renders a row per staff member", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    expect(api.getLocations).toHaveBeenCalledTimes(1);
    expect(api.listStaff).toHaveBeenCalledTimes(1);
    expect(api.getRoster).toHaveBeenCalledWith("loc-1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(el.shadowRoot!.querySelectorAll("[data-test^=row-]")).toHaveLength(2);
  });

  it("creates a draft on the first add-shift, then adds the shift with the selected location", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    // Open a cell (person p1, the week's first day) and emit add-shift from the dialog.
    (el as unknown as { openCell(personId: string, day: string): void }).openCell("p1", "2026-03-02");
    await el.updateComplete;
    emit(dialog(el), "add-shift", {
      personId: "p1", locationId: "", startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null,
    });
    await flush(el);
    expect(api.createRosterVersion).toHaveBeenCalledWith("loc-1", expect.any(String));
    expect(api.addShift).toHaveBeenCalledWith("v1", expect.objectContaining({ personId: "p1", locationId: "loc-1" }));
    expect(api.getRoster).toHaveBeenCalledTimes(2); // reloaded after the add
  });

  it("publishes and renders the returned breaches as an advisory banner (publish still succeeds)", async () => {
    const api = stubApi({
      getRoster: vi.fn().mockResolvedValue({ version: { id: "v1", locationId: "loc-1", periodStart: "2026-03-02", periodEnd: "2026-03-08", status: "draft", publishedAt: null, publishedByPersonId: null }, shifts: [] }),
      publishRoster: vi.fn().mockResolvedValue({ breaches: [{ kind: "night_work", personId: "p1", shiftId: "s1", nightMinutes: 120 }] }),
    });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=publish]")!.click();
    await flush(el);
    expect(api.publishRoster).toHaveBeenCalledWith("v1");
    const banner = el.shadowRoot!.querySelector("[data-test=breaches]");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("nocturno"); // breachKindName(night_work, es)
  });

  it("shows the error banner and does not crash when a load rejects", async () => {
    const api = stubApi({ getRoster: vi.fn().mockRejectedValue({ code: "convenio.not_found" }) });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("convenio.not_found");
  });

  it("files at most one create when add-shift fires twice (single-flight)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    (el as unknown as { openCell(p: string, d: string): void }).openCell("p1", "2026-03-02");
    await el.updateComplete;
    const detail = { personId: "p1", locationId: "", startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0, endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: null };
    emit(dialog(el), "add-shift", detail);
    emit(dialog(el), "add-shift", detail);
    await flush(el);
    expect(api.addShift).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @waitron/dashboard test roster-screen.test`
Expected: FAIL — cannot resolve `./roster-screen.js`.

- [ ] **Step 4: Implement `roster-screen.ts`** — mirror `catalogue-screen.ts`'s composition (injected `api`, `@state`, `connectedCallback → #load`, try/catch → `errorKey` banner, single-flight `busy`, `stopPropagation` on child events, `codeMessage` banner). Structure:

  - State: `locations: LocationSummary[]`, `locationId`, `staff: PersonSummary[]`, `weekMonday` (default `mondayOf(today)`), `snapshot: RosterSnapshot`, `dialogOpen`, `dialogPersonId`, `dialogDay`, `dialogShift: Shift | null`, `breaches: RosterBreach[]`, `errorKey: string | null`, `busy`.
  - Helpers (module-private): `mondayOf(dateStr)` (snap to the local Monday, mirroring roster-validation's `weekStartOf`), `weekDays(monday)` (7 YYYY-MM-DD), `localDate(instant, offsetMinutes)` (instant + offset → YYYY-MM-DD), `shiftsFor(personId, day)` (filter `snapshot.shifts`).
  - `#load()`: `Promise.all([getLocations, listStaff])`, pick first location, `await #loadRoster()`.
  - `#loadRoster()`: `snapshot = await api.getRoster(locationId, weekMonday)`.
  - `editable` getter: `snapshot.version === null || snapshot.version.status === 'draft'`.
  - `#draftVersionId` getter: `snapshot.version?.status === 'draft' ? snapshot.version.id : null`.
  - `openCell(personId, day)`: set `dialogPersonId/dialogDay/dialogShift` (the day's first shift for that person, or null) and `dialogOpen = true`; only when `editable`.
  - `#onAddShift(e)`: single-flight `busy`; `versionId = #draftVersionId ?? (await api.createRosterVersion(locationId, weekMonday)).versionId`; `await api.addShift(versionId, { ...e.detail, locationId })`; close dialog; `#loadRoster()`.
  - `#onUpdateShift(e)` / `#onRemoveShift(e)`: single-flight; call `api.updateShift`/`api.removeShift`; close; reload.
  - `#onPublish()`: `versionId = #draftVersionId`; guard null; `this.breaches = (await api.publishRoster(versionId)).breaches`; reload.
  - `#onSelectLocation` / `#onSelectWeek`: update state (snap week to Monday) and reload.
  - `render()`: an `<h1>${t("roster.title")}</h1>` (the shell relies on one `<h1>` per screen — see `dashboard-app.ts:44-50`), a location `<select data-test="location-select">`, an `<input type="date" data-test="week-picker">`, a `<table>` grid with a header row of the 7 day columns (`<th scope="col">`) and one `<tr data-test="row-${personId}">` per staff member (row header `<th scope="row">` = the display name; each cell `<td data-test="cell-${personId}-${day}">` lists `shiftsFor(...)` and is clickable to `openCell` when editable), a `<wt-button data-test="publish">` (shown when there is a draft), the breach banner (`role="status" data-test="breaches"` listing `breachKindName(b.kind)` when `breaches.length > 0`), the `errorKey` banner (`role="alert"` via `codeMessage`), and the `<dashboard-shift-dialog>` wired to `@add-shift`/`@update-shift`/`@remove-shift`/`@wt-close`.

  Concrete module-private helpers + the load-bearing handlers + a render skeleton (pixels are the visual companion's to refine, spec §3d — but the `<table>`/`<th scope>` semantics and every `data-test` the tests hook are fixed here):

```ts
const MS_PER_DAY = 86_400_000;
/** The local Monday (YYYY-MM-DD) of the week `dateStr` falls in — mirrors roster-validation's weekStartOf. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const mondayIndex = (d.getUTCDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  return new Date(d.getTime() - mondayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}
/** The 7 local dates Mon..Sun of the week starting at `monday`. */
function weekDays(monday: string): string[] {
  const base = Date.parse(`${monday}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(base + i * MS_PER_DAY).toISOString().slice(0, 10));
}
/** The local wall date of an instant + its offset (the roster-validation localDate convention). */
function localDate(instant: string, offsetMinutes: number): string {
  return new Date(Date.parse(instant) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

// handlers (inside the class):
async #onAddShift(e: CustomEvent<AddShiftDetail>): Promise<void> {
  e.stopPropagation();
  if (this.busy) return;
  this.busy = true; this.errorKey = null;
  try {
    let versionId = this.#draftVersionId;
    if (versionId === null) versionId = (await this.api.createRosterVersion(this.locationId, this.weekMonday)).versionId;
    await this.api.addShift(versionId, { ...e.detail, locationId: this.locationId });
    this.dialogOpen = false;
    await this.#loadRoster();
  } catch (error) {
    this.errorKey = (error as { code?: string }).code ?? "server.internal";
  } finally { this.busy = false; }
}

async #onPublish(): Promise<void> {
  const versionId = this.#draftVersionId;
  if (versionId === null || this.busy) return;
  this.busy = true; this.errorKey = null;
  try {
    this.breaches = (await this.api.publishRoster(versionId)).breaches;
    await this.#loadRoster();
  } catch (error) {
    this.errorKey = (error as { code?: string }).code ?? "server.internal";
  } finally { this.busy = false; }
}

override render(): TemplateResult {
  const days = weekDays(this.weekMonday);
  const editable = this.snapshot.version === null || this.snapshot.version.status === "draft";
  return html`
    <h1>${t("roster.title")}</h1>
    <label>${t("roster.location")}
      <select data-test="location-select" @change=${(e: Event) => void this.#onSelectLocation(e)}>
        ${this.locations.map((l) => html`<option value=${l.id} .selected=${l.id === this.locationId}>${l.name}</option>`)}
      </select>
    </label>
    <label>${t("roster.week")}
      <input type="date" data-test="week-picker" .value=${this.weekMonday} @change=${(e: Event) => void this.#onSelectWeek(e)} />
    </label>
    <table>
      <thead><tr><th scope="col">${t("roster.title")}</th>${days.map((d) => html`<th scope="col">${d}</th>`)}</tr></thead>
      <tbody>
        ${this.staff.map((person) => html`
          <tr data-test=${`row-${person.personId}`}>
            <th scope="row">${person.displayName}</th>
            ${days.map((day) => html`
              <td data-test=${`cell-${person.personId}-${day}`}
                  @click=${() => editable && this.openCell(person.personId, day)}>
                ${this.snapshot.shifts
                  .filter((s) => s.personId === person.personId && localDate(s.startsAt, s.startsOffsetMinutes) === day)
                  .map((s) => html`<span>${s.startsAt.slice(11, 16)}–${s.endsAt.slice(11, 16)}</span>`)}
              </td>`)}
          </tr>`)}
      </tbody>
    </table>
    ${this.#draftVersionId !== null
      ? html`<wt-button variant="primary" data-test="publish" ?disabled=${this.busy} @click=${() => void this.#onPublish()}>${t("roster.publish")}</wt-button>`
      : nothing}
    ${this.breaches.length > 0
      ? html`<div role="status" data-test="breaches"><p>${t("roster.breaches_intro")}</p><ul>${this.breaches.map((b) => html`<li>${breachKindName(b.kind)}</li>`)}</ul></div>`
      : nothing}
    ${this.errorKey ? html`<p role="alert" data-test="error">${codeMessage(this.errorKey)}</p>` : nothing}
    <dashboard-shift-dialog
      .open=${this.dialogOpen} .day=${this.dialogDay} .personId=${this.dialogPersonId}
      .shift=${this.dialogShift} .busy=${this.busy}
      @add-shift=${(e: CustomEvent<AddShiftDetail>) => void this.#onAddShift(e)}
      @update-shift=${(e: CustomEvent<UpdateShiftDetail>) => void this.#onUpdateShift(e)}
      @remove-shift=${(e: CustomEvent<{ shiftId: string }>) => void this.#onRemoveShift(e)}
      @wt-close=${() => (this.dialogOpen = false)}
    ></dashboard-shift-dialog>`;
}
```

  `openCell(personId, day)` sets `dialogPersonId`/`dialogDay`, `dialogShift = this.snapshot.shifts.find((s) => s.personId === personId && localDate(s.startsAt, s.startsOffsetMinutes) === day) ?? null`, and `dialogOpen = true`. `#onUpdateShift`/`#onRemoveShift` mirror `#onAddShift`'s single-flight + try/catch, calling `api.updateShift(e.detail.shiftId, e.detail.patch)` / `api.removeShift(e.detail.shiftId)` then `#loadRoster()`. Value-import `"../widgets/shift-dialog.js"` for its `@customElement` side effect (the widget-registration pattern). The exact chrome/grid styling is the visual companion's to refine (spec §3d) — keep the `<table>`/`<th scope>` semantics so axe passes.

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @waitron/dashboard test roster-screen.test`
Expected: PASS.

- [ ] **Step 6: Prove the single-flight by deletion** — remove the `if (this.busy) return; this.busy = true;` guard in `#onAddShift`; confirm the "files at most one create" test fails (addShift called twice). Restore; green.

- [ ] **Step 7: Wire the shell** — modify `dashboard-app.ts`: add `"roster"` to the `Screen` union (:21); a side-effect import `import "./screens/roster-screen.js";` (beside the others, :8-12); a nav `wt-button` (data-test `nav-roster`, label `t("nav.roster")`, `@click` → `this.screen = "roster"`); and a `#renderScreen` case returning `html\`<dashboard-roster-screen .api=${this.api}></dashboard-roster-screen>\``. Update `dashboard-app.test.ts`: add a failing assertion first (clicking `nav-roster` mounts `dashboard-roster-screen`), watch it fail, then implement. Mirror the existing nav-catalogue/nav-layout assertions in that file.

Run: `pnpm --filter @waitron/dashboard test dashboard-app`
Expected: PASS.

- [ ] **Step 8: Write + run the a11y test** — `roster-screen.a11y.test.ts`, mirroring `catalogue-screen.a11y.test.ts` (`describe.each(["light","dark"])`, `mountWidget("dashboard-roster-screen", { api: stubApi() }, theme)`, `flush`, `expectNoA11yViolations(host)`), in two shapes: an empty week (grid with no shifts) and a week with a draft + a couple of shifts. The dialog is left closed (its default) so it contributes nothing to the a11y tree.

Run: `pnpm --filter @waitron/dashboard test roster-screen`
Expected: PASS (behaviour + a11y).

- [ ] **Step 9: Gate + commit** — run the WHOLE dashboard package (cross-cutting; and coverage thresholds are `test:coverage`):

```bash
pnpm --filter @waitron/dashboard typecheck
pnpm --filter @waitron/dashboard test:coverage
git add apps/dashboard/src/screens/roster-screen.ts apps/dashboard/src/screens/roster-screen.test.ts apps/dashboard/src/screens/roster-screen.a11y.test.ts apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/codes.ts apps/dashboard/src/i18n/codes.test.ts apps/dashboard/src/i18n/domain.ts apps/dashboard/src/i18n/domain.test.ts
git commit -s -m "feat(dashboard): roster screen (week picker + person x day grid + publish)"
```

---

## Final verification (before the PR)

- [ ] Run the four-command gate over the whole workspace: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] Run coverage on every touched package (CI runs `test:coverage`, not `test`): `pnpm --filter @waitron/workforce --filter @waitron/identity --filter @waitron/server --filter @waitron/dashboard test:coverage`.
- [ ] Run the real-Postgres suites once with the flag: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test workforce-api.rls`.
- [ ] Confirm `pnpm install` left `pnpm-lock.yaml` committed (Task 6) — CI runs `--frozen-lockfile`.
- [ ] Confirm no migration was added: `git status packages/*/drizzle` is clean; the only `package.json`/lockfile change is the two `apps/server` deps.

---

## Spec-coverage self-review (traceability)

| Spec section | Task(s) |
| --- | --- |
| §3a `createRosterVersion` (+ `roster.draft_exists`) | 1 |
| §3a `getRoster` (and the publish route's version read) | 2 |
| §3a `addShift` (+ `shift.invalid`, `roster.not_draft`) | 3 |
| §3a `updateShift` / `removeShift` (reuse `shift.not_found`) | 4 |
| §3a barrel exports (new verbs' types) | 1-4 (`index.ts`, type-only) |
| §3b `schedule.manage` permission (manager + admin) | 5 |
| §3c `mountWorkforceApi` route group + `boot.ts` mount + UUID guards | 6-8 |
| §3c publish route resolves ruleset → `publishRoster` → breaches; `convenio.not_found` 4xx | 8 |
| §3d location resolution (gap-fill) | 6 (`GET /locations`) + 12 (picker) |
| §3d `DashboardApi` methods + browser-local shapes | 10 |
| §3d `<dashboard-roster-screen>` + week picker + person×day grid + shift dialog + publish/breach banner | 11-12 |
| §3d shell wiring (`Screen` union, nav, `#renderScreen`, import) | 12 |
| §3d i18n (`nav.roster`, `roster.*` strings; `roster.*`/`shift.*` codes; breach-kind + roster-status domain tokens, raw-value fallback) | 11-12 |
| §5 error handling (AppError → status via `createErrorBoundary`; breaches are success payload, not errors) | 6-8 |
| §6 testing (engine PGlite TDD; real-PG RLS + gate; publish-returns-breaches; dashboard browser + a11y both themes) | 1-12 |
| §7 deferred (swaps/absence/planned-vs-actual/generators) | out of scope — untouched |
| §8 parallel-safety (no migration) | Global constraint + Final verification |

**Deferred spec items (correctly out of scope, no task):** swap-approval (+ `swap.approve` + the two swap transitions), absence-approval (+ `absence.decide`), the planned-vs-actual view, template/availability generators (spec §7). None is implemented here.

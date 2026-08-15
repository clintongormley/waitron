# Workforce Roster Management — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the remaining roster-management engine behind the management dashboard — split-shift (jornada partida) authoring, manager approve/reject of shift swaps, manager approve/reject of absences, and a planned-vs-actual comparison view — by filling two small engine gaps (`decideSwap`, `getPlannedVsActual`) and wiring the already-shipped verbs through new routes and screens.

**Architecture:** Two new `@waitron/identity` permissions (`swap.approve`, `absence.decide`) → a workforce migration `0010` adding nullable `decided_by_person_id`/`decided_at` columns to `shift_swaps`/`absences` → three new `@waitron/workforce` verbs/read-models (`decideSwap` + `swap.not_decidable`, `listPendingSwaps`/`listPendingAbsences`, `getPlannedVsActual`) plus a decider extension of the existing `setAbsenceStatus` (all PGlite-tested) → five new `mountWorkforceApi` routes on `apps/server` behind a generalised `gated(sessionId, permission, fn)` helper (real-Postgres RLS/gate suite) → new `DashboardApi` methods and `<dashboard-approvals-screen>` + `<dashboard-planned-actual-screen>` in `apps/dashboard`, plus a pure-UI split-shift fix to `<dashboard-roster-screen>` (Lit + `@waitron/ui`, axe in both themes).

**Tech Stack:** TypeScript (pnpm workspace), Drizzle `sql` templates over PGlite + real Postgres (Testcontainers), Hono routes, Lit 3 + `@waitron/ui` primitives, Vitest (Node + Playwright browser), axe-core.

**Spec:** docs/superpowers/specs/2026-08-15-workforce-roster-management-slice2-design.md

## Global Constraints

- **TDD, always.** Failing test FIRST, run it, watch it fail for the right reason, minimal implementation, watch it pass, commit. Every guard is **proven by deletion** (remove the guard → the test goes red → restore it), and every negative control is confirmed to fail for the reason you think it does (CLAUDE.md §4).
- **Error codes name the DOMAIN concept, never the package** (`packages/shared/src/errors.ts`). Codes are **never renamed once shipped**. The one new code, `swap.not_decidable`, was grepped against its siblings (`swap.not_found` `errors.ts:120`, `swap.not_permitted` `errors.ts:126`) — both `swap.not_<x>`, so the shape matches. Every file that `throw new AppError(...)` imports its registry directly (`import "./errors.js"`); `shift-swaps.ts` already does (`shift-swaps.ts:6`).
- **One migration only — workforce `0010`.** It is an ordinary generated ALTER-TABLE ADD COLUMN + ADD CONSTRAINT migration, **not `--custom`**: FORCE RLS + the `FOR ALL … (tenant_id = current_tenant_id())` policy from `0008_scheduling_planning_rls.sql:21-41` are column-agnostic, and the table-level `GRANT SELECT, INSERT, UPDATE, DELETE … TO app_user` with no column list (`0008:45-52`) covers columns added later. No policy, FORCE, or grant statement is needed or added. If a task appears to need one, STOP and flag it — it changes the parallel-safety story (spec §5/§8).
- **No backwards-compatibility / data-migration code** (CLAUDE.md §3). Nothing is deployed; the new columns are nullable and start null on every existing row (there are none). Do not backfill.
- **Spanish schema tokens go in `SPANISH_WORDS`.** This slice adds NO new Spanish schema identifiers — `decided_by_person_id`/`decided_at` are English, matching `published_by_person_id`/`published_at`. Engine identifiers stay English (`packages/workforce` is scanned by the english-only guard). Dashboard user-facing Spanish copy is translation, not schema vocabulary (`apps/*` is exempt).
- **Coverage thresholds:** `@waitron/workforce` / `@waitron/identity` / `@waitron/server` are `98/98/98/95` (statements/lines/functions/branches); `@waitron/dashboard` is `95/95/90/88` (`apps/dashboard/vitest.config.ts:64-68`). CI shards and the pre-push hook gate on **`test:coverage`, not `test`** — run `pnpm --filter <pkg> test:coverage` before claiming green (CLAUDE.md §2).
- **Run each changed package UNFILTERED before believing a pass.** A name-filtered run does not load the package's tree-wide guards (`english-only`, `index.test.ts`'s export-surface pin, the fiscal `inmutabilidad` scan). After the engine changes, also run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — although no NEW tenant-scoped TABLE is added here (only columns on two tables that already carry FORCE RLS), that suite is the cross-package guard that would catch a regression (CLAUDE.md §2/§3/§4).
- **Real-Postgres suites require `TESTCONTAINERS_RYUK_DISABLED=true` locally** (CLAUDE.md §4) or they hang to the 180s hook timeout.
- **Every commit is `git commit -s`.** Feature work happens in this worktree (`waitron-feat-workforce-roster-management-slice2`), not the main checkout — do NOT create a worktree as part of this plan; it already exists.

---

## Resolved facts (read before starting)

1. **`swap.not_found` and `absence.not_found` already exist** (`errors.ts:120`, `errors.ts:110`). The genuinely NEW code is only **`swap.not_decidable`**. `shift.not_found` and the `roster.*` family already exist too. Reuse, do not re-declare.

2. **The `shift_swap_status` / `absence_status` enums already carry the terminal values.** `shift_swap_status` is `['requested','accepted','approved','rejected']` (`schema/shift-swaps.ts:13-18`); `absence_status` is `['requested','approved','rejected']` (`schema/absences.ts:31`). No enum migration is needed — `0007_scheduling_planning.sql:2-3` `CREATE`d both with these values. `decideSwap` transitions `accepted → approved | rejected` only; `setAbsenceStatus` accepts any `AbsenceStatus`.

3. **`index.test.ts` pins the exact RUNTIME export surface** (`packages/workforce/src/index.test.ts:6-43`, `Object.keys(api).sort()`). Adding the VALUE exports `decideSwap`, `listPendingSwaps`, `listPendingAbsences` to `index.ts` REQUIRES adding them to that array (Tasks 3 & 4), or the test goes red. Type-only exports (`DecideSwapInput`, `PendingSwapRow`, `PendingAbsenceRow`) do not appear in `Object.keys` and need no change there.

4. **The permission-matrix test's manager/admin loops are load-bearing** (`permissions.test.ts:21`, `:24`): `for (const p of PERMISSIONS) expect(roleHasPermission("manager"|"admin", p)).toBe(true)`. Appending `swap.approve`/`absence.decide` to `PERMISSIONS` but forgetting the `MANAGER` set turns those loops red — which is exactly why both codes must land in `MANAGER` too (`ALL`/admin picks them up from `PERMISSIONS`, `permissions.ts:41`). Do NOT add them to `staff`/`supervisor`. The names are pre-agreed in the file's own comment (`permissions.ts:19-20`).

5. **`gated` is currently `gated<T>(sessionId, fn)` and hard-codes `SCHEDULE_PERMISSION`** (`workforce-api.ts:110-118`). There are exactly **six** call sites to update when it becomes `gated(sessionId, permission, fn)`: `/locations` (`:124`), `GET /roster` (`:136`), `POST /roster` (`:149`), `POST …/shifts` (`:171`), `PATCH …/shifts/:shiftId` (`:208`), `DELETE …/shifts/:shiftId` (`:217`) — each passes `SCHEDULE_PERMISSION`. The publish route already composes inline (`:224-254`) and is untouched. The RLS suite (`workforce-api.rls.test.ts`) already exercises these routes, so a regression turns red.

6. **The dashboard client re-declares server shapes locally** (no `@waitron/*` runtime import — the browser-bundle rule, `client.ts:11-17,204-210`). New rows (`PendingSwap`, `PendingAbsence`, `PlannedVsActualRow`) are browser-local copies, exactly as `Shift`/`RosterSnapshot` are (`client.ts:212-286`).

7. **Split shifts already work end-to-end except the cell-click resolution.** `#renderCell` already `.filter`s every shift in a cell (`roster-screen.ts:456-462`), `addShift` has no per-(person,day) uniqueness (`clocking.ts:518-535`; `shifts` schema has no such constraint), and the dialog authors an add when `.shift` is null (`shift-dialog.ts:82-115`). The only blocker is `openCell`'s `.find` (first-match-only, `roster-screen.ts:255-265`). The fix is a pure-UI change (Task 7): pass the target shift explicitly.

---

## File Structure

**Create:**
- `packages/workforce/drizzle/0010_<name>.sql` (+ `meta/0010_snapshot.json`, `meta/_journal.json` updated) — generated by `drizzle-kit`, the two nullable decider columns + their FKs.
- `apps/dashboard/src/screens/approvals-screen.ts` + `.test.ts` + `.a11y.test.ts` — the manager approve/reject queues (accepted swaps + requested absences).
- `apps/dashboard/src/screens/planned-actual-screen.ts` + `.test.ts` + `.a11y.test.ts` — the planned-vs-actual table (location + week pickers).

**Modify:**
- `packages/identity/src/permissions.ts` + `permissions.test.ts` — `swap.approve` + `absence.decide`.
- `packages/workforce/src/schema/shift-swaps.ts` + `schema/absences.ts` — the two nullable decider columns + FKs.
- `packages/workforce/src/errors.ts` — the one new code `swap.not_decidable`.
- `packages/workforce/src/shift-swaps.ts` — `decideSwap` + `listPendingSwaps` + their input/row types.
- `packages/workforce/src/absences.ts` — extend `SetAbsenceStatusInput`/`setAbsenceStatus` for the decider + `listPendingAbsences`.
- `packages/workforce/src/clocking.ts` — `getPlannedVsActual` + private `plannedShiftsInPeriod`/`entriesForLocationInPeriod`.
- `packages/workforce/src/index.ts` — new value + type exports.
- `packages/workforce/src/index.test.ts` — the runtime export-name array + the two new FK-name assertions.
- `packages/workforce/src/shift-swaps.test.ts`, `absences.test.ts`, `scheduling.test.ts` — new PGlite tests (and the `setAbsenceStatus` call-site updates).
- `apps/server/src/workforce-api.ts` — generalise `gated`, two permission constants, three STATUS entries, `requireDecision`, five routes.
- `apps/server/src/workforce-api.test.ts` (PGlite route mechanics) + `workforce-api.rls.test.ts` (real-PG differential isolation + gates + decider-column receipt).
- `apps/dashboard/src/screens/roster-screen.ts` + `roster-screen.test.ts` — the split-shift `openCell` fix.
- `apps/dashboard/src/api/client.ts` + `client.test.ts` — the five new methods + browser-local row types.
- `apps/dashboard/src/dashboard-app.ts` + `dashboard-app.test.ts` + `dashboard-app.a11y.test.ts` — two new `Screen` members, nav, `#renderScreen`, imports.
- `apps/dashboard/src/i18n/strings.ts`, `codes.ts` + `codes.test.ts`, `domain.ts` + `domain.test.ts` — nav/UI copy, the new `swap.*`/`absence.*` code messages, and the absence-kind + swap/absence-status display names.

---

## Task 1: Identity — `swap.approve` + `absence.decide` permissions

**Files:**
- Modify: `packages/identity/src/permissions.ts`
- Test: `packages/identity/src/permissions.test.ts`

**Interfaces:**
- Consumes: `PERMISSIONS`, `roleHasPermission`, the `MANAGER`/`ALL` sets (`permissions.ts:7/35/41`).
- Produces: `"swap.approve"` and `"absence.decide"` added to the `Permission` union, held by `manager` + `admin` only.

- [ ] **Step 1: Write the failing test** — add a new `it` to `permissions.test.ts`, mirroring the `schedule.manage` block (`permissions.test.ts:35-43`):

```ts
it("grants swap.approve and absence.decide to manager and admin only (roster slice 2)", () => {
  // Two domain-named approval permissions (manager approve/reject of shift swaps and absences),
  // granted to exactly the roles that hold schedule.manage — manager and admin — and NEVER to staff
  // or supervisor, so the approval gate matches the roster-authoring gate.
  for (const p of ["swap.approve", "absence.decide"] as const) {
    expect(roleHasPermission("manager", p)).toBe(true);
    expect(roleHasPermission("admin", p)).toBe(true);
    expect(roleHasPermission("staff", p)).toBe(false);
    expect(roleHasPermission("supervisor", p)).toBe(false);
  }
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/identity test permissions`
Expected: FAIL — `roleHasPermission("manager", "swap.approve")` is `false` (the strings are not yet in `PERMISSIONS` or `MANAGER`), and TypeScript flags `"swap.approve"` as not assignable to `Permission`. (The `for (const p of PERMISSIONS)` manager/admin loops at `:21`/`:24` still pass here because the strings are not yet in `PERMISSIONS`.)

- [ ] **Step 3: Implement** — in `permissions.ts`, append to `PERMISSIONS` (after `schedule.manage`, `:21`):

```ts
  // Manager approve/reject of an ACCEPTED shift swap (@waitron/workforce decideSwap), from the
  // management dashboard's approvals screen. A domain-named APPROVAL permission beside schedule.manage;
  // granted to manager + admin (roster slice 2, 2026-08-15).
  "swap.approve",
  // Manager approve/reject of a REQUESTED absence (@waitron/workforce setAbsenceStatus), same screen.
  // Domain-named beside swap.approve; granted to manager + admin (roster slice 2, 2026-08-15).
  "absence.decide",
```

and add both to the `MANAGER` set (`:35-40`):

```ts
const MANAGER: ReadonlySet<Permission> = new Set([
  ...SUPERVISOR,
  "person.manage",
  "till.configure",
  "schedule.manage",
  "swap.approve",
  "absence.decide",
]);
```

(`ALL`/`admin` picks both up from `PERMISSIONS` automatically — no further edit.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/identity test permissions`
Expected: PASS (including the pre-existing manager/admin loops at `:21`/`:24`, which now cover the two new codes too).

- [ ] **Step 5: Prove the manager mapping is load-bearing** — temporarily remove `"swap.approve"` from the `MANAGER` set (leave it in `PERMISSIONS`); confirm BOTH the new test AND the existing manager loop (`:21`) go red. Restore; confirm green.

- [ ] **Step 6: Gate + commit**

```bash
pnpm --filter @waitron/identity typecheck && pnpm --filter @waitron/identity test:coverage
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts
git commit -s -m "feat(identity): add swap.approve + absence.decide permissions (manager + admin)"
```

---

## Task 2: Workforce migration `0010` — decider columns on `shift_swaps` + `absences`

**Files:**
- Modify: `packages/workforce/src/schema/shift-swaps.ts` (two nullable columns + FK)
- Modify: `packages/workforce/src/schema/absences.ts` (two nullable columns + FK)
- Modify: `packages/workforce/src/index.test.ts` (the two new FK-name assertions)
- Create (generated): `packages/workforce/drizzle/0010_<name>.sql` + `meta/0010_snapshot.json` + updated `meta/_journal.json`

**Interfaces:**
- Consumes: `foreignKey`, `timestamp`, `uuid` (`drizzle-orm/pg-core`, already imported in both schema files); `persons` (`@waitron/identity`, already imported in both); `getTableConfig` (`drizzle-orm/pg-core`, in `index.test.ts`).
- Produces: `shift_swaps.decided_by_person_id` / `decided_at`, `absences.decided_by_person_id` / `decided_at` (all nullable), plus FKs `shift_swaps_decided_by_person_fk` and `absences_decided_by_person_fk`, both `onDelete("restrict")`.

- [ ] **Step 1: Write the failing FK assertions** — in `index.test.ts`, extend the `shift_swaps` block (`:213-229`) to also assert the new FK, and add a checks/FK assertion to the `absences` block (`:167-176`):

In the `shift_swaps` `expect(fkNames).toEqual(expect.arrayContaining([...]))`, add:
```ts
        // roster slice 2: the manager who decided the swap (approve/reject).
        "shift_swaps_decided_by_person_fk",
```
In the `absences` `expect(fkNames).toEqual(expect.arrayContaining([...]))` (currently `["absences_tenant_fk", "absences_person_fk"]`), add:
```ts
      // roster slice 2: the manager who decided the absence (approve/reject).
      "absences_decided_by_person_fk",
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/workforce test index`
Expected: FAIL — the two new FK names are absent from the tables' `getTableConfig` output.

- [ ] **Step 3: Add the columns + FK to the schema** — in `schema/shift-swaps.ts`, add to the column object (after `status`, `:49`):

```ts
    /** The manager who decided this swap (approve/reject), recorded when the route supplies it; null
     * while the swap is still `requested`/`accepted`. Mirrors roster_versions.published_by_person_id. */
    decidedByPersonId: uuid("decided_by_person_id"),
    /** When the swap was decided; null until it is. Mirrors roster_versions.published_at. */
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
```

and add to the extraConfig array (beside the other person FKs, using the array `foreignKey({...})` form + `restrict`, matching `roster_versions_published_by_person_fk`):

```ts
    // restrict, not cascade: the manager who decided a swap must not be silently deletable.
    foreignKey({
      columns: [t.decidedByPersonId],
      foreignColumns: [persons.id],
      name: "shift_swaps_decided_by_person_fk",
    }).onDelete("restrict"),
```

In `schema/absences.ts`, add to the column object (after `note`, `:64`):

```ts
    /** The manager who decided this absence (approve/reject), recorded when the route supplies it;
     * null while the absence is still `requested`. Mirrors roster_versions.published_by_person_id. */
    decidedByPersonId: uuid("decided_by_person_id"),
    /** When the absence was decided; null until it is. */
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
```

and add to the extraConfig array (beside `absences_person_fk`):

```ts
    // restrict, not cascade: the manager who decided an absence must not be silently deletable.
    foreignKey({
      columns: [t.decidedByPersonId],
      foreignColumns: [persons.id],
      name: "absences_decided_by_person_fk",
    }).onDelete("restrict"),
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/workforce test index`
Expected: PASS — both new FK names now appear.

- [ ] **Step 5: Generate the migration** — run drizzle-kit against the workforce config:

```bash
pnpm --filter @waitron/workforce db:generate --name decider_columns
```

Expected: a new `packages/workforce/drizzle/0010_decider_columns.sql`, a `meta/0010_snapshot.json`, and `meta/_journal.json` gaining an `idx: 10` / `tag: "0010_decider_columns"` entry.

- [ ] **Step 6: Inspect the generated SQL — confirm it is ONLY add-column + add-constraint** — read `0010_decider_columns.sql`. It must contain exactly four `ALTER TABLE … ADD COLUMN "decided_by_person_id" uuid;` / `ADD COLUMN "decided_at" timestamp with time zone;` statements (two per table) and two `ALTER TABLE … ADD CONSTRAINT "<t>_decided_by_person_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict …`. It must contain **no** `CREATE POLICY`, `FORCE ROW LEVEL SECURITY`, `REVOKE`, `GRANT`, or `DROP` — those are the `--custom` 0008's job and drizzle-kit never regenerates them (`0008` header). If any appear, STOP and flag it (Global Constraints).

- [ ] **Step 7: Prove the migration applies cleanly** — run the migration + schema-ownership suites unfiltered enough to load them:

Run: `pnpm --filter @waitron/workforce test migrations schema-ownership`
Expected: PASS — the manifest/migration test applies `0000…0010` in order against a fresh PGlite database with no error; `schema-ownership` confirms the two tables still belong to this package's snapshot.

- [ ] **Step 8: Gate + commit** — run the WHOLE package unfiltered (its tree-wide guards) plus the cross-package fiscal scan:

```bash
pnpm --filter @waitron/workforce typecheck
pnpm --filter @waitron/workforce test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad
git add packages/workforce/src/schema/shift-swaps.ts packages/workforce/src/schema/absences.ts \
        packages/workforce/src/index.test.ts packages/workforce/drizzle/0010_decider_columns.sql \
        packages/workforce/drizzle/meta/0010_snapshot.json packages/workforce/drizzle/meta/_journal.json
git commit -s -m "feat(workforce): migration 0010 — decided_by_person_id/decided_at on shift_swaps + absences"
```

> **Receipt (spec §5):** that the table-level UPDATE grant reaches the new columns as the non-superuser `app_user` under FORCE RLS is PROVEN — not asserted — by the decide-verb real-Postgres tests in Task 6 (writing `decided_by_person_id`/`decided_at` as `app_user`; a grant that did not cover the column would raise `42501 permission denied for column` and turn the test red). The `persons`-FK write under FORCE RLS is already proven in the tree by `publishRoster` stamping `roster_versions.published_by_person_id` (`clocking.ts:632`).

---

## Task 3: Workforce — `decideSwap` + `swap.not_decidable` + `listPendingSwaps`

**Files:**
- Modify: `packages/workforce/src/errors.ts` (add `swap.not_decidable`)
- Modify: `packages/workforce/src/shift-swaps.ts` (`DecideSwapInput`, `decideSwap`, `PendingSwapRow`, `listPendingSwaps`)
- Modify: `packages/workforce/src/index.ts` (value + type exports)
- Modify: `packages/workforce/src/index.test.ts` (export-name array)
- Test: `packages/workforce/src/shift-swaps.test.ts`

**Interfaces:**
- Consumes: `Transaction` (`@waitron/db`); `AppError` (`@waitron/shared`); `ShiftSwapStatus` (`./schema/shift-swaps.js`); the PGlite `suite`/`run`/`codeOfRejection` harness + `insertShiftSwap`/`insertDraftShift`/`seedPerson`/`seedLocation` fixtures at the top of `shift-swaps.test.ts` (`insertShiftSwap` accepts a `status`, `fixtures.ts:210-230`).
- Produces:
  ```ts
  export interface DecideSwapInput {
    tenantId: string;
    swapId: string;
    decision: "approved" | "rejected";
    decidedByPersonId: string | null;
  }
  export interface PendingSwapRow {
    id: string;
    requestedByPersonId: string;
    fromShiftId: string;
    toPersonId: string;
    toShiftId: string | null;
    status: ShiftSwapStatus; // always "accepted" for this query
    createdAt: string;       // UTC ISO instant
  }
  export async function decideSwap(tx: Transaction, input: DecideSwapInput): Promise<void>;
  export async function listPendingSwaps(tx: Transaction, input: { tenantId: string }): Promise<PendingSwapRow[]>;
  // errors.ts: "swap.not_decidable": { tenantId: string; swapId: string }
  ```

- [ ] **Step 1: Write the failing tests** — append two `describe`s to `shift-swaps.test.ts` (the harness already imports `insertShiftSwap`, `insertDraftShift`, `seedPerson`, `seedLocation`):

```ts
describe("decideSwap", () => {
  async function acceptedSwap(): Promise<string> {
    const requester = await seedPerson(suite.db, tenantId, `req-${crypto.randomUUID()}`);
    const toPerson = await seedPerson(suite.db, tenantId, `to-${crypto.randomUUID()}`);
    const fromShift = await insertDraftShift(suite.db, { tenantId, personId: requester, locationId });
    return insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: fromShift,
      toPersonId: toPerson,
      status: "accepted",
    });
  }

  it("approves an accepted swap, stamping the decider and decided_at", async () => {
    const swapId = await acceptedSwap();
    const decider = await seedPerson(suite.db, tenantId, `mgr-${crypto.randomUUID()}`);
    await run((tx) =>
      decideSwap(tx, { tenantId, swapId, decision: "approved", decidedByPersonId: decider }),
    );
    const rows = await suite.db.execute<{
      status: string;
      decided_by_person_id: string | null;
      decided_at: string | null;
    }>(sql`select status, decided_by_person_id, decided_at from shift_swaps where id = ${swapId}`);
    expect(rows.rows[0]!.status).toBe("approved");
    expect(rows.rows[0]!.decided_by_person_id).toBe(decider);
    expect(rows.rows[0]!.decided_at).not.toBeNull();
  });

  it("rejects an accepted swap (decision 'rejected')", async () => {
    const swapId = await acceptedSwap();
    await run((tx) => decideSwap(tx, { tenantId, swapId, decision: "rejected", decidedByPersonId: null }));
    const rows = await suite.db.execute<{ status: string }>(
      sql`select status from shift_swaps where id = ${swapId}`,
    );
    expect(rows.rows[0]!.status).toBe("rejected");
  });

  it("throws swap.not_found for a swap that does not exist under the tenant", async () => {
    const code = await codeOfRejection(() =>
      run((tx) =>
        decideSwap(tx, {
          tenantId,
          swapId: crypto.randomUUID(),
          decision: "approved",
          decidedByPersonId: null,
        }),
      ),
    );
    expect(code).toBe("swap.not_found");
  });

  it("throws swap.not_decidable for a REQUESTED swap (not yet accepted)", async () => {
    const requester = await seedPerson(suite.db, tenantId, `r-${crypto.randomUUID()}`);
    const toPerson = await seedPerson(suite.db, tenantId, `t-${crypto.randomUUID()}`);
    const fromShift = await insertDraftShift(suite.db, { tenantId, personId: requester, locationId });
    const swapId = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: fromShift,
      toPersonId: toPerson,
      status: "requested",
    });
    const code = await codeOfRejection(() =>
      run((tx) => decideSwap(tx, { tenantId, swapId, decision: "approved", decidedByPersonId: null })),
    );
    expect(code).toBe("swap.not_decidable");
  });

  it("throws swap.not_decidable for an already-approved swap (terminal state)", async () => {
    const swapId = await acceptedSwap();
    await run((tx) => decideSwap(tx, { tenantId, swapId, decision: "approved", decidedByPersonId: null }));
    const code = await codeOfRejection(() =>
      run((tx) => decideSwap(tx, { tenantId, swapId, decision: "rejected", decidedByPersonId: null })),
    );
    expect(code).toBe("swap.not_decidable");
  });
});

describe("listPendingSwaps", () => {
  it("returns only accepted swaps for the tenant, ordered by created_at", async () => {
    const requester = await seedPerson(suite.db, tenantId, `lr-${crypto.randomUUID()}`);
    const toPerson = await seedPerson(suite.db, tenantId, `lt-${crypto.randomUUID()}`);
    const s1 = await insertDraftShift(suite.db, { tenantId, personId: requester, locationId });
    const s2 = await insertDraftShift(suite.db, { tenantId, personId: requester, locationId });
    const accepted = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: s1,
      toPersonId: toPerson,
      status: "accepted",
    });
    // A requested (not accepted) swap must NOT appear.
    await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: s2,
      toPersonId: toPerson,
      status: "requested",
    });
    const rows = await run((tx) => listPendingSwaps(tx, { tenantId }));
    expect(rows.map((r) => r.id)).toEqual([accepted]);
    expect(rows[0]!.status).toBe("accepted");
    expect(rows[0]!.requestedByPersonId).toBe(requester);
    expect(rows[0]!.fromShiftId).toBe(s1);
  });
});
```

Add `decideSwap, listPendingSwaps` to the top-of-file import from `./shift-swaps.js` (`shift-swaps.test.ts:8`).

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/workforce test shift-swaps`
Expected: FAIL — `decideSwap is not a function` / `listPendingSwaps is not a function`.

- [ ] **Step 3: Declare the code** — in `errors.ts`, inside the `declare module "@waitron/shared"` block, beside `swap.not_found`/`swap.not_permitted` (`:116-126`):

```ts
    /** `decideSwap` (../shift-swaps.ts) was asked to approve/reject a swap whose `status` is not
     * `accepted` — a `requested` swap has not been accepted yet, and an `approved`/`rejected` one is
     * terminal. Distinct from `swap.not_found` (no such swap); here it EXISTS but is not in a decidable
     * state, mirroring `roster.already_published` = exists-but-wrong-state (`errors.ts:72`). `swap.*`,
     * grepped against the two siblings (`swap.not_found`, `swap.not_permitted`) — both `swap.not_<x>`,
     * so the shape matches; never renamed once shipped. */
    "swap.not_decidable": { tenantId: string; swapId: string };
```

- [ ] **Step 4: Implement** — in `shift-swaps.ts`, add the `ShiftSwapStatus` type import (beside the existing imports at the top):

```ts
import type { ShiftSwapStatus } from "./schema/shift-swaps.js";
```

Add the input type + verb (beside `acceptSwap`):

```ts
/** A manager's decision on an ACCEPTED swap. */
export interface DecideSwapInput {
  tenantId: string;
  swapId: string;
  /** The manager's decision. Only these two — a decide never returns a swap to requested/accepted. */
  decision: "approved" | "rejected";
  /** The manager who decided, recorded on the swap; null when the caller does not attribute it
   *  (mirrors roster_versions.published_by_person_id — recorded when supplied, never required). */
  decidedByPersonId: string | null;
}

/**
 * A manager approves or rejects an ACCEPTED swap — the `accepted → approved | rejected` transition
 * (design §3a). Reads the swap's status under the tenant; throws `swap.not_found` if absent (never
 * created, or hidden by RLS) and the new `swap.not_decidable` if its status is not `accepted` (a
 * `requested` swap has not been accepted yet; an `approved`/`rejected` one is terminal). Otherwise
 * UPDATEs `status = decision`, `decided_by_person_id`, `decided_at = now()`. PLANNING data — a plain
 * status flip, no chain. Who MAY decide is the route's gate (`swap.approve`), not this verb's.
 */
export async function decideSwap(tx: Transaction, input: DecideSwapInput): Promise<void> {
  const { rows } = await tx.execute<{ status: ShiftSwapStatus }>(sql`
    select status from shift_swaps
    where tenant_id = ${input.tenantId} and id = ${input.swapId}
    limit 1`);
  const swap = rows[0];
  if (swap === undefined) {
    throw new AppError("swap.not_found", { tenantId: input.tenantId, swapId: input.swapId });
  }
  if (swap.status !== "accepted") {
    throw new AppError("swap.not_decidable", { tenantId: input.tenantId, swapId: input.swapId });
  }
  await tx.execute(sql`
    update shift_swaps
    set status = ${input.decision},
        decided_by_person_id = ${input.decidedByPersonId},
        decided_at = now()
    where tenant_id = ${input.tenantId} and id = ${input.swapId}`);
}
```

Add the list read model (same file):

```ts
/** One accepted-and-pending swap awaiting a manager decision (the approvals queue). */
export interface PendingSwapRow {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  /** Always `accepted` for this query, typed to the enum. */
  status: ShiftSwapStatus;
  /** UTC ISO instant (to_char-normalised, the getRoster pattern — node-postgres returns a Date, PGlite
   * a string; the cast pins both to a stable string). */
  createdAt: string;
}

/**
 * The tenant's ACCEPTED swaps awaiting a manager decision, ordered by `created_at`. Tenant-scoped, NOT
 * location-scoped: `shift_swaps` carries no `location_id` (`schema/shift-swaps.ts`) — the location
 * lives on the referenced shifts — so the queue is the whole tenant's accepted swaps (design §3a).
 */
export async function listPendingSwaps(
  tx: Transaction,
  input: { tenantId: string },
): Promise<PendingSwapRow[]> {
  const { rows } = await tx.execute<{
    id: string;
    requested_by_person_id: string;
    from_shift_id: string;
    to_person_id: string;
    to_shift_id: string | null;
    status: ShiftSwapStatus;
    created_at: string;
  }>(sql`
    select id, requested_by_person_id, from_shift_id, to_person_id, to_shift_id, status,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
    from shift_swaps
    where tenant_id = ${input.tenantId} and status = 'accepted'
    order by created_at`);
  return rows.map((r) => ({
    id: r.id,
    requestedByPersonId: r.requested_by_person_id,
    fromShiftId: r.from_shift_id,
    toPersonId: r.to_person_id,
    toShiftId: r.to_shift_id,
    status: r.status,
    createdAt: r.created_at,
  }));
}
```

In `index.ts`, extend the value export (`:29`) and add the type exports (`:30`):

```ts
export { requestSwap, acceptSwap, decideSwap, listPendingSwaps } from "./shift-swaps.js";
export type {
  RequestSwapInput,
  AcceptSwapInput,
  DecideSwapInput,
  PendingSwapRow,
} from "./shift-swaps.js";
```

In `index.test.ts`, add `"decideSwap"` and `"listPendingSwaps"` to the `"exports exactly the intended names"` array (`:8-42`, beside `"acceptSwap"`).

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @waitron/workforce test shift-swaps index`
Expected: PASS (both suites, incl. the export-surface pin).

- [ ] **Step 6: Prove both guards by deletion** — (a) remove the `if (swap === undefined) { throw … }` in `decideSwap` → the `swap.not_found` test fails (the read returns nothing and `swap.status` throws a TypeError instead of the AppError); (b) remove the `if (swap.status !== "accepted") { throw … }` → BOTH `swap.not_decidable` tests fail (the requested/approved swap is UPDATEd instead of refused). Restore both; confirm green. For `listPendingSwaps`, delete the `and status = 'accepted'` predicate → the "only accepted swaps" test fails (the requested swap leaks in). Restore.

- [ ] **Step 7: Gate + commit**

```bash
pnpm --filter @waitron/workforce typecheck && pnpm --filter @waitron/workforce test:coverage
git add packages/workforce/src/errors.ts packages/workforce/src/shift-swaps.ts \
        packages/workforce/src/index.ts packages/workforce/src/index.test.ts \
        packages/workforce/src/shift-swaps.test.ts
git commit -s -m "feat(workforce): decideSwap verb (+ swap.not_decidable) and listPendingSwaps"
```

---

## Task 4: Workforce — `setAbsenceStatus` decider extension + `listPendingAbsences`

**Files:**
- Modify: `packages/workforce/src/absences.ts` (extend `SetAbsenceStatusInput`/`setAbsenceStatus`; add `PendingAbsenceRow`/`listPendingAbsences`)
- Modify: `packages/workforce/src/index.ts` (value + type exports)
- Modify: `packages/workforce/src/index.test.ts` (export-name array)
- Test: `packages/workforce/src/absences.test.ts`

**Interfaces:**
- Consumes: `Transaction` (`@waitron/db`); `AppError` (`@waitron/shared`); `AbsenceKind`, `AbsenceStatus` (`./schema/absences.js`, already imported `absences.ts:4`); the PGlite `suite`/`run`/`codeOfRejection` harness + `insertAbsence`/`seedPerson` fixtures at the top of `absences.test.ts` (`insertAbsence` accepts `status`, `fixtures.ts:132-153`).
- Produces:
  ```ts
  export interface SetAbsenceStatusInput {
    tenantId: string;
    absenceId: string;
    status: AbsenceStatus;
    decidedByPersonId: string | null; // NEW
  }
  export interface PendingAbsenceRow {
    id: string;
    personId: string;
    kind: AbsenceKind;
    startsOn: string; // YYYY-MM-DD
    endsOn: string;
    status: AbsenceStatus; // always "requested" for this query
    note: string | null;
    createdAt: string;
  }
  export async function listPendingAbsences(tx: Transaction, input: { tenantId: string }): Promise<PendingAbsenceRow[]>;
  ```

- [ ] **Step 1: Write the failing tests** — update the existing `setAbsenceStatus` `describe` (`absences.test.ts:158-176`) to pass `decidedByPersonId` and assert the new columns, and add a `listPendingAbsences` `describe`:

```ts
describe("setAbsenceStatus", () => {
  it("moves a requested absence to approved and stamps the decider + decided_at", async () => {
    const id = await insertAbsence(suite.db, { tenantId, personId });
    const decider = await seedPerson(suite.db, tenantId, `mgr-${crypto.randomUUID()}`);
    await run((tx) =>
      setAbsenceStatus(tx, { tenantId, absenceId: id, status: "approved", decidedByPersonId: decider }),
    );
    const rows = await suite.db.execute<{
      status: string;
      decided_by_person_id: string | null;
      decided_at: string | null;
    }>(sql`select status, decided_by_person_id, decided_at from absences where id = ${id}`);
    expect(rows.rows[0]!.status).toBe("approved");
    expect(rows.rows[0]!.decided_by_person_id).toBe(decider);
    expect(rows.rows[0]!.decided_at).not.toBeNull();
  });

  it("throws absence.not_found for an absence that does not exist under the tenant", async () => {
    const code = await codeOfRejection(() =>
      run((tx) =>
        setAbsenceStatus(tx, {
          tenantId,
          absenceId: crypto.randomUUID(),
          status: "rejected",
          decidedByPersonId: null,
        }),
      ),
    );
    expect(code).toBe("absence.not_found");
  });
});

describe("listPendingAbsences", () => {
  it("returns only requested absences for the tenant, ordered by created_at", async () => {
    const p = await seedPerson(suite.db, tenantId, `la-${crypto.randomUUID()}`);
    const requested = await insertAbsence(suite.db, {
      tenantId,
      personId: p,
      kind: "sick_leave",
      startsOn: "2026-06-01",
      endsOn: "2026-06-03",
      status: "requested",
      note: "flu",
    });
    // An already-approved absence must NOT appear.
    await insertAbsence(suite.db, {
      tenantId,
      personId: p,
      startsOn: "2026-07-01",
      endsOn: "2026-07-02",
      status: "approved",
    });
    const rows = await run((tx) => listPendingAbsences(tx, { tenantId }));
    expect(rows.map((r) => r.id)).toEqual([requested]);
    expect(rows[0]!.status).toBe("requested");
    expect(rows[0]!.personId).toBe(p);
    expect(rows[0]!.kind).toBe("sick_leave");
    expect(rows[0]!.startsOn).toBe("2026-06-01");
    expect(rows[0]!.endsOn).toBe("2026-06-03");
    expect(rows[0]!.note).toBe("flu");
  });
});
```

Add `listPendingAbsences` to the top-of-file import from `./absences.js` (`absences.test.ts:8`).

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/workforce test absences`
Expected: FAIL — TypeScript flags the missing `decidedByPersonId` on `SetAbsenceStatusInput`, and `listPendingAbsences is not a function`.

- [ ] **Step 3: Implement** — in `absences.ts`, extend the input (`:22-27`):

```ts
/** A request to move an existing absence to a decided status. */
export interface SetAbsenceStatusInput {
  tenantId: string;
  absenceId: string;
  status: AbsenceStatus;
  /** The manager who decided, recorded on the absence; null when unattributed (mirrors
   * roster_versions.published_by_person_id — recorded when supplied, never required). NEW field. */
  decidedByPersonId: string | null;
}
```

extend the verb's UPDATE (`:69-83`) to stamp the decider (the `absence.not_found` guard is unchanged):

```ts
export async function setAbsenceStatus(
  tx: Transaction,
  input: SetAbsenceStatusInput,
): Promise<void> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    update absences
    set status = ${input.status},
        decided_by_person_id = ${input.decidedByPersonId},
        decided_at = now()
    where tenant_id = ${input.tenantId} and id = ${input.absenceId}
    returning id`);
  if (rows.length === 0) {
    throw new AppError("absence.not_found", {
      tenantId: input.tenantId,
      absenceId: input.absenceId,
    });
  }
}
```

add the list read model (same file):

```ts
/** One requested absence awaiting a manager decision (the approvals queue). */
export interface PendingAbsenceRow {
  id: string;
  personId: string;
  kind: AbsenceKind;
  /** YYYY-MM-DD, inclusive (::text cast, the getRoster date pattern). */
  startsOn: string;
  endsOn: string;
  /** Always `requested` for this query. */
  status: AbsenceStatus;
  note: string | null;
  createdAt: string;
}

/**
 * The tenant's REQUESTED absences awaiting a manager decision, ordered by `created_at` (design §3b).
 * Tenant-scoped — `absences` has no location.
 */
export async function listPendingAbsences(
  tx: Transaction,
  input: { tenantId: string },
): Promise<PendingAbsenceRow[]> {
  const { rows } = await tx.execute<{
    id: string;
    person_id: string;
    absence_kind: AbsenceKind;
    starts_on: string;
    ends_on: string;
    status: AbsenceStatus;
    note: string | null;
    created_at: string;
  }>(sql`
    select id, person_id, absence_kind, starts_on::text as starts_on, ends_on::text as ends_on, status, note,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
    from absences
    where tenant_id = ${input.tenantId} and status = 'requested'
    order by created_at`);
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    kind: r.absence_kind,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
  }));
}
```

In `index.ts`, extend the value export (`:27`) and add the type export (`:28`):

```ts
export { createAbsence, setAbsenceStatus, listPendingAbsences } from "./absences.js";
export type { CreateAbsenceInput, SetAbsenceStatusInput, PendingAbsenceRow } from "./absences.js";
```

In `index.test.ts`, add `"listPendingAbsences"` to the export-name array (beside `"setAbsenceStatus"`).

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/workforce test absences index`
Expected: PASS (both suites).

- [ ] **Step 5: Prove the guard by deletion** — delete the `if (rows.length === 0) { throw … }` in `setAbsenceStatus` → the `absence.not_found` test fails (the no-op UPDATE returns silently). For `listPendingAbsences`, delete the `and status = 'requested'` predicate → the "only requested" test fails (the approved absence leaks in). Restore both; confirm green.

- [ ] **Step 6: Gate + commit**

```bash
pnpm --filter @waitron/workforce typecheck && pnpm --filter @waitron/workforce test:coverage
git add packages/workforce/src/absences.ts packages/workforce/src/index.ts \
        packages/workforce/src/index.test.ts packages/workforce/src/absences.test.ts
git commit -s -m "feat(workforce): setAbsenceStatus decider extension + listPendingAbsences"
```

---

## Task 5: Workforce — `getPlannedVsActual` read model + two private helpers

**Files:**
- Modify: `packages/workforce/src/clocking.ts` (`getPlannedVsActual` + private `plannedShiftsInPeriod`/`entriesForLocationInPeriod`; import `comparePlannedVsActual`/`PlannedVsActual`)
- Test: `packages/workforce/src/scheduling.test.ts`

**Interfaces:**
- Consumes: `WorkforceBackend` (`clocking.ts:213`); the already-imported `Period`, `PlannedShift`, `TimeEntryRecord`, `projectWorkSessions` (`clocking.ts:6-21`), the module-private `shiftDay` (`clocking.ts:1016`) and `timeEntries` table (`clocking.ts:5`); `comparePlannedVsActual`/`PlannedVsActual` from `./planned-vs-actual.js` (NEW import); the PGlite `suite`/`run` harness + `insertDraftShift`/`insertRosterVersion`/`insertTimeEntry`/`seedLocation`/`seedPerson` fixtures. `insertTimeEntry` appends one clock event through the chain (`fixtures.ts:238-258`), so an `in`+`out` pair makes one `WorkSession`.
- Produces:
  ```ts
  // WorkforceBackend method:
  getPlannedVsActual(tx: Transaction, query: { tenantId: string; locationId: string; period: Period }): Promise<PlannedVsActual[]>;
  ```
  `PlannedVsActual` = `{ personId; workDate; plannedMinutes; workedMinutes; lateMinutes; noShow; unplanned }` (`planned-vs-actual.ts:20-35`). No barrel change beyond the method being on the already-exported `WorkforceBackend`.

- [ ] **Step 1: Write the failing tests** — append a `describe` to `scheduling.test.ts`, and add `insertTimeEntry` to its fixtures import (`scheduling.test.ts:11-17`; `insertRosterVersion`/`seedLocation`/`seedPerson`/`insertDraftShift` are already imported, `Period` is not needed — the object is structural). Because the planned side counts only PUBLISHED shifts (owner decision 2026-08-15), each test that asserts `plannedMinutes` publishes its shift via `publishRoster`, on a FRESH location so publish (one published version per (location, period), attaching every in-period null-version shift at the location) does not couple across the shared PGlite db:

```ts
describe("getPlannedVsActual", () => {
  const week = { start: "2026-03-02", end: "2026-03-09" }; // Mon..Sun, half-open
  // A worked session = an `in` + `out` pair appended through the chain (fixtures.insertTimeEntry).
  async function seedSession(person: string, loc: string, inAt: string, outAt: string): Promise<void> {
    await insertTimeEntry(suite.db, { tenantId, personId: person, locationId: loc, entryKind: "in", eventAt: inAt });
    await insertTimeEntry(suite.db, { tenantId, personId: person, locationId: loc, entryKind: "out", eventAt: outAt });
  }
  // Publish a new version at `loc` for the test's week — `publishRoster` attaches every in-period
  // null-version draft shift AT `loc`, so the planned side (published-only) then sees them.
  async function publishWeek(loc: string): Promise<void> {
    const versionId = await insertRosterVersion(suite.db, {
      tenantId, locationId: loc, periodStart: week.start, periodEnd: "2026-03-08",
    });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
  }

  it("matches a PUBLISHED planned shift to its worked session, and reports late minutes", async () => {
    const loc = await seedLocation(suite.db, tenantId);
    const p = await seedPerson(suite.db, tenantId, `pva-${crypto.randomUUID()}`);
    await insertDraftShift(suite.db, {
      tenantId, personId: p, locationId: loc,
      startsAt: "2026-03-02T09:00:00Z", endsAt: "2026-03-02T13:00:00Z",
    });
    await publishWeek(loc); // the shift is now on a published version
    // Clocked in 15 min late, worked to 13:00 → 225 worked minutes, lateMinutes 15.
    await seedSession(p, loc, "2026-03-02T09:15:00Z", "2026-03-02T13:00:00Z");
    const rows = await run((tx) => backend.getPlannedVsActual(tx, { tenantId, locationId: loc, period: week }));
    const row = rows.find((r) => r.personId === p && r.workDate === "2026-03-02")!;
    expect(row.plannedMinutes).toBe(240);
    expect(row.workedMinutes).toBe(225);
    expect(row.lateMinutes).toBe(15);
    expect(row.noShow).toBe(false);
    expect(row.unplanned).toBe(false);
  });

  it("flags a no-show (published shift, not worked) and an unplanned day (worked, not planned)", async () => {
    const loc = await seedLocation(suite.db, tenantId);
    const noShowPerson = await seedPerson(suite.db, tenantId, `ns-${crypto.randomUUID()}`);
    await insertDraftShift(suite.db, {
      tenantId, personId: noShowPerson, locationId: loc,
      startsAt: "2026-03-03T09:00:00Z", endsAt: "2026-03-03T17:00:00Z",
    });
    await publishWeek(loc);
    const unplannedPerson = await seedPerson(suite.db, tenantId, `up-${crypto.randomUUID()}`);
    await seedSession(unplannedPerson, loc, "2026-03-04T09:00:00Z", "2026-03-04T12:00:00Z");
    const rows = await run((tx) => backend.getPlannedVsActual(tx, { tenantId, locationId: loc, period: week }));
    const noShow = rows.find((r) => r.personId === noShowPerson)!;
    expect(noShow.noShow).toBe(true);
    expect(noShow.workedMinutes).toBe(0);
    const unplanned = rows.find((r) => r.personId === unplannedPerson)!;
    expect(unplanned.unplanned).toBe(true);
    expect(unplanned.plannedMinutes).toBe(0);
  });

  it("counts only the PUBLISHED version's shifts — excludes drafts and superseded versions", async () => {
    // Owner decision (2026-08-15): "planned" = the currently-published roster, so an in-progress draft
    // and a retired (superseded) version must NOT manufacture phantom no-shows.
    const loc = await seedLocation(suite.db, tenantId);
    const p = await seedPerson(suite.db, tenantId, `pub-${crypto.randomUUID()}`);
    // Version A: a shift on 2026-03-02, published.
    await insertDraftShift(suite.db, {
      tenantId, personId: p, locationId: loc,
      startsAt: "2026-03-02T09:00:00Z", endsAt: "2026-03-02T13:00:00Z",
    });
    await publishWeek(loc);
    // Version B: a NEW shift on 2026-03-03, published for the SAME (location, period) → B supersedes A.
    // publishWeek attaches only null-version in-period shifts, so B gets 03-03 (03-02 is now on A).
    await insertDraftShift(suite.db, {
      tenantId, personId: p, locationId: loc,
      startsAt: "2026-03-03T09:00:00Z", endsAt: "2026-03-03T17:00:00Z",
    });
    await publishWeek(loc);
    // A standalone DRAFT shift on 2026-03-04 (roster_version_id null) — never published (inserted AFTER
    // the last publish, so publishRoster never attaches it).
    await insertDraftShift(suite.db, {
      tenantId, personId: p, locationId: loc,
      startsAt: "2026-03-04T09:00:00Z", endsAt: "2026-03-04T17:00:00Z",
    });
    const rows = await run((tx) => backend.getPlannedVsActual(tx, { tenantId, locationId: loc, period: week }));
    // Only 03-03 (version B, published) is planned; 03-02 (superseded A) and 03-04 (draft) are not.
    const plannedDays = rows.filter((r) => r.personId === p && r.plannedMinutes > 0).map((r) => r.workDate);
    expect(plannedDays).toEqual(["2026-03-03"]);
  });

  it("excludes a session whose local day is OUTSIDE the window, includes one inside", async () => {
    const loc = await seedLocation(suite.db, tenantId);
    const p = await seedPerson(suite.db, tenantId, `bound-${crypto.randomUUID()}`);
    // One day BEFORE the window (2026-03-01) — must be excluded even though the widened fetch grabs it.
    await seedSession(p, loc, "2026-03-01T09:00:00Z", "2026-03-01T12:00:00Z");
    // The last in-window day (2026-03-08) — included.
    await seedSession(p, loc, "2026-03-08T09:00:00Z", "2026-03-08T12:00:00Z");
    const rows = await run((tx) => backend.getPlannedVsActual(tx, { tenantId, locationId: loc, period: week }));
    const days = rows.filter((r) => r.personId === p).map((r) => r.workDate);
    expect(days).toEqual(["2026-03-08"]);
  });

  it("scopes to the queried location — another location's published shifts and entries do not leak in", async () => {
    const loc = await seedLocation(suite.db, tenantId);
    const other = await seedLocation(suite.db, tenantId);
    const p = await seedPerson(suite.db, tenantId, `scope-${crypto.randomUUID()}`);
    await insertDraftShift(suite.db, {
      tenantId, personId: p, locationId: other,
      startsAt: "2026-03-05T09:00:00Z", endsAt: "2026-03-05T13:00:00Z",
    });
    await publishWeek(other);
    await seedSession(p, other, "2026-03-05T09:00:00Z", "2026-03-05T13:00:00Z");
    const rows = await run((tx) => backend.getPlannedVsActual(tx, { tenantId, locationId: loc, period: week }));
    expect(rows.filter((r) => r.personId === p)).toEqual([]);
  });

  it("returns [] for a window with no shifts and no sessions", async () => {
    const loc = await seedLocation(suite.db, tenantId);
    const rows = await run((tx) =>
      backend.getPlannedVsActual(tx, { tenantId, locationId: loc, period: { start: "2026-12-07", end: "2026-12-14" } }),
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: FAIL — `backend.getPlannedVsActual is not a function`.

- [ ] **Step 3: Implement** — in `clocking.ts`, add the NEW import (after the `roster-validation.js` import, `:21`):

```ts
import { comparePlannedVsActual, type PlannedVsActual } from "./planned-vs-actual.js";
```

Add the method to `WorkforceBackend` (beside `workSummary`, `:258`) + the two private helpers. `plannedShiftsInPeriod` uses a raw `sql` template with an explicit INNER JOIN — the idiom the sibling `attachedShifts` / `publishRoster` shift-attach (`clocking.ts:651-660`) / `shiftForWrite` (`:575-583`) already use in this file — because the offset-aware local-date and `to_char` expressions need raw SQL fragments anyway; every table/column name below (`shifts`, `roster_versions`, `roster_version_id`, `status`, `starts_at`, `starts_offset_minutes`, `person_id`, `tenant_id`, `location_id`) was read from `schema/shifts.ts` / `schema/roster-versions.ts`, not invented:

```ts
/**
 * The planned-vs-actual read model for one location over a half-open local-date window (design §3c):
 * assembles the PLANNED shifts (the currently-PUBLISHED roster version) and the ACTUAL projected work
 * sessions for the location, both scoped to the same location, and hands them to the pure
 * `comparePlannedVsActual`. One row per matched or unmatched (person, local day) — planned vs worked
 * minutes, lateness, and the no-show/unplanned flags. A window with no shifts and no sessions is an
 * empty array, not an error.
 */
async getPlannedVsActual(
  tx: Transaction,
  query: { tenantId: string; locationId: string; period: Period },
): Promise<PlannedVsActual[]> {
  const plannedShifts = await this.plannedShiftsInPeriod(
    tx,
    query.tenantId,
    query.locationId,
    query.period,
  );
  const entries = await this.entriesForLocationInPeriod(
    tx,
    query.tenantId,
    query.locationId,
    query.period,
  );
  // The ±1-day widened fetch can return a session one local day outside the window; keep only the
  // sessions whose LOCAL day is in [start, end) (the planned side is already exact — its SQL filters
  // by local date directly).
  const sessions = projectWorkSessions(entries).filter(
    (s) => s.workDate >= query.period.start && s.workDate < query.period.end,
  );
  return comparePlannedVsActual(plannedShifts, sessions);
}

/** The location's shifts on the currently-PUBLISHED roster version whose LOCAL wall date falls in
 * `[period.start, period.end)`, as neutral `PlannedShift`s. Mirrors `attachedShifts` but keyed on
 * `location_id` + a local-date window + `roster_versions.status = 'published'` (an INNER JOIN on
 * `shifts.roster_version_id`) instead of a single `roster_version_id`. Published-only is the owner
 * decision (2026-08-15): an in-progress DRAFT (`shifts.roster_version_id` null → dropped by the INNER
 * JOIN, `schema/shifts.ts:49-50`) and a SUPERSEDED version (`status <> 'published'` → dropped by the
 * filter, `schema/roster-versions.ts:32-36`) must not manufacture phantom no-shows. The
 * `roster_versions_published_period_uq` partial unique index (`schema/roster-versions.ts:108-110`)
 * keeps at most one published version per (tenant, location, period), so the join yields a single
 * coherent plan. The `starts_at + starts_offset_minutes` → local date expression is offset-aware
 * (offset 0 in this slice, so local = UTC) and matches publishRoster's shift-attach; `to_char`
 * normalises the instants to UTC ISO so the pure comparator's `Date.parse` sees a string under either
 * driver. */
private async plannedShiftsInPeriod(
  tx: Transaction,
  tenantId: string,
  locationId: string,
  period: Period,
): Promise<PlannedShift[]> {
  const { rows } = await tx.execute<{
    id: string;
    person_id: string;
    starts_at: string;
    starts_offset_minutes: number;
    ends_at: string;
    ends_offset_minutes: number;
  }>(sql`
    select s.id, s.person_id,
      to_char(s.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
      s.starts_offset_minutes,
      to_char(s.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at,
      s.ends_offset_minutes
    from shifts s
    join roster_versions rv on rv.id = s.roster_version_id and rv.tenant_id = s.tenant_id
    where s.tenant_id = ${tenantId} and s.location_id = ${locationId}
      and rv.status = 'published'
      and (s.starts_at at time zone 'UTC' + s.starts_offset_minutes * interval '1 minute')::date >= ${period.start}::date
      and (s.starts_at at time zone 'UTC' + s.starts_offset_minutes * interval '1 minute')::date < ${period.end}::date`);
  return rows.map((r) => ({
    shiftId: r.id,
    personId: r.person_id,
    startsAt: r.starts_at,
    startsOffsetMinutes: r.starts_offset_minutes,
    endsAt: r.ends_at,
    endsOffsetMinutes: r.ends_offset_minutes,
  }));
}

/** The location's `time_entries` over a ±1-day-widened UTC window, for ALL persons. Mirrors
 * `entriesInPeriod` but filters on `location_id` (not one person — which is why this is a new helper,
 * not a reuse) and applies the same ±1-day widening so a session whose LOCAL day is inside is not
 * missed. Corrections are fetched alongside base events (no `entry_kind` filter) so
 * `projectWorkSessions` can fold them in. */
private async entriesForLocationInPeriod(
  tx: Transaction,
  tenantId: string,
  locationId: string,
  period: Period,
): Promise<TimeEntryRecord[]> {
  const windowStart = shiftDay(period.start, -1);
  const windowEnd = shiftDay(period.end, 1);
  const rows = await tx
    .select({
      entryId: timeEntries.id,
      personId: timeEntries.personId,
      locationId: timeEntries.locationId,
      entryKind: timeEntries.entryKind,
      eventAt: sql<string>`to_char(${timeEntries.eventAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      offsetMinutes: timeEntries.eventOffsetMinutes,
      ingestSeq: timeEntries.ingestSeq,
      sequenceNo: timeEntries.sequenceNo,
      correctsEntryId: timeEntries.correctsEntryId,
      correctionStatus: timeEntries.correctionStatus,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.tenantId, tenantId),
        eq(timeEntries.locationId, locationId),
        gte(timeEntries.eventAt, windowStart),
        lt(timeEntries.eventAt, windowEnd),
      ),
    );
  return rows;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @waitron/workforce test scheduling`
Expected: PASS (all six).

- [ ] **Step 5: Prove the window, scoping AND published-only filters are load-bearing** — restore each after confirming red:
  - (a) In `getPlannedVsActual`, delete the `.filter((s) => s.workDate >= … && s.workDate < …)` → the "excludes a session … OUTSIDE the window" test fails (the 2026-03-01 session leaks in).
  - (b) In `entriesForLocationInPeriod`, replace `eq(timeEntries.locationId, locationId)` with the tenant-only filter → the "scopes to the queried location" test fails (the other location's session leaks in).
  - (c) In `plannedShiftsInPeriod`, drop the `s.location_id = ${locationId}` predicate → the same scoping test fails on the planned side.
  - (d) In `plannedShiftsInPeriod`, change the INNER `join roster_versions rv …` to `left join` → the "counts only the PUBLISHED version's shifts" test fails because the standalone DRAFT shift (2026-03-04, `roster_version_id` null) now matches and leaks in (`plannedDays` gains `2026-03-04`). This proves the INNER JOIN is what drops drafts.
  - (e) In `plannedShiftsInPeriod`, remove the `and rv.status = 'published'` predicate → the SAME test fails because the SUPERSEDED version A's shift (2026-03-02) now leaks in (`plannedDays` gains `2026-03-02`) — note the draft does NOT leak here (the INNER JOIN still drops null `roster_version_id`), so (d) and (e) target different rows, confirming each guard drops what it is meant to.

  Confirm each negative control fails for the reason stated (CLAUDE.md §4), then restore all five and confirm green.

- [ ] **Step 6: Gate + commit** — this closes the engine; run the WHOLE package unfiltered (cross-cutting guards, CLAUDE.md §2/§4):

```bash
pnpm --filter @waitron/workforce typecheck
pnpm --filter @waitron/workforce test:coverage
git add packages/workforce/src/clocking.ts packages/workforce/src/scheduling.test.ts
git commit -s -m "feat(workforce): getPlannedVsActual read model (planned + actual assembly)"
```

---

## Task 6: Server — approve/reject + planned-vs-actual routes on `mountWorkforceApi`

**Files:**
- Modify: `apps/server/src/workforce-api.ts` (generalise `gated`; `SWAP_APPROVE_PERMISSION`/`ABSENCE_DECIDE_PERMISSION`; three STATUS entries; `requireDecision`; five routes; new value imports)
- Modify: `apps/server/src/workforce-api.test.ts` (in-process PGlite route mechanics)
- Modify: `apps/server/src/workforce-api.rls.test.ts` (real-Postgres differential isolation + gates + decider-column receipt)

**Interfaces:**
- Consumes: `asAppUser`, `withTenant`, `Transaction` (`@waitron/db`); `authorizeManager`, `Permission` (`@waitron/identity`); `WorkforceBackend`, `decideSwap`, `listPendingSwaps`, `setAbsenceStatus`, `listPendingAbsences` (`@waitron/workforce`); the existing `run`/`requireUuidParam`/`requirePeriod`/`requireManagementSession`/`createErrorBoundary` scaffolding (`workforce-api.ts`). `authorizeManager` returns `{ authorizedBy }` (`workforce-api.ts:233`, `manager-login.ts:46`).
- Produces: five routes —
  | Route | Gate | Body / query | Returns |
  | --- | --- | --- | --- |
  | `GET /management-api/swaps` | `swap.approve` | — | `PendingSwapRow[]` |
  | `POST /management-api/swaps/:swapId/decide` | `swap.approve` | `{ decision }` | `204` |
  | `GET /management-api/absences` | `absence.decide` | — | `PendingAbsenceRow[]` |
  | `POST /management-api/absences/:absenceId/decide` | `absence.decide` | `{ decision }` | `204` |
  | `GET /management-api/planned-vs-actual?locationId=&from=&to=` | `schedule.manage` | — | `PlannedVsActual[]` |

- [ ] **Step 1: Write the failing PGlite route tests** — append two `describe`s to `workforce-api.test.ts` (the harness's `mountApp`/`send`/seed already give a `managerCookie`, `staffCookie`, `locationId`, `personId`, `tenantId`). Seed the fixtures inline via `withTenant`/`asAppUser`:

```ts
describe("mountWorkforceApi — swap + absence approvals", () => {
  async function seedAcceptedSwap(): Promise<string> {
    return withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const shift = await tx.execute<{ id: string }>(sql`
        insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes, ends_at, ends_offset_minutes)
        values (current_tenant_id(), ${personId}, ${locationId}, '2026-03-02T09:00:00Z', 0, '2026-03-02T13:00:00Z', 0)
        returning id`);
      const swap = await tx.execute<{ id: string }>(sql`
        insert into shift_swaps (tenant_id, requested_by_person_id, from_shift_id, to_person_id, status)
        values (current_tenant_id(), ${personId}, ${shift.rows[0]!.id}, ${personId}, 'accepted') returning id`);
      return swap.rows[0]!.id;
    });
  }
  async function seedRequestedAbsence(): Promise<string> {
    return withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const r = await tx.execute<{ id: string }>(sql`
        insert into absences (tenant_id, person_id, absence_kind, starts_on, ends_on)
        values (current_tenant_id(), ${personId}, 'holiday', '2026-03-02', '2026-03-04') returning id`);
      return r.rows[0]!.id;
    });
  }

  it("GET /management-api/swaps lists the tenant's accepted swaps", async () => {
    const swapId = await seedAcceptedSwap();
    const res = await send(mountApp(), "GET", "/management-api/swaps");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; status: string }[];
    expect(rows.map((r) => r.id)).toContain(swapId);
    expect(rows.every((r) => r.status === "accepted")).toBe(true);
  });

  it("POST /management-api/swaps/:id/decide approves an accepted swap (204)", async () => {
    const swapId = await seedAcceptedSwap();
    const res = await send(mountApp(), "POST", `/management-api/swaps/${swapId}/decide`, {
      body: { decision: "approved" },
    });
    expect(res.status).toBe(204);
    // No longer pending.
    const list = await send(mountApp(), "GET", "/management-api/swaps");
    expect(((await list.json()) as { id: string }[]).map((r) => r.id)).not.toContain(swapId);
  });

  it("404s a decide on an unknown swap (swap.not_found)", async () => {
    const res = await send(
      mountApp(),
      "POST",
      "/management-api/swaps/00000000-0000-0000-0000-000000000000/decide",
      { body: { decision: "approved" } },
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_found" },
    });
  });

  it("409s a decide on a non-accepted swap (swap.not_decidable)", async () => {
    const swapId = await seedAcceptedSwap();
    await send(mountApp(), "POST", `/management-api/swaps/${swapId}/decide`, {
      body: { decision: "approved" },
    });
    const again = await send(mountApp(), "POST", `/management-api/swaps/${swapId}/decide`, {
      body: { decision: "rejected" },
    });
    expect(again.status).toBe(409);
    expect((await again.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "swap.not_decidable" },
    });
  });

  it("400s a bad decision body (management.request_invalid, never an enum 500)", async () => {
    const swapId = await seedAcceptedSwap();
    const res = await send(mountApp(), "POST", `/management-api/swaps/${swapId}/decide`, {
      body: { decision: "maybe" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("GET /management-api/absences lists the tenant's requested absences", async () => {
    const absenceId = await seedRequestedAbsence();
    const res = await send(mountApp(), "GET", "/management-api/absences");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; status: string }[];
    expect(rows.map((r) => r.id)).toContain(absenceId);
    expect(rows.every((r) => r.status === "requested")).toBe(true);
  });

  it("POST /management-api/absences/:id/decide approves a requested absence (204)", async () => {
    const absenceId = await seedRequestedAbsence();
    const res = await send(mountApp(), "POST", `/management-api/absences/${absenceId}/decide`, {
      body: { decision: "approved" },
    });
    expect(res.status).toBe(204);
    const list = await send(mountApp(), "GET", "/management-api/absences");
    expect(((await list.json()) as { id: string }[]).map((r) => r.id)).not.toContain(absenceId);
  });

  it("404s a decide on an unknown absence (absence.not_found)", async () => {
    const res = await send(
      mountApp(),
      "POST",
      "/management-api/absences/00000000-0000-0000-0000-000000000000/decide",
      { body: { decision: "rejected" } },
    );
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "absence.not_found" },
    });
  });

  it("403s the swap routes to a staff-role session (no swap.approve)", async () => {
    const res = await send(mountApp(), "GET", "/management-api/swaps", { cookie: staffCookie });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("403s the absence routes to a staff-role session (no absence.decide)", async () => {
    const res = await send(mountApp(), "GET", "/management-api/absences", { cookie: staffCookie });
    expect(res.status).toBe(403);
  });
});

describe("mountWorkforceApi — planned-vs-actual", () => {
  it("GET /management-api/planned-vs-actual returns [] for an empty window", async () => {
    const res = await send(
      mountApp(),
      "GET",
      `/management-api/planned-vs-actual?locationId=${locationId}&from=2026-03-02&to=2026-03-09`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("400s a non-UUID locationId (shared.invalid_id)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/planned-vs-actual?locationId=not-a-uuid&from=2026-03-02&to=2026-03-09",
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("400s a malformed from/to (management.request_invalid)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      `/management-api/planned-vs-actual?locationId=${locationId}&from=nope&to=2026-03-09`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management.request_invalid" },
    });
  });

  it("403s a staff-role session (no schedule.manage)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      `/management-api/planned-vs-actual?locationId=${locationId}&from=2026-03-02&to=2026-03-09`,
      { cookie: staffCookie },
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/server test workforce-api.test`
Expected: FAIL — the new routes 404 (Hono has no matching route), so the assertions on 200/204/40x fail.

- [ ] **Step 3: Implement — generalise `gated`, add constants + STATUS + `requireDecision`, import the verbs** — in `workforce-api.ts`:

Extend the workforce value import (`:12`):
```ts
import {
  WorkforceBackend,
  decideSwap,
  listPendingSwaps,
  setAbsenceStatus,
  listPendingAbsences,
} from "@waitron/workforce";
```

Add the two permission constants beside `SCHEDULE_PERMISSION` (`:27`):
```ts
const SWAP_APPROVE_PERMISSION: Permission = "swap.approve";
const ABSENCE_DECIDE_PERMISSION: Permission = "absence.decide";
```

Add three STATUS entries (`:35-50`, beside the other codes):
```ts
  "swap.not_found": 404,
  "swap.not_decidable": 409,
  "absence.not_found": 404,
```

Add the `requireDecision` screen beside `requireNullableString` (`:103-107`):
```ts
/** Screen a body `decision` as exactly "approved" or "rejected" — any other value (a valid-looking
 * status like "requested"/"accepted" included) is a 400 `management.request_invalid` naming the field,
 * never a downstream enum 500. The `requireNullableString` pattern, narrowed to two literals. */
function requireDecision(v: unknown): "approved" | "rejected" {
  if (v !== "approved" && v !== "rejected")
    throw new AppError("management.request_invalid", { field: "decision" });
  return v;
}
```

Generalise `gated` (`:110-118`) to take the permission as a parameter:
```ts
  const gated = <T>(
    sessionId: string,
    permission: Permission,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission });
      return fn(tx);
    });
```

Update the **six** existing `gated` call sites to pass `SCHEDULE_PERMISSION` as the new second argument — `/locations` (`:124`), `GET /roster` (`:136`), `POST /roster` (`:149`), `POST …/shifts` (`:171`), `PATCH …/shifts/:shiftId` (`:208`), `DELETE …/shifts/:shiftId` (`:217`). Each `gated(sessionId, (tx) => …)` becomes `gated(sessionId, SCHEDULE_PERMISSION, (tx) => …)`.

- [ ] **Step 4: Implement — add the five routes** — inside `mountWorkforceApi`, after the publish route (`:254`):

```ts
  // The tenant's accepted swaps awaiting a manager decision (approvals screen).
  app.get("/management-api/swaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, SWAP_APPROVE_PERMISSION, (tx) =>
        listPendingSwaps(tx, { tenantId: deps.cfg.tenantId }),
      );
      return c.json(rows);
    }),
  );

  // Composed inline (not via `gated`) because it needs authorizeManager's returned `authorizedBy` for
  // `decidedByPersonId` — the same reason the publish route composes inline.
  app.post("/management-api/swaps/:swapId/decide", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const swapId = requireUuidParam(c.req.param("swapId"), "SwapId");
      const body = (await c.req.json<{ decision?: unknown }>()) ?? {};
      const decision = requireDecision(body.decision);
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: SWAP_APPROVE_PERMISSION,
        });
        await decideSwap(tx, {
          tenantId: deps.cfg.tenantId,
          swapId,
          decision,
          decidedByPersonId: authorizedBy,
        });
      });
      return c.body(null, 204);
    }),
  );

  // The tenant's requested absences awaiting a manager decision.
  app.get("/management-api/absences", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, ABSENCE_DECIDE_PERMISSION, (tx) =>
        listPendingAbsences(tx, { tenantId: deps.cfg.tenantId }),
      );
      return c.json(rows);
    }),
  );

  app.post("/management-api/absences/:absenceId/decide", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const absenceId = requireUuidParam(c.req.param("absenceId"), "AbsenceId");
      const body = (await c.req.json<{ decision?: unknown }>()) ?? {};
      const decision = requireDecision(body.decision);
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: ABSENCE_DECIDE_PERMISSION,
        });
        // setAbsenceStatus accepts any AbsenceStatus; "approved"/"rejected" are two of its three values.
        await setAbsenceStatus(tx, {
          tenantId: deps.cfg.tenantId,
          absenceId,
          status: decision,
          decidedByPersonId: authorizedBy,
        });
      });
      return c.body(null, 204);
    }),
  );

  // The location's planned-vs-actual comparison over a half-open [from, to) local window.
  app.get("/management-api/planned-vs-actual", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.query("locationId") ?? "", "LocationId");
      const from = requirePeriod(c.req.query("from"));
      const to = requirePeriod(c.req.query("to"));
      const rows = await gated(sessionId, SCHEDULE_PERMISSION, (tx) =>
        backend.getPlannedVsActual(tx, {
          tenantId: deps.cfg.tenantId,
          locationId,
          period: { start: from, end: to },
        }),
      );
      return c.json(rows);
    }),
  );
```

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @waitron/server test workforce-api.test`
Expected: PASS — the new PGlite suites are green, and the existing roster/publish suites still pass (the generalised `gated` is exercised by them).

- [ ] **Step 6: Write the failing real-Postgres RLS/gate tests** — append to `workforce-api.rls.test.ts`. Add two seed helpers (via `suite.admin`, tenant_id explicit — the admin superuser bypasses RLS for setup) and three `it`s:

```ts
async function seedAcceptedSwap(tenantId: string, personId: string, locationId: string): Promise<string> {
  const shift = await suite.admin.execute<{ id: string }>(sql`
    insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes, ends_at, ends_offset_minutes)
    values (${tenantId}, ${personId}, ${locationId}, '2026-03-02T09:00:00Z', 0, '2026-03-02T13:00:00Z', 0) returning id`);
  const swap = await suite.admin.execute<{ id: string }>(sql`
    insert into shift_swaps (tenant_id, requested_by_person_id, from_shift_id, to_person_id, status)
    values (${tenantId}, ${personId}, ${shift.rows[0]!.id}, ${personId}, 'accepted') returning id`);
  return swap.rows[0]!.id;
}
async function seedRequestedAbsence(tenantId: string, personId: string): Promise<string> {
  const r = await suite.admin.execute<{ id: string }>(sql`
    insert into absences (tenant_id, person_id, absence_kind, starts_on, ends_on)
    values (${tenantId}, ${personId}, 'holiday', '2026-03-02', '2026-03-04') returning id`);
  return r.rows[0]!.id;
}
```

```ts
it("isolates the swap + absence queues across tenants (RLS), and decides only own-tenant rows", async () => {
  // GUARD-BY-DELETION (asAppUser): dropping `await asAppUser(tx)` from `gated` runs the list reads on
  // the suite.admin superuser connection (bypassing FORCE RLS) and leaks tenant A's swaps/absences
  // into tenant B's queue — failing the `not.toContain` assertions below.
  const a = await setupVenue();
  const b = await setupVenue();
  const swapA = await seedAcceptedSwap(a.tenantId, a.personId, a.locationId);
  const absA = await seedRequestedAbsence(a.tenantId, a.personId);
  const appA = mountApp(a.tenantId);
  const appB = mountApp(b.tenantId);

  const aSwaps = ((await (await send(appA, "GET", "/management-api/swaps", a.managerCookie)).json()) as { id: string }[]).map((r) => r.id);
  expect(aSwaps).toContain(swapA);
  const bSwaps = ((await (await send(appB, "GET", "/management-api/swaps", b.managerCookie)).json()) as { id: string }[]).map((r) => r.id);
  expect(bSwaps).not.toContain(swapA);

  const bAbs = ((await (await send(appB, "GET", "/management-api/absences", b.managerCookie)).json()) as { id: string }[]).map((r) => r.id);
  expect(bAbs).not.toContain(absA);

  // B deciding A's swap sees swap.not_found — RLS hides it from B.
  const bDecidesA = await send(appB, "POST", `/management-api/swaps/${swapA}/decide`, b.managerCookie, { decision: "approved" });
  expect(bDecidesA.status).toBe(404);

  // A decides its own swap; the decider column is stamped as app_user under FORCE RLS (the §5 receipt:
  // a table-level UPDATE grant that did NOT cover decided_by_person_id would raise 42501 → this 204
  // would be a 500 and the read-back would show status unchanged).
  const aDecides = await send(appA, "POST", `/management-api/swaps/${swapA}/decide`, a.managerCookie, { decision: "approved" });
  expect(aDecides.status).toBe(204);
  const decided = await suite.admin.execute<{ status: string; decided_by_person_id: string | null; decided_at: string | null }>(
    sql`select status, decided_by_person_id, decided_at from shift_swaps where id = ${swapA}`,
  );
  expect(decided.rows[0]!.status).toBe("approved");
  expect(decided.rows[0]!.decided_by_person_id).toBe(a.personId);
  expect(decided.rows[0]!.decided_at).not.toBeNull();

  // And the absence decide lands its decider column too (same grant receipt on `absences`).
  const aDecidesAbs = await send(appA, "POST", `/management-api/absences/${absA}/decide`, a.managerCookie, { decision: "rejected" });
  expect(aDecidesAbs.status).toBe(204);
  const decidedAbs = await suite.admin.execute<{ status: string; decided_by_person_id: string | null }>(
    sql`select status, decided_by_person_id from absences where id = ${absA}`,
  );
  expect(decidedAbs.rows[0]!.status).toBe("rejected");
  expect(decidedAbs.rows[0]!.decided_by_person_id).toBe(a.personId);
});

it("refuses the swap + absence + planned-vs-actual routes to a staff-role session — 403", async () => {
  // GUARD-BY-DELETION (authorizeManager): remove the authorizeManager call for a route (and, for the
  // two decide routes, stub authorizedBy) and the staff request below returns 200 instead of 403.
  const { tenantId, locationId, staffCookie } = await setupVenue();
  const app = mountApp(tenantId);
  const missing = "00000000-0000-0000-0000-000000000000";
  const expect403 = async (res: Response) => {
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({ error: { code: "authorization.not_permitted" } });
  };
  await expect403(await send(app, "GET", "/management-api/swaps", staffCookie));
  await expect403(await send(app, "POST", `/management-api/swaps/${missing}/decide`, staffCookie, { decision: "approved" }));
  await expect403(await send(app, "GET", "/management-api/absences", staffCookie));
  await expect403(await send(app, "POST", `/management-api/absences/${missing}/decide`, staffCookie, { decision: "approved" }));
  await expect403(await send(app, "GET", `/management-api/planned-vs-actual?locationId=${locationId}&from=2026-03-02&to=2026-03-09`, staffCookie));
});

it("assembles planned-vs-actual under RLS for the tenant's own location", async () => {
  // The route assembles + returns rows under withTenant + asAppUser (the windowing/scoping logic is
  // already covered on PGlite in Task 5). Seed one shift on a PUBLISHED roster version as admin
  // (tenant_id explicit; the planned side is published-only, so a null-version draft would be excluded)
  // and assert it comes back as a no-show — proving the read runs as app_user without leaking or 500-ing.
  const v = await setupVenue();
  const version = await suite.admin.execute<{ id: string }>(sql`
    insert into roster_versions (tenant_id, location_id, period_start, period_end, status, published_at)
    values (${v.tenantId}, ${v.locationId}, '2026-03-02', '2026-03-08', 'published', now()) returning id`);
  await suite.admin.execute(sql`
    insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes, ends_at, ends_offset_minutes, roster_version_id)
    values (${v.tenantId}, ${v.personId}, ${v.locationId}, '2026-03-02T09:00:00Z', 0, '2026-03-02T13:00:00Z', 0, ${version.rows[0]!.id})`);
  const res = await send(
    mountApp(v.tenantId),
    "GET",
    `/management-api/planned-vs-actual?locationId=${v.locationId}&from=2026-03-02&to=2026-03-09`,
    v.managerCookie,
  );
  expect(res.status).toBe(200);
  const rows = (await res.json()) as { personId: string; workDate: string; noShow: boolean; plannedMinutes: number }[];
  const row = rows.find((r) => r.personId === v.personId && r.workDate === "2026-03-02");
  expect(row).toBeDefined();
  expect(row!.noShow).toBe(true);
  expect(row!.plannedMinutes).toBe(240);
});
```

- [ ] **Step 7: Run the real-PG suite — verify it passes (needs Docker + Ryuk disabled)**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test workforce-api.rls`
Expected: PASS — the routes exist (Steps 3-4), so the differential isolation, gates, decider-column receipt and planned-vs-actual assembly all pass.

- [ ] **Step 8: Prove the gates + isolation by deletion (record the receipt in the test comment)** — temporarily (a) remove `await asAppUser(tx)` from `gated` → the cross-tenant swap/absence isolation test goes red (B's queue contains A's rows); (b) remove the `authorizeManager` call from `gated` (and stub `authorizedBy` in the two inline decide composes) → the staff-403 test goes red at the first `expect403`. Restore both; confirm green. Update the guard-by-deletion comments in the two tests with the date and postgres image you ran against (mirroring the existing `workforce-api.rls.test.ts:129-133` receipt).

- [ ] **Step 9: Gate + commit**

```bash
pnpm --filter @waitron/server typecheck
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
git add apps/server/src/workforce-api.ts apps/server/src/workforce-api.test.ts apps/server/src/workforce-api.rls.test.ts
git commit -s -m "feat(server): swap/absence approve-reject + planned-vs-actual routes (generalise gated)"
```

---

## Task 7: Dashboard — split-shift `openCell` fix (pure UI)

**Files:**
- Modify: `apps/dashboard/src/screens/roster-screen.ts` (`openCell` signature; `#renderCell`; SLICE-1 LIMITATION comment)
- Modify: `apps/dashboard/src/i18n/strings.ts` (new `roster.add_another` key, en + es)
- Test: `apps/dashboard/src/screens/roster-screen.test.ts` (the split-shift regression + the 3 direct `openCell` call-site updates)

**Interfaces:**
- Consumes: `Shift` (`../api/client.js`); the existing `#renderCell`/`openCell`/`localDate`/`t`/`nothing` machinery (`roster-screen.ts`).
- Produces: `openCell(personId: string, day: string, shift: Shift | null): void` (was `openCell(personId, day)`), and a `#renderCell` that renders each existing shift as its own edit button plus an always-present add button.

- [ ] **Step 1: Write the failing test** — add a split-shift regression to `roster-screen.test.ts`, and (in the same edit) update the three direct `openCell(...)` cast call sites (`:82`, `:203`, `:350`) to the 3-arg signature:

```ts
it("authors a SECOND shift on a populated cell (split shift) — edits the existing one AND adds another", async () => {
  // The slice-2 fix: a populated cell must offer BOTH an edit of its existing shift AND an add of a
  // second one. Before the fix `openCell`'s `.find` always re-opened the FIRST shift in edit mode, so
  // a jornada partida could not be authored.
  const snap: RosterSnapshot = {
    version: draftSnapshot().version,
    shifts: [
      {
        id: "s1", personId: "p1", locationId: "loc-1",
        startsAt: "2026-03-02T09:00:00Z", startsOffsetMinutes: 0,
        endsAt: "2026-03-02T13:00:00Z", endsOffsetMinutes: 0, role: "bar", rosterVersionId: "v1",
      },
    ],
  };
  const api = stubApi({ getRoster: vi.fn().mockResolvedValue(snap) });
  const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
  await flush(el);
  const editBtn = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-test=edit-s1]")!;
  const addBtn = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-test=cell-p1-2026-03-02]")!;
  expect(editBtn).not.toBeNull();
  expect(addBtn).not.toBeNull();
  // Editing opens the dialog on the existing shift.
  editBtn.click();
  await el.updateComplete;
  expect((dialog(el) as unknown as { shift: { id: string } | null }).shift).toMatchObject({ id: "s1" });
  // The add button opens the dialog for a NEW (null) shift on the same person + day.
  addBtn.click();
  await el.updateComplete;
  expect((dialog(el) as unknown as { shift: unknown }).shift).toBeNull();
  expect((dialog(el) as unknown as { personId: string }).personId).toBe("p1");
});
```

Update the three existing direct calls (they cast, so the runtime is fine, but make the intent explicit):
- `:82` and `:203` and `:350`: change the cast type to `{ openCell(personId: string, day: string, shift: null): void }` and call `.openCell("p1", "2026-03-02", null)`.

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @waitron/dashboard test roster-screen.test`
Expected: FAIL — `[data-test=edit-s1]` does not exist (the current cell renders one button per cell containing all spans, with `data-test=cell-p1-…`), so `editBtn` is null.

- [ ] **Step 3: Implement — `openCell`** — in `roster-screen.ts`, replace the SLICE-1 LIMITATION comment + method (`:245-265`) with:

```ts
/**
 * Open the dialog for a grid cell (person × day) targeting `shift` — an existing shift to edit/remove,
 * or null to author a NEW one. Only on an EDITABLE week; a published week's cells are inert.
 *
 * Split shifts (jornada partida) ARE authorable: `#renderCell` renders each existing shift as its own
 * edit button and an always-present add button, so the caller passes the exact target rather than this
 * method resolving one — a populated cell can both edit its shift(s) and add another.
 */
openCell(personId: string, day: string, shift: Shift | null): void {
  if (!this.editable) return;
  this.errorKey = null;
  this.dialogPersonId = personId;
  this.dialogDay = day;
  this.dialogShift = shift;
  this.dialogOpen = true;
}
```

- [ ] **Step 4: Implement — `#renderCell`** — replace `#renderCell` (`:456-476`) with:

```ts
#renderCell(personId: string, day: string): TemplateResult {
  const cellShifts = this.snapshot.shifts.filter(
    (s) => s.personId === personId && localDate(s.startsAt, s.startsOffsetMinutes) === day,
  );
  const testId = `cell-${personId}-${day}`;
  const label = (s: Shift) => `${s.startsAt.slice(11, 16)}–${s.endsAt.slice(11, 16)}`;
  // A published week is read-only: plain, non-interactive spans, no handler.
  if (!this.editable) {
    return html`<td data-test=${testId}>${cellShifts.map((s) => html`<span>${label(s)}</span>`)}</td>`;
  }
  // Editable: each existing shift is its own edit button (its visible time is its accessible name),
  // plus an always-present add button. The add button carries the `cell-<person>-<day>` test id and,
  // when the cell is EMPTY, an aria-label (no visible text); when populated it shows visible
  // "add another" text (its accessible name), so name and content never mismatch (axe).
  return html`<td>
    ${cellShifts.map(
      (s) => html`<button
        type="button"
        class="cell-button"
        data-test=${`edit-${s.id}`}
        @click=${() => this.openCell(personId, day, s)}
      >
        ${label(s)}
      </button>`,
    )}
    <button
      type="button"
      class="cell-button"
      data-test=${testId}
      aria-label=${cellShifts.length > 0 ? nothing : t("roster.new_shift")}
      @click=${() => this.openCell(personId, day, null)}
    >
      ${cellShifts.length > 0 ? t("roster.add_another") : nothing}
    </button>
  </td>`;
}
```

- [ ] **Step 5: Add the i18n key** — in `strings.ts`, add to the `en` roster-screen block (`:115-124`) and its `es` sibling (`:213-221`):

```ts
  "roster.add_another": "Add another",   // en
  "roster.add_another": "Añadir otro",   // es
```

- [ ] **Step 6: Run it — verify it passes** (the whole roster suite, incl. the existing cell-click / keyboard / a11y-shape tests that key on `[data-test^=cell-p1-]`, which now points at the add button):

Run: `pnpm --filter @waitron/dashboard test roster-screen`
Expected: PASS — the split-shift test, the existing cell-open/keyboard tests, and both a11y shapes are green.

- [ ] **Step 7: Prove the fix is load-bearing** — temporarily revert `openCell` to `this.snapshot.shifts.find(...)` first-match resolution and render a single per-cell button → the split-shift test fails (`[data-test=edit-s1]` is absent / the add button re-opens the existing shift). Restore; confirm green.

- [ ] **Step 8: Gate + commit**

```bash
pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/dashboard test:coverage roster-screen
git add apps/dashboard/src/screens/roster-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/roster-screen.test.ts
git commit -s -m "feat(dashboard): split-shift authoring — each cell shift editable + always-addable"
```

---

## Task 8: Dashboard — approvals screen + client methods + i18n + shell wiring

**Files:**
- Create: `apps/dashboard/src/screens/approvals-screen.ts` + `.test.ts` + `.a11y.test.ts`
- Modify: `apps/dashboard/src/api/client.ts` (`PendingSwap`, `PendingAbsence` + four methods) + `client.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (`nav.approvals` + `approvals.*`), `codes.ts` + `codes.test.ts` (`swap.*`/`absence.*` messages), `domain.ts` + `domain.test.ts` (absence-kind + swap/absence status names)
- Modify: `apps/dashboard/src/dashboard-app.ts` (`"approvals"` Screen member, nav, `#renderScreen`, import) + `dashboard-app.test.ts` + `dashboard-app.a11y.test.ts`

**Interfaces:**
- Consumes: `DashboardApi`, `PersonSummary` (`../api/client.js`); `@waitron/ui` primitives (`wt-button`); `t`/`codeMessage`/`absenceKindName`/`decisionStatusName` (`../i18n/*`); `mountWidget`/`cleanupWidgets`/`expectNoA11yViolations` (`../widgets/test-helpers.js`).
- Produces:
  ```ts
  // client.ts (browser-local row types):
  export interface PendingSwap { id: string; requestedByPersonId: string; fromShiftId: string; toPersonId: string; toShiftId: string | null; status: string; createdAt: string; }
  export interface PendingAbsence { id: string; personId: string; kind: string; startsOn: string; endsOn: string; status: string; note: string | null; createdAt: string; }
  // DashboardApi methods:
  listPendingSwaps(): Promise<PendingSwap[]>;
  decideSwap(swapId: string, decision: "approved" | "rejected"): Promise<void>;
  listPendingAbsences(): Promise<PendingAbsence[]>;
  decideAbsence(absenceId: string, decision: "approved" | "rejected"): Promise<void>;
  // element: <dashboard-approvals-screen> (class ApprovalsScreen), @property api!: DashboardApi
  ```

- [ ] **Step 1: Add the client methods (test first)** — in `client.test.ts`, add four tests (using the file's `jsonResponse`/`emptyResponse` helpers, `:5-18`):

```ts
it("listPendingSwaps GETs /management-api/swaps with credentials", async () => {
  const rows = [{ id: "sw1", requestedByPersonId: "p1", fromShiftId: "s1", toPersonId: "p2", toShiftId: null, status: "accepted", createdAt: "2026-03-02T00:00:00Z" }];
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
  const api = new DashboardApi("", fetchImpl);
  expect(await api.listPendingSwaps()).toEqual(rows);
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/swaps", { method: "GET", credentials: "include" });
});

it("decideSwap POSTs the decision and resolves undefined on an empty 204", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
  const api = new DashboardApi("", fetchImpl);
  await expect(api.decideSwap("sw1", "approved")).resolves.toBeUndefined();
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/swaps/sw1/decide", {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approved" }),
  });
});

it("listPendingAbsences GETs /management-api/absences with credentials", async () => {
  const rows = [{ id: "ab1", personId: "p1", kind: "holiday", startsOn: "2026-03-02", endsOn: "2026-03-04", status: "requested", note: null, createdAt: "2026-03-02T00:00:00Z" }];
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
  const api = new DashboardApi("", fetchImpl);
  expect(await api.listPendingAbsences()).toEqual(rows);
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/absences", { method: "GET", credentials: "include" });
});

it("decideAbsence POSTs the decision to the absences decide route", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
  const api = new DashboardApi("", fetchImpl);
  await expect(api.decideAbsence("ab1", "rejected")).resolves.toBeUndefined();
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/absences/ab1/decide", {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "rejected" }),
  });
});
```

Run: `pnpm --filter @waitron/dashboard test client.test` → FAIL (`api.listPendingSwaps is not a function`).

- [ ] **Step 2: Implement the client methods** — in `client.ts`, add the row types beside `LocationSummary` (`:282-286`):

```ts
/** One `GET /management-api/swaps` row — mirrors workforce's `PendingSwapRow` (always `accepted`). */
export interface PendingSwap {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: string;
  createdAt: string;
}

/** One `GET /management-api/absences` row — mirrors workforce's `PendingAbsenceRow` (always `requested`). */
export interface PendingAbsence {
  id: string;
  personId: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  status: string;
  note: string | null;
  createdAt: string;
}
```

and the four methods (after `publishRoster`, `:538`):

```ts
  // ── Approvals (shift swaps + absences) ──────────────────────────────────────────────────────────

  /** `GET /management-api/swaps` — the tenant's accepted swaps awaiting a manager decision. */
  listPendingSwaps(): Promise<PendingSwap[]> {
    return this.#request<PendingSwap[]>("/management-api/swaps", "GET");
  }

  /** `POST …/swaps/:id/decide` — approve/reject an accepted swap. Answers an empty 204. */
  decideSwap(swapId: string, decision: "approved" | "rejected"): Promise<void> {
    return this.#request<void>(`/management-api/swaps/${swapId}/decide`, "POST", { decision });
  }

  /** `GET /management-api/absences` — the tenant's requested absences awaiting a manager decision. */
  listPendingAbsences(): Promise<PendingAbsence[]> {
    return this.#request<PendingAbsence[]>("/management-api/absences", "GET");
  }

  /** `POST …/absences/:id/decide` — approve/reject a requested absence. Answers an empty 204.
   * Named `decideAbsence` for symmetry with `decideSwap`; it hits the same route → `setAbsenceStatus`. */
  decideAbsence(absenceId: string, decision: "approved" | "rejected"): Promise<void> {
    return this.#request<void>(`/management-api/absences/${absenceId}/decide`, "POST", { decision });
  }
```

Run: `pnpm --filter @waitron/dashboard test client.test` → PASS.

- [ ] **Step 3: Add the i18n copy (test first)** — in `codes.ts`, add three code messages to `CODE_MESSAGES` (`:14`), beside the roster codes:

```ts
  "swap.not_found": { en: "That swap could not be found", es: "No se ha encontrado ese cambio de turno" },
  "swap.not_decidable": { en: "That swap can no longer be decided", es: "Ese cambio de turno ya no se puede decidir" },
  "absence.not_found": { en: "That absence could not be found", es: "No se ha encontrado esa ausencia" },
```

In `codes.test.ts`, extend the "has a sentence for each roster/shift/convenio code" list (`:63-72`) with `"swap.not_found"`, `"swap.not_decidable"`, `"absence.not_found"` (the same not-raw / not-GENERIC assertions cover them).

In `domain.ts`, add two NameTables + resolvers (after `BREACH_KIND_NAMES`, `:99`):

```ts
// The four absence kinds (@waitron/workforce absence_kind), shown on the approvals screen. Raw
// string-keyed LOCAL copy, same bundle-decoupling reason as the tables above.
const ABSENCE_KIND_NAMES: NameTable = {
  holiday: { en: "Holiday", es: "Vacaciones" },
  sick_leave: { en: "Sick leave", es: "Baja" },
  leave: { en: "Leave", es: "Permiso" },
  unpaid: { en: "Unpaid leave", es: "Permiso sin sueldo" },
};

// The swap/absence lifecycle statuses shown on the approvals screen (@waitron/workforce
// shift_swap_status ∪ absence_status). One shared table — the token sets overlap on
// requested/approved/rejected — with a raw-value fallback.
const DECISION_STATUS_NAMES: NameTable = {
  requested: { en: "Requested", es: "Solicitado" },
  accepted: { en: "Accepted", es: "Aceptado" },
  approved: { en: "Approved", es: "Aprobado" },
  rejected: { en: "Rejected", es: "Rechazado" },
};
```

and the resolvers (beside `breachKindName`, `:106-109`):

```ts
/** An absence kind (holiday / sick_leave / leave / unpaid) → its display name (raw-value fallback). */
export function absenceKindName(kind: string, locale: string = currentLocale()): string {
  return resolve(ABSENCE_KIND_NAMES, kind, locale);
}

/** A swap/absence lifecycle status → its display name (raw-value fallback for an unmapped token). */
export function decisionStatusName(status: string, locale: string = currentLocale()): string {
  return resolve(DECISION_STATUS_NAMES, status, locale);
}
```

In `domain.test.ts`, add a test mirroring the breach-kind one (`:80-86`):

```ts
it("names every absence kind and decision status, raw fallback for an unknown token (roster slice 2)", () => {
  expect(absenceKindName("holiday", "es")).toBe("Vacaciones");
  expect(absenceKindName("sick_leave", "en")).toBe("Sick leave");
  expect(absenceKindName("unknown_kind", "es")).toBe("unknown_kind");
  expect(decisionStatusName("accepted", "es")).toBe("Aceptado");
  expect(decisionStatusName("rejected", "en")).toBe("Rejected");
  expect(decisionStatusName("weird_status", "es")).toBe("weird_status");
});
```

(add `absenceKindName`, `decisionStatusName` to `domain.test.ts`'s import block.)

In `strings.ts`, add the nav + screen copy to `en` (and `es`):

```ts
  // en, in the Shell nav block:
  "nav.approvals": "Approvals",
  // en, a new Approvals screen block:
  "approvals.title": "Approvals",
  "approvals.swaps_title": "Shift swaps",
  "approvals.absences_title": "Absences",
  "approvals.none_swaps": "No swaps awaiting a decision.",
  "approvals.none_absences": "No absences awaiting a decision.",
  "approvals.approve": "Approve",
  "approvals.reject": "Reject",
```
```ts
  // es siblings:
  "nav.approvals": "Aprobaciones",
  "approvals.title": "Aprobaciones",
  "approvals.swaps_title": "Cambios de turno",
  "approvals.absences_title": "Ausencias",
  "approvals.none_swaps": "No hay cambios de turno pendientes.",
  "approvals.none_absences": "No hay ausencias pendientes.",
  "approvals.approve": "Aprobar",
  "approvals.reject": "Rechazar",
```

(Add each `en` entry AND its `es` sibling together — `es` is typed `Record<StringKey, string>`, so a key added to `en` without a Spanish sibling is a compile error. Every listed key is used by the approvals screen render; add no key the render does not consume.)

Run: `pnpm --filter @waitron/dashboard test codes domain` → PASS.

- [ ] **Step 4: Write the failing approvals-screen test** — create `apps/dashboard/src/screens/approvals-screen.test.ts`, mirroring `roster-screen.test.ts`'s stub/mount/flush pattern:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, PendingAbsence, PendingSwap, PersonSummary } from "../api/client.js";
import { ApprovalsScreen } from "./approvals-screen.js";

const staff: PersonSummary[] = [
  { personId: "p1", displayName: "Ana", role: "staff", status: "active", hasPassword: false, hasTotp: false },
  { personId: "p2", displayName: "Beto", role: "staff", status: "active", hasPassword: false, hasTotp: false },
];
const swap: PendingSwap = { id: "sw1", requestedByPersonId: "p1", fromShiftId: "s1", toPersonId: "p2", toShiftId: null, status: "accepted", createdAt: "2026-03-02T00:00:00Z" };
const absence: PendingAbsence = { id: "ab1", personId: "p1", kind: "holiday", startsOn: "2026-03-02", endsOn: "2026-03-04", status: "requested", note: "trip", createdAt: "2026-03-02T00:00:00Z" };

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(staff),
    listPendingSwaps: vi.fn().mockResolvedValue([swap]),
    listPendingAbsences: vi.fn().mockResolvedValue([absence]),
    decideSwap: vi.fn().mockResolvedValue(undefined),
    decideAbsence: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: ApprovalsScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

describe("approvals-screen", () => {
  it("loads and renders the two queues, resolving person names via listStaff", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    expect(api.listPendingSwaps).toHaveBeenCalledTimes(1);
    expect(api.listPendingAbsences).toHaveBeenCalledTimes(1);
    const text = el.shadowRoot!.textContent ?? "";
    expect(text).toContain("Ana");     // requester name resolved
    expect(text).toContain("Vacaciones"); // absence kind, es
  });

  it("approves a swap → calls decideSwap and reloads both queues", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=approve-swap-sw1]")!.click();
    await flush(el);
    expect(api.decideSwap).toHaveBeenCalledWith("sw1", "approved");
    expect(api.listPendingSwaps).toHaveBeenCalledTimes(2); // reloaded
  });

  it("rejects an absence → calls decideAbsence with 'rejected'", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reject-absence-ab1]")!.click();
    await flush(el);
    expect(api.decideAbsence).toHaveBeenCalledWith("ab1", "rejected");
  });

  it("files at most one decide when a button is double-clicked (single-flight)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    const btn = el.shadowRoot!.querySelector<HTMLElement>("[data-test=approve-swap-sw1]")!;
    btn.click();
    btn.click();
    await flush(el);
    expect(api.decideSwap).toHaveBeenCalledTimes(1);
  });

  it("shows the empty prompts when both queues are empty", async () => {
    const api = stubApi({ listPendingSwaps: vi.fn().mockResolvedValue([]), listPendingAbsences: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-swaps]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=no-absences]")).not.toBeNull();
  });

  it("shows the error banner when a load rejects", async () => {
    const api = stubApi({ listPendingSwaps: vi.fn().mockRejectedValue({ code: "management_session.required" }) });
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("management_session.required");
  });
});
```

Run: `pnpm --filter @waitron/dashboard test approvals-screen.test` → FAIL (no such element / module).

- [ ] **Step 5: Implement the approvals screen** — create `apps/dashboard/src/screens/approvals-screen.ts`:

```ts
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { absenceKindName } from "../i18n/domain.js";
import type { DashboardApi, PendingAbsence, PendingSwap, PersonSummary } from "../api/client.js";

/**
 * The management dashboard's APPROVALS SCREEN (design §3g): the two manager approve/reject queues —
 * ACCEPTED shift swaps and REQUESTED absences — side by side, each row carrying Approve and Reject
 * buttons. Person ids render as names via `listStaff`. Every async path is `try/catch`ed into an
 * `errorKey` banner (the roster/catalogue-screen pattern); a single-flight `busy` gate drops a
 * double-fired decide. On a decide it calls the API then reloads the queues.
 */
@customElement("dashboard-approvals-screen")
export class ApprovalsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host { display: block; }
      h1 { margin: 0 0 var(--wt-space-4); font-size: var(--wt-font-size-lg); color: var(--wt-color-text); }
      h2 { font-size: var(--wt-font-size-md); color: var(--wt-color-text); }
      .queues { display: flex; flex-wrap: wrap; gap: var(--wt-space-5); }
      .queue { flex: 1 1 20rem; }
      ul { list-style: none; margin: 0; padding: 0; }
      li {
        display: flex; align-items: center; justify-content: space-between; gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0; border-bottom: 1px solid var(--wt-color-border); color: var(--wt-color-text);
      }
      .actions { display: flex; gap: var(--wt-space-2); }
      .muted { color: var(--wt-color-text-muted); }
      .error { color: var(--wt-color-danger); margin-top: var(--wt-space-3); }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @state() private swaps: PendingSwap[] = [];
  @state() private absences: PendingAbsence[] = [];
  @state() private staff: PersonSummary[] = [];
  @state() private errorKey: string | null = null;
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** (Re)load both queues + the staff list for name resolution. A rejection becomes the error banner. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [swaps, absences, staff] = await Promise.all([
        this.api.listPendingSwaps(),
        this.api.listPendingAbsences(),
        this.api.listStaff(),
      ]);
      this.swaps = swaps;
      this.absences = absences;
      this.staff = staff;
    } catch (error) {
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    }
  }

  /** A person's display name, or the raw id when it is not in the loaded staff list. */
  #name(personId: string): string {
    return this.staff.find((p) => p.personId === personId)?.displayName ?? personId;
  }

  async #decideSwap(swapId: string, decision: "approved" | "rejected"): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.decideSwap(swapId, decision);
      await this.#load();
    } catch (error) {
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    } finally {
      this.busy = false;
    }
  }

  async #decideAbsence(absenceId: string, decision: "approved" | "rejected"): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.decideAbsence(absenceId, decision);
      await this.#load();
    } catch (error) {
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("approvals.title")}</h1>
      <div class="queues">
        <section class="queue" aria-labelledby="swaps-h">
          <h2 id="swaps-h">${t("approvals.swaps_title")}</h2>
          ${
            this.swaps.length === 0
              ? html`<p class="muted" data-test="no-swaps">${t("approvals.none_swaps")}</p>`
              : html`<ul>
                  ${this.swaps.map(
                    (s) => html`<li data-test=${`swap-${s.id}`}>
                      <span>${this.#name(s.requestedByPersonId)} → ${this.#name(s.toPersonId)}</span>
                      <span class="actions">
                        <wt-button variant="primary" data-test=${`approve-swap-${s.id}`} ?disabled=${this.busy} @click=${() => void this.#decideSwap(s.id, "approved")}>${t("approvals.approve")}</wt-button>
                        <wt-button variant="secondary" data-test=${`reject-swap-${s.id}`} ?disabled=${this.busy} @click=${() => void this.#decideSwap(s.id, "rejected")}>${t("approvals.reject")}</wt-button>
                      </span>
                    </li>`,
                  )}
                </ul>`
          }
        </section>
        <section class="queue" aria-labelledby="absences-h">
          <h2 id="absences-h">${t("approvals.absences_title")}</h2>
          ${
            this.absences.length === 0
              ? html`<p class="muted" data-test="no-absences">${t("approvals.none_absences")}</p>`
              : html`<ul>
                  ${this.absences.map(
                    (a) => html`<li data-test=${`absence-${a.id}`}>
                      <span>${this.#name(a.personId)} · ${absenceKindName(a.kind)} · ${a.startsOn}–${a.endsOn}</span>
                      <span class="actions">
                        <wt-button variant="primary" data-test=${`approve-absence-${a.id}`} ?disabled=${this.busy} @click=${() => void this.#decideAbsence(a.id, "approved")}>${t("approvals.approve")}</wt-button>
                        <wt-button variant="secondary" data-test=${`reject-absence-${a.id}`} ?disabled=${this.busy} @click=${() => void this.#decideAbsence(a.id, "rejected")}>${t("approvals.reject")}</wt-button>
                      </span>
                    </li>`,
                  )}
                </ul>`
          }
        </section>
      </div>
      ${this.errorKey ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-approvals-screen": ApprovalsScreen;
  }
}
```

Run: `pnpm --filter @waitron/dashboard test approvals-screen.test` → PASS.

- [ ] **Step 6: Write the a11y test** — create `apps/dashboard/src/screens/approvals-screen.a11y.test.ts`, mirroring `roster-screen.a11y.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./approvals-screen.js";
import type { ApprovalsScreen } from "./approvals-screen.js";
import type { DashboardApi, PendingAbsence, PendingSwap, PersonSummary } from "../api/client.js";

const staff: PersonSummary[] = [
  { personId: "p1", displayName: "Ana", role: "staff", status: "active", hasPassword: false, hasTotp: false },
  { personId: "p2", displayName: "Beto", role: "staff", status: "active", hasPassword: false, hasTotp: false },
];
const swaps: PendingSwap[] = [{ id: "sw1", requestedByPersonId: "p1", fromShiftId: "s1", toPersonId: "p2", toShiftId: null, status: "accepted", createdAt: "2026-03-02T00:00:00Z" }];
const absences: PendingAbsence[] = [{ id: "ab1", personId: "p1", kind: "holiday", startsOn: "2026-03-02", endsOn: "2026-03-04", status: "requested", note: null, createdAt: "2026-03-02T00:00:00Z" }];

function stubApi(withRows: boolean): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(staff),
    listPendingSwaps: vi.fn().mockResolvedValue(withRows ? swaps : []),
    listPendingAbsences: vi.fn().mockResolvedValue(withRows ? absences : []),
  } as unknown as DashboardApi;
}
async function flush(el: ApprovalsScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("approvals-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with pending rows", async () => {
    const { el, host } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api: stubApi(true) }, theme);
    await flush(el);
    await expectNoA11yViolations(host);
  });
  it("renders accessibly with empty queues", async () => {
    const { el, host } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api: stubApi(false) }, theme);
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
```

Run: `pnpm --filter @waitron/dashboard test approvals-screen.a11y` → PASS (fix any axe finding before moving on).

- [ ] **Step 7: Wire the shell** — in `dashboard-app.ts`: add the side-effect import (`:13` block) `import "./screens/approvals-screen.js";`; add `"approvals"` to the `Screen` union (`:22`); add a nav button after the roster one (`:177-183` pattern) with `data-test="nav-approvals"` and `t("nav.approvals")`; add a `#renderScreen` case (`:206-207` pattern) returning `<dashboard-approvals-screen .api=${this.api}></dashboard-approvals-screen>`. Update the class/`#renderScreen` doc comments to name six/seven faces.

In `dashboard-app.test.ts`: add `"dashboard-approvals-screen"` to `SCREEN_TAGS` (`:75-81`); add a `navApprovals` selector (`:71` pattern) and a `roster()`-style `approvals()` accessor; add a nav test:

```ts
it("navigates to the approvals screen", async () => {
  const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await flush(el);
  expect(navApprovals(el)).toBeTruthy();
  navApprovals(el)!.click();
  await flush(el);
  expect(el.shadowRoot!.querySelector("dashboard-approvals-screen")).toBeTruthy();
  expect(mountedScreens(el)).toEqual(["dashboard-approvals-screen"]);
  expect(countH1(el)).toBe(1);
});
```

Extend the shell's `stubApi` (`dashboard-app.test.ts:24-47`) with `listPendingSwaps`/`listPendingAbsences` resolving `[]` (the approvals screen loads them on connect — a stray rejection is a finding). Do the same in `dashboard-app.a11y.test.ts`'s `stubApi` (`:33-50`) and add an approvals-screen a11y navigation case mirroring the roster/receipt ones.

- [ ] **Step 8: Run + gate + commit** (whole dashboard package unfiltered — it carries the axe suites + i18n guards):

```bash
pnpm --filter @waitron/dashboard typecheck
pnpm --filter @waitron/dashboard test:coverage
git add apps/dashboard/src/screens/approvals-screen.ts apps/dashboard/src/screens/approvals-screen.test.ts \
        apps/dashboard/src/screens/approvals-screen.a11y.test.ts apps/dashboard/src/api/client.ts \
        apps/dashboard/src/api/client.test.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/codes.ts \
        apps/dashboard/src/i18n/codes.test.ts apps/dashboard/src/i18n/domain.ts apps/dashboard/src/i18n/domain.test.ts \
        apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts apps/dashboard/src/dashboard-app.a11y.test.ts
git commit -s -m "feat(dashboard): approvals screen (swap + absence approve/reject) + client + i18n + nav"
```

---

## Task 9: Dashboard — planned-vs-actual screen + client method + i18n + shell wiring

**Files:**
- Create: `apps/dashboard/src/screens/planned-actual-screen.ts` + `.test.ts` + `.a11y.test.ts`
- Modify: `apps/dashboard/src/api/client.ts` (`PlannedVsActualRow` + `getPlannedVsActual`) + `client.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (`nav.planned_actual` + `planned.*`)
- Modify: `apps/dashboard/src/dashboard-app.ts` + `dashboard-app.test.ts` + `dashboard-app.a11y.test.ts` (the `"planned-actual"` Screen member, nav, `#renderScreen`, import, stubs)

**Interfaces:**
- Consumes: `DashboardApi`, `LocationSummary`, `PersonSummary` (`../api/client.js`); `wt-button` + `selectStyles`; `t`/`codeMessage` (`../i18n/*`); the `mondayOf`/`weekDays` week helpers (re-declared locally as in `roster-screen.ts:23-47`).
- Produces:
  ```ts
  // client.ts:
  export interface PlannedVsActualRow { personId: string; workDate: string; plannedMinutes: number; workedMinutes: number; lateMinutes: number; noShow: boolean; unplanned: boolean; }
  getPlannedVsActual(locationId: string, from: string, to: string): Promise<PlannedVsActualRow[]>;
  // element: <dashboard-planned-actual-screen> (class PlannedActualScreen)
  ```

- [ ] **Step 1: Add the client method (test first)** — in `client.test.ts`:

```ts
it("getPlannedVsActual GETs the planned-vs-actual route with locationId/from/to", async () => {
  const rows = [{ personId: "p1", workDate: "2026-03-02", plannedMinutes: 240, workedMinutes: 225, lateMinutes: 15, noShow: false, unplanned: false }];
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
  const api = new DashboardApi("", fetchImpl);
  expect(await api.getPlannedVsActual("loc-1", "2026-03-02", "2026-03-09")).toEqual(rows);
  expect(fetchImpl).toHaveBeenCalledWith(
    "/management-api/planned-vs-actual?locationId=loc-1&from=2026-03-02&to=2026-03-09",
    { method: "GET", credentials: "include" },
  );
});
```

Run: `pnpm --filter @waitron/dashboard test client.test` → FAIL.

- [ ] **Step 2: Implement the client method** — in `client.ts`, add the row type (beside `PendingAbsence`) and method (after `decideAbsence`):

```ts
/** One `GET /management-api/planned-vs-actual` row — mirrors workforce's `PlannedVsActual`. Minutes
 * are integers; `workDate` is the worker's LOCAL day (YYYY-MM-DD). */
export interface PlannedVsActualRow {
  personId: string;
  workDate: string;
  plannedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  noShow: boolean;
  unplanned: boolean;
}
```
```ts
  /** `GET /management-api/planned-vs-actual?locationId=&from=&to=` — the location's planned-vs-actual
   * comparison over a half-open [from, to) local window. */
  getPlannedVsActual(locationId: string, from: string, to: string): Promise<PlannedVsActualRow[]> {
    return this.#request<PlannedVsActualRow[]>(
      `/management-api/planned-vs-actual?locationId=${locationId}&from=${from}&to=${to}`,
      "GET",
    );
  }
```

Run: `pnpm --filter @waitron/dashboard test client.test` → PASS.

- [ ] **Step 3: Add the i18n copy** — in `strings.ts`, add to `en` (and `es`):

```ts
  // en:
  "nav.planned_actual": "Planned vs actual",
  "planned.title": "Planned vs actual",
  "planned.location": "Location",
  "planned.week": "Week",
  "planned.person": "Person",
  "planned.day": "Day",
  "planned.planned_minutes": "Planned (min)",
  "planned.worked_minutes": "Worked (min)",
  "planned.late_minutes": "Late (min)",
  "planned.flags": "Flags",
  "planned.no_show": "No-show",
  "planned.unplanned": "Unplanned",
  "planned.empty": "No planned or worked time for this week.",
  "planned.no_location": "No location configured yet.",
```
```ts
  // es:
  "nav.planned_actual": "Previsto vs real",
  "planned.title": "Previsto vs real",
  "planned.location": "Local",
  "planned.week": "Semana",
  "planned.person": "Persona",
  "planned.day": "Día",
  "planned.planned_minutes": "Previsto (min)",
  "planned.worked_minutes": "Trabajado (min)",
  "planned.late_minutes": "Retraso (min)",
  "planned.flags": "Avisos",
  "planned.no_show": "Ausencia",
  "planned.unplanned": "No previsto",
  "planned.empty": "No hay tiempo previsto ni trabajado esta semana.",
  "planned.no_location": "Aún no hay ningún local configurado.",
```

Run: `pnpm --filter @waitron/dashboard test strings` (if a keys-in-sync test exists) or `pnpm --filter @waitron/dashboard typecheck` — the `es` map is typed `Record<StringKey, string>`, so a missing `es` sibling is a compile error.

- [ ] **Step 4: Write the failing planned-actual-screen test** — create `apps/dashboard/src/screens/planned-actual-screen.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, PersonSummary, PlannedVsActualRow } from "../api/client.js";
import { PlannedActualScreen } from "./planned-actual-screen.js";

const staff: PersonSummary[] = [
  { personId: "p1", displayName: "Ana", role: "staff", status: "active", hasPassword: false, hasTotp: false },
];
const locations = [{ id: "loc-1", name: "Main" }];
const rows: PlannedVsActualRow[] = [
  { personId: "p1", workDate: "2026-03-02", plannedMinutes: 240, workedMinutes: 225, lateMinutes: 15, noShow: false, unplanned: false },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getLocations: vi.fn().mockResolvedValue(locations),
    listStaff: vi.fn().mockResolvedValue(staff),
    getPlannedVsActual: vi.fn().mockResolvedValue(rows),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: PlannedActualScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

describe("planned-actual-screen", () => {
  it("loads locations, staff and the week's rows on connect, resolving the person name", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", { api });
    await flush(el);
    expect(api.getLocations).toHaveBeenCalledTimes(1);
    expect(api.getPlannedVsActual).toHaveBeenCalledWith("loc-1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(el.shadowRoot!.textContent).toContain("Ana");
    expect(el.shadowRoot!.textContent).toContain("240");
  });

  it("passes a Monday..Monday+7 half-open window (from = Monday, to = from + 7 days)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", { api });
    await flush(el);
    const week = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=week-picker]")!;
    week.value = "2026-04-08"; // a Wednesday → Monday 2026-04-06, to 2026-04-13
    week.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenLastCalledWith("loc-1", "2026-04-06", "2026-04-13");
  });

  it("reloads on a location change", async () => {
    const api = stubApi({ getLocations: vi.fn().mockResolvedValue([{ id: "loc-1", name: "Main" }, { id: "loc-2", name: "Annex" }]) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", { api });
    await flush(el);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenLastCalledWith("loc-2", expect.any(String), expect.any(String));
  });

  it("shows the empty prompt when the week has no rows", async () => {
    const api = stubApi({ getPlannedVsActual: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=empty]")).not.toBeNull();
  });

  it("shows the no-location prompt when the tenant has no locations", async () => {
    const api = stubApi({ getLocations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-location]")).not.toBeNull();
    expect(api.getPlannedVsActual).not.toHaveBeenCalled();
  });

  it("shows the error banner when a load rejects", async () => {
    const api = stubApi({ getPlannedVsActual: vi.fn().mockRejectedValue({ code: "convenio.not_found" }) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", { api });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("convenio.not_found");
  });
});
```

Run: `pnpm --filter @waitron/dashboard test planned-actual-screen.test` → FAIL.

- [ ] **Step 5: Implement the planned-actual screen** — create `apps/dashboard/src/screens/planned-actual-screen.ts`:

```ts
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, LocationSummary, PersonSummary, PlannedVsActualRow } from "../api/client.js";
import { selectStyles } from "../select-styles.js";

const MS_PER_DAY = 86_400_000;

/** The local Monday (YYYY-MM-DD) of the week `dateStr` falls in — mirrors roster-validation's weekStartOf. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const mondayIndex = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - mondayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}
/** The exclusive end of the week starting at `monday` — Monday + 7 days (the half-open [from, to)). */
function weekEnd(monday: string): string {
  return new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * MS_PER_DAY).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The management dashboard's PLANNED-VS-ACTUAL SCREEN (design §3h): a location picker + week picker
 * whose from/to bound `[Monday, Monday+7)`, over a table of one (person, local day) row each —
 * planned vs worked minutes, late minutes, and the no-show / unplanned flags. Person ids render as
 * names via `listStaff`. Every async path is `try/catch`ed into the `errorKey` banner (the
 * roster-screen pattern); a location or week change reloads.
 */
@customElement("dashboard-planned-actual-screen")
export class PlannedActualScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host { display: block; }
      h1 { margin: 0 0 var(--wt-space-4); font-size: var(--wt-font-size-lg); color: var(--wt-color-text); }
      .pickers { display: flex; gap: var(--wt-space-4); margin-bottom: var(--wt-space-4); }
      .picker { display: flex; flex-direction: column; gap: var(--wt-space-1); color: var(--wt-color-text); }
      table { width: 100%; border-collapse: collapse; color: var(--wt-color-text); }
      th, td { background: var(--wt-color-surface); border: 1px solid var(--wt-color-border); padding: var(--wt-space-2); text-align: left; }
      .muted { color: var(--wt-color-text-muted); margin-top: var(--wt-space-3); }
      .error { color: var(--wt-color-danger); margin-top: var(--wt-space-3); }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @state() private locations: LocationSummary[] = [];
  @state() private locationId = "";
  @state() private staff: PersonSummary[] = [];
  @state() private weekMonday = mondayOf(today());
  @state() private rows: PlannedVsActualRow[] = [];
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [locations, staff] = await Promise.all([this.api.getLocations(), this.api.listStaff()]);
      this.locations = locations;
      this.staff = staff;
      if (locations.length === 0) {
        this.locationId = "";
        this.rows = [];
        return;
      }
      if (!locations.some((l) => l.id === this.locationId)) this.locationId = locations[0]!.id;
      await this.#loadRows();
    } catch (error) {
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    }
  }

  /** Load the selected location + week's comparison rows. Throws to its caller's catch. */
  async #loadRows(): Promise<void> {
    this.rows = await this.api.getPlannedVsActual(
      this.locationId,
      this.weekMonday,
      weekEnd(this.weekMonday),
    );
  }

  async #onSelectLocation(event: Event): Promise<void> {
    event.stopPropagation();
    this.locationId = (event.target as HTMLSelectElement).value;
    this.errorKey = null;
    try {
      await this.#loadRows();
    } catch (error) {
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    }
  }

  async #onSelectWeek(event: Event): Promise<void> {
    event.stopPropagation();
    const value = (event.target as HTMLInputElement).value;
    // A cleared <input type=date> (value "") builds an Invalid Date → RangeError; ignore it.
    if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return;
    this.weekMonday = mondayOf(value);
    this.errorKey = null;
    try {
      await this.#loadRows();
    } catch (error) {
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    }
  }

  #name(personId: string): string {
    return this.staff.find((p) => p.personId === personId)?.displayName ?? personId;
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("planned.title")}</h1>
      ${
        this.locations.length === 0
          ? html`<p class="muted" data-test="no-location">${t("planned.no_location")}</p>`
          : this.#renderBody()
      }
    `;
  }

  #renderBody(): TemplateResult {
    return html`
      <div class="pickers">
        <label class="picker"
          >${t("planned.location")}
          <select data-test="location-select" @change=${(e: Event) => void this.#onSelectLocation(e)}>
            ${this.locations.map((l) => html`<option value=${l.id} .selected=${l.id === this.locationId}>${l.name}</option>`)}
          </select>
        </label>
        <label class="picker"
          >${t("planned.week")}
          <input type="date" data-test="week-picker" .value=${this.weekMonday} @change=${(e: Event) => void this.#onSelectWeek(e)} />
        </label>
      </div>
      ${
        this.rows.length === 0
          ? html`<p class="muted" data-test="empty">${t("planned.empty")}</p>`
          : html`<table>
              <thead>
                <tr>
                  <th scope="col">${t("planned.person")}</th>
                  <th scope="col">${t("planned.day")}</th>
                  <th scope="col">${t("planned.planned_minutes")}</th>
                  <th scope="col">${t("planned.worked_minutes")}</th>
                  <th scope="col">${t("planned.late_minutes")}</th>
                  <th scope="col">${t("planned.flags")}</th>
                </tr>
              </thead>
              <tbody>
                ${this.rows.map(
                  (r) => html`<tr data-test=${`row-${r.personId}-${r.workDate}`}>
                    <th scope="row">${this.#name(r.personId)}</th>
                    <td>${r.workDate}</td>
                    <td>${r.plannedMinutes}</td>
                    <td>${r.workedMinutes}</td>
                    <td>${r.lateMinutes}</td>
                    <td>${[r.noShow ? t("planned.no_show") : "", r.unplanned ? t("planned.unplanned") : ""].filter(Boolean).join(" ")}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`
      }
      ${this.errorKey ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-planned-actual-screen": PlannedActualScreen;
  }
}
```

Run: `pnpm --filter @waitron/dashboard test planned-actual-screen.test` → PASS.

- [ ] **Step 6: Write the a11y test** — create `apps/dashboard/src/screens/planned-actual-screen.a11y.test.ts`, mirroring the approvals a11y test: two shapes (a week WITH rows and an EMPTY week), each scanned in both themes via `describe.each(["light","dark"])` + `expectNoA11yViolations(host)`. The `<table>` uses `<th scope>` row/column headers (already in the render) so the grid is screen-reader navigable.

Run: `pnpm --filter @waitron/dashboard test planned-actual-screen.a11y` → PASS (fix any axe finding).

- [ ] **Step 7: Wire the shell** — in `dashboard-app.ts`: add `import "./screens/planned-actual-screen.js";`; add `"planned-actual"` to the `Screen` union; add a nav button (`data-test="nav-planned-actual"`, `t("nav.planned_actual")`); add a `#renderScreen` case returning `<dashboard-planned-actual-screen .api=${this.api}></dashboard-planned-actual-screen>`. Update the doc comments to name all seven faces.

In `dashboard-app.test.ts`: add `"dashboard-planned-actual-screen"` to `SCREEN_TAGS`; add a `navPlannedActual` selector + accessor; add a nav test (mirroring the approvals one). Extend the shell `stubApi` with `getPlannedVsActual: vi.fn().mockResolvedValue([])` (the screen loads it on connect). Do the same in `dashboard-app.a11y.test.ts` and add a planned-actual a11y navigation case.

- [ ] **Step 8: Run + gate + commit** (whole dashboard package unfiltered):

```bash
pnpm --filter @waitron/dashboard typecheck
pnpm --filter @waitron/dashboard test:coverage
git add apps/dashboard/src/screens/planned-actual-screen.ts apps/dashboard/src/screens/planned-actual-screen.test.ts \
        apps/dashboard/src/screens/planned-actual-screen.a11y.test.ts apps/dashboard/src/api/client.ts \
        apps/dashboard/src/api/client.test.ts apps/dashboard/src/i18n/strings.ts \
        apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts apps/dashboard/src/dashboard-app.a11y.test.ts
git commit -s -m "feat(dashboard): planned-vs-actual screen + client method + i18n + nav"
```

---

## Final gate (before opening the PR)

Run the four-command gate for the whole workspace's breadth (CLAUDE.md §2), then the coverage + real-PG suites the hook/CI gate on:

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
pnpm --filter @waitron/identity --filter @waitron/workforce --filter @waitron/server --filter @waitron/dashboard test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test workforce-api.rls
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad
```

`pnpm test` and `test:coverage` differ (CI shards run `test:coverage`); run both. The pre-push hook narrows to the changed packages and their dependents — the unfiltered `main` merge is the only run that covers the rest, so a green hook is evidence about the packages that ran, not the workspace.

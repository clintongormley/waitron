# Floor plan FP-1 — Live floor + operable table service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give table service its first front-of-house UI — a live floor of occupancy-coloured cards, tap-to-run tabs, a per-line "served" ack, and a dashboard "Sala" config editor — so TS-1/TS-2's headless verbs become operable by staff.

**Architecture:** A `floor_zones` config table + `dining_tables.zone_id` + a nullable `working_order_lines.served_at` marker (all non-fiscal); server verbs (zone CRUD, `markLineServed`) and an extended occupancy read beside TS-1/TS-2's; HTTP config on the management API (`till.configure`) and operational reads/writes on the till API (session); two widget-composed till screens (floor + table-ordering) and one dashboard config screen. No spatial positioning — that is FP-2.

**Tech Stack:** TypeScript, Drizzle ORM + PostgreSQL (RLS), Hono (HTTP), Lit + Vite (till/dashboard), Vitest (+ browser mode for UI), Testcontainers + PGlite (db).

**Spec:** [docs/superpowers/specs/2026-08-17-floor-plan-fp1-live-floor-design.md](../specs/2026-08-17-floor-plan-fp1-live-floor-design.md) — read it alongside this plan; every task argues from it.

## ⛔ Prerequisites — this plan is BLOCKED until these are built and merged

FP-1 is the UI over **TS-1** (tables + tabs) and **TS-2** (statuses), which are **specced but unbuilt** at plan-writing time. Do **not** start Task 1 until both have landed on `main`. Before starting, **re-verify each borrowed symbol against the real built code** (CLAUDE.md §1 — the TS specs are a claim, the merged code is the receipt). Borrowed symbols and where the plan uses them:

- `dining_tables` table (`packages/db/src/schema/`) — its columns `id`, `tenant_id`, `location_id`, `label`, `capacity`, `active`, `tab_id`, and (the one FP-1 changes) `zone text`. **Task 1.**
- `openTab(tx, cfg, { tableId, lines? }) → { tabId, orderNumber }`, `addTabRound(tx, cfg, tabId, lines) → void` (`apps/server/src/working-order.ts`). **Tasks 3, 9.**
- `listTablesWithState(tx, cfg, locationId?) → TableState[]` (TS-1) extended by TS-2 with `status` (`apps/server/src/tables.ts` or `working-order.ts` — verify which file). **Task 4.**
- `setTableStatus(tx, cfg, tableId, statusId | null)` (TS-2). **Task 9.**
- TS-1 routes `GET /api/tables/state`, `POST /api/tables/:id/tab`, `POST /api/working-orders/:id/round`, and the pay-closes-the-tab path (`payWorkingOrder` with the tab's order id). **Tasks 6, 7, 9.**
- TS-1's `table.*` / `tab.*` error codes (`apps/server/src/errors.ts`). **Task 2.**

If a borrowed symbol's shape differs from the spec, **fix the plan task before coding it** — do not code around a stale signature.

## Global Constraints

_Every task's requirements implicitly include this section. Values copied verbatim from the spec._

- **English identifiers only** — `floor_zones`, `zone_id`, `served_at`, `display_order`, `name`, `active`. No new `SPANISH_WORDS`. UI copy localised en/es via the app i18n layers. (`packages/db/src/english-only.ts` scans `packages/db` schema tokens.)
- **Domain-named error codes, never the package** (CLAUDE.md §3): new codes `zone.name_taken`, `zone.not_found`; reuse TS-1's `table.*` / `tab.*`. Declared in `apps/server/src/errors.ts`; the throwing file does `import "./errors.js"`. **Never renamed once shipped.**
- **Permissions:** reuse `till.configure` (config, already exists — `packages/identity/src/permissions.ts:16`) and `requireSession` (operate). **No new permission.**
- **Non-fiscal, no exceptions:** nothing writes `registros_facturacion` / a `huella` / an invoice number / a chain link. Pay reuses `payWorkingOrder → recordSale` **unchanged**. `served_at` is **never** read into a filed record; a test pins the huella is independent of it.
- **No backwards-compat / data-migration code** (pre-production — drop/recreate, no backfill).
- **Migration number via `pnpm --filter @waitron/db db:generate`** against the live tree — never hardcode; other slices/the campaign may consume numbers first. Commit `meta/_journal.json` + snapshot.
- **Coverage:** `packages/db`, `apps/server` → **98/98/98/95**; `apps/till`, `apps/dashboard` → **95/95/90/88**.
- **Testing discipline:** real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally (CLAUDE.md §4). RLS/privilege behaviour is a **false pass on PGlite** — use real Postgres for it. Run `packages/db` **unfiltered** so tree-wide guards load. Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after the migration.
- **Prove guards by deletion** — remove the check, watch the test fail, restore it (CLAUDE.md §4).

## File Structure

**Created:**
- `packages/db/src/schema/floor-zones.ts` — the `floor_zones` table (schema only).
- `packages/db/src/schema/floor-zones.rls.test.ts` — real-PG RLS isolation + column-visibility.
- `packages/db/drizzle/<NNNN>_floor_plan_fp1.sql` — auto columns (via `db:generate`).
- `packages/db/drizzle/<NNNN>_floor_plan_fp1_rls.sql` — custom FORCE-RLS + FK (hand-written).
- `apps/till/src/screens/till-floor-screen.ts` (+ `.test.ts`, `.a11y.test.ts`) — the live floor.
- `apps/till/src/screens/till-table-order-screen.ts` (+ `.test.ts`, `.a11y.test.ts`) — the tab ordering screen.
- `apps/dashboard/src/screens/sala-screen.ts` (+ `.test.ts`, `.a11y.test.ts`) — zones + tables config.

**Modified:**
- `packages/db/src/schema/index.ts` — register `floor_zones`.
- `packages/db/src/schema/orders.ts` — add `served_at` to `working_order_lines`.
- `packages/db/src/schema/<dining-tables>.ts` (TS-1) — drop `zone text`, add `zone_id` column (bare — the FK is hand-written in the custom migration, as TS-1 does for `tab_id`).
- `apps/server/src/tables.ts` — zone CRUD verbs; extend `listTablesWithState` with `zoneId` + `pendingToServe`.
- `apps/server/src/working-order.ts` — `markLineServed` / `unmarkLineServed`.
- `apps/server/src/errors.ts` — `zone.name_taken`, `zone.not_found`.
- `apps/server/src/management-api.ts` — zones CRUD routes + table config wrappers (`till.configure`).
- `apps/server/src/till-api.ts` — `GET /api/zones`; served route; `/api/tables/state` gains the new fields.
- `apps/till/src/api/client.ts` — `TillApi` methods (`listZones`, extended `getTablesState`, `markLineServed`, and any of `openTab`/`addTabRound` TS-1 didn't add).
- `apps/till/src/till-app.ts` — register `floor` + `table-order` screens (union, imports, `#renderScreen`, transitions).
- `apps/dashboard/src/dashboard-app.ts` — register the `sala` screen (union, import, nav, `#renderScreen`).
- `apps/dashboard/src/api/client.ts` — `DashboardApi` zone + table config methods.
- `docs/backlog.md` — floor-plan-track row (Task 11).

---

### Task 1: Schema — `floor_zones`, `dining_tables.zone_id`, `working_order_lines.served_at` + migration + RLS

**Files:**
- Create: `packages/db/src/schema/floor-zones.ts`, `packages/db/src/schema/floor-zones.rls.test.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/schema/orders.ts:167` (add column), `packages/db/src/schema/<dining-tables>.ts` (TS-1 — drop `zone`, add `zone_id`)
- Create (generated): `packages/db/drizzle/<NNNN>_floor_plan_fp1.sql`, `packages/db/drizzle/<NNNN>_floor_plan_fp1_rls.sql`

**Interfaces:**
- Produces: the `floorZones` Drizzle table export (`id, tenantId, locationId, name, displayOrder, active, createdAt`); `working_order_lines.served_at` column; `dining_tables.zone_id` column.
- Consumes: TS-1's `dining_tables` table; `packages/db`'s `current_tenant_id()` (`0001_tenancy_rls.sql:52-65`); the RLS custom-migration idiom (`0036_till_layouts_rls.sql:24-30`).

- [ ] **Step 1: Write the `floor_zones` schema.** Model the file on an existing tenant+location table (mirror TS-2's `table_service_statuses` shape). Create `packages/db/src/schema/floor-zones.ts`:

```ts
import { pgTable, uuid, text, integer, boolean, timestamp, unique, foreignKey } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { locations } from "./locations.js";

export const floorZones = pgTable(
  "floor_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    unique("floor_zones_tenant_id_key").on(t.tenantId, t.id),
    unique("floor_zones_name_key").on(t.tenantId, t.locationId, t.name),
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "floor_zones_location_fk",
    }),
  ],
);
```

(Verify the exact `locations` composite-key column names against the built schema — mirror the composite FK TS-1's `dining_tables` uses to `locations`.)

- [ ] **Step 2: Register + add the two columns.** In `packages/db/src/schema/index.ts` add `export * from "./floor-zones.js";`. In `orders.ts`, in `working_order_lines` after `category` (`:167`), add:

```ts
servedAt: timestamp("served_at", { withTimezone: true, mode: "string" }),
```

In TS-1's `dining-tables.ts`: remove the `zone: text("zone")` column and add a bare `zoneId: uuid("zone_id")` (no `.references()` — the composite FK is hand-written in Step 4, as TS-1 does for `tab_id`).

- [ ] **Step 3: Generate the auto migration.** Run `pnpm --filter @waitron/db db:generate`. Expected: one migration adding `floor_zones` (columns only, no policy), adding `working_order_lines.served_at`, dropping `dining_tables.zone`, adding `dining_tables.zone_id`. **Verify it emits nothing else.** Note the number `<NNNN>` it chose.

- [ ] **Step 4: Hand-write the custom RLS + FK migration.** Create `packages/db/drizzle/<NNNN+1>_floor_plan_fp1_rls.sql` (add its entry to `meta/_journal.json` the way a `--custom` migration is registered — mirror `0036`'s journal entry):

```sql
-- floor_zones: FORCE RLS + tenant isolation + app_user grants (mutable config, no DELETE).
-- Modelled on 0036_till_layouts_rls.sql. The inmutabilidad scan requires FORCE on every tenant_id table.
ALTER TABLE "floor_zones" FORCE ROW LEVEL SECURITY;
CREATE POLICY "floor_zones_tenant_isolation" ON "floor_zones"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON "floor_zones" FROM app_user;
GRANT SELECT, INSERT, UPDATE ON "floor_zones" TO app_user;

-- dining_tables.zone_id composite FK → floor_zones (bare column added by the auto migration).
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_zone_fk"
  FOREIGN KEY ("tenant_id", "zone_id") REFERENCES "floor_zones" ("tenant_id", "id");
```

- [ ] **Step 5: Write the RLS + visibility test.** Create `packages/db/src/schema/floor-zones.rls.test.ts` using the real-PG harness (`useRealPostgres` / `describeEachTarget` — RLS is a false pass on PGlite, CLAUDE.md §4). Assert: (a) tenant A cannot read tenant B's zone; (b) a cross-tenant INSERT is refused by `WITH CHECK`; (c) `app_user` can SELECT/INSERT/UPDATE its own zone and the new `dining_tables.zone_id` / `working_order_lines.served_at` columns are visible under the app role.

```ts
// Positive isolation + negative WITH CHECK. Prove FORCE by deletion (Step 7).
it("hides another tenant's zone and refuses a cross-tenant insert", async () => {
  const db = realDb();
  await withTenant(db, tenantA, async (tx) => {
    await asAppUser(tx, async (q) => {
      await q.insert(floorZones).values({ tenantId: tenantA, locationId: locA, name: "Comedor" });
    });
  });
  await withTenant(db, tenantB, async (tx) => {
    await asAppUser(tx, async (q) => {
      const rows = await q.select().from(floorZones);
      expect(rows).toHaveLength(0); // A's zone invisible to B
      await expect(
        q.insert(floorZones).values({ tenantId: tenantA, locationId: locA, name: "X" }),
      ).rejects.toThrow(); // WITH CHECK refuses foreign tenant_id
    });
  });
});
```

(Use the harness's real accessors — `useRealPostgres`, `withTenant`, `asAppUser` — not a hand-rolled client. Match the sibling `till_layouts.rls.test.ts` / `management-sessions.rls.test.ts` structure.)

- [ ] **Step 6: Run the tests + guards.** `pnpm --filter @waitron/db test:coverage floor-zones` (PASS) and, unfiltered, `pnpm --filter @waitron/db test:coverage` (tree-wide guards). Then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — **`floor_zones` must report `relforcerowsecurity = true`**; a missing FORCE fails `nonCompliant`.

- [ ] **Step 7: Prove FORCE + policy by deletion.** Temporarily delete the `FORCE ROW LEVEL SECURITY` line, regenerate the test DB, run the RLS test + inmutabilidad → confirm they go **red**. Restore. Repeat for the `WITH CHECK` clause (the cross-tenant INSERT should then succeed → red). This proves the guards test the guard.

- [ ] **Step 8: Commit.**

```bash
git add packages/db/src/schema/floor-zones.ts packages/db/src/schema/index.ts \
        packages/db/src/schema/orders.ts packages/db/src/schema/*dining* \
        packages/db/src/schema/floor-zones.rls.test.ts packages/db/drizzle/
git commit -s -m "feat(db): floor_zones + zone_id + served_at with FORCE RLS"
```

---

### Task 2: Error codes — `zone.name_taken`, `zone.not_found`

**Files:**
- Modify: `apps/server/src/errors.ts` (the `declare module "@waitron/shared"` block, `:16-383`)
- Test: `apps/server/src/errors.test.ts` (or the sibling registration test — match how `working_order.*` codes are tested)

**Interfaces:**
- Produces: registered error codes `zone.name_taken` (409/400 — match the sibling `*.*_taken` convention already in the registry) and `zone.not_found` (404).
- Consumes: the `apps/server` error-registry idiom (`import "@waitron/shared"` anchor `:4`; the `import "./errors.js"` side-effect, e.g. `till-api.ts:42`).

- [ ] **Step 1: Grep the siblings first** (CLAUDE.md §3). `grep -n '"[a-z_]*\.\(not_found\|name_taken\|label_taken\)"' apps/server/src/errors.ts` — confirm the status codes and param shape the existing `*.not_found` / `*.label_taken` codes use, and that no `zone.*` code exists. Match them exactly (e.g. if TS-1 used `table.label_taken`, prefer `zone.name_taken` only if `name` is the field — otherwise align to `label_taken`; the spec says `name`, so `zone.name_taken`).

- [ ] **Step 2: Write the failing registration test.** Assert both codes resolve to a status and carry no value-echoing params:

```ts
it("registers zone.* codes", () => {
  expect(statusForCode("zone.not_found")).toBe(404);
  expect(statusForCode("zone.name_taken")).toBe(409); // match the sibling *_taken status
});
```

(Use whatever assertion the existing `working_order.*` codes use — mirror `errors.test.ts`.)

- [ ] **Step 3: Run it — FAIL** (`zone.*` unregistered).

- [ ] **Step 4: Add the codes** to the `declare module "@waitron/shared" { interface ErrorParams { … } }` block and the status map, beside the `working_order.*` entries (`:261`+):

```ts
"zone.not_found": Record<string, never>;
"zone.name_taken": Record<string, never>;
```

(Add their status-map entries wherever `working_order.not_found` etc. set theirs — 404 / 409 to match siblings.)

- [ ] **Step 5: Run it — PASS.** Then `pnpm --filter @waitron/server test:coverage errors`.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/errors.ts apps/server/src/errors.test.ts
git commit -s -m "feat(server): zone.not_found + zone.name_taken error codes"
```

---

### Task 3: Zone CRUD verbs (`apps/server/src/tables.ts`)

**Files:**
- Modify: `apps/server/src/tables.ts` (beside TS-1's table CRUD)
- Test: `apps/server/src/tables.test.ts` (PGlite — verb logic; no privilege behaviour here)

**Interfaces:**
- Consumes: TS-1's `cfg` / transaction conventions in `tables.ts`; the `floorZones` table (Task 1); `zone.*` codes (Task 2).
- Produces:
  - `createZone(tx, cfg, input: { name: string; displayOrder?: number }): Promise<{ id: string }>`
  - `listZones(tx, cfg): Promise<FloorZone[]>` (active, by `displayOrder`)
  - `updateZone(tx, cfg, id: string, patch: { name?: string; displayOrder?: number; active?: boolean }): Promise<void>`
  - `deactivateZone(tx, cfg, id: string): Promise<void>`
  - `FloorZone = { id; name; displayOrder; active }`

- [ ] **Step 1: Write the failing test** (PGlite via `usePgliteDb` + `runMigrations`):

```ts
it("creates, lists (ordered, active-only), renames, deactivates a zone", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  const { id } = await createZone(tx, cfg, { name: "Comedor", displayOrder: 1 });
  await createZone(tx, cfg, { name: "Terraza", displayOrder: 0 });
  expect((await listZones(tx, cfg)).map((z) => z.name)).toEqual(["Terraza", "Comedor"]);
  await updateZone(tx, cfg, id, { name: "Salón" });
  await deactivateZone(tx, cfg, id);
  expect((await listZones(tx, cfg)).map((z) => z.name)).toEqual(["Terraza"]); // inactive hidden
});

it("rejects a duplicate name and an unknown id", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  await createZone(tx, cfg, { name: "Comedor" });
  await expect(createZone(tx, cfg, { name: "Comedor" })).rejects.toMatchObject({ code: "zone.name_taken" });
  await expect(updateZone(tx, cfg, randomUuid(), { name: "X" })).rejects.toMatchObject({ code: "zone.not_found" });
});
```

- [ ] **Step 2: Run — FAIL** (verbs undefined).

- [ ] **Step 3: Implement the verbs** in `tables.ts`, importing `"./errors.js"`. Catch the `(tenant_id, location_id, name)` unique 23505 → `zone.name_taken`; a 0-row UPDATE → `zone.not_found`. Mirror TS-1's `createTable`/`updateTable` error-mapping exactly (same 23505 catch shape). Scope every query to `cfg` (tenant + location).

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Run coverage** — `pnpm --filter @waitron/server test:coverage tables`.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/tables.ts apps/server/src/tables.test.ts
git commit -s -m "feat(server): floor-zone CRUD verbs"
```

---

### Task 4: `markLineServed` + occupancy read extension

**Files:**
- Modify: `apps/server/src/working-order.ts` (the `markLineServed` verbs), `apps/server/src/tables.ts` (extend `listTablesWithState`)
- Test: `apps/server/src/working-order.test.ts`, `apps/server/src/tables.test.ts` (PGlite)

**Interfaces:**
- Consumes: TS-1's `openTab` / `addTabRound` / `listTablesWithState`; `working_order_lines.served_at` (Task 1); `tab.not_open` / `tab.line_not_found` (TS-1).
- Produces:
  - `markLineServed(tx, cfg, tabId: string, lineNo: number): Promise<void>` (sets `served_at = now()`)
  - `unmarkLineServed(tx, cfg, tabId: string, lineNo: number): Promise<void>` (clears it)
  - `listTablesWithState` result gains `zoneId?: string` and `pendingToServe: number` (open-tab lines with `served_at IS NULL`; `0` for a free table).

- [ ] **Step 1: Write the failing `markLineServed` test:**

```ts
it("marks one line served on an open tab, and refuses a settled tab / unknown line", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  const { id: tableId } = await createTable(tx, cfg, { label: "4" });
  const { tabId } = await openTab(tx, cfg, { tableId, lines: [line("cafe"), line("tostada")] });
  await markLineServed(tx, cfg, tabId, 1);
  const rows = await lines(tx, tabId);
  expect(rows.find((l) => l.lineNo === 1)!.servedAt).not.toBeNull();
  expect(rows.find((l) => l.lineNo === 2)!.servedAt).toBeNull();
  await expect(markLineServed(tx, cfg, tabId, 99)).rejects.toMatchObject({ code: "tab.line_not_found" });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `markLineServed` / `unmarkLineServed`** in `working-order.ts`, importing `"./errors.js"`: assert the order is an `open` tab (else `tab.not_open`, reusing TS-1's open-tab check), UPDATE the line's `served_at`; a 0-row UPDATE → `tab.line_not_found`.
- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Write the failing occupancy-read test** (extends TS-1's):

```ts
it("reports zoneId and pendingToServe, and both clear correctly", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  const { id: zoneId } = await createZone(tx, cfg, { name: "Comedor" });
  const { id: tableId } = await createTable(tx, cfg, { label: "4" });
  await updateTable(tx, cfg, tableId, { zoneId }); // TS-1 PATCH now carries zoneId
  const { tabId } = await openTab(tx, cfg, { tableId, lines: [line("a"), line("b")] });
  let s = (await listTablesWithState(tx, cfg)).find((t) => t.id === tableId)!;
  expect(s.zoneId).toBe(zoneId);
  expect(s.pendingToServe).toBe(2);
  await markLineServed(tx, cfg, tabId, 1);
  s = (await listTablesWithState(tx, cfg)).find((t) => t.id === tableId)!;
  expect(s.pendingToServe).toBe(1);
});
```

- [ ] **Step 6: Run — FAIL** (`zoneId`/`pendingToServe` absent).
- [ ] **Step 7: Extend `listTablesWithState`** — add `dining_tables.zone_id` to the select, and a correlated `COUNT(*) FILTER (WHERE served_at IS NULL)` over the open tab's lines (LEFT-joined so a free table yields `0`). Keep TS-1's `state`/`status`/`pendingDeliveries` fields intact (do not regress the TS-2 `status` join — CLAUDE.md "preserve behavioural assertions"). Note `pendingToServe` (tab lines) is **distinct** from TS-1's `pendingDeliveries` (counter deliveries) — keep both.
- [ ] **Step 8: Run — PASS**, then `pnpm --filter @waitron/server test:coverage working-order tables`.

- [ ] **Step 9: Commit.**

```bash
git add apps/server/src/working-order.ts apps/server/src/tables.ts \
        apps/server/src/working-order.test.ts apps/server/src/tables.test.ts
git commit -s -m "feat(server): markLineServed + zoneId/pendingToServe on occupancy read"
```

---

### Task 5: Management API — zones config routes (+ table config wrappers), `till.configure`

**Files:**
- Modify: `apps/server/src/management-api.ts`
- Test: `apps/server/src/management-api.test.ts` (real-PG e2e — auth is privilege behaviour)

**Interfaces:**
- Consumes: zone verbs (Task 3); `requireManagementSession` (`management-api.ts:278`); `authorizeManager(till.configure)` (the layout routes' gate, `:437-450`); TS-1's table verbs.
- Produces: `GET/POST /management-api/zones`, `PATCH/DELETE /management-api/zones/:id`; and table config wrappers `GET/POST /management-api/tables`, `PATCH/DELETE /management-api/tables/:id` (thin calls into TS-1's `createTable`/`listTables`/`updateTable`/`deactivateTable`).

- [ ] **Step 1: Write the failing e2e test** (mirror the layout-routes tests):

```ts
it("401 unauth, 403 non-manager, 200/204 for a manager, cross-tenant isolated", async () => {
  await expect(GET("/management-api/zones", { session: null })).resolves.toMatchObject({ status: 401 });
  await expect(GET("/management-api/zones", { session: staffSession })).resolves.toMatchObject({ status: 403 });
  const created = await POST("/management-api/zones", { session: managerSession, body: { name: "Comedor" } });
  expect(created.status).toBe(201);
  const list = await GET("/management-api/zones", { session: managerSession });
  expect(list.body.map((z: any) => z.name)).toContain("Comedor");
});
```

- [ ] **Step 2: Run — FAIL** (routes 404).
- [ ] **Step 3: Mount the routes** in `mountManagementApi` (`:186`), each wrapped in `run` (`:135`): `requireManagementSession(c)` first (401), then the verb calls `authorizeManager(tx, { managementSessionId, permission: "till.configure" })` under `withTenant` + `asAppUser` (exactly the layout `PUT` shape, `:461-484`). Body-shape screen mirrors `:250-266`. Add `zone.*` to the `STATUS` map explicitly (`:80-128`, even though `?? 400`/the code's own status covers them — house style). Table wrappers delegate to TS-1's verbs (do **not** duplicate table logic).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Prove the gate by deletion** — drop the `authorizeManager` call, confirm the 403 test goes red (a differential proof that fails if the gate is dropped), restore.
- [ ] **Step 6: Coverage** — `pnpm --filter @waitron/server test:coverage management-api`.
- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/management-api.ts apps/server/src/management-api.test.ts
git commit -s -m "feat(server): management-api zone + table config routes (till.configure)"
```

---

### Task 6: Till API — `GET /api/zones`, served route, `/api/tables/state` fields

**Files:**
- Modify: `apps/server/src/till-api.ts`
- Test: `apps/server/src/till-api.test.ts` (real-PG e2e)

**Interfaces:**
- Consumes: `listZones` (Task 3); `markLineServed`/`unmarkLineServed` (Task 4); the extended `listTablesWithState` (Task 4); `requireSession` (`till-api.ts:255`); `requireUuidId` (`:118-126`).
- Produces: `GET /api/zones` → `FloorZone[]`; `POST /api/working-orders/:id/lines/:lineNo/served` (+ `DELETE` to clear); `GET /api/tables/state` responses now carry `zoneId` + `pendingToServe`.

- [ ] **Step 1: Write the failing e2e test:**

```ts
it("lists zones, marks a line served, and surfaces pendingToServe in the state read", async () => {
  const s = operatorSession();
  const { id: zoneId } = await createZoneViaMgmt("Comedor");
  const { id: tableId } = await createTableViaMgmt("4", zoneId);
  const { tabId } = await POST(`/api/tables/${tableId}/tab`, { session: s, body: { lines: [p("cafe"), p("tostada")] } });
  expect((await GET("/api/zones", { session: s })).body.map((z: any) => z.name)).toContain("Comedor");
  let state = (await GET("/api/tables/state", { session: s })).body.find((t: any) => t.id === tableId);
  expect(state.zoneId).toBe(zoneId); expect(state.pendingToServe).toBe(2);
  await POST(`/api/working-orders/${tabId}/lines/1/served`, { session: s });
  state = (await GET("/api/tables/state", { session: s })).body.find((t: any) => t.id === tableId);
  expect(state.pendingToServe).toBe(1);
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Add the routes** in `mountTillApi` (`:134`), each `requireSession`-gated (`:255`) and wrapped in `run` (`:107`); UUID/`lineNo` path params via `requireUuidId` + an integer screen (4xx not 500). `GET /api/tables/state` already exists (TS-1) — confirm the extended fields flow through its serializer (they should, from Task 4). Add any new codes to the `STATUS` map (`:84-101`).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Coverage** — `pnpm --filter @waitron/server test:coverage till-api`.
- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.test.ts
git commit -s -m "feat(server): till-api zones + served + pendingToServe on state read"
```

---

### Task 7: Till API client methods (`TillApi`)

**Files:**
- Modify: `apps/till/src/api/client.ts`
- Test: `apps/till/src/api/client.test.ts` (unit — a `FetchLike` stub)

**Interfaces:**
- Consumes: the till routes (Tasks 6) and TS-1's tab routes; the `#request<T>` helper (`client.ts:518-536`).
- Produces (locally-mirrored types, per the file's rule `:1-22`): `listZones()`, `getTablesState()` (returns `TableState[]` incl. `zoneId`, `pendingToServe`, `status`), `markLineServed(orderId, lineNo)`, `unmarkLineServed(orderId, lineNo)`; and `openTab(tableId, lines?)` / `addTabRound(orderId, lines)` **only if TS-1 did not already add them** (check first).

- [ ] **Step 1: Write the failing test** (stub `FetchLike`, assert method+path+body and decoded shape):

```ts
it("markLineServed POSTs the served path", async () => {
  const fetch = stubFetch({ status: 200, body: "" });
  await new TillApi(fetch).markLineServed("ord-1", 2);
  expect(fetch).toHaveBeenCalledWith("/api/working-orders/ord-1/lines/2/served",
    expect.objectContaining({ method: "POST", credentials: "include" }));
});
it("getTablesState decodes zoneId + pendingToServe", async () => {
  const fetch = stubFetch({ status: 200, body: JSON.stringify([{ id: "t1", zoneId: "z1", pendingToServe: 2, state: "open-tab" }]) });
  const rows = await new TillApi(fetch).getTablesState();
  expect(rows[0]).toMatchObject({ zoneId: "z1", pendingToServe: 2 });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Add the methods** funnelling through `#request` (`:518-536`), each with a local response type in the header's mirrored-types block (`:1-22`). Do **not** import server types (bundle-decoupled rule).
- [ ] **Step 4: Run — PASS**, then `pnpm --filter @waitron/till test:coverage client`.
- [ ] **Step 5: Commit.**

```bash
git add apps/till/src/api/client.ts apps/till/src/api/client.test.ts
git commit -s -m "feat(till): TillApi zone/served/state methods"
```

---

### Task 8: Till live floor screen (`till-floor-screen`)

**Files:**
- Create: `apps/till/src/screens/till-floor-screen.ts`, `…/till-floor-screen.test.ts`, `…/till-floor-screen.a11y.test.ts`
- Modify: `apps/till/src/till-app.ts` (register the screen)

**Interfaces:**
- Consumes: `getTablesState()` + `listZones()` (Task 7); the till screen machine (`till-app.ts:37` union, `:782-816` `#renderScreen`, `:10-13` imports). Emits an `open-table` event `{ tableId, hasOpenTab }` the app turns into a `table-order` transition.
- Produces: the `<till-floor-screen>` element with props `.zones`, `.tables` and events `open-table`.

- [ ] **Step 1: Write the failing render test** (Lit + vitest browser, mirror `till-counter-screen.test.ts`):

```ts
it("groups tables by zone and shows occupancy + por-servir badges", async () => {
  const el = await fixture(html`<till-floor-screen
    .zones=${[{ id: "z1", name: "Comedor" }]}
    .tables=${[{ id: "t1", label: "4", zoneId: "z1", state: "open-tab", tabTotal: "47.50", pendingToServe: 2, status: null }]}
  ></till-floor-screen>`);
  expect(el).shadowDom.to.contain.text("Comedor");
  expect(el).shadowDom.to.contain.text("47.50");
  expect(el.shadowRoot!.querySelector('[data-por-servir]')!.textContent).toContain("2");
});
it("emits open-table on tap", async () => {
  const el = await fixture(/* one free table t1 */);
  setTimeout(() => el.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!.click());
  const e = await oneEvent(el, "open-table");
  expect(e.detail).toEqual({ tableId: "t1", hasOpenTab: false });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement the screen** — a `LitElement` with `@property() zones` / `tables`; render zone tabs (by `displayOrder`), a "Sin zona" tab for `zoneId == null`, and occupancy-coloured **cards in a responsive grid** (free / open-tab-with-total·lines·time / delivery-pending from `pendingDeliveries`), a status badge (`status.color`/`label`), and a `data-por-servir` badge when `pendingToServe > 0`. A tap dispatches `open-table` (composed, bubbling). Colours/spacing from theme tokens — no hardcoded chrome hex (follow `till-counter-screen`'s token use).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Register in the app** — add `"floor"` to `Screen` (`till-app.ts:37`), a side-effect import (`:10-13`), a `#renderScreen` case wiring `.zones`/`.tables` from state + an `@open-table` handler that opens the tab (free → `openTab` then transition; open → transition) and sets `this.screen = "table-order"`. Add a nav affordance to reach the floor (mirror `#onShowSchedule`).
- [ ] **Step 6: Write + run the a11y test** (`till-floor-screen.a11y.test.ts`, both themes, axe — mirror `till-counter-screen.a11y.test.ts`). PASS.
- [ ] **Step 7: Coverage** — `pnpm --filter @waitron/till test:coverage floor`.
- [ ] **Step 8: Commit.**

```bash
git add apps/till/src/screens/till-floor-screen.* apps/till/src/till-app.ts
git commit -s -m "feat(till): live floor screen (occupancy cards grouped by zone)"
```

---

### Task 9: Till table-ordering screen (`till-table-order-screen`)

**Files:**
- Create: `apps/till/src/screens/till-table-order-screen.ts` (+ `.test.ts`, `.a11y.test.ts`)
- Modify: `apps/till/src/till-app.ts` (register + wire pay/status)

**Interfaces:**
- Consumes: `product-grid` / `basket` / `total` / `tender-pay` widgets + `WorkingOrderStore` (`till-app.ts:136`); `addTabRound`, `markLineServed`, the tab read, the pay path, `setTableStatus` (TS-2). Receives the tab's `orderId` + its current lines/total from the app.
- Produces: the `<till-table-order-screen>` element; events `send-round` (lines), `serve-line` (lineNo), `pay-tab`, `set-status`.

- [ ] **Step 1: Write the failing tests** (round bar → send-round; drawer → serve/pay):

```ts
it("accumulates a round and emits send-round with the picked lines", async () => {
  const el = await fixture(/* screen with a product catalogue */);
  el.shadowRoot!.querySelector<HTMLElement>('[data-product="cafe"]')!.click();
  setTimeout(() => el.shadowRoot!.querySelector<HTMLElement>('[data-send-round]')!.click());
  const e = await oneEvent(el, "send-round");
  expect(e.detail.lines[0]).toMatchObject({ productId: "cafe" });
});
it("shows pending-to-serve lines with a Servido tick that emits serve-line", async () => {
  const el = await fixture(/* screen with one un-served line lineNo=1 */);
  el.shadowRoot!.querySelector<HTMLElement>('[data-open-drawer]')!.click();
  setTimeout(() => el.shadowRoot!.querySelector<HTMLElement>('[data-serve="1"]')!.click());
  const e = await oneEvent(el, "serve-line");
  expect(e.detail).toEqual({ lineNo: 1 });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement the screen** — full-width `product-grid`; a round-scoped `basket` in a bottom bar whose **Enviar ronda** emits `send-round`; a right-edge **handle badged with `pendingToServe`** that opens a drawer listing **Pendiente de servir** (each a `data-serve` tick → `serve-line`), **Servido**, **total**, **Cobrar** (`pay-tab`), **Estado** (`set-status`), and a **disabled Mover · Dividir** button. Reuse the existing widgets; do not fork them. Theme tokens only.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Wire in the app** — add `"table-order"` to `Screen`, the import, a `#renderScreen` case, and handlers: `@send-round` → `api.addTabRound(orderId, lines)` then refresh; `@serve-line` → `api.markLineServed(orderId, lineNo)`; `@pay-tab` → the existing pay flow with the tab's `orderId` (reuse the counter screen's confirm-payment path — no new fiscal verb); `@set-status` → `api.setTableStatus(...)`. Back-to-floor transition mirrors `#onBackToCounter` (`:724-727`).
- [ ] **Step 6: a11y test** both themes → PASS.
- [ ] **Step 7: Coverage** — `pnpm --filter @waitron/till test:coverage table-order`.
- [ ] **Step 8: Commit.**

```bash
git add apps/till/src/screens/till-table-order-screen.* apps/till/src/till-app.ts
git commit -s -m "feat(till): table-ordering screen (round bar + pull-out tab drawer)"
```

---

### Task 10: Dashboard "Sala" config screen

**Files:**
- Create: `apps/dashboard/src/screens/sala-screen.ts` (+ `.test.ts`, `.a11y.test.ts`)
- Modify: `apps/dashboard/src/dashboard-app.ts` (register), `apps/dashboard/src/api/client.ts` (methods)

**Interfaces:**
- Consumes: `/management-api/zones` + `/management-api/tables*` (Task 5); the dashboard shell (`dashboard-app.ts:29-39` union, `:209-262` nav, `:270-296` `#renderScreen`); the `layout-screen.ts` pattern.
- Produces: `<sala-screen>`; `DashboardApi` methods `listZones/createZone/updateZone/deactivateZone` and `listTables/createTable/updateTable/deactivateTable` (local types).

- [ ] **Step 1: Add + test the `DashboardApi` methods** (unit, `FetchLike` stub — mirror `layout` client methods): assert paths/bodies for the zones + tables management routes. Run → FAIL → implement → PASS.
- [ ] **Step 2: Write the failing screen test** (mirror `layout-screen.test.ts`): loads `listZones`/`listTables`, renders both panels, creating a zone calls `createZone`, assigning a table's zone calls `updateTable({ zoneId })`.

```ts
it("creates a zone and assigns a table's zone", async () => {
  const api = fakeDashboardApi({ zones: [], tables: [{ id: "t1", label: "4", zoneId: null }] });
  const el = await fixture(html`<sala-screen .api=${api}></sala-screen>`);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLInputElement>('[data-new-zone]')!.value = "Comedor";
  el.shadowRoot!.querySelector<HTMLElement>('[data-add-zone]')!.click();
  expect(api.createZone).toHaveBeenCalledWith({ name: "Comedor" });
});
```

- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement `sala-screen`** on `@waitron/ui` primitives (mirror `layout-screen.ts`): a **Zonas** panel (list + create/rename/reorder/deactivate) and a **Mesas** panel (list + create/edit label·plazas·zone·active). `role="alert"` for `zone.name_taken`/`table.*` rejections. Both-theme, a11y-first.
- [ ] **Step 5: Register in the shell** — `Screen` union member `"sala"` (`:29-39`), import (`:8-17`), a manager-nav button (`#nav` `:209-262`), a `#renderScreen` case (`:270-296`).
- [ ] **Step 6: Run the screen test — PASS**; write + run the `.a11y.test.ts` both themes.
- [ ] **Step 7: Coverage** — `pnpm --filter @waitron/dashboard test:coverage sala`.
- [ ] **Step 8: Commit.**

```bash
git add apps/dashboard/src/screens/sala-screen.* apps/dashboard/src/dashboard-app.ts apps/dashboard/src/api/client.ts
git commit -s -m "feat(dashboard): Sala config screen (zones + tables)"
```

---

### Task 11: Fiscal-independence test, guards sweep, backlog + churn

**Files:**
- Create/Modify: a huella-independence test in `packages/fiscal-verifactu` or `packages/core` (beside the existing `entorno`-not-in-hash test)
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: everything above; `recordSale` + the alta builders (`packages/fiscal-verifactu/src/backend.ts`); the `entorno`-not-in-hash test as the model.

- [ ] **Step 1: Grep the fiscal boundary** (CLAUDE.md §1) — `grep -rn "served_at\|servedAt\|zone_id\|zoneId" packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts` → expect **zero hits**. Record the command + output in the commit body.
- [ ] **Step 2: Write the huella-independence test** — file the same basket twice (all lines served vs none served) and assert the `huella` is identical (mirror the `entorno`-not-in-hash test). Run → PASS. (If it fails, `served_at` leaked into the filed record — stop and fix, do not adjust the test.)
- [ ] **Step 3: Full guard sweep** — run, unfiltered where noted:
  - `pnpm --filter @waitron/db test:coverage` (tree-wide guards: english-only, teardown, reachability run from the root project too)
  - `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (`floor_zones` FORCE = true)
  - `pnpm lint && pnpm typecheck && pnpm format:check`
  - the root Vitest project: `pnpm vitest run --coverage` (english-only / errors-reachable / guarded-teardowns)
  - **No churn expected**: no new package (schema in `packages/db`, verbs in `apps/server`), so `GENERIC_PACKAGES` / `vocabulary-scope` / `migrations.manifest.json` are unchanged — **confirm by grep** that no test pins a list this slice altered; if TS-1 added `dining_tables` to any pinned list, this slice does not.
- [ ] **Step 4: Flip the `docs/backlog.md` FP-1 row from PLANNED to BUILT.** The "FP-1 DESIGNED + PLANNED 2026-08-17 … build-blocked on TS-1/TS-2" row was added at plan-writing time; on landing, update it to record FP-1 **LANDED** (with the PR/issue number) and drop the "build-blocked" note. FP-2 still "remains to spec". Mirror the wording style of the shipped TS rows.
- [ ] **Step 5: Commit.**

```bash
git add packages/**/**served*.test.ts docs/backlog.md
git commit -s -m "test(fiscal): huella independent of served_at; docs(backlog): floor-plan FP-1 planned"
```

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — every spec section maps to a task: §2a `floor_zones` → T1; §2b `zone_id` → T1; §2c `served_at` → T1; §2d migration → T1; §3a zone CRUD → T3 (+ codes T2); §3b `markLineServed` → T4; §3c occupancy read → T4; §3d HTTP → T5 (management) + T6 (till); §4 fiscal safety → T11; §5a floor screen → T8; §5b ordering screen → T9; §6 dashboard → T10; §7 conventions → T2/T11; §8 testing → distributed + T11 sweep. No gaps.

**2. Placeholder scan** — no "TBD"/"add validation"/"similar to Task N"; every code step carries real code. The only forward-deferrals are the explicit TS-1/TS-2 re-verification (Prerequisites) and the `db:generate` migration number — both deliberate, both flagged.

**3. Type consistency** — `pendingToServe: number` and `zoneId?: string` are named identically in T4 (produce), T6 (route), T7 (client), T8 (screen). `markLineServed(orderId/tabId, lineNo)` consistent across T4/T6/T7/T9. `open-table` / `send-round` / `serve-line` / `pay-tab` / `set-status` events named once and reused. `zone.name_taken` / `zone.not_found` consistent T2→T3→T5.

**Known cross-slice risks** (flagged, not gaps): the exact file for `listTablesWithState` and TS-1's table-config route placement are re-verified at execution (Prerequisites); if TS-1 shipped table CRUD only on the till API, T5's management wrappers are still additive.

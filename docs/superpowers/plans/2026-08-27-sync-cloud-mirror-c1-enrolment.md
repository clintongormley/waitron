# Sync cloud-mirror C1 — `dining_tables` FK-closure enrolment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrol `dining_tables`, `floor_zones` and `table_service_statuses` into the commercial
**ordered** sync lane, so a real ordered-lane subscriber can apply a counter-delivery `working_orders`
row (`delivery_table_id → dining_tables`) without `23503`-parking and stalling the whole lane.

**Architecture:** Three mechanical additions per table — a registry entry
([registry.ts](../../../packages/sync/src/registry.ts)), its Drizzle schema object
([apply-sql.ts](../../../packages/sync/src/apply-sql.ts)), and a capture trigger (a new
`0006_*.sql` migration) — plus a `fkRank` renumber that places `dining_tables` above `working_orders`
while breaking the `dining_tables ↔ working_orders` cycle at the `tab_id` back-edge. Apply SQL is
generic (derived from the registry + schema), so no per-table statement is hand-written. Nothing about
how a node boots or serves changes; the three tables simply start capturing and become applyable.

**Tech Stack:** TypeScript, `@waitron/sync` (`ENROLLED` registry + `applyBatch`), Drizzle ORM,
PostgreSQL 18 (custom SQL migrations run by `@waitron/migrations`), Vitest with Testcontainers real
Postgres.

**Spec:** [docs/superpowers/specs/2026-08-27-sync-cloud-mirror-c1-enrolment-design.md](../specs/2026-08-27-sync-cloud-mirror-c1-enrolment-design.md)

## Global Constraints

- **Real Postgres, not PGlite,** for the capture/apply/grant/RLS behaviour (PGlite is a superuser →
  false pass). Set `TESTCONTAINERS_RYUK_DISABLED=true` locally or container suites hang to the 180s
  timeout.
- **No new grants, no widened grants.** `app_user` already holds `SELECT, INSERT, UPDATE` on all three
  tables (`0044`/`0048`/`0052`) and `INSERT` on `sync_log` (`0000`). Add nothing. No DELETE (the tables
  deactivate via `active`).
- **No backfill / no back-compat** — nothing is deployed (CLAUDE.md §3); enrolment just starts the
  triggers.
- **English identifiers only** — `packages/sync/src` is inside the english-only guard. All three table
  names already exist and are `[a-z_]+`.
- **Never build SQL by concatenation** — the migration is static literals; apply binds the whole row as
  `$1` via `jsonb_populate_record` (already the mechanism).
- **`fkRank` is a hint, never the apply order** — apply is seq-ascending. The `fkRank` renumber must
  keep every `parent.fkRank < child.fkRank` edge in `registry.test.ts` true; the `dining_tables ↔
  working_orders` cycle is broken by **omitting** the `working_orders → dining_tables` (`tab_id`) edge.
- **Run the whole `@waitron/sync` suite unfiltered** before claiming green — cross-cutting guards do
  not load under a name-filter. CI shards run `test:coverage` (98/98/98/95), not plain `test`.
- **Commit every commit with `-s`** (DCO). Feature branch: `feat/sync-cloud-mirror-c1-enrolment`
  (worktree already created).

**The three tables' new registry shape (used across every task):**

| table | mode | conflictKey | watermarkColumn | captureOps | lane | fkRank |
|---|---|---|---|---|---|---|
| `floor_zones` | `watermark-upsert` | `["id"]` | `null` | `["insert","update"]` | `ordered` | 0 |
| `table_service_statuses` | `watermark-upsert` | `["id"]` | `null` | `["insert","update"]` | `ordered` | 0 |
| `dining_tables` | `watermark-upsert` | `["id"]` | `null` | `["insert","update"]` | `ordered` | 1 |

**The full `fkRank` renumber (all 17 entries):** roots `floor_zones`/`table_service_statuses`/
`catalogues`/`payment_policy` = 0; `dining_tables`/`categories` = 1; `working_orders`/`products` = 2;
`working_order_lines`/`sales`/`payments` = 3; `sale_lines`/`tenders`/`sale_settlements`/
`sale_substitutions`/`sale_voids`/`payment_refunds` = 4.

---

### Task 1: Enrol the three tables in the registry + apply-sql (unit)

**Files:**
- Modify: `packages/sync/src/registry.ts` — add three `ENROLLED` entries, renumber `fkRank`, update the
  header comment and the fkRank-levels comment block.
- Modify: `packages/sync/src/apply-sql.ts` — add three entries to `SYNC_SCHEMA_TABLES`, update the
  "fourteen" comment.
- Modify: `packages/sync/src/registry.test.ts` — add three `SPEC` rows, bump counts (14→17, 12→15),
  widen the group-consistency invariant, add the three `fkRank` edges.
- Modify: `packages/sync/src/apply-sql.test.ts` — bump the "fourteen" description to "seventeen"; add a
  focused assertion for the new unconditional-upsert / no-delete shape.

**Interfaces:**
- Consumes: `EnrolledTable` (existing shape — `table`, `mode`, `conflictKey`, `watermarkColumn`,
  `captureOps`, `fkRank`, `lane`); `applyStatementFor`/`deleteStatementFor` (existing);
  `SYNC_SCHEMA_TABLES` (existing `Record<string, Table>`); the Drizzle exports `diningTables`,
  `floorZones`, `tableServiceStatuses` from `@waitron/db`.
- Produces: `ENROLLED` grows from 14 to 17 entries; `tablesForLane("ordered")` returns 15 names. No new
  exported symbol.

- [ ] **Step 1: Update `registry.test.ts` to expect 17 tables, the new shape, and the new edges (test-first)**

In `packages/sync/src/registry.test.ts`, add these three rows to the `SPEC` object (alongside the
existing Group C block; `SPEC` carries no `fkRank`):

```typescript
  // Group D — mutable, NO watermark column, NO delete (deactivate via `active`) → ordered lane.
  // The table-service floor closure working_orders.delivery_table_id depends on (C1). Captured
  // AFTER INSERT OR UPDATE; app-role grant is SELECT/INSERT/UPDATE with NO DELETE
  // (0044_dining_tables_rls.sql:13, 0048_table_service_statuses_rls.sql:14, 0052_floor_plan_fp1_rls.sql:15),
  // so no delete is captured or applied. No updated_at → watermarkColumn null (seq-cursor monotonic).
  floor_zones: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    lane: "ordered",
  },
  table_service_statuses: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    lane: "ordered",
  },
  dining_tables: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    lane: "ordered",
  },
```

Change the two counts:

```typescript
    expect(ENROLLED).toHaveLength(17);
    expect(byName.size).toBe(17);
```

and

```typescript
    expect(tablesForLane("ordered")).toHaveLength(15);
```

Widen the group-consistency `else` branch (the null-watermark case now covers both DELETE-capable
Group C and deactivate-only Group D):

```typescript
      } else {
        // Group C (DELETE-capable: working_orders, working_order_lines) captures insert/update/delete;
        // Group D (deactivate-only: dining_tables, floor_zones, table_service_statuses) captures
        // insert/update. Both start [insert, update]; delete is present iff the table is DELETE-capable.
        expect(entry.captureOps.slice(0, 2)).toEqual(["insert", "update"]);
        expect([2, 3]).toContain(entry.captureOps.length);
        if (entry.captureOps.length === 3) expect(entry.captureOps[2]).toBe("delete");
      }
```

Add the three edges to `PARENT_CHILD` (and DO NOT add `["working_orders","dining_tables"]` — that
`tab_id` back-edge is the cycle break):

```typescript
    ["floor_zones", "dining_tables"],
    ["table_service_statuses", "dining_tables"],
    ["dining_tables", "working_orders"],
```

- [ ] **Step 2: Run the registry tests to verify they fail**

Run: `pnpm --filter @waitron/sync test registry`
Expected: FAIL — `ENROLLED` still has 14 rows, the three `SPEC` tables are missing, and
`dining_tables.fkRank < working_orders.fkRank` fails (working_orders is currently 0).

- [ ] **Step 3: Add the three entries and renumber `fkRank` in `registry.ts`**

In `packages/sync/src/registry.ts`, append a Group D block after the Group C `working_order_lines`
entry:

```typescript
  // Group D — mutable, NO watermark column, NO delete (deactivate via `active`) → ordered lane. The
  // table-service floor closure that working_orders.delivery_table_id depends on (C1 — spec
  // docs/superpowers/specs/2026-08-27-sync-cloud-mirror-c1-enrolment-design.md). Captured AFTER INSERT
  // OR UPDATE; they hold SELECT/INSERT/UPDATE but NOT DELETE (0044/0048/0052), so no delete is captured
  // or applied. watermarkColumn null (no updated_at) → unconditional upsert, non-regression from the
  // seq cursor, exactly like working_orders. dining_tables outranks working_orders (delivery_table_id
  // FK); the reverse dining_tables.tab_id → working_orders edge is a nullable back-pointer set by a
  // LATER update, deliberately excluded from the fkRank hint (a static rank cannot encode the cycle).
  {
    table: "floor_zones",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "table_service_statuses",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "dining_tables",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 1,
    lane: "ordered",
  },
```

Renumber the existing entries' `fkRank` to the values in the Global Constraints table: `sales` 1→**3**,
`sale_lines` 2→**4**, `tenders` 2→**4**, `sale_settlements` 2→**4**, `sale_substitutions` 2→**4**,
`sale_voids` 2→**4**, `payment_refunds` 2→**4**, `catalogues` 0→**0** (unchanged), `categories`
1→**1** (unchanged), `products` 2→**2** (unchanged), `payments` 1→**3**, `payment_policy` 0→**0**
(unchanged), `working_orders` 0→**2**, `working_order_lines` 1→**3**.

Update the header comment (line 1: "the fourteen tenant-scoped…" → "the seventeen tenant-scoped…") and
rewrite the fkRank-levels comment block (lines 39-46) to include the new tables, the cycle break, and
the new levels:

```typescript
// fkRank levels (0 = FK roots). The FK graph of spec §2 + the C1 table-service closure:
//   floor_zones/table_service_statuses → dining_tables (zone_id/status_id, both nullable);
//   dining_tables → working_orders (working_orders.delivery_table_id, the C1 gate edge);
//   working_orders → {working_order_lines, payments, sales}; sales → {sale_lines, tenders,
//   sale_settlements, sale_substitutions, sale_voids}; payments → payment_refunds;
//   catalogues → categories → products; payment_policy standalone.
// The dining_tables.tab_id → working_orders back-edge is a nullable pointer set by a later UPDATE and
// is deliberately NOT ranked (a static rank cannot encode the dining_tables ↔ working_orders cycle;
// runtime correctness rests on seq-ascending apply, not fkRank — see spec §5).
// Level 0: floor_zones, table_service_statuses, catalogues, payment_policy.
// Level 1: dining_tables, categories.
// Level 2: working_orders, products.
// Level 3: working_order_lines, sales, payments.
// Level 4: sale_lines, tenders, sale_settlements, sale_substitutions, sale_voids, payment_refunds.
```

- [ ] **Step 4: Register the three Drizzle schema objects in `apply-sql.ts`**

In `packages/sync/src/apply-sql.ts`, add `diningTables`, `floorZones`, `tableServiceStatuses` to the
`@waitron/db` import, add them to `SYNC_SCHEMA_TABLES`, and bump the "all fourteen" comment (line 36)
to "all seventeen":

```typescript
export const SYNC_SCHEMA_TABLES: Record<string, Table> = {
  // …existing 14…
  dining_tables: diningTables,
  floor_zones: floorZones,
  table_service_statuses: tableServiceStatuses,
};
```

- [ ] **Step 5: Update `apply-sql.test.ts` (description + focused new-shape assertion)**

Change the description "has a drizzle object for all fourteen enrolled tables" →
"…for all seventeen enrolled tables". Add this test inside the same `describe`:

```typescript
  it("the C1 tables apply as an unconditional upsert and refuse a delete statement", () => {
    for (const table of ["dining_tables", "floor_zones", "table_service_statuses"]) {
      const e = ENROLLED.find((x) => x.table === table);
      if (e === undefined) throw new Error(`registry is missing ${table}`);
      const statement = applyStatementFor(e);
      expect(statement).toContain(`on conflict (id) do update set`);
      expect(statement).not.toContain("where excluded."); // watermarkColumn null → unconditional
      expect(() => deleteStatementFor(e)).toThrow(); // deactivate-only: no delete captured
    }
  });
```

Ensure `applyStatementFor`/`deleteStatementFor` are imported in this test file (they are used
elsewhere in it; add to the import if not).

- [ ] **Step 6: Run the unit suites to verify they pass**

Run: `pnpm --filter @waitron/sync test registry apply-sql`
Expected: PASS — 17 tables, the group-consistency and fkRank edges hold, the new-shape assertion
passes.

- [ ] **Step 7: Commit**

```bash
git add packages/sync/src/registry.ts packages/sync/src/registry.test.ts \
        packages/sync/src/apply-sql.ts packages/sync/src/apply-sql.test.ts
git commit -s -m "feat(sync): enrol dining_tables/floor_zones/table_service_statuses in the registry (C1)

Adds the three-table table-service FK closure to ENROLLED on the ordered
lane (mutable/no-watermark/no-delete shape), registers their drizzle schema
objects for the generic apply SQL, and renumbers fkRank so dining_tables
outranks working_orders — the tab_id back-edge is left unranked to break the
mutual-FK cycle. Registry + apply-sql unit tests only; capture triggers and
the apply gate follow."
```

---

### Task 2: The capture-trigger migration (`0006`) + capture gate

**Files:**
- Create: `packages/sync/drizzle/0006_enrol_table_service.sql`
- Modify: `packages/sync/drizzle/meta/_journal.json` — append the `0006` entry.
- Create: `packages/sync/drizzle/meta/0006_snapshot.json`
- Modify: `packages/sync/src/capture.gate.test.ts` — add a test that the three new triggers fire; bump
  the "14 capture triggers" comment (line 17) to 17.

**Interfaces:**
- Consumes: the existing `sync_capture()` function and `sync_log` table (`0000`); the `withTenantNode`
  helper and `seedBase` in `capture.gate.test.ts`; `floor_zones`/`table_service_statuses`/
  `dining_tables` tables (core `0044`/`0048`/`0052`).
- Produces: three DB triggers `floor_zones_capture`, `table_service_statuses_capture`,
  `dining_tables_capture`, each `AFTER INSERT OR UPDATE`, echo-gated on `app.sync_apply`.

- [ ] **Step 1: Write the failing capture test**

In `packages/sync/src/capture.gate.test.ts`, add a test to the existing describe block. It seeds the
FK parents as admin, then inserts a `dining_tables` row **as the app role** (so its own write is
captured), and asserts a `sync_log` row appears for it:

```typescript
  it("the C1 table-service triggers capture an app-role insert (dining_tables/floor_zones/table_service_statuses)", async () => {
    const base = await seedBase(postgres.admin);
    const app = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      // floor_zone + status as the app role → each capture fires.
      const [zone, status, table] = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ];
      await withTenantNode(app, base.tenantId, NODE_A, async (tx) => {
        await tx.execute(
          sql`insert into floor_zones (id, tenant_id, location_id, name)
              values (${zone}, ${base.tenantId}, ${base.locationId}, 'Comedor')`,
        );
        await tx.execute(
          sql`insert into table_service_statuses (id, tenant_id, label, color)
              values (${status}, ${base.tenantId}, 'Needs cleaning', '#ef4444')`,
        );
        await tx.execute(
          sql`insert into dining_tables (id, tenant_id, location_id, label, zone_id, status_id)
              values (${table}, ${base.tenantId}, ${base.locationId}, 'T1', ${zone}, ${status})`,
        );
      });
      const captured = await postgres.admin.execute<{ table_name: string; op: string; origin_id: string }>(
        sql`select table_name, op, origin_id from sync_log
            where tenant_id = ${base.tenantId}
              and table_name in ('floor_zones','table_service_statuses','dining_tables')
            order by seq`,
      );
      expect(captured.rows.map((r) => r.table_name)).toEqual([
        "floor_zones",
        "table_service_statuses",
        "dining_tables",
      ]);
      for (const r of captured.rows) {
        expect(r.op).toBe("insert");
        expect(r.origin_id).toBe(NODE_A); // the app.node_id GUC, verbatim
      }
    } finally {
      await app.close();
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/sync test capture.gate`
Expected: FAIL — no rows captured (the triggers do not exist yet); `captured.rows` is empty.

- [ ] **Step 3: Create the migration**

Create `packages/sync/drizzle/0006_enrol_table_service.sql`:

```sql
-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no triggers and
-- sync_capture/sync_log are not Drizzle tables, so nothing here survives a later `generate`. Runs LAST
-- in migrations.manifest.json (the `sync` set), after core/db created dining_tables, floor_zones and
-- table_service_statuses (0043/0051/0047), so each CREATE TRIGGER targets an existing table.
--
-- WHAT THIS BUILDS. Sub-project C1
-- (docs/superpowers/specs/2026-08-27-sync-cloud-mirror-c1-enrolment-design.md): enrol the dining_tables
-- FK closure into the commercial ORDERED lane so a real ordered-lane subscriber can apply a
-- counter-delivery working_order (delivery_table_id → dining_tables) without 23503-parking and stalling
-- the whole lane. Three capture triggers, echo-gated on app.sync_apply (so a replicated write is not
-- re-captured), AFTER INSERT OR UPDATE — these tables deactivate via `active`, never DELETE, so there
-- is no delete to capture. NO grants: the app role already holds INSERT on sync_log (0000) and
-- SELECT/INSERT/UPDATE on all three (0044/0048/0052).

CREATE TRIGGER floor_zones_capture AFTER INSERT OR UPDATE ON floor_zones
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER table_service_statuses_capture AFTER INSERT OR UPDATE ON table_service_statuses
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER dining_tables_capture AFTER INSERT OR UPDATE ON dining_tables
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
```

- [ ] **Step 4: Register the migration in the drizzle journal + snapshot**

Append to the `entries` array in `packages/sync/drizzle/meta/_journal.json` (keep the deterministic
`when` sequence — do NOT use `drizzle-kit generate`, which stamps real time and would break the
round-number convention):

```json
    {
      "idx": 6,
      "version": "7",
      "when": 1786492800006,
      "tag": "0006_enrol_table_service",
      "breakpoints": true
    }
```

Create `packages/sync/drizzle/meta/0006_snapshot.json` (mirror `0005_snapshot.json`; `prevId` is
`0005`'s `id`, and `id` is a fresh uuid — generate one with `uuidgen`):

```json
{
  "id": "<fresh-uuid-from-uuidgen>",
  "prevId": "60accaf2-855a-4351-a986-0e78ba471eac",
  "version": "7",
  "dialect": "postgresql",
  "tables": {},
  "enums": {},
  "schemas": {},
  "sequences": {},
  "roles": {},
  "policies": {},
  "views": {},
  "_meta": {
    "columns": {},
    "schemas": {},
    "tables": {}
  }
}
```

Bump the `capture.gate.test.ts` header comment (line 17): "…the 14 capture triggers…" → "…the 17
capture triggers…".

- [ ] **Step 5: Run the capture gate to verify it passes**

Run: `pnpm --filter @waitron/sync test capture.gate`
Expected: PASS — the three rows are captured, `op='insert'`, `origin_id=NODE_A`.

- [ ] **Step 6: Prove the triggers are echo-gated (guard by deletion — inline, no code change committed)**

Confirm the `WHEN (app.sync_apply IS DISTINCT FROM 'on')` clause is load-bearing exactly as
`products_capture`'s existing sub-test does: temporarily reinstall `dining_tables_capture` **without**
the WHEN clause, insert under `app.sync_apply='on'`, and observe the echo IS captured; then restore.
This mirrors `capture.gate.test.ts:148-195` — do it in the console or a throwaway edit, restore before
committing. (No new committed test; the existing products echo test already pins the mechanism the
generic trigger shares.)

- [ ] **Step 7: Commit**

```bash
git add packages/sync/drizzle/0006_enrol_table_service.sql \
        packages/sync/drizzle/meta/_journal.json \
        packages/sync/drizzle/meta/0006_snapshot.json \
        packages/sync/src/capture.gate.test.ts
git commit -s -m "feat(sync): capture triggers for the dining_tables FK closure (C1)

0006 adds echo-gated AFTER INSERT OR UPDATE capture triggers on floor_zones,
table_service_statuses and dining_tables (no delete — they deactivate). No
grants added. Capture gate proves an app-role insert of all three is captured."
```

---

### Task 3: The apply-path FK-closure gate (headline, proven by deletion)

**Files:**
- Modify: `packages/sync/src/apply.gate.test.ts` — add image helpers for the three tables + a
  `working_orders` apply image, and the headline positive/negative gate test.

**Interfaces:**
- Consumes: `applyBatch(applier, rows: SyncLogRow[], { subscriberId, localEnvironment, sourceEnvironment })`;
  the harness helpers `seedBase()` (→ `{tenantId, locationId, tillId, nodeId, catalogueId}`), `uuid()`,
  `wire(image)`, `setEnv(...)`, `laneCursor(subscriberId, originId, "ordered")`, `scalar(...)`,
  `postgres.pg.connectAs("sync_applier", "ap")`, and `const PROD = {localEnvironment:"production",
  sourceEnvironment:"production"}`.
- Produces: no new exports — a real-PG proof that the enrolment closes the `working_orders →
  dining_tables` park.

- [ ] **Step 1: Add the four image helpers**

Add near the other `*Image` helpers in `apply.gate.test.ts`. Each lists **every** column (`to_jsonb`
captures all; `jsonb_populate_record` fills an absent key with NULL, so every NOT NULL column must be
present):

```typescript
function floorZoneImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    location_id: b.locationId,
    name: "Comedor",
    display_order: 0,
    active: true,
    created_at: "2026-08-27T10:00:00+00:00",
    ...over,
  };
}
function statusImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    label: "Needs cleaning",
    color: "#ef4444",
    display_order: 0,
    active: true,
    created_at: "2026-08-27T10:00:00+00:00",
    ...over,
  };
}
function diningTableImage(b: Base, over: Image = {}): Image {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    location_id: b.locationId,
    label: "T1",
    zone_id: null,
    capacity: null,
    active: true,
    created_at: "2026-08-27T10:00:00+00:00",
    tab_id: null,
    status_id: null,
    pos_x: null,
    pos_y: null,
    shape: null,
    rotation: null,
    ...over,
  };
}
function workingOrderImage(b: Base, orderNumber: number, over: Image = {}): Image {
  // status 'open' ⇒ settled_at must be NULL (the working_orders_settled_at_ck CHECK). INSERT of an
  // open order is not a status transition, so working_orders_enforce_transition (BEFORE UPDATE) does
  // not fire here.
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    till_id: b.tillId,
    node_id: null,
    order_number: orderNumber,
    label: null,
    status: "open",
    opened_at: "2026-08-27T10:00:00+00:00",
    settled_at: null,
    delivery_table_id: null,
    collected_at: null,
    ...over,
  };
}
```

- [ ] **Step 2: Write the headline positive + negative gate test**

```typescript
describe("C1 — the dining_tables FK-closure enrolment (the ordered-lane hard gate)", () => {
  it("a counter-delivery working_order applies with no park once its dining_tables closure is enrolled", async () => {
    // Failing case (proven by deletion): comment out the dining_tables entry in ENROLLED and re-run —
    // applyBatch throws sync.table_not_enrolled on the dining_tables row (DISPATCH has no entry), so the
    // whole batch fails. Restore → this passes. That is the C1 gate made a test.
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const zone = floorZoneImage(b);
      const status = statusImage(b);
      const table = diningTableImage(b, { zone_id: zone.id, status_id: status.id });
      const order = workingOrderImage(b, 1, { delivery_table_id: table.id });
      const rows: SyncLogRow[] = [
        { seq: 1n, originId, table: "floor_zones", op: "insert", tenantId: b.tenantId, rowImage: wire(zone) },
        { seq: 2n, originId, table: "table_service_statuses", op: "insert", tenantId: b.tenantId, rowImage: wire(status) },
        { seq: 3n, originId, table: "dining_tables", op: "insert", tenantId: b.tenantId, rowImage: wire(table) },
        { seq: 4n, originId, table: "working_orders", op: "insert", tenantId: b.tenantId, rowImage: wire(order) },
      ];
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 4, deferred: 0 }); // all four landed, nothing parked
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(4n); // cursor advanced past them
      // The delivery order is present AND still points at the mirrored table.
      const back = await scalar(
        sql`select delivery_table_id::text as v from working_orders where id = ${order.id as string}`,
      );
      expect(back).toBe(table.id);
    } finally {
      await applier.close();
    }
  });

  it("negative control: without the dining_tables parent, the delivery working_order parks on 23503 and holds the cursor", async () => {
    await setEnv("production");
    const b = await seedBase();
    const originId = uuid();
    const subscriberId = uuid();
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const missingTableId = uuid(); // a dining_table that is NEVER applied (models "not enrolled")
      const order = workingOrderImage(b, 2, { delivery_table_id: missingTableId });
      const rows: SyncLogRow[] = [
        { seq: 1n, originId, table: "working_orders", op: "insert", tenantId: b.tenantId, rowImage: wire(order) },
      ];
      const result = await applyBatch(applier, rows, { subscriberId, ...PROD });

      expect(result).toEqual({ applied: 0, deferred: 1 }); // parked on the absent FK parent
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n); // cursor held below it
      expect(
        await scalar(sql`select count(*)::int::text as v from working_orders where id = ${order.id as string}`),
      ).toBe("0"); // never inserted
    } finally {
      await applier.close();
    }
  });
});
```

- [ ] **Step 3: Run the apply gate to verify it passes**

Run: `pnpm --filter @waitron/sync test apply.gate`
Expected: PASS — positive `{applied:4, deferred:0}`, cursor `4n`; negative `{applied:0, deferred:1}`,
cursor `0n`. (If the positive case surfaces an unexpected NOT-NULL or trigger error on
`working_orders`/`dining_tables`, fix the offending image field — that is normal TDD iteration, not a
design change.)

- [ ] **Step 4: Prove the gate by deletion (inline, restore before committing)**

In `registry.ts`, temporarily comment out the `dining_tables` `ENROLLED` entry and re-run
`pnpm --filter @waitron/sync test apply.gate`. Expected: the positive test FAILS — `applyBatch` throws
`AppError sync.table_not_enrolled` on the `dining_tables` row (the deletion proof of the enrolment).
Restore the entry; re-run → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sync/src/apply.gate.test.ts
git commit -s -m "test(sync): prove the dining_tables FK-closure enrolment closes the ordered-lane park (C1)

Real-PG headline gate: a floor_zone + status + dining_table + counter-delivery
working_order apply in seq order with no park (applied 4, deferred 0, cursor
advances); the negative control (no dining_table parent) parks the working_order
on 23503 and holds the cursor. Proven by deletion (comment out the dining_tables
ENROLLED entry → sync.table_not_enrolled)."
```

---

### Task 4: Prose/count cleanup + full verification

**Files:**
- Modify: `packages/sync/src/apply.ts` (line ~260 comment), `packages/sync/src/index.ts` (the
  "fourteen commercial" comment), `packages/sync/src/apply.gate.test.ts` (line ~13 "14 capture
  triggers" comment), and any remaining "fourteen"/"14"/"twelve"/"12" stale count in the package.

**Interfaces:** none — comment/verification only.

- [ ] **Step 1: Grep for every stale enrolled-count receipt and fix it**

Run: `grep -rniE 'fourteen|twelve|\b(14|12)\b' packages/sync/src | grep -iE 'enrol|table|lane|trigger|commercial|dispatch'`

Fix each to the new count in prose only (no logic): `apply.ts` "14 entries cover every row" → "17
entries…"; `index.ts` "the fourteen commercial…" → "the seventeen commercial…"; `apply.gate.test.ts`
header "14 capture triggers" → "17 capture triggers"; and the `registry.ts`/`apply-sql.ts` comments if
Task 1/2 missed any. Leave genuinely-unrelated numbers (e.g. `0002`, SQLSTATEs) alone.

- [ ] **Step 2: Run the whole `@waitron/sync` suite unfiltered, with coverage**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage`
Expected: PASS — every suite (registry, apply-sql, capture.gate, apply.gate, pull, retention, source,
origin, redelivery, wire, peers, errors) green; coverage ≥ 98/98/98/95.

- [ ] **Step 3: Re-run the fiscal FORCE-RLS scan (a change touching tenant-scoped tables)**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS — the three tables already carry FORCE RLS; enrolment does not touch it, but CLAUDE.md
§3 requires re-running the guard after touching tenant-scoped tables.

- [ ] **Step 4: Gate — typecheck, lint, format, and the four-command workspace gate**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`
Then the migration actually applies end-to-end (the manifest runs the new `0006` in a real container as
part of any `@waitron/sync` real-PG suite — already exercised in Tasks 2/3).
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/sync/src/apply.ts packages/sync/src/index.ts packages/sync/src/apply.gate.test.ts
git commit -s -m "docs(sync): update enrolled-table counts to 17 after the C1 closure (C1)

The commercial lane now carries 17 tables (14 + dining_tables/floor_zones/
table_service_statuses). Comment/count updates only."
```

---

## Self-Review

**Spec coverage:**
- §2 forced three-table closure → Task 1 (registry) + Task 2 (triggers). ✔
- §3 new "mutable/no-watermark/no-delete" shape + no new grants → Task 1 entries + `apply-sql.test`
  focused assertion; migration adds no grants (Task 2). ✔
- §4 fkRank cascade + `tab_id` cycle break → Task 1 renumber + the three edges (excluding the back-edge)
  + the rewritten levels comment. ✔
- §5 seq-order correctness + no un-gated BEFORE triggers → Task 3 positive test (seq-order applies the
  parent first) + negative control (park); the `working_orders_enforce_transition` note in
  `workingOrderImage`. ✔
- §6 proven-by-deletion gate, count/prose updates, unfiltered + coverage + inmutabilidad →
  Task 3 Step 4, Task 4. ✔
- §7 conventions (english ids, no concatenated SQL, no widened grant) → honoured throughout; asserted by
  the existing `apply-sql.test` identifier guards which auto-cover the new tables. ✔
- §8 out of scope (mirror mode, tunnel, config-flow-down, kitchen tables, multi-tenant, fiscal lane) →
  untouched. ✔

**Placeholder scan:** the only intentionally-parameterised value is the `0006_snapshot.json` `id`
(a fresh `uuidgen` uuid — every drizzle snapshot id is unique; `prevId` is fixed to `0005`'s id). No
"TBD"/"handle errors"/"similar to Task N". ✔

**Type consistency:** `SyncLogRow` fields (`seq: bigint`, `originId`, `table`, `op`, `tenantId`,
`rowImage`) match `apply.ts`; `applyBatch(db, rows, {subscriberId, localEnvironment, sourceEnvironment,
lane?})` matches `ApplyBatchOptions`; `{applied, deferred}` matches `ApplyBatchResult`; helper names
(`floorZoneImage`/`statusImage`/`diningTableImage`/`workingOrderImage`, `wire`, `laneCursor`,
`scalar`, `PROD`, `connectAs("sync_applier","ap")`) match the `apply.gate.test.ts` harness. ✔

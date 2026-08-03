# Node identity rekey — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-key the fiscal chain / series / SIF identity from `till_id` to a new `node_id`, backed by a `nodes` table, and thread `node_id` through the write path — so the SIF is the compute node (#33), not the till.

**Architecture:** Staged for green, reviewable checkpoints. Add the `NodeId` type and `nodes` table (additive), add `node_id` as nullable columns everywhere (additive scaffolding), then one atomic task threads `node_id` through the write path and flips every constraint/guard from till to node. Adding `node_id` before dropping `till_id` keeps `drizzle-kit generate` non-interactive (it sees a plain drop, never a rename). No backwards-compat — pre-production, DBs drop and recreate (`CLAUDE.md` §3), so empty-table `SET NOT NULL` and dropped columns are free.

**Tech Stack:** TypeScript, Drizzle ORM + drizzle-kit (per-package migration folders), PostgreSQL 18 via Testcontainers (real-PG for concurrency/RLS), PGlite (hermetic logic), Vitest.

**Design:** [docs/superpowers/specs/2026-08-03-node-id-rekey-design.md](../specs/2026-08-03-node-id-rekey-design.md).

## Global Constraints

- **Term:** the entity is a `node` (compute node), never "server" — US "server" = waiter. #33's "server" IS this `node`. Identifiers are `node_*` / `NodeId` / `nodeId`.
- **No backwards compatibility / no backfill.** Schema changes drop and recreate. Never write data-migration code (`CLAUDE.md` §3).
- **Error codes name the domain concept, never the package** (`CLAUDE.md` §3); every file that throws a code imports its registry (`import "./errors.js"`).
- **Spanish fiscal vocabulary is deliberate** (`envios`, `huella`, `secuencia`, …). `packages/db` is English/regime-neutral — no Spanish tokens there (`node`, `nodes` are English, fine).
- **Never widen a grant to make a test pass**; the app role is non-superuser under RLS.
- **Real Postgres for anything about concurrency, RLS-as-app-role, or privileges** — PGlite serialises onto one backend (false pass) and is superuser (`CLAUDE.md` §4). Locally, real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`.
- **Prove each guard by deletion**; confirm negative controls fail for the stated reason (`CLAUDE.md` §4).
- **Every commit is `git commit -s`.** Run the gate before pushing: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, and `pnpm --filter <pkg> test:coverage` for touched packages (CI runs coverage, not plain test — `CLAUDE.md` §2).
- **Coverage thresholds:** statements 98 / lines 98 / functions 98 / branches 95 (all packages here).

---

### Task 1: `NodeId` branded id type

**Files:**
- Modify: `packages/shared/src/ids.ts`
- Test: `packages/shared/src/ids.test.ts`

**Interfaces:**
- Produces: `type NodeId = Branded<string, "NodeId">`; `nodeId(value: string): NodeId` — validates a UUID via the shared `brandId`, throws `shared.invalid_id` otherwise (identical machinery to `tillId`).

- [ ] **Step 1: Add `nodeId` to the constructor table (failing test)**

In `packages/shared/src/ids.test.ts`, add `nodeId` to the imports and to `ALL_ID_CONSTRUCTORS`:

```typescript
// import list: add nodeId
import { fiscalRecordId, locationId, nodeId, saleId, /* … */ tenderId, tillId, /* … */ } from "./ids.js";

// ALL_ID_CONSTRUCTORS: add after the tillId row
  ["nodeId", "NodeId", nodeId],
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/shared test ids` — Expected: FAIL (`nodeId` is not exported).

- [ ] **Step 3: Add the type and constructor**

In `packages/shared/src/ids.ts`, after the `TillId` line add `export type NodeId = Branded<string, "NodeId">;`, and after `tillId` add:

```typescript
export const nodeId = (value: string): NodeId => brandId(value, "NodeId");
```

- [ ] **Step 4: Export from the barrel**

In `packages/shared/src/index.ts`, add `NodeId` to the type exports and `nodeId` to the value exports, next to `TillId`/`tillId`.

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @waitron/shared test:coverage` — Expected: PASS, coverage green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ids.ts packages/shared/src/ids.test.ts packages/shared/src/index.ts
git commit -s -m "feat(shared): add NodeId branded id type"
```

---

### Task 2: `nodes` table + seed helper + migration

**Files:**
- Create: `packages/db/src/schema/nodes.ts`
- Modify: `packages/db/src/schema/index.ts` (barrel re-export), `packages/db/src/index.ts` (public export)
- Create: `packages/db/src/schema/nodes.test.ts`
- Generated: `packages/db/drizzle/0015_*.sql` (+ `meta/_journal.json`, snapshot)

**Interfaces:**
- Produces: `nodes` pgTable — `id`, `tenantId → tenants.id`, `locationId → locations.id`, `name`, `createdAt`; `unique (tenant_id, id)`; `index (tenant_id)`; RLS enabled.

- [ ] **Step 1: Write the schema test (failing)**

Create `packages/db/src/schema/nodes.test.ts`, modelled on `series.test.ts`/`tenants` tests: using `createPgliteDb` + `runMigrations` + `withTenant`, assert (a) a node row inserts under its tenant, (b) `unique (tenant_id, id)` rejects a duplicate `(tenant_id, id)` with 23505, (c) inserting a node whose `location_id` belongs to another tenant is rejected by the FK. (Follow the exact setup an existing `packages/db` schema test uses — read `series.test.ts` for the `createPgliteDb`/`withTenant`/seed pattern.)

- [ ] **Step 2: Run it — expect FAIL** (`nodes` does not exist)

Run: `pnpm --filter @waitron/db test nodes`

- [ ] **Step 3: Create `packages/db/src/schema/nodes.ts`**

```typescript
import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * A compute node that runs a venue's POS and operates as its SIF (#33 — the "server" of that
 * design; called `node` here because in US restaurant English "server" means a waiter, and this
 * is a machine, not a person). One node per venue today; active-active/failover (a `role` column,
 * a second node) are later specs. Deliberately regime-neutral, like `tills`: the Veri*Factu SIF
 * identity (NúmeroInstalación, IdSistemaInformatico) lives in the module-owned `registro_sif`,
 * now keyed by node.
 */
export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Composite target so fiscal/commercial tables can carry a tenant-consistent (tenant_id,
    // node_id) FK — the same role invoice_series_tenant_id_key plays for `sales`.
    unique("nodes_tenant_id_key").on(t.tenantId, t.id),
    index("nodes_tenant_id_idx").on(t.tenantId),
  ],
).enableRLS();
```

- [ ] **Step 4: Re-export**

Add `export * from "./nodes.js";` to `packages/db/src/schema/index.ts` (place it after `tenants.js`, before `series.js`, since series will FK nodes). In `packages/db/src/index.ts`, add `export { nodes } from "./schema/nodes.js";` beside the `tills` export.

- [ ] **Step 5: Generate the migration**

Run: `pnpm --filter @waitron/db exec drizzle-kit generate --name nodes`
Expected: a new `packages/db/drizzle/0015_nodes.sql` creating the table with RLS + constraints, journal + snapshot updated. Read the SQL to confirm it CREATEs `nodes` with `nodes_tenant_id_key`, the FKs, and `ENABLE ROW LEVEL SECURITY`.

- [ ] **Step 6: Add a `seedNode` test helper**

In `packages/db/src/testing/seed.ts` (the `@waitron/db` seed used by db tests) add a helper that inserts a `nodes` row for a given tenant+location and returns its id. Follow the file's existing seed style. (The fiscal-verifactu seed gets its node wiring in Task 4.)

- [ ] **Step 7: Run — expect PASS**

Run: `pnpm --filter @waitron/db test:coverage nodes` then the whole package `pnpm --filter @waitron/db test:coverage` (unfiltered, to load the tree-wide guards — `CLAUDE.md` §4). Use `TESTCONTAINERS_RYUK_DISABLED=true`.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/nodes.ts packages/db/src/schema/index.ts packages/db/src/index.ts \
        packages/db/src/schema/nodes.test.ts packages/db/src/testing/seed.ts packages/db/drizzle/
git commit -s -m "feat(db): add nodes table (compute node = SIF, per #33)"
```

---

### Task 3: Add nullable `node_id` columns + FKs (additive scaffolding)

Adds `node_id` to all seven tables as **nullable** with an FK to `nodes`, no constraint/guard changes. Purely additive — nothing reads it yet, so the tree stays green. Doing this before Task 4 keeps Task 4's `till_id` drop a plain drop (drizzle never prompts "rename?").

**Files:**
- Modify: `packages/db/src/schema/series.ts`, `packages/db/src/schema/sales.ts`, `packages/db/src/schema/orders.ts`
- Modify: `packages/fiscal-verifactu/src/schema/registros.ts`, `packages/fiscal-verifactu/src/schema/cadenas.ts`, `packages/fiscal-verifactu/src/schema/sif.ts`
- Modify: `packages/payments/src/schema/payments.ts`
- Test: extend each table's existing `*.test.ts` with a "node_id column exists, nullable, FK to nodes" assertion
- Generated: new migrations in `packages/db/drizzle/`, `packages/fiscal-verifactu/drizzle/`, `packages/payments/drizzle/`

**Interfaces:**
- Produces: a nullable `nodeId: uuid("node_id")` column on `invoiceSeries`, `sales`, `workingOrders`, `registrosFacturacion`, `cadenas`, `registroSif`, `payments`, each `.references(() => nodes.id)` (plain FK — matching the existing plain `till_id` FKs; the composite tenant-consistent FK is deferred to Task 4 where `sales` is flipped NOT NULL).

- [ ] **Step 1: Write a failing column test on one table**

In `packages/db/src/schema/series.test.ts`, add a test that a `node_id` column exists on `invoice_series` and accepts a valid node id (insert a series with `nodeId` set, via `seedNode`). Run: `pnpm --filter @waitron/db test series` — Expected FAIL.

- [ ] **Step 2: Add the nullable column to each `packages/db` table**

`series.ts`, `sales.ts`, `orders.ts` (the `workingOrders` table): import `nodes` and add, beside the existing `tillId`/tenant columns:

```typescript
// Nullable in this task; Task 4 populates it and (sales, registros) flips it NOT NULL. FK is
// plain here to match the sibling till_id FK; sales' composite (tenant_id, node_id) FK lands in
// Task 4 with its NOT NULL.
nodeId: uuid("node_id").references(() => nodes.id),
```

(`orders.ts` and `payments.ts` `node_id` stay nullable permanently in this slice — no writer yet, design §5.)

- [ ] **Step 3: Add the nullable column to each `fiscal-verifactu` table**

`registros.ts`, `cadenas.ts`, `sif.ts`: import `nodes` from `@waitron/db` (these files already import `tenants, tills` from `@waitron/db`) and add `nodeId: uuid("node_id").references(() => nodes.id),` beside `tillId`. Leave every constraint untouched.

- [ ] **Step 4: Add the nullable column to `payments`**

`packages/payments/src/schema/payments.ts`: add `nodeId: uuid("node_id").references(() => nodes.id),`. (Import `nodes` from `@waitron/db`.)

- [ ] **Step 5: Generate migrations per package**

```bash
pnpm --filter @waitron/db exec drizzle-kit generate --name add_node_id
pnpm --filter @waitron/fiscal-verifactu exec drizzle-kit generate --name add_node_id
pnpm --filter @waitron/payments exec drizzle-kit generate --name add_node_id
```

Read each generated SQL: expect only `ADD COLUMN "node_id" uuid` + `ADD CONSTRAINT … FOREIGN KEY … REFERENCES nodes`. No drops, no rename prompts.

- [ ] **Step 6: Extend the column test to the remaining tables**

Add the analogous "node_id nullable + FK" assertion to `sales.test.ts`, `orders.test.ts`, and to a fiscal-verifactu schema test (a `canje-columns.test.ts`-style column test is the local pattern) for `registros_facturacion`/`cadenas`/`registro_sif`, and a payments schema test.

- [ ] **Step 7: Run — expect PASS**

`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db --filter @waitron/fiscal-verifactu --filter @waitron/payments test:coverage`

- [ ] **Step 8: Commit**

```bash
git add packages/db packages/fiscal-verifactu packages/payments
git commit -s -m "feat: add nullable node_id columns + FKs (scaffolding for the rekey)"
```

---

### Task 4: Thread `node_id` and flip the fiscal identity from till to node

The atomic rekey. Populates `node_id` on every new row, flips all four fiscal tables' keys/guards from till to node, resolves the SIF per node, renames the guard's error code, renames `registerTill → registerNode`, makes `node_id` NOT NULL where required, drops the now-redundant `till_id` from `cadenas`/`registro_sif`/`invoice_series` (keeping the snapshot on `registros_facturacion`), and updates the seed helpers. The §9 real-PG prototype tests are the gate — written first (red), green at the end. One coherent task: the four tables and their write-path consumers are compile-time coupled across `fiscal`, `fiscal-verifactu` and `core`, so they cannot be split into independently-green sub-tasks.

**Files (all Modify unless noted):**
- Test (create): `packages/fiscal-verifactu/src/chain.node-rekey.concurrency.test.ts` — the §9 gate
- `packages/fiscal-verifactu/src/testing/seed.ts` — `seedTill`→ create+register a node; `seedSale` writes `node_id`; `SeededTill`→carries `nodeId`; `altaFor`/`appendToChain` callers
- `packages/fiscal-verifactu/src/schema/cadenas.ts`, `.../schema/sif.ts`, `.../schema/registros.ts` — flip constraints, drop redundant `till_id`
- `packages/db/src/schema/series.ts` — flip unique to `(tenant, node, code)`, drop `till_id`, update doc comment
- `packages/db/src/schema/sales.ts` — `node_id` NOT NULL + composite FK
- `packages/fiscal-verifactu/src/registro-row.ts` — `RegistroRowContext.nodeId`, stamp `node_id`
- `packages/fiscal-verifactu/src/registro-sif.ts` — `currentSif`/`registerSif`/`esPrimerRegistro` by node; param `{nodeId}`
- `packages/fiscal-verifactu/src/chain.ts` — `lockChainHead`/`selectHeadForUpdate`/`attemptAppend` by node
- `packages/fiscal/src/backend.ts` — contract: `registerTill`→`registerNode`; `SaleForFiscalRecord.nodeId`; `checkIntegrity`/`pendingCount` take a node
- `packages/fiscal-verifactu/src/backend.ts` — impl of the above; void/correction read the original's `node_id`
- `packages/core/src/record-sale.ts`, `record-correction.ts`, `record-substitution.ts`, `record-void.ts`, `settle-sale.ts` — `nodeId` on inputs, series↔node guard
- `packages/core/src/errors.ts`, `packages/fiscal-verifactu/src/errors.ts`, `packages/fiscal/src/errors.ts` — error-code/param renames
- `packages/fiscal-verifactu/src/chain.concurrency.test.ts` and other suites querying `where till_id =` — update to `node_id`
- Doc: `docs/superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md` — dated pointer
- Generated: migrations in `packages/db/drizzle/`, `packages/fiscal-verifactu/drizzle/`

**Interfaces:**
- Consumes: `nodes`, `NodeId`/`nodeId`, the nullable `node_id` columns (Tasks 1–3).
- Produces: `appendToChain(tx, tenantId, nodeId, alta)`; `currentSif(tx, tenantId, nodeId)`; `registerNode(tx, nodeId, {tenantId})`; `RegistroRowContext.nodeId`; `RecordSaleInput.nodeId`; `SaleForFiscalRecord.nodeId`; error code `sale.series_wrong_node`.

- [ ] **Step 1: Write the §9 prototype gate (failing), real-PG**

Create `packages/fiscal-verifactu/src/chain.node-rekey.concurrency.test.ts`, adapting `chain.concurrency.test.ts` to node-keying. It MUST use `useRealPostgres`/`startRealPostgres` (never a PGlite fallback — a vanished concurrency suite is a false green, `CLAUDE.md` §4). Cover:
  1. **Concurrency backstop under `(tenant, node, secuencia)`.** Seed ONE node serving sales, run `WRITERS = 20` concurrent `appendToChain(tx, node.tenantId, node.nodeId, altaFor(...))` on distinct connections; assert all 20 committed, `secuencia` is `1..20` with no gap, each `anterior_huella` equals the predecessor's `huella`, `where node_id = ${node.nodeId}`. (This is the property `registros.ts:158-162` documents; re-proven on the node key.)
  2. **Two tills, one node → ONE chain.** Seed a node with two tills; sales rung at either till append to the same node chain (`secuencia` continues across tills). This is the behaviour change the rekey introduces (per-node, not per-till serialisation) and did not exist before.
  3. **series↔node guard.** `record-sale` (or the core entry) with `input.nodeId` ≠ the series' node throws `sale.series_wrong_node`; the matching case succeeds.
  4. **`currentSif` per node.** Two nodes under one tenant resolve to distinct SIFs / distinct chains.
  5. **RLS.** The non-superuser app role (`asAppUser`) can append under `withTenant`; a cross-tenant node reference is rejected.

- [ ] **Step 2: Run it — expect FAIL** (`node.nodeId` unknown, `appendToChain` still takes till, `sale.series_wrong_node` unregistered)

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test chain.node-rekey`

- [ ] **Step 3: Update the fiscal-verifactu seed helpers**

In `testing/seed.ts`: `seedTill` (rename to `seedNode` or keep name but) creates a `nodes` row for the tenant+location and registers the SIF **per node**; `SeededTill`/`SeededNode` carries `nodeId` (and still `tillId` for the sales it rings); `seedSale` writes `node_id` on the sale; every `appendToChain(..., till.tillId, ...)` call becomes `..., node.nodeId, ...`. Keep the fresh-tenant-per-call behaviour (the append-only trigger blocks truncate).

- [ ] **Step 4: Flip the fiscal-verifactu schema constraints**

- `cadenas.ts`: PK `primaryKey({ columns: [t.tenantId, t.nodeId] })`; make `nodeId` `.notNull()`; **drop** `tillId`. Update the doc comment ("one row per (tenant, node)").
- `sif.ts`: `registro_sif_activo_uq` → `.on(t.tenantId, t.nodeId)`; make `nodeId` `.notNull()`; **drop** `tillId`. Comment: "at most one live identity per node"; "a node that re-registers".
- `registros.ts`: `registros_tenant_till_secuencia_uq` → rename to `registros_tenant_node_secuencia_uq` on `(t.tenantId, t.nodeId, t.secuencia)`; `registros_till_secuencia_idx` → `registros_node_secuencia_idx` on `(t.tenantId, t.nodeId, t.secuencia)`; make `nodeId` `.notNull()`. **Keep `till_id`** (informational snapshot; still NOT NULL). Leave `registros_identidad_uq` untouched.

- [ ] **Step 5: Flip `invoice_series` and `sales` in `packages/db`**

- `series.ts`: `invoice_series_till_code_key` → `invoice_series_node_code_key` on `(t.tenantId, t.nodeId, t.code)`; `nodeId` `.notNull()`; **drop** `tillId`. Rewrite the doc comment: "A **node** may own N series and has exactly ONE chain … deliberately no unique on `(tenant, node)`."
- `sales.ts`: `nodeId` `.notNull()`; give it the composite tenant-consistent FK to `nodes(tenant_id, id)` (mirror the existing `sales`→`invoice_series` composite FK). **Keep `till_id`.**

- [ ] **Step 6: Thread the fiscal-verifactu write path**

Apply, at every site the design §13 / schema map enumerates:
- `registro-row.ts`: `RegistroRowContext.tillId` → `nodeId`; `toRegistroRow` stamps `node_id` (and keeps the `till_id` snapshot from the sale).
- `registro-sif.ts`: `currentSif(tx, tenantId, nodeId)` — `WHERE tenant_id … AND node_id … AND revocado_en IS NULL`; `registerSif` params `{tenantId, nodeId, …}`, revoke + insert keyed on node, reset `cadenas` head on `(tenantId, nodeId)`; `esPrimerRegistro` by node. Its thrown `sif.not_registered` param `{tenantId, nodeId}`.
- `chain.ts`: `selectHeadForUpdate`/`lockChainHead`/`attemptAppend` key `cadenas` on `(tenantId, nodeId)`; the `sif` guard checks the SIF matches `(tenantId, nodeId)`; `chain.append_contention` param `nodeId`.

- [ ] **Step 7: Thread the contract + backend + core**

- `packages/fiscal/src/backend.ts`: rename `registerTill` → `registerNode` (param `nodeId`); add `nodeId` to `SaleForFiscalRecord`; `checkIntegrity`/`pendingCount` take `nodeId`. `fiscal.till_not_registered` → `fiscal.node_not_registered` (`errors.ts`). **`clock.degraded` keeps `tillId`** — a clock is the till's, not the node's.
- `packages/fiscal-verifactu/src/backend.ts`: implement the renamed/re-typed methods; `recordSale`/`recordVoid`/correction resolve `currentSif(tx, …, sale.nodeId)` and `appendToChain(…, sale.nodeId, …)`; the void/correction path reads `node_id` (not `till_id`) from the original `registros_facturacion` row.
- `packages/core/src/record-sale.ts`: `RecordSaleInput.nodeId`; select `invoiceSeries.nodeId`; the guard becomes `if (series.nodeId !== input.nodeId) throw new AppError("sale.series_wrong_node", { seriesId, expected: series.nodeId, actual: input.nodeId })`; write `nodeId` into the `sales` insert and into `SaleForFiscalRecord`. Same flip in `record-correction.ts`, `record-substitution.ts`, `record-void.ts`, `settle-sale.ts` (each reads the original's node for void/correction).
- `packages/core/src/errors.ts`: replace the `sale.series_wrong_till` registry entry + type with `sale.series_wrong_node` (params `{seriesId, expected, actual}`). Grep the tree for every `series_wrong_till` string and update — codes are never renamed once shipped, but nothing is in production and there is no bwc (design §7).

- [ ] **Step 8: Update the existing suites that query `till_id`**

Update `chain.concurrency.test.ts` and any suite asserting `where till_id =` on the chain tables, and any `appendToChain(..., tillId, ...)` / `registerTill(...)` call, to node. (These are refactors of existing behavioural assertions — update the setup, do NOT weaken the assertion; `CLAUDE.md`/global rule.)

- [ ] **Step 9: Generate the flip migrations**

```bash
pnpm --filter @waitron/db exec drizzle-kit generate --name rekey_series_sales_to_node
pnpm --filter @waitron/fiscal-verifactu exec drizzle-kit generate --name rekey_chain_to_node
```

Read each SQL: expect `DROP CONSTRAINT`/`CREATE`/`ALTER COLUMN … SET NOT NULL`/`DROP COLUMN "till_id"` (on cadenas/registro_sif/invoice_series) — plain drops, no interactive rename prompt (node_id already existed from Task 3). Confirm `registros_facturacion` and `sales` KEEP `till_id`.

- [ ] **Step 10: Run the gate suite — expect PASS**

Run the §9 gate, then the full touched packages unfiltered (to load tree-wide guards):
```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test chain.node-rekey
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/shared --filter @waitron/db --filter @waitron/fiscal --filter @waitron/fiscal-verifactu --filter @waitron/core --filter @waitron/payments test:coverage
```
Prove the concurrency backstop by deletion: temporarily drop `registros_tenant_node_secuencia_uq`, confirm the gate's "distinct position, no gaps" test fails, restore it.

- [ ] **Step 11: Add the #33 dated pointer**

Append a dated pointer to `docs/superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md` (leave its body; `CLAUDE.md` §6): "**2026-08-03:** the schema gap §14 left open is closed by the node-id rekey (`2026-08-03-node-id-rekey-design.md`); #33's *server* is the code's `node`."

- [ ] **Step 12: Full gate + commit**

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
git add -A
git commit -s -m "feat: rekey fiscal chain/series/SIF from till to node (#33)"
```

---

## Self-Review

**Spec coverage** (design §-by-§):
- §1 term/scope/no-bwc → Global Constraints; §3 `nodes` table → Task 2; §2/§4 the four fiscal rekeys → Tasks 3 (columns) + 4 (flip); §5 commercial `node_id` (sales threaded, working_orders/payments column-only) → Task 3 (columns) + Task 4 (sales NOT NULL + threaded); §6 write-path threading + `NodeId` → Tasks 1 + 4; §7 error-code rename + `incidents` untouched → Task 4 step 7 (and `incidents` is simply not in any task's file list, as intended); §8 node-id from config / `registerNode` → Task 4; §9 container-prototype gate = first real-PG tests → Task 4 steps 1–2, 10; §10 out of scope → nothing plans active-active/failover/disjoint-series/submitter/CLAUDE §5 rewrite/provision-node CLI; §11 docs → Task 4 step 11 (#33 pointer); backlog + memory are `/land-branch`'s, not plan tasks.
- **Gap check:** the design's open questions (working_orders/payments nullability; incidents keying) are settled in the plan as the design's defaults (nullable; till-keyed) — no task needed unless review reverses them.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". The write-path threading (Task 4 steps 6–7) names each file and the exact transformation with the verified before/after (series guard) rather than re-transcribing every file — the implementer reads the enumerated files and applies the named change, which is the honest shape of a cross-file rename. Test bodies for the §9 gate are specified by behaviour + the concrete `chain.concurrency.test.ts` template to adapt.

**Type consistency:** `NodeId`/`nodeId` (Task 1) used consistently; `appendToChain(tx, tenantId, nodeId, alta)`, `currentSif(tx, tenantId, nodeId)`, `registerNode`, `RegistroRowContext.nodeId`, `RecordSaleInput.nodeId`, `SaleForFiscalRecord.nodeId`, `sale.series_wrong_node` — same names in the Interfaces blocks and the steps.

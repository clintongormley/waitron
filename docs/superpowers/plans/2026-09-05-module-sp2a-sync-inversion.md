# SP-2a — Sync enrolment inversion + graph-honesty guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert `@waitron/sync` so it imports no domain schema — each domain package declares its own sync enrolment, the composition root injects the assembled set, and a new guard proves the module dependency graph is honest. Behaviour-preserving.

**Architecture:** A new leaf package `@waitron/sync-enrolment` holds the enrolment-contract type (`EnrolledTable`, gaining a derived `columns` field) plus an `enrol()` builder and `tablesForLane()`. `@waitron/db`, `@waitron/identity` and `@waitron/payments` each export their own enrolment array. `apps/server` assembles `ALL_MODULES.flatMap(m => m.sync ?? [])` and injects it into the sync source (`mountSyncApi`) and the pull loop (`runSyncPull`); `@waitron/sync` drops its central `ENROLLED`/`SYNC_SCHEMA_TABLES` and its `@waitron/identity`/`@waitron/payments` dependencies. The change is staged additive-then-flip (two encodings held equal by a pin, then the source of truth flips), mirroring SP-1a.

**Tech Stack:** TypeScript, pnpm workspaces, Drizzle ORM, Vitest (unit + real-Postgres via Testcontainers), Hono (sync HTTP surface).

**Spec:** [docs/superpowers/specs/2026-09-05-module-sp2a-sync-inversion-design.md](../specs/2026-09-05-module-sp2a-sync-inversion-design.md) — read it alongside this plan.

## Global Constraints

- **Behaviour-preserving.** The same 22 tables are captured and applied identically; nothing on the wire, in the DB, or in a migration changes. No new migration, no grant change, no new error code. (spec §1, §8)
- **No domain schema in a generic package.** `@waitron/sync` must import no `@waitron/db`-schema table, and must not import `@waitron/identity` or `@waitron/payments` at all after the flip. `@waitron/sync-enrolment` is a scanned generic package — English identifiers only. (spec §2, §8)
- **The enrolment contract type is a leaf** (`@waitron/sync-enrolment`), depending only on `@waitron/shared` and `drizzle-orm`. `@waitron/db`/`@waitron/identity`/`@waitron/payments` cannot import `@waitron/module` or `@waitron/sync` (dependency cycles); they import the leaf. (spec §2a)
- **`columns` is always derived, never hand-written** — via `enrol(drizzleTable, meta)`, which reads `getTableColumns(table)`. (spec §2c)
- **Capture triggers, wire, cursor, apply loop, environment gate — unchanged.** Only the source-of-truth for the enrolment metadata moves. (spec §1)
- **Preserve behavioural assertions.** When a test is rewritten to the new shape, the assertion it made must survive — update mocks/fixtures, never weaken the check. (CLAUDE.md "when refactoring, preserve behavioural assertions")
- **Every commit is `git commit -s`.** Prove each guard by deletion (remove the check, watch the test fail, restore). (CLAUDE.md §4)
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus per-package `test:coverage` for every package touched, plus the root guards (`scripts/english-only.test.ts`, `scripts/errors-reachable.test.ts`, the new `scripts/module-graph-honesty.test.ts`), plus `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. (CLAUDE.md §2, §4)

---

## File Structure

**New:**
- `packages/sync-enrolment/` — the leaf contract package.
  - `package.json`, `tsconfig.json`, `vitest.config.ts`
  - `src/index.ts` — barrel: `EnrolledTable`, `SyncMode`, `CaptureOp`, `SyncLane`, `SYNC_LANES`, `enrol`, `tablesForLane`.
  - `src/enrolment.ts` — the types + `enrol()` + `tablesForLane()`.
  - `src/enrolment.test.ts` — unit tests for `enrol`/`tablesForLane`/`SYNC_LANES`.
- `packages/db/src/enrolment.ts` — `CORE_ENROLMENT` (the 17 core-resident tables).
- `packages/db/src/enrolment.test.ts` — columns-derivation + metadata pin.
- `packages/identity/src/enrolment.ts` + `enrolment.test.ts` — `IDENTITY_ENROLMENT` (2 tables).
- `packages/payments/src/enrolment.ts` + `enrolment.test.ts` — `PAYMENTS_ENROLMENT` (3 tables).
- `scripts/module-graph-honesty.test.ts` — the graph-honesty guard (root Vitest project).
- `apps/server/src/sync-enrolment-parity.test.ts` — the assembled-enrolment behaviour-preserving pin.

**Modified:**
- `scripts/changed-scope.mjs` — add `@waitron/sync-enrolment` to `LIGHT_B_PACKAGES`.
- `packages/db/package.json` — add `@waitron/sync-enrolment` dep + `./enrolment.js` to the `exports` map.
- `packages/db/src/index.ts` — re-export `CORE_ENROLMENT`.
- `packages/identity/package.json`, `packages/payments/package.json` — add the leaf dep.
- `packages/identity/src/index.ts`, `packages/payments/src/index.ts` — re-export their enrolment (or a new subpath; see Task 3/4).
- `packages/module/package.json` — add `@waitron/sync-enrolment` dep.
- `packages/module/src/module.ts:37` — tighten `sync?: unknown` → `sync?: readonly EnrolledTable[]`.
- `apps/server/src/modules.ts` — wire `sync:` on core/identity/payments; import the three enrolments.
- `packages/sync/src/registry.ts` — **deleted** in Task 6 (types → leaf; `ENROLLED`/`tablesForLane` → leaf/injected).
- `packages/sync/src/apply-sql.ts` — drop the 3 domain imports + `SYNC_SCHEMA_TABLES`; `entry.columns`.
- `packages/sync/src/apply.ts` — `applyBatch` consumes injected enrolments (memoised dispatch).
- `packages/sync/src/pull.ts` — `SyncPullDeps.enrolments`; thread into `applyBatch`.
- `packages/sync/src/source.ts`, `disposal.ts`, `index.ts` — repoint `./registry.js` imports to the leaf.
- `packages/sync/package.json` — drop `@waitron/identity` + `@waitron/payments`; add `@waitron/sync-enrolment`.
- `apps/server/src/sync-api.ts` — `SyncApiDeps.enrolments`; `tablesForLane(deps.enrolments, …)`.
- `apps/server/src/boot.ts` — assemble the enrolment set; pass into `mountSyncApi` (×2) and `runSyncPull`.
- `packages/sync/src/registry.test.ts`, `apply-sql.test.ts`, and the DB-backed gate tests that build batches — rewritten to the injected-enrolment shape (Task 6).
- `docs/backlog.md`, `CLAUDE.md` — Task 9.

---

## Task 1: The `@waitron/sync-enrolment` leaf package

**Files:**
- Create: `packages/sync-enrolment/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/enrolment.ts`
- Test: `packages/sync-enrolment/src/enrolment.test.ts`
- Modify: `scripts/changed-scope.mjs` (add to `LIGHT_B_PACKAGES`)

**Interfaces:**
- Produces:
  - `type SyncMode = "insert-only" | "watermark-upsert"`
  - `type CaptureOp = "insert" | "update" | "delete"`
  - `type SyncLane = "ordered" | "fast"`
  - `const SYNC_LANES: readonly SyncLane[]`
  - `interface EnrolledTable { table: string; mode: SyncMode; conflictKey: string[]; watermarkColumn: string | null; captureOps: CaptureOp[]; fkRank: number; lane: SyncLane; columns: string[] }`
  - `function enrol(table: Table, meta: Omit<EnrolledTable, "table" | "columns">): EnrolledTable`
  - `function tablesForLane(enrolments: readonly EnrolledTable[], lane: SyncLane): string[]`

- [ ] **Step 1: Scaffold the package.** Copy the shape of an existing tiny leaf. Look at `packages/module/package.json` and `packages/module/tsconfig.json` and `packages/module/vitest.config.ts` for the exact house shape, then create:

`packages/sync-enrolment/package.json`:
```json
{
  "name": "@waitron/sync-enrolment",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@waitron/shared": "workspace:*",
    "drizzle-orm": "^0.45.2"
  }
}
```
Copy `tsconfig.json` and `vitest.config.ts` verbatim from `packages/module/` (adjust nothing but any package-name comment). Match `packages/module/vitest.config.ts`'s coverage thresholds (the default 98/98/98/95).

- [ ] **Step 2: Register the package in the CI light shard.** In `scripts/changed-scope.mjs`, add `"@waitron/sync-enrolment"` to the `LIGHT_B_PACKAGES` array (currently ending at `@waitron/diagnostics`, line ~239). The header comment at `changed-scope.mjs:207` states a new package must be in exactly one bin or `scripts/ci-workflow.test.mjs`'s "nothing runs twice" assertion fails loudly. Run `pnpm vitest run scripts/changed-scope.test.mjs scripts/ci-workflow.test.mjs` — expect PASS. (If `changed-scope.test.mjs` pins a member count or the full member set, update it to include the new package.)

- [ ] **Step 3: Write the failing test** `packages/sync-enrolment/src/enrolment.test.ts`:
```ts
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { SYNC_LANES, enrol, tablesForLane, type EnrolledTable } from "./index.js";

// A throwaway Drizzle table so enrol() has real columns to read — proves columns are DERIVED, not
// passed. Column names (not the JS keys) are what enrol must capture.
const fixture = pgTable("fixture_widgets", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
});

describe("enrol", () => {
  it("derives the physical table name and the ordered column-name list from the Drizzle table", () => {
    const e = enrol(fixture, {
      mode: "watermark-upsert",
      conflictKey: ["id"],
      watermarkColumn: null,
      captureOps: ["insert", "update"],
      fkRank: 0,
      lane: "ordered",
    });
    expect(e.table).toBe("fixture_widgets");
    expect(e.columns).toEqual(["id", "display_name"]);
    expect(e.mode).toBe("watermark-upsert");
    expect(e.conflictKey).toEqual(["id"]);
    expect(e.lane).toBe("ordered");
  });
});

describe("tablesForLane", () => {
  const enrolments: EnrolledTable[] = [
    enrol(fixture, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 0, lane: "ordered" }),
    enrol(pgTable("fixture_fast", { id: uuid("id").primaryKey() }), { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 0, lane: "fast" }),
  ];
  it("returns only the tables on the named lane", () => {
    expect(tablesForLane(enrolments, "fast")).toEqual(["fixture_fast"]);
    expect(tablesForLane(enrolments, "ordered")).toEqual(["fixture_widgets"]);
  });
});

describe("SYNC_LANES", () => {
  it("is exactly the two lanes", () => {
    expect(SYNC_LANES).toEqual(["ordered", "fast"]);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails.** Run: `pnpm --filter @waitron/sync-enrolment test` — Expected: FAIL (module `./index.js` / `enrol` not found).

- [ ] **Step 5: Implement `src/enrolment.ts`:**
```ts
import { getTableColumns, getTableName, type Table } from "drizzle-orm";

/** insert-only → `ON CONFLICT DO NOTHING`; watermark-upsert → `ON CONFLICT DO UPDATE SET …`. */
export type SyncMode = "insert-only" | "watermark-upsert";

/** The DML the capture trigger fires on. */
export type CaptureOp = "insert" | "update" | "delete";

/** Which replication lane carries a table. `payments`/`payment_refunds` ride the fast lane; every
 * other enrolled table rides the ordered lane. */
export type SyncLane = "ordered" | "fast";

/** Every sync lane, for callers acting ACROSS all lanes (the disposal guard). */
export const SYNC_LANES = ["ordered", "fast"] as const satisfies readonly SyncLane[];

/**
 * One enrolled table's replication metadata. Declared by the OWNING package (the package that owns
 * the Drizzle table), assembled by the composition root, and consumed by `@waitron/sync` — which no
 * longer imports any domain schema. `columns` is the ordered physical column-name list the apply
 * path needs for a watermark `DO UPDATE SET`; it is DERIVED by {@link enrol}, never hand-written, so
 * it cannot drift from the schema (spec §2b/§2c).
 */
export interface EnrolledTable {
  table: string;
  mode: SyncMode;
  conflictKey: string[];
  watermarkColumn: string | null;
  captureOps: CaptureOp[];
  fkRank: number;
  lane: SyncLane;
  columns: string[];
}

/**
 * Build an {@link EnrolledTable} from a Drizzle table plus its replication metadata. Reads the
 * physical table name and the ordered physical column-name list off the schema object (identical to
 * the old central `columnNamesFor`), so the owning package declares enrolment without `@waitron/sync`
 * ever seeing its schema (spec §2c).
 */
export function enrol(table: Table, meta: Omit<EnrolledTable, "table" | "columns">): EnrolledTable {
  return {
    table: getTableName(table),
    columns: Object.values(getTableColumns(table)).map((c) => c.name),
    ...meta,
  };
}

/** The physical table names on one lane, derived from the assembled enrolment set. */
export function tablesForLane(enrolments: readonly EnrolledTable[], lane: SyncLane): string[] {
  return enrolments.filter((e) => e.lane === lane).map((e) => e.table);
}
```
And `src/index.ts`:
```ts
export {
  SYNC_LANES,
  enrol,
  tablesForLane,
  type CaptureOp,
  type EnrolledTable,
  type SyncLane,
  type SyncMode,
} from "./enrolment.js";
```

- [ ] **Step 6: Run the test to verify it passes.** Run: `pnpm --filter @waitron/sync-enrolment test:coverage` — Expected: PASS at threshold. Run `pnpm install` so the new workspace package links.

- [ ] **Step 7: Commit.**
```bash
git add packages/sync-enrolment scripts/changed-scope.mjs pnpm-lock.yaml
git commit -s -m "feat(sync-enrolment): leaf enrolment contract + enrol builder + tablesForLane"
```

---

## Task 2: `@waitron/db` exports `CORE_ENROLMENT` (17 core-resident tables)

**Files:**
- Create: `packages/db/src/enrolment.ts`
- Test: `packages/db/src/enrolment.test.ts`
- Modify: `packages/db/package.json` (dep + `exports`), `packages/db/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `enrol`, `EnrolledTable` from `@waitron/sync-enrolment` (Task 1).
- Produces: `const CORE_ENROLMENT: readonly EnrolledTable[]` — the 17 tables `sales`, `sale_lines`, `tenders`, `sale_settlements`, `sale_substitutions`, `sale_voids`, `catalogues`, `categories`, `products`, `working_orders`, `working_order_lines`, `dining_tables`, `floor_zones`, `table_service_statuses`, `kitchen_stations`, `kitchen_courses`, `ticket_items`.

- [ ] **Step 1: Add the dependency + export entry.** In `packages/db/package.json` add `"@waitron/sync-enrolment": "workspace:*"` to `dependencies`, and add `"./enrolment.js": "./src/enrolment.ts"` to the `exports` map (the map is enumerated, not a wildcard — CLAUDE.md §3). Run `pnpm install`.

- [ ] **Step 2: Write the failing test** `packages/db/src/enrolment.test.ts`:
```ts
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  catalogues, categories, diningTables, floorZones, kitchenCourses, kitchenStations, products,
  saleLines, saleSettlements, saleSubstitutions, saleVoids, sales, tableServiceStatuses, tenders,
  ticketItems, workingOrderLines, workingOrders,
} from "./index.js";
import { CORE_ENROLMENT } from "./enrolment.js";

const byName = new Map(CORE_ENROLMENT.map((e) => [e.table, e]));
const SCHEMA = {
  sales, sale_lines: saleLines, tenders, sale_settlements: saleSettlements,
  sale_substitutions: saleSubstitutions, sale_voids: saleVoids, catalogues, categories, products,
  working_orders: workingOrders, working_order_lines: workingOrderLines, dining_tables: diningTables,
  floor_zones: floorZones, table_service_statuses: tableServiceStatuses,
  kitchen_stations: kitchenStations, kitchen_courses: kitchenCourses, ticket_items: ticketItems,
} as const;

describe("CORE_ENROLMENT", () => {
  it("enrols exactly the 17 core-resident tables", () => {
    expect([...byName.keys()].sort()).toEqual(Object.keys(SCHEMA).sort());
    expect(CORE_ENROLMENT).toHaveLength(17);
  });

  it("each entry's columns equal getTableColumns(schema) — derived, cannot drift", () => {
    for (const [table, drizzleTable] of Object.entries(SCHEMA)) {
      const e = byName.get(table);
      if (e === undefined) throw new Error(`missing enrolment for ${table}`);
      const expected = Object.values(getTableColumns(drizzleTable)).map((c) => c.name);
      expect(e.columns).toEqual(expected);
    }
  });

  it("pins the representative metadata (sales insert-only, working_orders group-C, payment none here)", () => {
    expect(byName.get("sales")).toMatchObject({ mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 3, lane: "ordered" });
    expect(byName.get("catalogues")).toMatchObject({ mode: "watermark-upsert", watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" });
    expect(byName.get("working_orders")).toMatchObject({ mode: "watermark-upsert", watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 2, lane: "ordered" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.** Run: `pnpm --filter @waitron/db test enrolment` — Expected: FAIL (`./enrolment.js` not found).

- [ ] **Step 4: Implement `packages/db/src/enrolment.ts`.** Import the 17 tables from the local schema barrel and `enrol` from the leaf; copy each table's metadata **verbatim from `packages/sync/src/registry.ts`'s `ENROLLED`** (the core-owned subset — groups A minus payment_refunds, B minus payments/payment_policy, C, D, F):
```ts
import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import {
  catalogues, categories, diningTables, floorZones, kitchenCourses, kitchenStations, products,
  saleLines, saleSettlements, saleSubstitutions, saleVoids, sales, tableServiceStatuses, tenders,
  ticketItems, workingOrderLines, workingOrders,
} from "./index.js";

/**
 * The sync enrolment for the tables `@waitron/db` (the `core` module) owns — the 17 tenant-scoped,
 * non-fiscal `core`-resident tables that cross the wire. Metadata copied verbatim from the former
 * central `packages/sync/src/registry.ts` ENROLLED (SP-2a inversion, spec §2d); `columns` derived by
 * `enrol`. `@waitron/payments` (payments/payment_refunds/payment_policy) and `@waitron/identity`
 * (persons/webauthn_credentials) declare their own — this array is exactly the core-owned subset.
 */
export const CORE_ENROLMENT: readonly EnrolledTable[] = [
  enrol(sales, { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 3, lane: "ordered" }),
  enrol(saleLines, { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }),
  enrol(tenders, { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }),
  enrol(saleSettlements, { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }),
  enrol(saleSubstitutions, { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }),
  enrol(saleVoids, { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }),
  enrol(catalogues, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }),
  enrol(categories, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 1, lane: "ordered" }),
  enrol(products, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 2, lane: "ordered" }),
  enrol(workingOrders, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 2, lane: "ordered" }),
  enrol(workingOrderLines, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 3, lane: "ordered" }),
  enrol(floorZones, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }),
  enrol(tableServiceStatuses, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }),
  enrol(diningTables, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 1, lane: "ordered" }),
  enrol(kitchenStations, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }),
  enrol(kitchenCourses, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }),
  enrol(ticketItems, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 4, lane: "ordered" }),
];
```
Then re-export from `packages/db/src/index.ts` (near the other schema re-exports): `export { CORE_ENROLMENT } from "./enrolment.js";`. **Verify** the imported names against `packages/sync/src/apply-sql.ts:12-30` (the 17 identifiers) — they are the exact Drizzle table variables the old central map used.

- [ ] **Step 5: Run the test to verify it passes.** Run: `pnpm --filter @waitron/db test enrolment` — Expected: PASS. Then the whole package: `pnpm --filter @waitron/db test:coverage`.

- [ ] **Step 6: Commit.**
```bash
git add packages/db pnpm-lock.yaml
git commit -s -m "feat(db): CORE_ENROLMENT — core module declares its own sync enrolment"
```

---

## Task 3: `@waitron/identity` exports `IDENTITY_ENROLMENT`

**Files:**
- Create: `packages/identity/src/enrolment.ts`, `packages/identity/src/enrolment.test.ts`
- Modify: `packages/identity/package.json` (dep), `packages/identity/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `enrol`, `EnrolledTable` from `@waitron/sync-enrolment`; `persons`, `webauthnCredentials` from identity's own schema (`./schema/index.js`).
- Produces: `const IDENTITY_ENROLMENT: readonly EnrolledTable[]` — `persons`, `webauthn_credentials`.

- [ ] **Step 1: Add the dep.** `packages/identity/package.json` → add `"@waitron/sync-enrolment": "workspace:*"`. `pnpm install`.

- [ ] **Step 2: Write the failing test** `packages/identity/src/enrolment.test.ts`:
```ts
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { persons, webauthnCredentials } from "./schema/index.js";
import { IDENTITY_ENROLMENT } from "./enrolment.js";

const byName = new Map(IDENTITY_ENROLMENT.map((e) => [e.table, e]));

describe("IDENTITY_ENROLMENT", () => {
  it("enrols persons and webauthn_credentials", () => {
    expect([...byName.keys()].sort()).toEqual(["persons", "webauthn_credentials"]);
  });
  it("persons: insert+update, no delete grant; webauthn_credentials: insert+update+delete", () => {
    expect(byName.get("persons")).toMatchObject({ mode: "watermark-upsert", watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" });
    expect(byName.get("webauthn_credentials")).toMatchObject({ mode: "watermark-upsert", watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 1, lane: "ordered" });
  });
  it("columns are derived from the schema", () => {
    expect(byName.get("persons")!.columns).toEqual(Object.values(getTableColumns(persons)).map((c) => c.name));
    expect(byName.get("webauthn_credentials")!.columns).toEqual(Object.values(getTableColumns(webauthnCredentials)).map((c) => c.name));
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `pnpm --filter @waitron/identity test enrolment` — Expected: FAIL.

- [ ] **Step 4: Implement `packages/identity/src/enrolment.ts`** (metadata verbatim from `ENROLLED` Group E):
```ts
import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import { persons, webauthnCredentials } from "./schema/index.js";

/** Identity's sync enrolment (SP-2a): its config tables flow DOWN to a read-only secondary so it can
 * authenticate the venue's people on failover. Metadata verbatim from the former central ENROLLED
 * (Group E); columns derived by `enrol`. */
export const IDENTITY_ENROLMENT: readonly EnrolledTable[] = [
  enrol(persons, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }),
  enrol(webauthnCredentials, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 1, lane: "ordered" }),
];
```
Re-export from `packages/identity/src/index.ts`: `export { IDENTITY_ENROLMENT } from "./enrolment.js";`. **Check first** that identity's barrel does not pull in its auth runtime in a way that makes a plain `import { IDENTITY_ENROLMENT } from "@waitron/identity"` heavy for `apps/server` — if the barrel is heavy, export via a subpath instead (mirror how `apps/server` already imports identity), and note the chosen import path in Task 5's Interfaces. (apply-sql.ts:36-39 warns identity's barrel loads the auth runtime; `enrolment.ts` itself imports only `./schema`, so the concern is only the re-export path.)

- [ ] **Step 5: Run to verify it passes.** Run: `pnpm --filter @waitron/identity test:coverage` — Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/identity pnpm-lock.yaml
git commit -s -m "feat(identity): IDENTITY_ENROLMENT — identity declares its own sync enrolment"
```

---

## Task 4: `@waitron/payments` exports `PAYMENTS_ENROLMENT`

**Files:**
- Create: `packages/payments/src/enrolment.ts`, `packages/payments/src/enrolment.test.ts`
- Modify: `packages/payments/package.json` (dep), `packages/payments/src/index.ts` or a subpath (re-export)

**Interfaces:**
- Consumes: `enrol`, `EnrolledTable` from `@waitron/sync-enrolment`; `payments`, `paymentRefunds`, `paymentPolicy` from `./schema/index.js`.
- Produces: `const PAYMENTS_ENROLMENT: readonly EnrolledTable[]` — `payments` (fast), `payment_refunds` (fast), `payment_policy` (conflictKey `["tenant_id"]`).

- [ ] **Step 1: Add the dep.** `packages/payments/package.json` → `"@waitron/sync-enrolment": "workspace:*"`. `pnpm install`.

- [ ] **Step 2: Write the failing test** `packages/payments/src/enrolment.test.ts`:
```ts
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { paymentPolicy, paymentRefunds, payments } from "./schema/index.js";
import { PAYMENTS_ENROLMENT } from "./enrolment.js";

const byName = new Map(PAYMENTS_ENROLMENT.map((e) => [e.table, e]));

describe("PAYMENTS_ENROLMENT", () => {
  it("enrols payments, payment_refunds, payment_policy", () => {
    expect([...byName.keys()].sort()).toEqual(["payment_policy", "payment_refunds", "payments"]);
  });
  it("payments/payment_refunds ride the FAST lane; payment_policy keys on tenant_id", () => {
    expect(byName.get("payments")).toMatchObject({ mode: "watermark-upsert", watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 3, lane: "fast" });
    expect(byName.get("payment_refunds")).toMatchObject({ mode: "insert-only", watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "fast" });
    expect(byName.get("payment_policy")).toMatchObject({ mode: "watermark-upsert", conflictKey: ["tenant_id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" });
  });
  it("columns are derived from the schema", () => {
    expect(byName.get("payment_policy")!.columns).toEqual(Object.values(getTableColumns(paymentPolicy)).map((c) => c.name));
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `pnpm --filter @waitron/payments test enrolment` — Expected: FAIL.

- [ ] **Step 4: Implement `packages/payments/src/enrolment.ts`** (metadata verbatim from `ENROLLED` — payment_refunds Group A, payments Group B, payment_policy Group B):
```ts
import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import { paymentPolicy, paymentRefunds, payments } from "./schema/index.js";

/** Payments' sync enrolment (SP-2a). payments/payment_refunds ride the FAST lane (shrinking the
 * double-charge exposure of active-active selling); payment_policy is one row per tenant, so its
 * conflict key is (tenant_id). Metadata verbatim from the former central ENROLLED; columns derived. */
export const PAYMENTS_ENROLMENT: readonly EnrolledTable[] = [
  enrol(payments, { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 3, lane: "fast" }),
  enrol(paymentRefunds, { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "fast" }),
  enrol(paymentPolicy, { mode: "watermark-upsert", conflictKey: ["tenant_id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }),
];
```
Re-export from `packages/payments/src/index.ts` (or a subpath if the barrel is heavy — apply-sql.ts:31-35 notes payments' schema is behind `./schema`, and the barrel does not re-export schema tables; a plain `PAYMENTS_ENROLMENT` re-export from the barrel is fine since `enrolment.ts` imports only `./schema`). Note the chosen import path in Task 5.

- [ ] **Step 5: Run to verify it passes.** Run: `pnpm --filter @waitron/payments test:coverage` — Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/payments pnpm-lock.yaml
git commit -s -m "feat(payments): PAYMENTS_ENROLMENT — payments declares its own sync enrolment"
```

---

## Task 5: Tighten `WaitronModule.sync`; wire enrolments into `ALL_MODULES`; parity pin

**Files:**
- Modify: `packages/module/package.json` (dep), `packages/module/src/module.ts:37`, `apps/server/src/modules.ts`
- Create: `apps/server/src/sync-enrolment-parity.test.ts`
- Modify (if it pins descriptor shape): `apps/server/src/modules.test.ts`

**Interfaces:**
- Consumes: `CORE_ENROLMENT` (`@waitron/db`), `IDENTITY_ENROLMENT` (`@waitron/identity`), `PAYMENTS_ENROLMENT` (`@waitron/payments`) — at the import paths chosen in Tasks 2–4; `EnrolledTable` from `@waitron/sync-enrolment`.
- Produces: `ALL_MODULES` descriptors for `core`/`identity`/`payments` now carry a typed `sync: readonly EnrolledTable[]`; the assembled set `ALL_MODULES.flatMap(m => m.sync ?? [])` (22 tables) is available to Task 6.

- [ ] **Step 1: Tighten the contract.** In `packages/module/package.json` add `"@waitron/sync-enrolment": "workspace:*"`. In `packages/module/src/module.ts`, change line 37 from `readonly sync?: unknown; // SP-2` to:
```ts
  /** SP-2a: the tables this module enrols into @waitron/sync, declared BY the owning package. The
   * first deferred seat to gain its real type; the composition root assembles every module's enrolment
   * and injects it, so @waitron/sync imports no domain schema (spec §2/§5). */
  readonly sync?: readonly EnrolledTable[];
```
and add the import at the top: `import type { EnrolledTable } from "@waitron/sync-enrolment";`. `pnpm install`; `pnpm --filter @waitron/module typecheck`.

- [ ] **Step 2: Write the failing parity test** `apps/server/src/sync-enrolment-parity.test.ts`. This is the behaviour-preserving pin while both encodings coexist: the assembled enrolment's shared fields must deep-equal `@waitron/sync`'s still-present `ENROLLED`. (`columns` is excluded — `ENROLLED` has none yet; Task 6 replaces this comparison with a frozen snapshot.)
```ts
import { ENROLLED } from "@waitron/sync";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "./modules.js";

const SHARED = (e: { table: string; mode: string; conflictKey: string[]; watermarkColumn: string | null; captureOps: string[]; fkRank: number; lane: string }) => ({
  table: e.table, mode: e.mode, conflictKey: e.conflictKey, watermarkColumn: e.watermarkColumn,
  captureOps: e.captureOps, fkRank: e.fkRank, lane: e.lane,
});

describe("assembled module enrolment equals the central ENROLLED (behaviour-preserving)", () => {
  const assembled = ALL_MODULES.flatMap((m) => m.sync ?? []);
  it("covers exactly ENROLLED's 22 tables with identical metadata", () => {
    const byAssembled = new Map(assembled.map((e) => [e.table, SHARED(e)]));
    const byCentral = new Map(ENROLLED.map((e) => [e.table, SHARED(e)]));
    expect([...byAssembled.keys()].sort()).toEqual([...byCentral.keys()].sort());
    expect(assembled).toHaveLength(22);
    for (const [table, central] of byCentral) expect(byAssembled.get(table)).toEqual(central);
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `pnpm --filter @waitron/server test sync-enrolment-parity` — Expected: FAIL (`ALL_MODULES` descriptors carry no `sync` yet → assembled is empty).

- [ ] **Step 4: Wire `ALL_MODULES`.** In `apps/server/src/modules.ts`, add imports (paths per Tasks 2–4):
```ts
import { CORE_ENROLMENT } from "@waitron/db";
import { IDENTITY_ENROLMENT } from "@waitron/identity";
import { PAYMENTS_ENROLMENT } from "@waitron/payments";
```
and add `sync:` to the three descriptors: `core` → `sync: CORE_ENROLMENT`, `identity` → `sync: IDENTITY_ENROLMENT`, `payments` → `sync: PAYMENTS_ENROLMENT`. Leave every other descriptor without a `sync` field (nothing enrolled). Update the `modules.ts` header doc-comment: `sync` is now populated on core/identity/payments (no longer "empty until its own slice").

- [ ] **Step 5: Run to verify it passes.** Run: `pnpm --filter @waitron/server test sync-enrolment-parity` — Expected: PASS. **Prove by deletion:** drop one table from `CORE_ENROLMENT` → the parity test fails on the table-set mismatch → restore. If `modules.test.ts` pins the descriptor shape (e.g. asserts no domain fields), update it to allow the `sync` field, preserving its other assertions.

- [ ] **Step 6: Commit.**
```bash
git add packages/module apps/server/src/modules.ts apps/server/src/sync-enrolment-parity.test.ts apps/server/src/modules.test.ts pnpm-lock.yaml
git commit -s -m "feat(module): wire per-package sync enrolment into ALL_MODULES + parity pin"
```

---

## Task 6: Flip `@waitron/sync` to consume the injected enrolment set

This is the atomic inversion: `@waitron/sync` stops owning enrolment data and stops importing domain schema; the composition root injects the assembled set. It is one task because the type change, the `ENROLLED` removal, and the `apps/server` wiring must land together for a green typecheck.

**Files:**
- Modify: `packages/sync/src/apply-sql.ts`, `apply.ts`, `pull.ts`, `source.ts`, `disposal.ts`, `index.ts`, `package.json`
- Delete: `packages/sync/src/registry.ts`, `packages/sync/src/registry.test.ts`
- Rewrite: `packages/sync/src/apply-sql.test.ts`, and the DB-backed gate tests that build batches (`apply.gate.test.ts`, `pull.test.ts`, `pull.gate.test.ts`, `redelivery.gate.test.ts`, `source.gate.test.ts` — whichever reference `ENROLLED`/call `applyBatch`/`tablesForLane`)
- Modify: `apps/server/src/sync-api.ts`, `apps/server/src/boot.ts`, `apps/server/src/sync-enrolment-parity.test.ts`
- Modify: any `apps/server` sync test that calls `runSyncPull`/`mountSyncApi` and must now pass `enrolments` (`boot.test.ts`, `boot.singleton.rls.test.ts`, `membership-gossip.e2e.test.ts`, `mirror-e2e.rls.test.ts`, `adopt-e2e.rls.test.ts`, `sync-api.rls.test.ts`)

**Interfaces:**
- Consumes: the assembled `ALL_MODULES.flatMap(m => m.sync ?? [])` (Task 5); `EnrolledTable`, `SyncLane`, `SYNC_LANES`, `tablesForLane` from `@waitron/sync-enrolment`.
- Produces:
  - `ApplyBatchOptions` gains `enrolments: readonly EnrolledTable[]`.
  - `SyncPullDeps` gains `enrolments: readonly EnrolledTable[]`.
  - `SyncApiDeps` gains `enrolments: readonly EnrolledTable[]`.
  - `@waitron/sync` barrel re-exports `EnrolledTable`/`SyncMode`/`CaptureOp`/`SyncLane`/`SYNC_LANES`/`tablesForLane` from the leaf (so existing importers of `@waitron/sync` keep resolving) but no longer exports `ENROLLED`.

- [ ] **Step 1: Point `@waitron/sync` at the leaf; drop domain deps.** In `packages/sync/package.json`: remove `@waitron/identity` and `@waitron/payments` from `dependencies`; add `"@waitron/sync-enrolment": "workspace:*"`. `pnpm install`. (Do not run tests yet — the package will not typecheck until the steps below land; this step just fixes the manifest.)

- [ ] **Step 2: Invert `apply-sql.ts`.** Replace the three domain imports + `SYNC_SCHEMA_TABLES` + `columnNamesFor` with `entry.columns`, and preserve the loud-failure assertion (a watermark entry with no columns is a bug, not silent broken SQL). New head of `apply-sql.ts`:
```ts
import type { EnrolledTable } from "@waitron/sync-enrolment";
```
Delete lines 11-72 (the drizzle + domain imports and `SYNC_SCHEMA_TABLES`). Replace `columnNamesFor` and the watermark branch of `applyStatementFor`:
```ts
export function applyStatementFor(entry: EnrolledTable): string {
  const t = entry.table;
  const key = entry.conflictKey.join(", ");
  const populate = `insert into ${t} select * from jsonb_populate_record(null::${t}, $1)`;
  if (entry.mode === "insert-only") {
    return `${populate} on conflict (${key}) do nothing`;
  }
  const setCols = entry.columns.filter((c) => !entry.conflictKey.includes(c));
  if (setCols.length === 0) {
    // A watermark-upsert with no non-key columns would emit an empty SET — a broken enrolment, not a
    // valid statement. `enrol` always derives a real column list, so this only fires on a hand-built
    // fixture (the assertion the old columnNamesFor "no drizzle object" guard made, preserved).
    throw new Error(`enrolled table "${t}" has no non-key columns to upsert`);
  }
  const setClause = setCols.map((c) => `${c} = excluded.${c}`).join(", ");
  const upsert = `${populate} on conflict (${key}) do update set ${setClause}`;
  if (entry.watermarkColumn === null) return upsert;
  return `${upsert} where excluded.${entry.watermarkColumn} > ${t}.${entry.watermarkColumn}`;
}
```
`deleteStatementFor` is unchanged.

- [ ] **Step 3: Rewrite `apply-sql.test.ts` to local fixtures.** It no longer imports `ENROLLED`/`SYNC_SCHEMA_TABLES`; it builds representative `EnrolledTable` fixtures (with `columns`) and pins the exact SQL — preserving every assertion the old suite made (the three mode statements, the delete-by-key, the delete refusal, the "no non-key columns throws" case). Example core assertions:
```ts
import { describe, expect, it } from "vitest";
import { applyStatementFor, deleteStatementFor } from "./apply-sql.js";
import type { EnrolledTable } from "@waitron/sync-enrolment";

const salesEntry: EnrolledTable = { table: "sales", mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 3, lane: "ordered", columns: ["id", "tenant_id", "total"] };
const policyEntry: EnrolledTable = { table: "payment_policy", mode: "watermark-upsert", conflictKey: ["tenant_id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 0, lane: "ordered", columns: ["tenant_id", "offline_mode", "offline_amount_cap", "created_at", "updated_at"] };
const woEntry: EnrolledTable = { table: "working_orders", mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 2, lane: "ordered", columns: ["id", "tenant_id", "status"] };

it("insert-only → DO NOTHING", () => {
  expect(applyStatementFor(salesEntry)).toBe("insert into sales select * from jsonb_populate_record(null::sales, $1) on conflict (id) do nothing");
});
it("watermark WITH column → DO UPDATE SET … WHERE (payment_policy, key=tenant_id)", () => {
  expect(applyStatementFor(policyEntry)).toBe("insert into payment_policy select * from jsonb_populate_record(null::payment_policy, $1) on conflict (tenant_id) do update set offline_mode = excluded.offline_mode, offline_amount_cap = excluded.offline_amount_cap, created_at = excluded.created_at, updated_at = excluded.updated_at where excluded.updated_at > payment_policy.updated_at");
});
it("watermark NULL → unconditional DO UPDATE SET (working_orders)", () => {
  expect(applyStatementFor(woEntry)).toBe("insert into working_orders select * from jsonb_populate_record(null::working_orders, $1) on conflict (id) do update set tenant_id = excluded.tenant_id, status = excluded.status");
});
it("a watermark entry with no non-key columns throws", () => {
  expect(() => applyStatementFor({ ...woEntry, columns: ["id"] })).toThrow(/no non-key columns/);
});
it("delete-by-key for a delete-capable table; refuses a non-delete table", () => {
  expect(deleteStatementFor(woEntry)).toBe("delete from working_orders where id = ($1->>'id')::uuid");
  expect(() => deleteStatementFor(salesEntry)).toThrow(/delete/i);
});
```
(The full column lists for the pinned statements need only be internally consistent — the SQL is a pure function of the fixture's `columns`. The REAL column lists are pinned in each owning package's `enrolment.test.ts`, Tasks 2–4.)

- [ ] **Step 4: Invert `apply.ts`.** Change the `ENROLLED` import to the leaf type, and build `DISPATCH` from injected enrolments (memoised on the array reference so the "build once" property holds):
```ts
import { type EnrolledTable, type SyncLane } from "@waitron/sync-enrolment";
// …delete: import { ENROLLED, … } from "./registry.js";
```
Add `enrolments: readonly EnrolledTable[]` to `ApplyBatchOptions` (documented: the assembled module enrolment set, injected by the composition root — spec §2e). Replace the module-level `const DISPATCH = new Map(ENROLLED.map(…))` with:
```ts
const DISPATCH_CACHE = new WeakMap<readonly EnrolledTable[], ReadonlyMap<string, Dispatch>>();
function dispatchFor(enrolments: readonly EnrolledTable[]): ReadonlyMap<string, Dispatch> {
  let d = DISPATCH_CACHE.get(enrolments);
  if (d === undefined) {
    d = new Map(enrolments.map((entry) => [entry.table, { entry, applyParts: splitStatement(applyStatementFor(entry)) }]));
    DISPATCH_CACHE.set(enrolments, d);
  }
  return d;
}
```
In `applyBatch`, after the handshake, `const DISPATCH = dispatchFor(opts.enrolments);` and pass it into `tryApplyRow`/`applyOneRow` (thread `DISPATCH` as a parameter, since it is no longer module-global). The `sync.table_not_enrolled` throw is unchanged.

- [ ] **Step 5: Invert `pull.ts`, `source.ts`, `disposal.ts`, `index.ts`.**
  - `pull.ts`: add `enrolments: readonly EnrolledTable[]` to `SyncPullDeps` (doc: the assembled module enrolment set, injected by boot); in `syncPullOnce`, pass `enrolments: deps.enrolments` into the `applyBatch(...)` opts. Repoint `import type { SyncLane } from "./registry.js"` → `from "@waitron/sync-enrolment"`.
  - `source.ts`, `disposal.ts`: repoint `./registry.js` type/`SYNC_LANES` imports → `@waitron/sync-enrolment`.
  - `index.ts`: replace the `./registry.js` re-export block (`ENROLLED, SYNC_LANES, tablesForLane` + types) with a re-export from the leaf of `SYNC_LANES`, `tablesForLane`, and the types — and DROP `ENROLLED`. Keep all other barrel exports.
  - Delete `packages/sync/src/registry.ts` and `registry.test.ts`.

- [ ] **Step 6: Rewrite the sync DB-backed gate tests** that reference `ENROLLED` or call `applyBatch`/`tablesForLane`. They build a small local enrolment fixture (or import `CORE_ENROLMENT` from `@waitron/db`, which `@waitron/sync`'s tests may import — the dep exists) and pass it as `opts.enrolments`. Preserve every behavioural assertion (idempotency, FK-defer, cursor advance, lane disjointness). Grep first: `grep -rln "ENROLLED\|SYNC_SCHEMA_TABLES\|tablesForLane\|\./registry\.js" packages/sync/src` and address each — every `./registry.js` import (types included) must repoint to `@waitron/sync-enrolment`, since `registry.ts` is deleted.

- [ ] **Step 7: Inject in `apps/server`.** In `apps/server/src/sync-api.ts`: add `enrolments: readonly EnrolledTable[]` to `SyncApiDeps` (import the type from `@waitron/sync`), and change line 134 to `const tables = tablesForLane(deps.enrolments, laneParam(c.req.query("lane")));`. In `apps/server/src/boot.ts`: assemble the set once near where `ALL_MODULES` is used —
```ts
const syncEnrolments = ALL_MODULES.flatMap((m) => m.sync ?? []);
```
— and pass `enrolments: syncEnrolments` into both `mountSyncApi(...)` calls (boot.ts:1292, :1310) and into the `runSyncPull({...})` deps (boot.ts:1373). (SP-2a assembles from `ALL_MODULES`, not the enabled set, to stay behaviour-preserving — today's `ENROLLED` was unconditional; the enabled-set-aware pull is SP-2b, spec §6.)

- [ ] **Step 8: Fix the `apps/server` sync tests** that construct `runSyncPull`/`mountSyncApi` deps to pass `enrolments` (e.g. `enrolments: ALL_MODULES.flatMap((m) => m.sync ?? [])`, or a fixture). Grep: `grep -rln "runSyncPull\|mountSyncApi" apps/server/src` and add the field to each deps object the tests build. Update `sync-enrolment-parity.test.ts` (Task 5): `ENROLLED` is gone, so pin the assembled set against a **frozen inline 22-table snapshot** (copy the shared-field values from the deleted `registry.test.ts` `SPEC`) — the behaviour-preserving oracle now lives here.

- [ ] **Step 9: Verify inversion + green.** Add an assertion (in `apps/server/src/sync-enrolment-parity.test.ts` or a small `packages/sync` manifest test) that `@waitron/sync`'s `package.json` names neither `@waitron/identity` nor `@waitron/payments`:
```ts
import { readFileSync } from "node:fs";
it("@waitron/sync imports no domain package (inversion proof)", () => {
  const deps = JSON.parse(readFileSync(new URL("../../sync/package.json", import.meta.url), "utf8")).dependencies;
  expect(deps["@waitron/identity"]).toBeUndefined();
  expect(deps["@waitron/payments"]).toBeUndefined();
});
```
(Adjust the relative path to the runner's cwd.) Then run, green: `pnpm --filter @waitron/sync test:coverage`, `pnpm --filter @waitron/server test:coverage`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.

- [ ] **Step 10: Commit.**
```bash
git add packages/sync apps/server/src/sync-api.ts apps/server/src/boot.ts apps/server/src/*.test.ts pnpm-lock.yaml
git commit -s -m "feat(sync): consume injected module enrolments — @waitron/sync imports no domain schema"
```

---

## Task 7: The graph-honesty guard

**Files:**
- Create: `scripts/module-graph-honesty.test.ts`

**Interfaces:**
- Consumes: `ALL_MODULES` from `apps/server/src/modules.ts`; each package's `drizzle/*.sql`.

- [ ] **Step 1: Study the house style.** Read `scripts/errors-reachable.test.ts` and `scripts/guarded-teardowns.test.ts` in full — copy their structure: a doc-comment header stating WHY it is a tree-wide root-project program + its known limitations; discovery-driven package enumeration; a vacuous-pass anchor; an inline-fixture "the detector itself" block with positive + negative controls; a final tree-wide `toEqual([])`.

- [ ] **Step 2: Write the failing test** `scripts/module-graph-honesty.test.ts`. Structure:
```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../apps/server/src/modules.js";

// Discover packages shipping a drizzle/ dir; map each CREATE TABLE "<name>" to its owning module.
// Scan each package's drizzle/*.sql for REFERENCES "<schema>"."<table>" and CREATE TRIGGER … ON
// "<schema>"."<table>"; resolve each target to its owning module; assert the depending module's
// `requires` (ALL_MODULES) names it. See §4 of the spec for the exact algorithm.
```
Implement:
- `discoverDrizzlePackages()` — read `packages/*/drizzle`, returning `{ moduleName, sqlFiles }`, where `moduleName` is derived from each package's descriptor `migrations.from` (`../<pkg>/drizzle` → the descriptor whose `from` matches). Only packages that a descriptor points at are in scope.
- `ownerOfTable` — scan all SQL for `create table "<name>"` (case-insensitive), map `<name>` → owning module.
- `edgesFor(moduleName, sql)` — regex-match `references\s+"?(?:public"?\.)?"?(\w+)"?` and `create\s+trigger\s+\S+\s+.*?\bon\s+"?(?:public"?\.)?"?(\w+)"?` (comment-stripped), map each target table to its owner, drop same-module targets, return the set of cross-module dependency module names.
- The tree-wide assertion: for every discovered module, every cross-module dependency must appear in that descriptor's `requires.core`/`requires.modules`; collect violations as `"<module> depends on <dep> via <edge> on <table> — not in requires"`, `expect(violations).toEqual([])`.
- Vacuous-pass anchor: assert the discovered module set includes `core`/`identity`/`payments`/`sync`/`workforce` and has length ≥ 8, AND that the scan actually FOUND the known edges `sync→identity`, `sync→payments`, `workforce→identity` (so a scan matching nothing fails).
- Detector block: inline SQL fixtures — a cross-package `REFERENCES` is flagged; a cross-package `CREATE TRIGGER … ON` is flagged; a same-package reference is ignored; a reference inside a `--` comment or a string literal is ignored.

- [ ] **Step 3: Run to verify it fails, then passes.** First stub the implementation to return a deliberate false violation and confirm the tree-wide test FAILS; then implement correctly and confirm PASS. Run: `pnpm vitest run scripts/module-graph-honesty.test.ts`.

- [ ] **Step 4: Prove by deletion.** Temporarily remove `identity` from `sync`'s `requires.modules` in `apps/server/src/modules.ts` → run the guard → it must report the missing `sync→identity` trigger edge → restore → green. (This is the exact class SP-1c's review caught by hand.)

- [ ] **Step 5: Commit.**
```bash
git add scripts/module-graph-honesty.test.ts
git commit -s -m "test(module): graph-honesty guard — requires must name every FK/trigger edge"
```

---

## Task 8: Real-PG completeness — enrolment set equals the installed capture triggers

**Files:**
- Create/extend: a real-Postgres test in `apps/server` (new `apps/server/src/sync-enrolment-triggers.rls.test.ts`, or extend an existing migrated-DB suite). It needs a fully-migrated database + `ALL_MODULES`.

**Interfaces:**
- Consumes: `ALL_MODULES.flatMap(m => m.sync ?? [])`; a migrated Postgres (via the shared-container harness).

- [ ] **Step 1: Write the failing test.** Against a fully-migrated DB, query the tables carrying a `sync_capture` trigger and assert the set equals the assembled enrolment's table set — the invariant the manual convention (survey §4) left unguarded:
```ts
// pg_trigger joined to pg_class/pg_proc: tables with an AFTER trigger executing sync_capture().
const rows = await db.execute<{ table_name: string }>(sql`
  select distinct c.relname as table_name
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
  where p.proname = 'sync_capture' and not t.tgisinternal`);
const triggered = new Set(rows.rows.map((r) => r.table_name));
const enrolled = new Set(ALL_MODULES.flatMap((m) => m.sync ?? []).map((e) => e.table));
expect(enrolled).toEqual(triggered);
```
Follow the house harness (`useRealPostgres`/`describeEachTarget` where appropriate, but this needs the full migration + triggers, so a migrated real-PG container — mirror `capture.gate.test.ts`'s setup; TESTCONTAINERS_RYUK_DISABLED=true locally, CLAUDE.md §4).

- [ ] **Step 2: Run to verify it passes** (behaviour-preserving: the assembled set is the same 22 tables, and the triggers are unchanged). Run the suite; if it fails, the enrolment/trigger sets genuinely disagree — investigate before adjusting the test.

- [ ] **Step 3: Prove by deletion.** Temporarily drop one table from `CORE_ENROLMENT` → this test fails (an installed trigger with no enrolment) → restore.

- [ ] **Step 4: Commit.**
```bash
git add apps/server/src/sync-enrolment-triggers.rls.test.ts
git commit -s -m "test(sync): pin assembled enrolment == installed sync_capture triggers (real-PG)"
```

---

## Task 9: Docs — backlog, CLAUDE.md, receipts

**Files:**
- Modify: `docs/backlog.md` (SP-2 row), `CLAUDE.md` (§3 graph lesson)

- [ ] **Step 1: Update the backlog SP-2 row.** In `docs/backlog.md`, split SP-2 into 2a/2b: record SP-2a as in-flight/landed on `feat/module-sp2a-sync-inversion` (enrolment inversion + package-owned enrolment for core/identity/payments + graph-honesty guard + the new `@waitron/sync-enrolment` leaf); note SP-2b (schema-version handshake + park gate) as next. **Refresh the flow-down receipt** (owner decision 2026-09-05): flow-down defers again — SP-2a introduces no genuinely-toggleable module, and no config channel exists (spec §7) — built with the first genuinely-toggleable module, not SP-2. Remove the stale "SP-2 now picks up SP-1d's deferred ongoing flow-down" phrasing.

- [ ] **Step 2: Update CLAUDE.md §3.** The FK/`CREATE TRIGGER … ON` graph lesson (CLAUDE.md:421-431) now has an automated guard — add a dated pointer that `scripts/module-graph-honesty.test.ts` enforces it (the §3 table is no longer the only receipt). Keep the lesson (the guard reads text and has stated limits); do not delete it.

- [ ] **Step 3: Confirm the tree-wide guards.** Run green: `pnpm vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/module-graph-honesty.test.ts scripts/changed-scope.test.ts scripts/ci-workflow.test.mjs`, and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.

- [ ] **Step 4: Commit.**
```bash
git add docs/backlog.md CLAUDE.md
git commit -s -m "docs(backlog): SP-2a sync inversion in flight; flow-down defers again (receipt refreshed)"
```

---

## Final verification (before finish-branch)

- [ ] `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` — green.
- [ ] Per-package coverage for every package touched: `pnpm --filter @waitron/sync-enrolment --filter @waitron/db --filter @waitron/identity --filter @waitron/payments --filter @waitron/module --filter @waitron/sync --filter @waitron/server test:coverage`.
- [ ] Root guards: `pnpm vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/module-graph-honesty.test.ts` — green.
- [ ] `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — the tenant-scoped table set did not move.
- [ ] `pnpm reap` (Ryuk disabled locally leaks containers on interruption — CLAUDE.md §4).
- [ ] Grep proof of inversion: `grep -rn "@waitron/payments\|@waitron/identity\|src/schema" packages/sync/src` returns nothing; `grep -rn "ENROLLED\|SYNC_SCHEMA_TABLES" packages/sync` returns nothing.

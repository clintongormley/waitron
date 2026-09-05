# SP-3a — Fiscal-record sync lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrol the six fiscal tables into the app-level sync outbox on the ordered lane, so a subscriber becomes a verbatim copy of the immutable, hash-chained fiscal ledger — with fiscal owning its own capture DDL and interfacing with sync only through the `sync_capture()` SPI.

**Architecture:** A package-owned `FISCAL_ENROLMENT` (`@waitron/fiscal-verifactu`) declares the six tables' replication metadata; a new fiscal migration installs their capture triggers calling sync's `sync_capture()` SPI (a `fiscal → sync` module edge, forcing a manifest reorder so fiscal migrates last); the composition root wires the enrolment into the fiscal descriptor; the graph-honesty guard is extended to see the SPI edge; and a real-Postgres, proven-by-deletion gate suite in `apps/server` (english-only-exempt, existing mirror/sync harness) proves verbatim apply, immutability-on-mirror, upsert non-regression, FK-defer, reserved-SIF coexistence, the env handshake, and the SP-2b module-version park.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle ORM + drizzle-kit (custom migrations), PostgreSQL 18, Vitest 3, Testcontainers (real Postgres), pnpm workspace.

**Spec:** [docs/superpowers/specs/2026-09-05-module-sp3a-fiscal-record-lane-design.md](../specs/2026-09-05-module-sp3a-fiscal-record-lane-design.md)

## Global Constraints

- **No fiscal write-path change.** Do not touch `packages/fiscal-verifactu`'s `chain.ts`/`drain.ts`/`reconcile.ts`/`registro-row.ts`. SP-3a adds an enrolment declaration, a capture migration, a descriptor field, a guard extension, and gates.
- **Verbatim, never recompute.** Nothing on the apply path calls `computeHuella`; `huella`, the four `anterior_*` pointers, and `entorno` copy as opaque bytes.
- **No new grants.** All six tables already hold the app-role DML each mode needs (`registros_facturacion`: SELECT,INSERT only — `0001_registros_inmutables.sql`; the five mutable tables: SELECT,INSERT,UPDATE, plus DELETE on `acks` — `0001`/`0003_envio_flujo_rls.sql`/`0006_acks_rls.sql`/`0008_acks_delete_grant.sql`). `app_user` already holds INSERT on `sync_log` (`packages/sync/drizzle/0000_sync_outbox.sql`).
- **Spanish names only in exempt locations.** `FISCAL_ENROLMENT` lives in `packages/fiscal-verifactu` (exempt), gate tests in `apps/server` (`apps/*` out of english-only scope). Never put fiscal table names in a `packages/sync/src/*.ts` file.
- **Every commit is signed:** `git commit -s`.
- **The gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. For any package you touch, run `pnpm --filter <pkg> test:coverage` (CI shards run coverage, not plain test). Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally; run `pnpm reap` if a run is interrupted.
- **Coverage thresholds:** 98/98/98/95 for `packages/fiscal-verifactu`, `packages/sync`, `apps/server`.
- **Proven-by-deletion.** Every guard/gate: remove the check → watch the test go red → restore. Measure where a working and a broken implementation visibly disagree.

---

### Task 1: Fiscal enrolment declaration (`FISCAL_ENROLMENT`)

Declares the six tables' replication metadata as package-owned data. No wiring into the composition root yet (that is Task 3), so `ALL_SYNC_ENROLMENTS` is unchanged and no pin moves.

**Files:**
- Modify: `packages/fiscal-verifactu/package.json` (add `@waitron/sync-enrolment` dependency)
- Create: `packages/fiscal-verifactu/src/enrolment.ts`
- Modify: `packages/fiscal-verifactu/src/index.ts` (re-export)
- Test: `packages/fiscal-verifactu/src/enrolment.test.ts`

**Interfaces:**
- Consumes: `enrol`, `EnrolledTable` from `@waitron/sync-enrolment`; the six Drizzle tables from `./schema/index.js`.
- Produces: `export const FISCAL_ENROLMENT: readonly EnrolledTable[]` (six entries), re-exported from the package barrel — consumed by Task 3's `apps/server/src/modules.ts`.

- [ ] **Step 1: Add the dependency.** In `packages/fiscal-verifactu/package.json`, under `dependencies`, add `"@waitron/sync-enrolment": "workspace:*"` (keep the list alphabetically ordered as the file already is). Then run `pnpm install` from the repo root and commit the lockfile change with this task.

- [ ] **Step 2: Write the failing test.** Create `packages/fiscal-verifactu/src/enrolment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FISCAL_ENROLMENT } from "./enrolment.js";

describe("FISCAL_ENROLMENT", () => {
  const byTable = new Map(FISCAL_ENROLMENT.map((e) => [e.table, e]));

  it("enrols exactly the six fiscal tables on the ordered lane", () => {
    expect([...byTable.keys()].sort()).toEqual(
      ["acks", "cadenas", "envio_flujo", "envios", "registro_sif", "registros_facturacion"].sort(),
    );
    for (const e of FISCAL_ENROLMENT) expect(e.lane).toBe("ordered");
  });

  it("makes the immutable ledger insert-only and captures verbatim columns", () => {
    const r = byTable.get("registros_facturacion")!;
    expect(r.mode).toBe("insert-only");
    expect(r.conflictKey).toEqual(["id"]);
    expect(r.watermarkColumn).toBeNull();
    expect(r.captureOps).toEqual(["insert"]);
    // columns are DERIVED from the Drizzle table by enrol() — assert the verbatim-critical ones ride.
    for (const col of ["huella", "anterior_huella", "entorno", "sistema_informatico"]) {
      expect(r.columns).toContain(col);
    }
  });

  it("keys the chain head on (tenant_id, node_id) with the actualizado_en watermark", () => {
    const c = byTable.get("cadenas")!;
    expect(c.mode).toBe("watermark-upsert");
    expect(c.conflictKey).toEqual(["tenant_id", "node_id"]);
    expect(c.watermarkColumn).toBe("actualizado_en");
  });

  it("makes acks the one fiscal table that deletes", () => {
    expect(byTable.get("acks")!.captureOps).toEqual(["insert", "update", "delete"]);
    // the other four mutable tables update but never delete
    for (const t of ["registro_sif", "envios", "envio_flujo"]) {
      expect(byTable.get(t)!.captureOps).toEqual(["insert", "update"]);
    }
  });
});
```

- [ ] **Step 3: Run it, watch it fail.** `pnpm --filter @waitron/fiscal-verifactu test enrolment` → FAIL (`Cannot find module './enrolment.js'`).

- [ ] **Step 4: Write the enrolment.** Create `packages/fiscal-verifactu/src/enrolment.ts`:

```ts
import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import {
  acks,
  cadenas,
  envioFlujo,
  envios,
  registroSif,
  registrosFacturacion,
} from "./schema/index.js";

/**
 * The fiscal module's sync enrolment (SP-3a = H2's fiscal-record lane). All six tables ride the
 * ORDERED lane — the fiscal chain is indifferent to replication lag, and envios/acks carry no
 * monotonic column so they are fast-lane-ineligible regardless. Metadata verbatim from the H2 §3
 * table; columns are DERIVED by enrol() off the owning Drizzle schema so they cannot drift. No new
 * grant: app_user already holds precisely the DML each mode needs (see the plan's Global Constraints).
 */
export const FISCAL_ENROLMENT: readonly EnrolledTable[] = [
  // The immutable ledger. INSERT-ONLY, grant-enforced: app_user holds only SELECT,INSERT
  // (0001_registros_inmutables.sql), so ON CONFLICT (id) DO NOTHING never issues the UPDATE the
  // append-only BEFORE UPDATE OR DELETE trigger (WT001) would reject. Replicated verbatim — huella,
  // the four anterior_* pointers and entorno copy as opaque bytes; nothing recomputes a hash.
  enrol(registrosFacturacion, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 5,
    lane: "ordered",
  }),
  // The SIF identity. Append-mostly: a re-registered node gets a NEW row; the old one is revoked
  // in-place (revocado_en set), which is the UPDATE. No monotonic column — ordered by the seq cursor.
  enrol(registroSif, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 4,
    lane: "ordered",
  }),
  // The mutable chain head, one row per (tenant, node). actualizado_en is a monotonic watermark. On
  // a mirror the apply stream is the only writer of a foreign chain's head, so it is single-writer
  // there and lockChainHead's FOR UPDATE (an origin-side concern) does not apply.
  enrol(cadenas, {
    mode: "watermark-upsert",
    conflictKey: ["tenant_id", "node_id"],
    watermarkColumn: "actualizado_en",
    captureOps: ["insert", "update"],
    fkRank: 6,
    lane: "ordered",
  }),
  // The submission sidecar (1:1 with a registro; estado mutates). Ordered by the seq cursor.
  enrol(envios, {
    mode: "watermark-upsert",
    conflictKey: ["registro_id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 6,
    lane: "ordered",
  }),
  // Per-tenant flow-control state (PK tenant_id). Ordered by the seq cursor. NOT config-class — it
  // is per-tenant runtime state written on the serving primary, not venue configuration.
  enrol(envioFlujo, {
    mode: "watermark-upsert",
    conflictKey: ["tenant_id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 2,
    lane: "ordered",
  }),
  // The ack outbox — the ONE fiscal table that DELETES (a delivered ack in a terminal state is
  // pruned), so it captures delete too. app_user holds DELETE (0008_acks_delete_grant.sql).
  enrol(acks, {
    mode: "watermark-upsert",
    conflictKey: ["registro_id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 6,
    lane: "ordered",
  }),
];
```

- [ ] **Step 5: Re-export from the barrel.** In `packages/fiscal-verifactu/src/index.ts`, add near the other re-exports:

```ts
export { FISCAL_ENROLMENT } from "./enrolment.js";
```

- [ ] **Step 6: Run it, watch it pass.** `pnpm --filter @waitron/fiscal-verifactu test enrolment` → PASS.

- [ ] **Step 7: Package gate.** `pnpm --filter @waitron/fiscal-verifactu test:coverage` → green (unfiltered, so the package's cross-cutting suites also run).

- [ ] **Step 8: Commit.**

```bash
git add packages/fiscal-verifactu/package.json packages/fiscal-verifactu/src/enrolment.ts \
  packages/fiscal-verifactu/src/enrolment.test.ts packages/fiscal-verifactu/src/index.ts pnpm-lock.yaml
git commit -s -m "feat(fiscal): declare FISCAL_ENROLMENT (SP-3a sync lane, six tables)"
```

---

### Task 2: `fiscal → sync` requires edge + manifest/module reorder

Adding the edge makes the Kahn topo-sort place fiscal after sync, so `ALL_MODULES` and `migrations.manifest.json` must be reordered to end `…sync, fiscal` or SP-1a's order pins go red. This is safe: fiscal's existing `0000`–`0013` FK only core tables, and nothing requires fiscal to migrate early. The `sync:` enrolment field and the capture migration land in Task 3.

**Files:**
- Modify: `apps/server/src/modules.ts` (fiscal descriptor: add `modules: { sync: "*" }`; move the descriptor to the end, after `sync`)
- Modify: `packages/migrations/migrations.manifest.json` (move the `fiscal` entry to the end)
- Modify: `apps/server/src/modules.test.ts` (only if a hardcoded order list exists — see Step 4)
- Possibly modify: `packages/migrations/src/manifest.test.ts`, `packages/migrations/src/schema-version.test.ts` (only if they hardcode the sequence)

**Interfaces:**
- Consumes: nothing new.
- Produces: the fiscal descriptor now declares `requires: { core: "*", modules: { sync: "*" } }` and sits last in `ALL_MODULES`; the manifest ends `…, sync, fiscal`. Task 3 adds `sync:` to this descriptor; Task 4's guard asserts the `sync` edge.

- [ ] **Step 1: Establish the current order.** Run `node -e "import('./apps/server/src/modules.js').then(m=>console.log(m.ALL_MODULES.map(x=>x.name)))"` is not available pre-build; instead read `apps/server/src/modules.ts` and `packages/migrations/migrations.manifest.json`. Current order (both): `core, identity, workforce, workforce-es, fiscal, payments, scheduler, credentials, sync`. Target order (both): `core, identity, workforce, workforce-es, payments, scheduler, credentials, sync, fiscal`.

- [ ] **Step 2: Reorder + add the edge.** In `apps/server/src/modules.ts`, cut the whole `{ name: "fiscal", … }` descriptor object out of its current position and paste it as the **last** element of `ALL_MODULES` (after the `sync` descriptor). Change its `requires` from `requires: { core: "*" },` to:

```ts
    requires: { core: "*", modules: { sync: "*" } },
```

Do **not** add a `sync:` field yet. In `packages/migrations/migrations.manifest.json`, move the `{ "name": "fiscal", "table": "__drizzle_migrations_fiscal", "from": "../fiscal-verifactu/drizzle" }` element to the end of the array (after `sync`). Keep JSON formatting identical to its neighbours.

- [ ] **Step 3: Run the order pins, watch them stay green.** `pnpm --filter @waitron/server test modules` — the two computed assertions `orderedMigrationSets(ALL_MODULES).toEqual(manifestSets())` and `ALL_MODULES.map(m=>m.name).toEqual(manifestSets().map(s=>s.name))` must PASS because both lists were reordered identically. If either fails, the two orders diverge — fix the file whose order does not match the target above.

- [ ] **Step 4: Find and fix any hardcoded order list.** Run:

```bash
grep -rn '"fiscal"\|fiscal,' packages/migrations/src/*.test.ts apps/server/src/modules.test.ts
```

If `packages/migrations/src/manifest.test.ts` (or `schema-version.test.ts`) hardcodes the module-name sequence, update it to the target order. If it derives the sequence, no edit. Do **not** touch `modules.test.ts:39`'s `MODULE_BY_TABLE.size` assertion yet — the count is still 22 until Task 3 wires `sync:`.

- [ ] **Step 5: Prove migrations still apply in the new order (real-PG).** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot` — the full-manifest boot template migrates `…sync, fiscal` and must succeed (fiscal's tables FK only core; sync is now before fiscal). Also run `pnpm --filter @waitron/migrations test:coverage` and `pnpm --filter @waitron/provisioning test:coverage` (provisioning's migrate path runs `manifestSets()` linearly — fiscal last must still apply).

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/modules.ts packages/migrations/migrations.manifest.json apps/server/src/modules.test.ts packages/migrations/src/*.test.ts
git commit -s -m "feat(module): fiscal requires sync; reorder manifest so fiscal migrates last (SP-3a)"
```

---

### Task 3: Capture-trigger migration + wire enrolment (both sides move together)

The dynamic pin `sync-enrolment-triggers.rls.test.ts` asserts `enrolled == triggered`. Wiring `sync: FISCAL_ENROLMENT` (enrolled → 28) without the capture migration (triggered still 22) makes it red; adding the migration (triggered → 28) makes it green. That is this task's TDD driver.

**Files:**
- Create: `packages/fiscal-verifactu/drizzle/0014_fiscal_sync_capture.sql` (+ the auto-appended `meta/_journal.json` entry)
- Modify: `apps/server/src/modules.ts` (add `sync: FISCAL_ENROLMENT` to the fiscal descriptor; import it)
- Modify: `apps/server/src/modules.test.ts` (`MODULE_BY_TABLE.size` 22 → 28 and its comment)
- Modify: `apps/server/src/sync-enrolment-parity.test.ts` (extend the frozen `SPEC`, counts 22→28 / 20→26, `PARENT_CHILD` fkRank list)

**Interfaces:**
- Consumes: `FISCAL_ENROLMENT` from `@waitron/fiscal-verifactu` (Task 1); `sync_capture()` from sync's `0000` (present because Task 2 ordered fiscal after sync).
- Produces: six installed `sync_capture` triggers on the fiscal tables; `ALL_SYNC_ENROLMENTS`/`MODULE_BY_TABLE` now include the six fiscal tables (28 total).

- [ ] **Step 1: Wire the enrolment (this makes the trigger pin fail).** In `apps/server/src/modules.ts`, add the import beside the other enrolment imports:

```ts
import { FISCAL_ENROLMENT } from "@waitron/fiscal-verifactu";
```

and add `sync: FISCAL_ENROLMENT,` to the fiscal descriptor (now the last element, from Task 2), mirroring `sync: PAYMENTS_ENROLMENT` on the payments descriptor.

- [ ] **Step 2: Run the trigger-parity pin, watch it fail.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-enrolment-triggers` → FAIL: `enrolled` (28) `!= triggered` (22) — the six fiscal tables are enrolled but carry no `sync_capture` trigger yet. This is the failing test that drives the migration.

- [ ] **Step 3: Scaffold the migration.** `pnpm --filter @waitron/fiscal-verifactu db:generate:custom` — this creates an empty `packages/fiscal-verifactu/drizzle/0014_<name>.sql` and appends `{ "idx": 14, "version": "7", "when": <now>, "tag": "0014_<name>", "breakpoints": true }` to `meta/_journal.json`. Rename the file to `0014_fiscal_sync_capture.sql` and update the journal `tag` to match (`0014_fiscal_sync_capture`).

- [ ] **Step 4: Write the capture triggers.** Fill `packages/fiscal-verifactu/drizzle/0014_fiscal_sync_capture.sql` (mirrors `packages/sync/drizzle/0007_sync_identity_capture.sql`, but ON fiscal's own tables):

```sql
-- Fiscal-record sync lane capture triggers (SP-3a). Hand-filled custom migration for
-- @waitron/fiscal-verifactu. Installs the six sync_capture() triggers on fiscal's OWN tables,
-- enrolling the immutable ledger + chain identity + submission state onto the ordered outbox.
--
-- WHY HERE, NOT IN packages/sync (owner principle, 2026-09-05): the fiscal module is independent
-- and interfaces via API. sync_capture() (packages/sync/drizzle/0000_sync_outbox.sql) is sync's SPI;
-- fiscal owns its capture triggers and calls it. This creates a fiscal -> sync module edge (fiscal's
-- descriptor declares requires.modules.sync), so this migration runs AFTER sync's 0000 defines
-- sync_capture() — guaranteed by the manifest order (fiscal migrates last) and the topo resolver.
--
-- NO GRANT / RLS CHANGE. All six tables already carry FORCE RLS + a tenant-isolation policy + the
-- app_user grants each mode needs (0001/0003/0006/0008), and app_user already holds INSERT on
-- sync_log (0000_sync_outbox.sql). sync_capture() is NOT SECURITY DEFINER — it runs as the writing
-- app role, so the sync_log WITH CHECK (tenant_id = current_tenant_id()) is satisfied by
-- construction, and the REVOKE ALL on registros_facturacion does not block capture (the writer
-- already holds INSERT on the table; capture needs only INSERT on sync_log).
--
-- The WHEN clause reads app.sync_apply so a replicated (apply-path) write is NOT re-captured (no
-- A->B->A echo). IS DISTINCT FROM so an unset GUC still fires the capture.

-- registros_facturacion — INSERT-ONLY immutable ledger: AFTER INSERT only.
CREATE TRIGGER registros_facturacion_capture AFTER INSERT ON registros_facturacion
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- registro_sif — append-mostly identity, revocation-in-place: AFTER INSERT OR UPDATE.
CREATE TRIGGER registro_sif_capture AFTER INSERT OR UPDATE ON registro_sif
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- cadenas — mutable chain head: AFTER INSERT OR UPDATE.
CREATE TRIGGER cadenas_capture AFTER INSERT OR UPDATE ON cadenas
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- envios — mutable submission sidecar: AFTER INSERT OR UPDATE.
CREATE TRIGGER envios_capture AFTER INSERT OR UPDATE ON envios
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- envio_flujo — per-tenant flow control: AFTER INSERT OR UPDATE.
CREATE TRIGGER envio_flujo_capture AFTER INSERT OR UPDATE ON envio_flujo
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- acks — the one fiscal table that DELETES (a delivered ack is pruned): AFTER INSERT OR UPDATE OR
-- DELETE, so a prune propagates.
CREATE TRIGGER acks_capture AFTER INSERT OR UPDATE OR DELETE ON acks
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
```

- [ ] **Step 5: Run the trigger-parity pin, watch it pass.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-enrolment-triggers` → PASS (28 enrolled == 28 triggered; the manifest template rebuilds with `0014`).

- [ ] **Step 6: Update the frozen parity SPEC.** In `apps/server/src/sync-enrolment-parity.test.ts`: bump `toHaveLength(22)`/`byName.size).toBe(22)` → `28`; the ordered-lane count `toHaveLength(20)` → `26`; keep the fast-lane assertion exactly `{payments, payment_refunds}` (fiscal adds nothing to fast); add the six fiscal tables to the `SPEC` object (mode/conflictKey/watermarkColumn/captureOps/fkRank/lane from `FISCAL_ENROLMENT`); and add the six to the `PARENT_CHILD` fkRank topo list (registro_sif=4 < registros_facturacion=5 < cadenas/envios/acks=6; envio_flujo=2). Run `pnpm --filter @waitron/server test sync-enrolment-parity` → PASS.

- [ ] **Step 7: Update the MODULE_BY_TABLE size pin.** In `apps/server/src/modules.test.ts`, change the `expect(MODULE_BY_TABLE.size).toBe(22)` assertion (and its `// 22, no duplicate table` comment) to `28`. Run `pnpm --filter @waitron/server test modules` → PASS.

- [ ] **Step 8: Package gates.** `pnpm --filter @waitron/fiscal-verifactu test:coverage` (confirms `inmutabilidad` still green — the six tables keep FORCE RLS; enrolment/capture does not change RLS) and `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` for the touched suites.

- [ ] **Step 9: Commit.**

```bash
git add packages/fiscal-verifactu/drizzle/0014_fiscal_sync_capture.sql \
  packages/fiscal-verifactu/drizzle/meta/_journal.json apps/server/src/modules.ts \
  apps/server/src/modules.test.ts apps/server/src/sync-enrolment-parity.test.ts
git commit -s -m "feat(fiscal): install sync_capture triggers + wire FISCAL_ENROLMENT (SP-3a)"
```

---

### Task 4: Graph-honesty guard — detect the `sync_capture` SPI edge

The existing guard matches `CREATE TRIGGER … ON <table>` and resolves the ON-table's owner. Fiscal's triggers are ON fiscal's own tables, so the guard sees only an intra-module edge and is blind to the `EXECUTE FUNCTION sync_capture()` → `sync` dependency. Extend it to detect that SPI edge, with the owner auto-resolved (scoped to the `sync_capture` SPI specifically, so no unrelated edges surface).

**Files:**
- Modify: `scripts/module-graph-honesty.test.ts`

**Interfaces:**
- Consumes: `ALL_MODULES` (fiscal declares `requires.modules.sync`, Task 2); fiscal's `0014` (`EXECUTE FUNCTION sync_capture()`, Task 3); sync's `0000` (`CREATE FUNCTION sync_capture`).
- Produces: a `fiscal→sync` edge in `foundEdges`, asserted-and-anchored.

- [ ] **Step 1: Add the detector unit tests (positive + controls).** In the `describe("the detector itself", …)` block, add:

```ts
it("flags a cross-module sync_capture SPI call", () => {
  const funcOwner = new Map([["sync_capture", "sync"]]);
  const sql = `create trigger foo_capture after insert on foo\n  for each row execute function sync_capture();`;
  expect([...spiEdgesFor(sql, "fiscal", funcOwner)]).toEqual(["sync"]);
});

it("ignores a same-module sync_capture call", () => {
  const funcOwner = new Map([["sync_capture", "sync"]]);
  const sql = `create trigger p_capture after insert on p for each row execute function sync_capture();`;
  expect([...spiEdgesFor(sql, "sync", funcOwner)]).toEqual([]); // sync calling its own SPI
});

it("ignores a sync_capture mention inside a comment", () => {
  const funcOwner = new Map([["sync_capture", "sync"]]);
  const sql = `-- execute function sync_capture() — describing the old shape\ncreate table foo (id uuid);`;
  expect([...spiEdgesFor(sql, "fiscal", funcOwner)]).toEqual([]);
});
```

- [ ] **Step 2: Run them, watch them fail.** `pnpm vitest run scripts/module-graph-honesty.test.ts` → FAIL (`spiEdgesFor is not defined`).

- [ ] **Step 3: Implement the SPI detector.** In `scripts/module-graph-honesty.test.ts` add, near the other regexes:

```ts
/** `CREATE [OR REPLACE] FUNCTION ["public".]"<name>"` — to resolve which module DEFINES a function. */
const CREATE_FUNCTION = /\bcreate\s+(?:or\s+replace\s+)?function\s+"?(?:public"?\.)?"?(\w+)"?/gi;
/** `EXECUTE (FUNCTION|PROCEDURE) sync_capture` — a trigger calling sync's capture SPI. Scoped to
 * sync_capture deliberately: a general cross-module function-call scan would surface unrelated edges
 * (RLS helper calls, shared trigger functions) beyond SP-3a's scope. Limitation stated, not papered
 * over (CLAUDE.md §1) — extend to other SPIs when one appears. */
const EXECUTE_SYNC_CAPTURE =
  /\bexecute\s+(?:function|procedure)\s+"?(?:public"?\.)?"?(sync_capture)"?/gi;
```

Add a function-owner scanner (mirrors `ownerOfTable`):

```ts
/** Which module DEFINES sync_capture (and any other function), from CREATE FUNCTION across the tree. */
function ownerOfFunction(discovered: DrizzlePackage[]): Map<string, string> {
  const owner = new Map<string, string>();
  for (const { moduleName, sqls } of discovered) {
    for (const raw of sqls) {
      for (const match of stripSql(raw).matchAll(CREATE_FUNCTION)) {
        const fn = match[1]?.toLowerCase();
        if (fn !== undefined && !owner.has(fn)) owner.set(fn, moduleName);
      }
    }
  }
  return owner;
}

/** Cross-module edges a file creates by CALLING the sync_capture SPI a different module owns. */
function spiEdgesFor(rawSql: string, moduleName: string, funcOwner: Map<string, string>): Set<string> {
  const sql = stripSql(rawSql);
  const deps = new Set<string>();
  for (const match of sql.matchAll(EXECUTE_SYNC_CAPTURE)) {
    const fn = match[1]?.toLowerCase();
    if (fn === undefined) continue;
    const dep = funcOwner.get(fn);
    if (dep !== undefined && dep !== moduleName) deps.add(dep);
  }
  return deps;
}
```

Then fold SPI edges into the tree-honesty suite: build `const funcOwner = ownerOfFunction(discovered);` beside `owner`, and in both the `foundEdges` accumulation and the violations loop, union `spiEdgesFor(raw, pkg.moduleName, funcOwner)` into the per-file dep set (record them with a readable `kind`, e.g. `"sync_capture SPI"`, in the violation message).

- [ ] **Step 4: Add the vacuous-pass anchor.** In the `"discovers the modules and finds the known real cross-module edges"` test, add:

```ts
expect(foundEdges.has("fiscal→sync")).toBe(true);
```

- [ ] **Step 5: Run the guard, watch it pass.** `pnpm vitest run scripts/module-graph-honesty.test.ts` → PASS (detector unit tests + `fiscal→sync` anchor + honest-graph, because Task 2 declared `requires.modules.sync`).

- [ ] **Step 6: Prove by deletion.** Temporarily remove `modules: { sync: "*" }` from the fiscal descriptor in `apps/server/src/modules.ts`; re-run → the honest-graph test FAILS with `fiscal depends on sync via sync_capture SPI on sync_capture — not in requires`. Restore the edge → PASS. (Do not commit the deletion.)

- [ ] **Step 7: Commit.**

```bash
git add scripts/module-graph-honesty.test.ts
git commit -s -m "test(guard): graph-honesty detects the sync_capture SPI edge (fiscal→sync, SP-3a)"
```

---

### Task 5: Capture gate — the six fiscal triggers (real-PG, proven-by-deletion)

Proves byte-identical capture on the fiscal tables and the echo guard, including the two fiscal-specific facts: capture works on `registros_facturacion` despite its `REVOKE ALL` (app_user holds INSERT on the table and on `sync_log`), and `acks` capture includes DELETE.

**Files:**
- Create: `apps/server/src/fiscal-capture.rls.test.ts`

**Interfaces:**
- Consumes: `useTemplateDb({ template: "manifest" })`; `app_login`/`app_pw` writer role; the fiscal Drizzle tables + a registro-seeding helper (Task 6 extracts `seedFiscalRegistro`; for this task, seed via raw SQL as `pg-restore.test.ts:139-192` does).
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test.** Create `apps/server/src/fiscal-capture.rls.test.ts`. Core shape (mirrors `packages/sync/src/capture.gate.test.ts`, but on fiscal tables, in this exempt app):

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

const postgres = useTemplateDb({ template: "manifest" });

// helper: run as the app writer with tenant + node GUCs set (mirrors capture.gate withTenantNode)
async function asWriter(tenantId: string, nodeId: string, fn: (db: /* Database */ any) => Promise<void>) {
  const w = await postgres.pg.connectAs("app_login", "app_pw");
  try {
    await w.execute(sql`select set_config('app.tenant_id', ${tenantId}, false),
                               set_config('app.node_id', ${nodeId}, false)`);
    await fn(w);
  } finally {
    await w.close?.();
  }
}

describe("fiscal capture", () => {
  it("captures a registros_facturacion insert verbatim despite REVOKE ALL", async () => {
    // seed tenant/location/till/node/series/sale/registro_sif, then INSERT a registro as app_login,
    // then read sync_log via jsonb_populate_record and assert the huella round-trips byte-identical
    // and op = 'insert', origin_id = app.node_id.
    // ... (seed + insert) ...
    const captured = await postgres.admin.execute<{ n: string; op: string; huella: string }>(sql`
      select (select count(*)::text from sync_log where table_name = 'registros_facturacion') as n,
             s.op, s.row_image->>'huella' as huella
      from sync_log s where s.table_name = 'registros_facturacion'`);
    expect(captured.rows[0]!.n).toBe("1");
    expect(captured.rows[0]!.op).toBe("insert");
    expect(captured.rows[0]!.huella).toBe("F".repeat(64));
  });

  it("captures an acks delete (the one fiscal table that deletes)", async () => {
    // insert then delete an acks row as app_login; assert a sync_log op='delete' for table_name='acks'.
  });

  it("echo guard: an apply-path write (app.sync_apply='on') is not re-captured", async () => {
    // with set_config('app.sync_apply','on',...) set, insert a registro; assert NO new sync_log row.
  });
});
```

Flesh out the seed (reuse the `seedFiscalRegistro` raw-insert chain from `apps/server/src/pg-restore.test.ts:139-192`; **verify the current migrated column set includes `entorno`** and set it). Fill the acks + echo-guard bodies.

- [ ] **Step 2: Run it, watch it pass** (the triggers exist from Task 3): `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test fiscal-capture` → PASS.

- [ ] **Step 3: Prove by deletion.** Temporarily drop the `registros_facturacion_capture` trigger at the top of the first test (`drop trigger registros_facturacion_capture on registros_facturacion`) → the capture assertion FAILS (`n` = "0"). Remove the drop → PASS. For the echo guard, recreate the trigger WITHOUT the `WHEN` clause and confirm the apply-path write IS captured (the guard's negative control), then restore. Document both controls in comments.

- [ ] **Step 4: Commit.**

```bash
git add apps/server/src/fiscal-capture.rls.test.ts
git commit -s -m "test(fiscal): capture gate for the six sync triggers (SP-3a)"
```

---

### Task 6: Apply gate — verbatim registro + immutability-on-mirror + idempotent

**Files:**
- Create: `apps/server/src/fiscal-apply.rls.test.ts`
- Create: `apps/server/src/testing/fiscal-fixtures.ts` (a shared `seedFiscalRegistro` helper used by Tasks 6–9)

**Interfaces:**
- Consumes: `syncPullOnce`, `enrolPeer`, `type HttpClient` from `@waitron/sync`; `mountSyncApi`; `ALL_SYNC_ENROLMENTS`, `MODULE_BY_TABLE` from `./modules.js`; two `useTemplateDb({ template: "manifest" })` clones (source/target) and `target.pg.connectAs("sync_applier", "ap")` — the `sync-e2e.rls.test.ts` deps shape.
- Produces: `seedFiscalRegistro(db, {...}) → { tenantId, nodeId, registroId, huella }` for later tasks.

- [ ] **Step 1: Extract the fixture.** Create `apps/server/src/testing/fiscal-fixtures.ts` exporting `seedFiscalRegistro(db, opts)` that inserts the FK chain (`tenants → locations → tills → nodes → invoice_series → sales → registro_sif → registros_facturacion`) and returns the ids + `huella` (base it on `pg-restore.test.ts:139-192`; set `entorno` and a realistic `huella`). Add a variant that also seeds `cadenas`/`envios`/`acks` for later tasks.

- [ ] **Step 2: Write the failing test.** Create `apps/server/src/fiscal-apply.rls.test.ts` using the `sync-e2e.rls.test.ts` two-clone + `syncPullOnce` pattern:

```ts
const deps = {
  localDb: targetApplier, subscriberId: SUB, tenantId: TENANT,
  localEnvironment: "production", http: sourceHttp("production"), batchLimit: 500,
  enrolments: ALL_SYNC_ENROLMENTS, moduleVersions: {}, moduleByTable: new Map<string, string>(),
};
```

Test A (verbatim): seed a registro on `source`, `await syncPullOnce(deps, peer)`, then read the row on `target.admin` and assert `huella`, all four `anterior_*`, and `entorno` are byte-identical to the source row (compare full `select *`). Test B (idempotent): a second `syncPullOnce` (re-delivering the same seq) leaves exactly one row — `ON CONFLICT (id) DO NOTHING`. Test C (immutability on mirror): a direct `update registros_facturacion set huella=… ` on `target` as `sync_applier` throws `WT001`, and a `truncate` throws the block trigger — while the apply path (Test A) is unobstructed.

- [ ] **Step 3: Run, watch pass.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test fiscal-apply` → PASS.

- [ ] **Step 4: Prove by deletion.** For Test C, temporarily comment the direct-UPDATE `expect(...).rejects`; confirm the UPDATE would otherwise be attempted (the assertion is what fails when the guard is absent). For Test A, mutate the source row's `entorno` after capture and before apply in a scratch run to confirm the assertion distinguishes a verbatim copy from a changed one (measurement where both answers differ — CLAUDE.md §1). Restore.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/fiscal-apply.rls.test.ts apps/server/src/testing/fiscal-fixtures.ts
git commit -s -m "test(fiscal): verbatim apply + immutability-on-mirror + idempotent gate (SP-3a)"
```

---

### Task 7: Apply gate — mutable-table upsert non-regression

**Files:**
- Create: `apps/server/src/fiscal-upsert.rls.test.ts`

**Interfaces:**
- Consumes: the Task 6 fixtures; the `syncPullOnce` deps shape.

- [ ] **Step 1: Write the failing tests.** For each mutable table, drive two deliveries where the images visibly differ, and assert the newer state wins and a late older image never regresses:
  - `registro_sif`: deliver an active row, then a revoked one (`revocado_en` set) → mirror shows revoked; re-deliver the older active image → still revoked (seq-cursor guard).
  - `cadenas`: deliver head at `secuencia=1, actualizado_en=t1`, then `secuencia=2, t2>t1` → mirror at 2; re-deliver t1 image → still 2 (`actualizado_en` watermark).
  - `envios`: deliver `estado='pendiente'`, then `'aceptado'` → mirror aceptado; re-deliver pendiente → still aceptado (seq-cursor).
  - `envio_flujo`: deliver two `proximo_envio_en` values → newer wins.
  - `acks`: deliver insert, then update `state`, then delete → mirror row gone (the delete applies).

- [ ] **Step 2: Run, watch pass.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test fiscal-upsert` → PASS. This step also confirms the apply path accepts `mode: "watermark-upsert"` with `watermarkColumn: null` (seq-cursor) and emits an unconditional `DO UPDATE SET` for `registro_sif`/`envios`/`envio_flujo`/`acks`.

- [ ] **Step 3: Prove by deletion.** For one seq-cursor table, force the deliveries out of seq order in a scratch run and confirm the assertion would catch a regression; restore in-order. Commit.

```bash
git add apps/server/src/fiscal-upsert.rls.test.ts
git commit -s -m "test(fiscal): mutable-table upsert non-regression gate (SP-3a)"
```

---

### Task 8: Apply gate — FK-defer (`23503`) + reserved-SIF coexistence

**Files:**
- Create: `apps/server/src/fiscal-fk-defer.rls.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - FK-defer: deliver a `registros_facturacion` row whose `sale_id` has not yet arrived on the mirror → it parks on `23503` (deferred, not rejected), and lands on the next `syncPullOnce` once `sales` arrives. Same for a `cadenas` head whose `ultimo_registro_id` registro has not arrived. Assert the row is `deferred` first, `applied` second — never by widening a grant or dropping a constraint.
  - Reserved-SIF coexistence: pre-seed the target (mirror) with an R2-style reserved `registro_sif` + empty `cadenas` head keyed to the mirror's OWN nodeId; then apply the primary's `registro_sif`/`cadenas`/`registros` keyed to the primary's nodeId → no unique-constraint conflict (`registro_sif_activo_uq`, `registro_sif_instalacion_uq`, `cadenas` PK are all node-keyed), and both identities remain resolvable.

- [ ] **Step 2: Run, watch pass.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test fiscal-fk-defer` → PASS.

- [ ] **Step 3: Prove by deletion + commit.** Confirm the FK-defer test distinguishes deferred-then-applied from immediate-reject (measure the two-delivery difference). Commit.

```bash
git add apps/server/src/fiscal-fk-defer.rls.test.ts
git commit -s -m "test(fiscal): FK-order 23503-defer + reserved-SIF coexistence gate (SP-3a)"
```

---

### Task 9: Apply gate — environment handshake + module-version park

**Files:**
- Create: `apps/server/src/fiscal-park-env.rls.test.ts`

**Interfaces:**
- Consumes: `syncPullOnce` with **populated** `moduleByTable: MODULE_BY_TABLE` and `moduleVersions` (unlike sync-e2e's empty maps); `mountSyncApi(..., { moduleVersions })` on the source.

- [ ] **Step 1: Write the failing tests.**
  - Env handshake (both directions): target stamped `preproduction`, source advertising `production` → `syncPullOnce` throws `sync.peer_environment_mismatch` and no fiscal row applies; control flips `localEnvironment` and the registro lands (the `sync-e2e.rls.test.ts:217-250` pattern, with a fiscal row).
  - Module-version park: mount the source sync-api with `moduleVersions: { fiscal: <N+1> }` and drive `syncPullOnce` with the subscriber's `subscriberModuleVersions: { fiscal: <N> }` and `moduleByTable: MODULE_BY_TABLE` → the fiscal registro **parks** (`versionParked` > 0; row absent on target, cursor held below the parked seq). Then set the subscriber's fiscal version equal to the source's → the row applies. Assert equal versions never park.

- [ ] **Step 2: Run, watch pass.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test fiscal-park-env` → PASS.

- [ ] **Step 3: Prove by deletion + commit.** For the park test, set the versions equal in a scratch run and confirm the row applies (the control that shows the park is version-driven, not incidental). Commit.

```bash
git add apps/server/src/fiscal-park-env.rls.test.ts
git commit -s -m "test(fiscal): env-handshake + module-version park gate (SP-3a)"
```

---

### Task 10: Gate — a mirror does not submit

No existing test asserts a mirror issues no AEAT submission (only that its empty pass ran). Add an explicit tripwire.

**Files:**
- Modify: `apps/server/src/boot.mirror.rls.test.ts` (add a no-submission tripwire test)

- [ ] **Step 1: Write the failing test.** Boot a node as a mirror (non-`primary` `singleton_role`) holding replicated `pendiente` `envios`, with a `VerifactuBackend` whose `resolveClient: () => Promise.reject(new Error("mirror must not contact AEAT"))` — the same tripwire pattern the fiscal suites use. Advance a pass and assert `resolveClient`/`drain` is never invoked (no rejection surfaces; the mirror's pass is the trivial empty one). Contrast with the existing `lastPassAt` liveness assertion.

- [ ] **Step 2: Run, watch pass** (the drain is gated on `singleton_role='primary'`, `boot.ts` `singletonPass`): `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.mirror` → PASS.

- [ ] **Step 3: Prove by deletion.** Temporarily flip the node to `primary` (or bypass the `singletonPass` gate) in a scratch run → the tripwire rejects (drain would run). Restore. Commit.

```bash
git add apps/server/src/boot.mirror.rls.test.ts
git commit -s -m "test(fiscal): a mirror issues no AEAT submission (SP-3a gate)"
```

---

### Task 11: Full-suite verification + backlog reference

**Files:**
- Modify: `docs/backlog.md` (add the SP-3a spec/plan reference under the module-system section; mark it in flight)

- [ ] **Step 1: inmutabilidad + fiscal package.** `pnpm --filter @waitron/fiscal-verifactu test:coverage` — confirms the six tables keep FORCE RLS after enrolment (the `inmutabilidad` scan discovers them by `tenant_id`).

- [ ] **Step 2: Root guards.** `pnpm vitest run scripts/module-graph-honesty.test.ts scripts/english-only.test.ts` → green (no Spanish leaked into a generic package; the fiscal→sync edge is honest).

- [ ] **Step 3: Server + sync + migrations + provisioning.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`, `pnpm --filter @waitron/sync test:coverage`, `pnpm --filter @waitron/migrations test:coverage`, `pnpm --filter @waitron/provisioning test:coverage`.

- [ ] **Step 4: The whole gate.** From the repo root: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.

- [ ] **Step 5: Backlog reference.** In `docs/backlog.md`, under the module-system section's SP-3 line, add a sub-line pointing at this spec/plan and noting SP-3a is in flight on `feat/module-sp3a-fiscal-record-lane` (the LANDED marking happens at land, per `/land-branch`). Commit.

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): SP-3a fiscal-record lane in flight (spec+plan)"
```

---

## Self-Review

**Spec coverage:** §2 enrolment → Task 1; §5 capture-in-fiscal + `fiscal→sync` edge + guard extension → Tasks 3, 4; §2 manifest/order consequence → Task 2; §4 apply mechanics (verbatim, immutability, RLS) → Tasks 5, 6; §2 upsert modes / watermark-null → Task 7; §9 gates 1–2 → Task 6, gate 3 → Task 7, gate 4 → Task 8, gate 5 → Task 8, gate 6 → Task 10, gate 7 → Task 9, gate 8 → Task 5, gate 9 (`inmutabilidad`) → Tasks 3/11, gate 10 (park) → Task 9, gate 11 (guard) → Task 4; §7 SP-2b park → Task 9. All covered.

**Placeholder scan:** the gate tasks (5–10) give concrete harness patterns, the exact deps shape, and the assertions, but abbreviate some test bodies with `// …` where the seed/setup is mechanical — the implementer fills them from the cited reference files (`sync-e2e.rls.test.ts`, `capture.gate.test.ts`, `pg-restore.test.ts:139-192`). These are labelled, not silent. Tasks 1–4 are fully concrete.

**Type consistency:** `FISCAL_ENROLMENT: readonly EnrolledTable[]` (Task 1) is the exact type `apps/server/src/modules.ts` expects for a `sync:` field (Task 3). `spiEdgesFor`/`ownerOfFunction` (Task 4) mirror the existing `edgesFor`/`ownerOfTable` signatures. The `syncPullOnce` deps shape (Tasks 6–9) matches `sync-e2e.rls.test.ts` verbatim, adding populated `moduleByTable`/`moduleVersions` only where the park gate needs them.

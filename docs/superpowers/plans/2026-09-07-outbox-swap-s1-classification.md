# Outbox → native replication, S1: classification contract, guards, two-node fixture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a table-classification contract (`classify(table, "ledger"|"state"|"local", reason)`) that covers every database table, wire it through every module, derive the two publication table-lists from it, add two always-run root guards that keep it honest, and add a two-Postgres-node test fixture — all additive, with the outbox still running unchanged.

**Architecture:** Classification is a new, parallel module seat (`classification`) beside the existing `sync` (enrol) seat; `enrol()` and the outbox are untouched and keep running. Each owning package exports a `<MODULE>_CLASSIFICATION` array (string table name → class + reason); composition names them all; `apps/server` assembles them and derives the ledger/state publication lists (declared, not yet consumed — S2 creates the publications). Two root guards read the whole tree: every `CREATE TABLE` is classified exactly once, and every `reject_mutation` trigger is `ENABLE ALWAYS`. A new `@waitron/db/testing/two-node` helper stands up two `postgres:18-alpine` containers on one Docker network with `wal_level=logical`, migrated, with a smoke test proving a raw publication/subscription copies a row across the network.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle, PostgreSQL 18 (`postgres:18-alpine`), Testcontainers (`@testcontainers/postgresql`, `Network`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md` (slice **S1**, §2.1 classification, §2.2 publications, §3 the `ENABLE ALWAYS` guard, §11 the two-node fixture) and `docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md` (§3 **step 2** = swap S1). Prototype the fixture reproduces: `docs/superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md`.

## Global Constraints

- **Branch:** `feat/outbox-swap-s1-classification` in a worktree created with `python3 ~/workspace/tools/worktree.py new waitron feat/outbox-swap-s1-classification` (never a plain `git worktree add` — `/land-branch` cannot tear that down). Every commit `git commit -s`.
- **Additive only.** `enrol()`, `EnrolledTable`, `tablesForLane`, `SYNC_LANES`, `<MODULE>_ENROLMENT`, the capture triggers, `packages/sync` apply/pull/source/disposal, `apps/server`'s `ALL_SYNC_ENROLMENTS`/`MODULE_BY_TABLE` — all stay exactly as they are. The outbox must keep compiling and passing. No behaviour change: nothing new is consumed at runtime by the sale/sync path.
- **Classification covers EVERY table.** All 82 tables in `packages/*/drizzle/*.sql` are classified exactly once (guard-enforced). `__drizzle_migrations_*` bookkeeping tables are created by drizzle at runtime, not by a `CREATE TABLE` in the `.sql` files, so they are out of scope automatically — verify the scan never sees them.
- **The classification is by OWNING module** (the package whose `drizzle/` holds the `CREATE TABLE`), from spec §2.1, transcribed VERBATIM below with two reconciliations against today's schema:
  1. `layout_profiles` (spec §2.1 core `state`) no longer exists — it was renamed to `canvases` (SP-B3-2a). Classify **`canvases` as `state`**; do not emit `layout_profiles`.
  2. The four `sync_*` outbox tables (`sync_log`, `sync_cursor`, `sync_peers`, `sync_config_conflicts`) are classed **`local`** with the reason that they are the outbox mechanism, not copied by native replication, and are deleted in swap step 4. (Spec §2.1 says "nothing to classify" for the sync module, but they still exist in S1 and the completeness guard must account for them.)
- **`classify()` takes a STRING table name**, not a Drizzle `Table` object: some tables (`deployment`, `mirror_config`, `node_membership`) live only in hand-written custom SQL and have no Drizzle table object, and the completeness guard (not the type) is the safety net against typos. Reason strings are required and non-empty.
- **Root guards live in `scripts/`** (CLAUDE.md §4 — a guard that reads the whole tree belongs in the root Vitest project so it runs on every non-docs push). They read SQL text, never execute it; each has a vacuous-pass anchor and is proven by deletion.
- **Error codes are never renamed** (CLAUDE.md §3). This slice adds no error codes.
- **Gate before PR:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`; then the changed-package coverage (`pnpm --filter <pkg> test:coverage`) for every package touched. Real-PG suites need `TESTCONTAINERS_RYUK_DISABLED=true`; check memory headroom before the two-node suite (CLAUDE.md §2/§4). `packages/sync` and `packages/db` hold the high coverage bar (98/98/98/95).

---

## The classification, verbatim (the data every task below transcribes)

Per owning module. `L`=ledger, `S`=state, `l`=local. Reasons are one short clause each (write real reasons, not the letter).

**core — `packages/db` (51):**
- ledger (12): `sales`, `sale_lines`, `tenders`, `sale_settlements`, `sale_voids`, `sale_substitutions`, `ticket_items`, `drawer_opens`, `daily_closes`, `daily_close_chain`, `purchase_invoices`, `purchase_invoice_vat`
- state (34): `working_order_counters`, `tenants`, `locations`, `nodes`, `tills`, `devices`, `device_profiles`, `invoice_series`, `catalogues`, `location_catalogues`, `categories`, `products`, `option_groups`, `option_group_items`, `product_option_groups`, `ingredients`, `recipe_lines`, `floor_zones`, `dining_tables`, `table_service_statuses`, `kitchen_stations`, `kitchen_courses`, `station_printers`, `printers`, `print_agents`, `canvases`, `tenant_themes`, `tenant_receipts`, `bookings`, `incidents`, `working_orders`, `working_order_lines`, `order_amendments`, `print_jobs`
- local (5): `deployment`, `mirror_config`, `node_membership`, `device_pairing_codes`, `print_agent_pairing_codes`

**identity — `packages/identity` (5):** state: `persons`, `webauthn_credentials`. local: `sessions`, `management_sessions`, `webauthn_challenges`.

**workforce — `packages/workforce` (9):** ledger: `time_entries`, `workforce_chains`. state: `employments`, `shifts`, `shift_templates`, `shift_swaps`, `absences`, `availability`, `roster_versions`.

**workforce-es — `packages/workforce-es` (1):** state: `convenio_config`.

**payments — `packages/payments` (3):** ledger: `payments`, `payment_refunds`. state: `payment_policy`.

**scheduler — `packages/scheduler` (1):** local: `scheduled_runs`.

**credentials — `packages/credentials` (1):** state: `tenant_credentials`.

**fiscal-verifactu — `packages/fiscal-verifactu` (7):** ledger: `registros_facturacion`, `cadenas`, `registro_sif`, `envios`, `envio_flujo`, `acks`. state: `contadores_instalacion`.

**sync — `packages/sync` (4):** local: `sync_log`, `sync_cursor`, `sync_peers`, `sync_config_conflicts` (reason: outbox mechanism, not native-replicated, deleted in swap step 4).

Total 82. Reason clauses (suggested, tighten as you write): ledger = "what happened, keyed by the writing node; drained back from a returned box"; state = "manager configuration / live service; copied to a standby, never drained back"; local = "this node's own record; not copied". Fiscal-specific reasons should note the per-node keying (server-as-SIF) where relevant.

---

## Task 1: The classification contract in `@waitron/sync-enrolment` + the module seat

**Files:**
- Create: `packages/sync-enrolment/src/classification.ts`
- Create: `packages/sync-enrolment/src/classification.test.ts`
- Modify: `packages/sync-enrolment/src/index.ts` (export the new symbols)
- Modify: `packages/module/src/module.ts` (add the `classification` seat)

**Interfaces:**
- Produces:
  - `type TableClass = "ledger" | "state" | "local"`
  - `interface ClassifiedTable { table: string; class: TableClass; reason: string }`
  - `function classify(table: string, cls: TableClass, reason: string): ClassifiedTable`
  - `function tablesForPublication(classifications: readonly ClassifiedTable[], cls: "ledger" | "state"): string[]`
  - `WaitronModule.classification?: readonly ClassifiedTable[]`

- [ ] **Step 1: Write the failing test** — `packages/sync-enrolment/src/classification.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { classify, tablesForPublication, type ClassifiedTable } from "./classification.js";

describe("classify", () => {
  it("records the table name, class and reason", () => {
    expect(classify("sales", "ledger", "what happened")).toEqual({
      table: "sales",
      class: "ledger",
      reason: "what happened",
    });
  });
});

describe("tablesForPublication", () => {
  const set: ClassifiedTable[] = [
    classify("sales", "ledger", "r"),
    classify("payments", "ledger", "r"),
    classify("tenants", "state", "r"),
    classify("deployment", "local", "r"),
  ];
  it("returns only the ledger tables for the ledger publication", () => {
    expect(tablesForPublication(set, "ledger").sort()).toEqual(["payments", "sales"]);
  });
  it("returns only the state tables for the state publication", () => {
    expect(tablesForPublication(set, "state")).toEqual(["tenants"]);
  });
  it("excludes local tables from both publications", () => {
    expect(tablesForPublication(set, "ledger")).not.toContain("deployment");
    expect(tablesForPublication(set, "state")).not.toContain("deployment");
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `pnpm --filter @waitron/sync-enrolment test` → FAIL (module not found).

- [ ] **Step 3: Implement** — `packages/sync-enrolment/src/classification.ts`

```ts
/**
 * A table's replication CLASS (swap spec §2.1). Every database table is exactly one of these:
 * `ledger` — what happened (sales, payments, fiscal records, closes, clock-ins): copied to a
 * standby AND drained back from a returned box. `state` — what a manager configures plus live
 * service in flight: copied to a standby, never drained back. `local` — this node's own record of
 * what it is: not copied, not drained.
 */
export type TableClass = "ledger" | "state" | "local";

/** One table's classification: the physical table name, its class, and the stated reason (§1's
 * "no unstated claims" rule — a bare class is not auditable). Declared by the OWNING module,
 * assembled by the composition root, consumed by `@waitron/sync`'s publication derivation. */
export interface ClassifiedTable {
  table: string;
  class: TableClass;
  reason: string;
}

/** Declare one table's class. Takes the physical name as a string (not a Drizzle table): some
 * tables live only in hand-written SQL and have no schema object, and the root completeness guard —
 * not the type — is what stops a typo. */
export function classify(table: string, cls: TableClass, reason: string): ClassifiedTable {
  return { table, class: cls, reason };
}

/** The physical table names on one publication. `ledger`/`state` map to the two publications a node
 * holds (`waitron_<env>_ledger` / `…_state`, spec §2.1); `local` tables are in neither. */
export function tablesForPublication(
  classifications: readonly ClassifiedTable[],
  cls: "ledger" | "state",
): string[] {
  return classifications.filter((c) => c.class === cls).map((c) => c.table);
}
```

- [ ] **Step 4: Export from the barrel** — add to `packages/sync-enrolment/src/index.ts` (keep the existing exports; add `classify`, `tablesForPublication` values and `ClassifiedTable`, `TableClass` types).

- [ ] **Step 5: Add the module seat** — in `packages/module/src/module.ts`, import `ClassifiedTable` alongside the existing `EnrolledTable` import, and add to `WaitronModule` (below the `sync` seat), keeping `sync` exactly as it is:

```ts
  /** Swap S1: every table this module's migrations create, classified `ledger`/`state`/`local`
   * (swap spec §2.1). The composition root assembles every module's classification; the two
   * publication table-lists derive from it and the root completeness guard checks it covers each
   * module's `CREATE TABLE`s exactly once. Additive to `sync` (the outbox enrolment) — that seat and
   * `enrol()` stay until the outbox is deleted (chain step 4). */
  readonly classification?: readonly ClassifiedTable[];
```

- [ ] **Step 6: Run tests** — `pnpm --filter @waitron/sync-enrolment test` and `pnpm --filter @waitron/module test` → PASS. `pnpm --filter @waitron/sync-enrolment typecheck && pnpm --filter @waitron/module typecheck`.

- [ ] **Step 7: Commit** — `git add -A && git commit -s -m "feat(sync): classification contract + module seat (swap S1)"`

---

## Task 2: core classification (`@waitron/db`)

**Files:**
- Create: `packages/db/src/classification.ts`
- Create: `packages/db/src/classification.test.ts`
- Modify: `packages/db/src/index.ts` (export `CORE_CLASSIFICATION`)

**Interfaces:**
- Consumes: `classify`, `ClassifiedTable` from `@waitron/sync-enrolment` (Task 1).
- Produces: `CORE_CLASSIFICATION: readonly ClassifiedTable[]` (51 tables — the core list above).

- [ ] **Step 1: Write the failing test** — `packages/db/src/classification.test.ts`. Prove internal consistency AND that it covers exactly core's own `CREATE TABLE`s by scanning `packages/db/drizzle/*.sql` (the source of truth), so this task is self-verifying without the root guard.

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_CLASSIFICATION } from "./classification.js";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

function tablesInDrizzle(): string[] {
  const names: string[] = [];
  for (const file of readdirSync(DRIZZLE).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(DRIZZLE, file), "utf8");
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z_]+)"?/gi)) {
      names.push(m[1]!);
    }
  }
  return names;
}

describe("CORE_CLASSIFICATION", () => {
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of CORE_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = CORE_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("classifies exactly the tables core's migrations create", () => {
    const classified = new Set(CORE_CLASSIFICATION.map((c) => c.table));
    const created = new Set(tablesInDrizzle());
    expect([...created].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !created.has(t)).sort()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `pnpm --filter @waitron/db test classification` → FAIL (module not found). (Confirm the drizzle scan regex finds the ~51 tables by temporarily logging `tablesInDrizzle().length`; remove the log. Verify it does NOT include any `__drizzle_migrations_*`.)

- [ ] **Step 3: Implement** — `packages/db/src/classification.ts`. Transcribe the core list above. Shape:

```ts
import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";
const LOCAL = "this node's own record of what it is; not copied";

/** Core's 51 tables, classified for native replication (swap spec §2.1). `canvases` is `state` (it
 * succeeded the dropped `layout_profiles`); the append-only ledger tables keep their immutability
 * triggers as `ENABLE ALWAYS` so a corrupted publisher is refused, not copied. */
export const CORE_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("sales", "ledger", LEDGER),
  classify("sale_lines", "ledger", LEDGER),
  // … all 12 ledger, 34 state (incl. canvases), 5 local from the list above …
];
```

- [ ] **Step 4: Export** — add `CORE_CLASSIFICATION` to `packages/db/src/index.ts`.

- [ ] **Step 5: Run tests + typecheck** — `pnpm --filter @waitron/db test classification` → PASS; `pnpm --filter @waitron/db typecheck`.

- [ ] **Step 6: Commit** — `git commit -s -m "feat(db): classify core's tables (swap S1)"`

---

## Task 3: the other eight modules' classifications

**Files (create `classification.ts` + `classification.test.ts`, export from each `src/index.ts`):**
- `packages/identity/src/` → `IDENTITY_CLASSIFICATION`
- `packages/workforce/src/` → `WORKFORCE_CLASSIFICATION`
- `packages/workforce-es/src/` → `WORKFORCE_ES_CLASSIFICATION`
- `packages/payments/src/` → `PAYMENTS_CLASSIFICATION`
- `packages/scheduler/src/` → `SCHEDULER_CLASSIFICATION`
- `packages/credentials/src/` → `CREDENTIALS_CLASSIFICATION`
- `packages/fiscal-verifactu/src/` → `FISCAL_CLASSIFICATION`
- `packages/sync/src/` → `SYNC_CLASSIFICATION` (the four outbox tables, `local`)

**Interfaces:**
- Consumes: `classify`, `ClassifiedTable` from `@waitron/sync-enrolment`.
- Produces: the eight `*_CLASSIFICATION` arrays above.

For EACH package, follow Task 2's pattern exactly:
- [ ] **Step A:** write `classification.test.ts` — same three assertions (valid class + non-empty reason; no dup; classified set == the package's `CREATE TABLE` set from its own `drizzle/*.sql`). Reuse the `tablesInDrizzle()` helper shape from Task 2 (each package's test has its own copy pointed at its own `../drizzle`).
- [ ] **Step B:** run it, watch it fail.
- [ ] **Step C:** write `classification.ts` transcribing that module's list above; export from `src/index.ts`.
- [ ] **Step D:** `pnpm --filter <pkg> test classification` → PASS; `pnpm --filter <pkg> typecheck`.
- [ ] **Step E:** one commit per package (or one commit for the eight — reviewer's choice), `git commit -s`.

Notes:
- The per-package `tablesInDrizzle()` uses a naive regex WITHOUT comment-stripping. That is acceptable because the root guard (Task 5) uses `stripSql` and is the AUTHORITATIVE completeness check; the per-package test is a convenience checkpoint. (Verified: no `CREATE TABLE` appears inside any SQL comment today.)
- `SYNC_CLASSIFICATION`'s four entries use a `local` reason naming the outbox and step 4. `@waitron/sync` already imports from `@waitron/sync-enrolment`, so no new dependency.
- `packages/fiscal-verifactu` already imports `classify`? No — it imports `enrol`. Add the `@waitron/sync-enrolment` import (already a dependency). `contadores_instalacion` is `state` (shared per-NIF counter, not per node); the six chain tables are `ledger`.
- `packages/workforce`, `packages/scheduler`, `packages/credentials`, `packages/workforce-es` do not currently depend on `@waitron/sync-enrolment` — add it to each `package.json` `dependencies` (`workspace:*`) and run `pnpm install`.

---

## Task 4: wire the seats into composition + assemble + derive publication lists

**Files:**
- Modify: `packages/composition/src/modules.ts` (add `classification:` to all nine table-owning module entries; add imports)
- Modify: `packages/composition/package.json` (add the new workspace deps it now imports from: `@waitron/workforce`, `@waitron/scheduler`, `@waitron/credentials`, `@waitron/sync` if not already deps — check first)
- Modify: `apps/server/src/modules.ts` (assemble `ALL_CLASSIFICATIONS`, derive `LEDGER_PUBLICATION_TABLES` / `STATE_PUBLICATION_TABLES`)
- Create/Modify: `apps/server/src/modules.test.ts` (or the existing composition test) to assert the derived lists
- Check: `packages/composition/src/composition.test.ts` still green

**Interfaces:**
- Consumes: the nine `*_CLASSIFICATION` exports (Tasks 2–3), `tablesForPublication` (Task 1).
- Produces (in `apps/server/src/modules.ts`):
  - `ALL_CLASSIFICATIONS: readonly ClassifiedTable[]`
  - `LEDGER_PUBLICATION_TABLES: readonly string[]`
  - `STATE_PUBLICATION_TABLES: readonly string[]`

- [ ] **Step 1: Failing test** — in `apps/server/src/modules.test.ts`, assert:
  - `ALL_CLASSIFICATIONS` names every table exactly once and has 82 entries (or, to avoid a stale count, assert the union of ledger+state+local sizes equals `ALL_CLASSIFICATIONS.length` and there are no duplicates);
  - `LEDGER_PUBLICATION_TABLES` contains `sales` and `registros_facturacion` and NOT `tenants`/`deployment`/`sync_log`;
  - `STATE_PUBLICATION_TABLES` contains `tenants`, `canvases`, `contadores_instalacion` and NOT `sales`/`deployment`;
  - no `local` table (`deployment`, `sync_log`, `scheduled_runs`, `sessions`) appears in either list.

```ts
import { describe, expect, it } from "vitest";
import { ALL_CLASSIFICATIONS, LEDGER_PUBLICATION_TABLES, STATE_PUBLICATION_TABLES } from "./modules.js";

describe("classification assembly", () => {
  it("classifies each table exactly once", () => {
    const names = ALL_CLASSIFICATIONS.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("puts ledger tables only in the ledger publication", () => {
    expect(LEDGER_PUBLICATION_TABLES).toContain("sales");
    expect(LEDGER_PUBLICATION_TABLES).toContain("registros_facturacion");
    expect(LEDGER_PUBLICATION_TABLES).not.toContain("tenants");
    expect(LEDGER_PUBLICATION_TABLES).not.toContain("sync_log");
  });
  it("puts state tables only in the state publication", () => {
    expect(STATE_PUBLICATION_TABLES).toContain("tenants");
    expect(STATE_PUBLICATION_TABLES).toContain("canvases");
    expect(STATE_PUBLICATION_TABLES).toContain("contadores_instalacion");
    expect(STATE_PUBLICATION_TABLES).not.toContain("sales");
  });
  it("keeps local tables out of both publications", () => {
    for (const local of ["deployment", "sync_log", "scheduled_runs", "sessions"]) {
      expect(LEDGER_PUBLICATION_TABLES).not.toContain(local);
      expect(STATE_PUBLICATION_TABLES).not.toContain(local);
    }
  });
});
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Wire composition** — in `packages/composition/src/modules.ts`, import each `*_CLASSIFICATION` and add `classification: <X>_CLASSIFICATION` to the matching module object (core, identity, workforce, workforce-es, payments, scheduler, credentials, fiscal-verifactu, sync). `fiscal-none` owns no tables → no seat. Add any missing workspace deps to `packages/composition/package.json` and `pnpm install`. Update the header comment listing populated seats to mention `classification`.

- [ ] **Step 3b: Re-export through `@waitron/sync` (REQUIRED — reviewer HIGH).** `apps/server` depends on `@waitron/sync`, NOT `@waitron/sync-enrolment` — that is why `apps/server/src/modules.ts:2` imports `EnrolledTable` from `@waitron/sync` (a re-export), not the leaf. Importing the classification symbols from `@waitron/sync-enrolment` in apps/server would be a phantom dependency. So add to `packages/sync/src/index.ts` a re-export of `classify`, `tablesForPublication` (values) and `ClassifiedTable`, `TableClass` (types) — matching how it already re-exports `SYNC_LANES`/`tablesForLane`/`EnrolledTable`.

- [ ] **Step 4: Assemble in `apps/server/src/modules.ts`** — beside `ALL_SYNC_ENROLMENTS`, importing from `@waitron/sync` (the re-export from Step 3b), matching the existing `EnrolledTable` import on line 2:

```ts
import { tablesForPublication, type ClassifiedTable, type EnrolledTable } from "@waitron/sync";
// …
/** Swap S1: every module's table classification, in ALL_MODULES order. DERIVED, not yet consumed at
 * runtime — S2 (provisioning) creates the publications from the two lists below. */
export const ALL_CLASSIFICATIONS: readonly ClassifiedTable[] = ALL_MODULES.flatMap(
  (m) => m.classification ?? [],
);
export const LEDGER_PUBLICATION_TABLES: readonly string[] = tablesForPublication(
  ALL_CLASSIFICATIONS,
  "ledger",
);
export const STATE_PUBLICATION_TABLES: readonly string[] = tablesForPublication(
  ALL_CLASSIFICATIONS,
  "state",
);
```

- [ ] **Step 5: Run** — `pnpm --filter @waitron/server test modules`, `pnpm --filter @waitron/composition test` → PASS; typecheck both.

- [ ] **Step 6: Commit** — `git commit -s -m "feat(composition): assemble classification + derive publication lists (swap S1)"`

---

## Task 5: root guard (a) — every table classified exactly once

**Files:**
- Create: `scripts/classification-complete.test.ts`

Template: `scripts/module-graph-honesty.test.ts` (discovery + `stripSql` + regex + `expect(violations.sort()).toEqual([])` + vacuous-pass anchor).

**Interfaces:**
- Consumes: `ALL_MODULES` from `../packages/composition/src/index.js`; `packageDirOf` from `../packages/module/src/module.js`.

- [ ] **Step 1: Write the guard** (this IS the test — a root guard). It must:
  1. For every module in `ALL_MODULES` with a `migrations.from`, read `packages/<packageDirOf(m)>/drizzle/*.sql`, strip comments/strings (reuse `module-graph-honesty`'s `stripSql`), and collect the `CREATE TABLE` names.
  2. Collect that module's classified table names from `m.classification ?? []`.
  3. Violation if a created table is not classified, or a classified name is not a created table, or a table is classified more than once (within or across modules).
  4. Assert `expect(violations.sort()).toEqual([])`.
  5. **Vacuous-pass anchor:** assert the scan discovered a known real table in each class (`sales`, `tenants`, `deployment`) and a table floor (`expect(allCreatedTables.size).toBeGreaterThanOrEqual(80)`), and that at least 8 modules were scanned — so an empty scan cannot pass green.
  6. Assert `__drizzle_migrations` never appears in the created set (the scan must not pick up bookkeeping). (Confirmed: bookkeeping tables are created by drizzle at runtime, not by a `CREATE TABLE` in the `.sql` files.)
  7. **Copy `module-graph-honesty`'s missing-`.sql` handling** — `packages/fiscal-none/drizzle` exists but holds only `meta/` (no `.sql`), so wrap the `readdirSync` in the same `try/catch` (or existence check) the template uses; a module with 0 tables and 0 classifications is not a violation.

- [ ] **Step 2: Run** — `pnpm --filter waitron-root test classification-complete` (or `pnpm vitest run scripts/classification-complete.test.ts` from root) → PASS.

- [ ] **Step 3: Prove by deletion** — temporarily remove one entry from `CORE_CLASSIFICATION` (e.g. `bookings`) → the guard FAILS naming `bookings` unclassified. Add a bogus `classify("nonexistent_table", …)` → FAILS naming the phantom. Restore both. Record the two failures in the commit message.

- [ ] **Step 4: Commit** — `git commit -s -m "test(root): guard every table is classified exactly once (swap S1)"`

---

## Task 6: root guard (b) — every `reject_mutation` trigger is `ENABLE ALWAYS`

**Files:**
- Create: `scripts/append-only-enable-always.test.ts`

**Interfaces:**
- Consumes: the same `ALL_MODULES` / `packageDirOf` discovery + `stripSql` as Task 5.

- [ ] **Step 1: Write the guard.** Across every module's `drizzle/*.sql`:
  1. Find every `CREATE [CONSTRAINT] TRIGGER <name> … EXECUTE FUNCTION reject_mutation()` and record the trigger `<name>` and its table.
  2. Find every `ALTER TABLE <table> ENABLE ALWAYS TRIGGER <name>` and record the `<name>`.
  3. Violation if a `reject_mutation` trigger's name has no matching `ENABLE ALWAYS`.
  4. `expect(violations.sort()).toEqual([])`.
  5. **Vacuous-pass anchor:** assert it found the known triggers (`registros_facturacion_enforce_immutability`, `sales_enforce_immutability`, `time_entries_enforce_immutability`) and a floor (`>= 20` reject_mutation triggers across the tree — the immutability + truncate pairs on the 10 append-only tables). NB the pairing assertion (every reject_mutation trigger has an ENABLE ALWAYS) is the real check; the `>= 20` floor is exactly today's count, so it only guards against the scan finding nothing.

  **QUOTING — verified against the baselines, this WILL bite (reviewer HIGH):** trigger and table names are inconsistently quoted. `packages/db/drizzle/0001_db_baseline_sql.sql:143` has `CREATE TRIGGER sales_enforce_immutability` (UNQUOTED name) but `:302` has `CREATE TRIGGER "order_amendments_enforce_immutability"` (QUOTED); `packages/fiscal-verifactu/drizzle/0001_fiscal_baseline_sql.sql:84` has `ALTER TABLE registros_facturacion ENABLE ALWAYS TRIGGER registros_facturacion_enforce_immutability;` (both names UNQUOTED) while its `CREATE TRIGGER` (:24) is quoted. So: make quotes OPTIONAL (`"?`) on BOTH the trigger name and the table name in BOTH regexes — copy `module-graph-honesty.test.ts`'s CREATE_TABLE "quoted-or-bare" idiom (its line ~80) — and strip any surrounding quotes before pairing CREATE↔ENABLE ALWAYS by name. Do NOT assume a name suffix: `daily_closes` uses `daily_closes_immutable` / `daily_closes_no_truncate`, not `_enforce_immutability`; extract whatever name appears. A quoted-literal-only regex would silently match nothing on the fiscal file and pass vacuously — the anchor in (5) is what catches that, so keep it.

- [ ] **Step 2: Run** → PASS (all are already `ENABLE ALWAYS` from step 1).

- [ ] **Step 3: Prove by deletion** — temporarily delete one `ALTER TABLE … ENABLE ALWAYS TRIGGER "sales_enforce_immutability"` line from `packages/db/drizzle/0001_db_baseline_sql.sql` → the guard FAILS naming that trigger. Restore it. Record in the commit message. (Do NOT leave the baseline edited.)

- [ ] **Step 4: Commit** — `git commit -s -m "test(root): guard append-only triggers are ENABLE ALWAYS (swap S1)"`

---

## Task 7: the two-node Postgres fixture

**Files:**
- Create: `packages/db/src/testing/two-node.ts`
- Create: `packages/db/src/testing/two-node.test.ts`
- Modify: `packages/db/package.json` (add `"./testing/two-node.js": "./src/testing/two-node.ts"` to the enumerated `exports` map; AND add `"testcontainers": "<version matching @testcontainers/postgresql's peer, e.g. ^12.0.4>"` to `dependencies` — `Network` is exported by the `testcontainers` package, NOT by `@testcontainers/postgresql` (which only exports `PostgreSqlContainer`/`StartedPostgreSqlContainer`). It resolves transitively today but that is a phantom dep — declare it. Run `pnpm install`.)

**Interfaces:**
- Produces:
  - `interface TwoNodeCluster { nodeA: ReplNode; nodeB: ReplNode; stop(): Promise<void> }`
  - `interface ReplNode { uri: string; networkHost: string; run(sql: string): Promise<void>; query<T>(sql: string): Promise<T[]> }` (`uri` reaches the node from the host; `networkHost` is the alias the OTHER node dials over the Docker network, e.g. `host=nodeA port=5432`)
  - `function startTwoNodeCluster(options: { migrate(uri: string): Promise<void>; dockerRequired?: boolean }): Promise<TwoNodeCluster>`

- [ ] **Step 1: Write the smoke test** — `packages/db/src/testing/two-node.test.ts`. Real Docker; gate on docker availability like the existing harness (`dockerRequired`/`describe.runIf`). It must prove the fixture's capabilities the S2 suites depend on:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTwoNodeCluster, type TwoNodeCluster } from "./two-node.js";
import { runMigrations } from "../migrate.js";
import { CORE_MIGRATIONS } from "../index.js"; // or the real ordered sets used by the harness

let cluster: TwoNodeCluster;
beforeAll(async () => {
  cluster = await startTwoNodeCluster({
    migrate: async (uri) => { /* apply every module's migrations, as the harness does */ },
    dockerRequired: true,
  });
}, 180_000);
afterAll(async () => { await cluster?.stop(); });

describe("two-node fixture", () => {
  it("runs postgres with wal_level=logical on both nodes", async () => {
    for (const node of [cluster.nodeA, cluster.nodeB]) {
      const [row] = await node.query<{ wal_level: string }>("SHOW wal_level");
      expect(row!.wal_level).toBe("logical");
    }
  });

  it("copies a row A→B over the network via a raw publication/subscription", async () => {
    // A throwaway table on BOTH nodes (a pure MECHANISM smoke test — avoid coupling to any real
    // schema). Publish on A, subscribe on B over the network alias, assert the row arrives. The
    // subscription connects as the container's DEFAULT superuser, which has REPLICATION — the real
    // waitron_repl/waitron_migrator roles are S2's concern, not built here.
    for (const node of [cluster.nodeA, cluster.nodeB]) {
      await node.run(`CREATE TABLE repl_smoke (id int primary key, v text)`);
    }
    await cluster.nodeA.run(`INSERT INTO repl_smoke (id, v) VALUES (1, 'hello')`);
    await cluster.nodeA.run(`CREATE PUBLICATION smoke_pub FOR TABLE repl_smoke`);
    await cluster.nodeB.run(
      `CREATE SUBSCRIPTION smoke_sub CONNECTION 'host=${cluster.nodeA.networkHost} port=5432 user=<owner> password=<pw> dbname=<db>' PUBLICATION smoke_pub WITH (copy_data = true, origin = none)`,
    );
    await expect
      .poll(async () => (await cluster.nodeB.query<{ c: number }>(`SELECT count(*)::int c FROM repl_smoke`))[0]!.c, {
        timeout: 30_000,
      })
      .toBe(1);
  });
});
```

- [ ] **Step 2: Run it, watch it fail** (fixture not implemented).

- [ ] **Step 3: Implement the fixture** — `packages/db/src/testing/two-node.ts`:
  - Import `Network` from `testcontainers` (NOT `@testcontainers/postgresql`); import `PostgreSqlContainer` from `@testcontainers/postgresql`; import `POSTGRES_IMAGE` from `./postgres.js`.
  - Create a network: `const network = await new Network().start()`.
  - Start two `PostgreSqlContainer(POSTGRES_IMAGE)`, each `.withLabels({ "com.waitron.reapable": "true" })`, `.withNetwork(network)`, `.withNetworkAliases("node-a")` / `"node-b"`, and `.withCommand(["postgres", "-c", "wal_level=logical", "-c", "track_commit_timestamp=on"])`. This is VERIFIED known-good for `@testcontainers/postgresql@12.0.4`: its readiness wait is `Wait.forAll([forHealthCheck (pg_isready), forListeningPorts])`, not log-based, so custom `-c` flags cannot break it; its own internal `withCommand` only fires when SSL is configured (not our case). `PostgreSqlContainer extends GenericContainer`, so all four chained methods are inherited. No `postgresql.conf` fallback is needed.
  - Migrate each node via `options.migrate(uri)`.
  - Expose `run`/`query` (thin `pg` client wrappers), `networkHost` (the alias, `"node-a"`/`"node-b"`), and `stop()` (stop both containers, then `network.stop()`).
  - `dockerRequired` mirrors the existing harness's docker gate; when docker is unavailable and `dockerRequired` is false, the caller skips (match `startMigratedPostgres`'s handling). Guard the genuinely-unreachable docker-absent branch with a `/* v8 ignore next */` comment the way `postgres.ts`/`harness.ts`'s `dockerAvailable` does (coverage note below).
  - Header comment: cite the prototype findings doc, note `wal_level` cannot be set at runtime (hence the command args), and note that an interrupted run (Ryuk off locally) leaks the network — `pnpm reap` handles the labelled containers; the empty network is harmless.

- [ ] **Step 4: Run the smoke test** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test two-node` → PASS. Check memory headroom first (`memory_pressure | grep free`, `ps -axo rss,command | sort -nr | head`) per CLAUDE.md §2/§4; this is a real-PG suite (two containers).

- [ ] **Step 5: Coverage + typecheck** — `pnpm --filter @waitron/db test:coverage`. **`packages/db/vitest.config.ts` DELIBERATELY INCLUDES `src/testing/**` in coverage at the 98/98/98/95 bar** (only `src/testing/global-setup.ts` is excluded) — so `two-node.ts` MUST reach full branch coverage. The smoke test exercises the happy path; guard any branch it cannot reach (the docker-absent early-return) with `/* v8 ignore */`, exactly as `dockerAvailable` already does. Confirm the coverage run stays green with the fixture present before committing. `pnpm --filter @waitron/db typecheck`.

- [ ] **Step 6: Commit** — `git commit -s -m "test(db): two-node logical-replication fixture (swap S1)"`

---

## Task 8: docs — CLAUDE.md, backlog, spec pointers

**Files:**
- Modify: `CLAUDE.md` (§3 classification bullet; §4 if a new harness note is warranted)
- Modify: `docs/backlog.md` (Track A item 3 step 2 status)
- Modify: `docs/superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md` (dated "S1 built" pointer, and reconcile §2.1's `layout_profiles`→`canvases`)
- Modify: `docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md` (dated "step 2 built" pointer)

- [ ] **Step 1: CLAUDE.md §3** — the classification bullet currently says the classification guard "arrives with step 2 of the chain". Update it: the guard now exists — name `scripts/classification-complete.test.ts` (every table classified once) and `scripts/append-only-enable-always.test.ts` (reject_mutation triggers ENABLE ALWAYS), both root guards run on every non-docs push. State the rule: a new table is classified in its module's `<MODULE>_CLASSIFICATION`, and an append-only table's `reject_mutation` triggers are `ENABLE ALWAYS`. Keep it to the rule + one-line pointer (CLAUDE.md §1/§7 — no narrative).
- [ ] **Step 2: backlog** — under Track A item 3, mark step 2 (swap S1) LANDED/in-PR with the guard + fixture + contract summary and the two reconciliations (canvases→state; sync outbox→local). One-line, no receipt paragraph.
- [ ] **Step 3: spec pointers** — add a dated `> **2026-09-07 — built**` note to swap §2.1 reconciling `layout_profiles`→`canvases` and noting the sync outbox `local` classification; add a dated pointer to the chain §3 step 2.
- [ ] **Step 4: Commit** — `git commit -s -m "docs: classification guards + two-node fixture landed (swap S1)"`

---

## Self-review checklist (run before dispatching implementers)

1. **Spec coverage:** S1 = classify() ADDED ALONGSIDE enrol() (Task 1 — enrol/outbox untouched; the spec §14 "replaces" describes the step-4 end state, NOT S1 — do not delete any enrol machinery) ✓; two root guards (Tasks 5, 6) ✓; publication lists derived (Task 4) ✓; two-node fixture (Task 7) ✓; "no behaviour yet" (nothing consumed at runtime — the lists are exported, unused) ✓. §2.1 classification (Tasks 2–4) ✓. §3 ENABLE ALWAYS guard (Task 6) ✓. §11 fixture (Task 7) ✓.
2. **Placeholders:** the per-module lists are transcribed in "The classification, verbatim"; the implementer fills real reason strings. The fixture's exact container-command form is left to iterate against Docker (genuinely environment-dependent) — flagged, not hidden.
3. **Type consistency:** `ClassifiedTable`/`TableClass`/`classify`/`tablesForPublication` names match across Tasks 1, 2, 3, 4; `<MODULE>_CLASSIFICATION` naming matches the `<MODULE>_ENROLMENT` convention; `classification` seat name matches in module.ts, composition, apps/server.

## Open items to surface in the PR (owner reviews at land)
- `canvases` classified `state` (successor to the dropped `layout_profiles`, which the spec §2.1 still named).
- The four `sync_*` outbox tables classified `local` (spec said "nothing to classify"; they still exist in S1 and the completeness guard requires an entry — they go when the outbox does, step 4).

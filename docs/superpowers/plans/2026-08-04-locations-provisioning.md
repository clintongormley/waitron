# Locations (sub-project 6) — provision a sellable venue — Implementation Plan

> **For agentic workers:** Execute this with **superpowers:subagent-driven-development** — one
> subagent per task, TDD throughout (write the failing test, watch it fail, minimal implementation,
> watch it pass), report back, next task. Prefer Opus 5 for code-writing subagents and Opus 4.8 for
> orchestration/design (user memory `model-selection-planning-vs-implementation`). Every commit is
> `git commit -s`. Do **not** batch tasks; each ends green.

**Spec:** `docs/superpowers/specs/2026-08-04-locations-provisioning-design.md` (read it first).
**Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-locations-provisioning`,
branch `feat/locations-provisioning`.

---

## Goal

Take a tenant from "exists" to **sellable**: an operator flow that creates a venue → till → node
(SIF) → registers the SIF internally → creates the `standard` + `rectificative` series, deriving the
location's fiscal regime from its territory. Reshape the tenant/location schema so fiscal identity is
country/territory-driven rather than Spain-hardcoded, and retire the stale `bootstrap-tenant.sql`.
Only Veri\*Factu (common-territory Spain) is wired; every other territory is refused.

Success is concrete: after `waitron-provision venue …` runs against a stamped, migrated database,
`recordSale` can immediately chain a sale on the created node.

## Architecture

Extend **`@waitron/provisioning`**, mirroring its `instance-plan.ts` / `instance-apply.ts` /
`cli.ts` / `bin.ts` shape with a new `venue` subcommand (spec D6). The pieces:

- **`planVenue(request) → VenueAction[]`** — a **pure** function that resolves the territory's fiscal
  modules (throwing `fiscal.regime_not_implemented` for an unimplemented one — the input refusal of
  spec D4), derives the tenant's deterministic UUID, and emits a flat discriminated-union action
  list. No I/O, unit-testable without a container. Mirrors `planInstance`.
- **`applyVenue(actions, deps) → Promise<void>`** — runs the actions as **one transaction** under
  `withTenant(db, tenantId, …)`, on a single connection, mirroring `apps/server/src/provision-till.ts`'s
  `provisionNode` (**not** `applyInstance`, which is cluster DDL and deliberately not one
  transaction). Each entity insert is idempotent via `ON CONFLICT DO NOTHING` on its natural key
  (the transaction-safe realisation of spec D8's "insert, treat conflict as already-present"; a
  raw catch of 23505 would poison the surrounding transaction).
- **`resolveFiscalModules(territory) → { filing, tax }`** — a config registry, `"ES-common"` only,
  living in `@waitron/provisioning` (see the placement decision below). Throws
  `fiscal.regime_not_implemented` (registered in `@waitron/fiscal`, the regime-neutral fiscal package).
- **CLI**: `runCli`'s switch gains `case "venue"`; `bin.ts` needs no new wiring beyond passing
  `applyVenue`. Connection strings come from env / echo-off prompts, never flags (the existing
  `resolveAdminUri` machinery, reused verbatim).

**Who runs it — verified by container test, not asserted (spec D7).** `app_user` already holds
`SELECT, INSERT, UPDATE` on every Veri\*Factu SIF table (`registro_sif`, `contadores_instalacion`,
`cadenas` — `packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql:58-68`) and INSERT on
`locations`/`tills`/`invoice_series` (`0001_tenancy_rls.sql`), and `tenant_provisioner` adds INSERT
on `tenants` (`0011_provisioner_role.sql`). The **one** table no login role can write is `nodes`:
`0017_nodes_rls.sql:33` grants it `SELECT` only, owner-provisioned by design. So the whole flow can
run as one role **iff** that role can INSERT a node. Task C1 is a real-Postgres test that decides
between "the owner-admin inserts the node under the tenant GUC" and "add a narrow node-INSERT grant".
The expected outcome (owner-admin, no grant widening — it satisfies FORCE-RLS's `WITH CHECK` by
adopting the tenant scope, exactly as `bootstrap-tenant.sql`'s corrected header proves for
tenants/locations/tills) drives Tasks C2–C3, but **the test writes the answer, not this plan.**

**Placement of the resolver (decision, flagged for review).** The registry maps
`"ES-common" → { filing: "verifactu", tax: "iva" }`. It **cannot** live in `@waitron/fiscal`: that
package is policed by two guards that both fire on those literals —
`packages/fiscal/src/no-regime-vocabulary.test.ts`'s `FORBIDDEN` list rejects `"verifactu"`, and
`packages/db/src/english-only.ts`'s `SPANISH_WORDS` contains `"iva"` (line 142), and only
`english-only.ts` + `no-regime-vocabulary.test.ts` are exempt (`SELF`). It lives in
`@waitron/provisioning`, which is in **neither** `GENERIC_PACKAGES` nor `EXEMPT_PACKAGES` (so the
english-only scan never reaches it) and is not subject to the fiscal package's regime-vocabulary
guard. The **error code** `fiscal.regime_not_implemented` is regime-neutral and goes in
`@waitron/fiscal/src/errors.ts` beside `fiscal.node_not_registered` (spec §4, ground-truth #4). Spec
D4's runtime hard-error is the same resolver throwing, reused by whatever consumes a node's
`filing_module` later; this slice ships the resolver + the venue-input refusal, and unit-tests the
throw (the runtime primitive), flagging the composition-root wiring as a follow-up.

## Tech Stack

pnpm workspace; TypeScript (ESM, `node24`); Drizzle ORM `0.45.2` + drizzle-kit; PostgreSQL 18
(`postgres:18-alpine`) via `@testcontainers/postgresql`; PGlite for hermetic logic tests; Vitest
`3.x` with v8 coverage. `@waitron/shared` `AppError`/branded ids; `@waitron/db` schema + `withTenant`
+ `isUniqueViolation` + testing lifecycle; `@waitron/fiscal-verifactu` `registerSif`;
`@waitron/fiscal` error registry.

## Global Constraints (project-wide, copied verbatim from CLAUDE.md / the spec)

- **Money as a `Decimal` string.** Currency is `numeric(12,2)` in the tenant's single currency;
  never store formatted or English money; use `@waitron/shared`'s `Decimal`. (No money flows through
  this slice, but the constraint stands for any amount touched.)
- **English throughout for generic packages** — identifiers and table/column names alike (spec §2).
  `GENERIC_PACKAGES` = `db, core, fiscal, shared, payments, scheduler, credentials, workforce`; Spanish
  is confined to `verifactu`/`fiscal-verifactu`/`workforce-es` (`EXEMPT_PACKAGES`); `apps/*` and
  `packages/provisioning` are out of the scan's scope. New **schema** tokens that are English
  (`country`, `tax_id`, `fiscal_territory`, `time_zone`, `day_cutover`, `filing_module`,
  `tax_module`) need no `SPANISH_WORDS` entry; the SIF columns stay Spanish (`nif`,
  `numero_instalacion`, `id_sistema_informatico`) inside `fiscal-verifactu`.
- **No manual test teardowns.** Use `usePgliteDb` / `useRealPostgres`
  (`@waitron/db/testing/lifecycle.js`), which own `beforeAll`/`afterAll` and hand back a throwing
  accessor. Where a suite must own a resource, guard the close: `if (db !== undefined) await db.close()`.
  A guard that reads the whole tree belongs in `scripts/`, not a package.
- **Error codes name the DOMAIN CONCEPT, never the throwing package** (`series.not_found`, not
  `db.series_not_found`). Codes are **never renamed once shipped**. Every file that throws a code
  imports its registry (`import "./errors.js"` / the owning package's barrel) directly.
- **Real Postgres (Testcontainers) for anything about privileges, RLS as a non-superuser role, or
  concurrency.** PGlite connects as superuser and bypasses `FORCE ROW LEVEL SECURITY`, so a
  privilege/RLS assertion on PGlite is a false pass. `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **No backwards-compat / data-migration code until production.** Schema changes drop and recreate;
  no backfill. This reshape adds/removes columns with **no** backfill (pre-production).
- **A new `tenant_id`-bearing table needs FORCE RLS + policy + grants** via a custom migration; this
  slice adds **no** new table, only columns to existing tenant-scoped tables, so the existing
  policies cover them and no new grant is required. Still run
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after any tenant-scoped schema change.
- **Never build SQL by string concatenation** except utility statements (`CREATE ROLE`/`GRANT`),
  which take no bind parameters — escape (`quoteIdent`/`quoteLiteral`) or validate-and-throw there.
  Drizzle parameterises `` sql`… ${v}` `` automatically; use it for every value.
- **`git commit -s` on every commit.** Branch is `feat/locations-provisioning`; never commit to `main`.
- **The gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus
  `pnpm --filter <pkg> test:coverage` for any package touched (CI shards run coverage, thresholds
  98/98/98/95 except `packages/ui`). Run `pnpm install` and commit the lockfile if deps change.

---

## File Structure

| File | Create / Modify | Responsibility |
| --- | --- | --- |
| `packages/db/src/schema/tenants.ts` | Modify | Drop `nif`; add `country` + `taxId`; add `country`+address+`timeZone`+`dayCutover`+`fiscalTerritory` to `locations`; unique `(country, tax_id)` replaces `tenants_nif_key`. |
| `packages/db/src/schema/nodes.ts` | Modify | Add nullable `filingModule` / `taxModule`. |
| `packages/db/drizzle/0022_locations_provisioning_reshape.sql` (+ `meta/0022_snapshot.json`, `meta/_journal.json`) | Create (via drizzle-kit) | The generated migration for the three schema changes; no hand-written RLS (no new table). |
| `packages/db/src/testing/seed.ts` | Modify | `seedTenant` inserts `country`+`tax_id`; `freshNif` comment. |
| `packages/payments/test/seed.ts` | Modify | `seedWorkingOrder` tenant insert → `country`+`tax_id`. |
| `packages/fiscal-verifactu/test/fixtures.ts`, `test/drain-fixtures.ts`, `src/testing/seed.ts` | Modify | Tenant inserts → `country`+`tax_id`. |
| `packages/core/test/fixtures.ts` | Modify | Tenant insert → `country`+`tax_id`. |
| `packages/db/src/**` (schema tests, `tenancy.test.ts`, `provisioner-role.rls.test.ts`, `allocate-number.test.ts`), `packages/scheduler/src/migrations.test.ts`, `apps/server/src/provision-till.test.ts` | Modify | Direct `tenants` inserts → `country`+`tax_id`. |
| `apps/server/src/provision-till.ts` | Modify | `obligadoNif` reads `tenants.taxId` (still called "the obligado's NIF"). |
| `packages/fiscal/src/errors.ts` + `errors.reachability.test.ts` | Modify | Register `fiscal.regime_not_implemented`. |
| `packages/provisioning/src/fiscal-modules.ts` | Create | `resolveFiscalModules(territory)` + the `"ES-common"` registry + `WAITRON_ID_SISTEMA`. |
| `packages/provisioning/src/fiscal-modules.test.ts` | Create | Resolver unit tests (resolves común, throws otherwise, prove-by-deletion). |
| `packages/provisioning/src/tenant-id.ts` | Create | Deterministic `obligadoTenantId(country, taxId)` (RFC-4122 v5). |
| `packages/provisioning/src/tenant-id.test.ts` | Create | Determinism + format tests. |
| `packages/provisioning/src/venue-plan.ts` | Create | `planVenue`, `VenueAction`, `VenueRequest`, `describeVenueAction`. |
| `packages/provisioning/src/venue-plan.test.ts` | Create | Pure-plan tests. |
| `packages/provisioning/src/venue-apply.ts` | Create | `applyVenue`, `VenueApplyDeps`. |
| `packages/provisioning/src/venue-apply.node-privilege.rls.test.ts` | Create | **The deciding container test** (owner vs. provisioner node INSERT). |
| `packages/provisioning/src/venue-apply.test.ts` | Create | Apply idempotency + end-to-end (PGlite where sound, container for the privilege path). |
| `packages/provisioning/src/cli.ts` | Modify | `venue` subcommand; `CliDeps.applyVenue`; `USAGE`. |
| `packages/provisioning/src/cli.test.ts` | Modify | `venue` CLI behaviour (prompts, refusal, no-secret-in-args). |
| `packages/provisioning/src/bin.ts` | Modify | Pass `applyVenue` into `runCli`. |
| `packages/provisioning/src/index.ts` | Modify | Export the new public surface. |
| `packages/provisioning/package.json` | Modify | Add `@waitron/fiscal`, `@waitron/fiscal-verifactu` deps. |
| `apps/server/sql/bootstrap-tenant.sql` | **Delete** | Stale (`invoice_series.till_id`); the `venue` command replaces it. |
| `apps/server/README.md` (bootstrap references) | Modify | Point operators at `waitron-provision venue`. |

---

# PHASE A — Schema reshape + fix every consumer (tree stays green)

The reshape is cross-cutting. The **only** column that is *removed* is `tenants.nif`, so every insert
that names it breaks and must be fixed in this phase. New `locations`/`nodes` columns are added with
`DEFAULT`s or `NULL`, so existing location/node inserts stay green untouched — a deliberate choice to
bound the ripple to the tenant inserts that must change anyway (rationale in Task A1, Step 4).

## Task A1: Reshape `tenants` (nif → country + tax_id) and fix all tenant inserts

**Files:** `packages/db/src/schema/tenants.ts`, the migration, and every tenant-insert consumer
listed in Step 4; `apps/server/src/provision-till.ts`.

**Interfaces**
- Consumes: nothing new.
- Produces: `tenants` columns `country text NOT NULL`, `taxId text NOT NULL` (was `nif`); unique
  index `tenants_country_tax_id_key` on `(country, tax_id)` (was `tenants_nif_key`).

- [ ] **Step 1: Write the failing test.** Add to `packages/db/src/schema/nodes.test.ts` (a suite that
  already seeds tenants) a schema-shape assertion. In a new `describe`:
  ```ts
  import { sql } from "drizzle-orm";
  // ...existing imports...

  describe("tenants fiscal identity is country + tax_id", () => {
    it("has country and tax_id, not nif, and a (country, tax_id) unique index", async () => {
      const cols = await db.execute<{ column_name: string }>(sql`
        select column_name from information_schema.columns
        where table_name = 'tenants' order by column_name`);
      const names = cols.rows.map((r) => r.column_name);
      expect(names).toContain("country");
      expect(names).toContain("tax_id");
      expect(names).not.toContain("nif");

      const idx = await db.execute<{ indexname: string }>(sql`
        select indexname from pg_indexes where tablename = 'tenants'`);
      const indexes = idx.rows.map((r) => r.indexname);
      expect(indexes).toContain("tenants_country_tax_id_key");
      expect(indexes).not.toContain("tenants_nif_key");
    });
  });
  ```
- [ ] **Step 2: Run it — watch it fail.** `pnpm --filter @waitron/db test nodes` fails: `nif` still
  present, no `tenants_country_tax_id_key`.
- [ ] **Step 3: Edit the schema.** In `packages/db/src/schema/tenants.ts` replace the `tenants` table
  definition's `nif` line and index, and update the doc comment:
  ```ts
  /**
   * The obligado tributario. Fiscal identity is country + tax_id, regime-agnostic: for a Spanish
   * tenant `tax_id` IS the NIF, and the Veri*Factu backend reads `tax_id` where it once read `nif`
   * (a NIF cannot be asked for before the country is known — spec D2). Unique on (country, tax_id).
   */
  export const tenants = pgTable(
    "tenants",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      country: text("country").notNull(),
      taxId: text("tax_id").notNull(),
      legalName: text("legal_name").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("tenants_country_tax_id_key").on(t.country, t.taxId)],
  ).enableRLS();
  ```
- [ ] **Step 4: Generate the migration and fix every consumer.** Run
  `pnpm --filter @waitron/db exec drizzle-kit generate --name locations_provisioning_reshape`
  (this also carries the Task A2/A3 changes if done together; if run per task, regenerate). Open the
  produced `packages/db/drizzle/0022_*.sql` and confirm it drops `nif` + `tenants_nif_key`, adds
  `country`/`tax_id`, and creates `tenants_country_tax_id_key`. No hand-written RLS is needed —
  no new table (Global Constraints; ground-truth #3).

  Then fix **every** tenant insert. The `nif` column is gone, so each is a compile/runtime break.
  Enumerated (grepped 2026-08-04; the value that was `nif`/`freshNif()` becomes `tax_id`, country is
  `'ES'` for these Spanish fixtures):

  *Seed helpers (internal edit, signatures unchanged so their 100+ callers are untouched):*
  - `packages/db/src/testing/seed.ts:29-33` — `seedTenant`:
    ```ts
    const result = await db.execute<{ id: string }>(sql`
      insert into tenants (country, tax_id, legal_name) values ('ES', ${freshNif()}, 'Test SL') returning id`);
    ```
    and update the `freshNif` doc comment to say "collides on `tenants_country_tax_id_key`".
  - `packages/payments/test/seed.ts:34-36` — `seedWorkingOrder`'s tenant insert →
    `insert into tenants (country, tax_id, legal_name) values ('ES', ${nif}, 'Test SL')` (keep the
    positional `nif` parameter; only the column changes).
  - `packages/fiscal-verifactu/test/fixtures.ts:79, 131, 294` — the two `(id, nif, legal_name)` and
    one `(nif, legal_name)` inserts → `(id, country, tax_id, legal_name)` / `(country, tax_id, legal_name)`
    with `'ES'` prepended.
  - `packages/fiscal-verifactu/src/testing/seed.ts:56` — `(country, tax_id, legal_name) values ('ES', ${nif}, ${"Waitron SL"})`.
  - `packages/core/test/fixtures.ts:56` — `(country, tax_id, legal_name) values ('ES', ${freshNif()}, 'Waitron SL')`.

  *Raw-SQL direct inserts in tests:*
  - `packages/scheduler/src/migrations.test.ts:18` — `('ES', 'B00000001', 'Scheduler Test Tenant')`.
  - `packages/db/src/provisioner-role.rls.test.ts:63,102,133` — `(id, country, tax_id, legal_name)`
    with `'ES'` + the existing literal NIF as `tax_id`.
  - `apps/server/src/provision-till.test.ts:71` — `(country, tax_id, legal_name) values ('ES', ${nif}, 'Deli SL')`.

  *Drizzle `.insert(tenants).values(...)` (key `nif:` → `country: "ES", taxId:`):*
  - `packages/db/src/allocate-number.test.ts:31`, `tenancy.test.ts:61` & `:259`,
    `schema/incidents.test.ts:31`, `schema/nodes.test.ts:33`, `schema/sale-substitutions.test.ts:50`,
    `schema/sale-settlements.test.ts:133-134`, `schema/orders.test.ts:27`, `schema/sale-voids.test.ts:36`,
    `schema/series.test.ts:42`, `schema/sales.test.ts:37`. Each `{ nif: "B…", legalName }` becomes
    `{ country: "ES", taxId: "B…", legalName }`.

  *Production read of the tenant's NIF:* `apps/server/src/provision-till.ts:73-79` — `obligadoNif`:
  ```ts
  async function obligadoNif(tx: Transaction, tenantId: TenantId): Promise<string> {
    const [row] = await tx.select({ taxId: tenants.taxId }).from(tenants).where(eq(tenants.id, tenantId));
    if (row === undefined) {
      throw new AppError("tenant.not_found", { id: tenantId });
    }
    return row.taxId;
  }
  ```
  Keep the doc comment's "the obligado tributario's NIF" wording — for an ES tenant `tax_id` *is* the
  NIF; add one sentence noting the column rename.

  Finally `grep -rn "tenants_nif_key" packages apps --include="*.ts"` and update any remaining
  comment or assertion that names the old constraint (the `freshNif` comments in the other 3
  generators, and any 23505 test that asserts on `tenants_nif_key`).
- [ ] **Step 5: Run it — watch it pass.** `pnpm --filter @waitron/db test nodes` green;
  `pnpm --filter @waitron/db test:coverage` green.
- [ ] **Step 6: Run the tree.** `pnpm typecheck && pnpm test` — every touched package green (this is
  where a missed consumer surfaces). Then the mandatory fiscal guard:
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the FORCE-RLS scan keyed on
  `tenant_id`; adding non-`tenant_id` columns must leave it green).
- [ ] **Step 7:** `git commit -s -m "feat(db): tenants fiscal identity is country + tax_id, not nif"`.

## Task A2: Add fiscal columns to `locations`

**Files:** `packages/db/src/schema/tenants.ts` (the `locations` table lives there), migration.

**Interfaces**
- Produces: `locations` gains `fiscalTerritory text NOT NULL DEFAULT 'ES-common'`,
  `addressLine1/addressLine2/postalCode/city/province text` (nullable),
  `timeZone text NOT NULL DEFAULT 'Europe/Madrid'`, `dayCutover time NOT NULL DEFAULT '06:00:00'`.

- [ ] **Step 1: Write the failing test.** Extend the Task A1 schema-shape suite:
  ```ts
  it("locations carry fiscal_territory, an address, time_zone and day_cutover", async () => {
    const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns where table_name = 'locations'`);
    const byName = new Map(cols.rows.map((r) => [r.column_name, r.is_nullable]));
    expect(byName.get("fiscal_territory")).toBe("NO");
    expect(byName.get("time_zone")).toBe("NO");
    expect(byName.get("day_cutover")).toBe("NO");
    for (const a of ["address_line1", "address_line2", "postal_code", "city", "province"]) {
      expect(byName.has(a)).toBe(true);
    }
  });
  ```
- [ ] **Step 2: Run it — watch it fail.**
- [ ] **Step 3: Edit the schema.** In the `locations` `pgTable`, after `operationDescription`, add:
  ```ts
  fiscalTerritory: text("fiscal_territory").notNull().default("ES-common"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  postalCode: text("postal_code"),
  city: text("city"),
  province: text("province"),
  timeZone: text("time_zone").notNull().default("Europe/Madrid"),
  dayCutover: time("day_cutover").notNull().default("06:00:00"),
  ```
  Import `time` from `drizzle-orm/pg-core`. Extend the table's doc comment: the `DEFAULT`s exist so
  the reshape does not ripple to the ~28 existing location inserts (which never read these columns);
  the `venue` command sets all of them explicitly, and no runtime path reads a location's
  `fiscal_territory` to choose a regime (the node's `filing_module` carries that — Task A3), so a
  defaulted value on a fixture is inert. `day_cutover`/`time_zone` are the inputs `computeDailyClose`
  will consume (spec D9; `@waitron/reporting` does not exist yet — the columns land now, the consumer
  is future).
- [ ] **Step 4: Regenerate the migration** (or a second `drizzle-kit generate`), confirm the ALTERs.
- [ ] **Step 5: Run it — watch it pass.** `pnpm --filter @waitron/db test:coverage` green; then
  `pnpm test` (existing location inserts must stay green untouched — the proof the `DEFAULT`s bound
  the ripple).
- [ ] **Step 6:** `git commit -s -m "feat(db): locations carry fiscal_territory, address, time_zone, day_cutover"`.

## Task A3: Add `filing_module` / `tax_module` to `nodes`

**Files:** `packages/db/src/schema/nodes.ts`, migration.

**Interfaces**
- Produces: `nodes` gains nullable `filingModule text`, `taxModule text`.

- [ ] **Step 1: Write the failing test.** Extend the schema-shape suite:
  ```ts
  it("nodes record the resolved filing_module and tax_module", async () => {
    const cols = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns where table_name = 'nodes'`);
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain("filing_module");
    expect(names).toContain("tax_module");
  });
  ```
- [ ] **Step 2: Run it — watch it fail.**
- [ ] **Step 3: Edit the schema.** In the `nodes` `pgTable`, after `name`, add:
  ```ts
  filingModule: text("filing_module"),
  taxModule: text("tax_module"),
  ```
  Import `text` (already imported). Extend the doc comment: nullable and stamped at provision time
  from the location's territory (Task D1); the authoritative per-sale value stays
  `sales.fiscal_backend` — these are the node's recorded modules, so the running SIF knows its
  backend without re-resolving. Nullable to keep the reshape off every existing bare-node fixture
  (`seedNode`, `seedNodesForSifContention`, `drain-fixtures`); pre-production, so a later NOT NULL
  tightening is free.
- [ ] **Step 4: Regenerate the migration**, confirm the ALTERs. `drizzle-kit generate` should now
  have one `0022_*.sql` covering A1+A2+A3 (or three sequential files if generated per task — either
  is fine; the journal records order).
- [ ] **Step 5: Run it — watch it pass.** `pnpm --filter @waitron/db test:coverage`; then `pnpm test`
  and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` once more (nodes is tenant-scoped).
- [ ] **Step 6:** `git commit -s -m "feat(db): nodes record filing_module and tax_module"`.

---

# PHASE B — Territory→modules resolver + regime error code

## Task B1: Register `fiscal.regime_not_implemented`

**Files:** `packages/fiscal/src/errors.ts`, `packages/fiscal/src/errors.reachability.test.ts`.

**Interfaces**
- Produces: `ErrorParams["fiscal.regime_not_implemented"] = { territory: string }`.

- [ ] **Step 1: Write the failing test.** In `packages/fiscal/src/errors.reachability.test.ts` (or a
  new `regime-error.test.ts` beside it), assert the code constructs and carries its param:
  ```ts
  import { AppError } from "@waitron/shared";
  import "./errors.js";

  it("fiscal.regime_not_implemented carries the offending territory", () => {
    const err = new AppError("fiscal.regime_not_implemented", { territory: "ES-PV-bizkaia" });
    expect(err.code).toBe("fiscal.regime_not_implemented");
    expect(err.params).toEqual({ territory: "ES-PV-bizkaia" });
  });
  ```
- [ ] **Step 2: Run it — watch it fail.** `pnpm --filter @waitron/fiscal test` fails: the code is not
  in the registry, so `new AppError("fiscal.regime_not_implemented", …)` is a **type** error.
- [ ] **Step 3: Register the code.** In `packages/fiscal/src/errors.ts`, inside
  `declare module "@waitron/shared" { interface ErrorParams { … } }`, add:
  ```ts
  /** No fiscal module set is implemented for this territory. Regime-NEUTRAL — the fact that a
   * regime is unimplemented belongs to no single regime — and named for the fiscal-regime concept,
   * never the throwing package. Thrown by `resolveFiscalModules` (@waitron/provisioning) at venue
   * provisioning input (spec D4's refusal) and is the same throw any later runtime consumer of a
   * node's `filing_module` re-raises as its hard error (spec D4's defence-in-depth). `territory` is
   * the operator-supplied free-text `fiscal_territory`, echoed so the refusal can be acted on. */
  "fiscal.regime_not_implemented": { territory: string };
  ```
- [ ] **Step 4: Run it — watch it pass.** `pnpm --filter @waitron/fiscal test:coverage`.
- [ ] **Step 5:** `git commit -s -m "feat(fiscal): fiscal.regime_not_implemented for unimplemented territories"`.

## Task B2: `resolveFiscalModules` + `WAITRON_ID_SISTEMA` in `@waitron/provisioning`

**Files:** `packages/provisioning/src/fiscal-modules.ts` (new),
`packages/provisioning/src/fiscal-modules.test.ts` (new), `packages/provisioning/package.json`.

**Interfaces**
- Consumes: `AppError` (`@waitron/shared`), the `fiscal.regime_not_implemented` registry
  (`@waitron/fiscal`).
- Produces:
  ```ts
  export interface FiscalModules { filing: string; tax: string }
  export function resolveFiscalModules(territory: string): FiscalModules; // throws fiscal.regime_not_implemented
  export const WAITRON_ID_SISTEMA: string; // Waitron's ≤2-char AEAT software id
  export function assertUsableIdSistema(value: string): void;
  ```

- [ ] **Step 1: Add the deps and write the failing test.** In `packages/provisioning/package.json`
  add `"@waitron/fiscal": "workspace:*"` and `"@waitron/fiscal-verifactu": "workspace:*"` (the latter
  is used by Task C2), run `pnpm install`, commit the lockfile in this task's commit. Create
  `packages/provisioning/src/fiscal-modules.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { isAppError } from "@waitron/shared";
  import { WAITRON_ID_SISTEMA, assertUsableIdSistema, resolveFiscalModules } from "./fiscal-modules.js";

  describe("resolveFiscalModules", () => {
    it("resolves ES-common to Veri*Factu + IVA", () => {
      expect(resolveFiscalModules("ES-common")).toEqual({ filing: "verifactu", tax: "iva" });
    });

    it("throws fiscal.regime_not_implemented for any other territory, echoing it", () => {
      try {
        resolveFiscalModules("ES-PV-bizkaia");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(isAppError(error)).toBe(true);
        if (isAppError(error)) {
          expect(error.code).toBe("fiscal.regime_not_implemented");
          expect(error.params).toEqual({ territory: "ES-PV-bizkaia" });
        }
      }
    });

    it("throws for the empty territory too — no silent default", () => {
      expect(() => resolveFiscalModules("")).toThrow();
    });
  });

  describe("WAITRON_ID_SISTEMA", () => {
    it("is a Waitron product code of at most 2 characters", () => {
      expect(WAITRON_ID_SISTEMA.length).toBeGreaterThan(0);
      expect(WAITRON_ID_SISTEMA.length).toBeLessThanOrEqual(2);
      expect(() => assertUsableIdSistema(WAITRON_ID_SISTEMA)).not.toThrow();
    });

    it("assertUsableIdSistema rejects an over-long id", () => {
      expect(() => assertUsableIdSistema("ABC")).toThrow();
    });
  });
  ```
- [ ] **Step 2: Run it — watch it fail.** `pnpm --filter @waitron/provisioning test fiscal-modules`
  fails: module absent.
- [ ] **Step 3: Implement.** Create `packages/provisioning/src/fiscal-modules.ts`:
  ```ts
  import { AppError } from "@waitron/shared";
  import "@waitron/fiscal"; // side-effect: registers fiscal.regime_not_implemented on ErrorParams

  /**
   * A territory's fiscal module set: a filing module (Veri*Factu / TicketBAI / …) and a tax module
   * (IVA / IGIC / IPSI / …), independent because a territory can mix them (Canarias files under
   * Veri*Factu with IGIC; the Basque Country uses TicketBAI with IVA-foral — spec D3, FAQ §§21,23).
   * `filing` is written to `sales.fiscal_backend` and selects the FiscalBackend.
   */
  export interface FiscalModules {
    filing: string;
    tax: string;
  }

  /**
   * Free-text territory → module set, data-driven (a registry, not a fixed enum) so a territory's
   * rules can change without a schema change (spec D3, Open Question 1: config-registry now, a
   * time-effective table later). Only `"ES-common"` is populated (spec D4); every other territory
   * resolves to no implemented set and is REFUSED — the input half of D4's defence-in-depth.
   *
   * This registry lives in @waitron/provisioning, not @waitron/fiscal, on purpose: the literals
   * "verifactu" and "iva" trip @waitron/fiscal's no-regime-vocabulary guard and english-only's
   * SPANISH_WORDS respectively. @waitron/provisioning is in neither GENERIC_PACKAGES nor
   * EXEMPT_PACKAGES, so the english-only scan never reaches it (see the plan's placement decision).
   */
  const REGISTRY: Record<string, FiscalModules> = {
    "ES-common": { filing: "verifactu", tax: "iva" },
  };

  export function resolveFiscalModules(territory: string): FiscalModules {
    const modules = REGISTRY[territory];
    if (modules === undefined) {
      throw new AppError("fiscal.regime_not_implemented", { territory });
    }
    return modules;
  }

  /**
   * Waitron's own AEAT-registered software identifier — a product constant, ≤ 2 chars (FAQ §4), not
   * operator input. It reaches `registro_sif.id_sistema_informatico` via `registerSif` and, through
   * that, `IdSistemaInformatico` on every registro the node files. Config, not a CLI argument, per
   * spec D5 / ground-truth #2. `apps/server/src/provision-till.ts` still takes it as an argument
   * (register-till.ts's shim), duplicating the length rule — converging the two is a noted follow-up.
   */
  export const WAITRON_ID_SISTEMA = "W1";
  const ID_SISTEMA_MAX_LENGTH = 2;

  /** Validates the product constant (a programming error if wrong, not operator error). */
  export function assertUsableIdSistema(value: string): void {
    if (value.length === 0 || value.length > ID_SISTEMA_MAX_LENGTH) {
      throw new AppError("sif.id_sistema_invalid", { value, maxLength: ID_SISTEMA_MAX_LENGTH });
    }
  }
  ```
  Note: `sif.id_sistema_invalid` is already registered (`apps/server/src/errors.ts`); it is reachable
  from `@waitron/shared`'s merged registry, so no new registration is needed — but confirm the
  declaration is in scope by importing a module that merges it. `apps/server` cannot be imported from
  a package; if the code is not visible to `@waitron/provisioning`'s type-checker, register a
  provisioning-owned equivalent instead: add `"provisioning.id_sistema_invalid": { value: string; maxLength: number }`
  to `packages/provisioning/src/errors.ts` (domain-appropriate — it is a fact about a provisioning
  input) and throw that. **Verify which during Step 2** by whether `sif.id_sistema_invalid`
  type-checks here; use the provisioning code if it does not.
- [ ] **Step 4: Prove the guard by deletion.** Temporarily delete the `if (modules === undefined)`
  throw; confirm `resolveFiscalModules("ES-PV-bizkaia")` returns `undefined` and the test goes red;
  restore it. Record this in the commit body.
- [ ] **Step 5: Run it — watch it pass.** `pnpm --filter @waitron/provisioning test:coverage`.
- [ ] **Step 6:** `git commit -s -m "feat(provisioning): resolveFiscalModules registry + WAITRON_ID_SISTEMA"`.

## Task B3: Deterministic tenant id (`obligadoTenantId`)

**Files:** `packages/provisioning/src/tenant-id.ts` (new), `.../tenant-id.test.ts` (new).

**Interfaces**
- Produces: `export function obligadoTenantId(country: string, taxId: string): string` — a stable
  RFC-4122 v5 UUID, so a re-run derives the same id and can adopt the tenant's RLS scope **without**
  a `tax_id` lookup (which RLS forbids — spec D8, `0011_provisioner_role.sql:117-123`).

- [ ] **Step 1: Write the failing test.** `packages/provisioning/src/tenant-id.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { obligadoTenantId } from "./tenant-id.js";

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  describe("obligadoTenantId", () => {
    it("is a well-formed v5 UUID", () => {
      expect(obligadoTenantId("ES", "B12345678")).toMatch(UUID_RE);
    });

    it("is deterministic — same (country, tax_id) yields the same id", () => {
      expect(obligadoTenantId("ES", "B12345678")).toBe(obligadoTenantId("ES", "B12345678"));
    });

    it("distinguishes tax_id and country, and does not collide across the field boundary", () => {
      expect(obligadoTenantId("ES", "B12345678")).not.toBe(obligadoTenantId("ES", "B12345679"));
      expect(obligadoTenantId("ES", "B12345678")).not.toBe(obligadoTenantId("PT", "B12345678"));
      // The "\n" separator: ("ES","X") and ("E","SX") must not collide.
      expect(obligadoTenantId("ES", "X")).not.toBe(obligadoTenantId("E", "SX"));
    });
  });
  ```
- [ ] **Step 2: Run it — watch it fail.**
- [ ] **Step 3: Implement.** `packages/provisioning/src/tenant-id.ts`:
  ```ts
  import { createHash } from "node:crypto";

  /**
   * A fixed, arbitrary namespace UUID. NEVER change it: the derived tenant ids are how a re-run
   * finds the obligado it created before. Under FORCE ROW LEVEL SECURITY a provisioning connection
   * cannot look a tenant up by (country, tax_id) before it knows which tenant scope to adopt
   * (0011_provisioner_role.sql:117-123), so the id is DERIVED from (country, tax_id) instead — the
   * provisioner picks it, sets app.tenant_id to it, and inserts under that scope (spec D8, mirroring
   * bootstrap-tenant.sql's "pick the uuid, set the GUC, insert with an explicit id").
   */
  const OBLIGADO_NAMESPACE = "6f9c1e2a-3b4d-4e6f-8a9b-0c1d2e3f4a5b";

  /** RFC 4122 v5 (SHA-1) UUID of `name` within `namespace`. Deterministic, no dependency. */
  function uuidV5(name: string, namespace: string): string {
    const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
    const digest = createHash("sha1").update(ns).update(name, "utf8").digest();
    const bytes = digest.subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  /** The obligado's stable tenant id, derived from its fiscal identity. */
  export function obligadoTenantId(country: string, taxId: string): string {
    return uuidV5(`${country}\n${taxId}`, OBLIGADO_NAMESPACE);
  }
  ```
- [ ] **Step 4: Run it — watch it pass.** `pnpm --filter @waitron/provisioning test:coverage`.
- [ ] **Step 5:** `git commit -s -m "feat(provisioning): deterministic obligadoTenantId for RLS-safe idempotency"`.

---

# PHASE C — Venue plan/apply, incl. SIF registration + the node-privilege container test

## Task C1: The deciding container test — who may INSERT a node?

**This test writes the answer for Tasks C2–C3. Do not pre-decide it.** It stands up a real,
migrated, stamped database owned by a **non-superuser** admin (mirroring
`instance-apply.rls.test.ts`), then measures whether the owner-admin and a `waitron_provisioner`-shaped
login role can each INSERT a node under the tenant GUC.

**Files:** `packages/provisioning/src/venue-apply.node-privilege.rls.test.ts` (new).

**Interfaces**
- Consumes: `startBarePostgres`, `roleUrl` (`./testing/postgres.js`); `applyInstance`, `withDatabase`
  (`./instance-apply.js`); `planInstance` (`./instance-plan.js`); `readInstanceState`
  (`./instance-state.js`); `createPostgresDb`, `withTenant` (`@waitron/db`); `obligadoTenantId`
  (`./tenant-id.js`); `sqlStateOf` (`./sql-state.js`).

- [ ] **Step 1: Write the deciding test.** Create the file:
  ```ts
  import { sql } from "drizzle-orm";
  import { afterAll, beforeAll, describe, expect, it } from "vitest";
  import { createPostgresDb, withTenant, type Database } from "@waitron/db";
  import { applyInstance, withDatabase } from "./instance-apply.js";
  import { planInstance } from "./instance-plan.js";
  import { readInstanceState } from "./instance-state.js";
  import { sqlStateOf } from "./sql-state.js";
  import { obligadoTenantId } from "./tenant-id.js";
  import { roleUrl, startBarePostgres, type RealPostgres } from "./testing/postgres.js";

  const DATABASE = "waitron_venue_priv_suite";
  const FIXED_PW = "fixedpw"; // every role instance creates gets this, so we can connect as any of them

  describe("who may INSERT a node under FORCE RLS", () => {
    let pg: RealPostgres;
    let superuser: Database;
    let owner: Database; // prov_admin @ target — ran the migrations, therefore owns the tables
    let provisioner: Database; // waitron_provisioner @ target — member of app_user + tenant_provisioner
    let tenantId: string;
    let locationId: string;

    beforeAll(async () => {
      pg = await startBarePostgres();
      superuser = await pg.connect();
      await superuser.execute(sql.raw(`create role prov_admin login createdb createrole password 'prov'`));
      const adminUri = roleUrl(pg.uri, "prov_admin", "prov");
      const admin = await createPostgresDb(adminUri);
      try {
        // Stand up the whole deployment as prov_admin: create db, migrate every set, create the
        // three login roles (each with FIXED_PW), stamp. prov_admin ends up owning the tables.
        const before = await readInstanceState(admin, DATABASE, null);
        await applyInstance(planInstance(before, { database: DATABASE, environment: "preproduction" }, () => FIXED_PW), {
          admin,
          database: DATABASE,
          adminUri,
          migrationsRoot: null,
          openTarget: async () => {
            const db = await createPostgresDb(withDatabase(adminUri, DATABASE));
            return { db, release: () => db.close() };
          },
        });
      } finally {
        await admin.close();
      }

      owner = await createPostgresDb(withDatabase(adminUri, DATABASE));
      provisioner = await createPostgresDb(
        withDatabase(roleUrl(pg.uri, "waitron_provisioner", FIXED_PW), DATABASE),
      );

      // Seed a tenant + location as the owner, under the tenant scope (deterministic id).
      tenantId = obligadoTenantId("ES", "B00000000");
      locationId = await withTenant(owner, tenantId, async (tx) => {
        await tx.execute(sql`
          insert into tenants (id, country, tax_id, legal_name)
          values (${tenantId}, 'ES', 'B00000000', 'Probe SL') on conflict do nothing`);
        const loc = await tx.execute<{ id: string }>(sql`
          insert into locations (tenant_id, name, invoice_locales, operation_description)
          values (${tenantId}, 'Probe', array['es-ES'], 'venta') returning id`);
        return loc.rows[0]!.id;
      });
    }, 180_000);

    afterAll(async () => {
      if (provisioner !== undefined) await provisioner.close();
      if (owner !== undefined) await owner.close();
      if (superuser !== undefined) await superuser.close();
      if (pg !== undefined) await pg.stop();
    });

    it("prov_admin is a non-superuser (the negative control for this whole suite)", async () => {
      const rows = await owner.execute<{ me: string; rolsuper: boolean; rolbypassrls: boolean }>(
        sql`select current_user as me, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
      expect(rows.rows[0]?.me).toBe("prov_admin");
      expect(rows.rows[0]?.rolsuper).toBe(false);
      expect(rows.rows[0]?.rolbypassrls).toBe(false);
    });

    it("the OWNER-admin CAN insert a node under the tenant GUC", async () => {
      const nodeId = await withTenant(owner, tenantId, async (tx) => {
        const node = await tx.execute<{ id: string }>(sql`
          insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Owner node') returning id`);
        return node.rows[0]!.id;
      });
      expect(nodeId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("waitron_provisioner CANNOT (nodes is SELECT-only, 0017) — the control that proves the owner path does real work", async () => {
      let sqlState: string | null = null;
      try {
        await withTenant(provisioner, tenantId, async (tx) => {
          await tx.execute(sql`
            insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Provisioner node')`);
        });
        expect.unreachable("provisioner should be refused INSERT on nodes");
      } catch (error) {
        sqlState = sqlStateOf(error);
      }
      expect(sqlState).toBe("42501"); // permission denied for table nodes
    });
  });
  ```
- [ ] **Step 2: Run it (Docker required).** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
  @waitron/provisioning test venue-apply.node-privilege`. **Read the two outcome tests.** Expected:
  the owner inserts the node, the provisioner is refused 42501. **Record the observed result in the
  commit body** — that recorded result is the input to Task C2.
- [ ] **Step 3: Branch the design on the result (no code beyond the test in this task).**
  - **If the owner succeeds and the provisioner is refused (expected):** the venue apply in Task C3
    runs as the **owner-admin**, inserting the node under the GUC. No grant is widened; `nodes` stays
    SELECT-only, honouring `0017`'s design and CLAUDE.md §3 ("never widen a grant to make a test
    pass").
  - **If the owner is *also* refused** (contradicting the receipt in `bootstrap-tenant.sql`'s header):
    add a custom migration `packages/db/drizzle/00XX_nodes_provisioner_grant.sql` granting a narrow
    `INSERT ON "nodes"` to `tenant_provisioner` (mirroring `0011`'s single-grant shape, with the
    NOSUPERUSER/NOBYPASSRLS reasoning), run venue as `waitron_provisioner`, and add the fiscal
    inmutabilidad re-run. Only take this branch if the container proves it necessary.
- [ ] **Step 4:** `git commit -s -m "test(provisioning): container test decides node-insert privilege (owner vs provisioner)"`.

## Task C2: `planVenue` — the pure planner

**Files:** `packages/provisioning/src/venue-plan.ts` (new), `.../venue-plan.test.ts` (new).

**Interfaces**
- Consumes: `resolveFiscalModules`, `WAITRON_ID_SISTEMA`, `assertUsableIdSistema`
  (`./fiscal-modules.js`); `obligadoTenantId` (`./tenant-id.js`); `AppError` (`@waitron/shared`).
- Produces:
  ```ts
  export interface VenueRequest {
    country: string;
    taxId: string;
    legalName: string;
    location: {
      name: string;
      fiscalTerritory: string;
      invoiceLocales: string[];
      operationDescription: string;
      addressLine1: string;
      addressLine2: string | null;
      postalCode: string;
      city: string;
      province: string;
      timeZone: string;
      dayCutover: string; // "HH:MM" or "HH:MM:SS"
    };
    tillName: string;
    seriesCode: string;
    rectificativeSeriesCode: string;
  }

  export type VenueAction =
    | { kind: "ensure-tenant"; tenantId: string; country: string; taxId: string; legalName: string }
    | { kind: "create-location"; name: string; fiscalTerritory: string; invoiceLocales: string[];
        operationDescription: string; addressLine1: string; addressLine2: string | null;
        postalCode: string; city: string; province: string; timeZone: string; dayCutover: string }
    | { kind: "create-till"; name: string }
    | { kind: "create-node"; name: string; filingModule: string; taxModule: string }
    | { kind: "register-sif"; idSistemaInformatico: string }
    | { kind: "create-series"; code: string; purpose: "standard" | "rectificative" };

  export function planVenue(request: VenueRequest): VenueAction[];
  export function describeVenueAction(action: VenueAction): string;
  ```

- [ ] **Step 1: Write the failing test.** `packages/provisioning/src/venue-plan.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { isAppError } from "@waitron/shared";
  import { obligadoTenantId } from "./tenant-id.js";
  import { planVenue, type VenueRequest } from "./venue-plan.js";

  function request(overrides: Partial<VenueRequest> = {}): VenueRequest {
    return {
      country: "ES",
      taxId: "B12345678",
      legalName: "Deli SL",
      location: {
        name: "Mostrador",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      ...overrides,
    };
  }

  describe("planVenue", () => {
    it("emits ensure-tenant → location → till → node → register-sif → two series, in order", () => {
      const actions = planVenue(request());
      expect(actions.map((a) => a.kind)).toEqual([
        "ensure-tenant", "create-location", "create-till", "create-node",
        "register-sif", "create-series", "create-series",
      ]);
    });

    it("derives the deterministic tenant id and stamps the resolved modules on the node", () => {
      const actions = planVenue(request());
      const tenant = actions.find((a) => a.kind === "ensure-tenant");
      const node = actions.find((a) => a.kind === "create-node");
      expect(tenant).toMatchObject({ tenantId: obligadoTenantId("ES", "B12345678"), country: "ES", taxId: "B12345678" });
      expect(node).toMatchObject({ filingModule: "verifactu", taxModule: "iva" });
    });

    it("emits a standard series and a rectificative series with the requested codes", () => {
      const series = planVenue(request()).filter((a) => a.kind === "create-series");
      expect(series).toEqual([
        { kind: "create-series", code: "A", purpose: "standard" },
        { kind: "create-series", code: "R", purpose: "rectificative" },
      ]);
    });

    it("REFUSES an unimplemented territory (spec D4 input half) before emitting anything", () => {
      try {
        planVenue(request({ location: { ...request().location, fiscalTerritory: "ES-PV-bizkaia" } }));
        expect.unreachable("should have refused");
      } catch (error) {
        expect(isAppError(error) && error.code).toBe("fiscal.regime_not_implemented");
      }
    });

    it("refuses fewer than one or more than two invoice locales", () => {
      expect(() => planVenue(request({ location: { ...request().location, invoiceLocales: [] } }))).toThrow();
      expect(() => planVenue(request({ location: { ...request().location, invoiceLocales: ["a", "b", "c"] } }))).toThrow();
    });
  });
  ```
- [ ] **Step 2: Run it — watch it fail.**
- [ ] **Step 3: Implement `venue-plan.ts`.**
  ```ts
  import { AppError } from "@waitron/shared";
  import { WAITRON_ID_SISTEMA, resolveFiscalModules } from "./fiscal-modules.js";
  import { obligadoTenantId } from "./tenant-id.js";
  import "@waitron/fiscal";

  export interface VenueRequest { /* as in Interfaces above */ }
  export type VenueAction = /* as in Interfaces above */;

  /**
   * Pure: request → the flat action list applyVenue runs, or a throw. Every refusal that can be made
   * without a database is made here (spec D4's input half, the locale cardinality the DB CHECK also
   * enforces), where a unit test reaches it without a container. Mirrors planInstance.
   *
   * The location/till/node ids are NOT in the actions: they are generated at apply time and threaded
   * by order (ensure-tenant sets the scope; create-location makes a location; create-node makes the
   * node the following actions reference). Only the tenant id is here, and it is DERIVED — so a
   * re-run reuses the same obligado under RLS without a tax_id lookup (spec D8).
   */
  export function planVenue(request: VenueRequest): VenueAction[] {
    const locales = request.location.invoiceLocales;
    if (locales.length < 1 || locales.length > 2) {
      throw new AppError("provisioning.invalid_locales", { count: locales.length });
    }
    const modules = resolveFiscalModules(request.location.fiscalTerritory); // throws for unimplemented
    const tenantId = obligadoTenantId(request.country, request.taxId);

    return [
      { kind: "ensure-tenant", tenantId, country: request.country, taxId: request.taxId, legalName: request.legalName },
      {
        kind: "create-location",
        name: request.location.name,
        fiscalTerritory: request.location.fiscalTerritory,
        invoiceLocales: locales,
        operationDescription: request.location.operationDescription,
        addressLine1: request.location.addressLine1,
        addressLine2: request.location.addressLine2,
        postalCode: request.location.postalCode,
        city: request.location.city,
        province: request.location.province,
        timeZone: request.location.timeZone,
        dayCutover: request.location.dayCutover,
      },
      { kind: "create-till", name: request.tillName },
      { kind: "create-node", name: request.location.name, filingModule: modules.filing, taxModule: modules.tax },
      { kind: "register-sif", idSistemaInformatico: WAITRON_ID_SISTEMA },
      { kind: "create-series", code: request.seriesCode, purpose: "standard" },
      { kind: "create-series", code: request.rectificativeSeriesCode, purpose: "rectificative" },
    ];
  }

  /** One action as a line an operator can check in the plan summary. Mirrors describeAction. */
  export function describeVenueAction(action: VenueAction): string {
    switch (action.kind) {
      case "ensure-tenant":
        return `ensure tenant ${action.country}/${action.taxId} (${action.legalName})`;
      case "create-location":
        return `create location ${action.name} in ${action.fiscalTerritory} (${action.invoiceLocales.join(", ")})`;
      case "create-till":
        return `create till ${action.name}`;
      case "create-node":
        return `create node ${action.name} filing=${action.filingModule} tax=${action.taxModule}`;
      case "register-sif":
        return `register the node as a SIF (id_sistema ${action.idSistemaInformatico})`;
      case "create-series":
        return `create ${action.purpose} series ${action.code}`;
    }
  }
  ```
  Register `provisioning.invalid_locales` in `packages/provisioning/src/errors.ts`:
  `"provisioning.invalid_locales": { count: number }` with a doc comment (a fact about a venue input;
  the invoice-locale list must hold one or two entries — the same rule `locations_invoice_locales_len`
  enforces at the DB, refused early so the operator is not charged a connection first). Add
  `import "./errors.js"` to `venue-plan.ts`.
- [ ] **Step 4: Prove the refusal by deletion.** Remove the `resolveFiscalModules` call (hardcode
  `{ filing: "verifactu", tax: "iva" }`); confirm the "REFUSES an unimplemented territory" test goes
  red; restore. Record in the commit body.
- [ ] **Step 5: Run it — watch it pass.** `pnpm --filter @waitron/provisioning test:coverage`.
- [ ] **Step 6:** `git commit -s -m "feat(provisioning): planVenue pure planner with D4 refusal"`.

## Task C3: `applyVenue` — one transaction, idempotent, running as the owner-admin

**Files:** `packages/provisioning/src/venue-apply.ts` (new), `.../venue-apply.test.ts` (new).

**Interfaces**
- Consumes: `Database`, `withTenant`, `isUniqueViolation` (`@waitron/db`); `registerSif`,
  `SifRegistration` (`@waitron/fiscal-verifactu`); `VenueAction` (`./venue-plan.js`);
  `brandTenantId`, `brandNodeId` (`@waitron/shared`); `sql` (`drizzle-orm`); `AppError`.
- Produces:
  ```ts
  export interface VenueApplyDeps { db: Database } // the OWNER connection to the TARGET database
  export interface VenueResult { tenantId: string; locationId: string; tillId: string; nodeId: string;
    sif: SifRegistration; seriesIds: string[] }
  export function applyVenue(actions: readonly VenueAction[], deps: VenueApplyDeps): Promise<VenueResult>;
  ```

- [ ] **Step 1: Write the failing tests.** `packages/provisioning/src/venue-apply.test.ts`. Use
  PGlite for the wiring/idempotency logic (a superuser connection — RLS is bypassed, which is fine
  here because the privilege behaviour is proven separately in Task C1's container test; state that
  in a comment). Own the db via `usePgliteDb` with the core + fiscal migration sets:
  ```ts
  import { sql } from "drizzle-orm";
  import { describe, expect, it } from "vitest";
  import { CORE_MIGRATIONS } from "@waitron/db";
  import { FISCAL_MIGRATIONS } from "@waitron/fiscal-verifactu";
  import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
  import { planVenue, type VenueRequest } from "./venue-plan.js";
  import { applyVenue } from "./venue-apply.js";

  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS] });

  function request(taxId = "B12345678"): VenueRequest { /* same shape as venue-plan.test.ts */ }

  describe("applyVenue", () => {
    it("provisions a sellable venue: tenant, location, till, node, live SIF, two series", async () => {
      const result = await applyVenue(planVenue(request()), { db: suite.db });

      const counts = await suite.db.execute<{ tenants: number; nodes: number; series: number; sif: number }>(sql`
        select
          (select count(*) from tenants where id = ${result.tenantId})::int as tenants,
          (select count(*) from nodes where id = ${result.nodeId})::int as nodes,
          (select count(*) from invoice_series where node_id = ${result.nodeId})::int as series,
          (select count(*) from registro_sif where node_id = ${result.nodeId} and revocado_en is null)::int as sif`);
      expect(counts.rows[0]).toEqual({ tenants: 1, nodes: 1, series: 2, sif: 1 });
      expect(result.sif.numeroInstalacion).toBeGreaterThanOrEqual(1);

      const series = await suite.db.execute<{ purpose: string }>(sql`
        select purpose from invoice_series where node_id = ${result.nodeId} order by purpose`);
      expect(series.rows.map((r) => r.purpose)).toEqual(["rectificative", "standard"]);

      // The node carries the resolved modules.
      const node = await suite.db.execute<{ filing_module: string; tax_module: string }>(sql`
        select filing_module, tax_module from nodes where id = ${result.nodeId}`);
      expect(node.rows[0]).toEqual({ filing_module: "verifactu", tax_module: "iva" });

      // registro_sif.nif came from the tenant's tax_id, never an argument.
      const sif = await suite.db.execute<{ nif: string }>(sql`
        select nif from registro_sif where id = ${result.sif.id}`);
      expect(sif.rows[0]?.nif).toBe("B12345678");
    });

    it("reuses the obligado on a re-run rather than duplicating it (idempotent tenant, spec D8)", async () => {
      const first = await applyVenue(planVenue(request("B99999999")), { db: suite.db });
      const second = await applyVenue(planVenue(request("B99999999")), { db: suite.db });
      expect(second.tenantId).toBe(first.tenantId); // same deterministic id, reused

      const tenants = await suite.db.execute<{ n: number }>(sql`
        select count(*)::int as n from tenants where country = 'ES' and tax_id = 'B99999999'`);
      expect(tenants.rows[0]?.n).toBe(1); // exactly one obligado, not two
    });

    it("mints a distinct installation number per node under one obligado", async () => {
      const a = await applyVenue(planVenue(request("B11111111")), { db: suite.db });
      const b = await applyVenue(planVenue(request("B11111111")), { db: suite.db });
      expect(a.tenantId).toBe(b.tenantId);
      expect(a.sif.numeroInstalacion).not.toBe(b.sif.numeroInstalacion); // fresh node ⇒ fresh install #, new chain
    });
  });
  ```
  Add a fourth test that a freshly-provisioned venue actually chains a sale (spec §7): import
  `VerifactuBackend` from `@waitron/fiscal-verifactu` and `recordSale` from `@waitron/core`, and
  assert `recordSale` against `result` succeeds — if this couples too many packages for one unit
  file, place it instead in `packages/fiscal-verifactu` as a small e2e that provisions via `applyVenue`
  and calls the backend; note the choice in the commit.
- [ ] **Step 2: Run it — watch it fail.**
- [ ] **Step 3: Implement `venue-apply.ts`.**
  ```ts
  import { randomUUID } from "node:crypto";
  import { sql } from "drizzle-orm";
  import { withTenant, type Database, type Transaction } from "@waitron/db";
  import { registerSif, type SifRegistration } from "@waitron/fiscal-verifactu";
  import { nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";
  import type { VenueAction } from "./venue-plan.js";

  export interface VenueApplyDeps {
    /** The OWNER connection to the TARGET database — the admin that ran `instance` and so owns the
     * tables. Task C1's container test proved the owner INSERTs a node under the tenant GUC while a
     * SELECT-only login role cannot, so this runs the whole flow as one role with no grant widened. */
    db: Database;
  }

  export interface VenueResult {
    tenantId: string;
    locationId: string;
    tillId: string;
    nodeId: string;
    sif: SifRegistration;
    seriesIds: string[];
  }

  /**
   * Runs one plan as ONE transaction under `withTenant`, mirroring provisionNode (NOT applyInstance:
   * there is no cluster DDL here, and a single transaction is what a partial venue must never be).
   * The tenant scope is adopted from the ensure-tenant action's deterministic id, so every WITH CHECK
   * (`tenant_id = current_tenant_id()`) is satisfied by the row this run inserts.
   *
   * Idempotency is `ON CONFLICT DO NOTHING` on the natural keys — the transaction-safe form of spec
   * D8's "insert, treat conflict as already-present" (a bare 23505 catch would poison the
   * transaction). It applies only where a natural key exists: the tenant (country, tax_id) and the
   * series (tenant, node, code). Location/till/node have no business key — a tenant legitimately has
   * many shops — so a re-run ADDS a shop; it never resumes a half-built one, and never re-registers
   * an existing node's SIF (the fiscally load-bearing guard, spec D5): each run creates a FRESH node,
   * so `registerSif` mints a new installation number and starts a new chain rather than forking one.
   */
  export async function applyVenue(actions: readonly VenueAction[], deps: VenueApplyDeps): Promise<VenueResult> {
    const ensure = actions.find((a) => a.kind === "ensure-tenant");
    if (ensure === undefined || ensure.kind !== "ensure-tenant") {
      throw new Error("applyVenue: plan is missing ensure-tenant");
    }
    const tenantId = ensure.tenantId;

    return withTenant(deps.db, tenantId, async (tx) => {
      let locationId = "";
      let tillId = "";
      let nodeId = "";
      let sif: SifRegistration | undefined;
      const seriesIds: string[] = [];

      for (const action of actions) {
        switch (action.kind) {
          case "ensure-tenant":
            // Deterministic id + explicit id satisfies WITH CHECK (id = current_tenant_id()); DO
            // NOTHING reuses an existing obligado (spec D8). No tax_id lookup — RLS forbids it.
            await tx.execute(sql`
              insert into tenants (id, country, tax_id, legal_name)
              values (${action.tenantId}, ${action.country}, ${action.taxId}, ${action.legalName})
              on conflict (country, tax_id) do nothing`);
            break;
          case "create-location": {
            locationId = randomUUID();
            await tx.execute(sql`
              insert into locations
                (id, tenant_id, name, invoice_locales, operation_description, fiscal_territory,
                 address_line1, address_line2, postal_code, city, province, time_zone, day_cutover)
              values (${locationId}, ${tenantId}, ${action.name}, ${action.invoiceLocales},
                 ${action.operationDescription}, ${action.fiscalTerritory}, ${action.addressLine1},
                 ${action.addressLine2}, ${action.postalCode}, ${action.city}, ${action.province},
                 ${action.timeZone}, ${action.dayCutover})`);
            break;
          }
          case "create-till":
            tillId = randomUUID();
            await tx.execute(sql`
              insert into tills (id, tenant_id, location_id, name)
              values (${tillId}, ${tenantId}, ${locationId}, ${action.name})`);
            break;
          case "create-node":
            nodeId = randomUUID();
            await tx.execute(sql`
              insert into nodes (id, tenant_id, location_id, name, filing_module, tax_module)
              values (${nodeId}, ${tenantId}, ${locationId}, ${action.name}, ${action.filingModule}, ${action.taxModule})`);
            break;
          case "register-sif":
            // nif is read from the tenant row inside registerSif's caller contract? No — registerSif
            // takes nif as a param, so read it here from the tenant we just ensured (never an
            // argument, mirroring provisionNode's obligadoNif: an operator-supplied NIF would file a
            // real tenant's sales under someone else's).
            sif = await registerSifForNode(tx, tenantId, nodeId, action.idSistemaInformatico);
            break;
          case "create-series": {
            const seriesId = randomUUID();
            await tx.execute(sql`
              insert into invoice_series (id, tenant_id, node_id, code, purpose)
              values (${seriesId}, ${tenantId}, ${nodeId}, ${action.code}, ${action.purpose})
              on conflict (tenant_id, node_id, code) do nothing`);
            seriesIds.push(seriesId);
            break;
          }
        }
      }

      if (sif === undefined) throw new Error("applyVenue: register-sif never ran");
      return { tenantId, locationId, tillId, nodeId, sif, seriesIds };
    });
  }

  /** Reads the obligado's tax_id (the NIF) from the tenant row and registers the node as its SIF. */
  async function registerSifForNode(
    tx: Transaction, tenantId: string, nodeId: string, idSistemaInformatico: string,
  ): Promise<SifRegistration> {
    const rows = await tx.execute<{ tax_id: string }>(sql`select tax_id from tenants where id = ${tenantId}`);
    const nif = rows.rows[0]?.tax_id;
    if (nif === undefined) throw new Error("applyVenue: tenant vanished before SIF registration");
    return registerSif(tx, {
      tenantId: brandTenantId(tenantId),
      nodeId: brandNodeId(nodeId),
      nif,
      idSistemaInformatico,
    });
  }
  ```
  Note: `isUniqueViolation` is imported for the CLI's outer boundary (Task D1) rather than used
  inside the transaction; if a linter flags it unused here, keep it in `cli.ts` instead. Confirm
  `CORE_MIGRATIONS` and `FISCAL_MIGRATIONS` are the correct exported migration-option shapes for
  `usePgliteDb` (both are re-exported from their package barrels).
- [ ] **Step 4: Run it — watch it pass.** `pnpm --filter @waitron/provisioning test:coverage`.
- [ ] **Step 5: Run the container privilege path end-to-end.** Extend Task C1's container suite (or
  add one test) that runs the **real** `applyVenue` over the **owner** connection and asserts the
  same counts as the PGlite test — this is the one place the whole flow runs under FORCE RLS as a
  non-superuser owner, closing the gap PGlite cannot. `TESTCONTAINERS_RYUK_DISABLED=true`.
- [ ] **Step 6:** `git commit -s -m "feat(provisioning): applyVenue — one-transaction, idempotent venue provisioning"`.

---

# PHASE D — CLI `venue` subcommand + retire bootstrap

## Task D1: The `venue` subcommand

**Files:** `packages/provisioning/src/cli.ts`, `.../cli.test.ts`, `.../bin.ts`, `.../index.ts`.

**Interfaces**
- Consumes: `planVenue`, `describeVenueAction`, `VenueRequest` (`./venue-plan.js`); `applyVenue`,
  `VenueApplyDeps` (`./venue-apply.js`); `readDeploymentEnvironment`, `isUniqueViolation`
  (`@waitron/db`); the existing `resolveAdminUri`, `resolveOption`, `withDatabase`, `describeAdmin`,
  `reportFailure`, `assertIdentifier`.
- Produces: `CliDeps.applyVenue: typeof applyVenue`; `runCli` `case "venue"`.

- [ ] **Step 1: Write the failing tests.** In `cli.test.ts` add a `venue` block, mirroring the
  `instance` tests' injected-IO style (no process, no container). Cover:
  - a full run with every option supplied and `--yes`: `readState`/`connect` injected fakes assert
    the environment is read (stamp present), `applyVenue` is called with the planned actions, exit 0;
  - **refuses an unimplemented `--territory`** with `fiscal.regime_not_implemented`, exit 1, and
    `applyVenue` is never called;
  - **refuses an unstamped database** (`readDeploymentEnvironment` returns `null`) before applying;
  - **never accepts a secret as an argument** — extend the existing "strict parse" assertion so
    `venue --admin-url=… ` and `venue --password …` are parse errors (exit 2, usage), and no
    generated value appears in the transcript;
  - prompts for each omitted venue option (assert the prompt questions fire in order).
  Example (the refusal):
  ```ts
  it("refuses an unimplemented territory and applies nothing", async () => {
    const io = fakeIo(/* answers */);
    const applyVenue = vi.fn();
    const code = await runCli(
      ["venue", "--database", "waitron_prod", "--country", "ES", "--tax-id", "B1", "--legal-name", "X",
       "--location-name", "L", "--territory", "ES-PV-bizkaia", "--locale", "es-ES",
       "--operation-description", "op", "--address-line1", "C1", "--postal-code", "1", "--city", "M",
       "--province", "M", "--time-zone", "Europe/Madrid", "--day-cutover", "06:00",
       "--till-name", "T", "--series-code", "A", "--rectificative-code", "R", "--yes"],
      deps({ io, env: { WAITRON_ADMIN_DATABASE_URL: "postgres://o@h/db" }, applyVenue,
             readState: async () => ({ /* stamped */ }) as never }),
    );
    expect(code).toBe(1);
    expect(io.stderr).toContainEqual(expect.stringContaining("fiscal.regime_not_implemented"));
    expect(applyVenue).not.toHaveBeenCalled();
  });
  ```
  Adapt to the file's existing `deps`/`fakeIo` helpers. For asserting the stamp read, inject a
  `readDeploymentEnvironment` seam (add it to `CliDeps`, defaulting to the real one in `bin.ts`), or
  read it through the target `connect` the tests already fake — pick whichever matches the file's
  established pattern (the `instance` tests inject `readState`/`apply`; add `applyVenue` and a
  `readEnvironment` seam the same way).
- [ ] **Step 2: Run it — watch it fail.**
- [ ] **Step 3: Implement.** In `cli.ts`:
  - Add to `CliDeps`: `applyVenue: typeof applyVenue;` and (if used) `readEnvironment: typeof readDeploymentEnvironment;`.
  - Add `case "venue": return venue(rest, deps);` to `runCli`'s switch.
  - Extend `USAGE` with the `venue` line and its options.
  - Implement `venue(argv, deps)`: parse the venue options with `parse(argv, { database, country,
    "tax-id", "legal-name", "location-name", territory, locale (multiple: true), "operation-description",
    "address-line1", "address-line2", "postal-code", city, province, "time-zone", "day-cutover",
    "till-name", "series-code", "rectificative-code", yes })` (all `type: "string"` except
    `locale: { type: "string", multiple: true }` and `yes: { type: "boolean" }`). Resolve each
    omitted option via `resolveOption`/prompt (locales via repeated prompt if none supplied);
    validate `country` is two ASCII letters and `taxId`/names are non-empty (throw
    `provisioning.invalid_country` — register it in `errors.ts` — and reuse `assertIdentifier`
    only for the database name, not for free-text fields). Resolve the admin URI with the existing
    `resolveAdminUri`. Then:
    ```ts
    return await withVenueState(adminUri, database, deps, async (target) => {
      const environment = await deps.readEnvironment(target);
      if (environment === null) {
        throw new AppError("provisioning.database_unstamped", { database });
      }
      const request: VenueRequest = { /* assembled from resolved options */ };
      const actions = planVenue(request); // D4 refusal surfaces here as fiscal.regime_not_implemented
      deps.io.stdout(`Plan for a venue in ${database} (${environment}):`);
      deps.io.stdout(`Cluster: ${describeAdmin(adminUri)}`);
      for (const action of actions) deps.io.stdout(`  ${describeVenueAction(action)}`);
      if (values.yes !== true) {
        const answer = (await deps.io.prompt("Apply this plan? [y/N] ")).trim().toLowerCase();
        if (answer !== "y" && answer !== "yes") { deps.io.stderr("Nothing was applied."); return 1; }
      }
      try {
        const result = await deps.applyVenue(actions, { db: target });
        deps.io.stdout(`tenant:   ${result.tenantId}`);
        deps.io.stdout(`node:     ${result.nodeId}`);
        deps.io.stdout(`SIF:      ${result.sif.id} (installation ${result.sif.numeroInstalacion})`);
        return 0;
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A concurrent venue run created this obligado between the plan and the apply.
          throw new AppError("provisioning.venue_conflict", { database });
        }
        throw error;
      }
    });
    ```
    `withVenueState` is a small helper (modelled on `withState`) that connects to the **target**
    database as the owner-admin (`withDatabase(adminUri, database)`), runs `body(target)`, and closes
    in a `finally` — the venue command needs the target connection, not the cluster admin, because it
    runs as the table owner (Task C1). Wrap the whole thing in the existing `try/catch → reportFailure`.
  - Register in `errors.ts`: `"provisioning.database_unstamped": { database: string }` (a venue
    cannot be provisioned in a database with no environment stamp — spec §5 step 1 / D10),
    `"provisioning.venue_conflict": { database: string }` (a concurrent run created the obligado),
    `"provisioning.invalid_country": { value: string }` (a country that is not ISO-3166 alpha-2 — a
    provisioning input fact, the same domain as `provisioning.invalid_identifier`). Each with a doc
    comment following the file's conventions; none carries a secret.
  - In `bin.ts`, add `applyVenue` (import from `./venue-apply.js`) and `readEnvironment:
    readDeploymentEnvironment` to the `runCli` deps object.
  - In `index.ts`, export `planVenue`, `applyVenue`, `resolveFiscalModules`, `obligadoTenantId`, and
    their types.
- [ ] **Step 4: Run it — watch it pass.** `pnpm --filter @waitron/provisioning test:coverage`.
- [ ] **Step 5: Bundle smoke.** `pnpm --filter @waitron/provisioning build` then
  `node packages/provisioning/dist/bin.js venue` with no args prints usage and exits 2 (the same
  check `bin.ts`'s doc comment names for `instance`). Confirm `dist/drizzle` is still present.
- [ ] **Step 6:** `git commit -s -m "feat(provisioning): waitron-provision venue subcommand"`.

## Task D2: Retire `bootstrap-tenant.sql`

**Files:** delete `apps/server/sql/bootstrap-tenant.sql`; update `apps/server/README.md` and any
other reference.

**Interfaces**: none (removal).

- [ ] **Step 1: Find every reference.** `grep -rn "bootstrap-tenant" apps packages docs --include="*.md"
  --include="*.ts" --include="*.sql"`. It is stale twice over: it inserts `invoice_series.till_id`
  (dropped by `0018`, now `node_id NOT NULL`) so it cannot even run, and it creates no node so it
  cannot produce a sellable venue (spec §0). The `venue` command replaces it.
- [ ] **Step 2: Delete and re-point.** `git rm apps/server/sql/bootstrap-tenant.sql`. In
  `apps/server/README.md` replace the bootstrap-tenant usage block with the `waitron-provision venue`
  invocation (a worked example using the option list from Task D1), noting it must run against a
  **stamped, migrated** database as the **owner-admin** (the role that ran `instance`), and that the
  SIF's `id_sistema_informatico` is now the `WAITRON_ID_SISTEMA` constant, not an argument. Add a
  dated pointer rather than rewriting history where a historical doc referenced the script (CLAUDE.md
  §6 "historical docs record what was true when written").
- [ ] **Step 3: Verify nothing else consumes it.** Confirm no test or script executes the file
  (`register-till.ts`'s header mentions it in prose only — update that comment to point at `venue`).
  `pnpm --filter @waitron/server test:coverage` stays green.
- [ ] **Step 4:** `git commit -s -m "chore(server): retire stale bootstrap-tenant.sql; venue replaces it"`.

## Task D3: Backlog + whole-branch gate

**Files:** `docs/backlog.md`; then the full gate.

- [ ] **Step 1:** Update `docs/backlog.md` to record sub-project 6 (Locations) as landed on this
  branch, note the deferred #33 follow-ups (active-active / failover / multi-SIF, update/rename/
  deactivate, the IGIC/IPSI tax module, cross-country establishments) and the flagged follow-ups from
  the Self-Review below. (A `docs/backlog.md`-only change is PR-exempt per CLAUDE.md §6, but here it
  rides the feature branch — commit it `-s` with the rest.)
- [ ] **Step 2: Run the whole gate.** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
  Then coverage for every touched package: `@waitron/db`, `@waitron/fiscal`, `@waitron/provisioning`,
  `@waitron/payments`, `@waitron/core`, `@waitron/fiscal-verifactu`, `@waitron/scheduler`,
  `@waitron/server` — `pnpm --filter <pkg> test:coverage`. Run the fiscal FORCE-RLS guard once more:
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. Run the tree-wide guards from
  `scripts/` (english-only, guarded-teardowns) via `pnpm vitest run --coverage` at the root, per
  CLAUDE.md §4. `pnpm install` and commit the lockfile if not already.
- [ ] **Step 3:** `git commit -s -m "docs(backlog): Locations (sub-project 6) landed"`. Hand off to
  `superpowers:finishing-a-development-branch` / the branch-finishing flow.

---

## Self-Review

**Spec coverage (design §§0–9):**
- §3 schema reshape — Tasks A1–A3 (tenants nif→country/tax_id + unique; locations
  fiscal_territory/address/time_zone/day_cutover; nodes filing_module/tax_module). Veri\*Factu backend
  reads `tax_id` via `obligadoNif` (A1). `registro_sif.nif`/`contadores_instalacion.nif` stay named
  `nif`, populated from `tax_id` (C3's `registerSifForNode`). ✓
- §4 resolver — Task B2 (`resolveFiscalModules`, `"ES-common"` only, throws
  `fiscal.regime_not_implemented` from B1). D4 "both": input refusal in `planVenue` (C2) proven by
  deletion; runtime hard-error is the same resolver throw (B2), reachable by future consumers — the
  composition-root wiring is flagged, not built. ✓
- §5 flow — assert environment (D1 unstamped refusal), tenant/location/till/node/SIF/series (C3),
  idempotent tenant reuse (C3). ✓
- §6 home & privilege — extend `@waitron/provisioning` (B/C/D); privilege decided by container test
  (C1), not asserted; idempotency insert-and-DO-NOTHING, never a NIF lookup (C3). ✓
- §7 testing — real Postgres for the privilege path (C1, C3 Step 5); PGlite for pure logic (B, C3);
  prove-by-deletion on both D4 guards (B2, C2); `inmutabilidad` re-run after schema change (A). ✓
- §8 YAGNI — single node/venue; no update/rename; explicitly deferred set recorded (D3). ✓
- §9 Open Questions — territory store is a config registry now (B2); `fiscal_territory` vocabulary
  settled as `"ES-common"` (B2/C2); no sale-blocking behaviour changed; the cloud-issuer question is
  untouched. ✓
- §0 environment inherited — asserted (`readDeploymentEnvironment`, D1), not modelled; bootstrap
  retired (D2). ✓ Certificates untouched. ✓

**Placeholder scan:** every code step carries real, compilable code — no "TBD", no "add error
handling", no "similar to Task N". The one deliberately conditional step (C1→C2/C3 privilege branch)
carries **both** branches' concrete code and is gated on a recorded container result, per the spec's
"the test decides." The consumer-fix checklist (A1 Step 4) enumerates every site with its exact
edit.

**Type consistency:** `VenueRequest`/`VenueAction`/`VenueApplyDeps`/`VenueResult` are declared once
(C2/C3) and consumed unchanged by the CLI (D1). `resolveFiscalModules` returns `FiscalModules`
consumed by `planVenue`. `obligadoTenantId` returns `string`, branded via `brandTenantId` at the
`registerSif` boundary (C3), matching its `{ tenantId: TenantId }` signature. `applyVenue` takes
`readonly VenueAction[]` (matching `planVenue`'s return) and `VenueApplyDeps { db: Database }`. Error
codes are registered before they are thrown (B1 `fiscal.regime_not_implemented`; provisioning's
`invalid_locales`/`database_unstamped`/`venue_conflict`/`invalid_country`).

**Flagged for the human:**
1. **Deterministic tenant id (B3).** The spec says "insert-and-catch-unique, never look-up-by-NIF"
   and "the provisioner picks the tenant UUID"; deriving that UUID from `(country, tax_id)` is what
   makes reuse-if-present *work* under RLS (a random id can't be recovered after a conflict without a
   forbidden lookup). This is the plan's resolution of an under-specified detail — confirm the
   approach.
2. **`ON CONFLICT DO NOTHING` vs. a literal `isUniqueViolation` catch (C3).** One transaction (spec
   ground-truth #1) and a mid-transaction 23505 catch are incompatible (the catch poisons the txn),
   so idempotency inside the transaction is `ON CONFLICT DO NOTHING`; `isUniqueViolation` guards the
   CLI's outer boundary (D1). Same intent, transaction-safe realisation.
3. **Location column `DEFAULT`s (A2) and nullable node modules (A3)** were chosen to keep the reshape
   off ~28 existing location inserts and every bare-node fixture. The design wrote them `NOT NULL`
   without defaults; the venue command always sets explicit values and no runtime path reads a
   location's `fiscal_territory` for regime selection, so a defaulted fixture value is inert. If you
   want strict NOT-NULL-without-default, the ripple is larger but mechanical.
4. **Resolver placement in `@waitron/provisioning`, not `@waitron/fiscal`** — forced by two guards
   (`no-regime-vocabulary` rejects `"verifactu"`, `english-only`'s `SPANISH_WORDS` rejects `"iva"`),
   and `@waitron/provisioning` is outside both scans. The error code still lives in `@waitron/fiscal`.
5. **`@waitron/reporting` does not exist yet.** `time_zone`/`day_cutover` land now (spec D9) with no
   current consumer; `computeDailyClose` is future.
6. **`WAITRON_ID_SISTEMA = "W1"`** is a placeholder product code — confirm the real AEAT-registered
   value before a real filing. `apps/server`'s `provision-till.ts` still takes it as an argument;
   converging the two (and the duplicated length rule) is a noted follow-up, not done here to bound
   scope.
7. **Container-test outcome (C1)** is expected to be "owner inserts, provisioner refused", but the
   plan is written so the recorded result — not this document — selects C2/C3's implementation.

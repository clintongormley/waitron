# Drop the tenant id from every table and write path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `tenant_id` column, its foreign keys and every query clause that references it from the whole codebase, and reduce `tenants` to a single-row taxpayer record enforced by a database constraint.

**Architecture:** Do it in three phases in a strict order that keeps the TypeScript workspace compiling at every commit. Phase A removes everything that *reads or filters by* the tenant — this compiles while the columns still exist, so it can be cut per concern. Phase B drops the columns, foreign keys and constraints from each migration set and regenerates that set's migrations — safe only after Phase A has removed every reference to them. Phase C locks it in with a guard and updates the rules and docs.

**Tech Stack:** TypeScript, drizzle-orm + drizzle-kit (`0.31.x`, one config and one migration folder per package), Vitest, PGlite and Testcontainers (real PostgreSQL 18), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-drop-tenant-id-design.md` — read it first; this plan argues from it.

## Global Constraints

- **One tenant per database, always** (owner 2026-09-05). No database anywhere holds two tenants, the preproduction trial demo included. Nothing in this plan adds support for a shared database.
- **Pre-production: schema changes drop and recreate; no data-migration or backwards-compat code** (`CLAUDE.md` §3). There is no deployed database to preserve. A re-run of provisioning is the only "existing data" case, handled explicitly in Task B8.
- **Never hand-edit drizzle snapshots or `_journal.json`; regenerate** (`CLAUDE.md` §3). `scripts/journal-monotonic.test.ts` must stay green.
- **Migrations here are virgin-DB-only for every module set except `core`, which has an upgrade test.** Regenerating a baseline is therefore legitimate; do not add ALTER-to-preserve steps.
- **Never build SQL by string concatenation** except utility statements, which must escape or validate (`CLAUDE.md` §3). All the raw SQL edited here uses drizzle's `sql` tagged template, which parameterises — keep it that way.
- **Grants are read back, not trusted by exit code** (`CLAUDE.md` §3): an object-privilege GRANT that partially applies WARNs and exits 0. Verify ACLs by running the grant assertion suites, as `app_user` with `rolsuper = f`.
- **A grant assertion must call `asAppUser(tx)` before the query under test** or it runs as owner and asserts nothing (`CLAUDE.md` §4).
- **Plain English in commit messages and PR text** (owner 2026-09-11). Exact file/function/column names appear once as pointers; commands run go in verbatim.
- **Every commit is `git commit -s`.** Feature work is in the worktree created for this branch.
- **This diff touches migrations, grants and a cross-package contract — a risk trigger.** It takes the FULL review ceremony: per-task reviews, the fresh-context plan-vs-spec read, the simplify lenses, and the Codex run-it seat.

**Naming decisions fixed for the whole plan (use these exact names):**
- `withTenant` → `withTransaction`. Signature: `withTransaction<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T>`.
- The taxpayer row stays in table `tenants`; the other `tenant_*` tables keep their names (renaming is out of scope, spec §"What does not change").
- New guard file: `scripts/no-tenant-column.test.ts`.
- New provisioning error code for a conflicting re-provision: `provisioning.tenant_identity_mismatch` (confirm the `provisioning.` prefix and absence of a sibling by grepping `packages/provisioning/src/errors.ts` in Task B8 before adding it).

**The 12 migration sets carrying `tenant_id`** (verify the live list in Task A1 with `grep -rl tenant_id packages/*/drizzle/*.sql | sed -E 's#packages/([^/]+)/.*#\1#' | sort -u`): `bookings`, `catalogue`, `credentials`, `db`, `fiscal-verifactu`, `identity`, `media`, `payments`, `scheduler`, `venue-service`, `workforce`, `workforce-es`.

---

## Phase A — Remove every reference that reads or filters by tenant (columns still present, workspace stays green)

Order rule for Phase A: nothing here drops a column. Every task leaves the `tenant_id` columns in place and still populated by inserts, so the workspace compiles and every suite stays green. Removing a `where tenant_id = …` filter or a `.tenantId` read never breaks a build while the column exists. Run each task's named suites; they must stay green (behaviour preserved — `CLAUDE.md` "When refactoring, preserve behavioural assertions").

### Task A1: Rename `withTenant` to `withTransaction` and drop its tenant argument

**Files:**
- Modify: `packages/db/src/tenancy.ts`
- Modify: `packages/db/src/index.ts:118` (the re-export)
- Modify: `packages/db/src/index.test.ts:37` (the re-export assertion)
- Modify: all ~267 non-test call sites and their test call sites across `apps/server` (67), `fiscal-verifactu`, `payments-stripe`, `provisioning`, `layouts`, `db`, `payments-sumup`, `printing`, `payments`, `credentials`, `bookings`, `venue-service`, `scheduler`, `media`, `identity` (counts from `grep -rln withTenant packages apps --include='*.ts' | grep -v test`)

**Interfaces:**
- Produces: `withTransaction(db, fn)` — every later task uses this name; no task calls `withTenant` again.

- [ ] **Step 1: Confirm the live set of affected packages and call sites**

Run: `grep -rl tenant_id packages/*/drizzle/*.sql | sed -E 's#packages/([^/]+)/.*#\1#' | sort -u` and `grep -rn 'withTenant(' packages apps --include='*.ts' | wc -l`
Expected: the 12 sets listed in Global Constraints; a non-zero call-site count. If the package list differs from the plan, note it in the task's commit and carry the difference forward — later Phase B tasks are per-package.

- [ ] **Step 2: Rewrite the helper**

In `packages/db/src/tenancy.ts`, replace the function with:

```ts
import type { Database, Transaction } from "./client.js";

/**
 * Runs the caller's work in one transaction. One tenant per database, so there is no tenant to bind:
 * a write path takes the `tx` this opens and never opens its own (CLAUDE.md §3). Renamed from
 * `withTenant` when the tenant column was dropped (2026-09-14).
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction((tx) => fn(tx));
}
```

- [ ] **Step 3: Update the re-export and its test**

In `packages/db/src/index.ts` change `export { withTenant } from "./tenancy.js";` to `export { withTransaction } from "./tenancy.js";`. In `packages/db/src/index.test.ts` update the "re-exports withTenant" assertion to `withTransaction`.

- [ ] **Step 4: Update every call site**

Every `withTenant(db, someTenantId, fn)` becomes `withTransaction(db, fn)`. The middle argument (`cfg.tenantId`, `config.till.tenantId`, `deps.tenantId`, a literal) is dropped. Find them with `grep -rln 'withTenant' packages apps --include='*.ts'`. Import name changes from `withTenant` to `withTransaction` in each file. Leave `cfg.tenantId` definitions alone for now — later tasks remove them; an unused read still compiles.

- [ ] **Step 5: Typecheck the workspace and run the db suite**

Run: `pnpm -r typecheck && pnpm --filter @waitron/db test:coverage`
Expected: PASS. A leftover `withTenant` is a compile error naming the file.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -s -m "Rename withTenant to withTransaction and drop its unused tenant argument

One tenant per database means the transaction helper never had a tenant to
bind; the argument was threaded through ~267 call sites for nothing. This is
the first step of removing the tenant id everywhere (spec
2026-09-14-drop-tenant-id-design.md). No column is dropped yet, so every suite
stays green."
```

### Task A2: Remove the per-query tenant filters and the `cfg.tenantId` shapes

**Files:**
- Modify: every file with `eq(<table>.tenantId, <x>)` or `and(eq(<table>.tenantId, …), …)` — find with `grep -rln 'tenantId' packages apps --include='*.ts' | grep -v test` and work through the non-test set (~325 files; most touch one or two lines)
- Modify: `apps/server/src/till-config.ts` (drop `tenantId` from `TillConfig` and its parser), `apps/server/src/configuration-export-api.ts`, `apps/server/src/configuration-transfer.ts`, and every `cfg: { tenantId: string; … }` shape (`grep -rn 'tenantId: string' packages apps --include='*.ts' | grep -v test`)

**Interfaces:**
- Consumes: `withTransaction` from Task A1.
- Produces: no config object carries `tenantId`; no read query filters on `tenantId`.

- [ ] **Step 1: Confirm the production write paths do not select tenant into row objects that other code reads**

Run: `grep -rn '\.tenantId' packages apps --include='*.ts' | grep -v test | grep -v 'eq(' | grep -v 'cfg.tenantId\|config.till.tenantId'`
Expected: a short list. Each remaining `.tenantId` read must be traced: if it feeds a filter or a config, it goes; if a production path genuinely needs the taxpayer id (e.g. building an AEAT payload), it must read it from the one `tenants` row instead — note any such site for Task B8. There should be none on the fiscal payload path (the NIF is `tax_id`, read from `tenants`, not a `tenant_id`).

- [ ] **Step 2: Remove the filters**

Delete each `eq(table.tenantId, x)`. Where it was the sole argument of a `where`, delete the whole `.where(...)`. Where it was one arm of an `and(...)`, keep the other arm(s) and unwrap the `and` if only one remains. A by-id read that was `and(eq(t.id, id), eq(t.tenantId, cfg.tenantId))` becomes `eq(t.id, id)`.

- [ ] **Step 3: Remove `tenantId` from config shapes**

Drop `tenantId` from `TillConfig` and from every `cfg: { tenantId … }` parameter shape and its call sites. `configuration-export-api.ts` and `configuration-transfer.ts` stop threading `source.tenantId`; they read the one `tenants` row where they need the legal name (leave the export bundle shape otherwise unchanged — a bundle no longer carries a tenant id).

- [ ] **Step 4: Typecheck and run the heavy consumers**

Run: `pnpm -r typecheck && pnpm --filter @waitron/core test:coverage && pnpm --filter server test:coverage`
Expected: PASS. Suites still assert the same behaviour because one tenant per database means the filter never changed a result.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -s -m "Stop filtering reads by tenant and drop tenantId from config shapes

With one tenant per database the tenant filter can never change a result; the
by-id reads keep their own id predicate. TillConfig and the cfg shapes stop
carrying a tenant id. Columns are still present, so suites stay green."
```

### Task A3: Remove the tenant from identity, live-updates, the shared brand and the env variable

**Files:**
- Modify: `packages/identity/src/manager-login.ts:160-166` (`authorizeManager` stops returning `tenantId`) and its callers (`grep -rn 'authorizeManager' apps packages --include='*.ts' | grep -v test`)
- Modify: `apps/server/src/live-api.ts:78-104` (drop the `tenantId` dep and the `event.change.tenantId` filter) and `packages/shared/src/live-updates.ts:7` (drop `tenantId` from `ResourceChange`) and every `ChangeSource`/change emitter that sets it (`grep -rn 'tenantId' packages/*/src --include='*.ts' | grep -i 'change\|resource' | grep -v test`)
- Modify: `packages/shared/src/ids.ts:56` and `:index.ts:38` (delete the `tenantId` brand and its export) and every importer of the brand (`grep -rn 'tenantId' packages/shared/src` then `grep -rln "tenantId" ... importers`)
- Modify: `apps/server/src/till-config.ts` (remove `WAITRON_TILL_TENANT_ID` parsing), `apps/server/.env.example:75`, `apps/server/scripts/dev-setup.ts`, `apps/server/src/break-glass-command.ts`, and the boot tests that set the variable (`boot.promote.test.ts`, `boot.singleton.test.ts`, `boot.mirror.test.ts`, `config.test.ts`, `boot.promote-endpoint.test.ts`, `promote-endpoint-e2e.test.ts`, `dev-setup.test.ts`)

**Interfaces:**
- Consumes: `withTransaction`.
- Produces: `authorizeManager` returns `{ authorizedBy: string; role: PersonRoleValue }`; `ResourceChange` is `{ resources: ResourceIdentity[] }`; no `tenantId` brand exists; `WAITRON_TILL_TENANT_ID` is unread.

- [ ] **Step 1: Add a failing assertion that the env variable is ignored, not required**

In `apps/server/src/config.test.ts`, add a test that boot config parses successfully when `WAITRON_TILL_TENANT_ID` is absent, and (separately) that a config with it *set* is accepted and the value is not present on the parsed config object. Run it; it fails to compile because `TillConfig` still has `tenantId`.

- [ ] **Step 2: Remove `tenantId` from `authorizeManager`**

Change the return type to `Promise<{ authorizedBy: string; role: PersonRoleValue }>` and stop selecting/returning the tenant. Update callers: the route-level "compare the session's tenant with the configured tenant" checks (`configuration-export-api.ts`, the printer routes, and any other `authorizeManager` caller that compares tenants) are deleted — the comparison is meaningless with one tenant. Keep the permission check itself.

- [ ] **Step 3: Remove the live-updates tenant field and the brand**

Drop `tenantId` from `ResourceChange` and from `live-api.ts` (both the `deps.tenantId` and the `event.change.tenantId !== deps.tenantId` guard). Delete the `tenantId` brand from `shared/src/ids.ts` and its `index.ts` export; replace `TenantId` uses with plain `string` where they remain (they will mostly be deleted by Phase B).

- [ ] **Step 4: Remove the env variable**

Delete `WAITRON_TILL_TENANT_ID` parsing from `till-config.ts`, from `.env.example`, from `dev-setup.ts` and `break-glass-command.ts`, and from the boot tests that set it. A box that still has the variable in its environment boots normally because nothing reads it — that is what the Step 1 test now proves.

- [ ] **Step 5: Run the assertion from Step 1 and the identity + server suites**

Run: `pnpm --filter server test:coverage && pnpm --filter @waitron/identity test:coverage`
Expected: PASS, including the new env test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -s -m "Remove the tenant from identity, live updates, the shared brand and env

authorizeManager no longer returns a tenant and the route-level tenant
comparisons are deleted; live updates drop the tenant filter; the TenantId
brand and the WAITRON_TILL_TENANT_ID variable are gone. A box that still sets
the variable boots normally — a new config test proves it is ignored, not
required."
```

### Task A4: Delete the two-tenant probe tests

**Files:**
- Delete or edit: the ~87 test files matching `grep -rl 'other tenant\|tenant B\|otherTenant\|second tenant\|two tenant\|cross-tenant\|foreign tenant\|another tenant' packages apps --include='*.test.ts'`

**Interfaces:**
- Consumes: nothing.
- Produces: no test stages a second tenant.

- [ ] **Step 1: Produce the exact list**

Run: `grep -rl 'other tenant\|tenant B\|otherTenant\|second tenant\|two tenant\|cross-tenant\|foreign tenant\|another tenant' packages apps --include='*.test.ts' | sort > /tmp/probe-files.txt && cat /tmp/probe-files.txt`
Expected: ~87 files. Put this list in the commit message so a reviewer can see each deletion was deliberate.

- [ ] **Step 2: Classify each file**

For each file, read it and decide: (a) the whole file exists only to prove cross-tenant isolation (e.g. `packages/db/src/schema/locations-default-catalogue.test.ts`, `packages/bookings/src/bookings-tenant.pg.test.ts`) → delete the file; (b) the file has one or two two-tenant *cases* inside an otherwise-relevant suite → delete only those `it(...)` blocks and any second-tenant fixture they use. Never rewrite a two-tenant assertion into a one-tenant one — it would assert nothing (spec §Tests).

- [ ] **Step 3: Delete accordingly and check the guards still find their suites**

Run: `pnpm --filter @waitron/db test:coverage && pnpm --filter @waitron/bookings test:coverage`
Expected: PASS. If deleting a whole file drops a package below a coverage threshold, that is a signal the file also covered single-tenant behaviour — restore the file and delete only the two-tenant cases instead.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -s -m "Delete the two-tenant isolation probes

These assert an isolation the schema will no longer have (one tenant per
database). Rewriting them to pass with one tenant would assert nothing, so they
are deleted, not rewritten. Files removed and cases removed are listed below.

<paste /tmp/probe-files.txt, marking each as file-deleted or cases-removed>"
```

- [ ] **Step 5: Phase A gate — full local check**

Run: `pnpm -r typecheck && pnpm format:check && pnpm lint`
Expected: PASS. The workspace is fully green with every tenant *reference* gone and every tenant *column* still present. Do not run whole-workspace tests here (CLAUDE.md §2 — that is CI's job); the per-package suites above are the feedback.

---

## Phase B — Drop the columns, foreign keys and constraints, one migration set at a time

Order rule for Phase B: drop the leaf module sets first (their tables are inserted only within their own package, so the schema-type change is self-contained), then the widely-referenced `db`/core set last (its tables are inserted by fixtures across many packages, so its task sweeps those). After Phase A no code *reads* a tenant column, so a schema-type drop now breaks only: drizzle `.values({ tenantId })` inserts (mostly fixtures), `.tenantId` selects in fixtures, and raw-SQL `insert into … (tenant_id)` statements (runtime only). Each task fixes all three for its set.

**The per-set mechanism, identical for every Phase B task** (each task below states only what differs):

1. **Edit the schema source** under `packages/<pkg>/src/schema/`. In each table: delete the `tenantId: uuid("tenant_id")…` column; delete every constraint/index whose `.on(...)` led with `t.tenantId` (a `unique("x_tenant_id_key").on(t.tenantId, t.id)` whose only purpose was the composite-FK target is deleted — the target becomes the table's own single-column PK; a `unique(...).on(t.tenantId, t.name)` "unique per tenant" becomes `unique(...).on(t.name)`; a bare `index(...).on(t.tenantId)` is deleted). Rewrite composite FKs declared in the schema to drop the tenant column.
2. **Regenerate** the drizzle-managed migration: `pnpm --filter @waitron/<pkg> db:generate`. Inspect the emitted file — it must contain only tenant-related drops/alters. If it emits anything else, the schema edit was wrong; fix and regenerate. Never hand-edit `drizzle/meta/*.json` or `_journal.json`.
3. **Hand-rewrite the paired custom migration(s)** — the `*_sql.sql` files and any hand-written composite-FK/grant migration for this set. Drop `tenant_id` from every `FOREIGN KEY ("tenant_id", "x") REFERENCES "parent" ("tenant_id","id")` (becomes `FOREIGN KEY ("x") REFERENCES "parent" ("id")`), from every `GRANT … (col, …)` column list, and from every `reject_mutation`/append-only trigger definition that names it. A pure `FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")` is deleted outright.
4. **Fix this set's inserts:** raw-SQL `insert into <table> (tenant_id, …) values (${x}, …)` loses the `tenant_id` column and its value; drizzle `.values({ tenantId, … })` loses the `tenantId` key. This set's `test/fixtures.ts` and `src/testing/seed.ts` lose the tenant argument and column.
5. **Run** `pnpm --filter @waitron/<pkg> test:coverage`. For a set with real-PG suites, `TESTCONTAINERS_RYUK_DISABLED=true` must be set and Docker running (CLAUDE.md §4).
6. **Read the ACLs back** for any set whose grants changed: the package's grant assertion suite must pass as `app_user` (it calls `asAppUser(tx)`); a green exit code alone is not evidence (CLAUDE.md §3).
7. **Commit** with `-s`, message naming the set and stating that regeneration (not hand-edited snapshots) produced the migration.

**Typecheck note:** between Phase B commits the workspace may not fully typecheck, because a downstream package's fixture still writes `tenantId` into a table whose type just lost it. That is expected and allowed *within* Phase B (spec §"How the work is cut"). Each task runs its own package suite; the Phase B gate (Task B9) restores a green `pnpm -r typecheck`. Order the tasks so each set's own suite passes at its own commit — a set's own fixtures are fixed in its own task.

### Task B1: `scheduler` (1 file, smallest — proves the mechanism)

Follow the per-set mechanism. `scheduler` has one migration touching `tenant_id` (`scheduled_runs`). No composite FKs beyond the tenant FK. Run `pnpm --filter @waitron/scheduler test:coverage`.

- [ ] Steps 1–7 of the per-set mechanism.
- [ ] Commit: `Drop tenant_id from the scheduler migration set`

### Task B2: `credentials` (`tenant_credentials`)

`tenant_credentials`' primary key changes from `(tenant_id, purpose)` to `(purpose)`. It stays classified `local` (`packages/credentials/src/classification.ts:15`) — do not touch the classification. The `iv`/`auth_tag` length CHECKs are unrelated; keep them. Grant suite must pass as `app_user`.

- [ ] Steps 1–7. Verify the new PK is `(purpose)` and `tenant_credentials_pk` is regenerated, not hand-edited.
- [ ] Commit: `Drop tenant_id from the credentials vault`

### Task B3: `workforce-es` (`convenio_config`) then `workforce`

`convenio_config` (`workforce-es`) has `tenant_id` + `location_id`; it keeps `location_id`. `workforce`'s tables reference `tenants`, `locations`, `tills`, `nodes` (see `packages/workforce/src/schema-ownership.test.ts`). Its `test/fixtures.ts` `seedLocation(db, tenantId)` and `seedPerson(db, tenantId, …)` lose the tenant argument. **The working-time chain is keyed by node, never by tenant** (spec §5 / CLAUDE.md) — confirm no chain column is touched. Do these two sets in one task (workforce-es depends on workforce's tables for its FK-consistency, and their fixtures interlock).

- [ ] Steps 1–7 for both sets.
- [ ] Commit: `Drop tenant_id from the workforce and workforce-es sets`

### Task B4: `bookings`

`bookings`' custom migration has composite FKs `(tenant_id, table_id) → dining_tables (tenant_id, id)` and `(tenant_id, tab_id) → working_orders (tenant_id, id)` (`packages/bookings/drizzle/0001_bookings_baseline_sql.sql:13,17`). These become `(table_id) → dining_tables(id)` and `(tab_id) → working_orders(id)`. `dining_tables` and `working_orders` are `db`-owned, so their `(tenant_id, id)` composite unique targets are dropped in Task B8 — **but the referenced `id` is already those tables' PK**, so the single-column FK is valid immediately. Delete `packages/bookings/src/bookings-tenant.pg.test.ts` (a two-tenant probe) if Task A4 did not.

- [ ] Steps 1–7. Run `pnpm --filter @waitron/bookings test:coverage` (real-PG; Ryuk disabled, Docker up).
- [ ] Commit: `Drop tenant_id from the bookings set`

### Task B5: `media`

`media`'s schema is `src/schema/images.ts` (`media_images`, `media_image_data`). Note `CLAUDE.md`: helper calls inside SQL functions used by expression indexes must be schema-qualified — if the image index rebuild is touched by regeneration, keep the qualification. Run the media suite including its `images.pg.test.ts`.

- [ ] Steps 1–7.
- [ ] Commit: `Drop tenant_id from the media set`

### Task B6: `venue-service`

Schema `src/schema/service.ts`. Follow the mechanism; check `category-dependencies.test.ts` and `operations.test.ts` stay green.

- [ ] Steps 1–7.
- [ ] Commit: `Drop tenant_id from the venue-service set`

### Task B7: `catalogue`

The largest module set: 6 tenant-bearing migrations and a deep composite-FK web — `menu_item_options` references `menu_item_option_groups (tenant_id, menu_item_id, group_id)`, `menu_items` references `catalogues`, `products`, `menu_sections`, `option_group_items`, all tenant-consistent (`packages/catalogue/drizzle/0000_menu_offers.sql:43-51`). Each composite FK drops its leading `tenant_id` and keeps the business columns: `(tenant_id, menu_id, section_id) → menu_sections(tenant_id, menu_id, id)` becomes `(menu_id, section_id) → menu_sections(menu_id, id)`. The target uniques those FKs point at (in `catalogues`, `menu_sections`, etc.) drop their `tenant_id` too, staying valid because the remaining columns are still unique under one tenant. `catalogue` has both baselines and incremental migrations (`0010_product_units_primary_key.sql`, `0011_category_colour.sql`) — regenerate against the current schema; the guard `scripts/journal-monotonic.test.ts` must stay green. `test/fixtures.ts` `seedLegacySellingUnits(db, tenantId)` loses its tenant argument.

- [ ] Steps 1–7. Inspect the regenerated migration carefully — this set emits the most FK churn.
- [ ] Run `pnpm --filter @waitron/catalogue test:coverage` and `pnpm exec vitest run scripts/journal-monotonic.test.ts`.
- [ ] Commit: `Drop tenant_id from the catalogue set`

### Task B8: `db`/core, the `tenants` singleton, `deriveTenantId`, and `applyVenue`

The widest set: `tenants`, `locations`, `tills`, `nodes`, `working_orders`, `sales`, `daily_closes`, `dining_tables`, `canvases`, `payment_policy`, `tenant_themes`, `tenant_receipts`, and more. Because `db`'s table types are consumed by fixtures across the workspace, this task sweeps the remaining cross-package fixture inserts.

**Files (beyond the per-set mechanism):**
- Modify: `packages/db/src/schema/tenants.ts` — make `tenants` a one-row table (below)
- Modify: `packages/provisioning/src/tenant-id.ts` — delete `deriveTenantId` and the file
- Modify: `packages/provisioning/src/venue-plan.ts`, `venue-apply.ts` (the `ensure-tenant` action), and `apps/server`'s double-provision guard
- Modify: `packages/db/src/testing/seed.ts` (`seedTenant`), and every remaining cross-package fixture that inserts into a db-owned table with a tenant column (`identity/test/fixtures.ts` `seedTill`, `fiscal-verifactu/test/fixtures.ts` — but fiscal's own schema is Task B9's concern; here fix only the db-owned inserts fiscal's fixtures make)
- Add: `provisioning.tenant_identity_mismatch` to `packages/provisioning/src/errors.ts`

- [ ] **Step 1: Make `tenants` a one-row table.** Follow the existing `deployment` singleton precedent (`packages/db/src/schema/deployment.ts` — `id: integer("id").primaryKey()` + `check("…_singleton_ck", sql\`… = 1\`)`), because `tenants` IS in the schema barrel and drizzle-managed (unlike `deployment`, which is hand-written and out of the barrel). New shape:

```ts
export const tenants = pgTable(
  "tenants",
  {
    // One row per database. id pinned to 1 so a second insert violates the PK and the check.
    id: integer("id").primaryKey(),
    country: text("country").notNull(),
    taxId: text("tax_id").notNull(),
    legalName: text("legal_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("tenants_singleton_ck", sql`${t.id} = 1`),
    uniqueIndex("tenants_country_tax_id_key").on(t.country, t.taxId),
  ],
);
```

The `id` type changes from `uuid` to `integer`. All FKs to `tenants.id` are already gone (deleted per set in B1–B7 and in this task's core tables), so nothing references the old uuid id.

- [ ] **Step 2: Delete `deriveTenantId`.** Remove `packages/provisioning/src/tenant-id.ts` and its imports. `venue-plan.ts` stops computing a derived id; the tenant row is inserted with `id = 1`.

- [ ] **Step 3: Rewrite `applyVenue`'s `ensure-tenant`.** Replace the derived-id insert + `ON CONFLICT (country, tax_id) DO NOTHING` with: read the one `tenants` row (`select country, tax_id from tenants where id = 1`). If absent, insert `(1, country, tax_id, legal_name)`. If present and `(country, tax_id)` match the request after `.trim().toUpperCase()` canonicalisation, no-op (idempotent re-run). If present and they differ, throw `provisioning.tenant_identity_mismatch`. This replaces the old silent second-tenant behaviour (spec §"The taxpayer row"). Grep `packages/provisioning/src/errors.ts` first to confirm no sibling code and the `provisioning.` prefix.

- [ ] **Step 4: Write the failing test for the mismatch, then make it pass.** In `packages/provisioning`'s applyVenue suite: (a) a fresh DB provisions and creates row id=1; (b) a re-run with the same country/tax_id is an idempotent no-op; (c) a re-run with a different tax_id throws `provisioning.tenant_identity_mismatch`. Run it — (c) fails first, then passes after Step 3. Assert the domain error code, not `toBeInstanceOf(Error)` (CLAUDE.md §4 — a DB constraint error also satisfies that).

- [ ] **Step 5: Apply the per-set mechanism to every db-owned table**, plus `payment_policy`/`tenant_themes`/`tenant_receipts` losing their `tenant_id` PK for the singleton constraint (same precedent as `tenants`). Regenerate `pnpm --filter @waitron/db db:generate`; hand-rewrite `0001_db_baseline_sql.sql`'s grants and composite FKs and the `reject_mutation` triggers.

- [ ] **Step 6: Sweep the remaining cross-package fixtures** that insert into db-owned tables (`seedTenant`, `seedTill`, workforce/recipes/identity fixtures' db-owned inserts). Each drops its tenant column/argument. `seedTenant` becomes "ensure the one tenants row exists" returning nothing (or `1`).

- [ ] **Step 7: Run the core, db and provisioning suites, and read the grants back.**

Run: `pnpm --filter @waitron/db test:coverage && pnpm --filter @waitron/core test:coverage && pnpm --filter @waitron/provisioning test:coverage`
Expected: PASS, including the new mismatch test and the db grant assertions (as `app_user`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -s -m "Drop tenant_id from the core set and make tenants a one-row table

tenants becomes id=1 with a singleton check (the deployment-table precedent);
deriveTenantId is deleted; applyVenue reads the one row and refuses a re-run
whose country/tax_id differ (provisioning.tenant_identity_mismatch) instead of
silently minting a second permanent tenant. Migrations regenerated with
drizzle-kit, not hand-edited. Cross-package fixtures that inserted into
db-owned tables lose their tenant column."
```

### Task B9: `identity` and `fiscal-verifactu`

Done last and together because the fiscal set is the highest-risk and its fixtures depend on identity and db being already converted. **The fiscal hash must be untouched** — verify by running, not reading (spec §Risks): `grep -rn tenant packages/verifactu/src` prints nothing today, and `registros_facturacion` loses `tenant_id` like any table while `node_id` and the taxpayer NIF (`tax_id`) stay. `identity`'s `webauthn_credentials` unique `(tenant_id, credential_id)` becomes `(credential_id)`; `management_sessions`, `persons`, `sessions`, `webauthn_challenges` drop their `tenant_id` and tenant FK.

- [ ] **Step 1:** Apply the per-set mechanism to `identity`. Run `pnpm --filter @waitron/identity test:coverage`.
- [ ] **Step 2:** Apply the per-set mechanism to `fiscal-verifactu`. Its `test/fixtures.ts` (`seedTenants`, `seedTenantTillSif`, `seedTenantWithSif`) drop the tenant column from every insert.
- [ ] **Step 3: Run the fiscal suites in full, on real PostgreSQL** — this is the run-not-read check:

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage`
Expected: PASS, including `inmutabilidad.test.ts`, `chain.concurrency.test.ts` and `chain.node-rekey.concurrency.test.ts`. If any chain test fails, the hash input changed — stop and investigate; the spec's assumption was that it did not.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -s -m "Drop tenant_id from the identity and fiscal-verifactu sets

The fiscal hash was never a function of the tenant (verified: grep -rn tenant
packages/verifactu/src is empty; the chain and inmutabilidad suites pass
unchanged on real PostgreSQL). registros_facturacion loses tenant_id like every
table; node_id and the taxpayer NIF (tax_id) are what identify a record to
AEAT and are untouched."
```

- [ ] **Step 5: Phase B gate — workspace typecheck and the schema guards**

Run: `pnpm -r typecheck && pnpm exec vitest run scripts/journal-monotonic.test.ts scripts/classification-complete.test.ts scripts/append-only-enable-always.test.ts`
Expected: PASS. Then run the replication suite (real-PG), which proves the regenerated published tables still replicate and every published table kept a primary key:

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/replication-tests test:coverage`
Expected: PASS.

---

## Phase C — Lock it in and update the rules

### Task C1: Add the `no-tenant-column` guard

**Files:**
- Create: `scripts/no-tenant-column.test.ts` (root Vitest project, so the hook and the `lint` job run it on every non-docs push — CLAUDE.md §4)

**Interfaces:**
- Consumes: nothing.
- Produces: a guard that fails if `tenant_id` returns to any migration SQL or `tenantId` to non-test source.

- [ ] **Step 1: Write the guard.** It reads text (state that in the header — the one hedge a failing test cannot restore, CLAUDE.md §7): (a) no `tenant_id` in any `packages/*/drizzle/*.sql`; (b) no `tenantId` identifier in non-test `.ts` under `packages/` and `apps/`, with the sole allowed occurrence being the `tenants` table's own column definitions in `packages/db/src/schema/tenants.ts` (there are none after B8 — `tenants` has `country`/`taxId`, so the allowlist can be empty). Use `sourceFilesIn` with `isFile()` (CLAUDE.md §4 — a screenshot directory named `*.test.ts` breaks a naive `.ts` scan).

```ts
// Reads TEXT, not code: a column reintroduced under a name that avoids the
// string "tenant_id"/"tenantId" would pass. That is the known gap.
```

- [ ] **Step 2: Prove it by deletion.** Reintroduce one `tenant_id` column in a scratch edit, run the guard, watch it fail naming the file; revert. Run: `pnpm exec vitest run scripts/no-tenant-column.test.ts` → PASS on the clean tree.

- [ ] **Step 3: Commit** `Add the no-tenant-column guard (reads text; see header for the gap)`

### Task C2: Update the rules and documents

**Files:**
- Modify: `CLAUDE.md` §3 (retire the by-id-read rule and the authorizeManager-tenant rule; reword the `withTenant`→`withTransaction` line; keep the `app_user` grant line)
- Modify: `docs/developers/conventions-data.md` (dated "superseded" notes on the two retired sections pointing to the spec; reword the transaction-helper section)
- Modify: `docs/backlog.md` → Standing decisions (append "and the schema carries no tenant column (2026-09-14)" to the one-tenant line)
- Modify: every prose claim about tenant scoping across `docs/`, READMEs and runbooks — found by reading, not grepping an identifier (CLAUDE.md §1 "the PATH SET matters"); the `WAITRON_TILL_TENANT_ID` mentions in `docs/superpowers/plans/` get a one-line dated pointer at the top of each file, not an edit (historical docs are not rewritten)

- [ ] **Step 1: Retire and reword the CLAUDE.md rules.** Replace the two retired rules with one line: *There is no tenant column. The taxpayer is the one row in `tenants` (id = 1, singleton check); a query that wants "this tenant's rows" reads the table. (2026-09-14, spec 2026-09-14-drop-tenant-id-design.md.)*

- [ ] **Step 2: Update conventions-data.md and backlog.md** as above.

- [ ] **Step 3: Sweep the prose.** Read `deploy/README.md`, the runbooks in `docs/superpowers/plans/`, and any README paraphrase of tenant scoping across the whole `docs/` tree (not just `packages/`/`apps/`). Fix live claims; add dated pointers to historical plans. Run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` to confirm no CLAUDE.md link broke.

- [ ] **Step 4: Commit** `Retire the tenant-scoping rules and update the docs`

### Task C3: Full local gate and finish

- [ ] **Step 1:** `pnpm -r typecheck && pnpm format:check && pnpm lint`
- [ ] **Step 2:** Run the guard suite the hook runs: `pnpm exec vitest run scripts/` → PASS (includes the new guard, journal-monotonic, classification, append-only, claude-md-pointers).
- [ ] **Step 3:** Reset and reseed a dev box to prove a virgin migration runs clean end to end: `wa-wt reset demo <worktree-name>` then boot and confirm no `migrations.*` error. Re-enrol the dev till at `http://localhost:5190` with code `DEMO`.
- [ ] **Step 4:** Announce branch readiness and run `/finish-branch` (full ceremony — this is a risk-trigger diff). The run-it seat's brief: insert a second `tenants` row as `app_user` and confirm the singleton check refuses it; boot a box with `WAITRON_TILL_TENANT_ID` still set and confirm it is ignored; re-run `applyVenue` with a different tax id and confirm `provisioning.tenant_identity_mismatch`.

---

## Self-Review

**Spec coverage:** Schema drop → B1–B9. `tenants` one-row + singleton → B8 Step 1. `deriveTenantId` deletion + applyVenue refusal → B8 Steps 2–4. `withTenant`→`withTransaction` → A1. Env var + brand + live-updates + authorizeManager → A3. Query filters + cfg shapes → A2. Two-tenant tests deleted not rewritten → A4. Fiscal hash untouched, verified by running → B9 Step 3. Replication/classification guards green → B9 Step 5. New guard (reads text, gap stated) → C1. Rules + prose sweep (path set beyond packages/apps) → C2. Fixtures become ensure-one-row → B8 Step 6. Grants read back not trusted → per-set Step 6, B8 Step 7. Full ceremony + run-it brief → C3 Step 4. All covered.

**Placeholder scan:** No "TBD"/"handle edge cases". The per-set SQL is generated by `drizzle-kit generate` (the repo's own mechanism) with explicit inspect-and-hand-rewrite steps — not a placeholder but the actual workflow, because 186 FK rewrites cannot be hand-authored correctly as literal SQL in a plan and this repo never hand-writes drizzle snapshots.

**Type consistency:** `withTransaction(db, fn)` used identically in A1 and every later reference. `provisioning.tenant_identity_mismatch` named identically in B8 and C3. `tenants` new shape (id:integer, singleton check) defined once in B8 and referenced by C1's rule text and C3's run-it brief.

**Known scope honesty:** Phase B commits may leave `pnpm -r typecheck` red between tasks (a downstream fixture still writes a just-dropped column); this is stated at the head of Phase B and restored at B9 Step 5. This is inherent to a shared type graph and is why the phases, not the packages, are the atomic units.

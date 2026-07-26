# Tenant Credential Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/credentials` — a per-tenant, encrypted credential store with a provisioning CLI — so the `apps/*` host (sub-project C) has somewhere to read Stripe keys, webhook signing secrets and AEAT certificate material from.

**Architecture:** One table, `tenant_credentials`, keyed `(tenant_id, purpose)`, holding an AES-256-GCM-sealed JSON payload. The AAD is bound to `tenant_id || purpose`, so a ciphertext cannot be moved between rows. Decryption happens in Node, never in Postgres. A key ring resolves the decryption key from each row's own `key_version`, which makes an interrupted rotation survivable. Cross-tenant enumeration goes through a `SECURITY DEFINER` function returning only uuids — the third instance of a pattern `envios_tenants_with_work` and `resolve_payment_tenant` already established.

**Tech Stack:** TypeScript, Drizzle ORM (pg-core), `node:crypto`, `node:util`'s `parseArgs`, Vitest, PGlite for schema/store tests, Testcontainers PostgreSQL for RLS, `fast-check` for crypto properties, esbuild for the CLI bundle.

**Spec:** [`docs/superpowers/specs/2026-07-26-tenant-credential-vault-design.md`](../specs/2026-07-26-tenant-credential-vault-design.md). Read it before Task 1.

## Global Constraints

- **English throughout** — identifiers, table and column names alike. `packages/credentials` is a generic package and must be registered in `GENERIC_PACKAGES` (Task 1), or the guard silently does not apply to it.
- **This package must never import `@waitron/payments`, `@waitron/fiscal`, `@waitron/fiscal-verifactu`, `@waitron/verifactu` or `@waitron/core`.** It stores opaque payloads; purpose field lists are string data, never imports.
- **Errors are structured codes with structured params — never prose, never English sentences meant for a user.** Codes are lowercase and dot-namespaced by domain concept (`credentials.*`), contributed by declaration merging on `@waitron/shared`'s `ErrorParams`.
- **Never log, print or include a decrypted credential value in an error, a message, or a test name.**
- **Real Postgres, never PGlite, for anything RLS-dependent.** PGlite runs every connection as a superuser and bypasses `FORCE ROW LEVEL SECURITY`. Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally — **never commit it**.
- **Mutation-test every guard before committing:** break the predicate, observe RED, restore, observe GREEN. A guard with no test that can fail is this project's most-found defect.
- **Run `pnpm -r test` (whole workspace), not just this package's gate**, at the end of any task touching a shared file. Task 1 edits `packages/db/src/english-only.ts`; a per-package gate cannot see what that breaks elsewhere.
- **Node ≥ 24; pnpm 9.15.0.** Package manifests use `"type": "module"` and `"main": "./src/index.ts"`.
- Commit after every task. Never bypass the pre-push hook.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/credentials/package.json` | manifest, scripts, `bin`, esbuild devDependency |
| `packages/credentials/tsconfig.json` | extends base; `include: ["src", "test"]` |
| `packages/credentials/vitest.config.ts` | timeouts, single fork, coverage thresholds |
| `packages/credentials/drizzle.config.ts` | own `out`, own journal table |
| `packages/credentials/drizzle/0000_credentials.sql` | generated: the table |
| `packages/credentials/drizzle/0001_credentials_rls.sql` | hand-written: FORCE RLS, policy, grants |
| `packages/credentials/drizzle/0002_credentials_tenant_seam.sql` | hand-written: role, permissive policy, `SECURITY DEFINER` function |
| `src/schema/tenant-credentials.ts` | the Drizzle table |
| `src/schema/index.ts` | the snapshot's export list |
| `src/migrations.ts` | `CREDENTIALS_MIGRATIONS` descriptor |
| `src/errors.ts` | `ErrorParams` augmentation for `credentials.*` |
| `src/keyring.ts` | env → `KeyRing`; key selection by version |
| `src/cipher.ts` | AAD construction, `seal`, `open` — pure, no database |
| `src/purposes.ts` | `PURPOSES` field lists, `isPurpose`, `validatePayload` |
| `src/store.ts` | get/tryGet/put/delete/list, `credentialTenants` |
| `src/cli.ts` | `runCli(argv, io, deps)` — parsing and dispatch, no process access |
| `src/bin.ts` | thin executable: reads `process.env`, connects, calls `runCli`, sets exit code |
| `src/index.ts` | the public barrel |
| `src/testing/postgres.ts` | Testcontainers helper |
| `test/seed.ts` | `seedTenant`, `freshNif` |

---

### Task 1: Package scaffold, table, migrations

**Files:**
- Create: `packages/credentials/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`
- Create: `packages/credentials/src/schema/tenant-credentials.ts`, `src/schema/index.ts`, `src/migrations.ts`
- Create: `packages/credentials/drizzle/0001_credentials_rls.sql`
- Create: `packages/credentials/test/seed.ts`
- Generate: `packages/credentials/drizzle/0000_credentials.sql`
- Modify: `packages/db/src/english-only.ts` (the `GENERIC_PACKAGES` list)
- Test: `src/schema-ownership.test.ts`, `src/migrations.test.ts`

**Interfaces:**
- Consumes: `tenants` from `@waitron/db` (foreign key only); `CORE_MIGRATIONS`, `runMigrations`, `createPgliteDb`, `captureError`, `pgErrorCode`, `pgErrorMessage` from `@waitron/db`.
- Produces: `tenantCredentials` (Drizzle table), `CREDENTIALS_MIGRATIONS = { migrationsFolder, migrationsTable: "__drizzle_migrations_credentials" }`, and `seedTenant(db) => Promise<TenantId>` / `freshNif()` for later tasks.

- [ ] **Step 1: Create the manifest**

`packages/credentials/package.json`:

```json
{
  "name": "@waitron/credentials",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "db:generate": "drizzle-kit generate",
    "db:generate:custom": "drizzle-kit generate --custom"
  },
  "dependencies": {
    "@waitron/db": "workspace:*",
    "@waitron/shared": "workspace:*",
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "@testcontainers/postgresql": "^12.0.4",
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "drizzle-kit": "^0.31.10",
    "fast-check": "^4.9.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig, vitest and drizzle configs**

`packages/credentials/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test", "drizzle.config.ts"]
}
```

`packages/credentials/vitest.config.ts`:

```typescript
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // PGlite boots a WASM PostgreSQL and applies two migration sets; the RLS suite additionally
    // pulls and starts a real Postgres container. Both costs are one-off, paid in a beforeAll.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, and this
    // package is small enough that a handful of mis-merged branches sinks the ratio. Same finding
    // as packages/payments and packages/scheduler.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        // The process entry point: argv, env, stdin, stdout and a real connection, and nothing
        // else. Every decision it could get wrong lives in `cli.ts`, which is injected and fully
        // tested; what remains here is the wiring that can only be exercised by running the built
        // bundle. Excluded on the same grounds as packages/payments-stripe's `stripe-client.ts` —
        // a thin boundary whose logic belongs to something else.
        "src/bin.ts",
        // Re-export barrels: manifests with no imperative code, on which v8 reports phantom
        // uncovered branches. Their surface is asserted structurally by index.test.ts and
        // schema-ownership.test.ts.
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

`packages/credentials/drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // One config produces exactly one migration folder, which is why this package needs its own
  // rather than an entry in core's. Same reasoning as packages/scheduler/drizzle.config.ts.
  out: "./drizzle",
  // Pointed at the entrypoint, NOT a `src/schema/*.ts` glob: drizzle-kit builds its snapshot from
  // the values this module exports, so the explicit export list IS the snapshot's table list.
  schema: "./src/schema/index.ts",
  // Its own journal table. Sharing core's would make each package's `generate` see the other's
  // applied migrations as unknown and silently re-apply its own from zero.
  migrations: { table: "__drizzle_migrations_credentials", schema: "public" },
});
```

- [ ] **Step 3: Write the schema**

`packages/credentials/src/schema/tenant-credentials.ts`:

```typescript
import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  integer,
  primaryKey,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/** `bytea` as a Node `Buffer` in both directions. drizzle-orm 0.45 ships no first-class bytea type,
 * and the alternative — text columns holding base64 — would put a second encoding between the
 * cipher and the row for no benefit. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * One tenant's credentials for one purpose, sealed. The payload is a JSON object of string fields
 * whose names this package validates but whose MEANING it never learns — `secretKey` is a string
 * here and a Stripe key only to the host that reads it. That is what keeps a deployment-data table
 * out of the adapters' way; see the design's §3.
 *
 * The row carries no plaintext at all, not even a field-name list: `ciphertext` covers the whole
 * JSON object, so an operator with SELECT on this table learns which tenants have Stripe
 * credentials and when they were last written, and nothing else.
 */
export const tenantCredentials = pgTable(
  "tenant_credentials",
  {
    tenantId: text("tenant_id").notNull(),
    /** A stable identifier, not a description: renaming a purpose orphans every row under the old
     * name. `PURPOSES` in ../purposes.ts is the authority on which values are legal. */
    purpose: text("purpose").notNull(),
    /** AES-256-GCM over the UTF-8 JSON payload, with the AAD bound to (tenant_id, purpose). */
    ciphertext: bytea("ciphertext").notNull(),
    /** 12 bytes, fresh per write. Never reused: GCM's security collapses if an (key, iv) pair
     * encrypts two different plaintexts. */
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    /** Which key ring member sealed THIS row. Reads select the key by this value rather than
     * assuming the current one, which is what lets a half-finished `rotate` keep serving both
     * halves instead of becoming an outage. */
    keyVersion: integer("key_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.purpose], name: "tenant_credentials_pk" }),
    // restrict, not cascade: deleting a tenant must not silently discard the material its
    // in-flight fiscal submissions authenticate with.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_credentials_tenant_fk",
    }).onDelete("restrict"),
    check("tenant_credentials_key_version_ck", sql`${t.keyVersion} >= 1`),
    // 12 bytes is the GCM standard nonce length, and the only length `cipher.ts` ever writes. A row
    // with a different length did not come from this code path.
    check("tenant_credentials_iv_len_ck", sql`octet_length(${t.iv}) = 12`),
    // 16 bytes is the full GCM tag. A truncated tag weakens forgery resistance, so the column
    // refuses one rather than trusting every future writer to pass the right option.
    check("tenant_credentials_auth_tag_len_ck", sql`octet_length(${t.authTag}) = 16`),
    check("tenant_credentials_purpose_ck", sql`length(${t.purpose}) > 0`),
  ],
).enableRLS();
```

Note `tenantId` is `text`, not `uuid`, so that `TenantId` (a branded string) crosses without a cast; the foreign key to `tenants.id` still applies because Postgres compares `text` to `uuid` through the FK's own type resolution. **If `drizzle-kit generate` or the migration test rejects the mixed-type foreign key, change the column to `uuid("tenant_id")` and brand at the boundary in `store.ts` instead** — `packages/scheduler`'s `scheduled_runs.tenant_id` is `uuid`, and matching it is the safer default.

`packages/credentials/src/schema/index.ts`:

```typescript
// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table. The schema file imports `tenants` to declare a foreign
// key; it must NEVER be re-exported, or it lands in this package's snapshot as a duplicate CREATE
// TABLE that fails at apply time. `schema-ownership.test.ts` enforces this.
export { tenantCredentials } from "./tenant-credentials.js";
```

- [ ] **Step 4: Write the migration descriptor**

`packages/credentials/src/migrations.ts`:

```typescript
import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data rather than a function because ordering across
 * packages is the RUNTIME's responsibility — core migrations must run before these (the `tenants`
 * foreign key) — and a descriptor makes the caller state that order out loud.
 */
export const CREDENTIALS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_credentials",
} as const;
```

- [ ] **Step 5: Install and generate the table migration**

```bash
pnpm install
pnpm --filter @waitron/credentials exec drizzle-kit generate --name credentials
```

Expected: `packages/credentials/drizzle/0000_credentials.sql` containing `CREATE TABLE "tenant_credentials"` and **no** `CREATE TABLE "tenants"`. Open it and confirm both before continuing.

- [ ] **Step 6: Hand-write the RLS migration**

`packages/credentials/drizzle/0001_credentials_rls.sql`:

```sql
-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- packages/scheduler's 0001_scheduler_rls.sql: drizzle-kit has no concept of policies, FORCE, or
-- privileges. current_tenant_id() already exists (packages/db 0001_tenancy_rls.sql; core runs first).

--> statement-breakpoint
ALTER TABLE "tenant_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tenant_credentials_tenant_isolation" ON "tenant_credentials"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- DELETE is granted, unlike scheduled_runs: `waitron-credentials delete` de-provisions a tenant,
-- and a credential row is live configuration rather than an audit trail.
REVOKE ALL ON "tenant_credentials" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_credentials" TO app_user;
```

Create it with `pnpm --filter @waitron/credentials exec drizzle-kit generate --custom --name credentials_rls` so drizzle writes the snapshot alongside it, then replace the generated file's body with the SQL above.

- [ ] **Step 7: Write the seed helper**

`packages/credentials/test/seed.ts`:

```typescript
import { sql } from "drizzle-orm";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";

// Tenants accumulate for the life of a suite (nothing truncates `tenants`), so every seeded tenant
// needs its own NIF or collides on `tenants_nif_key`.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(30_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Seeds one tenant and returns its id. Run as the connection owner (superuser) — RLS is bypassed,
 * so this is pure setup. */
export async function seedTenant(db: Database): Promise<TenantId> {
  const result = await db.execute<{ id: string }>(sql`
    insert into tenants (nif, legal_name) values (${freshNif()}, 'Test SL') returning id`);
  return brandTenantId(result.rows[0]!.id);
}
```

- [ ] **Step 8: Write the failing schema-ownership test**

`packages/credentials/src/schema-ownership.test.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = ["tenant_credentials"];

/** Every core table this package's schema files import to declare foreign keys. None of these may
 * ever appear in this package's generated SQL. */
const CORE = ["tenants"];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function generatedSql(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n")
    .toLowerCase();
}

describe("the credentials schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    const exported = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("emits no CREATE TABLE for a core table", () => {
    const sqlText = generatedSql();
    for (const table of CORE) {
      expect(sqlText).not.toContain(`create table "${table}"`);
    }
  });

  it("emits a CREATE TABLE for every table it owns", () => {
    const sqlText = generatedSql();
    for (const table of OWNED) {
      expect(sqlText).toContain(`create table "${table}"`);
    }
  });
});
```

- [ ] **Step 9: Write the failing migrations test**

`packages/credentials/src/migrations.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  createPgliteDb,
  pgErrorCode,
  pgErrorMessage,
  runMigrations,
  type Database,
} from "@waitron/db";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { seedTenant } from "../test/seed.js";

let db: Database;
let tenantId: string;

beforeAll(async () => {
  db = await createPgliteDb();
  // Core first — the tenants foreign key. Ordering across packages is the runtime's job and
  // nothing enforces it, so it is explicit here.
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
  tenantId = await seedTenant(db);
});

afterAll(async () => {
  await db.close();
});

/** A well-formed row body, so each test below varies exactly one thing. */
const OK = {
  ciphertext: Buffer.from("sealed"),
  iv: Buffer.alloc(12, 1),
  authTag: Buffer.alloc(16, 2),
};

describe("the credentials migration set", () => {
  it("creates tenant_credentials with row-level security forced", async () => {
    const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
      select relrowsecurity, relforcerowsecurity
        from pg_class where relname = 'tenant_credentials'`);
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("stores and returns a row round-trip", async () => {
    await db.execute(sql`
      insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
      values (${tenantId}, 'round.trip', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`);
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials
      where tenant_id = ${tenantId} and purpose = 'round.trip'`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects a second row for the same (tenant, purpose)", async () => {
    await db.execute(sql`
      insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
      values (${tenantId}, 'dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`);
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23505"); // unique_violation
  });

  it("rejects a key_version below 1", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.version', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 0)`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_key_version_ck/);
  });

  it("rejects an iv that is not 12 bytes", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.iv', ${OK.ciphertext}, ${Buffer.alloc(8, 1)}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_iv_len_ck/);
  });

  it("rejects a truncated auth tag", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.tag', ${OK.ciphertext}, ${OK.iv}, ${Buffer.alloc(12, 2)}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_auth_tag_len_ck/);
  });

  it("rejects a row whose tenant does not exist", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (gen_random_uuid(), 'orphan', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
  });
});
```

- [ ] **Step 10: Run both tests to verify they pass**

Run: `pnpm --filter @waitron/credentials test`
Expected: PASS. If the mixed `text`/`uuid` foreign key fails at migration time, apply the fallback noted in Step 3 (make the column `uuid`), regenerate, and rerun.

- [ ] **Step 11: Register the package with the english-only guard**

Modify `packages/db/src/english-only.ts` — add `"credentials"` to `GENERIC_PACKAGES`:

```typescript
export const GENERIC_PACKAGES = [
  "db",
  "core",
  "fiscal",
  "shared",
  "payments",
  "scheduler",
  "credentials",
] as const;
```

- [ ] **Step 12: Run the whole workspace**

Run: `pnpm -r test`
Expected: PASS everywhere. This step exists because the last cycle's identical edit broke `packages/fiscal-verifactu` — a pinned source-text regex over `GENERIC_PACKAGES` — and it sat red for six tasks because only per-package gates were run. If something fails here, fix it in this task.

- [ ] **Step 13: Commit**

```bash
git add packages/credentials packages/db/src/english-only.ts pnpm-lock.yaml
git commit -m "feat(credentials): the tenant_credentials table and its migration set"
```

---

### Task 2: Errors and the cipher

**Files:**
- Create: `packages/credentials/src/errors.ts`, `src/keyring.ts`, `src/cipher.ts`
- Test: `src/errors.reachability.test.ts`, `src/keyring.test.ts`, `src/cipher.test.ts`

**Interfaces:**
- Consumes: `AppError`, `isAppError` from `@waitron/shared`.
- Produces:
  - `interface KeyEntry { key: Buffer; version: number }`
  - `interface KeyRing { current: KeyEntry; previous?: KeyEntry }`
  - `loadKeyRing(env: Record<string, string | undefined>): KeyRing`
  - `keyForVersion(ring: KeyRing, version: number): Buffer | null`
  - `interface Sealed { ciphertext: Buffer; iv: Buffer; authTag: Buffer }`
  - `aadFor(tenantId: string, purpose: string): Buffer`
  - `seal(key: Buffer, aad: Buffer, plaintext: string): Sealed`
  - `open(key: Buffer, aad: Buffer, sealed: Sealed): string | null` — **null means authentication failed**, never a throw.

- [ ] **Step 1: Write the error-code augmentation**

`packages/credentials/src/errors.ts`:

```typescript
// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/core/src/errors.ts and packages/payments/src/errors.ts use.
import "@waitron/shared";

/**
 * packages/credentials's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention (`credentials.*`), never the package name.
 *
 * NO PARAM HERE EVER CARRIES A DECRYPTED VALUE. These are structured codes a display layer
 * localises; a credential's plaintext must not reach a log line, a stack trace, or a test name.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The current-key environment variable is absent or empty. */
    "credentials.key_missing": { variable: string };
    /** Present but not 32 bytes once base64-decoded. `byteLength` is the decoded length — a size,
     * never key material. */
    "credentials.key_invalid": { variable: string; byteLength: number };
    /** A `_PREVIOUS` key was supplied without its version, or vice versa. Both or neither. */
    "credentials.key_ring_incomplete": { supplied: string; missing: string };
    /** A version number that is not a positive integer. */
    "credentials.key_version_invalid": { variable: string; value: string };
    /** A row was sealed by a key version the ring does not carry — the operator retired a key while
     * rows still referenced it. Recoverable: put the key back and re-run `rotate`. */
    "credentials.key_version_unknown": { tenantId: string; purpose: string; keyVersion: number };
    /** GCM authentication failed: the wrong key, a tampered ciphertext, or a row moved between
     * (tenant, purpose) pairs. The three are indistinguishable by design — an oracle that told them
     * apart would be a gift to whoever caused it. */
    "credentials.decrypt_failed": { tenantId: string; purpose: string };
    /** No row for this (tenant, purpose). Either never provisioned, or RLS hid another tenant's
     * row — identical from here. */
    "credentials.missing": { tenantId: string; purpose: string };
    /** Not a purpose this package knows. `known` lets a CLI print the legal set. */
    "credentials.unknown_purpose": { purpose: string; known: string[] };
    /** The payload's field names do not exactly match the purpose's. Both lists are FIELD NAMES,
     * never values. */
    "credentials.invalid_payload": { purpose: string; missing: string[]; unexpected: string[] };
    /** A field is present but empty, or not a string. Names only. */
    "credentials.invalid_field": { purpose: string; field: string };
  }
}
```

- [ ] **Step 2: Write the failing reachability test**

`packages/credentials/src/errors.reachability.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import * as barrel from "./index.js";

/** The augmentation is only real if it is reachable from the public barrel — a declaration in a
 * file nothing imports type-checks locally and vanishes for every consumer. Mirrors
 * packages/payments/src/errors.reachability.test.ts. */
describe("the credentials error codes reach the public barrel", () => {
  it("constructs a credentials.* AppError with typed params", () => {
    const error = new AppError("credentials.missing", { tenantId: "t", purpose: "p" });
    expect(error.code).toBe("credentials.missing");
    expect(error.params).toEqual({ tenantId: "t", purpose: "p" });
  });

  it("re-exports something, so the barrel is genuinely loaded", () => {
    expect(Object.keys(barrel).length).toBeGreaterThan(0);
  });
});
```

This test will not compile until Task 7 creates `src/index.ts`. **Create a minimal `src/index.ts` now** containing only `export { CREDENTIALS_MIGRATIONS } from "./migrations.js";` and `import "./errors.js";`, and grow it in Task 7.

- [ ] **Step 3: Write the failing key-ring test**

`packages/credentials/src/keyring.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hasCode } from "@waitron/shared";
import { keyForVersion, loadKeyRing } from "./keyring.js";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");

describe("loadKeyRing", () => {
  it("reads the current key and defaults its version to 1", () => {
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1 });
    expect(ring.current.version).toBe(1);
    expect(ring.current.key.equals(Buffer.alloc(32, 1))).toBe(true);
    expect(ring.previous).toBeUndefined();
  });

  it("reads an explicit current version", () => {
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "7" });
    expect(ring.current.version).toBe(7);
  });

  it("reads a previous key alongside the current one", () => {
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    expect(ring.previous?.version).toBe(1);
    expect(ring.previous?.key.equals(Buffer.alloc(32, 1))).toBe(true);
  });

  it("rejects a missing current key", () => {
    const error = captured(() => loadKeyRing({}));
    expect(hasCode(error, "credentials.key_missing")).toBe(true);
  });

  it("rejects an empty current key", () => {
    const error = captured(() => loadKeyRing({ WAITRON_CREDENTIALS_KEY: "" }));
    expect(hasCode(error, "credentials.key_missing")).toBe(true);
  });

  it("rejects a key that is not 32 bytes", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(16, 1).toString("base64") }),
    );
    expect(hasCode(error, "credentials.key_invalid")).toBe(true);
  });

  it("rejects a previous key with no version", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: K2, WAITRON_CREDENTIALS_KEY_PREVIOUS: K1 }),
    );
    expect(hasCode(error, "credentials.key_ring_incomplete")).toBe(true);
  });

  it("rejects a non-integer version", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1.5" }),
    );
    expect(hasCode(error, "credentials.key_version_invalid")).toBe(true);
  });

  it("rejects a version below 1, matching the column's own CHECK", () => {
    const error = captured(() =>
      loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "0" }),
    );
    expect(hasCode(error, "credentials.key_version_invalid")).toBe(true);
  });

  it("refuses a ring whose two members share a version", () => {
    // Otherwise keyForVersion's answer depends on lookup order, and a rotate that never changed
    // the version would silently "succeed" while re-sealing every row with the same key.
    const error = captured(() =>
      loadKeyRing({
        WAITRON_CREDENTIALS_KEY: K2,
        WAITRON_CREDENTIALS_KEY_VERSION: "3",
        WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
        WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "3",
      }),
    );
    expect(hasCode(error, "credentials.key_ring_incomplete")).toBe(true);
  });
});

describe("keyForVersion", () => {
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: K2,
    WAITRON_CREDENTIALS_KEY_VERSION: "2",
    WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
    WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
  });

  it("selects the current key by its version", () => {
    expect(keyForVersion(ring, 2)?.equals(Buffer.alloc(32, 2))).toBe(true);
  });

  it("selects the previous key by its version — the interrupted-rotate case", () => {
    expect(keyForVersion(ring, 1)?.equals(Buffer.alloc(32, 1))).toBe(true);
  });

  it("returns null for a version the ring does not carry", () => {
    expect(keyForVersion(ring, 99)).toBeNull();
  });
});

function captured(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, and it did not");
}
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @waitron/credentials test keyring`
Expected: FAIL — `Cannot find module './keyring.js'`.

- [ ] **Step 5: Implement the key ring**

`packages/credentials/src/keyring.ts`:

```typescript
import { AppError } from "@waitron/shared";
import "./errors.js";

const KEY_BYTES = 32;
const CURRENT = "WAITRON_CREDENTIALS_KEY";
const CURRENT_VERSION = "WAITRON_CREDENTIALS_KEY_VERSION";
const PREVIOUS = "WAITRON_CREDENTIALS_KEY_PREVIOUS";
const PREVIOUS_VERSION = "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION";

export interface KeyEntry {
  key: Buffer;
  version: number;
}

/** The keys this process can decrypt with. `previous` is present only during a rotation window. */
export interface KeyRing {
  current: KeyEntry;
  previous?: KeyEntry;
}

/**
 * Reads and VALIDATES the ring once, from an environment-shaped record rather than `process.env`
 * directly, so tests need no global mutation and the host can pass whatever it loaded config from.
 *
 * Everything that can be wrong with a key is wrong HERE, loudly, rather than at the first decrypt
 * of the first credential at three in the morning.
 */
export function loadKeyRing(env: Record<string, string | undefined>): KeyRing {
  const current: KeyEntry = {
    key: readKey(env, CURRENT),
    version: readVersion(env, CURRENT_VERSION, 1),
  };

  const previousRaw = env[PREVIOUS];
  const previousVersionRaw = env[PREVIOUS_VERSION];
  if (previousRaw === undefined && previousVersionRaw === undefined) return { current };
  // Both or neither: a key with no version cannot be matched to a row, and a version with no key
  // cannot decrypt one. Either alone is a half-finished rotation setup, and failing now beats
  // discovering it when a row on the old version is read.
  if (previousRaw === undefined || previousVersionRaw === undefined) {
    throw new AppError("credentials.key_ring_incomplete", {
      supplied: previousRaw === undefined ? PREVIOUS_VERSION : PREVIOUS,
      missing: previousRaw === undefined ? PREVIOUS : PREVIOUS_VERSION,
    });
  }

  const previous: KeyEntry = {
    key: readKey(env, PREVIOUS),
    version: readVersion(env, PREVIOUS_VERSION, null),
  };
  // Two members sharing a version makes `keyForVersion` order-dependent, and lets a `rotate` that
  // forgot to bump the version re-seal every row with the same key while reporting success.
  if (previous.version === current.version) {
    throw new AppError("credentials.key_ring_incomplete", {
      supplied: PREVIOUS_VERSION,
      missing: CURRENT_VERSION,
    });
  }
  return { current, previous };
}

/** The key that sealed a row on `version`, or null when the ring no longer carries it. Null rather
 * than a throw: the store owns the error, because only it knows which (tenant, purpose) failed. */
export function keyForVersion(ring: KeyRing, version: number): Buffer | null {
  if (ring.current.version === version) return ring.current.key;
  if (ring.previous?.version === version) return ring.previous.key;
  return null;
}

function readKey(env: Record<string, string | undefined>, variable: string): Buffer {
  const raw = env[variable];
  if (raw === undefined || raw === "") throw new AppError("credentials.key_missing", { variable });
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new AppError("credentials.key_invalid", { variable, byteLength: key.length });
  }
  return key;
}

/** `fallback` null means the variable is required. */
function readVersion(
  env: Record<string, string | undefined>,
  variable: string,
  fallback: number | null,
): number {
  const raw = env[variable];
  if (raw === undefined || raw === "") {
    if (fallback !== null) return fallback;
    throw new AppError("credentials.key_version_invalid", { variable, value: "" });
  }
  const value = Number(raw);
  // Number("") is 0 and Number("1.5") is 1.5, so both a blank and a fractional version must be
  // rejected explicitly — parseInt would silently accept "1.5" as 1 and "1abc" as 1.
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError("credentials.key_version_invalid", { variable, value: raw });
  }
  return value;
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @waitron/credentials test keyring`
Expected: PASS.

- [ ] **Step 7: Write the failing cipher test**

`packages/credentials/src/cipher.test.ts`:

```typescript
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aadFor, open, seal } from "./cipher.js";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

describe("seal and open", () => {
  it("round-trips a payload", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    const sealed = seal(KEY, aad, '{"secretKey":"sk_test"}');
    expect(open(KEY, aad, sealed)).toBe('{"secretKey":"sk_test"}');
  });

  it("uses a fresh iv per write, so the same plaintext never seals identically", () => {
    // GCM's security collapses if one (key, iv) pair encrypts two different plaintexts. A constant
    // iv would pass every other test in this file.
    const aad = aadFor(TENANT, "payments.stripe");
    const a = seal(KEY, aad, "same");
    const b = seal(KEY, aad, "same");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("emits a 12-byte iv and a 16-byte tag, matching the column CHECKs", () => {
    const sealed = seal(KEY, aadFor(TENANT, "p"), "x");
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.authTag).toHaveLength(16);
  });

  it("returns null for the wrong key", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    expect(open(OTHER_KEY, aad, seal(KEY, aad, "x"))).toBeNull();
  });

  it("returns null for a tampered ciphertext", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    const sealed = seal(KEY, aad, "x");
    sealed.ciphertext[0] ^= 0xff;
    expect(open(KEY, aad, sealed)).toBeNull();
  });

  it("returns null for a tampered auth tag", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    const sealed = seal(KEY, aad, "x");
    sealed.authTag[0] ^= 0xff;
    expect(open(KEY, aad, sealed)).toBeNull();
  });

  // THE TEETH TEST. This is the entire reason the AAD exists: without it, someone with write
  // access to the database moves tenant B's sealed Stripe credentials into tenant A's row and
  // tenant A silently starts settling against tenant B's account. Deleting the two setAAD calls in
  // cipher.ts must turn THIS red — verify that by hand before committing.
  it("refuses a ciphertext moved to a different tenant", () => {
    const sealed = seal(KEY, aadFor(TENANT, "payments.stripe"), '{"secretKey":"sk_b"}');
    expect(open(KEY, aadFor(OTHER_TENANT, "payments.stripe"), sealed)).toBeNull();
  });

  it("refuses a ciphertext moved to a different purpose", () => {
    const sealed = seal(KEY, aadFor(TENANT, "payments.stripe"), "x");
    expect(open(KEY, aadFor(TENANT, "fiscal.aeat"), sealed)).toBeNull();
  });
});

describe("aadFor", () => {
  it("distinguishes splits that would otherwise concatenate identically", () => {
    // Without a separator, ("ab","c") and ("a","bc") both produce "abc" and seal interchangeably.
    // Tenant ids are fixed-length uuids today, so this can only bite a future caller — which is
    // exactly when nobody will remember to check.
    expect(aadFor("ab", "c").equals(aadFor("a", "bc"))).toBe(false);
  });
});

describe("the seal/open property", () => {
  it("round-trips any payload under any (tenant, purpose)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (tenant, purpose, plaintext) => {
        const aad = aadFor(tenant, purpose);
        return open(KEY, aad, seal(KEY, aad, plaintext)) === plaintext;
      }),
    );
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @waitron/credentials test cipher`
Expected: FAIL — `Cannot find module './cipher.js'`.

- [ ] **Step 9: Implement the cipher**

`packages/credentials/src/cipher.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
/** GCM's standard nonce length, and the value `tenant_credentials_iv_len_ck` enforces. */
const IV_BYTES = 12;

/** What one write produces and one read consumes. Three columns, no encoding in between. */
export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * The additional authenticated data: the row's own identity. GCM covers it by the auth tag without
 * storing it, so a ciphertext only opens under the exact (tenant, purpose) it was sealed for — the
 * moved-row attack in cipher.test.ts.
 *
 * The NUL separator is not decoration. Without it `aadFor("ab", "c")` and `aadFor("a", "bc")` are
 * the same bytes, and two rows would seal interchangeably. Tenant ids are fixed-length uuids today,
 * so this only matters to a future caller — which is when nobody is looking for it.
 */
export function aadFor(tenantId: string, purpose: string): Buffer {
  return Buffer.from(`${tenantId}\0${purpose}`, "utf8");
}

export function seal(key: Buffer, aad: Buffer, plaintext: string): Sealed {
  // Fresh per call, never derived from the row: reusing an (key, iv) pair across two different
  // plaintexts breaks GCM outright — not merely weakens it.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/**
 * Null — never a throw, and never a reason — when authentication fails. The wrong key, a tampered
 * ciphertext and a row moved between (tenant, purpose) pairs are indistinguishable here on purpose:
 * an error that told them apart would be an oracle for whoever caused it. The store turns the null
 * into `credentials.decrypt_failed`, because only the store knows which row it was.
 */
export function open(key: Buffer, aad: Buffer, sealed: Sealed): string | null {
  // EVERY call is inside the try, setup included. `createDecipheriv` throws on a wrong-length key,
  // and `setAuthTag` throws on any tag that is not 16 bytes — so leaving them outside would let a
  // tampered ROW escape as a raw, untranslatable Node crypto string instead of returning null. The
  // column CHECKs and `loadKeyRing` mean this package's own callers cannot reach that, but this
  // file exists to defend against someone with database write access, who is not bound by them.
  try {
    const decipher = createDecipheriv(ALGORITHM, key, sealed.iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.authTag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Two distinct failure shapes collapse here: `final()` throwing "Unsupported state or unable to
    // authenticate data" on a genuine tag mismatch, and the setup calls throwing on a malformed
    // iv/tag/key length. Both mean one thing to a caller — "this did not open" — and telling them
    // apart would itself be an oracle for whoever caused it.
    return null;
  }
}
```

- [ ] **Step 10: Run to verify it passes**

Run: `pnpm --filter @waitron/credentials test`
Expected: PASS (cipher, keyring, reachability, plus Task 1's suites).

- [ ] **Step 11: Mutation-test the guards by hand**

For each of these, make the edit, run `pnpm --filter @waitron/credentials test`, confirm RED, then revert and confirm GREEN:

1. Delete both `setAAD` calls in `cipher.ts` → the two "moved ciphertext" tests must fail.
2. Replace `randomBytes(IV_BYTES)` with `Buffer.alloc(IV_BYTES, 0)` → the fresh-iv test must fail.
3. Change `value < 1` to `value < 0` in `keyring.ts` → the version-below-1 test must fail.
4. Delete the `previous.version === current.version` check → the shared-version test must fail.

If any stays green, the test is not testing what it claims and must be fixed before committing.

- [ ] **Step 12: Commit**

```bash
git add packages/credentials
git commit -m "feat(credentials): AES-256-GCM seal/open with the AAD bound to (tenant, purpose)"
```

---

### Task 3: Purposes and the store's read/write path

**Files:**
- Create: `packages/credentials/src/purposes.ts`, `src/store.ts`
- Test: `src/purposes.test.ts`, `src/store.test.ts`

**Interfaces:**
- Consumes: `KeyRing`, `keyForVersion` (Task 2); `Sealed`, `aadFor`, `seal`, `open` (Task 2); `tenantCredentials` (Task 1); `withTenant`, `Transaction`, `Database` from `@waitron/db`; `TenantId` from `@waitron/shared`.
- Produces:
  - `PURPOSES: Record<string, readonly string[]>`, `type Purpose`, `isPurpose(v: string): v is Purpose`, `validatePayload(purpose: Purpose, value: Record<string, unknown>): asserts value is Record<string, string>`
  - `getCredential(tx, ring, { tenantId, purpose }): Promise<Record<string, string>>`
  - `tryGetCredential(tx, ring, { tenantId, purpose }): Promise<Record<string, string> | null>`
  - `putCredential(tx, ring, { tenantId, purpose, value }): Promise<void>`
  - `deleteCredential(tx, { tenantId, purpose }): Promise<boolean>`
  - `listCredentials(tx): Promise<CredentialMeta[]>` where `interface CredentialMeta { tenantId: TenantId; purpose: string; keyVersion: number; updatedAt: string }`

- [ ] **Step 1: Write the failing purposes test**

`packages/credentials/src/purposes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hasCode } from "@waitron/shared";
import { PURPOSES, isPurpose, validatePayload } from "./purposes.js";

describe("PURPOSES", () => {
  it("declares the two purposes the host needs", () => {
    expect(Object.keys(PURPOSES).sort()).toEqual(["fiscal.aeat", "payments.stripe"]);
  });

  it("names every field the Stripe hosted client is constructed from", () => {
    // stripeHostedClient(stripe, { successUrl, cancelUrl, webhookSecret }) plus the secret key the
    // Stripe SDK itself needs. If that constructor grows a field, this list and this test change
    // together.
    expect([...PURPOSES["payments.stripe"]].sort()).toEqual([
      "cancelUrl",
      "secretKey",
      "successUrl",
      "webhookSecret",
    ]);
  });
});

describe("isPurpose", () => {
  it("accepts a known purpose", () => {
    expect(isPurpose("payments.stripe")).toBe(true);
  });

  it("rejects an unknown one", () => {
    expect(isPurpose("payments.adyen")).toBe(false);
  });
});

describe("validatePayload", () => {
  const ok = {
    secretKey: "sk_test_x",
    webhookSecret: "whsec_x",
    successUrl: "https://example.test/ok",
    cancelUrl: "https://example.test/no",
  };

  it("accepts an exact field match", () => {
    expect(() => validatePayload("payments.stripe", { ...ok })).not.toThrow();
  });

  it("rejects a missing field", () => {
    const { webhookSecret: _omitted, ...partial } = ok;
    const error = captured(() => validatePayload("payments.stripe", partial));
    expect(hasCode(error, "credentials.invalid_payload")).toBe(true);
  });

  it("rejects an unexpected field, which is how a typo surfaces", () => {
    // A mistyped `webhook_secret` reads as BOTH a missing `webhookSecret` and an unexpected
    // `webhook_secret`. Accepting extras would report only the former and leave the operator
    // hunting a value they believe they set.
    const error = captured(() =>
      validatePayload("payments.stripe", { ...ok, webhook_secret: "whsec_x" }),
    );
    expect(hasCode(error, "credentials.invalid_payload")).toBe(true);
  });

  it("rejects an empty value", () => {
    const error = captured(() => validatePayload("payments.stripe", { ...ok, secretKey: "" }));
    expect(hasCode(error, "credentials.invalid_field")).toBe(true);
  });

  it("rejects a non-string value", () => {
    const error = captured(() => validatePayload("payments.stripe", { ...ok, secretKey: 42 }));
    expect(hasCode(error, "credentials.invalid_field")).toBe(true);
  });

  it("names no VALUE in the error it raises", () => {
    // The whole point: a validation failure must be diagnosable without ever printing a secret.
    const error = captured(() => validatePayload("payments.stripe", { ...ok, extra: "sk_live_OOPS" }));
    expect(JSON.stringify(error)).not.toContain("sk_live_OOPS");
  });
});

function captured(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, and it did not");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/credentials test purposes`
Expected: FAIL — `Cannot find module './purposes.js'`.

- [ ] **Step 3: Implement purposes**

`packages/credentials/src/purposes.ts`:

```typescript
import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * What each purpose's payload must contain — FIELD NAMES ONLY, as plain data. This is the one place
 * this package comes close to knowing about a provider, and the line it does not cross is an
 * import: `"secretKey"` is a string here, and a Stripe key only to the host that reads it. Nothing
 * in `@waitron/payments` or `@waitron/fiscal-verifactu` is referenced, so this package stays a leaf
 * (eslint enforces it) while still rejecting a typo at provisioning time rather than at 3am.
 *
 * `fiscal.aeat` is PROVISIONAL: whether an FNMT sello de entidad certificate can be exported for
 * unattended server use at all is unverified (getting-to-production.md §4). Because the payload is
 * an opaque blob, learning the real answer changes this list — not a migration.
 */
export const PURPOSES = {
  "payments.stripe": ["secretKey", "webhookSecret", "successUrl", "cancelUrl"],
  "fiscal.aeat": ["pfxBase64", "passphrase"],
} as const satisfies Record<string, readonly string[]>;

export type Purpose = keyof typeof PURPOSES;

export function isPurpose(value: string): value is Purpose {
  return Object.prototype.hasOwnProperty.call(PURPOSES, value);
}

/**
 * EXACT field match, both directions. Rejecting extras is not pedantry: a mistyped `webhook_secret`
 * shows up as a missing `webhookSecret` AND an unexpected `webhook_secret`, and an implementation
 * that only checked for missing fields would report half the truth to an operator who is certain
 * they set it.
 *
 * Every message this raises carries field NAMES and never values.
 */
export function validatePayload(
  purpose: Purpose,
  value: Record<string, unknown>,
): asserts value is Record<string, string> {
  const expected = PURPOSES[purpose] as readonly string[];
  const actual = Object.keys(value);
  const missing = expected.filter((f) => !actual.includes(f));
  const unexpected = actual.filter((f) => !expected.includes(f));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new AppError("credentials.invalid_payload", { purpose, missing, unexpected });
  }
  for (const field of expected) {
    const v = value[field];
    if (typeof v !== "string" || v === "") {
      throw new AppError("credentials.invalid_field", { purpose, field });
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/credentials test purposes`
Expected: PASS.

- [ ] **Step 5: Write the failing store test**

`packages/credentials/src/store.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  createPgliteDb,
  runMigrations,
  withTenant,
  type Database,
} from "@waitron/db";
import { hasCode } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { loadKeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import {
  deleteCredential,
  getCredential,
  listCredentials,
  putCredential,
  tryGetCredential,
} from "./store.js";
import { seedTenant } from "../test/seed.js";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");
const RING_V1 = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
const RING_V2_ONLY = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
});

const STRIPE = {
  secretKey: "sk_test_x",
  webhookSecret: "whsec_x",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
};

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
});

afterAll(async () => {
  await db.close();
});

/** A tenant per test. `store.test.ts` in packages/scheduler is an order-dependent chain over one
 * shared key and it bit during a later fix; this suite pays one insert per test to avoid that. */
async function freshTenant(): Promise<TenantId> {
  return seedTenant(db);
}

describe("putCredential and getCredential", () => {
  it("round-trips a payload through the database", async () => {
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const actual = await withTenant(db, tenantId, (tx) =>
      getCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(STRIPE);
  });

  it("stores no plaintext in the row", async () => {
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const rows = await db.execute<{ blob: string }>(sql`
      select encode(ciphertext, 'escape') as blob from tenant_credentials
      where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.blob).not.toContain("sk_test_x");
  });

  it("overwrites an existing purpose rather than failing on the primary key", async () => {
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const updated = { ...STRIPE, secretKey: "sk_test_rotated" };
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: updated }),
    );
    const actual = await withTenant(db, tenantId, (tx) =>
      getCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(updated);
  });

  it("stamps the ring's current key version", async () => {
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V2_ONLY, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const rows = await db.execute<{ key_version: number }>(sql`
      select key_version from tenant_credentials where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.key_version).toBe(2);
  });

  it("validates the payload before it ever reaches the database", async () => {
    const tenantId = await freshTenant();
    const error = await captured(() =>
      withTenant(db, tenantId, (tx) =>
        putCredential(tx, RING_V1, {
          tenantId,
          purpose: "payments.stripe",
          value: { secretKey: "sk_test_x" },
        }),
      ),
    );
    expect(hasCode(error, "credentials.invalid_payload")).toBe(true);
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("raises credentials.missing for a purpose that was never provisioned", async () => {
    const tenantId = await freshTenant();
    const error = await captured(() =>
      withTenant(db, tenantId, (tx) =>
        getCredential(tx, RING_V1, { tenantId, purpose: "fiscal.aeat" }),
      ),
    );
    expect(hasCode(error, "credentials.missing")).toBe(true);
  });

  it("raises credentials.decrypt_failed when the ring's key is wrong", async () => {
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    // Same VERSION, different key material — the operator replaced the key without rotating.
    const wrong = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K2, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
    const error = await captured(() =>
      withTenant(db, tenantId, (tx) =>
        getCredential(tx, wrong, { tenantId, purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);
  });

  it("raises credentials.key_version_unknown when the ring lost the row's key", async () => {
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const error = await captured(() =>
      withTenant(db, tenantId, (tx) =>
        getCredential(tx, RING_V2_ONLY, { tenantId, purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.key_version_unknown")).toBe(true);
  });

  it("serves a row on either ring member — the interrupted-rotate case", async () => {
    // The reason key_version is a column and not a constant. A rotate killed half-way leaves rows
    // on both versions, and the vault must keep serving both until it is re-run.
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const both = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, both, { tenantId, purpose: "fiscal.aeat", value: { pfxBase64: "AAAA", passphrase: "p" } }),
    );
    const onV1 = await withTenant(db, tenantId, (tx) =>
      getCredential(tx, both, { tenantId, purpose: "payments.stripe" }),
    );
    const onV2 = await withTenant(db, tenantId, (tx) =>
      getCredential(tx, both, { tenantId, purpose: "fiscal.aeat" }),
    );
    expect(onV1).toEqual(STRIPE);
    expect(onV2).toEqual({ pfxBase64: "AAAA", passphrase: "p" });
  });
});

describe("tryGetCredential", () => {
  it("returns null rather than throwing when nothing is provisioned", async () => {
    const tenantId = await freshTenant();
    const actual = await withTenant(db, tenantId, (tx) =>
      tryGetCredential(tx, RING_V1, { tenantId, purpose: "fiscal.aeat" }),
    );
    expect(actual).toBeNull();
  });
});

describe("deleteCredential", () => {
  it("removes the row and reports that it did", async () => {
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const deleted = await withTenant(db, tenantId, (tx) =>
      deleteCredential(tx, { tenantId, purpose: "payments.stripe" }),
    );
    expect(deleted).toBe(true);
    const after = await withTenant(db, tenantId, (tx) =>
      tryGetCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
    );
    expect(after).toBeNull();
  });

  it("reports false when there was nothing to delete", async () => {
    const tenantId = await freshTenant();
    const deleted = await withTenant(db, tenantId, (tx) =>
      deleteCredential(tx, { tenantId, purpose: "payments.stripe" }),
    );
    expect(deleted).toBe(false);
  });
});

describe("listCredentials", () => {
  it("returns metadata and never a value", async () => {
    const tenantId = await freshTenant();
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const rows = await withTenant(db, tenantId, (tx) => listCredentials(tx));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "payments.stripe", keyVersion: 1 });
    expect(JSON.stringify(rows)).not.toContain("sk_test_x");
  });
});

async function captured(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject, and it did not");
}
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @waitron/credentials test store`
Expected: FAIL — `Cannot find module './store.js'`.

- [ ] **Step 7: Implement the store**

`packages/credentials/src/store.ts`:

```typescript
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import { aadFor, open, seal } from "./cipher.js";
import { keyForVersion, type KeyRing } from "./keyring.js";
import { isPurpose, validatePayload, type Purpose } from "./purposes.js";
import { tenantCredentials } from "./schema/tenant-credentials.js";
import "./errors.js";

export interface CredentialRef {
  tenantId: TenantId;
  purpose: Purpose;
}

/** Everything `list` may reveal: which tenants hold which purposes, on which key, last written
 * when. Deliberately no value, and no field names either. */
export interface CredentialMeta {
  tenantId: TenantId;
  purpose: string;
  keyVersion: number;
  updatedAt: string;
}

/**
 * Reads and decrypts one credential. Runs inside `withTenant`, so RLS has already scoped the row;
 * `tenantId` is passed anyway because it is an AAD input, and because every other store function in
 * this repo names its tenant explicitly.
 */
export async function getCredential(
  tx: Transaction,
  ring: KeyRing,
  ref: CredentialRef,
): Promise<Record<string, string>> {
  const value = await tryGetCredential(tx, ring, ref);
  if (value === null) {
    throw new AppError("credentials.missing", { tenantId: ref.tenantId, purpose: ref.purpose });
  }
  return value;
}

/** Null ONLY when no row exists. A row that exists but cannot be decrypted throws — silently
 * treating an undecryptable credential as an absent one would let a host boot with a broken key
 * ring and fail later, somewhere else, for a reason nobody could trace back to here. */
export async function tryGetCredential(
  tx: Transaction,
  ring: KeyRing,
  ref: CredentialRef,
): Promise<Record<string, string> | null> {
  const [row] = await tx
    .select()
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenantId, ref.tenantId),
        eq(tenantCredentials.purpose, ref.purpose),
      ),
    );
  if (row === undefined) return null;

  // The ROW's version, never the ring's current one: that is what keeps a half-finished rotation
  // readable instead of an outage.
  const key = keyForVersion(ring, row.keyVersion);
  if (key === null) {
    throw new AppError("credentials.key_version_unknown", {
      tenantId: ref.tenantId,
      purpose: ref.purpose,
      keyVersion: row.keyVersion,
    });
  }

  const plaintext = open(key, aadFor(ref.tenantId, ref.purpose), {
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.authTag,
  });
  if (plaintext === null) {
    // Wrong key, tampered ciphertext, or a row moved between (tenant, purpose) pairs — one code for
    // all three, because distinguishing them would be an oracle. See cipher.ts's `open`.
    throw new AppError("credentials.decrypt_failed", {
      tenantId: ref.tenantId,
      purpose: ref.purpose,
    });
  }
  return JSON.parse(plaintext) as Record<string, string>;
}

/**
 * Seals and upserts. Validation runs BEFORE the write, so a rejected payload leaves no row.
 *
 * There is deliberately NO `isPurpose` check here: `purpose` is typed `Purpose`, so the only way to
 * reach this with an unknown one is from untyped input, and the one place that happens — the CLI —
 * validates at its own boundary. A defensive re-check would be a branch no test could turn red,
 * which is the dead surface this project's own rules reject.
 */
export async function putCredential(
  tx: Transaction,
  ring: KeyRing,
  params: { tenantId: TenantId; purpose: Purpose; value: Record<string, unknown> },
): Promise<void> {
  validatePayload(params.purpose, params.value);
  const sealed = seal(
    ring.current.key,
    aadFor(params.tenantId, params.purpose),
    JSON.stringify(params.value),
  );
  await tx
    .insert(tenantCredentials)
    .values({
      tenantId: params.tenantId,
      purpose: params.purpose,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      keyVersion: ring.current.version,
    })
    // Re-provisioning is the normal case — a rotated Stripe key, a renewed certificate — so an
    // upsert, not an insert that makes the caller delete first. `updated_at` is refreshed so
    // `list` reports when the material last changed.
    .onConflictDoUpdate({
      target: [tenantCredentials.tenantId, tenantCredentials.purpose],
      set: {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: ring.current.version,
        updatedAt: new Date().toISOString(),
      },
    });
}

/** True when a row was removed, false when there was none. A boolean rather than void so the CLI
 * can tell "de-provisioned" from "there was nothing there" — the same reason
 * `recordIncidentOnce` and `completeRun` report what they actually did. */
export async function deleteCredential(tx: Transaction, ref: CredentialRef): Promise<boolean> {
  const removed = await tx
    .delete(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenantId, ref.tenantId),
        eq(tenantCredentials.purpose, ref.purpose),
      ),
    )
    .returning({ purpose: tenantCredentials.purpose });
  return removed.length > 0;
}

/** Metadata for every row VISIBLE to this transaction — so inside `withTenant` it is one tenant's,
 * and the CLI's cross-tenant listing goes through `credentialTenants` instead. */
export async function listCredentials(tx: Transaction): Promise<CredentialMeta[]> {
  const rows = await tx
    .select({
      tenantId: tenantCredentials.tenantId,
      purpose: tenantCredentials.purpose,
      keyVersion: tenantCredentials.keyVersion,
      updatedAt: tenantCredentials.updatedAt,
    })
    .from(tenantCredentials);
  return rows as CredentialMeta[];
}
```

`isPurpose` is imported here for `rotateCredentials` (Task 6), not for `putCredential`. If Task 3's
`tsc --noEmit` flags it as unused before Task 6 lands, drop it from the import and add it back in
Task 6 — `noUnusedLocals` is on repo-wide.

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter @waitron/credentials test`
Expected: PASS.

- [ ] **Step 9: Mutation-test the guards**

Make each edit, run the suite, confirm RED, revert, confirm GREEN:

1. In `tryGetCredential`, replace `keyForVersion(ring, row.keyVersion)` with `ring.current.key` → the `key_version_unknown` and interrupted-rotate tests must fail.
2. In `tryGetCredential`, return `null` instead of throwing on `plaintext === null` → the `decrypt_failed` test must fail.
3. In `putCredential`, move `validatePayload` to after the insert → the "leaves no row" assertion must fail.
4. In `deleteCredential`, `return true` unconditionally → the "nothing to delete" test must fail.

- [ ] **Step 10: Commit**

```bash
git add packages/credentials
git commit -m "feat(credentials): the purpose registry and the sealed read/write path"
```

---

### Task 4: The cross-tenant enumeration seam, under real Postgres

**Files:**
- Create: `packages/credentials/drizzle/0002_credentials_tenant_seam.sql`
- Create: `packages/credentials/src/testing/postgres.ts`
- Modify: `packages/credentials/src/store.ts` (add `credentialTenants`)
- Test: `packages/credentials/src/credentials.rls.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `credentialTenants(db: Database, purpose: string): Promise<TenantId[]>` — untenanted, runs on the system connection, returns only tenant ids.

- [ ] **Step 1: Write the SECURITY DEFINER migration**

Create it with `pnpm --filter @waitron/credentials exec drizzle-kit generate --custom --name credentials_tenant_seam`, then replace the generated file's body:

```sql
-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no roles,
-- policies, SECURITY DEFINER functions or ownership, so none of this survives a later `generate`.
-- Adds no table/column; the accompanying snapshot is a byte-for-byte copy of the previous one.
--
-- WHAT THIS CLOSES. The host must ask "which tenants have credentials for purpose X" to build the
-- tenant list it hands to the scheduler — a question with no tenant context, asked before any
-- tenant is scoped. `tenant_credentials` carries FORCE ROW LEVEL SECURITY and its isolation policy
-- fails closed (current_tenant_id() is NULL with no `app.tenant_id` GUC), so that query returns
-- nothing under the non-superuser app_user role.
--
-- This is the THIRD instance of one pattern, and a deliberate clone rather than a new invention:
-- fiscal's envios_tenants_with_work (fiscal 0004) and payments' resolve_payment_tenant
-- (payments 0008). A dedicated NOLOGIN role + a per-role permissive SELECT policy + a SECURITY
-- DEFINER function owned by that role, returning ONLY tenant ids — never ciphertext, never an iv,
-- never a key version.
--
-- Deliberately NOT "grant a role BYPASSRLS": granting BYPASSRLS requires the grantor to already
-- hold it, which the hardened migration role does not.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'credentials_enumerator') THEN
    CREATE ROLE credentials_enumerator NOLOGIN NOSUPERUSER;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'credentials_enumerator' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'credentials_enumerator already exists with LOGIN — refusing to reuse it, since anyone who can authenticate as it would read every tenant''s sealed credentials';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO credentials_enumerator;--> statement-breakpoint
GRANT SELECT ON "tenant_credentials" TO credentials_enumerator;--> statement-breakpoint

-- Role-scoped bypass: visible only when the CURRENT role is credentials_enumerator, which nothing
-- but credential_tenants's SECURITY DEFINER context ever runs as. FOR SELECT only, and additive to
-- tenant_credentials_tenant_isolation (Postgres ORs permissive policies), so every other role's
-- isolation is unchanged.
CREATE POLICY "credentials_enumerator_lookup" ON "tenant_credentials"
  FOR SELECT
  TO credentials_enumerator
  USING (true);--> statement-breakpoint

-- Returns ONLY tenant ids. A wider return — even key_version — would leak one tenant's
-- provisioning state to every other, for no caller that needs it.
CREATE FUNCTION credential_tenants(p_purpose text)
  RETURNS SETOF text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT tenant_id
  FROM tenant_credentials
  WHERE purpose = p_purpose
  ORDER BY tenant_id
$$;--> statement-breakpoint

-- Reassign ownership to the NOLOGIN role via the temporary-grant dance (fiscal 0004 / payments 0008
-- document why it is required even for a CREATEROLE-holding non-superuser migration role). Both
-- grants are revoked immediately, so no standing privilege from this bootstrap survives.
GRANT CREATE ON SCHEMA public TO credentials_enumerator;--> statement-breakpoint
GRANT credentials_enumerator TO CURRENT_USER WITH INHERIT FALSE;--> statement-breakpoint
ALTER FUNCTION credential_tenants(text) OWNER TO credentials_enumerator;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM credentials_enumerator;--> statement-breakpoint
REVOKE credentials_enumerator FROM CURRENT_USER;--> statement-breakpoint

-- The application role calls the seam; the SECURITY DEFINER context does the crossing. EXECUTE is
-- named to app_user only; PUBLIC's default EXECUTE is revoked so no other role can invoke it.
REVOKE EXECUTE ON FUNCTION credential_tenants(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION credential_tenants(text) TO app_user;
```

**If `tenant_id` was changed to `uuid` in Task 1's fallback**, change `RETURNS SETOF text` to `RETURNS SETOF uuid` here and adjust the cast in Step 3.

- [ ] **Step 2: Write the Testcontainers helper**

`packages/credentials/src/testing/postgres.ts`:

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { CORE_MIGRATIONS, createPostgresDb, runMigrations, type Database } from "@waitron/db";
import { CREDENTIALS_MIGRATIONS } from "../migrations.js";

export interface RealPostgres {
  /** A fresh Database — its own pool, therefore its own backend process. */
  connect(): Promise<Database>;
  /** A fresh Database authenticated as `role`, which the caller must already have created. The
   * container's default user is a superuser and bypasses RLS, so `connect()` cannot exercise a
   * policy. */
  connectAs(role: string, password: string): Promise<Database>;
  stop(): Promise<void>;
}

/**
 * Starts a real PostgreSQL server and runs both migration sets against it, core first — ordering
 * across packages is the runtime's responsibility and nothing enforces it, so it is explicit here.
 */
export async function startRealPostgres(): Promise<RealPostgres> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
  } catch (cause) {
    // Never degrade to a skip. A suite that disappears when Docker is absent reports green while
    // asserting nothing, and PGlite's superuser bypasses FORCE ROW LEVEL SECURITY outright.
    throw new Error(
      "The credentials RLS suite requires a running Docker daemon. It cannot be skipped: PGlite " +
        "runs every connection as a superuser, which bypasses row-level security and cannot " +
        "exercise the SECURITY DEFINER seam this suite exists to verify.",
      { cause },
    );
  }

  const uri = container.getConnectionUri();
  const migrator = await createPostgresDb(uri);
  await runMigrations(migrator, CORE_MIGRATIONS);
  await runMigrations(migrator, CREDENTIALS_MIGRATIONS);
  await migrator.close();

  return {
    connect: () => createPostgresDb(uri),
    connectAs: (role, password) => {
      const u = new URL(uri);
      u.username = role;
      u.password = password;
      return createPostgresDb(u.toString());
    },
    stop: async () => {
      await container.stop();
    },
  };
}
```

- [ ] **Step 3: Add `credentialTenants` to the store**

Append to `packages/credentials/src/store.ts`:

```typescript
/**
 * Which tenants hold a credential for `purpose`. Runs on the SYSTEM connection, NOT inside
 * `withTenant`: it must see every tenant's rows to answer at all, which is a deliberately
 * cross-tenant read of a FORCE-RLS table. That crossing goes through `credential_tenants`
 * (migration 0002), a SECURITY DEFINER function owned by the NOLOGIN `credentials_enumerator` role,
 * which alone carries a permissive USING (true) SELECT policy. The function returns ONLY tenant ids.
 *
 * This is what gives the host its tenant list, and it has a property worth naming: a tenant with no
 * credential for a purpose is not enumerated for it, so the vault IS the enrolment list for that
 * duty — the host needs no separate notion of "which tenants are configured for Stripe".
 */
export async function credentialTenants(db: Database, purpose: string): Promise<TenantId[]> {
  const rows = await db.execute<{ tenant_id: string }>(sql`
    select credential_tenants(${purpose}) as tenant_id
  `);
  return rows.rows.map((r) => brandTenantId(r.tenant_id));
}
```

Add to the imports at the top of `store.ts`: `import { sql } from "drizzle-orm";` (extend the existing drizzle import), `import type { Database } from "@waitron/db";`, and `import { tenantId as brandTenantId } from "@waitron/shared";`.

- [ ] **Step 4: Write the failing RLS test**

`packages/credentials/src/credentials.rls.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import { loadKeyRing } from "./keyring.js";
import { credentialTenants, getCredential, listCredentials, putCredential } from "./store.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedTenant } from "../test/seed.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses FORCE ROW LEVEL SECURITY, which is why PGlite cannot prove
// any of this. The vault touches four privileges on tenant_credentials: SELECT, INSERT, UPDATE
// (the upsert) and DELETE. A missing grant on any one is invisible under PGlite.
const PROBE_ROLE = "credentials_rls_probe";
const PROBE_PASSWORD = "probe";

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const STRIPE = {
  secretKey: "sk_test_rls",
  webhookSecret: "whsec_rls",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
};

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`),
  );
});

// Guarded: a beforeAll failure must not be masked by a teardown that throws first, and the
// container must not leak. Deliberately NOT the unconditional afterAll the seven *.rls.test.ts
// files in packages/payments share.
afterAll(async () => {
  if (admin !== undefined) await admin.close();
  if (pg !== undefined) await pg.stop();
});

describe("the vault under real row-level security", () => {
  it("writes and reads its own tenant's credential as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        putCredential(tx, RING, { tenantId, purpose: "payments.stripe", value: STRIPE }),
      );
      const actual = await withTenant(probe, tenantId, (tx) =>
        getCredential(tx, RING, { tenantId, purpose: "payments.stripe" }),
      );
      expect(actual).toEqual(STRIPE);
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's credential", async () => {
    const mine = await seedTenant(admin);
    const theirs = await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        putCredential(tx, RING, { tenantId: theirs, purpose: "payments.stripe", value: STRIPE }),
      );

      // Read back as the superuser, which bypasses RLS: without this, a put that silently wrote
      // nothing would leave the table empty and the scoped read below would report 0 for the wrong
      // reason — hiding nothing is not the same as hiding something.
      const actual = await admin.execute<{ count: string }>(
        sql`select count(*) as count from tenant_credentials where tenant_id = ${theirs}`,
      );
      expect(actual.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) => listCredentials(tx));
      expect(visible).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    // The isolation policy fails closed: current_tenant_id() is NULL outside withTenant, so a bare
    // select sees zero rows however many exist. This is the property the SECURITY DEFINER seam
    // exists to work around, so it must be proven true first.
    await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from tenant_credentials`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("credentialTenants", () => {
  it("crosses tenants under the non-superuser role", async () => {
    const a = await seedTenant(admin);
    const b = await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      for (const tenantId of [a, b]) {
        await withTenant(probe, tenantId, (tx) =>
          putCredential(tx, RING, { tenantId, purpose: "fiscal.aeat", value: { pfxBase64: "AAAA", passphrase: "p" } }),
        );
      }
      const found = await credentialTenants(probe, "fiscal.aeat");
      expect(found).toEqual(expect.arrayContaining([a, b]));
    } finally {
      await probe.close();
    }
  });

  it("enumerates only tenants holding THAT purpose", async () => {
    const withStripe = await seedTenant(admin);
    const without = await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, withStripe, (tx) =>
        putCredential(tx, RING, {
          tenantId: withStripe,
          purpose: "payments.stripe",
          value: STRIPE,
        }),
      );
      const found = await credentialTenants(probe, "payments.stripe");
      expect(found).toContain(withStripe);
      expect(found).not.toContain(without);
    } finally {
      await probe.close();
    }
  });

  it("leaks nothing wider than a tenant id", async () => {
    // The function's whole justification is that its bypass surface is one identifier. If it ever
    // grew a ciphertext or key_version column, this is the test that should have stopped it.
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const described = await probe.execute<{ result_type: string }>(sql`
        select pg_get_function_result(oid) as result_type
        from pg_proc where proname = 'credential_tenants'`);
      expect(described.rows[0]!.result_type.toLowerCase()).toMatch(/setof (text|uuid)/);
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 5: Run it to verify it fails, then passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/credentials test credentials.rls`
Expected first: FAIL (function does not exist). After Steps 1–3 are all in place: PASS.

- [ ] **Step 6: Mutation-test the seam**

1. Drop the `GRANT EXECUTE … TO app_user` line from the migration, recreate the container → the `credentialTenants` tests must fail with a permission error.
2. Change the function's `WHERE purpose = p_purpose` to always-true → the "only that purpose" test must fail.

Revert both and confirm GREEN.

- [ ] **Step 7: Commit**

```bash
git add packages/credentials
git commit -m "feat(credentials): cross-tenant enumeration via a SECURITY DEFINER seam"
```

---

### Task 5: The CLI — set, list, delete

**Files:**
- Create: `packages/credentials/src/cli.ts`, `src/bin.ts`
- Modify: `packages/credentials/package.json` (add `bin`, `build` script, esbuild devDependency)
- Test: `packages/credentials/src/cli.test.ts`

**Interfaces:**
- Consumes: `loadKeyRing`, `PURPOSES`, `isPurpose`, `putCredential`, `deleteCredential`, `listCredentials`, `credentialTenants`.
- Produces:
  - `interface CliIo { stdout(line: string): void; stderr(line: string): void; readStdin(): Promise<string> }`
  - `interface CliDeps { db: Database; ring: KeyRing; io: CliIo; readFile(path: string): Promise<string> }`
  - `runCli(argv: string[], deps: CliDeps): Promise<number>` — returns the process exit code, never calls `process.exit`.

- [ ] **Step 1: Write the failing CLI test**

`packages/credentials/src/cli.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, type Database } from "@waitron/db";
import { runCli, type CliDeps } from "./cli.js";
import { loadKeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { seedTenant } from "../test/seed.js";

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const STRIPE_JSON = JSON.stringify({
  secretKey: "sk_test_cli",
  webhookSecret: "whsec_cli",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
});

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
});

afterAll(async () => {
  await db.close();
});

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
}

function harness(stdin = "", files: Record<string, string> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      db,
      ring: RING,
      io: {
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
        readStdin: () => Promise.resolve(stdin),
      },
      readFile: (path) => {
        const content = files[path];
        if (content === undefined) return Promise.reject(new Error(`no such file: ${path}`));
        return Promise.resolve(content);
      },
    },
  };
}

describe("waitron-credentials set", () => {
  it("provisions a credential from stdin", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(STRIPE_JSON);
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).toBe(0);
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("provisions from --file", async () => {
    const tenantId = await seedTenant(db);
    const h = harness("", { "/creds.json": STRIPE_JSON });
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe", "--file", "/creds.json"],
      h.deps,
    );
    expect(code).toBe(0);
  });

  it("NEVER accepts the payload as an argument", async () => {
    // The rule this test exists for: argv is world-readable in `ps` and lands in shell history. If
    // a --value flag is ever added, this must go red.
    const tenantId = await seedTenant(db);
    const h = harness("");
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe", "--value", STRIPE_JSON],
      h.deps,
    );
    expect(code).not.toBe(0);
  });

  it("rejects an unknown purpose and names the legal ones", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(STRIPE_JSON);
    const code = await runCli(["set", "--tenant", tenantId, "--purpose", "nope"], h.deps);
    expect(code).not.toBe(0);
    expect(h.err.join("\n")).toContain("payments.stripe");
  });

  it("rejects a payload with a typo'd field", async () => {
    const tenantId = await seedTenant(db);
    const h = harness(JSON.stringify({ secret_key: "x" }));
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
  });

  it("rejects malformed JSON without echoing what it read", async () => {
    const tenantId = await seedTenant(db);
    const h = harness("{not json, sk_live_LEAK");
    const code = await runCli(
      ["set", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
    expect([...h.out, ...h.err].join("\n")).not.toContain("sk_live_LEAK");
  });
});

describe("waitron-credentials list", () => {
  it("prints metadata and never a value", async () => {
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    const h = harness();
    const code = await runCli(["list", "--tenant", tenantId], h.deps);
    expect(code).toBe(0);
    const printed = h.out.join("\n");
    expect(printed).toContain("payments.stripe");
    expect(printed).not.toContain("sk_test_cli");
    expect(printed).not.toContain("whsec_cli");
  });
});

describe("waitron-credentials delete", () => {
  it("removes a provisioned credential", async () => {
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    const h = harness();
    expect(await runCli(["delete", "--tenant", tenantId, "--purpose", "payments.stripe"], h.deps)).toBe(0);
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("reports a non-zero code when there was nothing to delete", async () => {
    const tenantId = await seedTenant(db);
    const h = harness();
    const code = await runCli(
      ["delete", "--tenant", tenantId, "--purpose", "payments.stripe"],
      h.deps,
    );
    expect(code).not.toBe(0);
  });
});

describe("there is deliberately no `get` command", () => {
  it("refuses to print a decrypted credential", async () => {
    const tenantId = await seedTenant(db);
    const set = harness(STRIPE_JSON);
    await runCli(["set", "--tenant", tenantId, "--purpose", "payments.stripe"], set.deps);

    const h = harness();
    const code = await runCli(["get", "--tenant", tenantId, "--purpose", "payments.stripe"], h.deps);
    expect(code).not.toBe(0);
    expect(h.out.join("\n")).not.toContain("sk_test_cli");
  });
});

describe("unknown commands", () => {
  it("exits non-zero with usage", async () => {
    const h = harness();
    expect(await runCli(["wat"], h.deps)).not.toBe(0);
    expect(h.err.join("\n")).toContain("set");
  });

  it("exits non-zero with no command at all", async () => {
    const h = harness();
    expect(await runCli([], h.deps)).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/credentials test cli`
Expected: FAIL — `Cannot find module './cli.js'`.

- [ ] **Step 3: Implement the CLI**

`packages/credentials/src/cli.ts`:

```typescript
import { parseArgs } from "node:util";
import { withTenant, type Database } from "@waitron/db";
import { AppError, isAppError, tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { KeyRing } from "./keyring.js";
import { PURPOSES, isPurpose } from "./purposes.js";
import {
  credentialTenants,
  deleteCredential,
  listCredentials,
  putCredential,
} from "./store.js";

/** Everything the CLI does to the outside world, injected — so the tests need no process, no real
 * stdin and no temp files, and nothing here can print a secret behind the suite's back. */
export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
  readStdin(): Promise<string>;
}

export interface CliDeps {
  db: Database;
  ring: KeyRing;
  io: CliIo;
  readFile(path: string): Promise<string>;
}

const USAGE = [
  "usage: waitron-credentials <command> [options]",
  "",
  "  set    --tenant <uuid> --purpose <name> [--file <path>]   payload on stdin by default",
  "  list   [--tenant <uuid>]",
  "  rotate",
  "  delete --tenant <uuid> --purpose <name>",
  "",
  `purposes: ${Object.keys(PURPOSES).join(", ")}`,
  "",
  "There is no `get`: this tool never prints a decrypted credential.",
].join("\n");

/**
 * Returns the exit code rather than calling `process.exit`, so every path is reachable from a test
 * that does not have to kill the runner to observe it. `bin.ts` is the only thing that touches the
 * process.
 */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "set":
      return set(rest, deps);
    case "list":
      return list(rest, deps);
    case "delete":
      return remove(rest, deps);
    case "rotate":
      // Implemented in Task 6.
      deps.io.stderr("rotate is not implemented yet");
      return 2;
    default:
      deps.io.stderr(USAGE);
      return 2;
  }
}

/** `strict: true` is what makes the "never accepts a payload as an argument" test pass: an unknown
 * flag such as `--value` is a parse error, not something silently ignored. If a future maintainer
 * adds a `--value` option, cli.test.ts goes red — which is the point. */
function parse(argv: string[], options: Parameters<typeof parseArgs>[0]["options"]) {
  return parseArgs({ args: argv, options, strict: true, allowPositionals: false });
}

async function set(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, {
      tenant: { type: "string" },
      purpose: { type: "string" },
      file: { type: "string" },
    }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  const tenant = values.tenant;
  const purpose = values.purpose;
  if (typeof tenant !== "string" || typeof purpose !== "string") {
    deps.io.stderr(USAGE);
    return 2;
  }
  if (!isPurpose(purpose)) {
    // The structured code, not an ad-hoc sentence: `credentials.unknown_purpose` exists precisely
    // for this boundary — the store below takes a typed `Purpose` and so cannot raise it — and
    // `known` is what lets the operator see the legal set without reading the source.
    return reportFailure(
      new AppError("credentials.unknown_purpose", { purpose, known: Object.keys(PURPOSES) }),
      deps,
    );
  }

  const raw =
    typeof values.file === "string" ? await deps.readFile(values.file) : await deps.io.readStdin();

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      // NOT echoed: `raw` is a credential payload, and a parse error that quoted it would put a
      // secret in the operator's terminal and scrollback.
      deps.io.stderr("payload must be a JSON object of string fields");
      return 2;
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    deps.io.stderr("payload is not valid JSON");
    return 2;
  }

  const tenantId = brandTenantId(tenant);
  try {
    await withTenant(deps.db, tenantId, (tx) =>
      putCredential(tx, deps.ring, { tenantId, purpose, value: payload }),
    );
  } catch (error) {
    return reportFailure(error, deps);
  }
  deps.io.stdout(`set ${purpose} for ${tenantId}`);
  return 0;
}

async function list(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, { tenant: { type: "string" } }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  const tenants: TenantId[] =
    typeof values.tenant === "string"
      ? [brandTenantId(values.tenant)]
      : // No --tenant: enumerate through the SECURITY DEFINER seam, once per purpose, and
        // de-duplicate. There is no untenanted read of the table itself.
        [
          ...new Set(
            (
              await Promise.all(
                Object.keys(PURPOSES).map((purpose) => credentialTenants(deps.db, purpose)),
              )
            ).flat(),
          ),
        ];

  for (const tenantId of tenants) {
    const rows = await withTenant(deps.db, tenantId, (tx) => listCredentials(tx));
    for (const row of rows) {
      // Metadata only — purpose, key version, when it was last written. Never a field name, never a
      // value.
      deps.io.stdout(`${row.tenantId}\t${row.purpose}\tv${row.keyVersion}\t${row.updatedAt}`);
    }
  }
  return 0;
}

async function remove(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, { tenant: { type: "string" }, purpose: { type: "string" } }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }
  const tenant = values.tenant;
  const purpose = values.purpose;
  if (typeof tenant !== "string" || typeof purpose !== "string" || !isPurpose(purpose)) {
    deps.io.stderr(USAGE);
    return 2;
  }
  const tenantId = brandTenantId(tenant);
  const deleted = await withTenant(deps.db, tenantId, (tx) =>
    deleteCredential(tx, { tenantId, purpose }),
  );
  if (!deleted) {
    // Non-zero: "there was nothing there" is a different outcome from "removed it", and a script
    // that de-provisions a tenant should be able to tell them apart.
    deps.io.stderr(`no ${purpose} credential for ${tenantId}`);
    return 1;
  }
  deps.io.stdout(`deleted ${purpose} for ${tenantId}`);
  return 0;
}

/** Prints an AppError's CODE and structured params — never a raw message, and never a value. Params
 * are field names and identifiers by construction (see errors.ts). */
function reportFailure(error: unknown, deps: CliDeps): number {
  if (isAppError(error)) {
    deps.io.stderr(`${error.code} ${JSON.stringify(error.params)}`);
    return 1;
  }
  throw error;
}
```

- [ ] **Step 4: Write the executable entry point**

`packages/credentials/src/bin.ts`:

```typescript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createPostgresDb } from "@waitron/db";
import { runCli } from "./cli.js";
import { loadKeyRing } from "./keyring.js";

/** The only file in this package that touches the process, so everything else stays testable
 * without one. Connection string and key ring both come from the environment; the key ring is
 * validated here, at boot, rather than at the first decrypt. */
async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    process.stderr.write("DATABASE_URL is not set\n");
    return 2;
  }
  const ring = loadKeyRing(process.env);
  const db = await createPostgresDb(connectionString);
  try {
    return await runCli(process.argv.slice(2), {
      db,
      ring,
      io: {
        stdout: (line) => process.stdout.write(`${line}\n`),
        stderr: (line) => process.stderr.write(`${line}\n`),
        readStdin: async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
          return Buffer.concat(chunks).toString("utf8");
        },
      },
      readFile: (path) => readFile(path, "utf8"),
    });
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
```

- [ ] **Step 5: Add the bin, build script and esbuild**

Modify `packages/credentials/package.json` — add to `scripts`, add `bin`, add the devDependency:

The complete `scripts` and `bin` blocks after this edit — every earlier script stays:

```json
  "bin": { "waitron-credentials": "./dist/bin.js" },
  "scripts": {
    "build": "esbuild src/bin.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/bin.js --banner:js=\"#!/usr/bin/env node\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "db:generate": "drizzle-kit generate",
    "db:generate:custom": "drizzle-kit generate --custom"
  }
```

and add `"esbuild": "^0.25.0"` to `devDependencies`.

Bundling is not a preference. Verified while planning: Node does not resolve a `.js` import specifier to a `.ts` file, this repo writes `.js` specifiers throughout, and every package's `main` points at TS source with no build step — so `node src/bin.ts` fails inside `@waitron/db` no matter what this package alone compiles to. esbuild inlines `@waitron/db`, `@waitron/shared` and `drizzle-orm` into one self-contained file. See the spec's §6 packaging note.

- [ ] **Step 6: Run the tests and build**

```bash
pnpm install
pnpm --filter @waitron/credentials test
pnpm --filter @waitron/credentials build
node packages/credentials/dist/bin.js
```

Expected: tests PASS; the build writes `dist/bin.js`; running it with no `DATABASE_URL` prints `DATABASE_URL is not set` and exits 2. Add `dist/` to `.gitignore` if it is not already covered.

- [ ] **Step 7: Mutation-test the CLI guards**

1. Change `strict: true` to `strict: false` in `parse` → the "never accepts the payload as an argument" test must fail.
2. Make `remove` return 0 when `deleted` is false → the "nothing to delete" test must fail.
3. Add a `get` case to `runCli`'s switch that prints the credential → the no-`get` test must fail.

Revert all three and confirm GREEN.

- [ ] **Step 8: Commit**

```bash
git add packages/credentials .gitignore pnpm-lock.yaml
git commit -m "feat(credentials): the provisioning CLI, bundled with esbuild"
```

---

### Task 6: Rotation

**Files:**
- Modify: `packages/credentials/src/store.ts` (add `rotateCredentials`)
- Modify: `packages/credentials/src/cli.ts` (implement the `rotate` case)
- Test: `packages/credentials/src/rotate.test.ts`

**Interfaces:**
- Consumes: `credentialTenants`, `tryGetCredential`, `putCredential`, `KeyRing`.
- Produces: `rotateCredentials(db: Database, ring: KeyRing): Promise<{ rotated: number; alreadyCurrent: number }>`.

- [ ] **Step 1: Write the failing rotation test**

`packages/credentials/src/rotate.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant, type Database } from "@waitron/db";
import { hasCode } from "@waitron/shared";
import { loadKeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { getCredential, putCredential, rotateCredentials } from "./store.js";
import { seedTenant } from "../test/seed.js";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");

const RING_V1 = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
const RING_BOTH = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
  WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
  WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
});
const RING_V2_ONLY = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
});

const STRIPE = {
  secretKey: "sk_test_rot",
  webhookSecret: "whsec_rot",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
};

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
});

afterAll(async () => {
  await db.close();
});

describe("rotateCredentials", () => {
  it("re-seals every row onto the current key and advances its version", async () => {
    const tenantId = await seedTenant(db);
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );

    const result = await rotateCredentials(db, RING_BOTH);
    expect(result.rotated).toBeGreaterThanOrEqual(1);

    const versions = await db.execute<{ key_version: number }>(sql`
      select key_version from tenant_credentials where tenant_id = ${tenantId}`);
    expect(versions.rows[0]!.key_version).toBe(2);

    // Readable with the new key ALONE — the old key can now be retired.
    const actual = await withTenant(db, tenantId, (tx) =>
      getCredential(tx, RING_V2_ONLY, { tenantId, purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(STRIPE);
  });

  it("is idempotent — a second run rotates nothing", async () => {
    const tenantId = await seedTenant(db);
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "fiscal.aeat", value: { pfxBase64: "AA", passphrase: "p" } }),
    );
    await rotateCredentials(db, RING_BOTH);
    const second = await rotateCredentials(db, RING_BOTH);
    expect(second.rotated).toBe(0);
    expect(second.alreadyCurrent).toBeGreaterThanOrEqual(1);
  });

  it("finishes a rotation that was interrupted half-way", async () => {
    // The scenario key_version exists for: some rows on the old key, some already on the new one.
    // A rotate that assumed a single uniform state would fail on one half or the other.
    const tenantId = await seedTenant(db);
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_BOTH, { tenantId, purpose: "fiscal.aeat", value: { pfxBase64: "AA", passphrase: "p" } }),
    );

    const result = await rotateCredentials(db, RING_BOTH);
    expect(result.rotated).toBe(1);
    expect(result.alreadyCurrent).toBe(1);

    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials
      where tenant_id = ${tenantId} and key_version = 2`);
    expect(rows.rows[0]!.n).toBe(2);
  });

  it("refuses to run without a previous key when rows still need one", async () => {
    const tenantId = await seedTenant(db);
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const error = await captured(() => rotateCredentials(db, RING_V2_ONLY));
    expect(hasCode(error, "credentials.key_version_unknown")).toBe(true);
  });
});

async function captured(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject, and it did not");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/credentials test rotate`
Expected: FAIL — `rotateCredentials` is not exported.

- [ ] **Step 3: Implement rotation**

Append to `packages/credentials/src/store.ts`:

```typescript
export interface RotationResult {
  /** Rows re-sealed onto the ring's current key by THIS run. */
  rotated: number;
  /** Rows already on the current version — a resumed or repeated rotation, not an error. */
  alreadyCurrent: number;
}

/**
 * Re-seals every credential onto the ring's current key.
 *
 * Row by row, each in its own transaction, deliberately: one transaction over the whole vault would
 * hold locks across every tenant, and a failure part-way would roll back work that is perfectly
 * good. Partial progress is SAFE here precisely because reads select their key by the row's own
 * version — an interrupted run leaves a readable vault, and re-running finishes it. That is the
 * property `rotate.test.ts`'s interrupted case pins down.
 *
 * Rows already on the current version are counted and skipped, which is what makes a second run a
 * no-op rather than a pointless re-encryption of everything.
 */
export async function rotateCredentials(db: Database, ring: KeyRing): Promise<RotationResult> {
  const result: RotationResult = { rotated: 0, alreadyCurrent: 0 };
  const tenants = new Set<TenantId>();
  for (const purpose of Object.keys(PURPOSES)) {
    for (const tenantId of await credentialTenants(db, purpose)) tenants.add(tenantId);
  }

  for (const tenantId of tenants) {
    const rows = await withTenant(db, tenantId, (tx) => listCredentials(tx));
    for (const row of rows) {
      if (!isPurpose(row.purpose)) continue;
      if (row.keyVersion === ring.current.version) {
        result.alreadyCurrent += 1;
        continue;
      }
      const purpose = row.purpose;
      await withTenant(db, tenantId, async (tx) => {
        // One transaction per row, so the read and the re-write are evaluated under one tenant GUC.
        // It does NOT make the pair atomic against a concurrent `set`: under READ COMMITTED the
        // SELECT takes no row lock, so a `set` committing between the two is overwritten by this
        // rotation's stale value whether the gap spans one transaction or two. Preventing that
        // would need `SELECT ... FOR UPDATE` here, or REPEATABLE READ plus a retry loop —
        // deliberately absent, because rotate is a maintenance-window operation and "rotation
        // without downtime" is out of scope (design §8).
        const value = await tryGetCredential(tx, ring, { tenantId, purpose });
        if (value === null) return;
        await putCredential(tx, ring, { tenantId, purpose, value });
        // INSIDE the callback: a row deleted between the enumeration and this read takes the
        // `value === null` path above, and must not be counted as rotated.
        result.rotated += 1;
      });
    }
  }
  return result;
}
```

Add `withTenant` to the `@waitron/db` import at the top of `store.ts`.

- [ ] **Step 4: Wire it into the CLI**

Replace the `rotate` case in `packages/credentials/src/cli.ts`:

```typescript
    case "rotate": {
      const result = await rotateCredentials(deps.db, deps.ring);
      deps.io.stdout(`rotated ${result.rotated}, already current ${result.alreadyCurrent}`);
      return 0;
    }
```

Add `rotateCredentials` to the `./store.js` import.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @waitron/credentials test`
Expected: PASS.

- [ ] **Step 6: Mutation-test the guards**

1. Delete the `row.keyVersion === ring.current.version` skip → the idempotence test's `rotated` count must go non-zero and fail.
2. ~~Move the `tryGetCredential`/`putCredential` pair out of one shared `withTenant` into two.~~ **Struck — this check was based on a false premise.** It assumed the shared transaction prevents a concurrent `set` from being overwritten. It does not: `withTenant` is a plain `db.transaction()` at READ COMMITTED, the read takes no row lock, and the UPSERT's `SET` values are app-computed constants, so a concurrent writer is clobbered identically whether the gap spans one transaction or two. Only `SELECT ... FOR UPDATE`, or REPEATABLE READ / SERIALIZABLE plus a retry loop, would prevent it — and the shared transaction is a **necessary precondition for all three and sufficient for none**. So the shape is right and the stated reason was invented. No test is required; state the property honestly in the comment instead, and do not cite a test that does not exist.

- [ ] **Step 7: Commit**

```bash
git add packages/credentials
git commit -m "feat(credentials): key rotation, resumable by design"
```

---

### Task 7: The public barrel, coverage, and the whole-workspace gate

**Files:**
- Modify: `packages/credentials/src/index.ts`
- Modify: `eslint.config.js` (neutrality zone)
- Test: `packages/credentials/src/index.test.ts`

**Interfaces:**
- Produces: the package's entire public surface.

- [ ] **Step 1: Write the barrel**

`packages/credentials/src/index.ts`:

```typescript
// The entire public surface of @waitron/credentials. Re-exports only — no logic here.
//
// The CLI is NOT re-exported: `cli.ts` and `bin.ts` are the provisioning tool's own entry points,
// reached through the `bin`, and a host that imported `runCli` by autocomplete would be reaching
// for an operator command rather than the vault.
import "./errors.js";

export { aadFor, open, seal } from "./cipher.js";
export type { Sealed } from "./cipher.js";
export { keyForVersion, loadKeyRing } from "./keyring.js";
export type { KeyEntry, KeyRing } from "./keyring.js";
export { CREDENTIALS_MIGRATIONS } from "./migrations.js";
export { PURPOSES, isPurpose, validatePayload } from "./purposes.js";
export type { Purpose } from "./purposes.js";
export {
  credentialTenants,
  deleteCredential,
  getCredential,
  listCredentials,
  putCredential,
  rotateCredentials,
  tryGetCredential,
} from "./store.js";
export type { CredentialMeta, CredentialRef, RotationResult } from "./store.js";
export { tenantCredentials } from "./schema/tenant-credentials.js";
```

- [ ] **Step 2: Write the barrel test**

`packages/credentials/src/index.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("the @waitron/credentials public surface", () => {
  it("exports exactly what it means to", () => {
    expect(Object.keys(barrel).sort()).toEqual(
      [
        "CREDENTIALS_MIGRATIONS",
        "PURPOSES",
        "aadFor",
        "credentialTenants",
        "deleteCredential",
        "getCredential",
        "isPurpose",
        "keyForVersion",
        "listCredentials",
        "loadKeyRing",
        "open",
        "putCredential",
        "rotateCredentials",
        "seal",
        "tenantCredentials",
        "tryGetCredential",
        "validatePayload",
      ].sort(),
    );
  });

  it("does not export the CLI", () => {
    // Reaching `runCli` from the library surface would let a host invoke an operator command.
    expect(Object.keys(barrel)).not.toContain("runCli");
  });
});
```

- [ ] **Step 3: Verify the eslint neutrality zone — do NOT add it again**

> **This step already landed, in Task 3's fix round 1.** A Task 3 reviewer found that
> `purposes.ts`'s comment claimed "eslint enforces it" while no such zone existed — proven by a
> relative-path import into `packages/payments` linting clean — so the zone was pulled forward
> rather than left false for two more tasks. **`eslint.config.js` already carries it.** Adding a
> second block with the same `target` would be a duplicate.
>
> What this step now is: confirm the zone is present and has teeth. Add
> `import { reconcilePayments } from "../../payments/src/index.js";` to a file under
> `packages/credentials/src`, run `pnpm --filter @waitron/credentials lint`, confirm it FAILS with
> an `import-x/no-restricted-paths` error, then remove the import and confirm it passes. If the zone
> is somehow absent, add it using the block below.

The block, retained for reference only:

```javascript
  {
    // packages/credentials stores OPAQUE payloads. It knows purpose names and field lists as string
    // data (src/purposes.ts) and must never import a package that gives those strings meaning —
    // the moment it imports @waitron/payments, "deployment data, not domain data" (the design's §3)
    // stops being true and the injected-credential seams four adapters were built around invert.
    // Its package.json does not enforce this: `main` points at TS source with no build step, so a
    // relative escape would typecheck, lint clean and pass every test.
    //
    // packages/payments-stripe is named explicitly, unlike the scheduler zone, which omits it — an
    // omission that zone's own handoff records as a latent gap.
    files: ["packages/credentials/src/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { typescript: true },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: import.meta.dirname,
          zones: [
            {
              target: "./packages/credentials/src/**/*",
              from: [
                "./packages/payments/**",
                "./packages/payments-stripe/**",
                "./packages/fiscal/**",
                "./packages/fiscal-verifactu/**",
                "./packages/verifactu/**",
                "./packages/core/**",
              ],
              message:
                "packages/credentials stores opaque payloads and must not import a package that " +
                "gives them meaning (see docs/superpowers/specs/" +
                "2026-07-26-tenant-credential-vault-design.md §3). A purpose's field list is " +
                "string data, never an import.",
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 4: Run the package gate with coverage**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/credentials test:coverage`
Expected: PASS, with statements/lines/functions ≥ 98 and branches ≥ 95. If a threshold misses, add the missing test — do not lower the threshold.

- [ ] **Step 5: Run every workspace gate**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm -r test
```

Expected: all PASS. `pnpm format:check` is a separate gate from `pnpm lint` and fails independently — run both.

- [ ] **Step 6: Commit**

```bash
git add packages/credentials eslint.config.js
git commit -m "feat(credentials): public surface and the import-neutrality lint zone"
```

---

## Notes for whoever executes this

- **`TESTCONTAINERS_RYUK_DISABLED=true` is a local environment variable. Never commit it** — not to a script, not to a config file, not to CI.
- **The pre-push hook runs `lint`, `format:check`, `typecheck` and `test` in about 80 seconds.** Do not bypass it.
- **Branch protection blocks the merge twice over:** it requires a review no second human can give in a solo repo (so `gh pr merge --admin`), and it requires every conversation resolved — a Copilot inline comment counts, so resolve the thread via the GraphQL `resolveReviewThread` mutation before merging.
- **A comment that asserts the opposite of the code is this project's most-found defect**, across three consecutive cycles, and only a reader ever catches it. When you change a predicate, re-read the comment above it.
- If a task's code does not match what the spec says, the **spec wins** — stop and raise it rather than implementing the plan's version.

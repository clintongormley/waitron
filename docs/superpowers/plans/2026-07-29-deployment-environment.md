# Deployment Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "which environment is this deployment" a single, enforced, system-wide fact, so a host can never file to AEAT or charge through Stripe on behalf of a database belonging to the other environment.

**Architecture:** One setting, `WAITRON_ENV`, replaces `WAITRON_AEAT_ENV`. Three guards fail at three different moments: a stamp row on the database checked at boot before migrations; a `sk_test_`/`sk_live_` prefix check where the Stripe credential is already validated; and an `entorno` column on `registros_facturacion` that `drain` refuses to submit against a mismatched host.

**Tech Stack:** TypeScript (ESM), Vitest, Drizzle, PostgreSQL, PGlite for hermetic suites, Testcontainers for real-Postgres suites.

**Spec:** [`2026-07-29-deployment-environment-design.md`](../specs/2026-07-29-deployment-environment-design.md).

## Global Constraints

- **Every commit signed off**: `git commit -s`. The `dco` job walks every commit in the PR range.
- **The gate is four commands**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
- **`TESTCONTAINERS_RYUK_DISABLED=true`** for anything that starts a container.
- **Unset means `preproduction`; `production` must be typed out.** `config.ts` calls this "the one default in the file whose mistake is irreversible". Preserve it exactly.
- **`entorno` must never enter `computeHuella`'s input.** It is our metadata, never AEAT's. Two otherwise identical records must hash identically regardless of environment.
- **Error codes name the DOMAIN CONCEPT, never the throwing package** (`packages/shared/src/errors.ts`). `server.*` is reserved for process facts by `apps/server/src/errors.ts`'s own doc comment.
- **Never widen a grant to make a test pass.** `app_user` holds `SELECT` on `tenants` deliberately.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `packages/db/drizzle/0010_deployment_stamp.sql` | The `deployment` table, one row, plus grants |
| `packages/db/src/schema/deployment.ts` | Drizzle table object for it |
| `packages/db/src/deployment.ts` | `readDeploymentEnvironment` / `stampDeployment` |
| `packages/db/src/deployment.test.ts` | Their tests |
| `packages/fiscal-verifactu/drizzle/0009_registro_entorno.sql` | The nullable `entorno` column |
| `apps/server/src/deployment-guard.ts` | The boot-time comparison |
| `apps/server/src/deployment-guard.test.ts` | Its tests |

**Modified:** `apps/server/src/config.ts` (`WAITRON_ENV`), `apps/server/src/errors.ts` (two codes), `apps/server/src/boot.ts` (call the guard), `apps/server/src/stripe-account.ts` (prefix check), `packages/fiscal-verifactu/src/schema/registros.ts` (column), `packages/fiscal-verifactu/src/registro-row.ts` (carry it), `packages/fiscal-verifactu/src/chain.ts` (write it), `packages/fiscal-verifactu/src/drain.ts` (guard), `packages/fiscal-verifactu/src/errors.ts` (two codes), plus each of their test files and the docs listed in Task 7.

---

## Task 1: `WAITRON_ENV` replaces `WAITRON_AEAT_ENV`

Rename the setting and widen its meaning. Nothing else changes yet — this task is deliberately pure rename plus the doc rewrite, so a reviewer can see the behaviour is identical.

**Files:**
- Modify: `apps/server/src/config.ts:5`, `:27`, `:119-129`, `:209`
- Test: `apps/server/src/config.test.ts`

**Interfaces:**
- Produces: `export type DeploymentEnvironment = "production" | "preproduction"` and `export function deploymentEnvironment(env: Env): DeploymentEnvironment`, replacing `AeatEnvironment` / `aeatEnvironment`. `ServerConfig.aeatEnv` becomes `ServerConfig.environment`.

- [ ] **Step 1: Update the existing config tests to the new names**

In `apps/server/src/config.test.ts`, replace every `WAITRON_AEAT_ENV` with `WAITRON_ENV` and every `aeatEnv` with `environment`. Then add this test, which pins the property the spec calls irreversible:

```typescript
it("defaults to preproduction when unset, so production is never reached by omission", () => {
  expect(deploymentEnvironment({})).toBe("preproduction");
  expect(deploymentEnvironment({ WAITRON_ENV: "" })).toBe("preproduction");
});

it("refuses a value that is neither environment, naming the variable", () => {
  const error = captureError(() => deploymentEnvironment({ WAITRON_ENV: "staging" }));
  expect(error).toMatchObject({
    code: "server.config_invalid",
    params: { variable: "WAITRON_ENV", reason: "not_a_deployment_environment" },
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/server exec vitest run src/config.test.ts`
Expected: FAIL — `deploymentEnvironment` is not exported.

- [ ] **Step 3: Rename in `config.ts`**

At line 5, replace the type. At line 119, rename the function, read the new variable, and rewrite the doc comment so it covers both providers rather than AEAT alone:

```typescript
export type DeploymentEnvironment = "production" | "preproduction";

/**
 * Which environment this whole deployment belongs to — AEAT's endpoints, and the Stripe key mode
 * a tenant's credential must match. ONE setting, not one per provider: there is no legitimate
 * mixed pair. AEAT pre-production with a live Stripe key means taking real money without filing
 * it; AEAT production with a test key means filing invoices for money never taken.
 *
 * Exported so one-shot scripts that build their own backend resolve this the same way the host
 * does — the safe default below is not one for a caller to re-derive.
 */
export function deploymentEnvironment(env: Env): DeploymentEnvironment {
  const raw = env.WAITRON_ENV;
  // The DEFAULT is preproduction and production must be typed out. Architecture §9: production
  // numbering can never be reused, even for a test invoice, so this is the one default in the file
  // whose mistake is irreversible.
  if (isUnset(raw)) return "preproduction";
  if (raw !== "production" && raw !== "preproduction") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_ENV",
      reason: "not_a_deployment_environment",
    });
  }
  return raw;
}
```

Rename `aeatEnv: AeatEnvironment` to `environment: DeploymentEnvironment` at line 27, and `aeatEnv: aeatEnvironment(env)` to `environment: deploymentEnvironment(env)` at line 209.

- [ ] **Step 4: Fix every consumer the compiler names**

Run: `pnpm --filter @waitron/server typecheck`

Fix each reported site. The known ones are `apps/server/src/aeat-transport.ts` (the `aeatEnv` parameter it takes — rename the parameter, not the `SOAP_ENDPOINTS[...]` lookup, which is unchanged), `apps/server/src/boot.ts`, `apps/server/src/boot.test.ts`, and `apps/server/scripts/record-one-sale.ts` (which imports `aeatEnvironment`).

- [ ] **Step 5: Run the full package suite**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test`
Expected: PASS, 135 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src apps/server/scripts
git commit -s -m "refactor(server): WAITRON_ENV replaces WAITRON_AEAT_ENV

The environment is not an AEAT concept — Stripe has the same real-vs-test
split. One setting, because there is no legitimate mixed pair. Behaviour is
unchanged: unset still means preproduction, and production must be typed out."
```

---

## Task 2: The deployment stamp table

**Files:**
- Create: `packages/db/drizzle/0010_deployment_stamp.sql`, `packages/db/src/schema/deployment.ts`, `packages/db/src/deployment.ts`, `packages/db/src/deployment.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces:
  - `export const deployment` — the Drizzle table.
  - `export async function readDeploymentEnvironment(db: Database): Promise<string | null>` — `null` when the table is absent OR empty. Callers cannot distinguish, and must not: both mean "unstamped".
  - `export async function stampDeployment(db: Database, environment: string): Promise<void>` — inserts, and throws `deployment.already_stamped` if a different value is present.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/deployment.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { captureError } from "./testing/errors.js";
import { createPgliteDb } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { runMigrations } from "./migrate.js";
import { readDeploymentEnvironment, stampDeployment } from "./deployment.js";
import type { Database } from "./client.js";

let db: Database;

beforeEach(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
});

describe("the deployment stamp", () => {
  it("reads as unstamped on a freshly migrated database", async () => {
    expect(await readDeploymentEnvironment(db)).toBeNull();
  });

  it("reads back what was stamped", async () => {
    await stampDeployment(db, "preproduction");
    expect(await readDeploymentEnvironment(db)).toBe("preproduction");
  });

  it("is idempotent for the same value", async () => {
    await stampDeployment(db, "production");
    await stampDeployment(db, "production");
    expect(await readDeploymentEnvironment(db)).toBe("production");
  });

  it("refuses to restamp a database as a different environment", async () => {
    await stampDeployment(db, "preproduction");
    const error = await captureError(() => stampDeployment(db, "production"));
    expect(error).toMatchObject({
      code: "deployment.already_stamped",
      params: { stamped: "preproduction", requested: "production" },
    });
    expect(await readDeploymentEnvironment(db)).toBe("preproduction");
  });

  it("permits at most one row, so there is never an ambiguous answer", async () => {
    await stampDeployment(db, "production");
    const error = await captureError(() =>
      db.execute(sql`insert into deployment (id, environment) values (2, 'preproduction')`),
    );
    expect(error).toBeDefined();
  });
});
```

Add `import { sql } from "drizzle-orm";` at the top.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/db exec vitest run src/deployment.test.ts`
Expected: FAIL — cannot resolve `./deployment.js`.

- [ ] **Step 3: Write the migration**

Create `packages/db/drizzle/0010_deployment_stamp.sql`:

```sql
-- Which environment this DATABASE belongs to. One row, ever: `id` is pinned to 1 by a CHECK, so
-- "what environment is this" can never have two answers. Written once at provisioning and never
-- updated — a database does not change environment, it gets replaced (see the design's §2: a
-- pre-production database can never be promoted, because its invoice series has a hole no stamp
-- can fill).
--
-- Deliberately NOT tenant-scoped and NOT RLS-protected: it is a fact about the whole database, so
-- there is no tenant to isolate it by, and every role must be able to read it before any tenant
-- scope exists. It carries no secret — the environment name is already in the host's own config.
CREATE TABLE "deployment" (
	"id" integer PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"stamped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_singleton_ck" CHECK ("deployment"."id" = 1),
	CONSTRAINT "deployment_environment_ck" CHECK ("deployment"."environment" in ('production', 'preproduction'))
);
--> statement-breakpoint
GRANT SELECT ON "deployment" TO app_user;
```

Then regenerate the journal so Drizzle sees it:

Run: `pnpm --filter @waitron/db exec drizzle-kit generate --custom --name deployment_stamp`

If that renames the file, keep drizzle-kit's name and adjust the path in this task.

- [ ] **Step 4: Write the schema object and the accessors**

Create `packages/db/src/schema/deployment.ts`:

```typescript
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** One row, id pinned to 1 — see 0010_deployment_stamp.sql for why a second row must be impossible. */
export const deployment = pgTable(
  "deployment",
  {
    id: integer("id").primaryKey(),
    environment: text("environment").notNull(),
    stampedAt: timestamp("stamped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("deployment_singleton_ck", sql`${t.id} = 1`)],
);
```

Create `packages/db/src/deployment.ts`:

```typescript
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database } from "./client.js";
import { deployment } from "./schema/deployment.js";
import "./errors.js";

/**
 * The environment this database was stamped for, or `null` if it has none.
 *
 * `null` covers BOTH "the table does not exist yet" and "the table is empty", and callers must not
 * try to tell them apart: on a first-ever boot the migration that creates the table has not run,
 * and on a database predating this feature the table exists but is empty. Both mean the same
 * thing — nothing recorded what this database is for — and both are handled identically.
 *
 * Uses `to_regclass` rather than catching an undefined-table error, because in PostgreSQL a failed
 * statement aborts the enclosing transaction: probing by failure would poison a transaction the
 * caller may still need.
 */
export async function readDeploymentEnvironment(db: Database): Promise<string | null> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.deployment') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return null;

  const rows = await db.execute<{ environment: string }>(
    sql`select environment from deployment where id = 1`,
  );
  return rows.rows[0]?.environment ?? null;
}

/**
 * Records which environment this database belongs to. Idempotent for the same value; a DIFFERENT
 * value is refused rather than overwritten, because the rows already written under the first one
 * cannot be moved (the design's §2).
 */
export async function stampDeployment(db: Database, environment: string): Promise<void> {
  const existing = await readDeploymentEnvironment(db);
  if (existing === environment) return;
  if (existing !== null) {
    throw new AppError("deployment.already_stamped", {
      stamped: existing,
      requested: environment,
    });
  }
  await db.insert(deployment).values({ id: 1, environment });
}
```

Add to `packages/db/src/errors.ts`'s `declare module` block:

```typescript
    /**
     * A database already belongs to a different environment. Never overwritten: the rows written
     * under the first stamp cannot be moved to the second — an invoice series that filed to
     * pre-production has a numbering hole in production that nothing can fill.
     */
    "deployment.already_stamped": { stamped: string; requested: string };
```

Export both from `packages/db/src/index.ts`, beside the existing schema exports:

```typescript
export { readDeploymentEnvironment, stampDeployment } from "./deployment.js";
export * from "./schema/deployment.js";
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @waitron/db exec vitest run src/deployment.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the whole package, since a new migration affects every suite**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test`
Expected: PASS. If a migration-composition test asserts a migration count, update it.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -s -m "feat(db): a deployment stamp, one row per database

Records which environment a database belongs to. A different value is
refused rather than overwritten: rows written under the first stamp cannot
be moved, so restamping would only hide the mix it claims to resolve."
```

---

## Task 3: The boot guard

**Files:**
- Create: `apps/server/src/deployment-guard.ts`, `apps/server/src/deployment-guard.test.ts`
- Modify: `apps/server/src/errors.ts`, `apps/server/src/boot.ts:~103` (immediately before `applyMigrations`)

**Interfaces:**
- Consumes: `readDeploymentEnvironment` (Task 2), `DeploymentEnvironment` (Task 1).
- Produces: `export async function assertDeploymentMatches(db: Database, hostEnvironment: DeploymentEnvironment): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/deployment-guard.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, stampDeployment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { captureError } from "@waitron/db";
import { assertDeploymentMatches } from "./deployment-guard.js";

let db: Database;

beforeEach(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
});

describe("the deployment guard", () => {
  it("passes when the stamp matches the host", async () => {
    await stampDeployment(db, "production");
    await expect(assertDeploymentMatches(db, "production")).resolves.toBeUndefined();
  });

  it("passes an unstamped database, which every existing deployment is", async () => {
    await expect(assertDeploymentMatches(db, "production")).resolves.toBeUndefined();
  });

  it("refuses a production host against a pre-production database", async () => {
    await stampDeployment(db, "preproduction");
    const error = await captureError(() => assertDeploymentMatches(db, "production"));
    expect(error).toMatchObject({
      code: "deployment.environment_mismatch",
      params: { databaseEnvironment: "preproduction", hostEnvironment: "production" },
    });
  });

  it("refuses the reverse too", async () => {
    await stampDeployment(db, "production");
    const error = await captureError(() => assertDeploymentMatches(db, "preproduction"));
    expect(error).toMatchObject({ code: "deployment.environment_mismatch" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/server exec vitest run src/deployment-guard.test.ts`
Expected: FAIL — cannot resolve `./deployment-guard.js`.

- [ ] **Step 3: Implement**

Create `apps/server/src/deployment-guard.ts`:

```typescript
import { readDeploymentEnvironment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import "./errors.js";

/**
 * Refuses to proceed when this database belongs to a different environment than this host.
 *
 * Runs BEFORE `applyMigrations`, which is the whole point: a staging host pointed at the production
 * database must die before it writes anything, not after a duty pass. An UNSTAMPED database passes
 * — every database that exists today predates the stamp, and the record-level `entorno` guard in
 * `drain` still covers those.
 */
export async function assertDeploymentMatches(
  db: Database,
  hostEnvironment: DeploymentEnvironment,
): Promise<void> {
  const stamped = await readDeploymentEnvironment(db);
  if (stamped === null || stamped === hostEnvironment) return;
  throw new AppError("deployment.environment_mismatch", {
    databaseEnvironment: stamped,
    hostEnvironment,
  });
}
```

Add to `apps/server/src/errors.ts`:

```typescript
    /**
     * This host is configured for one environment and the database belongs to another. Thrown
     * before migrations run, so nothing is written.
     *
     * `deployment.*` rather than `server.*`: it is a fact about which deployment this database
     * belongs to, not about the process. Neither value is a secret — both are already in the
     * host's own configuration.
     */
    "deployment.environment_mismatch": { databaseEnvironment: string; hostEnvironment: string };
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/server exec vitest run src/deployment-guard.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into `boot.ts` before `applyMigrations`**

`readDeploymentEnvironment` takes a `Database`, and `boot.ts` does not open its pool until after migrations. Open a short-lived connection over `config.migrationsDatabaseUrl` for the check and close it, immediately before the `await applyMigrations(...)` call at line ~103:

```typescript
  // Before ANY write, including migrations: a host pointed at another environment's database must
  // stop here. Its own connection, closed immediately — the long-lived pool below is not opened
  // until migrations have run, and borrowing the migrator's string keeps this on the same database
  // the migrations are about to touch.
  const stampProbe = await createPostgresDb(config.migrationsDatabaseUrl);
  try {
    await assertDeploymentMatches(stampProbe, config.environment);
  } finally {
    await stampProbe.close();
  }
```

- [ ] **Step 6: Add the boot-level test**

In `apps/server/src/boot.test.ts`, beside the existing real-container cases:

```typescript
it("refuses to start, and runs no migration, against another environment's database", async () => {
  const admin = await pg.connect();
  await stampDeployment(admin, "preproduction");
  await admin.close();

  const error = await captureError(() =>
    startServer({
      ...BASE_ENV,
      DATABASE_URL: roleUrl(pg.uri, PROBE_ROLE, PROBE_PASSWORD),
      WAITRON_ENV: "production",
    }),
  );
  expect(error).toMatchObject({ code: "deployment.environment_mismatch" });
});
```

`roleUrl` takes `pg.uri` — the connection STRING — not the `RealPostgres` object; `PROBE_ROLE` and
`PROBE_PASSWORD` are already declared at the top of that file. Reuse the suite's existing
`beforeAll` container rather than starting another.

- [ ] **Step 7: Run the package suite**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src
git commit -s -m "feat(server): refuse to boot against another environment's database

Runs before applyMigrations, so a staging host aimed at the production
database dies before it writes rather than after a duty pass. An unstamped
database passes — every database that exists today predates the stamp."
```

---

## Task 4: The Stripe key-prefix check

**Files:**
- Modify: `apps/server/src/stripe-account.ts:37-45` (beside `stripeSecretKeyFrom`), `apps/server/src/errors.ts`
- Test: `apps/server/src/stripe-account.test.ts`

**Interfaces:**
- Consumes: `DeploymentEnvironment` (Task 1).
- Produces: `stripeSecretKeyFrom` gains a third parameter `environment: DeploymentEnvironment`. `stripeAccountResolver`'s `StripeAccountDeps` gains `environment: DeploymentEnvironment`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/stripe-account.test.ts`:

```typescript
const REF = { tenantId: "11111111-1111-1111-1111-111111111111", purpose: "payments.stripe" };

it("refuses a test key on a production deployment", () => {
  const error = captureError(() =>
    stripeSecretKeyFrom({ secretKey: "sk_test_abc123" }, REF, "production"),
  );
  expect(error).toMatchObject({
    code: "payment.credential_environment_mismatch",
    params: { tenantId: REF.tenantId, keyEnvironment: "preproduction", hostEnvironment: "production" },
  });
});

it("refuses a live key on a pre-production deployment", () => {
  const error = captureError(() =>
    stripeSecretKeyFrom({ secretKey: "sk_live_abc123" }, REF, "preproduction"),
  );
  expect(error).toMatchObject({
    code: "payment.credential_environment_mismatch",
    params: { keyEnvironment: "production", hostEnvironment: "preproduction" },
  });
});

it("never echoes the key, or any prefix of it, in the error", () => {
  const error = captureError(() =>
    stripeSecretKeyFrom({ secretKey: "sk_test_SUPERSECRET" }, REF, "production"),
  );
  expect(JSON.stringify(error)).not.toContain("SUPERSECRET");
  expect(JSON.stringify(error)).not.toContain("sk_test");
});

it("accepts a matching pair", () => {
  expect(stripeSecretKeyFrom({ secretKey: "sk_live_ok" }, REF, "production")).toBe("sk_live_ok");
  expect(stripeSecretKeyFrom({ secretKey: "sk_test_ok" }, REF, "preproduction")).toBe("sk_test_ok");
});

it("accepts a key whose mode it cannot tell, rather than guessing", () => {
  // Restricted keys (`rk_`) and any future prefix: refusing what we cannot classify would break a
  // working deployment to enforce a check we cannot actually perform.
  expect(stripeSecretKeyFrom({ secretKey: "rk_live_x" }, REF, "production")).toBe("rk_live_x");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/server exec vitest run src/stripe-account.test.ts`
Expected: FAIL — `stripeSecretKeyFrom` takes two arguments.

- [ ] **Step 3: Implement**

In `apps/server/src/stripe-account.ts`, add above `stripeSecretKeyFrom`:

```typescript
/**
 * Which environment a Stripe secret key belongs to, or `null` when we cannot tell.
 *
 * `null` is not a failure. Stripe issues restricted keys (`rk_…`) and may add prefixes we do not
 * know; refusing an unrecognised key would break a working deployment in order to enforce a check
 * we cannot actually perform. The known prefixes are the ones worth guarding, because they are the
 * ones an operator copies from the wrong dashboard tab.
 */
function keyEnvironmentOf(secretKey: string): DeploymentEnvironment | null {
  if (secretKey.startsWith("sk_live_")) return "production";
  if (secretKey.startsWith("sk_test_")) return "preproduction";
  return null;
}
```

Then extend `stripeSecretKeyFrom`, after its existing `undefined` check and before it returns:

```typescript
  const keyEnvironment = keyEnvironmentOf(secretKey);
  if (keyEnvironment !== null && keyEnvironment !== environment) {
    throw new AppError("payment.credential_environment_mismatch", {
      tenantId: ref.tenantId,
      keyEnvironment,
      hostEnvironment: environment,
    });
  }
  return secretKey;
```

Add to `apps/server/src/errors.ts`:

```typescript
    /**
     * A tenant's Stripe key belongs to the other environment. A test key on a production
     * deployment takes payments that never settle, and `reconcile` then sweeps a test-mode account
     * against live rows and reports every one as missing upstream.
     *
     * Carries the key's ENVIRONMENT, never the key or any prefix of it — the same rule
     * `credentials.invalid_payload` follows by reporting a count rather than field values.
     */
    "payment.credential_environment_mismatch": {
      tenantId: string;
      keyEnvironment: string;
      hostEnvironment: string;
    };
```

- [ ] **Step 4: Thread the environment through the resolver**

Add `environment: DeploymentEnvironment` to `StripeAccountDeps`, pass it at the `stripeSecretKeyFrom` call on line ~61, and supply `config.environment` where `boot.ts` builds `stripeAccountResolver`.

- [ ] **Step 5: Run to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src
git commit -s -m "feat(server): refuse a Stripe key from the wrong environment

Validated where the payload is already validated. A key whose mode we
cannot classify is accepted rather than guessed at: refusing an unknown
prefix would break a working deployment to enforce a check we cannot make."
```

---

## Task 5: The `entorno` column

**Files:**
- Create: `packages/fiscal-verifactu/drizzle/0009_registro_entorno.sql`
- Modify: `packages/fiscal-verifactu/src/schema/registros.ts`, `src/registro-row.ts:89` (`toRegistroRow`), `src/chain.ts:~196`
- Test: `packages/fiscal-verifactu/src/chain.test.ts`, `src/verify.test.ts`

**Interfaces:**
- Produces: `RegistroRowContext` gains `entorno: string`. `toRegistroRow` writes it onto the insert. `appendToChain`'s options gain `entorno: string`, passed through from the backend.

- [ ] **Step 1: Write the failing tests**

Add to `packages/fiscal-verifactu/src/chain.test.ts`:

```typescript
it("records the environment the registro was generated for", async () => {
  const { tenantId, tillId } = await seedTill(db);
  const appended = await withTenant(db, tenantId, (tx) =>
    appendToChain(tx, { ...baseOptions(tenantId, tillId), entorno: "preproduction" }),
  );

  const row = await db.execute<{ entorno: string }>(
    sql`select entorno from registros_facturacion where id = ${appended.id}`,
  );
  expect(row.rows[0]!.entorno).toBe("preproduction");
});
```

Add to `packages/fiscal-verifactu/src/verify.test.ts` — this is the constraint that matters most:

```typescript
it("hashes identically regardless of environment, because entorno is ours and not AEAT's", async () => {
  // Two records built from identical input, differing ONLY in entorno, must produce the same
  // huella. If entorno ever reaches computeHuella's input, this fails — and every chain written
  // under one environment would become unverifiable under the other.
  const a = await appendOne({ entorno: "production" });
  const b = await appendOne({ entorno: "preproduction" });
  expect(a.huella).toBe(b.huella);
});
```

`appendOne` is a local helper you write in that file: seed a FRESH tenant and till per call via
`seedTill(db)` (`./testing/seed.js`), then `appendToChain` with identical input apart from
`entorno`. A fresh tenant per call is what makes both records a *first* record — same `null`
predecessor — so any hash difference can only come from `entorno`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/chain.test.ts src/verify.test.ts`
Expected: FAIL — `entorno` is not a known property.

- [ ] **Step 3: Write the migration**

Create `packages/fiscal-verifactu/drizzle/0009_registro_entorno.sql`:

```sql
-- Which environment this registro was GENERATED for, so `drain` can refuse to submit it to the
-- other one. Immutable, like every other column here: it is a fact about the record, not about the
-- attempt to send it — which is why it lives on registros_facturacion and not on the mutable
-- `envios` sidecar.
--
-- NULLABLE with no backfill, deliberately. Rows written before this migration have no recorded
-- destination and we cannot infer one; `drain` refuses them with `fiscal.environment_unknown`
-- rather than guessing. No production deployment exists, so the only affected rows are in
-- development and throwaway databases.
--
-- NOT part of the huella. `entorno` is ours, never AEAT's: it is absent from the RegistroAlta the
-- serializer builds, and verify.test.ts pins that two records differing only here hash identically.
ALTER TABLE "registros_facturacion" ADD COLUMN "entorno" text;
--> statement-breakpoint
ALTER TABLE "registros_facturacion" ADD CONSTRAINT "registros_entorno_ck" CHECK ("entorno" is null or "entorno" in ('production', 'preproduction'));
```

Run: `pnpm --filter @waitron/fiscal-verifactu exec drizzle-kit generate --custom --name registro_entorno`

- [ ] **Step 4: Add the column to the schema object and carry it through**

In `packages/fiscal-verifactu/src/schema/registros.ts`, add to the table definition:

```typescript
  entorno: text("entorno"),
```

In `registro-row.ts`, add `entorno: string` to `RegistroRowContext` and set it on the object `toRegistroRow` returns. In `chain.ts`, add `entorno` to the options `appendToChain` accepts and pass it into the `toRegistroRow` context at line ~196.

Verify by inspection that `entorno` appears nowhere in `fromRegistroRow` or in anything reaching `computeHuella` — the test in Step 1 proves it, but the reading is what tells you *why* it passes.

- [ ] **Step 5: Run to verify they pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test`
Expected: PASS. `VerifactuBackend` must supply `entorno` — take it from a new required `environment` option on `VerifactuBackendOptions`, and update every construction site the compiler names.

- [ ] **Step 6: Commit**

```bash
git add packages/fiscal-verifactu
git commit -s -m "feat(fiscal): record which environment a registro was generated for

Immutable, so it belongs on registros_facturacion rather than the mutable
envios sidecar. Nullable with no backfill: rows written before this have no
recorded destination and we will not guess one. Never hashed — a test pins
that two records differing only in entorno produce the same huella."
```

---

## Task 6: The drain guard

**Files:**
- Modify: `packages/fiscal-verifactu/src/drain.ts` (after `claimBatch`, line ~424), `packages/fiscal-verifactu/src/errors.ts`
- Test: `packages/fiscal-verifactu/src/drain.test.ts`

**Interfaces:**
- Consumes: `entorno` on `DueRow` — already present, because `claimBatch` selects `r.*`.
- Produces: `DrainDeps` gains `environment: string`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/fiscal-verifactu/src/drain.test.ts`:

```typescript
it("refuses to submit a registro generated for another environment", async () => {
  const { tenantId } = await seedPendingEnvios(db, { entorno: "preproduction" });
  const result = await drain(db, { ...deps, environment: "production" });

  expect(result.recordsSubmitted).toBe(0);
  expect(result.incidentsRaised).toBe(1);

  const envio = await db.execute<{ estado: string }>(
    sql`select estado from envios where tenant_id = ${tenantId}`,
  );
  // Left pendiente, not failed: fixing the host's configuration and restarting must be enough.
  expect(envio.rows[0]!.estado).toBe("pendiente");
});

it("refuses a registro with no recorded environment, distinctly from a mismatch", async () => {
  await seedPendingEnvios(db, { entorno: null });
  const result = await drain(db, { ...deps, environment: "production" });
  expect(result.recordsSubmitted).toBe(0);
  expect(lastIncidentCode()).toBe("fiscal.environment_unknown");
});

it("submits normally when the environments agree", async () => {
  await seedPendingEnvios(db, { entorno: "production" });
  const result = await drain(db, { ...deps, environment: "production" });
  expect(result.recordsSubmitted).toBeGreaterThan(0);
});
```

Extend `seedPendingEnvios` in `test/drain-fixtures.ts` to accept `entorno`, defaulting to `"production"` so every existing caller keeps submitting.

- [ ] **Step 2: Run to verify they fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.test.ts`
Expected: FAIL — rows are submitted regardless of `entorno`.

- [ ] **Step 3: Implement**

In `drain.ts`, immediately after `claimBatch` returns and before the batch is serialized, partition the rows:

```typescript
  // A mismatch is never transient, so these are reported and left alone rather than retried with
  // backoff. The `envios` row stays `pendiente`: correcting WAITRON_ENV and restarting must be
  // enough to make them send, and marking them failed would need a second, manual reversal.
  const sendable: DueRow[] = [];
  for (const row of claimed) {
    const mismatch =
      row.entorno === null
        ? new AppError("fiscal.environment_unknown", {
            recordId: row.id,
            hostEnvironment: deps.environment,
          })
        : row.entorno !== deps.environment
          ? new AppError("fiscal.environment_mismatch", {
              recordId: row.id,
              recordEnvironment: row.entorno,
              hostEnvironment: deps.environment,
            })
          : null;

    if (mismatch === null) {
      sendable.push(row);
    } else {
      await raiseIncident(tx, row, "error", mismatch, now, result);
    }
  }
  if (sendable.length === 0) return;
```

`raiseIncident` is this file's existing private helper (signature: `(tx, row: DueRow, severity: IncidentSeverity, error: AppError, now: Date, result: DrainResult)`), which delegates to `@waitron/core`'s `recordIncident`. Use it — do not add a second incident path, and do not call `recordIncident` directly, because `raiseIncident` is what keeps `result`'s counters correct.

Because the rows were claimed `for update of e skip locked`, releasing them without an `estado` change happens naturally when the transaction ends — no explicit update is needed to leave them `pendiente`.

Add both codes to `packages/fiscal-verifactu/src/errors.ts`:

```typescript
    /** A registro generated for one environment reached a host configured for the other. Never
     * retried: a mismatch is a configuration fact, not a transient failure. */
    "fiscal.environment_mismatch": {
      recordId: string;
      recordEnvironment: string;
      hostEnvironment: string;
    };
    /** A registro written before `entorno` existed, so nothing recorded where it was destined.
     * Refused rather than assumed — guessing is what this whole design prevents. */
    "fiscal.environment_unknown": { recordId: string; hostEnvironment: string };
```

- [ ] **Step 4: Run to verify they pass, then prove the guard by deletion**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test`
Expected: PASS.

Then temporarily delete the `row.entorno !== deps.environment` branch and re-run. The mismatch test MUST fail. Restore it. A guard that passes with the check removed is not testing the guard.

- [ ] **Step 5: Commit**

```bash
git add packages/fiscal-verifactu
git commit -s -m "feat(fiscal): drain refuses a registro from another environment

Reported, never retried — a mismatch is a configuration fact, not a
transient failure. The envios row stays pendiente so that correcting
WAITRON_ENV and restarting is enough to release it. A NULL entorno is
refused under its own code rather than assumed to be ours."
```

---

## Task 7: Documentation

**Files:**
- Modify: `apps/server/README.md` (the `WAITRON_AEAT_ENV` entry in "Environment variables"), `docs/superpowers/specs/2026-07-26-server-host-design.md`, `docs/superpowers/plans/2026-07-26-server-host.md`, `docs/superpowers/plans/2026-07-28-first-aeat-submission.md`, `docs/superpowers/specs/2026-07-28-first-aeat-submission-design.md`, `packages/db/src/english-only.ts`

- [ ] **Step 1: Find every remaining mention**

Run: `grep -rn "WAITRON_AEAT_ENV" --include='*.ts' --include='*.md' --include='*.yml' apps packages docs .github`

- [ ] **Step 2: Update each**

In `apps/server/README.md`, replace the variable name and widen the description: it now selects the AEAT endpoint family *and* the Stripe key mode a tenant's credential must match. State the default (`preproduction`) and that `production` must be typed out.

Historical documents — the two `2026-07-26-server-host*` files and the two `2026-07-28-first-aeat-submission*` files — record what was true when written. Do **not** rewrite their history; add a one-line note where the variable appears:

> `WAITRON_AEAT_ENV` was replaced by `WAITRON_ENV` on 2026-07-29 — see the deployment-environment design.

`packages/db/src/english-only.ts` matches the name as a string; update it so the check keeps working.

- [ ] **Step 3: Run the full gate**

```bash
pnpm lint && pnpm typecheck && pnpm format:check
TESTCONTAINERS_RYUK_DISABLED=true pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -s -m "docs: WAITRON_ENV, and what it now governs

Historical specs and plans keep their original text with a pointer, rather
than being rewritten to claim they always said WAITRON_ENV."
```

---

## Verification

| Claim | How it is proven | Where |
| --- | --- | --- |
| Unset still means pre-production | Test asserts it directly | Task 1 |
| A database has exactly one environment, ever | CHECK pins `id = 1`; a second insert fails | Task 2 |
| Restamping a different environment is refused | Test asserts the code and that the original survives | Task 2 |
| A mismatched host writes nothing | Boot test asserts the throw AND that no migration ran | Task 3 |
| Unstamped databases still boot | Test asserts it | Task 3 |
| A wrong-mode Stripe key fails one tenant, loudly | Test asserts the code | Task 4 |
| No key material reaches an error | Test asserts the serialized error contains neither the key nor `sk_test` | Task 4 |
| An unclassifiable key is accepted, not guessed | Test asserts `rk_live_` passes | Task 4 |
| `entorno` never changes the huella | Two records differing only in `entorno` hash identically | Task 5 |
| A mismatched registro is not submitted | Test asserts it, and the guard is proven by deletion | Task 6 |
| A mismatched registro stays retryable | Test asserts `estado` is still `pendiente` | Task 6 |
| A NULL `entorno` is refused distinctly | Test asserts the separate code | Task 6 |

## What this plan does NOT do

- It does not repair a database that is already mixed. Nothing can — the invoice series has a hole (design §2).
- It does not stamp any existing database. `stampDeployment` exists and is tested; the provisioning tool calls it. Until then every database reads as unstamped and is covered by the `entorno` guard alone.
- It adds no AEAT certificate check. The same certificate is valid against both environments, so there is nothing to compare.

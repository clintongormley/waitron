# Recurring-Work Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/scheduler` — a duty-neutral, library-only runner that derives due recurring work from a run ledger, executes it, records the outcome durably, and re-sweeps a period when a duty asks it to.

**Architecture:** Work is DERIVED, never enqueued: a gap in the `scheduled_runs` ledger IS the work, so there is no successor row to lose. Three sources of work (gap / claimable / stale) reduce to two single-statement conditional claims. Duties are injected and typed structurally, so this package never imports `@waitron/payments` or `@waitron/fiscal`. Every duty runs OUTSIDE any transaction — the T1/network/T2 discipline `reconcilePayments` already uses.

**Tech Stack:** TypeScript (ESM, Node ≥24), Drizzle ORM (`pg-core`), PostgreSQL 18, Vitest, PGlite for fast suites, Testcontainers for real-Postgres suites.

**Spec:** [`2026-07-25-recurring-work-scheduler-design.md`](../specs/2026-07-25-recurring-work-scheduler-design.md). Read it before Task 1 — every "why" lives there and is not repeated here.

## Global Constraints

- **English throughout** — identifiers, table and column names alike. `packages/db`'s `english-only.ts` guard enumerates `GENERIC_PACKAGES` explicitly; `"scheduler"` must be added to it (Task 1) or this package silently escapes the guard.
- **Never import `@waitron/payments` or `@waitron/fiscal` as a runtime dependency.** Duties are injected and typed structurally. `@waitron/payments` is a **dev** dependency, used only by the Task 7 type-fit test.
- **No prose in the database.** `error_code` is a structured `AppError` code (or the literal `"unknown"`); `summary` is structured data. The display layer localises from the code.
- **Every duty invocation happens outside every transaction.** A duty makes network calls.
- **Every claim is a single-statement conditional write**, rowcount- or returning-checked. No advisory locks, no `SELECT … FOR UPDATE` read-then-write.
- **No silent caps.** Both bounds (`maxPeriodsPerTick`, `horizonDays`) report what they dropped, on the result.
- **Timestamps are `mode: "string"`** (ISO-8601) throughout this package's schema, matching `packages/payments`.
- **Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally.** Never commit it.
- Run `pnpm --filter @waitron/scheduler test` after every task; `pnpm --filter @waitron/scheduler typecheck` and `pnpm lint` before every commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/scheduler/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts` | Package scaffolding, mirroring `packages/payments` |
| `src/schema/scheduled-runs.ts` | The `scheduled_runs` table — the only table this package owns |
| `src/schema/index.ts` | Drizzle snapshot source: explicit re-exports, never `export *` |
| `src/migrations.ts` | `SCHEDULER_MIGRATIONS` descriptor |
| `drizzle/0000_scheduler.sql` | Generated DDL |
| `drizzle/0001_scheduler_rls.sql` | Hand-written: FORCE RLS, tenant-isolation policy, grants |
| `src/duty.ts` | The injected seam — `PeriodDuty`, `RunPeriod`, `DutyOutcome`. What a duty implementer reads |
| `src/derive.ts` | Pure derivation: UTC day tiling, floor, gaps, claimable, stale, caps, `nextDueAt` |
| `src/store.ts` | Ledger SQL: the two claim statements, stale reclaim, completion, successor enqueue, snapshot read |
| `src/run.ts` | `runDue` orchestration: per-tenant loop, failure isolation, retry/park, `TickResult` |
| `src/index.ts` | Public barrel — re-exports only |
| `src/testing/fake-duty.ts` | Programmable `PeriodDuty` fake |
| `src/testing/postgres.ts` | Testcontainers harness applying CORE then SCHEDULER migrations |
| `test/seed.ts` | `seedTenant` + `freshNif` |

---

### Task 1: The package, the ledger table, and its migrations

**Files:**
- Create: `packages/scheduler/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`
- Create: `packages/scheduler/src/schema/scheduled-runs.ts`, `src/schema/index.ts`, `src/migrations.ts`
- Create: `packages/scheduler/drizzle/0001_scheduler_rls.sql` (`0000_scheduler.sql` is generated)
- Create: `packages/scheduler/src/schema-ownership.test.ts`, `src/migrations.test.ts`
- Modify: `packages/db/src/english-only.ts:8` (add `"scheduler"` to `GENERIC_PACKAGES`)

**Interfaces:**
- Consumes: `tenants` from `@waitron/db`; `CORE_MIGRATIONS`, `runMigrations`, `createPgliteDb` from `@waitron/db`.
- Produces: `scheduledRuns` table and `RunState` type from `./schema/scheduled-runs.js`; `SCHEDULER_MIGRATIONS` from `./migrations.js`.

- [ ] **Step 1: Scaffold the package**

`packages/scheduler/package.json`:

```json
{
  "name": "@waitron/scheduler",
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
    "@waitron/payments": "workspace:*",
    "drizzle-kit": "^0.31.10",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/scheduler/tsconfig.json`:

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

`packages/scheduler/drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // One config produces exactly one migration folder, which is why this package needs its own
  // rather than an entry in core's. Same reasoning as packages/payments/drizzle.config.ts.
  out: "./drizzle",
  // Pointed at the entrypoint, NOT a `src/schema/*.ts` glob: drizzle-kit builds its snapshot from
  // the values this module exports, so the explicit export list IS the snapshot's table list.
  schema: "./src/schema/index.ts",
  // Its own journal table. Sharing core's would make each package's `generate` see the other's
  // applied migrations as unknown and silently re-apply its own from zero.
  migrations: { table: "__drizzle_migrations_scheduler", schema: "public" },
});
```

`packages/scheduler/vitest.config.ts`:

```typescript
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // PGlite boots a WASM PostgreSQL and applies two migration sets; the RLS and store suites
    // additionally pull and start a real Postgres container. Both costs are one-off, paid in a
    // beforeAll, so hookTimeout is the generous one.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, and this
    // package is small enough that a handful of mis-merged branches sinks the ratio under the
    // threshold. Same finding as packages/payments.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
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

- [ ] **Step 2: Confirm the workspace picks the package up**

Run: `grep -n packages pnpm-workspace.yaml`
Expected: a `packages/*` glob. If it lists packages individually, add `packages/scheduler`.

Then: `pnpm install`
Expected: `@waitron/scheduler` resolves its workspace deps with no errors.

- [ ] **Step 3: Write the schema**

`packages/scheduler/src/schema/scheduled-runs.ts`:

```typescript
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/**
 * The lifecycle of one scheduled run. `pending` is work enqueued but not yet attempted (a
 * re-sweep); `failed` will be retried; `parked` has exhausted its attempts and never will be.
 * `succeeded` and `parked` are the two TERMINAL states — the successor-enqueue guard keys on
 * exactly that distinction.
 */
export const runState = ["pending", "running", "succeeded", "failed", "parked"] as const;
export type RunState = (typeof runState)[number];

/**
 * One attempt-carrying record of one duty over one period. The runner holds no queue: it derives
 * due work by asking which periods have NO row here, so this table is a record rather than a
 * schedule — there is no successor row whose loss would silently stop a duty.
 *
 * `generation` is what makes the unique key safe. A table-wide unique on
 * (tenant_id, duty, period_from) would break the one caller that legitimately needs N rows per
 * key: a re-sweep must run a period AGAIN without overwriting what the first sweep recorded.
 */
export const scheduledRuns = pgTable(
  "scheduled_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** `PeriodDuty.name`. Changing a duty's name orphans its history — it is an identifier. */
    duty: text("duty").notNull(),
    /** The half-open `[period_from, period_to)` stored explicitly, never derived: a later
     * timezone-aware cadence must change how periods are COMPUTED, not what past rows mean. */
    periodFrom: timestamp("period_from", { withTimezone: true, mode: "string" }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true, mode: "string" }).notNull(),
    /** 0 = derived from a gap; N > 0 = the Nth re-sweep of the same period. */
    generation: integer("generation").notNull().default(0),
    state: text("state").$type<RunState>().notNull(),
    /** Incremented at CLAIM, not at completion — so a run stranded by a crash has already spent
     * its attempt, and a reclaim cannot loop for ever. */
    attempts: integer("attempts").notNull().default(0),
    /** When this row becomes claimable. Null unless `pending` or `failed`. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "string" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
    /** The duty's own result, stored verbatim. Null until a run finishes. This is the durable home
     * for findings a duty cannot otherwise persist — payments reconcile's `remediationFailures`
     * names the scheduler as its owner. */
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    /** A structured code — an AppError code, or the literal "unknown". NEVER prose. */
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // restrict, not cascade: this is an operational audit record, and the money-path FKs in
    // packages/payments restrict for the same reason.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "scheduled_runs_tenant_fk",
    }).onDelete("restrict"),
    // The claim-by-INSERT depends on this: ON CONFLICT DO NOTHING against this key is what makes
    // "the insert IS the lock" true.
    uniqueIndex("scheduled_runs_key").on(t.tenantId, t.duty, t.periodFrom, t.generation),
    // NO separate (tenant_id, duty, period_from) index: the unique key's own leading columns
    // already serve gap derivation, and a second one would be dead weight on the write path.
    index("scheduled_runs_claimable_idx")
      .on(t.nextAttemptAt)
      .where(sql`state in ('pending', 'failed')`),
    check(
      "scheduled_runs_state_ck",
      sql`${t.state} in ('pending', 'running', 'succeeded', 'failed', 'parked')`,
    ),
    check("scheduled_runs_period_ck", sql`${t.periodFrom} < ${t.periodTo}`),
    check("scheduled_runs_generation_ck", sql`${t.generation} >= 0`),
    check("scheduled_runs_attempts_ck", sql`${t.attempts} >= 0`),
  ],
).enableRLS();
```

> **Superseded, kept as the record of what was planned:** `scheduled_runs_claimable_idx` was
> removed before the branch merged. No query reads it — every claim keys on `id`, and derivation
> reads by `(tenant_id, duty)` then filters `next_attempt_at` in JavaScript — so it was pure write
> cost, which is the same objection the comment above it raises against a
> `(tenant_id, duty, period_from)` index. `scheduled_runs_key` is the table's only index; see the
> design's §4. Do not copy the `index(...)` call above into new work.

`packages/scheduler/src/schema/index.ts`:

```typescript
// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table. The schema file imports `tenants` to declare a foreign
// key; it must NEVER be re-exported, or it lands in this package's snapshot as a duplicate CREATE
// TABLE that fails at apply time. `schema-ownership.test.ts` enforces this.
export { runState, scheduledRuns } from "./scheduled-runs.js";
export type { RunState } from "./scheduled-runs.js";
```

`packages/scheduler/src/migrations.ts`:

```typescript
import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data rather than a function because ordering across
 * packages is the RUNTIME's responsibility — core migrations must run before these (the `tenants`
 * foreign key) — and a descriptor makes the caller state that order out loud.
 */
export const SCHEDULER_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_scheduler",
} as const;
```

- [ ] **Step 4: Generate the DDL migration**

Run: `pnpm --filter @waitron/scheduler db:generate`
Expected: `drizzle/0000_scheduler.sql` created, containing `CREATE TABLE "scheduled_runs"`, the FK, the unique index, the partial index and the four CHECKs. It must NOT contain `CREATE TABLE "tenants"`.

- [ ] **Step 5: Hand-write the RLS migration**

`packages/scheduler/drizzle/0001_scheduler_rls.sql`:

```sql
-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- packages/payments' 0001_payments_rls.sql: drizzle-kit has no concept of policies, FORCE, or
-- privileges. current_tenant_id() already exists (packages/db 0001_tenancy_rls.sql; core runs first).

--> statement-breakpoint
ALTER TABLE "scheduled_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "scheduled_runs_tenant_isolation" ON "scheduled_runs"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- No DELETE: a run record is never row-deleted. It is the audit trail.
REVOKE ALL ON "scheduled_runs" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "scheduled_runs" TO app_user;
```

- [ ] **Step 6: Write the failing ownership and migration tests**

`packages/scheduler/src/schema-ownership.test.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = ["scheduled_runs"];

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

describe("the scheduler schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    const exported = Object.values(schema)
      .filter((v): v is PgTable => is(v, PgTable))
      .map(getTableName)
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

`packages/scheduler/src/migrations.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, type Database } from "@waitron/db";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  // Core first — the tenants foreign key. Ordering across packages is the runtime's job and
  // nothing enforces it, so it is explicit here.
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, SCHEDULER_MIGRATIONS);
});

describe("the scheduler migration set", () => {
  it("creates scheduled_runs with row-level security forced", async () => {
    const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
      select relrowsecurity, relforcerowsecurity
        from pg_class where relname = 'scheduled_runs'`);
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("rejects a period whose end does not follow its start", async () => {
    await expect(
      db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, state)
        values (gen_random_uuid(), 'x', '2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z', 'pending')`),
    ).rejects.toThrow(/scheduled_runs_period_ck/);
  });

  it("rejects an unknown state", async () => {
    await expect(
      db.execute(sql`
        insert into scheduled_runs (tenant_id, duty, period_from, period_to, state)
        values (gen_random_uuid(), 'x', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'wat')`),
    ).rejects.toThrow(/scheduled_runs_state_ck/);
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/scheduler test`
Expected: FAIL — either the migration folder does not yet contain `0000_scheduler.sql` (if Step 4 was skipped) or the constraints are absent. If both files exist and everything passes on the first run, verify the SQL was really generated before moving on.

- [ ] **Step 8: Register the package with the english-only guard**

Modify `packages/db/src/english-only.ts:8`:

```typescript
export const GENERIC_PACKAGES = ["db", "core", "fiscal", "shared", "payments", "scheduler"] as const;
```

- [ ] **Step 9: Run the full check**

Run: `pnpm --filter @waitron/scheduler test && pnpm --filter @waitron/db test && pnpm --filter @waitron/scheduler typecheck && pnpm lint`
Expected: all PASS. The `@waitron/db` run is what proves the english-only guard now scans this package and finds it clean.

- [ ] **Step 10: Commit**

```bash
git add packages/scheduler packages/db/src/english-only.ts pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(scheduler): the scheduled_runs ledger, its migrations and RLS"
```

---

### Task 2: The duty seam and UTC day tiling

**Files:**
- Create: `packages/scheduler/src/duty.ts`
- Create: `packages/scheduler/src/derive.ts` (tiling helpers only; Task 3 adds `derive`)
- Test: `packages/scheduler/src/derive.test.ts`

**Interfaces:**
- Consumes: `TenantId` from `@waitron/shared`.
- Produces: `PeriodDuty`, `RunPeriod`, `DutyOutcome` from `./duty.js`; `utcDayStart(at: Date): Date`, `dayPeriod(start: Date): RunPeriod`, `mostRecentCompleteDay(now: Date): Date`, `DAY_MS` from `./derive.js`.

- [ ] **Step 1: Write the failing tiling test**

`packages/scheduler/src/derive.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DAY_MS, dayPeriod, mostRecentCompleteDay, utcDayStart } from "./derive.js";

describe("utcDayStart", () => {
  it("floors a mid-day instant to midnight UTC", () => {
    expect(utcDayStart(new Date("2026-07-24T13:45:12.345Z"))).toEqual(
      new Date("2026-07-24T00:00:00.000Z"),
    );
  });

  it("is a fixed point at midnight", () => {
    const midnight = new Date("2026-07-24T00:00:00.000Z");
    expect(utcDayStart(midnight)).toEqual(midnight);
  });
});

describe("dayPeriod", () => {
  it("is half-open over exactly one day", () => {
    expect(dayPeriod(new Date("2026-07-24T00:00:00Z"))).toEqual({
      from: new Date("2026-07-24T00:00:00Z"),
      to: new Date("2026-07-25T00:00:00Z"),
    });
  });

  // A UTC day is always 86_400_000ms — no DST to shorten or lengthen it. This is the whole reason
  // the cadence is UTC-tiled rather than tenant-local: a local day is not a fixed width, and no
  // timezone column exists on tenants or locations to derive one from.
  it("spans a constant width across a European DST boundary", () => {
    const period = dayPeriod(new Date("2026-10-25T00:00:00Z"));
    expect(period.to.getTime() - period.from.getTime()).toBe(DAY_MS);
  });
});

describe("mostRecentCompleteDay", () => {
  it("is yesterday for a mid-day now", () => {
    expect(mostRecentCompleteDay(new Date("2026-07-25T13:00:00Z"))).toEqual(
      new Date("2026-07-24T00:00:00Z"),
    );
  });

  // At exactly midnight, yesterday's period_to equals now — and eligibility is `period_to <= now`,
  // so it IS complete. Off-by-one here would skip a day on any host that ticks on the hour.
  it("is yesterday at exactly midnight, whose period ends exactly at now", () => {
    const now = new Date("2026-07-25T00:00:00Z");
    const day = mostRecentCompleteDay(now);
    expect(day).toEqual(new Date("2026-07-24T00:00:00Z"));
    expect(dayPeriod(day).to.getTime()).toBe(now.getTime());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/scheduler test derive`
Expected: FAIL — `Failed to resolve import "./derive.js"`.

- [ ] **Step 3: Write the duty seam**

`packages/scheduler/src/duty.ts`:

```typescript
import type { TenantId } from "@waitron/shared";

/** Half-open `[from, to)`. Structurally identical to payments' `ReconcilePeriod`, deliberately:
 * a `PaymentReconciler` must adapt to a `PeriodDuty` without either package importing the other. */
export interface RunPeriod {
  from: Date;
  to: Date;
}

/** What a duty hands back. */
export interface DutyOutcome {
  /** Stored verbatim in `scheduled_runs.summary`. Structured data only — never prose, and never a
   * `Date` (serialise to ISO first): this is the duty's durable record. */
  summary: Record<string, unknown>;
  /**
   * Set when this run left something unresolved that a LATER sweep of the SAME period could
   * resolve. The runner enqueues a fresh generation of this period due at that time, and never
   * learns why — which is what keeps it duty-neutral.
   *
   * Without this, nothing would ever re-derive a successfully-swept period: it has no gap. This
   * is what makes a gated drift orphan self-healing rather than merely re-reported.
   */
  resweepAfter?: Date;
}

/**
 * One recurring duty over calendar periods. Typed structurally and injected, so this package never
 * imports `@waitron/payments` or `@waitron/fiscal` — the same reason payments' `IncidentSink` is
 * structural rather than an import of `@waitron/core`.
 *
 * `now` is a parameter, exactly as `drain(now)` / `forward(now)` / `reconcile(…, now)` take it: an
 * injected clock is what makes the boundary testable.
 *
 * There is deliberately no second duty kind for `nextDueAt`-shaped duties (`drain`, `forward`).
 * See the design's §3: an interface with no caller and no meaningful fake is dead surface. Adding
 * one is a new source of due work in `derive` plus a migration, not a rewrite.
 */
export interface PeriodDuty {
  /** Stable ledger key, e.g. "payments.reconcile.stripe". It is an identifier: changing it orphans
   * that duty's history and restarts derivation from the most recent complete period. */
  readonly name: string;
  readonly cadence: "daily";
  run(tenantId: TenantId, period: RunPeriod, now: Date): Promise<DutyOutcome>;
}
```

- [ ] **Step 4: Write the tiling helpers**

`packages/scheduler/src/derive.ts`:

```typescript
import type { RunPeriod } from "./duty.js";

/** A UTC day is a constant width — no DST. That constancy is why the cadence tiles UTC days. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Floor an instant to midnight UTC. */
export function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** The half-open day beginning at `start`. */
export function dayPeriod(start: Date): RunPeriod {
  return { from: start, to: new Date(start.getTime() + DAY_MS) };
}

/**
 * The latest day whose period has fully elapsed at `now` — the newest period eligible to run.
 *
 * Eligibility is `period_to <= now` and nothing more: there is no settle-grace, because a
 * freshly-closed day cannot produce a false finding. `unsettled` escalates only past the
 * settlement lag; `drift` needs a MATCHED settlement, so one the processor has not posted yet
 * yields nothing rather than a false alarm; `orphan` is local-only; and an unmatched settlement
 * gets a targeted all-time existence check before it can be `missingLocal`.
 */
export function mostRecentCompleteDay(now: Date): Date {
  return new Date(utcDayStart(now).getTime() - DAY_MS);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/scheduler test derive`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/scheduler/src/duty.ts packages/scheduler/src/derive.ts packages/scheduler/src/derive.test.ts
git commit -m "feat(scheduler): the PeriodDuty seam and UTC day tiling"
```

---

### Task 3: Deriving due work

**Files:**
- Modify: `packages/scheduler/src/derive.ts` (add `derive` and its types)
- Test: `packages/scheduler/src/derive.test.ts` (add a `derive` describe block)

**Interfaces:**
- Consumes: `RunPeriod` from `./duty.js`; `RunState` from `./schema/scheduled-runs.js`; `DAY_MS`, `utcDayStart`, `dayPeriod`, `mostRecentCompleteDay` from Task 2.
- Produces: `LedgerRow`, `LedgerSnapshot`, `DeriveConfig`, `DueWork`, `Derivation`, `derive(snapshot, now, config): Derivation`, and `DEFAULTS` from `./derive.js`.

- [ ] **Step 1: Write the failing derivation tests**

Append to `packages/scheduler/src/derive.test.ts`:

```typescript
import { derive, type LedgerRow, type LedgerSnapshot } from "./derive.js";

const NOW = new Date("2026-07-25T04:00:00Z");
const CONFIG = { horizonDays: 30, maxPeriodsPerTick: 7, staleAfterMs: 3_600_000 };

function row(overrides: Partial<LedgerRow> & { periodFrom: string }): LedgerRow {
  return {
    id: `id-${overrides.periodFrom}`,
    generation: 0,
    state: "succeeded",
    attempts: 1,
    nextAttemptAt: null,
    startedAt: null,
    periodTo: new Date(new Date(overrides.periodFrom).getTime() + DAY_MS).toISOString(),
    ...overrides,
  };
}

function snapshot(rows: LedgerRow[], recordedBelowHorizon = 0): LedgerSnapshot {
  const earliest = rows.length === 0 ? null : rows.map((r) => r.periodFrom).sort()[0]!;
  return { rows, earliestPeriodFrom: earliest, recordedBelowHorizon };
}

describe("derive: a duty that has never run", () => {
  // The floor for a duty with no rows is the most recent complete period, NOT the horizon: you
  // cannot have missed periods before you existed. Otherwise day one runs thirty empty sweeps.
  it("starts from the most recent complete period, not the horizon", () => {
    const result = derive(snapshot([]), NOW, CONFIG);
    expect(result.due).toHaveLength(1);
    expect(result.due[0]).toEqual({
      kind: "gap",
      period: dayPeriod(new Date("2026-07-24T00:00:00Z")),
    });
    expect(result.beyondHorizon).toBe(0);
    expect(result.deferred).toBe(0);
  });
});

describe("derive: gaps", () => {
  it("finds nothing when the most recent complete period already succeeded", () => {
    const result = derive(snapshot([row({ periodFrom: "2026-07-24T00:00:00.000Z" })]), NOW, CONFIG);
    expect(result.due).toEqual([]);
  });

  it("finds every missing day between the floor and the most recent complete one", () => {
    const result = derive(snapshot([row({ periodFrom: "2026-07-21T00:00:00.000Z" })]), NOW, CONFIG);
    expect(result.due.map((w) => w.kind)).toEqual(["gap", "gap", "gap"]);
    expect(result.due.map((w) => (w.kind === "gap" ? w.period.from.toISOString() : ""))).toEqual([
      "2026-07-22T00:00:00.000Z",
      "2026-07-23T00:00:00.000Z",
      "2026-07-24T00:00:00.000Z",
    ]);
  });

  it("caps the tick oldest-first and reports what it deferred", () => {
    const result = derive(snapshot([row({ periodFrom: "2026-07-01T00:00:00.000Z" })]), NOW, {
      ...CONFIG,
      maxPeriodsPerTick: 2,
    });
    expect(result.due).toHaveLength(2);
    expect(result.due.map((w) => (w.kind === "gap" ? w.period.from.toISOString() : ""))).toEqual([
      "2026-07-02T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z",
    ]);
    expect(result.deferred).toBe(21);
  });

  // A duty broken for longer than the horizon loses those periods for good. The result must SAY
  // so — reading as full coverage is the silent failure this ledger exists to prevent.
  it("reports never-swept days that fell off the horizon and never runs them", () => {
    const result = derive(
      snapshot([row({ periodFrom: "2026-05-01T00:00:00.000Z" })], 1),
      NOW,
      CONFIG,
    );
    // Floor 2026-05-01, horizon start 2026-06-25: 55 days below the horizon, 1 of them recorded.
    expect(result.beyondHorizon).toBe(54);
    const earliestRun = result.due[0];
    expect(earliestRun?.kind === "gap" && earliestRun.period.from.toISOString()).toBe(
      "2026-06-25T00:00:00.000Z",
    );
  });
});

describe("derive: claimable rows", () => {
  it("returns a failed row whose backoff has elapsed", () => {
    const failed = row({
      periodFrom: "2026-07-24T00:00:00.000Z",
      state: "failed",
      attempts: 1,
      nextAttemptAt: "2026-07-25T03:00:00.000Z",
    });
    const result = derive(snapshot([failed]), NOW, CONFIG);
    expect(result.due).toEqual([{ kind: "claimable", row: failed }]);
  });

  it("leaves a failed row alone until its backoff elapses", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "failed",
          attempts: 1,
          nextAttemptAt: "2026-07-25T05:00:00.000Z",
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.due).toEqual([]);
    expect(result.nextDueAt).toEqual(new Date("2026-07-25T05:00:00.000Z"));
  });

  it("returns a pending re-sweep whose due time has arrived, however old its period", () => {
    // Generation 1 over a period far below the horizon. A re-sweep is EXPLICIT work, so the
    // horizon — which bounds gap derivation only — must not bury it.
    const pending = row({
      periodFrom: "2026-01-02T00:00:00.000Z",
      generation: 1,
      state: "pending",
      attempts: 0,
      nextAttemptAt: "2026-07-25T03:00:00.000Z",
    });
    const result = derive(snapshot([pending], 1), NOW, CONFIG);
    expect(result.due).toContainEqual({ kind: "claimable", row: pending });
  });

  it("never returns a parked row", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "parked",
          attempts: 3,
          nextAttemptAt: null,
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.due).toEqual([]);
  });
});

describe("derive: stale claims", () => {
  // Without this, a process crashed mid-run locks that period FOREVER — and no gap reveals it,
  // because the row exists. It is the ledger's own worst failure mode.
  it("reclaims a running row stranded past staleAfterMs", () => {
    const stranded = row({
      periodFrom: "2026-07-24T00:00:00.000Z",
      state: "running",
      attempts: 1,
      startedAt: "2026-07-25T02:00:00.000Z",
    });
    const result = derive(snapshot([stranded]), NOW, CONFIG);
    expect(result.due).toEqual([{ kind: "stale", row: stranded }]);
  });

  it("leaves a running row alone inside staleAfterMs", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "running",
          attempts: 1,
          startedAt: "2026-07-25T03:30:00.000Z",
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.due).toEqual([]);
  });
});

describe("derive: nextDueAt", () => {
  it("is the next day boundary when nothing else is pending", () => {
    const result = derive(snapshot([row({ periodFrom: "2026-07-24T00:00:00.000Z" })]), NOW, CONFIG);
    expect(result.nextDueAt).toEqual(new Date("2026-07-26T00:00:00.000Z"));
  });

  it("is the earliest of the next boundary and a future backoff", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "failed",
          attempts: 1,
          nextAttemptAt: "2026-07-25T06:00:00.000Z",
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.nextDueAt).toEqual(new Date("2026-07-25T06:00:00.000Z"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/scheduler test derive`
Expected: FAIL — `derive` is not exported.

- [ ] **Step 3: Implement `derive`**

Append to `packages/scheduler/src/derive.ts`:

```typescript
import type { RunState } from "./schema/scheduled-runs.js";

/** The subset of a ledger row derivation reads. Timestamps are ISO strings, as stored. */
export interface LedgerRow {
  id: string;
  periodFrom: string;
  periodTo: string;
  generation: number;
  state: RunState;
  attempts: number;
  nextAttemptAt: string | null;
  startedAt: string | null;
}

/**
 * Everything derivation needs about one (tenant, duty), read in one place so the derivation itself
 * stays pure.
 *
 * `rows` deliberately spans TWO ranges: every row at or above the horizon start (gap derivation
 * needs to know which recent days are already recorded) plus every NON-TERMINAL row at any age (a
 * re-sweep chain older than the horizon must stay claimable). Counting missing days BELOW the
 * horizon would be an unbounded read, so it arrives pre-aggregated as `recordedBelowHorizon`.
 */
export interface LedgerSnapshot {
  rows: LedgerRow[];
  /** `min(period_from)` over ALL rows, or null when the duty has never run. */
  earliestPeriodFrom: string | null;
  /** How many distinct periods below the horizon start have a row. */
  recordedBelowHorizon: number;
}

export interface DeriveConfig {
  horizonDays: number;
  maxPeriodsPerTick: number;
  staleAfterMs: number;
}

/** One unit of due work, tagged by how it was found — which decides which claim statement runs. */
export type DueWork =
  | { kind: "gap"; period: RunPeriod }
  | { kind: "claimable"; row: LedgerRow }
  | { kind: "stale"; row: LedgerRow };

export interface Derivation {
  /** Oldest-first, already capped at `maxPeriodsPerTick`. */
  due: DueWork[];
  /** Due work this tick will not run because of the cap. */
  deferred: number;
  /** Never-swept days dropped permanently by the horizon. */
  beyondHorizon: number;
  /** Earliest FUTURE time work appears. The caller overrides it with `now` when `deferred > 0`. */
  nextDueAt: Date;
}

const TERMINAL: readonly RunState[] = ["succeeded", "parked"];

/** Defaults for the whole runner, in one place so a host overrides one without restating the rest. */
export const DEFAULTS = {
  horizonDays: 30,
  maxPeriodsPerTick: 7,
  maxAttempts: 3,
  backoffBaseMs: 15 * 60 * 1000,
  staleAfterMs: 60 * 60 * 1000,
} as const;

export function derive(
  snapshot: LedgerSnapshot,
  now: Date,
  config: DeriveConfig,
): Derivation {
  const newest = mostRecentCompleteDay(now);
  const horizonStart = new Date(utcDayStart(now).getTime() - config.horizonDays * DAY_MS);
  const floor =
    snapshot.earliestPeriodFrom === null ? newest : new Date(snapshot.earliestPeriodFrom);
  const start = new Date(Math.max(floor.getTime(), horizonStart.getTime()));

  const recorded = new Set(snapshot.rows.map((r) => new Date(r.periodFrom).getTime()));
  const gaps: DueWork[] = [];
  for (let t = start.getTime(); t <= newest.getTime(); t += DAY_MS) {
    if (!recorded.has(t)) gaps.push({ kind: "gap", period: dayPeriod(new Date(t)) });
  }

  const nowMs = now.getTime();
  const claimable: DueWork[] = [];
  const stale: DueWork[] = [];
  let earliestFuture = Number.POSITIVE_INFINITY;
  for (const r of snapshot.rows) {
    if (r.state === "running") {
      // startedAt is never null on a `running` row — both claim statements set it — but a null
      // here would mean "stranded with no clock", which must not silently become reclaimable.
      if (r.startedAt !== null && Date.parse(r.startedAt) < nowMs - config.staleAfterMs) {
        stale.push({ kind: "stale", row: r });
      }
      continue;
    }
    if (TERMINAL.includes(r.state) || r.nextAttemptAt === null) continue;
    const due = Date.parse(r.nextAttemptAt);
    if (due <= nowMs) claimable.push({ kind: "claimable", row: r });
    else earliestFuture = Math.min(earliestFuture, due);
  }

  const all = [...gaps, ...claimable, ...stale].sort(
    (a, b) => periodStart(a).getTime() - periodStart(b).getTime(),
  );

  // The next gap appears when today's period closes.
  const nextBoundary = utcDayStart(now).getTime() + DAY_MS;

  let beyondHorizon = 0;
  if (floor.getTime() < horizonStart.getTime()) {
    const daysBelow = Math.round((horizonStart.getTime() - floor.getTime()) / DAY_MS);
    beyondHorizon = daysBelow - snapshot.recordedBelowHorizon;
  }

  return {
    due: all.slice(0, config.maxPeriodsPerTick),
    deferred: Math.max(0, all.length - config.maxPeriodsPerTick),
    beyondHorizon,
    nextDueAt: new Date(Math.min(earliestFuture, nextBoundary)),
  };
}

function periodStart(work: DueWork): Date {
  return work.kind === "gap" ? work.period.from : new Date(work.row.periodFrom);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/scheduler test derive`
Expected: PASS, all derive tests plus Task 2's 6.

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler/src/derive.ts packages/scheduler/src/derive.test.ts
git commit -m "feat(scheduler): derive due work from gaps, backoffs and stale claims"
```

---

### Task 4: The ledger store

**Files:**
- Create: `packages/scheduler/src/store.ts`
- Create: `packages/scheduler/src/testing/postgres.ts`, `packages/scheduler/test/seed.ts`
- Test: `packages/scheduler/src/store.test.ts`, `packages/scheduler/src/store.concurrency.test.ts`

**Interfaces:**
- Consumes: `LedgerRow`, `LedgerSnapshot` from `./derive.js`; `RunPeriod` from `./duty.js`; `scheduledRuns` from `./schema/scheduled-runs.js`; `withTenant`, `Transaction`, `Database`, `isUniqueViolation` from `@waitron/db`.
- Produces: `ClaimedRun`, `readSnapshot`, `claimGap`, `claimRow`, `reclaimStale`, `completeRun`, `enqueueSuccessor` from `./store.js`; `startRealPostgres`, `RealPostgres` from `./testing/postgres.js`; `seedTenant`, `freshNif` from `../test/seed.js`.

- [ ] **Step 1: Write the test harness and seed helper**

`packages/scheduler/src/testing/postgres.ts`:

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { CORE_MIGRATIONS, createPostgresDb, runMigrations, type Database } from "@waitron/db";
import { SCHEDULER_MIGRATIONS } from "../migrations.js";

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
      "The scheduler's real-Postgres suites require a running Docker daemon. They cannot be " +
        "skipped: PGlite runs every connection as a superuser, which bypasses row-level security " +
        "and cannot exercise the concurrent claim races these suites exist to verify.",
      { cause },
    );
  }

  const uri = container.getConnectionUri();
  const migrator = await createPostgresDb(uri);
  await runMigrations(migrator, CORE_MIGRATIONS);
  await runMigrations(migrator, SCHEDULER_MIGRATIONS);
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

`packages/scheduler/test/seed.ts`:

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
  return `${String(20_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Seeds one tenant and returns its id. Run as the connection owner (superuser) — RLS is bypassed,
 * so this is pure setup. */
export async function seedTenant(db: Database): Promise<TenantId> {
  const result = await db.execute<{ id: string }>(sql`
    insert into tenants (nif, legal_name) values (${freshNif()}, 'Test SL') returning id`);
  return brandTenantId(result.rows[0]!.id);
}
```

- [ ] **Step 2: Write the failing store test**

`packages/scheduler/src/store.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant, type Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { dayPeriod } from "./derive.js";
import { claimGap, claimRow, completeRun, readSnapshot, reclaimStale } from "./store.js";
import { seedTenant } from "../test/seed.js";

const DUTY = "test.duty";
const NOW = new Date("2026-07-25T04:00:00Z");
const PERIOD = dayPeriod(new Date("2026-07-24T00:00:00Z"));

let db: Database;
let tenantId: TenantId;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, SCHEDULER_MIGRATIONS);
  tenantId = await seedTenant(db);
});

afterAll(async () => {
  await db.close();
});

describe("claimGap", () => {
  it("inserts a running row and returns it", async () => {
    const claimed = await withTenant(db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period: PERIOD, now: NOW }),
    );
    expect(claimed).toMatchObject({ generation: 0, attempts: 1 });
    expect(claimed?.periodFrom).toBe("2026-07-24T00:00:00.000Z");
  });

  // The insert IS the lock — a second claim of the same period conflicts on scheduled_runs_key.
  it("returns null when the row already exists", async () => {
    const again = await withTenant(db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period: PERIOD, now: NOW }),
    );
    expect(again).toBeNull();
  });
});

describe("completeRun and readSnapshot", () => {
  it("records a success with its summary and leaves nothing claimable", async () => {
    const period = dayPeriod(new Date("2026-07-23T00:00:00Z"));
    const claimed = await withTenant(db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        state: "succeeded",
        summary: { checked: 3 },
        errorCode: null,
        nextAttemptAt: null,
        now: NOW,
      }),
    );
    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const row = snapshot.rows.find((r) => r.periodFrom === "2026-07-23T00:00:00.000Z");
    expect(row).toMatchObject({ state: "succeeded", nextAttemptAt: null });
    expect(snapshot.earliestPeriodFrom).toBe("2026-07-23T00:00:00.000Z");
  });

  it("records a failure with a structured code and a backoff", async () => {
    const period = dayPeriod(new Date("2026-07-22T00:00:00Z"));
    const claimed = await withTenant(db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(db, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        state: "failed",
        summary: null,
        errorCode: "payment.reconcile_report_unavailable",
        nextAttemptAt: new Date("2026-07-25T04:15:00Z"),
        now: NOW,
      }),
    );
    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    expect(snapshot.rows.find((r) => r.periodFrom === "2026-07-22T00:00:00.000Z")).toMatchObject({
      state: "failed",
      attempts: 1,
      nextAttemptAt: "2026-07-25T04:15:00.000Z",
    });
  });
});

describe("claimRow", () => {
  it("claims a failed row whose backoff has elapsed and increments attempts", async () => {
    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const failed = snapshot.rows.find((r) => r.state === "failed")!;
    const later = new Date("2026-07-25T05:00:00Z");
    const claimed = await withTenant(db, tenantId, (tx) =>
      claimRow(tx, { id: failed.id, now: later }),
    );
    expect(claimed).toMatchObject({ attempts: 2 });
  });

  it("returns null for a row that is no longer claimable", async () => {
    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    const running = snapshot.rows.find((r) => r.state === "running")!;
    const claimed = await withTenant(db, tenantId, (tx) =>
      claimRow(tx, { id: running.id, now: new Date("2026-07-25T06:00:00Z") }),
    );
    expect(claimed).toBeNull();
  });
});

describe("reclaimStale", () => {
  it("reclaims a running row stranded past staleAfterMs", async () => {
    const period = dayPeriod(new Date("2026-07-20T00:00:00Z"));
    const claimed = await withTenant(db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const reclaimed = await withTenant(db, tenantId, (tx) =>
      reclaimStale(tx, { id: claimed!.id, now: later, staleAfterMs: 60 * 60 * 1000 }),
    );
    expect(reclaimed).toMatchObject({ attempts: 2 });
  });

  it("refuses a running row inside staleAfterMs", async () => {
    const period = dayPeriod(new Date("2026-07-19T00:00:00Z"));
    const claimed = await withTenant(db, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    const reclaimed = await withTenant(db, tenantId, (tx) =>
      reclaimStale(tx, { id: claimed!.id, now: NOW, staleAfterMs: 60 * 60 * 1000 }),
    );
    expect(reclaimed).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @waitron/scheduler test store`
Expected: FAIL — `Failed to resolve import "./store.js"`.

- [ ] **Step 4: Implement the store**

`packages/scheduler/src/store.ts`:

```typescript
import { and, asc, eq, gte, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import type { LedgerRow, LedgerSnapshot } from "./derive.js";
import type { RunPeriod } from "./duty.js";
import { scheduledRuns, type RunState } from "./schema/scheduled-runs.js";

/** A row this runner now owns. Returned only by a claim that actually won. */
export interface ClaimedRun {
  id: string;
  periodFrom: string;
  periodTo: string;
  generation: number;
  attempts: number;
}

const CLAIMED = {
  id: scheduledRuns.id,
  periodFrom: scheduledRuns.periodFrom,
  periodTo: scheduledRuns.periodTo,
  generation: scheduledRuns.generation,
  attempts: scheduledRuns.attempts,
} as const;

const TERMINAL: readonly RunState[] = ["succeeded", "parked"];

/**
 * Everything derivation needs about one (tenant, duty).
 *
 * The row read spans two ranges deliberately (see `LedgerSnapshot`): at-or-above the horizon start,
 * OR non-terminal at any age, so a re-sweep chain older than the horizon stays claimable. The
 * below-horizon MISSING-day count would be an unbounded read, so it is aggregated in SQL instead.
 *
 * Carries an explicit `eq(tenantId)` predicate as defence in depth: under a superuser or BYPASSRLS
 * connection, where RLS does not apply, this is the only thing scoping the read to one tenant.
 */
export async function readSnapshot(
  tx: Transaction,
  params: { tenantId: TenantId; duty: string; horizonStart: Date },
): Promise<LedgerSnapshot> {
  const horizon = params.horizonStart.toISOString();
  const scope = and(eq(scheduledRuns.tenantId, params.tenantId), eq(scheduledRuns.duty, params.duty));

  const rows = await tx
    .select({
      id: scheduledRuns.id,
      periodFrom: scheduledRuns.periodFrom,
      periodTo: scheduledRuns.periodTo,
      generation: scheduledRuns.generation,
      state: scheduledRuns.state,
      attempts: scheduledRuns.attempts,
      nextAttemptAt: scheduledRuns.nextAttemptAt,
      startedAt: scheduledRuns.startedAt,
    })
    .from(scheduledRuns)
    .where(
      and(scope, or(gte(scheduledRuns.periodFrom, horizon), notInArray(scheduledRuns.state, TERMINAL))),
    )
    .orderBy(asc(scheduledRuns.periodFrom));

  const [bounds] = await tx
    .select({
      earliest: sql<string | null>`min(${scheduledRuns.periodFrom})`,
      below: sql<number>`count(distinct ${scheduledRuns.periodFrom}) filter (where ${scheduledRuns.periodFrom} < ${horizon})`,
    })
    .from(scheduledRuns)
    .where(scope);

  return {
    rows: rows as LedgerRow[],
    earliestPeriodFrom: bounds?.earliest ?? null,
    recordedBelowHorizon: Number(bounds?.below ?? 0),
  };
}

/**
 * Claim a gap by INSERTING its row. The insert IS the lock: two runners deriving the same gap
 * collide on `scheduled_runs_key`, and exactly one gets a row back. No read-then-write, so there
 * is no window between checking and claiming.
 */
export async function claimGap(
  tx: Transaction,
  params: { tenantId: TenantId; duty: string; period: RunPeriod; now: Date },
): Promise<ClaimedRun | null> {
  const [row] = await tx
    .insert(scheduledRuns)
    .values({
      tenantId: params.tenantId,
      duty: params.duty,
      periodFrom: params.period.from.toISOString(),
      periodTo: params.period.to.toISOString(),
      generation: 0,
      state: "running",
      attempts: 1,
      startedAt: params.now.toISOString(),
    })
    .onConflictDoNothing()
    .returning(CLAIMED);
  return row ?? null;
}

/**
 * Claim an existing `pending` or `failed` row. Retry and re-sweep differ only in which state the
 * row arrived in, so they share ONE statement rather than one being a widening of the other.
 * Single-statement conditional UPDATE, returning-checked: exactly one concurrent runner wins.
 */
export async function claimRow(
  tx: Transaction,
  params: { id: string; now: Date },
): Promise<ClaimedRun | null> {
  const now = params.now.toISOString();
  const [row] = await tx
    .update(scheduledRuns)
    .set({
      state: "running",
      attempts: sql`${scheduledRuns.attempts} + 1`,
      startedAt: now,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(scheduledRuns.id, params.id),
        inArray(scheduledRuns.state, ["pending", "failed"]),
        // Inclusive: a row due at exactly `now` is claimable. `lt()` would silently defer it by a
        // whole tick, and `derive` uses `<=` — the two must agree or the runner derives work it
        // then refuses to claim.
        sql`${scheduledRuns.nextAttemptAt} <= ${now}`,
      ),
    )
    .returning(CLAIMED);
  return row ?? null;
}

/**
 * Reclaim a `running` row stranded by a crashed process. Its own statement, NOT `claimRow`'s:
 * that one matches `pending`/`failed`, and a stranded row is `running`. Without this a crash locks
 * that period for ever, and no gap reveals it because the row exists.
 */
export async function reclaimStale(
  tx: Transaction,
  params: { id: string; now: Date; staleAfterMs: number },
): Promise<ClaimedRun | null> {
  const now = params.now.toISOString();
  const cutoff = new Date(params.now.getTime() - params.staleAfterMs).toISOString();
  const [row] = await tx
    .update(scheduledRuns)
    .set({
      attempts: sql`${scheduledRuns.attempts} + 1`,
      startedAt: now,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(scheduledRuns.id, params.id),
        eq(scheduledRuns.state, "running"),
        lt(scheduledRuns.startedAt, cutoff),
      ),
    )
    .returning(CLAIMED);
  return row ?? null;
}

/** Record the outcome of a claimed run. `summary` is the duty's own result, stored verbatim. */
export async function completeRun(
  tx: Transaction,
  params: {
    id: string;
    state: Extract<RunState, "succeeded" | "failed" | "parked">;
    summary: Record<string, unknown> | null;
    errorCode: string | null;
    nextAttemptAt: Date | null;
    now: Date;
  },
): Promise<void> {
  await tx
    .update(scheduledRuns)
    .set({
      state: params.state,
      summary: params.summary,
      errorCode: params.errorCode,
      nextAttemptAt: params.nextAttemptAt?.toISOString() ?? null,
      finishedAt: params.now.toISOString(),
      updatedAt: sql`now()`,
    })
    .where(eq(scheduledRuns.id, params.id));
}
```

Note the two comparisons are deliberately different: `claimRow` uses `<=` on `next_attempt_at`
(inclusive, matching `derive`), while `reclaimStale` keeps `lt()` — strictly `<` — on `started_at`,
matching `derive`'s `Date.parse(r.startedAt) < nowMs - staleAfterMs`. Each pair must agree, or the
runner derives work it then refuses to claim.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @waitron/scheduler test store`
Expected: PASS.

- [ ] **Step 6: Write the concurrency test**

`packages/scheduler/src/store.concurrency.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import { dayPeriod } from "./derive.js";
import { claimGap, claimRow, completeRun, readSnapshot } from "./store.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedTenant } from "../test/seed.js";

const DUTY = "test.duty";
const NOW = new Date("2026-07-25T04:00:00Z");

let pg: RealPostgres;
let a: Database;
let b: Database;
let tenantId: TenantId;

beforeAll(async () => {
  pg = await startRealPostgres();
  a = await pg.connect();
  b = await pg.connect();
  tenantId = await seedTenant(a);
});

// Guarded so a beforeAll failure cannot mask itself: each teardown runs only if its resource was
// actually created. The four *.rls.test.ts files in packages/payments share an unconditional
// afterAll that leaks the container on a beforeAll failure — do not reproduce it here.
afterAll(async () => {
  if (a !== undefined) await a.close();
  if (b !== undefined) await b.close();
  if (pg !== undefined) await pg.stop();
});

describe("two runners racing one gap", () => {
  it("produces exactly one claim", async () => {
    const period = dayPeriod(new Date("2026-07-24T00:00:00Z"));
    const [first, second] = await Promise.all([
      withTenant(a, tenantId, (tx) => claimGap(tx, { tenantId, duty: DUTY, period, now: NOW })),
      withTenant(b, tenantId, (tx) => claimGap(tx, { tenantId, duty: DUTY, period, now: NOW })),
    ]);
    expect([first, second].filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("two runners racing one failed row", () => {
  it("produces exactly one claim", async () => {
    const period = dayPeriod(new Date("2026-07-23T00:00:00Z"));
    const claimed = await withTenant(a, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(a, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: NOW,
        now: NOW,
      }),
    );
    const later = new Date(NOW.getTime() + 60_000);
    const [first, second] = await Promise.all([
      withTenant(a, tenantId, (tx) => claimRow(tx, { id: claimed!.id, now: later })),
      withTenant(b, tenantId, (tx) => claimRow(tx, { id: claimed!.id, now: later })),
    ]);
    expect([first, second].filter((r) => r !== null)).toHaveLength(1);

    // The loser must not have inflated the attempt count — a conditional UPDATE that matched
    // nothing changes nothing, which is what bounds retries.
    const snapshot = await withTenant(a, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    expect(snapshot.rows.find((r) => r.id === claimed!.id)?.attempts).toBe(2);
  });
});
```

- [ ] **Step 7: Run the concurrency test**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/scheduler test store.concurrency`
Expected: PASS, 2 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/scheduler/src/store.ts packages/scheduler/src/store.test.ts \
        packages/scheduler/src/store.concurrency.test.ts \
        packages/scheduler/src/testing/postgres.ts packages/scheduler/test/seed.ts
git commit -m "feat(scheduler): the ledger store and its concurrent claim guarantees"
```

---

### Task 5: `runDue` — the orchestration

**Files:**
- Create: `packages/scheduler/src/run.ts`, `packages/scheduler/src/testing/fake-duty.ts`
- Test: `packages/scheduler/src/run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: `SchedulerDeps`, `TickResult`, `RunRecord`, `runDue` from `./run.js`; `FakeDuty` from `./testing/fake-duty.js`.

- [ ] **Step 1: Write the fake duty**

`packages/scheduler/src/testing/fake-duty.ts`:

```typescript
import type { TenantId } from "@waitron/shared";
import type { DutyOutcome, PeriodDuty, RunPeriod } from "../duty.js";

export interface FakeDutyCall {
  tenantId: TenantId;
  period: RunPeriod;
  now: Date;
}

/**
 * A programmable `PeriodDuty`. `behaviour` is consulted per call, so one instance can succeed, then
 * fail, then succeed again — which is what the retry and park paths need.
 */
export class FakeDuty implements PeriodDuty {
  readonly cadence = "daily" as const;
  readonly calls: FakeDutyCall[] = [];

  constructor(
    readonly name = "test.duty",
    private readonly behaviour: (call: FakeDutyCall, index: number) => Promise<DutyOutcome> = () =>
      Promise.resolve({ summary: { ok: true } }),
  ) {}

  async run(tenantId: TenantId, period: RunPeriod, now: Date): Promise<DutyOutcome> {
    const call = { tenantId, period, now };
    this.calls.push(call);
    return this.behaviour(call, this.calls.length - 1);
  }
}

/** A duty that always throws the given error — the failure/park path's subject. */
export function throwingDuty(name: string, error: unknown): PeriodDuty {
  return {
    name,
    cadence: "daily",
    run: () => Promise.reject(error),
  };
}
```

- [ ] **Step 2: Write the failing orchestration test**

`packages/scheduler/src/run.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant, type Database } from "@waitron/db";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { DEFAULTS } from "./derive.js";
import { readSnapshot } from "./store.js";
import { runDue, type SchedulerDeps } from "./run.js";
import { FakeDuty, throwingDuty } from "./testing/fake-duty.js";
import { seedTenant } from "../test/seed.js";

const NOW = new Date("2026-07-25T04:00:00Z");
const HORIZON_START = new Date("2026-06-01T00:00:00Z");

let db: Database;
let tenantId: TenantId;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, SCHEDULER_MIGRATIONS);
});

afterAll(async () => {
  if (db !== undefined) await db.close();
});

beforeEach(async () => {
  tenantId = await seedTenant(db);
});

function deps(duties: SchedulerDeps["duties"], overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return { db, duties, ...DEFAULTS, ...overrides };
}

describe("runDue", () => {
  it("runs the most recent complete period for a duty that has never run", async () => {
    const duty = new FakeDuty();
    const result = await runDue(deps([duty]), [tenantId], NOW);

    expect(duty.calls).toHaveLength(1);
    expect(duty.calls[0]!.period.from).toEqual(new Date("2026-07-24T00:00:00Z"));
    expect(result.ran).toHaveLength(1);
    expect(result.ran[0]).toMatchObject({ outcome: "succeeded", duty: "test.duty", generation: 0 });
  });

  it("persists the duty's summary verbatim", async () => {
    const duty = new FakeDuty("test.duty", () =>
      Promise.resolve({ summary: { remediationFailures: [{ paymentRef: "pi_1", reason: "x" }] } }),
    );
    await runDue(deps([duty]), [tenantId], NOW);

    // Read the column directly: readSnapshot deliberately omits `summary`, since derivation never
    // needs it and a large one would be read on every tick for nothing.
    const stored = await withTenant(db, tenantId, (tx) =>
      tx.execute<{ summary: Record<string, unknown> }>(
        sql`select summary from scheduled_runs where duty = 'test.duty'`,
      ),
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.summary).toEqual({
      remediationFailures: [{ paymentRef: "pi_1", reason: "x" }],
    });
  });

  it("is idempotent within a tick — a second call finds no gap", async () => {
    const duty = new FakeDuty();
    await runDue(deps([duty]), [tenantId], NOW);
    const second = await runDue(deps([duty]), [tenantId], NOW);

    expect(duty.calls).toHaveLength(1);
    expect(second.ran).toEqual([]);
    expect(second.nextDueAt).toEqual(new Date("2026-07-26T00:00:00Z"));
  });

  it("records a failure with the AppError's code and a backoff", async () => {
    const duty = throwingDuty("test.duty", new AppError("payment.reconcile_unsettled", {}));
    const result = await runDue(deps([duty]), [tenantId], NOW);

    expect(result.ran[0]).toMatchObject({
      outcome: "failed",
      errorCode: "payment.reconcile_unsettled",
    });
    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: "test.duty", horizonStart: HORIZON_START }),
    );
    // 15 minutes: backoffBaseMs * 2^(attempts-1), attempts = 1.
    expect(snapshot.rows[0]!.nextAttemptAt).toBe("2026-07-25T04:15:00.000Z");
  });

  it("records `unknown` for a non-AppError failure", async () => {
    const duty = throwingDuty("test.duty", new Error("boom"));
    const result = await runDue(deps([duty]), [tenantId], NOW);
    expect(result.ran[0]).toMatchObject({ outcome: "failed", errorCode: "unknown" });
  });

  it("parks a period after maxAttempts and stops retrying it", async () => {
    const duty = throwingDuty("test.duty", new Error("boom"));
    let at = NOW;
    for (let i = 0; i < 3; i += 1) {
      await runDue(deps([duty]), [tenantId], at);
      at = new Date(at.getTime() + 2 * 60 * 60 * 1000);
    }
    const after = await runDue(deps([duty]), [tenantId], at);

    const snapshot = await withTenant(db, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: "test.duty", horizonStart: HORIZON_START }),
    );
    // A parked row is non-terminal in neither sense: it stays visible in the snapshot, but it is
    // never claimed again, so the fourth tick finds nothing.
    expect(snapshot.rows[0]).toMatchObject({ state: "parked", attempts: 3, nextAttemptAt: null });
    expect(after.ran).toEqual([]);
  });

  it("keeps periods independent — a parked day does not block the next one", async () => {
    const duty = throwingDuty("test.duty", new Error("boom"));
    let at = NOW;
    for (let i = 0; i < 3; i += 1) {
      await runDue(deps([duty]), [tenantId], at);
      at = new Date(at.getTime() + 2 * 60 * 60 * 1000);
    }
    // Next day: 2026-07-25 is now a complete period with no row of its own.
    const nextDay = new Date("2026-07-26T04:00:00Z");
    const result = await runDue(deps([duty]), [tenantId], nextDay);
    expect(result.ran.map((r) => r.period.from.toISOString())).toEqual([
      "2026-07-25T00:00:00.000Z",
    ]);
  });

  it("reports what the per-tick cap deferred", async () => {
    const duty = new FakeDuty();
    // Sweeping at 2026-07-20 records 2026-07-19, which becomes the floor. At NOW the gaps are
    // 07-20 … 07-24 — five of them.
    await runDue(deps([duty]), [tenantId], new Date("2026-07-20T04:00:00Z"));
    const result = await runDue(deps([duty], { maxPeriodsPerTick: 2 }), [tenantId], NOW);

    expect(result.ran).toHaveLength(2);
    expect(result.ran.map((r) => r.period.from.toISOString())).toEqual([
      "2026-07-20T00:00:00.000Z",
      "2026-07-21T00:00:00.000Z",
    ]);
    expect(result.deferred).toBe(3);
    // Work is available right now, so nextDueAt is now — not the next day boundary.
    expect(result.nextDueAt).toEqual(NOW);
  });

  // An infrastructure failure has no ledger row to carry it — the claim is what would have created
  // one. Reporting it is the difference between "nothing was due" and "we never found out".
  it("reports a (tenant, duty) whose claim failed, rather than swallowing it", async () => {
    const duty = new FakeDuty();
    const missing = brandTenantId(randomUUID());
    const result = await runDue(deps([duty]), [missing], NOW);

    expect(result.ran).toEqual([]);
    expect(result.skipped).toEqual([
      { tenantId: missing, duty: "test.duty", errorCode: "unknown" },
    ]);
    expect(duty.calls).toEqual([]);
  });

  it("isolates one tenant's failure from another's", async () => {
    const other = await seedTenant(db);
    const duty = new FakeDuty("test.duty", (call) =>
      call.tenantId === tenantId
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ summary: { ok: true } }),
    );
    const result = await runDue(deps([duty]), [tenantId, other], NOW);

    expect(result.ran).toHaveLength(2);
    expect(result.ran.map((r) => r.outcome).sort()).toEqual(["failed", "succeeded"]);
  });

  it("runs every duty for every tenant", async () => {
    const one = new FakeDuty("duty.one");
    const two = new FakeDuty("duty.two");
    const other = await seedTenant(db);
    const result = await runDue(deps([one, two]), [tenantId, other], NOW);

    expect(result.ran).toHaveLength(4);
    expect(one.calls).toHaveLength(2);
    expect(two.calls).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @waitron/scheduler test run`
Expected: FAIL — `Failed to resolve import "./run.js"`.

- [ ] **Step 4: Implement `runDue`**

`packages/scheduler/src/run.ts`:

```typescript
import { isAppError } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import { DAY_MS, derive, utcDayStart, type DueWork } from "./derive.js";
import type { PeriodDuty, RunPeriod } from "./duty.js";
import {
  claimGap,
  claimRow,
  completeRun,
  readSnapshot,
  reclaimStale,
  type ClaimedRun,
} from "./store.js";

export interface SchedulerDeps {
  db: Database;
  duties: readonly PeriodDuty[];
  horizonDays: number;
  maxPeriodsPerTick: number;
  maxAttempts: number;
  backoffBaseMs: number;
  staleAfterMs: number;
}

/** One run this tick actually claimed and completed. */
export interface RunRecord {
  tenantId: TenantId;
  duty: string;
  period: RunPeriod;
  generation: number;
  outcome: "succeeded" | "failed" | "parked";
  errorCode?: string;
}

export interface TickResult {
  ran: RunRecord[];
  /** Eligible work this tick did not run, capped by `maxPeriodsPerTick`. Never silent. */
  deferred: number;
  /** Never-swept days dropped permanently by the horizon. Never silent. */
  beyondHorizon: number;
  /**
   * A (tenant, duty) whose snapshot read or claim failed before any run could be recorded in the
   * ledger — infrastructure failure, not duty failure. It has no row to carry it, so it is
   * reported here rather than swallowed.
   */
  skipped: { tenantId: TenantId; duty: string; errorCode: string }[];
  /** `now` when work is available immediately, else the earliest future time work appears. Null
   * only when there is no (tenant, duty) pair at all. Mirrors `DrainResult.nextDueAt`. */
  nextDueAt: Date | null;
}

/**
 * One pass. No loop and no timer: the host decides cron versus long-running, and `now` is injected
 * on exactly the contract `drain(now)` / `forward(now)` / `reconcile(…, now)` already use.
 *
 * Tenants are a PARAMETER rather than an interface: enumerating them means an RLS bypass whose
 * correct form differs per deployment model, and that is the host's knowledge.
 *
 * Transaction discipline mirrors `reconcilePayments`: a short read, then the duty OUTSIDE every
 * transaction because it makes network calls, then a short write.
 */
export async function runDue(
  deps: SchedulerDeps,
  tenantIds: readonly TenantId[],
  now: Date,
): Promise<TickResult> {
  const result: TickResult = {
    ran: [],
    deferred: 0,
    beyondHorizon: 0,
    skipped: [],
    nextDueAt: null,
  };
  const horizonStart = new Date(utcDayStart(now).getTime() - deps.horizonDays * DAY_MS);
  let earliestFuture = Number.POSITIVE_INFINITY;

  for (const tenantId of tenantIds) {
    for (const duty of deps.duties) {
      try {
        const snapshot = await withTenant(deps.db, tenantId, (tx) =>
          readSnapshot(tx, { tenantId, duty: duty.name, horizonStart }),
        );
        const derivation = derive(snapshot, now, deps);
        result.deferred += derivation.deferred;
        result.beyondHorizon += derivation.beyondHorizon;
        earliestFuture = Math.min(earliestFuture, derivation.nextDueAt.getTime());

        for (const work of derivation.due) {
          const record = await runOne(deps, tenantId, duty, work, now);
          if (record !== null) result.ran.push(record);
        }
      } catch (error) {
        result.skipped.push({ tenantId, duty: duty.name, errorCode: codeOf(error) });
      }
    }
  }

  result.nextDueAt =
    result.deferred > 0
      ? now
      : earliestFuture === Number.POSITIVE_INFINITY
        ? null
        : new Date(earliestFuture);
  return result;
}

/** Claim one unit of work, run it outside every transaction, and record what happened. Returns
 * null when another runner won the claim — not an error, and not this tick's business. */
async function runOne(
  deps: SchedulerDeps,
  tenantId: TenantId,
  duty: PeriodDuty,
  work: DueWork,
  now: Date,
): Promise<RunRecord | null> {
  const claimed = await withTenant(deps.db, tenantId, (tx) => {
    if (work.kind === "gap") {
      return claimGap(tx, { tenantId, duty: duty.name, period: work.period, now });
    }
    if (work.kind === "claimable") return claimRow(tx, { id: work.row.id, now });
    return reclaimStale(tx, { id: work.row.id, now, staleAfterMs: deps.staleAfterMs });
  });
  if (claimed === null) return null;

  const period: RunPeriod = {
    from: new Date(claimed.periodFrom),
    to: new Date(claimed.periodTo),
  };

  // OUTSIDE every transaction: a duty makes network calls.
  let summary: Record<string, unknown> | null = null;
  let errorCode: string | null = null;
  try {
    const outcome = await duty.run(tenantId, period, now);
    summary = outcome.summary;
  } catch (error) {
    errorCode = codeOf(error);
  }

  const outcome = errorCode === null ? "succeeded" : parkOrRetry(deps, claimed);
  await withTenant(deps.db, tenantId, (tx) =>
    completeRun(tx, {
      id: claimed.id,
      state: outcome,
      summary,
      errorCode,
      nextAttemptAt: outcome === "failed" ? backoff(deps, claimed, now) : null,
      now,
    }),
  );

  return {
    tenantId,
    duty: duty.name,
    period,
    generation: claimed.generation,
    outcome,
    ...(errorCode === null ? {} : { errorCode }),
  };
}

/** `attempts` was already incremented by the claim, so it is the number of attempts SPENT. */
function parkOrRetry(deps: SchedulerDeps, claimed: ClaimedRun): "failed" | "parked" {
  return claimed.attempts >= deps.maxAttempts ? "parked" : "failed";
}

function backoff(deps: SchedulerDeps, claimed: ClaimedRun, now: Date): Date {
  return new Date(now.getTime() + deps.backoffBaseMs * 2 ** (claimed.attempts - 1));
}

/** A structured code, never prose: the AppError's own code, or the literal "unknown". The same
 * convention `reconcilePayments`'s `remediate()` uses. */
function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : "unknown";
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @waitron/scheduler test run`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/scheduler/src/run.ts packages/scheduler/src/run.test.ts \
        packages/scheduler/src/testing/fake-duty.ts
git commit -m "feat(scheduler): runDue — claim, execute outside every transaction, record"
```

---

### Task 6: `resweepAfter` — the successor chain

**Files:**
- Modify: `packages/scheduler/src/store.ts` (add `enqueueSuccessor`)
- Modify: `packages/scheduler/src/run.ts` (call it inside the completion transaction)
- Test: `packages/scheduler/src/resweep.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `enqueueSuccessor(tx, params): Promise<boolean>` from `./store.js`.

- [ ] **Step 1: Write the failing re-sweep test**

`packages/scheduler/src/resweep.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant, type Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import { SCHEDULER_MIGRATIONS } from "./migrations.js";
import { DEFAULTS, type LedgerSnapshot } from "./derive.js";
import { readSnapshot } from "./store.js";
import { runDue, type SchedulerDeps } from "./run.js";
import { scheduledRuns } from "./schema/scheduled-runs.js";
import { FakeDuty } from "./testing/fake-duty.js";
import { seedTenant } from "../test/seed.js";

const NOW = new Date("2026-07-25T04:00:00Z");
const TOMORROW = new Date("2026-07-26T04:00:00Z");
const HORIZON_START = new Date("2026-06-01T00:00:00Z");
const DUTY = "test.duty";

let db: Database;
let tenantId: TenantId;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, SCHEDULER_MIGRATIONS);
});

afterAll(async () => {
  if (db !== undefined) await db.close();
});

beforeEach(async () => {
  tenantId = await seedTenant(db);
});

function deps(duties: SchedulerDeps["duties"]): SchedulerDeps {
  return { db, duties, ...DEFAULTS };
}

function snapshotOf(): Promise<LedgerSnapshot> {
  return withTenant(db, tenantId, (tx) =>
    readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: HORIZON_START }),
  );
}

describe("resweepAfter", () => {
  it("enqueues the next generation of the SAME period, due when asked", async () => {
    const duty = new FakeDuty(DUTY, () =>
      Promise.resolve({ summary: { gated: 1 }, resweepAfter: TOMORROW }),
    );
    await runDue(deps([duty]), [tenantId], NOW);

    const snapshot = await snapshotOf();
    const pending = snapshot.rows.filter((r) => r.state === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      periodFrom: "2026-07-24T00:00:00.000Z",
      generation: 1,
    });
  });

  // Without this the period would never be re-derived: it has no gap. This is the whole mechanism
  // that makes a gated drift orphan self-healing rather than merely re-reported once.
  it("runs the same period again once its due time arrives", async () => {
    const duty = new FakeDuty(DUTY, (_call, index) =>
      Promise.resolve(index === 0 ? { summary: {}, resweepAfter: TOMORROW } : { summary: {} }),
    );
    await runDue(deps([duty]), [tenantId], NOW);
    const second = await runDue(deps([duty]), [tenantId], TOMORROW);

    const reswept = second.ran.filter((r) => r.period.from.toISOString() === "2026-07-24T00:00:00.000Z");
    expect(reswept).toHaveLength(1);
    expect(reswept[0]).toMatchObject({ generation: 1, outcome: "succeeded" });
  });

  it("does not re-run the period before its due time", async () => {
    const duty = new FakeDuty(DUTY, () =>
      Promise.resolve({ summary: {}, resweepAfter: TOMORROW }),
    );
    await runDue(deps([duty]), [tenantId], NOW);
    const soon = await runDue(deps([duty]), [tenantId], new Date("2026-07-25T05:00:00Z"));
    expect(soon.ran).toEqual([]);
  });

  it("keeps the chain linear — one unresolved finding cannot fan out", async () => {
    // Every run asks for a re-sweep. After three ticks there must be exactly one pending row, not
    // an exponential fan-out: the guard refuses a successor while a non-terminal row exists.
    const duty = new FakeDuty(DUTY, (call) =>
      Promise.resolve({ summary: {}, resweepAfter: new Date(call.now.getTime() + 60_000) }),
    );
    let at = NOW;
    for (let i = 0; i < 3; i += 1) {
      await runDue(deps([duty]), [tenantId], at);
      at = new Date(at.getTime() + 120_000);
    }
    const snapshot = await snapshotOf();
    expect(snapshot.rows.filter((r) => r.state === "pending")).toHaveLength(1);
    expect(snapshot.rows.filter((r) => r.state === "succeeded")).toHaveLength(3);
  });

  it("survives a period older than the horizon", async () => {
    // A re-sweep is EXPLICIT work, so the gap horizon must not bury it. Seeded by hand at a period
    // 90 days back, which no gap derivation would ever reach.
    const old = new Date("2026-04-20T00:00:00Z");
    const duty = new FakeDuty(DUTY, () => Promise.resolve({ summary: {} }));
    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(scheduledRuns).values({
        tenantId,
        duty: DUTY,
        periodFrom: old.toISOString(),
        periodTo: new Date(old.getTime() + 86_400_000).toISOString(),
        generation: 1,
        state: "pending",
        attempts: 0,
        nextAttemptAt: NOW.toISOString(),
      });
    });
    const result = await runDue(deps([duty]), [tenantId], NOW);
    expect(result.ran.map((r) => r.period.from.toISOString())).toContain("2026-04-20T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/scheduler test resweep`
Expected: FAIL — no `pending` row is ever created.

- [ ] **Step 3: Implement `enqueueSuccessor`**

First add `isUniqueViolation` to the `@waitron/db` import at the top of
`packages/scheduler/src/store.ts` — Task 4 did not need it:

```typescript
import { isUniqueViolation, type Transaction } from "@waitron/db";
```

Then append:

```typescript
/**
 * Enqueue the next generation of one period, due at `dueAt`.
 *
 * Guarded and idempotent. A successor is inserted only when that (tenant, duty, period_from) has
 * NO row at any generation in a non-terminal state — anything other than `succeeded` or `parked`,
 * so a `failed` row awaiting its own retry blocks it too. The caller runs this in the SAME
 * transaction as `completeRun`, so the guard sees the run that is finishing as already terminal.
 *
 * Two racing enqueues collide on `scheduled_runs_key`; the loser treats the violation as "already
 * enqueued". The chain stays LINEAR — one unresolved finding cannot fan out into an exponential
 * number of rows.
 *
 * Returns whether it inserted.
 */
export async function enqueueSuccessor(
  tx: Transaction,
  params: { tenantId: TenantId; duty: string; period: RunPeriod; dueAt: Date },
): Promise<boolean> {
  const periodFrom = params.period.from.toISOString();
  const scope = and(
    eq(scheduledRuns.tenantId, params.tenantId),
    eq(scheduledRuns.duty, params.duty),
    eq(scheduledRuns.periodFrom, periodFrom),
  );

  const [state] = await tx
    .select({
      unfinished: sql<number>`count(*) filter (where ${scheduledRuns.state} not in ('succeeded', 'parked'))`,
      highest: sql<number>`coalesce(max(${scheduledRuns.generation}), -1)`,
    })
    .from(scheduledRuns)
    .where(scope);

  if (state === undefined || Number(state.unfinished) > 0) return false;

  try {
    await tx.insert(scheduledRuns).values({
      tenantId: params.tenantId,
      duty: params.duty,
      periodFrom,
      periodTo: params.period.to.toISOString(),
      generation: Number(state.highest) + 1,
      state: "pending",
      attempts: 0,
      nextAttemptAt: params.dueAt.toISOString(),
    });
    return true;
  } catch (error) {
    // A concurrent enqueue computed the same generation and got there first. Same fact, not an
    // error: the successor exists.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
```

- [ ] **Step 4: Call it from the completion transaction**

In `packages/scheduler/src/run.ts`, replace the completion block inside `runOne`:

```typescript
  let summary: Record<string, unknown> | null = null;
  let errorCode: string | null = null;
  let resweepAfter: Date | undefined;
  try {
    const outcome = await duty.run(tenantId, period, now);
    summary = outcome.summary;
    resweepAfter = outcome.resweepAfter;
  } catch (error) {
    errorCode = codeOf(error);
  }

  const outcome = errorCode === null ? "succeeded" : parkOrRetry(deps, claimed);
  await withTenant(deps.db, tenantId, async (tx) => {
    await completeRun(tx, {
      id: claimed.id,
      state: outcome,
      summary,
      errorCode,
      nextAttemptAt: outcome === "failed" ? backoff(deps, claimed, now) : null,
      now,
    });
    // Same transaction as the completion, so the guard sees this run as already terminal.
    if (resweepAfter !== undefined) {
      await enqueueSuccessor(tx, {
        tenantId,
        duty: duty.name,
        period,
        dueAt: resweepAfter,
      });
    }
  });
```

Add `enqueueSuccessor` to the `./store.js` import list at the top of the file.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @waitron/scheduler test resweep`
Expected: PASS, 5 tests.

- [ ] **Step 6: Prove the unique-violation arm with a real race**

The `isUniqueViolation` catch is unreachable on a single connection — the guard already refuses.
Only two concurrent transactions reach it, so it needs real Postgres. Append to
`packages/scheduler/src/store.concurrency.test.ts`:

```typescript
import { enqueueSuccessor } from "./store.js";

describe("two runners racing one successor enqueue", () => {
  it("inserts exactly one, and the loser reads the violation as already-enqueued", async () => {
    const period = dayPeriod(new Date("2026-07-22T00:00:00Z"));
    const claimed = await withTenant(a, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(a, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        state: "succeeded",
        summary: {},
        errorCode: null,
        nextAttemptAt: null,
        now: NOW,
      }),
    );

    // Both see zero unfinished rows and compute generation 1. Under READ COMMITTED the second
    // blocks on the unique index until the first commits, then gets the violation.
    const dueAt = new Date("2026-07-26T00:00:00Z");
    const [first, second] = await Promise.all([
      withTenant(a, tenantId, (tx) => enqueueSuccessor(tx, { tenantId, duty: DUTY, period, dueAt })),
      withTenant(b, tenantId, (tx) => enqueueSuccessor(tx, { tenantId, duty: DUTY, period, dueAt })),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});
```

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/scheduler test store.concurrency`
Expected: PASS, 3 tests.

If this proves flaky because one transaction commits before the other reads, keep the test and
widen it to accept either outcome ONLY if the ledger still holds exactly one generation-1 row —
that invariant is the thing under test, not which path produced it.

- [ ] **Step 7: Run the whole suite**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/scheduler test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/scheduler/src/store.ts packages/scheduler/src/run.ts \
        packages/scheduler/src/resweep.test.ts packages/scheduler/src/store.concurrency.test.ts
git commit -m "feat(scheduler): resweepAfter enqueues a guarded, linear successor chain"
```

---

### Task 7: The public surface, RLS, and the payments fit

**Files:**
- Create: `packages/scheduler/src/index.ts`, `src/index.test.ts`
- Create: `packages/scheduler/src/scheduler.rls.test.ts`
- Create: `packages/scheduler/src/payments-fit.test.ts`
- Modify: `packages/scheduler/vitest.config.ts` if coverage thresholds need an exclusion

**Interfaces:**
- Consumes: everything from Tasks 2–6; `PaymentReconciler`, `PaymentReconcileResult` types from `@waitron/payments` (dev dependency, `import type` only).
- Produces: the package's public barrel.

- [ ] **Step 1: Write the barrel**

`packages/scheduler/src/index.ts`:

```typescript
// The entire public surface of @waitron/scheduler. Re-exports only — no logic here.
// The fake duty is NOT re-exported: packages that need it import it from
// @waitron/scheduler/src/testing/fake-duty.js, exactly as payments' fakes are consumed.
export type { DutyOutcome, PeriodDuty, RunPeriod } from "./duty.js";
export { DEFAULTS } from "./derive.js";
export { SCHEDULER_MIGRATIONS } from "./migrations.js";
export { runDue } from "./run.js";
export type { RunRecord, SchedulerDeps, TickResult } from "./run.js";
export { scheduledRuns } from "./schema/scheduled-runs.js";
export type { RunState } from "./schema/scheduled-runs.js";
```

`packages/scheduler/src/index.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      ["DEFAULTS", "SCHEDULER_MIGRATIONS", "runDue", "scheduledRuns"].sort(),
    );
  });

  // The store is deliberately NOT public: a host claims and completes runs through runDue, never
  // by hand. Exposing the claim statements would make it possible to run a duty without recording
  // it, which is the one thing this ledger exists to prevent.
  it("does not export the ledger store", () => {
    expect(Object.keys(api)).not.toContain("claimGap");
    expect(Object.keys(api)).not.toContain("completeRun");
  });
});
```

- [ ] **Step 2: Write the RLS suite**

`packages/scheduler/src/scheduler.rls.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import { DEFAULTS } from "./derive.js";
import { runDue } from "./run.js";
import { FakeDuty } from "./testing/fake-duty.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedTenant } from "../test/seed.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses FORCE ROW LEVEL SECURITY, which is why PGlite cannot prove
// any of this. runDue touches three privileges on scheduled_runs: SELECT (readSnapshot), INSERT
// (claimGap, enqueueSuccessor) and UPDATE (claimRow, completeRun). A missing grant on any one of
// them is invisible under PGlite and only surfaces here.
const PROBE_ROLE = "scheduler_rls_probe";
const PROBE_PASSWORD = "probe";

const NOW = new Date("2026-07-25T04:00:00Z");

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
// container must not leak.
afterAll(async () => {
  if (admin !== undefined) await admin.close();
  if (pg !== undefined) await pg.stop();
});

describe("the scheduler under real row-level security", () => {
  it("claims, runs and completes as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const duty = new FakeDuty("rls.duty", () =>
        Promise.resolve({ summary: { ok: true }, resweepAfter: new Date("2026-07-26T04:00:00Z") }),
      );
      const result = await runDue({ db: probe, duties: [duty], ...DEFAULTS }, [tenantId], NOW);
      expect(result.ran).toHaveLength(1);
      expect(result.ran[0]).toMatchObject({ outcome: "succeeded" });
      expect(result.skipped).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's runs", async () => {
    const mine = await seedTenant(admin);
    const theirs = await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await runDue({ db: probe, duties: [new FakeDuty("rls.duty")], ...DEFAULTS }, [theirs], NOW);
      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from scheduled_runs`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("refuses to write a row for a tenant other than the scoped one", async () => {
    const mine = await seedTenant(admin);
    const theirs = await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await expect(
        withTenant(probe, mine, (tx) =>
          tx.execute(sql`
            insert into scheduled_runs (tenant_id, duty, period_from, period_to, state)
            values (${theirs}, 'x', '2026-07-24T00:00:00Z', '2026-07-25T00:00:00Z', 'pending')`),
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 3: Write the payments fit test**

`packages/scheduler/src/payments-fit.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { PaymentReconcileResult, PaymentReconciler } from "@waitron/payments";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { DutyOutcome, PeriodDuty, RunPeriod } from "./duty.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The adapter the `apps/*` host will own, written here to PROVE the seam fits rather than assert
 * it — the same reason payments types its `IncidentSink` structurally and notes that
 * `recordIncidentOnce` is assignable to it verbatim. `@waitron/payments` is a DEV dependency: this
 * file is the only thing in the package that names it, and it imports types only.
 */
function reconcilerAsDuty(reconciler: PaymentReconciler): PeriodDuty {
  return {
    name: `payments.reconcile.${reconciler.provider}`,
    cadence: "daily",
    async run(tenantId: TenantId, period: RunPeriod, now: Date): Promise<DutyOutcome> {
      const result = await reconciler.reconcile(tenantId, period, now);
      return {
        summary: summaryOf(result),
        // A paymentRef in BOTH lists is an orphan whose amount also drifted. This is a SUPERSET of
        // the strictly-gated set — the gates are ordered, so a drifting orphan on a non-abandoned
        // working order reports `workingOrderNotAbandoned` yet still appears in both — and that is
        // deliberate: `remediation` never reaches the result (only the incident's params), so
        // exactness would mean widening a money-path package for one extra harmless re-sweep.
        ...(gatedDriftOrphan(result) ? { resweepAfter: new Date(now.getTime() + DAY_MS) } : {}),
      };
    },
  };
}

function gatedDriftOrphan(result: PaymentReconcileResult): boolean {
  const drifted = new Set(result.drift.map((m) => m.paymentRef));
  return result.orphan.some((m) => drifted.has(m.paymentRef));
}

/** Explicit, JSON-safe, and complete: `remediationFailures` is the finding the sweep cannot
 * otherwise persist, and `packages/payments` names the scheduler as its owner. */
function summaryOf(result: PaymentReconcileResult): Record<string, unknown> {
  return {
    period: { from: result.period.from.toISOString(), to: result.period.to.toISOString() },
    checked: result.checked,
    unsettled: result.unsettled,
    lostSettlement: result.lostSettlement,
    orphan: result.orphan,
    missingLocal: result.missingLocal,
    drift: result.drift,
    incidentsRaised: result.incidentsRaised,
    remediated: result.remediated,
    remediationFailures: result.remediationFailures,
  };
}

function emptyResult(period: RunPeriod): PaymentReconcileResult {
  return {
    period,
    checked: 0,
    unsettled: [],
    lostSettlement: [],
    orphan: [],
    missingLocal: [],
    drift: [],
    incidentsRaised: 0,
    remediated: 0,
    remediationFailures: [],
  };
}

const PERIOD: RunPeriod = {
  from: new Date("2026-07-24T00:00:00Z"),
  to: new Date("2026-07-25T00:00:00Z"),
};
const NOW = new Date("2026-07-25T04:00:00Z");
// Branded, never a bare `as TenantId`: the brand is what stops a raw string reaching a
// tenant-scoped call site, and casting past it in a test teaches the wrong pattern.
const TENANT = brandTenantId("11111111-1111-1111-1111-111111111111");

function reconcilerReturning(result: PaymentReconcileResult): PaymentReconciler {
  return { provider: "stripe", reconcile: () => Promise.resolve(result) };
}

describe("a PaymentReconciler adapts to a PeriodDuty", () => {
  it("names the duty per settlement identity and carries the whole result", async () => {
    const duty = reconcilerAsDuty(reconcilerReturning(emptyResult(PERIOD)));
    expect(duty.name).toBe("payments.reconcile.stripe");

    const outcome = await duty.run(TENANT, PERIOD, NOW);
    expect(outcome.summary.checked).toBe(0);
    expect(outcome.resweepAfter).toBeUndefined();
  });

  it("asks for a re-sweep when an orphan's amount also drifted", async () => {
    const mismatch = {
      paymentRef: "pi_1",
      references: ["pi_1"],
      localState: "captured" as const,
      localAmount: "10.00",
      settledAmount: "9.50",
      workingOrderId: "wo_1",
    };
    const result = { ...emptyResult(PERIOD), orphan: [mismatch], drift: [mismatch] };
    const duty = reconcilerAsDuty(reconcilerReturning(result));

    const outcome = await duty.run(TENANT, PERIOD, NOW);
    expect(outcome.resweepAfter).toEqual(new Date("2026-07-26T04:00:00Z"));
  });

  it("does not ask for a re-sweep for an orphan with no drift", async () => {
    const orphan = {
      paymentRef: "pi_2",
      references: ["pi_2"],
      localState: "captured" as const,
      localAmount: "10.00",
      settledAmount: "10.00",
      workingOrderId: "wo_2",
    };
    const duty = reconcilerAsDuty(reconcilerReturning({ ...emptyResult(PERIOD), orphan: [orphan] }));
    const outcome = await duty.run(TENANT, PERIOD, NOW);
    expect(outcome.resweepAfter).toBeUndefined();
  });

  it("persists remediationFailures, which the sweep cannot record itself", async () => {
    const result = {
      ...emptyResult(PERIOD),
      remediationFailures: [{ paymentRef: "pi_3", reason: "payment.refund_exceeds_capture" }],
    };
    const duty = reconcilerAsDuty(reconcilerReturning(result));
    const outcome = await duty.run(TENANT, PERIOD, NOW);
    expect(outcome.summary.remediationFailures).toEqual([
      { paymentRef: "pi_3", reason: "payment.refund_exceeds_capture" },
    ]);
  });
});
```

- [ ] **Step 4: Run everything**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/scheduler test`
Expected: PASS, every suite.

- [ ] **Step 5: Run coverage and typecheck**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/scheduler test:coverage && pnpm --filter @waitron/scheduler typecheck && pnpm lint && pnpm format:check`
Expected: PASS, coverage above the 98/98/98/95 thresholds.

If a branch is genuinely unreachable rather than untested, add it to the `exclude` list in
`vitest.config.ts` with a comment saying WHY it cannot be reached — never an unexplained
`/* v8 ignore */`. `format:check` is separate from `lint`; both must pass.

- [ ] **Step 6: Run the whole workspace**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm -r test && pnpm typecheck`
Expected: PASS. In particular `@waitron/db`'s english-only guard now scans `packages/scheduler`.

- [ ] **Step 7: Commit**

```bash
git add packages/scheduler
git commit -m "feat(scheduler): public surface, RLS suite, and the payments reconcile fit"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §3 package shape, `runDue` signature, tenants-as-parameter | 1, 5 |
| §3 `PeriodDuty` / `DutyOutcome` structural seam | 2 |
| §3 english-only registration | 1 |
| §3 no `DueAtDuty` | 2 (documented in `duty.ts`) |
| §4 ledger table, `generation`, indexes, RLS, migrations | 1 |
| §4 park raises no incident; `summary` is the durable record | 5 (no incident sink exists in the package at all), 7 |
| §5 tiling, no settle-grace, floor | 2, 3 |
| §5 three work sources, two claim statements | 3, 4 |
| §5 `deferred` / `beyondHorizon` visibility | 3, 5 |
| §5 `TickResult` incl. `nextDueAt` | 5 |
| §5 `withTenant` on every ledger access | 4, 5 |
| §6 retry, backoff, park, independent periods | 5 |
| §6 stale claims | 3, 4, 5 |
| §7 `resweepAfter`, guarded linear chain, past the horizon | 6 |
| §7 no public `requestRun` | 7 (`index.test.ts` pins the surface) |
| §8 dev-dependency type-fit test | 7 |
| §9 pure derivation, real Postgres, fake duty, `afterAll` done right | 3, 4, 5, 7 |

**Known deviation from the spec, deliberate:** §4's index list named a `(tenant_id, duty, period_from)` index; the unique key's leading columns already serve it, so Task 1 omits it. The spec was corrected to match before this plan was written.

**One thing this plan does NOT do, by design:** nothing runs. There is no process, no config, no secrets — decision 2. `runDue` has no production caller until the `apps/*` host lands, and the payments adapter lives in a test file until then.

# `apps/server` — Host Process and Scheduler Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/server`, a long-running process that gives the fiscal `drain` and the Stripe payments reconcile a caller, reading per-tenant credentials from the vault and pacing itself on the `nextDueAt` both duties already return.

**Architecture:** A new workspace package under `apps/` that owns no tables and no domain logic — only composition, configuration, cadence, lifecycle and packaging. Every collaborator is injected as a narrow seam so the loop, the pass and the transport are each testable in isolation; boot is the one place that wires the real implementations together. Two changes land outside `apps/`: `drain` gains a per-tenant client resolver (a correctness fix), and the `fiscal.aeat` credential purpose gains a `certKind` field.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), Node ≥ 24, Vitest, Drizzle, Hono + `@hono/node-server` for the one HTTP route, `undici` for the mTLS dispatcher, `node-forge` (dev only) to mint a CA and client PFX in tests, esbuild for the shipped bundle, Testcontainers for real-Postgres suites.

Spec: [`docs/superpowers/specs/2026-07-26-server-host-design.md`](../specs/2026-07-26-server-host-design.md). Read it before Task 1; every task below cites the section it implements.

## Global Constraints

- **Node ≥ 24** (root `package.json` `engines`); esbuild target `node24`.
- **ESM everywhere, `.js` specifiers in TypeScript source.** Node does not resolve a `.js` specifier to a `.ts` file — this is why the shipped artefact is an esbuild bundle, exactly as `packages/credentials` established.
- **`pnpm` workspace.** `pnpm-workspace.yaml` already includes `apps/*`; no change needed there.
- **Structured error codes, never prose.** Every thrown error is an `AppError` with a lowercase dot-namespaced code contributed by declaration merging on `@waitron/shared`'s `ErrorParams`. This package's namespace is `server.*`.
- **Error params never echo secret material.** Field *names* declared by our own code are safe; caller-supplied values and payload contents are not.
- **No `any`.** `tsconfig.base.json` sets `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.
- **Never commit `TESTCONTAINERS_RYUK_DISABLED`.** Real-Postgres suites need it exported locally; it must not reach a file.
- **`docs/` is prettier-ignored**; `apps/**` is not. Run `pnpm format` before committing code.
- **The pre-push hook runs the full workspace gates (~83s). Do not bypass it.**
- **`WAITRON_AEAT_ENV` defaults to `preproduction`.** Production numbering can never be reused, so this default must never be flipped for convenience.

> **2026-07-29 note:** `WAITRON_AEAT_ENV` was replaced by `WAITRON_ENV` — see the
> [deployment-environment design](../specs/2026-07-29-deployment-environment-design.md). This plan,
> including every `aeatEnv`/`AeatEnvironment` reference below, records what was true when it was
> written and is left unchanged.

---

## File Structure

```text
apps/server/
  package.json                     @waitron/server — bin, build (esbuild + migration copy), test, typecheck, lint
  tsconfig.json
  vitest.config.ts
  migrations.manifest.json         single source of truth: name, journal table, source folder
  scripts/copy-migrations.mjs      build step; reads the manifest
  src/
    errors.ts                      server.* ErrorParams augmentation
    config.ts                      ServerConfig + loadConfig(env, defaultMigrationsRoot)
    logger.ts                      one JSON line per event, sink injected
    migrations.ts                  manifest → MigrationOptions[]; applyMigrations behind an advisory lock
    credentials.ts                 tenant-scoped vault reads shared by both resolvers
    aeat-transport.ts              cert material → undici Agent → VerifactuClient, per tenant
    stripe-account.ts              vault → StripeReconcileAccount, per tenant
    reconcile-duty.ts              PaymentReconciler → PeriodDuty (moved from the scheduler's fit test)
    pass.ts                        one pass: drain, then runDue; folds nextDueAt; contains failures
    health.ts                      HealthState, staleness budgets, the Hono app
    loop.ts                        sleep-until-nextDueAt with clamps and shutdown
    boot.ts                        wires the real implementations; owns the pool and the listener
    bin.ts                         entry point
    testing/
      postgres.ts                  Testcontainers + all five migration sets
      tls.ts                       node-forge CA, server cert, client PFX, local mTLS server
  test/
    seed.ts                        seedTenant / freshNif (the repo's sixth copy — see Task 12)
```

Files changed outside `apps/`:

- `packages/fiscal-verifactu/src/drain.ts`, `src/backend.ts`, `src/index.ts` — Task 2
- `packages/fiscal/src/backend.ts` (`DrainResult.skipped`) — Task 2
- `packages/credentials/src/purposes.ts` — Task 3
- `packages/scheduler/src/payments-fit.test.ts` — Task 6 (**deleted**; the host's own file becomes the compile-time proof)
- `packages/db/src/english-only.ts` + `eslint.config.js` — Task 12

---

### Task 1: Package skeleton, error codes, and configuration

Implements spec §10 and the `server.*` half of §8.

**Files:**

- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`
- Create: `apps/server/src/errors.ts`, `apps/server/src/config.ts`, `apps/server/src/logger.ts`
- Test: `apps/server/src/config.test.ts`, `apps/server/src/logger.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type AeatEnvironment = "production" | "preproduction"`
  - `interface ServerConfig { databaseUrl: string; aeatEnv: AeatEnvironment; httpPort: number; minTickMs: number; maxTickMs: number; settlementLagMs: number | undefined; migrationsRoot: string; scheduler: { horizonDays: number; maxPeriodsPerTick: number; maxAttempts: number; backoffBaseMs: number; staleAfterMs: number } }`
  - `function loadConfig(env: Record<string, string | undefined>, defaultMigrationsRoot: string): ServerConfig`
  - `type LogLevel = "info" | "warn" | "error"`
  - `type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void`
  - `function createLogger(sink: (line: string) => void, now: () => Date): Logger`
  - Error codes: `server.config_missing { variable }`, `server.config_invalid { variable, reason }`

- [ ] **Step 1: Create the package manifest**

`apps/server/package.json`:

```json
{
  "name": "@waitron/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/bin.ts",
  "bin": { "waitron-server": "./dist/server.js" },
  "scripts": {
    "build": "node scripts/copy-migrations.mjs && esbuild src/bin.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/server.js --banner:js=\"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@waitron/credentials": "workspace:*",
    "@waitron/db": "workspace:*",
    "@waitron/fiscal": "workspace:*",
    "@waitron/fiscal-verifactu": "workspace:*",
    "@waitron/payments": "workspace:*",
    "@waitron/payments-stripe": "workspace:*",
    "@waitron/scheduler": "workspace:*",
    "@waitron/shared": "workspace:*",
    "@waitron/verifactu": "workspace:*",
    "hono": "^4.6.0",
    "pg": "^8.13.0",
    "stripe": "^22.3.2",
    "undici": "^8.7.0"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^12.0.4",
    "@types/node": "^24.0.0",
    "@types/node-forge": "^1.3.0",
    "@types/pg": "^8.11.0",
    "@vitest/coverage-v8": "^3.0.0",
    "esbuild": "^0.25.0",
    "node-forge": "^1.3.1",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig and vitest config**

`apps/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals", "node"],
    "resolveJsonModule": true
  },
  "include": ["src", "test", "scripts"]
}
```

`apps/server/vitest.config.ts` — coverage thresholds are deliberately omitted here and added once, in Task 12, after every source file exists:

```typescript
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The real-Postgres and mTLS suites pull a container and mint certificates in a beforeAll.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers. Same
    // finding as packages/payments and packages/scheduler.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "scripts/**", "src/testing/**", "src/bin.ts"],
    },
  },
});
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
```

Expected: `apps/server` appears as a workspace member; no lockfile errors.

- [ ] **Step 4: Write the failing config tests**

`apps/server/src/config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { captureError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { loadConfig } from "./config.js";

const MIN_ENV = { DATABASE_URL: "postgres://u@h/d" };
const ROOT = "/opt/waitron/drizzle";

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

describe("loadConfig", () => {
  it("defaults every optional value, and defaults AEAT to preproduction", () => {
    const config = loadConfig(MIN_ENV, ROOT);
    expect(config).toEqual({
      databaseUrl: "postgres://u@h/d",
      // Production numbering can never be reused, so the safe environment is the default and
      // production must be typed out. This assertion is the guard on that.
      aeatEnv: "preproduction",
      httpPort: 8080,
      minTickMs: 5_000,
      maxTickMs: 3_600_000,
      settlementLagMs: undefined,
      migrationsRoot: ROOT,
      scheduler: {
        horizonDays: 30,
        maxPeriodsPerTick: 7,
        maxAttempts: 3,
        backoffBaseMs: 900_000,
        staleAfterMs: 3_600_000,
      },
    });
  });

  it("requires DATABASE_URL", async () => {
    const error = await captureError(() => Promise.resolve(loadConfig({}, ROOT)));
    expect(codeOf(error)).toBe("server.config_missing");
    expect(isAppError(error) && error.params).toMatchObject({ variable: "DATABASE_URL" });
  });

  it("reads every override", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_AEAT_ENV: "production",
        WAITRON_HTTP_PORT: "9000",
        WAITRON_MIN_TICK_MS: "1000",
        WAITRON_MAX_TICK_MS: "60000",
        WAITRON_SETTLEMENT_LAG_MS: "172800000",
        WAITRON_MIGRATIONS_DIR: "/srv/migrations",
        WAITRON_SCHEDULER_HORIZON_DAYS: "14",
        WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK: "3",
        WAITRON_SCHEDULER_MAX_ATTEMPTS: "5",
        WAITRON_SCHEDULER_BACKOFF_BASE_MS: "1000",
        WAITRON_SCHEDULER_STALE_AFTER_MS: "2000",
      },
      ROOT,
    );
    expect(config.aeatEnv).toBe("production");
    expect(config.httpPort).toBe(9000);
    expect(config.minTickMs).toBe(1000);
    expect(config.maxTickMs).toBe(60_000);
    expect(config.settlementLagMs).toBe(172_800_000);
    expect(config.migrationsRoot).toBe("/srv/migrations");
    expect(config.scheduler).toEqual({
      horizonDays: 14,
      maxPeriodsPerTick: 3,
      maxAttempts: 5,
      backoffBaseMs: 1000,
      staleAfterMs: 2000,
    });
  });

  it.each([
    ["WAITRON_AEAT_ENV", "sandbox", "not_an_aeat_environment"],
    ["WAITRON_HTTP_PORT", "http", "not_a_positive_integer"],
    ["WAITRON_HTTP_PORT", "0", "not_a_positive_integer"],
    ["WAITRON_MIN_TICK_MS", "-1", "not_a_positive_integer"],
    ["WAITRON_SCHEDULER_MAX_ATTEMPTS", "1.5", "not_a_positive_integer"],
  ])("rejects %s=%s", async (variable, value, reason) => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({ ...MIN_ENV, [variable]: value }, ROOT)),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // The variable NAME and a reason CODE — never the value, which is arbitrary operator input and
    // could be a mistyped secret.
    expect(isAppError(error) && error.params).toEqual({ variable, reason });
  });

  it("rejects a minTick above maxTick, which would make the clamp unsatisfiable", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig({ ...MIN_ENV, WAITRON_MIN_TICK_MS: "10000", WAITRON_MAX_TICK_MS: "5000" }, ROOT),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_MIN_TICK_MS",
      reason: "above_max_tick",
    });
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
pnpm --filter @waitron/server test
```

Expected: FAIL — `Cannot find module './config.js'`.

- [ ] **Step 6: Write `errors.ts`**

`apps/server/src/errors.ts`:

```typescript
// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/payments/src/errors.ts and packages/credentials/src/errors.ts use.
import "@waitron/shared";

/**
 * This host's contribution to the shared error registry, by declaration merging. The convention is
 * the DOMAIN CONCEPT, lowercase and dot-namespaced — `server.*` here because these are facts about
 * the process itself, not about a sale, a payment or a credential.
 *
 * Reachability: every file that throws one of these imports "./errors.js" directly, and this
 * package has no public barrel to keep them reachable from — it is an application, not a library.
 * `errors.reachability.test.ts` exists in library packages for consumers that only see `index.ts`;
 * there is no such consumer here.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A required environment variable is absent or empty. `variable` is our own declared name. */
    "server.config_missing": { variable: string };
    /**
     * A supplied environment variable cannot be used. Carries the variable NAME and a reason CODE
     * and never the value: an operator who pasted a secret into the wrong variable must not have it
     * land in an error's params, the same leak `credentials.invalid_payload` avoids by reporting a
     * count instead of field names.
     */
    "server.config_invalid": { variable: string; reason: string };
    /**
     * A tenant's credential exists but this host cannot use it — a field the purpose registry now
     * declares is absent from a row sealed under an older field list, or its value is not one of
     * the accepted ones. `field` is a name from `PURPOSES`, so it is ours to echo. Spec §5.1: this
     * is the read-side half of `rotate`'s coupling to the registry, and it fails one tenant loudly
     * rather than defaulting to a wrong AEAT host in silence.
     */
    "server.credential_unusable": { tenantId: string; purpose: string; field: string };
    /** A migration folder named by the manifest is absent or carries no Drizzle journal. */
    "server.migrations_missing": { name: string; folder: string };
  }
}
```

- [ ] **Step 7: Write `config.ts`**

`apps/server/src/config.ts`:

```typescript
import { AppError } from "@waitron/shared";
import { DEFAULTS } from "@waitron/scheduler";
import "./errors.js";

export type AeatEnvironment = "production" | "preproduction";

export interface SchedulerConfig {
  horizonDays: number;
  maxPeriodsPerTick: number;
  maxAttempts: number;
  backoffBaseMs: number;
  staleAfterMs: number;
}

export interface ServerConfig {
  databaseUrl: string;
  aeatEnv: AeatEnvironment;
  httpPort: number;
  minTickMs: number;
  maxTickMs: number;
  /** Undefined means "let the neutral layer apply its own seven days" — not zero. */
  settlementLagMs: number | undefined;
  migrationsRoot: string;
  scheduler: SchedulerConfig;
}

/** A liveness floor, not a performance knob: `drain`'s hourly duty must not be lengthened by a
 * quiet ledger, so no sleep may exceed this however far away the next due time looks. */
const DEFAULT_MAX_TICK_MS = 60 * 60 * 1000;
/** Stops a hot loop when a duty reports `now`, which both do for deferred or skipped work. */
const DEFAULT_MIN_TICK_MS = 5_000;
const DEFAULT_HTTP_PORT = 8080;

type Env = Record<string, string | undefined>;

function required(env: Env, variable: string): string {
  const value = env[variable];
  if (value === undefined || value === "") {
    throw new AppError("server.config_missing", { variable });
  }
  return value;
}

function positiveInt(env: Env, variable: string, fallback: number): number {
  const raw = env[variable];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError("server.config_invalid", { variable, reason: "not_a_positive_integer" });
  }
  return value;
}

function optionalPositiveInt(env: Env, variable: string): number | undefined {
  const raw = env[variable];
  if (raw === undefined || raw === "") return undefined;
  return positiveInt(env, variable, 0);
}

function aeatEnvironment(env: Env): AeatEnvironment {
  const raw = env.WAITRON_AEAT_ENV;
  // The DEFAULT is preproduction and production must be typed out. Architecture §9: production
  // numbering can never be reused, even for a test invoice, so this is the one default in the file
  // whose mistake is irreversible.
  if (raw === undefined || raw === "") return "preproduction";
  if (raw !== "production" && raw !== "preproduction") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_AEAT_ENV",
      reason: "not_an_aeat_environment",
    });
  }
  return raw;
}

export function loadConfig(env: Env, defaultMigrationsRoot: string): ServerConfig {
  const minTickMs = positiveInt(env, "WAITRON_MIN_TICK_MS", DEFAULT_MIN_TICK_MS);
  const maxTickMs = positiveInt(env, "WAITRON_MAX_TICK_MS", DEFAULT_MAX_TICK_MS);
  // Checked here rather than left to `clamp`, whose Math.min/Math.max composition would silently
  // resolve an impossible range to whichever bound happened to win.
  if (minTickMs > maxTickMs) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_MIN_TICK_MS",
      reason: "above_max_tick",
    });
  }
  const migrationsDir = env.WAITRON_MIGRATIONS_DIR;
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    aeatEnv: aeatEnvironment(env),
    httpPort: positiveInt(env, "WAITRON_HTTP_PORT", DEFAULT_HTTP_PORT),
    minTickMs,
    maxTickMs,
    settlementLagMs: optionalPositiveInt(env, "WAITRON_SETTLEMENT_LAG_MS"),
    migrationsRoot:
      migrationsDir === undefined || migrationsDir === "" ? defaultMigrationsRoot : migrationsDir,
    scheduler: {
      horizonDays: positiveInt(env, "WAITRON_SCHEDULER_HORIZON_DAYS", DEFAULTS.horizonDays),
      maxPeriodsPerTick: positiveInt(
        env,
        "WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK",
        DEFAULTS.maxPeriodsPerTick,
      ),
      maxAttempts: positiveInt(env, "WAITRON_SCHEDULER_MAX_ATTEMPTS", DEFAULTS.maxAttempts),
      backoffBaseMs: positiveInt(env, "WAITRON_SCHEDULER_BACKOFF_BASE_MS", DEFAULTS.backoffBaseMs),
      staleAfterMs: positiveInt(env, "WAITRON_SCHEDULER_STALE_AFTER_MS", DEFAULTS.staleAfterMs),
    },
  };
}
```

Note the four `WAITRON_CREDENTIALS_KEY*` names are absent by design: `process.env` is handed straight to `loadKeyRing`, which owns those names and their validation (spec §10).

- [ ] **Step 8: Write the logger test**

`apps/server/src/logger.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

const AT = new Date("2026-07-26T09:14:02.000Z");

describe("createLogger", () => {
  it("writes one JSON line per event, newline-terminated", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line), () => AT);

    log("info", "pass.complete", { sleepMs: 3600000, nextDueAt: null });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    expect(JSON.parse(lines[0]!)).toEqual({
      at: "2026-07-26T09:14:02.000Z",
      level: "info",
      event: "pass.complete",
      sleepMs: 3600000,
      nextDueAt: null,
    });
  });

  it("carries no fields when none are given", () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line), () => AT)("warn", "duty.failed");
    expect(JSON.parse(lines[0]!)).toEqual({
      at: "2026-07-26T09:14:02.000Z",
      level: "warn",
      event: "duty.failed",
    });
  });

  it("does not let a field overwrite at/level/event", () => {
    const lines: string[] = [];
    createLogger((line) => lines.push(line), () => AT)("error", "real.event", {
      event: "spoofed",
      level: "info",
    });
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.event).toBe("real.event");
    expect(parsed.level).toBe("error");
  });
});
```

- [ ] **Step 9: Run to verify it fails**

```bash
pnpm --filter @waitron/server test src/logger.test.ts
```

Expected: FAIL — `Cannot find module './logger.js'`.

- [ ] **Step 10: Write `logger.ts`**

`apps/server/src/logger.ts`:

```typescript
export type LogLevel = "info" | "warn" | "error";

export type Logger = (
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
) => void;

/**
 * One structured JSON line per event, on an injected sink so no test writes to a real stream and no
 * test reads one back. Structured rather than prose for the same reason every error in this repo
 * carries a code: a line is read by a log collector first and a human second.
 *
 * `at`, `level` and `event` are written AFTER the caller's fields so a field named `event` cannot
 * shadow the event — the spread order is the whole guard, and `logger.test.ts` pins it.
 */
export function createLogger(sink: (line: string) => void, now: () => Date): Logger {
  return (level, event, fields) => {
    sink(`${JSON.stringify({ ...fields, at: now().toISOString(), level, event })}\n`);
  };
}
```

- [ ] **Step 11: Run all tests, typecheck and lint**

```bash
pnpm --filter @waitron/server test && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server lint
```

Expected: PASS on all three.

- [ ] **Step 12: Commit**

```bash
pnpm format
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): the apps/server package skeleton, error codes, config and logger"
```

---

### Task 2: `drain` resolves a client per tenant, and contains one tenant's failure

Implements spec §4. This is the correctness fix, and it lands before anything calls `drain`.

**Files:**

- Modify: `packages/fiscal/src/backend.ts` (`DrainResult` gains `skipped`)
- Modify: `packages/fiscal-verifactu/src/drain.ts` (`DrainDeps.resolveClient`, per-tenant containment)
- Modify: `packages/fiscal-verifactu/src/backend.ts` (`VerifactuBackendOptions.resolveClient`)
- Modify: `packages/fiscal-verifactu/src/index.ts` (export `drain`, `DrainDeps`)
- Test: `packages/fiscal-verifactu/src/drain.tenancy.test.ts` (new)
- Modify: every existing construction of `VerifactuBackend`/`DrainDeps` in `packages/fiscal-verifactu` and `packages/core` test files

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces:
  - `interface DrainDeps { db: Database; resolveClient: (tenantId: TenantId) => Promise<VerifactuClient> }`
  - `DrainResult.skipped: { tenantId: string; errorCode: string }[]`
  - `export { drain }` and `export type { DrainDeps }` from `@waitron/fiscal-verifactu`

- [ ] **Step 1: Write the failing tenancy test**

`packages/fiscal-verifactu/src/drain.tenancy.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { VerifactuClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, type Database } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { drain } from "./drain.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";

// The same pair of instants `drain.test.ts` uses: the fake AEAT's `serverNow`, and a `now` one
// minute later so the seeded rows are due.
const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const NOW = new Date("2026-07-21T00:01:00Z");

/**
 * A client that records which tenant asked for it. `drain` took ONE client for every tenant it
 * swept, so under per-tenant certificates it presented tenant B's invoices with tenant A's seal.
 * These tests are the ones that could have caught that, and they only can because they make the
 * RESOLVER the subject rather than the submission.
 */
function recordingResolver(): {
  resolveClient: (tenantId: TenantId) => Promise<VerifactuClient>;
  asked: TenantId[];
} {
  const asked: TenantId[] = [];
  // Submission is not this resolver's subject; a rejection here is contained per tenant and lands in
  // `skipped`, which the test below does not read.
  const client: VerifactuClient = {
    submit: () => Promise.reject(new Error("submission is not this test's subject")),
    consultar: () => Promise.reject(new Error("consulta is not this test's subject")),
  };
  return {
    asked,
    resolveClient: (tenantId) => {
      asked.push(tenantId);
      return Promise.resolve(client);
    },
  };
}

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  if (db !== undefined) await db.close();
});

describe("drain resolves one client per tenant", () => {
  it("never asks the resolver for a tenant with no due work", async () => {
    // The negative half, and it is not pedantry: the resolver DECRYPTS a certificate, so asking for
    // one per known tenant rather than per tenant-with-work would put every tenant's private key in
    // memory on every pass, for nothing. Asserted against a specific idle tenant rather than an
    // empty list, so the test does not depend on running before the seeding one.
    const { tenantId: idle } = await seedTenantWithSif(db);
    const { resolveClient, asked } = recordingResolver();
    await drain({ db, resolveClient }, NOW);
    expect(asked).not.toContain(idle);
  });

  it("reports a tenant whose client cannot be resolved, and keeps sweeping the rest", async () => {
    // Two tenants, each with a due `pendiente` row; the first tenant's resolver throws. Before this
    // change there was no try/catch around the per-tenant sweep at all, so one unresolvable
    // certificate aborted every OTHER tenant's legally-timed submission.
    //
    // `seedPendingEnvios` seeds its OWN tenant (through `seedTenantWithSif`), so two calls give two
    // tenants each with due work — no new fixture, and no second copy of a NOT NULL column list.
    const failing = (await seedPendingEnvios(db, { count: 1 })).tenantId;
    const working = (await seedPendingEnvios(db, { count: 1 })).tenantId;
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });

    const calls: TenantId[] = [];
    const result = await drain(
      {
        db,
        resolveClient: (tenantId) => {
          calls.push(tenantId);
          if (tenantId === failing) {
            return Promise.reject(
              new AppError("server.credential_unusable", {
                tenantId,
                purpose: "fiscal.aeat",
                field: "certKind",
              }),
            );
          }
          // The fake AEAT, so the working tenant genuinely SUBMITS and is accepted. A client whose
          // submit rejected would prove nothing here: the assertion that matters is that real work
          // completed for the second tenant after the first one failed.
          return Promise.resolve(aeat.client());
        },
      },
      NOW,
    );

    expect(calls).toContain(failing);
    expect(calls).toContain(working);
    expect(result.skipped).toEqual([
      { tenantId: failing, errorCode: "server.credential_unusable" },
    ]);
    // The load-bearing assertion. `recordsAccepted` counts the WORKING tenant's row, so it is
    // non-zero only if the sweep continued past the failure — which is the whole point of the
    // containment. Asserting `skipped.length === 1` alone would also pass if the sweep had stopped.
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsSubmitted).toBe(1);
  });
});
```

Note `beforeAll`/`afterAll` are used without import because this package's vitest config sets `globals: true`; follow whatever the sibling suites in `packages/fiscal-verifactu/src` do.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/fiscal-verifactu test src/drain.tenancy.test.ts
```

Expected: FAIL — `resolveClient` is not a property of `DrainDeps`, and `result.skipped` is undefined.

- [ ] **Step 3: Add `skipped` to `DrainResult`**

In `packages/fiscal/src/backend.ts`, extend the interface:

```typescript
export interface DrainResult {
  nextDueAt: Date | null;
  batchesSent: number;
  recordsSubmitted: number;
  recordsAccepted: number; // includes accepted-with-errors — still counts as accepted
  recordsHalted: number; // records rejected or otherwise stopped
  incidentsRaised: number;
  /**
   * A tenant this pass abandoned before submitting anything for it — its transport could not be
   * built, or its sweep threw. Mirrors `TickResult.skipped` in `@waitron/scheduler`, and for the
   * same reason: a per-tenant failure has no ledger row of its own to carry it, so reporting it
   * here is the alternative to swallowing it. NEVER silent — a tenant with due fiscal work that
   * this pass could not submit is an unmet legal obligation.
   */
  skipped: { tenantId: string; errorCode: string }[];
}
```

- [ ] **Step 4: Change `DrainDeps` and contain the per-tenant sweep**

In `packages/fiscal-verifactu/src/drain.ts`:

```typescript
export interface DrainDeps {
  db: Database;
  /**
   * The tenant's own AEAT transport. A FUNCTION, not a fixed client: this sweep enumerates its own
   * tenants across `envios_tenants_with_work`, while a Veri*Factu certificate identifies ONE
   * presenter — so a single injected client submitted every tenant's records under whichever
   * tenant's seal the host happened to construct it from.
   *
   * Mirrors `StripeReconcilerOptions.resolveAccount` and
   * `StripeTerminalProviderOptions.resolveReader`, which are functions of `tenantId` for exactly
   * this reason. A deployment that establishes it may lawfully submit for many issuers under one
   * certificate returns the same client for every tenant; a fixed client could not express the
   * other answer at all.
   *
   * Resolved lazily, INSIDE the per-tenant loop and only for tenants with due work: a certificate
   * decrypted for a tenant with nothing to submit is a secret in memory for no reason.
   */
  resolveClient: (tenantId: TenantId) => Promise<VerifactuClient>;
}

export async function drain(deps: DrainDeps, now: Date): Promise<DrainResult> {
  const result: DrainResult = {
    nextDueAt: null,
    batchesSent: 0,
    recordsSubmitted: 0,
    recordsAccepted: 0,
    recordsHalted: 0,
    incidentsRaised: 0,
    skipped: [],
  };
  for (const tenantId of await tenantsWithWork(deps.db, now)) {
    const scoped = brandTenantId(tenantId);
    try {
      const client = await deps.resolveClient(scoped);
      await drainTenant(deps.db, client, scoped, now, result);
    } catch (error) {
      // Contained per tenant, deliberately. Before this, one tenant's failure threw straight out of
      // the sweep and every LATER tenant's submission — each with its own legal clock — never
      // happened, silently, because nothing above this called drain in a loop either.
      result.skipped.push({ tenantId, errorCode: codeOf(error) });
    }
  }
  return result;
}
```

`codeOf` already exists at the bottom of this file. Import `tenantId as brandTenantId` from `@waitron/shared` if `tenantsWithWork` still returns `string[]`; alternatively change `tenantsWithWork` to return `TenantId[]` and drop the branding here — pick one and do not leave both.

- [ ] **Step 5: Thread the resolver through `VerifactuBackend`**

In `packages/fiscal-verifactu/src/backend.ts`, replace the `client` option:

```typescript
  /**
   * The AEAT transport, per tenant. mTLS/endpoint live inside the caller-supplied fetch this wraps
   * (`createClient({ endpoint, fetch })`); tests wire it over the fake AEAT's fetch
   * (`@waitron/verifactu`'s `createFakeAeat().client()`), which needs no certificate and so returns
   * the same client for every tenant.
   *
   * A function of `tenantId` because `drain` sweeps every tenant with due work and a certificate
   * identifies one presenter — see `DrainDeps.resolveClient`. Used by `drain` and `reconcile`, not
   * by `recordSale`/`recordVoid`/`registerTill`/`checkIntegrity`/`pendingCount` — none of those
   * ever contact AEAT (spec §4: nothing here may block a sale on connectivity).
   */
  resolveClient: (tenantId: TenantId) => Promise<VerifactuClient>;
```

and the method:

```typescript
  async drain(now: Date): Promise<DrainResult> {
    return runDrain({ db: this.db, resolveClient: this.opts.resolveClient }, now);
  }
```

`reconcile(tenantId, …)` already receives a tenant, so it awaits `this.opts.resolveClient(tenantId)` where it previously read `this.client`. Follow the compiler.

- [ ] **Step 6: Export `drain` from the barrel**

In `packages/fiscal-verifactu/src/index.ts`, add:

```typescript
// The drainer itself, not only `VerifactuBackend.drain`. The `apps/*` host calls this directly:
// constructing a backend to reach it would demand a `TrustedClock` and a `db` handle the drainer
// never touches.
export { drain } from "./drain.js";
export type { DrainDeps } from "./drain.js";
```

- [ ] **Step 7: Fix every existing construction site**

```bash
pnpm --filter @waitron/fiscal-verifactu typecheck
pnpm --filter @waitron/core typecheck
```

Every `client: someClient` becomes `resolveClient: () => Promise.resolve(someClient)`. Every place that asserts a whole `DrainResult` object gains `skipped: []`. Work the compiler's list to zero.

- [ ] **Step 8: Run the full suites**

```bash
pnpm --filter @waitron/fiscal test && pnpm --filter @waitron/fiscal-verifactu test && pnpm --filter @waitron/core test
```

Expected: PASS, including the two new tenancy tests.

- [ ] **Step 9: Verify the guard by reintroducing the bug**

Temporarily replace the per-tenant `try`/`catch` in `drain` with a bare `await drainTenant(...)`, run `pnpm --filter @waitron/fiscal-verifactu test src/drain.tenancy.test.ts`, and confirm the second test FAILS. Restore the `catch`. A structural guard that has never been seen to fail is not known to guard anything.

- [ ] **Step 10: Commit**

```bash
pnpm format
git add packages/fiscal packages/fiscal-verifactu packages/core
git commit -m "fix(fiscal-verifactu): resolve drain's AEAT client per tenant, and contain one tenant's failure"
```

---

### Task 3: `certKind` joins the `fiscal.aeat` purpose

Implements spec §5. Small, and it must land before the transport reads the field.

**Files:**

- Modify: `packages/credentials/src/purposes.ts`
- Modify: `packages/credentials/src/purposes.test.ts`, and any other credentials test that provisions `fiscal.aeat`

**Interfaces:**

- Produces: `PURPOSES["fiscal.aeat"] = ["pfxBase64", "passphrase", "certKind"]`

- [ ] **Step 1: Write the failing test**

Add to `packages/credentials/src/purposes.test.ts`:

```typescript
it("requires certKind on fiscal.aeat, because the sello endpoint is a different AEAT host", () => {
  // SOAP_ENDPOINTS_SELLO is www10/prewww10, not www1/prewww1. The endpoint is therefore a
  // function of the certificate's kind, which is per-tenant provisioning data — the host cannot
  // infer it without parsing X.509 policy OIDs.
  expect(PURPOSES["fiscal.aeat"]).toEqual(["pfxBase64", "passphrase", "certKind"]);
  expect(() =>
    validatePayload("fiscal.aeat", { pfxBase64: "AAA=", passphrase: "s3cret" }),
  ).toThrow(/credentials.invalid_payload/);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/credentials test src/purposes.test.ts
```

Expected: FAIL — the array has two entries.

- [ ] **Step 3: Add the field**

In `packages/credentials/src/purposes.ts`:

```typescript
export const PURPOSES = {
  "payments.stripe": ["secretKey", "webhookSecret", "successUrl", "cancelUrl"],
  /**
   * `certKind` is `"sello"` or `"representante"` — validated by the READER, not here: this package
   * declares field names and never their vocabularies, which is the line that keeps it a leaf.
   * It exists because `SOAP_ENDPOINTS_SELLO` is a different AEAT host from `SOAP_ENDPOINTS`, so the
   * endpoint depends on the certificate's kind and nothing else knows it.
   *
   * Still PROVISIONAL for the reason below, and note the cost of editing this list: `rotate`
   * re-runs `validatePayload`, so a row sealed under an older list aborts a rotation sweep, and a
   * read returns a payload missing the new field. The host validates what it reads for exactly that
   * reason (see the server design §5.1); adding a field remains cheap only while nothing is
   * provisioned.
   */
  "fiscal.aeat": ["pfxBase64", "passphrase", "certKind"],
} as const satisfies Record<string, readonly string[]>;
```

- [ ] **Step 4: Fix the other provisioning sites**

```bash
pnpm --filter @waitron/credentials test
```

Every test that seals a `fiscal.aeat` payload gains `certKind: "sello"` (or `"representante"` where the test reads better for it). Work the failures to zero.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/credentials
git commit -m "feat(credentials): fiscal.aeat carries certKind, which selects the AEAT host"
```

---

### Task 4: The AEAT transport — vault PFX to a real client-certificate handshake

Implements spec §3.2, §5, §5.1 and the transport half of §12.

**Files:**

- Create: `apps/server/src/credentials.ts`, `apps/server/src/aeat-transport.ts`
- Create: `apps/server/src/testing/tls.ts`
- Test: `apps/server/src/aeat-transport.test.ts`

**Interfaces:**

- Consumes: `AeatEnvironment` and the `server.credential_unusable` code from Task 1; `certKind` from Task 3.
- Produces:
  - `function readCredential(db: Database, ring: KeyRing, tenantId: TenantId, purpose: Purpose): Promise<Record<string, string>>`
  - `type CertKind = "sello" | "representante"`
  - `interface CertMaterial { pfx: Buffer; passphrase: string; certKind: CertKind }`
  - `function readCertMaterial(db: Database, ring: KeyRing, tenantId: TenantId): Promise<CertMaterial>`
  - `function aeatEndpointFor(aeatEnv: AeatEnvironment): (certKind: CertKind) => string`
  - `function mtlsFetch(material: CertMaterial, ca?: string): typeof globalThis.fetch`
  - `interface TransportDeps { db: Database; ring: KeyRing; endpointFor: (certKind: CertKind) => string; fetchFor: (material: CertMaterial) => typeof globalThis.fetch }`
  - `function aeatClientResolver(deps: TransportDeps): (tenantId: TenantId) => Promise<VerifactuClient>`
  - From `src/testing/tls.ts`: `function mintMtlsMaterial(): { caPem: string; serverKeyPem: string; serverCertPem: string; clientPfx: Buffer; clientPassphrase: string }` and `function startMtlsServer(material, handler): Promise<{ origin: string; close(): Promise<void>; sawClientCn: () => string | null }>`

- [ ] **Step 1: Write the TLS fixture helper**

`apps/server/src/testing/tls.ts`:

```typescript
import { createServer, type ServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import forge from "node-forge";

export interface MtlsMaterial {
  caPem: string;
  serverKeyPem: string;
  serverCertPem: string;
  /** DER-encoded PKCS#12, the same shape the vault stores base64 of. */
  clientPfx: Buffer;
  clientPassphrase: string;
  clientCn: string;
}

function keypair(): forge.pki.rsa.KeyPair {
  return forge.pki.rsa.generateKeyPair(2048);
}

function certificate(
  subjectCn: string,
  subjectKeys: forge.pki.rsa.KeyPair,
  issuer: { cn: string; key: forge.pki.rsa.PrivateKey },
  extensions: forge.pki.CertificateExtension[],
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = subjectKeys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(2026, 0, 1);
  cert.validity.notAfter = new Date(2030, 0, 1);
  cert.setSubject([{ name: "commonName", value: subjectCn }]);
  cert.setIssuer([{ name: "commonName", value: issuer.cn }]);
  cert.setExtensions(extensions);
  cert.sign(issuer.key, forge.md.sha256.create());
  return cert;
}

/**
 * A private CA, a `localhost` server certificate and a client certificate exported as PKCS#12 —
 * everything a real client-certificate handshake needs, minted in-process.
 *
 * node-forge rather than shelling out to `openssl`: the suite must not depend on a binary being
 * installed on a CI image, and it must produce PKCS#12 (the shape the vault actually stores),
 * which `node:crypto` can read but not create.
 */
export function mintMtlsMaterial(): MtlsMaterial {
  const caKeys = keypair();
  const caCert = certificate("waitron-test-ca", caKeys, { cn: "waitron-test-ca", key: caKeys.privateKey }, [
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true },
  ]);

  const serverKeys = keypair();
  const serverCert = certificate("localhost", serverKeys, { cn: "waitron-test-ca", key: caKeys.privateKey }, [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    // type 2 is dNSName, type 7 is iPAddress — both, so the test can dial either.
    { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] },
  ]);

  const clientCn = "waitron-test-client";
  const clientKeys = keypair();
  const clientCert = certificate(clientCn, clientKeys, { cn: "waitron-test-ca", key: caKeys.privateKey }, [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true },
    { name: "extKeyUsage", clientAuth: true },
  ]);

  const clientPassphrase = "pfx-passphrase";
  const p12 = forge.pkcs12.toPkcs12Asn1(clientKeys.privateKey, [clientCert, caCert], clientPassphrase);
  const der = forge.asn1.toDer(p12).getBytes();

  return {
    caPem: forge.pki.certificateToPem(caCert),
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
    serverCertPem: forge.pki.certificateToPem(serverCert),
    clientPfx: Buffer.from(der, "binary"),
    clientPassphrase,
    clientCn,
  };
}

export interface MtlsServer {
  origin: string;
  /** The CN the last accepted connection presented, or null if no request has arrived. */
  sawClientCn: () => string | null;
  close: () => Promise<void>;
}

/**
 * An HTTPS server that REQUIRES and VERIFIES a client certificate — `requestCert` alone would
 * accept an unauthenticated connection and prove nothing, so `rejectUnauthorized` is the half that
 * makes this a test of mTLS rather than of TLS.
 */
export async function startMtlsServer(
  material: MtlsMaterial,
  respondWith: string,
): Promise<MtlsServer> {
  let lastCn: string | null = null;
  const options: ServerOptions = {
    key: material.serverKeyPem,
    cert: material.serverCertPem,
    ca: material.caPem,
    requestCert: true,
    rejectUnauthorized: true,
  };
  const server = createServer(options, (req, res) => {
    const peer = (req.socket as import("node:tls").TLSSocket).getPeerCertificate();
    lastCn = peer.subject?.CN ?? null;
    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
    res.end(respondWith);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `https://localhost:${port}`,
    sawClientCn: () => lastCn,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
```

- [ ] **Step 2: Write the failing transport tests**

`apps/server/src/aeat-transport.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import type { KeyRing } from "@waitron/credentials";
import { isAppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { Cabecera } from "@waitron/verifactu";
import {
  aeatClientResolver,
  aeatEndpointFor,
  certMaterialFrom,
  mtlsFetch,
  readCertMaterial,
} from "./aeat-transport.js";
import { mintMtlsMaterial, startMtlsServer, type MtlsMaterial, type MtlsServer } from "./testing/tls.js";
import { seedTenant } from "../test/seed.js";

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

// A minimal SOAP-shaped body. This suite is about the HANDSHAKE, not about parsing — `createClient`
// parses, and its own suite covers that.
const SOAP_FAULT = '<?xml version="1.0"?><Envelope><Body/></Envelope>';

let db: Database;
let ring: KeyRing;
let material: MtlsMaterial;
let server: MtlsServer;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
  ring = loadKeyRing(KEY_ENV);
  material = mintMtlsMaterial();
  server = await startMtlsServer(material, SOAP_FAULT);
}, 120_000);

afterAll(async () => {
  if (server !== undefined) await server.close();
  if (db !== undefined) await db.close();
});

async function provision(certKind: string): Promise<TenantId> {
  const tenantId = await seedTenant(db);
  await withTenant(db, tenantId, (tx) =>
    putCredential(tx, ring, {
      tenantId,
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: material.clientPfx.toString("base64"),
        passphrase: material.clientPassphrase,
        certKind,
      },
    }),
  );
  return tenantId;
}

describe("aeatEndpointFor", () => {
  it("sends a sello certificate to the sello host, which is a different host entirely", () => {
    const preprod = aeatEndpointFor("preproduction");
    expect(preprod("sello")).toContain("prewww10");
    expect(preprod("representante")).toContain("prewww1.");
    const prod = aeatEndpointFor("production");
    expect(prod("sello")).toContain("www10");
    expect(prod("representante")).toContain("www1.");
  });
});

describe("readCertMaterial", () => {
  it("decodes the PFX and the kind", async () => {
    const tenantId = await provision("sello");
    const read = await readCertMaterial(db, ring, tenantId);
    expect(read.certKind).toBe("sello");
    expect(read.passphrase).toBe(material.clientPassphrase);
    expect(read.pfx.equals(material.clientPfx)).toBe(true);
  });

  it("rejects a certKind that is not one of the two kinds", async () => {
    const tenantId = await provision("wildcard");
    const error = await captureError(() => readCertMaterial(db, ring, tenantId));
    expect(isAppError(error) && error.code).toBe("server.credential_unusable");
    expect(isAppError(error) && error.params).toMatchObject({ field: "certKind" });
  });

  it("fails with credentials.missing when the tenant has no fiscal credential at all", async () => {
    const tenantId = await seedTenant(db);
    const error = await captureError(() => readCertMaterial(db, ring, tenantId));
    // The vault's own code, not ours: absence is the vault's fact to report, and drain's per-tenant
    // containment records whichever code arrives.
    expect(isAppError(error) && error.code).toBe("credentials.missing");
  });
});

describe("certMaterialFrom", () => {
  const REF = { tenantId: "11111111-1111-1111-1111-111111111111", purpose: "fiscal.aeat" };

  // Driven directly rather than through a forged database row. `putCredential` validates, so a
  // two-field payload cannot be written through the vault's own API — and re-sealing one by hand
  // would need `seal`, which the credentials package deliberately does not export. The pure
  // function IS the read-side guard, so testing it directly tests the thing.
  it("fails loudly on a payload sealed before certKind existed, rather than guessing a host", () => {
    // Spec §5.1: reads validate nothing, so a row sealed under the old two-field list decrypts to a
    // payload whose certKind is undefined. Defaulting would send a sello certificate to the
    // non-sello host and fail every submission for that tenant with nothing explaining why.
    expect(() => certMaterialFrom({ pfxBase64: "AAA=", passphrase: "p" }, REF)).toThrow(
      /server.credential_unusable/,
    );
  });

  it.each(["pfxBase64", "passphrase"])("fails loudly when %s is absent", async (field) => {
    const full: Record<string, string> = {
      pfxBase64: "AAA=",
      passphrase: "p",
      certKind: "sello",
    };
    delete full[field];
    // `captureError` catches a synchronous throw inside the thunk too — the throw happens before
    // `Promise.resolve` is ever reached, so it propagates out of the callback into its try.
    const error = await captureError(() => Promise.resolve(certMaterialFrom(full, REF)));
    expect(isAppError(error) && error.params).toMatchObject({ field });
  });

  it("decodes base64 to the exact DER bytes", () => {
    const material = certMaterialFrom(
      { pfxBase64: Buffer.from([1, 2, 3]).toString("base64"), passphrase: "p", certKind: "sello" },
      REF,
    );
    expect([...material.pfx]).toEqual([1, 2, 3]);
  });
});

describe("the resolved client over a real client-certificate handshake", () => {
  it("presents the vaulted certificate to a server that requires one", async () => {
    const tenantId = await provision("representante");
    const resolve = aeatClientResolver({
      db,
      ring,
      endpointFor: () => server.origin,
      fetchFor: (m) => mtlsFetch(m, material.caPem),
    });
    const client = await resolve(tenantId);

    // `submit` posts, and the local server answers with a body `parseRespuestaSuministro` will
    // reject. The assertion is the HANDSHAKE: the server only answers at all if the client
    // presented a certificate its CA signed.
    await captureError(() => client.submit(anyCabecera(), []));
    expect(server.sawClientCn()).toBe(material.clientCn);
  });

  it("is refused when no client certificate is presented", async () => {
    const bare = mtlsFetch(
      { pfx: Buffer.alloc(0), passphrase: "", certKind: "sello" },
      material.caPem,
    );
    const error = await captureError(() => bare(`${server.origin}/`, { method: "POST", body: "x" }));
    expect(error).toBeInstanceOf(Error);
  });
});
```

One helper this file needs, written at its bottom — the real `Cabecera` shape, PascalCase exactly as `serializeEnvio` reads it:

```typescript
/**
 * A minimal `Cabecera`. `submit` serialises it and POSTs; this suite never inspects the XML, and the
 * local server answers a body `parseRespuestaSuministro` will reject. The subject is the HANDSHAKE.
 */
function anyCabecera(): Cabecera {
  return { ObligadoEmision: { NombreRazon: "Test SL", NIF: "12345678Z" } };
}
```

with `import type { Cabecera } from "@waitron/verifactu";` at the top.

- [ ] **Step 3: Run to verify it fails**

```bash
pnpm --filter @waitron/server test src/aeat-transport.test.ts
```

Expected: FAIL — `Cannot find module './aeat-transport.js'`.

- [ ] **Step 4: Write `credentials.ts`**

`apps/server/src/credentials.ts`:

```typescript
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { getCredential } from "@waitron/credentials";
import type { KeyRing, Purpose } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";

/**
 * One tenant-scoped vault read. `tenant_credentials` is under FORCE ROW LEVEL SECURITY and
 * `getCredential` takes a `Transaction`, so the scope has to be established here — a bare
 * `db.transaction` sets no `app.tenant_id` and, under the real deployment role, matches no rows.
 *
 * Read per pass rather than cached at boot (design §6): a newly provisioned tenant is served
 * without a restart, a rotation takes effect without one, and a decrypted secret lives for one pass
 * instead of for the process's lifetime.
 */
export function readCredential(
  db: Database,
  ring: KeyRing,
  tenantId: TenantId,
  purpose: Purpose,
): Promise<Record<string, string>> {
  return withTenant(db, tenantId, (tx) => getCredential(tx, ring, { tenantId, purpose }));
}
```

- [ ] **Step 5: Write `aeat-transport.ts`**

`apps/server/src/aeat-transport.ts`:

```typescript
import { Agent, fetch as undiciFetch } from "undici";
import { AppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { SOAP_ENDPOINTS, SOAP_ENDPOINTS_SELLO, createClient } from "@waitron/verifactu";
import type { VerifactuClient } from "@waitron/verifactu";
import type { AeatEnvironment } from "./config.js";
import { readCredential } from "./credentials.js";
import "./errors.js";

/** Which FNMT certificate a tenant submits with. It selects the AEAT HOST, not merely a header. */
export type CertKind = "sello" | "representante";

const CERT_KINDS: readonly string[] = ["sello", "representante"];

export interface CertMaterial {
  /** DER-encoded PKCS#12, as `node:tls`' `pfx` option wants it. */
  pfx: Buffer;
  passphrase: string;
  certKind: CertKind;
}

/**
 * Validates the decrypted payload at the READ site and throws `server.credential_unusable` when a
 * declared field is absent or unusable.
 *
 * This is the read-side half of `rotate`'s coupling to `PURPOSES` (server design §5.1). Reads do not
 * validate, so a row sealed before `certKind` joined the registry decrypts to a payload missing it;
 * defaulting would send a sello certificate to the non-sello host and fail every submission for that
 * tenant with nothing anywhere explaining why. Validating HERE rather than in the store is
 * deliberate: the store would take the whole vault offline, while this costs one tenant one pass and
 * says so.
 */
export function certMaterialFrom(
  payload: Record<string, string | undefined>,
  ref: { tenantId: string; purpose: string },
): CertMaterial {
  const certKind = payload.certKind;
  if (certKind === undefined || !CERT_KINDS.includes(certKind)) {
    throw new AppError("server.credential_unusable", { ...ref, field: "certKind" });
  }
  const pfxBase64 = payload.pfxBase64;
  if (pfxBase64 === undefined || pfxBase64 === "") {
    throw new AppError("server.credential_unusable", { ...ref, field: "pfxBase64" });
  }
  const passphrase = payload.passphrase;
  if (passphrase === undefined) {
    throw new AppError("server.credential_unusable", { ...ref, field: "passphrase" });
  }
  return { pfx: Buffer.from(pfxBase64, "base64"), passphrase, certKind: certKind as CertKind };
}

export async function readCertMaterial(
  db: Database,
  ring: KeyRing,
  tenantId: TenantId,
): Promise<CertMaterial> {
  const payload = await readCredential(db, ring, tenantId, "fiscal.aeat");
  return certMaterialFrom(payload, { tenantId, purpose: "fiscal.aeat" });
}

/**
 * A sello de entidad certificate submits to a DIFFERENT HOST — `www10`/`prewww10` rather than
 * `www1`/`prewww1`. That is why the certificate's kind is provisioned data and not something this
 * host could infer without reading X.509 policy OIDs.
 */
export function aeatEndpointFor(aeatEnv: AeatEnvironment): (certKind: CertKind) => string {
  return (certKind) =>
    certKind === "sello" ? SOAP_ENDPOINTS_SELLO[aeatEnv] : SOAP_ENDPOINTS[aeatEnv];
}

/**
 * A `fetch` carrying this tenant's client certificate. `packages/verifactu` injects `fetch` for
 * exactly this reason — mTLS configuration is a deployment concern and the library keeps none of it.
 *
 * `ca` is for a private trust root: the test's own CA, and any deployment that terminates through
 * one. Omitted, Node's default store applies.
 */
export function mtlsFetch(material: CertMaterial, ca?: string): typeof globalThis.fetch {
  const dispatcher = new Agent({
    connect: {
      pfx: material.pfx,
      passphrase: material.passphrase,
      ...(ca === undefined ? {} : { ca }),
    },
  });
  return ((input, init) =>
    undiciFetch(input as string, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1]) as
      unknown as Promise<Response>) as typeof globalThis.fetch;
}

export interface TransportDeps {
  db: Database;
  ring: KeyRing;
  endpointFor: (certKind: CertKind) => string;
  fetchFor: (material: CertMaterial) => typeof globalThis.fetch;
}

/**
 * `DrainDeps.resolveClient`, wired to the vault. One client per tenant per pass, built only for
 * tenants the sweep actually has work for.
 */
export function aeatClientResolver(
  deps: TransportDeps,
): (tenantId: TenantId) => Promise<VerifactuClient> {
  return async (tenantId) => {
    const material = await readCertMaterial(deps.db, deps.ring, tenantId);
    return createClient({
      endpoint: deps.endpointFor(material.certKind),
      fetch: deps.fetchFor(material),
    });
  };
}
```

- [ ] **Step 6: Add `test/seed.ts`**

`apps/server/test/seed.ts` — copy `packages/scheduler/test/seed.ts` verbatim, including its comment about NIF collisions. Task 12 records this as the repo's sixth copy and why it is not yet shared.

- [ ] **Step 7: Run the tests**

```bash
pnpm --filter @waitron/server test src/aeat-transport.test.ts
```

Expected: PASS, including `sawClientCn()` matching — the handshake completed with our certificate.

- [ ] **Step 8: Verify the handshake test can fail**

Temporarily change `mtlsFetch` to omit `pfx` from `connect`. Re-run: the first handshake test must FAIL. Restore it. Without this step the suite proves only that a request was made.

- [ ] **Step 9: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): build each tenant's AEAT transport from vaulted PKCS#12 material"
```

---

### Task 5: The Stripe account resolver

Implements the `stripe` half of spec §6.

**Files:**

- Create: `apps/server/src/stripe-account.ts`
- Test: `apps/server/src/stripe-account.test.ts`

**Interfaces:**

- Consumes: `readCredential` (Task 4).
- Produces:
  - `interface StripeAccountDeps { db: Database; ring: KeyRing; makeStripe: (secretKey: string) => Stripe }`
  - `function stripeAccountResolver(deps: StripeAccountDeps): (tenantId: TenantId) => Promise<StripeReconcileAccount>`
  - `function defaultMakeStripe(secretKey: string): Stripe`

- [ ] **Step 1: Write the failing test**

`apps/server/src/stripe-account.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { CORE_MIGRATIONS, captureError, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import type { KeyRing } from "@waitron/credentials";
import { isAppError } from "@waitron/shared";
import { stripeAccountResolver } from "./stripe-account.js";
import { seedTenant } from "../test/seed.js";

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

let db: Database;
let ring: KeyRing;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
  ring = loadKeyRing(KEY_ENV);
}, 60_000);

afterAll(async () => {
  if (db !== undefined) await db.close();
});

describe("stripeAccountResolver", () => {
  it("builds the account from the tenant's own secret key", async () => {
    const tenantId = await seedTenant(db);
    await withTenant(db, tenantId, (tx) =>
      putCredential(tx, ring, {
        tenantId,
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_tenant_one",
          webhookSecret: "whsec_x",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );

    const keys: string[] = [];
    const resolve = stripeAccountResolver({
      db,
      ring,
      makeStripe: (secretKey) => {
        keys.push(secretKey);
        return {} as Stripe;
      },
    });

    const account = await resolve(tenantId);
    // The KEY is the tenant scoping: a Stripe account is standalone (one per merchant, no Connect),
    // so building the client from the wrong tenant's key settles real money against the wrong
    // merchant with no error anywhere.
    expect(keys).toEqual(["sk_test_tenant_one"]);
    expect(typeof account.report.listSettlements).toBe("function");
    expect(typeof account.refund.refund).toBe("function");
  });

  it("surfaces the vault's own code when the tenant has no Stripe credential", async () => {
    const tenantId = await seedTenant(db);
    const resolve = stripeAccountResolver({ db, ring, makeStripe: () => ({}) as Stripe });
    const error = await captureError(() => resolve(tenantId));
    expect(isAppError(error) && error.code).toBe("credentials.missing");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/server test src/stripe-account.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `stripe-account.ts`**

```typescript
import Stripe from "stripe";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";
import { stripeClient, stripeReportClient } from "@waitron/payments-stripe";
import type { StripeReconcileAccount } from "@waitron/payments-stripe";
import { readCredential } from "./credentials.js";

export interface StripeAccountDeps {
  db: Database;
  ring: KeyRing;
  /** Injected so a test never constructs a real SDK client, and so the KEY this host passes is
   * observable — which is the whole of the tenant scoping on this path. */
  makeStripe: (secretKey: string) => Stripe;
}

export function defaultMakeStripe(secretKey: string): Stripe {
  return new Stripe(secretKey);
}

/**
 * `StripeReconcilerOptions.resolveAccount`, wired to the vault. One reconciler is built for the
 * whole settlement identity and swept across tenants, so the resolved ACCOUNT is what scopes each
 * sweep — the accounts are standalone, one per merchant, with no Connect layer to carry the scope.
 *
 * `report` and `refund` are two views of one SDK client: the audit lists balance transactions, and
 * a claimed orphan's reversal issues a refund.
 */
export function stripeAccountResolver(
  deps: StripeAccountDeps,
): (tenantId: TenantId) => Promise<StripeReconcileAccount> {
  return async (tenantId) => {
    const payload = await readCredential(deps.db, deps.ring, tenantId, "payments.stripe");
    // `getCredential` already guarantees every field PURPOSES declares is a non-empty string —
    // `validatePayload` enforced it at provisioning time, and unlike `certKind` (added later, so
    // older rows can lack it) `secretKey` has been declared since the purpose existed.
    const stripe = deps.makeStripe(payload.secretKey!);
    return { report: stripeReportClient(stripe), refund: stripeClient(stripe) };
  };
}
```

If `payload.secretKey!` trips `no-non-null-assertion`, read it through the same `certMaterialFrom`-style guard instead and throw `server.credential_unusable` with `field: "secretKey"`; do not silence the rule.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @waitron/server test src/stripe-account.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): resolve each tenant's Stripe reconcile account from the vault"
```

---

### Task 6: The reconcile duty adapter moves to its owner

Implements spec §7's duty list and the scheduler design §8's *"the adapter … belongs to the host"*.

**Files:**

- Create: `apps/server/src/reconcile-duty.ts`
- Test: `apps/server/src/reconcile-duty.test.ts`
- Delete: `packages/scheduler/src/payments-fit.test.ts` (its purpose was to prove the seam before a host existed; the host now is the proof — see Step 3)

**Interfaces:**

- Produces: `function reconcilerAsDuty(reconciler: PaymentReconciler): PeriodDuty`

- [ ] **Step 1: Copy the adapter and its tests across**

Create `apps/server/src/reconcile-duty.ts` with the `reconcilerAsDuty`, `gatedDriftOrphan` and `summaryOf` functions **exactly as they stand** in `packages/scheduler/src/payments-fit.test.ts`, including every comment — the `resweepAfter` predicate's "superset of the strictly-gated set" reasoning is the load-bearing part and must not be paraphrased. Export only `reconcilerAsDuty`.

Create `apps/server/src/reconcile-duty.test.ts` with that file's four `it` blocks and their fixtures, importing `reconcilerAsDuty` from `./reconcile-duty.js`.

- [ ] **Step 2: Run the new tests**

```bash
pnpm --filter @waitron/server test src/reconcile-duty.test.ts
```

Expected: PASS — four tests.

- [ ] **Step 3: Delete `packages/scheduler/src/payments-fit.test.ts`**

```bash
git rm packages/scheduler/src/payments-fit.test.ts
```

The file existed to prove the seam fits **before a host existed** — that was its whole stated purpose (*"written here to PROVE the seam fits rather than assert it"*). Now `apps/server/src/reconcile-duty.ts` imports `PaymentReconciler` and `PeriodDuty` together on the runtime path, so it **is** the compile-time proof, and a shape change on either side fails `pnpm --filter @waitron/server typecheck` — where the coupling actually lives.

Keeping a reduced version would leave a test whose only runtime assertion is a tautology (`expect(typeof run).toBe("function")`), which is a test that asserts nothing. Deleting it is not a loss of coverage: the four behavioural assertions move to `apps/server/src/reconcile-duty.test.ts` in Step 1, and `packages/scheduler` keeps its own `run.test.ts` import of `@waitron/payments` for the `AppError` code augmentation, so the dev dependency stays justified.

Check nothing else referenced it:

```bash
grep -rn "payments-fit" packages/ apps/ docs/ || echo "no remaining references"
```

If `packages/scheduler`'s coverage config or `package.json` names the file, remove that reference too.

- [ ] **Step 4: Run both suites**

```bash
pnpm --filter @waitron/scheduler test && pnpm --filter @waitron/server test
```

Expected: PASS on both.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server packages/scheduler
git commit -m "feat(server): own the PaymentReconciler-to-PeriodDuty adapter"
```

---

### Task 7: One pass — drain first, failures contained, `nextDueAt` folded

Implements spec §7 and §8's in-loop half.

**Files:**

- Create: `apps/server/src/pass.ts`
- Test: `apps/server/src/pass.test.ts`

**Interfaces:**

- Consumes: `Logger` (Task 1).
- Produces:
  - `const DRAIN_DUTY = "fiscal.drain"`, `const RECONCILE_DUTY = "payments.reconcile.stripe"`
  - `interface DutyReport { duty: string; ok: boolean; errorCode?: string; nextDueAt: Date | null }`
  - `interface PassReport { duties: DutyReport[]; nextDueAt: Date | null }`
  - `interface PassDeps { drain: (now: Date) => Promise<DrainResult>; reconcile: (now: Date) => Promise<TickResult>; log: Logger }`
  - `function runPass(deps: PassDeps, now: Date): Promise<PassReport>`

- [ ] **Step 1: Write the failing tests**

`apps/server/src/pass.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { DrainResult } from "@waitron/fiscal";
import type { TickResult } from "@waitron/scheduler";
import { DRAIN_DUTY, RECONCILE_DUTY, runPass, type PassDeps } from "./pass.js";

const NOW = new Date("2026-07-26T09:00:00Z");
const SOON = new Date("2026-07-26T09:10:00Z");
const LATER = new Date("2026-07-26T23:00:00Z");

function drainResult(over: Partial<DrainResult> = {}): DrainResult {
  return {
    nextDueAt: null,
    batchesSent: 0,
    recordsSubmitted: 0,
    recordsAccepted: 0,
    recordsHalted: 0,
    incidentsRaised: 0,
    skipped: [],
    ...over,
  };
}

function tickResult(over: Partial<TickResult> = {}): TickResult {
  return { ran: [], deferred: 0, beyondHorizon: 0, skipped: [], nextDueAt: null, ...over };
}

function deps(over: Partial<PassDeps> = {}): PassDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    drain: () => Promise.resolve(drainResult()),
    reconcile: () => Promise.resolve(tickResult()),
    log: (level, event, fields) => lines.push(`${level} ${event} ${JSON.stringify(fields ?? {})}`),
    ...over,
  };
}

describe("runPass", () => {
  it("runs drain before reconcile, always", async () => {
    const order: string[] = [];
    const d = deps({
      drain: () => {
        order.push("drain");
        return Promise.resolve(drainResult());
      },
      reconcile: () => {
        order.push("reconcile");
        return Promise.resolve(tickResult());
      },
    });
    await runPass(d, NOW);
    // Not an aesthetic preference: drain is the duty with a legal clock, so a reconcile sweep that
    // is behind must never delay it.
    expect(order).toEqual(["drain", "reconcile"]);
  });

  it("folds the minimum of the non-null answers", async () => {
    const d = deps({
      drain: () => Promise.resolve(drainResult({ nextDueAt: SOON })),
      reconcile: () => Promise.resolve(tickResult({ nextDueAt: LATER })),
    });
    expect((await runPass(d, NOW)).nextDueAt).toEqual(SOON);
  });

  it("ignores a null rather than letting it win the comparison", async () => {
    // A null means "no work exists at all" — not a time. Treating it as one would sleep the whole
    // MAX_TICK while drain had a batch due in ten minutes.
    const d = deps({
      drain: () => Promise.resolve(drainResult({ nextDueAt: SOON })),
      reconcile: () => Promise.resolve(tickResult({ nextDueAt: null })),
    });
    expect((await runPass(d, NOW)).nextDueAt).toEqual(SOON);
  });

  it("reports null only when neither duty has any work", async () => {
    expect((await runPass(deps(), NOW)).nextDueAt).toBeNull();
  });

  it("contains a throwing duty, still runs the other, and records the code", async () => {
    const d = deps({
      drain: () => Promise.reject(new AppError("server.credential_unusable", {
        tenantId: "t", purpose: "fiscal.aeat", field: "certKind",
      })),
      reconcile: () => Promise.resolve(tickResult({ nextDueAt: LATER })),
    });
    const report = await runPass(d, NOW);

    // The loop must survive a duty that throws: one transient database blip ending the hourly retry
    // is precisely the failure the scheduler's nextDueAt semantics were written to prevent.
    const drainReport = report.duties.find((entry) => entry.duty === DRAIN_DUTY)!;
    expect(drainReport).toEqual({
      duty: DRAIN_DUTY,
      ok: false,
      errorCode: "server.credential_unusable",
      // A duty that threw has no answer about when it is next due, and a failed drain is due
      // immediately — the pass reports `now` so the loop retries on its floor rather than sleeping.
      nextDueAt: NOW,
    });
    expect(report.duties.find((entry) => entry.duty === RECONCILE_DUTY)?.ok).toBe(true);
    expect(report.nextDueAt).toEqual(NOW);
  });

  it("codes an unstructured throw as unknown", async () => {
    const d = deps({ drain: () => Promise.reject(new Error("socket hang up")) });
    const report = await runPass(d, NOW);
    expect(report.duties[0]?.errorCode).toBe("unknown");
  });

  it("logs drain's skipped tenants at warn, because an unsubmittable tenant is never silent", async () => {
    const d = deps({
      drain: () =>
        Promise.resolve(
          drainResult({ skipped: [{ tenantId: "t-1", errorCode: "credentials.missing" }] }),
        ),
    });
    await runPass(d, NOW);
    expect(d.lines.some((line) => line.startsWith("warn drain.tenant_skipped"))).toBe(true);
    expect(d.lines.some((line) => line.includes("credentials.missing"))).toBe(true);
  });

  it("logs runDue's skipped pairs and its deferred count", async () => {
    const d = deps({
      reconcile: () =>
        Promise.resolve(
          tickResult({
            deferred: 4,
            beyondHorizon: 2,
            skipped: [{ tenantId: "t-2", duty: RECONCILE_DUTY, errorCode: "unknown" }],
          }),
        ),
    });
    await runPass(d, NOW);
    expect(d.lines.some((line) => line.startsWith("warn reconcile.pair_skipped"))).toBe(true);
    expect(d.lines.some((line) => line.includes('"deferred":4'))).toBe(true);
    expect(d.lines.some((line) => line.includes('"beyondHorizon":2'))).toBe(true);
  });

  it("emits exactly one pass.complete line carrying both summaries", async () => {
    const d = deps();
    await runPass(d, NOW);
    expect(d.lines.filter((line) => line.startsWith("info pass.complete"))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/server test src/pass.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `pass.ts`**

```typescript
import { isAppError } from "@waitron/shared";
import type { DrainResult } from "@waitron/fiscal";
import type { TickResult } from "@waitron/scheduler";
import type { Logger } from "./logger.js";

/** This host's own label for the fiscal drainer. It has no `scheduled_runs` name because it is not
 * a ledger duty — see the scheduler design's amendment for why it cannot be one. */
export const DRAIN_DUTY = "fiscal.drain";
/** The ledger duty name, matching what `reconcilerAsDuty` writes into `scheduled_runs.duty`. */
export const RECONCILE_DUTY = "payments.reconcile.stripe";

export interface DutyReport {
  duty: string;
  ok: boolean;
  errorCode?: string;
  nextDueAt: Date | null;
}

export interface PassReport {
  duties: DutyReport[];
  /** The earliest time either duty says work next appears — the minimum of the NON-NULL answers. */
  nextDueAt: Date | null;
}

export interface PassDeps {
  drain: (now: Date) => Promise<DrainResult>;
  reconcile: (now: Date) => Promise<TickResult>;
  log: Logger;
}

/** A structured code, never prose — the same convention `runDue`'s own `codeOf` uses. */
function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : "unknown";
}

export async function runPass(deps: PassDeps, now: Date): Promise<PassReport> {
  const duties: DutyReport[] = [];

  // DRAIN FIRST, unconditionally. It is the duty with a legal clock.
  duties.push(
    await attempt(DRAIN_DUTY, now, deps.log, async () => {
      const result = await deps.drain(now);
      for (const skipped of result.skipped) {
        // A tenant with due fiscal work this pass could not submit for is an unmet legal
        // obligation. It has no ledger row and no incident (`incidents.till_id` is NOT NULL and a
        // drain has no till), so this line is the only place it exists.
        deps.log("warn", "drain.tenant_skipped", skipped);
      }
      deps.log("info", "drain.complete", {
        batchesSent: result.batchesSent,
        recordsSubmitted: result.recordsSubmitted,
        recordsAccepted: result.recordsAccepted,
        recordsHalted: result.recordsHalted,
        incidentsRaised: result.incidentsRaised,
        skipped: result.skipped.length,
        nextDueAt: result.nextDueAt?.toISOString() ?? null,
      });
      return result.nextDueAt;
    }),
  );

  duties.push(
    await attempt(RECONCILE_DUTY, now, deps.log, async () => {
      const result = await deps.reconcile(now);
      for (const skipped of result.skipped) {
        deps.log("warn", "reconcile.pair_skipped", skipped);
      }
      deps.log("info", "reconcile.complete", {
        ran: result.ran.length,
        deferred: result.deferred,
        beyondHorizon: result.beyondHorizon,
        skipped: result.skipped.length,
        nextDueAt: result.nextDueAt?.toISOString() ?? null,
      });
      return result.nextDueAt;
    }),
  );

  const nextDueAt = earliest(duties.map((entry) => entry.nextDueAt));
  deps.log("info", "pass.complete", {
    duties: duties.map((entry) => ({
      duty: entry.duty,
      ok: entry.ok,
      ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
    })),
    nextDueAt: nextDueAt?.toISOString() ?? null,
  });
  return { duties, nextDueAt };
}

/**
 * Runs one duty and NEVER rethrows. A duty that fails forever must be visible, not fatal: letting
 * the throw out would end art. 16.4's hourly retry on one transient blip.
 *
 * A failure reports `now` as its next due time. It has no answer of its own — whatever it was going
 * to say died with the throw — and "due immediately" is the honest reading, which the loop's
 * MIN_TICK floor then turns into a prompt retry rather than a hot spin.
 */
async function attempt(
  duty: string,
  now: Date,
  log: Logger,
  body: () => Promise<Date | null>,
): Promise<DutyReport> {
  try {
    return { duty, ok: true, nextDueAt: await body() };
  } catch (error) {
    const errorCode = codeOf(error);
    log("error", "duty.failed", { duty, errorCode });
    return { duty, ok: false, errorCode, nextDueAt: now };
  }
}

function earliest(times: readonly (Date | null)[]): Date | null {
  const known = times.filter((time): time is Date => time !== null);
  if (known.length === 0) return null;
  return new Date(Math.min(...known.map((time) => time.getTime())));
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @waitron/server test src/pass.test.ts
```

Expected: PASS — nine tests.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): one pass — drain first, failures contained, nextDueAt folded"
```

---

### Task 8: The loop — sleep until due, clamped, and shut down cleanly

Implements spec §3.1, §7's clamps and §8's SIGTERM half.

**Files:**

- Create: `apps/server/src/loop.ts`
- Test: `apps/server/src/loop.test.ts`

**Interfaces:**

- Consumes: `PassReport` (Task 7), `Logger` (Task 1).
- Produces:
  - `function sleepMsFor(nextDueAt: Date | null, now: Date, minTickMs: number, maxTickMs: number): number`
  - `interface LoopDeps { pass: (now: Date) => Promise<PassReport>; now: () => Date; sleep: (ms: number, signal: AbortSignal) => Promise<void>; signal: AbortSignal; minTickMs: number; maxTickMs: number; log: Logger; onPass?: (report: PassReport, at: Date) => void }`
  - `function runLoop(deps: LoopDeps): Promise<void>`
  - `function realSleep(ms: number, signal: AbortSignal): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`apps/server/src/loop.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { PassReport } from "./pass.js";
import { runLoop, sleepMsFor, type LoopDeps } from "./loop.js";

const NOW = new Date("2026-07-26T09:00:00Z");
const MIN = 5_000;
const MAX = 3_600_000;

function report(nextDueAt: Date | null): PassReport {
  return { duties: [{ duty: "fiscal.drain", ok: true, nextDueAt }], nextDueAt };
}

describe("sleepMsFor", () => {
  it("sleeps until the due time when it lies inside the clamps", () => {
    expect(sleepMsFor(new Date("2026-07-26T09:10:00Z"), NOW, MIN, MAX)).toBe(600_000);
  });

  it("never sleeps longer than the max, however distant the due time", () => {
    // A liveness floor, not a tuning knob: drain's hourly duty must not be lengthened by a quiet
    // ledger, nor by a nextDueAt computed before a till wrote a sale.
    expect(sleepMsFor(new Date("2026-08-01T00:00:00Z"), NOW, MIN, MAX)).toBe(MAX);
  });

  it("never sleeps less than the min, even for work due now or overdue", () => {
    expect(sleepMsFor(NOW, NOW, MIN, MAX)).toBe(MIN);
    expect(sleepMsFor(new Date("2026-07-26T08:00:00Z"), NOW, MIN, MAX)).toBe(MIN);
  });

  it("sleeps the max when there is no work anywhere", () => {
    expect(sleepMsFor(null, NOW, MIN, MAX)).toBe(MAX);
  });
});

describe("runLoop", () => {
  function harness(over: Partial<LoopDeps> = {}) {
    const controller = new AbortController();
    const slept: number[] = [];
    const lines: string[] = [];
    const passes: Date[] = [];
    const deps: LoopDeps = {
      pass: (at) => {
        passes.push(at);
        return Promise.resolve(report(null));
      },
      now: () => NOW,
      sleep: (ms) => {
        slept.push(ms);
        // Three passes is enough to show the loop loops; the fourth sleep stops it.
        if (slept.length >= 3) controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: MAX,
      log: (level, event) => lines.push(`${level} ${event}`),
      ...over,
    };
    return { deps, controller, slept, lines, passes };
  }

  it("passes repeatedly, sleeping the clamped interval between", async () => {
    const h = harness();
    await runLoop(h.deps);
    expect(h.passes).toHaveLength(3);
    expect(h.slept).toEqual([MAX, MAX, MAX]);
  });

  it("returns without passing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness({ signal: controller.signal });
    await runLoop({ ...h.deps, signal: controller.signal });
    expect(h.passes).toEqual([]);
  });

  it("finishes the pass in flight when the signal aborts mid-pass, then stops", async () => {
    const controller = new AbortController();
    let finished = false;
    const h = harness({ signal: controller.signal });
    await runLoop({
      ...h.deps,
      signal: controller.signal,
      pass: async () => {
        controller.abort();
        await Promise.resolve();
        finished = true;
        return report(null);
      },
    });
    // Politeness, not correctness — the duties are already crash-safe — but it must not become a
    // reason to abandon a partially-submitted batch.
    expect(finished).toBe(true);
    expect(h.slept).toEqual([]);
  });

  it("keeps looping when a pass itself throws", async () => {
    // runPass contains its own duties' failures, so a throw HERE is something unforeseen — a bug in
    // the pass, or an OOM in a log sink. The loop still must not die: a process that exits on the
    // unforeseen breaches the hourly duty in exactly the case nobody predicted.
    const controller = new AbortController();
    const slept: number[] = [];
    let calls = 0;
    const lines: string[] = [];
    await runLoop({
      pass: () => {
        calls += 1;
        return Promise.reject(new Error("unforeseen"));
      },
      now: () => NOW,
      sleep: (ms) => {
        slept.push(ms);
        if (slept.length >= 2) controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
      minTickMs: MIN,
      maxTickMs: MAX,
      log: (level, event) => lines.push(`${level} ${event}`),
    });
    expect(calls).toBe(2);
    // Retried on the floor, not the ceiling: an unexplained pass failure is due now.
    expect(slept).toEqual([MIN, MIN]);
    expect(lines).toContain("error pass.threw");
  });

  it("hands each report to onPass so health state can follow it", async () => {
    const seen: PassReport[] = [];
    const h = harness({ onPass: (r) => seen.push(r) });
    await runLoop({ ...h.deps, onPass: (r) => seen.push(r) });
    expect(seen).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/server test src/loop.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `loop.ts`**

```typescript
import { setTimeout as delay } from "node:timers/promises";
import type { PassReport } from "./pass.js";
import type { Logger } from "./logger.js";

/**
 * How long to sleep before the next pass.
 *
 * `null` means no work exists anywhere, which sleeps the ceiling rather than forever: the ledger can
 * gain work from outside this process at any moment (a till writing a sale, an operator provisioning
 * a tenant), so "nothing is due" is a fact with a shelf life.
 */
export function sleepMsFor(
  nextDueAt: Date | null,
  now: Date,
  minTickMs: number,
  maxTickMs: number,
): number {
  if (nextDueAt === null) return maxTickMs;
  const wait = nextDueAt.getTime() - now.getTime();
  return Math.min(maxTickMs, Math.max(minTickMs, wait));
}

export interface LoopDeps {
  pass: (now: Date) => Promise<PassReport>;
  now: () => Date;
  /** Injected so the suite asserts durations instead of waiting them out. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  minTickMs: number;
  maxTickMs: number;
  log: Logger;
  onPass?: (report: PassReport, at: Date) => void;
}

/** Real sleep, interruptible by the shutdown signal so SIGTERM does not wait out an hour. */
export async function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    // An abort is the expected way out of a long sleep, not a failure.
  }
}

export async function runLoop(deps: LoopDeps): Promise<void> {
  while (!deps.signal.aborted) {
    const startedAt = deps.now();
    let nextDueAt: Date | null;
    try {
      const report = await deps.pass(startedAt);
      deps.onPass?.(report, startedAt);
      nextDueAt = report.nextDueAt;
    } catch (error) {
      // `runPass` contains each duty's own failure, so reaching here means something unforeseen.
      // Exiting would breach the hourly duty in precisely the case nobody predicted, so the loop
      // logs and retries on its floor.
      deps.log("error", "pass.threw", { message: error instanceof Error ? error.message : "unknown" });
      nextDueAt = startedAt;
    }
    // Checked AFTER the pass: a signal arriving mid-pass lets the pass finish (the duties are
    // crash-safe, but a clean finish still beats abandoning a partially-submitted batch) and skips
    // the sleep entirely.
    if (deps.signal.aborted) break;
    const sleepMs = sleepMsFor(nextDueAt, deps.now(), deps.minTickMs, deps.maxTickMs);
    deps.log("info", "loop.sleeping", { sleepMs });
    await deps.sleep(sleepMs, deps.signal);
  }
  deps.log("info", "loop.stopped");
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @waitron/server test src/loop.test.ts
```

Expected: PASS — ten tests.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): the pass loop — sleep until due, clamped, interruptible"
```

---

### Task 9: Health — the one route, and what makes it 503

Implements spec §9.

**Files:**

- Create: `apps/server/src/health.ts`
- Test: `apps/server/src/health.test.ts`

**Interfaces:**

- Consumes: `PassReport`, `DRAIN_DUTY`, `RECONCILE_DUTY` (Task 7).
- Produces:
  - `const DUTY_BUDGET_MS: Readonly<Record<string, number>>`
  - `interface HealthState { startedAt: Date; lastPassAt: Date | null; duties: Record<string, { lastOkAt: Date | null; consecutiveFailures: number }> }`
  - `function createHealthState(startedAt: Date): HealthState`
  - `function recordPass(state: HealthState, report: PassReport, at: Date): void`
  - `function healthSnapshot(state: HealthState, now: Date): { ok: boolean; body: Record<string, unknown> }`
  - `function healthApp(state: HealthState, now: () => Date): Hono`

- [ ] **Step 1: Write the failing tests**

`apps/server/src/health.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DRAIN_DUTY, RECONCILE_DUTY, type PassReport } from "./pass.js";
import { createHealthState, healthApp, healthSnapshot, recordPass } from "./health.js";

const BOOT = new Date("2026-07-26T08:00:00Z");
const AT = new Date("2026-07-26T08:00:05Z");

function report(drainOk: boolean, reconcileOk = true): PassReport {
  return {
    duties: [
      { duty: DRAIN_DUTY, ok: drainOk, nextDueAt: null, ...(drainOk ? {} : { errorCode: "x" }) },
      { duty: RECONCILE_DUTY, ok: reconcileOk, nextDueAt: null },
    ],
    nextDueAt: null,
  };
}

describe("health state", () => {
  it("starts unhealthy, because a host that has never passed has never submitted", () => {
    const state = createHealthState(BOOT);
    const snap = healthSnapshot(state, AT);
    expect(snap.ok).toBe(false);
    expect(snap.body).toMatchObject({ ok: false, lastPassAt: null });
  });

  it("is healthy after a clean pass", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    expect(healthSnapshot(state, AT).ok).toBe(true);
  });

  it("counts consecutive failures and resets them on success", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(false), AT);
    recordPass(state, report(false), AT);
    expect(state.duties[DRAIN_DUTY]?.consecutiveFailures).toBe(2);
    recordPass(state, report(true), AT);
    expect(state.duties[DRAIN_DUTY]?.consecutiveFailures).toBe(0);
    expect(state.duties[DRAIN_DUTY]?.lastOkAt).toEqual(AT);
  });

  it("goes 503 when drain's last success is older than an hour", () => {
    // Drain's budget IS the legal cadence. Up-but-stale is the failure mode this endpoint exists to
    // make visible, and it looks identical to healthy in a log.
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    expect(healthSnapshot(state, new Date("2026-07-26T08:59:00Z")).ok).toBe(true);
    expect(healthSnapshot(state, new Date("2026-07-26T09:01:00Z")).ok).toBe(false);
  });

  it("gives reconcile a daily-plus-slack budget, not drain's hourly one", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    const within = new Date(AT.getTime() + 25 * 60 * 60 * 1000);
    const beyond = new Date(AT.getTime() + 27 * 60 * 60 * 1000);
    // Drain is stale at both, so isolate reconcile by reading its own entry.
    expect(healthSnapshot(state, within).body).toMatchObject({
      duties: { [RECONCILE_DUTY]: { stale: false } },
    });
    expect(healthSnapshot(state, beyond).body).toMatchObject({
      duties: { [RECONCILE_DUTY]: { stale: true } },
    });
  });

  it("serialises dates as ISO strings and nothing else", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    expect(healthSnapshot(state, AT).body).toEqual({
      ok: true,
      startedAt: "2026-07-26T08:00:00.000Z",
      lastPassAt: "2026-07-26T08:00:05.000Z",
      duties: {
        [DRAIN_DUTY]: { lastOkAt: "2026-07-26T08:00:05.000Z", consecutiveFailures: 0, stale: false },
        [RECONCILE_DUTY]: {
          lastOkAt: "2026-07-26T08:00:05.000Z",
          consecutiveFailures: 0,
          stale: false,
        },
      },
    });
  });
});

describe("healthApp", () => {
  it("answers 200 when healthy and 503 when not", async () => {
    const state = createHealthState(BOOT);
    const app = healthApp(state, () => AT);

    const before = await app.request("/health");
    expect(before.status).toBe(503);

    recordPass(state, report(true), AT);
    const after = await app.request("/health");
    expect(after.status).toBe(200);
    expect(((await after.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("serves nothing else", async () => {
    const app = healthApp(createHealthState(BOOT), () => AT);
    expect((await app.request("/")).status).toBe(404);
    expect((await app.request("/metrics")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @waitron/server test src/health.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `health.ts`**

```typescript
import { Hono } from "hono";
import { DRAIN_DUTY, RECONCILE_DUTY, type PassReport } from "./pass.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long each duty may go without a success before this host calls itself unhealthy.
 *
 * `fiscal.drain`'s budget IS art. 16.4's cadence — an hour, not a round number chosen for comfort.
 * Reconcile's is a daily period plus slack: a sweep that ran 25 hours ago has not yet missed
 * anything, and a 26-hour bound catches a genuinely stopped sweep without alarming on a long tick.
 */
export const DUTY_BUDGET_MS: Readonly<Record<string, number>> = {
  [DRAIN_DUTY]: HOUR_MS,
  [RECONCILE_DUTY]: 26 * HOUR_MS,
};

export interface DutyHealth {
  lastOkAt: Date | null;
  consecutiveFailures: number;
}

export interface HealthState {
  startedAt: Date;
  lastPassAt: Date | null;
  duties: Record<string, DutyHealth>;
}

/**
 * Every duty starts with `lastOkAt: null`, which reads as stale — so a host that has booted and not
 * yet passed reports 503. That is deliberate: a process that has never submitted is not healthy
 * merely because it is young, and a supervisor that treats "up" as "working" would never learn.
 */
export function createHealthState(startedAt: Date): HealthState {
  const duties: Record<string, DutyHealth> = {};
  for (const duty of Object.keys(DUTY_BUDGET_MS)) {
    duties[duty] = { lastOkAt: null, consecutiveFailures: 0 };
  }
  return { startedAt, lastPassAt: null, duties };
}

export function recordPass(state: HealthState, report: PassReport, at: Date): void {
  state.lastPassAt = at;
  for (const entry of report.duties) {
    const duty = (state.duties[entry.duty] ??= { lastOkAt: null, consecutiveFailures: 0 });
    if (entry.ok) {
      duty.lastOkAt = at;
      duty.consecutiveFailures = 0;
    } else {
      duty.consecutiveFailures += 1;
    }
  }
}

function isStale(duty: DutyHealth, budgetMs: number | undefined, now: Date): boolean {
  if (duty.lastOkAt === null) return true;
  // A duty with no declared budget cannot be stale — it is one this host does not pace.
  if (budgetMs === undefined) return false;
  return now.getTime() - duty.lastOkAt.getTime() > budgetMs;
}

export function healthSnapshot(
  state: HealthState,
  now: Date,
): { ok: boolean; body: Record<string, unknown> } {
  const duties: Record<string, unknown> = {};
  let ok = state.lastPassAt !== null;
  for (const [name, duty] of Object.entries(state.duties)) {
    const stale = isStale(duty, DUTY_BUDGET_MS[name], now);
    if (stale) ok = false;
    duties[name] = {
      lastOkAt: duty.lastOkAt?.toISOString() ?? null,
      consecutiveFailures: duty.consecutiveFailures,
      stale,
    };
  }
  return {
    ok,
    body: {
      ok,
      startedAt: state.startedAt.toISOString(),
      lastPassAt: state.lastPassAt?.toISOString() ?? null,
      duties,
    },
  };
}

/** The ONLY route this cycle: no metrics, no readiness/liveness split, no auth, no webhook. The
 * webhook cycle attaches to this app rather than creating a second one. */
export function healthApp(state: HealthState, now: () => Date): Hono {
  const app = new Hono();
  app.get("/health", (c) => {
    const snapshot = healthSnapshot(state, now());
    return c.json(snapshot.body, snapshot.ok ? 200 : 503);
  });
  return app;
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @waitron/server test src/health.test.ts
```

Expected: PASS — eight tests.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): the /health route and its per-duty staleness budgets"
```

---

### Task 10: Migrations at boot, behind an advisory lock, resolvable from a bundle

Implements spec §11.

**Files:**

- Create: `apps/server/migrations.manifest.json`, `apps/server/scripts/copy-migrations.mjs`
- Create: `apps/server/src/migrations.ts`
- Test: `apps/server/src/migrations.test.ts`, `apps/server/src/migrations.concurrency.test.ts`

**Interfaces:**

- Consumes: `server.migrations_missing` (Task 1).
- Produces:
  - `interface MigrationSet { name: string; table: string; from: string }`
  - `function manifestSets(): MigrationSet[]`
  - `function migrationOptionsFor(sets: readonly MigrationSet[], root: string | null): MigrationOptions[]`
  - `function applyMigrations(connectionString: string, db: Database, options: readonly MigrationOptions[]): Promise<void>`

- [ ] **Step 1: Write the manifest**

`apps/server/migrations.manifest.json` — one source of truth for both the runtime resolver and the build's copy step. `from` is relative to `apps/server`:

```json
[
  { "name": "core", "table": "__drizzle_migrations_db", "from": "../../packages/db/drizzle" },
  {
    "name": "fiscal",
    "table": "__drizzle_migrations_fiscal",
    "from": "../../packages/fiscal-verifactu/drizzle"
  },
  {
    "name": "payments",
    "table": "__drizzle_migrations_payments",
    "from": "../../packages/payments/drizzle"
  },
  {
    "name": "scheduler",
    "table": "__drizzle_migrations_scheduler",
    "from": "../../packages/scheduler/drizzle"
  },
  {
    "name": "credentials",
    "table": "__drizzle_migrations_credentials",
    "from": "../../packages/credentials/drizzle"
  }
]
```

**Verify every `table` value against the package's own exported descriptor before moving on** — read each `packages/*/src/migrations.ts` (and `packages/db/src/index.ts`) and copy the `migrationsTable` string exactly. Step 4's test pins them, so a guess fails there rather than in production, but check anyway.

- [ ] **Step 2: Write the failing tests**

`apps/server/src/migrations.test.ts`:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureError, CORE_MIGRATIONS } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "@waitron/fiscal-verifactu";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { SCHEDULER_MIGRATIONS } from "@waitron/scheduler";
import { CREDENTIALS_MIGRATIONS } from "@waitron/credentials";
import { isAppError } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "./migrations.js";

describe("the migration manifest", () => {
  it("names the same journal tables the packages themselves declare", () => {
    // The manifest exists because every *_MIGRATIONS descriptor computes migrationsFolder from its
    // OWN import.meta.url, which collapses onto the bundle's directory under esbuild. Taking the
    // FOLDER from the manifest means the TABLE could silently drift from the package's; this is the
    // assertion that stops it, and a rename fails here rather than by re-running old migrations
    // against a journal nobody reads.
    const byName = Object.fromEntries(manifestSets().map((set) => [set.name, set.table]));
    expect(byName).toEqual({
      core: CORE_MIGRATIONS.migrationsTable,
      fiscal: FISCAL_MIGRATIONS.migrationsTable,
      payments: PAYMENTS_MIGRATIONS.migrationsTable,
      scheduler: SCHEDULER_MIGRATIONS.migrationsTable,
      credentials: CREDENTIALS_MIGRATIONS.migrationsTable,
    });
  });

  it("puts core first, because every other set has a tenants foreign key", () => {
    expect(manifestSets()[0]?.name).toBe("core");
  });

  it("resolves each source folder to a real Drizzle journal when run from source", () => {
    for (const options of migrationOptionsFor(manifestSets(), null)) {
      expect(existsSync(join(options.migrationsFolder, "meta", "_journal.json"))).toBe(true);
    }
  });

  it("resolves under a bundle root by name", () => {
    const options = migrationOptionsFor(
      [{ name: "core", table: "t", from: "../../packages/db/drizzle" }],
      "/opt/waitron/drizzle",
    );
    expect(options[0]?.migrationsFolder).toBe(join("/opt/waitron/drizzle", "core"));
  });

  it("refuses a root whose folder has no journal, rather than silently migrating nothing", async () => {
    // Drizzle treats an absent folder as an error, but an EMPTY one as zero migrations — which
    // would boot cleanly against an unmigrated database and fail later, somewhere else.
    const error = await captureError(() =>
      Promise.resolve(
        migrationOptionsFor([{ name: "core", table: "t", from: "x" }], "/nonexistent-root"),
      ),
    );
    expect(isAppError(error) && error.code).toBe("server.migrations_missing");
    expect(isAppError(error) && error.params).toMatchObject({ name: "core" });
  });
});
```

`apps/server/src/migrations.concurrency.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "./migrations.js";

let container: StartedPostgreSqlContainer;
let uri: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  uri = container.getConnectionUri();
}, 180_000);

afterAll(async () => {
  if (container !== undefined) await container.stop();
});

describe("applyMigrations under two concurrent hosts", () => {
  it("serialises on the advisory lock and leaves one journal row per migration", async () => {
    const options = migrationOptionsFor(manifestSets(), null);
    const a = await createPostgresDb(uri);
    const b = await createPostgresDb(uri);
    try {
      // Two replicas started together is the case the lock exists for. Without it both run
      // Drizzle's journal insert against the same empty table and one of them fails — or worse,
      // both apply the same CREATE TABLE and one crashes the boot of a healthy replica.
      await Promise.all([
        applyMigrations(uri, a, options),
        applyMigrations(uri, b, options),
      ]);

      const journal = await a.execute<{ count: string }>(
        sql`select count(*) as count from __drizzle_migrations_db`,
      );
      const again = await a.execute<{ count: string }>(
        sql`select count(*) as count from __drizzle_migrations_db`,
      );
      expect(journal.rows[0]!.count).toBe(again.rows[0]!.count);
      expect(Number(journal.rows[0]!.count)).toBeGreaterThan(0);

      // Idempotent on a current database: a third run applies nothing new.
      await applyMigrations(uri, a, options);
      const third = await a.execute<{ count: string }>(
        sql`select count(*) as count from __drizzle_migrations_db`,
      );
      expect(third.rows[0]!.count).toBe(journal.rows[0]!.count);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test src/migrations
```

Expected: FAIL — module not found. (Export the variable in your shell; never commit it.)

- [ ] **Step 4: Write `migrations.ts`**

```typescript
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { runMigrations, type Database, type MigrationOptions } from "@waitron/db";
import { AppError } from "@waitron/shared";
import manifest from "../migrations.manifest.json" with { type: "json" };
import "./errors.js";

export interface MigrationSet {
  name: string;
  table: string;
  /** Source folder, relative to `apps/server` — used when running from source (tests, dev). */
  from: string;
}

/**
 * A fixed key, not `hashtext` of a string: an advisory lock is only a lock if every host computes
 * the same number, and a hash function's stability across Postgres versions is not something to
 * lean on for that.
 */
const MIGRATION_LOCK_KEY = 8_474_103;

export function manifestSets(): MigrationSet[] {
  return manifest as MigrationSet[];
}

/**
 * Where each set's SQL actually lives.
 *
 * `root === null` means "running from source": resolve each `from` against this package. Otherwise
 * every set lives at `<root>/<name>`, which is what `scripts/copy-migrations.mjs` builds beside the
 * bundle.
 *
 * The indirection is not taste. Every `*_MIGRATIONS` descriptor computes `migrationsFolder` from its
 * own `import.meta.url`; esbuild collapses all five modules into one file, so all five resolve to
 * `dist/../drizzle` — a folder that does not exist. Using the descriptors directly therefore works
 * in development and fails at boot in the shipped artefact, which is the worst available failure
 * mode. Only the `migrationsTable` names come from the packages, and `migrations.test.ts` pins them.
 */
export function migrationOptionsFor(
  sets: readonly MigrationSet[],
  root: string | null,
): MigrationOptions[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return sets.map((set) => {
    const migrationsFolder =
      root === null
        ? resolve(here, "..", set.from)
        : join(isAbsolute(root) ? root : resolve(here, "..", root), set.name);
    // An ABSENT folder makes Drizzle throw, but an empty one is zero migrations — a clean boot
    // against an unmigrated database, failing later and somewhere else. Checking the journal is
    // what tells the two apart.
    if (!existsSync(join(migrationsFolder, "meta", "_journal.json"))) {
      throw new AppError("server.migrations_missing", { name: set.name, folder: migrationsFolder });
    }
    return { migrationsFolder, migrationsTable: set.table };
  });
}

/**
 * Applies every set in order, serialised across processes.
 *
 * The lock is held on a DEDICATED `pg.Client`, not on the pooled `Database`: `pg_advisory_lock` is
 * session-scoped, and a pool may hand two statements to two different backends — which would take
 * the lock on one connection and release it on another, locking nothing and leaking a lock.
 * `pg_advisory_xact_lock` is not available either, because Drizzle's migrator opens its own
 * transactions and cannot run inside ours.
 */
export async function applyMigrations(
  connectionString: string,
  db: Database,
  options: readonly MigrationOptions[],
): Promise<void> {
  const lock = new Client({ connectionString });
  await lock.connect();
  try {
    await lock.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      // Ordering is the runtime's responsibility and nothing enforces it — core carries `tenants`,
      // which every other set has a foreign key to. The manifest states that order out loud.
      for (const set of options) await runMigrations(db, set);
    } finally {
      await lock.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await lock.end();
  }
}
```

- [ ] **Step 5: Write the copy script**

`apps/server/scripts/copy-migrations.mjs`:

```javascript
// Copies each package's `drizzle/` folder in beside the bundle, because the bundle cannot resolve
// them: every *_MIGRATIONS descriptor computes its folder from its own import.meta.url, and esbuild
// collapses all five onto dist/. Reads the SAME manifest src/migrations.ts reads, so the two cannot
// disagree about names.
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const manifest = JSON.parse(await readFile(join(packageRoot, "migrations.manifest.json"), "utf8"));
const target = join(packageRoot, "dist", "drizzle");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const set of manifest) {
  await cp(resolve(packageRoot, set.from), join(target, set.name), { recursive: true });
  process.stdout.write(`copied ${set.name} migrations\n`);
}
```

- [ ] **Step 6: Run the tests**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test src/migrations
```

Expected: PASS — five manifest tests and the concurrency test.

- [ ] **Step 7: Verify the build produces a self-contained artefact**

```bash
pnpm --filter @waitron/server build
ls apps/server/dist/server.js apps/server/dist/drizzle/core/meta/_journal.json
```

Expected: both exist. Add `apps/server/dist` to `.gitignore` if the root ignore does not already cover `dist`.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add apps/server .gitignore
git commit -m "feat(server): apply every migration set at boot behind an advisory lock"
```

---

### Task 11: Boot, the entry point, and the real-Postgres capstone

Implements spec §3.1's wiring, §8's boot half, and §12's capstone.

**Files:**

- Create: `apps/server/src/boot.ts`, `apps/server/src/bin.ts`
- Create: `apps/server/src/testing/postgres.ts`
- Test: `apps/server/src/pass.rls.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1, 4–10.
- Produces:
  - `interface StartedServer { close(): Promise<void>; health: HealthState }`
  - `function startServer(env: Record<string, string | undefined>): Promise<StartedServer>`
  - From `src/testing/postgres.ts`: `startRealPostgres()` with `connect`, `connectAs`, `uri`, `stop`

- [ ] **Step 1: Write the real-Postgres helper**

`apps/server/src/testing/postgres.ts` — modelled on `packages/scheduler/src/testing/postgres.ts`, running all five sets through this package's own `applyMigrations` (so the capstone exercises the shipped migration path, not a second one), and additionally exposing `uri`:

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "../migrations.js";

export interface RealPostgres {
  uri: string;
  connect(): Promise<Database>;
  /** A fresh Database authenticated as `role`, which the caller must already have created. The
   * container's default user is a superuser and bypasses RLS, so `connect()` cannot exercise a
   * policy. */
  connectAs(role: string, password: string): Promise<Database>;
  stop(): Promise<void>;
}

export async function startRealPostgres(): Promise<RealPostgres> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
  } catch (cause) {
    // Never degrade to a skip. A suite that disappears when Docker is absent reports green while
    // asserting nothing, and PGlite's superuser bypasses FORCE ROW LEVEL SECURITY outright — which
    // is exactly the property this host's capstone exists to test.
    throw new Error(
      "apps/server's real-Postgres suites require a running Docker daemon. They cannot be " +
        "skipped: PGlite runs every connection as a superuser, so it cannot show whether this " +
        "host works as the non-superuser deployment role.",
      { cause },
    );
  }
  const uri = container.getConnectionUri();
  const migrator = await createPostgresDb(uri);
  await applyMigrations(uri, migrator, migrationOptionsFor(manifestSets(), null));
  await migrator.close();

  return {
    uri,
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

- [ ] **Step 2: Write the failing capstone**

`apps/server/src/pass.rls.test.ts`:

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import {
  CREDENTIALS_MIGRATIONS,
  credentialTenants,
  loadKeyRing,
  putCredential,
} from "@waitron/credentials";
import type { KeyRing } from "@waitron/credentials";
import { DEFAULTS, runDue } from "@waitron/scheduler";
import { StripeReconciler } from "@waitron/payments-stripe";
import { drain } from "@waitron/fiscal-verifactu";
import type Stripe from "stripe";
import { createLogger } from "./logger.js";
import { reconcilerAsDuty } from "./reconcile-duty.js";
import { runPass, RECONCILE_DUTY } from "./pass.js";
import { stripeAccountResolver } from "./stripe-account.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedTenant } from "../test/seed.js";

// A non-superuser LOGIN role inheriting app_user's grants — being non-superuser is what makes RLS
// apply at all. Everything below is the deployment role's view of the world.
const PROBE_ROLE = "server_pass_probe";
const PROBE_PASSWORD = "probe";
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const NOW = new Date("2026-07-26T09:00:00Z");

let pg: RealPostgres;
let admin: Database;
let ring: KeyRing;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`),
  );
  ring = loadKeyRing(KEY_ENV);
}, 180_000);

// Guarded: a beforeAll failure must not be masked by a teardown that throws first, and the
// container must not leak.
afterAll(async () => {
  if (admin !== undefined) await admin.close();
  if (pg !== undefined) await pg.stop();
});

/** A settlement report that finds nothing — the audit's clean case. The point of this suite is the
 * database path under RLS, not the audit's classification, which has its own suites. */
const emptyStripe = {
  balanceTransactions: {
    list: () => ({ autoPagingEach: () => Promise.resolve() }),
  },
} as unknown as Stripe;

describe("one pass as the non-superuser deployment role", () => {
  it("reads credentials, sweeps reconcile and writes the ledger", async () => {
    const tenantId = await seedTenant(admin);
    await withTenant(admin, tenantId, (tx) =>
      putCredential(tx, ring, {
        tenantId,
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_probe",
          webhookSecret: "whsec_probe",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The enrolment list, read cross-tenant through `credential_tenants` as the deployment role.
      // Under PGlite this would pass while proving nothing: a superuser sees the rows regardless of
      // whether the SECURITY DEFINER seam or its grant exists.
      const tenants = await credentialTenants(probe, "payments.stripe");
      expect(tenants).toContain(tenantId);

      const reconciler = new StripeReconciler({
        db: probe,
        resolveAccount: stripeAccountResolver({
          db: probe,
          ring,
          makeStripe: () => emptyStripe,
        }),
      });
      const duty = reconcilerAsDuty(reconciler);
      const lines: string[] = [];

      const report = await runPass(
        {
          // No `envios` rows exist, so the drainer finds no tenants and never asks for a
          // certificate. Its transport is covered by aeat-transport.test.ts against a real
          // handshake; what this asserts is that the composed pass runs as app_user.
          drain: (now) =>
            drain(
              {
                db: probe,
                resolveClient: () =>
                  Promise.reject(new Error("no due fiscal work in this suite")),
              },
              now,
            ),
          reconcile: (now) =>
            runDue({ db: probe, duties: [duty], ...DEFAULTS }, tenants, now),
          log: createLogger((line) => lines.push(line), () => NOW),
        },
        NOW,
      );

      expect(report.duties.every((entry) => entry.ok)).toBe(true);

      // The ledger is the proof: SELECT, INSERT and UPDATE on `scheduled_runs` all had to succeed
      // under the tenant-isolation policy, and a missing grant on any one of them is invisible
      // under PGlite.
      const rows = await admin.execute<{ count: string }>(
        sql`select count(*) as count from scheduled_runs
            where tenant_id = ${tenantId} and duty = ${RECONCILE_DUTY} and state = 'succeeded'`,
      );
      expect(Number(rows.rows[0]!.count)).toBeGreaterThan(0);
    } finally {
      await probe.close();
    }
  });

  it("does not enumerate a tenant with no Stripe credential", async () => {
    const unprovisioned = await seedTenant(admin);
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The vault IS the enrolment list: a tenant nobody provisioned is not half-served.
      expect(await credentialTenants(probe, "payments.stripe")).not.toContain(unprovisioned);
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test src/pass.rls.test.ts
```

Expected: FAIL — `./testing/postgres.js` not found, then real assertion failures as pieces land.

- [ ] **Step 4: Write `boot.ts`**

```typescript
import { serve } from "@hono/node-server";
import { createPostgresDb } from "@waitron/db";
import { credentialTenants, loadKeyRing } from "@waitron/credentials";
import { runDue } from "@waitron/scheduler";
import { StripeReconciler } from "@waitron/payments-stripe";
import { drain } from "@waitron/fiscal-verifactu";
import { aeatClientResolver, aeatEndpointFor, mtlsFetch } from "./aeat-transport.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "./migrations.js";
import { createHealthState, healthApp, recordPass, type HealthState } from "./health.js";
import { runLoop, realSleep } from "./loop.js";
import { reconcilerAsDuty } from "./reconcile-duty.js";
import { runPass } from "./pass.js";
import { stripeAccountResolver, defaultMakeStripe } from "./stripe-account.js";
// `DEFAULTS` is NOT imported: `loadConfig` already applied the scheduler's defaults, so reaching for
// them again here would be a second source of truth for the same five numbers.

export interface StartedServer {
  health: HealthState;
  /** Resolves when the loop has stopped, the listener is closed and the pool is drained. */
  close(): Promise<void>;
}

/**
 * The one place the real implementations meet. Everything above is injected, so this function is
 * thin by construction and its correctness is the capstone's subject rather than a unit test's.
 *
 * Boot failures ESCAPE, deliberately: invalid config, an unloadable key ring, a failed migration or
 * an unreachable database exit non-zero and let the supervisor decide. A host that boots
 * half-configured and retries in the background is a host whose operator believes it is working.
 */
export async function startServer(
  env: Record<string, string | undefined>,
): Promise<StartedServer> {
  const now = () => new Date();
  const log = createLogger((line) => process.stdout.write(line), now);
  // Next to the bundle: `scripts/copy-migrations.mjs` puts them there, and running from source
  // passes `null` instead. `import.meta.dirname` is `dist/` in the bundle and `src/` from source,
  // and only the bundle has a sibling `drizzle/`.
  const config = loadConfig(env, new URL("drizzle", import.meta.url).pathname);
  // `process.env` straight through: `loadKeyRing` owns the four WAITRON_CREDENTIALS_KEY* names and
  // their validation, and re-declaring them here would be a second source of truth.
  const ring = loadKeyRing(env);

  const db = await createPostgresDb(config.databaseUrl);
  await applyMigrations(
    config.databaseUrl,
    db,
    migrationOptionsFor(manifestSets(), config.migrationsRoot),
  );

  const resolveClient = aeatClientResolver({
    db,
    ring,
    endpointFor: aeatEndpointFor(config.aeatEnv),
    fetchFor: (material) => mtlsFetch(material),
  });
  const reconciler = new StripeReconciler({
    db,
    resolveAccount: stripeAccountResolver({ db, ring, makeStripe: defaultMakeStripe }),
    ...(config.settlementLagMs === undefined ? {} : { settlementLagMs: config.settlementLagMs }),
  });
  const duty = reconcilerAsDuty(reconciler);

  const health = createHealthState(now());
  const server = serve({ fetch: healthApp(health, now).fetch, port: config.httpPort });
  log("info", "server.listening", { port: config.httpPort, aeatEnv: config.aeatEnv });

  const controller = new AbortController();
  const loop = runLoop({
    pass: (at) =>
      runPass(
        {
          drain: (at2) => drain({ db, resolveClient }, at2),
          // Enumerated per pass, not at boot: a tenant provisioned while the host runs is served
          // on the next pass rather than after a restart.
          reconcile: async (at2) =>
            runDue(
              {
                db,
                duties: [duty],
                horizonDays: config.scheduler.horizonDays,
                maxPeriodsPerTick: config.scheduler.maxPeriodsPerTick,
                maxAttempts: config.scheduler.maxAttempts,
                backoffBaseMs: config.scheduler.backoffBaseMs,
                staleAfterMs: config.scheduler.staleAfterMs,
              },
              await credentialTenants(db, "payments.stripe"),
              at2,
            ),
          log,
        },
        at,
      ),
    now,
    sleep: realSleep,
    signal: controller.signal,
    minTickMs: config.minTickMs,
    maxTickMs: config.maxTickMs,
    log,
    onPass: (report, at) => recordPass(health, report, at),
  });

  return {
    health,
    close: async () => {
      controller.abort();
      await loop;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await db.close();
      log("info", "server.stopped");
    },
  };
}
```

- [ ] **Step 5: Write `bin.ts`**

```typescript
import { startServer } from "./boot.js";

const server = await startServer(process.env);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  // once: a second SIGTERM while the first shutdown is in flight must not start a second one.
  process.once(signal, () => {
    void server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        process.stderr.write(`${String(error)}\n`);
        process.exit(1);
      },
    );
  });
}
```

Boot failures need no `catch` here: an unhandled rejection at top level already exits non-zero, and a hand-rolled handler would only risk swallowing the structured code. Confirm with Step 7.

- [ ] **Step 6: Run the capstone**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test src/pass.rls.test.ts
```

Expected: PASS — two tests.

- [ ] **Step 7: Verify a boot failure exits non-zero**

```bash
pnpm --filter @waitron/server build
node apps/server/dist/server.js; echo "exit=$?"
```

Expected: a `server.config_missing` message naming `DATABASE_URL`, and `exit=1`.

- [ ] **Step 8: Run the whole package suite, typecheck and lint**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test \
  && pnpm --filter @waitron/server typecheck \
  && pnpm --filter @waitron/server lint
```

Expected: PASS on all three.

- [ ] **Step 9: Commit**

```bash
pnpm format
git add apps/server
git commit -m "feat(server): boot, the entry point, and the real-Postgres pass capstone"
```

---

### Task 12: The guards this package must not escape, and coverage

Implements spec §13, and closes the plan's own loose ends. Coverage lands last, once every source file exists (a threshold added earlier just churns).

**Files:**

- Modify: `packages/db/src/english-only.ts` (+ its test), `eslint.config.js`
- Modify: `apps/server/vitest.config.ts` (thresholds)
- Modify: `docs/superpowers/specs/2026-07-25-recurring-work-scheduler-design.md` (§2's honest cost, §8's owner)

- [ ] **Step 1: Decide the english-only scan, explicitly**

`packages/db/src/english-only.ts` enumerates `GENERIC_PACKAGES` and scans `packages/<name>`, so `apps/server` is outside the guard entirely — the same trap `packages/scheduler` hit. Read the file, then take one of these two and write the reasoning into the code:

**(a) Extend the scan.** Add an `apps/` dimension and list `server` as scanned-but-exempt for the fiscal vocabulary it must legitimately name (`fiscal.aeat`, `envios`-derived counters, `drain`). Update `english-only.test.ts` to assert the new path is scanned.

**(b) Record it as out of scope.** Add a comment naming `apps/*` and stating why a composition root is not the guard's subject — it necessarily speaks both vocabularies, so an exemption list covering everything it says would assert nothing.

**(b) is the likelier honest answer** — this host names Spanish-derived identifiers in every log line about `drain` — but it must be a written decision, not an omission. Either way, add the assertion or the comment; do not leave silence.

- [ ] **Step 2: Confirm eslint covers the new tree**

```bash
pnpm lint
```

`eslint.config.js` has no `files` restriction on its base configs, so `apps/**/*.ts` is already linted. Verify by introducing an unused variable in `apps/server/src/pass.ts`, running `pnpm lint`, seeing it fail, and removing it.

- [ ] **Step 3: Add coverage thresholds**

```bash
pnpm --filter @waitron/server test:coverage
```

Read the report, then add thresholds to `apps/server/vitest.config.ts` at the repo's level (`statements: 98, lines: 98, functions: 98, branches: 95`), extending the `exclude` list only for files that genuinely cannot be covered — `src/bin.ts` (the process entry point), `src/testing/**`, `scripts/**`. `src/boot.ts` is *composition* whose only honest test is the capstone; if it cannot reach the threshold, exclude it **with a comment saying so**, exactly as `packages/scheduler` excludes its barrels. Do not lower a threshold to make a file fit.

- [ ] **Step 4: Run the full workspace gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && TESTCONTAINERS_RYUK_DISABLED=true pnpm test
```

Expected: PASS. `format:check` is a separate gate from `lint` — both must be green.

- [ ] **Step 5: Amend the scheduler design**

In `docs/superpowers/specs/2026-07-25-recurring-work-scheduler-design.md`, add a dated amendment note to §2's decision 2 (*"nothing runs until that host exists"* — it now does) and to §8 (the reconcile adapter now lives at `apps/server/src/reconcile-duty.ts`; the fit test remains as the type proof). Keep it short and factual; do not rewrite the original reasoning.

- [ ] **Step 6: Record what this cycle did not close**

Append to the spec's §14 (`docs/superpowers/specs/2026-07-26-server-host-design.md`) the items this plan discovered and deliberately left:

- `test/seed.ts` is now duplicated a sixth time (`apps/server/test/seed.ts`), still blocked on `@waitron/db` having no `exports` map.
- `startRealPostgres` is duplicated a sixth time, same blocker.
- The mTLS transport is proven against a private CA, never against AEAT. First contact with preproduction remains certificate-blocked.
- `rotate`'s write-side coupling to `PURPOSES` is unchanged: a field-list edit still needs affected rows re-provisioned before the next rotation.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/db eslint.config.js apps/server docs/superpowers/specs
git commit -m "chore(server): settle the english-only scope, coverage thresholds and spec amendments"
```

---

## Self-Review

**Spec coverage.** §1 → Tasks 1, 7–11. §2's scope → the whole plan (C3 and `forward` appear only in §14's exclusions). §3.1 → Task 8. §3.2 → Task 4. §3.3 → Task 9. §3.4/§4 → Task 2. §3.5/§6 → Tasks 4, 5, 11. §5 → Task 3. §5.1 → Task 4 (`certMaterialFrom`). §7 → Tasks 7, 8. §8 → Task 7 (in-loop), Task 11 (boot), Task 8 (SIGTERM). §9 → Task 9. §10 → Task 1. §11 → Task 10. §12 → the test steps of Tasks 1, 4–11. §13 → Task 12. §14/§15 → Task 12 Step 6.

**One place where a task is a decision, not a transcription:** Task 12 Step 1's english-only choice. (b) is the likely answer, but the reasoning must be written into the code either way — silence is the failure mode, and it is the one `packages/scheduler` already hit.

**Fixtures are reused, never re-authored.** Task 2's test seeds through the existing `seedPendingEnvios`/`seedTenantWithSif` (`packages/fiscal-verifactu/test/`), so no second `registros_facturacion` column list enters the repo. Task 4's stale-payload case drives the exported pure `certMaterialFrom` rather than forging a two-field vault row, which `putCredential`'s validation makes impossible and `seal` (unexported, deliberately) makes unreachable.

**Type consistency.** `resolveClient: (tenantId: TenantId) => Promise<VerifactuClient>` is identical in Task 2's `DrainDeps`, Task 4's `aeatClientResolver` return and Task 11's `boot.ts`. `DrainResult.skipped` and `TickResult.skipped` are deliberately different shapes (`{tenantId, errorCode}` versus `{tenantId, duty, errorCode}`), and Task 7 logs each under its own event name for that reason. `DRAIN_DUTY`/`RECONCILE_DUTY` are defined once in `pass.ts` and imported by `health.ts` and the capstone. `PassReport` is produced by `pass.ts` and consumed by `loop.ts` and `health.ts` with no reshaping.

**One correction the plan makes to the spec**, already folded into §11: the migration descriptors cannot be used as-is from a bundle, so the host resolves folders from a manifest and the build copies them. The spec said "five lines"; it is a manifest, a resolver, a copy script and a pinning test.

# `@waitron/db` exports map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish two test-only subpaths from `@waitron/db` behind an `exports` map, and collapse the six copies of `startRealPostgres` and three copies of `seedTenant`/`freshNif` onto them without editing a single test that calls them.

**Architecture:** `@waitron/db` gains an enumerated `exports` map with two test subpaths beside its production barrel. `src/testing/postgres.ts` holds the container helper as a primitive (`startMigratedPostgres`) that takes migration as a *callback* and the container start as an injectable *seam*; each consuming package keeps a ~14-line `src/testing/postgres.ts` wrapper supplying its own verbatim Docker-required message and its own migration sets, so every existing call site's import line is unchanged. `src/testing/seed.ts` holds `seedTenant`/`freshNif`, which take no configuration and are therefore imported directly, deleting three local copies.

**Tech Stack:** TypeScript (ESM, `moduleResolution: "bundler"`), pnpm workspaces, Vitest, Drizzle, Testcontainers, `eslint-plugin-import-x` with `eslint-import-resolver-typescript`.

**Spec:** [`docs/superpowers/specs/2026-07-28-db-exports-map-design.md`](../specs/2026-07-28-db-exports-map-design.md). Read it before Task 1; §1 corrects four claims that earlier notes got wrong.

## Global Constraints

- **Every commit must be signed off.** `git commit -s -m "…"`. The `dco` job in `.github/workflows/licence.yml` walks every commit in the PR range and fails on the first one missing a `Signed-off-by:` trailer. There is no amnesty for intermediate commits.
- **The gate is four commands, not three**: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check` (per `CONTRIBUTING.md`). `format:check` is **not** covered by `lint` and has broken this branch's predecessors in each of the last two cycles. Run it before every commit.
- **`TESTCONTAINERS_RYUK_DISABLED=true` is mandatory locally** for any suite that starts a container, or it hangs and times out at 180s. Prefix every real-Postgres test command with it.
- **Never edit a `startRealPostgres`, `RealPostgres` or `roleUrl` import line.** 23 call sites across 22 test files keep those exact import lines — `startRealPostgres`, `type RealPostgres` and (in `apps/server`) `roleUrl` all still come from `./testing/postgres.js`. Four of the 22 (the RLS/concurrency suites that also seed a tenant) do get one *other* line changed, in Task 1: their `seedTenant` import is re-pointed to `@waitron/db/testing/seed.js`, which is that task's own planned work. Tasks 3–6 edit no test file that calls `startRealPostgres` — Task 5 does edit four test files that don't (`packages/db/src/client.test.ts`, `packages/db/src/migrate.test.ts`, `packages/db/src/testing/postgres.test.ts`, `apps/server/src/migrations.concurrency.test.ts`), swapping their `"postgres:18-alpine"` literal for `POSTGRES_IMAGE`. A diff touching one of the 22 files' `startRealPostgres`/`RealPostgres`/`roleUrl` import is a design violation; if you believe one needs changing, stop and report it instead.
- **The six `dockerRequired` messages are copied verbatim**, character for character, including their string concatenation breaks. They are load-bearing documentation and three of them cite a specific file.
- **`@waitron/db` holds `src/testing/**` to 98/98/98/95 coverage** (statements/lines/functions/branches). Every consumer excludes `src/testing/**`; `db` deliberately does not. New files there need real tests.
- **A test's name must not claim more than it asserts.** This repo has caught the opposite twice.
- Node's `exports` map is enumerated deliberately — do not turn it into a `"./testing/*"` wildcard.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `packages/db/src/testing/seed.ts` | `freshNif()` + `seedTenant()` — the only tenant seed three packages need |
| `packages/db/src/testing/seed.test.ts` | Proves the seed against PGlite via `describeEachTarget` |
| `packages/db/src/testing/postgres.ts` | `POSTGRES_IMAGE`, `roleUrl`, `runMigrationSets`, `startMigratedPostgres`, the `StartedContainer` seam |
| `packages/db/src/testing/postgres.test.ts` | Failure paths with a fake container; happy path Docker-gated |
| `packages/db/src/migrations.ts` | `CORE_MIGRATIONS`, one definition, imported by both the barrel and `harness.ts` |

**Modified:** `packages/db/package.json` (the map), `packages/db/src/index.ts` (re-export `CORE_MIGRATIONS`), `packages/db/src/testing/harness.ts` (drop the private duplicate, use `POSTGRES_IMAGE`), `packages/db/src/client.test.ts` + `packages/db/src/migrate.test.ts` (use `POSTGRES_IMAGE`), the six `*/src/testing/postgres.ts` wrappers, 13 seed import lines, five `package.json` devDependency blocks, `apps/server/src/migrations.concurrency.test.ts`, `packages/fiscal-verifactu/src/registro-sif.ts` (one comment).

**Deleted:** `apps/server/test/seed.ts`, `packages/credentials/test/seed.ts`, `packages/scheduler/test/seed.ts`.

---

## Task 1: The shared tenant seed, published and adopted

Proves the `exports` map works end-to-end across a package boundary before anything larger depends on it.

**Files:**
- Create: `packages/db/src/testing/seed.ts`
- Create: `packages/db/src/testing/seed.test.ts`
- Modify: `packages/db/package.json` (add `exports`)
- Delete: `apps/server/test/seed.ts`, `packages/credentials/test/seed.ts`, `packages/scheduler/test/seed.ts`
- Modify (import line only): `packages/scheduler/src/{scheduler.rls,store,store.concurrency,run,resweep}.test.ts`, `packages/credentials/src/{store,rotate,credentials.rls,migrations,cli}.test.ts`, `apps/server/src/{pass.rls,stripe-account,aeat-transport}.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `freshNif(): string` and `seedTenant(db: Database): Promise<TenantId>` from `@waitron/db/testing/seed.js`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/testing/seed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { describeEachTarget } from "./harness.js";
import { freshNif, seedTenant } from "./seed.js";

describe("freshNif", () => {
  // Deliberately asserts the SHAPE and the base, never a specific counter value: the counter is
  // module-global and any other test in this file that seeds a tenant advances it, so pinning a
  // value here would make the file order-dependent.
  it("returns an 8-digit NIF on the 40-million base no other generator in this repo uses", () => {
    expect(freshNif()).toMatch(/^4\d{7}K$/);
  });

  it("never repeats within a run", () => {
    const minted = new Set(Array.from({ length: 5 }, () => freshNif()));
    expect(minted.size).toBe(5);
  });
});

describeEachTarget("seedTenant", (target) => {
  it("inserts one tenant and returns its id", async () => {
    const db = await target.create();
    const id = await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants where id = ${id}`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });

  it("gives each tenant its own NIF, so a suite can seed several", async () => {
    const db = await target.create();
    await seedTenant(db);
    await seedTenant(db);
    await seedTenant(db);
    const result = await db.execute<{ n: number }>(
      sql`select count(distinct nif)::int as n from tenants`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/db exec vitest run src/testing/seed.test.ts`
Expected: FAIL — `Failed to resolve import "./seed.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/testing/seed.ts`:

```ts
import { sql } from "drizzle-orm";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { Database } from "../client.js";

// Tenants accumulate for the life of a suite (nothing truncates `tenants`), so every seeded tenant
// needs its own NIF or collides on `tenants_nif_key`. One module-scope counter is enough: each
// package's suite runs in its own process against its own database.
//
// The 40-million base is load-bearing, not arbitrary. Four other NIF generators survive elsewhere
// in this repo, each with its own independent counter — `packages/core/test/fixtures.ts`,
// `packages/payments/test/seed.ts` and `packages/fiscal-verifactu/src/testing/seed.ts` on 10M,
// `packages/fiscal-verifactu/test/fixtures.ts` on 20M. A file that seeds through two generators
// against ONE database collides on `tenants_nif_key` with nothing in the failure to explain why,
// and `apps/server/src/boot.test.ts` is already one line away from that: it imports
// `seedPendingEnvios` from `@waitron/fiscal-verifactu/test/drain-fixtures.js`, whose own tenants
// come off the 20M counter, into the same database this seed writes to. Staying off every base in
// use keeps that unreachable rather than merely unlikely.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(40_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Seeds one tenant and returns its id. Run as the connection owner (superuser) — RLS is bypassed,
 * so this is pure setup. */
export async function seedTenant(db: Database): Promise<TenantId> {
  const result = await db.execute<{ id: string }>(sql`
    insert into tenants (nif, legal_name) values (${freshNif()}, 'Test SL') returning id`);
  return brandTenantId(result.rows[0]!.id);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @waitron/db exec vitest run src/testing/seed.test.ts`
Expected: PASS. The `[postgres]` half of `describeEachTarget` needs Docker; on a machine without it the harness prints its banner and runs the PGlite half only, which is enough here.

- [ ] **Step 5: Publish the subpath**

In `packages/db/package.json`, immediately after the `"main"` line, add:

```json
  "exports": {
    ".": "./src/index.ts",
    "./testing/seed.js": "./src/testing/seed.ts"
  },
```

Keep `"main": "./src/index.ts"` as it is. `"./testing/postgres.js"` arrives in Task 2 — do not add it now; the file does not exist yet and an `exports` entry pointing at a missing file is a resolution failure waiting to happen.

- [ ] **Step 6: Re-point the 13 consumers and delete the three copies**

In each of the 13 files listed under **Files** above, change

```ts
import { seedTenant } from "../test/seed.js";
```

to

```ts
import { seedTenant } from "@waitron/db/testing/seed.js";
```

Import ordering matters to nothing mechanical here, but keep the line in the same position it already occupies. None of the 13 import `freshNif`; if you find one that does, import it from the same new specifier.

Then delete the three now-orphaned files:

```bash
git rm apps/server/test/seed.ts packages/credentials/test/seed.ts packages/scheduler/test/seed.ts
```

- [ ] **Step 7: Prove all four resolvers honour the map**

This is the step the spec asks for first rather than last. Run, in order:

```bash
pnpm typecheck                                    # TypeScript, moduleResolution: bundler
pnpm lint                                         # eslint-import-resolver-typescript
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/scheduler test    # Vite/Vitest, cross-package
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/credentials test
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test
```

Expected: all pass. A resolver that ignored `exports` would fail here with an unresolved
`@waitron/db/testing/seed.js`, which is precisely the signal being bought. (Stryker is the fourth
resolver and runs the same Vite pipeline; `ci.yml` only mutation-tests `@waitron/verifactu` and
`@waitron/shared` on a PR, neither of which imports this subpath, so a bounded `db` run in Task 6
closes it out.)

- [ ] **Step 8: Full gate, then commit**

```bash
pnpm lint && pnpm typecheck && pnpm format:check
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
git add -A
git commit -s -m "test(db): publish @waitron/db/testing/seed.js and delete three copies of it

The exports map lands with one subpath and one consumer set, so the map itself
is proven across a package boundary before anything larger depends on it.

The shared counter moves to a 40-million base: four other NIF generators
survive in this repo on 10M and 20M, and apps/server's boot.test.ts already
pulls fiscal-verifactu's 20M tenants into the same database this seed writes
to. Nothing collides today only because that file never calls seedTenant."
```

---

## Task 2: The shared container helper

**Files:**
- Create: `packages/db/src/testing/postgres.ts`
- Create: `packages/db/src/testing/postgres.test.ts`
- Modify: `packages/db/package.json` (add the second subpath)

**Interfaces:**
- Consumes: `createPostgresDb`, `Database` (`../client.js`); `runMigrations`, `MigrationOptions` (`../migrate.js`); `CORE_MIGRATIONS` (`../index.js` — Task 5 moves this to `../migrations.js`); `dockerAvailable` (`./harness.js`).
- Produces, from `@waitron/db/testing/postgres.js`:
  - `POSTGRES_IMAGE: string`
  - `interface StartedContainer { getConnectionUri(): string; stop(): Promise<void> }`
  - `interface RealPostgres { uri: string; connect(): Promise<Database>; connectAs(role: string, password: string): Promise<Database>; stop(): Promise<void> }`
  - `interface MigratedPostgresOptions { dockerRequired: string; migrate(uri: string): Promise<void>; start?(): Promise<StartedContainer> }`
  - `roleUrl(uri: string, role: string, password: string): string`
  - `runMigrationSets(uri: string, sets: readonly MigrationOptions[]): Promise<void>`
  - `startMigratedPostgres(options: MigratedPostgresOptions): Promise<RealPostgres>`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/testing/postgres.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../index.js";
import { dockerAvailable } from "./harness.js";
import {
  roleUrl,
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
  type StartedContainer,
} from "./postgres.js";

const FAKE_URI = "postgresql://owner:secret@127.0.0.1:5432/waitron";

function fakeContainer(stop = vi.fn(async () => {})): StartedContainer {
  return { getConnectionUri: () => FAKE_URI, stop };
}

describe("roleUrl", () => {
  it("swaps the credentials and leaves host, port and database alone", () => {
    const swapped = new URL(roleUrl(FAKE_URI, "app_probe", "pw"));
    expect(swapped.username).toBe("app_probe");
    expect(swapped.password).toBe("pw");
    expect(swapped.host).toBe("127.0.0.1:5432");
    expect(swapped.pathname).toBe("/waitron");
  });
});

describe("startMigratedPostgres when the container will not start", () => {
  const options = {
    dockerRequired: "The example suite requires a running Docker daemon.",
    migrate: async () => {},
    start: () => Promise.reject(new Error("Cannot connect to the Docker daemon")),
  };

  it("throws the caller's own message, never a generic one", async () => {
    await expect(startMigratedPostgres(options)).rejects.toThrow(
      "The example suite requires a running Docker daemon.",
    );
  });

  it("keeps the underlying failure as the cause", async () => {
    const error = await startMigratedPostgres(options).catch((e: unknown) => e);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(((error as Error).cause as Error).message).toContain("Docker daemon");
  });
});

describe("startMigratedPostgres when migration fails", () => {
  it("stops the container and propagates the original error", async () => {
    const stop = vi.fn(async () => {});
    const boom = new Error("relation already exists");
    await expect(
      startMigratedPostgres({
        dockerRequired: "unused here",
        migrate: () => Promise.reject(boom),
        start: async () => fakeContainer(stop),
      }),
    ).rejects.toBe(boom);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("startMigratedPostgres on the happy path", () => {
  it("exposes the container's uri and leaves it running until the caller stops it", async () => {
    const stop = vi.fn(async () => {});
    const pg = await startMigratedPostgres({
      dockerRequired: "unused here",
      migrate: async () => {},
      start: async () => fakeContainer(stop),
    });
    expect(pg.uri).toBe(FAKE_URI);
    expect(stop).not.toHaveBeenCalled();
    await pg.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("passes the container's uri to migrate", async () => {
    const migrate = vi.fn(async () => {});
    await startMigratedPostgres({
      dockerRequired: "unused here",
      migrate,
      start: async () => fakeContainer(),
    });
    expect(migrate).toHaveBeenCalledWith(FAKE_URI);
  });
});

describe.runIf(dockerAvailable())("against a real container", () => {
  let pg: RealPostgres;

  beforeAll(async () => {
    pg = await startMigratedPostgres({
      dockerRequired: "This test starts its own container and is gated on dockerAvailable().",
      migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    });
  }, 120_000);

  afterAll(async () => {
    if (pg !== undefined) await pg.stop();
  });

  it("connect() reaches a migrated database", async () => {
    const db = await pg.connect();
    try {
      const result = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from tenants`,
      );
      expect((result.rows[0] as { n: number }).n).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("gives every connect() its own backend process", async () => {
    const [a, b] = await Promise.all([pg.connect(), pg.connect()]);
    try {
      const pidOf = async (db: Database) => {
        const result = await db.execute<{ pid: number }>(sql`select pg_backend_pid()::int as pid`);
        return (result.rows[0] as { pid: number }).pid;
      };
      expect(await pidOf(a)).not.toBe(await pidOf(b));
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("connectAs() authenticates as the role the caller created", async () => {
    const owner = await pg.connect();
    try {
      await owner.execute(sql.raw("create role probe login password 'probe_pw'"));
    } finally {
      await owner.close();
    }
    const asProbe = await pg.connectAs("probe", "probe_pw");
    try {
      const result = await asProbe.execute<{ who: string }>(sql`select current_user as who`);
      expect((result.rows[0] as { who: string }).who).toBe("probe");
    } finally {
      await asProbe.close();
    }
  });

  it("runMigrationSets rejects when a set's folder holds no migrations", async () => {
    await expect(
      runMigrationSets(pg.uri, [
        { migrationsFolder: "/nonexistent-waitron-migrations", migrationsTable: "probe" },
      ]),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db exec vitest run src/testing/postgres.test.ts`
Expected: FAIL — `Failed to resolve import "./postgres.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/testing/postgres.ts`:

```ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresDb, type Database } from "../client.js";
import { runMigrations, type MigrationOptions } from "../migrate.js";

/** The one place this repo's test PostgreSQL image tag is written down. */
export const POSTGRES_IMAGE = "postgres:18-alpine";

/**
 * The slice of a started container this helper actually uses, and the seam a test fakes.
 *
 * `StartedPostgreSqlContainer` does NOT satisfy this structurally: its `stop()` resolves to a
 * `StoppedTestContainer`, and TypeScript's void-return relaxation covers `() => T` against
 * `() => void`, never `Promise<T>` against `Promise<void>`. `defaultStart` therefore adapts the
 * real container rather than handing it back. The seam exists so the Docker-absent and
 * failed-migration paths can be proven without a daemon — the same reason `harness.ts` keeps
 * `resolveTargets` pure and separate from `describeEachTarget`.
 */
export interface StartedContainer {
  getConnectionUri(): string;
  stop(): Promise<void>;
}

export interface RealPostgres {
  /** The container's own connection URI, authenticated as its default (superuser) role. */
  uri: string;
  /**
   * A fresh Database — its own pool, therefore its own backend process.
   *
   * A NEW `Database` per call, never one shared pool: two callers must land on two backend
   * processes for `FOR UPDATE` to have anything to block against, and a pool sized below the
   * caller count would silently reduce the concurrency under test.
   * `packages/fiscal-verifactu/src/chain.concurrency.test.ts`'s first test — "runs its writers on
   * distinct backend processes" — is the load-bearing check that this promise holds downstream.
   */
  connect(): Promise<Database>;
  /**
   * A fresh Database authenticated as `role`, which the caller must already have created. The
   * container's default user is a superuser and bypasses RLS, so `connect()` cannot exercise a
   * policy.
   */
  connectAs(role: string, password: string): Promise<Database>;
  stop(): Promise<void>;
}

export interface MigratedPostgresOptions {
  /**
   * Why this suite cannot degrade to a skip, thrown verbatim when the container will not start.
   *
   * Required, never defaulted. Each caller's message explains why THAT suite has no soft mode, and
   * several cite the file that documents the reason; a default would produce a generic message at
   * exactly the moment someone needs the specific one.
   */
  dockerRequired: string;
  /** Applies every migration set this suite needs, core first. */
  migrate(uri: string): Promise<void>;
  /** Seam — see `StartedContainer`. Defaults to a real Testcontainers PostgreSQL. */
  start?(): Promise<StartedContainer>;
}

async function defaultStart(): Promise<StartedContainer> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  return {
    getConnectionUri: () => container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * `uri` with its username/password swapped for `role`/`password` — the one place this connection
 * string's shape is assembled, so a future parameter (e.g. `sslmode`) has one call site to change.
 *
 * `connectAs` is `createPostgresDb(roleUrl(...))`; a caller that needs the connection *string*
 * itself, rather than a live `Database` — e.g. to pass as `DATABASE_URL` to a process it spawns —
 * calls this directly instead of re-deriving the same mutation.
 */
export function roleUrl(uri: string, role: string, password: string): string {
  const u = new URL(uri);
  u.username = role;
  u.password = password;
  return u.toString();
}

/**
 * Runs `sets` in order over one throwaway connection, closing it whether or not a set throws.
 *
 * Ordering across packages is the runtime's responsibility and nothing enforces it, so callers pass
 * the order explicitly — core first, since it carries `tenants` and every other set has a foreign
 * key to it. The `finally` is not decoration: the five copies this replaces closed their migrator
 * only on success, so a failing migration leaked a pool as well as a container.
 */
export async function runMigrationSets(
  uri: string,
  sets: readonly MigrationOptions[],
): Promise<void> {
  const migrator = await createPostgresDb(uri);
  try {
    for (const set of sets) await runMigrations(migrator, set);
  } finally {
    await migrator.close();
  }
}

/**
 * Starts a PostgreSQL container, migrates it, and returns the connections a suite needs.
 *
 * Either returns a fully-migrated `RealPostgres` or throws having already stopped the container: a
 * caller's `pg = await startRealPostgres()` never observes a partially constructed value, so its
 * own `afterAll`'s `if (pg !== undefined)` guard cannot help here. Left unguarded, a throw from
 * `migrate` would leave the container running with nothing left to stop it — and with
 * `TESTCONTAINERS_RYUK_DISABLED=true` (mandatory for this repo's local runs) there is no reaper
 * backstop either.
 */
export async function startMigratedPostgres(
  options: MigratedPostgresOptions,
): Promise<RealPostgres> {
  const start = options.start ?? defaultStart;
  let container: StartedContainer;
  try {
    container = await start();
  } catch (cause) {
    // Never degrade to a skip. A suite that disappears when Docker is absent reports green while
    // asserting nothing, and PGlite's superuser bypasses FORCE ROW LEVEL SECURITY outright.
    throw new Error(options.dockerRequired, { cause });
  }

  const uri = container.getConnectionUri();
  try {
    await options.migrate(uri);
  } catch (error) {
    await container.stop();
    throw error;
  }

  return {
    uri,
    connect: () => createPostgresDb(uri),
    connectAs: (role, password) => createPostgresDb(roleUrl(uri, role, password)),
    stop: () => container.stop(),
  };
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db exec vitest run src/testing/postgres.test.ts`
Expected: PASS, including the `against a real container` block if Docker is present.

- [ ] **Step 5: Publish the second subpath**

In `packages/db/package.json`, add the entry so the map reads:

```json
  "exports": {
    ".": "./src/index.ts",
    "./testing/postgres.js": "./src/testing/postgres.ts",
    "./testing/seed.js": "./src/testing/seed.ts"
  },
```

- [ ] **Step 6: Confirm the package still meets its own coverage bar**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`
Expected: PASS at 98/98/98/95 with `src/testing/postgres.ts` included. If `defaultStart` shows as uncovered, you are running without Docker — say so in your report rather than adding an ignore comment; CI has a daemon.

- [ ] **Step 7: Gate and commit**

```bash
pnpm lint && pnpm typecheck && pnpm format:check
git add -A
git commit -s -m "test(db): the shared real-Postgres helper, with a seam for its failure paths

startMigratedPostgres takes migration as a callback, because apps/server
migrates through its own production path and the other five run descriptor
lists. The container start is injectable so the Docker-absent message and the
stop-on-failed-migration path get tests — neither is covered anywhere in this
repo today, because every consumer excludes src/testing from coverage and db
deliberately does not."
```

---

## Task 3: Convert the five descriptor-based wrappers

**Files:**
- Modify: `packages/credentials/src/testing/postgres.ts`
- Modify: `packages/scheduler/src/testing/postgres.ts`
- Modify: `packages/payments/src/testing/postgres.ts`
- Modify: `packages/payments-stripe/src/testing/postgres.ts`
- Modify: `packages/fiscal-verifactu/src/testing/postgres.ts`

**Interfaces:**
- Consumes: `runMigrationSets`, `startMigratedPostgres`, `type RealPostgres` from `@waitron/db/testing/postgres.js`; `CORE_MIGRATIONS` from `@waitron/db`.
- Produces: each file still exports `startRealPostgres(): Promise<RealPostgres>` and the `RealPostgres` type, under those exact names.

There is no new test in this task. The tests are the 20 existing suites in these five packages, which must keep passing without being edited — that is the whole assertion.

- [ ] **Step 1: Record the messages before you touch anything**

```bash
grep -A4 'throw new Error(' packages/{credentials,scheduler,payments,payments-stripe,fiscal-verifactu}/src/testing/postgres.ts
```

Keep that output. Every string must survive character-for-character, including where the concatenation breaks across lines.

- [ ] **Step 2: Rewrite `packages/credentials/src/testing/postgres.ts`**

```ts
import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { CREDENTIALS_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both migration sets against it, core first — ordering
 * across packages is the runtime's responsibility and nothing enforces it, so it is explicit here.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The credentials RLS suite requires a running Docker daemon. It cannot be skipped: PGlite " +
      "runs every connection as a superuser, which bypasses row-level security and cannot " +
      "exercise the SECURITY DEFINER seam this suite exists to verify.",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS]),
  });
}
```

- [ ] **Step 3: Run this package's real-Postgres suite**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/credentials test`
Expected: PASS, with `git status` showing no test file modified.

- [ ] **Step 4: Rewrite `packages/scheduler/src/testing/postgres.ts`**

```ts
import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { SCHEDULER_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both migration sets against it, core first — ordering
 * across packages is the runtime's responsibility and nothing enforces it, so it is explicit here.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The scheduler's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite runs every connection as a superuser, which bypasses row-level security " +
      "and cannot exercise the concurrent claim races these suites exist to verify.",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS]),
  });
}
```

- [ ] **Step 5: Rewrite `packages/payments/src/testing/postgres.ts`**

The original doc comment has two paragraphs. The second explains why `connect()` returns a fresh
`Database` per call; that rationale now lives on `RealPostgres.connect` in `@waitron/db`, so it is
dropped here rather than duplicated. The first paragraph stays.

```ts
import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both packages' migrations against it, core first —
 * migration ordering across packages is the runtime's responsibility and nothing enforces it, so
 * the order is explicit here, exactly as `@waitron/db`'s own `CORE_MIGRATIONS`/`PAYMENTS_MIGRATIONS`
 * pairing is documented to require elsewhere in this package (migrations.test.ts).
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The payments RLS suite requires a running Docker daemon. It cannot be skipped: PGlite's " +
      "superuser bypasses row-level security, so it cannot exercise the grants and " +
      "tenant-isolation policies this suite exists to verify (see payments.rls.test.ts).",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS]),
  });
}
```

- [ ] **Step 6: Rewrite `packages/payments-stripe/src/testing/postgres.ts`**

This one imports `PAYMENTS_MIGRATIONS` from **`@waitron/payments`**, not `../migrations.js` — it has
no migration set of its own. Same doc-comment treatment as Step 5.

```ts
import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both packages' migrations against it, core first —
 * migration ordering across packages is the runtime's responsibility and nothing enforces it, so
 * the order is explicit here, exactly as `@waitron/db`'s own `CORE_MIGRATIONS`/`PAYMENTS_MIGRATIONS`
 * pairing is documented to require elsewhere in this package (migrations.test.ts).
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The payments-stripe RLS suite requires a running Docker daemon. It cannot be skipped: " +
      "PGlite's superuser bypasses row-level security, so it cannot exercise the grants and " +
      "tenant-isolation policies this suite exists to verify (see stripe.rls.test.ts).",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS]),
  });
}
```

- [ ] **Step 7: Rewrite `packages/fiscal-verifactu/src/testing/postgres.ts`**

Its doc comment's second paragraph — the "NEW `Database` per call … distinct backend processes"
argument — has moved onto `RealPostgres.connect` in `@waitron/db`, which now names
`chain.concurrency.test.ts` as the check that keeps it honest. Drop it here; keep the first.

```ts
import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { FISCAL_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both packages' migrations against it, core first —
 * migration ordering across packages is the runtime's responsibility and nothing enforces it, so
 * the order is explicit here, exactly as `@waitron/db`'s own `CORE_MIGRATIONS`/`FISCAL_MIGRATIONS`
 * pairing is documented to require elsewhere in this package (migrations.test.ts).
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The chain-append concurrency suite requires a running Docker daemon. It cannot be " +
      "skipped: PGlite cannot substitute for it (see " +
      "src/chain.pglite-cannot-test-contention.test.ts for why).",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, FISCAL_MIGRATIONS]),
  });
}
```

- [ ] **Step 8: Run all five packages' suites**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/scheduler --filter @waitron/payments --filter @waitron/payments-stripe --filter @waitron/fiscal-verifactu test
```

Expected: PASS. These are the RLS and concurrency suites — 20 of them across the five packages.

- [ ] **Step 9: Prove no test file moved**

```bash
git status --porcelain | grep -E '\.test\.ts$' && echo "VIOLATION: a test file changed" || echo "clean: only wrappers changed"
```

Expected: `clean`.

- [ ] **Step 10: Gate and commit**

```bash
pnpm lint && pnpm typecheck && pnpm format:check
git add -A
git commit -s -m "test: five packages' startRealPostgres becomes a wrapper over the shared helper

Each keeps its own verbatim Docker-required message and its own migration sets,
which are the only two things that ever differed. No call site changes, and all
five inherit the container-stop-on-failed-migration guard that only apps/server
had."
```

---

## Task 4: Convert `apps/server`'s wrapper

Separate from Task 3 because it is the one caller that does not use `runMigrationSets`: its suite migrates through the host's own production path on purpose, and it exports two extra symbols.

**Files:**
- Modify: `apps/server/src/testing/postgres.ts`

**Interfaces:**
- Consumes: `startMigratedPostgres`, `roleUrl`, `type RealPostgres` from `@waitron/db/testing/postgres.js`; `applyMigrations`, `manifestSets`, `migrationOptionsFor` from `../migrations.js`.
- Produces: `startRealPostgres()`, `roleUrl` and the `RealPostgres` type — all three are imported by `boot.test.ts` and must keep those names.

- [ ] **Step 1: Rewrite the file**

```ts
import { startMigratedPostgres, type RealPostgres } from "@waitron/db/testing/postgres.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "../migrations.js";

// Re-exported rather than re-implemented: `boot.test.ts` needs the connection STRING (to hand a
// spawned process its `DATABASE_URL`), not just a live `Database`.
export { roleUrl } from "@waitron/db/testing/postgres.js";
export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and migrates it through this host's OWN production path —
 * `applyMigrations` over `migrationOptionsFor(manifestSets(), null)`, advisory lock and manifest
 * included — rather than by running descriptor sets directly. That is the point: this package's
 * capstone suite exercises the composition the shipped artefact uses, so a manifest that drifts
 * from the packages' own migration folders fails here rather than at a customer's first boot.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "apps/server's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite runs every connection as a superuser, so it cannot show whether this " +
      "host works as the non-superuser deployment role.",
    // `applyMigrations` opens and closes its own connection from `uri` — see its doc comment in
    // `migrations.ts` — so there is no separate migrator `Database` to open or close here.
    migrate: (uri) => applyMigrations(uri, migrationOptionsFor(manifestSets(), null)),
  });
}
```

- [ ] **Step 2: Run the host's suites**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test`
Expected: PASS — 12 suites / 130 tests, including `boot.test.ts` and `pass.rls.test.ts`.

- [ ] **Step 3: Confirm `apps/server` still meets 100% on all four metrics**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS. (`src/testing/**` is excluded from this package's coverage, so the wrapper itself does not count — the point of the run is that nothing else regressed.)

- [ ] **Step 4: Gate and commit**

```bash
pnpm lint && pnpm typecheck && pnpm format:check
git add -A
git commit -s -m "test(server): the host's startRealPostgres becomes a wrapper too

It keeps migrating through applyMigrations + the manifest rather than a
descriptor list, which is why the shared helper takes migration as a callback.
roleUrl is re-exported, not re-implemented; boot.test.ts imports it by name."
```

---

## Task 5: `POSTGRES_IMAGE` and the second `CORE_MIGRATIONS`

**Files:**
- Create: `packages/db/src/migrations.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/testing/harness.ts`
- Modify: `packages/db/src/testing/postgres.test.ts` (one import path)
- Modify: `packages/db/src/client.test.ts`, `packages/db/src/migrate.test.ts`
- Modify: `apps/server/src/migrations.concurrency.test.ts`

**Interfaces:**
- Produces: `CORE_MIGRATIONS` from `@waitron/db/../migrations.js` internally and still from the `@waitron/db` barrel externally — no consumer's import changes.

- [ ] **Step 1: Extract `CORE_MIGRATIONS`**

Create `packages/db/src/migrations.ts` holding the constant and the entire doc comment currently above it in `src/index.ts`, plus one added sentence recording that `src/testing/harness.ts` now shares this definition instead of carrying its own:

```ts
import { fileURLToPath } from "node:url";

/**
 * This package's own migration set, in the same descriptor shape as
 * `packages/fiscal-verifactu`'s `FISCAL_MIGRATIONS` (Task 12). A module package composes its own
 * migrations with core's by running both descriptors, in order, against one database — ordering
 * is the RUNTIME's responsibility, never Drizzle's, so both halves of that composition are handed
 * out as plain data rather than as a function that would silently decide the order itself.
 *
 * `migrationsTable` matches `drizzle.config.ts`'s own `migrations.table` — `__drizzle_migrations_db`,
 * not Drizzle's bare default of `__drizzle_migrations`, which this package deliberately avoids so
 * that a consumer never confuses "the journal Drizzle would use if you forgot the option" with
 * "the journal this package actually uses".
 *
 * `src/testing/harness.ts` imports this rather than computing its own. It carried a private
 * duplicate under a comment saying this constant was "not exported" — true when written, false
 * since the barrel began exporting it. Same folder, same table, one definition.
 */
export const CORE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_db",
} as const;
```

`new URL("../drizzle", import.meta.url)` resolves from `src/`, exactly as it did in `index.ts` — the file moves within the same directory, so the path is unchanged.

- [ ] **Step 2: Re-export it from the barrel**

In `packages/db/src/index.ts`: delete the `import { fileURLToPath } from "node:url";` line, delete the `CORE_MIGRATIONS` const and its doc comment, and add beside the other re-exports:

```ts
export { CORE_MIGRATIONS } from "./migrations.js";
```

- [ ] **Step 3: Run the barrel's own test**

Run: `pnpm --filter @waitron/db exec vitest run src/index.test.ts`
Expected: PASS — the barrel's surface is unchanged, which is what that suite checks.

- [ ] **Step 4: Collapse `harness.ts`'s private duplicate**

In `packages/db/src/testing/harness.ts`: delete the private `CORE_MIGRATIONS` const and its "Not exported" comment, delete the now-unused `import { join } from "node:path";`, and import instead:

```ts
import { CORE_MIGRATIONS } from "../migrations.js";
import { POSTGRES_IMAGE } from "./postgres.js";
```

Then replace `new PostgreSqlContainer("postgres:18-alpine")` with `new PostgreSqlContainer(POSTGRES_IMAGE)`.

`postgres.ts` imports from `../client.js` and `../migrate.js` only, so this introduces no cycle.

- [ ] **Step 5: Point the new test at the new module**

In `packages/db/src/testing/postgres.test.ts`, change `import { CORE_MIGRATIONS } from "../index.js";` to `import { CORE_MIGRATIONS } from "../migrations.js";` — a leaf module should not pull the whole barrel.

- [ ] **Step 6: Sweep the remaining image literals**

In `packages/db/src/client.test.ts` and `packages/db/src/migrate.test.ts`, add `import { POSTGRES_IMAGE } from "./testing/postgres.js";` and use it in place of the literal.

In `apps/server/src/migrations.concurrency.test.ts`, add `import { POSTGRES_IMAGE } from "@waitron/db/testing/postgres.js";` and do the same.

`bench/pglite-throughput/src/bench.ts` keeps its literal — it is a standalone benchmark, not a suite, and adding a dependency to share a string is a bad trade.

- [ ] **Step 7: Verify the sweep landed**

```bash
git grep -l '"postgres:18-alpine"' | sort
```

Expected exactly two files: `packages/db/src/testing/postgres.ts` and `bench/pglite-throughput/src/bench.ts`.

- [ ] **Step 8: Run the affected packages and commit**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test
pnpm lint && pnpm typecheck && pnpm format:check
git add -A
git commit -s -m "refactor(db): one CORE_MIGRATIONS, one image tag

harness.ts carried a second CORE_MIGRATIONS under a comment claiming the
constant was not exported — true when written, false since the barrel began
exporting it. Both now come from src/migrations.ts, and the image tag has one
definition instead of ten."
```

---

## Task 6: Drop the dead devDependencies, correct the false comment, verify the whole thing

**Files:**
- Modify: `packages/credentials/package.json`, `packages/scheduler/package.json`, `packages/payments/package.json`, `packages/payments-stripe/package.json`, `packages/fiscal-verifactu/package.json`
- Modify: `pnpm-lock.yaml` (regenerated)
- Modify: `packages/fiscal-verifactu/src/registro-sif.ts`

- [ ] **Step 1: Prove the dependency really is dead in all five**

```bash
grep -rl "@testcontainers" --include='*.ts' packages/{credentials,scheduler,payments,payments-stripe,fiscal-verifactu}/src
```

Expected: only `packages/fiscal-verifactu/src/registro-sif.ts`, and only inside a comment. If any
`.ts` file still *imports* it, stop — a wrapper was missed in Task 3.

- [ ] **Step 2: Remove the five declarations**

Delete the `"@testcontainers/postgresql": "^12.0.4",` line from each of those five `package.json`
files' `devDependencies`. **Do not touch** `apps/server/package.json` (its
`migrations.concurrency.test.ts` starts a container directly) or `packages/db/package.json` (it now
owns the only shared use).

- [ ] **Step 3: Regenerate the lockfile**

```bash
pnpm install
git diff --stat pnpm-lock.yaml
```

Expected: `pnpm-lock.yaml` changes; no package.json other than the five is touched.

- [ ] **Step 4: Correct the comment that inverts both of its facts**

`packages/fiscal-verifactu/src/registro-sif.ts` currently reads:

> `This package has no real-Postgres test target — unlike packages/db, it does not depend on @testcontainers/postgresql — so no test in this suite asserts the concurrent case directly;`

Both halves are false: this package has five real-Postgres suites, and it declared the dependency
until Step 2. Replace that clause so the sentence reads:

```ts
 * there by accident (see allocate-number.test.ts's identical `it.runIf(target.name ===
 * "postgres")` gate). This package does have real-Postgres suites — they reach a container through
 * `@waitron/db/testing/postgres.js` — but none of them exercises THIS function's concurrent case
 * directly; it is covered structurally instead, by using the exact same single-statement
 * shape `allocate-number.ts` uses, proven under real contention there.
```

Check the surrounding lines still read correctly and re-wrap to the file's existing width.

- [ ] **Step 5: Run the mutation resolver check**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db exec stryker run --mutate "src/testing/seed.ts"
```

Expected: the run completes. The mutation score is not the point — this is the fourth resolver, and
what is being bought is "Stryker resolves the new module and its imports". If it is slow, let it
finish; if it fails on resolution, that is a real finding.

- [ ] **Step 6: Run the spec's §8 mechanical checks**

```bash
git grep -l "PostgreSqlContainer" -- '*.ts' '*.mjs' '*.js' | sort   # expect 5 files
git grep -c "startRealPostgres()" -- '*.test.ts' | wc -l   # expect 22 test files
git status --porcelain | grep -cE '\.test\.ts$'     # expect 0 modified test files vs Task 1's baseline
```

The five files: `packages/db/src/testing/postgres.ts`,
`packages/db/src/client.test.ts`, `packages/db/src/migrate.test.ts`,
`apps/server/src/migrations.concurrency.test.ts`, `bench/pglite-throughput/src/bench.ts`.

- [ ] **Step 7: Run the full gate exactly as CI will**

```bash
pnpm lint
pnpm typecheck
pnpm format:check
TESTCONTAINERS_RYUK_DISABLED=true pnpm test:coverage
```

All four must pass. `test:coverage` is the long one (~6 minutes in CI, longer locally with every
container start).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -s -m "chore: drop five dead testcontainers devDependencies, correct one false comment

The five wrappers no longer import @testcontainers/postgresql — the shared
helper resolves it from @waitron/db. apps/server and db keep theirs.

registro-sif.ts claimed this package has no real-Postgres test target and does
not depend on testcontainers. It has five, and it did. Removing the declaration
would have made one clause accidentally true while the other stayed wrong."
```

---

## Verification summary

| Claim | How it is checked | Where |
| --- | --- | --- |
| The `exports` map resolves under all four resolvers | typecheck, lint, cross-package vitest, bounded Stryker | Task 1 Step 7, Task 6 Step 5 |
| No test that calls `startRealPostgres` was edited | `git status --porcelain \| grep '\.test\.ts$'` | Task 3 Step 9, Task 6 Step 6 |
| Six copies are gone, not thinned | `git grep -l "PostgreSqlContainer" -- '*.ts'` → 5 files | Task 6 Step 6 |
| The Docker-required messages survived verbatim | Task 3 Step 1's captured `grep` vs the final files | Task 3 |
| The two previously-untested failure paths have tests | `postgres.test.ts` fake-container blocks | Task 2 |
| `@waitron/db` still meets 98/98/98/95 with the new files | `pnpm --filter @waitron/db test:coverage` | Tasks 2, 5 |
| Nothing else regressed | `pnpm test:coverage` at the root | Task 6 Step 7 |
| Every commit is signed off | `git log --format='%(trailers:key=Signed-off-by)' main..HEAD` | before opening the PR |

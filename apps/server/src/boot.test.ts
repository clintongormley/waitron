import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";
import { captureError, stampDeployment, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { isAppError } from "@waitron/shared";
import { loadKeyRing, putCredential } from "@waitron/credentials";
// The exact test-only entry point `packages/fiscal-verifactu`'s OWN tests use to seed a due
// `envios` row — mirroring the established cross-package convention (e.g.
// `@waitron/payments/test/seed.js` from `packages/payments-stripe`'s suites): no `exports` map
// restricts either package, so the deep import resolves the same way a same-package one would.
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { runSyncPull } from "@waitron/sync";
import {
  DEFAULT_MIGRATIONS_ROOT,
  MAX_UPLOAD_BYTES,
  startServer,
  type StartedServer,
} from "./boot.js";
import { DUTY_BUDGET_MS } from "./health.js";
import { DRAIN_DUTY } from "./pass.js";
import { roleUrl, startRealPostgres } from "./testing/postgres.js";
import { mintMtlsMaterial } from "./testing/tls.js";

/**
 * F4 (2026-07-27 fix wave): the ONE test below that provisions a tenant with a usable
 * `fiscal.aeat` credential needs `resolveClient` (`aeat-transport.ts`) to actually build a real
 * mTLS `Agent`, so `closeAll` has something genuine to release — but `startServer` takes only
 * `env`, with no seam to point `aeatEndpointFor`/`mtlsFetch` at a local test double the way
 * `aeat-transport.test.ts`'s own suite does directly against `aeatClientResolver`. The only other
 * route to a real endpoint is AEAT's actual preproduction host — reachable from this sandbox, but
 * not something an automated suite should be dialling on every run. Module-mocking `undici`'s
 * `fetch` keeps the resulting SOAP POST from ever leaving this process; `Agent` is spread through
 * untouched, so `mtlsFetch` (aeat-transport.ts, unmodified) still constructs a genuine per-tenant
 * TLS connection pool for that test's `Agent.prototype.close` spy to observe. Confirmed this does
 * not affect any OTHER test in this file: none of them seed a usable `fiscal.aeat` credential
 * (boot.ts's own comment on its `drain` closure), so `resolveClient` never reaches `mtlsFetch` for
 * any tenant but this one, and the plain global `fetch(...)` calls this file uses against its own
 * local `/health` server resolve through Node's OWN built-in fetch, a separate module identity
 * from the `"undici"` npm package specifier this mock intercepts.
 */
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(
        new Error("undici fetch disabled in boot.test.ts — see this file's own header comment"),
      ),
    ),
  };
});

/**
 * `boot.ts` starts the background pull worker via `runSyncPull`, imported directly (no injection seam).
 * The worker is robust by construction — its loop catches every per-peer error and backs off, so no
 * config makes its return promise reject — yet close()'s teardown ordering must survive a worker that
 * settles by rejection anyway (an unexpected throw escaping the loop). The ONE test that pins that path
 * forces the settle by mocking `runSyncPull`'s return; the default here calls THROUGH to the real
 * implementation, so every other test in this file (the live-worker sync test included) drives the
 * genuine loop unchanged — only the rejection test overrides it, with `mockReturnValueOnce`. Spreading
 * `...actual` keeps `encodeBatch`/`readSyncLogSince` (used by `sync-api.ts` in this same graph) real.
 */
vi.mock("@waitron/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/sync")>();
  return { ...actual, runSyncPull: vi.fn(actual.runSyncPull) };
});

/**
 * `startServer`'s only test subject. Everything else in this package tests one composed piece
 * (`pass.rls.test.ts` builds its own, separate wiring to prove the composed PASS runs as the
 * deployment role); nothing before this file called `startServer` itself, so the field mapping in
 * `boot.ts` — `config.scheduler.*` into `SchedulerDeps`, `minTickMs`/`maxTickMs`, `onPass` into
 * `recordPass`, the `settlementLagMs` conditional spread, the migrations-root default, and the
 * whole `close()` sequence — had no test at all.
 *
 * A passing pass alone does not pin `minTickMs`/`maxTickMs`: `loop.ts` runs the first pass before
 * any sleep, so a swapped or defaulted mapping in `boot.ts` would still let a pass complete and
 * `/health` come back `200`. The first test below additionally captures the real, hardcoded stdout
 * `boot.ts` logs to (deliberately not injectable — see its own doc comment) and asserts the logged
 * `loop.sleeping` line's `sleepMs`, which `sleepMsFor` derives from `maxTickMs` alone whenever
 * nothing is due — exactly this suite's own case, with zero tenants enrolled for either duty.
 *
 * `DATABASE_URL` is the deployment role, not the container's superuser default (`pg.connect()`'s
 * role): spec §10 states plainly that `DATABASE_URL` "must be the non-superuser deployment role".
 * Whether that role ALSO needs migration-grade grants depends on `WAITRON_MIGRATIONS_DATABASE_URL`
 * (config.ts): unset, it defaults to `DATABASE_URL`, so migrations run under the same role the pool
 * uses, and that role needs `CREATE` on top of `app_user`'s grants — not `app_user`'s grants alone.
 * `PROBE_ROLE` below is exactly that: `app_user` membership for the RLS-scoped duty work, plus the
 * `CREATE`/`SELECT` Drizzle's migrator needs to re-run idempotently against an already-migrated
 * database — confirmed empirically that Postgres checks each privilege before Drizzle's own
 * `IF NOT EXISTS` existence check ever runs, so a role with only `app_user`'s `USAGE` grant fails on
 * the very first `CREATE SCHEMA IF NOT EXISTS "public"`, no-op or not. The first two tests below use
 * `PROBE_ROLE` this way — as `DATABASE_URL` alone, `WAITRON_MIGRATIONS_DATABASE_URL` unset — which is
 * also that variable's DEFAULT case and therefore the one every existing deployment keeps until it
 * opts into the split.
 *
 * `RUNTIME_ROLE`, below, is the OTHER case: the genuinely least-privileged role spec §10 actually
 * names, carrying only `app_user` membership and NONE of `PROBE_ROLE`'s extra `CREATE`/`SELECT`
 * grants. It cannot run a migration against an already-migrated database — the same permission-
 * denied-before-IF-NOT-EXISTS finding above applies to it too — which is what makes it able to prove
 * the split: a test that boots with `DATABASE_URL` set to `RUNTIME_ROLE` and
 * `WAITRON_MIGRATIONS_DATABASE_URL` set to `PROBE_ROLE` succeeds only because `applyMigrations` runs
 * over the SECOND connection string, never the pool's own.
 */
const PROBE_ROLE = "server_boot_probe";
const PROBE_PASSWORD = "probe";
const RUNTIME_ROLE = "server_boot_runtime_probe";
const RUNTIME_PASSWORD = "probe";
// The till's fiscal identity, now REQUIRED by `loadConfig` (it resolves `config.till` via
// `loadTillConfig`). Distinct per field, matching till-config.test.ts's convention. Folded into
// `KEY_ENV` below so every real-host boot in this suite carries one; the two config-guard tests at
// the bottom, which omit `KEY_ENV` on purpose to reach `credentials.key_missing`, spread it directly.
// A minimal tenant + location for these ids IS seeded in `beforeAll` — `startServer` now reads the
// till's pay-timing mode from its location at boot (`readOrderFlow`, Task 8), so the location must
// exist for a successful boot. No staff are seeded, so `GET /api/staff` still returns `[]`.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};
// Every successful boot in this suite writes its media directory here (an existing temp dir, so the
// recursive `mkdirSync` boot performs is a no-op) rather than into `boot.ts`'s own default — which,
// run from SOURCE, resolves to `apps/server/src/media` and would pollute the checkout on every run.
// Created synchronously so the `KEY_ENV` const below can reference it; torn down in `afterAll`.
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-boot-media-"));
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  ...TILL_ENV,
};

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: 180_000,
});

let migrationsRoot: string;
let databaseUrl: string;
let runtimeDatabaseUrl: string;

beforeAll(async () => {
  const dbName = new URL(suite.pg.uri).pathname.replace(/^\//, "");
  // `CREATE` on the database and on `public`: Drizzle's migrator issues `CREATE SCHEMA IF NOT
  // EXISTS "public"` (database-level `CREATE`) then `CREATE TABLE IF NOT EXISTS` per migration set
  // (schema-level `CREATE`) before it ever checks whether either already exists.
  await suite.admin.execute(sql.raw(`grant create on database ${dbName} to ${PROBE_ROLE}`));
  await suite.admin.execute(sql.raw(`grant create on schema public to ${PROBE_ROLE}`));
  // `SELECT` on every table in `public`, not just the five journal tables by name: `startRealPostgres`
  // already applied every migration as the container's superuser, so the deployment role does not
  // OWN the journal tables it must read back from to decide nothing new needs applying.
  await suite.admin.execute(
    sql.raw(`grant select on all tables in schema public to ${PROBE_ROLE}`),
  );

  databaseUrl = roleUrl(suite.pg.uri, PROBE_ROLE, PROBE_PASSWORD);

  // No `CREATE`, no `SELECT` on the journal tables — `app_user` membership and nothing else, the
  // role spec §10 actually means by "the non-superuser deployment role". It can do the duty work
  // (drain/reconcile read and write through `app_user`'s own table grants, applied by the migrations
  // themselves) but cannot run a migration against an already-migrated database, for the identical
  // permission-denied-before-`IF NOT EXISTS` reason `PROBE_ROLE`'s own comment above explains.
  await suite.admin.execute(
    sql.raw(`create role ${RUNTIME_ROLE} login password '${RUNTIME_PASSWORD}' in role app_user`),
  );
  runtimeDatabaseUrl = roleUrl(suite.pg.uri, RUNTIME_ROLE, RUNTIME_PASSWORD);

  // The till's own tenant + location, seeded once as the container superuser (RLS bypassed, exactly as
  // `seedTenant`/`seedNode` do). `startServer` reads the location's `order_flow` at boot
  // (`readOrderFlow`, Task 8) to complete the `TillConfig` it hands the routes, so the location must
  // exist or every successful-boot test would fail at that read. `order_flow` defaults to `prepay`. A
  // distinctive NIF (90M base) stays clear of every other seed generator sharing this database.
  await suite.admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'ES', '90000000K', 'Boot Till SL')`);
  await suite.admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Barra',
            array['es-ES'], 'Venta en establecimiento')`);

  // `boot.ts`'s own default migrations root is `<dirname of boot.ts>/drizzle` — under source (this
  // test, not the bundle) that resolves to `apps/server/src/drizzle`, which does not exist; only
  // `scripts/copy-migrations.mjs` builds that layout, and only beside `dist/server.js`. Mirroring
  // that script here (real journal content, not the synthetic `{}` fixture `migrations.test.ts`
  // uses for the RESOLUTION-only cases) is what lets `WAITRON_MIGRATIONS_DIR` point `startServer`'s
  // own `applyMigrations` at something that actually exists, run from source.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-boot-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
}, 180_000);

// The temporary migrations root is this suite's own; the container and `suite.admin` are
// `useRealPostgres`'s. Guarded the same way: a `beforeAll` that threw before `mkdtemp` returned
// must not be followed by an `rm(undefined)` reported as a second failure beside the real one.
afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  // `MEDIA_ROOT` is created synchronously at module load (always defined), so no undefined guard —
  // `force: true` also absorbs the case where a boot's own nested subdir was already removed.
  await rm(MEDIA_ROOT, { recursive: true, force: true });
});

/** An OS-assigned port, released before use. `WAITRON_HTTP_PORT` rejects `"0"` as not a positive
 * integer (config.test.ts pins that on purpose — see loadConfig's `positiveInt`), so this test
 * cannot ask the host itself to bind an ephemeral port; asking the OS directly and handing back a
 * real number is the same "let the OS assign one" idea without touching that validation. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * Polls `predicate` up to `POLL_TRIES` times, `POLL_INTERVAL_MS` apart, returning its first
 * defined result, or `undefined` once the budget is spent. The budget (200 x 50ms = 10s) lives
 * here once for `waitForPass`, `waitForExit` and `waitForEvent` below, all three of which are
 * waiting on the same background loop but differ in what they're waiting for — each raises its
 * own assertion or error on an `undefined` result so the failure message stays specific to that.
 */
const POLL_TRIES = 200;
const POLL_INTERVAL_MS = 50;

async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < POLL_TRIES; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(POLL_INTERVAL_MS);
  }
  return undefined;
}

async function waitForPass(state: { lastPassAt: Date | null }): Promise<void> {
  await poll(() => state.lastPassAt ?? undefined);
  expect(state.lastPassAt).not.toBeNull();
}

/** `boot.ts`'s listen-failure handler now calls `process.exit` from `process.stdout.write`'s own
 * completion callback, not synchronously right after logging (see its own comment — exiting before
 * the write actually went out risked truncating the line on a piped stdout). That callback fires on
 * a later tick than the synchronous `lines.push` `withCapturedStdout`'s mock does, so a test that
 * found the `server.listen_failed` line and immediately asserted on `exits` could observe it still
 * empty — this polls for the exit call via the same `poll` helper `waitForPass` builds on, rather
 * than assuming an ordering the fix deliberately no longer guarantees synchronously. */
async function waitForExit(exits: readonly (number | undefined)[]): Promise<void> {
  await poll(() => (exits.length === 0 ? undefined : exits.length));
  expect(exits.length).toBeGreaterThan(0);
}

interface LogLine {
  event: string;
  [key: string]: unknown;
}

/**
 * `boot.ts` hardcodes `process.stdout.write` as its log sink (deliberately — see its own doc
 * comment: no test-only injection seam in production code), so this is the only way to observe what
 * it actually logs. Every chunk is still forwarded to the real writer, so nothing else watching this
 * process's output — including vitest's own reporter — sees anything different; only `fn` sees the
 * captured lines, via the array handed to it, live as they arrive.
 */
async function withCapturedStdout<T>(fn: (lines: string[]) => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    lines.push(...String(chunk).split("\n").filter(Boolean));
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    return await fn(lines);
  } finally {
    process.stdout.write = original;
  }
}

/**
 * `boot.ts`'s listen-failure handler calls `process.exit(1)` directly — the identical hardcoded-sink
 * design `withCapturedStdout` above already works around for stdout, applied to the one other real
 * side effect this file needs to observe without letting it actually kill the vitest worker. Every
 * call is recorded rather than silently swallowed, so a test can assert exactly how many times, and
 * with what code, `startServer` decided to exit.
 */
async function withMockedExit<T>(fn: (exits: (number | undefined)[]) => Promise<T>): Promise<T> {
  const original = process.exit;
  const exits: (number | undefined)[] = [];
  process.exit = ((code?: number) => {
    exits.push(code);
    return undefined as never;
  }) as typeof process.exit;
  try {
    return await fn(exits);
  } finally {
    process.exit = original;
  }
}

/** The first captured line naming `event`, waiting for it to arrive rather than assuming it already
 * has — `lines` is being appended to concurrently by the loop running in the background. */
async function waitForEvent(lines: readonly string[], event: string): Promise<LogLine> {
  const found = await poll(() => {
    for (const line of lines) {
      let parsed: LogLine | undefined;
      try {
        parsed = JSON.parse(line) as LogLine;
      } catch {
        continue; // Not a JSON line — this logger only ever writes JSON, but don't assume it here.
      }
      if (parsed.event === event) return parsed;
    }
    return undefined;
  });
  if (found === undefined) {
    throw new Error(
      `expected a "${event}" log line within the wait window, saw: ${lines.join("\n")}`,
    );
  }
  return found;
}

describe("startServer, against a real container as the deployment role", () => {
  it("boots, pins the tick-clamp mapping, folds settlementLagMs, threads environment, runs a pass, serves /health and shuts down cleanly", async () => {
    const port = await freePort();
    const [server, sleeping, listening] = await withCapturedStdout(async (lines) => {
      const started = await startServer({
        ...KEY_ENV,
        DATABASE_URL: databaseUrl,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        // Distinctive and far apart on purpose: a swapped minTickMs/maxTickMs mapping in boot.ts
        // would make the assertion below see 1000, not 94327 — the two values must not be
        // confusable with each other, or with sleepMsFor's own clamp bounds by coincidence.
        WAITRON_MIN_TICK_MS: "1000",
        WAITRON_MAX_TICK_MS: "94327",
        // Within [minTickMs, maxTickMs] only to satisfy `loadConfig`'s guard (F1 of the 2026-07-27
        // pre-merge review) — zero tenants are enrolled for either duty below, so neither drain nor
        // reconcile ever reports a skip, and this value plays no part in `sleeping.sleepMs` below.
        WAITRON_SKIP_RETRY_MS: "9000",
        WAITRON_SETTLEMENT_LAG_MS: "1000",
        // Set explicitly to the NON-default value: `config.test.ts` already proves `loadConfig`
        // parses this correctly, and `preproduction` is both the default AND what a silently
        // hardcoded `aeatEndpointFor` argument would also produce, so leaving this unset here would
        // assert nothing I4 didn't already have. "production" only appears on the logged line below
        // if `config.environment` genuinely reached `boot.ts`'s runtime, not merely `loadConfig`'s
        // return value in isolation.
        WAITRON_ENV: "production",
      });
      // loop.ts logs "loop.sleeping" strictly AFTER onPass runs (its own source order, no await in
      // between), so finding this line is also proof the first pass — and onPass -> recordPass —
      // already completed, not just evidence about the sleep duration.
      const event = await waitForEvent(lines, "loop.sleeping");
      const listeningEvent = await waitForEvent(lines, "server.listening");
      return [started, event, listeningEvent] as const;
    });

    try {
      // `sleepMsFor(null, now, minTickMs, maxTickMs)` returns `maxTickMs` verbatim (loop.ts) — and
      // with zero tenants enrolled for either duty, both drain and reconcile report `nextDueAt:
      // null`, which is exactly this branch. So the logged sleepMs pins config.maxTickMs -> LoopDeps
      // .maxTickMs -> sleepMsFor end to end; it is 94327 only if boot.ts's mapping is not swapped.
      expect(sleeping.sleepMs).toBe(94327);

      // I4: `aeatEndpointFor(config.environment)` is the one config value spec §10 calls irreversible
      // (production numbering can never be reused), and nothing observed it reaching `boot.ts` at
      // all before this assertion — a hardcoded `aeatEndpointFor("production")` would have passed
      // every other test in the repository. This does not observe the endpoint the resolver itself
      // selects (that needs a seeded `fiscal.aeat` credential and due `envios` work, which this
      // suite deliberately has none of — see the 2026-07-27 addendum to the server-host spec §14),
      // but it does prove `config.environment` is not silently dropped between `loadConfig` and the
      // log line `aeatClientResolver` is built from the same config field beside.
      expect(listening.environment).toBe("production");
      expect(listening.port).toBe(port);

      expect(server.health.startedAt).toBeInstanceOf(Date);
      expect(server.health.lastPassAt).not.toBeNull();
      // `onPass` -> `recordPass` ran: with zero tenants enrolled for either duty, the pass still
      // reports both as `ok`, which is what flips /health to 200 below.
      expect(
        Object.values(server.health.duties).every((duty) => duty.consecutiveFailures === 0),
      ).toBe(true);

      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // The till API is mounted on the same app (`mountTillApi` in `boot.ts`). `GET /api/staff` is
      // the unauthenticated roster route — it needs no session: under RLS scoped to this till's own
      // tenant (seeded minimally in `beforeAll`, with NO staff) it returns an empty array rather than
      // 404, which is the proof the route exists. A 404 here would mean `mountTillApi` never ran.
      const staff = await fetch(`http://127.0.0.1:${port}/api/staff`);
      expect(staff.status).toBe(200);
      expect(await staff.json()).toEqual([]);

      // The catalogue write group is mounted on the same app (`mountCatalogueApi` in `boot.ts`). It is
      // fully gated, so an UNAUTHENTICATED `GET /management-api/catalogues` answers 401
      // (`management_session.required`) rather than 404 — a 404 here would mean the mount never ran.
      const catalogues = await fetch(`http://127.0.0.1:${port}/management-api/catalogues`);
      expect(catalogues.status).toBe(401);
      expect((await catalogues.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });
    } finally {
      await server.close();
    }

    // A second, concurrent-in-effect close() (the previous one already resolved, but the guard
    // covers this "already closed" case identically to a genuinely racing pair) must not throw
    // pg-pool's "Called end on pool more than once" — the idempotency guard this task added.
    await expect(server.close()).resolves.toBeUndefined();

    // The listener actually closed: a request against the same port now fails to connect rather
    // than hanging or succeeding against a server that never really stopped.
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  }, 60_000);

  it("mounts the node-token sync API and starts the pull worker when WAITRON_SYNC_* is configured", async () => {
    // The sync transport is enabled by WAITRON_SYNC_PEERS. The peer URL is unreachable, so the pull
    // worker's one handshake attempt goes through fetchHttpClient (undici's fetch, MOCKED to reject in
    // this file) and the peer backs off — which is all this test needs from the worker: it exercises
    // the production HttpClient adapter and the boot wiring without a second live node. /sync-api/hello
    // (no DB) proves mountSyncApi ran with this node's till.nodeId; a tokenless request proves the
    // fail-closed middleware is live. The sync DB URL reuses the deployment role: /hello needs no DB
    // and the worker never reaches a sync_log read (it fails at the peer handshake first). close() must
    // tear the worker + pool down alongside the main loop.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_SYNC_PEERS: JSON.stringify([
        {
          nodeId: "66666666-6666-4666-8666-666666666666",
          url: "http://127.0.0.1:1/",
          token: "peer-token",
        },
      ]),
      WAITRON_SYNC_NODE_TOKEN: "boot-node-token",
      WAITRON_SYNC_DATABASE_URL: databaseUrl,
    });
    try {
      const hello = await fetch(`http://127.0.0.1:${port}/sync-api/hello`, {
        headers: { Authorization: "Bearer boot-node-token" },
      });
      expect(hello.status).toBe(200);
      expect(await hello.json()).toEqual({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        environment: "production",
      });
      // A tokenless request is refused — the fail-closed middleware, not just the route, is live.
      const unauth = await fetch(`http://127.0.0.1:${port}/sync-api/hello`);
      expect(unauth.status).toBe(401);
      // Give the pull worker a beat to make its (failing) peer handshake, exercising fetchHttpClient.
      await delay(100);
    } finally {
      await server.close();
    }
    await expect(fetch(`http://127.0.0.1:${port}/sync-api/hello`)).rejects.toThrow(); // listener gone
  }, 60_000);

  it("close() swallows a REJECTING pull worker and still tears down the listener and pools", async () => {
    // Teardown-ordering fix: close() used to `await syncWorker` BEFORE the try/finally that guarantees
    // server.close() + the pool teardown, so a worker that settled by rejection threw out of close()
    // there and leaked the HTTP server and both connection pools. Force exactly that settle: a
    // pre-rejected worker promise returned once from the mocked runSyncPull. It carries its OWN benign
    // `.catch` so it is never an unhandled rejection in the window before close() attaches its swallowing
    // catch. Two directions differ visibly (CLAUDE.md §1): without the fix close() REJECTS with this
    // error and the listener stays up; with it close() RESOLVES and the listener is gone.
    const port = await freePort();
    const workerBoom = new Error("sync pull worker rejected");
    const rejectedWorker = Promise.reject(workerBoom);
    rejectedWorker.catch(() => {}); // handled here, so never an unhandled rejection pre-close()
    vi.mocked(runSyncPull).mockReturnValueOnce(rejectedWorker);

    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_SYNC_PEERS: JSON.stringify([
        {
          nodeId: "77777777-7777-4777-8777-777777777777",
          url: "http://127.0.0.1:1/",
          token: "peer-token",
        },
      ]),
      WAITRON_SYNC_NODE_TOKEN: "boot-node-token",
      WAITRON_SYNC_DATABASE_URL: databaseUrl,
    });

    // The listener is up before close(): the sync source mounted and bound.
    const hello = await fetch(`http://127.0.0.1:${port}/sync-api/hello`, {
      headers: { Authorization: "Bearer boot-node-token" },
    });
    expect(hello.status).toBe(200);

    // close() RESOLVES despite the worker rejection (the swallow), and the guaranteed teardown ran: the
    // listener is gone — which it could only be if close() got PAST the swallowed worker await into the
    // try (server.close), whose finally then closed both the app pool and the sync pool.
    await expect(server.close()).resolves.toBeUndefined();
    await expect(fetch(`http://127.0.0.1:${port}/sync-api/hello`)).rejects.toThrow();
  }, 60_000);

  it("boots without WAITRON_SETTLEMENT_LAG_MS, taking the neutral layer's own default", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      // Within [minTickMs, maxTickMs]: the default (300000) sits above maxTickMs here and would
      // now fail `loadConfig`'s guard (F1 of the 2026-07-27 pre-merge review).
      WAITRON_SKIP_RETRY_MS: "100",
    });

    try {
      await waitForPass(server.health);
    } finally {
      // Two GENUINELY concurrent calls this time, not one-after-the-other: without the idempotency
      // guard, the loser reaches `db.close()` a second time and throws.
      await Promise.all([server.close(), server.close()]);
    }
  }, 60_000);

  // The upload/serve routes (later slices) store product images under `config.mediaDir`; `boot.ts`
  // must ensure that directory exists once, at startup, before mounting anything — a missing store
  // would fail the first upload rather than the boot. Proven by behaviour, not by mocking: point
  // `WAITRON_MEDIA_DIR` at a nested path that does NOT exist yet, boot, and assert `existsSync`
  // flipped false -> true — proof the recursive `mkdirSync` ran with this resolved, absolute
  // mediaDir, not merely that some directory happened to be present already.
  it("ensures the configured media directory exists at boot (recursive), and serves it from the public /media route", async () => {
    const port = await freePort();
    const mediaDir = join(MEDIA_ROOT, "created-at-boot", "product-images");
    expect(existsSync(mediaDir)).toBe(false);
    expect(isAbsolute(mediaDir)).toBe(true);

    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      // Overrides KEY_ENV's own MEDIA_ROOT with the fresh nested path this test asserts on.
      WAITRON_MEDIA_DIR: mediaDir,
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });

    try {
      // `startServer` resolves only after the mkdir (which runs before the first pass), so the
      // directory is already present the moment the boot returns — no polling needed.
      expect(existsSync(mediaDir)).toBe(true);

      // `mountMedia` is on the SAME app, wired to `config.mediaDir` (this very dir). Drop a
      // content-hash-shaped file into it and fetch it back through the public serve route: a 200 with
      // the right bytes and Content-Type is the proof the mount ran AND reads from `config.mediaDir` —
      // a plain nonexistent route would answer Hono's own 404, so only a 200 distinguishes the two.
      const imageName = "a".repeat(64) + ".png";
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await writeFile(join(mediaDir, imageName), imageBytes);
      const image = await fetch(`http://127.0.0.1:${port}/media/${imageName}`);
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(imageBytes);

      // A traversal attempt is refused by the mounted route's own regex guard — a bare 404, from a
      // real boot, not just the in-process suite.
      const escape = await fetch(
        `http://127.0.0.1:${port}/media/${encodeURIComponent("../../etc/passwd")}`,
      );
      expect(escape.status).toBe(404);
    } finally {
      await server.close();
    }
  }, 60_000);

  // C1: the host cannot start under the role spec §10 actually names unless migrations run under a
  // DIFFERENT connection than the pool. This is that claim, proven rather than asserted in prose: if
  // `boot.ts` reverted to applying migrations over `config.databaseUrl` (or the pool opened from
  // it), `RUNTIME_ROLE` — which has no `CREATE` grant at all — would fail on Drizzle's own
  // `CREATE SCHEMA IF NOT EXISTS "public"` before this test's `waitForPass` ever saw a first pass.
  it("boots with a least-privileged DATABASE_URL when migrations run under a separate WAITRON_MIGRATIONS_DATABASE_URL", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: runtimeDatabaseUrl,
      WAITRON_MIGRATIONS_DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      // Within [minTickMs, maxTickMs]: the default (300000) sits above maxTickMs here and would
      // now fail `loadConfig`'s guard (F1 of the 2026-07-27 pre-merge review).
      WAITRON_SKIP_RETRY_MS: "100",
    });
    try {
      await waitForPass(server.health);
      // The pool itself is on `RUNTIME_ROLE`: a pass that reached `ok` proves the duty work (reading
      // `credential_tenants`/`envios_tenants_with_work` through their SECURITY DEFINER seams, and
      // `runDue`'s own `scheduled_runs` reads) also succeeds under `app_user` membership alone, with
      // none of `PROBE_ROLE`'s extra migration-only grants.
      expect(
        Object.values(server.health.duties).every((duty) => duty.consecutiveFailures === 0),
      ).toBe(true);
    } finally {
      await server.close();
    }
  }, 60_000);

  // I5 / I7: a bind failure must log a structured code and exit non-zero (spec §8's "everything
  // escapes" applied to the one boot failure that cannot literally throw — see boot.ts's own
  // comment on `server.on("error", ...)`), and `WAITRON_HTTP_HOST` must actually reach `serve()`'s
  // `hostname` option rather than being computed by `loadConfig` and then silently dropped.
  describe("a listener that fails to bind", () => {
    it("logs server.listen_failed and exits(1) on EADDRINUSE — the common case, a fixed port already taken", async () => {
      const port = await freePort();
      const occupied = createServer();
      await new Promise<void>((resolve, reject) => {
        occupied.once("error", reject);
        occupied.listen(port, "127.0.0.1", () => resolve());
      });

      await withMockedExit(async (exits) => {
        let started: StartedServer | undefined;
        try {
          const [server, failure] = await withCapturedStdout(async (lines) => {
            const s = await startServer({
              ...KEY_ENV,
              DATABASE_URL: databaseUrl,
              WAITRON_HTTP_PORT: String(port),
              WAITRON_MIGRATIONS_DIR: migrationsRoot,
              WAITRON_MIN_TICK_MS: "1000",
              WAITRON_MAX_TICK_MS: "2000",
              // Within [minTickMs, maxTickMs]: the default (300000) sits above maxTickMs here and
              // would now fail `loadConfig`'s guard (F1 of the 2026-07-27 pre-merge review).
              WAITRON_SKIP_RETRY_MS: "1500",
            });
            const event = await waitForEvent(lines, "server.listen_failed");
            return [s, event] as const;
          });
          started = server;
          expect(failure.port).toBe(port);
          expect(failure.code).toBe("EADDRINUSE");
          await waitForExit(exits);
          // Exactly once: the loop keeps running in the background (nothing aborted it), so a
          // second, spurious exit call here would mean something in the error handler re-fires.
          expect(exits).toEqual([1]);
        } finally {
          // `close()` on a server whose listener never bound rejects — Node's own `http.Server`
          // invokes `close()`'s callback with an error when the server never started listening
          // (confirmed empirically against this exact scenario), which is exactly the branch
          // `vitest.config.ts`'s coverage comment on `boot.ts`'s own `close()` used to record as
          // unreachable "without forging it". This test reaches it for real. `db.close()` still
          // runs regardless — it is in `close()`'s own `finally`, not after the rejection — so the
          // pool and the loop are torn down either way; only the rejection itself needs catching.
          if (started !== undefined) await expect(started.close()).rejects.toThrow();
        }
      });

      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }, 60_000);

    it("logs server.listen_failed and exits(1) on an unresolvable WAITRON_HTTP_HOST, proving the value reaches serve()", async () => {
      const port = await freePort();
      await withMockedExit(async (exits) => {
        let started: StartedServer | undefined;
        try {
          const [server, failure] = await withCapturedStdout(async (lines) => {
            const s = await startServer({
              ...KEY_ENV,
              DATABASE_URL: databaseUrl,
              WAITRON_HTTP_PORT: String(port),
              // Every other test in this file binds the DEFAULT host (127.0.0.1) successfully —
              // an unresolvable one failing to bind HERE is what proves `config.httpHost` reaches
              // `serve()`'s own `hostname` option rather than being computed and then ignored.
              WAITRON_HTTP_HOST: "not-a-real-hostname.invalid",
              WAITRON_MIGRATIONS_DIR: migrationsRoot,
              WAITRON_MIN_TICK_MS: "1000",
              WAITRON_MAX_TICK_MS: "2000",
              // Within [minTickMs, maxTickMs]: the default (300000) sits above maxTickMs here and
              // would now fail `loadConfig`'s guard (F1 of the 2026-07-27 pre-merge review).
              WAITRON_SKIP_RETRY_MS: "1500",
            });
            const event = await waitForEvent(lines, "server.listen_failed");
            return [s, event] as const;
          });
          started = server;
          expect(failure.code).toBe("ENOTFOUND");
          await waitForExit(exits);
          expect(exits).toEqual([1]);
        } finally {
          if (started !== undefined) await expect(started.close()).rejects.toThrow();
        }
      });
    }, 60_000);
  });

  // I1 of the 2026-07-27 whole-branch review: nothing PINS which config field reaches which duty,
  // and nothing proves this branch's headline behaviour end to end. `boot.ts` passes
  // `skipRetryMs: config.skipRetryMs` to both `drain` and `runDue` — `tsc` only pins that the
  // field is PRESENT, `config.test.ts` pins parsing, and the fold unit tests
  // (`drain.fold.test.ts`, `run.test.ts`) pin behaviour GIVEN a value. None of them would notice
  // `skipRetryMs: config.minTickMs` at either call site: 13/13 typecheck, every unit test and 100%
  // coverage would all stay green while silently reintroducing the exact 5-second spin this branch
  // exists to remove. This test seeds a real, due `envios` row for a tenant with no `fiscal.aeat`
  // credential — the expected shape of the first deployment (degraded-pass design §1) — and reads
  // the loop's own logged sleep duration back, the same "prove the mapping via the LOGGED effect,
  // not the call site" technique the very first test in this describe block already uses for
  // `minTickMs`/`maxTickMs`.
  //
  // The seeded tenant is never provisioned a `fiscal.aeat` credential, so — left in place — its
  // `envios` row would stay due FOREVER against the one real container this whole describe block
  // shares (`beforeAll` above): `drain.tenant_skipped` fires on `resolveClient` itself, before any
  // per-row retry state is ever touched, so nothing about this row's own due-ness ever advances.
  // The tests at ~249/~348 above assert `consecutiveFailures === 0` in this SAME container and
  // used to pass only because they were declared, and therefore ran, earlier — order-dependent on
  // this test staying last, which `--sequence.shuffle` (or a later `it` added after this one)
  // breaks. The `finally` below deletes the seeded `envios` row regardless of how this test
  // finishes, which is what actually fixes that rather than merely relying on position — verified
  // by running this suite with `--sequence.shuffle` repeatedly.
  it("sleeps on WAITRON_SKIP_RETRY_MS, not WAITRON_MIN_TICK_MS, for a tenant with due fiscal work and no fiscal.aeat credential", async () => {
    const port = await freePort();
    // `seedPendingEnvios`'s own fixed `proximo_intento_en` ('2026-07-21T00:00:00Z') is always in
    // the past relative to `startServer`'s real wall clock (`boot.ts` hardcodes `new Date()`,
    // deliberately not injectable — see its own doc comment), so this tenant is due the instant the
    // first pass runs. Seeded against `suite.admin` (the container's own superuser default), matching
    // `pass.rls.test.ts`'s identical convention for setup that must bypass RLS.
    const seeded = await seedPendingEnvios(suite.admin, { count: 1 });

    try {
      const [server, sleeping, skipped] = await withCapturedStdout(async (lines) => {
        const started = await startServer({
          ...KEY_ENV,
          DATABASE_URL: databaseUrl,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_MIN_TICK_MS: "1000",
          // Comfortably above the distinctive skip-retry value below, so neither clamp can mask it.
          WAITRON_MAX_TICK_MS: "600000",
          // Distinctive on purpose: not 5000 (`WAITRON_MIN_TICK_MS`'s own default — the old floor
          // this branch exists to stop reporting), not 300000 (`@waitron/scheduler`'s own
          // `DEFAULTS.skipRetryMs`, which this test must not pass by coincidence with the fallback),
          // and strictly between `WAITRON_MIN_TICK_MS` and `WAITRON_MAX_TICK_MS` above so neither
          // clamp can produce this same number by accident either.
          WAITRON_SKIP_RETRY_MS: "45678",
        });
        const skippedEvent = await waitForEvent(lines, "drain.tenant_skipped");
        const event = await waitForEvent(lines, "loop.sleeping");
        return [started, event, skippedEvent] as const;
      });

      try {
        // Proof #1: the seeded tenant really was skipped for a missing credential, not silently
        // dropped some other way — a passing `sleepMs` assertion below would prove nothing about
        // THIS branch's behaviour if the tenant were never enumerated at all.
        expect(skipped.tenantId).toBe(seeded.tenantId);
        expect(skipped.errorCode).toBe("credentials.missing");

        // THE assertion. `config.skipRetryMs` reached `drain` via `boot.ts`'s `drain` closure and
        // folded into `nextDueAt` as `now + WAITRON_SKIP_RETRY_MS` (`drain.ts`'s own fold — no other
        // tenant has earlier work this pass, and reconcile has no enrolled `payments.stripe` tenants
        // at all, so nothing pulls the folded answer earlier). `sleepMsFor` then clamps that against
        // `[minTickMs, maxTickMs]`, and 45678 sits strictly inside both, so it survives close to
        // verbatim — not EXACTLY 45678, because `sleepMsFor` (`loop.ts`) subtracts a SECOND,
        // freshly-read `now()` from `nextDueAt`, taken after the pass itself ran, so the reported
        // `sleepMs` is `45678` minus whatever real wall-clock time the pass took (confirmed live: a
        // few milliseconds). A generous 5-second tolerance absorbs that real timing noise while
        // staying two orders of magnitude away from `config.minTickMs` (1000) — the value
        // `skipRetryMs: config.minTickMs` at either `boot.ts` call site would report instead. This
        // test's own header comment records that the swap was verified live: making that edit turned
        // this into ~1000, watching it fail, then reverting it.
        expect(sleeping.sleepMs).toBeLessThanOrEqual(45678);
        expect(sleeping.sleepMs).toBeGreaterThan(45678 - 5000);
      } finally {
        await server.close();
      }
    } finally {
      // The ONLY row that makes this tenant perpetually due: `envios_tenants_with_work`
      // (drain.ts) reads `envios`, not `tenants`/`tills`/`registros_facturacion`/`sales`/
      // `registro_sif`, so deleting just this is what stops the tenant from being enumerated
      // again — and it sidesteps the FK-ordered teardown a full tenant delete would need
      // (`registros_facturacion`/`sales`/`invoice_series` all reference `tenants` with
      // `onDelete: "restrict"`). Runs regardless of how the block above finishes, so a failed
      // assertion still leaves the container clean for whatever test runs next.
      await suite.admin.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
    }
  }, 60_000);

  // F4 (2026-07-27 fix wave): `boot.ts`'s `drain` closure builds a fresh `aeatClientResolver`
  // every pass and releases it via `finally { await resolver.closeAll() }` — the fix this whole
  // branch exists to land, and the one line of it with no test at all before this one. Every OTHER
  // test in this describe block either enrols no tenant for `fiscal.drain`, or (the test just
  // above) enrols one with due work but NO usable `fiscal.aeat` credential — in both cases
  // `resolveClient` never reaches `mtlsFetch`, so no real per-tenant `Agent` is ever built for
  // `closeAll` to release. This seeds BOTH: due `envios` work (`seedPendingEnvios`, as above) AND
  // a usable credential, reusing `aeat-transport.test.ts`'s own TLS/PKCS#12 fixture
  // (`mintMtlsMaterial`) rather than inventing a new one — so `resolveClient` succeeds and a
  // genuine undici `Agent` gets constructed. See this file's own header comment for why `undici`'s
  // `fetch` is module-mocked (no seam to point `startServer` at a local AEAT double, and this
  // process has no business dialling the real one) while `Agent` itself stays real.
  it("closes the mTLS transport it built for a tenant with due fiscal work and a usable fiscal.aeat credential", async () => {
    const port = await freePort();
    const seeded = await seedPendingEnvios(suite.admin, { count: 1 });
    const material = mintMtlsMaterial();
    // Same shape as `aeat-transport.test.ts`'s own `provision(certKind)` helper, against the
    // TENANT `seedPendingEnvios` just seeded rather than a fresh one of its own — this test needs
    // ONE tenant carrying both due work and a usable credential, not two separate tenants.
    await withTenant(suite.admin, seeded.tenantId, (tx) =>
      putCredential(tx, loadKeyRing(KEY_ENV), {
        tenantId: seeded.tenantId,
        purpose: "fiscal.aeat",
        value: {
          pfxBase64: material.clientPfx.toString("base64"),
          passphrase: material.clientPassphrase,
          certKind: "representante",
        },
      }),
    );

    // The only observable proof, through a real boot, that the transport this pass built was
    // actually released rather than leaked for the process lifetime — `startServer`'s public
    // surface exposes no handle onto `aeatClientResolver`'s own `open` list.
    const closeSpy = vi.spyOn(Agent.prototype, "close");
    try {
      const server = await startServer({
        ...KEY_ENV,
        DATABASE_URL: databaseUrl,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_MIN_TICK_MS: "1000",
        WAITRON_MAX_TICK_MS: "600000",
        // `seedPendingEnvios`'s default `entorno` is `"production"` (`DEFAULT_ENTORNO`,
        // drain-fixtures.ts) — without this, `deploymentEnvironment` resolves its own default,
        // `"preproduction"`, the seeded row's `entorno` disagrees, and `claimBatch`'s
        // deployment-environment guard refuses it before `resolveClient` (and hence `mtlsFetch`)
        // is ever reached FOR THAT ROW. This test's assertion happened to still pass either way —
        // `resolveClient` is called once per tenant with ANY due work, ahead of and regardless of
        // that per-row check (`drain`'s own top-level loop) — but a passing assertion for the
        // wrong reason is not what this test claims to cover. Set explicitly so the scenario
        // actually exercised is "a real submission attempt", not "a refused row that happens to
        // share a tenant with a resolved transport".
        WAITRON_ENV: "production",
      });
      try {
        await waitForPass(server.health);
        expect(closeSpy).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    } finally {
      closeSpy.mockRestore();
      // Same reasoning as the skip-retry test above: only the `envios` row makes this tenant
      // perpetually due, so deleting it is enough to keep this test order-independent. The
      // `tenant_credentials` row this test also inserted is not read by `envios_tenants_with_work`
      // and is left in place, matching every other tenant/credential this file's suite seeds.
      //
      // `incidents` also needs cleanup here, unlike the skip-retry test above: with `WAITRON_ENV`
      // now agreeing with the seeded `entorno`, the mocked `undici` fetch (this file's own header
      // comment) still makes the real submission attempt fail, and `drain`'s `client.submit` catch
      // backs the batch off rather than raising an incident — but this cleanup is kept anyway,
      // rather than assumed absent, so a future change to that failure path does not silently
      // leave a row behind for a LATER test in this shared-container suite to trip over.
      await suite.admin.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
      await suite.admin.execute(sql`delete from incidents where tenant_id = ${seeded.tenantId}`);
    }
  }, 60_000);

  // Task 3: the boot guard (deployment-guard.ts). `stampDeployment` is permanent (a second,
  // different value is refused, not overwritten — see its own doc comment), so the row this test
  // writes is deleted in `finally`, the same pattern the seeded `envios` rows above use — this test
  // is order-independent, not reliant on running last: a stamp left behind would make every LATER
  // real-container test booting with `WAITRON_ENV: "production"` (the very first test in this
  // block) fail this same guard for real, which is exactly the order-dependence the "sleeps on
  // WAITRON_SKIP_RETRY_MS" test above was fixed to no longer have — not a precedent for keeping it
  // here.
  //
  // DATABASE_URL is `runtimeDatabaseUrl` (RUNTIME_ROLE), not `databaseUrl` (PROBE_ROLE) like every
  // other real-container test in this block: RUNTIME_ROLE carries no CREATE grant at all, so — per
  // this file's own confirmed finding above (`RUNTIME_ROLE`'s own comment) — ANY attempt to run
  // `applyMigrations` against it fails immediately with a raw Postgres permission error, even though
  // this container's schema is already fully migrated (Postgres checks the CREATE privilege before
  // Drizzle's own `IF NOT EXISTS` ever runs). That is what makes the observed
  // `deployment.environment_mismatch` code proof of this test's SECOND clause, not just its first:
  // with an already-migrated schema and PROBE_ROLE's CREATE grant, `applyMigrations` running here
  // would be an invisible no-op — a guard that fired too LATE (after migrations, rather than before)
  // would produce this exact same error and pass this exact same assertion. Under RUNTIME_ROLE it
  // cannot: a late or bypassed guard would surface a permission-denied failure instead, a distinct
  // and distinguishable error from `deployment.environment_mismatch`. RUNTIME_ROLE still reads the
  // stamp `assertDeploymentMatches` needs to see: `0010_deployment_stamp.sql` grants `deployment`'s
  // own `SELECT` to `app_user`, and `RUNTIME_ROLE` is an `app_user` member (this file's own
  // `beforeAll`).
  it("refuses to start, and runs no migration, against another environment's database", async () => {
    await stampDeployment(suite.admin, "preproduction");

    try {
      const error = await captureError(() =>
        startServer({
          ...KEY_ENV,
          DATABASE_URL: runtimeDatabaseUrl,
          WAITRON_ENV: "production",
        }),
      );
      expect(error).toMatchObject({ code: "deployment.environment_mismatch" });
    } finally {
      await suite.admin.execute(sql`delete from deployment where id = 1`);
    }
  });
});

// Neither test below needs the real container `beforeAll` starts for the suite above: both
// `WAITRON_MAX_TICK_MS` values are rejected or accepted before `startServer` ever reaches
// `loadKeyRing`, let alone `applyMigrations` — a deliberately unreachable `DATABASE_URL` proves
// that (a real one would make a rejection ambiguous between this guard and an actual connection
// failure that happened to also throw).
describe("startServer's maxTickMs-vs-drain-budget guard", () => {
  const UNREACHABLE_DATABASE_URL = "postgres://unused@unused.invalid/db";

  it("rejects WAITRON_MAX_TICK_MS at or above drain's staleness budget, before touching any infrastructure", async () => {
    const error = await captureError(() =>
      startServer({
        ...TILL_ENV,
        DATABASE_URL: UNREACHABLE_DATABASE_URL,
        WAITRON_MAX_TICK_MS: String(DUTY_BUDGET_MS[DRAIN_DUTY]),
      }),
    );
    expect(isAppError(error) && error.code).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_MAX_TICK_MS",
      reason: "at_or_above_drain_budget",
    });
  });

  it("lets a maxTickMs comfortably below the budget past this guard", async () => {
    // Proven by elimination, not by a full boot (which would need a real container and a key
    // ring): omitting every WAITRON_CREDENTIALS_KEY* variable makes `loadKeyRing` — the very next
    // line in `startServer` after this guard — throw `credentials.key_missing`. Reaching THAT
    // error, rather than `server.config_invalid`/`at_or_above_drain_budget`, is what proves this
    // guard let a valid value through rather than rejecting it for the wrong reason.
    const error = await captureError(() =>
      startServer({
        ...TILL_ENV,
        DATABASE_URL: UNREACHABLE_DATABASE_URL,
        WAITRON_MAX_TICK_MS: String(DUTY_BUDGET_MS[DRAIN_DUTY] - 1),
      }),
    );
    expect(isAppError(error) && error.code).toBe("credentials.key_missing");
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is 5 MiB — the product-image upload ceiling the write routes (later slices) enforce", () => {
    // A settled config constant (design §5e, proposal 5 MiB), pinned here so a later edit to the
    // upload route cannot silently change the ceiling without this failing.
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("DEFAULT_MIGRATIONS_ROOT", () => {
  it("resolves to an absolute path named drizzle, the layout scripts/copy-migrations.mjs builds beside the bundle", () => {
    // 100% statement coverage on this expression proves nothing about whether it is CORRECT — it is
    // exercised either way, being a function argument at startServer's own loadConfig call. These
    // are the two ways it actually breaks: a RELATIVE root would resolve to apps/server/drizzle
    // under the bundle — the non-existent path the whole manifest indirection exists to avoid — and
    // a WRONG basename would miss the folders scripts/copy-migrations.mjs actually copies. Both are
    // asserted directly against the real exported constant `startServer` passes to `loadConfig`, not
    // a second copy of the same expression that could silently drift from it.
    expect(isAbsolute(DEFAULT_MIGRATIONS_ROOT)).toBe(true);
    expect(basename(DEFAULT_MIGRATIONS_ROOT)).toBe("drizzle");
  });
});

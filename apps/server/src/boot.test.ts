import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureError, type Database } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { DEFAULT_MIGRATIONS_ROOT, startServer, type StartedServer } from "./boot.js";
import { DUTY_BUDGET_MS } from "./health.js";
import { manifestSets, migrationOptionsFor } from "./migrations.js";
import { DRAIN_DUTY } from "./pass.js";
import { roleUrl, startRealPostgres, type RealPostgres } from "./testing/postgres.js";

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
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

let pg: RealPostgres;
let admin: Database;
let migrationsRoot: string;
let databaseUrl: string;
let runtimeDatabaseUrl: string;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();

  const dbName = new URL(pg.uri).pathname.replace(/^\//, "");
  await admin.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`),
  );
  // `CREATE` on the database and on `public`: Drizzle's migrator issues `CREATE SCHEMA IF NOT
  // EXISTS "public"` (database-level `CREATE`) then `CREATE TABLE IF NOT EXISTS` per migration set
  // (schema-level `CREATE`) before it ever checks whether either already exists.
  await admin.execute(sql.raw(`grant create on database ${dbName} to ${PROBE_ROLE}`));
  await admin.execute(sql.raw(`grant create on schema public to ${PROBE_ROLE}`));
  // `SELECT` on every table in `public`, not just the five journal tables by name: `startRealPostgres`
  // already applied every migration as the container's superuser, so the deployment role does not
  // OWN the journal tables it must read back from to decide nothing new needs applying.
  await admin.execute(sql.raw(`grant select on all tables in schema public to ${PROBE_ROLE}`));

  databaseUrl = roleUrl(pg.uri, PROBE_ROLE, PROBE_PASSWORD);

  // No `CREATE`, no `SELECT` on the journal tables — `app_user` membership and nothing else, the
  // role spec §10 actually means by "the non-superuser deployment role". It can do the duty work
  // (drain/reconcile read and write through `app_user`'s own table grants, applied by the migrations
  // themselves) but cannot run a migration against an already-migrated database, for the identical
  // permission-denied-before-`IF NOT EXISTS` reason `PROBE_ROLE`'s own comment above explains.
  await admin.execute(
    sql.raw(`create role ${RUNTIME_ROLE} login password '${RUNTIME_PASSWORD}' in role app_user`),
  );
  runtimeDatabaseUrl = roleUrl(pg.uri, RUNTIME_ROLE, RUNTIME_PASSWORD);

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

// Guarded, matching pass.rls.test.ts: a beforeAll failure must not be masked by a teardown that
// throws first, and the container must not leak.
afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  if (admin !== undefined) await admin.close();
  if (pg !== undefined) await pg.stop();
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
  it("boots, pins the tick-clamp mapping, folds settlementLagMs, threads aeatEnv, runs a pass, serves /health and shuts down cleanly", async () => {
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
        WAITRON_SETTLEMENT_LAG_MS: "1000",
        // Set explicitly to the NON-default value: `config.test.ts` already proves `loadConfig`
        // parses this correctly, and `preproduction` is both the default AND what a silently
        // hardcoded `aeatEndpointFor` argument would also produce, so leaving this unset here would
        // assert nothing I4 didn't already have. "production" only appears on the logged line below
        // if `config.aeatEnv` genuinely reached `boot.ts`'s runtime, not merely `loadConfig`'s
        // return value in isolation.
        WAITRON_AEAT_ENV: "production",
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

      // I4: `aeatEndpointFor(config.aeatEnv)` is the one config value spec §10 calls irreversible
      // (production numbering can never be reused), and nothing observed it reaching `boot.ts` at
      // all before this assertion — a hardcoded `aeatEndpointFor("production")` would have passed
      // every other test in the repository. This does not observe the endpoint the resolver itself
      // selects (that needs a seeded `fiscal.aeat` credential and due `envios` work, which this
      // suite deliberately has none of — see the 2026-07-27 addendum to the server-host spec §14),
      // but it does prove `config.aeatEnv` is not silently dropped between `loadConfig` and the log
      // line `aeatClientResolver` is built from the same config field beside.
      expect(listening.aeatEnv).toBe("production");
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

  it("boots without WAITRON_SETTLEMENT_LAG_MS, taking the neutral layer's own default", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      DATABASE_URL: databaseUrl,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
    });

    try {
      await waitForPass(server.health);
    } finally {
      // Two GENUINELY concurrent calls this time, not one-after-the-other: without the idempotency
      // guard, the loser reaches `db.close()` a second time and throws.
      await Promise.all([server.close(), server.close()]);
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
        DATABASE_URL: UNREACHABLE_DATABASE_URL,
        WAITRON_MAX_TICK_MS: String(DUTY_BUDGET_MS[DRAIN_DUTY] - 1),
      }),
    );
    expect(isAppError(error) && error.code).toBe("credentials.key_missing");
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
